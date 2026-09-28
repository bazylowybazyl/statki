// Siatka świateł gry (src/3d/fx/lightGrid.js, zadanie 12-A): budowa na CPU (komórki,
// sumy prefiksowe, limity, właściciel, początek przy kamerze), lustro CPU pętli,
// światła statków (addShipLights) i graf `GridLighting` budowany do WGSL w Node
// (WebGPURenderer bez init, atrapa kanwy — jak tests z zadania 06).
// node --test tests/fxLightGrid.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Fn, vec3, vec4, float, instanceIndex, storage, uniform } from 'three/tsl';
import {
  LightGrid, GridLighting, GridLightsNode, enableGridLights, addShipLights,
  LIGHT_CAP, ITEM_CAP, GRID_NX, GRID_NY, GRID_CELLS, CELL_WORDS, LIGHT_FLOATS, OMNI,
  FIELD_SHIP_LIGHTS, CAVE_SHIP_LIGHTS
} from '../src/3d/fx/lightGrid.js';

const close = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (±${tol})`);

// --- WGSL w Node ---------------------------------------------------------------
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
function makeRenderer(lighting = null) {
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  if (lighting) renderer.lighting = lighting;
  return renderer;
}
const sun = new THREE.DirectionalLight(0xffffff, 1);
function buildFragment(renderer, material) {
  const scene = new THREE.Scene();
  scene.add(sun);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = scene;
  b.camera = new THREE.OrthographicCamera();
  b.context.material = material;
  const lights = renderer.lighting.getNode(scene);
  lights.setLights([sun]);
  b.lightsNode = lights;
  b.build();
  return b.fragmentShader;
}
const count = (s, re) => (s.match(re) || []).length;

// --- budowa CPU ----------------------------------------------------------------

test('build: komórki dookólnego światła, sumy prefiksowe, lista wskazuje światło', () => {
  const g = new LightGrid();
  g.begin(0, 0);
  assert.equal(g.add(0, 0, 50, 100, 1, 0.5, 0.25), 0);
  g.build(-640, -400, 640, 400);              // komórka 20 × 20
  close(g.cellW, 20, 1e-9); close(g.cellH, 20, 1e-9);
  // koło r = 100 → x: komórki 27..37, y: 15..25 (11 × 11)
  assert.equal(g.stats.items, 121);
  assert.equal(g.stats.lights, 1);
  assert.equal(g.stats.maxPerCell, 1);
  const I = g.index;
  let sum = 0;
  let prevStart = CELL_WORDS;
  for (let c = 0; c < GRID_CELLS; c++) {
    const start = I[c * 2];
    const n = I[c * 2 + 1];
    assert.ok(start >= prevStart && start <= CELL_WORDS + g.stats.items, `start komórki ${c}`);
    prevStart = start;
    for (let k = 0; k < n; k++) assert.equal(I[start + k], 0, 'lista wskazuje światło 0');
    const cx = c % GRID_NX;
    const cy = (c / GRID_NX) | 0;
    const inside = cx >= 27 && cx <= 37 && cy >= 15 && cy <= 25;
    assert.equal(n, inside ? 1 : 0, `komórka (${cx}, ${cy})`);
    sum += n;
  }
  assert.equal(sum, 121);
  // zakresy do wysłania: światła (16 liczb) i indeks (komórki + listy)
  assert.deepEqual(g.lightNode.value.updateRanges[0], { start: 0, count: LIGHT_FLOATS });
  assert.deepEqual(g.indexNode.value.updateRanges[0], { start: 0, count: CELL_WORDS + 121 });
});

test('build: światło poza prostokątem nie trafia do komórek; reflektor zajmuje wycinek, nie koło', () => {
  const g = new LightGrid();
  g.begin();
  g.add(5000, 5000, 50, 100, 1, 1, 1);
  g.build(-640, -400, 640, 400);
  assert.equal(g.stats.items, 0);

  const omni = new LightGrid();
  omni.begin();
  omni.add(0, 0, 50, 1000, 1, 1, 1);
  omni.build(-2000, -2000, 2000, 2000);
  const spot = new LightGrid();
  spot.begin();
  const half = 15 * Math.PI / 180;
  spot.add(0, 0, 50, 1000, 1, 1, 1, 0.5, 1, 0, 0, Math.cos(half), Math.cos(half * 0.5));
  spot.build(-2000, -2000, 2000, 2000);
  assert.ok(spot.stats.items > 0 && spot.stats.items < omni.stats.items / 4,
    `wycinek ${spot.stats.items} vs koło ${omni.stats.items}`);
});

test('limity: LIGHT_CAP świateł, ITEM_CAP wpisów (nadmiar liczony w dropped, bez wyjścia poza bufor)', () => {
  const g = new LightGrid();
  g.begin();
  let ok = 0;
  for (let i = 0; i < LIGHT_CAP + 50; i++) if (g.add(0, 0, 50, 1e7, 1, 1, 1) >= 0) ok++;
  assert.equal(ok, LIGHT_CAP);
  assert.equal(g.add(0, 0, 50, 100, 1, 1, 1), -1, 'pula pełna');
  g.build(-1000, -1000, 1000, 1000);
  const wanted = LIGHT_CAP * GRID_CELLS;
  assert.equal(g.stats.items, ITEM_CAP);
  assert.equal(g.stats.dropped, wanted - ITEM_CAP);
  const I = g.index;
  for (let c = 0; c < GRID_CELLS; c++) {
    const start = I[c * 2];
    const n = I[c * 2 + 1];
    assert.ok(start + n <= CELL_WORDS + ITEM_CAP, `komórka ${c} poza buforem`);
  }
  // odrzucenia: zerowa barwa / zasięg
  const h = new LightGrid();
  h.begin();
  assert.equal(h.add(0, 0, 0, 0.5, 1, 1, 1), -1);
  assert.equal(h.add(0, 0, 0, 100, 0, 0, 0), -1);
});

test('właściciel: światła zapisane w L3.w, lustro pętli pomija światła własnego statku', () => {
  const g = new LightGrid();
  g.begin();
  g.add(0, 0, 50, 400, 1, 0, 0, 0.5, 0, 0, -1, OMNI, 0, 0, 0, 7);   // lampa statku 7
  g.add(30, 0, 50, 400, 0, 1, 0);                                   // bez właściciela
  g.build(-640, -400, 640, 400);
  assert.equal(g.lights[15], 7);
  assert.equal(g.lights[LIGHT_FLOATS + 15], 0);
  const all = g.sampleCpu(10, 0, 0);
  assert.equal(all.n, 2);
  assert.ok(all.r > 0 && all.g > 0);
  const own = g.sampleCpu(10, 0, 0, 7);
  assert.equal(own.n, 1);
  assert.equal(own.r, 0, 'czerwień własnej lampy pominięta');
  assert.ok(own.g > 0);
  assert.equal(g.sampleCpu(10, 0, 0, 3).n, 2, 'inny właściciel — widzi obie');
  assert.equal(g.sampleCpu(10, 0, 0, 0).n, 2, 'właściciel 0 = brak: nie gasi świateł efektów (właściciel 0)');
});

test('build: światło daleko poza kadrem nie zawija granic komórek (błąd Int16 w kopiach dem), NaN odrzucony', () => {
  const g = new LightGrid();
  g.begin();
  g.add(0, 0, 50, 100, 1, 1, 1);
  g.add(-1_200_000, 0, 50, 1000, 1, 1, 1);          // kopia dema: zakres komórek 0..5618
  g.add(800_000, 0, 50, 1000, 1, 1, 1);             // kopia dema: −25 554..63
  g.add(0, -900_000, 50, 1000, 1, 1, 1);
  assert.equal(g.add(NaN, 0, 50, 100, 1, 1, 1), -1);
  assert.equal(g.add(0, 0, Infinity, 100, 1, 1, 1), -1);
  g.build(-640, -400, 640, 400);
  assert.equal(g.stats.items, 121);
  assert.equal(g.stats.dropped, 0, 'bez setek tysięcy pustych iteracji');
  const I = g.index;
  for (let c = 0; c < GRID_CELLS; c++) {
    for (let k = 0; k < I[c * 2 + 1]; k++) assert.equal(I[I[c * 2] + k], 0);
  }
});

test('pusta siatka: zero światła wszędzie (obraz materiałów z siatką bez zmian)', () => {
  const g = new LightGrid();
  g.begin(123456, -654321);
  g.build(-640, -400, 640, 400);
  assert.equal(g.stats.items, 0);
  for (const [x, y] of [[0, 0], [-600, 390], [639, -399]]) {
    const s = g.sampleCpu(x, y, 0);
    assert.deepEqual([s.r, s.g, s.b, s.n], [0, 0, 0, 0]);
  }
});

test('stożek: jasny na osi, gaśnie do brzegu (smoothstep²); wewnętrzny ≤ zewnętrzny i zerowa oś bez NaN', () => {
  const g = new LightGrid();
  g.begin();
  const half = 20 * Math.PI / 180;
  g.add(0, 0, 0, 1000, 1, 1, 1, 0.5, 1, 0, 0, Math.cos(half), Math.cos(half * 0.45));
  g.add(0, 300, 0, 1000, 1, 1, 1, 0.5, 1, 0, 0, 0.9, 0.9);      // e0 == e1 → poprawione
  g.add(0, -300, 0, 1000, 1, 1, 1, 0.5, 0, 0, 0, 0.8, 0.9);     // zerowa oś → dookólne
  g.build(-2000, -2000, 2000, 2000);
  const L = g.lights;
  assert.ok(L[LIGHT_FLOATS + 12] > L[LIGHT_FLOATS + 11], 'stożek wewnętrzny węższy');
  assert.equal(L[2 * LIGHT_FLOATS + 11], OMNI);
  const g1 = new LightGrid();
  g1.begin();
  g1.add(0, 0, 0, 1000, 1, 1, 1, 0.5, 1, 0, 0, Math.cos(half), Math.cos(half * 0.45));
  g1.build(-2000, -2000, 2000, 2000);
  const axis = g1.sampleCpu(400, 0, 0).r;
  const edge = g1.sampleCpu(400 * Math.cos(half * 0.9), 400 * Math.sin(half * 0.9), 0).r;
  const out = g1.sampleCpu(400 * Math.cos(half * 1.2), 400 * Math.sin(half * 1.2), 0).r;
  assert.ok(axis > 0 && edge > 0 && edge < axis * 0.2, `oś ${axis}, brzeg ${edge}`);
  assert.equal(out, 0, 'poza stożkiem');
  for (const [x, y] of [[100, 300], [0, 0], [-100, -300]]) {
    const s = g.sampleCpu(x, y, 0);
    assert.ok(Number.isFinite(s.r) && Number.isFinite(s.g) && Number.isFinite(s.b));
  }
});

test('początek przy kamerze: addWorld liczy w double (świat 6 mln j. → małe, dokładne liczby)', () => {
  const g = new LightGrid();
  g.begin(6_000_000, 3_000_000);                  // układ SCENY: (x, −y) — świat y = −3 mln
  assert.equal(g.worldOriginX, 6_000_000);
  assert.equal(g.worldOriginY, -3_000_000);
  const i = g.addWorld(6_000_010.25, -3_000_020.5, 40, 300, 1, 1, 1);
  assert.equal(i, 0);
  assert.equal(g.lights[0], 10.25);
  assert.equal(g.lights[1], 20.5, 'scena ma odwrócone y');
  assert.equal(g.toLocalX(6_000_010.25), 10.25);
  assert.equal(g.toLocalY(-3_000_020.5), 20.5);
  // Bez początku float32 zaokrągla pozycję świata do 0,5 j.
  assert.notEqual(Math.fround(6_000_010.25) - 6_000_000, 10.25);
  // begin bez argumentów zachowuje początek; prostokąt odrzucania dla add
  g.begin();
  assert.equal(g.originX, 6_000_000);
  g.setBounds(-500, -500, 500, 500);
  assert.equal(g.addWorld(6_000_000 + 900, -3_000_000, 40, 300, 1, 1, 1), -1, 'koło nie dotyka kadru');
  assert.equal(g.addWorld(6_000_000 + 700, -3_000_000, 40, 300, 1, 1, 1), 0, 'koło dotyka kadru');
  assert.equal(g.culled, 1);
  g.build();                                       // prostokąt z setBounds
  close(g.cellW, 1000 / GRID_NX, 1e-9);
  assert.equal(g.stats.culled, 1);
});

// --- światła statków ----------------------------------------------------------

test('addShipLights: kadłub bez lamp — para reflektorów na dziobie z właścicielem + światło dookoła bez', () => {
  const g = new LightGrid();
  g.begin(1000, -2000);                           // świat: (1000, 2000)
  const ship = { pos: { x: 1500, y: 2000 }, angle: 0 };
  const far = addShipLights(g, ship, 1000, { owner: 4, time: 0 });
  assert.equal(g.count, 3);
  const L = g.lights;
  const sp = FIELD_SHIP_LIGHTS.spot;
  for (let k = 0; k < 2; k++) {
    const o = k * LIGHT_FLOATS;
    close(L[o], 500 + 470, 1e-3, 'dziób x (lokalnie)');
    close(Math.abs(L[o + 1]), 35, 1e-3, 'rozstaw reflektorów');
    assert.equal(L[o + 2], sp.z);
    assert.equal(L[o + 3], Math.min(sp.maxRange, Math.max(sp.minRange, 1000 * sp.rangeMul)));
    assert.equal(L[o + 15], 4, 'reflektor należy do statku');
    assert.ok(L[o + 11] > -1.5, 'reflektor, nie dookólne');
    close(L[o + 7], sp.scatter, 1e-6);
  }
  const o = 2 * LIGHT_FLOATS;
  assert.equal(L[o + 11], OMNI);
  assert.equal(L[o + 15], 0, 'światło dookoła oświetla też własny kadłub');
  close(L[o], 500, 1e-9); close(L[o + 1], 0, 1e-9);
  assert.equal(far.n, 2);
  close(far.x, 970, 1e-3);
  // To samo z jawnym początkiem świata (wywołanie z dema) i dla NPC z x/y zamiast pos.
  const g2 = new LightGrid();
  g2.begin(1000, -2000);
  addShipLights(g2, { x: 1500, y: 2000, angle: 0 }, 1000, g2.worldOriginX, g2.worldOriginY, { owner: 4, time: 0 });
  assert.deepEqual(Array.from(g2.lights.subarray(0, 3 * LIGHT_FLOATS)), Array.from(L.subarray(0, 3 * LIGHT_FLOATS)));
  // Profil jaskini: reflektory mocniej w dół.
  const g3 = new LightGrid();
  g3.begin(1000, -2000);
  addShipLights(g3, ship, 1000, { owner: 4, profile: CAVE_SHIP_LIGHTS });
  assert.ok(g3.lights[10] < L[10], 'oś reflektora pochylona bardziej');
});

test('addShipLights: lampy edytora — reflektory, reflektory otoczenia i grupy lamp pozycyjnych', () => {
  const g = new LightGrid();
  g.begin(0, 0);
  const ship = {
    pos: { x: 0, y: 0 }, angle: 0.3,
    editorLights: {
      road: [{ x: 300, y: -30, deg: 90 }, { x: 300, y: 30, deg: 90 }],
      flood: [{ x: -250, y: 0, deg: -90 }],
      position: [{ x: -200, y: -60 }, { x: -150, y: 60 }, { x: 200, y: -60 }, { x: 250, y: 60 }]
    }
  };
  addShipLights(g, ship, 700, { owner: 9, time: 0.4 });
  const L = g.lights;
  let spots = 0; let omni = 0; let owned = 0;
  for (let i = 0; i < g.count; i++) {
    const o = i * LIGHT_FLOATS;
    if (L[o + 11] > -1.5) spots++; else omni++;
    if (L[o + 15] === 9) owned++;
  }
  assert.ok(spots >= 3, `reflektory: ${spots}`);
  assert.ok(omni >= 2, `dookólne (światło + lampy): ${omni}`);
  assert.equal(owned, g.count - 1, 'wszystko poza światłem dookoła ma właściciela');
});

// --- graf GridLighting (WGSL w Node) --------------------------------------------

test('GridLighting „optIn”: materiał bez flagi ma WGSL identyczny jak bez siatki (obraz bez zmian)', () => {
  const plain = buildFragment(makeRenderer(), new THREE.MeshStandardNodeMaterial({ color: 0x808080 }));
  const grid = new LightGrid();
  const withGrid = buildFragment(makeRenderer(new GridLighting(grid)), new THREE.MeshStandardNodeMaterial({ color: 0x808080 }));
  assert.equal(withGrid, plain);
  assert.doesNotMatch(withGrid, /fxGrid/);
});

test('GridLighting: materiał z flagą czyta siatkę — 2 bufory storage (tylko odczyt), pętla, punkt lokalny z widoku', () => {
  const grid = new LightGrid();
  const renderer = makeRenderer(new GridLighting(grid));
  const mat = enableGridLights(new THREE.MeshStandardNodeMaterial({ color: 0x808080 }));
  assert.ok(Object.keys(mat).includes('gridLights'), 'flaga jest polem materiału → wchodzi do klucza programu');
  const frag = buildFragment(renderer, mat);
  assert.equal(count(frag, /var<storage, read> fxGridLights\b/g), 1);
  assert.equal(count(frag, /var<storage, read> fxGridIndex\b/g), 1);
  assert.equal(count(frag, /var<storage/g), 2, 'dwa bufory storage siatki');
  assert.match(frag, /for \( var gridItem : u32 = /);
  assert.match(frag, /render\.cameraWorldMatrix \* vec4<f32>\( v_positionView, 0\.0 \) \)\.xyz \+ render\.fxGridCamLocal/);
  assert.ok(count(frag, /var<uniform>/g) <= 3, `buforów uniform: ${count(frag, /var<uniform>/g)}`);
  // Materiał wbudowany z flagą (konwertowany przez bibliotekę węzłów) też.
  const builtin = new THREE.MeshStandardMaterial({ color: 0x808080 });
  builtin.gridLights = true;
  assert.match(buildFragment(renderer, builtin), /fxGridLights/);
  // Tryb punktu 'world': positionWorld − początek.
  const worldFrag = buildFragment(makeRenderer(new GridLighting(new LightGrid(), { positionMode: 'world' })), enableGridLights(new THREE.MeshStandardNodeMaterial()));
  assert.match(worldFrag, /fxGridOrigin/);
});

test('GridLighting: właściciel materiału pomija swoje światła; tryb „all” jak w demach', () => {
  const grid = new LightGrid();
  const owner = uniform(3);
  const mat = enableGridLights(new THREE.MeshStandardNodeMaterial(), owner);
  const frag = buildFragment(makeRenderer(new GridLighting(grid)), mat);
  assert.match(frag, /\( object\.nodeUniform\d+ < 0\.5 \) \|\| \( abs\( \( nodeVar\d+\.w - object\.nodeUniform\d+ \) \) > 0\.5 \)/);
  const num = enableGridLights(new THREE.MeshStandardNodeMaterial(), 5);
  assert.ok(num.gridLightOwner.isNode, 'liczba → węzeł stałej');
  assert.equal(enableGridLights(new THREE.MeshStandardNodeMaterial(), 0).gridLightOwner, undefined, '0 = bez właściciela');
  const all = makeRenderer(new GridLighting(new LightGrid(), { mode: 'all' }));
  assert.match(buildFragment(all, new THREE.MeshStandardNodeMaterial()), /fxGridLights/);
  const off = new THREE.MeshStandardNodeMaterial();
  off.gridLights = false;
  assert.doesNotMatch(buildFragment(all, off), /fxGridLights/);
  const node = new GridLightsNode(grid, 'all');
  assert.equal(node.hasLights, true);
  assert.equal(new GridLightsNode(grid, 'optIn').hasLights, false, 'optIn: jak scena (bez świateł sceny — bez oświetlenia)');
});

test('GridLighting.getNode: węzeł na scenę (własna mapa), post (QuadMesh) — domyślne światła', () => {
  const lighting = new GridLighting(new LightGrid());
  const a = new THREE.Scene();
  const b = new THREE.Scene();
  assert.ok(lighting.getNode(a) instanceof GridLightsNode);
  assert.equal(lighting.getNode(a), lighting.getNode(a));
  assert.notEqual(lighting.getNode(a), lighting.getNode(b));
  const quad = new THREE.QuadMesh();
  assert.ok(!(lighting.getNode(quad) instanceof GridLightsNode));
  // Drugi system oświetlenia dostaje własny węzeł dla tej samej sceny (bazowy Lighting
  // trzyma mapę w zmiennej modułu — węzeł poprzedniego zostałby na zawsze).
  assert.notEqual(new GridLighting(new LightGrid()).getNode(a), lighting.getNode(a));
});

test('grid.loop w compute: bufory siatki tylko do odczytu, zagnieżdżalna pętla o jawnej nazwie', () => {
  const grid = new LightGrid();
  grid.shadows = { visibility: (s, P) => float(0.5).add(s.mul(0.0)).add(P.x.mul(0.0)) };
  const out = storage(new THREE.StorageBufferAttribute(new Float32Array(64 * 4), 4), 'vec4', 64);
  const kernel = Fn(() => {
    const acc = vec3(0).toVar();
    grid.loop(vec3(float(instanceIndex), 0, 0), ({ att, col, scatter }) => { acc.addAssign(col.mul(att).mul(scatter)); });
    out.element(instanceIndex).assign(vec4(acc, 1));
  })().compute(64);
  const renderer = makeRenderer();
  const b = renderer.backend.createNodeBuilder(kernel, renderer);
  b.build();
  const cs = b.computeShader;
  assert.match(cs, /var<storage, read> fxGridLights\b/);
  assert.match(cs, /var<storage, read> fxGridIndex\b/);
  assert.match(cs, /for \( var gridItem : u32/);
  assert.match(cs, /> 0\.5 \) && \( nodeVar\d+ > 0\.0001 \)/, 'mapa cienia tylko dla świateł z indeksem');
});
