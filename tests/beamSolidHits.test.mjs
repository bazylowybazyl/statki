// Trafienia broni gry w BRYŁY 3D (docs/PORT-silnik-belek.md § „Ciała 3D” — pas broni, src/game/beamBand3D.js): pocisk,
// wiązka, rzaz Hexlance'a i orka lecą w płaszczyźnie gry w pasie ± HULL_BODY_CONFIG.weaponBand (jak słup okrętu) —
// trafiają przekrój bryły z pasem; krater na miarę rany to kula 3D wokół węzła najbliżej płaszczyzny; front fali
// wybuchu to kula wokół punktu wybuchu; ciepło wiązki — plama 3D. Co bryła ma nad i pod pasem, broń mija.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies, HULL_BODY_CONFIG: C, hullImpactResult } = await import('../src/game/hullBodies.js');
const { worldBodies, WORLD_BODY_TUNE: T } = await import('../src/game/worldBodies.js');
const { voxelizeTriangles, makeBoxTriangles } = await import('../src/game/voxelBody3D.js');
const { buildBeamStructure } = await import('../src/game/beamBody3D.js');
const { bandIndex, bodyRotation, solidBricks } = await import('../src/game/beamBand3D.js');

HullBodies.init();
const CELL = 45;
const LIM = C.weaponBand + 0.5 * CELL;     // węzeł w pasie: |z| ≤ pas + ½ komórki

// Kłoda 900 × 180 × 180 (oś x) z wokselizacji, środek na wysokości zc; quat — obrót (domyślnie brak).
function logStructure() {
  const vox = voxelizeTriangles(makeBoxTriangles(900, 180, 180, 0, 0, 0), null, { cellSize: CELL, interiorMode: 'full', shellLayers: 1, ribStep: 3 });
  return buildBeamStructure(vox, { bulkheadEvery: 0 });
}
function solidLog(zc, opts = {}) {
  const e = { x: 0, y: 0, name: 'kłoda', solid3D: true, isWreck: !!opts.wreck };
  HullBodies.createSolid(e, logStructure(), { position: { x: 1000, y: 0, z: zc }, quaternion: opts.quat, anchored: true, pins: () => true, hexPerNode: 4 });
  return e;
}
// Węzeł → świat silnika (x, y = −y gry, z).
function nodeWorld3(body, i, out = {}) {
  const m = bodyRotation(body.quat, new Float64Array(9)), s = body.nodeStore;
  out.x = body.pos.x + m[0] * s.x[i] + m[1] * s.y[i] + m[2] * s.z[i];
  out.y = body.pos.y + m[3] * s.x[i] + m[4] * s.y[i] + m[5] * s.z[i];
  out.z = body.pos.z + m[6] * s.x[i] + m[7] * s.y[i] + m[8] * s.z[i];
  return out;
}
const tick = () => { HullBodies.simTime += 1 / 60; };

test('pas broni: odcinek trafia przekrój bryły z pasem; bryła nad pasem — pocisk przelatuje pod nią', () => {
  const e = solidLog(30);
  const b = e.beamHull.body;
  const sw = HullBodies.sweep(e, 1000, -600, 1000, 600, 2);
  assert.ok(sw, 'trafienie kłody przecinającej płaszczyznę');
  assert.ok(Math.abs(sw.z) <= LIM, `węzeł w pasie: z ${sw.z}`);
  assert.ok(sw.worldY < -60 && sw.worldY > -160, `wejście na burcie kłody: y ${sw.worldY}`);
  assert.ok(HullBodies.probe(e, 1000, 0), 'sonda w przekroju');
  assert.ok(!HullBodies.probe(e, 1000, 300), 'sonda obok');
  // indeks pasa: tylko węzły |z| ≤ pas + ½ komórki
  const B = bandIndex(b, C.weaponBand, HullBodies.simTime);
  let inBand = 0;
  for (let i = 0; i < b.nodeStore.count; i++) if (b.nodeStore.active[i] && Math.abs(nodeWorld3(b, i).z) <= LIM) inBand++;
  assert.equal(B.n, inBand, 'indeks pasa = węzły w pasie');
  assert.ok(inBand > 0 && inBand < b.activeNodes, `część kłody w pasie: ${inBand} / ${b.activeNodes}`);
  const hi = solidLog(400);
  assert.equal(HullBodies.sweep(hi, 1000, -600, 1000, 600, 2), null, 'bryła nad pasem — bez trafienia');
  assert.equal(HullBodies.probe(hi, 1000, 0), false);
  assert.equal(HullBodies.impact(hi, 1000, -100, 400, { x: 0, y: 3000 }), false);
  HullBodies.release(e); HullBodies.release(hi);
});

test('krater na miarę rany: kula 3D wokół węzła kolumny najbliżej płaszczyzny; wynik z wysokością i komórkami kratownicy', () => {
  const e = solidLog(30);
  const b = e.beamHull.body, s = b.nodeStore;
  const sw = HullBodies.sweep(e, 1000, -600, 1000, 600, 2);
  // węzeł najbliżej płaszczyzny w kolumnie trafienia (ta sama XY co trafiony węzeł)
  const hitN = nodeWorld3(b, sw.node);
  let minAz = Infinity, column = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const w = nodeWorld3(b, i);
    if (Math.abs(w.x - hitN.x) < 1 && Math.abs(w.y - hitN.y) < 1 && Math.abs(w.z) <= LIM) { minAz = Math.min(minAz, Math.abs(w.z)); column++; }
  }
  assert.ok(column >= 2, `kolumna węzłów w pasie: ${column}`);
  assert.equal(Math.abs(sw.z), minAz, 'sweep wybiera węzeł najbliżej płaszczyzny gry');
  const pos = [];
  for (let i = 0; i < s.count; i++) pos.push(nodeWorld3(b, i, {}));
  const R = 60;
  const hit = HullBodies.impact(e, sw.worldX, sw.worldY, 400, { x: 0, y: 3000 }, { craterRadius: R });
  const r = hullImpactResult;
  assert.ok(hit && r.solid, 'trafienie bryły');
  assert.ok(r.killed > 0, `krater zabił węzły: ${r.killed}`);
  assert.equal(r.z, sw.z, 'wysokość krateru = węzeł trafienia');
  assert.ok(Number.isFinite(r.latX) && Number.isFinite(r.latY) && Number.isFinite(r.latZ), 'komórki kratownicy');
  const cx = sw.worldX, cy = -sw.worldY, cz = r.z;
  for (let i = 0; i < s.count; i++) {
    if (s.active[i]) continue;
    const p = pos[i];
    const d = Math.hypot(p.x - cx, p.y - cy, p.z - cz);
    assert.ok(d <= R + 1e-6, `zabity węzeł w kuli krateru: d ${d.toFixed(1)}`);
  }
  // węzeł żywy w kuli krateru — żaden
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const p = pos[i];
    assert.ok(Math.hypot(p.x - cx, p.y - cy, p.z - cz) > R - 1e-6, 'w kuli krateru nie zostaje żywy węzeł');
  }
  HullBodies.release(e);
});

test('odłamki krateru bryły lecą z wysokości węzłów (spawnHullDebris z z i vz), odrzut w 3D', () => {
  const calls = [];
  const prev = window.spawnHullDebris;
  window.spawnHullDebris = (x, y, vx, vy, r, g, bl, scale, structural, z = 0, vz = 0) => calls.push({ x, y, vx, vy, z, vz });
  try {
    // kłoda obrócona o 90° wokół osi x (przekrój pasa w innej osi ciała) — odrzut musi mieć składową w osi lokalnej z
    const h = Math.SQRT1_2;
    const e = solidLog(20, { quat: { x: h, y: 0, z: 0, w: h } });
    const sw = HullBodies.sweep(e, 1000, -600, 1000, 600, 2);
    assert.ok(sw, 'trafienie obróconej kłody');
    HullBodies.impact(e, sw.worldX, sw.worldY, 600, { x: 0, y: 3000 }, { craterRadius: 70 });
    assert.ok(calls.length > 0, 'odłamki');
    assert.ok(calls.some((c) => Math.abs(c.z) > 1), 'odłamki z wysokością węzłów');
    assert.ok(calls.some((c) => Math.abs(c.vz) > 1), 'odrzut z prędkością pionową');
    for (const c of calls) assert.ok(Number.isFinite(c.vx) && Number.isFinite(c.vy) && Number.isFinite(c.vz));
    HullBodies.release(e);
  } finally {
    window.spawnHullDebris = prev;
  }
});

test('rzaz (Hexlance): węzły pasa w pionowej płycie wzdłuż toru; nad pasem zostają; z pędem — odłamki wzdłuż toru', () => {
  const calls = [];
  const prev = window.spawnHullDebris;
  window.spawnHullDebris = (x, y, vx, vy, r, g, bl, scale, structural, z = 0, vz = 0) => calls.push({ vx, vy, z });
  try {
    const e = solidLog(30);
    const b = e.beamHull.body, s = b.nodeStore;
    const pos = [];
    for (let i = 0; i < s.count; i++) pos.push(nodeWorld3(b, i, {}));
    const hw = 35;
    const n = HullBodies.cutSegment(e, 700, -600, 700, 600, hw, { push: true });
    assert.ok(n > 0, `rzaz zabił węzły: ${n}`);
    assert.ok(hullImpactResult.solid && hullImpactResult.kind === 'cut');
    for (let i = 0; i < s.count; i++) {
      const p = pos[i];
      const inSlab = Math.abs(p.x - 700) <= hw && Math.abs(p.z) <= LIM;
      if (!s.active[i]) assert.ok(inSlab, `zabity węzeł w płycie rzazu (x ${p.x.toFixed(0)}, z ${p.z.toFixed(0)})`);
      else assert.ok(!inSlab, 'w płycie rzazu nie zostaje żywy węzeł pasa');
    }
    assert.ok(calls.length >= n, 'odłamki rzazu');
    // tor w +y świata gry: odłamki lecą wzdłuż toru (vy gry > 0)
    assert.ok(calls.filter((c) => c.vy > 0).length > calls.length * 0.8, 'odłamki wzdłuż toru');
    HullBodies.release(e);
  } finally {
    window.spawnHullDebris = prev;
  }
});

test('normalna bryły i przejście przez materiał w pasie', () => {
  const e = solidLog(30);
  const sw = HullBodies.sweep(e, 1000, -600, 1000, 600, 2);
  const nrm = HullBodies.surfaceNormal(e, sw.worldX, sw.worldY, 0, 1);
  assert.ok(nrm.ny < -0.8, `normalna na zewnątrz burty (gra: −y): ${nrm.nx.toFixed(2)}, ${nrm.ny.toFixed(2)}`);
  const tr = HullBodies.traceThrough(e, 1000, -600, 1000, 600, 0);
  assert.ok(tr && tr.entryT > 0 && tr.exitT > tr.entryT, 'wejście i wyjście');
  assert.ok(tr.solidLen > 150 && tr.solidLen < 320, `droga w materiale ~ szerokość kłody: ${tr.solidLen.toFixed(0)}`);
  HullBodies.release(e);
});

// Miejsce worldBodies z jednym kawałkiem-bryłą (kłoda) — kanały broni świata.
function solidSite(id, zc, quat) {
  worldBodies.reset();
  window.wrecks.length = 0;
  const st = logStructure();
  const site = {
    id, owner: { id: 'właściciel' },
    pieces: [{
      id: 'K', kind: 'log', label: 'kłoda', weight: 1, bounds: { x0: 500, y0: -200, x1: 1500, y1: 200 },
      material: { density: 2.4, armor: 3 }, solid3D: true, cellSize: CELL,
      build() { return null; },
      buildSolid() { return { structure: st, position: { x: 1000, y: 0, z: zc }, quaternion: quat || { x: 0, y: 0, z: 0, w: 1 }, pins: () => false }; },
      pins() { return false; }, available() { return true; }
    }]
  };
  worldBodies.addSite(site);
  T.bubbleRadius = 1e6; T.buildBudgetMs = 1e6;
  worldBodies.step(1 / 60, [{ x: 1000, y: 0 }]);
  const p = site.pieces[0];
  assert.equal(p.state, 'live', 'kawałek-bryła jest ciałem');
  // kotwica na dalekim końcu (kłoda stoi; trafienie rusza węzły, nie całe ciało)
  const b = p.entity.beamHull.body, s = b.nodeStore;
  for (let i = 0; i < s.count; i++) if (s.ox[i] > 380) s.invMass[i] = 0;
  HullBodies.step(1 / 60, worldBodies.withEntities([]));
  return { site, piece: p, body: b };
}

test('orka (worldBodies.hitBullet) przez bryłę-kawałek: pocisk hamuje, węzły toru ruszają się w układzie ciała (3D)', () => {
  const h = Math.SQRT1_2;
  const { site, body } = solidSite('kłoda-orka', 20, { x: h, y: 0, z: 0, w: h });
  const s = body.nodeStore;
  const v0 = new Float64Array(s.count * 3);
  for (let i = 0; i < s.count; i++) { v0[i * 3] = s.vx[i]; v0[i * 3 + 1] = s.vy[i]; v0[i * 3 + 2] = s.vz[i]; }
  const bullet = { damage: 300, r: 3, vx: 0, vy: 6000 };
  const res = worldBodies.hitBullet(site.id, bullet, 900, -400, 900, 400);
  assert.ok(res && res.entity, 'orka trafiła bryłę');
  assert.ok(bullet.vy < 6000, `pocisk zahamował: vy ${bullet.vy.toFixed(0)}`);
  let moved = 0, movedZ = 0;
  for (let i = 0; i < s.count; i++) {
    const dv = Math.hypot(s.vx[i] - v0[i * 3], s.vy[i] - v0[i * 3 + 1], s.vz[i] - v0[i * 3 + 2]);
    if (dv > 1) moved++;
    if (Math.abs(s.vz[i] - v0[i * 3 + 2]) > 1) movedZ++;
  }
  assert.ok(moved > 0, `węzły toru ruszone: ${moved}`);
  // obrót o 90° wokół x: oś y świata to oś z ciała — pęd pocisku (wzdłuż y gry) idzie w lokalne z
  assert.ok(movedZ > 0, 'zmiana prędkości w osi lokalnej z (pełny obrót Rᵀ)');
  // bryła nad pasem: orka mija
  const hi = solidSite('kłoda-wysoko', 500);
  const b2 = { damage: 300, r: 3, vx: 0, vy: 6000 };
  assert.equal(worldBodies.hitBullet(hi.site.id, b2, 900, -400, 900, 400), null, 'nad pasem — bez orki');
  assert.equal(b2.vy, 6000);
  worldBodies.reset();
});

test('front fali wybuchu: kula 3D wokół punktu wybuchu — węzły w promieniu dostają prędkość od środka, dalej nic', () => {
  const { body } = solidSite('kłoda-fala', 200);
  const s = body.nodeStore;
  const v0 = new Float64Array(s.count);
  for (let i = 0; i < s.count; i++) v0[i] = Math.hypot(s.vx[i], s.vy[i], s.vz[i]);
  // wybuch w płaszczyźnie gry pod kłodą (kłoda nad pasem — pocisk by ją minął, fala sięga kulą)
  const R = 260;
  worldBodies.detonate(1000, 0, R, 2, 0, 0);
  for (let k = 0; k < 20; k++) { worldBodies.step(1 / 60, [{ x: 1000, y: 0 }]); }
  let inside = 0, outsideMoved = 0;
  for (let i = 0; i < s.count; i++) {
    const w = nodeWorld3(body, i);
    const d = Math.hypot(w.x - 1000, w.y, w.z);
    const dv = Math.abs(Math.hypot(s.vx[i], s.vy[i], s.vz[i]) - v0[i]);
    if (d < R - CELL && s.invMass[i] > 0 && dv > 0.5) inside++;
    if (d > R + 2 * CELL && dv > 0.5) outsideMoved++;
  }
  assert.ok(inside > 0, `węzły w kuli fali ruszone: ${inside}`);
  assert.equal(outsideMoved, 0, 'poza kulą fali — bez ruchu');
  worldBodies.reset();
});

test('klocki bryły (front fali): każdy węzeł w jednym klocku, promień klocka obejmuje jego węzły spoczynkowe', () => {
  const e = solidLog(30);
  const b = e.beamHull.body, s = b.nodeStore;
  const br = solidBricks(b);
  assert.ok(br.n > 1, `klocków: ${br.n}`);
  assert.equal(br.start[br.n], s.count);
  const seen = new Uint8Array(s.count);
  for (let k = 0; k < br.n; k++) {
    assert.ok(br.start[k + 1] > br.start[k], 'klocek niepusty');
    for (let j = br.start[k]; j < br.start[k + 1]; j++) {
      const i = br.nodes[j];
      assert.equal(seen[i], 0, 'węzeł w jednym klocku');
      seen[i] = 1;
      const d = Math.hypot(s.ox[i] - br.cx[k], s.oy[i] - br.cy[k], s.oz[i] - br.cz[k]);
      assert.ok(d <= br.r[k] + 1e-9, 'promień obejmuje węzeł');
      assert.equal(s.ix[i] >> 2, s.ix[br.nodes[br.start[k]]] >> 2, 'ten sam klocek 4 komórek (x)');
    }
  }
  assert.equal(solidBricks(b), br, 'klocki z pamięci ciała');
  HullBodies.release(e);
});

test('front fali na bryle: węzły, którym fala dałaby mniej niż ułamek progu aktywności, nie dostają nic', () => {
  const { body } = solidSite('kłoda-fala-daleka', 200);
  const s = body.nodeStore;
  const ch = worldBodies.channels, t = ch.tune;
  const v0 = new Float64Array(s.count);
  for (let i = 0; i < s.count; i++) v0[i] = Math.hypot(s.vx[i], s.vy[i], s.vz[i]);
  // słaba fala, wielka kula: zasięg działania sqrt(kopnięcie przy 1 / próg) — mniej niż promień kuli
  const power = 0.3, R = 1500, rc = ch.refCell;
  const kickAt1 = t.blastKickCells * rc * power * rc * rc;
  const thr = body.activeThreshold > 0 ? body.activeThreshold : HullBodies.engine.config.activeMotionThreshold;
  const reach = Math.sqrt(kickAt1 / (t.blastMinKickFrac * thr));
  assert.ok(reach < R && reach > 150, `zasięg działania ${reach.toFixed(0)} j. < kula ${R}`);
  worldBodies.detonate(1000, 0, R, power, 0, 0);
  for (let k = 0; k < 20; k++) worldBodies.step(1 / 60, [{ x: 1000, y: 0 }]);
  let near = 0, far = 0;
  for (let i = 0; i < s.count; i++) {
    const w = nodeWorld3(body, i);
    const d = Math.hypot(w.x - 1000, w.y, w.z);
    const dv = Math.abs(Math.hypot(s.vx[i], s.vy[i], s.vz[i]) - v0[i]);
    if (d < reach - CELL && s.invMass[i] > 0 && dv > 0.05) near++;
    if (d > reach + 2 * CELL && dv > 0.05) far++;
  }
  assert.ok(near > 0, `w zasięgu działania — ruch: ${near}`);
  assert.equal(far, 0, 'dalej w kuli — bez kopnięcia (poniżej progu ruchu)');
  worldBodies.reset();
});

test('ciepło wiązki (worldBodies.heatAt): plama 3D wokół węzła pasa, ablacja w 3D', () => {
  const { piece, body } = solidSite('kłoda-wiązka', 30);
  const s = body.nodeStore;
  const ok = worldBodies.heatAt(piece.entity, 1000, -100, 400, 0, 1);
  assert.ok(ok, 'plama trafiła bryłę');
  let hot = 0, farHot = 0;
  for (let i = 0; i < s.count; i++) {
    if (!(s.temp[i] > 0)) continue;
    hot++;
    const w = nodeWorld3(body, i);
    if (Math.hypot(w.x - 1000, w.y - 100) > 300) farHot++;
  }
  assert.ok(hot > 0, `węzły rozgrzane: ${hot}`);
  assert.equal(farHot, 0, 'daleko od plamy — zimno');
  // długa wiązka: węzły topnieją i odparowują (ablacja bryły)
  const n0 = body.activeNodes;
  for (let k = 0; k < 40; k++) { worldBodies.heatAt(piece.entity, 1000, -100, 2000, 0, 1); worldBodies.step(1 / 60, [{ x: 1000, y: 0 }]); }
  assert.ok(body.activeNodes < n0, `ablacja: ${n0} → ${body.activeNodes}`);
  worldBodies.reset();
});

test('ciało płaskie: wynik trafienia bez wysokości (z = 0, solid = false)', () => {
  const W = 300, H = 120;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
  const e = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 5000 };
  HullBodies.createHull(e, { width: W, height: H, data });
  const sw = HullBodies.sweep(e, -400, 0, 400, 0, 2);
  assert.ok(sw && sw.z === 0);
  HullBodies.impact(e, sw.worldX, sw.worldY, 200, { x: 3000, y: 0 });
  assert.equal(hullImpactResult.solid, false);
  assert.equal(hullImpactResult.z, 0);
  HullBodies.release(e);
});
