// src/3d/rockets/rand.js
//
// n kolejnych liczb generatora efektów (fxRandom — mulberry32) naraz do bufora: ten sam ciąg
// i ten sam stan co n × next(), ale bez wywołań zwracających liczbę w pętlach klatki. V8
// opakowuje w obiekt liczbę zmiennoprzecinkową zwracaną przez wywołanie, którego nie wklei —
// a w dużych funkcjach (smuga rakiet: ~10 losowań na porcję gazu) budżet wklejania kończy się
// po kilku next(). Równoważność bit w bit z FxRandom.next: tests/rocketFx.test.mjs.

const TWO_32 = 4294967296;

/**
 * @param {{ state?: number, next(): number }} rng generator efektów (FxRandom; inny — przez next())
 * @param {Float64Array} out bufor wyników
 * @param {number} n ile liczb z [0, 1)
 */
export function fillRandom(rng, out, n) {
  if (typeof rng.state !== 'number') {
    for (let k = 0; k < n; k++) out[k] = rng.next();
    return;
  }
  let s = rng.state | 0;
  for (let k = 0; k < n; k++) {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[k] = ((t ^ (t >>> 14)) >>> 0) / TWO_32;
  }
  rng.state = s;
}
