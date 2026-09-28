import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Strażnicy poprawek błędów z audytu rysowania (2026-09-23). Część to regexy
// w stylu repo (index.html i moduły z WebGL nie wczytają się w node), a polityka
// degradacji heks-asteroid jest testowana behawioralnie.

// CRLF → LF: regexy niżej liczą na `\n`, a checkout z core.autocrlf daje CRLF.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const indexHtml = read('index.html');

test('drawNPCPretty: rekurencja tylko gdy powstał kadłub, porażka = ponowna próba za 2 s', () => {
  const fn = indexHtml.match(/function drawNPCPretty\(ctx, npc, s\) \{[\s\S]*?\n    }\n/)?.[0] || '';
  assert.ok(fn.length > 0);
  // Kadłub NPC na belkach (HullBodies.createHull); rekurencja rysuje nakładki gotowego kadłuba.
  assert.match(fn, /HullBodies\.createHull\(npc, [^;]*\);\s*_hexInitSpentMs \+= performance\.now\(\) - nowMs;\s*if \(npc\.beamHull\) \{[\s\S]*?drawNPCPretty\(ctx, npc, s\);\s*return;\s*\}/);
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

// Fala z refrakcją (dawne window.trigger3DShockwave) była od 2026-09-24 tylko dla rakiet
// supernova; od zadania 19 (port WebGPU) nie ma jej wcale — Yamato, wybuchy reaktorów
// i rozpad stacji jej nie odpalają, a rakiety zgłaszają źródła zniekształceń Core3D.
// Zapas heatHaze w reactorblow zostaje w kodzie (profile go wyłączają) — pilnujemy,
// żeby po włączeniu był w osi sceny.
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

// Port WebGPU, zadanie 19: fale, implozja i gorące powietrze rakiet (także Supernowej) to źródła
// zniekształceń Core3D (src/3d/fx/distortion.js) zgłaszane w ŚWIECIE gry — oś y odwraca commit
// źródeł (behawioralnie: tests/rocketFx.test.mjs); rakiety nie wołają już pushHeatHazeWorld ani
// dawnej fali trigger3DShockwave (fala Supernowej = sama refrakcja, bez świecącego obrysu).
test('haze reaktora w osi sceny (y3d = -yGry); rakiety i Supernowa przez zniekształcenia Core3D', () => {
  assert.match(read('src/effects3d/reactorblow.js'), /pushHeatHazeWorld\(expX, -expZ, -4,/);
  const rockets = code('src/effects3d/rocketSystem3D.js');
  assert.doesNotMatch(rockets, /pushHeatHazeWorld|trigger3DShockwave|makeSupernovaMissileBlow/, 'rakiety bez starego haze i fali');
  const fx = code('src/3d/rockets/effects.js');
  assert.match(fx, /field\.shock\(this\.sx\[i\] \+ S\[o \+ 6\] \* a, this\.sy\[i\] \+ S\[o \+ 7\] \* a,/, 'fala w świecie gry (x, y), nie w osi sceny');
  assert.match(fx, /field\.implode\(this\.nvx\[i\], this\.nvy\[i\],/);
  assert.match(fx, /field\.heat\(this\.hx\[i\] \+ H\[o \+ 3\] \* a, this\.hy\[i\] \+ H\[o \+ 4\] \* a,/);
  // Yamato i reszta broni (zadanie 17): receptury z dema bronie-webgpu (src/3d/weapons/) — fala
  // to zniekształcenie Core3D (pula DIST, sama refrakcja — decyzja 2026-09-27: efekty z dema),
  // nigdy dawna fala overlaya trigger3DShockwave.
  for (const f of ['recipes.js', 'weaponFx.js', 'gpuFx.js']) {
    assert.doesNotMatch(code(`src/3d/weapons/${f}`), /trigger3DShockwave|sw3d\(/, `${f}: broń bez fali overlaya`);
  }
  assert.doesNotMatch(code('src/effects3d/reactorblow.js'), /shockwave3D: \{|heatHaze: \{/, 'wybuchy reaktorów bez fali i haze');
  for (const f of ['stationChainProfile', 'stationCutProfile', 'stationFinalProfile']) {
    assert.doesNotMatch(code(`src/effects3d/reactorProfiles/${f}.js`), /shockwave3D: \{|heatHaze: \{/, f);
  }
  assert.match(indexHtml, /Destruction3D\.init\(\{[\s\S]{0,400}?shockwaveManager: null,/, 'rozpad stacji bez fali');
  assert.doesNotMatch(code('src/3d/core3d.js'), /Shockwave3DManager|trigger3DShockwave|refractionTarget/, 'Core3D bez fali z refrakcją');
});

test('dysza SIDE świeci w bloomie tylko przy manewrze (audyt 2026-09-26)', () => {
  // Barwa płomienia = rdzeń ENGINE_HDR (biały) / brzeg z kelwinów (kanał ≤ 1)
  // × bloomGain gracza (domyślnie 1,1) × ENGINE_HDR, całość × (1 + 1,5 · ciąg).
  // Przy 2,4 każda z 8 dysz bocznych Atlasa świeciła w spoczynku jak lampa,
  // a odpalona zalewała burtę białą plamą.
  const threshold = Number(read('src/3d/bloomConfig.js').match(/threshold: ([0-9.]+),/)?.[1]);
  const hdr = Number(read('src/3d/engineExhaustBatch.js').match(/const ENGINE_HDR = ([0-9.]+);/)?.[1]);
  const defaultBloomGain = Number(indexHtml.match(/vfx: \{ colorTempK: \d+, bloomGain: ([0-9.]+),/)?.[1]);
  assert.ok(threshold > 0 && hdr > 0 && defaultBloomGain > 0);
  // Filtr bloomu patrzy na luminancję: brzeg z kelwinów (domyślnie 8000 K + 4000 K · ciąg)
  // ma ją ≤ 0,90 kanału maksymalnego, rdzeń jest biały.
  const EDGE_LUM = 0.9;
  const lum = (mult) => Math.max(hdr, hdr * Math.max(1, defaultBloomGain) * EDGE_LUM) * mult;
  assert.ok(lum(1) < threshold, `pilot SIDE w spoczynku (${lum(1).toFixed(2)}) ponad progiem ${threshold}`);
  // Lot bez manewru: moveGlow ≤ 0,48 → ciąg dyszy bocznej ≤ 0,48 · 0,55.
  const cruise = lum(1 + 1.5 * 0.48 * 0.55);
  assert.ok(cruise < threshold, `dysza SIDE w samym locie (${cruise.toFixed(2)}) ponad progiem ${threshold}`);
  // Pełny manewr ma wyraźnie błysnąć.
  assert.ok(hdr * 2.5 > threshold * 1.5, `odpalona dysza SIDE (${hdr * 2.5}) ledwo nad progiem`);
});

test('bloom overlaya: efekty tylko przez modyfikatory, bez zapisu/przywracania bazy', () => {
  const overlay = read('src/effects3d/overlay.js');
  assert.match(overlay, /setBloomModifier: \(key, modifier\) =>/);
  assert.match(overlay, /clearBloomModifier: \(key\) =>/);
  // Yamato nie jest już w overlayu (zadanie 17 — receptura WeaponFx w Core3D): bez modyfikatora
  // i bez zapisu konfiguracji bloomu.
  const weaponFx = code('src/3d/weapons/weaponFx.js') + code('src/3d/weapons/recipes.js');
  assert.doesNotMatch(weaponFx, /setBloomConfig|setBloomModifier|__yamatoBloomSuppression/);
  // Supernowa (zadanie 19) nie jest już w overlayu: podbicie bloomu i przygaszenie idą przez
  // Core3D.fx.post (kasowane co klatkę efektów), bez zapisu/przywracania konfiguracji bloomu.
  const rocketFx = code('src/3d/rockets/rocketFx.js');
  assert.match(rocketFx, /if \(d\.bloomBoost > post\.bloomBoost\) post\.bloomBoost = d\.bloomBoost;/);
  assert.doesNotMatch(rocketFx, /setBloomConfig|DevVFX/);
  assert.match(code('src/3d/fx/fxFrame.js'), /this\.post\.exposure = 1;\s*this\.post\.bloomBoost = 0;/, 'post efektów kasowany co klatkę');
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

// Port WebGPU, zadanie 19: dawne RocketFireGPU / RocketSmokeGPU zastąpił dym compute z dema
// rakiet; pierścienie z wysyłką zakresów (iskry, łuki) mają test zachowania w
// tests/rocketFx.test.mjs („pierścień: zawinięcie = dwa wycinki, bez pełnego bufora”).
test('cząstki rakiet: stare pule uploadu CPU zastąpione (dym compute, pierścienie z zakresami)', () => {
  const rockets = code('src/effects3d/rocketSystem3D.js');
  assert.doesNotMatch(rockets, /RocketFireGPU|RocketSmokeGPU|fireGPU|smokeGPU/);
  assert.match(code('src/3d/rockets/smoke.js'), /this\._qRange\.count = n \* 16;/, 'zlecenia dymu: jeden zakres na stałe, tylko zapisana część');
  for (const path of ['src/3d/rockets/sparks.js', 'src/3d/rockets/arcs.js']) {
    assert.match(code(path), /import \{ ringAttr, RingUpload \} from '\.\/ringUpload\.js';/, `${path}: pierścień przez ringUpload`);
    assert.doesNotMatch(code(path), /_wrapped|addUpdateRange/, `${path}: bez pełnego bufora po zawinięciu`);
  }
  assert.match(code('src/3d/rockets/ringUpload.js'), /at\.clearUpdateRanges = \(\) => \{\};/, 'zakresy na stałe (bez push na klatkę)');
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
