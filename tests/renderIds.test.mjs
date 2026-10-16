// RW-03 (docs/PLAN-render-worker.md § 3.2): sloty renderu — slot + generacja, zwalnianie po zniknięciu z list migawki.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderIdSpace, createRenderIds } from '../src/render/renderIds.js';

test('slot = najmniejszy wolny, generacja rośnie przy zwolnieniu, nigdy 0', () => {
  const sp = new RenderIdSpace('t', { capacity: 4 });
  const a = {}, b = {}, c = {}, d = {};
  sp.begin();
  assert.equal(sp.slotOf(a), 0);
  assert.equal(sp.slotOf(b), 1);
  assert.equal(sp.slotOf(c), 2);
  assert.equal(sp.slotOf(a), 0, 'ten sam obiekt z drugiej listy — ten sam slot');
  sp.end();
  const genB = sp.gen(1);
  assert.equal(genB, 1);
  sp.begin();
  sp.slotOf(a);
  sp.slotOf(c);
  assert.equal(sp.end(), 1, 'b zniknął ze wszystkich list');
  assert.equal(sp.gen(1), 2);
  assert.equal(sp.isLive(1, genB), false);
  assert.equal(sp.objectAt(1), null);
  sp.begin();
  sp.slotOf(a);
  sp.slotOf(c);
  assert.equal(sp.slotOf(d), 1, 'nowy obiekt bierze najmniejszy wolny slot');
  assert.equal(sp.gen(1), 2);
  assert.ok(sp.isLive(1, 2));
  sp.end();
  assert.equal(sp.peek(b), -1);
  assert.equal(sp.peek(d), 1);
  // generacja zawija się z pominięciem 0
  sp.generation[1] = 0xffffffff;
  sp.begin(); sp.slotOf(a); sp.slotOf(c); sp.end();
  assert.equal(sp.gen(1), 1);
});

test('wzrost pojemności zachowuje sloty i generacje; zakres zwija się z końca', () => {
  const sp = new RenderIdSpace('t', { capacity: 4 });
  const objs = Array.from({ length: 300 }, (_, i) => ({ i }));
  sp.begin();
  objs.forEach((o, i) => assert.equal(sp.slotOf(o), i));
  sp.end();
  assert.ok(sp.capacity >= 300);
  assert.equal(sp.highWater, 300);
  // zostawiamy co trzeci i pierwsze 10
  sp.begin();
  objs.forEach((o, i) => { if (i < 10 || i % 3 === 0) sp.slotOf(o); });
  sp.end();
  assert.equal(sp.highWater, 298, 'ostatni żywy: 297');
  for (let i = 0; i < 300; i++) {
    const live = i < 10 || i % 3 === 0;
    assert.equal(sp.peek(objs[i]), live ? i : -1);
    assert.equal(sp.gen(i), live ? 1 : 2);
  }
  // nowe obiekty zapełniają dziury od najmniejszej
  sp.begin();
  objs.forEach((o, i) => { if (i < 10 || i % 3 === 0) sp.slotOf(o); });
  const fresh = Array.from({ length: 5 }, () => ({}));
  assert.deepEqual(fresh.map((o) => sp.slotOf(o)), [10, 11, 13, 14, 16]);
  sp.end();
  // wszystko znika — zakres 0, kolejny przydział od 0 z generacją > 1
  const liveBefore = sp.count;
  sp.begin();
  assert.equal(sp.end(), liveBefore);
  assert.equal(sp.count, 0);
  assert.equal(sp.highWater, 0);
  sp.begin();
  assert.equal(sp.slotOf({}), 0);
  assert.ok(sp.gen(0) > 1);
  sp.end();
});

test('stamp: obiekt użyty ponownie dostaje nową generację w tym samym slocie', () => {
  const sp = new RenderIdSpace('t');
  const pooled = {};
  sp.begin();
  assert.equal(sp.slotOf(pooled, 101), 0);
  const g = sp.gen(0);
  assert.equal(sp.slotOf(pooled, 101), 0);
  assert.equal(sp.gen(0), g);
  sp.end();
  sp.begin();
  assert.equal(sp.slotOf(pooled, 102), 0);
  assert.equal(sp.gen(0), g + 1);
  sp.end();
});

test('retain: zasób bez odwołania przez kilka klatek zostaje, potem wraca', () => {
  const sp = new RenderIdSpace('res', { retain: 3 });
  const img = {};
  sp.begin(); sp.slotOf(img); sp.end();
  for (let f = 0; f < 2; f++) { sp.begin(); assert.equal(sp.end(), 0); }
  sp.begin();
  assert.equal(sp.end(), 1);
  assert.equal(sp.peek(img), -1);
});

test('release(): zwolnienie od razu; przestrzenie createRenderIds niezależne', () => {
  const ids = createRenderIds();
  const ent = {}, body = {}, shot = {}, img = {};
  ids.begin();
  assert.equal(ids.entities.slotOf(ent), 0);
  assert.equal(ids.bodies.slotOf(body), 0);
  assert.equal(ids.shots.slotOf(shot), 0);
  assert.equal(ids.resources.slotOf(img), 0);
  ids.end();
  // wrak dziedziczy ciało rodzica: encja nowa, ciało to samo
  const wreck = {};
  ids.begin();
  assert.equal(ids.entities.slotOf(wreck), 1);
  assert.equal(ids.bodies.slotOf(body), 0);
  assert.equal(ids.end(), 2, 'encja-rodzic i pocisk zniknęły; zasób trzymany (retain)');
  assert.equal(ids.entities.peek(ent), -1);
  assert.equal(ids.bodies.gen(0), 1);
  assert.equal(ids.resources.peek(img), 0);
  assert.ok(ids.entities.release(wreck));
  assert.equal(ids.entities.release(wreck), false);
  assert.equal(ids.entities.count, 0);
});

test('losowa symulacja: para (slot, generacja) nigdy nie wskazuje dwóch obiektów, sloty zwarte', () => {
  const sp = new RenderIdSpace('t', { capacity: 8 });
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  let live = [];
  const owners = new Map(); // "slot:gen" → obiekt
  for (let frame = 0; frame < 3000; frame++) {
    // narodziny i śmierci
    const born = Math.floor(rnd() * 6);
    for (let i = 0; i < born; i++) live.push({ id: frame * 10 + i });
    live = live.filter(() => rnd() > 0.04);
    sp.begin();
    // dwie listy migawki z częścią wspólną
    for (const o of live) {
      const s = sp.slotOf(o);
      if (rnd() < 0.3) assert.equal(sp.slotOf(o), s);
      const key = `${s}:${sp.gen(s)}`;
      const prev = owners.get(key);
      if (prev === undefined) owners.set(key, o);
      else assert.equal(prev, o, `para ${key} ponownie przydzielona`);
    }
    sp.end();
    assert.equal(sp.count, live.length);
    assert.ok(sp.highWater <= Math.max(live.length * 3, 8), `zakres ${sp.highWater} przy ${live.length} żywych`);
  }
});

test('renderSlots: jeden cykl na klatkę — powtórne begin / end bez skutku; odwołania z fizyki i renderu w tej samej epoce', async () => {
  const { RenderSlots, beginRenderSlotsFrame, endRenderSlotsFrame, renderSlotsFrameOpen } = await import('../src/render/renderSlots.js');
  const ent = {}, other = {};
  beginRenderSlotsFrame();
  assert.ok(renderSlotsFrameOpen());
  const s = RenderSlots.entities.slotOf(ent);          // rozkaz z kroku fizyki
  beginRenderSlotsFrame();                             // drugi użytkownik w tej klatce — bez nowej epoki
  RenderSlots.entities.slotOf(other);                  // migawka
  assert.equal(endRenderSlotsFrame(), 0, 'nic nie zwolnione — oba odwołania w tej samej epoce');
  assert.equal(endRenderSlotsFrame(), 0);
  assert.equal(RenderSlots.entities.peek(ent), s);
  beginRenderSlotsFrame();
  RenderSlots.entities.slotOf(other);
  assert.equal(endRenderSlotsFrame(), 1, 'encja bez odwołania w klatce — zwolniona');
  assert.equal(RenderSlots.entities.peek(ent), -1);
});
