// src/3d/cargo/cargoLight.tsl.js
//
// ŚWIATŁO ŁADOWNI (zadanie 26, demo dema/ladownia-webgpu.html) — wspólne klocki TSL dla
// wnętrza ładowni, skrzydeł wrót, kontenerów i dronów (bayInterior / bayDoors / containers /
// drones .tsl.js). Model jak kadłub gry (hexShips3D.tsl.js): otoczenie 0,24 · sunFill,
// rozproszone 1,18 · max(N·L, 0), połysk 0,30 · (N·H)^p — L to „słońce kadłubów” (azymut
// Słońca, prawie w płaszczyźnie gry: normalize(słońce − statek, z = 600)); maska Core3D
// (sunVisibility) gasi człon słońca jak na kadłubach. Do tego:
//   • CIEŃ KRAWĘDZI OTWORU: punkt we wnętrzu widzi słońce, gdy promień ku „słońcu cieni”
//     (azymut Słońca, wysokość 30° — konwencja cieni mostków i kontenerów Z5) wychodzi przez
//     ODSŁONIĘTĄ część otworu (|a| < halfA, |b| < open · halfB — skrzydła kryją resztę);
//   • LAMPY: rzędy lamp pod krawędzią obu długich ścian (świecą w dół i do środka), zapalane
//     falą wzdłuż ładowni z migotaniem świetlówek; plus rozproszone odbicie (fill) we wnętrzu;
//   • OTOCZENIE WE WNĘTRZU: przysłonięte przez ściany i wrota (mniej nieba głęboko i przy
//     ścianach, prawie nic przy zamkniętych wrotach).
//
// TABLICA ŁADOWNI (CargoBayTable): uniformArray vec4 × 4 na ładownię, stała nazwa bloku
// (jeden WGSL dla wszystkich materiałów). Rekord k:
//   [0] środek ładowni w świecie (x, y), cos i sin kursu osi a,
//   [1] halfA, halfB, głębokość, liczba lamp na ścianę,
//   [2] odsłonięta połowa otworu (open · halfB) [j.], fala lamp 0…1, odstęp lamp, ziarno,
//   [3] koguty 0/1, kieszeń: dół skrzydeł pocketDrop (0 = over), grubość skrzydła, z lamp.
// Wnętrze czyta rekord po indeksie obiektu, kontenery i drony po indeksie z instancji
// (−1 = poza ładownią: samo słońce).
//
// Zasady portu (PLAN §3): funkcje bez setLayout (uniformy i tablice w domknięciu wklejane
// w miejscu wywołania), pętle z nazwanym indeksem, smoothstep bez stałych odwróconych
// krawędzi, pochodne przed gałęziami zależnymi od piksela.
import * as THREE from 'three/webgpu';
import {
  Loop, abs, clamp, dot, exp, float, floor, fract, int, length, max, min, mix, normalize, pow, renderGroup,
  select, sin, smoothstep, uniform, uniformArray, vec2, vec3
} from 'three/tsl';
import { sunFill, sunVisibility } from '../sunShadowMask.js';
import { cargoBayLampZ } from '../../data/cargoBays.js';

/** Najwięcej ładowni w tablicy (scena: kadłuby galerii + statek sceny). */
export const CARGO_MAX_BAYS = 40;
const REC = 4;

const shared = (value, type) => uniform(value, type).setGroup(renderGroup);

/**
 * Wspólne uniformy światła ładowni (grupa renderu — jeden zapis na render dla wszystkich
 * materiałów). Wartości domyślne = SHIP_LIGHT_DEFAULTS kadłubów gry.
 */
export const CARGO_LIGHT = Object.freeze({
  /** „Słońce kadłubów”: kierunek DO słońca w świecie sceny (z ≈ 600 / odległość). */
  sunDir: shared(new THREE.Vector3(-0.62, 0.78, 0.02).normalize()),
  /** „Słońce cieni”: azymut Słońca, wysokość 30° (cienie mostków i kontenerów). */
  shadowDir: shared(new THREE.Vector3(-0.62 * 0.866, 0.78 * 0.866, 0.5).normalize()),
  ambient: shared(0.24),
  diffuse: shared(1.18),
  specular: shared(0.30),
  lampColor: shared(new THREE.Vector3(1.0, 0.86, 0.66)),
  lampGain: shared(1.0),
  fillGain: shared(0.05),
  time: shared(0)
});

/** Ustawia oba słońca z azymutu [rad, w płaszczyźnie sceny] i wysokości cieni [°]. */
export function setCargoSun(azimuth, shadowElevDeg = 30, hullZ = 0.02) {
  const cx = Math.cos(azimuth);
  const cy = Math.sin(azimuth);
  CARGO_LIGHT.sunDir.value.set(cx, cy, hullZ).normalize();
  const e = THREE.MathUtils.degToRad(shadowElevDeg);
  CARGO_LIGHT.shadowDir.value.set(cx * Math.cos(e), cy * Math.cos(e), Math.sin(e));
}

// ---------------------------------------------------------------------------
// Tablica ładowni
// ---------------------------------------------------------------------------

const _rows = Array.from({ length: CARGO_MAX_BAYS * REC }, () => new THREE.Vector4());
/** Węzeł tablicy (wspólny dla wszystkich materiałów ładowni). */
export const cargoBayTableNode = uniformArray(_rows, 'vec4').setName('cargoBayTable');

/**
 * CPU: rekordy ładowni. set(k, geo, x, y, yaw, pose, seed) — geo: cargoBayGeometry,
 * (x, y, yaw) — środek i kurs osi a w świecie sceny, pose — cargoBayDoorPose.
 */
export const CargoBayTable = {
  rows: _rows,
  count: 0,
  set(k, geo, x, y, yaw, pose, seed = 0) {
    if (k < 0 || k >= CARGO_MAX_BAYS) return;
    const r = k * REC;
    _rows[r].set(x, y, Math.cos(yaw), Math.sin(yaw));
    _rows[r + 1].set(geo.halfA, geo.halfB, geo.depth, geo.lamps);
    _rows[r + 2].set((pose?.open ?? 1) * geo.halfB, pose?.lamps ?? 1, geo.lampSpacing, seed);
    _rows[r + 3].set(pose?.warn ?? 0, geo.pocketDrop || 0, geo.leafT, cargoBayLampZ(geo));
    this.count = Math.max(this.count, k + 1);
  }
};

export { cargoBayLampZ };

/** Rekord ładowni k (int) jako cztery vec4. */
export function bayRecord(k) {
  const b = int(k).mul(REC);
  return {
    r0: cargoBayTableNode.element(b),
    r1: cargoBayTableNode.element(b.add(1)),
    r2: cargoBayTableNode.element(b.add(2)),
    r3: cargoBayTableNode.element(b.add(3))
  };
}

/** Świat sceny → układ ładowni (a, b, z) i kierunek świata → układ ładowni. */
export function bayToLocal(rec, pw) {
  const d = pw.xy.sub(rec.r0.xy);
  const c = rec.r0.z;
  const s = rec.r0.w;
  return vec3(d.x.mul(c).add(d.y.mul(s)), d.y.mul(c).sub(d.x.mul(s)), pw.z);
}
export function dirToLocal(rec, v) {
  const c = rec.r0.z;
  const s = rec.r0.w;
  return vec3(v.x.mul(c).add(v.y.mul(s)), v.y.mul(c).sub(v.x.mul(s)), v.z);
}

// ---------------------------------------------------------------------------
// Funkcje światła (układ ładowni)
// ---------------------------------------------------------------------------

/** Hash 2D → [0, 1) (sin, wejścia całkowite: numer lampy, takt czasu). */
export function cargoHash(p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
}

/**
 * Widoczność „słońca cieni” dla punktu P (układ ładowni, z < 0): promień do z = 0 musi
 * wyjść przez odsłoniętą część otworu. Półcień rośnie z drogą (ostrzej przy krawędzi).
 */
export function bayRimVisibility(P, S, halfA, openHalf) {
  const t = max(P.z.negate(), 0.0).div(max(S.z, 0.05));
  const q = P.xy.add(S.xy.mul(t));
  const pen = t.mul(0.05).add(0.3);
  const va = smoothstep(pen.negate(), pen, halfA.sub(abs(q.x)));
  const vb = smoothstep(pen.negate(), pen, openHalf.sub(abs(q.y)));
  return select(P.z.lessThan(-0.02), va.mul(vb), float(1.0));
}

/**
 * Poziom lampy k (0…1): fala zapalania wzdłuż ładowni — lampa k rusza przy fali
 * (k + ½)/n · (1 + w) — z migotaniem świetlówki, zanim zapali się na stałe.
 */
export function bayLampLevel(rec, kf) {
  const n = rec.r1.w;
  const wave = rec.r2.y;
  const seed = rec.r2.w;
  const w = float(0.3);
  const on = clamp(wave.mul(w.add(1.0)).sub(kf.add(0.5).div(max(n, 1.0))).div(w), 0.0, 1.0).toVar();
  const tick = floor(CARGO_LIGHT.time.mul(17.0));
  const flick = select(cargoHash(vec2(kf.add(seed.mul(37.0)), tick)).greaterThan(0.45), float(1.0), float(0.15));
  return select(on.lessThan(0.999), on.mul(flick), on);
}

/**
 * Lampy ładowni w punkcie P z normalną N (układ ładowni) → irradiancja rgb (bez albedo).
 * rec — rekord z tablicy; lampy na a_k = −halfA + (k + ½)·odstęp, b = ±(halfB − 0,6),
 * z = rec.r3.w (pod krawędzią; przy kieszeni pod szczeliną skrzydeł), świecą w dół
 * i do środka; poziom z fali (bayLampLevel).
 */
export function bayLampLight(rec, P, N) {
  const halfA = rec.r1.x;
  const halfB = rec.r1.y;
  const n = rec.r1.w;
  const spacing = rec.r2.z;
  const lampZ = rec.r3.w;
  const acc = vec3(0.0).toVar();
  // Zasięg lampy ~ głębokość ładowni: kałuże światła przy ścianach, środek szerokiej ładowni
  // ciemniejszy (głębia czyta się ze spadku, nie z cienia).
  const r0 = rec.r1.z.mul(1.1).add(6.0).toVar();
  Loop({ start: int(0), end: int(n), type: 'int', condition: '<', name: 'cargoLamp' }, ({ cargoLamp }) => {
    const kf = float(cargoLamp);
    const a = halfA.negate().add(kf.add(0.5).mul(spacing));
    const level = bayLampLevel(rec, kf).toVar();
    for (const side of [1, -1]) {
      const lp = vec3(a, halfB.sub(0.6).mul(side), lampZ);
      const d = lp.sub(P);
      const dist = max(length(d), 0.05);
      const L = d.div(dist);
      const cosN = max(dot(N, L), 0.0);
      const dir = normalize(vec3(0.0, -0.45 * side, -1.0));
      const spot = smoothstep(0.35, 0.9, dot(L.negate(), dir));
      const x = dist.div(r0);
      const att = float(1.0).div(x.mul(x).add(1.0));
      acc.addAssign(vec3(cosN.mul(spot).mul(att).mul(level)));
    }
  });
  return acc.mul(CARGO_LIGHT.lampColor).mul(CARGO_LIGHT.lampGain).mul(0.75);
}

/**
 * Otoczenie we wnętrzu: udział nieba przysłonięty ścianami (głęboko i przy ścianach mniej)
 * i wrotami (open · halfB). 1 nad otworem.
 */
export function bayAmbientOcclusion(rec, P) {
  const halfA = rec.r1.x;
  const halfB = rec.r1.y;
  const openHalf = rec.r2.x;
  const below = max(P.z.negate(), 0.0);
  const edge = max(min(halfA.sub(abs(P.x)), halfB.sub(abs(P.y))), 0.0);
  const walls = smoothstep(0.0, 1.0, edge.add(0.5).div(below.mul(0.9).add(1.0)));
  const doors = clamp(openHalf.div(max(halfB, 1.0)), 0.0, 1.0);
  const sky = mix(float(0.3), float(1.0), walls).mul(mix(float(0.12), float(1.0), doors));
  return select(P.z.lessThan(-0.02), sky, float(1.0));
}

/** Rozproszone odbicie lamp we wnętrzu (fill), zależne od fali lamp i otwarcia. */
export function bayFillLight(rec, P, N) {
  const wave = rec.r2.y;
  const inside = select(P.z.lessThan(0.5), float(1.0), float(0.0));
  const up = N.z.mul(0.35).add(0.65);
  return vec3(wave.mul(inside).mul(up)).mul(CARGO_LIGHT.lampColor).mul(CARGO_LIGHT.fillGain);
}

/**
 * Model światła kadłuba gry: albedo · (otoczenie · sunFill(vis) · occl + rozproszone · vis
 * + lampy + fill) + połysk · vis. Nw, Lw — normalna i słońce w TYM SAMYM układzie.
 * Jasne powierzchnie łagodnie pod progiem bloomu (0,86 jak model mostka).
 */
export function cargoShade(albedo, Nw, Lw, vis, occl, lamp, specK = 0.6, specPow = 24.0) {
  const ndl = dot(Nw, Lw);
  const sun = vis.mul(sunVisibility());
  const amb = CARGO_LIGHT.ambient.mul(sunFill(sun)).mul(occl);
  const col = albedo.mul(vec3(amb.add(max(ndl, 0.0).mul(CARGO_LIGHT.diffuse).mul(sun))).add(lamp)).toVar();
  const H = normalize(Lw.add(vec3(0.0, 0.0, 1.0)));
  const sp = pow(max(dot(Nw, H), 0.0), specPow).mul(smoothstep(-0.02, 0.08, ndl)).mul(CARGO_LIGHT.specular).mul(specK).mul(sun);
  col.addAssign(vec3(sp));
  return col;
}

/** Łagodny sufit jasności powierzchni (bez bloomu na płytach i farbie). */
export function cargoSurfaceCap(col) {
  const lum = dot(col, vec3(0.2126, 0.7152, 0.0722)).toVar();
  const capped = col.mul(float(0.62).add(float(0.24).mul(float(1.0).sub(exp(lum.sub(0.62).negate().div(0.24))))).div(max(lum, 1e-4)));
  return select(lum.greaterThan(0.62), capped, col);
}

/** smoothstep z krawędziami e0 > e1 (WGSL nie przyjmuje stałych odwróconych krawędzi). */
export function smoothDown(e0, e1, x) {
  return float(1.0).sub(smoothstep(e1, e0, x));
}
