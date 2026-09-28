// Port WebGPU ringu „Halo” (zadanie 08): konstrukcja (HaloStructure — ściany, dach, kadłub;
// górna ściana w FG) i atmosfera (HaloClouds, HaloAirShell) w TSL. Bez GPU: WGSL budowany
// w Node (WGSLNodeBuilder, atrapa kanwy — jak tests/haloRingTerrainTSL.test.mjs). Reguły
// komórek dachu = lustro CPU haloRingRoofPlan.js (te same sole haszu, progi i kolejność
// gałęzi); wynik na GPU ↔ industrialCellRule / plotRule: scripts/webgpu/ring-tsl-parzystosc.mjs.
// node --test tests/haloRingStructureTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { createHaloUniforms, HALO_UNIFORM_BLOCK } from '../src/3d/haloRing/haloRingUniforms.js';
import { HALO_QUALITY, HALO_ROOF } from '../src/3d/haloRing/haloRingConfig.js';
import { HaloTerrain, HALO_SURFACE_BLOCK_NAME } from '../src/3d/haloRing/haloRingTerrain.js';
import {
  HALO_EDGE_KIND, HALO_STRUCTURE_AIR_STEPS, HALO_TOP_WALL_EDGES, HaloStructure, haloRoofTSL
} from '../src/3d/haloRing/haloRingStructure.js';
import {
  HaloAirShell, HaloClouds, haloCloudAirSteps, haloCloudOctaves, haloShellAirSteps
} from '../src/3d/haloRing/haloRingAtmosphere.js';
import { industrialCellRule, plotRule } from '../src/3d/haloRing/haloRingRoofPlan.js';
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
// wykładniki wszystkich pow( podstawa, wykładnik ) (nawiasy zrównoważone)
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

// Atrapy map i detalu jak w teście terenu; bryły z domeną jak index.js (assemble).
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
  const su = terrain.surfaceUniforms;
  const topSplit = layout.flightLevel !== 'roof';
  return {
    layout, uniforms, terrain, domain, quality: q,
    rest: new HaloStructure({ layout, uniforms, surfaceUniforms: su, domain, part: topSplit ? 'rest' : 'all' }),
    top: topSplit ? new HaloStructure({ layout, uniforms, surfaceUniforms: su, domain, part: 'top' }) : null,
    clouds: new HaloClouds({ layout, uniforms, surfaceUniforms: su, domain, quality: q }),
    shell: new HaloAirShell({ layout, uniforms, surfaceUniforms: su, domain, quality: q })
  };
}

// ---------------------------------------------------------------------------

test('konstrukcja i atmosfera: materiały węzłowe bez GLSL, stan renderu jak dawny ShaderMaterial', () => {
  for (const f of ['haloRingStructure.js', 'haloRingAtmosphere.js']) {
    const src = read(`src/3d/haloRing/${f}`);
    assert.doesNotMatch(src, /\/\* glsl \*\/|new THREE\.ShaderMaterial|gl_FragColor|gl_Position|from '\.\/haloRingGLSL\.js'/, `${f}: bez GLSL`);
  }
  // CLOUDCOVER usunięte (ostatni użytkownik: chmury); SURFACE — z megastrukturą i miastem (09)
  const glsl = read('src/3d/haloRing/haloRingGLSL.js');
  assert.doesNotMatch(glsl, /HALO_GLSL_CLOUDCOVER/);
  assert.doesNotMatch(glsl, /export const HALO_GLSL_SURFACE = /);
  const P = makeParts();
  const { rest, top, clouds, shell, uniforms, terrain, domain } = P;
  for (const part of [rest, top]) {
    const m = part.material;
    assert.ok(m.isNodeMaterial && !m.isShaderMaterial);
    assert.equal(m.name, 'HaloStructure');
    assert.equal(m.side, THREE.FrontSide);
    assert.equal(m.transparent, false);
    assert.equal(m.fog, false);
    assert.equal(m.toneMapped, false);
    assert.ok(m.vertexNode && m.fragmentNode);
    // podgląd wartości jak dawniej: uniformy ringu, powierzchni i komórek na segment
    assert.equal(m.uniforms.uSunDir, uniforms.uSunDir);
    assert.equal(m.uniforms.uPatT, terrain.surfaceUniforms.uPatT);
    assert.equal(m.uniforms.uSegCells.value, domain.segCells);
  }
  assert.equal(rest.mesh.name, 'HaloStructure');
  assert.equal(top.mesh.name, 'HaloStructure_topWall');
  assert.notEqual(rest.material.fragmentNode, top.material.fragmentNode, 'FG i reszta — osobne warianty');
  // chmury: premultiplikowane, jeden przebieg DoubleSide (ShaderMaterial w bazie miał forceSinglePass)
  const c = clouds.material;
  assert.equal(c.name, 'HaloClouds');
  assert.equal(c.transparent, true);
  assert.equal(c.depthWrite, false);
  assert.equal(c.side, THREE.DoubleSide);
  assert.equal(c.forceSinglePass, true);
  assert.deepEqual([c.blending, c.blendSrc, c.blendDst, c.blendSrcAlpha, c.blendDstAlpha],
    [THREE.CustomBlending, THREE.OneFactor, THREE.OneMinusSrcAlphaFactor, THREE.OneFactor, THREE.OneMinusSrcAlphaFactor]);
  assert.equal(clouds.mesh.renderOrder, 30);
  // powłoka: tylko tył pasa, kolor + cel · alfa, alfa celu bez zmian
  const s = shell.material;
  assert.equal(s.name, 'HaloAirShell');
  assert.equal(s.transparent, true);
  assert.equal(s.depthWrite, false);
  assert.equal(s.side, THREE.BackSide);
  assert.deepEqual([s.blending, s.blendEquation, s.blendSrc, s.blendDst, s.blendSrcAlpha, s.blendDstAlpha],
    [THREE.CustomBlending, THREE.AddEquation, THREE.OneFactor, THREE.SrcAlphaFactor, THREE.ZeroFactor, THREE.OneFactor]);
  assert.equal(shell.mesh.renderOrder, 20);
  for (const part of [rest, top, clouds, shell]) assert.equal(part.mesh.frustumCulled, false);
});

test('pasy obrotowe w WGSL: atrybuty i instancje jak dawny STRIP_VERTEX, dwa bloki uniformów ringu, rzut RTE', () => {
  const { rest, top, clouds, shell } = makeParts();
  for (const part of [rest, top, clouds, shell]) {
    const { vertex, fragment } = buildWGSL(part.mesh);
    for (const a of ['iSeg : f32', 'aAlong : f32', 'aProfile : vec2<f32>', 'aEdge : vec4<f32>']) assert.ok(vertex.includes(a), `${part.material.name}: ${a}`);
    for (const v of ['vHaloRel : vec3<f32>', 'vHaloST : vec2<f32>']) assert.ok(vertex.includes(v), v);
    const main = mainBody(vertex);
    // komórki = iSeg + aAlong · uSegCells, sRel = komórki · ds (uGridInfo.x), RTE bez translacji modelu
    assert.match(main, /\( iSeg \+ \( aAlong \* object\.nodeUniform\d+ \) \)/);
    assert.match(main, /haloRelFromPolar\(/);
    assert.match(main, /object\.nodeUniform\d+ \* vec4<f32>\( nodeVar\d+, 0\.0 \)/, 'obrót grupy bez translacji (w = 0)');
    for (const stage of [vertex, fragment]) {
      assert.equal((stage.match(/var<uniform> haloRingU\b/g) || []).length, 1);
      assert.ok((stage.match(new RegExp(`var<uniform> ${HALO_SURFACE_BLOCK_NAME}\\b`, 'g')) || []).length <= 1);
      assert.ok((stage.match(/var<uniform>/g) || []).length <= 4, 'haloRingU, haloSurfU, object, render (limit 12)');
      // tekstury zawsze z jawnym uv — bez uniformów macierzy uv na każde próbkowanie (updateMatrix)
      const obj = stage.match(/struct objectStruct \{[\s\S]*?\};/);
      assert.ok(!obj || !/mat3x3/.test(obj[0]), `${part.material.name}: bez macierzy uv tekstur`);
    }
    // funkcje biblioteki i dachu czyste (kod wspólny dla materiałów i trzech ringów)
    for (const name of [...fragment.matchAll(/^fn (halo\w+)/gm)].map((x) => x[1])) {
      assert.doesNotMatch(fnBody(fragment, name), /haloRingU|haloSurfU|\bobject\.|\brender\./, `${part.material.name}: ${name} czysta`);
    }
    // stałe krawędzie smoothstep rosnące (odwrotne = błąd tworzenia shadera WGSL; te idą przez haloSmooth)
    for (const [, x, y] of `${vertex}\n${fragment}`.matchAll(/smoothstep\( (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?),/g)) {
      assert.ok(Number(x) < Number(y), `${part.material.name}: smoothstep( ${x}, ${y}, … )`);
    }
    // bez pow z możliwie ujemną podstawą: potęgi całkowite mnożeniem (pow tylko 1,4 / 1,5 z clamp / max w bibliotece)
    for (const e of powExponents(fragment)) assert.ok(['1.4', '1.5'].includes(e), `${part.material.name}: pow(…, ${e})`);
  }
});

test('konstrukcja w WGSL: górna ściana z wycięciami i ditherem jak WebGL, tranzyt w kadłubie, powietrze ścian (6 kroków)', () => {
  const { rest, top, uniforms } = makeParts();
  const lay = uniforms[HALO_UNIFORM_BLOCK].layout;
  const idx = (k) => lay.find((e) => e.key === k).index;
  const fgFrag = buildWGSL(top.mesh).fragment;
  const restFrag = buildWGSL(rest.mesh).fragment;
  const fgMain = mainBody(fgFrag);
  // FG: zanik dachu (uFgFade) i dwa wycięcia (uCutA/uCutB) w pętli, przerzedzenie IGN z gl_FragCoord (y od dołu)
  assert.match(fgMain, new RegExp(`haloRingU\\.value\\[ ${idx('uFgFade')}u \\]`));
  assert.match(fgMain, /for \( var i : i32 = 0; i < 2; i \+\+ \)/);
  assert.match(fgMain, new RegExp(`haloRingU\\.value\\[ \\( i \\+ ${idx('uCutA')} \\) \\]`));
  assert.match(fgMain, /<= haloIGN\( vec2<f32>\( fragCoord\.xy\.x, \( object\.nodeUniform\d+\.y - fragCoord\.xy\.y \) \) \)/);
  assert.doesNotMatch(mainBody(restFrag), new RegExp(`haloRingU\\.value\\[ ${idx('uFgFade')}u \\]`), 'reszta bryły bez zaniku FG');
  for (const main of [fgMain, mainBody(restFrag)]) {
    // wylot tranzytu w kadłubie (rodzaj 4), rodzaje krawędzi z varyingu
    assert.match(main, /i32\( \( vHaloKind \+ 0\.5 \) \)/);
    assert.match(main, /== 4 \) && haloInTransitCut\(/);
    assert.match(main, /discard;/);
    // powietrze tylko na ścianach od środka, dither jak WebGL
    assert.match(main, new RegExp(`haloApplyAir${HALO_STRUCTURE_AIR_STEPS}\\( [^;]*haloIGN\\( vec2<f32>\\( fragCoord\\.xy\\.x, \\( object\\.nodeUniform\\d+\\.y - fragCoord\\.xy\\.y \\) \\) \\)`));
    // dach: jedno odciśnięcie komórki i 5 cieni (ta komórka + 4 sąsiednie w stronę słońca; piąta —
    // dalsza wzdłuż albo w poprzek — w dwóch gałęziach, więc 6 wywołań w tekście)
    assert.equal((main.match(/haloRoofIndCell\(/g) || []).length, 1);
    assert.equal((main.match(/haloRoofIndShadow\(/g) || []).length, 6);
    assert.equal((main.match(/haloRoofPlot\(/g) || []).length, 1);
    // paleta konstrukcji z profilu (uStructPal) — z bloku ringu
    assert.match(main, new RegExp(`haloRingU\\.value\\[ ${idx('uStructPal')}u \\]\\.xyz`));
  }
  assert.match(fnBody(restFrag, `haloAirIntegrate${HALO_STRUCTURE_AIR_STEPS}`), new RegExp(`i < ${HALO_STRUCTURE_AIR_STEPS};`));
});

test('dach w WGSL = reguły komórek z haloRingRoofPlan.js: sole haszu, progi z profilu, kolejność gałęzi', () => {
  const { rest } = makeParts();
  const frag = buildWGSL(rest.mesh).fragment;
  const cell = fnBody(frag, 'haloRoofIndCell');
  const plot = fnBody(frag, 'haloRoofPlot');
  assert.ok(cell && plot);
  const salts = (body, v) => [...body.matchAll(new RegExp(`haloHashI\\( ${v}, (\\d+)\\.0 \\)`, 'g'))].map((x) => Number(x[1]));
  // komórka przemysłowa: zajętość (11), rodzaj (12), rozmiar (13), wysokość (14), przesunięcia (15, 16),
  // drugi bok bloku (17), orientacja radiatora (18) — jak industrialCellRule
  assert.deepEqual(salts(cell, 'i, j'), [11, 12, 13, 14, 15, 16, 17, 18]);
  // działka: pusta (21), rodzaj (22), wymiary (23–25), wieża (26–28), jej przesunięcie (29, 30) — jak plotRule
  assert.deepEqual(salts(plot, 'L, row'), [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  // progi rodzajów po kolei z parametrów (uRoofKinds), zajętość / puste działki według klasy sektora
  assert.deepEqual([...cell.matchAll(/< kinds\.([xyzw])/g)].map((x) => x[1]), ['x', 'y', 'z', 'w']);
  assert.deepEqual([...cell.matchAll(/= occ\.([xyzw]);/g)].map((x) => x[1]), ['x', 'y', 'z', 'w']);
  assert.deepEqual([...plot.matchAll(/= plotEmpty\.([xyzw]);/g)].map((x) => x[1]), ['x', 'y', 'z', 'w']);
  assert.match(cell, /if \( \( haloHashI\( i, j, 11\.0 \) < nodeVar\d+ \) \)/, 'zajęta, gdy hasz < zajętość (CPU: >= → pusta)');
  assert.match(plot, /if \( \( haloHashI\( L, row, 21\.0 \) >= nodeVar\d+ \) \)/, 'działka zabudowana, gdy hasz >= próg pustych');
  // wymiary brył: stałe jak w lustrze CPU (c0 + c1 · hasz)
  const cellCpu = read('src/3d/haloRing/haloRingRoofPlan.js');
  for (const [c0, c1] of [[12, 12], [22, 24], [18, 70], [10, 60], [26, 50], [5, 4], [60, 36], [14, 10]]) {
    assert.ok(cell.includes(`( ${c0}.0 + ( ${c1}.0 * `), `komórka: ${c0} + ${c1}·h`);
    assert.match(cellCpu, new RegExp(`${c0} \\+ ${c1} \\* `), `lustro CPU: ${c0} + ${c1}·h`);
  }
  for (const [c0, c1] of [[150, 120], [220, 200], [60, 50], [40, 56], [18, 16], [200, 90], [280, 170], [24, 22]]) {
    assert.ok(plot.includes(`( ${c0}.0 + ( ${c1}.0 * `), `działka: ${c0} + ${c1}·h`);
    assert.match(cellCpu, new RegExp(`${c0} \\+ ${c1} \\* `), `lustro CPU: ${c0} + ${c1}·h`);
  }
  // wiersze rodzajów działki w klasie przemysłu i miasta (0,45 / 0,75 i 0,6)
  for (const k of ['0.45', '0.75', '0.6']) assert.ok(plot.includes(`< ${k} )`), `próg rodzaju działki ${k}`);
  // wymiary radiatora i kontenerów (stałe)
  assert.match(cell, /44\.0/);
  assert.match(plot, /vec4<f32>\( 3\.0, 240\.0, 288\.0, 12\.0 \)/);
});

test('dach: lustro CPU (industrialCellRule / plotRule) pokrywa wszystkie rodzaje dla reguł każdego profilu', () => {
  // warunek sensu parzystości na GPU (scripts/webgpu/ring-tsl-parzystosc.mjs): próbki (i, j, klasa)
  // trafiają w każdy rodzaj komórki i działki, także przy progach Marsa i Jowisza
  for (const key of ['earth', 'mars', 'jupiter']) {
    const rules = layoutOf(key).planetProfile.roofRules;
    const cellKinds = new Set();
    const plotKinds = new Set();
    for (let i = 0; i < 400; i++) {
      for (let j = 0; j < 8; j++) {
        for (let cls = 0; cls < 4; cls++) {
          const c = industrialCellRule(i, j, cls, 56.3, rules);
          cellKinds.add(c ? c.kind : 0);
        }
      }
      for (let cls = 0; cls < 4; cls++) plotKinds.add(plotRule(i, i & 1, cls, rules).kind);
    }
    assert.deepEqual([...cellKinds].sort(), [0, 1, 2, 3, 4, 5], `${key}: rodzaje komórek`);
    assert.deepEqual([...plotKinds].sort(), [0, 1, 2, 3], `${key}: rodzaje działek`);
  }
  assert.equal(HALO_ROOF.crossCell, 56, 'komórka w poprzek (uRoofLanes2.w)');
});

test('atmosfera w WGSL: warianty z jakości (kroki powietrza, oktawy chmur), burze, łuna miasta, wzmocnienie nieba', () => {
  for (const [q, cloudSteps, octaves, shellSteps] of [['low', 3, 3, 8], ['medium', 4, 4, 10], ['high', 5, 4, 12], ['ultra', 7, 4, 16]]) {
    const { clouds, shell, quality } = makeParts('earth', q);
    assert.equal(haloCloudAirSteps(quality), cloudSteps);
    assert.equal(haloCloudOctaves(quality), octaves);
    assert.equal(haloShellAirSteps(quality), shellSteps);
    const cf = buildWGSL(clouds.mesh).fragment;
    const cm = mainBody(cf);
    assert.match(cm, new RegExp(`haloApplyAir${cloudSteps}\\(`), `${q}: powietrze chmur ${cloudSteps} kroków`);
    assert.match(cm, /< 0\.004 \) \) \{\s*discard;/, 'odrzucenie prawie przezroczystych');
    assert.match(cm, /haloStormFlash\(/);
    // pokrycie: oktawy pierwszego wywołania (do 4) + 2 oktawy samocienia — próbki detalu B
    const cloudOct = (cm.match(/\( (?:0\.275|0\.1375|0\.06875) \* /g) || []).length;
    assert.equal(cloudOct, (octaves - 1) + 1, `${q}: oktawy chmur ${octaves} + samocień 2`);
    const sf = buildWGSL(shell.mesh).fragment;
    const sm = mainBody(sf);
    assert.match(sm, new RegExp(`haloAirIntegrate${shellSteps}\\(`), `${q}: powłoka ${shellSteps} kroków`);
    assert.match(sm, /haloSkyGain\(/);
    assert.match(sm, /haloIGN\( vec2<f32>\( fragCoord\.xy\.x, \( object\.nodeUniform\d+\.y - fragCoord\.xy\.y \) \) \)/);
  }
});

test('konstrukcja: krawędzie profilu i podział na górną ścianę (FG) bez zmian, geometria pasów jak dawniej', () => {
  const { layout, rest, top, clouds, shell, domain } = makeParts();
  const topSet = new Set(HALO_TOP_WALL_EDGES);
  const kinds = (part) => [...new Set(Array.from(part.geometry.getAttribute('aEdge').array).filter((_, i) => i % 4 === 0))].sort();
  assert.deepEqual(kinds(top), HALO_TOP_WALL_EDGES.map((k) => HALO_EDGE_KIND[k]).sort());
  const restKinds = layout.profile.edges.filter((e) => e.kind !== 'floor' && !topSet.has(e.kind)).map((e) => HALO_EDGE_KIND[e.kind]);
  assert.deepEqual(kinds(rest), [...new Set(restKinds)].sort());
  for (const part of [rest, top]) {
    assert.equal(part.geometry.getAttribute('iSeg').count, domain.segCount);
    assert.ok(part.geometry.getAttribute('iSeg').isInstancedBufferAttribute);
    assert.equal(part.geometry.instanceCount, 0);
  }
  assert.deepEqual(kinds(clouds), [10]);
  assert.deepEqual(kinds(shell), [11]);
  // wybór segmentów w kadrze: instancje = segmenty w kadrze, zakres aktualizacji
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 10, 400000);
  cam.position.set(layout.radii.rim + 3000, 0, 1500);
  cam.up.set(0, 0, 1);
  cam.lookAt(layout.radii.floorMid, 4000, 0);
  cam.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  rest.update(frustum, 0);
  assert.ok(rest.segments.count > 0 && rest.segments.count < domain.segCount);
  assert.equal(rest.geometry.instanceCount, rest.segments.count);
  assert.deepEqual(rest.segments.segAttr.updateRanges.map((r) => [r.start, r.count]), [[0, rest.segments.count]]);
  shell.update(frustum, 0, false);
  assert.equal(shell.geometry.instanceCount, 0, 'powłoka tylko z kamerą w powietrzu habitatu');
  for (const p of [rest, top, clouds, shell]) p.dispose();
});

test('ściany: hasz okien i kreski tarasów z tymi samymi zaokrągleniami co baza WebGL (zmierzone na GPU)', () => {
  const src = read('src/3d/haloRing/haloRingStructure.js');
  // (wc.x, row) + bp.x · 0,37: x — iloczyn, potem suma (dwa zaokrąglenia), y — jedno (FMA); pomiar:
  // scripts/webgpu/ring-tsl-parzystosc.mjs, wiersze structHashWin / structHashWinNaive / structHashWinFma
  assert.match(src, /const bp37 = bp\.x\.mul\(0\.37\);/);
  assert.match(src, /haloHash12\(vec2\(wc\.x\.add\(bp37\), haloFusedMulAddInt\(bp\.x, 0\.37, row\)\)\)/);
  // sRel / 23 + level · 0,37 wprost (FMA dawał 72% zgodnych bitów, wprost 99%)
  assert.match(src, /fract\(sRel\.div\(23\.0\)\.add\(level\.mul\(0\.37\)\)\)/);
  // pozostałe hasze ścian: wejścia całkowite + jedna stała (bit w bit bez poprawek)
  for (const re of [/haloHash12\(vec2\(bp\.x, level\)\.add\(3\.7\)\)/, /haloHash12\(vec2\(bp\.x\.mul\(7\.0\)\.add\(grp\), band\)\.add\(1\.3\)\)/,
    /haloHash12\(vec2\(bp\.x, grp\)\.add\(9\.1\)\)/, /haloHash12\(vec2\(pp\.x, floor\(v\.div\(22\.0\)\)\)\.add\(4\.0\)\)/]) {
    assert.match(src, re);
  }
});

test('dach: klasa sektora z tablicy uSectorClass (wklejana), reguły z bloku ringu jako parametry funkcji', () => {
  const u = createHaloUniforms(layoutOf('earth'));
  const R = haloRoofTSL(u);
  assert.equal(haloRoofTSL(u), R, 'jeden obiekt na ring');
  for (const k of ['roofClassOf', 'roofInDock', 'roofIndCell', 'roofPlot', 'roofIndShadow']) assert.equal(typeof R[k], 'function', k);
  const { rest, uniforms } = makeParts();
  const lay = uniforms[HALO_UNIFORM_BLOCK].layout;
  const idx = (k) => lay.find((e) => e.key === k).index;
  const main = mainBody(buildWGSL(rest.mesh).fragment);
  // klasa sektora: element uSectorClass o indeksie dynamicznym (min(floor(x / na sektor), sektorów − 1))
  assert.match(main, /haloRingU\.value\[ \( i32\( min\( floor\( \( tsl_mod_float\(/);
  assert.ok(main.includes(`+ ${idx('uSectorClass')} ) ].x`), 'uSectorClass[k] z bloku ringu');
  // reguły z profilu planety (uRoofOcc / uRoofKinds / uRoofPlotEmpty) jako argumenty
  assert.match(main, new RegExp(`haloRoofIndCell\\( [^;]*haloRingU\\.value\\[ ${idx('uRoofOcc')}u \\], haloRingU\\.value\\[ ${idx('uRoofKinds')}u \\]`));
  assert.match(main, new RegExp(`haloRoofPlot\\( [^;]*haloRingU\\.value\\[ ${idx('uRoofPlotEmpty')}u \\]`));
});
