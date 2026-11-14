// Masyw miasta na grzbiecie okrętu (src/game/hullDesign/hullDesignCity.js, docs/OPIS-miasto-3d.md): determinizm,
// lustro, bryły w odsłoniętym środku (poza pancerzem, nadbudówkami w rowie, modułami i wiązkami sieci), stożki ostrzału,
// światła tylko na ścianach, degradacja (zakryty środek / mały okręt = bez miasta). Drednot z pliku (ciągła skorupa
// z odsłoniętym środkiem wzdłuż osi — warships/dreadnought.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { buildHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { buildHullBoard } from '../src/game/hullDesign/hullDesignBoard.js';
import { pipeModuleSdf } from '../src/game/hullDesign/hullDesignPipes.js';
import { hullDesignMountOf } from '../src/game/hullDesign/hullDesignSchema.js';
import {
  buildHullCity, hullCityHeightAt, HD_CITY_BOX_STRIDE as BS, HD_CITY_LIGHT_STRIDE as LS, HD_CITY_TUNE, HD_CITY_VARIANTS
} from '../src/game/hullDesign/hullDesignCity.js';
import { boxHalfAt, pointInBox, HD_TOWER_TUNE } from '../src/game/hullDesign/hullDesignTowers.js';

/** Drednot z ZAKRYTYM środkiem: bez klocków-wycięć skorupy (otwarć rowu osi) — degradacja. */
function closedShell(d0) {
  const d = structuredClone(d0);
  d.shapes = d.shapes.filter((s) => !(s.kind === 'block' && s.op === 'cut' && (s.level ?? 1) === 1));
  return d;
}
const memo = new Map();
function ship(key) {
  if (!memo.has(key)) {
    const design = key === 'zakryty' ? closedShell(hullDesignPreset('dreadnought')) : hullDesignPreset(key);
    const field = buildHullField(design, { board: false });
    const board = buildHullBoard(field, { variant: 'A' });
    memo.set(key, { field, board, cities: new Map() });
  }
  return memo.get(key);
}
function city(key, opts = {}) {
  const s = ship(key);
  const k = JSON.stringify(opts);
  if (!s.cities.has(k)) s.cities.set(k, buildHullCity(s.field, s.board, opts));
  return s.cities.get(k);
}
const boxAt = (c, i) => {
  const o = i * BS, b = c.boxes;
  return { x: b[o], y: b[o + 1], z0: b[o + 2], z1: b[o + 3], hw: b[o + 4], hh: b[o + 5], ch: b[o + 6], bat: b[o + 7], mat: b[o + 8] };
};
function sampleLv(field, arr, x, y) {
  const g = field.grid;
  const fx = (x - g.x0) * g.res - 0.5, fy = (y - g.y0) * g.res - 0.5;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i + 1 >= g.w || j + 1 >= g.h) return field.band;
  const tx = fx - i, ty = fy - j, o = j * g.w + i;
  return (arr[o] * (1 - tx) + arr[o + 1] * tx) * (1 - ty) + (arr[o + g.w] * (1 - tx) + arr[o + g.w + 1] * tx) * ty;
}
/** Punkty rzutu podstawy bryły (siatka co ≤ 4 j., brzeg wcięty o 0,6 j.). */
function footprint(b, f) {
  const nx = Math.max(1, Math.ceil(b.hw / 2)), ny = Math.max(1, Math.ceil(b.hh / 2));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const x = b.x + (-1 + 2 * i / nx) * (b.hw - 0.6), y = b.y + (-1 + 2 * j / ny) * (b.hh - 0.6);
      const ax = Math.abs(x - b.x), ay = Math.abs(y - b.y);
      if (b.ch > 0 && ax + ay > b.hw + b.hh - b.ch - 0.3) continue;   // poza fazą narożnika
      f(x, y);
    }
  }
}

test('miasto: drednot z odsłoniętym środkiem ma zwarty masyw — poziomy, budynki tarasów i szczytu, dominanty, światła', () => {
  for (const v of Object.keys(HD_CITY_VARIANTS)) {
    const c = city('dreadnought', { variant: v });
    assert.ok(c.ok, `${v}: ${c.reason}`);
    assert.ok(c.nBoxes > 800, `${v}: za mało brył (${c.nBoxes})`);
    assert.ok(c.nLights > 2000 && c.nLights <= HD_CITY_TUNE.maxLights, `${v}: światła ${c.nLights}`);
    assert.ok(c.stats.dominants >= 2, `${v}: bez dominant`);
    assert.ok(c.bounds.top > 120, `${v}: za niski szczyt ${c.bounds.top}`);
    // zwartość: miasto stoi w większości przekrojów odsłoniętego środka (klin pokładu z tyłu zajmuje cały rów — bez niego)
    let on = 0, all = 0;
    for (let x = -2600; x <= 1800; x += 20) {
      if (x > -1500 && x < -1250) continue;
      all++;
      let hit = false;
      for (let y = 0; y >= -440 && !hit; y -= 8) hit = hullCityHeightAt(c, x, y) > 0;
      if (hit) on++;
    }
    assert.ok(on / all > 0.75, `${v}: zabudowane przekroje ${Math.round(on / all * 100)}%`);
  }
});

test('miasto: ten sam projekt i ziarno = to samo miasto; inne ziarno = inne', () => {
  const s = ship('dreadnought');
  const a = city('dreadnought', { variant: 'A', seed: 5 });
  const b = buildHullCity(s.field, s.board, { variant: 'A', seed: 5 });
  assert.deepEqual(Array.from(a.boxes), Array.from(b.boxes));
  assert.deepEqual(Array.from(a.lights), Array.from(b.lights));
  assert.deepEqual(Array.from(a.height.data), Array.from(b.height.data));
  const c = city('dreadnought', { variant: 'A', seed: 6 });
  assert.notDeepEqual(Array.from(a.boxes.subarray(0, 600)), Array.from(c.boxes.subarray(0, 600)));
});

test('miasto: lustro osi okrętu — bryły i światła w parach (y, −y)', () => {
  const c = city('dreadnought', { variant: 'A' });
  const key = (x, y, a, b) => `${x.toFixed(2)}|${y.toFixed(2)}|${a.toFixed(2)}|${b.toFixed(2)}`;
  const set = new Map();
  for (let i = 0; i < c.nBoxes; i++) {
    const b = boxAt(c, i);
    const k = key(b.x, b.y, b.z0, b.z1 * 100 + b.hw + b.hh * 0.001);
    set.set(k, (set.get(k) || 0) + 1);
  }
  for (let i = 0; i < c.nBoxes; i++) {
    const b = boxAt(c, i);
    if (Math.abs(b.y) < 0.01) continue;
    assert.ok(set.has(key(b.x, -b.y, b.z0, b.z1 * 100 + b.hw + b.hh * 0.001)), `bryła bez lustra (${b.x}, ${b.y}, ${b.z0})`);
  }
  const ls = new Set();
  for (let i = 0; i < c.nLights; i++) ls.add(key(c.lights[i * LS], c.lights[i * LS + 1], c.lights[i * LS + 2], c.lights[i * LS + 7]));
  for (let i = 0; i < c.nLights; i++) {
    const o = i * LS;
    if (Math.abs(c.lights[o + 1]) < 0.01) continue;
    assert.ok(ls.has(key(c.lights[o], -c.lights[o + 1], c.lights[o + 2], c.lights[o + 7])), 'światło bez lustra');
  }
});

test('miasto: bryły tylko w rowie osi — poza płytami, sylwetką, modułami i wiązkami sieci', () => {
  const s = ship('dreadnought');
  const { field, board } = s;
  const bg = board.grid;
  const L0 = field.levels[0], L1 = field.levels[1], L2 = field.levels[2];
  const mods = field.expanded.modules.filter((m) => !['vent', 'grate', 'port', 'hatch'].includes(m.type));
  for (const v of Object.keys(HD_CITY_VARIANTS)) {
    const c = city('dreadnought', { variant: v });
    let bad = 0, badMod = 0, badDom = 0, first = '';
    for (let i = 0; i < c.nBoxes; i++) {
      const b = boxAt(c, i);
      if (b.z0 > 0.5) continue;                 // stoi na innej bryle — ta stoi już w rowie
      footprint(b, (x, y) => {
        if (!(sampleLv(field, L0, x, y) < 0 && sampleLv(field, L1, x, y) > 0)) { bad++; first ||= `poza rowem / na nadbudówce (${x.toFixed(1)}, ${y.toFixed(1)})`; }
        if (sampleLv(field, L2, x, y) < HD_CITY_TUNE.superClear - 2) { bad++; first ||= `przy nadbudówce bez ulicy (${x.toFixed(1)}, ${y.toFixed(1)})`; }
        const bi = Math.floor((x - bg.x0) / bg.cell), bj = Math.floor(Math.abs(y) / bg.cell);
        if (!board.dom[bj * bg.w + bi]) { badDom++; first ||= `na wiązce / module płytki (${x.toFixed(1)}, ${y.toFixed(1)})`; }
        for (const m of mods) if (pipeModuleSdf(m, x, y) < 0) { badMod++; first ||= `na module ${m.type} (${x.toFixed(1)}, ${y.toFixed(1)})`; }
      });
    }
    assert.equal(bad + badMod + badDom, 0, `${v}: ${bad} poza rowem, ${badMod} na modułach, ${badDom} na wiązkach — ${first}`);
    // place: rdzenie i mostek mają wolny plac (luz z HD_CITY_TUNE.plazaPad)
    for (const m of mods.filter((q) => q.type === 'reactor' || q.type === 'bridge')) {
      const pad = HD_CITY_TUNE.plazaPad[m.type] - 1;
      for (let i = 0; i < c.nBoxes; i++) {
        const b = boxAt(c, i);
        footprint(b, (x, y) => assert.ok(pipeModuleSdf(m, x, y) >= pad, `${v}: bryła na placu ${m.type} (${m.x}, ${m.y})`));
      }
    }
  }
});

test('miasto: stożek ostrzału — przy gnieździe broni zabudowa nie wyżej niż linia strzału', () => {
  const { field } = ship('dreadnought');
  const T = HD_CITY_TUNE;
  const guns = field.expanded.modules.map((m) => ({ m, mt: hullDesignMountOf(m) })).filter((g) => g.mt && g.mt.slot !== 'hangar');
  const c = city('dreadnought', { variant: 'C', height: 1.8 });
  for (let i = 0; i < c.nBoxes; i++) {
    const b = boxAt(c, i);
    for (const { m, mt } of guns) {
      const top = T.turretTop[mt.size] ?? 12;
      let d = Infinity;
      footprint(b, (x, y) => { d = Math.min(d, Math.hypot(x - m.x, Math.abs(y) - Math.abs(m.y))); });
      const cap = top + Math.max(0, d - (m.r || 10) * 1.22 - T.fireClear) * T.fireSlope;
      assert.ok(b.z1 <= cap + 2.5 + b.hw * 0.0, `bryła ${b.z1.toFixed(1)} j. przy gnieździe (${m.x}, ${m.y}) — sufit ${cap.toFixed(1)}`);
    }
  }
});

test('miasto: światła tylko na ścianach brył (nigdy na dachu), żadne wewnątrz bryły', () => {
  const c = city('dreadnought', { variant: 'A' });
  const BK = 32, buckets = new Map();
  const boxes = [];
  for (let i = 0; i < c.nBoxes; i++) {
    const b = boxAt(c, i);
    boxes.push(b);
    for (let a = Math.floor((b.x - b.hw - 2) / BK); a <= Math.floor((b.x + b.hw + 2) / BK); a++) {
      for (let q = Math.floor((b.y - b.hh - 2) / BK); q <= Math.floor((b.y + b.hh + 2) / BK); q++) {
        const k = `${a}|${q}`;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(i);
      }
    }
  }
  let onWall = 0;
  for (let i = 0; i < c.nLights; i++) {
    const o = i * LS, x = c.lights[o], y = c.lights[o + 1], z = c.lights[o + 2];
    const near = buckets.get(`${Math.floor(x / BK)}|${Math.floor(y / BK)}`) || [];
    let wall = false;
    for (const bi of near) {
      const b = boxes[bi];
      assert.ok(!pointInBox(b, x, y, z, -0.02), `światło wewnątrz bryły (${x}, ${y}, ${z})`);
      if (z < b.z0 - 0.1 || z > b.z1 - 0.25) continue;
      const q = boxHalfAt(b, z);
      const ax = Math.abs(x - b.x), ay = Math.abs(y - b.y);
      const d = Math.max(ax - q.hw, ay - q.hh, q.ch > 0 ? (ax + ay - (q.hw + q.hh - q.ch)) / Math.SQRT2 : -1e9);
      if (d >= -0.02 && d <= HD_TOWER_TUNE.lightOff + 0.4) wall = true;
    }
    assert.ok(wall, `światło (${x}, ${y}, ${z}) nie wisi na ścianie`);
    onWall++;
  }
  assert.equal(onWall, c.nLights);
});

test('miasto: wysokość i gęstość z opcji; mapa wysokości zgodna z bryłami', () => {
  const a = city('dreadnought', { variant: 'A' });
  const hi = city('dreadnought', { variant: 'A', height: 1.5 });
  const lo = city('dreadnought', { variant: 'A', density: 0.5 });
  // objętość masywu (mapa wysokości) — szczyt sam bywa ścięty sufitem ostrzału
  const vol = (c) => { let v = 0; for (const h of c.height.data) v += h; return v * c.height.cell * c.height.cell; };
  assert.ok(vol(hi) > vol(a) * 1.25, `wysokość ×1,5: objętość ${Math.round(vol(hi))} vs ${Math.round(vol(a))}`);
  assert.ok(lo.stats.buildings < a.stats.buildings, `gęstość 0,5: ${lo.stats.buildings} vs ${a.stats.buildings} budynków`);
  // mapa: w środku wierzchu każdej bryły bez pochylenia wysokość ≥ jej wierzch
  for (let i = 0; i < a.nBoxes; i += 7) {
    const b = boxAt(a, i);
    if (b.bat > 0.05 || b.hw < 3 || b.hh < 3) continue;
    assert.ok(hullCityHeightAt(a, b.x, b.y) >= b.z1 - 0.01, `mapa wysokości pod bryłą (${b.x}, ${b.y}): ${hullCityHeightAt(a, b.x, b.y)} < ${b.z1}`);
  }
});

test('miasto: degradacja — mały okręt i drednot bez otwartego rowu nie dostają miasta', () => {
  for (const key of ['bellator', 'citadella', 'colossus']) {
    const c = city(key);
    assert.equal(c.nBoxes, 0, `${key}: ${c.nBoxes} brył (${c.reason})`);
    assert.equal(c.ok, false);
  }
  // drednot z zakrytym środkiem (skorupa bez otwarć): bez miasta
  const closed = city('zakryty');
  assert.equal(closed.nBoxes, 0, `drednot z zakrytym środkiem: ${closed.nBoxes} brył (${closed.reason})`);
  // bez układu płytki — bez miasta, bez wyjątku
  assert.equal(buildHullCity(ship('colossus').field, null).ok, false);
});

test('pole projektu `city`: normalizacja, strażnik edytora, poza kluczem kształtu; drednot z miastem, inne presety bez', async () => {
  const { normalizeHullCityField, normalizeHullDesign, hullDesignShapeKey, HD_CITY_VARIANT_KEYS, HD_CITY_LIMITS } = await import('../src/game/hullDesign/hullDesignSchema.js');
  const { cityViolations, isPlayerBuildable } = await import('../src/game/hullDesign/hullDesignBuildable.js');
  const { HD_PRESET_KEYS } = await import('../src/game/hullDesign/hullDesignPresets.js');
  assert.deepEqual([...HD_CITY_VARIANT_KEYS], Object.keys(HD_CITY_VARIANTS), 'kompozycje schematu = generatora');
  assert.equal(normalizeHullCityField(undefined), null);
  assert.deepEqual(normalizeHullCityField({ variant: 'Z', density: 9, lights: -1 }),
    { on: true, variant: 'A', seed: 0, density: HD_CITY_LIMITS.density[1], height: 1, lights: 0, glow: false });
  assert.equal(normalizeHullCityField({ on: false, variant: 'C' }).on, false, 'wyłączone zostaje z ustawieniami');
  assert.deepEqual(cityViolations({ on: true, variant: 'B', density: 0.8 }), []);
  assert.ok(cityViolations({ variant: 'Z' }).length && cityViolations({ height: 5 }).length && cityViolations({ budynki: [] }).length);
  const d = hullDesignPreset('dreadnought');
  assert.equal(normalizeHullDesign(d).city?.on, true, 'drednot ma miasto');
  assert.ok(isPlayerBuildable(d).ok);
  assert.ok(!isPlayerBuildable({ ...d, city: { on: true, variant: 'Z' } }).ok, 'zła kompozycja — naruszenie');
  const a = normalizeHullDesign(d), b = normalizeHullDesign({ ...d, city: { on: true, variant: 'C', seed: 9 } });
  assert.equal(hullDesignShapeKey(a), hullDesignShapeKey(b), 'miasto nie zmienia obrazu kadłuba');
  for (const k of HD_PRESET_KEYS) if (k !== 'dreadnought') assert.equal(normalizeHullDesign(hullDesignPreset(k)).city, null, `${k}: bez miasta`);
});

test('budowa kreatora: etap miasta z płytki ostatniej pełnej budowy = buildHullCity, z pamięci; bez pełnej budowy — puste', async () => {
  const { createHullDesignBuilder } = await import('../src/game/hullDesign/hullDesignBuild.js');
  const b = createHullDesignBuilder();
  assert.equal(b.city({ variant: 'A' }).nBoxes, 0, 'bez pełnej budowy');
  const d = hullDesignPreset('dreadnought');
  const res = await b.run(d, { full: true }, async () => true);
  assert.ok(res?.field?.board, 'pełna budowa ma układ maszynowni');
  const c1 = b.city({ variant: 'A', seed: 3 });
  const c2 = b.city({ variant: 'A', seed: 3 });
  assert.equal(c1, c2, 'z pamięci');
  const ref = buildHullCity(res.field, res.field.board, { variant: 'A', seed: 3, density: 1, height: 1 });
  assert.equal(c1.nBoxes, ref.nBoxes);
  assert.deepEqual(Array.from(c1.boxes.subarray(0, 240)), Array.from(ref.boxes.subarray(0, 240)));
  assert.ok(c1.nBoxes > 800);
});
