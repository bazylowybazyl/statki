// Obrót sfery nieba z drogi statku (src/3d/skyScroll.js, DECYZJE-2 N1): prawo tempa warstw (W0), znak obrotu,
// cięcie przy teleporcie, rzut równoodległy (lustro CPU materiału), orientacja startowa, holonomia.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKY_SCROLL, SKY_START, skyFocalPx, skyScreenSpeed, skyFineStarsGain, stepSkyFineGain, createSkyScroll, resetSkyScroll,
  stepSkyScroll, createSkyTrack, skyTrackStep, skyScrollMove, skyViewMatrix, skyWorldMatrix, quatToMat3, mat3AngleBetween,
  skyEquidistantDir, skyEquidistantPx, skyLayerSpeeds, skyDirFromLonLat, skyEquirectUvCpu, skyStartQuat
} from '../src/3d/skyScroll.js';
import { STAR_PARALLAX_LAYERS } from '../src/3d/starParallax.js';

const DEG = Math.PI / 180;
const mulV = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mulTV = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
const F1080 = skyFocalPx(1080);

// Kadry z raportu krytyka (opcje/krytyk/spojnosc.txt): zoom domyślny Atlasa 0,2133 (1080p), kadr skoku 0,2133 · 0,55.
const ZOOM_REF = 0.2133;
const ZOOM_JUMP = ZOOM_REF * 0.55;
export const SKY_MODES = Object.freeze([
  { name: 'walka', v: 507, zoom: ZOOM_REF },
  { name: 'walka z bliska (zoom 0,45)', v: 507, zoom: 0.45 },
  { name: 'dopalacz', v: 1137, zoom: ZOOM_REF },
  { name: 'hipercruise Mk I', v: 20000, zoom: ZOOM_JUMP },
  { name: 'hipercruise Mk III', v: 40000, zoom: ZOOM_JUMP },
  { name: 'warp Mk I', v: 100000, zoom: ZOOM_JUMP },
  { name: 'warp Mk II', v: 175000, zoom: ZOOM_JUMP },
  { name: 'warp Mk III', v: 250000, zoom: ZOOM_JUMP }
]);

test('f kamery z góry: 1080p ≈ 1712,7 px/rad (FOV 35°)', () => {
  assert.ok(Math.abs(F1080 - 1712.7) < 0.1, String(F1080));
});

test('W0: niebo = warstwa deep na sferze — tempo nieba < mid < speed GameStars we wszystkich trybach lotu (stałe paralaksy)', () => {
  // Pilnuje warstw GameStars (starParallax.js). Skały w warpie (zespół S, warpDebris.js: 621–1402 px/s przy 1080p) leżą
  // między mid i speed — ich tabela jest u zespołu S, tu tylko niebo względem gwiazd.
  const deep = STAR_PARALLAX_LAYERS.find((l) => l.name === 'deep');
  const mid = STAR_PARALLAX_LAYERS.find((l) => l.name === 'mid');
  // niebo zastępuje warstwę deep: p nieba nad jej zakresem (gwiazdy deep chowa tryb sfery), wyraźnie pod mid
  assert.ok(SKY_SCROLL.p >= deep.parallaxMax && SKY_SCROLL.p < mid.parallaxMin * 0.6, `p ${SKY_SCROLL.p}`);
  for (const m of SKY_MODES) {
    const s = skyLayerSpeeds(m.v, m.zoom);
    assert.ok(s.sky < s.mid[0], `${m.name}: niebo ${s.sky.toFixed(1)} < mid ${s.mid[0].toFixed(1)}`);
    assert.ok(s.mid[1] < s.speed[0], `${m.name}: mid < speed`);
  }
});

test('W0: rzut równoodległy — przy obrocie nieba brzeg kadru 32:9 nie płynie szybciej niż środek (lustro CPU materiału)', () => {
  // obrót o mały kąt wokół osi ⟂ do kursu (kurs w górę ekranu): przesunięcie piksela na środku i na brzegach 32:9
  const f = skyFocalPx(1440);
  const a = 1e-4;
  const shift = (px, py) => {
    const d = skyEquidistantDir(px, py, f, [0, 0, 0]);
    // obrót wokół osi x widoku o kąt a (niebo płynie w dół ekranu)
    const c = Math.cos(a), s = Math.sin(a);
    const r = [d[0], c * d[1] + s * d[2], -s * d[1] + c * d[2]];
    const p = [0, 0];
    skyEquidistantPx(r, f, p);
    return Math.hypot(p[0] - px, p[1] - py);
  };
  const center = shift(0, 0);
  assert.ok(Math.abs(center - a * f) / (a * f) < 1e-3, `środek ${center} ≈ a · f`);
  // w pionie (kierunek ruchu) brzeg = środek; w poziomie brzeg 32:9 (±64,2°) — nie szybciej niż środek
  for (const [x, y] of [[0, 719], [0, -719], [2559, 0], [-2559, 0], [2559, 719], [1200, -500]]) {
    const v = shift(x, y);
    assert.ok(v <= center * (1 + 1e-3), `(${x}, ${y}): ${v.toFixed(4)} vs środek ${center.toFixed(4)}`);
  }
  // dla porównania rzut gnomoniczny: brzeg 32:9 płynąłby ~(1 + tg²θ) razy szybciej (θ = atan(2560 / f_gnom))
  const th = Math.atan(2560 / f);
  assert.ok(1 + Math.tan(th) ** 2 > 2.2);
});

test('W0: liczby tempa nieba [px/s] — walka wyraźnie, hipercruise i warp ~50 px/s (sufit 14 tys. j/s)', () => {
  const t = Object.fromEntries(SKY_MODES.map((m) => [m.name, skyScreenSpeed(m.v, m.zoom)]));
  assert.ok(Math.abs(t.walka - 3.24) < 0.05, `walka ${t.walka}`);
  assert.ok(Math.abs(t['walka z bliska (zoom 0,45)'] - 6.84) < 0.05);
  for (const k of ['hipercruise Mk I', 'hipercruise Mk III', 'warp Mk I', 'warp Mk II', 'warp Mk III']) {
    assert.ok(Math.abs(t[k] - 49.27) < 0.05, `${k}: ${t[k]}`);
  }
  // próg gaśnięcia drobnych gwiazd w prędkości kątowej: 2 → 4 °/s ≈ 60 → 120 px CSS/s przy 1080p (59,8 → 119,6)
  assert.ok(Math.abs(SKY_SCROLL.fadeFromDeg * DEG * F1080 - 60) < 0.5 && Math.abs(SKY_SCROLL.fadeToDeg * DEG * F1080 - 120) < 1);
  assert.equal(skyFineStarsGain(t['warp Mk III'] / F1080), 1);
  assert.equal(skyFineStarsGain((SKY_SCROLL.fadeToDeg + 0.1) * DEG), 0);
  const mid = skyFineStarsGain((SKY_SCROLL.fadeFromDeg + SKY_SCROLL.fadeToDeg) / 2 * DEG);
  assert.ok(mid > 0.4 && mid < 0.6);
});

test('drobne gwiazdy: próg gaśnięcia nie zależy od rozdzielczości (1080p, 1440p, 4K) — warp pełny, koniec wyjścia ten sam', () => {
  // zoom kamery z góry ∝ wysokość CSS (0,2133 przy 1080p), f ∝ wysokość — prędkość kątowa nieba ta sama na każdym ekranie
  const dt = 1 / 120;
  const runOmega = (cssH, dpr, v, zoomRef) => {
    const s = createSkyScroll();
    const zoom = zoomRef * cssH / 1080 * dpr;   // px bufora na j.
    const f = skyFocalPx(cssH * dpr);
    for (let i = 0; i <= 3; i++) stepSkyScroll(s, v * i * dt, 0, v, dt, zoom, f, dpr);
    return s;
  };
  const gains = { warp: [], exit: [] };
  for (const [h, dpr] of [[1080, 1], [1440, 1], [2160, 1], [1440, 1.5], [900, 1]]) {
    const w = runOmega(h, dpr, 175000, ZOOM_JUMP);
    assert.ok(Math.abs(w.omega / DEG - 1.648) < 0.01, `warp ${h}p: ${(w.omega / DEG).toFixed(3)} °/s`);
    gains.warp.push(skyFineStarsGain(w.omega));
    // koniec ślizgu wyjścia z warpa: statek ≥ sufitu, zoom już bojowy
    const e = runOmega(h, dpr, 16200, ZOOM_REF);
    gains.exit.push(skyFineStarsGain(e.omega));
    // tempo w px CSS rośnie z wysokością okna (dawny próg w px CSS gasił gwiazdy na dużych ekranach)
    assert.ok(Math.abs(w.speedCss - 49.27 * h / 1080) < 0.1, `${h}p: ${w.speedCss}`);
  }
  for (const g of gains.warp) assert.equal(g, 1);
  for (const g of gains.exit) assert.ok(Math.abs(g - gains.exit[0]) < 1e-9, `wyjście: ${gains.exit}`);
  assert.ok(gains.exit[0] > 0.4 && gains.exit[0] < 0.6, `wyjście ${gains.exit[0]}`);
});

test('drobne gwiazdy: udział wygładzony w czasie — zryw 0,4 s przygasza łagodnie, pauza nie zmienia', () => {
  const s = createSkyScroll();
  assert.equal(s.fine, 1);
  const dt = 1 / 120;
  // 0,4 s nieba 3 °/s (koniec ślizgu wyjścia), potem spokój
  let minFine = 1;
  for (let i = 0; i < 48; i++) { s.omega = 3 * DEG; minFine = Math.min(minFine, stepSkyFineGain(s, dt)); }
  const target = skyFineStarsGain(3 * DEG);
  assert.ok(minFine > target + 0.1 && minFine < 0.9, `min ${minFine.toFixed(3)} (cel ${target.toFixed(3)})`);
  const before = s.fine;
  assert.equal(stepSkyFineGain(s, 0), before, 'pauza');
  for (let i = 0; i < 600; i++) { s.omega = 1.65 * DEG; stepSkyFineGain(s, dt); }
  assert.equal(s.fine, 1, 'wraca do pełna (dosunięcie przy różnicy < 1e-3)');
});

test('znak obrotu: statek leci w górę ekranu (−y gry) → niebo pod kamerą płynie w dół ekranu (paralaksa)', () => {
  const s = createSkyScroll();
  const dt = 1 / 60;
  stepSkyScroll(s, 0, 0, 500, dt, ZOOM_REF, F1080);
  const view = [0, 0, -1];
  const M0 = skyViewMatrix(s, 0, new Float64Array(9));
  const sky0 = mulV(M0, view);   // punkt nieba w środku kadru
  for (let i = 1; i <= 60; i++) stepSkyScroll(s, 0, -500 * i * dt, 500, dt, ZOOM_REF, F1080);
  // gdzie teraz na ekranie jest ten sam punkt nieba: widok = Mᵀ · niebo
  const M1 = skyViewMatrix(s, 0, new Float64Array(9));
  const v1 = mulTV(M1, sky0);
  const px = [0, 0];
  skyEquidistantPx(v1, F1080, px);
  const expect = skyScreenSpeed(500, ZOOM_REF);
  assert.ok(Math.abs(px[0]) < 1e-6, `bez ruchu w bok: ${px[0]}`);
  assert.ok(Math.abs(px[1] + expect) < 0.01, `w dół o ~${expect.toFixed(2)} px: ${px[1]}`);
  // lot w prawo (+x) → niebo w lewo
  const s2 = createSkyScroll();
  for (let i = 0; i <= 60; i++) stepSkyScroll(s2, 1000 * i * dt, 0, 1000, dt, ZOOM_REF, F1080);
  const v2 = mulTV(skyViewMatrix(s2, 0, new Float64Array(9)), mulV(skyViewMatrix(createSkyScroll(), 0, new Float64Array(9)), view));
  skyEquidistantPx(v2, F1080, px);
  assert.ok(px[0] < -6 && Math.abs(px[1]) < 1e-6, `w lewo: ${px}`);
});

test('obrót kadru: kurs w górę ekranu — niebo płynie od dziobu ku rufie (w dół ekranu) przy każdym kursie', () => {
  for (const heading of [0, 0.7, 2.2, -1.9]) {
    const s = createSkyScroll();
    const dt = 1 / 60;
    // roll kursu w górę (viewRoll.js: ekran = R(−roll)·świat, y gry w dół): kurs na ekranie w górę ⇔ roll = heading + π/2
    const roll = heading + Math.PI / 2;
    const vx = Math.cos(heading) * 1000, vy = Math.sin(heading) * 1000;
    stepSkyScroll(s, 0, 0, 1000, dt, ZOOM_REF, F1080);
    const sky0 = mulV(skyViewMatrix(s, roll, new Float64Array(9)), [0, 0, -1]);
    for (let i = 1; i <= 30; i++) stepSkyScroll(s, vx * i * dt, vy * i * dt, 1000, dt, ZOOM_REF, F1080);
    const px = [0, 0];
    skyEquidistantPx(mulTV(skyViewMatrix(s, roll, new Float64Array(9)), sky0), F1080, px);
    assert.ok(Math.abs(px[0]) < 1e-6 && px[1] < -1, `kurs ${heading}: ${px}`);
  }
});

test('sufit 14 tys. j/s i cięcie przy teleporcie: skok położenia nie obraca nieba', () => {
  const s = createSkyScroll();
  const dt = 1 / 60;
  stepSkyScroll(s, 0, 0, 175000, dt, ZOOM_JUMP, F1080);
  const a = stepSkyScroll(s, 175000 * dt, 0, 175000, dt, ZOOM_JUMP, F1080);
  assert.ok(Math.abs(a - SKY_SCROLL.vCap * dt * SKY_SCROLL.p * ZOOM_JUMP / F1080) < 1e-15, 'kąt z sufitu vCap');
  assert.ok(Math.abs(s.speedPx - 49.27) < 0.05);
  const q = Array.from(s.q);
  const cut = stepSkyScroll(s, 5e6, 0, 0, dt, ZOOM_REF, F1080);   // teleport (DevScene.teleport, odrodzenie)
  assert.equal(cut, 0);
  assert.equal(s.cuts, 1);
  assert.deepEqual(Array.from(s.q), q);
  // pauza (dt = 0) i postój: bez obrotu
  assert.equal(stepSkyScroll(s, 5e6 + 100, 0, 500, 0, ZOOM_REF, F1080), 0);
  assert.equal(stepSkyScroll(s, 5e6 + 100, 0, 0, dt, ZOOM_REF, F1080), 0);
  // nagłe hamowanie (wyjście z warpa przez hamowanie grawitacyjne): droga klatki ≤ 4 · prędkość poprzedniej — bez cięcia
  const s2 = createSkyScroll();
  stepSkyScroll(s2, 0, 0, 100000, dt, ZOOM_JUMP, F1080);
  stepSkyScroll(s2, 100000 * dt, 0, 0, dt, ZOOM_JUMP, F1080);
  assert.equal(s2.cuts, 0);
});

test('rzut równoodległy: piksel ↔ kierunek (lustro materiału), tempo brzegu = środka w kierunku promieniowym', () => {
  const f = skyFocalPx(1440);
  const d = [0, 0, 0];
  const p = [0, 0];
  for (const [x, y] of [[0, 0], [1, 0], [-2559.5, 719.5], [2559.5, -719.5], [300, 200]]) {
    skyEquidistantDir(x, y, f, d);
    assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-12);
    skyEquidistantPx(d, f, p);
    assert.ok(Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - y) < 1e-6, `${x},${y} → ${p}`);
  }
  // 32:9 (5120 × 1440): brzeg poziomy 2560 / f = 1,121 rad ≈ 64,2° od osi widoku
  skyEquidistantDir(2560, 0, f, d);
  assert.ok(Math.abs(Math.acos(-d[2]) - 2560 / f) < 1e-12);
  assert.ok(Math.abs(Math.acos(-d[2]) / DEG - 64.2) < 0.05);
});

test('orientacja startowa: środek kadru patrzy w (λ0, φ0), pas (∂λ) pod kątem bandDeg na ekranie', () => {
  const s = createSkyScroll();
  const M = skyViewMatrix(s, 0, new Float64Array(9));
  const c = mulV(M, [0, 0, -1]);
  const want = skyDirFromLonLat(SKY_START.lonDeg * DEG, SKY_START.latDeg * DEG, [0, 0, 0]);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(c[i] - want[i]) < 1e-12);
  // kierunek pasa w osiach widoku
  const lon = SKY_START.lonDeg * DEG;
  const east = mulTV(M, [-Math.sin(lon), Math.cos(lon), 0]);
  const ang = Math.atan2(east[1], east[0]) / DEG;
  assert.ok(Math.abs(ang - SKY_START.bandDeg) < 1e-9, String(ang));
  // uv środka kadru
  const uv = skyEquirectUvCpu(c, [0, 0]);
  assert.ok(Math.abs(uv[0] - (SKY_START.lonDeg / 360 + 0.5)) < 1e-12 && Math.abs(uv[1] - (0.5 - SKY_START.latDeg / 180)) < 1e-12);
  // reset po obrocie wraca do startu
  stepSkyScroll(s, 0, 0, 500, 1 / 60, ZOOM_REF, F1080);
  stepSkyScroll(s, 500, 0, 500, 1, ZOOM_REF, F1080);
  resetSkyScroll(s);
  assert.deepEqual(Array.from(s.q), Array.from(skyStartQuat(new Float64Array(4))));
  assert.equal(s.track.has, false);
  assert.equal(s.fine, 1);
});

test('tropiciel drogi: cięcie per okręt, mieszanie dróg dwóch okrętów wagą (fregata zwiadu przy sterach)', () => {
  const dt = 1 / 60;
  const out = [0, 0];
  const tr = createSkyTrack();
  assert.equal(skyTrackStep(tr, 100, 200, 500, dt, out), 0, 'pierwsza klatka');
  assert.ok(Math.abs(skyTrackStep(tr, 108, 194, 600, dt, out) - 10) < 1e-12);
  assert.deepEqual(out, [8, -6]);
  assert.equal(skyTrackStep(tr, 9e6, 0, 600, dt, out), 0, 'teleport');
  assert.equal(tr.cuts, 1);
  assert.deepEqual(out, [0, 0]);
  assert.equal(skyTrackStep(tr, NaN, 0, 0, dt, out), 0);
  assert.equal(tr.has, false, 'poza niepoliczalna — zapomniane miejsce');
  // waga 1: niebo jedzie z drogi fregaty, Atlas stoi; waga 0,5 — połowa każdej drogi
  const fr = createSkyTrack(), at = createSkyTrack();
  const sA = createSkyScroll(), sB = createSkyScroll();
  const a = [0, 0], b = [0, 0];
  for (let i = 0; i <= 60; i++) {
    skyTrackStep(at, 0, 0, 0, dt, a);                        // Atlas stoi
    skyTrackStep(fr, 900 * i * dt, 3e4, 900, dt, b);        // fregata 900 j/s w prawo, 30 tys. j. od Atlasa
    skyScrollMove(sA, a[0] * 0 + b[0] * 1, a[1] * 0 + b[1] * 1, dt, ZOOM_REF, F1080);
    skyScrollMove(sB, a[0] * 0.5 + b[0] * 0.5, a[1] * 0.5 + b[1] * 0.5, dt, ZOOM_REF, F1080);
  }
  const want = 900 * SKY_SCROLL.p * ZOOM_REF / F1080;   // rad/s
  assert.ok(Math.abs(sA.turned - want) / want < 1e-9, `${sA.turned} vs ${want}`);
  assert.ok(Math.abs(sB.turned - want / 2) / want < 1e-9);
  assert.ok(Math.abs(sA.omega - want) / want < 1e-9);
});

test('macierze: widok → niebo ortonormalna, świat → niebo = transpozycja q, kąt między macierzami', () => {
  const s = createSkyScroll();
  for (let i = 0; i < 400; i++) stepSkyScroll(s, Math.cos(i * 0.05) * 30000, Math.sin(i * 0.03) * 20000, 3000, 1 / 60, 0.3, F1080);
  const M = skyViewMatrix(s, 0.4, new Float64Array(9));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += M[i * 3 + k] * M[j * 3 + k];
      assert.ok(Math.abs(dot - (i === j ? 1 : 0)) < 1e-9);
    }
  }
  const W = skyWorldMatrix(s, new Float64Array(9));
  const Q = quatToMat3(s.q, new Float64Array(9));
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) assert.ok(Math.abs(W[i * 3 + k] - Q[k * 3 + i]) < 1e-15);
  // roll 0: widok = świat
  const M0 = skyViewMatrix(s, 0, new Float64Array(9));
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(M0[i] - W[i]) < 1e-15);
  // kąt: mały obrót mierzony bez utraty precyzji
  const s2 = createSkyScroll();
  const A = skyViewMatrix(s2, 0, new Float64Array(9));
  stepSkyScroll(s2, 0, 0, 500, 1 / 240, ZOOM_REF, F1080);
  stepSkyScroll(s2, 500 / 240, 0, 500, 1 / 240, ZOOM_REF, F1080);
  const B = skyViewMatrix(s2, 0, new Float64Array(9));
  const want = (500 / 240) * SKY_SCROLL.p * ZOOM_REF / F1080;
  assert.ok(Math.abs(mat3AngleBetween(A, B) - want) / want < 1e-6, `${mat3AngleBetween(A, B)} vs ${want}`);
});

test('holonomia: krążenie w bitwie obraca niebo wokół osi widoku o ułamek stopnia — w ruchu niewidoczne', () => {
  const s = createSkyScroll();
  const M0 = skyViewMatrix(s, 0, new Float64Array(9));
  const r = 20000, v = 507, dt = 1 / 60;
  const T = 2 * Math.PI * r / v;
  const n = Math.round(T / dt);
  for (let i = 0; i <= n; i++) {
    const a = 2 * Math.PI * i / n;
    stepSkyScroll(s, r * Math.cos(a), r * Math.sin(a), v, dt, ZOOM_REF, F1080);
  }
  const M1 = skyViewMatrix(s, 0, new Float64Array(9));
  const deg = mat3AngleBetween(M0, M1) / DEG;
  assert.ok(deg < 2, `krąg r 20 tys.: ${deg.toFixed(2)}°`);
});

test('bez alokacji w kroku: stan w Float64Array, krok i macierze piszą w miejscu', () => {
  const s = createSkyScroll();
  const out = new Float64Array(9);
  const q = s.q;
  stepSkyScroll(s, 0, 0, 500, 1 / 60, 0.3, F1080);
  stepSkyScroll(s, 10, 3, 500, 1 / 60, 0.3, F1080);
  stepSkyFineGain(s, 1 / 60);
  assert.equal(s.q, q);
  assert.equal(skyViewMatrix(s, 0.2, out), out);
});
