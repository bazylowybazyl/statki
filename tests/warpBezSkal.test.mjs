// SKOK BEZ SKAŁ (2026-10-27, decyzja użytkownika po teście nowego warpa: „asteroidy dalej mi się nie podobają — myślę
// żeby całkowicie wywalić”): skały pasa w skoku (dawne warpDebris.js / warpTrails.js / warpDeflector.js, wariant `smear`
// materiału skał) usunięte razem z kodem. Pas w skoku gracza nie jest rysowany — tryb skoku pasa tylko wyłącza pole;
// w ładowaniu pole i gaz przestrzeni gasną z β soczewki świata (puste przed kopem), po skoku wracają w
// WARP_FIELD_FADE.reveal s; hipercruise (Mk I–III, ≤ 40 tys. j/s) leci przez PRAWDZIWE pole (budżet komórek dzielony
// wagą zaległości, rośnie z prędkością). Olbrzymy jako impostory soczewki zostają (tests/warpLensAnchors.test.mjs).
// node --test tests/warpBezSkal.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsteroidBelt, warpFadeMinPx, beltLoadBudgetMs, BELT_LOAD_BOOST, ASTEROID_BELT_CONFIG } from '../src/3d/asteroids/asteroidBelt.js';
import { fadeLoadPx } from '../src/3d/asteroids/rockLayers.js';
import { WARP_STARS } from '../src/3d/warp/stars.js';
import { WARP_WORLD_LENS } from '../src/3d/warp/worldLens.js';
import { SpaceGas, SPACE_GAS_TUNE } from '../src/3d/spaceGas/spaceGas.js';
import { SPACE_GAS_IN, SPACE_GAS_SCENE } from '../src/3d/spaceGas/spaceGasLayout.js';
import { SpaceGasCover } from '../src/3d/spaceGas/spaceGasState.js';
import {
  WARP_LENS_PHASE, WARP_FIELD_FADE, warpFieldVisibility, stepWarpFieldFade, warpLensChargeBeta, warpLensKickBeta
} from '../src/render/warpLensPhase.js';
import { HYPERCRUISE_ENGINES, HYPERCRUISE_TUNE, WARP_DRIVES, WARP_DRIVE } from '../src/data/driveModes.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(m?js|html)$/.test(name)) out.push(p);
  }
  return out;
}

test('usunięte moduły skał skoku nie istnieją i nikt ich nie importuje ani nie woła', () => {
  for (const f of ['warpDebris.js', 'warpTrails.js', 'warpDeflector.js']) {
    assert.ok(!existsSync(join(ROOT, 'src/3d/asteroids', f)), `src/3d/asteroids/${f}`);
  }
  // Nazwy składane — ten plik sam siebie nie łapie (i tak jest pomijany).
  const names = ['warp' + 'Debris', 'Warp' + 'Debris', 'WARP_' + 'DEBRIS', 'Warp' + 'TrailBatch', 'WARP_' + 'TRAIL',
    'warp' + 'Trails', 'warp' + 'Deflector', 'setWarp' + 'Deflector', 'rocks' + 'Smear', 'WarpBelt' + 'Track', 'warpBelt' + 'Profile'];
  const re = new RegExp(`\\b(?:${names.join('|')})\\b`);
  const files = ['src', 'dema', 'scripts', 'tests'].flatMap((d) => walk(join(ROOT, d))).concat([join(ROOT, 'index.html')]);
  const hits = [];
  for (const p of files) {
    if (p === SELF) continue;
    const src = readFileSync(p, 'utf8');
    if (re.test(src)) hits.push(relative(ROOT, p));
    // wariant smugi materiału skał i przełączniki adresu dawnych skał
    if (/RockNodeMaterial\(\{[^}]*\bsmear\b/.test(src) || /[?&]smugi=|deflektor=0|'deflektor'/.test(src)) hits.push(`${relative(ROOT, p)} (smear / ?smugi / ?deflektor)`);
  }
  assert.deepEqual(hits, []);
  // RockSet bez dawnego LOD z rozmycia skał skoku, materiał skał bez wariantu smugi
  assert.doesNotMatch(read('src/3d/asteroids/rockLayers.js'), /lodExtra/);
  assert.doesNotMatch(read('src/3d/asteroids/rockMaterial.js'), /\bsmear\b|vRockSmear/);
});

test('tryb skoku pasa niczego nie rysuje: gałąź tylko wyłącza pole (bez kroku skał, bez rozgrzewki skał skoku)', () => {
  const src = read('src/3d/asteroids/asteroidBelt.js');
  assert.match(src, /if \(viewOk && this\._warpMode\) \{\s*this\._deactivate\(\);\s*this\._frameActive = false;\s*this\.stats\.cpuMs = performance\.now\(\) - t0;\s*return;\s*\}/);
  assert.doesNotMatch(src, /_warpStep|fxDistortion|WARIANT_INSTANCJI/);
  assert.match(src, /promises\.push\(run\('pas asteroid: skały, minerały, mgła, burza, iskry \(passy PLAY i BACK\)'/);
  // _deactivate zostawia próg pikseli bazowy (wspólny materiał gry: skała NEA, okruchy wydobycia)
  assert.match(src, /layer\.clear\(\);[\s\S]{0,260}layer\.material\.L\.minPx\.value = layer\.minPx;/);
});

test('progi trybu skoku nad hipercruise\'em Mk III, pod warpem w strefie pasa', () => {
  const src = read('src/3d/asteroids/asteroidBelt.js');
  const on = Number(/const WARP_MODE_ON = (\d+);/.exec(src)?.[1]);
  const off = Number(/const WARP_MODE_OFF = (\d+);/.exec(src)?.[1]);
  assert.ok(on > off && off > 0, `ON ${on} > OFF ${off}`);
  const hyperMax = Math.max(...Object.values(HYPERCRUISE_ENGINES).map((e) => e.vmax));
  assert.ok(off > hyperMax, `hipercruise ≤ ${hyperMax} j/s nie włącza trybu skoku (OFF ${off})`);
  const warpBelt = Math.min(...Object.values(WARP_DRIVES).map((d) => d.speed)) * WARP_DRIVE.zones.belt;
  assert.ok(on < warpBelt, `warp Mk I w strefie pasa (${warpBelt} j/s) włącza tryb skoku (ON ${on})`);
  assert.ok(HYPERCRUISE_TUNE.minZone <= 1);
});

// Atrapa pasa: prawdziwe _lightsStep / _lensVisibility / _stepWarpFade, reszta zliczana.
function fakeBelt() {
  const b = Object.create(AsteroidBelt.prototype);
  Object.assign(b, {
    ready: true, enabled: true, time: 0, _dt: 0, _warpMode: false, _fade: 1, _speed: 0,
    _in: { time: 0, dt: 0, prepared: false },
    stats: { cpuMs: 0, warpMode: false, fade: 1 },
    deactivated: 0, touched: 0
  });
  b._computeView = () => true;
  b._trackCameraSpeed = () => b._speed;
  b._deactivate = () => { b.deactivated++; };
  b._viewTouchesBelt = () => { b.touched++; return false; };
  return b;
}
function frame(b, { speed = 0, stretch = 0, lens = null, dt = 1 / 60 } = {}) {
  b._speed = speed;
  WARP_STARS.stretch.value = stretch;
  WARP_WORLD_LENS.active = !!lens;
  WARP_WORLD_LENS.beta = lens ? lens.beta : 0;
  b._in.prepared = true;
  b._in.dt = dt;
  const before = { d: b.deactivated, t: b.touched };
  b._lightsStep({ origin: { x: 0, y: 0 } });
  return { warp: b.stats.warpMode, fade: b.stats.fade, deactivated: b.deactivated > before.d, loaded: b.touched > before.t };
}

test('na funkcji: lot w skoku wyłącza pole bez rysowania, hipercruise Mk III — prawdziwe pole', () => {
  try {
    const b = fakeBelt();
    // skok gracza: smugi gwiazd, kamera 140 tys. j/s, soczewka β = 1
    let r = frame(b, { speed: 140000, stretch: 1, lens: { beta: 1 } });
    assert.deepEqual([r.warp, r.deactivated, r.loaded, r.fade], [true, true, false, 0], 'skok: pole wyłączone, nic nie wczytuje');
    // mijane ciało (zwolnienie do ~15%): kamera wolna, ale soczewka zasłania prawdziwy widok — pole dalej wyłączone
    r = frame(b, { speed: 15000, stretch: 1, lens: { beta: 1 } });
    assert.deepEqual([r.warp, r.loaded], [true, false], 'zwolnienie w skoku');
    // skok bez soczewki (podzielony ekran / kamera 3D): sama prędkość
    const s = fakeBelt();
    r = frame(s, { speed: 80000, stretch: 1 });
    assert.deepEqual([r.warp, r.loaded], [true, false], 'skok bez soczewki');
    // hipercruise Mk III (40 tys. j/s, strefa pasa 32 tys.) — bez soczewki, prawdziwe pole w pełni
    for (const v of [HYPERCRUISE_ENGINES.hypercruise_mk3.vmax, HYPERCRUISE_ENGINES.hypercruise_mk3.vmax * 0.8]) {
      const h = fakeBelt();
      for (let i = 0; i < 30; i++) r = frame(h, { speed: v, stretch: 0.6 });
      assert.deepEqual([r.warp, r.loaded, r.fade], [false, true, 1], `hipercruise ${v} j/s`);
    }
  } finally {
    WARP_STARS.stretch.value = 0;
    WARP_WORLD_LENS.active = false;
    WARP_WORLD_LENS.beta = 0;
  }
});

test('udział pól przy kadrze w skoku: 1 − β / chargeBeta — pusty na końcu ładowania i przez cały kop', () => {
  assert.equal(warpFieldVisibility(false, 1), 1, 'bez soczewki');
  assert.equal(warpFieldVisibility(true, 0), 1);
  assert.equal(warpFieldVisibility(true, NaN), 1);
  let prev = 1;
  for (let c = 0; c <= 1.0001; c += 0.05) {
    const v = warpFieldVisibility(true, warpLensChargeBeta(c));
    assert.ok(v <= prev + 1e-12, `ładowanie ${c.toFixed(2)}: maleje`);
    prev = v;
  }
  assert.equal(warpFieldVisibility(true, warpLensChargeBeta(1)), 0, 'koniec ładowania — pusto');
  for (let k = 0; k <= WARP_LENS_PHASE.kickTime; k += 0.05) assert.equal(warpFieldVisibility(true, warpLensKickBeta(k)), 0, `kop ${k}`);
  // krok zaniku: w dół od razu, w górę ≤ dt / reveal, pauza trzyma
  assert.equal(stepWarpFieldFade(1, 0.3, 1 / 60), 0.3);
  assert.ok(Math.abs(stepWarpFieldFade(0, 1, 1 / 60) - 1 / 60 / WARP_FIELD_FADE.reveal) < 1e-12);
  assert.equal(stepWarpFieldFade(0.2, 1, 0), 0.2);
  assert.equal(stepWarpFieldFade(NaN, 1, 0), 0);
});

test('na funkcji: ładowanie gasi pole z β soczewki, po skoku pole wraca w reveal s (bez skoku w jednej klatce)', () => {
  try {
    const b = fakeBelt();
    // ładowanie: statek stoi, β rośnie do chargeBeta 0,9 — udział = 1 − β / 0,9, pole dalej liczone
    let r = frame(b, { speed: 0, stretch: 0.2, lens: { beta: 0.45 } });
    assert.deepEqual([r.warp, r.loaded], [false, true]);
    assert.ok(Math.abs(r.fade - 0.5) < 1e-9, `udział ${r.fade}`);
    r = frame(b, { speed: 0, stretch: 0.3, lens: { beta: 0.8 } });
    assert.ok(Math.abs(r.fade - (1 - 0.8 / 0.9)) < 1e-9);
    // koniec ładowania (β = chargeBeta): pole już puste — tryb skoku pasa przed kopem, nic nie znika w kopie
    r = frame(b, { speed: 0, stretch: 0.3, lens: { beta: 0.9 } });
    assert.deepEqual([r.warp, r.loaded, r.fade], [true, false, 0]);
    // kop: β → 1, kamera rusza (prędkość wygładzona jeszcze niska) — soczewka zasłania
    r = frame(b, { speed: 20000, stretch: 1, lens: { beta: 0.99 } });
    assert.deepEqual([r.warp, r.loaded, r.fade], [true, false, 0]);
    // histereza prędkości: po soczewce (β = 0) kamera 50 tys. j/s > OFF — dalej tryb skoku
    r = frame(b, { speed: 50000, stretch: 0.5, lens: { beta: 0 } });
    assert.equal(r.warp, true, 'histereza');
    // wyjście: kamera < OFF — pole wraca od zera i narasta najwyżej 1 / reveal na s
    r = frame(b, { speed: 30000, stretch: 0.3, lens: { beta: 0 } });
    assert.deepEqual([r.warp, r.loaded], [false, true]);
    assert.ok(r.fade > 0 && r.fade < 0.05, `pierwsza klatka powrotu ${r.fade}`);
    let prev = r.fade;
    for (let i = 0; i < 40; i++) {
      r = frame(b, { speed: 5000, stretch: 0 });
      assert.ok(r.fade >= prev && r.fade - prev <= 1 / 60 / 0.5 + 1e-9, 'narasta płynnie');
      prev = r.fade;
    }
    assert.equal(r.fade, 1, `po ~${WARP_FIELD_FADE.reveal} s pełne pole`);
    // pauza (dt = 0) trzyma stan zaniku
    const p = fakeBelt();
    frame(p, { speed: 0, stretch: 0.3, lens: { beta: 1 } });
    r = frame(p, { speed: 0, stretch: 0, dt: 0 });
    assert.equal(r.fade, 0, 'pauza: bez narastania');
  } finally {
    WARP_STARS.stretch.value = 0;
    WARP_WORLD_LENS.active = false;
    WARP_WORLD_LENS.beta = 0;
  }
});

test('próg pikseli zaniku: 0 przy pełnym polu, rośnie monotonicznie, przy 0 ponad największą skałę w kadrze', () => {
  for (const zoom of [0.06, 0.117, 0.2133, 1]) {
    assert.equal(warpFadeMinPx(1, zoom), 0);
    let prev = 0;
    for (let f = 0.95; f >= 0; f -= 0.05) {
      const px = warpFadeMinPx(f, zoom);
      assert.ok(px > prev, `zoom ${zoom}, udział ${f.toFixed(2)}: ${px}`);
      prev = px;
    }
    // największa skała pasa gry: średnica 2600 j. → promień 1300 · zoom px (tło dalej i mniejsze)
    assert.ok(warpFadeMinPx(0, zoom) >= 1300 * zoom, `zoom ${zoom}: ${warpFadeMinPx(0, zoom)}`);
    assert.ok(warpFadeMinPx(0.999, zoom) < 1, 'pełne pole bez progu');
  }
});

test('budżet wczytywania komórek: bazowy do hipercruise\'u Mk II, × mul przy Mk III w strefie pasa, podział wagą zaległości', () => {
  const base = ASTEROID_BELT_CONFIG.budgetMs;
  assert.equal(beltLoadBudgetMs(base, 0), base);
  assert.equal(beltLoadBudgetMs(base, BELT_LOAD_BOOST.from), base);
  assert.equal(beltLoadBudgetMs(base, BELT_LOAD_BOOST.to), base * BELT_LOAD_BOOST.mul);
  assert.equal(beltLoadBudgetMs(base, 1e6), base * BELT_LOAD_BOOST.mul);
  const mk3Belt = HYPERCRUISE_ENGINES.hypercruise_mk3.vmax * 0.8;
  assert.ok(Math.abs(beltLoadBudgetMs(base, mk3Belt) - base * BELT_LOAD_BOOST.mul) < 1e-9, `Mk III w pasie (${mk3Belt} j/s)`);
  assert.equal(beltLoadBudgetMs(base, 15000), base, 'lot bojowy i przelot — bez zmian');
  // podział: wspólny koniec klatki, waga 1 + zaległość warstwy (czas niewykorzystany przechodzi dalej)
  const src = read('src/3d/asteroids/asteroidBelt.js');
  assert.match(src, /const loadEnd = performance\.now\(\) \+ beltLoadBudgetMs\(this\.cfg\.budgetMs, camSpeed\);/);
  assert.match(src, /const w = 1 \+ layer\.stats\.pending;\s*f\.budgetMs = Math\.max\(0, loadEnd - performance\.now\(\)\) \* w \/ wsum;\s*wsum -= w;\s*layer\.update\(f\);/);
  assert.doesNotMatch(src, /this\.cfg\.budgetMs \/ Math\.max\(1, this\.layers\.length\)/, 'bez równego podziału');
});

test('próg wczytania przy zaniku: ≤ połowy progu rysowania, ≥ progu warstwy, skokami × 2 (koszyki nie co klatkę)', () => {
  for (const base of [0.7, 0.8, 61]) {
    assert.equal(fadeLoadPx(0, base), base);
    assert.equal(fadeLoadPx(undefined, base), base);
    for (let fm = 0.1; fm < 2000; fm *= 1.13) {
      const q = fadeLoadPx(fm, base);
      assert.ok(q >= base, 'nie poniżej progu warstwy');
      if (fm > base * 2) assert.ok(q <= fm * 0.5 + 1e-9 || q === base, `fm ${fm}: ${q} ≤ połowy`);
      assert.ok(q <= Math.max(base, fm), 'każda rysowana skała wczytana');
    }
  }
  // powrót pola w reveal s przy kadrze hipercruise'u: próg rysowania co klatkę, próg wczytania — kilka skoków
  for (const zoom of [0.117, 0.2133]) {
    const steps = new Set();
    let frames = 0;
    for (let f = 0; f <= 1; f += 1 / 60 / WARP_FIELD_FADE.reveal) { steps.add(fadeLoadPx(warpFadeMinPx(f, zoom), 0.8)); frames++; }
    assert.ok(steps.size <= 10 && steps.size < frames / 3, `zoom ${zoom}: ${steps.size} progów na ${frames} klatek`);
  }
  // RockLayer: shader dostaje próg rysowania, wczytywanie i koszyki — próg wczytania
  const src = read('src/3d/asteroids/rockLayers.js');
  assert.match(src, /const loadPx = fadeLoadPx\(f\.fadeMinPx, minPx\);\s*minPx = loadPx;/);
  assert.match(src, /L\.minPx\.value = drawPx;/);
});

test('światła i maska słońca pola gasną z zanikiem (statki, świecące skały, burza, setSunOcclusionField)', () => {
  const src = read('src/3d/asteroids/asteroidBelt.js');
  assert.match(src, /opts\.strength = this\._fade;/, 'światła statków w polu');
  assert.match(src, /this\.storm\.fade = fade;/, 'burza');
  assert.match(src, /Core3D\.setSunOcclusionField\(this\.fieldMap\.texture, [^;]*, this\._fade\);/, 'siła maski słońca pola');
  // świecąca skała: światło maleje z bryłą (shader: smoothstep(minPx, 2 · minPx, promień px))
  const b = Object.create(AsteroidBelt.prototype);
  const added = [];
  Object.assign(b, {
    sunT: () => 1, time: 0, _view: { zoom: 0.5 }, _frame: { fadeMinPx: 0 },
    _rockLightBox: { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 }, _rockOx: 0, _rockOy: 0, _rockLightCount: 0,
    _rockGrid: { add: (...a) => { added.push(a[4]); return 0; } }
  });
  const rock = { type: 4, r: 400, x: 0, y: 0, seed: 0.3 };
  b._rockLight(rock);
  const full = added.pop();
  assert.ok(full > 0);
  b._frame.fadeMinPx = 400 * 0.5 * 0.75;          // promień 200 px między progiem 150 a 300 — w połowie zaniku
  b._rockLight(rock);
  const half = added.pop();
  assert.ok(half > 0 && half < full, `w zaniku ${half} < ${full}`);
  b._frame.fadeMinPx = 400 * 0.5 * 1.01;          // bryła już zniknęła
  const n = added.length;
  b._rockLight(rock);
  assert.equal(added.length, n, 'bez światła po zniknięciu bryły');
});

// Atrapa gazu przestrzeni: prawdziwe SpaceGas._update, pole, mapy i warstwy zliczane.
function fakeGas() {
  const g = Object.create(Object.getPrototypeOf(SpaceGas));
  const layer = { L: { fade: { value: 1 } }, visible: true, setVisible(v) { this.visible = v; }, place() {} };
  const dust = { visible: true, fade: -1, U: { edge: { value: 1 } }, setVisible(v) { this.visible = v; }, frame(r, dt, ctx, ax, ay, rect, fade) { this.fade = fade; return 0; }, requestReset() {} };
  Object.assign(g, {
    input: new Float64Array(SPACE_GAS_IN.size), obstacles: null, tune: { ...SPACE_GAS_TUNE, enabled: true, dust: true, sim: true },
    _serial: -1, _scene: SPACE_GAS_SCENE.belt, _rect: { cx: 0, cy: 0, w: 1, h: 1 }, _warpFade: 1, _renderTime: NaN, _clk: { sim: 0, render: 0 },
    stats: { active: false, cpuMs: 0, fade: 1 }, layer, dust, looks: {}, scene: { look: null, setEnvelope() {} },
    sim: {
      N: 256, cell: 32, srcN: 0, hullN: 0, image: { valid: true }, stats: { resets: 0, substeps: 0, dispatches: 0 },
      beginInputs() {}, addSource() { return true; }, setRaster() {}, frame() {}, requestReset() {}
    },
    maps: {
      U: { sunDir: { value: { set() {} } }, simOn: { value: 0 }, amount: { value: 1 } },
      place(cx, cy, hw, hh, out) { return out; }, kernels() { return []; }
    }
  });
  return g;
}
function gasFrame(g, { on = true, beta = null, dt = 1 / 60, fresh = true } = {}) {
  const IN = g.input, I = SPACE_GAS_IN;
  IN[I.active] = on ? 1 : 0;
  IN[I.scene] = SPACE_GAS_SCENE.belt;
  IN[I.halfW] = 8000; IN[I.halfH] = 4500;
  IN[I.dt] = dt;
  // zegar gry wejścia (SimClock.sim / .render — render liczy przyrost od ostatniej przetworzonej strony)
  if (fresh) { IN[I.serial] = (IN[I.serial] || 0) + 1; IN[I.renderTime] = (IN[I.renderTime] || 0) + dt; IN[I.simTime] = IN[I.renderTime]; }
  WARP_WORLD_LENS.active = beta !== null;
  WARP_WORLD_LENS.beta = beta ?? 0;
  g.dust.fade = -1;
  g._update({ renderer: { compute() {} } });
  return { layer: g.layer.L.fade.value, layerOn: g.layer.visible, dust: g.dust.fade, dustOn: g.dust.visible, cover: SpaceGasCover.belt, fade: g.stats.fade };
}

test('gaz przestrzeni gaśnie z polem pasa w ładowaniu (pusty przed kopem), po włączeniu wraca w reveal s', () => {
  try {
    const g = fakeGas();
    let r = gasFrame(g);
    assert.deepEqual([r.layer, r.dust, r.cover], [1, 1, 1], 'lot zwykły — pełny gaz');
    // ładowanie skoku: obraz gazu i pyłu × udział prawdziwego widoku, pokrycie płatów mgły zostaje przestrzenne
    r = gasFrame(g, { beta: 0.45 });
    assert.ok(Math.abs(r.layer - 0.5) < 1e-9 && Math.abs(r.dust - 0.5) < 1e-9, `${r.layer} / ${r.dust}`);
    assert.equal(r.cover, 1, 'płytkie płaty nie wracają w miejsce gazu');
    r = gasFrame(g, { beta: WARP_LENS_PHASE.chargeBeta });
    assert.deepEqual([r.layer, r.layerOn, r.dustOn], [0, false, false], 'koniec ładowania — gaz pusty przed kopem');
    // skok: gra wyłącza gaz (index.html: enabled = warp.state !== 'active')
    r = gasFrame(g, { on: false, beta: 1 });
    assert.equal(r.fade, 0);
    // wyjście: gaz włączony, soczewka jeszcze trzyma (β = 1) — pusto; po soczewce narasta ≤ dt / reveal
    r = gasFrame(g, { beta: 1 });
    assert.deepEqual([r.layer, r.layerOn], [0, false]);
    let prev = 0;
    for (let i = 0; i < 40; i++) {
      r = gasFrame(g);
      assert.ok(r.layer >= prev && r.layer - prev <= 1 / 60 / WARP_FIELD_FADE.reveal + 1e-9, 'narasta płynnie');
      prev = r.layer;
    }
    assert.equal(r.layer, 1);
    // pauza (to samo wejście, dt 0) trzyma stan
    g._warpFade = 0.3;
    r = gasFrame(g, { fresh: false });
    assert.ok(Math.abs(r.fade - 0.3) < 1e-12, 'pauza');
  } finally {
    WARP_WORLD_LENS.active = false;
    WARP_WORLD_LENS.beta = 0;
    SpaceGasCover.belt = 0;
  }
});
