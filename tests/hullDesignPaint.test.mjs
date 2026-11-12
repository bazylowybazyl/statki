// Malowanie barwami nacji (warstwa barw kreatora): palety frakcji gry bez świecącego albedo (hullGlowMask), emblematy
// nacji (piraci bez czaszek), pędzel na klockach i kasztelach (raster na siatce pola) bez wpływu na geometrię.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HD_PALETTES, HD_PALETTE_KEYS, HD_PALETTE_ROWS, HD_FACTION_PALETTE, HD_PALETTE_EMBLEM, hullDesignShapeKey, hullDesignLookKey, normalizeHullDesign,
  expandHullDesign, expandHullDecals
} from '../src/game/hullDesign/hullDesignSchema.js';
import { HD_EMBLEMS } from '../src/game/hullDesign/hullEmblems.js';
import { HD_PAINT_SLOTS, normalizeBlock } from '../src/game/hullDesign/hullDesignBlocks.js';
import { hullPaintLayer } from '../src/game/hullDesign/hullDesignPaint.js';
import { createHullDesignBuilder } from '../src/game/hullDesign/hullDesignBuild.js';
import { hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { FACTION } from '../src/data/factions.js';
import { glowSafeLinear } from '../src/3d/hullDesign/hullComposer.js';

const lin = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
};
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** hullGlowMask (src/3d/hullLighting.tsl.js) na CPU. */
const glowMask = (c) => ss(0.42, 0.55, c[2]) * (1 - ss(0.15, 0.25, c[0]));

test('palety: każda frakcja gry ma paletę, wszystkie wiersze, nic poza oknami nie świeci w grze', () => {
  for (const f of Object.values(FACTION)) assert.ok(HD_PALETTES[HD_FACTION_PALETTE[f]], `frakcja ${f}: paleta`);
  for (const k of HD_PALETTE_KEYS) {
    const p = HD_PALETTES[k];
    for (const r of HD_PALETTE_ROWS) {
      assert.match(p[r], /^#[0-9a-f]{6}$/i, `${k}.${r}`);
      if (r === 'window') continue;
      assert.equal(glowMask(lin(p[r])), 0, `${k}.${r} ${p[r]} świeci (hullGlowMask)`);
    }
  }
  // ściszenie barw spoza palety (naklejki, pędzel „własna barwa”): niebieski zawsze bez poświaty
  for (const hex of ['#0ea5e9', '#38bdf8', '#3050ff', '#4a6cff', '#8b5cf6', '#2060a0']) {
    assert.equal(glowMask(glowSafeLinear(lin(hex))), 0, `${hex} po glowSafeLinear`);
  }
});

test('emblematy nacji: istnieją, piraci mają własny znak (bez czaszki)', () => {
  for (const [k, id] of Object.entries(HD_PALETTE_EMBLEM)) {
    assert.ok(HD_PALETTES[k], k);
    if (id) assert.ok(HD_EMBLEMS[id], `${k}: emblemat ${id}`);
  }
  assert.equal(HD_PALETTE_EMBLEM.terra, 'eagle');
  assert.ok(HD_PALETTE_EMBLEM.pirate && !/skull|czaszk/i.test(HD_PALETTE_EMBLEM.pirate + HD_EMBLEMS[HD_PALETTE_EMBLEM.pirate].label));
});

test('pędzel: walidacja, warstwa barw poza kluczem kształtu i poza geometrią budowy', async () => {
  assert.equal(normalizeBlock({ kind: 'block', paint: 'accent' }).paint, 'accent');
  assert.equal(normalizeBlock({ kind: 'block', paint: '#AABBCC' }).paint, '#aabbcc');
  assert.equal(normalizeBlock({ kind: 'block', paint: 'zielony' }).paint, undefined);
  assert.equal(normalizeBlock({ kind: 'block', op: 'cut', paint: 'accent' }).paint, undefined);
  for (const s of HD_PAINT_SLOTS) assert.ok(HD_PALETTE_ROWS.includes(s), s);
  const d = hullDesignPreset('custos');
  const k0 = hullDesignShapeKey(normalizeHullDesign(d));
  const b = createHullDesignBuilder();
  const r0 = await b.run(d, {});
  assert.equal(r0.field.packed.paint, null);
  const bl = d.shapes.filter((s) => s.kind === 'block' && s.level >= 1 && Math.abs(s.y) > 2)[0];
  bl.paint = 'accent';
  d.palette = 'mars';
  d.decals.push({ kind: 'stripe', x0: -20, y0: 4, x1: 20, y1: 4, w: 2, color: '#b8342a' });
  assert.equal(hullDesignShapeKey(normalizeHullDesign(d)), k0, 'barwy, pędzel i naklejki poza kluczem kształtu');
  const r1 = await b.run(d, {});
  assert.equal(r1.keys.geo, r0.keys.geo, 'pędzel nie zmienia geometrii');
  assert.equal(r1.keys.power, r0.keys.power, 'ani sieci');
  const pl = r1.field.packed.paint;
  assert.deepEqual(pl.table, ['accent']);
  // środek klocka i jego kopii lustra pomalowany, daleko od niego — nie
  const g = r1.field.grid;
  const at = (x, y) => { const i = Math.floor((x - g.x0) * g.res), j = Math.floor((y - g.y0) * g.res); return [pl.data[(j * g.w + i) * 4], pl.data[(j * g.w + i) * 4 + 3]]; };
  assert.deepEqual(at(bl.x, bl.y), [1, 255]);
  assert.deepEqual(at(bl.x, -bl.y), [1, 255], 'kopia lustra');
  assert.deepEqual(at(bl.x + bl.w * 2 + 30, bl.y), [0, 0]);
  // naklejki warstwy barw = naklejki pełnego rozwinięcia
  const nd = normalizeHullDesign(d);
  const ex = expandHullDesign(nd);
  assert.deepEqual(expandHullDecals(nd, ex.decals.filter((q) => q.part)), ex.decals);
  // ten sam raster dla tej samej siatki (strona liczy go sama w ścieżce barw)
  assert.equal(hullPaintLayer(nd, g).key, pl.key);
});

test('wygląd kompozytora (faza, profil fazy, panele, okna) poza kluczem wyglądu; detal i sieć — w nim', () => {
  const d = normalizeHullDesign(hullDesignPreset('bellator'));
  const k = hullDesignLookKey(d), s0 = hullDesignShapeKey(d);
  for (const [f, v] of [['bevel', 1.7], ['round', 1 - (d.round ?? 0)], ['panels', 0.3], ['windows', (d.windows ?? 1) > 0.5 ? 0 : 1]]) {
    const e = normalizeHullDesign({ ...d, [f]: v });
    assert.equal(hullDesignLookKey(e), k, `${f}: ten sam klucz wyglądu`);
    assert.notEqual(hullDesignShapeKey(e), s0, `${f}: inny klucz kształtu (mapy kompozytora)`);
  }
  assert.notEqual(hullDesignLookKey(normalizeHullDesign({ ...d, detail: d.detail * 1.1 })), k, 'detal zmienia pole');
  assert.notEqual(hullDesignLookKey(normalizeHullDesign({ ...d, pipeNet: { density: 0.5 } })), k, 'gęstość sieci zmienia sieć');
});
