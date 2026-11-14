// Pancerz z obrysu (prototyp CPU, src/game/hullDesign/hullDesignShell.js): determinizm, lustro, skorupa w sylwetce,
// otwarcia, wariant projektu (rama bez zmian, sieć systemów bez błędów). Bez zegara ściennego.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { buildHullField, hullFrameIntegrity, sampleHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { pipeNetworkCheck } from '../src/game/hullDesign/hullDesignPipes.js';
import { applyHullShell, axisTrench, buildHullShell, hullShellSilhouette, HD_SHELL_RHYTHMS } from '../src/game/hullDesign/hullDesignShell.js';

const SMALL = { rim: 26, inset: { lo: 38, hi: 130, step: 230, cut: 10, axis: 10, ch: 12, minW: 24 }, bandStep: 22 };

function insideLoops(loops, x, y) {
  let k = false;
  for (const l of loops) for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    const [xi, yi] = l[i], [xj, yj] = l[j];
    if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) k = !k;
  }
  return k;
}

test('skorupa: deterministyczna i w każdym rytmie z rowkami', () => {
  const d = hullDesignPreset('colossus');
  for (const rh of Object.keys(HD_SHELL_RHYTHMS)) {
    const a = buildHullShell(d, { rhythm: rh, ...SMALL });
    const b = buildHullShell(structuredClone(d), { rhythm: rh, ...SMALL });
    assert.deepEqual(a.grooves, b.grooves, rh);
    assert.deepEqual(a.plate, b.plate, rh);
    assert.ok(a.grooves.length > 0, `${rh}: brak rowków`);
  }
});

test('skorupa: rowki z burty y ≤ 0, płyta lustrzana, wszystko w sylwetce', () => {
  const d = hullDesignPreset('colossus');
  const sh = buildHullShell(d, { rhythm: 'zebra', ...SMALL });
  const sil = hullShellSilhouette(d).flat();
  assert.equal(sh.plate.length, 1, 'jedna ciągła płyta');
  for (const g of sh.grooves) for (const [x, y] of g.pts) {
    assert.ok(y <= 1e-9, `rowek na drugiej burcie (${x}, ${y}) — tę daje lustro`);
    assert.ok(insideLoops(sil, x, Math.min(y, -1e-3)), `rowek poza sylwetką (${x}, ${y})`);
  }
  // płyta symetryczna: każdy wierzchołek ma odbicie na obrysie (w tolerancji komórki)
  const P = sh.plate[0].outer;
  for (const [x, y] of P) {
    let best = Infinity;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
      let t = L2 ? ((x - a[0]) * vx + (-y - a[1]) * vy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(a[0] + vx * t - x, a[1] + vy * t + y));
    }
    assert.ok(best < 1e-3, `obrys płyty bez lustra w (${x}, ${y}): ${best}`);
  }
  // wpusty (rytm wzor) — pętle zamknięte wewnątrz płyty
  const w = buildHullShell(d, { rhythm: 'wzor', ...SMALL });
  assert.ok(w.insets.length > 0);
  for (const l of w.insets) for (const [x, y] of l) assert.ok(insideLoops(sil, x, Math.min(y, -1e-3)));
});

test('otwarcia: rów osi to otwór w płycie, rowki go obchodzą', () => {
  const d = hullDesignPreset('dreadnought');
  const trench = axisTrench([[-2896, 0], [-2200, 296], [-200, 416], [1600, 144], [2600, 0]]);
  assert.ok(trench.every((b) => b.op === 'cut' && b.level === 1 && b.y === 0));
  const sh = buildHullShell(d, { rhythm: 'pasy', openings: trench });
  assert.equal(sh.plate.length, 1);
  assert.equal(sh.plate[0].holes.length, 1, 'rów = jeden otwór');
  const hole = sh.plate[0].holes;
  assert.ok(insideLoops(hole, -600, 0) && !insideLoops(hole, 3200, 0));
  for (const g of sh.grooves) for (const [x, y] of g.pts) assert.ok(!insideLoops(hole, x, y - 1e-3), `rowek w rowie (${x}, ${y})`);
});

test('wariant projektu: rama bez zmian, jedna płyta pancerza, sieć bez błędów', () => {
  const d = hullDesignPreset('bellator');
  const f0 = buildHullField(d);
  const v = applyHullShell(d, buildHullShell(d, { rhythm: 'wzor', ...SMALL }));
  const f = buildHullField(v);
  assert.equal(hullFrameIntegrity(f).pieces.length, 1);
  assert.ok(Math.abs(f.area - f0.area) / f0.area < 1e-3, `pole sylwetki ${f0.area} → ${f.area}`);
  // pancerz sięga burty wszędzie poza brzegiem: środek okrętu pod płytą
  assert.ok(sampleHullField(f, 1, 0, -20) < 0);
  const chk = pipeNetworkCheck(f.pipeNet, f);
  assert.equal(chk.freeEnds, 0);
  assert.equal(chk.outside, 0);
  assert.deepEqual(chk.unpowered, []);
  assert.deepEqual(chk.unfueled, []);
  assert.equal(chk.fuelHidden.length, 0);
  assert.equal(v.panels, 0);
});
