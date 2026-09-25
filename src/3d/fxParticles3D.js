// src/3d/fxParticles3D.js
//
// Wspólny silnik cząstek dla efektów portowanych z dem (`dema/*.html`):
// struct-of-arrays + instancing, zero alokacji w pętli klatki, jeden draw call
// na system. Z tego korzystają `railgunFx3D.js` (Hexlance) i `muzzleFx3D.js`
// (błyski wylotowe armat i dział jonowych).
//
// DLACZEGO JEDEN BANK, A NIE PULA NA EFEKT: pass Ortho jest związany submisją,
// nie GPU (patrz notatki o draw callach). Dwa komplety tych samych systemów to
// 18 wywołań zamiast 9, dwa razy tyle programów shaderowych i dwa budżety
// cząstek, z których jeden zwykle stoi pusty. Recepty (co i w jakim kolorze
// wysypać) siedzą w modułach efektów, pule i zegar tutaj.
//
// KONWENCJA PŁASZCZYZNY: dema żyją w scenie Y-up (grą jest XZ). Gra ma
// płaszczyznę XY, a +Z wychodzi ku kamerze ortho. Przepisane pod to są:
// `makeBasis` (oś pomocnicza +Z), `coneDir` (spłaszczenie w Z) i WASH_VERT
// (kwad leży w XY). Bilboardy view-space i kwady „wzdłuż osi ku kamerze"
// działają bez zmian — są niezależne od konwencji.

import * as THREE from 'three';
import { Core3D } from './core3d.js';

/* ============================================================================
   WARSTWY Z I KOLEJNOŚĆ RYSOWANIA
   Kadłuby siedzą na z = 0, tarcze 1, pociski ~14, błyski wylotowe broni 82–83.
   ========================================================================== */
export const FX_PLANE_Z = 15;    // pasmo efektów, tuż nad pociskami
export const FX_WASH_Z = 2;      // rozlanie światła po poszyciu, tuż nad kadłubem

const RENDER_ORDER = {
  wash: 84,
  smoke: 85,    // NormalBlending — dym ma zakrywać kadłub, więc idzie pod żarem
  vapor: 86,
  trail: 87,    // rezerwacja dla smugi Hexlance'a (railgunFx3D)
  glow: 88,
  plume: 89,
  spark: 90,
  arcs: 91,
  cross: 92,
  star: 93
};
export const FX_RENDER_ORDER = RENDER_ORDER;

/* ============================================================================
   NARZĘDZIA
   ========================================================================== */
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
}

// Baza ortonormalna wokół kierunku. Kierunki efektów leżą w płaszczyźnie gry,
// więc osią pomocniczą jest +Z (w demach było +Y).
export const _bx = new THREE.Vector3();
export const _by = new THREE.Vector3();
const _bh = new THREE.Vector3();
export function makeBasis(dir) {
  _bh.set(0, 0, 1);
  if (Math.abs(dir.z) > 0.9) _bh.set(1, 0, 0);
  _bx.crossVectors(_bh, dir).normalize();
  _by.crossVectors(dir, _bx).normalize();
}

// Losowy kierunek w stożku o półkącie `spread`. `flat` ścieśnia odchylenie
// w osi Z: w widoku ortho z góry ruch w Z jest NIEWIDOCZNY, więc rozrzut ma
// iść po płaszczyźnie gry, a nie „w ekran".
export function coneDir(out, dir, spread, flat = 1) {
  const theta = spread * Math.sqrt(Math.random());
  const phi = Math.random() * Math.PI * 2;
  const st = Math.sin(theta);
  const ct = Math.cos(theta);
  out.copy(dir).multiplyScalar(ct)
    .addScaledVector(_bx, st * Math.cos(phi))
    .addScaledVector(_by, st * Math.sin(phi));
  if (flat !== 1) {
    out.sub(dir);            // samo odchylenie od osi
    out.z *= flat;           // oś strzału zostaje nietknięta
    out.add(dir).normalize();
  }
  return out;
}

/* ============================================================================
   TEKSTURY PROCEDURALNE — leniwe, jeden komplet na sesję
   ========================================================================== */
function canvasTex(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function valueNoise(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => { switch (h & 3) { case 0: return x + y; case 1: return -x + y; case 2: return x - y; default: return -x - y; } };
  return (x, y) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.5 + 0.5;
  };
}

const TEX = { glow: null, flare: null, cross: null, plume: null, smoke: null, list: [] };

function makeTextures() {
  if (TEX.glow) return TEX;

  // miękka poświata — rdzeń rozbłysku, gazy, żagwie
  TEX.glow = canvasTex(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.78)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.28)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.07)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });

  // gwiazda z promieniami prosto z wylotu
  TEX.flare = canvasTex(256, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.34);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const len = c * (i % 2 === 0 ? 0.98 : 0.6);
      const w = s * (i % 2 === 0 ? 0.030 : 0.018);
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(a);
      const lg = ctx.createLinearGradient(0, 0, len, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0.85)');
      lg.addColorStop(0.35, 'rgba(255,255,255,0.22)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(0, -w); ctx.lineTo(len, 0); ctx.lineTo(0, w);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  });

  // anamorficzny krzyż — kwad skalowany osobno wzdłuż i w poprzek lufy
  TEX.cross = canvasTex(256, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    const d = img.data;
    for (let y = 0; y < s; y++) {
      const v = (y / (s - 1)) * 2 - 1;
      for (let x = 0; x < s; x++) {
        const u = (x / (s - 1)) * 2 - 1;
        const horiz = Math.pow(clamp01(1 - Math.abs(v) / 0.14), 2.0) * Math.pow(clamp01(1 - Math.abs(u)), 1.2);
        const vert = Math.pow(clamp01(1 - Math.abs(u) / 0.22), 2.0) * Math.pow(clamp01(1 - Math.abs(v) / 0.58), 1.6);
        const core = Math.pow(clamp01(1 - Math.sqrt(u * u + v * v) / 0.31), 2.2);
        const i = (y * s + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = clamp01(horiz * 0.92 + vert * 0.45 + core) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });

  // jęzor ognia: jasny u podstawy, rozmyty ku końcowi
  TEX.plume = canvasTex(128, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    const d = img.data;
    for (let y = 0; y < s; y++) {
      const v = 1 - y / (s - 1);           // 0 = wylot (uwzględnia flipY tekstury)
      const along = Math.pow(1 - v, 1.5);
      const width = 0.20 + v * 0.80;
      for (let x = 0; x < s; x++) {
        const u = (x / (s - 1)) * 2 - 1;
        const r = Math.abs(u) / width;
        const across = Math.pow(clamp01(1 - r * r), 1.6);
        const i = (y * s + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = clamp01(along * across) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });

  // kłąb dymu / oparu — szum + maska promieniowa, poszarpane brzegi
  TEX.smoke = canvasTex(256, (ctx, s) => {
    const n = valueNoise(20260919);
    const fbm = (x, y) => {
      let a = 0; let amp = 0.5; let f = 1;
      for (let o = 0; o < 4; o++) { a += n(x * f, y * f) * amp; amp *= 0.5; f *= 2.05; }
      return a / 0.9375;
    };
    const img = ctx.createImageData(s, s);
    const d = img.data;
    const c = (s - 1) / 2;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = (x - c) / c;
        const dy = (y - c) / c;
        const r = Math.sqrt(dx * dx + dy * dy);
        const nv = fbm(x / s * 3.2, y / s * 3.2);
        let a = smoothstep(1.02, 0.15, r);
        a *= 0.30 + 0.95 * nv;
        a *= smoothstep(0.08, 0.42, 1.0 - r * 0.85 + (nv - 0.5) * 0.55);
        const i = (y * s + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = clamp01(a) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });

  TEX.list = [TEX.glow, TEX.flare, TEX.cross, TEX.plume, TEX.smoke];
  return TEX;
}

/* ============================================================================
   PULE I INSTANCING
   ========================================================================== */
class Pool {
  constructor(capacity, fields) {
    this.cap = capacity;
    this.count = 0;
    this.comps = fields;
    this.keys = Object.keys(fields);
    this.f = {};
    for (const k of this.keys) this.f[k] = new Float32Array(capacity * fields[k]);
  }
  spawn() { return this.count < this.cap ? this.count++ : -1; }
  kill(i) {
    const last = --this.count;
    if (i === last) return;
    for (const k of this.keys) {
      const c = this.comps[k];
      const a = this.f[k];
      for (let d = 0; d < c; d++) a[i * c + d] = a[last * c + d];
    }
  }
}

function instancedQuad(attrs, capacity, vertexShader, fragmentShader, uniforms, blending) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const bufs = {};
  for (const [name, size] of attrs) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
    bufs[name] = a;
  }
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    blending,
    depthTest: false,        // pass Ortho układa broń wyłącznie renderOrderem
    depthWrite: false,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { geo, mat, mesh, bufs };
}

/* --- parametry spawnu (obiekt współdzielony, żeby nie śmiecić GC) --------- */
const SP = {};
export function sp() {
  SP.x = SP.y = SP.z = 0;
  SP.vx = SP.vy = SP.vz = 0;
  SP.life = 1; SP.drag = 1;
  SP.s0 = 1; SP.s1 = 2;
  SP.rot = 0; SP.vrot = 0;
  SP.r0 = 1; SP.g0 = 1; SP.b0 = 1;
  SP.r1 = 1; SP.g1 = 1; SP.b1 = 1;
  SP.mix = 4;                 // szybkość przejścia koloru c0 -> c1 (1/s)
  SP.alpha = 1; SP.fadeIn = 0.06; SP.fadeOut = 1.5;
  SP.grow = 0.6;              // <1 = szybki rozrost na starcie
  return SP;
}

/* --- bilboardy: dym, opary, rdzeń rozbłysku, żagwie --------------------- */
const BB_VERT = /* glsl */`
  attribute vec3 iPos;
  attribute vec3 iCol;
  attribute vec3 iData;          // x: rozmiar, y: obrót, z: alfa
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vA;
  void main() {
    vUv = uv; vCol = iCol; vA = iData.z;
    vec4 mv = viewMatrix * vec4(iPos, 1.0);
    float c = cos(iData.y), s = sin(iData.y);
    vec2 p = position.xy * iData.x;
    mv.xy += vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    gl_Position = projectionMatrix * mv;
  }`;
const BB_FRAG = /* glsl */`
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vA;
  void main() {
    vec4 t = texture2D(map, vUv);
    float a = t.a * vA;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vCol * t.rgb, a);
  }`;

class BillboardSystem {
  constructor(scene, texture, blending, capacity, renderOrder = 1) {
    this.p = new Pool(capacity, {
      pos: 3, vel: 3, t: 2, drag: 1, size: 2, rot: 2, c0: 3, c1: 3, mix: 1, a: 3, grow: 1
    });
    const q = instancedQuad(
      [['iPos', 3], ['iCol', 3], ['iData', 3]], capacity,
      BB_VERT, BB_FRAG, { map: { value: texture } }, blending
    );
    Object.assign(this, q);
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'FX3D_BILLBOARDS';
    scene.add(this.mesh);
  }
  spawn(o) {
    const i = this.p.spawn();
    if (i < 0) return;
    const f = this.p.f;
    const i3 = i * 3;
    const i2 = i * 2;
    f.pos[i3] = o.x; f.pos[i3 + 1] = o.y; f.pos[i3 + 2] = o.z;
    f.vel[i3] = o.vx; f.vel[i3 + 1] = o.vy; f.vel[i3 + 2] = o.vz;
    f.t[i2] = 0; f.t[i2 + 1] = o.life;
    f.drag[i] = o.drag;
    f.size[i2] = o.s0; f.size[i2 + 1] = o.s1;
    f.rot[i2] = o.rot; f.rot[i2 + 1] = o.vrot;
    f.c0[i3] = o.r0; f.c0[i3 + 1] = o.g0; f.c0[i3 + 2] = o.b0;
    f.c1[i3] = o.r1; f.c1[i3 + 1] = o.g1; f.c1[i3 + 2] = o.b1;
    f.mix[i] = o.mix;
    f.a[i3] = o.alpha; f.a[i3 + 1] = Math.max(0.002, o.fadeIn); f.a[i3 + 2] = o.fadeOut;
    f.grow[i] = o.grow;
  }
  update(dt) {
    const p = this.p;
    const f = p.f;
    for (let i = p.count - 1; i >= 0; i--) {
      const i2 = i * 2;
      const i3 = i * 3;
      const age = f.t[i2] + dt;
      if (age >= f.t[i2 + 1]) { p.kill(i); continue; }
      f.t[i2] = age;
      const d = Math.exp(-f.drag[i] * dt);
      f.vel[i3] *= d; f.vel[i3 + 1] *= d; f.vel[i3 + 2] *= d;
      f.pos[i3] += f.vel[i3] * dt;
      f.pos[i3 + 1] += f.vel[i3 + 1] * dt;
      f.pos[i3 + 2] += f.vel[i3 + 2] * dt;
      f.rot[i2] += f.rot[i2 + 1] * dt;
    }
    const n = p.count;
    const P = this.bufs.iPos.array;
    const C = this.bufs.iCol.array;
    const D = this.bufs.iData.array;
    for (let i = 0; i < n; i++) {
      const i2 = i * 2;
      const i3 = i * 3;
      const age = f.t[i2];
      const life = f.t[i2 + 1];
      const u = age / life;
      const g = Math.pow(u, f.grow[i]);
      const m = Math.min(1, age * f.mix[i]);
      P[i3] = f.pos[i3]; P[i3 + 1] = f.pos[i3 + 1]; P[i3 + 2] = f.pos[i3 + 2];
      C[i3] = lerp(f.c0[i3], f.c1[i3], m);
      C[i3 + 1] = lerp(f.c0[i3 + 1], f.c1[i3 + 1], m);
      C[i3 + 2] = lerp(f.c0[i3 + 2], f.c1[i3 + 2], m);
      D[i3] = lerp(f.size[i2], f.size[i2 + 1], g);
      D[i3 + 1] = f.rot[i2];
      D[i3 + 2] = f.a[i3] * smoothstep(0, f.a[i3 + 1], u) * Math.pow(1 - u, f.a[i3 + 2]);
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) { this.bufs.iPos.needsUpdate = true; this.bufs.iCol.needsUpdate = true; this.bufs.iData.needsUpdate = true; }
  }
  reset() { this.p.count = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* --- kwady zorientowane -------------------------------------------------
   Jedna klasa, trzy vertex shadery. Różni je wyłącznie sposób ustawienia
   quada w świecie: wzdłuż lufy ku kamerze, wzdłuż lufy na ekranie, płasko
   w płaszczyźnie gry.
   ----------------------------------------------------------------------- */
const ORIENT_HEAD = /* glsl */`
  attribute vec3 iPos;
  attribute vec3 iDir;
  attribute vec3 iCol;
  attribute vec3 iData;          // x: długość, y: szerokość, z: alfa
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vA;
`;

// (a) jęzor ognia — wzdłuż osi lufy, obracany ku kamerze
const PLUME_VERT = ORIENT_HEAD + /* glsl */`
  void main() {
    vUv = uv; vCol = iCol; vA = iData.z;
    vec3 axis = normalize(iDir);
    vec3 toCam = normalize(cameraPosition - iPos);
    vec3 side = cross(axis, toCam);
    float l = length(side);
    side = l > 1e-4 ? side / l : vec3(1.0, 0.0, 0.0);
    vec3 world = iPos + axis * ((position.y + 0.5) * iData.x) + side * (position.x * iData.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;

// (b) krzyż rozbłysku — bilboard obrócony tak, by oś X leżała wzdłuż lufy NA EKRANIE
const CROSS_VERT = ORIENT_HEAD + /* glsl */`
  void main() {
    vUv = uv; vCol = iCol; vA = iData.z;
    vec4 mv = viewMatrix * vec4(iPos, 1.0);
    vec2 a = (mat3(viewMatrix) * normalize(iDir)).xy;
    float l = length(a);
    a = l > 1e-4 ? a / l : vec2(1.0, 0.0);
    vec2 pt = vec2(position.x * iData.x, position.y * iData.y);
    mv.xy += vec2(pt.x * a.x - pt.y * a.y, pt.x * a.y + pt.y * a.x);
    gl_Position = projectionMatrix * mv;
  }`;

// (c) rozlanie światła po poszyciu — leży płasko w płaszczyźnie gry (XY)
// i wybiega do przodu. W demach płaszczyzną było XZ.
const WASH_VERT = ORIENT_HEAD + /* glsl */`
  void main() {
    vUv = uv; vCol = iCol; vA = iData.z;
    vec3 f = vec3(iDir.x, iDir.y, 0.0);
    float l = length(f);
    f = l > 1e-4 ? f / l : vec3(1.0, 0.0, 0.0);
    vec3 r = vec3(-f.y, f.x, 0.0);
    vec3 world = iPos + f * ((position.y + 0.5) * iData.x) + r * (position.x * iData.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;

class OrientedQuadSystem {
  constructor(scene, texture, capacity, vertexShader, renderOrder = 4, fadePow = 2.0, fadeIn = 0.10) {
    this.fadePow = fadePow;
    this.fadeIn = fadeIn;
    this.p = new Pool(capacity, { pos: 3, dir: 3, t: 2, len: 2, wid: 2, col: 3, a: 1 });
    const q = instancedQuad(
      [['iPos', 3], ['iDir', 3], ['iCol', 3], ['iData', 3]], capacity,
      vertexShader, BB_FRAG, { map: { value: texture } }, THREE.AdditiveBlending
    );
    Object.assign(this, q);
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'FX3D_QUADS';
    scene.add(this.mesh);
  }
  spawn(pos, dir, life, l0, l1, w0, w1, col, alpha) {
    const i = this.p.spawn();
    if (i < 0) return;
    const f = this.p.f;
    const i3 = i * 3;
    const i2 = i * 2;
    f.pos[i3] = pos.x; f.pos[i3 + 1] = pos.y; f.pos[i3 + 2] = pos.z;
    f.dir[i3] = dir.x; f.dir[i3 + 1] = dir.y; f.dir[i3 + 2] = dir.z;
    f.t[i2] = 0; f.t[i2 + 1] = life;
    f.len[i2] = l0; f.len[i2 + 1] = l1;
    f.wid[i2] = w0; f.wid[i2 + 1] = w1;
    f.col[i3] = col[0]; f.col[i3 + 1] = col[1]; f.col[i3 + 2] = col[2];
    f.a[i] = alpha;
  }
  update(dt) {
    const p = this.p;
    const f = p.f;
    for (let i = p.count - 1; i >= 0; i--) {
      const i2 = i * 2;
      const age = f.t[i2] + dt;
      if (age >= f.t[i2 + 1]) { p.kill(i); continue; }
      f.t[i2] = age;
    }
    const n = p.count;
    const P = this.bufs.iPos.array;
    const DIR = this.bufs.iDir.array;
    const C = this.bufs.iCol.array;
    const D = this.bufs.iData.array;
    for (let i = 0; i < n; i++) {
      const i2 = i * 2;
      const i3 = i * 3;
      const u = f.t[i2] / f.t[i2 + 1];
      const ease = 1 - Math.pow(1 - u, 2.4);      // szybkie wyrzucenie, wolne dojście
      P[i3] = f.pos[i3]; P[i3 + 1] = f.pos[i3 + 1]; P[i3 + 2] = f.pos[i3 + 2];
      DIR[i3] = f.dir[i3]; DIR[i3 + 1] = f.dir[i3 + 1]; DIR[i3 + 2] = f.dir[i3 + 2];
      C[i3] = f.col[i3]; C[i3 + 1] = f.col[i3 + 1]; C[i3 + 2] = f.col[i3 + 2];
      D[i3] = lerp(f.len[i2], f.len[i2 + 1], ease);
      D[i3 + 1] = lerp(f.wid[i2], f.wid[i2 + 1], ease);
      D[i3 + 2] = f.a[i] * Math.pow(1 - u, this.fadePow) * smoothstep(0, this.fadeIn, u);
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.bufs.iPos.needsUpdate = true; this.bufs.iDir.needsUpdate = true;
      this.bufs.iCol.needsUpdate = true; this.bufs.iData.needsUpdate = true;
    }
  }
  reset() { this.p.count = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* --- łuki elektryczne ----------------------------------------------------
   Łamana między dwoma punktami, przesuwana szumem prostopadle do osi.
   Kształt losuje się na nowo ~30 razy na sekundę, nie co klatkę — dzięki
   temu łuk „trzeszczy" zamiast migotać biało.
   ----------------------------------------------------------------------- */
function hash3(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
}

const _aa = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ad = new THREE.Vector3();

class ArcSystem {
  constructor(scene, capacity = 48, segs = 11, renderOrder = 5) {
    this.segs = segs;
    this.p = new Pool(capacity, { a: 3, b: 3, t: 2, col: 3, jit: 1, seed: 1 });
    const verts = capacity * segs * 2;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, toneMapped: false
    });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = renderOrder;
    this.lines.name = 'FX3D_ARCS';
    scene.add(this.lines);
  }
  spawn(a, b, life, jitter, col) {
    const i = this.p.spawn();
    if (i < 0) return;
    const f = this.p.f;
    const i3 = i * 3;
    const i2 = i * 2;
    f.a[i3] = a.x; f.a[i3 + 1] = a.y; f.a[i3 + 2] = a.z;
    f.b[i3] = b.x; f.b[i3 + 1] = b.y; f.b[i3 + 2] = b.z;
    f.t[i2] = 0; f.t[i2 + 1] = life;
    f.col[i3] = col[0]; f.col[i3 + 1] = col[1]; f.col[i3 + 2] = col[2];
    f.jit[i] = jitter;
    f.seed[i] = (Math.random() * 65535) | 0;
  }
  update(dt, time) {
    const p = this.p;
    const f = p.f;
    for (let i = p.count - 1; i >= 0; i--) {
      const i2 = i * 2;
      const age = f.t[i2] + dt;
      if (age >= f.t[i2 + 1]) { p.kill(i); continue; }
      f.t[i2] = age;
    }
    const n = p.count;
    const segs = this.segs;
    const P = this.posAttr.array;
    const C = this.colAttr.array;
    const step = Math.floor(time * 30);
    let w = 0;
    for (let i = 0; i < n; i++) {
      const i2 = i * 2;
      const i3 = i * 3;
      const u = f.t[i2] / f.t[i2 + 1];
      const seed = f.seed[i];
      const jit = f.jit[i];
      _aa.set(f.a[i3], f.a[i3 + 1], f.a[i3 + 2]);
      _ab.set(f.b[i3], f.b[i3 + 1], f.b[i3 + 2]);
      _ad.subVectors(_ab, _aa);
      const len = _ad.length() || 1e-4;
      _ad.divideScalar(len);
      makeBasis(_ad);
      const bright = Math.pow(1 - u, 1.1) * (0.55 + 0.45 * hash3(seed, 777, step));
      let px = 0; let py = 0; let pz = 0; let pb = 0;
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const env = Math.sin(Math.PI * t);
        const d1 = hash3(seed, k, step) * jit * env;
        const d2 = hash3(seed, k + 91, step) * jit * env;
        const x = _aa.x + _ad.x * len * t + _bx.x * d1 + _by.x * d2;
        const y = _aa.y + _ad.y * len * t + _bx.y * d1 + _by.y * d2;
        const z = _aa.z + _ad.z * len * t + _bx.z * d1 + _by.z * d2;
        const bb = bright * (0.45 + 0.55 * env);
        if (k > 0) {
          P[w * 3] = px; P[w * 3 + 1] = py; P[w * 3 + 2] = pz;
          C[w * 3] = f.col[i3] * pb; C[w * 3 + 1] = f.col[i3 + 1] * pb; C[w * 3 + 2] = f.col[i3 + 2] * pb;
          w++;
          P[w * 3] = x; P[w * 3 + 1] = y; P[w * 3 + 2] = z;
          C[w * 3] = f.col[i3] * bb; C[w * 3 + 1] = f.col[i3 + 1] * bb; C[w * 3 + 2] = f.col[i3 + 2] * bb;
          w++;
        }
        px = x; py = y; pz = z; pb = bb;
      }
    }
    this.geo.setDrawRange(0, w);
    this.lines.visible = w > 0;
    if (w > 0) { this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true; }
  }
  reset() { this.p.count = 0; this.geo.setDrawRange(0, 0); this.lines.visible = false; }
  dispose() {
    this.lines.parent?.remove(this.lines);
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* --- iskry: smugi (LineSegments), głowa jasna, ogon wygaszony ----------- */
class SparkSystem {
  constructor(scene, capacity = 2000, renderOrder = 5) {
    this.cap = capacity;
    // misc: [dł. smugi, faza migotania], cool: [docelowy mnożnik G, B]
    this.p = new Pool(capacity, { pos: 3, vel: 3, t: 2, drag: 1, col: 3, misc: 2, cool: 2 });
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(capacity * 6), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(capacity * 6), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setDrawRange(0, 0);
    this.mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, toneMapped: false
    });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = renderOrder;
    this.lines.name = 'FX3D_SPARKS';
    this.geo = geo;
    scene.add(this.lines);
  }
  spawn(pos, vel, life, drag, streak, col, coolG = 0.32, coolB = 0.06) {
    const i = this.p.spawn();
    if (i < 0) return;
    const f = this.p.f;
    const i3 = i * 3;
    const i2 = i * 2;
    f.pos[i3] = pos.x; f.pos[i3 + 1] = pos.y; f.pos[i3 + 2] = pos.z;
    f.vel[i3] = vel.x; f.vel[i3 + 1] = vel.y; f.vel[i3 + 2] = vel.z;
    f.t[i2] = 0; f.t[i2 + 1] = life;
    f.drag[i] = drag;
    f.col[i3] = col[0]; f.col[i3 + 1] = col[1]; f.col[i3 + 2] = col[2];
    f.misc[i2] = streak; f.misc[i2 + 1] = Math.random() * 6.28;
    f.cool[i2] = coolG; f.cool[i2 + 1] = coolB;
  }
  update(dt, time) {
    const p = this.p;
    const f = p.f;
    for (let i = p.count - 1; i >= 0; i--) {
      const i2 = i * 2;
      const i3 = i * 3;
      const age = f.t[i2] + dt;
      if (age >= f.t[i2 + 1]) { p.kill(i); continue; }
      f.t[i2] = age;
      const d = Math.exp(-f.drag[i] * dt);
      f.vel[i3] *= d; f.vel[i3 + 1] *= d; f.vel[i3 + 2] *= d;
      f.pos[i3] += f.vel[i3] * dt;
      f.pos[i3 + 1] += f.vel[i3 + 1] * dt;
      f.pos[i3 + 2] += f.vel[i3 + 2] * dt;
    }
    const n = p.count;
    const P = this.posAttr.array;
    const C = this.colAttr.array;
    for (let i = 0; i < n; i++) {
      const i2 = i * 2;
      const i3 = i * 3;
      const o = i * 6;
      const u = f.t[i2] / f.t[i2 + 1];
      const vx = f.vel[i3];
      const vy = f.vel[i3 + 1];
      const vz = f.vel[i3 + 2];
      const sp2 = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1e-6;
      const len = Math.min(sp2 * 0.022, f.misc[i2]) * (0.35 + 0.65 * (1 - u));
      P[o] = f.pos[i3]; P[o + 1] = f.pos[i3 + 1]; P[o + 2] = f.pos[i3 + 2];
      P[o + 3] = f.pos[i3] - vx / sp2 * len;
      P[o + 4] = f.pos[i3 + 1] - vy / sp2 * len;
      P[o + 5] = f.pos[i3 + 2] - vz / sp2 * len;
      // stygnięcie: proch biało-żółty -> pomarańcz -> czerwień; jony zostają błękitne
      const flick = 0.72 + 0.28 * Math.sin(time * 42 + f.misc[i2 + 1]);
      const b = Math.pow(1 - u, 1.5) * flick;
      const cool = smoothstep(0.1, 0.85, u);
      C[o] = f.col[i3] * b;
      C[o + 1] = f.col[i3 + 1] * b * lerp(1, f.cool[i2], cool);
      C[o + 2] = f.col[i3 + 2] * b * lerp(1, f.cool[i2 + 1], cool);
      C[o + 3] = C[o + 4] = C[o + 5] = 0;   // ogon gaśnie do zera (blending additive)
    }
    this.geo.setDrawRange(0, n * 2);
    this.lines.visible = n > 0;
    if (n > 0) { this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true; }
  }
  reset() { this.p.count = 0; this.geo.setDrawRange(0, 0); this.lines.visible = false; }
  dispose() {
    this.lines.parent?.remove(this.lines);
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ============================================================================
   BANK — jeden komplet pul dla wszystkich efektów.
   Pojemności pod bitwę flot: błyski wylotowe lecą z kilkudziesięciu luf naraz,
   więc pule iskier i poświaty są największe. Po zapełnieniu `spawn()` po prostu
   odpuszcza cząstkę — nigdy nie rośnie w trakcie walki.
   ========================================================================== */
const CAPACITY = {
  smoke: 2200,
  vapor: 1200,
  glow: 3200,
  star: 128,
  wash: 96,
  plume: 192,
  cross: 128,
  spark: 5200,
  arcs: 128
};

const updaters = [];

export const Fx3D = {
  enabled: true,
  time: 0,
  // Długość ostatniej klatki banku. Efekty, które rodzą cząstki
  // W TRAKCIE aktualizacji gry (czyli zanim bank przesunie zegar), muszą
  // szacować czas końca klatki z TEGO zegara — dt z pętli gry idzie
  // z innego pomiaru i po tysiącach klatek rozjeżdża się z `time`.
  lastDt: 1 / 60,
  smoke: null, vapor: null, glow: null, star: null,
  wash: null, plume: null, cross: null, spark: null, arcs: null,

  get available() {
    return this.enabled === true && Core3D.isInitialized === true && !!Core3D.scene;
  },

  get ready() { return this.glow !== null; },

  ensure() {
    if (this.glow) return true;
    if (!this.available) return false;
    const scene = Core3D.scene;
    const tex = makeTextures();
    this.smoke = new BillboardSystem(scene, tex.smoke, THREE.NormalBlending, CAPACITY.smoke, RENDER_ORDER.smoke);
    this.vapor = new BillboardSystem(scene, tex.smoke, THREE.AdditiveBlending, CAPACITY.vapor, RENDER_ORDER.vapor);
    this.glow = new BillboardSystem(scene, tex.glow, THREE.AdditiveBlending, CAPACITY.glow, RENDER_ORDER.glow);
    this.star = new BillboardSystem(scene, tex.flare, THREE.AdditiveBlending, CAPACITY.star, RENDER_ORDER.star);
    this.wash = new OrientedQuadSystem(scene, tex.plume, CAPACITY.wash, WASH_VERT, RENDER_ORDER.wash, 1.7);
    this.plume = new OrientedQuadSystem(scene, tex.plume, CAPACITY.plume, PLUME_VERT, RENDER_ORDER.plume, 2.0);
    this.cross = new OrientedQuadSystem(scene, tex.cross, CAPACITY.cross, CROSS_VERT, RENDER_ORDER.cross, 2.6);
    this.spark = new SparkSystem(scene, CAPACITY.spark, RENDER_ORDER.spark);
    this.arcs = new ArcSystem(scene, CAPACITY.arcs, 13, RENDER_ORDER.arcs);
    // Żar, błyski, iskry i łuki świecą — warstwa emisji Core3D (po shadow
    // shafts), żeby cień planety nie gasił ich bloomu. Dym (NormalBlending)
    // to oświetlona materia: zostaje w passie ortho i przyjmuje cień.
    // Poświata na poszyciu (wash, 84) rysuje się teraz nad dymem (85).
    for (const sys of [this.vapor, this.glow, this.star, this.wash, this.plume, this.cross]) {
      Core3D.enableOrthoEmissive3D(sys.mesh);
    }
    Core3D.enableOrthoEmissive3D(this.spark.lines);
    Core3D.enableOrthoEmissive3D(this.arcs.lines);
    return true;
  },

  // Dodatkowa praca per klatka wykonywana PO aktualizacji pul i przesunięciu
  // zegara — tędy smuga Hexlance'a wpina swój bufor GPU.
  addUpdater(fn) {
    if (typeof fn === 'function' && !updaters.includes(fn)) updaters.push(fn);
  },

  // Wołane DOKŁADNIE RAZ na klatkę renderu (Weapon3DSystem.syncProjectiles).
  update(dt) {
    if (!this.glow) return;
    const step = Math.min(Math.max(0, Number(dt) || 0), 0.1);
    this.time += step;
    this.lastDt = step;
    const t = this.time;
    this.smoke.update(step);
    this.vapor.update(step);
    this.glow.update(step);
    this.star.update(step);
    this.wash.update(step);
    this.plume.update(step);
    this.cross.update(step);
    this.spark.update(step, t);
    this.arcs.update(step, t);
    for (let i = 0; i < updaters.length; i++) updaters[i](step, t);
  },

  get systems() {
    return this.glow
      ? [this.smoke, this.vapor, this.glow, this.star, this.wash, this.plume, this.cross, this.spark, this.arcs]
      : [];
  },

  get particles() {
    let n = 0;
    for (const s of this.systems) n += s.p.count;
    return n;
  },

  // Siatki do wymuszenia kompilacji shaderów na ekranie ładowania.
  get meshes() {
    return this.glow
      ? [this.smoke.mesh, this.vapor.mesh, this.glow.mesh, this.star.mesh,
        this.wash.mesh, this.plume.mesh, this.cross.mesh, this.spark.lines, this.arcs.lines]
      : [];
  },

  reset() { for (const s of this.systems) s.reset(); },

  dispose() {
    for (const s of this.systems) s.dispose();
    this.smoke = this.vapor = this.glow = this.star = null;
    this.wash = this.plume = this.cross = this.spark = this.arcs = null;
    updaters.length = 0;
    this.time = 0;
    for (const t of TEX.list) t.dispose();
    TEX.glow = TEX.flare = TEX.cross = TEX.plume = TEX.smoke = null;
    TEX.list = [];
  }
};

if (typeof window !== 'undefined') window.Fx3D = Fx3D;
