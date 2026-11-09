// Planeta z bliska (src/3d/planetGen/: planetGenPatch.js, planetGenNear.js, planetGenSurfaceNear.tsl.js,
// planetGenCloudsNear.tsl.js, planetGenPlume.tsl.js): układy i siatka wycinka pod kamerą (stała siatka — przesuw okna
// nie zmienia tekseli), plan okna z kadru, wypiek w pasach po kroku na klatkę i przenikanie miejsc, kroki wypieku
// (pole przed przejściami czytającymi sąsiadów), uniformy materiałów zbliżenia, WGSL w Node bez GPU (materiał
// powierzchni, chmur i pióropusza; grafy gry bez haków zbliżenia), małe przesunięcie dziedziny szumu (float32).
// Widok orbitalny: tekstura szumu 3D (powtarzalna, rozkład zgodny z progami kłębów), powłoki liczone marszem promienia
// (bryła chmur, atmosfera, zorza — planetGenCloudVolume.tsl.js, planetGenShell.tsl.js): komplet uniformów, WGSL.
// node --test tests/planetGenNear.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { describePlanet } from '../src/3d/planetGen/planetGenSpec.js';
import { PLANET_GEN_TYPE_IDS } from '../src/3d/planetGen/planetGenTypes.js';
import { mix32, makeRng } from '../src/3d/planetGen/planetGenRng.js';
import { PlanetGenBaker } from '../src/3d/planetGen/planetGenBaker.js';
import {
  PATCH_FRAMES, PATCH_SNAP, patchFrameFor, dirToPatch, patchToDir, patchViewBounds, planPatch, patchCovers, PlanetGenPatches
} from '../src/3d/planetGen/planetGenPatch.js';
import { nearSurfaceUniforms, nearCloudUniforms, bindPatches, lavaLookFor, plumeLookFor } from '../src/3d/planetGen/planetGenNear.js';
import { createGenNearSurfaceMaterial, GEN_NEAR_UNIFORM_KEYS, GEN_NEAR_DATA_KEYS } from '../src/3d/planetGen/planetGenSurfaceNear.tsl.js';
import { createGenCloudNearMaterial, GEN_CLOUD_NEAR_UNIFORM_KEYS } from '../src/3d/planetGen/planetGenCloudsNear.tsl.js';
import { createPlumeMaterial, plumeUniforms, PLUME_UNIFORM_KEYS } from '../src/3d/planetGen/planetGenPlume.tsl.js';
import { createPlanetSurfaceMaterial, createPlanetCloudMaterial, PLANET_GRAPH_KEYS } from '../src/3d/planet3d.assets.tsl.js';
import { buildCloudNoise } from '../src/3d/planetGen/planetGenNoise3D.js';
import {
  createGenCloudVolumeMaterial, cloudVolumeUniforms, CLOUD_VOLUME_UNIFORM_KEYS, CLOUD_VOLUME_STEPS, CLOUD_VOLUME_STEPS_MIN
} from '../src/3d/planetGen/planetGenCloudVolume.tsl.js';
import {
  createGenAtmosphereMaterial, atmosphereUniforms, ATMOSPHERE_UNIFORM_KEYS,
  createGenAuroraMaterial, auroraUniforms, AURORA_UNIFORM_KEYS, SHELL_UNIFORM_KEYS
} from '../src/3d/planetGen/planetGenShell.tsl.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.highPrecision = true;
function build(object, material, camera = new THREE.OrthographicCamera()) {
  const b = renderer.backend.createNodeBuilder(object, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = camera;
  b.context.material = material;
  b.build();
  return b.fragmentShader;
}
const sphere = (m) => new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), m);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// kierunki kadru: prostokąt kątowy wokół kierunku `c` (połowa szerokości / wysokości w radianach)
function viewDirs(c, half, aspect = 2) {
  const up = Math.abs(c[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e = cross(up, c);
  const el = Math.hypot(...e);
  const ex = e.map((v) => v / el);
  const n = cross(c, ex);
  const out = [];
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const d = [0, 1, 2].map((k) => c[k] + ex[k] * (i / 2) * half * aspect + n[k] * (j / 2) * half);
      const l = Math.hypot(...d);
      out.push(d.map((v) => v / l));
    }
  }
  return out;
}

test('układy wycinka: sześć ścian, osie prostopadłe i prawoskrętne, kąty ↔ kierunek, układ z histerezą', () => {
  assert.equal(PATCH_FRAMES.length, 6);
  for (const f of PATCH_FRAMES) {
    assert.equal(dot(f.x, f.y) + 0, 0);
    assert.deepEqual(cross(f.x, f.y).map((v) => v + 0), f.z.map((v) => v + 0), 'z = x × y');
    // środek okna: a = b = 0 → oś x; układ 0 = układ planety (u = ½ + a / 2π jak SphereGeometry)
    assert.deepEqual(patchToDir(f, 0, 0).map((v) => v + 0), f.x.map((v) => v + 0));
  }
  const rng = makeRng(7);
  for (let i = 0; i < 300; i++) {
    const d = rng.dir();
    const fi = patchFrameFor(d);
    const t = dirToPatch(PATCH_FRAMES[fi], d);
    assert.ok(t.front >= 1 / Math.sqrt(3) - 1e-9, 'najbliższa ściana: rzut ≥ 1/√3');
    assert.ok(Math.abs(t.a) < 0.8 && Math.abs(t.b) < 0.8, 'okno przy „równiku” układu (teksele prawie kwadratowe)');
    const back = patchToDir(PATCH_FRAMES[fi], t.a, t.b);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(back[k] - d[k]) < 1e-12);
  }
  // histereza: tuż za krawędzią ściany zostaje bieżący układ, dalej — zmiana
  const s = Math.SQRT1_2;
  assert.equal(patchFrameFor([s + 0.01, 0, s - 0.01], 2), 2);
  assert.equal(patchFrameFor([0.9, 0, 0.44], 2), 0);
  // biegun planety: okno nie degeneruje się (układ ze środkiem na osi Y)
  assert.ok(patchFrameFor([0.05, 0.998, 0.02]) >= 4);
});

test('plan okna: siatka stała (początek co PATCH_SNAP tekseli), poziom z kadru, okno pokrywa kadr z zapasem', () => {
  const opt = { globalWidth: 2048, width: 2048, height: 1024, margin: 1.5, maxLevel: 8 };
  const c = [0.8, 0.2, 0.566];
  const b0 = patchViewBounds(viewDirs(c, 0.02));
  const p0 = planPatch(b0, opt);
  assert.ok(p0 && p0.level >= 1);
  const stG = 2 * Math.PI / 2048;
  assert.ok(Math.abs(p0.st - stG / 2 ** p0.level) < 1e-15, 'teksel = teksel mapy planety / 2^poziom');
  for (const v of [p0.a0, p0.b0]) {
    const q = v / (PATCH_SNAP * p0.st);
    assert.ok(Math.abs(q - Math.round(q)) < 1e-6, 'początek okna na siatce PATCH_SNAP tekseli');
  }
  assert.ok(patchCovers(p0, b0, 2048, 1024, 0.05), 'okno pokrywa kadr z zapasem');
  // drobny przesuw kadru (ułamek teksela): to samo okno; ten sam kadr po powrocie: ten sam klucz
  const p1 = planPatch(patchViewBounds(viewDirs([0.8 + 1e-7, 0.2, 0.566], 0.02), b0.frame), opt);
  assert.equal(p1.key, p0.key);
  // większy przesuw: okno przesunięte o całkowitą liczbę kroków siatki, ten sam poziom i teksel
  const p2 = planPatch(patchViewBounds(viewDirs([0.8, 0.26, 0.54], 0.02), b0.frame), opt);
  assert.equal(p2.level, p0.level);
  assert.notEqual(p2.key, p0.key);
  // zbliżenie ×2 — poziom o jeden wyżej; oddalenie na całą tarczę — bez wycinka
  assert.equal(planPatch(patchViewBounds(viewDirs(c, 0.01)), opt).level, p0.level + 1);
  assert.equal(planPatch(patchViewBounds(viewDirs(c, 0.9)), opt), null);
  assert.equal(patchViewBounds([]), null);
  // sufit poziomu
  assert.equal(planPatch(patchViewBounds(viewDirs(c, 1e-5)), { ...opt, maxLevel: 5 }).level, 5);
});

// wypiekacz-atrapa: zapisuje kroki, kroki z prawdziwego `patchSteps`
function fakeBaker() {
  const log = [];
  return {
    log,
    createPatchTargets: (w, h) => ({ width: w, height: h, bytes: w * h * 16, day: { texture: {} }, relief: { texture: {} }, mask: { texture: {} }, dispose() {} }),
    createCloudPatchTarget: (w, h) => ({ width: w, height: h, bytes: w * h * 4, clouds: { texture: {} }, dispose() {} }),
    patchSteps: PlanetGenBaker.prototype.patchSteps,
    bakePatchStep(base, win, set, tu, step) { log.push({ ...step, a0: win.a0, st: win.st }); return tu || { id: 1 }; }
  };
}

test('kroki wypieku: całe pole przed dniem, rzeźbą i maskami; liczba pasów z rozmiaru celu; chmury osobno', () => {
  const steps = PlanetGenBaker.prototype.patchSteps({ width: 4096, height: 2048 });
  const order = steps.map((s) => s.pass);
  assert.ok(order.lastIndexOf('field') < order.indexOf('day'), 'pole w całości przed dniem (dzień czyta sąsiednie teksele pola)');
  assert.ok(order.indexOf('day') < order.indexOf('relief') && order.indexOf('relief') < order.indexOf('mask'));
  assert.ok(steps.filter((s) => s.pass === 'field').length >= 3, 'okno 4096 × 2048: pole w kilku pasach');
  for (const p of ['field', 'day', 'relief', 'mask']) {
    const bands = steps.filter((s) => s.pass === p);
    assert.deepEqual(bands.map((s) => s.band), bands.map((_, i) => i), `${p}: pasy po kolei`);
    assert.ok(bands.every((s) => s.bands === bands.length));
  }
  assert.equal(PlanetGenBaker.prototype.patchSteps({ width: 1024, height: 512 }).length, 4, 'małe okno: po jednym pasie');
  assert.ok(PlanetGenBaker.prototype.patchSteps({ width: 4096, height: 2048 }, 'clouds').every((s) => s.pass === 'clouds'));
});

test('wycinki: wypiek po kroku na klatkę, okno wchodzi po ostatnim kroku i przenika; bez wypieku w gasnące miejsce', () => {
  const baker = fakeBaker();
  const base = { size: 2048, spec: { type: 'volcanic', seed: 1 } };
  const P = new PlanetGenPatches(baker, base, { width: 4096, height: 2048, fade: 0.3 });
  const total = baker.patchSteps(P.slots[0].set).length;
  const c = [0.8, 0.2, 0.566];
  const dirs = viewDirs(c, 0.02);
  let frames = 0;
  while (!P.update(dirs, 1 / 60) && frames < 100) {
    frames++;
    assert.equal(P.active, -1, 'przed końcem wypieku obraz z mapy planety');
    assert.equal(baker.log.length, frames, 'krok na klatkę');
  }
  assert.equal(baker.log.length, total);
  assert.equal(frames, total - 1);
  assert.ok(P.active >= 0 && P.slots[P.active].win && P.slots[P.active].mix < 0.1, 'nowe okno zaczyna od wagi 0');
  for (let i = 0; i < 30; i++) P.update(dirs, 1 / 60);
  assert.equal(P.slots[P.active].mix, 1);
  assert.equal(baker.log.length, total, 'kadr w oknie — bez wypieku');
  assert.equal(P.stats.bakes, 1);
  // przesuw kadru poza zapas okna → nowy wypiek do DRUGIEGO miejsca; stare gaśnie dopiero po wejściu nowego
  const first = P.active;
  const far = viewDirs([0.8, 0.3, 0.52], 0.02);
  let guard = 0;
  while (P.active === first && guard++ < 100) P.update(far, 1 / 60);
  assert.notEqual(P.active, first);
  assert.ok(P.slots[first].mix > 0.9, 'stare okno widać, póki nowe nie wejdzie');
  // w czasie przenikania kadr znów ucieka: nie piecze w miejsce, które jeszcze gaśnie
  const n0 = baker.log.length;
  P.update(viewDirs([0.8, 0.4, 0.447], 0.02), 1 / 60);
  assert.equal(baker.log.length, n0);
  // wymuszenie: cały wypiek od razu
  for (let i = 0; i < 40; i++) P.update(far, 1 / 60);
  const n1 = baker.log.length;
  assert.equal(P.update(far, 1 / 60, true), true);
  assert.equal(baker.log.length, n1 + total);
  // wyłączenie: wraca sama mapa planety
  P.enabled = false;
  for (let i = 0; i < 40; i++) P.update(far, 1 / 60);
  assert.equal(P.active, -1);
  assert.ok(P.slots.every((s) => s.mix === 0));
  // chmury: osobny rodzaj kroków
  const C = new PlanetGenPatches(baker, base, { kind: 'clouds', maxLevel: 5 });
  const m = baker.log.length;
  C.update(dirs, 1 / 60, true);
  assert.ok(baker.log.slice(m).every((s) => s.pass === 'clouds') && baker.log.length > m);
  assert.ok(C.slots[C.active].win.level <= 5);
});

test('wycinek w toku porzucony, gdy jego okno nie pokryje już kadru', () => {
  const baker = fakeBaker();
  const P = new PlanetGenPatches(baker, { size: 2048, spec: { type: 'terran', seed: 2 } }, { width: 4096, height: 2048 });
  P.update(viewDirs([0.8, 0.2, 0.566], 0.02), 1 / 60);
  assert.ok(P.job);
  P.update(viewDirs([0.2, 0.8, 0.566], 0.02), 1 / 60);
  assert.ok(P.job && P.job.i === 1, 'nowe zadanie dla nowego kadru (stare porzucone)');
  assert.equal(P.active, -1);
});

test('uniformy zbliżenia: komplet kluczy, puste miejsca z wagą 0, odcień żaru słaby, przepisanie okna', () => {
  const spec = describePlanet({ type: 'volcanic', seed: 5 });
  const U = nearSurfaceUniforms(spec, { day: new THREE.Texture() }, { lava: 0.8, size: 2048 });
  for (const k of Object.keys(GEN_NEAR_UNIFORM_KEYS)) assert.ok(U[k], `brak uniformu ${k}`);
  for (const k of Object.values(GEN_NEAR_DATA_KEYS)) assert.ok(k in U, `brak tekstury ${k}`);
  for (const k of Object.keys(PLUME_UNIFORM_KEYS)) assert.ok(U[k], `brak uniformu pióropusza ${k}`);
  assert.equal(U.uGnAT.value.y, 0);
  assert.equal(U.uGnBT.value.y, 0);
  assert.equal(U.uPlState.value.w, 0, 'bez erupcji gęstość 0');
  const lc = U.uGnLavaCol.value;
  assert.ok(lc.x === 1 && lc.y > 0.6 && lc.z > 0.35, 'odcień żaru słaby — barwę niesie temperatura');
  assert.ok(lavaLookFor(describePlanet({ type: 'terran', seed: 1 })).glow === 0);
  assert.ok(plumeLookFor(spec).H > 0);
  const baker = fakeBaker();
  const P = new PlanetGenPatches(baker, { size: 2048, spec }, { width: 2048, height: 1024 });
  P.update(viewDirs([0.8, 0.2, 0.566], 0.02), 1 / 60, true);
  bindPatches(U, P);
  const s = P.active === 0 ? 'A' : 'B';
  const w = P.slots[P.active].win;
  assert.equal(U[`uGn${s}T`].value.x, w.st);
  assert.ok(Math.abs(U[`uGn${s}W`].value.z - 1 / (2048 * w.st)) < 1e-6);
  assert.deepEqual(U[`uGn${s}X`].value.toArray(), w.axes.x);
  const t = describePlanet({ type: 'terran', seed: 21 });
  const TU = nearSurfaceUniforms(t, { day: new THREE.Texture(), clouds: new THREE.Texture() }, { size: 2048 });
  const CU = nearCloudUniforms(t, { clouds: new THREE.Texture() }, TU);
  for (const k of Object.keys(GEN_CLOUD_NEAR_UNIFORM_KEYS)) assert.ok(CU[k], `brak uniformu chmur ${k}`);
  assert.equal(CU.sunPosition, TU.sunPosition, 'słońce wspólne z powierzchnią');
});

test('WGSL: materiał zbliżenia, chmury z bliska i pióropusz budują się; grafy gry bez haków zbliżenia', () => {
  const spec = describePlanet({ type: 'volcanic', seed: 5 });
  const U = nearSurfaceUniforms(spec, { day: new THREE.Texture() }, { lava: 0.8, size: 2048 });
  const m = createGenNearSurfaceMaterial(U);
  const near = build(sphere(m), m);
  assert.match(near, /textureSampleLevel/);     // wycinki i promień cienia z jawnym poziomem mipmapy
  assert.match(near, /fn pgCells/);             // płyty skorupy lawy
  assert.doesNotMatch(near, /\bNaN\b/);
  const t = describePlanet({ type: 'terran', seed: 21 });
  const TU = nearSurfaceUniforms(t, { day: new THREE.Texture(), clouds: new THREE.Texture() }, { size: 2048 });
  const cm = createGenCloudNearMaterial(nearCloudUniforms(t, { clouds: new THREE.Texture() }, TU));
  const clouds = build(sphere(cm), cm);
  assert.match(clouds, /textureSampleLevel/);
  const pm = createPlumeMaterial({ ...plumeUniforms() });
  const plume = build(sphere(pm), pm);
  assert.match(plume, /fn pgNoise/);
  assert.match(plume, /loop|for\s*\(/, 'marsz promienia jako pętla (nie rozwinięte kroki)');
  assert.ok(plume.length < 60000, `pióropusz: WGSL ${plume.length} znaków`);
  // grafy gry (Ziemia, Mars, chmury Ziemi): bez szumu i próbek zbliżenia
  const blank = (keys) => Object.fromEntries(keys.map((k) => [k, { value: k.endsWith('Texture') ? null : (k === 'sunPosition' ? new THREE.Vector3() : 0) }]));
  const gs = createPlanetSurfaceMaterial(blank(PLANET_GRAPH_KEYS.surface));
  assert.doesNotMatch(build(sphere(gs), gs, new THREE.PerspectiveCamera()), /pgNoise|pgCells/);
  const gc = createPlanetCloudMaterial(blank(PLANET_GRAPH_KEYS.clouds));
  assert.doesNotMatch(build(sphere(gc), gc, new THREE.PerspectiveCamera()), /pgNoise|pgCells/);
});

test('wypiek: przejście masek i gałąź okna w grafach; gałąź okna skończona dla zer (bez normalize(0), atan2(0, 0))', () => {
  const baker = new PlanetGenBaker(renderer);
  for (const k of ['mask', 'relief', 'field:volcanic', 'day:volcanic', 'field:terran', 'day:terran', 'clouds']) {
    const g = baker.graph(k);
    const quad = new THREE.QuadMesh(g.material);
    const wgsl = build(quad, g.material, quad.camera);
    assert.ok(wgsl.includes('fn main'), k);
    assert.ok(g.U.uWin && g.U.uFrX && g.U.uFrY && g.U.uFrZ, `${k}: uniformy okna`);
  }
  assert.ok(baker.passesFor('volcanic').some(([k]) => k === 'mask'));
  const src = read('src/3d/planetGen/planetGenBake.tsl.js').replace(/\/\/[^\n]*/g, ' ');
  const win = src.slice(src.indexOf('If(U.uWin.w.greaterThan(0.5)'), src.indexOf('}).Else(() => {', src.indexOf('If(U.uWin.w.greaterThan(0.5)')));
  assert.doesNotMatch(win, /normalize\(/, 'gałąź okna: dzielenie przez max(długość, ε), nie normalize');
  assert.match(win, /max\(length\(d\), 1e-6\)/);
  // rzeźba: pochodna na północ bez odwrócenia (wiersz celu rośnie ku północy)
  assert.match(src, /const dN = gy\.div\(R\.mul\(C\.stN\)\);/);
});

test('opis: przesunięcie dziedziny szumu małe (float32 trzyma teksel wycinka)', () => {
  for (let i = 0; i < 60; i++) {
    for (const type of PLANET_GEN_TYPE_IDS) {
      const s = describePlanet({ type, seed: mix32(11, i) });
      assert.ok(s.seedOffset.every((v) => v >= 1 && v < 7), `${type}: przesunięcie ${s.seedOffset}`);
    }
  }
  // krok float32 przy |kierunek + przesunięcie| < 8 jest ≥ 30 × mniejszy od teksela poziomu 6 mapy 2048
  const ulp = Math.pow(2, -21);
  assert.ok(ulp * 30 < 2 * Math.PI / (2048 * 64));
});

test('szum 3D: powtarzalny, kanały w zakresie, rozkład kanału kłębów obejmuje progi pokrycia', () => {
  const N = 32;
  const a = buildCloudNoise(N);
  const b = buildCloudNoise(N);
  assert.equal(a.length, N * N * N * 4);
  assert.deepEqual(a, b, 'ten sam szum przy każdej budowie (hasz, nie Math.random)');
  const r = [];
  for (let i = 0; i < a.length; i += 4) r.push(a[i] / 255);
  r.sort((x, y) => x - y);
  const q = (p) => r[Math.floor(p * (r.length - 1))];
  // próg kłębów: 0,71 − 0,43 · pokrycie (planetGenCloudVolume.tsl.js) — pełne pokrycie = prawie wszystko ponad
  // progiem, zerowe = prawie nic
  assert.ok(q(0.05) > 0.71 - 0.43, `kwantyl 5% kanału R = ${q(0.05)}`);
  assert.ok(q(0.95) < 0.71, `kwantyl 95% kanału R = ${q(0.95)}`);
  assert.ok(q(0.5) > 0.45 && q(0.5) < 0.6, `mediana kanału R = ${q(0.5)}`);
  for (let c = 1; c < 4; c++) {
    let lo = 255; let hi = 0;
    for (let i = c; i < a.length; i += 4) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
    assert.ok(hi - lo > 120, `kanał ${c}: zakres ${lo}…${hi}`);
  }
});

test('powłoki z marszem promienia: komplet uniformów, WGSL bryły chmur, atmosfery i zorzy (pętle, próbki z poziomem)', () => {
  const t = describePlanet({ type: 'terran', seed: 21 });
  const cu = cloudVolumeUniforms(t, { clouds: new THREE.Texture() });
  for (const k of Object.keys(CLOUD_VOLUME_UNIFORM_KEYS)) assert.ok(cu[k], `bryła chmur: brak ${k}`);
  assert.ok('cloudTexture' in cu);
  assert.ok(cu.uCvShape.value.y > cu.uCvShape.value.x && cu.uCvShape.value.x > 1, 'powłoka nad powierzchnią');
  assert.ok(CLOUD_VOLUME_STEPS_MIN < CLOUD_VOLUME_STEPS);
  const au = atmosphereUniforms(t);
  for (const k of Object.keys(ATMOSPHERE_UNIFORM_KEYS)) assert.ok(au[k], `atmosfera: brak ${k}`);
  const zu = auroraUniforms(t, [0.3, 0.7]);
  for (const k of Object.keys(AURORA_UNIFORM_KEYS)) assert.ok(zu[k], `zorza: brak ${k}`);
  for (const k of Object.keys(SHELL_UNIFORM_KEYS)) assert.ok(cu[k] && au[k] && zu[k], `klucz wspólny powłok ${k}`);
  assert.ok(Math.abs(Math.hypot(zu.uAuAxis.value.x, zu.uAuAxis.value.y, zu.uAuAxis.value.z) - 1) < 1e-6, 'oś magnetyczna jednostkowa');
  for (const camera of [new THREE.PerspectiveCamera(), new THREE.OrthographicCamera()]) {
    const cm = createGenCloudVolumeMaterial(cu);
    const cv = build(sphere(cm), cm, camera);
    assert.match(cv, /for\s*\(/, 'bryła chmur: marsz jako pętla');
    assert.match(cv, /texture_3d/, 'bryła chmur: tekstura szumu 3D');
    assert.doesNotMatch(cv, /textureSample\(/, 'bryła chmur: każda próbka z jawnym poziomem (pętla i gałęzie)');
    assert.doesNotMatch(cv, /NaN/);
    assert.ok(cv.length < 30000, `bryła chmur: WGSL ${cv.length} znaków`);
    const am = createGenAtmosphereMaterial(au);
    const at = build(sphere(am), am, camera);
    assert.match(at, /for\s*\(/);
    assert.doesNotMatch(at, /textureSample/, 'atmosfera bez tekstur');
    const zm = createGenAuroraMaterial(zu);
    const zo = build(sphere(zm), zm, camera);
    assert.match(zo, /for\s*\(/);
    assert.doesNotMatch(zo, /textureSample\(/);
  }
  // materiały powłok: bez zapisu głębi, barwa pomnożona przez krycie (chmury) albo addytywna (atmosfera, zorza)
  const cm = createGenCloudVolumeMaterial(cu);
  assert.equal(cm.depthWrite, false);
  assert.equal(cm.blendSrc, THREE.OneFactor);
  assert.equal(cm.blendDst, THREE.OneMinusSrcAlphaFactor);
  assert.equal(createGenAtmosphereMaterial(au).blendDst, THREE.OneFactor);
  // planeta bez wody: atmosfera z barwy poświaty rodzaju (nie błękit Ziemi)
  const d = atmosphereUniforms(describePlanet({ type: 'desert', seed: 3 }));
  assert.ok(d.uAtBeta.value.x >= d.uAtBeta.value.z, 'pustynia: rozpraszanie płowe');
});

test('cień brył chmur na gruncie: materiał zbliżenia liczy te same kłęby (szum 3D, klucze bryły)', () => {
  const t = describePlanet({ type: 'terran', seed: 21 });
  const TU = nearSurfaceUniforms(t, { day: new THREE.Texture(), clouds: new THREE.Texture() }, { size: 2048 });
  assert.ok(TU.uGnCloudVol && TU.uGnCloudVol2);
  assert.equal(TU.uGnCloud.value.w, 0, 'domyślnie chmury płaskie');
  const m = createGenNearSurfaceMaterial(TU);
  const near = build(sphere(m), m, new THREE.PerspectiveCamera());
  assert.match(near, /texture_3d/, 'cień kłębów czyta teksturę szumu bryły');
  const src = read('src/3d/planetGen/planetGenSurfaceNear.tsl.js');
  assert.match(src, /puffShape\(xc, puffThreshold\(cov, float\(hN\)\)/, 'ten sam kształt i próg co bryła');
});

test('wypiek przed pierwszym renderem: licznik renderów podbity przed kompilacją (three r183 — numer renderu kompilacji = numer pierwszego renderu)', () => {
  // założenia obejścia w źródłach three: kompilacja bierze „poprzedni + 1”, render — licznik info.calls
  const three = readFileSync(new URL('../node_modules/three/src/renderers/common/Renderer.js', import.meta.url), 'utf8');
  const compile = three.slice(three.indexOf('async compileAsync('), three.indexOf('async renderAsync('));
  assert.match(compile, /nodeFrame\.renderId \+\+/, 'compileAsync: tymczasowy numer renderu = poprzedni + 1');
  assert.match(three, /nodeFrame\.renderId = this\.info\.calls;/, 'render: numer z licznika info.calls');
  const baker = read('src/3d/planetGen/planetGenBaker.js');
  const body = baker.slice(baker.indexOf('async compile(types)'), baker.indexOf('_draw(graphKey'));
  assert.match(body, /if \(r\.info && r\.info\.calls === 0\) r\.info\.calls = 1;/);
  assert.ok(body.indexOf('r.info.calls = 1') < body.indexOf('compileAsyncNaCelu('), 'podbicie przed kompilacją');
});

