// Rejestr rozgrzewki pipeline'ów WebGPU (port WebGPU, zadanie 11 — src/3d/rozgrzewka.js, Core3D.warmup):
// moduł zgłasza PRAWDZIWE obiekty, rejestr kompiluje je w tle (compileAsync) siatka po siatce: w celu passa
// (composerTarget, DIST — distortionTarget), kamerą typu passa warstwy, ze światłami sceny Core3D, widoczne
// i bez cullingu tylko na czas wywołania; pilne (now) przed zwykłymi (add), wpisy „na start gry” dopiero
// na ekranie ładowania (flush), drugi stan materiału (wariant), bez powtórek. Bez GPU: atrapa renderera.
// node --test tests/rozgrzewka.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { Rozgrzewka } from '../src/3d/rozgrzewka.js';
import { Core3D } from '../src/3d/core3d.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ORTHO = new Set([0, 6, 7, 10]);

function fakeCore({ hang = false } = {}) {
  const calls = [];
  let target = null;
  const cameraOrtho = new THREE.OrthographicCamera();
  const cameraPersp = new THREE.PerspectiveCamera();
  const composerTarget = { name: 'composerTarget' };
  const distortionTarget = { name: 'distortionTarget' };
  const scene = new THREE.Scene();
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget(t) { target = t; },
    compileAsync(obj, camera, sceneArg) {
      const m = obj.material;
      calls.push({
        obj, camera, scene: sceneArg, target, mask: camera.layers.mask, visible: obj.visible, culled: obj.frustumCulled,
        override: obj.overrideMaterial, transparent: m?.transparent, depthWrite: m?.depthWrite,
        subtreeCulled: (() => { let any = false; obj.traverse?.((o) => { if (o !== obj && o.frustumCulled) any = true; }); return any; })()
      });
      return hang ? new Promise(() => {}) : Promise.resolve();
    }
  };
  const core = {
    renderer, scene, composerTarget, distortionTarget, cameraOrtho, cameraPersp,
    gpuUnsupported: false, ready: Promise.resolve(true),
    warmupCamera(layer, ortho) { return (typeof ortho === 'boolean' ? ortho : layer !== 'all' && ORTHO.has(layer)) ? cameraOrtho : cameraPersp; },
    warmupTarget(layer) { return layer === 10 ? distortionTarget : composerTarget; }
  };
  return { core, calls };
}

const mesh = (name, layer = 0, props = {}) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
  m.name = name;
  m.layers.set(layer);
  Object.assign(m, props);
  return m;
};

test('add: nic przed urządzeniem; potem siatka po siatce — widoczna i bez cullingu tylko na czas wywołania, cel i kamera passa warstwy', async () => {
  const { core, calls } = fakeCore();
  const w = new Rozgrzewka(core);
  const hidden = mesh('ukryta', 0, { visible: false });
  const bg = mesh('tlo', 1);
  const dist = mesh('dist', 10);
  const group = new THREE.Group();
  group.add(hidden, bg);
  const entry = w.add({ name: 'test', objects: () => [group, dist] });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls.length, 0, 'przed start() (urządzenie) nic');
  core.scene.add(group);
  w.start();
  assert.equal(await entry.promise, true);
  assert.deepEqual(calls.map((c) => c.obj.name), ['ukryta', 'tlo', 'dist'], 'każda siatka osobno (także ukryta)');
  for (const c of calls) {
    assert.equal(c.visible, true, 'widoczna na czas kompilacji');
    assert.equal(c.culled, false, 'bez cullingu na czas kompilacji');
    assert.equal(c.scene, core.scene, 'światła sceny Core3D');
  }
  assert.equal(hidden.visible, false, 'stan wraca');
  assert.equal(bg.frustumCulled, true);
  const byName = Object.fromEntries(calls.map((c) => [c.obj.name, c]));
  assert.equal(byName.ukryta.camera, core.cameraOrtho);
  assert.equal(byName.ukryta.target, core.composerTarget);
  assert.equal(byName.tlo.camera, core.cameraPersp);
  assert.equal(byName.tlo.mask, 1 << 1, 'kamera z warstwą siatki');
  assert.equal(byName.dist.target, core.distortionTarget, 'warstwa DIST do swojego celu');
  assert.equal(core.cameraOrtho.layers.mask, 1, 'maska kamery wraca');
  assert.equal(core.renderer.getRenderTarget(), null, 'cel wraca');
  assert.equal(w.stats.siatki, 3);
});

test('now() przed add(); ta sama siatka i materiał nie wracają; wariant przełącza stan tylko na czas wywołania', async () => {
  const { core, calls } = fakeCore();
  const w = new Rozgrzewka(core);
  const a = mesh('a');
  const b = mesh('b');
  w.add({ name: 'zwykły', objects: [a] });
  const urgent = w.now([b], { name: 'pilny' });
  w.start();
  await urgent;
  await w.flush();
  assert.deepEqual(calls.map((c) => c.obj.name), ['b', 'a'], 'pilny pierwszy');
  const again = w.add({ name: 'powtórka', objects: [a, b] });
  assert.equal(await again.promise, true, 'wszystko już rozgrzane');
  assert.equal(calls.length, 2, 'bez ponownej kompilacji');
  assert.ok(w.stats.pominiete >= 2);
  // wariant (np. dach K-7 przezroczysty): mimo rozgrzania bez wariantu, stan tylko na czas wywołania
  a.material.transparent = false;
  a.material.depthWrite = true;
  const variant = { apply(m) { const mat = m.material; mat.transparent = true; mat.depthWrite = false; return () => { mat.transparent = false; mat.depthWrite = true; }; } };
  await w.now([a], { name: 'wariant', variant });
  const last = calls.at(-1);
  assert.equal(last.obj, a);
  assert.deepEqual([last.transparent, last.depthWrite], [true, false]);
  assert.deepEqual([a.material.transparent, a.material.depthWrite], [false, true], 'stan wraca');
});

test('przegląd sceny: visible:false = tylko widoczny łańcuch, filtr warstwy; wpisy „loading” dopiero w flush()', async () => {
  const { core, calls } = fakeCore();
  const w = new Rozgrzewka(core);
  const shown = mesh('widoczna', 3);
  const other = mesh('inna-warstwa', 1);
  const parentHidden = new THREE.Group();
  parentHidden.visible = false;
  parentHidden.add(mesh('pod-ukrytym', 3));
  core.scene.add(shown, other, parentHidden);
  w.add({ name: 'warstwa 3', objects: () => core.scene, layer: 3, visible: false });
  let made = null;
  const loading = w.add({ name: 'pula', objects: () => (made = made || mesh('pula', 0)), phase: 'loading' });
  w.start();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(calls.map((c) => c.obj.name), ['widoczna'], 'bez ukrytych i spoza warstwy; pula jeszcze nie');
  assert.equal(made, null, 'obiekty wpisu „loading” powstają dopiero na ekranie ładowania');
  await w.flush();
  assert.equal(await loading.promise, true);
  assert.deepEqual(calls.map((c) => c.obj.name), ['widoczna', 'pula']);
  // po otwarciu ekranu ładowania wpisy „loading” idą od razu
  const late = w.add({ name: 'później', objects: [mesh('później')], phase: 'loading' });
  assert.equal(await late.promise, true);
});

test('obiekty leniwe: pusta lista czeka na flush(); alive() = false — zadania przepadają; QuadMesh własną kamerą, bez świateł sceny', async () => {
  const { core, calls } = fakeCore();
  const w = new Rozgrzewka(core);
  let ready = false;
  const lazyMesh = mesh('leniwa');
  const lazy = w.add({ name: 'leniwy', objects: () => (ready ? lazyMesh : null) });
  let alive = true;
  const dead = w.add({ name: 'zwolniony', objects: [mesh('zwolniona')], alive: () => alive });
  alive = false;
  const quadMat = new THREE.NodeMaterial();
  const quad = new THREE.QuadMesh(quadMat);
  const sunTarget = { name: 'sunShadowTarget' };
  const q = w.add({ name: 'quad', objects: () => quad, target: () => sunTarget });
  w.start();
  await dead.promise;
  await q.promise;
  assert.ok(!calls.some((c) => c.obj.name === 'zwolniona'));
  const qc = calls.find((c) => c.obj === quad);
  assert.equal(qc.camera, quad.camera, 'kamera QuadMesh');
  assert.equal(qc.scene, null, 'bez świateł sceny (jak QuadMesh.render)');
  assert.equal(qc.target, sunTarget);
  ready = true;
  await w.flush();
  assert.equal(await lazy.promise, true);
  assert.ok(calls.some((c) => c.obj === lazyMesh), 'drugie podejście przy flush()');
});

test('cały obiekt jednym wywołaniem: materiał zastępczy sceny i culling poddrzewa tylko na czas kompilacji; limit czasu flush()', async () => {
  const { core, calls } = fakeCore();
  const w = new Rozgrzewka(core);
  const override = new THREE.MeshBasicMaterial();
  core.scene.add(mesh('planeta', 3));
  const e = w.add({ name: 'pre-pass', objects: () => core.scene, layer: 3, split: false, override, visible: false });
  w.start();
  assert.equal(await e.promise, true);
  const c = calls[0];
  assert.equal(c.obj, core.scene);
  assert.equal(c.override, override);
  assert.equal(c.subtreeCulled, false, 'culling poddrzewa wyłączony');
  assert.equal(core.scene.overrideMaterial, null, 'materiał zastępczy wraca');
  assert.equal(core.scene.children[0].frustumCulled, true);
  // pipeline, który nie powstaje: flush wraca po limicie czasu
  const hang = fakeCore({ hang: true });
  const w2 = new Rozgrzewka(hang.core);
  w2.start();
  w2.add({ name: 'wisi', objects: [mesh('x')] });
  const t0 = Date.now();
  await w2.flush({ timeoutMs: 150 });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(w2.busy, true, 'kompilacja dalej w tle');
});

test('bez WebGPU: now() od razu false', async () => {
  const { core } = fakeCore();
  core.gpuUnsupported = true;
  const w = new Rozgrzewka(core);
  assert.equal(await w.now([mesh('a')]), false);
});

test('Core3D: rejestr jako Core3D.warmup, start przy gotowym urządzeniu, passy Core3D w rejestrze; wpisy modułów jedną linią', () => {
  assert.ok(Core3D.warmup instanceof Rozgrzewka);
  const core = read('src/3d/core3d.js');
  const initGpu = core.slice(core.indexOf('async _initGpu() {'), core.indexOf('_failGpu(reason) {'));
  assert.match(initGpu, /this\.fx\?\.warmAll\(\);[\s\S]*this\._registerPassWarmups\(\);\s*this\.warmup\.start\(\);/);
  // passy: w tle menu tło i planety, pre-pass halo z materiałem zastępczym, quady; na ekranie ładowania wszystkie
  const added = [];
  const fake = { warmup: { add: (spec) => added.push(spec) }, scene: {}, haloDepthMaskMaterial: { name: 'haloDepthMask' } };
  Core3D._registerPassWarmups.call(fake);
  const menuLayers = added.filter((s) => Number.isInteger(s.layer) && !s.phase && s.split !== false).map((s) => s.layer);
  assert.deepEqual(menuLayers, [1, 3, 5, 6]);
  assert.ok(added.every((s) => s.visible !== true), 'przegląd sceny tylko widocznych');
  assert.ok(added.some((s) => s.override === fake.haloDepthMaskMaterial && s.split === false && s.layer === 3));
  assert.equal(added.filter((s) => /quad/.test(s.name)).length, 2);
  assert.deepEqual(added.filter((s) => s.phase === 'loading').map((s) => s.layer).sort(), [0, 1, 2, 3, 5, 6, 7]);
  // moduły: jedna linia przy imporcie, pule tworzone na ekranie ładowania
  assert.match(read('src/3d/engineExhaustBatch.js'), /Core3D\.warmup\?\.add\(\{ name: 'dysze SIDE', objects: \(\) => EngineExhaustBatch\.warmupMeshes\(\), phase: 'loading' \}\);/);
  assert.match(read('src/3d/shipLights3D.js'), /Core3D\.warmup\?\.add\(\{ name: 'światła pozycyjne statków', objects: [^\n]*phase: 'loading' \}\);/);
});
