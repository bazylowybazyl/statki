// Maskowanie w TSL (src/3d/cloak/cloakTSL.js, 2026-10-04): WGSL zbudowany w Node (WGSLNodeBuilder bez GPU) —
// gałąź maskowania w skórze belek za jednolitym warunkiem slotu, pochodne przed gałęzią, hasz u32, materiał
// refrakcji w warstwie DIST (mieszanie ONE / ONE, zwijanie wierzchołków bez maskowania), zapis slotu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  HULL_FLAT_NORMAL_TEXTURE, HULL_OBJECT_SLOT_VEC4, HullCloakDistNodeMaterial, HullNodeMaterial, HullObjectStore
} from '../src/3d/hexShips3D.tsl.js';
import { HullLacquer } from '../src/3d/hullLacquer.js';
import { createCloakLook, stepCloakLook } from '../src/game/cloakLook.js';
import { CLOAK_SHADER } from '../src/3d/cloak/cloakTSL.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader, updateNodes: b.updateNodes };
}
function spriteTexture() {
  const t = new THREE.Texture();
  t.image = { width: 64, height: 32 };
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function batchGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('aShadeHeat', new THREE.BufferAttribute(new Float32Array(16), 4));
  g.setAttribute('aUvSlot', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
  return g;
}
const holders = () => ({ uSprite: { value: spriteTexture() }, uNormalMap: { value: HULL_FLAT_NORMAL_TEXTURE }, uShapeMap: HullLacquer.flatShapeUniform });
const hull = buildWGSL(new THREE.Mesh(batchGeometry(), new HullNodeMaterial('beamBatch', holders())));
const dist = buildWGSL(new THREE.Mesh(batchGeometry(), new HullCloakDistNodeMaterial(holders())));
const mainOf = (src) => src.slice(src.indexOf('fn main('));

test('skóra belek: gałąź maskowania za warunkiem slotu (uCloakA.y), pochodna przed gałęzią, hasz u32 z 24 bitów', () => {
  const f = hull.fragment;
  const main = mainOf(f);
  // warunek: |kierunek| slotu 17 (uCloakA.y) > 0,5
  const cond = /if \( \( abs\( hullObjects\.value\[ \( \w+ \+ 17u \) \]\.y \) > 0\.5 \) \)/;
  assert.match(main, cond);
  // fwidth piksela kanonicznego przypisany PRZED gałęzią (pułapki 15 i 29)
  const branch = main.search(cond);
  const fw = main.lastIndexOf('fwidth(', branch);
  assert.ok(fw > 0 && fw < branch, 'pochodna przed gałęzią');
  const body = main.slice(branch);
  // stan komórki (wklejony) i komórka heksa (funkcja z layoutem) w gałęzi
  assert.match(body, /cloakHexCell\( /);
  assert.match(body, /cloakHash\( /);
  // hasz: stałe u32, 24 bity → float; jedyna funkcja maskowania wołająca inne — żadna (kolejność w WGSL stała)
  assert.match(f, /fn cloakHash \( ix : u32, iy : u32, seed : u32 \) -> f32/);
  assert.match(f, /\* 2376512323u/);
  assert.match(f, /f32\( \( nodeVar\d+ >> 8u \) \) \* 5\.960464477539063e-8/);
  assert.doesNotMatch(f, /fn cloakCellVis|fn cloakNoise/);
  // poświata brzegu i szkło: próbki z jawnym poziomem (gałąź niejednolita)
  assert.match(body, /textureSampleLevel\(/);
  assert.doesNotMatch(body.slice(0, body.indexOf('output.color')), /textureSample\( /, 'bez próbek z pochodnymi w gałęzi');
  // WGSL: smoothstep ze stałymi krawędziami low < high
  for (const m of f.matchAll(/smoothstep\( (-?[\d.]+), (-?[\d.]+),/g)) assert.ok(Number(m[1]) < Number(m[2]), m[0]);
  // ten sam graf zbudowany drugi raz = ten sam kod (moduł GPU z cache)
  assert.equal(buildWGSL(new THREE.Mesh(batchGeometry(), new HullNodeMaterial('beamBatch', holders()))).fragment, f);
});

test('refrakcja (warstwa DIST): ten sam slot, zwijanie bez maskowania, mieszanie ONE / ONE, próbki z poziomem w gałęziach', () => {
  const m = new HullCloakDistNodeMaterial(holders());
  assert.equal(m.blending, THREE.CustomBlending);
  assert.equal(m.blendSrc, THREE.OneFactor);
  assert.equal(m.blendDst, THREE.OneFactor);
  assert.equal(m.depthWrite, false);
  assert.equal(m.depthTest, false);
  assert.equal(m.forceSinglePass, true);
  // jeden graf na wszystkie partie (jeden NodeBuilder)
  assert.equal(m.fragmentNode, new HullCloakDistNodeMaterial(holders()).fragmentNode);
  assert.equal(m.customProgramCacheKey(), new HullCloakDistNodeMaterial(holders()).customProgramCacheKey());
  // wierzchołek: widoczność slotu × (|uCloakA.y| ≥ 0,5) — inaczej poza obcięciem
  assert.match(dist.vertex, /\+ 17u \) \]\.y \)/);
  assert.match(dist.vertex, /vec4<f32>\( 2\.0, 2\.0, 2\.0, 1\.0 \)/);
  // fragment: RG = przesunięcie, B = maska ekranu (heksy-ekrany) albo znacznik refrakcji maskowania (−0,001), A = śnieg,
  // × pokrycie; rozdarcie pasów z pozycji piksela, siła z uZoomPx (grupa renderu)
  assert.match(dist.fragment, /output\.color = \( vec4<f32>\( nodeVar\d+, nodeVar\d+, nodeVar\d+\.y \) \* vec4<f32>\( nodeVar\d+ \) \);/);
  assert.match(dist.fragment, /nodeVar\d+ = -0\.001;/);
  assert.match(dist.fragment, /fragCoord\.xy\.y/);
  // heksy-ekrany: gałąź za siłą ekranów (slot 21 .w), pochodne piksela kanonicznego PRZED odrzuceniem (pułapki 15, 29)
  assert.match(dist.fragment, /if \( \( hullObjects\.value\[ \( \w+ \+ 21u \) \]\.w > 0\.001 \) \)/);
  const mainD = mainOf(dist.fragment);
  const disc = mainD.indexOf('discard;');
  assert.ok(mainD.indexOf('dpdx(') > 0 && mainD.indexOf('dpdx(') < disc && mainD.indexOf('dpdy(') < disc, 'pochodne przed discard');
  assert.equal((mainD.match(/dpdx\(|dpdy\(/g) || []).length, 2, 'pochodne tylko raz, w jednolitym przepływie');
  const px = `${CLOAK_SHADER.minPx.toFixed(1)}, ${CLOAK_SHADER.maxPx.toFixed(1)}`.replace(/\./g, '\\.');
  assert.match(dist.fragment, new RegExp(`clamp\\( \\( hullObjects\\.value\\[ \\( \\w+ \\+ 20u \\) \\]\\.y \\* render\\.\\w+ \\), ${px} \\)`));
  // pokrycie (sprite) próbkowane raz na górze main, po odrzuceniu już tylko próbki z jawnym poziomem
  const main = mainOf(dist.fragment);
  const afterDiscard = main.slice(main.indexOf('discard;'));
  assert.equal((main.match(/textureSample\( /g) || []).length, 1, 'jedna próbka z pochodnymi — pokrycie');
  assert.doesNotMatch(afterDiscard.slice(0, afterDiscard.indexOf('output.color')), /textureSample\( /);
  assert.ok((afterDiscard.match(/textureSampleLevel\(/g) || []).length >= 6, 'soczewka: brzeg (4), kopuła i pas brzegu');
  assert.equal(buildWGSL(new THREE.Mesh(batchGeometry(), new HullCloakDistNodeMaterial(holders()))).fragment, dist.fragment);
  // tekstury: tylko sprite partii (soczewka globalna — bez mapy normalnych)
  assert.equal((dist.fragment.match(/: texture_2d<f32>/g) || []).length, 1);
  // soczewka globalna: gałąź za D.z (slot 20 .z), kopuła z poziomu log2(krótszy bok × lensDome)
  assert.match(mainD, /if \( \( hullObjects\.value\[ \( \w+ \+ 20u \) \]\.z > 0\.001 \) \)/);
  assert.match(mainD, /log2\( max\( \( min\( hullObjects\.value\[ \( \w+ \+ 9u \) \]\.xy\.x, hullObjects\.value\[ \( \w+ \+ 9u \) \]\.xy\.y \) \* 0\.35 \), 1\.0 \) \)/);
});

test('ukryty kadłub spójny: zegar wzoru tylko w gałęziach awarii (ekrany, zerwanie), bez pasa interferencji', () => {
  const src = readFileSync(new URL('../src/3d/cloak/cloakTSL.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const surface = src.slice(src.indexOf('export function hullCloakSurface'), src.indexOf('// ── Refrakcja'));
  const lens = src.slice(src.indexOf('  // Soczewka globalna.'), src.indexOf('  // Zerwanie: pasy ekranu'));
  assert.doesNotMatch(surface, /sweep|interferencj/, 'pas interferencji usunięty');
  // w powierzchni zegar tylko w ekranach (tvStateAt) i zerwaniu (A.z)
  const uses = surface.split('\n').filter((l) => /uTime/.test(l) && !/tvStateAt|cellAt|export function|uTime\.mul\(30\.0\)/.test(l));
  assert.deepEqual(uses, [], 'płynący szum poświaty usunięty');
  assert.doesNotMatch(lens, /uTime|cloakNoise/, 'soczewka nieruchoma względem kadłuba');
  // komórki: próg z haszu (losowa kolejność), bez promienia od środka
  assert.doesNotMatch(src, /length\(hc\.zw/);
  assert.match(src, /A\.x\.sub\(h1\.sub\(0\.5\)\.mul\(D\.w\)\)/);
});

// Zmienne WGSL z main przypisane PRZED pierwszym odczytem (TSL potrafi wstawić przypisanie wspólnego węzła za jego
// użyciem w „varyingu” bez odbiorcy — tak warstwa DIST czytała macierz slotu 0 i nie rysowała nic, 2026-10-05).
function useBeforeAssign(src) {
  const main = mainOf(src);
  const body = main.slice(main.indexOf('// code'));
  const assigned = new Set();
  const bad = [];
  for (const line of body.split('\n')) {
    const lhs = line.match(/^\s*(nodeVar\d+) = /);
    const rhs = lhs ? line.slice(line.indexOf('=') + 1) : line;
    for (const m of rhs.matchAll(/\bnodeVar\d+\b/g)) if (!assigned.has(m[0])) bad.push(`${m[0]}: ${line.trim().slice(0, 90)}`);
    if (lhs) assigned.add(lhs[1]);
  }
  return bad;
}

test('etap wierzchołków skóry i warstwy DIST: zmienne przypisane przed użyciem (pozycja ze slotu)', () => {
  assert.deepEqual(useBeforeAssign(dist.vertex), []);
  assert.deepEqual(useBeforeAssign(hull.vertex), []);
  assert.match(mainOf(dist.vertex), /v_positionView = \( mat4x4<f32>\( hullObjects\.value\[/);
});

test('wizjer gracza: stan ze zgłoszenia, bez świeżego zgłoszenia wyłączony; w „uber” przed ACES; bez pierścienia', async () => {
  const { setCloakView, cloakViewUniform, CLOAK_VIEW } = await import('../src/3d/cloak/cloakView.js');
  const u = cloakViewUniform();
  const value = () => { u.update({}); return u.value; };
  setCloakView(0.8, 0.1);
  assert.deepEqual([value().x, value().y].map((v) => +v.toFixed(3)), [0.8, 0.1]);
  const s0 = CLOAK_VIEW.strength;
  CLOAK_VIEW.strength = 0;
  setCloakView(0.8, 0.1);
  assert.equal(value().x, 0, 'siła 0 — wizjer wyłączony');
  CLOAK_VIEW.strength = s0;
  setCloakView(0.8, 0);
  await new Promise((ok) => setTimeout(ok, 330));
  assert.deepEqual([value().x, value().y], [0, 0], 'stare zgłoszenie (menu, koniec gry) — wyłączony');
  const post = readFileSync(new URL('../src/3d/tsl/postGry.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const at = post.indexOf('applyCloakView(uCloakView, sceneColor, uvTex, uAspect)');
  assert.ok(at > 0 && at < post.indexOf('return vec4(linearDoSrgb(acesGry(sceneColor.rgb)), sceneColor.a);'));
  assert.match(post, /uCloakView: cloakViewUniform\(\)/);
  // pierścień heksów przelatujący przez ekran przy włączaniu usunięty (decyzja użytkownika 2026-10-05),
  // tak samo fala refrakcji i rosnący błysk generatora w cząstkach
  const view = readFileSync(new URL('../src/3d/cloak/cloakView.js', import.meta.url), 'utf8');
  assert.doesNotMatch(view, /ringSec|ring:/);
  const fx = readFileSync(new URL('../src/3d/cloak/cloakFx.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const engage = fx.slice(fx.indexOf('  _engage('), fx.indexOf('  _break('));
  assert.doesNotMatch(engage, /K\.SHOCK|K\.GLOW/);
});

test('heksy-ekrany w „uber”: maska i śnieg z B / A warstwy DIST, bez aberracji warstwy na ekranie', () => {
  const post = readFileSync(new URL('../src/3d/tsl/postGry.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(post, /cloakTv\.assign\(clamp\(o\.zw, vec2\(0\.0\), vec2\(1\.0\)\)\);/);
  assert.match(post, /const ab = layerOff\.mul\(0\.12\)\.toVar\(\);/);
  assert.match(post, /layerAber\.assign\(ab\.mul\(float\(1\.0\)\.sub\(tvK\)\)\.mul\(cloakRefract\)/);
  assert.match(post, /const cloakRefract = select\(o\.z\.lessThan\(-0\.0002\), float\(0\.0\), float\(1\.0\)\);/);
  assert.match(post, /applyCloakScreens\(sceneColor, cloakTv, uvTex,/);
  // cel DIST: RGBA (B / A — ekrany maskowania)
  const core = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(core, /this\.distortionTarget = new THREE\.RenderTarget\(w0, h0, \{\s*format: THREE\.RGBAFormat, type: THREE\.HalfFloatType/);
  // pule broni piszą B = A = 0 (nie zapalają ekranów)
  const gpu = readFileSync(new URL('../src/3d/weapons/gpuFx.js', import.meta.url), 'utf8');
  assert.match(gpu, /return vec4\(px, 0\.0, 0\.0\);/);
});

test('skóra belek: ramka ekranu (linia siatki) w gałęzi maskowania, za siłą ekranów (slot 21 .w)', () => {
  const main = mainOf(hull.fragment);
  const cond = main.search(/if \( \( abs\( hullObjects\.value\[ \( \w+ \+ 17u \) \]\.y \) > 0\.5 \) \)/);
  const tv = main.search(/if \( \( hullObjects\.value\[ \( \w+ \+ 21u \) \]\.w > 0\.001 \) \)/);
  assert.ok(cond > 0 && tv > cond, 'ekrany w gałęzi maskowania');
});

test('slot kadłuba: 22 vec4, maskowanie w 17–21 (zapis w commit z wyglądu encji)', () => {
  assert.equal(HULL_OBJECT_SLOT_VEC4, 22);
  const look = createCloakLook(null, 11);
  stepCloakLook(look, { state: 'engaging', level: 0.5, energy: 60, lastBreak: null }, 0.016, 3, { x: 0, y: 0, angle: 0, scale: 1, spriteW: 200, spriteH: 80 });
  const holder = (k) => ({ get value() { return look[k]; } });
  const mat = new HullNodeMaterial('beam', {
    uSprite: { value: spriteTexture() }, uNormalMap: { value: HULL_FLAT_NORMAL_TEXTURE }, uHasNormalMap: { value: 0 },
    uSpriteSize: { value: new THREE.Vector2(200, 80) }, uLightDir: { value: new THREE.Vector3(0, 0, 1) },
    uRotation: { value: 0 }, uLodOpacity: { value: 1 }, uBillboardLighting: { value: 0 },
    uShipLightCount: { value: 0 }, uEngineZoneCount: { value: 0 }, uLightBase: { value: 0 },
    uShapeMap: HullLacquer.flatShapeUniform, uLacquerWeight: { value: 0 }, uLacquerGlint: { value: 1 },
    uDmgSlot: { value: new THREE.Vector4() }, uDmgWorld: { value: new THREE.Vector2(1, 1) }, uGridOwner: { value: 0 },
    uWarpA: { value: new THREE.Vector4() }, uWarpB: { value: new THREE.Vector4() }, uWarpC: { value: new THREE.Vector4() },
    uCloakA: holder('a'), uCloakB: holder('b'), uCloakC: holder('c'), uCloakD: holder('d'), uCloakE: holder('e'),
    uHullSlot: { value: 0 }
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  const scene = new THREE.Scene();
  scene.add(mesh);
  scene.updateMatrixWorld();
  const cam = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 1000);
  cam.position.set(0, 0, 500);
  const slot = HullObjectStore.acquire(mesh);
  mat.uniforms.uHullSlot.value = slot;
  try {
    assert.equal(HullObjectStore.commit(cam), 1);
    const A = HullObjectStore.attribute.array;
    const o = slot * HULL_OBJECT_SLOT_VEC4 * 4;
    const f = (v) => Math.fround(v);
    assert.deepEqual(Array.from(A.subarray(o + 68, o + 72)), [look.a.x, look.a.y, look.a.z, look.a.w].map(f));
    assert.deepEqual(Array.from(A.subarray(o + 76, o + 80)), [look.c.x, look.c.y, look.c.z, look.c.w].map(f));
    assert.equal(A[o + 80], look.d.x);
    assert.equal(A[o + 69], 1, 'kierunek fali');
    assert.deepEqual(Array.from(A.subarray(o + 84, o + 88)), [look.e.x, look.e.y, look.e.z, look.e.w].map(f));
    assert.equal(A[o + 85], 0, 'włączanie — bez pasa ekranów');
    assert.equal(A[o + 82], f(look.d.z), 'soczewka globalna w D.z');
  } finally {
    HullObjectStore.release(slot);
  }
});
