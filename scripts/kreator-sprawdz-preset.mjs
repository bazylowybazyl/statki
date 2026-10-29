// Sprawdzenie JEDNEGO presetu kreatora kadłubów tymi samymi warunkami, które testy stawiają wszystkim presetom
// (tests/hullDesign*.test.mjs): strażnik „bez czitowania” (isPlayerBuildable), rama w jednej bryle bez szpar, receptura
// bez ostrzeżeń (komplet systemów, dysze, moduły na kadłubie, broń — chyba że statek cywilny), klasa = najniższa
// z powierzchni i limity klasy, sieć systemów (gęstość 1: bez trasy / wolne końce / poza obrysem / bez prądu / bez paliwa
// = 0), limity kompozytora (moduły po lustrze, naklejki). Do tego wymiary, klasa, ładowność, bilans mocy i — z --png —
// PODGLĄD CPU (plan poziomów, moduły, siatka kontenerów, trasy sieci) bez przeglądarki.
//
//   node scripts/kreator-sprawdz-preset.mjs <klucz>[,<klucz>…] [--png .tmp/kreator/plan] [--px <px/j.>] [--szer 1600]
//   node scripts/kreator-sprawdz-preset.mjs --plik src/game/hullDesign/freighters/<klucz>.js [--png …]
//
// --plik: preset frachtowca prosto z pliku (`export default { key, label, cls, make }`) — bez rejestru presetów, więc
// błąd w pliku innego frachtowca go nie zatrzyma. Kod wyjścia 1, gdy któryś preset nie spełnia warunków.
// PODKŁAD (sylwetka do odwzorowania, np. szkic użytkownika): --maska <png> (biały = wnętrze) --skala <j./px>[,<j./px
// w poprzek>] (dwie wartości — podkład rozciągnięty wzdłuż) --x0 <px> --y0 <px> (piksel maski w punkcie 0, 0 projektu;
// oś okrętu = wiersz y0) — IoU sylwetki projektu z maską, a na podglądzie --png czerwony obrys maski.

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPng, writePng } from './webgpu/png.mjs';
import { normalizeHullDesign } from '../src/game/hullDesign/hullDesignSchema.js';
import { HD_PRESET_OUTSIDE_LADDER, applySystemSlots } from '../src/game/hullDesign/hullDesignSystemSlots.js';
import { buildHullField, sampleHullField, hullCells, hullFrameIntegrity } from '../src/game/hullDesign/hullDesignGeometry.js';
import { hullDesignRecipe } from '../src/game/hullDesign/hullDesignRecipe.js';
import { hullDesignClass } from '../src/game/hullDesign/hullDesignClass.js';
import { isPlayerBuildable } from '../src/game/hullDesign/hullDesignBuildable.js';
import { pipeNetworkCheck } from '../src/game/hullDesign/hullDesignPipes.js';
import { hullCargoGrid } from '../src/game/hullDesign/hullDesignCargo.js';
import { HD_COMPOSER_LIMITS } from '../src/3d/hullDesign/hullComposer.js';
import { classForHull } from '../src/data/shipClasses.js';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const opt = {};
const keys = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  else keys.push(...argv[i].split(',').filter(Boolean));
}
const items = [];
if (opt.plik) {
  const p = (await import(pathToFileURL(resolve(repo, String(opt.plik))).href)).default;
  if (!p) { console.error(`✗ ${opt.plik}: preset null (w budowie)`); process.exit(1); }
  items.push({ key: p.key, design: () => normalizeHullDesign(applySystemSlots(p.key, p.make(), { cls: p.cls })) });
} else {
  const { HD_PRESET_KEYS, hullDesignPreset } = await import('../src/game/hullDesign/hullDesignPresets.js');
  if (!keys.length) { console.error('podaj klucz presetu (HD_PRESET_KEYS) albo --plik:', HD_PRESET_KEYS.join(', ')); process.exit(2); }
  for (const key of keys) {
    if (!HD_PRESET_KEYS.includes(key)) { console.error(`✗ ${key}: nie ma takiego presetu`); process.exit(1); }
    items.push({ key, design: () => hullDesignPreset(key) });
  }
}

/** Podkład: maska sylwetki w układzie projektu (null — bez podkładu). */
let mask = null;
if (opt.maska) {
  const m = readPng(resolve(repo, String(opt.maska)));
  const [sx, sy = sx] = String(opt.skala || 1).split(',').map(Number);
  const px0 = Number(opt.x0 || 0), py0 = Number(opt.y0 || 0);
  const at = (x, y) => {
    const ix = Math.round(x / sx + px0), iy = Math.round(y / sy + py0);
    return ix >= 0 && iy >= 0 && ix < m.width && iy < m.height && m.data[(iy * m.width + ix) * 4] > 127;
  };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;
  for (let iy = 0; iy < m.height; iy++) for (let ix = 0; ix < m.width; ix++) if (m.data[(iy * m.width + ix) * 4] > 127) {
    const x = (ix - px0) * sx, y = (iy - py0) * sy;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    n++;
  }
  mask = { at, box: { minX: x0, maxX: x1, minY: y0, maxY: y1 }, area: n * sx * sy };
}

let failed = 0;
for (const { key, design } of items) {
  const t0 = performance.now();
  const errs = [];
  const d = design();
  const b = isPlayerBuildable(d);
  if (!b.ok) errs.push(`isPlayerBuildable: ${b.violations.slice(0, 6).map((v) => `${v.where}[${v.index}] ${v.text}`).join('; ')}`);
  const integ = hullFrameIntegrity(buildHullField(d, { pipes: false }));
  if (integ.pieces.length !== 1) errs.push(`rama w ${integ.pieces.length} kawałkach (${integ.pieces.slice(1).map((p) => `${p.area.toFixed(1)} j.² przy ${p.box.join(',')}`).join('; ')})`);
  if (integ.holes.length) errs.push(`${integ.holes.length} szpar w ramie (${integ.holes.map((p) => `${p.area.toFixed(1)} j.² przy ${p.box.join(',')}`).join('; ')})`);
  const f = buildHullField({ ...d, pipeNet: { density: 1, seed: d.pipeNet?.seed || 0 } });
  const r = hullDesignRecipe(f);
  if (key !== 'empty') {
    if (r.warnings.length) errs.push(`receptura: ${r.warnings.map((w) => w.text).join(' | ')}`);
    if (!(r.parts.reactor_core >= 1 && r.parts.thruster >= 2)) errs.push(`receptura: reactor_core ${r.parts.reactor_core || 0}, thruster ${r.parts.thruster || 0}`);
  }
  if (!(hullCells(f, 0).count > 10)) errs.push('komórek belek ≤ 10');
  const cls = hullDesignClass(f);
  if (key !== 'empty') {
    if (!(d.bridgeLevel >= 1 && d.coreLevel >= 1)) errs.push(`poziomy w projekcie: mostek ${d.bridgeLevel}, rdzeń ${d.coreLevel} (wpis cls / HD_PRESET_CLASS)`);
    if (!HD_PRESET_OUTSIDE_LADDER.includes(key)) {
      if (cls.check.issues.length) errs.push(`limity klasy: ${cls.check.issues.map((i) => i.text).join(' | ')}`);
      const want = classForHull(f.area, cls.mounts, d.role);
      if (d.bridgeLevel !== want) errs.push(`klasa ${d.bridgeLevel} ≠ z powierzchni ${want} (pow. ${Math.round(f.area)} j²)`);
    }
  }
  if (key !== 'empty' && f.pipeNet) {
    const c = pipeNetworkCheck(f.pipeNet, f);
    if (f.pipeNet.stats.unrouted) errs.push(`sieć: ${f.pipeNet.stats.unrouted} tras bez przebiegu`);
    if (c.freeEnds || c.outside || c.unpowered.length || c.unfueled.length) {
      errs.push(`sieć: wolne końce ${c.freeEnds}, poza obrysem ${c.outside}, bez prądu ${c.unpowered.map((i) => f.expanded.modules[i].type).join('/') || 0}, bez paliwa ${c.unfueled.map((i) => f.expanded.modules[i].type).join('/') || 0}`);
    }
  }
  const mods = f.expanded.modules.length, decals = f.expanded.decals.length;
  if (mods > HD_COMPOSER_LIMITS.modules) errs.push(`modułów po lustrze ${mods} > ${HD_COMPOSER_LIMITS.modules} (kompozytor)`);
  if (decals > HD_COMPOSER_LIMITS.decals) errs.push(`naklejek po lustrze ${decals} > ${HD_COMPOSER_LIMITS.decals} (kompozytor)`);
  const L = f.bounds.maxX - f.bounds.minX, Wd = f.bounds.maxY - f.bounds.minY;
  const byType = {};
  for (const m of f.expanded.modules) byType[m.type] = (byType[m.type] || 0) + 1;
  const ms = Math.round(performance.now() - t0);
  console.log(`${errs.length ? '✗' : '✓'} ${key} — ${d.name}: ${L.toFixed(0)} × ${Wd.toFixed(0)} j., pow. ${Math.round(f.area)} j², ` +
    `klasa ${cls.levels.bridge} ${cls.label} / R${cls.levels.core}, rola ${d.role}, detal ${d.detail}, siatka ${d.grid}, ` +
    `ładunek ${r.cargo.containers} kont. + ${r.cargo.tankTonnes} t w zbiornikach = ${r.cargo.tonnes} t, zapas mocy ${Math.round(cls.power.spareFrac * 100)}%, ` +
    `brył ${d.shapes.length}, modułów ${mods}, naklejek ${decals}, ${ms} ms`);
  console.log(`   moduły: ${Object.entries(byType).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (mask) {
    // IoU sylwetki (rama projektu) z maską podkładu na siatce ~1500 próbek wzdłuż
    const b = f.bounds, mb = mask.box;
    const X0 = Math.min(b.minX, mb.minX), X1 = Math.max(b.maxX, mb.maxX), Y0 = Math.min(b.minY, mb.minY), Y1 = Math.max(b.maxY, mb.maxY);
    const st = Math.max(0.5, (X1 - X0) / 1500);
    let inter = 0, uni = 0, onlyD = 0, onlyM = 0;
    for (let y = Y0; y <= Y1; y += st) for (let x = X0; x <= X1; x += st) {
      const a = sampleHullField(f, 0, x, y) < 0, m = mask.at(x, y);
      if (a && m) inter++; if (a || m) uni++; if (a && !m) onlyD++; if (m && !a) onlyM++;
    }
    console.log(`   podkład: IoU ${(inter / Math.max(1, uni)).toFixed(3)} (tylko projekt ${(onlyD / Math.max(1, uni) * 100).toFixed(1)}%, tylko podkład ${(onlyM / Math.max(1, uni) * 100).toFixed(1)}%), podkład ${mb.minX.toFixed(0)}…${mb.maxX.toFixed(0)} × ${mb.minY.toFixed(0)}…${mb.maxY.toFixed(0)} j., pow. ${Math.round(mask.area)} j²`);
  }
  for (const e of errs) console.log(`   ✗ ${e}`);
  if (errs.length) failed++;
  if (opt.png) {
    const dir = resolve(repo, String(opt.png));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${key}.png`);
    planPng(f, file, { px: opt.px ? Number(opt.px) : 0, width: Number(opt.szer || 1600), mask });
    console.log(`   podgląd: ${file}`);
  }
}
process.exit(failed ? 1 : 0);

/**
 * Podgląd CPU: poziomy (rama / płyty / nadbudówka / mostek), moduły (obrysy w barwie typu, siatka kontenerów), trasy sieci;
 * z podkładem — czerwony obrys maski (kadr obejmuje i projekt, i podkład).
 */
function planPng(f, file, { px = 0, width = 1600, mask = null }) {
  const b0 = f.bounds, pad = 12;
  const b = mask ? {
    minX: Math.min(b0.minX, mask.box.minX), maxX: Math.max(b0.maxX, mask.box.maxX),
    minY: Math.min(b0.minY, mask.box.minY), maxY: Math.max(b0.maxY, mask.box.maxY)
  } : b0;
  const L = b.maxX - b.minX, Wd = b.maxY - b.minY;
  const s = px > 0 ? px : Math.max(0.25, Math.min(24, (width - 2 * pad) / L));
  const W = Math.ceil(L * s + 2 * pad), H = Math.ceil(Wd * s + 2 * pad);
  const data = new Uint8Array(W * H * 4);
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const LV = ['#2b2e31', '#7d8288', '#aeb3b7', '#e2e4e6'].map(hex), BG = hex('#0b0d10');
  const toW = (ix, iy) => [b.minX + (ix - pad + 0.5) / s, b.minY + (iy - pad + 0.5) / s];
  const toP = (x, y) => [(x - b.minX) * s + pad, (y - b.minY) * s + pad];
  for (let iy = 0; iy < H; iy++) {
    for (let ix = 0; ix < W; ix++) {
      const [x, y] = toW(ix, iy);
      let c = BG;
      for (let lv = 3; lv >= 0; lv--) if (sampleHullField(f, lv, x, y) < 0) { c = LV[lv]; break; }
      const o = (iy * W + ix) * 4;
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
  }
  const put = (x, y, c) => {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
    const o = (iy * W + ix) * 4;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2];
  };
  const line = (a, c2, c) => {
    const n = Math.max(1, Math.ceil(Math.hypot(c2[0] - a[0], c2[1] - a[1])));
    for (let i = 0; i <= n; i++) put(a[0] + (c2[0] - a[0]) * i / n, a[1] + (c2[1] - a[1]) * i / n, c);
  };
  const poly = (pts, c, close = true) => { for (let i = 0; i < pts.length - (close ? 0 : 1); i++) line(pts[i], pts[(i + 1) % pts.length], c); };
  // podkład: obrys maski (piksel w masce z sąsiadem poza nią) — czerwony
  if (mask) {
    const red = hex('#ff3a3a');
    for (let iy = 1; iy < H - 1; iy++) {
      for (let ix = 1; ix < W - 1; ix++) {
        const [x, y] = toW(ix, iy);
        if (!mask.at(x, y)) continue;
        const e = 1 / s;
        if (!mask.at(x + e, y) || !mask.at(x - e, y) || !mask.at(x, y + e) || !mask.at(x, y - e)) put(ix, iy, red);
      }
    }
  }
  // trasy sieci: kable — złote, paliwo — pomarańczowe
  for (const run of f.pipeNet?.runs || []) {
    const c = hex(run.net === 'power' ? '#d8c060' : (run.net === 'manual' ? '#9a9a9a' : '#ff7a3c'));
    for (const pl of run.polys || []) poly(pl.map(([x, y]) => toP(x, y)), c, false);
  }
  const COL = {
    engine: '#ff8c1a', reactor: '#ffd400', bridge: '#3fa9ff', fuel_tank: '#ff4f4f', thruster_side: '#59e05a',
    cargo: '#c58cff', cargo_tank: '#00d6c4', mount: '#ff3fb0', turret_s: '#ff3fb0', turret_m: '#ff3fb0', turret_l: '#ff3fb0'
  };
  const D = f.expanded.design.detail;
  for (const m of f.expanded.modules) {
    const c = hex(COL[m.type] || '#9aa0a6');
    const cs = Math.cos(m.rot || 0), sn = Math.sin(m.rot || 0);
    const T = (lx, ly) => toP(m.x + lx * cs - ly * sn, m.y + lx * sn + ly * cs);
    if (m.r && !m.w) {
      const pts = [];
      for (let k = 0; k < 32; k++) pts.push(T(Math.cos(k / 32 * 2 * Math.PI) * m.r, Math.sin(k / 32 * 2 * Math.PI) * m.r));
      poly(pts, c);
    } else {
      const w = m.w || 4, h = m.h || 4;
      poly([T(-w, -h), T(w, -h), T(w, h), T(-w, h)], c);
      if (m.type === 'cargo' || m.type === 'cargo_tank') {
        const g = hullCargoGrid(m.type === 'cargo' ? m : { w, h }, D);
        const tx = g.nx * g.pitchX - 1, ty = g.ny * g.pitchY - 1;
        for (let i = 0; i < g.nx; i++) {
          for (let j = 0; j < g.ny; j++) {
            const cx = -tx / 2 + g.cellL / 2 + i * g.pitchX, cy = -ty / 2 + g.cellW / 2 + j * g.pitchY;
            poly([T(cx - g.cellL / 2, cy - g.cellW / 2), T(cx + g.cellL / 2, cy - g.cellW / 2), T(cx + g.cellL / 2, cy + g.cellW / 2), T(cx - g.cellL / 2, cy + g.cellW / 2)], c.map((v) => v * 0.7));
          }
        }
      }
    }
  }
  writePng(file, { width: W, height: H, data });
}
