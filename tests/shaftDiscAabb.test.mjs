// Pudła tarcz w masce słońca (2026-10-17, src/3d/core3d.js — shaftDiscAabb): pętla tarcz shadowShaftsMaskNode pomija
// piksel poza pudłem tarczy i jej smugi. Tu: każdy punkt, w którym tarcza daje cień albo ustawia insideDisc (lustro
// warunków shadera), leży w pudle; pudło jest ciasne; Core3D pakuje pudła i shader sprawdza je na początku iteracji.
// node --test tests/shaftDiscAabb.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const { shaftDiscAabb } = await import('../src/3d/core3d.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Lustro iteracji pętli tarcz: { inside, shadow } dla punktu (x, y).
function discAt(dx, dy, R, ax, ay, lenMul, x, y) {
  if (R <= 0) return { inside: false, shadow: 0 };
  if (ax * ax + ay * ay < 0.5) return { inside: false, shadow: 0 };
  const rx = x - dx, ry = y - dy;
  const inside = rx * rx + ry * ry < R * R;
  const along = rx * ax + ry * ay;
  if (along <= 0) return { inside, shadow: 0 };
  const perp = Math.abs(rx * -ay + ry * ax);
  const exitDist = Math.sqrt(Math.max(R * R - perp * perp, 0));
  if (along <= exitDist) return { inside, shadow: 0 };
  const fallT = Math.min(1, Math.max(0, (along - exitDist) / Math.max(R * lenMul, 1)));
  const fall = 1 - smooth(0.55, 1, fallT);
  const soft = R * (fallT * 0.14 + 0.04);
  const edge = 1 - smooth(R - soft, R + soft, perp);
  return { inside, shadow: edge * fall };
}

test('pudło tarczy: każdy punkt z cieniem tarczy albo w tarczy leży w pudle (oś nie zawsze jednostkowa)', () => {
  let seed = 4242;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const bb = new Float64Array(4);
  let hits = 0, area = 0, boxArea = 0;
  for (let k = 0; k < 60; k++) {
    const R = k % 10 === 0 ? 0.4 : 5 + rnd() * 4000;
    const a = rnd() * Math.PI * 2, L = 0.72 + rnd() * 0.5;
    const ax = Math.cos(a) * L, ay = Math.sin(a) * L;
    const lenMul = 1 + rnd() * 8;
    const cx = 5e6 + (rnd() - 0.5) * 1e5, cy = -7e6 + (rnd() - 0.5) * 1e5;
    shaftDiscAabb(bb, 0, cx, cy, R, ax, ay, lenMul);
    const ext = (R * (2 + lenMul) + 10) / Math.min(1, L);
    const N = 220;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = cx + (i / (N - 1) - 0.5) * 2 * ext, y = cy + (j / (N - 1) - 0.5) * 2 * ext;
      const r = discAt(cx, cy, R, ax, ay, lenMul, x, y);
      if (!r.inside && !(r.shadow > 0)) continue;
      hits++;
      area++;
      assert.ok(x >= bb[0] && y >= bb[1] && x <= bb[2] && y <= bb[3], `punkt z cieniem poza pudłem (R ${R}, oś ${L})`);
    }
    boxArea += ((bb[2] - bb[0]) * (bb[3] - bb[1])) / ((2 * ext / (N - 1)) ** 2);
  }
  assert.ok(hits > 50000, `punkty z cieniem: ${hits}`);
  assert.ok(boxArea / area < 4, `pudła ciasne: ${(boxArea / area).toFixed(2)}× pola z cieniem`);
  // tarcza nieaktywna — pudło puste (każdy piksel pominięty, jak continue w shaderze)
  shaftDiscAabb(bb, 0, 0, 0, 0, 1, 0, 5);
  assert.ok(bb[0] > bb[2] && bb[1] > bb[3]);
  shaftDiscAabb(bb, 0, 0, 0, 100, 0.5, 0.2, 5);
  assert.ok(bb[0] > bb[2]);
});

test('Core3D: pudła tarcz pakowane z osią i uDiscLenMul, test pudła przed odczytem tarczy w pętli', () => {
  const core = read('src/3d/core3d.js');
  assert.match(core, /uDiscB: uniformArray\(v4\(SHAFT_DISC_CAP\), 'vec4'\),/);
  assert.match(core, /shaftDiscAabb\(dbb, 0, view\[base\], view\[base \+ 1\], view\[base \+ 2\], viewAxis\[i \* 2\], viewAxis\[i \* 2 \+ 1\], discLenMul\);/);
  assert.match(core, /if \(this\.shadowDiscAabb === false\) discB\[i\]\.set\(-1e30, -1e30, 1e30, 1e30\);/);
  const loop = core.indexOf("name: 'discIdx' }, ({ discIdx }) => {");
  const box = core.indexOf('const dB = uDiscB.element(discIdx);', loop);
  const read0 = core.indexOf('const disc = uDiscs.element(discIdx).toVar();', loop);
  assert.ok(loop > 0 && box > loop && read0 > box, 'pudło sprawdzane przed odczytem tarczy');
  // uDiscLenMul ustawiony przed pakowaniem tarcz
  const lm = core.indexOf('uShafts.uDiscLenMul.value = Math.max(1');
  const pack = core.indexOf('const discLenMul = uShafts.uDiscLenMul.value;');
  assert.ok(lm > 0 && pack > lm);
});
