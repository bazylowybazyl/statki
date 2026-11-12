// Lustro miasta-ogrodu ringu Ziemi w JS (docs/PLAN-zawalenia-lod-miasto.md, próba 2). Moduł czysty: bez three, GPU i DOM.
//
// Źródło reguły: makeHaloGardenVertex w src/3d/haloRing/haloRingCity.js (działki, wysokości, uskok, park, rzut)
// i haloHash12 w src/3d/haloRing/haloRingTSL.js. Tam reguła żyje w shaderze wierzchołków, a typ, maskę i teren czyta z map GPU.
// Tu mapy są zastąpione: maska = 1, teren = 0, przemysłu nie ma, typeGlass to gładka funkcja odległości od środka dzielnicy.
// Odcinki t < 30 i t > szerokość − 30 (brzeg podłogi) i zanik LOD pominięte: dzielnica leży w środku wstęgi.
//
// API:
//   budynkiDzielnicy({ kwartalyU, kwartalyV, ziarno, promienSzkla, skrzywienie }) → [{ x, y, w, d, h, szklo, uskok, typGlass, ziarno, kwartal }]
//     Układ sceny: z w górę, podłoga z = 0, środek dzielnicy w (0, 0), x wzdłuż ringu, y w poprzek.
//     (x, y) to środek rzutu, w × d rzut, h wysokość korpusu nad podłogą. uskok: { dx, dy, w, d, h } stoi na dachu korpusu
//     (podstawa z = h), dx, dy to przesunięcie jego środka względem środka korpusu, albo null.
//   rozmiarDzielnicy(budynkow) → { kwartalyU, kwartalyV }, dzielnica o około tylu budynkach.
//   siatkaBudynku(b, dx), dlaKazdegoWezla(b, dx, fn, opcje), wezlyBudynku(b, dx, opcje), wezlyDzielnicy(budynki, dx, opcje).
//
// AGENT: siatka węzłów to ta sama umowa co wieża (scena.js, wieza): n = round(wymiar / dx), komórki wyśrodkowane w rzucie,
// x = (i − (n − 1) / 2) · dx, z = (k + 0,5) · dx. Plan szacował 3 × 3 kolumny przy dx = 20 (27 i 80 węzłów), ale rzut 33,6 × 42,5
// mieści 2 × 2 przy tej umowie. Kolumny stoją wewnątrz rzutu z zapasem co najmniej dx / 4 (przy n ≥ 2), a sąsiedzi mają odstęp
// ponad dx przy dx ≤ 40. Powyżej dx ≈ 47 pojedyncza kolumna kostki nie mieści się już w działce: tak gruby węzeł to tier 0, nie solver.

const f = Math.fround;
const TAU = Math.PI * 2;

/** Stałe układu ringu Ziemi: HALO_CITY, wzór 0 z _makeSurfaceUniforms, layout.floor. Strażnik zgodności w tests/wokseleMiasto.test.mjs. */
export const MIASTO = Object.freeze({
  kwartalyObwod: 1896,          // periodic(140) przy obwodzie 265 477,1456 j.
  T: 265477.1455989519 / 1896,  // kwartał wzdłuż ringu, około 140 j.
  blockT: 118,                  // HALO_CITY.gardenBlockT, kwartał w poprzek
  rzedy: 46,                    // ceil(5400 / 118)
  dzialkiU: 3,
  dzialkiV: 2,
  rzutWsp: 0.72,                // działka × 0,72 = rzut
  parkProg: 0.24,               // kwartał jest parkiem przy haszu ≤ 0,24
  okresSkrzywieniaU: 3300,      // varPeriods[0]
  okresSkrzywieniaV: 1100,      // varPeriods[1]
});

export const DZIALKA_U = MIASTO.T / MIASTO.dzialkiU;
export const DZIALKA_V = MIASTO.blockT / MIASTO.dzialkiV;
export const RZUT_W = DZIALKA_U * MIASTO.rzutWsp;
export const RZUT_D = DZIALKA_V * MIASTO.rzutWsp;

const fract32 = (x) => f(x - Math.floor(x));
const K_HASZ = f(0.1031);
const K_33 = f(33.33);

/**
 * haloHash12 działaniami f32, po kolei jak w WGSL. Na GPU sterownik może scalić a·b + c w jedno zaokrąglenie
 * (pułapka 10 w regule webgpu-tsl), więc to ta sama reguła i ten sam rozkład, ale bez obietnicy zgodności bit w bit z kartą.
 */
export function haloHash12(px, py) {
  let a = fract32(f(f(px) * K_HASZ));
  let b = fract32(f(f(py) * K_HASZ));
  let c = a;
  const d = f(f(f(a * f(b + K_33)) + f(b * f(c + K_33))) + f(c * f(a + K_33)));
  a = f(a + d);
  b = f(b + d);
  c = f(c + d);
  return fract32(f(f(a + b) * c));
}

const frMul = (h, k) => fract32(f(h * f(k)));
const mix = (a, b, t) => a + (b - a) * t;
const gladko = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Reguła jednej działki (haloRingCity.js:153-169). Zwraca null dla kwartału-parku. */
export function regulaDzialki(blockAbs, rzad, lx, ly, typGlass) {
  if (haloHash12(blockAbs + 0.5, rzad + 0.5) <= MIASTO.parkProg) return null;
  const lotH = haloHash12(blockAbs * 7 + lx + 3, rzad * 7 + ly + 3);
  const lotHt = 0.35 + 0.65 * frMul(lotH, 13.7);
  const h = mix(10 + 60 * lotHt * lotHt, 40 + 250 * lotHt * lotHt, typGlass);
  let uskok = null;
  if (lotHt >= 0.55 && frMul(lotH, 5.3) <= mix(0.6, 0.95, typGlass)) {
    const sk = mix(0.55, 0.62, frMul(lotH, 3.7));
    const w = RZUT_W * sk;
    const d = RZUT_D * sk;
    uskok = {
      dx: (frMul(lotH, 2.3) - 0.5) * (RZUT_W - w) * 0.8,
      dy: (frMul(lotH, 4.9) - 0.5) * (RZUT_D - d) * 0.8,
      w,
      d,
      h: h * mix(0.35, 0.7, frMul(lotH, 9.1)),
    };
  }
  return { lotH, h, uskok };
}

/** Około 4,56 budynku na kwartał (6 działek, 24% kwartałów to parki), dzielnica w przybliżeniu kwadratowa. */
export function rozmiarDzielnicy(budynkow) {
  const kw = budynkow / (MIASTO.dzialkiU * MIASTO.dzialkiV * (1 - MIASTO.parkProg));
  const kwartalyU = Math.max(1, Math.round(Math.sqrt((kw * MIASTO.blockT) / MIASTO.T)));
  const kwartalyV = Math.max(1, Math.round(kw / kwartalyU));
  return { kwartalyU, kwartalyV };
}

/**
 * Dzielnica: prawdziwe numery kwartałów ringu wybrane z ziarna, więc inne ziarno to inne miejsce tego samego miasta.
 * promienSzkla: połowa przejścia typeGlass jako ułamek półosi dzielnicy (0 = same ogrody, duży = samo szkło). Przy 0,7 szkło ma około 38% powierzchni.
 * skrzywienie: 0…1, ulice jak w grze (przesunięcie do 0,35 kwartału wzdłuż i 0,3 w poprzek), tu dwa sinusy o okresach map zmienności:
 * rzędy przesuwają się wzdłuż, kolumny w poprzek, więc odstępy w rzędzie i w kolumnie zostają bez zmian. Bryły zostają równoległe do osi.
 */
export function budynkiDzielnicy({ kwartalyU = 11, kwartalyV = 10, ziarno = 1, promienSzkla = 0.7, skrzywienie = 0 } = {}) {
  const z = Math.abs(Math.floor(ziarno));
  const u0 = (z * 733 + 211) % Math.max(1, MIASTO.kwartalyObwod - kwartalyU);
  const v0 = 1 + (z * 37 + 11) % Math.max(1, MIASTO.rzedy - 2 - kwartalyV);
  const fazaU = TAU * ((z * 0.618034) % 1);
  const fazaV = TAU * ((z * 0.754878) % 1);
  const polU = (kwartalyU * MIASTO.T) / 2;
  const polV = (kwartalyV * MIASTO.blockT) / 2;
  const r0 = promienSzkla - 0.08;
  const r1 = promienSzkla + 0.08;
  const budynki = [];
  for (let iu = 0; iu < kwartalyU; iu++) {
    for (let iv = 0; iv < kwartalyV; iv++) {
      for (let ly = 0; ly < MIASTO.dzialkiV; ly++) {
        for (let lx = 0; lx < MIASTO.dzialkiU; lx++) {
          const x0 = (iu + (lx + 0.5) / MIASTO.dzialkiU) * MIASTO.T - polU;
          const y0 = (iv + (ly + 0.5) / MIASTO.dzialkiV) * MIASTO.blockT - polV;
          const ru = x0 / polU;
          const rv = y0 / polV;
          const typGlass = promienSzkla > 0 ? 1 - gladko(r0, r1, Math.sqrt(ru * ru + rv * rv)) : 0;
          const r = regulaDzialki(u0 + iu, v0 + iv, lx, ly, typGlass);
          if (!r) continue;
          const wS = skrzywienie * 0.35 * Math.sin((TAU * y0) / MIASTO.okresSkrzywieniaU + fazaU);
          const wT = skrzywienie * 0.3 * Math.sin((TAU * x0) / MIASTO.okresSkrzywieniaV + fazaV);
          budynki.push({
            x: x0 + wS * MIASTO.T,
            y: y0 + wT * MIASTO.blockT,
            w: RZUT_W,
            d: RZUT_D,
            h: r.h,
            szklo: typGlass > 0.5,
            uskok: r.uskok,
            typGlass,
            ziarno: r.lotH,
            kwartal: [u0 + iu, v0 + iv],
          });
        }
      }
    }
  }
  return budynki;
}

const EPS = 1e-9;

/** Zakres kolumn korpusu w rzucie uskoku na jednej osi. Rzut węższy niż krok: najbliższa kolumna, o ile uskok ma choć pół komórki. */
function zakresUskoku(c, szer, n, dx) {
  const m = (n - 1) / 2;
  const i0 = Math.max(0, Math.ceil((c - szer / 2) / dx + m - EPS));
  const i1 = Math.min(n - 1, Math.floor((c + szer / 2) / dx + m + EPS));
  if (i0 <= i1) return [i0, i1];
  if (szer < dx / 2) return null;
  const i = Math.min(n - 1, Math.max(0, Math.round(c / dx + m)));
  return [i, i];
}

/**
 * Siatka węzłów budynku przy danym dx: korpus nx × ny × nz i uskok na tych samych kolumnach (wiązania idą po ijk, więc jedna siatka).
 * Budynek ma co najmniej jeden węzeł; uskok niższy niż pół komórki albo węższy niż pół komórki przy tym dx znika.
 */
export function siatkaBudynku(b, dx) {
  const nx = Math.max(1, Math.round(b.w / dx));
  const ny = Math.max(1, Math.round(b.d / dx));
  const nz = Math.max(1, Math.round(b.h / dx));
  let uskok = null;
  if (b.uskok) {
    const nzU = Math.round(b.uskok.h / dx);
    const ri = nzU > 0 ? zakresUskoku(b.uskok.dx, b.uskok.w, nx, dx) : null;
    const rj = ri ? zakresUskoku(b.uskok.dy, b.uskok.d, ny, dx) : null;
    if (rj) uskok = { i0: ri[0], i1: ri[1], j0: rj[0], j1: rj[1], nz: nzU };
  }
  return { dx, nx, ny, nz, uskok };
}

/** Wydmuszka (metoda F planu): ściany, dach i strop co około tyle j. Przy nx, ny ≤ 2 wszystko jest ścianą, więc zysk zaczyna się od dx ≈ 10. */
export const STROP_CO = 30;

/** fn(x, y, z, i, j, k) dla każdego węzła w kolejności i, j, k rosnąco po k. opcje.wydmuszka: tylko ściany i stropy. Zwraca liczbę węzłów. */
export function dlaKazdegoWezla(b, dx, fn, opcje = {}) {
  const s = siatkaBudynku(b, dx);
  const wyd = !!opcje.wydmuszka;
  const co = Math.max(2, Math.round(STROP_CO / dx));
  const mx = (s.nx - 1) / 2;
  const my = (s.ny - 1) / 2;
  let n = 0;
  const warstwy = (i0, i1, j0, j1, k0, k1) => {
    for (let k = k0; k < k1; k++) {
      const pelna = !wyd || k === k1 - 1 || (k - k0) % co === 0;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (!pelna && i !== i0 && i !== i1 && j !== j0 && j !== j1) continue;
          n++;
          if (fn) fn(b.x + (i - mx) * dx, b.y + (j - my) * dx, (k + 0.5) * dx, i, j, k);
        }
      }
    }
  };
  warstwy(0, s.nx - 1, 0, s.ny - 1, 0, s.nz);
  if (s.uskok) warstwy(s.uskok.i0, s.uskok.i1, s.uskok.j0, s.uskok.j1, s.nz, s.nz + s.uskok.nz);
  return n;
}

export function wezlyBudynku(b, dx, opcje) {
  return dlaKazdegoWezla(b, dx, null, opcje);
}

export function wezlyDzielnicy(budynki, dx, opcje) {
  let n = 0;
  for (let i = 0; i < budynki.length; i++) n += wezlyBudynku(budynki[i], dx, opcje);
  return n;
}

export { wezlyBudynku as węzłyBudynku, wezlyDzielnicy as węzłyDzielnicy };
