import test from 'node:test';
import assert from 'node:assert/strict';

// Rój dronów naprawczych okrętu (src/game/repairRig.js, rejestr src/game/repairSwarm.js, dane src/data/repairDrones.js):
// lokalne prostowanie (HullBodies.straightenAt), skan potrzeb (repairNeeds), kolejność pracy, materiał z ładowni
// nosiciela, punkty kadłuba, łaty (pole węzła `patch`, remont w doku), gniazda broni i broń z inwentarza (index.html),
// trafienia dronów (pociski, wybuchy, strona), ten sam wynik przy 120 i 60 Hz.
globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies, REPAIR_NEED, HULL_BODY_CONFIG } = await import('../src/game/hullBodies.js');
const { raiseHullHpForRegrowth } = await import('../src/game/hullIntegrity.js');
const { RepairRig, DRONE_STATE, REPAIR_JOB, REPAIR_MSG, REPAIR_FX } = await import('../src/game/repairRig.js');
const { RepairSwarm } = await import('../src/game/repairSwarm.js');
const { REPAIR_TUNE, REPAIR_MATERIALS, repairDroneCountFor, repairMaterialCells, REPAIR_START_CARGO } = await import('../src/data/repairDrones.js');
const { buildRepairDroneArrays, repairDroneVertexCpu, REPAIR_DRONE_PART, REPAIR_DRONE_DIMS } = await import('../src/3d/repair/repairDroneModel.js');
const { HULL_PATCH_SHADE } = await import('../src/3d/beamHullSkin.js');
const { buildHullSkinTopology, writeHullSkin } = await import('../src/3d/beamHullSkin.js');
const { damageStampCpu } = await import('../src/3d/hullDamageMap.tsl.js');
const { makeBeamShip } = await import('./helpers/reactorHulls.mjs');
const { readIndexHtml, loadIndexFunction } = await import('./helpers/indexSource.mjs');

HullBodies.onRegrow = raiseHullHpForRegrowth;

function release(...entities) {
  for (const e of [...entities, ...window.wrecks]) HullBodies.release(e);
  window.wrecks.length = 0;
  RepairSwarm._reset();
}

// Ruch encji jak w grze (gra całkuje encje, silnik synchronizuje ciała), potem rig — w czasie gry.
function stepWorld(entities, n, dt, rigs = []) {
  for (let k = 0; k < n; k++) {
    const all = [...entities, ...window.wrecks];
    for (const e of all) {
      if (e.dead) continue;
      e.x += (e.vx || 0) * dt; e.y += (e.vy || 0) * dt; e.angle += (e.angVel || 0) * dt;
    }
    HullBodies.step(dt, all);
    for (const r of rigs) r.step(dt);
  }
}

// Atlas z kraterami i odciętą rufą (wrak odsunięty — nie stoi w miejscu odrostu).
function damagedAtlas({ angle = 0.3, vx = 120, vy = -40, angVel = 0.05, cut = true, dt = 1 / 120 } = {}) {
  const e = makeBeamShip(HullBodies, 'atlas');
  e.hull = { val: 12000, max: 12000 };
  e.angle = angle; e.vx = vx; e.vy = vy; e.angVel = angVel;
  const c = Math.cos(e.angle), s = Math.sin(e.angle);
  for (const [lx, ly] of [[-400, 60], [-150, -90], [200, 40], [520, -60]]) {
    const x = e.x + c * lx - s * ly, y = e.y + s * lx + c * ly;
    HullBodies.impact(e, x, y, 2000, { x: -c * 3000, y: -s * 3000 }, { craterRadius: 30 });
    e.hull.val -= 1500;
  }
  stepWorld([e], Math.round(0.5 / dt), dt);
  if (cut) {
    const tx = e.x - c * 700, ty = e.y - s * 700;
    HullBodies.cutSegment(e, tx - s * 900, ty + c * 900, tx + s * 900, ty - c * 900, 22);
    stepWorld([e], Math.round(0.5 / dt), dt);
  }
  for (const w of window.wrecks) w.x += 50000;
  stepWorld([e], 2, dt);
  return e;
}

// Rig do skutku (wszystkie drony w doku po pracy) albo do limitu czasu.
function runRig(e, rig, dt, maxSec = 240) {
  let t = 0;
  while (t < maxSec) {
    stepWorld([e], 1, dt, [rig]);
    t += dt;
    if (!rig.launched && t > 0.5) break;
  }
  return t;
}

test('dane: drony wg kadłuba, materiał w kolejności złom → stal → płyta, ¼ Atlasa z pełnej ładowni stali', () => {
  assert.equal(repairDroneCountFor('atlas'), 8);
  assert.equal(repairDroneCountFor('battleship'), 6);
  assert.equal(repairDroneCountFor('destroyer'), 4);
  assert.equal(repairDroneCountFor('frigate'), 2);
  assert.equal(repairDroneCountFor('nieznany', 1800), 8);
  assert.equal(repairDroneCountFor('nieznany', 80), 0);
  assert.deepEqual(REPAIR_MATERIALS, ['scrap', 'steel', 'hull_plate']);
  assert.equal(repairMaterialCells({ scrap: 2, steel: 1, hull_plate: 1, iron_ore: 50 }), 2 * 15 + 40 + 200);
  const e = makeBeamShip(HullBodies, 'atlas');
  const quarter = repairMaterialCells({ steel: 20 }) / e.beamHull.baseNodes;
  assert.ok(quarter > 0.2 && quarter < 0.32, `pełna ładownia stali = ${(quarter * 100).toFixed(0)}% Atlasa`);
  assert.ok(repairMaterialCells(REPAIR_START_CARGO) >= 400, 'zapas startowy kampanii');
  release(e);
});

test('repairNeeds: nietknięty kadłub bez potrzeb; po kraterach — wgniecenia, w tym blokujące front odrostu', () => {
  const clean = makeBeamShip(HullBodies, 'atlas');
  const out = [];
  assert.equal(HullBodies.repairNeeds(clean, out), 0);
  release(clean);
  const e = damagedAtlas({ cut: false });
  const n = HullBodies.repairNeeds(e, out);
  let dent = 0, blocking = 0;
  for (let k = 0; k < out.length; k += 3) {
    if (out[k + 2] & REPAIR_NEED.DENT) dent++;
    if (out[k + 2] & REPAIR_NEED.BLOCKING) blocking++;
  }
  assert.ok(n > 0 && dent > 0 && blocking > 0, `potrzeby ${n}, wgniecenia ${dent}, blokujące ${blocking}`);
  release(e);
});

test('straightenAt: prostuje tylko kwadrat ±r komórek, zbiega i otwiera front odrostu; HP łaty do sufitu', () => {
  const e = damagedAtlas({ cut: false, angVel: 0, vx: 0, vy: 0 });
  const body = e.beamHull.body, s = body.nodeStore;
  const out = [];
  HullBodies.repairNeeds(e, out);
  let k0 = -1;
  for (let k = 0; k < out.length; k += 3) if (out[k + 2] & REPAIR_NEED.BLOCKING) { k0 = k; break; }
  assert.ok(k0 >= 0);
  const cx = out[k0], cy = out[k0 + 1], R = 2;
  // Węzły poza kwadratem: pozycje przed.
  const before = new Float64Array(s.count * 2);
  for (let i = 0; i < s.count; i++) { before[i * 2] = s.x[i]; before[i * 2 + 1] = s.y[i]; }
  let steps = 0, r;
  do { r = HullBodies.straightenAt(e, cx, cy, { radius: R, dt: 1 / 120 }); steps++; } while (r.changed && steps < 2000);
  assert.ok(!r.changed, `zbiegło w ${steps} krokach`);
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const inside = Math.abs(s.ix[i] - cx) <= R && Math.abs(s.iy[i] - cy) <= R;
    if (inside) continue;
    assert.equal(s.x[i], before[i * 2], `węzeł poza kwadratem nieruszony (${s.ix[i]}, ${s.iy[i]})`);
    assert.equal(s.y[i], before[i * 2 + 1]);
  }
  // HP: łata nie ponad patchHpMul · maks.
  const i = D_lattice(body, cx, cy);
  s.patch[i] = 1;
  s.hp[i] = 1;
  for (let k = 0; k < 600; k++) HullBodies.straightenAt(e, cx, cy, { radius: R, dt: 1 / 120, patchHpMul: 0.85 });
  assert.ok(Math.abs(s.hp[i] - 0.85 * s.maxHp[i]) < 1e-6, `HP łaty ${s.hp[i]} / ${s.maxHp[i]}`);
  release(e);
});

function D_lattice(body, ix, iy) {
  return HullBodies.engine._latticeIndex(body).cells[ix + iy * body.dims.x];
}

test('rig: kolejność pracy — najpierw klasa 0 (wgniecenia przy dziurze, front odrostu), drony rozstawione', () => {
  const e = damagedAtlas();
  const rig = new RepairRig({ carrier: e, cargo: { steel: 20 }, drones: 8 });
  assert.equal(rig.launch(), true);
  stepWorld([e], 120, 1 / 120, [rig]);
  const out = [];
  HullBodies.repairNeeds(e, out);
  const blocking = new Set();
  for (let k = 0; k < out.length; k += 3) if (out[k + 2] & REPAIR_NEED.BLOCKING) blocking.add(out[k] + out[k + 1] * 1000);
  let class0 = 0, jobs = 0;
  for (const d of rig.drones) {
    if (d.job === REPAIR_JOB.NONE) continue;
    jobs++;
    if (d.job === REPAIR_JOB.REGROW) class0++;
    else if (d.job === REPAIR_JOB.STRAIGHTEN && (blocking.has(d.jobIx + d.jobIy * 1000) || HullBodies.canRegrow(e, d.jobIx, d.jobIy) === false)) class0++;
  }
  assert.ok(jobs >= 6, `drony z zadaniami: ${jobs}`);
  assert.ok(class0 >= jobs - 2, `klasa 0: ${class0} z ${jobs}`);
  // Prace różnych dronów nie na jednej komórce.
  const keys = rig.drones.filter((d) => d.job !== REPAIR_JOB.NONE).map((d) => d.jobKey);
  assert.equal(new Set(keys).size, keys.length);
  release(e);
});

test('hak odrostu: przyrost punktów × wartość węzła (regrowCell hpMul → onRegrow → raiseHullHpForRegrowth)', () => {
  const calls = [];
  const prev = HullBodies.onRegrow;
  HullBodies.onRegrow = (ent, a, b, worth) => { calls.push(worth); return raiseHullHpForRegrowth(ent, a, b, worth); };
  try {
    const e = damagedAtlas({ cut: false, angVel: 0, vx: 0, vy: 0 });
    const front = [];
    HullBodies.regrowCandidates(e, front);
    assert.ok(front.length >= 4);
    // Ten sam przyrost sufitu: łata (0,85) daje 0,85 przyrostu pełnego węzła.
    e.hull.val = 1000;
    assert.ok(HullBodies.regrowCell(e, front[0], front[1], { hpMul: 1 }));
    const full = e.hull.val - 1000;
    e.hull.val = 1000;
    assert.ok(HullBodies.regrowCell(e, front[2], front[3], { hpMul: 0.85, patch: true }));
    const patch = e.hull.val - 1000;
    assert.deepEqual(calls, [1, 0.85]);
    assert.ok(full > 0 && Math.abs(patch / full - 0.85) < 0.01, `łata ${patch} / pełny ${full}`);
    // Bez wartości (dawni wołający) — pełny przyrost.
    const pts = { hull: { val: 100, max: 1000 } };
    assert.ok(Math.abs(raiseHullHpForRegrowth(pts, 0.5, 0.6) - 1000 * (Math.pow(0.6, 2.35) - Math.pow(0.5, 2.35))) < 1e-9);
    release(e);
  } finally {
    HullBodies.onRegrow = prev;
  }
});

test('rig: pełna naprawa — udział węzłów 1, łaty słabsze i oznaczone, materiał z ładowni złom → stal, punkty wracają', () => {
  const e = damagedAtlas();
  const cargo = { scrap: 4, steel: 10, hull_plate: 1 };
  const rig = new RepairRig({ carrier: e, cargo, drones: 8 });
  const dead = e.beamHull.baseNodes - e.beamHull.body.activeNodes;
  const val0 = e.hull.val;
  rig.launch();
  runRig(e, rig, 1 / 120);
  const st = HullBodies.structuralState(e);
  assert.equal(st.ratio, 1, 'konstrukcja cała');
  assert.equal(rig.stats.cellsRegrown, dead);
  assert.equal(HullBodies.patchedCount(e), dead);
  // Materiał: najpierw cały złom (4 × 15 = 60), potem stal; zachowanie komórek (zużyte jednostki − zapas rigu).
  assert.equal(cargo.scrap ?? 0, 0, 'złom pierwszy');
  const used = rig.stats.used;
  assert.equal(used.scrap, 4);
  assert.equal(used.hull_plate || 0, 0, 'płyta nietknięta, gdy wystarczy stali');
  const cells = used.scrap * 15 + used.steel * 40 - Math.floor(rig.material);
  assert.equal(cells, dead, 'komórki z jednostek = odbudowane komórki');
  // Łata: HP = patchHpMul · maks.
  const s = e.beamHull.body.nodeStore;
  for (let i = 0; i < s.count; i++) {
    if (!s.patch[i]) continue;
    assert.ok(Math.abs(s.hp[i] - REPAIR_TUNE.patchHpMul * s.maxHp[i]) < 1e-6);
  }
  // Punkty: dokładnie do celu — łata warta patchHpMul węzła (hak odrostu × wartość łaty + praca rigu), nie do maks.
  const target = e.hull.max * (1 - (1 - REPAIR_TUNE.patchHpMul) * dead / e.beamHull.baseNodes);
  assert.ok(e.hull.val > val0 + 3000, `punkty ${val0} → ${e.hull.val}`);
  assert.ok(Math.abs(e.hull.val - target) < e.hull.max * 0.002, `punkty ${e.hull.val.toFixed(1)} ≈ cel ${target.toFixed(1)}`);
  assert.ok(e.hull.val < e.hull.max - 1, 'łaty: nie pełne punkty przed remontem');
  // Drony w doku, komunikat końca.
  assert.ok(rig.drones.every((d) => d.state === DRONE_STATE.DOCKED));
  assert.ok(rig.messages.some((m) => m.kind === REPAIR_MSG.DONE));
  // Remont w doku: łaty wymienione, pełne HP węzłów.
  HullBodies.restoreHull(e);
  assert.equal(HullBodies.patchedCount(e), 0);
  for (let i = 0; i < s.count; i++) if (s.active[i]) assert.equal(s.hp[i], s.maxHp[i]);
  release(e);
});

test('rig: koniec materiału — komunikat, drony wracają, reszta dziur czeka', () => {
  const e = damagedAtlas();
  const cargo = { scrap: 2 };
  const rig = new RepairRig({ carrier: e, cargo, drones: 8 });
  rig.launch();
  runRig(e, rig, 1 / 120);
  assert.equal(rig.stats.cellsRegrown, 30, '2 t złomu = 30 komórek');
  assert.ok(HullBodies.structuralState(e).ratio < 1);
  assert.ok(rig.messages.some((m) => m.kind === REPAIR_MSG.NO_MATERIAL));
  assert.ok(rig.drones.every((d) => d.state === DRONE_STATE.DOCKED));
  // Ponowne R bez materiału: nie startuje, komunikat o materiale.
  assert.equal(rig.launch(), false);
  release(e);
});

test('rig: nosiciel ≠ cel — drony startują z nosiciela, materiał z JEGO ładowni, naprawiają cel', () => {
  const target = damagedAtlas();
  const tug = makeBeamShip(HullBodies, 'battleship', target.x + 2500, target.y + 600, 1.2);
  tug.hp = tug.maxHp = 12000;
  const tugCargo = { steel: 20 };
  const playerCargo = { steel: 20 };
  const rig = new RepairRig({ carrier: tug, cargo: tugCargo, drones: 6 });
  rig.setTarget(target);
  rig.launch();
  let t = 0;
  const dt = 1 / 120;
  while (t < 240) {
    stepWorld([target, tug], 1, dt, [rig]);
    t += dt;
    if (!rig.launched && t > 0.5) break;
  }
  assert.equal(HullBodies.structuralState(target).ratio, 1);
  assert.equal(playerCargo.steel, 20, 'ładownia celu nietknięta');
  assert.ok(tugCargo.steel < 20, 'materiał z ładowni nosiciela');
  assert.equal(HullBodies.patchedCount(tug), 0);
  assert.ok(rig.drones.every((d) => d.state === DRONE_STATE.DOCKED && d.frame === 1), 'drony wróciły do nosiciela');
  release(target, tug);
});

test('rig: ten sam wynik przy 120 i 60 Hz (komórki, materiał, punkty, udział)', () => {
  const run = (hz) => {
    const dt = 1 / hz;
    const e = damagedAtlas({ dt });
    const cargo = { scrap: 4, steel: 10, hull_plate: 1 };
    const rig = new RepairRig({ carrier: e, cargo, drones: 8 });
    rig.launch();
    runRig(e, rig, dt);
    const r = {
      cells: rig.stats.cellsRegrown, ratio: HullBodies.structuralState(e).ratio, val: Math.round(e.hull.val),
      cargo: JSON.stringify(cargo), material: Math.floor(rig.material), patched: HullBodies.patchedCount(e)
    };
    release(e);
    return r;
  };
  const a = run(120), b = run(60);
  assert.deepEqual(b, a);
});

test('rig: komórka zajęta przez inne ciało — dron jej nie odbudowuje, materiał wraca', () => {
  const e = damagedAtlas({ cut: false, angVel: 0, vx: 0, vy: 0 });
  let calls = 0;
  const rig = new RepairRig({
    carrier: e, cargo: { steel: 5 }, drones: 4,
    env: { cellBlocked: () => { calls++; return true; } }
  });
  rig.launch();
  stepWorld([e], 120 * 8, 1 / 120, [rig]);
  assert.ok(calls > 0, 'hak zajętego miejsca pytany');
  assert.equal(rig.stats.cellsRegrown, 0);
  // Drony w trakcie spawania niosą opłaconą płytę — w doku wraca do zapasu.
  rig.dockAll();
  assert.equal(Math.round(rig.material) + repairMaterialCells(rig.cargo), 5 * 40, 'materiał zwrócony');
  release(e);
});

test('trafienia: pocisk w drona, śmierć, wybuch, strona (ogień własnej strony przelatuje), uzupełnienie w doku', () => {
  const e = damagedAtlas({ cut: false });
  const rig = RepairSwarm.create({ carrier: e, cargo: { steel: 20 }, drones: 4, env: { friendly: () => true } });
  rig.launch();
  stepWorld([e], 120 * 2, 1 / 120, [{ step: (dt) => RepairSwarm.step(dt) }]);
  assert.ok(RepairSwarm.out > 0);
  const d = rig.drones.find((x) => x.state === DRONE_STATE.WORK || x.state === DRONE_STATE.FLY);
  assert.ok(d);
  // Ogień własnej strony (friendly = true) — bez trafienia.
  assert.equal(RepairSwarm.hitSegment(d.wx - 50, d.wy, d.wx + 50, d.wy, 2, true), null);
  // Wróg: trafienie na odcinku, obrażenia, śmierć po HP drona.
  const h = RepairSwarm.hitSegment(d.wx - 50, d.wy, d.wx + 50, d.wy, 2, false);
  assert.ok(h && h.rig === rig && rig.drones[h.index] === d);
  assert.equal(RepairSwarm.damage(h, REPAIR_TUNE.droneHp * 0.5), false);
  const h2 = RepairSwarm.hitSegment(d.wx - 50, d.wy, d.wx + 50, d.wy, 2, false);
  assert.equal(RepairSwarm.damage(h2, REPAIR_TUNE.droneHp), true);
  assert.equal(d.state, DRONE_STATE.DEAD);
  assert.ok(rig.messages.some((m) => m.kind === REPAIR_MSG.LOST));
  assert.ok(rig.fx.some((f) => f.kind === REPAIR_FX.DRONE_LOST));
  // Wybuch bez strony w środku roju.
  const live = rig.drones.filter((x) => x.state !== DRONE_STATE.DEAD && x.state !== DRONE_STATE.DOCKED);
  const c = live[0];
  const n = RepairSwarm.blast(c.wx, c.wy, 30, REPAIR_TUNE.droneHp * 3, null);
  assert.ok(n >= 1 && c.state === DRONE_STATE.DEAD);
  // Dok: zestrzelone wracają (sprawne, w doku).
  rig.dockAll();
  const missing = rig.missing();
  assert.ok(missing >= 2);
  assert.equal(rig.refill(), missing);
  assert.equal(rig.missing(), 0);
  assert.ok(rig.drones.every((x) => x.state === DRONE_STATE.DOCKED && x.hp === REPAIR_TUNE.droneHp));
  release(e);
});

test('tarcza: dron pod działającą tarczą (hak RepairSwarm.shielded) bez trafień; shieldProtects = false i zgaszona tarcza — z trafieniami', () => {
  const e = damagedAtlas({ cut: false });
  const rig = RepairSwarm.create({ carrier: e, cargo: { steel: 20 }, drones: 4, env: { friendly: () => true } });
  rig.launch();
  stepWorld([e], 120 * 2, 1 / 120, [{ step: (dt) => RepairSwarm.step(dt) }]);
  const d = rig.drones.find((x) => x.state === DRONE_STATE.WORK || x.state === DRONE_STATE.FLY);
  assert.ok(d);
  // Tarcza gry = obrys z postępem aktywacji i przebiciem pola (index.html: repairDroneShielded); tu — koło 2000 j.
  let up = true;
  RepairSwarm.shielded = (ent, x, y) => up && ent === e && Math.hypot(x - e.x, y - e.y) < 2000;
  assert.equal(RepairSwarm.hitSegment(d.wx - 50, d.wy, d.wx + 50, d.wy, 2, false), null);
  assert.equal(RepairSwarm.blast(d.wx, d.wy, 30, REPAIR_TUNE.droneHp * 3, null), 0);
  assert.notEqual(d.state, DRONE_STATE.DEAD);
  // A/B strojenia: tarcza nie chroni.
  REPAIR_TUNE.shieldProtects = false;
  try {
    assert.ok(RepairSwarm.hitSegment(d.wx - 50, d.wy, d.wx + 50, d.wy, 2, false));
  } finally {
    REPAIR_TUNE.shieldProtects = true;
  }
  // Tarcza zgaszona — wybuch zabija.
  up = false;
  assert.ok(RepairSwarm.blast(d.wx, d.wy, 30, REPAIR_TUNE.droneHp * 3, null) >= 1);
  assert.equal(d.state, DRONE_STATE.DEAD);
  // Kod gry: hak tarczy dla wszystkich rigów (obrys blokującej tarczy, przebicie pola).
  const html = readIndexHtml();
  assert.match(html, /RepairSwarm\.shielded = repairDroneShielded;/);
  assert.match(html, /function repairDroneShielded\(e, x, y\) \{[\s\S]{0,600}getEntityShieldBlockingProgress\(e\)[\s\S]{0,400}isShieldBreachedAt\(e, x, y\)/);
  release(e);
});

test('R drugi raz: drony wracają do doku, rig nieaktywny; dockAll — od razu', () => {
  const e = damagedAtlas();
  const rig = new RepairRig({ carrier: e, cargo: { steel: 20 }, drones: 8 });
  rig.toggle();
  stepWorld([e], 240, 1 / 120, [rig]);
  assert.ok(rig.launched && rig.out > 0);
  rig.toggle();
  stepWorld([e], 120 * 6, 1 / 120, [rig]);
  assert.equal(rig.launched, false);
  assert.ok(rig.drones.every((d) => d.state === DRONE_STATE.DOCKED));
  rig.launch();
  stepWorld([e], 120, 1 / 120, [rig]);
  rig.dockAll();
  assert.equal(rig.launched, false);
  assert.equal(rig.out, 0);
  release(e);
});

test('gniazda: zadanie gniazda z gry (env.sockets) kończy się restoreSocket; index.html montuje broń tylko z inwentarza', () => {
  const e = damagedAtlas({ cut: false, angVel: 0, vx: 0, vy: 0 });
  const restored = [];
  const rig = new RepairRig({
    carrier: e, cargo: {}, drones: 2,
    env: {
      sockets: (target, out) => { if (!restored.length) out.push({ key: 3, x: e.x + 100, y: e.y }); return out.length; },
      restoreSocket: (target, key) => { restored.push(key); return true; }
    }
  });
  rig.launch();
  stepWorld([e], 120 * 15, 1 / 120, [rig]);
  assert.deepEqual(restored, [3]);
  assert.equal(rig.stats.sockets, 1);
  release(e);

  // index.html: markHardpointDestroyed pamięta broń, restorePlayerRepairSocket montuje ją tylko z inwentarza.
  const src = readIndexHtml();
  const inv = new Map([['railgun_mk2', 1]]);
  const inventory = {
    has: (id) => (inv.get(id) || 0) > 0,
    take: (id) => { const n = inv.get(id) || 0; if (n <= 0) return false; inv.set(id, n - 1); return true; },
    give: (id) => inv.set(id, (inv.get(id) || 0) + 1)
  };
  const ship = { name: 'atlas' };
  const hps = [
    { id: 'a', type: 'main', mount: 'railgun_mk2', ammo: null },
    { id: 'b', type: 'main', mount: 'railgun_mk2', ammo: null }
  ];
  const WEAPONS = { railgun_mk2: { id: 'railgun_mk2', name: 'Railgun Mk2', mountType: 'main' } };
  const HP = { MAIN: 'main', HANGAR: 'hangar', SPECIAL_MISSILE: 'special_missile' };
  const messages = [];
  const scope = {
    ship, Game: { player: { hardpoints: hps, inventory } }, WEAPONS, HP,
    isHardpointHexSupported: () => true, syncWeaponSystems: () => {}, renderMechanic: undefined,
    pushZoneMessage: (t) => messages.push(t), applyDamageToPlayer: () => {}, applyDamageToNPC: () => {},
    computeHardpointHullDamage: () => 0, isHangarSquadronWeapon: () => false, setHardpointHangarSquadrons: () => {}
  };
  // setHardpointMount (nagłówek z `{}` — helper go nie wytnie): montaż zdejmuje sztukę z inwentarza, typ gniazda zgodny.
  scope.setHardpointMount = (hp, id) => {
    const w = WEAPONS[id];
    if (!w || w.mountType !== hp.type || hp.destroyed) return;
    if (!inventory.take(id)) return;
    hp.mount = id;
  };
  const markDestroyed = loadIndexFunction(src, 'function markHardpointDestroyed(entity, hp, hardpointCount) {', 'markHardpointDestroyed', scope);
  const restore = loadIndexFunction(src, 'function restorePlayerRepairSocket(target, key) {', 'restorePlayerRepairSocket', scope);
  markDestroyed(ship, hps[0], 2);
  markDestroyed(ship, hps[1], 2);
  assert.equal(hps[0].mount, null);
  assert.equal(hps[0].__lostMount, 'railgun_mk2');
  assert.equal(restore(ship, 0), true);
  assert.equal(hps[0].destroyed, false);
  assert.equal(hps[0].mount, 'railgun_mk2', 'broń z inwentarza zamontowana');
  assert.equal(inv.get('railgun_mk2'), 0, 'sztuka zdjęta z inwentarza');
  assert.equal(restore(ship, 1), true);
  assert.equal(hps[1].destroyed, false, 'gniazdo wraca');
  assert.equal(hps[1].mount, null, 'bez sztuki w inwentarzu broń nie wraca');
  assert.equal(restore(ship, 1), false, 'gniazdo już całe');
});

test('obraz: łata w skórze (kod jasności narożnika), stempel łaty czyści ranę, poza części drona (lustro CPU)', () => {
  const e = damagedAtlas({ cut: false, angVel: 0, vx: 0, vy: 0 });
  const rig = new RepairRig({ carrier: e, cargo: { steel: 20 }, drones: 8 });
  rig.launch();
  runRig(e, rig, 1 / 120);
  const body = e.beamHull.body;
  const topo = buildHullSkinTopology(body);
  const n = topo.count;
  const pos = new Float32Array(n * 12), shade = new Float32Array(n * 4), heat = new Float32Array(n * 8), tear = new Float32Array(n * 4);
  writeHullSkin(body, topo, pos, shade, heat, tear);
  const s = body.nodeStore;
  let patchQuads = 0, seamCorners = 0;
  for (let i = 0; i < n; i++) {
    if (!s.active[i]) continue;
    for (let k = 0; k < 4; k++) {
      const v = shade[i * 4 + k];
      if (s.patch[i]) {
        assert.ok(v >= HULL_PATCH_SHADE && v <= HULL_PATCH_SHADE + 1, `kod łaty ${v}`);
        if (v > HULL_PATCH_SHADE + 0.5) seamCorners++;
      } else {
        assert.ok(v <= 1, `zwykła blacha ${v}`);
      }
    }
    if (s.patch[i]) patchQuads++;
  }
  assert.ok(patchQuads > 0 && seamCorners > 0, `łaty ${patchQuads}, narożniki spawu ${seamCorners}`);
  release(e);

  // Stempel łaty (D.y > 0): kwadrat czyści ranę, żar spawu przy krawędzi, poza kwadratem nic.
  const T = () => ({ heat: 3, ion: 1, scorch: 0.8, rim: 0.7, cut: 0.4, crater: 1 });
  const A = [0.5, 0.5, 0.02, 0], B = [0, 0, 0, 0], C = [1, 0, 1, 0], D = [0, 0.02, 1.6, 0];
  const mid = damageStampCpu(T(), A, B, C, 0.5, 0.5, 1, D, 256);
  assert.deepEqual([mid.scorch, mid.rim, mid.cut, mid.crater, mid.ion], [0, 0, 0, 0, 0]);
  assert.equal(mid.heat, 0, 'środek łaty zimny');
  const edge = damageStampCpu(T(), A, B, C, 0.5 + 0.0198, 0.5, 1, D, 256);
  assert.ok(edge.heat > 0.5, `spaw przy krawędzi ${edge.heat}`);
  const out = damageStampCpu(T(), A, B, C, 0.5 + 0.03, 0.5, 1, D, 256);
  assert.deepEqual(out, T(), 'poza kwadratem bez zmian');

  // Model drona: części, płyta opada z ramionami, bez płyty — zwinięta.
  const a = buildRepairDroneArrays();
  const parts = new Set();
  for (let i = 0; i < a.vertexCount; i++) parts.add(a.part[i * 2]);
  assert.deepEqual([...parts].sort(), [0, 1, 2, 3]);
  const rec = new Float32Array(16);
  rec[4] = 1;
  const v = [REPAIR_DRONE_DIMS.plateX + 2, 1, REPAIR_DRONE_DIMS.plateZ];
  const o = { x: 0, y: 0, z: 0 };
  rec[6] = 1; rec[5] = 0;
  repairDroneVertexCpu(rec, 0, REPAIR_DRONE_PART.PLATE, v, o);
  const carry = o.z;
  rec[5] = 1;
  repairDroneVertexCpu(rec, 0, REPAIR_DRONE_PART.PLATE, v, o);
  assert.ok(Math.abs(carry - o.z - REPAIR_DRONE_DIMS.plateDrop) < 1e-6, 'płyta opuszczona przy spawaniu');
  rec[6] = 0;
  repairDroneVertexCpu(rec, 0, REPAIR_DRONE_PART.PLATE, v, o);
  assert.ok(Math.abs(o.x - REPAIR_DRONE_DIMS.plateX) < 1e-6 && Math.abs(o.y) < 1e-6, 'bez płyty — punkt');
});

test('stała rig ↔ obraz: środek płyty przed dronem = REPAIR_TUNE.plateForward', () => {
  assert.equal(REPAIR_DRONE_DIMS.plateX, REPAIR_TUNE.plateForward);
  assert.ok(HULL_BODY_CONFIG.straightenRate > 0 && HULL_BODY_CONFIG.dentStrain > 0);
});
