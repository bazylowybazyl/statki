import test from 'node:test';
import assert from 'node:assert/strict';

import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { PD_CHIP_ID } from '../src/data/chips.js';
import { chipListHas } from '../src/game/shipChips.js';
import {
  PD_HULL_SCORE,
  isPointDefenseWeapon,
  pdCanTargetKind
} from '../src/ai/pointDefenseTargeting.js';
import { readIndexHtml, loadIndexFunction } from './helpers/indexSource.mjs';

const html = readIndexHtml();

// ---------------------------------------------------------------------------
// Klasa PD i reguła

test('PD = każda broń na gnieździe aux (CIWS, laser PD, flak) i tylko ona', () => {
  const aux = Object.values(MASTER_WEAPONS).filter(isPointDefenseWeapon).map((w) => w.id).sort();
  assert.ok(aux.includes('ciws_mk1') && aux.includes('laser_pd_mk1') && aux.includes('flak_s'), aux.join(','));
  for (const w of Object.values(MASTER_WEAPONS)) {
    assert.equal(isPointDefenseWeapon(w), w.mountType === 'aux', w.id);
  }
});

test('bez chipa PD bierze rakiety i myśliwce, z chipem także kadłuby', () => {
  assert.equal(pdCanTargetKind('rocket', false), true);
  assert.equal(pdCanTargetKind('fighter', false), true);
  for (const hull of ['frigate', 'destroyer', 'battleship', 'other']) {
    assert.equal(pdCanTargetKind(hull, false), false, hull);
    assert.equal(pdCanTargetKind(hull, true), true, hull);
  }
  // Kadłub z chipem przegrywa z najdalszą rakietą: kara za dystans PD ≤ 5 200² · 0,001.
  assert.ok(PD_HULL_SCORE < 1000 - 5200 * 5200 * 0.001 - 1);
});

// ---------------------------------------------------------------------------
// AI NPC — prawdziwe processAutonomousWeapons

const getUnitKind = loadIndexFunction(html, 'function getUnitKind(npc) {', 'getUnitKind', { window: {} });

function installAiWindow({ npcs = [], rockets = [] } = {}) {
  const shots = [];
  globalThis.window = {
    npcs,
    bullets: [],
    __npcRocketThreats: rockets,
    __playerRocketThreats: [],
    wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
    getUnitKind,
    hasShipChip: (entity, chipId) => chipListHas(entity?.chips, chipId),
    isLineOfFireBlocked: () => false,
    spawnBulletAdapter: (owner, target) => { shots.push(target); }
  };
  return shots;
}

function pdShip(weaponId = 'laser_pd_mk1', extra = {}) {
  return {
    id: 'pd_owner',
    x: 0,
    y: 0,
    angle: 0,
    friendly: true,
    weapons: {
      main: [],
      aux: [{ hp: { id: 'aux0', type: 'aux', x: 0, y: 0, mount: weaponId }, weapon: MASTER_WEAPONS[weaponId] }],
      missile: []
    },
    ...extra
  };
}

const pirate = (type, x, extra = {}) => ({ type, x, y: 0, isPirate: true, friendly: false, ...extra });

// Działo startuje z losowym cooldownem do 2 s (initAutonomousWeapons).
async function runAi(npc, seconds = 4) {
  const { processAutonomousWeapons } = await import('../src/ai/capitalAI.js');
  for (let t = 0; t < seconds; t += 0.05) processAutonomousWeapons(npc, 0.05);
}

test('NPC: PD bez chipa nie strzela do kadłuba', async () => {
  const frigate = pirate('frigate', 400);
  const shots = installAiWindow({ npcs: [frigate] });
  await runAi(pdShip());
  assert.equal(shots.length, 0, 'PD wystrzelił w fregatę bez chipa');
});

test('NPC: PD bez chipa strzela do myśliwca, nawet gdy kadłub jest bliżej', async () => {
  const frigate = pirate('frigate', 200);
  const fighter = pirate('fighter', 800, { fighter: true });
  const shots = installAiWindow({ npcs: [frigate, fighter] });
  await runAi(pdShip());
  assert.ok(shots.length > 0, 'PD milczy mimo myśliwca w zasięgu');
  assert.ok(shots.every((t) => t === fighter), 'PD strzelił w coś innego niż myśliwiec');
});

// Kolejność rakieta/myśliwiec zostaje jak była (preferencja 1000 vs 900 minus
// kara za dystans) — reguła PD dotyczy tylko kadłubów.
test('NPC: PD bierze rakietę; przy podobnym dystansie rakieta wygrywa z myśliwcem', async () => {
  const rocket = { type: 'rocket', x: 300, y: 0, vx: -100, vy: 0, life: 5, owner: 'npc' };
  let shots = installAiWindow({ npcs: [pirate('frigate', 200)], rockets: [rocket] });
  await runAi(pdShip(), 3);
  assert.ok(shots.length > 0 && shots.every((t) => t === rocket), 'PD bez chipa ma bronić przed rakietą');

  const fighter = pirate('fighter', 350, { fighter: true });
  shots = installAiWindow({ npcs: [fighter], rockets: [rocket] });
  await runAi(pdShip(), 3);
  assert.ok(shots.length > 0 && shots.every((t) => t === rocket), 'rakieta 300 u vs myśliwiec 350 u');
});

test('NPC z PD CHIP-em: kadłub dozwolony, ale zawsze za myśliwcem', async () => {
  const frigate = pirate('frigate', 200);
  const shots = installAiWindow({ npcs: [frigate] });
  await runAi(pdShip('laser_pd_mk1', { chips: [PD_CHIP_ID] }));
  assert.ok(shots.length > 0 && shots.every((t) => t === frigate), 'z chipem PD ma brać kadłub, gdy nic innego nie ma');

  const fighter = pirate('fighter', 950, { fighter: true });
  const shots2 = installAiWindow({ npcs: [frigate, fighter] });
  await runAi(pdShip('laser_pd_mk1', { chips: new Set([PD_CHIP_ID]) }));
  assert.ok(shots2.length > 0 && shots2.every((t) => t === fighter), 'daleki myśliwiec ma wygrać z bliskim kadłubem');
});

test('NPC: kadłub zapamiętany w cachedTarget sprzed zmiany reguł jest porzucany (bez chipa)', async () => {
  const frigate = pirate('frigate', 300);
  const shots = installAiWindow({ npcs: [frigate] });
  const npc = pdShip('ciws_mk1');
  const { processAutonomousWeapons } = await import('../src/ai/capitalAI.js');
  processAutonomousWeapons(npc, 0.05); // init działa
  const weapon = npc.autoWeapons[0];
  assert.equal(weapon.pd, true);
  weapon.cachedTarget = frigate;
  weapon.scanCd = 99;
  weapon.cd = 0;
  processAutonomousWeapons(npc, 0.05);
  assert.equal(shots.length, 0, 'PD dostrzelał kadłub z cache');
  assert.equal(weapon.cachedTarget, null);
});

test('NPC: broń główna nadal strzela do kadłubów', async () => {
  const frigate = pirate('frigate', 800);
  const shots = installAiWindow({ npcs: [frigate] });
  const npc = pdShip();
  npc.weapons.aux = [];
  npc.weapons.main = [{ hp: { id: 'm0', type: 'main', x: 0, y: 0, mount: 'railgun_mk2' }, weapon: MASTER_WEAPONS.railgun_mk2 }];
  await runAi(npc);
  assert.ok(shots.length > 0 && shots.every((t) => t === frigate));
});

// ---------------------------------------------------------------------------
// Gracz — ciwsStep z index.html

function makeCiwsScope({ weaponId, npcs, rockets = [], chips = false }) {
  const fired = [];
  const record = (kind) => (gun, base, baseVel, target) => { fired.push({ kind, target }); gun.cd = 0.1; };
  const ship = {
    pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0,
    ciws: [{ offset: { x: 0, y: 0 }, angle: 0, angVel: 0, cd: 0 }]
  };
  const scope = {
    bullets: [...rockets],
    Game: { player: { weapons: { aux: [{ weapon: MASTER_WEAPONS[weaponId] }] } } },
    HP: { AUX: 'aux' },
    ship,
    npcs,
    AISPACE_PD: {},
    _pdEnemyRocketBuffer: [],
    _pdPlayerRocketBuffer: [],
    _pdEnemyFighterBuffer: [],
    _pdEnemyHullBuffer: [],
    hasShipChip: () => chips,
    PD_CHIP_ID,
    isFlakWeapon: (w) => w?.category === 'flak',
    isFighterNPC: (n) => !!n?.fighter || n?.type === 'fighter',
    // Wróg gracza wg frakcji (index.html: isHostileNpc) — w teście: żywy i nie-przyjazny.
    isHostileNpc: (n) => !!n && !n.dead && n.friendly === false,
    rotate: (v) => ({ x: v.x, y: v.y }),
    leadTarget: (base, vel, t) => ({ x: t.x, y: t.y }),
    wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    LASER_PD_RANGE: 1000,
    CIWS_RANGE: 1500,
    CIWS_BULLET_SPEED: 2000,
    LASER_PD_FIRE_INTERVAL: 0.18,
    CIWS_FIRE_INTERVAL: 0.06,
    LASER_PD_BEAM_WIDTH: 2,
    firePointDefenseLaser: record('laser'),
    fireFlakSalvo: record('flak'),
    fireCIWSGun: (gun) => { fired.push({ kind: 'ciws', target: null }); gun.cd = 0.1; },
    removeBulletAt: () => {},
    spawnBulletImpactEffect: () => {},
    spawnPointDefenseLaserHit: () => {},
    spawnLaserBeam: () => {},
    spawnPointDefenseLaserMuzzle: () => {}
  };
  const ciwsStep = loadIndexFunction(html, 'function ciwsStep(dt) {', 'ciwsStep', scope);
  return { ciwsStep, fired, scope };
}

test('gracz: laser PD bez chipa ignoruje piracki kadłub, strzela do myśliwca', () => {
  const hull = pirate('frigate', 300);
  let env = makeCiwsScope({ weaponId: 'laser_pd_mk1', npcs: [hull] });
  env.ciwsStep(1 / 120);
  assert.equal(env.fired.length, 0, 'strzał w kadłub bez chipa');

  const fighter = pirate('fighter', 700, { fighter: true });
  env = makeCiwsScope({ weaponId: 'laser_pd_mk1', npcs: [hull, fighter] });
  env.ciwsStep(1 / 120);
  assert.equal(env.fired.length, 1);
  assert.equal(env.fired[0].target, fighter);
});

test('gracz: flak też najpierw myśliwce, kadłub tylko z chipem', () => {
  const hull = pirate('frigate', 400);
  let env = makeCiwsScope({ weaponId: 'flak_s', npcs: [hull] });
  env.ciwsStep(1 / 120);
  assert.equal(env.fired.length, 0);
  env = makeCiwsScope({ weaponId: 'flak_s', npcs: [hull], chips: true });
  env.ciwsStep(1 / 120);
  assert.equal(env.fired.length, 1);
  assert.equal(env.fired[0].target, hull);
});

test('gracz z chipem: myśliwiec wygrywa z bliższym kadłubem, rakieta z oboma', () => {
  const hull = pirate('frigate', 200);
  const fighter = pirate('fighter', 900, { fighter: true });
  let env = makeCiwsScope({ weaponId: 'laser_pd_mk1', npcs: [hull, fighter], chips: true });
  env.ciwsStep(1 / 120);
  assert.equal(env.fired[0]?.target, fighter);

  const rocket = { type: 'rocket', x: 950, y: 0, life: 3, owner: 'npc' };
  env = makeCiwsScope({ weaponId: 'flak_s', npcs: [hull, fighter], rockets: [rocket], chips: true });
  env.ciwsStep(1 / 120);
  assert.equal(env.fired[0]?.target, rocket);
});

// ---------------------------------------------------------------------------
// Gracz — listy wrogich myśliwców i kadłubów raz na krok (audyt 2026-10-07 § 5.4) zamiast pętli
// po całej flocie z wrogością frakcji na każde działko: ten sam wybór celu, te same remisy, świeże
// listy po strzale lasera PD (rani od razu).

// Kilka działek PD; leadTarget (flak, CIWS) zapisuje cel, który działko wybrało w tym kroku.
function makeMultiCiwsScope({ weaponIds, offsets = [], npcs, rockets = [], chips = false, laserKills = false }) {
  const picks = [];
  const fired = [];
  const calls = { hostile: 0 };
  const ship = {
    pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: 0, angVel: 0,
    ciws: weaponIds.map((_, i) => ({ offset: offsets[i] || { x: 0, y: 0 }, angle: 0, angVel: 0, cd: 0 }))
  };
  const scope = {
    bullets: [...rockets],
    Game: { player: { weapons: { aux: weaponIds.map((id) => ({ weapon: MASTER_WEAPONS[id] })) } } },
    HP: { AUX: 'aux' },
    ship,
    npcs,
    AISPACE_PD: {},
    _pdEnemyRocketBuffer: [],
    _pdPlayerRocketBuffer: [],
    _pdEnemyFighterBuffer: [],
    _pdEnemyHullBuffer: [],
    hasShipChip: () => chips,
    PD_CHIP_ID,
    isFlakWeapon: (w) => w?.category === 'flak',
    isFighterNPC: (n) => !!n?.fighter || n?.type === 'fighter',
    isHostileNpc: (n) => { calls.hostile++; return !!n && !n.dead && n.friendly === false; },
    rotate: (v) => ({ x: v.x, y: v.y }),
    leadTarget: (base, vel, t) => { picks.push(t); return { x: t.x, y: t.y }; },
    wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    LASER_PD_RANGE: 1000,
    CIWS_RANGE: 1500,
    CIWS_BULLET_SPEED: 2000,
    LASER_PD_FIRE_INTERVAL: 0.18,
    CIWS_FIRE_INTERVAL: 0.06,
    firePointDefenseLaser: (gun, base, baseVel, target) => {
      fired.push({ kind: 'laser', target });
      if (laserKills) target.dead = true;
      gun.cd = 0.1;
    },
    fireFlakSalvo: (gun, base, baseVel, target) => { fired.push({ kind: 'flak', target }); gun.cd = 0.1; },
    fireCIWSGun: (gun) => { fired.push({ kind: 'ciws', target: null }); gun.cd = 0.1; },
    removeBulletAt: () => {},
    spawnBulletImpactEffect: () => {}
  };
  const ciwsStep = loadIndexFunction(html, 'function ciwsStep(dt) {', 'ciwsStep', scope);
  return { ciwsStep, picks, fired, calls, scope };
}

// Dawna reguła (pętla po wszystkich NPC na każde działko) — wzorzec wyboru celu.
function referencePicks(scope, chips) {
  const { ship, npcs } = scope;
  const hostile = (n) => !!n && !n.dead && n.friendly === false;
  const fighter = (n) => !!n?.fighter || n?.type === 'fighter';
  const rockets = scope.bullets.filter((b) => b && b.life > 0 && (b.type === 'rocket' || b.type === 'torpedo')
    && b.owner !== 'player' && b.owner !== 'player2');
  const out = [];
  scope.Game.player.weapons.aux.forEach(({ weapon }, i) => {
    const isLaser = weapon.id === 'laser_pd_mk1' || weapon.aispacePdId === 'pd_laser';
    const range = weapon.baseRange || (isLaser ? scope.LASER_PD_RANGE : scope.CIWS_RANGE);
    const bx = ship.pos.x + ship.ciws[i].offset.x;
    const by = ship.pos.y + ship.ciws[i].offset.y;
    let target = null;
    let best = range * range;
    const consider = (e) => {
      const d2 = (e.x - bx) * (e.x - bx) + (e.y - by) * (e.y - by);
      if (d2 < best) { best = d2; target = e; }
    };
    for (const rb of rockets) consider(rb);
    if (!target) for (const npc of npcs) if (hostile(npc) && fighter(npc)) consider(npc);
    if (!target && chips) for (const npc of npcs) if (hostile(npc)) consider(npc);
    if (target) out.push(target);
  });
  return out;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('gracz: listy raz na krok — ten sam cel każdego działka co dawna pętla po flocie (losowe sceny)', () => {
  const guns = ['flak_s', 'flak_m', 'ciws_mk1', 'flak_l'];
  let compared = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = mulberry32(seed);
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    // Siatka co 150 j. — dużo remisów odległości (ta sama odległość od działka).
    const at = () => Math.round((rnd() * 2 - 1) * 16) * 150;
    const npcs = [];
    const count = 1 + Math.floor(rnd() * 30);
    for (let k = 0; k < count; k++) {
      npcs.push({
        id: k, x: at(), y: at(),
        type: pick(['fighter', 'frigate', 'destroyer', 'battleship']),
        fighter: rnd() < 0.25 ? true : undefined,
        friendly: pick([false, false, true, undefined]),
        dead: rnd() < 0.1
      });
    }
    const rockets = [];
    for (let k = 0, n = Math.floor(rnd() * 3); k < n; k++) {
      rockets.push({ id: 'r' + k, type: pick(['rocket', 'torpedo']), x: at(), y: at(), life: rnd() < 0.85 ? 3 : -1, owner: pick(['npc', 'player']) });
    }
    const nGuns = 1 + Math.floor(rnd() * 5);
    const weaponIds = Array.from({ length: nGuns }, () => pick(guns));
    const offsets = weaponIds.map(() => ({ x: Math.round((rnd() * 2 - 1) * 4) * 75, y: Math.round((rnd() * 2 - 1) * 4) * 75 }));
    const chips = rnd() < 0.5;
    const env = makeMultiCiwsScope({ weaponIds, offsets, npcs, rockets, chips });
    const expected = referencePicks(env.scope, chips);
    env.ciwsStep(1 / 120);
    assert.deepEqual(env.picks.map((t) => t.id), expected.map((t) => t.id), `ziarno ${seed}`);
    assert.ok(env.picks.every((t, k) => t === expected[k]), `ziarno ${seed}: inny obiekt celu`);
    compared += expected.length;
  }
  assert.ok(compared > 300, `za mało porównanych wyborów: ${compared}`);
});

test('gracz: remis odległości — wygrywa wcześniejszy w npcs, jak dawniej', () => {
  const a = pirate('fighter', 300, { fighter: true, y: 100, id: 'a' });
  const b = pirate('fighter', 300, { fighter: true, y: -100, id: 'b' });
  for (const order of [[a, b], [b, a]]) {
    const env = makeMultiCiwsScope({ weaponIds: ['flak_s', 'flak_m'], npcs: order });
    env.ciwsStep(1 / 120);
    assert.deepEqual(env.picks.map((t) => t.id), [order[0].id, order[0].id]);
  }
});

test('gracz: wrogość frakcji liczona raz na krok, nie na każde działko; bez chipa tylko dla myśliwców', () => {
  const guns = ['flak_s', 'flak_m', 'ciws_mk1', 'flak_l'];
  const hulls = Array.from({ length: 40 }, (_, k) => pirate('frigate', 200 + k * 20));
  const friends = Array.from({ length: 20 }, (_, k) => ({ type: 'fighter', fighter: true, x: 100 + k, y: 0, friendly: true }));
  let env = makeMultiCiwsScope({ weaponIds: guns, npcs: [...hulls] });
  env.ciwsStep(1 / 120);
  assert.equal(env.calls.hostile, 0, 'bez chipa i bez myśliwców — ani jednego testu wrogości');
  env = makeMultiCiwsScope({ weaponIds: guns, npcs: [...hulls, ...friends] });
  env.ciwsStep(1 / 120);
  assert.equal(env.calls.hostile, friends.length, 'test wrogości raz na myśliwca');
  assert.equal(env.picks.length, 0, 'przyjazne myśliwce nie są celem');
  env = makeMultiCiwsScope({ weaponIds: guns, npcs: [...hulls, ...friends], chips: true });
  env.ciwsStep(1 / 120);
  assert.equal(env.calls.hostile, hulls.length + friends.length, 'z chipem — raz na NPC na krok');
  assert.equal(env.picks.length, guns.length);
  assert.ok(env.picks.every((t) => t === hulls[0]), 'najbliższy wrogi kadłub');
});

test('gracz: laser PD, który zabił myśliwca, odświeża listy — następne działko bierze żywy cel', () => {
  const near = pirate('fighter', 300, { fighter: true, id: 'near' });
  const far = pirate('fighter', 500, { fighter: true, id: 'far' });
  const env = makeMultiCiwsScope({ weaponIds: ['laser_pd_mk1', 'flak_s'], npcs: [near, far], laserKills: true });
  env.ciwsStep(1 / 120);
  assert.equal(env.fired[0]?.kind, 'laser');
  assert.equal(env.fired[0]?.target, near);
  assert.equal(near.dead, true);
  assert.deepEqual(env.picks.map((t) => t.id), ['far'], 'flak nie celuje w zestrzelonego myśliwca');
});
