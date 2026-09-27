// dema/bronie-webgpu/gpuFx.js
//
// Silnik cząstek dema broni na GPU (WebGPU, TSL, compute).
//
// CPU nie rodzi cząstek pojedynczo: recepta efektu wysyła PACZKI („burst”):
// jeden rekord = N cząstek jednego rodzaju z zakresami (stożek, prędkość, życie,
// rozmiar, barwy, zanik…). Kernel `spawn` rozwija paczki w cząstki na GPU
// (wyszukiwanie binarne paczki po indeksie wątku, losowanie z hash PCG), więc
// wystrzał z 500 iskrami to kilkadziesiąt bajtów na CPU. Przydział slotów jest
// pierścieniowy (głowa pierścienia na CPU) — najstarsze cząstki są nadpisywane,
// pojemności są dobrane tak, żeby do tego nie dochodziło.
//
// Pule (jeden draw call każda):
//   ADD   — addytywne kwady: rdzeń rozbłysku (GLOW), gwiazda (FLARE), krzyż
//           anamorficzny (CROSS), jęzor ognia (PLUME), kula ognia z szumu (FIRE),
//           opar (VAPOR). Ruch ANALITYCZNY (p0 + v·(1 − e^(−d·t))/d) — bez kernela
//           aktualizacji; wiek = czas − narodziny.
//   SPARK — iskry: smugi wzdłuż prędkości o stałej szerokości w pikselach,
//           stygnięcie barwy, odbicie od kadłubów (pole odległości sylwetki).
//   SMOKE — dym (mieszanie premultiplied): turbulencja z tekstury szumu,
//           oświetlenie per cząstka z siatki świateł (błyski luf i ognia
//           rozświetlają dym od środka) + żar świeżego dymu.
//   DEBRIS— odłamki, łuski, płatki sabotu: bryłki z proceduralnym obrysem,
//           żar stygnący, odbicie od kadłubów, oświetlenie z siatki.
//   DIST  — zniekształcenie (osobny pass): drganie gorącego powietrza i fale
//           uderzeniowe jako SAMA refrakcja (bez świecących okręgów).
//   ARC   — łuki elektryczne: pasek z SEG odcinków między A i B, kształt
//           losowany ~30 razy na sekundę (trzeszczy, nie migocze).
//
// Układ: scena = (x, −y) świata gry, +z ku kamerze ortho. Wszystko względem
// początku sceny dema (tu świat stoi przy zerze; w grze byłby to początek
// przy kamerze — sceneOrigin.js — i przesunięcie danych jak `shift` w pyle).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, instancedArray, attributeArray,
  instanceIndex, If, Loop, Return, select, mix, clamp, smoothstep, exp, pow, sin, cos, sqrt,
  max, min, abs, length, normalize, dot, cross, hash, positionGeometry, uv, varyingProperty,
  texture, atan, floor, fract
} from 'three/tsl';

const sq = (x) => x.mul(x);

// ---------------------------------------------------------------------------
// Rodzaje

export const K = Object.freeze({
  // ADD
  GLOW: 0, FLARE: 1, CROSS: 2, PLUME: 3, FIRE: 4, VAPOR: 5,
  // SPARK (pole flags)
  SPARK: 0, SPARK_ION: 1,
  // DEBRIS
  CHUNK: 0, CASING: 1, PETAL: 2,
  // DIST
  HEAT: 0, SHOCK: 1
});

const BSTRIDE = 12;          // vec4 na paczkę
const BURST_CAP = 2048;      // paczek na pulę na klatkę
const BSEARCH_STEPS = 12;    // log2(BURST_CAP) + 1

// Pojemności pul (potęgi dwójki).
export const CAPS = Object.freeze({
  add: 1 << 17,
  spark: 1 << 18,
  smoke: 1 << 15,
  debris: 1 << 14,
  dist: 1 << 13,
  arc: 1 << 12
});

const STRIDE = Object.freeze({ add: 7, spark: 5, smoke: 8, debris: 6, dist: 4, arc: 4 });

export const HULL_SLOTS = 2;
const ARC_SEG = 14;

// ---------------------------------------------------------------------------
// Pomocnicze TSL

/** Losowy kierunek w stożku (lustro coneDir z src/3d/fxParticles3D.js). */
function coneDir(dir, spread, flat, r1, r2) {
  const d = normalize(dir).toVar();
  const up = select(abs(d.z).greaterThan(0.9), vec3(1, 0, 0), vec3(0, 0, 1));
  const bx = normalize(cross(up, d)).toVar();
  const by = cross(d, bx).toVar();
  const theta = spread.mul(sqrt(r1));
  const phi = r2.mul(6.2831853);
  const st = sin(theta);
  const ct = cos(theta);
  const dev = d.mul(ct.sub(1.0)).add(bx.mul(st.mul(cos(phi)))).add(by.mul(st.mul(sin(phi)))).toVar();
  dev.z.mulAssign(flat);
  return normalize(d.add(dev).add(vec3(0.0, 0.0, 1e-6)));
}

/** Ruch z oporem liniowym: droga po czasie t przy prędkości początkowej 1. */
function dragPath(drag, t) {
  return select(drag.greaterThan(1e-4), float(1.0).sub(exp(drag.negate().mul(t))).div(max(drag, 1e-4)), t);
}

function additiveMaterial() {
  const mat = new THREE.NodeMaterial();
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
  return mat;
}

function premulMaterial() {
  const mat = new THREE.NodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.depthTest = false;
  mat.lights = false;
  mat.fog = false;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.blendEquation = THREE.AddEquation;
  mat.blendEquationAlpha = THREE.AddEquation;
  return mat;
}

// ---------------------------------------------------------------------------
// Pula: bufor cząstek + kolejka paczek + budowniczy paczki (CPU, bez alokacji)

class Pool {
  constructor(name, cap, stride) {
    this.name = name;
    this.cap = cap;
    this.stride = stride;
    this.buf = instancedArray(cap * stride, 'vec4').setName(`fx_${name}`);
    this.burstNode = attributeArray(BURST_CAP * BSTRIDE, 'vec4').setName(`fx_${name}_bursts`);
    this.bursts = this.burstNode.value.array;
    this.burstCount = 0;
    this.total = 0;
    this.head = 0;
    this.spawnedTotal = 0;
    this.dropped = 0;
    this._b = new Float32Array(BSTRIDE * 4);
    this._count = 0;
    this._open = false;
  }

  // --- budowniczy ------------------------------------------------------------
  // Użycie: pool.begin(kind, n).at(…).dir(…).speed(…)….emit()

  begin(kind, count) {
    const b = this._b;
    b.fill(0);
    this._count = Math.max(0, Math.floor(count));
    b[3] = kind;
    // domyślne
    b[8] = 1; // dir x
    b[14] = 1; b[15] = 1;        // life
    b[16] = 1; b[17] = 1; b[18] = 1; b[19] = 1;  // rozmiary
    b[20] = 1; b[21] = 1; b[22] = 1; b[23] = 1;  // c0, alfa min
    b[24] = 1; b[25] = 1; b[26] = 1; b[27] = 1;  // c1, alfa max
    b[29] = 0.6; b[30] = 0.06; b[31] = 1.5;      // grow, fadeIn, fadeOut
    b[32] = 4; b[33] = 1;                        // mix, flat
    b[39] = 0.3;                                 // sprężystość iskier
    this._open = true;
    return this;
  }
  at(x, y, z = 15) { const b = this._b; b[4] = x; b[5] = y; b[6] = z; return this; }
  preAge(t) { this._b[7] = t; return this; }
  dir(x, y, z = 0) {
    const l = Math.hypot(x, y, z) || 1;
    const b = this._b; b[8] = x / l; b[9] = y / l; b[10] = z / l; return this;
  }
  cone(spread, flat = 1) { const b = this._b; b[11] = spread; b[33] = flat; return this; }
  speed(a, c = a) { const b = this._b; b[12] = a; b[13] = c; return this; }
  life(a, c = a) { const b = this._b; b[14] = a; b[15] = c; return this; }
  size(s0a, s0b, s1a = s0a, s1b = s0b) { const b = this._b; b[16] = s0a; b[17] = s0b; b[18] = s1a; b[19] = s1b; return this; }
  /** Kwady zorientowane (CROSS, PLUME): długość l0→l1, szerokość w0→w1. */
  orient(l0, l1, w0, w1) { return this.size(l0, l1, w0, w1); }
  color(r, g, bl) { const b = this._b; b[20] = r; b[21] = g; b[22] = bl; b[24] = r; b[25] = g; b[26] = bl; return this; }
  color1(r, g, bl) { const b = this._b; b[24] = r; b[25] = g; b[26] = bl; return this; }
  colors(c0, c1 = c0) { this.color(c0[0], c0[1], c0[2]); return this.color1(c1[0], c1[1], c1[2]); }
  alpha(a, c = a) { const b = this._b; b[23] = a; b[27] = c; return this; }
  drag(a, c = a) { const b = this._b; b[28] = a; b[43] = c; return this; }
  bounce(r) { this._b[39] = r; return this; }
  grow(g) { this._b[29] = g; return this; }
  fade(fadeIn, fadeOut) { const b = this._b; b[30] = fadeIn; b[31] = fadeOut; return this; }
  mix(m) { this._b[32] = m; return this; }
  offset(a, c = a) { const b = this._b; b[34] = a; b[35] = c; return this; }
  jitter(r, z = 0) { const b = this._b; b[36] = r; b[37] = z; return this; }
  spin(s) { this._b[38] = s; return this; }
  vel(x, y, z = 0) { const b = this._b; b[40] = x; b[41] = y; b[42] = z; return this; }
  extra(a = 0, c = 0, d = 0, e = 0) { const b = this._b; b[44] = a; b[45] = c; b[46] = d; b[47] = e; return this; }

  emit() {
    if (!this._open) return this;
    this._open = false;
    let n = this._count;
    if (n <= 0) return this;
    if (this.burstCount >= BURST_CAP) { this.dropped += n; return this; }
    n = Math.min(n, this.cap >> 2);
    const b = this._b;
    b[0] = this.total;
    b[1] = n;
    b[2] = this.head;
    this.bursts.set(b, this.burstCount * BSTRIDE * 4);
    this.burstCount++;
    this.total += n;
    this.head = (this.head + n) & (this.cap - 1);
    this.spawnedTotal += n;
    return this;
  }
}

// ---------------------------------------------------------------------------
// Silnik

export class GpuFx {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Scene} o.scene     scena gry (pass główny)
   * @param {THREE.Scene} o.distScene scena zniekształceń (osobny pass)
   * @param {THREE.Texture} o.noise   tekstura szumu (noise.js)
   * @param {import('./lightGrid.js').LightGrid} o.grid
   */
  constructor({ renderer, scene, distScene, noise, grid }) {
    this.renderer = renderer;
    this.noise = noise;
    this.grid = grid;
    this.U = {
      time: uniform(0),
      dt: uniform(0),
      zoom: uniform(1),
      seedBase: uniform(0, 'uint'),
      spawnTotal: uniform(0, 'uint'),
      burstCount: uniform(0, 'uint'),
      ambient: uniform(new THREE.Vector3(0.05, 0.055, 0.07)),
      sunDir: uniform(new THREE.Vector3(0.3, 0.5, 0.8).normalize()),
      sunCol: uniform(new THREE.Vector3(0.6, 0.58, 0.55)),
      smokeLight: uniform(1),
      hullA: uniformArray(Array.from({ length: HULL_SLOTS }, () => new THREE.Vector4()), 'vec4'),
      hullB: uniformArray(Array.from({ length: HULL_SLOTS }, () => new THREE.Vector4(1, 1, 0, 0)), 'vec4')
    };
    this.pools = {
      add: new Pool('add', CAPS.add, STRIDE.add),
      spark: new Pool('spark', CAPS.spark, STRIDE.spark),
      smoke: new Pool('smoke', CAPS.smoke, STRIDE.smoke),
      debris: new Pool('debris', CAPS.debris, STRIDE.debris),
      dist: new Pool('dist', CAPS.dist, STRIDE.dist),
      arc: new Pool('arc', CAPS.arc, STRIDE.arc)
    };
    this.add = this.pools.add;
    this.spark = this.pools.spark;
    this.smoke = this.pools.smoke;
    this.debris = this.pools.debris;
    this.dist = this.pools.dist;
    this.arc = this.pools.arc;
    this._sdf = [null, null];
    this.time = 0;
    this.frameSeed = 1;
    this.stats = { spawned: 0 };
    this._scene = scene;
    this._distScene = distScene;
  }

  /** Pola odległości kadłubów (tekstury z hull.js); przed build(). */
  setHullSdf(slot, texture) { this._sdf[slot] = texture; }

  /** Poza kadłuba w scenie: środek, obrót (scena), wymiar pola SDF [j.]. */
  setHullPose(slot, x, y, rot, sdfW, sdfH, active = true) {
    const U = this.U;
    U.hullA.array[slot].set(x, y, Math.cos(rot), Math.sin(rot));
    U.hullB.array[slot].set(sdfW, sdfH, active ? 1 : 0, 0);
  }

  build() {
    const blank = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    blank.needsUpdate = true;
    for (let i = 0; i < HULL_SLOTS; i++) if (!this._sdf[i]) this._sdf[i] = blank;
    this._buildSpawn();
    this._buildUpdate();
    this._buildRender();
  }

  // -------------------------------------------------------------------------
  // SPAWN — wspólny rdzeń + zapis per pula

  _spawnCommon(pool) {
    const U = this.U;
    const bursts = pool.burstNode;
    const t = instanceIndex.toVar();
    const tf = t.toFloat().toVar();
    // Wyszukiwanie binarne: ostatnia paczka z firstIndex ≤ t.
    const lo = uint(0).toVar();
    const hi = U.burstCount.toVar();
    Loop(BSEARCH_STEPS, () => {
      If(hi.sub(lo).greaterThan(uint(1)), () => {
        const mid = lo.add(hi).shiftRight(uint(1)).toVar();
        If(bursts.element(mid.mul(uint(BSTRIDE))).x.lessThanEqual(tf), () => { lo.assign(mid); })
          .Else(() => { hi.assign(mid); });
      });
    });
    const base = lo.mul(uint(BSTRIDE)).toVar();
    const B = (k) => bursts.element(base.add(uint(k)));
    const h = B(0).toVar();
    const local = tf.sub(h.x).toVar();
    const slot = uint(h.z.add(local)).bitAnd(uint(pool.cap - 1)).toVar();
    const seed = t.add(U.seedBase).toVar();
    const R = (k) => hash(seed.mul(uint(23)).add(uint(k)));
    const b1 = B(1).toVar(); const b2 = B(2).toVar(); const b3 = B(3).toVar();
    const b4 = B(4).toVar(); const b5 = B(5).toVar(); const b6 = B(6).toVar();
    const b7 = B(7).toVar(); const b8 = B(8).toVar(); const b9 = B(9).toVar();
    const b10 = B(10).toVar(); const b11 = B(11).toVar();
    const kind = h.w;
    const life = mix(b3.z, b3.w, R(1)).toVar();
    const speed = mix(b3.x, b3.y, R(2)).toVar();
    const d = coneDir(b2.xyz, b2.w, b8.y, R(3), R(4)).toVar();
    const off = mix(b8.z, b8.w, R(5));
    // Rozrzut miejsca narodzin: dysk w płaszczyźnie (jitter) + z.
    const ja = R(6).mul(6.2831853);
    const jr = sqrt(R(7)).mul(b9.x);
    const p = b1.xyz.add(d.mul(off)).add(vec3(cos(ja).mul(jr), sin(ja).mul(jr), R(8).sub(0.5).mul(2.0).mul(b9.y))).toVar();
    const v = d.mul(speed).add(b10.xyz).toVar();
    const pre = R(9).mul(b1.w).toVar();
    const drag = mix(b7.x, max(b10.w, b7.x), R(20)).toVar();
    const anim = vec4(drag, b7.y, b7.z, b7.w);
    return {
      drag, anim,
      slot, R, kind, life, speed, d, p, v, pre, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11,
      s0: mix(b4.x, b4.y, R(10)), s1: mix(b4.z, b4.w, R(11)),
      alpha: mix(b5.w, b6.w, R(12)), c0: b5.xyz, c1: b6.xyz
    };
  }

  _buildSpawn() {
    const U = this.U;
    const P = this.pools;
    const guard = () => { If(instanceIndex.greaterThanEqual(U.spawnTotal), () => { Return(); }); };
    const wr = (pool, c, k, value) => pool.buf.element(c.slot.mul(uint(pool.stride)).add(uint(k))).assign(value);

    // ADD: p0 pos+narodziny, p1 v+życie, p2 s0 s1 rot0 spin (orient: l0 l1 w0 w1),
    // p3 c0+alfa, p4 c1+mix, p5 opór grow fadeIn fadeOut, p6 rodzaj dir.xy ziarno.
    this.spawnAdd = Fn(() => {
      guard();
      const c = this._spawnCommon(P.add);
      const isOri = c.kind.equal(float(K.CROSS)).or(c.kind.equal(float(K.PLUME)));
      const sizes = select(isOri, c.b4, vec4(c.s0, c.s1, c.R(13).mul(6.2831853), c.R(14).sub(0.5).mul(2.0).mul(c.b9.z)));
      wr(P.add, c, 0, vec4(c.p, U.time.sub(c.pre)));
      wr(P.add, c, 1, vec4(c.v, c.life));
      wr(P.add, c, 2, sizes);
      wr(P.add, c, 3, vec4(c.c0, c.alpha));
      wr(P.add, c, 4, vec4(c.c1, c.b8.x));
      wr(P.add, c, 5, c.anim);
      wr(P.add, c, 6, vec4(c.kind, c.b2.x, c.b2.y, c.R(15)));
    })().compute(CAPS.add).setName('fxSpawnAdd');

    // SPARK: p0 pos+wiek, p1 v+życie, p2 barwa+faza, p3 opór smuga coolG coolB,
    // p4 szerokość[px] sprężystość ziarno rodzaj. extra = (smuga, coolG, coolB, px).
    this.spawnSpark = Fn(() => {
      guard();
      const c = this._spawnCommon(P.spark);
      const px = select(c.b11.w.greaterThan(0.0), c.b11.w, float(1.6));
      const bright = mix(float(0.75), float(1.25), c.R(16));
      wr(P.spark, c, 0, vec4(c.p.add(c.v.mul(c.pre)), c.pre));
      wr(P.spark, c, 1, vec4(c.v, c.life));
      wr(P.spark, c, 2, vec4(c.c0.mul(bright).mul(c.alpha), c.R(17).mul(6.28)));
      wr(P.spark, c, 3, vec4(c.drag, select(c.b11.x.greaterThan(0.0), c.b11.x, float(60.0)), c.b11.y, c.b11.z));
      wr(P.spark, c, 4, vec4(px.mul(mix(float(0.8), float(1.2), c.R(18))), c.b9.w, c.R(19), c.kind));
    })().compute(CAPS.spark).setName('fxSpawnSpark');

    // SMOKE: p0 pos+wiek, p1 v+życie, p2 s0 s1 rot0 spin, p3 żar+alfa, p4 albedo+tempo
    // stygnięcia, p5 opór grow fadeIn fadeOut, p6 światło+ziarno, p7 kier. światła+turb.
    // extra = (turbulencja, stygnięcie żaru [1/s]).
    this.spawnSmoke = Fn(() => {
      guard();
      const c = this._spawnCommon(P.smoke);
      wr(P.smoke, c, 0, vec4(c.p.add(c.v.mul(c.pre)), c.pre));
      wr(P.smoke, c, 1, vec4(c.v, c.life));
      wr(P.smoke, c, 2, vec4(c.s0, c.s1, c.R(13).mul(6.2831853), c.R(14).sub(0.5).mul(2.0).mul(c.b9.z)));
      wr(P.smoke, c, 3, vec4(c.c0, c.alpha));
      wr(P.smoke, c, 4, vec4(c.c1, select(c.b11.y.greaterThan(0.0), c.b11.y, float(4.0))));
      wr(P.smoke, c, 5, c.anim);
      wr(P.smoke, c, 6, vec4(0.0, 0.0, 0.0, c.R(15)));
      wr(P.smoke, c, 7, vec4(0.0, 0.0, 1.0, c.b11.x));
    })().compute(CAPS.smoke).setName('fxSpawnSmoke');

    // DEBRIS: p0 pos+wiek, p1 v+życie, p2 rozmiar rot spin ziarno, p3 żar+stygnięcie,
    // p4 albedo+rodzaj, p5 światło+opór. extra = (stygnięcie, sprężystość).
    this.spawnDebris = Fn(() => {
      guard();
      const c = this._spawnCommon(P.debris);
      wr(P.debris, c, 0, vec4(c.p.add(c.v.mul(c.pre)), c.pre));
      wr(P.debris, c, 1, vec4(c.v, c.life));
      wr(P.debris, c, 2, vec4(c.s0, c.R(13).mul(6.2831853), c.R(14).sub(0.5).mul(2.0).mul(c.b9.z), c.R(15)));
      wr(P.debris, c, 3, vec4(c.c0.mul(c.alpha), select(c.b11.x.greaterThan(0.0), c.b11.x, float(1.5))));
      wr(P.debris, c, 4, vec4(c.c1, c.kind));
      wr(P.debris, c, 5, vec4(0.0, 0.0, 0.0, c.drag));
    })().compute(CAPS.debris).setName('fxSpawnDebris');

    // DIST: p0 pos+narodziny, p1 v+życie, p2 s0 s1 siła rodzaj, p3 fadeIn fadeOut grow ziarno.
    this.spawnDist = Fn(() => {
      guard();
      const c = this._spawnCommon(P.dist);
      wr(P.dist, c, 0, vec4(c.p, U.time.sub(c.pre)));
      wr(P.dist, c, 1, vec4(c.v, c.life));
      wr(P.dist, c, 2, vec4(c.s0, c.s1, c.alpha, c.kind));
      wr(P.dist, c, 3, vec4(c.b7.z, c.b7.w, c.b7.y, c.R(15)));
    })().compute(CAPS.dist).setName('fxSpawnDist');

    // ARC: p0 A+narodziny, p1 B+życie, p2 barwa+amplituda, p3 szer.[px] ziarno.
    // B = A + kierunek·dystans (prędkość = dystans). extra = (amplituda, px).
    this.spawnArc = Fn(() => {
      guard();
      const c = this._spawnCommon(P.arc);
      const bpt = c.p.add(c.d.mul(c.speed));
      wr(P.arc, c, 0, vec4(c.p, U.time.sub(c.pre)));
      wr(P.arc, c, 1, vec4(bpt, c.life));
      wr(P.arc, c, 2, vec4(c.c0.mul(c.alpha), c.b11.x));
      wr(P.arc, c, 3, vec4(select(c.b11.y.greaterThan(0.0), c.b11.y, float(1.5)), c.R(16).mul(4096.0).floor(), 0.0, 0.0));
    })().compute(CAPS.arc).setName('fxSpawnArc');

    this._spawnNodes = { add: this.spawnAdd, spark: this.spawnSpark, smoke: this.spawnSmoke, debris: this.spawnDebris, dist: this.spawnDist, arc: this.spawnArc };
  }

  // -------------------------------------------------------------------------
  // UPDATE — iskry, dym, odłamki (stan), światło dymu i odłamków

  /** Kolizja z kadłubami: wypchnięcie na powierzchnię, odbicie, tarcie. */
  _collideHulls(p, v, restitution, friction) {
    const U = this.U;
    for (let h = 0; h < HULL_SLOTS; h++) {
      const A = U.hullA.element(h);
      const Bh = U.hullB.element(h);
      const sdfTex = this._sdf[h];
      If(Bh.z.greaterThan(0.5), () => {
        const dx = p.x.sub(A.x);
        const dy = p.y.sub(A.y);
        const lx = dx.mul(A.z).add(dy.mul(A.w));
        const ly = dx.mul(A.w).negate().add(dy.mul(A.z));
        const u = lx.div(Bh.x).add(0.5);
        const w = ly.div(Bh.y).add(0.5);
        If(u.greaterThan(0.0).and(u.lessThan(1.0)).and(w.greaterThan(0.0)).and(w.lessThan(1.0)), () => {
          const s = texture(sdfTex, vec2(u, w)).level(0).toVar();
          If(s.x.lessThan(1.5), () => {
            const gl = vec2(s.y, s.z);
            const nl = gl.div(max(length(gl), 1e-4));
            const n = vec3(nl.x.mul(A.z).sub(nl.y.mul(A.w)), nl.x.mul(A.w).add(nl.y.mul(A.z)), 0.0).toVar();
            p.addAssign(n.mul(float(1.5).sub(s.x)));
            const vn = dot(v, n).toVar();
            If(vn.lessThan(0.0), () => {
              const vt = v.sub(n.mul(vn));
              v.assign(vt.mul(float(1.0).sub(friction)).sub(n.mul(vn.mul(restitution))));
            });
          });
        });
      });
    }
  }

  _buildUpdate() {
    const U = this.U;
    const P = this.pools;
    const noise = this.noise;

    this.updateSpark = Fn(() => {
      const i = instanceIndex.mul(uint(P.spark.stride)).toVar();
      const P0 = P.spark.buf.element(i).toVar();
      const P1 = P.spark.buf.element(i.add(uint(1))).toVar();
      If(P0.w.greaterThanEqual(P1.w), () => { Return(); });
      const P3 = P.spark.buf.element(i.add(uint(3)));
      const P4 = P.spark.buf.element(i.add(uint(4)));
      const p = P0.xyz.toVar();
      const v = P1.xyz.toVar();
      v.mulAssign(exp(P3.x.negate().mul(U.dt)));
      p.addAssign(v.mul(U.dt));
      this._collideHulls(p, v, P4.y, float(0.35));
      P.spark.buf.element(i).assign(vec4(p, P0.w.add(U.dt)));
      P.spark.buf.element(i.add(uint(1))).assign(vec4(v, P1.w));
    })().compute(CAPS.spark).setName('fxUpdateSpark');

    this.updateSmoke = Fn(() => {
      const i = instanceIndex.mul(uint(P.smoke.stride)).toVar();
      const P0 = P.smoke.buf.element(i).toVar();
      const P1 = P.smoke.buf.element(i.add(uint(1))).toVar();
      If(P0.w.greaterThanEqual(P1.w), () => { Return(); });
      const P5 = P.smoke.buf.element(i.add(uint(5)));
      const P7 = P.smoke.buf.element(i.add(uint(7)));
      const p = P0.xyz.toVar();
      const v = P1.xyz.toVar();
      v.mulAssign(exp(P5.x.negate().mul(U.dt)));
      // Turbulencja: rotacja pola szumu (bez źródeł), skala ~900 j.
      const q = p.xy.mul(1.0 / 900.0).add(vec2(U.time.mul(0.013), U.time.mul(-0.009)));
      const e = 1.0 / 256.0;
      const nx0 = texture(noise, q.add(vec2(e, 0))).level(0).r;
      const nx1 = texture(noise, q.sub(vec2(e, 0))).level(0).r;
      const ny0 = texture(noise, q.add(vec2(0, e))).level(0).r;
      const ny1 = texture(noise, q.sub(vec2(0, e))).level(0).r;
      const curl = vec2(ny0.sub(ny1), nx1.sub(nx0)).mul(1.0 / (2.0 * e));
      v.addAssign(vec3(curl.mul(P7.w).mul(U.dt), 0.0));
      p.addAssign(v.mul(U.dt));
      P.smoke.buf.element(i).assign(vec4(p, P0.w.add(U.dt)));
      P.smoke.buf.element(i.add(uint(1))).assign(vec4(v, P1.w));
    })().compute(CAPS.smoke).setName('fxUpdateSmoke');

    this.updateDebris = Fn(() => {
      const i = instanceIndex.mul(uint(P.debris.stride)).toVar();
      const P0 = P.debris.buf.element(i).toVar();
      const P1 = P.debris.buf.element(i.add(uint(1))).toVar();
      If(P0.w.greaterThanEqual(P1.w), () => { Return(); });
      const P2 = P.debris.buf.element(i.add(uint(2))).toVar();
      const P5 = P.debris.buf.element(i.add(uint(5)));
      const p = P0.xyz.toVar();
      const v = P1.xyz.toVar();
      v.mulAssign(exp(P5.w.negate().mul(U.dt)));
      p.addAssign(v.mul(U.dt));
      const vBefore = length(v).toVar();
      this._collideHulls(p, v, float(0.35), float(0.3));
      // Uderzenie o kadłub hamuje wirowanie.
      const spin = select(length(v).lessThan(vBefore.mul(0.98)), P2.z.mul(0.6), P2.z);
      P.debris.buf.element(i).assign(vec4(p, P0.w.add(U.dt)));
      P.debris.buf.element(i.add(uint(1))).assign(vec4(v, P1.w));
      P.debris.buf.element(i.add(uint(2))).assign(vec4(P2.x, P2.y.add(spin.mul(U.dt)), spin, P2.w));
    })().compute(CAPS.debris).setName('fxUpdateDebris');

    // Światło dymu: suma świateł siatki w punkcie cząstki i kierunek ważony mocą
    // (cieniowanie kłębu w shaderze), plus słońce.
    const grid = this.grid;
    this.lightSmoke = Fn(() => {
      const i = instanceIndex.mul(uint(P.smoke.stride)).toVar();
      const P0 = P.smoke.buf.element(i).toVar();
      const P1 = P.smoke.buf.element(i.add(uint(1)));
      If(P0.w.greaterThanEqual(P1.w), () => { Return(); });
      const acc = vec3(0).toVar();
      const dirAcc = vec3(0).toVar();
      If(U.smokeLight.greaterThan(0.5), () => {
        grid.loop(P0.xyz, ({ toL, att, col }) => {
          const c = col.mul(att);
          acc.addAssign(c);
          dirAcc.addAssign(toL.mul(dot(c, vec3(0.3, 0.5, 0.2))));
        });
      });
      const seed = P.smoke.buf.element(i.add(uint(6))).w;
      P.smoke.buf.element(i.add(uint(6))).assign(vec4(min(acc, vec3(40.0)), seed));
      const P7 = P.smoke.buf.element(i.add(uint(7)));
      const dl = length(dirAcc);
      const ld = select(dl.greaterThan(1e-5), dirAcc.div(max(dl, 1e-5)), vec3(0, 0, 1));
      P.smoke.buf.element(i.add(uint(7))).assign(vec4(ld, P7.w));
    })().compute(CAPS.smoke).setName('fxLightSmoke');

    this.lightDebris = Fn(() => {
      const i = instanceIndex.mul(uint(P.debris.stride)).toVar();
      const P0 = P.debris.buf.element(i).toVar();
      const P1 = P.debris.buf.element(i.add(uint(1)));
      If(P0.w.greaterThanEqual(P1.w), () => { Return(); });
      const acc = vec3(0).toVar();
      grid.loop(P0.xyz, ({ att, col }) => { acc.addAssign(col.mul(att)); });
      const P5 = P.debris.buf.element(i.add(uint(5)));
      P.debris.buf.element(i.add(uint(5))).assign(vec4(min(acc, vec3(40.0)), P5.w));
    })().compute(CAPS.debris).setName('fxLightDebris');
  }

  // -------------------------------------------------------------------------
  // RENDER

  _buildRender() {
    const scene = this._scene;
    this.meshes = [];
    const mk = (geo, mat, order, name, count, target = scene) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      mesh.name = name;
      mesh.count = count;
      target.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    const quad = new THREE.PlaneGeometry(1, 1);
    this.smokeMesh = mk(quad, this._smokeMaterial(), 40, 'fxSmoke', CAPS.smoke);
    this.debrisMesh = mk(quad, this._debrisMaterial(), 42, 'fxDebris', CAPS.debris);
    this.addMesh = mk(quad, this._addMaterial(), 60, 'fxAdd', CAPS.add);
    this.sparkMesh = mk(quad, this._sparkMaterial(), 62, 'fxSparks', CAPS.spark);
    this.arcMesh = mk(this._arcGeometry(), this._arcMaterial(), 64, 'fxArcs', CAPS.arc);
    this.distMesh = mk(quad, this._distMaterial(), 1, 'fxDist', CAPS.dist, this._distScene);
  }

  _addMaterial() {
    const U = this.U;
    const buf = this.pools.add.buf;
    const noise = this.noise;
    const vCol = varyingProperty('vec4', 'vAddCol');     // barwa × alfa, rodzaj
    const vInfo = varyingProperty('vec4', 'vAddInfo');   // u, ziarno, wiek, rozmiar
    const mat = additiveMaterial();
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(7)).toVar();
      const P0 = buf.element(i).toVar();
      const P1 = buf.element(i.add(uint(1))).toVar();
      const age = U.time.sub(P0.w).toVar();
      const out = vec3(0.0, 0.0, -50.0).toVar();
      vCol.assign(vec4(0.0));
      vInfo.assign(vec4(0.0));
      If(age.greaterThanEqual(0.0).and(age.lessThan(P1.w)), () => {
        const P2 = buf.element(i.add(uint(2))).toVar();
        const P3 = buf.element(i.add(uint(3))).toVar();
        const P4 = buf.element(i.add(uint(4))).toVar();
        const P5 = buf.element(i.add(uint(5))).toVar();
        const P6 = buf.element(i.add(uint(6))).toVar();
        const u = clamp(age.div(max(P1.w, 1e-4)), 0.0, 1.0).toVar();
        const pos = P0.xyz.add(P1.xyz.mul(dragPath(P5.x, age))).toVar();
        const kind = P6.x.toVar();
        const g = positionGeometry.xy;
        const corner = vec2(0.0).toVar();
        const sz = float(0.0).toVar();
        const oriented = kind.equal(float(K.CROSS)).or(kind.equal(float(K.PLUME)));
        If(oriented, () => {
          const ease = float(1.0).sub(pow(float(1.0).sub(u), 2.4));
          const len = mix(P2.x, P2.y, ease);
          const wid = mix(P2.z, P2.w, ease);
          const dl = length(P6.yz);
          const dir = select(dl.greaterThan(1e-4), P6.yz.div(max(dl, 1e-4)), vec2(1.0, 0.0));
          const perp = vec2(dir.y.negate(), dir.x);
          // krzyż wyśrodkowany; jęzor od podstawy (v = 0 u wylotu)
          const along = select(kind.equal(float(K.PLUME)), g.y.add(0.5), g.x);
          const across = select(kind.equal(float(K.PLUME)), g.x, g.y);
          corner.assign(dir.mul(along.mul(len)).add(perp.mul(across.mul(wid))));
          sz.assign(len);
        }).Else(() => {
          const size = mix(P2.x, P2.y, pow(max(u, 1e-5), P5.y));
          const rot = P2.z.add(P2.w.mul(age));
          const cr = cos(rot);
          const sr = sin(rot);
          corner.assign(vec2(g.x.mul(cr).sub(g.y.mul(sr)), g.x.mul(sr).add(g.y.mul(cr))).mul(size));
          sz.assign(size);
        });
        const fadeIn = select(oriented, float(0.1), max(P5.z, 1e-3));
        const a = P3.w.mul(smoothstep(0.0, fadeIn, u)).mul(pow(float(1.0).sub(u), P5.w));
        const col = mix(P3.xyz, P4.xyz, min(age.mul(P4.w), 1.0));
        vCol.assign(vec4(col.mul(a), kind));
        vInfo.assign(vec4(u, P6.w, age, sz.mul(U.zoom)));
        out.assign(pos.add(vec3(corner, 0.0)));
      });
      return out;
    })();
    mat.fragmentNode = Fn(() => {
      const q = uv().sub(0.5).mul(2.0).toVar();
      const r2 = dot(q, q).toVar();
      const r = sqrt(r2).toVar();
      const kind = vCol.w;
      const seed = vInfo.y;
      const shape = float(0.0).toVar();
      If(kind.lessThan(0.5), () => {
        // GLOW — profil gradientu TEX.glow z gry, zgaszony przed brzegiem kwadu
        shape.assign(exp(r2.mul(-7.5)).add(exp(r2.mul(-2.0)).mul(0.07)).mul(float(1.0).sub(smoothstep(0.7, 1.0, r))));
      }).ElseIf(kind.lessThan(1.5), () => {
        // FLARE — rdzeń + 6 promieni (co drugi krótszy)
        const core = pow(clamp(float(1.0).sub(r.div(0.34)), 0.0, 1.0), 2.0).mul(0.95);
        const ang = atan(q.y, q.x).sub(0.3).add(seed.mul(6.2831853));
        const sector = 6.2831853 / 6.0;
        const k = floor(ang.div(sector).add(0.5));
        const da = ang.sub(k.mul(sector));
        const perp = r.mul(abs(sin(da)));
        const even = fract(k.mul(0.5)).lessThan(0.25);
        const lenR = select(even, float(0.98), float(0.6));
        const wR = select(even, float(0.06), float(0.036));
        const t = clamp(float(1.0).sub(r.div(lenR)), 0.0, 1.0);
        const spike = t.mul(exp(sq(perp.div(wR.mul(t).add(0.004))).negate())).mul(0.85);
        shape.assign(core.add(spike).mul(float(1.0).sub(smoothstep(0.9, 1.0, r))));
      }).ElseIf(kind.lessThan(2.5), () => {
        // CROSS — anamorficzny krzyż (TEX.cross)
        const au = abs(q.x);
        const av = abs(q.y);
        const horiz = pow(clamp(float(1.0).sub(av.div(0.14)), 0.0, 1.0), 2.0).mul(pow(clamp(float(1.0).sub(au), 0.0, 1.0), 1.2));
        const vert = pow(clamp(float(1.0).sub(au.div(0.22)), 0.0, 1.0), 2.0).mul(pow(clamp(float(1.0).sub(av.div(0.58)), 0.0, 1.0), 1.6));
        const core = pow(clamp(float(1.0).sub(r.div(0.31)), 0.0, 1.0), 2.2);
        shape.assign(clamp(horiz.mul(0.92).add(vert.mul(0.45)).add(core), 0.0, 1.0));
      }).ElseIf(kind.lessThan(3.5), () => {
        // PLUME — jęzor: jasny u podstawy, szerszy i rozmyty ku końcowi, drganie szumem
        const v = uv().y;
        const along = pow(float(1.0).sub(v), 1.5);
        const width = v.mul(0.8).add(0.2);
        const rr = abs(q.x).div(width);
        const across = pow(clamp(float(1.0).sub(rr.mul(rr)), 0.0, 1.0), 1.6);
        const n = texture(noise, vec2(q.x.mul(0.35).add(seed.mul(7.0)), v.mul(0.6).sub(vInfo.z.mul(3.0)))).r;
        shape.assign(along.mul(across).mul(n.mul(0.7).add(0.55)));
      }).ElseIf(kind.lessThan(4.5), () => {
        // FIRE — kula ognia: gęstość z szumu, temperatura maleje z wiekiem i ku brzegowi
        const sc = vec2(seed.mul(13.1), seed.mul(7.7));
        const flow = vec2(vInfo.z.mul(0.21), vInfo.z.mul(-0.17));
        const n1 = texture(noise, q.mul(0.42).add(sc).add(flow)).r;
        const n2 = texture(noise, q.mul(0.9).add(sc.yx).sub(flow.mul(1.7))).b;
        const n = n1.mul(0.7).add(n2.mul(0.3));
        const mask = smoothstep(1.0, 0.2, r.add(n.sub(0.5).mul(0.55)));
        const dens = clamp(mask.mul(n.mul(1.25).add(0.1)), 0.0, 1.0);
        const heat = float(1.0).sub(vInfo.x).mul(dens);
        // rdzeń bieli tylko w najgorętszych kłębach, reszta w barwie c0 → c1
        // ciało ognia w paśmie barwy (0,3–1), biel tylko w najgorętszych kłębach
        shape.assign(dens.mul(0.34).add(pow(heat, 3.0).mul(0.95)));
      }).Else(() => {
        // VAPOR — miękki, postrzępiony opar (TEX.smoke)
        const sc = vec2(seed.mul(9.3), seed.mul(5.1));
        const n = texture(noise, q.mul(0.38).add(sc).add(vec2(vInfo.z.mul(0.05), 0.0))).r;
        const a = smoothstep(1.02, 0.15, r).mul(n.mul(0.95).add(0.3));
        shape.assign(a.mul(smoothstep(0.08, 0.42, float(1.0).sub(r.mul(0.85)).add(n.sub(0.5).mul(0.55)))));
      });
      return vec4(vCol.rgb.mul(shape), 0.0);
    })();
    return mat;
  }

  _sparkMaterial() {
    const U = this.U;
    const buf = this.pools.spark.buf;
    const vCol = varyingProperty('vec3', 'vSparkCol');
    const vA = varyingProperty('vec2', 'vSparkA');   // wzdłuż (0 ogon → 1 głowa), w poprzek
    const mat = additiveMaterial();
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(5)).toVar();
      const P0 = buf.element(i).toVar();
      const P1 = buf.element(i.add(uint(1))).toVar();
      const out = vec3(0.0, 0.0, -50.0).toVar();
      vCol.assign(vec3(0.0));
      If(P0.w.lessThan(P1.w), () => {
        const P2 = buf.element(i.add(uint(2))).toVar();
        const P3 = buf.element(i.add(uint(3))).toVar();
        const P4 = buf.element(i.add(uint(4))).toVar();
        const u = clamp(P0.w.div(max(P1.w, 1e-4)), 0.0, 1.0).toVar();
        const v2 = P1.xy.toVar();
        const sp = length(v2).toVar();
        const dir = select(sp.greaterThan(1e-3), v2.div(max(sp, 1e-3)), vec2(1.0, 0.0)).toVar();
        const perp = vec2(dir.y.negate(), dir.x);
        // smuga z ruchu (jak w grze: min(v·0.022, smuga) — dłuższa na starcie)
        const len = min(sp.mul(0.022), P3.y).mul(float(0.35).add(float(0.65).mul(float(1.0).sub(u))));
        const pxW = P4.x.div(U.zoom);
        const wid = max(pxW, 0.2);
        const g = positionGeometry.xy;
        const along = g.x.add(0.5);  // 0 ogon, 1 głowa
        const tail = P0.xy.sub(dir.mul(len));
        const center = mix(tail, P0.xy, along).add(dir.mul(g.x.sign().mul(wid.mul(0.5))));
        out.assign(vec3(center.add(perp.mul(g.y.mul(wid).mul(2.0))), P0.z));
        // stygnięcie: proch biało-żółty → pomarańcz → czerwień; jony zostają błękitne
        const flick = sin(U.time.mul(42.0).add(P2.w)).mul(0.28).add(0.72);
        const b = pow(float(1.0).sub(u), 1.5).mul(flick);
        const cool = smoothstep(0.1, 0.85, u);
        const col = vec3(P2.x, P2.y.mul(mix(float(1.0), P3.z, cool)), P2.z.mul(mix(float(1.0), P3.w, cool))).mul(b);
        // cienka smuga subpikselowa: jasność ~ pokrycie
        vCol.assign(col.mul(min(P4.x.div(max(wid.mul(U.zoom), 1e-3)), 1.0)));
      });
      vA.assign(vec2(positionGeometry.x.add(0.5), positionGeometry.y.mul(2.0)));
      return out;
    })();
    mat.fragmentNode = Fn(() => {
      const along = clamp(vA.x, 0.0, 1.0);
      const across = exp(vA.y.mul(vA.y).mul(-3.2));
      const head = pow(along, 1.6);
      return vec4(vCol.mul(head.mul(across)), 0.0);
    })();
    return mat;
  }

  _smokeMaterial() {
    const U = this.U;
    const buf = this.pools.smoke.buf;
    const noise = this.noise;
    const vA = varyingProperty('vec4', 'vSmkA');   // albedo, alfa
    const vL = varyingProperty('vec4', 'vSmkL');   // światło, ziarno
    const vD = varyingProperty('vec4', 'vSmkD');   // kier. światła (xy), wiek, rot
    const vH = varyingProperty('vec3', 'vSmkH');   // żar
    const mat = premulMaterial();
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(8)).toVar();
      const P0 = buf.element(i).toVar();
      const P1 = buf.element(i.add(uint(1))).toVar();
      const out = vec3(0.0, 0.0, -50.0).toVar();
      vA.assign(vec4(0.0));
      vL.assign(vec4(0.0));
      vD.assign(vec4(0.0));
      vH.assign(vec3(0.0));
      If(P0.w.lessThan(P1.w), () => {
        const P2 = buf.element(i.add(uint(2))).toVar();
        const P3 = buf.element(i.add(uint(3))).toVar();
        const P4 = buf.element(i.add(uint(4))).toVar();
        const P5 = buf.element(i.add(uint(5))).toVar();
        const P6 = buf.element(i.add(uint(6))).toVar();
        const P7 = buf.element(i.add(uint(7))).toVar();
        const age = P0.w;
        const u = clamp(age.div(max(P1.w, 1e-4)), 0.0, 1.0).toVar();
        const size = mix(P2.x, P2.y, pow(max(u, 1e-5), P5.y));
        const rot = P2.z.add(P2.w.mul(age)).toVar();
        const cr = cos(rot);
        const sr = sin(rot);
        const g = positionGeometry.xy;
        const corner = vec2(g.x.mul(cr).sub(g.y.mul(sr)), g.x.mul(sr).add(g.y.mul(cr))).mul(size);
        const a = P3.w.mul(smoothstep(0.0, max(P5.z, 1e-3), u)).mul(pow(float(1.0).sub(u), P5.w));
        vA.assign(vec4(P4.xyz, a));
        vL.assign(vec4(P6.xyz, P6.w));
        // kierunek światła w układzie kwadu (obrót odwrotny)
        const lx = P7.x.mul(cr).add(P7.y.mul(sr));
        const ly = P7.x.negate().mul(sr).add(P7.y.mul(cr));
        vD.assign(vec4(lx, ly, age, P7.z));
        vH.assign(P3.xyz.mul(exp(age.negate().mul(P4.w))));
        out.assign(P0.xyz.add(vec3(corner, 0.0)));
      });
      return out;
    })();
    mat.fragmentNode = Fn(() => {
      const q = uv().sub(0.5).mul(2.0).toVar();
      const r = length(q).toVar();
      const seed = vL.w;
      const sc = vec2(seed.mul(11.3), seed.mul(6.9));
      const drift = vec2(vD.z.mul(0.035), vD.z.mul(-0.02));
      const n = texture(noise, q.mul(0.33).add(sc).add(drift)).r.toVar();
      const nd = texture(noise, q.mul(0.8).add(sc.yx).sub(drift.mul(1.6))).b;
      const nn = n.mul(0.75).add(nd.mul(0.25)).toVar();
      // obrys kłębu (TEX.smoke z gry) z postrzępionym brzegiem
      const dens = smoothstep(1.02, 0.15, r).mul(nn.mul(0.95).add(0.3))
        .mul(smoothstep(0.08, 0.42, float(1.0).sub(r.mul(0.85)).add(nn.sub(0.5).mul(0.55)))).toVar();
      const a = clamp(dens.mul(vA.w), 0.0, 1.0).toVar();
      // normalna półkuli kłębu + wybrzuszenia szumu
      const h = sqrt(max(float(1.0).sub(r.mul(r)), 0.0));
      const nrm = normalize(vec3(q.mul(0.85).add(vec2(nn.sub(0.5).mul(0.9))), h.add(0.35)));
      const L = normalize(vec3(vD.xy, max(vD.w, 0.15)));
      const wrap = clamp(dot(nrm, L).add(0.35).div(1.35), 0.0, 1.0);
      const sunW = clamp(dot(nrm, U.sunDir).add(0.3).div(1.3), 0.0, 1.0);
      const lit = vL.rgb.mul(wrap.mul(0.8).add(0.2)).add(U.sunCol.mul(sunW)).add(U.ambient);
      // żar: gęstsze jądro świeci mocniej
      const glow = vH.mul(dens.mul(dens).mul(1.6).add(0.15));
      const col = vA.rgb.mul(lit).add(glow);
      return vec4(col.mul(a), a);
    })();
    return mat;
  }

  _debrisMaterial() {
    const U = this.U;
    const buf = this.pools.debris.buf;
    const vA = varyingProperty('vec4', 'vDebA');   // albedo, rodzaj
    const vL = varyingProperty('vec4', 'vDebL');   // światło, alfa
    const vH = varyingProperty('vec4', 'vDebH');   // żar, ziarno
    const vR = varyingProperty('float', 'vDebR');  // obrót (połysk)
    const mat = premulMaterial();
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(6)).toVar();
      const P0 = buf.element(i).toVar();
      const P1 = buf.element(i.add(uint(1))).toVar();
      const out = vec3(0.0, 0.0, -50.0).toVar();
      vA.assign(vec4(0.0));
      vL.assign(vec4(0.0));
      vH.assign(vec4(0.0));
      vR.assign(0.0);
      If(P0.w.lessThan(P1.w), () => {
        const P2 = buf.element(i.add(uint(2))).toVar();
        const P3 = buf.element(i.add(uint(3))).toVar();
        const P4 = buf.element(i.add(uint(4))).toVar();
        const P5 = buf.element(i.add(uint(5))).toVar();
        const u = clamp(P0.w.div(max(P1.w, 1e-4)), 0.0, 1.0);
        const kind = P4.w;
        // łuska: podłużna; płatek: płaski i długi; odłamek: bryłka
        const aspect = select(kind.lessThan(0.5), float(1.0), select(kind.lessThan(1.5), float(2.6), float(3.4)));
        const rot = P2.y;
        const cr = cos(rot);
        const sr = sin(rot);
        const g = positionGeometry.xy.mul(vec2(aspect, 1.0)).mul(P2.x);
        const corner = vec2(g.x.mul(cr).sub(g.y.mul(sr)), g.x.mul(sr).add(g.y.mul(cr)));
        const a = smoothstep(1.0, 0.8, u);
        vA.assign(vec4(P4.xyz, kind));
        vL.assign(vec4(P5.xyz, a));
        vH.assign(vec4(P3.xyz.mul(exp(P0.w.negate().mul(P3.w))), P2.w));
        vR.assign(rot);
        out.assign(P0.xyz.add(vec3(corner, 2.0)));
      });
      return out;
    })();
    mat.fragmentNode = Fn(() => {
      const q = uv().sub(0.5).mul(2.0).toVar();
      const kind = vA.w;
      const seed = vH.w;
      const inside = float(0.0).toVar();
      const shade = float(1.0).toVar();
      If(kind.lessThan(0.5), () => {
        // bryłka: wielokąt z 7 wierzchołków o losowym promieniu, fasetki
        const ang = atan(q.y, q.x).add(3.14159265);
        const sector = 6.2831853 / 7.0;
        const k = floor(ang.div(sector));
        const f = ang.div(sector).sub(k);
        const ra = hash(uint(seed.mul(9973.0)).add(uint(k)));
        const rb = hash(uint(seed.mul(9973.0)).add(uint(k.add(1.0).mod(7.0))));
        const rad = mix(ra, rb, f).mul(0.45).add(0.5);
        const r = length(q);
        inside.assign(smoothstep(rad, rad.sub(0.08), r));
        shade.assign(mix(ra, float(0.5), 0.4).add(0.5));
      }).Else(() => {
        // łuska / płatek: prostokąt z zaokrągleniem
        const d = max(abs(q.x).sub(0.82), abs(q.y).sub(0.62));
        inside.assign(smoothstep(0.18, 0.0, d));
        shade.assign(float(0.7).add(q.y.mul(0.3)));
      });
      const a = inside.mul(vL.w);
      // połysk: przebłysk przy obrocie ku światłu
      const glint = pow(max(sin(vR.mul(2.0).add(seed.mul(20.0))), 0.0), 24.0).mul(0.8);
      const lit = min(vL.rgb, vec3(2.5)).mul(shade.mul(0.6).add(glint)).add(U.ambient.mul(2.0)).add(U.sunCol.mul(0.35).mul(shade));
      const col = vA.rgb.mul(lit).add(vH.rgb.mul(inside.mul(0.6).add(0.4)));
      return vec4(col.mul(a), a);
    })();
    return mat;
  }

  _distMaterial() {
    const U = this.U;
    const buf = this.pools.dist.buf;
    const noise = this.noise;
    const vD = varyingProperty('vec4', 'vDistD');   // siła, rodzaj, u, ziarno
    const vS = varyingProperty('vec2', 'vDistS');   // rozmiar [px], wiek
    const mat = additiveMaterial();
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(4)).toVar();
      const P0 = buf.element(i).toVar();
      const P1 = buf.element(i.add(uint(1))).toVar();
      const age = U.time.sub(P0.w).toVar();
      const out = vec3(0.0, 0.0, -50.0).toVar();
      vD.assign(vec4(0.0));
      vS.assign(vec2(0.0));
      If(age.greaterThanEqual(0.0).and(age.lessThan(P1.w)), () => {
        const P2 = buf.element(i.add(uint(2))).toVar();
        const P3 = buf.element(i.add(uint(3))).toVar();
        const u = clamp(age.div(max(P1.w, 1e-4)), 0.0, 1.0).toVar();
        const shock = P2.w.greaterThan(0.5);
        // fala: szybki rozbieg (ease-out), drganie: rozrost jak dym
        const grow = select(shock, float(1.0).sub(pow(float(1.0).sub(u), 2.2)), pow(max(u, 1e-5), P3.z));
        const size = mix(P2.x, P2.y, grow);
        const a = P2.z.mul(smoothstep(0.0, max(P3.x, 1e-3), u)).mul(pow(float(1.0).sub(u), P3.y));
        vD.assign(vec4(a, P2.w, u, P3.w));
        vS.assign(vec2(size.mul(U.zoom), age));
        out.assign(P0.xyz.add(P1.xyz.mul(age)).add(vec3(positionGeometry.xy.mul(size), 0.0)));
      });
      return out;
    })();
    mat.fragmentNode = Fn(() => {
      const q = uv().sub(0.5).mul(2.0).toVar();
      const r = length(q).toVar();
      const off = vec2(0.0).toVar();
      If(vD.y.greaterThan(0.5), () => {
        // fala uderzeniowa: cienki pierścień załamania na froncie (sama refrakcja)
        const ringR = float(0.82);
        const w = float(0.1);
        const x = r.sub(ringR).div(w);
        const prof = x.mul(exp(x.mul(x).negate())).mul(-1.0);
        const dir = q.div(max(r, 1e-3));
        off.assign(dir.mul(prof).mul(smoothstep(1.0, 0.9, r)));
      }).Else(() => {
        // gorące powietrze: przesunięcie z szumu, maska miękkiego koła
        const t = vS.y;
        const n1 = texture(noise, q.mul(0.5).add(vec2(vD.w.mul(7.0), t.mul(-0.9)))).rg;
        const mask = smoothstep(1.0, 0.25, r);
        off.assign(n1.sub(0.5).mul(2.0).mul(mask));
      });
      // przesunięcie w pikselach ekranu (siła × rozmiar na ekranie)
      const px = off.mul(vD.x).mul(min(vS.x, 900.0)).mul(0.05);
      return vec4(px, 0.0, 0.0);
    })();
    return mat;
  }

  _arcGeometry() {
    // Pasek: (ARC_SEG + 1) punktów × 2 strony. position = (t, strona, 0).
    const pos = [];
    const idx = [];
    for (let k = 0; k <= ARC_SEG; k++) {
      const t = k / ARC_SEG;
      pos.push(t, -1, 0, t, 1, 0);
      if (k < ARC_SEG) {
        const a = k * 2;
        idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    return geo;
  }

  _arcMaterial() {
    const U = this.U;
    const buf = this.pools.arc.buf;
    const vC = varyingProperty('vec4', 'vArcC');   // barwa, strona
    const mat = additiveMaterial();
    // przesunięcie punktu łamanej k (hash po ziarnie, punkcie i kroku 30 Hz)
    const jig = (seed, k, step, salt) => hash(uint(seed).mul(uint(7919)).add(uint(k).mul(uint(131))).add(uint(step).mul(uint(3571))).add(uint(salt))).sub(0.5).mul(2.0);
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(4)).toVar();
      const P0 = buf.element(i).toVar();
      const P1 = buf.element(i.add(uint(1))).toVar();
      const age = U.time.sub(P0.w).toVar();
      const out = vec3(0.0, 0.0, -50.0).toVar();
      vC.assign(vec4(0.0));
      If(age.greaterThanEqual(0.0).and(age.lessThan(P1.w)), () => {
        const P2 = buf.element(i.add(uint(2))).toVar();
        const P3 = buf.element(i.add(uint(3))).toVar();
        const u = clamp(age.div(max(P1.w, 1e-4)), 0.0, 1.0);
        const t = positionGeometry.x.toVar();
        const side = positionGeometry.y;
        const step = floor(U.time.mul(30.0)).toVar();
        const seed = P3.y;
        const a = P0.xy;
        const b = P1.xy;
        const ab = b.sub(a).toVar();
        const len = max(length(ab), 1e-3);
        const dir = ab.div(len).toVar();
        const perp = vec2(dir.y.negate(), dir.x).toVar();
        const kf = t.mul(ARC_SEG).toVar();
        const env = sin(t.mul(3.14159265));
        // dwie skale drgań: duże zakręty + drobne ząbki
        const big = jig(seed, kf.div(3.0).floor(), step, 11).mul(0.6);
        const small = jig(seed, kf, step, 29).mul(0.4);
        const offs = big.add(small).mul(P2.w).mul(env);
        const pt = a.add(ab.mul(t)).add(perp.mul(offs));
        const wid = P3.x.div(U.zoom).mul(env.mul(0.6).add(0.4));
        const bright = pow(float(1.0).sub(u), 1.1).mul(hash(uint(seed).add(uint(step).mul(uint(977)))).mul(0.45).add(0.55));
        vC.assign(vec4(P2.xyz.mul(bright), side));
        out.assign(vec3(pt.add(perp.mul(side.mul(wid))), P0.z));
      });
      return out;
    })();
    mat.fragmentNode = Fn(() => {
      const s = vC.w;
      const prof = exp(s.mul(s).mul(-3.0));
      return vec4(vC.rgb.mul(prof), 0.0);
    })();
    return mat;
  }

  // -------------------------------------------------------------------------
  // Klatka

  /**
   * dt — krok czasu efektów (z mnożnikiem zwolnienia), zoom kamery.
   * Kolejność: aktualizacja stanu → narodziny paczek z tej klatki → światło.
   */
  update(dt, zoom) {
    const r = this.renderer;
    const U = this.U;
    this.time += dt;
    U.time.value = this.time;
    U.dt.value = dt;
    U.zoom.value = zoom;
    if (dt > 0) {
      r.compute(this.updateSpark, CAPS.spark);
      r.compute(this.updateSmoke, CAPS.smoke);
      r.compute(this.updateDebris, CAPS.debris);
    }
    let spawned = 0;
    for (const key of Object.keys(this.pools)) {
      const pool = this.pools[key];
      if (!pool.burstCount) continue;
      const used = pool.burstCount * BSTRIDE;
      const attr = pool.burstNode.value;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, used * 4);
      attr.needsUpdate = true;
      U.burstCount.value = pool.burstCount;
      U.spawnTotal.value = pool.total;
      U.seedBase.value = (this.frameSeed = (this.frameSeed + 0x9E3779B1) >>> 0);
      r.compute(this._spawnNodes[key], pool.total);
      spawned += pool.total;
      pool.burstCount = 0;
      pool.total = 0;
    }
    this.stats.spawned = spawned;
  }

  /** Światło dymu i odłamków — po zbudowaniu siatki świateł tej klatki. */
  light() {
    this.renderer.compute(this.lightSmoke, CAPS.smoke);
    this.renderer.compute(this.lightDebris, CAPS.debris);
  }

  /** Szacunek żywych cząstek (od głów pierścieni i łącznej liczby narodzin). */
  get counts() {
    const out = {};
    for (const [k, p] of Object.entries(this.pools)) out[k] = p.spawnedTotal;
    return out;
  }
}
