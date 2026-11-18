// HUTA — wytop: KULA ciekłego metalu (czysta matematyka, bez three i DOM).
//
// Kształt kuli w nieważkości: promień z masy (r ∝ m^(1/3)) i 12 MODÓW DRGAŃ powierzchni — rzeczywiste harmoniki
// sferyczne l = 2 (5 modów) i l = 3 (7 modów) zapisane jako wielomiany jednorodne kierunku (x, y, z), oś biegunowa
// y (pion komory). Powierzchnia: r(n) = R · (1 + Σ a_i · H_i(n)). Harmoniki są unormowane tak, że średnia H_i² po
// sferze = 1 (amplituda = odchylenie średniokwadratowe powierzchni w ułamku promienia).
//
// Dynamika modu: oscylator tłumiony wokół równowagi `eq` (pole cewek, spłaszczenie od wirowania):
//   częstość Rayleigha   ω_l² = C · l(l−1)(l+2) / R³     (kropla trzymana napięciem powierzchniowym)
//   tłumienie Lamba      γ_l  = D · (l−1)(2l+1) / R²      (lepkość)
// Stałe nastrojone pod oko: pełna kula (R = 177 j.) ma okres 1,8 s (l = 2) i 0,93 s (l = 3), mała (R = 87) drga
// 2,9 × szybciej. Krok jest DOKŁADNY (obrót w płaszczyźnie fazowej z wykładnikiem) — stabilny przy każdym dt.

export const MODES = 12;
/** Stopień l modu i. */
export const MODE_L = Object.freeze([2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3]);

const S15 = Math.sqrt(15);
const S5H = Math.sqrt(5) / 2;
const S15H = Math.sqrt(15) / 2;
const S70Q = Math.sqrt(70) / 4;
const S105 = Math.sqrt(105);
const S42Q = Math.sqrt(42) / 4;
const S7H = Math.sqrt(7) / 2;
const S105H = Math.sqrt(105) / 2;
/** Współczynniki unormowania harmonik (te same liczby wpisuje shader kuli — `kulaTSL.js`). */
export const MODE_NORM = Object.freeze([S15, S15, S5H, S15, S15H, S70Q, S105, S42Q, S7H, S42Q, S105H, S70Q]);
/** Największa wartość |H_i| na sferze (z zapasem) — ogranicznik amplitud trzyma Σ |a_i| · HMAX ≤ `BALL.limit`. */
export const HMAX = 2.65;

export const BALL = Object.freeze({
  rPerCbrtTon: 38,                 // R = 38 · m^(1/3) [m w tonach]
  C: 3.49 * 3.49 * 177 * 177 * 177 / 8,
  D: 0.45 * 177 * 177 / 5,
  limit: 0.15,                     // największe odchylenie powierzchni [ułamek R]
  kickL3: 0.4                      // udział pędu ziarna idący w mody l = 3 (szybkie — w nadmiarze dają „galaretę”)
});

export const radiusOfTons = (t) => BALL.rPerCbrtTon * Math.cbrt(Math.max(0, t));
export const modeOmega = (l, R) => Math.sqrt(BALL.C * l * (l - 1) * (l + 2) / (R * R * R));
export const modeGamma = (l, R) => BALL.D * (l - 1) * (2 * l + 1) / (R * R);

/** Wartości 12 harmonik w kierunku JEDNOSTKOWYM (x, y, z) → out[o … o + 11]. */
export function harmonics(x, y, z, out, o = 0) {
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  out[o] = S15 * x * z;
  out[o + 1] = S15 * z * y;
  out[o + 2] = S5H * (2 * yy - xx - zz);
  out[o + 3] = S15 * x * y;
  out[o + 4] = S15H * (xx - zz);
  out[o + 5] = S70Q * z * (3 * xx - zz);
  out[o + 6] = S105 * x * y * z;
  out[o + 7] = S42Q * z * (4 * yy - xx - zz);
  out[o + 8] = S7H * y * (2 * yy - 3 * xx - 3 * zz);
  out[o + 9] = S42Q * x * (4 * yy - xx - zz);
  out[o + 10] = S105H * (xx - zz) * y;
  out[o + 11] = S70Q * x * (xx - 3 * zz);
  return out;
}

/** Gradienty wielomianów (∂/∂x, ∂/∂y, ∂/∂z) w punkcie (x, y, z) → out[o + 3 i … o + 3 i + 2]. */
export function harmonicsGrad(x, y, z, out, o = 0) {
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  let k = o;
  out[k++] = S15 * z; out[k++] = 0; out[k++] = S15 * x;
  out[k++] = 0; out[k++] = S15 * z; out[k++] = S15 * y;
  out[k++] = -2 * S5H * x; out[k++] = 4 * S5H * y; out[k++] = -2 * S5H * z;
  out[k++] = S15 * y; out[k++] = S15 * x; out[k++] = 0;
  out[k++] = 2 * S15H * x; out[k++] = 0; out[k++] = -2 * S15H * z;
  out[k++] = 6 * S70Q * x * z; out[k++] = 0; out[k++] = S70Q * (3 * xx - 3 * zz);
  out[k++] = S105 * y * z; out[k++] = S105 * x * z; out[k++] = S105 * x * y;
  out[k++] = -2 * S42Q * x * z; out[k++] = 8 * S42Q * y * z; out[k++] = S42Q * (4 * yy - xx - 3 * zz);
  out[k++] = -6 * S7H * x * y; out[k++] = S7H * (6 * yy - 3 * xx - 3 * zz); out[k++] = -6 * S7H * y * z;
  out[k++] = S42Q * (4 * yy - 3 * xx - zz); out[k++] = 8 * S42Q * x * y; out[k++] = -2 * S42Q * x * z;
  out[k++] = 2 * S105H * x * y; out[k++] = S105H * (xx - zz); out[k++] = -2 * S105H * y * z;
  out[k++] = S70Q * (3 * xx - 3 * zz); out[k++] = 0; out[k++] = -6 * S70Q * x * z;
  return out;
}

const _h = new Float64Array(MODES);

/** Odchylenie powierzchni h(n) = Σ a_i · H_i(n) w kierunku jednostkowym (x, y, z); `a` — amplitudy od `o`. */
export function surfaceOffset(a, x, y, z, o = 0) {
  harmonics(x, y, z, _h, 0);
  let h = 0;
  for (let i = 0; i < MODES; i++) h += a[o + i] * _h[i];
  return h;
}

const _par = new Float64Array(8);     // l = 2: e, c, s, ω², γ, ωd | l = 3 liczone w drugim przebiegu

/**
 * Krok modów o `dt`: `a` — amplitudy, `v` — prędkości, `eq` — równowagi (wszystkie [12]); `R` — promień kuli.
 * Dokładne rozwiązanie oscylatora tłumionego wokół `eq` (stałej w kroku). Potem ogranicznik Σ |a| · HMAX ≤ limit.
 */
export function stepModes(a, v, eq, R, dt) {
  for (let pass = 0; pass < 2; pass++) {
    const l = pass === 0 ? 2 : 3;
    const w2 = BALL.C * l * (l - 1) * (l + 2) / (R * R * R);
    const g = BALL.D * (l - 1) * (2 * l + 1) / (R * R);
    const e = Math.exp(-g * dt);
    const under = w2 > g * g;
    const wd = Math.sqrt(under ? w2 - g * g : g * g - w2);
    let c;
    let s;
    if (under) { c = Math.cos(wd * dt); s = wd > 1e-9 ? Math.sin(wd * dt) / wd : dt; }
    else { const ep = Math.exp(wd * dt); const em = 1 / ep; c = (ep + em) / 2; s = wd > 1e-9 ? (ep - em) / (2 * wd) : dt; }
    _par[0] = e; _par[1] = c; _par[2] = s;
    const i0 = pass === 0 ? 0 : 5;
    const i1 = pass === 0 ? 5 : 12;
    for (let i = i0; i < i1; i++) {
      const x0 = a[i] - eq[i];
      const v0 = v[i];
      a[i] = eq[i] + e * (x0 * c + (v0 + g * x0) * s);
      v[i] = e * (v0 * c - (g * v0 + w2 * x0) * s);
    }
  }
  let sum = 0;
  for (let i = 0; i < MODES; i++) sum += Math.abs(a[i]);
  const cap = BALL.limit / HMAX;
  if (sum > cap) {
    const k = cap / sum;
    for (let i = 0; i < MODES; i++) { a[i] *= k; if (v[i] * a[i] > 0) v[i] *= k; }
  }
}

/** Energia drgań Σ (ȧ² + ω_l² · (a − eq)²). */
export function modeEnergy(a, v, eq, R) {
  let E = 0;
  for (let i = 0; i < MODES; i++) {
    const l = MODE_L[i];
    const w2 = BALL.C * l * (l - 1) * (l + 2) / (R * R * R);
    const x = a[i] - eq[i];
    E += v[i] * v[i] + w2 * x * x;
  }
  return E;
}

// ---------------------------------------------------------------------------
// Warianty GORĄCEJ ŚCIEŻKI: wszystkie liczby zmiennoprzecinkowe idą przez tablice typowane (argument albo wynik
// zmiennoprzecinkowy wywołania, którego kompilator nie wkleił, to alokacja — krok komory ma nie alokować).

const _hv = new Float64Array(MODES);

/** Harmoniki w kierunku v[0…2] → out[0…11]. */
export function harmonicsV(v, out) {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  out[0] = S15 * x * z;
  out[1] = S15 * z * y;
  out[2] = S5H * (2 * yy - xx - zz);
  out[3] = S15 * x * y;
  out[4] = S15H * (xx - zz);
  out[5] = S70Q * z * (3 * xx - zz);
  out[6] = S105 * x * y * z;
  out[7] = S42Q * z * (4 * yy - xx - zz);
  out[8] = S7H * y * (2 * yy - 3 * xx - 3 * zz);
  out[9] = S42Q * x * (4 * yy - xx - zz);
  out[10] = S105H * (xx - zz) * y;
  out[11] = S70Q * x * (xx - 3 * zz);
}

/** Odchylenie powierzchni w kierunku v[0…2] → v[3]. */
export function surfaceOffsetInto(a, v) {
  harmonicsV(v, _hv);
  let h = 0;
  for (let i = 0; i < MODES; i++) h += a[i] * _hv[i];
  v[3] = h;
}

/** Impuls w mody: prędkość amplitudy i += v[4] · H_i(v[0…2]). */
export function kickModesInto(vel, v) {
  harmonicsV(v, _hv);
  const k = v[4];
  for (let i = 0; i < 5; i++) vel[i] += k * _hv[i];
  const k3 = k * BALL.kickL3;
  for (let i = 5; i < MODES; i++) vel[i] += k3 * _hv[i];
}

/** Krok modów jak `stepModes`: par[0] = promień kuli, par[1] = dt. */
export function stepModesInto(a, v, eq, par) {
  const R = par[0];
  const dt = par[1];
  for (let pass = 0; pass < 2; pass++) {
    const l = pass === 0 ? 2 : 3;
    const w2 = BALL.C * l * (l - 1) * (l + 2) / (R * R * R);
    const g = BALL.D * (l - 1) * (2 * l + 1) / (R * R);
    const e = Math.exp(-g * dt);
    const under = w2 > g * g;
    const wd = Math.sqrt(under ? w2 - g * g : g * g - w2);
    let c;
    let s;
    if (under) { c = Math.cos(wd * dt); s = wd > 1e-9 ? Math.sin(wd * dt) / wd : dt; }
    else { const ep = Math.exp(wd * dt); const em = 1 / ep; c = (ep + em) / 2; s = wd > 1e-9 ? (ep - em) / (2 * wd) : dt; }
    const i0 = pass === 0 ? 0 : 5;
    const i1 = pass === 0 ? 5 : 12;
    for (let i = i0; i < i1; i++) {
      const x0 = a[i] - eq[i];
      const v0 = v[i];
      a[i] = eq[i] + e * (x0 * c + (v0 + g * x0) * s);
      v[i] = e * (v0 * c - (g * v0 + w2 * x0) * s);
    }
  }
  let sum = 0;
  for (let i = 0; i < MODES; i++) sum += Math.abs(a[i]);
  const cap = BALL.limit / HMAX;
  if (sum > cap) {
    const k = cap / sum;
    for (let i = 0; i < MODES; i++) { a[i] *= k; if (v[i] * a[i] > 0) v[i] *= k; }
  }
}

/** Energia drgań jak `modeEnergy`: par[0] = promień kuli → par[2]. */
export function modeEnergyInto(a, v, eq, par) {
  const R = par[0];
  let E = 0;
  for (let i = 0; i < MODES; i++) {
    const l = MODE_L[i];
    const w2 = BALL.C * l * (l - 1) * (l + 2) / (R * R * R);
    const x = a[i] - eq[i];
    E += v[i] * v[i] + w2 * x * x;
  }
  par[2] = E;
}
