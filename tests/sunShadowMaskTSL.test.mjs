// Port WebGPU, zadanie 03: maska słońca w TSL — biblioteka dla materiałów (sunShadowMask.js),
// hak wbudowanych materiałów, pass maski Core3D, fala uderzeniowa. Bez GPU: WGSL budowany
// w Node (WebGPURenderer bez init, atrapa kanwy — wzór tests/haloRingTSL.test.mjs).
// Liczby na GPU (maska w grze ↔ baza WebGL z tagu, orientacja): scripts/webgpu/maska-slonca.mjs.
// node --test tests/sunShadowMaskTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Fn, uv, vec3, vec4 } from 'three/tsl';

globalThis.window = globalThis.window || { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1 };

const mask = await import('../src/3d/sunShadowMask.js');
const { Core3D, createShadowShaftsPass } = await import('../src/3d/core3d.js');
const { Shockwave3DManager } = await import('../src/effects3d/shockwave3D.js');
const { HullNodeMaterial, getHullVariant } = await import('../src/3d/hexShips3D.tsl.js');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;

function buildWGSL(material, { lights = [], geometry = new THREE.PlaneGeometry(), camera = new THREE.PerspectiveCamera() } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  const scene = new THREE.Scene();
  for (const l of lights) scene.add(l);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = scene;
  b.camera = camera;
  b.context.material = material;
  const lightsNode = renderer.lighting.getNode(scene, camera);
  lightsNode.setLights(lights);
  b.lightsNode = lightsNode;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}

const count = (s, re) => (s.match(re) || []).length;
const uniformBuffers = (wgsl) => count(wgsl, /var<uniform>/g);
// Odczyt maski: textureSampleLevel po fragCoord / rozmiar celu (screenUV), poziom 0.
const MASK_SAMPLE = /textureSampleLevel\( \w+, \w+_sampler, \( fragCoord\.xy \/ \w+\.\w+ \), 0\.0 \)/g;

test('biblioteka: odczyt po screenUV (fragCoord / rozmiar celu), poziom 0, wyłączona uniformem z grupy renderu', () => {
  const m = new THREE.NodeMaterial();
  m.fragmentNode = Fn(() => {
    const c = vec3(uv(), 0.5);
    const vis = mask.sunVisibility();
    return vec4(mask.sunShadeUnlit(c).mul(vis).add(mask.sunShaftBackdrop(c)).mul(mask.sunFill(vis)).add(mask.fieldDarkness()), 1.0);
  })();
  const wgsl = buildWGSL(m).fragment;
  // sunVisibility, sunFill (→ fieldDarkness), sunShadeUnlit (→ sunFill + sunVisibility),
  // sunShaftBackdrop, fieldDarkness: każde wywołanie ma własną próbkę (bez współdzielenia
  // węzła między gałęziami — zmienna z jednej gałęzi byłaby w drugiej niezainicjowana).
  assert.ok(count(wgsl, MASK_SAMPLE) >= 5, `próbki maski: ${count(wgsl, MASK_SAMPLE)}`);
  assert.doesNotMatch(wgsl, /textureSample\(/, 'bez próbek z pochodnymi');
  // Maska wyłączona (bez słońca / shafty Off / wolna kamera) = pełne słońce, bez odczytu.
  assert.ok(count(wgsl, /if \( \( render\.\w+ < 0\.5 \) \)/g) >= 5, 'bramka uSunShadowOn w grupie renderu');
  // Barwa smugi tła i przygaszenie otoczenia w pełnym cieniu z wspólnych stałych.
  assert.match(wgsl, /vec3<f32>\( 0\.06, 0\.1, 0\.16 \)/);
  assert.ok(uniformBuffers(wgsl) <= 12);
});

test('wbudowane: „direct” gasi światło bezpośrednie (maska na każde światło), otoczenie zostaje; „backdrop” smuga na wyjściu', () => {
  const lights = () => [new THREE.DirectionalLight(0xffffff, 1), new THREE.PointLight(0xff0000, 1, 100), new THREE.AmbientLight(0x404040, 1)];
  const sphere = new THREE.SphereGeometry(1, 8, 8);
  const plain = buildWGSL(new THREE.MeshStandardMaterial(), { lights: lights(), geometry: sphere }).fragment;
  const masked = buildWGSL(mask.applySunShadowToBuiltinMaterial(new THREE.MeshStandardMaterial(), 'direct'), { lights: lights(), geometry: sphere }).fragment;
  assert.equal(count(plain, MASK_SAMPLE), 0);
  // Dwa światła bezpośrednie (kierunkowe + punktowe), otoczenie (indirect) bez maski.
  assert.equal(count(masked, MASK_SAMPLE), 2);
  // Bez świateł bezpośrednich — nic do gaszenia.
  const ambientOnly = buildWGSL(mask.applySunShadowToBuiltinMaterial(new THREE.MeshStandardMaterial(), 'direct'),
    { lights: [new THREE.AmbientLight(0x404040, 1)], geometry: sphere }).fragment;
  assert.equal(count(ambientOnly, MASK_SAMPLE), 0);
  // Tło (pył pasa): smuga na kolorze wyjściowym, jedna próbka.
  const dust = buildWGSL(mask.applySunShadowToBuiltinMaterial(new THREE.PointsMaterial({ color: 0xffffff }), 'backdrop')).fragment;
  assert.equal(count(dust, MASK_SAMPLE), 1);
  assert.match(dust, /vec3<f32>\( 0\.06, 0\.1, 0\.16 \)/);
});

test('pass maski: jeden quad, tablica warstw SDF, pętle z uniformów, ≤ 12 buforów, dither jak gl_FragCoord', () => {
  const pass = createShadowShaftsPass();
  assert.equal(pass.quad.isQuadMesh, true);
  assert.equal(pass.material.blending, THREE.NoBlending);
  assert.equal(pass.material.depthTest, false);
  assert.equal(pass.bucket, 'shafts');
  const u = pass.material.uniforms;
  // Adapter: tablice → Vector4 gry (Vector4.set w miejscu), tekstury zastępcze tego samego rodzaju.
  assert.equal(u.uDiscs.value.length, 48);
  assert.equal(u.uHullA.value.length, 32);
  assert.equal(u.uRings.value.length, 2);
  assert.ok(u.uDiscs.value[0].isVector4);
  assert.equal(u.uHullSdf.value, pass.hullSdfPlaceholder);
  assert.equal(pass.hullSdfPlaceholder.isDataArrayTexture, true);
  assert.equal(u.uFieldOcc.value, pass.fieldOccPlaceholder);
  const wgsl = buildWGSL(pass.material, { geometry: pass.quad.geometry }).fragment;
  assert.ok(uniformBuffers(wgsl) <= 12, `bufory uniformów: ${uniformBuffers(wgsl)}`);
  assert.match(wgsl, /texture_2d_array<f32>/);
  for (const idx of ['discIdx', 'hullIdx', 'hullStep', 'ringIdx']) {
    assert.equal(count(wgsl, new RegExp(`for \\( var ${idx} : i32 = 0; ${idx} < \\w+\\.\\w+; ${idx} \\+\\+ \\)`, 'g')), 1, `pętla ${idx}`);
  }
  // UV quadu WebGPU (v od góry) → świat jak w GLSL (v od dołu).
  assert.match(wgsl, /vec2<f32>\( \w+\.x, \( 1\.0 - \w+\.y \) \)/);
  // Szum ±0,5/255 z pikselem jak gl_FragCoord WebGL (y od dołu celu).
  assert.match(wgsl, /fract\( \( 52\.9829189 \* fract\( dot\( vec2<f32>\( fragCoord\.xy\.x, \( \w+\.\w+\.y - fragCoord\.xy\.y \) \), vec2<f32>\( 0\.06711056, 0\.00583715 \) \) \) \) \)/);
  // sqrt z nieujemnym argumentem (NaN przy stycznej).
  assert.match(wgsl, /sqrt\( max\( \( \( \w+ \* \w+ \) - \( \w+ \* \w+ \) \), 0\.0 \) \)/);
  // Pole przesłaniające: próbka poziomem 0 (w gałęzi zależnej od piksela).
  assert.match(wgsl, /textureSampleLevel\( \w+, \w+_sampler, \w+, 0\.0 \)/);
});

test('Core3D: maska do celu przed passami, placeholdery zamiast null, wyłączona bez słońca', () => {
  const pass = createShadowShaftsPass();
  const renders = [];
  const target = { texture: { isTexture: true, name: 'cel maski' }, width: 800, height: 600 };
  let current = null;
  const fakeRenderer = {
    getRenderTarget: () => current,
    setRenderTarget: (t) => { current = t; },
    render: (scene) => { renders.push({ scene, target: current }); },
    info: { render: { drawCalls: 0, triangles: 0, points: 0, lines: 0 } }
  };
  const core = Object.assign(Object.create(Core3D), {
    renderer: fakeRenderer, shadowShaftsPass: pass, sunShadowTarget: target, width: 800, height: 600,
    activeCam1: { x: 100, y: 200, zoom: 0.5 }, sunOcclusionField: null, shaftHullTexture: null,
    shaftDiscs: new Float32Array(48 * 4), shaftDiscCount: 0, shaftHulls: new Float32Array(32 * 12), shaftHullCount: 0,
    shaftRings: new Map(), lastFrameRenderInfo: null,
    _renderInfoBefore: { calls: 0, triangles: 0, points: 0, lines: 0 }
  });
  const U = mask.sunShadowUniforms;
  const cfg = { discLenMul: 5, capsuleLenMul: 3, capsuleBudget: 24, hullSteps: 24 };
  // Bez słońca (render(): active = shafty && !!SUN) — maska wyłączona, pass nierysowany.
  assert.equal(core._renderSunShadowMask(false, null, cfg), false);
  assert.equal(U.uSunShadowOn.value, 0);
  assert.equal(renders.length, 0);
  // Ze słońcem: dysk, jeden kadłub bez tablicy warstw (hullCount 0 — pusta tablica
  // czytałaby się jako „wszędzie kadłub”), ring.
  core.shaftDiscs.set([10, -20, 300, 1]);
  core.shaftDiscCount = 1;
  core.shaftHullCount = 1;
  core.shaftRings.set('earth', { x: 5, y: -6, r: 700, reach: 800 });
  assert.equal(core._renderSunShadowMask(true, { x: 1000, y: 2000 }, cfg), true);
  assert.equal(renders.length, 1);
  assert.equal(renders[0].scene, pass.quad, 'quad maski');
  assert.equal(renders[0].target, target, 'do celu maski');
  assert.equal(current, null, 'poprzedni cel przywrócony');
  const u = pass.material.uniforms;
  assert.equal(u.uSunActive.value, 1);
  assert.deepEqual([u.uSunWorld.value.x, u.uSunWorld.value.y], [1000, -2000], 'y sceny = −y gry');
  assert.deepEqual([u.uCamCenter.value.x, u.uCamCenter.value.y], [100, -200]);
  assert.deepEqual([u.uViewWorldSize.value.x, u.uViewWorldSize.value.y], [1600, 1200], 'kadr w świecie = px / zoom');
  assert.equal(u.uDiscCount.value, 1);
  assert.deepEqual(u.uDiscs.value[0].toArray(), [10, -20, 300, 1]);
  assert.equal(u.uHullCount.value, 0);
  assert.equal(u.uHullSdf.value, pass.hullSdfPlaceholder, 'węzeł tekstury nie dostaje null');
  assert.equal(u.uFieldOcc.value, pass.fieldOccPlaceholder);
  assert.equal(u.uRingCount.value, 1);
  assert.deepEqual(u.uRings.value[0].toArray(), [5, -6, 700, 800]);
  assert.equal(U.uSunShadowOn.value, 1);
  assert.equal(U.uSunShadowMap.value, target.texture, 'materiały czytają cel maski');
  assert.equal(core.lastFrameRenderInfo?.shafts?.calls, 0, 'kubełek shafts mierzony');
  // Z tablicą warstw kadłub wchodzi do passa.
  const sdf = { isTexture: true, isDataArrayTexture: true };
  core.shaftHullTexture = sdf;
  core._renderSunShadowMask(true, { x: 1000, y: 2000 }, cfg);
  assert.equal(u.uHullCount.value, 1);
  assert.equal(u.uHullSdf.value, sdf);
  // Smugi wyłączone i brak pola — maska off.
  core._renderSunShadowMask(false, { x: 1000, y: 2000 }, cfg);
  assert.equal(U.uSunShadowOn.value, 0);
  assert.equal(u.uSunActive.value, 0);
  U.uSunShadowMap.value = mask.SUN_SHADOW_MAP_PLACEHOLDER;
});

test('Core3D.uploadTextureLayer: jedna warstwa tablicy przez queue.writeTexture, odmowa przed pełnym wgraniem', () => {
  const tex = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 3), 4, 4, 3);
  const writes = [];
  const state = new Map();
  const gpuData = new Map();
  const renderer = {
    _textures: { get: (t) => { if (!state.has(t)) state.set(t, {}); return state.get(t); } },
    backend: {
      device: { queue: { writeTexture: (...a) => writes.push(a) } },
      get: (t) => { if (!gpuData.has(t)) gpuData.set(t, {}); return gpuData.get(t); }
    }
  };
  const core = Object.assign(Object.create(Core3D), { renderer });
  // Tekstura jeszcze nie na GPU — wołający ustawi needsUpdate.
  assert.equal(core.uploadTextureLayer(tex, 1), false);
  tex.needsUpdate = true;
  state.get(tex).initialized = true;
  state.get(tex).version = tex.version - 1;     // pełne wgranie w toku
  gpuData.get(tex).texture = { label: 'gpu' };
  assert.equal(core.uploadTextureLayer(tex, 1), false, 'needsUpdate w toku — pełne wgranie i tak poleci');
  state.get(tex).version = tex.version;
  assert.equal(core.uploadTextureLayer(tex, 3), false, 'warstwa spoza tablicy');
  assert.equal(core.uploadTextureLayer(tex, 2), true);
  assert.equal(writes.length, 1);
  const [dst, data, layout, size] = writes[0];
  assert.equal(dst.texture.label, 'gpu');
  assert.deepEqual(dst.origin, { x: 0, y: 0, z: 2 });
  assert.equal(data, tex.image.data);
  assert.deepEqual(layout, { offset: 32, bytesPerRow: 4, rowsPerImage: 4 });
  assert.deepEqual(size, { width: 4, height: 4, depthOrArrayLayers: 1 });
  assert.equal(tex.version, state.get(tex).version, 'bez needsUpdate');
});

test('snapshot refrakcji w kontekście renderu sceny: format, MSAA i głębia composerTarget, MSAA przełączane razem', async () => {
  // three buduje materiały i pipeline'y per kontekst renderu (stan załączników celu) — cel refrakcji
  // o innym formacie budowałby wszystko w kadrze na zimno przy pierwszej fali (tarcze: uwaga z 14).
  const src = (await import('node:fs')).readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const block = src.slice(src.indexOf('this.refractionTarget = new THREE.RenderTarget('), src.indexOf('this.shockwave3DManager = new Shockwave3DManager('));
  assert.match(block, /type: THREE\.HalfFloatType/);
  assert.match(block, /depthBuffer: true/);
  assert.match(block, /samples: rt\.samples/);
  assert.ok(src.indexOf('this.composerTarget = rt;') < src.indexOf('this.refractionTarget = new THREE.RenderTarget('), 'cel refrakcji po celu sceny');
  const rt = (s) => ({ samples: s, disposed: 0, dispose() { this.disposed++; } });
  const core = Object.assign(Object.create(Core3D), {
    msaaSamples: 4, composerTarget: rt(4), planetHaloTarget: rt(4), refractionTarget: rt(4), perfToggles: {}
  });
  core.setMsaaEnabled(false);
  assert.deepEqual([core.composerTarget.samples, core.planetHaloTarget.samples, core.refractionTarget.samples], [0, 0, 0]);
  assert.equal(core.refractionTarget.disposed, 1);
  core.setMsaaEnabled(true, 4);
  assert.deepEqual([core.composerTarget.samples, core.planetHaloTarget.samples, core.refractionTarget.samples], [4, 4, 4]);
});

test('fala uderzeniowa: wspólny graf wszystkich fal (jeden program), odczyt celu refrakcji po screenUV z obcięciem jak RGBA8', () => {
  const scene = new THREE.Scene();
  const target = new THREE.RenderTarget(64, 32, { type: THREE.HalfFloatType, samples: 4 });
  const manager = new Shockwave3DManager(scene, 3, target);
  const mats = manager.waves.map((w) => w.mesh.material);
  assert.equal(mats.length, 3);
  assert.ok(mats.every((m) => m.isNodeMaterial && m.fragmentNode === mats[0].fragmentNode), 'graf na menedżera, nie na falę');
  assert.equal(new Set(mats.map((m) => m.customProgramCacheKey())).size, 1, 'ten sam klucz programu');
  // API aktualizacji bez zmian: material.uniforms.progress / uColor.
  manager.spawn(0, 0, 0, 400, 1.2, 0x55ffff);
  manager.update(0.3);
  assert.ok(Math.abs(mats[0].uniforms.progress.value - 0.25) < 1e-9);
  assert.equal(mats[0].uniforms.uColor.value.getHex(), 0x55ffff);
  assert.equal(mats[0].transparent, true);
  assert.equal(mats[0].depthTest, false);
  const wgsl = buildWGSL(mats[0], { geometry: manager.waves[0].mesh.geometry }).fragment;
  // Odczyt tła: fragCoord / rozmiar celu, z przesunięciem, poziom 0, obcięty do [0, 1].
  assert.match(wgsl, /textureSampleLevel\( \w+, \w+_sampler, \( \( fragCoord\.xy \/ \w+\.\w+ \) \+ /);
  assert.match(wgsl, /clamp\( \w+\.xyz, vec3<f32>\( 0\.0 \), vec3<f32>\( 1\.0 \) \)/);
  // Fresnel z nieujemną podstawą potęgi (pow z ujemną podstawą = NaN w WGSL).
  assert.match(wgsl, /pow\( max\( /);
  manager.dispose();
});

test('kadłuby: maska w grafie wariantu (zastępnik pełnego słońca z 04 zdjęty)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/3d/hexShips3D.tsl.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /AGENT: po 03/);
  const v = getHullVariant('beam');
  const uniforms = {
    uSprite: { value: null }, uNormalMap: { value: null }, uShapeMap: { value: null }, uHasNormalMap: { value: 0 },
    uSpriteSize: { value: new THREE.Vector2(1, 1) }, uLightDir: { value: new THREE.Vector3(0, 0, 1) }, uRotation: { value: 0 },
    uLodOpacity: { value: 1 }, uBillboardLighting: { value: 0 }, uShipLightCount: { value: 0 }, uEngineZoneCount: { value: 0 },
    uLightBase: { value: 0 }, uLacquerWeight: { value: 0 }, uLacquerGlint: { value: 1 }
  };
  const material = new HullNodeMaterial('beam', uniforms);
  assert.equal(material.fragmentNode, v.fragmentNode);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setAttribute('aShade', new THREE.Float32BufferAttribute([1, 1, 1], 1));
  geometry.setAttribute('aHeat', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
  const wgsl = buildWGSL(material, { geometry }).fragment;
  assert.ok(count(wgsl, MASK_SAMPLE) >= 3, `maska w kadłubie: ${count(wgsl, MASK_SAMPLE)} próbek`);
  assert.ok(uniformBuffers(wgsl) <= 12);
});
