// Port WebGPU silników (zadanie 13): MAIN (struga), WARP (plazma z dysz MAIN), SIDE
// (płomień + poświaty) w TSL zamiast GLSL. Bez GPU: WGSL budowany w Node przez
// WGSLNodeBuilder (WebGPURenderer bez init, atrapa kanwy) — jak tests/haloRingTSL.test.mjs.
// Pilnuje: jeden graf plazmy na całą pulę (wartości per obiekt), mieszanie 1:1 z WebGL,
// limity WebGPU (bufory wierzchołków ≤ 8, bufory uniformów ≤ 12 na etap), kroki marszu
// i oktawy jako stałe grafu, cząstki jako kwady (WebGPU rysuje punkty tylko 1 px).
// node --test tests/silnikiTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { WarpPlumeFX, WarpPlumeInternals } from '../src/3d/warpPlume3D.js';
import { MainExhaustInternals, MAIN_EXHAUST_Z } from '../src/3d/mainExhaust3D.js';
import { EngineExhaustInternals } from '../src/3d/engineExhaustBatch.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// kod bez komentarzy (komentarze mogą wspominać dawny GLSL)
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// WGSL w Node: renderer bez init (atrapa kanwy), budowa węzłów jak NodeManager.getForRender.
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.highPrecision = true;   // jak Core3D: modelViewMatrix składana na CPU
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader, updateNodes: b.updateNodes };
}
const mainBody = (wgsl) => wgsl.slice(wgsl.search(/@(fragment|vertex)\s*\nfn main/));
const count = (s, re) => (s.match(re) || []).length;
// Bufory wierzchołków pipeline'u = osobne bufory atrybutów (przeplot = jeden bufor).
const vertexBuffers = (geo) => new Set(Object.values(geo.attributes).map((a) => (a.isInterleavedBufferAttribute ? a.data : a))).size;

function jetMesh() {
  const { makeJetMaterial, buildAtlas } = MainExhaustInternals;
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  for (const [name, size] of [['iPos', 2], ['iDir', 2], ['iPalG', 2], ['iData', 4], ['iSeed', 1]]) {
    geo.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(4 * size), size));
  }
  return new THREE.Mesh(geo, makeJetMaterial(buildAtlas()));
}

function sideLayers() {
  const { makeFlameMaterial, makeGlowMaterial, makeInstancedQuad, FLAME_LAYOUT, GLOW_LAYOUT } = EngineExhaustInternals;
  const tex = new THREE.DataTexture(new Uint8Array(4 * 4), 2, 2);
  return {
    flame: makeInstancedQuad(FLAME_LAYOUT, makeFlameMaterial(), 0),
    glows: [
      makeInstancedQuad(GLOW_LAYOUT, makeGlowMaterial(tex, -4.9, 'EngineHeatGlow'), 1),
      makeInstancedQuad(GLOW_LAYOUT, makeGlowMaterial(tex, -4.8, 'EngineHeatRing'), 2),
      makeInstancedQuad(GLOW_LAYOUT, makeGlowMaterial(tex, -3.5, 'EngineFlare'), 3)
    ]
  };
}

test('pliki silników bez GLSL; Engineeffects.js — same tekstury, bez własnego renderera', () => {
  for (const f of ['src/3d/mainExhaust3D.js', 'src/3d/warpPlume3D.js', 'src/3d/engineExhaustBatch.js', 'Engineeffects.js']) {
    const src = code(f);
    assert.doesNotMatch(src, /ShaderMaterial|gl_FragColor|gl_Position|gl_PointSize|void main\s*\(/, `${f}: GLSL`);
  }
  const fx = code('Engineeffects.js');
  assert.doesNotMatch(fx, /WebGLRenderer|getEngineVFX|createShortNeedleExhaust|createWarpExhaustBlue/);
  for (const name of ['makeFlareTexture', 'makeGlowTexture', 'makeRingTexture']) {
    assert.match(fx, new RegExp(`export function ${name}\\(`), name);
  }
});

test('plazma WARP: instancje puli dzielą graf (ten sam klucz programu), wartości mają własne', () => {
  const a = new WarpPlumeFX();
  const b = new WarpPlumeFX();
  assert.ok(a.plumeMat.isNodeMaterial && a.partMat.isNodeMaterial && a.glowHot.material.isNodeMaterial);
  assert.equal(a.plumeMat.customProgramCacheKey(), b.plumeMat.customProgramCacheKey(), 'plume');
  assert.equal(a.partMat.customProgramCacheKey(), b.partMat.customProgramCacheKey(), 'cząstki');
  const glowKey = a.glowHot.material.customProgramCacheKey();
  for (const g of [a.glowMag, a.glowBlue, b.glowHot, b.glowMag, b.glowBlue]) {
    assert.equal(g.material.customProgramCacheKey(), glowKey, 'poświaty: jeden graf');
  }
  assert.equal(a.plumeMat.fragmentNode, b.plumeMat.fragmentNode, 'ten sam węzeł, nie kopia grafu');
  assert.notEqual(a.plumeMat, b.plumeMat);
  assert.notEqual(a.plumeMat.uniforms, b.plumeMat.uniforms);
  a.plumeMat.uniforms.uLen.value = 7;
  assert.notEqual(b.plumeMat.uniforms.uLen.value, 7, 'wartości per instancja');
  // graf w wariancie jakości budowany raz
  const { plumeGraph, QUALITY } = WarpPlumeInternals;
  assert.equal(plumeGraph(QUALITY.steps, QUALITY.oct), plumeGraph(QUALITY.steps, QUALITY.oct));
  assert.notEqual(plumeGraph(24, 2), plumeGraph(QUALITY.steps, QUALITY.oct), 'inna jakość = osobny graf');
});

test('plazma WARP: uniform grafu bierze wartość z materiału RYSOWANEGO obiektu (onObjectUpdate)', () => {
  const a = new WarpPlumeFX();
  const b = new WarpPlumeFX();
  const { updateNodes } = buildWGSL(a.plume);
  const perObject = [...updateNodes].filter((n) => n.isUniformNode && n.updateType === 'object');
  assert.ok(perObject.length >= 30, `uniformy per obiekt: ${perObject.length}`);
  a.plumeMat.uniforms.uBoundZ1.value = 11.5;
  b.plumeMat.uniforms.uBoundZ1.value = 33.25;
  const camera = new THREE.OrthographicCamera();
  const vals = (mesh) => perObject.map((n) => { n.update({ material: mesh.material, object: mesh, camera }); return n.value; });
  assert.ok(vals(a.plume).includes(11.5));
  const vb = vals(b.plume);
  assert.ok(vb.includes(33.25) && !vb.includes(11.5), 'drugi obiekt czyta swoje wartości');
});

test('plume: marsz = Loop o stałej liczbie kroków, oktawy simplexa ze stałej grafu, czyste funkcje WGSL', () => {
  const fx = new WarpPlumeFX();
  const { fragment } = buildWGSL(fx.plume);
  const body = mainBody(fragment);
  assert.match(body, /for \( var i : i32 = 0; i < 44; i \+\+ \)/, 'PE_STEPS = 44 → Loop(44)');
  assert.equal(count(body, /peSnoise\(/g), 3, 'PE_OCT = 3 → trzy oktawy w pętli');
  assert.match(fragment, /fn peSnoise \( v : vec3<f32> \) -> f32/);
  assert.match(fragment, /fn peHash12 \( p : vec2<f32> \) -> f32/);
  // funkcje z layoutem nie czytają uniformów (błąd r183 — PLAN §3)
  for (const name of ['peSnoise', 'peHash12']) {
    const fn = fragment.match(new RegExp(`fn ${name} \\([\\s\\S]*?\\n}`))?.[0] || '';
    assert.ok(fn.length > 0 && !/object\.|render\.|nodeUniform/.test(fn), `${name} czysta`);
  }
  assert.ok(count(fragment, /var<uniform>/g) <= 12, 'limit 12 buforów uniformów na etap');
  // Pętla tylko dla pikseli w granicach marszu (discard w WGSL nie przerywa wykonania).
  const iDiscard = body.indexOf('discard;');
  const iLoop = body.indexOf('for ( var i');
  assert.ok(iDiscard > 0 && iLoop > iDiscard, 'discard przed pętlą');
  assert.match(body.slice(iDiscard, iLoop), /if \( \( nodeVar\d+ > 0\.5 \) \) \{/, 'pętla za flagą trafienia');
  // mniejsza jakość: 24 kroki, 2 oktawy (trzecia = n2 · 0,6)
  const { plumeGraph } = WarpPlumeInternals;
  const m = new THREE.NodeMaterial();
  m.fragmentNode = plumeGraph(24, 2).fragmentNode;
  m.uniforms = fx.plumeMat.uniforms;
  const low = mainBody(buildWGSL(new THREE.Mesh(fx.plume.geometry, m)).fragment);
  assert.match(low, /i < 24;/);
  assert.equal(count(low, /peSnoise\(/g), 2);
});

test('cząstki plazmy: kwady na instancjach (dawny gl_PointSize ≤ 42 px, gl_PointCoord = uv)', () => {
  const fx = new WarpPlumeFX();
  assert.notEqual(fx.particles.isPoints, true, 'WebGPU rysuje punkty tylko 1 px');
  const g = fx.particles.geometry;
  assert.ok(g.isInstancedBufferGeometry);
  assert.equal(g.getAttribute('aSeed').count, 520);
  assert.ok(g.getAttribute('aSeed').isInstancedBufferAttribute && g.getAttribute('aPhase').isInstancedBufferAttribute);
  fx.ignite();
  for (let i = 0; i < 30; i++) fx.update(1 / 60, null, 1080, true);
  assert.equal(g.instanceCount, Math.floor(520 * fx.params.particles));
  const { vertex } = buildWGSL(fx.particles);
  assert.match(vertex, /clamp\( mix\([^;]*1\.0, 42\.0 \)/, 'rozmiar w px celu jak dawny gl_PointSize');
  assert.match(vertex, /\.zw \)/, 'przesunięcie kwadu przez rozmiar viewportu');
});

test('mieszanie 1:1 z WebGL: premultiplied (ONE, ONE) bez premultiplyAlpha, SIDE — Additive; kolejność rysowania bez zmian', () => {
  const fx = new WarpPlumeFX();
  const jets = jetMesh();
  const premul = [fx.plumeMat, fx.partMat, fx.glowHot.material, fx.glowMag.material, fx.glowBlue.material, jets.material];
  for (const m of premul) {
    assert.equal(m.blending, THREE.CustomBlending, m.name);
    assert.equal(m.blendSrc, THREE.OneFactor, m.name);
    assert.equal(m.blendDst, THREE.OneFactor, m.name);
    assert.equal(m.blendEquation, THREE.AddEquation, m.name);
    assert.equal(m.blendSrcAlpha, null, m.name);
    assert.equal(m.blendDstAlpha, null, m.name);
    assert.equal(m.premultipliedAlpha, false, `${m.name}: NodeMaterial mnożyłby wyjście przez alfę`);
  }
  const side = sideLayers();
  for (const m of [side.flame.mesh.material, ...side.glows.map((l) => l.mesh.material)]) {
    assert.equal(m.blending, THREE.AdditiveBlending, m.name);
    assert.equal(m.premultipliedAlpha, false, m.name);
  }
  for (const m of [...premul, side.flame.mesh.material, ...side.glows.map((l) => l.mesh.material)]) {
    assert.equal(m.transparent, true, m.name);
    assert.equal(m.depthWrite, false, m.name);
    assert.equal(m.fog, false, m.name);
    if (m.side === THREE.DoubleSide) assert.equal(m.forceSinglePass, true, `${m.name}: DoubleSide w jednym drawie`);
  }
  assert.equal(fx.plumeMat.side, THREE.BackSide);
  assert.equal(fx.plume.renderOrder, 1);
  assert.equal(fx.particles.renderOrder, 4);
  assert.deepEqual([fx.glowHot.renderOrder, fx.glowMag.renderOrder, fx.glowBlue.renderOrder], [3, 2, 0]);
  assert.equal(side.flame.mesh.renderOrder, 0);
  assert.deepEqual(side.glows.map((l) => l.mesh.renderOrder), [1, 2, 3]);
});

test('limity WebGPU: ≤ 8 buforów wierzchołków na pipeline, WGSL buduje się dla każdego materiału silników', () => {
  const fx = new WarpPlumeFX();
  const side = sideLayers();
  const meshes = [jetMesh(), ...fx.meshes, side.flame.mesh, ...side.glows.map((l) => l.mesh)];
  for (const mesh of meshes) {
    assert.ok(vertexBuffers(mesh.geometry) <= 8, `${mesh.material.name}: ${vertexBuffers(mesh.geometry)} buforów wierzchołków`);
    const { vertex, fragment } = buildWGSL(mesh);
    assert.ok(vertex.includes('@vertex') && fragment.includes('@fragment'), mesh.material.name);
    assert.ok(count(vertex, /var<uniform>/g) <= 12 && count(fragment, /var<uniform>/g) <= 12, mesh.material.name);
  }
  // płomień SIDE: 10 atrybutów instancji w jednym buforze z przeplotem (dawniej 12 buforów → błąd pipeline'u)
  assert.equal(vertexBuffers(side.flame.geo), 3);
  assert.equal(side.flame.stride, 17);
});

test('struga MAIN i płomień SIDE: clamp uv przed pow (MSAA + HalfFloat), z strugi pod kadłubem', () => {
  const jets = jetMesh();
  const jf = mainBody(buildWGSL(jets).fragment);
  assert.match(jf, /clamp\( nodeVarying\d+\.y, 0\.0, 1\.0 \)/, 'along = clamp(uv.y)');
  assert.match(jf, /clamp\( nodeVarying\d+\.x, 0\.0, 1\.0 \)/, 'x = clamp(uv.x)');
  assert.equal(jets.material.uniforms.uZ.value, MAIN_EXHAUST_Z);
  assert.ok('value' in jets.material.uniforms.uFlowPh, 'uFlowPh przez adapter — faza z CPU');
  const side = sideLayers();
  const ff = mainBody(buildWGSL(side.flame.mesh).fragment);
  assert.match(ff, /clamp\( nodeVarying\d+, vec2<f32>\( 0\.0 \), vec2<f32>\( 1\.0 \) \)/, 'uv płomienia przycięte');
  // ENGINE_HDR (pilnuje renderBugfixGuards) zostaje stałą modułu
  assert.match(read('src/3d/engineExhaustBatch.js'), /const ENGINE_HDR = 0\.6;/);
});
