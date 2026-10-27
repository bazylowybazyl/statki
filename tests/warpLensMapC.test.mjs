// Mapa soczewki świata — matematyka. Od 2026-10-26 MAPA O1 „kamera pochylona” (DECYZJE-2 O1-1…O1-4; nazwa pliku z czasów
// mapy C, DECYZJE M1–M6, P1–P4, T1–T2): ciągłość β → 0 (dokładnie prawdziwy obraz), namiar prawdziwy, odstęp q·(d − r) > 0,
// homografia (proste → proste, jeden punkt zbiegu), płaszczyzna kamery bez osobliwości (kMax) i ukrycie za nią,
// odwrotność dla HUD (postać zamknięta), planeta dokładnie na kursie, kolejność tempa (W0), cel → podgląd kadru przylotu
// (ta sama funkcja co kamera), front wyjścia, stożek za celem, kieszeń kadłuba, kropki, kotwica, brak NaN; oś β
// (src/render/warpLensPhase.js) i kadr przylotu (src/render/warpArrivalFrame.js).
// node --test tests/warpLensMapC.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORLD_LENS_DEFAULTS, WORLD_LENS_MODE, warpLensFrame, newWarpLensFrame, warpLensQ, warpLensInverse, mapWorldLens,
  WarpWorldLens, newLensBody, softMaxLog, softMaxCompact, viewEdgeDistance, lensDiscInFrame, lensImageToWorld,
  warpLensChordAlong
} from '../src/3d/warp/worldLens.js';
import { WARP_ARRIVAL_FRAME, warpViewEdgePx, warpArrivalZoom, warpArrivalSoftMin } from '../src/render/warpArrivalFrame.js';
import {
  WARP_LENS_PHASE, warpLensBeta, warpLensKickBeta, warpLensChargeBeta, warpExitFrontS, warpBodySubmerge, warpLensHudBeta,
  warpLensExitLive
} from '../src/render/warpLensPhase.js';
import { createCameraRig, stepCameraRigWarp, CAMERA_RIG_DEFAULTS, defaultShipZoom } from '../src/game/cameraRig.js';
import { STAR_PARALLAX_LAYERS } from '../src/3d/starParallax.js';

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

test('mapa O1: β = 0 daje DOKŁADNIE prawdziwą skalę, β → 0 zbiega (< 1e-6 px); namiar prawdziwy i odstęp q·(d − r) > 0 przy każdym β', () => {
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

// Obraz punktu przy β (bez ukrycia): od kotwicy, q · (dx, dy).
function img(F, dx, dy, beta = 1, flat = 0.1173) {
  const q = warpLensQ(dx, dy, beta, flat, F, {});
  return { x: q.q * dx, y: q.q * dy, q: q.q, w: q.w, hide: q.hide };
}
const cross = (p, q, r) => ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / (Math.hypot(q.x - p.x, q.y - p.y) * Math.hypot(r.x - p.x, r.y - p.y));

test('mapa O1 (O1-1): homografia — proste w świecie są prostymi na ekranie przy każdym β, tory stałego l zbiegają w JEDNYM punkcie przed dziobem; ρ(d) rośnie na każdym promieniu; q_β bez przestrzału dla obrazów w kadrze', () => {
  const F = frame();
  const P = WORLD_LENS_DEFAULTS;
  assert.ok(near(F.s, P.ws * 960 / P.B1, 1e-15) && near(F.A, F.Ef / F.s, 1e-9), 'skala w trawersie i płaszczyzna kamery');
  assert.ok(Math.abs(F.A - 66418) < 1, `płaszczyzna kamery ${F.A.toFixed(0)} j. (1080p, kotwica 189 px pod środkiem)`);
  // Proste dowolnie w świecie (także skośne do kursu, przed dziobem i za rufą, przed płaszczyzną kamery): trzy punkty
  // prostej → trzy obrazy na prostej, przy β = 0,3 / 0,7 / 1 (każde β to homografia).
  let checked = 0;
  for (const beta of [0.3, 0.7, 1]) {
    for (let k = 0; k < 60; k++) {
      const ang = k * 0.53;
      const ox = -3e5 + (k * 37717) % 6e5;
      const oy = -1.5e6 + (k * 91033) % 1.55e6;
      const pts = [0, 0.4, 1].map((t) => ({ dx: ox + Math.cos(ang) * 2e5 * t, dy: oy + Math.sin(ang) * 2e5 * t }));
      const ws = pts.map((p) => warpLensQ(p.dx, p.dy, beta, 0.1173, F, {}).w);
      if (Math.min(...ws) <= 0.06) continue;   // za płaszczyzną kamery skala stoi na kMax · s (poza homografią, ukryte)
      const [a, b, c] = pts.map((p) => img(F, p.dx, p.dy, beta));
      assert.ok(Math.abs(cross(a, b, c)) < 1e-9, `prosta → prosta (β ${beta}, k ${k}): sin ${cross(a, b, c).toExponential(2)}`);
      checked++;
    }
  }
  assert.ok(checked > 120, `sprawdzone proste: ${checked}`);
  // Tory stałego l (kurs w górę: dx = l, dy = −a) leżą na prostych przez JEDEN punkt zbiegu (0, −E_f) — przed dziobem
  // i za rufą (dawniej: dwa punkty zbiegu i zakręt toru w trawersie).
  const vp = { x: 0, y: -F.Ef };
  for (const l of [-300000, -75000, 20000, 150000]) {
    const pts = [1.2e6, 3e5, 0, -2e4, -4e4].map((a) => img(F, l, -a));
    for (let i = 1; i < pts.length; i++) assert.ok(Math.abs(cross(vp, pts[0], pts[i])) < 1e-9, `l ${l}: punkt ${i} na prostej do punktu zbiegu`);
    const far = img(F, l, -1e12);
    assert.ok(Math.hypot(far.x - vp.x, far.y - vp.y) < 1e-3, `l ${l}: z nieskończoności — punkt zbiegu (${far.x.toFixed(4)}, ${far.y.toFixed(4)})`);
  }
  // Promień od kotwicy rośnie monotonicznie z odległością na każdym kierunku (odwrotność istnieje), także za płaszczyzną kamery.
  const q = {};
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
  // q_β monotoniczne w β (obraz jedzie po swoim namiarze bez przestrzału): ciała przed dziobem i każde z prawdziwym obrazem
  // w pobliżu kadru (ρ ≤ 1500 px) — ruch rodziną q_β (daleko za rufą q_β ma minimum, ale takie ciało jest poza kadrem
  // w obu obrazach, a za płaszczyzną kamery wchodzi w soczewkę wynurzeniem w miejscu — niewidoczne).
  for (const b of bodiesGrid()) {
    const a = -b.dy;
    if (a < 0 && Math.hypot(b.dx, b.dy) * 0.1173 > 1500) continue;
    let prev = Infinity;
    for (let i = 0; i <= 50; i++) {
      warpLensQ(b.dx, b.dy, i / 50, 0.1173, F, q);
      assert.ok(q.q <= prev * (1 + 1e-12), `q_β maleje z β (a ${a.toFixed(0)})`);
      prev = q.q;
    }
  }
});

test('mapa O1 (O1-1, O1-2): przelot — ciało rośnie od punktu zbiegu przez trawers aż do wylotu z kadru; płaszczyzna kamery bez osobliwości (kMax), za nią promień 0; ciągłość w a', () => {
  const F = frame();
  const P = WORLD_LENS_DEFAULTS;
  const o = { zoom: 0.1173, beta: 1, velAngle: -Math.PI / 2, viewHalfW: 960, viewHalfH: 540, shipSx: 0, shipSy: 189 };
  const r = 30000;
  for (const l of [40000, 75000, 300000, 2e6]) {
    let prev = 0;
    let prevPos = null;
    for (let a = 3e6; a >= -1.2 * F.A; a -= 500) {
      const m = mapWorldLens(l, -a, r, o, {});
      assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.size), `skończone (l ${l}, a ${a})`);
      if (m.w > P.hideW1) assert.ok(m.size >= prev - 1e-9, `rośnie przed pasem ukrycia (l ${l}, a ${a})`);
      // ciągłość: krok obrazu na 500 j. drogi ograniczony (bez osobliwości przy płaszczyźnie kamery: ≤ kMax² · s · 500 · √(1 + (l/A)²))
      if (prevPos) {
        const lim = P.kMax * P.kMax * F.s * 500 * Math.sqrt(1 + (l / F.A) ** 2) + 1e-6;
        assert.ok(Math.hypot(m.x - prevPos.x, m.y - prevPos.y) <= lim, `ciągłe (l ${l}, a ${a})`);
      }
      if (m.w <= P.hideW0) assert.equal(m.size, 0, `za płaszczyzną kamery niewidoczne (l ${l}, a ${a})`);
      prev = m.size;
      prevPos = m;
    }
  }
  // Trawers (a = 0): skala s dokładnie, nachylenie toru ciągłe (jedna mapa przed i za statkiem — bez ε i bez załamania).
  const at = (a) => mapWorldLens(-75000, -a, 30000, o, {});
  assert.ok(near(at(0).q, F.s, 1e-15));
  const e = 0.5;
  const sA = (at(e).y - at(0).y) / e;
  const sB = (at(0).y - at(-e).y) / e;
  assert.ok(Math.abs(sA - sB) <= 1e-4 * Math.abs(sA), `nachylenie w trawersie ${sA} / ${sB}`);
  // Za płaszczyzną kamery skala stoi na kMax · s (obraz daleko za kadrem), promień 0.
  const behind = at(-2 * F.A);
  assert.ok(near(behind.q, P.kMax * F.s, 1e-15) && behind.size === 0 && Math.hypot(behind.x, behind.y) > 10 * 1080);
});

test('odwrotność mapy O1 (HUD, O1-3): piksel → świat → piksel, błąd < 1e-9 (względny), także za płaszczyzną kamery, przy kursie po skosie i kotwicy poza osią; horyzont i punkty za nim — brak obrazu', () => {
  const q = {};
  const inv = {};
  for (const F of [frame(0, 189), warpLensFrame(Math.cos(0.7), Math.sin(0.7), 960, 540, 140, -60, WORLD_LENS_DEFAULTS, newWarpLensFrame()),
    warpLensFrame(0, -1, 1280, 720, 0, 252, { ...WORLD_LENS_DEFAULTS, kMax: 8, B1: 60000 }, newWarpLensFrame())]) {
    let worst = 0;
    let clamped = 0;
    for (const b of bodiesGrid()) {
      for (const k of [1, 4]) {
        const dx = b.dx * k;
        const dy = b.dy * k;
        warpLensQ(dx, dy, 1, 0.1173, F, q);
        if (q.w < F.wMin) clamped++;
        warpLensInverse(q.q * dx, q.q * dy, F, inv);
        assert.ok(inv.ok, 'punkt obrazu ma przeciwobraz');
        worst = Math.max(worst, Math.hypot(inv.dx - dx, inv.dy - dy) / Math.hypot(dx, dy));
      }
    }
    assert.ok(worst < 1e-9, `błąd odwrotności ${worst.toExponential(2)}`);
    assert.ok(clamped > 10, `w próbie są punkty za płaszczyzną kamery (${clamped})`);
  }
  const F = frame(0, 189);
  // Horyzont: punkt zbiegu i wszystko za nim (u ≥ 1) — nie jest obrazem żadnego punktu.
  for (const [X, Y] of [[0, -WORLD_LENS_DEFAULTS.hf * 729], [0, -(WORLD_LENS_DEFAULTS.hf * 729 + 5)], [500, -F.Ef], [-3000, -2000]]) {
    warpLensInverse(X, Y, F, inv);
    assert.equal(inv.ok, false, `(${X}, ${Y}) za horyzontem`);
  }
  // Tuż pod punktem zbiegu na osi kursu — bardzo daleko przed dziobem, dokładnie na osi (l = 0).
  warpLensInverse(0, -(F.Ef - 1e-3), F, inv);
  assert.ok(inv.ok && Math.abs(inv.dx) < 1e-6 && -inv.dy > 1e9, `na osi tuż pod horyzontem: ${inv.dy.toExponential(2)} j.`);
});

test('planeta dokładnie na kursie (O1-4, l = 0, nie cel): tor po osi kursu od punktu zbiegu, bez osobliwości — położenie, promień i tempo skończone i monotoniczne', () => {
  const lens = new WarpWorldLens();
  const ctx = { beta: 1, velAngle: -Math.PI / 2, zoom: 0.1173, W: 1920, H: 1080, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189, anchorSx: 0, anchorSy: 189, hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1 };
  const F = frame();
  const pl = Object.assign(newLensBody('na-kursie', 'planet'), { x: 0, y: -1e15, r: 16650, z: -50000, flat: 0.026, ready: true });
  // z nieskończoności: kropka (minDot) dokładnie w punkcie zbiegu
  lens.update([pl], 1, ctx, null);
  assert.ok(near(pl.out.x, 0, 1e-12) && near(pl.out.y, 189 - F.Ef, 1e-6), `punkt zbiegu (${pl.out.x}, ${pl.out.y})`);
  assert.ok(near(pl.out.size, WORLD_LENS_DEFAULTS.minDot, 1e-9) && Number.isFinite(pl.out.angle), 'kropka, obrót skończony');
  // zbliżanie po osi (statek leci na ciało; jedno przejście — tryb ustalony raz)
  let prev = null;
  let maxStep = 0;
  for (let a = 3e6; a >= 60000; a -= 1000) {
    pl.y = -a;
    lens.update([pl], 1, ctx, null);
    const o = pl.out;
    assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.size) && Number.isFinite(o.angle), `skończone (a ${a})`);
    assert.equal(o.x, 0, `oś kursu (a ${a})`);
    if (prev) {
      assert.ok(o.y > prev.y && o.size >= prev.size, `schodzi z punktu zbiegu ku statkowi i rośnie (a ${a})`);
      maxStep = Math.max(maxStep, o.y - prev.y);
    }
    prev = { y: o.y, size: o.size };
  }
  // tempo wzdłuż osi: dY/da = s · A² / (A + a)² — przy punkcie zbiegu → 0, największe najbliżej statku
  assert.ok(maxStep <= F.s * 1000 * (F.A / (F.A + 59000)) ** 2, `krok na 1000 j. ${maxStep.toFixed(3)} px`);
  const yAt = (a) => { const m = warpLensQ(0, -a, 1, 0.026, F, {}); return m.q * a; };
  const dyda = (a) => yAt(a + 1) - yAt(a);
  assert.ok(dyda(1e9) > 0 && dyda(1e9) < 1e-9 && dyda(1e5) < dyda(1e4), 'tempo maleje ku punktowi zbiegu (bez osobliwości)');
  // za statkiem na osi (l = 0, a < 0): dalej po osi w dół, za płaszczyzną kamery — skala kMax · s i promień 0
  // (oś kursu przechodzi przez ciało — przelot nad nim, BRIEF-studnie pkt 5: głębia w punkcie WYJŚCIA osi kursu z ciała,
  // a + r — gaśnie dopiero, gdy cała cięciwa jest za płaszczyzną kamery; `chord: 0` — skala środka, jak statek nad ciałem
  // już przy wejściu: za płaszczyzną kamery niewidoczne)
  for (const a of [-1e4, -0.5 * F.A, -0.97 * F.A, -(0.97 * F.A + 16650), -2 * F.A]) {
    const o = { zoom: 0.1173, beta: 1, velAngle: -Math.PI / 2, viewHalfW: 960, viewHalfH: 540, shipSx: 0, shipSy: 189 };
    const c = mapWorldLens(0, -a, 16650, o, {});
    assert.ok(c.x === 0 && c.y > 0 && Number.isFinite(c.y) && Number.isFinite(c.size), `za rufą na osi (a ${a})`);
    assert.ok(near(c.ae, a + 16650, 1e-6) || a + 16650 > -0.25 * 16650, `głębia w punkcie wyjścia osi kursu (a ${a})`);
    if (a + 16650 <= -0.96 * F.A) assert.equal(c.size, 0, 'cięciwa za płaszczyzną kamery — niewidoczne');
    else if (a > -0.96 * F.A) assert.ok(c.size > 0, 'przed płaszczyzną kamery — widoczne');
    const m = mapWorldLens(0, -a, 16650, { ...o, chord: 0 }, {});
    assert.ok(m.x === 0 && m.y > 0 && Number.isFinite(m.size), `skala środka: za rufą na osi (a ${a})`);
    if (a <= -0.96 * F.A) assert.equal(m.size, 0, 'skala środka: za płaszczyzną kamery — niewidoczne');
  }
});

test('W0 — kolejność tempa w warstwie soczewki: obraz przesuwa się tym wolniej, im dalej wzdłuż kursu (głębia homografii); przy punkcie zbiegu wolniej niż w trawersie', () => {
  const F = frame();
  const v = 175000 / 60;   // Mk II, krok klatki 60 Hz [j.]
  const speed = (l, a) => {
    const p = img(F, l, -a);
    const n = img(F, l, -(a - v));
    return Math.hypot(n.x - p.x, n.y - p.y) * 60;   // [px/s]
  };
  for (const l of [0, 40000, 75000, 300000, 1e6]) {
    let prev = Infinity;
    for (const a of [-2e4, 0, 5e4, 1.5e5, 4e5, 1e6, 1.5e6, 3e6, 6e6]) {
      const sp = speed(l, a);
      assert.ok(sp < prev, `l ${l}: dalej wzdłuż kursu (a ${a}) wolniej — ${sp.toFixed(1)} px/s`);
      prev = sp;
    }
  }
  // liczby do raportu W0 (1080p, Mk II, bez zwolnienia przy ciałach): trawers ≈ s · v, punkt zbiegu (1,5 mln j.) < 20 px/s
  assert.ok(Math.abs(speed(0, 0) / (F.s * 175000) - 1) < 0.05, `trawers ${speed(0, 0).toFixed(0)} px/s`);
  assert.ok(speed(0, 1.5e6) < 5 && speed(300000, 1.5e6) < 20, `daleko: ${speed(0, 1.5e6).toFixed(1)} / ${speed(300000, 1.5e6).toFixed(1)} px/s`);
});

// W0 MIĘDZY WARSTWAMI (DECYZJE-2 W0, recenzja O1 ust. 4): tempo gwiazd w warpie = min(v, STAR_SPEED_CAP) · paralaksa · zoom
// skoku (warpNurt.js — kamera gwiazd; starParallax.js — warstwy; cameraRig.js — zoom skoku 0,2133 · warpZoomOut przy 1080p).
// Ciało soczewki w TRAWERSIE (a = 0, bez zwolnienia przy ciele) jedzie szybciej niż najszybsza warstwa mid — leży w kolejności
// „bliżej = szybciej”. WYJĄTEK W0 (do DECYZJE): ciało przy PUNKCIE ZBIEGU (≥ 1,5 mln j. przed dziobem) jest wolniejsze niż
// warstwa deep — punkt zbiegu to kierunek lotu (cel podróży stoi w nim jak w kamerze), a warstwy gwiazd przesuwają się
// równolegle do kursu, nie od punktu zbiegu; tak samo w mapie C. Test pilnuje obu stron (zmiana warstwy gwiazd albo mapy,
// która to odwróci, ma być świadoma). Przy zwolnieniu 15% (mijana planeta) Mk I w trawersie 75 tys. j. ~200 px/s — w paśmie mid.
test('W0 między warstwami: ciało w trawersie szybsze niż gwiazdy mid, przy punkcie zbiegu wolniejsze niż deep (wyjątek W0 — punkt zbiegu)', () => {
  const nurt = readFileSync(new URL('../src/3d/warp/warpNurt.js', import.meta.url), 'utf8');
  const cap = Number((nurt.match(/const STAR_SPEED_CAP = (\d+)/) || [])[1]);
  assert.ok(cap > 0, 'STAR_SPEED_CAP w warpNurt.js');
  const zoomJump = defaultShipZoom(1920, 1800) * CAMERA_RIG_DEFAULTS.warpZoomOut;
  const layer = (name) => STAR_PARALLAX_LAYERS.find((l) => l.name === name);
  const deepMax = cap * layer('deep').parallaxMax * zoomJump;
  const midMax = cap * layer('mid').parallaxMax * zoomJump;
  assert.ok(deepMax > 10 && deepMax < midMax, `deep ${deepMax.toFixed(1)}, mid ${midMax.toFixed(1)} px/s`);
  for (const [vDrive, name] of [[100000, 'Mk I'], [175000, 'Mk II'], [250000, 'Mk III']]) {
    const F = warpLensFrame(0, -1, 960, 540, 0, 189, WORLD_LENS_DEFAULTS, newWarpLensFrame(), vDrive);
    const v = vDrive / 60;
    const speed = (l, a) => {
      const p = img(F, l, -a);
      const n = img(F, l, -(a - v));
      return Math.hypot(n.x - p.x, n.y - p.y) * 60;
    };
    for (const l of [0, 40000, 75000, 150000, 300000]) {
      assert.ok(speed(l, 0) > midMax, `${name}, l ${l}: trawers ${speed(l, 0).toFixed(0)} px/s > gwiazdy mid ${midMax.toFixed(0)} px/s`);
      assert.ok(speed(l, 1.5e6) < deepMax, `${name}, l ${l}: punkt zbiegu ${speed(l, 1.5e6).toFixed(1)} px/s < gwiazdy deep ${deepMax.toFixed(1)} px/s (wyjątek W0)`);
    }
  }
});

// PROPORCJE KADRU (recenzja O1 ust. 1): ē_s najwyżej 16/9 · połowa wysokości — na 21:9 i 32:9 skala s, płaszczyzna kamery A
// i tempo obrazu względem wysokości kadru jak na 16:9 (dawniej s rosło z szerokością: 32:9 — tempo × 2, A ≈ 33 tys. j.);
// boki szerszego kadru pokazują więcej świata. Gra liczy zoom skoku z szerokości (defaultShipZoom) — to kamera, nie mapa.
test('mapa O1 a proporcje kadru: s i A przy 21:9 / 32:9 jak przy 16:9 tej wysokości (A nie zależy od rozdzielczości ani proporcji ≥ 16:9); węższy kadr — ē_s; aspectMax 0 — dawne s z szerokości', () => {
  const fr = (W, H, params = WORLD_LENS_DEFAULTS) => warpLensFrame(0, -1, W / 2, H / 2, 0, 189 * H / 1080, params, newWarpLensFrame());
  const ref = fr(2560, 1440);
  for (const W of [3440, 5120, 7680]) {
    const F = fr(W, 1440);
    assert.ok(near(F.s, ref.s, 1e-15) && near(F.A, ref.A, 1e-6), `${W}×1440: s ${F.s} / ${ref.s}, A ${F.A} / ${ref.A}`);
    // Mars 75 tys. j. z boku w trawersie: 659 px przy 1080p → × 1,333 przy 1440p, niezależnie od szerokości
    const m = mapWorldLens(-75000, 0, 30000, { zoom: 0.1173, beta: 1, velAngle: -Math.PI / 2, viewHalfW: W / 2, viewHalfH: 720, shipSx: 0, shipSy: 252 }, {});
    assert.ok(Math.abs(Math.abs(m.x) / (1440 / 1080) - 659) < 2, `${W}×1440: Mars w trawersie ${(Math.abs(m.x) / 1.3333).toFixed(1)} px (1080p)`);
  }
  assert.ok(near(fr(1920, 1080).A, ref.A, 1e-6) && near(fr(3840, 2160).A, ref.A, 1e-6), 'A nie zależy od rozdzielczości');
  const narrow = fr(1440, 1080);
  assert.ok(narrow.s < fr(1920, 1080).s && narrow.A > ref.A, 'węższy niż 16:9 — ē_s z kadru (wolniej, A większe)');
  const old = fr(5120, 1440, { ...WORLD_LENS_DEFAULTS, aspectMax: 0 });
  assert.ok(near(old.s / ref.s, 2, 1e-9) && near(ref.A / old.A, 2, 1e-6), 'aspectMax 0: s z szerokości (32:9 — s × 2, A / 2)');
  // aspectFlow 1 (A/B): tempo w całym kadrze jak na 16:9 — świat × e16 / ē_s (32:9 — × 0,5); 16:9 bez zmian
  const flow = { ...WORLD_LENS_DEFAULTS, aspectFlow: 1 };
  assert.ok(near(fr(5120, 1440, flow).s / ref.s, 0.5, 1e-9) && near(fr(2560, 1440, flow).s, ref.s, 1e-15), 'aspectFlow 1: 32:9 — s × 0,5, 16:9 bez zmian');
  assert.ok(near(fr(5120, 1440, { ...WORLD_LENS_DEFAULTS, aspectFlow: 0.5 }).s / ref.s, Math.SQRT1_2, 1e-9), 'aspectFlow 0,5: × √0,5');
});

// NAPĘD (recenzja O1 ust. 2): przy napędzie szybszym niż speedRef (Mk II) s × speedRef / v — tempo obrazu s · v (wylot dołem
// blisko osi kursu 2,6 · s · v) jak przy Mk II; wolniejszy napęd i brak pola — bez zmian; speedRef 0 — wyłączone.
test('mapa O1 a napęd warp: Mk III — skala × 0,7, tempo obrazu jak przy Mk II; Mk I / Mk II / brak pola — bez zmian', () => {
  const fr = (drive, params = WORLD_LENS_DEFAULTS) => warpLensFrame(0, -1, 960, 540, 0, 189, params, newWarpLensFrame(), drive);
  const s0 = fr(NaN).s;
  for (const d of [NaN, 0, 100000, 175000]) assert.ok(near(fr(d).s, s0, 1e-15) && fr(d).kv === 1, `napęd ${d}: bez zmian`);
  const mk3 = fr(250000);
  assert.ok(near(mk3.kv, 0.7, 1e-12) && near(mk3.s, s0 * 0.7, 1e-15) && near(mk3.A, fr(NaN).A / 0.7, 1e-6), 'Mk III: s × 0,7, A / 0,7');
  assert.ok(near(mk3.s * 250000, s0 * 175000, 1e-9), 'tempo w trawersie s · v jak przy Mk II');
  assert.ok(near(fr(250000, { ...WORLD_LENS_DEFAULTS, speedRef: 0 }).s, s0, 1e-15), 'speedRef 0 — wyłączone');
  // ten sam wynik przez stan klatki (ctx.driveSpeed) i mapWorldLens (o.driveSpeed)
  const lens = new WarpWorldLens();
  const b = Object.assign(newLensBody('mars', 'planet'), { x: -75000, y: 0, r: 30000, flat: 0.1173, ready: true });
  const ctx = { beta: 1, velAngle: -Math.PI / 2, zoom: 0.1173, W: 1920, H: 1080, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189, anchorSx: 0, anchorSy: 189,
    hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1, driveSpeed: 250000 };
  lens.update([b], 1, ctx, null);
  const m = mapWorldLens(-75000, 0, 30000, { zoom: 0.1173, beta: 1, velAngle: -Math.PI / 2, viewHalfW: 960, viewHalfH: 540, shipSx: 0, shipSy: 189, driveSpeed: 250000 }, {});
  assert.ok(near(b.out.size, m.size, 1e-9) && near(m.size, 30000 * s0 * 0.7, 1e-6), `Mars w trawersie przy Mk III: ${m.size.toFixed(1)} px`);
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

test('brak NaN: d → 0, ciało zawierające statek, cel pod statkiem, skrajne zoomy, mały i bardzo szeroki kadr, kotwica poza kadrem, skrajne B, napęd', () => {
  const cases = [];
  for (const zoom of [1e-6, 0.0149, 0.1173, 3.2, 100]) {
    for (const [W, H] of [[1920, 1080], [5120, 1440], [20000, 10], [2, 2], [1, 1]]) {
      for (const [ax, ay] of [[NaN, NaN], [0, 189], [5000, -9000]]) cases.push({ zoom, W, H, ax, ay });
    }
  }
  for (const [B1, kMax] of [[1, 20], [87464, 20], [1e9, 20], [87464, 1], [87464, 1e6]]) {
    for (const c of cases) {
      const lens = new WarpWorldLens({ B1, kMax });
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
            anchorSx: c.ax, anchorSy: c.ay, hullHalfLen: 0, hullHalfWid: 0, dt: 1 / 60, exitAge, exitHalt: 1.33, exitSlow: 0.7,
            driveSpeed: [NaN, 250000, 1e12, -5][(exitAge + 1 + beta * 2) % 4 | 0] };
          lens.update(list, list.length, ctx, tgt);
          for (const b of list) {
            const o = b.out;
            assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.size) && o.size >= 0 && Number.isFinite(o.beta),
              `${b.id}: ${o.x}, ${o.y}, ${o.size} (zoom ${c.zoom}, ${c.W}×${c.H}, B1 ${B1}, kMax ${kMax}, β ${beta}, wyjście ${exitAge})`);
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
  for (const a of [-1e30, -F.A, 1e30]) {
    const m = warpLensQ(0, -a, 1, 0.1, F, {});
    assert.ok(Number.isFinite(m.q) && m.q > 0 && Number.isFinite(m.hide), `skrajne a ${a}`);
  }
  assert.equal(warpLensInverse(NaN, 5, F, {}).ok, false);
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

// PRZELOT NAD CIAŁEM — CIĘCIWA KURSU (BRIEF-studnie pkt 5): głębia ciała, przez które przechodzi oś kursu, w punkcie osi
// kursu w ciele najbliższym statkowi — przed nim punkt wejścia a − h, nad nim statek (0: skala s), za nim punkt wyjścia a + h.
test('cięciwa kursu (warpLensChordAlong): oś kursu obok ciała — środek (mapa O1 bez zmian); przez ciało — wejście / statek / wyjście, końce C¹, nieparzysta i niemalejąca w a, ciągła w l, półcięciwa ≤ chordMax · A; chord 0 — środek', () => {
  const F = frame();
  const P = WORLD_LENS_DEFAULTS;
  const rc = 54750;
  // obok osi kursu (|l| ≥ rc) i bez promienia — dokładnie środek
  for (const a of [-2e5, -1, 0, 3e4, 1e6]) {
    for (const l of [rc, -rc, 1.5 * rc, 3e5]) assert.equal(warpLensChordAlong(a, l, rc, F), a);
    assert.equal(warpLensChordAlong(a, 0, 0, F), a);
  }
  // przez ciało: półcięciwa h = √(rc² − l²) (najwyżej chordMax · A), końce wygładzone na ± chordSoft · h
  for (const l of [0, 20000, -40000, 54000]) {
    const h = Math.min(Math.sqrt(rc * rc - l * l), P.chordMax * F.A);
    const k = P.chordSoft * h;
    assert.equal(warpLensChordAlong(0, l, rc, F), 0, 'statek nad ciałem — skala s');
    assert.ok(near(warpLensChordAlong(h - k, l, rc, F), 0, 1e-9));
    assert.ok(near(warpLensChordAlong(3e5, l, rc, F), 3e5 - h, 1e-6), 'przed — punkt wejścia osi kursu');
    assert.ok(near(warpLensChordAlong(-3e5, l, rc, F), -3e5 + h, 1e-6), 'za — punkt wyjścia osi kursu');
    let prev = -Infinity;
    let prevD = NaN;
    let worstKink = 0;
    const da = 25;
    for (let a = -3e5; a <= 3e5; a += da) {
      const e = warpLensChordAlong(a, l, rc, F);
      assert.ok(near(e, -warpLensChordAlong(-a, l, rc, F), 1e-9), 'nieparzysta');
      assert.ok(e >= prev - 1e-9, `niemalejąca (l ${l}, a ${a})`);
      if (prev > -Infinity) {
        const dd = (e - prev) / da;
        assert.ok(dd >= -1e-9 && dd <= 1 + 1e-9, 'pochodna w [0, 1]');
        if (prevD === prevD) worstKink = Math.max(worstKink, Math.abs(dd - prevD));
        prevD = dd;
      }
      prev = e;
    }
    // C¹: zmiana pochodnej na krok da ≤ da / (2k) (kwadratowe przejście) — bez załamania przy wejściu nad tarczę
    assert.ok(worstKink <= da / (2 * k) + 1e-9, `l ${l}: skok pochodnej ${worstKink.toExponential(2)} (≤ ${(da / (2 * k)).toExponential(2)})`);
  }
  // ciągłość w l przy brzegu (|l| → rc): |ae − a| ≤ h → 0
  for (const a of [-9e4, 2e4, 4e5]) {
    const e = warpLensChordAlong(a, rc - 1, rc, F);
    assert.ok(Math.abs(e - a) <= Math.sqrt(rc * rc - (rc - 1) ** 2) + 1e-9, 'ciągła przy |l| → rc');
  }
  // ogromne ciało: półcięciwa ≤ chordMax · A (środek obrazu poniżej punktu zbiegu)
  assert.ok(near(warpLensChordAlong(1e6, 0, 5e6, F), 1e6 - P.chordMax * F.A, 1e-6));
  // A/B: chord 0 — skala środka
  const F0 = frame(0, 189, { ...WORLD_LENS_DEFAULTS, chord: 0 });
  assert.equal(warpLensChordAlong(-3e4, 0, rc, F0), -3e4);
  // warpLensQ: głębia w punkcie cięciwy (rc), bez rc — w środku
  const q = warpLensQ(0, 30000, 1, 0.1173, F, {}, rc);
  assert.ok(near(q.ae, warpLensChordAlong(-30000, 0, rc, F), 1e-9) && near(q.q, F.s / (1 + q.ae / F.A), 1e-15), 'q z głębi cięciwy');
  assert.equal(warpLensQ(0, 30000, 1, 0.1173, F, {}).ae, -30000);
});

// KIESZEŃ KADŁUBA (od etapu „studnie” — BRIEF-studnie pkt 5): tylko ciało BLISKO STATKU NA STARCIE (prawdziwy obraz w kadrze
// przy decyzji wejścia, cięciwa kursu nie przed statkiem — dok Luny, Hidalgo, olbrzym pasa obok statku); decyzja raz na skok.
// Ciało mijane w locie (także o włos od ringu) i ciało, nad którym statek przeleci — bez kieszeni: tarcza pod statkiem.
test('kieszeń kadłuba: ciało blisko statku na starcie (z ringiem) nie zachodzi na kadłub; ciało mijane w locie i ciało z cięciwą kursu przed statkiem — dokładnie mapa (bez kieszeni)', () => {
  const ctx = { beta: 0.01, velAngle: -Math.PI / 2, zoom: 0.1173, W: 1920, H: 1080, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189, anchorSx: 0, anchorSy: 189, hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1 };
  const map = (b, chord = 1) => mapWorldLens(b.x, b.y, b.r, { zoom: 0.1173, beta: 1, velAngle: -Math.PI / 2, viewHalfW: 960, viewHalfH: 540, shipSx: 0, shipSy: 189, rExt: b.rExt, chord }, {});
  // (a) na starcie przy doku ciała za rufą (dok w kadrze — attachR; cięciwa kursu za statkiem) — kieszeń
  const lens = new WarpWorldLens();
  const close = Object.assign(newLensBody('dok', 'small'), { x: 0, y: 8019, r: 4717, attachR: 11019, flat: 0.1173, ready: true });
  const usual = Object.assign(newLensBody('zwykle', 'planet'), { x: -75000, y: -200000, r: 30000, flat: 0.1173, ready: true });
  lens.update([close, usual], 2, ctx, null);       // decyzja wejścia przy małym udziale soczewki (jak w ładowaniu)
  ctx.beta = 1;
  lens.update([close, usual], 2, ctx, null);
  assert.ok(close.pocketOn && !usual.pocketOn, 'kieszeń tylko dla ciała z prawdziwym obrazem (dokiem) w kadrze na starcie');
  const o = close.out;
  const gap = Math.hypot(o.x, o.y - 189) - o.size;
  assert.ok(gap >= 105 + WORLD_LENS_DEFAULTS.edgeGap - 1e-6, `tarcza od kadłuba ${gap.toFixed(1)} px`);
  assert.ok(o.size > map(close).size * 2, 'kieszeń powiększa obraz względem mapy');
  assert.ok(near(usual.out.size, map(usual).size, 1e-9), 'zwykły przelot — dokładnie mapa');
  // (b) to samo ciało mijane w locie (nie było w kadrze przy wejściu) — bez kieszeni: dokładnie mapa (tarcza pod statkiem)
  const lens2 = new WarpWorldLens();
  const passed = Object.assign(newLensBody('mijane', 'planet'), { x: 48000, y: -3e6, r: 37800, rExt: 46250, flat: 0.1173, ready: true });
  ctx.beta = 0.01;
  lens2.update([passed], 1, ctx, null);
  ctx.beta = 1;
  for (const y of [-3e6, -2e5, -2e4, 0, 1e4]) {
    passed.y = y;
    lens2.update([passed], 1, ctx, null);
    assert.ok(!passed.pocketOn && near(passed.out.size, map(passed).size, 1e-9), `mijane w locie (y ${y}) — mapa bez kieszeni`);
  }
  // (c) na starcie w kadrze, ale oś kursu przechodzi przez ciało PRZED statkiem (przelot nad nim) — bez kieszeni
  const lens3 = new WarpWorldLens();
  const ahead = Object.assign(newLensBody('przed', 'small'), { x: 0, y: -5000, r: 3000, flat: 0.1173, ready: true });
  ctx.beta = 0.01;
  lens3.update([ahead], 1, ctx, null);
  ctx.beta = 1;
  lens3.update([ahead], 1, ctx, null);
  assert.ok(ahead.chordOn && !ahead.pocketOn && near(ahead.out.size, map(ahead).size, 1e-9), 'cięciwa kursu przed statkiem — przelot nad ciałem, bez kieszeni');
  // A/B `pocket: 0` — nigdzie
  const lens4 = new WarpWorldLens({ pocket: 0 });
  ctx.beta = 0.01;
  lens4.update([close], 1, ctx, null);
  ctx.beta = 1;
  lens4.update([close], 1, ctx, null);
  assert.ok(near(close.out.size, map(close).size, 1e-9), 'pocket 0 — mapa');
});

test('kropki i słońce (M5): planeta i słońce nie mniejsze niż minDot, słońce × sunBoost; obraz < minPx gaśnie; stożek za celem (M4) zanurza ciała ±30°', () => {
  const lens = new WarpWorldLens();
  const ctx = { beta: 1, velAngle: -Math.PI / 2, zoom: 0.1173, W: 1920, H: 1080, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189, anchorSx: 0, anchorSy: 189, hullHalfLen: 105, hullHalfWid: 47, dt: 1 / 60, exitAge: -1 };
  const P = WORLD_LENS_DEFAULTS;
  const neptune = Object.assign(newLensBody('neptun', 'planet'), { x: 6e6, y: -3e6, r: 9000, flat: 0.02, z: -50000, ready: true });
  const sun = Object.assign(newLensBody('sun', 'sun'), { x: 1.5e6, y: 0, r: 2394, flat: 0.02, z: -60000, ready: true });
  const rock = Object.assign(newLensBody('skala', 'small'), { x: 9e6, y: -9e6, r: 400, flat: 0.1173, ready: true });
  lens.update([neptune, sun, rock], 3, ctx, null);
  assert.ok(neptune.out.size >= P.minDot - 1e-12, `kropka planety ${neptune.out.size}`);
  const F = frame();
  const q = {};
  warpLensQ(sun.x, sun.y, 1, sun.flat, F, q);
  assert.ok(near(sun.out.size, Math.max(q.q * sun.r * P.sunBoost, P.minDot), 1e-9), 'słońce × sunBoost');
  assert.ok(rock.out.size < 1e-3, 'mała skała poniżej progu gaśnie');
  // Za płaszczyzną kamery (O1-2): planeta i słońce bez kropki — niewidoczne (promień 0), obraz skończony daleko za kadrem.
  const back = Object.assign(newLensBody('za-rufa', 'planet'), { x: 6e6, y: 3e6, r: 9000, flat: 0.02, z: -50000, ready: true });
  const sunBack = Object.assign(newLensBody('sun', 'sun'), { x: -2e6, y: 3e6, r: 2394, flat: 0.02, z: -60000, ready: true });
  lens.reset();
  lens.update([back, sunBack], 2, ctx, null);
  for (const b of [back, sunBack]) {
    assert.equal(b.out.size, 0, `${b.id}: za płaszczyzną kamery bez kropki`);
    assert.ok(Number.isFinite(b.out.x) && Number.isFinite(b.out.y) && !lensDiscInFrame(b.out.x, b.out.y, 1, 1920, 1080));
    assert.equal(b.entry, WORLD_LENS_MODE.FAR, 'przejście w miejscu (niewidoczne), nie ruchem przez kadr');
  }
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
  // za rufą, przed płaszczyzną kamery — obraz w kadrze pod statkiem (O1: za trawersem ciało rośnie), ~230 px — zanurza się
  // w `submerge` s od przejścia frontu (kolejność od dziobu ku rufie); duże tarcze — test niżej (czas z tempa obrazu)
  const behind = Object.assign(newLensBody('tyl', 'planet'), { x: 60000, y: 15000, r: 20000, flat: 0.1173, ready: true });
  // za płaszczyzną kamery — niewidoczne przez całe wyjście, front „mija” je na końcu zwolnienia
  const hidden = Object.assign(newLensBody('ukryte', 'planet'), { x: 40000, y: 150000, r: 30000, flat: 0.1173, ready: true });
  const tgt = Object.assign(newLensBody('cel', 'planet'), { x: 0, y: -400000, r: 48000, flat: 0.1173, ready: true });
  const list = [tgt, ahead, abeam, behind, hidden];
  lens.update(list, 5, ctx, tgt);
  assert.ok(lensDiscInFrame(behind.out.x, behind.out.y, behind.out.size, 1920, 1080) && behind.out.y > 189, 'za rufą w kadrze pod statkiem');
  assert.equal(hidden.out.size, 0);
  const full = Object.fromEntries(list.map((b) => [b.id, b.out.size]));
  ctx.exitAge = 0;
  const firstSub = {};
  let prev = null;
  let hiddenMax = 0;
  for (let i = 0; i < 80; i++) {
    lens.update(list, 5, ctx, tgt);
    if (lensDiscInFrame(hidden.out.x, hidden.out.y, hidden.out.size, 1920, 1080)) hiddenMax = Math.max(hiddenMax, hidden.out.size);
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
  for (const b of [ahead, abeam, behind, hidden]) assert.ok(near(b.out.size, b.r * b.flat, 1e-9) && b.out.beta === 0, `${b.id}: po zanurzeniu — prawdziwy obraz`);
  assert.ok(hiddenMax === 0, `ciało za płaszczyzną kamery nie pojawia się w kadrze przy wyjściu (${hiddenMax} px)`);
  assert.ok(full.przod > 0 && tgt.out.size > 0);
});

// Wyjście tuż po bliskim przelocie (recenzja O1 ust. 3): duża tarcza pod statkiem / obok w kadrze — czas zanurzenia
// (wynurzenie w miejscu) albo powrotu (ruch — planety tła z prawdziwym obrazem w kadrze) z tempa obrazu: w kadrze
// ≤ 50 px promienia i ≤ 60 px ruchu na klatkę (P4) przy 1080p i 1440p; koniec z oknem wyjścia — prawdziwy obraz.
test('wyjście: duża tarcza pod statkiem zanurza się w P4 (czas zanurzenia z tempa obrazu, do końca okna wyjścia); kończy na prawdziwym obrazie', () => {
  for (const H of [1080, 1440]) {
    const k = H / 1080;
    const W = Math.round(H * 16 / 9);
    const zoom = 0.1173 * k;
    const focal = (H / 2) / Math.tan(17.5 * Math.PI / 180);
    const flatZ = (z) => (z ? focal / (focal / zoom - z) : zoom);
    const cases = [
      ['Jowisz (płaszczyzna, 50 / 30 tys. j.)', 50000, 30000, 48000, 0],
      ['Ziemia (płaszczyzna, 60 / 30 tys. j.)', -60000, 30000, 37800, 0],
      ['Mars (płaszczyzna, 40 / 25 tys. j.)', 40000, 25000, 30000, 0],
      ['Jowisz tła (50 / 30 tys. j.)', 50000, 30000, 48000, -50000],
      ['Saturn tła (60 / 20 tys. j.)', 60000, 20000, 40000, -50000]
    ];
    for (const [name, bx, by, r, z] of cases) {
      const lens = new WarpWorldLens();
      const ctx = { beta: 1, velAngle: -Math.PI / 2, zoom, W, H, shipX: 0, shipY: 0, shipSx: 0, shipSy: 189 * k, anchorSx: 0, anchorSy: 189 * k,
        hullHalfLen: 105 * k, hullHalfWid: 47 * k, dt: 1 / 60, exitAge: -1, exitSlow: 0.7, exitHalt: 1.33, focal, camZ: focal / zoom };
      const b = Object.assign(newLensBody('duza', 'planet'), { x: bx, y: by, r, z, flat: flatZ(z), ready: true });
      const tgt = Object.assign(newLensBody('cel', 'moon'), { x: 0, y: -20000, r: 5000, flat: zoom, ready: true });
      lens.update([tgt, b], 2, ctx, tgt);
      const r0 = b.out.size;
      assert.ok(lensDiscInFrame(b.out.x, b.out.y, r0, W, H) && r0 > 280 * k, `${name}: duża tarcza w kadrze (${r0.toFixed(0)} px)`);
      ctx.exitAge = 0;
      let prev = null;
      let dr = 0;
      let mv = 0;
      for (let i = 0; i < 75; i++) {
        lens.update([tgt, b], 2, ctx, tgt);
        const o = { x: b.out.x, y: b.out.y, size: b.out.size, inF: b.out.size >= 1.5 && lensDiscInFrame(b.out.x, b.out.y, b.out.size, W, H) };
        if (prev && prev.inF && o.inF) {
          dr = Math.max(dr, Math.abs(o.size - prev.size) / k);
          mv = Math.max(mv, Math.hypot(o.x - prev.x, o.y - prev.y) / k);
        }
        prev = o;
        ctx.exitAge += ctx.dt;
      }
      assert.ok(dr <= 50 && mv <= 60, `${name}, ${H}p: Δr ${dr.toFixed(1)} px/kl., ruch ${mv.toFixed(1)} px/kl. (P4 50 / 60), zanurzenie ${b.plunge.toFixed(2)} s`);
      assert.ok(b.plunge > WARP_LENS_PHASE.submerge && b.plunge <= 0.7 + WARP_LENS_PHASE.submerge + 1e-9, `${name}: czas zanurzenia ${b.plunge.toFixed(2)} s`);
      assert.ok(b.out.beta === 0 && near(b.out.size, b.r * b.flat, 1e-9), `${name}: po oknie wyjścia — prawdziwy obraz`);
    }
  }
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
    Object.assign(mk('sun', 'sun', -2e6, -3e6, 60000, -60000), { sizeBoost: 5, minDot: 2 })   // przed dziobem (za rufą — ukryte, O1-2)
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
