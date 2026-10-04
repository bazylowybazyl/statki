import test from 'node:test';
import assert from 'node:assert/strict';

// Rdzeń na kadłubie belkowym (src/game/reactorCore.js) na prawdziwych sprite'ach dema rdzenia:
// komora z komórek siatki, pancerz, stany, odcięcie z odłamem, warianty detonacji, fala na
// sąsiadów, strumień, kula plazmy, wybuchy wtórne, lock.
globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const RC = await import('../src/game/reactorCore.js');
const { makeBeamShip, hullImage } = await import('./helpers/reactorHulls.mjs');
const { HULLS } = await import('../dema/rdzen-hulls-data.js');
const D = HullBodies.engine;

const {
  CORE_STATE, attachReactorCores, updateReactorCores, reactorCoreWorld, reactorHull, reactorCellNode,
  detonateReactorNow, applyReactorDetonation, applyReactorBlast, createReactorJet, stepReactorJet,
  createReactorOrb, stepReactorOrbs, planReactorSecondaries, locateReactorCell, getReactorLockPoint,
  forceReactorMeltdown, markReactorChainExposure
} = RC;

function ship(hullId, x = 0, y = 0, angle = 0) {
  const e = makeBeamShip(HullBodies, hullId, x, y, angle);
  const { pngWidth, pngHeight, def } = hullImage(hullId);
  attachReactorCores(e, def.cores, { pngWidth, pngHeight });
  return e;
}

function cleanup(list) {
  for (const e of list) if (e) HullBodies.release(e);
  for (const w of window.wrecks) HullBodies.release(w);
  window.wrecks.length = 0;
}

// Krok gry: ruch encji (x += v dt), silnik belek, rdzenie.
function simulate(list, seconds, onStep = null, dt = 1 / 120) {
  let t = 0;
  const events = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const all = [...list, ...window.wrecks];
    for (const e of all) {
      if (!reactorHull(e)) continue;
      e.x += (e.vx || 0) * dt; e.y += (e.vy || 0) * dt; e.angle += (e.angVel || 0) * dt;
    }
    HullBodies.step(dt, all);
    t += dt;
    for (const e of all) updateReactorCores(e, dt, { time: t, entities: all, events });
    if (onStep) onStep(t, dt, all, events);
  }
  return events;
}

test('komora z komórek siatki: rdzeń w punkcie markera, pancerz × armorMul, koło r', () => {
  const e = ship('battleship', 1e6, 2e6, 0.4);
  try {
    const core = e.reactorCores[0];
    const hull = e.beamHull;
    const { pngWidth, pngHeight } = hullImage('battleship');
    const m = HULLS.battleship.cores[0];
    const sx = m.x * hull.srcWidth / pngWidth * hull.scale;
    const sy = m.y * hull.srcHeight / pngHeight * hull.scale;
    const c = Math.cos(0.4), s = Math.sin(0.4);
    const w = reactorCoreWorld(core, {});
    assert.ok(Math.hypot(w.x - (e.x + c * sx - s * sy), w.y - (e.y + s * sx + c * sy)) < 1.5, `rdzeń w markerze: ${w.x - e.x}, ${w.y - e.y}`);
    const cs = hull.cellSize;
    const expected = Math.PI * core.gridR * core.gridR / (cs * cs);
    const n = core.cellX.length;
    assert.ok(n > expected * 0.6 && n < expected * 1.4, `komórek ${n} ~ ${expected.toFixed(1)}`);
    assert.equal(core.invalid, null);
    const st = hull.body.nodeStore;
    for (let k = 0; k < n; k++) {
      const i = reactorCellNode(hull, core.cellX[k], core.cellY[k]);
      assert.ok(i >= 0, 'komórka komory żywa');
      assert.ok(Math.abs(st.maxHp[i] - core.cellBaseHp[k] * core.armorMul) < 1e-3, 'pancerz komory');
    }
    assert.equal(core.classId, 'capital', `klasa z promienia kadłuba (${e.radius})`);
  } finally { cleanup([e]); }
});

test('stany: wyrwa w komorze → ODSŁONIĘTY → KRYTYCZNY → STOPIENIE → DETONACJA po odliczaniu', () => {
  const e = ship('battleship');
  try {
    const core = e.reactorCores[0];
    const w = reactorCoreWorld(core, {});
    HullBodies.impact(e, w.x, w.y, 1, null, { craterRadius: core.gridR * 0.35 });
    const ev1 = [];
    updateReactorCores(e, 0.1, { time: 0.1, entities: [e], events: ev1 });
    assert.equal(core.state, CORE_STATE.EXPOSED, `po małej wyrwie: ${core.state}, osłona ${core.integrity.toFixed(2)}`);
    assert.ok(ev1.some((ev) => ev.type === 'state' && ev.to === CORE_STATE.EXPOSED));
    HullBodies.impact(e, w.x, w.y, 1, null, { craterRadius: core.gridR * 0.82 });
    const ev2 = [];
    updateReactorCores(e, 0.1, { time: 0.2, entities: [e], events: ev2 });
    assert.ok(core.integrity < 0.6, `osłona ${core.integrity}`);
    assert.ok(core.state === CORE_STATE.CRITICAL || core.state === CORE_STATE.MELTDOWN, core.state);
    HullBodies.impact(e, w.x, w.y, 1, null, { craterRadius: core.gridR * 0.95 });
    const ev3 = [];
    updateReactorCores(e, 0.1, { time: 0.3, entities: [e], events: ev3 });
    assert.equal(core.state, CORE_STATE.MELTDOWN);
    assert.ok(core.pendingVariant, 'wariant wybrany na starcie stopienia');
    const dur = core.meltdownDuration;
    assert.ok(Math.abs(dur - core.profile.meltdownSec) < 1e-9, `odliczanie klasy: ${dur}`);
    const ev4 = [];
    let t = 0.3;
    while (core.state === CORE_STATE.MELTDOWN && t < 10) {
      t += 0.1;
      updateReactorCores(e, 0.1, { time: t, entities: [e], events: ev4 });
    }
    const det = ev4.find((ev) => ev.type === 'detonate');
    assert.ok(det, 'detonacja');
    assert.ok(Math.abs(t - 0.3 - dur) < 0.15, `po odliczaniu (${(t - 0.3).toFixed(2)} vs ${dur})`);
    assert.equal(det.variant, core.pendingVariant);
    assert.ok(det.blast.aoeRadius >= 700 && det.blast.craterRadius > 0);
  } finally { cleanup([e]); }
});

test('odcięcie: komora wycięta z kadłubem → rdzeń przechodzi na wrak, krótsze stopienie, reactorLost', () => {
  const e = ship('battleship');
  try {
    const core = e.reactorCores[0];
    const w = reactorCoreWorld(core, {});
    const h = core.gridR * 1.6;
    // Kwadrat rzazów wokół komory: wyspa z komorą odpada jako odłam.
    const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % 4];
      HullBodies.cutSegment(e, w.x + ax, w.y + ay, w.x + bx, w.y + by, 9);
    }
    const events = simulate([e], 0.3);
    const sev = events.find((ev) => ev.type === 'severed');
    assert.ok(sev, `odcięcie (${events.map((x) => x.type).join(',')})`);
    assert.notEqual(core.host, e, 'rdzeń na wraku');
    assert.ok(core.host.isWreck && reactorHull(core.host), 'nowy gospodarz = odłam z komorą');
    assert.ok(core.severed);
    assert.equal(core.state, CORE_STATE.MELTDOWN);
    assert.ok(Math.abs(core.meltdownDuration - core.meltdownSec * 0.5) < 1e-9, 'stopienie × 0,5');
    assert.ok(events.some((ev) => ev.type === 'reactorLost' && ev.host === e), 'stary gospodarz bez reaktora');
    assert.equal(e.reactorCores.length, 0);
  } finally { cleanup([e]); }
});

const VARIANTS = ['shatter', 'halves', 'thirds', 'hole', 'jet', 'orb'];

function detonateAs(variant, seed = 7, extra = {}) {
  const e = ship('battleship', 0, 0, 0.3);
  const core = e.reactorCores[0];
  const events = detonateReactorNow(core, 1, [], variant);
  const det = events.find((ev) => ev.type === 'detonate');
  const res = applyReactorDetonation(core, det.variant, det.blast, { seed, wrecks: window.wrecks, ...extra });
  return { e, core, det, res };
}

for (const variant of VARIANTS) {
  test(`detonacja „${variant}”: krater wokół rdzenia, rozpad zgodny z wariantem`, () => {
    const debris = [];
    window.spawnHullDebris = (x, y, vx, vy) => debris.push(Math.hypot(vx, vy));
    const { e, core, det, res } = detonateAs(variant);
    try {
      assert.equal(det.variant, variant);
      assert.equal(e.beamHull, null, 'statek oddał kadłub wrakowi');
      assert.ok(res.vaporized > (variant === 'orb' ? 0 : 20), `wyparowało ${res.vaporized}`);
      assert.ok(debris.length >= res.vaporized, 'odłamki z wyparowanych węzłów');
      assert.ok(res.craterR > core.gridR * 0.8, 'krater na miarę komory');
      assert.equal(core.host, res.wreck, 'rdzeń na wraku (model reaktora, strumień)');
      const live = res.fragments.filter((f) => reactorHull(f));
      if (variant === 'shatter') assert.ok(live.length >= 2, `rozprysk: ${live.length}`);
      if (variant === 'halves') assert.ok(live.length >= 2 && res.cuts.length === 4, `przełamanie: ${live.length}`);
      if (variant === 'thirds') assert.ok(live.length >= 3 && res.cuts.length === 12, `rozerwanie: ${live.length}`);
      if (res.keepHost) assert.ok(reactorHull(res.wreck), 'kadłub zostaje wrakiem');
      if (variant === 'jet' || variant === 'orb') {
        assert.ok(Math.abs(Math.hypot(res.dirX, res.dirY) - 1) < 1e-6, 'kierunek wyrzutu');
        assert.ok(res.recoil && (res.recoil.x * res.dirX + res.recoil.y * res.dirY) < 0, 'odrzut przeciw wyrzutowi');
      }
      if (!res.keepHost) {
        for (const f of live) {
          const away = (f.x - res.x) * f.vx + (f.y - res.y) * f.vy;
          assert.ok(away > 0, 'odłam oddala się od rdzenia');
        }
      }
      assert.ok(res.edges.length >= 3 && res.edges.length % 3 === 0, 'brzeg rany dla efektów');
    } finally {
      delete window.spawnHullDebris;
      cleanup([e]);
    }
  });
}

test('detonacja powtarzalna z ziarnem (ten sam rozpad)', () => {
  const a = detonateAs('thirds', 11);
  const ra = { v: a.res.vaporized, f: a.res.fragments.length, cuts: a.res.cuts.slice() };
  cleanup([a.e]);
  const b = detonateAs('thirds', 11);
  try {
    assert.equal(b.res.vaporized, ra.v);
    assert.equal(b.res.fragments.length, ra.f);
    assert.deepEqual(b.res.cuts.map((v) => Math.round(v)), ra.cuts.map((v) => Math.round(v)));
  } finally { cleanup([b.e]); }
});

test('fala: sąsiad dostaje krater od strony wybuchu, znacznik łańcucha i falę na komorę', () => {
  const b = ship('battleship', 700, 0);
  const { e, det, res } = detonateAs('shatter');
  try {
    const nodes0 = b.beamHull.body.activeNodes;
    const cb = b.reactorCores[0];
    const entities = [b, ...window.wrecks];
    const hits = applyReactorBlast(det.blast, res.x, res.y, entities, res.wreck, { time: 1 });
    const hit = hits.find((h) => h.entity === b);
    assert.ok(hit && hit.t > 0, 'sąsiad w zasięgu');
    assert.ok(hit.x < b.x, 'krater po stronie wybuchu');
    assert.ok(b.beamHull.body.activeNodes < nodes0, 'krater w kadłubie sąsiada');
    assert.ok(b.__coreChain && b.__coreChain.depth === 1, 'znacznik łańcucha');
    updateReactorCores(b, 0.1, { time: 1.05, entities });
    assert.ok(cb.integrity < 1, `fala osłabiła komorę: ${cb.integrity}`);
    assert.ok(b.vx > 0, 'pchnięcie od wybuchu');
    assert.ok(!hits.some((h) => h.entity.beamHull?.dmgKey === res.wreck.beamHull?.dmgKey), 'własne odłamy pominięte');
  } finally { cleanup([e, b]); }
});

test('strumień: rzaz w kadłubie na drodze strumienia, trafienia co takt', () => {
  const b = ship('battleship', 900, 0);
  const { e, core, det, res } = detonateAs('jet', 5, { exitDir: { x: 1, y: 0 } });
  try {
    assert.ok(res.dirX > 0.99, 'kierunek wymuszony');
    const nodes0 = b.beamHull.body.activeNodes;
    const jet = createReactorJet(core, res, det.blast);
    const dt = 1 / 120;
    let t = 0;
    while (!jet.done && t < 3) {
      t += dt;
      stepReactorJet(jet, dt, [b, ...window.wrecks], { time: t });
    }
    assert.ok(jet.hits > 5, `takty trafień: ${jet.hits}`);
    assert.ok(b.beamHull && b.beamHull.body.activeNodes < nodes0 - 10, 'rzaz w kadłubie');
    assert.ok(t <= jet.duration + 0.05, 'strumień gaśnie po czasie');
  } finally { cleanup([e, b]); }
});

test('kula plazmy: topi drogę przez własny kadłub, wychodzi i wybucha po zapalniku', () => {
  const { e, core, det, res } = detonateAs('orb', 3, { exitDir: { x: 0, y: 1 } });
  try {
    const orb = createReactorOrb(core, res, det.blast);
    const nodes0 = res.wreck.beamHull.body.activeNodes;
    const dt = 1 / 120;
    let t = 0;
    const events = [];
    while (!orb.detonated && t < 8) {
      t += dt;
      stepReactorOrbs([orb], dt, [...window.wrecks], { time: t, events });
    }
    assert.ok(orb.meltTotal > 0, 'topiła własny kadłub');
    assert.ok(!reactorHull(res.wreck) || res.wreck.beamHull.body.activeNodes < nodes0, 'kanał w kadłubie');
    assert.ok(orb.left, 'wyszła z kadłuba');
    const ev = events.find((x) => x.type === 'orbDetonate');
    assert.ok(ev && ev.blast.variant === 'orb-burst', 'wybuch kuli');
    assert.ok(Math.abs(orb.flight - orb.fuse) < 0.05 || orb.age >= orb.fuse + 3 - 0.05, 'po zapalniku');
  } finally { cleanup([e]); }
});

test('wybuchy wtórne: komórki odłamów, pozycja u obecnego właściciela', () => {
  const { e, core, res } = detonateAs('shatter', 9);
  try {
    const plan = planReactorSecondaries(core, res, { count: 4, seed: 2 });
    assert.equal(plan.length, 4);
    for (let k = 1; k < plan.length; k++) assert.ok(plan[k].delay >= plan[k - 1].delay);
    const loc = locateReactorCell(plan[0].lineage, plan[0].ix, plan[0].iy, window.wrecks, {});
    assert.ok(loc && loc.entity && Number.isFinite(loc.x), 'komórka odnaleziona');
  } finally { cleanup([e]); }
});

test('lock: rdzeń w najgorszym stanie, punkt w komorze; łańcuch: ogniwo ma głębokość', () => {
  const e = ship('pirate_battleship', 0, 0, 1.1);
  try {
    const core = e.reactorCores[0];
    const p = getReactorLockPoint(e, {});
    const w = reactorCoreWorld(core, {});
    assert.ok(p && p.core === core && Math.hypot(p.x - w.x, p.y - w.y) < 1e-6);
    let s = 1;
    const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const q = getReactorLockPoint(e, {}, rng);
    assert.ok(Math.hypot(q.x - w.x, q.y - w.y) <= core.gridR + HullBodies.engine.config.cellSize, 'punkt w komorze');
    markReactorChainExposure(e, 1, 0);
    const ev = forceReactorMeltdown(core, 0.2, 'containment', []);
    assert.equal(core.cause, 'chain');
    assert.equal(core.chainDepth, 1);
    assert.ok(ev.some((x) => x.type === 'state' && x.to === CORE_STATE.MELTDOWN));
  } finally { cleanup([e]); }
});
