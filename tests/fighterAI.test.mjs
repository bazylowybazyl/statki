import test from 'node:test';
import assert from 'node:assert/strict';

import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { FIGHTER_SQUADRON_DEFS, getFighterSquadronDef } from '../src/data/fighterSquadrons.js';
import { SUPPORT_SHIP_TEMPLATES } from '../src/data/ships.js';
import { DRIVE_MODES } from '../src/game/flight/driveTransmission.js';

// fighterAI.js i aiUtils.js publikują się przez `window` w module scope, więc
// stub musi istnieć PRZED importem.
const world = { npcs: [], ship: null };

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
  getUnitKind: (u) => (u && (u.fighter || u.type === 'fighter' || u.type === 'interceptor')) ? 'fighter' : 'other',
  isEnemyUnit: (a, b) => !!a && !!b && !b.dead && a !== b && !!a.friendly !== !!b.friendly,
  isLineOfFireBlocked: () => false,
  spawnBulletAdapter: () => { world.shotsFired = (world.shotsFired || 0) + 1; },
  aiPickBestTarget: null,
  applySeparationForces: null,
  queryAIGrid: null
};

// Prawdziwy scoring — testy celowania mają sprawdzać integrację, nie atrapę.
const { aiPickBestTarget } = await import('../src/ai/aiUtils.js');
window.aiPickBestTarget = aiPickBestTarget;
const restorePicker = () => { window.aiPickBestTarget = aiPickBestTarget; };

const { runAdvancedFighterAI, steerFighter, fighterEnvelope, resolveFighterTarget } =
  await import('../src/ai/fighterAI.js');

function makeFighter(squadronId, overrides = {}) {
  const def = getFighterSquadronDef(squadronId);
  return Object.assign({
    id: 1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    fighter: true,
    type: 'fighter',
    friendly: true,
    hp: def.hp,
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
    id: 99,
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

const dist = (a, b) => Math.hypot(
  (b.pos ? b.pos.x : b.x) - a.x,
  (b.pos ? b.pos.y : b.y) - a.y
);

// ---------------------------------------------------------------------------

test('fighters outrun the capital hulls they escort', () => {
  const playerCombatCap = DRIVE_MODES.combat.gears[0].maxSpeed;
  const frigate = SUPPORT_SHIP_TEMPLATES.frigate_pd.stats;

  for (const def of Object.values(FIGHTER_SQUADRON_DEFS)) {
    assert.ok(def.maxSpeed > frigate.maxSpeed * 3, `${def.id} musi być wyraźnie szybszy od fregaty`);
    assert.ok(def.maxSpeed >= playerCombatCap * 0.75,
      `${def.id} (${def.maxSpeed}) nie nadąży za graczem w trybie bojowym (${playerCombatCap})`);
    assert.ok(def.accel > 0, `${def.id} musi mieć przyspieszenie`);
  }

  // Kolejność klas zachowana: przechwytujący najszybszy, uderzeniowy najwolniejszy.
  assert.ok(FIGHTER_SQUADRON_DEFS.interceptor.maxSpeed > FIGHTER_SQUADRON_DEFS.multirole.maxSpeed);
  assert.ok(FIGHTER_SQUADRON_DEFS.multirole.maxSpeed > FIGHTER_SQUADRON_DEFS.strike.maxSpeed);
});

test('steerFighter accelerates instead of snapping to top speed', () => {
  const npc = makeFighter('multirole');
  const dt = 1 / 60;

  steerFighter(npc, npc.maxSpeed, 0, dt, 300);
  const afterOneFrame = Math.hypot(npc.vx, npc.vy);
  assert.ok(afterOneFrame > 0, 'myśliwiec musi ruszyć');
  assert.ok(afterOneFrame <= npc.accel * dt + 1e-6,
    `jedna klatka nie może dać więcej niż accel*dt (dostał ${afterOneFrame})`);
  assert.ok(afterOneFrame < npc.maxSpeed * 0.1, 'to nie może być skok do maxSpeed');

  // W ~2 s ma dobić do prędkości maksymalnej.
  for (let i = 0; i < 120; i++) steerFighter(npc, npc.maxSpeed, 0, dt, 300);
  assert.ok(Math.abs(Math.hypot(npc.vx, npc.vy) - npc.maxSpeed) < 1);

  // I zwolnić, gdy AI prosi o wolniej.
  for (let i = 0; i < 120; i++) steerFighter(npc, 200, 0, dt, 300);
  assert.ok(Math.abs(Math.hypot(npc.vx, npc.vy) - 200) < 1);
});

test('steerFighter starts from rest in the requested direction, not heading 0', () => {
  const npc = makeFighter('multirole', { vx: 0, vy: 0 });
  steerFighter(npc, 0, -npc.maxSpeed, 1 / 60, 300);
  assert.ok(npc.vy < 0, 'ruch musi iść w żądaną stronę');
  assert.ok(Math.abs(npc.vx) < 1e-6, 'bez dryfu w bok');
});

test('engagement envelope scales with gun range and speed', () => {
  const multirole = fighterEnvelope(makeFighter('multirole'));
  const strike = fighterEnvelope(makeFighter('strike'));

  assert.equal(multirole.gunRange, MASTER_WEAPONS.ciws_mk1.baseRange);
  assert.ok(multirole.dogfightEnter > multirole.gunRange, 'kocioł zaczyna się poza zasięgiem ognia');
  assert.ok(multirole.dogfightExit > multirole.dogfightEnter * 1.5, 'histereza wejścia/wyjścia');

  // Regresja: stare 600 u przy 2800 u/s to 0.2 s przelotu przez cały kocioł.
  assert.ok(multirole.dogfightEnter > 1500, 'obwiednia nie może zostać przy starych 600 u');

  // Dłuższe działko strike'a => szerszy kocioł.
  assert.ok(strike.dogfightEnter > multirole.dogfightEnter);

  // Podfazy mierzone czasem przelotu obwiedni, nie stałymi.
  assert.ok(multirole.mergeT > 0 && multirole.mergeT < 1.3);
  assert.ok(multirole.breakT <= 1.4, 'break-off nie może trwać ~2 s jak wcześniej');
});

test('an enemy fighter escorting the player wins over the player itself', () => {
  // Scenariusz z misji: pirat namierza Atlasa, gracz wypuszcza eskortę.
  // Myśliwce eskorty lecą TUŻ OBOK gracza — histereza dystansowa nigdy nie
  // pozwalała się przełączyć i cała chmara fiksowała się na graczu.
  const pirate = makeFighter('interceptor', { x: 0, y: 0, friendly: false, type: 'interceptor' });
  const env = fighterEnvelope(pirate);

  const player = { pos: { x: 6000, y: 0 }, vx: 0, vy: 0, friendly: true, dead: false, radius: 300 };
  world.ship = player;

  const escort = makeFighter('multirole', { id: 77, x: 5600, y: 300, friendly: true });
  world.npcs = [escort];

  const picked = resolveFighterTarget(pirate, player, 16000, env);
  assert.equal(picked, escort, 'myśliwiec eskorty musi przebić gracza w tej samej odległości');

  // I odwrotnie: gracz SAM (bez eskorty) zostaje celem.
  world.npcs = [];
  const alone = resolveFighterTarget(pirate, null, 16000, env);
  assert.equal(alone, player, 'bez myśliwców w zasięgu gracz jest legalnym celem');

  world.ship = null;
  world.npcs = [];
});

test('a fighter on our tail overrides the wing leader order', () => {
  const pirate = makeFighter('interceptor', { x: 0, y: 0, friendly: false, type: 'interceptor' });
  const env = fighterEnvelope(pirate);

  const player = { pos: { x: 9000, y: 0 }, vx: 0, vy: 0, friendly: true, dead: false, radius: 300 };
  world.ship = player;

  // Lider trzyma się gracza; nas atakuje myśliwiec w obwiedni kotła.
  const leader = makeFighter('interceptor', { id: 5, x: -400, y: 0, friendly: false, type: 'interceptor' });
  leader.target = player;
  pirate.squad = { leader };

  const onTail = makeFighter('multirole', { id: 78, x: env.dogfightEnter * 0.5, y: 0, friendly: true });
  world.npcs = [onTail, leader];

  const picked = resolveFighterTarget(pirate, player, 16000, env);
  assert.equal(picked, onTail, 'samoobrona bije rozkaz skrzydła');

  pirate.squad = null;
  world.ship = null;
  world.npcs = [];
});

test('committed fighters still ignore an equivalent alternative', () => {
  // Histereza po scoringu nadal ma tłumić szum: dwa TAKIE SAME cele w podobnej
  // odległości nie mogą się przerzucać co retarget.
  const npc = makeFighter('multirole');
  const env = fighterEnvelope(npc);
  const current = makeEnemyFighter(3000, 0);
  const sibling = makeEnemyFighter(2700, 0, { id: 96 });

  world.npcs = [current, sibling];
  window.aiPickBestTarget = () => sibling;
  assert.equal(resolveFighterTarget(npc, current, 16000, env), current,
    'równoważny cel nie przerywa ataku');

  restorePicker();
  world.npcs = [];
});

test('target commitment: a marginally closer enemy does not break off the attack', () => {
  const npc = makeFighter('multirole');
  const env = fighterEnvelope(npc);
  const current = makeEnemyFighter(3000, 0);
  const slightlyCloser = makeEnemyFighter(2700, 0, { id: 98 });
  const muchCloser = makeEnemyFighter(900, 0, { id: 97 });

  world.npcs = [current, slightlyCloser];
  window.aiPickBestTarget = () => slightlyCloser;
  assert.equal(
    resolveFighterTarget(npc, current, 16000, env), current,
    'zmiana celu o 10% bliżej to szum scoringu, nie decyzja'
  );

  world.npcs = [current, muchCloser];
  window.aiPickBestTarget = () => muchCloser;
  assert.equal(
    resolveFighterTarget(npc, current, 16000, env), muchCloser,
    'wyraźnie bliższy cel musi przejąć atak'
  );

  window.aiPickBestTarget = () => muchCloser;
  assert.equal(resolveFighterTarget(npc, null, 16000, env), muchCloser, 'bez celu bierzemy najlepszego');
  restorePicker();
});

test('a fighter surrounded by ENEMY fighters keeps fighting instead of breaking off', () => {
  const npc = makeFighter('multirole', {
    x: 0, y: 0, vx: 2000, vy: 0,
    state: 'dogfight3D',
    sub: 'core',
    dogfightTime: 99,     // commitment minimalny dawno minął
    dogfightMin: 0.5,
    breakOffTimer: 0      // cooldown wolny
  });
  const target = makeEnemyFighter(400, 0);

  // Sześciu wrogów w promieniu 220 u — dokładnie sytuacja, w której stary
  // warunek `neighbors > 3` (liczący WSZYSTKIE myśliwce, także wroga, i
  // omijający breakOffTimer) natychmiast wyrzucał myśliwca z walki.
  const crowd = [target];
  for (let i = 0; i < 6; i++) {
    crowd.push(makeEnemyFighter(Math.cos(i) * 120, Math.sin(i) * 120, { id: 200 + i }));
  }
  world.npcs = crowd;
  npc.target = target;
  npc.targetCommitT = 5;
  npc.retargetTimer = 5;

  const realRandom = Math.random;
  Math.random = () => 1; // wyklucz losowy break-off, testujemy warunek zagęszczenia
  try {
    for (let i = 0; i < 30; i++) runAdvancedFighterAI(npc, 1 / 60);
  } finally {
    Math.random = realRandom;
  }

  assert.notEqual(npc.sub, 'break_off', 'obecność WROGÓW nie może być powodem do zerwania walki');
  world.npcs = [];
});

test('allied crowding still triggers a break-off, and it stays inside the fight', () => {
  const npc = makeFighter('multirole', {
    x: 0, y: 0, vx: 2000, vy: 0,
    state: 'dogfight3D',
    sub: 'core',
    dogfightTime: 99,
    dogfightMin: 0.5,
    breakOffTimer: 0
  });
  const target = makeEnemyFighter(400, 0);

  const crowd = [target];
  for (let i = 0; i < 6; i++) {
    crowd.push(makeFighter('multirole', { id: 300 + i, x: Math.cos(i) * 120, y: Math.sin(i) * 120 }));
  }
  world.npcs = crowd;
  npc.target = target;
  npc.targetCommitT = 5;
  npc.retargetTimer = 5;

  const realRandom = Math.random;
  Math.random = () => 1;
  try {
    runAdvancedFighterAI(npc, 1 / 60);
  } finally {
    Math.random = realRandom;
  }

  assert.equal(npc.sub, 'break_off', 'tłok WŁASNYCH myśliwców nadal rozrzedza kocioł');

  // Wektor wyjścia ma być boczny, a nie prosto od celu (dawne "zawracanie").
  const away = { x: npc.x - target.x, y: npc.y - target.y };
  const awayLen = Math.hypot(away.x, away.y) || 1;
  const dot = (npc.breakVector.x * away.x + npc.breakVector.y * away.y) / awayLen;
  assert.ok(dot < 0.75, `wyjście musi być w bok, nie ucieczką na wprost (dot=${dot.toFixed(2)})`);
  world.npcs = [];
});

test('a fighter closes on its target instead of oscillating away', () => {
  const npc = makeFighter('multirole', { x: 0, y: 0, vx: 300, vy: 0 });
  const target = makeEnemyFighter(6000, 1500);
  world.npcs = [npc, target];
  npc.target = target;
  npc.targetCommitT = 30;
  npc.retargetTimer = 30;
  window.aiPickBestTarget = () => target;

  const startDist = dist(npc, target);
  let closest = startDist;
  let breakFrames = 0;
  const frames = 60 * 12; // 12 s
  const dt = 1 / 60;

  for (let i = 0; i < frames; i++) {
    runAdvancedFighterAI(npc, dt);
    npc.x += npc.vx * dt;
    npc.y += npc.vy * dt;
    // Statek celu leci równolegle, żeby to nie był test na nieruchomą tarczę.
    target.vx = 900;
    target.x += target.vx * dt;
    if (npc.state === 'dogfight3D' && npc.sub === 'break_off') breakFrames++;
    closest = Math.min(closest, dist(npc, target));
  }

  const env = fighterEnvelope(npc);
  assert.ok(closest < env.gunRange,
    `myśliwiec musi wejść w zasięg ognia (najbliżej ${Math.round(closest)} u, zasięg ${env.gunRange} u)`);
  assert.ok(breakFrames / frames < 0.35,
    `nie może spędzać walki na ucieczce (${Math.round(100 * breakFrames / frames)}% klatek w break-off)`);

  restorePicker();
  world.npcs = [];
});

test('a fighter with no target flies formation on its leader and faces its travel direction', () => {
  const leader = { x: 5000, y: 0, angle: 0, dead: false, radius: 300 };
  const npc = makeFighter('multirole', {
    x: 0, y: 0, vx: 0, vy: 0,
    squad: { leader },
    formationOffset: { x: -200, y: 120 },
    // Kurs zapamiętany z poprzedniej walki — regresja: cała aktualizacja kursu
    // była pod `if (!Number.isFinite(desiredAngle))`, więc zostawał na zawsze.
    desiredAngle: Math.PI
  });
  world.npcs = [npc];

  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) {
    runAdvancedFighterAI(npc, dt);
    npc.x += npc.vx * dt;
    npc.y += npc.vy * dt;
  }

  assert.equal(npc.state, 'guard');
  assert.ok(npc.x > 500, 'musi lecieć w stronę lidera');
  assert.ok(Math.abs(window.wrapAngle(npc.desiredAngle - Math.atan2(npc.vy, npc.vx))) < 0.2,
    'kurs musi nadążać za wektorem prędkości, a nie zostać po walce');
  world.npcs = [];
});
