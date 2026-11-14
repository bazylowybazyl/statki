// Pancerz z obrysu (pole projektu `shell`, src/game/hullDesign/hullDesignShell.js): normalizacja i strażnik, jedna
// ciągła płyta w sylwetce, lustro, otwarcia (rów osi, wnęki przy przyłączach paliwa), rytmy A / B / C, determinizm,
// sieć systemów i rama bez zmian, flota TN bez skorupy. Bez zegara ściennego.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hullDesignPreset, HD_PRESET_KEYS } from '../src/game/hullDesign/hullDesignPresets.js';
import { expandHullDesign, normalizeHullDesign, hullDesignLookKey } from '../src/game/hullDesign/hullDesignSchema.js';
import { buildHullField, hullFrameIntegrity, sampleHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { pipeNetworkCheck } from '../src/game/hullDesign/hullDesignPipes.js';
import { isPlayerBuildable } from '../src/game/hullDesign/hullDesignBuildable.js';
import { axisTrench, normalizeHullShell, HD_SHELL_RHYTHM_KEYS, HD_SHELL_LIMITS } from '../src/game/hullDesign/hullDesignShell.js';

const SMALL = { rim: 26, bandStep: 22, inset: { lo: 38, hi: 130, step: 230, cut: 10, axis: 10, ch: 12, minW: 24 } };
const withShell = (key, shell) => ({ ...hullDesignPreset(key), shell, panels: 0 });

function insideLoops(loops, x, y) {
  let k = false;
  for (const l of loops) for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    const [xi, yi] = l[i], [xj, yj] = l[j];
    if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) k = !k;
  }
  return k;
}
const shellPlates = (ex) => ex.shapes.filter((s) => s.blockSet === 'shell');
const frameLoops = (ex) => ex.shapes.filter((s) => s.blockSet === 'frame').flatMap((s) => [s.pts, ...(s.holes || [])]);

test('normalizacja: brak / false / on:false → null, rytm z listy, zakresy obcięte; strażnik odrzuca surowe spoza zakresu', () => {
  assert.equal(normalizeHullShell(undefined), null);
  assert.equal(normalizeHullShell(false), null);
  assert.equal(normalizeHullShell({ on: false, rhythm: 'pasy' }), null);
  assert.equal(normalizeHullDesign({}).shell, null);
  for (const k of HD_SHELL_RHYTHM_KEYS) assert.equal(normalizeHullShell({ rhythm: k }).rhythm, k);
  assert.equal(normalizeHullShell({ rhythm: 'xx' }).rhythm, 'wzor');
  const n = normalizeHullShell({ rhythm: 'pasy', rim: 9999, bands: 99 });
  assert.deepEqual([n.rim, n.bands], [HD_SHELL_LIMITS.rim[1], HD_SHELL_LIMITS.bands[1]]);
  assert.equal(normalizeHullShell({ rhythm: 'wzor', inset: null }).inset, null);
  const ok = isPlayerBuildable(withShell('bellator', { rhythm: 'zebra', ...SMALL }));
  assert.ok(!ok.violations.some((v) => v.where === 'shell'), ok.violations.map((v) => v.text).join('; '));
  const bad = isPlayerBuildable(withShell('bellator', { rhythm: 'xx', rim: 9999 }));
  assert.equal(bad.violations.filter((v) => v.where === 'shell').length, 2);
  // pole zmienia kształt: jest w kluczu wyglądu (ścieżka wyglądu nie może go pominąć)
  assert.notEqual(hullDesignLookKey(normalizeHullDesign(withShell('bellator', { rhythm: 'wzor' }))),
    hullDesignLookKey(normalizeHullDesign(withShell('bellator', { rhythm: 'pasy' }))));
});

test('flota TN bez skorupy (domyślnie wyłączona), drednot — ze skorupą', () => {
  for (const k of HD_PRESET_KEYS) {
    const d = normalizeHullDesign(hullDesignPreset(k));
    assert.equal(!!d.shell, k === 'dreadnought', k);
  }
});

test('skorupa: jedna płyta w sylwetce, rowki z burty y ≤ 0 z kopią lustra, deterministyczna, każdy rytm z rowkami', () => {
  for (const rh of HD_SHELL_RHYTHM_KEYS) {
    const a = expandHullDesign(withShell('colossus', { rhythm: rh, ...SMALL }));
    const b = expandHullDesign(structuredClone(withShell('colossus', { rhythm: rh, ...SMALL })));
    assert.deepEqual(a.grooves, b.grooves, rh);
    assert.deepEqual(shellPlates(a), shellPlates(b), rh);
    assert.equal(shellPlates(a).length, 1, `${rh}: jedna ciągła płyta`);
    const own = a.grooves.filter((g) => !g.mirrorOf);
    assert.ok(own.length > 0, `${rh}: brak rowków`);
    const sil = frameLoops(a);
    for (const g of own) for (const [x, y] of g.pts) {
      assert.ok(y <= 1e-9, `${rh}: rowek na drugiej burcie (${x}, ${y})`);
      assert.ok(insideLoops(sil, x, Math.min(y, -1e-3)), `${rh}: rowek poza sylwetką (${x}, ${y})`);
    }
    // każdy rowek poza osią ma kopię lustra
    for (const g of own) if (g.pts.some(([, y]) => Math.abs(y) > 0.5)) assert.ok(a.grooves.some((q) => q.mirrorOf && q.pts[0][1] === -g.pts[0][1] && q.pts[0][0] === g.pts[0][0]));
  }
});

test('otwarcia: rów osi (klocki-wycięcia) to otwór w płycie, nadbudówki w rowie zostają, rowki obchodzą rów', () => {
  const d = withShell('dreadnought', { rhythm: 'pasy' });
  const ex = expandHullDesign(d);
  const plates = shellPlates(ex);
  assert.equal(plates.length, 1);
  assert.ok(plates[0].holes?.length >= 1, 'rów = otwór');
  const hole = plates[0].holes;
  assert.ok(insideLoops(hole, -600, 0) && !insideLoops(hole, 3200, 0));
  for (const g of ex.grooves) for (const [x, y] of g.pts) assert.ok(!insideLoops(hole, x, y - Math.sign(y || 1) * 1e-3), `rowek w rowie (${x}, ${y})`);
  // wycięcia poziomu 1 przy skorupie nie są bryłami cięcia pól (nadbudówki w rowie — kręgosłup — zostają)
  assert.ok(!ex.shapes.some((s) => s.op === 'cut' && s.level === 1));
  const f = buildHullField(d, { pipes: false, board: false });
  assert.ok(sampleHullField(f, 2, -800, 0) < 0, 'pokład-klin (poziom 2) w rowie');
  assert.ok(sampleHullField(f, 1, -600, 380) > 0, 'dno rowu bez pancerza');
  assert.ok(sampleHullField(f, 1, 1200, -500) < 0, 'pancerz obok rowu');
  axisTrench([[0, 0], [100, 40]]).forEach((b) => assert.ok(b.op === 'cut' && b.level === 1 && b.y === 0));
});

test('wariant ze skorupą: rama i pole bez zmian, sieć bez błędów (wnęki przy przyłączach paliwa), pancerz do burty', () => {
  const d0 = hullDesignPreset('bellator');
  const f0 = buildHullField(d0, { board: false });
  const f = buildHullField(withShell('bellator', { rhythm: 'wzor', ...SMALL }), { board: false });
  assert.equal(hullFrameIntegrity(f).pieces.length, 1);
  assert.ok(Math.abs(f.area - f0.area) / f0.area < 1e-3, `pole sylwetki ${f0.area} → ${f.area}`);
  assert.ok(sampleHullField(f, 1, 0, -20) < 0);
  const chk = pipeNetworkCheck(f.pipeNet, f);
  assert.equal(chk.freeEnds, 0);
  assert.equal(chk.outside, 0);
  assert.deepEqual(chk.unpowered, []);
  assert.deepEqual(chk.unfueled, []);
  assert.deepEqual(chk.fuelHidden, []);
});
