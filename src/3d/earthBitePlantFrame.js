// Elektrownia „KOREK” w wielkim gryzie Ziemi — wspólna rama, układ i pomocnicy geometrii CPU (bez materiałów).
//
// Układ: obiekt kuli Ziemi (R = 1, earthBiteShape.js). RAMA ELEKTROWNI: Y = oś A (= C, środek gryzu), X = E (wschód),
// Z = −N; początek na dnie gryzu (A · z0, z0 = 1 − β bazowe), więc y = wysokość nad dnem. Każda część (moduł komponentu)
// buduje geometrię w tej ramie; orkiestrator (earthBitePlant.js) scala części jednego materiału i przenosi je macierzą
// `plantFrameMatrix` do układu obiektu kuli.
//
// KONTRAKT CZĘŚCI (`finalizePart`): atrybuty position, normal, uv i `aPart` (vec4: x — rodzaj powierzchni PART, y — ziarno
// części 0…1, z — parametr rodzaju, w — drugi parametr), indeks. Rodzaj wybiera gałąź materiału; znaczenie z / w i uv
// per rodzaj — przy PART niżej i w docs/BRIEF-korek.md.
// Losowość geometrii: generatory z ziarnem (`plantRng`), nigdy Math.random (zasada żelazna 9).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EARTH_BITE } from '../data/earthBite.js';
import { earthBiteFrame, earthBiteRadius, earthBiteRimAngle, earthBiteRimPsi } from './earthBiteShape.js';
import { FxRandom } from '../render/fxRandomCore.js';

export const DEG = Math.PI / 180;

/**
 * Rodzaje powierzchni (aPart.x). Materiał metalu: 0–7, materiał przepływu (rury, liny): 8–9. Przy każdym — znaczenie
 * aPart.z / aPart.w (0 = wartość domyślna rodzaju) i uv.
 */
export const PART = Object.freeze({
  HULL: 0,    // czarny kadłub megastruktury (panele, szwy, drobne światła)
  STRUCT: 1,  // stal konstrukcyjna (żebra, kratownice, wsporniki) — ciemniejsza, bez okien i szwów
  WINDOW: 2,  // pasy okien (ciepłe punkty, nocą wyraźniej); z — gęstość zapalonych 0…1
  STRIP: 3,   // świecąca listwa (cała powierzchnia); z — jasność ×, w — barwa: 0 ciepła, 1 chłodna (energia)
  COIL: 4,    // cewka / pierścień energii (barwa promienia, puls); z — faza 0…1, w — jasność ×
  HOT: 5,     // gorący wymiennik / styk z lawą; z — żar 0…1 per wierzchołek
  BEACON: 6,  // światło pozycyjne (miga, faza z aPart.y); z — częstotliwość [Hz], w — barwa: 0 czerwona, 1 biała
  GLASS: 7,   // ciemne szkło / czasze (odblask nieba i słońca)
  PIPE: 8,    // przewód energii: uv.y — droga od źródła 0…1, z — długość drogi [R], w — kierunek impulsów (±1)
  TETHER: 9   // lina windy: uv.y — 0 kotwica … 1 odbiornik, z — długość [R], w — pas kabin (+1 w górę, −1 w dół)
});

/**
 * Układ wspólny komponentów (R Ziemi; h — wysokość nad dnem gryzu). Klucze komponentów mają przedrostki
 * (cork*, lining*, elev*, hub*, beam*, mat*) i leżą w ich modułach; orkiestrator scala je w PLANT_DEFAULTS.
 */
export const PLANT_LAYOUT = Object.freeze({
  corkR: 0.13,        // promień wierzchu korka (krawędź z kołnierzem)
  corkTopH: 0.053,    // wysokość wierzchu korka nad dnem
  apertureH: 0.073,   // wysokość krawędzi krateru wylotu promienia
  apertureR: 0.0155,  // promień gardzieli wylotu
  hubRadius: 1.075,   // odbiornik na orbicie: promień od środka Ziemi (pod ringiem 1,09–1,16 R)
  hubRing: 0.05,      // promień pierścienia odbiornika
  elevators: [30, 90, 150, 210, 270, 330],   // azymuty wind w ramie gryzu (0 — wschód, 90 — północ)
  anchorPad: 0.015,   // odsunięcie kotwic wind za krawędź gryzu [rad]
  ringInnerR: 41800 / 37800,   // wewnętrzna krawędź ringu „Halo” Ziemi (layout.radii.min / promień Ziemi gry) [R]
  footH: 0.045,       // STOPA ŚCIANY: wysokość, na której mosty korka (nad lawą, w azymutach wind) dochodzą do ściany gryzu,
                      // a zaczynają się przewody obudowy (pierścień przy stopie i przewody w górę ścian)
  timeScale: 1
});

export const plantZ0 = (b = EARTH_BITE.radiusR) => 1 - b;

/** Wysokość odbiornika nad dnem gryzu (rama elektrowni). */
export const hubHeight = (L, b = EARTH_BITE.radiusR) => L.hubRadius - plantZ0(b);

/** Macierz: rama elektrowni → układ obiektu kuli. */
export function plantFrameMatrix(b = EARTH_BITE.radiusR, out = new THREE.Matrix4()) {
  const { C, E, N } = earthBiteFrame(EARTH_BITE);
  const z0 = plantZ0(b);
  return out.set(
    E[0], C[0], -N[0], C[0] * z0,
    E[1], C[1], -N[1], C[1] * z0,
    E[2], C[2], -N[2], C[2] * z0,
    0, 0, 0, 1
  );
}

/** Punkt na kuli o promieniu r pod kątem th od C w azymucie phi — w ramie elektrowni. */
export function surfacePoint(th, phi, r, z0, out = new THREE.Vector3()) {
  return out.set(Math.sin(th) * Math.cos(phi) * r, Math.cos(th) * r - z0, -Math.sin(th) * Math.sin(phi) * r);
}

/** Pion miejsca na kuli (kierunek od środka Ziemi) dla kąta th i azymutu phi — w ramie elektrowni. */
export function surfaceUp(th, phi, out = new THREE.Vector3()) {
  return out.set(Math.sin(th) * Math.cos(phi), Math.cos(th), -Math.sin(th) * Math.sin(phi));
}

/** Środek kuli gryzu (C) w ramie elektrowni. */
export function biteCenter(b = EARTH_BITE.radiusR, out = new THREE.Vector3()) {
  return out.set(0, b, 0);
}

/**
 * Punkt na ścianie / dnie gryzu w kierunku (phi, psi) od C (psi — kąt od dna), uniesiony o `lift` ku C (nad ścianę) —
 * w ramie elektrowni. Dokładny kształt β(φ, ψ) (płaty, zęby).
 */
export function bowlPoint(phi, psi, lift, b, z0, out = new THREE.Vector3()) {
  const { C, E, N } = earthBiteFrame(EARTH_BITE);
  const beta = earthBiteRadius(phi, psi, EARTH_BITE, b) - lift;
  const cp = Math.cos(phi), sp = Math.sin(phi), cs = Math.cos(psi), ss = Math.sin(psi);
  const u = [0, 1, 2].map((k) => -cs * C[k] + ss * (cp * E[k] + sp * N[k]));
  const p = [0, 1, 2].map((k) => C[k] + beta * u[k]);
  const d = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  return out.set(d(p, E), d(p, C) - z0, -d(p, N));
}

/** Kąt ψ (od dna, w azymucie phi), na którym ściana gryzu leży na wysokości h nad dnem (bisekcja po dokładnym β). */
export function bowlPsiAtHeight(phi, h, b = EARTH_BITE.radiusR) {
  const z0 = plantZ0(b);
  const p = new THREE.Vector3();
  let lo = 0, hi = rimPsi(phi, b);
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) * 0.5;
    if (bowlPoint(phi, mid, 0, b, z0, p).y < h) lo = mid; else hi = mid;
  }
  return (lo + hi) * 0.5;
}

/** Stopa ściany w azymucie phi (wysokość L.footH), uniesiona o `lift` nad ścianę — rama elektrowni. */
export function wallFootPoint(L, b, phi, lift = 0, out = new THREE.Vector3()) {
  return bowlPoint(phi, bowlPsiAtHeight(phi, L.footH, b), lift, b, plantZ0(b), out);
}

/** Normalna ściany gryzu skierowana do wnętrza (≈ ku środkowi kuli gryzu) w punkcie P ramy. */
export function bowlInward(P, b, out = new THREE.Vector3()) {
  return biteCenter(b, out).sub(P).normalize();
}

/** Kąt brzegu gryzu od C (rad) i kąt ψ brzegu w azymucie phi. */
export const rimAngle = (phi, b = EARTH_BITE.radiusR) => earthBiteRimAngle(phi, EARTH_BITE, b);
export const rimPsi = (phi, b = EARTH_BITE.radiusR) => earthBiteRimPsi(phi, EARTH_BITE, b);

/** Generator z ziarnem dla geometrii (powtarzalny, nie zużywa strumienia efektów). */
export const plantRng = (seed) => new FxRandom(seed >>> 0);

/** Macierz bazy z osią Y = `up` (i X prostopadłym do `up` i `hint`), w punkcie `at`. */
export function basisAt(up, at, hint = new THREE.Vector3(0, 0, 1), out = new THREE.Matrix4()) {
  const y = up.clone().normalize();
  let x = new THREE.Vector3().crossVectors(y, hint);
  if (x.lengthSq() < 1e-10) x = new THREE.Vector3().crossVectors(y, new THREE.Vector3(1, 0, 0));
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return out.makeBasis(x, y, z).setPosition(at);
}

/** Walec P → Q (uv.y: 0 przy P, 1 przy Q). */
export function cylinderBetween(P, Q, r, seg = 8, open = true, r1 = r) {
  const d = new THREE.Vector3().subVectors(Q, P);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r1, r, len, seg, 1, open);
  const uvA = g.attributes.uv;
  for (let i = 0; i < uvA.count; i++) uvA.setY(i, 1 - uvA.getY(i));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((P.x + Q.x) / 2, (P.y + Q.y) / 2, (P.z + Q.z) / 2);
  return g;
}

/**
 * Część gotowa do scalenia: indeks, normalne, uv i `aPart` (rodzaj, ziarno, parametr, w). `param` i `w` — liczba (stała)
 * albo funkcja (i, x, y, z) → wartość per wierzchołek (pozycja w ramie elektrowni).
 */
export function finalizePart(g, kind, seed = 0, param = 0, w = 0) {
  if (g.index === null) g.setIndex([...Array(g.attributes.position.count).keys()]);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  }
  const a = new Float32Array(n * 4);
  const pos = g.attributes.position;
  for (let i = 0; i < n; i++) {
    a[i * 4] = kind;
    a[i * 4 + 1] = seed;
    a[i * 4 + 2] = typeof param === 'function' ? param(i, pos.getX(i), pos.getY(i), pos.getZ(i)) : param;
    a[i * 4 + 3] = typeof w === 'function' ? w(i, pos.getX(i), pos.getY(i), pos.getZ(i)) : w;
  }
  g.setAttribute('aPart', new THREE.BufferAttribute(a, 4));
  g.morphAttributes = {};
  return g;
}

/** Scala części (rama elektrowni) i przenosi je do układu obiektu kuli. Pusta lista → pusta geometria. */
export function mergeParts(parts, matrix) {
  if (!parts.length) return new THREE.BufferGeometry();
  const geo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!geo) throw new Error('earthBitePlant: części o różnych atrybutach (finalizePart)');
  if (matrix) geo.applyMatrix4(matrix);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Najbliższy punkt WEWNĘTRZNEJ KRAWĘDZI RINGU (okrąg o promieniu `innerR` w płaszczyźnie równika osi obrotu `axis`,
 * środek w środku Ziemi) do punktu P — wszystko w układzie obiektu kuli. Ring w układzie Ziemi stoi (earthSpin.js).
 */
export function ringPointObject(P, axis, innerR, out = new THREE.Vector3()) {
  out.copy(P).addScaledVector(axis, -P.dot(axis));
  if (out.lengthSq() < 1e-12) out.set(1, 0, 0).addScaledVector(axis, -axis.x);
  return out.normalize().multiplyScalar(innerR);
}

/** Czy odcinek P → Q (układ obiektu kuli) omija kulę o promieniu r wokół środka Ziemi. */
export function segmentClearsSphere(P, Q, r = 1) {
  const dx = Q.x - P.x, dy = Q.y - P.y, dz = Q.z - P.z;
  const dd = dx * dx + dy * dy + dz * dz;
  const t = dd > 0 ? Math.max(0, Math.min(1, -(P.x * dx + P.y * dy + P.z * dz) / dd)) : 0;
  const x = P.x + dx * t, y = P.y + dy * t, z = P.z + dz * t;
  return x * x + y * y + z * z > r * r;
}

/** Macierz odwrotna ramy: układ obiektu kuli → rama elektrowni (np. oś obrotu Ziemi w ramie). */
export function objectToFrameMatrix(b = EARTH_BITE.radiusR, out = new THREE.Matrix4()) {
  return out.copy(plantFrameMatrix(b)).invert();
}
