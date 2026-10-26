// Mapa C soczewki świata — matematyka (DECYZJE M1–M6, P1–P4, T1–T2, 2026-10-25): ciągłość β → 0 (dokładnie prawdziwy
// obraz), namiar prawdziwy, odstęp q·(d − r) > 0, monotoniczność, odwrotność dla HUD, cel → podgląd kadru przylotu
// (ta sama funkcja co kamera), front wyjścia, stożek za celem, kieszeń kadłuba, kropki, kotwica, brak NaN; oś β
// (src/render/warpLensPhase.js) i kadr przylotu (src/render/warpArrivalFrame.js).
// node --test tests/warpLensMapC.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORLD_LENS_DEFAULTS, WORLD_LENS_MODE, warpLensFrame, newWarpLensFrame, warpLensQ, warpLensInverse, mapWorldLens,
  WarpWorldLens, newLensBody, softMaxLog, softMaxCompact, viewEdgeDistance, lensDiscInFrame, lensImageToWorld
} from '../src/3d/warp/worldLens.js';
import { WARP_ARRIVAL_FRAME, warpViewEdgePx, warpArrivalZoom, warpArrivalSoftMin } from '../src/render/warpArrivalFrame.js';
import {
  WARP_LENS_PHASE, warpLensBeta, warpLensKickBeta, warpLensChargeBeta, warpExitFrontS, warpBodySubmerge, warpLensHudBeta,
  warpLensExitLive
} from '../src/render/warpLensPhase.js';
import { createCameraRig, stepCameraRigWarp, CAMERA_RIG_DEFAULTS } from '../src/game/cameraRig.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
// Kadr 1920 × 1080, kurs w górę, kotwica 189 px pod środkiem (krawędzie 729 / 351 / 960 px).
const frame = (p0x = 0, p0y = 189, params = WORLD_LENS_DEFAULTS, cu = 0, cv = -1) => warpLensFrame(cu, cv, 960, 540, p0x, p0y, params, newWarpLensFrame());
// Deterministyczne „losowe” ciała (bez Math.random w testach powtarzalnych).
function* bodiesGrid() {
  for (let i = 0; i < 400; i++) {
    const ang = i * 2.399963;              // złoty kąt
    const d = 2000 * Math.pow(1.03, i % 230) + 500 * (i % 7);
    const r = Math.min(d * 0.95, 1000 + (i * 7919) % 60000);
    yield { dx: Math.cos(ang) * d, dy: Math.sin(ang) * d, r };
  }
}

test('mapa C: β = 0 daje DOKŁADNIE prawdziwą skalę, β → 0 zbiega (< 1e-6 px); namiar prawdziwy i odstęp q·(d − r) > 0 przy każdym β', () => {
  const F = frame();
  const q = {};
  for (const b of bodiesGrid()) {
    const flat = 0.1173;
    warpLensQ(b.dx, b.dy, 0, flat, F, q);
    assert.equal(q.q, flat, 'β = 0 — skala prawdziwego widoku bez błędu');
    warpLensQ(b.dx, b.dy, 1e-13, flat, F, q);
    const d = Math.hypot(b.dx, b.dy);
    assert.ok(Math.abs(q.q - flat) * (d + b.r) < 1e-6, `β → 0: ${(Math.abs(q.q - flat) * d).toExponential(2)} px`);
    for (const beta of [0.1, 0.5, 0.9, 1]) {
      const m = mapWorldLens(b.dx, b.dy, b.r, { zoom: flat, flatScale: flat, beta, velAngle: -Math.PI / 2, viewHalfW: 960, viewHalfH: 540, shipSx: 0, shipSy: 189 }, {});
      assert.ok(near(Math.atan2(m.y, m.x), Math.atan2(b.dy, b.dx), 1e-12), 'namiar prawdziwy');
      if (d > b.r) assert.ok(m.gap > 0, `odstęp brzegu > 0 (β ${beta}, d ${d.toFixed(0)}, r ${b.r.toFixed(0)})`);
    }
  }
});

test('mapa C: q_β monotoniczne w β (rodzina bez przestrzału), obraz na promieniu oddala się z odległością, ciało rośnie przy zbliżaniu', () => {
  const F = frame();
  const q = {};
  for (const b of bodiesGrid()) {
    let prev = Infinity;
    for (let i = 0; i <= 50; i++) {
      warpLensQ(b.dx, b.dy, i / 50, 0.1173, F, q);
      assert.ok(q.q <= prev * (1 + 1e-12), 'q_β maleje z β (prawdziwy widok > soczewka)');
      prev = q.q;
    }
  }
  // Promień od kotwicy rośnie monotonicznie z odległością na każdym kierunku (odwrotność istnieje).
  for (let k = 0; k < 36; k++) {
    const ang = (k / 36) * 2 * Math.PI + 0.01;
    let prevRho = 0;
    for (let d = 100; d < 2e7; d *= 1.3) {
      warpLensQ(Math.cos(ang) * d, Math.sin(ang) * d, 1, 0.1173, F, q);
      const rho = q.q * d;
      assert.ok(rho > prevRho, `ρ(d) rośnie (kąt ${k * 10}°)`);
      prevRho = rho;
    }
  }
  // Przelot (stałe l): wielkość rośnie do trawersu, potem maleje — dla bliskich i dalekich przelotów.
  for (const l of [40000, 75000, 300000, 2e6]) {
    let prev = 0;
    for (let a = 3e6; a >= -3e6; a -= 25000) {
      warpLensQ(l, -a, 1, 0.1173, F, q);
      const s = q.q * 30000;
      if (a >= 0) assert.ok(s >= prev - 1e-12, `rośnie (l ${l}, a ${a})`);
      else assert.ok(s <= prev + 1e-12, `maleje (l ${l}, a ${a})`);
      prev = s;
    }
  }
});

test('odwrotność mapy C (HUD): piksel → świat → piksel, błąd < 1e-9 (względny); punkt poza rombem horyzontu — brak obrazu', () => {
  const F = frame(0, 189);
  const q = {};
  const inv = {};
  let worst = 0;
  for (const b of bodiesGrid()) {
    warpLensQ(b.dx, b.dy, 1, 0.1173, F, q);
    warpLensInverse(q.q * b.dx, q.q * b.dy, F, inv);
    assert.ok(inv.ok, 'punkt obrazu ma przeciwobraz');
    const e = Math.hypot(inv.dx - b.dx, inv.dy - b.dy) / Math.hypot(b.dx, b.dy);
    worst = Math.max(worst, e);
  }
  assert.ok(worst < 1e-9, `błąd odwrotności ${worst.toExponential(2)}`);
  // Też z innym ε (równanie kwadratowe) i kursem po skosie.
  const F2 = warpLensFrame(Math.cos(0.7), Math.sin(0.7), 960, 540, 0, 0, { ...WORLD_LENS_DEFAULTS, eps: 0.3 }, newWarpLensFrame());
  for (const b of bodiesGrid()) {
    warpLensQ(b.dx, b.dy, 1, 0.1173, F2, q);
    warpLensInverse(q.q * b.dx, q.q * b.dy, F2, inv);
    assert.ok(inv.ok && Math.hypot(inv.dx - b.dx, inv.dy - b.dy) / Math.hypot(b.dx, b.dy) < 1e-9);
  }
  // Daleko za horyzontem przed dziobem (ρ > E_f na kursie) — nie jest obrazem żadnego punktu.
  warpLensInverse(0, -(WORLD_LENS_DEFAULTS.hf * 729 + 5), F, inv);
  assert.equal(inv.ok, false);
});

test('kadr przylotu: jedna funkcja dla kamery i soczewki — zoom kadru przylotu kamery (stepCameraRigWarp) zbiega do warpArrivalZoom', () => {
  assert.equal(WARP_ARRIVAL_FRAME.fill, CAMERA_RIG_DEFAULTS.warpArrivalFill, 'ten sam ułamek kadru');
  assert.equal(warpViewEdgePx(0, -1, 960, 540, 0, 189), viewEdgeDistance(0, -1, 960, 540, 0, 189));
  assert.equal(warpArrivalZoom(729, 20000), Math.max(1, 729) * 0.75 / 20000);
  assert.equal(warpArrivalZoom(0, 0), 0.75, 'granice (brzeg i odległość ≥ 1)');
  assert.equal(warpArrivalZoom(1e9, 1), WARP_ARRIVAL_FRAME.zoomMax);
  assert.ok(near(warpArrivalSoftMin(0.3), 0.5 * (0.3 - Math.sqrt(0.09 + 0.01)), 1e-15));
  // Kamera: skok, potem wyjście z celem 20 tys. j. przed brzegiem — log zoomu kadru przylotu dąży do ln z_v.
  const rig = createCameraRig();
  const zoomRef = 0.2133;
  const base = { dt: 1 / 60, enabled: true, dirX: 0, dirY: -1, rulon: false, zoomRef, zoomBase: zoomRef, viewW: 1920, viewH: 1080 };
  for (let i = 0; i < 120; i++) stepCameraRigWarp(rig, { ...base, state: 'active', charge: 1, exitAge: -1, arrivalDist: -1 });
  const dist = 20000;
  for (let i = 0; i < 600; i++) {
    stepCameraRigWarp(rig, { ...base, state: 'idle', exitAge: i / 60, exitSlow: 0.7, exitHalt: 1.33, arriving: true, arrivalDist: dist });
  }
  const edge = warpViewEdgePx(rig.warpDirX, rig.warpDirY, 960, 540, -rig.offsetX, -rig.offsetY);
  assert.ok(rig.warpArrOn, 'kadr przylotu włączony');
  assert.ok(near(rig.warpArrLog, Math.log(warpArrivalZoom(edge, dist)), 1e-6), `kamera: ${Math.exp(rig.warpArrLog)} vs ${warpArrivalZoom(edge, dist)}`);
  // Miękkie minimum z kadrem skoku: rig (ARRIVAL_SOFT) = warpArrivalSoftMin(…, WARP_ARRIVAL_FRAME.soft) — ta sama stała
  // (po 10 s impulsy wygasły, warpHold = 1, waga ujednolicenia 1: warpZoomLog = człon kadru przylotu).
  assert.ok(near(rig.warpZoomLog, warpArrivalSoftMin(rig.warpArrLog - Math.log(zoomRef), WARP_ARRIVAL_FRAME.soft), 1e-12), 'ta sama miękkość co kamera');
});

test('cel (T1): q_T = miękkie maksimum (mapa, z_v); z bliska → z_v, z daleka ≈ mapa; bliski brzeg zawsze ≥ fill · krawędź', () => {
  const lens = new WarpWorldLens();
  const ctx = { beta: 1, velAngle: -Math.PI / 2, zoom: 0.1173, W: 1920, H: 1080, shipSx: 0, shipSy: 189, anchorSx: 0, anchorSy: 189, hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1 };
  const tgt = newLensBody('cel', 'planet');
  Object.assign(tgt, { x: 0, y: 0, r: 30000, flat: 0.1173, ready: true });
  const F = frame();
  const qm = {};
  for (const gap of [5e6, 2e6, 5e5, 1e5, 2e4, 5000, 500]) {
    tgt.y = -(gap + tgt.r);
    lens.update([tgt], 1, ctx, tgt);
    const zv = warpArrivalZoom(729, gap);
    const qT = tgt.out.q;
    warpLensQ(0, tgt.y, 1, 0.1173, F, qm);
    // (z bliska — poniżej ~2 · elipsa kadłuba / odstęp — dochodzi kieszeń kadłuba; wzór sprawdzamy, gdzie jej nie ma)
    if (gap >= 2e4) assert.ok(near(qT, softMaxLog(qm.q, zv, WORLD_LENS_DEFAULTS.targetSoft), 1e-12 * qT), 'wzór q_T');
    assert.ok(qT * gap >= 0.75 * 729 * (1 - 1e-12), `bliski brzeg ${(qT * gap).toFixed(1)} px`);
    if (gap <= 2e4) assert.ok(qT / zv - 1 < 0.01, `z bliska → z_v (${(qT / zv).toFixed(4)})`);
    if (gap >= 2e6) assert.ok(qT / qm.q < 1.1, 'z daleka ≈ mapa (kropka przy punkcie zbiegu)');
  }
});

test('brak NaN: d → 0, ciało zawierające statek, cel pod statkiem, skrajne zoomy, mały kadr, kotwica poza kadrem, skrajne B', () => {
  const cases = [];
  for (const zoom of [1e-6, 0.0149, 0.1173, 3.2, 100]) {
    for (const [W, H] of [[1920, 1080], [2, 2], [1, 1]]) {
      for (const [ax, ay] of [[NaN, NaN], [0, 189], [5000, -9000]]) cases.push({ zoom, W, H, ax, ay });
    }
  }
  for (const B of [1, 45000, 1e9]) {
    for (const c of cases) {
      const lens = new WarpWorldLens({ B });
      const mk = (id, x, y, r, extra = {}) => Object.assign(newLensBody(id, 'planet'), { x, y, r, flat: c.zoom, ready: true }, extra);
      const tgt = mk('cel', 0, 0, 48000);             // statek wewnątrz celu
      const zero = mk('zero', 0, 0, 0);               // d = 0, r = 0
      const inside = mk('wnętrze', 100, 0, 5000);     // r > d
      const far = mk('daleko', 3e6, -2e6, 2000, { rExt: 9000 });
      const moon = mk('ksiezyc', 50, 0, 10, { parent: tgt });
      const bg = mk('tlo', -4e5, 1e5, 16650, { z: -50000, flat: c.zoom * 0.2 });
      const list = [tgt, zero, inside, far, moon, bg];
      for (const beta of [0, 1e-9, 0.5, 1]) {
        for (const exitAge of [-1, 0.2, 2]) {
          const ctx = { beta, velAngle: 1.1, zoom: c.zoom, W: c.W, H: c.H, roll: 0.3, shipX: 0, shipY: 0, shipSx: 0, shipSy: 0,
            anchorSx: c.ax, anchorSy: c.ay, hullHalfLen: 0, hullHalfWid: 0, dt: 1 / 60, exitAge, exitHalt: 1.33, exitSlow: 0.7 };
          lens.update(list, list.length, ctx, tgt);
          for (const b of list) {
            const o = b.out;
            assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.size) && o.size >= 0 && Number.isFinite(o.beta),
              `${b.id}: ${o.x}, ${o.y}, ${o.size} (zoom ${c.zoom}, ${c.W}×${c.H}, B ${B}, β ${beta}, wyjście ${exitAge})`);
          }
          assert.ok(Number.isFinite(ctx.targetHold));
        }
      }
    }
  }
  // Czyste funkcje
  const F = warpLensFrame(0, -1, 0, 0, 0, 0, WORLD_LENS_DEFAULTS, newWarpLensFrame());
  const q = warpLensQ(0, 0, 0.5, 0, F, {});
  assert.ok(Number.isFinite(q.q) && q.q > 0);
  assert.ok(Number.isFinite(softMaxCompact(0, 0.5, 0.1)) && softMaxCompact(2, 1, 0.1) === 2 && softMaxCompact(1, 2, 0.1) === 2);
});

test('kotwica P0 (M3): przy β = 1 obraz nie zależy od chwilowego miejsca statku (kop, wysunięcie); przy β = 0 — prawdziwy; tło × (flat / zoom)^(1−β)', () => {
  const lens = new WarpWorldLens();
  const mars = Object.assign(newLensBody('mars', 'planet'), { x: -75000, y: -300000, r: 30000, flat: 0.1173, ready: true });
  const sat = Object.assign(newLensBody('saturn', 'planet'), { x: 400000, y: -900000, r: 16650, z: -50000, flat: 0.026, ready: true });
  const list = [mars, sat];
  const ctx = { beta: 1, velAngle: -Math.PI / 2, zoom: 0.1173, W: 1920, H: 1080, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189, anchorSx: 0, anchorSy: 189, hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1 };
  lens.update(list, 2, ctx, null);
  const a = { mx: mars.out.x, my: mars.out.y, sx: sat.out.x, sy: sat.out.y };
  ctx.shipSy = 189 - 96;   // kop: statek wyrywa się 96 px w górę, kotwica stoi
  lens.update(list, 2, ctx, null);
  assert.ok(near(mars.out.x, a.mx, 1e-9) && near(mars.out.y, a.my, 1e-9) && near(sat.out.y, a.sy, 1e-9), 'świat soczewki stoi jak gwiazdy');
  // β = 0: prawdziwy rzut — płaszczyzna gry od statku, tło z perspektywy kamery (statek × flat / zoom).
  lens.reset();
  ctx.beta = 0;
  lens.update(list, 2, ctx, null);
  assert.ok(near(mars.out.x, mars.x * mars.flat, 1e-9) && near(mars.out.y, ctx.shipSy + mars.y * mars.flat, 1e-9));
  assert.ok(near(sat.out.y, ctx.shipSy * (sat.flat / ctx.zoom) + sat.y * sat.flat, 1e-9), 'tło: kotwica × flat / zoom');
  // Bez kotwicy w ctx — kotwica = statek.
  delete ctx.anchorSx;
  delete ctx.anchorSy;
  ctx.beta = 1;
  lens.update(list, 2, ctx, null);
  const m = mapWorldLens(mars.x, mars.y, mars.r, { zoom: 0.1173, beta: 1, velAngle: -Math.PI / 2, viewHalfW: 960, viewHalfH: 540, shipSx: 0, shipSy: ctx.shipSy }, {});
  assert.ok(near(mars.out.x, m.x, 1e-6) && near(mars.out.y, ctx.shipSy + m.y, 1e-6));
});

test('kieszeń kadłuba: bliski przelot nie zachodzi na kadłub (z ringiem); zwykły przelot — mapa bez zmian', () => {
  const lens = new WarpWorldLens();
  const ctx = { beta: 1, velAngle: -Math.PI / 2, zoom: 0.1173, W: 1920, H: 1080, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189, anchorSx: 0, anchorSy: 189, hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1 };
  const close = Object.assign(newLensBody('blisko', 'planet'), { x: 48000, y: 0, r: 37800, rExt: 46250, flat: 0.1173, ready: true });
  const usual = Object.assign(newLensBody('zwykle', 'planet'), { x: -75000, y: -200000, r: 30000, flat: 0.1173, ready: true });
  lens.update([close, usual], 2, ctx, null);
  const o = close.out;
  const gap = Math.hypot(o.x, o.y - 189) - o.size * (46250 / 37800);
  assert.ok(gap >= 47 + WORLD_LENS_DEFAULTS.edgeGap - 1e-6, `ring od kadłuba ${gap.toFixed(1)} px`);
  const m = mapWorldLens(usual.x, usual.y, usual.r, { zoom: 0.1173, beta: 1, velAngle: -Math.PI / 2, viewHalfW: 960, viewHalfH: 540, shipSx: 0, shipSy: 189 }, {});
  assert.ok(near(usual.out.size, m.size, 1e-9), 'zwykły przelot — dokładnie mapa');
});

test('kropki i słońce (M5): planeta i słońce nie mniejsze niż minDot, słońce × sunBoost; obraz < minPx gaśnie; stożek za celem (M4) zanurza ciała ±30°', () => {
  const lens = new WarpWorldLens();
  const ctx = { beta: 1, velAngle: -Math.PI / 2, zoom: 0.1173, W: 1920, H: 1080, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189, anchorSx: 0, anchorSy: 189, hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1 };
  const P = WORLD_LENS_DEFAULTS;
  const neptune = Object.assign(newLensBody('neptun', 'planet'), { x: 6e6, y: 3e6, r: 9000, flat: 0.02, z: -50000, ready: true });
  const sun = Object.assign(newLensBody('sun', 'sun'), { x: 1.5e6, y: 0, r: 2394, flat: 0.02, z: -60000, ready: true });
  const rock = Object.assign(newLensBody('skala', 'small'), { x: 9e6, y: -9e6, r: 400, flat: 0.1173, ready: true });
  lens.update([neptune, sun, rock], 3, ctx, null);
  assert.ok(neptune.out.size >= P.minDot - 1e-12, `kropka planety ${neptune.out.size}`);
  const F = frame();
  const q = {};
  warpLensQ(sun.x, sun.y, 1, sun.flat, F, q);
  assert.ok(near(sun.out.size, Math.max(q.q * sun.r * P.sunBoost, P.minDot), 1e-9), 'słońce × sunBoost');
  assert.ok(rock.out.size < 1e-3, 'mała skała poniżej progu gaśnie');
  // Stożek: cel 1 mln przed dziobem; ciało 2 mln w stożku (10°) — zanurzone; ciało 2 mln pod 40° — widoczne.
  const tgt = Object.assign(newLensBody('cel', 'planet'), { x: 0, y: -1e6, r: 48000, flat: 0.1173, ready: true });
  const inCone = Object.assign(newLensBody('w-stozku', 'planet'), { x: Math.sin(0.17) * 2e6, y: -Math.cos(0.17) * 2e6, r: 16650, flat: 0.02, ready: true });
  const outCone = Object.assign(newLensBody('poza', 'planet'), { x: Math.sin(0.7) * 2e6, y: -Math.cos(0.7) * 2e6, r: 16650, flat: 0.02, ready: true });
  lens.reset();
  lens.update([tgt, inCone, outCone], 3, ctx, tgt);
  assert.ok(inCone.out.size < 1e-6, `w stożku za celem — zanurzone (${inCone.out.size})`);
  assert.ok(outCone.out.size >= P.minDot, 'poza stożkiem — widoczne');
  // Płynnie z kątem: na brzegu stożka (28,5°) — między.
  const edgeA = (P.coneDeg - P.coneSoftDeg / 2) * Math.PI / 180;
  const half = Object.assign(newLensBody('brzeg', 'planet'), { x: Math.sin(edgeA) * 2e6, y: -Math.cos(edgeA) * 2e6, r: 16650, flat: 0.02, ready: true });
  lens.reset();   // nowy skok (ciało nowe w trakcie skoku wynurzałoby się w lateTime s)
  lens.update([tgt, half], 2, ctx, tgt);
  warpLensQ(half.x, half.y, 1, half.flat, F, q);
  const halfFull = Math.max(q.q * half.r, P.minDot);
  assert.ok(half.out.size > 0.2 * halfFull && half.out.size < 0.8 * halfFull, `brzeg stożka: ${half.out.size.toFixed(2)} z ${halfFull.toFixed(2)} px`);
});

test('wyjście (P3): ciała spoza celu zanurzają się frontem smug gwiazd od dziobu ku rufie, każde w `submerge` s; cel trzymany', () => {
  const lens = new WarpWorldLens();
  const ctx = { beta: 1, velAngle: -Math.PI / 2, zoom: 0.1173, W: 1920, H: 1080, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189, anchorSx: 0, anchorSy: 189, hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1, exitSlow: 0.7, exitHalt: 1.33 };
  const ahead = Object.assign(newLensBody('przod', 'planet'), { x: 800000, y: -1.2e6, r: 30000, flat: 0.1173, ready: true });
  const abeam = Object.assign(newLensBody('bok', 'planet'), { x: -90000, y: 0, r: 30000, flat: 0.1173, ready: true });
  const behind = Object.assign(newLensBody('tyl', 'planet'), { x: 40000, y: 150000, r: 30000, flat: 0.1173, ready: true });
  const tgt = Object.assign(newLensBody('cel', 'planet'), { x: 0, y: -400000, r: 48000, flat: 0.1173, ready: true });
  const list = [tgt, ahead, abeam, behind];
  lens.update(list, 4, ctx, tgt);
  const full = Object.fromEntries(list.map((b) => [b.id, b.out.size]));
  ctx.exitAge = 0;
  const firstSub = {};
  let prev = null;
  for (let i = 0; i < 80; i++) {
    lens.update(list, 4, ctx, tgt);
    for (const b of [ahead, abeam, behind]) {
      if (!(b.id in firstSub) && b.out.beta < 1) firstSub[b.id] = ctx.exitAge;
      assert.equal(b.entry, WORLD_LENS_MODE.FAR, 'dalekie — zanurzenie w miejscu');
      const inF = lensDiscInFrame(b.out.x, b.out.y, b.out.size, 1920, 1080);
      if (prev && prev[b.id].inF && inF) assert.ok(Math.abs(b.out.size - prev[b.id].size) < 50, 'bez skoku promienia w kadrze');
    }
    assert.equal(ctx.targetHold, 1, 'cel trzymany w zwolnieniu');
    prev = Object.fromEntries(list.map((b) => [b.id, { size: b.out.size, inF: lensDiscInFrame(b.out.x, b.out.y, b.out.size, 1920, 1080) }]));
    ctx.exitAge += ctx.dt;
  }
  assert.ok(firstSub.przod < firstSub.bok && firstSub.bok < firstSub.tyl, `od dziobu ku rufie: ${JSON.stringify(firstSub)}`);
  assert.ok(firstSub.tyl <= 0.7 + 1e-9, 'front przechodzi w czasie ramp.slow');
  for (const b of [ahead, abeam, behind]) assert.ok(near(b.out.size, b.r * b.flat, 1e-9) && b.out.beta === 0, `${b.id}: po zanurzeniu — prawdziwy obraz`);
  assert.ok(full.przod > 0 && tgt.out.size > 0);
});

test('oś β (src/render/warpLensPhase.js, P1): ładowanie 0,9 · smoothstep, kop 0,9 → 1 easeOut³ (ciągle), lot 1, wyjście do frontu + zanurzenia; HUD gaśnie z β i wraca frontem', () => {
  const P = WARP_LENS_PHASE;
  let prev = -1;
  for (let i = 0; i <= 100; i++) {
    const b = warpLensBeta({ state: 'charging', charge: i / 100 });
    assert.ok(b >= prev - 1e-15 && b <= P.chargeBeta + 1e-15, 'ładowanie rośnie do 0,9');
    prev = b;
  }
  assert.ok(near(warpLensChargeBeta(1), P.chargeBeta, 1e-15) && near(warpLensKickBeta(0), P.chargeBeta, 1e-15), 'kop zaczyna się tam, gdzie kończy ładowanie');
  let maxStep = 0;
  for (let t = 0; t < 0.6; t += 1 / 60) {
    const b0 = warpLensBeta({ state: 'active', kickAge: t });
    const b1 = warpLensBeta({ state: 'active', kickAge: t + 1 / 60 });
    assert.ok(b1 >= b0 - 1e-15);
    maxStep = Math.max(maxStep, b1 - b0);
  }
  assert.ok(maxStep < 0.012, `kop łagodny (max Δβ ${maxStep.toFixed(4)}/klatkę)`);
  assert.equal(warpLensBeta({ state: 'active', kickAge: P.kickTime }), 1);
  assert.equal(warpLensBeta({ state: 'active' }), 1, 'brak wieku kopu — lot');
  assert.equal(warpLensBeta({ state: 'idle', exitAge: 0.2, exitSlow: 0.7 }), 1, 'wyjście — soczewka żyje do końca frontu');
  assert.equal(warpLensBeta({ state: 'idle', exitAge: 0.7 + P.submerge + 0.01, exitSlow: 0.7 }), 0);
  assert.equal(warpLensBeta({ state: 'idle', exitAge: -1 }), 0);
  assert.equal(warpLensBeta({ state: 'active', kickAge: 3, hyper: true }), 0, 'hipercruise bez soczewki');
  assert.equal(warpLensExitLive(0.5, NaN), true, 'domyślne ramp.slow');
  // Front smug gwiazd: 18 000 → −18 000 j. w ramp.slow, monotonicznie.
  assert.equal(warpExitFrontS(0, 0.7), P.frontFrom);
  assert.equal(warpExitFrontS(0.7, 0.7), P.frontTo);
  for (let t = 0; t < 0.7; t += 0.01) assert.ok(warpExitFrontS(t + 0.01, 0.7) <= warpExitFrontS(t, 0.7));
  assert.equal(warpBodySubmerge(-1, 0.4), 1);
  assert.equal(warpBodySubmerge(0.2, 0.2 + P.submerge), 0);
  // HUD: znaczniki świata gasną z β; w wyjściu wracają, gdy minie je front (dziób wcześniej niż rufa).
  assert.equal(warpLensHudBeta({ state: 'active', kickAge: 2 }), 1);
  assert.equal(warpLensHudBeta({ state: 'idle', exitAge: -1 }), 0);
  const zoom = 0.1173;
  const tBack = (along) => { for (let t = 0; t <= 0.7; t += 0.005) if (warpLensHudBeta({ state: 'idle', exitAge: t, exitSlow: 0.7 }, along, zoom) < 0.5) return t; return 1; };
  assert.ok(tBack(600) < tBack(0) && tBack(0) < tBack(-300), 'znacznik przed dziobem wraca pierwszy');
  assert.equal(warpLensHudBeta({ state: 'idle', exitAge: 0.71, exitSlow: 0.7 }, 0, zoom), 0);
  let hp = 2;
  for (let t = 0; t < 1.2; t += 0.05) {
    const h = warpLensHudBeta({ state: 'idle', exitAge: t, exitSlow: 0.7 });
    assert.ok(h <= hp + 1e-12);
    hp = h;
  }
});

test('planeta tła przy β → 0 (etap integracji, planet3d.assets.js): obraz zbiega do prawdziwego bez odskoku — także z kotwicą ≠ statek; rozstawienie w świecie = prawdziwe miejsce', () => {
  const lens = new WarpWorldLens();
  // Saturn na tle (z = −50 000) w prawdziwym kadrze: kamera zoom 0,1173, ogniskowa 1080 / 2 / tan(17,5°)
  const zoom = 0.1173;
  const focal = 540 / Math.tan(17.5 * Math.PI / 180);
  const camZ = focal / zoom;
  const flat = focal / (camZ + 50000);
  const sat = Object.assign(newLensBody('saturn', 'planet'), { x: 3000, y: -40000, r: 16650, z: -50000, flat, ready: true });
  const ctx = { beta: 0, velAngle: -Math.PI / 2, zoom, W: 1920, H: 1080, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189,
    anchorSx: 0, anchorSy: 93, hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1, focal, camZ };
  const outAt = (beta) => { ctx.beta = beta; lens.update([sat], 1, ctx, null); return { x: sat.out.x, y: sat.out.y, s: sat.out.size }; };
  const real = outAt(0);
  assert.equal(sat.entry, WORLD_LENS_MODE.MOVE, 'prawdziwy obraz w kadrze — ruch');
  // planet3d.assets.js (_lensPlace, tło): świat = kamera + o · (camZ − z) / focal; przy β = 0 — prawdziwe miejsce ciała
  const k = (camZ - sat.z) / focal;
  const camX = 0 - ctx.shipSx / zoom;
  const camY = 0 - ctx.shipSy / zoom;
  assert.ok(near(camX + real.x * k, sat.x, 1e-6) && near(camY + real.y * k, sat.y, 1e-6), 'β = 0 — prawdziwe miejsce w świecie');
  let prev = real;
  for (const beta of [0.001, 0.01, 0.05, 0.1]) {
    const o = outAt(beta);
    const dPos = Math.hypot(o.x - real.x, o.y - real.y);
    assert.ok(dPos < 2000 * beta + 1e-6, `β ${beta}: przesunięcie ${dPos.toFixed(3)} px (ciągłe w β)`);
    assert.ok(Math.abs(o.s - real.s) < 2000 * beta + 1e-6, `β ${beta}: promień ciągły`);
    prev = o;
  }
  assert.ok(prev);
});

// Kadr gry 1080p: kamera zoom 0,1173, perspektywa passa tła (ogniskowa z FOV 35°), statek 189 px pod środkiem.
function lensScene1080() {
  const zoom = 0.1173;
  const focal = 540 / Math.tan(17.5 * Math.PI / 180);
  const camZ = focal / zoom;
  const mk = (id, kind, x, y, r, z) => Object.assign(newLensBody(id, kind), { x, y, r, z, flat: z ? focal / (camZ - z) : zoom, ready: true });
  const bodies = [
    mk('saturn', 'planet', 3000, -40000, 16650, -50000),      // tło, prawdziwy obraz w kadrze — ruch
    mk('saturnFar', 'planet', 400000, -900000, 16650, -50000), // tło daleko — wynurzenie
    mk('mars', 'planet', 120000, -300000, 9000, 0),            // płaszczyzna gry daleko — wynurzenie
    mk('luna', 'moon', -6000, 4000, 1700, 0),                  // księżyc przy statku — ruch
    Object.assign(mk('sun', 'sun', -2e6, 3e6, 60000, -60000), { sizeBoost: 5, minDot: 2 })
  ];
  const ctx = { beta: 0, velAngle: -Math.PI / 2, zoom, W: 1920, H: 1080, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189,
    anchorSx: 0, anchorSy: 93, hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1, focal, camZ, zoomJump: zoom * 0.55 };
  return { bodies, ctx, zoom, focal, camZ };
}

// Największy krok obrazu (środek, promień) między kolejnymi próbkami β — tylko ciała widoczne w obu próbkach.
function lensBetaSteps(betas) {
  const { bodies, ctx } = lensScene1080();
  const lens = new WarpWorldLens();
  const vis = (q) => q.s > 0.5 && Math.abs(q.x) < 960 + q.s && Math.abs(q.y) < 540 + q.s;
  const prev = bodies.map(() => null);
  const worst = bodies.map((b) => ({ id: b.id, d: 0, r: 0, beta: 0 }));
  for (const beta of betas) {
    ctx.beta = beta;
    lens.update(bodies, bodies.length, ctx, null);
    bodies.forEach((b, i) => {
      const o = { x: b.out.x, y: b.out.y, s: b.out.size };
      const p = prev[i];
      if (p && vis(o) && vis(p)) {
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d > worst[i].d) { worst[i].d = d; worst[i].beta = beta; }
        worst[i].r = Math.max(worst[i].r, Math.abs(o.s - p.s));
      }
      prev[i] = o;
    });
  }
  return worst;
}

test('oś β gęsto (recenzja etapu 2): obraz ciał ciągły w β — krok ograniczony na całym przedziale, nie tylko przy β → 0; profil ładowania + kopu 60 Hz w progach P4', () => {
  // gęsto: Δβ = 0,005 — krok ≤ 2200 px na jednostkę β (= 60 px przy najszybszym ładowaniu 0,028 β / klatkę)
  const dense = [];
  for (let i = 0; i <= 200; i++) dense.push(i / 200);
  for (const w of lensBetaSteps(dense)) {
    assert.ok(w.d <= 2200 * 0.005, `${w.id}: krok ${w.d.toFixed(2)} px przy β ${w.beta.toFixed(3)} (Δβ 0,005)`);
    assert.ok(w.r <= 2200 * 0.005, `${w.id}: promień ${w.r.toFixed(2)} px (Δβ 0,005)`);
  }
  // gra: ładowanie 0,8 s (48 klatek, β = 0,9 · smoothstep) i kop 0,45 s (easeOut³) — progi P4 (60 / 50 px na klatkę)
  const game = [];
  for (let i = 0; i <= 48; i++) game.push(warpLensChargeBeta(i / 48));
  for (let i = 1; i <= 30; i++) game.push(warpLensKickBeta(i / 60));
  for (const w of lensBetaSteps(game)) {
    assert.ok(w.d <= 60, `${w.id}: ${w.d.toFixed(2)} px / klatkę (P4 ≤ 60)`);
    assert.ok(w.r <= 50, `${w.id}: promień ${w.r.toFixed(2)} px / klatkę (P4 ≤ 50)`);
  }
});

test('rozstawienie obrazu w świecie (lensImageToWorld — planet3d.assets.js, także SŁOŃCE): β = 0 — prawdziwe miejsce; obraz wraca rzutem kamery passa; obrót kadru', () => {
  const { bodies, ctx, zoom, focal, camZ } = lensScene1080();
  const sun = bodies[4];
  const lens = new WarpWorldLens();
  const camX = ctx.shipX - ctx.shipSx / zoom;
  const camY = ctx.shipY - ctx.shipSy / zoom;
  const L = { zoom, focal, camZ, camX, camY, roll: 0 };
  const out = { x: 0, y: 0, k: 0 };
  ctx.beta = 0;
  lens.update(bodies, bodies.length, ctx, null);
  for (const b of bodies) {
    lensImageToWorld(L, b.out.x, b.out.y, b.z, b.z === 0, out);
    assert.ok(near(out.x, b.x, 1e-6 * Math.max(1, Math.abs(b.x))) && near(out.y, b.y, 1e-6 * Math.max(1, Math.abs(b.y))),
      `${b.id}: β = 0 — prawdziwe miejsce (${out.x}, ${out.y}) vs (${b.x}, ${b.y})`);
  }
  // słońce w soczewce (z = −60 000): j. świata na px = (camZ − z) / focal; obraz = (świat − kamera) / k
  ctx.beta = 1;
  for (let i = 0; i < 3; i++) lens.update(bodies, bodies.length, ctx, null);
  lensImageToWorld(L, sun.out.x, sun.out.y, sun.z, false, out);
  assert.ok(near(out.k, (camZ + 60000) / focal, 1e-12));
  assert.ok(near((out.x - camX) / out.k, sun.out.x, 1e-9) && near((out.y - camY) / out.k, sun.out.y, 1e-9));
  assert.ok(sun.out.size >= 2, `słońce w soczewce widoczne (minDot): ${sun.out.size}`);
  // płaszczyzna gry: 1 / zoom
  lensImageToWorld(L, 100, -50, 0, true, out);
  assert.ok(near(out.k, 1 / zoom, 1e-12) && near(out.x, camX + 100 / zoom, 1e-9) && near(out.y, camY - 50 / zoom, 1e-9));
  // obrót kadru (viewRoll.js): świat = kamera + R(roll)·(o · k)
  const Lr = { ...L, roll: 0.7 };
  lensImageToWorld(Lr, 100, -50, 0, true, out);
  const u = 100 / zoom;
  const v = -50 / zoom;
  assert.ok(near(out.x, camX + Math.cos(0.7) * u - Math.sin(0.7) * v, 1e-9) && near(out.y, camY + Math.sin(0.7) * u + Math.cos(0.7) * v, 1e-9));
  // planet3d.assets.js: wszystkie rozstawienia przez tę funkcję; słońce w głębokości SUN_Z, powrót widoczności po soczewce
  const src = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');
  const sunCls = src.slice(src.indexOf('class DirectSun {'), src.indexOf('const _entities = [];'));
  assert.match(sunCls, /this\.lensBody = newLensBody\('sun', 'sun'\);/);
  assert.match(sunCls, /const lw = lensImageToWorld\(L, o\.x, o\.y, b\.z, false, _lensWorld\);[\s\S]*?this\.group\.position\.set\(lw\.x, -lw\.y, b\.z\);/);
  assert.match(sunCls, /_lensRestore\(\) \{\s*this\._lensed = false;\s*if \(!this\.group\.visible\) this\.group\.visible = true;/);
  assert.match(sunCls, /if \(lensOn\) this\._lensPrepare\(scale\);\s*else if \(this\._lensed\) this\._lensRestore\(\);/);
  assert.doesNotMatch(src, /function lensToWorld\(/, 'jedna funkcja rozstawienia (worldLens.js)');
  assert.equal((src.match(/lensImageToWorld\(L, o\.x, o\.y,/g) || []).length, 4, 'planety, księżyce, małe ciała, słońce');
});
