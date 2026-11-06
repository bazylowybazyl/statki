// Miasto dalekie, tier 0 (dema/woksele-zawalenia/miastoDalekie.js, plan LOD § 4): plan M3 i WGSL w Node, bez GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createWokseleSolver } from '../src/3d/woksele/solver.js';
import { createWokseleObraz } from '../src/3d/woksele/obraz.js';
import { createMiastoDalekie } from '../dema/woksele-zawalenia/miastoDalekie.js';
import { planM3, INST_DALEKIE, RODZ_DAL, T_NIGDY, POJEMNOSC_MIASTA } from '../src/3d/woksele/scenaMiasta.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const solver = createWokseleSolver();
const camera = new THREE.PerspectiveCamera(32, 1, 20, 700000);
const obraz = createWokseleObraz({ solver, camera });
const dalekie = createMiastoDalekie({ solver, obraz });

/** Zmienne przypisane przed użyciem, jak w wokseleObrazWgsl: nazwa z pierwszego odczytu nie może poprzedzać pierwszego zapisu (pułapka 39). */
function nieprzypisane(kod) {
  const zle = [];
  for (const nazwa of new Set([...kod.matchAll(/var (nodeVar\d+)\b/g)].map((m) => m[1]))) {
    const zapis = kod.search(new RegExp(`\\b${nazwa}\\s*(\\.[xyzw]+\\s*)?=[^=]`));
    const odczyt = kod.search(new RegExp(`(?<!var )\\b${nazwa}\\b(?!\\s*(\\.[xyzw]+\\s*)?=[^=])`));
    if (odczyt >= 0 && (zapis < 0 || odczyt < zapis)) zle.push(nazwa);
  }
  return zle;
}

test('kernel emisji: najwyżej 8 buforów storage, instancje tylko do odczytu, bez NaN i bez nieprzypisanych zmiennych', () => {
  const b = renderer.backend.createNodeBuilder(dalekie.kEmisja, renderer);
  b.build();
  const kod = b.computeShader;
  const ile = (kod.match(/var<storage/g) || []).length;
  assert.ok(ile <= 8, `kEmisja ma ${ile} buforów storage`);
  assert.match(kod, /var<storage, read> \w*dalInst/);
  assert.doesNotMatch(kod, /Infinity|NaN/);
  assert.deepEqual(nieprzypisane(kod), []);
});

test('materiał partii: WGSL się buduje, wierzchołek bez nieprzypisanych zmiennych', () => {
  const b = renderer.backend.createNodeBuilder(dalekie.mesh, renderer);
  b.scene = obraz.scene;
  b.camera = camera;
  b.material = dalekie.mesh.material;
  b.lightsNode = renderer.lighting.getNode(obraz.scene);
  b.build();
  assert.doesNotMatch(b.vertexShader, /var<storage, read_write>/);
  assert.deepEqual(nieprzypisane(b.vertexShader), [], 'wierzchołek');
  assert.deepEqual(nieprzypisane(b.fragmentShader), [], 'fragment');
  assert.match(b.vertexShader, /dalInst/);
});

test('plan M3: około 5000 budynków, około 2000 w pasie, solver około 300, węzły w pojemności miasta, każdy budynek w jednym tierze', () => {
  const p = planM3({ dx: 10 });
  const d = p.miasto.dalekie;
  assert.ok(d.budynkow > 4500 && d.budynkow < 5500, `budynków ${d.budynkow}`);
  const solverow = p.miasto.budynki.length;
  assert.ok(solverow > 220 && solverow < 400, `solver ${solverow}`);
  assert.ok(p.scena.n <= POJEMNOSC_MIASTA[10].maxWez, `węzłów ${p.scena.n}`);
  const trafien = d.trafZero + p.miasto.trafien;
  assert.ok(trafien > 1600 && trafien < 2400, `trafień ${trafien}`);
  let gasnie = 0, korpusow = 0;
  for (let q = 0; q < d.n; q++) {
    const b = q * INST_DALEKIE;
    const rodz = d.inst[b + 11];
    if (rodz === RODZ_DAL.KORPUS) korpusow++;
    if (rodz === RODZ_DAL.GASNIE && d.inst[b + 8] === 0 && d.inst[b + 9] === 0) gasnie++;
    assert.ok(d.inst[b + 7] > 0, 'chwila zniszczenia');
    assert.ok(d.inst[b + 7] <= T_NIGDY);
  }
  assert.equal(korpusow, d.tierZero);
  assert.ok(gasnie >= solverow, `gaszonych ${gasnie}`);
});

test('plan M3: kratery tylko dla trafionych budynków solvera, kolejno w czasie, chwile w środku pasa', () => {
  const p = planM3({ dx: 20 });
  const k = p.gpu.kratery;
  assert.ok(k.length >= p.miasto.trafien);
  for (let i = 1; i < k.length; i++) assert.ok(k[i].f >= k[i - 1].f);
  assert.ok(k[0].f / 60 > 5 && k.at(-1).f / 60 < 11, `kratery od ${k[0].f / 60} do ${k.at(-1).f / 60} s`);
});
