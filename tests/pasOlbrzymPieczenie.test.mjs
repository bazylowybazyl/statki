// PIECZENIE ŚWIATŁA OLBRZYMÓW PASA — JEDEN kernel compute dla wszystkich olbrzymów, rozgrzany na ekranie ładowania
// (2026-10-30). Pomiar w grze (scripts/webgpu/gpu-pas-gra.mjs, licznik pipeline'ów compute tworzonych po starcie): jedyny
// pipeline compute kompilowany w klatce gry — `GiantView.bake` przy pierwszym olbrzymie w kadrze. Pipeline compute three
// r183 powstaje SYNCHRONICZNIE przy pierwszym dispatchu (bez odpowiednika compileAsync), a jego klucz to id węzła compute
// + program: dawniej każdy GiantView budował własny kernel (wymiary siatki światła w stałych WGSL, własne tablice złóż),
// więc pierwszy widok KAŻDEGO olbrzyma kompilował pipeline w grze. Tu (bez GPU, WGSL w Node): kernel bez stałych
// olbrzyma, ze strażnikiem liczby wątków z uniformu; rozgrzewka pasa (`_prewarmCompute`) wysyła pusty dispatch TEGO kernela;
// dwa olbrzymy o różnych wymiarach pieką tym samym węzłem (ten sam pipeline) z własnymi uniformami i teksturami w chwili
// dispatchu; wiązania kernela idą za podmianą tekstur; materiał olbrzyma (raymarching) bez zmian.
// node --test tests/pasOlbrzymPieczenie.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document ?? { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };

const THREE = await import('three/webgpu');
const { uniform } = await import('three/tsl');
const { GiantView, GiantBakeKernel } = await import('../src/3d/asteroids/giants.js');
const { AsteroidBelt } = await import('../src/3d/asteroids/asteroidBelt.js');
const { LightGrid, GridLighting } = await import('../src/3d/fx/lightGrid.js');

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const wgsl = new THREE.WebGPURenderer({ canvas });
wgsl.hasFeature = () => false;
const grid = new LightGrid();
wgsl.lighting = new GridLighting(grid, { mode: 'optIn' });
const buildCompute = (node) => { const b = wgsl.backend.createNodeBuilder(node, wgsl); b.build(); return b; };

// Olbrzym jak z GiantBuilder (siatka SDF R8, wymiary, plan): różne wymiary = dawniej różne kernele.
function fakeGiant(id, nx, ny, nz, voxel, deposits) {
  const ext = [(nx - 1) * voxel / 2, (ny - 1) * voxel / 2, (nz - 1) * voxel / 2];
  return {
    x: 1000, y: -2000, grid: new Uint8Array(nx * ny * nz).fill(200), dims: { nx, ny, nz, ext },
    plan: { id, voxel, craters: [{ x: 10, y: 20, r: 30, fresh: 0.4 }], deposits }
  };
}
const noise = new THREE.Data3DTexture(new Uint8Array(4 * 8 * 8 * 8), 8, 8, 8);
const shared = {
  sunOcc: uniform(1), ambientTop: uniform(new THREE.Vector3(0.1, 0.1, 0.1)), ambientBounce: uniform(new THREE.Vector3(0.05, 0.05, 0.05)),
  sunColor: uniform(new THREE.Vector3(1, 1, 1)), exposure: uniform(1), volume: null
};
// Atrapa renderera: dispatch → węzeł, wątki i stan kernela w chwili wywołania (uniformy, tekstury węzłów bazowych).
function recorder(kernel) {
  const calls = [];
  return {
    calls,
    compute(node, n) {
      const U = kernel.U;
      calls.push({
        node, n, count: U.count.value, lx: U.lx.value, ly: U.ly.value, lightN: U.lightN.value.toArray(),
        ext: U.ext.value.toArray(), gridN: U.gridN.value.toArray(), voxel: U.voxel.value, band: U.band.value,
        sunG: U.sunG.value.toArray(), depCount: U.depCount.value, dep0: U.dep.array[0].toArray(), hue0: U.depHue.array[0].x,
        sdf: kernel.sdfNode.value, light: kernel.lightNode.value
      });
    }
  };
}
const viewOf = (giant, renderer, bake) => new GiantView({
  renderer, parent: new THREE.Group(), layer: 0, giant, noise, shared, grid, sun: { x: 0, y: 0 }, sunElevDeg: 24, bake
});

test('kernel pieczenia: WGSL w Node bez stałych olbrzyma — strażnik liczby wątków i wymiary z uniformów, jeden odczyt SDF i jeden zapis światła (bez macierzy uv)', () => {
  const k = new GiantBakeKernel();
  const code = buildCompute(k.node).computeShader;
  assert.match(code, /if \( \( instanceIndex >= object\.nodeUniform\d+ \) \) \{\s*return;/, 'strażnik z uniformu count');
  assert.doesNotMatch(code, />= \d+u/, 'bez stałej liczby wątków (dawniej lx · ly · lz w WGSL)');
  assert.match(code, /instanceIndex % object\.nodeUniform\d+/, 'indeks teksla z uniformów lx / ly');
  assert.equal((code.match(/texture_3d<f32>/g) || []).length, 1, 'jedna tekstura SDF');
  assert.equal((code.match(/texture_storage_3d<rgba8unorm, write>/g) || []).length, 1, 'jedna tekstura światła');
  assert.match(code, /textureStore\( \w+, vec3<u32>\( nodeVar\d+, nodeVar\d+, nodeVar\d+ \), vec4<f32>/, 'współrzędne teksla wprost (bez macierzy uv tekstury — pułapka 7)');
  assert.doesNotMatch(code, /mat3x3/, 'bez macierzy uv');
  assert.match(code, /giantLightBakeDep/, 'tablice złóż ze stałą nazwą (pułapka 25)');
});

test('dwa olbrzymy o różnych wymiarach pieką TYM SAMYM węzłem compute (jeden pipeline), z własnymi uniformami, złożami i teksturami w chwili dispatchu; widok nie buduje własnego kernela', () => {
  const k = new GiantBakeKernel();
  const ver = k.node.version;
  const rec = recorder(k);
  const depA = [{ x: 1, y: 2, z: 3, r: 40, hue: 1 }];
  const depB = [{ x: -5, y: 6, z: -7, r: 90, hue: 0 }, { x: 8, y: 9, z: 10, r: 50, hue: 1 }];
  const A = viewOf(fakeGiant('a', 20, 16, 10, 25, depA), rec, k);
  const B = viewOf(fakeGiant('b', 34, 22, 14, 30, depB), rec, k);
  assert.equal(rec.calls.length, 2, 'pieczenie przy budowie widoku');
  const [ca, cb] = rec.calls;
  assert.equal(ca.node, k.node);
  assert.equal(cb.node, k.node, 'ten sam węzeł compute — ten sam pipeline');
  assert.equal(A.bakeKernel, k);
  assert.equal(A.bakeNode, undefined, 'bez kernela na widok');
  assert.equal(A.U.dep, undefined, 'złoża tylko w kernelu');
  // wątki = teksle światła (połowa siatki SDF), uniformy i tekstury olbrzyma
  for (const [c, v, n, deps] of [[ca, A, [10, 8, 5], depA], [cb, B, [17, 11, 7], depB]]) {
    assert.deepEqual(v.lightN, n);
    assert.equal(c.n, n[0] * n[1] * n[2]);
    assert.equal(c.count, c.n);
    assert.deepEqual([c.lx, c.ly, c.lightN], [n[0], n[1], n]);
    assert.deepEqual([c.ext, c.gridN, c.voxel, c.band], [v.U.ext.value.toArray(), v.U.gridN.value.toArray(), v.U.voxel.value, v.U.band.value]);
    assert.equal(c.sdf, v.sdfTexture);
    assert.equal(c.light, v.lightTexture);
    assert.equal(c.depCount, deps.length);
    assert.deepEqual(c.dep0, [deps[0].x, deps[0].y, deps[0].z, deps[0].r]);
    assert.equal(c.hue0, deps[0].hue);
    // kierunek ku słońcu w układzie olbrzyma (jak dawniej: elewacja 24°), w materiale — ten sam z odbiciem osi y
    const dx = -1000, dy = 2000, l = Math.hypot(dx, dy), el = 24 * Math.PI / 180;
    const g = [dx / l * Math.cos(el), dy / l * Math.cos(el), Math.sin(el)];
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(c.sunG[i] - g[i]) < 1e-6);
    assert.deepEqual(v.U.sunS.value.toArray().map((x) => +x.toFixed(6)), [g[0], -g[1], g[2]].map((x) => +x.toFixed(6)));
    assert.ok(v.bakeMs >= 0);
  }
  assert.notEqual(ca.sdf, cb.sdf);
  // kod kernela nie zależy od olbrzyma (po pieczeniu A i B — ten sam WGSL, wersja węzła bez zmian: bez przebudowy)
  const code0 = buildCompute(k.node).computeShader;
  k.bind(A, 1, 0, 0);
  assert.equal(buildCompute(k.node).computeShader, code0);
  assert.equal(k.node.version, ver, 'bez needsUpdate węzła compute');
});

test('wiązania kernela idą za podmianą tekstur olbrzyma (węzły bazowe): po bind A / B tekstura SDF i tekstura światła z grupy wiązań = tekstury tego olbrzyma', () => {
  const k = new GiantBakeKernel();
  const rec = recorder(k);
  const A = viewOf(fakeGiant('a', 20, 16, 10, 25, []), rec, k);
  const B = viewOf(fakeGiant('b', 34, 22, 14, 30, []), rec, k);
  const b = buildCompute(k.node);
  const tex = [];
  for (const gr of b.getBindings()) for (const bd of gr.bindings) if (bd.isSampledTexture) tex.push(bd);
  assert.equal(tex.length, 2, 'SDF (próbkowana) i światło (zapis)');
  const store = tex.find((bd) => bd.store === true), sdf = tex.find((bd) => bd.store !== true);
  assert.ok(store && sdf);
  for (const v of [A, B, A]) {
    k.bind(v, 0, 0, 1);
    sdf.update(); store.update();
    assert.equal(sdf.texture, v.sdfTexture, `SDF ${v.giant.plan.id}`);
    assert.equal(store.texture, v.lightTexture, `światło ${v.giant.plan.id}`);
  }
});

test('rozgrzewka pasa: _prewarmCompute wysyła pusty dispatch kernela pieczenia (licznik wątków 0 — żaden wątek nie pisze), potem olbrzym w grze piecze TYM węzłem; pas tworzy kernel przed rozgrzewką i podaje go widokom', () => {
  const k = new GiantBakeKernel();
  const rec = recorder(k);
  const ver = k.node.version;
  const belt = Object.create(AsteroidBelt.prototype);
  Object.assign(belt, {
    renderer: rec, volume: { computeNodes: () => [] }, mined: null, giantBake: k,
    sparks: { U: { count: { value: 5 }, dt: { value: 1 / 60 } }, spawnNode: { name: 'beltSparkSpawn' }, stepNode: { name: 'beltSparkStep' } }
  });
  k.U.count.value = 77;
  belt._prewarmCompute();
  const warm = rec.calls.filter((c) => c.node === k.node);
  assert.equal(warm.length, 1, 'jeden dispatch kernela pieczenia w rozgrzewce');
  assert.equal(warm[0].count, 0, 'pusty dispatch');
  assert.ok(warm[0].n > 0, 'co najmniej jedna grupa wątków (pipeline powstaje przy dispatchu)');
  assert.equal(k.U.count.value, 77, 'licznik wraca');
  // olbrzym w grze — ten sam węzeł (pipeline z rozgrzewki), bez przebudowy
  const v = viewOf(fakeGiant('c', 12, 12, 8, 40, []), rec, k);
  const last = rec.calls[rec.calls.length - 1];
  assert.equal(last.node, k.node);
  assert.equal(last.count, 6 * 6 * 4);
  assert.equal(last.light, v.lightTexture);
  assert.equal(k.node.version, ver, 'bez przebudowy węzła compute');
  // wpięcie w pasie: kernel z initGpu przed rozgrzewką, wpis rejestru compute, widoki dostają kernel
  const src = read('src/3d/asteroids/asteroidBelt.js');
  assert.match(src, /this\.giantBake = new GiantBakeKernel\(\);[\s\S]*?await this\._prewarm\(\);/);
  assert.match(src, /run\('pas asteroid: kernele compute \([^']*pieczenie światła olbrzymów\)', \(\) => this\._prewarmCompute\(\)\)/);
  const comp = src.slice(src.indexOf('_prewarmCompute() {'), src.indexOf('_warmStep() {'));
  assert.match(comp, /this\.giantBake\?\.warm\(renderer\);/);
  const upd = src.slice(src.indexOf('_updateGiants(dt, ox, oy) {'));
  assert.match(upd, /new GiantView\(\{[\s\S]*?bake: this\.giantBake\s*\}\)/);
});

test('materiał olbrzyma (raymarching) buduje się w Node na wspólnych funkcjach SDF; widok bez `o.bake` — kernel domyślny modułu (jeden na moduł)', () => {
  const rec = { calls: 0, compute() { this.calls++; } };
  const v1 = viewOf(fakeGiant('d', 16, 12, 8, 30, []), rec);
  const v2 = viewOf(fakeGiant('e', 18, 10, 6, 30, []), rec);
  assert.ok(v1.bakeKernel instanceof GiantBakeKernel);
  assert.equal(v1.bakeKernel, v2.bakeKernel, 'kernel domyślny wspólny');
  assert.equal(rec.calls, 2);
  const b = wgsl.backend.createNodeBuilder(v1.mesh, wgsl);
  b.material = v1.mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = v1.mesh.material;
  b.build();
  assert.ok(b.fragmentShader.length > 10000, 'raymarching olbrzyma');
  assert.match(b.fragmentShader, /texture_3d<f32>/);
});
