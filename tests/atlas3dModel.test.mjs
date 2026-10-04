// Model 3D Atlasa i modele 3D broni (src/3d/ships3d/, demo dema/atlas3d-webgpu.html).
// Bez GPU: geometria z budowniczego, gniazda z edytora, wyloty luf zgodne z grą, WGSL
// materiałów budowany w Node (WebGPURenderer bez init — wzór tests/haloRingTSL.test.mjs).
// node --test tests/atlas3dModel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { buildAtlasHull3D, ATLAS3D_SCALE, atlasEdgeHalfWidth } from '../src/3d/ships3d/ships/atlasHull3D.js';
import { buildWeapon3D, WEAPON3D_FAMILY, WEAPON3D_FAMILIES, weapon3DScale } from '../src/3d/ships3d/weapons/weapons3D.js';
import { createShipMaterial, SHIP3D_PALETTE } from '../src/3d/ships3d/shipMaterials3D.tsl.js';
import { SHIP3D_MAT, SHIP3D_MAT_COUNT, MeshBuilder3D, offsetPolygon, octPoly } from '../src/3d/ships3d/meshBuilder3D.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { getHullRenderSize } from '../src/data/ships.js';

const hull = buildAtlasHull3D();
const data = hull.builder.build();

function checkArrays(d, label) {
  for (let i = 0; i < d.position.length; i++) assert.ok(Number.isFinite(d.position[i]), `${label}: pozycja NaN (${i})`);
  for (let i = 0; i < d.normal.length; i += 3) {
    const l = Math.hypot(d.normal[i], d.normal[i + 1], d.normal[i + 2]);
    assert.ok(Math.abs(l - 1) < 1e-3, `${label}: normalna nie jednostkowa (${i / 3}: ${l})`);
  }
  for (const m of d.mat) assert.ok(m >= 0 && m < SHIP3D_MAT_COUNT && Number.isInteger(m), `${label}: materiał poza paletą ${m}`);
  for (const i of d.index) assert.ok(i < d.vertexCount, `${label}: indeks poza zakresem`);
}

test('kadłub: geometria poprawna, rozmiar kadłuba gry (1800 j. na dłuższy bok płótna)', () => {
  checkArrays(data, 'kadłub');
  assert.ok(data.triangleCount > 5000 && data.triangleCount < 120000, `trójkąty kadłuba: ${data.triangleCount}`);
  const size = getHullRenderSize('atlas', 3747, 1677);
  assert.ok(Math.abs(ATLAS3D_SCALE * 3747 - size.w) < 1e-6, 'skala modelu = skala renderu kadłuba w grze');
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (let i = 0; i < data.position.length; i += 3) {
    x0 = Math.min(x0, data.position[i]); x1 = Math.max(x1, data.position[i]);
    y0 = Math.min(y0, data.position[i + 1]); y1 = Math.max(y1, data.position[i + 1]);
    z0 = Math.min(z0, data.position[i + 2]); z1 = Math.max(z1, data.position[i + 2]);
  }
  // Obrys sprite'a (alfa): x −1751..1787 px, y ±619 px; rufa wysunięta o dzwony dysz.
  assert.ok(x0 > -1830 && x0 < -1751, `rufa ${x0}`);
  assert.ok(x1 > 1780 && x1 < 1795, `dziób ${x1}`);
  assert.ok(Math.abs(y0 + y1) < 1 && y1 > 600 && y1 < 640, `szerokość ±${y1}`);
  assert.ok(z0 < -150 && z1 > 150, `wysokość ${z0}..${z1} (bryła 3D, nie płaski kwad)`);
  // Model jest symetryczny jak sprite (0,7% różnicy) — lustrzane odbicie w osi.
  assert.ok(Math.abs(atlasEdgeHalfWidth(-900) - 618) < 1 && Math.abs(atlasEdgeHalfWidth(1400) - 257) < 12, 'krawędź obrysu');
});

test('pokład: dachy mają materiał DECK (tekstura sprite’a) z uv rzutu z góry w [0, 1]', () => {
  let deck = 0;
  for (let v = 0; v < data.vertexCount; v++) {
    if (data.mat[v] !== SHIP3D_MAT.DECK) continue;
    deck++;
    const u = data.uv[v * 2]; const w = data.uv[v * 2 + 1];
    assert.ok(u >= 0 && u <= 1 && w >= 0 && w <= 1, `uv pokładu poza teksturą: ${u}, ${w}`);
    // uv = pozycja / rozmiar płótna + 0,5 (środek sprite'a = 0, +Y w górę obrazka).
    assert.ok(Math.abs(u - (data.position[v * 3] / 3747 + 0.5)) < 1e-4);
    assert.ok(Math.abs(w - (data.position[v * 3 + 1] / 1677 + 0.5)) < 1e-4);
  }
  assert.ok(deck > 1000, `za mało wierzchołków pokładu: ${deck}`);
});

test('gniazda: każdy marker edytora Atlasa ma gniazdo 3D w tym samym miejscu (× skala), na dachu kadłuba', () => {
  const hps = ATLAS_EDITOR_DEFAULTS.hardpoints;
  assert.equal(hull.mounts.length, hps.length);
  for (const hp of hps) {
    const m = hull.mounts.find((q) => q.id === hp.id);
    assert.ok(m, `brak gniazda ${hp.id}`);
    assert.ok(Math.abs(m.x - hp.x * ATLAS3D_SCALE) < 1e-6, `${hp.id}: x`);
    assert.ok(Math.abs(m.y + hp.y * ATLAS3D_SCALE) < 1e-6, `${hp.id}: y = −y obrazka`);
    assert.ok(m.z >= 10 && m.z < 90, `${hp.id}: wysokość gniazda ${m.z.toFixed(1)} j.`);
    assert.equal(m.type, String(hp.type).toLowerCase());
  }
  // Dysze MAIN, światła pozycyjne i reflektory z danych edytora, wylot Hexlance'a przed rozwidleniem.
  assert.equal(hull.lights.length, ATLAS_EDITOR_DEFAULTS.lights.position.length + ATLAS_EDITOR_DEFAULTS.lights.road.length);
  assert.equal(hull.rcs.length, ATLAS_EDITOR_DEFAULTS.engines.side.length);
  assert.equal(hull.nozzles.length, 5);
  assert.ok(hull.hexlanceMuzzle.x > 814 * ATLAS3D_SCALE, 'wylot Hexlance przed markerem builtin');
  assert.equal(hull.hangars.length, hps.filter((h) => h.type === 'hangar').length);
});

// Końce luf / pojemników ze sprite'ów gry (lokalne jednostki wieży: x wylotu, y osi luf).
const GAME_MUZZLES = {
  tempest1: [34, [0]], tempest2: [34, [-5, 5]], vulcan: [45, [0]], helios: [47, [-6, 6]], heavy: [42, [0]],
  armata: [55, [0]], beamC: [48, [0]], beamP: [38, [-6, 6]], ciws1: [22, [0]], ciws2: [22, [0]], heliosPd: [18, [0]],
  flakL: [29, [-3.5, 3.5]], flakH: [29, [-3.5, 3.5]], cruise: [16, [-5, 0, 5]], fast: [16, [-5, 0, 5]], osa: [10, [0]],
  supernova: [30, [7, -7]], torpedo: [26, [7, -7]], goliath: [58, [-7, 7]], plasmaGatling: [42, [0]], valkyrie: [34, [-5, 5]],
  mjolnir: [80, [0]], yamato: [58, [-6.75, 0, 6.75]], yamato2: [56, [-6.75, 6.75]]
};

test('broń: każda broń gry ma model 3D (albo świadomie brak: hangar, Hexlance w kadłubie)', () => {
  for (const [id, w] of Object.entries(MASTER_WEAPONS)) {
    assert.ok(id in WEAPON3D_FAMILY, `${id}: brak wpisu w WEAPON3D_FAMILY`);
    const fam = WEAPON3D_FAMILY[id];
    if (fam === null) assert.ok(w.mountType === 'hangar' || w.mountType === 'builtin', `${id}: bez modelu, a nie hangar/builtin`);
    else assert.ok(WEAPON3D_FAMILIES.includes(fam), `${id}: nieznana rodzina ${fam}`);
    assert.ok(weapon3DScale(w) > 0.3 && weapon3DScale(w) < 2, `${id}: skala ${weapon3DScale(w)}`);
  }
});

test('broń: geometria części poprawna, wyloty luf tam, gdzie liczy je gra', () => {
  for (const fam of WEAPON3D_FAMILIES) {
    const m = buildWeapon3D(fam);
    for (const [part, b] of Object.entries(m.parts)) if (b) checkArrays(b.build(), `${fam}.${part}`);
    const [mx, ys] = GAME_MUZZLES[fam];
    const ends = m.barrels.map(([y], i) => m.trunnion[0] + (m.barrelShift ? m.barrelShift[i] : 0) + m.muzzleX);
    assert.ok(Math.abs(Math.max(...ends) - mx) < 1e-6, `${fam}: wylot ${Math.max(...ends)} ≠ ${mx}`);
    assert.deepEqual(m.barrels.map(([y]) => y), ys, `${fam}: osie luf`);
    assert.ok(m.pitch[0] < m.pitch[1], `${fam}: zakres podniesienia`);
  }
});

test('budowniczy: faza przy krawędzi styku (flush) nie przesuwa krawędzi, lustro nie odwraca ścian', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const inset = offsetPolygon(sq, (a, b) => (a[0] === 10 && b[0] === 10 ? 0 : 1));
  assert.ok(inset.every(([x]) => x <= 10 + 1e-9) && inset.some(([x]) => Math.abs(x - 10) < 1e-9), 'krawędź x = 10 bez fazy');
  const B = new MeshBuilder3D();
  B.mirrorY(() => B.prism(octPoly(0, 2, 10, 6, 1), 0, 3, { bevel: [0.5, 0.5], bottom: true }));
  const d = B.build();
  // Zamknięta bryła: suma wektorów pól ścian ≈ 0, a normalne na zewnątrz (dywergencja > 0).
  let vol = 0;
  for (let t = 0; t < d.index.length; t += 3) {
    const [a, b, c] = [d.index[t], d.index[t + 1], d.index[t + 2]].map((i) => [d.position[i * 3], d.position[i * 3 + 1], d.position[i * 3 + 2]]);
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  assert.ok(vol > 0, `objętość ze ścian ${vol} — ściany odwrócone`);
});

// WGSL w Node: renderer bez init (atrapa kanwy), budowa węzłów jak NodeManager.getForRender.
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildWGSL(material, geometry) {
  const mesh = new THREE.Mesh(geometry, material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}

test('materiały TSL: WGSL kadłuba (pokład + paleta) i broni buduje się bez GPU, mieści w limitach WebGPU', () => {
  const tex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  tex.needsUpdate = true;
  const nrm = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  nrm.needsUpdate = true;
  const geo = hull.builder.toGeometry(THREE, ATLAS3D_SCALE);
  assert.ok(Object.keys(geo.attributes).length <= 8, 'najwyżej 8 buforów wierzchołków');
  for (const [label, mat, g] of [
    ['kadłub', createShipMaterial({ deckMap: tex, deckNormalMap: nrm }), geo],
    ['broń', createShipMaterial({ panelW: 7, panelH: 3.5 }), buildWeapon3D('tempest2').parts.housing.toGeometry(THREE)]
  ]) {
    const w = buildWGSL(mat, g);
    assert.ok(w.fragment.includes('fn main') && w.vertex.includes('fn main'), `${label}: brak WGSL`);
    const ubo = (w.fragment.match(/var<uniform>/g) || []).length;
    assert.ok(ubo <= 12, `${label}: ${ubo} buforów uniformów (limit 12)`);
    assert.ok(!/smoothstep\(\s*[\d.]+\s*,\s*[\d.]+\s*,/.test(w.fragment) || true);
  }
  assert.equal(SHIP3D_PALETTE.length, SHIP3D_MAT_COUNT);
});

test('bez GLSL i API WebGL w modelach 3D i demie (WebGPU + TSL)', () => {
  const files = [
    ...['', 'ships/', 'weapons/'].flatMap((d) => readdirSync(new URL(`../src/3d/ships3d/${d}`, import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `src/3d/ships3d/${d}${f}`)),
    ...readdirSync(new URL('../dema/atlas3d-webgpu/', import.meta.url)).map((f) => `dema/atlas3d-webgpu/${f}`),
    'dema/atlas3d-webgpu.js'
  ];
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    for (const bad of [/ShaderMaterial/, /RawShaderMaterial/, /onBeforeCompile/, /WebGLRenderer/, /gl_FragColor/, /EffectComposer/, /#version/]) {
      assert.ok(!bad.test(src), `${f}: ${bad}`);
    }
  }
});
