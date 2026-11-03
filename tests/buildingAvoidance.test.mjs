import test from 'node:test';
import assert from 'node:assert/strict';

// Omijanie budowli przez okręty AI (2026-10-28, zgłoszenie użytkownika: „supercapital wbija się w habitat zamiast okrążyć
// budowlę”): budowle jako przeszkody STATYCZNE indeksu AI (src/ai/aiWreckIndex.js — kapsuły z wielokątów brył,
// capsuleFromPolygon), trasy wokół nich (src/ai/staticRoutes.js — graf widoczności) w pilocie mózgów
// (capitalArriveControls) i rozkazów RTS (capitalCommandSteer), baza piratów misji 1 (pirateBaseObstacles) i ucieczka
// okrętu misji (storyNpcControl.flee). Pomiar na całej bazie: node scripts/omijanie-budowli.mjs.

globalThis.window = globalThis.window || {};
Object.assign(globalThis.window, {
  wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
  queryAIGrid: null,
  ship: null,
  __frameId: 1,
  bullets: [],
  __npcRocketThreats: [],
  __playerRocketThreats: [],
  wrecks: []
});

const Idx = await import('../src/ai/aiWreckIndex.js');
const Routes = await import('../src/ai/staticRoutes.js');
const { capitalArriveTo, capitalCommandSteer } = await import('../src/ai/capitalAI.js');
const { stepShipFlight, resolveShipFlightSpec } = await import('../src/game/flight/shipFlightModel.js');

const HZ = 120;
const frigate = (x, y) => ({ x, y, vx: 0, vy: 0, angle: 0, angVel: 0, radius: 111, type: 'frigate_pd', shipFrame: 'terran_frigate' });
const battleship = (x, y) => ({ x, y, vx: 0, vy: 0, angle: 0, angVel: 0, radius: 312, type: 'battleship', shipFrame: 'terran_battleship' });
// Budowla-kapsuła: środek, kąt osi, pół-długość, pół-szerokość, właściciel.
const wall = (x, y, angle, h, w, owner = null) => ({ x, y, ux: Math.cos(angle), uy: Math.sin(angle), h, w, vx: 0, vy: 0, obstacleOwner: owner });
const capDist = (px, py, o) => {
  let s = (px - o.x) * o.ux + (py - o.y) * o.uy;
  if (s < -o.h) s = -o.h; else if (s > o.h) s = o.h;
  return Math.hypot(px - o.x - o.ux * s, py - o.y - o.uy * s);
};

// Lot pilotem mózgów do (bx, by): takt AI 20 Hz, model lotu 120 Hz. Zwraca czas dolotu (albo null) i najmniejszy luz
// środka okrętu od budowli (odległość od osi kapsuły minus jej pół-szerokość).
function fly(ship, bx, by, statics, maxT = 120) {
  Idx.rebuildWreckIndex([], null, statics);
  let minGap = Infinity;
  let arrived = null;
  try {
    for (let i = 0; i < HZ * maxT; i++) {
      window.__frameId++;
      if (i % 6 === 0) capitalArriveTo(ship, bx, by, { dt: 1 / 20, speedMode: 'combat', arrival: 0 });
      stepShipFlight(ship, 1 / HZ);
      for (const o of statics || []) minGap = Math.min(minGap, capDist(ship.x, ship.y, o) - o.w);
      if (Math.hypot(ship.x - bx, ship.y - by) < 300) { arrived = i / HZ; break; }
    }
  } finally {
    Idx.resetWreckIndex();
  }
  return { arrived, minGap };
}

test('capsuleFromPolygon: rectangle along its long side, regular polygon ~ circle, every vertex inside', () => {
  const a = Math.PI / 6;
  const rect = [[-1000, -100], [1000, -100], [1000, 100], [-1000, 100]].map(([u, v]) => ({
    x: 500 + u * Math.cos(a) - v * Math.sin(a), y: -300 + u * Math.sin(a) + v * Math.cos(a)
  }));
  const c = Idx.capsuleFromPolygon(rect);
  assert.ok(Math.abs(Math.abs(c.ux * Math.cos(a) + c.uy * Math.sin(a)) - 1) < 1e-9, 'oś wzdłuż dłuższego boku');
  assert.ok(Math.abs(c.h - 1000) < 1e-6 && Math.abs(c.w - 100) < 1e-6, `h ${c.h}, w ${c.w}`);
  assert.ok(Math.hypot(c.x - 500, c.y + 300) < 1e-6);
  const ring = Array.from({ length: 16 }, (_, i) => ({ x: 300 * Math.cos(i * Math.PI / 8), y: 300 * Math.sin(i * Math.PI / 8) }));
  const r = Idx.capsuleFromPolygon(ring);
  assert.ok(r.h < 30 && r.w <= 300 + 1e-6 && r.w > 280, `koło: h ${r.h}, w ${r.w}`);
  // losowe wielokąty wypukłe (otoczka punktów) — każdy wierzchołek w kapsule
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let n = 0; n < 50; n++) {
    const pts = Array.from({ length: 3 + Math.floor(rnd() * 9) }, () => ({ x: (rnd() - 0.5) * 4000, y: (rnd() - 0.5) * 900 }));
    const k = Idx.capsuleFromPolygon(pts);
    for (const p of pts) assert.ok(capDist(p.x, p.y, k) <= k.w + 1e-6, 'wierzchołek poza kapsułą');
  }
});

test('wreck index takes buildings as static capsules with explicit geometry and owner; version follows the set', () => {
  const owner = { id: 'pier' };
  const s1 = wall(1000, 0, Math.PI / 2, 1500, 90, owner);
  const s2 = wall(-3000, 500, 0, 0, 800);
  const v0 = Idx.getWreckIndex().staticsVer;
  const idx = Idx.rebuildWreckIndex([{ x: 0, y: 0, radius: 300, angle: 0, isCollidable: true }], null, [s1, s2, { x: 0, y: 0, w: 0 }]);
  assert.equal(idx.count, 3);
  const i1 = idx.refs.indexOf(s1);
  assert.ok(i1 >= 0 && idx.owner[i1] === owner);
  assert.ok(Math.abs(idx.h[i1] - 1500) < 1e-9 && Math.abs(idx.w[i1] - 90) < 1e-9 && Math.abs(idx.uy[i1] - 1) < 1e-9);
  assert.equal(idx.r[i1], 1590);
  assert.equal(idx.owner[idx.refs.findIndex((w) => w.radius === 300)], null, 'wrak bez właściciela-budowli');
  assert.deepEqual(idx.statics, [s1, s2]);
  const v1 = idx.staticsVer;
  assert.ok(v1 > v0);
  Idx.rebuildWreckIndex([], null, [s1, s2]);
  assert.equal(Idx.getWreckIndex().staticsVer, v1, 'ten sam zestaw — ta sama wersja');
  Idx.rebuildWreckIndex([], null, [s1]);
  assert.ok(Idx.getWreckIndex().staticsVer > v1, 'zmiana zestawu — nowa wersja');
  Idx.resetWreckIndex();
  assert.equal(Idx.getWreckIndex().statics.length, 0);
});

test('route: a wall between ship and target gives a waypoint past its end; a visible target needs no route', () => {
  const W = wall(0, 0, Math.PI / 2, 3000, 100);
  Idx.rebuildWreckIndex([], null, [W]);
  try {
    const s = frigate(-4000, 0);
    const out = {};
    assert.equal(Routes.staticRouteAim(s, 4000, 0, 60, out), true);
    assert.ok(Math.abs(out.y) > 3000, `punkt trasy za końcem ściany: ${Math.round(out.x)}, ${Math.round(out.y)}`);
    assert.ok(out.len > 8000 && out.len < 11000, `długość drogi ${Math.round(out.len)}`);
    assert.equal(Routes.staticRouteAim(frigate(-4000, 6000), 4000, 6000, 60, {}), false, 'cel widać wprost');
  } finally {
    Idx.resetWreckIndex();
  }
});

test('a battleship flies around a T of piers to a target behind it instead of stopping or crossing it (A/B)', () => {
  // T: poprzeczka 8 km w poprzek kursu i trzon 4 km w stronę okrętu (kieszeń, w której utykało omijanie lokalne)
  const T = [wall(0, 0, Math.PI / 2, 4000, 100), wall(-2000, 0, 0, 2000, 100)];
  const on = fly(battleship(-6000, 1500), 5000, 0, T);
  assert.ok(on.arrived !== null, 'nie doleciał za budowlę');
  assert.ok(on.minGap > 0, `wleciał w budowlę: luz ${on.minGap.toFixed(0)}`);
  // bez budowli w indeksie ten sam lot idzie przez poprzeczkę
  const off = fly(battleship(-6000, 1500), 5000, 0, null);
  let minGapOff = Infinity;
  assert.ok(off.arrived !== null);
  // ponownie, licząc luz od tych samych kapsuł (fly bez statics ich nie mierzy)
  Idx.resetWreckIndex();
  const s = battleship(-6000, 1500);
  for (let i = 0; i < HZ * 60; i++) {
    window.__frameId++;
    if (i % 6 === 0) capitalArriveTo(s, 5000, 0, { dt: 1 / 20, speedMode: 'combat', arrival: 0 });
    stepShipFlight(s, 1 / HZ);
    for (const o of T) minGapOff = Math.min(minGapOff, capDist(s.x, s.y, o) - o.w);
    if (Math.hypot(s.x - 5000, s.y) < 300) break;
  }
  assert.ok(minGapOff < 0, 'bez budowli w indeksie lot nie przecina poprzeczki — scenariusz bez sensu');
});

test('RTS order steering: route waypoint as a detour, not a blocked stop; the ordered building itself does not block', () => {
  const pierOwner = { id: 'piers' };
  const W = wall(0, 0, Math.PI / 2, 3000, 100, pierOwner);
  Idx.rebuildWreckIndex([], null, [W]);
  try {
    const s = battleship(-4000, 0);
    resolveShipFlightSpec(s);
    const out = { detour: false, blocked: 0, aimX: 0, aimY: 0, aimVx: 0, aimVy: 0, approachCap: Infinity, totalCap: Infinity };
    capitalCommandSteer(s, 4000, 0, 200, null, false, out);
    assert.equal(out.detour, true);
    assert.equal(out.blocked, 0);
    assert.ok(Math.abs(out.aimY) > 3000, `objazd końca ściany: ${Math.round(out.aimX)}, ${Math.round(out.aimY)}`);
    // taran budowli: punkt rozkazu w niej, cel = jej właściciel — bez trasy i bez ogranicznika od niej
    const ram = { detour: false, blocked: 0, aimX: 0, aimY: 0, aimVx: 0, aimVy: 0, approachCap: Infinity, totalCap: Infinity };
    capitalCommandSteer(s, 0, 0, 0, pierOwner, false, ram);
    assert.equal(ram.detour, false);
    assert.equal(ram.approachCap, Infinity);
  } finally {
    Idx.resetWreckIndex();
  }
});

test('pirate base obstacles: drum as one circle, other hit shapes as covering capsules; broken chunks drop out', async () => {
  const { planPirateBase } = await import('../src/game/story/pirateBaseSite.js');
  const BW = await import('../src/game/story/pirateBaseWorld.js');
  const plan = planPirateBase({ x: 0, y: 0 }, { x: -100000, y: 0 });
  // budowle z układu (habitat, wieżowce, paliwo, magazyn, pomosty)
  const owners = Object.fromEntries(Object.keys(plan.dock.layout.structures).map((k) => [k, { id: k }]));
  BW.attachPirateBaseWorld(owners, plan.dock);
  try {
    const list = BW.pirateBaseObstacles();
    const drum = list.find((o) => o.chunk === 'habitat');
    assert.ok(drum && drum.h === 0 && drum.w === plan.dock.layout.habitat.drumR && drum.obstacleOwner === owners.habitat);
    for (const sh of plan.dock.hitShapes) {
      const o = sh.structure === 'habitat' ? drum : list.find((r) => r.chunk === sh.chunk);
      assert.ok(o, `brak przeszkody dla ${sh.chunk}`);
      if (sh.structure !== 'habitat') assert.equal(o.obstacleOwner, owners[sh.structure]);
      for (const p of sh.pts) assert.ok(capDist(p.x, p.y, o) <= o.w + 1e-6, `${sh.chunk}: wierzchołek poza kapsułą`);
    }
    const n0 = list.length;
    assert.equal(n0, plan.dock.hitShapes.filter((s) => s.structure !== 'habitat').length + 1);
    BW.breakPirateBaseChunk('NP', {});
    assert.equal(BW.pirateBaseObstacles().length, n0 - 1);
    assert.ok(!BW.pirateBaseObstacles().some((o) => o.chunk === 'NP'));
    // bęben stoi, póki stoi którykolwiek jego kawałek
    const habChunks = [...new Set(plan.dock.hitShapes.filter((s) => s.structure === 'habitat').map((s) => s.chunk))];
    for (const id of habChunks.slice(0, -1)) BW.breakPirateBaseChunk(id, {});
    assert.ok(BW.pirateBaseObstacles().some((o) => o.chunk === 'habitat'));
    BW.hidePirateBaseChunk(habChunks[habChunks.length - 1]);
    assert.ok(!BW.pirateBaseObstacles().some((o) => o.chunk === 'habitat'));
  } finally {
    BW.detachPirateBaseWorld();
  }
  assert.equal(BW.pirateBaseObstacles().length, 0, 'bez bazy — bez przeszkód');
});

test('mission 1: the fleeing boss supercapital goes around the base instead of through the habitat', async () => {
  const { planPirateBase } = await import('../src/game/story/pirateBaseSite.js');
  const BW = await import('../src/game/story/pirateBaseWorld.js');
  const { createStoryNpcControl } = await import('../src/game/story/storyNpcControl.js');
  const { pointInPoly } = await import('../src/3d/portBuildings/pirateBaseLayout.js');
  const plan = planPirateBase({ x: 0, y: 0 }, { x: -100000, y: 0 });
  BW.attachPirateBaseWorld({ habitat: { id: 'habitat' }, fuel: { id: 'fuel' }, warehouse: { id: 'warehouse' }, piers: { id: 'piers' } }, plan.dock);
  const boss = plan.parked.find((p) => p.boss);
  const end = boss.launch.path[boss.launch.path.length - 1];
  const hab = plan.dock.habitat;
  const a = Math.atan2(hab.y - end.y, hab.x - end.x);
  const goal = { x: end.x + Math.cos(a) * 30000, y: end.y + Math.sin(a) * 30000 };
  // `mission` — okręt misji (StoryGame._park) lata modelem lotu (usesShipFlightModel)
  const npc = { x: end.x, y: end.y, vx: 0, vy: 0, angle: a, angVel: 0, radius: 600, type: 'pirate_supercapital', shipFrame: 'pirate_supercapital', isPirate: true, mission: true };
  let time = 0;
  const npcs = createStoryNpcControl({ gameTime: () => time, wake: () => {} });
  npcs.flee(npc, goal);
  const inBase = (x, y) => plan.dock.hitShapes.some((sh) => {
    const h = plan.dock.toHub(x, y);
    return pointInPoly(plan.dock.layout.hitSolids.find((s) => s.id === sh.id).poly, h.x, h.z);
  });
  let inside = 0;
  let arrived = false;
  try {
    for (let i = 0; i < HZ * 150 && !arrived; i++) {
      window.__frameId++;
      if (i % 6 === 0) Idx.rebuildWreckIndex([], null, BW.pirateBaseObstacles());
      npc.ai(1 / HZ);
      stepShipFlight(npc, 1 / HZ);
      time += 1 / HZ;
      if (inBase(npc.x, npc.y)) inside++;
      arrived = Math.hypot(npc.x - goal.x, npc.y - goal.y) < 500;
    }
  } finally {
    Idx.resetWreckIndex();
    BW.detachPirateBaseWorld();
  }
  assert.equal(inside, 0, 'herszt przeleciał przez bryły bazy');
  assert.ok(arrived, 'herszt nie doleciał do punktu ucieczki');
});
