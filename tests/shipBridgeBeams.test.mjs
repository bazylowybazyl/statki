// Mostki na kadłubach belkowych (src/game/shipBridgeBeams.js) — prawdziwe sprite'y, HullBodies,
// te same strefy co gra (BRIDGE_LAYOUT_PROPOSALS) i model 3D na komórkach siatki belek (bridge3D.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];

const { HullBodies } = await import('../src/game/hullBodies.js');
const { makeBridgeShip, bridgeHullImage } = await import('./helpers/bridgeHulls.mjs');
const { BRIDGE_DEMO_ORDER } = await import('../dema/mostki-webgpu/kadluby.js');
const RT = await import('../src/game/shipBridgeRuntime.js');
const SB = await import('../src/game/shipBridge.js');
const BB = await import('../src/game/shipBridgeBeams.js');
const B3 = await import('../src/3d/bridge3D.js');
const SH = await import('../src/3d/bridge3DShapes.js');

const { BRIDGE_EVENT } = SB;

function ship(key, x = 0, y = 0, angle = 0) {
  const e = makeBridgeShip(HullBodies, key, x, y, angle);
  RT.attachEntityBridges(e);
  return e;
}

// Zabija wszystkie żywe komórki mostka `b` u gospodarza (krater na miarę rany w środku każdej komórki).
function killCells(e, b, fraction = 1) {
  const st = e.bridgeState;
  const bridge = st.bridges[b];
  const hull = e.beamHull;
  const cs = hull.body.cellSize;
  const n = Math.ceil(bridge.total * fraction);
  const p = {};
  for (let k = 0; k < n; k++) {
    if (BB.bridgeCellNode(hull, bridge.cellX[k], bridge.cellY[k]) < 0) continue;
    BB.beamLatticeToWorld(hull, (bridge.cellX[k] + 0.5) * cs, (bridge.cellY[k] + 0.5) * cs, p);
    HullBodies.impact(e, p.x, p.y, 1, null, { craterRadius: cs * 0.45 });
  }
}

test('every bridge hull gets bridge cells on its beam hull (no missing zones), armour ×armorMul', () => {
  for (const key of BRIDGE_DEMO_ORDER) {
    const e = makeBridgeShip(HullBodies, key);
    const before = Float64Array.from(e.beamHull.body.nodeStore.maxHp);
    const st = RT.attachEntityBridges(e);
    assert.ok(st && BB.isBeamBridgeState(st), `${key}: stan mostków na belkach`);
    for (const b of st.bridges) {
      assert.ok(!b.missing && b.total > 0, `${key}/${b.id}: strefa ma komórki`);
      const i = BB.bridgeCellNode(e.beamHull, b.cellX[0], b.cellY[0]);
      assert.ok(i >= 0);
      assert.ok(Math.abs(e.beamHull.body.nodeStore.maxHp[i] - before[i] * b.def.armorMul) < 1e-6, `${key}: pancerz`);
    }
    // Ponowny montaż nie mnoży pancerza drugi raz; odpięcie przywraca bazę.
    RT.attachEntityBridges(e);
    const b0 = e.bridgeState.bridges[0];
    const i0 = BB.bridgeCellNode(e.beamHull, b0.cellX[0], b0.cellY[0]);
    assert.ok(Math.abs(e.beamHull.body.nodeStore.maxHp[i0] - before[i0] * b0.def.armorMul) < 1e-6, `${key}: bez podwójnego pancerza`);
    SB.detachShipBridges(e);
    assert.ok(Math.abs(e.beamHull.body.nodeStore.maxHp[i0] - before[i0]) < 1e-6, `${key}: pancerz zdjęty`);
    assert.equal(e.bridgeState, null);
  }
});

test('zone cells sit inside the PNG zone and PNG ↔ world round-trips for ship and wreck poses', () => {
  const e = ship('battleship', 7.08e6, 6.29e6, 0.7);
  const st = e.bridgeState;
  const b = st.bridges[0];
  for (let k = 0; k < b.total; k++) {
    assert.ok(SB.bridgeZoneDistance(b.def, b.pos[k * 2], b.pos[k * 2 + 1]) <= 0.01, 'środek komórki w strefie');
  }
  const w = SB.bridgePngToWorld(e, b.def.x, b.def.y, {});
  const back = SB.bridgeWorldToPng(e, w.x, w.y, {});
  assert.ok(Math.hypot(back.x - b.def.x, back.y - b.def.y) < 1e-3, 'PNG → świat → PNG');
  // „Siatka” w API = piksele obrazu kadłuba: środek obrazu = środek sprite'a = pozycja encji.
  const c = SB.bridgeGridToWorld(e, st.srcW * 0.5, st.srcH * 0.5, {});
  assert.ok(Math.hypot(c.x - e.x, c.y - e.y) < 1e-6, 'środek obrazu = kotwica statku');
  // Wrak (kotwica = środek masy): ten sam punkt kadłuba w tym samym miejscu świata.
  const hull = e.beamHull;
  const cs = hull.cellSize;
  const before = BB.beamLatticeToWorld(hull, (b.cellX[0] + 0.5) * cs, (b.cellY[0] + 0.5) * cs, {});
  const wreck = HullBodies.convertToWreck(e);
  assert.ok(wreck && wreck.beamHull && wreck.beamHull.dmgKey === st.lineage, 'wrak dziedziczy ród');
  const after = BB.beamLatticeToWorld(wreck.beamHull, (b.cellX[0] + 0.5) * cs, (b.cellY[0] + 0.5) * cs, {});
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1e-3, 'komórka w tym samym miejscu na wraku');
  window.wrecks.length = 0;
});

test('destroying a bridge (killFrac of its cells) loses command; vent tunnel reaches the hull outline', () => {
  for (const key of ['battleship', 'pirate_battleship', 'destroyer', 'terran_supercapital']) {
    const e = ship(key, 0, 0, 0.2);
    const st = e.bridgeState;
    assert.equal(SB.evaluateShipBridges(e, 0), BRIDGE_EVENT.NONE, `${key}: nietknięty`);
    // Trafienie z burty (lastHit) — kierunek wyrzutu przeciwny do pocisku.
    const p = SB.bridgePngToWorld(e, st.bridges[0].def.x, st.bridges[0].def.y, {});
    SB.noteBridgeHit(e, p.x, p.y, 0, 900, 1.0);
    killCells(e, 0, 0.2);
    const f1 = SB.evaluateShipBridges(e, 1.0);
    assert.equal(f1 & BRIDGE_EVENT.COMMAND_LOST, 0, `${key}: ~20% komórek to jeszcze nie utrata (killFrac 0,35)`);
    assert.ok(st.bridges[0].integrity < 0.9 && st.bridges[0].integrity > 0.65, `${key}: integralność spada`);
    killCells(e, 0, 1);
    const f2 = SB.evaluateShipBridges(e, 1.1);
    assert.ok(f2 & BRIDGE_EVENT.COMMAND_LOST, `${key}: utrata dowodzenia`);
    assert.ok(RT.isBridgeHulk(e));
    const v = st.vent;
    assert.ok(v && Number.isFinite(v.exitX) && v.exitDist > 0, `${key}: wylot tunelu`);
    // Wyrzut w stronę strzelca (pocisk leciał +y świata → gaz ucieka w −y świata).
    const dirW = { x: 0, y: 0 };
    const a = SB.bridgePngToWorld(e, v.x, v.y, {});
    const b = SB.bridgePngToWorld(e, v.x + v.dirX * 10, v.y + v.dirY * 10, {});
    dirW.x = b.x - a.x; dirW.y = b.y - a.y;
    assert.ok(dirW.y < 0, `${key}: strumień tunelem ostrzału`);
  }
});

test('Atlas: the rear bridge falls first, the backup keeps command; then the backup — command lost', () => {
  const e = ship('atlas');
  const st = e.bridgeState;
  assert.equal(st.bridges.length, 2);
  killCells(e, 0, 1);
  const f1 = SB.evaluateShipBridges(e, 2);
  assert.ok(f1 & BRIDGE_EVENT.BRIDGE_LOST);
  assert.equal(f1 & BRIDGE_EVENT.COMMAND_LOST, 0, 'zapasowy dowodzi');
  killCells(e, 1, 1);
  const f2 = SB.evaluateShipBridges(e, 3);
  assert.ok(f2 & BRIDGE_EVENT.COMMAND_LOST);
});

test('a bridge cut off with a fragment counts as lost; the 3D record follows the cells to the fragment', () => {
  window.wrecks.length = 0;
  const e = ship('battleship', 0, 0, 0);
  const st = e.bridgeState;
  const def = st.bridges[0].def;
  const K = { index: SH.BRIDGE3D_KINDS.bellator.index, name: 'bellator', model: SH.buildBridgeModel('bellator'), emit: { count: 0, cx: [], cy: [] } };
  const rec = B3.createBeamBridgeRecordCore(e, st, 0, K, 0);
  assert.ok(rec.beam && rec.cellCount > 0 && rec.hexR < 0, 'rekord siatki kwadratowej');
  // Rzaz w poprzek kadłuba przed nadbudówką (Bellator: mostek na rufie, x ≈ −282 PNG).
  const xCut = def.x + def.w * 0.5 + 40;
  const a = SB.bridgePngToWorld(e, xCut, -400, {});
  const b = SB.bridgePngToWorld(e, xCut, 400, {});
  HullBodies.cutSegment(e, a.x, a.y, b.x, b.y, e.beamHull.cellSize * 1.2, { push: true });
  for (let i = 0; i < 30; i++) HullBodies.step(1 / 120, [e, ...window.wrecks]);
  const frag = window.wrecks.find((w) => w.beamHull && w.beamHull.dmgKey === st.lineage && BB.beamBridgeAliveCells(e, 0) < st.bridges[0].total);
  assert.ok(frag, 'odłam rodu powstał');
  const f = SB.evaluateShipBridges(e, 5);
  assert.ok(f & BRIDGE_EVENT.COMMAND_LOST, 'mostek odcięty = utrata dowodzenia');
  // Część modelu na odłamie: Bridge3D znajduje odłam z komórkami mostka (rekord-siostra).
  assert.equal(B3.Bridge3D._findMoved(rec, [e, ...window.wrecks], e), frag, 'odłam niesie część mostka');
  window.wrecks.length = 0;
});

test('3D model record on beam cells: damage bytes mirror the hull (alive, HP, 8-neighbour mask) and the wreck takes over', () => {
  window.wrecks.length = 0;
  const e = ship('pirate_battleship', 0, 0, 0.4);
  const st = e.bridgeState;
  const model = SH.buildBridgeModel('ironskull');
  const K = { index: SH.BRIDGE3D_KINDS.ironskull.index, name: 'ironskull', model, emit: { count: 0, cx: [], cy: [] } };
  const rec = B3.createBeamBridgeRecordCore(e, st, 0, K, 0);
  assert.ok(rec.blockW > 2 && rec.blockH > 2);
  // Każda komórka strefy mostka leży w bloku rekordu.
  const b = st.bridges[0];
  let inBlock = 0;
  for (let k = 0; k < b.total; k++) {
    const i = b.cellX[k] - rec.c0, j = b.cellY[k] - rec.r0;
    if (i >= 0 && j >= 0 && i < rec.blockW && j < rec.blockH) inBlock++;
  }
  assert.ok(inBlock / b.total > 0.95, `komórki strefy w bloku modelu (${inBlock}/${b.total})`);
  const data = new Uint8Array(B3.BRIDGE3D_DAMAGE_LIMITS.width * 4 * rec.rowCount);
  B3.refreshBeamBridgeRecordDamage(rec, e.beamHull, data, 0);
  let alive = 0;
  for (let k = 0; k < rec.cellCount; k++) if (data[k * 4] >= 64) alive++;
  assert.equal(alive, rec.existed.reduce((s, v) => s + v, 0), 'żywe = istniejące na starcie');
  assert.equal(rec.anyDead, 0);
  // Krater w środku strefy: komórka martwa (R = 0), sąsiedzi z bitem martwego sąsiada.
  const cs = e.beamHull.cellSize;
  const k0 = Math.floor(b.total / 2);
  const p = BB.beamLatticeToWorld(e.beamHull, (b.cellX[k0] + 0.5) * cs, (b.cellY[k0] + 0.5) * cs, {});
  HullBodies.impact(e, p.x, p.y, 1, null, { craterRadius: cs * 0.45 });
  B3.refreshBeamBridgeRecordDamage(rec, e.beamHull, data, 0.1);
  const ci = b.cellX[k0] - rec.c0, cj = b.cellY[k0] - rec.r0;
  const kk = ci + cj * rec.blockW;
  assert.equal(data[kk * 4], 0, 'martwa komórka');
  assert.equal(rec.anyDead, 1);
  // Sąsiad z prawej (+x): jego bit „martwy sąsiad −x” (bit 2) zapalony, świeże cięcie (A > 0).
  const kr = kk + 1;
  if (rec.existed[kr] && data[kr * 4] >= 64) {
    assert.ok(data[kr * 4 + 2] & (1 << 2), 'maska sąsiadów: martwy po stronie −x');
    assert.ok(data[kr * 4 + 3] > 0, 'świeże cięcie');
  }
  // Śmierć okrętu: kadłub przechodzi na wrak — rekord znajduje go po rodzie.
  const wreck = HullBodies.convertToWreck(e);
  e.dead = true;
  assert.equal(B3.Bridge3D._hostOwns(rec, e), false);
  assert.equal(B3.Bridge3D._findHost(rec, [e, wreck], e), wreck, 'wrak przejmuje rekord');
  B3.refreshBeamBridgeRecordDamage(rec, wreck.beamHull, data, 0.2);
  assert.equal(data[kk * 4], 0, 'wyrwa zostaje na wraku');
  window.wrecks.length = 0;
});

test('hulk drifts with the vent and the agony ends after BRIDGE_HULK_SEC', () => {
  const e = ship('battleship', 0, 0, 0);
  const st = e.bridgeState;
  const p = SB.bridgePngToWorld(e, st.bridges[0].def.x, st.bridges[0].def.y, {});
  SB.noteBridgeHit(e, p.x, p.y, 0, 900, 0);
  killCells(e, 0, 1);
  assert.ok(SB.evaluateShipBridges(e, 0.05) & BRIDGE_EVENT.COMMAND_LOST);
  RT.beginBridgeHulk(e);
  assert.equal(e.isBridgeHulk, true);
  let t = 0.05;
  let done = false;
  for (let i = 0; i < 120 * 5 && !done; i++) {
    t += 1 / 120;
    done = RT.stepBridgeHulk(e, 1 / 120, t);
  }
  assert.ok(done, 'agonia się kończy');
  assert.ok(Math.hypot(e.vx, e.vy) > 1, 'strumień pchnął kadłub');
  SB.releaseShipBridges(e);
  assert.equal(e.isBridgeHulk, false);
});

test('lock on bridge: aim points stay on the bridge; breach aims at the least-blocked bridge cell through a hole', () => {
  const e = ship('battleship', 0, 0, 0);
  const st = e.bridgeState;
  const b = st.bridges[0];
  const shooter = SB.bridgePngToWorld(e, b.def.x, -2000, {});
  for (const mode of ['center', 'centroid', 'exposed', 'breach']) {
    const out = SB.getBridgeAimPoint(e, {}, { mode, fromX: shooter.x, fromY: shooter.y });
    const png = SB.bridgeWorldToPng(e, out.x, out.y, {});
    assert.ok(SB.bridgeZoneDistance(b.def, png.x, png.y) < st.cellSize / st.scaleX, `${mode}: punkt na mostku`);
  }
  // Tunel od burty do mostka i dalej przez środek: linia do środka pusta → faza 2 (komórka mostka).
  const mem = {};
  const a = SB.bridgePngToWorld(e, b.def.x, -400, {});
  const c = SB.bridgePngToWorld(e, b.def.x, 400, {});
  HullBodies.cutSegment(e, a.x, a.y, c.x, c.y, st.cellSize * 0.7);
  const out = SB.getBridgeAimPoint(e, {}, { mode: 'breach', fromX: shooter.x, fromY: shooter.y, memory: mem });
  assert.ok(out, 'jest cel');
  const png = SB.bridgeWorldToPng(e, out.x, out.y, {});
  assert.ok(SB.bridgeZoneDistance(b.def, png.x, png.y) < st.cellSize / st.scaleX, 'cel na mostku');
});

test('small hulls: a zone narrower than a cell still gets the cell under its centre', () => {
  const e = ship('pirate_frigate');
  const b = e.bridgeState.bridges[0];
  assert.ok(b.total >= 1 && !b.missing);
  const { pngWidth } = bridgeHullImage('pirate_frigate');
  assert.ok(e.bridgeState.scaleX > 0 && e.bridgeState.scaleX < 1 && Math.abs(e.bridgeState.scaleX - e.beamHull.srcWidth / pngWidth) < 1e-9);
});
