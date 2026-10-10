// Powierzchnia księżyców (src/3d/moonSurface.tsl.js): MeshStandardNodeMaterial + światła nocne z mapy nocy
// zapalane z zapadaniem zmroku. WGSL budowany w Node (WGSLNodeBuilder bez GPU, jak tests/planet3dTSL.test.mjs).
// node --test tests/moonSurface.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';
import {
  MOON_NIGHT, MOON_SURFACE_NAME, MOON_SURFACE_STATS, createMoonSurfaceMaterial, moonNightCpu, setMoonSunDirection, setMoonSunLight
} from '../src/3d/moonSurface.tsl.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.highPrecision = true;

// Słońce gry (DirectSun.sunLight, rzuca cień) i wypełnienie Core3D (fiolet, bez cienia)
const SUN = new THREE.DirectionalLight(0xffeedd, 1.45);
SUN.castShadow = false;            // bez mapy cienia w teście — słońce wskazane rejestracją
const FILL = new THREE.DirectionalLight(0x8b79ff, 0.1);
const AMB = new THREE.AmbientLight(0x1b2c80, 0.5);
setMoonSunLight(SUN);
// Słońce gry (DirectSun.sunLight) jako światło materiału — bez świateł model three nie liczy członu słońca
// (a z nim mapy normalnych i haka maski 'direct'). Kopia materiału, żeby nie zmieniać badanego.
function buildWGSL(material) {
  const m = material.clone();
  m.map = material.map;
  m.normalMap = material.normalMap;
  m.normalScale.copy(material.normalScale);
  m.emissive.copy(material.emissive);
  m.emissiveMap = material.emissiveMap;
  m.uniforms = material.uniforms;
  m.moonSunMask = material.moonSunMask;
  m.setupLightingModel = material.setupLightingModel;
  m.customProgramCacheKey = material.customProgramCacheKey;
  m.lightsNode = lights([SUN, FILL, AMB]);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), m);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = m;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = m;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const tex = (colorSpace = THREE.NoColorSpace) => {
  const t = new THREE.Texture();
  t.image = { width: 1, height: 1 };
  t.colorSpace = colorSpace;
  return t;
};
const moon = (sunMask = true) => createMoonSurfaceMaterial({
  map: tex(THREE.SRGBColorSpace), nightMap: tex(THREE.SRGBColorSpace), normalMap: tex(), normalScale: 1.2, sunMask
});

test('jeden graf emisji na wariant — księżyce dzielą węzeł i program, tekstury per materiał', () => {
  const graphs = MOON_SURFACE_STATS.graphs;
  const a = moon();
  const b = moon();
  assert.equal(a.name, MOON_SURFACE_NAME);
  assert.equal(a.emissiveNode, b.emissiveNode, 'wspólny węzeł emisji');
  assert.notEqual(a.map, b.map, 'mapy per materiał (wbudowane pola — odwołania do rysowanego materiału)');
  assert.equal(a.customProgramCacheKey(), b.customProgramCacheKey(), 'ten sam klucz programu');
  assert.ok(MOON_SURFACE_STATS.graphs - graphs <= 1, 'najwyżej jedna budowa grafu dla wariantu z maską');
  const wa = buildWGSL(a);
  const wb = buildWGSL(b);
  assert.equal(wa.fragment, wb.fragment, 'ten sam WGSL');
  const bez = moon(false);
  assert.notEqual(bez.emissiveNode, a.emissiveNode, 'wariant bez maski słońca (tło perspektywy) — osobny węzeł');
  assert.ok(bez.customProgramCacheKey() !== a.customProgramCacheKey());
});

test('WGSL: mapa nocy, normalne, maska słońca w emisji i w świetle słońca', () => {
  const { fragment } = buildWGSL(moon());
  // mapa dnia, mapa nocy, mapa normalnych, maska słońca — cztery próbki tekstur
  const probki = (fragment.match(/textureSample(Level)?\(/g) || []).length;
  assert.ok(probki >= 4, `próbki tekstur: ${probki}`);
  assert.match(fragment, /smoothstep\( -0\.1, 0\.06,/, 'zmrok jak miasta planet');
  assert.match(fragment, /smoothstep\( 0\.006, 0\.025,/, 'próg świateł');
  // maska słońca: emisja (zaćmienie zapala światła) i człon słońca (hak 'direct')
  const maska = (fragment.match(/fragCoord\.xy \/ object\.nodeUniform\d+/g) || []).length;
  assert.ok(maska >= 2, `odczyty maski słońca po pikselu (emisja + światło słońca): ${maska}`);
  const bez = buildWGSL(moon(false)).fragment;
  assert.ok(bez.length < fragment.length, 'bez maski słońca krótszy shader');
});

test('lustro CPU: światła tylko po stronie nocnej, zapalają się w cieniu planety', () => {
  const n = [0.6, 0.5, 0.3];
  const dzien = moonNightCpu(n, 0.5, 1);
  const zmierzch = moonNightCpu(n, 0.0, 1);
  const noc = moonNightCpu(n, -0.4, 1);
  const zacmienie = moonNightCpu(n, 0.5, 0);
  assert.deepEqual(dzien, [0, 0, 0], 'w pełnym dniu nic');
  assert.ok(zmierzch[0] > 0 && zmierzch[0] < noc[0], 'zmrok narasta');
  assert.ok(Math.abs(zacmienie[0] - noc[0]) < 1e-12, 'w cieniu planety jak w nocy');
  assert.deepEqual(moonNightCpu([0.003, 0.003, 0.003], -1, 1).map((v) => v < 1e-5), [true, true, true], 'poświata gruntu z mapy nocy odcięta');
  assert.ok(moonNightCpu([1, 1, 1], -1, 1)[0] > 4, 'jasne światło w HDR (bloom), jak miasta Ziemi');
  assert.equal(MOON_NIGHT.dusk1, 0.06);
});

test('kierunek do Słońca per księżyc, normalizowany; słońce gry w płaszczyźnie, wypełnienie bez zmian', () => {
  const a = moon();
  const b = moon();
  setMoonSunDirection(a, 0, 3, 4);
  setMoonSunDirection(b, -5, 0, 0);
  assert.ok(Math.abs(a.uniforms.uSunDir.value.y - 0.6) < 1e-9 && Math.abs(a.uniforms.uSunDir.value.z - 0.8) < 1e-9);
  assert.equal(b.uniforms.uSunDir.value.x, -1, 'osobny wektor na materiał');
  setMoonSunDirection(a, 0, 0, 0);
  assert.ok(Math.abs(a.uniforms.uSunDir.value.length() - 1) < 1e-9, 'zerowy wektor ignorowany');
  setMoonSunDirection(new THREE.MeshStandardMaterial(), 1, 0, 0);    // dawny materiał (?planety=stare) — bez błędu
  // hak: słońce gry świeci z uniformu per obiekt (świat → widok) — tego samego, z którego emisja liczy zmrok;
  // wypełnienie (drugie światło kierunkowe) zostaje ze swoim kierunkiem z macierzy światła
  const { fragment } = buildWGSL(a);
  const sun = fragment.match(/normalize\( \( render\.cameraViewMatrix \* vec4<f32>\( object\.(nodeUniform\d+), 0\.0 \) \)\.xyz \)/);
  assert.ok(sun, 'kierunek słońca gry z uniformu per obiekt');
  assert.match(fragment, new RegExp(`dot\\( normalWorldGeometry, object\\.${sun[1]} \\)`), 'zmrok świateł nocnych z tego samego kierunku');
  assert.equal((fragment.match(/D_GGX\(/g) || []).length, 2, 'dwa światła kierunkowe w modelu (słońce i wypełnienie)');
  // noc czarna jak na planetach: otoczenie i pozostałe światła sceny × moonLightTune.other
  const k = fragment.match(/indirectDiffuse \* vec3<f32>\( object\.(nodeUniform\d+) \)/);
  assert.ok(k, 'otoczenie przygaszone');
  assert.ok(fragment.includes(`indirectSpecular * vec3<f32>( object.${k[1]} )`), 'odbicia otoczenia tym samym mnożnikiem');
});

test('DirectMoon: mapy z MOON_MAPS, materiał księżyca, Słońce w płaszczyźnie gry; pliki map istnieją', async () => {
  const src = read('src/3d/planet3d.assets.js');
  assert.match(src, /MOON_MAPS\[String\(this\.tune\?\.id \|\| 'moon'\)\]/);
  assert.match(src, /createMoonSurfaceMaterial\(\{/);
  assert.match(src, /setMoonSunDirection\(this\.mesh\.material, window\.SUN\.x - mx, -\(window\.SUN\.y - my\), 0\)/, 'Słońce − środek, z = 0');
  assert.match(src, /setMoonSunDirection\(this\.mesh\.material, _lensSun\.x, _lensSun\.y, _lensSun\.z\)/, 'soczewka: słońce obrócone z bryłą');
  assert.match(src, /setMoonSunLight\(Core3D\._sunShadowLight\)/);
  assert.doesNotMatch(src, /colorTex: 'assets|bumpTex: 'assets/, 'ścieżki map tylko w planetMaps.js');
  const maps = read('src/3d/planetMaps.js');
  for (const id of ['moon', 'io', 'europa', 'ganymede', 'callisto']) assert.match(maps, new RegExp(`\\b${id}: \\{ day:`), `MOON_MAPS.${id}`);
  for (const plik of ['luna', 'io', 'europa', 'ganymede', 'callisto']) {
    for (const rodzaj of ['color', 'night', 'normal']) {
      const p = `public/assets/planety/solar/moons/${plik}_hf_${rodzaj}.jpg`;
      assert.ok(existsSync(new URL(`../${p}`, import.meta.url)), `brak ${p}`);
    }
  }
});
