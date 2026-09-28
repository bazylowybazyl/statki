// Strefy ładowni na sprite'ach kadłubów (zadanie 26, src/data/cargoBays.js): sprawdzenie i propozycje.
//
//   node scripts/webgpu/ladownia-strefy.mjs
//        każdy kadłub z CARGO_BAY_HULLS: pokrycie kadłubem (alfa) otworu i pasów parkowania skrzydeł,
//        kolizje z hardpointami / silnikami / mostkami (validateCargoBays), tabela pojemności dla wariantów tonażu
//   node scripts/webgpu/ladownia-strefy.mjs --szukaj atlas [--skrzydla 1,2,0] [--zapas 1.6]
//        największe wolne prostokąty w osi statku (środek i para lustrzana) dla kadłuba z CARGO_BAY_HULLS
//   node scripts/webgpu/ladownia-strefy.mjs --szukaj nowy --sprite assets/ships/x.png --dlugosc 540 [--edytor klucz] [--mostek klucz]
//        to samo dla kadłuba spoza danych (np. nowy sprite ruchu v2) — wynik do wklejenia w CARGO_BAY_HULLS
// Skrzydła: 1–3 = wrota „over” (Venator; pas parkowania h / 2n z każdej strony), 0 = kieszeń („pocket”).
// Zapas: mnożnik korpusu wieżyczki (bridgeZoneMargin) — 1,6 = z luzem na wizualny oddech.
import { readPng } from './png.mjs';
import { parseArgs } from './wspolne.mjs';
import { SHIP_EDITOR_DEFAULTS } from '../../src/data/hardpointEditorDefaults.js';
import { BRIDGE_LAYOUT_PROPOSALS, bridgeZoneMargin } from '../../src/game/shipBridge.js';
import { getHullRenderSize, getWeaponTierForHull } from '../../src/data/ships.js';
import {
  CARGO_BAY_HULLS, CARGO_CONTAINER, CARGO_TONNES_OPTIONS, cargoBayScale, cargoBayZoneRects, cargoCapacityTable, validateCargoBays
} from '../../src/data/cargoBays.js';

const args = parseArgs();

function alphaIntegral(img) {
  const W = img.width;
  const H = img.height;
  const I = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += img.data[(y * W + x) * 4 + 3] > 200 ? 1 : 0;
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  // Udział nieprzezroczystych pikseli w prostokącie PNG (środek płótna = 0).
  return (x0, y0, x1, y1) => {
    const a = Math.max(0, Math.round(x0 + W / 2));
    const b = Math.max(0, Math.round(y0 + H / 2));
    const c = Math.min(W, Math.round(x1 + W / 2));
    const d = Math.min(H, Math.round(y1 + H / 2));
    if (c <= a || d <= b) return 0;
    const n = I[d * (W + 1) + c] - I[b * (W + 1) + c] - I[d * (W + 1) + a] + I[b * (W + 1) + a];
    return n / ((c - a) * (d - b));
  };
}

function marginFor(profile, png) {
  if (!profile) return 24;
  const size = getHullRenderSize(profile, png.w, png.h);
  return bridgeZoneMargin(Math.min(size.w / png.w, size.h / png.h), getWeaponTierForHull(profile));
}

function bridgesOf(key) {
  const e = key ? BRIDGE_LAYOUT_PROPOSALS[key] : null;
  return e ? e.variants[e.defaultVariant] : [];
}

if (!args.szukaj) {
  let bad = 0;
  for (const [id, H] of Object.entries(CARGO_BAY_HULLS)) {
    const img = readPng(H.sprite);
    const cover = alphaIntegral(img);
    const rects = cargoBayZoneRects(H).map((r) => `${r.kind === 'bay' ? 'otwór' : 'pas'} ${(100 * cover(r.x0, r.y0, r.x1, r.y1)).toFixed(1)}%`);
    const issues = H.editorKey ? validateCargoBays(H, SHIP_EDITOR_DEFAULTS.ships[H.editorKey], bridgesOf(H.bridgeKey), marginFor(H.profile, H.png)) : [];
    if (issues.length || img.width !== H.png.w || img.height !== H.png.h) bad++;
    console.log(`${id.padEnd(24)} ${rects.join(' · ')}${issues.length ? `\n    KOLIZJE: ${JSON.stringify(issues)}` : ''}`);
  }
  for (const t of CARGO_TONNES_OPTIONS) {
    console.log(`\n— ${t} t / kontener ${CARGO_CONTAINER.L}×${CARGO_CONTAINER.W}×${CARGO_CONTAINER.H} j.`);
    for (const r of cargoCapacityTable(t)) {
      console.log(`  ${r.label.padEnd(30)} ${String(r.containers).padStart(5)} kont. → ${String(r.tonnes).padStart(6)} t (dziś ${r.today}) · skały miedzi ${r.rocks.toFixed(1)}`);
    }
  }
  process.exit(bad ? 1 : 0);
}

// --- Szukanie wolnych prostokątów ---
const known = CARGO_BAY_HULLS[args.szukaj];
const sprite = args.sprite || known?.sprite;
if (!sprite) throw new Error('brak sprite’a: --sprite ścieżka (albo --szukaj id z CARGO_BAY_HULLS)');
const img = readPng(sprite);
const png = { w: img.width, h: img.height };
const renderLength = Number(args.dlugosc) || known?.renderLength || Math.max(png.w, png.h);
const s = known ? cargoBayScale(known) : renderLength / Math.max(png.w, png.h);
const profile = known?.profile || args.profil || null;
const cfg = SHIP_EDITOR_DEFAULTS.ships[args.edytor || known?.editorKey] || {};
const bridges = bridgesOf(args.mostek || known?.bridgeKey);
const margin = marginFor(profile, png) * (Number(args.zapas) || 1.6) / 1.0;
const cover = alphaIntegral(img);
const pts = [];
for (const h of cfg.hardpoints || []) if (h.type !== 'hangar') pts.push([h.x, h.y]);
for (const e of cfg.engines?.main || []) pts.push([e.x, e.y]);
for (const e of cfg.engines?.side || []) pts.push([e.x, e.y]);
for (const c of cfg.cores || []) pts.push([c.x, c.y]);
const clear = (cx, cy, w, h) => {
  for (const [x, y] of pts) {
    const dx = Math.max(Math.abs(x - cx) - w / 2, 0);
    const dy = Math.max(Math.abs(y - cy) - h / 2, 0);
    if (Math.hypot(dx, dy) < margin) return false;
  }
  for (const b of bridges) if (Math.abs(b.x - cx) < (b.w + w) / 2 + margin / 2 && Math.abs(b.y - cy) < (b.h + h) / 2 + margin / 2) return false;
  return true;
};
const C = CARGO_CONTAINER;
const step = Math.max(4, Math.round(Math.max(png.w, png.h) / 220));
console.log(`${args.szukaj}: ${png.w}×${png.h} px, ${s.toFixed(4)} j./px, zapas ${margin.toFixed(0)} px, kontener ${C.L}×${C.W} j.`);
for (const n of String(args.skrzydla || '1,2,0').split(',').map(Number)) {
  for (const twin of [false, true]) {
    let best = null;
    for (let h = step * 4; h < png.h * 0.6; h += step) {
      const band = n > 0 ? h / (2 * n) : 0;
      for (let w = h * 1.2; w < png.w * 0.8; w += step) {
        const cols = Math.floor((w * s - 1) / (C.L + 1));
        const rows = Math.floor((h * s - 1) / (C.W + 1));
        const count = Math.max(0, cols) * Math.max(0, rows) * (twin ? 2 : 1);
        if (count < 1 || (best && count <= best.count)) continue;
        const cys = twin ? [] : [0];
        if (twin) for (let c = h / 2 + band + 4; c < png.h / 2; c += step) cys.push(c);
        let found = null;
        for (const cy of cys) {
          for (let cx = -png.w / 2 + w / 2; cx <= png.w / 2 - w / 2 && !found; cx += step) {
            const ok = (y) => cover(cx - w / 2, y - h / 2 - band, cx + w / 2, y + h / 2 + band) > 0.985 && clear(cx, y, w, h + 2 * band);
            if (ok(cy) && (!twin || ok(-cy))) found = { cx, cy };
          }
          if (found) break;
        }
        if (found) best = { door: n > 0 ? 'over' : 'pocket', leaves: Math.max(1, n), twin, x: Math.round(found.cx), y: Math.round(found.cy), w: Math.round(w), h: Math.round(h), count };
      }
    }
    if (best) console.log(`  ${best.door}${best.door === 'over' ? `×${best.leaves}` : ''}${best.twin ? ' para' : ''}: x ${best.x}, y ${best.twin ? '±' : ''}${best.y}, w ${best.w}, h ${best.h} → ~${best.count} kontenerów (${(best.w * s).toFixed(0)} × ${(best.h * s).toFixed(0)} j.)`);
  }
}
