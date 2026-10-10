// Wielka kopalnia ringu na Ziemi: dane (src/data/earthPit.js — blok JSON czytany też przez
// scripts/planety/dziura.py), profil CPU (lustro shadera i generatora), łata-bryła i wycięcie kuli.
// node --test tests/earthPit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { EARTH_PIT } from '../src/data/earthPit.js';
import {
  earthPitFrame, earthPitOutline, earthPitProfileCpu, buildEarthPitPatch,
  EARTH_PIT_CUT_S, EARTH_PIT_PATCH_S, EARTH_RADIUS_KM
} from '../src/3d/earthPitShape.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('dane dziury: blok JSON dla generatora = obiekt modułu', () => {
  const src = read('src/data/earthPit.js');
  const m = src.match(/\/\*EARTH_PIT\*\/([\s\S]*?)\/\*EARTH_PIT-KONIEC\*\//);
  assert.ok(m, 'znaczniki bloku JSON');
  assert.deepEqual(JSON.parse(m[1]), JSON.parse(JSON.stringify(EARTH_PIT)));
  assert.match(read('scripts/planety/dziura.py'), /'EARTH_PIT'/);
});

test('rama dziury: kierunek jak wierzchołek SphereGeometry (u = 0 na 180° W), osie ortonormalne', () => {
  const { C, E, N } = earthPitFrame();
  for (const [a, b] of [[C, C], [E, E], [N, N]]) assert.ok(Math.abs(dot(a, b) - 1) < 1e-12);
  for (const [a, b] of [[C, E], [C, N], [E, N]]) assert.ok(Math.abs(dot(a, b)) < 1e-12);
  // SphereGeometry: phi = u · 2π, theta = (1 − v) · π; x = −cos φ sin θ, y = cos θ, z = sin φ sin θ
  const u = (EARTH_PIT.lon + 180) / 360, v = 0.5 + EARTH_PIT.lat / 180;
  const phi = u * Math.PI * 2, theta = (1 - v) * Math.PI;
  const s = [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)];
  assert.ok(Math.abs(dot(s, C) - 1) < 1e-9, 'środek dziury w tym samym miejscu co teksel mapy');
  // E w stronę rosnącej długości (u), N ku biegunowi (y)
  assert.ok(N[1] > 0);
  const lonE = Math.atan2(-(C[2] + E[2] * 1e-4), C[0] + E[0] * 1e-4) * 180 / Math.PI;
  assert.ok(lonE > EARTH_PIT.lon);
});

test('profil: krawędź na zerze, tarasy w dół, szyb najgłębiej, wał hałd za krawędzią', () => {
  const out = new Float64Array(4);
  const at = (s, phi = 0.7) => {
    const rho = s * earthPitOutline(phi);
    return earthPitProfileCpu(Math.sin(rho) * Math.cos(phi), Math.sin(rho) * Math.sin(phi), Math.cos(rho), EARTH_PIT, out)[0];
  };
  assert.ok(Math.abs(at(1.0)) < 1e-6, `krawędź ${at(1.0)}`);
  assert.ok(Math.abs(at(0.0) + EARTH_PIT.depthKm + EARTH_PIT.shaftDepthKm) < 1e-6, 'środek = dno + szyb');
  assert.ok(Math.abs(at((EARTH_PIT.floor + EARTH_PIT.shaftR) / 2) + EARTH_PIT.depthKm) < 1e-6, 'płaskie dno');
  assert.ok(at(1 + EARTH_PIT.rimWidth / 2) > 0.9 * EARTH_PIT.rimBermKm, 'wał');
  assert.ok(Math.abs(at(1 + EARTH_PIT.rimWidth + 0.01)) < 1e-9);
  // schody: wysokość nie rośnie w głąb, płaskie półki między skarpami
  let prev = Infinity, flats = 0;
  for (let i = 0; i <= 2000; i++) {
    const s = 1 - (1 - EARTH_PIT.floor) * i / 2000;
    const h = at(s);
    assert.ok(h <= prev + 1e-9, `monotonia przy s = ${s}`);
    if (Math.abs(h - prev) < 1e-9) flats++;
    prev = h;
  }
  assert.ok(flats > 2000 * (1 - EARTH_PIT.riser) * 0.85, `półki płaskie: ${flats}`);
});

test('łata: przykrywa wycięcie kuli, ściany na zewnątrz, uv jak kula, głębia z przewyższeniem', () => {
  assert.ok(EARTH_PIT_PATCH_S > EARTH_PIT_CUT_S);
  const p = buildEarthPitPatch(EARTH_PIT, { rings: 60, segments: 72 });
  const n = p.position.length / 3;
  let minR = Infinity, maxR = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(p.position[i * 3], p.position[i * 3 + 1], p.position[i * 3 + 2]);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    const lon = p.uv[i * 2] * 360 - 180, lat = (p.uv[i * 2 + 1] - 0.5) * 180;
    const d = [Math.cos(lat * Math.PI / 180) * Math.cos(lon * Math.PI / 180), Math.sin(lat * Math.PI / 180), -Math.cos(lat * Math.PI / 180) * Math.sin(lon * Math.PI / 180)];
    const nrm = [p.normal[i * 3], p.normal[i * 3 + 1], p.normal[i * 3 + 2]];
    assert.ok(dot(d, nrm) > 1 - 1e-6, 'uv = kierunek normalnej (jak SphereGeometry)');
  }
  const deepest = 1 - (EARTH_PIT.depthKm + EARTH_PIT.shaftDepthKm) * EARTH_PIT.exaggeration / EARTH_RADIUS_KM;
  assert.ok(Math.abs(minR - deepest) < 1e-4, `najgłębiej ${minR} vs ${deepest}`);
  assert.ok(maxR <= 1 + EARTH_PIT.rimBermKm * EARTH_PIT.exaggeration / EARTH_RADIUS_KM + 1e-6);
  // ostatni pierścień leży na kuli (szew z kulą) i poza wycięciem
  const last = n - 1;
  assert.ok(Math.abs(Math.hypot(p.position[last * 3], p.position[last * 3 + 1], p.position[last * 3 + 2]) - 1) < 1e-6);
  // nawinięcie: normalna trójkąta na zewnątrz kuli
  let outward = 0;
  for (let t = 0; t < p.index.length; t += 3) {
    const [a, b, c] = [p.index[t], p.index[t + 1], p.index[t + 2]].map((k) => new THREE.Vector3().fromArray(p.position, k * 3));
    const nn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (nn.lengthSq() < 1e-20) continue;
    if (nn.dot(a) > 0) outward++; else outward--;
  }
  assert.ok(outward > 0 && outward > p.index.length / 3 * 0.9, `trójkąty na zewnątrz: ${outward}`);
});

test('graf planety: dziura za uniformem obiektu, profil jako czysta funkcja WGSL', () => {
  const src = read('src/3d/planet3d.assets.tsl.js');
  assert.match(src, /uPitMode: 'float'/);
  assert.match(src, /Discard\(U\.uPitMode\.greaterThan\(0\.5\)\.and\(U\.uPitMode\.lessThan\(1\.5\)\)/);
  const pit = read('src/3d/earthPit.tsl.js');
  assert.match(pit, /setLayout\(\{ name: 'earthPitProfile'/);
  // funkcja z layoutem nie woła innej z layoutem (pułapka 35) i nie czyta uniformów
  const body = pit.slice(pit.indexOf('export const earthPitProfile'), pit.indexOf(".setLayout({ name: 'earthPitProfile'"));
  assert.doesNotMatch(body, /uniform|earthPitProfile\(/);
  const game = read('src/3d/planet3d.assets.js');
  assert.match(game, /createEarthPitMesh\(createPlanetSurfaceMaterial\(this\.pitUniforms\)\)/);
});
