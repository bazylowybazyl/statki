// src/3d/weapons/gpuFx.js
//
// Silnik cząstek efektów broni na GPU (WebGPU, TSL, compute) — port `dema/bronie-webgpu/gpuFx.js`
// do gry (zadanie 17, PROJEKT-BRONI §1.1, FX-INFRA §9).
//
// CPU nie rodzi cząstek pojedynczo: receptura (recipes.js) wysyła PACZKI — jeden rekord = N
// cząstek jednego rodzaju z zakresami (stożek, prędkość, życie, rozmiar, barwy, zanik…).
// Kernel `spawn` rozwija paczki w cząstki (wyszukiwanie binarne paczki po indeksie wątku,
// losowanie hashem), pule to pierścienie (głowa na CPU, najstarsze nadpisywane).
//
// Pule (jeden draw call każda):
//   ADD   — addytywne kwady: rdzeń rozbłysku (GLOW), gwiazda (FLARE), krzyż anamorficzny
//           (CROSS), jęzor (PLUME), kula ognia (FIRE), opar (VAPOR); ruch analityczny.
//   SPARK — iskry: smugi o stałej szerokości w px, stygnięcie barwy (kernel update).
//   SMOKE — dym premultiplied: turbulencja z szumu, światło z siatki świateł + słońce, żar.
//   DEBRIS— odłamki, łuski, płatki sabotu (kernel update, światło z siatki).
//   DIST  — zniekształcenie (warstwa DIST 10 → Core3D.distortionTarget): drganie i fale
//           uderzeniowe jako sama refrakcja.
//   ARC   — łuki elektryczne (pasek z ARC_SEG odcinków między A i B).
//
// Zmiany względem dema (zasady gry):
//   • POCZĄTEK PRZY KAMERZE (FxPoolOrigin, FX-INFRA §6): pozycje w buforach są lokalne
//     (scena − początek), siatki pul stoją na `mesh.position = początek`; czasy narodzin
//     (ADD, DIST, ARC) względem epoki zegara efektów, t0 nośnika względem epoki SimClock —
//     przeskoki przesuwa kernel `createShiftKernel` (każda pula zarejestrowana w origin).
//   • NOŚNIK (agents.md § Nośnik prędkości, FX-INFRA §5): paczka ma 13. vec4 = nośnik z
//     ActiveCarrier (vx, vy sceny, t0 − epoka, zegar), kopiowany do stanu cząstki; rysunek
//     dokłada v_c · (T_zegar − t0). Opór i turbulencja działają tylko na ruch WŁASNY — dym z
//     lufy pędzącego okrętu zachowuje się jak przy postoju (demo tłumiło całe v).
//   • Bez kolizji iskier i odłamków z kadłubami (demo: 2 sloty pola odległości kadłubów
//     dema). Wariant prosty z zadania 17 — do rozważenia w 18 (K najbliższych kadłubów z
//     pól HullShadowSdf).
//   • Liczby wątków i instancji = zajęta część pierścienia (głowa wraca na 0, gdy pula całkiem
//     wygaśnie) — pusta pula nie rysuje i nie liczy nic (demo rysowało zawsze całą pojemność).
//   • Zero alokacji na paczkę i na klatkę; mieszanie addytywne z alfą = max(rgb) (konwencja
//     gry), materiały dwustronne w jednym przejściu.

import * as THREE from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, uniform, instancedArray, attributeArray,
  instanceIndex, If, Loop, Return, select, mix, clamp, smoothstep, exp, pow, sin, cos, sqrt,
  max, min, abs, length, normalize, dot, cross, hash, positionGeometry, uv, varyingProperty,
  texture, atan, floor, fract
} from 'three/tsl';
import { fxCarrierOffset, writeCarrierPacket } from '../fx/carrier.js';
import { createShiftKernel } from '../fx/gpuPoolOrigin.js';
import { sunVisibility, sunFill } from '../sunShadowMask.js';
import { liveRangeAttribute, markRange } from './liveRange.js';
import { oddajKopieCpu } from '../tsl/kopiaCpu.js';

const sq = (x) => x.mul(x);

// ---------------------------------------------------------------------------
// Rodzaje (jak w demie)

export const K = Object.freeze({
  // ADD
  GLOW: 0, FLARE: 1, CROSS: 2, PLUME: 3, FIRE: 4, VAPOR: 5,
  // SPARK (pole rodzaju)
  SPARK: 0, SPARK_ION: 1,
  // DEBRIS
  CHUNK: 0, CASING: 1, PETAL: 2,
  // DIST
  HEAT: 0, SHOCK: 1
});

/** vec4 na paczkę: 12 z dema + nośnik. */
export const BSTRIDE = 13;
/** Indeks pierwszej liczby nośnika w paczce (floaty). */
export const BURST_CARRIER = 48;
/** Paczek na pulę na klatkę. */
export const BURST_CAP = 2048;
const BSEARCH_STEPS = 12;    // log2(BURST_CAP) + 1

/**
 * Pojemności pul (potęgi dwójki). Mniejsze niż w demie (iskry 2¹⁸, blask 2¹⁷, dym 2¹⁵,
 * odłamki 2¹⁴): w grze receptury idą tylko dla zdarzeń w kadrze, a bitwa (setki
 * strzałów/s) mieści się w tych liczbach z zapasem — pomiar w raporcie zadania 17.
 */
export const CAPS = Object.freeze({
  add: 1 << 16,
  spark: 1 << 16,
  smoke: 1 << 14,
  debris: 1 << 13,
  dist: 1 << 12,
  arc: 1 << 12
});

/** vec4 na cząstkę (demo + 1 na nośnik). */
export const STRIDE = Object.freeze({ add: 8, spark: 6, smoke: 9, debris: 7, dist: 5, arc: 5 });
/** Indeks vec4 nośnika w stanie cząstki. */
export const CARRIER_AT = Object.freeze({ add: 7, spark: 5, smoke: 8, debris: 6, dist: 4, arc: 4 });

/** Kolejność renderu pul (demo) — pociski 55, wiązki 52, smugi 50. */
export const POOL_ORDER = Object.freeze({ smoke: 40, debris: 42, add: 60, spark: 62, arc: 64, dist: 1 });

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

/** Wyjście addytywne w konwencji gry: alfa = max(rgb) (mieszanie ONE, ONE dla koloru i alfy). */
function addOut(rgb) {
  const c = max(rgb, vec3(0.0)).toVar();
  return vec4(c, max(c.x, max(c.y, c.z)));
}

export function additiveMaterial(name) {
  const mat = new THREE.NodeMaterial();
  mat.name = name;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.depthTest = false;
  mat.lights = false;
  mat.fog = false;
  mat.side = THREE.DoubleSide;
  mat.forceSinglePass = true;
  mat.premultipliedAlpha = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  return mat;
}

function premulMaterial(name) {
  const mat = new THREE.NodeMaterial();
  mat.name = name;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.depthTest = false;
  mat.lights = false;
  mat.fog = false;
  mat.side = THREE.DoubleSide;
  mat.forceSinglePass = true;
  mat.premultipliedAlpha = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return mat;
}

// ---------------------------------------------------------------------------
// Pula: bufor cząstek + kolejka paczek + budowniczy paczki (CPU, bez alokacji)

export class Pool {
  constructor(fx, name, cap, stride, carrierAt) {
    this.fx = fx;
    this.name = name;
    this.cap = cap;
    this.stride = stride;
    this.carrierAt = carrierAt;
    this.buf = instancedArray(cap * stride, 'vec4').setName(`wfx_${name}`);
    this.burstNode = attributeArray(BURST_CAP * BSTRIDE, 'vec4').setName(`wfx_${name}_bursts`);
    this.bursts = this.burstNode.value.array;
    liveRangeAttribute(this.burstNode.value);
    this.burstCount = 0;
    this.total = 0;
    this.head = 0;
    this.wrapped = false;
    this.spawnedTotal = 0;
    this.dropped = 0;
    // Zegar efektów, do którego pula żyje (najpóźniejsza śmierć zrodzonych cząstek).
    this.liveUntil = -1;
    this._b = new Float32Array(BSTRIDE * 4);
    this._w = new Float64Array(2);   // punkt paczki w scenie (double) do odjęcia początku w emit
    this._count = 0;
    this._maxLife = 0;
    this._open = false;
  }

  // --- budowniczy ------------------------------------------------------------
  // pool.begin(kind, n).at(x, y).dir(dx, dy).speed(a, b)….emit(); pozycje i kierunki w
  // układzie SCENY (x, −y świata gry). Metody mają najwyżej dwa zapisy i BEZ parametrów
  // domyślnych — bajtkod < 27 B, więc V8 wkleja je zawsze, niezależnie od budżetu
  // wklejania dużej receptury; wywołanie niewklejone pakowałoby liczby double z argumentów
  // (alokacja na paczkę). Punkt trafia do Float64Array (double), a początek pul odejmuje
  // i kierunek normuje dopiero `emit()` (bez argumentów).

  begin(kind, count) {
    const b = this._b;
    b.fill(0);
    this._count = count > 0 ? Math.floor(count) : 0;
    b[3] = kind;
    // domyślne (jak `E()` dema: stożek 0 spłaszczony do 0,18, z = 15)
    b[6] = 15;
    b[8] = 1;                                    // dir x
    b[14] = 1; b[15] = 1;                        // życie
    b[16] = 1; b[17] = 1; b[18] = 1; b[19] = 1;  // rozmiary
    b[20] = 1; b[21] = 1; b[22] = 1; b[23] = 1;  // c0, alfa min
    b[24] = 1; b[25] = 1; b[26] = 1; b[27] = 1;  // c1, alfa max
    b[29] = 0.6; b[30] = 0.06; b[31] = 1.5;      // grow, fadeIn, fadeOut
    b[32] = 4; b[33] = 0.18;                     // mix, flat
    b[39] = 0.3;                                 // sprężystość iskier
    const w = this._w;
    w[0] = this.fx.origin.x; w[1] = this.fx.origin.y;
    this._open = true;
    return this;
  }
  /** Punkt w układzie SCENY (double; lokalny = − początek w emit). */
  at(x, y) { const w = this._w; w[0] = x; w[1] = y; return this; }
  z(z) { this._b[6] = z; return this; }
  preAge(t) { this._b[7] = t; return this; }
  /** Kierunek w scenie (normowany w emit). */
  dir(x, y) { const b = this._b; b[8] = x; b[9] = y; return this; }
  cone(spread, flat) { const b = this._b; b[11] = spread; b[33] = flat; return this; }
  speed(a, c) { const b = this._b; b[12] = a; b[13] = c; return this; }
  life(a, c) { const b = this._b; b[14] = a; b[15] = c; return this; }
  /** Rozmiar na starcie (a–b) — kwady zorientowane (CROSS, PLUME): długość l0→l1. */
  s0(a, c) { const b = this._b; b[16] = a; b[17] = c; return this; }
  /** Rozmiar na końcu (a–b) — kwady zorientowane: szerokość w0→w1. */
  s1(a, c) { const b = this._b; b[18] = a; b[19] = c; return this; }
  color(r, g, bl) { const b = this._b; b[20] = r; b[21] = g; b[22] = bl; b[24] = r; b[25] = g; b[26] = bl; return this; }
  color1(r, g, bl) { const b = this._b; b[24] = r; b[25] = g; b[26] = bl; return this; }
  /** Barwy z tablic (stałe palet — bez liczb w argumentach). */
  colors(c0, c1) { this.color(c0[0], c0[1], c0[2]); if (c1) this.color1(c1[0], c1[1], c1[2]); return this; }
  alpha(a, c) { const b = this._b; b[23] = a; b[27] = c; return this; }
  drag(a, c) { const b = this._b; b[28] = a; b[43] = c; return this; }
  bounce(r) { this._b[39] = r; return this; }
  grow(g) { this._b[29] = g; return this; }
  fade(fadeIn, fadeOut) { const b = this._b; b[30] = fadeIn; b[31] = fadeOut; return this; }
  mix(m) { this._b[32] = m; return this; }
  offset(a, c) { const b = this._b; b[34] = a; b[35] = c; return this; }
  jitter(r, z) { const b = this._b; b[36] = r; b[37] = z; return this; }
  spin(s) { this._b[38] = s; return this; }
  /** Prędkość bazowa (scena) dodana do prędkości własnej (np. czubek lecący z pociskiem). */
  vel(x, y) { const b = this._b; b[40] = x; b[41] = y; return this; }
  /** Pola dodatkowe rodzaju (extra dema): 0–1 i 2–3. */
  x01(a, c) { const b = this._b; b[44] = a; b[45] = c; return this; }
  x23(a, c) { const b = this._b; b[46] = a; b[47] = c; return this; }

  emit() {
    if (!this._open) return this;
    this._open = false;
    let n = this._count;
    if (n <= 0) return this;
    // Ponad pojemność w jednej klatce pula nadpisałaby własne paczki — reszta przepada.
    n = Math.min(n, this.cap >> 2);
    if (this.burstCount >= BURST_CAP || this.total + n > this.cap) { this.dropped += n; return this; }
    const b = this._b;
    // punkt lokalnie (double → float32 po odjęciu początku), kierunek jednostkowy
    const o = this.fx.origin;
    b[4] = this._w[0] - o.x;
    b[5] = this._w[1] - o.y;
    const dx = b[8]; const dy = b[9]; const dz = b[10];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l > 1e-12) { b[8] = dx / l; b[9] = dy / l; b[10] = dz / l; } else { b[8] = 1; b[9] = 0; b[10] = 0; }
    b[0] = this.total;
    b[1] = n;
    b[2] = this.head;
    // Nośnik z ActiveCarrier (fasada ustawia go przed recepturą), t0 względem epoki gry.
    writeCarrierPacket(b, BURST_CARRIER, this.fx.origin.simEpoch);
    this.bursts.set(b, this.burstCount * BSTRIDE * 4);
    this.burstCount++;
    this.total += n;
    const head = this.head + n;
    if (head >= this.cap) this.wrapped = true;
    this.head = head & (this.cap - 1);
    this.spawnedTotal += n;
    // Pula żyje do śmierci najstarszej z najdłuższym życiem (+ zapas na klatkę).
    const until = this.fx.time + b[15] + 0.25;
    if (until > this.liveUntil) this.liveUntil = until;
    return this;
  }

  /** Zajęta część pierścienia (wątki kerneli i instancje rysunku); ≥ 2 przy żywej puli. */
  get used() {
    return this.wrapped ? this.cap : Math.max(2, this.head);
  }

  /** Żywa pula: cząstki zrodzone w oknie życia albo paczki czekające na spawn. */
  isLive() {
    return this.burstCount > 0 || this.fx.time <= this.liveUntil;
  }

  /** Pula wygasła całkiem — głowa wraca na 0 (tanie rysowanie następnej serii). */
  _recycleIfDead() {
    if (this.burstCount > 0 || this.fx.time <= this.liveUntil) return;
    this.head = 0;
    this.wrapped = false;
  }
}

// ---------------------------------------------------------------------------
// Silnik

export class GpuFx {
  /**
   * @param {object} o
   * @param {import('../fx/gpuPoolOrigin.js').FxPoolOrigin} o.origin  wspólny początek pul (Core3D.fx.origin)
   * @param {THREE.Texture} o.noise   szum tile2D (fxNoise.tile2D())
   * @param {import('../fx/lightGrid.js').LightGrid} o.grid  siatka świateł (Core3D.fx.grid)
   * @param {number} [o.distLayer] warstwa zniekształceń (FX_DISTORT_LAYER)
   */
  constructor({ origin, noise, grid, distLayer = 10 }) {
    this.origin = origin;
    this.noise = noise;
    this.grid = grid;
    this.distLayer = distLayer;
    this.time = 0;          // zegar efektów [s] (Core3D.fx.time)
    this.frameSeed = 1;
    this.U = {
      dt: uniform(0).setName('wfxDt'),
      zoom: uniform(1).setName('wfxZoom'),
      spawnTime: uniform(0).setName('wfxSpawnTime'),
      ambient: uniform(new THREE.Vector3(0.05, 0.055, 0.07)).setName('wfxAmbient'),
      sunDir: uniform(new THREE.Vector3(0.3, 0.5, 0.8).normalize()).setName('wfxSunDir'),
      sunCol: uniform(new THREE.Vector3(0.6, 0.58, 0.55)).setName('wfxSunCol'),
      smokeLight: uniform(1).setName('wfxSmokeLight')
    };
    this.pools = {
      add: new Pool(this, 'add', CAPS.add, STRIDE.add, CARRIER_AT.add),
      spark: new Pool(this, 'spark', CAPS.spark, STRIDE.spark, CARRIER_AT.spark),
      smoke: new Pool(this, 'smoke', CAPS.smoke, STRIDE.smoke, CARRIER_AT.smoke),
      debris: new Pool(this, 'debris', CAPS.debris, STRIDE.debris, CARRIER_AT.debris),
      dist: new Pool(this, 'dist', CAPS.dist, STRIDE.dist, CARRIER_AT.dist),
      arc: new Pool(this, 'arc', CAPS.arc, STRIDE.arc, CARRIER_AT.arc)
    };
    this.poolList = [this.pools.add, this.pools.spark, this.pools.smoke, this.pools.debris, this.pools.dist, this.pools.arc];
    // Uniformy spawnu PER PULA (zadanie 23): kernele spawnu wszystkich pul idą jedną listą w jednym passie
    // compute — wartości (liczba paczek, wątków, ziarno) muszą być osobne dla każdego kernela listy.
    for (const pool of this.poolList) {
      pool.uSpawn = {
        seedBase: uniform(0, 'uint').setName('wfxSeed'),
        spawnTotal: uniform(0, 'uint').setName('wfxSpawnTotal'),
        burstCount: uniform(0, 'uint').setName('wfxBurstCount')
      };
    }
    this.add = this.pools.add;
    this.spark = this.pools.spark;
    this.smoke = this.pools.smoke;
    this.debris = this.pools.debris;
    this.dist = this.pools.dist;
    this.arc = this.pools.arc;
    this.meshes = [];
    this.meshByPool = null;
    this.stats = { spawned: 0, dispatches: 0, dropped: 0 };
    this._built = false;
    this._registered = false;
  }

  /** Buduje kernele i siatki pul (raz). scene — Core3D.scene. */
  build(scene) {
    if (this._built) return this;
    this._built = true;
    this._buildSpawn();
    this._buildUpdate();
    this._buildRender(scene);
    this._buildShift();
    return this;
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
    const hi = pool.uSpawn.burstCount.toVar();
    Loop({ start: 0, end: BSEARCH_STEPS, type: 'int', condition: '<', name: 'wfxSearch' }, () => {
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
    const seed = t.add(pool.uSpawn.seedBase).toVar();
    const R = (k) => hash(seed.mul(uint(23)).add(uint(k)));
    const b1 = B(1).toVar(); const b2 = B(2).toVar(); const b3 = B(3).toVar();
    const b4 = B(4).toVar(); const b5 = B(5).toVar(); const b6 = B(6).toVar();
    const b7 = B(7).toVar(); const b8 = B(8).toVar(); const b9 = B(9).toVar();
    const b10 = B(10).toVar(); const b11 = B(11).toVar(); const carrier = B(12).toVar();
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
      drag, anim, carrier,
      slot, R, kind, life, speed, d, p, v, pre, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11,
      s0: mix(b4.x, b4.y, R(10)), s1: mix(b4.z, b4.w, R(11)),
      alpha: mix(b5.w, b6.w, R(12)), c0: b5.xyz, c1: b6.xyz
    };
  }

  _buildSpawn() {
    const U = this.U;
    const P = this.pools;
    const guard = (pool) => { If(instanceIndex.greaterThanEqual(pool.uSpawn.spawnTotal), () => { Return(); }); };
    const wr = (pool, c, k, value) => pool.buf.element(c.slot.mul(uint(pool.stride)).add(uint(k))).assign(value);
    const wc = (pool, c) => wr(pool, c, pool.carrierAt, c.carrier);

    // ADD: p0 pos+narodziny, p1 v+życie, p2 s0 s1 rot0 spin (orient: l0 l1 w0 w1),
    // p3 c0+alfa, p4 c1+mix, p5 opór grow fadeIn fadeOut, p6 rodzaj dir.xy ziarno, p7 nośnik.
    this.spawnAdd = Fn(() => {
      guard(P.add);
      const c = this._spawnCommon(P.add);
      const isOri = c.kind.equal(float(K.CROSS)).or(c.kind.equal(float(K.PLUME)));
      const sizes = select(isOri, c.b4, vec4(c.s0, c.s1, c.R(13).mul(6.2831853), c.R(14).sub(0.5).mul(2.0).mul(c.b9.z)));
      wr(P.add, c, 0, vec4(c.p, U.spawnTime.sub(c.pre)));
      wr(P.add, c, 1, vec4(c.v, c.life));
      wr(P.add, c, 2, sizes);
      wr(P.add, c, 3, vec4(c.c0, c.alpha));
      wr(P.add, c, 4, vec4(c.c1, c.b8.x));
      wr(P.add, c, 5, c.anim);
      wr(P.add, c, 6, vec4(c.kind, c.b2.x, c.b2.y, c.R(15)));
      wc(P.add, c);
    })().compute(CAPS.add).setName('wfxSpawnAdd');

    // SPARK: p0 pos+wiek, p1 v+życie, p2 barwa+faza, p3 opór smuga coolG coolB,
    // p4 szerokość[px] sprężystość ziarno rodzaj, p5 nośnik. extra = (smuga, coolG, coolB, px).
    this.spawnSpark = Fn(() => {
      guard(P.spark);
      const c = this._spawnCommon(P.spark);
      const px = select(c.b11.w.greaterThan(0.0), c.b11.w, float(1.6));
      const bright = mix(float(0.75), float(1.25), c.R(16));
      wr(P.spark, c, 0, vec4(c.p.add(c.v.mul(c.pre)), c.pre));
      wr(P.spark, c, 1, vec4(c.v, c.life));
      wr(P.spark, c, 2, vec4(c.c0.mul(bright).mul(c.alpha), c.R(17).mul(6.28)));
      wr(P.spark, c, 3, vec4(c.drag, select(c.b11.x.greaterThan(0.0), c.b11.x, float(60.0)), c.b11.y, c.b11.z));
      wr(P.spark, c, 4, vec4(px.mul(mix(float(0.8), float(1.2), c.R(18))), c.b9.w, c.R(19), c.kind));
      wc(P.spark, c);
    })().compute(CAPS.spark).setName('wfxSpawnSpark');

    // SMOKE: p0 pos+wiek, p1 v+życie, p2 s0 s1 rot0 spin, p3 żar+alfa, p4 albedo+tempo
    // stygnięcia, p5 opór grow fadeIn fadeOut, p6 światło+ziarno, p7 kier. światła+turb.,
    // p8 nośnik. extra = (turbulencja, stygnięcie żaru [1/s]).
    this.spawnSmoke = Fn(() => {
      guard(P.smoke);
      const c = this._spawnCommon(P.smoke);
      wr(P.smoke, c, 0, vec4(c.p.add(c.v.mul(c.pre)), c.pre));
      wr(P.smoke, c, 1, vec4(c.v, c.life));
      wr(P.smoke, c, 2, vec4(c.s0, c.s1, c.R(13).mul(6.2831853), c.R(14).sub(0.5).mul(2.0).mul(c.b9.z)));
      wr(P.smoke, c, 3, vec4(c.c0, c.alpha));
      wr(P.smoke, c, 4, vec4(c.c1, select(c.b11.y.greaterThan(0.0), c.b11.y, float(4.0))));
      wr(P.smoke, c, 5, c.anim);
      wr(P.smoke, c, 6, vec4(0.0, 0.0, 0.0, c.R(15)));
      wr(P.smoke, c, 7, vec4(0.0, 0.0, 1.0, c.b11.x));
      wc(P.smoke, c);
    })().compute(CAPS.smoke).setName('wfxSpawnSmoke');

    // DEBRIS: p0 pos+wiek, p1 v+życie, p2 rozmiar rot spin ziarno, p3 żar+stygnięcie,
    // p4 albedo+rodzaj, p5 światło+opór, p6 nośnik. extra = (stygnięcie, sprężystość).
    this.spawnDebris = Fn(() => {
      guard(P.debris);
      const c = this._spawnCommon(P.debris);
      wr(P.debris, c, 0, vec4(c.p.add(c.v.mul(c.pre)), c.pre));
      wr(P.debris, c, 1, vec4(c.v, c.life));
      wr(P.debris, c, 2, vec4(c.s0, c.R(13).mul(6.2831853), c.R(14).sub(0.5).mul(2.0).mul(c.b9.z), c.R(15)));
      wr(P.debris, c, 3, vec4(c.c0.mul(c.alpha), select(c.b11.x.greaterThan(0.0), c.b11.x, float(1.5))));
      wr(P.debris, c, 4, vec4(c.c1, c.kind));
      wr(P.debris, c, 5, vec4(0.0, 0.0, 0.0, c.drag));
      wc(P.debris, c);
    })().compute(CAPS.debris).setName('wfxSpawnDebris');

    // DIST: p0 pos+narodziny, p1 v+życie, p2 s0 s1 siła rodzaj, p3 fadeIn fadeOut grow ziarno, p4 nośnik.
    this.spawnDist = Fn(() => {
      guard(P.dist);
      const c = this._spawnCommon(P.dist);
      wr(P.dist, c, 0, vec4(c.p, U.spawnTime.sub(c.pre)));
      wr(P.dist, c, 1, vec4(c.v, c.life));
      wr(P.dist, c, 2, vec4(c.s0, c.s1, c.alpha, c.kind));
      wr(P.dist, c, 3, vec4(c.b7.z, c.b7.w, c.b7.y, c.R(15)));
      wc(P.dist, c);
    })().compute(CAPS.dist).setName('wfxSpawnDist');

    // ARC: p0 A+narodziny, p1 B+życie, p2 barwa+amplituda, p3 szer.[px] ziarno, p4 nośnik.
    // B = A + kierunek·dystans (prędkość = dystans). extra = (amplituda, px).
    this.spawnArc = Fn(() => {
      guard(P.arc);
      const c = this._spawnCommon(P.arc);
      const bpt = c.p.add(c.d.mul(c.speed));
      wr(P.arc, c, 0, vec4(c.p, U.spawnTime.sub(c.pre)));
      wr(P.arc, c, 1, vec4(bpt, c.life));
      wr(P.arc, c, 2, vec4(c.c0.mul(c.alpha), c.b11.x));
      wr(P.arc, c, 3, vec4(select(c.b11.y.greaterThan(0.0), c.b11.y, float(1.5)), c.R(16).mul(4096.0).floor(), 0.0, 0.0));
      wc(P.arc, c);
    })().compute(CAPS.arc).setName('wfxSpawnArc');

    this._spawnNodes = [this.spawnAdd, this.spawnSpark, this.spawnSmoke, this.spawnDebris, this.spawnDist, this.spawnArc];
  }

  // -------------------------------------------------------------------------
  // UPDATE — iskry, dym, odłamki (ruch WŁASNY), światło dymu i odłamków

  _buildUpdate() {
    const U = this.U;
    const P = this.pools;
    const noise = this.noise;
    const origin = this.origin;
    const liveGuard = (pool) => { If(instanceIndex.greaterThanEqual(uint(pool.cap)), () => { Return(); }); };

    this.updateSpark = Fn(() => {
      liveGuard(P.spark);
      const i = instanceIndex.mul(uint(P.spark.stride)).toVar();
      const P0 = P.spark.buf.element(i).toVar();
      const P1 = P.spark.buf.element(i.add(uint(1))).toVar();
      If(P0.w.greaterThanEqual(P1.w), () => { Return(); });
      const P3 = P.spark.buf.element(i.add(uint(3)));
      const p = P0.xyz.toVar();
      const v = P1.xyz.toVar();
      v.mulAssign(exp(P3.x.negate().mul(U.dt)));
      p.addAssign(v.mul(U.dt));
      P.spark.buf.element(i).assign(vec4(p, P0.w.add(U.dt)));
      P.spark.buf.element(i.add(uint(1))).assign(vec4(v, P1.w));
    })().compute(CAPS.spark).setName('wfxUpdateSpark');

    this.updateSmoke = Fn(() => {
      liveGuard(P.smoke);
      const i = instanceIndex.mul(uint(P.smoke.stride)).toVar();
      const P0 = P.smoke.buf.element(i).toVar();
      const P1 = P.smoke.buf.element(i.add(uint(1))).toVar();
      If(P0.w.greaterThanEqual(P1.w), () => { Return(); });
      const P5 = P.smoke.buf.element(i.add(uint(5)));
      const P7 = P.smoke.buf.element(i.add(uint(7)));
      const p = P0.xyz.toVar();
      const v = P1.xyz.toVar();
      v.mulAssign(exp(P5.x.negate().mul(U.dt)));
      // Turbulencja: rotacja pola szumu (bez źródeł), skala ~900 j. Faza z pozycji lokalnej
      // (przeskok początku przesuwa wzór — raz na 20 tys. j. lotu, niewidoczne).
      const q = p.xy.mul(1.0 / 900.0).add(vec2(origin.timeFx.mul(0.013), origin.timeFx.mul(-0.009)));
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
    })().compute(CAPS.smoke).setName('wfxUpdateSmoke');

    this.updateDebris = Fn(() => {
      liveGuard(P.debris);
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
      P.debris.buf.element(i).assign(vec4(p, P0.w.add(U.dt)));
      P.debris.buf.element(i.add(uint(1))).assign(vec4(v, P1.w));
      P.debris.buf.element(i.add(uint(2))).assign(vec4(P2.x, P2.y.add(P2.z.mul(U.dt)), P2.z, P2.w));
    })().compute(CAPS.debris).setName('wfxUpdateDebris');

    // Światło dymu: suma świateł siatki w punkcie cząstki (z nośnikiem — punkt, w którym
    // cząstka się rysuje) i kierunek ważony mocą (cieniowanie kłębu w shaderze).
    const grid = this.grid;
    const carried = (P0, C) => P0.xyz.add(vec3(fxCarrierOffset(C, origin.timeSim, origin.timeRender), 0.0));
    this.lightSmoke = Fn(() => {
      liveGuard(P.smoke);
      const i = instanceIndex.mul(uint(P.smoke.stride)).toVar();
      const P0 = P.smoke.buf.element(i).toVar();
      const P1 = P.smoke.buf.element(i.add(uint(1)));
      If(P0.w.greaterThanEqual(P1.w), () => { Return(); });
      const C = P.smoke.buf.element(i.add(uint(P.smoke.carrierAt))).toVar();
      const acc = vec3(0).toVar();
      const dirAcc = vec3(0).toVar();
      If(U.smokeLight.greaterThan(0.5), () => {
        grid.loop(carried(P0, C).toVar(), ({ toL, att, col }) => {
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
    })().compute(CAPS.smoke).setName('wfxLightSmoke');

    this.lightDebris = Fn(() => {
      liveGuard(P.debris);
      const i = instanceIndex.mul(uint(P.debris.stride)).toVar();
      const P0 = P.debris.buf.element(i).toVar();
      const P1 = P.debris.buf.element(i.add(uint(1)));
      If(P0.w.greaterThanEqual(P1.w), () => { Return(); });
      const C = P.debris.buf.element(i.add(uint(P.debris.carrierAt))).toVar();
      const acc = vec3(0).toVar();
      grid.loop(carried(P0, C).toVar(), ({ att, col }) => { acc.addAssign(col.mul(att)); });
      const P5 = P.debris.buf.element(i.add(uint(5)));
      P.debris.buf.element(i.add(uint(5))).assign(vec4(min(acc, vec3(40.0)), P5.w));
    })().compute(CAPS.debris).setName('wfxLightDebris');
  }

  // -------------------------------------------------------------------------
  // Przesunięcie żywych danych po przeskoku początku / epok (FxPoolOrigin)

  _buildShift() {
    const o = this.origin;
    const P = this.pools;
    const reg = (pool, opts) => {
      const shiftNode = createShiftKernel(o, { buffer: pool.buf, capacity: pool.cap, stride: pool.stride, name: `wfxShift_${pool.name}`, ...opts });
      pool.shiftNode = shiftNode;
      pool.originEntry = o.register({ shiftNode, isLive: () => pool.isLive() });
    };
    reg(P.add, { pos: [[0, 'xy']], fxTime: [[0, 'w']], simTime: [[CARRIER_AT.add, 'z']] });
    reg(P.spark, { pos: [[0, 'xy']], simTime: [[CARRIER_AT.spark, 'z']] });
    reg(P.smoke, { pos: [[0, 'xy']], simTime: [[CARRIER_AT.smoke, 'z']] });
    reg(P.debris, { pos: [[0, 'xy']], simTime: [[CARRIER_AT.debris, 'z']] });
    reg(P.dist, { pos: [[0, 'xy']], fxTime: [[0, 'w']], simTime: [[CARRIER_AT.dist, 'z']] });
    reg(P.arc, { pos: [[0, 'xy'], [1, 'xy']], fxTime: [[0, 'w']], simTime: [[CARRIER_AT.arc, 'z']] });
    this._registered = true;
  }

  // -------------------------------------------------------------------------
  // RENDER

  _buildRender(scene) {
    const mk = (geo, mat, order, name, pool, layer = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      mesh.name = name;
      mesh.count = 2;
      mesh.visible = false;
      mesh.matrixAutoUpdate = true;
      mesh.layers.set(layer);
      mesh.userData.wfxPool = pool;
      if (scene) scene.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    const quad = new THREE.PlaneGeometry(1, 1);
    const P = this.pools;
    this.smokeMesh = mk(quad, this._smokeMaterial(), POOL_ORDER.smoke, 'wfxSmoke', P.smoke);
    this.debrisMesh = mk(quad, this._debrisMaterial(), POOL_ORDER.debris, 'wfxDebris', P.debris);
    this.addMesh = mk(quad, this._addMaterial(), POOL_ORDER.add, 'wfxAdd', P.add);
    this.sparkMesh = mk(quad, this._sparkMaterial(), POOL_ORDER.spark, 'wfxSparks', P.spark);
    this.arcMesh = mk(this._arcGeometry(), this._arcMaterial(), POOL_ORDER.arc, 'wfxArcs', P.arc);
    this.distMesh = mk(quad, this._distMaterial(), POOL_ORDER.dist, 'wfxDist', P.dist, this.distLayer);
  }

  /** Przesunięcie nośnika w rysunku (vec3, układ lokalny sceny). */
  _carried(C) {
    const o = this.origin;
    return vec3(fxCarrierOffset(C, o.timeSim, o.timeRender), 0.0);
  }

  _addMaterial() {
    const U = this.U;
    const buf = this.pools.add.buf;
    const noise = this.noise;
    const T = this.origin.timeFx;
    const vCol = varyingProperty('vec4', 'vWfxAddCol');     // barwa × alfa, rodzaj
    const vInfo = varyingProperty('vec4', 'vWfxAddInfo');   // u, ziarno, wiek, rozmiar
    const mat = additiveMaterial('wfxAdd');
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(STRIDE.add)).toVar();
      const P0 = buf.element(i).toVar();
      const P1 = buf.element(i.add(uint(1))).toVar();
      const age = T.sub(P0.w).toVar();
      const out = vec3(0.0, 0.0, -50.0).toVar();
      vCol.assign(vec4(0.0));
      vInfo.assign(vec4(0.0));
      If(age.greaterThanEqual(0.0).and(age.lessThan(P1.w)), () => {
        const P2 = buf.element(i.add(uint(2))).toVar();
        const P3 = buf.element(i.add(uint(3))).toVar();
        const P4 = buf.element(i.add(uint(4))).toVar();
        const P5 = buf.element(i.add(uint(5))).toVar();
        const P6 = buf.element(i.add(uint(6))).toVar();
        const C = buf.element(i.add(uint(CARRIER_AT.add))).toVar();
        const u = clamp(age.div(max(P1.w, 1e-4)), 0.0, 1.0).toVar();
        const pos = P0.xyz.add(P1.xyz.mul(dragPath(P5.x, age))).add(this._carried(C)).toVar();
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
        const v = clamp(uv().y, 0.0, 1.0);
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
        const heat = clamp(float(1.0).sub(vInfo.x), 0.0, 1.0).mul(dens);
        // ciało ognia w paśmie barwy (0,3–1), biel tylko w najgorętszych kłębach
        shape.assign(dens.mul(0.34).add(heat.mul(heat).mul(heat).mul(0.95)));
      }).Else(() => {
        // VAPOR — miękki, postrzępiony opar (TEX.smoke)
        const sc = vec2(seed.mul(9.3), seed.mul(5.1));
        const n = texture(noise, q.mul(0.38).add(sc).add(vec2(vInfo.z.mul(0.05), 0.0))).r;
        const a = smoothstep(1.02, 0.15, r).mul(n.mul(0.95).add(0.3));
        shape.assign(a.mul(smoothstep(0.08, 0.42, float(1.0).sub(r.mul(0.85)).add(n.sub(0.5).mul(0.55)))));
      });
      return addOut(vCol.rgb.mul(shape));
    })();
    return mat;
  }

  _sparkMaterial() {
    const U = this.U;
    const buf = this.pools.spark.buf;
    const T = this.origin.timeFx;
    const vCol = varyingProperty('vec3', 'vWfxSparkCol');
    const vA = varyingProperty('vec2', 'vWfxSparkA');   // wzdłuż (0 ogon → 1 głowa), w poprzek
    const mat = additiveMaterial('wfxSparks');
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(STRIDE.spark)).toVar();
      const P0 = buf.element(i).toVar();
      const P1 = buf.element(i.add(uint(1))).toVar();
      const out = vec3(0.0, 0.0, -50.0).toVar();
      vCol.assign(vec3(0.0));
      If(P0.w.lessThan(P1.w), () => {
        const P2 = buf.element(i.add(uint(2))).toVar();
        const P3 = buf.element(i.add(uint(3))).toVar();
        const P4 = buf.element(i.add(uint(4))).toVar();
        const C = buf.element(i.add(uint(CARRIER_AT.spark))).toVar();
        const u = clamp(P0.w.div(max(P1.w, 1e-4)), 0.0, 1.0).toVar();
        const head = P0.xy.add(this._carried(C).xy).toVar();
        // Smuga z ruchu WŁASNEGO (względem nośnika — jak smuga pocisku względem strzelca).
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
        const tail = head.sub(dir.mul(len));
        const center = mix(tail, head, along).add(dir.mul(g.x.sign().mul(wid.mul(0.5))));
        out.assign(vec3(center.add(perp.mul(g.y.mul(wid).mul(2.0))), P0.z));
        // stygnięcie: proch biało-żółty → pomarańcz → czerwień; jony zostają błękitne
        const flick = sin(T.mul(42.0).add(P2.w)).mul(0.28).add(0.72);
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
      return addOut(vCol.mul(head.mul(across)));
    })();
    return mat;
  }

  _smokeMaterial() {
    const U = this.U;
    const buf = this.pools.smoke.buf;
    const noise = this.noise;
    const vA = varyingProperty('vec4', 'vWfxSmkA');   // albedo, alfa
    const vL = varyingProperty('vec4', 'vWfxSmkL');   // światło, ziarno
    const vD = varyingProperty('vec4', 'vWfxSmkD');   // kier. światła (xy), wiek, z
    const vH = varyingProperty('vec3', 'vWfxSmkH');   // żar
    const mat = premulMaterial('wfxSmoke');
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(STRIDE.smoke)).toVar();
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
        const C = buf.element(i.add(uint(CARRIER_AT.smoke))).toVar();
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
        out.assign(P0.xyz.add(this._carried(C)).add(vec3(corner, 0.0)));
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
      // Słońce gaśnie w cieniu planety / kadłuba (maska Core3D), otoczenie przygasa (sunFill).
      const sunVis = sunVisibility().toVar();
      const lit = vL.rgb.mul(wrap.mul(0.8).add(0.2)).add(U.sunCol.mul(sunW).mul(sunVis)).add(U.ambient.mul(sunFill(sunVis)));
      // żar: gęstsze jądro świeci mocniej
      const glow = vH.mul(dens.mul(dens).mul(1.6).add(0.15));
      const col = vA.rgb.mul(lit).add(glow);
      return vec4(max(col, vec3(0.0)).mul(a), a);
    })();
    return mat;
  }

  _debrisMaterial() {
    const U = this.U;
    const buf = this.pools.debris.buf;
    const vA = varyingProperty('vec4', 'vWfxDebA');   // albedo, rodzaj
    const vL = varyingProperty('vec4', 'vWfxDebL');   // światło, alfa
    const vH = varyingProperty('vec4', 'vWfxDebH');   // żar, ziarno
    const vR = varyingProperty('float', 'vWfxDebR');  // obrót (połysk)
    const mat = premulMaterial('wfxDebris');
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(STRIDE.debris)).toVar();
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
        const C = buf.element(i.add(uint(CARRIER_AT.debris))).toVar();
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
        out.assign(P0.xyz.add(this._carried(C)).add(vec3(corner, 2.0)));
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
      const sunVis = sunVisibility();
      const lit = min(vL.rgb, vec3(2.5)).mul(shade.mul(0.6).add(glint)).add(U.ambient.mul(2.0)).add(U.sunCol.mul(0.35).mul(shade).mul(sunVis));
      const col = vA.rgb.mul(lit).add(vH.rgb.mul(inside.mul(0.6).add(0.4)));
      return vec4(max(col, vec3(0.0)).mul(a), a);
    })();
    return mat;
  }

  _distMaterial() {
    const U = this.U;
    const buf = this.pools.dist.buf;
    const noise = this.noise;
    const T = this.origin.timeFx;
    const vD = varyingProperty('vec4', 'vWfxDistD');   // siła, rodzaj, u, ziarno
    const vS = varyingProperty('vec2', 'vWfxDistS');   // rozmiar [px], wiek
    const mat = additiveMaterial('wfxDist');
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(STRIDE.dist)).toVar();
      const P0 = buf.element(i).toVar();
      const P1 = buf.element(i.add(uint(1))).toVar();
      const age = T.sub(P0.w).toVar();
      const out = vec3(0.0, 0.0, -50.0).toVar();
      vD.assign(vec4(0.0));
      vS.assign(vec2(0.0));
      If(age.greaterThanEqual(0.0).and(age.lessThan(P1.w)), () => {
        const P2 = buf.element(i.add(uint(2))).toVar();
        const P3 = buf.element(i.add(uint(3))).toVar();
        const C = buf.element(i.add(uint(CARRIER_AT.dist))).toVar();
        const u = clamp(age.div(max(P1.w, 1e-4)), 0.0, 1.0).toVar();
        const shock = P2.w.greaterThan(0.5);
        // fala: szybki rozbieg (ease-out), drganie: rozrost jak dym
        const grow = select(shock, float(1.0).sub(pow(float(1.0).sub(u), 2.2)), pow(max(u, 1e-5), P3.z));
        const size = mix(P2.x, P2.y, grow);
        const a = P2.z.mul(smoothstep(0.0, max(P3.x, 1e-3), u)).mul(pow(float(1.0).sub(u), P3.y));
        vD.assign(vec4(a, P2.w, u, P3.w));
        vS.assign(vec2(size.mul(U.zoom), age));
        out.assign(P0.xyz.add(P1.xyz.mul(age)).add(this._carried(C)).add(vec3(positionGeometry.xy.mul(size), 0.0)));
      });
      return out;
    })();
    mat.fragmentNode = Fn(() => {
      const q = uv().sub(0.5).mul(2.0).toVar();
      const r = length(q).toVar();
      const off = vec2(0.0).toVar();
      If(vD.y.greaterThan(0.5), () => {
        // fala uderzeniowa: cienki pierścień załamania na froncie (sama refrakcja)
        const x = r.sub(0.82).div(0.1);
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
      // przesunięcie w pikselach ekranu (siła × rozmiar na ekranie), osie SCENY (Core3D §10)
      const px = off.mul(vD.x).mul(min(vS.x, 900.0)).mul(0.05);
      return vec4(px, 0.0, 0.0);
    })();
    // Warstwa DIST sumuje przesunięcia (ujemne też) — bez alfy.
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneFactor;
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
    const T = this.origin.timeFx;
    const vC = varyingProperty('vec4', 'vWfxArcC');   // barwa, strona
    const mat = additiveMaterial('wfxArcs');
    // przesunięcie punktu łamanej k (hash po ziarnie, punkcie i kroku 30 Hz)
    const jig = (seed, k, step, salt) => hash(uint(seed).mul(uint(7919)).add(uint(k).mul(uint(131))).add(uint(step).mul(uint(3571))).add(uint(salt))).sub(0.5).mul(2.0);
    mat.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(STRIDE.arc)).toVar();
      const P0 = buf.element(i).toVar();
      const P1 = buf.element(i.add(uint(1))).toVar();
      const age = T.sub(P0.w).toVar();
      const out = vec3(0.0, 0.0, -50.0).toVar();
      vC.assign(vec4(0.0));
      If(age.greaterThanEqual(0.0).and(age.lessThan(P1.w)), () => {
        const P2 = buf.element(i.add(uint(2))).toVar();
        const P3 = buf.element(i.add(uint(3))).toVar();
        const C = buf.element(i.add(uint(CARRIER_AT.arc))).toVar();
        const u = clamp(age.div(max(P1.w, 1e-4)), 0.0, 1.0);
        const t = positionGeometry.x.toVar();
        const side = positionGeometry.y;
        const step = floor(max(T, 0.0).mul(30.0)).toVar();
        const seed = P3.y;
        const cOff = this._carried(C).xy.toVar();
        const a = P0.xy.add(cOff);
        const b = P1.xy.add(cOff);
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
      const s = clamp(vC.w, -1.0, 1.0);
      const prof = exp(s.mul(s).mul(-3.0));
      return addOut(vC.rgb.mul(prof));
    })();
    return mat;
  }

  // -------------------------------------------------------------------------
  // Klatka (krok efektów Core3D.fx — fxFrame.js)

  /**
   * Krok 1 klatki efektów (stara rama początku): wysyłka paczek zapakowanych od
   * poprzedniej klatki i dispatch kerneli spawn. Czas narodzin (ADD, DIST, ARC) =
   * zegar efektów tej klatki względem bieżącej epoki (przeskok w kroku 2 przesunie go
   * kernelem, jak pozycje).
   */
  spawn(renderer, fxTime) {
    this.time = fxTime;
    const U = this.U;
    const o = this.origin;
    U.spawnTime.value = fxTime - o.fxEpoch;
    let spawned = 0;
    let dispatches = 0;
    const pools = this.poolList;
    // Kernele spawnu pul z paczkami w JEDNYM passie compute (zadanie 23): uniformy per pula (pool.uSpawn),
    // ziarna w tej samej kolejności co dotąd; wątków = count węzła (liczba cząstek paczek puli).
    const L = this._spawnList || (this._spawnList = []);
    L.length = 0;
    for (let k = 0; k < pools.length; k++) {
      const pool = pools[k];
      if (!pool.burstCount) continue;
      const used = pool.burstCount * BSTRIDE;
      markRange(pool.burstNode.value, 0, used * 4);
      const u = pool.uSpawn;
      u.burstCount.value = pool.burstCount;
      u.spawnTotal.value = pool.total;
      u.seedBase.value = (this.frameSeed = (this.frameSeed + 0x9E3779B1) >>> 0);
      const node = this._spawnNodes[k];
      node.count = pool.total;
      L.push(node);
      dispatches++;
      spawned += pool.total;
      pool.burstCount = 0;
      pool.total = 0;
    }
    if (L.length === 1) renderer.compute(L[0]);
    else if (L.length > 1) renderer.compute(L);
    this.stats.spawned = spawned;
    this.stats.dispatches = dispatches;
    return dispatches;
  }

  /**
   * Krok 5 klatki efektów (po początku, przesunięciu i siatce świateł): ruch iskier,
   * dymu i odłamków, światło dymu i odłamków, siatki pul na początku i liczby instancji.
   */
  update(renderer, dt, zoom) {
    const U = this.U;
    // Stan cząstek pul liczy tylko GPU (~18 MB kopii CPU) — kopie oddane, gdy bufory już są (zadanie 23).
    if (this._kopieCpu !== 0) this._kopieCpu = oddajKopieCpu(renderer, this._gpuOnly || (this._gpuOnly = this.poolList.map((p) => p.buf)));
    U.dt.value = dt;
    U.zoom.value = Math.max(1e-4, zoom);
    const P = this.pools;
    // Ruch i światło pul w JEDNYM passie compute (zadanie 23, duża bitwa): renderer.compute(lista) koduje
    // dispatch'e po kolei w jednym passie z jednym zgłoszeniem zamiast pięciu (~25–40 µs CPU każde); dispatch
    // w passie to osobny zakres użycia buforów (WebGPU wstawia bariery) — kolejność i wynik jak w osobnych
    // passach. Wątków = count węzła (zajęta część puli, jak dawny rozmiar dispatchu); wspólne uniformy
    // (dt, zoom) te same dla wszystkich kerneli klatki.
    const L = this._updateList || (this._updateList = []);
    L.length = 0;
    if (dt > 0) {
      if (P.spark.isLive()) { this.updateSpark.count = P.spark.used; L.push(this.updateSpark); }
      if (P.smoke.isLive()) { this.updateSmoke.count = P.smoke.used; L.push(this.updateSmoke); }
      if (P.debris.isLive()) { this.updateDebris.count = P.debris.used; L.push(this.updateDebris); }
    }
    if (P.smoke.isLive()) { this.lightSmoke.count = P.smoke.used; L.push(this.lightSmoke); }
    if (P.debris.isLive()) { this.lightDebris.count = P.debris.used; L.push(this.lightDebris); }
    if (L.length === 1) renderer.compute(L[0]);
    else if (L.length > 1) renderer.compute(L);
    const dispatches = L.length;
    const o = this.origin;
    for (let k = 0; k < this.meshes.length; k++) {
      const mesh = this.meshes[k];
      const pool = mesh.userData.wfxPool;
      pool._recycleIfDead();
      const live = pool.isLive();
      mesh.visible = live;
      if (!live) continue;
      mesh.count = pool.used;
      mesh.position.set(o.x, o.y, 0);
      mesh.updateMatrixWorld(true);
    }
    this.stats.dispatches += dispatches;
    let dropped = 0;
    for (let k = 0; k < this.poolList.length; k++) dropped += this.poolList[k].dropped;
    this.stats.dropped = dropped;
    return dispatches;
  }

  /** Czy warstwa DIST ma w tej klatce zawartość (Core3D.setDistortLayerActive). */
  get distLive() { return this.pools.dist.isLive(); }

  /** Czy jakakolwiek pula żyje. */
  get anyLive() {
    for (let k = 0; k < this.poolList.length; k++) if (this.poolList[k].isLive()) return true;
    return false;
  }

  /**
   * Rozgrzewka (raz przy gotowym urządzeniu): puste dispatche kerneli (licznik 0) i
   * pipeline'y siatek pul w passie ortho / DIST (Core3D.prewarmPass).
   */
  warm(renderer, core) {
    for (const pool of this.poolList) {
      pool.uSpawn.burstCount.value = 0;
      pool.uSpawn.spawnTotal.value = 0;
    }
    for (const node of this._spawnNodes) renderer.compute(node, 1);
    renderer.compute(this.updateSpark, 1);
    renderer.compute(this.updateSmoke, 1);
    renderer.compute(this.updateDebris, 1);
    renderer.compute(this.lightSmoke, 1);
    renderer.compute(this.lightDebris, 1);
    this._kopieCpu = oddajKopieCpu(renderer, this._gpuOnly || (this._gpuOnly = this.poolList.map((p) => p.buf)));
    if (core?.prewarmPass) {
      for (const mesh of this.meshes) {
        const prev = mesh.visible;
        mesh.visible = true;
        core.prewarmPass(mesh, mesh === this.distMesh ? this.distLayer : 0);
        mesh.visible = prev;
      }
    }
  }

  /** Czyści pule (nowa gra): głowy na 0, paczki porzucone. Dane GPU wygasają same. */
  reset() {
    for (const pool of this.poolList) {
      pool.burstCount = 0;
      pool.total = 0;
      pool.liveUntil = -1;
      pool.head = 0;
      pool.wrapped = false;
    }
    for (const mesh of this.meshes) mesh.visible = false;
  }
}
