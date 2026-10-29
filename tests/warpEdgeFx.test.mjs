// Boki kadru w skoku gracza (src/3d/warp/warpEdgeFx.js, 2026-10-29 — haze DIST, drobiny pędu, zorza krawędzi):
// obwiednia siły (fazy, kop, lot przy mijanym ciele, wyjście z frontem smug gwiazd, hipercruise = 0), przełącznik z adresu
// (`?warpFx=`), maska boków i punkt zbiegu (lustra CPU), WGSL trzech materiałów zbudowany w Node (bez GPU), strażnik
// szwu (bez Math.random, window, DOM i importów src/game) i wpięcie w sterownik WarpNurt (fazy skoku z automatu gry,
// hipercruise, kamera bez soczewki, warstwa DIST zgłaszana z kroku efektów, siatki chowane bez klatki sterownika).
// node --test tests/warpEdgeFx.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  WarpEdgeFx, WarpEdgeFxTune, WARP_EDGE_FX_DEFAULT, WARP_EDGE_ENVELOPE, WARP_EDGE_MASK, WARP_EDGE_FAR_DEPTH,
  parseWarpEdgeFx, newWarpEdgeFxSwitch, warpEdgeEnvelope, newWarpEdgeEnvelope, warpEdgeSideMask, warpEdgeVanishPoint
} from '../src/3d/warp/warpEdgeFx.js';
import { warpExitFrontS } from '../src/render/warpLensPhase.js';
import { FX_DISTORT_LAYER } from '../src/3d/fx/fxFrame.js';
import { WORLD_LENS_DEFAULTS } from '../src/3d/warp/worldLens.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const env = (s) => warpEdgeEnvelope(s, newWarpEdgeEnvelope());

// ── obwiednia siły ─────────────────────────────────────────────────────────────────────────────────────────────────

test('obwiednia: ładowanie słabo i rośnie z ładowaniem, kop × 2 przez ~0,6 s, lot = 1 × prędkość widoczna, hipercruise 0', () => {
  const E = WARP_EDGE_ENVELOPE;
  assert.equal(env(null).strength, 0);
  for (const mode of ['charging', 'warp', 'exit']) {
    const e = env({ mode, charge: 1, kickAge: 3, exitAge: 0.1, exitSlow: 0.7, flowRatio: 1, hyper: true });
    assert.equal(e.strength, 0, `hipercruise (${mode}) bez efektów boków`);
    assert.equal(e.speed, 0);
  }
  // ładowanie: od zera, monotonicznie, najwyżej chargeLevel (słabo — świat dopiero wstaje)
  assert.equal(env({ mode: 'charging', charge: 0 }).strength, 0);
  let prev = -1;
  for (let c = 0; c <= 1.0001; c += 0.02) {
    const e = env({ mode: 'charging', charge: c });
    assert.ok(e.strength >= prev - 1e-12, `ładowanie ${c}`);
    prev = e.strength;
  }
  assert.ok(near(env({ mode: 'charging', charge: 1 }).strength, E.chargeLevel));
  assert.ok(E.chargeLevel <= 0.5, 'ładowanie słabsze niż lot');
  // kop: bez skoku z ładowania, szczyt ~× 2 (siła i przepływ), po kickTime dokładnie lot
  assert.ok(near(env({ mode: 'warp', kickAge: 0, flowRatio: 1 }).strength, E.chargeLevel));
  let peak = 0;
  let peakSpeed = 0;
  let prevS = env({ mode: 'warp', kickAge: 0, flowRatio: 1 }).strength;
  let maxStep = 0;
  for (let k = 0.002; k <= 1.2; k += 0.002) {
    const e = env({ mode: 'warp', kickAge: k, flowRatio: 1 });
    peak = Math.max(peak, e.strength);
    peakSpeed = Math.max(peakSpeed, e.speed);
    maxStep = Math.max(maxStep, Math.abs(e.strength - prevS));
    prevS = e.strength;
  }
  assert.ok(peak > 1.6 && peak <= 2 + 1e-9, `szczyt kopu ${peak}`);
  assert.ok(peakSpeed > 1.6 && peakSpeed <= 2 + 1e-9, `przepływ w kopie ${peakSpeed}`);
  assert.ok(maxStep < 0.12, `kop bez skoku w klatce 2 ms (${maxStep})`);
  const settled = env({ mode: 'warp', kickAge: E.kickTime + 0.01, flowRatio: 1 });
  assert.ok(near(settled.strength, 1) && near(settled.speed, 1) && settled.kick === 0 && settled.frontOn === 0);
  // lot przy mijanym ciele (statek zwalnia — przepływ widoczny niższy): haze słabszy i wolniejszy, nie znika
  const fly = env({ mode: 'warp', kickAge: 5, flowRatio: 0.3 });
  assert.ok(near(fly.strength, E.flybyFloor + (1 - E.flybyFloor) * 0.3));
  assert.ok(near(fly.speed, 0.3));
  assert.ok(fly.strength >= E.flybyFloor);
});

test('obwiednia: wyjście gaśnie z frontem smug gwiazd (ta sama funkcja co gwiazdy i soczewka), bezczynność = 0', () => {
  const E = WARP_EDGE_ENVELOPE;
  const slow = 0.7;
  const e0 = env({ mode: 'exit', exitAge: 0, exitSlow: slow, flowRatio: 1 });
  assert.equal(e0.frontOn, 1);
  assert.ok(near(e0.frontS, warpExitFrontS(0, slow)));
  assert.ok(near(e0.strength, 1), 'pierwsza klatka wyjścia bez skoku siły');
  let prevS = 2;
  let prevV = 2;
  for (let tx = 0; tx <= slow + E.exitTail + 0.1; tx += 0.01) {
    const e = env({ mode: 'exit', exitAge: tx, exitSlow: slow, flowRatio: 1 });
    assert.ok(e.strength <= prevS + 1e-12 && e.speed <= prevV + 1e-12, `wyjście ${tx}`);
    assert.ok(near(e.frontS, warpExitFrontS(tx, slow)));
    prevS = e.strength;
    prevV = e.speed;
  }
  assert.equal(env({ mode: 'exit', exitAge: slow + E.exitTail, exitSlow: slow, flowRatio: 1 }).strength, 0);
  // front przechodzi od dziobu (+) ku rufie (−) w czasie zwolnienia
  assert.ok(env({ mode: 'exit', exitAge: 0, exitSlow: slow }).frontS > 0);
  assert.ok(env({ mode: 'exit', exitAge: slow, exitSlow: slow }).frontS < 0);
  // bezczynność: po wyjściu 0; po przerwanym ładowaniu gaśnie razem z ładowaniem
  assert.equal(env({ mode: 'idle', charge: 0 }).strength, 0);
  assert.ok(env({ mode: 'idle', charge: 0.6 }).strength > 0);
  assert.ok(env({ mode: 'idle', charge: 0.3 }).strength < env({ mode: 'idle', charge: 0.6 }).strength);
});

// ── przełącznik z adresu ───────────────────────────────────────────────────────────────────────────────────────────

test('przełącznik ?warpFx=: 0, haze, czastki, zorza, wszystko, listy; brak albo nieznane — zestaw domyślny', () => {
  const p = (s) => { const o = parseWarpEdgeFx(s, newWarpEdgeFxSwitch()); return [o.haze, o.czastki, o.zorza, o.src]; };
  const D = WARP_EDGE_FX_DEFAULT;
  assert.deepEqual(p(''), [D.haze, D.czastki, D.zorza, 'domyślnie']);
  assert.deepEqual(p('?dev=1'), [D.haze, D.czastki, D.zorza, 'domyślnie']);
  assert.deepEqual(p('?warpFx=0'), [false, false, false, 'adres']);
  assert.deepEqual(p('?dev=1&warpFx=off'), [false, false, false, 'adres']);
  assert.deepEqual(p('?warpFx=haze'), [true, false, false, 'adres']);
  assert.deepEqual(p('?warpFx=czastki&x=1'), [false, true, false, 'adres']);
  assert.deepEqual(p('?warpFx=cz%C4%85stki'), [false, true, false, 'adres']);
  assert.deepEqual(p('?warpFx=zorza'), [false, false, true, 'adres']);
  assert.deepEqual(p('?warpFx=wszystko'), [true, true, true, 'adres']);
  assert.deepEqual(p('?warpFx=haze,zorza'), [true, false, true, 'adres']);
  assert.deepEqual(p('?warpFx=haze+czastki'), [true, true, false, 'adres']);
  assert.deepEqual(p('?warpFx=coś'), [D.haze, D.czastki, D.zorza, 'domyślnie']);
  assert.deepEqual(p('?warpFx=%E0%A4%A'), [D.haze, D.czastki, D.zorza, 'domyślnie'], 'zepsute kodowanie — bez wyjątku');
  // domyślny zestaw coś pokazuje (bez parametru efekt jest w grze)
  assert.ok(D.haze || D.czastki || D.zorza);
});

// ── maska boków i punkt zbiegu ─────────────────────────────────────────────────────────────────────────────────────

test('maska boków: kolumna osi kursu czysta (statek, VP), boki pełne, za rufą słabiej, front wyjścia czyści kadr', () => {
  // 1920 × 1080, statek 120 px pod środkiem, kurs w górę (y w górę)
  const H = 1080;
  const m = (x, y, front) => warpEdgeSideMask(x, y, 0, -120, 0, 1, H, front);
  assert.equal(m(0, -120), 0, 'statek');
  assert.equal(m(0, 420), 0, 'punkt zbiegu (na osi kursu)');
  assert.equal(m(0.1 * H, 0), 0, 'blisko osi');
  assert.ok(m(-955, 0) > 0.95 && m(955, 200) > 0.95, 'lewa / prawa krawędź');
  assert.ok(m(-0.5 * H, 0) > 0.3 && m(-0.5 * H, 0) < 0.8, 'w pół drogi');
  assert.ok(m(955, -530) < m(955, 0) * 0.75, 'dół (za rufą) słabiej');
  assert.ok(m(955, -530) > 0.4, 'dół nie znika');
  // front wyjścia: przed frontem czysto, za nim bez zmian
  const front = { on: 1, px: 100 };
  assert.ok(m(955, 400, front) < 1e-9, 'przed frontem');
  assert.ok(near(m(955, -200, front), m(955, -200)), 'za frontem');
  // w osiach obróconego kursu to samo
  const c = Math.SQRT1_2;
  assert.ok(near(warpEdgeSideMask(-c * 900, c * 900, 0, 0, c, c, H), warpEdgeSideMask(-900, 0, 0, 0, 0, 1, H)));
  assert.ok(WARP_EDGE_MASK.clear < WARP_EDGE_MASK.full);
});

test('punkt zbiegu: jak soczewka O1 (hf · droga od kotwicy do krawędzi przed dziobem), bez danych — 0,15 H od góry', () => {
  const vp = warpEdgeVanishPoint(0, -1, 960, 540, 0, 100);
  assert.ok(vp.ok);
  assert.ok(near(vp.x, 0) && near(vp.y, 100 - WORLD_LENS_DEFAULTS.hf * 640), `VP ${vp.x}, ${vp.y}`);
  const side = warpEdgeVanishPoint(1, 0, 960, 540, -200, 0);
  assert.ok(near(side.x, -200 + WORLD_LENS_DEFAULTS.hf * 1160) && near(side.y, 0));
  const bad = warpEdgeVanishPoint(NaN, 0, 960, 540, 0, 0);
  assert.equal(bad.ok, false);
  assert.ok(near(bad.x, 0) && near(bad.y, -0.7 * 540), 'zapas: środek x, 0,15 wysokości od góry');
});

// ── WGSL w Node (bez GPU) ──────────────────────────────────────────────────────────────────────────────────────────

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildMesh(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const uniformBuffers = (wgsl) => (wgsl.match(/var<uniform>/g) || []).length;
const vertexInputs = (wgsl) => (wgsl.match(/@location\( ?\d+ ?\) [A-Za-z_]+ : /g) || []).length;
function assertNoReversedSmoothstep(wgsl) {
  const re = /smoothstep\(\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*,/g;
  let m;
  while ((m = re.exec(wgsl))) assert.ok(Number(m[1]) < Number(m[2]), `odwrócone krawędzie: ${m[0]}`);
}

test('WGSL: trzy materiały w limitach (≤ 12 buforów uniformów, ≤ 8 wejść), bez pow, haze B = A = 0 i próbka z poziomem', () => {
  const fx = new WarpEdgeFx();
  const out = {};
  for (const mesh of fx.warmupMeshes()) {
    const w = buildMesh(mesh);
    out[mesh.name] = w;
    for (const s of [w.vertex, w.fragment]) {
      assert.ok(uniformBuffers(s) <= 12, `${mesh.name}: bufory uniformów`);
      assert.doesNotMatch(s, /\bpow\(/, `${mesh.name}: bez pow (NaN z ujemną podstawą)`);
      assertNoReversedSmoothstep(s);
    }
    assert.ok(vertexInputs(w.vertex) <= 8, `${mesh.name}: wejścia wierzchołków`);
    const mat = mesh.material;
    assert.equal(mat.forceSinglePass, true, mesh.name);
    assert.equal(mat.depthWrite, false, mesh.name);
    assert.equal(mat.rulonBend, false, `${mesh.name}: pełnoekranowe / klip — rulon nie zgina`);
    assert.equal(mat.transparent, true, mesh.name);
    assert.equal(mesh.frustumCulled, false, mesh.name);
    assert.equal(mesh.visible, false, `${mesh.name}: schowane poza skokiem`);
  }
  // W1: warstwa DIST, One / One także w alfie, przesunięcie w RG, B = A = 0 (maskowanie), próbka w gałęzi z poziomem
  const haze = out['warp:hazeBokow'];
  assert.equal(fx.hazeMesh.layers.mask, 1 << FX_DISTORT_LAYER);
  assert.equal(fx.hazeMesh.material.depthTest, false);
  assert.equal(fx.hazeMesh.material.blendSrc, THREE.OneFactor);
  assert.equal(fx.hazeMesh.material.blendDst, THREE.OneFactor);
  assert.equal(fx.hazeMesh.material.blendSrcAlpha, THREE.OneFactor);
  assert.equal(fx.hazeMesh.material.blendDstAlpha, THREE.OneFactor);
  assert.match(haze.fragment, /output\.color = vec4<f32>\( nodeVar\d+, 0\.0, 0\.0 \);/);
  assert.match(haze.fragment, /textureSampleLevel\(/);
  assert.doesNotMatch(haze.fragment, /textureSample\(/, 'bez próbki z pochodnymi w gałęzi per piksel');
  assert.match(haze.fragment, /atan2\(/);
  assert.match(haze.vertex, /vec4<f32>\( position\.xy, 0\.5, 1\.0 \)/, 'quad pełnoekranowy w klipie');
  // W2 / W3: pass tła (warstwa 1), głębia przy dalekiej płaszczyźnie z testem, alfa wyjścia 0 (cel sceny bez zmiany alfy)
  for (const [name, mesh] of [['warp:drobinyBokow', fx.dustMesh], ['warp:zorzaKrawedzi', fx.auroraMesh]]) {
    assert.equal(mesh.layers.mask, 1 << 1, `${name}: warstwa 1`);
    assert.equal(mesh.material.depthTest, true);
    assert.match(out[name].vertex, new RegExp(`${String(WARP_EDGE_FAR_DEPTH).replace('.', '\\.')}, 1\\.0 \\)`));
    assert.match(out[name].fragment, /output\.color = vec4<f32>\([\s\S]*, 0\.0 \);\s*return output;/);
  }
  // W2: instancje z jednej siatki (InstancedBufferGeometry, nie InstancedMesh), pozycje z haszu instancji
  assert.equal(fx.dustMesh.geometry.isInstancedBufferGeometry, true);
  assert.equal(fx.dustMesh.isInstancedMesh, undefined);
  assert.ok(fx.dustMesh.geometry.instanceCount >= 2 && fx.dustMesh.geometry.instanceCount === WarpEdgeFxTune.dustCount);
  assert.match(out['warp:drobinyBokow'].vertex, /@builtin\( instance_index \)/);
  assert.equal(Object.keys(fx.dustMesh.geometry.attributes).length, 1, 'bez atrybutów instancji — sam kwad');
  // W3: geometria tylko przy krawędziach (dwa pasy, 8 wierzchołków)
  assert.equal(fx.auroraMesh.geometry.getAttribute('position').count, 8);
});

// ── strażnik szwu i losowości ──────────────────────────────────────────────────────────────────────────────────────

test('moduł renderu: bez Math.random, window, GameState, DOM i importów src/game; przełącznik przez RenderWorld.pageSearch', () => {
  const src = code('src/3d/warp/warpEdgeFx.js');
  assert.doesNotMatch(src, /Math\.random/);
  assert.doesNotMatch(src, /\bwindow\b/);
  assert.doesNotMatch(src, /GameState/);
  assert.doesNotMatch(src, /\bdocument\b|\blocation\b/);
  assert.doesNotMatch(src, /from '[^']*\/game\//, 'bez importów src/game (szew — sufit warpDrive.js wyczerpany)');
  assert.match(src, /RenderWorld\.pageSearch/);
  assert.doesNotMatch(src, /ShaderMaterial|onBeforeCompile|GLSL/);
  // sterownik: krok efektów zgłasza warstwę DIST (flagę kasuje klatka efektów — zgłoszenie z update sterownika by przepadło)
  assert.match(src, /Core3D\.setDistortLayerActive\(true\)/);
  const nurt = code('src/3d/warp/warpNurt.js');
  assert.match(nurt, /this\.edge = new WarpEdgeFx\(\)\.attach\(Core3D\.scene\);/);
  assert.match(nurt, /this\._finishHulls\(\);\s*this\._commitEdge\(o, t, dt, camX, camY, zoom, hasPlayer\);/);
  assert.match(nurt, /c\.on = hasPlayer && o\.lensAllowed !== false;/);
  // linie przypięte innymi testami zostają
  assert.match(nurt, /Core3D\.setWarpLayerActive\(drawMedium\)/);
  assert.doesNotMatch(nurt, /setDistortLayerActive/, 'sterownik nie zgłasza DIST sam');
});

// ── wpięcie w sterownik (Core3D zaślepiony, bez GPU) ───────────────────────────────────────────────────────────────

test('sterownik: boki kadru tylko w skoku gracza (ładowanie, kop, lot, wyjście) — nie w hipercruisie ani bez soczewki; DIST z kroku', async () => {
  const { Core3D } = await import('../src/3d/core3d.js');
  const { WarpNurt } = await import('../src/3d/warp/warpNurt.js');
  const steps = [];
  let distCalls = 0;
  Core3D.isInitialized = true;
  Core3D.scene = new THREE.Scene();
  Core3D.width = 1600;
  Core3D.height = 900;
  Core3D.addFxStep = (s) => { steps.push(s); return s; };
  Core3D.setDistortLayerActive = (on) => { if (on) distCalls++; };
  WarpNurt.init({ count: 4096 });
  const edge = WarpNurt.edge;
  assert.ok(edge instanceof WarpEdgeFx);
  const step = steps.find((s) => s && s.name === 'warp: boki kadru');
  assert.ok(step && typeof step.update === 'function', 'krok efektów boków');
  for (const m of edge.warmupMeshes()) assert.equal(m.parent, Core3D.scene);
  const ship = { pos: { x: 5000, y: 0 }, x: 5000, y: 0, vel: { x: 0, y: 0 }, angle: -Math.PI / 2, w: 1800, h: 800 };
  const warp = { state: 'idle', charge: 0, chargeTime: 0.8, dir: { x: 0, y: -1 }, exitRamp: null };
  const cam = { x: 5000, y: -60, zoom: 0.1, roll: 0 };
  const o = { dt: 1 / 60, cam, camShake: cam, camFollow: true, ship, warp, hyper: null, lensAllowed: true, anchorSX: 0, anchorSY: 60 };
  const frame = () => { WarpNurt.update(o); step.update({}); };
  const D = WARP_EDGE_FX_DEFAULT;
  frame();
  assert.equal(edge.stats.on, false, 'bez skoku nic');
  assert.equal(edge.hazeMesh.visible || edge.dustMesh.visible || edge.auroraMesh.visible, false);
  // ładowanie: słabo
  warp.state = 'charging';
  for (let i = 0; i < 40; i++) { warp.charge = Math.min(0.8, warp.charge + 1 / 60); frame(); }
  assert.ok(edge.stats.on && edge.stats.strength > 0.15 && edge.stats.strength <= WARP_EDGE_ENVELOPE.chargeLevel + 1e-9, `ładowanie ${edge.stats.strength}`);
  // kop: impuls
  warp.state = 'active';
  let peak = 0;
  for (let i = 0; i < 12; i++) { frame(); peak = Math.max(peak, edge.stats.strength); }
  assert.ok(peak > 1.4, `kop ${peak}`);
  // lot: siła 1, widoczność wg przełącznika domyślnego, VP nad statkiem na osi kursu, warstwa DIST zgłoszona z kroku
  for (let i = 0; i < 60; i++) frame();
  assert.ok(near(edge.stats.strength, 1, 1e-6), `lot ${edge.stats.strength}`);
  assert.equal(edge.hazeMesh.visible, D.haze);
  assert.equal(edge.dustMesh.visible, D.czastki);
  assert.equal(edge.auroraMesh.visible, D.zorza);
  assert.equal(edge.stats.vpOk, true);
  assert.ok(Math.abs(edge.stats.vpX) <= 1 && edge.stats.vpY < -200, `VP ${edge.stats.vpX}, ${edge.stats.vpY}`);
  const before = distCalls;
  frame();
  assert.equal(distCalls - before, D.haze ? 1 : 0, 'warstwa DIST z kroku efektów');
  // wymuszenie ze strojenia (na żywo) — bez haze warstwa DIST nie idzie
  WarpEdgeFxTune.haze = false;
  WarpEdgeFxTune.zorza = true;
  const b2 = distCalls;
  frame();
  assert.equal(edge.hazeMesh.visible, false);
  assert.equal(edge.auroraMesh.visible, true);
  assert.equal(distCalls, b2);
  WarpEdgeFxTune.haze = null;
  WarpEdgeFxTune.zorza = null;
  // kamera bez soczewki (podzielony ekran, kamery 3D) — wyłączone
  o.lensAllowed = false;
  frame();
  assert.equal(edge.stats.on, false);
  assert.equal(edge.hazeMesh.visible || edge.dustMesh.visible || edge.auroraMesh.visible, false);
  o.lensAllowed = true;
  frame();
  assert.equal(edge.stats.on, true);
  // klatka bez update sterownika (WarpNurt.enabled = false, tło menu) — krok chowa siatki
  step.update({});
  assert.equal(edge.hazeMesh.visible || edge.dustMesh.visible || edge.auroraMesh.visible, false);
  assert.equal(edge.distLive, false);
  // wyjście: rampa gry → front smug gwiazd, gaśnie
  warp.state = 'idle';
  warp.exitRamp = { active: true, age: 0, slow: 0.7, coast: 0.45, brake: 0.2, vArr: 16000, v0: 16000, tBrake: 1.15, tHalt: 1.35 };
  frame();
  assert.equal(WarpNurt.player.mode, 'exit');
  assert.ok(edge.stats.on, 'wyjście — jeszcze widać');
  for (let i = 0; i < 70; i++) { warp.exitRamp.age += 1 / 60; frame(); }
  assert.equal(edge.stats.on, false, 'po froncie i ogonie wyjścia nic');
  warp.exitRamp = null;
  // hipercruise (ten sam efekt skoku w WarpPlayerFx) — boki kadru nie
  o.hyper = { state: 'active', charge: 1, chargeTime: 4, speed: 30000, dir: -Math.PI / 2 };
  for (let i = 0; i < 90; i++) frame();
  assert.equal(WarpNurt.player.hyper, true);
  assert.equal(edge.stats.on, false, 'hipercruise bez efektów boków');
  o.hyper = null;
});
