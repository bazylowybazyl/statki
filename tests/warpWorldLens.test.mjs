import test from 'node:test';
import assert from 'node:assert/strict';

// Soczewka świata (widok skoku, docs/BRIEF-warp.md §4.3). Pilnujemy: β = 0 to
// zwykły widok (bez skoku przy wejściu); przy β = 1 ciała stoją w PRAWDZIWYCH
// odległościach w jednej skali (user: mijana planeta była „na siłę przybliżana
// do gracza, potem oddalana”) — mijana planeta leci po prostej, rośnie
// z perspektywy wzdłuż kursu do prawdziwej wielkości przy mijaniu i maleje za
// rufą, nigdy nie jest bliżej statku niż naprawdę; skala idzie za nominalną
// prędkością (zwolnienie przy planecie jej nie zmienia); ciało obraca się jak
// widziane z przelatującego statku; cel wisi przy krawędzi i wjeżdża, gdy front
// wyjścia dochodzi do statku; bez sztucznych efektów (zginania tła wokół planety).

globalThis.window = globalThis.window || {};
const {
  mapWorldLens, flowAroundBall, sweepBeta, solveSweepBodyBeta, warpHorizonPx,
  viewEdgeDistance, arriveBeta, warpLensScale, warpDepthScale, flybyTurn,
  WORLD_LENS_DEFAULTS, WARP_VIEW_DEFAULTS
} = await import('../src/3d/warpWorldLens.js');
const { warpDropGeometry, warpDropExit } = await import('../src/3d/warpLens3D.js');
const { readFileSync } = await import('node:fs');

const P = WORLD_LENS_DEFAULTS;
const V = WARP_VIEW_DEFAULTS;
const S = 450 / P.framingDist; // skala soczewki w przelocie dla kadru 1600×900
const base = {
  zoom: 0.1, lensScale: S, sizeDepth: P.sizeDepth, viewHalfW: 800, viewHalfH: 450, shipSx: 0, shipSy: 0,
  targetWindow: P.targetWindow, sizeK: P.sizeK, sizeD0: P.sizeD0,
  gapPx: 24, hullHalfLen: 100, hullHalfWid: 45, holdSize: P.holdSize, holdPeek: P.holdPeek, holdSoft: P.holdSoft,
  velAngle: 0, sizeBoost: 1
};
// Odstęp kadłuba w kierunku kąta a od osi lotu (jak w mapWorldLens).
const marginAt = (a) => 24 + Math.abs(Math.cos(a)) * 100 + Math.abs(Math.sin(a)) * 45;
// Krawędź kadru 1600×900 od statku na środku, w kierunku a (lot w +x).
const edgeAt = (a) => viewEdgeDistance(Math.cos(a), Math.sin(a), 800, 450);

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

test('krawędź kadru: odległość od statku w kierunku, także przy statku poza środkiem', () => {
  assert.equal(viewEdgeDistance(1, 0, 800, 450), 800);
  assert.equal(viewEdgeDistance(0, -1, 800, 450), 450);
  assert.ok(Math.abs(viewEdgeDistance(Math.SQRT1_2, Math.SQRT1_2, 800, 450) - 450 * Math.SQRT2) < 1e-9);
  assert.equal(viewEdgeDistance(0, -1, 800, 450, 0, 100), 550, 'statek niżej — dalej do górnej krawędzi');
  assert.equal(viewEdgeDistance(1, 0, 800, 450, 900, 0), 0, 'statek poza kadrem');
});

test('skala soczewki: stała w przelocie (zwolnienie jej nie zmienia), przy rozpędzie i hamowaniu bliżej', () => {
  const cruise = warpLensScale(P.zoomRefSpeed, 450, P);
  assert.ok(Math.abs(cruise - 450 / P.framingDist) < 1e-12);
  assert.equal(warpLensScale(P.zoomRefSpeed * 3, 450, P), cruise, 'szybciej niż odniesienie — ta sama skala');
  assert.ok(Math.abs(warpLensScale(P.zoomRefSpeed / 4, 450, P) - cruise * 4) < 1e-12, 'wolniej — bliżej, proporcjonalnie');
  assert.equal(warpLensScale(10, 450, P, 0.03), 0.03, 'prawie stoi — najwyżej maxScale');
});

test('perspektywa wzdłuż kursu: przy mijaniu prawdziwa wielkość, przed dziobem i za rufą mniejsza, symetrycznie', () => {
  assert.equal(warpDepthScale(0, P.sizeDepth), 1);
  let prev = 1;
  for (let a = 5000; a <= 400000; a += 5000) {
    const k = warpDepthScale(a, P.sizeDepth);
    assert.ok(k < prev && k > 0, 'maleje z odległością wzdłuż kursu');
    assert.equal(warpDepthScale(-a, P.sizeDepth), k, 'za rufą tak samo jak przed dziobem');
    prev = k;
  }
});

test('β = 1: prawdziwa geometria w jednej skali — środek S·(dx, dy), tarcza nigdy bliżej statku niż naprawdę', () => {
  const o = {};
  for (const a of [0, 0.4, 1.2, Math.PI / 2, 2.2, 2.9, Math.PI, -0.7, -1.9]) {
    for (const d of [5e3, 2e4, 7e4, 1.5e5, 4e5, 2e6]) {
      for (const r of [1000, 9000, 30000]) {
        const dx = Math.cos(a) * d;
        const dy = Math.sin(a) * d;
        mapWorldLens(dx, dy, r, { ...base, beta: 1 }, o);
        assert.ok(Math.abs(o.x - dx * S) < 1e-6 && Math.abs(o.y - dy * S) < 1e-6, `kąt ${a}, d ${d}: środek w prawdziwym miejscu`);
        const k = warpDepthScale(dx, P.sizeDepth);
        assert.ok(Math.abs(o.size - r * S * k) < 1e-9, 'wielkość: prawdziwa × perspektywa wzdłuż kursu');
        assert.ok(o.gap >= S * (d - r) - 1e-9, 'krawędź nie bliżej statku niż naprawdę');
      }
    }
  }
  // Statek nad tarczą (d < r) — przy mijaniu tarcza pod statkiem, jak naprawdę.
  mapWorldLens(0, 5000, 9000, { ...base, beta: 1 }, o);
  assert.ok(o.gap < 0);
  // Daleko (słońce, planety po drugiej stronie układu) — za kadrem.
  mapWorldLens(0, 1.2e6, 12000, { ...base, beta: 1 }, o);
  assert.ok(o.gap > 450);
});

test('przelot obok planety: po prostej, w prawdziwej odległości od kursu; rośnie płynnie do mijania, potem maleje', () => {
  // Lot w górę kadru (−y), Mars 70 tys. j. w prawo od kursu.
  const va = -Math.PI / 2;
  const c = 70000;
  const r = 30000;
  let prev = null;
  let peak = null;
  for (let along = 150000; along >= -150000; along -= 2500) {
    // Ciało względem statku: `along` przed dziobem (−y), c w prawo (+x).
    const o = mapWorldLens(c, -along, r, { ...base, beta: 1, velAngle: va }, {});
    assert.ok(Math.abs(o.x - c * S) < 1e-6, `stała odległość od kursu na ekranie (${o.x})`);
    assert.ok(Math.abs(o.y + along * S) < 1e-6, 'wzdłuż kursu też prawdziwie');
    if (prev) {
      if (along >= 0) assert.ok(o.size >= prev.size - 1e-9, 'rośnie, gdy się zbliża');
      else assert.ok(o.size <= prev.size + 1e-9, 'maleje za rufą');
      assert.ok(Math.abs(o.size - prev.size) < 6, `płynnie: skok ${o.size - prev.size} px`);
    }
    if (along === 0) peak = o;
    prev = o;
  }
  assert.ok(Math.abs(peak.size - r * S) < 1e-9, 'przy mijaniu prawdziwa wielkość');
  assert.ok(Math.abs(peak.gap - (c - r) * S) < 1e-9, 'i prawdziwa odległość krawędzi od statku');
  const far = mapWorldLens(c, -150000, r, { ...base, beta: 1, velAngle: va }, {});
  assert.ok(far.size < peak.size * 0.3, 'z daleka dużo mniejsza — wyraźnie rośnie');
});

test('obrót przy przelocie: strona widziana ze statku zwrócona do ekranu, przed dziobem i za rufą w przeciwne strony', () => {
  const h = P.flybyHeight;
  const rot = (t, v) => {
    // Rodrigues: obrót v wokół osi (ax, ay, 0) o kąt.
    const k = [t.ax, t.ay, 0];
    const c = Math.cos(t.angle);
    const s = Math.sin(t.angle);
    const kv = k[0] * v[0] + k[1] * v[1];
    const cross = [k[1] * v[2], -k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    return [0, 1, 2].map((i) => v[i] * c + cross[i] * s + k[i] * kv * (1 - c));
  };
  for (const [ox, oy] of [[70000, 90000], [70000, -90000], [-30000, 5000], [0, 200000]]) {
    const t = flybyTurn(ox, oy, h);
    const n = Math.hypot(ox, oy, h);
    const v = rot(t, [-ox / n, -oy / n, h / n]);
    assert.ok(Math.abs(v[0]) < 1e-9 && Math.abs(v[1]) < 1e-9 && Math.abs(v[2] - 1) < 1e-9, `(${ox}, ${oy}) → ${v}`);
    assert.ok(Math.abs(t.angle - Math.atan2(Math.hypot(ox, oy), h)) < 1e-12);
  }
  const ahead = flybyTurn(70000, 90000, h);
  const behind = flybyTurn(70000, -90000, h);
  assert.ok(ahead.ax * behind.ax < 0, 'mijanie odwraca obrót wokół osi w poprzek kursu');
  assert.equal(flybyTurn(0, 0, h).angle, 0, 'ciało przy statku — bez obrotu');
});

test('cel: wyłania się przy krawędzi przed dziobem i rośnie, nie zbliżając się do statku', () => {
  const r = 17100;
  const edge = edgeAt(0);
  let prev = null;
  let entered = null;
  for (let ds = 1.6 * P.targetWindow; ds >= 0; ds -= 2000) {
    const o = mapWorldLens(ds + r, 0, r, { ...base, beta: 1, hold: 1 }, {});
    if (ds > 1.2 * P.targetWindow) assert.ok(o.gap > edge, 'daleko — za kadrem');
    if (entered === null && o.gap < edge) entered = ds;
    assert.ok(o.gap >= edge - 2 * o.size * P.holdPeek - 1e-6, `ds ${ds}: nie podjeżdża do statku (${o.gap})`);
    if (prev) {
      assert.ok(o.size >= prev.size, 'rośnie');
      assert.ok(o.gap <= prev.gap + 1e-9, 'nie cofa się');
      assert.ok(prev.gap - o.gap < 12, `płynnie: skok ${prev.gap - o.gap} px`);
    }
    prev = o;
  }
  assert.ok(entered !== null && Math.abs(entered - P.targetWindow) < 0.15 * P.targetWindow, `wyłania się przy ~oknie celu (${entered})`);
  assert.ok(prev.gap < edge && prev.gap > edge * 0.5, `na końcu wisi przy krawędzi (${prev.gap})`);
});

test('wjazd celu: β celu spada, gdy front dochodzi do statku, i kończy się przy nim', () => {
  const band = V.arriveBand;
  assert.equal(arriveBeta(1, 1000, band), 1, 'bez frontu — soczewka');
  assert.equal(arriveBeta(1, 2 * band + 0.01, band), 1, 'front jeszcze daleko — cel wisi');
  assert.ok(Math.abs(arriveBeta(1, band, band) - 0.5) < 1e-9);
  assert.equal(arriveBeta(1, 0, band), 0, 'front przy statku — cel na miejscu');
  assert.equal(arriveBeta(1, -1, band), 0);
  let prev = 1;
  for (let f = 1; f >= -0.2; f -= 0.01) {
    const b = arriveBeta(0.8, f, band);
    assert.ok(b <= prev + 1e-12 && b >= 0 && b <= 0.8);
    prev = b;
  }
});

test('przejście β: odstęp liniowo, wielkość w logarytmie; start i dojazd bez „przelotu nad planetą”', () => {
  const f = mapWorldLens(0, 60000, 30000, { ...base, beta: 0 }, {});
  const l = mapWorldLens(0, 60000, 30000, { ...base, beta: 1 }, {});
  const h = mapWorldLens(0, 60000, 30000, { ...base, beta: 0.5 }, {});
  assert.ok(Math.abs(h.size - Math.sqrt(f.size * l.size)) < 1e-6);
  assert.ok(Math.abs(h.gap - (f.gap + l.gap) / 2) < 1e-6);
  // Start: statek nad krawędzią ogromnej planety — w soczewce krawędź zostaje
  // przed kadłubem przez całe przejście.
  for (let b = 0; b <= 1.0001; b += 0.05) {
    const o = mapWorldLens(-40000, 0, 37800, { ...base, beta: b, flatScale: 0.017 }, {});
    assert.ok(o.x < 0, 'Ziemia zostaje za rufą');
    assert.ok(Math.hypot(o.x, o.y) - o.size > 0, `β ${b.toFixed(2)}: krawędź nie pod statkiem`);
  }
  // Dojazd: statek nad tarczą celu (zwykły widok, gap < 0) — w soczewce cel
  // wisi przy krawędzi kadru przed dziobem.
  const real = mapWorldLens(16000, 0, 24700, { ...base, beta: 0, flatScale: 0.017, hold: 1 }, {});
  const lens = mapWorldLens(16000, 0, 24700, { ...base, beta: 1, flatScale: 0.017, hold: 1 }, {});
  assert.ok(real.gap < 0, 'na końcu cel pod statkiem');
  const edge = edgeAt(0);
  assert.ok(lens.x > 0 && lens.gap >= edge - 2 * lens.size * P.holdPeek - 1e-6 && lens.gap < edge, 'w soczewce przy krawędzi przed dziobem');
  assert.ok(lens.size < real.size * 0.5, 'przy „wjeździe” cel gwałtownie rośnie do prawdziwej wielkości');
});

test('bez sztucznych efektów: mijana planeta nie zgina tła, kierunki bez aberracji', () => {
  const src = readFileSync(new URL('../src/3d/warpWorldLens.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /pushWarpSpaceWorld|passBoost|aberrat/i);
  // Kierunek ciała w soczewce = prawdziwy kierunek (także przy pełnej prędkości).
  const o = mapWorldLens(0, 90000, 9000, { ...base, beta: 1, velAngle: 0 }, {});
  assert.ok(Math.abs(o.x) < 1e-9 && o.y > 0);
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

test('ciało przed dziobem: zostaje w kuli, aż front minie jego obraz (dwa rozwiązania — ciągłość)', () => {
  const sOf = axisS(4.0, 0.4); // naprawdę daleko przed kadrem, w kuli blisko statku
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

test('ładowanie skoku: gwiazdy gry wydłużają się płasko wzdłuż lotu (bez zbiegania w tunel 3D), limit prędkości wzoru dla StarSystemu', async () => {
  const { WarpWorldLens } = await import('../src/3d/warpWorldLens.js');
  const THREE = await import('three');
  const u = {
    baseSizeMul: { value: 1.65 }, stretchStrength: { value: 20 }, globalBrightness: { value: 0.4 },
    warpFactor: { value: 0.05 }, exitWhipFactor: { value: 0 }, moveDir: { value: new THREE.Vector2(0, 1) },
    cameraOffset: { value: new THREE.Vector2(123, 456) }
  };
  const stars = { isPoints: true, parent: {}, material: { uniforms: u }, userData: {} };
  const prev = WarpWorldLens._stars;
  WarpWorldLens._stars = stars;
  try {
    const cam = { x: 0, y: 0 };
    // Lot w prawo i w dół kadru (kąt gry 30°, y w dół).
    const va = Math.PI / 6;
    WarpWorldLens._capStarParallax(cam, 1 / 60, 0, 1, 0.8, va);
    assert.ok(u.warpFactor.value >= WARP_VIEW_DEFAULTS.starChargeStretch * Math.pow(0.8, 1.3) - 1e-9, 'smugi rosną z ładowaniem');
    assert.ok(u.globalBrightness.value > 1, 'gwiazdy jaśnieją zamiast gasnąć');
    assert.ok(Math.abs(u.moveDir.value.x - Math.cos(va)) < 1e-9 && Math.abs(u.moveDir.value.y + Math.sin(va)) < 1e-9, 'smugi wzdłuż lotu (NDC, y w górę)');
    assert.equal(stars.userData.starSpeedCap, WARP_VIEW_DEFAULTS.starSpeedCap, 'limit prędkości wzoru na następną klatkę');
    assert.equal(u.cameraOffset.value.x, 123, 'przesunięcie wzoru liczy StarSystem, soczewka go nie nadpisuje');
  } finally {
    WarpWorldLens._stars = prev;
  }
  // Shader gwiazd gry: smugi wzdłuż moveDir (bez punktu zbiegu), wzór rośnie
  // z kadrem przy oddaleniu, kamera gwiazd z limitem od widoku skoku.
  // Port WebGPU (zadanie 05): shader gwiazd to graf TSL (createStarMaterial, planet3d.assets.tsl.js).
  const src = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');
  const tsl = readFileSync(new URL('../src/3d/planet3d.assets.tsl.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src + tsl, /starFocus/);
  assert.match(tsl, /const angle = atan\(vDir\.y, vDir\.x\);/);
  assert.match(tsl, /const pos = vec3\(vec2\(posX, posY\)\.mul\(u\.zoomComp\), aPos\.z\);/);
  assert.match(src, /advanceStarCamera\(this\.starCam, cx, cy, zoomComp, speedCap > 0 \? speedCap \* Math\.max\(0, dt\) : 0\);/);
  assert.match(src, /this\.uniforms\.cameraOffset\.value\.set\(this\.starCam\.x, -this\.starCam\.y\);/);
});

test('punkt skoku: przed dziobem wzdłuż kursu, jedzie z okrętem', async () => {
  const { WarpFx3D } = await import('../src/3d/warpFx3D.js');
  const c = { entity: { x: 1000, y: -500 }, heading: -Math.PI / 2, hullLength: 1800, lead: 0.45 };
  WarpFx3D.chargePoint(c);
  assert.ok(Math.abs(c.x - 1000) < 1e-6 && Math.abs(c.y - (-500 - 1800 * 0.95)) < 1e-6);
  c.entity.y -= 4000;
  const p = WarpFx3D.chargePoint(c, {});
  assert.ok(Math.abs(p.y - (-4500 - 1800 * 0.95)) < 1e-6, 'po ruchu okrętu');
});

// Port WebGPU (zadanie 01, warp poza portem): widok skoku nie ma passa, więc
// Core3D.suppressShadowShafts jest no-opem — gra bez widoku skoku nie wygasza
// smug. Wzmocnienie maski (uShaftGain) zostaje w źródle shadera maski dla nowego
// warpa (port maski do TSL: zadanie 03).
test('Core3D: wygaszanie shaftów przez widok skoku — no-op na czas portu, wzmocnienie maski zostaje', async () => {
  const src = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');
  // Oba kanały maski cieni (powierzchnia i tło) gasną z uShaftGain.
  assert.match(src, /float surfaceOut = clamp\(surfaceShadow, 0\.0, 1\.0\) \* uShaftGain;/);
  assert.match(src, /float backdropOut = clamp\(shadow, 0\.0, 1\.0\) \* uShaftGain;/);
  assert.match(src, /suppressShadowShafts\(amount = 1\) \{ \},/);
  assert.doesNotMatch(src, /_shaftsSuppressed/);
  const { Core3D } = await import('../src/3d/core3d.js');
  const fake = Object.assign(Object.create(Core3D), { perfToggles: { shadowShafts: true }, activeCam1: { x: 0, y: 0, zoom: 1 } });
  const before = fake.getShaftHullBudget();
  fake.suppressShadowShafts(1);
  assert.equal(fake.getShaftHullBudget(), before);
});
