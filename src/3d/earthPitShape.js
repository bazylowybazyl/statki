// Kształt wielkiej kopalni ringu na Ziemi (dane: src/data/earthPit.js) — czysty moduł, bez three.
//
// Profil to LUSTRO trzech miejsc: generatora map (scripts/planety/dziura.py, `profil`), węzła TSL
// (src/3d/earthPit.tsl.js, `earthPitProfile`) i siatki łaty (`buildEarthPitPatch` niżej). Zmiana
// wzoru = zmiana we wszystkich trzech (tests/earthPit.test.mjs pilnuje CPU ↔ dane).
//
// Układ obiektu kuli planety (THREE.SphereGeometry, u = 0 na 180° W): kierunek (lon, lat) =
// (cos lat · cos lon, sin lat, −cos lat · sin lon); uv = ((lon + π) / 2π, ½ + lat / π).
import { EARTH_PIT } from '../data/earthPit.js';

export const EARTH_RADIUS_KM = 6371.0;
const DEG = Math.PI / 180;

function dirOf(lonDeg, latDeg) {
  const lo = lonDeg * DEG, la = latDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
}

/** Rama dziury w układzie obiektu kuli: środek C, wschód E, północ N (jednostkowe, ortogonalne). */
export function earthPitFrame(pit = EARTH_PIT) {
  const lo = pit.lon * DEG, la = pit.lat * DEG;
  const C = dirOf(pit.lon, pit.lat);
  const E = [-Math.sin(lo), 0, -Math.cos(lo)];
  const N = [-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)];
  return { C, E, N, radiusAng: pit.radiusKm / EARTH_RADIUS_KM };
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Promień obrysu (rad) w azymucie phi (0 = wschód, ku północy). */
export function earthPitOutline(phi, pit = EARTH_PIT) {
  let ob = 1;
  for (const [k, amp, ph] of pit.lobes) ob += amp * Math.cos(k * (phi - ph * DEG));
  return (pit.radiusKm / EARTH_RADIUS_KM) * ob;
}

/**
 * Profil w kierunku o rzutach (a, b, cz) na E, N, C: wysokość względem krawędzi [km] (bez
 * przewyższenia), s (0 środek, 1 krawędź), azymut, ułamek tarasu. Zapis do `out` (4 liczby).
 */
export function earthPitProfileCpu(a, b, cz, pit = EARTH_PIT, out = new Float64Array(4)) {
  const rho = Math.atan2(Math.sqrt(a * a + b * b), cz);
  const phi = Math.atan2(b, a);
  const s = rho / earthPitOutline(phi, pit);
  const n = pit.benches;
  const f0 = 1 - Math.min(1, Math.max(0, (s - pit.floor) / (1 - pit.floor)));
  const f = f0 + pit.benchWarp * (0.5 + 0.5 * Math.sin(2 * phi + 1)) * Math.sin(Math.PI * pit.benchWarpWaves * f0);
  const q = f * n;
  const k = Math.floor(q);
  const depth = pit.depthKm * (k + smooth(1 - pit.riser, 1, q - k)) / n;
  const r = s / pit.shaftR;
  const shaft = pit.shaftDepthKm * Math.sqrt(Math.max(0, 1 - r * r));
  const berm = pit.rimBermKm * Math.sin(Math.PI * Math.min(1, Math.max(0, (s - 1) / pit.rimWidth)));
  out[0] = berm - depth - shaft;
  out[1] = s;
  out[2] = phi;
  out[3] = q - k;
  return out;
}

/** s, poniżej którego kula planety jest wycięta (łata przykrywa trochę więcej — EARTH_PIT_PATCH_S). */
export const EARTH_PIT_CUT_S = 1 + EARTH_PIT.rimWidth + 0.015;
export const EARTH_PIT_PATCH_S = 1 + EARTH_PIT.rimWidth + 0.035;

/**
 * Siatka łaty (układ obiektu kuli o promieniu 1): pierścienie w s × azymut, wierzchołek na
 * kierunku z profilu, promień 1 + h · przewyższenie / R. Normalna = promieniowa (oświetlenie
 * ze wzoru liczy fragment), uv jak SphereGeometry.
 */
export function buildEarthPitPatch(pit = EARTH_PIT, { rings = 300, segments = 360 } = {}) {
  const { C, E, N } = earthPitFrame(pit);
  const exag = pit.exaggeration;
  const sMax = EARTH_PIT_PATCH_S;
  // pierścienie gęściej przy krawędzi szybu (stroma ściana)
  const sList = [];
  for (let i = 0; i <= rings; i++) sList.push(sMax * i / rings);
  for (let i = 1; i < 24; i++) sList.push(pit.shaftR * (0.9 + 0.2 * i / 24));
  sList.sort((x, y) => x - y);
  const R = sList.length;
  const S = segments + 1;
  const pos = new Float32Array(R * S * 3);
  const nrm = new Float32Array(R * S * 3);
  const uv = new Float32Array(R * S * 2);
  const prof = new Float64Array(4);
  let v = 0;
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < S; j++, v++) {
      const phi = (j / segments) * Math.PI * 2;
      const rho = sList[i] * earthPitOutline(phi, pit);
      const cr = Math.cos(rho), sr = Math.sin(rho), cp = Math.cos(phi), sp = Math.sin(phi);
      const dx = cr * C[0] + sr * (cp * E[0] + sp * N[0]);
      const dy = cr * C[1] + sr * (cp * E[1] + sp * N[1]);
      const dz = cr * C[2] + sr * (cp * E[2] + sp * N[2]);
      earthPitProfileCpu(sr * cp, sr * sp, cr, pit, prof);
      const r = 1 + (prof[0] * exag) / EARTH_RADIUS_KM;
      pos[v * 3] = dx * r; pos[v * 3 + 1] = dy * r; pos[v * 3 + 2] = dz * r;
      nrm[v * 3] = dx; nrm[v * 3 + 1] = dy; nrm[v * 3 + 2] = dz;
      const lon = Math.atan2(-dz, dx);
      const lat = Math.asin(Math.max(-1, Math.min(1, dy)));
      uv[v * 2] = (lon + Math.PI) / (Math.PI * 2);
      uv[v * 2 + 1] = 0.5 + lat / Math.PI;
    }
  }
  const index = new Uint32Array((R - 1) * segments * 6);
  let k = 0;
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * S + j, b = a + 1, c = a + S, d = c + 1;
      // CCW patrząc z zewnątrz kuli (jak SphereGeometry): s rośnie na zewnątrz, azymut — przeciwnie do zegara
      index[k++] = a; index[k++] = c; index[k++] = b;
      index[k++] = b; index[k++] = c; index[k++] = d;
    }
  }
  return { position: pos, normal: nrm, uv, index };
}
