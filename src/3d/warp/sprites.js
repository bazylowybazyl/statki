// src/3d/warp/sprites.js
//
// Duszki warpa „Nurt” w passie gry (warstwa 0, kamera ortho Core3D) — port z dema
// (dema/warp-webgpu/glow.js), JEDEN draw call (instancje), dane instancji
// względem początku przy kamerze (mesh.position — sceneOrigin.js, precyzja przy 5–10 mln j.).
//
//   GlowSprites — BŁYSKI (okrągłe), SMUGI i LINIE (poprzeczna linia blasku przy hamowaniu).
// Szczeliny tunelu (RiftSprites) i smugi sylwetki (SmearPool) usunięte w sprzątaniu S1 nowego warpa (2026-10-26):
// nikt ich nie karmił od przylotów NPC bez szczelin (decyzja usera 2026-10-03) — stoją w dema/warp-webgpu (rift.js, hulls.js).
// Kolor premultiplied, alfa zostaje (blend: kolor One/One, alfa Zero/One) — blask nie
// wycina dziur w buforze sceny. Bez świecących okręgów (shockwave-style): fale warpa to
// wyłącznie refrakcja (źródła zniekształceń Core3D).
// Dysz MAIN i plazmy WARP w grze nie rysujemy tu (engineVfxSystem / warpPlume3D).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, attribute, positionGeometry, uv, max, exp, smoothstep, length, select
} from 'three/tsl';

export const GLOW_CAP = 256;
export const GLOW_ROUND = 0;
export const GLOW_STREAK = 1;
export const GLOW_LINE = 2;
/** Kolejność w passie ortho: błyski nad kadłubami (10). */
export const GLOW_RENDER_ORDER = 20;

// Zakres wysyłki atrybutu na stałe (three czyści updateRanges po wysyłce, a ponowny push
// alokuje — PLAN §3, zadanie 12): jeden obiekt zakresu, liczba ustawiana co klatkę.
function keepUpdateRanges() {}
function liveAttribute(attr) {
  const range = { start: 0, count: attr.array.length };
  attr.updateRanges.length = 0;
  attr.updateRanges.push(range);
  attr.clearUpdateRanges = keepUpdateRanges;
  attr.__warpRange = range;
  attr.setUsage(THREE.DynamicDrawUsage);
  return attr;
}
function markLive(attr, floats) {
  if (!(floats > 0)) return;
  attr.__warpRange.count = Math.min(floats, attr.array.length);
  attr.needsUpdate = true;
}

function additive(mat) {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.depthTest = false;
  mat.lights = false;
  mat.fog = false;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  mat.blendEquation = THREE.AddEquation;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.forceSinglePass = true;
  return mat;
}

function instancedQuadGeometry() {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(base.index);
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geo;
}

export class GlowSprites {
  constructor(capacity = GLOW_CAP) {
    this.capacity = capacity;
    this.count = 0;
    const geo = instancedQuadGeometry();
    this.a = liveAttribute(new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    this.b = liveAttribute(new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    this.c = liveAttribute(new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    geo.setAttribute('gA', this.a);
    geo.setAttribute('gB', this.b);
    geo.setAttribute('gC', this.c);
    this.geo = geo;

    const mat = additive(new THREE.NodeMaterial());
    mat.name = 'warp:glow';
    const gA = attribute('gA', 'vec4');
    const gB = attribute('gB', 'vec4');
    const gC = attribute('gC', 'vec4');
    // gA: xyz środek (względem początku), w rozmiar poprzeczny; gB: rgb HDR, w kształt;
    // gC: xy kierunek, z wydłużenie (długość / rozmiar), w miękkość końców linii.
    mat.positionNode = Fn(() => {
      const p = positionGeometry.xy;
      const dir = gC.xy;
      const perp = vec2(dir.y.negate(), dir.x);
      const stretch = max(gC.z, 1.0);
      const local = dir.mul(p.x.mul(stretch)).add(perp.mul(p.y)).mul(gA.w);
      return vec3(gA.xy.add(local), gA.z);
    })();
    mat.fragmentNode = Fn(() => {
      const q = uv().sub(0.5).mul(2.0);
      const r2 = q.dot(q);
      const round = exp(r2.mul(-14.0)).add(exp(r2.mul(-3.5)).mul(0.18)).mul(float(1.0).sub(smoothstep(0.7, 1.0, r2)));
      const along = q.x.mul(0.5).add(0.5);
      const streak = exp(q.y.mul(q.y).mul(-9.0)).mul(along.mul(along)).mul(float(1.0).sub(smoothstep(0.85, 1.0, length(q))));
      // Linia: gauss w poprzek, miękkie końce (gC.w = udział końców w długości). smoothstep(1,
      // 1 − soft, |x|) z dema (odwrócone) wzorem 1 − smoothstep(1 − soft, 1, |x|).
      const soft = max(gC.w, 0.02);
      const ends = float(1.0).sub(smoothstep(float(1.0).sub(soft), 1.0, q.x.abs()));
      const line = exp(q.y.mul(q.y).mul(-10.0)).mul(ends);
      const shape = select(gB.w.lessThan(0.5), round, select(gB.w.lessThan(1.5), streak, line));
      return vec4(gB.rgb.mul(shape), 0.0);
    })();
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = GLOW_RENDER_ORDER;
    this.mesh.name = 'warp:glow';
    this.mesh.visible = false;
  }

  begin() {
    this.count = 0;
  }

  /** Duszek w SCENIE (względem początku): (x, y, z) środek, size [j.], barwa HDR (r, g, b). */
  add(x, y, z, size, r, g, b, shape = GLOW_ROUND, dirX = 1, dirY = 0, stretch = 1, soft = 0.2) {
    if (this.count >= this.capacity || !(size > 0)) return;
    if (!(r > 0.0005 || g > 0.0005 || b > 0.0005)) return;
    const o = (this.count++) * 4;
    const A = this.a.array;
    const B = this.b.array;
    const C = this.c.array;
    A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = size;
    B[o] = r; B[o + 1] = g; B[o + 2] = b; B[o + 3] = shape;
    const l = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
    C[o] = dirX / l; C[o + 1] = dirY / l; C[o + 2] = stretch; C[o + 3] = soft;
  }

  commit(originX, originY) {
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    this.mesh.position.set(originX, originY, 0);
    markLive(this.a, n * 4);
    markLive(this.b, n * 4);
    markLive(this.c, n * 4);
  }
}
