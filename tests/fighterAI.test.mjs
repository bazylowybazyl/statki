import test from 'node:test';
import assert from 'node:assert/strict';

import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { FIGHTER_SQUADRON_DEFS, getFighterSquadronDef, STRIKE_CRAFT_DOCTRINES } from '../src/data/fighterSquadrons.js';
import { SUPPORT_SHIP_TEMPLATES } from '../src/data/ships.js';
import { SHIP_FLIGHT_SPECS } from '../src/data/shipFlightSpecs.js';
import {
  stepFighterFlight, setFighterIntent, fighterFlightSpec, fighterTurnRadius, FIGHTER_FLIGHT_TUNE
} from '../src/game/flight/fighterFlight.js';

// fighterAI.js i aiUtils.js publikują się przez `window` w module scope, więc
// stub musi istnieć PRZED importem.
const world = { npcs: [], ship: null, shots: [], drops: [], landed: [] };

const isFighterLike = (u) => !!u && (u.fighter || u.type === 'fighter' || u.type === 'interceptor');

globalThis.window = {
  MASTER_WEAPONS,
  get npcs() { return world.npcs; },
  get ship() { return world.ship; },
  wrapAngle: (a) => {
    let d = a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  },
  getUnitKind: (u) => isFighterLike(u) ? 'fighter' : 'other',
  isEnemyUnit: (a, b) => !!a && !!b && !b.dead && a !== b && !!a.friendly !== !!b.friendly,
  isLineOfFireBlocked: () => false,
  spawnBulletAdapter: (owner, target, def) => { world.shots.push({ owner, target, def, x: owner.x, y: owner.y, angle: owner.angle }); },
  aiPickBestTarget: null,
  applySeparationForces: null,
  queryAIGrid: null
};

// Prawdziwy scoring — testy celowania mają sprawdzać integrację, nie atrapę.
const { aiPickBestTarget, scoreAiTarget } = await import('../src/ai/aiUtils.js');
window.aiPickBestTarget = aiPickBestTarget;
const restorePicker = () => { window.aiPickBestTarget = aiPickBestTarget; };

const { runAdvancedFighterAI, steerFighter, fighterEnvelope, resolveFighterTarget, nextGunCooldown, FIGHTER_AI_TUNE } =
  await import('../src/ai/fighterAI.js');

// Siatka AI z listy świata (myśliwce na ogonie, wieżyczki samoobrony).
const gridBuf = [];
function fakeGrid(x, y, r) {
  gridBuf.length = 0;
  for (const u of world.npcs) {
    if (!u || u.dead) continue;
    if (Math.hypot(u.x - x, u.y - y) <= r) gridBuf.push(u);
  }
  return { buffer: gridBuf, count: gridBuf.length };
}

let nextId = 1;
function makeFighter(squadronId, overrides = {}) {
  const def = getFighterSquadronDef(squadronId);
  return Object.assign({
    id: nextId++,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    fighter: true,
    type: squadronId === 'interceptor' ? 'interceptor' : 'fighter',
    squadronId: def.id,
    friendly: true,
    hp: def.hp,
    maxHp: def.hp,
    accel: def.accel,
    maxSpeed: def.maxSpeed,
    turn: def.turn,
    radius: def.radius,
    gun: def.weaponId,
    msl: def.missileId,
    mslAmmo: def.missileAmmo,
    gunCD: 0,
    mslCD: 0
  }, overrides);
}

function makeEnemyFighter(x, y, overrides = {}) {
  return Object.assign({
    id: nextId++,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    fighter: true,
    type: 'interceptor',
    friendly: false,
    hp: 80,
    radius: 12
  }, overrides);
}

function makeCapital(x, y, overrides = {}) {
  return Object.assign({
    id: nextId++, x, y, vx: 0, vy: 0, angle: 0, friendly: false, isPirate: true,
    type: 'battleship', isCapitalShip: true, radius: 140, hp: 30000, maxHp: 30000,
    // Atrapa obrysu: kadłub 1600 × 500 wzdłuż kursu.
    __halfLen: 800, __halfWid: 250
  }, overrides);
}

// Geometria i „nad kadłubem” dla atrap okrętów (w grze: index.html z obrysu tarczy / HullBodies.probe).
window.getFighterTargetGeom = (t, out) => {
  if (!t || !t.__halfLen) return false;
  out.halfLen = t.__halfLen; out.halfWid = t.__halfWid; out.axis = t.angle || 0; out.r = t.__halfLen;
  return true;
};
window.fighterOverHull = (t, x, y) => {
  if (!t.__halfLen) return Math.hypot(x - t.x, y - t.y) <= (t.radius || 50);
  const c = Math.cos(-(t.angle || 0));
  const s = Math.sin(-(t.angle || 0));
  const lx = (x - t.x) * c - (y - t.y) * s;
  const ly = (x - t.x) * s + (y - t.y) * c;
  return Math.abs(lx) <= t.__halfLen && Math.abs(ly) <= t.__halfWid;
};

const dist = (a, b) => Math.hypot(
  (b.pos ? b.pos.x : b.x) - a.x,
  (b.pos ? b.pos.y : b.y) - a.y
);
const wrap = (a) => window.wrapAngle(a);

/**
 * Mini-symulacja jak w grze: krok fizyki 60 Hz, mózg 20 Hz (co 3. krok), pilot i ruch w każdym kroku.
 * `others` ruszają się swoją prędkością. `onTick(t)` — po każdym kroku.
 */
function simulate(fighters, seconds, { hz = 60, others = [], onTick = null, brainEvery = null } = {}) {
  const dt = 1 / hz;
  const every = brainEvery || Math.max(1, Math.round(hz / 20));
  const steps = Math.round(seconds * hz);
  for (let i = 0; i < steps; i++) {
    if (i % every === 0) for (const f of fighters) if (!f.dead) runAdvancedFighterAI(f, every * dt);
    for (const f of fighters) {
      if (f.dead) continue;
      stepFighterFlight(f, dt);
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    for (const o of others) {
      if (o.dead || o.fighter) continue;
      o.x += (o.vx || 0) * dt;
      o.y += (o.vy || 0) * dt;
    }
    if (onTick) onTick(i * dt);
  }
}

function resetWorld() {
  world.npcs = [];
  world.ship = null;
  world.shots = [];
  world.drops = [];
  world.landed = [];
  window.queryAIGrid = null;
  delete window.FighterBombs;
  delete window.landFighter;
  delete window.SQUAD;
  restorePicker();
}

// ---------------------------------------------------------------------------
// Skala prędkości i role

test('fighters outrun the hulls they escort; strike craft are slower than fighters but beat the Atlas boost', () => {
  const frigate = SUPPORT_SHIP_TEMPLATES.frigate_pd.stats;
  const atlasBoost = SHIP_FLIGHT_SPECS.atlas.boostSpeed;
  for (const def of Object.values(FIGHTER_SQUADRON_DEFS)) {
    const heavy = STRIKE_CRAFT_DOCTRINES.has(def.doctrine);
    // Myśliwiec ~1,6–2× fregata (proporcja Starsectora); bombowiec i kanonierka szybsze od fregaty.
    assert.ok(def.maxSpeed > frigate.maxSpeed * (heavy ? 1.1 : 1.6), `${def.id}: za wolny względem fregaty`);
    assert.ok(def.maxSpeed > atlasBoost, `${def.id} (${def.maxSpeed}) nie nadąży za Atlasem na dopalaczu (${atlasBoost})`);
    assert.ok(def.accel > 0 && def.flight?.latAccel > 0 && def.flight?.maxTurnDeg > 0, `${def.id}: karta lotu`);
    assert.ok(def.doctrine, `${def.id}: doktryna`);
  }
  const D = FIGHTER_SQUADRON_DEFS;
  assert.ok(D.interceptor.maxSpeed > D.multirole.maxSpeed);
  assert.ok(D.multirole.maxSpeed > D.strike.maxSpeed);
  assert.ok(D.strike.maxSpeed > D.torpedo.maxSpeed);
  assert.ok(D.torpedo.maxSpeed > D.bomber.maxSpeed);
  assert.ok(D.bomber.maxSpeed > D.gunship.maxSpeed);
  // Zwrotność: przechwytujący najzwrotniejszy, bombowiec najmniej.
  assert.ok(D.interceptor.flight.latAccel > D.multirole.flight.latAccel);
  assert.ok(D.multirole.flight.latAccel > D.bomber.flight.latAccel);
});

// ---------------------------------------------------------------------------
// Pilot (src/game/flight/fighterFlight.js)

test('pilot accelerates with the squadron accel instead of snapping to top speed', () => {
  const npc = makeFighter('multirole');
  const dt = 1 / 60;
  setFighterIntent(npc, npc.maxSpeed, 0);
  stepFighterFlight(npc, dt);
  const afterOneTick = Math.hypot(npc.vx, npc.vy);
  assert.ok(afterOneTick > 0, 'myśliwiec musi ruszyć');
  assert.ok(afterOneTick <= npc.accel * dt + 1e-6, `jeden krok to najwyżej accel*dt (dostał ${afterOneTick})`);

  for (let i = 0; i < 120; i++) stepFighterFlight(npc, dt);
  assert.ok(Math.abs(Math.hypot(npc.vx, npc.vy) - npc.maxSpeed) < 1, 'w 2 s dobija do prędkości maksymalnej');

  setFighterIntent(npc, 200, 0);
  for (let i = 0; i < 120; i++) stepFighterFlight(npc, dt);
  assert.ok(Math.abs(Math.hypot(npc.vx, npc.vy) - 200) < 1, 'zwalnia, gdy mózg prosi o wolniej');
});

test('pilot starts from rest in the requested direction, not heading 0', () => {
  const npc = makeFighter('multirole');
  steerFighter(npc, 0, -npc.maxSpeed, 1 / 60, 300);   // dawne API mózgu = zamiar
  stepFighterFlight(npc, 1 / 60);
  assert.ok(npc.vy < 0, 'ruch musi iść w żądaną stronę');
  assert.ok(Math.abs(npc.vx) < 1e-6, 'bez dryfu w bok');
});

test('turning is limited by lateral acceleration: the turn radius is at least v²/latAccel', () => {
  const npc = makeFighter('multirole');
  const spec = fighterFlightSpec(npc);
  const v = spec.maxSpeed;
  npc.vx = v;
  npc.vy = 0;
  // Zamiar: zawróć (cel za plecami) — pełny skręt.
  setFighterIntent(npc, -v, 1);
  const dt = 1 / 60;
  let heading = 0;
  let maxRate = 0;
  for (let i = 0; i < 60; i++) {
    stepFighterFlight(npc, dt);
    const h = Math.atan2(npc.vy, npc.vx);
    maxRate = Math.max(maxRate, Math.abs(wrap(h - heading)) / dt);
    heading = h;
  }
  const omegaMax = Math.min(spec.maxTurn, spec.latAccel / v);
  assert.ok(maxRate <= omegaMax * 1.001, `tempo skrętu ${maxRate.toFixed(3)} > sufit ${omegaMax.toFixed(3)} rad/s`);
  assert.ok(fighterTurnRadius(spec, v) >= v * v / spec.latAccel * 0.999, 'promień skrętu ≥ v²/a');
  // Dawny model: 450°/s przy 2800 j/s (przeciążenie boczne ~22 tys.). Teraz wyraźnie poniżej.
  assert.ok(v * maxRate < 9000, `przeciążenie boczne ${Math.round(v * maxRate)} j/s²`);
});

test('turn rate builds up gradually (no kink in the path)', () => {
  const npc = makeFighter('bomber');
  const spec = fighterFlightSpec(npc);
  npc.vx = 1500;
  npc.vy = 0;
  setFighterIntent(npc, 0, 1500);
  const dt = 1 / 60;
  stepFighterFlight(npc, dt);
  const firstRate = Math.abs(Math.atan2(npc.vy, npc.vx)) / dt;
  assert.ok(firstRate <= spec.rollAccel * dt + 1e-9, `pierwszy krok skrętu ${firstRate} > rollAccel·dt`);
});

test('pilot gives the same flight at 60 and 120 Hz physics', () => {
  const run = (hz) => {
    const npc = makeFighter('interceptor', { vx: 1200, vy: 0 });
    const dt = 1 / hz;
    for (let i = 0; i < hz * 2; i++) {
      // Zamiar zmienia się jak w grze — co 50 ms (20 Hz mózgu).
      if (i % Math.round(hz / 20) === 0) {
        const t = i * dt;
        setFighterIntent(npc, Math.cos(t * 1.7) * 3000, Math.sin(t * 1.7) * 3000);
      }
      stepFighterFlight(npc, dt);
      npc.x += npc.vx * dt;
      npc.y += npc.vy * dt;
    }
    return npc;
  };
  const a = run(60);
  const b = run(120);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 120, `rozjazd torów ${Math.round(Math.hypot(a.x - b.x, a.y - b.y))} j. po 2 s`);
  assert.ok(Math.abs(Math.hypot(a.vx, a.vy) - Math.hypot(b.vx, b.vy)) < 60);
});

test('the nose follows the velocity; an aim request can slip it only a little', () => {
  const npc = makeFighter('multirole', { vx: 2000, vy: 0, angle: 0 });
  setFighterIntent(npc, 2000, 0, Infinity, Math.PI / 2);   // nos chce patrzeć w bok
  for (let i = 0; i < 60; i++) stepFighterFlight(npc, 1 / 60);
  const slip = Math.abs(wrap(npc.angle - Math.atan2(npc.vy, npc.vx)));
  assert.ok(slip <= FIGHTER_FLIGHT_TUNE.slipMax + 1e-6, `poślizg nosa ${slip}`);
  assert.ok(slip > 0.1, 'zamiar celowania odchyla nos');
  setFighterIntent(npc, 2000, 0);
  for (let i = 0; i < 60; i++) stepFighterFlight(npc, 1 / 60);
  assert.ok(Math.abs(wrap(npc.angle - Math.atan2(npc.vy, npc.vx))) < 0.02, 'bez zamiaru nos wraca na kurs');
});

// ---------------------------------------------------------------------------
// Obwiednia i cele

test('engagement envelope scales with gun range, speed and turn radius', () => {
  const multirole = fighterEnvelope(makeFighter('multirole'));
  const strike = fighterEnvelope(makeFighter('strike'));

  assert.equal(multirole.gunRange, MASTER_WEAPONS.ciws_mk1.baseRange);
  assert.ok(multirole.dogfightEnter > multirole.gunRange, 'kocioł zaczyna się poza zasięgiem ognia');
  assert.ok(multirole.dogfightExit > multirole.dogfightEnter * 1.5, 'histereza wejścia/wyjścia');
  assert.ok(multirole.dogfightEnter > 1500, 'obwiednia nie może zostać przy starych 600 u');
  assert.ok(strike.dogfightEnter > multirole.dogfightEnter, 'dłuższe działko — szerszy kocioł');
  // Dobieg po przelocie dłuższy niż promień nawrotu — nawrót nie zaczyna się nad kadłubem.
  assert.ok(multirole.extend > multirole.turnR, 'dobieg > promień skrętu');
  assert.ok(multirole.strafeExit > multirole.extend + multirole.gunRange, 'wyjście z przelotu dalej niż dobieg');
});

test('an enemy fighter escorting the player wins over the player itself', () => {
  resetWorld();
  const pirate = makeFighter('interceptor', { x: 0, y: 0, friendly: false });
  const env = fighterEnvelope(pirate);
  const player = { pos: { x: 6000, y: 0 }, vx: 0, vy: 0, friendly: true, dead: false, radius: 300 };
  world.ship = player;
  const escort = makeFighter('multirole', { x: 5600, y: 300, friendly: true });
  world.npcs = [escort];
  assert.equal(resolveFighterTarget(pirate, player, 16000, env), escort, 'myśliwiec eskorty musi przebić gracza');
  world.npcs = [];
  assert.equal(resolveFighterTarget(pirate, null, 16000, env), player, 'bez myśliwców gracz jest legalnym celem');
  resetWorld();
});

test('a fighter on our tail overrides the wing leader order', () => {
  resetWorld();
  const pirate = makeFighter('interceptor', { x: 0, y: 0, friendly: false });
  const env = fighterEnvelope(pirate);
  const player = { pos: { x: 9000, y: 0 }, vx: 0, vy: 0, friendly: true, dead: false, radius: 300 };
  world.ship = player;
  const leader = makeFighter('interceptor', { x: -400, y: 0, friendly: false });
  leader.target = player;
  pirate.squad = { leader };
  const onTail = makeFighter('multirole', { x: env.dogfightEnter * 0.5, y: 0, friendly: true });
  world.npcs = [onTail, leader];
  assert.equal(resolveFighterTarget(pirate, player, 16000, env), onTail, 'samoobrona bije rozkaz skrzydła');
  resetWorld();
});

test('committed fighters still ignore an equivalent alternative', () => {
  resetWorld();
  const npc = makeFighter('multirole');
  const env = fighterEnvelope(npc);
  const current = makeEnemyFighter(3000, 0);
  const sibling = makeEnemyFighter(2700, 0);
  world.npcs = [current, sibling];
  window.aiPickBestTarget = () => sibling;
  assert.equal(resolveFighterTarget(npc, current, 16000, env), current, 'równoważny cel nie przerywa ataku');
  resetWorld();
});

test('target commitment: a marginally closer enemy does not break off the attack', () => {
  resetWorld();
  const npc = makeFighter('multirole');
  const env = fighterEnvelope(npc);
  const current = makeEnemyFighter(3000, 0);
  const slightlyCloser = makeEnemyFighter(2700, 0);
  const muchCloser = makeEnemyFighter(900, 0);
  world.npcs = [current, slightlyCloser];
  window.aiPickBestTarget = () => slightlyCloser;
  assert.equal(resolveFighterTarget(npc, current, 16000, env), current, 'zmiana celu o 10% to szum');
  world.npcs = [current, muchCloser];
  window.aiPickBestTarget = () => muchCloser;
  assert.equal(resolveFighterTarget(npc, current, 16000, env), muchCloser, 'wyraźnie bliższy cel przejmuje atak');
  assert.equal(resolveFighterTarget(npc, null, 16000, env), muchCloser, 'bez celu bierzemy najlepszego');
  resetWorld();
});

test('strike craft never take fighters as targets; interceptors go for the strike craft first', () => {
  resetWorld();
  const bomber = makeFighter('bomber', { friendly: true });
  const enemyFighter = makeEnemyFighter(800, 0);
  const enemyShip = makeCapital(9000, 0);
  assert.equal(scoreAiTarget(bomber, enemyFighter), -Infinity, 'bombowiec nie poluje na myśliwce');
  world.npcs = [enemyFighter, enemyShip];
  assert.equal(aiPickBestTarget(bomber, 16000), enemyShip, 'bombowiec wybiera okręt');
  const env = fighterEnvelope(bomber);
  assert.equal(resolveFighterTarget(bomber, null, 16000, env), enemyShip, 'samoobrona nie przestawia bombowca na myśliwca');

  const interceptor = makeFighter('interceptor', { friendly: true });
  const enemyBomber = makeFighter('bomber', { friendly: false, x: 3000, y: 0 });
  const enemyMultirole = makeFighter('multirole', { friendly: false, x: 0, y: 3000 });
  world.npcs = [enemyMultirole, enemyBomber];
  assert.equal(aiPickBestTarget(interceptor, 16000), enemyBomber, 'przechwytujący bije bombowiec przed myśliwcem');
  resetWorld();
});

// ---------------------------------------------------------------------------
// Kocioł

test('a fighter surrounded by ENEMY fighters keeps fighting instead of breaking off', () => {
  resetWorld();
  const npc = makeFighter('multirole', { x: 0, y: 0, vx: 2000, vy: 0, state: 'dogfight3D', sub: 'pursuit' });
  const target = makeEnemyFighter(400, 0);
  const crowd = [target];
  for (let i = 0; i < 6; i++) crowd.push(makeEnemyFighter(Math.cos(i) * 120, Math.sin(i) * 120));
  world.npcs = crowd;
  npc.target = target;
  npc.targetCommitT = 5;
  npc.retargetTimer = 5;
  for (let i = 0; i < 30; i++) runAdvancedFighterAI(npc, 1 / 60);
  assert.equal(npc.state, 'dogfight3D', 'zostaje w kotle');
  assert.notEqual(npc.sub, 'break_off', 'obecność WROGÓW nie jest powodem do zerwania walki');
  resetWorld();
});

test('an enemy fighter on our tail triggers a defensive break toward the attacker', () => {
  resetWorld();
  const npc = makeFighter('multirole', { x: 0, y: 0, vx: 2000, vy: 0, angle: 0 });
  const target = makeEnemyFighter(2000, 600, { vx: 1500, vy: 0 });
  // Napastnik 700 j. za nami, nosem w nas.
  const attacker = makeEnemyFighter(-700, 0, { vx: 2200, vy: 0, angle: 0 });
  world.npcs = [npc, target, attacker];
  window.queryAIGrid = fakeGrid;
  npc.target = target;
  npc.targetCommitT = 9;
  npc.retargetTimer = 9;
  npc.state = 'dogfight3D';
  npc.sub = 'pursuit';
  runAdvancedFighterAI(npc, 0.05);
  assert.equal(npc.sub, 'defend', 'obrona przed myśliwcem na ogonie');
  // Skręt ostry w bok (zamiar ~90–100° od kursu), nie ucieczka na wprost.
  const want = Math.atan2(npc.__flWy, npc.__flWx);
  assert.ok(Math.abs(wrap(want)) > 1.2, `zamiar obrony ${want.toFixed(2)} rad od kursu`);
  resetWorld();
});

test('a fighter closes on its target, gets it in the gun cone and fires', () => {
  resetWorld();
  const npc = makeFighter('multirole', { x: 0, y: 0, vx: 300, vy: 0 });
  const target = makeEnemyFighter(6000, 1500, { vx: 900, vy: 0 });
  world.npcs = [npc, target];
  npc.target = target;
  npc.targetCommitT = 30;
  npc.retargetTimer = 30;
  window.aiPickBestTarget = () => target;
  let closest = Infinity;
  simulate([npc], 12, { others: [target], onTick: () => { target.angle = 0; closest = Math.min(closest, dist(npc, target)); } });
  const env = fighterEnvelope(npc);
  assert.ok(closest < env.gunRange, `myśliwiec musi wejść w zasięg ognia (najbliżej ${Math.round(closest)} u)`);
  assert.ok(world.shots.some((s) => s.owner === npc && s.target === target), 'strzela do celu');
  resetWorld();
});

test('a fighter with no target flies formation on its leader and faces its travel direction', () => {
  resetWorld();
  const leader = { x: 5000, y: 0, angle: 0, dead: false, radius: 300 };
  const npc = makeFighter('multirole', {
    x: 0, y: 0, vx: 0, vy: 0, squad: { leader }, formationOffset: { x: -200, y: 120 }, desiredAngle: Math.PI
  });
  world.npcs = [npc];
  simulate([npc], 1.2);
  assert.equal(npc.state, 'guard');
  assert.ok(npc.x > 500, 'musi lecieć w stronę lidera');
  assert.ok(Math.abs(wrap(npc.angle - Math.atan2(npc.vy, npc.vx))) < 0.2, 'nos nadąża za wektorem prędkości');
  resetWorld();
});

// ---------------------------------------------------------------------------
// Kadencja działka a rytm mózgu (20 Hz = tick 0,05 s)

test('nextGunCooldown carries the late part of one brain tick, never more', () => {
  const dt = 0.05;
  assert.ok(Math.abs(nextGunCooldown(-0.03, 0.06, dt) - 0.03) < 1e-12);
  assert.equal(nextGunCooldown(-dt, 0.06, dt), 0.06);
  assert.equal(nextGunCooldown(-0.5, 0.06, dt), 0.06);
});

test('fighter gun fires at the weapon rate, not rounded up to the 20 Hz brain tick', () => {
  resetWorld();
  const gunDef = MASTER_WEAPONS.ciws_mk1;
  const npc = makeFighter('multirole', { mslAmmo: 0, gunCD: 0 });
  const target = makeEnemyFighter(600, 0);
  world.npcs = [npc, target];
  npc.target = target;
  npc.targetCommitT = 99;
  npc.retargetTimer = 99;
  let gunShots = 0;
  const realAdapter = window.spawnBulletAdapter;
  window.spawnBulletAdapter = (owner, t, def) => { if (def === gunDef) gunShots++; };
  try {
    const dt = 0.05;
    const seconds = 3;
    for (let i = 0; i < seconds / dt; i++) {
      runAdvancedFighterAI(npc, dt);
      npc.x = 0; npc.y = 0; npc.angle = 0; // cel stale w stożku i zasięgu
    }
    const expected = seconds / gunDef.cooldown;
    assert.ok(gunShots >= expected - 2 && gunShots <= expected + 1,
      `ciws_mk1 powinien oddać ~${expected} strzałów w ${seconds} s, oddał ${gunShots}`);
  } finally {
    window.spawnBulletAdapter = realAdapter;
    resetWorld();
  }
});

test('a friendly fighter with nothing in range reaches only as far as its leash', () => {
  resetWorld();
  const npc = makeFighter('multirole', { x: 0, y: 0 });
  const env = fighterEnvelope(npc);
  const farAway = makeEnemyFighter(60000, 0);
  const justOutside = makeEnemyFighter(18000, 0);
  world.npcs = [farAway, justOutside];
  assert.equal(resolveFighterTarget(npc, null, 16000, env), justOutside, 'cel tuż za zasięgiem, ale w smyczy');
  world.npcs = [farAway];
  assert.equal(resolveFighterTarget(npc, null, 16000, env), null, 'wróg daleko poza smyczą nie jest celem');
  resetWorld();
});

test('pirate guard orbit follows AI decision ticks, not the wall clock', () => {
  resetWorld();
  const station = { x: 0, y: 0 };
  const npc = makeFighter('interceptor', {
    id: 'pirate_guard', friendly: false, isPirate: true,
    guardStation: station, guardOrbitRadius: 350, guardOrbitSpeed: 0.3, guardPhase: 0.5,
    retargetTimer: 99
  });
  npc.squad = { leader: npc };
  world.npcs = [npc];
  const placeOnOrbit = (tick) => {
    const angle = 0.5 + (tick / 20) * 0.3;
    npc.x = Math.cos(angle) * 350;
    npc.y = Math.sin(angle) * 350;
    return angle;
  };
  const expectTangent = (angle) => {
    const err = wrap(npc.desiredAngle - (angle + Math.PI / 2));
    assert.ok(Math.abs(err) < 1e-9, `kurs styczny do orbity (błąd ${err})`);
  };
  try {
    window.__aiDecisionHz = 20;
    window.__aiDecisionTickId = 40;
    const a40 = placeOnOrbit(40);
    runAdvancedFighterAI(npc, 0.05);
    expectTangent(a40);
    placeOnOrbit(40);
    runAdvancedFighterAI(npc, 0.05);
    expectTangent(a40);
    window.__aiDecisionTickId = 60;
    const a60 = placeOnOrbit(60);
    runAdvancedFighterAI(npc, 0.05);
    expectTangent(a60);
  } finally {
    delete window.__aiDecisionHz;
    delete window.__aiDecisionTickId;
    resetWorld();
  }
});

// ---------------------------------------------------------------------------
// Role: przelot, bombowiec, torpedowiec, kanonierka

// Zawrotki: kurs prędkości obrócony o > 150° w ciągu 1,2 s (jak w pomiarze w grze).
function countReversals(samples, physHz = 60) {
  let n = 0;
  let last = -1e9;
  const back = Math.round(1.2 * physHz);
  for (let k = 0; k < samples.length; k++) {
    const t = k / physHz;
    if (t - last < 1.2) continue;
    for (let j = k - 1; j >= Math.max(0, k - back); j -= 3) {
      if (Math.abs(wrap(samples[k] - samples[j])) > 150 * Math.PI / 180) { n++; last = t; break; }
    }
  }
  return n;
}

test('strafing runs extend past the target instead of ping-ponging over it', () => {
  resetWorld();
  const ship = makeCapital(0, 0);
  const npc = makeFighter('multirole', { x: -9000, y: 2000, vx: 2000, vy: 0 });
  world.npcs = [npc, ship];
  npc.target = ship;
  npc.targetCommitT = 999;
  npc.retargetTimer = 999;
  const headings = [];
  let passes = 0;
  let prevSub = '';
  simulate([npc], 60, {
    onTick: () => {
      headings.push(Math.atan2(npc.vy, npc.vx));
      if (npc.state === 'strafe' && npc.sub === 'out' && prevSub !== 'out') passes++;
      prevSub = npc.sub;
    }
  });
  const perMin = countReversals(headings);
  // Dawny „nalot”: 44 zawrotki na minutę (pomiar w grze). Przelot z dobiegiem — kilka razy rzadziej.
  assert.ok(perMin <= 16, `zawrotek ${perMin} na minutę`);
  assert.ok(passes >= 5, `przelotów nad celem ${passes} w minutę`);
  assert.ok(world.shots.filter((s) => s.owner === npc && s.target === ship).length > 30, 'ogień w przelotach');
  resetWorld();
});

test('bombers drop bombs only while over the hull, flying a straight run', () => {
  resetWorld();
  const ship = makeCapital(0, 0, { angle: 0.4 });
  const npc = makeFighter('bomber', { x: -7000, y: -3000, vx: 1200, vy: 0 });
  world.npcs = [npc, ship];
  npc.target = ship;
  npc.targetCommitT = 999;
  npc.retargetTimer = 999;
  let simT = 0;
  let rearmed = false;
  window.FighterBombs = {
    drop(bomber, target) {
      world.drops.push({ t: simT, ammo: bomber.mslAmmo, over: window.fighterOverHull(target, bomber.x, bomber.y), head: Math.atan2(bomber.vy, bomber.vx) });
      return true;
    }
  };
  simulate([npc], 45, { onTick: (t) => { simT = t; if (npc.state === 'rearm') rearmed = true; } });
  // Każdy zrzut zużywa bombę: zapas przy kolejnych zrzutach maleje o 1 (do przezbrojenia).
  const first = world.drops.slice(0, getFighterSquadronDef('bomber').missileAmmo);
  for (let i = 1; i < first.length; i++) assert.equal(first[i].ammo, first[i - 1].ammo - 1, 'zrzut zużywa bombę');
  assert.ok(rearmed, 'bez bomb — przezbrojenie');
  assert.ok(world.drops.length >= 4, `zrzuconych bomb ${world.drops.length}`);
  assert.ok(world.drops.every((d) => d.over), 'każda bomba zrzucona NAD kadłubem');
  // Bomby jednego przelotu (odstęp < 1 s): maszyna leci prosto (kurs w serii prawie stały).
  for (let i = 1; i < world.drops.length; i++) {
    const a = world.drops[i - 1];
    const b = world.drops[i];
    if (b.t - a.t < 1) assert.ok(Math.abs(wrap(a.head - b.head)) < 0.25, 'seria bomb na prostym kursie');
  }
  resetWorld();
});

test('torpedo bombers launch from a stand-off range with the nose on the lead point, then break away', () => {
  resetWorld();
  const ship = makeCapital(0, 0, { vx: 300, vy: 0 });
  const npc = makeFighter('torpedo', { x: 0, y: -9000, vx: 0, vy: 1500 });
  world.npcs = [npc, ship];
  npc.target = ship;
  npc.targetCommitT = 999;
  npc.retargetTimer = 999;
  const launches = [];
  let simT = 0;
  window.spawnBulletAdapter = (owner, target, def) => {
    if (def?.category === 'torpedo' || def?.id === npc.msl) launches.push({ d: dist(owner, target), t: simT, owner });
    world.shots.push({ owner, target, def });
  };
  const afterLaunchDist = [];
  simulate([npc], 40, {
    others: [ship],
    onTick: (t) => {
      simT = t;
      // Odwrót: pierwsze 2,5 s po pierwszym odpaleniu.
      if (launches.length >= 1 && t - launches[0].t <= 2.5) afterLaunchDist.push(dist(npc, ship));
    }
  });
  const torpDef = MASTER_WEAPONS[npc.msl];
  if (!torpDef) {
    // Broń dorabia osobna sesja (src/data/weapons.js) — bez niej torpedowiec nie odpala niczego.
    assert.equal(launches.length, 0);
  } else {
    assert.ok(launches.length >= 1, 'torpedowiec odpala torpedę');
    const launch = (torpDef.baseRange || 4500) * FIGHTER_AI_TUNE.torpLaunchFrac;
    for (const l of launches) assert.ok(l.d < 800 + launch && l.d > 1000, `odpalenie z ${Math.round(l.d)} j.`);
    assert.ok(afterLaunchDist[afterLaunchDist.length - 1] > afterLaunchDist[0], 'po odpaleniu odlatuje od celu');
  }
  resetWorld();
  window.spawnBulletAdapter = (owner, target, def) => { world.shots.push({ owner, target, def, x: owner.x, y: owner.y, angle: owner.angle }); };
});

test('gunships hold a steady orbit at a fixed standoff and keep the turret on the target', () => {
  resetWorld();
  const ship = makeCapital(0, 0);
  const npc = makeFighter('gunship', { x: -6000, y: 0, vx: 1000, vy: 0 });
  world.npcs = [npc, ship];
  npc.target = ship;
  npc.targetCommitT = 999;
  npc.retargetTimer = 999;
  const radii = [];
  simulate([npc], 40, { onTick: (t) => { if (t > 15 && npc.state === 'orbit') radii.push(dist(npc, ship)); } });
  assert.equal(npc.state, 'orbit');
  assert.ok(radii.length > 600, 'orbita trwa');
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const spread = Math.max(...radii) - Math.min(...radii);
  assert.ok(spread < mean * 0.5, `promień orbity ${Math.round(mean)} ± ${Math.round(spread / 2)} j.`);
  if (MASTER_WEAPONS[npc.gun]) {
    assert.ok(world.shots.some((s) => s.owner === npc && s.target === ship), 'wieżyczka bije w cel');
  }
  // Wieżyczka celuje w punkt wyprzedzenia (pocisk niesie prędkość kanonierki — poprawka na własny ruch).
  const gunSpeed = MASTER_WEAPONS[npc.gun]?.baseSpeed || 2000;
  const lead = window.getLeadAim(npc, ship, gunSpeed, { x: 0, y: 0 }, { x: npc.vx, y: npc.vy });
  const aimErr = Math.abs(wrap(npc.turretAngle - Math.atan2(lead.y - npc.y, lead.x - npc.x)));
  assert.ok(aimErr < 0.2, `wieżyczka na punkcie wyprzedzenia (błąd ${aimErr.toFixed(2)} rad)`);
  resetWorld();
});

test('a bomber out of bombs flies back to its carrier and rearms', () => {
  resetWorld();
  const carrier = { id: nextId++, x: 0, y: 0, vx: 0, vy: 0, angle: 0, friendly: true, radius: 300, type: 'carrier' };
  const npc = makeFighter('bomber', { x: 6000, y: 2000, vx: 0, vy: 0, mslAmmo: 0 });
  npc.squad = { leader: carrier };
  world.npcs = [npc];
  simulate([npc], 25);
  assert.equal(npc.mslAmmo, getFighterSquadronDef('bomber').missileAmmo, 'przezbrojony przy nosicielu');
  assert.ok(dist(npc, carrier) < 2500, 'wrócił do nosiciela');
  resetWorld();
});

test('order RETURN: player fighters fly to their launch tube and land', () => {
  resetWorld();
  const ship = { pos: { x: 0, y: 0 }, vel: { x: 200, y: 0 }, x: 0, y: 0, vx: 200, vy: 0, angle: 0, radius: 300, friendly: true };
  world.ship = ship;
  window.SQUAD = { order: 'return', list: [] };
  const landed = [];
  window.landFighter = (f) => { landed.push(f); f.dead = true; return true; };
  const f = makeFighter('multirole', { x: 4000, y: -3000, vx: -500, vy: 0, playerOwned: true, __tubeLocal: { x: 200, y: 260 } });
  f.squad = { leader: ship };
  world.npcs = [f];
  simulate([f], 20, {
    onTick: () => {
      ship.pos.x += 200 / 60; ship.x = ship.pos.x;
    }
  });
  assert.equal(landed.length, 1, 'myśliwiec wylądował');
  assert.equal(f.state, 'rtb');
  resetWorld();
});
