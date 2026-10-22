// Elektrownia „KOREK” w wielkim gryzie Ziemi (src/3d/earthBitePlant*.js): układ i klucze komponentów, kontrakt części
// (aPart), budżet wierzchołków, powtarzalność brył, budowa WGSL wszystkich siatek w Node (bez GPU), graf raz na rodzaj,
// zasady żelazne w plikach elektrowni.
// node --test tests/earthBitePlant.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { EarthBitePlant, PLANT_DEFAULTS, createPlantLook } from '../src/3d/earthBitePlant.js';
import { PART, PLANT_LAYOUT, hubHeight, plantZ0 } from '../src/3d/earthBitePlantFrame.js';
import { CORK_DEFAULTS } from '../src/3d/earthBitePlantCork.js';
import { LINING_DEFAULTS } from '../src/3d/earthBitePlantLining.js';
import { ELEV_DEFAULTS } from '../src/3d/earthBitePlantElevators.js';
import { HUB_DEFAULTS } from '../src/3d/earthBitePlantOrbital.js';
import { BEAM_DEFAULTS } from '../src/3d/earthBitePlantBeam.js';
import { earthBiteVector } from '../src/3d/earthBite3D.js';
import { EARTH_BITE } from '../src/data/earthBite.js';

/** Budżet wierzchołków (cała elektrownia jest w kadrze, gdy gryz jest na tarczy — docs/BRIEF-korek.md § Budżet). */
const BUDGET = { metal: 600_000, flow: 150_000, total: 900_000 };

const sphereUniforms = () => ({
  sunPosition: { value: new THREE.Vector3(1e4, 2e3, 0) }, uBite: { value: earthBiteVector() }, uSunShadowRecv: { value: 0 }
});

function makePlant() {
  const plant = new EarthBitePlant(sphereUniforms());
  plant.createRelay();
  return plant;
}

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.highPrecision = true;
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}

test('układ: klucze komponentów rozłączne, z przedrostkiem, scalone w PLANT_DEFAULTS', () => {
  const sets = { PLANT_LAYOUT, CORK_DEFAULTS, LINING_DEFAULTS, ELEV_DEFAULTS, HUB_DEFAULTS, BEAM_DEFAULTS };
  const seen = new Map();
  for (const [name, obj] of Object.entries(sets)) {
    for (const k of Object.keys(obj)) {
      assert.ok(!seen.has(k), `klucz ${k} w ${name} i ${seen.get(k)}`);
      seen.set(k, name);
      assert.ok(k in PLANT_DEFAULTS, `${k} w PLANT_DEFAULTS`);
    }
  }
  const prefix = { CORK_DEFAULTS: 'cork', LINING_DEFAULTS: 'lining', ELEV_DEFAULTS: 'elev', HUB_DEFAULTS: 'hub', BEAM_DEFAULTS: ['beam', 'relay'] };
  for (const [name, p] of Object.entries(prefix)) {
    for (const k of Object.keys(sets[name])) assert.ok([p].flat().some((q) => k.startsWith(q)), `${name}.${k} bez przedrostka ${p}`);
  }
  // odbiornik pod wewnętrzną krawędzią ringu Ziemi (1,09 R) i nad wylotem gryzu (płaszczyzna brzegu 1 − b²/2)
  const b = EARTH_BITE.radiusR;
  assert.ok(PLANT_DEFAULTS.hubRadius < 1.09 && PLANT_DEFAULTS.hubRadius > 1 - b * b / 2);
  assert.ok(Math.abs(hubHeight(PLANT_DEFAULTS, b) - (PLANT_DEFAULTS.hubRadius - plantZ0(b))) < 1e-12);
});

test('części: aPart na każdej siatce brył, rodzaje metalu 0–7, przepływu 8–9, bez NaN, w budżecie', () => {
  const plant = makePlant();
  const count = (m) => m.geometry.attributes.position?.count ?? 0;
  const check = (mesh, kinds) => {
    const g = mesh.geometry;
    const a = g.attributes.aPart;
    assert.ok(a && a.itemSize === 4, `${mesh.name}: aPart vec4`);
    assert.ok(g.index, `${mesh.name}: indeks`);
    const pos = g.attributes.position.array;
    for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]), `${mesh.name}: NaN w pozycji`);
    const found = new Set();
    for (let i = 0; i < a.count; i++) {
      const k = a.getX(i);
      assert.equal(k, Math.round(k), `${mesh.name}: rodzaj całkowity`);
      found.add(k);
      assert.ok(kinds.includes(k), `${mesh.name}: rodzaj ${k} spoza ${kinds}`);
      assert.ok(Number.isFinite(a.getY(i)) && Number.isFinite(a.getZ(i)) && Number.isFinite(a.getW(i)));
    }
    return found;
  };
  const metalKinds = [PART.HULL, PART.STRUCT, PART.WINDOW, PART.STRIP, PART.COIL, PART.HOT, PART.BEACON, PART.GLASS];
  check(plant.metal, metalKinds);
  check(plant.flow, [PART.PIPE, PART.TETHER]);
  assert.ok(count(plant.metal) <= BUDGET.metal, `metal ${count(plant.metal)} > ${BUDGET.metal}`);
  assert.ok(count(plant.flow) <= BUDGET.flow, `przepływ ${count(plant.flow)} > ${BUDGET.flow}`);
  const total = plant.warmupMeshes().reduce((s, m) => s + count(m), 0);
  assert.ok(total <= BUDGET.total, `razem ${total} > ${BUDGET.total}`);
  // wszystko w zasięgu odbiornika (obiekt kuli, R = 1): nic nie ucieka w kosmos ani w głąb jądra
  for (const mesh of [plant.metal, plant.flow, ...plant.beam.frameMeshes]) {
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 7) {
      const r = Math.hypot(p.getX(i), p.getY(i), p.getZ(i));
      assert.ok(r > 0.45 && r < PLANT_DEFAULTS.hubRadius + 0.08, `${mesh.name}: wierzchołek r = ${r.toFixed(3)}`);
    }
  }
  plant.dispose();
});

test('bryły powtarzalne: dwie budowy dają te same pozycje (ziarna, bez Math.random)', () => {
  const a = makePlant();
  const b = makePlant();
  for (const k of ['metal', 'flow']) {
    const pa = a[k].geometry.attributes.position.array;
    const pb = b[k].geometry.attributes.position.array;
    assert.equal(pa.length, pb.length);
    for (let i = 0; i < pa.length; i++) assert.equal(pa[i], pb[i]);
  }
  a.dispose();
  b.dispose();
});

test('WGSL: każda siatka elektrowni buduje się w Node, ten sam rodzaj = ten sam graf i ten sam kod', () => {
  const plant = makePlant();
  const meshes = plant.warmupMeshes();
  assert.ok(meshes.length >= 4);
  const byName = new Map();
  for (const mesh of meshes) {
    const { fragment } = buildWGSL(mesh);
    assert.ok(fragment.length > 200, `${mesh.name}: WGSL`);
    const key = mesh.material.name;
    if (byName.has(key)) {
      // lekkie materiały na wspólnym grafie (zasada żelazna 4)
      assert.equal(mesh.material.fragmentNode, byName.get(key).node, `${key}: wspólny graf`);
      assert.equal(fragment, byName.get(key).fragment, `${key}: ten sam WGSL`);
    } else {
      byName.set(key, { node: mesh.material.fragmentNode, fragment });
    }
  }
  // druga elektrownia (np. tło menu i gra) — ten sam kod
  const again = makePlant();
  assert.equal(buildWGSL(again.metal).fragment, byName.get(again.metal.material.name).fragment);
  plant.dispose();
  again.dispose();
});

test('stan przekazu: bez ringu magazyn się ładuje, z ringiem przekaz rośnie i magazyn oddaje', () => {
  const plant = makePlant();
  plant.placeRelay(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), false);
  const c0 = plant.charge;
  for (let i = 0; i < 20; i++) plant.update(0.1);
  assert.ok(plant.charge > c0 && plant.relayOn < 0.01);
  plant.placeRelay(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), true);
  const c1 = plant.charge;
  for (let i = 0; i < 20; i++) plant.update(0.1);
  assert.ok(plant.charge < c1 && plant.relayOn > 0.9);
  const s = plant.uniforms.uPlantState.value;
  assert.ok(Math.abs(s.x - plant.relayOn) < 1e-12 && Math.abs(s.y - plant.charge) < 1e-12);
  // wygląd z nadpisaniem nie psuje budowy
  const p2 = new EarthBitePlant(sphereUniforms(), { look: createPlantLook({ beamGain: 2 }) });
  assert.equal(p2.uniforms.uPlantBeam.value.x, 2);
  plant.dispose();
  p2.dispose();
});

test('zasady żelazne w plikach elektrowni: TSL, bez Math.random, bez window / DOM', () => {
  const dir = new URL('../src/3d/', import.meta.url);
  const files = readdirSync(dir).filter((f) => /^earthBitePlant.*\.js$/.test(f));
  assert.ok(files.length >= 8, files.join(', '));
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /Math\.random/, `${f}: Math.random`);
    assert.doesNotMatch(src, /ShaderMaterial|onBeforeCompile|gl_FragColor|WebGLRenderer|EffectComposer/, `${f}: GLSL / WebGL`);
    assert.doesNotMatch(src, /\bwindow\.|\bdocument\.|\blocalStorage\b/, `${f}: window / DOM`);
    assert.doesNotMatch(src, /\.needsUpdate\s*=\s*true[\s\S]{0,40}material|defines\s*[.[]/, `${f}: defines / needsUpdate materiału`);
  }
});
