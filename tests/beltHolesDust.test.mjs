// Wyrwy po wydobyciu rozrzedzają też mgłę, pył i cień pól (decyzja użytkownika 2026-10-22: „tam, gdzie nie ma
// asteroid, nie ma też mgły i pyłu”): makro-próbka pola niesie mnożnik wyrwy, cień pól przelicza się w miejscu
// (FieldSunOcclusion.recomputeRect) tak samo jak liczony od zera, a obraz (sektory wspólne) widzi to samo co gra.
import test from 'node:test';
import assert from 'node:assert/strict';

import { AsteroidBeltField } from '../src/game/asteroidBeltField.js';
import { FieldSunOcclusion } from '../src/game/asteroidFieldLight.js';
import { BeltWorld } from '../src/game/beltWorld.js';
import { GiantRock, buildGiantPlan } from '../src/game/asteroidGiants.js';

const AU = 42253.52;

function stubBuilder() {
  return () => ({ build(id, seed, x, y) { return { giant: new GiantRock(buildGiantPlan(id, seed), x, y), promise: new Promise(() => {}) }; } });
}

/** Najgęstszy punkt pasa głównego na okręgu 38,6 AU (rdzeń pola). */
function corePoint(field) {
  let best = null;
  for (let i = 0; i < 3600; i++) {
    const a = (i / 3600) * Math.PI * 2;
    const x = Math.cos(a) * 38.6 * AU;
    const y = Math.sin(a) * 38.6 * AU;
    const m = field.sampleMacro(x, y);
    if (!best || m.cluster > best.c) best = { x, y, c: m.cluster };
  }
  return best;
}

test('makro-próbka: mnożnik wyrwy (pusto w środku, 1 poza), miejsce na gaz = 0', () => {
  const field = new AsteroidBeltField({ auToWorld: AU });
  const p = corePoint(field);
  const before = field.sampleMacro(p.x, p.y);
  assert.equal(before.hole, 1);
  assert.equal(before.gas, 0);
  const cluster = before.cluster;
  field.setHoles([{ id: 'w1', x: p.x, y: p.y, r: 7000, depth: 1 }]);
  const m = field.sampleMacro(p.x, p.y);
  assert.equal(m.hole, 0, 'środek wyrwy');
  assert.equal(m.cluster, cluster, 'pole (skład, burze) bez zmian');
  assert.equal(field.sampleMacro(p.x + 20000, p.y).hole, 1, 'poza wyrwą');
  const edge = field.sampleMacro(p.x + 5200, p.y).hole;
  assert.ok(edge >= 0 && edge <= 1);
});

test('holesTouch: pamięci obrazu przebudowują się tylko przy wyrwie w zasięgu (prostokąt albo klin cienia)', () => {
  const field = new AsteroidBeltField({ auToWorld: AU });
  const r = 38.6 * AU;
  const seen = field.holeVersion;
  field.setHoles([{ id: 'w1', x: r, y: 0, r: 7000, depth: 1 }]);
  const box = (x, y, h = 5000) => [x - h, y - h, x + h, y + h];
  assert.equal(field.holesTouch(seen, ...box(r, 0)), true, 'kadr na wyrwie');
  assert.equal(field.holesTouch(seen, ...box(r + 60000, 0)), false, 'za wyrwą bez światła — mgła nie');
  assert.equal(field.holesTouch(seen, ...box(r + 60000, 0), true), true, 'za wyrwą (od słońca) — cień pól tak');
  assert.equal(field.holesTouch(seen, ...box(r - 60000, 0), true), false, 'przed wyrwą (od strony słońca)');
  assert.equal(field.holesTouch(seen, ...box(r + 60000, 80000), true), false, 'obok klina');
  assert.equal(field.holesTouch(seen, ...box(-r, 0), true), false, 'druga strona pasa');
  assert.equal(field.holesTouch(field.holeVersion, ...box(r, 0), true), false, 'nic nowego od tej wersji');
});

test('cień pól: recomputeRect = liczenie od zera z wyrwą; w wyrwie i za nią jaśniej', () => {
  const field = new AsteroidBeltField({ auToWorld: AU });
  const p = corePoint(field);
  const occ = new FieldSunOcclusion(field);
  occ.prefetch(p.x, p.y, 40000);
  const dirX = p.x / Math.hypot(p.x, p.y);
  const dirY = p.y / Math.hypot(p.x, p.y);
  const behind = { x: p.x + dirX * 15000, y: p.y + dirY * 15000 };
  const T0 = occ.transmittance(p.x, p.y);
  const Tb0 = occ.transmittance(behind.x, behind.y);
  field.setHoles([{ id: 'w1', x: p.x, y: p.y, r: 7000, depth: 1 }]);
  const res = occ.recomputeRect(p.x - 7000, p.y - 7000, p.x + 7000, p.y + 7000);
  assert.ok(res.columns > 0 && res.samples > 0, JSON.stringify(res));
  const fresh = new FieldSunOcclusion(field);
  fresh.prefetch(p.x, p.y, 40000);
  for (let k = -6; k <= 30; k++) {
    for (const off of [-9000, -3000, 0, 3000, 9000]) {
      const x = p.x + dirX * k * 5000 - dirY * off;
      const y = p.y + dirY * k * 5000 + dirX * off;
      assert.ok(Math.abs(occ.transmittance(x, y) - fresh.transmittance(x, y)) < 2e-3, `T w (${k}, ${off})`);
    }
  }
  assert.ok(occ.transmittance(p.x, p.y) > T0 + 0.01, `w wyrwie jaśniej: ${T0} → ${occ.transmittance(p.x, p.y)}`);
  assert.ok(occ.transmittance(behind.x, behind.y) > Tb0, 'za wyrwą jaśniej');
  assert.ok(res.x0 !== null && res.x1 > res.x0, 'prostokąt zmian');
});

test('świat pasa: wyrwa przelicza cień pól gry, obraz (sektory wspólne) widzi ten sam; koszt w lightStats', () => {
  const field0 = new AsteroidBeltField({ auToWorld: AU });
  const p = corePoint(field0);
  const bw = new BeltWorld({ planets: [], sun: { x: 0, y: 0 }, auToWorld: AU, createBuilder: stubBuilder() });
  bw.occlusion.prefetch(p.x, p.y, 40000);
  // Obraz: własna instancja pola i cienia z sektorami gry (jak asteroidBelt.js — world.onOcclusion → adoptSectors).
  const replica = bw.createFieldReplica();
  const view = new FieldSunOcclusion(replica);
  bw.onOcclusion(() => {});
  view.adoptSectors(bw.occlusion.exportSectors(), { precomputed: false });
  const T0 = view.transmittance(p.x, p.y);
  bw.setHoles([{ id: 'w1', x: p.x, y: p.y, r: 7000, depth: 1 }]);
  assert.equal(bw.lightStats.updates, 1);
  assert.ok(bw.lightStats.lastMs >= 0 && bw.lightStats.samples > 0);
  assert.ok(view.transmittance(p.x, p.y) > T0 + 0.01, 'obraz widzi jaśniejszą wyrwę bez kopii sektorów');
  assert.equal(view.transmittance(p.x, p.y), bw.occlusion.transmittance(p.x, p.y));
  assert.equal(replica.sampleMacro(p.x, p.y).hole, bw.field.sampleMacro(p.x, p.y).hole);
  // Zamknięcie wyrwy wraca do cienia sprzed (w granicach zaokrągleń float32).
  bw.setHoles([{ id: 'w1', depth: 0 }]);
  assert.ok(Math.abs(view.transmittance(p.x, p.y) - T0) < 2e-3);
});
