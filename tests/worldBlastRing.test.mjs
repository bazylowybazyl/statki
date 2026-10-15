// Front fali na ciele PŁASKIM (src/game/worldChannels.js — _blastBody) po optymalizacji 2026-10-15: skan tylko
// pierścienia frontu (komórki na pewno wewnątrz poprzedniego promienia — odchylenie węzła od środka komórki ≤ _maxDisp
// + zapas — pominięte). Kopnięcia (vx, vy), ciepło, aktywacja węzłów, obrót ciała i zbiór ciał gorących BIT W BIT
// jak dawny skan pełnego koła (wzorzec tests/helpers/worldBlastReference.mjs), także z węzłami wgniecionymi.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { WorldChannels } = await import('../src/game/worldChannels.js');
const { referenceBlastBody } = await import('./helpers/worldBlastReference.mjs');

HullBodies.init();

// Płaski kadłub z obrazu (prostokąt z otworem): 400 × 160 px × 4 j./px, komórka 15 j. (~4,5 tys. węzłów).
const W = 400, H = 160, UPP = 4;
const IMG = (() => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const hole = (x - W * 0.3) ** 2 + (y - H * 0.5) ** 2 < (H * 0.18) ** 2;
    const o = (x + y * W) * 4;
    data[o] = 120; data[o + 1] = 120; data[o + 2] = 120; data[o + 3] = hole ? 0 : 255;
  }
  return { width: W, height: H, data };
})();

let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function makeBody(tag, anchored) {
  const e = { id: tag, x: 3.2e6, y: -1.7e6, vx: 0, vy: 0, angle: 0.37, angVel: 0, radius: 0, mass: 0,
    visual: { spriteScale: UPP, spriteScaleX: UPP, spriteScaleY: UPP, spriteRotation: 0 } };
  const hull = HullBodies.createHull(e, IMG, { cellPx: 15 / UPP, anchored, pins: anchored ? (sx) => sx < -500 : null });
  return { e, body: hull.body };
}

// To samo wgniecenie w obu ciałach: losowe węzły przesunięte do ~3 komórek (więcej niż zapas pierścienia bez _maxDisp), _maxDisp jak po solverze (dokładne maksimum).
function dent(body, s0) {
  seed = s0;
  const s = body.nodeStore, cs = body.cellSize;
  for (let k = 0; k < 600; k++) {
    const i = (rnd() * s.count) | 0;
    if (!s.active[i]) continue;
    s.x[i] += (rnd() - 0.5) * 6 * cs;
    s.y[i] += (rnd() - 0.5) * 6 * cs;
  }
  let m = 0;
  for (let i = 0; i < s.count; i++) if (s.active[i]) m = Math.max(m, Math.abs(s.x[i] - s.ox[i]), Math.abs(s.y[i] - s.oy[i]));
  body._maxDisp = m;
  body._hashTick = -1;
}

const bits = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
function sameState(a, b, label) {
  const sa = a.nodeStore, sb = b.nodeStore;
  for (const k of ['vx', 'vy', 'vz', 'temp']) {
    if (!sa[k]) continue;
    assert.ok(bits(sa[k].subarray(0, sa.count)).equals(bits(sb[k].subarray(0, sb.count))), `${label}: ${k}`);
  }
  if (sa.act) assert.ok(bits(sa.act.subarray(0, sa.count)).equals(bits(sb.act.subarray(0, sb.count))), `${label}: aktywne węzły`);
  assert.deepEqual(a._region ? a._region.list.slice() : [], b._region ? b._region.list.slice() : [], `${label}: kolejność aktywacji`);
  assert.ok(Object.is(a.angVel.z, b.angVel.z), `${label}: obrót ${a.angVel.z} ≠ ${b.angVel.z}`);
}

test('front fali na ciele płaskim: pierścień frontu = pełne koło (bit w bit, wgniecenia, kotwice, kilka wybuchów)', () => {
  for (const anchored of [false, true]) {
    const A = makeBody('wzorzec' + anchored, anchored), B = makeBody('nowy' + anchored, anchored);
    dent(A.body, 11); dent(B.body, 11);
    const chA = new WorldChannels(HullBodies.engine), chB = new WorldChannels(HullBodies.engine);
    chA._blastBody = function (body, blast, prevR, R) { return referenceBlastBody(this, body, blast, prevR, R); };
    const scen = [
      // środek wybuchu względem ciała (świat silnika), promień, moc, kierunek
      [0, 0, 2000, 1.4, 1, 0], [600, -120, 900, 1, 0, 1], [-1400, 300, 2500, 2, -0.7, 0.7], [2400, 900, 1600, 0.8, 0, 0]
    ];
    const pa = A.body.pos, pb = B.body.pos;
    for (const [dx, dy, r, p, fx, fy] of scen) {
      chA.detonate(pa.x + dx, pa.y + dy, r, p, fx, fy);
      chB.detonate(pb.x + dx, pb.y + dy, r, p, fx, fy);
    }
    for (let k = 0; k < 14; k++) {
      chA.stepBlasts(1 / 60, [A.body]);
      chB.stepBlasts(1 / 60, [B.body]);
      sameState(A.body, B.body, `${anchored ? 'kotwice' : 'swobodne'} krok ${k}`);
    }
    assert.equal(chA.hot.size, chB.hot.size, 'ciała gorące');
    // kopnięcia były (test nie przechodzi na pustym)
    let kicked = 0;
    const s = B.body.nodeStore;
    for (let i = 0; i < s.count; i++) if (s.vx[i] !== 0 || s.vy[i] !== 0) kicked++;
    assert.ok(kicked > 500, `kopnięte węzły ${kicked}`);
    HullBodies.release(A.e); HullBodies.release(B.e);
  }
});
