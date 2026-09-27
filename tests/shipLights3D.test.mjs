import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shipLightsSource = readFileSync(new URL('../src/3d/shipLights3D.js', import.meta.url), 'utf8');
const hexShipsSource = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');
const hullTslSource = readFileSync(new URL('../src/3d/hexShips3D.tsl.js', import.meta.url), 'utf8');
const coreSource = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');

test('nav light billboards render on the FG layer with additive HDR blending', () => {
  // Warstwa 2 = renderPassFg, addytywnie i HDR — przebijają cień planety.
  assert.match(shipLightsSource, /layers\.set\(2\)/);
  assert.match(shipLightsSource, /THREE\.AdditiveBlending/);
  assert.match(shipLightsSource, /depthTest:\s*false/);
});

test('nav lights are emitters: the sun shadow mask never dims them', () => {
  // Cień słońca to maska czytana przez oświetlane powierzchnie; quad mnożący
  // gotowy obraz (dawniej przed FG) gasił emisję warstwy 0 pod progiem bloomu.
  assert.ok(!/sunShadowUniforms|SUN_SHADOW_GLSL|sunVisibility/.test(shipLightsSource));
  const scenePassList = coreSource.match(/_scenePasses\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
  assert.ok(scenePassList.includes('this.renderPassFg'), 'FG pass missing from the scene chain');
  assert.ok(!scenePassList.includes('this.shadowShaftsPass'), 'no image-multiply shadow pass in the scene chain');
  // Pass FG (runner Core3D, port WebGPU): warstwa 2, kamera perspektywy, własna głębia, ostatni w łańcuchu.
  assert.match(coreSource, /this\.renderPassFg = makeScenePass\('fg', 'fg', 2, false, false\);/);
  assert.ok(scenePassList.trim().endsWith('this.renderPassFg'), 'FG kładzie się na wierzchu sceny');
});

test('hull shader and billboard shader share the NAV_LIGHT_CHASE sequence', () => {
  // Obie strony biorą stałe z NAV_LIGHT_CHASE (billboardy: glslFloat w GLSL do
  // zadania 15; kadłub: węzły TSL, hexShips3D.tsl.js — port WebGPU, zadanie 04) —
  // zmiana tempa/kierunku sekwencji w jednym miejscu nie może rozjechać drugiego.
  assert.match(shipLightsSource, /fract\(uTime \* \$\{glslFloat\(NAV_LIGHT_CHASE\.speed\)\} \+ /);
  assert.match(hullTslSource, /fract\(uTime\.mul\(NAV_LIGHT_CHASE\.speed\)\.add\(localPhase\.mul\(NAV_LIGHT_CHASE\.phaseGain\)\)\)/);
  // Znak "+" przy fazie = przebieg od dziobu (faza 1) ku rufie (faza 0).
  assert.doesNotMatch(hullTslSource, /NAV_LIGHT_CHASE\.speed\)\.sub\(localPhase/);
  for (const k of ['attack', 'hold', 'release', 'rest']) assert.ok(hullTslSource.includes(`NAV_LIGHT_CHASE.${k}`), k);
});

test('hexShips3D feeds visible ships into the nav light billboard sync', () => {
  // drawHex = statki w pudle RYSOWANIA (kadr + margines); visibleHex to
  // szersze pudło rozgrzania (9 ekranów), którego billboardy nie potrzebują.
  assert.match(hexShipsSource, /buildPositionLightWorldSprites\(drawHex/);
  assert.match(hexShipsSource, /ShipLights3D\.sync\(state\.navLightSprites/);
  assert.match(hexShipsSource, /ShipLights3D\.dispose\(\)/);
});
