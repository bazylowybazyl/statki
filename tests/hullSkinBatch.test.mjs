// Zadanie 23 portu WebGPU (duża bitwa): partie skór kadłubów belkowych (src/3d/hullSkinBatch.js) — jeden
// rysunek na zestaw tekstur zamiast rysunku na kadłub. Bufory partii: kolejność kadłubów = kolejność
// dodania (także po przepisaniu partii), indeksy przesunięte o początek wpisu, usunięty kadłub = zerowe
// indeksy, zmiany skóry jako osobne zakresy wysyłki (bez dziur między kadłubami). Bez GPU.
// node --test tests/hullSkinBatch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { HullSkinBatch } from '../src/3d/hullSkinBatch.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Topologia jak buildHullSkinTopology: count czworokątów, uv (8 na czworokąt), indeksy (6 na czworokąt).
function topo(count, uvBase = 0) {
  const uvs = new Float32Array(count * 8);
  for (let i = 0; i < uvs.length; i++) uvs[i] = uvBase + i * 0.001;
  const indices = new Uint32Array(count * 6);
  for (let q = 0; q < count; q++) {
    const v = q * 4;
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
  }
  return { count, uvs, indices };
}
function skin(count, seed) {
  const positions = new Float32Array(count * 12);
  const shade = new Float32Array(count * 4);
  const heat = new Float32Array(count * 8);
  for (let i = 0; i < positions.length; i++) positions[i] = seed + i;
  for (let i = 0; i < shade.length; i++) shade[i] = seed * 0.5 + i;
  for (let i = 0; i < heat.length; i++) heat[i] = seed * 0.25 + i;
  return { positions, shade, heat };
}
const material = () => new THREE.MeshBasicMaterial();

test('partia: wpisy kolejno, pozycje / jasność+żar / uv+slot z przeplotem, indeksy przesunięte', () => {
  const b = new HullSkinBatch('k', material());
  const A = skin(3, 100);
  const B = skin(2, 200);
  const ea = b.add(7, topo(3, 0.1), A.positions, A.shade, A.heat);
  const eb = b.add(9, topo(2, 0.2), B.positions, B.shade, B.heat);
  assert.equal(ea.vStart, 0);
  assert.equal(eb.vStart, 12);
  assert.equal(eb.iStart, 18);
  assert.equal(b.geometry.drawRange.count, 30);
  // wierzchołek 1 kadłuba B → globalnie 13
  const v = 13;
  assert.deepEqual(Array.from(b.pos.subarray(v * 3, v * 3 + 3)), Array.from(B.positions.subarray(3, 6)));
  assert.deepEqual(Array.from(b.sh.subarray(v * 3, v * 3 + 3)), [B.shade[1], B.heat[2], B.heat[3]]);
  assert.deepEqual(Array.from(b.uvs.subarray(v * 3, v * 3 + 3)), [Math.fround(0.2 + 2 * 0.001), Math.fround(0.2 + 3 * 0.001), 9]);
  assert.deepEqual(Array.from(b.idx.subarray(18, 24)), [12, 13, 14, 12, 14, 15]);
  // zmiany czworokąta: tylko jego wycinek w zakresach wysyłki (osobny zakres na kadłub)
  b.aPos.updateRanges.length = 0; b.aPos.__zakresy.used = 0;
  B.positions[4] = -1;
  b.writeQuads(eb, B.positions, B.shade, B.heat, 0, 0);
  A.positions[1] = -2;
  b.writeQuads(ea, A.positions, A.shade, A.heat, 0, 0);
  assert.equal(b.pos[13 * 3 + 1], -1);
  assert.equal(b.pos[1], -2);
  assert.deepEqual(b.aPos.updateRanges.map((r) => [r.start, r.count]), [[12 * 3, 12], [0, 12]], 'dwa zakresy, bez dziury między kadłubami');
  // stykający się z ostatnim zakresem — scalony
  b.writeQuads(ea, A.positions, A.shade, A.heat, 1, 1);
  assert.deepEqual(b.aPos.updateRanges.map((r) => [r.start, r.count]), [[12 * 3, 12], [0, 24]]);
});

test('usunięcie: zerowe indeksy, koniec partii cofa się; dziury przepisywane w tej samej kolejności', () => {
  const b = new HullSkinBatch('k', material());
  const E = [];
  for (let k = 0; k < 4; k++) { const S = skin(2, k * 10); E.push(b.add(k + 1, topo(2), S.positions, S.shade, S.heat)); }
  b.remove(E[1]);
  assert.deepEqual(Array.from(b.idx.subarray(E[1].iStart, E[1].iStart + 12)), new Array(12).fill(0), 'trójkąty zdegenerowane');
  assert.equal(b.geometry.drawRange.count, 48, 'środek — koniec bez zmian');
  b.remove(E[3]);
  assert.equal(b.geometry.drawRange.count, 36, 'ostatni wpis — koniec partii cofa się');
  assert.equal(b.vDead, 8);
  // przepisanie: E0, E2 zwarte, w tej samej kolejności (kolejność rysowania)
  b._compact();
  assert.deepEqual(b.entries.map((e) => [e.slot, e.vStart, e.iStart]), [[1, 0, 0], [3, 8, 12]]);
  assert.deepEqual(Array.from(b.idx.subarray(12, 18)), [8, 9, 10, 8, 10, 11]);
  assert.equal(b.uvs[8 * 3 + 2], 3, 'slot przepisanego kadłuba');
  assert.equal(b.pos[8 * 3], 20, 'pozycje przepisanego kadłuba (seed 20)');
  assert.equal(b.geometry.drawRange.count, 24);
});

test('rośnięcie: większe bufory z danymi, dodanie za końcem; pusta partia = zerowy zakres rysowania', () => {
  const b = new HullSkinBatch('k', material());
  const big = 5000; // 20 000 wierzchołków > 16 384
  const S = skin(big, 1);
  const e = b.add(1, topo(big), S.positions, S.shade, S.heat);
  assert.ok(b.vcap >= 20000 && b.icap >= 30000);
  assert.equal(b.mesh.geometry, b.geometry, 'siatka dostaje nową geometrię');
  assert.equal(b.pos[(big * 4 - 1) * 3 + 2], S.positions[big * 12 - 1]);
  b.remove(e);
  assert.equal(b.geometry.drawRange.count, 0);
  assert.ok(b.empty);
});

test('klej: nośnik kadłuba poza sceną, partia po zestawie tekstur, zapis czworokątów do partii', () => {
  const src = read('src/3d/hexShips3D.js');
  assert.match(src, /mesh\.userData\.hullBatched = true;/);
  assert.doesNotMatch(src.slice(src.indexOf('function createBeamSkinMesh('), src.indexOf('function rebuildBeamSkinGeometry(')), /Core3D\.scene\.add\(mesh\)/, 'nośnik nie w scenie');
  assert.match(src, /data\.batchEntry = data\.batch\.add\(data\.mesh\.material\.uniforms\.uHullSlot\.value, topo, data\.positions, data\.shade, data\.heat, data\.mesh\);/);
  assert.match(src, /mesh\.updateMatrixWorld\(\);/, 'macierz świata nośnika poza sceną');
  assert.match(src, /new HullNodeMaterial\('beamBatch', \{/);
  const tsl = read('src/3d/hexShips3D.tsl.js');
  // niewidoczny kadłub partii zwinięty w wierzchołku (flaga slotu), widoczny — klip bez zmian
  assert.match(tsl, /return this\.hullVisible \? select\(this\.hullVisible\.greaterThan\(0\.5\), clip, vec4\(2\.0, 2\.0, 2\.0, 1\.0\)\) : clip;/);
  assert.match(tsl, /A\[o \+ 53\] = mesh\.visible \? 1 : 0;/);
});
