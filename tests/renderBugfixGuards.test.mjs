import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Strażnicy poprawek błędów z audytu rysowania (2026-09-23). Część to regexy
// w stylu repo (index.html i moduły z WebGL nie wczytają się w node), a polityka
// degradacji heks-asteroid jest testowana behawioralnie.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const indexHtml = read('index.html');

test('drawNPCPretty: rekurencja tylko gdy initHexBody dało siatkę, porażka = ponowna próba za 2 s', () => {
  const fn = indexHtml.match(/function drawNPCPretty\(ctx, npc, s\) \{[\s\S]*?\n    }\n/)?.[0] || '';
  assert.ok(fn.length > 0);
  assert.match(fn, /initHexBody\(npc, [^)]*\)\);\s*_hexInitSpentMs \+= performance\.now\(\) - nowMs;\s*if \(npc\.hexGrid\) \{[\s\S]*?drawNPCPretty\(ctx, npc, s\);\s*return;\s*\}/);
  assert.match(fn, /npc\.__hexInitRetryAtMs = nowMs \+ 2000;/);
  assert.match(fn, /!\(npc\.__hexInitRetryAtMs > nowMs\)/);
});

test('pauza: rakiety nie są aktualizowane (lot, trafienia, obrażenia)', () => {
  const paused = indexHtml.match(/if \(PAUSED\) \{[\s\S]*?requestAnimationFrame\(loop\);\s*return;\s*\}/)?.[0] || '';
  assert.ok(paused.length > 0);
  assert.doesNotMatch(paused, /rocketSystem3D\.update\(/);
});

test('paski HP/tarczy tylko przy uszkodzeniu (koniec tautologii)', () => {
  assert.match(indexHtml, /const showShield = shieldMax > 0 && shieldVal < shieldMax - 0\.5;/);
});

test('kolizje statek-asteroida w physicsStep z prawdziwym dt, nie w render()', () => {
  const render = indexHtml.match(/function render\(alpha, frameDt\) \{[\s\S]*?\n    }\n/)?.[0] || '';
  assert.ok(render.length > 0);
  assert.doesNotMatch(render, /checkShipCollisions\(/);
  assert.match(indexHtml, /stepShipAsteroidCollisions\(dt\);/);
  assert.match(indexHtml, /field\.checkShipCollisions\(ship, dt\)/);
  const field = read('src/3d/asteroidField3D.js');
  assert.match(field, /checkShipCollisions\(ship, dt = 1 \/ 60\)/);
  assert.match(field, /DestructorSystem\.collideEntities\(ship, promotedEntity, dt, true\)/);
});

// Fala z refrakcją (window.trigger3DShockwave) zostaje wyłącznie dla rakiet
// supernova (decyzja 2026-09-24): Yamato, wybuchy reaktorów i rozpad stacji jej
// nie odpalają. Zapas heatHaze w reactorblow zostaje w kodzie (profile go
// wyłączają) — pilnujemy, żeby po włączeniu był w osi sceny, jak u rakiet.
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

test('haze reaktora i rakiet w osi sceny (y3d = -yGry); fala z refrakcją tylko dla supernovy', () => {
  assert.match(read('src/effects3d/reactorblow.js'), /pushHeatHazeWorld\(expX, -expZ, -4,/);
  assert.match(read('src/effects3d/rocketSystem3D.js'), /pushHeatHazeWorld\(burst\.x, -burst\.z, -4,/);
  assert.doesNotMatch(code('src/effects3d/yamato.js'), /trigger3DShockwave|sw3d\(/, 'Yamato bez fali');
  assert.doesNotMatch(code('src/effects3d/reactorblow.js'), /shockwave3D: \{|heatHaze: \{/, 'wybuchy reaktorów bez fali i haze');
  for (const f of ['stationChainProfile', 'stationCutProfile', 'stationFinalProfile']) {
    assert.doesNotMatch(code(`src/effects3d/reactorProfiles/${f}.js`), /shockwave3D: \{|heatHaze: \{/, f);
  }
  assert.match(indexHtml, /Destruction3D\.init\(\{[\s\S]{0,400}?shockwaveManager: null,/, 'rozpad stacji bez fali');
  assert.match(code('src/effects3d/rocketSystem3D.js'), /explosionStyle === "supernova"\) \{\s*const triggerShockwave = window\.trigger3DShockwave;/);
});

test('bloom overlaya: efekty tylko przez modyfikatory, bez zapisu/przywracania bazy', () => {
  const overlay = read('src/effects3d/overlay.js');
  assert.match(overlay, /setBloomModifier: \(key, modifier\) =>/);
  assert.match(overlay, /clearBloomModifier: \(key\) =>/);
  const yamato = read('src/effects3d/yamato.js');
  assert.match(yamato, /overlay\.setBloomModifier\(lease, YAMATO_BLOOM_SUPPRESSION\)/);
  assert.doesNotMatch(yamato, /setBloomConfig|__yamatoBloomSuppression/);
  const nova = read('src/effects3d/supernovaMissileBlow.js');
  assert.doesNotMatch(nova, /_savedBloom|_activeNovaCount|setBloomConfig/);
  assert.match(nova, /_restoreBloom\(bloomLease\)/);
});

test('updateEntityMesh: po przebudowie mesh wskazuje nowy obiekt; nowe dane przed zwolnieniem starych', () => {
  const hex = read('src/3d/hexShips3D.js');
  const fn = hex.match(/function updateEntityMesh\(entity, data, camX, camY, cameraZoom\) \{[\s\S]*?\n}\n/)?.[0] || '';
  assert.ok(fn.length > 0);
  assert.match(fn, /let mesh = data\.mesh;/);
  assert.match(fn, /data = createEntityMesh\(entity\);\s*disposeMeshData\(previous\);\s*if \(!data\) return;\s*mesh = data\.mesh;/);
  assert.match(fn, /data\.armorImageRef !== \(grid\.armorImage \|\| null\)/);
});

test('wraki/fragmenty: LOD smugi i cienie z zasięgu aktywnych heksów, nie ze sprite rodzica', () => {
  const hex = read('src/3d/hexShips3D.js');
  assert.match(hex, /function getGridActiveExtent\(grid, nowMs\)/);
  assert.match(hex, /const extent = getGridActiveExtent\(grid, state\.lastTime\);\s*const bodyRadiusPx = Math\.max\(extent\.halfW/);
  assert.match(hex, /const halfW = extent\.halfW \* lodScaleX;/);
  assert.match(hex, /const ext = getGridActiveExtent\(grid, now\);/, 'selekcja cieni wraków/fragmentów');
});

test('panel skanera: przyciski akcji budowane raz na cel (klik nie ginie), schowany panel nie renderuje', () => {
  const src = read('src/ui/scannerOverviewUI.js');
  assert.match(src, /if \(detailBuiltFor !== target\) \{/);
  assert.match(src, /if \(runtime\.enabled === false\) return;\s*render\(\);/);
});

test('cząstki rakiet: zakresy uploadu kumulowane, zawinięcie bez pełnego bufora', () => {
  for (const path of ['src/effects3d/rocketFireGPU.js', 'src/effects3d/rocketSmokeGPU.js']) {
    const src = read(path);
    assert.doesNotMatch(src, /clearUpdateRanges\(\);\s*attr\.addUpdateRange\(start, count\);/, path);
    assert.match(src, /if \(this\.activeIndex === 0\) this\._pushDirtySpan\(\);/, path);
    assert.doesNotMatch(src, /_dirtyWrapped/, path);
  }
});

test('destrukcja stacji nie rusza zasobów szablonu GLB', () => {
  assert.match(read('src/3d/stations3D.js'), /o\.geometry\.userData\.__sharedTemplateAsset = true;/);
  const d3 = read('src/vfx/destruction3D.js');
  assert.match(d3, /child\.material = Array\.isArray\(child\.material\)\s*\? child\.material\.map\(_cloneOwnedMaterial\)\s*: _cloneOwnedMaterial\(child\.material\);/);
  const debris = read('src/vfx/destructionDebrisManager.js');
  assert.match(debris, /!child\.geometry\.userData\?\.__sharedTemplateAsset/);
  assert.match(debris, /!m\.userData\?\.__sharedTemplateAsset/);
});

// ── Heks-asteroidy: degradacja i zwalnianie areny (behawioralnie) ────────────

async function makeField() {
  const { AsteroidField } = await import('../src/3d/asteroidField3D.js');
  const field = Object.create(AsteroidField.prototype);
  field.sunX = 0;
  field.sunY = 0;
  field._beltBandList = [{ minR: 100000, maxR: 120000 }];
  field.activeHexAsteroids = new Set();
  field.activeHexById = new Map();
  field._hexDemoteBuffer = [];
  field._nextHexDemoteCheckMs = 0;
  field.shown = [];
  field._showAsteroidInstance = (a) => { field.shown.push(a); a._instancedHidden = false; };
  return field;
}

function makeHexAsteroid(overrides = {}) {
  const asteroid = { id: 7, alive: true, worldX: 110000, worldY: 0, scale: 400, _instancedHidden: true };
  const entity = {
    asteroidRef: asteroid,
    vx: 0,
    vy: 0,
    __shipNearMs: 0,
    __promotedAtMs: 0,
    hexGrid: { shards: new Array(10).fill({}), activeStructuralCount: 10, baseStructuralCount: 10 }
  };
  asteroid.hexEntity = entity;
  Object.assign(entity, overrides);
  return { asteroid, entity };
}

function withWindow(camera, fn) {
  const prev = globalThis.window;
  globalThis.window = { innerWidth: 1920, innerHeight: 1080, camera, splitScreenMode: false };
  try { return fn(); } finally {
    if (prev === undefined) delete globalThis.window;
    else globalThis.window = prev;
  }
}

test('pasma pasów: statek daleko od pasów nie robi zapytania kolizji', async () => {
  const field = await makeField();
  assert.equal(field._isNearAnyBelt(110000, 0, 1000), true);
  assert.equal(field._isNearAnyBelt(50000, 0, 1000), false);
  assert.equal(field._isNearAnyBelt(0, 125000, 9000), true, 'margines obejmuje dryf');
  field._beltBandList = [];
  assert.equal(field._isNearAnyBelt(0, 0, 0), true, 'bez danych o pasmach — zachowawczo');
});

test('degradacja: tylko nietknięta, stojąca, bezczynna i poza kadrem', async () => {
  const field = await makeField();
  const farCam = { x: 0, y: 0, zoom: 1 };
  const nowMs = 60000;
  withWindow(farCam, () => {
    const ok = makeHexAsteroid();
    assert.equal(field._canDemoteHexAsteroid(ok.entity, nowMs), true);

    const damaged = makeHexAsteroid();
    damaged.entity.hexGrid.activeStructuralCount = 9;
    assert.equal(field._canDemoteHexAsteroid(damaged.entity, nowMs), false, 'uszkodzonej nie ruszamy');

    const recent = makeHexAsteroid({ __shipNearMs: nowMs - 1000 });
    assert.equal(field._canDemoteHexAsteroid(recent.entity, nowMs), false, 'statek był niedawno obok');

    const moving = makeHexAsteroid({ vx: 30 });
    assert.equal(field._canDemoteHexAsteroid(moving.entity, nowMs), false, 'wciąż dryfuje');
  });
  withWindow({ x: 110000, y: 0, zoom: 1 }, () => {
    const visible = makeHexAsteroid();
    assert.equal(field._canDemoteHexAsteroid(visible.entity, nowMs), false, 'bez podmiany na oczach gracza');
  });
});

test('degradacja zwalnia encję: dead, poza listami, instancja z powrotem widoczna', async () => {
  const field = await makeField();
  const { asteroid, entity } = makeHexAsteroid();
  field.activeHexAsteroids.add(entity);
  field.activeHexById.set(asteroid.id, entity);
  withWindow({ x: 0, y: 0, zoom: 1 }, () => field._demoteIdleHexAsteroids(60000));
  assert.equal(entity.dead, true);
  assert.equal(entity.isCollidable, false);
  assert.equal(field.activeHexAsteroids.size, 0);
  assert.equal(field.activeHexById.size, 0);
  assert.equal(asteroid.hexEntity, null);
  assert.deepEqual(field.shown, [asteroid]);
});
