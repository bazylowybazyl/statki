// Port WebGPU ringu „Halo” (zadanie 06): biblioteka TSL (haloRingTSL.js), blok
// uniformów, pieczenie map w TSL, odczyt CPU asynchroniczny. Bez GPU: WGSL
// budowany w Node przez WGSLNodeBuilder (WebGPURenderer bez init, atrapa kanwy),
// HaloWorldMaps na atrapie renderera.
// node --test tests/haloRingTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, uv, screenCoordinate, texture } from 'three/tsl';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { createHaloUniforms, HALO_UNIFORM_BLOCK } from '../src/3d/haloRing/haloRingUniforms.js';
import {
  HALO_TSL_FUNCTIONS, haloRingTSL, haloRingSurfaceTSL, haloHashI, haloGnoise3, haloGnoise2P, haloWorleyP, haloAirIntegrateFn
} from '../src/3d/haloRing/haloRingTSL.js';
import { createUniformBlock, nodeOf } from '../src/3d/haloRing/haloUniformsAdapter.js';
import { HaloWorldMaps, createHaloBakeWarmup, haloCpuMapSize, haloUnpackReadback, makeHaloBakeMaterial } from '../src/3d/haloRing/haloRingWorldGen.js';
import { HALO_QUALITY } from '../src/3d/haloRing/haloRingConfig.js';
import { haloLowbias, haloHashI as haloHashICpu } from '../src/3d/haloRing/haloRingRoofPlan.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';
import { HALO_RING_PLANETS } from '../src/game/haloRingPlanets.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const layoutOf = (key) => createHaloRingLayout({ planetRadius: RING_PLANET_WORLD_RADII[key], seed: HALO_RING_PLANETS[key].seed, profile: key });

// WGSL w Node: renderer bez init (atrapa kanwy), budowa węzłów jak NodeManager.getForRender.
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
// próbkowanie tekstur pyta o cechy urządzenia (float32-filterable) — bez GPU: brak cech
renderer.hasFeature = () => false;
function buildWGSL(material, geometry = new THREE.PlaneGeometry()) {
  const mesh = new THREE.Mesh(geometry, material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const fnBody = (wgsl, name) => {
  const m = wgsl.match(new RegExp(`fn ${name} \\([\\s\\S]*?\\n}`));
  return m ? m[0] : '';
};
const uniformBuffers = (wgsl) => (wgsl.match(/var<uniform>/g) || []).length;

// Materiał z (prawie) całej biblioteki na uniformach ringu.
function libraryMaterial(u) {
  const H = haloRingTSL(u);
  const m = new THREE.NodeMaterial();
  m.fragmentNode = Fn(() => {
    const p = vec3(uv().x.mul(40000), uv().y.mul(40000), 100).toVar();
    const L = H.uniforms.uSunDir;
    const n = vec3(0, 0, 1);
    const col = H.haloApplyAir(H.haloSunVisibility(p, L).add(H.haloPlanetshine(p, n)).add(H.haloSkyAmbient(p, n)),
      p.sub(H.uniforms.uCamLocal), H.haloIGN(screenCoordinate.xy), 8);
    const air = H.haloAirIntegrate(H.uniforms.uCamLocal, n, 0.0, 100.0, 0.5, 6);
    const extra = H.haloSkyGain(air.element(1)).add(H.haloStormFlash(p.x, p.y)).add(H.haloInTransitCut(p.x, p.z).select(1.0, 0.0))
      .add(H.haloPortPad(p.x, p.y, 1000.0, 0.0, 300.0)).add(H.haloPortZones(p.x, p.y, 1000.0, 50.0).x).add(H.haloFgVisibility(p))
      .add(H.haloAltitude(p)).add(H.haloAirExit(p, n)).add(H.haloLuma(p)).add(H.haloRelFromPolar(float(0.01), float(5), float(10)).x)
      .add(haloHashI(float(3), float(4), float(5))).add(haloGnoise3(p.mul(0.01))).add(haloGnoise2P(p.xy, vec2(8, 8), 1.0)).add(haloWorleyP(p.xy, vec2(32, 32), 11.0).x);
    H.haloFgClip(p);
    return vec4(col.add(air.element(0)).add(extra), 1.0);
  })();
  return m;
}

test('biblioteka: każda funkcja WGSL jest czysta (uniformy tylko jako parametry) — kod wspólny dla materiałów i ringów', () => {
  const uE = createHaloUniforms(layoutOf('earth'));
  const uM = createHaloUniforms(layoutOf('mars'));
  const a = buildWGSL(libraryMaterial(uE)).fragment;
  const b = buildWGSL(libraryMaterial(uM)).fragment;
  const names = [...a.matchAll(/^fn (halo\w+)/gm)].map((m) => m[1]);
  for (const name of ['haloSunVisibility', 'haloRingBlock', 'haloPlanetTransmit', 'haloPlanetshine', 'haloSkyAmbient',
    'haloAirIntegrate8', 'haloAirIntegrate6', 'haloApplyAir8', 'haloAirEntry', 'haloAirDensity', 'haloStormFlash',
    'haloInTransitCut', 'haloRelFromPolar', 'haloLowbias', 'haloHashI', 'haloGnoise3', 'haloGnoise2P', 'haloWorleyP']) {
    assert.ok(names.includes(name), `brak fn ${name}`);
  }
  for (const name of names) {
    const body = fnBody(a, name);
    // globalny bufor kodu funkcji three: uniform w domknięciu wskazałby cudzy slot w drugim materiale
    assert.doesNotMatch(body, /\bobject\.|\brender\.|\bframe\.|NodeBuffer|haloRingU|haloBakeU/, `${name} czyta uniform/bufor z domknięcia`);
    // ta sama funkcja w materiale innego ringu — identyczny kod (jeden program WGSL na trzy ringi)
    assert.equal(fnBody(b, name), body, `${name}: inny kod dla Marsa`);
  }
  // te same funkcje i to samo ciało main dla Ziemi i Marsa (stała nazwa bloku); kolejność
  // deklaracji zależy od kolejności budowy (pierwsza budowa buduje funkcje, kolejne biorą je z bufora three)
  const namesB = [...b.matchAll(/^fn (halo\w+)/gm)].map((m) => m[1]);
  assert.deepEqual([...namesB].sort(), [...names].sort());
  assert.equal(fnBody(b, 'main'), fnBody(a, 'main'));
});

test('hasz całkowity w WGSL = lowbias32 z lustra CPU (bit w bit: u32, stałe, przesunięcia)', () => {
  const frag = buildWGSL(libraryMaterial(createHaloUniforms(layoutOf('earth')))).fragment;
  const low = fnBody(frag, 'haloLowbias');
  assert.match(low, /fn haloLowbias \( x : u32 \) -> u32/);
  const steps = [...low.matchAll(/nodeVar0 = \( nodeVar0 (\^|\*) ([^;]+) \);/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(steps, ['^ ( nodeVar0 >> 16u )', `* ${0x7feb352d}u`, '^ ( nodeVar0 >> 15u )', `* ${0x846ca68b}u`, '^ ( nodeVar0 >> 16u )']);
  const hi = fnBody(frag, 'haloHashI');
  assert.match(hi, /f32\( \( haloLowbias\( \( u32\( a \) \^ haloLowbias\( \( u32\( b \) \^ haloLowbias\( u32\( salt \) \) \) \) \) \) >> 8u \) \) \/ 16777216\.0/);
  // lustro CPU (te same stałe) — wartości policzone niezależnie (tests/haloRingRoofPlan.test.mjs)
  assert.equal(haloLowbias(123456789), 2834422664);
  assert.equal(haloHashICpu(4703, 7, 12), 0.757071316242218);
  // symulacja WGSL na u32 (Math.imul) daje to samo co lustro
  const u32 = (x) => x >>> 0;
  const wgslLowbias = (x) => {
    x = u32(x);
    x = u32(x ^ (x >>> 16)); x = u32(Math.imul(x, 2146121005));
    x = u32(x ^ (x >>> 15)); x = u32(Math.imul(x, 2221713035));
    x = u32(x ^ (x >>> 16));
    return x;
  };
  for (const x of [0, 1, 7, 12, 4703, 123456789, 0xffffffff]) assert.equal(wgslLowbias(x), haloLowbias(x));
});

test('blok uniformów ringu: klucze jak dotąd, .value działa, JEDEN bufor uniformów w materiale', () => {
  const u = createHaloUniforms(layoutOf('earth'));
  const keys = Object.keys(u);
  for (const k of ['uTime', 'uRing', 'uRingZ', 'uSunDir', 'uPortRects', 'uPortZones', 'uCutA', 'uCutB', 'uSectorClass', 'uMegaPal', 'uTerPal', 'uSkyTint', 'uIndKitCdf1']) {
    assert.ok(keys.includes(k), k);
  }
  assert.ok(u[HALO_UNIFORM_BLOCK]?.node?.isNode, 'blok poza kluczami (niewyliczalny)');
  assert.ok(!keys.some((k) => typeof k !== 'string'));
  // semantyka .value jak w obiektach { value }
  u.uTime.value += 0.5;
  assert.equal(u.uTime.value, 0.5);
  u.uSunDir.value.set(0, 0, 1);
  assert.deepEqual(u.uSunDir.value.toArray(), [0, 0, 1]);
  u.uPortRects.value[2].set(1, 2, 3, 4);
  u.uSectorClass.value[5] = 3;
  assert.equal(u.uSectorClass.value[5], 3);
  assert.equal(u.uSectorClass.value.length, 32);
  u.uMegaPal.value.forEach((v, i) => v.set(i, 0, 0));
  // wartości trafiają do elementów bloku (uniformArray vec4 → bufor)
  const block = u[HALO_UNIFORM_BLOCK];
  const el = (k, i = 0) => block.node.array[block.layout.find((e) => e.key === k).index + i];
  assert.equal(el('uTime').x, 0.5);
  assert.deepEqual([el('uPortRects', 2).x, el('uPortRects', 2).w], [1, 4]);
  assert.equal(el('uSectorClass', 5).x, 3);
  assert.equal(el('uMegaPal', 31).x, 31);
  // materiał z biblioteki: jeden bufor uniformów ringu (limit WebGPU: 12 na etap)
  const frag = buildWGSL(libraryMaterial(u)).fragment;
  assert.equal((frag.match(/var<uniform> haloRingU\b/g) || []).length, 1);
  assert.ok(uniformBuffers(frag) <= 2, `buforów uniformów: ${uniformBuffers(frag)}`);
});

test('createUniformBlock: skalary, wektory, tablice wektorów i liczb; nodeOf zwraca węzeł / tablicę', () => {
  const b = createUniformBlock({ a: 2, v: new THREE.Vector3(1, 2, 3), arr: { array: [new THREE.Vector4(1, 0, 0, 0), new THREE.Vector4(2, 0, 0, 0)] }, f: { array: [1, 2, 3], type: 'float' } }, 'testBlok');
  assert.equal(b.node.array.length, 1 + 1 + 2 + 3);
  assert.equal(b.uniforms.a.value, 2);
  b.uniforms.a.value = 5;
  assert.equal(b.node.array[0].x, 5);
  assert.ok(nodeOf(b.uniforms.v).isNode);
  const arr = nodeOf(b.uniforms.arr);
  assert.equal(arr.length, 2);
  assert.ok(arr.element(1).isNode);
  b.uniforms.f.value[2] = 9;
  assert.equal(b.node.array[6].x, 9);
});

test('pieczenie map: WGSL z jednym buforem (limit 12), mod jak GLSL, bez pow z ujemną podstawą, kwad v = 0 u góry', () => {
  const maps = new HaloWorldMaps(renderer, layoutOf('earth'), HALO_QUALITY.low);
  const geo = maps.quad.geometry;
  // v = 0 w GÓRNYM wierszu celu (konwencja WebGPU, jak uv QuadMesh): wierzchołek y = +1 ma v = 0
  const pos = geo.attributes.position;
  const uvA = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) assert.equal(uvA.getY(i), pos.getY(i) > 0 ? 0 : 1);
  const first = buildWGSL(maps.materials.A, geo).fragment;
  for (const key of ['A', 'B', 'C']) {
    const frag = key === 'A' ? first : buildWGSL(maps.materials[key], geo).fragment;
    assert.equal(uniformBuffers(frag), 1, `${key}: buforów uniformów ${uniformBuffers(frag)}`);
    assert.match(frag, /var<uniform> haloBakeU\b/);
    assert.match(frag, /tsl_mod_float/, `${key}: mod z semantyką GLSL (x − y·floor(x/y))`);
    assert.doesNotMatch(frag, /[^%]%[^%]/, `${key}: bez % na liczbach zmiennoprzecinkowych`);
    assert.doesNotMatch(frag, /pow\( \( 1\.0 - abs\(/, `${key}: wydmy bez pow z możliwie ujemną podstawą (NaN w WGSL)`);
    for (const fn of ['haloGnoise3', 'haloFbm3', 'haloRidged3', 'haloCraters', 'haloParkSd', 'haloCylP', 'haloPortDS']) {
      assert.match(frag, new RegExp(`fn ${fn} \\(`), `${key}: fn ${fn}`);
    }
  }
  // wyjścia A/B/C jak w GLSL (kolejność kanałów)
  const src = read('src/3d/haloRing/haloRingWorldGen.js');
  assert.match(src, /output === 'A'\) return vec4\(W\.h, W\.riverDist, W\.moist, W\.temp\)/);
  assert.match(src, /output === 'B'\) return vec4\(W\.park, W\.typeW\.y, W\.typeW\.z, W\.typeW\.w\)/);
  assert.match(src, /return vec4\(W\.forest, W\.urban, W\.exposed, W\.rock\)/);
  maps.dispose();
});

// Atrapa renderera: zapisuje kolejność wywołań, odczyt zwraca wiersze z dopełnieniem 256 B,
// wiersz 0 = góra celu (jak WebGPU); kanał 0 = numer wiersza od góry.
function fakeRenderer() {
  const calls = [];
  let target = null;
  return {
    calls,
    autoClear: true,
    async init() { calls.push(['init']); },
    getRenderTarget: () => target,
    setRenderTarget(t) { target = t; },
    async compileAsync(scene) { calls.push(['compile', target?.texture?.type, scene.children[0].material.name]); },
    render(scene) { calls.push(['render', target?.texture?.type, scene.children[0].material.name]); },
    async readRenderTargetPixelsAsync(rt, x, y, w, h) {
      calls.push(['read', w, h]);
      const rowElems = Math.ceil(w * 16 / 256) * 256 / 4;
      const out = new Float32Array((h - 1) * rowElems + w * 4);
      for (let r = 0; r < h; r++) for (let i = 0; i < w; i++) out[r * rowElems + i * 4] = r + i / w;
      return out;
    }
  };
}

test('HaloWorldMaps.init: kompilacja na PRAWDZIWYCH celach przed bake, mapa CPU dopiero po odczycie (bez odwracania osi)', async () => {
  const r = fakeRenderer();
  const layout = layoutOf('earth');
  const maps = new HaloWorldMaps(r, layout, HALO_QUALITY.high);
  assert.equal(maps.cpu, null, 'konstruktor nie piecze (bez GPU)');
  assert.equal(r.calls.length, 0);
  const pending = maps.init();
  assert.equal(maps.cpu, null, 'mapa CPU dopiero po odczycie');
  await pending;
  const kinds = r.calls.map((c) => c[0]);
  const firstRender = kinds.indexOf('render');
  const compiles = r.calls.filter((c) => c[0] === 'compile');
  assert.deepEqual(compiles.map((c) => [c[1], c[2]]), [
    [THREE.HalfFloatType, 'HaloWorldBakeA'], [THREE.UnsignedByteType, 'HaloWorldBakeB'],
    [THREE.UnsignedByteType, 'HaloWorldBakeC'], [THREE.FloatType, 'HaloWorldBakeA']
  ], 'pipeline A dla mapy (rgba16float) i odczytu (rgba32float), B, C (rgba8unorm)');
  assert.ok(kinds.lastIndexOf('compile') < firstRender, 'kompilacja przed pierwszym bake');
  const size = haloCpuMapSize(layout);
  assert.deepEqual([size.w, size.h], [2048, 96]);
  assert.deepEqual(r.calls.find((c) => c[0] === 'read').slice(1), [2048, 96]);
  // wiersz 0 odczytu = góra celu = v ≈ 0 (bake pisze v = 0 u góry) → bez odwracania
  assert.equal(maps.cpu.heights[0], 0);
  assert.equal(maps.cpu.heights[5 * 2048], 5);
  assert.equal(maps.cpu.heights[95 * 2048 + 1024], 95.5);
  // środek teksela (x = 3, wiersz 10) → wartość teksela bez interpolacji
  assert.ok(Math.abs(maps.heightAtUV(3.5 / 2048, 10.5 / 96) - (10 + 3 / 2048)) < 1e-4);
  // setCivic: ponowny bake niskiej i odczyt
  const reads = r.calls.filter((c) => c[0] === 'read').length;
  await maps.setCivic({ landmarks: [], domes: [] });
  assert.equal(r.calls.filter((c) => c[0] === 'read').length, reads, 'bez placów i kopuł bez ponownego bake');
  assert.ok(maps.pending && maps.pending.slices === 24, 'pełna mapa plastrami w tle');
  maps.dispose();
});

test('HaloWorldMaps: dispose w trakcie init kończy budowę bez bake i odczytu', async () => {
  const r = fakeRenderer();
  const maps = new HaloWorldMaps(r, layoutOf('earth'), HALO_QUALITY.low);
  const p = maps.init();
  maps.dispose();
  await p;
  assert.equal(maps.cpu, null);
  assert.ok(!r.calls.some((c) => c[0] === 'render' || c[0] === 'read'));
});

test('odczyt: dopełnienie wierszy do 256 B usunięte, flipY dla celów w orientacji GL', () => {
  const w = 50;
  const h = 3;
  const rowElems = Math.ceil(w * 16 / 256) * 256 / 4;
  assert.equal(rowElems, 256);
  const raw = new Float32Array((h - 1) * rowElems + w * 4);
  for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) raw[r * rowElems + x * 4] = r * 100 + x;
  const a = haloUnpackReadback(raw, w, h);
  assert.equal(a.length, w * h);
  assert.equal(a[0], 0);
  assert.equal(a[w + 7], 107);
  assert.equal(a[2 * w + 49], 249);
  const f = haloUnpackReadback(raw, w, h, { flipY: true });
  assert.equal(f[0], 200);
  assert.equal(f[2 * w + 3], 3);
  assert.throws(() => haloUnpackReadback(new Float32Array(10), w, h));
});

test('rozgrzewka tła menu: pusta scena zgodności (kompilację robi HaloWorldMaps.init na celach bake)', () => {
  const warm = createHaloBakeWarmup();
  assert.equal(warm.scene.children.length, 0);
  assert.doesNotThrow(() => warm.dispose());
});

test('SURFACE i CLOUDCOVER w TSL: próbkowanie detalu, wzory, pokrycie chmur (wklejane, bez funkcji WGSL z uniformami)', () => {
  const u = createHaloUniforms(layoutOf('earth'));
  const tex = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  const su = createUniformBlock({
    uMapSize: new THREE.Vector4(1, 1, 1, 1), uDetailN: new THREE.Vector4(420, 105, 26, 6.5), uDetailOff: new THREE.Vector4(),
    uCloudS0: new THREE.Vector4(1, 1, 1, 1), uCloudT0: new THREE.Vector4(1, 1, 1, 1), uCloudOff0: new THREE.Vector4(),
    uGridInfo: new THREE.Vector4(), uVarN: new THREE.Vector4(1, 1, 1, 1), uVarOff: new THREE.Vector4(),
    uPatT: { array: new Array(8).fill(1), type: 'float' }, uPatF: { array: new Array(8).fill(0), type: 'float' },
    uPatI: { array: new Array(8).fill(0), type: 'float' }, uPatN: { array: new Array(8).fill(1), type: 'float' }
  }, 'haloSurfU').uniforms;
  // tekstury jako węzły texture() (muszą mieć teksturę w chwili budowy materiału)
  Object.assign(su, { uMapA: texture(tex), uMapB: texture(tex), uMapC: texture(tex), uDetail1: texture(tex), uDetail2: texture(tex) });
  const S = haloRingSurfaceTSL(u, su);
  const m = new THREE.NodeMaterial();
  m.fragmentNode = Fn(() => {
    const d = S.haloDetailHeight(float(10), float(20), float(0.5), float(0.1), float(3));
    const c = S.haloCloudCover(float(100), float(200), float(0.5), 3);
    const p = S.haloPat(2, float(5));
    const v = S.haloVar(1, float(5), float(6));
    return vec4(d.add(c).add(vec3(p, 0)), v.x);
  })();
  const frag = buildWGSL(m).fragment;
  assert.match(frag, /fn haloWrapI \(/);
  assert.ok(uniformBuffers(frag) <= 3, `buforów: ${uniformBuffers(frag)}`);
  for (const name of [...frag.matchAll(/^fn (halo\w+)/gm)].map((x) => x[1])) {
    assert.doesNotMatch(fnBody(frag, name), /\bobject\.|NodeBuffer|haloRingU|haloSurfU/, `${name} czysta`);
  }
});

test('biblioteka: warianty kroków powietrza (AIR_STEPS) i lista funkcji', () => {
  assert.notEqual(haloAirIntegrateFn(4), haloAirIntegrateFn(8));
  assert.equal(haloAirIntegrateFn(8), haloAirIntegrateFn(8));
  for (const name of ['haloLowbias', 'haloHashI', 'haloHash12', 'haloGnoise3', 'haloSunVisibility', 'haloPlanetshine', 'haloSkyAmbient', 'haloInTransitCut', 'haloRelFromPolar']) {
    assert.ok(HALO_TSL_FUNCTIONS[name], name);
  }
  // GLSL biblioteki i pieczenia nie importuje już żaden moduł TSL ringu
  for (const f of ['haloRingWorldGen.js', 'haloRingDetail.js', 'haloRingTSL.js', 'haloRingUniforms.js']) {
    const src = read(`src/3d/haloRing/${f}`);
    assert.doesNotMatch(src, /from '\.\/haloRingGLSL\.js'|\/\* glsl \*\/|gl_FragColor|new THREE\.ShaderMaterial/, `${f}: bez GLSL`);
  }
});

test('makeHaloBakeMaterial: NodeMaterial bez blendingu i testu głębi (wartości mapy jak zapisane)', () => {
  const maps = new HaloWorldMaps(renderer, layoutOf('earth'), HALO_QUALITY.low);
  const m = makeHaloBakeMaterial(maps.uniforms, 'C');
  assert.ok(m.isNodeMaterial);
  assert.equal(m.blending, THREE.NoBlending);
  assert.equal(m.depthTest, false);
  assert.equal(m.depthWrite, false);
  m.dispose();
  maps.dispose();
});
