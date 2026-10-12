import test from 'node:test';
import assert from 'node:assert/strict';
import { createScoutBay, SCOUT_PHASE, SCOUT_TUNE } from '../src/game/scoutBay.js';

// Atrapa gry: Atlas jedzie stałą prędkością, fregata to prosty punkt z intencją „arrive” (pierwszy rząd).
function makeWorld() {
  const atlas = { pos: { x: 0, y: 0 }, vel: { x: 50, y: 0 }, angle: 0, w: 1800, h: 800 };
  const enemies = [
    { id: 'e1', x: 30000, y: 0, radius: 60, displayName: 'Reaver' },
    { id: 'e2', x: 33000, y: 4000, radius: 60, displayName: 'Marauder' },
    { id: 'far', x: 90000, y: 0, radius: 60, displayName: 'Daleki' }
  ];
  let spawned = 0;
  let removed = 0;
  const world = { atlas, enemies, npc: null, get spawned() { return spawned; }, get removed() { return removed; } };
  const env = {
    bayLocal: { x: 34, y: 0 },
    carrier: () => atlas,
    spawn(p) { spawned++; world.npc = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, angle: p.angle, maxSpeed: 400, isCollidable: true, intent: null }; return world.npc; },
    remove(n) { removed++; n.dead = true; world.npc = null; },
    ghost(n, on) { n.isCollidable = !on; },
    fly(n, x, y, vx, vy, face) { n.intent = { x, y, vx, vy, face }; },
    place(n, x, y, a, vx, vy) { n.x = x; n.y = y; n.angle = a; n.vx = vx; n.vy = vy; n.intent = null; },
    contacts(out) { out.length = 0; for (const e of enemies) if (!e.dead) out.push(e); return out; },
    visible: (e) => Math.hypot(e.x - (world.npc?.x ?? 1e9), e.y - (world.npc?.y ?? 1e9)) < SCOUT_TUNE.visionRange,
    radius: (e) => e.radius || 60,
    label: (e) => e.displayName
  };
  return { world, env };
}

function stepWorld(bay, world, dt) {
  bay.step(dt);
  const a = world.atlas;
  a.pos.x += a.vel.x * dt; a.pos.y += a.vel.y * dt;
  const n = world.npc;
  if (n && n.intent) {
    // pilot: prędkość ku punktowi + prędkość odniesienia, z sufitem
    const it = n.intent;
    let vx = it.vx + (it.x - n.x) * 1.5, vy = it.vy + (it.y - n.y) * 1.5;
    const s = Math.hypot(vx, vy), cap = 600;
    if (s > cap) { vx *= cap / s; vy *= cap / s; }
    n.vx = vx; n.vy = vy; n.x += vx * dt; n.y += vy * dt; n.angle = it.face;
  }
  bay.afterNpc();
}

test('cykl: ładownia → start (duch) → stery → powrót → lądowanie → ładownia', () => {
  const { world, env } = makeWorld();
  const bay = createScoutBay(env);
  const events = [];
  for (const ev of ['launch', 'deployed', 'recall', 'landed', 'stowed']) bay.on(ev, () => events.push(ev));
  assert.equal(bay.launch(), false, 'bez fregaty nie startuje');
  bay.grant();
  assert.equal(bay.phase, SCOUT_PHASE.STOWED);
  assert.ok(bay.launch());
  assert.ok(bay.controlling);
  const dt = 1 / 60;
  let ghostSeen = false;
  for (let i = 0; i < 60 * 20 && bay.phase !== SCOUT_PHASE.FLIGHT; i++) {
    stepWorld(bay, world, dt);
    if (world.npc && world.npc.isCollidable === false) ghostSeen = true;
  }
  assert.equal(bay.phase, SCOUT_PHASE.FLIGHT);
  assert.ok(ghostSeen, 'start jako duch');
  assert.equal(world.npc.isCollidable, true, 'po wylocie znad kadłuba — zwykły byt');
  // stery: W naprzód 5 s
  bay.setControl(1, 0, 0);
  const x0 = world.npc.x;
  for (let i = 0; i < 300; i++) stepWorld(bay, world, dt);
  assert.ok(world.npc.x - x0 > 500, 'fregata leci naprzód');
  bay.setControl(0, 0, 0);
  assert.ok(bay.recall());
  assert.equal(bay.controlling, false);
  for (let i = 0; i < 60 * 120 && bay.phase !== SCOUT_PHASE.STOWED; i++) stepWorld(bay, world, dt);
  assert.equal(bay.phase, SCOUT_PHASE.STOWED);
  assert.equal(world.removed, 1);
  assert.deepEqual(events, ['launch', 'deployed', 'recall', 'landed', 'stowed']);
});

test('skan oznacza wrogów w zasięgu fali, T przełącza, znacznik zostaje w ostatnim miejscu', () => {
  const { world, env } = makeWorld();
  const bay = createScoutBay(env);
  bay.grant(); bay.launch();
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 20 && bay.phase !== SCOUT_PHASE.FLIGHT; i++) stepWorld(bay, world, dt);
  // przenieś fregatę pod bazę
  world.npc.x = 27000; world.npc.y = 0;
  assert.ok(bay.startScan());
  assert.equal(bay.startScan(), false, 'czas odnowienia');
  for (let i = 0; i < 180; i++) stepWorld(bay, world, dt);
  const ids = bay.markedTargets().map((m) => m.label).sort();
  assert.deepEqual(ids, ['Marauder', 'Reaver']);
  // T: zdejmij Reavera, oznacz ponownie
  assert.equal(bay.toggleMarkAt(30000, 0, 200), null);
  assert.equal(bay.marks.length, 1);
  const m = bay.toggleMarkAt(30010, 5, 200);
  assert.equal(m.label, 'Reaver');
  assert.equal(m.source, 'manual');
  // daleki kontakt — poza zasięgiem oznaczania
  assert.equal(bay.pickAt(90000, 0, 500), null);
  // fregata odlatuje: kontakty w mgle, znacznik zostaje w ostatnim miejscu
  world.npc.x = 0;
  world.enemies[0].x = 31000;
  for (let i = 0; i < 10; i++) stepWorld(bay, world, dt);
  const r = bay.marks.find((q) => q.label === 'Reaver');
  assert.equal(r.visible, false);
  assert.equal(r.x, 30000);
  // zniszczony cel
  const lost = [];
  bay.on('markDestroyed', (q) => lost.push(q.label));
  world.enemies[1].dead = true;
  stepWorld(bay, world, dt);
  assert.deepEqual(lost, ['Marauder']);
});

test('utrata fregaty: faza LOST, stery wracają', () => {
  const { world, env } = makeWorld();
  const bay = createScoutBay(env);
  bay.grant(); bay.launch();
  for (let i = 0; i < 60 * 20 && bay.phase !== SCOUT_PHASE.FLIGHT; i++) stepWorld(bay, world, 1 / 60);
  let lost = 0;
  bay.on('lost', () => lost++);
  world.npc.dead = true;
  stepWorld(bay, world, 1 / 60);
  assert.equal(bay.phase, SCOUT_PHASE.LOST);
  assert.equal(bay.controlling, false);
  assert.equal(lost, 1);
  assert.equal(bay.available(), false);
});

function returnTrack(zones) {
  const { world, env } = makeWorld();
  world.atlas.vel.x = 0;
  const bay = createScoutBay(env);
  bay.grant(); bay.launch();
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 20 && bay.phase !== SCOUT_PHASE.FLIGHT; i++) stepWorld(bay, world, dt);
  // fregata za bazą (koło na prostej fregata → Atlas)
  Object.assign(world.npc, { x: 30000, y: 500, vx: 0, vy: 0 });
  bay.setAvoid(zones);
  bay.recall();
  let minD = Infinity;
  let frames = 0;
  for (; frames < 60 * 400 && bay.phase === SCOUT_PHASE.RETURNING; frames++) {
    stepWorld(bay, world, dt);
    if (zones && world.npc) for (const z of zones) minD = Math.min(minD, Math.hypot(world.npc.x - z.x, world.npc.y - z.y));
  }
  return { bay, minD, frames };
}

test('powrót omija strefę unikania po stycznej (krótsza strona), bez strefy — prosto', () => {
  const zone = { x: 15000, y: 0, r: 4000 };
  const a = returnTrack([zone]);
  assert.equal(a.bay.phase, SCOUT_PHASE.LANDING, 'doleciała do luku');
  assert.ok(a.minD >= zone.r, `tor wszedł w strefę: ${a.minD.toFixed(0)} < ${zone.r}`);
  assert.equal(a.bay.avoid.length, 1);
  const b = returnTrack(null);
  assert.equal(b.bay.phase, SCOUT_PHASE.LANDING);
  assert.ok(b.frames < a.frames, 'prosto szybciej niż objazdem');
  assert.equal(b.bay.avoid.length, 0);
  // fregata w środku strefy — najpierw na zewnątrz
  const { world, env } = makeWorld();
  const bay = createScoutBay(env);
  bay.setAvoid([zone]);
  const out = { x: 0, y: 0 };
  assert.ok(bay._avoidWaypoint(14000, 100, 0, 0, out));
  assert.ok(Math.hypot(out.x - zone.x, out.y - zone.y) > zone.r, 'punkt poza strefą');
  bay.setAvoid(null);
  assert.equal(bay._avoidWaypoint(30000, 0, 0, 0, out), false);
  void world;
});

function deployed(extraEnv = {}) {
  const { world, env } = makeWorld();
  Object.assign(env, extraEnv);
  world.atlas.vel.x = 0;
  const bay = createScoutBay(env);
  bay.grant();
  const dt = 1 / 60;
  assert.equal(bay.toggleCloak() !== '', true, 'w ładowni maskowanie się nie włącza');
  bay.launch();
  for (let i = 0; i < 60 * 20 && bay.phase !== SCOUT_PHASE.FLIGHT; i++) stepWorld(bay, world, dt);
  assert.equal(bay.phase, SCOUT_PHASE.FLIGHT);
  return { bay, world, env, dt };
}

test('maskowanie fregaty: I ukrywa fregatę (nie Atlasa), trafienie zrywa, lądowanie wyłącza', () => {
  const { bay, world, dt } = deployed();
  assert.equal(world.npc.cloak, bay.cloak, 'encja fregaty niesie stan maskowania');
  const ev = [];
  bay.on('cloakHidden', () => ev.push('hidden'));
  bay.on('cloakBroken', (d) => ev.push('broken:' + d.reason));
  assert.equal(bay.toggleCloak(), '');
  assert.equal(bay.cloakHidden(), false, 'rozruch — jeszcze widać');
  for (let i = 0; i < 90; i++) stepWorld(bay, world, dt);
  assert.equal(bay.cloakHidden(), true);
  assert.equal(world.atlas.cloak, undefined, 'Atlas nietknięty');
  assert.ok(bay.breakCloak('hit'));
  assert.equal(bay.cloakHidden(), false);
  assert.equal(bay.cloak.state, 'cooldown');
  assert.ok(/przeładowanie/.test(bay.toggleCloak()), 'po zerwaniu — przeładowanie');
  assert.deepEqual(ev, ['hidden', 'broken:hit']);
  for (let i = 0; i < 60 * 9; i++) stepWorld(bay, world, dt);
  assert.equal(bay.toggleCloak(), '');
  bay.recall();
  for (let i = 0; i < 60 * 120 && bay.phase !== SCOUT_PHASE.STOWED; i++) stepWorld(bay, world, dt);
  assert.equal(bay.phase, SCOUT_PHASE.STOWED);
  assert.equal(bay.cloak.state, 'off', 'w ładowni maskowanie wyłączone');
});

test('oko (3): koło odsłoniętej mgły pod kursorem, w zasięgu od fregaty, z baterii', () => {
  const reveals = new Map();
  const { bay, world, dt } = deployed({
    reveal: (id, x, y, r) => reveals.set(id, { x, y, r }),
    unreveal: (id) => reveals.delete(id)
  });
  bay.setEyeAim(world.npc.x + 5000, world.npc.y);
  assert.equal(bay.toggleEye(), '');
  stepWorld(bay, world, dt);
  const z = reveals.get('scout-eye');
  assert.ok(z && Math.abs(z.x - (world.npc.x + 5000)) < 50 && z.r === SCOUT_TUNE.eyeRadius, 'koło pod kursorem');
  // kursor za daleko — koło przy granicy zasięgu
  bay.setEyeAim(world.npc.x + 90000, world.npc.y);
  for (let i = 0; i < 120; i++) stepWorld(bay, world, dt);
  const z2 = reveals.get('scout-eye');
  assert.ok(Math.hypot(z2.x - world.npc.x, z2.y - world.npc.y) <= SCOUT_TUNE.eyeRange + 1, 'najwyżej eyeRange od fregaty');
  // bateria się wyczerpuje — oko gaśnie, strefa znika
  let empty = 0;
  bay.on('eyeEmpty', () => empty++);
  for (let i = 0; i < 60 * (SCOUT_TUNE.eyeEnergy + 2); i++) stepWorld(bay, world, dt);
  assert.equal(empty, 1);
  assert.equal(bay.eye.on, false);
  assert.equal(reveals.has('scout-eye'), false);
  assert.ok(/bateria/.test(bay.toggleEye()), 'pusta bateria — odmowa');
});

test('daleki skan (4): klin w stronę kursora, echa skupisk z klasą masy i niepewnością, gasną', () => {
  const { bay, world, dt } = deployed();
  const fx = world.npc.x, fy = world.npc.y;
  // grupa trzech w klinie (blisko siebie), jeden w klinie daleko, jeden poza klinem, jeden poza zasięgiem
  const targets = [
    { x: fx + 40000, y: fy + 200, radius: 300 }, { x: fx + 40800, y: fy - 500, radius: 300 }, { x: fx + 41000, y: fy + 900, radius: 1500 },
    { x: fx + 60000, y: fy + 1000, radius: 80 },
    { x: fx + 20000, y: fy + 20000, radius: 300 },
    { x: fx + 90000, y: fy, radius: 300 }
  ];
  bay.env.scanTargets = (out) => { out.length = 0; for (const t of targets) out.push(t); return out; };
  assert.equal(bay.startLongScan(fx + 1000, fy), '');
  assert.ok(/w toku/.test(bay.startLongScan(fx + 1000, fy)));
  for (let i = 0; i < 60 * 3; i++) stepWorld(bay, world, dt);
  assert.equal(bay.long.active, false);
  assert.equal(bay.echoes.length, 2, 'grupa = jedno echo, daleki pojedynczy = drugie');
  const group = bay.echoes.find((e) => e.n === 3);
  assert.ok(group, 'echo grupy liczy 3 obiekty');
  assert.equal(group.cls, 3, 'klasa masy = największa w grupie');
  assert.ok(group.err >= SCOUT_TUNE.echoErrMin && Math.hypot(group.x - group.cx, group.y - group.cy) <= group.err, 'położenie w kole niepewności');
  assert.ok(/2–3 obiekty/.test(bay.echoLabel(group)));
  assert.ok(/przeładowanie/.test(bay.startLongScan(fx, fy + 1000)));
  for (let i = 0; i < 60 * (SCOUT_TUNE.echoLife + 1); i++) stepWorld(bay, world, dt);
  assert.equal(bay.echoes.length, 0, 'echa gasną');
});

test('start z ładowni: na dnie mniejsza, po wynurzeniu rozmiar z gry i nad Atlasem; lądowanie odwrotnie', async () => {
  const { scoutFrigateRenderPose, SCOUT_BAY_LOOK } = await import('../src/3d/cargo/scoutBay3D.js');
  const q = { z: 0, scale: 1, lights: true, engines: true, turrets: true };
  scoutFrigateRenderPose('opening', 0, true, -56, q);
  assert.equal(q.z, -56);
  assert.equal(q.scale, SCOUT_BAY_LOOK.scale0);
  assert.equal(q.turrets, false, 'wrota w ruchu — wieże kanwy ukryte');
  assert.equal(q.engines, false);
  assert.equal(q.lights, false);
  let prevS = 0, prevZ = -Infinity;
  for (let l = 0; l <= 1.0001; l += 0.1) {
    scoutFrigateRenderPose('rising', l, true, -56, q);
    assert.ok(q.scale >= prevS && q.z >= prevZ, 'rośnie i wznosi się monotonicznie');
    prevS = q.scale; prevZ = q.z;
  }
  assert.ok(Math.abs(q.scale - 1) < 1e-9 && Math.abs(q.z - SCOUT_BAY_LOOK.aboveZ) < 1e-9);
  assert.ok(SCOUT_BAY_LOOK.aboveZ > 10.6 + 0.06, 'nad mostkiem rufowym Atlasa');
  scoutFrigateRenderPose('departing', 1, true, -56, q);
  assert.deepEqual([q.z, q.scale, q.engines, q.lights], [SCOUT_BAY_LOOK.aboveZ, 1, false, true]);
  scoutFrigateRenderPose('flight', 1, false, -56, q);
  assert.deepEqual([q.z, q.scale, q.engines, q.lights, q.turrets], [0, 1, true, true, true]);
  scoutFrigateRenderPose('returning', 1, true, -56, q);
  assert.equal(q.z, SCOUT_BAY_LOOK.aboveZ, 'duch nad Atlasem przy powrocie');
  scoutFrigateRenderPose('landing', 0, true, -56, q);
  assert.equal(q.z, -56);
});
