import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Modele 3D statków i broni w grze 2D (opcje nowej gry „Statki 2D / 3D”, „Bronie 2D / 3D”, 2026-09-30):
// wybór wyglądu, skóra modelu na kratownicy kadłuba 2D, warstwy głębi i wpięcie w index.html.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('VisualMode: domyślnie 2D / 2D, wybór zapamiętany w localStorage', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  try {
    const { VisualMode } = await import('../src/game/visualMode.js');
    VisualMode.load();
    assert.equal(VisualMode.ships3D, false);
    assert.equal(VisualMode.weapons3D, false);
    VisualMode.set('ships', true);
    VisualMode.set('weapons', false);
    assert.equal(store.get('sc_ships3d'), '1');
    assert.equal(store.get('sc_weapons3d'), '0');
    VisualMode.ships3D = false;
    VisualMode.load();
    assert.equal(VisualMode.ships3D, true);
    assert.equal(VisualMode.label(), 'statki 3D, bronie 2D');
  } finally {
    delete globalThis.localStorage;
  }
});

test('skóra modelu: kratownica 2D, aLat od środka sprite\'a, z = 0, kotwica w komórce z węzłem', async () => {
  const THREE = await import('three/webgpu');
  const { hullSkinLattice, buildHullSkinGeometry } = await import('../src/3d/ships3d/hullSkin3D.js');
  // Kratownica 6 × 4 komórek po 15 j., węzły tylko w kolumnach 1–4 (jedna warstwa, iz = 0).
  const ix = [], iy = [], iz = [];
  for (let y = 0; y < 4; y++) for (let x = 1; x <= 4; x++) { ix.push(x); iy.push(y); iz.push(0); }
  const structure = { cellSize: 15, dims: { x: 6, y: 4, z: 1 }, nodeStore: { count: ix.length, ix, iy, iz } };
  const lat = hullSkinLattice(structure, 45, 30); // środek sprite'a 45 / 30 j. od latticeMin
  assert.deepEqual(lat.dims, { x: 6, y: 4, z: 1 });
  assert.equal(lat.occ[0], 0);
  assert.equal(lat.occ[1], 1);
  assert.equal(lat.occ[5 + 3 * 6], 0);
  // Mały trójkąt w środku sprite'a na wysokości 40 j. (model: początek = środek sprite'a).
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 40, 2, 0, 40, 0, 2, 40]), 3));
  const skin = buildHullSkinGeometry(g, lat, 1);
  const L = skin.attributes.aLat, O = skin.attributes.aOwn;
  assert.ok(Math.abs(L.getX(0) - (45 / 15 - 0.5)) < 1e-6);
  assert.ok(Math.abs(L.getY(0) - (30 / 15 - 0.5)) < 1e-6);
  for (let i = 0; i < L.count; i++) assert.equal(L.getZ(i), 0, 'jedna warstwa: cała wysokość modelu nad węzłem');
  const ox = O.getX(0), oy = O.getY(0);
  assert.equal(lat.occ[ox + oy * 6], 1, 'kotwica widoczności w komórce pierwotnej konstrukcji');
  assert.equal(skin.attributes.position.getZ(0), 40, 'wysokość modelu bez zmian (FFD tylko w x/y węzłów)');
});

test('warstwy głębi modeli: kadłub pod strugą MAIN i efektami, nad skałami pasa; wieże nad kadłubem', async () => {
  const { SLAB_HULL, SLAB_TURRET_ON_MODEL, SLAB_TURRET_ON_SPRITE } = await import('../src/3d/ships3d/modelSlabDepth.js');
  const MAIN_EXHAUST_Z = -5; // src/3d/mainExhaust3D.js
  const FX_WASH_Z = 2;       // src/3d/fxParticles3D.js
  assert.match(read('src/3d/mainExhaust3D.js'), /export const MAIN_EXHAUST_Z = -5\.0;/);
  assert.match(read('src/3d/fxParticles3D.js'), /export const FX_WASH_Z = 2;/);
  assert.ok(SLAB_HULL.hi < MAIN_EXHAUST_Z, 'struga i poświata dysz nad kadłubem modelu (jak spod sprite\'a)');
  assert.ok(SLAB_HULL.lo > -11, 'skały PLAY (szczyt ≤ −0,45 r, r ≥ 40) pod kadłubem');
  assert.ok(SLAB_TURRET_ON_MODEL.lo > SLAB_HULL.hi && SLAB_TURRET_ON_MODEL.hi < 0, 'wieże nad pokładem, pod skórami sprite\'ów');
  assert.ok(SLAB_TURRET_ON_SPRITE.lo > 0 && SLAB_TURRET_ON_SPRITE.hi < FX_WASH_Z, 'wieże na sprite\'ach nad skórą, pod efektami');
});

test('index.html: wybór w „Nowej grze”, skóra sprite\'a i wieżyczki kanwy oddane modelom, klatka po kadłubach', () => {
  const html = read('index.html');
  assert.match(html, /data-visual-ships="0">2D<\/button>/);
  assert.match(html, /data-visual-weapons="1">3D<\/button>/);
  // Predykat skóry: model z opcji „Statki 3D” albo z kamery 3D (setShipModels3DView) — shipModel3DIdFor;
  // ciała świata (budowle i ich odłamy, hull.world) rysuje skóra brył — src/3d/worldBodies3D.js.
  assert.match(html, /setBeamSkinSuppressor\(\(e\) => !!e\.beamHull\?\.world \|\| !!shipModel3DIdFor\(e\)\);/);
  assert.match(html, /setShipModels3DView\(View3D\.active\);/);
  assert.match(html, /if \(!View3D\.active\) Turret2D\.draw\(ctx, cam\);/);
  assert.match(html, /Turret2D\.skipDraw = \(rec\) => VisualMode\.weapons3D && !!WEAPON3D_FAMILY\[rec\.weaponId\];/);
  // modele bez bytów ukrytych w mgle wojny (renderSeen — lista po fogSeenInto, src/game/fogOfWar.js)
  assert.match(html, /updateHexShips3D\(cam, renderEntities, _hexCullInfo, coldWrecks\);\s*\/\/[^\n]*\n\s*syncShipModels3D\(\{ entities: renderSeen,/);
  // Rozgrywka bez zmian: kadłuby dalej ze sprite'a (HullBodies.createHull), bez gałęzi 3D.
  assert.match(html, /HullBodies\.createHull\(npc, \(hexInit\?\.image \|\| sprite\.image\), \{ visualImage: sprite\.image, hullProfileId: getNpcHullRenderProfileId\(npc\) \}\);/);
  // Kamery 3D to sam widok: bez kadłubów 3D, lotu w pionie i 6DoF (wycofana gra 3D).
  assert.doesNotMatch(html, /createHull3D|setFlight3DSixDof|stepSixDof|flight3DLiftInput|setShotQueryZ/);
  const hex = read('src/3d/hexShips3D.js');
  assert.match(hex, /if \(beam && beamSkinSuppressor !== null && beamSkinSuppressor\(entity\)\) continue;/);
  const turret = read('src/vfx/turret2D.js');
  assert.match(turret, /if \(skipDraw !== null && skipDraw\(rec\)\) continue;/);
});

test('kamery 3D: sam widok, domyślnie kamera klasyczna, bez 6DoF', async () => {
  const { Game3D } = await import('../src/game/game3D.js');
  Game3D.load();
  assert.equal(Game3D.rig.mode, 'classic', 'nowa gra zaczyna się w kamerze z góry (gra 2D)');
  assert.equal(Game3D.isFree(false), false);
  assert.equal('setSixDof' in Game3D, false);
  Game3D.setCamera('chase');
  assert.equal(Game3D.isFree(false), true);
  assert.equal(Game3D.isFree(true), false, 'podzielony ekran — zawsze kamera klasyczna');
  Game3D.setCamera('classic');
  const src = readFileSync(new URL('../src/game/game3D.js', import.meta.url), 'utf8');
  assert.match(src, /const STORE_CAM = 'sc_camera3d';/, 'nowy klucz — zapis z wycofanej gry 3D nie startuje w pościgu');
});

// Kamera 3D (free3d) pisze w Core3D.cameraPersp swoje FOV, near i far. Gałąź płaska syncCamera ich nie
// przywracała: po pełnym obiegu K (ostatnia — kinowa, 50°) kamera z góry zostawała przy 50°, więc warstwy
// poza z = 0 (mgławica z = −150 000, planety tła z = −50 000) rysowały się ~1,5× mniejsze.
test('kamera klasyczna po kamerze 3D: kamera perspektywy z góry jak przed K (FOV, near, far, wysokość)', async () => {
  const THREE = await import('three/webgpu');
  const { Core3D } = await import('../src/3d/core3d.js');
  const { Game3D } = await import('../src/game/game3D.js');
  const saved = { isInitialized: Core3D.isInitialized, cameraOrtho: Core3D.cameraOrtho, cameraPersp: Core3D.cameraPersp };
  const W = 1600, H = 900;
  const flat = { x: 5995825, y: 6645262, zoom: 0.2 };
  const frame = () => Game3D.frame({ dt: 1 / 60, W, H, zoom: flat.zoom, focusX: flat.x, focusY: flat.y, ship: { x: flat.x, y: flat.y }, heading: 0 });
  const pose = () => {
    const p = Core3D.cameraPersp;
    return { fov: p.fov, near: p.near, far: p.far, z: p.position.z, proj: [...p.projectionMatrix.elements] };
  };
  try {
    Core3D.isInitialized = true;
    Core3D.cameraOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400000);
    Core3D.cameraPersp = new THREE.PerspectiveCamera(35, W / H, 100, 500000);
    Core3D.syncCamera(flat, W, H);
    const before = pose();
    assert.equal(before.fov, 35);
    assert.ok(Math.abs(before.z - (H / 2) / Math.tan(17.5 * Math.PI / 180) / flat.zoom) < 1e-6, 'z = 0 jak w kamerze ortho');

    Game3D.setCamera('cinema');
    const cam3d = frame();
    assert.ok(Core3D.isFreePerspectiveCamera(cam3d));
    assert.notEqual(cam3d.fov, 35);
    Core3D.syncCamera(cam3d, W, H);
    assert.equal(Core3D.cameraPersp.fov, cam3d.fov, 'kamera 3D liczy się własnym FOV');
    assert.equal(Core3D.cameraPersp.far, cam3d.far);

    Game3D.setCamera('classic');
    assert.equal(frame(), null);
    Core3D.syncCamera(flat, W, H);
    assert.deepEqual(pose(), before, 'po kamerze 3D kamera z góry jak przed nią');
  } finally {
    Object.assign(Core3D, saved);
    Game3D.setCamera('classic');
  }
});
