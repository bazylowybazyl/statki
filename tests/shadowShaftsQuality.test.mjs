import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coreSource = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');
const planetSource = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');
const shipsSource = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');
const hullSdfSource = readFileSync(new URL('../src/3d/hullShadowSdf.js', import.meta.url), 'utf8');
const ringSource = readFileSync(new URL('../src/3d/planetaryRing3D.js', import.meta.url), 'utf8');
const asteroidSource = readFileSync(new URL('../src/3d/asteroidField3D.js', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('shadow shafts are fully analytic — screen-space mask is gone', () => {
  // Maska okluzji odeszla w calosci: nie obejmowala okluderow poza kadrem
  // (cien planety znikal przy przyblizeniu), gubila male kadluby po
  // downresie+blurze i kosztowala 4 przejscia sceny na viewport.
  for (const relic of ['uOcclusionMap', 'occlusionTarget', 'occlusionWhiteMaterial', 'OCCLUSION_RENDER_LAYER', 'OCCLUSION_ORTHO_RENDER_LAYER', 'OCCLUSION_SPRITE', 'NUM_SAMPLES', 'createSeparableBlurMaterial']) {
    assert.ok(!coreSource.includes(relic), `mask relic still present in core3d.js: ${relic}`);
  }
  // Trzy rodziny analitycznych okluderow w shaderze passa: dyski, kadluby
  // (pole odleglosci sylwetki) i pierscienie.
  for (const uniformName of ['uDiscs', 'uHullA', 'uHullM', 'uHullC', 'uHullSdf', 'uHullSteps', 'uRings', 'uSunWorld', 'uCamCenter', 'uViewWorldSize', 'uSunActive']) {
    assert.ok(coreSource.includes(uniformName), `shafts shader missing uniform ${uniformName}`);
  }
  assert.match(coreSource, /const SHAFT_DISC_CAP = 48;/);
  assert.match(coreSource, /const SHAFT_HULL_CAP = HULL_SDF_SHAFT_CAP;/);
  assert.match(hullSdfSource, /export const HULL_SDF_SHAFT_CAP = 32;/);
  assert.match(coreSource, /const SHAFT_RING_CAP = 2;/);
  // Blok GLSL kadlubow wstrzykiwany przed main passa.
  assert.match(coreSource, /\$\{HULL_SDF_SHADOW_GLSL\}/);
});

test('quality levels map to shaft lengths and capsule budget', () => {
  const cfgBlock = coreSource.match(/export const SHADOW_SHAFTS_QUALITY = \{([\s\S]*?)\n\};/)?.[1] || '';
  assert.ok(cfgBlock, 'SHADOW_SHAFTS_QUALITY config missing');
  for (const level of ['off:', 'low:', 'medium:', 'high:']) {
    assert.ok(cfgBlock.includes(level), `missing quality level ${level}`);
  }
  assert.match(cfgBlock, /high:\s*\{\s*enabled:\s*true,\s*discLenMul:\s*7,\s*capsuleLenMul:\s*4,\s*capsuleBudget:\s*32,\s*hullSteps:\s*32/);
  // Kroki marszu po SDF kadluba — tylko uniform, bez rekompilacji.
  for (const level of ['off', 'low', 'medium', 'high']) {
    assert.match(cfgBlock, new RegExp(`${level}:[^\\n]*hullSteps:\\s*\\d+`), `missing hullSteps for ${level}`);
  }
  assert.match(coreSource, /uShafts\.uHullSteps\.value = Math\.max\(1, Math\.min\(HULL_SDF_MAX_STEPS, Number\(shaftCfg\.hullSteps\) \|\| 24\)\);/);
  assert.match(coreSource, /setShadowShaftsQuality\(level = 'medium'\)/);
  assert.match(coreSource, /shadowShaftsQuality: this\.shadowShaftsQuality \|\| 'medium'/);
});

test('shafts pass shades the ortho world but not FG emissives', () => {
  const scenePassList = coreSource.match(/_scenePasses\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
  const shaftsIndex = scenePassList.indexOf('this.shadowShaftsPass');
  const fgIndex = scenePassList.indexOf('this.renderPassFg');
  const ringIndex = scenePassList.indexOf('this.renderPassRingPlanets');
  const orthoIndex = scenePassList.indexOf('this.renderPassOrtho');
  assert.ok(shaftsIndex >= 0, 'shadow shafts pass missing from scene chain');
  assert.ok(shaftsIndex > ringIndex && shaftsIndex > orthoIndex,
    'shadow shafts must run after ring-planet and ortho world passes');
  assert.ok(shaftsIndex < fgIndex,
    'shadow shafts must run BEFORE the FG pass so weapon emissives stay lit in shadow');
  assert.match(coreSource, /new FullScreenBlendPass\(createShadowShaftsShader\(\), BLEND_MULTIPLY_SCENE\)/);
});

test('shields render after the shafts pass, in ortho, without clearing depth', () => {
  const shieldSource = readFileSync(new URL('../src/3d/shield3D.js', import.meta.url), 'utf8');
  const scenePassList = coreSource.match(/_scenePasses\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
  const shaftsIndex = scenePassList.indexOf('this.shadowShaftsPass');
  const shieldIndex = scenePassList.indexOf('this.renderPassShields');
  assert.ok(shieldIndex > shaftsIndex,
    'shield pass must run AFTER shadow shafts — shield glow is emissive, not a lit surface');
  // Kamera ortho (jak swiat) + BEZ czyszczenia glebi (test glebi wzgledem kadlubow).
  assert.match(coreSource, /makeSplitScreenRenderPass\(this\.renderPassShields,\s*SHIELD_RENDER_LAYER,\s*true,\s*false,\s*false\)/);
  assert.match(coreSource, /new RenderPass\(this\.scene, this\.cameraOrtho\)/);
  // Obie tarcze (obrys kadluba i banka) musza trafic na warstwe tarcz.
  const shieldLayerCalls = shieldSource.match(/Core3D\.enableShield3D\(mesh\)/g) || [];
  assert.equal(shieldLayerCalls.length, 2, 'both hull and sphere shield meshes must use the shield layer');
});

test('analytic occluders skip interiors so surfaces keep their own lighting', () => {
  // Dyski: wnetrze tarczy = oswietlenie planety; kadluby: piksel NA wlasnym
  // kadlubie (SDF < progu) = jego wlasne oswietlenie w shaderze heksow;
  // ring na powierzchni planety = uRingShadow* w shaderze planety (bez
  // podwojnego liczenia w passie).
  assert.match(coreSource, /if \(along <= exitDist\) continue;/);
  // Pomijany CALY statek, nie jedna jego czesc — lancuch kapsul pomijal
  // tylko wnetrze tej samej kapsuly i kazda cienila kadlub pod sasiednia.
  assert.match(hullSdfSource, /if \(t <= 0\.0 && hullSdfDist\(q, layer, distScale\) < wMin\) continue;/);
  assert.match(coreSource, /if \(!insideDisc\) \{/);
});

test('planets and moons push analytic discs every frame', () => {
  const planetPushes = planetSource.match(/Core3D\.pushShaftDiscWorld\(/g) || [];
  assert.ok(planetPushes.length >= 2, 'both DirectPlanet and DirectMoon must push disc occluders');
  assert.match(planetSource, /beginShaftDiscFrame/);
  assert.match(coreSource, /pushShaftDiscWorld\(worldX, worldY, radius, strength = 1\)/);
});

test('ships push size-sorted hull silhouettes from the hex update loop', () => {
  assert.match(coreSource, /pushShaftHullSdf\(packed, offset = 0\)/);
  assert.match(shipsSource, /Core3D\.beginShaftHullFrame\(\);/);
  assert.match(shipsSource, /Core3D\.pushShaftHullSdf\(shaftOccluderScratch, 0\)/);
  assert.match(shipsSource, /cands\.sort\(\(a, b\) => b\.size - a\.size\)/);
  // Ring-segmenty pomijane — pierscien ma wlasny okrag-okluder.
  assert.match(shipsSource, /entity\.isRingSegment\) continue;/);
  // Budzet kadlubow wg jakosci: hexShips3D staje na nim (nie piecze
  // sylwetek, ktorych pass nie wezmie), render() tnie na wszelki wypadek.
  assert.match(coreSource, /getShaftHullBudget\(\) \{/);
  assert.match(shipsSource, /pushed < shaftHullBudget/);
  assert.match(coreSource, /shaftCfg\.capsuleBudget/);
  // Obrot i skala okludera = mesh kadluba (rotation.z = -kat, billboard +kat).
  assert.match(shipsSource, /const rot = usesBillboardOrientation\(c\.entity\) \? rawAng : -rawAng;/);
  assert.match(shipsSource, /const renderRotation = usesBillboardOrientation\(entity\) \? entityAngle : -entityAngle;/);
});

test('hull occluder is the silhouette distance field, not a capsule chain', () => {
  // Kapsuly nie opisza kolcow, widelca dziobu ani prostokatnej rufy: krotkie
  // pasma zwijaly sie do okregow wystajacych poza kadlub (Atlas: 131 j. za
  // rufa), a promien z najszerszego punktu zostawial pas swiatla przy burcie.
  for (const relic of ['buildHullSegments', 'splitProfileIntoBands', 'HULL_SHAFT_SEGMENTS', '_shaftHullSegments']) {
    assert.ok(!shipsSource.includes(relic), `capsule relic back in hexShips3D.js: ${relic}`);
  }
  assert.ok(!coreSource.includes('HULL_SHAFT_BANDS'), 'capsule band count back in core3d.js');
  assert.ok(shipsSource.includes('HullShadowSdf.acquire(c.grid, now)'), 'hexShips3D must acquire the hull SDF layer');
  // Sylwetka = aktywne heksy ∩ alfa sprite'a (dziury po trafieniach + brak
  // szczeliny od heksow brzegowych wystajacych poza rysowana krawedz).
  assert.ok(hullSdfSource.includes('return !!s && s.active !== false && s.isDebris !== true;'));
  assert.ok(hullSdfSource.includes('sampleAlphaMap(alphaMap, sx * invW, sy * invH) < HULL_SDF_ALPHA_INSIDE'));
  // Wraki ida z puli: warstwa wazna tylko dla tej samej tablicy heksow.
  assert.ok(hullSdfSource.includes('const sameShape = entry.layer >= 0 && entry.shardsRef === shards &&'));
  // Brzeg prostokata SDF musi byc dalej niz najszerszy polcien.
  const margin = Number(hullSdfSource.match(/HULL_SDF_MARGIN_TEXELS = (\d+);/)?.[1]);
  const soft = Number(hullSdfSource.match(/HULL_SDF_SOFT_TEXELS = (\d+);/)?.[1]);
  const range = Number(hullSdfSource.match(/HULL_SDF_RANGE_TEXELS = (\d+);/)?.[1]);
  assert.ok(soft < margin && margin <= range, 'soft < margin <= range');
});

test('hull shaft starts at the hull edge and only dims the scene', () => {
  // Marsz po SDF od piksela do slonca: promien wchodzacy w kadlub tuz za
  // burta daje pelny cien, polcien rosnie z dystansem od statku.
  assert.ok(hullSdfSource.includes('float w = max(softMax * clamp(t / span, 0.0, 1.0), wMin);'));
  assert.ok(coreSource.includes('shadow = max(shadow, hullSdfShadow(worldP, d, sunDist) * ${HULL_SHADOW_STRENGTH.toFixed(2)});'));
  // Statek/asteroida tylko przygaszaja; umbra do czerni zostaje planetom.
  assert.match(coreSource, /const HULL_SHADOW_STRENGTH = 0\.55;/);
  assert.match(coreSource, /shadow = max\(shadow, edge \* fall \* max\(disc\.w, 0\.0\)\);/);
  assert.match(asteroidSource, /const ASTEROID_SHAFT_STRENGTH = 0\.5;/);
  assert.match(asteroidSource, /pushShaftDiscWorld\(cache\[i\]\.x, cache\[i\]\.y, cache\[i\]\.r, ASTEROID_SHAFT_STRENGTH\)/);
});

test('planetary rings register analytic circle occluders', () => {
  assert.match(coreSource, /setShaftRingOccluder\(key, cx, cy, radius, reach\)/);
  assert.match(coreSource, /removeShaftRingOccluder\(key\)/);
  assert.match(ringSource, /Core3D\.setShaftRingOccluder\(this\.key, this\.lastPlanetX, this\.lastPlanetY, ringMid, ringMid \* 1\.15\);/);
  assert.match(ringSource, /Core3D\.removeShaftRingOccluder\(this\.key\);/);
  // Rejestracja przed dystansowym gate'em — cien dziala przy schowanych wizualiach.
  const updateFrom = ringSource.indexOf('updateFromPlanet(planet, dt, viewCamera = null)');
  const registerAt = ringSource.indexOf('Core3D.setShaftRingOccluder(this.key');
  const gateAt = ringSource.indexOf('Ring root distance gate');
  assert.ok(updateFrom >= 0 && registerAt > updateFrom && gateAt > registerAt,
    'ring occluder must be registered before the visual distance gate');
});

test('large asteroids push analytic discs with throttled selection', () => {
  assert.match(asteroidSource, /_pushShaftOccluders\(\)/);
  assert.match(asteroidSource, /Core3D\.pushShaftDiscWorld\(cache\[i\]\.x, cache\[i\]\.y, cache\[i\]\.r, ASTEROID_SHAFT_STRENGTH\)/);
  assert.match(asteroidSource, /const MIN_RADIUS = 90;/);
  assert.match(asteroidSource, /this\._shaftFrameCounter % 4 === 1/);
  assert.ok(!asteroidSource.includes('occluderMesh'), 'asteroid sprite occluder twin should be gone');
});

test('escape menu exposes off/low/medium/high shadow shafts option', () => {
  for (const level of ['off', 'low', 'medium', 'high']) {
    assert.ok(gameSource.includes(`data-shaft-q="${level}"`), `missing menu chip for ${level}`);
  }
  assert.match(gameSource, /sc_shadow_shafts/);
  assert.match(gameSource, /window\.Core3DShaftQuality/);
  // Presety: fast -> low, ultrafast -> off, base -> zapisany poziom.
  assert.match(gameSource, /setShadowShaftsQuality\?\.\('low'\)/);
  assert.match(gameSource, /setShadowShaftsQuality\?\.\('off'\)/);
});
