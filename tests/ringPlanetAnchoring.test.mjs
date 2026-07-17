import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coreSource = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');
const planetSource = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('ring planets render through their own orthographic pass before world and foreground', () => {
  assert.match(coreSource, /const\s+RING_PLANET_RENDER_LAYER\s*=\s*6\s*;/);
  assert.match(coreSource, /renderPassRingPlanets\s*=\s*new\s+RenderPass\(this\.scene,\s*this\.cameraOrtho\)/);
  assert.match(coreSource, /makeSplitScreenRenderPass\(this\.renderPassRingPlanets,\s*RING_PLANET_RENDER_LAYER,\s*true,\s*false\)/);

  const scenePassList = coreSource.match(/_scenePasses\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
  const ringPassIndex = scenePassList.indexOf('this.renderPassRingPlanets');
  const worldPassIndex = scenePassList.indexOf('this.renderPassOrtho');
  const foregroundPassIndex = scenePassList.indexOf('this.renderPassFg');
  assert.ok(ringPassIndex >= 0, 'ring-planet pass is not part of the scene pass chain');
  assert.ok(worldPassIndex >= 0 && foregroundPassIndex >= 0, 'scene pass chain is missing world/foreground passes');
  assert.ok(ringPassIndex < worldPassIndex, 'ring planets must render below the orthographic world');
  assert.ok(ringPassIndex < foregroundPassIndex, 'ring planets must render below the foreground ring');
});

test('Earth and Mars use physical radius and keep atmosphere in the anchored pass', () => {
  assert.match(planetSource, /RING_PLANET_NAMES\s*=\s*new\s+Set\(\['earth',\s*'mars'\]\)/);
  assert.match(planetSource, /this\.isRingAnchored\s*=\s*RING_PLANET_NAMES\.has\(this\.name\)/);
  assert.match(planetSource, /const\s+scale\s*=\s*anchoredToRing[\s\S]*?resolveRingPlanetWorldRadius\(this\.data\)/);
  assert.match(planetSource, /anchoredToRing\s*\?\s*RING_PLANET_VISUAL_Z\s*:\s*-50000/);
  assert.match(planetSource, /if\s*\(this\.isRingAnchored\)\s*\{[\s\S]*?enableRingPlanetLayer\(this\.group\)/);
  assert.match(planetSource, /const\s+visualRadius\s*=\s*RING_PLANET_NAMES\.has\(key\)[\s\S]*?resolveRingPlanetWorldRadius\(planet\)/);
});

test('planet halo has a compact shell and no noisy alpha outside the rim', () => {
  assert.match(planetSource, /HALO_DEFAULTS\s*=\s*Object\.freeze\(\{\s*sizeMul:\s*0\.985/);
  const atmosphereFragment = planetSource.match(/const\s+ATMOSPHERE_FRAGMENT\s*=\s*`([\s\S]*?)`;/)?.[1] || '';
  assert.ok(atmosphereFragment, 'atmosphere fragment shader was not found');
  assert.doesNotMatch(atmosphereFragment, /hash12|gl_FragCoord/);
  assert.match(atmosphereFragment, /if\s*\(alpha\s*<=\s*0\.001\)\s*discard/);
});

test('anchored planet culling checks both split-screen cameras in game coordinates', () => {
  assert.match(planetSource, /isCircleVisibleInGameCamera/);
  assert.match(planetSource, /const\s+visiblePrimary\s*=\s*isCircleVisibleInGameCamera/);
  assert.match(planetSource, /if\s*\(splitScreen\)\s*\{[\s\S]*?visibleSecondary\s*=\s*isCircleVisibleInGameCamera/);
  assert.match(planetSource, /offScreen\s*=\s*!visiblePrimary\s*&&\s*!visibleSecondary/);
});

test('planet visibility culling uses hysteresis to absorb camera shake at screen edges', () => {
  assert.match(planetSource, /this\._visibilityCulled\s*=\s*false/);
  assert.match(planetSource, /const\s+cullMarginPx\s*=\s*this\._visibilityCulled\s*\?\s*24\s*:\s*72/);
  assert.match(planetSource, /const\s+primaryCullRadius\s*=\s*worldCullRadius\s*\+\s*cullMarginPx/);
  assert.match(planetSource, /const\s+ndcPad\s*=\s*this\._visibilityCulled\s*\?\s*0\.025\s*:\s*0\.08/);
  assert.match(planetSource, /this\._visibilityCulled\s*=\s*offScreen/);
});

test('Earth moon shares the anchored scale and render pass', () => {
  assert.match(planetSource, /this\.isRingAnchored\s*=\s*RING_PLANET_NAMES\.has\(parentKey\)/);
  assert.match(planetSource, /const\s+parentR\s*=\s*this\.isRingAnchored[\s\S]*?resolveRingPlanetWorldRadius\(this\.parentData\)/);
  assert.match(planetSource, /if\s*\(this\.isRingAnchored\)\s*enableRingPlanetLayer\(this\.group\)/);
  assert.match(planetSource, /moonR\s*\*\s*\(this\.isRingAnchored\s*\?\s*1\s*:\s*PLANET_SIZE_MULTIPLIER\)/);
});

test('moons rotate visibly and receive a correctly layered halo', () => {
  assert.match(planetSource, /spinPeriodSec:\s*72/);
  assert.match(planetSource, /this\.spinSpeed\s*=\s*\(Math\.PI\s*\*\s*2\)\s*\/\s*spinPeriodSec/);
  assert.match(planetSource, /this\.mesh\.rotation\.y\s*=\s*\(this\.mesh\.rotation\.y\s*\+\s*this\.spinSpeed/);
  assert.match(planetSource, /this\.halo\s*=\s*new\s+THREE\.Mesh/);
  assert.match(planetSource, /enablePlanetHaloLayer\(this\.halo\)/);
  assert.match(planetSource, /this\.halo\.scale\.set\(scale,\s*scale,\s*scale\)/);
  assert.match(planetSource, /this\.halo\.material\.uniforms\.sunPosition\.value\.set/);
});

test('Earth and Mars stations orbit outside their rings without offsetting initial player spawn', () => {
  assert.match(gameSource, /const\s+hasPlanetaryRing\s*=\s*stationPlanetKey\s*===\s*'earth'\s*\|\|\s*stationPlanetKey\s*===\s*'mars'/);
  assert.match(gameSource, /computeRingStationOrbitRadius\(pl\)/);
  assert.match(gameSource, /x:\s*planet\.x\s*\+\s*Math\.cos\(spawnAngle\)\s*\*\s*spawnOrbitRadius/);
  assert.match(gameSource, /y:\s*planet\.y\s*\+\s*Math\.sin\(spawnAngle\)\s*\*\s*spawnOrbitRadius/);
});
