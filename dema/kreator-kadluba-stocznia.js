// dema/kreator-kadluba-stocznia.js
//
// STOCZNIA — przyjazny edytor kadłuba: domyślny interfejs dema kreatora (dema/kreator-kadluba-webgpu.html; pełny panel
// narzędzi to „Warsztat”, `?ui=warsztat`). Wzór: edytory statków i pojazdów ze Spore'a. Z lewej paleta kart
// z miniaturami (Kształty, Systemy, Uzbrojenie, Detale, Malowanie): kartę przeciąga się na okręt, przy włączonej
// symetrii kopia staje sama po drugiej burcie. Na okręcie element pod kursorem świeci, przeciągnięcie przesuwa
// (Shift przy chwytaniu — kopia), upuszczenie z powrotem na paletę usuwa, kółko nad zaznaczonym zmienia rozmiar, pasek
// nad zaznaczeniem: obrót, odbicie, warstwa, wycięcie, rozmiar, powielenie, usunięcie. Bez siatki i kolorowych obrysów —
// widać sam okręt (kontury elementów na życzenie: przycisk „Kontury”, O).
// POWTARZANIE: klik w kartę — stempel (każdy klik na okręcie stawia kopię, przeciągnięcie — rząd stykających się kopii),
// Ctrl+D — powiel (po przesunięciu kopii kolejne Ctrl+D powtarza to samo przesunięcie), Ctrl+C / Ctrl+V — schowek
// (wklejenie pod kursorem).
// Miniatury kart piecze kompozytor okrętu w barwach i stylu projektu (api.composerExclusive — między wypiekami
// projektu), do czasu wypieku karta ma rysunek wektorowy.
// Z dema bierze tylko `api` (shipyardApi w dema/kreator-kadluba-webgpu.js). Zakończona zmiana projektu → requestBuild(false)
// (wpis historii cofania); w trakcie przeciągania S.drag jest ustawione i budowa idzie szybka, bez historii.
import {
  HD_BLOCK_PALETTE, HD_BLOCK_PALETTE_GROUPS, HD_BLOCK_ROT_STEP, blockLocalLoops, blockWorldLoops, hullBlockFromPalette,
  hullBlockPaletteUnit, snapBlockRot
} from '../src/game/hullDesign/hullDesignBlocks.js';
import {
  HD_DETAIL, HD_LEVEL_NAMES, HD_MODULES, HD_MOUNT_RADIUS_DU, HD_PALETTES, HD_PALETTE_KEYS, HD_STYLE_NAMES, hullDesignMountOf,
  normalizeHullDesign
} from '../src/game/hullDesign/hullDesignSchema.js';
import { HD_PARTS, HD_PART_IDS } from '../src/game/hullDesign/hullDesignParts.js';
import { HD_EMBLEMS, HD_EMBLEM_KEYS } from '../src/game/hullDesign/hullEmblems.js';
import { HD_PRESETS, HD_PRESET_KEYS } from '../src/game/hullDesign/hullDesignPresets.js';
import { buildHullField, hullFrameIntegrity, loopDistance, sampleHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { buildHullDecalAtlas } from '../src/3d/hullDesign/hullDecalAtlas.js';
import { bridgeLevel } from '../src/data/bridgeLevels.js';
import {
  CORE_LEVELS, MOUNT_SIZES, MOUNT_SLOT_LABELS, SHIP_CLASSES, coreLevelMax, mountPowerMW, shipClass, sizeRank, weaponPowerMW,
  weaponsForMount
} from '../src/data/shipClasses.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

const ACCENT = '#ffb54a';
const BAD = '#ff6a5e';
/** Poziomy klocków po ludzku (poziom 0 … 3). */
const LEVELS = [
  { label: 'Rama', hint: 'ciemna maszynownia z rurami — pod pancerzem', swatch: '#3a3631' },
  { label: 'Pancerz', hint: 'białe płyty — główna warstwa kadłuba', swatch: '#d6d2c8' },
  { label: 'Nadbudówka', hint: 'piętro nad pancerzem', swatch: '#e6e1d4' },
  { label: 'Mostek', hint: 'najwyższe piętro', swatch: '#f2ede1' }
];
/** Wielkości okrętu od zera: detal floty TN danej klasy (Custos, Hasta, —, Bellator, Citadella, Colossus). */
const NEW_SHIP_DETAIL = [0.09, 0.145, 0.23, 0.366, 0.63, 0.906];
const DECAL_COLORS = ['#d06a22', '#b8342a', '#d8b83a', '#e9e5dc', '#3b3a37', '#6b7a3a'];

const SYSTEMS = [
  ['reactor', 'Reaktor', 'Serce okrętu: moc dla wszystkich urządzeń'],
  ['bridge', 'Mostek', 'Dowodzenie; poziom mostka wyznacza klasę'],
  ['engine', 'Silnik główny', 'Gondola MAIN — ciąg naprzód (na rufie)'],
  ['thruster_side', 'Dysza manewrowa', 'SIDE — obrót i manewry (przy burcie)'],
  ['fuel_tank', 'Zbiornik paliwa', 'Paliwo dla reaktora i silników'],
  ['cargo', 'Ładownia', 'Miejsce na ładunek'],
  ['hangar', 'Wrota hangaru', 'Start i lądowanie myśliwców']
];
const WEAPONS = [
  ['turret_s', null, 'Wieża S', 'Lekka wieża (gniazdo główne S)'],
  ['turret_m', null, 'Wieża M', 'Średnia wieża (gniazdo główne M)'],
  ['turret_l', null, 'Wieża L', 'Ciężka wieża (gniazdo główne L)'],
  ['mount', 'main', 'Gniazdo główne', 'Działo główne — rozmiar z paska nad kartami'],
  ['mount', 'aux', 'Gniazdo pomocnicze', 'Obrona punktowa i lekkie działka'],
  ['mount', 'missile', 'Wyrzutnia rakiet', 'Rakiety i torpedy'],
  ['mount', 'special', 'Gniazdo specjalne', 'Broń specjalna'],
  ['mount', 'builtin', 'Broń wbudowana', 'Broń w kadłubie']
];
const DETAILS = [
  ['hatch', 'Luk serwisowy', 'Klapa w pancerzu'],
  ['vent', 'Kratka', 'Wywietrznik, radiator'],
  ['well', 'Pierścień', 'Okrągły port w pancerzu']
];
const CATS = [
  { id: 'ksztalty', label: 'Kształty', icon: '<path d="M7 3h7l4 6-4 6H7L3 9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><rect x="11" y="12" width="9" height="7" rx="1" fill="currentColor" opacity=".55"/>' },
  { id: 'systemy', label: 'Systemy', icon: '<circle cx="11" cy="11" r="7.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M11 5.5l1.6 4h-3.2zM6.2 14l3.2-2.5.9 1.6zM15.8 14l-4.1-.9.9-1.6z" fill="currentColor"/><circle cx="11" cy="11" r="1.6" fill="currentColor"/>' },
  { id: 'bron', label: 'Uzbrojenie', icon: '<circle cx="9" cy="13" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M11 10.5l8-6M12.6 12.4l7-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
  { id: 'detale', label: 'Detale', icon: '<rect x="3" y="4" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 8h10M6 11h10M6 14h10" stroke="currentColor" stroke-width="1.4"/>' },
  { id: 'farba', label: 'Malowanie', icon: '<path d="M4 17c0-3 2-4 4-4s2.5 1 2.5 2.5S9 19 6.5 19 4 18 4 17z" fill="currentColor"/><path d="M9.5 12.5L18 4l1.5 1.5-8.5 8.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' }
];

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtInt = (v) => Math.round(v).toLocaleString('pl-PL');
const fmtMW = (v) => (Math.round(v * 10) / 10).toLocaleString('pl-PL');

/** Karty palety: { key, cat, group, kind, label, hint, … } — kind: block | module | castle | part | decal | paint | style. */
function buildCatalog() {
  const items = [];
  for (const p of HD_BLOCK_PALETTE) items.push({ key: `blk:${p.id}`, cat: 'ksztalty', group: HD_BLOCK_PALETTE_GROUPS[p.group], kind: 'block', id: p.id, label: p.label, hint: 'Klocek kadłuba' });
  for (const [type, label, hint] of SYSTEMS) items.push({ key: `mod:${type}`, cat: 'systemy', group: 'Systemy okrętu', kind: 'module', type, label, hint, onHull: true });
  for (const [type, slot, label, hint] of WEAPONS) items.push({ key: `mod:${type}${slot ? `:${slot}` : ''}`, cat: 'bron', group: slot ? 'Gniazda broni' : 'Wieże', kind: 'module', type, slot, label, hint, onHull: true });
  for (const [type, label, hint] of DETAILS) items.push({ key: `mod:${type}`, cat: 'detale', group: 'Detale pancerza', kind: 'module', type, label, hint, onHull: true });
  items.push({ key: 'castle', cat: 'detale', group: 'Nadbudówki', kind: 'castle', label: 'Kasztel', hint: 'Schodkowa nadbudówka z fazami', onHull: true });
  for (const id of HD_PART_IDS) items.push({ key: `part:${id}`, cat: 'detale', group: 'Gotowe części Terra Novy', kind: 'part', id, label: HD_PARTS[id].label.replace(/ TN\b/, ''), hint: 'Gotowy fragment okrętu' });
  for (const k of HD_PALETTE_KEYS) items.push({ key: `pal:${k}`, cat: 'farba', group: 'Barwy kadłuba', kind: 'paint', id: k, label: HD_PALETTES[k].label, hint: 'Kliknij albo upuść na okręt' });
  for (const s of ['chamfer', 'rounded', 'sharp']) items.push({ key: `sty:${s}`, cat: 'farba', group: 'Krawędzie', kind: 'style', id: s, label: cap(HD_STYLE_NAMES[s]), hint: 'Styl rogów kadłuba' });
  for (const k of HD_EMBLEM_KEYS) items.push({ key: `emb:${k}`, cat: 'farba', group: 'Naklejki', kind: 'decal', decal: 'emblem', id: k, label: HD_EMBLEMS[k].label, hint: 'Emblemat w kolorze naklejek', onHull: true });
  items.push({ key: 'dec:text', cat: 'farba', group: 'Naklejki', kind: 'decal', decal: 'text', label: 'Napis', hint: 'Tekst z pola „Napis”', onHull: true });
  items.push({ key: 'dec:stripe', cat: 'farba', group: 'Naklejki', kind: 'decal', decal: 'stripe', label: 'Pas', hint: 'Pas w kolorze naklejek', onHull: true });
  return items;
}

// ---------------------------------------------------------------------------
// Geometria elementów (świat): obrysy do podświetlenia, środki, pudła

function circleLoop(x, y, r, n = 40) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
  return out;
}
function rectLoop(x, y, hw, hh, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => [x + lx * c - ly * s, y + lx * s + ly * c]);
}
function stripeLoop(o, fy) {
  const dx = o.x1 - o.x0, dy = (o.y1 - o.y0) * fy, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L * o.w * 0.5, ny = dx / L * o.w * 0.5;
  return [[o.x0 + nx, o.y0 * fy + ny], [o.x1 + nx, o.y1 * fy + ny], [o.x1 - nx, o.y1 * fy - ny], [o.x0 - nx, o.y0 * fy - ny]];
}
const isBlock = (r) => r.kind === 'shape' && r.obj.kind === 'block';
const hasPts = (r) => Array.isArray(r.obj.pts);

export function installShipyard(api) {
  const S = api.S;
  const $ = (id) => document.getElementById(id);
  const el = {
    root: $('yard'), pal: $('yard-pal'), tabs: $('yard-tabs'), opts: $('yard-opts'), cards: $('yard-cards'), trash: $('yard-trash'),
    card: $('yard-card'), sel: $('yard-sel'), help: $('yard-help'), toasts: $('yard-toasts'), ghost: $('yard-ghost'),
    tip: $('yard-tip'), dlg: $('yard-new-dlg'), top: $('yard-top')
  };
  const canvas = api.canvas;
  const items = buildCatalog();
  const byKey = new Map(items.map((i) => [i.key, i]));
  const U = {
    cat: 'ksztalty', level: 1, cut: false, size: 2, mountSize: null, text: 'HF-07', armed: null,
    sel: [], hover: null, drag: null, outlines: false, wheelT: 0,
    mouse: { x: -1, y: -1, wx: 0, wy: 0, over: false },
    designRef: null, dupMemo: null, clip: null, fx: [], flashT: 0, statsKey: '', help: '', look: '',
    integrity: new WeakMap()
  };

  // -------------------------------------------------------------------------
  // Pomocniki projektu
  const design = () => api.design();
  const grid = () => api.blkGrid();
  const zoom = () => S.cam.zoom;
  const mirrorCopy = (r) => {
    const o = r.obj;
    if (!api.mirrorOn(o)) return false;
    if (r.kind === 'shape') return o.kind === 'poly' ? !o.sym : Math.abs(o.y || 0) > 1e-6;
    if (r.kind === 'castle') return Math.abs(o.y) >= o.h * 0.35;
    if (r.kind === 'decal' && o.kind === 'stripe') return Math.abs(o.y0) + Math.abs(o.y1) > 1;
    if (hasPts(r)) return true;
    return Math.abs(o.y ?? 0) > 0.5;
  };
  function listFor(kind) {
    const d = design();
    if (kind === 'shape') return d.shapes;
    if (kind === 'module') return d.modules;
    if (kind === 'decal') return d.decals;
    if (kind === 'castle') return (d.castles = d.castles || []);
    if (kind === 'part') return (d.parts = d.parts || []);
    if (kind === 'groove') return (d.grooves = d.grooves || []);
    return (d.pipes = d.pipes || []);
  }
  const locked = (r) => api.isLocked(r);
  const editable = () => U.sel.filter((r) => !locked(r));
  const isSel = (obj) => U.sel.some((r) => r.obj === obj);

  /** Obrysy elementu: [{ loops, open, mirror }] — oryginał i kopia lustra (gdy jest). */
  function shapesOf(r) {
    const out = [{ ...loopsOf(r, false), mirror: false }];
    if (mirrorCopy(r)) out.push({ ...loopsOf(r, true), mirror: true });
    return out;
  }
  function loopsOf(r, m) {
    const o = r.obj, fy = m ? -1 : 1;
    if (hasPts(r) && r.kind !== 'shape') return { loops: [o.pts.map(([x, y]) => [x, y * fy])], open: true };
    if (r.kind === 'shape') {
      if (o.kind === 'block') return { loops: blockWorldLoops(o, m) };
      if (o.kind === 'poly') return { loops: [api.polyLoopOf(o, m)] };
      if (o.kind === 'circle') return { loops: [circleLoop(o.x, o.y * fy, o.r)] };
      return { loops: [rectLoop(o.x, o.y * fy, o.w, o.h, (o.rot || 0) * fy)] };
    }
    if (r.kind === 'module') {
      const def = HD_MODULES[o.type];
      if (def?.r) return { loops: [circleLoop(o.x, o.y * fy, o.r || def.r)] };
      return { loops: [rectLoop(o.x, o.y * fy, o.w, o.h, (o.rot || 0) * fy)] };
    }
    if (r.kind === 'part') { const b = api.partWorldBox(o, m); return { loops: [rectLoop(b.x, b.y, b.hw, b.hh, b.rot)] }; }
    if (r.kind === 'castle') return { loops: [rectLoop(o.x, o.y * fy, o.w, o.h, (o.rot || 0) * fy)] };
    if (r.kind === 'decal') {
      if (o.kind === 'stripe') return { loops: [stripeLoop(o, fy)] };
      return { loops: [rectLoop(o.x, o.y * fy, o.w / 2, o.h / 2, (o.rot || 0) * fy)] };
    }
    return { loops: [] };
  }
  /** Pudło elementu w świecie (bez kopii lustra): [x0, y0, x1, y1]. */
  function boxOf(r) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of loopsOf(r, false).loops) for (const [x, y] of l) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  }
  function centerOf(r, m = false) {
    const b = boxOf(r);
    const y = (b[1] + b[3]) / 2;
    return [(b[0] + b[2]) / 2, m ? -y : y];
  }
  /** Środek wewnątrz kadłuba (pole ramy ostatniej budowy ≤ 0) — moduły, kasztele i naklejki stoją na kadłubie. */
  function onHull(r) {
    if (!S.field) return true;
    const [x, y] = centerOf(r);
    return sampleHullField(S.field, 0, x, y) <= 0;
  }

  // -------------------------------------------------------------------------
  // Fabryki: element karty w punkcie (wx, wy) → { kind, obj } albo null (odmowa: komunikat z limitów mostka)
  function makeObject(item, wx, wy, place) {
    const d = design();
    const k = (d.detail || 0.6) / 0.6;
    if (item.kind === 'block') {
      S.level = U.level; S.blkCut = U.cut;
      const r = { kind: 'shape', obj: api.paletteBlock(item.id, ...blockBox(item.id, wx, wy)) };
      return U.mouse.alt ? r : attach(r);
    }
    if (item.kind === 'module') {
      if (item.type === 'mount') { S.mountSlot = item.slot; S.mountSize = U.mountSize; }
      const o = api.newModule(item.type, wx, wy, place);
      return o ? { kind: 'module', obj: o } : null;
    }
    if (item.kind === 'castle') return { kind: 'castle', obj: api.newCastle(wx, wy) };
    if (item.kind === 'part') return { kind: 'part', obj: api.newPart(item.id, wx, wy) };
    if (item.kind === 'decal') {
      const R = (v) => Math.round(v * 100) / 100;
      if (item.decal === 'stripe') {
        const L = 60 * k, y = Math.abs(wy) < 10 / zoom() ? 0 : R(wy);
        return { kind: 'decal', obj: { kind: 'stripe', x0: R(wx - L / 2), y0: y, x1: R(wx + L / 2), y1: y, w: R(8 * k), color: S.color, opacity: 0.9 } };
      }
      if (item.decal === 'emblem') S.emblem = item.id;
      else S.text = U.text || 'HF';
      const o = api.newDecal(item.decal, wx, wy);
      o.w = R(o.w * k); o.h = R(o.h * k);   // naklejki w skali okrętu (wymiary panelu są dla detail 0,6)
      return { kind: 'decal', obj: o };
    }
    return null;
  }

  /**
   * Pudło nowego klocka karty `id` przy (wx, wy): jednostka palety projektu × rozmiar z paska (×1–×4, kółko w trakcie
   * stawiania), krawędzie na siatce; blisko osi lustra (14 px) — na osi.
   */
  function blockBox(id, wx, wy) {
    const p = HD_BLOCK_PALETTE.find((q) => q.id === id) || HD_BLOCK_PALETTE[0];
    const g = grid(), u = hullBlockPaletteUnit(g, design().detail || 0.6) * U.size;
    const Wb = p.w * u, Hb = p.h * u;
    const x0 = Math.round((wx - Wb / 2) / g) * g;
    const y0 = design().mirror && Math.abs(wy) * zoom() < 14 ? -Hb / 2 : Math.round((wy - Hb / 2) / g) * g;
    return [x0, y0, x0 + Wb, y0 + Hb];
  }
  /**
   * MAGNES (jak części w Spore przywierające do ciała): nowy klocek blisko kadłuba (do 48 px), ale bez styku, dosuwa
   * się do burty po osi, w którą rośnie pole ramy ostatniej budowy — z zakładką pół kroku siatki, żeby rama była
   * w jednym kawałku. Alt przy stawianiu — bez magnesu. Wycięcia nie przywierają.
   */
  function attach(r) {
    const F = S.field;
    if (!F || r.obj.op === 'cut') return r;
    const f = (x, y) => sampleHullField(F, 0, x, y);
    const g = grid(), reach = 48 / zoom();
    for (let iter = 0; iter < 3; iter++) {
      let best = Infinity, bx = 0, by = 0;
      for (const l of blockWorldLoops(r.obj, false)) {
        for (let i = 0; i < l.length; i++) {
          const [x0, y0] = l[i], [x1, y1] = l[(i + 1) % l.length];
          for (const t of [0, 0.25, 0.5, 0.75]) {
            const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, dd = f(x, y);
            if (dd < best) { best = dd; bx = x; by = y; }
          }
        }
      }
      if (best <= 0 || (iter === 0 && (best > reach || best >= F.band * 0.999))) return r;
      const e = Math.max(0.25, g * 0.5);
      const gx = f(bx + e, by) - f(bx - e, by), gy = f(bx, by + e) - f(bx, by - e);
      const step = Math.ceil(best / g + 0.5) * g;
      if (Math.abs(gx) > Math.abs(gy)) translate(r, -Math.sign(gx) * step, 0);
      else translate(r, 0, -Math.sign(gy) * step);
    }
    return r;
  }
  function setSize(n) {
    const v = Math.max(1, Math.min(4, n));
    if (v === U.size) return;
    U.size = v;
    if (U.cat === 'ksztalty') renderOpts();
  }

  /** Kopia elementu do listy projektu (bez blokady systemu presetu). */
  function cloneObj(r, dx = 0, dy = 0) {
    const o = structuredClone(r.obj);
    delete o.lock;
    translate({ kind: r.kind, obj: o }, dx, dy);
    listFor(r.kind).push(o);
    return { kind: r.kind, obj: o };
  }
  function translate(r, dx, dy) {
    const o = r.obj;
    if (hasPts(r)) { for (const p of o.pts) { p[0] += dx; if (!o.sym) p[1] += dy; } return; }
    if (r.kind === 'decal' && o.kind === 'stripe') { o.x0 += dx; o.x1 += dx; o.y0 += dy; o.y1 += dy; return; }
    o.x += dx; o.y += dy;
    if (isBlock(r)) api.snapBlock(o);
  }
  const posOf = (r) => (hasPts(r) ? r.obj.pts[0] : (r.obj.kind === 'stripe' && r.kind === 'decal' ? [r.obj.x0, r.obj.y0] : [r.obj.x, r.obj.y]));
  function snapshot(r) {
    const o = r.obj;
    return { x: o.x, y: o.y, x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1, pts: o.pts?.map((p) => p.slice()) };
  }
  function restore(r, s, dx = 0, dy = 0) {
    const o = r.obj;
    if (s.pts) { o.pts.forEach((p, i) => { p[0] = s.pts[i][0] + dx; p[1] = s.pts[i][1] + (o.sym ? 0 : dy); }); return; }
    if (r.kind === 'decal' && o.kind === 'stripe') { o.x0 = s.x0 + dx; o.x1 = s.x1 + dx; o.y0 = s.y0 + dy; o.y1 = s.y1 + dy; return; }
    o.x = s.x + dx; o.y = s.y + dy;
    if (isBlock(r)) api.snapBlock(o);
  }

  // -------------------------------------------------------------------------
  // Akcje na zaznaczeniu
  function commit() { api.requestBuild(false); }
  function toast(text, kind = 'info') {
    if (!text) return;
    const t = document.createElement('div');
    t.className = `ytoast ${kind}`;
    t.textContent = text;
    el.toasts.appendChild(t);
    while (el.toasts.children.length > 3) el.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }
  const lockToast = (r) => toast(`${refName(r)}: system na stałym miejscu klasy i kadłuba — zablokowany (w projekcie od zera jest wolny)`, 'warn');
  function fxAt(x, y, kind) { U.fx.push({ x, y, kind, t0: performance.now() }); }

  function select(refs) { U.sel = refs.map((r) => ({ kind: r.kind, obj: r.obj })); U.dupMemo = null; }

  function deleteSel() {
    const refs = editable();
    if (!refs.length) { if (U.sel.length) lockToast(U.sel[0]); return; }
    for (const r of refs) { const [x, y] = centerOf(r); fxAt(x, y, 'poof'); api.removePicked(r); }
    U.sel = U.sel.filter((r) => locked(r));
    commit();
  }

  /** Środek zaznaczenia (przyciągnięty do pół kroku siatki). */
  function selCenter(refs) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of refs) { const b = boxOf(r); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
    const g = grid() / 2;
    return [Math.round((x0 + x1) / 2 / g) * g, Math.round((y0 + y1) / 2 / g) * g];
  }
  function rotatePoint(x, y, cx, cy, a) {
    const dx = x - cx, dy = y - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  }
  /** Obrót o `steps` × 45° (jeden element — w miejscu, grupa — wokół środka). */
  function rotateSel(steps) {
    const refs = editable();
    if (!refs.length) return;
    const a = steps * HD_BLOCK_ROT_STEP;
    const [cx, cy] = selCenter(refs);
    for (const r of refs) {
      const o = r.obj;
      if (refs.length > 1 && !hasPts(r) && !(r.kind === 'decal' && o.kind === 'stripe')) [o.x, o.y] = rotatePoint(o.x, o.y, cx, cy, a);
      if (isBlock(r)) { o.rot = snapBlockRot((o.rot || 0) + a); api.snapBlock(o); }
      else if (hasPts(r) || (r.kind === 'decal' && o.kind === 'stripe')) {
        if (o.sym) continue;
        const P = hasPts(r) ? o.pts : null;
        if (P) for (const p of P) [p[0], p[1]] = rotatePoint(p[0], p[1], cx, cy, a);
        else { [o.x0, o.y0] = rotatePoint(o.x0, o.y0, cx, cy, a); [o.x1, o.y1] = rotatePoint(o.x1, o.y1, cx, cy, a); }
      } else o.rot = (o.rot || 0) + a;
    }
    commit();
  }
  /** Odbicie lewo-prawo (klocek: flip + obrót przeciwny; grupa — względem środka). */
  function flipSel() {
    const refs = editable();
    if (!refs.length) return;
    const [cx] = selCenter(refs);
    for (const r of refs) {
      const o = r.obj;
      if (isBlock(r)) { o.flip = !o.flip; o.rot = snapBlockRot(-(o.rot || 0)); if (refs.length > 1) o.x = 2 * cx - o.x; api.snapBlock(o); continue; }
      if (hasPts(r)) { for (const p of o.pts) p[0] = 2 * cx - p[0]; continue; }
      if (r.kind === 'decal' && o.kind === 'stripe') { o.x0 = 2 * cx - o.x0; o.x1 = 2 * cx - o.x1; continue; }
      if (refs.length > 1) o.x = 2 * cx - o.x;
      if ('flip' in o) o.flip = !o.flip;
      o.rot = Math.PI - (o.rot || 0);
    }
    commit();
  }
  function levelSel(dir) {
    const blocks = editable().filter(isBlock);
    if (!blocks.length) return;
    for (const r of blocks) r.obj.level = Math.max(0, Math.min(3, (r.obj.level ?? 1) + dir));
    toast(`Warstwa: ${LEVELS[blocks[0].obj.level].label}`);
    commit();
  }
  function setLevelSel(L) {
    const blocks = editable().filter(isBlock);
    if (!blocks.length) { U.level = L; renderOpts(); return; }
    for (const r of blocks) r.obj.level = L;
    commit();
  }
  function cutSel() {
    const blocks = editable().filter(isBlock);
    if (!blocks.length) { U.cut = !U.cut; renderOpts(); return; }
    const cut = blocks.some((r) => r.obj.op !== 'cut');
    for (const r of blocks) { r.obj.op = cut ? 'cut' : 'add'; if (cut) delete r.obj.gap; }
    toast(cut ? 'Wycięcie: klocek wycina kadłub pod sobą' : 'Klocek znów dokłada kadłub');
    commit();
  }
  /** Klocek większy / mniejszy o krok (≈ 12% dłuższego boku, co najmniej dwa kroki siatki); fazy i skosy w proporcji. */
  function scaleBlock(b, dir) {
    const g = grid(), st = 2 * g;
    const big = Math.max(b.w, b.h);
    const inc = st * Math.max(1, Math.round(big * 0.12 / st));
    const target = Math.max(st, big + dir * inc);
    const k = target / big;
    const w0 = b.w, h0 = b.h;
    b.w = Math.max(st, Math.round(w0 * k / st) * st);
    b.h = Math.max(st, Math.round(h0 * k / st) * st);
    if (b.c) {
      const full0 = Math.min(w0, h0) / 2, full = Math.min(b.w, b.h) / 2;
      b.c = b.c.map((c) => (Math.abs(c - full0) < 1e-6 ? full : Math.round(c * k / g) * g));
    }
    if (b.shape === 'trap') {
      b.a = Math.abs(Math.abs(b.a || 0) - h0) < 1e-6 ? Math.sign(b.a) * b.h : Math.round((b.a || 0) * k / g) * g;
      b.b = Math.abs(Math.abs(b.b || 0) - h0) < 1e-6 ? Math.sign(b.b) * b.h : Math.round((b.b || 0) * k / g) * g;
    } else if (b.shape === 'tri') b.a = (b.a || 0) / w0 * b.w;
    api.snapBlock(b);
  }
  function scaleSel(dir) {
    const refs = editable();
    if (!refs.length) return false;
    for (const r of refs) {
      if (isBlock(r)) scaleBlock(r.obj, dir);
      else api.scaleObj({ ...r, mirrored: false }, dir > 0 ? 1.1 : 1 / 1.1);
    }
    return true;
  }
  /**
   * POWIEL (Ctrl+D): kopia zaznaczenia obok (przesunięta o szerokość wzdłuż osi okrętu). Gdy zaznaczone są kopie
   * z poprzedniego powielenia (także przesunięte), kolejne powielenie powtarza to samo przesunięcie — rząd, schodki,
   * łuk z kopii.
   */
  function duplicateSel() {
    const refs = editable();
    if (!refs.length) return;
    const memo = U.dupMemo;
    let dx, dy;
    if (memo && memo.copies.length === refs.length && memo.copies.every((o, i) => o === refs[i].obj)) {
      const p = posOf(refs[0]);
      dx = p[0] - memo.from[0]; dy = p[1] - memo.from[1];
    } else {
      let x0 = Infinity, x1 = -Infinity;
      for (const r of refs) { const b = boxOf(r); x0 = Math.min(x0, b[0]); x1 = Math.max(x1, b[2]); }
      const g = grid();
      dx = Math.max(g, Math.round((x1 - x0) / g) * g); dy = 0;
    }
    if (Math.abs(dx) + Math.abs(dy) < 1e-9) dx = grid() * 4;
    const from = posOf(refs[0]).slice();
    const copies = refs.map((r) => cloneObj(r, dx, dy));
    U.sel = copies;
    U.dupMemo = { copies: copies.map((r) => r.obj), from };
    for (const r of copies) { const [x, y] = centerOf(r); fxAt(x, y, 'pop'); }
    commit();
  }
  function copySel() {
    const refs = editable();
    if (!refs.length) return;
    U.clip = { refs: refs.map((r) => ({ kind: r.kind, obj: structuredClone(r.obj) })), center: selCenter(refs) };
    toast(`Skopiowano: ${refs.length} ${refs.length === 1 ? 'element' : (refs.length < 5 ? 'elementy' : 'elementów')} (Ctrl+V — wklej pod kursorem)`);
  }
  function pasteClip() {
    if (!U.clip) return;
    const g = grid();
    const dx = Math.round((U.mouse.wx - U.clip.center[0]) / g) * g, dy = Math.round((U.mouse.wy - U.clip.center[1]) / g) * g;
    U.sel = U.clip.refs.map((r) => cloneObj(r, dx, dy));
    U.dupMemo = null;
    commit();
  }
  function nudgeSel(dx, dy) {
    const refs = editable();
    if (!refs.length) return;
    for (const r of refs) translate(r, dx, dy);
    commit();
  }

  // -------------------------------------------------------------------------
  // Mysz na okręcie
  const overCanvas = (x, y) => document.elementFromPoint(x, y) === canvas;
  const overPalette = (x, y) => el.pal.contains(document.elementFromPoint(x, y));

  /** Uchwyt rozmiaru zaznaczonego klocka pod punktem ekranu. */
  function blockXf(b, mirrored = false) {
    const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), fx = b.flip ? -1 : 1, fy = mirrored ? -1 : 1;
    return {
      toW: (lx, ly) => [b.x + lx * fx * c - ly * s, (b.y + lx * fx * s + ly * c) * fy],
      toL: (wx, wy) => { const dx = wx - b.x, dy = wy * fy - b.y; return [(dx * c + dy * s) * fx, -dx * s + dy * c]; }
    };
  }
  function handles(b, m) {
    const X = blockXf(b, m), out = [];
    for (const hy of [-1, 0, 1]) for (const hx of [-1, 0, 1]) if (hx || hy) { const [x, y] = X.toW(hx * b.w / 2, hy * b.h / 2); out.push({ hx, hy, x, y }); }
    return out;
  }
  /** Jeden zaznaczony klocek dość duży na ekranie, żeby uchwyty nie zasłaniały chwytu za środek (inaczej — bez uchwytów). */
  function handleBlock() {
    const blocks = editable().filter(isBlock);
    if (U.sel.length !== 1 || blocks.length !== 1) return null;
    const b = blocks[0].obj;
    return Math.min(b.w, b.h) * zoom() >= 34 ? blocks[0] : null;
  }
  function handleAt(sx, sy) {
    const r = handleBlock();
    if (!r) return null;
    for (const m of mirrorCopy(r) ? [false, true] : [false]) {
      for (const h of handles(r.obj, m)) {
        const [hx, hy] = toScreen(h.x, h.y);
        if (Math.hypot(hx - sx, hy - sy) <= 7) return { b: r.obj, h, mirrored: m };
      }
    }
    return null;
  }
  /**
   * Element pod punktem: moduły, części, kasztele i naklejki przed klockami (jak w warsztacie), z klocków — WIERZCHNI
   * (ostatni na liście: świeżo postawiony nad starszym), także kopia lustra.
   */
  function pickAt(wx, wy) {
    const p = api.pick(wx, wy);
    if (p && !isBlock(p)) return p;
    const list = design().shapes;
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      if (o.kind !== 'block') continue;
      const r = { kind: 'shape', obj: o };
      for (const m of mirrorCopy(r) ? [false, true] : [false]) if (loopDistance(blockWorldLoops(o, m), wx, wy) <= 0) return { ...r, mirrored: m };
    }
    return p;
  }
  function toScreen(x, y) {
    const { W, H } = api.view();
    return [(x - S.cam.x) * S.cam.zoom + W * 0.5, (y - S.cam.y) * S.cam.zoom + H * 0.5];
  }

  function onPointerDown(e) {
    if (S.ui !== 'stocznia') return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* bez przechwycenia */ }
    const w = api.worldOf(e.clientX, e.clientY);
    const base = { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, w0: w, moved: false, button: e.button };
    if (e.button === 1 || e.button === 2) { U.drag = { ...base, mode: 'pan' }; return; }
    if (e.button !== 0) return;
    if (U.armed) { U.drag = { ...base, mode: 'stamp', item: U.armed, row: null }; return; }
    const h = handleAt(e.clientX, e.clientY);
    if (h) {
      U.drag = { ...base, mode: 'resize', ...h, orig: { ...h.b, c: h.b.c ? h.b.c.slice() : undefined } };
      S.drag = { kind: 'stocznia' };
      return;
    }
    const p = pickAt(w.x, w.y);
    if (p) { U.drag = { ...base, mode: 'pending', p, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }; return; }
    if (e.shiftKey || e.ctrlKey || e.metaKey) { U.drag = { ...base, mode: 'marquee', a: w, b: w, add: true }; return; }
    U.drag = { ...base, mode: 'pan', clear: true };
  }

  function onPointerMove(e) {
    if (S.ui !== 'stocznia') return;
    const w = api.worldOf(e.clientX, e.clientY);
    const m = U.mouse;
    m.x = e.clientX; m.y = e.clientY; m.wx = w.x; m.wy = w.y; m.alt = e.altKey;
    m.over = overCanvas(e.clientX, e.clientY);
    const dr = U.drag;
    if (!dr) { U.hover = m.over ? pickAt(w.x, w.y) : null; return; }
    const dist = Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy);
    if (dr.mode === 'pan') {
      if (dist > 3) dr.moved = true;
      S.cam.x -= (e.clientX - dr.x) / S.cam.zoom; S.cam.y -= (e.clientY - dr.y) / S.cam.zoom;
      dr.x = e.clientX; dr.y = e.clientY;
    } else if (dr.mode === 'palette') {
      if (dist > 5) dr.moved = true;
      moveGhost(e.clientX, e.clientY, dr.moved && !m.over);
    } else if (dr.mode === 'stamp') {
      if (dist > 8) dr.moved = true;
      if (dr.moved) dr.row = rowFor(dr.item, dr.w0, w);
    } else if (dr.mode === 'pending') {
      if (dist > 4) startMove(dr);
    } else if (dr.mode === 'move') moveTo(dr, w);
    else if (dr.mode === 'resize') resizeTo(dr, w);
    else if (dr.mode === 'marquee') dr.b = w;
  }

  function onPointerUp(e) {
    if (S.ui !== 'stocznia') return;
    const dr = U.drag;
    if (!dr) return;
    U.drag = null;
    const w = api.worldOf(e.clientX, e.clientY);
    // podświetlenie od nowa w miejscu puszczenia (w trakcie przeciągania się nie zmienia)
    queueMicrotask(() => { U.hover = !U.drag && overCanvas(e.clientX, e.clientY) ? pickAt(w.x, w.y) : null; });
    if (dr.mode === 'pan') {
      if (!dr.moved && dr.button === 2) {
        // PPM bez przesuwu: koniec stempla albo zaznaczenie elementu pod kursorem
        if (U.armed) { arm(null); return; }
        const p = pickAt(w.x, w.y);
        if (p) select([p]);
      } else if (!dr.moved && dr.clear) select([]);
    } else if (dr.mode === 'palette') {
      hideGhost();
      if (!dr.moved) clickCard(dr.item);
      else if (overCanvas(e.clientX, e.clientY)) dropItem(dr.item, w);
    } else if (dr.mode === 'stamp') {
      const placed = dr.moved && dr.row ? placeRow(dr.row) : dropItem(dr.item, dr.w0, true);
      void placed;
    } else if (dr.mode === 'pending') {
      const p = dr.p;
      if (dr.shift || dr.ctrl) {
        if (isSel(p.obj)) U.sel = U.sel.filter((r) => r.obj !== p.obj);
        else U.sel.push({ kind: p.kind, obj: p.obj });
      } else select([p]);
      if (locked(p)) lockToast(p);
    } else if (dr.mode === 'move') endMove(dr, e);
    else if (dr.mode === 'resize') { S.drag = null; commit(); }
    else if (dr.mode === 'marquee') endMarquee(dr);
  }

  function startMove(dr) {
    const p = dr.p;
    if (locked(p)) { lockToast(p); U.drag = null; return; }
    if (!isSel(p.obj)) select([p]);
    let refs = editable();
    if (dr.shift) { refs = refs.map((r) => cloneObj(r)); U.sel = refs; }
    dr.mode = 'move';
    dr.refs = refs;
    dr.orig = refs.map(snapshot);
    dr.mirrored = p.mirrored;
    dr.copy = !!dr.shift;
    dr.dx = 0; dr.dy = 0;
    U.dupMemo = U.dupMemo && !dr.copy ? U.dupMemo : null;
    S.drag = { kind: 'stocznia' };
    if (dr.copy) api.requestBuild(true);
  }
  function moveTo(dr, w) {
    const blocks = dr.refs.some(isBlock);
    const st = blocks ? grid() : 0.5;
    let dx = Math.round((w.x - dr.w0.x) / st) * st;
    let dy = Math.round(((w.y - dr.w0.y) * (dr.mirrored ? -1 : 1)) / st) * st;
    // pojedynczy element blisko osi lustra — na oś
    if (dr.refs.length === 1 && design().mirror && dr.orig[0].y !== undefined && !hasPts(dr.refs[0])) {
      const y0 = dr.orig[0].y;
      if (Math.abs(y0 + dy) * zoom() < 12) dy = -y0;
    }
    dr.trash = overPalette(U.mouse.x, U.mouse.y);
    if (dx === dr.dx && dy === dr.dy) return;
    dr.dx = dx; dr.dy = dy;
    dr.refs.forEach((r, i) => restore(r, dr.orig[i], dx, dy));
    api.requestBuild(true);
  }
  function endMove(dr) {
    S.drag = null;
    if (dr.trash) {
      for (const r of dr.refs) { const [x, y] = centerOf(r); fxAt(x, y, 'poof'); api.removePicked(r); }
      toast(dr.refs.length > 1 ? `Usunięto: ${dr.refs.length}` : `Usunięto: ${refName(dr.refs[0])}`);
      U.sel = [];
      commit();
      return;
    }
    // moduły, kasztele i naklejki stoją na kadłubie: poza nim wracają (kopia — znika)
    const off = dr.refs.filter((r) => needsHull(r) && !onHull(r));
    if (off.length) {
      if (dr.copy) { for (const r of dr.refs) api.removePicked(r); U.sel = []; }
      else dr.refs.forEach((r, i) => restore(r, dr.orig[i]));
      toast(`${refName(off[0])} musi stać na kadłubie — z powrotem na paletę, by usunąć`, 'warn');
    }
    if (dr.copy && !off.length) for (const r of dr.refs) { const [x, y] = centerOf(r); fxAt(x, y, 'pop'); }
    commit();
  }
  const needsHull = (r) => r.kind === 'module' || r.kind === 'castle' || r.kind === 'decal';

  function resizeTo(dr, w) {
    const b = dr.b, o = dr.orig, g = grid();
    const X = blockXf(o, dr.mirrored);
    const [lx, ly] = X.toL(w.x, w.y);
    let x0 = -o.w / 2, x1 = o.w / 2, y0 = -o.h / 2, y1 = o.h / 2;
    const sg = (v) => Math.round(v / g) * g;
    if (dr.h.hx > 0) x1 = x0 + Math.max(g, sg(lx - x0)); else if (dr.h.hx < 0) x0 = x1 - Math.max(g, sg(x1 - lx));
    if (dr.h.hy > 0) y1 = y0 + Math.max(g, sg(ly - y0)); else if (dr.h.hy < 0) y0 = y1 - Math.max(g, sg(y1 - ly));
    const [cx, cy] = blockXf(o, false).toW((x0 + x1) / 2, (y0 + y1) / 2);
    const nw = x1 - x0, nh = y1 - y0;
    if (b.w === nw && b.h === nh && Math.abs(b.x - cx) < 1e-9 && Math.abs(b.y - cy) < 1e-9) return;
    b.x = cx; b.y = cy; b.w = nw; b.h = nh;
    // fazy do połowy boku zostają do połowy (sześciokąt, romb, grot), skosy 45° trapezu zostają 45°
    if (o.c) { const full0 = Math.min(o.w, o.h) / 2; b.c = o.c.map((c) => (Math.abs(c - full0) < 1e-6 ? Math.min(nw, nh) / 2 : c)); }
    if (b.shape === 'trap') {
      b.a = Math.abs(Math.abs(o.a || 0) - o.h) < 1e-6 ? Math.sign(o.a) * nh : (o.a || 0);
      b.b = Math.abs(Math.abs(o.b || 0) - o.h) < 1e-6 ? Math.sign(o.b) * nh : (o.b || 0);
    } else if (b.shape === 'tri') b.a = (o.a || 0) / o.w * nw;
    api.snapBlock(b);
    api.requestBuild(true);
  }
  function endMarquee(dr) {
    const x0 = Math.min(dr.a.x, dr.b.x), x1 = Math.max(dr.a.x, dr.b.x), y0 = Math.min(dr.a.y, dr.b.y), y1 = Math.max(dr.a.y, dr.b.y);
    const found = [];
    const d = design();
    const lists = [['shape', d.shapes], ['module', d.modules], ['part', d.parts || []], ['castle', d.castles || []], ['decal', d.decals]];
    for (const [kind, list] of lists) {
      for (const obj of list) {
        const r = { kind, obj };
        if (kind === 'decal' && obj.kind === 'contour') continue;
        for (const m of mirrorCopy(r) ? [false, true] : [false]) {
          const [x, y] = centerOf(r, m);
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) { if (!found.some((f) => f.obj === obj) && !isSel(obj)) found.push(r); break; }
        }
      }
    }
    U.sel = [...U.sel, ...found];
    U.dupMemo = null;
    if (found.length) toast(`Zaznaczono: ${U.sel.length}`);
  }

  function onWheel(e) {
    if (S.ui !== 'stocznia') return;
    e.preventDefault();
    const w = api.worldOf(e.clientX, e.clientY);
    // kółko w trakcie stawiania klocka (karta nad okrętem, stempel): rozmiar nowych klocków, jak w Spore
    const placing = U.drag?.mode === 'palette' ? U.drag.item : (U.drag?.mode === 'stamp' ? U.drag.item : (!U.drag && U.armed));
    if (placing?.kind === 'block') { setSize(U.size + (e.deltaY < 0 ? 1 : -1)); return; }
    const p = U.drag ? null : pickAt(w.x, w.y);
    if (p && isSel(p.obj) && editable().length) {
      // kółko nad zaznaczonym: rozmiar (jeden wpis historii na cały obrót kółka)
      if (scaleSel(e.deltaY < 0 ? 1 : -1)) {
        S.drag = { kind: 'stocznia-kolko' };
        api.requestBuild(true);
        clearTimeout(U.wheelT);
        U.wheelT = setTimeout(() => { if (S.drag?.kind === 'stocznia-kolko') S.drag = null; commit(); }, 280);
      }
      return;
    }
    const { W, H } = api.view();
    S.cam.zoom = Math.min(6, Math.max(0.04, S.cam.zoom * Math.exp(-e.deltaY * 0.0012)));
    S.cam.x = w.x - (e.clientX - W * 0.5) / S.cam.zoom;
    S.cam.y = w.y - (e.clientY - H * 0.5) / S.cam.zoom;
  }

  // -------------------------------------------------------------------------
  // Paleta: przeciąganie kart, stempel, rzędy
  function arm(item) {
    U.armed = item && U.armed !== item ? item : null;
    for (const c of el.cards.querySelectorAll('.ycard')) c.classList.toggle('armed', !!U.armed && c.dataset.key === U.armed.key);
    if (U.armed) select([]);
  }
  function clickCard(item) {
    if (item.kind === 'paint' || item.kind === 'style') { applyLook(item); return; }
    arm(item);
    if (U.armed) toast(`Stempel: ${item.label} — klikaj na okręcie albo przeciągnij, by ułożyć rząd (Esc — koniec)`);
  }
  function applyLook(item) {
    const d = design();
    if (item.kind === 'paint') { if (d.palette === item.id) return; d.palette = item.id; }
    else { if (d.style === item.id) return; d.style = item.id; }
    toast(item.kind === 'paint' ? `Barwy: ${item.label}` : `Krawędzie: ${item.label.toLowerCase()}`);
    commit();
    renderCards();
  }
  /** Upuszczenie karty w punkcie świata (`stamp` — stempel: zostaje zaznaczenie bez zmian). Zwraca postawiony element. */
  function dropItem(item, w, stamp = false) {
    if (item.kind === 'paint' || item.kind === 'style') { applyLook(item); return null; }
    const r = makeObject(item, w.x, w.y, true);
    if (!r) return null;
    if (item.onHull && !onHull(r)) { toast(`${item.label}: postaw na kadłubie`, 'warn'); return null; }
    listFor(r.kind).push(r.obj);
    const [x, y] = centerOf(r);
    fxAt(x, y, 'pop');
    if (!stamp) select([r]);
    commit();
    return r;
  }
  /** Rząd kopii od punktu `a` w stronę `b` (oś dominująca), kopie stykają się (moduły — z odstępem). */
  function rowFor(item, a, b) {
    const first = makeObject(item, a.x, a.y, false);
    if (!first) return null;
    const box = boxOf(first);
    const dx = b.x - a.x, dy = b.y - a.y;
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const g = grid();
    const ext = horiz ? box[2] - box[0] : box[3] - box[1];
    const step = Math.max(g, Math.ceil((first.kind === 'shape' ? ext : ext * 1.25) / g - 1e-6) * g);
    const len = Math.abs(horiz ? dx : dy);
    const n = Math.min(39, Math.floor(len / step + 0.35));
    const dir = Math.sign(horiz ? dx : dy) || 1;
    const out = [first];
    for (let k = 1; k <= n; k++) {
      const o = structuredClone(first.obj);
      const r = { kind: first.kind, obj: o };
      translate(r, horiz ? dir * k * step : 0, horiz ? 0 : dir * k * step);
      out.push(r);
    }
    return { item, refs: out };
  }
  function placeRow(row) {
    const ok = row.refs.filter((r) => !row.item.onHull || onHull(r));
    if (!ok.length) { toast(`${row.item.label}: postaw na kadłubie`, 'warn'); return null; }
    for (const r of ok) { listFor(r.kind).push(r.obj); const [x, y] = centerOf(r); fxAt(x, y, 'pop'); }
    if (ok.length < row.refs.length) toast(`Postawiono ${ok.length} z ${row.refs.length} — reszta poza kadłubem`, 'warn');
    commit();
    return ok;
  }

  function startPaletteDrag(e, item, card) {
    if (S.ui !== 'stocznia' || e.button !== 0) return;
    e.preventDefault();
    U.drag = { mode: 'palette', item, card, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, w0: api.worldOf(e.clientX, e.clientY) };
    const cv = card.querySelector('canvas');
    el.ghost.innerHTML = '';
    const img = document.createElement('canvas');
    img.width = cv.width; img.height = cv.height;
    img.getContext('2d').drawImage(cv, 0, 0);
    el.ghost.appendChild(img);
    const lab = document.createElement('span');
    lab.textContent = item.label;
    el.ghost.appendChild(lab);
  }
  function moveGhost(x, y, show) {
    el.ghost.style.display = show ? 'block' : 'none';
    el.ghost.style.transform = `translate(${x - 44}px, ${y - 34}px) rotate(-5deg)`;
  }
  function hideGhost() { el.ghost.style.display = 'none'; }

  // -------------------------------------------------------------------------
  // Klawisze
  function onKey(e) {
    if (S.ui !== 'stocznia') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (!el.dlg.hidden) { if (e.key === 'Escape') { el.dlg.hidden = true; e.preventDefault(); } return; }
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (ctrl && (k === 'z' || k === 'y')) { api.histGo(k === 'y' || e.shiftKey ? 1 : -1); stop(); return; }
    if (ctrl && k === 'd') { duplicateSel(); stop(); return; }
    if (ctrl && k === 'c') { copySel(); stop(); return; }
    if (ctrl && k === 'v') { pasteClip(); stop(); return; }
    if (ctrl && k === 'a') { selectAllBlocks(); stop(); return; }
    if (ctrl) return;
    if (k === 'escape') {
      const dr = U.drag;
      if (dr?.mode === 'palette') { U.drag = null; hideGhost(); }
      else if (dr?.mode === 'move' || dr?.mode === 'resize') {
        // przesuwanie przerwane: element wraca (kopia Shift — znika)
        U.drag = null; S.drag = null;
        if (dr.mode === 'resize') Object.assign(dr.b, dr.orig);
        else if (dr.copy) { for (const r of dr.refs) api.removePicked(r); U.sel = []; }
        else dr.refs.forEach((r, i) => restore(r, dr.orig[i]));
        api.requestBuild(true);
      } else if (U.armed) arm(null);
      else select([]);
      stop(); return;
    }
    if (k === 'delete' || k === 'backspace') { deleteSel(); stop(); return; }
    if (k === 'r') { rotateSel(e.shiftKey ? 1 : 2); stop(); return; }
    if (k === 'f') { flipSel(); stop(); return; }
    if (k === 'x') { cutSel(); stop(); return; }
    if (k === 'l') { toggleMirror(); stop(); return; }
    if (k === 'o') { U.outlines = !U.outlines; syncTop(); stop(); return; }
    if (k === 'h') { document.body.classList.toggle('clean'); stop(); return; }
    if (k === 'home' || k === '0') { api.fit(); stop(); return; }
    if (k >= '1' && k <= '4') { setLevelSel(Number(k) - 1); stop(); return; }
    if (k === '+' || k === '=' || k === '-') { if (scaleSel(k === '-' ? -1 : 1)) commit(); stop(); return; }
    const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
    if (arrows[k] && editable().length) { const s = (e.shiftKey ? 4 : 1) * grid(); nudgeSel(arrows[k][0] * s, arrows[k][1] * s); stop(); }
  }
  function selectAllBlocks() {
    U.sel = design().shapes.filter((s) => s.kind === 'block').map((obj) => ({ kind: 'shape', obj }));
    U.dupMemo = null;
    toast(`Zaznaczono klocki: ${U.sel.length}`);
  }
  function toggleMirror() {
    design().mirror = !design().mirror;
    toast(design().mirror ? 'Symetria włączona — kopia po drugiej burcie' : 'Symetria wyłączona — każda burta osobno');
    commit();
    syncTop();
  }

  // -------------------------------------------------------------------------
  // Rysunek nakładki: podświetlenie, zaznaczenie, uchwyty, duch karty, rząd stempla, ramka, efekty
  function draw(cam) {
    syncDesign();
    const ctx = api.ctx;
    const { W, H } = api.view();
    const z = cam.zoom;
    const toS = (x, y) => [(x - cam.x) * z + W * 0.5, (y - cam.y) * z + H * 0.5];
    const now = performance.now();
    const pathOf = (loops, open) => {
      ctx.beginPath();
      for (const l of loops) {
        l.forEach(([x, y], i) => { const [sx, sy] = toS(x, y); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
        if (!open) ctx.closePath();
      }
    };
    ctx.save();
    ctx.lineJoin = 'round';
    const dr = U.drag;
    // kontury wszystkich elementów (na życzenie) — cienko, bez kolorów poziomów
    if (U.outlines) {
      ctx.strokeStyle = 'rgba(235, 240, 245, 0.28)';
      ctx.lineWidth = 1;
      for (const r of allRefs()) for (const s of shapesOf(r)) { pathOf(s.loops, s.open); ctx.stroke(); }
    }
    // oś lustra — tylko w trakcie stawiania i przesuwania
    if (design()?.mirror && dr && (dr.mode === 'palette' || dr.mode === 'move' || dr.mode === 'stamp' || U.armed)) {
      const [, sy] = toS(0, 0);
      ctx.strokeStyle = 'rgba(255, 200, 120, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
      ctx.setLineDash([]);
    }
    // element pod kursorem
    if (U.hover && !isSel(U.hover.obj) && (!dr || dr.mode === 'pan') && !U.armed) {
      const lk = locked(U.hover);
      for (const s of shapesOf(U.hover)) {
        pathOf(s.loops, s.open);
        ctx.strokeStyle = lk ? 'rgba(255, 210, 150, 0.7)' : `rgba(255, 255, 255, ${s.mirror ? 0.35 : 0.8})`;
        ctx.lineWidth = 1.6;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.7)';
        ctx.shadowBlur = s.mirror ? 0 : 8;
        ctx.setLineDash(s.mirror ? [4, 4] : []);
        ctx.stroke();
      }
      ctx.shadowBlur = 0; ctx.setLineDash([]);
    }
    // zaznaczenie (nad paletą w trakcie przesuwania — czerwone: upuszczenie usuwa)
    const trash = dr?.mode === 'move' && dr.trash;
    for (const r of U.sel) {
      for (const s of shapesOf(r)) {
        pathOf(s.loops, s.open);
        if (!s.mirror && !s.open) { ctx.fillStyle = trash ? 'rgba(255, 90, 80, 0.16)' : 'rgba(255, 181, 74, 0.10)'; ctx.fill('evenodd'); }
        ctx.strokeStyle = trash ? BAD : (locked(r) ? 'rgba(255, 210, 150, 0.8)' : ACCENT);
        ctx.globalAlpha = s.mirror ? 0.55 : 1;
        ctx.lineWidth = s.mirror ? 1.2 : 2;
        ctx.shadowColor = trash ? BAD : ACCENT;
        ctx.shadowBlur = s.mirror ? 0 : 10;
        ctx.setLineDash(s.mirror ? [5, 4] : []);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.shadowBlur = 0; ctx.setLineDash([]);
    // uchwyty rozmiaru (jeden klocek, dość duży na ekranie)
    const hb = handleBlock();
    if (hb && (!dr || dr.mode === 'resize' || dr.mode === 'pan')) {
      for (const h of handles(hb.obj, false)) {
        const [sx, sy] = toS(h.x, h.y);
        ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff7ea'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#3a2a12'; ctx.stroke();
      }
    }
    // duch: karta nad okrętem, stempel pod kursorem, rząd stempla
    const ghosts = ghostRefs();
    if (ghosts) {
      const dash = (now / 40) % 20;
      for (const r of ghosts.refs) {
        const bad = ghosts.item.onHull && !onHull(r);
        for (const s of shapesOf(r)) {
          pathOf(s.loops, s.open);
          ctx.fillStyle = bad ? 'rgba(255, 90, 80, 0.14)' : (U.cut && r.kind === 'shape' ? 'rgba(255, 120, 100, 0.14)' : 'rgba(255, 240, 215, 0.16)');
          if (!s.open) ctx.fill('evenodd');
          ctx.strokeStyle = bad ? BAD : (U.cut && r.kind === 'shape' ? '#ff8a7a' : 'rgba(255, 244, 225, 0.95)');
          ctx.globalAlpha = s.mirror ? 0.5 : 1;
          ctx.lineWidth = 1.6;
          ctx.setLineDash([7, 5]);
          ctx.lineDashOffset = -dash;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      const m = U.mouse;
      const first = ghosts.refs[0];
      const bad = ghosts.item.onHull && !onHull(first);
      const label = `${ghosts.item.label}${ghosts.refs.length > 1 ? ` — rząd ${ghosts.refs.length}` : ''}${first.kind === 'shape' ? ` · ${LEVELS[U.level].label.toLowerCase()} · ×${U.size}${U.cut ? ' · wycięcie' : ''}` : ''}${bad ? ' — poza kadłubem' : ''}`;
      tag(ctx, label, m.x + 16, m.y + 22, bad);
    }
    // ramka zaznaczania
    if (dr?.mode === 'marquee') {
      const [ax, ay] = toS(dr.a.x, dr.a.y), [bx, by] = toS(dr.b.x, dr.b.y);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(Math.min(ax, bx) + 0.5, Math.min(ay, by) + 0.5, Math.abs(bx - ax), Math.abs(by - ay));
      ctx.setLineDash([]);
    }
    // efekty: postawienie (pierścień) i usunięcie (obłoczek)
    U.fx = U.fx.filter((f) => now - f.t0 < 450);
    for (const f of U.fx) {
      const k = (now - f.t0) / 450;
      const [sx, sy] = toS(f.x, f.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 6 + k * (f.kind === 'pop' ? 34 : 22), 0, Math.PI * 2);
      ctx.strokeStyle = f.kind === 'pop' ? `rgba(255, 220, 160, ${1 - k})` : `rgba(255, 120, 100, ${1 - k})`;
      ctx.lineWidth = 2.5 * (1 - k) + 0.5;
      ctx.stroke();
    }
    ctx.restore();
    syncDom();
  }
  /** Podpis przy kursorze (duch karty). */
  function tag(ctx, text, x, y, bad) {
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = bad ? 'rgba(70, 14, 12, 0.88)' : 'rgba(10, 18, 26, 0.88)';
    ctx.strokeStyle = bad ? 'rgba(255, 106, 94, 0.7)' : 'rgba(255, 210, 150, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y - 15, w, 22, 11);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = bad ? '#ffd2cc' : '#f5ecdc';
    ctx.fillText(text, x + 8, y);
  }
  function ghostRefs() {
    const dr = U.drag, m = U.mouse;
    if (dr?.mode === 'palette' && dr.moved && m.over && placeable(dr.item)) {
      const r = makeObject(dr.item, m.wx, m.wy, false);
      return r ? { item: dr.item, refs: [r] } : null;
    }
    if (dr?.mode === 'stamp') {
      if (dr.row) return dr.row;
      const r = makeObject(dr.item, dr.w0.x, dr.w0.y, false);
      return r ? { item: dr.item, refs: [r] } : null;
    }
    if (U.armed && !dr && m.over) {
      const r = makeObject(U.armed, m.wx, m.wy, false);
      return r ? { item: U.armed, refs: [r] } : null;
    }
    return null;
  }
  const placeable = (item) => item.kind !== 'paint' && item.kind !== 'style';
  function allRefs() {
    const d = design();
    if (!d) return [];
    const out = [];
    for (const obj of d.shapes) out.push({ kind: 'shape', obj });
    for (const obj of d.modules) out.push({ kind: 'module', obj });
    for (const obj of d.parts || []) out.push({ kind: 'part', obj });
    for (const obj of d.castles || []) out.push({ kind: 'castle', obj });
    for (const obj of d.decals) if (obj.kind !== 'contour') out.push({ kind: 'decal', obj });
    return out;
  }

  /**
   * Nowy obiekt projektu (cofnięcie, preset, straż limitów) — zaznaczenie i przeciąganie z poprzedniego znikają; w tym
   * samym projekcie znikają z zaznaczenia i podświetlenia elementy usunięte.
   */
  function syncDesign() {
    const d = design();
    if (d !== U.designRef) {
      U.designRef = d;
      U.sel = []; U.hover = null; U.dupMemo = null;
      if (U.drag && U.drag.mode !== 'palette' && U.drag.mode !== 'pan') { U.drag = null; if (S.drag?.kind?.startsWith('stocznia')) S.drag = null; }
      syncTop();
      return;
    }
    if (!d) return;
    const alive = (r) => listFor(r.kind).includes(r.obj);
    if (U.hover && !alive(U.hover)) U.hover = null;
    if (U.sel.length && !U.sel.every(alive)) U.sel = U.sel.filter(alive);
  }

  // -------------------------------------------------------------------------
  // DOM: pasek zaznaczenia, podpowiedź, pasek pomocy, karta okrętu, komunikaty limitów
  function syncDom() {
    // komunikat z limitów mostka / blokady (classFlash w demie) → dymek
    if (S.flash && S.flash.t !== U.flashT) { U.flashT = S.flash.t; if (S.flash.text) toast(S.flash.text, 'warn'); }
    el.root.classList.toggle('trash', U.drag?.mode === 'move' && !!U.drag.trash);
    placeSelBar();
    placeTip();
    canvas.style.cursor = cursorFor();
    // poniżej — tylko przy zmianie (porównanie napisów / klucza karty)
    syncHelp();
    syncTop();
    syncCard();
    // barwy albo krawędzie projektu inne niż na kartach — karty od nowa, miniatury w nowym wyglądzie
    if (lookKey() !== U.look) { U.look = lookKey(); renderCards(); scheduleThumbs(); }
  }
  function cursorFor() {
    const dr = U.drag;
    if (dr?.mode === 'pan' && dr.moved) return 'grabbing';
    if (dr?.mode === 'move') return dr.trash ? 'no-drop' : 'grabbing';
    if (dr?.mode === 'palette' || U.armed || dr?.mode === 'stamp') return 'copy';
    if (dr?.mode === 'resize') return 'nwse-resize';
    if (U.hover) return locked(U.hover) ? 'not-allowed' : 'grab';
    return 'default';
  }
  function placeSelBar() {
    const bar = el.sel;
    const dr = U.drag;
    const show = U.sel.length && (!dr || dr.mode === 'pan') && !U.armed;
    if (!show) { bar.style.display = 'none'; return; }
    const blocks = U.sel.some(isBlock), anyEdit = editable().length > 0;
    for (const b of bar.querySelectorAll('button')) {
      const need = b.dataset.need;
      b.style.display = (need === 'block' && !blocks) || !anyEdit ? 'none' : '';
    }
    bar.querySelector('.ylock').style.display = anyEdit ? 'none' : '';
    bar.querySelector('.ycount').textContent = U.sel.length > 1 ? `${U.sel.length} el.` : refName(U.sel[0]);
    bar.style.display = 'flex';
    // nad zaznaczeniem (pod, gdy brak miejsca), w kadrze między panelami
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of U.sel) for (const l of loopsOf(r, false).loops) for (const [x, y] of l) {
      const [sx, sy] = toScreen(x, y);
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const ins = insets(), { W, H } = api.view();
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let left = (x0 + x1) / 2 - bw / 2, top = y0 - bh - 16;
    if (top < ins.top + 6) top = y1 + 16;
    left = Math.max(ins.left + 6, Math.min(W - ins.right - bw - 6, left));
    top = Math.max(ins.top + 6, Math.min(H - ins.bottom - bh - 6, top));
    bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  function placeTip() {
    const m = U.mouse, tip = el.tip;
    const r = U.hover;
    if (!r || U.drag || U.armed || !m.over) { tip.style.display = 'none'; return; }
    const text = locked(r) ? `🔒 ${refName(r)} — stałe miejsce` : `${refName(r)}${isSel(r.obj) ? ' · kółko — rozmiar' : ' · przeciągnij — przesuń, Shift — kopia'}`;
    if (tip.textContent !== text) tip.textContent = text;
    tip.style.display = 'block';
    tip.style.transform = `translate(${m.x + 16}px, ${m.y + 18}px)`;
  }
  function syncHelp() {
    const dr = U.drag;
    let h;
    if (dr?.mode === 'palette' && dr.moved) h = `Upuść na okręcie${design()?.mirror ? ' — kopia stanie po drugiej burcie' : ''} · z powrotem nad paletę — anuluj`;
    else if (dr?.mode === 'move') h = dr.trash ? 'Puść, by usunąć' : 'Upuść na paletę, by usunąć · Shift przy chwytaniu — kopia';
    else if (U.armed || dr?.mode === 'stamp') h = `Stempel „${(U.armed || dr.item).label}”: <kbd>klik</kbd> — kopia · <kbd>przeciągnij</kbd> — rząd kopii · <kbd>Esc</kbd> / <kbd>PPM</kbd> — koniec`;
    else if (U.sel.length) h = '<kbd>R</kbd> obrót 90° (<kbd>⇧R</kbd> 45°) · <kbd>F</kbd> odbij · <kbd>Ctrl+D</kbd> powiel · <kbd>kółko</kbd> rozmiar · <kbd>1–4</kbd> warstwa · <kbd>Del</kbd> usuń · <kbd>Ctrl+C/V</kbd> schowek';
    else h = 'Przeciągnij kartę na okręt · <kbd>klik</kbd> w kartę — stempel · <kbd>Shift</kbd>+przeciągnij — kopia · <kbd>Ctrl</kbd>+ramka · <kbd>kółko</kbd> przybliż · tło — przesuń';
    if (h !== U.help) { U.help = h; el.help.innerHTML = h; }
  }

  function refName(r) {
    if (!r) return '';
    const o = r.obj;
    if (isBlock(r)) return cap(api.blockLabel(o));
    if (r.kind === 'module') {
      if (hullDesignMountOf(o) && o.type === 'mount') return `Gniazdo ${api.classModuleLabel(o, false)}`;
      const it = items.find((i) => i.kind === 'module' && i.type === o.type);
      return it ? it.label : (HD_MODULES[o.type]?.label || o.type);
    }
    if (r.kind === 'part') return HD_PARTS[o.id]?.label || 'Część';
    if (r.kind === 'castle') return 'Kasztel';
    if (r.kind === 'decal') return o.kind === 'text' ? `Napis „${o.text}”` : (o.kind === 'stripe' ? 'Pas' : `Emblemat: ${HD_EMBLEMS[o.id]?.label || o.id}`);
    if (r.kind === 'groove') return 'Rowek (linia płyt)';
    if (r.kind === 'pipe') return 'Rura (wiązka)';
    return o.kind === 'poly' ? 'Wielokąt' : 'Bryła';
  }

  /** Karta okrętu: klasa, rozmiar, gniazda, moc, wartość, lista kontrolna, zaznaczone gniazdo. */
  function syncCard() {
    const c = S.cls, d = design();
    if (!c || !d || !S.field) return;
    if (document.activeElement?.classList?.contains('yname')) return;   // nie przerywać pisania nazwy
    const mountSel = U.sel.length === 1 && U.sel[0].kind === 'module' && hullDesignMountOf(U.sel[0].obj) ? U.sel[0].obj : null;
    const key = `${S.builtRev}|${S.checksRev || 0}|${d.name}|${mountSel ? JSON.stringify(mountSel) : ''}|${U.sel.length}`;
    if (key === U.statsKey) return;
    U.statsKey = key;
    const cls = c.check.cls, p = c.power, r = S.recipe;
    const meter = (label, v, max, unit, fmt = fmtInt) => {
      const k = max > 0 ? v / max : 0;
      const tone = k > 1 ? 'bad' : (k > 0.9 ? 'warn' : '');
      return `<div class="ymeter"><div class="ymh"><span>${label}</span><b>${fmt(v)} <i>/ ${fmt(max)} ${unit}</i></b></div><div class="ybar"><i class="${tone}" style="width:${Math.min(100, k * 100).toFixed(1)}%"></i></div></div>`;
    };
    const sys = S.systems;
    // spójność ramy liczy worker budowy po obrazie (field.integrity); do tego czasu — ostatnia znana
    let it = S.field.integrity || U.integrity.get(S.field) || U.lastIntegrity;
    if (!it) U.integrity.set(S.field, it = hullFrameIntegrity(S.field));
    U.lastIntegrity = it;
    const nc = S.netCheck;
    const check = (ok, text, hint = '') => `<li class="${ok ? 'ok' : 'no'}"><span>${ok ? '✓' : '✗'}</span>${text}${!ok && hint ? `<small>${hint}</small>` : ''}</li>`;
    const bridges = S.field.expanded.modules.filter((m) => m.type === 'bridge').length;
    const powerOk = !(c.deadMounts || p.deficit > 0) && !p.upkeepOver;
    const netOk = !nc || (!nc.freeEnds && !nc.unpowered.length && !nc.unfueled.length);
    const brOpts = [`<option value="0">${c.levels.auto ? '✓ ' : ''}z rozmiaru (auto)</option>`]
      .concat(SHIP_CLASSES.map((q) => `<option value="${q.level}">${q.roman} · ${q.label}</option>`)).join('');
    const brMax = c.levels.bridge;
    const coreOpts = CORE_LEVELS.map((q) => `<option value="${q.level}" ${q.level > coreLevelMax(brMax) ? 'disabled' : ''}>R${q.level} · ${fmtInt(q.mw)} MW</option>`).join('');
    el.card.innerHTML = `
      <input class="yname" value="${esc(d.name || '')}" maxlength="40" spellcheck="false" title="Nazwa okrętu">
      <div class="yclass"><div class="yroman">${cls.roman}</div><div><b>${cls.label}</b><small>${c.levels.auto ? 'klasa z rozmiaru kadłuba' : 'klasa z mostka'}${cls.example ? ` · wzór: ${cls.example}` : ''}</small></div></div>
      <div class="yrow2"><label>Mostek<select data-k="bridge">${brOpts}</select></label><label>Rdzeń<select data-k="core">${coreOpts}</select></label></div>
      ${meter('Rozmiar kadłuba', c.area, cls.areaMax, 'j²')}
      ${meter('Gniazda broni', c.check.counts.mounts, cls.mountsMax, '', (v) => String(Math.round(v)))}
      ${meter('Pobór mocy', p.upkeep + p.demand, p.capacity, 'MW', fmtMW)}
      <div class="ystat"><span>Napęd</span><b class="${p.drive < 0.85 ? 'warn' : ''}">×${p.drive.toFixed(2)}</b><span>Wartość</span><b>${r ? fmtInt(r.value) : '—'} CR</b><span>Masa</span><b>${r ? fmtInt(r.massT) : '—'} t</b></div>
      <ul class="ycheck">
        ${check(sys?.cores.length > 0, 'Reaktor', 'przeciągnij z kart Systemy')}
        ${check(bridges > 0, 'Mostek', 'karta Systemy → Mostek')}
        ${check(sys?.mains.length > 0, 'Silnik główny', 'na rufie, karta Systemy')}
        ${check(sys?.tanks.length > 0, 'Zbiornik paliwa', 'karta Systemy')}
        ${check(it.pieces.length === 1 && !it.holes.length, 'Kadłub w jednym kawałku', it.pieces.length > 1 ? `${it.pieces.length} kawałki — połącz klockami` : `${it.holes.length} szpar na wylot`)}
        ${check(powerOk, 'Wszystko zasilone', p.upkeepOver ? 'kadłub ponad moc rdzenia' : `niedobór ${fmtMW(p.deficit)} MW — większy rdzeń`)}
        ${check(netOk, 'Kable i rury podłączone', nc ? `wolne końce: ${nc.freeEnds}` : '')}
      </ul>
      ${c.check.issues.map((i) => `<div class="ywarn">⚠ ${esc(i.text)}</div>`).join('')}
      ${mountSel ? mountEditor(mountSel) : ''}`;
    el.card.querySelector('[data-k="bridge"]').value = String(d.bridgeLevel || 0);
    el.card.querySelector('[data-k="core"]').value = String(c.levels.core);
  }
  function mountEditor(o) {
    const g = hullDesignMountOf(o);
    const cls = shipClass(S.cls?.levels.bridge || 1);
    const sizes = MOUNT_SIZES.map((s) => `<option value="${s}" ${sizeRank(s) > sizeRank(cls.weaponSize) ? 'disabled' : ''} ${s === g.size ? 'selected' : ''}>${s}</option>`).join('');
    const ws = weaponsForMount(g.slot, g.size, { npc: true });
    const cur = g.weapon === undefined ? '__typ' : g.weapon;
    const opt = (v, text) => `<option value="${v}"${v === cur ? ' selected' : ''}>${text}</option>`;
    const weapons = [opt('__typ', `typowa (${fmtMW(mountPowerMW(g.slot, g.size, undefined))} MW)`), opt('', 'brak — gniazdo puste')]
      .concat(ws.map((id) => opt(id, `${esc(MASTER_WEAPONS[id].name)} · ${fmtMW(weaponPowerMW(id))} MW${MASTER_WEAPONS[id].npcOnly ? ' (NPC)' : ''}`))).join('');
    return `<div class="ymount"><b>Gniazdo ${MOUNT_SLOT_LABELS[g.slot]} ${g.size}</b><small>pobór ${fmtMW(mountPowerMW(g.slot, g.size, g.weapon))} MW</small>
      <div class="yrow2"><label>Rozmiar<select data-k="msize">${sizes}</select></label><label>Broń<select data-k="weapon">${weapons}</select></label></div></div>`;
  }
  function bindCard() {
    el.card.addEventListener('change', (e) => {
      const k = e.target.dataset.k;
      const d = design();
      if (e.target.classList.contains('yname')) { d.name = e.target.value.trim() || d.name; U.statsKey = ''; return; }
      if (k === 'bridge') { api.setBridgeLevel(Number(e.target.value)); U.statsKey = ''; return; }
      if (k === 'core') { api.setCoreLevel(Number(e.target.value)); U.statsKey = ''; return; }
      const o = U.sel[0]?.obj;
      if (!o) return;
      if (k === 'msize') {
        const w = MASTER_WEAPONS[o.weapon];
        if (w && sizeRank(w.size) > sizeRank(e.target.value)) { toast(`Broń ${w.name} (${w.size}) za duża na gniazdo ${e.target.value} — najpierw zmień broń`, 'warn'); U.statsKey = ''; return; }
        o.size = e.target.value;
        commit();
      } else if (k === 'weapon') {
        if (e.target.value === '__typ') delete o.weapon; else o.weapon = e.target.value;
        commit();
      }
      U.statsKey = '';
    });
  }

  // -------------------------------------------------------------------------
  // Paleta: zakładki, opcje kategorii, karty
  function renderTabs() {
    el.tabs.innerHTML = CATS.map((c) => `<button class="ytab${c.id === U.cat ? ' on' : ''}" data-cat="${c.id}" role="tab" aria-selected="${c.id === U.cat}"><svg viewBox="0 0 22 22" aria-hidden="true">${c.icon}</svg><span>${c.label}</span></button>`).join('');
  }
  function setCat(id) {
    U.cat = id;
    renderTabs();
    renderOpts();
    renderCards();
    scheduleThumbs();
  }
  function renderOpts() {
    let h = '';
    if (U.cat === 'ksztalty') {
      h = `<div class="yoptl">Warstwa nowych klocków</div><div class="ychips">${LEVELS.map((L, i) => `<button class="ychip${U.level === i ? ' on' : ''}" data-level="${i}" title="${L.hint} (${i + 1})"><i style="background:${L.swatch}"></i>${L.label}</button>`).join('')}
        <button class="ychip cut${U.cut ? ' on' : ''}" data-cut="1" title="Klocek wycina kadłub pod sobą (X)">✂ Wycięcie</button></div>
        <div class="yoptl">Rozmiar nowych klocków <span class="ydim">· kółko w trakcie stawiania</span></div><div class="ychips">${[1, 2, 3, 4].map((n) => `<button class="ychip${U.size === n ? ' on' : ''}" data-size="${n}">×${n}</button>`).join('')}</div>`;
    } else if (U.cat === 'bron') {
      const cls = shipClass(S.cls?.levels.bridge || 1);
      h = `<div class="yoptl">Rozmiar nowych gniazd (mostek ${cls.roman}: do ${cls.weaponSize})</div><div class="ychips"><button class="ychip${!U.mountSize ? ' on' : ''}" data-msize="">jak klasa</button>${MOUNT_SIZES.map((s) => `<button class="ychip${U.mountSize === s ? ' on' : ''}" data-msize="${s}" ${sizeRank(s) > sizeRank(cls.weaponSize) ? 'disabled' : ''}>${s}</button>`).join('')}</div>`;
    } else if (U.cat === 'farba') {
      const d = design();
      h = `<div class="yoptl">Kolor naklejek</div><div class="ychips">${DECAL_COLORS.map((c) => `<button class="yswatch${S.color === c ? ' on' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}<input type="color" class="ycolor" value="${S.color}" title="własny kolor"></div>
        <div class="yoptl">Napis</div><input class="ytext" value="${esc(U.text)}" maxlength="16" spellcheck="false">
        <div class="yoptl">Wykończenie</div>
        <label class="yslider"><span>Detal płyt</span><input type="range" data-k="detail" min="${HD_DETAIL.min}" max="${HD_DETAIL.max}" step="0.005" value="${d?.detail ?? 0.6}"></label>
        <label class="yslider"><span>Rury i kable</span><input type="range" data-k="pipes" min="0" max="2" step="0.05" value="${d?.pipeNet?.density ?? 0}"></label>
        <div class="ychips"><button class="ychip${(d?.windows ?? 1) > 0.5 ? ' on' : ''}" data-k="windows">Okna tarasów</button><button class="ychip${(d?.round ?? 0) > 0.5 ? ' on' : ''}" data-k="round">Łuk na fazach płyt</button></div>`;
    } else if (U.cat === 'systemy') h = '<div class="yoptl">Systemy presetów (🔒) stoją na stałych miejscach klasy; w projekcie od zera stawiasz je sam.</div>';
    else h = '<div class="yoptl">Detale stawia się na pancerzu; gotowe części dokładają kawałek okrętu.</div>';
    el.opts.innerHTML = h;
  }
  function bindOpts() {
    el.opts.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.level !== undefined) setLevelSel(Number(b.dataset.level));
      else if (b.dataset.size) setSize(Number(b.dataset.size));
      else if (b.dataset.cut) cutSel();
      else if (b.dataset.msize !== undefined) U.mountSize = b.dataset.msize || null;
      else if (b.dataset.color) setColor(b.dataset.color);
      else if (b.dataset.k === 'windows') { design().windows = (design().windows ?? 1) > 0.5 ? 0 : 1; commit(); }
      else if (b.dataset.k === 'round') { design().round = (design().round ?? 0) > 0.5 ? 0 : 1; commit(); }
      renderOpts();
    });
    el.opts.addEventListener('input', (e) => {
      const t = e.target;
      if (t.classList.contains('ycolor')) { setColor(t.value, false); return; }
      if (t.classList.contains('ytext')) { U.text = t.value; return; }
      if (t.dataset.k === 'detail') { design().detail = Number(t.value); S.drag = { kind: 'stocznia-suwak' }; api.requestBuild(true); }
      if (t.dataset.k === 'pipes') { design().pipeNet = { ...(design().pipeNet || {}), density: Number(t.value) }; S.drag = { kind: 'stocznia-suwak' }; api.requestBuild(true); }
    });
    el.opts.addEventListener('change', (e) => {
      if (e.target.dataset.k === 'detail' || e.target.dataset.k === 'pipes') { S.drag = null; commit(); }
    });
  }
  function setColor(c, rerender = true) {
    S.color = c;
    // zaznaczone naklejki dostają kolor od razu
    const decals = editable().filter((r) => r.kind === 'decal');
    for (const r of decals) r.obj.color = c;
    if (decals.length) commit();
    if (rerender) renderOpts();
    for (const it of items) if (it.kind === 'decal') paintCard(it);
  }

  /** Kolejność kart kształtów w grupach (wpisy palety spoza listy — na końcu swojej grupy). */
  const BLOCK_ORDER = ['square', 'rect', 'beam', 'rect_ch', 'rect_cut', 'bow', 'hex', 'oct', 'diamond', 'tri', 'wedge', 'spike', 'trap_r', 'trap_i', 'para', 'circle', 'oval', 'half', 'quarter', 'ring', 'arch', 'qring'];
  function renderCards() {
    const rank = (it) => (it.kind === 'block' ? (BLOCK_ORDER.indexOf(it.id) + 1 || 99) : 0);
    const list = items.filter((i) => i.cat === U.cat);
    // grupy w kolejności pierwszego wystąpienia, karty grupy razem
    const groups = new Map();
    for (const it of list) { if (!groups.has(it.group)) groups.set(it.group, []); groups.get(it.group).push(it); }
    let h = '';
    for (const [group, its] of groups) {
      its.sort((a, b) => rank(a) - rank(b));
      h += `<div class="ygroup">${esc(group)}</div><div class="ygrid">`;
      for (const it of its) {
        const active = (it.kind === 'paint' && design()?.palette === it.id) || (it.kind === 'style' && design()?.style === it.id);
        h += `<div class="ycard${U.armed === it ? ' armed' : ''}${active ? ' active' : ''}" data-key="${it.key}" title="${esc(it.label)} — ${esc(it.hint || '')}"><canvas width="${TH.w * TH.dpr}" height="${TH.h * TH.dpr}"></canvas><span>${esc(it.label)}</span></div>`;
      }
      h += '</div>';
    }
    el.cards.innerHTML = h;
    for (const it of list) paintCard(it);
  }
  function bindCards() {
    el.cards.addEventListener('pointerdown', (e) => {
      const card = e.target.closest('.ycard');
      if (!card) return;
      startPaletteDrag(e, byKey.get(card.dataset.key), card);
    });
    el.tabs.addEventListener('click', (e) => { const b = e.target.closest('.ytab'); if (b) setCat(b.dataset.cat); });
  }

  // -------------------------------------------------------------------------
  // Miniatury kart: rysunek wektorowy od razu, wypiek kompozytora w tle (barwy i styl projektu)
  const TH = { w: 84, h: 56, dpr: Math.min(2, Math.max(1, Math.ceil((window.devicePixelRatio || 1) * 2) / 2)) };
  const thumbs = { cache: new Map(), queue: [], running: false, waiters: [] };
  const lookKey = () => { const d = design(); return d ? `${d.palette}|${d.style}` : ''; };
  const bakeable = (it) => it.kind === 'block' || it.kind === 'module' || it.kind === 'castle' || it.kind === 'part';
  function cardCanvas(it) { return el.cards.querySelector(`.ycard[data-key="${CSS.escape(it.key)}"] canvas`); }
  function paintCard(it) {
    const cv = cardCanvas(it);
    if (!cv) return;
    const baked = thumbs.cache.get(`${lookKey()}|${it.key}`);
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    if (baked) drawFit(g, baked, cv.width, cv.height, it.kind === 'part' ? 0.94 : 0.84);
    else drawVector(g, it, cv.width, cv.height);
  }
  function drawFit(g, img, W, H, fill) {
    const k = Math.min(W * fill / img.width, H * fill / img.height);
    const w = img.width * k, h = img.height * k;
    g.save();
    g.shadowColor = 'rgba(0, 0, 0, 0.6)';
    g.shadowBlur = 6 * TH.dpr;
    g.shadowOffsetY = 2 * TH.dpr;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    g.restore();
  }
  /** Rysunek zastępczy karty (zanim kompozytor upiecze miniaturę) i karty bez wypieku (barwy, krawędzie, naklejki). */
  function drawVector(g, it, W, H) {
    const pal = HD_PALETTES[design()?.palette] || HD_PALETTES.terra;
    const plate = (loops, fill = pal.upper, edge = pal.trim) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const l of loops) for (const [x, y] of l) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const k = Math.min(W * 0.78 / (x1 - x0), H * 0.74 / (y1 - y0));
      const ox = W / 2 - (x0 + x1) / 2 * k, oy = H / 2 - (y0 + y1) / 2 * k;
      g.beginPath();
      for (const l of loops) { l.forEach(([x, y], i) => (i ? g.lineTo(x * k + ox, y * k + oy) : g.moveTo(x * k + ox, y * k + oy))); g.closePath(); }
      const gr = g.createLinearGradient(0, oy + y0 * k, 0, oy + y1 * k);
      gr.addColorStop(0, fill); gr.addColorStop(1, pal.hull);
      g.save();
      g.shadowColor = 'rgba(0, 0, 0, 0.55)'; g.shadowBlur = 5 * TH.dpr; g.shadowOffsetY = 2 * TH.dpr;
      g.fillStyle = gr; g.fill('evenodd');
      g.restore();
      g.lineWidth = 1.2 * TH.dpr; g.strokeStyle = edge; g.stroke();
    };
    if (it.kind === 'block') { plate(blockLocalLoops(hullBlockFromPalette(it.id, 1))); return; }
    if (it.kind === 'paint') { shipIcon(g, HD_PALETTES[it.id], W, H); return; }
    if (it.kind === 'style') {
      const r = 0.22;
      const sq = it.id === 'sharp' ? [[-1, -0.6], [1, -0.6], [1, 0.6], [-1, 0.6]]
        : (it.id === 'chamfer' ? [[-1 + r, -0.6], [1 - r, -0.6], [1, -0.6 + r], [1, 0.6 - r], [1 - r, 0.6], [-1 + r, 0.6], [-1, 0.6 - r], [-1, -0.6 + r]]
          : roundRect(r));
      plate([sq]);
      return;
    }
    if (it.kind === 'decal') {
      plate([[[-1, -0.66], [1, -0.66], [1, 0.66], [-1, 0.66]]], pal.hull, pal.trim);
      g.fillStyle = S.color;
      if (it.decal === 'emblem') {
        const s = Math.min(W, H) * 0.5 / 100, ox = W / 2 - 50 * s, oy = H / 2 - 50 * s;
        g.beginPath();
        for (const path of HD_EMBLEMS[it.id].paths) { path.forEach(([x, y], i) => (i ? g.lineTo(x * s + ox, y * s + oy) : g.moveTo(x * s + ox, y * s + oy))); g.closePath(); }
        g.fill('evenodd');
      } else if (it.decal === 'text') {
        g.font = `700 ${Math.round(13 * TH.dpr)}px "Segoe UI", system-ui, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText((U.text || 'HF').slice(0, 8), W / 2, H / 2);
      } else {
        g.save(); g.translate(W / 2, H / 2); g.rotate(-0.35);
        g.fillRect(-W * 0.42, -H * 0.08, W * 0.84, H * 0.16);
        g.restore();
      }
      return;
    }
    // moduły i części: tarcza albo pudło z ikoną (do czasu wypieku)
    plate([[[-1, -0.66], [1, -0.66], [1, 0.66], [-1, 0.66]]], pal.hull, pal.trim);
    const def = it.kind === 'module' ? HD_MODULES[it.type] : null;
    g.fillStyle = pal.metal; g.strokeStyle = pal.accent; g.lineWidth = 1.2 * TH.dpr;
    g.beginPath();
    if (def?.r) g.arc(W / 2, H / 2, H * 0.28, 0, Math.PI * 2);
    else g.roundRect(W * 0.3, H * 0.3, W * 0.4, H * 0.4, 4 * TH.dpr);
    g.fill(); g.stroke();
  }
  function roundRect(r) {
    const out = [], n = 6;
    const corner = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * Math.PI / 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
    corner(1 - r, -0.6 + r, -Math.PI / 2); corner(1 - r, 0.6 - r, 0); corner(-1 + r, 0.6 - r, Math.PI / 2); corner(-1 + r, -0.6 + r, Math.PI);
    return out;
  }
  /** Mała sylwetka okrętu w barwach palety (karta „Barwy kadłuba”). */
  function shipIcon(g, pal, W, H) {
    const P = [[-0.95, -0.34], [0.35, -0.34], [0.95, 0], [0.35, 0.34], [-0.95, 0.34], [-0.82, 0]];
    const k = Math.min(W * 0.44, H * 1.1), ox = W / 2, oy = H / 2;
    const path = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * k + ox, y * k + oy) : g.moveTo(x * k + ox, y * k + oy))); g.closePath(); };
    g.save();
    g.shadowColor = 'rgba(0, 0, 0, 0.55)'; g.shadowBlur = 5 * TH.dpr; g.shadowOffsetY = 2 * TH.dpr;
    path(P); g.fillStyle = pal.hull; g.fill();
    g.restore();
    path([[-0.6, -0.18], [0.2, -0.18], [0.42, 0], [0.2, 0.18], [-0.6, 0.18]]); g.fillStyle = pal.upper; g.fill();
    path([[-0.95, -0.06], [0.7, -0.06], [0.82, 0], [0.7, 0.06], [-0.95, 0.06]]); g.fillStyle = pal.accent; g.fill();
    path(P); g.lineWidth = 1.2 * TH.dpr; g.strokeStyle = pal.trim; g.stroke();
  }

  /** Projekt miniatury: jeden element (moduł na płycie pancerza) w detalu 0,6, bez sieci rur. */
  function thumbDesign(it, palette, style) {
    const D = 0.6, gridStep = 2, u = hullBlockPaletteUnit(gridStep, D);
    const d = { v: 2, name: it.label, style, mirror: false, palette, seed: 11, detail: D, grid: gridStep, windows: 0, bevel: 1.9, round: 1, panels: 0.35, pipeNet: { density: 0 }, blocks: [], shapes: [], modules: [], decals: [], castles: [], parts: [] };
    const up = (v) => Math.ceil(v / (2 * gridStep)) * 2 * gridStep;
    const base = (hw, hh, level = 1) => ({ kind: 'block', shape: 'rect', x: 0, y: 0, w: up(2 * hw + 14), h: up(2 * hh + 14), rot: 0, level });
    if (it.kind === 'block') d.shapes.push(hullBlockFromPalette(it.id, u, 0, 0, 1));
    else if (it.kind === 'module') {
      const def = HD_MODULES[it.type];
      const m = { type: it.type, x: 0, y: 0, rot: 0 };
      if (def.r) m.r = def.r;
      if (def.w) { m.w = def.w; m.h = def.h; }
      if (def.v !== undefined) m.v = def.v;
      if (it.type === 'mount') { m.slot = it.slot; m.size = 'M'; m.r = HD_MOUNT_RADIUS_DU[it.slot] * D; }
      if (it.type === 'bridge' && m.v === 2) { const lv = bridgeLevel(2); m.lv = lv.level; m.w = lv.w / 2; m.h = lv.h / 2; }
      if (it.type === 'thruster_side') m.rot = -Math.PI / 2;
      const hw = m.r ?? m.w, hh = m.r ?? m.h;
      d.shapes.push(base(hw, hh, def.level === 0 ? 0 : 1));
      d.modules.push(m);
    } else if (it.kind === 'castle') {
      d.shapes.push(base(32 * D + 8, 24 * D + 8));
      d.castles.push({ x: 0, y: 0, w: 32 * D, h: 24 * D, rot: 0, tiers: 2, taper: 0.45, port: true, hatches: 2, vent: 'slats' });
    } else if (it.kind === 'part') d.parts.push({ id: it.id, x: 0, y: 0, s: 1, rot: 0 });
    return normalizeHullDesign(d);
  }
  async function bakeThumb(it, look) {
    const [palette, style] = look.split('|');
    const td = thumbDesign(it, palette, style);
    const bake = await api.composerExclusive(async (composer) => {
      const field = buildHullField(td, { pipes: false });
      const im = field.image;
      const tpu = Math.min(8, (TH.w * TH.dpr * 1.6) / im.w, (TH.h * TH.dpr * 1.6) / im.h);
      composer.setDesign(field, buildHullDecalAtlas(field.expanded.decals), { texPerUnit: tpu, glowToAlbedo: true });
      return composer.bake();
    });
    // albedo (wiersz 0 = góra) → kanwa przycięta do kadłuba
    const { width: w, height: h, albedo } = bake;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (albedo[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0) return null;
    const full = document.createElement('canvas');
    full.width = w; full.height = h;
    full.getContext('2d').putImageData(new ImageData(albedo, w, h), 0, 0);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(full, -x0, -y0);
    return out;
  }
  function scheduleThumbs() {
    const look = lookKey();
    if (!look) return;
    const order = [...items.filter((i) => i.cat === U.cat), ...items.filter((i) => i.cat !== U.cat)];
    thumbs.queue = order.filter((it) => bakeable(it) && !thumbs.cache.has(`${look}|${it.key}`)).map((it) => ({ it, look }));
    runThumbs();
  }
  async function runThumbs() {
    if (thumbs.running) return;
    thumbs.running = true;
    while (thumbs.queue.length) {
      // w trakcie przeciągania kompozytor należy do okrętu (szybkie wypieki podglądu)
      while (S.drag || U.drag) await new Promise((ok) => setTimeout(ok, 120));
      const { it, look } = thumbs.queue.shift() || {};
      if (!it) continue;
      const key = `${look}|${it.key}`;
      if (thumbs.cache.has(key) || look !== lookKey()) continue;
      let img = null;
      try { img = await bakeThumb(it, look); } catch (err) { console.warn(`[stocznia] miniatura ${it.key}:`, err); }
      thumbs.cache.set(key, img);   // null — karta zostaje z rysunkiem wektorowym
      if (img && look === lookKey()) paintCard(it);
      await new Promise((ok) => setTimeout(ok, 0));
    }
    thumbs.running = false;
    while (thumbs.waiters.length) thumbs.waiters.shift()();
  }

  // -------------------------------------------------------------------------
  // Pasek górny i nowy okręt
  function bindTop() {
    const sel = $('yard-preset');
    sel.innerHTML = '<option value="" hidden>✎ Własny projekt</option>'
      + HD_PRESET_KEYS.filter((k) => k !== 'empty').map((k) => `<option value="${k}">${esc(HD_PRESETS[k].label)}</option>`).join('');
    sel.addEventListener('change', () => { api.loadPreset(sel.value).then(() => { scheduleThumbs(); syncTop(); }); });
    $('yard-new').addEventListener('click', () => { el.dlg.hidden = false; });
    $('yard-undo').addEventListener('click', () => api.histGo(-1));
    $('yard-redo').addEventListener('click', () => api.histGo(1));
    $('yard-mirror').addEventListener('click', () => toggleMirror());
    $('yard-outline').addEventListener('click', () => { U.outlines = !U.outlines; syncTop(); });
    $('yard-fit').addEventListener('click', () => api.fit());
    $('yard-pro').addEventListener('click', () => api.setUi('warsztat'));
    el.dlg.innerHTML = `<div class="ydlg"><h2>Nowy kadłub</h2><p>Wybierz wielkość okrętu — od niej zależy skala klocków i detal płyt. Klasa liczy się potem z rozmiaru kadłuba i mostka.</p>
      <div class="ydlg-grid">${SHIP_CLASSES.map((c, i) => `<button data-lv="${c.level}"><b>${c.roman}</b><span>${c.label}</span><small>${c.example ? `jak ${c.example}` : '&nbsp;'}</small><i>klocek ${fmtInt(hullBlockPaletteUnit(gridFor(NEW_SHIP_DETAIL[i]), NEW_SHIP_DETAIL[i]) * 4)} j.</i></button>`).join('')}</div>
      <div class="ydlg-foot"><button data-close="1">Anuluj</button></div></div>`;
    el.dlg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (e.target === el.dlg || b?.dataset.close) { el.dlg.hidden = true; return; }
      if (b?.dataset.lv) { el.dlg.hidden = true; newShip(Number(b.dataset.lv)); }
    });
  }
  function gridFor(detail) { return 2 ** Math.round(Math.log2(4 * detail)); }
  /**
   * Pusty kadłub klasy `lv` (mostek tej klasy): kil — płyta ze ściętymi rogami na osi (~45% długości okrętu TN tej klasy,
   * który ma ~80 jednostek palety; prostokąt, bo mały kadłub i tak schodkuje się na komórkach belek 15 j.), symetria,
   * barwy Terra Novy — reszta z palety.
   */
  async function newShip(lv) {
    const D = NEW_SHIP_DETAIL[lv - 1];
    const g = gridFor(D), u = hullBlockPaletteUnit(g, D);
    const cls = shipClass(lv);
    const d = normalizeHullDesign({
      v: 2, name: `Nowy okręt — ${cls.label.toLowerCase()}`, style: 'chamfer', mirror: true, palette: 'terra', seed: 17 + lv, detail: D, grid: g,
      bridgeLevel: lv, windows: 0, bevel: 1.9, round: 1, panels: 0.4, pipeNet: { density: 1 }, blocks: [],
      shapes: [{ kind: 'block', shape: 'rect', x: 0, y: 0, w: 36 * u, h: 12 * u, c: [2 * u, 2 * u, 2 * u, 2 * u], rot: 0, level: 1 }], modules: [], decals: []
    });
    await api.loadPreset('empty', d);
    $('yard-preset').value = '';
    U.level = 1; U.cut = false;
    setCat('ksztalty');
    toast(`Nowy kadłub (${cls.roman} · ${cls.label}): przeciągaj kształty z palety — symetria stawia drugą burtę`);
  }
  function syncTop() {
    const d = design();
    if (!d) return;
    $('yard-mirror').classList.toggle('on', !!d.mirror);
    $('yard-outline').classList.toggle('on', U.outlines);
    const h = api.hist();
    $('yard-undo').disabled = h.idx <= 0;
    $('yard-redo').disabled = h.idx >= h.n - 1;
    const sel = $('yard-preset');
    if (S.presetKey !== 'empty' && sel.value !== S.presetKey && HD_PRESETS[S.presetKey]) sel.value = S.presetKey;
  }

  // -------------------------------------------------------------------------
  // Pasek zaznaczenia
  function bindSelBar() {
    const B = (act, icon, title, need = '') => `<button data-act="${act}" data-need="${need}" title="${title}">${icon}</button>`;
    el.sel.innerHTML = `<span class="ycount"></span><span class="ylock">🔒 stałe miejsce</span>
      ${B('rotl', '⟲', 'Obróć w lewo o 45°')}${B('rotr', '⟳', 'Obróć w prawo o 45° (R — 90°)')}${B('flip', '⇋', 'Odbij (F)')}
      ${B('up', '▲', 'Warstwa wyżej', 'block')}${B('down', '▼', 'Warstwa niżej', 'block')}${B('cut', '✂', 'Wycięcie / dokładanie (X)', 'block')}
      ${B('small', '−', 'Mniejszy (kółko w dół)')}${B('big', '+', 'Większy (kółko w górę)')}
      ${B('dup', '⧉', 'Powiel obok (Ctrl+D) — po przesunięciu kopii powtarza przesunięcie')}${B('del', '🗑', 'Usuń (Del)')}`;
    el.sel.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.sel.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const a = b.dataset.act;
      if (a === 'rotl') rotateSel(-1);
      else if (a === 'rotr') rotateSel(1);
      else if (a === 'flip') flipSel();
      else if (a === 'up') levelSel(1);
      else if (a === 'down') levelSel(-1);
      else if (a === 'cut') cutSel();
      else if (a === 'small') { if (scaleSel(-1)) commit(); }
      else if (a === 'big') { if (scaleSel(1)) commit(); }
      else if (a === 'dup') duplicateSel();
      else if (a === 'del') deleteSel();
    });
  }

  /** Wolny kadr między panelami (dopasowanie widoku, położenie paska zaznaczenia). */
  function insets() {
    const { W, H } = api.view();
    if (S.ui !== 'stocznia' || document.body.classList.contains('clean')) return { left: 0, right: 0, top: 0, bottom: 0 };
    const pal = el.pal.getBoundingClientRect(), card = el.card.getBoundingClientRect(), top = el.top.getBoundingClientRect(), help = el.help.getBoundingClientRect();
    return {
      left: pal.width ? pal.right + 8 : 0,
      right: card.width ? W - card.left + 8 : 0,
      top: top.height ? top.bottom + 6 : 0,
      bottom: help.height ? H - help.top + 6 : 0
    };
  }
  function onUi(ui) {
    U.drag = null; U.armed = null; U.hover = null;
    hideGhost();
    el.tip.style.display = 'none';
    el.sel.style.display = 'none';
    if (ui === 'stocznia') { U.statsKey = ''; renderOpts(); renderCards(); scheduleThumbs(); syncTop(); }
  }

  // -------------------------------------------------------------------------
  // Start
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerleave', () => { if (!U.drag) U.hover = null; U.mouse.over = false; });
  window.addEventListener('keydown', onKey);
  bindTop();
  bindSelBar();
  bindCards();
  bindOpts();
  bindCard();
  renderTabs();
  renderOpts();
  renderCards();

  const harness = {
    items: () => items.map((i) => i.key),
    cat(id) { setCat(id); return true; },
    /** Upuszczenie karty `key` w punkcie świata (jak przeciągnięcie z palety): true — element postawiony. */
    drop(key, x, y) { return !!dropItem(byKey.get(key), { x, y }); },
    arm(key) { clickCard(byKey.get(key)); return U.armed?.key || null; },
    row(key, ax, ay, bx, by) { const row = rowFor(byKey.get(key), { x: ax, y: ay }, { x: bx, y: by }); return row ? (placeRow(row) || []).length : 0; },
    duplicate() { duplicateSel(); return U.sel.length; },
    selectLast(kind = 'shape') { const list = listFor(kind); const obj = list[list.length - 1]; select(obj ? [{ kind, obj }] : []); return !!obj; },
    /** Burta kadłuba nad (side −1) albo pod (+1) punktem x: y pierwszego punktu wnętrza od zewnątrz (pole ramy ≤ 0). */
    edge(x, side = -1) {
      const F = S.field;
      if (!F) return null;
      const b = F.bounds, y0 = side < 0 ? b.minY - 1 : b.maxY + 1, y1 = side < 0 ? b.maxY : b.minY;
      for (let k = 0; k <= 2000; k++) { const y = y0 + (y1 - y0) * k / 2000; if (sampleHullField(F, 0, x, y) <= 0) return y; }
      return null;
    },
    newShip(lv) { return newShip(lv).then(() => true); },
    thumbsDone(timeoutMs = 90000) {
      if (!thumbs.running && !thumbs.queue.length) return Promise.resolve(thumbs.cache.size);
      return new Promise((ok) => { const t = setTimeout(() => ok(-thumbs.cache.size), timeoutMs); thumbs.waiters.push(() => { clearTimeout(t); ok(thumbs.cache.size); }); });
    },
    state: () => ({
      cat: U.cat, armed: U.armed?.key || null, sel: U.sel.map((r) => refName(r)), level: U.level, cut: U.cut, thumbs: thumbs.cache.size, queue: thumbs.queue.length,
      drag: U.drag ? { mode: U.drag.mode, trash: !!U.drag.trash, dx: U.drag.dx ?? null, dy: U.drag.dy ?? null } : null
    })
  };
  return {
    draw, insets, onUi, harness,
    /** Po wczytaniu projektu (preset): karta okrętu od nowa, miniatury w jego barwach. */
    refresh() { U.statsKey = ''; if (S.ui === 'stocznia') scheduleThumbs(); syncTop(); }
  };
}
