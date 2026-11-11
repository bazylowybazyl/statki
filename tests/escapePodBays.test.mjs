// ZATOKI KAPSUŁ RATUNKOWYCH (decyzja użytkownika 2026-11-11: „lampy zatok kapsuł migają przed wyrzutem”): kapsuła
// w kadłubie (PENDING) związana z KOMÓRKĄ kadłuba jedzie z nią (obrót wraku, przejście statek → wrak, rozpad na odłamy
// rodu), impuls wyrzutu obraca się z kadłubem; ramka obrazu niesie zatoki (flaga BAY, wiek = −czas do wyrzutu), obraz
// rysuje samą lampę zatoki z miganiem przyspieszającym do wyrzutu, radar zatok nie pokazuje.
// Gra: src/game/escapePods.js (bindEscapePodBays, env.bayPose), src/game/hullBodies.js (bindCell / boundCell /
// rebindCell), index.html (blok „KAPSUŁY RATUNKOWE”); obraz src/3d/escapePods/escapePods3D.js (podBayBlink).
// W grze: node scripts/webgpu/zatoki-reflektory-gra.mjs
// node --test tests/escapePodBays.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];

const {
  POD_TUNE, POD_STATE, POD_RENDER_FLAG, createEscapePods, launchEscapePods, stepEscapePods, fillEscapePodRenderFrame,
  bindEscapePodBays, removeEscapePod
} = await import('../src/game/escapePods.js');
const { POD_BLOCK, applyEscapePodBlock, createEscapePodBlock, createEscapePodFrame, escapePodBlockSize } =
  await import('../src/render/blocks/escapePodBlock.js');
const { POD_3D_TUNE, createEscapePods3D, podBayBlink } = await import('../src/3d/escapePods/escapePods3D.js');
const { HullBodies } = await import('../src/game/hullBodies.js');
const { allocatedBytes, untilSteady } = await import('./helpers/alokacje.mjs');

const X0 = 5_000_000;
const Y0 = 4_000_000;
const DT = 1 / 60;

/** Kadłub-atrapa: ciało sztywne (x, y, kąt, prędkość, ω); wiązanie = punkt w układzie kadłuba. */
function fakeHull(x = X0, y = Y0, angle = 0.4) {
  const h = { x, y, angle, vx: 80, vy: -30, w: 0.5, alive: true };
  const bindAt = (wx, wy) => {
    const dx = wx - h.x, dy = wy - h.y, c = Math.cos(h.angle), s = Math.sin(h.angle);
    return { lx: dx * c + dy * s, ly: -dx * s + dy * c, a0: h.angle, dead: false };
  };
  const bayPose = (b, out) => {
    if (!h.alive || b.dead) return false;
    const c = Math.cos(h.angle), s = Math.sin(h.angle);
    const dx = b.lx * c - b.ly * s, dy = b.lx * s + b.ly * c;
    out[0] = h.x + dx; out[1] = h.y + dy;
    out[2] = h.vx - h.w * dy; out[3] = h.vy + h.w * dx;
    out[4] = h.angle - b.a0;
    return true;
  };
  const step = (dt) => { h.x += h.vx * dt; h.y += h.vy * dt; h.angle += h.w * dt; };
  return { h, bindAt, bayPose, step };
}

function launchBound(H, extra = {}) {
  const pods = createEscapePods();
  const env = { px: X0, py: Y0, hasPlayer: true, route: () => false, onArrive() {}, bayPose: H.bayPose, ...extra };
  const uid0 = pods.nextUid;
  const n = launchEscapePods(pods, { x: H.h.x, y: H.h.y, vx: H.h.vx, vy: H.h.vy, angle: H.h.angle, length: 1040, width: 330, seed: 42, target: -1 }, env);
  const bound = bindEscapePodBays(pods, uid0, H.bindAt, env);
  return { pods, env, n, bound };
}

test('zatoka jedzie z kadłubem (obrót wraku), impuls wyrzutu obraca się z burtą; utrata zatoki — dalej ostatnim ruchem', () => {
  const H = fakeHull();
  const { pods, env, n, bound } = launchBound(H);
  assert.equal(n, 4);
  assert.equal(bound, 4, 'wszystkie kapsuły w zatokach');
  const local = [];
  for (let i = 0; i < n; i++) {
    const c = Math.cos(H.h.angle), s = Math.sin(H.h.angle);
    const dx = pods.x[i] - H.h.x, dy = pods.y[i] - H.h.y;
    local.push([dx * c + dy * s, -dx * s + dy * c]);
  }
  // impuls w układzie kadłuba (kierunek z burty) przed obrotem
  const ejLocal = [];
  for (let i = 0; i < n; i++) {
    const c = Math.cos(H.h.angle), s = Math.sin(H.h.angle);
    ejLocal.push([pods.ix[i] * c + pods.iy[i] * s, -pods.ix[i] * s + pods.iy[i] * c]);
  }
  // 1 s: wrak obraca się 0,5 rad/s — kapsuły stoją w tych samych miejscach kadłuba
  for (let k = 0; k < 60; k++) { H.step(DT); stepEscapePods(pods, DT, env); }
  for (let i = 0; i < n; i++) {
    assert.equal(pods.state[i], POD_STATE.PENDING);
    const c = Math.cos(H.h.angle), s = Math.sin(H.h.angle);
    const dx = pods.x[i] - H.h.x, dy = pods.y[i] - H.h.y;
    assert.ok(Math.abs(dx * c + dy * s - local[i][0]) < 1e-6 && Math.abs(-dx * s + dy * c - local[i][1]) < 1e-6, `zatoka ${i} na kadłubie`);
    assert.ok(Math.abs(pods.bayTurn[i] - 0.5) < 1e-6, 'obrót kadłuba od wiązania');
  }
  // wyrzut: prędkość = ruch punktu kadłuba + impuls obrócony z kadłubem (na zewnątrz burty)
  const eject = new Array(n).fill(null);
  for (let k = 0; k < 120; k++) {
    const before = [];
    for (let i = 0; i < pods.count; i++) before.push([pods.uid[i], pods.state[i], pods.vx[i], pods.vy[i], pods.x[i], pods.y[i]]);
    H.step(DT);
    stepEscapePods(pods, DT, env);
    for (let i = 0; i < pods.count; i++) {
      const b = before.find((q) => q[0] === pods.uid[i]);
      if (b && b[1] === POD_STATE.PENDING && pods.state[i] !== POD_STATE.PENDING) eject[pods.uid[i] - 1] = { i, angle: H.h.angle, bay: pods.bay[i] };
    }
  }
  for (let u = 0; u < n; u++) {
    const e = eject[u];
    assert.ok(e, `kapsuła ${u} wyrzucona`);
    assert.equal(e.bay, null, 'po wyrzucie bez zatoki');
  }
  for (let i = 0; i < pods.count; i++) {
    // kierunek lotu względem kadłuba w chwili wyrzutu ≈ impuls z burty (w układzie kadłuba bez zmian)
    const c = Math.cos(H.h.angle), s = Math.sin(H.h.angle);
    const dx = pods.x[i] - H.h.x, dy = pods.y[i] - H.h.y;
    const side = -dx * s + dy * c;
    assert.ok(Math.sign(side) === Math.sign(ejLocal[pods.uid[i] - 1][1]), 'wylot na zewnątrz burty mimo obrotu wraku');
  }
  // utrata zatoki (komórka zniszczona): kapsuła jedzie ostatnim ruchem, bez skoku
  const H2 = fakeHull();
  const r2 = launchBound(H2);
  for (let k = 0; k < 10; k++) { H2.step(DT); stepEscapePods(r2.pods, DT, r2.env); }
  const x0 = r2.pods.x[0], vx0 = r2.pods.vx[0];
  r2.pods.bay[0].dead = true;
  stepEscapePods(r2.pods, DT, r2.env);
  assert.equal(r2.pods.bay[0], null, 'zatoka przepadła');
  assert.ok(Math.abs(r2.pods.x[0] - (x0 + vx0 * DT)) < 1e-6, 'ruch liniowy z ostatnią prędkością');
  // usuwanie zamianą z ostatnią przenosi zatokę i zwalnia slot
  const bLast = r2.pods.bay[r2.pods.count - 1];
  removeEscapePod(r2.pods, 1);
  assert.equal(r2.pods.bay[1], bLast);
  assert.equal(r2.pods.bay[r2.pods.count], null);
});

test('ramka obrazu: zatoki (flaga BAY, wiek = −czas do wyrzutu w chwili klatki, miejsce w pozie renderu), kapsuły bez zatoki w kadłubie — nie; blok bit w bit', () => {
  const H = fakeHull();
  const { pods, env } = launchBound(H);
  // kapsuła bez zatoki (statek ruchu bez belek) — w kadłubie niewidoczna
  launchEscapePods(pods, { x: X0 + 5000, y: Y0, length: 200, width: 60, seed: 7, target: -1 }, env);
  for (let k = 0; k < 6; k++) { H.step(DT); stepEscapePods(pods, DT, env); }
  const frame = createEscapePodFrame();
  const lag = 0.004;
  fillEscapePodRenderFrame(pods, frame, lag, null, null, (b, out) => { out[0] = 1; out[1] = 2 + b.lx * 0; return true; });
  assert.equal(frame.count, 4, 'tylko zatoki związane z kadłubem');
  for (let i = 0; i < 4; i++) {
    assert.equal(frame.flags[i], POD_RENDER_FLAG.BAY);
    assert.equal(frame.x[i], 1, 'miejsce zatoki w pozie renderu (bayAt)');
    assert.ok(Math.abs(frame.age[i] + (pods.timer[i] + lag)) < 1e-5, `wiek = −(czas do wyrzutu + lag): ${frame.age[i]}`);
    assert.equal(frame.thrust[i], 0);
  }
  fillEscapePodRenderFrame(pods, frame, lag);
  assert.ok(Math.abs(frame.x[0] - (pods.x[0] - pods.vx[0] * lag)) < 1e-6, 'bez bayAt — poza cofnięta o lag');
  // mgła wojny / maskowanie / soczewka obejmują zatoki
  fillEscapePodRenderFrame(pods, frame, 0, () => false);
  assert.equal(frame.count, 0);
  // blok `pods`: rekord 8 liczb bez zmian, flaga BAY i ujemny wiek przechodzą bit w bit
  assert.equal(POD_RENDER_FLAG.BAY, POD_BLOCK.BAY);
  assert.equal(POD_BLOCK.ITEM.STRIDE, 8);
  fillEscapePodRenderFrame(pods, frame, lag);
  const blk = { f64: new Float64Array(escapePodBlockSize()) };
  createEscapePodBlock().pack(blk, { pods: frame });
  const out = applyEscapePodBlock(blk, createEscapePodFrame());
  for (const k of ['x', 'y', 'ang', 'thrust', 'age', 'seed', 'uid', 'flags']) {
    assert.deepEqual([...out[k].slice(0, out.count)], [...frame[k].slice(0, frame.count)], k);
  }
});

test('lampa zatoki: miganie przyspiesza do wyrzutu (faza z czasu do wyrzutu), obraz rysuje samą lampę bez bryły; radar zatok nie pokazuje', async () => {
  // początki błysków od 3 s przed wyrzutem do wyrzutu: odstępy coraz krótsze (miganie przyspiesza)
  const onsets = [];
  let prev = 0;
  for (let t = 3; t >= 0; t -= 1e-4) {
    const on = podBayBlink(t) > 0 ? 1 : 0;
    if (on && !prev) onsets.push(t);
    prev = on;
  }
  const gaps = onsets.slice(1).map((t, k) => onsets[k] - t);
  assert.ok(gaps.length >= 5, `błysków: ${onsets.length}`);
  for (let k = 1; k < gaps.length; k++) assert.ok(gaps[k] < gaps[k - 1] + 1e-3, `odstępy maleją: ${gaps.map((g) => g.toFixed(3))}`);
  assert.ok(gaps[0] > 0.7 && gaps[0] < 1.6, `z daleka ~1 Hz: ${gaps[0]}`);
  assert.ok(gaps[gaps.length - 1] < 0.15, `tuż przed wyrzutem szybko: ${gaps[gaps.length - 1]}`);
  assert.ok(podBayBlink(-1) === podBayBlink(0), 'po czasie wyrzutu — stan z chwili wyrzutu');
  for (let t = 0; t < 3; t += 0.013) { const v = podBayBlink(t); assert.ok(v >= 0 && v <= 1); }
  // obraz: zatoka = lampa (bez kadłubka), kapsuła w locie = kadłubek + lampa ratunkowa
  const core = { scene: new THREE.Scene(), activeCam1: { x: X0, y: Y0, zoom: 0.3 }, viewZoom: () => 0.3, isFreePerspectiveCamera: () => false };
  const mod = createEscapePods3D(core);
  mod.warm = true;
  const frame = createEscapePodFrame();
  frame.count = 3;
  for (let i = 0; i < 3; i++) { frame.x[i] = X0 + i * 50; frame.y[i] = Y0; frame.uid[i] = i + 1; frame.seed[i] = 3; }
  // tau tuż po początku cyklu błysku (faza 0 → lampa świeci)
  let tauOn = 1.2;
  for (let t = 1.2; t > 0.9; t -= 1e-3) { if (podBayBlink(t) > 0.95) { tauOn = t; break; } }
  frame.flags[0] = POD_BLOCK.BAY; frame.age[0] = -tauOn;
  frame.flags[1] = POD_BLOCK.BAY; frame.age[1] = -tauOn;
  frame.flags[2] = 0; frame.age[2] = 0;   // w dryfie, lampa ratunkowa w błysku (wiek 0, uid 3 → faza 0,39)
  frame.uid[2] = 9;
  mod.update(frame, { x: X0, y: Y0, zoom: 0.3 }, null, 0, 1600, 900);
  assert.equal(mod.stats.bays, 2);
  assert.equal(mod.stats.pods, 1, 'kadłubek tylko kapsuły poza kadłubem');
  const [bodies, lights] = mod.warmupMeshes();
  assert.equal(bodies.geometry.instanceCount, 1);
  assert.equal(mod.stats.lights, 3, 'dwie lampy zatok + lampa kapsuły');
  const d = lights.geometry.getAttribute('iLight').data.array;
  assert.ok(Math.abs(d[2] - POD_3D_TUNE.bayZ) < 1e-6, 'lampa zatoki nad kadłubem (z)');
  // przeplot światła: [x, y, z, promień, R, G, B, kształt]
  const col = [d[4], d[5], d[6]];
  assert.ok(col[0] > 1 && col[1] < col[0] && col[2] < col[1], `bursztyn HDR: ${col[0]}, ${col[1]}, ${col[2]}`);
  // radar: zatoki pominięte
  const src = readFileSync(new URL('../src/ui/radar/radarFeed.js', import.meta.url), 'utf8');
  assert.match(src, /pods\.flags && \(pods\.flags\[i\] & 2\) !== 0\) continue;/);
});

test('HullBodies: komórka związana jedzie z kadłubem (obrót), przez statek → wrak bez skoku, rozpad — odłam rodu; zniszczona — koniec', () => {
  const plate = (w, h) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
    return { width: w, height: h, data };
  };
  window.wrecks.length = 0;
  const e = { x: X0, y: Y0, vx: 40, vy: 0, angle: 0.3, angVel: 0.2, mass: 5000 };
  HullBodies.createHull(e, plate(480, 160));
  try {
    const c = Math.cos(0.3), s = Math.sin(0.3);
    // zatoka na lewej burcie, blisko rufy
    const wx = X0 - 180 * c - 80 * -s * -1, wy = Y0 - 180 * s - 80 * c * -1;
    const bind = HullBodies.bindCell(e, wx, wy, Infinity, {});
    assert.ok(bind && bind.body === e.beamHull.body && bind.key === e.beamHull.dmgKey);
    const p = {};
    assert.equal(HullBodies.boundCell(bind, p), true);
    assert.equal(p.entity, e);
    assert.ok(Math.hypot(p.x - wx, p.y - wy) < e.beamHull.body.cellSize * 1.5, `najbliższy węzeł: ${Math.hypot(p.x - wx, p.y - wy)}`);
    // ruch sztywny: v = v kotwicy + ω × r
    assert.ok(Math.abs(p.vx - (40 - 0.2 * p.dy)) < 1e-9 && Math.abs(p.vy - 0.2 * p.dx) < 1e-9);
    // obrót encji o 0,6 rad: punkt obraca się wokół kotwicy
    const r0 = [p.dx, p.dy];
    e.angle += 0.6;
    HullBodies.boundCell(bind, p);
    const cs = Math.cos(0.6), sn = Math.sin(0.6);
    assert.ok(Math.abs(p.dx - (r0[0] * cs - r0[1] * sn)) < 1e-6 && Math.abs(p.dy - (r0[0] * sn + r0[1] * cs)) < 1e-6, 'zatoka obraca się z kadłubem');
    assert.ok(Math.abs(p.angle - bind.angle0 - 0.6) < 1e-12, 'obrót od wiązania');
    // śmierć: kadłub przechodzi na wrak (to samo ciało) — zatoka w tym samym miejscu świata
    const before = [p.x, p.y];
    const wreck = HullBodies.convertToWreck(e);
    assert.ok(wreck);
    assert.equal(HullBodies.boundCell(bind, p), true, 'wrak niesie komórkę');
    assert.equal(p.entity, wreck);
    assert.ok(Math.hypot(p.x - before[0], p.y - before[1]) < 1e-6, 'bez skoku przy zamianie we wrak');
    assert.ok(Math.abs(p.angle - (before.length ? wreck.angle : 0)) < 1e-12);
    // rozpad: rzaz w poprzek środka → odłam; komórka po stronie odłamu — wiązanie przepięte (ten sam ród)
    window.wrecks.length = 0;
    window.wrecks.push(wreck);
    HullBodies.cutSegment(wreck, wreck.x - 200 * s * 0 + 0, wreck.y - 400, wreck.x, wreck.y + 400, 8);
    for (let k = 0; k < 12 && window.wrecks.length < 2; k++) HullBodies.step(1 / 120, [...window.wrecks]);
    assert.ok(window.wrecks.length >= 2, 'odłam odpadł');
    const ok = HullBodies.boundCell(bind, p) || (HullBodies.rebindCell(bind, window.wrecks) && HullBodies.boundCell(bind, p));
    assert.equal(ok, true, 'komórka w odłamie rodu');
    assert.ok(window.wrecks.includes(p.entity));
    // komórka zniszczona — koniec wiązania (także rebind)
    HullBodies.impact(p.entity, p.x, p.y, 1e9, null, { craterRadius: 60 });
    assert.equal(HullBodies.boundCell(bind, p), false, 'zniszczona komórka');
    assert.equal(HullBodies.rebindCell(bind, window.wrecks), false);
    // kadłub bez belek / bryła — bez wiązania
    assert.equal(HullBodies.bindCell({ x: 0, y: 0 }, 0, 0), null);
  } finally {
    for (const w of window.wrecks) HullBodies.release(w);
    window.wrecks.length = 0;
    HullBodies.release(e);
  }
});

test('krok zatok bez alokacji (pozy z kadłuba co krok)', async () => {
  const H = fakeHull();
  H.h.w = 0.05;
  const pods = createEscapePods();
  const env = { px: X0, py: Y0, hasPlayer: true, route: () => false, onArrive() {}, bayPose: H.bayPose };
  for (let s = 0; s < 20; s++) {
    const uid0 = pods.nextUid;
    launchEscapePods(pods, { x: X0, y: Y0 + s * 300, angle: 0, length: 3000, width: 600, seed: s, target: -1, delay: 1e6 }, env);
    bindEscapePodBays(pods, uid0, H.bindAt, env);
  }
  assert.ok(pods.count >= 160);
  const step = () => { H.step(DT); stepEscapePods(pods, DT, env); };
  for (let k = 0; k < 200; k++) step();
  const best = await untilSteady(() => allocatedBytes(step, 2000), (b) => b < 4096, { warm: () => { for (let k = 0; k < 200; k++) step(); } });
  assert.ok(best < 4096, `krok alokuje ${best} B / 2000 kroków`);
});

test('wpięcie w grze: wiązanie przy wyrzucie z kadłuba na belkach, poza zatoki z HullBodies (z odłamami z listy wraków), ramka w pozie renderu po renderPoses', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /bindEscapePodBays\(escapePods, uid0, \(bx, by\) => HullBodies\.bindCell\(e, bx, by, Infinity, \{\}\), _podEnv\)/);
  assert.match(src, /HullBodies\.boundCell\(bind, c\) && !\(HullBodies\.rebindCell\(bind, wrecks\) && HullBodies\.boundCell\(bind, c\)\)/);
  assert.match(src, /bayPose: \(bind, out\) => podBayPose\(bind, out\)/);
  assert.match(src, /_podVisible, _lensDotsActive \? _podLensHidden : null, podBayRenderAt\)/);
  assert.ok(src.indexOf('renderPoses.frame(renderEntities') < src.indexOf('      escapePodRenderFrame(alpha);'), 'ramka kapsuł po pozach renderu');
  assert.ok(POD_TUNE.delayMin >= 1, 'zatoka miga co najmniej sekundę');
});
