import test from 'node:test';
import assert from 'node:assert/strict';

// Szyk floty (src/ai/fleetFormation.js + dowódca floty): grupy bojowe
// (okręt flagowy + eskorta), szyk przelotowy wokół gracza i szyk bojowy
// (linia okrętów flagowych, druga linia z eskort). Część czysta — same funkcje
// szyku; część zachowania — dowódca + mózgi + model lotu, jak w npcStep.
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
globalThis.window = globalThis.window || {};
const world = [];
Object.assign(globalThis.window, {
  wrapAngle,
  // Prosta separacja par (jak applySeparationForces w index.html: odstęp od
  // promieni, siła od nakładki) — bez niej okręty w symulacji przenikają się.
  applySeparationForces: (npc) => {
    let ax = 0;
    let ay = 0;
    const gain = 1 / Math.pow(Math.max(1, npc.mass || 1), 0.25);
    for (const o of world) {
      if (o === npc || o.dead) continue;
      const dx = npc.x - o.x;
      const dy = npc.y - o.y;
      const safe = (npc.radius + o.radius) * 1.6;
      const d2 = dx * dx + dy * dy;
      if (d2 >= safe * safe) continue;
      const d = Math.sqrt(d2) || 1;
      ax += (dx / d) * (safe - d) * 96 * gain;
      ay += (dy / d) * (safe - d) * 96 * gain;
    }
    return { ax, ay };
  },
  queryAIGrid: () => ({ buffer: [], count: 0 }),
  ship: null,
  __frameId: 1,
  bullets: [],
  __npcRocketThreats: [],
  __playerRocketThreats: [],
  getUnitKind: (e) => String(e?.type || 'battleship')
});

const F = await import('../src/ai/fleetFormation.js');
const { aiBattleship, aiFrigate, aiDestroyer } = await import('../src/ai/capitalAI.js');
const { stepShipFlight, resolveShipFlightSpec } = await import('../src/game/flight/shipFlightModel.js');
const Coord = await import('../src/ai/fleetCoordinator.js');
const Aw = await import('../src/ai/fleetAwareness.js');
const Grid = await import('../src/ai/aiSpatialGrid.js');
const NO_GRID = window.queryAIGrid;
// Siatka AI jak w grze (przebudowa co cykl mózgów): sąsiedzi dla przeszkód
// i uniku CPA. Domyślnie pusta — wtedy test widzi sam szyk i separację.
let gridOn = false;
function useAIGrid(on) {
  gridOn = on;
  window.queryAIGrid = on ? Grid.queryAIGrid : NO_GRID;
}

window.aiPickTarget = (npc) => {
  if (npc.forceTarget && !npc.forceTarget.dead) return npc.forceTarget;
  return Aw.pickContactTarget(npc, { player: window.ship ?? null, priority: null });
};

// Promienie kadłubów po zbudowaniu ciała belek (hullBodies: połowa długości + komórka).
const RADIUS = { battleship: 327, destroyer: 159, frigate_pd: 111, carrier: 555 };
const MASS = { battleship: 50000, destroyer: 25000, frigate_pd: 10000, carrier: 100000 };
const railgun = { baseRange: 4500, baseSpeed: 8000 };
const armata = { baseRange: 3500, baseSpeed: 2500 };
const DT = 1 / 120;
const BRAIN_DT = 1 / 20;

let rngState = 12345;
function rnd() {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
}

function makeShip(side, kind, x, y, angle = 0) {
  const friendlySide = side === 'friendly';
  const hull = kind === 'carrier'
    ? 'terran_carrier'
    : (friendlySide ? 'terran_' : 'pirate_') + (kind === 'frigate_pd' ? 'frigate' : kind);
  const npc = {
    x, y, vx: 0, vy: 0, angle, angVel: 0,
    mission: true, type: kind, shipFrame: hull,
    friendly: friendlySide, isPirate: !friendlySide,
    isCapitalShip: kind !== 'frigate_pd',
    radius: RADIUS[kind], mass: MASS[kind],
    hp: 5000, maxHp: 5000, shield: { val: 5000, max: 5000 },
    weapons: { main: [{ weapon: friendlySide ? railgun : armata }] }
  };
  const brain = kind === 'destroyer' ? aiDestroyer : (kind === 'frigate_pd' ? aiFrigate : aiBattleship);
  npc.ai = (dt) => brain(null, npc, dt);
  return npc;
}

function makePlayer() {
  return {
    pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, x: 0, y: 0, vx: 0, vy: 0, angle: 0,
    radius: 915, isCapitalShip: true, sensors: { passiveRange: 80000 }
  };
}

function simulate(npcs, player, seconds, playerVel = null, onTick = null) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    window.__frameId++;
    if (player && playerVel) {
      player.vel.x = playerVel.x;
      player.vel.y = playerVel.y;
      player.vx = playerVel.x;
      player.vy = playerVel.y;
      player.pos.x += playerVel.x * DT;
      player.pos.y += playerVel.y * DT;
      player.x = player.pos.x;
      player.y = player.pos.y;
    }
    if (i % 6 === 0) {
      if (gridOn) Grid.rebuildAIGrid(npcs, true);
      Coord.updateFleetCoordinator(npcs, player, BRAIN_DT);
      for (const n of npcs) n.ai(BRAIN_DT);
    }
    for (const n of npcs) stepShipFlight(n, DT);
    if (onTick) onTick();
  }
}

function resetWorld() {
  world.length = 0;
  Aw.resetFleetAwareness();
  Coord.resetFleetCoordinator();
  rngState = 12345;
}

// ---------------------------------------------------------------------------
// Grupy bojowe

function bareShip(kind, x = 0, y = 0) {
  const hull = kind === 'carrier' ? 'terran_carrier' : 'terran_' + (kind === 'frigate_pd' ? 'frigate' : kind);
  return { x, y, type: kind, shipFrame: hull, mission: true, friendly: true, radius: RADIUS[kind] };
}

test('escorts are split evenly between the flagships, one destroyer per group', () => {
  const fs = F.createFormationState();
  const members = [];
  for (let i = 0; i < 5; i++) members.push(bareShip('battleship', i * 3000, 0));
  for (let i = 0; i < 5; i++) members.push(bareShip('destroyer', i * 3000, 800));
  for (let i = 0; i < 50; i++) members.push(bareShip('frigate_pd', (i % 10) * 1500, 2000 + Math.floor(i / 10) * 500));
  F.organizeTaskGroups(members, fs);
  assert.equal(fs.leaders.length, 5);
  for (const L of fs.leaders) {
    assert.equal(L.type, 'battleship');
    const g = fs.groups.get(L);
    assert.equal(g.escorts.length, 11);
    assert.equal(g.escorts.filter(e => e.type === 'destroyer').length, 1, 'niszczyciel na grupę');
    for (const e of g.escorts) assert.equal(e.__formLeader, L);
  }
});

test('group membership is sticky and only the surplus moves to a new flagship', () => {
  const fs = F.createFormationState();
  const members = [];
  for (let i = 0; i < 2; i++) members.push(bareShip('battleship', i * 8000, 0));
  for (let i = 0; i < 12; i++) members.push(bareShip('frigate_pd', (i % 2) * 8000 + 500, i * 100));
  F.organizeTaskGroups(members, fs);
  const before = new Map(members.map(m => [m, m.__formLeader]));
  // Te same okręty przemieszane w liście: nikt nie zmienia grupy.
  F.organizeTaskGroups([...members].reverse(), fs);
  for (const m of members) assert.equal(m.__formLeader, before.get(m));
  // Nowy pancernik: dostaje 4 eskorty (12 / 3), pozostali zostają przy swoich.
  const fresh = bareShip('battleship', 4000, 5000);
  members.push(fresh);
  F.organizeTaskGroups(members, fs);
  const moved = members.filter(m => m.type === 'frigate_pd' && m.__formLeader !== before.get(m));
  assert.equal(fs.groups.get(fresh).escorts.length, 4);
  assert.equal(moved.length, 4, 'zmienia grupę tylko nadmiar');
  assert.ok(moved.every(m => m.__formLeader === fresh));
});

test('without big ships destroyers lead, without destroyers frigates form squadrons', () => {
  const fs = F.createFormationState();
  const dds = [bareShip('destroyer', 0, 0), bareShip('destroyer', 5000, 0)];
  const ffs = Array.from({ length: 8 }, (_, i) => bareShip('frigate_pd', i * 600, 1000));
  F.organizeTaskGroups([...dds, ...ffs], fs);
  assert.deepEqual(fs.leaders.map(l => l.type), ['destroyer', 'destroyer']);
  assert.deepEqual(fs.leaders.map(l => fs.groups.get(l).escorts.length), [4, 4]);

  const fs2 = F.createFormationState();
  const only = Array.from({ length: 13 }, (_, i) => bareShip('frigate_pd', i * 600, 0));
  F.organizeTaskGroups(only, fs2);
  assert.equal(fs2.leaders.length, 3, 'klucze po 6: 13 fregat = 3 klucze');
  let escorts = 0;
  for (const L of fs2.leaders) escorts += fs2.groups.get(L).escorts.length;
  assert.equal(escorts, 10);
  // Prowadzący zostają ci sami przy kolejnej przebudowie.
  const leads = [...fs2.leaders];
  F.organizeTaskGroups(only, fs2);
  assert.deepEqual(fs2.leaders, leads);
});

// ---------------------------------------------------------------------------
// Rozstawienie

function bigFleet() {
  const members = [];
  for (let i = 0; i < 5; i++) members.push(bareShip('battleship', -6000 + i * 3000, -4000));
  for (let i = 0; i < 5; i++) members.push(bareShip('destroyer', -6000 + i * 3000, 4000));
  for (let i = 0; i < 50; i++) members.push(bareShip('frigate_pd', -7000 + (i % 10) * 1500, 6000 + Math.floor(i / 10) * 500));
  return members;
}

test('cruise: groups ring the player with a gap ahead, escorts ring their flagship', () => {
  const fs = F.createFormationState();
  const members = bigFleet();
  F.organizeTaskGroups(members, fs);
  F.measureGroups(fs);
  const root = { x: 0, y: 0, vx: 0, vy: 0, radius: 915, entity: null };
  const heading = 0.3;
  F.layoutCruise(fs, root, heading);
  let maxR = 0;
  for (const L of fs.leaders) {
    const g = fs.groups.get(L);
    const r = Math.hypot(g.slotX, g.slotY);
    maxR = Math.max(maxR, r);
    assert.ok(r > 915 + g.footprint, 'grupa wchodzi na gracza');
    // Luka przed graczem: żadna grupa dokładnie na kursie.
    const off = Math.abs(wrapAngle(Math.atan2(g.slotY, g.slotX) - heading));
    assert.ok(off > 0.3, `grupa na kursie gracza (${off.toFixed(2)} rad)`);
    for (let k = 0; k < g.escorts.length; k++) {
      const d = Math.hypot(g.ex[k] - L.x, g.ey[k] - L.y);
      assert.ok(d > L.radius + 111 && d < g.footprint, `eskorta poza pierścieniem grupy: ${d.toFixed(0)}`);
    }
  }
  assert.ok(maxR < 6000, `grupy za daleko od gracza: ${maxR.toFixed(0)}`);
  // Sąsiednie grupy się nie nakładają.
  for (let i = 0; i < fs.leaders.length; i++) {
    for (let j = i + 1; j < fs.leaders.length; j++) {
      const a = fs.groups.get(fs.leaders[i]);
      const b = fs.groups.get(fs.leaders[j]);
      assert.ok(Math.hypot(a.slotX - b.slotX, a.slotY - b.slotY) >= a.footprint + b.footprint - 1, 'grupy na siebie');
    }
  }
});

test('battle: flagship line with the player in the middle, escorts behind their flagship off its fire lane', () => {
  const fs = F.createFormationState();
  const members = bigFleet();
  F.organizeTaskGroups(members, fs);
  F.measureGroups(fs);
  const frame = { x: 0, y: 0, dirX: 1, dirY: 0, reserve: 915 + F.FORMATION_CONFIG.rootReservePad };
  F.layoutBattle(fs, frame);
  const front = fs.leaders.map(L => fs.groups.get(L)).filter(g => g.fwd === 0);
  const rear = fs.leaders.map(L => fs.groups.get(L)).filter(g => g.fwd < 0);
  assert.equal(front.length, F.FORMATION_CONFIG.frontRowMaxWithRoot, 'linia przez gracza ma limit grup');
  assert.equal(rear.length, 5 - front.length);
  assert.equal(front.filter(g => g.lat < 0).length, front.filter(g => g.lat > 0).length, 'gracz w środku linii');
  for (const g of front) assert.ok(Math.abs(g.lat) >= frame.reserve + g.width / 2 - 1, 'grupa w miejscu gracza');
  for (const L of fs.leaders) {
    const g = fs.groups.get(L);
    for (let k = 0; k < g.escorts.length; k++) {
      const fwd = g.ex[k] - L.x; // oś natarcia = +X
      const lat = g.ey[k] - L.y;
      assert.ok(fwd < -(L.radius + 111), 'eskorta nie stoi za okrętem flagowym');
      assert.ok(Math.abs(lat) > L.radius + 111, 'eskorta w pasie ognia okrętu flagowego');
    }
  }
});

// ---------------------------------------------------------------------------
// Zachowanie (dowódca + mózgi + model lotu)

function spawnWing(player) {
  const out = [];
  const place = (kind, spreadX, spreadY) => {
    const s = makeShip('friendly', kind, -spreadX + rnd() * spreadX * 2, -spreadY + rnd() * spreadY * 2, rnd() * 6);
    s.supportData = { leader: player, type: kind };
    out.push(s);
  };
  for (let i = 0; i < 5; i++) place('battleship', 6000, 9000);
  for (let i = 0; i < 5; i++) place('destroyer', 6000, 9000);
  for (let i = 0; i < 50; i++) place('frigate_pd', 8000, 10000);
  return out;
}

test('a large escort wing gathers into groups around the player instead of one long line', () => {
  resetWorld();
  const player = makePlayer();
  window.ship = player;
  window.SupportWing = { order: 'guard' };
  const wing = spawnWing(player);
  world.push(...wing);
  simulate(wing, player, 50);
  simulate(wing, player, 25, { x: 600, y: 0 });

  assert.equal(Coord.getFleetPhase('friendly').phase, 'cruise');
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxFromPlayer = 0;
  let maxFromLeader = 0;
  for (const s of wing) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
    maxFromPlayer = Math.max(maxFromPlayer, Math.hypot(s.x - player.x, s.y - player.y));
    const slot = Coord.getBattleSlot(s);
    assert.ok(slot && slot.kind === 'cruise', 'okręt bez miejsca w szyku');
    if (slot.role === 'escort') {
      assert.equal(slot.leader.type, 'battleship');
      maxFromLeader = Math.max(maxFromLeader, Math.hypot(s.x - slot.leader.x, s.y - slot.leader.y));
    }
  }
  // Dawniej: 60 okrętów w linii co 1500 j. — ±45 km.
  assert.ok(maxX - minX < 12000 && maxY - minY < 12000, `szyk ${(maxX - minX).toFixed(0)} × ${(maxY - minY).toFixed(0)}`);
  assert.ok(maxFromPlayer < 7000, `pancerniki/eskorta daleko od gracza: ${maxFromPlayer.toFixed(0)}`);
  assert.ok(maxFromLeader < 2500, `eskorta daleko od swojego pancernika: ${maxFromLeader.toFixed(0)}`);
  delete window.SupportWing;
  window.ship = null;
});

test('escort stance: an approaching enemy gets a flagship line through the player, escorts stay with their group', () => {
  resetWorld();
  const player = makePlayer();
  window.ship = player;
  window.SupportWing = { order: 'guard' };
  const wing = spawnWing(player);
  world.push(...wing);
  simulate(wing, player, 45);
  // Wróg ~11 km z przodu — w smyczy ESKORTY (14 km); stoi, żeby był widoczny sam szyk.
  const raiders = [makeShip('pirate', 'battleship', 10000, 4000, Math.PI), makeShip('pirate', 'destroyer', 11000, 4500, Math.PI)];
  for (const r of raiders) r.ai = () => {};
  const all = [...wing, ...raiders];
  world.push(...raiders);
  simulate(all, player, 25);

  assert.equal(Coord.getFleetPhase('friendly').phase, 'guard');
  const axis = Math.atan2(4100, 10200);
  let maxLeaderFromPlayer = 0;
  for (const s of wing) {
    const slot = Coord.getBattleSlot(s);
    assert.ok(slot && slot.kind === 'line', 'bez miejsca w linii');
    if (slot.role === 'leader') {
      maxLeaderFromPlayer = Math.max(maxLeaderFromPlayer, Math.hypot(slot.x - player.x, slot.y - player.y));
    } else {
      // Miejsce eskorty: za swoim okrętem flagowym (względem osi natarcia).
      const L = slot.leader;
      const behind = (slot.x - L.x) * Math.cos(axis) + (slot.y - L.y) * Math.sin(axis);
      assert.ok(behind < -300, `eskorta przed swoim pancernikiem: ${behind.toFixed(0)}`);
      // ESKORTA: eskorta walczy na smyczy wokół miejsca w grupie.
      assert.ok(Number.isFinite(slot.leash) && slot.leash <= 3000);
      assert.ok(Math.hypot(s.x - L.x, s.y - L.y) < 6500, 'eskorta odbiegła od swojej grupy');
    }
  }
  assert.ok(maxLeaderFromPlayer < 7500, `okręty flagowe daleko od gracza: ${maxLeaderFromPlayer.toFixed(0)}`);
  delete window.SupportWing;
  window.ship = null;
});

// Kurs i zetknięcia skrzydła co tick: lot bokiem (kadłub 45–135° od kierunku
// lotu przy > 0,3 maxSpeed) i nowe zetknięcia par sojuszników (środki bliżej
// niż 0,8 sumy promieni — kadłuby są wydłużone, promień to pół długości).
// Postój burtą do celu zależy od gniazd dział — tests/npcWeaponArcs.test.mjs.
function wingMetrics(wing) {
  const m = { moving: 0, sideways: 0, contacts: 0 };
  const touching = new Set();
  const maxSpeed = new Map(wing.map(s => [s, resolveShipFlightSpec(s).maxSpeed]));
  m.tick = () => {
    for (const s of wing) {
      const sp = Math.hypot(s.vx, s.vy);
      if (sp > 0.3 * maxSpeed.get(s)) {
        m.moving++;
        const off = Math.abs(wrapAngle(Math.atan2(s.vy, s.vx) - s.angle));
        if (off > Math.PI / 4 && off < Math.PI * 0.75) m.sideways++;
      }
    }
    for (let i = 0; i < wing.length; i++) {
      for (let j = i + 1; j < wing.length; j++) {
        const a = wing[i];
        const b = wing[j];
        const lim = 0.8 * (a.radius + b.radius);
        const key = i * 1000 + j;
        const inContact = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < lim * lim;
        if (inContact && !touching.has(key)) m.contacts++;
        if (inContact) touching.add(key);
        else touching.delete(key);
      }
    }
  };
  return m;
}

test('a big wing neither flies sideways nor rams itself', () => {
  resetWorld();
  const player = makePlayer();
  const wing = spawnWing(player);
  let gather;
  let battle;
  try {
    useAIGrid(true);
    window.ship = player;
    window.SupportWing = { order: 'guard' };
    world.push(...wing);
    gather = wingMetrics(wing);
    simulate(wing, player, 45, null, gather.tick);
    const raiders = [makeShip('pirate', 'battleship', 10000, 4000, Math.PI), makeShip('pirate', 'destroyer', 11000, 4500, Math.PI)];
    for (const r of raiders) r.ai = () => {};
    world.push(...raiders);
    battle = wingMetrics(wing);
    simulate([...wing, ...raiders], player, 30, null, battle.tick);
  } finally {
    useAIGrid(false);
    delete window.SupportWing;
    window.ship = null;
  }

  const pct = (a, b) => (b ? (100 * a) / b : 0);
  const sidewaysGather = pct(gather.sideways, gather.moving);
  const sidewaysBattle = pct(battle.sideways, battle.moving);
  // Dawniej w tym scenariuszu: 61% lotu bokiem przy zbiórce (kurs bojowy
  // w pełnym biegu), 41% w walce (eskorty cofające się za okręt flagowy
  // obracały się rufą do wroga i z powrotem); po zmianach ~8% i ~8% (reszta to
  // chwile obrotu). Pełniejszy pomiar: node scripts/szyk-floty.mjs --seeds 1-6.
  assert.ok(sidewaysGather < 15, `zbiórka: ${sidewaysGather.toFixed(1)}% lotu bokiem`);
  assert.ok(sidewaysBattle < 15, `walka: ${sidewaysBattle.toFixed(1)}% lotu bokiem`);
  assert.ok(gather.contacts + battle.contacts <= 3, `zetknięcia: zbiórka ${gather.contacts}, walka ${battle.contacts}`);
});

test('escort slots keep clear of the player hull', () => {
  const fs = F.createFormationState();
  const leader = bareShip('battleship', 0, 0);
  const g = { leader, cls: 'battleship', escorts: [bareShip('frigate_pd'), bareShip('frigate_pd')], ex: [100, 2500], ey: [0, 2500], rE: 111 };
  fs.leaders.push(leader);
  fs.groups.set(leader, g);
  F.keepEscortSlotsClear(fs, 0, 0, 915);
  const clear = 915 + 111 + F.FORMATION_CONFIG.rootGap;
  assert.ok(Math.abs(Math.hypot(g.ex[0], g.ey[0]) - clear) < 1e-6, 'miejsce na kadłubie gracza nie odsunięte');
  assert.deepEqual([g.ex[1], g.ey[1]], [2500, 2500], 'miejsce poza strefą nie może się ruszyć');
});

test('a ship whose formation slot lies behind the player goes around it instead of stopping', () => {
  resetWorld();
  const player = makePlayer();
  window.ship = player;
  const ff = makeShip('friendly', 'frigate_pd', -1300, 0, 0);
  // Cel po drugiej stronie gracza, na prostej przez jego kadłub.
  let stuck = 0;
  let minDist = Infinity;
  for (let i = 0; i < 120 * 12; i++) {
    window.__frameId++;
    if (i % 6 === 0) {
      window.capitalArriveTo(ff, 4000, 0, { dt: BRAIN_DT, speedMode: 'combat' });
    }
    stepShipFlight(ff, DT);
    if (Math.hypot(ff.vx, ff.vy) < 5 && Math.hypot(ff.x - 4000, ff.y) > 500 && i > 120) stuck++;
    minDist = Math.min(minDist, Math.hypot(ff.x, ff.y));
  }
  assert.ok(Math.hypot(ff.x - 4000, ff.y) < 400, `nie dotarł: ${ff.x.toFixed(0)},${ff.y.toFixed(0)}`);
  assert.ok(stuck < 60, 'stał przed graczem');
  // Po drodze nie wszedł na kadłub gracza (promienie 915 + 111).
  assert.ok(minDist > 1026, `przeleciał przez gracza: ${minDist.toFixed(0)}`);
  window.ship = null;
});
