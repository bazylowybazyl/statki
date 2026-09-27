// Port WebGPU ringu „Halo” (zadanie 07): teren (HaloTerrain) i zestaw przemysłowy w TSL.
// Bez GPU: WGSL budowany w Node (WGSLNodeBuilder, atrapa kanwy — jak tests/haloRingTSL.test.mjs),
// zestaw porównany z bliźniakiem JS (indKitPart) bit w bit. Wynik na GPU (TSL ↔ GLSL ↔ lustro JS):
// scripts/webgpu/ring-tsl-parzystosc.mjs.
// node --test tests/haloRingTerrainTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { Fn, Loop, int, vec2, vec3, vec4, uv } from 'three/tsl';
import { createHaloRingLayout, mulberry32 } from '../src/3d/haloRing/haloRingLayout.js';
import { createHaloUniforms, HALO_UNIFORM_BLOCK } from '../src/3d/haloRing/haloRingUniforms.js';
import { HALO_QUALITY } from '../src/3d/haloRing/haloRingConfig.js';
import {
  IND_KIT_CDF_DEFAULT, IND_KIT_HASH_MUL, IND_MAT, IND_EMIT, IND_PARTS,
  haloIndKitTSL, indKitPart, indKitType, kitParts
} from '../src/3d/haloRing/haloRingIndustryKit.js';
import { HALO_SURFACE_BLOCK, HALO_SURFACE_BLOCK_NAME, HaloTerrain } from '../src/3d/haloRing/haloRingTerrain.js';
import { haloSplitF32 } from '../src/3d/haloRing/haloRingTSL.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';
import { HALO_RING_PLANETS } from '../src/game/haloRingPlanets.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const layoutOf = (key, extra = {}) => createHaloRingLayout({
  planetRadius: RING_PLANET_WORLD_RADII[key], seed: HALO_RING_PLANETS[key].seed, profile: key, ...extra
});

// WGSL w Node: renderer bez init (atrapa kanwy), budowa węzłów jak NodeManager.getForRender.
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const fnBody = (wgsl, name) => {
  const m = wgsl.match(new RegExp(`fn ${name} \\([\\s\\S]*?\\n}`));
  return m ? m[0] : '';
};
const mainBody = (wgsl) => wgsl.slice(wgsl.indexOf('fn main('));

// Atrapy map (cele jak w HaloWorldMaps: A HalfFloat, B/C UnsignedByte) i tekstur detalu.
function fakeMaps(w = 64, h = 16) {
  const mk = (type) => new THREE.RenderTarget(w, h, { type });
  const set = { A: mk(THREE.HalfFloatType), B: mk(THREE.UnsignedByteType), C: mk(THREE.UnsignedByteType), size: { w, h } };
  return { current: set, version: 1, heightAtUV: () => 20 };
}
const fakeDetail = () => ({ tex1: new THREE.RenderTarget(8, 8, { type: THREE.HalfFloatType }).texture, tex2: new THREE.RenderTarget(8, 8, { type: THREE.HalfFloatType }).texture });
function makeTerrain(key = 'earth', quality = 'high', extra = {}) {
  const layout = layoutOf(key, extra);
  const uniforms = createHaloUniforms(layout);
  const maps = fakeMaps();
  const terrain = new HaloTerrain({ layout, uniforms, maps, detail: fakeDetail(), quality: HALO_QUALITY[quality] });
  return { layout, uniforms, maps, terrain };
}

// ---------------------------------------------------------------------------
// Zestaw przemysłowy

test('zestaw: definicja części dla TSL (kitParts) = bliźniak JS indKitPart bit w bit (każdy rodzaj, każda część)', () => {
  const fractJs = (x) => x - Math.floor(x);
  // domyślne progi (Ziemia/Mars/Jowisz) i progi sięgające wszystkich 8 rodzajów (radiatory)
  const cdfs = [IND_KIT_CDF_DEFAULT, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 1.01]];
  const lots = [];
  for (let i = 0; i < 4000; i++) lots.push((i + 0.5) / 4000);
  // wartości float32 (jak lotH z haszu na GPU) i tuż przy progach
  const rand = mulberry32(0x07a1);
  for (let i = 0; i < 2000; i++) lots.push(Math.fround(rand()));
  for (const c of [...IND_KIT_CDF_DEFAULT, 0.1, 0.2, 0.4, 0.5, 0.6, 0.7]) lots.push(c, Math.fround(c), c - 1e-9, c + 1e-9);
  const kinds = new Set();
  let n = 0;
  for (const cdf of cdfs) {
    for (const lotH of lots) {
      const k = indKitType(lotH, cdf);
      kinds.add(k);
      const h = [null, ...IND_KIT_HASH_MUL.map((m) => fractJs(lotH * m))];
      const parts = kitParts(k, h);
      assert.equal(parts.length, IND_PARTS);
      for (let p = 0; p < IND_PARTS; p++) {
        const ref = indKitPart(lotH, p, cdf);
        const got = parts[p] ? { A: parts[p][0], B: parts[p][1] } : { A: [0, 0, 0, 0], B: [0, 0, 0, 0] };
        assert.deepStrictEqual(got, ref, `lotH ${lotH} rodzaj ${k} część ${p}`);
        n++;
      }
    }
  }
  assert.equal(kinds.size, 8, 'wszystkie rodzaje zakładów (także radiatory)');
  assert.ok(n > 60000);
});

test('zestaw w WGSL: czyste funkcje (progi i paleta jako parametry), kody materiałów i kształtów jak w bliźniaku', () => {
  const u = createHaloUniforms(layoutOf('earth'));
  const K = haloIndKitTSL(u);
  assert.equal(haloIndKitTSL(u), K, 'jeden obiekt na ring');
  const m = new THREE.NodeMaterial();
  m.fragmentNode = Fn(() => {
    const acc = vec3(0).toVar();
    Loop(IND_PARTS, ({ i }) => {
      const part = K.indKitPart(uv().x, i).toVar();
      const A = part.element(0);
      const B = part.element(1);
      acc.addAssign(K.indTopColor(B.z, uv().y, uv(), A).add(K.indSegBox(uv(), uv(), A.zw)).add(K.indSegCircle(uv(), uv(), A.z)));
    });
    return vec4(acc.add(K.indCylRadius(uv().x, uv().y)).add(K.indCylSlope(uv().x, uv().y)).add(K.indKitType(uv().x)), 1.0);
  })();
  const frag = buildWGSL(new THREE.Mesh(new THREE.PlaneGeometry(), m)).fragment;
  assert.match(frag, /fn indKitPart \( lotH : f32, p : i32, cdf0 : vec4<f32>, cdf1 : vec4<f32> \) -> mat4x4<f32>/);
  assert.match(frag, /fn indKitType \( lotH : f32, cdf0 : vec4<f32>, cdf1 : vec4<f32> \) -> f32/);
  assert.match(frag, /fn indTopColorBase \( mat : f32, seed : f32, q : vec2<f32>, A : vec4<f32>, pal29 : vec3<f32> \) -> vec3<f32>/);
  for (const name of ['indKitType', 'indKitPart', 'indTopColorBase', 'indSegBox', 'indSegCircle', 'indCylRadius', 'indCylSlope']) {
    const body = fnBody(frag, name);
    assert.ok(body, `fn ${name}`);
    assert.doesNotMatch(body, /haloRingU|NodeBuffer|\bobject\.|\brender\./, `${name}: uniform z domknięcia (setLayout buforuje kod globalnie)`);
  }
  // progi rodzajów po kolei z parametrów (lustro indKitType: pierwszy k z lotH < cdf[k])
  const type = fnBody(frag, 'indKitType');
  const order = [...type.matchAll(/lotH < (cdf[01]\.[xyzw])/g)].map((x) => x[1]);
  assert.deepEqual(order, ['cdf0.x', 'cdf0.y', 'cdf0.z', 'cdf0.w', 'cdf1.x', 'cdf1.y', 'cdf1.z']);
  // kody materiałów (materiał + 32 · emisja) i kształty walców z bliźniaka
  const part = fnBody(frag, 'indKitPart');
  const codes = new Set();
  for (let lot = 0; lot < 4000; lot++) {
    for (let p = 0; p < IND_PARTS; p++) {
      const { B } = indKitPart((lot + 0.5) / 4000, p, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 1.01]);
      if (B[1] > 0) codes.add(`${B[2].toFixed(1)}, ${B[3].toFixed(1)}`);
    }
  }
  for (const c of codes) assert.ok(part.includes(`${c} )`), `kod materiału/kształtu (${c}) w indKitPart`);
  assert.ok(codes.has(`${(IND_MAT.sawtooth + 32 * IND_EMIT.sodium).toFixed(1)}, 0.0`));
  // stałe haszy działki
  for (const mul of IND_KIT_HASH_MUL) assert.match(part, new RegExp(`fract\\( \\( lotH \\* ${String(mul).replace('.', '\\.')} \\) \\)`));
});

// ---------------------------------------------------------------------------
// Teren

test('a·b + c z jednym zaokrągleniem (haloFusedMulAddInt): stała rozbita na dwie dokładne połowy, wynik = FMA', () => {
  const f = Math.fround;
  for (const b of [3.1, 0.1031, 12.9898, -7.31, 43758.5453, 1.37]) {
    const [hi, lo] = haloSplitF32(b);
    assert.equal(hi + lo, f(b), `${b}: hi + lo = float32(b)`);
    assert.equal(f(hi), hi);
    assert.equal(f(lo), lo);
    // każda połowa ma najwyżej 12 bitów mantysy → a·połowa dokładne dla |a| < 4096
    for (const x of [hi, lo]) {
      if (x === 0) continue;
      const m = Math.abs(x) / 2 ** Math.floor(Math.log2(Math.abs(x)));
      assert.ok(Number.isInteger(m * 2 ** 11), `${b}: ${x} ma ≤ 12 bitów`);
    }
  }
  // lustro JS działań węzła (float32 po każdym kroku) = jedno zaokrąglenie a·b + c (FMA)
  const [hi, lo] = haloSplitF32(3.1);
  let diffNaive = 0;
  for (let a = -64; a < 4096; a++) {
    const split = f(f(f(a * hi) + 5) + f(a * lo));
    const fused = f(a * f(3.1) + 5);
    assert.equal(split, fused, `a = ${a}`);
    if (f(f(a * f(3.1)) + 5) !== fused) diffNaive++;
  }
  assert.ok(diffNaive > 0, 'dwa zaokrąglenia (mnożenie, potem dodanie) dają inne wyniki — stąd poprawka');
  const src = read('src/3d/haloRing/haloRingTerrain.js');
  assert.match(src, /haloHash12\(haloFusedMulAddInt\(bid, 3\.1, 5\.0\)\)/, 'jasność kwartału przez haloFusedMulAddInt');
});

test('teren: materiał węzłowy bez GLSL, jedna definicja wierzchołków i fragmentu, bez mgły i tone mappingu', () => {
  const src = read('src/3d/haloRing/haloRingTerrain.js');
  assert.doesNotMatch(src, /\/\* glsl \*\/|new THREE\.ShaderMaterial|gl_FragColor|gl_Position|from '\.\/haloRingGLSL\.js'/, 'haloRingTerrain.js bez GLSL');
  // GLSL powierzchni dla materiałów 09 jest w haloRingGLSL.js (nie w module terenu); pokrycie
  // chmur (CLOUDCOVER) zniknęło z portem atmosfery (08 — tests/haloRingStructureTSL.test.mjs)
  const glsl = read('src/3d/haloRing/haloRingGLSL.js');
  assert.match(glsl, /export const HALO_GLSL_SURFACE = /);
  for (const f of ['haloRingAtmosphere.js', 'haloRingCity.js', 'haloRingMegastructure.js', 'haloRingStructure.js']) {
    assert.doesNotMatch(read(`src/3d/haloRing/${f}`), /from '\.\/haloRingTerrain\.js'/, `${f}: GLSL powierzchni z haloRingGLSL.js`);
  }
  const { terrain, layout } = makeTerrain();
  const m = terrain.material;
  assert.ok(m.isNodeMaterial);
  assert.equal(m.name, 'HaloTerrain');
  assert.ok(m.vertexNode && m.fragmentNode);
  assert.equal(m.side, layout.sigma > 0 ? THREE.BackSide : THREE.FrontSide);
  assert.equal(m.fog, false);
  assert.equal(m.toneMapped, false);
  // habitat do planety (σ < 0): przód siatki
  const inward = makeTerrain('earth', 'high', { habitatFacing: 'inward' });
  assert.equal(inward.layout.sigma < 0, true);
  assert.equal(inward.terrain.material.side, THREE.FrontSide);
});

test('teren w WGSL: CDLOD w wierzchołkach (Loop, próbkowanie z poziomem mip), dwa bufory uniformów ringu, czyste funkcje', () => {
  const { terrain, uniforms } = makeTerrain();
  const { vertex, fragment } = buildWGSL(terrain.mesh);
  // wierzchołki: atrybut instancji iNode, varyingi, morph w pętli, tylko textureSampleLevel
  assert.match(vertex, /@location\( \d+ \) iNode : vec4<f32>/);
  for (const v of ['vHaloRel : vec3<f32>', 'vHaloST : vec2<f32>', 'vHaloUvMap : vec2<f32>']) assert.ok(vertex.includes(v), v);
  assert.match(mainBody(vertex), /for \( var i : i32 = 0; i < 4; i \+\+ \)/, 'kaskadowy morph CDLOD w pętli (nie rozwinięty)');
  assert.doesNotMatch(vertex, /textureSample\(/, 'w wierzchołkach tylko textureSampleLevel');
  assert.match(vertex, /haloSurfU\.value\[ \( nodeVar\d+ \+ \d+ \) \]\.xy/, 'zasięgi morphu uLodMorph[kk] z bloku (indeks dynamiczny)');
  // bufory: blok ringu i blok powierzchni po jednym, bez macierzy uv na każde próbkowanie
  for (const stage of [vertex, fragment]) {
    assert.equal((stage.match(/var<uniform> haloRingU\b/g) || []).length, 1);
    assert.equal((stage.match(new RegExp(`var<uniform> ${HALO_SURFACE_BLOCK_NAME}\\b`, 'g')) || []).length, 1);
    assert.ok((stage.match(/var<uniform>/g) || []).length <= 4, 'haloRingU, haloSurfU, render, object');
    const obj = stage.match(/struct objectStruct \{[\s\S]*?\};/);
    assert.ok(!obj || !/mat3x3/.test(obj[0]), 'bez uniformów macierzy uv tekstur (updateMatrix)');
  }
  // fragment: pętle cienia terenu (7 kroków) i części działki (5), jedno wywołanie indKitPart
  const main = mainBody(fragment);
  assert.match(main, /for \( var i : i32 = 0; i < 7; i \+\+ \)/);
  assert.match(main, /for \( var i : i32 = 0; i < 5; i \+\+ \)/);
  assert.equal((main.match(/indKitPart\(/g) || []).length, 1);
  // progi zestawu z uniformów ringu (uIndKitCdf0/1 bloku haloRingU)
  const lay = uniforms[HALO_UNIFORM_BLOCK].layout;
  const idx = (k) => lay.find((e) => e.key === k).index;
  assert.match(main, new RegExp(`indKitPart\\( nodeVar\\d+, i, haloRingU\\.value\\[ ${idx('uIndKitCdf0')}u \\], haloRingU\\.value\\[ ${idx('uIndKitCdf1')}u \\] \\)`));
  assert.match(main, /discard;/, 'wycięcie tranzytu');
  // dither powietrza z gl_FragCoord jak w WebGL (y od dołu celu)
  assert.match(main, /haloIGN\( vec2<f32>\( fragCoord\.xy\.x, \( object\.nodeUniform\d+\.y - fragCoord\.xy\.y \) \) \)/);
  assert.match(main, /haloApplyAir8\(/);
  // funkcje biblioteki i zestawu czyste (kod wspólny dla wszystkich materiałów ringu)
  for (const name of [...fragment.matchAll(/^fn ((?:halo|ind)\w+)/gm)].map((x) => x[1])) {
    assert.doesNotMatch(fnBody(fragment, name), /haloRingU|haloSurfU|\bobject\.|\brender\./, `${name} czysta`);
  }
  // stałe krawędzie smoothstep rosnące (odwrotne = błąd WGSL; te idą przez haloSmooth)
  for (const [, a, b] of `${vertex}\n${fragment}`.matchAll(/smoothstep\( (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?),/g)) {
    assert.ok(Number(a) < Number(b), `smoothstep( ${a}, ${b}, … )`);
  }
});

test('teren: wariant kompilacji tylko z liczby kroków powietrza (jakość), jakość w uniformach', () => {
  for (const [q, steps] of [['low', 4], ['medium', 6], ['high', 8], ['ultra', 12]]) {
    const { terrain } = makeTerrain('earth', q);
    const frag = buildWGSL(terrain.mesh).fragment;
    assert.match(frag, new RegExp(`fn haloApplyAir${steps} \\(`), `${q}: haloApplyAir${steps}`);
    assert.match(fnBody(frag, `haloAirIntegrate${steps}`), new RegExp(`i < ${steps};`), `${q}: pętla powietrza ${steps} kroków`);
    assert.equal(terrain.gridDiv, HALO_QUALITY[q].gridDiv);
  }
});

test('teren: uniformy powierzchni w jednym bloku — klucze i .value jak dawniej (CDLOD, wzory, mapy)', () => {
  const { terrain, maps } = makeTerrain();
  const su = terrain.surfaceUniforms;
  const block = su[HALO_SURFACE_BLOCK];
  assert.ok(block?.node?.isNode, 'blok poza kluczami');
  assert.ok(!Object.keys(su).some((k) => typeof k !== 'string'));
  for (const k of ['uMapA', 'uMapB', 'uMapC', 'uMapSize', 'uDetail1', 'uDetail2', 'uDetailN', 'uDetailOff', 'uCloudS0', 'uCloudT0',
    'uCloudOff0', 'uGridInfo', 'uLodMorph', 'uExposedLines', 'uVarN', 'uVarOff', 'uPatT', 'uPatF', 'uPatI', 'uPatN']) {
    assert.ok(su[k], k);
  }
  const el = (k, i = 0) => block.node.array[block.layout.find((e) => e.key === k).index + i];
  // mapy: węzły texture() z teksturami bieżącego zestawu; rozmiar mapy w bloku
  assert.equal(su.uMapA.value, maps.current.A.texture);
  assert.equal(su.uMapC.value, maps.current.C.texture);
  assert.deepEqual(el('uMapSize').toArray(), [64, 16, 1 / 64, 1 / 16]);
  // podmiana mapy (pełna rozdzielczość) — ten sam węzeł, nowa tekstura
  const full = fakeMaps(128, 32).current;
  maps.current = full;
  maps.version++;
  terrain.update({ camLocal: new THREE.Vector3(43000, 0, 0), refS: 1234, camera: new THREE.PerspectiveCamera(), ringMatrixWorld: new THREE.Matrix4() });
  assert.equal(su.uMapA.value, full.A.texture);
  assert.equal(el('uMapSize').x, 128);
  assert.equal(el('uGridInfo').w, 1234, 'refS w uGridInfo.w');
  // zasięgi morphu CDLOD per LOD (początek = koniec × morphStart, poza maxLod 1e9)
  const lod = su.uLodMorph.value;
  assert.equal(lod.length, 12);
  assert.ok(Math.abs(lod[0].x / lod[0].y - 0.72) < 1e-9);
  assert.equal(lod[terrain.maxLod].y, 1e9);
  // wzory zakotwiczone w świecie: setReference pisze ułamki i indeksy do bloku
  terrain.setReference(123456.75);
  for (let i = 0; i < terrain.patterns.length; i++) {
    const { size, count } = terrain.patterns[i];
    const x = 123456.75 / size;
    assert.ok(Math.abs(su.uPatF.value[i] - (x - Math.floor(x))) < 1e-9);
    assert.equal(el('uPatI', i).x, ((Math.floor(x) % count) + count) % count);
    assert.equal(su.uPatN.value[i], count, 'uPatN (miasto czyta pn[0], pn[1])');
  }
  assert.ok(el('uDetailOff').x > 0 && el('uDetailOff').x < 1);
  // materiał: podgląd wartości jak dawniej (material.uniforms)
  assert.equal(terrain.material.uniforms.uPatN, su.uPatN);
  assert.equal(terrain.material.uniforms.uSunDir, terrain.uniforms.uSunDir);
});

test('teren: wybór węzłów CDLOD bez zmian — węzły w kadrze, liczba instancji, zakres aktualizacji', () => {
  const { terrain, layout } = makeTerrain();
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 10, 400000);
  const R = layout.radii.floorMid;
  cam.position.set(R + 600, 0, 0);
  cam.up.set(0, 0, 1);
  cam.lookAt(R, 3000, 0);
  cam.updateMatrixWorld();
  const floorMid = layout.radii.floorMid;
  const refS = Math.round(0 * floorMid / terrain.ds);
  terrain.update({ camLocal: cam.position.clone(), refS, camera: cam, ringMatrixWorld: new THREE.Matrix4() });
  assert.ok(terrain.activeNodes > 0 && terrain.activeNodes <= terrain.capacity);
  assert.equal(terrain.geometry.instanceCount, terrain.activeNodes);
  assert.deepEqual(terrain.nodeAttr.updateRanges.map((r) => [r.start, r.count]), [[0, terrain.activeNodes * 4]]);
  // węzły: s względem refS (zawinięte), t w siatce, poziomy LOD 0..maxLod
  for (let i = 0; i < terrain.activeNodes; i++) {
    const k = terrain.nodeData[i * 4 + 3];
    assert.ok(Number.isInteger(k) && k >= 0 && k <= terrain.maxLod);
    assert.ok(Math.abs(terrain.nodeData[i * 4]) <= terrain.Ns / 2 + terrain.rootCells);
  }
  assert.ok(terrain.triangleEstimate > 0);
  terrain.dispose();
});
