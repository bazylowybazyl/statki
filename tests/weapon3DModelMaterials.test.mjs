// Materiały efektów broni (zadanie 17 portu WebGPU): dawny weapon3DSystem.js (pociski i błyski
// jako InstancedMesh z MeshBasicMaterial) zastąpiły pule i style z dema bronie-webgpu
// (src/3d/weapons/). Test pilnuje tego, czego pilnował stary: wieżyczki nie wracają jako modele
// 3D (zostają na kanwie — src/vfx/turret2D.js), pociski i błyski świecą w HDR i są instancjonowane
// na całą scenę (jeden draw call na system), barwy w pasmach HDR z dema.
// node --test tests/weapon3DModelMaterials.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RECIPES } from '../src/3d/weapons/recipes.js';
import { WEAPON_FX, WEAPON_FX_IDS } from '../src/3d/weapons/weaponFxTable.js';
import { PSTYLE } from '../src/3d/weapons/projectiles.js';
import { TRAIL_STYLES } from '../src/3d/weapons/trails.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

const read = (f) => readFileSync(new URL(`../src/3d/weapons/${f}`, import.meta.url), 'utf8');
const FILES = ['gpuFx.js', 'projectiles.js', 'trails.js', 'beams.js', 'recipes.js', 'weaponFx.js', 'weaponFxTable.js', 'liveRange.js'];
const BLOOM_THRESHOLD = Number(readFileSync(new URL('../src/3d/bloomConfig.js', import.meta.url), 'utf8').match(/threshold: ([0-9.]+),/)?.[1]);

// Wieżyczki zjechały na kanwę 2D (src/vfx/turret2D.js) — modele 3D niosły po kilka oświetlanych
// draw calli na broń. Efekty broni nie budują modeli ani oświetlanych materiałów wieżyczek.
test('efekty broni nie budują modeli wieżyczek 3D (wieżyczki zostają na kanwie)', () => {
  for (const f of FILES) {
    const src = read(f);
    assert.doesNotMatch(src, /function\s+build\w*Turret\s*\(|createWeapon3DMesh|mergeTurretParts/, f);
    assert.doesNotMatch(src, /MeshLambertMaterial|MeshStandardMaterial|MeshPhongMaterial/, f);
    assert.doesNotMatch(src, /BoxGeometry|CylinderGeometry|TorusGeometry|ExtrudeGeometry/, f);
  }
  // Lufa (pozycja wylotu, odrzut) przychodzi z warstwy 2D.
  assert.match(read('weaponFx.js'), /Turret2D\.triggerShot\(/);
});

// Pociski: 8 stylów z dema w JEDNYM draw callu (instancje z bufora), addytywnie, alfa = max(rgb)
// (konwencja gry dla addytywnych), bez zapisu głębi.
test('pociski: 8 stylów w jednym instancjonowanym draw callu, addytywnie z alfą max(rgb)', () => {
  assert.equal(Object.keys(PSTYLE).length, 8);
  const proj = read('projectiles.js');
  assert.match(proj, /this\.mesh = new THREE\.Mesh\(new THREE\.PlaneGeometry\(1, 1\), mat\);/);
  assert.match(proj, /return vec4\(c, max\(c\.x, max\(c\.y, c\.z\)\)\);/);
  assert.match(proj, /additiveMaterial\(/);
  const gpu = read('gpuFx.js');
  const add = gpu.slice(gpu.indexOf('export function additiveMaterial('), gpu.indexOf('\n}\n', gpu.indexOf('export function additiveMaterial(')));
  for (const re of [/mat\.depthWrite = false;/, /mat\.blending = THREE\.CustomBlending;/, /mat\.blendSrc = THREE\.OneFactor;/,
    /mat\.blendDst = THREE\.OneFactor;/, /mat\.forceSinglePass = true;/]) {
    assert.match(add, re);
  }
});

// Pasma HDR z dema (DEMO-BRONIE.md): rdzeń pocisku ponad progiem bloomu (świeci), ciało smugi
// w paśmie barwy (bez bloomu), gorący początek smugi krótko ponad progiem.
test('pasma HDR: rdzenie pocisków nad progiem bloomu, ciała smug w paśmie barwy', () => {
  assert.ok(BLOOM_THRESHOLD > 0);
  const max3 = (c) => Math.max(c[0], c[1], c[2]);
  for (const id of WEAPON_FX_IDS) {
    const def = MASTER_WEAPONS[id];
    if (def.category === 'beam') continue;
    const conf = RECIPES[WEAPON_FX[id].fx].projectile(def.size);
    const m = max3(conf.color);
    assert.ok(m > BLOOM_THRESHOLD && m <= 5, `${id}: rdzeń pocisku ${m} poza pasmem (${BLOOM_THRESHOLD}; 5]`);
    assert.ok(conf.color.every((v) => v >= 0 && Number.isFinite(v)), `${id}: barwa`);
  }
  for (const s of TRAIL_STYLES) {
    const young = max3(s.young);
    assert.ok(young >= 0.3 && young <= 1.4, `smuga ${s.key}: ciało ${young} poza pasmem 0,3–1,4`);
    assert.ok(max3(s.old) < young, `smuga ${s.key}: stara część ciemniejsza od młodej`);
    assert.ok(max3(s.hot) > BLOOM_THRESHOLD && max3(s.hot) <= 3, `smuga ${s.key}: gorący początek ${max3(s.hot)}`);
  }
});

// Błyski wylotowe zostają w 3D, ale nie jako dziecko wieżyczki (wieżyczki nie ma): paczki
// w pulach GPU dzielonych przez całą scenę (jedna siatka na pulę), a tani błysk (poza LOD
// i ponad budżet klatki) to jedna paczka GLOW w barwie broni.
test('błyski wylotowe: pule GPU na całą scenę, tani błysk w barwie broni', () => {
  const gpu = read('gpuFx.js');
  assert.match(gpu, /export const K = /);
  assert.match(read('recipes.js'), /export function cheapMuzzle\(ctx, m, r, g, b\) \{\s*const S = Math\.max\(0\.3, m\.scale \|\| 1\);\s*E\(ctx\.fx\.add, K\.GLOW, 1,/);
  const wfx = read('weaponFx.js');
  assert.match(wfx, /cheapMuzzle\(this\.ctx, m, c\[0\], c\[1\], c\[2\]\)/);
  assert.match(wfx, /hexHdr\(MASTER_WEAPONS\[id\]\?\.vfxColor \|\| '#ffe0a0', 3\.0, \[0, 0, 0\]\)/);
});
