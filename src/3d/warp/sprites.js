// src/3d/warp/sprites.js
//
// Duszki warpa „Nurt” w passie gry (warstwa 0, kamera ortho Core3D) — porty z dema
// (dema/warp-webgpu/rift.js i glow.js), każdy JEDEN draw call (instancje), dane instancji
// względem początku przy kamerze (mesh.position — sceneOrigin.js, precyzja przy 5–10 mln j.).
//
//   RiftSprites — SZCZELINA tunelu (przylot / odlot NPC): soczewka wzdłuż kursu z cienkimi
//                 jasnymi brzegami (jedyne nad progiem bloomu), w środku przestrzeń warpa —
//                 strugi płynące wzdłuż osi w barwach plazmy okrętu (piraci: migocząca).
//   GlowSprites — BŁYSKI (okrągłe), SMUGI i LINIE (szew poza sylwetką, poprzeczna linia blasku).
// Kolor premultiplied, alfa zostaje (blend: kolor One/One, alfa Zero/One) — blask nie
// wycina dziur w buforze sceny. Bez świecących okręgów (shockwave-style): fale warpa to
// wyłącznie refrakcja (źródła zniekształceń Core3D).
// Dysz MAIN i plazmy WARP w grze nie rysujemy tu (engineVfxSystem / warpPlume3D).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, attribute, uniform, positionGeometry, varyingProperty, uv, max,
  abs, exp, clamp, smoothstep, floor, fract, sin, dot, mix, length, select, nodeObject
} from 'three/tsl';
import { warpBloomKnee } from './bloomKnee.js';

export const RIFT_CAP = 24;
export const GLOW_CAP = 256;
export const GLOW_ROUND = 0;
export const GLOW_STREAK = 1;
export const GLOW_LINE = 2;
/** Kolejność w passie ortho: szczeliny pod kadłubami (10), błyski nad nimi. */
export const RIFT_RENDER_ORDER = 3;
export const SMEAR_RENDER_ORDER = 4;
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

export class RiftSprites {
  constructor() {
    const geo = instancedQuadGeometry();
    const mk = () => liveAttribute(new THREE.InstancedBufferAttribute(new Float32Array(RIFT_CAP * 4), 4));
    this.attrs = { rA: mk(), rB: mk(), rC: mk(), rD: mk(), rE: mk() };
    for (const k of Object.keys(this.attrs)) geo.setAttribute(k, this.attrs[k]);
    this.geo = geo;
    this.count = 0;
    this.u = { time: uniform(0) };
    const U = this.u;

    const rA = attribute('rA', 'vec4'); // xy środek (względem początku), zw oś
    const rB = attribute('rB', 'vec4'); // x pół-długość, y pół-szerokość otwarcia, z pół-szerokość kwadu, w szerokość brzegu
    const rC = attribute('rC', 'vec4'); // rgb rdzeń (HDR), w jasność
    const rD = attribute('rD', 'vec4'); // rgb ciało plazmy, w „brudny” (piraci)
    const rE = attribute('rE', 'vec4'); // x ziarno, y przepływ wnętrza, z wypełnienie wnętrza, w —
    const vX = varyingProperty('float', 'vRiftX');
    const vY = varyingProperty('float', 'vRiftY');

    const mat = additive(new THREE.NodeMaterial());
    mat.name = 'warp:rift';
    mat.positionNode = Fn(() => {
      const g = positionGeometry.xy;
      const along = rB.x.mul(1.12).add(rB.w.mul(4.0));
      const lx = g.x.mul(2.0).mul(along);
      const ly = g.y.mul(2.0).mul(rB.z);
      vX.assign(lx);
      vY.assign(ly);
      const ax = vec2(rA.z, rA.w);
      const pr = vec2(rA.w.negate(), rA.z);
      return vec3(rA.xy.add(ax.mul(lx)).add(pr.mul(ly)), 6.0);
    })();
    mat.fragmentNode = Fn(() => {
      const hl = max(rB.x, 1.0);
      const t = clamp(vX.div(hl), -1.0, 1.0);
      const wv = rB.y.mul(max(float(1.0).sub(t.mul(t)), 0.0)).toVar();
      const ay = abs(vY).toVar();
      // smoothstep(1,04; 0,8; |x|/hl) z dema (odwrócone krawędzie) wzorem 1 − smoothstep(0,8; 1,04).
      const tips = float(1.0).sub(smoothstep(0.8, 1.04, abs(vX).div(hl))).toVar();
      // Brzeg: cienka linia na krawędzi soczewki (przy małym otwarciu — kreska).
      const ew = max(rB.w, 1.0);
      const ed = ay.sub(wv).div(ew);
      const dirty = rD.w;
      const flick = mix(float(1.0), sin(U.time.mul(41.0).add(vX.mul(0.013)).add(rE.x)).mul(0.35).add(0.75), dirty);
      const edge = exp(ed.mul(ed).negate()).mul(tips).mul(flick);
      // Wnętrze: przestrzeń warpa — strugi płynące wzdłuż osi. smoothstep(wv, wv − 1,5 ew, ay)
      // z dema (odwrócone) wzorem 1 − smoothstep(wv − 1,5 ew, wv, ay).
      const inside = float(1.0).sub(smoothstep(wv.sub(ew.mul(1.5)), wv, ay)).mul(tips).toVar();
      const lane = floor(vY.div(max(rB.y.mul(0.22), ew))).toVar();
      const rnd = fract(sin(dot(vec2(lane, rE.x), vec2(12.9898, 78.233))).mul(43758.5453));
      const f = fract(vX.div(hl.mul(0.45)).sub(U.time.mul(rE.y).mul(rnd.mul(0.8).add(0.6))).add(rnd.mul(7.0)));
      const streak = smoothstep(0.0, 0.08, f).mul(float(1.0).sub(smoothstep(0.12, 0.55, f))).mul(rnd.mul(0.7).add(0.3));
      const interior = rD.rgb.mul(inside.mul(streak.mul(1.1).add(0.18))).mul(rE.z);
      // Poświata przy szczelinie w kształcie soczewki: zwęża się ku ostrzom (stała szerokość
      // dawała prostokąt) i gaśnie przed brzegiem kwadu.
      const env = max(float(1.0).sub(t.mul(t)), 0.0).toVar();
      const glowW = rB.y.mul(1.3).mul(env.sqrt()).add(ew.mul(3.0));
      const glow = rD.rgb.mul(exp(max(ay.sub(wv), 0.0).div(glowW).negate()).mul(0.22)).mul(env).mul(tips)
        .mul(float(1.0).sub(smoothstep(rB.z.mul(0.6), rB.z, ay)));
      const col = rC.rgb.mul(edge).add(interior).add(glow).mul(rC.w);
      return vec4(warpBloomKnee(max(col, vec3(0.0))), 0.0);
    })();
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = RIFT_RENDER_ORDER;
    this.mesh.name = 'warp:rifts';
    this.mesh.visible = false;
  }

  begin() {
    this.count = 0;
  }

  /**
   * Szczelina (scena, względem początku): (x, y) środek, (ax, ay) oś, halfLen, halfWidth
   * (otwarcie), edgeW (szerokość brzegu, j.), core / body — barwy [r, g, b] (mnożniki
   * coreK / bodyK), k — jasność.
   */
  add(x, y, ax, ay, halfLen, halfWidth, edgeW, core, coreK, body, bodyK, k, dirty = 0, seed = 0, flow = 1.6, fill = 1) {
    if (this.count >= RIFT_CAP || !(halfLen > 1) || !(k > 0.002)) return;
    const o = (this.count++) * 4;
    const A = this.attrs;
    A.rA.array[o] = x; A.rA.array[o + 1] = y; A.rA.array[o + 2] = ax; A.rA.array[o + 3] = ay;
    A.rB.array[o] = halfLen; A.rB.array[o + 1] = halfWidth; A.rB.array[o + 2] = halfWidth * 5 + edgeW * 10 + 60; A.rB.array[o + 3] = edgeW;
    A.rC.array[o] = core[0] * coreK; A.rC.array[o + 1] = core[1] * coreK; A.rC.array[o + 2] = core[2] * coreK; A.rC.array[o + 3] = k;
    A.rD.array[o] = body[0] * bodyK; A.rD.array[o + 1] = body[1] * bodyK; A.rD.array[o + 2] = body[2] * bodyK; A.rD.array[o + 3] = dirty;
    A.rE.array[o] = seed; A.rE.array[o + 1] = flow; A.rE.array[o + 2] = fill; A.rE.array[o + 3] = 0;
  }

  commit(time, originX, originY) {
    this.u.time.value = time;
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    this.mesh.position.set(originX, originY, 0);
    for (const k in this.attrs) markLive(this.attrs[k], n * 4);
  }
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
      return vec4(warpBloomKnee(gB.rgb.mul(shape)), 0.0);
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

// ── Smuga sylwetki ──────────────────────────────────────────────────────────────
// Kopia alfy sprite'a kadłuba rozciągnięta wzdłuż kursu, addytywnie, w barwie ciała
// plazmy (dema/warp-webgpu/hulls.js: smearMaterial). Pula siatek (jedna na smugę naraz),
// materiały na JEDNYM grafie (ten sam klucz programu), tekstura sprite'a per obiekt.

// Tekstura per obiekt: `texture().onObjectUpdate()` w three r183 nie działa (PLAN §3,
// HullObjectTextureNode w hexShips3D.tsl.js) — updateType na stałe OBJECT i własne update().
class SmearTextureNode extends THREE.TextureNode {
  static get type() { return 'WarpSmearTextureNode'; }
  get updateType() { return THREE.NodeUpdateType.OBJECT; }
  set updateType(_v) { /* stałe OBJECT */ }
  update(frame) {
    const v = frame.material?.uniforms?.map?.value;
    this.value = (v && v.isTexture === true) ? v : this.smearFallback;
  }
  clone() {
    const node = super.clone();
    node.smearFallback = this.smearFallback;
    return node;
  }
}

function placeholderTexture() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

let _smearGraph = null;
function smearGraph() {
  if (_smearGraph) return _smearGraph;
  const fallback = placeholderTexture();
  const perObject = (key, type, init) => uniform(init, type).onObjectUpdate(({ material }) => material.uniforms[key].value);
  const uColor = perObject('color', 'vec3', new THREE.Vector3(1, 0.5, 1));
  const uK = perObject('k', 'float', 0);
  // Sprite kadłuba ma flipY = false (wiersz 0 = góra obrazu = +y sceny), a v kwadu rośnie w górę;
  // u = 1 przy dziobie (+x kwadu i sprite'a).
  const t = uv();
  const raw = new SmearTextureNode(fallback, vec2(t.x, float(1.0).sub(t.y)));
  raw.smearFallback = fallback;
  const tex = nodeObject(raw);
  // Najjaśniej przy dziobie, gaśnie ku ogonowi smugi.
  const fade = t.x.mul(t.x).mul(t.x.mul(0.6).add(0.4));
  _smearGraph = { fragmentNode: Fn(() => vec4(warpBloomKnee(uColor.mul(uK).mul(tex.a).mul(fade)), 0.0))() };
  return _smearGraph;
}

class SmearMaterial extends THREE.NodeMaterial {
  static get type() { return 'WarpSmearMaterial'; }
  constructor() {
    super();
    additive(this);
    this.name = 'warp:smear';
    this.uniforms = { map: { value: null }, color: { value: new THREE.Vector3(1, 0.5, 1) }, k: { value: 0 } };
    this.fragmentNode = smearGraph().fragmentNode;
  }
}

export class SmearPool {
  constructor(capacity = 8) {
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < capacity; i++) {
      const material = new SmearMaterial();
      const mesh = new THREE.Mesh(geo, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = SMEAR_RENDER_ORDER;
      mesh.name = 'warp:smear';
      mesh.visible = false;
      this.items.push({ mesh, material });
    }
    this.count = 0;
  }

  begin() {
    this.count = 0;
  }

  /**
   * Smuga (scena, względem początku): (bowX, bowY) — dziób, (dirX, dirY) kurs (scena),
   * length × width [j.] — prostokąt smugi (długość całkowita), texture — sprite kadłuba,
   * rgb, k — barwa i jasność.
   */
  add(texture, cx, cy, angle, length, width, r, g, b, k) {
    if (this.count >= this.items.length || !texture || !(k > 0.01)) return;
    const it = this.items[this.count++];
    const m = it.mesh;
    m.position.set(cx, cy, -1);
    m.rotation.set(0, 0, angle);
    m.scale.set(length, width, 1);
    it.material.uniforms.map.value = texture;
    it.material.uniforms.color.value.set(r, g, b);
    it.material.uniforms.k.value = k;
    m.visible = true;
  }

  commit(originX, originY) {
    for (let i = 0; i < this.items.length; i++) {
      const m = this.items[i].mesh;
      if (i >= this.count) { m.visible = false; continue; }
      m.position.x += originX;
      m.position.y += originY;
    }
  }
}
