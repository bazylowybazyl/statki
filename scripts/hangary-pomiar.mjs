// POMIAR HANGARÓW: co zmieści się w ładowniach kadłubów (src/data/cargoBays.js) — okręty
// (fregaty, niszczyciele, pancerniki) i pole siłowe startu myśliwców — i ile ładunku to zabiera.
// Okręt i pole zabierają miejsce ładunkowi (decyzja użytkownika 2026-10-05): slot modułu, którego
// podstawa zachodzi na stanowisko (obrys kadłuba + luz) albo na pole myśliwców, odpada.
//
// Wymiary jednostek: obrys alfy sprite'a w j. gry (skala getHullRenderSize), wysokość: bryła 3D
// modelu (buildShip3D, bez wież). Pakowanie: gilotyna z frontem Pareto (kilka typów naraz), obie
// orientacje (dziób wzdłuż / w poprzek osi ładowni). Atlas: przeszukanie grzbietu (strefy jak
// tests/cargoBays.test.mjs) — największy luk dziś i po przesunięciu gniazd z grzbietu.
//
// node scripts/hangary-pomiar.mjs [--luz 2] [--pole 60x60] [--out .tmp/hangary]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import { decodePng, encodePng } from './webgpu/png.mjs';
import { buildShip3D } from '../src/3d/ships3d/ships/ships3D.js';
import { FLEET3D_SPECS } from '../src/3d/ships3d/ships/fleetHull3D.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { BRIDGE_LAYOUT_PROPOSALS, bridgeZoneMargin } from '../src/game/shipBridge.js';
import { getHullRenderSize, getWeaponTierForHull } from '../src/data/ships.js';
import {
  CARGO_BAY_HULLS, CARGO_BAY_HULL_ORDER, CARGO_BAY_PARAMS, CARGO_TONNES_DEFAULT,
  cargoBayGeometry, cargoBayScale, cargoBaySlots, cargoHullBays
} from '../src/data/cargoBays.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = (p) => resolve(ROOT, p);
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const CLEAR = Number(arg('luz', 2));                                        // luz stanowiska wokół obrysu [j.]
const [FIELD_A, FIELD_B] = String(arg('pole', '60x60')).split('x').map(Number); // pole myśliwców [j.]
const OUT = file(arg('out', '.tmp/hangary'));
const TONNES = CARGO_TONNES_DEFAULT;
const CRADLE = 1.5;                                                          // kołyska pod kilem [j.]
const EPS = 1e-6;
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');

// ---------------------------------------------------------------------------
// Jednostki: obrys ze sprite'a, wysokość z modelu 3D
// ---------------------------------------------------------------------------

function alphaBox(img, thr = 128) {
  const { width: W, height: H, data } = img;
  let x0 = W; let y0 = H; let x1 = -1; let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] < thr) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

const UNIT_DEFS = [
  ['terran_frigate', 'Custos', 'fregata TN'],
  ['terran_destroyer', 'Hasta', 'niszczyciel TN'],
  ['pirate_frigate', 'Marauder', 'fregata piratów'],
  ['pirate_destroyer', 'Reaver', 'niszczyciel piratów'],
  ['terran_battleship', 'Bellator', 'pancernik TN'],
  ['pirate_battleship', 'Iron Skull', 'pancernik piratów']
];

function measureUnit([id, label, role]) {
  const spec = FLEET3D_SPECS[id];
  const img = decodePng(readFileSync(file(spec.sprite)));
  const size = getHullRenderSize(id, img.width, img.height);
  const su = Math.max(size.w, size.h) / Math.max(img.width, img.height);
  const bb = alphaBox(img);
  const model = buildShip3D(id);
  const geo = model.builder.toGeometry(THREE, model.scale);
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  geo.dispose();
  return {
    id, label, role, img, su, bb,
    L: (bb.x1 - bb.x0) * su, W: (bb.y1 - bb.y0) * su,
    H: box.max.z - box.min.z,
    cx: (bb.x0 + bb.x1) / 2, cy: (bb.y0 + bb.y1) / 2
  };
}

const UNITS = UNIT_DEFS.map(measureUnit);
const U = Object.fromEntries(UNITS.map((u) => [u.label, u]));

// Myśliwiec: sprite (drawFighterSprite: szerokość 2,4 × promień 12 eskadry multirole).
const fighterImg = decodePng(readFileSync(file('assets/fighter-combat-v1.png')));
const fighterBox = alphaBox(fighterImg);
const fighterScale = (12 * 2.4) / fighterImg.width;
const FIGHTER = { L: (fighterBox.x1 - fighterBox.x0) * fighterScale, W: (fighterBox.y1 - fighterBox.y0) * fighterScale };

// Kadłuby z myśliwcami (punkty `hangar` w edytorze) dostają pole siłowe.
const fighterHangars = (H) => (H.editorKey ? (SHIP_EDITOR_DEFAULTS.ships[H.editorKey]?.hardpoints || []).filter((h) => h.type === 'hangar').length : 0);

// ---------------------------------------------------------------------------
// Pakowanie: gilotyna, front Pareto liczb jednostek (każdy typ w obu orientacjach)
// ---------------------------------------------------------------------------

/** items: [{ ra, rb }] — stanowisko (z luzem) w orientacji „wzdłuż” (ra wzdłuż a). */
function createPacker(items) {
  const k = items.length;
  const memo = new Map();
  const dims = [];
  for (const it of items) dims.push(it.ra, it.rb);
  const minDim = Math.min(...dims);
  const comboCache = new Map();
  // Pozycje cięć: sumy wymiarów stanowisk ≤ D (wzorce normalne).
  function combos(D) {
    const key = Math.round(D * 100);
    let list = comboCache.get(key);
    if (list) return list;
    const set = new Set([0]);
    for (const d of dims) {
      for (const v of [...set]) {
        for (let x = v + d; x <= D + EPS; x += d) set.add(Math.round(x * 100) / 100);
      }
    }
    list = [...set].filter((x) => x > EPS && x < D - EPS).sort((a, b) => a - b);
    comboCache.set(key, list);
    return list;
  }
  const ZERO = [{ c: new Array(k).fill(0), plan: null }];
  const dominates = (p, q) => {
    let strict = false;
    for (let i = 0; i < k; i++) {
      if (p[i] < q[i]) return false;
      if (p[i] > q[i]) strict = true;
    }
    return strict;
  };
  function addFront(front, e) {
    for (const f of front) if (dominates(f.c, e.c) || f.c.every((v, i) => v === e.c[i])) return;
    for (let i = front.length - 1; i >= 0; i--) if (dominates(e.c, front[i].c)) front.splice(i, 1);
    front.push(e);
  }
  function f(A, B) {
    if (A < minDim - EPS || B < minDim - EPS) return ZERO;
    const key = `${Math.round(A * 100)}|${Math.round(B * 100)}`;
    let front = memo.get(key);
    if (front) return front;
    front = [];
    items.forEach((it, t) => {
      for (const o of [0, 1]) {
        const sa = o ? it.rb : it.ra;
        const sb = o ? it.ra : it.rb;
        const nx = Math.floor((A + EPS) / sa);
        const ny = Math.floor((B + EPS) / sb);
        if (nx * ny <= 0) continue;
        const c = new Array(k).fill(0);
        c[t] = nx * ny;
        addFront(front, { c, plan: { kind: 'grid', t, o, sa, sb, nx, ny } });
      }
    });
    for (const [axis, D, other] of [[0, A, B], [1, B, A]]) {
      for (const x of combos(D)) {
        const f1 = axis ? f(A, x) : f(x, B);
        const f2 = axis ? f(A, B - x) : f(A - x, B);
        if (f1 === ZERO && f2 === ZERO) continue;
        for (const e1 of f1) {
          for (const e2 of f2) {
            const c = e1.c.map((v, i) => v + e2.c[i]);
            if (c.every((v) => v === 0)) continue;
            addFront(front, { c, plan: { kind: 'cut', axis, x, e1, e2 } });
          }
        }
      }
      void other;
    }
    if (!front.length) front = ZERO;
    memo.set(key, front);
    return front;
  }
  /** Rozwija plan w stanowiska { t, o, a0, b0, a1, b1 } (układ od rogu (0, 0)). */
  function place(e, a0, b0, out) {
    const p = e?.plan;
    if (!p) return out;
    if (p.kind === 'grid') {
      for (let i = 0; i < p.nx; i++) {
        for (let j = 0; j < p.ny; j++) {
          out.push({ t: p.t, o: p.o, a0: a0 + i * p.sa, b0: b0 + j * p.sb, a1: a0 + (i + 1) * p.sa, b1: b0 + (j + 1) * p.sb });
        }
      }
    } else if (p.axis === 0) {
      place(p.e1, a0, b0, out);
      place(p.e2, a0 + p.x, b0, out);
    } else {
      place(p.e1, a0, b0, out);
      place(p.e2, a0, b0 + p.x, out);
    }
    return out;
  }
  return { f, place, items };
}

const berthOf = (u) => ({ ra: u.L + 2 * CLEAR, rb: u.W + 2 * CLEAR });

/**
 * Front Pareto dla otworu A × B z polem myśliwców Fa × Fb w rogu (albo bez): łączy fronty dwóch
 * prostokątów reszty (dwa cięcia gilotyny wokół pola). Wpisy: { c, place(out) } — stanowiska od rogu.
 */
function frontWithField(packer, A, B, field) {
  const k = packer.items.length;
  if (!field) return packer.f(A, B).map((e) => ({ c: e.c, place: (out) => packer.place(e, 0, 0, out), field: null }));
  const [Fa, Fb] = field;
  if (Fa > A + EPS || Fb > B + EPS) return [];
  const res = [];
  const fieldRect = { a0: A - Fa, b0: 0, a1: A, b1: Fb };
  // Cięcie 1: [0, A−Fa] × [0, B] + [A−Fa, A] × [Fb, B]; cięcie 2: [0, A] × [Fb, B] + [0, A−Fa] × [0, Fb].
  const opts = [
    [[A - Fa, B, 0, 0], [Fa, B - Fb, A - Fa, Fb]],
    [[A, B - Fb, 0, Fb], [A - Fa, Fb, 0, 0]]
  ];
  for (const [r1, r2] of opts) {
    const f1 = packer.f(r1[0], r1[1]);
    const f2 = packer.f(r2[0], r2[1]);
    for (const e1 of f1) {
      for (const e2 of f2) {
        const c = e1.c.map((v, i) => v + e2.c[i]);
        res.push({
          c,
          field: fieldRect,
          place: (out) => { packer.place(e1, r1[2], r1[3], out); packer.place(e2, r2[2], r2[3], out); return out; }
        });
      }
    }
  }
  // Pareto.
  const keep = [];
  for (const e of res) {
    if (keep.some((q) => q.c.every((v, i) => v >= e.c[i]))) continue;
    for (let i = keep.length - 1; i >= 0; i--) if (e.c.every((v, j) => v >= keep[i].c[j])) keep.splice(i, 1);
    keep.push(e);
  }
  void k;
  return keep;
}

// ---------------------------------------------------------------------------
// Ładunek: sloty modułów zajęte przez stanowiska i pole
// ---------------------------------------------------------------------------

const overlap = (r, a0, b0, a1, b1) => r.a0 < a1 - 0.01 && r.a1 > a0 + 0.01 && r.b0 < b1 - 0.01 && r.b1 > b0 + 0.01;

/** Liczy wolne sloty dla układu (prostokąty w układzie ładowni). */
function freeSlots(geo, rects) {
  const L = geo.module.L / 2;
  const W = geo.module.W / 2;
  let free = 0;
  for (const s of cargoBaySlots(geo)) {
    let hit = false;
    for (const r of rects) if (overlap(r, s.a - L, s.b - W, s.a + L, s.b + W)) { hit = true; break; }
    if (!hit) free++;
  }
  return free;
}

/**
 * Najlepsze ustawienie układu (stanowiska od rogu + pole) w otworze: odbicia i przesunięcia całego
 * układu w wolnym zapasie — najmniej zajętych slotów. limit[t] — ile jednostek typu t zostawić
 * (nadmiar z frontu odpada). Zwraca { berths, field, free, tonnes } w układzie ładowni.
 */
function settle(geo, entry, limit) {
  const A = 2 * geo.halfA;
  const B = 2 * geo.halfB;
  const all = entry.place([]);
  const left = limit.slice();
  const berths = [];
  for (const p of all) if (left[p.t] > 0) { left[p.t]--; berths.push(p); }
  const rects = [...berths];
  if (entry.field) rects.push({ ...entry.field, field: true });
  let ea = 0;
  let eb = 0;
  for (const r of rects) { ea = Math.max(ea, r.a1); eb = Math.max(eb, r.b1); }
  const sa = Math.max(0, A - ea);
  const sb = Math.max(0, B - eb);
  let best = null;
  const steps = (v) => (v < 0.5 ? [0] : Array.from({ length: 13 }, (_, i) => (v * i) / 12));
  for (const fa of [false, true]) {
    for (const fb of [false, true]) {
      for (const da of steps(sa)) {
        for (const db of steps(sb)) {
          const moved = rects.map((r) => {
            let a0 = r.a0 + da; let a1 = r.a1 + da; let b0 = r.b0 + db; let b1 = r.b1 + db;
            if (fa) [a0, a1] = [A - a1, A - a0];
            if (fb) [b0, b1] = [B - b1, B - b0];
            return { ...r, a0: a0 - geo.halfA, a1: a1 - geo.halfA, b0: b0 - geo.halfB, b1: b1 - geo.halfB };
          });
          const free = freeSlots(geo, moved);
          if (!best || free > best.free) best = { free, rects: moved };
        }
      }
    }
  }
  const per = geo.module.count * TONNES;
  return {
    berths: best.rects.filter((r) => !r.field),
    field: best.rects.find((r) => r.field) || null,
    free: best.free,
    tonnes: best.free * per
  };
}

/** Potrzebna głębokość ładowni dla jednostki (kołyska + bryła + luz + kieszeń wrót). */
const depthFor = (u, geo) => CRADLE + u.H + CARGO_BAY_PARAMS.depthClear + (geo.pocketDrop || 0);

// ---------------------------------------------------------------------------
// Raport 1: jednostki
// ---------------------------------------------------------------------------

const lines = [];
const log = (s = '') => { lines.push(s); console.log(s); };

log(`# Pomiar hangarów (luz stanowiska ${fmt(CLEAR, 1)} j. na burtę, pole myśliwców ${FIELD_A} × ${FIELD_B} j., ${TONNES} t / kontener)`);
log('');
log('## Jednostki (obrys sprite\'a, bryła 3D bez wież)');
log('| jednostka | długość × szerokość [j.] | wysokość 3D [j.] | stanowisko z luzem [j.] | głębokość ładowni dla bryły 3D [j.] |');
log('|---|---|---|---|---|');
for (const u of UNITS) {
  const b = berthOf(u);
  log(`| ${u.label} (${u.role}) | ${fmt(u.L)} × ${fmt(u.W)} | ${fmt(u.H)} | ${fmt(b.ra)} × ${fmt(b.rb)} | ${fmt(CRADLE + u.H + CARGO_BAY_PARAMS.depthClear)} + kieszeń wrót |`);
}
log(`| myśliwiec (sprite) | ${fmt(FIGHTER.L, 1)} × ${fmt(FIGHTER.W, 1)} | — | — | — |`);
log('');

// ---------------------------------------------------------------------------
// Raport 2: obecne ładownie — po jednym typie
// ---------------------------------------------------------------------------

const SINGLE = UNITS.map((u) => createPacker([berthOf(u)]));
const TIGHT = 1;
const SINGLE_TIGHT = UNITS.map((u) => createPacker([{ ra: u.L + 2 * TIGHT, rb: u.W + 2 * TIGHT }]));

function bayReport(H, geo, withField) {
  const A = 2 * geo.halfA;
  const B = 2 * geo.halfB;
  const field = withField ? [FIELD_A, FIELD_B] : null;
  const per = geo.module.count * TONNES;
  const out = { geo, A, B, cargo: geo.slots * per, field: null, units: [] };
  if (field) {
    const fe = frontWithField(SINGLE[0], A, B, field);
    if (fe.length) {
      const st = settle(geo, { ...fe[0], c: [0] }, [0]);
      out.field = st;
    }
  }
  UNITS.forEach((u, i) => {
    const front = frontWithField(SINGLE[i], A, B, field);
    const n = front.reduce((m, e) => Math.max(m, e.c[0]), 0);
    const row = { u, n, depth: depthFor(u, geo) };
    row.nTight = frontWithField(SINGLE_TIGHT[i], A, B, field).reduce((m, e) => Math.max(m, e.c[0]), 0);
    if (n > 0) {
      const e = front.find((q) => q.c[0] === n);
      const full = settle(geo, e, [n]);
      const one = settle(geo, e, [1]);
      row.full = full;
      row.oneCost = (out.field ? out.field.tonnes : out.cargo) - one.tonnes;
      row.orient = [...new Set(full.berths.map((b) => (b.o ? 'w poprzek' : 'wzdłuż')))].join(' + ');
    } else {
      // Ile brakuje: najmniejszy niedobór wymiaru w lepszej orientacji (bez pola).
      const b = berthOf(u);
      const miss = Math.min(Math.max(b.ra - A, b.rb - B, 0), Math.max(b.rb - A, b.ra - B, 0));
      row.miss = miss;
    }
    out.units.push(row);
  });
  return out;
}

log('## Obecne ładownie — ile jednostek JEDNEGO typu (ładunek, który zostaje)');
log(`Komórka: liczba, orientacja → ładunek, który zostaje; „brak X j.” — za ciasno o tyle; „luz ${TIGHT} j.: N” — tyle przy ciaśniejszym luzie (na styk). Kadłuby z punktami hangar: z polem myśliwców.`);
log('');
const REPORT = [];
for (const id of CARGO_BAY_HULL_ORDER) {
  const H = CARGO_BAY_HULLS[id];
  const hangars = fighterHangars(H);
  for (const geo of cargoHullBays(H)) {
    const r = bayReport(H, geo, hangars > 0);
    REPORT.push({ id, H, hangars, r });
  }
}
const header = ['kadłub / ładownia', 'otwór × głęb. [j.]', 'ładunek [t]', 'pole myśl.', ...UNITS.map((u) => u.label)];
log(`| ${header.join(' | ')} |`);
log(`|${header.map(() => '---').join('|')}|`);
for (const { H, hangars, r } of REPORT) {
  const g = r.geo;
  const cells = [
    `${H.label} / ${g.bay.label}`,
    `${fmt(r.A)} × ${fmt(r.B)} × ${fmt(g.depth, 1)} (${g.door})`,
    fmt(r.cargo),
    hangars ? (r.field ? `−${fmt(r.cargo - r.field.tonnes)} t` : 'nie mieści') : '—'
  ];
  for (const row of r.units) {
    const tight = row.nTight > row.n ? ` (luz ${TIGHT} j.: ${row.nTight})` : '';
    if (row.n > 0) {
      cells.push(`**${row.n}** ${row.orient} → ${fmt(row.full.tonnes)} t${tight}`);
    } else {
      cells.push(row.miss < 40 ? `0 · brak ${fmt(row.miss, 1)} j.${tight}` : `0${tight}`);
    }
  }
  log(`| ${cells.join(' | ')} |`);
}
log('');

// ---------------------------------------------------------------------------
// Raport 3: Atlas — grzbiet (dziś i po przesunięciu gniazd)
// ---------------------------------------------------------------------------

function alphaSAT(img, thr = 200) {
  const W = img.width;
  const H = img.height;
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += img.data[(y * W + x) * 4 + 3] > thr ? 1 : 0;
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row;
    }
  }
  const at = (x, y) => S[y * (W + 1) + x];
  return (x0, y0, x1, y1) => {
    const X0 = Math.round(x0 + W / 2);
    const X1 = Math.round(x1 + W / 2);
    const Y0 = Math.round(y0 + H / 2);
    const Y1 = Math.round(y1 + H / 2);
    const area = (X1 - X0) * (Y1 - Y0);
    if (area <= 0) return 0;
    const cx0 = Math.max(0, Math.min(W, X0));
    const cx1 = Math.max(0, Math.min(W, X1));
    const cy0 = Math.max(0, Math.min(H, Y0));
    const cy1 = Math.max(0, Math.min(H, Y1));
    const inside = at(cx1, cy1) - at(cx0, cy1) - at(cx1, cy0) + at(cx0, cy0);
    return inside / area;
  };
}

const DOORS = [['pocket', 1], ['pocket', 2], ['pocket', 3], ['over', 1], ['over', 2], ['over', 3]];

/** Przeszukanie prostokątów o środku w y = yc (PNG px) na kadłubie: strefy jak validateCargoBays. */
function searchBays(hullId, { removeIds = [], ycs = [0], side = 0, step = 24, hhStep = 6, field = true } = {}) {
  const H = CARGO_BAY_HULLS[hullId];
  const cfg = SHIP_EDITOR_DEFAULTS.ships[H.editorKey];
  const img = decodePng(readFileSync(file(H.sprite)));
  const opaque = alphaSAT(img);
  const entry = BRIDGE_LAYOUT_PROPOSALS[H.bridgeKey];
  const bridges = entry ? entry.variants[entry.defaultVariant] : [];
  const size = getHullRenderSize(H.profile, H.png.w, H.png.h);
  const margin = bridgeZoneMargin(Math.min(size.w / H.png.w, size.h / H.png.h), getWeaponTierForHull(H.profile));
  const s = cargoBayScale(H);
  const markers = [];
  for (const hp of cfg.hardpoints || []) if (hp.type !== 'hangar' && !removeIds.includes(hp.id)) markers.push([+hp.x, +hp.y]);
  for (const e of [...(cfg.engines?.main || []), ...(cfg.engines?.side || [])]) markers.push([+e.x, +e.y]);
  for (const c of cfg.cores || []) markers.push([+c.x, +c.y]);
  const rectOk = (x0, y0, x1, y1, need, alphaOnly) => {
    if (opaque(x0, y0, x1, y1) < 0.97) return false;
    if (alphaOnly) return true;
    for (const [mx, my] of markers) {
      const dx = Math.max(x0 - mx, 0, mx - x1);
      const dy = Math.max(y0 - my, 0, my - y1);
      if (dx * dx + dy * dy < need * need) return false;
    }
    for (const z of bridges) {
      const hw = (Number(z.w) || 0) / 2 + margin / 2;
      const hh = (Number(z.h) || 0) / 2 + margin / 2;
      if (x1 > z.x - hw && x0 < z.x + hw && y1 > z.y - hh && y0 < z.y + hh) return false;
    }
    return true;
  };
  const W2 = H.png.w / 2;
  const results = [];
  const minLen = 120;
  for (const yc of ycs) for (let x0 = -W2; x0 < W2 - minLen; x0 += step) {
    for (let x1 = x0 + minLen; x1 <= W2; x1 += step) {
      // Otwór w najniższym pasie musi być wolny — inaczej dłuższy też nie będzie.
      if (!rectOk(x0, yc - 40, x1, yc + 40, margin * 0.7, false)) break;
      for (const [door, n] of DOORS) {
        for (let hh = 40; hh < H.png.h / 2; hh += hhStep) {
          if (!rectOk(x0, yc - hh, x1, yc + hh, margin * 0.7, false)) break;
          const band = hh / n;
          // Pokład burtowy: razem z pasem wrót po swojej stronie osi (nie nachodzi na lustrzany).
          if (side < 0 && yc + hh + band > -8) break;
          if (side > 0 && yc - hh - band < 8) break;
          const sideOk = rectOk(x0, yc - hh - band, x1, yc - hh, margin, door !== 'over')
            && rectOk(x0, yc + hh, x1, yc + hh + band, margin, door !== 'over');
          if (!sideOk) continue;
          const A = (x1 - x0) * s;
          const B = 2 * hh * s;
          results.push({ x0, x1, hh, yc, door, n, A, B, area: A * B });
        }
      }
    }
  }
  // Szybka ocena (front Pareto dla Hasty i Custosa) z pamięcią po wymiarach.
  const pair = createPacker([berthOf(U.Hasta), berthOf(U.Custos)]);
  const cache = new Map();
  const score = (r) => {
    const key = `${Math.round(r.A)}|${Math.round(r.B)}`;
    let f = cache.get(key);
    if (!f) {
      f = frontWithField(pair, r.A, r.B, field ? [FIELD_A, FIELD_B] : null);
      cache.set(key, f);
    }
    return f;
  };
  // Najpierw ogranicz do prostokątów niezdominowanych (dla danej długości — największa wysokość).
  const byLen = new Map();
  for (const r of results) {
    const k = `${r.x0}|${r.x1}|${r.yc}`;
    const q = byLen.get(k);
    if (!q || r.hh > q.hh || (r.hh === q.hh && r.door === 'pocket')) byLen.set(k, r);
  }
  const cand = [...byLen.values()];
  let bestH = null;
  let bestC = null;
  let bestArea = null;
  for (const r of cand) {
    const f = score(r);
    r.front = f;
    r.maxH = f.reduce((m, e) => Math.max(m, e.c[0]), 0);
    r.maxC = f.reduce((m, e) => Math.max(m, e.c[1]), 0);
    if (!bestArea || r.area > bestArea.area) bestArea = r;
    const better = (a, b, ka, kb) => !b || a[ka] > b[ka] || (a[ka] === b[ka] && (a[kb] > b[kb] || (a[kb] === b[kb] && a.area < b.area)));
    if (better(r, bestH, 'maxH', 'maxC')) bestH = r;
    if (better(r, bestC, 'maxC', 'maxH')) bestC = r;
  }
  return { H, s, margin, count: results.length, bestH, bestC, bestArea, pair };
}

/** Bay def z wyniku przeszukania (PNG px) → geometria ładowni. */
function bayFromSearch(H, r, label) {
  const def = Object.freeze({
    id: label, label, x: (r.x0 + r.x1) / 2, y: r.yc, w: r.x1 - r.x0, h: 2 * r.hh,
    door: r.door, leaves: r.n, module: Object.freeze({ nx: 2, ny: 2, nz: 2 })
  });
  const hull = { ...H, bays: [def] };
  return cargoBayGeometry(hull, def);
}

function describeFront(geo, front) {
  // Wybrane kombinacje: max Hasta, potem malejąco z dokładaniem Custosów.
  const out = [];
  const maxH = front.reduce((m, e) => Math.max(m, e.c[0]), 0);
  for (let h = maxH; h >= 0; h--) {
    const cands = front.filter((e) => e.c[0] >= h);
    if (!cands.length) continue;
    const e = cands.reduce((m, q) => (q.c[1] > m.c[1] ? q : m));
    const c = e.c[1];
    if (h === 0 && c === 0) continue;
    const st = settle(geo, e, [h, c]);
    out.push({ h, c, tonnes: st.tonnes, st });
  }
  return out;
}

const range = (a, b, d) => Array.from({ length: Math.floor((b - a) / d) + 1 }, (_, i) => a + i * d);
const VARIANTS = [
  { hull: 'atlas', name: 'Atlas — grzbiet, dziś', ycs: [0] },
  { hull: 'atlas', name: 'Atlas — grzbiet bez wyrzutni specjalnej (x −320)', ycs: [0], removeIds: ['m_j34a3qw'] },
  { hull: 'atlas', name: 'Atlas — grzbiet bez wyrzutni rakiet (x 457)', ycs: [0], removeIds: ['m_wx4ubuz'] },
  { hull: 'atlas', name: 'Atlas — grzbiet bez obu wyrzutni', ycs: [0], removeIds: ['m_j34a3qw', 'm_wx4ubuz'] },
  { hull: 'atlas', name: 'Atlas — dwa pokłady burtowe (lustrzane), dziś', ycs: range(-500, -60, 16), side: -1, mirror: true },
  { hull: 'terran_carrier', name: 'Citadella — pokład lewy (dziś y −158)', ycs: range(-320, -40, 8), side: -1 },
  { hull: 'terran_carrier', name: 'Citadella — pokład prawy (dziś y +158)', ycs: range(40, 320, 8), side: 1 },
  { hull: 'terran_carrier', name: 'Citadella — jedna ładownia na osi (zamiast dwóch pokładów)', ycs: [0] }
];

log('## Większe ładownie — przeszukanie kadłubów Atlasa i Citadelli');
log('Prostokąty wolne od gniazd, silników i mostków (zapas jak w tests/cargoBays.test.mjs), w całości na kadłubie,');
log(`z pasami wrót (over — parkowanie skrzydeł, pocket — kieszeń pod poszyciem; ×n — skrzydła teleskopowe); w każdej`);
log(`ładowni pole myśliwców ${FIELD_A} × ${FIELD_B} j. Ładunek przy module 2×2×2.`);
log('');
const VARIANT_RESULTS = [];
for (const v of VARIANTS) {
  const H = CARGO_BAY_HULLS[v.hull];
  const res = searchBays(v.hull, { removeIds: v.removeIds || [], ycs: v.ycs, side: v.side || 0 });
  VARIANT_RESULTS.push({ v, res });
  const mul = v.mirror ? 2 : 1;
  log(`### ${v.name}${v.mirror ? ' — liczby dla OBU pokładów' : ''}`);
  const seen = new Set();
  for (const [tag, r] of [['najwięcej niszczycieli', res.bestH], ['najwięcej fregat', res.bestC], ['największa ładownia', res.bestArea]]) {
    if (!r) continue;
    const key = `${r.x0}|${r.x1}|${r.hh}|${r.yc}|${r.door}|${r.n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const geo = bayFromSearch(H, r, `${v.name}:${tag}`);
    r.geo = geo;
    r.combos = describeFront(geo, frontWithField(res.pair, geo.halfA * 2, geo.halfB * 2, [FIELD_A, FIELD_B]));
    const cargo = geo.slots * geo.module.count * TONNES * mul;
    const door = `${r.door}${r.n > 1 ? ` ×${r.n}` : ''}`;
    log(`- **${tag}**: ${v.mirror ? '2 × ' : ''}${fmt(2 * geo.halfA)} × ${fmt(2 * geo.halfB)} j. (PNG x ${fmt(r.x0)}…${fmt(r.x1)}, y ${fmt(r.yc - r.hh)}…${fmt(r.yc + r.hh)}, ${door}), pusta: ${fmt(cargo)} t`);
    for (const c of r.combos) {
      const parts = [];
      if (c.h) parts.push(`${c.h * mul} × Hasta`);
      if (c.c) parts.push(`${c.c * mul} × Custos`);
      log(`  - ${parts.join(' + ')} + ${mul > 1 ? '2 pola' : 'pole'} myśliwców → zostaje ${fmt(c.tonnes * mul)} t`);
    }
    if (!r.combos.length) log('  - okręty się nie mieszczą (tylko pole myśliwców i ładunek)');
  }
  log('');
}

// ---------------------------------------------------------------------------
// Obrazy: Atlas (dziś i warianty), Citadella
// ---------------------------------------------------------------------------

function makeCanvas(img, k) {
  const W = Math.round(img.width * k);
  const H = Math.round(img.height * k);
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / k));
      const sy = Math.min(img.height - 1, Math.floor(y / k));
      const si = (sy * img.width + sx) * 4;
      const a = img.data[si + 3] / 255;
      const o = (y * W + x) * 4;
      data[o] = 10 * (1 - a) + img.data[si] * a;
      data[o + 1] = 12 * (1 - a) + img.data[si + 1] * a;
      data[o + 2] = 20 * (1 - a) + img.data[si + 2] * a;
      data[o + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

function blend(cv, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return;
  const o = (y * cv.width + x) * 4;
  cv.data[o] = cv.data[o] * (1 - a) + r * a;
  cv.data[o + 1] = cv.data[o + 1] * (1 - a) + g * a;
  cv.data[o + 2] = cv.data[o + 2] * (1 - a) + b * a;
}

function drawRect(cv, x0, y0, x1, y1, col, fillA = 0, lineA = 1, t = 2) {
  const X0 = Math.round(Math.min(x0, x1));
  const X1 = Math.round(Math.max(x0, x1));
  const Y0 = Math.round(Math.min(y0, y1));
  const Y1 = Math.round(Math.max(y0, y1));
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      const edge = x < X0 + t || x >= X1 - t || y < Y0 + t || y >= Y1 - t;
      if (edge && lineA > 0) blend(cv, x, y, col[0], col[1], col[2], lineA);
      else if (fillA > 0) blend(cv, x, y, col[0], col[1], col[2], fillA);
    }
  }
}

function drawEllipse(cv, x0, y0, x1, y1, col, fillA, lineA) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d > 1) continue;
      blend(cv, x, y, col[0], col[1], col[2], d > 0.86 ? lineA : fillA);
    }
  }
}

/** Rysuje ładownię z układem: H — kadłub, geo — ładownia, st — wynik settle, k — skala obrazu. */
function drawBay(cv, H, geo, st, k) {
  const s = cargoBayScale(H);
  const B = geo.bay;
  const X = (a) => (B.x + a / s + H.png.w / 2) * k;
  const Y = (b) => (B.y - b / s + H.png.h / 2) * k;
  // Otwór i pasy wrót.
  drawRect(cv, X(-geo.halfA), Y(-geo.halfB), X(geo.halfA), Y(geo.halfB), [8, 10, 14], 0.85, 1, 3);
  drawRect(cv, X(-geo.halfA), Y(-geo.halfB), X(geo.halfA), Y(geo.halfB), [235, 235, 235], 0, 1, 3);
  if (geo.door === 'over') {
    const p = geo.parking;
    drawRect(cv, X(-geo.halfA), Y(geo.halfB), X(geo.halfA), Y(geo.halfB + p), [240, 190, 40], 0, 0.9, 2);
    drawRect(cv, X(-geo.halfA), Y(-geo.halfB - p), X(geo.halfA), Y(-geo.halfB), [240, 190, 40], 0, 0.9, 2);
  }
  // Wolne sloty ładunku.
  const L = geo.module.L / 2;
  const W = geo.module.W / 2;
  const rects = [...st.berths];
  if (st.field) rects.push(st.field);
  for (const sl of cargoBaySlots(geo)) {
    if (rects.some((r) => overlap(r, sl.a - L, sl.b - W, sl.a + L, sl.b + W))) continue;
    drawRect(cv, X(sl.a - L), Y(sl.b + W), X(sl.a + L), Y(sl.b - W), [214, 120, 30], 0.55, 0.9, 1);
  }
  // Pole myśliwców.
  if (st.field) {
    const f = st.field;
    drawEllipse(cv, X(f.a0), Y(f.b1), X(f.a1), Y(f.b0), [60, 210, 255], 0.35, 0.95);
  }
  // Okręty (sprite'y w stanowiskach).
  for (const p of st.berths) {
    const u = UNITS[p.unit ?? 0];
    const ac = (p.a0 + p.a1) / 2;
    const bc = (p.b0 + p.b1) / 2;
    const xa = Math.floor(Math.min(X(p.a0), X(p.a1)));
    const xb = Math.ceil(Math.max(X(p.a0), X(p.a1)));
    const ya = Math.floor(Math.min(Y(p.b0), Y(p.b1)));
    const yb = Math.ceil(Math.max(Y(p.b0), Y(p.b1)));
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        const a = (x / k - H.png.w / 2 - B.x) * s;
        const b = -(y / k - H.png.h / 2 - B.y) * s;
        const da = a - ac;
        const db = b - bc;
        const sx = Math.round(p.o ? u.cx + db / u.su : u.cx + da / u.su);
        const sy = Math.round(p.o ? u.cy + da / u.su : u.cy - db / u.su);
        if (sx < 0 || sy < 0 || sx >= u.img.width || sy >= u.img.height) continue;
        const si = (sy * u.img.width + sx) * 4;
        const al = u.img.data[si + 3] / 255;
        if (al > 0.02) blend(cv, x, y, u.img.data[si], u.img.data[si + 1], u.img.data[si + 2], al);
      }
    }
    drawRect(cv, X(p.a0), Y(p.b1), X(p.a1), Y(p.b0), [120, 255, 140], 0, 0.5, 1);
  }
}

/** Układ z frontu par (Hasta, Custos) → stanowiska z indeksem jednostki. */
function withUnits(st, items) {
  for (const b of st.berths) b.unit = items[b.t];
  return st;
}

/** Lustro pokładu względem osi kadłuba (drugi pokład burtowy). */
function mirrorDeck(H, r, st, label) {
  const geo = bayFromSearch(H, { ...r, yc: -r.yc }, label);
  const flip = (q) => ({ ...q, b0: -q.b1, b1: -q.b0 });
  return { geo, st: { ...st, berths: st.berths.map(flip), field: st.field ? flip(st.field) : null } };
}

function stack(tiles) {
  const W = tiles[0].width;
  const Hh = tiles.reduce((m, t) => m + t.height, 0);
  const data = new Uint8Array(W * Hh * 4);
  let off = 0;
  for (const t of tiles) { data.set(t.data, off); off += t.data.length; }
  return { width: W, height: Hh, data };
}

mkdirSync(OUT, { recursive: true });
const ATLAS = CARGO_BAY_HULLS.atlas;
const IDX = { Hasta: UNITS.indexOf(U.Hasta), Custos: UNITS.indexOf(U.Custos) };
const images = [];
const sprites = new Map();
const spriteOf = (H) => sprites.get(H) || sprites.set(H, decodePng(readFileSync(file(H.sprite)))).get(H);
const scaleOf = (H) => (H.png.w > 2500 ? 0.5 : 1);

// Dziś: Atlas i Citadella — obecne ładownie z polem myśliwców i tym, co się mieści.
for (const id of ['atlas', 'terran_carrier']) {
  const H = CARGO_BAY_HULLS[id];
  const k = scaleOf(H);
  const cv = makeCanvas(spriteOf(H), k);
  for (const q of REPORT.filter((x) => x.id === id)) {
    const row = q.r.units.find((x) => x.u === U.Custos);
    const st = row.full ? withUnits(row.full, [IDX.Custos]) : (q.r.field ? { ...q.r.field, berths: [] } : null);
    if (st) drawBay(cv, H, q.r.geo, st, k);
  }
  const p = resolve(OUT, `${id}-dzis.png`);
  writeFileSync(p, encodePng(cv));
  images.push(p);
}
// Warianty: dla ładowni z największą liczbą niszczycieli — kombinacje (Hasta / Custos) jedna pod drugą.
VARIANT_RESULTS.forEach(({ v, res }, i) => {
  const r = res.bestH;
  if (!r?.geo || !r.combos?.length) return;
  const H = CARGO_BAY_HULLS[v.hull];
  const k = scaleOf(H);
  const tiles = r.combos.slice(0, 3).map((c) => {
    const cv = makeCanvas(spriteOf(H), k);
    const st = withUnits(c.st, [IDX.Hasta, IDX.Custos]);
    drawBay(cv, H, r.geo, st, k);
    if (v.mirror) {
      const m = mirrorDeck(H, r, st, `${v.name}:lustro`);
      drawBay(cv, H, m.geo, m.st, k);
    }
    return cv;
  });
  const p = resolve(OUT, `wariant-${i}-${v.hull}.png`);
  writeFileSync(p, encodePng(stack(tiles)));
  images.push(p);
});

writeFileSync(resolve(OUT, 'raport.md'), `${lines.join('\n')}\n`);
console.log(`\nObrazy: ${images.join(', ')}`);
console.log(`Raport: ${resolve(OUT, 'raport.md')}`);
