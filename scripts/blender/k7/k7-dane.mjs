// scripts/blender/k7/k7-dane.mjs
//
// DANE HALI K-7 DLA BLENDERA (pilot „hala K-7 z Blendera”, docs/PILOT-blender-k7.md): wszystkie wymiary modeli
// z gry — stałe układu (haloPortK7Layout.js: K7_FUEL_STATION, K7_FUEL_FARM, K7_HEIGHTS, K7_ABOVE_SCALE,
// K7_GATE_LINTEL, bramy, ściany) i BRYŁY REFERENCYJNE każdego elementu: surowe wywołania rejestratora
// haloPortK7Build.js (Recorder.place + capture) przeniesione do układu lokalnego elementu. Skrypt Blendera
// (scripts/blender/k7/k7_hala.py) buduje z nich modele — zero przepisanych liczb: model, stara hala i kolizje
// z jednego źródła. Hasz danych (`hash`) trafia do GLB (extras sceny); test tests/haloPortK7Glb.test.mjs
// porównuje go z bieżącym eksportem (zmiana wymiarów w grze → ponowny eksport i wypiek modeli).
//
//   node scripts/blender/k7/k7-dane.mjs [--out scripts/blender/k7/k7-dane.json]
//
// Układ lokalny elementu: hub hali (x wzdłuż ringu, y — wysokość K-7 nad pokładem, z promieniowo ku bramie G-01)
// przesunięty do kotwicy elementu (x, y, z z place) i obrócony o −kurs (kurs jak rotY brył: lokalne +x → (cos, sin)
// kursu w (x, z) huba … dokładniej: obrót wokół +y o `yaw`). Bryła = macierz 4 × 4 (wiersze) jednostkowej bryły
// three: prostopadłościan 1 × 1 × 1, walec r = 1, h = 1 wzdłuż +y, torus R = 1 (rura 0,13) w płaszczyźnie xy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildK7Scene, K7_MAT } from '../../../src/3d/haloRing/haloPortK7Build.js';
import {
  K7_ABOVE_SCALE, K7_FUEL_FARM, K7_FUEL_STATION, K7_GATE_LINTEL, K7_HEIGHTS, K7_FORCE_FIELD,
  K7_ATLAS_FUEL_PORTS, createK7Layout, k7Frame, k7FuelTanks
} from '../../../src/3d/haloRing/haloPortK7Layout.js';
import { createHaloRingLayout } from '../../../src/3d/haloRing/haloRingLayout.js';
import { HALO_RING_PROFILES } from '../../../src/3d/haloRing/haloRingProfiles.js';
import { k7LightRig } from '../../../src/3d/haloRing/haloPortK7Lights.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('--out', path.join(here, 'k7-dane.json'));

const MAT_NAME = Object.fromEntries(Object.entries(K7_MAT).map(([k, v]) => [v, k]));

// --- macierze 4 × 4 (wiersze, kolumnowe wektory: p' = M p)
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}
const T = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const S = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
function Rq(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0,
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0,
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1
  ];
}
// jak haloPortK7Build.js (qAxis, quatMul, quatEuler XYZ, quatFromY)
function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
const qAxis = (x, y, z, a) => [x * Math.sin(a / 2), y * Math.sin(a / 2), z * Math.sin(a / 2), Math.cos(a / 2)];
const quatEuler = (rx, ry, rz) => quatMul(quatMul(qAxis(1, 0, 0, rx || 0), qAxis(0, 1, 0, ry || 0)), qAxis(0, 0, 1, rz || 0));
function quatFromY(dx, dy, dz) {
  const len = Math.hypot(dx, dy, dz) || 1;
  const x = dx / len, y = dy / len, z = dz / len;
  if (y < -0.999999) return [1, 0, 0, 0];
  const w = 1 + y;
  const n = Math.hypot(z, 0, -x, w) || 1;
  return [z / n, 0, -x / n, w / n];
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;

// surowe wywołanie bryły (K-7) → macierz jednostkowej bryły w hubie (bez odwzorowania wysokości)
function primMatrix(p) {
  const a = p.args;
  if (p.kind === 'box') {
    const [x, y, z, w, h, d, , rotY] = a;
    return mul(T(x, y, z), mul(Rq(qAxis(0, 1, 0, rotY || 0)), S(w, h, d)));
  }
  if (p.kind === 'cyl') {
    const [x, y, z, r, h, , rot] = a;
    const q = rot ? quatEuler(rot[0], rot[1], rot[2]) : [0, 0, 0, 1];
    return mul(T(x, y, z), mul(Rq(q), S(r, h, r)));
  }
  if (p.kind === 'ring') {
    const [x, y, z, r, , , rot] = a;
    const q = rot ? quatEuler(rot[0], rot[1], rot[2]) : [0, 0, 0, 1];
    return mul(T(x, y, z), mul(Rq(q), S(r, r, r)));
  }
  if (p.kind === 'beam') {
    const [A, B, w, , d] = a;
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const len = Math.hypot(dx, dy, dz);
    return mul(T((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2), mul(Rq(quatFromY(dx, dy, dz)), S(w, len, d)));
  }
  throw new Error('nieznana bryła ' + p.kind);
}
const primMat = (p) => (p.kind === 'box' ? p.args[6] : p.kind === 'beam' ? p.args[3] : p.args[5]);

// układ lokalny elementu: R(−yaw) · T(−kotwica)
function toLocal(place) {
  return mul(Rq(qAxis(0, 1, 0, -place.yaw)), T(-place.x, -place.y, -place.z));
}

const ring = createHaloRingLayout({ profile: 'earth' });
const fr = k7Frame(ring);
const layout = createK7Layout();
const scene = buildK7Scene(layout, { floorZ: fr.floorZ, rimZ: fr.rimZ, floorR: fr.floorR, capture: true });
const rig = k7LightRig(layout);

const elements = {};
for (const p of scene.places) {
  let e = elements[p.element];
  if (!e) {
    const L = toLocal(p);
    const prims = p.prims.map((q) => ({
      kind: q.kind === 'ring' ? 'torus' : q.kind === 'beam' ? 'box' : q.kind,
      set: q.set,
      mode: q.mode,
      mat: MAT_NAME[primMat(q)],
      m: mul(L, primMatrix(q)).map(r6)
    }));
    // soczewki świateł hali przy elemencie (zostają bryłami starej hali — model zostawia im miejsce)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of prims) { x0 = Math.min(x0, q.m[3]); x1 = Math.max(x1, q.m[3]); z0 = Math.min(z0, q.m[11]); z1 = Math.max(z1, q.m[11]); }
    const cy = Math.cos(-p.yaw), sy = Math.sin(-p.yaw);
    const beacons = [];
    for (const b of rig.beacons) {
      const dx = b.x - p.x, dz = b.z - p.z;
      const lx = dx * cy + dz * sy;
      const lz = -dx * sy + dz * cy;
      if (lx > x0 - 60 && lx < x1 + 60 && lz > z0 - 60 && lz < z1 + 60 && p.group === 0 && p.mode === 'abs') {
        beacons.push({ x: r6(lx), y: b.y - p.y, z: r6(lz), r: b.r, kind: b.kind, set: b.set });
      }
    }
    e = elements[p.element] = { tag: p.tag, mode: p.mode, moving: p.group !== 0 && !p.element.startsWith('clamp'), count: 0, anchor: { x: r6(p.x), y: p.y, z: r6(p.z), yaw: r6(p.yaw) }, prims, beacons, places: [] };
  }
  e.count++;
  e.places.push({ x: r6(p.x), y: p.y, z: r6(p.z), yaw: r6(p.yaw) });
}

// bramy: wymiary otworów (lokalnie: x wzdłuż bramy, z na zewnątrz hali)
const gates = layout.gates.map((g) => ({ id: g.id, clearWidth: r6(g.clearWidth), jamb: g.jamb, length: r6(g.length), angle: r6(g.angle) }));
const tank0 = k7FuelTanks(layout)[0];
const profiles = Object.fromEntries(Object.entries(HALO_RING_PROFILES).map(([k, p]) => [k, {
  k7Palette: p.port.k7Palette.map((c) => '#' + c.toString(16).padStart(6, '0')),
  k7Emit: p.port.k7Emit,
  roof: p.port.roof
}]));

const data = {
  units: 'K-7: x wzdłuż ringu, y wysokość nad pokładem (płaszczyzna lotu y = 116), z ku bramie G-01',
  constants: {
    K7_HEIGHTS, K7_ABOVE_SCALE, K7_FUEL_STATION, K7_FUEL_FARM, K7_GATE_LINTEL, K7_FORCE_FIELD,
    K7_ATLAS_FUEL_PORTS: K7_ATLAS_FUEL_PORTS.map((p) => ({ side: p.side, x: p.x, z: p.z, couplerY: p.couplerY })),
    hall: {
      wallThickness: layout.wallThickness, wallHeight: layout.wallHeight, backZ: layout.backZ, halfWidth: layout.halfWidth,
      frontHalfWidth: layout.frontHalfWidth, bodyEndZ: layout.bodyEndZ, frontZ: layout.frontZ,
      wallFaceZ: layout.backZ + layout.wallThickness * 0.5 + 24
    },
    tank: { r: tank0.r, len: tank0.len, y: tank0.y },
    K7_MAT
  },
  gates,
  elements,
  profiles
};
const canon = JSON.stringify({ constants: data.constants, gates, elements });
let h = 0x811c9dc5;
for (let i = 0; i < canon.length; i++) { h ^= canon.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
data.hash = h.toString(16).padStart(8, '0');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data, null, 1));
console.log('elementy:', Object.entries(elements).map(([k, e]) => `${k}×${e.count} (${e.prims.length} brył${e.beacons.length ? `, soczewki ${e.beacons.length}` : ''})`).join(', '));
console.log('hasz', data.hash, '→', OUT);
