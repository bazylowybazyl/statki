import test from 'node:test';
import assert from 'node:assert/strict';

// Wpięcie mechaniki broni z dema w pętlę pocisków gry (zadanie 18-B): PRAWDZIWE
// bulletsAndCollisionsStep z index.html (razem z writeImpactHit, writeImpactRicochet,
// applyBulletHullPass, applyHexImpact) na prawdziwych kadłubach belkowych — przebicia na
// wylot (Mjolnir, Valkyrie), zakleszczenie, rykoszet działek, reszta arsenału jak dotąd.
// Wzorzec przepływu z 18-A (tests/helpers/hullFlight.mjs, flyShot) jest odniesieniem: ten sam
// strzał w te same kadłuby daje w grze te same obrażenia, kratery i zdarzenia.
globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const M = await import('../src/game/projectileMechanics.js');
const { stepProjectileKinematics, shouldRemoveProjectileAfterImpact } = await import('../src/game/projectileTrajectory.js');
const { segmentCircleToi } = await import('../src/physics/physicsKernel.js');
const Carrier = await import('../src/game/carrierVelocity.js');
const { SimClock } = await import('../src/game/simClock.js');
const { createShot, flyShot, ledgerFor } = await import('./helpers/hullFlight.mjs');
const { readIndexHtml, loadIndexFunction } = await import('./helpers/indexSource.mjs');

const html = readIndexHtml();
const MJOLNIR = MASTER_WEAPONS.siege_railgun;
const VALKYRIE = MASTER_WEAPONS.special_valkyrie_railgun;
const VULCAN = MASTER_WEAPONS.vulcan_minigun;
const DT = 1 / 120;

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}
const LONG = plate(400, 200);
const THIN = plate(160, 80);
const THICK = plate(600, 300);

function hullsAt(image, points, angle = 0) {
  return points.map(([x, y]) => {
    const e = { x, y, vx: 0, vy: 0, angle, angVel: 0, mass: 5000, dead: false, isWreck: false, _blkShieldR: 0, shield: null, hpLost: 0 };
    HullBodies.createHull(e, image);
    return e;
  });
}
const releaseAll = (list) => { for (const e of list) HullBodies.release(e); for (const w of window.wrecks) HullBodies.release(w); window.wrecks.length = 0; };

// Stały generator zamiast Math.random (odrzut odłamków w kraterze losuje jak dotąd) — dwa
// przebiegi tego samego strzału porównujemy na tej samej sekwencji.
function withSeed(seed, fn) {
  const random = Math.random;
  let s = seed;
  Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  try { return fn(); } finally { Math.random = random; }
}

// ---------------- pętla pocisków gry w piaskownicy ----------------
const events = [];
const game = {
  bullets: [], npcs: [], wrecks: window.wrecks, ship: null, player2Ship: null, splitScreenMode: false,
  SpatialGrid: {
    list: [], _resultBuffer: [],
    clear() { this.list.length = 0; },
    insert(e) { this.list.push(e); },
    getPotentialTargetsAlongSegment() { this._resultBuffer.length = 0; for (const e of this.list) this._resultBuffer.push(e); return this._resultBuffer.length; },
    getPotentialTargets() { return this.getPotentialTargetsAlongSegment(); }
  },
  stampBulletCollisionRadii() {},
  PerfHUD: { visible: false, addTiming() {} },
  bulletTrailCount: () => 0, spawnBulletTrail() {},
  computeBulletStepBounds() {}, _bulletStepBounds: {}, filterCirclesTouchingBounds: () => 0,
  stations: [], stationCollisionRadius: () => 0, platformCollisionRadius: () => 0,
  _bulletStepStations: [], _bulletStepPlatforms: [], mercMission: null,
  stepProjectileKinematics, SimClock,
  isTargetAlive: () => false, lockedTarget: null, lockedTarget2: null, getTargetX: (t) => t.x, getTargetY: (t) => t.y,
  wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)), SIDE_ROCKET_TURN_RATE: 1,
  flakDetonationReason: () => false, detonateFlakShell() {},
  _pdEnemyRocketBuffer: [],
  ActiveCarrier: Carrier.ActiveCarrier, writeCarrier: Carrier.writeCarrier, writeCarrierVelocity: Carrier.writeCarrierVelocity,
  createCarrier: Carrier.createCarrier,
  _impactCarrier: Carrier.createCarrier(), _impactRelVel: { x: 0, y: 0 },
  _impactHit: { x: 0, y: 0, nx: 0, ny: -1, entity: null, relVx: 0, relVy: 0, kind: 'none', through: false, ric: false, ricDirX: 0, ricDirY: 0, ricSpeed: 0, ricLife: 0 },
  _ricRelVel: { x: 0, y: 0 }, _passCarrier: Carrier.createCarrier(), _passRelVel: { x: 0, y: 0 },
  _hexImpactOpts: { shard: null },
  spawnBulletImpactEffect(b, x, y, scale, hit) {
    events.push({ type: 'impact', x, y, through: !!hit?.through, ric: !!hit?.ric, ricSpeed: hit?.ricSpeed || 0, ricDirX: hit?.ricDirX || 0, ricDirY: hit?.ricDirY || 0, entity: hit?.entity || null });
  },
  WeaponFx: {
    available: true,
    kerf(b, x, y, dx, dy, count, rvx, rvy, hull) { events.push({ type: 'kerf', count, entity: hull }); },
    pierceExit(b, x, y, rvx, rvy, hull) { events.push({ type: 'exit', x, y, damage: b.damage, entity: hull }); },
    pierceStuck(b, x, y, rvx, rvy, hull) { events.push({ type: 'stuck', x, y, entity: hull }); }
  },
  stepInsideHull: M.stepInsideHull, skipsHull: M.skipsHull, resolveHullHit: M.resolveHullHit, entryDamage: M.entryDamage,
  ricochetBounce: M.ricochetBounce,
  HIT_PENETRATE: M.HIT_PENETRATE, HIT_RICOCHET: M.HIT_RICOCHET, PASS_EXIT: M.PASS_EXIT, PASS_STUCK: M.PASS_STUCK, PASS_INSIDE: M.PASS_INSIDE,
  segmentCircleToi, getEntityShieldRadiusTowards: () => 0, isEntityShieldBlocking: () => false,
  HullBodies, DestructorSystem: {}, registerShieldImpact() {}, shieldFxClassForBullet: () => 0,
  noteBridgeHit() {}, bridgeSimTime: 0,
  applyDamageToPlayer() {}, markPlayerDamage() {},
  applyDamageToNPC(npc, dmg) { npc.hpLost += dmg; },
  shouldRemoveProjectileAfterImpact, haloRings: null,
  applyDamageToPlatform() {}, triggerMercAggro() {}, applyDamageToStation() {},
  window: { asteroidField: null, AudioSys: null }
};
const load = (header, name) => { game[name] = loadIndexFunction(html, header, name, game); };
load('function removeBulletAt(index) {', 'removeBulletAt');
load('function hullSweepImpact(entity, x0, y0, x1, y1, radius) {', 'hullSweepImpact');
load('function hexSweepImpact(entity, x0, y0, x1, y1, radius) {', 'hexSweepImpact');
load('function applyHexImpact(entity, x, y, damage, vel, shard) {', 'applyHexImpact');
load('function writeImpactHit(out, entity, x, y, relVx, relVy, kind) {', 'writeImpactHit');
load('function writeImpactRicochet(out, b, node) {', 'writeImpactRicochet');
load('function applyBulletHullPass(b, pass) {', 'applyBulletHullPass');
load('function bulletsAndCollisionsStep(dt, emitTrails = true, trailDt = dt) {', 'bulletsAndCollisionsStep');

// Pocisk jak z fireWeaponCore (pola mechaniki: serial, mech, pen) — bez bornSim (lot od razu).
function gameShot(def, x, y, dirX, dirY, serial) {
  return { ...createShot(def, x, y, dirX, dirY, serial), owner: 'player', source: null, weaponSize: def.size,
    penetration: def.penetration || 0, mech: M.hasHullMechanics(def) ? def : null };
}

// Lot w pętli gry: krok po kroku, dopóki pocisk jest w tablicy.
function flyInGame(b, hulls, maxSteps = 1200) {
  events.length = 0;
  game.npcs.length = 0;
  game.npcs.push(...hulls);
  game.bullets.length = 0;
  game.bullets.push(b);
  let steps = 0;
  for (; steps < maxSteps && game.bullets.includes(b) && b.life > 0; steps++) game.bulletsAndCollisionsStep(DT, false, DT);
  return { alive: game.bullets.includes(b), steps };
}

test('Mjolnir w grze = wzorzec 18-A: pełne 2500 HP w każdym kadłubie kolumny, kratery wejścia i wyjścia, lot dalej', () => {
  const ref = hullsAt(LONG, [[0, 0], [700, 0], [1400, 0]]);
  const inGame = hullsAt(LONG, [[0, 0], [700, 0], [1400, 0]]);
  try {
    const ledger = new Map();
    const refLog = withSeed(7, () => flyShot(createShot(MJOLNIR, -2000, 10, 1, 0, 7), MJOLNIR, ref, { ledger }));
    const b = gameShot(MJOLNIR, -2000, 10, 1, 0, 7);
    const res = withSeed(7, () => flyInGame(b, inGame, 20));
    assert.equal(res.alive, true, 'pocisk leci dalej za kolumną');
    assert.deepEqual(refLog.map((l) => l.type), ['enter', 'exit', 'enter', 'exit', 'enter', 'exit']);
    const gameTypes = events.filter((e) => e.type !== 'kerf').map((e) => e.type);
    assert.deepEqual(gameTypes, ['impact', 'exit', 'impact', 'exit', 'impact', 'exit']);
    assert.ok(events.filter((e) => e.type === 'impact').every((e) => e.through && !e.ric), 'wejście: smuga leci dalej, bez rykoszetu');
    for (let k = 0; k < 3; k++) {
      assert.equal(inGame[k].hpLost, 2500, `kadłub ${k}: pełne obrażenia`);
      assert.equal(inGame[k].hpLost, ledgerFor(ledger, ref[k]).hp);
      assert.equal(inGame[k].beamHull.body.activeNodes, ref[k].beamHull.body.activeNodes, `kadłub ${k}: te same kratery co wzorzec`);
      assert.ok(inGame[k].beamHull.body.activeNodes < inGame[k].beamHull.baseNodes);
    }
    for (const ex of events.filter((e) => e.type === 'exit')) assert.equal(ex.damage, 2500, 'Mjolnir bez utraty energii');
    const kerfs = events.filter((e) => e.type === 'kerf').reduce((a, e) => a + e.count, 0);
    assert.equal(kerfs, ref.reduce((a, e) => a + ledgerFor(ledger, e).kerfs, 0), 'znaki rzazu jak we wzorcu');
    assert.equal(b.pen.count, 3);
  } finally { releaseAll([...ref, ...inGame]); }
});

test('Valkyrie w grze: cienkie kadłuby na wylot z malejącą energią, trzeci zatrzymuje (penetration 3)', () => {
  const hulls = hullsAt(THIN, [[0, 0], [0, 400], [0, 800]]);
  try {
    const b = gameShot(VALKYRIE, 5, -2000, 0, 1, 9);
    const res = withSeed(3, () => flyInGame(b, hulls));
    assert.equal(res.alive, false);
    assert.deepEqual(events.filter((e) => e.type !== 'kerf').map((e) => e.type), ['impact', 'exit', 'impact', 'exit', 'impact']);
    const impacts = events.filter((e) => e.type === 'impact');
    assert.deepEqual(impacts.map((e) => e.through), [true, true, false], 'trzeci kadłub kończy lot (smuga do punktu trafienia)');
    assert.equal(hulls[0].hpLost, 500);
    assert.ok(hulls[1].hpLost < 500 && hulls[1].hpLost > 250, `po pierwszym kadłubie: ${hulls[1].hpLost}`);
    assert.ok(hulls[2].hpLost < hulls[1].hpLost, `po drugim: ${hulls[2].hpLost}`);
    const exits = events.filter((e) => e.type === 'exit');
    assert.equal(hulls[1].hpLost, exits[0].damage, 'obrażenia drugiego = rozliczone po wyjściu z pierwszego');
  } finally { releaseAll(hulls); }
});

test('Valkyrie w grubym kadłubie grzęźnie po 260 j. — zakleszczenie (efekt, krater), pocisk znika', () => {
  const [e] = hullsAt(THICK, [[0, 0]]);
  try {
    const b = gameShot(VALKYRIE, -2000, 10, 1, 0, 11);
    const res = withSeed(5, () => flyInGame(b, [e]));
    assert.equal(res.alive, false);
    const types = events.filter((x) => x.type !== 'kerf').map((x) => x.type);
    assert.deepEqual(types, ['impact', 'stuck']);
    const [impact, stuck] = events.filter((x) => x.type !== 'kerf');
    assert.equal(impact.through, true, 'przy wejściu pocisk leci dalej (w materiale)');
    assert.ok(Math.abs(stuck.x - impact.x - 260) <= e.beamHull.body.cellSize, `zakleszczenie po 260 j.: ${stuck.x - impact.x}`);
    assert.equal(e.hpLost, 500, 'HP tylko przy wejściu');
    assert.equal(stuck.entity, e);
  } finally { releaseAll([e]); }
});

test('rykoszet w grze: płaski kąt — 0,3 obrażeń, pocisk znika, smugowiec z tego samego hasha; prosto w burtę — pełne', () => {
  const e = hullsAt(plate(600, 200), [[0, 0]])[0];
  try {
    const shoot = (deg, serial0, count) => {
      let ric = 0, stop = 0, hp = 0;
      const a = deg * Math.PI / 180;
      for (let k = 0; k < count; k++) {
        const lx = -200 + (400 * k) / count;
        const b = gameShot(VULCAN, lx - Math.sin(a) * 900, 100 + Math.cos(a) * 900, Math.sin(a), -Math.cos(a), serial0 + k);
        const before = e.hpLost;
        withSeed(serial0 + k, () => flyInGame(b, [e], 400));
        const got = e.hpLost - before;
        hp += got;
        const imp = events.find((x) => x.type === 'impact');
        assert.ok(imp, 'każdy strzał kończy się na kadłubie');
        if (imp.ric) {
          ric++;
          assert.ok(Math.abs(got - 4 * 0.3) < 1e-12, 'kadłub dostaje 0,3');
          // Obraz rykoszetu = ricochetBounce z hasha numeru pocisku (ten sam węzeł co decyzja).
          assert.ok(imp.ricSpeed > 0 && imp.ricSpeed <= 4000 * 0.6 + 1e-9);
          // Dolna burta (normalna +y w świecie gry): odbity smugowiec leci od niej, w dół.
          assert.ok(imp.ricDirY > 0, `smugowiec odbity od dolnej burty leci od niej: ${imp.ricDirY}`);
        } else {
          stop++;
          assert.ok(Math.abs(got - 4) < 1e-9, `pełne obrażenia: ${got}`);
        }
        assert.equal(game.bullets.length, 0, 'pocisk znika');
      }
      return { ric, stop, hp };
    };
    const straight = shoot(0, 1, 60);
    assert.equal(straight.ric, 0);
    assert.equal(straight.hp, 240);
    const glancing = shoot(78, 5000, 120);
    assert.ok(glancing.ric > 40 && glancing.ric < 100, `rykoszety na płaskim kącie: ${glancing.ric}/120`);
    // Ta sama decyzja co moduł (flyShot na świeżym kadłubie z tymi samymi numerami pocisków).
    const ref = hullsAt(plate(600, 200), [[0, 0]])[0];
    try {
      let refRic = 0;
      const a = 78 * Math.PI / 180;
      for (let k = 0; k < 120; k++) {
        const lx = -200 + (400 * k) / 120;
        const b = createShot(VULCAN, lx - Math.sin(a) * 900, 100 + Math.cos(a) * 900, Math.sin(a), -Math.cos(a), 5000 + k);
        withSeed(5000 + k, () => { for (const l of flyShot(b, VULCAN, [ref])) if (l.type === 'ricochet') refRic++; });
      }
      assert.equal(glancing.ric, refRic, 'gra i wzorzec 18-A rozstrzygają tak samo');
    } finally { releaseAll([ref]); }
  } finally { releaseAll([e]); }
});

test('reszta arsenału jak dotąd: pierwszy kadłub zatrzymuje, pełne obrażenia, bez rykoszetu i przebicia', () => {
  for (const id of ['armata_mk1', 'railgun_mk2', 'special_yamato_cannon', 'heavy_autocannon_l', 'helios_laser']) {
    const def = MASTER_WEAPONS[id];
    const hulls = hullsAt(LONG, [[0, 0], [700, 0]]);
    try {
      const b = gameShot(def, -1500, 10, 1, 0, 42);
      assert.equal(b.mech, null, `${id}: bez mechaniki kadłuba`);
      withSeed(9, () => flyInGame(b, hulls));
      assert.equal(game.bullets.length, 0, `${id}: pocisk znika na pierwszym kadłubie`);
      assert.deepEqual(events.map((e) => e.type), ['impact']);
      assert.equal(events[0].through, false);
      assert.equal(events[0].ric, false);
      assert.equal(hulls[0].hpLost, def.baseDamage);
      assert.equal(hulls[1].hpLost, 0);
    } finally { releaseAll(hulls); }
  }
});

test('źródło: fireWeaponCore nadaje numer i dane mechaniki; pętla pocisków bierze decyzję z resolveHullHit', () => {
  const fire = html.slice(html.indexOf('window.fireWeaponCore = function'), html.indexOf('function updateSpecialWeaponCooldowns'));
  assert.match(fire, /serial: nextProjectileSerial\(\)/);
  assert.match(fire, /mech: hasHullMechanics\(weapon\) \? weapon : null/);
  const step = html.slice(html.indexOf('function bulletsAndCollisionsStep('));
  assert.match(step, /if \(b\.pen && skipsHull\(b, realNpc\)\) continue;/);
  assert.match(step, /resolveHullHit\(b, mech, _impactHit, _impactRelVel, hitNode, realHit, hitX, hitY\)/);
  // Droga w materiale liczona PRZED kraterem wejścia (18-A, decyzja 2).
  const i = step.indexOf('pass = stepInsideHull(b, mech);');
  const j = step.indexOf('applyHexImpact(realHit, hitX, hitY, npcDamage * entryK.crater');
  assert.ok(i > 0 && j > i, 'stepInsideHull przed applyHexImpact');
});
