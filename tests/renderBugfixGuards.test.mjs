import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Strażnicy poprawek błędów z audytu rysowania (2026-09-23): regexy w stylu repo
// (index.html i moduły z WebGL nie wczytają się w node). Testy degradacji heks-asteroid
// odeszły ze starym polem (zadanie 21 portu WebGPU).

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

test('kolizje statek-olbrzym pasa w physicsStep z prawdziwym dt, nie w render()', () => {
  const render = indexHtml.match(/function render\(alpha, frameDt\) \{[\s\S]*?\n    }\n/)?.[0] || '';
  assert.ok(render.length > 0);
  assert.doesNotMatch(render, /collideShip\(/);
  assert.match(indexHtml, /stepShipAsteroidCollisions\(dt\);/);
  // Zadanie 21: stare pole (sprite'y + heksy) usunięte — kolizje tylko z olbrzymami pasa (SDF).
  assert.match(indexHtml, /belt\.collideShip\(ship\)/);
  assert.doesNotMatch(indexHtml, /asteroidField|OLD_ASTEROIDS_ENABLED|asteroidyStare/);
});

// Fala z refrakcją (window.trigger3DShockwave) zostaje wyłącznie dla rakiet
// supernova (decyzja 2026-09-24): Yamato, wybuchy reaktorów i rozpad stacji jej
// nie odpalają. Zapas heatHaze w reactorblow zostaje w kodzie (profile go
// wyłączają) — pilnujemy, żeby po włączeniu był w osi sceny, jak u rakiet.
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

test('haze reaktora i rakiet w osi sceny (y3d = -yGry); fala z refrakcją tylko dla supernovy', () => {
  assert.match(read('src/effects3d/reactorblow.js'), /pushHeatHazeWorld\(expX, -expZ, -4,/);
  assert.match(read('src/effects3d/rocketSystem3D.js'), /pushHeatHazeWorld\(burst\.x, -burst\.z, -4,/);
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
  assert.match(code('src/effects3d/rocketSystem3D.js'), /explosionStyle === "supernova"\) \{\s*const triggerShockwave = window\.trigger3DShockwave;/);
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
