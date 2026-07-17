import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coreSource = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');
const planetSource = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');
const shipsSource = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');
const ringSource = readFileSync(new URL('../src/3d/planetaryRing3D.js', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('shadow shafts quality levels expose the pre-nerf high preset', () => {
  const cfgBlock = coreSource.match(/export const SHADOW_SHAFTS_QUALITY = \{([\s\S]*?)\n\};/)?.[1] || '';
  assert.ok(cfgBlock, 'SHADOW_SHAFTS_QUALITY config missing');
  for (const level of ['off:', 'low:', 'medium:', 'high:']) {
    assert.ok(cfgBlock.includes(level), `missing quality level ${level}`);
  }
  assert.match(cfgBlock, /high:\s*\{\s*enabled:\s*true,\s*samples:\s*50,\s*resDiv:\s*2,\s*overscan:\s*3\.0/,
    'high must restore 50 samples, half-res mask and 3.0 overscan');
  assert.match(coreSource, /setShadowShaftsQuality\(level = 'medium'\)/);
  assert.match(coreSource, /resolveShadowShaftsQuality/);
  // NUM_SAMPLES musi byc definem (podmienialny przez material.defines), nie stala.
  assert.match(coreSource, /#ifndef NUM_SAMPLES/);
  assert.doesNotMatch(coreSource, /const int NUM_SAMPLES/);
});

test('shadow shafts multiply pass runs after every scene pass', () => {
  const scenePassList = coreSource.match(/_scenePasses\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
  const shaftsIndex = scenePassList.indexOf('this.shadowShaftsPass');
  const fgIndex = scenePassList.indexOf('this.renderPassFg');
  const ringIndex = scenePassList.indexOf('this.renderPassRingPlanets');
  const orthoIndex = scenePassList.indexOf('this.renderPassOrtho');
  assert.ok(shaftsIndex >= 0, 'shadow shafts pass missing from scene chain');
  assert.ok(shaftsIndex > fgIndex && shaftsIndex > ringIndex && shaftsIndex > orthoIndex,
    'shadow shafts must multiply the whole scene (last pass), not only bg+planets');
});

test('occlusion pre-pass renders ortho occluders (ships, ring floor)', () => {
  assert.match(coreSource, /const OCCLUSION_ORTHO_RENDER_LAYER = 7;/);
  assert.match(coreSource, /enableOrthoOccluder3D\(object3d\)/);
  const orthoOccluderRenders = coreSource.match(/cameraOrtho\.layers\.set\(OCCLUSION_ORTHO_RENDER_LAYER\);\s*\n\s*this\.renderer\.render\(this\.scene, this\.cameraOrtho\);/g) || [];
  assert.ok(orthoOccluderRenders.length >= 3,
    `expected ortho occluder render in split-left, split-right and single viewport (got ${orthoOccluderRenders.length})`);
  assert.match(shipsSource, /Core3D\.enableOrthoOccluder3D\(mesh\);/);
  assert.match(ringSource, /enableRingShaftOccluders\(\)/);
  // Marsz startuje POL KROKU W STRONE slonca — piksel nie sampluje wlasnego
  // okludera (efekt "pol na pol" na statkach, jasna dzienna strona planet).
  assert.match(coreSource, /stepVec \* \(jitter \+ 0\.5\)/);
  assert.doesNotMatch(coreSource, /jitter - 0\.35/);
  // Akumulacja MAX z falloffem — srednia po calym marszu kasowala cien
  // okludera mniejszego niz krok (statek przy oddalonej kamerze).
  assert.match(coreSource, /shadowAccum = max\(shadowAccum,/);
  assert.doesNotMatch(coreSource, /min\(totalWeight, 4\.0\)/);
});

test('armor-LOD ships keep casting via sprite occluder pass', () => {
  // Przy LOD HYBRID/IMPOSTOR heksy wnetrza znikaja (zostaje obrys) — sylwetke
  // do maski daje quad z alfa sprite'a, renderowany BEZ bialego override'u.
  assert.match(coreSource, /const OCCLUSION_SPRITE_RENDER_LAYER = 8;/);
  assert.match(coreSource, /enableSpriteOccluder3D\(object3d\)/);
  const spritePassRenders = coreSource.match(/overrideMaterial = null;\s*\n\s*this\.cameraOrtho\.layers\.set\(OCCLUSION_SPRITE_RENDER_LAYER\);\s*\n\s*this\.renderer\.render\(this\.scene, this\.cameraOrtho\);\s*\n\s*this\.scene\.overrideMaterial = this\.occlusionWhiteMaterial;/g) || [];
  assert.ok(spritePassRenders.length >= 3,
    `expected sprite-occluder render in split-left, split-right and single viewport (got ${spritePassRenders.length})`);
  assert.match(shipsSource, /armorMesh\.add\(armorOccluder\);/);
  assert.match(shipsSource, /Core3D\.enableSpriteOccluder3D\(armorOccluder\);/);
  assert.match(shipsSource, /data\.armorOccluder\?\.material\?\.dispose\?\.\(\);/);
});

test('planets and moons cast analytic disc shadows independent of zoom', () => {
  // Planety NIE sa w masce screen-space (znikajacy cien przy przyblizeniu,
  // przyciemniona dzienna strona) — zamiast tego dyski world-space w shaderze.
  assert.doesNotMatch(planetSource, /enablePlanetOcclusion\(/);
  assert.doesNotMatch(planetSource, /enableOrthoOcclusion\(/);
  const planetPushes = planetSource.match(/Core3D\.pushShaftDiscWorld\(/g) || [];
  assert.ok(planetPushes.length >= 2, 'both DirectPlanet and DirectMoon must push disc occluders');
  assert.match(planetSource, /beginShaftDiscFrame/);
  assert.match(coreSource, /const SHAFT_DISC_CAP = 16;/);
  assert.match(coreSource, /pushShaftDiscWorld\(worldX, worldY, radius\)/);
  for (const uniformName of ['uDiscs', 'uDiscCount', 'uDiscLenMul', 'uSunWorld', 'uCamCenter', 'uViewWorldSize']) {
    assert.ok(coreSource.includes(uniformName), `shafts shader missing uniform ${uniformName}`);
  }
  // Wnetrze tarczy pomijane — dzienna strona planety zostaje przy wlasnym oswietleniu.
  assert.match(coreSource, /if \(along <= exitDist\) continue;/);
});

test('ring casts an analytic shadow band on anchored planets', () => {
  for (const uniformName of ['uRingShadowStrength', 'uRingShadowRadius', 'uRingShadowReach', 'uRingShadowCenter']) {
    const uses = planetSource.split(uniformName).length - 1;
    assert.ok(uses >= 3, `${uniformName} must exist in uniforms and shaders (got ${uses} uses)`);
  }
  assert.match(planetSource, /computePlanetaryRingLayout\(this\.data\)/);
  assert.match(planetSource, /setRingShadowParams\(radius, reach, strength\)/);
});

test('escape menu exposes off/low/medium/high shadow shafts option', () => {
  for (const level of ['off', 'low', 'medium', 'high']) {
    assert.ok(gameSource.includes(`data-shaft-q="${level}"`), `missing menu chip for ${level}`);
  }
  assert.match(gameSource, /sc_shadow_shafts/);
  assert.match(gameSource, /window\.Core3DShaftQuality/);
  assert.match(gameSource, /shadowShafts:\s*'medium'/);
  // Presety: fast -> low, ultrafast -> off, base -> zapisany poziom.
  assert.match(gameSource, /setShadowShaftsQuality\?\.\('low'\)/);
  assert.match(gameSource, /setShadowShaftsQuality\?\.\('off'\)/);
  assert.match(gameSource, /setShadowShaftsQuality\?\.\(window\.OPTIONS\?\.shadowShafts \|\| 'medium'\)/);
});
