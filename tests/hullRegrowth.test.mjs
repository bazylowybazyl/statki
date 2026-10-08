import test from 'node:test';
import assert from 'node:assert/strict';

// Odrost zniszczonych węzłów kadłuba (src/game/hullBodies.js: regrowCandidates / regrowCell / restoreHull), magazyn
// w układzie konstrukcji (keepLayout), punkty kadłuba z sufitem konstrukcji (src/game/hullIntegrity.js) i naprawa
// w doku (handleRepair w index.html), której sufit już nie cofa.
globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies, HULL_BODY_CONFIG } = await import('../src/game/hullBodies.js');
const { HULL_INTEGRITY, raiseHullHpForRegrowth, hullIntegrityCapFrac } = await import('../src/game/hullIntegrity.js');
const { createHullMountSet, beginHullMountBind, bindHullMount, refreshHullMountSet } = await import('../src/game/hullMounts.js');
const { computeStoreInertia } = await import('../src/game/beamBody3D.js');
const { hullImage } = await import('./helpers/reactorHulls.mjs');
const { readIndexHtml, loadIndexFunction } = await import('./helpers/indexSource.mjs');
const ED = await import('../src/game/engineDamage.js');
const HPS = await import('../src/game/hardpointService.js');
const D = HullBodies.engine;

// Płyta w × h px; `notch` wycina prawą górną ćwiartkę obrazu (kształt nie jest prostokątem).
function plate(w, h, notch = false) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (notch && x > w / 2 && y < h / 2) continue;
      const o = (y * w + x) * 4;
      data[o] = 120 + (x % 40); data[o + 1] = 150; data[o + 2] = 140 + (y % 30); data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const NOTCHED = plate(480, 200, true);
const LONG = plate(480, 160);
const ATLAS = hullImage('atlas').image;
const npcAt = (x, y, extra = {}) => ({ x, y, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 5000, hp: 1000, maxHp: 1000, ...extra });

function release(...entities) {
  for (const e of [...entities, ...window.wrecks]) HullBodies.release(e);
  window.wrecks.length = 0;
}

// Ruch encji jak w grze (gra całkuje encje, silnik synchronizuje ciała).
function step(entities, n = 1, dt = 1 / 120) {
  for (let k = 0; k < n; k++) {
    const all = [...entities, ...window.wrecks];
    for (const e of all) {
      if (e.dead) continue;
      e.x += (e.vx || 0) * dt; e.y += (e.vy || 0) * dt; e.angle += (e.angVel || 0) * dt;
    }
    HullBodies.step(dt, all);
  }
}

// Naprawa R do końca (prostuje wgniecenia, zrasta belki między żywymi węzłami, leczy HP).
function straighten(e) {
  let steps = 0;
  while (HullBodies.repair([e], 1 / 120) && steps < 120 * 20) steps++;
  return steps;
}

// Front odrostu do skutku: komórki z regrowCandidates, każda przez regrowCell.
function regrowFront(e, opts = null) {
  const out = [];
  let grown = 0;
  for (let pass = 0; pass < 500; pass++) {
    if (HullBodies.regrowCandidates(e, out) === 0) break;
    let any = false;
    for (let k = 0; k < out.length; k += 2) if (HullBodies.regrowCell(e, out[k], out[k + 1], opts)) { grown++; any = true; }
    if (!any) break;
  }
  return grown;
}

// Kratery na miarę rany w kilku miejscach kadłuba (świat gry, względem kotwicy encji, w układzie kadłuba).
function holes(e, spots, radius = 26) {
  const c = Math.cos(e.angle), s = Math.sin(e.angle);
  for (const [lx, ly] of spots) {
    const x = e.x + c * lx - s * ly, y = e.y + s * lx + c * ly;
    HullBodies.impact(e, x, y, 2000, { x: -c * 900, y: -s * 900 }, { craterRadius: radius });
  }
}

// Stan kadłuba po KOMÓRKACH: niezależny od numeracji węzłów i od początku układu ciała (wyrównanie środka masy).
function cellState(hull) {
  const body = hull.body, s = body.nodeStore, e = body.beamStore, W = body.dims.x, lm = body.latticeMin;
  const nodes = new Map(), beams = new Map();
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    nodes.set(s.ix[i] + s.iy[i] * W, {
      rx: s.ox[i] - lm.x, ry: s.oy[i] - lm.y, dx: s.x[i] - s.ox[i], dy: s.y[i] - s.oy[i],
      hp: s.hp[i], maxHp: s.maxHp[i], mass: s.mass[i], invMass: s.invMass[i], beamCount: s.beamCount[i],
      local: s.localBeamCount[i], surface: s.surface[i], coverage: s.coverage[i], r: s.r[i]
    });
  }
  for (let b = 0; b < e.count; b++) {
    const a = e.a[b], c = e.b[b];
    if (!s.active[a] || !s.active[c]) continue;
    const ca = s.ix[a] + s.iy[a] * W, cc = s.ix[c] + s.iy[c] * W;
    beams.set(ca < cc ? `${ca}|${cc}` : `${cc}|${ca}`, {
      type: e.type[b], broken: e.broken[b], rest: e.rest[b], restBase: e.restBase[b], fatigue: e.fatigue[b],
      stiffness: e.stiffness[b], brk: e.brk[b], deform: e.deform[b], restBridge: e.restBridge[b]
    });
  }
  return { nodes, beams };
}

const near = (a, b, eps) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

// Kadłub = szablon (świeży kadłub z tego samego obrazu): każda komórka, każda belka, masa i bezwładność ciała.
function assertTemplate(hull, fresh, label) {
  const a = cellState(hull), b = cellState(fresh);
  assert.equal(a.nodes.size, b.nodes.size, `${label}: liczba żywych komórek`);
  assert.equal(a.beams.size, b.beams.size, `${label}: liczba belek o żywych końcach`);
  let bad = 0, first = '';
  for (const [c, n] of b.nodes) {
    const m = a.nodes.get(c);
    const ok = m && near(m.rx, n.rx, 1e-9) && near(m.ry, n.ry, 1e-9) && Math.abs(m.dx) < 1e-9 && Math.abs(m.dy) < 1e-9 &&
      m.hp === n.hp && m.maxHp === n.maxHp && near(m.mass, n.mass, 1e-12) && near(m.invMass, n.invMass, 1e-12) &&
      m.beamCount === n.beamCount && m.local === n.local && m.surface === n.surface && m.coverage === n.coverage && m.r === n.r;
    if (!ok && bad++ === 0) first = `komórka ${c}: ${JSON.stringify(m)} vs ${JSON.stringify(n)}`;
  }
  assert.equal(bad, 0, `${label}: węzły inne niż w szablonie (${bad}); ${first}`);
  for (const [k, n] of b.beams) {
    const m = a.beams.get(k);
    const ok = m && m.type === n.type && m.broken === 0 && m.rest === n.rest && m.restBase === n.restBase && m.fatigue === 0 &&
      m.stiffness === n.stiffness && m.brk === n.brk && m.deform === n.deform && m.restBridge === n.restBridge;
    if (!ok && bad++ === 0) first = `belka ${k}: ${JSON.stringify(m)} vs ${JSON.stringify(n)}`;
  }
  assert.equal(bad, 0, `${label}: belki inne niż w szablonie (${bad}); ${first}`);
  const hb = hull.body, fb = fresh.body;
  assert.equal(hb.activeNodes, fb.activeNodes);
  assert.equal(hb.liveBeams, fb.liveBeams, `${label}: liveBeams`);
  assert.ok(near(hb.mass, fb.mass, 1e-9), `${label}: masa ciała ${hb.mass} vs ${fb.mass}`);
  assert.ok(near(hb.invInertiaLocal[8], fb.invInertiaLocal[8], 1e-6), `${label}: bezwładność`);
  assert.equal(HullBodies.structuralState(hull.entity).ratio, 1);
}

// Pozycja świata komórki przez pozę encji — kotwica sprite'a nie może się ruszyć przy wyrównaniu środka masy.
function cellAt(e, ix, iy) {
  const p = HullBodies.cellWorld(e, ix, iy, {});
  return { x: p.x, y: p.y };
}

function liveCell(hull) {
  const s = hull.body.nodeStore;
  for (let i = 0; i < s.count; i++) if (s.active[i]) return { ix: s.ix[i], iy: s.iy[i] };
  return null;
}

test('front odrostu: dziury po kraterach zarastają od brzegów do szablonu, kotwica encji stoi', () => {
  const e = npcAt(1e6, -2e6, { angle: 0.35 });
  const hull = HullBodies.createHull(e, ATLAS);
  const fresh = npcAt(0, 0);
  HullBodies.createHull(fresh, ATLAS);
  try {
    const body = hull.body, total = hull.baseNodes;
    assert.equal(body.keepLayout, true, 'żywy statek trzyma magazyn w układzie konstrukcji');
    holes(e, [[-500, 40], [-120, -60], [260, 30], [600, -20]], 48);
    step([e], 30);
    const ratioHit = HullBodies.structuralState(e).ratio;
    assert.ok(ratioHit < 0.97, `kratery zabiły węzły: ${ratioHit}`);
    const probe = liveCell(hull), before = cellAt(e, probe.ix, probe.iy);
    straighten(e);
    const grown = regrowFront(e);
    assert.equal(grown, total - Math.round(ratioHit * total), 'odrosło dokładnie tyle, ile zginęło');
    assertTemplate(hull, fresh.beamHull, 'po froncie');
    const after = cellAt(e, probe.ix, probe.iy);
    assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6, 'komórka w świecie tam, gdzie była');
    assert.equal(body.nodeStore.count, total, 'magazyn bez przebudowy (odrost w miejscu)');
    // Środek masy przy początku układu (wyrównywany, gdy odjedzie dalej niż regrowRecenterCells).
    const com = computeStoreInertia(body.nodeStore, body.cellSize).com;
    assert.ok(Math.hypot(com.x, com.y) <= HULL_BODY_CONFIG.regrowRecenterCells * body.cellSize + 1e-9);
  } finally { release(e, fresh); }
});

test('odrośnięte węzły trzymają się: kroki fizyki i sprawdzenie rozpadu nic nie zrywają', () => {
  const e = npcAt(0, 0);
  const hull = HullBodies.createHull(e, NOTCHED);
  try {
    holes(e, [[-120, 30], [60, -50], [150, 40]], 28);
    step([e], 30);
    straighten(e);
    const grown = regrowFront(e);
    assert.ok(grown > 10, `odrosło ${grown}`);
    const body = hull.body, nodes = body.activeNodes, beams = body.liveBeams;
    let debris = 0;
    window.spawnHullDebris = () => { debris++; };
    try {
      step([e], 240);
      body.structureDirty = true;
      D.splitQueue.push(body);
      D.processSplits([body]);
    } finally { delete window.spawnHullDebris; }
    assert.equal(body.activeNodes, nodes, 'żaden węzeł nie zginął');
    assert.equal(body.liveBeams, beams, 'żadna belka nie pękła');
    assert.equal(debris, 0, 'bez odłamków');
    assert.equal(window.wrecks.length, 0);
  } finally { release(e); }
});

test('przy wgnieceniu odrost czeka: front tylko w zakresie sprężystym, odrośnięte nie pękają; naprawa R odblokowuje', () => {
  const e = npcAt(0, 0);
  const hull = HullBodies.createHull(e, ATLAS);
  try {
    holes(e, [[-300, 0], [200, 20]], 48);
    step([e], 20);
    const body = hull.body, total = hull.baseNodes, s = body.nodeStore, W = body.dims.x, cs = body.cellSize;
    const out = [];
    const strict = HullBodies.regrowCandidates(e, out);
    assert.equal(HullBodies.regrowCandidates(e, [], { any: true }) >= strict, true);
    assert.ok(strict > 4, `front: ${strict}`);
    // Wgniecenie przy komórce frontu: jeden żywy sąsiad przesunięty o 0,3 komórki względem reszty (belki ścinane
    // ponad zakres sprężysty) — komórka wypada ze ścisłego frontu, regrowCell jej nie przyjmuje.
    const lattice = D._latticeIndex(body).cells;
    const [cx, cy] = [out[0], out[1]];
    let dented = -1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = lattice[(cx + dx) + (cy + dy) * W];
      if (j >= 0 && s.active[j]) { dented = j; break; }
    }
    assert.ok(dented >= 0);
    s.x[dented] += 0.3 * cs; s.y[dented] -= 0.2 * cs;
    body._hashTick = -1;
    const inFront = (list, x, y) => { for (let k = 0; k < list.length; k += 2) if (list[k] === x && list[k + 1] === y) return true; return false; };
    const strictNow = [], anyNow = [];
    HullBodies.regrowCandidates(e, strictNow);
    HullBodies.regrowCandidates(e, anyNow, { any: true });
    assert.equal(inFront(strictNow, cx, cy), false, 'komórka przy wgnieceniu poza ścisłym frontem');
    assert.equal(inFront(anyNow, cx, cy), true, '…ale w całym froncie (opts.any)');
    assert.equal(HullBodies.regrowCell(e, cx, cy), false, 'węzeł przy wgnieceniu nie odrasta');
    // To, co front dopuszcza teraz (bez prostowania), odrasta i trzyma się w ruchu.
    const grown = regrowFront(e);
    const nodes = body.activeNodes;
    let debris = 0;
    window.spawnHullDebris = () => { debris++; };
    try { step([e], 240); } finally { delete window.spawnHullDebris; }
    assert.ok(grown > 0);
    assert.equal(body.activeNodes, nodes, `odrośnięte przy krawędzi wgniecenia nie giną (odłamki: ${debris})`);
    // Naprawa R prostuje — reszta frontu odrasta do pełna.
    straighten(e);
    regrowFront(e);
    assert.equal(body.activeNodes, total);
  } finally { release(e); }
});

test('odcięta sekcja odrasta od kikuta; magazyn żywego statku bez zagęszczenia', () => {
  const e = npcAt(0, 0);
  const hull = HullBodies.createHull(e, LONG);
  const fresh = npcAt(0, 0);
  HullBodies.createHull(fresh, LONG);
  try {
    const body = hull.body, total = body.nodeStore.count, store = body.nodeStore;
    // Pas przez środek: dwie połowy po ~40% węzłów — kikut poniżej progu zagęszczenia (compactBelow 0,5).
    HullBodies.cutSegment(e, 0, -300, 0, 300, 48);
    step([e], 30);
    assert.equal(window.wrecks.length, 1, 'połowa odpadła jako wrak');
    assert.ok(body.activeNodes < 0.5 * total, `kikut ${body.activeNodes}/${total}`);
    assert.equal(body.nodeStore, store, 'rozpad w miejscu — ten sam magazyn (keepLayout)');
    const wreckNodes = window.wrecks[0].beamHull.body.activeNodes;
    straighten(e);
    regrowFront(e);
    assertTemplate(hull, fresh.beamHull, 'po odroście sekcji');
    assert.equal(window.wrecks[0].beamHull.body.activeNodes, wreckNodes, 'wrak odciętej sekcji bez zmian');
    assert.equal(HullBodies.regrowCell(window.wrecks[0], 1, 1), false, 'wrak nie odrasta');
  } finally { release(e, fresh); }
});

test('magazyn zagęszczony (ciało bez keepLayout): odrost raz dopisuje komórki szablonu, potem ożywia w miejscu', () => {
  const e = npcAt(0, 0);
  const hull = HullBodies.createHull(e, LONG);
  const fresh = npcAt(0, 0);
  HullBodies.createHull(fresh, LONG);
  try {
    const body = hull.body, total = body.nodeStore.count;
    body.keepLayout = false;
    const views = body.nodes;          // widoki węzłów (kod spoza silnika) — tożsamość ma przeżyć dopisanie
    HullBodies.cutSegment(e, 0, -300, 0, 300, 48);
    step([e], 30);
    const compacted = body.nodeStore;
    assert.ok(compacted.count < total, `zagęszczony: ${compacted.count}/${total}`);
    const keepView = body.nodes[3];
    assert.ok(views.includes(keepView), 'widok przepięty przy zagęszczeniu');
    straighten(e);
    const out = [];
    assert.ok(HullBodies.regrowCandidates(e, out) > 0);
    assert.equal(HullBodies.regrowCell(e, out[0], out[1]), true);
    const expanded = body.nodeStore;
    assert.notEqual(expanded, compacted, 'nowy magazyn');
    assert.equal(expanded.count, total, 'wszystkie komórki szablonu w magazynie');
    assert.equal(body.nodes[3], keepView, 'widok węzła ten sam pod tym samym indeksem');
    assert.equal(keepView._s, expanded);
    regrowFront(e);
    assert.equal(body.nodeStore, expanded, 'dalej w miejscu');
    assertTemplate(hull, fresh.beamHull, 'po odroście z zagęszczonego');
    // Zrośnięty kadłub dalej żyje w silniku: krater, kroki, rozpad — bez błędów i bez wycieku węzłów.
    holes(e, [[100, 0]], 30);
    step([e], 60);
    assert.ok(body.activeNodes < total && body.activeNodes > total * 0.8);
  } finally { release(e, fresh); }
});

test('pełny remont (restoreHull): szablon z kraterów, zgniotu, wgnieceń i rozpadu — także z magazynu zagęszczonego', () => {
  for (const keep of [true, false]) {
    const e = npcAt(3e5, 1e5, { angle: -0.8 });
    const hull = HullBodies.createHull(e, ATLAS);
    const fresh = npcAt(0, 0);
    HullBodies.createHull(fresh, ATLAS);
    const repairs = [];
    const prev = HullBodies.onRepair;
    HullBodies.onRepair = (ent, dt, changed) => repairs.push({ ent, changed });
    try {
      const body = hull.body;
      body.keepLayout = keep;
      holes(e, [[-600, 0], [-300, 50], [0, -40], [400, 10]], 40);
      HullBodies.cutSegment(e, e.x - 200, e.y - 600, e.x - 200, e.y + 600, 60);
      step([e], 40);
      const killed = hull.baseNodes - body.activeNodes;
      assert.ok(killed > 100, `zniszczone: ${killed}`);
      const probe = liveCell(hull), before = cellAt(e, probe.ix, probe.iy);
      const regrown = HullBodies.restoreHull(e);
      assert.equal(regrown, killed, `odrosło ${regrown} z ${killed}`);
      assertTemplate(hull, fresh.beamHull, keep ? 'remont w miejscu' : 'remont z zagęszczonego');
      const after = cellAt(e, probe.ix, probe.iy);
      assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6, 'encja w miejscu');
      assert.ok(Math.abs(body.latticeMin.x - fresh.beamHull.body.latticeMin.x) < 1e-6 &&
        Math.abs(body.latticeMin.y - fresh.beamHull.body.latticeMin.y) < 1e-6, 'początek układu = środek masy szablonu');
      assert.deepEqual(repairs.map((r) => [r.ent === e, r.changed]), [[true, false]], 'mapa ran: naprawa zakończona');
      assert.equal(body._region?.list.length ?? 0, 0, 'solver nie dostał kadłuba');
      assert.equal(HullBodies.restoreHull(e), 0, 'cały kadłub — nic do odrostu');
      // Masa gry encji wraca razem z masą ciała (syncOut skaluje ją jak przy utracie).
      step([e], 2);
      assert.ok(near(e.mass, 5000, 1e-9), `masa gry ${e.mass}`);
    } finally {
      HullBodies.onRepair = prev;
      release(e, fresh);
    }
  }
});

test('odrost w miejscu zachowuje pancerz komórek (mostek, komora reaktora mnożą maks. HP węzła)', () => {
  const e = npcAt(0, 0);
  const hull = HullBodies.createHull(e, NOTCHED);
  try {
    const body = hull.body, s = body.nodeStore, W = body.dims.x;
    // Komórki w kole jak komora reaktora: maks. HP × 4 (attachReactorCores / attachBeamBridges robią to samo).
    const armored = [];
    for (let i = 0; i < s.count; i++) {
      const lx = s.ox[i] - body.latticeMin.x - hull.anchorDX, ly = s.oy[i] - body.latticeMin.y - hull.anchorDY;
      if (Math.hypot(lx + 100, ly) > 35) continue;
      s.maxHp[i] *= 4; s.hp[i] = s.maxHp[i];
      armored.push({ cell: s.ix[i] + s.iy[i] * W, maxHp: s.maxHp[i] });
    }
    assert.ok(armored.length > 4);
    HullBodies.impact(e, e.x - 100, e.y, 5000, { x: 900, y: 0 }, { craterRadius: 30 });
    step([e], 20);
    const dead = armored.filter((a) => !HullBodies.hasCell(e, `${a.cell % W},${Math.floor(a.cell / W)}`));
    assert.ok(dead.length > 0, 'krater zabił komórki pancerza');
    HullBodies.restoreHull(e);
    const st = cellState(hull);
    for (const a of armored) assert.equal(st.nodes.get(a.cell).maxHp, a.maxHp, `komórka ${a.cell}: pancerz zachowany`);
  } finally { release(e); }
});

test('odrost: skóra, siatka węzłów, mocowania lamp i dysz, rewizja kadłuba i obrys planu', () => {
  const e = npcAt(0, 0);
  const hull = HullBodies.createHull(e, NOTCHED);
  try {
    const body = hull.body;
    // Mocowanie (lampa) w miejscu przyszłego krateru: px renderu od środka sprite'a, x ku dziobowi, y w dół.
    const set = createHullMountSet();
    const rest = beginHullMountBind(set, hull, 2);
    set.cells[0] = bindHullMount(hull, -120, 20, rest);
    set.cells[1] = bindHullMount(hull, 150, 40, rest);
    refreshHullMountSet(set, hull);
    assert.deepEqual([...set.alive.subarray(0, 2)], [1, 1]);
    const cellsBefore = HullBodies.shieldCells(e);
    HullBodies.impact(e, e.x - 120, e.y + 20, 5000, { x: 900, y: 0 }, { craterRadius: 30 });
    step([e], 20);
    refreshHullMountSet(set, hull);
    assert.equal(set.alive[0], 0, 'lampa zgasła z komórką');
    straighten(e);
    const rev = hull.revision;
    body.meshDirty = false;
    const region = body._region;
    if (region) { region.dirtyAll = false; region.dirtyCount = 0; body.nodeStore.skinDirty.fill(0); }
    body._hashTick = 7;
    const out = [];
    assert.ok(HullBodies.regrowCandidates(e, out) > 0);
    const W = body.dims.x;
    const cell = out[0] + out[1] * W;
    assert.equal(HullBodies.regrowCell(e, out[0], out[1]), true);
    const i = D._latticeIndex(body).cells[cell];
    assert.equal(body.nodeStore.active[i], 1);
    assert.ok(body.meshDirty, 'skóra do przepisania');
    const r = body._region;
    assert.ok(r.dirtyAll || Array.from(r.dirty.subarray(0, r.dirtyCount)).includes(i), 'czworokąt nowego węzła w liście skóry');
    assert.equal(body._hashTick, -1, 'siatka węzłów od nowa');
    assert.equal(hull.revision, rev + 1, 'rewizja kadłuba (model 3D, przekroje)');
    regrowFront(e);
    refreshHullMountSet(set, hull);
    assert.deepEqual([...set.alive.subarray(0, 2)], [1, 1], 'lampa świeci z odrośniętą komórką');
    assert.equal(HullBodies.shieldCells(e), cellsBefore, 'ten sam magazyn — ten sam obrys');
  } finally { release(e); }
});

test('regrowCell / restoreHull: komórka żywa, poza szablonem i poza siatką, wrak, budowla — nic', () => {
  const e = npcAt(0, 0);
  const hull = HullBodies.createHull(e, NOTCHED);
  const site = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 1e6 };
  HullBodies.createHull(site, NOTCHED, { world: { id: 'test' } });
  try {
    const body = hull.body, s = body.nodeStore, d = body.dims;
    assert.equal(HullBodies.regrowCell(e, s.ix[0], s.iy[0]), false, 'komórka żywa');
    assert.equal(HullBodies.regrowCell(e, -1, 0), false);
    assert.equal(HullBodies.regrowCell(e, d.x, 0), false);
    assert.equal(HullBodies.regrowCell(e, 1.5, 2), false);
    // Wycięcie obrazu (prawa górna ćwiartka): komórki poza szablonem.
    assert.equal(HullBodies.regrowCell(e, d.x - 1, d.y - 1), false, 'komórka poza szablonem');
    assert.equal(HullBodies.regrowCandidates(e, []), 0, 'cały kadłub — pusty front');
    assert.equal(site.beamHull.body.keepLayout, false, 'budowla zagęszcza się jak dawniej');
    assert.equal(HullBodies.restoreHull(site), -1, 'budowla nie odrasta');
    assert.equal(HullBodies.regrowCandidates(site, []), 0);
    assert.equal(HullBodies.restoreHull(null), -1);
    const wreck = HullBodies.convertToWreck(e);
    assert.equal(wreck.beamHull.body.keepLayout, false, 'wrak zagęszcza się po rozpadzie');
    assert.equal(HullBodies.restoreHull(wreck), -1, 'wrak nie odrasta');
  } finally { release(e, site); }
});

test('keepLayout nie zmienia fizyki: rozpad w miejscu ≡ zagęszczenie (ten sam stan po rozcięciu i krokach)', () => {
  const run = (keep) => {
    window.wrecks.length = 0;
    const e = npcAt(10, -20, { angle: 0.2, vx: 40, vy: -15, angVel: 0.08 });
    HullBodies.createHull(e, LONG);
    e.beamHull.body.keepLayout = keep;
    const c = Math.cos(0.2), s = Math.sin(0.2);
    HullBodies.cutSegment(e, e.x - s * 300 + c * 20, e.y + c * 300 + s * 20, e.x + s * 300 + c * 20, e.y - c * 300 + s * 20, 48, { push: true });
    HullBodies.impact(e, e.x - c * 150, e.y - s * 150, 3000, { x: c * 800, y: s * 800 });
    step([e], 90);
    const bodies = [e.beamHull.body, ...window.wrecks.map((w) => w.beamHull?.body).filter(Boolean)];
    const out = { hash: canonicalHash(bodies), count: e.beamHull.body.nodeStore.count, wrecks: window.wrecks.length,
      pose: [e.x, e.y, e.angle, e.vx, e.vy, e.angVel] };
    release(e);
    return out;
  };
  const kept = run(true), compact = run(false);
  assert.ok(kept.wrecks > 0, 'rozcięcie dało wrak');
  assert.ok(compact.count < kept.count, `zagęszczenie w wersji bez flagi: ${compact.count} < ${kept.count}`);
  assert.equal(kept.hash, compact.hash, 'ten sam stan fizyki');
  assert.deepEqual(kept.pose, compact.pose, 'ta sama poza encji');
});

// Stan fizyki niezależny od dziur w magazynach i numeracji (jak tests/beamSplitInPlace.test.mjs).
function canonicalHash(bodies) {
  const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  let h = 0x811c9dc5;
  const mixU = (v) => { h ^= v >>> 0; h = Math.imul(h, 0x01000193) >>> 0; };
  const mix = (v) => { f64[0] = v; mixU(u32[0]); mixU(u32[1]); };
  for (const b of bodies) {
    if (b.dead) continue;
    for (const v of [b.pos.x, b.pos.y, b.vel.x, b.vel.y, b.quat.z, b.quat.w, b.angVel.z, b.mass, b.activeNodes, b.liveBeams]) mix(v);
    const s = b.nodeStore, e = b.beamStore, rank = new Int32Array(s.count).fill(-1);
    let r = 0;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      rank[i] = r++;
      for (const v of [s.x[i], s.y[i], s.vx[i], s.vy[i], s.hp[i], s.ox[i], s.oy[i], s.beamCount[i]]) mix(v);
    }
    for (let k = 0; k < e.count; k++) {
      const a = e.a[k], c = e.b[k];
      if (!s.active[a] || !s.active[c]) continue;
      mixU(rank[a]); mixU(rank[c]); mix(e.broken[k]); mix(e.rest[k]); mix(e.fatigue[k]);
    }
  }
  return h.toString(16);
}

// ============================ PUNKTY KADŁUBA ============================

test('punkty z sufitem konstrukcji: odrost podnosi o różnicę sufitów (gracz 2,35, NPC 2,2), do maks.', () => {
  assert.equal(HULL_INTEGRITY.playerExponent, 2.35);
  assert.equal(HULL_INTEGRITY.npcExponent, 2.2);
  const player = { isPlayer: true, hull: { val: 0, max: 2000 } };
  player.hull.val = 2000 * hullIntegrityCapFrac(0.6, 2.35);
  const gain = raiseHullHpForRegrowth(player, 0.6, 0.9);
  assert.ok(near(player.hull.val, 2000 * 0.9 ** 2.35, 1e-12), `gracz na nowym suficie: ${player.hull.val}`);
  assert.ok(near(gain, 2000 * (0.9 ** 2.35 - 0.6 ** 2.35), 1e-12));
  // Pod sufitem (trafienia bez utraty węzłów) zostaje pod nim o tyle samo.
  const npc = { hp: 100, maxHp: 1000 };
  raiseHullHpForRegrowth(npc, 0.5, 1);
  assert.ok(near(npc.hp, 100 + 1000 * (1 - 0.5 ** 2.2), 1e-12));
  // Do maks., nie wyżej; bez wzrostu udziału — nic.
  const full = { hp: 990, maxHp: 1000 };
  raiseHullHpForRegrowth(full, 0.95, 1);
  assert.equal(full.hp, 1000);
  assert.equal(raiseHullHpForRegrowth({ hp: 10, maxHp: 1000 }, 0.8, 0.8), 0);
  // Zniszczony nie ożywa.
  for (const dead of [{ hp: 0, maxHp: 1000 }, { hp: 50, maxHp: 1000, dead: true }, { hp: 50, maxHp: 1000, isWreck: true },
    { isPlayer: true, destroyed: true, hull: { val: 10, max: 100 } }, { isPlayer: true, hull: { val: 0, max: 100 } }]) {
    assert.equal(raiseHullHpForRegrowth(dead, 0.2, 1), 0);
  }
});

test('hak onRegrow: punkty NPC rosną z odrostem do pełna (przy suficie)', () => {
  const e = npcAt(0, 0, { hp: 1000, maxHp: 1000 });
  const hull = HullBodies.createHull(e, NOTCHED);
  const prev = HullBodies.onRegrow;
  const calls = [];
  HullBodies.onRegrow = (ent, a, b) => { calls.push([a, b]); raiseHullHpForRegrowth(ent, a, b); };
  try {
    holes(e, [[-100, 0], [100, 40]], 30);
    step([e], 20);
    const ratio = HullBodies.structuralState(e).ratio;
    e.hp = 1000 * ratio ** HULL_INTEGRITY.npcExponent;         // sufit (enforceNpcHexIntegrityBalance)
    straighten(e);
    regrowFront(e);
    assert.ok(calls.length > 0 && near(calls[0][0], ratio, 1e-12), 'udział przed pierwszym odrostem');
    assert.equal(calls.at(-1)[1], 1);
    assert.ok(near(e.hp, 1000, 1e-9), `pełne punkty: ${e.hp}`);
    assert.equal(hull.body.activeNodes, hull.baseNodes);
  } finally {
    HullBodies.onRegrow = prev;
    release(e);
  }
});

// ============================ DOK ============================

test('naprawa w doku: kadłub odrasta do szablonu, punkty pełne — sufit konstrukcji jej nie cofa', () => {
  const html = readIndexHtml();
  assert.match(html, /HullBodies\.onRegrow = raiseHullHpForRegrowth;/, 'gra podpina punkty pod odrost');
  const ship = { x: 2e6, y: 5e6, vx: 0, vy: 0, angle: 1.1, angVel: 0, mass: 200000, isPlayer: true, hull: { val: 3000, max: 3000 } };
  HullBodies.createHull(ship, ATLAS);
  const fresh = npcAt(0, 0);
  HullBodies.createHull(fresh, ATLAS);
  const toasts = [];
  const scope = {
    ship, npcs: [], HullBodies, HULL_INTEGRITY, PLAYER: { credits: 5000 },
    toast: (m) => toasts.push(m), updateStationOverlay: () => {}, stationUI: { tab: 'hangar', station: null },
    _hullStructState: { active: 0, total: 0, ratio: 1 }, getHexStructuralState: () => null,
    applyDamageToPlayer: (amount) => { ship.hull.val = Math.max(0, ship.hull.val - amount); },
    applyDamageToNPC: () => {}, isBridgeHulk: () => false, NPC_CRUSH_DEATH_RATIO: HULL_INTEGRITY.npcCrushDeathRatio
  };
  // Remont w doku zdejmuje też zatrzaski zniszczonych dysz MAIN (src/game/engineDamage.js; ten kadłub bez dysz).
  Object.assign(scope, {
    mainEngineCounts: ED.mainEngineCounts, repairEngines: ED.repairEngines, ENGINE_REPAIR: ED.ENGINE_REPAIR,
    _engineCountsScratch: { live: 0, total: 0 }
  });
  // Remont wymienia też łaty polowe roju dronów (src/game/repairRig.js; tu kadłub bez łat — koszt 0).
  scope.repairPatchCost = loadIndexFunction(html, 'function repairPatchCost(patches) {', 'repairPatchCost', scope);
  // Remont przywraca też zniszczone gniazda broni gracza (src/game/hardpointService.js; tu statek bez gniazd —
  // koszt 0; gniazda: tests/playerFitSave.test.mjs).
  Object.assign(scope, {
    HARDPOINT_SERVICE: HPS.HARDPOINT_SERVICE,
    countDestroyedHardpoints: HPS.countDestroyedHardpoints,
    restoreDestroyedHardpoints: HPS.restoreDestroyedHardpoints
  });
  scope.dockRemontShip = loadIndexFunction(html, 'function dockRemontShip(target) {', 'dockRemontShip', scope);
  // Wycena remontu — wspólna dla hangaru, WYPOSAŻENIA i handleRepair.
  scope.playerDockRepairQuote = loadIndexFunction(html, 'function playerDockRepairQuote() {', 'playerDockRepairQuote', scope);
  scope.getHullStructuralState = loadIndexFunction(html, 'function getHullStructuralState(entity) {', 'getHullStructuralState', scope);
  const enforce = loadIndexFunction(html, 'function enforceNpcHexIntegrityBalance() {', 'enforceNpcHexIntegrityBalance', scope);
  const handleRepair = loadIndexFunction(html, 'function handleRepair() {', 'handleRepair', scope);
  try {
    holes(ship, [[-500, 30], [-100, -40], [350, 0]], 48);
    step([ship], 30);
    enforce();
    const ratio = HullBodies.structuralState(ship).ratio;
    assert.ok(ratio < 0.98);
    assert.ok(near(ship.hull.val, 3000 * ratio ** 2.35, 1e-9), `punkty na suficie konstrukcji: ${ship.hull.val}`);
    // Sam wpis punktów bez odrostu (dawna naprawa) sufit cofa w następnym sprawdzeniu.
    const val = ship.hull.val;
    ship.hull.val = 3000;
    enforce();
    assert.ok(near(ship.hull.val, val, 1e-9), 'bez odrostu sufit cofa naprawę');
    const cost = Math.ceil((1 - ship.hull.val / 3000) * 600);
    handleRepair();
    assert.equal(scope.PLAYER.credits, 5000 - cost, 'cena bez zmian');
    assert.equal(ship.hull.val, 3000);
    assert.equal(toasts.at(-1), 'Naprawiono kadłub.');
    assertTemplate(ship.beamHull, fresh.beamHull, 'po remoncie w doku');
    for (let k = 0; k < 6; k++) { step([ship], 3); enforce(); }
    assert.equal(ship.hull.val, 3000, 'naprawa się trzyma');
    handleRepair();
    assert.equal(toasts.at(-1), 'Kadłub jest w pełni sprawny');
  } finally { release(ship, fresh); }
});
