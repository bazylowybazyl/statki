// Kreator kadłubów — czyste moduły projektu (src/game/hullDesign/): kontury bloków, style rogów, pole odległości
// poziomów (bryły, wielokąty z otworami, wycięcia, lustro, tarasy), metryka ośmiokątna, migracja v1 → v2, gotowe
// części, flota Terra Novy z obrysu sprite'ów, alfa fizyki, receptura i mocowania, sieć rur (generator, raster,
// rury ręczne).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HD_BLOCK, HD_LEVELS, HD_SHAPE_TUNE, expandHullDesign, normalizeHullDesign, symPolyPoints
} from '../src/game/hullDesign/hullDesignSchema.js';
import {
  buildHullField, chamferLoop, fieldUnion, hullCells, octagonalField, polygonField, polyShapeLoops, rasterHullAlpha,
  roundLoop, sampleHullField, styleLoop, traceBlockContours
} from '../src/game/hullDesign/hullDesignGeometry.js';
import { regularizeLoop, regularizeLoopSym } from '../src/game/hullDesign/hullDesignRegularize.js';
import { hullDesignMounts, hullDesignRecipe } from '../src/game/hullDesign/hullDesignRecipe.js';
import { HD_PRESET_KEYS, hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { HD_PART_IDS, expandHullPart } from '../src/game/hullDesign/hullDesignParts.js';
import { HD_PIPE_FIT, filletPolyline, pipeTercileLoad, rasterPipeNetwork } from '../src/game/hullDesign/hullDesignPipes.js';
import { HULL_RENDER_PROFILES, HULL_RENDER_WORLD_SCALE } from '../src/data/ships.js';

const cells = (list) => new Set(list.map(([x, y]) => `${x},${y}`));

test('kontur bloków: kwadrat 2 × 2 = jedna pętla 4 wierzchołków, styk po przekątnej = dwie pętle', () => {
  const sq = traceBlockContours(cells([[0, 0], [1, 0], [0, 1], [1, 1]]));
  assert.equal(sq.length, 1);
  assert.equal(sq[0].length, 4);
  const diag = traceBlockContours(cells([[0, 0], [1, 1]]));
  assert.equal(diag.length, 2);
  for (const l of diag) assert.equal(l.length, 4);
  // otwór: pierścień 3 × 3 bez środka = pętla zewnętrzna i wewnętrzna
  const ring = traceBlockContours(cells([[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]));
  assert.equal(ring.length, 2);
});

test('fazy: schodki pojedynczych bloków stają się jedną prostą 45°', () => {
  // schodki: kolumny o wysokości 3, 2, 1 bloku
  const loops = traceBlockContours(cells([[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]]));
  assert.equal(loops.length, 1);
  const ch = styleLoop(loops[0], 'chamfer');
  let diagonals = 0;
  for (let i = 0; i < ch.length; i++) {
    const a = ch[i], b = ch[(i + 1) % ch.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6 && Math.abs(dx) > 1) diagonals++;
    // żadnej krawędzi krótszej niż ćwierć bloku poza fazami
    assert.ok(Math.hypot(dx, dy) > 1);
  }
  // przekątna schodów: jeden długi odcinek (2 schodki · √2 · blok), nie zygzak
  const longest = Math.max(...ch.map((a, i) => { const b = ch[(i + 1) % ch.length]; return Math.hypot(b[0] - a[0], b[1] - a[1]); }));
  assert.ok(longest > 2 * HD_BLOCK * Math.SQRT2 * 0.99, `najdłuższy odcinek ${longest}`);
  assert.ok(diagonals >= 3);
});

test('łuki: promień ograniczony połową krótszej krawędzi, punkty w pudle wielokąta', () => {
  const sq = [[0, 0], [120, 0], [120, 60], [0, 60]];
  const r = roundLoop(sq, 500);
  for (const [x, y] of r) {
    assert.ok(x >= -1e-6 && x <= 120 + 1e-6 && y >= -1e-6 && y <= 60 + 1e-6);
  }
  // pas 60 j. z promieniem 500 → półkola na końcach (promień 30): środek krótszych boków osiągnięty
  assert.ok(r.some(([x, y]) => Math.abs(x) < 0.5 && Math.abs(y - 30) < 1));
  // fazy: róg ścięty o chamfer
  const ch = chamferLoop([[0, 0], [300, 0], [300, 300], [0, 300]], 30);
  assert.equal(ch.length, 8);
});

test('pole: wnętrze ujemne, lustro symetryczne, tarasy wewnątrz poziomu niżej (Orbis z v1 → v2)', () => {
  const d = hullDesignPreset('orbis');
  assert.equal(d.v, 2);
  const f = buildHullField(d);
  assert.equal(f.levels.length, HD_LEVELS);
  assert.ok(sampleHullField(f, 1, 0, 0) < 0, 'środek kadłuba (pancerz)');
  assert.ok(sampleHullField(f, 0, 0, 400) > 0, 'poza kadłubem');
  for (const [x, y] of [[100, 50], [-300, 90], [420, 30], [0, 160]]) {
    assert.ok(Math.abs(sampleHullField(f, 1, x, y) - sampleHullField(f, 1, x, -y)) < 1.0, `lustro w (${x}, ${y})`);
  }
  const { w, h } = f.grid;
  const D = d.detail;
  for (let i = 0; i < w * h; i += 97) {
    assert.ok(f.levels[1][i] >= f.levels[0][i] - 1e-3, 'pancerz w ramie');
    for (const L of [2, 3]) {
      const ins = HD_SHAPE_TUNE.insetDu[L] * D;
      assert.ok(f.levels[L][i] >= f.levels[L - 1][i] + ins - 1e-3 || f.levels[L][i] >= f.band - 1e-3, `taras ${L}`);
    }
  }
  // pierścień nadbudówki (v1: poziom 1 → v2: 2): w środku koła wycięty, kopuła mostka (r 40) go przywraca
  assert.ok(sampleHullField(f, 2, 70, 0) > 0, 'wycięcie pierścienia');
  assert.ok(sampleHullField(f, 2, 115, 0) < 0, 'pierścień');
  assert.ok(sampleHullField(f, 1, 70, 0) < 0, 'pancerz pod wycięciem zostaje');
});

test('migracja v1 → v2: poziomy kadłub / nadbudówka / mostek → pancerz / nadbudówka / mostek; v2 bez zmian', () => {
  const v1 = normalizeHullDesign({ blocks: [[0, -1, 0], [1, -1, 2]], shapes: [{ kind: 'circle', op: 'add', x: 0, y: 0, r: 20, level: 1 }] });
  assert.deepEqual(v1.blocks.map((b) => b[2]).sort(), [1, 3]);
  assert.equal(v1.shapes[0].level, 2);
  const v2 = normalizeHullDesign({ v: 2, blocks: [[0, -1, 0]], shapes: [{ kind: 'circle', op: 'add', x: 0, y: 0, r: 20, level: 1 }] });
  assert.equal(v2.blocks[0][2], 0);
  assert.equal(v2.shapes[0].level, 1);
});

test('wielokąt: otwory parzysto-nieparzyście, symetryczny z połowy, faza rogów', () => {
  const d = {
    v: 2, detail: 0.5, mirror: true, blocks: [],
    shapes: [
      { kind: 'poly', op: 'add', level: 1, pts: [[-100, -40], [100, -40], [100, 40], [-100, 40]], holes: [[[74, -10], [96, -10], [96, 10], [74, 10]]], mirror: false },
      { kind: 'poly', op: 'add', level: 2, sym: true, ch: 4, pts: [[-60, 0], [-60, -20], [40, -20], [70, 0]] }
    ]
  };
  const f = buildHullField(d);
  assert.ok(sampleHullField(f, 1, -60, 0) < 0, 'płyta');
  assert.ok(sampleHullField(f, 1, 85, 0) > 0, 'otwór w płycie');
  assert.ok(sampleHullField(f, 0, 85, 0) > 0, 'otwór — bez ramy');
  for (const [x, y] of [[-40, 15], [30, 8], [55, 3]]) {
    const a = sampleHullField(f, 2, x, y), b = sampleHullField(f, 2, x, -y);
    assert.ok(Math.abs(a - b) < 0.6, `symetria wielokąta sym w (${x}, ${y})`);
  }
  assert.ok(sampleHullField(f, 2, 60, 0) < 0, 'dziób wielokąta sym');
  // faza rogu: róg (−60, −20) ścięty — punkt tuż przy rogu poza bryłą
  assert.ok(sampleHullField(f, 2, -59, -19) > 0, 'róg ścięty');
});

test('bryła przycięta do poziomu (clip): część wspólna z płytami, krawędzie zewnętrzne z płyt', () => {
  const d = {
    v: 2, detail: 0.5, mirror: false, blocks: [],
    shapes: [
      { kind: 'poly', op: 'add', level: 1, pts: [[-100, -40], [100, -40], [100, 40], [-100, 40]] },
      { kind: 'poly', op: 'add', level: 2, clip: 1, pts: [[0, -80], [200, -80], [200, 80], [0, 80]] }
    ]
  };
  const f = buildHullField(d);
  assert.ok(sampleHullField(f, 2, 50, 0) < 0, 'płyta podniesiona');
  assert.ok(sampleHullField(f, 2, 150, 0) > 0, 'poza płytą nic nie przybywa');
  assert.ok(sampleHullField(f, 1, 150, 0) > 0, 'pancerz poza płytą bez zmian');
  assert.ok(sampleHullField(f, 2, -50, 0) > 0, 'poza wielokątem płyta zostaje niżej');
  // krawędź zewnętrzna podniesionej części z płyty (x = 100) — z progiem tarasu (insetDu[2] jd)
  const ins = HD_SHAPE_TUNE.insetDu[2] * 0.5;
  assert.ok(Math.abs(sampleHullField(f, 2, 100 - ins, 0)) < 1.2, 'krawędź przy płycie − próg');
});

test('metryka ośmiokątna: wokół punktu izolinie = ośmiokąt (max + (√2 − 1)·min), znak zachowany', () => {
  const grid = { x0: -50, y0: -50, w: 200, h: 200, res: 2 };
  const f = polygonField([[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]], grid, 60);
  const o = octagonalField(f, grid.w, grid.h, grid.res, 60);
  const at = (x, y) => o[Math.floor((y - grid.y0) * grid.res) * grid.w + Math.floor((x - grid.x0) * grid.res)];
  for (const [x, y] of [[30, 0], [20, 20], [30, 15], [10, 25]]) {
    const ax = Math.abs(x + 0.25) - 0.5, ay = Math.abs(y + 0.25) - 0.5;
    const ref = Math.max(ax, ay) + (Math.SQRT2 - 1) * Math.min(ax, ay);
    assert.ok(Math.abs(at(x, y) - ref) / ref < 0.06, `(${x}, ${y}): ${at(x, y).toFixed(2)} vs ${ref.toFixed(2)}`);
  }
  assert.ok(at(0, 0) <= 0, 'wnętrze ujemne');
});

test('styl zaokrąglony: suma koła i bloków z łukiem na styku (materiał w kącie)', () => {
  const a = 10, b = 10;
  assert.ok(fieldUnion(a, b, 'rounded') < Math.min(a, b));
  assert.equal(fieldUnion(a, b, 'sharp'), Math.min(a, b));
  assert.ok(fieldUnion(5, 5, 'chamfer') < 5);
});

test('lustro: emblemat po drugiej burcie odbity, napis czytelny', () => {
  const d = normalizeHullDesign({
    blocks: [[0, -1, 0]],
    decals: [
      { kind: 'emblem', id: 'star', x: 10, y: -30, w: 20, h: 20 },
      { kind: 'text', text: 'AB', x: 10, y: -30, w: 30, h: 10 }
    ]
  });
  const ex = expandHullDesign(d);
  assert.equal(ex.decals.length, 4);
  const em = ex.decals.filter((x) => x.kind === 'emblem');
  const tx = ex.decals.filter((x) => x.kind === 'text');
  assert.notEqual(em[0].flip, em[1].flip);
  assert.equal(tx[0].flip, tx[1].flip);
  assert.equal(ex.blocks.get('0,0'), 1, 'blok lustrzany (oś na krawędzi bloków; v1 → pancerz)');
});

test('alfa fizyki i komórki belek; gotowe projekty bez ostrzeżeń', () => {
  for (const key of HD_PRESET_KEYS) {
    const f = buildHullField(hullDesignPreset(key));
    const a = rasterHullAlpha(f, 1);
    assert.equal(a.width, f.image.w);
    assert.equal(a.height, f.image.h);
    const c = hullCells(f, 0);
    assert.ok(c.count > 10, key);
    const r = hullDesignRecipe(f);
    if (key === 'empty') {
      assert.ok(r.warnings.some((w) => /reaktora/.test(w.text)));
      assert.ok(r.warnings.some((w) => /mostka/.test(w.text)));
      assert.ok(r.warnings.some((w) => /MAIN/.test(w.text)));
    } else {
      assert.deepEqual(r.warnings, [], `${key}: ${r.warnings.map((w) => w.text).join('; ')}`);
      assert.ok(r.parts.reactor_core >= 1 && r.parts.thruster >= 2, key);
    }
    // płyty: ten sam przelicznik co odrost dronów (200 komórek na płytę)
    const cellsEq = r.cells.hull + (r.cells.upper + r.cells.bridge) * 0.5;
    assert.equal(r.plates, Math.max(1, Math.ceil(cellsEq / 200)));
  }
});

// sprite'y floty TN: profil renderu, długość i szerokość alfy [j. świata] (pomiar: scripts/kreator-tn-ab.mjs)
const TN_SPRITE_SIZE = {
  custos: { profile: 'terran_frigate', length: 151.9, width: 66.1 },
  hasta: { profile: 'terran_destroyer', length: 245.6, width: 137.6 },
  bellator: { profile: 'terran_battleship', length: 622.4, width: 384.2 },
  citadella: { profile: 'terran_carrier', length: 1071.6, width: 433.4 },
  colossus: { profile: 'terran_supercapital', length: 1540.4, width: 627 }
};

test('flota Terra Novy: projekt w skali sprite\'a gry (długość, szerokość), detal = długość / 1700', () => {
  for (const key of ['custos', 'hasta', 'bellator', 'citadella', 'colossus']) {
    const t = TN_SPRITE_SIZE[key];
    const d = hullDesignPreset(key);
    const f = buildHullField(d);
    const len = f.bounds.maxX - f.bounds.minX, wid = f.bounds.maxY - f.bounds.minY;
    assert.ok(Math.abs(len - t.length) / t.length < 0.04, `${key}: długość ${len.toFixed(0)} vs ${t.length}`);
    // szerokość: sprite fregaty ma niesymetryczny moduł pod lewą burtą (projekt jest lustrzany) — luz 16%
    assert.ok(Math.abs(wid - t.width) / t.width < 0.16, `${key}: szerokość ${wid.toFixed(0)} vs ${t.width}`);
    assert.ok(Math.abs(d.detail - len / 1700) / d.detail < 0.06, `${key}: detail`);
    // sprite gry: dłuższy bok płótna = length × 0,6 — kadłub mieści się w nim
    assert.ok(len <= HULL_RENDER_PROFILES[t.profile].length * HULL_RENDER_WORLD_SCALE * 1.02, `${key}: w płótnie sprite'a (${len.toFixed(0)})`);
    const r = hullDesignRecipe(f);
    assert.ok(r.counts.engine >= 1 && r.counts.reactor === 1 && r.counts.bridge === 1, key);
  }
});

test('gotowe części: rozwinięcie w skali i obrocie, kopia lustra odbita, poziomy z przesunięciem', () => {
  for (const id of HD_PART_IDS) {
    const ex = expandHullPart({ id, x: 0, y: 0, s: 1, rot: 0 });
    assert.ok(ex.shapes.length + ex.modules.length > 0, id);
  }
  const a = expandHullPart({ id: 'tn_sponson', x: 100, y: -80, s: 2, rot: 0 });
  const b = expandHullPart({ id: 'tn_sponson', x: 100, y: -80, s: 2, rot: 0 }, true);
  const ys = (ex) => ex.shapes[0].pts.map((p) => p[1]);
  assert.ok(Math.max(...ys(a)) <= -80 + 1e-6, 'sponson wystaje w −y od punktu wstawienia');
  assert.deepEqual(ys(b).map((y) => Math.round(-y * 100)), ys(a).map((y) => Math.round(y * 100)), 'kopia odbita');
  const m = a.modules.find((x) => x.type === 'turret_m');
  assert.equal(m.r, 24, 'skala promienia modułu');
  const up = expandHullPart({ id: 'tn_turret_block', x: 0, y: 0, s: 1, rot: 0, dl: 1 });
  assert.equal(up.shapes[0].level, 3, 'przesunięcie poziomów');
  const d = normalizeHullDesign({ v: 2, mirror: true, blocks: [[0, -1, 1]], parts: [{ id: 'tn_port', x: 30, y: -60, s: 1 }, { id: 'tn_spine', x: 0, y: 0, s: 0.5 }] });
  const ex = expandHullDesign(d);
  assert.equal(ex.modules.filter((x) => x.type === 'well').length, 2 + 3, 'port z lustrem + 3 porty grzbietu');
});

test('flota TN z klocków (bez obrysu sprite\'a), kompozytor czyta pola ośmiokątne', () => {
  for (const key of Object.keys(TN_SPRITE_SIZE)) {
    const d = hullDesignPreset(key);
    assert.ok(d.shapes.length >= 10 && d.shapes.every((s) => s.kind === 'block'), key);
  }
  const src = readFileSync(new URL('../src/3d/hullDesign/hullComposer.js', import.meta.url), 'utf8');
  for (const k of ['_auxAt', 'oU.x', 'topComp']) assert.ok(src.includes(k), k);
});

test('mocowania: lampy na krawędzi, dysze MAIN gondol za rufą gondoli', () => {
  const f = buildHullField(hullDesignPreset('atlas2'));
  const m = hullDesignMounts(f);
  assert.equal(m.lights.position.length, 4);
  const { cx, cy } = f.image;
  for (const l of m.lights.position) {
    const d = sampleHullField(f, 0, l.x + cx, l.y + cy);
    assert.ok(d < 0 && d > -12, `lampa ${l.id} przy krawędzi (d = ${d.toFixed(1)})`);
  }
  const engines = f.expanded.modules.filter((x) => x.type === 'engine');
  assert.equal(m.mainThrusters.length, engines.reduce((s, e) => s + (e.n || Math.max(1, Math.round(e.h / 11))), 0));
  assert.ok(m.hardpoints.length >= 8);
  // fregata TN: lampy w skali detalu (nie wielkości lotniskowca)
  const fc = buildHullField(hullDesignPreset('custos'));
  for (const l of hullDesignMounts(fc).lights.position) assert.ok(l.radius < 1, `promień lampy fregaty ${l.radius}`);
});

// ── sieć rur ────────────────────────────────────────────────────────────────────────────────────────────────
const netKey = (net) => JSON.stringify({ runs: net.runs, fits: net.fits });

test('rury: format — stare projekty bez sieci, rury ręczne z lustrem (wspólna wiązka), walidacja', () => {
  const old = normalizeHullDesign({ blocks: [[0, -1, 0]] });
  assert.deepEqual(old.pipes, []);
  assert.equal(old.pipeNet.density, 0, 'brak pola pipeNet = gęstość 0');
  assert.equal(buildHullField(hullDesignPreset('orbis')).pipeNet, null, 'Orbis (bez sieci) — pole jak dawniej');
  const d = normalizeHullDesign({
    v: 2, mirror: true, detail: 0.6, blocks: [[0, -1, 0], [1, -1, 0], [2, -1, 0], [3, -1, 0]],
    pipes: [{ pts: [[20, -30], [180, -30]], n: 4, mat: 'copper' }, { pts: [[10, -10], [40, -12]], n: 99, mat: 'złoto', r: 9 }, { pts: [[5, 5]] }],
    pipeNet: { density: 7, seed: 3 }
  });
  assert.equal(d.pipes.length, 2, 'rura z jednym punktem odrzucona');
  assert.equal(d.pipes[1].n, 8);
  assert.equal(d.pipes[1].mat, 'mix');
  assert.equal(d.pipes[1].r, 3);
  assert.equal(d.pipeNet.density, 2);
  const ex = expandHullDesign(d);
  assert.equal(ex.pipes.length, 4, 'kopie lustra');
  assert.deepEqual(ex.pipes[1].pts, [[20, 30], [180, 30]]);
  const f = buildHullField({ ...d, pipeNet: { density: 0 } });
  assert.equal(f.pipeNet.runs.length, 2, 'rura ręczna = bieg, kopia lustra w tym samym biegu');
  for (const r of f.pipeNet.runs) {
    assert.equal(r.polys.length, 2);
    assert.equal(r.over, true, 'ręczne leżą też na płytach');
  }
  assert.equal(f.pipeNet.runs[0].n, 4);
  assert.equal(f.pipeNet.runs[0].mat, 2, 'miedź');
  assert.ok(f.pipeNet.fits.every((x) => x.type === HD_PIPE_FIT.cap && x.over), 'zaślepki na końcach');
  // kolano zaokrąglone: łamana pod kątem prostym → łuk (punkty dalej od narożnika niż promień · (√2 − 1))
  const fl = filletPolyline([[0, 0], [100, 0], [100, 100]], 30);
  assert.ok(fl.length > 4);
  for (const [x, y] of fl) assert.ok(Math.hypot(x - 100, y - 0) > 30 * (Math.SQRT2 - 1) * 0.98, 'łuk omija narożnik');
});

test('rury: sieć TN deterministyczna, wewnątrz kadłuba, gęstsza przy rufie niż przy dziobie, symetryczna', () => {
  for (const key of ['custos', 'bellator', 'citadella', 'colossus']) {
    const d = hullDesignPreset(key);
    const f = buildHullField(d);
    const net = f.pipeNet;
    assert.ok(net && net.runs.length >= 15 && net.fits.length >= 20, `${key}: ${net?.runs.length} biegów, ${net?.fits.length} osprzętu`);
    assert.equal(netKey(net), netKey(buildHullField(d).pipeNet), `${key}: deterministyczna`);
    const seeded = buildHullField({ ...d, pipeNet: { density: 1, seed: d.pipeNet.seed === 5 ? 6 : 5 } }).pipeNet;
    assert.notEqual(netKey(net), netKey(seeded), `${key}: inne ziarno — inna sieć`);
    // oś każdej rury wewnątrz sylwetki
    for (const r of net.runs) for (const poly of r.polys) for (const [x, y] of poly) {
      const d0 = sampleHullField(f, 0, x, y);
      assert.ok(d0 < 0, `${key}: rura poza kadłubem (${x.toFixed(1)}, ${y.toFixed(1)}): ${d0.toFixed(2)}`);
    }
    // koncentracja przy silnikach: rury × długość w rufowej tercji > w dziobowej
    const [rear, , bow] = pipeTercileLoad(net, f.bounds);
    assert.ok(rear > bow * 1.3, `${key}: rufa ${rear.toFixed(0)} vs dziób ${bow.toFixed(0)}`);
    // najgrubsze wiązki przy gondolach: biegi z 5+ rurami istnieją
    assert.ok(net.runs.some((r) => r.n >= 5), `${key}: brak grubej wiązki`);
    // lustro: druga łamana biegu = pierwsza odbita; osprzęt w parach
    for (const r of net.runs) {
      assert.equal(r.polys.length, 2);
      const [a, b] = r.polys;
      assert.equal(a.length, b.length);
      for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i][0] - b[i][0]) < 1e-9 && Math.abs(a[i][1] + b[i][1]) < 1e-9);
      assert.ok(a.every(([, y]) => y < 0), `${key}: bieg na burcie y < 0`);
    }
    const D = d.detail;
    for (const ft of net.fits) {
      if (Math.abs(ft.y) <= 0.5 * D) continue;
      assert.ok(net.fits.some((g) => g.type === ft.type && Math.abs(g.x - ft.x) < 1e-6 && Math.abs(g.y + ft.y) < 1e-6), `${key}: osprzęt bez pary lustra`);
    }
    const types = new Set(net.fits.map((x) => x.type));
    assert.ok(types.has(HD_PIPE_FIT.collar), `${key}: kołnierze`);
    // proste wiązki (bez falowania za ząbkami ścian): długość na odcinkach co 45° (reszta — łuki kolan), skośnych
    // odcinków prawie brak
    let tot = 0, oct = 0, skew = 0;
    for (const r of net.runs) {
      if (!r.auto) continue;
      const pl = r.polys[0];
      for (let q = 0; q + 1 < pl.length; q++) {
        const L = Math.hypot(pl[q + 1][0] - pl[q][0], pl[q + 1][1] - pl[q][1]);
        const t = Math.atan2(pl[q + 1][1] - pl[q][1], pl[q + 1][0] - pl[q][0]) / (Math.PI / 4);
        tot += L;
        if (Math.abs(t - Math.round(t)) < 0.02) oct += L; else if (L > 4 * D) skew += L;
      }
    }
    assert.ok(oct / tot > 0.75, `${key}: odcinki co 45° ${(oct / tot).toFixed(2)}`);
    assert.ok(skew / tot < 0.05, `${key}: skośne odcinki ${(skew / tot).toFixed(3)}`);
  }
});

test('standaryzacja: zaszumiony prostokąt, schodki → skos, lustro burt, okruchy znikają, flota TN symetryczna', () => {
  // prostokąt 200 × 100 z ząbkami (szum ±1,5 j.) → 4 rogi, krawędzie osiowe na siatce kroku
  const noisy = [];
  for (let i = 0; i <= 20; i++) noisy.push([i * 10, (i % 2) * 1.5 - 0.7]);
  for (let i = 1; i <= 10; i++) noisy.push([200 + (i % 2) * 1.2, i * 10]);
  for (let i = 19; i >= 0; i--) noisy.push([i * 10, 100 + (i % 3) * 0.8]);
  for (let i = 9; i >= 1; i--) noisy.push([(i % 2) * -1.3, i * 10]);
  const r = regularizeLoop(noisy, { step: 2 });
  assert.ok(r && r.length === 4, `rogi: ${r && r.length}`);
  for (let i = 0; i < 4; i++) {
    const a = r[i], b = r[(i + 1) % 4];
    assert.ok(Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9, 'krawędź osiowa');
    assert.ok(Math.abs(a[0] / 2 - Math.round(a[0] / 2)) < 1e-9 && Math.abs(a[1] / 2 - Math.round(a[1] / 2)) < 1e-9, 'róg na siatce');
  }
  // skos odrysowany schodkami (zęby 10 j.) między długimi bokami → jedna prosta 45°
  const stairs = [[0, 0], [300, 0], [300, 60]];
  for (let k = 0; k < 6; k++) stairs.push([300 - 10 * k, 60 + 10 * k], [290 - 10 * k, 60 + 10 * k]);
  stairs.push([240, 120], [0, 120]);
  const rs = regularizeLoop(stairs, { step: 2, minLen: 4, jog: 3 });
  assert.ok(rs, 'schodki');
  const diag = rs.some((a, i) => {
    const b = rs[(i + 1) % rs.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6 && Math.hypot(dx, dy) > 40;
  });
  assert.ok(diag, `skos 45°: ${JSON.stringify(rs)}`);
  // lustro: łamana dokładnie lustrzana zostaje lustrzana; para burt — wynik drugiej = odbicie pierwszej
  const half = [[-120, 0], [-118, -31], [-90, -33.4], [-60, -29.2], [-31, -41], [10, -40.6], [70, -22], [118, 0]];
  const sym = regularizeLoopSym(symPolyPoints(half), { step: 2 });
  assert.ok(sym, 'lustrzana');
  const key = (x, y) => `${x.toFixed(6)},${(y === 0 ? 0 : y).toFixed(6)}`;
  const set = new Set(sym.map(([x, y]) => key(x, y)));
  assert.ok(sym.every(([x, y]) => set.has(key(x, -y))), 'wynik lustrzany');
  const side = [[10, -80], [60, -83], [62, -50], [33, -47], [9, -52]];
  const ra = regularizeLoopSym(side, { step: 2 }), rb = regularizeLoopSym(side.map(([x, y]) => [x, -y]), { step: 2 });
  assert.deepEqual(rb, ra.map(([x, y]) => [x, -y]), 'para burt odbita');
  // okruch (cienka listwa) z regDrop znika; ta sama bryła bez regDrop zostaje
  const sliver = { kind: 'poly', op: 'add', level: 1, pts: [[0, -40], [60, -40], [60, -37], [0, -37]], reg: 2, regDrop: true, regThin: 9 };
  assert.deepEqual(polyShapeLoops(sliver), []);
  assert.equal(polyShapeLoops({ ...sliver, regDrop: false }).length, 1);
  // flota TN: pola poziomów lustrzane (do teksela) — sieć rur liczona na burcie y < 0 i odbijana
  for (const k of ['hasta', 'bellator', 'citadella']) {
    const f = buildHullField(hullDesignPreset(k), { pipes: false });
    const b = f.bounds;
    const tex = 1 / f.grid.res;
    let worst = 0;
    for (let L = 0; L < 2; L++) for (let i = 0; i < 160; i++) for (let j = 0; j < 40; j++) {
      const x = b.minX + (b.maxX - b.minX) * (i + 0.5) / 160, y = b.minY * (j + 0.5) / 40;
      const p = sampleHullField(f, L, x, y), q = sampleHullField(f, L, x, -y);
      if (Math.abs(p) < 6 * tex || Math.abs(q) < 6 * tex) worst = Math.max(worst, Math.abs(p - q));
    }
    assert.ok(worst < 1.5 * tex, `${k}: burty różne o ${worst.toFixed(3)} j. (teksel ${tex.toFixed(3)})`);
  }
});

test('rury: raster na siatce pola — numer biegu przy osi, przesunięcie ze znakiem, osprzęt; projekt bez lustra', () => {
  const f = buildHullField(hullDesignPreset('citadella'));
  const { a, b, mask } = f.pipeTex;
  const g = f.grid;
  // najdłuższy odcinek sieci: w poprzek jego środka teksele tego biegu, przesunięcie zmienia znak na osi
  let ri = 0, si = 0, best = 0;
  f.pipeNet.runs.forEach((r, i) => {
    const pl = r.polys[0];
    for (let q = 0; q + 1 < pl.length; q++) {
      const l = Math.hypot(pl[q + 1][0] - pl[q][0], pl[q + 1][1] - pl[q][1]);
      if (l > best) { best = l; ri = i; si = q; }
    }
  });
  const poly = f.pipeNet.runs[ri].polys[0];
  const p1 = poly[si + 1], p0 = [(poly[si][0] + p1[0]) / 2, (poly[si][1] + p1[1]) / 2];
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const nx = -(p1[1] - p0[1]) / L, ny = (p1[0] - p0[0]) / L;
  const tex = (x, y) => Math.floor((y - g.y0) * g.res) * g.w + Math.floor((x - g.x0) * g.res);
  const hw = f.pipeNet.runs[ri].halfW * f.pipeNet.detail * 0.6;
  const kp = tex(p0[0] + nx * hw, p0[1] + ny * hw), km = tex(p0[0] - nx * hw, p0[1] - ny * hw);
  assert.equal(b[kp * 4], ri + 1);
  assert.equal(b[km * 4], ri + 1);
  assert.ok(a[kp * 4] * a[km * 4] < 0, 'znak przesunięcia po obu stronach osi');
  assert.ok(mask.reduce((s, v) => s + v, 0) > 1000);
  assert.ok(b.some((v, i) => i % 4 === 1 && v > 0), 'osprzęt w rastrze');
  // projekt bez lustra (pirat z gondolami): sieć na całym kadłubie, bez kopii
  const pd = hullDesignPreset('pirate');
  const fp = buildHullField({ ...pd, pipeNet: { density: 1 } });
  assert.ok(fp.pipeNet.runs.length > 3);
  assert.ok(fp.pipeNet.runs.every((r) => r.polys.length === 1));
  assert.ok(fp.pipeNet.runs.some((r) => r.polys[0].some(([, y]) => y > 30)), 'trasy po obu burtach');
  // raster bez sieci: puste tablice
  assert.equal(rasterPipeNetwork(null, g).mask.length, g.w * g.h);
});

test('kasztele: walidacja, piętra (split, półki na osi), lite bez clip, piętro 2 przycięte do piętra 1, lustro', async () => {
  const { normalizeCastle, expandCastle } = await import('../src/game/hullDesign/hullDesignCastles.js');
  assert.equal(normalizeCastle(null), null);
  const c = normalizeCastle({ x: -300, y: -150, w: 50, h: 40, taperB: 0.65, split: 0.4, clip: undefined });
  assert.equal(c.tiers, 2);
  assert.equal(c.level, 2);
  assert.equal(c.clip, undefined, 'bez clip — lita bryła');
  assert.equal(c.split, 0.4);
  assert.equal(normalizeCastle({ split: 0.01 }).split, 0.15);
  const D = 0.6;
  const ex = expandCastle(c, false, D, HD_LEVELS);
  const t1 = ex.shapes.find((s) => s.level === 2), t2 = ex.shapes.filter((s) => s.level === 3);
  assert.ok(t1 && t2.length === 1);
  assert.equal(t2[0].clip, 2, 'piętro 2 przycięte do poziomu piętra 1');
  // półka (split 0,4) przy burcie: piętro 2 leży w zewnętrznych ~40% wysokości kasztelu (burta przy −y)
  const ys = t2[0].pts.map(([, y]) => y);
  assert.ok(Math.min(...ys) < -150 - 40 * 0.8 && Math.max(...ys) <= -150 - 40 + 0.4 * 80 + 1e-6);
  // faza od burty prawie na całą wysokość (blok-trapez): róg rufowy z fazą 0,65·h
  const xs1 = t1.pts.filter(([, y]) => Math.abs(y - (-190)) < 1e-6).map(([x]) => x);
  assert.ok(Math.min(...xs1) > -350 + 0.65 * 40 - 1e-6, 'faza rufowa od burty');
  // lustro: kopia odbita
  const exM = expandCastle(c, true, D, HD_LEVELS);
  assert.ok(exM.shapes[0].pts.every(([x, y], i) => Math.abs(x - t1.pts[i][0]) < 1e-9 && Math.abs(y + t1.pts[i][1]) < 1e-9));
  // kasztel na osi z półkami przy burtach: dwa wielokąty piętra 2, symetryczne
  const ax = normalizeCastle({ x: -360, y: 0, w: 100, h: 100, split: 0.5 });
  const exA = expandCastle(ax, false, D, HD_LEVELS);
  const pads = exA.shapes.filter((s) => s.level === 3);
  assert.equal(pads.length, 2);
  const padY = pads.map((p) => p.pts.reduce((s, [, y]) => s + y, 0) / p.pts.length).sort((a, b) => a - b);
  assert.ok(Math.abs(padY[0] + padY[1]) < 1e-6 && padY[0] < -50);
  // w projekcie: lity kasztel podnosi poziom 2 także nad szczeliną ramy, lustro dopisuje drugą burtę
  const d = normalizeHullDesign({
    v: 2, detail: 0.6, mirror: true, shapes: [{ kind: 'rect', op: 'add', x: 0, y: 0, w: 200, h: 120, level: 1 }],
    castles: [{ x: -60, y: -60, w: 40, h: 30 }]
  });
  const e = expandHullDesign(d);
  assert.equal(e.shapes.filter((s) => s.castle && s.level === 2).length, 2, 'kasztel i jego lustro');
  const f = buildHullField(d);
  assert.ok(sampleHullField(f, 2, -60, -60) < 0 && sampleHullField(f, 2, -60, 60) < 0);
});

test('presety TN: kasztele rufowe, kratki-radiatory, kapsuły i iluminatory (warianty modułów), rury rdzenia dziobu', () => {
  const cit = expandHullDesign(normalizeHullDesign(hullDesignPreset('citadella')));
  assert.ok(cit.shapes.filter((s) => s.castle).length >= 8, 'kasztele Citadelli z piętrami i lustrem');
  assert.ok(cit.modules.filter((m) => m.type === 'vent' && m.v === 1).length > 20, 'radiatory TN');
  assert.ok(cit.modules.some((m) => m.type === 'vent' && m.v === 2), 'krata');
  assert.ok(cit.modules.some((m) => m.type === 'well' && m.v === 1), 'iluminator');
  assert.ok(cit.modules.some((m) => m.type === 'hatch' && m.v === 1), 'klapa TN');
  assert.ok(cit.pipes.length >= 1, 'rury rdzenia dziobu');
  const col = expandHullDesign(normalizeHullDesign(hullDesignPreset('colossus')));
  assert.ok(col.modules.filter((m) => m.type === 'well' && m.v === 2).length >= 8, 'iluminatory w ośmiokątnych ramach');
  assert.ok(col.shapes.filter((s) => s.castle).length >= 8);
  for (const k of ['custos', 'hasta', 'bellator']) {
    const dd = normalizeHullDesign(hullDesignPreset(k));
    assert.ok(dd.castles.length >= 1, `${k}: kasztel`);
    assert.ok(dd.panels < 1, `${k}: rzadszy podział paneli (jak sprite)`);
  }
});

test('kompozytor: WGSL passów buduje się w Node; smoothstep bez stałych krawędzi malejących (pułapka 6)', async () => {
  const THREE = await import('three/webgpu');
  const { HullComposer } = await import('../src/3d/hullDesign/hullComposer.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const comp = new HullComposer(renderer);
  assert.deepEqual(comp.passes.map((p) => p.name), ['geo', 'base', 'emis', 'surf', 'alb', 'eout']);
  const constEdges = /smoothstep\(\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*,/g;
  for (const p of comp.passes) {
    const mesh = p.quad;
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material;
    b.scene = new THREE.Scene();
    b.camera = new THREE.OrthographicCamera();
    b.context.material = mesh.material;
    b.build();
    const fs = b.fragmentShader;
    assert.match(fs, /fn main/, p.name);
    for (const m of fs.matchAll(constEdges)) {
      assert.ok(Number(m[1]) < Number(m[2]), `${p.name}: smoothstep(${m[1]}, ${m[2]}, …) — krawędzie malejące`);
    }
  }
});
