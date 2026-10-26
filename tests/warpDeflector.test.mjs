// DEFLEKTOR W SKOKU GRACZA (src/3d/asteroids/warpDeflector.js; DECYZJE-2 S3, 2026-10-26 — user: „odpychanie skał,
// »tarcza« grawitacyjna ze Star Trek”): opływ wokół elipsy przed dziobem w przestrzeni pozornej skał, płynnie (bez
// przeskoku), skała na kursie zjeżdża na bok, za rufą wraca; tylko pasma bliskie (głębia), tylko warp gracza
// (soczewka aktywna), A/B z adresu; ujawnienie pola: krótki łuk na elipsie (nie okrąg), fala refrakcji z dala od kadłuba.
// node --test tests/warpDeflector.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WarpDeflector, WARP_DEFLECTOR, deflectorStreamY, deflectorY, warpDeflectorOn, setWarpDeflector
} from '../src/3d/asteroids/warpDeflector.js';
import { WarpDebris } from '../src/3d/asteroids/warpDebris.js';

const ZOOM = 0.1173;
const HULL_L = 1800;
const HULL_W = 400;
function lensAt(shipY = 2500, beta = 1) {
  // kurs w górę ekranu = −y gry; statek 2500 j. „za” kamerą (kotwica w dolnej części kadru)
  return { active: true, beta, velAngle: -Math.PI / 2, shipX: 0, shipY, hullHalfLen: HULL_L / 2 * ZOOM, hullHalfWid: HULL_W / 2 * ZOOM, zoom: ZOOM };
}
function ready(lens = lensAt()) {
  const D = new WarpDeflector();
  for (let i = 0; i < 180; i++) D.frame(1 / 60, lens, 0, 0, true);
  return D;
}

test('linia prądu opływu koła: ψ = Y (1 − 1/ρ²) = T, rozwiązanie zewnętrzne, daleko Y → T', () => {
  for (const X of [-6, -2, -1, -0.5, 0, 0.3, 0.9, 1.5, 4]) {
    for (const T of [0.05, 0.3, 1, 2.5]) {
      const Y = deflectorStreamY(X, T);
      const r2 = X * X + Y * Y;
      assert.ok(r2 >= 1 - 1e-9, `na zewnątrz koła (X ${X}, T ${T})`);
      assert.ok(Math.abs(Y - Y / r2 - T) < 1e-6, `ψ = T (X ${X}, T ${T}): ${Y - Y / r2}`);
      assert.ok(Y >= T, 'odepchnięcie na zewnątrz');
    }
  }
  assert.ok(Math.abs(deflectorStreamY(0, 0) - 1) < 1e-12, 'oś przy środku: brzeg koła');
  assert.equal(deflectorStreamY(3, 0), 0, 'oś daleko: bez odepchnięcia');
  assert.ok(deflectorStreamY(40, 1) - 1 < 1e-3, 'daleko przed polem: Y∞');
  // Poza zasięgiem pola — bez zmian (dokładnie).
  assert.equal(deflectorY(8, 0.5, 1), 0.5);
  assert.equal(deflectorY(0, 7.5, 1), 7.5);
});

test('pole z soczewki skoku: elipsa przed dziobem (1–2 długości kadłuba), siła narasta z β, gaśnie poza skokiem', () => {
  const D = ready();
  const L = HULL_L;
  assert.ok(Math.abs(D.A - WARP_DEFLECTOR.halfLen * L) < 1e-6 && Math.abs(D.B - WARP_DEFLECTOR.halfWide * L) < 1e-6);
  const front = D.fu + D.A - D.su;
  assert.ok(front > L && front < 2.5 * L, `przód pola ${(front / L).toFixed(2)} L przed środkiem statku`);
  assert.ok(D.strength > 0.99 && D.on);
  // hipercruise / brak soczewki / A/B wyłączony — pole gaśnie (płynnie)
  D.frame(1 / 60, null, 0, 0, true);
  assert.ok(D.strength < 0.99 && D.strength > 0.9, 'gaśnie płynnie');
  for (let i = 0; i < 240; i++) D.frame(1 / 60, lensAt(), 0, 0, false);
  assert.equal(D.on, false, 'zgasło (gaśnięcie fall 0,6 s — wolniej niż narastanie)');
  const out = {};
  D.deflect(1000, 0, 0.95, 0.05, 1, out);
  assert.equal(out.w, 0, 'bez pola — bez zmian');
});

test('opływ: skała na kursie zjeżdża płynnie na bok (bez przeskoku), mija kadłub z zapasem, za rufą wraca na swój tor', () => {
  const D = ready();
  const out = {};
  const S = 14000;
  for (const zk of [0.05, 0.2]) {
    const k = 1 / (1 + zk);
    for (const w0 of [0, 150, 500, 1200]) {
      for (const side of [-1, 1]) {
        let u = 45000;
        let prevW = NaN;
        let maxStepPx = 0;
        let minClear = Infinity;
        let wEnd = NaN;
        while (u > -45000) {
          D.deflect(u, w0 * side, k, zk, side, out);
          const au = k * u - D.su;
          const aw = k * out.w - D.sw;
          // obrys kadłuba (elipsa półosi L/2, W/2) — skała na ekranie poza nim
          const e = Math.sqrt((au / (HULL_L / 2)) ** 2 + (aw / (HULL_W / 2)) ** 2);
          minClear = Math.min(minClear, e);
          if (Number.isFinite(prevW)) maxStepPx = Math.max(maxStepPx, Math.abs(k * (out.w - prevW)) * ZOOM);
          prevW = out.w;
          wEnd = out.w;
          u -= S / 60;
        }
        const fwdPx = S / 60 * k * ZOOM;
        assert.ok(maxStepPx < fwdPx * 0.4, `zk ${zk} w ${w0 * side}: krok w poprzek ${maxStepPx.toFixed(2)} px/kl. (wzdłuż ${fwdPx.toFixed(1)})`);
        assert.ok(minClear > 2.5, `zk ${zk} w ${w0 * side}: odstęp od obrysu kadłuba ${minClear.toFixed(2)}`);
        assert.ok(Math.abs(wEnd - w0 * side) < 1e-6, 'za rufą na swoim torze');
      }
    }
  }
  // Skała dokładnie na kursie: strona ze znaku `side` (połowa w lewo, połowa w prawo).
  D.deflect(0, 0, 0.95, 0.05, -1, out);
  const left = out.w;
  D.deflect(0, 0, 0.95, 0.05, 1, out);
  assert.ok(left < 0 && out.w > 0 && Math.abs(left + out.w) < 1e-6);
});

test('kołysanie kamery: skała przy osi nie przeskakuje na drugą burtę (strona zamknięta w strefie podłogi)', () => {
  const out = {};
  const S = 14000;
  const k = 0.95; const zk = 1 / k - 1;
  for (const w0 of [-40, -5, 0, 5, 40]) {
    const D = ready();
    let side = w0 < 0 ? -1 : 1;
    let u = 45000;
    let prevW = NaN;
    let maxStepPx = 0;
    for (let f = 0; u > -45000; f++) {
      // statek kołysze się w poprzek kursu ±60 j. (sprężyna riga, wstrząs) — Y∞ skały przy osi zmienia znak
      const lens = lensAt();
      lens.shipX = 60 * Math.sin(f * 0.35);
      D.frame(1 / 60, lens, 0, 0, true);
      D.deflect(u, w0, k, zk, side, out);
      side = out.side;
      if (Number.isFinite(prevW)) maxStepPx = Math.max(maxStepPx, Math.abs(k * (out.w - prevW)) * ZOOM);
      prevW = out.w;
      u -= S / 60;
    }
    assert.ok(maxStepPx < 12, `w0 ${w0}: krok w poprzek ${maxStepPx.toFixed(2)} px/kl. (przerzucenie burty = ~${(2 * WARP_DEFLECTOR.floor * 990 * k * ZOOM).toFixed(0)} px)`);
  }
});

// Warstwa skał w skoku z atrapami rysowania (pole pasa wszędzie o zadanej gęstości) — przelot kursem w górę z kołysaniem.
function debrisRig(density = 0.3) {
  const set = { group: {}, enabled: false, lodExtra: 0, setVisible(v) { this.enabled = !!v; }, set() {}, setOrigin() {}, update() {} };
  const uni = () => ({ value: 0 });
  const material = { smear: { vec: { value: { set() {} } }, taper: uni(), tail: uni(), fade: uni(), blur: uni(), sunMix: uni(), gain: uni() } };
  const trails = { stats: { trails: 0, glints: 0 }, begin() {}, addTrail() { return true; }, addGlint() { return true; }, commit() {}, hide() {}, setLook() {} };
  const deb = new WarpDebris({ material, field: { sampleMacro: () => ({ weight: 1, density, gap: 1, hole: 1 }), maxDensity: 1 }, set, trails });
  const f = { dt: 1 / 60, camX: 0, camY: 0, originX: 0, originY: 0, frame: { cam: { zoom: ZOOM }, viewW: 1920, viewH: 1080, focalPx: 1712.7 }, camSpeed: 125000, flowCap: 14000, stretch: 1, lens: null, deflect: true };
  return { deb, f };
}
function flyThrough(deb, f, frames, betaAt, hullL = HULL_L, onFrame = null) {
  const prev = new Map();
  let maxStep = 0;
  let wrongSide = 0;
  for (let i = 0; i < frames; i++) {
    f.camY -= f.camSpeed / 60;
    f.lens = { active: true, beta: betaAt(i), velAngle: -Math.PI / 2, shipX: f.camX + 60 * Math.sin(i * 0.35), shipY: f.camY + 2500, hullHalfLen: hullL / 2 * ZOOM, hullHalfWid: HULL_W / 2 * ZOOM, zoom: ZOOM };
    deb.update(f);
    const D = deb.deflector;
    for (const r of deb.rocks) {
      if (!r.alive) { prev.delete(r); continue; }
      const k = 1 / (1 + r.zk);
      const across = (r.x - f.camX) * k * ZOOM;   // kurs w górę: w poprzek = x ekranu
      const p = prev.get(r);
      if (p !== undefined && r.age > 0.3 && !r.dying) maxStep = Math.max(maxStep, Math.abs(across - p));
      prev.set(r, across);
      // skała w zasięgu pola po złej burcie (daleko od osi, strona przeciwna do Y∞) — dawna losowa strona
      if (D.on && r.side !== 0) {
        const Yinf = (k * r.w - D.fw) / D.B;
        if (Math.abs(Yinf) > 1 && Math.sign(Yinf) !== r.side) wrongSide++;
      }
    }
    if (onFrame) onFrame(i, deb);
  }
  return { maxStep, wrongSide };
}

test('strona skały: pole włączane przy skałach w pudle i przełączane (klawisz G) — skała po swojej burcie, bez przeskoku', () => {
  // Recenzja S (2026-10-26): losowa strona z narodzin + zamek tylko w strefie podłogi — skała zastana przy włączeniu
  // pola stała po złej burcie (Y∞ −3 rysowane na +1,2), za rufą wracała skokiem 3–4 B (~350–400 px/kl.).
  for (const [label, betaAt] of [
    ['pole od startu', () => 1],
    ['pole po 3 s', (i) => (i < 180 ? 0 : 1)],
    ['G co 2 s', (i) => (Math.floor(i / 120) % 2 ? 1 : 0)],
    ['G co 0,5 s', (i) => (Math.floor(i / 30) % 2 ? 1 : 0)]
  ]) {
    const { deb, f } = debrisRig();
    const { maxStep, wrongSide } = flyThrough(deb, f, 600, betaAt);
    // ruch przy brzegu pola ~7–8 px/kl. + gaśnięcie pola przy G (fall) — dawniej przeskok strony 26 px/kl. w kadrze, 350–400 poza
    assert.ok(maxStep < 13, `${label}: największy krok w poprzek ${maxStep.toFixed(1)} px/kl. (wszystkie skały, także poza kadrem)`);
    assert.equal(wrongSide, 0, `${label}: skały po złej burcie`);
  }
  // Pole zgaszone — strona nieustalona (0); nowa skała zaczyna od 0.
  const { deb, f } = debrisRig();
  flyThrough(deb, f, 60, () => 1);
  for (let i = 0; i < 240; i++) { f.camY -= 125000 / 60; f.lens = { ...f.lens, beta: 0, shipY: f.camY + 2500 }; deb.update(f); }
  assert.equal(deb.deflector.on, false);
  assert.ok(deb.rocks.every((r) => !r.alive || r.side === 0), 'bez pola strona nieustalona');
});

test('ujawnienie pola rzadko: łuki ≤ ~2,5 na sekundę także w rdzeniu pola rodziny, najwyżej 2 naraz, krótkie (nie obrys przodu)', () => {
  // Recenzja S (2026-10-26): 6 naraz co 0,09 s po ±0,42 rad — 3–5,6 łuku/s, średnio 18–31% przodu elipsy, w szczycie ~60%.
  const C = WARP_DEFLECTOR;
  for (const density of [0, 1]) {
    const { deb, f } = debrisRig(density);
    let total0 = 0;
    let frames = 0;
    let lit = 0;
    let maxLit = 0;
    flyThrough(deb, f, 60 * 12, () => 1, HULL_L, (i, d) => {
      const D = d.deflector;
      if (i === 120) total0 = D.stats.total;
      if (i < 120) return;
      frames++;
      let n = 0;
      for (const g of D.glints) if (g.alive && D.glintEnvelope(g.age) > 0.15) n++;
      lit += n;
      maxLit = Math.max(maxLit, n);
    });
    const perSec = (deb.deflector.stats.total - total0) / (frames / 60);
    assert.ok(perSec > 0.5 && perSec <= 2.6, `gęstość ${density}: ${perSec.toFixed(2)} łuku/s`);
    assert.ok(maxLit <= C.glintCap && C.glintCap <= 2, `naraz ${maxLit}`);
    assert.ok(lit / frames < 0.8, `świecących naraz średnio ${(lit / frames).toFixed(2)}`);
  }
  // Łuk: najwyżej ±0,2 rad elipsy (cięciwa ≤ ~0,4 B przy największej skale efektu 1,4 — kreska, nie kawałek obrysu).
  assert.ok(C.glintArc <= 0.2 && C.glintArc * 1.4 * 2 <= 0.6);
});

test('głębia: pasmo bliskie odpychane w pełni, środkowe częściowo, dalekie przepływa pod statkiem', () => {
  const D = ready();
  const out = {};
  const push = (zk) => {
    let m = 0;
    for (let u = 20000; u > -20000; u -= 200) { const k = 1 / (1 + zk); D.deflect(u, 0, k, zk, 1, out); m = Math.max(m, Math.abs(out.w) * k); }
    return m;
  };
  const near = push(0.1);
  const mid = push(0.5);
  const far = push(1.2);
  assert.ok(near > D.B * 1.1, `bliskie ${near.toFixed(0)}`);
  assert.ok(mid > near * 0.3 && mid < near * 0.95, `środkowe ${mid.toFixed(0)}`);
  assert.equal(far, 0, 'dalekie bez pola');
});

test('nachylenie drogi (kierunek śladu) = różniczka toru: ślad za skałą idzie wzdłuż jej drogi', () => {
  const D = ready();
  const a = {}; const b = {};
  const k = 0.95; const zk = 1 / k - 1;
  for (const u of [12000, 6000, 3000, 0, -3000]) {
    D.deflect(u, 300, k, zk, 1, a);
    D.deflect(u + 10, 300, k, zk, 1, b);
    const num = (b.w - a.w) / 10;
    assert.ok(Math.abs(num - a.slope) < 0.02 + Math.abs(num) * 0.05, `u ${u}: ${a.slope.toFixed(4)} ≈ ${num.toFixed(4)}`);
  }
});

test('ujawnienie pola: łuk raz na skałę, tylko przód pola, krótki (nie okrąg), z limitem naraz; fala z dala od kadłuba', () => {
  const D = ready();
  const out = {};
  const C = WARP_DEFLECTOR;
  const k = 0.95; const zk = 1 / k - 1;
  let made = 0;
  const rocks = [];
  for (let i = 0; i < 40; i++) rocks.push({ hit: false, w: (i - 20) * 30 });
  for (let f = 0; f < 240; f++) {
    D.frame(1 / 60, lensAt(), 0, 0, true);
    const u = 30000 - f * 200;
    for (const r of rocks) {
      D.deflect(u, r.w, k, zk, 1, out);
      if (D.touch(r, out, k, zk * 14600, 1)) {
        made++;
        // fala ma miejsce i promień już w klatce narodzin (pas zgłasza ją zaraz po update)
        const born = D.ripples.find((x) => x.alive && x.age === 0);
        if (born) assert.ok(born.r > 0 && born.amp > 0 && Number.isFinite(born.x) && Math.abs(born.y) > 0, 'fala w klatce narodzin');
        assert.ok(D.stats.ripples >= 1, 'licznik fal tej klatki');
      }
    }
    let alive = 0;
    for (const g of D.glints) if (g.alive) alive++;
    assert.ok(alive <= C.glintCap);
    const geo = {};
    for (const g of D.glints) {
      if (!g.alive) continue;
      assert.ok(Math.abs(g.th) <= C.glintMaxDeg * Math.PI / 180 + 1e-9, 'przód pola');
      D.glintGeometry(g, geo);
      // łuk: krótki odcinek (cięciwa ≤ 2 · glintArc · B), cienki, jasność ≥ 0, strzałka na zewnątrz
      assert.ok(geo.half * k <= C.glintArc * D.B * 1.4 + 1e-6, 'krótki łuk');
      assert.ok(geo.halfW * k < 0.05 * D.B, 'cienki');
      assert.ok(geo.I >= 0 && geo.I <= C.glintGain + 1e-9);
      assert.ok(geo.sag >= 0 && geo.sag <= geo.half * 0.5 + 1e-9);
    }
    for (const r of D.ripples) {
      if (!r.alive) continue;
      // zasięg fali (front + 3,2 grubości) nie dochodzi do obrysu kadłuba
      const du = (r.x - 0) * D.dirX + (r.y - 0) * D.dirY - D.su;
      const dw = -(r.x - 0) * D.dirY + (r.y - 0) * D.dirX - D.sw;
      const gap = Math.sqrt(du * du + dw * dw) - HULL_L / 2;
      assert.ok(r.r + C.rippleReach * r.w <= gap * C.rippleHullGap + 1e-6, 'fala nie dotyka kadłuba');
      assert.ok(r.amp >= 0 && r.amp <= C.rippleStrength * 1.4 + 1e-9);
    }
  }
  assert.ok(made >= 1 && made <= 40, `łuków ${made}`);
  assert.ok(rocks.filter((r) => r.hit).length >= made, 'raz na skałę');
  // Łuk rozbłyska i gaśnie (obwiednia): zero na starcie, szczyt po narastaniu, zero na końcu życia.
  assert.equal(D.glintEnvelope(0), 0);
  assert.ok(D.glintEnvelope(C.glintRise) > 0.9);
  assert.ok(D.glintEnvelope(C.glintLife) < 1e-9);
});

test('A/B z adresu: ?deflektor=0 wyłącza (gra i worker czytają adres strony), wymuszenie dla dema i testów', () => {
  assert.equal(warpDeflectorOn(''), true);
  assert.equal(warpDeflectorOn('?dev&deflektor=0'), false);
  assert.equal(warpDeflectorOn('?deflektor=1'), true);
  setWarpDeflector(false);
  assert.equal(warpDeflectorOn(''), false);
  setWarpDeflector(null);
  assert.equal(warpDeflectorOn(''), true);
});
