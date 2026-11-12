// Niebo-sfera (DECYZJE-2 N1–N3): materiały TSL budują się do WGSL bez GPU (kamera z góry z pamięcią nieba, sfera kamer 3D,
// kwady jasnych gwiazd), bez rulonu; katalog jasnych gwiazd = te same gwiazdy co siatki 3–4 na GPU; gwiazdy w przestrzeni
// kierunków — ściany sześcianu równokątne.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import {
  createSkySphereUniforms, createSkySphereFlatMaterial, createSkySphereMeshMaterial, createSkyStarQuadsMaterial,
  createSkyStarGeometry, buildSkyStarCatalog, SKY_STAR_STRIDE, skyStarDensityFromSmoothCpu, SKY_SPHERE_MATERIAL_NAMES
} from '../src/3d/skySphere.tsl.js';
import {
  SKY_SPHERE_STARS, SKY_SPHERE_TEX_PER_RAD, SKY_STARS_TUNE, skyCubeFaceCpu, skyCubeCellSolidAngleCpu, skyStarDensityCpu
} from '../src/3d/skyStars.tsl.js';

function build(material, geometry = new THREE.PlaneGeometry(2, 2)) {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const mesh = new THREE.Mesh(geometry, material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return { vs: b.vertexShader, fs: b.fragmentShader };
}

const tex = (w = 2, h = 1) => {
  const t = new THREE.DataTexture(new Uint8Array(w * h * 4).fill(20), w, h);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.flipY = false;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
};
const cacheTex = () => {
  const rt = new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  return rt.texture;
};

const ubo = (s) => (s.match(/var<uniform>/g) || []).length;

test('kamera z góry: rzut równoodległy, gwiazdy kierunków, pamięć nieba, jasność strefy, bez rulonu', () => {
  const U = createSkySphereUniforms(tex(), cacheTex());
  const m = createSkySphereFlatMaterial(U);
  assert.equal(m.name, SKY_SPHERE_MATERIAL_NAMES.flat);
  assert.equal(m.rulonBend, false, 'czworokąt pełnoekranowy — hak rulonu go nie zgina');
  const { fs } = build(m);
  for (const name of ['skyStarHash', 'acesGry', 'acesGryInv', 'atan2', 'asin']) assert.match(fs, new RegExp(name), name);
  assert.doesNotMatch(fs, /rulon/i, 'materiał nieba bez odwrotności walca');
  assert.ok(ubo(fs) <= 12, `${ubo(fs)} buforów uniformów`);
  // materiał zapisu pamięci: bez odczytu celu pamięci (cel nie może być próbkowany w passie, do którego się rysuje)
  const w = createSkySphereFlatMaterial(U, { cacheWrite: true });
  assert.equal(w.name, SKY_SPHERE_MATERIAL_NAMES.flatWrite);
  const fw = build(w).fs;
  assert.match(fw, /skyStarHash/);
  assert.ok((fw.match(/texture_2d/g) || []).length < (fs.match(/texture_2d/g) || []).length, 'zapis bez tekstury pamięci');
});

test('kamery 3D: sfera z tą samą treścią — siatki 3–4 na piksel (3 × 3), pochodne przed gałęziami', () => {
  const U = createSkySphereUniforms(tex(), cacheTex());
  const m = createSkySphereMeshMaterial(U);
  assert.equal(m.side, THREE.BackSide);
  const { fs } = build(m, new THREE.SphereGeometry(1, 8, 4));
  assert.match(fs, /skyStarHash/);
  assert.match(fs, /fwidth/);
  assert.doesNotMatch(fs, /rulon/i);
  // pochodna liczona w main przed pierwszą pętlą siatek
  const flow = fs.slice(fs.indexOf('fn main')).split('// flow')[1] || '';
  assert.ok(flow.indexOf('fwidth') >= 0 && flow.indexOf('fwidth') < flow.indexOf('for ('), 'fwidth przed pętlami');
  assert.match(fs, /textureSample/, 'equirect z filtrem (tekstura liniowa przy budowie)');
});

test('kwady jasnych gwiazd: przeplot ≤ 8 buforów, smuga z WARP_STARS, addytywnie, jeden przebieg', () => {
  const U = createSkySphereUniforms(tex(), cacheTex());
  const cat = buildSkyStarCatalog();
  const geo = createSkyStarGeometry(cat);
  const m = createSkyStarQuadsMaterial(U);
  assert.equal(m.forceSinglePass, true);
  assert.equal(m.blending, THREE.AdditiveBlending);
  const { vs, fs } = build(m, geo);
  assert.match(vs, /textureSampleLevel/, 'gęstość z tekstury w wierzchołku');
  assert.match(fs, /acesGryInv/);
  assert.ok(ubo(vs) <= 12 && ubo(fs) <= 12);
  assert.equal(geo.instanceCount, cat.count);
});

test('katalog jasnych gwiazd: liczba, jednostkowe kierunki, równomiernie na sferze, deterministyczny', () => {
  const a = buildSkyStarCatalog(1);
  const b = buildSkyStarCatalog(1);
  assert.deepEqual(a.data, b.data, 'ten sam katalog z ziarna');
  assert.ok(a.count > 8000 && a.count < 20000, `kandydaci ${a.count}`);
  const S = SKY_STAR_STRIDE;
  // jasne gwiazdy na steradian: oczekiwana liczba przy gęstości tła (densBg) w obu półkulach podobna
  let north = 0, south = 0, kept = 0;
  for (let i = 0; i < a.count; i++) {
    const x = a.data[i * S], y = a.data[i * S + 1], z = a.data[i * S + 2];
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-5);
    const t = a.data[i * S + 3];
    assert.ok(t >= 0 && t < SKY_STARS_TUNE.densMax);
    if (t < SKY_STARS_TUNE.densBg) { kept++; if (z > 0) north++; else south++; }
  }
  assert.ok(Math.abs(north - south) / kept < 0.08, `${north} / ${south}`);
  // oczekiwana liczba na całej sferze przy gęstości tła: Σ siatek 4π / komórka² · prob · densBg
  let expect = 0;
  for (let gi = SKY_SPHERE_STARS.fine; gi < SKY_SPHERE_STARS.grids.length; gi++) {
    const G = SKY_SPHERE_STARS.grids[gi];
    const cs = G.cell / SKY_SPHERE_TEX_PER_RAD;
    expect += 4 * Math.PI / (cs * cs) * G.prob * SKY_STARS_TUNE.densBg;
  }
  assert.ok(Math.abs(kept - expect) / expect < 0.08, `${kept} vs ${expect.toFixed(0)}`);
});

test('ściany sześcianu: oś + osie u, v; kąt bryłowy komórki 0,71–1', () => {
  const B = new Float64Array(9);
  for (const [d, face] of [[[1, 0.2, -0.3], 0], [[-2, 1, 1], 1], [[0.1, 3, 0], 2], [[0, -1, 0.5], 3], [[0.2, 0.1, 1], 4], [[0, 0, -1], 5]]) {
    assert.equal(skyCubeFaceCpu(d, B), face);
    const m = Math.abs(d[0] * B[0] + d[1] * B[1] + d[2] * B[2]);
    // d / |d_A| = A + B·u + C·v, |u|, |v| ≤ 1
    const u = (d[0] * B[3] + d[1] * B[4] + d[2] * B[5]) / m;
    const v = (d[0] * B[6] + d[1] * B[7] + d[2] * B[8]) / m;
    assert.ok(Math.abs(u) <= 1 && Math.abs(v) <= 1);
  }
  assert.ok(Math.abs(skyCubeCellSolidAngleCpu(0, 0) - 1) < 1e-12);
  assert.ok(Math.abs(skyCubeCellSolidAngleCpu(Math.PI / 4, 0) - Math.SQRT1_2) < 1e-12);
  assert.ok(skyCubeCellSolidAngleCpu(Math.PI / 4, Math.PI / 4) > 0.7);
});

test('gęstość z gładkiego nieba = gęstość płaszczyzny (ta sama funkcja jasności)', () => {
  for (const l of [0, 0.002, 0.01, 0.02, 0.05]) {
    assert.ok(Math.abs(skyStarDensityFromSmoothCpu([l, l, l]) - skyStarDensityCpu(l)) < 1e-9);
  }
});

test('tryb nieba z adresu (działa też w workerze — RenderWorld.pageSearch): sfera domyślnie, płaska do A/B', async () => {
  const { skySphereModeFrom, SKY_SPHERE_DEFAULT_MODE } = await import('../src/3d/sky3D.js');
  assert.equal(SKY_SPHERE_DEFAULT_MODE, 'sfera');
  assert.equal(skySphereModeFrom('?dev=1&niebo=plaska'), 'plaska');
  assert.equal(skySphereModeFrom('?niebo=sfera&renderWorker=1'), 'sfera');
  assert.equal(skySphereModeFrom('?niebo=xyz'), SKY_SPHERE_DEFAULT_MODE);
  assert.equal(skySphereModeFrom(''), SKY_SPHERE_DEFAULT_MODE);
  assert.equal(skySphereModeFrom(undefined, 'plaska'), 'plaska');
});

/** Egzemplarz SkySphere z własnym stanem (bez tekstury i siatek — klatka i hak passa na atrapach). */
async function makeSky(core) {
  const { SkySphere } = await import('../src/3d/sky3D.js');
  const { createSkyScroll, createSkyTrack } = await import('../src/3d/skyScroll.js');
  const S = Object.create(SkySphere);
  Object.assign(S, {
    active: true, core, U: createSkySphereUniforms(tex(), cacheTex()), flat: { visible: false, material: null }, stars: { visible: false },
    scroll: createSkyScroll(), leadTrack: createSkyTrack(), leadW: 0, viewM: new Float64Array(9), prevViewM: new Float64Array(9),
    hasPrevView: false, frameAngle: 0, split: false, cam2: null, scroll2: createSkyScroll(), viewM2: new Float64Array(9),
    _dA: new Float64Array(2), _dB: new Float64Array(2), cacheStats: { renders: 0, reused: 0, direct: 0, fast: 0, split: 0 },
    cacheM: new Float64Array(9), cacheValid: false, cacheFine: -1, cacheTexVersion: -1, texture: null,
    _clockHas: false, _clockLast: 0
  });
  return S;
}

test('determinizm (podstawa parzystości off ≡ worker): obrót tylko z wejść klatki — dwa egzemplarze, te same macierze = lustro CPU', async () => {
  // Wejścia off (__interpShipPose, ship.vel) i workera (HEAD.INTERP_*, lustro EF.VEL) to te same liczby strony — ścieżki
  // ich przekazania sprawdzają workerPlayerPose.test.mjs i snapshotPack.test.mjs; tu: ten sam stan z tych samych wejść.
  const { createSkyScroll, stepSkyScroll, skyViewMatrix, skyFocalPx, skyScreenSpeed } = await import('../src/3d/skyScroll.js');
  const core = { pxScale: 1.25, composerTarget: { height: 1350 }, viewZoom: (c) => c.zoom * 1.25 };
  const run = async () => {
    const S = await makeSky(core);
    const cam = { x: 0, y: 0, zoom: 0.3, roll: 0 };
    for (let i = 0; i < 300; i++) {
      cam.roll = i > 150 ? 1.1 : 0;
      cam.zoom = i > 100 ? 0.12 : 0.3;
      const v = i > 100 ? 150000 : 500;
      S.update(1 / 60, cam, { x: 1000 + i * v / 60, y: 2000 - i * 40 / 60 }, v, 0.9, true);
    }
    return S;
  };
  const a = await run();
  const b = await run();
  assert.deepEqual(Array.from(a.U.viewMat.value.elements), Array.from(b.U.viewMat.value.elements));
  assert.equal(a.flat.visible, true);
  assert.equal(a.U.brightness.value, 0.9);
  // ta sama czysta funkcja (skyScroll.js) z tymi samymi wejściami — macierz w uniformie = lustro CPU
  const sc = createSkyScroll();
  for (let i = 0; i < 300; i++) {
    const v = i > 100 ? 150000 : 500;
    stepSkyScroll(sc, 1000 + i * v / 60, 2000 - i * 40 / 60, v, 1 / 60, (i > 100 ? 0.12 : 0.3) * 1.25, skyFocalPx(1350), 1.25);
  }
  const m = skyViewMatrix(sc, 1.1, new Float64Array(9));
  const e = a.U.viewMat.value.elements;   // kolumnami
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) assert.ok(Math.abs(e[c * 3 + r] - m[r * 3 + c]) < 1e-6);
  // tempo w skoku (stan ustalony po 3,3 s ≫ wygładzenie 0,15 s): droga nieba vN(150 tys.) · p · zoom skoku (px CSS)
  const want = skyScreenSpeed(150000, 0.12);
  assert.ok(Math.abs(a.speedCss - want) / want < 1e-6, `${a.speedCss} vs ${want}`);
});

test('worker pomija strony: czas kroku z zegara klatek (HEAD.T_FRAME) — ten sam obrót co off, bez fałszywych cięć', async () => {
  const core = { pxScale: 1, composerTarget: { height: 1080 }, viewZoom: (c) => c.zoom };
  const off = await makeSky(core);
  const wrk = await makeSky(core);
  const old = await makeSky(core);   // worker bez zegara (dawne zachowanie: dt jednej strony)
  const cam = { x: 0, y: 0, zoom: 0.1173, roll: 0 };
  const dt = 1 / 240;
  let clock = 0;
  const pose = { x: 0, y: 0 };
  for (let k = 0; k <= 2400; k++) {
    const v = k < 600 ? 500 : Math.min(175000, 500 + (k - 600) * 300);   // walka, potem rampa warpa (przez sufit 14 tys.)
    pose.x += v * dt;
    clock += dt;
    off.update(dt, cam, pose, v, 1, true);
    if (k % 4 === 0) {   // worker rysuje co 4. stronę (najnowszą; ta sama pierwsza i ostatnia), dt klatki = dt jednej strony
      wrk.update(dt, cam, pose, v, 1, true, null, null, clock);
      old.update(dt, cam, pose, v, 1, true);
    }
  }
  assert.equal(off.scroll.cuts, 0);
  assert.equal(wrk.scroll.cuts, 0, 'pominięte strony to nie teleport');
  // wygładzenie drogi nieba liczone z czasu stron: worker (co 4. strona) = off z dokładnością do próbkowania rampy
  assert.ok(Math.abs(wrk.scroll.turned - off.scroll.turned) / off.scroll.turned < 2e-3, `${wrk.scroll.turned} vs ${off.scroll.turned}`);
  assert.ok(Math.abs(wrk.speedCss - off.speedCss) / off.speedCss < 1e-6, `${wrk.speedCss} vs ${off.speedCss}`);
  assert.ok(old.scroll.cuts > 100 || old.scroll.turned < off.scroll.turned * 0.6,
    `bez zegara: cięcia albo przycięty obrót (${old.scroll.turned / off.scroll.turned})`);
});

test('fregata zwiadu przy sterach: niebo z drogi prowadzonego okrętu (RenderWorld.cameraLead), przejazd kamery bez skoku', async () => {
  const { SKY_SCROLL, skyFocalPx, skyDriveSpeed } = await import('../src/3d/skyScroll.js');
  const core = { pxScale: 1, composerTarget: { height: 1080 }, viewZoom: (c) => c.zoom };
  const S = await makeSky(core);
  const cam = { x: 0, y: 0, zoom: 0.2133, roll: 0 };
  const vN = skyDriveSpeed(900);   // droga nieba okrętu 900 j/s (z członem zwykłego lotu)
  const dt = 1 / 60;
  const atlas = { x: 5e6, y: 3e6 };
  const lead = { x: atlas.x, y: atlas.y - 300, v: 0, w: 0 };
  // Atlas stoi, fregata leci 900 j/s; kamera przejeżdża nad fregatę (w 0 → 1 jak scoutCamW: 1 − e^(−3,2 dt))
  const turnedAt = [];
  for (let i = 0; i < 240; i++) {
    lead.w = i < 10 ? 0 : Math.min(1, lead.w + (1 - lead.w) * (1 - Math.exp(-3.2 * dt)));
    if (lead.w > 0.999) lead.w = 1;
    lead.x += 900 * dt; lead.v = 900;
    S.update(dt, cam, atlas, 0, 1, true, lead.w > 0 ? lead : null);
    turnedAt.push(S.scroll.turned);
  }
  assert.equal(S.scroll.cuts, 0, 'przejazd kamery nie jest cięciem');
  // pełna waga: tempo jak dla okrętu 900 j/s; skoki między klatkami ≤ krok pełnej wagi (bez szarpnięcia)
  // (droga nieba wygładzona 0,15 s — dochodzi do kroku pełnej wagi od dołu)
  const step = vN * dt * SKY_SCROLL.p * 0.2133 / skyFocalPx(1080);
  assert.ok(Math.abs((turnedAt[239] - turnedAt[238]) - step) / step < 1e-3);
  for (let i = 1; i < turnedAt.length; i++) assert.ok(turnedAt[i] - turnedAt[i - 1] <= step * (1 + 1e-9));
  const want = vN * SKY_SCROLL.p * 0.2133;
  assert.ok(Math.abs(S.speedCss - want) / want < 1e-3, String(S.speedCss));
  // powrót kamery na Atlasa (w = 0): niebo stoi razem z Atlasem (straż W0 — prędkość prowadzonego okrętu 0)
  const t0 = S.scroll.turned;
  for (let i = 0; i < 30; i++) { lead.x += 900 * dt; S.update(dt, cam, atlas, 0, 1, true, null); }
  assert.equal(S.scroll.turned, t0);
});

test('podzielony ekran: gracz 2 z własnym niebem (droga, zoom) — hak passa tła ustawia widok przed każdym renderSingle, bez pamięci', async () => {
  const cam2 = { x: 0, y: 0, zoom: 0.2133 };
  const core = {
    pxScale: 1, composerTarget: { width: 1920, height: 1080 }, viewZoom: (c) => c.zoom, activeCam1: null, renderer: {}
  };
  const S = await makeSky(core);
  S.cacheTarget = { width: 1920, height: 1080 };
  S.flat.visible = true;
  S.cacheWriteReady = true;
  const cam1 = { x: 0, y: 0, zoom: 0.2133, roll: 0 };
  const dt = 1 / 60;
  const p2 = { cam: cam2, x: 1e6, y: 0, v: 900 };
  for (let i = 0; i < 120; i++) {
    p2.x += 900 * dt;
    S.update(dt, cam1, { x: 0, y: 0 }, 0, 1, true, null, p2);   // gracz 1 stoi, gracz 2 leci
  }
  assert.equal(S.split, true);
  assert.equal(S.scroll.turned, 0, 'niebo gracza 1 stoi');
  assert.ok(S.scroll2.turned > 0, 'niebo gracza 2 obraca się z jego drogi');
  const m1 = Array.from(S.U.viewMat.value.elements);
  core.activeCam1 = cam2;   // renderSingle(Core3D.activeCam2)
  S.cacheHook(null);
  const m2 = Array.from(S.U.viewMat.value.elements);
  assert.notDeepEqual(m2, m1, 'widok gracza 2');
  assert.equal(S.U.cacheMode.value, 0, 'podzielony ekran — wprost');
  core.activeCam1 = cam1;
  S.cacheHook(null);
  assert.deepEqual(Array.from(S.U.viewMat.value.elements), m1, 'widok gracza 1');
  assert.equal(S.cacheStats.split, 2);
  // koniec podziału: stan gracza 2 zapomina drogę (ponowny podział bez obrotu o skok położenia)
  S.update(dt, cam1, { x: 0, y: 0 }, 0, 1, true, null, null);
  assert.equal(S.split, false);
  assert.equal(S.scroll2.track.has, false);
});

test('pamięć nieba: niebo płynące ≥ progu na klatkę (warp, obrót kadru) — wprost; wolne — pamięć z przeliczeniem co kilka klatek', async () => {
  const { SKY_SCROLL } = await import('../src/3d/skyScroll.js');
  const renders = [];
  const core = {
    pxScale: 1, composerTarget: { width: 1920, height: 1080 }, viewZoom: (c) => c.zoom, activeCam1: null,
    renderer: { getRenderTarget: () => null, setRenderTarget() {}, render: () => renders.push(1) }
  };
  const S = await makeSky(core);
  S.cacheTarget = { width: 1920, height: 1080 };
  S.flat.visible = true;
  S.cacheWriteReady = true;
  S.cacheWriteMaterial = {};
  const dt = 1 / 144;
  const fly = (v, zoom, n, roll = () => 0) => {
    const st0 = { ...S.cacheStats };
    const cam = { zoom, roll: 0 };
    let x = 0;
    S.scroll.track.has = false;
    S.scroll.vDrive = 0;   // każdy przebieg od postoju (bez dobiegu drogi nieba z poprzedniego)
    for (let i = 0; i < n; i++) {
      cam.roll = roll(i);
      x += v * dt;
      S.update(dt, cam, { x, y: 0 }, v, 1, true);
      S.cacheHook(null);
    }
    const d = {};
    for (const k of Object.keys(st0)) d[k] = S.cacheStats[k] - st0[k];
    return d;
  };
  // warp Mk II (kadr skoku 0,1173) przy 144 Hz: 267 px/s → 1,9 px/kl. na środku ≥ 0,25 — wprost (bez pierwszych klatek
  // rozpędu drogi nieba z postoju)
  const warp = fly(175000, 0.1173, 200);
  assert.ok(warp.fast >= 195 && warp.renders <= 3, JSON.stringify(warp));
  // walka (507 j/s, zoom 0,2133): 25,1 px/s (człon zwykłego lotu) → 0,17 px/kl. przy 144 Hz — dalej pamięć (< 0,25),
  // przeliczenie co ~1,4 klatki; powolny lot (150 j/s → 7,8 px/s, 0,054 px/kl.) — przeliczenie co ~4–5 klatek
  const walka = fly(507, 0.2133, 200);
  assert.equal(walka.fast, 0);
  assert.ok(walka.reused > 0 && walka.renders < 200, JSON.stringify(walka));
  const wolno = fly(150, 0.2133, 200);
  assert.equal(wolno.fast, 0);
  assert.ok(wolno.reused > wolno.renders * 2, JSON.stringify(wolno));
  // obrót kadru w postoju (hipercruise: obrót do kursu) — wprost
  const roll = fly(0.001, 0.2133, 60, (i) => i * 0.01);
  assert.ok(roll.fast >= 58, JSON.stringify(roll));
  assert.ok(SKY_SCROLL.cacheTolPx > 0);
});

test('gwiazdy GameStars: tryb sfery zwija warstwę deep (paralaksa < 0,04) w wierzchołku — bez nowego pipeline’u', async () => {
  const { createStarMaterial, createStarGeometry, STAR_PLANET_MASK_CAP } = await import('../src/3d/planet3d.assets.tsl.js');
  const { uniformsAdapter } = await import('../src/3d/tsl/uniformy.js');
  const { texture, uniform, uniformArray, vec2 } = await import('three/tsl');
  const u = uniformsAdapter({
    pointTexture: texture(tex(), vec2(0.0)), time: uniform(0), cameraOffset: uniform(new THREE.Vector2()), containerSize: uniform(220000),
    perspectiveScale: uniform(800), globalBrightness: uniform(1), warpFactor: uniform(0), moveDir: uniform(new THREE.Vector2(0, 1)),
    stretchStrength: uniform(20), zoomComp: uniform(1), exitWhipFactor: uniform(0), exitWhipStrength: uniform(1.75),
    viewportSize: uniform(new THREE.Vector2(1, 1)), thinningStrength: uniform(38), baseSizeMul: uniform(1.65),
    hideDeep: uniform(1.0),
    planetMasks: uniformArray(Array.from({ length: STAR_PLANET_MASK_CAP }, () => new THREE.Vector4()), 'vec4')
  });
  const n = 4;
  const geo = createStarGeometry({
    starPos: new Float32Array(n * 3), size: new Float32Array(n).fill(1), brightness: new Float32Array(n).fill(1), color: new Float32Array(n * 3).fill(1),
    parallaxFactor: new Float32Array([0.01, 0.03, 0.06, 1.2]), layerSizeMul: new Float32Array(n).fill(1), layerBrightnessMul: new Float32Array(n).fill(1),
    layerStretchMul: new Float32Array(n).fill(1)
  }, n);
  const { vs } = build(createStarMaterial(u), geo);
  assert.match(vs, /0\.04/, 'próg paralaksy deep / mid');
  assert.match(vs, /vec4<f32>\( 2\.0, 2\.0, 2\.0, 1\.0 \)/, 'wierzchołek poza bryłą obcinania');
});

test('gwiazdy tła na początku passa tła — nieprzezroczyste z mieszaniem addytywnym, POD bryłami tła (ring, doki K-7, planetoida)', async () => {
  // Zgłoszenie 2026-11-03 („gwiazdy tła przebijają się przez doki, ring, planetę w misji 1”): listę przezroczystych three
  // rysuje PO wszystkich nieprzezroczystych passa, a renderOrder sortuje tylko w obrębie listy — przezroczyste jasne gwiazdy
  // (bez testu głębi) i GameStars kładły się na bryłach passa tła. Prawdziwa lista renderu three i kolejność z kodu gry.
  const { readFileSync } = await import('node:fs');
  const { default: RenderList } = await import('three/src/renderers/common/RenderList.js');
  const { createStarMaterial, createStarGeometry, STAR_PLANET_MASK_CAP } = await import('../src/3d/planet3d.assets.tsl.js');
  const { uniformsAdapter } = await import('../src/3d/tsl/uniformy.js');
  const { texture, uniform, uniformArray, vec2 } = await import('three/tsl');
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const order = (src, re) => { const m = src.match(re); assert.ok(m, `renderOrder ${re}`); return Number(m[1]); };
  const sky = read('../src/3d/sky3D.js');
  const flatOrder = order(sky, /flat\.renderOrder = (-?\d+);/);
  const starsOrder = order(sky, /stars\.renderOrder = (-?\d+);/);
  const gameOrder = order(read('../src/3d/planet3d.assets.js'), /this\.mesh\.name = 'GameStars'; this\.mesh\.renderOrder = (-?\d+);/);
  const U = createSkySphereUniforms(tex(), cacheTex());
  const u = uniformsAdapter({
    pointTexture: texture(tex(), vec2(0.0)), time: uniform(0), cameraOffset: uniform(new THREE.Vector2()), containerSize: uniform(220000),
    perspectiveScale: uniform(800), globalBrightness: uniform(1), warpFactor: uniform(0), moveDir: uniform(new THREE.Vector2(0, 1)),
    stretchStrength: uniform(20), zoomComp: uniform(1), exitWhipFactor: uniform(0), exitWhipStrength: uniform(1.75),
    viewportSize: uniform(new THREE.Vector2(1, 1)), thinningStrength: uniform(38), baseSizeMul: uniform(1.65),
    hideDeep: uniform(1.0),
    planetMasks: uniformArray(Array.from({ length: STAR_PLANET_MASK_CAP }, () => new THREE.Vector4()), 'vec4')
  });
  const n = 1;
  const starGeo = createStarGeometry({
    starPos: new Float32Array(3), size: new Float32Array(n), brightness: new Float32Array(n), color: new Float32Array(3),
    parallaxFactor: new Float32Array(n), layerSizeMul: new Float32Array(n), layerBrightnessMul: new Float32Array(n),
    layerStretchMul: new Float32Array(n)
  }, n);
  const mesh = (geo, mat, ro) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = ro; return m; };
  const flat = mesh(new THREE.PlaneGeometry(2, 2), createSkySphereFlatMaterial(U), flatOrder);
  const quads = mesh(createSkyStarGeometry(buildSkyStarCatalog()), createSkyStarQuadsMaterial(U), starsOrder);
  const game = mesh(starGeo, createStarMaterial(u), gameOrder);
  const body = mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial(), 0);   // bryła tła: ring, hala K-7, skała
  const list = new RenderList({ getNode: () => ({ setLights() {} }) }, new THREE.Scene(), new THREE.PerspectiveCamera());
  list.begin();
  // bryła bliżej kamery (z mniejsze) — kolejność i tak z renderOrder
  for (const [m, z] of [[body, -1], [game, 0], [quads, 0], [flat, 0]]) list.push(m, m.geometry, m.material, 0, z, null, null);
  list.sort();
  assert.deepEqual(list.transparent.map((r) => r.object.material.name), [], 'gwiazdy nie w liście przezroczystych');
  assert.deepEqual(list.opaque.map((r) => r.object), [flat, quads, game, body], 'niebo → jasne gwiazdy → GameStars → bryły');
  for (const m of [quads.material, game.material]) {
    assert.equal(m.blending, THREE.AdditiveBlending);
    assert.equal(m.depthWrite, false);
  }
  // three r183 miesza każde mieszanie ≠ Normal także bez `transparent` (inaczej gwiazdy zastępowałyby niebo pod sobą)
  const pu = read('../node_modules/three/src/renderers/webgpu/utils/WebGPUPipelineUtils.js');
  assert.match(pu, /material\.blending !== NoBlending && \( material\.blending !== NormalBlending \|\| material\.transparent !== false \)/);
});

test('prawo tempa z adresu (?nieboTempo) — off ≡ worker: te same wejścia i ten sam adres dają te same macierze; stare = dawne liczby', async () => {
  const { skyScreenSpeed, skyStarStreakPx, SKY_SCROLL, SKY_SCROLL_STARE, SKY_SCROLL_BEZ_SUFITU } = await import('../src/3d/skyScroll.js');
  const { WARP_STARS } = await import('../src/3d/warp/stars.js');
  const core = { pxScale: 1, composerTarget: { height: 1080 }, viewZoom: (c) => c.zoom };
  const run = async (search, clockStep = 1) => {
    const S = await makeSky(core);
    S.applyTempo(search);
    const cam = { x: 0, y: 0, zoom: 0.1173, roll: 0 };
    const dt = 1 / 240;
    let clock = 0;
    const pose = { x: 0, y: 0 };
    for (let k = 0; k <= 1440; k++) {
      const v = k < 240 ? 507 : Math.min(175000, 507 + (k - 240) * 600);
      pose.y -= v * dt;
      clock += dt;
      // clockStep 1 — tryb off (każda strona), 3 — worker rysuje co 3. stronę z zegara stron
      if (k % clockStep === 0) S.update(dt, cam, pose, v, 1, true, null, null, clockStep > 1 ? clock : null);
    }
    return S;
  };
  for (const search of ['', '?nieboTempo=stare', '?nieboTempo=2', '?nieboTempo=0.5']) {
    const a = await run(search);
    const b = await run(search);
    assert.deepEqual(Array.from(a.U.viewMat.value.elements), Array.from(b.U.viewMat.value.elements), search);
    const w = await run(search, 3);
    assert.ok(Math.abs(w.scroll.turned - a.scroll.turned) / a.scroll.turned < 2e-3, `${search}: worker ${w.scroll.turned} vs off ${a.scroll.turned}`);
  }
  const nowe = await run('');
  const stare = await run('?nieboTempo=stare');
  const x2 = await run('?nieboTempo=2');
  assert.equal(nowe.tune, SKY_SCROLL);
  assert.equal(stare.tune, SKY_SCROLL_STARE);
  assert.equal(nowe.midSphere, true);
  assert.equal(stare.midSphere, false, 'dawne prawo — dawna warstwa mid na kamerze gwiazd');
  assert.equal(x2.midMul, 2);
  // stan ustalony w warpie Mk II: stare = sufit 14 tys. · 0,03 · zoom (49,3 px/s), nowe = vN · 0,1 · zoom, ×2 — dwa razy
  assert.ok(Math.abs(stare.speedCss - 14000 * 0.03 * 0.1173) < 1e-6, String(stare.speedCss));
  const want = skyScreenSpeed(175000, 0.1173);
  assert.ok(Math.abs(nowe.speedCss - want) / want < 1e-6, `${nowe.speedCss} vs ${want}`);
  assert.ok(Math.abs(x2.speedCss / nowe.speedCss - 2) < 1e-9);
  assert.ok(nowe.scroll.turned > 4 * stare.scroll.turned);
  // smuga jasnych gwiazd w uniformie: ruch nieba w ekspozycji, najmniej dawna 0,22 · stretchPx (1080p warp Mk II: ruch
  // 13,4 px < 16,3 — dawna; ×2 — 26,7 px), stare — 0,22 · stretchPx
  assert.ok(Math.abs(nowe.U.streakLen.value - skyStarStreakPx(nowe.scroll.speedPx, 1)) < 1e-9);
  assert.ok(Math.abs(nowe.U.streakLen.value - WARP_STARS.stretchPx.value * 0.22) < 1e-9, String(nowe.U.streakLen.value));
  assert.ok(Math.abs(x2.U.streakLen.value - 26.7) < 0.1, String(x2.U.streakLen.value));
  assert.ok(Math.abs(stare.U.streakLen.value - WARP_STARS.stretchPx.value * 0.22) < 1e-9);
  // ?nieboSufit=0 — nowe prawo bez sufitu głębi (tu kadr skoku 16:9 — sufit i tak nie działa: to samo tempo)
  const bez = await run('?nieboSufit=0');
  assert.equal(bez.tune, SKY_SCROLL_BEZ_SUFITU);
  assert.ok(Math.abs(bez.speedCss - nowe.speedCss) < 1e-9);
  // tryb płaski: tempo z adresu bez warstwy mid na drodze nieba
  const { SkySphere } = await import('../src/3d/sky3D.js');
  const P = Object.create(SkySphere);
  P.active = false;
  P.applyTempo('?niebo=plaska&nieboTempo=2');
  assert.equal(P.midSphere, false);
});

test('kwady jasnych gwiazd: długość smugi z uniformu streakLen (bez nowego pipeline’u przy zmianie tempa)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/3d/skySphere.tsl.js', import.meta.url), 'utf8');
  const quads = src.slice(src.indexOf('export function createSkyStarQuadsMaterial'));
  assert.match(quads, /const L = st\.mul\(U\.streakLen\)\.toVar\(\);/);
  const U = createSkySphereUniforms(tex(), cacheTex());
  assert.ok(U.streakLen && Math.abs(U.streakLen.value - 74 * 0.22) < 1e-9);
});

test('gwiazdy GameStars: tryb sfery z nowym prawem — warstwa mid na drodze nieba (cameraOffsetMid, paralaksa 0,13–0,26) maską, bez gałęzi', async () => {
  const { createStarMaterial, createStarGeometry, STAR_PLANET_MASK_CAP } = await import('../src/3d/planet3d.assets.tsl.js');
  const { uniformsAdapter } = await import('../src/3d/tsl/uniformy.js');
  const { texture, uniform, uniformArray, vec2 } = await import('three/tsl');
  const mk = (extra) => uniformsAdapter({
    pointTexture: texture(tex(), vec2(0.0)), time: uniform(0), cameraOffset: uniform(new THREE.Vector2()), containerSize: uniform(220000),
    perspectiveScale: uniform(800), globalBrightness: uniform(1), warpFactor: uniform(0), moveDir: uniform(new THREE.Vector2(0, 1)),
    stretchStrength: uniform(20), zoomComp: uniform(1), exitWhipFactor: uniform(0), exitWhipStrength: uniform(1.75),
    viewportSize: uniform(new THREE.Vector2(1, 1)), thinningStrength: uniform(38), baseSizeMul: uniform(1.65),
    hideDeep: uniform(1.0), ...extra,
    planetMasks: uniformArray(Array.from({ length: STAR_PLANET_MASK_CAP }, () => new THREE.Vector4()), 'vec4')
  });
  const n = 4;
  const geo = () => createStarGeometry({
    starPos: new Float32Array(n * 3), size: new Float32Array(n).fill(1), brightness: new Float32Array(n).fill(1), color: new Float32Array(n * 3).fill(1),
    parallaxFactor: new Float32Array([0.01, 0.06, 0.15, 1.2]), layerSizeMul: new Float32Array(n).fill(1), layerBrightnessMul: new Float32Array(n).fill(1),
    layerStretchMul: new Float32Array(n).fill(1)
  }, n);
  const plain = build(createStarMaterial(mk({})), geo()).vs;
  const sphere = build(createStarMaterial(mk({ midSphere: uniform(1.0), cameraOffsetMid: uniform(new THREE.Vector2()) })), geo()).vs;
  assert.doesNotMatch(plain, /1\.04/, 'bez uniformów sfery — dawny graf');
  assert.match(sphere, /1\.04/, 'nachylenie przesunięcia paralaksy mid (0,13 / 0,125)');
  assert.match(sphere, /\bstep\(/, 'maska 0 / 1 (bez gałęzi)');
  assert.ok(ubo(sphere) <= ubo(plain) + 0, 'uniformy w tym samym buforze');
});

test('pauza i worldFrozen: gra woła render z dt > 0 przy stojącej pozie — niebo i droga mid stoją (off i worker), sufit głębi na 32:9', async () => {
  const core = { pxScale: 1, composerTarget: { height: 1440 }, viewZoom: (c) => c.zoom };
  for (const worker of [false, true]) {
    const S = await makeSky(core);
    S.applyTempo('');
    const cam = { x: 0, y: 0, zoom: 0.1173 * 1440 / 1080, roll: 0 };
    const dt = 1 / 144;
    let clock = 0;
    const pose = { x: 0, y: 0 };
    for (let k = 0; k < 432; k++) { pose.y -= 175000 * dt; clock += dt; S.update(dt, cam, pose, 175000, 1, true, null, null, worker ? clock : null); }
    const t0 = S.scroll.turned;
    const vd = S.scroll.vDrive;
    const up0 = S.updates;
    // pauza 2 s: poza stoi, prędkość w stanie 175 tys., zegar stron rośnie (HEAD.T_FRAME), dt klatki > 0
    for (let k = 0; k < 288; k++) {
      clock += dt;
      S.update(dt, cam, pose, 175000, 1, true, null, null, worker ? clock : null);
      assert.ok(S.scroll.driveX === 0 && S.scroll.driveY === 0, 'mid bez drogi nieba w pauzie');
    }
    assert.equal(S.scroll.turned, t0, worker ? 'worker' : 'off');
    assert.equal(S.scroll.vDrive, vd);
    assert.equal(S.speedCss, 0);
    assert.equal(S.updates, up0 + 288, 'klatki nieba liczone (StarSystem bierze drogę tylko z nowej)');
  }
  // 32:9 1440p w walce (zoom 0,569): sufit głębi — niebo 0,0557 zamiast 0,1 (kątowo jak 16:9)
  const S = await makeSky(core);
  S.applyTempo('');
  const cam = { x: 0, y: 0, zoom: 0.2 * 5120 / 1800, roll: 0 };
  const pose = { x: 0, y: 0 };
  for (let k = 0; k < 600; k++) { pose.x += 507 / 144; S.update(1 / 144, cam, pose, 507, 1, true, null, null, null); }
  assert.ok(Math.abs(S.scroll.pEff - 0.0557) < 1e-3, String(S.scroll.pEff));
  const B = await makeSky(core);
  B.applyTempo('?nieboSufit=0');
  const pb = { x: 0, y: 0 };
  for (let k = 0; k < 600; k++) { pb.x += 507 / 144; B.update(1 / 144, cam, pb, 507, 1, true, null, null, null); }
  assert.equal(B.scroll.pEff, 0.1);
  assert.ok(B.speedCss > 1.7 * S.speedCss, `${B.speedCss} vs ${S.speedCss}`);
});
