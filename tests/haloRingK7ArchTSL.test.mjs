// Port WebGPU ringu „Halo” (zadanie 10, ring 5/5): hala K-7 i ringi-archetypy Marsa (ECUMENE) i Jowisza
// (Fable) w TSL. Bez GPU: WGSL budowany w Node (WGSLNodeBuilder, atrapa kanwy — jak
// tests/haloRingMegaCityTSL.test.mjs). K-7: graf na ring, wartości na halę (onObjectUpdate, tablice
// pakowane per obiekt), stan renderu jak dawne ShaderMaterial. Archetypy: warianty (FG, atlas, barwy
// w wierzchołkach) budowane raz, partie instancji bez InstancedMesh, kwadraty świateł zamiast punktów,
// pochodne przed gałęziami, hasze z fma jak mad w bazie, limity WebGPU.
// node --test tests/haloRingK7ArchTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { texture, uniform, uniformArray, vec2 } from 'three/tsl';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { createHaloUniforms, HALO_UNIFORM_BLOCK } from '../src/3d/haloRing/haloRingUniforms.js';
import { haloPortComplexAngles } from '../src/3d/haloRing/haloRingConfig.js';
import { createK7Layout } from '../src/3d/haloRing/haloPortK7Layout.js';
import { haloBayLayouts } from '../src/3d/haloRing/haloPortBays.js';
import { HaloPortK7, K7_GROUPS_BLOCK, K7_SURF_BLOCK, K7_SURF_LAYOUT, k7Graphs } from '../src/3d/haloRing/haloPortK7.js';
import { haloNodeMaterial } from '../src/3d/haloRing/haloRingMegastructure.js';
import { ArchBatch } from '../src/3d/haloRing/arch/archFrame.js';
import { ArchLights, ArchMaterials, archBatchMesh, archHemisphere, archPointsMesh, archTreeGeometry, archUnitGeometries } from '../src/3d/haloRing/arch/archMaterials.js';
import { ARCH_INST_LAYOUT, ARCH_INST_STRIDE, ARCH_HASH_FMA } from '../src/3d/haloRing/arch/archTSL.js';
import { makeEcumeneSurfaceNodes } from '../src/3d/haloRing/arch/ecumene.js';
import { makeFableSurfaceNodes } from '../src/3d/haloRing/arch/fable.js';
import { ECU_TYPE_PALETTE } from '../src/3d/haloRing/arch/ecumenePlan.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';
import { HALO_RING_PLANETS } from '../src/game/haloRingPlanets.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const layoutOf = (key) => createHaloRingLayout({ planetRadius: RING_PLANET_WORLD_RADII[key], seed: HALO_RING_PLANETS[key].seed, profile: HALO_RING_PLANETS[key].profile });

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
const mainBody = (wgsl) => wgsl.slice(wgsl.indexOf('fn main('));
const fnBody = (wgsl, name) => {
  const one = wgsl.match(new RegExp(`^fn ${name} \\(.*\\}\\s*$`, 'm'));
  if (one) return one[0];
  const m = wgsl.match(new RegExp(`fn ${name} \\([\\s\\S]*?\\n}`));
  return m ? m[0] : '';
};
const uniformBuffers = (stage) => (stage.match(/var<uniform> (\w+)/g) || []).map((x) => x.slice('var<uniform> '.length));
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
const vertexBuffers = (geometry) => {
  const set = new Set();
  for (const a of Object.values(geometry.attributes)) set.add(a.isInterleavedBufferAttribute ? a.data : a);
  return set.size;
};
function checkLimits(name, mesh, { vertex, fragment }) {
  for (const stage of [vertex, fragment]) {
    const ub = uniformBuffers(stage);
    assert.ok(ub.length <= 4, `${name}: ${ub.length} buforów uniformów (${ub.join(', ')}; limit 12)`);
    assert.ok(ub.filter((x) => x === 'haloRingU').length <= 1, name);
    for (const b of ub) assert.doesNotMatch(b, /^NodeBuffer_\d+$/, `${name}: tablica ${b} bez stałej nazwy (inny WGSL na ring)`);
    const obj = stage.match(/struct objectStruct \{[\s\S]*?\};/);
    assert.ok(!obj || !/mat3x3/.test(obj[0]), `${name}: bez macierzy uv tekstur`);
    for (const [, x, y] of stage.matchAll(/smoothstep\( (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?),/g)) {
      assert.ok(Number(x) < Number(y), `${name}: smoothstep( ${x}, ${y}, … )`);
    }
  }
  const vs = vertex.match(/struct VaryingsStruct \{[\s\S]*?\};/);
  const locations = vs ? (vs[0].match(/@location\(/g) || []).length : 0;
  assert.ok(locations <= 16, `${name}: ${locations} varyingów`);
  assert.ok(vertexBuffers(mesh.geometry) <= 8, `${name}: ${vertexBuffers(mesh.geometry)} buforów wierzchołków`);
}

// ---- K-7: ring Ziemi (uniformy ringu), 4 hale kompleksów jak w index.js
function makeHalls(key = 'earth') {
  const layout = createHaloRingLayout(key === 'earth' ? {} : { planetRadius: RING_PLANET_WORLD_RADII[key], seed: HALO_RING_PLANETS[key].seed, profile: HALO_RING_PLANETS[key].profile });
  const uniforms = createHaloUniforms(layout);
  const bays = haloBayLayouts(layout);
  const halls = haloPortComplexAngles().map((angle, i) => new HaloPortK7({
    ringLayout: layout, uniforms, layout: createK7Layout(), angle, index: i, bays: bays.filter((b) => b.complex === i), style: layout.planetProfile.port
  }));
  for (const h of halls) h.update(0.016, { roofFade: 0.4, daylight: 0.3 });
  return { layout, uniforms, halls };
}
const meshesOf = (hall) => {
  const out = {};
  hall.root.traverse((o) => { if (o.isMesh) out[o.name] = o; });
  return out;
};

// ---------------------------------------------------------------------------

test('K-7 i archetypy: bez GLSL w src/3d/haloRing (poza haloRingGLSL.js dla budowli Z7 i narzędzia parzystości)', () => {
  const files = ['haloPortK7.js', 'arch/archTSL.js', 'arch/archMaterials.js', 'arch/ecumene.js', 'arch/fable.js', 'arch/archRing.js'];
  for (const f of files) {
    const src = read(`src/3d/haloRing/${f}`);
    assert.doesNotMatch(src, /\/\* glsl \*\/|new THREE\.ShaderMaterial|gl_FragColor|gl_Position|from '\.\/haloRingGLSL\.js'|from '\.\.\/haloRingGLSL\.js'/, `${f}: bez GLSL`);
  }
  // archGLSL.js usunięty; w katalogu ringu GLSL ma tylko haloRingGLSL.js (poza grą: budowle Z7 poza portem,
  // narzędzie parzystości GLSL ↔ TSL; tło menu czyta TSL od zadania 11)
  assert.throws(() => read('src/3d/haloRing/arch/archGLSL.js'));
  assert.match(read('src/3d/haloRing/haloRingGLSL.js'), /export const HALO_GLSL_COMMON = /);
});

test('K-7: graf na ring (jeden NodeBuilder na rodzaj), wartości hali w material.uniforms, stan renderu jak dawniej', () => {
  const { uniforms, halls } = makeHalls();
  const G = k7Graphs(uniforms);
  assert.equal(k7Graphs(uniforms), G, 'graf z pamięci podręcznej po uniformach ringu');
  for (const hall of halls) {
    const M = meshesOf(hall);
    assert.equal(M.K7_bg_box.material.vertexNode, G.instance.vertexNode, 'instancje: wspólny węzeł wierzchołków');
    assert.equal(M.K7_bg_box.material.fragmentNode, G.instance.fragmentNode);
    assert.equal(M.K7_plates.material.fragmentNode, G.plate.fragmentNode);
    assert.equal(M.K7_hoses.material.fragmentNode, G.hose.fragmentNode);
    for (const m of Object.values(M)) {
      assert.ok(m.material.isNodeMaterial && !m.material.isShaderMaterial, m.name);
      assert.equal(m.material.fog, false);
      assert.equal(m.material.toneMapped, false);
    }
    // wartości hali: własne uHub / uGroup / lampy, uniformy ringu wspólne
    assert.equal(M.K7_bg_box.material.uniforms.uHub.value, hall.hubMatrix);
    assert.equal(M.K7_bg_box.material.uniforms.uSunDir, uniforms.uSunDir);
    assert.notEqual(M.K7_roof_box.material.uniforms.uRoofOpacity, M.K7_bg_box.material.uniforms.uRoofOpacity, 'dach: własna nieprzezroczystość');
    // dach: przezroczysty przy zaniku (roofFade 0,4), bez zapisu głębi; reszta nieprzezroczysta
    assert.equal(M.K7_roof_box.material.transparent, true);
    assert.equal(M.K7_roof_box.material.depthWrite, false);
    assert.equal(M.K7_roof_slab.material.transparent, true);
    assert.equal(M.K7_bg_box.material.transparent, false);
    assert.equal(M.K7_roof_box.renderOrder, 20);
  }
  assert.notEqual(meshesOf(halls[0]).K7_bg_box.material.uniforms.uHub.value, meshesOf(halls[1]).K7_bg_box.material.uniforms.uHub.value);
  // napisy (atlas per hala — w Node bez kanwy atlasu nie ma): materiał na grafie napisów ze stanem dawnego ShaderMaterial
  const lm = haloNodeMaterial('K7Labels', G.label, {
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  }, { ...uniforms, ...halls[0].k7Uniforms, uAtlas: { value: new THREE.Texture() } });
  assert.equal(lm.premultipliedAlpha, false, 'kolor · alfa liczy shader, mieszanie (ONE, ONE_MINUS_SRC_ALPHA)');
  assert.match(read('src/3d/haloRing/haloPortK7.js'), /nodeMat\('K7Labels', graphs\.label,[\s\S]*blendSrc: THREE\.OneFactor,\s*blendDst: THREE\.OneMinusSrcAlphaFactor,\s*polygonOffset: true,\s*polygonOffsetFactor: -2,\s*polygonOffsetUnits: -2/);
});

test('K-7: tablice hali pakowane per obiekt (grupy ruchome, emisja, lampy, paleta, emisja K-7, poświata)', () => {
  const { uniforms, halls } = makeHalls();
  const { groups, surf } = k7Graphs(uniforms).nodes;
  assert.equal(groups.name, K7_GROUPS_BLOCK);
  assert.equal(surf.name, K7_SURF_BLOCK);
  assert.equal(groups.updateType, THREE.NodeUpdateType.OBJECT, 'macierze grup per obiekt, nie raz na render()');
  assert.equal(surf.updateType, THREE.NodeUpdateType.OBJECT);
  const hall = halls[2];
  const material = meshesOf(hall).K7_bg_box.material;
  groups.value = new Float32Array(40 * 16);
  surf.value = new Float32Array(K7_SURF_LAYOUT.length * 4);
  groups.update({ material });
  surf.update({ material });
  const U = hall.k7Uniforms;
  const cranes = hall.scene.cranes;
  assert.ok(cranes.length > 0);
  const g = cranes[0].bridge;
  assert.deepEqual([...groups.value.subarray(g * 16, g * 16 + 16)], [...U.uGroup.value[g].elements].map((x) => Math.fround(x)));
  const at = (i) => [...surf.value.subarray(i * 4, i * 4 + 4)];
  const f3 = (v) => [v.x, v.y, v.z].map((x) => Math.fround(x));
  assert.deepEqual(at(K7_SURF_LAYOUT.lamps).slice(0, 4), [U.uLamps.value[0].x, U.uLamps.value[0].y, U.uLamps.value[0].z, U.uLamps.value[0].w].map((x) => Math.fround(x)));
  assert.deepEqual(at(K7_SURF_LAYOUT.pal + 3).slice(0, 3), f3(U.uK7Pal.value[3]));
  assert.deepEqual(at(K7_SURF_LAYOUT.k7Emit + 2).slice(0, 3), f3(U.uK7Emit.value[2]));
  assert.deepEqual(at(K7_SURF_LAYOUT.glow + 1).slice(0, 3), f3(U.uK7Glow.value[1]));
  const hoseGroup = hall.scene.hoses[0].group;
  assert.deepEqual(at(K7_SURF_LAYOUT.emit + hoseGroup).slice(0, 3), f3(U.uGroupEmit.value[hoseGroup]));
});

test('K-7 WGSL: wierzchołek instancji = bliźniak JS (kwaternion, skala pionowa, grupa ruchoma), limity WebGPU', () => {
  const { halls } = makeHalls();
  const M = meshesOf(halls[0]);
  const out = {};
  for (const name of ['K7_bg_box', 'K7_roof_box', 'K7_plates', 'K7_hoses']) {
    out[name] = buildWGSL(M[name]);
    checkLimits(name, M[name], out[name]);
  }
  // układ instancji na 16 floatach (bliźniak JS w tests/haloPortK7.test.mjs): iA środek + skala pionowa, iB rozmiar +
  // materiał, iQ kwaternion, iC grupa — jeden przepleciony bufor
  const geo = M.K7_bg_box.geometry;
  assert.deepEqual(['iA', 'iB', 'iQ', 'iC'].map((k) => geo.getAttribute(k).offset), [0, 4, 8, 12]);
  assert.equal(geo.getAttribute('iA').data.stride, 16);
  const v = mainBody(out.K7_bg_box.vertex);
  const lp = v.match(/(nodeVar\d+) = \( position \* iB\.xyz \);/);
  assert.ok(lp, 'lp = position · rozmiar');
  const r = v.match(new RegExp(`(nodeVar\\d+) = haloQrot\\( iQ, ${lp[1]} \\);`));
  assert.ok(r, 'obrót kwaternionem');
  assert.match(v, new RegExp(`\\( iA\\.xyz \\+ vec3<f32>\\( ${r[1]}\\.x, \\( ${r[1]}\\.y \\* iA\\.w \\), ${r[1]}\\.z \\) \\)`), 'hubP = iA.xyz + r (r.y · skala pionowa)');
  assert.match(v, /\( nodeVar\d+\.y \/ max\( iA\.w, 0\.001 \) \)/, 'normalna: y / skala pionowa');
  assert.match(v, /\( i32\( \( iC\.x \+ 0\.5 \) \) \* 4 \)/, 'grupa ruchoma z iC.x (4 kolumny na macierz)');
  assert.match(v, /mat4x4<f32>\( nodeVar\d+, nodeVar\d+, nodeVar\d+, nodeVar\d+ \) \* vec4<f32>\( nodeVar\d+, 1\.0 \)/);
  assert.match(v, /render\.cameraProjectionMatrix \* \( modelViewMatrix \* nodeVar\d+ \)/, 'pozycja przez modelViewMatrix (double na CPU)');
  // qrot: t = 2·(q.xyz × v); v + q.w·t + q.xyz × t
  const q = fnBody(out.K7_bg_box.vertex, 'haloQrot');
  assert.match(q, /cross\( q\.xyz, v \) \* vec3<f32>\( 2\.0 \)/);
  assert.match(q, /\( v \+ \( nodeVar\d+ \* vec3<f32>\( q\.w \) \) \) \+ cross\( q\.xyz, nodeVar\d+ \)/);
  // fragment: pochodne przed gałęziami materiału, x⁵ mnożeniem (bez pow z ujemną podstawą), lampy w pętli, emisja grup
  for (const name of ['K7_bg_box', 'K7_plates']) {
    const f = mainBody(out[name].fragment);
    // fwidth(fuv) zaraz po wyborze ściany (fuv), przed płytami i cieniowaniem — tylko if/else wyboru ściany przed nim
    const fw = f.lastIndexOf('fwidth(');
    assert.ok(fw > 0 && fw < f.indexOf('haloSunVisibility('), `${name}: fwidth przed cieniowaniem`);
    assert.ok((f.slice(0, fw).match(/if \( /g) || []).length <= 2, `${name}: fwidth przed gałęziami materiału`);
    assert.doesNotMatch(f, /pow\(/, `${name}: bez pow`);
    assert.match(f, /for \( var k7Lamp : i32 = 0; k7Lamp < 10; k7Lamp \+\+ \)/);
    assert.match(f, new RegExp(`k7Surf\\.value\\[ \\( ${K7_SURF_LAYOUT.lamps} \\+ k7Lamp \\) \\]`));
    assert.match(f, /output\.color = vec4<f32>\( max\( nodeVar\d+, vec3<f32>\( 0\.0, 0\.0, 0\.0 \) \), object\.nodeUniform\d+ \)/, `${name}: alfa = nieprzezroczystość dachu`);
  }
  assert.match(mainBody(out.K7_bg_box.fragment), /k7Surf\.value\[ \( 0 \+ i32\( \( vK7Group \+ 0\.5 \) \) \) \]\.xyz/, 'emisja grupy (złączki węży)');
  // wąż: pow z nieujemną podstawą (max), bez tablic hali
  assert.deepEqual(powExponents(out.K7_hoses.fragment).filter((e) => !['1.4', '1.5'].includes(e)), ['24.0']);
  assert.ok(!uniformBuffers(out.K7_hoses.fragment).includes(K7_SURF_BLOCK));
});

// ---- archetypy
function makeArch(key) {
  const layout = layoutOf(key);
  const uniforms = createHaloUniforms(layout);
  const mats = new ArchMaterials(uniforms);
  const geos = archUnitGeometries();
  const batch = new ArchBatch('test');
  const m = new Array(16).fill(0);
  m[0] = 10; m[5] = 20; m[10] = 30; m[12] = layout.radii.floorMid; m[15] = 1;
  batch.push16(m, [0.5, 0.4, 0.3], 1, 0.123, 2, 0);
  batch.push16(m, [0.5, 0.4, 0.3], 3, 0.456, 5, 0);
  const lights = new ArchLights();
  lights.add(layout.radii.floorMid, 0, 10, [1, 0.5, 0.2], 20, 0.4);
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  const meshes = {
    instanced: archBatchMesh(batch, geos.box, mats.instanced(false)),
    instancedFG: archBatchMesh(batch, geos.box, mats.instanced(true)),
    trees: archBatchMesh(batch, archTreeGeometry('cone'), mats.instanced(false, true)),
    stripAtlas: new THREE.Mesh(new THREE.PlaneGeometry(1, 1).setAttribute('aAtlas', new THREE.Float32BufferAttribute([0, 0, 0, 0], 1)),
      mats.strip({ map: tex, emap: tex, atlas: true, fg: true })),
    strip: new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mats.strip({ map: tex, emap: tex })),
    glass: archBatchMesh(batch, archHemisphere(), mats.glass({ alpha: 0.1 })),
    lines: new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1], 3)), mats.lines()),
    points: archPointsMesh(lights, mats.points(true))
  };
  return { layout, uniforms, mats, meshes };
}

test('archetypy: materiały ze stanem dawnych ShaderMaterial, warianty raz, partie bez InstancedMesh, światła jako kwadraty', () => {
  const { mats, meshes: M } = makeArch('jupiter');
  assert.equal(mats.instanced(false), M.instanced.material, 'wariant BG z pamięci');
  assert.notEqual(M.instanced.material.fragmentNode, M.instancedFG.material.fragmentNode, 'FG — osobny graf');
  for (const [k, mesh] of Object.entries(M)) {
    assert.ok(mesh.material.isNodeMaterial && !mesh.material.isShaderMaterial, k);
    assert.ok(!mesh.isInstancedMesh && !mesh.isPoints, `${k}: bez InstancedMesh / Points`);
    assert.equal(mesh.material.fog, false);
  }
  // jeden przepleciony bufor instancji: macierz (4 × vec4), barwa, aInst
  const geo = M.instanced.geometry;
  assert.ok(geo.isInstancedBufferGeometry);
  assert.equal(geo.instanceCount, 2);
  for (const [name, [offset, size]] of Object.entries(ARCH_INST_LAYOUT)) {
    assert.equal(geo.getAttribute(name).offset, offset, name);
    assert.equal(geo.getAttribute(name).itemSize, size, name);
    assert.equal(geo.getAttribute(name).data.stride, ARCH_INST_STRIDE);
  }
  assert.equal(geo.getAttribute('iM0').data.array[20], 1, 'aInst.x = rodzaj');
  assert.ok(geo.boundingSphere && geo.boundingSphere.radius > 0, 'obwiednia z instancji (frustum culling)');
  // stany: szkło przezroczyste DoubleSide w jednym przebiegu, linie przezroczyste, pasy DoubleSide nieprzezroczyste,
  // światła (SRC_ALPHA, ONE) dla barwy i alfy jak AdditiveBlending ShaderMaterial w WebGL
  assert.deepEqual([M.glass.material.transparent, M.glass.material.depthWrite, M.glass.material.side, M.glass.material.forceSinglePass], [true, false, THREE.DoubleSide, true]);
  assert.deepEqual([M.lines.material.transparent, M.lines.material.depthWrite], [true, false]);
  assert.deepEqual([M.strip.material.transparent, M.strip.material.side], [false, THREE.DoubleSide]);
  const p = M.points.material;
  assert.deepEqual([p.blending, p.blendSrc, p.blendDst, p.blendSrcAlpha, p.blendDstAlpha, p.premultipliedAlpha],
    [THREE.CustomBlending, THREE.SrcAlphaFactor, THREE.OneFactor, THREE.SrcAlphaFactor, THREE.OneFactor, false]);
  assert.equal(M.points.geometry.instanceCount, 1);
  assert.equal(M.points.geometry.getAttribute('position').count, 4, 'kwadrat punktu');
  // uniformy materiału jak dawniej (.value), rozmiar punktów wspólny
  assert.equal(p.uniforms.uPointScale, mats.pointScale);
  mats.pointScale.value = 777;
  assert.equal(p.uniforms.uPointScale.value, 777);
});

test('archetypy WGSL: limity, pochodne przed gałęziami rodzaju, hasze przez fma (mad bazy), FG z przerzedzeniem, kwadraty punktów', () => {
  const { meshes: M, uniforms } = makeArch('mars');
  const out = {};
  for (const [k, mesh] of Object.entries(M)) {
    out[k] = buildWGSL(mesh);
    checkLimits(k, mesh, out[k]);
  }
  const lay = uniforms[HALO_UNIFORM_BLOCK].layout;
  const idx = (k) => lay.find((e) => e.key === k).index;
  const inst = mainBody(out.instanced.fragment);
  // wszystkie fwidth przed łańcuchem rodzajów materiału (FXC spłaszczał gałęzie z pochodnymi)
  const chain = inst.indexOf('> 1.5 ) && (');
  assert.ok(chain > 0 && inst.lastIndexOf('fwidth(') < chain, 'fwidth przed gałęziami');
  // ziarno instancji i hasze okien / paneli z a·b + c jednym zaokrągleniem (jak mad w bazie WebGL)
  assert.equal(ARCH_HASH_FMA, true);
  assert.match(inst, /floor\( haloFma\( nodeVar\d+\.y, 1000\.0, 0\.5 \) \)/, 'ziarno: floor(vInst.y · 1000 + 0,5)');
  assert.match(inst, /haloHash12\( haloFmaVec2\( haloFmaVec2\( vec2<f32>\( nodeVar\d+, nodeVar\d+ \), vec2<f32>\( 0\.37, 1\.91 \), floor\( nodeVar\d+ \) \), vec2<f32>\( 0\.7071, 0\.7071 \), vec2<f32>\( 13\.17, 71\.3 \) \) \)/, 'okna ECUMENE');
  assert.match(out.instanced.fragment, /fn haloFmaVec2 \( a : vec2<f32>, b : vec2<f32>, c : vec2<f32> \) -> vec2<f32> \{ return fma\( a, b, c \); \}/);
  // wierzchołki przez modelViewMatrix, macierz instancji z atrybutów
  for (const k of ['instanced', 'trees', 'glass']) {
    const v = mainBody(out[k].vertex);
    assert.match(v, /mat4x4<f32>\( iM0, iM1, iM2, iM3 \) \* vec4<f32>\( position, 1\.0 \)/, k);
    assert.match(v, /render\.cameraProjectionMatrix \* \( modelViewMatrix \* nodeVar\d+ \)/, k);
  }
  assert.match(mainBody(out.trees.vertex), /\( iCol \* color \)/, 'barwy w wierzchołkach × barwa instancji');
  // FG: zanik dachu (uFgFade) i przerzedzenie IGN z gl_FragCoord (y od dołu); BG bez
  for (const k of ['instancedFG', 'stripAtlas', 'points']) {
    const f = mainBody(out[k].fragment);
    assert.match(f, new RegExp(`haloRingU\\.value\\[ ${idx('uFgFade')}u \\]`), k);
    assert.match(f, /<= haloIGN\( vec2<f32>\( fragCoord\.xy\.x, \( object\.nodeUniform\d+\.y - fragCoord\.xy\.y \) \) \)/, k);
  }
  assert.doesNotMatch(inst, new RegExp(`haloRingU\\.value\\[ ${idx('uFgFade')}u \\]`), 'BG bez zaniku FG');
  // pasy: wycięcia tranzytów, atlas z gradientem niezawiniętych UV
  const strip = mainBody(out.stripAtlas.fragment);
  assert.match(strip, /if \( haloInTransitCut\(/);
  assert.equal((strip.match(/textureSampleGrad\(/g) || []).length, 2, 'mapa i emisja z textureGrad');
  assert.equal((mainBody(out.strip.fragment).match(/textureSample\(/g) || []).length, 2);
  // punkty: kwadrat ≥ 1 px wokół środka w pikselach celu, gl_PointCoord z rogów, odwrócone krawędzie smoothstep wzorem
  const pv = mainBody(out.points.vertex);
  assert.match(pv, /clamp\( [^;]*, 1\.5, 24\.0 \)/);
  assert.match(pv, /max\( nodeVar\d+, 1\.0 \)/);
  assert.match(pv, /\( 0\.5 - position\.y \)/, 'gl_PointCoord: t w dół');
  const pf = mainBody(out.points.fragment);
  assert.doesNotMatch(pf, /smoothstep\( 1\.0, 0\.15/);
  assert.match(pf, /clamp\( \( \( [^;]* - 1\.0 \) \/ \( 0\.15 - 1\.0 \) \), 0\.0, 1\.0 \)/);
  // pow tylko z nieujemną podstawą (max / clamp) — x³, x⁴ mnożeniem
  for (const [k, { fragment }] of Object.entries(out)) {
    for (const e of powExponents(fragment)) assert.ok(['1.4', '1.5', '40.0', '150.0', '160.0'].includes(e), `${k}: pow(…, ${e})`);
  }
});

test('powierzchnie ECUMENE i Fable (TSL): czyste funkcje pól, pochodne linii przed gałęziami stref, mapa stref textureLoad', () => {
  const mars = layoutOf('mars');
  const um = createHaloUniforms(mars);
  const ecu = uniform(new THREE.Vector4(12000, 3, 6300, 0));
  const pal = uniformArray(ECU_TYPE_PALETTE.map((c) => new THREE.Vector3(...c)), 'vec3').setName('ecuPal');
  const eg = new THREE.PlaneGeometry(1, 1);
  eg.setAttribute('aEcu', new THREE.Float32BufferAttribute(new Float32Array(8), 2));
  const eMesh = new THREE.Mesh(eg, haloNodeMaterial('EcumeneSurface', makeEcumeneSurfaceNodes({ u: um, ecu, pal }), {}, {}));
  const E = buildWGSL(eMesh);
  checkLimits('EcumeneSurface', eMesh, E);
  for (const f of ['ecuWater', 'ecuType', 'ecuEllipse', 'ecuMod']) {
    const body = fnBody(E.fragment, f);
    assert.ok(body, `fn ${f}`);
    assert.doesNotMatch(body, /haloRingU|ecuPal|\bobject\./, `${f} czysta (uEcu w parametrze)`);
  }
  const em = mainBody(E.fragment);
  assert.match(em, /if \( haloInTransitCut\(/);
  assert.match(em, /for \( var ecuPalI : i32 = 1; ecuPalI < 10; ecuPalI \+\+ \)/);
  assert.match(em, /pow\( clamp\( \( [^;]* \/ vec3<f32>\( 255\.0 \) \), vec3<f32>\( 0\.0 \), vec3<f32>\( 1\.0 \) \), vec3<f32>\( 2\.2, 2\.2, 2\.2 \) \)/);
  // stałe 8 · 4,14 i 3 · 4,14 zwinięte w float32 jak w bazie (kreski osi arterii)
  assert.match(em, /ecuMod\( [^;]*, \( 33\.119998931884766 \* [^;]*\( 12\.420000076293945 \* /);

  const jup = layoutOf('jupiter');
  const uj = createHaloUniforms(jup);
  const zoneTex = new THREE.DataTexture(new Uint8Array(16 * 4 * 4), 16, 4, THREE.RGBAFormat);
  zoneTex.magFilter = THREE.NearestFilter;
  zoneTex.minFilter = THREE.NearestFilter;
  zoneTex.wrapS = THREE.RepeatWrapping;
  zoneTex.wrapT = THREE.ClampToEdgeWrapping;
  const fg = new THREE.PlaneGeometry(1, 1);
  fg.setAttribute('aRing', new THREE.Float32BufferAttribute(new Float32Array(8), 2));
  const fMesh = new THREE.Mesh(fg, haloNodeMaterial('FableSurface',
    makeFableSurfaceNodes({ u: uj, zone: texture(zoneTex, vec2(0.0)), fab: uniform(new THREE.Vector4(340000, 5400, 168, 3)) }), {}, {}));
  const F = buildWGSL(fMesh);
  checkLimits('FableSurface', fMesh, F);
  const fm = mainBody(F.fragment);
  assert.match(fm, /textureLoad\( /, 'mapa stref NEAREST: textureLoad');
  assert.match(fm, /tsl_coord_repeatS_clamp_2dT\(/, 'zawinięcie: powtórzenie wzdłuż, obcięcie w poprzek');
  const chain = fm.indexOf('< 0.5 ) ) {');
  assert.ok(chain > 0 && fm.indexOf('fwidth(') < chain, 'pochodne przed gałęziami stref');
  const firstIf = fm.indexOf('if ( ( nodeVar');
  const zoneIf = fm.indexOf('floor( ( ( nodeVar');
  assert.ok(zoneIf > 0 && firstIf > 0);
  // wszystkie fwidth przed pierwszą gałęzią typu strefy (łańcuch If na typie)
  const typeChain = fm.search(/if \( \( nodeVar\d+ < 0\.5 \) \) \{\s*nodeVar\d+ = 1\.0;/);
  assert.ok(typeChain > 0 && fm.lastIndexOf('fwidth(') < typeChain, 'fwidth przed łańcuchem stref');
  for (const f of ['fabNoise', 'fabFbm3']) assert.doesNotMatch(fnBody(F.fragment, f), /haloRingU|\bobject\./, `${f} czysta`);
});
