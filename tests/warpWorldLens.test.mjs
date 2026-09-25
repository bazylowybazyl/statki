import test from 'node:test';
import assert from 'node:assert/strict';

// Soczewka świata (widok skoku, docs/BRIEF-warp.md §4.3): odwzorowanie ciał
// z odległości od statku. Pilnujemy: β = 0 to zwykły widok (bez skoku przy
// wejściu), przy β = 1 świat mieści się w kropli, tarcza nigdy nie wjeżdża pod
// statek (user: „spadasz na Jowisza”), cel przed dziobem wisi wysoko, mijane
// ciało rośnie mocniej, aberracja ściąga kierunki ku przodowi, nie zmieniając strony.

globalThis.window = globalThis.window || {};
const {
  mapWorldLens, aberrateAngle, flowAroundBall, sweepBeta, solveSweepBodyBeta, warpHorizonPx,
  WORLD_LENS_DEFAULTS, WARP_VIEW_DEFAULTS
} = await import('../src/3d/warpWorldLens.js');
const { warpDropGeometry, warpDropExit } = await import('../src/3d/warpLens3D.js');
const { readFileSync } = await import('node:fs');

const P = WORLD_LENS_DEFAULTS;
const V = WARP_VIEW_DEFAULTS;
const DROP = warpDropGeometry(V.dropFront, V.dropBack, V.dropBulb, V.dropTail);
const base = {
  zoom: 0.1, horizonPx: 400, drop: DROP,
  lengthScale: P.lengthScale, lengthFront: P.lengthFront, frontCone: P.frontCone,
  sizeK: P.sizeK, sizeD0: P.sizeD0, passBoost: P.passBoost, passScale: P.passScale,
  gapPx: 24, hullHalfLen: 100, hullHalfWid: 45,
  velAngle: 0, aberration: 0, sizeBoost: 1
};
// Odstęp kadłuba w kierunku kąta a od osi lotu (jak w mapWorldLens).
const marginAt = (a) => 24 + Math.abs(Math.cos(a)) * 100 + Math.abs(Math.sin(a)) * 45;

test('β = 0: zwykły widok — ortho i perspektywa (flatScale)', () => {
  const out = {};
  mapWorldLens(3000, -4000, 900, { ...base, beta: 0 }, out);
  assert.equal(out.x, 300);
  assert.equal(out.y, -400);
  assert.ok(Math.abs(out.size - 90) < 1e-9);
  mapWorldLens(3000, -4000, 900, { ...base, beta: 0, flatScale: 0.02 }, out);
  assert.ok(Math.abs(out.x - 60) < 1e-9 && Math.abs(out.size - 18) < 1e-9, 'ciało w passie perspektywicznym');
  // Ciągłość: odrobina β prawie nic nie zmienia.
  const a = mapWorldLens(3e5, 1e5, 9000, { ...base, beta: 0, flatScale: 0.02 }, {});
  const b = mapWorldLens(3e5, 1e5, 9000, { ...base, beta: 0.003, flatScale: 0.02 }, {});
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) / Math.hypot(a.x, a.y) < 0.03);
  assert.ok(Math.abs(a.size - b.size) / a.size < 0.03);
});

test('kropla: brzeg z geometrii (czoło, ogon, bok), dla ua = ub = 0 koło; brzeg leży na otoczce kół', () => {
  const g = warpDropGeometry(1.05, 1.05, 0.8, 0.07);
  assert.ok(Math.abs(warpDropExit(1, 0, g) - 1.05) < 1e-9, 'czoło bańki');
  assert.ok(Math.abs(warpDropExit(-1, 0, g) - 1.05) < 1e-9, 'czubek ogona');
  assert.ok(Math.abs(warpDropExit(0, 1, g) - Math.sqrt(0.8 * 0.8 - 0.25 * 0.25)) < 1e-9, 'bok przy statku — łuk bańki');
  const circle = warpDropGeometry(1, 1, 1, 1);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    assert.ok(Math.abs(warpDropExit(Math.cos(a), Math.sin(a), circle) - 1) < 1e-9);
  }
  // Pole odległości otoczki dwóch kół (bańka i ogon): brzeg = 0, tuż przed nim < 0.
  const sd = (px, py) => {
    const h = g.ua - g.ub;
    const x = px - g.ub;
    const y = Math.abs(py);
    const b = (g.rb - g.ra) / h;
    const a = Math.sqrt(1 - b * b);
    const k = -b * y + a * x;
    if (k < 0) return Math.hypot(y, x) - g.rb;
    if (k > a * h) return Math.hypot(y, x - h) - g.ra;
    return y * a + x * b - g.rb;
  };
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * Math.PI * 2;
    const t = warpDropExit(Math.cos(a), Math.sin(a), g);
    assert.ok(Math.abs(sd(Math.cos(a) * t, Math.sin(a) * t)) < 1e-9, `kąt ${a}`);
    assert.ok(sd(Math.cos(a) * t * 0.99, Math.sin(a) * t * 0.99) < 0);
  }
});

test('promień kuli: kropla sięga krawędzi kadru wzdłuż osi lotu, lot w bok ograniczony wysokością', () => {
  const up = warpHorizonPx(1600, 900, -Math.PI / 2);
  assert.ok(Math.abs(up * V.dropFront - P.axisFill * 450) < 1e-6);
  assert.ok(Math.abs(warpHorizonPx(1600, 900, 0) - P.horizonMax * 900) < 1e-6);
});

test('β = 1: tarcza nigdy nie wjeżdża pod statek, daleko = brzeg kropli, bliżej = większe', () => {
  const o = {};
  for (const a of [0, 0.4, 1.2, Math.PI / 2, 2.2, 2.9, Math.PI, -0.7, -1.9]) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let prevGap = -Infinity;
    let prevSize = Infinity;
    for (const d of [5e3, 2e4, 4e4, 1e5, 3e5, 1e6, 5e6, 1e8]) {
      for (const r of [0, 5000, 25000, 60000]) {
        mapWorldLens(ca * d, sa * d, r, { ...base, beta: 1 }, o);
        const rho = Math.hypot(o.x, o.y);
        assert.ok(rho - o.size >= marginAt(a) - 1e-6, `kąt ${a}, d ${d}, r ${r}: krawędź ${rho - o.size} przy kadłubie`);
        assert.ok(o.x * ca + o.y * sa > 0, 'ciało zostaje po swojej stronie');
      }
      if (d <= 20000) continue; // statek nad tarczą (d < r): odstęp = sam margines
      mapWorldLens(ca * d, sa * d, 20000, { ...base, beta: 1 }, o);
      assert.ok(o.gap > prevGap, 'odstęp rośnie z odległością');
      assert.ok(o.size < prevSize, 'wielkość maleje z odległością');
      prevGap = o.gap;
      prevSize = o.size;
    }
    // Nieskończoność na brzegu kropli.
    mapWorldLens(ca * 1e12, sa * 1e12, 1, { ...base, beta: 1 }, o);
    const edge = warpDropExit(ca, sa, DROP) * 400;
    assert.ok(Math.abs(Math.hypot(o.x, o.y) - edge) < edge * 0.01, `kąt ${a}: ${Math.hypot(o.x, o.y)} vs brzeg ${edge}`);
  }
});

test('cel przed dziobem wisi wysoko, mijane ciało z boku rośnie mocniej', () => {
  const ahead = mapWorldLens(130000, 0, 30000, { ...base, beta: 1 }, {});
  const side = mapWorldLens(0, 130000, 30000, { ...base, beta: 1 }, {});
  const edgeF = warpDropExit(1, 0, DROP) * 400;
  const edgeS = warpDropExit(0, 1, DROP) * 400;
  const fracF = (ahead.gap - marginAt(0)) / (edgeF - marginAt(0));
  const fracS = (side.gap - marginAt(Math.PI / 2)) / (edgeS - marginAt(Math.PI / 2));
  assert.ok(fracF > 0.65, `cel 100 tys. j. od powierzchni: ${fracF.toFixed(2)} drogi do brzegu`);
  assert.ok(fracF > fracS + 0.25, 'przed dziobem krótsza skala niż z boku');
  // Mijanie w 70 tys. j.: z boku większe niż ta sama planeta przed dziobem.
  const passSide = mapWorldLens(0, 70000, 30000, { ...base, beta: 1 }, {});
  const passAhead = mapWorldLens(70000, 0, 30000, { ...base, beta: 1 }, {});
  assert.ok(passSide.size > passAhead.size * 1.5, `${passSide.size} vs ${passAhead.size}`);
  assert.ok(passSide.pass > 1.5 && Math.abs(passAhead.pass - 1) < 1e-9);
  // W połowie β: wielkość — średnia geometryczna, odstęp — średnia zwykła.
  const f = mapWorldLens(0, 60000, 30000, { ...base, beta: 0 }, {});
  const l = mapWorldLens(0, 60000, 30000, { ...base, beta: 1 }, {});
  const h = mapWorldLens(0, 60000, 30000, { ...base, beta: 0.5 }, {});
  assert.ok(Math.abs(h.size - Math.sqrt(f.size * l.size)) < 1e-6);
  assert.ok(Math.abs(h.gap - (f.gap + l.gap) / 2) < 1e-6);
});

test('przejście β przy starcie i dojeździe: tarcza pod statkiem tylko w zwykłym widoku', () => {
  // Start: statek nad krawędzią ogromnej planety — w soczewce krawędź zostaje
  // odsunięta od kadłuba przez całe przejście (bez „przelotu nad Ziemią”).
  for (let b = 0; b <= 1.0001; b += 0.05) {
    const o = mapWorldLens(-40000, 0, 24000, { ...base, beta: b, flatScale: 0.017 }, {});
    assert.ok(o.x < 0, 'Ziemia zostaje za rufą');
    assert.ok(Math.hypot(o.x, o.y) - o.size > 0, `β ${b.toFixed(2)}: krawędź przed kadłubem`);
  }
  // Dojazd: statek nad tarczą celu (zwykły widok, gap < 0) — w soczewce cel przed dziobem.
  const real = mapWorldLens(16000, 0, 24700, { ...base, beta: 0, flatScale: 0.017 }, {});
  const lens = mapWorldLens(16000, 0, 24700, { ...base, beta: 1, flatScale: 0.017 }, {});
  assert.ok(real.gap < 0, 'na końcu cel pod statkiem');
  assert.ok(lens.gap >= marginAt(0) - 1e-9 && lens.x > 0, 'w soczewce przed dziobem');
  assert.ok(lens.size < real.size, 'przy „wjeździe” cel rośnie do prawdziwej wielkości');
});

test('aberracja: ściąga ku przodowi, zachowuje stronę, przód i tył bez zmian', () => {
  for (const a of [0.3, 1.0, 1.6, 2.5, -0.7, -2.2]) {
    const ab = aberrateAngle(a, 0.5);
    assert.ok(Math.abs(ab) < Math.abs(a), `kąt ${a} → ${ab}`);
    assert.equal(Math.sign(ab), Math.sign(a));
  }
  assert.equal(aberrateAngle(0, 0.5), 0);
  assert.ok(Math.abs(Math.abs(aberrateAngle(Math.PI, 0.5)) - Math.PI) < 1e-9);
  assert.equal(aberrateAngle(1.2, 0), 1.2);
  // W odwzorowaniu: gwiazda z boku (90°) przesuwa się ku kierunkowi lotu.
  const side = mapWorldLens(0, 1e6, 0, { ...base, beta: 1, velAngle: 0, aberration: 0.5 }, {});
  assert.ok(side.x > 0 && side.y > 0, 'z boku → do przodu, ta sama burta');
});

test('opływ kuli: daleko jednolity wstecz, na brzegu styczny, punkty spiętrzenia z przodu i z tyłu', () => {
  const v = {};
  // Lot w +x: daleko od kuli ośrodek płynie w −x z prędkością 1.
  flowAroundBall(1e6, 3e5, 100, 1, 0, v);
  assert.ok(Math.abs(v.x + 1) < 1e-3 && Math.abs(v.y) < 1e-3);
  // Na brzegu (r = R) prędkość styczna — nic nie wpływa do kuli.
  for (const ang of [0.3, 1.2, 2.0, 2.8, -1.0]) {
    const px = Math.cos(ang) * 100;
    const py = Math.sin(ang) * 100;
    flowAroundBall(px, py, 100, 1, 0, v);
    const radial = (v.x * px + v.y * py) / 100;
    assert.ok(Math.abs(radial) < 1e-9, `składowa promieniowa ${radial} przy kącie ${ang}`);
  }
  flowAroundBall(100, 0, 100, 1, 0, v);
  assert.ok(Math.hypot(v.x, v.y) < 1e-9, 'punkt spiętrzenia przed dziobem');
  // Z boku kuli ośrodek przyspiesza (2U) — smugi są tam najdłuższe.
  flowAroundBall(0, 100, 100, 1, 0, v);
  assert.ok(Math.abs(v.x + 2) < 1e-9);
});

test('front wyjścia: przed frontem zwykły widok, za nim soczewka, łagodny pas', () => {
  // Front 0,5 promienia przed statkiem, pas 0,35.
  assert.equal(sweepBeta(1, 2.0, 0.5, 0.35), 0, 'daleko przed frontem — rzeczywistość');
  assert.equal(sweepBeta(1, -1.0, 0.5, 0.35), 1, 'za frontem — pełna soczewka');
  const mid = sweepBeta(1, 0.5, 0.5, 0.35);
  assert.ok(Math.abs(mid - 0.5) < 1e-9, 'na froncie połowa');
  let prev = 2;
  for (let s = -1; s <= 2; s += 0.05) {
    const b = sweepBeta(0.8, s, 0.5, 0.35);
    assert.ok(b <= prev + 1e-12, 'β maleje w kierunku lotu');
    assert.ok(b >= 0 && b <= 0.8);
    prev = b;
  }
  // Bez frontu (daleko przed statkiem) nic się nie prostuje.
  assert.equal(sweepBeta(1, 3, 1000, 0.35), 1);
});

// Położenie ciała wzdłuż osi lotu przy soczewce b — jak w mapWorldLens
// (interpolacja w logarytmie między zwykłym widokiem a obrazem w kuli).
const axisS = (sFlat, sLens) => (b) => Math.sign(sFlat) * Math.exp(Math.log(Math.abs(sFlat)) * (1 - b) + Math.log(Math.abs(sLens)) * b);
const BAND = 0.6;

test('ciało za rufą: front je zabiera — jedzie na pasie frontu za kadr, nie zostaje w kuli', () => {
  const sOf = axisS(-50, -0.95); // Ziemia 50 promieni kuli za rufą, w kuli przy brzegu
  // Front jeszcze przed obrazem ciała — pełna soczewka.
  assert.ok(Math.abs(solveSweepBodyBeta(sOf, 1, 0.5, BAND, 1) - 1) < 1e-3);
  // Front przechodzi przez kadr: ciało zawsze tuż ZA frontem (w jego pasie),
  // β ciała płynnie maleje, a ono samo odjeżdża za rufę razem z frontem.
  let prev = 1;
  let prevS = sOf(1);
  for (let front = 0.2; front >= -2.6; front -= 0.05) {
    const b = solveSweepBodyBeta(sOf, 1, front, BAND, prev);
    const s = sOf(b);
    assert.ok(Math.abs(b - sweepBeta(1, s, front, BAND)) < 1e-3, 'punkt stały');
    assert.ok(Math.abs(b - prev) < 0.08, `ciągłość przy froncie ${front.toFixed(2)}: ${prev} → ${b}`);
    assert.ok(s <= prevS + 1e-9, 'ciało nie wraca do kuli');
    if (front < -1.2) assert.ok(s < front + BAND && s > front - BAND - 0.8, `ciało w pasie frontu (s ${s.toFixed(2)}, front ${front.toFixed(2)})`);
    prev = b;
    prevS = s;
  }
  assert.ok(prevS < -2.4, 'na końcu frontu ciało jest za kadrem');
});

test('cel przed dziobem: zostaje w kuli, aż front minie jego obraz (dwa rozwiązania — ciągłość)', () => {
  const sOf = axisS(4.0, 0.4); // Jowisz: naprawdę daleko przed kadrem, w kuli blisko statku
  // Front między obrazem a prawdziwym miejscem: oba położenia są spójne z tłem.
  const inBall = solveSweepBodyBeta(sOf, 1, 2.0, BAND, 1);
  const real = solveSweepBodyBeta(sOf, 1, 2.0, BAND, 0);
  assert.ok(inBall > 0.99, `z kuli zostaje w kuli (${inBall})`);
  assert.ok(real < 0.01, `z prawdziwego miejsca zostaje tam (${real})`);
  // Front minął obraz ciała — w kuli nie ma już rozwiązania, ciało się prostuje.
  assert.ok(solveSweepBodyBeta(sOf, 1, -0.4, BAND, 1) < 0.05);
  // Bez frontu (skok trwa) — zwykłe β.
  assert.ok(Math.abs(solveSweepBodyBeta(sOf, 0.7, 1000, BAND, 0) - 0.7) < 1e-3);
});

test('Core3D: shafty wygaszane stopniowo, pełne wygaszenie pomija pass i budżet sylwetek', () => {
  const src = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');
  // Oba kanały maski cieni (powierzchnia i tło) gasną z uShaftGain.
  assert.match(src, /float surfaceOut = clamp\(surfaceShadow, 0\.0, 1\.0\) \* uShaftGain;/);
  assert.match(src, /float backdropOut = clamp\(shadow, 0\.0, 1\.0\) \* uShaftGain;/);
  assert.match(src, /uShafts\.uShaftGain\.value = 1 - shaftCut;/);
  assert.match(src, /const raysEnabled = t\.shadowShafts !== false && !freePerspective && shaftCut < 1;/);
  assert.match(src, /this\._shaftsSuppressed >= 1\) return 0;/);
});
