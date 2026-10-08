// src/3d/hullSurfaceBake.js
//
// MAPA POWIERZCHNI KADŁUBA ze sprite'a (czysta funkcja — bez three i DOM; liczy ją worker
// src/3d/hullSurfaceWorker.js, testy w Node). Sprite'y okrętów nie mają normalnych ani
// wysokości, a bez nich światło „kładzie się” na kadłubie płasko: słońce, lampy i błyski
// rozjaśniają naklejkę zamiast wydobywać bryłę. Mapa odtwarza bryłę z samego obrazu:
//
//   wysokość = KOPUŁA (rozmyta alfa — przekrój całego kadłuba)
//            + FAZA sylwetki (wąskie rozmycie alfy — krawędź łapie światło po stronie słońca)
//            + RELIEF PANELI (różnica jasności od jej otoczenia: jasne płyty wyżej, ciemne
//              szwy, rury i wnęki niżej — sprite'y mają je narysowane z cieniowaniem)
//   normalna = gradient wysokości (+ drobne ziarno blachy z jasności — tylko do normalnych),
//   AO       = wnęki względem rozmytej wysokości (ciemnieje tylko światło otoczenia).
//
// Jasność liczona jest NORMALIZOWANYM splotem (Σ jasność·alfa / Σ alfa): pustka wokół
// kadłuba nie wchodzi do tła paneli — inaczej cała sylwetka dostałaby wielki „stopień”
// i świecącą obwódkę (zakaz z lakieru: jasny obrys czyta się jak włączona tarcza).
//
// Wynik: RGBA8 na teksel —
//   R, G = normalna X, Y × 0,5 + 0,5 (układ sprite'a: x = w prawo obrazu, y W GÓRĘ obrazu,
//          jak „poduszka” w shaderze kadłuba), z = √(1 − x² − y²) w shaderze;
//   B    = AO (1 = otwarta blacha, 0 = głęboka wnęka);
//   A    = relief paneli (bez kopuły i fazy): 0,5 + wysokość / (2 · heightRange) [px SPRITE'A];
//          samocień liczy marsz po tej wysokości (kopuła i faza są łagodniejsze od wysokości
//          słońca — cienia nie rzucają, a zabrałyby rozdzielczość 8 bitów).
// Poza sylwetką: normalna (0, 0, 1), AO 1, wysokość 0 (A = 0,5).

export const HULL_SURFACE_DEFAULTS = Object.freeze({
  maxSide: 2048,       // dłuższy bok mapy [teksele]
  // Kopuła: rozmycie alfy (ułamek krótszego boku) i nachylenie przekroju przy sylwetce.
  domeSigma: 0.09,
  domeTiltDeg: 36,
  // Faza sylwetki [teksele] i jej nachylenie.
  bevelSigma: 1.6,
  bevelTiltDeg: 38,
  // Relief paneli: różnica jasności (DoG normalizowany alfą) → wysokość [px sprite'a].
  mesoInner: 1.2,      // wygładzenie jasności [teksele]
  mesoOuter: 7.0,      // tło paneli [teksele]
  mesoGain: 13.0,      // px wysokości na jednostkę różnicy jasności (0..1)
  mesoClamp: 4.5,      // sufit |wysokość paneli| [px sprite'a]
  // Ziarno blachy (tylko normalne): różnica jasności od wąskiego tła.
  microSigma: 1.6,
  microGain: 2.0,      // px wysokości na jednostkę różnicy (tylko gradient)
  // AO: wnęka = rozmyta wysokość − wysokość [px] → 1 − k · wnęka.
  aoSigma: 9.0,        // [teksele]
  aoGain: 0.07,        // na px wnęki
  aoMin: 0.35,
  heightRange: 12     // px sprite'a: A = 0,5 ± 0,5 ↔ relief ± heightRange
});

const DEG = Math.PI / 180;
// Maksimum gradientu rozmytej krawędzi = 1 / (sigma · √(2π)).
const EDGE_GAIN = 0.3989423;

function boxBlurPass(src, dst, r, stride, lineCount, lineStep, length) {
  const norm = 1 / (2 * r + 1);
  for (let line = 0; line < lineCount; line++) {
    const base = line * lineStep;
    let acc = 0;
    for (let k = 0; k <= r && k < length; k++) acc += src[base + k * stride];
    for (let k = 0; k < length; k++) {
      dst[base + k * stride] = acc * norm;
      const add = k + r + 1;
      const sub = k - r;
      if (add < length) acc += src[base + add * stride];
      if (sub >= 0) acc -= src[base + sub * stride];
    }
  }
}

/**
 * Prawie-gauss (3 przejścia pudełkowe w obu osiach) o zadanej sigmie, poza obrazem zera.
 * Koszt niezależny od promienia. `tmp` — bufor roboczy (w·h), opcjonalny.
 */
export function blurField(src, w, h, sigma, tmp = null) {
  const out = Float32Array.from(src);
  if (!(sigma > 0.25)) return out;
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) * 0.5));
  const t = tmp && tmp.length >= w * h ? tmp : new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    boxBlurPass(out, t, r, 1, h, w, w);   // wiersze
    boxBlurPass(t, out, r, w, w, 1, h);   // kolumny
  }
  return out;
}

const SRGB_LUT = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/** sRGB bajt → liniowo (testy, podgląd). */
export function srgbToLinear8(v) {
  return SRGB_LUT[v & 255];
}

/**
 * Zmniejszenie RGBA8 do (w2, h2) średnią z pola (barwa ważona alfą — bez ciemnej obwódki
 * z przezroczystych tekseli). Zwraca Uint8ClampedArray.
 */
export function downscaleRgba(rgba, w, h, w2, h2) {
  if (w2 === w && h2 === h) return rgba;
  const out = new Uint8ClampedArray(w2 * h2 * 4);
  const sx = w / w2;
  const sy = h / h2;
  for (let y = 0; y < h2; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    const iy0 = Math.floor(y0);
    const iy1 = Math.min(h, Math.ceil(y1));
    for (let x = 0; x < w2; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      const ix0 = Math.floor(x0);
      const ix1 = Math.min(w, Math.ceil(x1));
      let r = 0; let g = 0; let b = 0; let a = 0; let wsum = 0;
      for (let yy = iy0; yy < iy1; yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        if (wy <= 0) continue;
        for (let xx = ix0; xx < ix1; xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          const i = (yy * w + xx) * 4;
          const al = rgba[i + 3] * wgt;
          r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al;
          a += al;
          wsum += wgt;
        }
      }
      const o = (y * w2 + x) * 4;
      if (a > 0) {
        out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a;
      }
      out[o + 3] = wsum > 0 ? a / wsum : 0;
    }
  }
  return out;
}

/** Rozmiar mapy dla sprite'a (w, h) przy dłuższym boku ≤ maxSide. */
export function hullSurfaceSize(w, h, maxSide = HULL_SURFACE_DEFAULTS.maxSide) {
  const s = Math.min(1, maxSide / Math.max(1, w, h));
  return { w: Math.max(2, Math.round(w * s)), h: Math.max(2, Math.round(h * s)), scale: s };
}

/**
 * Mapa powierzchni z RGBA8 sprite'a (już w rozmiarze mapy: w × h teksele).
 * `pxPerTexel` — px sprite'a na teksel mapy (≥ 1 przy zmniejszeniu): wysokości i nachylenia
 * liczone są w px SPRITE'A, więc ten sam okręt ma tę samą bryłę przy każdym rozmiarze mapy.
 * Zwraca Uint8Array (w · h · 4).
 */
export function bakeHullSurfaceField(rgba, w, h, pxPerTexel = 1, options = {}) {
  const o = { ...HULL_SURFACE_DEFAULTS, ...options };
  const n = w * h;
  const k = Math.max(1e-6, pxPerTexel);
  const alpha = new Float32Array(n);
  const luma = new Float32Array(n);
  const lumaA = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    // Jasność percepcyjna (wartości sRGB): szwy i wnęki rysowane ciemniej, płyty jaśniej.
    const y = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
    alpha[i] = a;
    luma[i] = y;
    lumaA[i] = y * a;
  }
  const tmp = new Float32Array(n);
  const ref = Math.max(1, Math.min(w, h));
  // Wysokości w px SPRITE'A, odległości w tekselach → nachylenie = Δwysokość / (Δteksele · k).
  // Kopuła i faza: alfa rozmyta, skala tak, by przy sylwetce nachylenie wynosiło tilt.
  const domeSigma = Math.max(1, o.domeSigma * ref);
  const dome = blurField(alpha, w, h, domeSigma, tmp);
  const domeScale = Math.tan(o.domeTiltDeg * DEG) * domeSigma * k / EDGE_GAIN;
  const bevelSigma = Math.max(0.5, o.bevelSigma);
  const bevel = blurField(alpha, w, h, bevelSigma, tmp);
  const bevelScale = Math.tan(o.bevelTiltDeg * DEG) * bevelSigma * k / EDGE_GAIN;
  // Jasność normalizowana alfą (pustka nie wchodzi do tła).
  const aIn = blurField(alpha, w, h, o.mesoInner, tmp);
  const lIn = blurField(lumaA, w, h, o.mesoInner, tmp);
  const aOut = blurField(alpha, w, h, o.mesoOuter, tmp);
  const lOut = blurField(lumaA, w, h, o.mesoOuter, tmp);
  const aMic = blurField(alpha, w, h, o.microSigma, tmp);
  const lMic = blurField(lumaA, w, h, o.microSigma, tmp);
  const height = new Float32Array(n);   // kopuła + faza + panele [px]
  const relief = new Float32Array(n);   // same panele [px] (samocień)
  const detail = new Float32Array(n);   // + ziarno (tylko normalne) [px]
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    const inner = aIn[i] > 1e-4 ? lIn[i] / aIn[i] : 0;
    const outer = aOut[i] > 1e-4 ? lOut[i] / aOut[i] : inner;
    const mic = aMic[i] > 1e-4 ? lMic[i] / aMic[i] : luma[i];
    // Relief paneli gaśnie przy sylwetce (tam tło normalizowane ma mało próbek).
    const inside = Math.min(1, Math.max(0, (aOut[i] - 0.35) / 0.4));
    let meso = (inner - outer) * o.mesoGain * inside;
    if (meso > o.mesoClamp) meso = o.mesoClamp;
    else if (meso < -o.mesoClamp) meso = -o.mesoClamp;
    const base = dome[i] * domeScale + bevel[i] * bevelScale + meso * a;
    height[i] = base;
    relief[i] = meso * a;
    detail[i] = base + (luma[i] - mic) * o.microGain * a * inside;
  }
  const hBlur = blurField(height, w, h, o.aoSigma, tmp);
  const out = new Uint8Array(n * 4);
  const inv2k = 1 / (2 * k);
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : y;
    const yd = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o4 = i * 4;
      if (alpha[i] < 0.004) {
        out[o4] = 128; out[o4 + 1] = 128; out[o4 + 2] = 255; out[o4 + 3] = 128;
        continue;
      }
      const xl = x > 0 ? x - 1 : x;
      const xr = x < w - 1 ? x + 1 : x;
      // Sobel (wagi 1-2-1) na wysokości z ziarnem.
      const r0 = yu * w;
      const r1 = y * w;
      const r2 = yd * w;
      const gx = (detail[r0 + xr] + 2 * detail[r1 + xr] + detail[r2 + xr]
        - detail[r0 + xl] - 2 * detail[r1 + xl] - detail[r2 + xl]) * 0.25 * inv2k * (2 / Math.max(1, xr - xl));
      const gy = (detail[r2 + xl] + 2 * detail[r2 + x] + detail[r2 + xr]
        - detail[r0 + xl] - 2 * detail[r0 + x] - detail[r0 + xr]) * 0.25 * inv2k * (2 / Math.max(1, yd - yu));
      // Obraz rośnie w dół, normalna ma y w górę: n = (−∂h/∂x, +∂h/∂y_obrazu, 1).
      let nx = -gx;
      let ny = gy;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv;
      ny *= inv;
      const cav = hBlur[i] - height[i];
      let ao = 1 - Math.max(0, cav) * o.aoGain;
      if (ao < o.aoMin) ao = o.aoMin;
      const hv = Math.max(0, Math.min(1, 0.5 + relief[i] / (2 * o.heightRange)));
      out[o4] = Math.round((nx * 0.5 + 0.5) * 255);
      out[o4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[o4 + 2] = Math.round(Math.min(1, ao) * 255);
      out[o4 + 3] = Math.round(hv * 255);
    }
  }
  return out;
}

/**
 * Pełny wypiek ze sprite'a w dowolnym rozmiarze: zmniejszenie do maxSide i mapa.
 * Zwraca { data, width, height, pxPerTexel }.
 */
export function bakeHullSurface(rgba, w, h, options = {}) {
  const o = { ...HULL_SURFACE_DEFAULTS, ...options };
  const size = hullSurfaceSize(w, h, o.maxSide);
  const src = downscaleRgba(rgba, w, h, size.w, size.h);
  const pxPerTexel = w / size.w;
  return { data: bakeHullSurfaceField(src, size.w, size.h, pxPerTexel, o), width: size.w, height: size.h, pxPerTexel };
}
