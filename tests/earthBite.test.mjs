// Wielki gryz Ziemi: dane (src/data/earthBite.js — blok JSON czytany też przez scripts/planety/gryz.py),
// kształt CPU (lustro shadera i generatora), łata (ściany, dno, kołnierz), klamry, wycięcie kuli i wpięcie w graf.
// node --test tests/earthBite.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { EARTH_BITE } from '../src/data/earthBite.js';
import {
  earthBiteFrame, earthBiteRadius, earthBiteRimRadius, earthBiteRimPsi, earthBiteRimAngle, earthBiteRimMax,
  earthBiteCoords, earthBiteCutsSphere, buildEarthBitePatch, buildEarthBiteRibs, EARTH_RADIUS_KM
} from '../src/3d/earthBiteShape.js';
import { earthBiteCenterIn, earthBiteVector } from '../src/3d/earthBite3D.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const TAU = Math.PI * 2;
const B = EARTH_BITE;

test('dane gryzu: blok JSON dla generatora = obiekt modułu, decyzja użytkownika 0,46 R w 10° N 15° E', () => {
  const src = read('src/data/earthBite.js');
  const m = src.match(/\/\*EARTH_BITE\*\/([\s\S]*?)\/\*EARTH_BITE-KONIEC\*\//);
  assert.ok(m, 'znaczniki bloku JSON');
  assert.deepEqual(JSON.parse(m[1]), JSON.parse(JSON.stringify(B)));
  assert.deepEqual([B.radiusR, B.lat, B.lon], [0.46, 10, 15]);
  const py = read('scripts/planety/gryz.py');
  assert.match(py, /'EARTH_BITE'/);
  // lustro β w generatorze: te same pola danych
  for (const key of ['lobes', 'teeth', 'teethAmp', 'teethWarp', 'teethPhase', 'radiusR', 'skirtPad']) assert.match(py, new RegExp(`'${key}'`));
});

test('rama gryzu: środek jak wierzchołek SphereGeometry (u = 0 na 180° W), E = Y × C, osie ortonormalne', () => {
  const { C, E, N } = earthBiteFrame();
  for (const [a, b] of [[C, C], [E, E], [N, N]]) assert.ok(Math.abs(dot(a, b) - 1) < 1e-12);
  for (const [a, b] of [[C, E], [C, N], [E, N]]) assert.ok(Math.abs(dot(a, b)) < 1e-12);
  const u = (B.lon + 180) / 360, v = 0.5 + B.lat / 180;
  const phi = u * TAU, theta = (1 - v) * Math.PI;
  const s = [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)];
  assert.ok(Math.abs(dot(s, C) - 1) < 1e-9, 'środek gryzu w tym samym miejscu co teksel mapy');
  assert.ok(N[1] > 0, 'północ ku biegunowi');
  const lonE = Math.atan2(-(C[2] + E[2] * 1e-4), C[0] + E[0] * 1e-4) * 180 / Math.PI;
  assert.ok(lonE > B.lon, 'wschód ku rosnącej długości');
  // wschód w shaderze: normalize(C.z, 0, −C.x) (earthBiteEast) = E
  const el = Math.hypot(C[2], C[0]);
  assert.ok(Math.abs(E[0] - C[2] / el) < 1e-12 && Math.abs(E[2] + C[0] / el) < 1e-12);
});

test('promień gryzu: dno okrągłe, brzeg na kuli Ziemi, łuki zębów z ostrzami do środka, zakres jak z danych', () => {
  const { C, E, N } = earthBiteFrame();
  // dno (ψ = 0): wagi płatów i zębów = 0 — ten sam promień w każdym azymucie (bez osobliwości)
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(earthBiteRadius(i / 16 * TAU, 0) - B.radiusR) < 1e-12);
  let lo = Infinity, hi = 0;
  for (let i = 0; i < 720; i++) {
    const phi = (i / 720) * TAU;
    const psi = earthBiteRimPsi(phi);
    const beta = earthBiteRimRadius(phi);
    assert.ok(Math.abs(earthBiteRadius(phi, psi) - beta) < 1e-12, 'na brzegu wagi = 1');
    const cp = Math.cos(phi), sp = Math.sin(phi), cs = Math.cos(psi), ss = Math.sin(psi);
    const P = [0, 1, 2].map((k) => C[k] + beta * (-cs * C[k] + ss * (cp * E[k] + sp * N[k])));
    assert.ok(Math.abs(Math.hypot(...P) - 1) < 1e-12, `brzeg na kuli przy φ = ${phi}`);
    lo = Math.min(lo, beta); hi = Math.max(hi, beta);
  }
  assert.ok(hi <= earthBiteRimMax() + 1e-12 && hi > B.radiusR * 1.08 && lo < B.radiusR * 0.92, `zakres brzegu ${lo}…${hi}`);
  // otwór 0,46 R: ~26,6° promienia kątowego, ~5 900 km średnicy
  let ang = 0;
  for (let i = 0; i < 360; i++) ang += earthBiteRimAngle(i / 360 * TAU) / 360;
  assert.ok(Math.abs(ang * 2 * EARTH_RADIUS_KM - 5920) < 250, `średnica otworu ${ang * 2 * EARTH_RADIUS_KM} km`);
  // ostrza zębów: lokalne minima β brzegu = teeth
  let cusps = 0;
  const f = (i) => earthBiteRimRadius(((i + 3600) % 3600) / 3600 * TAU) - B.radiusR * (1 + B.lobes.reduce((s, [k, a, ph]) => s + a * Math.cos(k * ((((i + 3600) % 3600) / 3600) * TAU - ph * Math.PI / 180)), 0));
  for (let i = 0; i < 3600; i++) if (f(i) < f(i - 1) && f(i) <= f(i + 1)) cusps++;
  assert.equal(cusps, B.teeth);
});

test('wycięcie kuli: środek i brzeg w gryzie, poza brzegiem + cutPad — kula zostaje; łata przykrywa wycięcie', () => {
  const { C, E } = earthBiteFrame();
  assert.ok(earthBiteCutsSphere(C[0], C[1], C[2]));
  assert.ok(B.skirtPad > B.cutPad, 'kołnierz łaty sięga dalej niż wycięcie kuli');
  const out = new Float64Array(4);
  for (const [k, inside] of [[0.98, true], [1.0 + B.cutPad * 0.5 / B.radiusR, true], [1.06, false]]) {
    const phi = 0.3;
    const th = 2 * Math.asin(Math.min(1, earthBiteRimRadius(phi) * k / 2));
    const { N } = earthBiteFrame();
    const d = [0, 1, 2].map((i) => Math.cos(th) * C[i] + Math.sin(th) * (Math.cos(phi) * E[i] + Math.sin(phi) * N[i]));
    assert.equal(earthBiteCutsSphere(d[0], d[1], d[2]), inside, `k = ${k}`);
    earthBiteCoords(d[0], d[1], d[2], B, B.radiusR, undefined, out);
    assert.ok(Math.abs(out[2] - phi) < 1e-9, 'azymut punktu kuli = azymut wokół C');
  }
});

test('łata: dno najgłębiej (1 − R gryzu), brzeg i koniec kołnierza na kuli, trójkąty twarzą do wnętrza, uv jak kula', () => {
  const p = buildEarthBitePatch(B, { rings: 40, segments: 90, skirtRings: 4 });
  const n = p.position.length / 3;
  const S = p.segments + 1;
  const r = (i) => Math.hypot(p.position[i * 3], p.position[i * 3 + 1], p.position[i * 3 + 2]);
  let minR = Infinity;
  for (let i = 0; i < n; i++) {
    minR = Math.min(minR, r(i));
    const lon = p.uv[i * 2] * 360 - 180, lat = (p.uv[i * 2 + 1] - 0.5) * 180;
    const d = [Math.cos(lat * Math.PI / 180) * Math.cos(lon * Math.PI / 180), Math.sin(lat * Math.PI / 180), -Math.cos(lat * Math.PI / 180) * Math.sin(lon * Math.PI / 180)];
    assert.ok(dot(d, [p.normal[i * 3], p.normal[i * 3 + 1], p.normal[i * 3 + 2]]) > 1 - 1e-6, 'uv = kierunek normalnej (jak SphereGeometry)');
  }
  assert.ok(Math.abs(minR - (1 - B.radiusR)) < 1e-6, `dno ${minR}`);
  const rimRow = (p.cavityRings - 1) * S;
  for (let j = 0; j < S; j++) assert.ok(Math.abs(r(rimRow + j) - 1) < 1e-6, 'brzeg na kuli');
  for (let j = 0; j < S; j++) assert.ok(Math.abs(r(n - S + j) - 1) < 1e-6, 'koniec kołnierza na kuli (szew)');
  // nawinięcie: ściany i dno patrzą do wnętrza gryzu (ku C), kołnierz — na zewnątrz kuli
  const { C } = earthBiteFrame();
  let inward = 0, total = 0;
  for (let t = 0; t < (p.cavityRings - 1) * p.segments * 6; t += 3) {
    const [a, b, c] = [p.index[t], p.index[t + 1], p.index[t + 2]].map((k) => new THREE.Vector3().fromArray(p.position, k * 3));
    const nn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (nn.lengthSq() < 1e-24) continue;
    total++;
    if (nn.dot(new THREE.Vector3(...C).sub(a)) > 0) inward++;
  }
  assert.ok(inward > total * 0.97, `twarzą do wnętrza: ${inward} / ${total}`);
});

test('klamry: belki nad otworem, kotwy za brzegiem w gruncie, ściany na zewnątrz bryły belki', () => {
  const p = buildEarthBiteRibs(B, { step: 0.01 });
  const k = 1 / EARTH_RADIUS_KM;
  let minR = Infinity, maxR = 0, over = 0;
  const out = new Float64Array(4);
  for (let i = 0; i < p.position.length / 3; i++) {
    const x = p.position[i * 3], y = p.position[i * 3 + 1], z = p.position[i * 3 + 2];
    const rr = Math.hypot(x, y, z);
    minR = Math.min(minR, rr); maxR = Math.max(maxR, rr);
    earthBiteCoords(x / rr, y / rr, z / rr, B, B.radiusR, undefined, out);
    if (out[0] < out[3]) over++;
  }
  assert.ok(minR > 1 - 9 * k && maxR < 1 + (B.ribs.anchorTopKm + 1) * k, `wysokość ${minR}…${maxR}`);
  assert.ok(over > 0.5 * p.position.length / 3, 'większość belek nad otworem');
  // nawinięcie zgodne z zapisaną normalną ściany
  for (let t = 0; t < p.index.length; t += 3) {
    const [a, b, c] = [p.index[t], p.index[t + 1], p.index[t + 2]].map((q) => new THREE.Vector3().fromArray(p.position, q * 3));
    const nn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (nn.lengthSq() < 1e-24) continue;
    assert.ok(nn.dot(new THREE.Vector3().fromArray(p.normal, p.index[t] * 3)) > 0, 'twarz zgodna z normalną');
  }
});

test('środek gryzu w układzie rodzeństwa (chmury, dysk poświaty) — z kwaternionów, bez alokacji', () => {
  const from = new THREE.Object3D(), to = new THREE.Object3D();
  const v = new THREE.Vector4(), e = new THREE.Vector3();
  earthBiteCenterIn(from, to, v, e);
  const c0 = earthBiteVector();
  assert.ok(Math.hypot(v.x - c0.x, v.y - c0.y, v.z - c0.z, v.w - c0.w) < 1e-12);
  from.rotation.y = 0.7; to.rotation.y = 0.2; from.updateMatrix(); to.updateMatrix();
  earthBiteCenterIn(from, to, v, e);
  const c = new THREE.Vector3(...earthBiteFrame().C).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
  assert.ok(Math.hypot(v.x - c.x, v.y - c.y, v.z - c.z) < 1e-9 && v.w === B.radiusR);
  assert.ok(Math.abs(e.length() - 1) < 1e-12);
});

test('graf planety: gryz za uniformem obiektu, współrzędne jako czysta funkcja WGSL, wpięcie w grę i menu', () => {
  const src = read('src/3d/planet3d.assets.tsl.js');
  assert.match(src, /uPitMode: 'float', uBite: 'vec4'/);
  assert.match(src, /Discard\(U\.uPitMode\.greaterThan\(0\.5\)\.and\(U\.uPitMode\.lessThan\(1\.5\)\)\.and\(biteC\.x\.lessThan\(biteC\.w\.add\(EARTH_BITE_TSL\.cutPad\)\)\)\)/);
  const tsl = read('src/3d/earthBite.tsl.js');
  // funkcje z layoutem nie wołają innych z layoutem (pułapka 35) i nie czytają uniformów (pułapka 1)
  const names = [...tsl.matchAll(/setLayout\(\{ name: '(\w+)'/g)].map((m) => m[1]);
  assert.ok(names.includes('earthBiteCoords') && names.includes('earthBiteBeta'));
  for (const name of names) {
    const start = tsl.indexOf(`export const ${name} =`);
    const body = tsl.slice(start, tsl.indexOf(`setLayout({ name: '${name}'`, start));
    assert.doesNotMatch(body, /uniform\(/, `${name} czyta uniform`);
    for (const other of names) if (other !== name) assert.ok(!body.includes(`${other}(`), `${name} woła ${other}`);
  }
  // potęgi z nieujemną podstawą (pow z ujemną to NaN w WGSL)
  for (const m of tsl.matchAll(/pow\((.{0,10})/g)) assert.match(m[1], /^max\(0\.0, /, `pow(${m[1]}`);
  const game = read('src/3d/planet3d.assets.js');
  assert.match(game, /createEarthBiteMeshes\(createPlanetSurfaceMaterial\(earthBiteUniforms\(this\.uniforms, 2\)\),\s*createPlanetSurfaceMaterial\(earthBiteUniforms\(this\.uniforms, 3\)\)\)/);
  assert.match(game, /earthBiteCenterIn\(this\.mesh, this\.clouds, this\.cloudUniforms\.uBite\.value\)/);
  assert.match(game, /earthBiteCenterIn\(this\.mesh, this\.atmosphere, au\.uBite\.value, au\.uBiteEast\.value\)/);
  const menu = read('src/3d/menuBackdrop3D.js');
  assert.match(menu, /createMenuAtmosphereMaterial\(ring, R \+ 1250, \{ bite: pit \}\)/);
  assert.match(menu, /pitMode: 3, shared: earthM\.uniforms/);
  // dawnej kopalni nie ma
  for (const f of ['src/3d/planet3d.assets.tsl.js', 'src/3d/planet3d.assets.js', 'src/3d/menuBackdrop3D.js', 'src/3d/menuBackdrop3D.tsl.js', 'scripts/planety/ziemia.py']) {
    assert.doesNotMatch(read(f), /earthPit|EARTH_PIT|import dziura/, f);
  }
});
