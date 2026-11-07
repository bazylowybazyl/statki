// Generator planet (src/3d/planetGen/): opis z ziarna (determinizm, zmienność strukturalna, zakresy, mgiełka bez
// fioletu), plan map i pamięć, kwantyle prób, grafy wypieku (WGSL w Node bez GPU — wszystkie przejścia, graf raz na
// klucz, bez odwróconych stałych krawędzi smoothstep i bez Math.random), olbrzymy na wspólnym silniku (graf 'genGas'
// raz dla wszystkich planet, tablice per obiekt, rodzaje gry bez zmian), pierścienie.
// node --test tests/planetGen.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { PLANET_GEN_TYPES, PLANET_GEN_TYPE_IDS, isPlanetGenType } from '../src/3d/planetGen/planetGenTypes.js';
import { describePlanet, plannedMaps, plannedBytes, srgb } from '../src/3d/planetGen/planetGenSpec.js';
import { makeRng, rngFor, mix32 } from '../src/3d/planetGen/planetGenRng.js';
import { PlanetGenBaker, weightedQuantiles } from '../src/3d/planetGen/planetGenBaker.js';
import { SOLID_TYPES } from '../src/3d/planetGen/planetGenSolid.tsl.js';
import {
  GEN_GAS_BAND_CAP, GEN_GAS_VORTEX_CAP, GEN_GAS_DATA_KEYS, GEN_GAS_UNIFORM_KEYS, GEN_GAS_GRAPH_MODEL,
  createGenGasEngine, createGenGasSurfaceMaterial, GenGasAtmosphere
} from '../src/3d/planetGen/planetGenGas.js';
import { bakeRingProfile, RING_PROFILE_TEXELS } from '../src/3d/planetGen/planetGenRing.js';
import { planetSurfaceUniforms } from '../src/3d/planetGen/planetGenBody.js';
import { PLANET_GRAPH_KEYS, PLANET_TSL_STATS, PLANET_MATERIAL_NAMES } from '../src/3d/planet3d.assets.tsl.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const DIR = 'src/3d/planetGen';
const SOURCES = readdirSync(new URL(`../${DIR}/`, import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => [f, read(`${DIR}/${f}`)]);
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.highPrecision = true;
function buildQuad(material) {
  const quad = new THREE.QuadMesh(material);
  const b = renderer.backend.createNodeBuilder(quad, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = quad.camera;
  b.context.material = material;
  b.build();
  return b.fragmentShader;
}
function buildMesh(material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return b.fragmentShader;
}

test('rodzaje: dziesięć identyfikatorów wspólnych z mapą gwiezdną, rodzaj powierzchni / olbrzym', () => {
  assert.deepEqual(PLANET_GEN_TYPE_IDS, ['terran', 'ocean', 'desert', 'rocky', 'ice', 'volcanic', 'barren', 'toxic', 'gas', 'ice_giant']);
  for (const t of PLANET_GEN_TYPES) {
    assert.ok(t.kind === 'solid' || t.kind === 'gas', t.id);
    assert.ok(t.rKm[0] > 0 && t.rKm[1] > t.rKm[0], t.id);
    if (t.kind === 'solid') assert.ok(SOLID_TYPES[t.id], `brak grafów rodzaju ${t.id}`);
  }
  assert.equal(isPlanetGenType('terran'), true);
  assert.equal(isPlanetGenType('earth'), false);
  assert.throws(() => describePlanet({ type: 'earth', seed: 1 }));
});

test('opis z ziarna: deterministyczny, różne ziarna — różna struktura (nie sama barwa)', () => {
  for (const type of PLANET_GEN_TYPE_IDS) {
    const a = describePlanet({ type, seed: 12345 });
    const b = describePlanet({ type, seed: 12345 });
    const strip = (s) => JSON.stringify({ ...s, look: { ...s.look, windAt: undefined } });
    assert.equal(strip(a), strip(b), `${type}: ten sam opis z tego samego ziarna`);
    // zmienność strukturalna: po 24 ziarnach rozrzut parametrów kształtu (nie barw)
    const specs = Array.from({ length: 24 }, (_, i) => describePlanet({ type, seed: mix32(99, i) }));
    const structural = {
      terran: (s) => [s.look.water, s.look.plateFreq, s.look.mountainKm, s.look.temp],
      ocean: (s) => [s.look.water, s.look.chains, s.look.islands],
      desert: (s) => [s.look.erg, s.look.mesa, s.look.style],
      rocky: (s) => [s.look.volcanoes, s.look.canyon > 0, s.look.dichotomyKm],
      ice: (s) => [s.look.style, s.look.lineae, s.look.seas],
      volcanic: (s) => [s.look.style, s.look.paterae],
      barren: (s) => [s.look.style, s.look.basins, s.look.maria],
      toxic: (s) => [s.look.style, s.look.bands],
      gas: (s) => [s.look.rows.length, s.look.vortices.length, !!s.look.ring],
      ice_giant: (s) => [s.look.rows.length, s.look.vortices.length, s.look.palette]
    }[type];
    const keys = new Set(specs.map((s) => JSON.stringify(structural(s))));
    assert.ok(keys.size >= 12, `${type}: za mała zmienność struktury (${keys.size} / 24)`);
  }
});

test('opis: zakresy, podrodzaje, mgiełka nad jasnym suchym gruntem bez błękitu (fiolet)', () => {
  for (let i = 0; i < 40; i++) {
    for (const type of PLANET_GEN_TYPE_IDS) {
      const s = describePlanet({ type, seed: mix32(7, i) });
      assert.ok(s.rKm > 0 && Number.isFinite(s.rKm));
      assert.ok(s.seedOffset.every((v) => v >= 0 && v < 1000), 'przesunięcie dziedziny < 1000 (float32)');
      assert.ok(s.haze.strength >= 0 && s.haze.strength <= 1.1);
      if (type === 'desert' || type === 'rocky') {
        assert.ok(s.haze.color[0] >= s.haze.color[2], `${type}: mgiełka niebieska nad suchym gruntem daje fiolet`);
      }
      if (type === 'terran' || type === 'ocean') {
        assert.ok(s.look.water > 0.5 && s.look.water < 1, 'udział oceanu');
        assert.ok(s.haze.beta[2] / s.haze.beta[0] < 3, 'mgiełka: współczynniki zbyt rozjechane (fiolet na pustyniach)');
      }
      if (s.kind === 'gas') {
        assert.ok(s.look.rows.length >= 6 && s.look.rows.length <= 24, `${type}: ${s.look.rows.length} pasów`);
        assert.ok(s.look.vortices.every((v) => v.a > 0 && v.b > 0 && Math.abs(v.lat) < 80));
        for (let k = 1; k < s.look.rows.length; k++) assert.ok(s.look.rows[k].lo >= s.look.rows[k - 1].lo, 'pasy rosnąco');
      }
    }
  }
});

test('plan map i pamięć: olbrzym — sam dzień; martwa — bez nocy i chmur; układ 8 planet @1024 < 50 MB', () => {
  const gas = describePlanet({ type: 'gas', seed: 1 });
  assert.deepEqual(plannedMaps(gas), { day: true, normal: false, spec: false, night: false, clouds: false });
  const barren = describePlanet({ type: 'barren', seed: 1, night: { cities: 0 } });
  const pb = plannedMaps(barren);
  assert.equal(pb.clouds, false);
  assert.equal(pb.night, false);
  assert.equal(pb.spec, false);
  const terran = describePlanet({ type: 'terran', seed: 3, night: { cities: 0.5 } });
  assert.equal(plannedMaps(terran).spec, true);
  assert.ok(plannedBytes(terran, 2048) < 40 * 1048576);
  const system = ['terran', 'rocky', 'desert', 'gas', 'gas', 'ice_giant', 'ice', 'barren'].map((type, i) => describePlanet({ type, seed: 50 + i }));
  const sum = system.reduce((s, x) => s + plannedBytes(x, 1024), 0);
  assert.ok(sum < 50 * 1048576, `układ @1024: ${(sum / 1048576).toFixed(1)} MB`);
});

test('kwantyle ważone polem (próba kanału w)', () => {
  const v = Float32Array.from([1, 2, 3, 4]);
  const w = Float32Array.from([1, 1, 1, 1]);
  assert.deepEqual(weightedQuantiles(v, w, [0.25, 0.5, 1]), [1, 2, 4]);
  const w2 = Float32Array.from([0, 0, 0, 1]);
  assert.deepEqual(weightedQuantiles(v, w2, [0.5]), [4]);
});

test('losowanie z ziarna: strumienie niezależne, zakresy', () => {
  const a = rngFor(5, 'teren');
  const b = rngFor(5, 'chmury');
  assert.notEqual(a.next(), b.next());
  const r = makeRng(42);
  for (let i = 0; i < 1000; i++) {
    const x = r.next();
    assert.ok(x >= 0 && x < 1);
    const d = r.dir();
    assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-9);
  }
});

test('grafy wypieku: WGSL wszystkich przejść buduje się, graf raz na klucz', () => {
  const baker = new PlanetGenBaker(renderer);
  const keys = [...Object.keys(SOLID_TYPES).flatMap((t) => [`field:${t}`, `day:${t}`]), 'normal', 'spec', 'night', 'clouds', 'gas'];
  for (const k of keys) {
    const g = baker.graph(k);
    assert.equal(baker.graph(k), g, `${k}: drugi raz ten sam graf`);
    const wgsl = buildQuad(g.material);
    assert.ok(wgsl.includes('fn main'), k);
    assert.doesNotMatch(wgsl, /\bNaN\b/);
  }
  for (const t of PLANET_GEN_TYPE_IDS) assert.ok(baker.passesFor(t).length >= 1);
});

test('źródła: tylko TSL, bez Math.random, bez odwróconych stałych krawędzi smoothstep (pułapka 6)', () => {
  for (const [f, src] of SOURCES) {
    const c = code(src);
    assert.doesNotMatch(c, /Math\.random/, `${f}: Math.random (zasada żelazna 9)`);
    assert.doesNotMatch(c, /ShaderMaterial|onBeforeCompile|gl_FragColor|WebGLRenderer|EffectComposer|wgslFn/, `${f}: GLSL / WebGL`);
    for (const m of c.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) {
      assert.ok(Number(m[1]) < Number(m[2]), `${f}: smoothstep(${m[1]}, ${m[2]}, …) — stałe krawędzie odwrócone`);
    }
  }
});

test('olbrzymy: jeden graf genGas dla wielu planet, dane per obiekt, rodzaje gry bez zmian', () => {
  assert.deepEqual(Object.keys(PLANET_GRAPH_KEYS), ['surface', 'jupiter', 'saturn', 'clouds', 'atmosphere', 'ringAtmosphere', 'sun', 'sunCorona']);
  assert.equal(PLANET_MATERIAL_NAMES.genGas, undefined, 'tablica nazw gry zamrożona — genGas z rejestracji');
  const engines = [11, 12].map((seed) => {
    const spec = describePlanet({ type: 'gas', seed });
    const e = createGenGasEngine(spec);
    assert.ok(e.model.segments.length <= GEN_GAS_BAND_CAP, 'pasów ≤ pojemność');
    return { spec, e };
  });
  const mats = engines.map(({ spec, e }) => {
    const day = new THREE.Texture();
    day.image = { width: 1, height: 1 };
    day.colorSpace = THREE.SRGBColorSpace;
    const U = planetSurfaceUniforms(spec, { day });
    const atm = new GenGasAtmosphere(e, { uniforms: U, isRingAnchored: false, group: { scale: { x: 1 } } }, null);
    assert.equal(U[GEN_GAS_DATA_KEYS.bands].value.length, GEN_GAS_BAND_CAP);
    assert.equal(U[GEN_GAS_DATA_KEYS.vortices].value.length, GEN_GAS_VORTEX_CAP * 3);
    for (const k of Object.keys(GEN_GAS_UNIFORM_KEYS)) assert.ok(U[k]?.value?.isVector4, k);
    atm.sync(1.0, 0.016);
    return createGenGasSurfaceMaterial(U);
  });
  assert.equal(mats[0].fragmentNode, mats[1].fragmentNode, 'te same węzły — jeden program');
  assert.equal(mats[0].name, 'PlanetSurfaceGenGas');
  const before = PLANET_TSL_STATS.builds.genGas;
  const wgsl = buildMesh(mats[0]);
  assert.equal(PLANET_TSL_STATS.builds.genGas - before, 1);
  assert.match(wgsl, /genGasBands/);
  assert.match(wgsl, /genGasVortices/);
  // tablica per obiekt: aktualizacja kopiuje dane planety rysowanej teraz
  const bandsNode = GEN_GAS_GRAPH_MODEL.bandArray();
  const fakeFrame = (m) => ({ material: m });
  bandsNode.update(fakeFrame(mats[0]));
  const first = bandsNode.value.slice(0, 8);
  bandsNode.update(fakeFrame(mats[1]));
  const second = bandsNode.value.slice(0, 8);
  assert.notDeepEqual(Array.from(first), Array.from(second), 'różne planety — różne pasy w buforze');
});

test('pierścienie: profil deterministyczny, przerwy, alfa w zakresie', () => {
  let ring = null;
  for (let s = 1; s < 200 && !ring; s++) ring = describePlanet({ type: 'gas', seed: s }).look.ring;
  assert.ok(ring, 'część olbrzymów ma pierścienie');
  const a = bakeRingProfile(ring);
  const b = bakeRingProfile(ring);
  assert.equal(a.length, RING_PROFILE_TEXELS * 4);
  assert.deepEqual(Array.from(a), Array.from(b));
  let minA = 255;
  for (let i = Math.floor(RING_PROFILE_TEXELS * 0.1); i < RING_PROFILE_TEXELS * 0.9; i++) minA = Math.min(minA, a[i * 4 + 3]);
  assert.ok(minA < 60, 'co najmniej jedna przerwa');
});

test('barwy opisu: sRGB → liniowe', () => {
  const [r, g, b] = srgb('#ffffff');
  assert.ok(Math.abs(r - 1) < 1e-9 && Math.abs(g - 1) < 1e-9 && Math.abs(b - 1) < 1e-9);
  assert.ok(Math.abs(srgb('#808080')[0] - 0.2158) < 1e-3);
});
