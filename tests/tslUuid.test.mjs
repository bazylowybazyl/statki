// Pułapka 38 (2026-10-09): three r183 skleja węzły w budowie programu po uuid (Node.getShared, UniformNode.generate —
// słownik buildera hashNodes), a uuid to 4 × Math.random. Harness (scripts/webgpu/harness-strona.js) ma Math.random
// z ziarnem i reseed — węzeł zbudowany po reseed tym samym ziarnem dostawał uuid starszego węzła i w WGSL jego kod
// (sonda gazu: `vec3(f32(instanceIndex))` zamiast uvw, stała 0.5 zamiast przesunięcia slotu). Łata Core3D:
// src/3d/tsl/uuidWezlow.js (uuid węzła z licznikiem + strażnik kolizji węzłów, uniformów i tekstur).
// node --test tests/tslUuid.test.mjs  (TSL_UUID_BEZ_LATY=1 — ten sam test bez łaty: przypadki skażenia mają paść)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
if (process.env.TSL_UUID_BEZ_LATY) globalThis.__TSL_UUID_NAPRAWA = false;
const THREE = await import('three/webgpu');
const { Fn, float, instanceIndex, instancedArray, positionLocal, texture, uniform, vec2, vec3 } = await import('three/tsl');
const { tslUuidStan } = await import('../src/3d/tsl/uuidWezlow.js');

const readModule = (spec) => readFileSync(fileURLToPath(import.meta.resolve(spec)), 'utf8').replace(/\r\n/g, '\n');

// Math.random z ziarnem jak w harnessie (mulberry32): reseed(v) tym samym ziarnem odtwarza ciąg.
let s = 0;
let calls = 0;
const reseed = (v) => { s = v >>> 0; };
Math.random = () => {
  calls++;
  s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
// Strażnik zgłasza kolizję przez console.error — w teście cicho.
const quiet = (fn) => {
  const err = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = err; }
};
const buildCompute = (node) => quiet(() => {
  const b = renderer.backend.createNodeBuilder(node, renderer);
  b.build();
  return b.computeShader;
});
const buildFragment = (material) => quiet(() => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return b.fragmentShader;
});
const out = instancedArray(64, 'float').setName('tslUuidOut');

test('kernel zbudowany po reseed: stała zostaje stałą (minimalny przypadek pułapki 38)', () => {
  reseed(1234);
  const a = float(instanceIndex); // „przy starcie strony”
  reseed(1234); // harness: reseed(to samo ziarno)
  const c = float(0.0104166); // „po starcie”: nowy węzeł — bez łaty dostawał uuid węzła `a`
  assert.notEqual(c.uuid, a.uuid, 'uuid węzła po reseed nie może powtórzyć uuid starszego węzła');
  const wgsl = buildCompute(Fn(() => { out.element(instanceIndex).assign(a.add(c)); })().compute(64));
  assert.match(wgsl, /\( f32\( instanceIndex \) \+ 0\.0104166 \)/, 'w WGSL stała 1/N, nie drugi f32(instanceIndex)');
});

test('materiał zbudowany po reseed: stała w shaderze fragmentów', () => {
  reseed(99);
  const a = float(positionLocal.y);
  reseed(99);
  const c = float(0.75);
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = vec3(a.add(c), 0, 0);
  const frag = buildFragment(m);
  assert.match(frag, /0\.75/, 'stała 0.75 w shaderze fragmentów');
});

test('łata nie zmienia ciągu Math.random: te same 4 losowania na węzeł, uuid = uuid three + licznik', () => {
  if (process.env.TSL_UUID_BEZ_LATY) return;
  reseed(77);
  const o = new THREE.Object3D().uuid; // Object3D: generateUUID importowane wprost (bez łaty)
  reseed(77);
  const c0 = calls;
  const n = new THREE.Node();
  assert.equal(calls - c0, 4, 'węzeł zużywa 4 losowania jak w three — ciąg gry w harnessie (bazy zrzutów) bez zmian');
  assert.ok(n.uuid.startsWith(o + '-'), `uuid węzła = uuid three z tych samych losowań + licznik (${n.uuid} / ${o})`);
  assert.match(n.uuid.slice(o.length + 1), /^[0-9a-z]+$/);
});

test('three r183: Node bierze uuid z MathUtils.generateUUID, wspólny słownik buildera — założenia łaty', () => {
  const src = readModule('three/webgpu');
  assert.match(src, /class Node extends EventDispatcher[\s\S]{0,4000}?this\.uuid = MathUtils\.generateUUID\(\);/,
    'Node: uuid z MathUtils.generateUUID (obiekt — łata go podmienia); import wprost = łata 1 nic nie robi');
  assert.match(src, /getShared\( builder \) \{\s*const hash = this\.getHash\( builder \);\s*const nodeFromHash = builder\.getNodeFromHash\( hash \);\s*return nodeFromHash \|\| this;/,
    'Node.getShared: węzeł spod haszu (domyślnie uuid) — strażnik w łacie');
  assert.match(src, /getHash\( \/\*builder\*\/ \) \{\s*return this\.uuid;/, 'Node.getHash = uuid');
  assert.match(src, /const hash = this\.getUniformHash\( builder \);\s*let sharedNode = builder\.getNodeFromHash\( hash \);/,
    'UniformNode.generate: uniform dzielony po getUniformHash');
  assert.match(src, /getUniformHash\( \/\*builder\*\/ \) \{\s*return this\.value\.uuid;/, 'TextureNode: hasz uniformu = uuid TEKSTURY');
  // Core3D importuje łatę przed resztą zależności (węzły modułów Core3D z licznikiem)
  const core = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const imports = [...core.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.ok(imports.indexOf('./tsl/uuidWezlow.js') === 1 || (imports[0] === 'three/webgpu' && core.indexOf("from './tsl/uuidWezlow.js'") < core.indexOf("from 'three/tsl'")),
    'core3d.js: import ./tsl/uuidWezlow.js zaraz po three/webgpu');
});

test('strażnik: dwa węzły z tym samym uuid w jednym kernelu — osobne węzły, kolizja policzona', () => {
  if (process.env.TSL_UUID_BEZ_LATY) return;
  const a = float(instanceIndex);
  const c = float(0.25);
  // float(x) w r183 to VarNode-intencja: buduje się węzeł wewnętrzny (ConvertNode, ConstNode) — kolizja na nich
  const rdzen = (n) => (n.isVarNode === true && n.node ? n.node : n);
  rdzen(c).uuid = rdzen(a).uuid; // kolizja wprost (np. inny generator uuid niż łata)
  const before = tslUuidStan.wezly;
  const wgsl = buildCompute(Fn(() => { out.element(instanceIndex).assign(a.add(c)); })().compute(64));
  assert.match(wgsl, /\( f32\( instanceIndex \) \+ 0\.25 \)/);
  assert.ok(tslUuidStan.wezly > before, 'kolizja węzłów policzona');
  assert.ok(tslUuidStan.pierwsze.some((p) => p.rodzaj === 'wezly' && /compute/.test(p.budowa)), 'wpis z opisem budowy');
});

test('strażnik: dwa uniformy z tym samym uuid — dwa osobne uniformy w WGSL', () => {
  if (process.env.TSL_UUID_BEZ_LATY) return;
  const u1 = uniform(1.5);
  const u2 = uniform(2.5);
  u2.uuid = u1.uuid;
  const before = tslUuidStan.kolizje;
  const wgsl = buildCompute(Fn(() => { out.element(instanceIndex).assign(u1.add(u2)); })().compute(64));
  const m = wgsl.match(/\( object\.(nodeUniform\d+) \+ object\.(nodeUniform\d+) \)/);
  assert.ok(m, wgsl);
  assert.notEqual(m[1], m[2], 'u1 + u2 to dwa różne uniformy');
  assert.ok(tslUuidStan.kolizje > before, 'kolizja policzona');
});

test('strażnik: dwie tekstury z tym samym uuid — dwa wiązania tekstur, kolizja policzona', () => {
  if (process.env.TSL_UUID_BEZ_LATY) return;
  const t1 = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const t2 = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  t2.uuid = t1.uuid; // Texture.uuid łata 1 nie obejmuje (three importuje generateUUID wprost)
  const before = tslUuidStan.tekstury;
  const wgsl = buildCompute(Fn(() => {
    out.element(instanceIndex).assign(texture(t1, vec2(0.5)).level(0).x.add(texture(t2, vec2(0.5)).level(0).x));
  })().compute(64));
  assert.equal((wgsl.match(/: texture_2d<f32>;/g) || []).length, 2, 'dwie tekstury = dwa wiązania');
  assert.ok(tslUuidStan.tekstury > before, 'kolizja tekstur policzona');
  // ta sama tekstura dwa razy — jedno wiązanie (dzielenie z założenia, bez kolizji)
  const t3 = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const n = tslUuidStan.kolizje;
  const wgsl2 = buildCompute(Fn(() => {
    out.element(instanceIndex).assign(texture(t3, vec2(0.25)).level(0).x.add(texture(t3, vec2(0.75)).level(0).x));
  })().compute(64));
  assert.equal((wgsl2.match(/: texture_2d<f32>;/g) || []).length, 1, 'ta sama tekstura — jedno wiązanie');
  assert.equal(tslUuidStan.kolizje, n, 'bez kolizji');
});
