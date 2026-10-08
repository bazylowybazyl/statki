// Wypiekacz nieba (src/3d/skybake/): lustra CPU barwy gry, hasz, nastawy stylu i budowa WGSL passów w Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import {
  SKY_DISPLAY_MAX, acesGryCpu, acesGryInvCpu, srgbEncodeCpu, srgbDecodeCpu, gameDisplayFromByteCpu
} from '../src/3d/skybake/skyGameColor.js';
import { skyHashCpu } from '../src/3d/skybake/skyBakeNoise.js';
import { SkyBaker, SKY_GAME_SIZE } from '../src/3d/skybake/skyBaker.js';
import {
  createGalaktykaStyle, GALAKTYKA_PARAMS, GALAKTYKA_COLORS, GALAKTYKA_DEFAULTS, GALAKTYKA_PRESETS
} from '../src/3d/skybake/styleGalaktyka.js';
import {
  createMglawicaStyle, MGLAWICA_PARAMS, MGLAWICA_COLORS, MGLAWICA_DEFAULTS, MGLAWICA_PRESETS
} from '../src/3d/skybake/styleMglawica.js';

/** Buduje WGSL fragmentu materiału passu bez GPU (NodeBuilder backendu WebGPU w Node). */
function buildFragment(renderer, material) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = scene;
  b.camera = camera;
  b.context.material = material;
  b.build();
  return b.fragmentShader;
}

function fakeRenderer() {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  return renderer;
}

/** Nastawy stylu: klucze znane, wartości w zakresach suwaków, barwy vec3. */
function checkPresets(params, colors, defaults, presets) {
  const keys = new Set([...params.map((p) => p[0]), ...colors.map((c) => c[0])]);
  assert.equal(keys.size, params.length + colors.length, 'klucze bez powtórzeń');
  const ranges = new Map(params.map(([k, , min, max]) => [k, [min, max]]));
  const check = (name, values) => {
    for (const [k, v] of Object.entries(values)) {
      assert.ok(keys.has(k), `${name}: nieznany klucz ${k}`);
      if (ranges.has(k)) {
        const [min, max] = ranges.get(k);
        assert.ok(v >= min && v <= max, `${name}.${k} = ${v} poza [${min}, ${max}]`);
      } else {
        assert.ok(Array.isArray(v) && v.length === 3, `${name}.${k}: barwa vec3`);
      }
    }
  };
  check('domyślne', defaults);
  for (const [name, p] of Object.entries(presets)) check(name, p);
  assert.ok(defaults.biel <= SKY_DISPLAY_MAX + 1e-9, 'biel ≤ acesGry(1)');
}

test('odwrotność acesGry: obraz → tekstura → obraz (cały zakres wyświetlany)', () => {
  assert.ok(Math.abs(SKY_DISPLAY_MAX - acesGryCpu(1)) < 1e-12);
  for (let i = 0; i <= 400; i++) {
    const y = SKY_DISPLAY_MAX * i / 400;
    const x = acesGryInvCpu(y);
    assert.ok(x >= 0 && x <= 1, `tekstura w [0, 1] dla y=${y}`);
    assert.ok(Math.abs(acesGryCpu(x) - y) < 1e-6, `y=${y} → x=${x} → ${acesGryCpu(x)}`);
  }
  for (let i = 0; i <= 200; i++) {
    const x = i / 200;
    assert.ok(Math.abs(acesGryInvCpu(acesGryCpu(x)) - x) < 1e-6, `x=${x}`);
  }
  assert.ok(Math.abs(acesGryInvCpu(2) - 1) < 1e-9, 'jaśniej niż acesGry(1) — tekstura 1');
});

test('gra przyciemnia głębokie czernie — po odwróceniu tekstura je unosi', () => {
  // obraz 0,01 liniowo potrzebuje tekstury ~0,019 (sRGB ~0,15) — bez odwrotności tło gry gasło
  const x = acesGryInvCpu(0.01);
  assert.ok(x > 0.018 && x < 0.021, String(x));
  assert.ok(acesGryCpu(0.01) < 0.004);
  let prev = -1;
  for (let b = 0; b < 256; b++) {
    const d = gameDisplayFromByteCpu(b);
    assert.ok(d >= prev, 'monotonicznie');
    prev = d;
  }
});

test('sRGB: kodowanie i dekodowanie odwrotne', () => {
  for (let i = 0; i <= 100; i++) {
    const v = i / 100;
    assert.ok(Math.abs(srgbDecodeCpu(srgbEncodeCpu(v)) - v) < 1e-6);
  }
});

test('skyHashCpu: deterministyczny, [0, 1), równomierny', () => {
  assert.equal(skyHashCpu(1, 2, 3), skyHashCpu(1, 2, 3));
  assert.notEqual(skyHashCpu(1, 2, 3), skyHashCpu(2, 1, 3));
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) {
    const h = skyHashCpu(i % 137, (i / 137) | 0, 11);
    assert.ok(h >= 0 && h < 1);
    sum += h;
  }
  assert.ok(Math.abs(sum / n - 0.5) < 0.01, String(sum / n));
});

test('nastawy galaktyki: klucze znane, wartości w zakresach suwaków', () => {
  checkPresets(GALAKTYKA_PARAMS, GALAKTYKA_COLORS, GALAKTYKA_DEFAULTS, GALAKTYKA_PRESETS);
});

test('nastawy mgławicy: klucze znane, wartości w zakresach suwaków', () => {
  checkPresets(MGLAWICA_PARAMS, MGLAWICA_COLORS, MGLAWICA_DEFAULTS, MGLAWICA_PRESETS);
  assert.ok(MGLAWICA_DEFAULTS.miekkosc > 0 && MGLAWICA_DEFAULTS.pylMiekk > 0, 'smoothstep z równymi krawędziami = NaN w WGSL');
});

test('mgławica apply: masy, gwiazdy-lampy i atlas z ziarna (deterministycznie, w zasięgu atlasu)', () => {
  const a = createMglawicaStyle();
  const b = createMglawicaStyle();
  const baker = { width: 2560, height: 1600 };
  a.apply({ ...MGLAWICA_PRESETS.rozeta }, 7, baker);
  b.apply({ ...MGLAWICA_PRESETS.rozeta }, 7, baker);
  assert.equal(a.U.resScale.value, 0.5);
  assert.deepEqual(a.U.atlasSize.value.toArray(), [1280, 800], 'atlas = ½ wypieku (SkyBaker.passSize)');
  assert.equal(a.U.lampCount.value, MGLAWICA_PRESETS.rozeta.gwiazdLiczba);
  assert.equal(a.U.masyCount.value, 1 + MGLAWICA_DEFAULTS.masyLiczba);
  assert.deepEqual(a.U.lampPos.array.map((v) => v.toArray()), b.U.lampPos.array.map((v) => v.toArray()));
  assert.deepEqual(a.U.masyA.array.map((v) => v.toArray()), b.U.masyA.array.map((v) => v.toArray()));
  for (const L of a.U.lampPos.array) {
    assert.ok(Math.abs(L.x) <= 0.8 * 1.15 && Math.abs(L.y) <= 0.5 * 1.15, `lampa w zasięgu atlasu: ${L.toArray()}`);
    assert.ok(Math.abs(L.z) <= MGLAWICA_DEFAULTS.grubosc + 1e-9, 'lampa w płycie albo na jej przedniej ścianie');
    assert.ok(L.w > 0, 'zmiękczenie > 0');
  }
  assert.ok(a.U.lampCol.array[0].w >= a.U.lampCol.array[1].w, 'pierwsza lampa najjaśniejsza');
  const c = createMglawicaStyle();
  c.apply({}, 8, baker);
  assert.notDeepEqual(c.U.o1.value.toArray(), a.U.o1.value.toArray(), 'inne ziarno — inne przesunięcia szumu');
  const baker2 = { width: 5120, height: 3200 };
  c.apply({}, 8, baker2);
  assert.deepEqual(c.U.atlasSize.value.toArray(), [2560, 1600]);
  // „kolorowa”: lampy w barwach palety (co najmniej 3 różne barwy), masy z odcieniem; domyślnie lampy zimna ↔ ciepła.
  const k = createMglawicaStyle();
  k.apply({ ...MGLAWICA_PRESETS.kolorowa }, 3, baker);
  const kolory = new Set(k.U.lampCol.array.slice(0, k.U.lampCount.value).map((v) => v.toArray().slice(0, 3).map((x) => x.toFixed(3)).join(',')));
  assert.ok(kolory.size >= 3, `lampy z palety: ${kolory.size} barw`);
  assert.ok(k.U.masyC.array.every((v) => v.x + v.y + v.z > 0), 'odcienie mas z palety');
  assert.equal(k.U.lampyPaleta.value, 1);
  const d = createMglawicaStyle();
  d.apply({ gwiazdLiczba: 4, gwiazdCieplo: 0.5 }, 3, baker);
  for (const v of d.U.lampCol.array.slice(0, 4)) assert.ok(v.x >= 0.72 && v.z >= 0.62, `bez palety: zimna ↔ ciepła ${v.toArray()}`);
});

test('SkyBaker: passy mgławicy budują się do WGSL (bez GPU), pasy i cele ½', () => {
  const renderer = fakeRenderer();
  const baker = new SkyBaker(renderer, { width: 256, height: 160 });
  const style = createMglawicaStyle();
  baker.setStyle(style);
  assert.equal(baker.passes.length, 6);
  const byName = Object.fromEntries(baker.passes.map((p) => [p.name, p]));
  assert.equal(byName.objetosc.strips.length, 8, 'marsz główny w 8 pasach');
  assert.equal(byName.zasieg.target.width, 128, 'zasięg w ½');
  assert.equal(byName.swiatlo1.target.width, 128, 'atlas w ½');
  assert.equal(byName.swiatlo1.target.height, 80);
  assert.equal(byName.obraz.target.width, 256);
  assert.ok(byName.zasieg.sync && byName.swiatlo1.sync, 'ciężkie passy bez pasów czekają na GPU');
  const expect = {
    zasieg: [/skyFbm3/, /skyNoise3/],
    swiatlo1: [/skyFbm3/],
    swiatlo2: [/skyFbm3/],
    objetosc: [/skyFbm3/, /skyBillow3/, /skyNoise3/, /skyHash/, /textureSampleLevel/, /textureLoad/],
    gwiazdy: [/skyHash/, /skyErf/, /skyStarTint/, /textureLoad/],
    obraz: [/skyFbm/, /textureSampleLevel/, /textureLoad/]
  };
  for (const p of baker.passes) {
    const fs = buildFragment(renderer, p.material);
    assert.match(fs, /fn main/, p.name);
    for (const re of expect[p.name] || []) assert.match(fs, re, `${p.name}: ${re}`);
    const ubo = (fs.match(/var<uniform>/g) || []).length;
    assert.ok(ubo <= 12, `${p.name}: ${ubo} buforów uniformów (limit 12 na etap)`);
    // Marsz w pętli: próbkowanie atlasu tylko z jawnym poziomem (textureSample w rozbieżnej gałęzi to błąd WGSL).
    assert.doesNotMatch(fs, /textureSample\(/, `${p.name}: textureSample bez poziomu`);
  }
});

test('SkyBaker kafel: atlas pożyczony od bazowego, gęstość i oktawy w apply, passy do WGSL', () => {
  const renderer = fakeRenderer();
  const base = new SkyBaker(renderer, { width: 256, height: 160 });
  const style = createMglawicaStyle();
  base.setStyle(style);
  // Kafel 96 × 54 pikseli nieba w gęstości 2 (pełne niebo 512 × 320), początek (100, 50).
  const tile = new SkyBaker(renderer, { width: 96, height: 54, fullWidth: 512, fullHeight: 320, shared: base, extraOctaves: 2 });
  tile.setRegion({ fullWidth: 512, fullHeight: 320, x: 100, y: 50 });
  tile.setStyle(style);
  const byName = Object.fromEntries(tile.passes.map((p) => [p.name, p]));
  assert.equal(byName.swiatlo1.target, base.target('swiatlo1'), 'atlas: cel wypiekacza bazowego');
  assert.ok(byName.swiatlo1.borrowed && byName.swiatlo2.borrowed && !byName.objetosc.borrowed);
  assert.equal(byName.zasieg.target.width, 48, 'zasięg w ½ KAFLA');
  assert.equal(byName.objetosc.target.width, 96);
  assert.deepEqual(tile.size.value.toArray(), [512, 320], 'size = pełne niebo');
  assert.deepEqual(tile.origin.value.toArray(), [100, 50]);
  assert.equal(tile.resScale, 0.1);
  style.apply({}, 1, tile);
  assert.equal(style.U.resScale.value, 0.1, 'gęstość z pełnego nieba, nie z kafla');
  assert.deepEqual(style.U.atlasSize.value.toArray(), [128, 80], 'atlas o rozmiarze bazowego');
  assert.equal(style.U.dodOkt.value, 2);
  style.apply({}, 1, base);
  assert.equal(style.U.dodOkt.value, 0, 'wypiek bazowy bez dodatkowych oktaw');
  for (const p of tile.passes.filter((q) => !q.borrowed)) {
    const fs = buildFragment(renderer, p.material);
    assert.match(fs, /fn main/, p.name);
    const ubo = (fs.match(/var<uniform>/g) || []).length;
    assert.ok(ubo <= 12, `${p.name}: ${ubo} buforów uniformów`);
    assert.doesNotMatch(fs, /textureSample\(/, `${p.name}: textureSample bez poziomu`);
  }
  // Samo położenie / gęstość kafla = uniformy (bez przebudowy); zmiana rozmiaru celu przebudowuje passy.
  const v0 = tile.version;
  tile.setRegion({ fullWidth: 1024, fullHeight: 640, x: 300, y: 120 });
  assert.equal(tile.version, v0);
  tile.setRegion({ fullWidth: 1024, fullHeight: 640, x: 300, y: 120, width: 64, height: 36 });
  assert.equal(tile.version, v0 + 1);
  assert.equal(tile.passes.find((p) => p.name === 'objetosc').target.width, 64);
  // Inny styl kafla niż bazowego — błąd (atlas z innego grafu).
  assert.throws(() => new SkyBaker(renderer, { width: 8, height: 8, shared: base }).setStyle(createMglawicaStyle()));
});

test('apply: uniformy, gromady i obłoki H II z ziarna (deterministycznie)', () => {
  const a = createGalaktykaStyle();
  const b = createGalaktykaStyle();
  const baker = { width: 2560 };
  a.apply({ ...GALAKTYKA_PRESETS.gra }, 7, baker);
  b.apply({ ...GALAKTYKA_PRESETS.gra }, 7, baker);
  assert.equal(a.U.resScale.value, 0.5);
  assert.equal(a.U.clusterCount.value, Math.round(GALAKTYKA_DEFAULTS.gromady));
  assert.equal(a.U.hiiCount.value, Math.round(GALAKTYKA_DEFAULTS.hiiLiczba));
  assert.deepEqual(a.U.clusters.array.map((v) => v.toArray()), b.U.clusters.array.map((v) => v.toArray()));
  assert.ok(Math.abs(a.U.ekspozycja.value - GALAKTYKA_PRESETS.gra.ekspozycja) < 1e-12);
  const c = createGalaktykaStyle();
  c.apply({}, 8, baker);
  assert.notDeepEqual(c.U.o1.value.toArray(), a.U.o1.value.toArray(), 'inne ziarno — inne przesunięcia szumu');
});

test('SkyBaker: passy galaktyki budują się do WGSL (bez GPU)', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const baker = new SkyBaker(renderer, { width: 256, height: 160 });
  const style = createGalaktykaStyle();
  baker.setStyle(style);
  assert.equal(baker.passes.length, 3);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();
  const expect = {
    pola: [/skyFbm/, /skyRidged/],
    gwiazdy: [/skyHash/, /skyErf/, /skyStarTint/, /textureLoad/],
    obraz: [/skyBillow/, /textureLoad/]
  };
  const materials = [...baker.passes.map((p) => [p.name, p.material]), ['tekstura', baker._texQuad.material], ['eksport', baker._expQuad.material]];
  for (const [name, material] of materials) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = material;
    b.scene = scene;
    b.camera = camera;
    b.context.material = material;
    b.build();
    const fs = b.fragmentShader;
    assert.match(fs, /fn main/, name);
    for (const re of expect[name] || []) assert.match(fs, re, `${name}: ${re}`);
    if (name === 'tekstura') assert.match(fs, /acesGryInv/);
    if (name === 'eksport') assert.match(fs, /skySrgbEncode/);
    const ubo = (fs.match(/var<uniform>/g) || []).length;
    assert.ok(ubo <= 12, `${name}: ${ubo} buforów uniformów (limit 12 na etap)`);
  }
  assert.equal(SKY_GAME_SIZE.width / SKY_GAME_SIZE.height, 1.6, 'proporcje płaszczyzny NebulaSystem');
});
