// GNIAZDA BRONI floty Terra Novy w kreatorze kadłubów (etap 2 stoczni z klocków): pełne zestawy gniazd gry
// (SHIP_EDITOR_DEFAULTS.ships — te same wpisy czyta gra dla NPC i gracza) przeliczone z px PNG na układ projektu
// (przekształcenie slotów systemów — nagłówek src/game/hullDesign/hullDesignSystemSlots.js), z domyślnym uzbrojeniem
// NPC (equipNpcWeapons wycięte z index.html). Wynik to blok danych HD_PRESET_MOUNTS w pliku slotów.
//
//   node scripts/kreator-gniazda-tn.mjs [--zapisz] [--tylko custos,hasta,...] [--json .tmp/kreator/gniazda.json]
//
// Kroki: duplikaty edytora (≤ DUP_PX px, ten sam typ) → jedno gniazdo; uzbrojenie NPC na liście bez duplikatów
// (najwyżej SHIPS[rama].spec na typ, wybór po kącie — selectSpecSlots); broń większa niż gniazdo → ta sama rodzina
// (typ i kategoria) w największym rozmiarze, który się mieści; pary burt (ten sam typ, odległość (x, |y|) ≤ PAIR_K ·
// długość) → para w lustrze w średnim położeniu, gniazdo przy osi (|y| < r) → na osi; gniazda hangarowe → wrota
// hangarów presetu (tylko kontrola liczby); dosuwanie: podstawa gniazda (1,2 r) cała w kadłubie, z odstępem od modułów
// presetu i innych gniazd, najlepiej na płycie — najbliższe takie miejsce w promieniu 3 r (przesunięcie w tabeli).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { SHIPS, WEAPON_TIER_BY_HULL } from '../src/data/ships.js';
import { MASTER_WEAPONS, WEAPON_SIZE_RANK } from '../src/data/weapons.js';
import { resolveNpcSpecFrameId, selectSpecSlots } from '../src/game/npcWeaponSpec.js';
import { HD_PRESETS } from '../src/game/hullDesign/hullDesignPresets.js';
import { applySystemSlots } from '../src/game/hullDesign/hullDesignSystemSlots.js';
import { normalizeHullDesign, expandHullDesign, HD_MOUNT_RADIUS_DU } from '../src/game/hullDesign/hullDesignSchema.js';
import { buildHullField, sampleHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { pipeModuleSdf } from '../src/game/hullDesign/hullDesignPipes.js';
import { serviceChannel, serviceChannelSdf } from '../src/game/hullDesign/hullDesignSystems.js';
import { readIndexHtml, loadIndexFunction } from '../tests/helpers/indexSource.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return acc;
}, []));

/**
 * Kadłuby TN: klucz edytora gry, rama SHIPS, typ NPC (equipNpcWeapons), przekształcenie px PNG → projekt
 * (s [j./px], przesunięcie (ox, oy) [px]: x = (px − ox) · s, y = (py − oy) · s).
 */
export const TN_MOUNT_HULLS = Object.freeze({
  custos: { editor: 'frigate', frame: 'terran_frigate', npcType: 'frigate', s: 0.0800, ox: -35.5, oy: -6.0 },
  hasta: { editor: 'destroyer', frame: 'terran_destroyer', npcType: 'destroyer', s: 0.3750, ox: 12.5, oy: 0.5 },
  bellator: { editor: 'battleship', frame: 'terran_battleship', npcType: 'battleship', s: 0.5389, ox: 0.5, oy: 1.0 },
  citadella: { editor: 'terran_carrier', frame: 'terran_carrier', npcType: 'carrier', s: 0.6459, ox: 1.5, oy: 12.0 },
  colossus: { editor: 'terran_supercapital', frame: 'terran_supercapital', npcType: 'supercapital', s: 0.9330, ox: -0.5, oy: 2.0 }
});
export const DUP_PX = 3;
const PAIR_K = 0.1;

/** Markery gniazd edytora bez duplikatów (ten sam typ, ≤ DUP_PX px): [{ type, x, y, n (ile markerów) }]. */
export function dedupeMarkers(list) {
  const out = [];
  for (const h of list) {
    const d = out.find((q) => q.type === h.type && Math.hypot(q.x - h.x, q.y - h.y) <= DUP_PX);
    if (d) d.n++;
    else out.push({ type: h.type, x: h.x, y: h.y, n: 1 });
  }
  return out;
}

/** Domyślne uzbrojenie NPC na liście gniazd (equipNpcWeapons z index.html): broń (id) albo '' na gniazdo. */
export function npcLoadout(hull, markers) {
  const src = readIndexHtml();
  const equip = loadIndexFunction(src, 'function equipNpcWeapons(npc, faction) {', 'equipNpcWeapons',
    { SHIPS, MASTER_WEAPONS, resolveNpcSpecFrameId, selectSpecSlots });
  const npc = { type: hull.npcType, editorHardpoints: markers.map((m) => ({ type: m.type, x: m.x, y: m.y, mount: null })) };
  equip(npc, 'terran');
  return npc.editorHardpoints.map((hp) => hp.mount || '');
}

/** Broń w rozmiarze gniazda: ta sama, gdy się mieści, inaczej ta sama rodzina (typ, kategoria) w największym rozmiarze. */
export function fitWeaponToSize(id, size) {
  const w = MASTER_WEAPONS[id];
  if (!w || WEAPON_SIZE_RANK[w.size] <= WEAPON_SIZE_RANK[size]) return id;
  const alt = Object.values(MASTER_WEAPONS)
    .filter((q) => q.mountType === w.mountType && q.category === w.category && !q.npcOnly && WEAPON_SIZE_RANK[q.size] <= WEAPON_SIZE_RANK[size])
    .sort((a, b) => WEAPON_SIZE_RANK[b.size] - WEAPON_SIZE_RANK[a.size] || Math.abs((a.energyCost || 0) - (w.energyCost || 0)) - Math.abs((b.energyCost || 0) - (w.energyCost || 0)));
  return alt[0]?.id || '';
}

function moduleFoot(m) { return m.type === 'mount' ? m.r * 1.2 : 0; }

/** Gniazda kadłuba `key`: { size, list: [{ slot, x, y, w, w2, shift, src }], hangars, report }. */
export function computeTnMounts(key) {
  const hull = TN_MOUNT_HULLS[key];
  const raw = HD_PRESETS[key].make();
  const design = normalizeHullDesign(applySystemSlots(key, raw, { mounts: false }));
  const D = design.detail;
  const size = WEAPON_TIER_BY_HULL[hull.frame];
  const markers = dedupeMarkers(SHIP_EDITOR_DEFAULTS.ships[hull.editor].hardpoints);
  const weapons = npcLoadout(hull, markers).map((w) => (w ? fitWeaponToSize(w, size) : ''));
  // projekt bez wież i ram w miejscu gniazd (plik slotów robi to samo) — przeszkody dosuwania
  const field = buildHullField(design, { pipes: false });
  const L = field.bounds.maxX - field.bounds.minX;
  const pts = markers.map((m, i) => ({
    slot: m.type, x: (m.x - hull.ox) * hull.s, y: (m.y - hull.oy) * hull.s, w: weapons[i], n: m.n, i
  }));
  const hangars = pts.filter((p) => p.slot === 'hangar');
  const guns = pts.filter((p) => p.slot !== 'hangar');
  // pary burt: zachłannie po najmniejszej odległości (x, |y|)
  const rOf = (slot) => HD_MOUNT_RADIUS_DU[slot] * D;
  const cand = [];
  for (const a of guns) for (const b of guns) {
    if (a.i >= b.i || a.slot !== b.slot || a.y * b.y >= 0) continue;
    const c = Math.hypot(a.x - b.x, Math.abs(a.y) - Math.abs(b.y));
    if (c <= PAIR_K * L) cand.push({ a, b, c });
  }
  cand.sort((p, q) => p.c - q.c);
  const used = new Set();
  const items = [];
  for (const { a, b } of cand) {
    if (used.has(a) || used.has(b)) continue;
    used.add(a); used.add(b);
    const [port, stbd] = a.y < 0 ? [a, b] : [b, a];
    items.push({ slot: a.slot, x: (a.x + b.x) / 2, y: -(Math.abs(a.y) + Math.abs(b.y)) / 2, w: port.w, w2: stbd.w, src: [port.i, stbd.i] });
  }
  for (const p of guns) {
    if (used.has(p)) continue;
    // gniazdo przy osi → na osi; bez pary poza osią → zostaje na swojej burcie (`one`, bez lustra)
    if (Math.abs(p.y) < rOf(p.slot)) items.push({ slot: p.slot, x: p.x, y: 0, w: p.w, src: [p.i] });
    else items.push({ slot: p.slot, x: p.x, y: p.y, w: p.w, src: [p.i], one: true });
  }
  for (const it of items) { it.gx = it.x; it.gy = it.y; }
  // SADZANIE: gniazdo w zasięgu kapsuły wieży albo pierścienia / ramy presetu (1,5 · większy promień) siada w jej środku
  // (sprite ma tam gniazdo); pierścień idzie na listę `drop`, wieże presetu znikają wszystkie
  const ex = expandHullDesign(design).modules;
  const sockets = ex.filter((m) => (m.type.startsWith('turret_') || m.type === 'well') && m.y <= 0.5);
  const taken = new Set();
  const drop = [];
  const snapOrder = [...items].sort((a, b) => rOf(b.slot) - rOf(a.slot));
  for (const it of snapOrder) {
    let best = null, bd = Infinity;
    for (const m of sockets) {
      if (taken.has(m)) continue;
      const onAxis = Math.abs(m.y) <= 0.5;
      if (it.y === 0 && !onAxis) continue;           // gniazdo na osi — tylko gniazdo presetu na osi
      if (!it.one && it.y < 0 && onAxis) continue;   // para — tylko gniazdo poza osią
      const d = Math.hypot(it.x - m.x, Math.abs(it.y) - Math.abs(m.y));
      // wieża wbudowana (promień śmierci Colossusa: marker na samym czubku dziobu) siada na ramie dalej
      const reach = (it.slot === 'builtin' ? 2.5 : 1.5) * Math.max(rOf(it.slot), m.r || 0);
      if (d < reach && d < bd) { bd = d; best = m; }
    }
    if (!best) continue;
    taken.add(best);
    it.x = best.x;
    it.y = Math.abs(best.y) <= 0.5 ? 0 : (it.one && it.gy > 0 ? Math.abs(best.y) : -Math.abs(best.y));
    if (it.y === 0) it.one = false;
    it.snap = best.type === 'well' ? `pierścień v${best.v || 0}` : best.type;
    if (best.type === 'well') drop.push([best.x, best.y]);
  }
  // przeszkody: moduły projektu po rozwinięciu (lustro) bez wież i pierścieni pod gniazdami; kratki i klapy TN — miękkie
  // (podstawa może do nich dochodzić), reszta — z odstępem
  const isDropped = (m) => m.type === 'well' && drop.some(([x, y]) => Math.abs(x - m.x) < 0.5 && Math.abs(Math.abs(y) - Math.abs(m.y)) < 0.5);
  const obstacles = ex.filter((m) => !m.type.startsWith('turret_') && !isDropped(m));
  // kanały serwisowe dysz SIDE, zbiorników i gondol MAIN (rura paliwa wchodzi nimi widocznie — sieć systemów)
  const channels = obstacles.map((m) => serviceChannel(m, D, true)).filter(Boolean);
  // obudowa reaktora nad kadłubem (gałąź reaktor-obudowa: ośmiokąt do 1,2 · r + 0,8 · D) — koło r · 1,3 + D
  const housings = obstacles.filter((m) => m.type === 'reactor').map((m) => ({ x: m.x, y: m.y, R: m.r * 1.3 + D }));
  const soft = (m) => m.type === 'vent' || (m.type === 'hatch' && (m.v || 0) >= 1);
  // dosuwanie: większe najpierw
  items.sort((a, b) => rOf(b.slot) - rOf(a.slot) || a.x - b.x);
  const placed = [];
  const gapJ = 2 * D;
  const FOOT = 1.16;    // obrys podstawy (ośmiokątna rama kapsuły) / r
  const mirrorsOf = (q) => (q.y !== 0 && !q.one ? [q.y, -q.y] : [q.y]);
  // miejsce: podstawa cała w kadłubie, z odstępem od modułów i gniazd; na płycie (pół obrysu od krawędzi płyty) — bez kary
  const onPlate = (it, x, y) => sampleHullField(field, 1, x, y) <= -rOf(it.slot) * FOOT * 0.5;
  const fits = (it, x, y) => {
    const F = rOf(it.slot) * FOOT;
    if (sampleHullField(field, 0, x, y) > -(F + D)) return false;
    if (y !== 0 && !it.one && Math.abs(y) < F + gapJ / 2) return false;
    for (const m of obstacles) if (pipeModuleSdf(m, x, y) < F + (soft(m) ? 0 : gapJ)) return false;
    for (const ch of channels) if (serviceChannelSdf(ch, x, y) < F + gapJ) return false;
    for (const h of housings) if (Math.hypot(x - h.x, y - h.y) < h.R + F + gapJ) return false;
    for (const yy of it.one || y === 0 ? [y] : [y, -y]) {
      for (const q of placed) {
        const Fq = rOf(q.slot) * FOOT;
        for (const qy of mirrorsOf(q)) if (Math.hypot(q.x - x, qy - yy) < F + Fq + gapJ) return false;
      }
    }
    return true;
  };
  for (const it of items) {
    const F = rOf(it.slot) * FOOT;
    const sideSign = it.one ? Math.sign(it.y) : -1;
    // koszt = przesunięcie + kara za podstawę poza płytą (pół obrysu); szukanie do 3 obrysów
    let best = null;
    const step = Math.max(D, F / 6), penalty = 0.5 * F;
    // zasięg 3 obrysów, przy braku miejsca — 6
    for (let rr = 0, maxR = 3 * F; rr <= maxR; rr += step) {
      if (!best && rr + step > maxR && maxR < 6 * F) maxR = 6 * F;
      if (best && rr > best.cost) break;
      const nA = rr === 0 ? 1 : Math.max(8, Math.round(2 * Math.PI * rr / step));
      for (let k = 0; k < nA; k++) {
        const a = k / nA * 2 * Math.PI;
        const x = it.x + Math.cos(a) * rr;
        let y = it.y + Math.sin(a) * rr;
        if (it.y === 0) y = 0;                       // gniazdo na osi zostaje na osi
        else if (y * sideSign < 1e-6) continue;      // gniazdo burty zostaje na swojej burcie
        if (!fits(it, x, y)) continue;
        const d = Math.hypot(x - it.x, y - it.y), plate = onPlate(it, x, y);
        const cost = d + (plate ? 0 : penalty);
        if (!best || cost < best.cost) best = { x, y, d, plate, cost };
      }
    }
    if (!best) best = { x: it.x, y: it.y, d: 0, plate: false, stuck: true };
    it.x = Math.round(best.x * 10) / 10;
    it.y = Math.round(best.y * 10) / 10;
    it.shift = Math.round(Math.hypot(it.x - it.gx, Math.abs(it.y) - Math.abs(it.gy)) * 10) / 10;
    it.onPlate = best.plate;
    it.stuck = !!best.stuck;
    placed.push(it);
  }
  placed.sort((a, b) => ['main', 'special', 'builtin', 'aux', 'missile'].indexOf(a.slot) - ['main', 'special', 'builtin', 'aux', 'missile'].indexOf(b.slot) || b.x - a.x);
  const hangarMods = ex.filter((m) => m.type === 'hangar').length;
  return {
    key, size, D, list: placed, drop: drop.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]),
    hangars: hangars.length, hangarModules: hangarMods,
    markers: markers.length, raw: SHIP_EDITOR_DEFAULTS.ships[hull.editor].hardpoints.length,
    dups: markers.filter((m) => m.n > 1).map((m) => ({ type: m.type, x: m.x, y: m.y, n: m.n })),
    area: field.area
  };
}

const fmt = (v) => (Math.round(v * 10) / 10).toString();
const q = (s) => `'${s}'`;

/** Linie bloku danych pliku slotów. */
export function mountsBlock(results) {
  const lines = [];
  for (const r of results) {
    lines.push(`  // ${r.key}: ${r.raw} markerów edytora (${r.dups.length ? `${r.raw - r.markers} duplikatów, ` : ''}${r.markers} gniazd), w tym ${r.hangars} hangarów = wrota presetu`);
    const drop = r.drop.length ? `drop: Object.freeze([${r.drop.map(([x, y]) => `[${x}, ${y}]`).join(', ')}]), ` : '';
    lines.push(`  ${r.key}: Object.freeze({ size: '${r.size}', ${drop}list: Object.freeze([`);
    const rows = r.list.map((it) => (it.one
      ? `g1(${q(it.slot)}, ${fmt(it.x)}, ${fmt(it.y)}, ${q(it.w)})`
      : `g(${q(it.slot)}, ${fmt(it.x)}, ${fmt(it.y)}, ${q(it.w)}${it.y !== 0 && it.w2 !== undefined && it.w2 !== it.w ? `, ${q(it.w2)}` : ''})`));
    for (let i = 0; i < rows.length; i += 4) lines.push(`    ${rows.slice(i, i + 4).join(', ')}${i + 4 < rows.length ? ',' : ''}`);
    lines.push(`  ])}),`);
  }
  if (lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
  return lines;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keys = (args.tylko || Object.keys(TN_MOUNT_HULLS).join(',')).split(',');
  const results = keys.map(computeTnMounts);
  for (const r of results) {
    const count = r.list.reduce((s, it) => s + (it.y !== 0 && !it.one ? 2 : 1), 0) + r.hangars;
    console.log(`\n== ${r.key}: markery ${r.raw}, gniazda ${r.markers} (w preseciе ${count}), hangary ${r.hangars} / wrota ${r.hangarModules}, rozmiar ${r.size}, pow. ${Math.round(r.area)} j²`);
    if (r.dups.length) console.log('   duplikaty:', r.dups.map((d) => `${d.type} (${d.x}, ${d.y}) ×${d.n}`).join('; '));
    for (const it of r.list) {
      console.log(`   ${it.slot.padEnd(8)} (${fmt(it.x).padStart(7)}, ${fmt(it.y).padStart(7)})${it.y && !it.one ? ' ±' : (it.one ? ' 1' : '  ')} ${String(it.w).padEnd(20)} ${it.w2 !== undefined && it.w2 !== it.w ? String(it.w2).padEnd(20) : ''.padEnd(20)} przes. ${fmt(it.shift)}${it.snap ? ` (na: ${it.snap})` : ''}${it.onPlate ? '' : ' (rama)'}${it.stuck ? ' ZABLOKOWANE' : ''}`);
    }
  }
  if (args.json) { mkdirSync(dirname(args.json), { recursive: true }); writeFileSync(args.json, JSON.stringify(results, null, 1)); }
  if (args.zapisz) {
    const p = join(repo, 'src/game/hullDesign/hullDesignSystemSlots.js');
    const src = readFileSync(p, 'utf8');
    const eol = src.includes('\r\n') ? '\r\n' : '\n';
    const a = src.indexOf('// @gniazda-start'), b = src.indexOf('  // @gniazda-end');
    if (a < 0 || b < 0) throw new Error('brak znaczników @gniazda w pliku slotów');
    const head = src.slice(0, src.indexOf(eol, a) + eol.length);
    const out = head + mountsBlock(results).join(eol) + eol + src.slice(b);
    writeFileSync(p, out);
    console.log(`\nzapisano ${p}`);
  }
}
