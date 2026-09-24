// Lustro CPU solvera sprężyn GPU (src/game/destructorGpuSoftBody.js) dla
// benchmarku rdzenia. W grze z WebGPU solver rwie heksy rozciągnięte ponad
// tearThreshold i odkształcone ponad maxDeform — bez niego (node, brak WebGPU)
// ciężkie trafienia tylko odpychają heksy o setki px: pocisk trafia potem
// w „heks-ducha” (sweep widzi przesuniętą pozycję, sonda applyImpact szuka
// po komórce i nie znajduje), więc kanał przestaje rosnąć.
//
// Port 1:1 w matematyce kernela (WGSL main) i nakładaniu wyniku (_applyResult),
// harmonogram jak DestructorGpuSoftBody.tick (zegar w czasie gry gpuSoftBodyHz,
// gorąca encja, forcedAwake, interwał dispatchy, liczba iteracji).
//
// Opóźnienie wyniku jak na GPU (latencyTicks, domyślnie 1): kernel liczy z
// migawki w chwili dispatchu, a wynik nakłada się na początku NASTĘPNEGO ticku
// (w grze: odczyt mapAsync wraca przed kolejną klatką). Nakładanie miesza
// 0,35·bieżący + 0,65·wynik i nadpisuje __vel, więc ~65% uderzeń CPU z czasu
// „w locie” przepada — tak jak w grze (AGENT: TODO nad _applyResult w
// destructorGpuSoftBody.js). Synchroniczne lustro (latencyTicks 0) niczego nie
// gubiło i wgniatało głębiej: rdzeń wychodził 25–75% tańszy niż na WebGPU.
import { DestructorSystem } from '../src/game/destructor.js';

const STRIDE = 8;

// Kopia markGridMeshDirtyRange z destructorGpuSoftBody.js (tam też jest lokalna):
// podbija rewizję siatki i zakresy uploadu/lerpu tylko dla zmienionych heksów.
function markDirtyRange(grid, start, end) {
  if (!grid || end < start) return;
  const next = (Number(grid.meshRevision) || 0) + 1;
  grid.meshRevision = next > 1000000000 ? 1 : next;
  grid.meshDirty = true;
  if (!grid.visualDirtyAll) {
    const vs = Number(grid.visualDirtyStart), ve = Number(grid.visualDirtyEnd);
    if (!Number.isFinite(vs) || !Number.isFinite(ve) || vs < 0 || ve < vs) { grid.visualDirtyStart = start; grid.visualDirtyEnd = end; }
    else { if (start < vs) grid.visualDirtyStart = start; if (end > ve) grid.visualDirtyEnd = end; }
  }
  if (grid.meshDirtyAll) return;
  const cs = Number(grid.meshDirtyStart), ce = Number(grid.meshDirtyEnd);
  if (!Number.isFinite(cs) || !Number.isFinite(ce) || cs < 0 || ce < cs) { grid.meshDirtyStart = start; grid.meshDirtyEnd = end; return; }
  if (start < cs) grid.meshDirtyStart = start;
  if (end > ce) grid.meshDirtyEnd = end;
}

function isHot(entity, sampleLimit, threshold) {
  if ((Number(entity._gpuForceAwakeFrames) || 0) > 0) return true;
  const shards = entity?.hexGrid?.shards;
  if (!Array.isArray(shards) || shards.length === 0) return false;
  const count = shards.length;
  const limit = Math.max(8, sampleLimit | 0);
  const step = Math.max(1, Math.floor(count / limit));
  const defT = Math.max(0.02, threshold);
  const velT = Math.max(0.02, defT * 0.8);
  let sampled = 0;
  for (let i = 0; i < count && sampled < limit; i += step, sampled++) {
    const s = shards[i];
    if (!s || !s.active || s.isDebris) continue;
    const dx = Math.abs((s.targetDeformation?.x || 0) - (s.deformation?.x || 0));
    const dy = Math.abs((s.targetDeformation?.y || 0) - (s.deformation?.y || 0));
    const vx = Math.abs(s.__velX || 0) + Math.abs(s.__collVelX || 0);
    const vy = Math.abs(s.__velY || 0) + Math.abs(s.__collVelY || 0);
    if (dx > defT || dy > defT || vx > velT || vy > velT) return true;
  }
  return false;
}

function buildNeighbors(shards) {
  const count = shards.length;
  const data = new Int32Array(count * 6).fill(-1);
  const index = new Map();
  for (let i = 0; i < count; i++) index.set(shards[i], i);
  for (let i = 0; i < count; i++) {
    const n = shards[i]?.neighbors;
    if (!Array.isArray(n)) continue;
    for (let k = 0; k < Math.min(6, n.length); k++) {
      const idx = index.get(n[k]);
      if (Number.isInteger(idx)) data[i * 6 + k] = idx;
    }
  }
  return data;
}

// Kernel WGSL `main` przepisany na JS (ta sama kolejność działań).
function kernel(inData, outData, neighbors, count, p) {
  for (let idx = 0; idx < count; idx++) {
    const b = idx * STRIDE;
    const defX = inData[b], defY = inData[b + 1], velX = inData[b + 2], velY = inData[b + 3];
    const origX = inData[b + 4], origY = inData[b + 5], hp = inData[b + 6], flags = inData[b + 7];
    if (flags < 0.5 || hp <= 0) {
      for (let k = 0; k < STRIDE; k++) outData[b + k] = inData[b + k];
      continue;
    }
    const stiffness = Math.max(0, p.k);
    let fx = 0, fy = 0;
    let newHp = hp;
    const myX = origX + defX, myY = origY + defY;
    let active = 0;
    let maxStretch = 0;
    for (let i = 0; i < 6; i++) {
      const nIdx = neighbors[idx * 6 + i];
      if (nIdx < 0) continue;
      const nb = nIdx * STRIDE;
      if (inData[nb + 7] < 0.5 || inData[nb + 6] <= 0) continue;
      active++;
      const nX = inData[nb + 4] + inData[nb];
      const nY = inData[nb + 5] + inData[nb + 1];
      const exX = inData[nb + 4] - origX;
      const exY = inData[nb + 5] - origY;
      const rest = Math.hypot(exX, exY);
      if (rest <= 0.001) continue;
      const dirX = exX / rest, dirY = exY / rest;
      const ax = nX - myX, ay = nY - myY;
      let proj = ax * dirX + ay * dirY;
      const minProj = rest * 0.22;
      if (proj < minProj) proj = minProj;
      const diff = proj - rest;
      let force = diff * stiffness;
      let bulgeX = 0, bulgeY = 0;
      if (diff < 0) {
        force *= 3.2;
        if (-diff > maxStretch) maxStretch = -diff;
        if (diff < -rest * 0.12 && proj > rest * 0.45) {
          const perpX = -dirY, perpY = dirX;
          const lateral = ax * perpX + ay * perpY;
          let bdir = Math.sign(lateral);
          if (bdir === 0) bdir = 1;
          const bmag = Math.min((-diff) * stiffness * 0.8, rest * stiffness * 0.45);
          bulgeX = perpX * bdir * bmag;
          bulgeY = perpY * bdir * bmag;
        }
      } else {
        force *= 0.9;
        if (diff > maxStretch) maxStretch = diff;
      }
      fx += dirX * force + bulgeX;
      fy += dirY * force + bulgeY;
      const rvx = inData[nb + 2] - velX, rvy = inData[nb + 3] - velY;
      const axial = rvx * dirX + rvy * dirY;
      const perpX = -dirY, perpY = dirX;
      const shear = rvx * perpX + rvy * perpY;
      fx += dirX * axial * 0.30 + perpX * shear * 0.15;
      fy += dirY * axial * 0.30 + perpY * shear * 0.15;
    }
    const norm = Math.sqrt(Math.max(1, active));
    fx /= norm; fy /= norm;
    let nvx = (velX + fx) * p.damping;
    let nvy = (velY + fy) * p.damping;
    if (active < 2) { nvx *= 0.1; nvy *= 0.1; }
    const vlen = Math.hypot(nvx, nvy);
    if (vlen > 180) { nvx = nvx / vlen * 180; nvy = nvy / vlen * 180; }
    let ndx = defX + nvx, ndy = defY + nvy;
    const ndl = Math.hypot(ndx, ndy);
    if (ndl > p.maxDeform) {
      const scl = p.maxDeform / Math.max(0.0001, ndl);
      ndx *= scl; ndy *= scl;
      newHp = 0;
    }
    if (maxStretch > p.tearThreshold || ndl > p.maxDeform) newHp = 0;
    if (Math.abs(nvx) < 0.03 && Math.abs(nvy) < 0.03 && Math.abs(ndx - defX) < 0.03) { nvx = 0; nvy = 0; }
    outData[b] = ndx; outData[b + 1] = ndy; outData[b + 2] = nvx; outData[b + 3] = nvy;
    outData[b + 4] = origX; outData[b + 5] = origY; outData[b + 6] = newHp; outData[b + 7] = flags;
  }
}

export function createCpuSoftBody(options = {}) {
  const states = new WeakMap();
  const latencyTicks = Math.max(0, Number.isFinite(options.latencyTicks) ? options.latencyTicks | 0 : 1);
  // Wyniki „w locie”: { entity, st, shardsRef, count, data, due } — nakładane
  // na początku ticku, jak kolejka _resultsQueue na GPU (najstarszy pierwszy).
  const queue = [];
  const pool = [];
  let tickCalls = 0;
  let tickId = 0;
  let cursor = 0;
  let solverAcc = 0;
  const stats = { dispatches: 0, tears: 0, steps: 0, latencyTicks };

  function state(entity) {
    const shards = entity.hexGrid.shards;
    let st = states.get(entity);
    if (!st || st.shardsRef !== shards || st.count !== shards.length) {
      st = {
        shardsRef: shards, count: shards.length, cooldown: 0, idle: 0,
        a: new Float32Array(shards.length * STRIDE), b: new Float32Array(shards.length * STRIDE),
        neighbors: buildNeighbors(shards)
      };
      states.set(entity, st);
    }
    return st;
  }

  function dispatch(entity, st, k, damping, config) {
    const shards = st.shardsRef;
    const count = st.count;
    const data = st.a;
    for (let i = 0; i < count; i++) {
      const s = shards[i];
      const base = i * STRIDE;
      const bakedX = Number(s?._bakedOffX) || 0;
      const bakedY = Number(s?._bakedOffY) || 0;
      const pristineX = Number(s?._pristineX) || (Number(s?.gridX) || 0) - bakedX;
      const pristineY = Number(s?._pristineY) || (Number(s?.gridY) || 0) - bakedY;
      if (s && s._pristineX === undefined) { s._pristineX = pristineX; s._pristineY = pristineY; }
      data[base] = (Number(s?.targetDeformation?.x) || 0) + bakedX;
      data[base + 1] = (Number(s?.targetDeformation?.y) || 0) + bakedY;
      data[base + 2] = (Number(s?.__velX) || 0) + (Number(s?.__collVelX) || 0);
      data[base + 3] = (Number(s?.__velY) || 0) + (Number(s?.__collVelY) || 0);
      if (s) { s.__collVelX = 0; s.__collVelY = 0; }
      data[base + 4] = pristineX;
      data[base + 5] = pristineY;
      data[base + 6] = Number(s?.hp) || 0;
      data[base + 7] = (s?.active && !s?.isDebris) ? 1 : 0;
    }
    const forced = (Number(entity._gpuForceAwakeFrames) || 0) > 0;
    const crash = Math.max(256, Number(config?.gpuSoftBodyCrashShardThreshold) || 1200);
    let iters = 3;
    if (forced && count >= crash) iters = Math.max(1, Number(config?.gpuSoftBodyCrashIters) || 1);
    else if (forced && count >= Math.floor(crash * 0.6)) iters = 2;
    const massDampMul = 0.75 + 0.25 * Math.min(1, 200 / count);
    const dispatchDamping = Math.max(0.05, damping.base) * Math.pow(massDampMul, damping.frames);
    const clampedK = Math.min(0.999, Math.max(0, k));
    const p = {
      k: iters > 1 ? (1 - Math.pow(1 - clampedK, 1 / iters)) : clampedK,
      maxDeform: Math.max(1, Number(config?.maxDeform) || 200),
      damping: Math.max(0.1, iters > 1 ? Math.pow(dispatchDamping, 1 / iters) : dispatchDamping),
      tearThreshold: Number(config?.tearThreshold) || 150
    };
    let src = st.a, dst = st.b;
    for (let it = 0; it < iters; it++) {
      kernel(src, dst, st.neighbors, count, p);
      const t = src; src = dst; dst = t;
    }
    stats.dispatches++;
    if (latencyTicks <= 0) { apply(entity, st, src, config); return; }
    let buf = pool.pop();
    if (!buf || buf.length < count * STRIDE) buf = new Float32Array(count * STRIDE);
    buf.set(src.subarray(0, count * STRIDE));
    st.inFlight = true;
    queue.push({ entity, st, shardsRef: st.shardsRef, count, data: buf, due: tickCalls + latencyTicks });
  }

  // Kolejka wyników na początku każdego ticku (także klatek bez kroku solvera),
  // z tymi samymi odrzutami co _applyResult: martwa encja albo nowa siatka.
  function drainQueue(config) {
    while (queue.length && queue[0].due <= tickCalls) {
      const res = queue.shift();
      res.st.inFlight = false;
      const e = res.entity;
      if (!e.dead && e.hexGrid && e.hexGrid.shards === res.shardsRef) apply(e, res.st, res.data, config);
      pool.push(res.data);
    }
  }

  // _applyResult
  function apply(entity, st, data, config) {
    const shards = st.shardsRef;
    const yieldP = Number(config?.yieldPoint) || 45;
    let lo = Infinity, hi = -1;
    const touch = (i) => { if (i < lo) lo = i; if (i > hi) hi = i; };
    for (let i = 0; i < st.count; i++) {
      const s = shards[i];
      if (!s || !s.active || s.isDebris) continue;
      const base = i * STRIDE;
      const bakedX = Number(s._bakedOffX) || 0;
      const bakedY = Number(s._bakedOffY) || 0;
      const tx = data[base] - bakedX;
      const ty = data[base + 1] - bakedY;
      if (Math.abs(s.targetDeformation.x - tx) > 0.001 || Math.abs(s.targetDeformation.y - ty) > 0.001) {
        s.targetDeformation.x = s.targetDeformation.x * 0.35 + tx * 0.65;
        s.targetDeformation.y = s.targetDeformation.y * 0.35 + ty * 0.65;
        // Jak _applyResult: lista aktywnych sprężystości CPU od nowa.
        if (entity.hexGrid) entity.hexGrid._elasticRescan = true;
        touch(i);
      }
      const stx = s.targetDeformation.x, sty = s.targetDeformation.y;
      const mag = Math.hypot(stx, sty);
      if (mag > yieldP) {
        const ratio = (mag - yieldP) / mag;
        const bx = stx * ratio, by = sty * ratio;
        s._bakedOffX = bakedX + bx;
        s._bakedOffY = bakedY + by;
        s.gridX += bx; s.gridY += by;
        s.deformation.x -= bx; s.deformation.y -= by;
        s.targetDeformation.x -= bx; s.targetDeformation.y -= by;
        touch(i);
      }
      const oldVx = Number(s.__velX) || 0, oldVy = Number(s.__velY) || 0;
      s.__velX = data[base + 2];
      s.__velY = data[base + 3];
      if (Math.abs(oldVx - s.__velX) > 0.03 || Math.abs(oldVy - s.__velY) > 0.03) touch(i);
      if (data[base + 6] <= 0 && s.hp > 0) {
        DestructorSystem.destroyShard(entity, s);
        stats.tears++;
        touch(i);
        if (!entity.noSplit && DestructorSystem.splitQueue.indexOf(entity) === -1) DestructorSystem.splitQueue.push(entity);
      }
    }
    if (hi >= 0 && entity.hexGrid) markDirtyRange(entity.hexGrid, lo, hi);
  }

  // Harmonogram jak DestructorGpuSoftBody.tick (bez kolejki wyników).
  function tick(entities, config, dt) {
    tickCalls++;
    drainQueue(config);
    if ((config?.gpuSoftBody | 0) !== 1) return;
    const tension = Number(config.softBodyTension) || 0.15;
    if (tension <= 0) return;
    // Zegar solvera w czasie gry, 1:1 z DestructorGpuSoftBody.tick (gpuSoftBodyHz):
    // przy klatkach krótszych niż krok czas się zbiera, a krok idzie co
    // 1/gpuSoftBodyHz s; przy ≤ 60 FPS jeden krok z całym zaległym czasem.
    // Stary kod gry nie ma pola gpuSoftBodyHz — wtedy dispatch co klatkę.
    const frameDt = Number.isFinite(dt) ? Math.max(0, dt) : (1 / 120);
    const solverHz = ('gpuSoftBodyHz' in (config || {})) ? Number(config.gpuSoftBodyHz) : 0;
    let step = frameDt;
    if (solverHz > 0) {
      const solverDt = 1 / solverHz;
      const acc = solverAcc + frameDt;
      if (frameDt >= solverDt * 0.9) {
        step = acc;
        solverAcc = 0;
      } else if (acc >= solverDt * 0.9) {
        step = solverDt;
        solverAcc = acc - solverDt;
      } else {
        solverAcc = acc;
        return;
      }
    }
    step = Math.max(0.0001, step);
    tickId = (tickId + 1) | 0;
    stats.steps = (stats.steps || 0) + 1;
    const k = 1 - Math.exp(-tension * step * 120);
    const dampingBase = Math.min(0.999, Math.max(0.7, Number(config?.gpuPropagationDamping) || 0.92));
    const frames = step * 60;
    const damping = { base: Math.pow(dampingBase, frames), frames };
    const minShards = Math.max(16, Number(config.gpuSoftBodyMinShards) || 64);
    const dispatchPerTick = Math.max(1, Math.min(3, Number(config?.gpuSoftBodyDispatchPerTick) || 2));
    const list = Array.isArray(entities) ? entities : [];
    const len = list.length;
    if (cursor < 0 || cursor >= len) cursor = 0;
    let dispatched = 0;
    let scanned = 0;
    for (; scanned < len; scanned++) {
      const entity = list[(cursor + scanned) % len];
      if (!entity?.hexGrid?.shards || entity.dead) continue;
      if (entity.isRingSegment || entity.noGpuSoftBody === true || entity.destructionMaterial === 'brittle') continue;
      const count = entity.hexGrid.shards.length;
      if (count < minShards) continue;
      const grid = entity.hexGrid;
      if (grid.isSleeping && (Number(grid.wakeHoldFrames) || 0) <= 0) continue;
      const st = state(entity);
      const forced = (Number(entity._gpuForceAwakeFrames) || 0) > 0;
      if (st.inFlight) continue;
      if (!forced && st.cooldown > 0) { st.cooldown--; continue; }
      if (!isHot(entity, Number(config?.gpuSoftBodyHotSampleLimit) || 36, Number(config?.gpuSoftBodyHotThreshold) || 0.06)) {
        st.idle = Math.min(120, st.idle + 1);
        st.cooldown = Math.min(24, 2 + ((st.idle / 2) | 0));
        continue;
      }
      st.idle = 0;
      let interval = Math.max(1, Number(config?.gpuSoftBodyDispatchInterval) || (count >= 512 ? 3 : count >= 256 ? 2 : 1));
      if (forced) {
        const crash = Math.max(256, Number(config?.gpuSoftBodyCrashShardThreshold) || 1200);
        interval = count >= crash ? 2 : 1;
      }
      if ((tickId % interval) !== 0) continue;
      dispatch(entity, st, k, damping, config);
      st.cooldown = Math.max(0, interval - 1);
      dispatched++;
      if (dispatched >= dispatchPerTick) { scanned++; break; }
    }
    cursor = len > 0 ? ((cursor + scanned) % len) : 0;
  }

  return { tick, stats };
}
