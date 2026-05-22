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
