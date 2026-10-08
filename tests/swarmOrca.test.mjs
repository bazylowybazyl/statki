// Unikanie roju: ORCA na prostokątach obrysów z kursem — lustro CPU kernela kSteer
// (src/game/swarm/swarmOrca.js ↔ src/3d/swarm/swarmSim.js). Linie, program liniowy (RVO2
// linearProgram2 / 3, linie twarde), zamiana miejsc dronów na okręgu bez zderzeń.
// node --test tests/swarmOrca.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SWARM_ORCA_LINES, swarmOrcaRectLine, swarmOrcaSolve, swarmOrcaViolation, swarmRectGap } from '../src/game/swarm/swarmOrca.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const rect = (x, y, yaw, hx, hy, vx = 0, vy = 0) => ({ x, y, yaw, hx, hy, vx, vy });
const O = { margin: 1.4, tau: 1.5, tauMax: 1.5, share: 0.5, esc: 0.35 };

/** Czy ruch ze stałą prędkością względną prowadzi do nakładania (z zapasem) w horyzoncie. */
function collidesWithin(a, b, rvx, rvy, T, margin) {
  const A = { ...a, hx: a.hx + margin / 2, hy: a.hy + margin / 2 };
  for (let t = 0; t <= T; t += T / 300) {
    const B = { ...b, hx: b.hx + margin / 2, hy: b.hy + margin / 2, x: b.x - rvx * t, y: b.y - rvy * t };
    if (swarmRectGap(A, B) < 0) return true;
  }
  return false;
}

test('czołowo: prędkość zderzeniowa łamie linię, linia przechodzi przez v + ½u', () => {
  const a = rect(0, 0, 0, 16.4, 8.4, 80, 0);
  const b = rect(120, 0, 0, 16.4, 8.4, -80, 0);
  const L = swarmOrcaRectLine(a, b, O, {});
  assert.equal(L.kind, 'vo');
  assert.equal(L.inside, true, 'kurs kolizyjny — prędkość względna w przeszkodzie');
  const lines = Float64Array.of(L.px, L.py, L.dx, L.dy);
  assert.ok(swarmOrcaViolation(lines, 0, a.vx, a.vy) > 0, 'obecna prędkość niedozwolona');
  // Kierunek linii jednostkowy.
  assert.ok(Math.abs(Math.hypot(L.dx, L.dy) - 1) < 1e-9);
  // Wynik programu liniowego leży po dobrej stronie i blisko zamierzonej.
  const s = swarmOrcaSolve(lines, 1, 200, a.vx, a.vy);
  assert.ok(swarmOrcaViolation(lines, 0, s.x, s.y) <= 1e-9);
  assert.equal(s.dense, false);
});

test('przeszkoda prędkości prostokątów: prędkości poza linią dla obu stron nie prowadzą do zderzenia (pół na pół)', () => {
  // Losowe pary obrysów z kursem: prędkość względna po dobrej stronie obu linii (każdy dron
  // odpowiada za połowę) nie prowadzi do nakładania w horyzoncie τ (z dokładnością odcięcia łamaną).
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let checked = 0;
  for (let k = 0; k < 400; k++) {
    const a = rect(0, 0, rnd() * Math.PI, 4 + rnd() * 12, 3 + rnd() * 6, (rnd() - 0.5) * 120, (rnd() - 0.5) * 120);
    const ang = rnd() * Math.PI * 2;
    const d = 40 + rnd() * 80;
    const b = rect(Math.cos(ang) * d, Math.sin(ang) * d, rnd() * Math.PI, 4 + rnd() * 12, 3 + rnd() * 6, (rnd() - 0.5) * 120, (rnd() - 0.5) * 120);
    if (swarmRectGap({ ...a, hx: a.hx + 0.7, hy: a.hy + 0.7 }, { ...b, hx: b.hx + 0.7, hy: b.hy + 0.7 }) < 0) continue;
    const La = swarmOrcaRectLine(a, b, O, {});
    const Lb = swarmOrcaRectLine(b, a, O, {});
    // Nowe prędkości: zamierzone = obecne, rzut na linie (każdy swoją).
    const sa = swarmOrcaSolve(Float64Array.of(La.px, La.py, La.dx, La.dy), 1, 400, a.vx, a.vy);
    const sb = swarmOrcaSolve(Float64Array.of(Lb.px, Lb.py, Lb.dx, Lb.dy), 1, 400, b.vx, b.vy);
    const rvx = sa.x - sb.x;
    const rvy = sa.y - sb.y;
    // Odcięcie łamaną przez wierzchołek bliski jest śmielsze przy samym τ (łamana leży w M):
    // najwcześniejsze wejście w nakładanie w 5000 losowych parach — 0,795 τ; sprawdzamy 0,75 τ.
    assert.equal(collidesWithin(a, b, rvx, rvy, 0.75 * O.tau, O.margin * 0.98), false, `para ${k}`);
    checked++;
  }
  assert.ok(checked > 300, `sprawdzone pary: ${checked}`);
});

test('nakładanie: linia wyjścia wzdłuż osi najmniejszego nakładania', () => {
  const a = rect(0, 0, 0, 8.3, 4.3, 0, 0);
  const b = rect(0, 8, 0, 8.3, 4.3, 0, 0);    // nachodzą w y o 0,6 + zapas
  const L = swarmOrcaRectLine(a, b, O, {});
  assert.equal(L.kind, 'kolizja');
  // Dozwolona strona: ruch w −y (od sąsiada); w +y — niedozwolony.
  const lines = Float64Array.of(L.px, L.py, L.dx, L.dy);
  assert.ok(swarmOrcaViolation(lines, 0, 0, -10) <= 0);
  assert.ok(swarmOrcaViolation(lines, 0, 0, 5) > 0);
});

test('program liniowy: wynik spełnia wszystkie linie, gdy się da; w tłoku linie twarde zostają', () => {
  // Trzy linie ograniczające prędkość do trójkąta wokół (0, 0).
  const lines = [];
  const add = (px, py, nx, ny) => lines.push(px, py, ny, -nx);    // kierunek = normalna obrócona o −90°
  add(10, 0, -1, 0);    // vx ≤ 10
  add(0, 10, 0, -1);    // vy ≤ 10
  add(-5, 0, 1, 0);     // vx ≥ −5
  const L = Float64Array.from(lines);
  const s = swarmOrcaSolve(L, 3, 100, 50, 50);
  assert.equal(s.dense, false);
  for (let k = 0; k < 3; k++) assert.ok(swarmOrcaViolation(L, k, s.x, s.y) <= 1e-9);
  assert.ok(Math.abs(s.x - 10) < 1e-9 && Math.abs(s.y - 10) < 1e-9, 'najbliżej zamierzonej');
  // Sprzeczne: twarda vx ≥ 20 i miękka vx ≤ 0 → wynik spełnia twardą.
  const H = Float64Array.of(20, 0, 0, -1, 0, 0, 0, 1);
  const sh = swarmOrcaSolve(H, 2, 100, 0, 0, {}, 1);
  assert.equal(sh.dense, true);
  assert.ok(swarmOrcaViolation(H, 0, sh.x, sh.y) <= 1e-6, 'twarda spełniona');
  // Bez twardych: najmniejsze największe naruszenie (pół na pół).
  const ss = swarmOrcaSolve(H, 2, 100, 0, 0, {}, 0);
  assert.ok(Math.abs(ss.x - 10) < 1e-6, `kompromis ${ss.x}`);
});

/** Zamiana miejsc na okręgu: ORCA + regulator ze skończonym przyspieszeniem (jak w kernelu). */
function circleSwap({ n, r, hx, hy, vMax, aMax, kV = 20, reach = 0.5, steps = 60 * 40 }) {
  const dt = 1 / 60;
  const D = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    D.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, yaw: (i % 3) * 0.7, hx, hy, tx: -Math.cos(a) * r, ty: -Math.sin(a) * r });
  }
  const L = new Float64Array(SWARM_ORCA_LINES * 4);
  const S = new Float64Array(SWARM_ORCA_LINES);
  let minGap = Infinity;
  for (let step = 0; step < steps; step++) {
    const vNew = [];
    for (const d of D) {
      const ex = d.tx - d.x; const ey = d.ty - d.y; const dist = Math.hypot(ex, ey);
      const sp = Math.min(vMax, Math.sqrt(1.2 * aMax * Math.max(dist - Math.hypot(d.vx, d.vy) * 0.28, 0)), dist * 2.3);
      const ox = dist > 1e-4 ? ex / dist * sp : 0; const oy = dist > 1e-4 ? ey / dist * sp : 0;
      const rr = aMax * reach;
      let nl = 0;
      for (const e of D) {
        if (e === d) continue;
        const ln = swarmOrcaRectLine(d, e, { ...O, share: 0.5 }, {});
        const sl = ln.dx * (ln.py - d.vy) - ln.dy * (ln.px - d.vx);
        if (sl <= -rr) continue;
        if (nl < SWARM_ORCA_LINES) { L.set([ln.px, ln.py, ln.dx, ln.dy], nl * 4); S[nl++] = sl; } else {
          let w = 0; for (let k = 1; k < nl; k++) if (S[k] < S[w]) w = k;
          if (sl > S[w]) { L.set([ln.px, ln.py, ln.dx, ln.dy], w * 4); S[w] = sl; }
        }
      }
      for (let k = 0; k < nl; k++) { L[k * 4] -= d.vx; L[k * 4 + 1] -= d.vy; }
      const s = swarmOrcaSolve(L, nl, rr, ox - d.vx, oy - d.vy);
      let vx = s.x + d.vx; let vy = s.y + d.vy;
      const vl = Math.hypot(vx, vy); if (vl > vMax) { vx *= vMax / vl; vy *= vMax / vl; }
      vNew.push([vx, vy]);
    }
    for (let k = 0; k < n; k++) {
      const d = D[k];
      let ax = (vNew[k][0] - d.vx) * kV; let ay = (vNew[k][1] - d.vy) * kV;
      const al = Math.hypot(ax, ay); if (al > aMax) { ax *= aMax / al; ay *= aMax / al; }
      d.vx += ax * dt; d.vy += ay * dt; d.x += d.vx * dt; d.y += d.vy * dt;
    }
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) minGap = Math.min(minGap, swarmRectGap(D[a], D[b]));
    if (D.every((d) => Math.hypot(d.tx - d.x, d.ty - d.y) < 2)) return { minGap, arrived: true, t: step * dt };
  }
  return { minGap, arrived: D.every((d) => Math.hypot(d.tx - d.x, d.ty - d.y) < 2), t: steps * dt };
}

test('zamiana miejsc na okręgu (L z ładunkiem, M, S): bez zderzeń przy przyspieszeniu klasy', () => {
  for (const c of [
    { n: 12, r: 200, hx: 16.4, hy: 8.4, vMax: 140, aMax: 71 },
    { n: 16, r: 220, hx: 8.3, hy: 4.3, vMax: 170, aMax: 112 },
    { n: 12, r: 150, hx: 5.5, hy: 3.9, vMax: 230, aMax: 200 }
  ]) {
    const res = circleSwap(c);
    assert.ok(res.minGap >= 0, `${c.n} × ${c.hx}: najmniejsza przerwa ${res.minGap.toFixed(2)}`);
    assert.ok(res.arrived, `${c.n} × ${c.hx}: wszyscy u celu (${res.t.toFixed(1)} s)`);
  }
});

test('kernel: lustro CPU zgodne z WGSL (te same liczby: τ, koło osiągalnych, linie, twarde)', () => {
  const src = read('src/3d/swarm/swarmSim.js');
  assert.match(src, /array\('vec4', SWARM_ORCA_LINES\)/, 'tablica linii w kernelu');
  assert.match(src, /orcaLp3\(lines, proj, nLines, nH, fail, rReach, res\)/, 'tłok: linearProgram3 z twardymi');
  assert.match(src, /rReach = aMax\.mul\(U\.orcaReach\)/, 'koło prędkości osiągalnych');
  assert.match(src, /const invT = float\(1\.0\)\.div\(U\.orcaTau\)/, 'odcięcie stałym τ');
  assert.equal(SWARM_ORCA_LINES, 16);
});
