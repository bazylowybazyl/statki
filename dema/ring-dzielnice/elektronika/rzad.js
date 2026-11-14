// Dzielnica „Zakłady elektroniki” — RZĄD PRZY RINGU: magazyny wyrobów (skarbce) z ekspedycją kurierską w dokach
// S / M, pawilony laboratoriów za dokami, dyspozytornia dzielnicy i trzy łączniki nad drogą do zakładów (FG).
// Kanały budowli: 0–2 zapas magazynu (układy, optyka, taśma), 3–5 stan linii (lampy na łącznikach).
import { RING_V, ringScale } from '../kit/uklad.js';
import { PB_FX, PB_MAT, newScene, pitDetail, pushLamp, sceneOf } from '../kit/sceny.js';
import { DECK, frameAt, frameKit, hala, korpusy, lacznik, wentylatory, wiezaProcesowa } from './narzedzia.js';

const M = PB_MAT;
const V = RING_V;

export const RZAD_CH = Object.freeze({ stock: (i) => i, status: (i) => 3 + i });

/** Magazyn wyrobów: niska hala-skarbiec z żebrami, lukami dachowymi, rampą od drogi i wskaźnikiem zapasu. */
function magazyn(K, style, { half, name, small, ch }) {
  const R = hala(K, { u0: -half, u1: half, w0: 70, w1: 720, h: 176, wall: M.rail, name: `magazyn ${name}` });
  const top = R.top;
  const n = Math.max(3, Math.round((2 * half) / 300));
  for (let i = 0; i <= n; i++) {
    const u = -half + 30 + ((2 * half - 60) * i) / n;
    for (const w of [190, 600]) K.blk(u, w, top, 12, 26, 210, M.steel);
  }
  // luki dachowe w przęsłach (poza pasem napisu) i wieżyczki narożne
  for (let i = 0; i < n; i++) {
    const u = -half + 30 + ((2 * half - 60) * (i + 0.5)) / n;
    for (const w of [170, 620]) {
      K.blk(u, w, top, 7, 150, 96, M.steel);
      K.blk(u, w, top + 7, 3, 124, 70, M.rail);
    }
  }
  for (const su of [-1, 1]) for (const w of [96, 694]) K.cyl(su * (half - 30), w, top, 34, 30, M.rail);
  // rampa od drogi: bramy ze szkła i krótkie listwy nad nimi
  K.blk(0, 760, DECK, 16, 2 * half - 80, 80, M.rail);
  const doors = Math.max(3, Math.round((2 * half) / 360));
  for (let i = 0; i < doors; i++) {
    const u = -half + 110 + ((2 * half - 220) * i) / (doors - 1);
    K.blk(u, 724, DECK + 14, 96, 120, 8, M.glass);
    K.lit(u, 726, DECK + 120, 5, 90, 6, M.warm, 0.9);
  }
  // wskaźnik zapasu: rząd lampek na attyce od strony drogi
  for (let k = 0; k < 10; k++) K.lit(-half * 0.62 + (half * 1.24 * k) / 9, 708, top + 9, 7, 56, 10, M.cyan, 1.1, PB_FX.fill, (k + 0.5) / 10, ch);
  for (const w of [300, 490]) K.blk(0, w, top, 4, 2 * half - 80, 9, M.paintCold);
  K.label(name, 0, 395, Math.min(2 * half - 260, 1100), 170, style.labels.gate, small, top + 3);
}

/** Pawilon laboratorium na pasie za dokiem: mała hala z atrium ze szkła, wentylator, maszt. */
function pawilon(K, lu, lw, seed) {
  if (lu < 150 || lw < 160) return;
  const w0 = 40;
  const w1 = 40 + lw;
  const R = hala(K, { u0: -lu / 2, u1: lu / 2, w0, w1, h: 110 + 50 * (seed % 2), name: 'pawilon' });
  const wc = (w0 + w1) / 2;
  if (lw > 380) {
    K.blk(0, wc - lw * 0.18, R.top, 10, lu * 0.56, lw * 0.26, M.rail);
    K.blk(0, wc - lw * 0.18, R.top + 10, 4, lu * 0.5, lw * 0.2, M.glass);
    K.lit(0, wc - lw * 0.18 + lw * 0.15, R.top, 4, Math.min(96, lu * 0.4), 8, M.cyan, 0.9);
    wentylatory(K, R.top, -lu * 0.32, lu * 0.32, wc + lw * 0.1, wc + lw * 0.4, lu > 330 ? 2 : 1, 1, 44);
  } else {
    K.blk(0, wc, R.top, 8, lu * 0.5, lw * 0.4, M.rail);
    K.blk(0, wc, R.top + 8, 4, lu * 0.42, lw * 0.3, M.glass);
  }
  if (seed % 3 === 0) {
    K.cyl(lu * 0.36, w0 + 30, R.top, 70, 5, M.rail);
    K.lamp(lu * 0.36, w0 + 30, R.top + 74, 10, M.white, 1.1);
  }
}

export function buildRzadScene(layout, style, occupied) {
  const { f, plates, labels, lamps, T } = newScene();
  const footprints = [];
  korpusy(T, f, layout, ['EI'], { strip: M.cyan });
  for (const pit of layout.pits) if (pit.zone === 'EI') pitDetail(T, f, pit, { occupied: occupied.has(pit.berth.id) });

  // pawilony laboratoriów i biur projektowych za dokami (pas od ściany ringu do tylnej ściany doku)
  let seed = 0;
  for (const p of layout.pieces) {
    if (p.zone !== 'EI' || !p.pit) continue;
    const depth = p.v1 - p.v0;
    const K = frameKit(f, plates, labels, frameAt((p.s0 + p.s1) / 2, p.v0), footprints);
    pawilon(K, (p.s1 - p.s0) * ringScale(p.v0) - 60, depth - 80, seed++);
  }

  // magazyny wyrobów na pełnych blokach
  const mk = (sc) => frameKit(f, plates, labels, frameAt(sc, V.inner0), footprints);
  magazyn(mk(-4200), style, { half: 1080, name: 'UKŁADY', small: 'MAGAZYN WYROBÓW', ch: RZAD_CH.stock(0) });
  magazyn(mk(-10), style, { half: 520, name: 'OPTYKA', small: 'MAGAZYN WYROBÓW', ch: RZAD_CH.stock(1) });
  magazyn(mk(4700), style, { half: 980, name: 'TAŚMA', small: 'MAGAZYN WYROBÓW', ch: RZAD_CH.stock(2) });

  // dyspozytornia dzielnicy (FG) obok magazynu optyki
  {
    const K = mk(1010);
    const R = hala(K, { u0: -230, u1: 230, w0: 150, w1: 590, h: 150, name: 'dyspozytornia' });
    K.blk(0, 450, R.top, 10, 300, 190, M.rail);
    K.blk(0, 450, R.top + 10, 4, 250, 140, M.glass);
    wiezaProcesowa(K, 0, 250, { side: 130, h: 500, seed: 41 });
    K.label('DYSPOZYTORNIA', 0, 690, 520, 78, style.labels.control, 'ZAKŁADY ELEKTRONIKI');
  }

  // łączniki nad drogą: zakład ↔ magazyn (wieże na pokładach obu rzędów)
  layout.bridges.forEach((b, i) => lacznik(T, f, b.s, V.inner1 - 120, V.outer0 + 120, { statusCh: RZAD_CH.status(i), seed: 7 + i }));

  // lampy hal wiszą wysoko nad dachami (światło pada z góry na dachy); 2 = chłodne, 1 = ciepłe
  for (const [s, v, y, kind] of [[-4200, 430, 1200, 2], [-10, 430, 1200, 2], [4700, 430, 1200, 2], [-6300, 450, 1000, 1], [-1800, 450, 1000, 1], [2600, 450, 1000, 1], [6500, 450, 1000, 1], [1010, 420, 1100, 1]]) pushLamp(lamps, s, v, y, kind);
  return sceneOf(f, plates, labels, lamps, { footprints });
}
