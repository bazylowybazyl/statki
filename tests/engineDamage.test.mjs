// Uszkodzenie silników głównych (src/game/engineDamage.js): dysza MAIN nad martwą komórką kadłuba jest
// zniszczona do remontu w doku (zatrzask — odrost komórki jej nie przywraca), ciąg główny × żywe / wszystkie
// w modelu dysz (thrusterModel.js — gracz i dawna ścieżka NPC) i w modelu lotu okrętów misji
// (shipFlightModel.js), sonda zdolności obrotu (headingControl.js) liczy bez zniszczonych dysz.
// Prawdziwe sprite'y i układy z edytora (hardpointEditorDefaults), HullBodies z kraterami i odrostem.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];

const { HullBodies } = await import('../src/game/hullBodies.js');
const { bridgeHullImage } = await import('./helpers/bridgeHulls.mjs');
const { createNpcHardpointRuntime } = await import('../src/game/npcHardpointRuntime.js');
const { SHIP_EDITOR_DEFAULTS } = await import('../src/data/hardpointEditorDefaults.js');
const ED = await import('../src/game/engineDamage.js');
const { computeShipThrusterForces } = await import('../src/game/flight/thrusterModel.js');
const { limitFlightAccel } = await import('../src/game/flight/shipFlightModel.js');
const { resolveShipTurnCapability } = await import('../src/game/flight/headingControl.js');
const { EngineNozzleInternals } = await import('../src/3d/engineVfxSystem.js');

const layouts = createNpcHardpointRuntime({ defaultShips: SHIP_EDITOR_DEFAULTS.ships, storageKey: 'engineDamage.test.none' });
layouts.refreshCache(true);

function ship(key, x = 0, y = 0, angle = 0) {
  const { image, visual, def } = bridgeHullImage(key);
  const kx = image.width / visual.naturalWidth, ky = image.height / visual.naturalHeight;
  const e = {
    id: `ed_${key}`, x, y, vx: 0, vy: 0, angle, angVel: 0, mass: def.npc.mass, hp: 12000, maxHp: 12000,
    type: def.npc.type, isPirate: def.npc.isPirate, shipFrame: def.npc.shipFrame,
    __hardpointScaleX: kx, __hardpointScaleY: ky, __hardpointScale: (kx + ky) * 0.5, visual: { spriteScale: 1 }
  };
  layouts.applyLayoutToNpc(e);
  HullBodies.createHull(e, image, { visualImage: visual, hullProfileId: def.profile });
  return e;
}

// Punkt sprite'a (px renderu od środka, y w dół) → świat gry przy pozie encji.
function spriteToWorld(e, sx, sy) {
  const c = Math.cos(e.angle), s = Math.sin(e.angle);
  return { x: e.x + sx * c - sy * s, y: e.y + sx * s + sy * c };
}

function shootNozzle(e, k) {
  const off = e.visual.mainThrusters[k].offset;
  const p = spriteToWorld(e, off.x, off.y);
  HullBodies.impact(e, p.x, p.y, 1, null, { craterRadius: e.beamHull.cellSize * 2.2 });
}

// Wszystkie dysze MAIN na pełnym gazie wprost (bez odchylenia), boczne wyłączone.
function settleMains(e, throttle = 1) {
  for (const t of e.visual.mainThrusters) {
    t.__throttle = throttle;
    t.nozzleDeg = Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : 90;
  }
  for (const t of e.visual.torqueThrusters || []) t.__throttle = 0;
}

const forces = (e, reverse = 0) => computeShipThrusterForces(e, { mainForceMul: 1, sideForceMul: 1, reverseInput: reverse }, { localFx: 0, localFy: 0, localTorque: 0 });

test('intact hull: every editor MAIN nozzle binds to a hull cell; nothing destroyed, full thrust', () => {
  for (const key of ['atlas', 'terran_carrier', 'destroyer', 'frigate', 'pirate_frigate']) {
    const e = ship(key);
    const n = e.visual.mainThrusters.length;
    assert.ok(n > 0, `${key}: dysze MAIN`);
    assert.equal(ED.stepEngineDamage(e), 0);
    const st = ED.engineDamageState(e);
    assert.equal(st.count, n);
    for (let k = 0; k < n; k++) {
      assert.ok(ED.mainEngineCell(e, k) >= 0, `${key}: dysza ${k} związana z komórką`);
      assert.notEqual(e.visual.mainThrusters[k].__destroyed, true);
    }
    assert.equal(ED.mainEngineFraction(e), 1);
    assert.equal(ED.isMainDriveDestroyed(e), false);
  }
});

test('a nozzle shot off is destroyed; thrust drops to live / all; regrowing the cell does NOT bring it back; dock remont does', () => {
  window.wrecks.length = 0;
  const e = ship('atlas', 7.08e6, 6.29e6, 0.4);
  const n = e.visual.mainThrusters.length;
  ED.stepEngineDamage(e);
  settleMains(e);
  const full = forces(e).localFx;
  assert.ok(full > 0, 'ciąg do przodu');

  shootNozzle(e, 0);
  const lost = ED.stepEngineDamage(e);
  assert.ok(lost >= 1, 'dysza 0 zniszczona');
  assert.equal(e.visual.mainThrusters[0].__destroyed, true);
  const st = ED.engineDamageState(e);
  const live = n - st.dead;
  assert.ok(live < n);
  assert.ok(Math.abs(ED.mainEngineFraction(e) - live / n) < 1e-12);
  settleMains(e);
  const part = forces(e).localFx;
  assert.ok(Math.abs(part - full * live / n) < Math.abs(full) * 1e-9, `ciąg ${part} = ${full} × ${live}/${n}`);

  // Rój dronów odbudowuje kadłub (regrowCell) — komórka pod dyszą znów żyje, dysza zostaje zniszczona.
  const cand = [];
  for (let round = 0; round < 60; round++) {
    const m = HullBodies.regrowCandidates(e, cand);
    if (!m) break;
    for (let i = 0; i < m; i++) HullBodies.regrowCell(e, cand[2 * i], cand[2 * i + 1], { hpMul: 1 });
  }
  ED.stepEngineDamage(e);
  assert.equal(st.set.alive[0], 1, 'komórka pod dyszą odrosła');
  assert.equal(e.visual.mainThrusters[0].__destroyed, true, 'odrost nie przywraca dyszy');
  assert.ok(ED.mainEngineFraction(e) < 1);

  // Remont w doku: kadłub = szablon, zatrzaski zdjęte.
  assert.ok(HullBodies.restoreHull(e) >= 0);
  assert.equal(ED.repairEngines(e), n - live);
  assert.equal(ED.stepEngineDamage(e), 0, 'po remoncie nic nie zatrzaskuje się od nowa');
  for (const t of e.visual.mainThrusters) assert.notEqual(t.__destroyed, true);
  assert.equal(ED.mainEngineFraction(e), 1);
  settleMains(e);
  assert.ok(Math.abs(forces(e).localFx - full) < Math.abs(full) * 1e-9, 'pełny ciąg po remoncie');
});

test('all MAIN nozzles gone: no main thrust (also no synthetic reverse), RCS still strafes; warp/tug flag set', () => {
  const e = ship('atlas');
  ED.stepEngineDamage(e);
  settleMains(e);
  const reverseFull = forces(e, 1).localFx - forces(e, 0).localFx;
  assert.ok(reverseFull < 0, 'obwiednia wstecznego przy sprawnych silnikach');
  assert.equal(ED.destroyMainEngines(e), e.visual.mainThrusters.length);
  assert.equal(ED.isMainDriveDestroyed(e), true);
  assert.equal(ED.mainEngineFraction(e), 0);
  settleMains(e);
  assert.equal(forces(e).localFx, 0, 'bez ciągu głównego');
  assert.equal(forces(e, 1).localFx, 0, 'wsteczny z ciągu głównego też gaśnie');
  // Dysze boczne (RCS) pracują dalej.
  const sides = e.visual.torqueThrusters || [];
  assert.ok(sides.length > 0);
  // Jedna burta (pary z obu burt znoszą się w sumie).
  for (const t of sides) {
    const left = t.side === 'left' || String(t.mount || '').endsWith('_left');
    t.__throttle = left ? 1 : 0; t.__forceScale = 1; t.nozzleDeg = t.baseDeg;
  }
  const f = forces(e);
  assert.ok(Math.abs(f.localFy) > 0, 'RCS daje siłę w bok');
  // Obraz: dysza zniszczona = wycięta (obraz pomija `__destroyed` także przy żywej komórce).
  assert.ok(EngineNozzleInternals.buildSlots(e).filter((s) => s.kind === 'main').every((s) => s.source.__destroyed === true));
});

test('rebuilt thruster array of the same layout keeps the latch; a new hull lineage resets it', () => {
  const e = ship('frigate');
  ED.stepEngineDamage(e);
  ED.destroyMainEngines(e, [0]);
  assert.equal(e.visual.mainThrusters[0].__destroyed, true);
  // Układ odtworzony (np. ponowne nałożenie układu z edytora) — nowe obiekty dysz.
  e.visual.mainThrusters = e.visual.mainThrusters.map((t) => ({ ...t, offset: { ...t.offset }, __destroyed: undefined }));
  ED.stepEngineDamage(e);
  assert.equal(e.visual.mainThrusters[0].__destroyed, true, 'zatrzask przechodzi na nowe obiekty');
  // Nowy kadłub (inny ród) — dysze sprawne.
  const { image, visual, def } = bridgeHullImage('frigate');
  HullBodies.release?.(e);
  HullBodies.createHull(e, image, { visualImage: visual, hullProfileId: def.profile });
  ED.stepEngineDamage(e);
  assert.equal(ED.mainEngineFraction(e), 1);
  assert.notEqual(e.visual.mainThrusters[0].__destroyed, true);
});

test('NPC flight model: forward acceleration × engine fraction; zero = only braking, reverse and strafe', () => {
  const spec = { accel: 100, reverseAccel: 50, strafeAccel: 40, decel: 80 };
  const out = { ax: 0, ay: 0 };
  limitFlightAccel(spec, 0, 0, 0, 500, 0, 1, out);
  assert.equal(out.ax, 100);
  limitFlightAccel(spec, 0, 0, 0, 500, 0, 1, out, 0.5);
  assert.equal(out.ax, 50);
  limitFlightAccel(spec, 0, 0, 0, 500, 0, 1, out, 0);
  assert.equal(out.ax, 0);
  limitFlightAccel(spec, 0, 0, 0, 500, 500, 1, out, 0);
  assert.equal(out.ax, 0);
  assert.equal(out.ay, 40, 'bok bez zmian (RCS)');
  limitFlightAccel(spec, 0, 0, 0, -500, 0, 1, out, 0);
  assert.equal(out.ax, -50, 'wsteczny bez zmian');
  limitFlightAccel(spec, 0, 300, 0, -500, 0, 1, out, 0);
  assert.ok(out.ax <= -80 + 1e-9, 'hamowanie bez zmian');
});

test('turn capability probe drops destroyed MAIN nozzles from vectoring; calibration (intact) ignores them', () => {
  const e = ship('atlas');
  ED.stepEngineDamage(e);
  const drive = { sideForceScale: 1, mainForceScale: 1, shiftBoostMultiplier: 1, turnAccelerationScale: 1, maxTurnSpeedScale: 1 };
  const memo = {};
  const before = resolveShipTurnCapability(e, drive, { mainAssist: true, mainThrottle: 1 }, memo).vectorAccel;
  ED.destroyMainEngines(e);
  const after = resolveShipTurnCapability(e, drive, { mainAssist: true, mainThrottle: 1 }, memo).vectorAccel;
  assert.ok(after < before, `odchylanie MAIN słabsze (${after} < ${before})`);
  const intact = resolveShipTurnCapability(e, drive, { mainAssist: true, mainThrottle: 1, intact: true }, {}).vectorAccel;
  assert.ok(Math.abs(intact - before) < 1e-12, 'kalibracja liczy jak nietknięty kadłub');
});
