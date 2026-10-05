// Tarcza z dema WebGPU w grze (src/3d/shield/): siatka płytek na CPU i pula slotów na GPU.
// Bez GPU: WGSL kerneli i materiałów budowany w Node (WGSLNodeBuilder, renderer bez init — jak
// bloomCompute.test / shieldTSL.test dawniej), limity wiązań (8 buforów storage na etap, 8 buforów
// wierzchołków, 12 buforów uniformów), układ siatki (sąsiedzi symetryczni, kierunki jak dirs).
// Obraz i zachowanie w grze: scripts/webgpu/tarcze-gra.mjs (prawdziwe GPU).
// node --test tests/shieldPool.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  buildShieldLattice, acquireShieldLattice, circleShieldProfile, SHIELD_NEIGHBOR_DIRS, shieldHexCell, nearestShieldTile
} from '../src/3d/shield/shieldLattice.js';
import { ShieldPool, SHIELD_SLOTS, SHIELD_SLOT_CAP, SLOT, SLOT_VEC4 } from '../src/3d/shield/shieldPool.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;

function buildCompute(node) {
  const b = renderer.backend.createNodeBuilder(node, renderer);
  b.build();
  return b.computeShader;
}
function buildRender(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const count = (s, re) => (s.match(re) || []).length;
const storageBuffers = (wgsl) => count(wgsl, /var<storage/g);
const uniformBuffers = (wgsl) => count(wgsl, /var<uniform>/g);

function ellipse(maxR, minR, n = 96) {
  const bins = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    bins[i] = (maxR * minR) / Math.hypot(minR * Math.cos(t), maxR * Math.sin(t));
  }
  return { bins, binCount: n, maxR, minR, pad: 20 };
}

test('siatka: sąsiedzi symetryczni i w kierunkach SHIELD_NEIGHBOR_DIRS, płytki w obrysie', () => {
  const p = ellipse(950, 380);
  const L = buildShieldLattice(p, 4096);
  assert.ok(L.n > 800 && L.n <= 4096, `płytek ${L.n}`);
  assert.equal(L.cell, shieldHexCell(p));
  const opposite = [1, 0, 5, 4, 3, 2];
  for (let k = 0; k < L.n; k++) {
    assert.ok(L.nrm[k * 4 + 3] < 0.975, 't < 0,975');
    assert.ok(L.rest[k * 4 + 3] >= 0 && L.rest[k * 4 + 3] < 1, 'ziarno w [0, 1)');
    for (let m = 0; m < 6; m++) {
      const j = L.nbr[k * 6 + m];
      if (j < 0) continue;
      assert.equal(L.nbr[j * 6 + opposite[m]], k, 'sąsiedztwo symetryczne');
      const dx = L.rest[j * 4] - L.rest[k * 4], dy = L.rest[j * 4 + 1] - L.rest[k * 4 + 1];
      assert.ok(Math.abs(dx - SHIELD_NEIGHBOR_DIRS[m][0] * L.cell) < 1e-3 && Math.abs(dy - SHIELD_NEIGHBOR_DIRS[m][1] * L.cell) < 1e-3,
        'przesunięcie do sąsiada = kierunek × odstęp');
    }
  }
});

test('siatka: najbliższa płytka punktu (test przebicia pocisków)', () => {
  const p = ellipse(700, 300);
  const L = buildShieldLattice(p, 4096);
  for (let k = 0; k < L.n; k += 37) {
    const x = L.rest[k * 4], y = L.rest[k * 4 + 1];
    assert.equal(nearestShieldTile(L, x, y), k);
    assert.equal(nearestShieldTile(L, x + L.cell * 0.3, y - L.cell * 0.2), k, 'wewnątrz komórki — ta sama płytka');
  }
  assert.equal(nearestShieldTile(L, 5000, 5000), -1, 'poza siatką');
});

test('siatka: duży kadłub nie przepełnia slotu (rośnie odstęp), pamięć po kształcie, koło', () => {
  const big = ellipse(3200, 1400);
  const L = buildShieldLattice(big, 4096);
  assert.ok(L.n <= 4096 && L.cell > shieldHexCell(big));
  const a = acquireShieldLattice(ellipse(600, 250), 4096);
  const b = acquireShieldLattice(ellipse(600, 250), 4096);
  assert.equal(a, b, 'ten sam kształt — ta sama siatka');
  const c = circleShieldProfile(180);
  assert.equal(c.maxR, 180);
  assert.equal(circleShieldProfile(180.2), c);
  assert.ok(buildShieldLattice(c, 4096).n > 100);
});

test('pula: kernele i materiały budują się do WGSL w limitach wiązań', () => {
  const pool = new ShieldPool();
  for (const k of pool.kernels) {
    const cs = buildCompute(k);
    assert.ok(cs.length > 200);
    assert.ok(storageBuffers(cs) <= 8, `kernel: ${storageBuffers(cs)} buforów storage (limit 8)`);
    assert.ok(uniformBuffers(cs) <= 12, `kernel: ${uniformBuffers(cs)} buforów uniformów`);
    assert.doesNotMatch(cs, /\bpow\(\s*-/, 'pow ze stałą ujemną podstawą');
  }
  for (const mesh of [pool.tileMesh, pool.distMesh, pool.glowMesh]) {
    const { vertex, fragment } = buildRender(mesh);
    const v = vertex.indexOf('@vertex');
    const sig = vertex.slice(v, vertex.indexOf('->', v));
    const attrs = count(sig, /@location\(\s*\d+\s*\)/g);
    assert.ok(attrs >= 4 && attrs <= 8, `${mesh.name}: ${attrs} atrybutów wierzchołków (limit 8)`);
    assert.ok(uniformBuffers(vertex) <= 12 && uniformBuffers(fragment) <= 12);
    if (mesh === pool.tileMesh) assert.ok(fragment.includes('shieldHash12'), 'rysy w fragmencie płytek');
  }
  const sp = buildRender(pool.sparkSprite);
  assert.ok(sp.vertex.length > 200);
});

test('pula: wgranie slotu — płytki w swoim wycinku, sąsiedzi na indeksach globalnych, reszta pusta', () => {
  const pool = new ShieldPool();
  const p = ellipse(500, 220);
  const L = buildShieldLattice(p, SHIELD_SLOT_CAP);
  const s = 3, o = s * SHIELD_SLOT_CAP;
  const n = pool.uploadSlot(s, L, p);
  assert.equal(n, L.n);
  const rest = pool.restB.value.array, nrm = pool.nrmB.value.array, nbr = pool.nbrB.value.array;
  assert.equal(rest[(o + 5) * 4], L.rest[5 * 4]);
  assert.equal(rest[(o + n) * 4 + 3], -1, 'za ostatnią płytką brak płytki');
  assert.equal(nrm[(o + n) * 4 + 3], 2);
  for (let k = 0; k < n * 6; k++) {
    const v = nbr[o * 6 + k];
    assert.ok(v === -1 || (v >= o && v < o + n));
  }
  assert.equal(pool.restB.value.updateRanges.length, 1);
  assert.equal(pool.binsB.value.array[s * 96 + 10], p.bins[10]);
  assert.equal(pool.slotData.length, SHIELD_SLOTS * SLOT_VEC4);
  assert.ok(SLOT.MISC < SLOT_VEC4);
  assert.ok(SLOT.HARD < SLOT_VEC4);
});

test('twardość i pokazanie tarczy per slot (tryb TARCZE gracza, twardość Atlasa)', () => {
  const pool = new ShieldPool();
  assert.equal(pool.U.thr, undefined, 'próg przebicia nie jest już wspólny');
  const src = read('src/3d/shield3D.js');
  assert.match(src, /pool\.slotVec\(s, SLOT\.HARD\)\.set\(Math\.max\(0\.05, SHIELD_TUNING\.threshold\) \* rec\.hard/);
  assert.match(src, /rec\.hard = Number\(sh\.hardness\) > 0/);
  assert.match(src, /const showOn = !!sh\.show/);
  const html = read('index.html');
  assert.match(html, /ship\.shield\.hardness = \(Number\(ship\.shield\.baseHardness\) \|\| 1\) \* tune\.shieldHardness;/);
  assert.match(html, /ship\.shield\.show = !!tune\.shieldShow;/);
  assert.match(read('src/data/playerHullCatalog.js'), /hardness: 2\.5/);
});

test('klej gry: stare tarcze usunięte, krok efektów i rozgrzewka', () => {
  const src = read('src/3d/shield3D.js');
  assert.doesNotMatch(src, /from '\.\/(shieldImpactFx|shield3D\.tsl)\.js'/);
  assert.match(src, /Core3D\.addFxStep\(\{\s*name: 'tarcze'/);
  assert.match(src, /Core3D\.prewarmPass\(p\.tileMesh, 7\)/);
  assert.match(src, /Core3D\.setDistortLayerActive\(true\)/);
  const html = read('index.html');
  assert.doesNotMatch(html, /ShieldImpactFX|SHIELD_IMPACT_PRESETS/);
  assert.match(html, /window\.ShieldTuning = SHIELD_TUNING/);
});

test('przebicie: pocisk przez dziurę omija tarczę do końca lotu i trafia pancerz z pominięciem tarczy', () => {
  const html = read('index.html');
  // Pocisk wewnątrz pola (po przebiciu) — test okręgu dawałby t = 0 i tarcza łapałaby go od środka.
  assert.match(html, /if \(b\.shieldPassed === realNpc\) candidateBreach = true;/);
  assert.match(html, /isShieldBreachedAt\(realNpc, candX0 \+ \(b\.x - candX0\) \* shieldT, candY0 \+ \(b\.y - candY0\) \* shieldT\)/);
  // Ani blokada tarczy (failsafe kadłuba pod tarczą), ani brak gałęzi kadłuba.
  assert.match(html, /if \(shieldActive && \(didHitShield \|\| \(hexHit && !hitBreach\)\)\) \{/);
  assert.match(html, /\} else if \(\(!shieldActive \|\| hitBreach\) && hexHit\) \{/);
  assert.match(html, /applyDamageToNPC\(hitNPC, npcDamage \* entryK\.hp, b\.type, hitBreach \? SHIELD_BREACH_DAMAGE_OPTS : undefined\)/);
  // Wiązki i rakiety: ta sama dziura.
  assert.match(html, /out\.breach = hitBreach;/);
  const rockets = read('src/effects3d/rocketSystem3D.js');
  assert.match(rockets, /window\.isShieldBreachedAt\(target, r\.position\.x, r\.position\.z\)/);
});
