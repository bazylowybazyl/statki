// Kreator kadłubów — KLOCKI (src/game/hullDesign/hullDesignBlocks.js): paleta (pole, wypukłość, wierzchołki na siatce),
// obrót co 45° i odbicie, szczelina płyt (rów od sąsiadów, brzeg przy burcie, gap 0 scala), suma / różnica wielokątów,
// JSON w obie strony, lustro, siatka a detal, strażnik „bez czitowania” (isPlayerBuildable), preset `klocki`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { expandHullDesign, normalizeHullDesign } from '../src/game/hullDesign/hullDesignSchema.js';
import { buildHullField, hullFrameIntegrity, sampleHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import {
  HD_BLOCK_PALETTE, HD_BLOCK_TUNE, blockArea, blockLocalLoops, blockWorldLoops, hullBlockFromPalette, hullDesignGridStep,
  loopArea, normalizeBlock, offsetLoop, polygonDifference, polygonUnion, polygonsOverlap, snapBlockRot
} from '../src/game/hullDesign/hullDesignBlocks.js';
import { isPlayerBuildable, onGrid } from '../src/game/hullDesign/hullDesignBuildable.js';
import { HD_PRESET_KEYS, hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { tnIoU, tnSprite } from '../scripts/kreator-tn-ab.mjs';
import { hullDesignRecipe } from '../src/game/hullDesign/hullDesignRecipe.js';

const Q = Math.PI / 4;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b} (±${tol})`);
const partsArea = (parts) => parts.reduce((s, p) => s + loopArea(p.outer) + p.holes.reduce((h, l) => h + loopArea(l), 0), 0);
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** Klocek z pudła [x0, x1] × [y0, y1]. */
const blk = (shape, x0, y0, x1, y1, o = {}) => ({ kind: 'block', shape, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, level: 1, ...o });
/** Projekt z samych klocków (bez lustra, bez sieci rur). */
const design = (shapes, o = {}) => normalizeHullDesign({ v: 2, detail: 0.1, mirror: false, shapes, ...o });

/** Pole klocka z wymiarów (łuki — elipsa; wielokąt łuku ma krok 4°, więc ±0,5%). */
function expectedArea(b) {
  if (b.shape === 'rect') return b.w * b.h - (b.c || [0, 0, 0, 0]).reduce((s, c) => s + c * c / 2, 0);
  if (b.shape === 'tri') return b.w * b.h / 2;
  if (b.shape === 'trap') return (b.w + (b.w - b.a - b.b)) / 2 * b.h;
  // łuk: koło — elipsa wpisana w pudło, półkole — pół elipsy o półosiach w/2 i h, ćwiartka — ćwierć elipsy w × h
  const r2 = 1 - (b.ri || 0) ** 2;
  if (b.arc === 180) return Math.PI * (b.w / 2) * b.h / 2 * r2;
  if (b.arc === 90) return Math.PI * b.w * b.h / 4 * r2;
  return Math.PI * b.w * b.h / 4 * r2;
}

test('paleta: każdy kształt — dodatni obrys, pole z wymiarów, wypukły (poza pierścieniem), wierzchołki na siatce', () => {
  const g = 0.5, u = 2;
  for (const p of HD_BLOCK_PALETTE) {
    const raw = hullBlockFromPalette(p.id, u, 0, 0);
    // krawędzie pudła na siatce: x0 = 3, y0 = −7
    const b = normalizeBlock({ ...raw, x: 3 + raw.w / 2, y: -7 + raw.h / 2 });
    const loops = blockLocalLoops(b);
    assert.ok(loopArea(loops[0]) > 0, `${p.id}: obrys dodatni`);
    for (const h of loops.slice(1)) assert.ok(loopArea(h) < 0, `${p.id}: otwór ujemny`);
    const want = expectedArea(b);
    near(blockArea(b), want, b.shape === 'arc' ? want * 0.005 : 1e-9, `${p.id}: pole`);
    if (!b.ri) {
      const L = loops[0];
      for (let i = 0; i < L.length; i++) {
        const a = L[i], c = L[(i + 1) % L.length], d = L[(i + 2) % L.length];
        const cr = (c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0]);
        assert.ok(cr >= -1e-9, `${p.id}: wypukły (róg ${i})`);
      }
    }
    if (b.shape === 'arc') continue;
    // obrót co 90° i odbicie: wierzchołki na siatce
    for (const k of [0, 2, 4, 6]) {
      for (const flip of [false, true]) {
        const v = normalizeBlock({ ...b, rot: k * Q, flip });
        // obrót co 90° nieparzysty: pudło w × h → h × w, krawędzie na siatce z przesuniętego środka
        const W = k % 4 ? v.h : v.w, H = k % 4 ? v.w : v.h;
        v.x = 3 + W / 2; v.y = -7 + H / 2;
        for (const [x, y] of blockWorldLoops(v)[0]) assert.ok(onGrid(x, g) && onGrid(y, g), `${p.id} rot ${k * 45}° flip ${flip}: (${x}, ${y}) poza siatką`);
      }
    }
  }
});

test('obrót: przyciągany do 45°, pole stałe, pudło przy 90° zamienia wymiary; odbicie: wierzchołek trójkąta po drugiej stronie, 8 różnych ustawień', () => {
  assert.equal(snapBlockRot(0.3), 0);
  near(snapBlockRot(1.5), Math.PI / 2, 1e-12, '1,5 rad → 90°');
  near(snapBlockRot(-Math.PI / 2), 3 * Math.PI / 2, 1e-12, '−90° → 270°');
  near(normalizeBlock({ kind: 'block', shape: 'rect', rot: 0.8 }).rot, Q, 1e-12, 'normalizacja przyciąga');
  const tri = normalizeBlock({ kind: 'block', shape: 'tri', x: 0, y: 0, w: 8, h: 4, a: 0 });
  const box = (L) => { const xs = L.map((p) => p[0]), ys = L.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  assert.deepEqual(box(blockWorldLoops(tri)[0]), [-4, -2, 4, 2]);
  assert.deepEqual(box(blockWorldLoops({ ...tri, rot: 2 * Q })[0]).map((v) => Math.round(v * 1e9) / 1e9), [-2, -4, 2, 4]);
  const seen = new Set();
  for (let k = 0; k < 8; k++) {
    for (const flip of [false, true]) {
      const v = normalizeBlock({ ...tri, rot: k * Q, flip });
      const L = blockWorldLoops(v)[0];
      near(Math.abs(loopArea(L)), 16, 1e-9, `pole przy ${k * 45}°`);
      assert.ok(loopArea(L) > 0, 'obieg zachowany po obrocie i odbiciu');
      if (k % 2 === 0) seen.add(L.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).sort().join(' '));
    }
  }
  assert.equal(seen.size, 8, 'trójkąt prostokątny: 4 obroty × odbicie = 8 ustawień');
  // odbicie lewo-prawo: wierzchołek (najwyżej) z lewej → z prawej
  const top = (L) => L.reduce((m, p) => (p[1] < m[1] ? p : m));
  assert.equal(top(blockWorldLoops(tri)[0])[0], -4);
  assert.equal(top(blockWorldLoops({ ...tri, flip: true })[0])[0], 4);
});

test('walidacja klocka: rodzaj, parametry w granicach, łuk do 90 / 180 / 360, pierścień ≤ 0,95', () => {
  assert.equal(normalizeBlock({ kind: 'block', shape: 'hex' }).shape, 'rect');
  const t = normalizeBlock({ kind: 'block', shape: 'trap', w: 10, h: 4, a: 8, b: 8 });
  near(t.a + t.b, 10, 1e-9, 'trapez: a + b ≤ w');
  assert.equal(normalizeBlock({ kind: 'block', shape: 'tri', w: 10, h: 4, a: 30 }).a, 10);
  assert.equal(normalizeBlock({ kind: 'block', shape: 'arc', arc: 200 }).arc, 180);
  assert.equal(normalizeBlock({ kind: 'block', shape: 'arc', ri: 3 }).ri, 0.95);
  assert.deepEqual(normalizeBlock({ kind: 'block', shape: 'rect', w: 10, h: 4, c: [9, 0, 1, 0] }).c, [2, 0, 1, 0]);
  assert.equal(normalizeBlock({ kind: 'block', shape: 'rect', op: 'cut', gap: 3 }).gap, undefined, 'wycięcie bez szczeliny');
  assert.equal(normalizeBlock({ kind: 'block' }).level, 1, 'domyślnie pancerz');
});

test('suma i różnica wielokątów: styk bez szwu, nakładanie, styk w rogu, duplikat, otwór; nakładanie ≠ styk', () => {
  const touch = polygonUnion([[sq(0, 0, 1, 1)], [sq(1, 0, 2, 1)]]);
  assert.equal(touch.length, 1);
  assert.equal(touch[0].outer.length, 4, 'dwa stykające się kwadraty → jeden prostokąt (wspólna krawędź znika)');
  near(partsArea(touch), 2, 1e-9, 'pole');
  near(partsArea(polygonUnion([[sq(0, 0, 2, 2)], [sq(1, 1, 3, 3)]])), 7, 1e-9, 'nakładanie: 4 + 4 − 1');
  assert.equal(polygonUnion([[sq(0, 0, 1, 1)], [sq(1, 1, 2, 2)]]).length, 2, 'styk w rogu — dwie pętle');
  const dup = polygonUnion([[sq(0, 0, 1, 1)], [sq(0, 0, 1, 1)]]);
  assert.equal(dup.length, 1);
  near(partsArea(dup), 1, 1e-9, 'duplikat raz');
  // T: krawędź jednego kończy się w środku krawędzi drugiego
  near(partsArea(polygonUnion([[sq(0, 0, 4, 1)], [sq(1, 1, 2, 3)]])), 6, 1e-9, 'T');
  // pierścień z prostokątów (otwór w sumie)
  const ring = polygonUnion([[sq(0, 0, 3, 1)], [sq(0, 2, 3, 3)], [sq(0, 1, 1, 2)], [sq(2, 1, 3, 2)]]);
  assert.equal(ring.length, 1);
  assert.equal(ring[0].holes.length, 1, 'otwór w środku');
  near(partsArea(ring), 8, 1e-9, 'pole pierścienia');
  const diff = polygonDifference([sq(0, 0, 4, 4)], []);
  near(partsArea(diff), 16, 1e-9, 'różnica z pustym');
  near(partsArea(polygonDifference([sq(0, 0, 4, 4)], [sq(1, 1, 2, 2)])), 15, 1e-9, 'kwadrat bez środka');
  near(partsArea(polygonDifference([sq(0, 0, 4, 4)], [sq(3, -1, 5, 5)])), 12, 1e-9, 'kwadrat bez pasa z boku');
  near(partsArea(polygonDifference([sq(0, 0, 4, 4)], [sq(4, 0, 6, 4)])), 16, 1e-9, 'styk nic nie odejmuje');
  assert.equal(polygonsOverlap([sq(0, 0, 1, 1)], [sq(1, 0, 2, 1)]), false, 'styk krawędzią');
  assert.equal(polygonsOverlap([sq(0, 0, 1, 1)], [sq(1, 1, 2, 2)]), false, 'styk w rogu');
  assert.equal(polygonsOverlap([sq(0, 0, 2, 2)], [sq(1, 1, 3, 3)]), true, 'nakładanie');
  assert.equal(polygonsOverlap([sq(0, 0, 2, 2)], [sq(0, 0, 2, 2)]), true, 'ten sam');
  assert.equal(polygonsOverlap([sq(0, 0, 4, 4)], [sq(1, 1, 2, 2)]), true, 'w środku');
  // przesunięcie pętli: kwadrat o 0,1 w głąb i na zewnątrz (róg 90° bez ścięcia), szpic klina ścięty
  near(loopArea(offsetLoop(sq(0, 0, 1, 1), 0.1)), 0.64, 1e-9, 'w głąb');
  near(loopArea(offsetLoop(sq(0, 0, 1, 1), -0.1)), 1.44, 1e-9, 'na zewnątrz');
  const wedge = [[0, 0], [10, 1], [0, 2]];
  const grown = offsetLoop(wedge, -0.5);
  assert.ok(Math.max(...grown.map((p) => p[0])) < 10 + 0.5 * 1.5 + 1e-6, 'szpic ostrego rogu ścięty');
  assert.equal(offsetLoop(sq(0, 0, 1, 1), 0.6), null, 'zanikła');
  // pierścień: kopia lustra na osi (identyczna) nachodzi, piasta w otworze — nie (środek obrysu leży w otworze)
  const ringL = blockWorldLoops(normalizeBlock({ kind: 'block', shape: 'arc', x: 0, y: 0, w: 100, h: 100, ri: 0.6 }));
  const hub = blockWorldLoops(normalizeBlock({ kind: 'block', shape: 'arc', x: 0, y: 0, w: 30, h: 30 }));
  assert.equal(polygonsOverlap(ringL, blockWorldLoops(normalizeBlock({ kind: 'block', shape: 'arc', x: 0, y: 0, w: 100, h: 100, ri: 0.6 }), true)), true, 'pierścień i jego lustro');
  assert.equal(polygonsOverlap(ringL, hub), false, 'piasta w otworze pierścienia');
  const ex = expandHullDesign(design([{ kind: 'block', shape: 'arc', x: 0, y: 0, w: 100, h: 100, ri: 0.6, level: 2 }, { kind: 'block', shape: 'arc', x: 0, y: 0, w: 30, h: 30, level: 3 }], { mirror: true }));
  const plates2 = ex.shapes.filter((x) => x.blockSet === 'plate' && x.level === 2);
  assert.equal(plates2.length, 2, 'płyta pierścienia (z otworem) i płyta piasty');
  assert.ok(plates2.some((x) => x.holes && x.holes.length === 1));
});

test('szczelina płyt: rów maszynowni między sąsiednimi płytami, cienki brzeg przy burcie, gap 0 i nakładanie scalają', () => {
  const D = 0.1, gap = HD_BLOCK_TUNE.gapDu * D, rim = HD_BLOCK_TUNE.rimDu * D;
  const L = (f, lv, x, y) => sampleHullField(f, lv, x, y);
  const two = buildHullField(design([blk('rect', 0, -10, 40, 10), blk('rect', 40, -10, 80, 10)]), { pipes: false });
  assert.ok(L(two, 1, 40, 0) > 0, 'rów na styku płyt');
  assert.ok(L(two, 0, 40, 0) < -3, 'rama bez szwu na styku');
  // szerokość rowu wzdłuż osi
  let w = 0;
  for (let x = 30; x <= 50; x += 0.01) if (L(two, 1, x, 0) > 0) w += 0.01;
  near(w, gap, 0.25, 'szerokość rowu = szczelina');
  // przy burcie: płyta kończy się rim jd od sylwetki
  assert.ok(L(two, 0, 20, -10 + rim * 0.5) < 0 && L(two, 1, 20, -10 + rim * 0.5) > 0, 'brzeg ramy przy burcie');
  assert.ok(L(two, 1, 20, -10 + rim + 0.3) < 0, 'płyta tuż za brzegiem');
  const merged = buildHullField(design([blk('rect', 0, -10, 40, 10, { gap: 0 }), blk('rect', 40, -10, 80, 10, { gap: 0 })]), { pipes: false });
  assert.ok(L(merged, 1, 40, 0) < -5, 'gap 0: jedna płyta bez szwu');
  const over = buildHullField(design([blk('rect', 0, -10, 44, 10), blk('rect', 40, -10, 80, 10)]), { pipes: false });
  assert.ok(L(over, 1, 42, 0) < -5, 'klocki nachodzące: jedna płyta');
  const mixed = buildHullField(design([blk('rect', 0, -10, 40, 10, { gap: 0 }), blk('rect', 40, -10, 80, 10)]), { pipes: false });
  assert.ok(L(mixed, 1, 39.7, 0) < 0 && L(mixed, 1, 40 + gap * 0.25, 0) > 0, 'rów = gapA/2 + gapB/2 (tu tylko po stronie B)');
  // klocek ramy (poziom 0) obok płyty: płyta dochodzi do styku (bez rowu), rama ciągła
  const frame = buildHullField(design([blk('rect', 0, -10, 40, 10), blk('rect', 40, -10, 80, 10, { level: 0 })]), { pipes: false });
  assert.ok(L(frame, 1, 39.8, 0) < 0, 'płyta przy klocku ramy bez rowu');
  assert.ok(L(frame, 1, 41, 0) > 0 && L(frame, 0, 41, 0) < 0, 'klocek ramy = maszynownia');
  // wycięcie na poziomie 1: płyta wycięta, rama zostaje; na poziomie 0 — dziura w kadłubie
  const cut = buildHullField(design([blk('rect', 0, -10, 80, 10), blk('rect', 30, -4, 50, 4, { op: 'cut' }), blk('rect', 60, -2, 70, 2, { op: 'cut', level: 0 })]), { pipes: false });
  assert.ok(L(cut, 1, 40, 0) > 0 && L(cut, 0, 40, 0) < 0, 'wycięcie płyty');
  assert.ok(L(cut, 0, 65, 0) > 0, 'wycięcie w ramie');
});

test('JSON w obie strony: klocki z obrotem, odbiciem, szczeliną, wycięciem i siatką — to samo rozwinięcie', () => {
  const shapes = HD_BLOCK_PALETTE.map((p, i) => ({ ...hullBlockFromPalette(p.id, 2, i * 12, -6), rot: (i % 8) * Q, flip: i % 3 === 0, gap: i % 4 ? undefined : 4 }));
  shapes.push(blk('rect', 0, -2, 6, 2, { op: 'cut', level: 2 }), blk('trap', 20, -20, 30, -12, { a: 2, b: -2, mirror: false }));
  const d = normalizeHullDesign({ v: 2, detail: 0.2, grid: 1, mirror: true, shapes });
  const back = normalizeHullDesign(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back, d);
  assert.equal(back.grid, 1);
  const a = expandHullDesign(d).shapes, b = expandHullDesign(back).shapes;
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.deepEqual(a[i].pts, b[i].pts);
  for (const s of a) assert.ok(['frame', 'plate', 'cut'].includes(s.blockSet), 'klocki rozwinięte na wielokąty ramy, płyt i wycięć');
});

test('lustro: kopia po drugiej burcie (pole symetryczne), klocek na osi bez podwojenia, styk na osi — rów, mirror: false — bez kopii', () => {
  const d = design([blk('trap', 0, -30, 40, -10, { a: 0, b: 20 }), blk('rect', -20, -10, 60, 10)], { mirror: true });
  const f = buildHullField(d, { pipes: false });
  for (const [x, y] of [[10, -20], [30, -12], [-10, -5], [38, -11], [5, -29.9], [20, -9.5]]) {
    near(sampleHullField(f, 0, x, y), sampleHullField(f, 0, x, -y), 1e-3, `rama (${x}, ${y})`);
    near(sampleHullField(f, 1, x, y), sampleHullField(f, 1, x, -y), 1e-3, `płyty (${x}, ${y})`);
  }
  // klocek symetryczny na osi: rama = jeden prostokąt (kopia lustra pokrywa się z oryginałem)
  const axis = expandHullDesign(design([blk('rect', -20, -10, 60, 10)], { mirror: true })).shapes.filter((s) => s.blockSet === 'frame');
  assert.equal(axis.length, 1);
  near(Math.abs(loopArea(axis[0].pts)), 80 * 20, 1e-6, 'pole ramy bez podwojenia');
  // klocek stykający się z osią: kopia lustra po drugiej stronie, między nimi rów, rama ciągła
  const half = buildHullField(design([blk('rect', 0, -20, 40, 0)], { mirror: true }), { pipes: false });
  assert.ok(sampleHullField(half, 1, 20, 0) > 0 && sampleHullField(half, 0, 20, 0) < -3, 'rów na osi, rama ciągła');
  const one = expandHullDesign(design([blk('rect', 0, -20, 40, -4, { mirror: false })], { mirror: true })).shapes.filter((s) => s.blockSet === 'frame');
  assert.equal(one.length, 1, 'mirror: false — bez kopii');
});

test('siatka a detal: krok siatki stały w projekcie, zmiana detalu nie rusza klocków ani rozmiaru okrętu', () => {
  assert.equal(hullDesignGridStep(0.0894), 0.5);
  assert.equal(hullDesignGridStep(0.1445), 0.5);
  assert.equal(hullDesignGridStep(0.366), 2);
  assert.equal(hullDesignGridStep(0.63), 2);
  assert.equal(hullDesignGridStep(0.906), 4);
  const base = hullDesignPreset('klocki');
  const fine = normalizeHullDesign({ ...base, detail: 0.2 });
  assert.equal(fine.grid, base.grid, 'siatka zapisana w projekcie');
  const f0 = buildHullField(base, { pipes: false }), f1 = buildHullField(fine, { pipes: false });
  for (const k of ['minX', 'minY', 'maxX', 'maxY']) near(f1.bounds[k], f0.bounds[k], 0.5, `pudło kadłuba ${k}`);
});

test('strażnik „bez czitowania”: klocki na siatce, pióro do 16 pkt, części i kasztele — tak; obrys sprite\'a, setki punktów, bryły spoza palety, poza siatką — nie', () => {
  const ok = isPlayerBuildable(hullDesignPreset('klocki'));
  assert.ok(ok.ok, JSON.stringify(ok.violations));
  assert.ok(isPlayerBuildable(hullDesignPreset('tnparts')).ok, 'części, moduły, bloki 60 j.');
  const outline = Array.from({ length: 60 }, (_, i) => [Math.cos(i / 60 * 6.283) * 70 + 0.13 * i, Math.sin(i / 60 * 6.283) * 25]);
  const traced = isPlayerBuildable({ v: 2, detail: 0.09, shapes: [{ kind: 'poly', op: 'add', level: 0, pts: outline, reg: 0.18, regDrop: true }] });
  assert.ok(!traced.ok && traced.violations.some((v) => /obrys/.test(v.text)), 'obrys sprite\'a odrzucony');
  const g = 0.5;
  const base = { v: 2, detail: 0.09, grid: g, mirror: true };
  const check = (shapes, extra = {}) => isPlayerBuildable({ ...base, shapes, ...extra });
  assert.ok(check([blk('rect', 0, -4, 10, 4)]).ok);
  assert.ok(check([{ ...blk('trap', 0, -4, 10, 4, { a: 2, b: 3 }), rot: Q }]).ok, '45°: środek na pół siatki');
  assert.ok(!check([blk('rect', 0.13, -4, 10, 4)]).ok, 'krawędź poza siatką');
  assert.ok(!check([blk('rect', 0, -4, 10.3, 4)]).ok, 'wymiar poza siatką');
  assert.ok(!check([blk('trap', 0, -4, 10, 4, { a: 0.7, b: 0 })]).ok, 'skos poza siatką');
  assert.ok(!check([{ kind: 'circle', op: 'add', x: 0, y: 0, r: 10, level: 1 }]).ok, 'koło spoza palety');
  const pen = Array.from({ length: 12 }, (_, i) => [Math.round(Math.cos(i / 12 * 6.283) * 20), Math.round(Math.sin(i / 12 * 6.283) * 10)]);
  assert.ok(check([{ kind: 'poly', op: 'add', level: 1, pts: pen }]).ok, 'pióro 12 pkt na siatce');
  const many = Array.from({ length: 40 }, (_, i) => [Math.round(Math.cos(i / 40 * 6.283) * 20), Math.round(Math.sin(i / 40 * 6.283) * 10)]);
  assert.ok(!check([{ kind: 'poly', op: 'add', level: 1, pts: many }]).ok, '40 pkt');
  assert.ok(!check([{ kind: 'poly', op: 'add', level: 1, pts: pen.map(([x, y]) => [x + 0.1, y]) }]).ok, 'pióro poza siatką');
  assert.ok(!check([{ kind: 'poly', op: 'add', level: 1, pts: pen, holes: [[[0, 0], [2, 0], [2, 2]]] }]).ok, 'otwory');
  assert.ok(!check([], { grooves: [{ pts: Array.from({ length: 30 }, (_, i) => [i, 0]) }] }).ok, 'rowek z 30 pkt');
  assert.ok(check([], { castles: [{ x: 10, y: -20, w: 20, h: 10 }], parts: [{ id: 'tn_bridge', x: 0, y: 0, s: 0.2 }] }).ok, 'kasztele i części');
});

test('wszystkie presety do zbudowania w edytorze gracza; flota TN z klocków: IoU alfy ze sprite\'em ≥ 0,9, najwyżej 60 klocków na połowę', () => {
  for (const key of HD_PRESET_KEYS) {
    const r = isPlayerBuildable(hullDesignPreset(key));
    assert.ok(r.ok, `${key}: ${r.violations.map((v) => v.text).join('; ')}`);
  }
  for (const key of ['custos', 'hasta', 'bellator', 'citadella', 'colossus']) {
    const d = hullDesignPreset(key);
    assert.ok(d.shapes.every((s) => s.kind === 'block') && d.shapes.length <= 60, `${key}: ${d.shapes.length} brył`);
    const f = buildHullField(d, { pipes: false });
    const { iou } = tnIoU(key, f, tnSprite(key), 2);
    assert.ok(iou >= 0.9, `${key}: IoU ${iou.toFixed(3)}`);
  }
});

test('spójność ramy: kawałki i szpary na wylot wykryte (także drobiny); rama każdego presetu — 1 bryła, 0 otworów', () => {
  const at = (shapes) => hullFrameIntegrity(buildHullField(design(shapes), { pipes: false }));
  const one = at([blk('rect', 0, -10, 40, 10), blk('rect', 40, -10, 80, 10)]);
  assert.equal(one.pieces.length, 1, 'styk klocków: jedna bryła');
  assert.equal(one.holes.length, 0, 'styk klocków: bez otworów');
  assert.equal(at([blk('rect', 0, -10, 40, 10), blk('rect', 41, -10, 80, 10)]).pieces.length, 2, 'szczelina 1 j. rozcina kadłub');
  assert.equal(at([blk('rect', 0, -10, 40, 10), blk('rect', 60, -1, 61, 0)]).pieces.length, 2, 'drobina 1 × 1 j. obok kadłuba');
  // szpara na wylot: rama w kształcie U domknięta czwartym klockiem z odstępem 1 j.
  const u = at([blk('rect', 0, -10, 40, -6), blk('rect', 0, 6, 40, 10), blk('rect', 0, -6, 4, 6), blk('rect', 36, -6, 40, 6),
    blk('rect', 4, -6, 36, -1), blk('rect', 4, 0, 36, 6)]);
  assert.equal(u.pieces.length, 1, 'U z wnętrzem: jedna bryła');
  assert.equal(u.holes.length, 1, 'szpara 1 j. w środku ramy');
  near(u.holes[0].area, 32, 4, 'pole szpary');
  for (const key of HD_PRESET_KEYS) {
    const { pieces, holes } = hullFrameIntegrity(buildHullField(hullDesignPreset(key), { pipes: false }));
    assert.equal(pieces.length, 1, `${key}: kadłub w ${pieces.length} kawałkach (${pieces.slice(1).map((p) => `${p.area.toFixed(1)} j.² przy ${p.box.join(',')}`).join('; ')})`);
    assert.equal(holes.length, 0, `${key}: ${holes.length} szpar (${holes.map((p) => `${p.area.toFixed(1)} j.² przy ${p.box.join(',')}`).join('; ')})`);
  }
});

test('preset `klocki`: fregata TN z 10–15 klocków, w skali Custosa, kompletna receptura, rama w jednym kawałku', () => {
  const d = hullDesignPreset('klocki');
  const n = d.shapes.filter((s) => s.kind === 'block').length;
  assert.ok(n >= 10 && n <= 15, `${n} klocków`);
  assert.equal(d.shapes.length, n, 'kadłub tylko z klocków');
  const f = buildHullField(d, { pipes: false });
  const len = f.bounds.maxX - f.bounds.minX, wid = f.bounds.maxY - f.bounds.minY;
  assert.ok(len > 140 && len < 165, `długość ${len}`);
  assert.ok(wid > 55 && wid < 75, `szerokość ${wid}`);
  assert.ok(f.area > 0.5 * len * wid && f.area < len * wid, `powierzchnia ${f.area}`);
  const r = hullDesignRecipe(f);
  assert.deepEqual(r.warnings.map((w) => w.text), []);
  const ex = expandHullDesign(d);
  assert.equal(ex.shapes.filter((s) => s.blockSet === 'frame').length, 1, 'rama w jednym kawałku');
  assert.ok(ex.shapes.filter((s) => s.blockSet === 'plate' && s.level === 1).length >= 8, 'płyty pancerza rozdzielone rowami');
});
