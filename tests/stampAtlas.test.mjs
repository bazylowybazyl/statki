// Atlas stempli napisów radaru (src/ui/radar/stampAtlas.js, 2026-10-17): przydział miejsc bez nakładania, powrót
// wolnych miejsc klasy, wyparcie najdawniej użytego (właściciel traci miejsce), za duże — poza atlasem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { StampAtlas, STAMP_ATLAS_GUTTER } from '../src/ui/radar/stampAtlas.js';

const overlap = (a, b) => a.page === b.page
  && a.x - STAMP_ATLAS_GUTTER < b.x + b.cw + STAMP_ATLAS_GUTTER && b.x - STAMP_ATLAS_GUTTER < a.x + a.cw + STAMP_ATLAS_GUTTER
  && a.y - STAMP_ATLAS_GUTTER < b.y + b.ch + STAMP_ATLAS_GUTTER && b.y - STAMP_ATLAS_GUTTER < a.y + a.ch + STAMP_ATLAS_GUTTER;

test('atlas stempli: miejsca bez nakładania (z marginesem), w granicach strony, w klasie ≥ rozmiar', () => {
  const at = new StampAtlas({ pageW: 256, pageH: 128, maxPages: 4, makePage: () => ({}) });
  const slots = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 60; i++) {
    const w = 8 + Math.floor(rnd() * 90), h = 8 + Math.floor(rnd() * 30);
    const owner = { slot: null };
    const s = at.alloc(w, h, owner);
    if (!s) continue;
    owner.slot = s;
    assert.ok(s.cw >= w && s.ch >= h);
    assert.ok(s.x - STAMP_ATLAS_GUTTER >= 0 && s.y - STAMP_ATLAS_GUTTER >= 0);
    assert.ok(s.x + s.cw + STAMP_ATLAS_GUTTER <= 256 && s.y + s.ch + STAMP_ATLAS_GUTTER <= 128);
    slots.push(s);
  }
  const live = slots.filter((s, i) => slots.indexOf(s) === i && s.owner && s.owner.slot === s);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) assert.ok(!overlap(live[i], live[j]), `miejsca ${i} i ${j} nachodzą`);
  assert.ok(at.pages.length <= 4);
});

test('atlas stempli: zwolnione miejsce wraca do klasy, pełny atlas wypiera najdawniej użyte', () => {
  const at = new StampAtlas({ pageW: 70, pageH: 16, maxPages: 1, makePage: () => ({}) });
  const a = { slot: null }, b = { slot: null }, c = { slot: null };
  a.slot = at.alloc(30, 10, a);
  b.slot = at.alloc(30, 10, b);
  assert.ok(a.slot && b.slot && a.slot !== b.slot);
  at.release(a.slot);
  const a2 = { slot: null };
  a2.slot = at.alloc(28, 9, a2);
  assert.equal(a2.slot, a.slot, 'ta sama klasa — miejsce z listy wolnych');
  // strona pełna (dwa miejsca 32 × 12 + margines w 70 × 16): trzecie wypiera najdawniej użyte (a2 — b dotknięte)
  at.touch(b.slot);
  c.slot = at.alloc(25, 12, c);
  assert.equal(c.slot, a.slot);
  assert.equal(a2.slot, null, 'właściciel wypartego miejsca traci je (przepieczenie przy następnym użyciu)');
  assert.equal(at.stats.evictions, 1);
});

test('atlas stempli: za duży stempel poza atlasem', () => {
  const at = new StampAtlas({ pageW: 512, pageH: 256, maxPages: 2, makePage: () => ({}) });
  assert.equal(at.alloc(300, 20, {}), null);
  assert.equal(at.alloc(40, 80, {}), null);
  assert.equal(at.stats.overflow, 2);
});
