// Oświetlenie kadłubów v2 (2026-10-06, src/3d/hullLighting.js + hullLighting.tsl.js): model PBR sprite'ów
// (klucz z azymutu słońca, niebo, wypełnienie, GGX, AO, samocień), lampy jako światła nad blachą, skupiony
// zanik błysków efektów (kadłub nie bieleje w walce), cień planety na wieżyczkach kanwy 2D.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { renderGroup } from 'three/tsl';
import { HULL_LIGHT_DEFAULTS, HullLighting } from '../src/3d/hullLighting.js';
import {
  EFFECT_FLASH_RATIO, effectFlashWeightCpu, hullEffectAttCpu, hullGgxCpu, hullLampFalloffCpu
} from '../src/3d/hullLighting.tsl.js';
import { discSunVisibilityCpu } from '../src/3d/sunShadowMask.js';
import { HULL_FLAT_NORMAL_TEXTURE, HullNodeMaterial } from '../src/3d/hexShips3D.tsl.js';
import { HullLacquer } from '../src/3d/hullLacquer.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('GGX (lustro CPU): szczyt przy normalnej w połowie drogi widz–światło, zero w cieniu, gładsze = ostrzejsze', () => {
  const el = 30 * Math.PI / 180;
  const L = [Math.cos(el), 0, Math.sin(el)];
  const hl = Math.hypot(L[0], L[1], L[2] + 1);
  const H = [L[0] / hl, L[1] / hl, (L[2] + 1) / hl];
  const flat = [0, 0, 1];
  const peak = hullGgxCpu(H, L, 0.42);
  assert.ok(peak > hullGgxCpu(flat, L, 0.42), 'płyta zwrócona ku słońcu błyszczy bardziej niż pozioma');
  assert.ok(hullGgxCpu(H, L, 0.25) > peak, 'gładsza farba — wyższy szczyt');
  assert.equal(hullGgxCpu([-1, 0, 0], L, 0.42), 0, 'normalna od światła — bez połysku');
  // Połysk pod progiem bloomu przy domyślnej szorstkości i kluczu (białe kadłuby nie mają się „zapalać”).
  assert.ok(peak * HULL_LIGHT_DEFAULTS.keyIntensity < 0.6, `szczyt połysku ${peak}`);
});

test('lampa nad blachą: pełne natężenie przy lampie, zanik ~1/d², zero na zasięgu', () => {
  const z = 14; const r0 = 12; const range = 80;
  const a0 = hullLampFalloffCpu(0, 0, z, r0, range);
  const a1 = hullLampFalloffCpu(20, 0, z, r0, range);
  const a2 = hullLampFalloffCpu(40, 0, z, r0, range);
  assert.ok(a0 > a1 && a1 > a2, 'maleje z odległością');
  assert.ok(a2 / a1 < 0.45, 'zanik szybszy niż liniowy');
  assert.equal(hullLampFalloffCpu(80, 0, z, r0, range), 0, 'okno do zera na zasięgu');
});

test('błyski efektów: skupiony zanik (kałuża przy wylocie), światła pola bez zmian', () => {
  const c = HULL_LIGHT_DEFAULTS.effectCore;
  const grid = (x) => { const w = 1 - x * x; return (w * w) / (x * x * 4 + 1); };
  assert.ok(Math.abs(hullEffectAttCpu(0, c) - grid(0)) < 1e-9, 'w środku jak siatka');
  assert.ok(hullEffectAttCpu(0.3, c) < grid(0.3) / 2.5, 'x = 0,3: ~3× ciemniej');
  assert.ok(hullEffectAttCpu(0.5, c) < grid(0.5) / 3.5, 'x = 0,5: ~4× ciemniej');
  // Klasyfikacja „błysk / światło pola” z mocy na zasięg (pomiary z receptur broni i świateł pola).
  assert.equal(effectFlashWeightCpu(14, 560), 1, 'błysk lufy');
  assert.equal(effectFlashWeightCpu(7, 280), 1, 'trafienie');
  assert.equal(effectFlashWeightCpu(16, 800), 1, 'wybuch');
  assert.equal(effectFlashWeightCpu(0.5, 2000), 0, 'światło dookoła okrętu w pasie');
  assert.ok(effectFlashWeightCpu(2.8, 3000) < 0.05, 'reflektor otoczenia');
  assert.ok(EFFECT_FLASH_RATIO[0] < EFFECT_FLASH_RATIO[1]);
});

test('HullLighting: strojenie → wspólne węzły (grupa render), przełącznik modelu A/B', () => {
  for (const [k, node] of Object.entries(HullLighting.uniforms)) {
    assert.ok(node?.isNode, k);
    assert.equal(node.groupNode, renderGroup, `${k} w grupie render (jeden zapis na klatkę)`);
  }
  const t = HullLighting.getTuning();
  HullLighting.setModel('classic');
  assert.equal(HullLighting.uniforms.uModel.value, 0);
  assert.equal(HullLighting.isPbr(), false);
  HullLighting.setModel('pbr');
  assert.equal(HullLighting.uniforms.uModel.value, 1);
  t.keyIntensity = 2;
  t.keyElevDeg = 45;
  HullLighting.update();
  const kc = HullLighting.uniforms.uKeyColor.value;
  assert.ok(Math.abs(kc.x - HULL_LIGHT_DEFAULTS.keyColor[0] * 2) < 1e-6);
  assert.ok(Math.abs(HullLighting.uniforms.uKeyElev.value.y - Math.SQRT1_2) < 1e-6);
  Object.assign(t, HULL_LIGHT_DEFAULTS);
  HullLighting.update();
  assert.ok(HullLighting.turretNight() > 0 && HullLighting.turretNight() < 1);
});

// WGSL w Node (jak tests/hexShips3DShader.test.mjs).
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
function beamFragment() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('aShade', new THREE.BufferAttribute(new Float32Array(4), 1));
  g.setAttribute('aHeat', new THREE.BufferAttribute(new Float32Array(8), 2));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const t = new THREE.Texture();
  t.image = { width: 64, height: 32 };
  t.minFilter = THREE.LinearMipmapLinearFilter;
  const m = new HullNodeMaterial('beam', {
    uSprite: { value: t }, uNormalMap: { value: HULL_FLAT_NORMAL_TEXTURE }, uHasNormalMap: { value: 0 },
    uSpriteSize: { value: new THREE.Vector2(64, 32) }, uLightDir: { value: new THREE.Vector3(0, 0, 1) },
    uRotation: { value: 0 }, uLodOpacity: { value: 1 }, uBillboardLighting: { value: 0 },
    uShipLightCount: { value: 0 }, uEngineZoneCount: { value: 0 }, uLightBase: { value: 0 },
    uShapeMap: HullLacquer.flatShapeUniform, uLacquerWeight: { value: 1 }, uLacquerGlint: { value: 1 }
  });
  const mesh = new THREE.Mesh(g, m);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = m;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = m;
  b.build();
  return b.fragmentShader;
}

test('materiał kadłuba: model v2 w tym samym grafie co klasyczny (jednolity przełącznik), GGX jako funkcja', () => {
  const frag = beamFragment();
  assert.match(frag, /fn hullGgx \(/, 'GGX jako funkcja WGSL (czysta, raz w module)');
  // Jeden graf, oba modele: przełącznik z grupy render (bez nowego pipeline'u przy zmianie modelu).
  assert.ok((frag.match(/render\.\w+ > 0\.5/g) || []).length >= 3, 'gałęzie po uModel');
  // Samocień: kilka próbek mapy powierzchni z przesuniętym uv — jedno wiązanie tekstury.
  assert.ok((frag.match(/: texture_2d<f32>/g) || []).length <= 8, 'limit tekstur');
  const tsl = read('src/3d/hexShips3D.tsl.js');
  assert.match(tsl, /perObjectTexture\('uSurfaceMap', PLACEHOLDER_SURFACE, spriteUV\)/);
  assert.match(tsl, /hullSelfShadow\(\{/);
  // Lampy v2: światło nad blachą zamiast płaskiej plamy, żarówka zostaje rdzeniem.
  assert.match(tsl, /const fo = hullLampFalloff\(toFrag,/);
  assert.match(tsl, /finalColor\.addAssign\(lampColor\.mul\(power\)\.mul\(sequenceMul\)\.mul\(core\)\.mul\(HL\.uLamp\.w\)\);/);
});

test('cień planety na CPU (lustro passa maski): umbra za planetą, słońce obok i przed nią', () => {
  const discs = new Float32Array([100000, -0, 6000, 1]); // planeta w (100 000, 0) gry, r 6000
  const sun = { x: 0, y: 0 };
  const vis = (x, y) => discSunVisibilityCpu(x, y, sun.x, sun.y, discs, 1, 5);
  assert.ok(vis(112000, 0) < 0.05, 'za planetą (od słońca) — umbra');
  assert.ok(vis(112000, 9000) > 0.95, 'obok smugi cienia');
  assert.equal(vis(90000, 0), 1, 'przed planetą (po stronie słońca)');
  assert.ok(vis(100000 + 6000 * 5 + 7000, 0) > 0.95, 'za końcem smugi (discLenMul)');
});

test('wieżyczki kanwy 2D: ciemnienie sylwetką (bez ctx.filter), wszystkie rysowniki sprite\'ów przez podkładkę', () => {
  const src = read('src/vfx/turret2D.js');
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /ctx\.filter\s*=/, 'filtr kanwy kosztuje ~4,6 ms na drawImage');
  assert.equal((src.match(/Sprite2D\.draw\(dctx,/g) || []).length, 7, 'każdy rysownik przez podkładkę');
  assert.match(src, /lightAt: null,/);
  const hex = read('src/3d/hexShips3D.js');
  assert.match(hex, /Turret2D\.lightAt = HullLighting\.isPbr\(\) \? turretLightAt : null;/);
  assert.match(read('src/3d/core3d.js'), /sunVisibilityAtWorld\(worldX, worldY\) \{/);
});
