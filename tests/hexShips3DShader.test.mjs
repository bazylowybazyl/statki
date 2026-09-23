import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');

function readShaderConst(name) {
  const match = source.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'));
  assert.ok(match, `Expected ${name} shader source to exist`);
  return match[1];
}

test('hex fragment shader declares sprite-size uniform used by ship lights', () => {
  const fragment = readShaderConst('HEX_FRAGMENT_SHADER');

  assert.match(fragment, /vSpriteUV\s*\*\s*uSpriteSize/);
  assert.match(fragment, /uniform\s+vec2\s+uSpriteSize\s*;/);
});

test('lakier stoi po isGlowing i przed pętlą świateł', () => {
  const fragment = readShaderConst('HEX_FRAGMENT_SHADER');
  const glowing = fragment.indexOf('float isGlowing');
  const lacquer = fragment.indexOf('float lacquerW');
  const lights = fragment.indexOf('for (int i = 0; i < MAX_SHIP_LIGHTS');
  assert.ok(glowing >= 0 && lacquer >= 0 && lights >= 0);
  // Niebieskawe odbicie przed isGlowing podbiłoby cały kadłub ×2,5.
  assert.ok(glowing < lacquer, 'lakier po isGlowing');
  // Lampy są emisyjne — lakier nie może ich przyciemniać.
  assert.ok(lacquer < lights, 'lakier przed światłami');
});

test('oba vertex shadery kadłuba podają vWorldXY dla lakieru', () => {
  for (const name of ['HEX_VERTEX_SHADER', 'ARMOR_VERTEX_SHADER']) {
    const vertex = readShaderConst(name);
    assert.match(vertex, /varying\s+vec2\s+vWorldXY\s*;/, name);
    assert.match(vertex, /vWorldXY\s*=\s*\(modelMatrix\s*\*/, name);
  }
  assert.match(readShaderConst('HEX_FRAGMENT_SHADER'), /varying\s+vec2\s+vWorldXY\s*;/);
});

test('materiał kadłuba dostaje WSPÓLNE obiekty uniformów lakieru', () => {
  for (const name of ['uLacquerEnv', 'uLacquerEye', 'uLacquerA', 'uLacquerB', 'uLacquerC']) {
    assert.match(source, new RegExp(name + ':\\s*HullLacquer\\.uniforms\\.' + name + '\\b'), name);
    assert.match(readShaderConst('HEX_FRAGMENT_SHADER'), new RegExp('uniform\\s+\\w+\\s+' + name + '\\s*;'), name);
  }
  assert.match(source, /uShapeMap:\s*shapeUniform/);
  assert.match(source, /HullLacquer\.releaseShapeUniform\(data\.shapeImageRef\)/);
});
