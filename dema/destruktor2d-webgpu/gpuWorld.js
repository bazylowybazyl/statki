// Świat fizyki belek na GPU (WebGPU compute): bufory, potoki, kodowanie kroków i odczyty.
//
// Cała fizyka kroku biegnie na GPU bez powrotu do CPU: ruch ciał, broń, PBD, redukcje na ciało,
// kontakty, zgniot. CPU tylko: układa scenę, co klatkę dopisuje parametry podkroków (sterowanie,
// rozkazy strzałów) i czyta z opóźnieniem 1–3 klatek stan ciał (telemetria, liczba podkroków)
// oraz flagi zerwań (wyspy i mosty → rozkazy rozpadu, jak processSplits na CPU).
import {
  KERNELS, kernelSource, CONFIG_FIELDS, STEP_FIELDS, STEP_STRIDE, COLOR_STRIDE, uniformLayout,
  MAX_BODIES, MAX_PAIRS, MAX_IMPACTS, PROJECTILES, BLASTS, EFFECTS, DEBRIS_CAPACITY, COUNTERS,
  BODY_FLOATS, BODY, NODE, STEP, COUNTER, GS_GROUP_COLORS, REDUCE_CHUNK
} from './gpuShaders.js';
import { colorBeams } from './build.js';

const WG = 64;
const MAX_STEP_ENTRIES = 1024;           // wpisów parametrów na klatkę (2 na podkrok + topologia)
const MAX_COLORS = 64;
const READBACK_RING = 6;   // odczyty w locie; przy setkach kl./s (bez vsync) 3 nie nadążały
const CONTACT_MIN = 1 << 16;
const TOPO_OPS = 256;

const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };
const hiOf = (x) => Math.round(x / 16) * 16;

class UniformBlock {
  constructor(fields, bytes) {
    this.bytes = bytes;
    this.buffer = new ArrayBuffer(bytes);
    this.f32 = new Float32Array(this.buffer);
    this.u32 = new Uint32Array(this.buffer);
    this.index = uniformLayout(fields);
  }
  set(name, value, base = 0) {
    const e = this.index.get(name);
    if (!e) throw new Error(`pole uniformu ${name}?`);
    if (e.t === 'u32') this.u32[base + e.i] = value >>> 0;
    else this.f32[base + e.i] = value;
  }
}

export class GpuBeamWorld {
  /**
   * @param {GPUDevice} device urządzenie (w grze: renderer.backend.device — jedno na stronę)
   * @param {{ timestamps?: boolean }} opts
   */
  constructor(device, opts = {}) {
    this.device = device;
    this.timestamps = !!opts.timestamps && device.features.has('timestamp-query');
    // wątki grupy rozwiązującej mały kadłub (więcej = lepsze ukrywanie opóźnień pamięci na jednym SM)
    this.gsGroupSize = Math.min(opts.gsGroupSize || 256, device.limits.maxComputeInvocationsPerWorkgroup, device.limits.maxComputeWorkgroupSizeX);
    this.kernels = {};
    this.buffers = {};
    this.ready = false;
    this.scene = null;
    this.stamp = 1;
    this.stats = { encodeMs: 0, dispatches: 0, substeps: 0, steps: 0, gpuPhysicsMs: NaN, gpuRenderMs: NaN };
    this.state = null;          // ostatni odczyt (ciała, liczniki, czasy GPU)
    this._ring = [];
    this._topo = { pending: false, request: false, job: null, apply: null, lastTick: -1e9 };
    this._pendingRepair = 0;
    this._staticDirty = false;
    this.tick = 0;
  }

  async init() {
    const d = this.device;
    const U = GPUBufferUsage;
    this.configBlock = new UniformBlock(CONFIG_FIELDS, 256);
    this.stepBlock = new UniformBlock(STEP_FIELDS, MAX_STEP_ENTRIES * STEP_STRIDE);
    this.configBuffer = d.createBuffer({ size: 256, usage: U.UNIFORM | U.COPY_DST, label: 'cfg' });
    this.stepBuffer = d.createBuffer({ size: MAX_STEP_ENTRIES * STEP_STRIDE, usage: U.UNIFORM | U.COPY_DST, label: 'step' });
    this.colorBuffer = d.createBuffer({ size: MAX_COLORS * COLOR_STRIDE, usage: U.UNIFORM | U.COPY_DST, label: 'colors' });
    this.camInBuffer = d.createBuffer({ size: 64, usage: U.UNIFORM | U.COPY_DST, label: 'camIn' });
    this.camInData = new ArrayBuffer(64);

    const C = GPUShaderStage.COMPUTE;
    this.paramsLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 208 } }
    ] });
    this.colorLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }
    ] });
    this.cameraLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } }] });
    this.paramsBG = d.createBindGroup({ layout: this.paramsLayout, entries: [
      { binding: 0, resource: { buffer: this.configBuffer } },
      { binding: 1, resource: { buffer: this.stepBuffer, size: 208 } }
    ] });
    this.colorBG = d.createBindGroup({ layout: this.colorLayout, entries: [{ binding: 0, resource: { buffer: this.colorBuffer, size: 16 } }] });
    this.cameraBG = d.createBindGroup({ layout: this.cameraLayout, entries: [{ binding: 0, resource: { buffer: this.camInBuffer } }] });

    const jobs = [];
    for (const [name, k] of Object.entries(KERNELS)) {
      const layout0 = d.createBindGroupLayout({ label: `${name}.g0`, entries: k.bindings.map(([, access], i) => ({
        binding: i, visibility: C, buffer: { type: access === 'r' ? 'read-only-storage' : 'storage' }
      })) });
      const groups = [layout0, this.paramsLayout];
      if (k.colorGroup) groups.push(this.colorLayout);
      if (k.cameraGroup) groups.push(this.cameraLayout);
      const module = d.createShaderModule({ code: kernelSource(name), label: name });
      jobs.push(d.createComputePipelineAsync({
        label: name, layout: d.createPipelineLayout({ bindGroupLayouts: groups }),
        compute: { module, entryPoint: 'main', constants: k.overrides ? k.overrides(this) : undefined }
      }).then((pipeline) => { this.kernels[name] = { pipeline, layout0, bindings: k.bindings, extra: k.colorGroup ? 'color' : k.cameraGroup ? 'camera' : null, bindGroup: null }; }));
    }
    await Promise.all(jobs);

    if (this.timestamps) {
      this.querySet = d.createQuerySet({ type: 'timestamp', count: 4 });
      this.queryResolve = d.createBuffer({ size: 32, usage: U.QUERY_RESOLVE | U.COPY_SRC });
    }
    this.ready = true;
  }

  // ------------------------------------------------------------------ scena

  /**
   * @param {object} scene
   *   cfg: wartości createBeamConfig + nadpisania dema
   *   bodies: [{ hull (buildSpriteHullGpu), massMultiplier, static, x, y, angle, vx, vy, w, instance, name }]
   *   instances: [{ hull, nodeStart, nodeCount, beamStart, beamCount }] — wypełnia setScene
   */
  setScene(scene) {
    const d = this.device;
    for (const buf of Object.values(this.buffers)) buf.destroy?.();
    this.buffers = {};
    this._ring.forEach((r) => { r.dead = true; });
    this._ring = [];
    this._topo = { pending: false, request: false, job: null, apply: null, lastTick: -1e9 };
    this.stamp = 1;
    this.tick = 0;
    this.scene = scene;

    // --- rozmiary i przesunięcia instancji ---
    let N = 0, B = 0, A = 0, dynamicNodes = 0, staticNodes = 0;
    const instances = [];
    for (let bi = 0; bi < scene.bodies.length; bi++) {
      const sb = scene.bodies[bi];
      const h = sb.hull;
      const beams = sb.static ? 0 : h.beamCount;
      instances.push({ body: bi, hull: h, nodeStart: N, nodeCount: h.nodeCount, beamStart: B, beamCount: beams, adjStart: A,
        tint: sb.tint || null, isStatic: !!sb.static, texture: sb.texture || null });
      N += h.nodeCount; B += beams; A += sb.static ? 0 : h.adj.length;
      if (sb.static) staticNodes += h.nodeCount; else dynamicNodes += h.nodeCount;
    }
    this.instances = instances;
    this.nodeCount = N;
    this.beamCount = Math.max(1, B);
    this.listCapacity = N * 3 + 64;

    // --- tablice CPU → GPU ---
    const posVel = new Float32Array(N * 4), restMass = new Float32Array(N * 4), pred = new Float32Array(N * 2);
    const invMass = new Float32Array(N), nodeInfo = new Uint32Array(N * 4), nodeMeta = new Uint32Array(N * 4);
    const nodeAux = new Float32Array(N * 4), nodeAuxU = new Uint32Array(nodeAux.buffer), links = new Int32Array(N * 8).fill(-1);
    const adj = new Uint32Array(Math.max(1, A)), nodeLists = new Uint32Array(this.listCapacity);
    const beamEnds = new Uint32Array(this.beamCount * 2), beamLen = new Float32Array(this.beamCount * 4);
    const beamMat = new Float32Array(this.beamCount * 4), beamFlags = new Uint32Array(this.beamCount);
    const beamColor = new Uint8Array(this.beamCount);
    // Topologia na CPU (rozpady): węzeł → ciało, listy ciał, sąsiedztwo, końce belek, mosty pierwotne.
    const cpuAdjStart = new Int32Array(N + 1);
    const cpuNodeBody = new Int32Array(N);
    let colors = 0;

    for (const inst of instances) {
      const sb = scene.bodies[inst.body];
      const h = inst.hull;
      const mult = Math.max(1e-6, sb.massMultiplier || 1);
      const n0 = inst.nodeStart, b0 = inst.beamStart, a0 = inst.adjStart;
      for (let i = 0; i < h.nodeCount; i++) {
        const g = n0 + i;
        const m = h.mass[i] * mult;
        posVel[g * 4] = h.ox[i]; posVel[g * 4 + 1] = h.oy[i];
        restMass[g * 4] = h.ox[i]; restMass[g * 4 + 1] = h.oy[i]; restMass[g * 4 + 2] = m; restMass[g * 4 + 3] = h.hp[i];
        pred[g * 2] = h.ox[i]; pred[g * 2 + 1] = h.oy[i];
        invMass[g] = m > 0 ? 1 / m : 0;
        nodeInfo[g * 4] = NODE.ACTIVE | (h.surface[i] ? NODE.SURFACE : 0) | (sb.static ? NODE.STATIC : 0);
        nodeInfo[g * 4 + 1] = inst.body;
        nodeInfo[g * 4 + 2] = i;
        nodeInfo[g * 4 + 3] = (h.ix[i] & 0xffff) | (h.iy[i] << 16);
        if (!sb.static) {
          nodeMeta[g * 4] = a0 + h.adjStart[i];
          nodeMeta[g * 4 + 1] = a0 + h.adjStart[i + 1];
          nodeMeta[g * 4 + 2] = h.beamCountPerNode[i];
          nodeMeta[g * 4 + 3] = h.localBeamCount[i];
          for (let s = 0; s < 8; s++) { const e = h.links[i * 8 + s]; links[g * 8 + s] = e < 0 ? -1 : b0 + e; }
        }
        nodeAux[g * 4] = h.hp[i];
        nodeAux[g * 4 + 2] = -1e9;
        nodeAuxU[g * 4 + 3] = ((h.r[i] * 255) & 255) | (((h.g[i] * 255) & 255) << 8) | (((h.b[i] * 255) & 255) << 16) | (255 << 24);
        nodeLists[g] = g;
        cpuNodeBody[g] = inst.body;
      }
      if (!sb.static) {
        for (let q = 0; q < h.adj.length; q++) adj[a0 + q] = b0 + h.adj[q];
        // kolorowanie zależy tylko od konstrukcji — raz na kadłub (flota ma dziesiątki kopii)
        h._coloring ||= colorBeams(h.nodeCount, h.beamA, h.beamB, h.ix, h.iy, MAX_COLORS);
        const { color, colors: nc } = h._coloring;
        inst.colorCount = nc;
        colors = Math.max(colors, nc);
        for (let e = 0; e < h.beamCount; e++) {
          const g = b0 + e;
          beamEnds[g * 2] = n0 + h.beamA[e]; beamEnds[g * 2 + 1] = n0 + h.beamB[e];
          beamLen[g * 4] = h.rest[e]; beamLen[g * 4 + 1] = h.rest[e];
          beamMat[g * 4] = h.stiffness[e]; beamMat[g * 4 + 1] = h.deform[e]; beamMat[g * 4 + 2] = h.brk[e];
          beamFlags[g] = (h.restBridge[e] ? 2 : 0) | (h.type[e] << 8);
          beamColor[g] = color[e];
        }
      }
    }
    // Belki pogrupowane kolorami. Małe kadłuby (≤ gsGroupLimit belek): każdy osobno, kolory po kolei —
    // rozwiązuje je jedna grupa robocza na kadłub (kernel gsGroup). Duże: wszystkie razem, jeden
    // dispatch na kolor (gsColor) — wtedy liczenie, nie narzut dispatchy, decyduje o czasie.
    const groupLimit = scene.gsGroupLimit ?? 40000;
    const colorBeamsArr = new Uint32Array(Math.max(1, B));
    let cursor = 0;
    const large = instances.filter((inst) => !inst.isStatic && inst.beamCount > 0 &&
      (inst.beamCount > groupLimit || inst.colorCount > GS_GROUP_COLORS));
    const small = instances.filter((inst) => !inst.isStatic && inst.beamCount > 0 && !large.includes(inst));
    this.colorRanges = [];
    const colorData = new Uint32Array(MAX_COLORS * COLOR_STRIDE / 4);
    let largeColors = 0;
    for (const inst of large) largeColors = Math.max(largeColors, inst.colorCount);
    for (let c = 0; c < largeColors; c++) {
      const start = cursor;
      for (const inst of large) {
        for (let e = inst.beamStart; e < inst.beamStart + inst.beamCount; e++) if (beamColor[e] === c) colorBeamsArr[cursor++] = e;
      }
      this.colorRanges.push({ start, count: cursor - start });
      colorData[c * COLOR_STRIDE / 4] = start;
      colorData[c * COLOR_STRIDE / 4 + 1] = cursor - start;
    }
    const stride = 1 + GS_GROUP_COLORS * 2;
    const gsTable = new Uint32Array(Math.max(1, small.length) * stride);
    small.forEach((inst, k) => {
      gsTable[k * stride] = inst.colorCount;
      const counts = new Uint32Array(inst.colorCount);
      for (let e = inst.beamStart; e < inst.beamStart + inst.beamCount; e++) counts[beamColor[e]]++;
      const starts = new Uint32Array(inst.colorCount);
      for (let c = 0; c < inst.colorCount; c++) {
        starts[c] = cursor;
        gsTable[k * stride + 1 + c * 2] = cursor;
        gsTable[k * stride + 2 + c * 2] = counts[c];
        cursor += counts[c];
      }
      for (let e = inst.beamStart; e < inst.beamStart + inst.beamCount; e++) colorBeamsArr[starts[beamColor[e]]++] = e;
    });
    this.colors = colors;
    this.gsGroups = small.length;
    this.gsLarge = large.length;
    d.queue.writeBuffer(this.colorBuffer, 0, colorData);

    // CSR na CPU (globalne indeksy) do wysp i mostów
    for (const inst of instances) {
      const h = inst.hull;
      for (let i = 0; i < h.nodeCount; i++) {
        const g = inst.nodeStart + i;
        cpuAdjStart[g + 1] = inst.isStatic ? 0 : (h.adjStart[i + 1] - h.adjStart[i]);
      }
    }
    for (let i = 0; i < N; i++) cpuAdjStart[i + 1] += cpuAdjStart[i];
    const cpuAdj = new Int32Array(cpuAdjStart[N]);
    for (const inst of instances) {
      if (inst.isStatic) continue;
      const h = inst.hull;
      for (let i = 0; i < h.nodeCount; i++) {
        const g = inst.nodeStart + i;
        for (let q = h.adjStart[i]; q < h.adjStart[i + 1]; q++) cpuAdj[cpuAdjStart[g] + (q - h.adjStart[i])] = inst.beamStart + h.adj[q];
      }
    }
    const restBridge = new Uint8Array(this.beamCount);
    for (let e = 0; e < B; e++) restBridge[e] = (beamFlags[e] >> 1) & 1;
    this.topology = {
      adjStart: cpuAdjStart, adj: cpuAdj, beamA: new Int32Array(B), beamB: new Int32Array(B), restBridge,
      nodeBody: cpuNodeBody, lists: [], bodyInstance: [], broken: new Uint8Array(this.beamCount), active: new Uint8Array(N)
    };
    for (let e = 0; e < B; e++) { this.topology.beamA[e] = beamEnds[e * 2]; this.topology.beamB[e] = beamEnds[e * 2 + 1]; }

    // --- ciała ---
    const bodyData = new Float32Array(MAX_BODIES * BODY_FLOATS);
    const bodyU = new Uint32Array(bodyData.buffer);
    this.bodyCount = scene.bodies.length;
    this.listUsed = N;
    for (let bi = 0; bi < scene.bodies.length; bi++) {
      const sb = scene.bodies[bi];
      const inst = instances[bi];
      const h = sb.hull;
      const mult = Math.max(1e-6, sb.massMultiplier || 1);
      this._writeBodyRecord(bodyData, bodyU, bi, {
        x: sb.x || 0, y: sb.y || 0, vx: sb.vx || 0, vy: sb.vy || 0, angle: sb.angle || 0, w: sb.w || 0,
        mass: h.totalMass * mult, invMass: sb.static ? 0 : 1 / (h.totalMass * mult), invI: h.invIzz / mult, ram: 1,
        radius: h.radius, cs: h.cellSize, listStart: inst.nodeStart, listCount: h.nodeCount, active: h.nodeCount,
        flags: BODY.USED | (sb.static ? BODY.STATIC : 0) | (sb.noSplit ? BODY.NOSPLIT : 0), wakeHold: scene.cfg.wakeHoldFrames,
        instance: bi, hull: h
      });
      const list = new Int32Array(h.nodeCount);
      for (let i = 0; i < h.nodeCount; i++) list[i] = inst.nodeStart + i;
      this.topology.lists[bi] = { start: inst.nodeStart, nodes: list };
      this.topology.bodyInstance[bi] = bi;
    }

    // --- bufory ---
    const U = GPUBufferUsage;
    const S = U.STORAGE | U.COPY_DST | U.COPY_SRC;
    const mk = (name, bytesOrData, extraUsage = 0) => {
      const data = typeof bytesOrData === 'number' ? null : bytesOrData;
      const size = Math.max(16, Math.ceil((data ? data.byteLength : bytesOrData) / 4) * 4);
      const buf = d.createBuffer({ size, usage: S | extraUsage, label: name, mappedAtCreation: !!data });
      if (data) {
        new Uint8Array(buf.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        buf.unmap();
      }
      this.buffers[name] = buf;
      return buf;
    };
    this.hashSize = nextPow2(Math.max(1024, dynamicNodes * 2));
    this.staticHashSize = staticNodes > 0 ? nextPow2(Math.max(1024, staticNodes * 2)) : 1;
    this.contactCapacity = Math.max(CONTACT_MIN, nextPow2(dynamicNodes));
    mk('bodies', bodyData);
    mk('pred', pred);
    mk('prev', pred);
    mk('posVel', posVel);
    mk('restMass', restMass);
    mk('invMass', invMass);
    mk('nodeInfo', nodeInfo);
    mk('nodeMeta', nodeMeta);
    mk('nodeAux', nodeAux);
    mk('links', links);
    mk('adj', adj);
    mk('worldPos', N * 8);
    mk('gridNext', N * 4);
    mk('gridHead', this.hashSize * 4);
    mk('staticHead', new Int32Array(this.staticHashSize).fill(-1));
    mk('crush', N * 8);
    mk('massStamp', N * 4);
    mk('nodeLists', nodeLists);
    mk('beamEnds', beamEnds);
    mk('beamLen', beamLen);
    mk('beamMat', beamMat);
    mk('beamFlags', beamFlags);
    mk('colorBeams', colorBeamsArr);
    mk('gsTable', gsTable);
    let maxDynamic = 1;
    for (const inst of instances) if (!inst.isStatic) maxDynamic = Math.max(maxDynamic, inst.nodeCount);
    this.reduceStride = Math.ceil(maxDynamic / REDUCE_CHUNK);
    mk('partials', MAX_BODIES * this.reduceStride * 64);
    mk('bodyNear', MAX_BODIES * 4);
    mk('pairFlags', MAX_BODIES * MAX_BODIES * 4);
    mk('collide', (2 + MAX_PAIRS) * 4);
    mk('contacts', this.contactCapacity * 36);
    mk('pairData', MAX_PAIRS * 104);
    mk('dispatchArgs', 16 * 4, U.INDIRECT);
    mk('counters', COUNTERS * 4);
    mk('bodyEvents', MAX_BODIES * 4);
    mk('projectiles', PROJECTILES * 64);
    mk('blasts', BLASTS * 64);
    mk('effects', EFFECTS * 32);
    mk('impacts', MAX_IMPACTS * 64);
    mk('weaponState', 16 * 4);
    mk('debris', DEBRIS_CAPACITY * 64);
    mk('topoOps', TOPO_OPS * 16);
    mk('topoList', (N + this.beamCount + 8) * 4);
    this.topoWords = Math.ceil(this.beamCount / 32) + Math.ceil(N / 32);
    mk('topoBits', this.topoWords * 4);
    mk('camState', 64);
    this.topoStaging = d.createBuffer({ size: this.topoWords * 4, usage: U.MAP_READ | U.COPY_DST, label: 'topoStaging' });

    // efekty z czasem startu daleko w przeszłości (niewidoczne)
    const fx = new Float32Array(EFFECTS * 8);
    for (let k = 0; k < EFFECTS; k++) fx[k * 8 + 4] = -1e9;
    d.queue.writeBuffer(this.buffers.effects, 0, fx);
    const debrisInit = new Float32Array(DEBRIS_CAPACITY * 16);
    for (let k = 0; k < DEBRIS_CAPACITY; k++) { debrisInit[k * 16 + 6] = -1e9; debrisInit[k * 16 + 7] = 1; }
    d.queue.writeBuffer(this.buffers.debris, 0, debrisInit);

    for (const [name, k] of Object.entries(this.kernels)) {
      k.bindGroup = d.createBindGroup({ label: `${name}.bg0`, layout: k.layout0, entries: k.bindings.map(([buf, , , source], i) => {
        const b = this.buffers[source || buf];
        if (!b) throw new Error(`brak bufora ${source || buf} dla ${name}`);
        return { binding: i, resource: { buffer: b } };
      }) });
    }

    this._writeConfig();
    this._staticDirty = staticNodes > 0;
    this.origin = { x: hiOf(scene.origin?.x || 0), y: hiOf(scene.origin?.y || 0) };
    this.state = null;
    this.simTime = 0;
  }

  _writeBodyRecord(f, u, bi, o) {
    const base = bi * BODY_FLOATS;
    const hx = hiOf(o.x), hy = hiOf(o.y);
    f[base] = hx; f[base + 1] = hy; f[base + 2] = o.x - hx; f[base + 3] = o.y - hy;
    f[base + 4] = o.vx; f[base + 5] = o.vy; f[base + 6] = o.angle; f[base + 7] = o.w;
    f[base + 8] = o.mass; f[base + 9] = o.invMass; f[base + 10] = o.invI; f[base + 11] = o.ram;
    if (o.hull) {
      let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
      const h = o.hull;
      for (let i = 0; i < h.nodeCount; i++) {
        mnX = Math.min(mnX, h.ox[i]); mxX = Math.max(mxX, h.ox[i]);
        mnY = Math.min(mnY, h.oy[i]); mxY = Math.max(mxY, h.oy[i]);
      }
      f[base + 12] = mnX; f[base + 13] = mnY; f[base + 14] = mxX; f[base + 15] = mxY;
    }
    f[base + 16] = 0; f[base + 17] = 0; f[base + 18] = 0; f[base + 19] = 0;
    f[base + 20] = o.radius || 0; f[base + 21] = 0; f[base + 22] = o.cs; f[base + 23] = 0;
    f[base + 24] = Math.cos(o.angle); f[base + 25] = Math.sin(o.angle); f[base + 26] = 0; f[base + 27] = -1e9;
    u[base + 28] = o.listStart; u[base + 29] = o.listCount; u[base + 30] = o.active; u[base + 31] = 0;
    u[base + 32] = o.flags; u[base + 33] = 0; u[base + 34] = o.wakeHold || 0; u[base + 35] = o.instance;
  }

  _writeConfig() {
    const c = this.scene.cfg, b = this.configBlock;
    const set = (n, v) => b.set(n, v);
    set('solverIterations', Math.max(1, c.solverIterations | 0));
    set('plasticRate', c.plasticRate); set('maxRestDrift', c.maxRestDrift); set('plasticFatigue', c.plasticFatigue);
    set('breakOn', c.breakEnabled ? 1 : 0); set('stiffMul', c.globalStiffnessMul); set('breakMul', c.globalBreakMul);
    set('mountRatio', c.mountMinSupportRatio ?? 0.3); set('nodeDamping', c.nodeDamping);
    set('nodeRadiusRatio', c.nodeRadius / c.cellSize); set('restitution', c.restitution); set('friction', c.friction);
    set('separationPercent', c.separationPercent); set('separationSlop', c.separationSlop);
    set('crushTransfer', c.crushTransfer); set('crushSpeedThreshold', c.crushSpeedThreshold);
    set('crushMassBias', c.crushMassBias); set('crushBuckling', c.crushBuckling); set('crushStrength', c.crushStrength);
    set('maxContacts', Math.max(8, c.maxContacts | 0)); set('cellSize', c.cellSize);
    set('linearDamping', c.linearDamping); set('angularDamping', c.angularDamping);
    set('sleepMotionThreshold', c.sleepMotionThreshold); set('sleepFrames', c.sleepFrames); set('wakeHoldFrames', c.wakeHoldFrames);
    set('impactPush', c.impactPush);
    let maxCs = 0;
    for (const sb of this.scene.bodies) maxCs = Math.max(maxCs, sb.hull.cellSize);
    this.gridCell = 2 * maxCs * (c.nodeRadius / c.cellSize) * 1.001;
    set('gridCell', this.gridCell); set('gridMask', this.hashSize - 1);
    set('staticMask', this.staticHashSize > 1 ? this.staticHashSize - 1 : 0);
    set('bodyCount', this.bodyCount); set('nodeCount', this.nodeCount); set('beamCount', this.beamCount);
    set('maxBodies', MAX_BODIES); set('contactCapacity', this.contactCapacity); set('maxPairs', MAX_PAIRS);
    set('debrisCapacity', DEBRIS_CAPACITY); set('wreckKick', c.wreckOutwardKick); set('wreckSpin', c.wreckSpinResponse);
    set('impactCapacity', MAX_IMPACTS);
    set('heatGain', c.heatGain || 0); set('heatSpeed', c.heatSpeed); set('heatContact', c.heatContact);
    set('heatSpread', c.heatSpread); set('heatWoundWindow', c.heatWoundWindow); set('listCount', this.listUsed);
    set('reduceStride', this.reduceStride);
    this.device.queue.writeBuffer(this.configBuffer, 0, b.buffer);
  }

  /** Zmiana suwaków materiału w biegu (bez przebudowy sceny). */
  updateConfig(partial) {
    Object.assign(this.scene.cfg, partial);
    this._writeConfig();
  }

  requestRepair(dt = 0.4) { this._pendingRepair = dt; }

  // ------------------------------------------------------------------ klatka

  /**
   * Koduje i wysyła fizykę jednej klatki.
   * @param {{ steps: Array<{ substeps: number, input?: object, fire?: Array }>, dt: number, weaponsActive: boolean,
   *   flight: object, controlBody: number, weaponParams: object, camera?: object }} plan
   * @returns {GPUCommandEncoder} koder z przebiegiem fizyki (render dokleja swój przebieg i wysyła)
   */
  encodeFrame(plan) {
    const t0 = performance.now();
    const d = this.device;
    const sb = this.stepBlock;
    const cfg = this.scene.cfg;
    let entry = 0;
    let dispatches = 0;
    const newEntry = (dt, flags, extra) => {
      if (entry >= MAX_STEP_ENTRIES) throw new Error('za dużo podkroków w klatce');
      const base = entry * (STEP_STRIDE / 4);
      sb.f32.fill(0, base, base + STEP_STRIDE / 4);
      sb.set('dt', dt, base); sb.set('invDt', 1 / dt, base);
      sb.set('damp', Math.exp(-cfg.nodeDamping * dt * 60), base);
      sb.set('plasticK', 1 - Math.pow(1 - Math.min(1, cfg.plasticRate), dt * 120), base);
      sb.set('stepScaleSq', (dt * 120) ** 2, base);
      sb.set('stepDt', plan.dt, base);
      sb.set('originX', this.origin.x, base); sb.set('originY', this.origin.y, base);
      sb.set('flags', flags, base);
      sb.set('stamp', this.stamp++ >>> 0, base);
      sb.set('controlBody', plan.controlBody ?? 0, base);
      sb.set('time', this.simTime, base);
      const wp = plan.weaponParams || {};
      sb.set('laserSpeed', wp.laserSpeed || 3600, base); sb.set('missileSpeed', wp.missileSpeed || 1100, base);
      sb.set('convergence', wp.convergence || 2600, base);
      if (extra) extra(base);
      return entry++;
    };

    // --- parametry: topologia z CPU, naprawa, siatka statyczna, podkroki ---
    const topoApply = this._topo.apply;
    this._topo.apply = null;
    if (topoApply) this._uploadTopology(topoApply, newEntry);
    const repairEntry = this._pendingRepair > 0 ? newEntry(Math.min(1, this._pendingRepair), 0) : -1;
    this._pendingRepair = 0;
    const staticEntry = this._staticDirty ? newEntry(1 / 120, 0) : -1;
    this._staticDirty = false;

    const stepEntries = [];
    for (const st of plan.steps) {
      const n = Math.max(1, st.substeps | 0);
      const h = plan.dt / n;
      for (let s = 0; s < n; s++) {
        const first = s === 0;
        let flags = STEP.DAMAGE | STEP.TRANSFER;
        if (first && st.input) flags |= STEP.CONTROLS;
        if (first && st.fire?.length) flags |= STEP.FIRE;
        const e0 = newEntry(h, flags, (base) => {
          if (first && st.input) {
            const f = plan.flight, inp = st.input;
            sb.set('throttle', inp.throttle, base); sb.set('turn', inp.turn, base); sb.set('strafe', inp.strafe, base);
            sb.set('boost', inp.boost ? 1 : 0, base); sb.set('brake', inp.brake ? 1 : 0, base); sb.set('assist', inp.assist ? 1 : 0, base);
            sb.set('cruiseSpeed', f.cruiseSpeed, base); sb.set('boostSpeed', f.boostSpeed, base);
            sb.set('reverseSpeed', f.reverseSpeed, base); sb.set('strafeSpeed', f.strafeSpeed, base);
            sb.set('accel', f.accel, base); sb.set('boostAccel', f.boostAccel, base);
            sb.set('turnRate', f.turnRate, base); sb.set('turnAccel', f.turnAccel, base);
          }
          if (first && st.fire?.length) {
            const k = Math.min(4, st.fire.length);
            sb.set('fireCount', k, base);
            for (let q = 0; q < k; q++) {
              const c = st.fire[q];
              sb.f32[base + 32 + q * 4] = c.kind; sb.f32[base + 32 + q * 4 + 1] = c.owner;
              sb.f32[base + 32 + q * 4 + 2] = c.damage; sb.f32[base + 32 + q * 4 + 3] = c.blastCells;
              sb.f32[base + 48 + q] = c.side;
            }
          }
        });
        const e1 = newEntry(h, 0);
        stepEntries.push({ e0, e1, fire: first && st.fire?.length > 0 });
        this.simTime += h;
      }
      this.tick++;
    }
    const lastEntry = entry > 0 ? entry - 1 : newEntry(1 / 120, 0);
    d.queue.writeBuffer(this.stepBuffer, 0, sb.buffer, 0, entry * STEP_STRIDE);
    // liczniki klatki (kontakty, pary, zgniecione węzły) od zera; skumulowane zostają
    d.queue.writeBuffer(this.buffers.counters, COUNTER.contacts * 4, new Uint32Array([0]));
    d.queue.writeBuffer(this.buffers.counters, COUNTER.pairs * 4, new Uint32Array([0, 0, 0]));
    d.queue.writeBuffer(this.buffers.counters, COUNTER.crushNodes * 4, new Uint32Array([0]));
    const snapshot = this._topo.request && !this._topo.pending;
    if (snapshot) d.queue.writeBuffer(this.buffers.bodyEvents, 0, new Uint32Array(MAX_BODIES));
    if (plan.camera) this._writeCamera(plan.camera);

    const enc = d.createCommandEncoder({ label: 'klatka' });
    // Profilowanie (this.profile): każdy dispatch we własnym przebiegu ze znacznikami czasu —
    // wolniej, ale daje czas karty na kernel. Normalnie jeden przebieg na całą fizykę klatki.
    const prof = this.profile && this.timestamps ? this._profileBegin() : null;
    let pass = prof ? null : enc.beginComputePass({ label: 'fizyka', timestampWrites: this.timestamps
      ? { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined });
    const use = (name) => {
      if (!prof) return pass;
      if (pass) pass.end();
      const q = prof.names.length;
      if (q * 2 + 2 > prof.capacity) { pass = enc.beginComputePass(); prof.dropped++; return pass; }
      prof.names.push(name);
      pass = enc.beginComputePass({ label: name, timestampWrites: { querySet: prof.querySet, beginningOfPassWriteIndex: q * 2, endOfPassWriteIndex: q * 2 + 1 } });
      return pass;
    };
    const N = this.nodeCount, B = this.beamCount;
    const nodesWG = Math.ceil(N / WG), beamsWG = Math.ceil(B / WG);
    const bodiesWG = Math.ceil(this.bodyCount / WG);
    const hashWG = Math.ceil(this.hashSize / 256);
    const run = (name, x, e, y = 1) => {
      const k = this.kernels[name];
      use(name);
      pass.setPipeline(k.pipeline);
      pass.setBindGroup(0, k.bindGroup);
      pass.setBindGroup(1, this.paramsBG, [e * STEP_STRIDE]);
      if (k.extra === 'camera') pass.setBindGroup(2, this.cameraBG);
      if (x > 0 && y > 0) { pass.dispatchWorkgroups(x, y); dispatches++; }
    };
    const runIndirect = (name, argsOffset, e) => {
      const k = this.kernels[name];
      use(name);
      pass.setPipeline(k.pipeline);
      pass.setBindGroup(0, k.bindGroup);
      pass.setBindGroup(1, this.paramsBG, [e * STEP_STRIDE]);
      pass.dispatchWorkgroupsIndirect(this.buffers.dispatchArgs, argsOffset);
      dispatches++;
    };

    if (topoApply) this._encodeTopology(topoApply, run, nodesWG);
    if (repairEntry >= 0) {
      run('repairBeams', beamsWG, repairEntry);
      run('repairNodes', nodesWG, repairEntry);
    }
    if (staticEntry >= 0) {
      run('clearStatic', Math.ceil(this.staticHashSize / 256), staticEntry);
      run('insertStatic', nodesWG, staticEntry);
    }

    const iters = Math.max(1, cfg.solverIterations | 0);
    const gs = this.kernels.gsColor;
    for (const { e0, e1, fire } of stepEntries) {
      run('integrate', bodiesWG, e0);
      if (plan.weaponsActive) {
        if (fire) run('fire', 1, e0);
        run('weaponReset', 1, e0);
        run('blasts', 1, e0);
        run('projectiles', PROJECTILES, e0);
        run('impactArgs', 1, e0);
        runIndirect('impactNodes', 6 * 4, e0);
        runIndirect('impactBeams', 9 * 4, e0);
        runIndirect('deaths', 6 * 4, e0);
        runIndirect('integrity', 6 * 4, e0);
        runIndirect('deaths', 6 * 4, e0);
      }
      run('bodyEvents', bodiesWG, e0);
      run('predict', nodesWG, e0);
      run('prepare', beamsWG, e0);
      if (this.gsGroups > 0) run('gsGroup', this.gsGroups, e0);
      if (this.colorRanges.length) {
        let gsBound = false;
        for (let it = 0; it < iters; it++) {
          for (let c = 0; c < this.colorRanges.length; c++) {
            const range = this.colorRanges[c];
            if (range.count === 0) continue;
            if (prof || !gsBound) {
              use('gsColor');
              pass.setPipeline(gs.pipeline);
              pass.setBindGroup(0, gs.bindGroup);
              pass.setBindGroup(1, this.paramsBG, [e0 * STEP_STRIDE]);
              gsBound = true;
            }
            pass.setBindGroup(2, this.colorBG, [c * COLOR_STRIDE]);
            pass.dispatchWorkgroups(Math.ceil(range.count / WG));
            dispatches++;
          }
        }
      }
      run('velocity', nodesWG, e0);
      run('reducePartial', this.reduceStride, e0, this.bodyCount);
      run('reduceFinal', this.bodyCount, e0);
      run('nearFlags', bodiesWG, e0);
      for (let pass2 = 0; pass2 < 2; pass2++) {
        const e = pass2 === 0 ? e0 : e1;
        run('collideReset', 1, e);
        run('clearGrid', hashWG, e);
        run('insert', nodesWG, e);
        run('narrow', nodesWG, e);
        run('pairArgs', 1, e);
        runIndirect('pairAggregate', 0, e);
        run('response', 1, e);
        if (pass2 === 0) {
          runIndirect('crushMark', 3 * 4, e);
          runIndirect('crushApply', 3 * 4, e);
        }
      }
    }
    // kamera na GPU (środek widoku z ciała, bez opóźnienia odczytu)
    if (plan.camera) run('camera', 1, lastEntry);
    if (snapshot) run('topoPack', Math.ceil(this.topoWords / WG), lastEntry);
    if (pass) pass.end();
    if (prof) this._profileEnd(enc, prof);

    if (snapshot) {
      enc.copyBufferToBuffer(this.buffers.topoBits, 0, this.topoStaging, 0, this.topoWords * 4);
      this._topo.request = false;
      this._topo.pending = true;
      this._topo.job = { dirty: this._topo.dirtyBodies || [], tick: this.tick };
    }
    this.stats.dispatches = dispatches;
    this.stats.substeps = stepEntries.length;
    this.stats.steps = plan.steps.length;
    this.stats.encodeMs = performance.now() - t0;
    return enc;
  }

  _profileBegin() {
    const capacity = 4096;
    if (!this._profQS) {
      this._profQS = this.device.createQuerySet({ type: 'timestamp', count: capacity });
      this._profResolve = this.device.createBuffer({ size: capacity * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    }
    return { names: [], querySet: this._profQS, capacity, dropped: 0 };
  }

  _profileEnd(enc, prof) {
    const n = prof.names.length;
    if (!n) return;
    enc.resolveQuerySet(prof.querySet, 0, n * 2, this._profResolve, 0);
    const staging = this.device.createBuffer({ size: n * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    enc.copyBufferToBuffer(this._profResolve, 0, staging, 0, n * 16);
    this._profPending = { staging, names: prof.names.slice() };
  }

  /** Po submit w trybie profilu: czasy karty na kernel (suma i liczba wywołań) dopisane do this.profileAcc. */
  async collectProfile() {
    const p = this._profPending;
    this._profPending = null;
    if (!p) return null;
    await p.staging.mapAsync(GPUMapMode.READ);
    const ts = new BigUint64Array(p.staging.getMappedRange().slice(0));
    p.staging.unmap();
    p.staging.destroy();
    const acc = this.profileAcc ||= {};
    for (let i = 0; i < p.names.length; i++) {
      const ms = Number(ts[i * 2 + 1] - ts[i * 2]) / 1e6;
      if (!(ms >= 0 && ms < 1000)) continue;
      const a = acc[p.names[i]] ||= { ms: 0, calls: 0 };
      a.ms += ms;
      a.calls++;
    }
    return acc;
  }

  _writeCamera(cam) {
    const u = new Uint32Array(this.camInData), f = new Float32Array(this.camInData);
    u[0] = cam.mode; u[1] = cam.a || 0; u[2] = cam.b || 0; u[3] = 0;
    const hx = hiOf(cam.freeX || 0), hy = hiOf(cam.freeY || 0);
    f[4] = hx; f[5] = hy; f[6] = (cam.freeX || 0) - hx; f[7] = (cam.freeY || 0) - hy;
    f[8] = cam.offsetX || 0; f[9] = cam.offsetY || 0; f[10] = 0; f[11] = 0;
    this.device.queue.writeBuffer(this.camInBuffer, 0, this.camInData);
  }

  // ------------------------------------------------------------------ odczyty

  /** Kopia stanu ciał, liczników i czasów GPU do odczytu — kodować PO przebiegu renderu. */
  encodeReadback(enc) {
    let slot = this._ring.find((r) => !r.busy && !r.dead);
    if (!slot && this._ring.length < READBACK_RING) {
      const size = MAX_BODIES * BODY_FLOATS * 4 + COUNTERS * 4 + MAX_BODIES * 4 + 64 + 32;
      slot = { buffer: this.device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, label: 'odczyt' }),
        busy: false, dead: false, size };
      this._ring.push(slot);
    }
    if (!slot) return;
    const bodyBytes = MAX_BODIES * BODY_FLOATS * 4;
    enc.copyBufferToBuffer(this.buffers.bodies, 0, slot.buffer, 0, this.bodyCount * BODY_FLOATS * 4);
    enc.copyBufferToBuffer(this.buffers.counters, 0, slot.buffer, bodyBytes, COUNTERS * 4);
    enc.copyBufferToBuffer(this.buffers.bodyEvents, 0, slot.buffer, bodyBytes + COUNTERS * 4, MAX_BODIES * 4);
    enc.copyBufferToBuffer(this.buffers.camState, 0, slot.buffer, bodyBytes + COUNTERS * 4 + MAX_BODIES * 4, 16);
    if (this.timestamps) {
      enc.resolveQuerySet(this.querySet, 0, 4, this.queryResolve, 0);
      enc.copyBufferToBuffer(this.queryResolve, 0, slot.buffer, bodyBytes + COUNTERS * 4 + MAX_BODIES * 4 + 64, 32);
    }
    slot.busy = true;
    slot.pendingMap = true;
    slot.bodyCount = this.bodyCount;
    slot.tick = this.tick;
    slot.steps = this.stats.steps;
    slot.substeps = this.stats.substeps;
    slot.dispatches = this.stats.dispatches;
    slot.seq = (this._seq = (this._seq || 0) + 1);
    this._lastSlot = slot;
  }

  /** Po queue.submit: mapuje odczyty (asynchronicznie) i obsługuje topologię. */
  afterSubmit() {
    const slot = this._lastSlot;
    this._lastSlot = null;
    if (slot && slot.pendingMap) {
      slot.pendingMap = false;
      this.lastMap = slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
        if (slot.dead) return;
        this._parseReadback(slot);
        slot.buffer.unmap();
        slot.busy = false;
      }).catch(() => { slot.busy = false; });
    }
    if (this._topo.pending && this._topo.job && !this._topo.job.mapping) {
      const job = this._topo.job;
      job.mapping = true;
      this.topoStaging.mapAsync(GPUMapMode.READ).then(() => {
        const bits = new Uint32Array(this.topoStaging.getMappedRange().slice(0));
        this.topoStaging.unmap();
        if (this._topo.job !== job) return;
        this._topo.pending = false;
        this._topo.job = null;
        this._runSplits(bits, job);
      }).catch(() => { this._topo.pending = false; this._topo.job = null; });
    }
  }

  _parseReadback(slot) {
    const raw = slot.buffer.getMappedRange();
    const bodyBytes = MAX_BODIES * BODY_FLOATS * 4;
    const f = new Float32Array(raw, 0, slot.bodyCount * BODY_FLOATS);
    const u = new Uint32Array(raw, 0, slot.bodyCount * BODY_FLOATS);
    const counters = new Uint32Array(raw, bodyBytes, COUNTERS);
    const events = new Uint32Array(raw, bodyBytes + COUNTERS * 4, MAX_BODIES);
    const cam = new Float32Array(raw, bodyBytes + COUNTERS * 4 + MAX_BODIES * 4, 4);
    const bodies = [];
    for (let i = 0; i < slot.bodyCount; i++) {
      const b = i * BODY_FLOATS;
      bodies.push({
        x: f[b] + f[b + 2], y: f[b + 1] + f[b + 3], vx: f[b + 4], vy: f[b + 5], angle: f[b + 6], w: f[b + 7],
        mass: f[b + 8], invI: f[b + 10], bounds: [f[b + 12], f[b + 13], f[b + 14], f[b + 15]],
        radius: f[b + 20], maxDisp: f[b + 21], cellSize: f[b + 22],
        listStart: u[b + 28], listCount: u[b + 29], activeNodes: u[b + 30], flags: u[b + 32],
        sleeping: !!(u[b + 32] & BODY.SLEEP), dead: !!(u[b + 32] & BODY.DEAD), isStatic: !!(u[b + 32] & BODY.STATIC),
        isWreck: !!(u[b + 32] & BODY.WRECK), used: !!(u[b + 32] & BODY.USED), instance: u[b + 35], events: events[i]
      });
    }
    const state = { tick: slot.tick, seq: slot.seq, steps: slot.steps, substeps: slot.substeps, dispatches: slot.dispatches,
      bodies, counters: Array.from(counters), camera: { x: cam[0] + cam[2], y: cam[1] + cam[3] } };
    if (this.timestamps) {
      const ts = new BigUint64Array(raw, bodyBytes + COUNTERS * 4 + MAX_BODIES * 4 + 64, 4);
      const phys = Number(ts[1] - ts[0]) / 1e6;
      const rend = Number(ts[3] - ts[2]) / 1e6;
      state.gpuPhysicsMs = phys >= 0 && phys < 1e4 ? phys : NaN;
      state.gpuRenderMs = rend >= 0 && rend < 1e4 ? rend : NaN;
    }
    this.state = state;
    // rozpady: ciała z nowymi zerwaniami → migawka flag co splitCheckInterval kroków
    if (!this._topo.pending && !this._topo.request && this.tick - this._topo.lastTick >= (this.scene.cfg.splitCheckInterval || 10)) {
      const dirty = [];
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if ((b.events & 4) && b.used && !b.dead && !b.isStatic && !(b.flags & BODY.NOSPLIT)) dirty.push(i);
      }
      if (dirty.length) {
        this._topo.request = true;
        this._topo.dirtyBodies = dirty;
        this._topo.lastTick = this.tick;
      }
    }
  }

  // ------------------------------------------------------------------ rozpady (CPU)

  _runSplits(bits, job) {
    const T = this.topology;
    const beamWords = Math.ceil(this.beamCount / 32);
    const broken = T.broken, active = T.active;
    for (let e = 0; e < this.beamCount; e++) broken[e] = (bits[e >>> 5] >>> (e & 31)) & 1;
    for (let i = 0; i < this.nodeCount; i++) active[i] = (bits[beamWords + (i >>> 5)] >>> (i & 31)) & 1;
    const cfg = this.scene.cfg;
    const breakBeams = [], doomNodes = [], ops = [], newBodies = [];
    let wrecks = 0;
    for (let bi = 0; bi < this.bodyCount; bi++) {
      const b = this.state?.bodies[bi];
      if (b?.isWreck && !b.dead) wrecks++;
    }
    let nextBody = this.bodyCount;
    let listUsed = this.listUsed;
    for (const bi of job.dirty) {
      const list = T.lists[bi];
      if (!list || list.nodes.length === 0) continue;
      const nodes = list.nodes;
      // 1) mosty rozdartych usztywnień (detachTornJoints)
      if (cfg.breakEnabled && cfg.detachTornJoints) {
        const bridges = this._bridges(bi, nodes);
        for (const e of bridges) {
          if (T.restBridge[e]) continue;
          broken[e] = 1;
          breakBeams.push(e);
        }
      }
      // 2) wyspy po całych belkach
      const groups = this._islands(bi, nodes);
      if (groups.length <= 1) continue;
      groups.sort((a, b) => b.length - a.length);
      let fragments = 0;
      const parentOp = { body: bi, parent: bi, isWreck: 0, nodes: groups[0] };
      for (let g = 1; g < groups.length; g++) {
        const grp = groups[g];
        if (grp.length < Math.max(2, cfg.splitMinNodes | 0) || fragments >= cfg.splitMaxFragments ||
            wrecks >= cfg.maxWrecks || nextBody >= MAX_BODIES || listUsed + grp.length > this.listCapacity) {
          for (const i of grp) doomNodes.push(i);
          continue;
        }
        const wb = nextBody++;
        fragments++;
        wrecks++;
        newBodies.push({ body: wb, parent: bi, start: listUsed, nodes: grp });
        ops.push({ body: wb, parent: bi, isWreck: 1, nodes: grp, start: listUsed });
        listUsed += grp.length;
      }
      ops.push(parentOp);
    }
    if (!breakBeams.length && !doomNodes.length && !ops.length) return;
    this._topo.apply = { breakBeams, doomNodes, ops, newBodies, bodyCount: nextBody, listUsed };
  }

  // Tarjan iteracyjnie po liście węzłów ciała (findBeamBridgesStore na podzbiorze).
  _bridges(bi, nodes) {
    const T = this.topology;
    const n = nodes.length;
    const local = this._scratchMap(this.nodeCount);
    for (let k = 0; k < n; k++) local[nodes[k]] = k;
    const order = new Int32Array(n), low = new Int32Array(n), parent = new Int32Array(n).fill(-1);
    const cursor = new Int32Array(n), stack = new Int32Array(n);
    const out = [];
    let time = 0;
    for (let root = 0; root < n; root++) {
      if (!T.active[nodes[root]] || order[root]) continue;
      let top = 0;
      stack[0] = root; order[root] = low[root] = ++time;
      while (top >= 0) {
        const node = stack[top], g = nodes[node];
        const first = T.adjStart[g], degree = T.adjStart[g + 1] - first;
        if (cursor[node] < degree) {
          const edge = T.adj[first + cursor[node]++];
          if (T.broken[edge] || edge === parent[node]) continue;
          const og = T.beamA[edge] === g ? T.beamB[edge] : T.beamA[edge];
          if (!T.active[og] || T.nodeBody[og] !== bi) continue;
          const other = local[og];
          if (other < 0) continue;
          if (!order[other]) {
            parent[other] = edge; order[other] = low[other] = ++time;
            stack[++top] = other;
          } else low[node] = Math.min(low[node], order[other]);
        } else {
          top--;
          const edge = parent[node];
          if (edge < 0) continue;
          const og = T.beamA[edge] === g ? T.beamB[edge] : T.beamA[edge];
          const other = local[og];
          if (low[node] > order[other]) out.push(edge);
          low[other] = Math.min(low[other], low[node]);
        }
      }
    }
    for (let k = 0; k < n; k++) local[nodes[k]] = -1;
    return out;
  }

  _islands(bi, nodes) {
    const T = this.topology;
    const seen = this._scratchMap(this.nodeCount, true);
    const groups = [];
    const stack = [];
    for (const seed of nodes) {
      if (!T.active[seed] || seen[seed] === 1 || T.nodeBody[seed] !== bi) continue;
      const group = [];
      stack.length = 0;
      stack.push(seed);
      seen[seed] = 1;
      while (stack.length) {
        const cur = stack.pop();
        group.push(cur);
        for (let q = T.adjStart[cur]; q < T.adjStart[cur + 1]; q++) {
          const e = T.adj[q];
          if (T.broken[e]) continue;
          const o = T.beamA[e] === cur ? T.beamB[e] : T.beamA[e];
          if (!T.active[o] || seen[o] === 1 || T.nodeBody[o] !== bi) continue;
          seen[o] = 1;
          stack.push(o);
        }
      }
      group.sort((a, b) => a - b);
      groups.push(group);
    }
    for (const g of groups) for (const i of g) seen[i] = 0;
    return groups;
  }

  _scratchMap(n, zero = false) {
    if (zero) {
      if (!this._seen || this._seen.length < n) this._seen = new Uint8Array(n);
      return this._seen;
    }
    if (!this._local || this._local.length < n) this._local = new Int32Array(n).fill(-1);
    return this._local;
  }

  _uploadTopology(t, newEntry) {
    const d = this.device;
    const T = this.topology;
    // lista rozkazów: [nBreak, belki…, nDoom, węzły…]
    const list = new Uint32Array(2 + t.breakBeams.length + t.doomNodes.length);
    list[0] = t.breakBeams.length;
    list.set(t.breakBeams, 1);
    list[1 + t.breakBeams.length] = t.doomNodes.length;
    list.set(t.doomNodes, 2 + t.breakBeams.length);
    d.queue.writeBuffer(this.buffers.topoList, 0, list);
    const opsData = new Uint32Array(TOPO_OPS * 4);
    const wreckOps = t.ops.filter((o) => o.isWreck), parentOps = t.ops.filter((o) => !o.isWreck);
    const ordered = [...wreckOps, ...parentOps].slice(0, TOPO_OPS);
    ordered.forEach((o, k) => { opsData[k * 4] = o.body; opsData[k * 4 + 1] = o.parent; opsData[k * 4 + 2] = o.isWreck; opsData[k * 4 + 3] = o.nodes.length; });
    d.queue.writeBuffer(this.buffers.topoOps, 0, opsData);
    // listy węzłów i rekordy ciał
    const rec = new Float32Array(BODY_FLOATS), recU = new Uint32Array(rec.buffer);
    let maxList = 0;
    for (const o of ordered) {
      maxList = Math.max(maxList, o.nodes.length);
      const start = o.isWreck ? o.start : T.lists[o.body].start;
      d.queue.writeBuffer(this.buffers.nodeLists, start * 4, new Uint32Array(o.nodes));
      T.lists[o.body] = { start, nodes: Int32Array.from(o.nodes) };
      for (const i of o.nodes) T.nodeBody[i] = o.body;
      if (o.isWreck) {
        const parentState = this.state?.bodies[o.parent];
        rec.fill(0);
        recU[28] = start; recU[29] = o.nodes.length; recU[30] = o.nodes.length;
        recU[32] = BODY.USED | BODY.WRECK;
        recU[35] = this.scene.bodies[this.topology.bodyInstance[o.parent]] ? this.topology.bodyInstance[o.parent] : 0;
        rec[22] = parentState?.cellSize || this.scene.bodies[0].hull.cellSize;
        rec[11] = 1;
        rec[24] = 1;
        rec[27] = -1e9;
        this.topology.bodyInstance[o.body] = this.topology.bodyInstance[o.parent];
        d.queue.writeBuffer(this.buffers.bodies, o.body * BODY_FLOATS * 4, rec);
      } else {
        d.queue.writeBuffer(this.buffers.bodies, (o.body * BODY_FLOATS + 28) * 4, new Uint32Array([start, o.nodes.length]));
      }
    }
    this.bodyCount = Math.max(this.bodyCount, t.bodyCount);
    this.listUsed = t.listUsed;
    this._writeConfig();
    t.ordered = ordered;
    t.wreckCount = wreckOps.length;
    t.parentCount = Math.min(parentOps.length, TOPO_OPS - wreckOps.length);
    t.maxList = maxList;
    t.entries = {
      base: newEntry(1 / 120, 0),
      wrecks: newEntry(1 / 120, 0, (base) => this.stepBlock.set('opOffset', 0, base)),
      parents: newEntry(1 / 120, 0, (base) => this.stepBlock.set('opOffset', t.wreckCount, base))
    };
  }

  _encodeTopology(t, run, nodesWG) {
    const e = t.entries.base;
    const nBreak = t.breakBeams.length, nDoom = t.doomNodes.length;
    if (nBreak) run('topoBreak', Math.ceil(nBreak / WG), e);
    if (nDoom) {
      run('topoDoom', Math.ceil(nDoom / WG), e);
      run('deaths', nodesWG, e);
    }
    const ops = t.ordered.length;
    if (ops) {
      const chunks = Math.ceil(Math.max(1, t.maxList) / WG);
      run('topoAssign', chunks, e, ops);
      run('topoCut', chunks, e, ops);
      if (t.wreckCount) run('reseat', t.wreckCount, t.entries.wrecks);
      if (t.parentCount) run('reseat', t.parentCount, t.entries.parents);
    }
  }

  // ------------------------------------------------------------------ pełny odczyt (testy, porównania)

  async readAll(names = ['bodies', 'posVel', 'restMass', 'nodeInfo', 'beamFlags', 'beamLen', 'counters']) {
    const d = this.device;
    const enc = d.createCommandEncoder();
    const staging = {};
    for (const name of names) {
      const src = this.buffers[name];
      const buf = d.createBuffer({ size: src.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      enc.copyBufferToBuffer(src, 0, buf, 0, src.size);
      staging[name] = buf;
    }
    d.queue.submit([enc.finish()]);
    const out = {};
    for (const [name, buf] of Object.entries(staging)) {
      await buf.mapAsync(GPUMapMode.READ);
      out[name] = buf.getMappedRange().slice(0);
      buf.unmap();
      buf.destroy();
    }
    return out;
  }
}
