// HUTA — formowanie, etap „Wyciskanie” (runda 7): RĘKAW POLA — geometria błony jako rury 1D (czysty JS, bez three;
// bez alokacji — tablice typowane).
//
// Obraz przewodni użytkownika: „gumowa rękawiczka, do której wlałeś płyn; ściskasz z lewej, żeby wyszedł z prawej” i po
// rundzie 6: „ten tył musi przechodzić do przodu, jakbyś wyciskał coś (…) polem wyciskamy lawę”. Błona to RĘKAW POLA
// o stałym miejscu: od tylnego kołnierza `x0` (strona naczynia) do gardzieli formującej G0 (`xG0`, strona taśmy). Wzdłuż
// rękawa `n` komórek (objętość metalu w komórce — stan symulacji w `linia.js`). ZACISK pola (`linia.js`) to wędrująca
// przewężka: rampa konstrykcji c(x) = szyja(x) · rampa((x − x_z) / w_z)² — za zaciskiem rękaw zamknięty (pusty, płaski),
// w rampie metal wyciskany ku gardzieli, przed nią brzuch z metalem. Ciśnienie w komórce z napięcia błony:
// Φ = G · (a / (c · A_ref))², a = objętość / dx — przekrój; fala w rękawie biegnie z c = c_w · a / (c · A_ref).
// Szyja (od `xN` do G0) to lejek pola: konstrykcja maleje do `cEnd`, przekrój przechodzi z nadelipsy n 2,5 (spłaszczonej,
// aspekt `aspect`) w okrąg strugi G0, oś wznosi się z `yc` do osi pasma `yT`.
import { BLONA } from './geometria.js';
import { areaK } from './nadelipsa.js';

const B_ = BLONA;
/** Liczba komórek rękawa, krok [j.], środki komórek, konstrykcja szyi (1 w brzuchu → `cEnd` w G0). */
export const RK_N = B_.n;
export const RK_DX = (B_.xG0 - B_.x0) / B_.n;
export const RK_X = Float64Array.from({ length: B_.n }, (_, i) => B_.x0 + (i + 0.5) * RK_DX);
export const RK_CN = Float64Array.from(RK_X, (x) => neckC(x));
/** Stała ciśnienia napięcia G [j²/s²] (c_w² / 2 — fala przy a = A_ref biegnie z c_w). */
export const RK_G = B_.cw * B_.cw / 2;
/** Indeks pierwszej komórki szyi. */
export const RK_NECK0 = RK_X.findIndex((x) => x > B_.xN);

/** Gładki krok 0…1 (Hermite). */
function sstep(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

/** Konstrykcja szyi w x (1 w brzuchu, `cEnd` w G0). */
export function neckC(x) { return 1 - (1 - B_.cEnd) * sstep((x - B_.xN) / (B_.xG0 - B_.xN)); }

/**
 * Rampa zacisku w x przy zacisku `xp` (0 — rękaw zamknięty za zaciskiem, 1 — brzuch): konstrykcja = (gładki krok)², więc
 * przekrój ∝ krok², a szerokość ∝ krok — brzuch zaokrągla się ku przewężce zacisku (nie kończy się ścianą).
 */
export function pinchRamp(x, xp) { const t = sstep((x - xp) / B_.wp); return t * t; }

const KT = Float64Array.from({ length: 51 }, (_, i) => areaK(2 + i * 0.01));
const RISE = B_.yT - B_.yc;

/**
 * Przekrój z pola przekroju `a` [j²] w x (brzuch: nadelipsa n 2,5, aspekt `aspect`; szyja → okrąg r G0) → do `out`:
 * [0] a — półszerokość, [1] b — półwysokość, [2] n, [3] wzniesienie środka nad `yc`, [4] env (brzuch 1 … G0 0).
 */
export function sectionAt(x, area, out) {
  const e = sstep((x - B_.xN) / (B_.xG0 - B_.xN));
  const env = 1 - e;
  const n = 2 + 0.5 * env;
  const asp = B_.aspect * env + (1 - env);
  const K = KT[Math.round((n - 2) * 100)];
  let W = area > 0 ? Math.sqrt(area / (K * asp)) : 0;
  let H = W * asp;
  // ostatnie 30 j. przed G0: przekrój dochodzi do okręgu o tym samym polu (przy wypływie nominalnym — okrąg r G0, którym
  // zaczyna się pasmo; śladowa ilość metalu nie rysuje się pełnym kołem gardzieli)
  const g = sstep((x - (B_.xG0 - 30)) / 30);
  if (g > 0 && W > 0) { const rc = Math.sqrt(area / Math.PI); W += (rc - W) * g; H += (rc - H) * g; }
  out[0] = W; out[1] = H; out[2] = n; out[3] = RISE * e; out[4] = env;
}

/**
 * Wersje dla kroku symulacji i stacji (BEZ LICZB W ARGUMENTACH I WYNIKU — V8 pakuje liczby zmiennoprzecinkowe przekazywane
 * przez wywołanie, krok nie alokuje): wejście w brudnopisie `W` — W[5] x, W[6] pole przekroju; wynik jak `sectionAt`
 * do W[0…4]. `areaAtW(cv, W)` — pole przekroju z komórek w x = W[5] do W[6].
 */
export function sectionAtW(W) {
  const x = W[5];
  const area = W[6];
  let e = (x - B_.xN) / (B_.xG0 - B_.xN);
  e = e <= 0 ? 0 : e >= 1 ? 1 : e * e * (3 - 2 * e);
  const env = 1 - e;
  const n = 2 + 0.5 * env;
  const asp = B_.aspect * env + (1 - env);
  const K = KT[Math.round((n - 2) * 100)];
  let Wd = area > 0 ? Math.sqrt(area / (K * asp)) : 0;
  let H = Wd * asp;
  let g = (x - (B_.xG0 - 30)) / 30;
  g = g <= 0 ? 0 : g >= 1 ? 1 : g * g * (3 - 2 * g);
  if (g > 0 && Wd > 0) { const rc = Math.sqrt(area / Math.PI); Wd += (rc - Wd) * g; H += (rc - H) * g; }
  W[0] = Wd; W[1] = H; W[2] = n; W[3] = RISE * e; W[4] = env;
}
export function areaAtW(cv, W) {
  let f = (W[5] - B_.x0) / RK_DX - 0.5;
  if (f <= 0) { W[6] = cv[0] / RK_DX * (1 + f > 0 ? 1 + f : 0); return; }
  if (f >= B_.n - 1) { W[6] = cv[B_.n - 1] / RK_DX; return; }
  const i = f | 0;
  f -= i;
  W[6] = (cv[i] + (cv[i + 1] - cv[i]) * f) / RK_DX;
}

/** Pole przekroju metalu [j²] w x z objętości komórek `cv` (liniowo między środkami komórek; 0 poza metalem). */
export function areaAt(cv, x) {
  let f = (x - B_.x0) / RK_DX - 0.5;
  if (f <= 0) return cv[0] / RK_DX * Math.max(0, 1 + f);       // tył: do zera na tylnej ścianie rękawa
  if (f >= B_.n - 1) return cv[B_.n - 1] / RK_DX;
  const i = f | 0;
  f -= i;
  return (cv[i] + (cv[i + 1] - cv[i]) * f) / RK_DX;
}

/** Objętość metalu w rękawie [j³] (suma komórek — testy). */
export function tubeVolume(cv) { let v = 0; for (let i = 0; i < B_.n; i++) v += cv[i]; return v; }
