// Boki kadru w skoku gracza (src/3d/warp/warpEdgeFx.js, 2026-10-29 — haze DIST, drobiny pędu, zorza krawędzi), PRZEPŁYW
// RÓWNOLEGŁY DO KURSU (druga wersja — bez punktu zbiegu): obwiednia siły (fazy, kop, lot przy mijanym ciele, wyjście z frontem
// smug gwiazd, hipercruise = 0), przełącznik z adresu (`?warpFx=`), układ kadru i maska czystej kolumny (lustra CPU),
// całkowanie fazy z limitem aliasingu i długość smug bez stroboskopu, WGSL trzech materiałów zbudowany w Node (bez GPU,
// bez biegunowych i bez NaN-owych operacji), uniformy skończone przy skrajnych wejściach, kolumna z zoomu bieżącej klatki,
// kamera „Północ” (kolumna i zasięg drobin z rozpiętości kadru w poprzek kursu), fazy przeskalowane przy zmianie skali
// renderu, lustro CPU fragmentu W1 na teksturze tile2D z mipmapami (gładko — bez fałd obrazu), strażnik szwu (bez Math.random,
// window, DOM, importów src/game i bez zależności od soczewki O1) i wpięcie w sterownik WarpNurt (fazy skoku z automatu
// gry, hipercruise, kamera bez soczewki, warstwa DIST zgłaszana z kroku efektów, siatki chowane bez klatki sterownika).
// node --test tests/warpEdgeFx.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  WarpEdgeFx, WarpEdgeFxTune, WARP_EDGE_FX_DEFAULT, WARP_EDGE_ENVELOPE, WARP_EDGE_FAR_DEPTH, WARP_EDGE_RENDER_ORDER,
  WARP_EDGE_PHASE_WRAP, parseWarpEdgeFx, newWarpEdgeFxSwitch, warpEdgeEnvelope, newWarpEdgeEnvelope, warpEdgeLayout,
  newWarpEdgeLayout, warpEdgeSideMask, warpEdgePhaseStep, warpEdgeStreakLen
} from '../src/3d/warp/warpEdgeFx.js';
import * as EdgeModule from '../src/3d/warp/warpEdgeFx.js';
import { warpExitFrontS } from '../src/render/warpLensPhase.js';
import { FX_DISTORT_LAYER } from '../src/3d/fx/fxFrame.js';
import { bakeTile2D } from '../src/3d/fx/noise.js';
import { WARP_LENS_SHARED } from '../src/3d/warp/worldLens.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const env = (s) => warpEdgeEnvelope(s, newWarpEdgeEnvelope());
const UP = -Math.PI / 2;   // kurs w górę ekranu (osie ekranu y w dół)

// ── obwiednia siły ─────────────────────────────────────────────────────────────────────────────────────────────────

test('obwiednia: ładowanie — rozruch od 0, słabo; kop × 2 przez ~0,6 s; lot = 1 × prędkość widoczna; hipercruise 0', () => {
  const E = WARP_EDGE_ENVELOPE;
  assert.equal(env(null).strength, 0);
  for (const mode of ['charging', 'warp', 'exit']) {
    const e = env({ mode, charge: 1, kickAge: 3, exitAge: 0.1, exitSlow: 0.7, flowRatio: 1, hyper: true });
    assert.equal(e.strength, 0, `hipercruise (${mode}) bez efektów boków`);
    assert.equal(e.speed, 0);
  }
  // ładowanie: siła i przepływ od zera, monotonicznie, najwyżej chargeLevel / chargeSpeed
  const c0 = env({ mode: 'charging', charge: 0 });
  assert.equal(c0.strength, 0);
  assert.equal(c0.speed, 0, 'rozruch od 0');
  let prev = -1;
  let prevV = -1;
  for (let c = 0; c <= 1.0001; c += 0.02) {
    const e = env({ mode: 'charging', charge: c });
    assert.ok(e.strength >= prev - 1e-12 && e.speed >= prevV - 1e-12, `ładowanie ${c}`);
    prev = e.strength;
    prevV = e.speed;
  }
  assert.ok(near(env({ mode: 'charging', charge: 1 }).strength, E.chargeLevel));
  assert.ok(near(env({ mode: 'charging', charge: 1 }).speed, E.chargeSpeed));
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
  // lot przy mijanym ciele (statek zwalnia — przepływ widoczny niższy): słabiej i wolniej, nie znika
  const fly = env({ mode: 'warp', kickAge: 5, flowRatio: 0.3 });
  assert.ok(near(fly.strength, E.flybyFloor + (1 - E.flybyFloor) * 0.3));
  assert.ok(near(fly.speed, 0.3));
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
  assert.ok(env({ mode: 'exit', exitAge: 0, exitSlow: slow }).frontS > 0, 'front startuje przed dziobem');
  assert.ok(env({ mode: 'exit', exitAge: slow, exitSlow: slow }).frontS < 0, '… i kończy za rufą');
  assert.equal(env({ mode: 'idle', charge: 0 }).strength, 0);
  assert.ok(env({ mode: 'idle', charge: 0.6 }).strength > 0, 'przerwane ładowanie gaśnie z ładowaniem');
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
  // 2026-10-29 (user po grze: „haze wciąż zbyt subtelny”): domyślnie także mgła boków (W3)
  assert.deepEqual([D.haze, D.czastki, D.zorza], [true, true, true], 'domyślnie W1 + W2 + W3');
  // ?warpHaze= — mnożnik siły haze i mgły, niezależnie od warpFx
  const g = (s) => parseWarpEdgeFx(s, newWarpEdgeFxSwitch()).gain;
  assert.equal(g(''), 1);
  assert.equal(g('?warpHaze=2'), 2);
  assert.equal(g('?warpFx=haze&warpHaze=1,5'), 1.5);
  assert.equal(g('?warpHaze=0'), 0);
  assert.equal(g('?warpHaze=99'), EdgeModule.WARP_EDGE_GAIN_MAX);
  assert.equal(g('?warpHaze=duzo'), 1);
  assert.equal(g('?warpHaze=-2'), 1, 'liczba ujemna — nie liczba w adresie (zostaje 1)');
});

// ── układ kadru i maska kolumny ────────────────────────────────────────────────────────────────────────────────────

test('układ: kurs w osiach ekranu, poprzeczna w prawo, oś kursu przez statek, pół-zasięgi kadru; kolumna z szerokości kadłuba', () => {
  const W = 1920;
  const H = 1080;
  // kurs w górę, statek 30 px w prawo i 120 px pod środkiem (y w górę)
  const L = warpEdgeLayout(UP, 30, -120, W, H, 20);
  assert.ok(near(L.cx, 0, 1e-12) && near(L.cy, 1, 1e-12), 'kurs w górę');
  assert.ok(near(L.nx, 1, 1e-12) && near(L.ny, 0, 1e-12), 'poprzeczna w prawo');
  assert.ok(near(L.lAxis, 30, 1e-9) && near(L.aShip, -120, 1e-9));
  assert.ok(near(L.aExt, H / 2, 1e-9) && near(L.lExt, W / 2, 1e-9));
  assert.equal(L.R, W / 2);
  // kolumna: max(2,5 × pół szerokości kadłuba, 8% szerokości kadru), najwyżej 30% — kamera dalej, kadłub mały
  assert.ok(near(L.clear, 0.08 * W), `kolumna ${L.clear}`);
  assert.ok(near(warpEdgeLayout(UP, 0, 0, W, H, 100).clear, 250), 'duży kadłub na ekranie — 2,5 × pół szerokości');
  assert.ok(near(warpEdgeLayout(UP, 0, 0, W, H, 1000).clear, 0.3 * W), 'sufit kolumny');
  // kurs skośny (kadr „Północ”): zasięgi to rzut prostokąta kadru, R stałe (obrót nie przetasowuje drobin)
  const D = warpEdgeLayout(-Math.PI / 4, 0, 0, W, H, 20);
  assert.ok(near(D.aExt, (W / 2 + H / 2) * Math.SQRT1_2, 1e-6) && near(D.lExt, D.aExt, 1e-6));
  assert.equal(D.R, L.R);
  assert.ok(near(Math.hypot(D.cx, D.cy), 1, 1e-12) && near(D.cx * D.nx + D.cy * D.ny, 0, 1e-12), 'baza ortonormalna');
  // kurs w prawo ekranu: poprzeczna w dół (prawa burta)
  const R = warpEdgeLayout(0, 0, 0, W, H, 20);
  assert.ok(near(R.cx, 1, 1e-12) && near(R.nx, 0, 1e-12) && near(R.ny, -1, 1e-12));
  // brak sensownych wejść — liczby skończone
  const X = warpEdgeLayout(NaN, NaN, NaN, 0, 0, NaN, WarpEdgeFxTune, newWarpEdgeLayout());
  for (const k of Object.keys(X)) assert.ok(Number.isFinite(X[k]), `układ ${k}`);
});

test('maska: 0 w kolumnie osi kursu (statek, punkt przed dziobem), rośnie ku krawędzi po tej stronie osi, front wyjścia czyści', () => {
  const W = 1920;
  const H = 1080;
  const L = warpEdgeLayout(UP, 0, -120, W, H, 20);
  const m = (l, a = 0) => warpEdgeSideMask(l, a, L);
  assert.equal(m(0), 0, 'oś kursu');
  assert.equal(m(0, 900), 0, 'oś kursu daleko przed dziobem');
  assert.equal(m(L.clear * 0.99), 0, 'w kolumnie');
  assert.ok(m(L.clear * 2) > 0, 'za kolumną już coś');
  let prev = -1;
  for (let l = 0; l <= W / 2; l += 16) { const v = m(l); assert.ok(v >= prev - 1e-12, `rośnie ku krawędzi (${l})`); prev = v; }
  assert.ok(m(W / 2 - 5) > 0.98 && m(-(W / 2 - 5)) > 0.98, 'pełna przy obu krawędziach');
  assert.ok(near(m(400), m(-400), 1e-12), 'symetrycznie przy osi w środku kadru');
  // oś przesunięta w prawo: prawa strona bliżej krawędzi — pełna siła wcześniej
  const S = warpEdgeLayout(UP, 300, 0, W, H, 20);
  assert.ok(warpEdgeSideMask(500, 0, S) > warpEdgeSideMask(-500, 0, S));
  // front wyjścia 100 px przed statkiem: przed nim czysto, za nim bez zmian
  assert.ok(warpEdgeSideMask(900, 400, L, 1, 100, 60) < 1e-9, 'przed frontem');
  assert.ok(near(warpEdgeSideMask(900, -200, L, 1, 100, 60), m(900, -200)), 'za frontem');
});

// ── fazy i smugi ───────────────────────────────────────────────────────────────────────────────────────────────────

test('faza: całkowana prędkość · dt, pauza i przerwa bez przyrostu, limit aliasingu (≤ ¼ komórki na klatkę przy 60 kl/s), zawijanie bez skoku', () => {
  assert.ok(near(warpEdgePhaseStep(10, 600, 0.5 / 60 * 2), 10 + 600 * (1 / 60)), 'faza += v · dt');
  assert.equal(warpEdgePhaseStep(10, 600, 0), 10, 'pauza');
  assert.equal(warpEdgePhaseStep(10, 600, -0.01), 10);
  assert.equal(warpEdgePhaseStep(10, 600, 0.3), 10, 'przerwa ≥ 0,25 s — bez przyrostu');
  assert.equal(warpEdgePhaseStep(10, -50, 1 / 60), 10, 'wzór płynie tylko w dół (v ≥ 0)');
  // limit: komórka 100 px, aliasK 15 → najwyżej 1500 px/s → ¼ komórki na klatkę przy 60 kl/s
  const cell = 100;
  for (const v of [100, 1000, 1500, 5000, 1e6]) {
    const d = warpEdgePhaseStep(0, v, 1 / 60, cell, 15, Infinity);
    assert.ok(d <= 0.25 * cell + 1e-9, `v ${v}: ${d} px na klatkę`);
  }
  assert.ok(near(warpEdgePhaseStep(0, 1000, 1 / 60, cell, 15, Infinity), 1000 / 60), 'pod limitem bez zmian');
  // zawijanie co okres wzoru: faza w [0, wrap), krok przez granicę = ten sam przyrost modulo okres
  const wrap = 864;
  let ph = 0;
  for (let i = 0; i < 500; i++) {
    const nx = warpEdgePhaseStep(ph, 2000, 1 / 60, Infinity, 15, wrap);
    assert.ok(nx >= 0 && nx < wrap);
    const dd = ((nx - ph) % wrap + wrap) % wrap;
    assert.ok(near(dd, 2000 / 60, 1e-6), `przyrost ${dd}`);
    ph = nx;
  }
  // zmiana prędkości nie przestawia fazy (ciągłość — „gotowanie się” wzoru przy czas × prędkość w shaderze)
  const a = warpEdgePhaseStep(1234, 100, 1 / 60);
  const b = warpEdgePhaseStep(1234, 3000, 1 / 60);
  assert.ok(Math.abs(b - a) <= 3000 / 60 + 1e-9);
  assert.ok(WARP_EDGE_PHASE_WRAP >= 2 ** 20);
});

test('smugi: długość z prędkością, nie krótsza niż przesuw na klatkę × 1,3 (bez stroboskopu), najwyżej zapas zawijania', () => {
  assert.ok(near(warpEdgeStreakLen(200, 1, 0, 0, 1e9), 200), 'lot');
  assert.ok(near(warpEdgeStreakLen(200, 0, 0, 0, 1e9), 120), 'stoi — 0,6 długości');
  assert.ok(near(warpEdgeStreakLen(200, 3, 0, 0, 1e9), 280), 'kop — najwyżej 1,4');
  const v = 6 * 1080;   // bliska warstwa w kopie [px/s]
  for (const dt of [1 / 240, 1 / 60, 1 / 30]) {
    const len = warpEdgeStreakLen(200, 2, v, dt, 1e9);
    assert.ok(len >= v * dt * 1.3 - 1e-9, `dt ${dt}: smuga ${len} < przesuw ${v * dt}`);
  }
  assert.ok(warpEdgeStreakLen(200, 2, v, 1 / 20, 432) <= 432, 'zapas zawijania');
  // domyślne strojenie: bliska warstwa przy 60 kl/s w kopie — smuga dłuższa niż przesuw
  const T = WarpEdgeFxTune;
  const vNear = 2 * T.dustSpeedNear * 1080;
  assert.ok(T.dustLenNear * 0.7 >= vNear / 60, 'najkrótsza bliska smuga ≥ przesuw na klatkę w kopie (60 kl/s)');
  assert.ok(T.dustLenFar < T.dustLenMid && T.dustLenMid < T.dustLenNear, 'paralaksa: daleka krótka, bliska długa');
  assert.ok(T.dustSpeedFar < T.dustSpeedMid && T.dustSpeedMid < T.dustSpeedNear, 'paralaksa: daleka wolna, bliska szybka');
  assert.ok(T.dustBrightFar < T.dustBrightMid && T.dustBrightMid < T.dustBrightNear && T.dustBrightNear <= 0.28, 'jasność');
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

test('WGSL: trzy materiały w limitach, bez biegunowych (atan, log) i bez pow; haze B = A = 0, próbki z poziomem; drobiny i zorza pod planetami', () => {
  const fx = new WarpEdgeFx();
  const out = {};
  for (const mesh of fx.warmupMeshes()) {
    const w = buildMesh(mesh);
    out[mesh.name] = w;
    for (const s of [w.vertex, w.fragment]) {
      assert.ok(uniformBuffers(s) <= 12, `${mesh.name}: bufory uniformów`);
      assert.doesNotMatch(s, /\bpow\(|\blog\(|\blog2\(|\batan2?\(|inverseSqrt\(/, `${mesh.name}: bez pow / log / atan (NaN, punkt zbiegu)`);
      // pierwiastek tylko z fract (≥ 0)
      for (const m of s.matchAll(/\bsqrt\( ?([^)]*)/g)) assert.match(m[1], /^fract\(/, `${mesh.name}: sqrt z ${m[1]}`);
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
  // W1: warstwa DIST, One / One także w alfie, przesunięcie w RG, B = A = 0 (maskowanie), próbki w gałęzi z poziomem
  const haze = out['warp:hazeBokow'];
  assert.equal(fx.hazeMesh.layers.mask, 1 << FX_DISTORT_LAYER);
  assert.equal(fx.hazeMesh.material.depthTest, false);
  assert.equal(fx.hazeMesh.material.blendSrc, THREE.OneFactor);
  assert.equal(fx.hazeMesh.material.blendDst, THREE.OneFactor);
  assert.equal(fx.hazeMesh.material.blendSrcAlpha, THREE.OneFactor);
  assert.equal(fx.hazeMesh.material.blendDstAlpha, THREE.OneFactor);
  assert.match(haze.fragment, /output\.color = vec4<f32>\( nodeVar\d+, 0\.0, 0\.0 \);/);
  assert.equal((haze.fragment.match(/textureSampleLevel\(/g) || []).length, 2, 'dwie oktawy');
  assert.doesNotMatch(haze.fragment, /textureSample\(/, 'bez próbki z pochodnymi w gałęzi per piksel');
  assert.match(haze.vertex, /vec4<f32>\( position\.xy, 0\.5, 1\.0 \)/, 'quad pełnoekranowy w klipie');
  // W2 / W3: pass tła (warstwa 1, kolejka ≥ 0 — okno (−0,5; 0) należy do pasa), głębia przy dalekiej płaszczyźnie, alfa 0
  for (const [name, mesh] of [['warp:drobinyBokow', fx.dustMesh], ['warp:zorzaKrawedzi', fx.auroraMesh]]) {
    assert.equal(mesh.layers.mask, 1 << 1, `${name}: warstwa 1`);
    assert.ok(mesh.renderOrder >= 0, `${name}: renderOrder ${mesh.renderOrder}`);
    assert.equal(mesh.material.depthTest, true);
    assert.match(out[name].vertex, new RegExp(`${String(WARP_EDGE_FAR_DEPTH).replace('.', '\\.')}, 1\\.0 \\)`));
    assert.match(out[name].fragment, /output\.color = vec4<f32>\([\s\S]*, 0\.0 \);\s*return output;/);
  }
  assert.ok(WARP_EDGE_RENDER_ORDER >= 0);
  // W2: jedna siatka z instancjami (bez atrybutów instancji), trzy warstwy z indeksu instancji
  assert.equal(fx.dustMesh.geometry.isInstancedBufferGeometry, true);
  assert.equal(fx.dustMesh.isInstancedMesh, undefined);
  const T = WarpEdgeFxTune;
  assert.equal(fx.dustMesh.geometry.instanceCount, T.dustFar + T.dustMid + T.dustNear);
  assert.ok(fx.dustMesh.geometry.instanceCount >= 2);
  assert.match(out['warp:drobinyBokow'].vertex, /@builtin\( instance_index \)/);
  assert.equal(Object.keys(fx.dustMesh.geometry.attributes).length, 1, 'bez atrybutów instancji — sam kwad');
  // W3: geometria tylko przy krawędziach (dwa pasy, 8 wierzchołków)
  assert.equal(fx.auroraMesh.geometry.getAttribute('position').count, 8);
});

test('uniformy skończone i dzielniki dodatnie przy skrajnych wejściach (kadr 2 px, zoom ~0, pauza, brak kadłuba)', () => {
  const fx = new WarpEdgeFx();
  const player = { mode: 'warp', charge: 1, kickT: 0, exitT: -1e9, ramp: { slow: 0.7 }, flowGear: 21000, hyper: false, angle: -Math.PI / 2 };
  const cases = [
    { W: 2, H: 2, zoom: 1e-12, dt: 0, hullWidth: 0, shipX: 0, shipY: 0 },
    { W: 5120, H: 1440, zoom: 0.1, dt: 1 / 240, hullWidth: 800, shipX: 300, shipY: -9000 },
    { W: 1600, H: 900, zoom: 5, dt: 0.1, hullWidth: NaN, shipX: NaN, shipY: 1e9 }
  ];
  for (const c of cases) {
    fx.update({ on: true, t: 2, player, roll: 0.3, palette: 'magenta', ...c });
    assert.equal(fx.stats.on, true);
    for (const [k, u] of Object.entries(fx.U)) {
      const v = u.value;
      const nums = typeof v === 'number' ? [v] : [v.x, v.y, v.z, v.w].filter((x) => x !== undefined);
      for (const x of nums) assert.ok(Number.isFinite(x), `uniform ${k} = ${x} (${JSON.stringify(c)})`);
    }
    const U = fx.U;
    for (const d of [U.haze1.value.x, U.haze1.value.y, U.haze2.value.x, U.haze2.value.y, U.dustPh.value.w, U.aurora.value.z, U.aurora.value.w, U.band.value]) {
      assert.ok(d >= 1, `dzielnik ${d}`);
    }
  }
});

test('kolumna z BIEŻĄCEGO zoomu: kamera odsuwa się po kopie (kadr lotu) — kadłub na ekranie mniejszy, kolumna węższa, nie mniej niż 8% kadru', () => {
  const fx = new WarpEdgeFx();
  const player = { mode: 'warp', charge: 1, kickT: 0, exitT: -1e9, ramp: { slow: 0.7 }, flowGear: 21000, hyper: false, angle: UP };
  const W = 1920;
  const clearAt = (zoom) => {
    fx.update({ on: true, t: 5, dt: 1 / 60, player, roll: 0, palette: '', W, H: 1080, zoom, shipX: 0, shipY: 0, hullWidth: 400 });
    return fx.stats.clear;
  };
  const T = WarpEdgeFxTune;
  const half = (zoom) => 0.5 * 400 * T.hullWidth * zoom;
  assert.ok(near(clearAt(1), Math.min(T.colMaxW * W, T.colHullK * half(1))), 'bliski kadr — kolumna z kadłuba');
  assert.ok(near(clearAt(0.6), T.colHullK * half(0.6)), 'kadr odsuwa się — kolumna maleje z zoomem tej klatki');
  assert.ok(near(clearAt(0.1), T.colMinW * W), 'daleki kadr — dolna granica 8% szerokości');
});

test('kamera „Północ” (bez obrotu kadru), kurs wschód–zachód na 32:9: kolumna i zasięg drobin z rozpiętości kadru W POPRZEK kursu', () => {
  const T = WarpEdgeFxTune;
  // kurs w prawo ekranu: w poprzek kursu leży wysokość kadru (1440), nie szerokość (5120)
  const L = warpEdgeLayout(0, 0, 0, 5120, 1440, 20);
  assert.ok(near(L.lExt, 720, 1e-9) && near(L.aExt, 2560, 1e-9));
  assert.ok(L.clear <= 0.3 * L.lExt, `kolumna ${L.clear} przy pół-zasięgu w poprzek ${L.lExt}`);
  assert.ok(near(L.clear, T.colMinW * 1440, 1e-9), 'dolna granica kolumny z rozpiętości w poprzek kursu');
  assert.ok(L.reach > L.clear && L.reach <= L.lExt + Math.abs(L.lAxis) + 1e-9, `drobiny w poprzek do ${L.reach} px`);
  assert.ok(near(L.reach, 720, 1e-9), 'drobiny do krawędzi kadru w poprzek kursu, nie do R (2560) — poza kadrem');
  // statek 200 px nad środkiem (y w górę): zasięg do DALSZEJ krawędzi w poprzek
  assert.ok(near(warpEdgeLayout(0, 0, 200, 5120, 1440, 20).reach, 920, 1e-9));
  // kurs w górę (domyślny kadr skoku) — jak dotąd: szerokość ekranu
  const Up = warpEdgeLayout(UP, 0, 0, 5120, 1440, 20);
  assert.ok(near(Up.clear, T.colMinW * 5120, 1e-9));
  assert.ok(near(Up.reach, 2560, 1e-9));
  // ciągłość w kącie kursu (obrót kadru w ładowaniu): kolumna i zasięg bez skoków (ograniczenie Lipschitza rzutu kadru)
  const step = Math.PI / 180;
  const lip = (5120 + 1440) * 0.5 * step;
  let prev = null;
  for (let a = UP; a <= step * 0.5; a += step) {
    const X = warpEdgeLayout(a, 0, 0, 5120, 1440, 20);
    if (prev) {
      assert.ok(Math.abs(X.reach - prev.reach) <= lip + 1e-9, `zasięg skacze przy ${a}`);
      assert.ok(Math.abs(X.clear - prev.clear) <= 2 * T.colMaxW * lip + 1e-9, `kolumna skacze przy ${a}`);
    }
    prev = { reach: X.reach, clear: X.clear };
  }
  // sterownik efektu: uniformy kolumny i zasięgu drobin z tego układu
  const fx = new WarpEdgeFx();
  const player = { mode: 'warp', charge: 1, kickT: 0, exitT: -1e9, ramp: { slow: 0.7 }, flowGear: 21000, hyper: false, angle: 0 };
  fx.update({ on: true, t: 5, dt: 1 / 60, player, roll: 0, palette: '', W: 5120, H: 1440, zoom: 0.05, shipX: 0, shipY: 0, hullWidth: 800 });
  assert.ok(near(fx.U.column.value.x, T.colMinW * 1440, 1e-9), `kolumna ${fx.U.column.value.x}`);
  assert.ok(near(fx.U.dustReach.value, 720, 1e-9), `zasięg drobin ${fx.U.dustReach.value}`);
  assert.ok(near(fx.U.frame.value.x, 720, 1e-9), 'pół-zasięg w poprzek dla maski');
  assert.ok(near(fx.U.dustPh.value.w, 2 * (2560 + 0.4 * 1440), 1e-9), 'zawijanie wzdłuż kursu z R (bez zależności od kąta)');
});

test('skala renderu w locie (rozdzielczość dynamiczna, DPR, okno): fazy przeskalowane — faza / kafelek i faza / rozpiętość bez skoku', () => {
  const fx = new WarpEdgeFx();
  const player = { mode: 'warp', charge: 1, kickT: 0, exitT: -1e9, ramp: { slow: 0.7 }, flowGear: 21000, hyper: false, angle: UP };
  const frame = (W, H, dt, t) => fx.update({ on: true, t, dt, player, roll: 0, palette: '', W, H, zoom: 0.05, shipX: 0, shipY: 0, hullWidth: 800 });
  for (let i = 0; i < 40; i++) frame(1600, 900, 1 / 60, 5 + i / 60);
  const U = fx.U;
  const ratios = () => ({
    haze1: U.haze1.value.z / U.haze1.value.y,
    haze2: U.haze2.value.z / U.haze2.value.y,
    zorza: U.auroraPh.value / U.aurora.value.w,
    daleka: U.dustPh.value.x / U.dustPh.value.w,
    srednia: U.dustPh.value.y / U.dustPh.value.w,
    bliska: U.dustPh.value.z / U.dustPh.value.w
  });
  const a = ratios();
  for (const [k, v] of Object.entries(a)) assert.ok(v > 0 && v < 1, `${k}: faza ruszyła i bez zawinięcia (${v})`);
  // skala renderu 0,85 (1600 × 900 → 1360 × 765), klatka bez przyrostu czasu — wzór stoi
  frame(1360, 765, 0, 5 + 40 / 60);
  const b = ratios();
  for (const k of Object.keys(a)) assert.ok(near(a[k], b[k], 1e-9), `${k}: ${a[k]} → ${b[k]} (skok wzoru przy zmianie skali)`);
  assert.ok(near(U.dustPh.value.w, 2 * (1360 / 2 + 0.4 * 765), 1e-9), 'rozpiętość zawijania z nowego kadru');
  // dalej wzór płynie w nowych px: bliska warstwa + 3 H/s · dt
  const p0 = U.dustPh.value.z;
  frame(1360, 765, 1 / 60, 5 + 41 / 60);
  assert.ok(near(U.dustPh.value.z - p0, WarpEdgeFxTune.dustSpeedNear * 765 / 60, 1e-6));
  // sama szerokość (okno węższe, ta sama wysokość): haze bez zmian, drobiny z rozpiętością
  const c0 = ratios();
  frame(1200, 765, 0, 5 + 41 / 60);
  const c1 = ratios();
  for (const k of Object.keys(c0)) assert.ok(near(c0[k], c1[k], 1e-9), `${k}: zmiana szerokości okna`);
  // wyłączenie zapomina skalę (nowy skok — fazy od zera)
  fx.off();
  assert.equal(fx._phH, 0);
  assert.equal(fx._phSpan, 0);
});

// ── W1: lustro CPU pola przesunięcia (fałdy obrazu) ────────────────────────────────────────────────────────────────

// tile2D jak na GPU: mipmapy = średnia 2 × 2 (three r183 WebGPU — blit z próbką liniową), próbka trójliniowa z zawijaniem
const TILE = 256;
const tileData = bakeTile2D(TILE);
const mipChain = (ch) => {
  const out = [];
  let s = TILE;
  let a = new Float32Array(s * s);
  for (let i = 0; i < s * s; i++) a[i] = tileData[i * 4 + ch] / 255;
  out.push({ s, a });
  while (s > 1) {
    const n = s >> 1;
    const b = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = 2 * y * s + 2 * x;
        b[y * n + x] = 0.25 * (a[i] + a[i + 1] + a[i + s] + a[i + s + 1]);
      }
    }
    out.push({ s: n, a: b });
    a = b;
    s = n;
  }
  return out;
};
const TEX_R = mipChain(0);
const TEX_G = mipChain(1);
function bilinear(lv, u, v) {
  const s = lv.s;
  const x = u * s - 0.5;
  const y = v * s - 0.5;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const w = (k) => ((k % s) + s) % s;
  const x0 = w(xi), x1 = w(xi + 1), y0 = w(yi), y1 = w(yi + 1);
  const a = lv.a;
  return (a[y0 * s + x0] * (1 - fx) + a[y0 * s + x1] * fx) * (1 - fy) + (a[y1 * s + x0] * (1 - fx) + a[y1 * s + x1] * fx) * fy;
}
function sampleLevel(chain, level, u, v) {
  const l = Math.max(0, Math.min(chain.length - 1, level));
  const l0 = Math.floor(l);
  const f = l - l0;
  const a = bilinear(chain[l0], u, v);
  return f > 0 ? a * (1 - f) + bilinear(chain[Math.min(chain.length - 1, l0 + 1)], u, v) * f : a;
}
/** Fragment W1 (buildHazeMaterial) na CPU z uniformów klatki: punkt kadru (x w prawo, y w górę, od środka) → przesunięcie [px]. */
function hazeOffsetCpu(U, x, y, out) {
  const ax = U.axes.value;
  const fr = U.frame.value;
  const col = U.column.value;
  const hz = U.haze.value;
  const h1 = U.haze1.value;
  const h2 = U.haze2.value;
  const a = x * ax.x + y * ax.y;
  const l = x * ax.z + y * ax.w;
  const L = { lExt: fr.x, lAxis: fr.z, clear: col.x };
  const vw = U.view.value;
  const edgeD = Math.min(vw.x * 0.5 - Math.abs(x), vw.y * 0.5 - Math.abs(y));
  const ek = Math.max(0, Math.min(1, edgeD / (hz.x * 4 + 1)));
  const m = warpEdgeSideMask(l - fr.z, a - fr.w, L, col.z, col.w, U.band.value, col.y) * hz.x * ek * ek * (3 - 2 * ek);
  out[0] = 0; out[1] = 0;
  if (!(m > 1e-4)) return out;
  const u1 = l / h1.x;
  const v1 = (a + h1.z) / h1.y;
  const n1r = sampleLevel(TEX_R, hz.w, u1, v1);
  const n1g = sampleLevel(TEX_G, hz.w, u1, v1);
  const n2r = sampleLevel(TEX_R, h1.w, l / h2.x + 0.37, (a + h2.z) / h2.y);
  const lat = (n1r - 0.5) * 3.2 + (n2r - 0.5) * 3.2 * hz.z;
  const alo = (n1g - 0.5) * 3.2 * hz.y;
  out[0] = (ax.z * lat + ax.x * alo) * m;
  out[1] = (ax.w * lat + ax.y * alo) * m;
  return out;
}
/** Statystyki pola na siatce kadru: najmniejszy det(I − J) (≤ 0 — fałda: obraz zawija się, gwiazdy podwaja), gradient w poprzek kursu, |o|. */
function hazeFieldStats(U, W, H, stepPx = 5) {
  const o = [0, 0], ox = [0, 0], oy = [0, 0];
  const gl = [];
  const mag = [];
  let detMin = Infinity;
  let colMax = 0;
  let outside = 0;
  const ax = U.axes.value;
  const fr = U.frame.value;
  const clear = U.column.value.x;
  for (let y = -H / 2 + 0.5; y < H / 2; y += stepPx) {
    for (let x = -W / 2 + 0.5; x < W / 2; x += stepPx) {
      hazeOffsetCpu(U, x, y, o);
      // post próbkuje p − o: poza kadrem = powielony brzeg
      if (Math.abs(x - o[0]) > W / 2 + 0.5 || Math.abs(y - o[1]) > H / 2 + 0.5) outside++;
      const lRel = x * ax.z + y * ax.w - fr.z;
      if (Math.abs(lRel) < clear) { colMax = Math.max(colMax, Math.abs(o[0]), Math.abs(o[1])); continue; }
      hazeOffsetCpu(U, x + 1, y, ox);
      hazeOffsetCpu(U, x, y + 1, oy);
      const jxx = ox[0] - o[0], jxy = oy[0] - o[0], jyx = ox[1] - o[1], jyy = oy[1] - o[1];
      detMin = Math.min(detMin, (1 - jxx) * (1 - jyy) - jxy * jyx);
      // gradient przesunięcia poprzecznego w poprzek kursu (ściskanie / rozciąganie obrazu w bok)
      const gxx = (ax.z * jxx + ax.w * jyx) * ax.z + (ax.z * jxy + ax.w * jyy) * ax.w;
      gl.push(Math.abs(gxx));
      mag.push(Math.sqrt(o[0] * o[0] + o[1] * o[1]));
    }
  }
  const q = (arr, p) => { const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  return { detMin, gl99: q(gl, 0.99), mag50: q(mag, 0.5), magMax: q(mag, 1), colMax, outside, n: gl.length };
}

test('W1 gładko (lustro CPU fragmentu z uniformów klatki): bez fałd obrazu w locie i w kopie, gradient w poprzek ≪ 1, kilka px przesunięcia, 0 w kolumnie', () => {
  const fx = new WarpEdgeFx();
  const player = { mode: 'warp', charge: 1, kickT: 0, exitT: -1e9, ramp: { slow: 0.7 }, flowGear: 21000, hyper: false, angle: UP };
  const W = 1920;
  const H = 1080;
  // szczyt kopu (siła ~2, amplituda najwyżej × hazeKickMax) i lot; kilka faz wzoru (klatki co 0,4 s)
  let kickPeakT = 0;
  let best = 0;
  for (let k = 0.01; k < 0.6; k += 0.01) {
    const s = env({ mode: 'warp', kickAge: k, flowRatio: 1 }).strength;
    if (s > best) { best = s; kickPeakT = k; }
  }
  const run = (label, t, frames) => {
    let worst = null;
    for (let i = 0; i < frames; i++) {
      fx.update({ on: true, t: t + i * 0.4, dt: i ? 0.4 * 0.6 : 0, player, roll: 0, palette: '', W, H, zoom: 0.1, shipX: 0, shipY: 120, hullWidth: 1800 });
      const st = hazeFieldStats(fx.U, W, H);
      if (!worst || st.detMin < worst.detMin) worst = st;
      assert.ok(st.n > 1000, `${label}: próbki boków`);
      assert.equal(st.colMax, 0, `${label}: kolumna osi kursu czysta`);
      assert.equal(st.outside, 0, `${label}: próbka spoza kadru (powielony brzeg przy krawędzi)`);
      assert.ok(st.detMin > 0.2, `${label}: fałda obrazu — det(I − J) = ${st.detMin.toFixed(3)}`);
      // mocniejszy haze (2026-10-29: 28 px zamiast 8 — „wciąż zbyt subtelny”): obraz ściska się w bok wyraźnie, bez fałd
      assert.ok(st.gl99 < 0.75, `${label}: gradient w poprzek p99 ${st.gl99.toFixed(3)}`);
      assert.ok(st.mag50 > 6 && st.magMax < 72, `${label}: przesunięcie p50 ${st.mag50.toFixed(1)} px, max ${st.magMax.toFixed(1)} px`);
    }
    return worst;
  };
  run('lot', 5, 3);
  // kop: obwiednia liczy wiek kopu z t − kickT; jedna klatka na szczycie
  run('kop', kickPeakT, 1);
  // ?warpHaze=2 (WarpEdgeFxTune.gain — mnożnik): amplituda i komórki × 2 — przesunięcie ~× 2, gradient bez zmian (bez fałd)
  WarpEdgeFxTune.gain = 2;
  try {
    fx.update({ on: true, t: 5, dt: 0, player, roll: 0, palette: '', W, H, zoom: 0.1, shipX: 0, shipY: 120, hullWidth: 1800 });
    const st2 = hazeFieldStats(fx.U, W, H);
    assert.ok(st2.detMin > 0.2 && st2.gl99 < 0.75 && st2.mag50 > 12 && st2.outside === 0 && st2.colMax === 0,
      `×2: det ${st2.detMin.toFixed(2)}, gl99 ${st2.gl99.toFixed(2)}, p50 ${st2.mag50.toFixed(1)} px, poza ${st2.outside}`);
  } finally {
    WarpEdgeFxTune.gain = null;
  }
  // kontrola lustra: dawne nastawy pierwszej wersji v2 (drobne komórki, mip 1:1) dawały fałdy — lustro je widzi
  const T = WarpEdgeFxTune;
  const keep = { ...T };
  Object.assign(T, { hazeAmpPx: 10, hazeFine: 0.5, hazeCell1: 0.05, hazeStretch1: 8, hazeCell2: 0.02, hazeStretch2: 7, hazeLod1: 0, hazeLod2: 0 });
  try {
    fx.update({ on: true, t: 5, dt: 0, player, roll: 0, palette: '', W, H, zoom: 0.1, shipX: 0, shipY: 120, hullWidth: 1800 });
    assert.ok(hazeFieldStats(fx.U, W, H).detMin < 0, 'dawne nastawy — fałdy (kontrola czułości lustra)');
  } finally {
    Object.assign(T, keep);
  }
});

// ── strażnik szwu, losowości i niezależności od soczewki ───────────────────────────────────────────────────────────

test('moduł renderu: bez Math.random, window, GameState, DOM, importów src/game i bez zależności od soczewki O1 (hf, punkt zbiegu)', () => {
  const src = code('src/3d/warp/warpEdgeFx.js');
  assert.doesNotMatch(src, /Math\.random/);
  assert.doesNotMatch(src, /\bwindow\b/);
  assert.doesNotMatch(src, /GameState/);
  assert.doesNotMatch(src, /\bdocument\b|\blocation\b/);
  assert.doesNotMatch(src, /from '[^']*\/game\//, 'bez importów src/game (szew — sufit warpDrive.js wyczerpany)');
  assert.match(src, /RenderWorld\.pageSearch/);
  assert.doesNotMatch(src, /ShaderMaterial|onBeforeCompile|GLSL/);
  // przepływ równoległy do kursu — bez punktu zbiegu soczewki (przełącznik `?warpSoczewka=` zmienia hf)
  assert.doesNotMatch(src, /worldLens|WARP_LENS_SHARED|WORLD_LENS_DEFAULTS|warpViewEdgePx|\bhf\b|VanishPoint|\batan\b|\blog\b/);
  assert.equal('warpEdgeVanishPoint' in EdgeModule, false);
  // krok efektów zgłasza warstwę DIST (flagę kasuje klatka efektów — zgłoszenie z update sterownika by przepadło)
  assert.match(src, /Core3D\.setDistortLayerActive\(true\)/);
  const nurt = code('src/3d/warp/warpNurt.js');
  assert.match(nurt, /this\.edge = new WarpEdgeFx\(\)\.attach\(Core3D\.scene\);/);
  assert.match(nurt, /this\._finishHulls\(\);\s*this\._commitEdge\(o, t, dt, camX, camY, zoom, hasPlayer\);/);
  assert.match(nurt, /c\.on = hasPlayer && o\.lensAllowed !== false;/);
  assert.match(nurt, /c\.hullWidth = Number\(g\.width\) \|\| 0;/);
  assert.match(nurt, /Core3D\.setWarpLayerActive\(drawMedium\)/);
  assert.doesNotMatch(nurt, /setDistortLayerActive/, 'sterownik nie zgłasza DIST sam');
});

// ── wpięcie w sterownik (Core3D zaślepiony, bez GPU) ───────────────────────────────────────────────────────────────

test('sterownik: boki kadru tylko w skoku gracza (ładowanie, kop, lot, wyjście) — nie w hipercruisie ani bez soczewki; fazy z czasu gry; DIST z kroku', async () => {
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
  // ładowanie: słabo, drobiny już ruszają (rozruch)
  warp.state = 'charging';
  for (let i = 0; i < 40; i++) { warp.charge = Math.min(0.8, warp.charge + 1 / 60); frame(); }
  assert.ok(edge.stats.on && edge.stats.strength > 0.15 && edge.stats.strength <= WARP_EDGE_ENVELOPE.chargeLevel + 1e-9, `ładowanie ${edge.stats.strength}`);
  assert.ok(edge._ph.near > 0, 'rozruch drobin w ładowaniu');
  // kop: impuls
  warp.state = 'active';
  let peak = 0;
  for (let i = 0; i < 12; i++) { frame(); peak = Math.max(peak, edge.stats.strength); }
  assert.ok(peak > 1.4, `kop ${peak}`);
  // lot: siła 1, widoczność wg przełącznika domyślnego, kurs w górę → przepływ w dół, kolumna z kadłuba
  for (let i = 0; i < 60; i++) frame();
  assert.ok(near(edge.stats.strength, 1, 1e-6), `lot ${edge.stats.strength}`);
  assert.equal(edge.hazeMesh.visible, D.haze);
  assert.equal(edge.dustMesh.visible, D.czastki);
  assert.equal(edge.auroraMesh.visible, D.zorza);
  const ax = edge.U.axes.value;
  assert.ok(near(ax.x, 0, 1e-9) && near(ax.y, 1, 1e-9), `kurs na ekranie ${ax.x}, ${ax.y}`);
  assert.ok(edge.stats.clear >= 0.08 * 1600 - 1e-9, 'kolumna ≥ 8% szerokości kadru');
  // fazy z czasu gry: klatka 1/60 s → bliska warstwa + 3 H/s · dt; pauza (dt = 0) — bez ruchu
  const ph0 = edge._ph.near;
  frame();
  const expect = WarpEdgeFxTune.dustSpeedNear * 900 / 60;
  assert.ok(near(edge._ph.near - ph0, expect, 1e-6), `faza bliskiej ${edge._ph.near - ph0} ≠ ${expect}`);
  o.dt = 0;
  const ph1 = edge._ph.near;
  const h1 = edge._ph.h1;
  frame();
  assert.equal(edge._ph.near, ph1, 'pauza — drobiny stoją');
  assert.equal(edge._ph.h1, h1, 'pauza — haze stoi');
  o.dt = 1 / 60;
  // niezależność od pochylenia soczewki (`?warpSoczewka=` zmienia hf)
  const snap = () => JSON.stringify(Object.fromEntries(Object.entries(edge.U).filter(([k]) => !/dustPh|haze1|haze2|auroraPh/.test(k)).map(([k, u]) => [k, u.value])));
  o.dt = 0;
  frame();
  const before = snap();
  const hf0 = WARP_LENS_SHARED.params.hf;
  WARP_LENS_SHARED.params.hf = 2.5;
  frame();
  assert.equal(snap(), before, 'efekty nie zależą od hf soczewki');
  WARP_LENS_SHARED.params.hf = hf0;
  o.dt = 1 / 60;
  const b0 = distCalls;
  frame();
  assert.equal(distCalls - b0, D.haze ? 1 : 0, 'warstwa DIST z kroku efektów');
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
  assert.equal(edge.U.column.value.z, 1, 'front wyjścia');
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
