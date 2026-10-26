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
  const { createSkyScroll, stepSkyScroll, skyViewMatrix, skyFocalPx } = await import('../src/3d/skyScroll.js');
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
  // tempo w skoku: sufit 14 tys. j/s → ~49 px CSS/s przy kadrze skoku (zoom × pxScale / pxScale)
  assert.ok(Math.abs(a.speedCss - 14000 * 0.03 * 0.12) < 1e-6, String(a.speedCss));
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
  assert.ok(Math.abs(wrk.scroll.turned - off.scroll.turned) / off.scroll.turned < 1e-4, `${wrk.scroll.turned} vs ${off.scroll.turned}`);
  assert.ok(Math.abs(wrk.speedCss - off.speedCss) < 1e-6);
  assert.ok(old.scroll.cuts > 100 || old.scroll.turned < off.scroll.turned * 0.5, 'bez zegara: cięcia albo przycięty obrót');
});

test('fregata zwiadu przy sterach: niebo z drogi prowadzonego okrętu (RenderWorld.cameraLead), przejazd kamery bez skoku', async () => {
  const { SKY_SCROLL, skyFocalPx } = await import('../src/3d/skyScroll.js');
  const core = { pxScale: 1, composerTarget: { height: 1080 }, viewZoom: (c) => c.zoom };
  const S = await makeSky(core);
  const cam = { x: 0, y: 0, zoom: 0.2133, roll: 0 };
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
  const step = 900 * dt * SKY_SCROLL.p * 0.2133 / skyFocalPx(1080);
  assert.ok(Math.abs((turnedAt[239] - turnedAt[238]) - step) / step < 1e-6);
  for (let i = 1; i < turnedAt.length; i++) assert.ok(turnedAt[i] - turnedAt[i - 1] <= step * (1 + 1e-9));
  assert.ok(Math.abs(S.speedCss - 900 * 0.03 * 0.2133) < 1e-6);
  // powrót kamery na Atlasa (w = 0): niebo stoi razem z Atlasem
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
  // warp (sufit 14 tys. j/s, kadr skoku 0,1173) przy 144 Hz: 49 px/s → 0,34 px/kl. na środku ≥ 0,25 — wprost
  const warp = fly(175000, 0.1173, 200);
  assert.ok(warp.fast >= 198 && warp.renders <= 2, JSON.stringify(warp));
  // walka (507 j/s, zoom 0,2133): 3,2 px/s → pamięć, przeliczenie co ~kilkanaście klatek
  const walka = fly(507, 0.2133, 200);
  assert.equal(walka.fast, 0);
  assert.ok(walka.reused > walka.renders * 5, JSON.stringify(walka));
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
