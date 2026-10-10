// Żywa atmosfera Saturna (src/3d/saturnAtmosphere.js + wspólny silnik gasGiantAtmosphere*.js, rodzaj 'saturn'
// w planet3d.assets.tsl.js): profil wiatru Cassini, pasy z czapami polarnymi, sześciokąt (lustro shadera i generatora),
// zegar, WGSL budowany w Node (bez GPU), wpięcie w grę i dane wspólne z generatorem (scripts/planety/saturn.py).
// node --test tests/saturnAtmosphere.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  SATURN_MODEL, SATURN_BAND_CAP, SATURN_MAX_SPREAD, SATURN_POLES, SATURN_UNIFORM_KEYS, SATURN_ATM_TUNE, SATURN_VORTICES,
  SaturnAtmosphere, saturnZonalWind
} from '../src/3d/saturnAtmosphere.js';
import { SATURN_ATMOSPHERE } from '../src/data/saturnAtmosphere.js';
import { polygonMeanCpu, polygonShapeCpu } from '../src/3d/gasGiantAtmosphere.tsl.js';
import { bandIndex } from '../src/3d/gasGiantAtmosphere.js';
import { SimClock } from '../src/game/simClock.js';
import {
  PLANET_GRAPH_KEYS, PLANET_MATERIAL_NAMES, PLANET_TSL_STATS, createJupiterSurfaceMaterial, createSaturnSurfaceMaterial
} from '../src/3d/planet3d.assets.tsl.js';
import { JupiterAtmosphere } from '../src/3d/jupiterAtmosphere.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.highPrecision = true;
function buildWGSL(material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = material;
  b.build();
  return b.fragmentShader;
}
const tex = (colorSpace = THREE.NoColorSpace) => { const t = new THREE.Texture(); t.image = { width: 1, height: 1 }; t.colorSpace = colorSpace; return t; };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function planetUniforms() {
  return {
    uPlanetBloom: { value: 0.2 }, dayTexture: { value: tex(THREE.SRGBColorSpace) }, nightTexture: { value: null },
    specularTexture: { value: new THREE.Texture() }, normalTexture: { value: new THREE.Texture() }, sunPosition: { value: V3(0, 0, -50000) },
    hasNightTexture: { value: 0.0 }, uBrightness: { value: 0.94 }, uSpecular: { value: 0.0 }, uSunIntensity: { value: 0.95 },
    uHazeStrength: { value: 0.3 }, uHazeColor: { value: V3(0.93, 0.83, 0.64) }, uHazeBeta: { value: V3(0.06, 0.08, 0.12) },
    uRingShadowStrength: { value: 0.0 }, uRingShadowRadius: { value: 0.0 }, uRingShadowReach: { value: 1.0 },
    uRingShadowCenter: { value: new THREE.Vector2(0, 0) }, uSunShadowRecv: { value: 0.0 }, uPitMode: { value: 0.0 }
  };
}
function saturnPlanet() {
  const planet = { uniforms: planetUniforms(), group: { scale: { x: 30000 } }, isRingAnchored: false };
  planet.atm = new SaturnAtmosphere(planet, planet.uniforms.dayTexture.value);
  return planet;
}

test('profil wiatru Cassini: dżet równikowy ~370 m/s, dżet sześciokąta ~75° N, minimum 34° N, zero na biegunach', () => {
  assert.equal(SATURN_ATMOSPHERE.wind.length, 180 / SATURN_ATMOSPHERE.windStepDeg + 1);
  assert.ok(saturnZonalWind(0) > 340 && saturnZonalWind(0) < 400, `równik ${saturnZonalWind(0)}`);
  assert.ok(saturnZonalWind(34.5) < -10, 'prąd wsteczny 34,5° N (pas burzy 2010)');
  let best = -1e9;
  let at = 0;
  for (let x = 70; x <= 80; x += 0.25) if (saturnZonalWind(x) > best) { best = saturnZonalWind(x); at = x; }
  assert.ok(Math.abs(at - SATURN_ATMOSPHERE.hexagon.latC) < 1.0, `szczyt dżetu sześciokąta ${at}° ≈ ${SATURN_ATMOSPHERE.hexagon.latC}°`);
  assert.equal(saturnZonalWind(90), 0);
  assert.equal(saturnZonalWind(-90), 0);
});

test('pasy: pokrywają tarczę, mieszczą się w buforze, czapy polarne bez ruchu sztywnego, dżet równikowy pocięty', () => {
  const segs = SATURN_MODEL.segments;
  assert.ok(segs.length <= SATURN_BAND_CAP, `${segs.length} pasów`);
  assert.equal(segs[0].lo, -90);
  assert.equal(segs[segs.length - 1].hi, 90);
  for (let i = 1; i < segs.length; i++) assert.ok(Math.abs(segs[i].lo - segs[i - 1].hi) < 1e-9, `ciągłość ${i}`);
  for (const s of segs) {
    if (s.hi <= -SATURN_POLES.south.cap + 1e-9 || s.lo >= SATURN_POLES.north.cap - 1e-9) {
      assert.ok(s.polar && s.omega === 0, `czapa ${s.lo}…${s.hi} stoi`);
    }
  }
  // w pasie dżetu równikowego (|φ| < 20°) żaden segment nie łączy prędkości różniących się o więcej niż ~2 × maxSpread
  for (const s of segs.filter((q) => q.hi > -20 && q.lo < 20 && !q.plateau)) {
    let mn = Infinity;
    let mx = -Infinity;
    for (let x = s.lo; x < s.hi; x += 0.1) { mn = Math.min(mn, saturnZonalWind(x)); mx = Math.max(mx, saturnZonalWind(x)); }
    assert.ok(mx - mn <= 2 * SATURN_MAX_SPREAD + 1, `pas ${s.lo.toFixed(1)}…${s.hi.toFixed(1)}: rozrzut ${(mx - mn).toFixed(0)} m/s`);
  }
  // wiry w plateau (stała prędkość — wir nie rozrywa się)
  for (const v of SATURN_VORTICES) assert.ok(segs[bandIndex(segs, v.lat)].plateau, `wir ${v.id} w plateau`);
});

test('czapy: jądra wirów polarnych cyklonalne (na wschód), sześciokąt — średnia kształtu 1, wierzchołek w phaseU', () => {
  assert.ok(SATURN_MODEL.poleCoreOmega('north') > 0, 'wir płn. przeciwnie do wskazówek zegara (z północy)');
  assert.ok(SATURN_MODEL.poleCoreOmega('south') > 0, 'wir płd. zgodnie ze wskazówkami (z południa) = na wschód');
  const h = SATURN_ATMOSPHERE.hexagon;
  const l0 = h.phaseU * Math.PI / 180;
  let sum = 0;
  const n = 6000;
  for (let i = 0; i < n; i++) sum += polygonShapeCpu((i + 0.5) / n * 2 * Math.PI, h.sides, l0);
  assert.ok(Math.abs(sum / n - 1) < 1e-3, `średnia ${sum / n}`);
  const vertex = polygonShapeCpu(l0 + 1e-6, h.sides, l0);
  const edge = polygonShapeCpu(l0 + Math.PI / h.sides, h.sides, l0);
  assert.ok(vertex > edge, 'wierzchołek dalej od bieguna niż środek boku');
  assert.ok(Math.abs(vertex * Math.cos(Math.PI / h.sides) - edge) < 1e-6, 'wielokąt foremny');
  assert.ok(Math.abs(polygonMeanCpu(6) - 0.9085) < 1e-3);
  // generator rysuje ten sam kształt (lustro w Pythonie)
  const py = read('scripts/planety/saturn.py');
  assert.match(py, /mean = math\.cos\(a\) \* math\.log\(1 \/ math\.cos\(a\) \+ math\.tan\(a\)\) \/ a/);
  assert.match(py, /return \(math\.cos\(a\) \/ np\.cos\(x - a\) \/ mean\)/);
  assert.match(py, /wczytaj_json_z_js\(os\.path\.join\(KATALOG_REPO, 'src', 'data', 'saturnAtmosphere\.js'\), 'SATURN_ATM'\)/);
});

test('zegar: czas gry, czapy obracają jądra, planeta tła bez tempa z zoomu', () => {
  const planet = saturnPlanet();
  const a = planet.atm;
  for (const key of Object.keys(SATURN_UNIFORM_KEYS)) assert.ok(planet.uniforms[key]?.value?.isVector4, `uniform ${key}`);
  const saved = SimClock.render;
  const savedCam = globalThis.window;
  globalThis.window = { camera: { zoom: 5 } };   // zoom kamery gry nie dotyczy planety tła
  try {
    SimClock.render = 10;
    a.step();
    for (let k = 1; k <= 4; k++) { SimClock.render = 10 + k * 0.25; a.step(); }
    assert.ok(Math.abs(a.time - 1) < 1e-9);
    assert.equal(a.pace, 1, 'planeta tła — tempo 1');
    const want = SATURN_MODEL.poleCoreOmega('north') * 1 * SATURN_ATM_TUNE.timeScale * SATURN_ATM_TUNE.poleSpeed;
    const wrapped = want - Math.floor(want / (2 * Math.PI)) * 2 * Math.PI;
    assert.ok(Math.abs(a.poleAngles[0] - wrapped) < 1e-9, 'kąt jądra płn.');
    assert.ok(Math.abs(planet.uniforms.uSatPole.value.x - a.poleAngles[0]) < 1e-6);
  } finally {
    SimClock.render = saved;
    globalThis.window = savedCam;
  }
});

test('WGSL: rodzaj „saturn” — bufory saturnBands / saturnVortices, czapy (+4 próbki), Jowisz bez czap', () => {
  const planet = saturnPlanet();
  for (const key of PLANET_GRAPH_KEYS.saturn) assert.ok(key in planet.uniforms, `klucz ${key}`);
  const before = PLANET_TSL_STATS.builds.saturn;
  const mat = createSaturnSurfaceMaterial(planet.uniforms);
  assert.equal(mat.name, PLANET_MATERIAL_NAMES.saturn);
  const f = buildWGSL(mat);
  assert.equal(PLANET_TSL_STATS.builds.saturn - before, 1);
  assert.match(f, /var<uniform> saturnVortices : saturnVorticesStruct;/);
  assert.match(f, /var<uniform> saturnBands : saturnBandsStruct;/);
  assert.ok((f.match(/var<uniform>/g) || []).length <= 4, 'bufory uniformów (limit 12 na etap)');
  const grads = [...f.matchAll(/textureSampleGrad\( (\w+), \w+, (\w+), (\w+), (\w+) \)/g)];
  assert.equal(grads.length, 12, 'dwie fazy × (pas, pas sąsiedni, kołnierz, jądro wiru, czapa N, czapa S)');
  for (const m of f.matchAll(/pow\( (.{0,24})/g)) assert.match(m[1], /^max\( 0\.0,/, `pow z podstawą ${m[1]}`);
  // Jowisz: ta sama gałąź bez czap
  const jp = { uniforms: planetUniforms(), group: { scale: { x: 48000 } } };
  jp.atm = new JupiterAtmosphere(jp, jp.uniforms.dayTexture.value);
  const j = buildWGSL(createJupiterSurfaceMaterial(jp.uniforms));
  assert.doesNotMatch(j, /saturn/);
  assert.equal([...j.matchAll(/textureSampleGrad\(/g)].length, 8);
});

test('wpięcie: planet3d.assets.js tworzy atmosferę Saturna na mapie z generatora, mapa w PLANET_MAPS', () => {
  const src = read('src/3d/planet3d.assets.js');
  assert.match(src, /if \(name === 'saturn' && maps\?\.atmosphere\) this\.saturnAtm = new SaturnAtmosphere\(this, dayTex\);/);
  assert.match(src, /createSaturnSurfaceMaterial\(this\.uniforms\)/);
  assert.match(src, /_spin\(dt\) \{[\s\S]*?if \(this\.saturnAtm\) this\.saturnAtm\.step\(\);[\s\S]*?\n {4}\}/);
  const maps = read('src/3d/planetMaps.js');
  const m = maps.match(/saturn: \{ day: '([^']+)', atmosphere: true/);
  assert.ok(m, 'PLANET_MAPS.saturn z atmosferą');
  assert.ok(existsSync(new URL(`../public/${m[1]}`, import.meta.url)), m[1]);
});
