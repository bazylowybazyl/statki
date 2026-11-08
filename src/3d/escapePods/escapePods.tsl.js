// src/3d/escapePods/escapePods.tsl.js
//
// KAPSUŁY RATUNKOWE — bryła w TSL (E22, reguła `kapsuly-ratunkowe`): mała kapsuła — obrotowy kadłubek (ośmiokąt)
// z dyszą na rufie, pasem ostrzegawczym, oknem i stożkiem dziobu. Jedna partia na wszystkie kapsuły (Mesh +
// InstancedBufferGeometry, przepleciony bufor instancji — pułapka 24: nie InstancedMesh), graf budowany raz.
// Światło jak kontenery i drony przeładunku (cargoLight.tsl.js: słońce kadłubów, maska słońca, połysk); dysza
// żarzy się przy ciągu pod progiem bloomu (błysk płomienia robią billboardy `CargoLights`).
//
// Układ bryły: x ∈ [−½, ½] wzdłuż osi (dziób +x), y, z ∈ [−½, ½] przekrój; skala z instancji (L, W, H).
import * as THREE from 'three/webgpu';
import {
  Fn, If, attribute, cos, float, int, max, normalize, positionGeometry, select, sin, uniformArray,
  varyingProperty, vec3, vec4
} from 'three/tsl';
import { CARGO_LIGHT, cargoShade, cargoSurfaceCap } from '../cargo/cargoLight.tsl.js';
import { hexToLinear } from '../cargo/containers.tsl.js';

export const POD_FLOATS = 12;
export const POD_RENDER_ORDER = 12.6;

// Materiały: 0 biały kadłub, 1 grafit (dysza, pierścienie), 2 szkło okna, 3 pomarańcz ostrzegawczy.
export const ESCAPE_POD_PAINT = Object.freeze(['#e6e8ea', '#2a2e33', '#163246', '#ff7a1a']);

// Odcinki bryły obrotowej: [x0, r0, x1, r1, materiał] (r — promień w jednostkach przekroju, ½ = obrys).
const POD_SECTIONS = Object.freeze([
  [-0.5, 0.26, -0.4, 0.34, 1],    // dysza
  [-0.4, 0.42, -0.36, 0.48, 1],   // pierścień rufy
  [-0.36, 0.5, -0.06, 0.5, 0],    // kadłub
  [-0.06, 0.5, 0.06, 0.5, 3],     // pas ostrzegawczy
  [0.06, 0.5, 0.2, 0.5, 0],
  [0.2, 0.5, 0.3, 0.44, 2],       // okno
  [0.3, 0.44, 0.5, 0.12, 0]       // stożek dziobu
]);
const POD_SEGMENTS = 8;

/** Geometria kapsuły (bryła obrotowa wokół osi x, dno dyszy i czubek dziobu zamknięte). */
export function buildEscapePodGeometry() {
  const pos = [];
  const nrm = [];
  const mat = [];
  const idx = [];
  const n = POD_SEGMENTS;
  for (const [x0, r0, x1, r1, m] of POD_SECTIONS) {
    // Normalna stożka: (−dr/dx, cos θ, sin θ) — gładko wokół osi, stała wzdłuż odcinka.
    const slope = -(r1 - r0) / Math.max(1e-6, x1 - x0);
    const base = pos.length / 3;
    for (let k = 0; k <= n; k++) {
      const t = (k / n) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const len = Math.sqrt(slope * slope + 1);
      for (const [x, r] of [[x0, r0], [x1, r1]]) {
        pos.push(x, c * r, s * r);
        nrm.push(slope / len, c / len, s / len);
        mat.push(m);
      }
    }
    for (let k = 0; k < n; k++) {
      const a = base + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  // Dno dyszy (−x) i czubek dziobu (+x).
  for (const [x, r, nx, m] of [[-0.5, 0.26, -1, 1], [0.5, 0.12, 1, 0]]) {
    const center = pos.length / 3;
    pos.push(x, 0, 0); nrm.push(nx, 0, 0); mat.push(m);
    for (let k = 0; k <= n; k++) {
      const t = (k / n) * Math.PI * 2;
      pos.push(x, Math.cos(t) * r, Math.sin(t) * r); nrm.push(nx, 0, 0); mat.push(m);
    }
    for (let k = 0; k < n; k++) {
      // Obieg przeciwny do wskazówek patrząc z zewnątrz (przód = FrontSide).
      if (nx < 0) idx.push(center, center + 2 + k, center + 1 + k);
      else idx.push(center, center + 1 + k, center + 2 + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(mat), 1));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  return g;
}

function keepRanges() {}
function liveBuffer(data, stride) {
  const buffer = new THREE.InstancedInterleavedBuffer(data, stride, 1);
  const range = { start: 0, count: data.length };
  buffer.updateRanges.length = 0;
  buffer.updateRanges.push(range);
  buffer.clearUpdateRanges = keepRanges;
  return { buffer, range };
}

function buildPodMaterial(palette) {
  const m = new THREE.NodeMaterial();
  m.name = 'Kapsuly:bryla';
  m.lights = false;
  m.fog = false;
  // Jak drony przeładunku: kolejka przezroczysta bez mieszania, z zapisem głębi (po cieniach na kadłubach).
  m.transparent = true;
  m.blending = THREE.NoBlending;
  m.depthWrite = true;
  m.side = THREE.FrontSide;
  const vN = varyingProperty('vec3', 'vPodN');
  const vState = varyingProperty('vec4', 'vPodState');
  const vU = varyingProperty('vec3', 'vPodU');
  const vMat = varyingProperty('float', 'vPodMat');
  m.positionNode = Fn(() => {
    const iPos = attribute('iPos', 'vec4');
    const iSize = attribute('iSize', 'vec4');
    const lp = positionGeometry.mul(iSize.xyz);
    const c = cos(iPos.w);
    const s = sin(iPos.w);
    const n = attribute('normal', 'vec3');
    vN.assign(vec3(n.x.mul(c).sub(n.y.mul(s)), n.x.mul(s).add(n.y.mul(c)), n.z));
    vU.assign(positionGeometry);
    vState.assign(attribute('iState', 'vec4'));
    vMat.assign(attribute('aMat', 'float'));
    return vec3(iPos.x.add(lp.x.mul(c)).sub(lp.y.mul(s)), iPos.y.add(lp.x.mul(s)).add(lp.y.mul(c)), iPos.z.add(lp.z));
  })();
  m.fragmentNode = Fn(() => {
    const mi = int(vMat.add(0.5)).toVar();
    const albedo = palette.element(mi).rgb.toVar();
    const specK = float(0.6).toVar();
    const specPow = float(28.0).toVar();
    If(mi.equal(2), () => {
      specK.assign(2.2); specPow.assign(64.0);
    }).ElseIf(mi.equal(1), () => {
      specK.assign(0.9); specPow.assign(36.0);
    });
    const Nw = normalize(vN).toVar();
    const col = cargoShade(albedo, Nw, CARGO_LIGHT.sunDir, float(1.0), float(1.0), vec3(0.0), specK, specPow).toVar();
    // Dysza (rufa, grafit) żarzy się przy ciągu — pod progiem bloomu.
    const nozzle = select(mi.equal(1).and(vU.x.lessThan(-0.38)), vState.y.mul(0.7), float(0.0));
    col.addAssign(vec3(1.0, 0.55, 0.2).mul(nozzle));
    return vec4(cargoSurfaceCap(max(col, vec3(0.0))), 1.0);
  })();
  return m;
}

/** Partia kapsuł: jeden rysunek, instancja = poza, wymiary, stan (ziarno, ciąg). */
export class EscapePodBodies {
  constructor(scene, capacity = 192) {
    this.capacity = capacity;
    const base = buildEscapePodGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    geo.setAttribute('aMat', base.getAttribute('aMat'));
    geo.setIndex(base.getIndex());
    this.data = new Float32Array(capacity * POD_FLOATS);
    const { buffer, range } = liveBuffer(this.data, POD_FLOATS);
    this.buffer = buffer;
    this.range = range;
    geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geo.setAttribute('iSize', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geo.setAttribute('iState', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geometry = geo;
    const t = [0, 0, 0];
    const rows = ESCAPE_POD_PAINT.map((h) => { hexToLinear(h, t); return new THREE.Vector4(t[0], t[1], t[2], 1); });
    this.palette = uniformArray(rows, 'vec4').setName('escapePodPaint');
    this.material = buildPodMaterial(this.palette);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'Kapsuly:bryla';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = POD_RENDER_ORDER;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.count = 0;
  }

  begin() { this.count = 0; }

  /** Kapsuła: środek (x, y, z) w scenie, kurs (yaw sceny), wymiary L × W × H, ziarno, ciąg 0…1. */
  push(x, y, z, yaw, L, W, H, seed, thrust) {
    if (this.count >= this.capacity) return false;
    const o = this.count++ * POD_FLOATS;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw;
    d[o + 4] = L; d[o + 5] = W; d[o + 6] = H; d[o + 7] = 0;
    d[o + 8] = seed; d[o + 9] = thrust; d[o + 10] = 0; d[o + 11] = 0;
    return true;
  }

  commit() {
    const n = this.count;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) { this.range.count = n * POD_FLOATS; this.buffer.needsUpdate = true; }
  }
}
