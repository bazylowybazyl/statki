import assert from 'node:assert/strict';
import test from 'node:test';

// Szyk domyślnego rozkazu ruchu RTS (PPM bez przeciągania, formationTargets w index.html →
// computeRtsClassRowTargets), 2026-10-08. Dawne rzędy co 150 / 200 / 230 j. kładły punkty w strefach
// bezpieczeństwa sąsiadów (strefa przeszkody ogranicznika: suma promieni + 150 j., capitalAI.js), a od
// omijania przeszkód w rozkazach (npcCommandPilot.js) okręt staje przed zajętym punktem — grupa kończyła
// rozkaz rozlana, pancerniki 1–2 km przed punktami. W grze: node scripts/webgpu/rozkazy-omijanie-gra.mjs
// --szyk ciasny (A/B: --szyk stary).
// Szyk z przeciągnięciem kursu (krata, computeFormationTargets) — te same progi (testy „drag grid” na
// końcu pliku); w grze: --szyk luzny --sklad 0,0,15 (A/B: --szyk luzny-stary).

import {
  RTS_FORMATION_TUNE,
  computeFormationTargets,
  computeRtsClassRowTargets,
  rtsFormationClass,
  rtsFormationGap,
  rtsFormationPassGap,
  rtsFormationRowDepth,
  rtsFormationDetourGap,
  rtsFormationRowSpacing,
  rtsFormationGridSpacing,
  createMoveCommand,
  computeCommandVisual
} from '../src/game/worldCommandMenu.js';

// Promienie z gry (Terra Nova, 2026-10-08): fregata 89, niszczyciel 148, pancernik 330, lotniskowiec 548.
const R = { frigate_laser: 89, destroyer: 148, battleship: 330, carrier: 548, fighter: 22 };
const CAPITAL = new Set(['destroyer', 'battleship', 'carrier']);

function unit(id, type, x, y) {
  return {
    id, type, x, y, radius: R[type],
    isCapitalShip: CAPITAL.has(type),
    fighter: type === 'fighter'
  };
}

// Skrzydło jak w scripts/webgpu/rozkazy-omijanie-gra.mjs: 4 pancerniki, 6 niszczycieli, 15 fregat
// rozrzuconych za punktem (oś x = kierunek „do wroga”).
function wing(cx = -8000, cy = 0, comp = { battleship: 4, destroyer: 6, frigate_laser: 15 }) {
  const list = [];
  let k = 0;
  for (const [type, n] of Object.entries(comp)) {
    for (let i = 0; i < n; i++, k++) {
      list.push(unit(`${type}-${i}`, type, cx - (k % 3) * 1400 - Math.floor(k / 9) * 900, cy + ((k * 7) % 9 - 4) * 1000));
    }
  }
  return list;
}

// Strefa przeszkody ogranicznika (capitalAI.js considerObstacle) i odstęp separacji sojuszników
// (index.html applySeparationForces: max(suma promieni, tarcze ≈ 1,06 × suma) + max(70, 0,6 × suma)).
const obstacleZone = (a, b) => a.radius + b.radius + 150;
const separation = (a, b) => {
  const sum = a.radius + b.radius;
  return Math.max(sum, 1.06 * sum) + Math.max(70, 0.6 * sum);
};

function axes(angle) {
  return { fx: Math.cos(angle), fy: Math.sin(angle), rx: -Math.sin(angle), ry: Math.cos(angle) };
}

// Rzędy szyku: { depth, units: [{ u, side }] } posortowane wzdłuż fwd.
function rowsOf(targets, anchor, angle) {
  const { fx, fy, rx, ry } = axes(angle);
  const rows = [];
  for (const [u, t] of targets) {
    const depth = (t.x - anchor.x) * fx + (t.y - anchor.y) * fy;
    const side = (t.x - anchor.x) * rx + (t.y - anchor.y) * ry;
    let row = rows.find((r) => Math.abs(r.depth - depth) < 1e-6);
    if (!row) rows.push(row = { depth, units: [] });
    row.units.push({ u, side });
  }
  rows.sort((a, b) => a.depth - b.depth);
  for (const row of rows) row.units.sort((a, b) => a.side - b.side);
  return rows;
}

test('default RTS formation: no point lies in a neighbour\'s obstacle zone or separation distance', () => {
  const units = wing();
  const anchor = { x: 20000, y: 3000 };
  const targets = computeRtsClassRowTargets(units, anchor, 0);
  assert.equal(targets.size, units.length);
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];
      const ta = targets.get(a);
      const tb = targets.get(b);
      const d = Math.hypot(ta.x - tb.x, ta.y - tb.y);
      const need = Math.max(obstacleZone(a, b), separation(a, b));
      assert.ok(d > need, `${a.id} ↔ ${b.id}: ${d.toFixed(0)} j. ≤ ${need.toFixed(0)} j.`);
    }
  }
  // Dawny układ łamał tę regułę już dla dwóch fregat (150 j. przy strefie 328 j.).
  assert.ok(150 < obstacleZone(units[10], units[11]));
});

test('rows by class across the enemy direction, slowest on the approach side, fastest farthest along the way', () => {
  const units = wing();
  const anchor = { x: 20000, y: 3000 };
  for (const angle of [0, 0.7, -2.2]) {
    // Grupa nadlatuje od −fwd: pancerniki w rzędzie najbliżej niej, fregaty najdalej.
    const { fx, fy } = axes(angle);
    const behind = units.map((u) => ({ ...u, x: anchor.x - fx * 9000 + (u.x + 8000), y: anchor.y - fy * 9000 + u.y }));
    const rows = rowsOf(computeRtsClassRowTargets(behind, anchor, angle), anchor, angle);
    const classes = rows.map((r) => [...new Set(r.units.map((e) => rtsFormationClass(e.u)))]);
    assert.deepEqual(classes, [['battleship'], ['destroyer'], ['frigate']], `kąt ${angle}`);
    // Grupa po drugiej stronie punktu (wycofuje się od wroga): kolejność odwrócona — pancerniki od wroga.
    const ahead = behind.map((u) => ({ ...u, x: 2 * anchor.x - u.x, y: 2 * anchor.y - u.y }));
    const rowsBack = rowsOf(computeRtsClassRowTargets(ahead, anchor, angle), anchor, angle);
    assert.deepEqual(rowsBack.map((r) => rtsFormationClass(r.units[0].u)), ['frigate', 'destroyer', 'battleship'], `kąt ${angle} (odwrót)`);
  }
});

test('the formation is centred on the order point and rows are centred on its axis', () => {
  const units = wing();
  const anchor = { x: -1234, y: 5678 };
  const rows = rowsOf(computeRtsClassRowTargets(units, anchor, 1.1), anchor, 1.1);
  assert.ok(Math.abs(rows[0].depth + rows[rows.length - 1].depth) < 1e-6, 'głębokość szyku niewyśrodkowana');
  for (const row of rows) {
    const s = row.units.reduce((acc, e) => acc + e.side, 0) / row.units.length;
    assert.ok(Math.abs(s) < 1e-6, 'rząd niewyśrodkowany');
  }
});

test('rows that later ships have to cross leave room for their detour and separation; depth lets the detour start', () => {
  const units = wing();
  const anchor = { x: 20000, y: 3000 };
  const rows = rowsOf(computeRtsClassRowTargets(units, anchor, 0), anchor, 0);
  for (let i = 0; i < rows.length; i++) {
    const later = rows.slice(i + 1).flatMap((r) => r.units.map((e) => e.u));
    if (!later.length) continue;
    const rPass = Math.max(...later.map((u) => u.radius));
    const rRow = Math.max(...rows[i].units.map((e) => e.u.radius));
    for (let k = 1; k < rows[i].units.length; k++) {
      const gap = rows[i].units[k].side - rows[i].units[k - 1].side;
      // Objazd pilota: styczna do strefy × 1,15 (capitalAI.js computeObstacleDetour) z obu stron.
      assert.ok(gap >= 2 * 1.15 * (rRow + rPass + 150), `rząd ${i}: przejazd ${gap.toFixed(0)} j.`);
      assert.ok(gap >= 2 * separation({ radius: rRow }, { radius: rPass }), `rząd ${i}: separacja w przejeździe`);
    }
    // Objazd zaczyna się, gdy punkt leży za strefą przeszkody o więcej niż promień przybycia (r + 25 j.).
    const next = rows[i + 1];
    const rNext = Math.max(...next.units.map((e) => e.u.radius));
    assert.ok(next.depth - rows[i].depth > rRow + rNext + 150 + rNext + 25, `rzędy ${i}–${i + 1}: za płytko na objazd`);
  }
  assert.ok(rtsFormationPassGap(148, 89) > rtsFormationGap(148, 148));
  assert.ok(rtsFormationRowDepth(148, 89) >= rtsFormationGap(148, 89));
});

test('every point can be reached around a neighbour already standing at its point (also along the own row)', () => {
  // Warunek objazdu pilota rozkazów (capitalAI.js capitalCommandSteer): punkt dalej za przeszkodą niż
  // jej strefa (suma promieni + 150 j.) i promień przybycia (r + 25 j.) — inaczej okręt staje przed sąsiadem.
  const units = wing();
  const anchor = { x: 20000, y: 3000 };
  const targets = computeRtsClassRowTargets(units, anchor, 0);
  for (const a of units) {
    for (const b of units) {
      if (a === b) continue;
      const ta = targets.get(a);
      const tb = targets.get(b);
      const d = Math.hypot(ta.x - tb.x, ta.y - tb.y);
      const need = obstacleZone(a, b) + b.radius + 25 + 24;
      assert.ok(d > need, `${b.id} nie objedzie ${a.id}: ${d.toFixed(0)} j. ≤ ${need.toFixed(0)} j.`);
    }
  }
  assert.ok(rtsFormationRowSpacing(89) >= rtsFormationDetourGap(89, 89));
  assert.ok(rtsFormationRowSpacing(148, 89) >= rtsFormationPassGap(148, 89));
});

test('slots in a row follow the ships\' order across the way (paths to the row do not cross)', () => {
  const units = wing();
  const anchor = { x: 20000, y: 3000 };
  const angle = 0.4;
  const { rx, ry } = axes(angle);
  const targets = computeRtsClassRowTargets(units, anchor, angle);
  for (const row of rowsOf(targets, anchor, angle)) {
    const order = row.units.map((e) => (e.u.x - anchor.x) * rx + (e.u.y - anchor.y) * ry);
    for (let k = 1; k < order.length; k++) assert.ok(order[k] >= order[k - 1], 'tory dojazdu się krzyżują');
  }
});

test('one row per class, spaced by the biggest hull of the class (carrier with battleships)', () => {
  const units = [...wing(-8000, 0, { frigate_laser: 20 }), unit('b0', 'battleship', -9000, 0), unit('c0', 'carrier', -9000, 2000)];
  const anchor = { x: 20000, y: 0 };
  const rows = rowsOf(computeRtsClassRowTargets(units, anchor, 0), anchor, 0);
  assert.deepEqual(rows.map((r) => r.units.length), [2, 20]);
  const big = rows[0].units;
  assert.ok(big[1].side - big[0].side >= rtsFormationPassGap(R.carrier, R.frigate_laser) - 1e-9);
  const small = rows[1].units;
  assert.ok(Math.abs((small[1].side - small[0].side) - rtsFormationRowSpacing(R.frigate_laser, 0, RTS_FORMATION_TUNE)) < 1e-9);
});

test('player sits in the destroyer row, fighters farthest, carriers with battleships', () => {
  const player = { id: 'player', x: -9000, y: 0, pos: { x: -9000, y: 0 }, radius: 300, angle: 0 };
  const units = [
    player,
    unit('d', 'destroyer', -9000, 900),
    unit('c', 'carrier', -9500, -900),
    unit('b', 'battleship', -9500, 1800),
    unit('f', 'frigate_laser', -8800, 0),
    unit('x', 'fighter', -8700, 400)
  ];
  const anchor = { x: 0, y: 0 };
  const targets = computeRtsClassRowTargets(units, anchor, 0, { player });
  const depth = (u) => targets.get(u).x;
  assert.equal(rtsFormationClass(player, player), 'destroyer');
  assert.equal(depth(player), depth(units[1]));
  assert.equal(depth(units[2]), depth(units[3]));
  assert.ok(depth(units[3]) < depth(units[1]) && depth(units[1]) < depth(units[4]) && depth(units[4]) < depth(units[5]));
});

test('the order ghost (command visual) stands exactly on the formation point', () => {
  const units = wing();
  const anchor = { x: 20000, y: 3000 };
  const targets = computeRtsClassRowTargets(units, anchor, 0);
  for (const u of units) {
    const t = targets.get(u);
    const visual = computeCommandVisual(createMoveCommand({ point: t, arrival: u.radius + 25 }), u, u);
    assert.deepEqual(visual.ghost.pos, { x: t.x, y: t.y });
  }
});

test('one ship goes to the point itself; empty selection gives no targets', () => {
  const one = [unit('a', 'destroyer', 500, 500)];
  const t = computeRtsClassRowTargets(one, { x: 10, y: 20 }, 0.3).get(one[0]);
  assert.ok(Math.abs(t.x - 10) < 1e-9 && Math.abs(t.y - 20) < 1e-9);
  assert.equal(computeRtsClassRowTargets([], { x: 0, y: 0 }, 0).size, 0);
});

// --- Szyk z przeciągnięciem kursu (krata, computeFormationTargets) --------------------------------------
// Dawna krata co max(80, 3 × największy promień): same fregaty 267 j. przy strefie przeszkody 328 j.,
// same pancerniki 990 j. przy separacji 1094 j. — z omijaniem przeszkód w rozkazach grupa jednej klasy
// kończyła rozkaz rozlana przed zajętymi punktami.
const DRAG_GROUPS = {
  'fregaty ×15': { frigate_laser: 15 },
  'fregaty ×3': { frigate_laser: 3 },
  'niszczyciele ×6': { destroyer: 6 },
  'pancerniki ×4': { battleship: 4 },
  'pancerniki ×2': { battleship: 2 },
  'skrzydło 4 / 6 / 15': { battleship: 4, destroyer: 6, frigate_laser: 15 },
  'lotniskowiec z fregatami': { carrier: 1, frigate_laser: 8 }
};
const DRAG_ANGLES = [0, 0.7, -2.2, Math.PI / 2];

function eachDragFormation(fn) {
  const anchor = { x: 20000, y: 3000 };
  for (const [name, comp] of Object.entries(DRAG_GROUPS)) {
    const units = wing(-8000, 0, comp);
    for (const angle of DRAG_ANGLES) fn(`${name}, zwrot ${angle.toFixed(2)}`, units, anchor, angle, computeFormationTargets(units, anchor, angle));
  }
}

// Sąsiedzi w kracie: kolejne w rzędzie (ta sama głębokość) i w kolumnie (ten sam rzut w bok).
function gridNeighbours(targets, anchor, angle) {
  const { fx, fy, rx, ry } = axes(angle);
  const pts = [...targets].map(([u, t]) => ({
    u, depth: (t.x - anchor.x) * fx + (t.y - anchor.y) * fy, side: (t.x - anchor.x) * rx + (t.y - anchor.y) * ry
  }));
  const pairs = [];
  const lines = (key, along) => {
    const groups = [];
    for (const p of pts) {
      let g = groups.find((q) => Math.abs(q.at - p[key]) < 1e-6);
      if (!g) groups.push(g = { at: p[key], list: [] });
      g.list.push(p);
    }
    for (const g of groups) {
      g.list.sort((a, b) => a[along] - b[along]);
      for (let k = 1; k < g.list.length; k++) pairs.push([g.list[k - 1], g.list[k], g.list[k][along] - g.list[k - 1][along]]);
    }
  };
  lines('depth', 'side');
  lines('side', 'depth');
  return pairs;
}

test('drag grid: no point lies in a neighbour\'s obstacle zone or separation distance (one class and mixed)', () => {
  eachDragFormation((name, units, anchor, angle, targets) => {
    assert.equal(targets.size, units.length, name);
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i];
        const b = units[j];
        const ta = targets.get(a);
        const tb = targets.get(b);
        const d = Math.hypot(ta.x - tb.x, ta.y - tb.y);
        const need = Math.max(obstacleZone(a, b), separation(a, b));
        assert.ok(d > need, `${name}: ${a.id} ↔ ${b.id} ${d.toFixed(0)} j. ≤ ${need.toFixed(0)} j.`);
      }
    }
  });
  // Dawna krata łamała tę regułę dla grup jednej klasy.
  const f = unit('f0', 'frigate_laser', 0, 0);
  const b = unit('b0', 'battleship', 0, 0);
  assert.ok(3 * f.radius < obstacleZone(f, f));
  assert.ok(3 * b.radius < separation(b, b));
});

test('drag grid: every point can be reached around a neighbour standing at its point, and between two of them', () => {
  // Objazd pilota (capitalAI.js capitalCommandSteer): punkt dalej za przeszkodą niż jej strefa i promień
  // przybycia (r + 25 j. z luzem pilota) — z dowolnego kierunku, bo kierunek nadlotu wybiera gracz.
  eachDragFormation((name, units, anchor, angle, targets) => {
    for (const a of units) {
      for (const b of units) {
        if (a === b) continue;
        const ta = targets.get(a);
        const tb = targets.get(b);
        const d = Math.hypot(ta.x - tb.x, ta.y - tb.y);
        const need = obstacleZone(a, b) + b.radius + 25 + 24;
        assert.ok(d > need, `${name}: ${b.id} nie objedzie ${a.id} (${d.toFixed(0)} j. ≤ ${need.toFixed(0)} j.)`);
      }
    }
    // Krata ≥ 2 × 2: dojeżdżający przejeżdża między dwoma stojącymi sąsiadami (rzędu albo kolumny) —
    // mieści się jego objazd (styczna do strefy × 1,15, computeObstacleDetour) i separacja od obu.
    if (units.length <= 3) return;
    const rPass = Math.max(...units.map((u) => u.radius));
    for (const [p, q, gap] of gridNeighbours(targets, anchor, angle)) {
      const rRow = Math.max(p.u.radius, q.u.radius);
      assert.ok(gap >= 2 * 1.15 * (rRow + rPass + 150), `${name}: przejazd ${p.u.id} | ${q.u.id} ${gap.toFixed(0)} j.`);
      assert.ok(gap >= 2 * separation({ radius: rRow }, { radius: rPass }), `${name}: separacja w przejeździe ${p.u.id} | ${q.u.id}`);
    }
  });
  assert.ok(rtsFormationGridSpacing(89, 15) >= rtsFormationPassGap(89, 89));
  assert.equal(rtsFormationGridSpacing(89, 3), rtsFormationRowSpacing(89));
  assert.ok(rtsFormationGridSpacing(89, 3) >= rtsFormationDetourGap(89, 89));
});

test('drag grid keeps its layout: ⌈√n⌉ columns across the course, centred rows, centre on the point, faceAngle on every target', () => {
  eachDragFormation((name, units, anchor, angle, targets) => {
    const rows = rowsOf(targets, anchor, angle);
    const n = units.length;
    const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n));
    assert.equal(rows.length, Math.ceil(n / cols), name);
    rows.forEach((row, i) => {
      assert.equal(row.units.length, i === rows.length - 1 ? n - i * cols : cols, `${name}: rząd ${i}`);
      const s = row.units.reduce((acc, e) => acc + e.side, 0) / row.units.length;
      assert.ok(Math.abs(s) < 1e-6, `${name}: rząd ${i} niewyśrodkowany`);
    });
    assert.ok(Math.abs(rows[0].depth + rows[rows.length - 1].depth) < 1e-6, `${name}: głębokość niewyśrodkowana`);
    // Jeden odstęp w obu osiach (krata).
    const spacing = rtsFormationGridSpacing(Math.max(...units.map((u) => u.radius)), n);
    for (let i = 1; i < rows.length; i++) assert.ok(Math.abs(rows[i].depth - rows[i - 1].depth - spacing) < 1e-6, name);
    for (const row of rows) {
      for (let k = 1; k < row.units.length; k++) assert.ok(Math.abs(row.units[k].side - row.units[k - 1].side - spacing) < 1e-6, name);
    }
    for (const t of targets.values()) assert.equal(t.faceAngle, angle, name);
  });
  const one = [unit('a', 'destroyer', 500, 500)];
  const t = computeFormationTargets(one, { x: 10, y: 20 }, 0.3).get(one[0]);
  assert.ok(Math.abs(t.x - 10) < 1e-9 && Math.abs(t.y - 20) < 1e-9);
  assert.equal(computeFormationTargets([], { x: 0, y: 0 }, 0).size, 0);
});

test('drag grid: the order ghost stands on the formation point with the dragged course', () => {
  // Podgląd przeciągania (drawRtsPlacementGhosts) i rozkaz (issueMoveOrder) biorą punkty z tej samej
  // funkcji; duch rozkazu (computeCommandVisual) stoi dokładnie w punkcie.
  const units = wing(-8000, 0, { frigate_laser: 15 });
  const anchor = { x: 20000, y: 3000 };
  const angle = 0.7;
  const a = computeFormationTargets(units, anchor, angle);
  const b = computeFormationTargets(units, anchor, angle);
  for (const u of units) {
    const t = a.get(u);
    assert.deepEqual(b.get(u), t);
    const visual = computeCommandVisual(createMoveCommand({ point: t, arrival: u.radius + 25, faceAngle: t.faceAngle }), u, u);
    assert.deepEqual(visual.ghost.pos, { x: t.x, y: t.y });
  }
});

test('drag grid: farthest lines go to the ships farthest ahead, slots in a line follow the ships\' order (paths do not cross)', () => {
  // Dawniej miejsca wg id: tory dojazdu krzyżowały się w kracie, a okręt przecinający ją w poprzek między
  // stojącymi utykał przed punktem. Linie w poprzek nadlotu — rzędy, a gdy grupa nadlatuje z boku zwrotu
  // (oś bliższa kierunkowi od środka grupy do punktu) — kolumny.
  const anchor = { x: 20000, y: 3000 };
  for (const [name, comp] of Object.entries(DRAG_GROUPS)) {
    const units = wing(-8000, 0, comp);
    for (const angle of DRAG_ANGLES) {
      const targets = computeFormationTargets(units, anchor, angle);
      const { fx, fy, rx, ry } = axes(angle);
      let mf = 0;
      let ms = 0;
      for (const u of units) {
        mf += (u.x - anchor.x) * fx + (u.y - anchor.y) * fy;
        ms += (u.x - anchor.x) * rx + (u.y - anchor.y) * ry;
      }
      const crossRows = Math.abs(mf) >= Math.abs(ms);
      const [lx, ly, ax, ay] = crossRows ? [fx, fy, rx, ry] : [rx, ry, fx, fy];
      const travel = (crossRows ? mf : ms) > 0 ? -1 : 1;
      const lineOf = (p) => travel * ((p.x - anchor.x) * lx + (p.y - anchor.y) * ly);
      const alongOf = (p) => (p.x - anchor.x) * ax + (p.y - anchor.y) * ay;
      const lines = new Map();
      for (const u of units) {
        const k = Math.round(lineOf(targets.get(u)));
        if (!lines.has(k)) lines.set(k, []);
        lines.get(k).push(u);
      }
      const keys = [...lines.keys()].sort((a, b) => b - a);
      for (let i = 1; i < keys.length; i++) {
        const far = Math.min(...lines.get(keys[i - 1]).map(lineOf));
        const near = Math.max(...lines.get(keys[i]).map(lineOf));
        assert.ok(far >= near, `${name}, zwrot ${angle.toFixed(2)}: linia ${i - 1} dostała okręt z tyłu grupy`);
      }
      for (const list of lines.values()) {
        list.sort((a, b) => alongOf(targets.get(a)) - alongOf(targets.get(b)));
        for (let k = 1; k < list.length; k++) {
          assert.ok(alongOf(list[k]) >= alongOf(list[k - 1]), `${name}, zwrot ${angle.toFixed(2)}: tory w linii się krzyżują`);
        }
      }
    }
  }
});
