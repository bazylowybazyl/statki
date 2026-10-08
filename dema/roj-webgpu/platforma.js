// ============================================================
// Platforma portu dema roju (dema/roj-webgpu.html): pokład w płaszczyźnie gry (wierzch z = 0)
// pod blokami placu i polami gniazd, pola stosów (obrysy w barwie klasy), gniazda dronów
// (krąg, właz, światła gotowości), pas ostrzegawczy krawędzi, maszty świateł i wieże
// kontroli (przeszkody portu — te same prostokąty trafiają do mapy przeszkód roju).
// Rekwizyt w świetle ładunku (cargoLight.tsl.js). Pokład zapisuje głębię w z = 0, więc cienie
// dronów (GREATER) kładą się na nim jak na kadłubie.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, If, abs, attribute, clamp, cos, float, floor, fract, fwidth, length, max, min, mix, normalize, positionGeometry,
  positionLocal, select, sin, step, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { CARGO_LIGHT, cargoHash, cargoShade, cargoSurfaceCap, smoothDown } from '../../src/3d/cargo/cargoLight.tsl.js';

/** Barwy klas (obrysy pól placu i gniazd; liniowe). */
export const CLASS_TINT = Object.freeze({
  S: [0.25, 0.85, 1.0], M: [0.35, 1.0, 0.5], L: [1.0, 0.68, 0.18], C: [1.0, 0.32, 0.75]
});

function deckMaterial() {
  const m = new THREE.NodeMaterial();
  m.name = 'Roj:poklad';
  m.lights = false;
  m.fog = false;
  const vN = varyingProperty('vec3', 'vPkN');
  const vS = varyingProperty('vec4', 'vPkS');
  m.positionNode = Fn(() => {
    vN.assign(attribute('normal', 'vec3'));
    vS.assign(attribute('aSize', 'vec4'));
    return positionGeometry;
  })();
  m.fragmentNode = Fn(() => {
    const P = positionLocal.toVar();
    const N = normalize(vN).toVar();
    const fw = fwidth(P);
    const px = max(max(fw.x, fw.y), max(fw.z, 1e-4)).toVar();
    const albedo = vec3(0.105, 0.11, 0.122).toVar();
    const emis = vec3(0.0).toVar();
    const half = vS.xy;
    If(N.z.greaterThan(0.5), () => {
      const g = P.xy.sub(vS.zw);
      // Płyty 20 j. ze szwami, rozrzut odcienia.
      const sd = min(abs(fract(g.x.div(20.0).add(0.5)).sub(0.5)), abs(fract(g.y.div(20.0).add(0.5)).sub(0.5))).mul(20.0);
      albedo.mulAssign(float(1.0).sub(smoothDown(px.add(0.12), 0.12, sd).mul(0.32)));
      albedo.mulAssign(cargoHash(floor(g.mul(0.05))).mul(0.18).add(0.91));
      // Pas ostrzegawczy przy krawędzi pokładu.
      const edge = min(half.x.sub(abs(P.x.sub(vS.z))), half.y.sub(abs(P.y.sub(vS.w))));
      const band = step(edge, 7.0).mul(step(1.5, edge));
      const stripe = step(0.5, fract(P.x.add(P.y).div(9.0)));
      albedo.assign(mix(albedo, mix(vec3(0.92, 0.62, 0.05), vec3(0.02), stripe), band));
      // Linie świetlne wzdłuż krawędzi (turkus) — co 60 j. przerwa.
      const lane = smoothDown(px.add(0.25), 0.25, abs(edge.sub(11.0))).mul(step(0.25, fract(P.x.add(P.y).div(60.0))));
      emis.addAssign(vec3(0.15, 0.75, 0.9).mul(lane.mul(1.2)));
    }).Else(() => {
      const s = select(abs(N.x).greaterThan(0.5), P.y, P.x);
      albedo.assign(vec3(0.07, 0.075, 0.085).mul(cargoHash(floor(vec2(s.div(16.0), P.z.div(8.0)))).mul(0.3).add(0.8)));
      const strip = step(abs(P.z.add(12.0)), 0.6).mul(step(0.55, fract(s.div(14.0))));
      emis.addAssign(vec3(0.3, 0.8, 1.0).mul(strip.mul(1.6)));
    });
    const col = cargoShade(albedo, N, CARGO_LIGHT.sunDir, float(1.0), float(1.0), vec3(0.0), float(0.45), float(26.0));
    return vec4(cargoSurfaceCap(col).add(emis), 1.0);
  })();
  return m;
}

/** Obrysy pól (stosy placu, gniazda): kwad na instancję, kształt i barwa z danych. */
function markMaterial() {
  const m = new THREE.NodeMaterial();
  m.name = 'Roj:znaki';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -1;
  const vQ = varyingProperty('vec2', 'vMkQ');
  const vD = varyingProperty('vec4', 'vMkD');
  const vC = varyingProperty('vec4', 'vMkC');
  m.positionNode = Fn(() => {
    const a = attribute('iMark', 'vec4'); // x, y, kurs, rodzaj (0 stos, 1 gniazdo)
    const b = attribute('iMarkS', 'vec4'); // L, W, ramka, 0
    const c = attribute('iMarkC', 'vec4'); // barwa, jasność
    const q = positionGeometry.xy.mul(b.xy.add(b.z.mul(2.0)));
    vQ.assign(q);
    vD.assign(vec4(b.xy.mul(0.5), a.w, b.z));
    vC.assign(c);
    const cs = vec2(cos(a.z), sin(a.z));
    return vec3(a.x.add(q.x.mul(cs.x)).sub(q.y.mul(cs.y)), a.y.add(q.x.mul(cs.y)).add(q.y.mul(cs.x)), 0.06);
  })();
  m.fragmentNode = Fn(() => {
    const fw = fwidth(vQ);
    const px = max(max(fw.x, fw.y), 1e-4);
    const hs = vD.xy;
    const out = vec4(0.0).toVar();
    If(vD.z.lessThan(0.5), () => {
      // Stos: obrys narożnikami (kąty) i przerywana linia boku.
      const e = abs(vQ).sub(hs);
      const d = max(e.x, e.y);
      const line = smoothDown(px.add(0.25), 0.25, abs(d.add(0.35)));
      const corner = min(step(hs.x.mul(0.7), abs(vQ.x)).add(step(hs.y.mul(0.6), abs(vQ.y))), 1.0);
      const dash = step(0.45, fract(vQ.x.add(vQ.y).div(max(hs.y.mul(0.5), 1.0))));
      const a = line.mul(min(corner.add(dash.mul(0.35)), 1.0));
      out.assign(vec4(vC.rgb.mul(vC.w).mul(a), a.mul(0.9)));
    }).Else(() => {
      // Gniazdo: krąg, właz, cztery znaczniki.
      const r = length(vQ);
      const R = min(hs.x, hs.y);
      const ring = smoothDown(px.add(0.4), 0.4, abs(r.sub(R.mul(0.92))));
      const hatch = smoothDown(px.add(0.3), 0.3, abs(r.sub(R.mul(0.5)))).mul(0.7);
      const ticks = step(R.mul(0.8), r).mul(step(r, R)).mul(step(0.92, max(abs(vQ.x), abs(vQ.y)).div(max(r, 1e-3))));
      const a = clamp(ring.add(hatch).add(ticks), 0.0, 1.0);
      out.assign(vec4(vC.rgb.mul(vC.w).mul(a), a.mul(0.85)));
    });
    return out;
  })();
  return m;
}

/** Wieża / maszt: bryła z oknami, które świecą. */
function towerMaterial() {
  const m = new THREE.NodeMaterial();
  m.name = 'Roj:wieza';
  m.lights = false;
  m.fog = false;
  const vN = varyingProperty('vec3', 'vTwN');
  m.positionNode = Fn(() => { vN.assign(attribute('normal', 'vec3')); return positionGeometry; })();
  m.fragmentNode = Fn(() => {
    const P = positionLocal;
    const N = normalize(vN);
    const albedo = vec3(0.17, 0.18, 0.2).mul(cargoHash(floor(P.xy.mul(0.2))).mul(0.2).add(0.85)).toVar();
    const side = N.z.lessThan(0.5);
    const s = select(abs(N.x).greaterThan(0.5), P.y, P.x);
    const win = step(abs(fract(P.z.div(6.0)).sub(0.5)), 0.12).mul(step(0.5, fract(s.div(5.0)))).mul(select(side, float(1.0), float(0.0)));
    const lit = step(0.5, cargoHash(floor(vec2(s.div(5.0), P.z.div(6.0)))));
    const col = cargoShade(albedo, N, CARGO_LIGHT.sunDir, float(1.0), float(1.0), vec3(0.0), float(0.4), float(24.0));
    return vec4(cargoSurfaceCap(col).add(vec3(1.0, 0.82, 0.55).mul(win.mul(lit).mul(1.2))), 1.0);
  })();
  return m;
}

let _mats = null;
function mats() {
  if (!_mats) _mats = { deck: deckMaterial(), mark: markMaterial(), tower: towerMaterial() };
  return _mats;
}

/**
 * Platforma dla portu roju (buildSwarmPort): pokład pod siatkami placu i gniazd (jeden
 * prostokąt na obszar), znaki pól, wieże (port.obstacles). Zwraca { group, pushLights(lights, t), dispose }.
 */
export function createPlatform(port) {
  const group = new THREE.Group();
  group.name = 'Roj:platforma';
  const M = mats();
  // Pokład: obwiednia siatek placu i gniazd (+ margines) — jeden prostokąt.
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const marks = [];
  for (const g of port.grids) {
    if (g.kind === 'hold') continue;
    for (const ci of g.columns) {
      const c = port.columns[ci];
      const r = Math.hypot(g.pitchA, g.pitchB) * 0.6;
      x0 = Math.min(x0, c.x - r); x1 = Math.max(x1, c.x + r);
      y0 = Math.min(y0, c.y - r); y1 = Math.max(y1, c.y + r);
      const tint = CLASS_TINT[g.classId] || [1, 1, 1];
      if (g.kind === 'yard') marks.push([c.x, c.y, c.yaw, 0, g.pitchA - 1.2, g.pitchB - 1.2, 1.0, ...tint, 0.55]);
      else marks.push([c.x, c.y, c.yaw, 1, g.pitchA - 1.0, g.pitchB - 1.0, 1.0, ...tint, 0.8]);
    }
  }
  for (const o of port.obstacles) { x0 = Math.min(x0, o.x - o.L); x1 = Math.max(x1, o.x + o.L); y0 = Math.min(y0, o.y - o.W); y1 = Math.max(y1, o.y + o.W); }
  const pad = 40;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const T = 28;
  const meshes = [];
  if (Number.isFinite(x0)) {
    const Lx = x1 - x0;
    const Ly = y1 - y0;
    const geo = new THREE.BoxGeometry(Lx, Ly, T);
    geo.translate((x0 + x1) / 2, (y0 + y1) / 2, -T / 2);
    const n = geo.getAttribute('position').count;
    const size = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { size[i * 4] = Lx / 2; size[i * 4 + 1] = Ly / 2; size[i * 4 + 2] = (x0 + x1) / 2; size[i * 4 + 3] = (y0 + y1) / 2; }
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 4));
    const deck = new THREE.Mesh(geo, M.deck);
    deck.name = 'Roj:poklad';
    group.add(deck);
    meshes.push(deck);
  }
  // Znaki pól (instancje).
  if (marks.length) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setIndex(plane.getIndex());
    const F = 12;
    const data = new Float32Array(marks.length * F);
    marks.forEach((m, i) => {
      const o = i * F;
      data[o] = m[0]; data[o + 1] = m[1]; data[o + 2] = m[2]; data[o + 3] = m[3];
      data[o + 4] = m[4]; data[o + 5] = m[5]; data[o + 6] = m[6]; data[o + 7] = 0;
      data[o + 8] = m[7]; data[o + 9] = m[8]; data[o + 10] = m[9]; data[o + 11] = m[10];
    });
    const buf = new THREE.InstancedInterleavedBuffer(data, F, 1);
    geo.setAttribute('iMark', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    geo.setAttribute('iMarkS', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    geo.setAttribute('iMarkC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
    geo.instanceCount = marks.length;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const mesh = new THREE.Mesh(geo, M.mark);
    mesh.name = 'Roj:znaki';
    mesh.frustumCulled = false;
    mesh.renderOrder = 9;
    group.add(mesh);
    meshes.push(mesh);
  }
  // Wieże kontroli / maszty (przeszkody).
  for (const o of port.obstacles) {
    const geo = new THREE.BoxGeometry(o.L, o.W, o.top);
    geo.translate(0, 0, o.top / 2);
    const mesh = new THREE.Mesh(geo, M.tower);
    mesh.position.set(o.x, o.y, 0);
    mesh.rotation.z = o.yaw || 0;
    mesh.name = 'Roj:wieza';
    group.add(mesh);
    meshes.push(mesh);
  }
  group.updateMatrixWorld(true);
  const masts = [[x0 + 8, y0 + 8], [x1 - 8, y0 + 8], [x0 + 8, y1 - 8], [x1 - 8, y1 - 8]];
  return {
    group, bounds: { x0, y0, x1, y1 },
    /** Światła platformy: maszty w narożach (czerwony błysk), wierzchołki wież. */
    pushLights(lights, t) {
      const blink = (t * 0.7) % 1 < 0.14 ? 1 : 0.15;
      if (Number.isFinite(x0)) for (const [mx, my] of masts) lights.push(mx, my, 4, 3, 4.5 * blink, 0.5 * blink, 0.3 * blink, 0);
      for (const o of port.obstacles) lights.push(o.x, o.y, o.top + 2, 3, 5 * blink, 0.6 * blink, 0.3 * blink, 0);
    },
    dispose() {
      group.removeFromParent();
      for (const m of meshes) m.geometry.dispose();
    }
  };
}
