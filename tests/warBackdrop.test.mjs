// Bitwa w głębi sceny „Wojna” (2026-10-19): plan bohaterów (gra i render liczą to samo), symulacja widoku tłumu
// (determinizm z ziarna, limity, rozpad), blok migawki i grafy TSL obrazu (WGSL w Node, bez GPU).
// node --test tests/warBackdrop.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import {
  WB_BANDS, WB_CLASSES, WB_EV, WB_HERO, WB_BAND_FG, planWarHero, heroFocus, heroShipPose, warpSlideDist, warpSlideSpeed, wbClassIndex
} from '../src/render/warBackdropPlan.js';
import { createWarBackdropSim, WB_SHIP_CAP, WB_MODE, WB_STEP } from '../src/3d/warBackdrop/warBackdropSim.js';
import { createWarBackdropFrame, createWarBackdropBlock, applyWarBackdropBlock, WB_HERO_MAX } from '../src/render/blocks/warBackdropBlock.js';
import { WarBackdrop3D } from '../src/3d/warBackdrop/warBackdrop3D.js';

const countingSink = () => {
  const c = { shot: 0, flash: 0, ring: 0, debris: 0, beam: 0, streak: 0, bad: 0 };
  const chk = (...a) => { for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) c.bad++; };
  return {
    c,
    sink: {
      shot(...a) { c.shot++; chk(...a); }, flash(...a) { c.flash++; chk(...a); }, ring(...a) { c.ring++; chk(...a); },
      debris(...a) { c.debris++; chk(...a); }, beam(...a) { c.beam++; chk(...a); }, streak(...a) { c.streak++; chk(...a); }
    }
  };
};

test('plan: klasy i pasma — pasmo FG nad płaszczyzną, reszta pod nią, sprite\'y na każdą klasę', () => {
  assert.ok(WB_BANDS[WB_BAND_FG].z0 > 0);
  for (let i = 0; i < WB_BANDS.length; i++) {
    const b = WB_BANDS[i];
    assert.ok(b.z1 > b.z0);
    if (i !== WB_BAND_FG) assert.ok(b.z1 < 0, `${b.name} pod płaszczyzną`);
  }
  const share = WB_BANDS.reduce((s, b) => s + b.share, 0);
  assert.ok(Math.abs(share - 1) < 1e-6);
  assert.ok(wbClassIndex('atlas') >= 0 && wbClassIndex('pirate_supercapital') >= 0);
  for (const c of WB_CLASSES) assert.ok(c.len > c.wid && c.sprite, c.id);
});

test('plan: pęd po warpie — droga ciągła, prędkość k × marsz gaśnie do marszu', () => {
  assert.equal(warpSlideDist(500, 0), 0);
  assert.ok(Math.abs(warpSlideSpeed(500, 0) - 1500) < 1e-9);
  assert.ok(Math.abs(warpSlideSpeed(500, 10) - 500) < 1);
  const h = 1e-4;
  for (const t of [0.1, 0.8, 3]) {
    const v = (warpSlideDist(500, t + h) - warpSlideDist(500, t)) / h;
    assert.ok(Math.abs(v - warpSlideSpeed(500, t)) < 0.5);
  }
});

test('plan bohaterów: kombo — lanca z dziobu Atlasa w środek pancernika, pancernik ginie po lancy', () => {
  const p = planWarHero({ kind: WB_HERO.COMBO, t0: 10, x: 5000, y: -2000, z: 9000, heading: 0.6, seed: 3 });
  assert.equal(p.ships.length, 2);
  const [A, B] = p.ships;
  assert.equal(WB_CLASSES[A.cls].id, 'atlas');
  assert.equal(WB_CLASSES[B.cls].id, 'pirate_battleship');
  for (let i = 1; i < p.events.length; i++) assert.ok(p.events[i].t >= p.events[i - 1].t, 'zdarzenia rosnąco');
  const lance = p.events.find((e) => e.type === WB_EV.BEAM);
  const kill = p.events.find((e) => e.type === WB_EV.KILL);
  assert.ok(lance && kill && kill.t > lance.t && kill.who === 1);
  const pa = heroShipPose(A, lance.t);
  const pb = heroShipPose(B, lance.t);
  const bowX = pa.x + Math.cos(pa.ang) * WB_CLASSES[A.cls].len * 0.5;
  const bowY = pa.y + Math.sin(pa.ang) * WB_CLASSES[A.cls].len * 0.5;
  const dir = Math.atan2(pb.y - bowY, pb.x - bowX);
  const off = Math.abs(Math.atan2(Math.sin(dir - pa.ang), Math.cos(dir - pa.ang)));
  assert.ok(off < 0.05, `lanca wzdłuż kila (odchyłka ${off.toFixed(3)} rad)`);
  assert.ok(Math.abs(pb.x - 5000) < 1 && Math.abs(pb.y + 2000) < 1, 'pancernik w punkcie kulminacji');
  const f = heroFocus(p, lance.t);
  assert.ok(Number.isFinite(f.x) && f.extent > 3000 && f.extent < 9000);
});

test('plan bohaterów: pojedynek — oba okręty z warpa, wiązki w obie strony, obaj giną', () => {
  const p = planWarHero({ kind: WB_HERO.DUEL, t0: 30, x: 0, y: 0, z: 10000, heading: 2.0, seed: 6 });
  const [A, B] = p.ships;
  assert.ok(A.warp && B.warp);
  assert.equal(WB_CLASSES[B.cls].id, 'pirate_supercapital');
  const beams = p.events.filter((e) => e.type === WB_EV.BEAM);
  assert.deepEqual(beams.map((e) => e.from).sort(), [0, 1]);
  const kills = p.events.filter((e) => e.type === WB_EV.KILL).map((e) => e.who).sort();
  assert.deepEqual(kills, [0, 1]);
  // mijają się burta w burtę: w chwili spotkania odległość ~ przesunięcie w bok
  const pa = heroShipPose(A, p.keys.meet);
  const pb = heroShipPose(B, p.keys.meet);
  const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
  assert.ok(d > 1200 && d < 2500, `odległość przy spotkaniu ${d.toFixed(0)}`);
});

test('symulacja: deterministyczna z ziarna, tłum w limitach, efekty bez NaN, bohaterowie grają do końca', () => {
  const run = (seed) => {
    const { c, sink } = countingSink();
    const sim = createWarBackdropSim({ seed, density: 1, frontAxis: 0.4, sink });
    sim.prewarm(6);
    sim.addHero(planWarHero({ kind: WB_HERO.COMBO, t0: sim.time + 1, x: 4000, y: 2000, z: 9000, heading: 0.3, seed: 1 }));
    sim.addHero(planWarHero({ kind: WB_HERO.DUEL, t0: sim.time + 4, x: -6000, y: 0, z: 10000, heading: 1.2, seed: 2 }));
    for (let k = 0; k < 30 * 30; k++) sim.step(WB_STEP);
    return { sim, c };
  };
  const a = run(5);
  const b = run(5);
  assert.deepEqual(a.c, b.c);
  assert.deepEqual(Array.from(a.sim.x.slice(0, 64)), Array.from(b.sim.x.slice(0, 64)));
  const st = a.sim.count();
  assert.ok(st.alive > 400 && st.alive <= WB_SHIP_CAP, `żywych ${st.alive}`);
  assert.ok(st.kills > 50, `zniszczonych ${st.kills}`);
  assert.equal(a.c.bad, 0, 'liczby zlewu skończone');
  assert.ok(a.c.shot > 1000 && a.c.beam >= 4 && a.c.streak > 10);
  for (const arr of [a.sim.x, a.sim.y, a.sim.z, a.sim.vx, a.sim.vy, a.sim.ang, a.sim.cx, a.sim.cy]) {
    assert.ok(Array.from(arr).every(Number.isFinite));
  }
  for (const H of a.sim.heroes) assert.ok(H.done && H.next === H.plan.events.length);
  // pasma: każdy okręt w swoim paśmie głębokości (bohaterowie — wysokość planu)
  for (let i = 0; i < a.sim.n; i++) {
    if (!a.sim.active[i] || a.sim.hero[i] >= 0) continue;
    const band = WB_BANDS[a.sim.band[i]];
    assert.ok(a.sim.z[i] >= band.z0 - 1 && a.sim.z[i] <= band.z1 + 1);
  }
  const c = createWarBackdropSim({ seed: 6 });
  c.prewarm(6);
  assert.notDeepEqual(Array.from(c.x.slice(0, 64)), Array.from(a.sim.x.slice(0, 64)));
});

test('symulacja: rozpad — kawałki z pasów kadłuba, cięcie wiązką dzieli na dwie strony', () => {
  const sim = createWarBackdropSim({ seed: 9 });
  sim.addHero(planWarHero({ kind: WB_HERO.COMBO, t0: 0.5, x: 0, y: 0, z: 9000, heading: 0, seed: 4 }));
  for (let k = 0; k < 30 * 13; k++) sim.step(WB_STEP);
  let cut = 0;
  for (let k = 0; k < sim.cActive.length; k++) {
    if (!sim.cActive[k] || !sim.cHero[k]) continue;
    assert.ok(sim.cB1[k] > sim.cB0[k]);
    if (sim.cSide[k] !== 0) cut++;
  }
  assert.ok(cut >= 2, `kawałki po cięciu lancą: ${cut}`);
});

test('blok migawki: pakowanie i odczyt — ten sam stan sceny i bohaterów', () => {
  const s = createWarBackdropFrame();
  Object.assign(s, { has: true, id: 7, t: 12.5, cx: 2.75e6, cy: -1.2e5, axis: 0.7, seed: 42, density: 0.8, prewarm: 15, fade: 0.9, sunX: 1, sunY: -2, heroN: 2 });
  Object.assign(s.planet, { on: 1, maps: 2, r: 165000, z: -385000, dx: 150000, dy: -3000, spin: 1.1 });
  Object.assign(s.heroes[0], { kind: 1, t0: 14, x: 3000, y: -500, z: 9500, heading: 0.4, seed: 3 });
  Object.assign(s.heroes[1], { kind: 2, t0: 34, x: -4000, y: 800, z: 10500, heading: 2.2, seed: 6 });
  const blk = createWarBackdropBlock();
  const page = { f64: new Float64Array(blk.f64) };
  blk.pack(page, { warBackdrop: s });
  const m = applyWarBackdropBlock(page, createWarBackdropFrame());
  assert.equal(m.has, true);
  for (const k of ['id', 't', 'cx', 'cy', 'axis', 'seed', 'density', 'prewarm', 'fade', 'sunX', 'sunY', 'heroN']) assert.equal(m[k], s[k], k);
  assert.deepEqual(m.planet, s.planet);
  assert.deepEqual(m.heroes.slice(0, 2), s.heroes.slice(0, 2));
  assert.equal(m.heroes.length, WB_HERO_MAX);
  blk.pack(page, { warBackdrop: { has: false } });
  assert.equal(applyWarBackdropBlock(page, m).has, false);
});

function fakeCore() {
  const cam = new THREE.PerspectiveCamera(35, 16 / 9, 100, 500000);
  return { scene: new THREE.Scene(), cameraPersp: cam, width: 1600, height: 900, pxScale: 1, getMaxAnisotropy: () => 4, isFreePerspectiveCamera: () => false };
}

test('obraz: WGSL grafów buduje się w Node; siatki na warstwach tła i FG; jeden bufor instancji', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const wb = new WarBackdrop3D(fakeCore());
  const names = new Set();
  for (const mesh of wb.warmupMeshes()) {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material;
    b.scene = new THREE.Scene();
    b.camera = new THREE.PerspectiveCamera();
    b.context.material = mesh.material;
    b.build();
    assert.ok(b.vertexShader.length > 100 && b.fragmentShader.length > 100, mesh.name);
    assert.doesNotMatch(b.fragmentShader, /\bpow\(/, `${mesh.name}: bez pow (ujemna podstawa = NaN)`);
    const bufs = new Set();
    for (const a of Object.values(mesh.geometry.attributes)) bufs.add(a.isInterleavedBufferAttribute ? a.data : a);
    assert.ok(bufs.size <= (mesh.geometry.isInstancedBufferGeometry ? 2 : 3), `${mesh.name}: bufory ${bufs.size}`);
    assert.ok(mesh.layers.isEnabled(1) || mesh.layers.isEnabled(2), mesh.name);
    names.add(mesh.material.name);
  }
  // jeden materiał na rodzaj (tło i FG dzielą graf)
  assert.deepEqual([...names].sort(), ['WarBackdropAtmo', 'WarBackdropFx', 'WarBackdropGlow', 'WarBackdropHull', 'WarBackdropPlanet']);
  assert.equal(wb.hullBg.mesh.material, wb.hullFg.mesh.material);
  assert.equal(wb.evBg.mesh.material, wb.evFg.mesh.material);
});

test('obraz: klatka sceny — rozbieg, pakowanie w kadrze, zdarzenia w pierścieniu, liczby skończone', () => {
  const wb = new WarBackdrop3D(fakeCore());
  wb._loadAtlas = () => {};
  wb._loadPlanet = () => {};
  const f = createWarBackdropFrame();
  Object.assign(f, { has: true, id: 1, t: 0, cx: 2.7e6, cy: 1e5, axis: 0.3, seed: 11, density: 1, prewarm: 4, fade: 1, sunX: 0, sunY: 0, heroN: 1 });
  Object.assign(f.planet, { on: 1, maps: 0, r: 165000, z: -385000, dx: 150000, dy: 0, spin: 0 });
  Object.assign(f.heroes[0], { kind: WB_HERO.COMBO, t0: 1, x: 2000, y: 1000, z: 9000, heading: 0.2, seed: 3 });
  const cam = { x: f.cx, y: f.cy, zoom: 0.05 };
  const prevBudget = 6;
  for (let k = 0; k < 400 && wb.prewarmLeft > 0 || k === 0; k++) wb.update(f, cam);
  assert.ok(wb.prewarmLeft <= 0, 'rozbieg skończony');
  for (let k = 0; k < 600; k++) { f.t += 1 / 60; wb.update(f, cam); }
  assert.ok(wb.root.visible);
  assert.ok(wb.hullBg.count > 50, `kadłuby w tle ${wb.hullBg.count}`);
  assert.ok(wb.glowBg.count > 50);
  for (const B of [wb.hullBg, wb.hullFg, wb.glowBg, wb.glowFg]) {
    assert.ok(Array.from(B.arr.subarray(0, B.count * B.stride)).every(Number.isFinite), B.mesh.name);
  }
  let live = 0;
  const now = wb.U.uTime.value;
  for (let i = 0; i < wb.evBg.cap; i++) {
    const t0 = wb.evBg.arr[i * 16 + 3];
    if (t0 < 1e8) { live++; assert.ok(Array.from(wb.evBg.arr.subarray(i * 16, i * 16 + 16)).every(Number.isFinite)); }
  }
  assert.ok(live > 100 && now > 10, `zdarzenia ${live}, czas ${now}`);
  void prevBudget;
  f.has = false;
  wb.update(f, cam);
  assert.equal(wb.root.visible, false);
  assert.equal(wb.active, false);
});
