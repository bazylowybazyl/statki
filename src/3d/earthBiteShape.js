// Kształt wielkiego gryzu Ziemi (dane: src/data/earthBite.js) — czysty moduł, bez three.
//
// Gryz = kula o promieniu β(φ, ψ) ze środkiem C na powierzchni kuli Ziemi (R = 1). β to LUSTRO trzech
// miejsc: generatora map (scripts/planety/gryz.py, `beta`), węzła TSL (src/3d/earthBite.tsl.js,
// `betaNode`) i tego modułu (`earthBiteRadius`). Zmiana wzoru = zmiana we wszystkich trzech
// (tests/earthBite.test.mjs pilnuje CPU ↔ dane ↔ WGSL).
//
// Układ obiektu kuli planety (THREE.SphereGeometry, u = 0 na 180° W): kierunek (lon, lat) =
// (cos lat · cos lon, sin lat, −cos lat · sin lon); uv = ((lon + π) / 2π, ½ + lat / π). Oś doby = +Y.
// Rama gryzu: C (środek), E = Y × C / |Y × C| (wschód), N = C × E (północ). Kierunek u od C: ψ = kąt od −C
// (0 — dno), φ = azymut (0 — wschód, ku północy). Brzeg: |C + β u| = 1 ⇔ cos ψ = β / 2.
import { EARTH_BITE } from '../data/earthBite.js';

export const EARTH_RADIUS_KM = 6371.0;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

function dirOf(lonDeg, latDeg) {
  const lo = lonDeg * DEG, la = latDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
}

/** Rama gryzu w układzie obiektu kuli: środek C, wschód E, północ N (jednostkowe, ortogonalne). */
export function earthBiteFrame(bite = EARTH_BITE) {
  const C = dirOf(bite.lon, bite.lat);
  const el = Math.hypot(C[2], C[0]);
  const E = [C[2] / el, 0, -C[0] / el];
  const N = [C[1] * E[2] - C[2] * E[1], C[2] * E[0] - C[0] * E[2], C[0] * E[1] - C[1] * E[0]];
  return { C, E, N };
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const fract = (x) => x - Math.floor(x);

/** Łuki zębów na obwodzie: 4t(1 − t) − 2/3 (średnio 0; ostrza między łukami do środka). */
function teethArc(phi, bite) {
  const pw = phi + bite.teethWarp * Math.sin(phi + bite.teethPhase * DEG);
  const t = fract(bite.teeth * pw / TAU);
  return 4 * t * (1 - t) - 2 / 3;
}

function lobesOf(phi, bite) {
  let s = 0;
  for (const [k, amp, ph] of bite.lobes) s += amp * Math.cos(k * (phi - ph * DEG));
  return s;
}

/** Promień kuli gryzu β(φ, ψ) w R; b — promień bazowy (domyślnie z danych). */
export function earthBiteRadius(phi, psi, bite = EARTH_BITE, b = bite.radiusR) {
  const psiR = Math.acos(b / 2);
  const wL = smooth(0, 0.6 * psiR, psi);
  const wT = smooth(psiR * (1 - bite.teethDepth), psiR * 0.95, psi);
  return b * (1 + lobesOf(phi, bite) * wL + bite.teethAmp * teethArc(phi, bite) * wT);
}

/** Promień gryzu na brzegu (wagi = 1): cięciwa od C do brzegu w azymucie φ. */
export function earthBiteRimRadius(phi, bite = EARTH_BITE, b = bite.radiusR) {
  return b * (1 + lobesOf(phi, bite) + bite.teethAmp * teethArc(phi, bite));
}

/** Kąt ψ brzegu w azymucie φ (cos ψ = β / 2). */
export function earthBiteRimPsi(phi, bite = EARTH_BITE, b = bite.radiusR) {
  return Math.acos(earthBiteRimRadius(phi, bite, b) / 2);
}

/** Promień kątowy otworu na powierzchni (rad, od C) w azymucie φ. */
export function earthBiteRimAngle(phi, bite = EARTH_BITE, b = bite.radiusR) {
  return 2 * Math.asin(Math.min(1, earthBiteRimRadius(phi, bite, b) / 2));
}

/** Największy promień brzegu (cięciwa) — obwiednia gryzu dla testów zgrubnych (tarcza cienia, radar). */
export function earthBiteRimMax(bite = EARTH_BITE, b = bite.radiusR) {
  let m = 0;
  for (let i = 0; i < 720; i++) m = Math.max(m, earthBiteRimRadius((i / 720) * TAU, bite, b));
  return m;
}

/**
 * Współrzędne gryzu punktu p (układ obiektu kuli): r = |p − C|, ψ, φ, β(φ, ψ). Zapis do `out` (4 liczby).
 * Punkt kuli (|p| = 1) leży w gryzie, gdy r < β.
 */
export function earthBiteCoords(px, py, pz, bite = EARTH_BITE, b = bite.radiusR, frame = earthBiteFrame(bite), out = new Float64Array(4)) {
  const { C, E, N } = frame;
  const vx = px - C[0], vy = py - C[1], vz = pz - C[2];
  const r = Math.max(1e-9, Math.sqrt(vx * vx + vy * vy + vz * vz));
  const cpsi = -(vx * C[0] + vy * C[1] + vz * C[2]) / r;
  const psi = Math.acos(Math.max(-1, Math.min(1, cpsi)));
  const phi = Math.atan2(vx * N[0] + vy * N[1] + vz * N[2], vx * E[0] + vy * E[1] + vz * E[2]);
  out[0] = r; out[1] = psi; out[2] = phi; out[3] = earthBiteRadius(phi, psi, bite, b);
  return out;
}

/** Punkt kuli Ziemi (kierunek jednostkowy) w obszarze wyciętym (z zapasem cutPad)? */
export function earthBiteCutsSphere(dx, dy, dz, bite = EARTH_BITE, b = bite.radiusR, frame = earthBiteFrame(bite)) {
  const c = earthBiteCoords(dx, dy, dz, bite, b, frame, _c);
  return c[0] < c[3] + bite.cutPad;
}
const _c = new Float64Array(4);

/**
 * Siatka łaty (układ obiektu kuli o promieniu 1): ŚCIANY I DNO (pierścienie ψ ∈ [0, ψ_brzeg(φ)] × azymut,
 * wierzchołek C + β u) i KOŁNIERZ brzegu na kuli (cięciwa od β_brzeg do β_brzeg + skirtPad, wał lipKm).
 * Normalna = promieniowa (oświetlenie ze wzoru liczy fragment), uv jak SphereGeometry. Trójkąty CCW
 * patrząc z wnętrza gryzu / spoza kuli (twarz ku obserwatorowi przez otwór).
 */
export function buildEarthBitePatch(bite = EARTH_BITE, { b = bite.radiusR, rings = 150, segments = 540, skirtRings = 10 } = {}) {
  const { C, E, N } = earthBiteFrame(bite);
  const S = segments + 1;
  const R = rings + 1 + skirtRings;
  const pos = new Float32Array(R * S * 3);
  const nrm = new Float32Array(R * S * 3);
  const uv = new Float32Array(R * S * 2);
  const lip = bite.lipKm / EARTH_RADIUS_KM;
  let v = 0;
  const put = (x, y, z, rr) => {
    const l = Math.sqrt(x * x + y * y + z * z);
    const dx = x / l, dy = y / l, dz = z / l;
    pos[v * 3] = dx * rr; pos[v * 3 + 1] = dy * rr; pos[v * 3 + 2] = dz * rr;
    nrm[v * 3] = dx; nrm[v * 3 + 1] = dy; nrm[v * 3 + 2] = dz;
    const lon = Math.atan2(-dz, dx);
    const lat = Math.asin(Math.max(-1, Math.min(1, dy)));
    uv[v * 2] = (lon + Math.PI) / TAU;
    uv[v * 2 + 1] = 0.5 + lat / Math.PI;
    v++;
  };
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j < S; j++) {
      const phi = (j / segments) * TAU;
      const psiRim = earthBiteRimPsi(phi, bite, b);
      // gęściej przy brzegu (ściana pod brzegiem i zęby) — ψ = ψ_brzeg · (1 − (1 − f)^1,35)
      const f = i / rings;
      const psi = psiRim * (1 - Math.pow(1 - f, 1.35));
      const beta = i === rings ? earthBiteRimRadius(phi, bite, b) : earthBiteRadius(phi, psi, bite, b);
      const cp = Math.cos(phi), sp = Math.sin(phi), cs = Math.cos(psi), ss = Math.sin(psi);
      const ux = -cs * C[0] + ss * (cp * E[0] + sp * N[0]);
      const uy = -cs * C[1] + ss * (cp * E[1] + sp * N[1]);
      const uz = -cs * C[2] + ss * (cp * E[2] + sp * N[2]);
      const x = C[0] + beta * ux, y = C[1] + beta * uy, z = C[2] + beta * uz;
      put(x, y, z, i === rings ? 1 : Math.sqrt(x * x + y * y + z * z));
    }
  }
  for (let i = 1; i <= skirtRings; i++) {
    for (let j = 0; j < S; j++) {
      const phi = (j / segments) * TAU;
      const t = i / skirtRings;
      const d = earthBiteRimRadius(phi, bite, b) + bite.skirtPad * t;
      const th = 2 * Math.asin(Math.min(1, d / 2));
      const cp = Math.cos(phi), sp = Math.sin(phi), ct = Math.cos(th), st = Math.sin(th);
      put(ct * C[0] + st * (cp * E[0] + sp * N[0]), ct * C[1] + st * (cp * E[1] + sp * N[1]),
        ct * C[2] + st * (cp * E[2] + sp * N[2]), 1 + lip * Math.sin(Math.PI * t) * (1 - t));
    }
  }
  const index = new Uint32Array((R - 1) * segments * 6);
  let k = 0;
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * S + j, bb = a + 1, c = a + S, d = c + 1;
      // ψ (i) rośnie ku brzegowi, φ (j) — przeciwnie do zegara patrząc z zewnątrz: twarz ku wnętrzu gryzu
      index[k++] = a; index[k++] = c; index[k++] = bb;
      index[k++] = bb; index[k++] = c; index[k++] = d;
    }
  }
  return { position: pos, normal: nrm, uv, index, cavityRings: rings + 1, segments };
}
