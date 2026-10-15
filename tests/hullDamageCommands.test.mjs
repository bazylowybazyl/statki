import test from 'node:test';
import assert from 'node:assert/strict';

// RW-22 (docs/PLAN-render-worker.md § 3.3 „uzupełnienie 2026-10-15”): rekordy mapy ran. Gra (src/game/hullDamageEvents.js)
// pisze rekord z tym, o co mapa ran pytała silnik belek (poza, uv, komórki brył, środek łaty, źródło); dekoder renderu
// (src/3d/hullDamageCommands.js) woła z zastępnikiem kadłuba te same funkcje HullDamageMap. Sprawdzamy na prawdziwym
// silniku belek i prawdziwej mapie ran: kolejka stempli (uv, promień, otwór, kierunek, wydłużenie, ziarno) po rekordzie =
// kolejka po dawnym wywołaniu wprost, w tej samej kolejności losowań fxRandom.

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { HullDamageMap, DMG_STAMP_FLOATS } = await import('../src/3d/hullDamageMap.js');
const { SolidWounds } = await import('../src/3d/solidWounds.js');
const { fxRandom } = await import('../src/3d/fx/fxRandom.js');
const { createRenderCommands } = await import('../src/render/renderCommands.js');
const { createHullDamageEvents, KERF_STEP } = await import('../src/game/hullDamageEvents.js');
const { installHullDamageCommands } = await import('../src/3d/hullDamageCommands.js');
const HC = await import('../src/render/hullCommands.js');
const DM = await import('../src/3d/hullDamageMap.js');
const { voxelizeTriangles, makeBoxTriangles } = await import('../src/game/voxelBody3D.js');
const { buildBeamStructure } = await import('../src/game/beamBody3D.js');

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x > w * 0.7 && y < h * 0.3) continue;
    const o = (y * w + x) * 4;
    data[o] = 120; data[o + 1] = 140; data[o + 2] = 160; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}
const IMAGE = plate(600, 220);

function ship(x, y, angle) {
  const e = { x, y, vx: 0, vy: 0, angle, angVel: 0, mass: 5000 };
  HullBodies.createHull(e, IMAGE);
  return e;
}

// Kolejka stempli mapy ran po bloku wywołań: liczby kolejki i sloty (od zera, ten sam stan losowań).
function capture(run) {
  HullDamageMap.reset();
  HullDamageMap.frame = 1;
  HullDamageMap._qCount = 0;
  fxRandom.seed(0x1234);
  const S = HullDamageMap.stats;
  const s0 = { stamps: S.stamps, tear: S.tearStamps, patch: S.patchStamps | 0 };
  run();
  const n = HullDamageMap._qCount;
  return {
    n,
    data: Array.from(HullDamageMap._qData.subarray(0, n * DMG_STAMP_FLOATS)),
    slots: Array.from(HullDamageMap._qSlot.subarray(0, n)),
    stats: { stamps: S.stamps - s0.stamps, tear: S.tearStamps - s0.tear, patch: (S.patchStamps | 0) - s0.patch }
  };
}

function setup() {
  const rc = createRenderCommands({ mode: 'inline' });
  installHullDamageCommands(rc.reader);
  return { rc, ev: createHullDamageEvents(rc.writer) };
}

test('stałe wspólne z mapą ran: rzaz (krok, limit)', () => {
  assert.equal(HC.KERF_MAX, DM.DMG_KERF_MAX);
  assert.equal(KERF_STEP, DM.DMG_KERF_STEP);
  assert.ok(Object.values(HC.HC).every((c) => c >= 32 && c < 64), 'kody 32…63 (RW-21 ma 1…31)');
});

test('krater i rzaz z haka: rekord = dawne wywołanie (źródło, wariant, poza, uv, kierunek)', () => {
  window.wrecks.length = 0;
  const { ev } = setup();
  const e = ship(400, -200, 0.6);
  // Prawdziwe trafienia: hak zapisuje wynik do r — kopia wyników do porównania.
  const hooks = [];
  HullBodies.onImpact = (ent, r) => hooks.push([ent, { ...r }]);
  HullBodies.impact(e, e.x + 120, e.y + 20, 2600, { x: -600, y: 100 });
  HullBodies.impact(e, e.x - 90, e.y - 10, 900, { x: 300, y: 400 });
  HullBodies.cutSegment(e, e.x - 200, e.y + 60, e.x + 200, e.y + 70, 18);
  HullBodies.onImpact = null;
  assert.ok(hooks.length >= 2, 'haki krateru i rzazu');
  const srcs = [{ vfxKey: 'yamato', type: 'slug', weaponSize: 'capital' }, null, 'mjolnir'];
  const direct = capture(() => {
    hooks.forEach(([ent, r], i) => {
      const s = srcs[i % srcs.length];
      if (s) HullDamageMap.setSource(s, i === 1 ? 'exit' : 'impact'); else HullDamageMap.clearSource();
      HullDamageMap.onHullImpact(ent, r);
      HullDamageMap.clearSource();
    });
  });
  const viaRecord = capture(() => {
    hooks.forEach(([ent, r], i) => {
      const s = srcs[i % srcs.length];
      if (s) ev.setSource(s, i === 1 ? 'exit' : 'impact'); else ev.clearSource();
      ev.impact(ent, r);
      ev.clearSource();
    });
  });
  assert.ok(direct.n > 0);
  assert.deepEqual(viaRecord, direct);
  HullBodies.release(e);
});

test('rozdarcie, łata, naprawa i rzaz przebicia: rekord = dawne wywołanie', () => {
  window.wrecks.length = 0;
  const { ev } = setup();
  const e = ship(-800, 300, -1.1);
  const hull = e.beamHull;
  const pts = [[e.x + 10, e.y + 5], [e.x - 60, e.y + 30], [e.x + 140, e.y - 40]];
  const uvs = pts.map(([x, y]) => { const uv = HullBodies.spriteUvAt(e, x, y); return [uv.u, uv.v]; });
  const run = (api) => {
    pts.forEach(([x, y], i) => api.tear(e, hull, uvs[i][0], uvs[i][1], x, y));
    api.patch(e, 5, 4);
    api.patch(e, 12, 7);
    api.kerf(e, e.x - 150, e.y, e.x + 160, e.y + 25, 'valkyrie');
    api.repair(e, 0.25, true);
  };
  const direct = capture(() => run({
    tear: (...a) => HullDamageMap.onHullNodeLost(...a),
    patch: (ent, ix, iy) => HullDamageMap.patchCell(ent, ix, iy),
    kerf: (...a) => HullDamageMap.stampKerf(...a),
    repair: (...a) => HullDamageMap.onHullRepair(...a)
  }));
  const heal0 = HullDamageMap._byKey.get(hull.dmgKey)?.heal;
  const viaRecord = capture(() => run({
    tear: (...a) => ev.nodeLost(...a),
    patch: (ent, ix, iy) => ev.patch(ent, ix, iy),
    kerf: (...a) => ev.kerf(...a),
    repair: (...a) => ev.repair(...a)
  }));
  assert.ok(direct.stats.tear > 0 && direct.stats.patch > 0 && direct.n > 0);
  assert.deepEqual(viaRecord, direct);
  assert.equal(HullDamageMap._byKey.get(hull.dmgKey)?.heal, heal0, 'naprawa przez rekord');
  HullBodies.release(e);
});

test('bryła 3D: krater, rzaz i rozdarcie przez rekord = dawne wywołanie (komórki kratownicy, kwaternion)', () => {
  window.wrecks.length = 0;
  const { ev } = setup();
  // Bryła z wokselizacji prostopadłościanu (jak tests/beamSolidHits.test.mjs — kłoda w pasie broni, obrócona).
  const e = { x: 0, y: 0, name: 'kłoda', solid3D: true };
  const vox = voxelizeTriangles(makeBoxTriangles(900, 180, 180, 0, 0, 0), null, { cellSize: 45, interiorMode: 'full', shellLayers: 1, ribStep: 3 });
  HullBodies.createSolid(e, buildBeamStructure(vox, { bulkheadEvery: 0 }),
    { position: { x: 1000, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: Math.sin(0.3), w: Math.cos(0.3) }, anchored: true, pins: () => true, hexPerNode: 4 });
  assert.ok(e.beamHull?.solid3D, 'bryła 3D');
  const hull = e.beamHull;
  const hooks = [];
  HullBodies.onImpact = (ent, r) => hooks.push([ent, { ...r }]);
  HullBodies.impact(e, e.x + 50, e.y + 10, 3000, { x: -500, y: 0 });
  HullBodies.cutSegment(e, e.x - 300, e.y - 20, e.x + 300, e.y + 30, 18);
  HullBodies.onImpact = null;
  const runW = () => {
    const sw = { calls: [] };
    SolidWounds.reset?.();
    return sw;
  };
  const direct = [];
  const viaRec = [];
  const spy = (out) => { const orig = SolidWounds.stamp; SolidWounds.stamp = function (...a) { out.push(a.slice(1).map((v) => +v.toFixed(9))); return orig.apply(this, a); }; return () => { SolidWounds.stamp = orig; }; };
  let undo = spy(direct);
  runW();
  hooks.forEach(([ent, r]) => HullDamageMap.onHullImpact(ent, r));
  HullDamageMap.stampKerf(e, e.x - 60, e.y, e.x + 60, e.y + 10, 'hexlance');
  HullDamageMap.onSolidNodeLost(e, hull, 1, 1, 1, e.x, e.y);
  undo();
  undo = spy(viaRec);
  runW();
  hooks.forEach(([ent, r]) => ev.impact(ent, r));
  ev.kerf(e, e.x - 60, e.y, e.x + 60, e.y + 10, 'hexlance');
  ev.solidNodeLost(e, hull, 1, 1, 1, e.x, e.y);
  undo();
  assert.ok(direct.length > 0, 'stemple ran bryły');
  assert.deepEqual(viaRec, direct);
  HullBodies.release(e);
});


test('wybuch: rekord EXPLOSION = dawne opcje fabryki (domyślne, oś, zanik, barwa, sam gaz, gospodarz); drony zmiata gra', async () => {
  const { createExplosionEvents } = await import('../src/game/explosionEvents.js');
  const { installExplosionCommands } = await import('../src/3d/explosions/explosionCommands.js');
  const rc = createRenderCommands({ mode: 'inline' });
  const seen = [];
  // Opcje tak, jak czyta je fabryka (createExplosionFactory → system.spawn): domyślne `??`, potem normalizacja spawn().
  const norm = (o) => [o.x ?? 0, o.y ?? 0, o.size ?? 300, o.profile ?? 'capital', Number(o.vx ?? 0) || 0, Number(o.vy ?? 0) || 0,
    Number(o.axisX) || 0, Number(o.axisY) || 0, Number(o.jetVelTau) > 0 ? Number(o.jetVelTau) : -1,
    o.tint ? [o.tint[0], o.tint[1], o.tint[2]] : null, !!o.gasOnly, Number(o.hostKey) || 0];
  const factory = (o) => { seen.push(norm(o)); return true; };
  let ready = null;
  const stats = installExplosionCommands(rc.reader, () => ready);
  const swept = [];
  const ev = createExplosionEvents(rc.writer, { sweepDrones: (o) => swept.push(o.x) });
  const cases = [
    { x: 10, y: -20, size: 300 },
    { x: 1e7 + 0.25, y: -5e6, size: 560, profile: 'escort', vx: 120, vy: -40, axisX: 0.3, axisY: -0.9, jetVelTau: 0.42, hostKey: 77 },
    { x: 5, y: 6, size: 220, profile: 'capital', tint: [0.9, 0.7, 1], gasOnly: true, hostKey: 3 },
    { x: 1, y: 2, size: 180, profile: 'crush', vx: 0, vy: 0 }
  ];
  assert.equal(ev.blast(cases[0], true), false, 'render bez fabryki — ani rekordu, ani obrażeń dronów');
  assert.equal(swept.length, 0);
  ready = factory;
  ev.ready = true;
  for (const [i, o] of cases.entries()) ev.blast(o, i === 0);
  assert.deepEqual(seen, cases.map(norm));
  assert.deepEqual(swept, [10], 'drony tylko przy blast(o, true)');
  assert.equal(stats.ok, cases.length);
});

test('odłamki węzłów: rekord HULL_DEBRIS = dawna droga (te same losowania skali i kształtownika, ciało płaskie i bryła)', () => {
  window.wrecks.length = 0;
  const { ev } = setup();
  const calls = [];
  const prevSpawn = window.spawnHullDebris;
  const prevRandom = Math.random;
  window.spawnHullDebris = (...a) => { calls.push(a.map((v) => (typeof v === 'number' ? +v.toFixed(9) : v))); };
  const run = (hooked) => {
    calls.length = 0;
    fxRandom.seed(0x777);
    // Silnik belek: ten sam ciąg Math.random i zegar w obu przebiegach (odrzut węzłów, rozpad).
    let a = 0x9e3779b9;
    Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    HullBodies.simTime = 0;
    HullBodies.onDebris = hooked ? (...a) => ev.debris(...a) : null;
    const e = ship(0, 0, 0.2);
    HullBodies.impact(e, e.x + 100, e.y + 10, 4000, { x: -800, y: 50 });
    HullBodies.cutSegment(e, e.x - 220, e.y - 30, e.x + 220, e.y + 40, 20);
    for (let k = 0; k < 20; k++) HullBodies.step(1 / 60, [e, ...window.wrecks]);
    HullBodies.release(e);
    for (const w of window.wrecks.splice(0)) HullBodies.release(w);
    return calls.slice();
  };
  try {
    const legacy = run(false);
    const viaRecord = run(true);
    assert.ok(legacy.length > 10, `odłamki: ${legacy.length}`);
    assert.deepEqual(viaRecord, legacy);
  } finally {
    HullBodies.onDebris = null;
    window.spawnHullDebris = prevSpawn;
    Math.random = prevRandom;
  }
});
