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
  assert.equal(u.uDiscAxis.value.length, 48);
  assert.equal(u.uHullA.value.length, 32);
  assert.equal(u.uRings.value.length, 3);
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
  // Oś smugi: od słońca (1000, −2000 sceny) przez środek tarczy, jednostkowa.
  const ax = u.uDiscAxis.value[0];
  assert.ok(Math.abs(Math.hypot(ax.x, ax.y) - 1) < 1e-9);
  assert.ok(Math.abs(ax.x * (-2000 + 20) - ax.y * (1000 - 10)) < 1e-6, 'oś równoległa do (tarcza − słońce)');
  assert.ok(ax.x < 0 && ax.y > 0, 'od słońca');
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

test('Core3D: tarcze ciał tła tam, gdzie je widać (perspektywa), oś z prawdziwego środka, kadr = cel sceny', () => {
  // Zgłoszenie „cienie planet się rozjeżdżają” (2026-10-08): planety tła (z = −50 000) rysuje pass planet
  // kamerą perspektywy, a maska stawiała ich tarczę w prawdziwym miejscu płaszczyzny gry — smuga była
  // szersza od tarczy i jechała względem niej z ruchem i zoomem kamery. Przy devicePixelRatio > 1 kadr
  // maski (px CSS / zoom) był mniejszy niż kadr obrazu 3D (bufor / zoom).
  const pass = createShadowShaftsPass();
  const target = { texture: { isTexture: true }, width: 1600, height: 1200 };   // bufor przy DPR 2
  let current = null;
  const fakeRenderer = {
    getRenderTarget: () => current, setRenderTarget: (t) => { current = t; }, render: () => {},
    info: { render: { drawCalls: 0, triangles: 0, points: 0, lines: 0 } }
  };
  const core = Object.assign(Object.create(Core3D), {
    renderer: fakeRenderer, shadowShaftsPass: pass, sunShadowTarget: target, width: 800, height: 600,
    activeCam1: { x: 100, y: 200, zoom: 0.5 }, sunOcclusionField: null, shaftHullTexture: null,
    shaftDiscs: new Float32Array(48 * 4), shaftDiscCount: 0, shaftDiscSrc: new Float64Array(48 * 3),
    shaftDiscView: new Float64Array(48 * 4), shaftDiscViewAxis: new Float64Array(48 * 2), shaftDiscViewCount: -1,
    shaftHulls: new Float32Array(32 * 12), shaftHullCount: 0, shaftRings: new Map(), lastFrameRenderInfo: null,
    _renderInfoBefore: { calls: 0, triangles: 0, points: 0, lines: 0 }
  });
  const cfg = { discLenMul: 5, capsuleLenMul: 3, capsuleBudget: 24, hullSteps: 24 };
  const sun = { x: -500000, y: 200 };
  core.pushShaftDiscWorld(1100, 200, 500, 1, -50000);           // planeta tła 1000 j. na prawo od kamery
  core.pushShaftDiscWorld(100, 800, 300);                       // ciało w płaszczyźnie gry
  core.pushShaftDiscWorld(5000, 900, 400, 0.5, 0, 1100, 200);   // soczewka: tarcza gdzie indziej, oś z (1100, 200)
  assert.equal(core._renderSunShadowMask(true, sun, cfg), true);
  const u = pass.material.uniforms;
  assert.deepEqual([u.uViewWorldSize.value.x, u.uViewWorldSize.value.y], [3200, 2400], 'kadr maski = cel sceny / zoom');
  // Kamera perspektywy passa planet (syncCamera z rozmiarem celu): Zc = (h / 2) / tg(17,5°) / zoom.
  const camZ = 600 / Math.tan(17.5 * Math.PI / 180) / 0.5;
  const k = camZ / (camZ + 50000);
  const d0 = u.uDiscs.value[0];
  assert.ok(Math.abs(d0.x - (100 + 1000 * k)) < 1e-6 && Math.abs(d0.y + 200) < 1e-6, `środek w kadrze: ${d0.x}`);
  assert.ok(Math.abs(d0.z - 500 * k) < 1e-6, 'promień jak na ekranie');
  assert.deepEqual(u.uDiscs.value[1].toArray(), [100, -800, 300, 1], 'płaszczyzna gry bez zmian');
  // Oś z prawdziwego środka (słońce w tej samej głębokości — rzut nie zmienia kierunku): +x sceny.
  assert.ok(Math.abs(u.uDiscAxis.value[0].x - 1) < 1e-9 && Math.abs(u.uDiscAxis.value[0].y) < 1e-9);
  assert.ok(Math.abs(u.uDiscAxis.value[2].x - 1) < 1e-9 && Math.abs(u.uDiscAxis.value[2].y) < 1e-9, 'oś soczewki z (1100, 200)');
  assert.equal(u.uDiscs.value[2].w, 0.5);
  // Lustro CPU na tych samych tarczach: cień za tarczą WIDZIANĄ, nie za prawdziwym miejscem.
  const vis = (x, y) => mask.discSunVisibilityCpu(x, y, sun.x, sun.y, core.shaftDiscView, core.shaftDiscViewCount, 5, core.shaftDiscViewAxis);
  assert.ok(vis(100 + 1000 * k + 500 * k * 3, 200) < 0.05, 'za tarczą w kadrze — cień');
  assert.ok(vis(1100 + 500 * 3, 200) > 0.99, 'za prawdziwym miejscem — słońce');
  // Bez osi (dawne wywołanie) — oś ze środka tarczy i słońca jak dotąd.
  assert.equal(mask.discSunVisibilityCpu(100, 800 + 900, 100, -1e6, new Float32Array([100, -800, 300, 1]), 1, 5) < 0.05, true);
  mask.sunShadowUniforms.uSunShadowMap.value = mask.SUN_SHADOW_MAP_PLACEHOLDER;
  mask.sunShadowUniforms.uSunShadowOn.value = 0;
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

// Snapshot refrakcji i fala uderzeniowa (shockwave3D.js) usunięte w zadaniu 19 — fale rakiet
// i Supernowej to źródła zniekształceń efektów (src/3d/fx/distortion.js). MSAA przełącza
// dalej cel sceny razem z celem halo.
test('MSAA przełączane razem: cel sceny i cel halo (bez celu refrakcji)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /refractionTarget|Shockwave3DManager|trigger3DShockwave/);
  const rt = (s) => ({ samples: s, disposed: 0, dispose() { this.disposed++; } });
  const core = Object.assign(Object.create(Core3D), {
    msaaSamples: 4, composerTarget: rt(4), planetHaloTarget: rt(4), perfToggles: {}
  });
  core.setMsaaEnabled(false);
  assert.deepEqual([core.composerTarget.samples, core.planetHaloTarget.samples], [0, 0]);
  core.setMsaaEnabled(true, 4);
  assert.deepEqual([core.composerTarget.samples, core.planetHaloTarget.samples], [4, 4]);
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
