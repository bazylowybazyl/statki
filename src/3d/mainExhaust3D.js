// src/3d/mainExhaust3D.js
//
// Silniki MAIN — port `dema/silniki/silnik-wydech.html` (EngineExhaust /
// JetSystem). Struga to krótko żyjące kwady „doklejone” do dyszy: co klatkę
// biorą pozycję i kierunek właściciela, więc nie odklejają się od lecącego
// statku, a szum płynie w shaderze. Iskry lecą do wspólnego banku Fx3D.spark
// (te same smugi co z broni) — własnej puli iskier tu nie ma.
//
// Jeden draw call na CAŁĄ flotę: wszystkie strugi siedzą w jednej instancjonowanej
// puli (pass Ortho jest związany submisją, patrz engineExhaustBatch.js).
//
// Różnice względem dema:
//   - płaszczyzna XY, +Z ku kamerze ortho: kwad leży w XY (bok = prostopadła
//     do osi w płaszczyźnie), spłaszczenie iskier w Z, oś pomocnicza bazy +Z;
//   - pozycje WZGLĘDEM początku przy kamerze (mesh.position), a nie w świecie —
//     świat leży przy 5–10 mln j. i float32 na GPU drżałby ~1 px (wzór
//     Bridge3D._setOrigin, AGENTS.md);
//   - skala per dysza: S = promień dyszy / promień dyszy dema, a długość
//     gradientu palety jedzie atrybutem instancji (dema miały jedno S);
//   - bez PointLightów (gra trzyma enginePointLights: false);
//   - alfa = max(rgb) przy premultipliedAlpha — alfa 1 na całym kwadzie wycina
//     w poświacie bloomu ciemny prostokąt (kanwa Core3D jest premultiplied);
//   - faza szumu całkowana na CPU (uFlowPh), nie uTime·flow.

import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { Fx3D, makeBasis, coneDir } from './fxParticles3D.js';
import {
  MAIN_EXHAUST_PALETTES,
  MAIN_EXHAUST_TUNE as T,
  DEMO_NOZZLE_RADIUS,
  paletteColor,
  paletteSparkCool
} from '../data/engineFx.js';

const MAX_JETS = 4096;
const MAX_OWNERS = 2048;
// Atlas palet — tekstura HalfFloat: oś x to temperatura strugi (0 = chłodny
// brzeg, 1 = rdzeń), oś y to odległość od dyszy; paleta = PAL_L wierszy.
const PAL_MAX = 32;
const PAL_T = 64;
const PAL_L = 16;

// Pod kadłubem, jak dawny płomień (grupa dyszy siedziała na z = −5): kadłub
// pisze głębię na z ≈ 0, więc struga wychodzi spod rufy, a nie maluje się po niej.
export const MAIN_EXHAUST_Z = -5.0;
// Skok pozycji dyszy ponad tę prędkość to teleport / podmiana kadłuba, nie lot
// (warp w najwyższym biegu to 80 000 j./s) — iskry nie dziedziczą wtedy „prędkości”.
const TELEPORT_SPEED = 250000;
// Faza szumu rośnie bez końca, a szum strugi (hash) nie jest okresowy — zawijamy
// ją rzadko; skok wzoru w krótkich, migoczących strugach jest niewidoczny.
const FLOW_PHASE_WRAP = 1024;
// Wspólny bank iskier dzielą bronie — silniki biorą najwyżej tyle jego pojemności.
const SPARK_BUDGET_SHARE = 0.55;

const JET_VERT = /* glsl */`
attribute vec2 iPos;     // wylot dyszy względem mesh.position (początek przy kamerze)
attribute vec2 iDir;     // kierunek wydechu w płaszczyźnie gry
attribute vec2 iPalG;    // x: indeks palety w atlasie, y: długość gradientu [j.]
attribute vec4 iData;    // x: długość, y: szerokość, z: alfa, w: u życia
attribute float iSeed;
uniform float uZ;
varying vec2 vUv;
varying float vA, vU, vSeed, vPal, vDist, vGradLen;
void main() {
  vUv = uv; vA = iData.z; vU = iData.w; vSeed = iSeed; vPal = iPalG.x; vGradLen = iPalG.y;
  vDist = (position.y + 0.5) * iData.x;          // odległość od dyszy wzdłuż strugi
  vec2 axis = iDir * inversesqrt(max(dot(iDir, iDir), 1e-12));
  vec2 side = vec2(-axis.y, axis.x);              // kwad leży w płaszczyźnie XY
  vec2 p = iPos + axis * ((position.y + 0.5) * iData.x) + side * (position.x * iData.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, uZ, 1.0);
}`;

const JET_FRAG = /* glsl */`
uniform float uFlowPh;   // faza płynięcia szumu — ∫flow·dt liczone na CPU
uniform sampler2D uPal;
varying vec2 vUv;
varying float vA, vU, vSeed, vPal, vDist, vGradLen;
float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
float cloud(vec2 p){return .68*noise2(p)+.32*noise2(p*2.07+17.3);}
vec3 palColor(float t, float g) {
  float row = vPal * ${PAL_L}.0 + 0.5 + g * ${PAL_L - 1}.0;
  return texture2D(uPal, vec2((t * ${PAL_T - 1}.0 + 0.5) / ${PAL_T}.0, row / ${PAL_MAX * PAL_L}.0)).rgb;
}
void main() {
  // Clamp: MSAA ekstrapoluje varyingi do próbek POZA trójkątem, a pow() z ujemną
  // podstawą to NaN — w buforze HalfFloat bloom rozlewał go na cały ekran.
  float along = clamp(vUv.y, 0.0, 1.0);                      // 0 = dysza, 1 = koniec
  float x = clamp(vUv.x, 0.0, 1.0) * 2.0 - 1.0;
  float n  = cloud(vec2(along * 5.5 - uFlowPh, x * 1.4 + vSeed * 9.0));
  float n2 = cloud(vec2(along * 2.2 - uFlowPh * 0.55 + vSeed * 5.0, 0.3));
  float w = mix(0.30, 1.0, along);                           // stożek się rozszerza
  // NIE pow(x / w, 2.0): x < 0 to w HLSL/ANGLE NaN, a NaN w buforze HalfFloat
  // bloom rozlewa na cały ekran (tak było w pierwszym porcie z dema).
  float xw = x / w;
  float across = exp(-xw * xw * 3.2) * (0.55 + 0.7 * n);
  float base = smoothstep(0.0, 0.06, along) * pow(1.0 - along, 0.85) * (0.65 + 0.55 * n2);
  float a = across * base * vA;
  float t = clamp(a * 1.5 + exp(-x * x * 30.0) * (1.0 - along) * 0.55, 0.0, 1.0);
  float g = clamp(vDist / max(vGradLen, 1e-3), 0.0, 1.0);    // gradient liczony od dyszy
  vec3 c = palColor(t, g) * a;
  gl_FragColor = vec4(c, min(1.0, max(c.r, max(c.g, c.b))));
}`;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
// migotanie ognia — dwa niewspółmierne sinusy czytają się jak szum, a kosztują nic
const flicker = (t, seed) => 0.55 + 0.45 * Math.sin(t * 13.7 + seed) * Math.sin(t * 7.31 + seed * 2.13);

/* ============================================================================
   PULA STRUG — struct-of-arrays, zero alokacji w klatce. Pozycje w double
   (świat 5–10 mln j.), na GPU idą już względem początku.
   ========================================================================== */
const jets = {
  count: 0,
  px: new Float64Array(MAX_JETS),
  py: new Float64Array(MAX_JETS),
  dx: new Float32Array(MAX_JETS),
  dy: new Float32Array(MAX_JETS),
  age: new Float32Array(MAX_JETS),
  life: new Float32Array(MAX_JETS),
  l0: new Float32Array(MAX_JETS),
  l1: new Float32Array(MAX_JETS),
  w0: new Float32Array(MAX_JETS),
  w1: new Float32Array(MAX_JETS),
  pal: new Float32Array(MAX_JETS),
  grad: new Float32Array(MAX_JETS),
  alpha: new Float32Array(MAX_JETS),
  seed: new Float32Array(MAX_JETS),
  own: new Int32Array(MAX_JETS)
};
const JET_FIELDS = ['px', 'py', 'dx', 'dy', 'age', 'life', 'l0', 'l1', 'w0', 'w1', 'pal', 'grad', 'alpha', 'seed', 'own'];

function killJet(i) {
  const last = --jets.count;
  if (i === last) return;
  for (let k = 0; k < JET_FIELDS.length; k++) {
    const a = jets[JET_FIELDS[k]];
    a[i] = a[last];
  }
}

function spawnJet(x, y, dx, dy, life, l0, l1, w0, w1, pal, grad, alpha, seed, age, owner) {
  if (jets.count >= MAX_JETS) return;
  const i = jets.count++;
  jets.px[i] = x; jets.py[i] = y;
  jets.dx[i] = dx; jets.dy[i] = dy;
  jets.age[i] = age; jets.life[i] = life;
  jets.l0[i] = l0; jets.l1[i] = l1;
  jets.w0[i] = w0; jets.w1[i] = w1;
  jets.pal[i] = pal; jets.grad[i] = grad;
  jets.alpha[i] = alpha; jets.seed[i] = seed;
  jets.own[i] = owner;
}

/* --- właściciele: dysze, do których strugi są doklejone ------------------ */
const owners = {
  x: new Float64Array(MAX_OWNERS),
  y: new Float64Array(MAX_OWNERS),
  dx: new Float32Array(MAX_OWNERS),
  dy: new Float32Array(MAX_OWNERS),
  free: new Int32Array(MAX_OWNERS),
  freeCount: 0,
  used: 0
};

function allocOwner() {
  if (owners.freeCount > 0) return owners.free[--owners.freeCount];
  if (owners.used < MAX_OWNERS) return owners.used++;
  return -1;
}

// Dysza znika (statek poza kadrem, zniszczony, nowy układ): jej strugi zostają
// tam, gdzie były, i dogasają same.
function freeOwner(k) {
  if (k < 0 || k >= MAX_OWNERS) return;
  for (let i = 0; i < jets.count; i++) {
    if (jets.own[i] !== k) continue;
    jets.px[i] = owners.x[k];
    jets.py[i] = owners.y[k];
    jets.dx[i] = owners.dx[k];
    jets.dy[i] = owners.dy[k];
    jets.own[i] = -1;
  }
  owners.free[owners.freeCount++] = k;
}

/* ============================================================================
   RENDER
   ========================================================================== */
let mesh = null;
let geo = null;
let mat = null;
let atlas = null;
const bufs = {};
let originX = 0;
let originY = 0;
let clock = 0;
let flowPhase = 0;
let frameNozzles = 0;

function buildAtlas() {
  const H = THREE.DataUtils.toHalfFloat;
  const data = new Uint16Array(PAL_T * PAL_MAX * PAL_L * 4);
  const one = H(1);
  const c = [0, 0, 0];
  MAIN_EXHAUST_PALETTES.slice(0, PAL_MAX).forEach((pal, k) => {
    for (let r = 0; r < PAL_L; r++) {
      const g = r / (PAL_L - 1);
      for (let x = 0; x < PAL_T; x++) {
        paletteColor(pal, x / (PAL_T - 1), g, c);
        const o = ((k * PAL_L + r) * PAL_T + x) * 4;
        data[o] = H(c[0]); data[o + 1] = H(c[1]); data[o + 2] = H(c[2]); data[o + 3] = one;
      }
    }
  });
  const tex = new THREE.DataTexture(data, PAL_T, PAL_MAX * PAL_L, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function ensureBuilt() {
  if (mesh) return true;
  if (!Core3D.isInitialized || !Core3D.scene) return false;
  const base = new THREE.PlaneGeometry(1, 1);
  geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  for (const [name, size] of [['iPos', 2], ['iDir', 2], ['iPalG', 2], ['iData', 4], ['iSeed', 1]]) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_JETS * size), size);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, attr);
    bufs[name] = attr;
  }
  geo.instanceCount = 0;
  atlas = buildAtlas();
  mat = new THREE.ShaderMaterial({
    uniforms: {
      uZ: { value: MAIN_EXHAUST_Z },
      uFlowPh: { value: 0 },
      uPal: { value: atlas }
    },
    vertexShader: JET_VERT,
    fragmentShader: JET_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'MainExhaustJets';
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  mesh.visible = false;
  Core3D.scene.add(mesh);
  return true;
}

/* ============================================================================
   STAN DYSZY
   ========================================================================== */
export function createMainExhaustState(opts = {}) {
  const throttle = clamp01(Number(opts.throttle) || 0);
  return {
    owner: -1,
    seed: Number.isFinite(opts.seed) ? opts.seed : Math.random() * 100,
    running: true,
    boosting: false,
    // Statek wchodzący w kadr ma już rozgrzany silnik — bez rozruchu od zera.
    power: throttle,
    heat: Math.min(1, throttle),
    fl: 0.55,
    fresh: true,
    prevX: 0, prevY: 0,
    velX: 0, velY: 0,
    accJet: Math.random(),
    accTail: Math.random(),
    accSpark: Math.random()
  };
}

export function releaseMainExhaustState(state) {
  if (!state) return;
  if (state.owner >= 0) freeOwner(state.owner);
  state.owner = -1;
  state.fresh = true;
}

const _dir3 = new THREE.Vector3();
const _cone = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _sparkCol = MAIN_EXHAUST_PALETTES.map((pal) => pal.spark.slice());
const _sparkCool = MAIN_EXHAUST_PALETTES.map((pal) => paletteSparkCool(pal));

function sparkBudgetLeft() {
  const pool = Fx3D.spark;
  if (!pool) return 0;
  return Math.max(0, Math.floor(pool.cap * SPARK_BUDGET_SHARE) - pool.p.count);
}

// Iskra z wylotu: stożek wokół osi wydechu, prędkość dyszy dziedziczona,
// pozycja przesunięta na koniec klatki (bank przesunie ją dopiero w następnej).
function spawnSpark(state, x, y, dirX, dirY, S, ps, palIdx, ago, dt, vMin, vMax, life) {
  _dir3.set(dirX, dirY, 0);
  makeBasis(_dir3);
  coneDir(_cone, _dir3, 0.3, T.flatten);
  const speed = rand(vMin, vMax) * S * ps;
  _vel.set(_cone.x * speed + state.velX * T.inherit, _cone.y * speed + state.velY * T.inherit, _cone.z * speed);
  const k = dt > 0 ? 1 - ago / dt : 1;
  const ox = lerp(state.prevX, x, k);
  const oy = lerp(state.prevY, y, k);
  const off = rand(0, 3) * S;
  _pos.set(
    ox + _cone.x * off + _vel.x * ago,
    oy + _cone.y * off + _vel.y * ago,
    MAIN_EXHAUST_Z
  );
  const cool = _sparkCool[palIdx];
  Fx3D.spark.spawn(_pos, _vel, life, rand(0.5, 1.5), rand(2.5, 7) * S, _sparkCol[palIdx], cool[1], cool[2]);
}

// Uderzenie strugi przy wejściu dopalacza — dwie długie strugi i wiązka iskier.
function kick(state, p, S, palIdx, grad, str) {
  const L = p.lengthMul;
  const W = p.widthMul;
  const J = p.jetGain;
  spawnJet(p.x, p.y, p.dirX, p.dirY, 0.55, 12 * S, (72 + 40 * str) * S * L, 9 * S * W, 20 * S * W, palIdx, grad, 1.0 * str * J, Math.random(), 0, state.owner);
  spawnJet(p.x, p.y, p.dirX, p.dirY, 0.40, 8 * S, (46 + 26 * str) * S * L, 16 * S * W, 36 * S * W, palIdx, grad, 0.55 * str * J, Math.random(), 0, state.owner);
  if (!(p.sparkMul > 0) || !Fx3D.spark) return;
  const n = Math.min(sparkBudgetLeft(), Math.round(40 * str * p.sparkMul));
  for (let i = 0; i < n; i++) spawnSpark(state, p.x, p.y, p.dirX, p.dirY, S, 1, palIdx, 0, 0, 50, 220, rand(0.3, 1.1));
}

/* ============================================================================
   API
   ========================================================================== */
export const MainExhaust3D = {
  MAX_JETS,

  get jetCount() { return jets.count; },

  /**
   * Początek klatki: początek układu przy kamerze (współrzędne sceny) i zegar.
   */
  begin(orgX, orgY, dt) {
    originX = Number.isFinite(orgX) ? orgX : 0;
    originY = Number.isFinite(orgY) ? orgY : 0;
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    clock += step;
    frameNozzles = 0;
  },

  /**
   * Jedna dysza MAIN tej klatki.
   * @param {object} state stan z createMainExhaustState (mutowany)
   * @param {object} p
   *   x, y          wylot dyszy (scena)
   *   dirX, dirY    kierunek wydechu (scena, jednostkowy)
   *   radius        promień wylotu w jednostkach świata
   *   throttle      ciąg 0..1
   *   boost         dopalacz (bool)
   *   lengthMul, widthMul  mnożniki statku
   *   palette       indeks palety MAIN
   *   jetGain       jasność strug (suwak „VFX: bloom” gracza)
   *   sparkMul      mnożnik iskier (0 = bez iskier)
   *   pixelRadius   promień dyszy w pikselach ekranu (LOD)
   *   dt            krok czasu [s]
   */
  push(state, p) {
    if (!ensureBuilt()) return;
    frameNozzles++;
    const dt = Math.max(0, Math.min(0.1, Number(p.dt) || 0));
    const x = p.x;
    const y = p.y;

    if (state.owner < 0) state.owner = allocOwner();
    if (state.fresh) {
      state.prevX = x; state.prevY = y;
      state.velX = 0; state.velY = 0;
      state.fresh = false;
    } else if (dt > 1e-6) {
      const vx = (x - state.prevX) / dt;
      const vy = (y - state.prevY) / dt;
      if (vx * vx + vy * vy > TELEPORT_SPEED * TELEPORT_SPEED) {
        state.prevX = x; state.prevY = y;
        state.velX = 0; state.velY = 0;
      } else {
        state.velX = vx; state.velY = vy;
      }
    }
    const own = state.owner;
    if (own >= 0) {
      owners.x[own] = x; owners.y[own] = y;
      owners.dx[own] = p.dirX; owners.dy[own] = p.dirY;
    }

    const R = Math.max(0, Number(p.radius) || 0);
    const S = R / DEMO_NOZZLE_RADIUS;
    const palIdx = Math.max(0, Math.min(MAIN_EXHAUST_PALETTES.length - 1, p.palette | 0));
    const L = p.lengthMul;
    const W = p.widthMul;
    const J = p.jetGain;
    const grad = T.gradLen * S * L;
    const pixelR = Number.isFinite(p.pixelRadius) ? p.pixelRadius : 99;
    const drawJets = S > 0 && pixelR >= 0.35;
    const drawSparks = drawJets && p.sparkMul > 0 && pixelR >= 1.2 && !!Fx3D.spark;

    // Dopalacz: wejście z uderzeniem strugi.
    const boost = !!p.boost && state.running;
    if (boost && !state.boosting && drawJets) kick(state, p, S, palIdx, grad, 1.0);
    state.boosting = boost;

    // Ciąg: szybkie rozkręcenie, wolniejsze wygaszenie; dysza grzeje się szybciej niż stygnie.
    const throttle = clamp01(Number(p.throttle) || 0);
    const target = !state.running ? 0 : (state.boosting ? Math.max(throttle, 1) * T.boost : throttle);
    state.power += (target - state.power) * (1 - Math.exp(-(target > state.power ? 4.5 : 3.2) * dt));
    if (target === 0 && state.power < 0.004) state.power = 0;
    const hTarget = Math.min(1.2, state.power);
    state.heat += (hTarget - state.heat) * (1 - Math.exp(-(hTarget > state.heat ? 0.7 : 0.22) * dt));

    const k = state.power;
    const pw = k * T.power;
    const fl = lerp(0.55, flicker(clock, state.seed), T.rough);
    state.fl = fl;
    const g = fl / 0.55;
    const ps = 0.6 + 0.4 * Math.min(k, 1.5);

    if (pw > 0.01 && drawJets) {
      const ga = lerp(1, g, 0.35);
      const gl = lerp(1, g, 0.15);
      const dirX = p.dirX;
      const dirY = p.dirY;

      // 1) rdzeń strugi — krótko żyjące kwady doklejone do dyszy, nakładające się na siebie
      let a = state.accJet + T.jetRate * dt;
      while (a >= 1) {
        a -= 1;
        const ago = a / T.jetRate;
        spawnJet(x, y, dirX, dirY, 0.09, 6 * S, (18 + 55 * pw) * S * L * gl * rand(0.85, 1.15),
          (4 + 6 * pw) * S * W, (9 + 14 * pw) * S * W, palIdx, grad,
          T.jetAlpha * clamp01(pw) * ga * J, Math.random(), ago - dt, own);
      }
      state.accJet = a;

      // 2) ogon — długa, cienka, przygaszona struga
      a = state.accTail + T.tailRate * dt;
      while (a >= 1) {
        a -= 1;
        const ago = a / T.tailRate;
        spawnJet(x, y, dirX, dirY, 0.32, 12 * S, (40 + 75 * pw) * S * L * rand(0.9, 1.1),
          (5 + 4 * pw) * S * W, (9 + 10 * pw) * S * W, palIdx, grad,
          T.tailAlpha * clamp01(pw) * J, Math.random(), ago - dt, own);
      }
      state.accTail = a;

      // 3) iskry wzdłuż osi — nierówna praca sypie nimi zrywami
      if (drawSparks) {
        const rate = T.sparkRate * k * lerp(1, g, 0.8) * p.sparkMul;
        a = state.accSpark + rate * dt;
        let budget = sparkBudgetLeft();
        while (a >= 1) {
          a -= 1;
          if (budget-- <= 0) continue;
          spawnSpark(state, x, y, dirX, dirY, S, ps, palIdx, a / rate, dt, 50, 200, rand(0.3, 0.85));
        }
        state.accSpark = a;
      }
    }
    state.prevX = x;
    state.prevY = y;
  },

  /** Koniec klatki: starzenie strug i wgranie instancji względem początku. */
  flush(dt) {
    if (!mesh) return;
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    flowPhase = (flowPhase + T.flowSpeed * step) % FLOW_PHASE_WRAP;
    mat.uniforms.uFlowPh.value = flowPhase;

    for (let i = jets.count - 1; i >= 0; i--) {
      const age = jets.age[i] + step;
      if (age >= jets.life[i]) { killJet(i); continue; }
      jets.age[i] = age;
    }

    const n = jets.count;
    const P = bufs.iPos.array;
    const D = bufs.iDir.array;
    const PG = bufs.iPalG.array;
    const DA = bufs.iData.array;
    const SD = bufs.iSeed.array;
    for (let i = 0; i < n; i++) {
      const i2 = i * 2;
      const i4 = i * 4;
      const u = Math.max(0, jets.age[i]) / jets.life[i];
      const ease = 1 - Math.pow(1 - u, 2.6);
      const o = jets.own[i];
      let px;
      let py;
      if (o >= 0) {
        px = owners.x[o]; py = owners.y[o];
        D[i2] = owners.dx[o]; D[i2 + 1] = owners.dy[o];
      } else {
        px = jets.px[i]; py = jets.py[i];
        D[i2] = jets.dx[i]; D[i2 + 1] = jets.dy[i];
      }
      P[i2] = px - originX;
      P[i2 + 1] = py - originY;
      PG[i2] = jets.pal[i];
      PG[i2 + 1] = jets.grad[i];
      DA[i4] = lerp(jets.l0[i], jets.l1[i], ease);
      DA[i4 + 1] = lerp(jets.w0[i], jets.w1[i], ease);
      DA[i4 + 2] = jets.alpha[i] * Math.pow(1 - u, 1.4) * (u < 0.05 ? (u / 0.05) * (u / 0.05) * (3 - 2 * (u / 0.05)) : 1);
      DA[i4 + 3] = u;
      SD[i] = jets.seed[i];
    }

    mesh.position.set(originX, originY, 0);
    const visible = n > 0;
    if (mesh.visible !== visible) mesh.visible = visible;
    if (geo.instanceCount !== n) geo.instanceCount = n;
    if (!visible) return;
    for (const name in bufs) {
      const attr = bufs[name];
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
  },

  getStats() {
    return { nozzles: frameNozzles, jets: jets.count, draws: jets.count > 0 ? 1 : 0 };
  },

  /** Siatka do kompilacji shadera na ekranie ładowania. */
  prewarm() {
    return ensureBuilt() ? mesh : null;
  },

  dispose() {
    if (mesh?.parent) mesh.parent.remove(mesh);
    geo?.dispose();
    mat?.dispose();
    atlas?.dispose();
    mesh = geo = mat = atlas = null;
    for (const k of Object.keys(bufs)) delete bufs[k];
    jets.count = 0;
    owners.freeCount = 0;
    owners.used = 0;
  }
};
