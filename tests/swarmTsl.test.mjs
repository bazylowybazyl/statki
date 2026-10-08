// Rój na WebGPU (src/3d/swarm/): kernele compute i materiały TSL budowane w Node (WGSL bez GPU),
// limity wiązań (≤ 8 buforów storage, ≤ 12 buforów uniformów na etap), wysyłka zadań po init()
// (regresja: rekordy zadań z poprzedniej sceny), strażniki źródeł (TSL, bez GLSL i Math.random).
// node --test tests/swarmTsl.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { SwarmSim, SWARM_SIM_TUNE, SWARM_STATS } from '../src/3d/swarm/swarmSim.js';
import { SwarmDroneMeshes, SwarmDroneLights } from '../src/3d/swarm/swarmDrones.tsl.js';
import { SwarmUnits, SwarmShadows } from '../src/3d/swarm/swarmUnits.tsl.js';
import { buildSwarmDroneGeometries } from '../src/3d/swarm/swarmDroneModel.js';
import { SWARM_TASK_FLOATS, SWARM_TASK_RING, SWARM_TASK_VEC4, SWARM_DRONE_VEC4 } from '../src/game/swarm/swarmPort.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const count = (s, re) => (s.match(re) || []).length;

function buildCompute(node) {
  const b = renderer.backend.createNodeBuilder(node, renderer);
  b.build();
  return b.computeShader;
}
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

const sim = new SwarmSim({ maxDrones: 64, maxUnits: 64, maxColumns: 64, hfCells: 64 });

test('kernele compute: WGSL w Node, ≤ 8 buforów storage, ORCA na tablicach lokalnych', () => {
  for (const [name, k] of [['clear', sim.kClear], ['bin', sim.kBin], ['steer', sim.kSteer], ['integrate', sim.kIntegrate]]) {
    const w = buildCompute(k);
    assert.ok(w.length > 200, `${name}: WGSL`);
    assert.ok(count(w, /var<storage/g) <= 8, `${name}: bufory storage ${count(w, /var<storage/g)}`);
    if (name === 'steer') {
      assert.ok(count(w, /array< vec4<f32>, 16 >/g) >= 2, 'linie ORCA i rzuty linearProgram3 w tablicach lokalnych');
      assert.match(w, /for \( var o2a : i32/, 'linearProgram2');
      assert.match(w, /for \( var o3i : i32/, 'linearProgram3');
      // Pętle sąsiadów mają niezerowy koniec (atomicLoad jako zmienna — pułapka pustej instrukcji).
      assert.match(w, /for \( var gk : u32 = 0u; gk < nodeVar\d+; gk \+\+ \)/, 'pętla sąsiadów z komórki');
    }
  }
});

test('materiały TSL dronów, świateł, kontenerów i cieni: WGSL, ≤ 12 buforów uniformów na etap', () => {
  const scene = new THREE.Scene();
  const geos = buildSwarmDroneGeometries(THREE);
  const drones = new SwarmDroneMeshes(scene, sim.drones, geos);
  const lights = new SwarmDroneLights(scene, sim.drones);
  const units = new SwarmUnits(scene, sim.units, 64);
  const shadows = new SwarmShadows(scene, sim.drones, sim.units);
  const list = [
    ['drony', drones.meshes[0].meshes.hi.material, drones.meshes[0].meshes.hi.geometry],
    ['światła', lights.meshes[0].mesh.material, lights.meshes[0].mesh.geometry],
    ['kontenery', units.material, units.geometry],
    ['cień dronów', shadows.drones.material, shadows.drones.geometry],
    ['cień kontaktu', shadows.contact.material, shadows.contact.geometry]
  ];
  for (const [name, m, g] of list) {
    const { vertex, fragment } = buildWGSL(m, g);
    assert.ok(vertex.length > 200 && fragment.length > 100, `${name}: WGSL`);
    assert.ok(count(vertex, /var<uniform/g) <= 12 && count(fragment, /var<uniform/g) <= 12, `${name}: bufory uniformów`);
  }
});

test('init(): pierwsza wysyłka zadań pełna, choć planista dopisał zakresy w tej samej klatce', () => {
  const s = new SwarmSim({ maxDrones: 8, maxUnits: 8, maxColumns: 8, hfCells: 8 });
  const drones = [{ classIndex: 0, x: 0, y: 0, z: 1, entryZ: 9, yaw: 0 }];
  s.init({ drones, units: [], heights: new Int32Array(8) });
  // Stare zakresy z poprzedniej sceny nie mogą przetrwać init().
  assert.equal(s.tasks.value.updateRanges.length, 0);
  const rec = new Float32Array(SWARM_TASK_FLOATS).fill(3);
  s.writeTask(0, 0, rec);
  const v0 = s.tasks.value.version;
  s._flushTasks();
  assert.equal(s.tasks.value.updateRanges.length, 0, 'bez zakresów = pełna wysyłka (rekordy poprzedniej sceny nadpisane)');
  assert.ok(s.tasks.value.version > v0);
  // Następne zadania — już zakresami (koszt wysyłki stały, nie cały bufor).
  s.writeTask(0, 1, rec);
  s._flushTasks();
  assert.equal(s.tasks.value.updateRanges.length, 1);
  const r = s.tasks.value.updateRanges[0];
  assert.equal(r.start, (0 * SWARM_TASK_RING + 1) * SWARM_TASK_VEC4 * 4);
  assert.equal(r.count, SWARM_TASK_FLOATS);
  // Pusty pierścień: numery zadań −1 (żaden slot nie wygląda na ważny dla numeru 0).
  const T = s.tasks.value.array;
  for (let i = 2; i < 8 * SWARM_TASK_RING; i++) assert.equal(T[(i * SWARM_TASK_VEC4 + 3) * 4 + 1], -1);
});

test('strojenie i statystyki: ORCA w uniformach, tłok i linie w statystykach', () => {
  for (const k of ['orcaTau', 'orcaReach', 'orcaEsc', 'kVfree', 'avoidOn', 'margin', 'marginZ']) {
    assert.ok(k in SWARM_SIM_TUNE && k in sim.U, `strojenie ${k}`);
  }
  assert.equal(SWARM_STATS.DENSE, 12);
  assert.equal(SWARM_STATS.LINES, 13);
  sim.setTune('orcaTau', 2.2);
  assert.equal(sim.U.orcaTau.value, 2.2);
  sim.setTune('orcaTau', SWARM_SIM_TUNE.orcaTau);
});

test('źródła roju: TSL bez GLSL i ShaderMaterial, losowość bez Math.random, układ rekordów wspólny', () => {
  const files = ['src/3d/swarm/swarmSim.js', 'src/3d/swarm/swarmDrones.tsl.js', 'src/3d/swarm/swarmUnits.tsl.js', 'src/3d/swarm/swarmClassTable.js',
    'src/3d/swarm/swarmDroneModel.js', 'src/game/swarm/swarmPlanner.js', 'src/game/swarm/swarmOrca.js', 'src/game/swarm/swarmPort.js'];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /ShaderMaterial|RawShaderMaterial|onBeforeCompile|WebGLRenderer|gl_FragColor/, `${f}: bez GLSL / WebGL`);
    assert.doesNotMatch(src, /Math\.random\(/, `${f}: bez Math.random`);
  }
  assert.equal(SWARM_DRONE_VEC4, 11);
  assert.match(read('src/3d/swarm/swarmSim.js'), /instancedArray\(this\.maxDrones \* SWARM_TASK_RING \* TV, 'vec4'\)/);
});
