// Planetoida pod bazą piratów (misja 1, prośba użytkownika 2026-10-15): geometria skały i osady, lina windy
// (spadek po zerwaniu), plan zawalenia, scena brył, render (WGSL wybuchów w Node, klasa osady bez GPU).
// node --test tests/pirateRock.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';

import {
  PIRATE_ROCK_COLLAPSE, PIRATE_ROCK_SITE, PIRATE_ROCK_SPEC, createPirateRockLayout, pirateRockCollapsePose, pirateRockLonLat,
  pirateRockPowerAt, pirateRockSurfaceH, planPirateRockCollapse
} from '../src/3d/portBuildings/pirateRockLayout.js';
import { createTetherSim, releaseTetherBottom, snapTether, stepTetherSim, climberParam } from '../src/3d/portBuildings/pirateRockTether.js';
import { buildPirateRockScene } from '../src/3d/portBuildings/pirateRockScene.js';
import { PB_MAX_GROUPS, PB_STRIDE } from '../src/3d/portBuildings/portBuildingScene.js';
import { createPirateBaseLayout, PIRATE_BASE_SPEC } from '../src/3d/portBuildings/pirateBaseLayout.js';
import { k7HeightToZ } from '../src/3d/haloRing/haloPortK7Layout.js';
import { SMALL_BODY_MAPS, SMALL_BODY_SHAPE_RANGE } from '../src/3d/planetMaps.js';
import { PirateRockFx3D } from '../src/3d/pirateRockFx3D.js';

const L = createPirateRockLayout();
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rot = (q, v) => new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(new THREE.Quaternion(q[0], q[1], q[2], q[3]));

test('skała: stopa windy na szczycie kuli, taras w obrębie, kula pod całą bazą z zapasem', () => {
  assert.ok(Math.abs(dist(L.foot, L.center) - L.R) < 1e-6);
  assert.equal(L.foot[1], PIRATE_ROCK_SPEC.footH);
  // najwyższy punkt skały (stopa) dużo niżej niż najniższa część bazy (dno dysku mieszkalnego)
  const discBottom = k7HeightToZ(PIRATE_BASE_SPEC.habitat.discY0);
  assert.ok(L.foot[1] < discBottom - 5000, `szczyt skały ${L.foot[1]} vs dno dysku ${discBottom}`);
  // pod całą obwiednią bazy powierzchnia ≥ 5 km pod płaszczyzną
  const base = createPirateBaseLayout();
  const b = base.bounds;
  for (let x = b.x0; x <= b.x1; x += 250) {
    for (let z = b.z0; z <= b.z1; z += 250) assert.ok(pirateRockSurfaceH(L, x, z) < -5000);
  }
  // skała wystaje za bazę (szkic: „wystaje z boku”) w wolną ćwiartkę +x, +z
  const far = [L.center[0] + Math.cos(PIRATE_ROCK_SPEC.bearing) * L.R * 0.9, L.center[2] + Math.sin(PIRATE_ROCK_SPEC.bearing) * L.R * 0.9];
  assert.ok(far[0] > b.x1 || far[1] > b.z1);
});

test('mapa skały: stopa windy = (lon 0, lat 0), wschód +lon, północ +lat; obrót kuli three zgodny z mapą', () => {
  assert.deepEqual(L.uvAt(0, 0), { u: 0.5, v: 0.5 });
  // lokalne +X kuli → normalna stopy; −Z → wschód; +Y → północ
  const X = rot(L.meshQuat, [1, 0, 0]);
  const Y = rot(L.meshQuat, [0, 1, 0]);
  const Z = rot(L.meshQuat, [0, 0, 1]);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(X.getComponent(i) - L.up[i]) < 1e-9);
    assert.ok(Math.abs(Y.getComponent(i) - L.north[i]) < 1e-9);
    assert.ok(Math.abs(Z.getComponent(i) + L.east[i]) < 1e-9);
  }
  // punkt (e, n): kierunek w kuli three (SphereGeometry: x = −cos φ sin θ, y = cos θ, z = sin φ sin θ, u = φ / 2π,
  // v = 1 − θ / π) daje te same (u, v) co uvAt
  const inv = new THREE.Quaternion(...L.meshQuat).invert();
  for (const [e, n] of [[1200, -800], [-3000, 2500], [6000, 4000]]) {
    const p = L.surfacePoint(e, n);
    const d = new THREE.Vector3(p.x - L.center[0], p.h - L.center[1], p.z - L.center[2]).normalize().applyQuaternion(inv);
    const theta = Math.acos(d.y);
    let phi = Math.atan2(d.z, -d.x);
    if (phi < 0) phi += Math.PI * 2;
    const uv = L.uvAt(e, n);
    assert.ok(Math.abs(phi / (Math.PI * 2) - uv.u) < 1e-9, `u ${e},${n}`);
    assert.ok(Math.abs(1 - theta / Math.PI - uv.v) < 1e-9, `v ${e},${n}`);
  }
  // odległość po powierzchni zachowana (mapa wykładnicza)
  const ll = pirateRockLonLat(3000, 0, L.R);
  assert.ok(Math.abs(ll.lon * L.R - 3000) < 1e-6 && Math.abs(ll.lat) < 1e-12);
});

test('osada: budowle na tarasie, ramki ortonormalne z osią Y wzdłuż normalnej', () => {
  for (const b of L.buildings) {
    assert.ok(Math.hypot(b.e, b.n) + b.r <= PIRATE_ROCK_SPEC.plateau, b.id);
    const F = b.frame;
    assert.ok(Math.abs(dist(F.o, L.center) - L.R) < 1e-6, b.id);
    const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    assert.ok(Math.abs(dot(F.X, F.Y)) < 1e-9 && Math.abs(dot(F.X, F.Z)) < 1e-9 && Math.abs(dot(F.Y, F.Z)) < 1e-9);
    const n = [(F.o[0] - L.center[0]) / L.R, (F.o[1] - L.center[1]) / L.R, (F.o[2] - L.center[2]) / L.R];
    assert.ok(Math.abs(dot(F.Y, n) - 1) < 1e-9, b.id);
  }
  // drogi łączą istniejące budowle
  for (const [a, c] of PIRATE_ROCK_SITE.roads) assert.ok(L.buildingById.has(a) && L.buildingById.has(c));
});

test('lina: od głowicy pod dyskiem habitatu do wieży stacji dolnej, równe odcinki, widoczna spod dysku', () => {
  const N = L.tether.segments;
  const P = L.tether.nodes;
  assert.deepEqual([P[0], P[1], P[2]], L.anchor);
  assert.deepEqual([P[N * 3], P[N * 3 + 1], P[N * 3 + 2]], L.stationTop);
  assert.ok(L.anchor[1] < k7HeightToZ(PIRATE_BASE_SPEC.habitat.discY0));
  // stopa windy dalej od osi habitatu niż brzeg dysku (z góry lina wychodzi spod dysku)
  assert.ok(Math.hypot(L.foot[0], L.foot[2]) > PIRATE_BASE_SPEC.habitat.discR * 2);
  for (let i = 0; i < N; i++) {
    const a = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    const b = [P[i * 3 + 3], P[i * 3 + 4], P[i * 3 + 5]];
    assert.ok(Math.abs(dist(a, b) - L.tether.segLen) < 1e-6);
  }
  // kabiny: trapez 0 → 1 → 0 w okresie
  assert.equal(climberParam(0, 0), 0);
  let lo = 1;
  let hi = 0;
  for (let t = 0; t < 46; t += 0.25) { const s = climberParam(0, t); lo = Math.min(lo, s); hi = Math.max(hi, s); }
  assert.equal(lo, 0);
  assert.equal(hi, 1);
});

function runFall(hz, seconds = 40) {
  const sim = createTetherSim(L);
  snapTether(sim, [0.3, 0.8]);
  const ev = [];
  let t = 0;
  const dt = 1 / hz;
  for (let f = 0; f < seconds * hz && !sim.sleeping; f++) {
    stepTetherSim(sim, dt, (kind, i, x, h, z, v, k) => ev.push({ t, kind, i, v, k }));
    t += dt;
    if (t >= 1.7 && !sim.bottomFree) releaseTetherBottom(sim);
  }
  return { sim, ev, t };
}

test('lina po zerwaniu: spada ku skale, głowica i kabiny uderzają, kładzie się na kuli i zasypia', () => {
  const { sim, ev, t } = runFall(60);
  assert.ok(sim.sleeping, `zasypia (t = ${t.toFixed(1)} s)`);
  const head = ev.find((e) => e.kind === 'head');
  assert.ok(head && head.t > 2 && head.t < 12, `głowica uderza po ${head?.t}`);
  assert.equal(ev.filter((e) => e.kind === 'climber').length, 2);
  for (let i = 0; i < sim.n; i++) {
    const p = [sim.pos[i * 3], sim.pos[i * 3 + 1], sim.pos[i * 3 + 2]];
    assert.ok(p.every(Number.isFinite));
    assert.ok(dist(p, L.center) >= sim.R - 1, `węzeł ${i} nad powierzchnią`);
    assert.ok(dist(p, L.center) <= sim.R + 60, `węzeł ${i} leży na skale`);
  }
  // odskok: lina pęknięta pod głowicą cofa się ku stacji dolnej i leży zwinięta przy osadzie (z góry „ucieka” spod dysku)
  let reach = 0;
  for (let i = 1; i < sim.n; i++) reach = Math.max(reach, Math.hypot(sim.pos[i * 3] - L.foot[0], sim.pos[i * 3 + 2] - L.foot[2]));
  assert.ok(reach < 0.5 * Math.hypot(L.foot[0], L.foot[2]), `lina sięga ${reach.toFixed(0)} j. od stopy`);
  // deterministycznie i bez zależności od kroku klatki (60 / 120 Hz — podkrok stały)
  const again = runFall(60);
  assert.deepEqual(Array.from(again.sim.pos), Array.from(sim.pos));
  const hz120 = runFall(120);
  const h120 = hz120.ev.find((e) => e.kind === 'head');
  assert.ok(Math.abs(h120.t - head.t) < 0.1);
});

test('plan zawalenia: wszystkie budowle, stacja dolna pierwsza, zasilanie gaśnie do zera', () => {
  const ev = planPirateRockCollapse(L);
  assert.equal(ev[0].kind, 'snap');
  const b = ev.filter((e) => e.kind === 'building');
  assert.equal(b.length, L.buildings.length);
  assert.equal(b[0].id, 'foot');
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].t >= ev[i - 1].t);
  assert.equal(pirateRockPowerAt(0), 1);
  assert.equal(pirateRockPowerAt(PIRATE_ROCK_COLLAPSE.powerTo + 0.01), 0);
  const end = pirateRockCollapsePose('plant', 1);
  assert.ok(end.squash < 0.6 && end.tilt > 0.1 && end.sink > 0);
  const mast = pirateRockCollapsePose('mast', 1);
  assert.ok(mast.tilt > 1.2, 'maszt się przewraca');
});

test('scena: grupy w limicie, bryły skończone, osada przy powierzchni, lina i kabiny na linii', () => {
  const sc = buildPirateRockScene(L);
  const g = sc.groupOf;
  const all = [...Object.values(g.buildings), g.head, ...g.segments, ...g.climbers];
  assert.ok(Math.max(...all) < PB_MAX_GROUPS);
  assert.equal(new Set(all).size, all.length);
  const byGroup = new Map();
  for (const set of Object.values(sc.sets)) {
    for (const data of Object.values(set)) {
      for (let i = 0; i < data.length; i += PB_STRIDE) {
        for (let k = 0; k < PB_STRIDE; k++) assert.ok(Number.isFinite(data[i + k]));
        const gi = data[i + 12];
        if (!byGroup.has(gi)) byGroup.set(gi, []);
        byGroup.get(gi).push([data[i], data[i + 1], data[i + 2]]);
      }
    }
  }
  for (const [id, gi] of Object.entries(g.buildings)) {
    const pts = byGroup.get(gi);
    assert.ok(pts && pts.length > 5, id);
    for (const p of pts) {
      const d = dist(p, L.center) - L.R;
      assert.ok(d > -400 && d < 1100, `${id}: bryła ${d.toFixed(0)} j. od powierzchni`);
    }
  }
  for (const gi of g.segments) assert.ok(byGroup.get(gi).length >= 3);
  assert.ok(sc.lamps.length > 0 && sc.lamps.length <= 8);
});

test('mapy: skała w SMALL_BODY_MAPS z zakresem kształtu; blok osady czytelny dla generatora', () => {
  assert.ok(SMALL_BODY_MAPS[PIRATE_ROCK_SPEC.id]);
  assert.ok(SMALL_BODY_SHAPE_RANGE[PIRATE_ROCK_SPEC.id]);
  const src = readFileSync(new URL('../src/3d/portBuildings/pirateRockLayout.js', import.meta.url), 'utf8');
  const m = /\/\*PIRATE_ROCK_SITE\*\/(.*?)\/\*PIRATE_ROCK_SITE-KONIEC\*\//s.exec(src);
  assert.ok(m);
  const json = JSON.parse(m[1]);
  assert.equal(json.radius, PIRATE_ROCK_SPEC.radius);
  assert.equal(json.buildings.length, L.buildings.length);
  const gen = readFileSync(new URL('../scripts/planety/male_ciala.py', import.meta.url), 'utf8');
  assert.ok(gen.includes("'PIRATE_ROCK_SITE'") && gen.includes('def hidalgo('));
});

test('wybuchy na skale: WGSL ognia i dymu buduje się w Node, jeden bufor instancji', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const fx = new PirateRockFx3D(1);
  for (const mesh of fx.warmupMeshes()) {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material;
    b.scene = new THREE.Scene();
    b.camera = new THREE.PerspectiveCamera();
    b.context.material = mesh.material;
    b.build();
    assert.ok(b.vertexShader.length > 100 && b.fragmentShader.length > 100, mesh.name);
    const bufs = new Set();
    for (const a of Object.values(mesh.geometry.attributes)) bufs.add(a.isInterleavedBufferAttribute ? a.data : a);
    assert.ok(bufs.size <= 2);
    assert.ok(mesh.layers.isEnabled(1));
  }
  fx.setOrigin(100, 200, -8000);
  fx.blast(100, 200, -8000, 900);
  fx.update(0.5);
  assert.ok(Array.from(fx.fire.arr).every(Number.isFinite));
});
