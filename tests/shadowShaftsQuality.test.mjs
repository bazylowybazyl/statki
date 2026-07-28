import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coreSource = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');
const planetSource = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');
const shipsSource = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');
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
  // Trzy rodziny analitycznych okluderow w shaderze passa.
  for (const uniformName of ['uDiscs', 'uCapsuleSeg', 'uCapsuleR', 'uRings', 'uSunWorld', 'uCamCenter', 'uViewWorldSize', 'uSunActive']) {
    assert.ok(coreSource.includes(uniformName), `shafts shader missing uniform ${uniformName}`);
  }
  assert.match(coreSource, /const SHAFT_DISC_CAP = 48;/);
  assert.match(coreSource, /const SHAFT_CAPSULE_CAP = 32;/);
  assert.match(coreSource, /const SHAFT_RING_CAP = 2;/);
});

test('quality levels map to shaft lengths and capsule budget', () => {
  const cfgBlock = coreSource.match(/export const SHADOW_SHAFTS_QUALITY = \{([\s\S]*?)\n\};/)?.[1] || '';
  assert.ok(cfgBlock, 'SHADOW_SHAFTS_QUALITY config missing');
  for (const level of ['off:', 'low:', 'medium:', 'high:']) {
    assert.ok(cfgBlock.includes(level), `missing quality level ${level}`);
  }
  assert.match(cfgBlock, /high:\s*\{\s*enabled:\s*true,\s*discLenMul:\s*30,\s*capsuleLenMul:\s*16,\s*capsuleBudget:\s*32/);
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

test('analytic occluders skip interiors so surfaces keep their own lighting', () => {
  // Dyski: wnetrze tarczy = oswietlenie planety; kapsuly: wnetrze kadluba =
  // terminator w shaderze heksow; ring na powierzchni planety = uRingShadow*
  // w shaderze planety (bez podwojnego liczenia w passie).
  assert.match(coreSource, /if \(along <= exitDist\) continue;/);
  assert.match(coreSource, /if \(dot\(fromHull, fromHull\) <= capR \* capR\) continue;/);
  assert.match(coreSource, /if \(!insideDisc\) \{/);
});

test('planets and moons push analytic discs every frame', () => {
  const planetPushes = planetSource.match(/Core3D\.pushShaftDiscWorld\(/g) || [];
  assert.ok(planetPushes.length >= 2, 'both DirectPlanet and DirectMoon must push disc occluders');
  assert.match(planetSource, /beginShaftDiscFrame/);
  assert.match(coreSource, /pushShaftDiscWorld\(worldX, worldY, radius\)/);
});

test('ships push size-sorted capsules from the hex update loop', () => {
  assert.match(coreSource, /pushShaftCapsuleWorld\(x1, y1, x2, y2, radius\)/);
  assert.match(shipsSource, /Core3D\.beginShaftCapsuleFrame\(\);/);
  assert.match(shipsSource, /Core3D\.pushShaftCapsuleWorld\(/);
  assert.match(shipsSource, /cands\.sort\(\(a, b\) => b\.size - a\.size\)/);
  // Ring-segmenty pomijane — pierscien ma wlasny okrag-okluder.
  assert.match(shipsSource, /entity\.isRingSegment\) continue;/);
  // Budzet kapsul wg jakosci tnie upload w render().
  assert.match(coreSource, /shaftCfg\.capsuleBudget/);
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
  assert.match(asteroidSource, /Core3D\.pushShaftDiscWorld\(cache\[i\]\.x, cache\[i\]\.y, cache\[i\]\.r\)/);
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
