// Lampki gotowości przy wieżach broni (decyzja użytkownika 2026-11-11: „zielona gotowa, bursztynowa przy przeładowaniu,
// czerwona pusta — z góry dobrze widoczne”): kod lampki po stronie gry (NPC — autoWeapons, gracz — gniazda grup),
// pole READY rekordu TURRET migawki, lustro workera, obraz (pula billboardów, LOD, maskowanie, okręt bez zasilania —
// bez lampki i z przygaszonymi akcentami wież).
// node --test tests/turretReadyLamp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { TURRET_LAMP, TURRET_LAMP_TUNE, turretLampCode, turretLampColor } from '../src/data/turretReadyLamp.js';
import { Turret2D, npcTurretLampCode } from '../src/vfx/turret2D.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { createShipPower, POWER_OFF, POWER_SHUTDOWN, POWER_STARTUP, POWER_ON } from '../src/game/shipPower.js';
import { TURRET, SNAPSHOT_LAYOUT_VERSION } from '../src/render/snapshotLayout.js';
import { getMountedWeaponAim } from '../src/game/weaponAim.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const L = TURRET_LAMP;

test('kod lampki: zasilanie, gniazdo, magazynek, ładowanie, przeładowanie, szybkostrzelne', () => {
  assert.equal(turretLampCode(false, false, null, 0, 2, false), L.DARK, 'okręt bez zasilania — bez lampki');
  assert.equal(turretLampCode(false, true, 0, 3, 2, true), L.DARK, 'wyłączony ma pierwszeństwo przed resztą');
  assert.equal(turretLampCode(true, true, null, 0, 2, false), L.EMPTY, 'gniazdo zniszczone — czerwona');
  assert.equal(turretLampCode(true, false, 0, 0, 2, false), L.EMPTY, 'pusty magazynek — czerwona');
  assert.equal(turretLampCode(true, false, -1, 0, 2, true), L.EMPTY, 'pusty magazynek przed ładowaniem');
  assert.equal(turretLampCode(true, false, 3, 0, 2, true), L.BUSY, 'ładowanie strzału — bursztynowa');
  assert.equal(turretLampCode(true, false, null, 1.2, 2, false), L.BUSY, 'przeładowanie — bursztynowa');
  assert.equal(turretLampCode(true, false, null, 0, 2, false), L.READY, 'naładowana — zielona');
  assert.equal(turretLampCode(true, false, 5, -0.4, 2, false), L.READY, 'ujemny zegar NPC = naładowana');
  assert.equal(turretLampCode(true, false, null, 0.05, 0.1, false), L.READY, 'szybkostrzelna w ogniu nie mruga bursztynem');
  assert.equal(turretLampCode(true, false, null, 0.3, TURRET_LAMP_TUNE.rapidCooldown, false), L.BUSY, 'próg szybkostrzelnych — od rapidCooldown bursztyn');
  assert.equal(turretLampCode(true, false, null, 0.3, 0, false), L.BUSY, 'nieznane przeładowanie — bursztyn, gdy trwa');
  const rgb = [9, 9, 9];
  assert.equal(turretLampColor(L.DARK, rgb), false);
  assert.deepEqual(rgb, [0, 0, 0], 'kod bez lampki — zera');
  assert.equal(turretLampColor(L.NONE, rgb), false);
  for (const code of [L.READY, L.BUSY, L.EMPTY]) {
    assert.equal(turretLampColor(code, rgb), true);
    assert.ok(Math.max(...rgb) > 1, `kod ${code}: HDR > 1 (świeci z bloomem)`);
    assert.ok(Math.max(...rgb) < 8, `kod ${code}: nie oślepia (lampy nawigacyjne × 6,5)`);
  }
  turretLampColor(L.READY, rgb); assert.ok(rgb[1] > 2 * rgb[0] && rgb[1] > 2 * rgb[2], 'zielona');
  turretLampColor(L.BUSY, rgb); assert.ok(rgb[0] > rgb[1] && rgb[1] > 3 * rgb[2], 'bursztynowa');
  turretLampColor(L.EMPTY, rgb); assert.ok(rgb[0] > 8 * rgb[1], 'czerwona');
});

const railgun = MASTER_WEAPONS.railgun_mk1;
const ciws = MASTER_WEAPONS.ciws_mk1;
const launcher = Object.values(MASTER_WEAPONS).find((w) => w && w.ammo != null && w.cooldown >= 1);

function recordsOf(entity) {
  Turret2D.enabled = true;
  Turret2D.beginFrame();
  Turret2D.sync(entity, 0, 0, 0, 1);
  return (Turret2D.recordsFor(entity) || []).map((r) => ({ uid: r.uid, ready: r.ready }));
}

test('gra, NPC: kod z wpisu autoWeapons (cd, ammo, charge, gniazdo) i stanu zasilania okrętu', () => {
  assert.ok(railgun && ciws && launcher, 'bronie testu');
  const npc = {
    autoWeapons: [
      { def: railgun, hpOffset: { x: 10, y: 0 }, cd: -0.3, ammo: null },                 // gotowa
      { def: railgun, hpOffset: { x: 20, y: 0 }, cd: 1.1, ammo: null },                  // przeładowanie
      { def: launcher, hpOffset: { x: 30, y: 0 }, cd: 0, ammo: 0 },                      // pusta
      { def: railgun, hpOffset: { x: 40, y: 0 }, cd: 0, ammo: null, charge: { charge: 0.4 } }, // ładowanie
      { def: ciws, hpOffset: { x: 50, y: 0 }, cd: 0.02, ammo: null },                    // CIWS w ogniu ciągłym
      { def: railgun, hpOffset: { x: 60, y: 0, destroyed: true }, cd: 0, ammo: null }    // zniszczone gniazdo
    ]
  };
  try {
    const codes = recordsOf(npc).map((r) => r.ready);
    assert.deepEqual(codes, [L.READY, L.BUSY, L.EMPTY, L.BUSY, L.READY, L.EMPTY]);
    for (const st of [POWER_OFF, POWER_SHUTDOWN, POWER_STARTUP]) {
      npc.shipPower = createShipPower(false);
      npc.shipPower.state = st;
      assert.ok(recordsOf(npc).every((r) => r.ready === L.DARK), `stan zasilania ${st} — bez lampek`);
    }
    npc.shipPower.state = POWER_ON;
    assert.deepEqual(recordsOf(npc).map((r) => r.ready), codes, 'po rozruchu lampki wracają');
    assert.equal(npcTurretLampCode(npc.autoWeapons[0], false), L.DARK);
  } finally {
    Turret2D.clear();
  }
});

test('gra, gracz: kod z gniazd grup (fcCd, specialCd, missileCd, ciws[i].cd), ładowanie z celowania, zasilanie', () => {
  const special = MASTER_WEAPONS.special_valkyrie_s || Object.values(MASTER_WEAPONS).find((w) => w && w.mountType === 'special');
  assert.ok(special, 'broń specjalna');
  const hp = (x, extra = {}) => ({ pos: { x, y: 0 }, ...extra });
  const ship = {
    isPlayer: true, angle: 0, pos: { x: 0, y: 0 },
    weapons: {
      main: [
        { weapon: railgun, hp: hp(10, { fcCd: 0 }) },
        { weapon: railgun, hp: hp(20, { fcCd: 1.5 }) },
        { weapon: railgun, hp: hp(30, { fcCd: 0, destroyed: true }) }
      ],
      aux: [{ weapon: ciws, hp: hp(40) }],
      missile: [
        { weapon: launcher, hp: hp(50, { missileCd: 0, ammo: 0 }) },
        { weapon: launcher, hp: hp(60, { missileCd: 2, ammo: 4 }) }
      ],
      special: [
        { weapon: special, hp: hp(70, { specialCd: 0 }) },
        { weapon: special, hp: hp(80, { specialCd: 0 }) }
      ]
    },
    ciws: [{ cd: 0.01, offset: { x: 40, y: 0 }, angle: 0 }]
  };
  // drugie działo specjalne ładuje strzał (stan celowania gniazda — weaponCharge.js)
  getMountedWeaponAim(ship, ship.weapons.special[1]).charge = { charge: 0.2, u: 0.1 };
  try {
    const recs = recordsOf(ship);
    const codes = recs.map((r) => r.ready);
    assert.deepEqual(codes, [
      L.READY, L.BUSY, L.EMPTY,          // main: gotowa, przeładowanie, zniszczone gniazdo
      L.READY,                           // aux: CIWS w ogniu ciągłym
      L.EMPTY, L.BUSY,                   // missile: pusty magazynek, przeładowanie
      L.READY, L.BUSY                    // special: gotowa, ładowanie strzału
    ]);
    ship.shipPower = createShipPower(false);
    assert.ok(recordsOf(ship).every((r) => r.ready === L.DARK), 'wyłączony Atlas — bez lampek');
  } finally {
    Turret2D.clear();
  }
});

test('migawka: READY na końcu i32 rekordu TURRET, pakowanie i lustro workera', () => {
  const names = Object.keys(TURRET.I32).filter((k) => k !== 'COUNT').sort((a, b) => TURRET.I32[a] - TURRET.I32[b]);
  assert.equal(names[names.length - 1], 'READY', 'pole dopisane na końcu rekordu');
  assert.equal(TURRET.I32.READY, 6);
  assert.ok(SNAPSHOT_LAYOUT_VERSION >= 6, 'wersja układu podbita');
  assert.match(read('src/render/snapshotPack.js'), /i32\[bi \+ TI\.READY\] = r\.ready \| 0;/);
  const worker = read('src/render/render.worker.js');
  assert.match(worker, /r\.ready = i32\[bi \+ TI\.READY\];/, 'worker czyta kod lampki do rekordu lustra');
  assert.match(worker, /state: \{ housing: 0, barrel: 0, flash: 0 \}, ready: 0 \}/, 'rekord puli lustra ma stały kształt z polem ready');
});

// ── Obraz (shipModels3DGame.js na scenie bez GPU) ────────────────────────────────────────────────────────────
const { Core3D } = await import('../src/3d/core3d.js');
const M = await import('../src/3d/ships3d/shipModels3DGame.js');
const { TURRET_INST_STRIDE } = await import('../src/3d/ships3d/turretBatch3D.js');
// Jedna scena na wszystkie testy obrazu: partie wież i pula lampek powstają raz na moduł (w scenie z pierwszego użycia).
if (!Core3D.scene) Core3D.scene = new THREE.Scene();

function lampMesh() { return Core3D.scene.children.find((c) => c.name === 'wieże 3D: lampki gotowości'); }
function turretGlows() {
  const out = [];
  for (const m of Core3D.scene.children) {
    if (!m.name?.startsWith('wieże 3D: ') || m === lampMesh()) continue;
    const g = m.geometry, d = g?.getAttribute?.('iTurLook')?.data?.array;
    if (!d) continue;
    for (let i = 0; i < g.instanceCount; i++) out.push(d[i * TURRET_INST_STRIDE + 16]);
  }
  return out;
}
function rec(e, i, ready, extra = {}) {
  return { entity: e, key: `lamp-${i}`, uid: `u${i}`, weaponId: 'railgun_mk1', fxKey: 'rail', wx: 1000 + i * 60, wy: 2000, ang: 0.3,
    scale: 1, recoil: 0.5, shake: 0, spec: { r: 20 }, state: { housing: 0, barrel: 0, flash: 0 }, ready, ...extra };
}

test('obraz: lampka w kolorze kodu, bez lampki dla DARK / NONE, LOD i maskowanie; akcenty wyłączonego gasną płynnie', () => {
  {
    const e = { x: 1000, y: 2000, angle: 0 };
    const recs = [rec(e, 0, L.READY), rec(e, 1, L.BUSY), rec(e, 2, L.EMPTY), rec(e, 3, L.DARK), rec(e, 4, L.NONE)];
    const frame = (zoom = 1, dt = 1 / 60) => M.syncShipModels3D({ entities: [e], turrets: { recordsFor: () => recs }, zoom, dt });
    frame();
    const lamps = lampMesh();
    assert.ok(lamps, 'pula lampek w scenie');
    assert.equal(lamps.geometry.instanceCount, 3, 'trzy lampki: gotowa, przeładowanie, pusta');
    assert.equal(lamps.visible, true);
    const d = lamps.geometry.getAttribute('iColor').data.array;
    const rgb = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      turretLampColor([L.READY, L.BUSY, L.EMPTY][i], rgb);
      assert.deepEqual([d[i * 8 + 4], d[i * 8 + 5], d[i * 8 + 6]].map((v) => +v.toFixed(4)), rgb.map((v) => +Math.fround(v).toFixed(4)), `barwa lampki ${i}`);
    }
    // miejsce: za czopem (wstecz od kursu lufy), nad warstwą głębi wieży na sprite'cie, min. rozmiar w px
    const org = lamps.position;
    const lx = d[0] + org.x, ly = d[1] + org.y, lz = d[2], lr = d[3];
    const back = TURRET_LAMP_TUNE.back * 20;
    // scena: x = x gry, y = −y gry; kurs lufy w scenie (cos α, −sin α) — lampka wstecz od niego
    assert.ok(Math.abs(lx - (1000 - Math.cos(0.3) * back)) < 1e-3 && Math.abs(ly - (-2000 + Math.sin(0.3) * back)) < 1e-3, `lampka na tyle obudowy (${lx}, ${ly})`);
    assert.ok(lz > 1.8, `nad warstwą głębi wieży na sprite'cie (z ${lz})`);
    assert.ok(lr * 1 >= TURRET_LAMP_TUNE.minPx - 1e-6, 'promień ≥ minPx przy zoomie 1');
    // akcenty: DARK przygasa płynnie (stała czasu), reszta świeci
    let g = turretGlows();
    assert.equal(g.length, 5);
    assert.deepEqual(g.map((v) => +v.toFixed(3)), [1, 1, 1, TURRET_LAMP_TUNE.darkGlow, 1].map((v) => +Math.fround(v).toFixed(3)), 'nowa wieża bierze stan od razu');
    recs[0].ready = L.DARK;
    frame(1, 0.05);
    g = turretGlows();
    assert.ok(g[0] < 1 && g[0] > TURRET_LAMP_TUNE.darkGlow, `wieża gaśnie płynnie (${g[0]})`);
    for (let i = 0; i < 60; i++) frame(1, 1 / 60);
    assert.ok(Math.abs(turretGlows()[0] - TURRET_LAMP_TUNE.darkGlow) < 0.01, 'po sekundzie przygaszona');
    assert.equal(lampMesh().geometry.instanceCount, 2, 'wyłączona wieża bez lampki');
    // LOD: wieża mniejsza niż minTurretPx — bez lampki (wieża jeszcze jest)
    const zSmall = (TURRET_LAMP_TUNE.minTurretPx - 0.5) / 20;
    frame(zSmall);
    assert.equal(lampMesh().geometry.instanceCount, 0, 'z daleka bez lampek');
    assert.equal(turretGlows().length, 5, 'wieże z daleka zostają');
    // maskowanie: lampka liczy się PO teście wzoru maskowania wieży (wieża ukryta → lampka też)
    const src = read('src/3d/ships3d/shipModels3DGame.js');
    const cloakAt = src.indexOf('entityCloakVisAt(e, rec.wx, rec.wy) < 0.5) continue;');
    assert.ok(cloakAt > 0 && cloakAt < src.indexOf('lamps.push('), 'lampka za testem maskowania wieży');
    // pusta klatka — pula gaśnie
    M.syncShipModels3D({ entities: [], turrets: { recordsFor: () => null }, zoom: 1, dt: 1 / 60 });
    assert.equal(lampMesh().visible, false);
  }
});

test('lustro: rekordy z migawki (kształt puli workera) dają te same lampki co rekordy gry (tryb off)', () => {
  {
    const run = (recsOf) => {
      const e = { x: 1000, y: 2000, angle: 0 };
      const recs = recsOf(e);
      M.syncShipModels3D({ entities: [e], turrets: { recordsFor: () => recs }, zoom: 1.3, dt: 1 / 60 });
      const m = lampMesh();
      return { n: m.geometry.instanceCount, data: [...m.geometry.getAttribute('iLight').data.array.slice(0, m.geometry.instanceCount * 8)] };
    };
    const game = (e) => [rec(e, 0, L.READY), rec(e, 1, L.BUSY), rec(e, 2, L.EMPTY), rec(e, 3, L.DARK)];
    // rekord lustra jak applyTurrets (render.worker.js): pola z migawki, pozostałe w kształcie puli
    const mirror = (e) => game(e).map((r) => ({ entity: e, key: r.key, uid: r.uid, weaponId: r.weaponId, fxKey: r.fxKey, wx: r.wx, wy: r.wy,
      ang: r.ang, scale: r.scale, recoil: r.recoil, shake: r.shake, spec: { r: r.spec.r }, state: { housing: 0, barrel: 0, flash: 0 },
      ready: new Int32Array([r.ready])[0] }));
    const a = run(game), b = run(mirror);
    assert.equal(a.n, 3);
    assert.deepEqual(b, a, 'ten sam obraz lampek w workerze i w trybie off');
  }
});

test('rozgrzewka: pula lampek w rejestrze (ekran ładowania, kamery z góry i 3D), WGSL partii wież z akcentami', () => {
  const src = read('src/3d/ships3d/shipModels3DGame.js');
  assert.match(src, /name: 'lampki gotowości wież', objects: lampWarm, layer: 0, phase: 'loading', variant: WARIANT_INSTANCJI/);
  assert.match(src, /name: 'lampki gotowości wież \(kamery 3D\)', objects: lampWarm, layer: 0, ortho: false, phase: 'loading'/);
  assert.match(read('src/3d/ships3d/turretBatch3D.js'), /emissiveScaleNode: turretGraph\(\)\.glow/);
});
