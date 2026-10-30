// scripts/gazZoomSonda.mjs
//
// SONDA DRŻENIA GAZU PRZY ZOOMIE I ODDALENIU (Node, bez GPU; 2026-10-29 wieczór — zgłoszenie z 5120 × 1440 @ 240 Hz:
// „gazy drżą przy zoom in / out”, „przybliżona kamera OK, oddalona — gazy drżą”). Lustra CPU obrazu gazu pasa:
// pole dalekie i faktura (`farEnvCpu`, `detailCpu` — src/3d/spaceGas/spaceGasBelt.js), mapa gazu z drabiny teksla
// i próbek na teksel (`spaceGasTexelLevel`, `spaceGasMapTaps`, `spaceGasMapTapOffsets` — spaceGasMaps.js), warstwa
// (dwie połowy: albedo · światło · (1 − e^−a) na czarnym tle, odczyt mapy dwuliniowo) i post gry (ACES gry + sRGB).
//
// SKOK NA STOPNIU DRABINY: ta sama klatka (zoom) z mapą na stopniu j i j + 1 (wymuszony przeskok — w grze zdarza się
// 2–3 razy na ząbek kółka), różnica obrazu w tych samych punktach świata: % pikseli > 4/255 i > 8/255, maks. To miara
// sondy B z dochodzenia (scratchpad gaz-zoom) — dziś przy zoomie 0,05 / 0,035 kilka–kilkanaście % pikseli; próbki na
// teksel (mapTaps) zbijają ją kilkukrotnie. Test: tests/spaceGas.test.mjs („próbki na teksel …”).
//
//   node scripts/gazZoomSonda.mjs [--zoomy 0.341,0.1,0.05,0.035] [--taps 1,2,4] [--W 5120 --H 1440]
//
// Uproszczenia (świadome): pole dalekie (poza oknem pola — kw = 0), obwiednia stała (env, ice), światło stałe (Ls),
// tło czarne (w grze za gazem jest oświetlony ośrodek pasa — skok w pikselach wychodzi tam większy).

import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
globalThis.window = globalThis.window || {};
const { farEnvCpu, detailCpu, createBeltGasLook, SPACE_GAS_DETAIL_LOD_MEAN, SPACE_GAS_DETAIL_LOD_OLD } = await imp('src/3d/spaceGas/spaceGasBelt.js');
const { spaceGasTexelLevel, spaceGasMapTaps, spaceGasMapTapOffsets, SPACE_GAS_TEXEL_STEPS } = await imp('src/3d/spaceGas/spaceGasMaps.js');
const { SPACE_GAS_MAP_MARGIN } = await imp('src/3d/spaceGas/spaceGasLayout.js');
const { acesGryCpu, linearDoSrgbCpu } = await imp('src/3d/tsl/kolorGry.js');

export { SPACE_GAS_DETAIL_LOD_MEAN, SPACE_GAS_DETAIL_LOD_OLD };
const LOOK = createBeltGasLook();
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Kamera sondy dochodzenia: rdzeń pasa (38,6 AU od Słońca — kotwicy). */
export const SONDA_CAM = Object.freeze([-1199329, -1104752]);

/**
 * Mapa gazu (lustro kGas, pole dalekie) na stopniu `level` (drabina) przy kadrze halfW × halfH: { tx, ty, minX, minY,
 * at(i, j) → [r, g, b, a] (leniwie, z pamięcią) }. taps — próbki na teksel (1 / 2 / 4 — jak spaceGasMapTaps),
 * lodTexel — teksel zaniku faktury (ciągły, wprost z kadru), target — wartości wygaszonej faktury.
 */
export function mapaGazu({ camX, camY, halfW, halfH, level, W = 768, H = 432, taps = 1, lodTexel, target, env = 1, ice = 0.25, lod = [60, 260] }) {
  const S = SPACE_GAS_TEXEL_STEPS;
  const tx = 2 ** (level[0] / S), ty = 2 ** (level[1] / S);
  const mx = Math.round(camX / tx) * tx, my = Math.round(camY / ty) * ty;
  const minX = mx - tx * W * 0.5, minY = my - ty * H * 0.5;
  const offs = spaceGasMapTapOffsets(taps);
  const lodK = ss(lod[0], lod[1], lodTexel);
  const A = LOOK.albedo, E = LOOK.ejecta;
  const f = new Float64Array(4), d = new Float64Array(4), s = new Float64Array(4);
  const cache = new Map();
  const at = (i, j) => {
    const key = i * 100003 + j;
    let v = cache.get(key);
    if (v) return v;
    s[0] = s[1] = s[2] = s[3] = 0;
    for (const [ox, oy] of offs) {
      const px = minX + (i + 0.5 + ox) * tx, py = minY + (j + 0.5 + oy) * ty;
      farEnvCpu(px, py, 0, 0, env, ice, LOOK, f);
      detailCpu(px, py, lodK, target, d);
      for (let c = 0; c < 4; c++) s[c] += f[c] * d[c];
    }
    for (let c = 0; c < 4; c++) s[c] /= offs.length;
    v = [
      A[0][0] * s[0] + A[1][0] * s[1] + A[2][0] * s[2] + E[0] * s[3],
      A[0][1] * s[0] + A[1][1] * s[1] + A[2][1] * s[2] + E[1] * s[3],
      A[0][2] * s[0] + A[1][2] * s[1] + A[2][2] * s[2] + E[2] * s[3],
      s[0] + s[1] + s[2] + s[3]
    ];
    cache.set(key, v);
    return v;
  };
  return { tx, ty, minX, minY, at };
}

const WTS = [0.2126, 0.7152, 0.0722];
const bspl = (f, w) => {
  const f2 = f * f, f3 = f2 * f;
  w[0] = (-f3 + 3 * f2 - 3 * f + 1) / 6; w[1] = (3 * f3 - 6 * f2 + 4) / 6; w[2] = (-3 * f3 + 3 * f2 + 3 * f + 1) / 6; w[3] = f3 / 6;
};
const _wx = [0, 0, 0, 0], _wy = [0, 0, 0, 0];
/**
 * Luma 8 bit piksela warstwy (dwie połowy na czarnym tle, światło Ls) w punkcie świata (x, y) — mapa dwuliniowo albo
 * (cubic) dwusześciennie B-spline (warstwa z `layerCubic`: SpaceGas.tune.layerCubic).
 */
export function lumaWarstwy(map, x, y, Ls = 0.6, cubic = false) {
  const u = (x - map.minX) / map.tx - 0.5, v = (y - map.minY) / map.ty - 0.5;
  const i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j;
  const m = [0, 0, 0, 0];
  if (cubic) {
    bspl(fx, _wx); bspl(fy, _wy);
    for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
      const t = map.at(i - 1 + a, j - 1 + b), w = _wx[a] * _wy[b];
      for (let k = 0; k < 4; k++) m[k] += t[k] * w;
    }
  } else {
    const a = map.at(i, j), b = map.at(i + 1, j), c = map.at(i, j + 1), e = map.at(i + 1, j + 1);
    for (let k = 0; k < 4; k++) m[k] = (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + e[k] * fx) * fy;
  }
  const al = 1 - Math.exp(-m[3]), A = Math.max(m[3], 1e-4);
  const sun = LOOK.sun, g = LOOK.sunGain, amb = LOOK.ambient;
  let Y = 0;
  for (let k = 0; k < 3; k++) Y += WTS[k] * linearDoSrgbCpu(acesGryCpu((m[k] / A) * (sun[k] * g * Ls + amb[k]) * al));
  return Y * 255;
}

/**
 * Skok obrazu na stopniu drabiny przy zoomie `zoom` (kadr W × H px, px na j. = zoom): mapa na stopniu j (z kadru) i j + 1
 * w tych samych punktach świata (wycinek `crop` px wokół środka, co `step` px). Zwraca { p4, p8, maks, sr, tx, taps }.
 * Teksel zaniku faktury — jak w grze z mapy BAZOWEJ lodW × lodH (SpaceGasMaps.place: każdy rozmiar mapy — ten sam zanik).
 */
export function skokNaStopniu({ zoom, W = 5120, H = 1440, taps = 1, mapW = 768, mapH = 432, lodW = 768, lodH = 432, crop = [1280, 640], step = 4, target = SPACE_GAS_DETAIL_LOD_OLD, cam = SONDA_CAM, tapsAt = [64, 150], cubic = false }) {
  const halfW = W / 2 / zoom, halfH = H / 2 / zoom;
  const needX = halfW * SPACE_GAS_MAP_MARGIN * 2 / mapW, needY = halfH * SPACE_GAS_MAP_MARGIN * 2 / mapH;
  const L = [spaceGasTexelLevel(NaN, needX), spaceGasTexelLevel(NaN, needY)];
  const lodTexel = Math.max(halfW * SPACE_GAS_MAP_MARGIN * 2 / lodW, halfH * SPACE_GAS_MAP_MARGIN * 2 / lodH);
  const mk = (bias) => {
    const lv = [L[0] + bias, L[1] + bias];
    const t = spaceGasMapTaps(Math.max(2 ** (lv[0] / SPACE_GAS_TEXEL_STEPS), 2 ** (lv[1] / SPACE_GAS_TEXEL_STEPS)), taps, tapsAt);
    return mapaGazu({ camX: cam[0], camY: cam[1], halfW, halfH, level: lv, W: mapW, H: mapH, taps: t, lodTexel, target });
  };
  const m0 = mk(0), m1 = mk(1);
  let n = 0, c4 = 0, c8 = 0, mx = 0, sum = 0;
  for (let py = -crop[1] / 2; py < crop[1] / 2; py += step) {
    for (let px = -crop[0] / 2; px < crop[0] / 2; px += step) {
      const x = cam[0] + (px + 0.5) / zoom, y = cam[1] + (py + 0.5) / zoom;
      const d = Math.abs(lumaWarstwy(m1, x, y, 0.6, cubic) - lumaWarstwy(m0, x, y, 0.6, cubic));
      n++; sum += d;
      if (d > 4) c4++;
      if (d > 8) c8++;
      if (d > mx) mx = d;
    }
  }
  return { zoom, taps: spaceGasMapTaps(m0.tx, taps, tapsAt), tx: m0.tx, p4: 100 * c4 / n, p8: 100 * c8 / n, maks: mx, sr: sum / n };
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const zoomy = String(arg('zoomy', '0.341,0.1,0.0667,0.05,0.035')).split(',').map(Number);
  const tapsL = String(arg('taps', '1,4')).split(',').map(Number);
  const cubicL = String(arg('cubic', '0')).split(',').map((s) => s === '1');
  const W = Number(arg('W', 5120)), H = Number(arg('H', 1440));
  const mapW = Number(arg('mapW', 768)), mapH = Number(arg('mapH', 432));
  console.log(`skok na stopniu drabiny (j → j+1, te same punkty świata), ${W} × ${H}, mapa ${mapW} × ${mapH}: % pikseli > 4/255, > 8/255, maks, śr`);
  for (const zoom of zoomy) {
    for (const taps of tapsL) {
      for (const cubic of cubicL) {
        const r = skokNaStopniu({ zoom, W, H, taps, cubic, mapW, mapH });
        console.log(`zoom ${zoom} teksel ${r.tx.toFixed(1)} j. próbki ${r.taps}${cubic ? ' B-spline' : ''}: >4 ${r.p4.toFixed(2)}% >8 ${r.p8.toFixed(2)}% maks ${r.maks.toFixed(1)} śr ${r.sr.toFixed(3)}`);
      }
    }
  }
}
