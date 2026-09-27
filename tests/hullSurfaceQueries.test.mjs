import test from 'node:test';
import assert from 'node:assert/strict';

// Zapytania powierzchni kadłubów belkowych (src/game/hullBodies.js, zadanie 18-A):
// surfaceNormal (normalna na zewnątrz z gradientu zajętości węzłów), traceThrough (droga
// w materiale), spriteUvAt (uv sprite'a w konwencji skóry), hullImpactResult z impact() /
// cutSegment() i hak onImpact. Wszystko tylko do odczytu — bez zmiany fizyki i losowań.
globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies, hullImpactResult, hullNormalResult, hullTraceResult } = await import('../src/game/hullBodies.js');
const { buildHullSkinTopology } = await import('../src/3d/beamHullSkin.js');

// Płyta w × h px; `notch` wycina prawą górną ćwiartkę OBRAZU (jak w tests/hullBodies.test.mjs).
function plate(w, h, notch = false) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (notch && x > w / 2 && y < h / 2) continue;
      const o = (y * w + x) * 4;
      data[o] = 140; data[o + 1] = 150; data[o + 2] = 160; data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const RECT = plate(400, 200);
const NOTCHED = plate(400, 200, true);
const SMALL = plate(160, 80);
const npcAt = (x, y, extra = {}) => ({ x, y, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 5000, ...extra });

// Układ encji: lokalnie (lx, ly) w pikselach sprite'a względem środka, y w dół (jak gra) → świat.
function frame(e) {
  const c = Math.cos(e.angle), s = Math.sin(e.angle);
  return {
    world: (lx, ly) => [e.x + lx * c - ly * s, e.y + lx * s + ly * c],
    dir: (dx, dy) => { const l = Math.hypot(dx, dy); return [(dx * c - dy * s) / l, (dx * s + dy * c) / l]; },
    local: (wx, wy) => [wx * c + wy * s, -wx * s + wy * c]
  };
}

// Strzał z punktu lokalnego w kierunku lokalnym: punkt wejścia z sweep i normalna w lokalnym układzie.
function shoot(e, ox, oy, dx, dy) {
  const F = frame(e);
  const [x0, y0] = F.world(ox, oy);
  const [ux, uy] = F.dir(dx, dy);
  const hit = HullBodies.sweep(e, x0, y0, x0 + ux * 3000, y0 + uy * 3000, 0);
  assert.ok(hit, `strzał z (${ox}, ${oy}) trafia`);
  const n = HullBodies.surfaceNormal(e, hit.worldX, hit.worldY, ux, uy);
  const [lnx, lny] = F.local(n.nx, n.ny);
  return { nx: lnx, ny: lny, node: n.node, wx: n.nx, wy: n.ny };
}

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

test('surfaceNormal: burty, dziób i róg płyty — także po obrocie encji', () => {
  for (const angle of [0, 0.7, -2.4]) {
    const e = npcAt(1000, -500, { angle });
    HullBodies.createHull(e, RECT);
    try {
      const bow = shoot(e, 600, 30, -1, 0);
      near(bow.nx, 1, 1e-9, `dziób, kąt ${angle}`); near(bow.ny, 0, 1e-9, 'dziób y');
      const bottom = shoot(e, 50, 400, 0, -1);
      near(bottom.nx, 0, 1e-9, 'burta dolna x'); near(bottom.ny, 1, 1e-9, `burta dolna (y gry w dół), kąt ${angle}`);
      const top = shoot(e, -120, -400, 0, 1);
      near(top.ny, -1, 1e-9, `burta górna, kąt ${angle}`);
      // Skos 11° po burcie (kandydat na rykoszet): normalna dalej prostopadła do burty.
      const graze = shoot(e, -150, 130, 1, -0.2);
      near(graze.ny, 1, 1e-9, 'skos po burcie');
      // Róg wypukły trafiony w narożnik: przekątna.
      const corner = shoot(e, 600, 500, -1, -1);
      near(corner.nx, Math.SQRT1_2, 1e-9, 'róg x'); near(corner.ny, Math.SQRT1_2, 1e-9, 'róg y');
      // Świat: normalna obraca się z kadłubem (dziób lokalnie +x → (cos, sin) kąta gry).
      near(bow.wx, Math.cos(angle), 1e-9, 'dziób w świecie x');
      near(bow.wy, Math.sin(angle), 1e-9, 'dziób w świecie y');
      assert.ok(bow.node >= 0 && corner.node >= 0, 'węzeł normalnej');
    } finally { HullBodies.release(e); }
  }
});

test('surfaceNormal: wklęsły róg wycięcia i jego ściany; bez węzła — kierunek przeciwny lotowi', () => {
  const e = npcAt(0, 0);
  HullBodies.createHull(e, NOTCHED);
  try {
    // Wycięcie = prawa górna ćwiartka obrazu (x > 0, y < 0 lokalnie); ściana x ≈ 0 dla y ∈ (−100, 0),
    // środek ściany daleko (> 2,5 komórki) od górnej burty i od wklęsłego rogu.
    const wall = shoot(e, 300, -50, -1, 0);
    assert.ok(wall.nx > 0.95, `ściana wycięcia patrzy w wycięcie (+x): ${wall.nx}, ${wall.ny}`);
    const floor = shoot(e, 100, -300, 0, 1);
    near(floor.ny, -1, 1e-9, 'dno wycięcia patrzy w górę obrazu (−y)');
    const concave = shoot(e, 300, -300, -1, 1);
    assert.ok(concave.nx > 0.3 && concave.ny < -0.3, `wklęsły róg: normalna w głąb wycięcia (${concave.nx}, ${concave.ny})`);
    // Punkt daleko od kadłuba: brak węzła, fallback = −kierunek lotu.
    const out = HullBodies.surfaceNormal(e, 5000, 5000, 0.6, 0.8, {});
    assert.equal(out.node, -1);
    near(out.nx, -0.6, 1e-12, 'fallback x'); near(out.ny, -0.8, 1e-12, 'fallback y');
    // Bez kierunku — promieniście od kotwicy encji.
    const radial = HullBodies.surfaceNormal(e, 5000, 0, 0, 0, {});
    near(radial.nx, 1, 1e-12, 'fallback promieniowy');
    // Wynik domyślny jest współdzielony (bez alokacji na wywołanie).
    assert.equal(HullBodies.surfaceNormal(e, 0, 0, 1, 0), hullNormalResult);
  } finally { HullBodies.release(e); }
});

test('surfaceNormal: pręt jednej komórki nie ma gradientu w poprzek — normalna = −kierunek lotu', () => {
  const e = npcAt(0, 0);
  HullBodies.createHull(e, plate(300, 15));
  try {
    const n = shoot(e, 0, 200, 0.3, -1);
    const l = Math.hypot(0.3, 1);
    near(n.nx, -0.3 / l, 1e-9, 'x'); near(n.ny, 1 / l, 1e-9, 'y');
  } finally { HullBodies.release(e); }
});

test('traceThrough: grubość płyty 160 i 400 j., wejście i wyjście, start i koniec w materiale, po obrocie', () => {
  for (const angle of [0, 0.7]) {
    const small = npcAt(0, 0, { angle });
    const rect = npcAt(4000, 0, { angle });
    HullBodies.createHull(small, SMALL);
    HullBodies.createHull(rect, RECT);
    try {
      const cs = small.beamHull.body.cellSize;
      const trace = (e, ax, ay, bx, by, r = 0) => {
        const F = frame(e);
        const [x0, y0] = F.world(ax, ay);
        const [x1, y1] = F.world(bx, by);
        return { ...HullBodies.traceThrough(e, x0, y0, x1, y1, r) };
      };
      // Pełna płyta: droga = grubość + najwyżej 0,44 komórki (sonda 0,72 komórki od skrajnych węzłów).
      const s160 = trace(small, -300, 3, 300, 3);
      assert.ok(s160.solidLen >= 160 - 1e-6 && s160.solidLen <= 160 + 0.44 * cs, `płyta 160: ${s160.solidLen}`);
      near(s160.entryT * 600, 300 - 80, 0.3 * cs, 'wejście przy rufie');
      near(s160.exitT * 600, 300 + 80, 0.3 * cs, 'wyjście przy dziobie');
      assert.ok(s160.node >= 0, 'ostatni węzeł w materiale');
      const s400 = trace(rect, -300, 5, 300, 5);
      assert.ok(s400.solidLen >= 400 - 1e-6 && s400.solidLen <= 400 + 0.44 * cs, `płyta 400: ${s400.solidLen}`);
      // Start w materiale: entryT = 0; koniec w materiale: exitT = −1.
      const fromInside = trace(rect, 0, 0, 300, 0);
      assert.equal(fromInside.entryT, 0);
      near(fromInside.solidLen, 200, 0.44 * cs + 1e-6, 'od środka do dziobu');
      const intoInside = trace(rect, -300, 0, 0, 0);
      assert.equal(intoInside.exitT, -1);
      near(intoInside.solidLen, (1 - intoInside.entryT) * 300, 1e-9, 'droga do końca odcinka');
      // Pudło: brak materiału.
      const miss = trace(rect, -300, 300, 300, 300);
      assert.equal(miss.entryT, -1); assert.equal(miss.solidLen, 0);
      // Promień pocisku pogrubia materiał.
      const fat = trace(small, -300, 3, 300, 3, 6);
      assert.ok(fat.solidLen > s160.solidLen + 6, 'promień pocisku liczy się do materiału');
    } finally { HullBodies.release(small); HullBodies.release(rect); }
  }
});

test('traceThrough: pierwszy ciągły odcinek — wycięcie i dziura po kraterze kończą przejście', () => {
  const e = npcAt(0, 0);
  HullBodies.createHull(e, NOTCHED);
  try {
    const cs = e.beamHull.body.cellSize;
    // Górna połowa obrazu: materiał tylko do x = 0 (wycięcie), dolna — cała długość.
    const top = { ...HullBodies.traceThrough(e, -300, -50, 300, -50, 0) };
    near(top.solidLen, 200, 1.1 * cs, 'górna połowa do wycięcia');
    const bottom = { ...HullBodies.traceThrough(e, -300, 50, 300, 50, 0) };
    near(bottom.solidLen, 400, 0.44 * cs + 1e-6, 'dolna połowa');
    // Krater w środku dolnej połowy: przejście kończy się na jego brzegu.
    assert.equal(HullBodies.impact(e, 60, 50, 6000, { x: 1, y: 0 }), true);
    const cut = { ...HullBodies.traceThrough(e, -300, 50, 300, 50, 0) };
    assert.ok(cut.exitT > 0 && cut.solidLen < 300, `dziura przerywa materiał: ${cut.solidLen}`);
    assert.equal(HullBodies.traceThrough({ x: 0, y: 0 }, 0, 0, 1, 1, 0), null, 'encja bez kadłuba');
    assert.equal(HullBodies.traceThrough(e, -300, 50, 300, 50), hullTraceResult, 'wynik współdzielony');
  } finally { HullBodies.release(e); }
});

test('spriteUvAt: piksel obrazu z punktu świata, obrót, zgodność ze skórą, wgniecenie i wrak', () => {
  for (const angle of [0, 1.1]) {
    const e = npcAt(-300, 800, { angle });
    HullBodies.createHull(e, NOTCHED);
    try {
      const F = frame(e);
      // Środek sprite'a = pozycja encji; piksel (px, py) obrazu 400 × 200 → lokalnie (px − 200, py − 100).
      for (const [px, py] of [[300, 150], [50, 25], [200, 100], [10, 190]]) {
        const [x, y] = F.world(px - 200, py - 100);
        const q = HullBodies.spriteUvAt(e, x, y);
        assert.ok(q.ok && q.node >= 0, `węzeł pod pikselem (${px}, ${py})`);
        near(q.u, px / 400, 1e-9, `u piksela ${px}`);
        near(q.v, py / 200, 1e-9, `v piksela ${py} (v = 0 u góry obrazu)`);
      }
      // Poza kadłubem: uv ze spoczynku siatki, ok = false.
      const [ox, oy] = F.world(150, -60);        // w wycięciu
      const outside = HullBodies.spriteUvAt(e, ox, oy);
      assert.equal(outside.ok, false);
      near(outside.u, 350 / 400, 1e-9, 'u w wycięciu'); near(outside.v, 40 / 200, 1e-9, 'v w wycięciu');
    } finally { HullBodies.release(e); }
  }

  // Zgodność ze skórą gry: środek węzła = średnia uv czterech narożników jego czworokąta.
  const e = npcAt(0, 0, { angle: 0.4 });
  const hull = HullBodies.createHull(e, NOTCHED);
  try {
    const topo = buildHullSkinTopology(hull.body);
    const s = hull.body.nodeStore;
    for (let i = 0; i < s.count; i += 17) {
      const w = HullBodies.nodeWorld(hull, i, {});
      const q = HullBodies.spriteUvAt(e, w.x, w.y, i);
      let u = 0, v = 0;
      for (let k = 0; k < 4; k++) { u += topo.uvs[i * 8 + k * 2] / 4; v += topo.uvs[i * 8 + k * 2 + 1] / 4; }
      near(q.u, u, 1e-6, `u węzła ${i}`); near(q.v, v, 1e-6, `v węzła ${i}`);
    }
    // Wgnieciony węzeł: uv jedzie z blachą (punkt w nowym miejscu węzła = uv jego środka).
    const i = 40;
    const before = { ...HullBodies.spriteUvAt(e, HullBodies.nodeWorld(hull, i, {}).x, HullBodies.nodeWorld(hull, i, {}).y, i) };
    s.x[i] += 4; s.y[i] -= 3;
    const moved = HullBodies.nodeWorld(hull, i, {});
    const after = HullBodies.spriteUvAt(e, moved.x, moved.y, i);
    near(after.u, before.u, 1e-9, 'u po wgnieceniu'); near(after.v, before.v, 1e-9, 'v po wgnieceniu');
    s.x[i] -= 4; s.y[i] += 3;
    // Wrak z całego kadłuba (kotwica w środku masy) i odłam z rzazu leżą w uv rodzica.
    const [px, py] = frame(e).world(-120, 60);
    const uv0 = { ...HullBodies.spriteUvAt(e, px, py) };
    // Węzeł z prawej części (odpadnie z rzazem): jego komórka i uv środka.
    const [rx, ry] = frame(e).world(140, 60);
    const j0 = HullBodies.spriteUvAt(e, rx, ry).node;
    const cell = `${s.ix[j0]},${s.iy[j0]}`;
    const w0 = HullBodies.nodeWorld(hull, j0, {});
    const uvNode = { ...HullBodies.spriteUvAt(e, w0.x, w0.y, j0) };
    window.wrecks.length = 0;
    const wreck = HullBodies.convertToWreck(e);
    const uv1 = HullBodies.spriteUvAt(wreck, px, py);
    near(uv1.u, uv0.u, 1e-9, 'u wraku'); near(uv1.v, uv0.v, 1e-9, 'v wraku');
    // Rzaz w poprzek kadłuba (lokalnie x = 40 sprite'a): prawy kawałek odpada jako odłam.
    const [cx0, cy0] = frame(e).world(40, -300);
    const [cx1, cy1] = frame(e).world(40, 300);
    assert.ok(HullBodies.cutSegment(wreck, cx0, cy0, cx1, cy1, 10) > 0);
    for (let k = 0; k < 12 && window.wrecks.length < 2; k++) HullBodies.step(1 / 120, [...window.wrecks]);
    const piece = window.wrecks.find((w) => w !== wreck && HullBodies.hasHull(w) && HullBodies.hasCell(w, cell));
    assert.ok(piece, `odłam z komórką ${cell}`);
    assert.equal(piece.beamHull.dmgKey, hull.dmgKey, 'odłam dziedziczy klucz mapy ran');
    const ps = piece.beamHull.body.nodeStore;
    let j1 = -1;
    for (let k = 0; k < ps.count; k++) if (`${ps.ix[k]},${ps.iy[k]}` === cell) { j1 = k; break; }
    const w1 = HullBodies.nodeWorld(piece.beamHull, j1, {});
    const uvPiece = HullBodies.spriteUvAt(piece, w1.x, w1.y, j1);
    near(uvPiece.u, uvNode.u, 1e-9, 'u węzła na odłamie = u w kadłubie rodzica');
    near(uvPiece.v, uvNode.v, 1e-9, 'v węzła na odłamie');
    for (const w of window.wrecks) HullBodies.release(w);
    window.wrecks.length = 0;
  } finally { HullBodies.release(e); }
});

test('impact() i cutSegment() wypełniają hullImpactResult bez zmiany wyniku; hak onImpact', () => {
  const e = npcAt(0, 0, { angle: 0.25 });
  const hull = HullBodies.createHull(e, NOTCHED);
  const calls = [];
  HullBodies.onImpact = (entity, r) => calls.push({ entity, kind: r.kind, killed: r.killed, node: r.node });
  try {
    const F = frame(e);
    const [x, y] = F.world(-100, 50);
    const expectUv = { ...HullBodies.spriteUvAt(e, x, y) };
    const before = hull.body.activeNodes;
    assert.equal(HullBodies.impact(e, x, y, 1000, { x: -600, y: 0 }), true);
    const r = hullImpactResult;
    assert.equal(r.kind, 'impact');
    assert.equal(r.hit, true);
    assert.equal(r.killed, before - hull.body.activeNodes, 'zabite = ubytek żywych węzłów');
    assert.ok(r.killed >= 2, `krater 1000 obrażeń zabija kilka węzłów: ${r.killed}`);
    assert.equal(r.node, expectUv.node, 'węzeł krateru = najbliższy punktowi');
    assert.equal(hull.body.nodeStore.active[r.node], 0, 'krater zaczął od tego węzła');
    near(r.u, expectUv.u, 1e-9, 'u sprzed krateru'); near(r.v, expectUv.v, 1e-9, 'v sprzed krateru');
    assert.ok(r.radius >= hull.body.cellSize, `promień krateru: ${r.radius}`);
    assert.equal(r.dmgKey, hull.dmgKey);
    assert.equal(r.x, x); assert.equal(r.y, y);
    // Lekkie trafienie: krater bez zabitego węzła (przestrzelina na mapie ran w 18-C).
    const [x2, y2] = F.world(-160, 40);
    assert.equal(HullBodies.impact(e, x2, y2, 30, { x: -600, y: 0 }), true);
    assert.equal(hullImpactResult.killed, 0);
    // Pudło: wynik wyczyszczony, hak nie woła się.
    assert.equal(HullBodies.impact(e, 9000, 9000, 500, null), false);
    assert.equal(hullImpactResult.hit, false);
    assert.equal(hullImpactResult.node, -1);
    // Rzaz: węzeł i uv wejścia.
    const [a0, b0] = F.world(-300, -40);
    const [a1, b1] = F.world(300, -40);
    const killed = HullBodies.cutSegment(e, a0, b0, a1, b1, 12);
    assert.ok(killed > 0);
    assert.equal(hullImpactResult.kind, 'cut');
    assert.equal(hullImpactResult.killed, killed);
    assert.equal(hullImpactResult.radius, 12);
    near(hullImpactResult.x, HullBodies.sweepResult.worldX, 1e-9, 'punkt wejścia rzazu');
    // Wejście na kole pasa (półszerokość 12 j.) przed pierwszym węzłem — tuż przy lewej krawędzi obrazu.
    assert.ok(Math.abs(hullImpactResult.u) < 0.05, `rzaz wchodzi od rufy: u = ${hullImpactResult.u}`);
    assert.deepEqual(calls.map((c) => c.kind), ['impact', 'impact', 'cut'], 'hak po każdym trafieniu, nie po pudle');
    assert.ok(calls.every((c) => c.entity === e));
    // Encja bez kadłuba.
    assert.equal(HullBodies.impact({ x: 0, y: 0 }, 0, 0, 100), false);
    assert.equal(hullImpactResult.dmgKey, 0);
  } finally {
    HullBodies.onImpact = null;
    HullBodies.release(e);
  }
});

test('zapytania nie losują i nie zmieniają kadłuba', () => {
  const e = npcAt(0, 0, { angle: 0.3 });
  const hull = HullBodies.createHull(e, NOTCHED);
  const s = hull.body.nodeStore;
  const snapshot = () => [hull.body.activeNodes, Array.from(s.x).join(), Array.from(s.hp).join(), hull.body.pos.x, hull.body.quat.z];
  const ref = snapshot();
  const random = Math.random;
  Math.random = () => { throw new Error('Math.random w zapytaniu'); };
  try {
    for (let k = 0; k < 50; k++) {
      const a = k * 0.37;
      HullBodies.surfaceNormal(e, Math.cos(a) * 180, Math.sin(a) * 90, -Math.cos(a), -Math.sin(a));
      HullBodies.traceThrough(e, -400, k * 4 - 100, 400, 100 - k * 4, 2);
      HullBodies.spriteUvAt(e, Math.cos(a) * 150, Math.sin(a) * 70);
    }
  } finally { Math.random = random; HullBodies.release(e); }
  assert.deepEqual(snapshot(), ref);
});
