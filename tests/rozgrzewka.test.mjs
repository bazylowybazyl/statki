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
  const urgent = [];
  const fake = {
    warmup: { add: (spec) => added.push(spec), now: (objects, opts) => urgent.push({ ...opts, objects }) },
    scene: {}, haloDepthMaskMaterial: { name: 'haloDepthMask' },
    _registerPostWarmups: Core3D._registerPostWarmups
  };
  Core3D._registerPassWarmups.call(fake);
  // post (uber z bloomem i bez) pilnie, zanim ruszy tło menu: quady RenderPipeline na kanwie (passy bloomu rysuje
  // przy tym updateBefore — bez osobnych wpisów i bez pól prywatnych BloomNode)
  assert.deepEqual(urgent.map((s) => s.name), ['Core3D: post (uber, bloom)', 'Core3D: post bez bloomu']);
  assert.equal(urgent[0].target(), null, 'post na kanwie');
  assert.equal(urgent.some((s) => s.variant), false, 'bez wariantu: updateBeforeType bloomu nietknięty');
  let updated = 0;
  fake._post = { _quadMesh: { isQuadMesh: true }, _update: () => { updated++; } };
  assert.equal(urgent[0].objects(), fake._post._quadMesh);
  assert.equal(updated, 1, 'graf „uber” ustawiony przed kompilacją (RenderPipeline._update)');
  assert.equal(urgent[1].objects(), null, 'bez postu wpis pusty');
  const menuLayers = added.filter((s) => Number.isInteger(s.layer) && !s.phase && s.split !== false).map((s) => s.layer);
  assert.deepEqual(menuLayers, [1, 3, 5, 6]);
  assert.ok(added.every((s) => s.visible !== true), 'przegląd sceny tylko widocznych');
  assert.ok(added.some((s) => s.override === fake.haloDepthMaskMaterial && s.split === false && s.layer === 3));
  assert.equal(added.filter((s) => /quad/.test(s.name)).length, 2);
  assert.deepEqual(added.filter((s) => s.phase === 'loading' && s.ortho !== false).map((s) => s.layer).sort(), [0, 1, 2, 3, 5, 6, 7]);
  // gra 3D (free3d): warstwy passów ortho jeszcze raz kamerą perspektywy (typ kamery w kluczu pipeline'u)
  assert.deepEqual(added.filter((s) => s.phase === 'loading' && s.ortho === false).map((s) => s.layer).sort(), [0, 2, 7]);
  // moduły: jedna linia przy imporcie, pule tworzone na ekranie ładowania
  assert.match(read('src/3d/engineExhaustBatch.js'), /Core3D\.warmup\?\.add\(\{ name: 'dysze SIDE', objects: \(\) => EngineExhaustBatch\.warmupMeshes\(\), phase: 'loading' \}\);/);
  assert.match(read('src/3d/shipLights3D.js'), /Core3D\.warmup\?\.add\(\{ name: 'światła pozycyjne statków', objects: [^\n]*phase: 'loading' \}\);/);
});

test('compileAsyncNaCelu: głębia i szablon CELU na czas wywołania (jak zwykły render), potem stan renderera wraca', async () => {
  const { compileAsyncNaCelu } = await import('../src/3d/rozgrzewka.js');
  const seen = [];
  let target = null;
  const renderer = {
    depth: true, stencil: false,
    getRenderTarget: () => target,
    compileAsync(scene, camera, targetScene) { seen.push({ depth: this.depth, stencil: this.stencil, targetScene }); return Promise.resolve('ok'); }
  };
  // cel bez bufora głębi (pieczenie, maska słońca, DIST): pipeline bez Depth24Plus
  target = { depthBuffer: false, stencilBuffer: false };
  assert.equal(await compileAsyncNaCelu(renderer, 'scena', 'kamera'), 'ok');
  // cel z głębią i szablonem
  target = { depthBuffer: true, stencilBuffer: true };
  await compileAsyncNaCelu(renderer, 'scena', 'kamera', 'swiatla');
  // ekran (bez celu): stan renderera bez zmian
  target = null;
  await compileAsyncNaCelu(renderer, 'scena', 'kamera');
  assert.deepEqual(seen, [
    { depth: false, stencil: false, targetScene: null },
    { depth: true, stencil: true, targetScene: 'swiatla' },
    { depth: true, stencil: false, targetScene: null }
  ]);
  assert.equal(renderer.depth, true);
  assert.equal(renderer.stencil, false);
  // wyjątek z compileAsync też przywraca stan
  target = { depthBuffer: false };
  renderer.compileAsync = () => { throw new Error('zly'); };
  assert.throws(() => compileAsyncNaCelu(renderer, 's', 'k'), /zly/);
  assert.equal(renderer.depth, true);
});

test('compileAsync w grze tylko przez compileAsyncNaCelu (klucz pipeline’u z głębią celu)', () => {
  const files = ['src/3d/core3d.js', 'src/3d/rozgrzewka.js', 'src/3d/haloRing/haloRingWorldGen.js', 'src/3d/haloRing/haloRingDetail.js'];
  for (const f of files) {
    const code = read(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const raw = [...code.matchAll(/\.compileAsync\(/g)].length;
    // jedyne bezpośrednie wywołania: w samej funkcji pomocniczej (ekran i cel)
    assert.equal(raw, f === 'src/3d/rozgrzewka.js' ? 2 : 0, `${f}: bezpośrednie compileAsync`);
    if (f !== 'src/3d/rozgrzewka.js') assert.match(code, /compileAsyncNaCelu\(/, `${f}: przez compileAsyncNaCelu`);
  }
});

test('run: istniejąca rozgrzewka modułu od razu, jej kompilacje (track) i obietnica w jednym wpisie; flush czeka na nie', async () => {
  const { core } = fakeCore();
  const w = new Rozgrzewka(core);
  w.start();
  let resolveInner;
  const inner = new Promise((r) => { resolveInner = r; });
  let ran = false;
  const ret = w.run('moduł X', () => { ran = true; w.track(inner); return 42; });
  assert.equal(ran, true, 'od razu, w chwili właściciela');
  assert.equal(ret, 42, 'wynik funkcji wraca bez zmian');
  assert.equal(w.busy, true, 'kompilacja modułu w locie');
  const flushed = w.flush({ timeoutMs: 2000 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.stats.lista.some((x) => x.nazwa === 'moduł X'), false, 'wpis po pipeline’ach');
  resolveInner();
  await flushed;
  await new Promise((r) => setTimeout(r, 0));
  const row = w.stats.lista.find((x) => x.nazwa === 'moduł X');
  assert.ok(row && row.modul === true && row.ms >= 0 && row.cpuMs >= 0 && row.t >= 0);
  // obietnica zwrócona przez fn też się liczy; wyjątek leci do właściciela
  const p = w.run('async', () => Promise.resolve('ok'));
  assert.equal(await p, 'ok');
  assert.throws(() => w.run('zly', () => { throw new Error('bum'); }), /bum/);
});

test('Core3D.fx: rozgrzewka kroku (warm) idzie przez rejestr — jedno miejsce dla broni, rakiet, iskier, warpa, pasa, mapy ran', async () => {
  const { FxFrame } = await import('../src/3d/fx/fxFrame.js');
  const fx = new FxFrame();
  const names = [];
  const core = { warmup: { run: (name, fn) => { names.push(name); return fn(); } } };
  fx.attach({ compute() {}, lighting: null }, core);
  let warmed = 0;
  fx.addStep({ name: 'krokA', warm: () => { warmed++; } });
  fx.warmAll();
  fx.addStep({ name: 'krokB', warm: () => { warmed++; } });
  assert.equal(warmed, 2);
  assert.deepEqual(names, ['Core3D.fx: krokA', 'Core3D.fx: krokB']);
  // index.html: kadłuby, tarcze i start GPU pasa przez Core3D.warmup.run (jedna linia na moduł)
  const html = read('index.html');
  assert.match(html, /Core3D\.warmup\.run\('kadłuby i Fx3D \(hexShips3D\)', \(\) => prewarmHexShips3D\(/);
  assert.match(html, /Core3D\.warmup\.run\('tarcze \(shield3D\)', \(\) => prewarmShields3D\(\)\);/);
  assert.match(html, /await Core3D\.warmup\.run\('pas asteroid: start GPU \(asteroidBelt\)', \(\) => asteroidBelt\.initGpu\(\)\);/);
});

// Zadanie 25a: pass MAPY CIENIA w rejestrze (`shadow: true`) — siatki z castShadow przez Core3D.prewarmShadowPass
// (kontekst passa cienia gry), osobno od passa sceny; droga niedostępna (false) → `fallback` wpisu.
test('shadow: true — tylko castShadow, przez prewarmShadowPass, osobno od passa sceny; false → fallback', async () => {
  const { core, calls } = fakeCore();
  const shadowCalls = [];
  let route = true;
  core.prewarmShadowPass = (obj) => { shadowCalls.push(obj); return Promise.resolve(route); };
  const w = new Rozgrzewka(core);
  const caster = mesh('rzuca', 2, { castShadow: true });
  const other = mesh('nie-rzuca', 2);
  const group = new THREE.Group();
  group.add(caster, other);
  w.start();
  const e = w.add({ name: 'cień', objects: group, shadow: true });
  assert.equal(await e.promise, true);
  assert.deepEqual(shadowCalls.map((o) => o.name), ['rzuca'], 'pass cienia rysuje tylko castShadow');
  assert.equal(calls.length, 0, 'bez compileAsync passa sceny');
  // ta sama siatka w passie sceny — osobne „rozgrzane”
  const scene = w.add({ name: 'scena', objects: group, layer: 2 });
  assert.equal(await scene.promise, true);
  assert.deepEqual(calls.map((c) => c.obj.name), ['rzuca', 'nie-rzuca']);
  // powtórka cienia — pominięta
  const again = w.add({ name: 'cień 2', objects: caster, shadow: true });
  assert.equal(await again.promise, true);
  assert.equal(shadowCalls.length, 1);
  // droga niedostępna: fallback dostaje siatkę, wpis false
  route = false;
  const fallen = [];
  const other2 = mesh('zapas', 2, { castShadow: true });
  const f = w.add({ name: 'zapas', objects: other2, shadow: true, fallback: (m) => fallen.push(m) });
  assert.equal(await f.promise, false);
  assert.deepEqual(fallen, [other2]);
});

// Zadanie 25a: Core3D.prewarmShadowPass — compileAsync w kontekście passa cienia gry: cel mapy cienia, kamera cienia
// ze wszystkimi warstwami, scena z materiałem zastępczym cienia (ShadowPassMaterial), kontekst renderu z GŁĘBOKOŚCIĄ
// wywołania passa cienia (1 — mapa rysuje się w passie sceny), stan renderera, kamery i siatek wraca.
test('Core3D.prewarmShadowPass: głębokość 1 w kontekście, materiał zastępczy cienia, cel mapy — stan wraca', async () => {
  const light = new THREE.DirectionalLight();
  light.castShadow = true;
  const holder = { _sunShadowLight: null };
  Core3D.setSunShadowLight.call(holder, light);
  const node = light.shadow.shadowNode;
  assert.ok(node && node.passLayersMask === 0, 'PassShadowNode');
  const shadowMap = { name: 'mapaCienia', depthBuffer: true, stencilBuffer: false };
  node.shadowMap = shadowMap;
  const seen = [];
  let target = null;
  const contexts = { get(rt, mrt, depth = 0) { seen.push({ ctx: true, rt, depth }); return {}; } };
  const renderer = {
    depth: true, stencil: false, shadowMap: { enabled: true }, _renderContexts: contexts, _mrt: null,
    getRenderTarget: () => target,
    setRenderTarget(t) { target = t; },
    getMRT() { return this._mrt; },
    compileAsync(scene, camera) {
      // jak three r183: kontekst z celu i MRT, bez głębokości wywołania
      this._renderContexts.get(target, this._mrt);
      seen.push({ scene, override: scene.overrideMaterial, children: [...scene.children], mask: camera.layers.mask, camera, target,
        flags: scene.children.map((m) => [m.visible, m.frustumCulled]) });
      return Promise.resolve();
    }
  };
  const fake = { gpuReady: true, renderer, _sunShadowLight: light, shadowCatcherFg: null, shadowCatcher: null, warmup: null,
    _ensureSunShadowMap: Core3D._ensureSunShadowMap };
  const caster = mesh('rzuca', 2, { castShadow: true, visible: false });
  const other = mesh('nie-rzuca', 2);
  const root = new THREE.Group();
  root.add(caster, other);
  assert.equal(await Core3D.prewarmShadowPass.call(fake, root), true);
  const ctx = seen.find((s) => s.ctx);
  assert.equal(ctx.depth, 1, 'kontekst głębokości passa cienia');
  assert.equal(ctx.rt, shadowMap, 'cel mapy cienia');
  const c = seen.find((s) => s.scene);
  assert.equal(c.override?.isShadowPassMaterial, true, 'materiał zastępczy passa cienia');
  assert.deepEqual(c.children.map((m) => m.name), ['rzuca'], 'tylko castShadow');
  assert.deepEqual(c.flags, [[true, false]], 'widoczna i bez cullingu na czas wywołania');
  assert.equal(c.camera, light.shadow.camera);
  assert.equal(c.mask, 0xffffffff | 0, 'kamera cienia ze wszystkimi warstwami');
  assert.equal(Object.prototype.hasOwnProperty.call(contexts, 'get'), true, 'własne get atrapy zostaje');
  const ctx2 = contexts.get(null, null);
  assert.equal(ctx2 && seen.at(-1).depth, 0, 'kolejne wywołania bez podmiany');
  assert.equal(caster.parent, root, 'rodzic bez zmian');
  assert.deepEqual([caster.visible, caster.frustumCulled], [false, true], 'flagi wracają');
  assert.equal(target, null, 'cel wraca');
  assert.equal(light.shadow.camera.layers.mask, 1, 'maska kamery cienia wraca');
  assert.equal(fake._shadowWarmScene.children.length, 0);
  assert.equal(fake._shadowWarmScene.overrideMaterial, null);
  // bez słońca z cieniem / bez pól three — false (wołający rozgrzewa rysunkiem)
  assert.equal(await Core3D.prewarmShadowPass.call({ ...fake, _sunShadowLight: null }, root), false);
  assert.equal(await Core3D.prewarmShadowPass.call({ ...fake, renderer: { ...renderer, _renderContexts: null } }, root), false);
});

// Strażnik pól prywatnych three r183, na których stoi prewarmShadowPass (zadanie 25a): kontekst renderu z głębokością
// wywołania w passie, compileAsync bez niej, mapa cienia rysowana renderer.render z materiałem zastępczym cienia.
// Aktualizacja three = sprawdzić, czy mapa cienia nadal rysuje się w kontekście tej samej głębokości.
test('three r183: kontekst renderu z głębokością wywołania (prewarmShadowPass)', () => {
  const r = read('node_modules/three/src/renderers/common/Renderer.js');
  const at = r.indexOf('_renderScene( scene, camera, useFrameBufferTarget = true ) {');
  assert.ok(at > 0, 'Renderer._renderScene');
  const renderScene = r.slice(at, at + 3000);
  assert.match(renderScene, /this\._callDepth \+\+;[\s\S]*this\._renderContexts\.get\( renderTarget, this\._mrt, this\._callDepth \)/);
  const compile = r.slice(r.indexOf('async compileAsync( scene, camera'), r.indexOf('async compileAsync( scene, camera') + 1500);
  assert.match(compile, /const renderContext = this\._renderContexts\.get\( renderTarget, this\._mrt \);/);
  const s = read('node_modules/three/src/nodes/lighting/ShadowNode.js');
  assert.match(s, /scene\.overrideMaterial = getShadowMaterial\( light \);/);
  assert.match(s, /renderer\.render\( scene, shadow\.camera \);/);
  const rc = read('node_modules/three/src/renderers/common/RenderContexts.js');
  assert.match(rc, /get\( renderTarget = null, mrt = null, callDepth = 0 \)/);
});
