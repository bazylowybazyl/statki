// Zbieracz zgłoszeń kolejki WebGPU (src/3d/zbieraczZgloszen.js, 2026-10-17): odłożone `queue.submit` + wysłanie przy
// konflikcie muszą dawać DOKŁADNIE te same odczyty poleceń co zgłoszenia od razu. Atrapa realmu WebGPU: „GPU” wykonuje
// bufor poleceń w chwili prawdziwego zgłoszenia (oryginalne `submit`), zapisy kolejki zmieniają zasób od razu (oś
// kolejki), rysunek / obliczenie czyta wartości związanych zasobów i dopisuje je do dziennika, obliczenie pisze do
// pierwszego bufora grupy, kopie przenoszą wartości, zasób zniszczony w poleceniu = błąd w dzienniku. Losowe ciągi
// operacji w dwóch świeżych realmach (bez zbieracza i ze zbieraczem) → dzienniki porównane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ZBIERACZ, ZGLOSZENIE_POWOD, wyslijZgloszenia, zainstalujZbieranieZgloszen } from '../src/3d/zbieraczZgloszen.js';

function makeRealm(log) {
  class GPUBuffer {
    constructor(id) { this.id = id; this.value = 0; this.destroyed = false; }
    destroy() { this.destroyed = true; }
    mapAsync() { log.push(`map ${this.id}=${this.value}`); return Promise.resolve(); }
  }
  class GPUTexture {
    constructor(id) { this.id = id; this.value = 0; this.destroyed = false; }
    createView() { return new GPUTextureView(this); }
    destroy() { this.destroyed = true; }
  }
  class GPUTextureView { constructor(t) { this.texture = t; } }
  class GPUSampler {}
  class GPUBindGroup { constructor(res) { this.res = res; } }
  class GPUQuerySet { destroy() {} }
  const live = (r) => { if (r.destroyed) { log.push(`BŁĄD zniszczony ${r.id}`); return false; } return true; };
  const read = (r) => (live(r) ? r.value : NaN);
  class GPURenderPassEncoder {
    constructor(enc, desc) {
      this.enc = enc; this.groups = []; this.vb = []; this.ib = null;
      this.target = desc.colorAttachments[0].view.texture;
      enc.ops.push(() => { live(this.target); });
    }
    setBindGroup(i, g) { this.groups[i] = g; }
    setVertexBuffer(slot, b) { this.vb[slot] = b; }
    setIndexBuffer(b) { this.ib = b; }
    draw(tag) {
      const groups = this.groups.slice(), vb = this.vb.slice(), ib = this.ib, target = this.target;
      this.enc.ops.push(() => {
        const vals = [];
        for (const g of groups) if (g) for (const r of g.res) vals.push(read(r.texture || r));
        for (const b of vb) if (b) vals.push(read(b));
        if (ib) vals.push(read(ib));
        log.push(`draw ${tag} [${vals.join(',')}]`);
        if (live(target)) target.value = (target.value * 31 + vals.reduce((a, v) => a + (v | 0), 1)) % 100003;
      });
    }
    drawIndirect(b) { this.enc.ops.push(() => log.push(`ind ${read(b)}`)); }
    executeBundles(bundles) {
      for (const bu of bundles) this.enc.ops.push(() => log.push(`bundle [${bu.res.map(read).join(',')}]`));
    }
    end() {}
  }
  class GPUComputePassEncoder {
    constructor(enc) { this.enc = enc; this.groups = []; }
    setBindGroup(i, g) { this.groups[i] = g; }
    dispatchWorkgroups(tag) {
      const groups = this.groups.slice();
      this.enc.ops.push(() => {
        const vals = [];
        let first = null;
        for (const g of groups) if (g) for (const r of g.res) { const t = r.texture || r; vals.push(read(t)); if (!first && t instanceof GPUBuffer) first = t; }
        log.push(`dispatch ${tag} [${vals.join(',')}]`);
        if (first && live(first)) first.value = (first.value * 7 + 3) % 100003;
      });
    }
    end() {}
  }
  class GPURenderBundleEncoder {
    constructor() { this.res = []; }
    setVertexBuffer(slot, b) { this.res.push(b); }
    finish() { const b = new GPURenderBundle(); b.res = this.res; return b; }
  }
  class GPURenderBundle {}
  class GPUCommandBuffer { constructor(ops) { this.ops = ops; } }
  class GPUCommandEncoder {
    constructor() { this.ops = []; }
    beginRenderPass(desc) { return new GPURenderPassEncoder(this, desc); }
    beginComputePass() { return new GPUComputePassEncoder(this); }
    copyBufferToBuffer(src, a, b) {
      const dst = arguments.length >= 5 ? b : a;
      this.ops.push(() => { if (live(src) && live(dst)) dst.value = src.value; });
    }
    copyTextureToTexture(src, dst) { this.ops.push(() => { if (live(src.texture) && live(dst.texture)) dst.texture.value = src.texture.value; }); }
    finish() { return new GPUCommandBuffer(this.ops); }
  }
  class GPUQueue {
    submit(cbs) { for (const cb of cbs) for (const op of cb.ops) op(); log.push(`submit ${cbs.length}`); }
    writeBuffer(b, off, data) { b.value = data[0]; }
    writeTexture(dst, data) { dst.texture.value = data[0]; }
    onSubmittedWorkDone() { return Promise.resolve(); }
  }
  class GPUDevice {
    constructor() { this.queue = new GPUQueue(); }
    createCommandEncoder() { return new GPUCommandEncoder(); }
    createBindGroup(desc) { return new GPUBindGroup(desc.entries.map((e) => e.resource.buffer || e.resource)); }
    createRenderBundleEncoder() { return new GPURenderBundleEncoder(); }
    pushErrorScope() {}
    popErrorScope() { return Promise.resolve(null); }
    destroy() {}
  }
  return { GPUBuffer, GPUTexture, GPUTextureView, GPUSampler, GPUBindGroup, GPUQuerySet, GPURenderPassEncoder,
    GPUComputePassEncoder, GPURenderBundleEncoder, GPUCommandEncoder, GPUQueue, GPUDevice };
}

// generator liczb (ziarno)
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Jeden ciąg operacji (te same decyzje w obu realmach — ten sam generator). Zwraca dziennik „GPU”.
function runScenario(seed, batched, maxPending = 0) {
  const log = [];
  const g = makeRealm(log);
  ZBIERACZ.n = 0; ZBIERACZ.pending.length = 0; ZBIERACZ.pendingMin = Infinity; ZBIERACZ.queue = null;
  ZBIERACZ.unsafe = -1; ZBIERACZ.maxPending = maxPending;
  if (batched) { zainstalujZbieranieZgloszen(g); ZBIERACZ.enabled = true; }
  const R = rng(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const dev = new g.GPUDevice();
  const q = dev.queue;
  let id = 0;
  const bufs = [], texs = [];
  for (let i = 0; i < 6; i++) bufs.push(new g.GPUBuffer(`b${id++}`));
  for (let i = 0; i < 4; i++) texs.push(new g.GPUTexture(`t${id++}`));
  const targets = [new g.GPUTexture(`rt${id++}`), new g.GPUTexture(`rt${id++}`)];
  const views = texs.map((t) => t.createView());
  const sampler = new g.GPUSampler();
  const groups = [];
  const newGroup = () => {
    const entries = [];
    const nb = 1 + Math.floor(R() * 3);
    for (let i = 0; i < nb; i++) {
      const r = R();
      if (r < 0.55) entries.push({ binding: i, resource: { buffer: pick(bufs) } });
      else if (r < 0.9) entries.push({ binding: i, resource: pick(views) });
      else entries.push({ binding: i, resource: sampler });
    }
    groups.push(dev.createBindGroup({ entries: entries.filter((e) => !(e.resource instanceof g.GPUSampler)) }));
  };
  for (let i = 0; i < 6; i++) newGroup();
  // enkoder z OTWARTYM passem nagrywany przez wiele kroków, przeplatany z innymi zgłoszeniami (render zagnieżdżony:
  // mapa cienia z updateBefore zgłasza się w środku passu sceny, który potem dalej nagrywa i zgłasza się po niej)
  let open = null;
  const finishOpen = () => { if (open) { open.pass.end(); q.submit([open.enc.finish()]); open = null; } };
  const drawInto = (p, tag) => {
    if (R() < 0.8) p.setBindGroup(0, pick(groups));
    if (R() < 0.5) p.setVertexBuffer(0, pick(bufs));
    if (R() < 0.2) p.setIndexBuffer(pick(bufs), 'uint16');
    if (R() < 0.1) p.drawIndirect(pick(bufs), 0);
    else p.draw(tag);
  };
  const steps = 60 + Math.floor(R() * 60);
  for (let s = 0; s < steps; s++) {
    const r = R();
    if (r < 0.22) {
      // zapis bufora / tekstury (wartość z ciągu)
      if (R() < 0.75) q.writeBuffer(pick(bufs), 0, [Math.floor(R() * 1000)]);
      else q.writeTexture({ texture: pick(texs) }, [Math.floor(R() * 1000)]);
    } else if (r < 0.55) {
      // pass rysunków (render three: enkoder → pass → kilka rysunków → zgłoszenie)
      const enc = dev.createCommandEncoder();
      const p = enc.beginRenderPass({ colorAttachments: [{ view: pick(targets).createView() }] });
      const nd = 1 + Math.floor(R() * 4);
      for (let d = 0; d < nd; d++) {
        // zapis w trakcie nagrywania passu (three: uniformy obiektu tuż przed jego rysunkiem)
        if (R() < 0.3) q.writeBuffer(pick(bufs), 0, [Math.floor(R() * 1000)]);
        drawInto(p, `${s}.${d}`);
      }
      if (R() < 0.15) {
        const be = dev.createRenderBundleEncoder();
        be.setVertexBuffer(0, pick(bufs));
        p.executeBundles([be.finish()]);
      }
      if (R() < 0.8 || open) { p.end(); q.submit([enc.finish()]); }
      else open = { enc, pass: p };   // pass zostaje otwarty — dalsze rysunki w kolejnych krokach
    } else if (r < 0.6) {
      if (open) drawInto(open.pass, `o${s}`);
    } else if (r < 0.72) {
      const enc = dev.createCommandEncoder();
      const p = enc.beginComputePass();
      const nd = 1 + Math.floor(R() * 3);
      for (let d = 0; d < nd; d++) { p.setBindGroup(0, pick(groups)); p.dispatchWorkgroups(`${s}.${d}`); }
      p.end();
      q.submit([enc.finish()]);
    } else if (r < 0.8) {
      const enc = dev.createCommandEncoder();
      if (R() < 0.6) {
        const a = pick(bufs), b = pick(bufs);
        if (R() < 0.5) enc.copyBufferToBuffer(a, 0, b, 0, 4); else enc.copyBufferToBuffer(a, b, 4);
      } else enc.copyTextureToTexture({ texture: pick(texs) }, { texture: pick(texs) }, [1, 1]);
      q.submit([enc.finish()]);
    } else if (r < 0.84) {
      // zniszczenie zasobu i nowy na jego miejsce (three: zmiana rozmiaru atrybutu / celu)
      if (R() < 0.6) { const i = Math.floor(R() * bufs.length); bufs[i].destroy(); bufs[i] = new g.GPUBuffer(`b${id++}`); }
      else { const i = Math.floor(R() * texs.length); texs[i].destroy(); texs[i] = new g.GPUTexture(`t${id++}`); views[i] = texs[i].createView(); }
      newGroup();
    } else if (r < 0.87) {
      pick(bufs).mapAsync(1);
    } else if (r < 0.9) {
      newGroup();
    } else if (r < 0.93) {
      if (batched) wyslijZgloszenia(ZGLOSZENIE_POWOD.KADR);
    } else if (r < 0.95) {
      finishOpen();
    } else if (r < 0.97) {
      dev.pushErrorScope('validation'); dev.popErrorScope();
    } else {
      q.onSubmittedWorkDone();
    }
  }
  finishOpen();
  if (batched) wyslijZgloszenia(ZGLOSZENIE_POWOD.KADR);
  // stan końcowy zasobów (zapisy po ostatnim poleceniu też muszą się zgadzać)
  log.push(`koniec ${bufs.map((b) => b.value).join(',')} | ${texs.map((t) => t.value).join(',')} | ${targets.map((t) => t.value).join(',')}`);
  return log.filter((l) => !l.startsWith('submit'));
}

test('zbieracz: odczyty poleceń jak przy zgłoszeniach od razu (losowe ciągi)', () => {
  let sentBatched = 0, requested = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const a = runScenario(seed, false);
    const r0 = ZBIERACZ.stats.requested, s0 = ZBIERACZ.stats.sent;
    const b = runScenario(seed, true);
    requested += ZBIERACZ.stats.requested - r0;
    sentBatched += ZBIERACZ.stats.sent - s0;
    assert.deepEqual(b, a, `ziarno ${seed}`);
  }
  // zbieranie naprawdę łączy zgłoszenia (inaczej test niczego nie sprawdza)
  assert.ok(sentBatched < requested * 0.85, `wysłane ${sentBatched} z ${requested}`);
});

test('zbieracz: limit odłożonych buforów (maxPending) też daje te same odczyty', () => {
  for (let seed = 401; seed <= 520; seed++) {
    assert.deepEqual(runScenario(seed, true, 3), runScenario(seed, false), `ziarno ${seed}`);
  }
});

test('zbieracz: zapis do zasobu odłożonego polecenia wysyła je przed zapisem', () => {
  const log = [];
  const g = makeRealm(log);
  ZBIERACZ.n = 0; ZBIERACZ.pending.length = 0; ZBIERACZ.pendingMin = Infinity; ZBIERACZ.queue = null; ZBIERACZ.unsafe = -1; ZBIERACZ.maxPending = 0;
  zainstalujZbieranieZgloszen(g);
  const dev = new g.GPUDevice();
  const b = new g.GPUBuffer('x'), other = new g.GPUBuffer('y');
  const rt = new g.GPUTexture('rt');
  const grp = dev.createBindGroup({ entries: [{ binding: 0, resource: { buffer: b } }] });
  const pass = (tag) => {
    const enc = dev.createCommandEncoder();
    const p = enc.beginRenderPass({ colorAttachments: [{ view: rt.createView() }] });
    p.setBindGroup(0, grp); p.draw(tag); p.end();
    dev.queue.submit([enc.finish()]);
  };
  const reasons0 = ZBIERACZ.stats.reasons[ZGLOSZENIE_POWOD.ZAPIS_BUFORA];
  dev.queue.writeBuffer(b, 0, [1]);
  pass('A');
  dev.queue.writeBuffer(other, 0, [5]);   // zasób spoza odłożonych — bez wysłania
  assert.equal(ZBIERACZ.n, 1);
  dev.queue.writeBuffer(b, 0, [2]);       // konflikt — A wysłany przed zapisem
  assert.equal(ZBIERACZ.n, 0);
  assert.equal(ZBIERACZ.stats.reasons[ZGLOSZENIE_POWOD.ZAPIS_BUFORA], reasons0 + 1);
  pass('B');
  wyslijZgloszenia(ZGLOSZENIE_POWOD.KADR);
  assert.deepEqual(log.filter((l) => l.startsWith('draw')), ['draw A [1]', 'draw B [2]']);
});
