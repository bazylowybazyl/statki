// Parzystość tarcz GLSL ↔ TSL (port WebGPU, zadanie 14). Te same geometrie i te same
// wartości uniformów rysowane raz przez GLSL z tagu webgl-baseline (WebGLRenderer —
// napisy shaderów podaje runner w window.__tarczeGlsl; w repo nie ma już GLSL) i raz przez
// materiały TSL gry (WebGPURenderer, highPrecision jak Core3D), do celów RGBA32F bez MSAA.
// Porównanie liniowego HDR (Δ) i obrazu po ACES gry + sRGB (jak harness: % pikseli > 2/255,
// > 8/255). Plus test `uniformArray` per obiekt: wspólny węzeł tablicy w dwóch materiałach
// jednego grafu — z pakowaniem w onObjectUpdate i bez (domyślne pakowanie RENDER).
// Wynik: window.__parz. Uruchamia scripts/webgpu/tarcze-parzystosc.mjs.
import * as THREE from 'three';
import * as TW from 'three/webgpu';
import { Fn, int, vec4, uniformArray } from 'three/tsl';
import {
  createSphereShieldMaterialForTools, createHullShieldMaterialForTools, buildHullShieldGeometryForTools
} from '../../src/3d/shield3D.js';
import { ShieldImpactFX } from '../../src/3d/shieldImpactFx.js';
import { SHIELD_TSL_STATS } from '../../src/3d/shield3D.tsl.js';
import { sampleShieldProfileRadius } from '../../shieldSystem.js';
import { acesGryCpu, linearDoSrgbCpu } from '../../src/3d/tsl/kolorGry.js';

const W = 512;
const H = 512;
const state = { done: false, error: null, results: {}, images: {}, meta: {}, uniformArrayTest: null };
window.__parz = state;
const logEl = document.getElementById('log');
const log = (s) => { logEl.textContent += '\n' + s; };
const GLSL = window.__tarczeGlsl;

// Deterministyczne losowanie (emisja cząstek) — mulberry32.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(0x7a14);

// ── Renderery ─────────────────────────────────────────────────────────────────
function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return c;
}
const gl = new THREE.WebGLRenderer({ canvas: makeCanvas(), antialias: false, alpha: true });
gl.outputColorSpace = THREE.LinearSRGBColorSpace;
gl.toneMapping = THREE.NoToneMapping;
gl.setPixelRatio(1);
gl.setSize(W, H, false);
const gpu = new TW.WebGPURenderer({ canvas: makeCanvas(), antialias: false, alpha: true });
gpu.outputColorSpace = THREE.LinearSRGBColorSpace;
gpu.toneMapping = THREE.NoToneMapping;
gpu.highPrecision = true; // jak Core3D (modelViewMatrix liczona na CPU)
gpu.setPixelRatio(1);
gpu.setSize(W, H, false);

// Kamera jak Core3D.cameraOrtho: ortho nad (x, −y) na z = 150 000.
function makeCamera(cx, cy, zoom) {
  const hw = (W / 2) / zoom;
  const hh = (H / 2) / zoom;
  const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 1, 400000);
  cam.position.set(cx, -cy, 150000);
  cam.layers.enableAll();
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

async function renderBoth(sGL, sGPU, cam) {
  const rtGL = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: true });
  gl.setRenderTarget(rtGL);
  gl.setClearColor(0x000000, 0);
  gl.clear(true, true, true);
  gl.render(sGL, cam);
  const rawGL = new Float32Array(W * H * 4);
  gl.readRenderTargetPixels(rtGL, 0, 0, W, H, rawGL);
  gl.setRenderTarget(null);
  rtGL.dispose();
  // WebGL: wiersz 0 = dół → odwracam do układu WebGPU (wiersz 0 = góra).
  const a = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) a.set(rawGL.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);

  const rtGPU = new TW.RenderTarget(W, H, { type: THREE.FloatType, depthBuffer: true });
  gpu.setRenderTarget(rtGPU);
  gpu.setClearColor(0x000000, 0);
  gpu.clear();
  gpu.render(sGPU, cam);
  const raw = await gpu.readRenderTargetPixelsAsync(rtGPU, 0, 0, W, H);
  gpu.setRenderTarget(null);
  rtGPU.dispose();
  const rowFloats = raw.length / H; // wiersze wyrównane do 256 B
  const b = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) b.set(raw.subarray(y * rowFloats, y * rowFloats + W * 4), y * W * 4);
  return { a, b };
}

const to8 = (v) => Math.round(Math.max(0, Math.min(1, linearDoSrgbCpu(acesGryCpu(v)))) * 255);

function compare(name, a, b) {
  let maxAbs = 0; let sumAbs = 0; let nanA = 0; let nanB = 0; let over2 = 0; let over8 = 0; let lit = 0;
  let energyA = 0; let energyB = 0;
  const diffs = [];
  const img = new Uint8ClampedArray(W * 3 * H * 4);
  for (let p = 0; p < W * H; p++) {
    let pixMax8 = 0;
    let pixLit = false;
    for (let c = 0; c < 3; c++) {
      const va = a[p * 4 + c];
      const vb = b[p * 4 + c];
      if (!Number.isFinite(va)) nanA++;
      if (!Number.isFinite(vb)) nanB++;
      const d = Math.abs(va - vb);
      if (Number.isFinite(d)) { if (d > maxAbs) maxAbs = d; sumAbs += d; diffs.push(d); }
      energyA += Number.isFinite(va) ? va : 0;
      energyB += Number.isFinite(vb) ? vb : 0;
      if (va > 1e-4 || vb > 1e-4) pixLit = true;
      const ea = to8(va); const eb = to8(vb);
      pixMax8 = Math.max(pixMax8, Math.abs(ea - eb));
      const row = Math.floor(p / W); const col = p % W;
      const o = (row * W * 3 + col) * 4;
      img[o + c] = ea;
      img[o + W * 4 + c] = eb;
      img[o + W * 8 + c] = Math.min(255, Math.abs(ea - eb) * 8);
    }
    const row = Math.floor(p / W); const col = p % W;
    const o = (row * W * 3 + col) * 4;
    img[o + 3] = 255; img[o + W * 4 + 3] = 255; img[o + W * 8 + 3] = 255;
    if (pixLit) lit++;
    if (pixMax8 > 2) over2++;
    if (pixMax8 > 8) over8++;
  }
  diffs.sort((x, y) => x - y);
  const q = (f) => (diffs.length ? diffs[Math.min(diffs.length - 1, Math.floor(diffs.length * f))] : 0);
  const r = {
    maxAbs, meanAbs: sumAbs / Math.max(1, diffs.length), p999: q(0.999), p9999: q(0.9999),
    litPx: lit, over2Pct: 100 * over2 / (W * H), over8Pct: 100 * over8 / (W * H),
    over2PctLit: lit ? 100 * over2 / lit : 0, over8PctLit: lit ? 100 * over8 / lit : 0,
    energyGL: energyA, energyGPU: energyB, energyRel: energyA > 0 ? (energyB - energyA) / energyA : 0, nanGL: nanA, nanGPU: nanB
  };
  state.results[name] = r;
  const cv = document.createElement('canvas');
  cv.width = W * 3; cv.height = H;
  cv.getContext('2d').putImageData(new ImageData(img, W * 3, H), 0, 0);
  state.images[name] = cv.toDataURL('image/png');
  log(`${name}: max ${r.maxAbs.toExponential(2)} śr ${r.meanAbs.toExponential(2)} >2/255 ${r.over2Pct.toFixed(3)}% (świeci ${lit}) energia ${(r.energyRel * 100).toFixed(4)}% NaN ${nanA}/${nanB}`);
  return r;
}

// ── Tarcze ────────────────────────────────────────────────────────────────────
function cloneUniforms(u) {
  const out = {};
  for (const [k, e] of Object.entries(u)) {
    const v = e.value;
    out[k] = { value: Array.isArray(v) ? v.map((x) => (x && x.clone ? x.clone() : x)) : (v && v.clone ? v.clone() : v) };
  }
  return out;
}

function glslMaterial(tslMaterial, vertexShader, fragmentShader) {
  return new THREE.ShaderMaterial({
    uniforms: cloneUniforms(tslMaterial.uniforms), vertexShader, fragmentShader,
    transparent: true, depthWrite: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending
  });
}

// Profil obrysu: wydłużony kadłub z garbami (jak okręty), maxR/minR skanem jak shieldSystem.
function makeProfile(a = 420, b = 170, n = 64) {
  const bins = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    bins[i] = (a * b) / Math.hypot(b * Math.cos(t), a * Math.sin(t)) + 14 * Math.sin(5 * t) + 30;
  }
  const profile = { bins, binCount: n, maxR: 0, minR: Infinity, pad: 30 };
  for (let i = 0; i < n * 4; i++) {
    const r = sampleShieldProfileRadius(profile, (i / (n * 4)) * Math.PI * 2);
    if (r > profile.maxR) profile.maxR = r;
    if (r < profile.minR) profile.minR = r;
  }
  return profile;
}

const T = 1000.37;               // zegar tarcz (s) jak performance.now()/1000
const PROFILE = makeProfile();
const HULL_GEO = buildHullShieldGeometryForTools(PROFILE);

// Stan jak updateHullShieldMesh: trafienia w klatce profilu, strojenie SHIELD_FIELD_TUNING.
function hullState(u, o) {
  u.uTime.value = T;
  u.uLife.value = o.life ?? 1;
  u.uReveal.value = o.reveal ?? 0;
  u.uIsBreaking.value = o.breaking ? 1 : 0;
  u.uEnergyShot.value = o.energy ?? 0;
  u.uFieldVisibility.value = o.field ?? 0;
  u.uSweep.value = o.sweep ?? -1;
  u.uLowPower.value = o.lowPower ?? 0;
  u.uHitOpacity.value = 0.9;
  u.uHitDecay.value = 3.4;
  u.uOpacity.value = 0.3;
  if (o.color) u.uColor.value.set(o.color);
  const hits = o.hits || [];
  for (let i = 0; i < 24; i++) {
    const h = hits[i];
    if (h) {
      const r = sampleShieldProfileRadius(PROFILE, h.a);
      u.uHitPos.value[i].set(Math.cos(h.a) * r, -Math.sin(h.a) * r, 0);
      u.uHitTime.value[i] = T - h.age;
    } else {
      u.uHitTime.value[i] = -999;
    }
  }
}

function hullScene(defs) {
  const sGL = new THREE.Scene();
  const sGPU = new THREE.Scene();
  for (const d of defs) {
    const mT = createHullShieldMaterialForTools(PROFILE);
    hullState(mT.uniforms, d);
    const mG = glslMaterial(mT, GLSL.HULL_SHIELD_VERTEX, GLSL.HULL_SHIELD_FRAGMENT);
    for (const [scene, mat] of [[sGL, mG], [sGPU, mT]]) {
      const m = new THREE.Mesh(HULL_GEO, mat);
      m.position.set(d.x, -d.y, 1);
      m.rotation.set(0, 0, -(d.angle || 0));
      m.renderOrder = 10;
      m.frustumCulled = false;
      scene.add(m);
    }
  }
  return { sGL, sGPU };
}

const SPHERE_GEO = new THREE.SphereGeometry(1.8, 32, 32);
function sphereScene(d) {
  const sGL = new THREE.Scene();
  const sGPU = new THREE.Scene();
  const mT = createSphereShieldMaterialForTools();
  const u = mT.uniforms;
  u.uTime.value = T;
  u.uLife.value = d.life ?? 1;
  u.uReveal.value = d.reveal ?? 0;
  u.uIsBreaking.value = d.breaking ? 1 : 0;
  u.uEnergyShot.value = d.energy ?? 0;
  const visualAngle = d.angle || 0;
  for (let i = 0; i < 24; i++) {
    const h = (d.hits || [])[i];
    if (h) {
      const a = h.a + visualAngle;
      u.uHitPos.value[i].set(Math.cos(a) * 1.8, 0, -Math.sin(a) * 1.8);
      u.uHitTime.value[i] = T - h.age;
    } else {
      u.uHitTime.value[i] = -999;
    }
  }
  const mG = glslMaterial(mT, GLSL.SHIELD_VERTEX, GLSL.SHIELD_FRAGMENT);
  const s = d.radius / 1.8;
  for (const [scene, mat] of [[sGL, mG], [sGPU, mT]]) {
    const m = new THREE.Mesh(SPHERE_GEO, mat);
    m.scale.set(s, s, s);
    m.position.set(d.x, -d.y, 1);
    m.rotation.set(Math.PI / 2, -visualAngle, 0);
    m.renderOrder = 10;
    m.frustumCulled = false;
    scene.add(m);
  }
  return { sGL, sGPU };
}

// ── Wstęgi i bańki trafień ──────────────────────────────────────────────────
const FX_ROOT_SCENE = new THREE.Scene();
let fxGL = null;
function fxScenes() {
  ShieldImpactFX.init(FX_ROOT_SCENE);
  const root = FX_ROOT_SCENE.children[0];
  const ribbons = root.children.find((c) => c.material?.uniforms?.uTrailScale);
  const flash = root.children.find((c) => c !== ribbons);
  if (!fxGL) {
    const ribbonMat = new THREE.ShaderMaterial({
      vertexShader: GLSL.FX_VERTEX, fragmentShader: GLSL.FX_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uTrailScale: { value: 1 }, uMinHalfWidth: { value: 0.5 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide
    });
    const flashMat = new THREE.ShaderMaterial({
      vertexShader: GLSL.FLASH_VERTEX, fragmentShader: GLSL.FLASH_FRAGMENT,
      uniforms: { uTime: { value: 0 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide
    });
    const group = new THREE.Group();
    const rm = new THREE.Mesh(ribbons.geometry, ribbonMat);
    const fm = new THREE.Mesh(flash.geometry, flashMat);
    rm.renderOrder = ribbons.renderOrder; fm.renderOrder = flash.renderOrder;
    rm.frustumCulled = false; fm.frustumCulled = false;
    group.add(rm, fm);
    const scene = new THREE.Scene();
    scene.add(group);
    fxGL = { scene, group, rm, fm, ribbonMat, flashMat };
  }
  // Wartości z materiałów TSL (po ShieldImpactFX.update) → GLSL.
  fxGL.group.position.copy(root.position);
  fxGL.ribbonMat.uniforms.uTime.value = ribbons.material.uniforms.uTime.value;
  fxGL.ribbonMat.uniforms.uTrailScale.value = ribbons.material.uniforms.uTrailScale.value;
  fxGL.ribbonMat.uniforms.uMinHalfWidth.value = ribbons.material.uniforms.uMinHalfWidth.value;
  fxGL.flashMat.uniforms.uTime.value = flash.material.uniforms.uTime.value;
  fxGL.rm.visible = ribbons.visible;
  fxGL.fm.visible = flash.visible;
  return { sGL: fxGL.scene, sGPU: FX_ROOT_SCENE, ribbons, flash };
}

// ── Test uniformArray per obiekt (wspólny węzeł tablicy w dwóch materiałach) ────
async function uniformArrayTest(perObject) {
  const node = uniformArray([new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()], 'vec4');
  if (perObject) {
    node.onObjectUpdate((frame, n) => {
      const data = frame?.material?.userData?.data;
      const out = n.value;
      if (!data || !out || typeof out.length !== 'number') return undefined;
      for (let i = 0; i < 3; i++) { out[i * 4] = data[i].x; out[i * 4 + 1] = data[i].y; out[i * 4 + 2] = data[i].z; out[i * 4 + 3] = data[i].w; }
      return undefined;
    });
  }
  const frag = Fn(() => vec4(node.element(int(2)).xyz, 1.0))();
  const scene = new THREE.Scene();
  const geo = new THREE.PlaneGeometry(200, 200);
  const colors = [new THREE.Vector4(1, 0, 0, 1), new THREE.Vector4(0, 1, 0, 1)];
  const mats = [];
  for (let k = 0; k < 2; k++) {
    const m = new TW.NodeMaterial();
    m.fragmentNode = frag;
    m.userData.data = [new THREE.Vector4(), new THREE.Vector4(), colors[k]];
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(k === 0 ? -150 : 150, 0, 0);
    // Bez onObjectUpdate materiał podmienia tablicę węzła przed swoim rysowaniem —
    // pakowanie RENDER i tak dzieje się raz na render().
    if (!perObject) mesh.onBeforeRender = () => { node.array = m.userData.data; };
    scene.add(mesh);
    mats.push(m);
  }
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 1, 1000);
  cam.position.set(0, 0, 500);
  cam.updateMatrixWorld(true);
  const rt = new TW.RenderTarget(W, H, { type: THREE.FloatType });
  gpu.setRenderTarget(rt);
  gpu.setClearColor(0x000000, 0);
  gpu.render(scene, cam);
  const raw = await gpu.readRenderTargetPixelsAsync(rt, 0, 0, W, H);
  gpu.setRenderTarget(null);
  rt.dispose();
  const rowFloats = raw.length / H;
  const px = (x, y) => { const o = y * rowFloats + x * 4; return [raw[o], raw[o + 1], raw[o + 2]].map((v) => +v.toFixed(3)); };
  const keyA = mats[0].customProgramCacheKey();
  const keyB = mats[1].customProgramCacheKey();
  return { perObject, left: px(W / 2 - 150, H / 2), right: px(W / 2 + 150, H / 2), sameProgramKey: keyA === keyB };
}

// ── Przebieg ─────────────────────────────────────────────────────────────────
try {
  if (!GLSL) throw new Error('brak window.__tarczeGlsl (runner podaje GLSL z tagu)');
  await gpu.init();
  state.meta.webgpu = !!gpu.backend?.isWebGPUBackend;
  state.meta.glsl = 'tag webgl-baseline (src/3d/shield3D.js, src/3d/shieldImpactFx.js)';
  state.meta.tsl = 'src/3d/shield3D.tsl.js, src/3d/shieldImpactFx.js';
  state.meta.rozmiar = `${W}x${H}`;
  state.meta.profil = { maxR: PROFILE.maxR, minR: PROFILE.minR };

  // uniformArray: z pakowaniem per obiekt i bez.
  state.uniformArrayTest = [await uniformArrayTest(true), await uniformArrayTest(false)];
  log('uniformArray: ' + JSON.stringify(state.uniformArrayTest));

  const X = 6210000; const Y = 5330000; // okolica DEEP z harnessu (duże współrzędne świata)
  const zoom = 0.5;
  const hits5 = [{ a: 0.3, age: 0.02 }, { a: 1.2, age: 0.09 }, { a: 2.5, age: 0.25 }, { a: 3.9, age: 0.6 }, { a: 5.1, age: 1.05 }];
  const hullCases = {
    'obrys-trafienia': [{ x: X, y: Y, angle: 0.4, life: 0.8, hits: hits5 }],
    'obrys-rozruch': [{ x: X, y: Y, angle: 0.4, field: 1, sweep: 0.55 }],
    'obrys-domkniecie': [{ x: X, y: Y, angle: 0.4, field: 0.6, sweep: 1.25 }],
    'obrys-pekniecie': [{ x: X, y: Y, angle: 0.4, breaking: true, reveal: 0.35, field: 1, sweep: -1, life: 0 }],
    'obrys-agonia-energia': [{ x: X, y: Y, angle: 0.4, life: 0.2, lowPower: 0.8, energy: 0.6, hits: hits5.slice(0, 2) }],
    // Dwie tarcze jednego grafu w jednym renderze, różne trafienia i HP — pakowanie per obiekt.
    'dwie-tarcze': [
      { x: X - 330, y: Y, angle: 0.2, life: 1, hits: [{ a: 0.2, age: 0.05 }, { a: 0.9, age: 0.3 }] },
      { x: X + 330, y: Y, angle: -0.3, life: 0.25, hits: [{ a: 3.3, age: 0.12 }, { a: 4.4, age: 0.5 }, { a: 5.6, age: 0.8 }] }
    ]
  };
  for (const [name, defs] of Object.entries(hullCases)) {
    const zoomCase = name === 'dwie-tarcze' ? 0.3 : zoom;
    const { sGL, sGPU } = hullScene(defs);
    const { a, b } = await renderBoth(sGL, sGPU, makeCamera(X, Y, zoomCase));
    compare(name, a, b);
  }

  const sphereCases = {
    'sfera-trafienia': { x: X, y: Y, radius: 300, angle: 0.7, life: 0.9, hits: [{ a: 0.4, age: 0.03 }, { a: 2.1, age: 0.2 }, { a: 3.5, age: 0.55 }, { a: 5.0, age: 1.1 }] },
    'sfera-pekniecie': { x: X, y: Y, radius: 300, angle: 0.7, breaking: true, reveal: 0.45, life: 0 }
  };
  for (const [name, d] of Object.entries(sphereCases)) {
    const { sGL, sGPU } = sphereScene(d);
    const { a, b } = await renderBoth(sGL, sGPU, makeCamera(X, Y, zoom));
    compare(name, a, b);
  }

  // Wstęgi i bańki: cztery klasy trafień wokół punktu, klatka po 0,12 s; potem LOD z daleka.
  ShieldImpactFX.init(FX_ROOT_SCENE);
  const col = new THREE.Color('#5992f7');
  const red = new THREE.Color(1, 0.3, 0.2);
  const t0 = 500;
  const emits = [
    { preset: 'main', x: X - 180, y: Y - 60, nx: -1, ny: 0, radius: 320, color: col, power: 1.0 },
    { preset: 'special', x: X + 150, y: Y + 40, nx: 0.8, ny: 0.6, radius: 380, color: col, power: 1.6 },
    { preset: 'pd', x: X, y: Y - 200, nx: 0, ny: -1, radius: 300, color: red, power: 0.7 },
    { preset: 'shield', x: X + 40, y: Y + 210, nx: 0.1, ny: 1, radius: 340, color: col, power: 1.2, vx: 120, vy: -40 }
  ];
  for (const e of emits) ShieldImpactFX.emit({ ...e, lod: 1, time: t0 });
  ShieldImpactFX.update(t0 + 0.12, 1.0);
  {
    const { sGL, sGPU } = fxScenes();
    const { a, b } = await renderBoth(sGL, sGPU, makeCamera(X, Y, 1.0));
    compare('wstegi-banki', a, b);
  }
  ShieldImpactFX.update(t0 + 0.3, 0.2);
  {
    const { sGL, sGPU } = fxScenes();
    const { a, b } = await renderBoth(sGL, sGPU, makeCamera(X, Y, 0.45));
    compare('wstegi-lod', a, b);
  }
  state.meta.fxStats = { ...ShieldImpactFX.stats };
  state.meta.shieldStats = JSON.parse(JSON.stringify(SHIELD_TSL_STATS));
  state.done = true;
  log('gotowe');
} catch (err) {
  state.error = String(err?.stack || err);
  state.done = true;
  log('BŁĄD ' + state.error);
}
