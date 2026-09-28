// src/3d/cargo/drones.tsl.js
//
// DRONY PRZEŁADUNKOWE 3D w TSL (zadanie 26) — port bryły dronów Z5 (src/3d/cargoDrones3D.js,
// GLSL poza grą — plik Z5 bez zmian): korpus, ukośne ramiona, cztery bloki RCS w narożach,
// rama chwytaka o obrysie modułu z zamkami. Port jest w próżni — drony latają na silnikach
// manewrowych, nie na wirnikach. Pozy liczy src/game/cargoBayOps.js (bez stanu).
//
// RYSOWANIE: bryła w instancjach (Mesh + InstancedBufferGeometry, przepleciony bufor), kolejka
// przezroczysta z NoBlending i zapisem głębi (po cieniach na kadłubie, jak kontenery);
// płaszczyzna cięcia (wyłaz gniazda) ściska część drona pod pokładem na pokład. Światło jak
// kontenery (cargoLight.tsl.js; dron w ładowni dostaje lampy wnętrza).
// ŚWIATŁA (CargoLights): billboardy addytywne ONE/ONE (pozycyjne czerwone i zielone, białe
// rufowe, bursztynowy kogut, niebieskie błyski RCS przy przyspieszaniu; także koguty wrót
// i światła stacji dema) — pasma HDR jak światła pozycyjne okrętów (rdzeń > próg bloomu).
import * as THREE from 'three/webgpu';
import {
  Fn, If, attribute, cos, exp, float, floor, fract, int, length, max, min, normalize, positionGeometry, renderGroup,
  select, sin, smoothstep, step, uniform, uniformArray, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import {
  CARGO_LIGHT, bayAmbientOcclusion, bayFillLight, bayLampLight, bayRecord, bayRimVisibility, bayToLocal, cargoHash,
  cargoShade, cargoSurfaceCap, dirToLocal
} from './cargoLight.tsl.js';
import { hexToLinear } from './containers.tsl.js';

export const DRONE_FLOATS = 12;
export const DRONE_RENDER_ORDER = 12.5;
export const LIGHT_FLOATS = 8;
export const LIGHT_RENDER_ORDER = 60;

// ---------------------------------------------------------------------------
// Geometria drona (Z5): x, y ∈ [−½, ½] = rama chwytaka, z ∈ [0, 1] = wysokość; hak w z = 0.
// Materiały: 0 żółty korpus, 1 grafit, 2 czerń (dysze), 3 pasy zamków, 4 stal, 5 szkło.
// ---------------------------------------------------------------------------

export const DRONE_POD = 0.64;
const ARM_YAW = Math.atan2(1, 1);
const DRONE_BOXES = [
  [-0.5, 0.5, 0.46, 0.5, 0, 0.06, 1, 4],
  [-0.5, 0.5, -0.5, -0.46, 0, 0.06, 1, 4],
  [0.46, 0.5, -0.46, 0.46, 0, 0.06, 1, 4],
  [-0.5, -0.46, -0.46, 0.46, 0, 0.06, 1, 4],
  [0.41, 0.52, 0.41, 0.52, -0.05, 0.1, 1, 3],
  [-0.52, -0.41, 0.41, 0.52, -0.05, 0.1, 1, 3],
  [0.41, 0.52, -0.52, -0.41, -0.05, 0.1, 1, 3],
  [-0.52, -0.41, -0.52, -0.41, -0.05, 0.1, 1, 3],
  [0.33, 0.37, 0.33, 0.37, 0.06, 0.48, 2, 4],
  [-0.37, -0.33, 0.33, 0.37, 0.06, 0.48, 2, 4],
  [0.33, 0.37, -0.37, -0.33, 0.06, 0.48, 2, 4],
  [-0.37, -0.33, -0.37, -0.33, 0.06, 0.48, 2, 4],
  [-0.36, 0.3, -0.27, 0.27, 0.44, 0.78, 0, 0],
  [-0.3, 0.14, -0.16, 0.16, 0.78, 0.87, 0, 1],
  [0.3, 0.42, -0.13, 0.13, 0.56, 0.74, 0, 5],
  [-0.05, 0.03, -0.04, 0.04, 0.87, 0.93, 0, 1],
  ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
    const cx = sx * (0.3 + DRONE_POD) * 0.5;
    const cy = sy * (0.25 + DRONE_POD) * 0.5;
    const len = Math.hypot(DRONE_POD - 0.3, DRONE_POD - 0.25) * 0.5 + 0.05;
    return [cx - len, cx + len, cy - 0.035, cy + 0.035, 0.6, 0.69, 0, 1, sx * sy * ARM_YAW];
  }),
  ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].flatMap(([sx, sy]) => {
    const x = sx * DRONE_POD;
    const y = sy * DRONE_POD;
    return [
      [x - 0.11, x + 0.11, y - 0.11, y + 0.11, 0.5, 0.78, 3, 1],
      [x - 0.08, x + 0.08, y - 0.08, y + 0.08, 0.78, 0.83, 3, 0],
      [x - 0.06, x + 0.06, y - 0.06, y + 0.06, 0.43, 0.5, 3, 2]
    ];
  })
];

/** Punkty świateł w układzie jednostkowym drona (Z5). */
export const DRONE_LIGHT_POINTS = Object.freeze({
  navLeft: [DRONE_POD, DRONE_POD, 0.86],
  navRight: [DRONE_POD, -DRONE_POD, 0.86],
  tail: [-0.36, 0, 0.74],
  beacon: [-0.01, 0, 0.96],
  pods: [[DRONE_POD, DRONE_POD], [-DRONE_POD, DRONE_POD], [DRONE_POD, -DRONE_POD], [-DRONE_POD, -DRONE_POD]]
});

export function buildDroneGeometry() {
  const pos = [];
  const nrm = [];
  const mat = [];
  const idx = [];
  const face = (a, b, c, d, n, m) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) { pos.push(v[0], v[1], v[2]); nrm.push(n[0], n[1], n[2]); mat.push(m); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const [x0, x1, y0, y1, z0, z1, , m, yaw = 0] of DRONE_BOXES) {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const R = (v) => [cx + (v[0] - cx) * c - (v[1] - cy) * s, cy + (v[0] - cx) * s + (v[1] - cy) * c, v[2]];
    const N = (n) => [n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]];
    const F = (a, b, cc, d, n) => face(R(a), R(b), R(cc), R(d), N(n), m);
    F([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
    F([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0]);
    F([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0]);
    F([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    F([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    F([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(mat), 1));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  return g;
}

// Farby: przemysłowy żółty, grafit, czerń, żółć pasów, stal, szkło czujnika (Z5).
export const CARGO_DRONE_PAINT = Object.freeze(['#d99a2b', '#2b2f33', '#101214', '#e0b025', '#8a9097', '#1c3848']);

function keepRanges() {}
function liveBuffer(data, stride) {
  const buffer = new THREE.InstancedInterleavedBuffer(data, stride, 1);
  const range = { start: 0, count: data.length };
  buffer.updateRanges.length = 0;
  buffer.updateRanges.push(range);
  buffer.clearUpdateRanges = keepRanges;
  return { buffer, range };
}

function buildDroneMaterial(palette) {
  const m = new THREE.NodeMaterial();
  m.name = 'Cargo:drony';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.blending = THREE.NoBlending;
  m.depthWrite = true;
  m.side = THREE.FrontSide;
  const vN = varyingProperty('vec3', 'vDrN');
  const vW = varyingProperty('vec3', 'vDrW');
  const vU = varyingProperty('vec3', 'vDrU');
  const vSize = varyingProperty('vec4', 'vDrSize');
  const vState = varyingProperty('vec4', 'vDrState');
  const vMat = varyingProperty('float', 'vDrMat');
  m.positionNode = Fn(() => {
    const iPos = attribute('iPos', 'vec4');
    const iSize = attribute('iSize', 'vec4');
    const lp = positionGeometry.mul(iSize.xyz);
    const c = cos(iPos.w);
    const s = sin(iPos.w);
    const n = attribute('normal', 'vec3');
    const wp = vec3(iPos.x.add(lp.x.mul(c)).sub(lp.y.mul(s)), iPos.y.add(lp.x.mul(s)).add(lp.y.mul(c)), max(iPos.z.add(lp.z), iSize.w));
    vN.assign(vec3(n.x.mul(c).sub(n.y.mul(s)), n.x.mul(s).add(n.y.mul(c)), n.z));
    vW.assign(wp);
    vU.assign(lp);
    vSize.assign(iSize);
    vState.assign(attribute('iState', 'vec4'));
    vMat.assign(attribute('aMat', 'float'));
    return wp;
  })();
  m.fragmentNode = Fn(() => {
    const mi = int(vMat.add(0.5)).toVar();
    const albedo = palette.element(mi).rgb.toVar();
    const specK = float(0.5).toVar();
    const specPow = float(24.0).toVar();
    const Nw = normalize(vN).toVar();
    If(mi.equal(3), () => {
      const st = step(0.5, fract(vU.x.add(vU.y).div(max(min(vSize.x, vSize.y).mul(0.035), 0.12))));
      albedo.assign(albedo.mul(float(1.0).sub(st.mul(0.97))));
    }).ElseIf(mi.equal(0), () => {
      albedo.mulAssign(cargoHash(vec2(floor(vU.x.div(max(vSize.y, 1.0)).mul(3.0)), floor(vState.y.mul(13.0)))).mul(0.2).add(0.88));
      specK.assign(0.7);
    }).ElseIf(mi.equal(5), () => {
      specK.assign(2.0); specPow.assign(64.0);
    }).ElseIf(mi.equal(4), () => {
      specK.assign(1.1); specPow.assign(40.0);
    });
    const col = vec3(0.0).toVar();
    const bay = vState.x;
    If(bay.greaterThan(-0.5), () => {
      const rec = bayRecord(int(bay.add(0.5)));
      const P = bayToLocal(rec, vW).toVar();
      const Nl = dirToLocal(rec, Nw).toVar();
      const vis = bayRimVisibility(P, dirToLocal(rec, CARGO_LIGHT.shadowDir), rec.r1.x, rec.r2.x);
      const lamp = bayLampLight(rec, P, Nl).add(bayFillLight(rec, P, Nl));
      col.assign(cargoShade(albedo, Nl, dirToLocal(rec, CARGO_LIGHT.sunDir), vis, bayAmbientOcclusion(rec, P), lamp, specK, specPow));
    }).Else(() => {
      col.assign(cargoShade(albedo, Nw, CARGO_LIGHT.sunDir, float(1.0), float(1.0), vec3(0.0), specK, specPow));
    });
    // Dysze RCS żarzą się przy ciągu (pod progiem bloomu — błysk robi światło billboardu).
    const glow = select(mi.equal(2), vState.z.mul(0.6), float(0.0));
    col.addAssign(vec3(0.35, 0.55, 1.0).mul(glow));
    return vec4(cargoSurfaceCap(col), 1.0);
  })();
  return m;
}

export class CargoDrones {
  constructor(scene, capacity = 256) {
    this.capacity = capacity;
    const base = buildDroneGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    geo.setAttribute('aMat', base.getAttribute('aMat'));
    geo.setIndex(base.getIndex());
    this.data = new Float32Array(capacity * DRONE_FLOATS);
    const { buffer, range } = liveBuffer(this.data, DRONE_FLOATS);
    this.buffer = buffer;
    this.range = range;
    geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geo.setAttribute('iSize', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geo.setAttribute('iState', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geometry = geo;
    const t = [0, 0, 0];
    const rows = CARGO_DRONE_PAINT.map((h) => { hexToLinear(h, t); return new THREE.Vector4(t[0], t[1], t[2], 1); });
    this.palette = uniformArray(rows, 'vec4').setName('cargoDronePaint');
    this.material = buildDroneMaterial(this.palette);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'Cargo:drony';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = DRONE_RENDER_ORDER;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.count = 0;
  }

  begin() { this.count = 0; }

  /** Dron: hak (x, y, z), kurs, rama L × W, wysokość H, cięcie clipZ, ładownia, ziarno, ciąg. */
  push(x, y, z, yaw, L, W, H, clipZ, bay, seed, thrust) {
    if (this.count >= this.capacity) return false;
    const o = this.count++ * DRONE_FLOATS;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw;
    d[o + 4] = L; d[o + 5] = W; d[o + 6] = H; d[o + 7] = clipZ;
    d[o + 8] = bay; d[o + 9] = seed; d[o + 10] = thrust; d[o + 11] = 0;
    return true;
  }

  commit() {
    const n = this.count;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) { this.range.count = n * DRONE_FLOATS; this.buffer.needsUpdate = true; }
  }
}

// ---------------------------------------------------------------------------
// Światła (billboardy addytywne)
// ---------------------------------------------------------------------------

/** Wspólne dla świateł: osie kamery (billboard) i skala ekranu (najmniejszy rozmiar). */
export const CARGO_LIGHT_VIEW = Object.freeze({
  right: uniform(new THREE.Vector3(1, 0, 0)).setGroup(renderGroup),
  up: uniform(new THREE.Vector3(0, 1, 0)).setGroup(renderGroup),
  pxPerUnit: uniform(1).setGroup(renderGroup),
  minPx: uniform(1.4).setGroup(renderGroup),
  halo: uniform(0.5).setGroup(renderGroup)
});

function buildLightMaterial() {
  const m = new THREE.NodeMaterial();
  m.name = 'Cargo:swiatla';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.premultipliedAlpha = false;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.forceSinglePass = true;
  const vQ = varyingProperty('vec2', 'vLtQ');
  const vColor = varyingProperty('vec4', 'vLtColor');
  const V = CARGO_LIGHT_VIEW;
  m.positionNode = Fn(() => {
    const iL = attribute('iLight', 'vec4');
    const q = positionGeometry.xy.mul(2.0);
    vQ.assign(q);
    vColor.assign(attribute('iColor', 'vec4'));
    const r = max(iL.w, V.minPx.div(max(V.pxPerUnit, 1e-4)));
    return iL.xyz.add(V.right.mul(q.x).add(V.up.mul(q.y)).mul(r.mul(2.0)));
  })();
  m.fragmentNode = Fn(() => {
    const d = length(vQ);
    const shape = vColor.w;
    const core = select(shape.greaterThan(0.5), exp(d.mul(d).mul(-9.0)), float(1.0).sub(smoothstep(0.12, 0.22, d)));
    const halo = select(shape.greaterThan(0.5), exp(d.mul(d).mul(-3.0)).mul(0.25),
      max(float(1.0).sub(d), 0.0).mul(max(float(1.0).sub(d), 0.0)).mul(float(1.0).sub(core)));
    const edge = float(1.0).sub(smoothstep(0.85, 1.0, d));
    const col = vColor.rgb.mul(core.add(halo.mul(V.halo))).mul(edge);
    return vec4(col, max(max(col.r, col.g), col.b));
  })();
  return m;
}

export class CargoLights {
  constructor(scene, capacity = 4096) {
    this.capacity = capacity;
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setIndex(plane.getIndex());
    this.data = new Float32Array(capacity * LIGHT_FLOATS);
    const { buffer, range } = liveBuffer(this.data, LIGHT_FLOATS);
    this.buffer = buffer;
    this.range = range;
    geo.setAttribute('iLight', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geo.setAttribute('iColor', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geometry = geo;
    this.material = buildLightMaterial();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'Cargo:swiatla';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = LIGHT_RENDER_ORDER;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.count = 0;
  }

  begin() { this.count = 0; }

  /** Światło: środek (x, y, z), promień [j.], barwa × moc (HDR), kształt 0 punkt / 1 obłok. */
  push(x, y, z, radius, r, g, b, shape = 0) {
    if (this.count >= this.capacity || (r + g + b) <= 1e-4) return false;
    const o = this.count++ * LIGHT_FLOATS;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = radius;
    d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = shape;
    return true;
  }

  commit(camera, pxPerUnit) {
    const n = this.count;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (camera) {
      const e = camera.matrixWorld.elements;
      CARGO_LIGHT_VIEW.right.value.set(e[0], e[1], e[2]).normalize();
      CARGO_LIGHT_VIEW.up.value.set(e[4], e[5], e[6]).normalize();
    }
    if (Number.isFinite(pxPerUnit)) CARGO_LIGHT_VIEW.pxPerUnit.value = pxPerUnit;
    if (n > 0) { this.range.count = n * LIGHT_FLOATS; this.buffer.needsUpdate = true; }
  }
}

// ---------------------------------------------------------------------------
// Klej: poza drona z cargoBayOps → bryła, niesiony moduł, światła
// ---------------------------------------------------------------------------

const NAV_RED = [1.0, 0.13, 0.08];
const NAV_GREEN = [0.12, 1.0, 0.35];
const NAV_WHITE = [0.95, 0.97, 1.0];
const BEACON_AMBER = [1.0, 0.55, 0.12];
const RCS_BLUE = [0.55, 0.78, 1.0];

/**
 * Światła drona (Z5): pozycyjne w przednich blokach, rufowe, kogut (błysk co ~1,1 s,
 * faza z ziarna) i błyski RCS w blokach po stronie przeciwnej do przyspieszenia.
 * d — { x, y, z (hak), yaw, L, W, H, seed, thrust, ax, ay, az }.
 */
export function pushDroneLights(lights, d, time, gain = 1) {
  const c = Math.cos(d.yaw);
  const s = Math.sin(d.yaw);
  const at = (p, out) => {
    const lx = p[0] * d.L;
    const ly = p[1] * d.W;
    out[0] = d.x + c * lx - s * ly;
    out[1] = d.y + s * lx + c * ly;
    out[2] = d.z + (p[2] ?? 0.6) * d.H + 0.3;
    return out;
  };
  const q = [0, 0, 0];
  const r = Math.max(0.35, 0.05 * Math.min(d.L, d.W));
  at(DRONE_LIGHT_POINTS.navLeft, q); lights.push(q[0], q[1], q[2], r, NAV_RED[0] * 4.5 * gain, NAV_RED[1] * 4.5 * gain, NAV_RED[2] * 4.5 * gain, 0);
  at(DRONE_LIGHT_POINTS.navRight, q); lights.push(q[0], q[1], q[2], r, NAV_GREEN[0] * 4.5 * gain, NAV_GREEN[1] * 4.5 * gain, NAV_GREEN[2] * 4.5 * gain, 0);
  at(DRONE_LIGHT_POINTS.tail, q); lights.push(q[0], q[1], q[2], r * 0.8, NAV_WHITE[0] * 3 * gain, NAV_WHITE[1] * 3 * gain, NAV_WHITE[2] * 3 * gain, 0);
  const ph = (time * 0.9 + d.seed * 7.3) % 1;
  if (ph < 0.12) {
    at(DRONE_LIGHT_POINTS.beacon, q);
    lights.push(q[0], q[1], q[2], r * 1.3, BEACON_AMBER[0] * 3.2 * gain, BEACON_AMBER[1] * 3.2 * gain, BEACON_AMBER[2] * 3.2 * gain, 0);
  }
  if (d.thrust > 0.25) {
    // Blok po stronie przeciwnej do przyspieszenia (wydmuch pchający w jego kierunku).
    const axl = d.ax * c + d.ay * s;
    const ayl = -d.ax * s + d.ay * c;
    const k = (d.thrust - 0.25) / 0.75;
    for (const p of DRONE_LIGHT_POINTS.pods) {
      const w = -(p[0] * axl + p[1] * ayl) - 0.2 * d.az;
      if (w <= 0.05) continue;
      at([p[0], p[1], 0.62], q);
      const e = 2.2 * k * Math.min(1, w) * gain;
      lights.push(q[0], q[1], q[2], r * 2.2, RCS_BLUE[0] * e, RCS_BLUE[1] * e, RCS_BLUE[2] * e, 1);
    }
  }
}

/** Kogut wrót (bursztynowy, obrotowy: jasny, gdy „promień” patrzy w kamerę). */
export function pushBeacon(lights, x, y, z, radius, time, phase, gain = 1) {
  const a = (time * 4.2 + phase * 6.283) % 6.283;
  const b = Math.pow(Math.max(0, Math.cos(a)), 8);
  const e = (0.5 + 3.2 * b) * gain;
  lights.push(x, y, z, radius * (0.8 + 0.5 * b), BEACON_AMBER[0] * e, BEACON_AMBER[1] * e, BEACON_AMBER[2] * e, 0);
}
