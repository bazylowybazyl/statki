import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWreckFields, findWreckFieldNear, WRECK_FIELD_CONFIG } from '../src/game/wreckFields.js';
import {
  drawWreckFieldMarkers,
  describeWreckField,
  describeFieldWreck,
  nearestFieldWrecks
} from '../src/ui/wreckFieldMarkers.js';
import { buildNormalCommandMenuItems, buildRtsCommandMenuItems } from '../src/game/worldCommandMenu.js';
import { readIndexHtml, sliceFunction } from './helpers/indexSource.mjs';

function cold(x, y, summary = {}) {
  return {
    x, y, radius: 40, visual: { spriteScale: 2 }, isWreck: true, isCold: true,
    _coldSnapshot: {
      summary: { label: 'Wrak', hullClass: 'frigate', liveHexes: 100, aliveFrac: 0.5, weapons: 0, hasCargo: false, hasScrap: true, ...summary }
    }
  };
}

test('pola: łańcuch wraków bliżej niż linkRadius to jedno pole, dalekie osobno', () => {
  const link = WRECK_FIELD_CONFIG.linkRadius;
  // Łańcuch A–B–C (co 0,9·link) = jedno pole, choć A–C > link. D daleko, E samotny.
  const a = cold(0, 0, { weapons: 2 });
  const b = cold(link * 0.9, 0, { hasCargo: true, hullClass: 'destroyer' });
  const c = cold(link * 1.8, 0);
  const d = cold(100000, 0);
  const e = cold(100000 + link * 3, 0, { hasScrap: false });
  const fields = buildWreckFields([a, b, c, d, e, { dead: true, x: 1, y: 1 }]);
  assert.equal(fields.length, 3);
  const main = fields[0];
  assert.equal(main.count, 3, 'pola od największego');
  assert.deepEqual(new Set(main.members), new Set([a, b, c]));
  assert.ok(Math.abs(main.x - link * 0.9) < 1e-9);
  assert.equal(main.y, 0);
  assert.ok(main.radius >= link * 0.9 + 80, 'promień obejmuje skrajne wraki z ich promieniem świata');
  assert.deepEqual(main.summary, {
    weapons: 2, cargoWrecks: 1, scrapWrecks: 3, liveHexes: 300, classes: { frigate: 2, destroyer: 1 }
  });
  for (const w of [a, b, c]) assert.equal(w._coldFieldId, main.id);
  assert.notEqual(d._coldFieldId, e._coldFieldId);
  assert.equal(fields.find(f => f.members.includes(e)).radius, WRECK_FIELD_CONFIG.minRadius, 'samotny wrak: promień minimalny');

  // id stabilne między przebudowami (klucz najstarszego wraku pola).
  const again = buildWreckFields([c, b, a]);
  assert.equal(again[0].id, main.id);
  assert.equal(buildWreckFields([]).length, 0);

  assert.equal(findWreckFieldNear(fields, link * 0.9, 500, 0), main);
  assert.equal(findWreckFieldNear(fields, 50000, 0, 0), null);
  assert.equal(findWreckFieldNear(fields, 50000, 0, 60000), main, 'z zasięgiem — najbliższe środkiem');
});

function recordingCtx() {
  const calls = [];
  const texts = [];
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop === 'texts') return texts;
      if (prop === 'calls') return calls;
      if (prop === 'fillText') return (text, x, y) => texts.push({ text, x, y });
      if (prop in target) return target[prop];
      return (...args) => calls.push([prop, ...args]);
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
  return ctx;
}

test('CIC: znacznik pola w kadrze, poza kadrem nic; po zbliżeniu lista najbliższych wraków', () => {
  const fieldWrecks = [
    cold(0, 0, { label: 'Fregata TN', aliveFrac: 0.42, weapons: 3 }),
    cold(900, 0, { label: 'Niszczyciel', aliveFrac: 0.8, hasCargo: true }),
    cold(1800, 0, { label: 'Dalszy', aliveFrac: 0.1 })
  ];
  const fields = buildWreckFields(fieldWrecks);
  const far = buildWreckFields([cold(900000, 0)]);
  const all = [...fields, ...far];
  const zoom = 0.05;
  const view = {
    toScreen: (wx, wy) => ({ x: 500 + wx * zoom, y: 400 + wy * zoom }),
    zoom, W: 1000, H: 800, shipX: 100, shipY: 0, isSystemScale: false,
    formatDistance: (d) => `${Math.round(d)}u`
  };
  const ctx = recordingCtx();
  const near = drawWreckFieldMarkers(ctx, all, view);
  assert.equal(near, fields[0]);
  const texts = ctx.texts.map(t => t.text);
  assert.ok(texts.includes('POLE WRAKÓW · 3'));
  assert.ok(!texts.includes('POLE WRAKÓW · 1'), 'pole poza kadrem nie jest rysowane');
  assert.ok(texts.includes(describeWreckField(fields[0])));
  assert.equal(describeWreckField(fields[0]), '3 dz. · ładunek · złom');
  // Lista: najbliższe statkowi (x = 100) najpierw.
  const listRows = texts.filter(t => t.includes(' · 100u') || t.includes(' · 800u') || t.includes(' · 1700u'));
  assert.deepEqual(listRows, [
    'Fregata TN · 42% · 3 dz. · 100u',
    'Niszczyciel · 80% · ładunek · 800u',
    'Dalszy · 10% · 1700u'
  ]);
  assert.equal(describeFieldWreck({ _salvage: { label: 'X' } }), 'X');
  assert.deepEqual(nearestFieldWrecks(fields[0], 1800, 0, 1).map(r => r.wreck), [fieldWrecks[2]]);

  // Statek daleko od pól: bez listy.
  const ctx2 = recordingCtx();
  assert.equal(drawWreckFieldMarkers(ctx2, all, { ...view, shipX: 400000 }), null);
  assert.equal(drawWreckFieldMarkers(recordingCtx(), [], view), null);
});

test('menu: zimny wrak — „WYCIĄGNIJ (HOL)”; RTS dostaje akcje wraku na końcu (MOVE zostaje pierwszy)', () => {
  const hot = { isWreck: true };
  const frozen = { isWreck: true, isCold: true };
  assert.deepEqual(buildNormalCommandMenuItems({ targetEntity: hot }).slice(0, 2).map(i => i.label), ['SALVAGE', 'TOW']);
  const coldItems = buildNormalCommandMenuItems({ targetEntity: frozen });
  assert.deepEqual(coldItems.slice(0, 2).map(i => [i.action, i.label]), [['salvage', 'SALVAGE'], ['tow', 'WYCIĄGNIJ (HOL)']]);
  const rts = buildRtsCommandMenuItems({ selectedCount: 2, targetEntity: frozen });
  assert.equal(rts[0].action, 'move-formation');
  assert.deepEqual(rts.slice(-2).map(i => i.action), ['salvage', 'tow']);
  assert.equal(rts.at(-1).label, 'WYCIĄGNIJ (HOL)');
  assert.ok(!buildRtsCommandMenuItems({ selectedCount: 1 }).some(i => i.action === 'tow'), 'bez wraku — bez akcji odzysku');
});

test('wpięcie: pola po kroku zimnych, RTS odzysk przez ścieżkę gracza, CIC rysuje pola', () => {
  const src = readIndexHtml();
  const physics = sliceFunction(src, 'function physicsStep(');
  assert.ok(physics.indexOf('if (runFrameLogic) refreshColdWreckFields(frameLogicDt);') >
    physics.indexOf('if (runFrameLogic) coldWreckSystem.step(frameLogicDt);'));
  assert.match(sliceFunction(src, 'function refreshColdWreckFields(dt)'), /coldWreckSystem\.version === _coldFieldsVersion \|\| _coldFieldsTimer > 0/);
  assert.match(src, /buildRtsCommandMenuItems\(\{ selectedCount, targetEntity \}\)/);
  const rtsStart = src.indexOf('function executeRtsWorldCommandAction(');
  const rts = src.slice(rtsStart, src.indexOf('\n    function ', rtsStart + 10));
  assert.match(rts, /if \(action === 'salvage' \|\| action === 'tow'\) \{\s*executeNormalWorldCommandAction\(action, point, targetEntity, opts\);\s*return;/);
  const cic = readFileSync(new URL('../src/ui/cicDisplay.js', import.meta.url), 'utf8');
  assert.match(cic, /drawWreckFieldMarkers\(ctx, window\.coldWreckFields, \{/);
});
