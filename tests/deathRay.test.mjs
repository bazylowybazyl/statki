// Promień śmierci (2026-10-19, src/game/deathRay.js; dane `death_ray` w src/data/weapons.js): dane i pasmo broni (od
// 2026-10-20 wbudowana wieża Colossusa Terra Nova, tylko NPC, jeden cel), tabele obrazu (receptura, stemple ran, wieża 2D /
// 3D), model obrażeń, strzał na PRAWDZIWYM kadłubie belek pancernika (sprite gry, HullBodies) — jeden strzał przecina
// kadłub silnikiem belek i zabija, tarcza pada do zera, jeden cel (okręt za celem nietknięty, promień kończy się za
// wyjściem i za celem strzału), mechanizm przebić i zatrzymania (broń bez `singleTarget`), wrak tnie się bez liczenia do
// przebić, strzał wizualny bez trafień, rozkaz sceny (ładowanie → strzał w cel), rekordy RAY_* strumienia rozkazów, bez
// Math.random w kroku, wpięcie w index.html (AI NPC — tests/deathRayNpc.test.mjs).
// node --test tests/deathRay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { makeBeamShip } = await import('./helpers/reactorHulls.mjs');
const { MASTER_WEAPONS, shieldImpactClass } = await import('../src/data/weapons.js');
const {
  createDeathRaySystem, deathRayParams, deathRayHullDamage, isDeathRayWeapon, deathRayLife, RAY_HIT, RAY_STATE, RAY_FLAG
} = await import('../src/game/deathRay.js');
const { createRenderCommands, RC, RAY } = await import('../src/render/renderCommands.js');
const { WEAPON_FX } = await import('../src/3d/weapons/weaponFxTable.js');
const { RECIPES, deathRayPalette } = await import('../src/3d/weapons/recipes.js');
const { STAMP, WEAPON_STAMP_FAMILY, stampFamilyFor } = await import('../src/3d/hullDamageStamps.js');
const { Turret2D, normalizeWeaponFxKey, shouldRenderTurret } = await import('../src/vfx/turret2D.js');
const { SHIPS } = await import('../src/data/ships.js');
const { SHIP_EDITOR_DEFAULTS } = await import('../src/data/hardpointEditorDefaults.js');
const { weaponBuildCost, weaponCatalog } = await import('../src/game/weaponEconomy.js');
const { buildWeapon3D, WEAPON3D_FAMILY } = await import('../src/3d/ships3d/weapons/weapons3D.js');
const { BEAM } = await import('../src/3d/weapons/beams.js');
const shields = await import('../shieldSystem.js');
const { readIndexHtml } = await import('./helpers/indexSource.mjs');

const DEF = MASTER_WEAPONS.death_ray;
const DT = 1 / 60;

// ---------------------------------------------------------------------------- świat testu

function cleanupWorld(world) {
  for (const e of world.ships) HullBodies.release(e);
  for (const w of window.wrecks) HullBodies.release(w);
  window.wrecks.length = 0;
}

function beamRadius(e) {
  const h = e?.beamHull;
  if (!h) return Math.max(20, Number(e?.radius) || 20);
  const halfW = h.srcWidth * 0.5 * h.scale, halfH = h.srcHeight * 0.5 * h.scale;
  return Math.max(halfW, halfH) + Math.min(halfW, halfH) * 0.45;
}

// Świat: okręty (pancerniki z kadłubem z prawdziwego sprite'a), stacje, dziennik obrażeń; strumień rozkazów inline
// z czytelnikiem zbierającym rekordy RAY_*.
function makeWorld({ ships = [], stations = [] } = {}) {
  const log = [];
  const records = [];
  const world = { t: 0, ships, stations, log, records };
  const rc = createRenderCommands({ mode: 'inline', capacity: 256 });
  const take = (type) => (r, d, o, words) => records.push({ type, d: Array.from(d.subarray ? d.subarray(o, o + words) : d.slice(o, o + words)), ent: r.ent.bind(r) });
  for (const type of [RC.RAY_FIRE, RC.RAY_HIT, RC.RAY_STATE, RC.RAY_CHARGE, RC.CHARGE]) rc.reader.on(type, take(type));
  world.rc = rc;
  const env = {
    hulls: HullBodies,
    time: () => world.t,
    collect(out) {
      for (const e of world.ships) if (!e.dead && e.beamHull) out.push(e);
      for (const w of window.wrecks) if (w.beamHull && !w.removed) out.push(w);
    },
    stations: () => world.stations,
    stationHit(st, x0, y0, x1, y1) {
      const dx = x1 - x0, dy = y1 - y0, fx = x0 - st.x, fy = y0 - st.y;
      const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - st.r * st.r;
      if (c <= 0) return 0;
      const disc = b * b - 4 * a * c;
      if (disc < 0) return -1;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      return t >= 0 && t <= 1 ? t : -1;
    },
    radius: beamRadius,
    shieldRadius: (e) => shields.getEntityShieldBlockingRadius(e),
    shieldEnter: (e, x, y, dx, dy, maxT) => shields.getEntityShieldRayEnter(e, x, y, dx, dy, maxT),
    collapseShield(e, x, y) { log.push(['shield', e.__name, Math.round(x), Math.round(y)]); e.shield.val = 0; },
    damage(e, dmg, ray) {
      log.push(['dmg', e.__name, Math.round(dmg), ray.byPlayer]);
      if (e.dead) return;
      e.hp -= dmg;
      if (e.hp <= 0) {
        e.dead = true;
        // jak applyDamageToNPC → createWreckage: ocalały kadłub przechodzi na wrak
        if (e.beamHull) HullBodies.convertToWreck(e);
      }
    },
    damageStation(st, dmg) { log.push(['station', st.__name, dmg]); st.hp -= dmg; },
    isWreck: (e) => !!e.isWreck,
    alive: (e) => !!e && !e.dead,
    setSource(def, variant) { log.push(['src', def?.id, variant]); },
    clearSource() {},
    fx: () => rc.writer,
    carrier(e, x, y, out) { out.vx = Number(e?.vx) || 0; out.vy = Number(e?.vy) || 0; out.t0 = world.t; out.z = 0; out.clock = 0; return out; }
  };
  world.sys = createDeathRaySystem(env);
  return world;
}

function battleship(name, x, y, angle = 0, extra = {}) {
  const e = makeBeamShip(HullBodies, 'battleship', x, y, angle);
  e.__name = name;
  e.name = name;
  Object.assign(e, extra);
  return e;
}

// Krok gry: system promieni, ruch encji (x += v dt), silnik belek (rozpad po rzazie), czas.
function run(world, seconds) {
  const n = Math.round(seconds / DT);
  for (let k = 0; k < n; k++) {
    world.sys.step(DT);
    const all = [...world.ships.filter((e) => e.beamHull && e.beamHull.entity === e), ...window.wrecks];
    for (const e of all) { e.x += (e.vx || 0) * DT; e.y += (e.vy || 0) * DT; e.angle += (e.angVel || 0) * DT; }
    HullBodies.step(DT, all);
    world.t += DT;
  }
}

// Żywe węzły wszystkich ciał (statków i wraków) w pasie |odległość od osi promienia| < r w obrysie kadłuba.
function liveNodesNearLine(world, x0, y0, dx, dy, from, to, r) {
  let n = 0;
  const bodies = [...world.ships.filter((e) => e.beamHull && e.beamHull.entity === e), ...window.wrecks];
  for (let t = from; t <= to; t += 5) {
    for (let s = -r; s <= r; s += 5) {
      const x = x0 + dx * t - dy * s, y = y0 + dy * t + dx * s;
      for (const e of bodies) if (HullBodies.probe(e, x, y, 0)) { n++; break; }
    }
  }
  return n;
}

const recs = (world, type, kind = null) => world.records.filter((r) => r.type === type && (kind === null || r.d[RAY.H_KIND] === kind));

// ---------------------------------------------------------------------------- dane i tabele

test('dane: wbudowana wieża Capital (tylko NPC Terra Nova, jeden cel) z ładowaniem i długim przeładowaniem, zasięg w paśmie superbroni', () => {
  assert.ok(DEF, 'death_ray w MASTER_WEAPONS');
  // user 2026-10-20: „built-in turret single target — daj go supercapitalovi Terran; zbyt potężna na special slot”
  assert.equal(DEF.mountType, 'builtin');
  assert.equal(DEF.npcOnly, true, 'poza wyposażeniem gracza');
  assert.equal(DEF.builtinTurret, true, 'wbudowana Z WIEŻĄ (nie lufa w kadłubie jak Hexlance)');
  assert.equal(DEF.npcFaction, 'terran');
  assert.equal(DEF.penetration, 1);
  assert.equal(deathRayParams(DEF).singleTarget, true, 'jeden cel');
  assert.equal(weaponBuildCost(DEF), null, 'nie jest towarem');
  assert.ok(!weaponCatalog().some((row) => row.id === 'death_ray'), 'bez katalogu i sklepu');
  // Colossus Terra Nova: gniazdo builtin z edytora na dziobie (osi), w spec ramy i w domyślnym uzbrojeniu NPC
  const colossus = SHIPS.terran_supercapital;
  assert.equal(colossus.defaultNpcLoadout?.builtin, 'death_ray');
  assert.equal(colossus.spec.builtin, 1);
  const bow = SHIP_EDITOR_DEFAULTS.ships.terran_supercapital.hardpoints.filter((h) => h.type === 'builtin');
  assert.equal(bow.length, 1, 'jedno gniazdo builtin');
  assert.ok(bow[0].x > 600 && Math.abs(bow[0].y) < 50 && bow[0].rot === 90, 'na dziobie, w osi, kierunek dziobu');
  // piraci: własna rama bez promienia; inne ramy — bez gniazda builtin w uzbrojeniu NPC
  assert.notEqual(SHIPS.pirate_supercapital.defaultNpcLoadout?.builtin, 'death_ray');
  assert.ok(!SHIPS.pirate_supercapital.spec.builtin);
  for (const [id, frame] of Object.entries(SHIPS)) {
    if (id !== 'terran_supercapital') assert.notEqual(frame.defaultNpcLoadout?.builtin, 'death_ray', id);
  }
  assert.equal(DEF.size, 'Capital');
  assert.equal(DEF.category, 'superweapon');
  assert.ok(isDeathRayWeapon(DEF) && !isDeathRayWeapon(MASTER_WEAPONS.hexlance_siege));
  assert.ok(DEF.chargeTime >= 3 && DEF.chargeTime <= 6, 'kilka sekund ładowania');
  assert.ok(DEF.cooldown >= 30, 'długie przeładowanie');
  assert.ok(DEF.baseRange >= MASTER_WEAPONS.special_valkyrie_railgun.baseRange && DEF.baseRange < MASTER_WEAPONS.hexlance_siege.baseRange,
    'wiązka natychmiastowa — krótsza niż Hexlance');
  assert.notEqual(DEF.weaponClass, 'sniper', 'nie klasa snajperska (reguły klasy dotyczą dział)');
  assert.equal(DEF.requiresStationary, undefined, 'strzela w ruchu (jak Venator)');
  // pancernik ginie od jednego przejścia; lotniskowiec i superkapitał — nie
  assert.ok(DEF.baseDamage >= 12000 * 1.5 && DEF.baseDamage < 42000);
  assert.equal(shieldImpactClass(DEF), 'special');
  assert.ok(Number.isFinite(DEF.recoil) && Number.isFinite(DEF.shake), 'odrzut i wstrząs z danych');
  const p = deathRayParams(DEF);
  assert.ok(p.cutHalfWidth >= 30 && p.width > 2 * p.cutHalfWidth, 'pas rzazu węższy niż wiązka w obrazie');
  assert.ok(DEF.baseRange / p.frontSpeed < 1, 'czoło dochodzi do końca zasięgu w < 1 s');
  assert.ok(deathRayLife(DEF.baseRange, p) < 3);
});

test('obraz: receptura `deathRay` (ładowanie, wylot, trafienia, emisja), stemple ran, wieża 2D i 3D z tym samym wylotem', () => {
  assert.equal(WEAPON_FX.death_ray.fx, 'deathRay');
  assert.equal(WEAPON_FX.death_ray.charge, DEF.chargeTime);
  const R = RECIPES.deathRay;
  for (const k of ['charge', 'muzzle', 'impact', 'entry', 'kerf', 'exit', 'shield', 'end', 'emit', 'burn']) assert.equal(typeof R[k], 'function', k);
  assert.equal(R.projectile('Capital').trail, -1, 'bez smugi gazu (TRAIL_FAMILIES)');
  assert.equal(WEAPON_STAMP_FAMILY.death_ray, 'deathRay');
  assert.equal(stampFamilyFor(DEF), 'deathRay');
  assert.ok(STAMP.deathRay.kerf && STAMP.deathRay.impact, 'stempel rzazu i zatrzymania');
  assert.ok(STAMP.deathRay.kerf[1] >= 3.5, 'rzaz biało-gorący');
  assert.equal(normalizeWeaponFxKey('death_ray'), 'deathRay');
  const spec = Turret2D.resolveSpec('death_ray', 'superweapon');
  assert.ok(spec && spec.m.length === 1, 'sylwetka z jednym wylotem');
  // wieża na gnieździe builtin: tylko broń z `builtinTurret` (Hexlance — lufa w kadłubie, bez wieży)
  assert.equal(shouldRenderTurret(DEF), true);
  assert.equal(shouldRenderTurret(MASTER_WEAPONS.hexlance_siege), false);
  assert.equal(WEAPON3D_FAMILY.death_ray, 'deathRay');
  const m3 = buildWeapon3D('deathRay', { builder: true });
  assert.equal(m3.trunnion[0] + m3.muzzleX, spec.m[0][0], 'wylot modelu 3D = wylot sylwetki 2D');
  assert.equal(BEAM.RAY, 3);
  // paleta z barwy wiązki: rdzenie jaśniejsze od ciała, ten sam obiekt dla tej samej barwy
  const pal = deathRayPalette(0.06, 1, 0.26);
  assert.equal(deathRayPalette(0.06 * 2, 2, 0.26 * 2), pal, 'paleta po znormalizowanej barwie (bez alokacji)');
  assert.ok(pal.core0[1] > pal.core1[1] * 1.2 && pal.core0[0] > 1, 'rdzeń do bieli');
});

test('model obrażeń: pełne od drogi fullDepth, liniowo niżej, najmniej minFrac (otarcie)', () => {
  const p = deathRayParams(DEF);
  assert.equal(deathRayHullDamage(20000, p.fullDepth, p), 20000);
  assert.equal(deathRayHullDamage(20000, p.fullDepth * 3, p), 20000);
  assert.equal(deathRayHullDamage(20000, p.fullDepth * 0.5, p), 10000);
  assert.equal(deathRayHullDamage(20000, 1, p), 20000 * p.minFrac);
  // pancernik (12 000) ginie, gdy droga ≥ 0,6 fullDepth — w poprzek kadłuba jest ~380 j. materiału
  assert.ok(deathRayHullDamage(DEF.baseDamage, 0.6 * p.fullDepth, p) >= 12000);
});

// ---------------------------------------------------------------------------- prawdziwy kadłub pancernika

test('jeden strzał w poprzek pancernika: kadłub przecięty na wylot (pas rzazu pusty, odłam), śmierć z pominięciem tarczy, rekordy', () => {
  const bs = battleship('pancernik', 0, 0, 0);
  const world = makeWorld({ ships: [bs] });
  try {
    const nodes0 = bs.beamHull.body.activeNodes;
    assert.ok(liveNodesNearLine(world, 0, -1000, 0, 1, 700, 1300, 20) > 50, 'przed strzałem: materiał na linii');
    const ray = world.sys.fire(null, DEF, 0, -1000, 0, 1, { byPlayer: true });
    assert.ok(ray, 'promień');
    run(world, 0.6);
    // śmierć: obrażenia ≥ HP pancernika, encja martwa, kadłub na wraku
    const dmg = world.log.filter((l) => l[0] === 'dmg' && l[1] === 'pancernik');
    assert.equal(dmg.length, 1, 'obrażenia raz, po wyjściu czoła');
    assert.ok(dmg[0][2] >= 12000, `obrażenia ${dmg[0][2]}`);
    assert.equal(dmg[0][3], true, 'strzał gracza (znacznik trafienia)');
    assert.ok(bs.dead, 'pancernik martwy po jednym strzale');
    assert.ok(window.wrecks.length >= 2, `wrak + odcięta część (${window.wrecks.length})`);
    // fizycznie przecięty: w pasie ± 25 j. od osi promienia nie ma już materiału (pas rzazu ± 55)
    assert.equal(liveNodesNearLine(world, 0, -1000, 0, 1, 700, 1300, 25), 0, 'pas rzazu pusty');
    assert.ok(ray.cutNodes > 80, `zabite węzły ${ray.cutNodes} z ${nodes0}`);
    assert.equal(ray.hullsCut, 1);
    assert.equal(ray.kills, 1);
    // źródło mapy ran = broń (rzaz `kerf`)
    assert.ok(world.log.some((l) => l[0] === 'src' && l[1] === 'death_ray' && l[2] === 'kerf'));
    // rekordy: strzał, wejście i wyjście z kadłuba; czoło bez zatrzymania
    const fire = recs(world, RC.RAY_FIRE);
    assert.equal(fire.length, 1);
    const f = fire[0].d;
    assert.equal(f[RAY.F_ID], ray.id);
    assert.equal(f[RAY.F_X], 0); assert.equal(f[RAY.F_Y], -1000);
    assert.equal(f[RAY.F_DX], 0); assert.equal(f[RAY.F_DY], 1);
    assert.equal(f[RAY.F_LEN], DEF.baseRange);
    assert.equal(f[RAY.F_FLAGS] & RAY_FLAG.PLAYER, RAY_FLAG.PLAYER);
    assert.ok(Number.isNaN(f[RAY.F_R]), 'barwa z broni');
    assert.equal(recs(world, RC.RAY_HIT, RAY_HIT.ENTRY).length, 1);
    assert.equal(recs(world, RC.RAY_HIT, RAY_HIT.EXIT).length, 1);
    const entry = recs(world, RC.RAY_HIT, RAY_HIT.ENTRY)[0].d;
    const exit = recs(world, RC.RAY_HIT, RAY_HIT.EXIT)[0].d;
    assert.ok(entry[RAY.H_Y] > -400 && entry[RAY.H_Y] < -100 && exit[RAY.H_Y] > 100 && exit[RAY.H_Y] < 400, 'wejście i wyjście na burtach');
    assert.ok(exit[RAY.H_T] - entry[RAY.H_T] > 250, 'droga w materiale ~ szerokość kadłuba');
    // jeden cel: promień kończy się tuż za wyjściem (pas rzazu + zapas) — obraz dostaje skrócenie RAY_STATE
    const st = recs(world, RC.RAY_STATE);
    assert.equal(st.length, 1);
    assert.equal(st[0].d[RAY.S_CODE], RAY_STATE.STOP);
    const over = st[0].d[RAY.S_LEN] - exit[RAY.H_T];
    assert.ok(over > deathRayParams(DEF).cutHalfWidth && over < 200, `koniec za wyjściem (+${Math.round(over)} j.)`);
  } finally {
    cleanupWorld(world);
  }
});

test('tarcza pancernika pada do zera przy obrysie (przepalenie), kadłub i tak przecięty', () => {
  const bs = battleship('tarczownik', 0, 0, 0.3, { radius: 330, shield: { val: 7200, max: 7200, state: 'active', activationProgress: 1, impacts: [] } });
  const world = makeWorld({ ships: [bs] });
  try {
    assert.ok(shields.isEntityShieldBlocking(bs), 'tarcza blokuje przed strzałem');
    world.sys.fire(null, DEF, -2000, 40, 1, 0);
    run(world, 0.5);
    const sh = world.log.filter((l) => l[0] === 'shield');
    assert.equal(sh.length, 1, 'tarcza pada raz');
    assert.ok(sh[0][2] < -150, 'na obrysie tarczy przed kadłubem');
    assert.equal(bs.shield.val, 0);
    assert.ok(bs.dead, 'pancernik z tarczą też ginie od jednego strzału');
    assert.equal(recs(world, RC.RAY_HIT, RAY_HIT.SHIELD).length, 1);
    const iS = world.log.findIndex((l) => l[0] === 'shield');
    const iD = world.log.findIndex((l) => l[0] === 'dmg');
    assert.ok(iS >= 0 && iD > iS, 'tarcza przed obrażeniami kadłuba');
  } finally {
    cleanupWorld(world);
  }
});

test('jeden cel: pierwszy pancernik na linii przecięty i martwy, drugi za nim nietknięty — promień kończy się za wyjściem', () => {
  const a = battleship('A', 0, 0, Math.PI / 2);
  const b = battleship('B', 2000, 0, Math.PI / 2);
  const world = makeWorld({ ships: [a, b] });
  try {
    const bNodes = b.beamHull.body.activeNodes;
    const ray = world.sys.fire(null, DEF, -3000, 0, 1, 0);
    run(world, 0.7);
    assert.ok(a.dead, 'pierwszy przecięty i martwy');
    assert.ok(!b.dead, 'drugi żyje');
    assert.ok(!world.log.some((l) => l[0] === 'dmg' && l[1] === 'B'), 'drugi bez obrażeń');
    assert.equal(b.beamHull.body.activeNodes, bNodes, 'drugi bez rzazu i krateru');
    // koniec tuż za wyjściem z A (kadłub w poprzek: x ∈ ~[−190, 190]) — pas rzazu + zapas, przed obwiednią B
    const endX = -3000 + ray.len;
    assert.ok(ray.stopped && endX > 150 && endX < 400, `promień kończy się za A (x ${Math.round(endX)})`);
    assert.equal(recs(world, RC.RAY_HIT, RAY_HIT.EXIT).length, 1, 'wyjście z A');
    assert.equal(recs(world, RC.RAY_HIT, RAY_HIT.END).length, 0, 'bez zatrzymania na kraterze');
    const st = recs(world, RC.RAY_STATE);
    assert.equal(st.length, 1);
    assert.equal(st[0].d[RAY.S_CODE], RAY_STATE.STOP);
    assert.ok(Math.abs(st[0].d[RAY.S_LEN] - ray.len) < 1e-6, 'obraz skrócony do długości gry');
  } finally {
    cleanupWorld(world);
  }
});

test('jeden cel: promień nie leci dalej niż za obwiednię celu strzału (cel poza osią — okręt daleko za nim nietknięty)', () => {
  const t = battleship('cel', 2000, 1500, 0);
  const far = battleship('daleko', 8000, 0, Math.PI / 2);
  const world = makeWorld({ ships: [t, far] });
  try {
    const n0 = far.beamHull.body.activeNodes;
    const ray = world.sys.fire(null, DEF, -3000, 0, 1, 0, { target: t });
    const proj = 2000 - -3000;
    assert.ok(ray.len < proj + beamRadius(t) * 1.2 + 301 && ray.len > proj, `długość ograniczona celem (${Math.round(ray.len)})`);
    run(world, 0.7);
    assert.equal(far.beamHull.body.activeNodes, n0, 'okręt za celem nietknięty');
    assert.ok(!far.dead);
    // bez celu ten sam strzał doszedłby do niego (kontrola)
    const ray2 = world.sys.fire(null, DEF, -3000, 0, 1, 0);
    run(world, 0.7);
    assert.ok(far.dead && ray2.kills === 1, 'kontrola: bez celu promień sięga dalekiego okrętu');
  } finally {
    cleanupWorld(world);
  }
});

test('przebicia (broń bez `singleTarget`): dwa pancerniki na linii przecięte na wylot, trzeci zatrzymuje promień (krater, ułamek obrażeń)', () => {
  // mechanizm przebić systemu (sceny, przyszłe bronie): ta sama broń z penetration 2 i bez jednego celu
  const MULTI = { ...DEF, penetration: 2, deathRay: { ...DEF.deathRay, singleTarget: false } };
  assert.equal(deathRayParams(MULTI).singleTarget, false);
  const a = battleship('A', 0, 0, Math.PI / 2);
  const b = battleship('B', 2000, 0, Math.PI / 2);
  const c = battleship('C', 4000, 0, Math.PI / 2);
  const world = makeWorld({ ships: [a, b, c] });
  try {
    const cNodes = c.beamHull.body.activeNodes;
    const ray = world.sys.fire(null, MULTI, -3000, 0, 1, 0);
    run(world, 0.7);
    assert.ok(a.dead && b.dead, 'dwa pierwsze przecięte i martwe');
    assert.ok(!c.dead, 'trzeci żyje');
    const dc = world.log.filter((l) => l[0] === 'dmg' && l[1] === 'C');
    assert.equal(dc.length, 1);
    assert.equal(dc[0][2], Math.round(DEF.baseDamage * deathRayParams(DEF).endDamageFrac), 'ułamek obrażeń zatrzymania');
    assert.ok(c.beamHull.body.activeNodes < cNodes, 'krater zatrzymania');
    // koniec na burcie trzeciego (kadłub w poprzek: x ∈ ~[3810, 4190]); długość liczona od wylotu (x = −3000)
    const endX = -3000 + ray.len;
    assert.ok(ray.stopped && endX > 3700 && endX < 4000, `promień kończy się na trzecim (x ${Math.round(endX)})`);
    assert.equal(recs(world, RC.RAY_HIT, RAY_HIT.END).length, 1);
    const st = recs(world, RC.RAY_STATE);
    assert.equal(st.length, 1);
    assert.equal(st[0].d[RAY.S_CODE], RAY_STATE.STOP);
    assert.ok(Math.abs(st[0].d[RAY.S_LEN] - ray.len) < 1e-6);
  } finally {
    cleanupWorld(world);
  }
});

test('wrak na linii: cięty z pędem, bez obrażeń i bez liczenia do przebić (jeden cel — okręt za wrakiem)', () => {
  const w0 = battleship('wrak', 0, 0, Math.PI / 2);
  const a = battleship('A', 2000, 0, Math.PI / 2);
  const b = battleship('B', 4000, 0, Math.PI / 2);
  const world = makeWorld({ ships: [w0, a, b] });
  try {
    w0.dead = true;
    HullBodies.convertToWreck(w0);
    const wreck = window.wrecks.at(-1);
    const n0 = wreck.beamHull.body.activeNodes;
    world.sys.fire(null, DEF, -3000, 0, 1, 0);
    run(world, 0.7);
    assert.ok(!world.log.some((l) => l[0] === 'dmg' && l[1] === 'wrak'), 'wrak bez obrażeń');
    assert.ok(wreck.beamHull ? wreck.beamHull.body.activeNodes < n0 : true, 'wrak przecięty');
    assert.ok(a.dead, 'okręt za wrakiem przecięty (wrak nie jest celem)');
    assert.ok(!b.dead, 'jeden cel: następny okręt nietknięty');
  } finally {
    cleanupWorld(world);
  }
});

test('stacja na drodze: obrażenia raz, promień kończy się na niej (okręt za nią cały)', () => {
  const behind = battleship('za', 3000, 0, Math.PI / 2);
  const st = { __name: 'stacja', x: 1500, y: 0, r: 400, hp: 1e6 };
  const world = makeWorld({ ships: [behind], stations: [st] });
  try {
    const n0 = behind.beamHull.body.activeNodes;
    const ray = world.sys.fire(null, DEF, -1000, 0, 1, 0);
    run(world, 0.6);
    const sd = world.log.filter((l) => l[0] === 'station');
    assert.equal(sd.length, 1);
    assert.equal(sd[0][2], deathRayParams(DEF).stationDamage);
    assert.ok(ray.len > 2000 && ray.len < 2200, `koniec na obrysie stacji (${Math.round(ray.len)})`);
    assert.equal(behind.beamHull.body.activeNodes, n0, 'okręt za stacją nietknięty');
    assert.ok(!behind.dead);
  } finally {
    cleanupWorld(world);
  }
});

test('strzał wizualny: rekord z flagą, barwą i wysokością, bez rzazu i obrażeń (warstwy bitwy w głębi)', () => {
  const bs = battleship('tlo', 0, 0, 0);
  const world = makeWorld({ ships: [bs] });
  try {
    const n0 = bs.beamHull.body.activeNodes;
    const r = world.sys.visual(0, -2000, 0, 2000, { color: [1, 0.2, 0.1], z0: -600, z1: -900, width: 220 });
    assert.ok(r && r.visual);
    run(world, 0.5);
    assert.equal(bs.beamHull.body.activeNodes, n0, 'bez rzazu');
    assert.equal(world.log.filter((l) => l[0] === 'dmg').length, 0, 'bez obrażeń');
    const f = recs(world, RC.RAY_FIRE)[0].d;
    assert.equal(f[RAY.F_FLAGS] & RAY_FLAG.VISUAL, RAY_FLAG.VISUAL);
    assert.equal(f[RAY.F_FLAGS] & RAY_FLAG.END_FLASH, RAY_FLAG.END_FLASH);
    assert.equal(f[RAY.F_LEN], 4000);
    assert.equal(f[RAY.F_Z0], -600); assert.equal(f[RAY.F_Z1], -900);
    assert.equal(f[RAY.F_R], 1); assert.equal(f[RAY.F_G], 0.2); assert.equal(f[RAY.F_B], 0.1);
    assert.equal(f[RAY.F_WIDTH], 220);
    // z ładowaniem: rekordy RAY_CHARGE (u rośnie), potem strzał
    world.records.length = 0;
    const ord = world.sys.visual(100, -2000, 100, 2000, { charge: 0.5, color: [0.2, 0.6, 1] });
    assert.equal(ord.state, 'charging');
    run(world, 0.6);
    const ch = recs(world, RC.RAY_CHARGE);
    assert.ok(ch.length >= 25, `ładowanie ${ch.length}`);
    assert.ok(ch.at(-1).d[RAY.C_U] === 1 && ch[0].d[RAY.C_U] < 0.1);
    assert.equal(ch[0].d[RAY.C_LEN], 4000, 'laser naprowadzający do końca strzału');
    assert.equal(ord.state, 'fired');
    assert.equal(recs(world, RC.RAY_FIRE).length, 1);
    assert.equal(bs.beamHull.body.activeNodes, n0);
  } finally {
    cleanupWorld(world);
  }
});

test('rozkaz sceny: strzelec ładuje promień i strzela w AKTUALNĄ pozycję celu — pancernik ginie', () => {
  const target = battleship('cel', 0, 0, 0.4);
  const shooter = { __name: 'strzelec', x: -5000, y: 1200, angle: 0, vx: 0, vy: 0, radius: 300 };
  const world = makeWorld({ ships: [target] });
  try {
    const ord = world.sys.order(shooter, target, { charge: 1.0 });
    assert.equal(ord.state, 'charging');
    target.vx = 120;   // cel się rusza w trakcie ładowania
    run(world, 0.5);
    assert.equal(ord.state, 'charging');
    run(world, 1.2);
    assert.equal(ord.state, 'fired');
    assert.ok(ord.ray, 'promień rozkazu');
    assert.ok(target.dead, 'cel martwy');
    const ch = recs(world, RC.RAY_CHARGE);
    assert.ok(ch.length >= 55, `ładowanie przy wylocie (${ch.length})`);
    // wylot z dziobu strzelca (brak gniazda), laser naprowadzający do celu
    assert.ok(Math.abs(ch[0].d[RAY.C_X] - (-5000 + 300 * 0.6)) < 1e-6);
    assert.ok(ch[0].d[RAY.C_LEN] > 4500 && ch[0].d[RAY.C_LEN] < 5600);
  } finally {
    cleanupWorld(world);
  }
});

test('ładowanie NPC (wieża Colossusa): rekord RAY_CHARGE przy lufie, laser naprowadzający do celu AI (bez celu — zasięg)', () => {
  const world = makeWorld({ ships: [] });
  try {
    const shooter = { __name: 'colossus', x: 0, y: 0, angle: 0, vx: 0, vy: 0, radius: 800 };
    const weaponState = {};   // działo NPC (autoWeapons) — klucz stanu efektu
    const target = { x: 6000, y: 800 };
    world.sys.chargeFx(shooter, DEF, 900, 0, Math.atan2(800, 5100), 0.4, DT, weaponState, target);
    world.sys.chargeFx(shooter, DEF, 900, 0, 0, 0.5, DT, weaponState, null);
    const ch = recs(world, RC.RAY_CHARGE);
    assert.equal(ch.length, 2, 'ładowanie promienia, nie zwykły rekord CHARGE');
    assert.equal(recs(world, RC.CHARGE).length, 0);
    const d = ch[0].d;
    const want = Math.sqrt((target.x - d[RAY.C_X]) ** 2 + (target.y - d[RAY.C_Y]) ** 2);
    assert.ok(Math.abs(d[RAY.C_LEN] - want) < 1e-6, `laser do celu (${Math.round(d[RAY.C_LEN])} / ${Math.round(want)})`);
    assert.ok(d[RAY.C_X] > 900, 'wylot na końcu lufy (czop + lufa sylwetki)');
    assert.equal(d[RAY.C_U], 0.4);
    assert.equal(ch[1].d[RAY.C_LEN], DEF.baseRange, 'bez celu — zasięg broni');
  } finally {
    cleanupWorld(world);
  }
});

test('krok promienia bez Math.random gry (rzaz, tarcze, rekordy)', () => {
  const bs = battleship('los', 0, 0, 0, { radius: 330, shield: { val: 7200, max: 7200, state: 'active', activationProgress: 1, impacts: [] } });
  const world = makeWorld({ ships: [bs] });
  const saved = Math.random;
  let calls = 0;
  try {
    world.sys.fire(null, DEF, -2000, 0, 1, 0);
    Math.random = () => { calls++; return saved(); };
    for (let k = 0; k < 30; k++) world.sys.step(DT);
  } finally {
    Math.random = saved;
    cleanupWorld(world);
  }
  assert.equal(calls, 0);
});

test('index.html: fireWeaponCore oddaje promień systemowi, krok w physicsStep, haki DevScene i ładowanie NPC przy lufie', () => {
  const html = readIndexHtml().replace(/\r\n/g, '\n');
  assert.match(html, /if \(weapon\.deathRay\) return fireDeathRayCore\(shooter, target, weapon, muzzleData\);/);
  assert.match(html, /npcShootingStep\(dt\);\n(?:.*\n){0,2}\s*deathRays\.step\(dt\);/);
  for (const hook of ['deathRay(shooter, target, opts = {})', 'deathRayVisual(x0, y0, x1, y1, opts = {})', 'equipDeathRay(npc, weaponId', 'deathRayState()']) {
    assert.ok(html.includes(hook), `DevScene.${hook}`);
  }
  assert.match(html, /if \(weapon\.def\.deathRay\) \{ deathRays\.chargeFx\(/);
  assert.ok(html.includes("applyDamageToNPC(e, dmg, 'deathray', SHIELD_BREACH_DAMAGE_OPTS"), 'obrażenia z pominięciem tarczy');
  assert.ok(html.includes('window.DeathRayGame = deathRays'), 'gra: window.DeathRayGame (scena „Wojna”)');
  // jeden cel: strzał NPC niesie cel; wieża Colossusa na gnieździe builtin (equipDeathRay — wirtualne builtin na dziobie)
  assert.match(html, /target: aimed \? target : null/);
  assert.match(html, /e\.weapons\.builtin = \[\{ hp, weapon: def \}\];/);
  // tylko NPC: gniazda gracza, zapis wyposażenia i konsola dev odrzucają broń `npcOnly`
  assert.match(html, /function playerFitFits\(def, slot\) \{\n\s*return !!def && def\.npcOnly !== true && /);
  assert.match(html, /function savedHardpointBucket\(saved\) \{\n\s*if \(saved\?\.mount && WEAPONS\[saved\.mount\]\?\.npcOnly === true\) return null;/);
  assert.ok(html.includes("isKnown: (id) => !!WEAPONS[id] && WEAPONS[id].npcOnly !== true"), 'magazyn z zapisu bez broni NPC');
  assert.match(html, /mountSpecial\(weaponId, count = Infinity\) \{\n(?:.*\n){0,1}\s*if \(weaponId && WEAPONS\[weaponId\]\?\.npcOnly === true\) return 0;/);
  // frakcja: piracka rama Colossusa bez promienia; linia ognia NPC z pasem szerokiej wiązki
  assert.match(html, /const onlyFaction = MASTER_WEAPONS\[weaponId\]\.npcFaction;/);
  assert.match(html, /function isLineOfFireBlocked\(shooter, target, weaponRange, pad\) \{/);
});
