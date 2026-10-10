import test from 'node:test';
import assert from 'node:assert/strict';

// Kierowanie ogniem gracza (src/game/fireControl.js), celność wież (src/game/weaponAim.js) i szarża
// (src/game/flight/ramBurn.js) — docs/BRIEF-kierowanie-ogniem.md.
globalThis.window = globalThis.window || {};
const { getLeadAim } = await import('../src/ai/aiUtils.js');
const {
  getMountedWeaponAim, mountedWeaponBase, stepMountedWeaponAim, turretDriveFor, TURRET_TRAVERSE,
  mountFireArc, bearingInArc, MOUNT_ARCS
} = await import('../src/game/weaponAim.js');
const {
  FC_TUNE, createFireControl, fcResolveInHand, fcSetInHand, fcToggleAuto, fcCyclePosture,
  fcAimTolerance, fcHitFactor, fcPickTarget, fcPickNearPoint, stepFireControl,
  fcPlanMissileSalvo, fcMissileRole, fcMissileDamage, fcSalvoSize
} = await import('../src/game/fireControl.js');
const { chargeTimeOf } = await import('../src/game/weaponCharge.js');
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const {
  createRamBurn, canStartRamBurn, startRamBurn, stopRamBurn, stepRamBurn, RAM_BURN_END, RAM_BURN_READY
} = await import('../src/game/flight/ramBurn.js');
const { SHIP_SYSTEMS, HULL_SHIP_SYSTEMS, shipSystemFor } = await import('../src/data/shipSystems.js');

const DT = 1 / 120;

// ---------------------------------------------------------------------------
// Wieże: człon prędkości i obrót wg rozmiaru

// Pudło pocisku wystrzelonego wzdłuż lufy do celu lecącego w poprzek (jak fireWeaponCore gracza).
function crossingMiss(drive, { range, targetSpeed, shooterSpeed = 0, projSpeed = 8000 }) {
  const state = { angle: Math.PI / 2, previousAngle: Math.PI / 2, angVel: 0, aimErr: 0, prevDesired: null };
  const rel = targetSpeed - shooterSpeed;
  const shooterVel = { x: shooterSpeed, y: 0 };
  const base = { x: 0, y: 0 };
  const target = { x: -rel * 4, y: range, vx: targetSpeed, vy: 0 };
  const lead = { x: 0, y: 0 };
  for (let i = 0; i < 4 / DT; i++) {
    getLeadAim(base, target, projSpeed, lead, shooterVel);
    stepMountedWeaponAim(state, base, lead, DT, drive);
    base.x += shooterVel.x * DT;
    target.x += target.vx * DT;
  }
  const bvx = Math.cos(state.angle) * projSpeed + shooterVel.x;
  const bvy = Math.sin(state.angle) * projSpeed + shooterVel.y;
  const t = (target.y - base.y) / bvy;
  return Math.abs((base.x + bvx * t) - (target.x + target.vx * t));
}

test('wieża z członem prędkości trafia cel lecący w poprzek (dawniej pudło = v / 6,3 niezależnie od zasięgu)', () => {
  const drive = TURRET_TRAVERSE.M;
  for (const range of [3000, 6000, 10000]) {
    const miss = crossingMiss(drive, { range, targetSpeed: 1400 });
    assert.ok(miss < 5, `fregata 1400 j/s, zasięg ${range}: pudło ${miss.toFixed(1)} j. (dawniej 220)`);
  }
  assert.ok(crossingMiss(drive, { range: 4000, targetSpeed: 0, shooterSpeed: 500 }) < 5, 'własny ruch okrętu nie psuje celności');
  assert.ok(crossingMiss(TURRET_TRAVERSE.S, { range: 2500, targetSpeed: 2800 }) < 8, 'lekka wieża nadąża za myśliwcem');
});

test('obrót wieży zależy od rozmiaru broni: ciężka bateria nie nadąża za fregatą z bliska', () => {
  assert.ok(TURRET_TRAVERSE.S.maxSpeed > TURRET_TRAVERSE.M.maxSpeed);
  assert.ok(TURRET_TRAVERSE.M.maxSpeed > TURRET_TRAVERSE.L.maxSpeed);
  assert.ok(TURRET_TRAVERSE.L.maxSpeed > TURRET_TRAVERSE.Capital.maxSpeed);
  assert.equal(turretDriveFor(MASTER_WEAPONS.special_yamato_cannon), TURRET_TRAVERSE.Capital);
  assert.equal(turretDriveFor(MASTER_WEAPONS.railgun_mk2), TURRET_TRAVERSE.M);
  const fallback = { maxSpeed: 1, maxAccel: 1, damping: 1 };
  assert.equal(turretDriveFor({ size: '?' }, fallback), fallback);
  // Walka z 1,6 km: pancernik w poprzek ~25°/s i niszczyciel ~37°/s mieszczą się w obrocie baterii
  // Capital (43°/s), fregata ~50°/s już nie.
  const deg = TURRET_TRAVERSE.Capital.maxSpeed * 180 / Math.PI;
  assert.ok(deg > 38 && deg < 49, `Capital ${deg.toFixed(0)}°/s`);
  // Yamato do fregaty 1400 j/s w poprzek z 1,6 km: lufa zostaje w tyle (duże pudło), do pancernika 650 j/s — trafia.
  const yamato = { projSpeed: 9000 };
  assert.ok(crossingMiss(TURRET_TRAVERSE.Capital, { range: 1600, targetSpeed: 1400, ...yamato }) > 60);
  assert.ok(crossingMiss(TURRET_TRAVERSE.Capital, { range: 1600, targetSpeed: 650, ...yamato }) < 5);
});

test('skok punktu celowania nie jest prędkością kątową (zmiana celu nie szarpie wieżą)', () => {
  const state = { angle: 0, previousAngle: 0, angVel: 0, aimErr: 0, prevDesired: null };
  const base = { x: 0, y: 0 };
  for (let i = 0; i < 60; i++) stepMountedWeaponAim(state, base, { x: 1000, y: 0 }, DT, TURRET_TRAVERSE.M);
  stepMountedWeaponAim(state, base, { x: -1000, y: 10 }, DT, TURRET_TRAVERSE.M);
  assert.ok(Math.abs(state.angVel) <= TURRET_TRAVERSE.M.maxAccel * DT + 1e-9, 'przyspieszenie w granicach napędu');
  stepMountedWeaponAim(state, base, { x: 5, y: 5 }, 0, TURRET_TRAVERSE.M);
  assert.equal(state.prevDesired, null, 'krok bez czasu (warp) zeruje pamięć kąta');
});

// ---------------------------------------------------------------------------
// Kierowanie ogniem

const loadout = (weaponId, x, y, id) => ({ hp: { id, pos: { x, y }, mount: weaponId }, weapon: MASTER_WEAPONS[weaponId] });
const enemy = (x, y, kind, extra = {}) => ({ x, y, vx: 0, vy: 0, radius: kind === 'battleship' ? 300 : kind === 'destroyer' ? 150 : 90, kind, hp: 2000, ...extra });

function makeScene({ main = 0, special = 0, missile = 0, mainId = 'railgun_mk2', specialId = 'special_yamato_cannon', missileIds = null } = {}) {
  const ship = { pos: { x: 0, y: 0 }, angle: 0, vel: { x: 0, y: 0 } };
  const weapons = { main: [], special: [], missile: [] };
  for (let i = 0; i < main; i++) weapons.main.push(loadout(mainId, (i - main / 2) * 100, i % 2 ? 300 : -300, `m${i}`));
  for (let i = 0; i < special; i++) weapons.special.push(loadout(specialId, -200 - i * 150, i % 2 ? 250 : -250, `s${i}`));
  for (let i = 0; i < missile; i++) {
    const lo = loadout(missileIds?.[i] || 'missile_rack', 0, 0, `r${i}`);
    lo.hp.ammo = lo.weapon.ammo;
    lo.hp.missileCd = 0;
    weapons.missile.push(lo);
  }
  // Rakiety w locie (budżet celu): cel → obrażenia; testy „lądują” je ręcznie (flying.clear()).
  const flying = new Map();
  const fc = createFireControl();
  const shots = [];
  const leadOut = { x: 0, y: 0 };
  const env = {
    dt: DT, weapons, cursor: { x: 6000, y: 0 }, cursorTarget: null, snapTarget: null,
    trigger: false, canFire: true, silent: false, silentHand: false, priority: [],
    rnd: () => 0.5,
    alive: (e) => !!e && !e.dead,
    tx: (e) => e.x, ty: (e) => e.y, tr: (e) => e.radius || 50,
    aimOf: (lo) => getMountedWeaponAim(ship, lo),
    baseOf: (lo, out) => mountedWeaponBase(ship, lo.hp, out),
    velAt: (x, y, out) => { out.x = ship.vel.x; out.y = ship.vel.y; return out; },
    lead: (base, target, speed, vel) => getLeadAim(base, target, speed, leadOut, vel),
    speedOf: (w) => w.baseSpeed,
    rangeOf: (w) => w.baseRange,
    chargeTime: chargeTimeOf,
    skip: () => false,
    outwardOf: (lo) => ship.angle + Math.atan2(lo.hp.pos.y, lo.hp.pos.x),
    aim: (lo, aim, base, point, dt) => stepMountedWeaponAim(aim, base, point, dt, turretDriveFor(lo.weapon)),
    blocked: () => false,
    fireMain: (i, lo, target, barrel, auto) => { shots.push({ group: 'main', i, target, barrel, auto }); return lo.weapon.cooldown; },
    fireSpecial: (i, lo, auto) => { shots.push({ group: 'special', i, target: getMountedWeaponAim(ship, lo).target, auto }); lo.hp.specialCd = lo.weapon.cooldown; },
    chargeSpecial: (i, lo, manual) => { shots.push({ group: 'charge', i, manual }); },
    fireMissile: (target) => { shots.push({ group: 'missile', target }); return true; },
    missileReady: (lo) => lo.hp.ammo > 0 && !(lo.hp.missileCd > 0),
    missileIncoming: (out) => { out.clear(); for (const [k, v] of flying) out.set(k, v); return out; },
    fireMissileSalvo: (lo, targets, count) => {
      const list = targets.slice(0, count);
      const per = fcMissileDamage(lo.weapon);
      for (const t of list) flying.set(t, (flying.get(t) || 0) + per);
      shots.push({ group: 'salvo', lo, targets: list, target: list[0] });
      lo.hp.ammo--;
      lo.hp.missileCd = lo.weapon.cooldown;
      return true;
    }
  };
  const setCandidates = (list, priority = []) => {
    env.priority = priority;
    fc.candidates = list.map((e) => ({ e, kind: e.kind, need: e.hp, needMax: e.hp, threat: e.threat || 0, prio: priority.indexOf(e) }));
    fc.candidateCount = list.length;
  };
  const run = (seconds) => {
    for (let i = 0; i < seconds / DT; i++) {
      for (const lo of weapons.special) lo.hp.specialCd = Math.max(0, (lo.hp.specialCd || 0) - DT);
      for (const lo of weapons.missile) lo.hp.missileCd = Math.max(0, (lo.hp.missileCd || 0) - DT);
      stepFireControl(fc, env);
    }
  };
  return { ship, weapons, fc, env, shots, setCandidates, run, flying };
}

test('grupa w ręku: domyślnie special, bez niej main; auto i postawa przełączane', () => {
  const fc = createFireControl();
  const one = { hp: {}, weapon: {} };
  assert.equal(fcResolveInHand(fc, { main: [one], special: [one] }), 'special');
  assert.equal(fcResolveInHand(fc, { main: [one], special: [] }), 'main', 'kadłub bez broni specjalnej strzela działami');
  assert.equal(fcResolveInHand(fc, { main: [], special: [], missile: [] }), null);
  assert.equal(fcSetInHand(fc, 'main', { main: [one] }), true);
  assert.equal(fcSetInHand(fc, 'missile', { missile: [] }), false, 'pustej grupy nie da się wziąć w rękę');
  assert.equal(fc.inHand, 'main');
  assert.equal(fcToggleAuto(fc, 'special'), false);
  assert.equal(fcToggleAuto(fc, 'special'), true);
  assert.deepEqual([fcCyclePosture(fc), fcCyclePosture(fc), fcCyclePosture(fc)], ['focus', 'hold', 'free']);
});

test('szansa trafienia: wolny pocisk nie goni zwinnego celu z daleka, szybki — tak', () => {
  const armata = MASTER_WEAPONS.armata_mk1;
  const rail = MASTER_WEAPONS.railgun_mk2;
  assert.ok(fcHitFactor(armata, 5000, 90, 'frigate') < 0.05, 'armata 2500 j/s do fregaty 5 km dalej');
  assert.ok(fcHitFactor(armata, 5000, 300, 'battleship') > 0.4, 'ta sama armata do pancernika');
  assert.ok(fcHitFactor(rail, 5000, 90, 'frigate') > 0.5, 'railgun 8000 j/s do fregaty');
  assert.equal(fcHitFactor(MASTER_WEAPONS.beam_pulse, 5000, 90, 'frigate'), 1, 'wiązka trafia od razu');
  assert.equal(fcHitFactor(armata, 5000, 300, 'station'), 1, 'cel nieruchomy');
  assert.ok(fcAimTolerance(1000, 300) > fcAimTolerance(8000, 300));
  assert.equal(fcAimTolerance(100000, 20), FC_TUNE.aimTolMin);
});

test('wieże na auto: ogień skupiony na jednym celu, aż padnie; strzał przy wycelowanej lufie, bez wspólnego przeładowania', () => {
  const s = makeScene({ main: 8, missile: 1 });
  s.fc.inHand = 'missile'; // w ręku rakiety — działa na auto
  // Okręt otoczony: fregata z prawej burty (+y), fregata z lewej (−y). Osiem dział (~200 pkt/s) nie zabija
  // fregaty 2000 pkt w 2 s, więc cała bateria bije jedną — rozproszony ogień nic by nie zabił (pomiar w grze).
  const a = enemy(800, 3000, 'frigate');
  const b = enemy(-500, -2800, 'frigate');
  s.setCandidates([a, b]);
  s.run(3);
  const main = s.shots.filter((x) => x.group === 'main');
  const hit = new Set(main.map((x) => x.target));
  assert.equal(hit.size, 1, 'jeden cel naraz');
  const focus = main[0].target;
  assert.ok(s.shots.every((x) => x.auto === true));
  assert.ok(s.shots.length > 20, `ogień ciągły: ${s.shots.length} strzałów w 3 s`);
  assert.equal(s.fc.stats.autoTotal, 8);
  assert.equal(s.fc.stats.autoEngaged, 8);
  assert.equal(s.fc.stats.targets, 1);
  focus.dead = true;
  s.shots.length = 0;
  s.run(3);
  const next = s.shots.filter((x) => x.group === 'main' && x.target);
  assert.ok(next.length > 10 && next.every((x) => x.target === (focus === a ? b : a)), 'po zabiciu — następny cel');
  focus.dead = false;
  // Słabe cele (myśliwce): gdy przydzielony ogień wystarcza z nawiązką, kolejne wieże biorą następny cel.
  const swarm = [0, 1, 2, 3].map((k) => enemy(600 + k * 60, 700, 'fighter', { radius: 12, hp: 100 }));
  s.setCandidates(swarm);
  s.shots.length = 0;
  s.run(1.5);
  assert.ok(new Set(s.shots.map((x) => x.target)).size >= 3, 'myśliwce: ogień rozłożony, bez nadmiaru na jednym');
  // Lufy salwy dwulufowej idą po kolei (0, 1), a każda wieża ma własne przeładowanie.
  const first = s.shots.filter((x) => x.i === 0).slice(0, 2).map((x) => x.barrel);
  assert.deepEqual(first.sort(), [0, 1]);
});

test('cel priorytetowy bierze ogień wszystkich wież, które go sięgają; po jego śmierci wieże wracają do reszty', () => {
  const s = makeScene({ main: 6, missile: 1 });
  s.fc.inHand = 'missile';
  s.fc.auto.missile = false;
  const near = enemy(2000, 0, 'frigate');
  // Dalej niż fregata, ale w zasięgu railguna Mk II (4,5 km od 2026-10-07).
  const focus = enemy(-3500, 1500, 'battleship', { hp: 19000 });
  s.setCandidates([focus, near], [focus]);
  s.run(2.5);
  const targets = s.shots.map((x) => x.target);
  assert.ok(targets.length > 10);
  assert.ok(targets.every((t) => t === focus), 'cały ogień w cel priorytetowy, mimo bliższej fregaty');
  focus.dead = true;
  s.shots.length = 0;
  s.setCandidates([focus, near], []);
  s.run(2.5);
  assert.ok(s.shots.length > 5 && s.shots.every((x) => x.target === near), 'po zabiciu celu ogień nie gaśnie — idzie w następny');
});

test('postawa „tylko cel” i „wstrzymać”, cisza pod maskowaniem, linia ognia z sojusznikiem', () => {
  const s = makeScene({ main: 4, missile: 1 });
  s.fc.inHand = 'missile';
  const a = enemy(3000, 0, 'frigate');
  s.setCandidates([a]);
  s.fc.posture = 'focus';
  s.run(1.5);
  assert.equal(s.shots.length, 0, 'bez celu priorytetowego wieże milczą');
  s.fc.posture = 'hold';
  s.setCandidates([a], [a]);
  s.run(1.5);
  assert.equal(s.shots.length, 0, 'wstrzymać ogień');
  s.fc.posture = 'free';
  s.env.silent = true;
  s.run(1.5);
  assert.equal(s.shots.length, 0, 'maskowanie: cisza');
  s.env.silent = false;
  s.env.blocked = () => true;
  s.run(1.5);
  assert.equal(s.shots.length, 0, 'sojusznik na linii ognia');
  s.env.blocked = () => false;
  s.env.canFire = false;
  s.run(1.5);
  assert.equal(s.shots.length, 0, 'skok / panel stacji');
  s.env.canFire = true;
  s.run(1.5);
  assert.ok(s.shots.length > 0);
});

test('grupa w ręku: celuje w kursor, strzela tylko przy trzymanym spuście i wycelowanej lufie', () => {
  const s = makeScene({ main: 4, special: 2 });
  const a = enemy(0, 4000, 'destroyer');
  s.setCandidates([a]);
  s.env.cursor.x = 7000; s.env.cursor.y = 0;
  s.run(2);
  assert.ok(s.shots.every((x) => x.group === 'main'), 'bateria w ręku nie strzela sama, działa burtowe — tak');
  assert.equal(s.fc.stats.handTotal, 2);
  assert.equal(s.fc.stats.handAligned, 2, 'obie wieże baterii doszły do kursora');
  s.shots.length = 0;
  s.env.trigger = true;
  s.run(0.2);
  const special = s.shots.filter((x) => x.group === 'special');
  assert.equal(special.length, 2, 'salwa z obu wież baterii');
  assert.ok(special.every((x) => x.auto === false && x.target === null));
  // Kursor skacze za rufę: ciężka wieża (43°/s) nie zdąży — nie strzela, dopóki lufa nie dojedzie.
  for (const lo of s.weapons.special) lo.hp.specialCd = 0;
  s.shots.length = 0;
  s.env.cursor.x = -7000;
  s.run(0.5);
  assert.equal(s.shots.filter((x) => x.group === 'special').length, 0);
  assert.equal(s.fc.stats.handAligned, 0);
  s.run(5);
  assert.ok(s.shots.filter((x) => x.group === 'special').length >= 2, 'po obrocie wieży salwa');
});

test('wyprzedzenie przy kursorze: bateria w ręku trafia w punkt wskazany na kadłubie lecącego celu', () => {
  const s = makeScene({ special: 1 });
  const target = enemy(0, 6000, 'battleship', { vx: 600, vy: 0 });
  s.setCandidates([target]);
  s.env.snapTarget = target;
  s.env.cursorTarget = target;
  // Kursor 100 j. przed dziobem środka celu; cel i kursor jadą razem.
  for (let i = 0; i < 3 / DT; i++) {
    target.x += target.vx * DT;
    s.env.cursor.x = target.x + 100;
    s.env.cursor.y = target.y;
    stepFireControl(s.fc, s.env);
  }
  const lo = s.weapons.special[0];
  const aim = getMountedWeaponAim(s.ship, lo);
  const base = mountedWeaponBase(s.ship, lo.hp, { x: 0, y: 0 });
  const speed = lo.weapon.baseSpeed;
  const t = (target.y - base.y) / (Math.sin(aim.angle) * speed);
  const shellX = base.x + Math.cos(aim.angle) * speed * t;
  assert.ok(Math.abs(shellX - (target.x + target.vx * t + 100)) < 12, 'pocisk dolatuje 100 j. przed środkiem kadłuba');
  assert.equal(aim.target, target);
});

test('broń z ładowaniem zgłasza strzał (ładuje gra); rakiety na auto: bierny cel tylko jako priorytetowy, w zasięgu', () => {
  const s = makeScene({ special: 1, missile: 2, specialId: 'special_valkyrie_railgun' });
  s.fc.inHand = 'main'; // nie ma dział — w ręku wypada special
  assert.equal(fcResolveInHand(s.fc, s.weapons), 'special');
  const a = enemy(5000, 0, 'destroyer');
  const far = enemy(60000, 0, 'battleship');
  s.setCandidates([a, far]);
  s.env.cursor.x = 5000;
  s.env.trigger = true;
  s.run(1);
  assert.ok(s.shots.some((x) => x.group === 'charge' && x.manual === true));
  assert.equal(s.shots.filter((x) => x.group === 'salvo').length, 0, 'bierny wróg (bez zagrożenia) — rakiety zostają w wyrzutniach');
  s.shots.length = 0;
  s.setCandidates([a, far], [far]);
  s.run(1);
  assert.equal(s.shots.filter((x) => x.group === 'salvo').length, 0, 'cel priorytetowy poza zasięgiem rakiet');
  s.setCandidates([a, far], [far, a]);
  s.run(1);
  const rockets = s.shots.filter((x) => x.group === 'salvo');
  assert.ok(rockets.length >= 1 && rockets.every((x) => x.targets.every((t) => t === a)), 'rakiety idą w cel priorytetowy w zasięgu');
  // Rakiety w ręku: spust wysyła salwę w pierwszy cel priorytetowy.
  s.shots.length = 0;
  s.fc.inHand = 'missile';
  s.fc.auto.missile = false;
  s.run(0.5);
  assert.ok(s.shots.filter((x) => x.group === 'missile').every((x) => x.target === far));
});

test('rakiety na auto: salwa dzieli się na kilka celów wg budżetu, rakiety w locie odejmują się od potrzeb', () => {
  // Domyślny Atlas: Grad (24 × 180) + wyrzutnia pocisków manewrujących (3 × 1000).
  const s = makeScene({ main: 1, missile: 2, missileIds: ['grad_launcher', 'missile_rack'] });
  s.fc.inHand = 'main'; // w ręku działa — rakiety na auto
  const f1 = enemy(4000, 500, 'frigate', { hp: 1850, threat: 1 });
  const f2 = enemy(4200, -600, 'frigate', { hp: 1850, threat: 1 });
  const f3 = enemy(-3500, 300, 'frigate', { hp: 1850, threat: 1 });
  const dd = enemy(7000, 0, 'destroyer', { hp: 6400, threat: 1 });
  const parked = enemy(5000, 3000, 'battleship', { hp: 19200, threat: 0 });
  s.setCandidates([f1, f2, f3, dd, parked]);
  s.run(0.5);
  const salvos = s.shots.filter((x) => x.group === 'salvo');
  assert.equal(salvos.length, 2, 'obie wyrzutnie odpaliły');
  const grad = salvos.find((x) => x.lo.weapon.id === 'grad_launcher');
  const cruise = salvos.find((x) => x.lo.weapon.id === 'missile_rack');
  const gradTargets = new Set(grad.targets);
  assert.equal(grad.targets.length, 24);
  assert.ok(gradTargets.size >= 2, `Grad na kilka fregat: ${gradTargets.size}`);
  assert.ok([...gradTargets].every((t) => t.kind === 'frigate'), 'mikrorakiety w drobnicę');
  // Żaden cel nie dostaje więcej, niż potrzebuje (z zapasem na obronę punktową).
  for (const t of gradTargets) {
    const n = grad.targets.filter((x) => x === t).length;
    assert.ok(n * 180 <= t.hp * FC_TUNE.missileMargin + 180, `${n} mikrorakiet na fregatę ${t.hp}`);
  }
  assert.ok(cruise.targets.every((t) => !gradTargets.has(t)), 'manewrujące nie dokładają do celów Grada');
  assert.ok(!salvos.some((x) => x.targets.includes(parked)), 'bierny pancernik (bez zagrożenia) — bez rakiet');
  // Wszystko pokryte rakietami w locie — wyrzutnie czekają (nie marnują salw).
  s.shots.length = 0;
  for (const t of [f1, f2, f3, dd]) s.flying.set(t, t.hp * 2);
  s.run(10);
  assert.equal(s.shots.filter((x) => x.group === 'salvo').length, 0);
  // Rakiety doleciały (cele dalej żyją): po przeładowaniu salwy wracają.
  s.flying.clear();
  s.run(0.5);
  assert.equal(s.shots.filter((x) => x.group === 'salvo').length, 2);
  // Postawa „tylko cel”: wyłącznie cele priorytetowe, także bierny pancernik.
  s.shots.length = 0;
  s.flying.clear();
  s.fc.posture = 'focus';
  s.setCandidates([f1, f2, f3, dd, parked], [parked]);
  s.run(10);
  const focus = s.shots.filter((x) => x.group === 'salvo');
  assert.ok(focus.length >= 2 && focus.every((x) => x.targets.every((t) => t === parked)));
  // Wstrzymać ogień — nic.
  s.shots.length = 0;
  s.flying.clear();
  s.fc.posture = 'hold';
  s.run(10);
  assert.equal(s.shots.filter((x) => x.group === 'salvo').length, 0);
});

test('plan salwy: dobór rakiety do klasy, cel prawie pokryty nie ściąga całej salwy, reszta na największą potrzebę', () => {
  assert.equal(fcMissileRole(MASTER_WEAPONS.grad_launcher), 'light');
  assert.equal(fcMissileRole(MASTER_WEAPONS.roj_pod), 'light');
  assert.equal(fcMissileRole(MASTER_WEAPONS.fast_missile_rack), 'light');
  assert.equal(fcMissileRole(MASTER_WEAPONS.missile_rack), 'heavy');
  assert.equal(fcMissileRole(MASTER_WEAPONS.hydra_mirv), 'heavy');
  assert.equal(fcMissileDamage(MASTER_WEAPONS.hydra_mirv), 240 * 6, 'kasetowa liczy wszystkie głowice');
  assert.equal(fcSalvoSize(MASTER_WEAPONS.grad_launcher), 24);
  const s = makeScene({ missile: 1, missileIds: ['missile_rack'] });
  const lo = s.weapons.missile[0];
  const fighter = enemy(3000, 0, 'fighter', { hp: 150, threat: 1, radius: 12 });
  const bs = enemy(9000, 0, 'battleship', { hp: 19200, threat: 1 });
  s.setCandidates([fighter, bs]);
  s.fc._incoming.clear();
  assert.equal(fcPlanMissileSalvo(s.fc, lo, s.env), 3);
  assert.ok(s.fc._salvoTargets.slice(0, 3).every((t) => t === bs), 'ciężkie rakiety nie lecą w myśliwca');
  // Fregata, której brakuje ~1 rakiety: salwa trzech manewrujących (3000) czeka.
  const hurt = enemy(3000, 0, 'frigate', { hp: 600, threat: 1 });
  s.setCandidates([hurt]);
  s.fc._incoming.clear();
  assert.equal(fcPlanMissileSalvo(s.fc, lo, s.env), 0, 'dobijanie jednym strzałem salwy — zostaje działom');
  // Niszczycielowi brakuje jednej rakiety, pancernikowi — wielu: reszta salwy w pancernik.
  const d1 = enemy(4000, 0, 'destroyer', { hp: 6400, threat: 1 });
  s.setCandidates([d1, bs]);
  s.fc._incoming.clear();
  s.fc._incoming.set(d1, 6400 * FC_TUNE.missileMargin - 900);
  assert.equal(fcPlanMissileSalvo(s.fc, lo, s.env), 3);
  const plan = s.fc._salvoTargets.slice(0, 3);
  assert.equal(plan.filter((t) => t === d1).length, 1, 'niszczycielowi brakuje jednej rakiety');
  assert.equal(plan.filter((t) => t === bs).length, 2);
});

test('wybór celu: dopasowanie kalibru i chwyt kursora', () => {
  const s = makeScene({ main: 1 });
  const fighter = enemy(700, 0, 'fighter', { radius: 12, hp: 120 });
  // W zasięgu lekkiego działka (Gatling S: 1,8 km od 2026-10-07).
  const ship = enemy(1500, 700, 'battleship', { hp: 19000 });
  s.setCandidates([fighter, ship]);
  const heavy = MASTER_WEAPONS.special_yamato_cannon;
  const light = MASTER_WEAPONS.gatling_s;
  assert.equal(fcPickTarget(s.fc, heavy, 0, 0, 0, null, s.env), ship, 'ciężka bateria bierze pancernik, nie myśliwiec');
  assert.equal(fcPickTarget(s.fc, light, 0, 0, 0, null, s.env), fighter, 'lekkie działko bierze myśliwiec');
  // Cel przy kursorze dostaje premię tylko, gdy gracz strzela grupą w ręku.
  s.env.cursorTarget = fighter;
  assert.equal(fcPickTarget(s.fc, heavy, 0, 0, 0, null, s.env), ship);
  s.env.trigger = true;
  assert.equal(fcPickTarget(s.fc, heavy, 0, 0, 0, null, s.env), fighter, '„bij tam, gdzie ja”');
  // Chwyt kursora liczy odległość do obrysu.
  assert.equal(fcPickNearPoint(s.fc.candidates, 2, 2000, 700, 250, s.env), ship, 'duży kadłub łapie się obrysem');
  assert.equal(fcPickNearPoint(s.fc.candidates, 2, 720, 60, 250, s.env), fighter);
  // Lekkie działko nie strzela do myśliwca z daleka (zejdzie z toru), z bliska — tak. 1,7 km: w zasięgu,
  // ale pocisk 4200 j/s leci 0,4 s — szansa trafienia zwinnego myśliwca spada do zera.
  fighter.x = 1700;
  assert.equal(fcPickTarget(s.fc, light, 0, 0, 0, null, s.env), ship);
  fighter.x = 700;
  assert.equal(fcPickNearPoint(s.fc.candidates, 2, 9000, 9000, 250, s.env), null);
});

test('wybór celu: zagrożenie przed celem biernym, dobijanie rannych, najwyżej dwa cele naraz', () => {
  const s = makeScene({ main: 1 });
  const rail = MASTER_WEAPONS.railgun_mk2;
  // Misja 1, faza defences: nieruchomy pancernik (pewne trafienie) kontra fregata, która strzela do gracza.
  const parked = enemy(6700, 0, 'battleship', { hp: 19000 });
  const escort = enemy(1300, 900, 'frigate', { hp: 1850 });
  s.fc.candidates = [
    { e: parked, kind: 'battleship', need: 19000, needMax: 19000, threat: 0, prio: -1 },
    { e: escort, kind: 'frigate', need: 1850, needMax: 1850, threat: 1, prio: -1 }
  ];
  s.fc.candidateCount = 2;
  assert.equal(fcPickTarget(s.fc, rail, 0, 0, 0, parked, s.env), escort, 'bateria bije to, co strzela do gracza — także odrywając się od obecnego celu');
  // Dwie fregaty, obie groźne: ranna wygrywa.
  const fresh = enemy(1500, -800, 'frigate', { hp: 1850 });
  const hurt = enemy(1500, 800, 'frigate', { hp: 400 });
  s.fc.candidates = [
    { e: fresh, kind: 'frigate', need: 1850, needMax: 1850, threat: 1, prio: -1 },
    { e: hurt, kind: 'frigate', need: 400, needMax: 1850, threat: 1, prio: -1 }
  ];
  assert.equal(fcPickTarget(s.fc, rail, 0, 0, 0, null, s.env), hurt, 'dobijanie rannego');
  // Bateria trzyma już dwa cele: trzeci (równie dobry) dostaje karę za rozproszenie.
  const third = enemy(1500, 0, 'frigate', { hp: 1850 });
  s.fc.candidates = [
    { e: fresh, kind: 'frigate', need: 1850, needMax: 1850, threat: 1, prio: -1 },
    { e: hurt, kind: 'frigate', need: 1850, needMax: 1850, threat: 1, prio: -1 },
    { e: third, kind: 'frigate', need: 1850, needMax: 1850, threat: 1, prio: -1 }
  ];
  s.fc.candidateCount = 3;
  s.fc._load.set(fresh, 25);
  s.fc._load.set(hurt, 25);
  assert.notEqual(fcPickTarget(s.fc, rail, 0, 0, 0, null, s.env), third, 'bez trzeciego celu, póki dwa nie są przebite ogniem');
  s.fc._load.clear();
});

// ---------------------------------------------------------------------------
// Łuki ostrzału (działa 180°, broń specjalna 270°)

const DEG = Math.PI / 180;
const ATLAS_HALF = [900, 403]; // ship.w / 2, ship.h / 2 Atlasa (1800 × 806)
const arcDeg = (x, y, group) => Math.round(mountFireArc({ pos: { x, y } }, group, ...ATLAS_HALF).center / DEG);

test('łuk ostrzału: środek z położenia gniazda na obrysie — burta, dziób, rufa, ukos', () => {
  // Gniazda Atlasa (hp.pos z gry, oś x = dziób).
  assert.equal(arcDeg(-122, -189, 'main'), -90, 'śródokręcie — burta');
  assert.equal(arcDeg(-122, 189, 'main'), 90, 'druga burta');
  assert.equal(arcDeg(775, -68, 'main'), -45, 'dziób na rogu — po ukosie');
  assert.equal(arcDeg(473, 88, 'main'), 45);
  assert.equal(arcDeg(-680, -150, 'main'), -135, 'rufa na rogu — po ukosie');
  assert.equal(Math.abs(arcDeg(-711, -5, 'main')), 180, 'rufa na osi — w tył');
  assert.equal(arcDeg(900, 0, 'main'), 0, 'dziób na osi — w przód');
  // Broń specjalna: tylko burta / dziób / rufa, łuk 270°.
  for (const [x, y] of [[-384, 168], [-528, 144], [-264, 120]]) assert.equal(arcDeg(x, y, 'special'), 90, `Yamato ${x},${y} — prawa burta`);
  assert.equal(arcDeg(-384, -168, 'special'), -90);
  assert.equal(MOUNT_ARCS.main.half, Math.PI / 2);
  assert.equal(MOUNT_ARCS.special.half, Math.PI * 0.75);
  assert.equal(mountFireArc({ pos: { x: 0, y: 100 } }, 'aux', ...ATLAS_HALF), null, 'obrona punktowa bez łuku');
  // Specjal prawej burty nie sięga lewej burty, a w przód / w tył — tak.
  const yamato = mountFireArc({ pos: { x: -384, y: 168 } }, 'special', ...ATLAS_HALF);
  assert.equal(bearingInArc(yamato, 0, -90 * DEG), false, 'prawa bateria nie bije w lewo');
  assert.equal(bearingInArc(yamato, 0, -50 * DEG), false);
  assert.equal(bearingInArc(yamato, 0, -40 * DEG), true, 'w przód na lekki skos — tak');
  assert.equal(bearingInArc(yamato, 0, 180 * DEG), true, 'w tył — tak');
  assert.equal(bearingInArc(yamato, Math.PI / 2, 0), false, 'łuk obraca się z kadłubem');
});

test('łuk ostrzału: wieża jedzie przez łuk (nie przez kadłub), cel poza łukiem — lufa na krawędzi, bez strzału', () => {
  const arc = mountFireArc({ pos: { x: 0, y: 300 } }, 'main', ...ATLAS_HALF); // prawa burta: [0°, 180°]
  assert.equal(Math.round(arc.center / DEG), 90);
  const drive = turretDriveFor(MASTER_WEAPONS.railgun_mk2);
  const state = { angle: 5 * DEG, previousAngle: 0, angVel: 0, aimErr: 0, prevDesired: null };
  const base = { x: 0, y: 0 };
  // Cel z tyłu, lekko po lewej (−175°): najkrótsza droga z +5° szłaby przez lewą burtę (przez kadłub).
  const behind = { x: Math.cos(-175 * DEG) * 5000, y: Math.sin(-175 * DEG) * 5000 };
  for (let i = 0; i < 6 / DT; i++) {
    stepMountedWeaponAim(state, base, behind, DT, drive, arc, 0);
    assert.ok(!(state.angle < -1e-6 && state.angle > -Math.PI + 1e-6), `nigdy przez lewą burtę: ${(state.angle / DEG).toFixed(1)}°`);
  }
  assert.ok(Math.abs(Math.abs(state.angle) - Math.PI) < 1 * DEG, 'lufa dociśnięta do tylnej krawędzi łuku');
  assert.ok(state.aimErr > 4 * DEG, 'cel poza łukiem — duży błąd celowania (bramka strzału)');
  // Kadłub obraca się o 90° w lewo: lufa, która wypada poza łuk, zostaje na jego krawędzi.
  stepMountedWeaponAim(state, base, behind, DT, drive, arc, -Math.PI / 2);
  assert.ok(bearingInArc(arc, -Math.PI / 2, state.angle));
});

test('łuki w kierowaniu ogniem: burty biją cele po swojej stronie, bateria w ręku strzela tylko burtą, która sięga', () => {
  const s = makeScene({ main: 8, special: 4, missile: 1 });
  s.env.heading = 0;
  s.env.arcOf = (group, lo) => mountFireArc(lo.hp, group, ...ATLAS_HALF);
  s.env.aim = (lo, aim, base, point, dt, arc) => stepMountedWeaponAim(aim, base, point, dt, turretDriveFor(lo.weapon), arc, 0);
  s.fc.inHand = 'special';
  // Fregata z prawej (+y) i z lewej (−y): każda burta może bić tylko swoją.
  const a = enemy(800, 3000, 'frigate');
  const b = enemy(-500, -2800, 'frigate');
  s.setCandidates([a, b]);
  s.run(3);
  const main = s.shots.filter((x) => x.group === 'main');
  const starboard = main.filter((x) => s.weapons.main[x.i].hp.pos.y > 0);
  const port = main.filter((x) => s.weapons.main[x.i].hp.pos.y < 0);
  assert.ok(starboard.length > 5 && starboard.every((x) => x.target === a), 'prawa burta → cel z prawej');
  assert.ok(port.length > 5 && port.every((x) => x.target === b), 'lewa burta → cel z lewej');
  // Cel priorytetowy z prawej: lewa burta go nie sięga — zostaje na swoim celu, nie obraca się przez kadłub.
  s.shots.length = 0;
  s.setCandidates([a, b], [a]);
  s.run(2);
  assert.ok(s.shots.filter((x) => x.group === 'main' && s.weapons.main[x.i].hp.pos.y < 0).every((x) => x.target === b));
  // Bateria w ręku, kursor na prawej burcie: strzelają tylko Yamato prawej burty.
  s.shots.length = 0;
  for (const lo of s.weapons.special) lo.hp.specialCd = 0;
  s.env.cursor.x = 0; s.env.cursor.y = 6000;
  s.run(4);
  s.env.trigger = true;
  s.run(0.3);
  const salvo = s.shots.filter((x) => x.group === 'special');
  assert.ok(salvo.length >= 2, `salwa: ${salvo.length}`);
  assert.ok(salvo.every((x) => s.weapons.special[x.i].hp.pos.y > 0), 'lewa bateria nie strzela przez pokład');
  assert.equal(s.fc.stats.handTotal, 4);
});

// ---------------------------------------------------------------------------
// Szarża

test('szarża: rusza tylko z pełnego ładunku, zużywa go przez czas zrywu, potem ładuje się od zera', () => {
  const def = shipSystemFor('atlas');
  assert.equal(def.id, 'ram_burn');
  assert.equal(def.speed, 3000, 'decyzja użytkownika: zryw 3000 j/s');
  // Od 2026-10-08 każdy kadłub bojowy ma system F (tests/shipSystems.test.mjs); szarżę — Atlas domyślnie,
  // Iron Skull i Colossus do wyboru.
  assert.equal(shipSystemFor('frigate').id, 'engine_burst');
  assert.equal(shipSystemFor('corvus'), null, 'kadłub bez systemu — F to rakieta');
  const rams = Object.values(HULL_SHIP_SYSTEMS).flat().filter((d) => d.id === 'ram_burn');
  assert.equal(rams.length, 3);
  assert.ok(rams.every((d) => d.speed > 1500 && d.duration > 0 && d.recharge > d.duration));
  assert.equal(SHIP_SYSTEMS.atlas, def);
  const st = createRamBurn();
  assert.equal(canStartRamBurn(st, def), true);
  assert.equal(canStartRamBurn(st, null), false);
  assert.equal(startRamBurn(st, def), true);
  assert.equal(startRamBurn(st, def), false, 'zryw już trwa');
  let ended = 0;
  for (let i = 0; i < (def.duration + 0.1) / DT; i++) if (stepRamBurn(st, def, DT) === RAM_BURN_END) ended++;
  assert.equal(ended, 1);
  assert.equal(st.active, false);
  assert.ok(st.charge < 0.02);
  assert.equal(canStartRamBurn(st, def), false, 'reaktor rozładowany');
  let ready = 0;
  for (let i = 0; i < (def.recharge + 0.1) / DT; i++) if (stepRamBurn(st, def, DT) === RAM_BURN_READY) ready++;
  assert.equal(ready, 1);
  assert.equal(st.charge, 1);
  // Przerwanie nie zwraca ładunku.
  startRamBurn(st, def);
  for (let i = 0; i < 1 / DT; i++) stepRamBurn(st, def, DT);
  assert.equal(stopRamBurn(st), true);
  assert.equal(stopRamBurn(st), false);
  assert.ok(st.charge < 0.85 && st.charge > 0.7);
  assert.equal(canStartRamBurn(st, def), false);
});

test('szybki ogień przez ship.modifiers.fireRate: wieże w ręku i na auto biorą przeładowanie z fireMain', () => {
  // W grze fireMain = fireWeaponCore, który zwraca cooldown × modifiers.fireRate (src/game/shipModifiers.js:
  // szybki ogień ×1,8 = fireRate 1 / 1,8) — kierowanie ogniem musi go użyć jako przeładowania wieży (hp.fcCd).
  const shotsFor = (rateMul, inHand) => {
    // Na auto: w ręku bateria (special, spust puszczony), działa main same biją wroga w zasięgu (4,5 km).
    const s = makeScene({ main: 2, special: inHand ? 0 : 1 });
    const enemy = { x: 3000, y: 0, kind: 'destroyer', hp: 9e9, radius: 200, threat: 1 };
    s.setCandidates([enemy]);
    s.env.cursor.x = 3000;
    if (inHand) {
      fcSetInHand(s.fc, 'main', s.weapons);
      s.env.snapTarget = enemy;
      s.env.trigger = true;
    }
    const fireMain = s.env.fireMain;
    s.env.fireMain = (...a) => fireMain(...a) / rateMul;
    s.run(2);
    s.shots.length = 0;
    s.run(8);
    return s.shots.filter((x) => x.group === 'main').length;
  };
  for (const inHand of [true, false]) {
    const base = shotsFor(1, inHand);
    const rapid = shotsFor(1.8, inHand);
    assert.ok(base > 0, `${inHand ? 'w ręku' : 'auto'}: bez strzałów`);
    assert.ok(Math.abs(rapid / base - 1.8) < 0.25, `${inHand ? 'w ręku' : 'auto'}: ${base} → ${rapid}`);
  }
});

// ---------------------------------------------------------------------------
// Stan wież dla HUD-u (celownik — src/ui/weaponReticle.js, sylwetka — src/ui/turretPanel.js)

test('stan wież dla HUD-u: przeładowanie, gotowość, łuk ostrzału i zniszczone gniazdo', async () => {
  const { FC_TURRET } = await import('../src/game/fireControl.js');
  const scene = makeScene({ special: 2 });
  const { fc, env, weapons, run } = scene;
  // Łuki baterii jak w grze: 270° w burtę (s0 lewa, s1 prawa — y < 0 / y > 0).
  env.heading = 0;
  env.arcOf = (group, lo) => mountFireArc(lo.hp, group, 1700, 600);
  env.aim = (lo, aim, base, point, dt, arc) => stepMountedWeaponAim(aim, base, point, dt, turretDriveFor(lo.weapon), arc, 0);
  fcSetInHand(fc, 'special', weapons);

  // Kursor na prawym trawersie: lewa bateria (martwy klin 90° w prawą burtę) — poza łukiem.
  env.cursor.x = -300; env.cursor.y = 6000;
  run(6);
  assert.equal(fc.turretCount.special, 2);
  const byId = (id) => fc.turrets.special.slice(0, fc.turretCount.special).find((t) => t.hp.id === id);
  assert.equal(byId('s0').state, FC_TURRET.NO_ARC, 'lewa burta nie sięga prawego trawersu');
  assert.equal(byId('s1').state, FC_TURRET.READY, 'prawa burta naładowana i wycelowana');
  assert.ok(byId('s1').arcH > Math.PI / 2 && byId('s1').arcH < Math.PI, 'łuk 270° zapisany w stanie wieży');

  // Strzał: wieża przechodzi w przeładowanie, postęp rośnie od zera do jedynki.
  env.trigger = true;
  run(DT);
  env.trigger = false;
  run(DT);
  const s1 = byId('s1');
  assert.equal(s1.state, FC_TURRET.RELOAD);
  assert.ok(s1.progress < 0.05 && s1.left > 4.5, `po strzale: postęp ${s1.progress}, zostało ${s1.left}`);
  run(2.5);
  assert.ok(Math.abs(byId('s1').progress - 0.5) < 0.05, `w połowie przeładowania: ${byId('s1').progress}`);

  // Zniszczone gniazdo zostaje na liście jako DOWN (sylwetka pokazuje krzyżyk).
  weapons.special[0].hp.destroyed = true;
  run(DT);
  assert.equal(byId('s0').state, FC_TURRET.DOWN);
});

test('stan wież dla HUD-u: broń z postoju (Mjolnir) w ruchu — STILL zamiast READY, na postoju znów gotowa', async () => {
  const { FC_TURRET } = await import('../src/game/fireControl.js');
  const scene = makeScene({ special: 1 });
  const { fc, env, weapons, run } = scene;
  fcSetInHand(fc, 'special', weapons);
  const lo = weapons.special[0];
  lo.weapon = { ...lo.weapon, requiresStationary: true };
  env.cursor.x = 6000; env.cursor.y = 0;
  env.stationary = false;
  run(6);
  assert.equal(fc.turrets.special[0].state, FC_TURRET.STILL, 'w ruchu: wymaga postoju');
  env.stationary = true;
  run(DT);
  assert.equal(fc.turrets.special[0].state, FC_TURRET.READY, 'na postoju: gotowa');
  // Broń bez wymogu postoju w ruchu zostaje gotowa.
  lo.weapon = { ...lo.weapon, requiresStationary: false };
  env.stationary = false;
  run(DT);
  assert.equal(fc.turrets.special[0].state, FC_TURRET.READY);
});
