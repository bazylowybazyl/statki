// Port WebGPU ringu „Halo” (zadanie 09): megastruktura (bryły dachu i doków, szkło kopuł, pociągi,
// światła pozycyjne) i miasto (ogrody, przemysł, drzewa) w TSL. Bez GPU: WGSL budowany w Node
// (WGSLNodeBuilder, atrapa kanwy — jak tests/haloRingStructureTSL.test.mjs). Stan renderu jak dawny
// ShaderMaterial, warianty dawnych `defines` (HALO_FG, PRIM_FACE_FROM_LOCAL) budowane raz, limity
// WebGPU (bufory uniformów, bufory wierzchołków, varyingi), pułapki WGSL (odwrócone krawędzie
// smoothstep, pow z ujemną podstawą, pochodne w gałęziach, macierze uv tekstur).
// node --test tests/haloRingMegaCityTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { applyRoofPlanUniforms, createHaloUniforms, HALO_UNIFORM_BLOCK } from '../src/3d/haloRing/haloRingUniforms.js';
import { HALO_QUALITY } from '../src/3d/haloRing/haloRingConfig.js';
import { HaloTerrain, HALO_SURFACE_BLOCK_NAME } from '../src/3d/haloRing/haloRingTerrain.js';
import { HALO_MEGA_AIR_STEPS, HaloMegastructure } from '../src/3d/haloRing/haloRingMegastructure.js';
import { HALO_CITY, HaloCity } from '../src/3d/haloRing/haloRingCity.js';
import { buildHaloRoofPlan } from '../src/3d/haloRing/haloRingRoofPlan.js';
import { buildHaloLandmarkPlan } from '../src/3d/haloRing/haloRingLandmarks.js';
import { buildHaloDomePlan } from '../src/3d/haloRing/haloRingDomes.js';
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
  // funkcja w jednej linii (wgslFn: haloFma) albo do zamykającej klamry w osobnej linii
  const one = wgsl.match(new RegExp(`^fn ${name} \\(.*\\}\\s*$`, 'm'));
  if (one) return one[0];
  const m = wgsl.match(new RegExp(`fn ${name} \\([\\s\\S]*?\\n}`));
  return m ? m[0] : '';
};
const mainBody = (wgsl) => wgsl.slice(wgsl.indexOf('fn main('));
function powExponents(wgsl) {
  const out = [];
  for (let at = wgsl.indexOf('pow('); at >= 0; at = wgsl.indexOf('pow(', at + 4)) {
    let depth = 0;
    let comma = -1;
    for (let k = at + 3; k < wgsl.length; k++) {
      const ch = wgsl[k];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) { out.push(wgsl.slice(comma + 1, k).trim()); break; }
      } else if (ch === ',' && depth === 1) comma = k;
    }
  }
  return out;
}

// Atrapy map i detalu jak w teście terenu; plan dachu z megabudowlami i kopułami jak index.js (assemble).
function fakeMaps(w = 64, h = 16) {
  const mk = (type) => new THREE.RenderTarget(w, h, { type });
  return { current: { A: mk(THREE.HalfFloatType), B: mk(THREE.UnsignedByteType), C: mk(THREE.UnsignedByteType), size: { w, h } }, version: 1, heightAtUV: () => 20 };
}
const fakeDetail = () => ({ tex1: new THREE.RenderTarget(8, 8, { type: THREE.HalfFloatType }).texture, tex2: new THREE.RenderTarget(8, 8, { type: THREE.HalfFloatType }).texture });
function makeParts(key = 'earth', quality = 'high', extra = {}) {
  const layout = layoutOf(key, extra);
  const uniforms = createHaloUniforms(layout);
  const q = HALO_QUALITY[quality];
  const terrain = new HaloTerrain({ layout, uniforms, maps: fakeMaps(), detail: fakeDetail(), quality: q });
  const domain = { Ns: terrain.Ns, ds: terrain.ds, segCount: terrain.rootCount * 8, segCells: terrain.rootCells / 8 };
  const landmarks = buildHaloLandmarkPlan(layout, {});
  const domes = buildHaloDomePlan(layout, {});
  const plan = buildHaloRoofPlan(layout, domain, { landmarks, domes });
  applyRoofPlanUniforms(uniforms, plan);
  const su = terrain.surfaceUniforms;
  const mega = new HaloMegastructure({ layout, uniforms, surfaceUniforms: su, domain, plan, quality: q });
  const city = new HaloCity({ layout, uniforms, surfaceUniforms: su, quality: q, domes });
  return { layout, uniforms, terrain, domain, plan, mega, city, quality: q };
}
const byName = (P) => {
  const [garden, industry] = P.city.buildings;
  return {
    prims: P.mega.prims[0].mesh, landmarks: P.mega.landmarks[0].mesh, glass: P.mega.glass.mesh, trains: P.mega.trains,
    lights: P.mega.lights.mesh, dockLights: P.mega.landmarkLights.mesh, garden, industry, trees: P.city.trees
  };
};
let wgslCache = null;
function allWGSL() {
  if (wgslCache) return wgslCache;
  const P = makeParts();
  const M = byName(P);
  wgslCache = { P, M, out: Object.fromEntries(Object.entries(M).map(([k, mesh]) => [k, buildWGSL(mesh)])) };
  return wgslCache;
}

// ---------------------------------------------------------------------------

test('megastruktura i miasto: bez GLSL, GLSL powierzchni i zestawu przemysłowego poza modułami gry', () => {
  for (const f of ['haloRingMegastructure.js', 'haloRingCity.js']) {
    const src = read(`src/3d/haloRing/${f}`);
    assert.doesNotMatch(src, /\/\* glsl \*\/|new THREE\.ShaderMaterial|gl_FragColor|gl_Position|from '\.\/haloRingGLSL\.js'/, `${f}: bez GLSL`);
  }
  // HALO_GLSL_SURFACE nie ma już użytkowników (teren 07, konstrukcja i atmosfera 08, megastruktura i miasto 09)
  const glsl = read('src/3d/haloRing/haloRingGLSL.js');
  assert.doesNotMatch(glsl, /export const HALO_GLSL_SURFACE/);
  // zestaw przemysłowy w GLSL został tylko dla narzędzia parzystości (znika z haloRingGLSL.js)
  assert.doesNotMatch(read('src/3d/haloRing/haloRingIndustryKit.js'), /\/\* glsl \*\/|export const HALO_GLSL_INDKIT/);
  assert.match(glsl, /export const HALO_GLSL_INDKIT = /);
});

test('materiały węzłowe ze stanem renderu jak dawny ShaderMaterial (strona, przezroczystość, mieszanie, kolejność)', () => {
  const P = makeParts();
  const M = byName(P);
  for (const [k, mesh] of Object.entries(M)) {
    const m = mesh.material;
    assert.ok(m.isNodeMaterial && !m.isShaderMaterial, k);
    assert.ok(m.vertexNode && m.fragmentNode, `${k}: własne węzły wierzchołków i fragmentu`);
    assert.equal(m.fog, false, k);
    assert.equal(m.toneMapped, false, k);
    assert.equal(mesh.frustumCulled, false, k);
  }
  const expect = {
    prims: ['HaloMegaPrims', THREE.BackSide, false],
    landmarks: ['HaloMegaPrims', THREE.BackSide, false],
    glass: ['HaloDomeGlass', THREE.BackSide, true],
    trains: ['HaloMegaTrains', THREE.BackSide, false],
    lights: ['HaloMegaLights', THREE.FrontSide, true],
    dockLights: ['HaloMegaLights', THREE.FrontSide, true],
    garden: ['HaloCity_garden', THREE.FrontSide, false],
    industry: ['HaloCity_industry', THREE.FrontSide, false],
    trees: ['HaloTrees', THREE.FrontSide, false]
  };
  for (const [k, [name, side, transparent]] of Object.entries(expect)) {
    assert.equal(M[k].material.name, name, k);
    assert.equal(M[k].material.side, side, `${k}: strona`);
    assert.equal(M[k].material.transparent, transparent, `${k}: przezroczystość`);
    assert.equal(M[k].material.depthWrite, !transparent, `${k}: zapis głębi`);
  }
  // szkło kopuł: mieszanie zwykłe (alfa), bez zapisu głębi, po bryłach; BackSide — jeden przebieg
  assert.equal(M.glass.material.blending, THREE.NormalBlending);
  assert.equal(M.glass.material.premultipliedAlpha, false);
  assert.equal(M.glass.renderOrder, 30);
  // światła: (ONE, ONE), alfa celu bez zmian (ZERO, ONE), wyjście bez mnożenia przez alfę
  for (const L of [M.lights, M.dockLights]) {
    const m = L.material;
    assert.deepEqual([m.blending, m.blendSrc, m.blendDst, m.blendSrcAlpha, m.blendDstAlpha],
      [THREE.CustomBlending, THREE.OneFactor, THREE.OneFactor, THREE.ZeroFactor, THREE.OneFactor]);
    assert.equal(m.premultipliedAlpha, false);
    assert.equal(L.renderOrder, 40);
  }
  // wspólne uniformy obiektów (podgląd jak dawniej): zasięg detalu, piksel, komórki na segment
  assert.equal(M.prims.material.uniforms.uGeomFade, M.glass.material.uniforms.uGeomFade);
  assert.equal(M.lights.material.uniforms.uPixelAngle, M.dockLights.material.uniforms.uPixelAngle);
  assert.equal(M.prims.material.uniforms.uSegCells.value, P.domain.segCells);
  assert.equal(M.garden.material.uniforms.uPixelAngle, M.trees.material.uniforms.uPixelAngle);
  assert.equal(M.garden.material.uniforms.uCityGrid.value, P.city.gardenGrid, 'wektor siatki zmieniany w miejscu');
  assert.equal(M.trees.material.uniforms.uTreeGrid.value, P.city.treeGrid);
  assert.equal(M.prims.material.uniforms.uSunDir, P.uniforms.uSunDir);
  // habitat do planety (σ < 0): miasto rysuje tył siatek
  const inward = makeParts('earth', 'high', { habitatFacing: 'inward' });
  assert.ok(inward.layout.sigma < 0);
  for (const m of [...inward.city.buildings, inward.city.trees]) assert.equal(m.material.side, THREE.BackSide);
  // warianty dawnych defines: dach nad płaszczyzną gry (FG) i doki — osobne materiały, budowane raz
  assert.notEqual(P.mega.material, P.mega.landmarkMaterial);
  assert.notEqual(P.mega.material.fragmentNode, P.mega.landmarkMaterial.fragmentNode);
  assert.notEqual(P.mega.lightMaterial.vertexNode, P.mega.landmarkLightMaterial.vertexNode);
  for (const inst of P.mega.prims) assert.equal(inst.mesh.material, P.mega.material, 'bryły dachu na jednym materiale');
  for (const inst of P.mega.landmarks) assert.equal(inst.mesh.material, P.mega.landmarkMaterial, 'bryły doków na jednym materiale');
});

test('WGSL: limity WebGPU — ≤ 4 bufory uniformów na etap, ≤ 8 buforów wierzchołków, ≤ 16 varyingów, tekstury bez macierzy uv', () => {
  const { M, out } = allWGSL();
  for (const [k, { vertex, fragment }] of Object.entries(out)) {
    for (const stage of [vertex, fragment]) {
      const ub = (stage.match(/var<uniform>/g) || []).length;
      assert.ok(ub <= 4, `${k}: ${ub} buforów uniformów (haloRingU, haloSurfU, object, render; limit 12)`);
      assert.ok((stage.match(/var<uniform> haloRingU\b/g) || []).length <= 1, k);
      assert.ok((stage.match(new RegExp(`var<uniform> ${HALO_SURFACE_BLOCK_NAME}\\b`, 'g')) || []).length <= 1, k);
      const obj = stage.match(/struct objectStruct \{[\s\S]*?\};/);
      assert.ok(!obj || !/mat3x3/.test(obj[0]), `${k}: bez macierzy uv tekstur`);
    }
    const vs = vertex.match(/struct VaryingsStruct \{[\s\S]*?\};/);
    const locations = vs ? (vs[0].match(/@location\(/g) || []).length : 0;
    assert.ok(locations <= 16, `${k}: ${locations} varyingów`);
    // tekstury w wierzchołkach tylko z jawnym poziomem mip
    assert.doesNotMatch(mainBody(vertex), /textureSample\(/, `${k}: textureSampleLevel w wierzchołkach`);
  }
  for (const [k, mesh] of Object.entries(M)) {
    const buffers = new Set();
    for (const a of Object.values(mesh.geometry.attributes)) buffers.add(a.isInterleavedBufferAttribute ? a.data : a);
    assert.ok(buffers.size <= 8, `${k}: ${buffers.size} buforów wierzchołków`);
  }
});

test('WGSL: czyste funkcje biblioteki, rosnące stałe krawędzie smoothstep, potęgi całkowite mnożeniem, powietrze 4 kroki', () => {
  const { out } = allWGSL();
  for (const [k, { vertex, fragment }] of Object.entries(out)) {
    for (const stage of [vertex, fragment]) {
      for (const name of [...stage.matchAll(/^fn (halo\w+|ind\w+)/gm)].map((x) => x[1])) {
        assert.doesNotMatch(fnBody(stage, name), /haloRingU|haloSurfU|\bobject\.|\brender\./, `${k}: ${name} czysta`);
      }
      for (const [, x, y] of stage.matchAll(/smoothstep\( (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?),/g)) {
        assert.ok(Number(x) < Number(y), `${k}: smoothstep( ${x}, ${y}, … )`);
      }
      // pow tylko w bibliotece powietrza (1,4 / 1,5 z clamp / max)
      for (const e of powExponents(stage)) assert.ok(['1.4', '1.5'].includes(e), `${k}: pow(…, ${e})`);
    }
    if (['lights', 'dockLights'].includes(k)) continue;
    assert.match(mainBody(fragment), new RegExp(`haloApplyAir${HALO_MEGA_AIR_STEPS}\\( [^;]*haloIGN\\( vec2<f32>\\( fragCoord\\.xy\\.x, \\( object\\.nodeUniform\\d+\\.y - fragCoord\\.xy\\.y \\) \\) \\)`), `${k}: powietrze z ditherem jak WebGL`);
    assert.match(fnBody(fragment, `haloAirIntegrate${HALO_MEGA_AIR_STEPS}`), new RegExp(`i < ${HALO_MEGA_AIR_STEPS};`));
  }
});

test('fragment brył: wariant FG (dach), paleta z bloku ringu, pochodne poza gałęziami, ściany z położenia (ogrody)', () => {
  const { P, out } = allWGSL();
  const lay = P.uniforms[HALO_UNIFORM_BLOCK].layout;
  const idx = (k) => lay.find((e) => e.key === k).index;
  const fg = mainBody(out.prims.fragment);
  const plain = mainBody(out.landmarks.fragment);
  // FG: zanik dachu (uFgFade) i dwa wycięcia (uCutA/uCutB), przerzedzenie IGN z gl_FragCoord (y od dołu)
  for (const main of [fg, mainBody(out.trains.fragment)]) {
    assert.match(main, new RegExp(`haloRingU\\.value\\[ ${idx('uFgFade')}u \\]`));
    assert.match(main, /for \( var i : i32 = 0; i < 2; i \+\+ \)/);
    assert.match(main, /<= haloIGN\( vec2<f32>\( fragCoord\.xy\.x, \( object\.nodeUniform\d+\.y - fragCoord\.xy\.y \) \) \)/);
    assert.match(main, /discard;/);
  }
  for (const main of [plain, mainBody(out.garden.fragment), mainBody(out.industry.fragment)]) {
    assert.doesNotMatch(main, new RegExp(`haloRingU\\.value\\[ ${idx('uFgFade')}u \\]`), 'bez zaniku FG');
    assert.doesNotMatch(main, /discard;/);
  }
  for (const main of [fg, plain, mainBody(out.garden.fragment), mainBody(out.industry.fragment)]) {
    // paleta: uMegaPal[clamp(floor(kod + 0,5), 0, 29)] i stałe 30 (dach-ogród), 31 (dachówka) z bloku ringu
    assert.ok(main.includes(`clamp( floor( ( `) && main.includes(`, 0.0, 29.0 ) ) + ${idx('uMegaPal')} ) ].xyz`), 'paleta z indeksem dynamicznym');
    assert.ok(main.includes(`haloRingU.value[ ${idx('uMegaPal') + 30}u ].xyz`) && main.includes(`haloRingU.value[ ${idx('uMegaPal') + 31}u ].xyz`));
    assert.ok(main.includes(`haloRingU.value[ ${idx('uMegaSky')}u ].xyz`), 'odbicie nieba (uMegaSky)');
    // wszystkie fwidth przed łańcuchem materiałów (pochodne w jednolitym przepływie)
    const chain = main.indexOf('> 16.5');
    assert.ok(chain > 0);
    const lastFw = main.lastIndexOf('fwidth(');
    assert.ok(lastFw > 0 && lastFw < chain, 'pochodne liczone przed gałęziami');
    // fasada megabudowli: trzy skale świateł (okno → grupa 3 × 3 → pas 12 kondygnacji)
    assert.match(main, /\* 0\.302 \) \/ 0\.67 \)/);
    assert.match(main, /haloSunVisibility\(/);
    assert.match(main, /haloPlanetshine\(/);
    assert.match(main, /haloSkyAmbient\(/);
  }
  // ogrody: baza bryły z varyingów (vHaloEx/Ey/Ez), bez normalnej z wierzchołka
  assert.match(out.garden.fragment, /vHaloEx : vec3<f32>/);
  assert.doesNotMatch(out.prims.fragment, /vHaloEx/);
  assert.doesNotMatch(out.garden.fragment, /vHaloNormal/);
});

test('wierzchołki brył, pociągów i świateł: RTE z segmentu (komórki całkowite), kwaternion, billboard z min. pikselem', () => {
  const { P, out } = allWGSL();
  const lay = P.uniforms[HALO_UNIFORM_BLOCK].layout;
  const idx = (k) => lay.find((e) => e.key === k).index;
  const prim = mainBody(out.prims.vertex);
  for (const a of ['iPos : vec4<f32>', 'iSize : vec4<f32>', 'iQuat : vec4<f32>']) assert.ok(prim.includes(a), a);
  // komórki = segment · komórek na segment − refS, zawinięte do obwodu (floor(x / Ns + 0,5))
  assert.match(prim, /\( iPos\.x \* object\.nodeUniform\d+ \) - haloSurfU\.value\[ \d+u \]\.w \)/);
  assert.match(prim, /haloQrot\( iQuat,/);
  assert.match(prim, /haloRelFromPolar\(/);
  assert.match(prim, /object\.nodeUniform\d+ \* vec4<f32>\( nodeVar\d+, 0\.0 \)/, 'obrót grupy bez translacji (w = 0)');
  // pociągi: pozycja z czasu (mod jak GLSL), wagon czołowy z reflektorami (13 + 32)
  const train = mainBody(out.trains.vertex);
  assert.match(train, /tsl_mod_float\( \( iTrainA\.z \* haloRingU\.value\[ \d+u \]\.x \),/);
  assert.match(train, /13\.0 \+/);
  // światła: FG — widoczność dachu w wierzchołkach; doki bez niej
  const lights = mainBody(out.lights.vertex);
  const dock = mainBody(out.dockLights.vertex);
  assert.match(lights, new RegExp(`haloRingU\\.value\\[ ${idx('uFgFade')}u \\]`));
  assert.doesNotMatch(dock, new RegExp(`haloRingU\\.value\\[ ${idx('uFgFade')}u \\]`));
  for (const v of [lights, dock]) {
    assert.match(v, /1\.6 \* object\.nodeUniform\d+ \) \* max\(/, 'rozmiar ≥ 1,6 px');
    assert.match(v, /render\.cameraProjectionMatrix \* vec4<f32>\(/);
  }
  assert.match(mainBody(out.lights.fragment), /exp\( \( \( - dot\( nodeVar0, nodeVar0 \) \) \* 5\.0 \) \) - 0\.0067 \)/);
  assert.match(mainBody(out.lights.fragment), /output\.color = vec4<f32>\( \( vHaloCol \* vec3<f32>\( nodeVar\d+ \) \), 0\.0 \)/);
});

test('wierzchołki miasta: wczesne wyjścia jako gałęzie (wierzchołek zwinięty poza bryłę obcinania), mapy z poziomem 0, detal z mipem 2', () => {
  const { out } = allWGSL();
  for (const k of ['garden', 'industry', 'trees']) {
    const v = mainBody(out[k].vertex);
    assert.match(v, /= vec4<f32>\( 2\.0, 2\.0, 2\.0, 1\.0 \);/, `${k}: domyślnie zwinięty`);
    assert.match(v, /textureSampleLevel\( [^;]*, 0\.0 \)/, `${k}: mapy z poziomem 0`);
  }
  const garden = mainBody(out.garden.vertex);
  // odwrócenie skrzywienia ulic (dwie iteracje) w pętli, detal zmienności z mipem 2
  assert.match(garden, /for \( var i : i32 = 0; i < 2; i \+\+ \)/);
  assert.match(garden, /textureSampleLevel\( [^;]*, 2\.0 \)/);
  assert.match(garden, new RegExp(`\\* ${HALO_CITY.gardenBlockT}\\.0 \\)`));
  // przemysł: części zestawu z haloIndKitTSL (mat4 A/B), walce przez profil promienia i nachylenie
  const ind = out.industry.vertex;
  for (const f of ['indKitPart', 'indCylRadius', 'indCylSlope']) assert.match(ind, new RegExp(`fn ${f} \\(`));
  assert.match(mainBody(ind), new RegExp(`\\* ${HALO_CITY.industryBlockT}\\.0 \\)`));
  // drzewa: slot z indeksu instancji, siatka zakotwiczona w świecie (mod 65536), gatunek po mapie A
  const tree = mainBody(out.trees.vertex);
  assert.match(out.trees.vertex, /@builtin\( instance_index \) instanceIndex : u32/);
  assert.match(tree, /tsl_mod_float\( nodeVar\d+, 65536\.0 \)/);
  assert.match(tree, /haloHash22\(/);
  const firstMap = tree.indexOf('textureSampleLevel(');
  const speciesCut = tree.indexOf('( aSpecies <= -0.5 )');
  assert.ok(firstMap > 0 && speciesCut > firstMap, 'gatunek z mapy A przed resztą');
  assert.equal((tree.slice(0, speciesCut).match(/textureSampleLevel\(/g) || []).length, 1, 'przed odrzuceniem gatunku tylko mapa A');
});

test('ziarna i hasze brył: a·b + c przez fma WGSL (haloFma) tam, gdzie baza WebGL scalała mad — zmierzone na GPU', () => {
  // scripts/webgpu/ring-tsl-parzystosc.mjs: megaSeedFmaWgsl / megaHashFmaWgsl / megaFacadeFmaWgsl = 100% bit w bit
  // z GLSL bazy; wprost (dwa zaokrąglenia) ziarno brył 71,7% — 28% brył z innym wzorem okien fasad
  const { out } = allWGSL();
  for (const k of ['prims', 'landmarks', 'garden', 'industry', 'trains']) {
    const f = out[k].fragment;
    assert.match(f, /fn haloFma \( a : f32, b : f32, c : f32 \) -> f32 \{ return fma\( a, b, c \); \}/, `${k}: haloFma = fma WGSL`);
    const m = mainBody(f);
    assert.match(m, /haloHash12\( haloFmaV2\( nodeVar\d+, 91\.0, floor\(/, `${k}: panel`);
    assert.match(m, /haloHash12\( haloFmaV2\( nodeVar\d+, 57\.0, nodeVar\d+ \) \)/, `${k}: okno`);
    assert.match(m, /haloHash12\( haloFmaV2\( nodeVar\d+, 13\.0, vec2<f32>\( nodeVar\d+, sign\(/, `${k}: lampy tunelu`);
    assert.match(m, /haloFma\( nodeVar\d+, 17\.0, nodeVar\d+\.y \)/, `${k}: kontenery`);
    // fasada: ziarno·13 scalone z iloczynem ściany (mad(ziarno, 13, ściana·7,3)), grupa i okno — obie składowe
    assert.match(m, /haloFma\( nodeVar\d+, 13\.0, \( nodeVar\d+ \* 7\.3 \) \)/, `${k}: pas fasady`);
    assert.match(m, /haloFma\( nodeVar\d+, 17\.3, nodeVar\d+\.x \), haloFma\( nodeVar\d+, 23\.0, nodeVar\d+\.y \)/, `${k}: grupa fasady`);
    assert.match(m, /haloFma\( nodeVar\d+, 31\.7, nodeVar\d+\.x \), haloFma\( nodeVar\d+, 57\.0, nodeVar\d+\.y \)/, `${k}: okno fasady`);
  }
  // ziarna w wierzchołkach: bryły mad(z, 0,0131, mad(segment, 0,61803, wzdłuż·0,01737)), przemysł mad(lotH, 17, część·0,31)
  assert.match(mainBody(out.prims.vertex), /fract\( haloFma\( iPos\.w, 0\.0131, haloFma\( iPos\.x, 0\.61803, \( iPos\.y \* 0\.01737 \) \) \) \)/);
  assert.match(mainBody(out.industry.vertex), /fract\( haloFma\( nodeVar\d+, 17\.0, \( f32\( nodeVar\d+ \) \* 0\.31 \) \) \)/);
  // ogrody: ziarno = hasz działki (wejścia całkowite — bez poprawek)
  assert.match(mainBody(out.garden.vertex), /varyings\.vHaloSeed = nodeVar\d+;/);
});

test('LOD miasta i drzew z jakości (ultra dalej), liczba wierzchołków kawałków bez zmian', () => {
  const high = makeParts('earth', 'high');
  const ultra = makeParts('earth', 'ultra');
  assert.ok(ultra.city.treeCount > high.city.treeCount);
  assert.ok(ultra.city.bldPx.value.x < high.city.bldPx.value.x);
  assert.equal(ultra.city.treePx.value, HALO_QUALITY.ultra.lod.treePixels);
  assert.ok(ultra.mega._geomFade.value.y > high.mega._geomFade.value.y);
  const gRows = Math.ceil(high.layout.floor.length / HALO_CITY.gardenBlockT);
  assert.equal(high.city.gardenVerts, HALO_CITY.gardenChunkBlocks * gRows * 6 * 2 * 8);
  // uniformy zmieniane w miejscu przez update (bez przebudowy)
  const cam = new THREE.Vector3(high.layout.radii.floorMid + 3000, 0, 0);
  high.city.update(cam, 0.0009, null);
  assert.equal(high.city.pixelAngle.value, 0.0009);
  assert.equal(high.city.gardenGrid.w, high.city.stats.fade);
  high.mega.setPixelAngle(0.0011);
  assert.equal(high.mega.lightMaterial.uniforms.uPixelAngle.value, 0.0011);
});
