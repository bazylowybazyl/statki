import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shipLightsSource = readFileSync(new URL('../src/3d/shipLights3D.js', import.meta.url), 'utf8');
const hexShipsSource = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');
const coreSource = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');

test('nav light billboards render on the FG layer with additive HDR blending', () => {
  // Warstwa 2 = renderPassFg, rysowany PO shadowShaftsPass — dzięki temu
  // światła pozycyjne przebijają cień planety, tak jak lasery.
  assert.match(shipLightsSource, /layers\.set\(2\)/);
  assert.match(shipLightsSource, /THREE\.AdditiveBlending/);
  assert.match(shipLightsSource, /depthTest:\s*false/);
});

test('FG pass stays after the shadow shafts multiply pass', () => {
  const order = coreSource.match(/this\.shadowShaftsPass,[\s\S]{0,120}this\.renderPassFg/);
  assert.ok(order, 'renderPassFg must run after shadowShaftsPass so FG emitters pierce the shadow');
});

test('hull shader and billboard shader share the NAV_LIGHT_CHASE sequence', () => {
  // Obie strony wstrzykują stałe przez glslFloat(NAV_LIGHT_CHASE.*) — zmiana
  // tempa/kierunku sekwencji w jednym miejscu nie może rozjechać drugiego.
  const chaseInject = /fract\(uTime \* \$\{glslFloat\(NAV_LIGHT_CHASE\.speed\)\} \+ /;
  assert.match(shipLightsSource, chaseInject);
  assert.match(hexShipsSource, chaseInject);
  // Znak "+" przy fazie = przebieg od dziobu (faza 1) ku rufie (faza 0).
  assert.doesNotMatch(hexShipsSource, /fract\(uTime \* [^)]*\)?- localPhase/);
});

test('hexShips3D feeds visible ships into the nav light billboard sync', () => {
  assert.match(hexShipsSource, /buildPositionLightWorldSprites\(visibleHex/);
  assert.match(hexShipsSource, /ShipLights3D\.sync\(state\.navLightSprites/);
  assert.match(hexShipsSource, /ShipLights3D\.dispose\(\)/);
});
