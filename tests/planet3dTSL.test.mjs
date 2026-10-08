// Port WebGPU planet, słońca, mgławicy i gwiazd (zadanie 05): grafy TSL z planet3d.assets.tsl.js. Bez GPU —
// WGSL budowany w Node przez WGSLNodeBuilder (WebGPURenderer bez init, atrapa kanwy), jak w haloRingTSL.test.
// node --test tests/planet3dTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { texture, uniform, uniformArray, uv, vec2 } from 'three/tsl';
import { uniformsAdapter } from '../src/3d/tsl/uniformy.js';
import {
  PLANET_TSL_STATS, PLANET_GRAPH_KEYS, PLANET_MATERIAL_NAMES, STAR_PLANET_MASK_CAP, STAR_INSTANCE_STRIDE, STAR_INSTANCE_LAYOUT,
  createPlanetSurfaceMaterial, createPlanetCloudMaterial, createPlanetAtmosphereMaterial, createRingAtmosphereMaterial,
  createSunMaterial, createNebulaMaterial, createStarMaterial, createStarGeometry, packStarInstances, getPlanetGraph,
  SUN_BLOOM_NADMIAR
} from '../src/3d/planet3d.assets.tsl.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
// próbkowanie tekstur pyta o cechy urządzenia (float32-filterable) — bez GPU: brak cech
renderer.hasFeature = () => false;
// gra: Core3D._configureRenderer (modelViewMatrix składana w double na CPU)
renderer.highPrecision = true;

function buildWGSL(material, geometry = new THREE.SphereGeometry(1, 8, 8), camera = new THREE.PerspectiveCamera()) {
  const mesh = new THREE.Mesh(geometry, material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = camera;
  b.context.material = material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const uniformBuffers = (wgsl) => (wgsl.match(/var<uniform>/g) || []).length;
const fnBody = (wgsl, name) => wgsl.match(new RegExp(`fn ${name} \\([\\s\\S]*?\\n}`))?.[0] || '';
const tex = (colorSpace = THREE.NoColorSpace) => { const t = new THREE.Texture(); t.image = { width: 1, height: 1 }; t.colorSpace = colorSpace; return t; };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Ten sam kształt `uniforms` co DirectPlanet (planet3d.assets.js).
function surfaceUniforms(overrides = {}) {
  return {
    uPlanetBloom: { value: 0.0 }, dayTexture: { value: tex(THREE.SRGBColorSpace) }, nightTexture: { value: null },
    specularTexture: { value: new THREE.Texture() }, normalTexture: { value: new THREE.Texture() }, sunPosition: { value: V3(0, 0, -50000) },
    hasNightTexture: { value: 0.0 }, uBrightness: { value: 1.2 }, uAmbient: { value: 0.05 }, uSpecular: { value: 1.2 },
    uSunWrap: { value: 0.5 }, uSunIntensity: { value: 1.0 }, sunsetTint: { value: V3(1.4, 0.1, 0.1) },
    uHazeStrength: { value: 0.0 }, uHazeColor: { value: V3(0.55, 0.72, 1.0) }, uHazeBeta: { value: V3(0.05, 0.10, 0.22) },
    uRingShadowStrength: { value: 0.0 }, uRingShadowRadius: { value: 0.0 }, uRingShadowReach: { value: 1.0 },
    uRingShadowCenter: { value: new THREE.Vector2(0, 0) }, uSunShadowRecv: { value: 0.0 },
    ...overrides
  };
}
const atmosphereUniforms = () => ({
  coef: { value: 0.6 }, power: { value: 9 }, glowColor: { value: V3(0.3, 0.6, 1) }, sunsetTint: { value: V3(1.2, 0.4, 0.1) },
  uSunIntensity: { value: 1.1 }, sunPosition: { value: V3(0, 0, -50000) }, uSunShadowRecv: { value: 0 }
});
const ringAtmosphereUniforms = () => ({
  uSunDir: { value: V3(1, 0, 0) }, uRa: { value: 1.033 }, uHs: { value: 0.0073 }, uDayColor: { value: V3(0.26, 0.5, 1) },
  uSunsetColor: { value: V3(1, 0.38, 0.12) }, uGain: { value: V3(1, 1, 1) }, uSunShadowRecv: { value: 1 }
});
function starUniforms() {
  return uniformsAdapter({
    pointTexture: texture(tex(), vec2(0.0)), time: uniform(0), cameraOffset: uniform(new THREE.Vector2()),
    containerSize: uniform(220000), perspectiveScale: uniform(800), globalBrightness: uniform(1), warpFactor: uniform(0),
    moveDir: uniform(new THREE.Vector2(0, 1)), stretchStrength: uniform(20), zoomComp: uniform(1), exitWhipFactor: uniform(0),
    exitWhipStrength: uniform(1.75), viewportSize: uniform(new THREE.Vector2(1, 1)), thinningStrength: uniform(38), baseSizeMul: uniform(1.65),
    planetMasks: uniformArray(Array.from({ length: STAR_PLANET_MASK_CAP }, () => new THREE.Vector4()), 'vec4')
  });
}
function starArrays(n) {
  const f = (k, fill) => Float32Array.from({ length: n * k }, (_, i) => fill(Math.floor(i / k), i % k));
  return {
    starPos: f(3, (s, c) => s * 10 + c), size: f(1, (s) => 100 + s), brightness: f(1, (s) => 200 + s), color: f(3, (s, c) => 300 + s * 10 + c),
    parallaxFactor: f(1, (s) => 400 + s), layerSizeMul: f(1, (s) => 500 + s), layerBrightnessMul: f(1, (s) => 600 + s), layerStretchMul: f(1, (s) => 700 + s)
  };
}

test('planet3d.assets.js bez GLSL — materiały z grafów TSL, kontrakty uniformów dla tła menu i devTools', () => {
  const src = read('src/3d/planet3d.assets.js');
  assert.doesNotMatch(src, /new THREE\.ShaderMaterial|new THREE\.Points\(|gl_FragColor|gl_Position|gl_PointSize|texture2D|SUN_SHADOW_GLSL|attachSunShadowUniforms/);
  for (const factory of ['createPlanetSurfaceMaterial(this.uniforms)', 'createPlanetCloudMaterial(this.cloudUniforms)',
    'createSunMaterial(this.uniforms)', 'createNebulaMaterial(this.uniforms)', 'createStarMaterial(this.uniforms)',
    'createRingAtmosphereMaterial({', 'createPlanetAtmosphereMaterial({']) {
    assert.ok(src.includes(factory), `brak ${factory}`);
  }
  // Tło menu pożycza teksturę mgławicy (scene.getObjectByName('Nebula').material.uniforms.map.value) i tekstury
  // Ziemi (window.EARTH.uniforms.*Texture.value, cloudUniforms.cloudTexture.value) — ten sam kształt.
  assert.match(src, /this\.mesh\.name = 'Nebula';/);
  // brightness — jasność tła wg strefy gry (src/game/skyRegion.js, mnożnik obrazu wyświetlanego).
  assert.match(src, /this\.uniforms = uniformsAdapter\(\{ map: texture\(tex, uv\(\)\), warpFactor: uniform\(0\.0\), brightness: uniform\(1\.0\) \}\);/);
  assert.match(src, /if \(name === 'earth'\) window\.EARTH = this;/);
  const nebula = uniformsAdapter({ map: texture(tex(THREE.SRGBColorSpace), uv()), warpFactor: uniform(0) });
  const material = createNebulaMaterial(nebula);
  assert.equal(material.uniforms.map.value.isTexture, true, 'uniforms.map.value = tekstura');
  assert.equal(material.name, PLANET_MATERIAL_NAMES.nebula);
  assert.equal(material.depthTest, false);
  assert.equal(material.depthWrite, false);
});

test('powierzchnia planety: jeden graf dla wszystkich planet, wartości i tekstury per obiekt', () => {
  const buildsBefore = PLANET_TSL_STATS.builds.surface;
  const earth = createPlanetSurfaceMaterial(surfaceUniforms({ hasNightTexture: { value: 1.0 } }));
  const venus = createPlanetSurfaceMaterial(surfaceUniforms());
  assert.equal(earth.fragmentNode, venus.fragmentNode, 'wspólne węzły');
  assert.equal(earth.customProgramCacheKey(), venus.customProgramCacheKey(), 'ten sam klucz programu');
  const a = buildWGSL(earth);
  const b = buildWGSL(venus);
  assert.equal(a.fragment, b.fragment);
  assert.equal(PLANET_TSL_STATS.builds.surface - buildsBefore, 2, 'budowa liczona w setup (tu dwie ręczne)');
  // Uniformy per obiekt w jednym buforze grupy obiektu (limit 12 buforów na etap).
  assert.ok(uniformBuffers(a.fragment) <= 3, `bufory uniformów: ${uniformBuffers(a.fragment)}`);
  // Mapa normalnych (tylko Ziemia): pochodne jak GL (three: dFdy = −dpdy), próbki w jednolitym przepływie.
  assert.match(a.fragment, /- dpdy\(/);
  const beforeFirstIf = a.fragment.slice(0, a.fragment.indexOf('if ('));
  assert.equal((beforeFirstIf.match(/textureSample\(/g) || []).length >= 1, true, 'mapa normalnych przed gałęzią');
  assert.doesNotMatch(a.fragment.slice(a.fragment.indexOf('if ( ( nodeVar'), a.fragment.length), /if \( \( nodeVar\d+ > 0\.0 \) \) \{\s*nodeVar\d+ = textureSample/,
    'próbka połysku nie w gałęzi zależnej od piksela');
  // Dither z gl_FragCoord WebGL (y od dołu celu).
  assert.match(a.fragment, /planetHash12\( vec2<f32>\( fragCoord\.xy\.x, \( object\.nodeUniform\d+\.y - fragCoord\.xy\.y \) \) \)/);
  // Klucze czytane przez graf = klucze DirectPlanet.
  for (const key of PLANET_GRAPH_KEYS.surface) assert.ok(key in surfaceUniforms(), `klucz ${key}`);
});

test('tekstura per obiekt: węzeł czyta teksturę rysowanego materiału, bez niej — zastępcza', () => {
  const graph = getPlanetGraph('surface');
  const earthU = surfaceUniforms({ nightTexture: { value: tex(THREE.SRGBColorSpace) } });
  const venusU = surfaceUniforms();
  const earth = createPlanetSurfaceMaterial(earthU);
  const venus = createPlanetSurfaceMaterial(venusU);
  assert.deepEqual(Object.keys(graph.textures).sort(), ['dayTexture', 'nightTexture', 'normalTexture', 'specularTexture']);
  assert.deepEqual(Object.keys(getPlanetGraph('clouds').textures), ['cloudTexture']);
  const night = graph.textures.nightTexture;
  assert.equal(night.planetKey, 'nightTexture');
  assert.equal(night.updateType, THREE.NodeUpdateType.OBJECT, 'aktualizacja per obiekt');
  night.update({ material: earth });
  assert.equal(night.value, earthU.nightTexture.value, 'Ziemia: jej mapa nocy');
  night.update({ material: venus });
  assert.equal(night.value, night.planetFallback, 'Wenus (bez mapy nocy): zastępcza');
  assert.equal(night.planetFallback.minFilter, THREE.LinearFilter, 'zastępcza z filtrem liniowym (ścieżka textureSample)');
});

test('chmury, poświaty, słońce: stan renderu jak dawny ShaderMaterial', () => {
  const clouds = createPlanetCloudMaterial({ cloudTexture: { value: tex(THREE.SRGBColorSpace) }, sunPosition: { value: V3() }, uOpacity: { value: 0.62 },
    uHazeStrength: { value: 1 }, uHazeColor: { value: V3() }, uHazeBeta: { value: V3() }, uRingShadowStrength: { value: 0 },
    uRingShadowRadius: { value: 0 }, uRingShadowReach: { value: 1 }, uRingShadowCenter: { value: new THREE.Vector2() }, uSunShadowRecv: { value: 0 } });
  assert.equal(clouds.side, THREE.DoubleSide);
  assert.equal(clouds.forceSinglePass, true, 'przezroczysty DoubleSide w jednym rysunku (ShaderMaterial)');
  assert.equal(clouds.transparent, true);
  assert.equal(clouds.depthWrite, false);
  assert.equal(clouds.blending, THREE.NormalBlending);

  const halo = createPlanetAtmosphereMaterial(atmosphereUniforms());
  assert.equal(halo.side, THREE.BackSide);
  assert.equal(halo.blending, THREE.AdditiveBlending);
  assert.equal(halo.premultipliedAlpha, false);
  assert.equal(halo.depthWrite, false);

  // Poświata limbu: ONE/ONE (dawne premultipliedAlpha + Additive) i BEZ mnożenia koloru przez alfę w shaderze
  // (NodeMaterial z premultipliedAlpha = true mnożyłby rgb · a).
  const ring = createRingAtmosphereMaterial(ringAtmosphereUniforms());
  assert.equal(ring.blending, THREE.CustomBlending);
  assert.equal(ring.premultipliedAlpha, false);
  for (const k of ['blendSrc', 'blendDst', 'blendSrcAlpha', 'blendDstAlpha']) assert.equal(ring[k], THREE.OneFactor, k);
  const ringWgsl = buildWGSL(ring, new THREE.CircleGeometry(1.033, 16), new THREE.OrthographicCamera());
  assert.doesNotMatch(ringWgsl.fragment, /\.w \)|\* vec3<f32>\( nodeVar\d+\.w \)/, 'kolor nie mnożony przez alfę');

  const sun = createSunMaterial({ uTime: { value: 0 }, uIsOcclusion: { value: 0 } });
  assert.equal(sun.transparent, false);
  assert.equal(sun.depthWrite, true);
  assert.equal(sun.name, PLANET_MATERIAL_NAMES.sun);
});

// Zadanie 25b (bloom gry jak w demach, bez ×3 dawnego passu WebGL): korona słońca to sama poświata bloomu kuli HDR i przy
// ×1 znikała — nadmiar luminancji ponad próg bloomu × SUN_BLOOM_NADMIAR (L' = p + 3·(L − p)), pod progiem bez zmian.
test('słońce: nadmiar ponad próg bloomu × SUN_BLOOM_NADMIAR (korona po zdjęciu ×3), pod progiem bez zmian', () => {
  assert.equal(SUN_BLOOM_NADMIAR, 3);
  const sun = buildWGSL(createSunMaterial({ uTime: { value: 1.5 }, uIsOcclusion: { value: 0 } })).fragment;
  assert.match(sun, /(nodeVar\d+) = dot\( (nodeVar\d+), vec3<f32>\( 0\.2126, 0\.7152, 0\.0722 \) \);\s*\2 = \( \2 \* vec3<f32>\( \( \( \1 \+ \( max\( \( \1 - 0\.9 \), 0\.0 \) \* 2\.0 \) \) \/ max\( \1, 0\.0001 \) \) \) \);/);
});

test('słońce i hasze: funkcje z layoutem są czyste, bez pow z ujemną podstawą', () => {
  const sun = buildWGSL(createSunMaterial({ uTime: { value: 1.5 }, uIsOcclusion: { value: 0 } })).fragment;
  for (const name of ['sunHash', 'sunNoise', 'sunFbm']) {
    const body = fnBody(sun, name);
    assert.ok(body, `brak fn ${name}`);
    assert.doesNotMatch(body, /object\.|render\.|nodeUniform/, `${name} czyta uniform`);
  }
  // fresnel pow(1 − max(viewDot, 0), 3) mnożeniem (baza WebGL: potęga całkowita rozwinięta przez FXC)
  assert.doesNotMatch(sun, /pow\(/);
  assert.match(fnBody(sun, 'sunFbm'), /for \(/, 'oktawy fbm w pętli, nie cztery kopie');
  const surface = buildWGSL(createPlanetSurfaceMaterial(surfaceUniforms())).fragment;
  assert.doesNotMatch(fnBody(surface, 'planetHash12'), /object\.|render\.|nodeUniform/);
  // pow tylko z nieujemną podstawą: max(0, N·H) (połysk) — miasta nocą pow(x, 2) mnożeniem.
  const powBases = (wgsl) => [...wgsl.matchAll(/pow\( (.{0,24})/g)].map((m) => m[1]);
  assert.ok(powBases(surface).length >= 1);
  for (const base of powBases(surface)) assert.match(base, /^max\( 0\.0,/, `pow z podstawą ${base}`);
  const halo = buildWGSL(createPlanetAtmosphereMaterial(atmosphereUniforms())).fragment;
  assert.ok(powBases(halo).length >= 1);
  for (const base of powBases(halo)) assert.match(base, /^max\( vAtmRim, 0\.0 \)/, `pow z podstawą ${base}`);
});

test('gwiazdy: kwadraty instancjonowane z jednym przeplecionym buforem danych, kwadrat punktu z GL', () => {
  const n = 3;
  const arrays = starArrays(n);
  const data = packStarInstances(arrays, n);
  assert.equal(data.length, n * STAR_INSTANCE_STRIDE);
  for (const [name, [offset, size]] of Object.entries(STAR_INSTANCE_LAYOUT)) {
    for (let s = 0; s < n; s++) for (let c = 0; c < size; c++) {
      assert.equal(data[s * STAR_INSTANCE_STRIDE + offset + c], arrays[name][s * size + c], `${name}[${s}].${c}`);
    }
  }
  const geometry = createStarGeometry(arrays, n);
  assert.equal(geometry.isInstancedBufferGeometry, true);
  assert.equal(geometry.instanceCount, n);
  assert.equal(geometry.index.count, 6);
  const buffers = new Set(Object.values(geometry.attributes).map((a) => (a.isInterleavedBufferAttribute ? a.data : a)));
  assert.equal(buffers.size, 2, 'kwadrat + bufor instancji');
  const instanced = [...buffers].find((b) => b.isInstancedInterleavedBuffer);
  assert.ok(instanced && instanced.meshPerAttribute === 1);
  // Kwadrat CCW w NDC (FrontSide bez odrzucania): (−,−) (+,−) (−,+) | (−,+) (+,−) (+,+)
  const p = geometry.attributes.position.array;
  const idx = geometry.index.array;
  for (let t = 0; t < 2; t++) {
    const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    const area = (p[b * 3] - p[a * 3]) * (p[c * 3 + 1] - p[a * 3 + 1]) - (p[c * 3] - p[a * 3]) * (p[b * 3 + 1] - p[a * 3 + 1]);
    assert.ok(area > 0, `trójkąt ${t} CCW`);
  }

  const material = createStarMaterial(starUniforms());
  assert.equal(material.blending, THREE.AdditiveBlending);
  assert.equal(material.depthWrite, false);
  assert.equal(material.name, PLANET_MATERIAL_NAMES.stars);
  const { vertex, fragment } = buildWGSL(material, geometry);
  // Maska planet: 12 okręgów w jednej tablicy uniformów, pętla.
  assert.match(vertex, /array< vec4<f32>, 12 >/);
  assert.match(vertex, /for \( var i : i32 = 0; i < 12; i \+\+ \)/);
  // Zawinięcie wzoru jak GLSL mod (x − y·floor(x/y)), nie reszta z dzielenia WGSL.
  assert.match(vertex, /fn tsl_mod_float\( x : f32, y : f32 \) -> f32 \{ return x - y \* floor\( x \/ y \); \}/);
  // Dane gwiazdy stałe na kwadracie: varyingi płaskie.
  for (const name of ['vStarBrightness', 'vStarColor', 'vStarPlanetMask']) {
    assert.match(fragment, new RegExp(`@interpolate\\( flat, either \\) ${name}`), name);
  }
  assert.ok(uniformBuffers(vertex) <= 4 && uniformBuffers(fragment) <= 4);
  // Punkty: discard po próbce tekstury (jednolity przepływ dla pochodnych). Smugi warpa (zadanie
  // 22) — profil analityczny, bez próbki; obie gałęzie po jednolitym warunku z uniformu warpa.
  const sample = fragment.indexOf('textureSample(');
  assert.ok(sample >= 0 && fragment.indexOf('discard', sample) > sample, 'próbka przed discard');
  for (const name of ['vStarAlong', 'vStarSide', 'vStarLen', 'vStarWidth', 'vStarSt']) assert.match(vertex, new RegExp(name), name);
});
