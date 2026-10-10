// Żywa atmosfera Jowisza (src/3d/jupiterAtmosphere.js + .tsl.js, rodzaj 'jupiter' w planet3d.assets.tsl.js):
// profil wiatru z tabeli Cassini, wiry, wagi faz, zegar w czasie gry, WGSL budowany w Node (bez GPU).
// node --test tests/jupiterAtmosphere.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  JUPITER_JETS_CASSINI, JUPITER_VORTICES, JUPITER_VORTEX_CAP, JUPITER_BAND_CAP, JUPITER_BANDS, JUPITER_UNIFORM_KEYS,
  JUPITER_PHASE_WRAP, JUPITER_SEED_WRAP, JUPITER_ATM_TUNE, JUPITER_WIND_TEXELS, JUPITER_RADIUS_EQ,
  jupiterCentricLat, jupiterWindExtrema, jupiterZonalWind, jupiterZonalOmegaU, buildJupiterWindTexels,
  jupiterVortexRecords, jupiterBandSegments, jupiterBandRecords, jupiterBandIndex, jupiterPhaseWeights,
  jupiterVortexOmega, jupiterVortexRigid, JupiterAtmosphere, JUPITER_VORTEX_VEC4
} from '../src/3d/jupiterAtmosphere.js';
import { SimClock } from '../src/game/simClock.js';
import {
  PLANET_GRAPH_KEYS, PLANET_MATERIAL_NAMES, PLANET_TSL_STATS, createJupiterSurfaceMaterial, createPlanetSurfaceMaterial
} from '../src/3d/planet3d.assets.tsl.js';

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
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const tex = (colorSpace = THREE.NoColorSpace) => { const t = new THREE.Texture(); t.image = { width: 1, height: 1 }; t.colorSpace = colorSpace; return t; };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// Kształt `uniforms` DirectPlanet (planet3d.assets.js) — klucze Jowisza dopisuje JupiterAtmosphere.
function planetUniforms() {
  return {
    uPlanetBloom: { value: 0.05 }, dayTexture: { value: tex(THREE.SRGBColorSpace) }, nightTexture: { value: null },
    specularTexture: { value: new THREE.Texture() }, normalTexture: { value: new THREE.Texture() }, sunPosition: { value: V3(0, 0, -50000) },
    hasNightTexture: { value: 0.0 }, uBrightness: { value: 0.92 }, uSpecular: { value: 0.0 }, uSunIntensity: { value: 0.92 },
    uHazeStrength: { value: 0.0 }, uHazeColor: { value: V3(0.55, 0.72, 1.0) }, uHazeBeta: { value: V3(0.05, 0.10, 0.22) },
    uRingShadowStrength: { value: 0.0 }, uRingShadowRadius: { value: 0.0 }, uRingShadowReach: { value: 1.0 },
    uRingShadowCenter: { value: new THREE.Vector2(0, 0) }, uSunShadowRecv: { value: 1.0 }, uPitMode: { value: 0.0 }
  };
}
function jupiterPlanet() {
  const planet = { uniforms: planetUniforms(), group: { scale: { x: 48000 } } };
  planet.atm = new JupiterAtmosphere(planet, planet.uniforms.dayTexture.value);
  return planet;
}

test('profil wiatru: szczyty tabeli Cassini w swoich szerokościach (planetocentrycznych), zero przy biegunach', () => {
  // spłaszczenie: 23,9° planetograficzne ≈ 21,2° planetocentryczne (dżet 24° N), równik bez zmian
  assert.ok(Math.abs(jupiterCentricLat(23.9) - 21.2) < 0.1, `φc(23,9°) = ${jupiterCentricLat(23.9)}`);
  assert.equal(jupiterCentricLat(0), 0);
  const ext = jupiterWindExtrema();
  for (let i = 1; i < ext.length; i++) assert.ok(ext[i][0] > ext[i - 1][0], 'ekstrema rosnąco');
  for (const [g, w] of JUPITER_JETS_CASSINI) {
    assert.ok(Math.abs(jupiterZonalWind(jupiterCentricLat(g), ext) - w) < 1e-9, `szczyt ${g}° → ${w} m/s`);
  }
  // najszybsze: dżet 24° N (136,2) i SEBn 7° S (136,9) na wschód, SEBs 20° S (−62) na zachód — nad GRS
  let lo = Infinity, hi = -Infinity;
  for (let lat = -89.5; lat <= 89.5; lat += 0.25) {
    const w = jupiterZonalWind(lat, ext);
    lo = Math.min(lo, w); hi = Math.max(hi, w);
  }
  assert.ok(Math.abs(hi - Math.max(...JUPITER_JETS_CASSINI.map(([, w]) => w))) < 0.5, `max ${hi}`);
  assert.ok(Math.abs(lo + 62) < 0.5, `min ${lo}`);
  assert.equal(jupiterZonalWind(85), 0);
  assert.equal(jupiterZonalWind(-85), 0);
  // między dwoma szczytami wschodnimi wysokich szerokości wstawiony słaby prąd wsteczny; przy równiku nie (CEC to
  // minimum między dżetami NEBs i SEBn)
  assert.ok(ext.some(([lat, w]) => w < 0 && lat > 40 && lat < 50));
  assert.ok(!ext.some(([lat, w]) => w < 0 && Math.abs(lat) < 10), 'bez wstawki na równiku');
  assert.ok(jupiterZonalWind(0) > 60, 'równik na wschód (~72 m/s)');
});

test('pasy ruchu sztywnego: pokrywają tarczę, granice na minimach, wiry w plateau ze swoim dryfem', () => {
  const segs = jupiterBandSegments();
  assert.ok(segs.length <= JUPITER_BAND_CAP);
  assert.equal(segs[0].lo, -90);
  assert.equal(segs[segs.length - 1].hi, 90);
  for (let i = 1; i < segs.length; i++) assert.ok(Math.abs(segs[i].lo - segs[i - 1].hi) < 1e-9, 'bez dziur');
  for (const s of segs) {
    assert.ok(s.hi - s.lo >= JUPITER_BANDS.minDeg - 1e-9, `segment ${s.lo.toFixed(1)}…${s.hi.toFixed(1)} za wąski`);
    assert.ok(Number.isFinite(s.omega));
  }
  const ms = (lat) => segs[jupiterBandIndex(segs, lat)].omega * 2 * Math.PI * JUPITER_RADIUS_EQ * Math.cos(lat * Math.PI / 180);
  // strefa równikowa i festony NEB jadą na wschód (~85–95 m/s), GRS stoi (dryf −3 m/s), bieguny stoją
  assert.ok(ms(3) > 70 && ms(-5) > 70, `równik ${ms(3).toFixed(1)} / ${ms(-5).toFixed(1)} m/s`);
  assert.ok(Math.abs(ms(-20.5) + 3) < 0.2, `GRS ${ms(-20.5)} m/s`);
  assert.equal(segs[jupiterBandIndex(segs, 85)].omega, 0);
  // każdy wir w plateau sięgającym poza maskę (ρ = 1,3) i pas przenikania
  const recs = jupiterVortexRecords(JUPITER_VORTICES, JUPITER_VORTEX_CAP, segs);
  JUPITER_VORTICES.forEach((v, i) => {
    const s = segs[recs[i * JUPITER_VORTEX_VEC4 + 1][3]];
    assert.ok(s.plateau, `${v.id}: plateau`);
    const reach = v.b * JUPITER_BANDS.vortexReach + JUPITER_BANDS.blendDeg;
    assert.ok(s.lo <= v.lat - reach && s.hi >= v.lat + reach, `${v.id}: plateau obejmuje maskę`);
  });
  // rekordy shadera: górna granica w v, wolne miejsca x = 2 (żadna granica nie jest bliżej)
  const br = jupiterBandRecords(segs);
  assert.equal(br.length, JUPITER_BAND_CAP);
  assert.ok(Math.abs(br[0][0] - (segs[0].hi + 90) / 180) < 1e-12);
  assert.equal(br[JUPITER_BAND_CAP - 1][0], 2);
  // średnia prędkość kątowa segmentu z profilu (bez plateau)
  const s = segs.find((q) => !q.plateau && q.lo < 5 && q.hi > 5);
  let sum = 0;
  for (let k = 0; k < 96; k++) sum += jupiterZonalOmegaU(s.lo + (s.hi - s.lo) * (k + 0.5) / 96);
  assert.ok(Math.abs(s.omega - sum / 96) < 1e-15);
});

test('tekstura profilu: R = wiatr w środkach tekseli (v = 0 — biegun S), G = ścinanie ≤ 1, B = maska turbulencji', () => {
  const d = buildJupiterWindTexels();
  assert.equal(d.length, JUPITER_WIND_TEXELS * 4);
  let gMax = 0;
  for (let i = 0; i < JUPITER_WIND_TEXELS; i++) {
    const lat = ((i + 0.5) / JUPITER_WIND_TEXELS - 0.5) * 180;
    assert.ok(Math.abs(d[i * 4] - jupiterZonalWind(lat)) < 1e-4);
    assert.ok(d[i * 4 + 1] >= 0 && d[i * 4 + 1] <= 1);
    gMax = Math.max(gMax, d[i * 4 + 1]);
    assert.equal(d[i * 4 + 3], 1);
  }
  assert.equal(gMax, 1);
  const at = (lat) => Math.round(((lat / 180) + 0.5) * JUPITER_WIND_TEXELS - 0.5);
  assert.equal(d[at(0) * 4 + 2], 1, 'turbulencja na równiku');
  assert.equal(d[at(-80) * 4 + 2], 0, 'bez turbulencji przy biegunie');
});

test('wiry: GRS na 20,5° S przeciwnie do wskazówek zegara (anticyklon płd.), owale i barki ze zwrotem z półkuli', () => {
  const recs = jupiterVortexRecords();
  assert.equal(recs.length, JUPITER_VORTEX_CAP * JUPITER_VORTEX_VEC4);
  const grs = JUPITER_VORTICES.find((v) => v.id === 'GRS');
  const i = JUPITER_VORTICES.indexOf(grs);
  const [A, B, Cr] = [recs[i * 3], recs[i * 3 + 1], recs[i * 3 + 2]];
  assert.equal(Cr[0], jupiterVortexRigid(grs.core), 'GRS obraca się sztywno');
  assert.ok(A[1] < 0.5 && Math.abs(A[1] - (90 - 20.5) / 180) < 1e-9, 'v środka GRS');
  assert.ok(B[0] > 0, 'GRS: ω > 0 (przeciwnie do wskazówek zegara, północ w górę)');
  assert.ok(Math.abs(2 * Math.PI / B[0] / 86400 - 5.5) < 1e-9, 'okres obrzeża 5,5 doby');
  // owal płd. ~1,4 : 1 (półosie fizyczne)
  const aspect = grs.a * Math.cos(grs.lat * Math.PI / 180) / grs.b;
  assert.ok(aspect > 1.2 && aspect < 1.6, `GRS ${aspect.toFixed(2)} : 1`);
  for (const v of JUPITER_VORTICES) {
    const anticyclone = v.id.startsWith('owal') || v.id === 'GRS';
    const ccw = anticyclone ? v.lat < 0 : v.lat > 0;
    assert.equal(v.sense, ccw ? 1 : -1, `${v.id}: zwrot`);
  }
  for (let k = JUPITER_VORTICES.length; k < JUPITER_VORTEX_CAP; k++) assert.deepEqual(recs[k * 3], [0, 0, 0, 0], 'wolne miejsce — zera (shader pomija)');
  // małe owale bez obrotu sztywnego (tylko reszta z dwiema fazami)
  JUPITER_VORTICES.forEach((v, k) => assert.equal(recs[k * 3 + 2][0] > 0, v.id === 'GRS', `${v.id}: obrót sztywny`));
  // ω(ρ): wnętrze wolniej, kołnierz najszybciej, za brzegiem zero
  assert.ok(Math.abs(jupiterVortexOmega(0, 1, 0.3) - 0.3) < 1e-12);
  assert.equal(jupiterVortexOmega(0.85, 1, 0.3), 1);
  assert.equal(jupiterVortexOmega(1.45, 1, 0.3), 0);
  for (let r = 0.05; r <= 0.8; r += 0.05) assert.ok(jupiterVortexOmega(r, 1, 0.3) >= jupiterVortexOmega(r - 0.05, 1, 0.3));
  // obrót sztywny jądra = prędkość wnętrza (kołnierz płynie resztą z dwiema fazami)
  assert.equal(jupiterVortexRigid(0.3), 0.3);
  assert.equal(jupiterVortexRigid(0.3, false), 0);
});

test('fazy: wagi sumują się do 1, faza zeruje się przy wadze 0, ziarno nie skacze przy zawinięciu zegara', () => {
  for (let s = 0; s < 3; s += 0.0625) {
    const { f0, f1, w0, w1 } = jupiterPhaseWeights(s);
    assert.ok(Math.abs(w0 + w1 - 1) < 1e-12);
    if (f0 < 1e-12) assert.ok(w0 < 1e-12, 'faza 0 zerowana bez wagi');
    if (f1 < 1e-12) assert.ok(w1 < 1e-12, 'faza 1 zerowana bez wagi');
  }
  assert.equal(JUPITER_PHASE_WRAP % JUPITER_SEED_WRAP, 0, 'okno zegara wielokrotnością okna ziarna');
});

test('zegar: czas GRY z SimClock (pauza = stoi, skok w tył pominięty), tempo maleje przy zbliżeniu, klucze i zawijanie mapy', () => {
  const planet = jupiterPlanet();
  const a = planet.atm;
  for (const key of Object.keys(JUPITER_UNIFORM_KEYS)) assert.ok(planet.uniforms[key]?.value?.isVector4, `uniform ${key}`);
  assert.equal(planet.uniforms.dayTexture.value.wrapS, THREE.RepeatWrapping, 'mapa dnia zawija się w u (próbki przesunięte)');
  const saved = SimClock.render;
  try {
    SimClock.render = 100;
    a.step();
    const t0 = a.time;
    for (let k = 1; k <= 6; k++) {
      SimClock.render = 100 + k * 0.25;
      a.step();
    }
    assert.ok(Math.abs(a.time - t0 - 1.5) < 1e-9, 'kroki gry 6 × 0,25 s');
    a.step();
    assert.ok(Math.abs(a.time - t0 - 1.5) < 1e-9, 'pauza (render bez zmian) — stoi');
    SimClock.render = 3;
    a.step();
    assert.ok(Math.abs(a.time - t0 - 1.5) < 1e-9, 'reset zegara gry — bez skoku');
    SimClock.render = 5;
    a.step();
    assert.ok(Math.abs(a.time - t0 - 1.5) < 1e-9, 'przerwa > 0,5 s (planeta poza kadrem) — bez skoku');
    const period = JUPITER_ATM_TUNE.period;
    assert.ok(Math.abs(a.phase - 1.5 / period) < 1e-9, 'zegar faz = czas / T');
    assert.ok(Math.abs(planet.uniforms.uJupClock.value.x - a.phase) < 1e-6);
    // ruch sztywny (double, zawinięty): pasy o ω · t · skala, wiry o ω_obrzeża · część sztywna · t · skala
    const real = 1.5 * JUPITER_ATM_TUNE.timeScale;   // bez kamery tempo 1
    a.segments.forEach((s, i) => {
      const want = s.omega * real - Math.floor(s.omega * real);
      assert.ok(Math.abs(a.offsets[i] - want) < 1e-9, `pas ${i}`);
      assert.ok(Math.abs(a.bands.array[i].y - want) < 1e-6, `pas ${i} w tablicy uniformów`);
    });
    const B = a.vortices.array[1];
    const ang = B.x * a.vortices.array[2].x * 1.5 * JUPITER_ATM_TUNE.timeScale * JUPITER_ATM_TUNE.vortexSpeed;
    assert.ok(Math.abs(a.angles[0] - (ang - Math.floor(ang / (2 * Math.PI)) * 2 * Math.PI)) < 1e-9, 'kąt GRS');
    assert.ok(Math.abs(B.z - a.angles[0]) < 1e-6);
    assert.ok(ang > 0, 'GRS obraca się przeciwnie do wskazówek zegara');
  } finally {
    SimClock.render = saved;
  }
  // tempo: cała tarcza (≤ 1,5 px na teksel) — 1, zbliżenie — mniej
  assert.equal(a.paceFor(0.02, 48000), 1);
  assert.ok(a.paceFor(0.3, 48000) < 0.25);
  // wyłączona atmosfera: bez korekty kontrastu (obraz = sama mapa)
  JUPITER_ATM_TUNE.on = 0;
  a.sync(0, 0);
  assert.equal(planet.uniforms.uJupClock.value.w, 0);
  assert.equal(planet.uniforms.uJupFlow.value.z, 0);
  JUPITER_ATM_TUNE.on = 1;
  a.sync(0, 0);
});

test('WGSL: rodzaj „jupiter” = graf powierzchni z barwą dnia z przepływu; inne planety bez zmian', () => {
  const planet = jupiterPlanet();
  for (const key of PLANET_GRAPH_KEYS.jupiter) assert.ok(key in planet.uniforms, `klucz ${key}`);
  const before = PLANET_TSL_STATS.builds.jupiter;
  const mat = createJupiterSurfaceMaterial(planet.uniforms);
  assert.equal(mat.name, PLANET_MATERIAL_NAMES.jupiter);
  const j = buildWGSL(mat).fragment;
  assert.equal(PLANET_TSL_STATS.builds.jupiter - before, 1);
  const surface = buildWGSL(createPlanetSurfaceMaterial(planetUniforms())).fragment;
  assert.doesNotMatch(surface, /jupiterVortices|textureSampleGrad/, 'powierzchnia innych planet bez gałęzi Jowisza');
  // pasy i wiry w buforach uniformów o stałych nazwach, razem ≤ 4 bufory (limit 12)
  assert.match(j, /var<uniform> jupiterVortices : jupiterVorticesStruct;/);
  assert.match(j, /var<uniform> jupiterBands : jupiterBandsStruct;/);
  assert.ok((j.match(/var<uniform>/g) || []).length <= 4);
  assert.match(j, /for \( var i : i32 = 0; i < 8; i \+\+ \)/, 'pętla po 8 wirach');
  assert.match(j, new RegExp(`for \\( var i : i32 = 0; i < ${JUPITER_BAND_CAP - 1}; i \\+\\+ \\)`), 'pętla po granicach pasów');
  // próbki mapy dnia: gradienty = pochodne NIEPRZESUNIĘTEGO uv (policzone na początku, poza gałęziami)
  const dx = j.match(/(nodeVar\d+) = dpdx\( (nodeVarying\d+) \);/);
  const dy = j.match(/(nodeVar\d+) = - dpdy\( (nodeVarying\d+) \);/);
  assert.ok(dx && dy && dx[2] === dy[2], 'pochodne uv');
  const grads = [...j.matchAll(/textureSampleGrad\( (\w+), \w+, (\w+), (\w+), (\w+) \)/g)];
  assert.equal(grads.length, 8, 'dwie fazy × (pas, pas sąsiedni, kołnierz wiru, jądro wiru)');
  for (const g of grads) assert.deepEqual([g[3], g[4]], [dx[1], dy[1]], 'gradienty z uv siatki');
  assert.ok(j.indexOf(dx[0]) < j.indexOf('if ('), 'pochodne przed pierwszą gałęzią');
  // reszta próbek (profil, szum faz, curl3D, średnia lokalna) z jawnym poziomem
  assert.ok((j.match(/textureSampleLevel\(/g) || []).length >= 5);
  const dayTex = grads[0][1];
  for (const g of grads) assert.equal(g[1], dayTex);
  assert.doesNotMatch(j, new RegExp(`textureSample\\( ${dayTex},`), 'mapa dnia tylko z gradientem albo poziomem (dowolny przepływ sterowania)');
  // pow tylko z nieujemną podstawą (jak w powierzchni)
  for (const m of j.matchAll(/pow\( (.{0,24})/g)) assert.match(m[1], /^max\( 0\.0,/, `pow z podstawą ${m[1]}`);
});

test('wpięcie: planet3d.assets.js tworzy atmosferę Jowisza i kroczy ją w _spin, mapa Cassini w PLANET_MAPS', () => {
  const src = read('src/3d/planet3d.assets.js');
  assert.match(src, /if \(name === 'jupiter'\) this\.jupiterAtm = new JupiterAtmosphere\(this, dayTex\);/);
  assert.match(src, /createJupiterSurfaceMaterial\(this\.uniforms\)/);
  assert.match(src, /_spin\(dt\) \{[\s\S]*?if \(this\.jupiterAtm\) this\.jupiterAtm\.step\(\);[\s\S]*?\n {4}\}/);
  const maps = read('src/3d/planetMaps.js');
  const m = maps.match(/jupiter: \{ day: '([^']+)' \}/);
  assert.ok(m, 'PLANET_MAPS.jupiter');
  assert.ok(existsSync(new URL(`../public/${m[1]}`, import.meta.url)), m[1]);
});
