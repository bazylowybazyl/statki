import test from 'node:test';
import assert from 'node:assert/strict';

// Para wrak × wrak rzadziej (HULL_BODY_CONFIG.wreckPairEvery, audyt 2026-10-07 § 5.5): hak pairFilter
// zwraca k dla wolnej względem siebie pary wraków po czasie pełnych kolizji; domyślnie wyłączone.
globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies, HULL_BODY_CONFIG: C } = await import('../src/game/hullBodies.js');
const D = HullBodies.engine;

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}

test('wreckPairEvery: domyślnie co krok; z flagą wolne nieświeże wraki co k-ty krok, świeże i szybkie co krok', () => {
  HullBodies.init();
  const image = plate(160, 80);
  const a = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 5000 };
  const b = { x: 400, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 5000 };
  HullBodies.createHull(a, image);
  HullBodies.createHull(b, image);
  const wa = HullBodies.convertToWreck(a), wb = HullBodies.convertToWreck(b);
  const A = wa.beamHull.body, B = wb.beamHull.body;
  // Encja i ciało z tą samą prędkością (syncIn kroku): oba wraki lecą razem 90 j/s — nie są „zimne”.
  const move = (w, body, vx, w0 = 0) => { w.vx = vx; body.vel.x = vx; w.angVel = -w0; body.angVel.z = w0; };
  try {
    assert.equal(C.wreckPairEvery, 1, 'flaga domyślnie wyłączona');
    wa._wreckAge = wb._wreckAge = 10;
    move(wa, A, 90); move(wb, B, 90);
    assert.equal(D.pairFilter(A, B), true, 'bez flagi każda para co krok');
    C.wreckPairEvery = 4;
    assert.equal(D.pairFilter(A, B), 4, 'wolna para starych wraków: co 4. krok');
    wa._wreckAge = 1;
    assert.equal(D.pairFilter(A, B), true, 'świeży odłam rozdziela się co krok');
    wa._wreckAge = 10;
    move(wb, B, 90 + C.wreckPairSpeed);
    assert.equal(D.pairFilter(A, B), true, 'szybki styk co krok');
    move(wb, B, 90, 2 * C.wreckPairSpeed / Math.max(1, B.radius));
    assert.equal(D.pairFilter(A, B), true, 'wirujący wrak (obrót × promień) co krok');
    move(wa, A, 0); move(wb, B, 0);
    assert.equal(D.pairFilter(A, B), false, 'dwa zimne wraki — bez kolizji jak dotąd');
  } finally {
    C.wreckPairEvery = 1;
    HullBodies.release(wa);
    HullBodies.release(wb);
    window.wrecks.length = 0;
  }
});
