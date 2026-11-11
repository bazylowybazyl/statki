// Komputer złomiarski (reguła `zlomowanie`): plan cięcia wraku z komórek siatki belek i kinematyka wysięgnika.
import test from 'node:test';
import assert from 'node:assert/strict';

import { planScrapCuts, flipScrapPlan, scrapPlanPoint, scrapAxisExtent } from '../src/game/scrapPlan.js';
import { scrapArmElbow, scrapArmSegment, scrapRigFor, SCRAP_RIG_DEFAULT } from '../src/data/scrapRigs.js';

/** Prostokąt komórek [x0, x1) × [y0, y1) jako płaska tablica par. */
function rect(x0, y0, x1, y1, skip = null) {
  const out = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!skip || !skip(x, y)) out.push(x, y);
  return out;
}

test('długi kadłub: oś wzdłuż dłuższego boku, linie w poprzek co ~sekcję, rozpiętość z zapasem poza poszycie', () => {
  const cells = rect(0, 0, 40, 10);
  const plan = planScrapCuts(cells, cells.length / 2, { sectionCells: 8 });
  assert.equal(plan.count, 400);
  assert.equal(Math.abs(plan.ax), 1, 'oś przyciągnięta do osi siatki');
  assert.equal(plan.ay, 0);
  assert.equal(plan.s1 - plan.s0, 40, 'długość w komórkach');
  assert.equal(plan.sections, 5);
  assert.equal(plan.lines.length, 4);
  for (let k = 0; k < plan.lines.length; k++) {
    const l = plan.lines[k];
    assert.ok(Math.abs(l.s - (plan.s0 + (k + 1) * 8)) < 1e-9, 'równy podział');
    assert.ok(l.t0 < plan.t0 && l.t1 > plan.t1, 'linia zaczyna i kończy poza kadłubem');
    assert.ok(Math.abs((l.t1 - l.t0) - (10 + 2 * 1.25)) < 1e-9);
  }
});

test('krótki wrak idzie w całości — bez linii', () => {
  const cells = rect(0, 0, 10, 6);
  const plan = planScrapCuts(cells, cells.length / 2, { sectionCells: 8 });
  assert.equal(plan.lines.length, 0);
  assert.equal(plan.sections, 1);
  assert.equal(planScrapCuts([], 0), null);
});

test('kadłub stojący w siatce pionowo: oś = oś y siatki', () => {
  const cells = rect(0, 0, 6, 30);
  const plan = planScrapCuts(cells, cells.length / 2, { sectionCells: 10 });
  assert.equal(plan.ax, 0);
  assert.equal(Math.abs(plan.ay), 1);
  assert.equal(plan.lines.length, 2);
});

test('linia bierze rozpiętość przekroju w SWOIM miejscu (kadłub zwężany), przerwa w kadłubie — bez linii', () => {
  // dziób wąski (x < 20: y 3..7), rufa szeroka (x ≥ 20: y 0..10)
  const cells = rect(0, 0, 40, 10, (x, y) => x < 20 && (y < 3 || y >= 7));
  const plan = planScrapCuts(cells, cells.length / 2, { sectionCells: 10 });
  const spans = plan.lines.map((l) => l.t1 - l.t0);
  assert.ok(Math.min(...spans) < Math.max(...spans), 'wąski przekrój — krótsza linia');
  // dwie wyspy z przerwą dokładnie w miejscu podziału
  const gap = rect(0, 0, 40, 6, (x) => x >= 18 && x < 22);
  const p2 = planScrapCuts(gap, gap.length / 2, { sectionCells: 20 });
  assert.equal(p2.lines.length, 0, 'linia wypada w przerwie');
});

test('strefa modułu odsuwa linię (najwyżej o ułamek sekcji)', () => {
  const cells = rect(0, 0, 40, 10);
  const base = planScrapCuts(cells, cells.length / 2, { sectionCells: 8 });
  const s1 = base.lines[1].s;
  const gx = base.cx + base.ax * s1, gy = base.cy;
  const plan = planScrapCuts(cells, cells.length / 2, { sectionCells: 8, keepOut: [{ x: gx + 0.5, y: gy, r: 1.5 }] });
  assert.ok(Math.abs(plan.lines[1].s - s1) >= 2, 'linia poza strefą');
  assert.ok(Math.abs(plan.lines[1].s - s1) <= 8 * 0.35 + 1e-9, 'nie dalej niż dozwolone przesunięcie');
  assert.equal(plan.lines[0].s, base.lines[0].s, 'pozostałe linie bez zmian');
});

test('odwrócenie planu: te same punkty siatki, kolejność linii od drugiego końca', () => {
  const cells = rect(0, 0, 40, 10, (x, y) => x < 20 && (y < 3 || y >= 7));
  const a = planScrapCuts(cells, cells.length / 2, { sectionCells: 10 });
  const b = flipScrapPlan(planScrapCuts(cells, cells.length / 2, { sectionCells: 10 }));
  assert.equal(b.lines.length, a.lines.length);
  const pa = { x: 0, y: 0 }, pb = { x: 0, y: 0 };
  for (let k = 0; k < a.lines.length; k++) {
    const la = a.lines[k], lb = b.lines[b.lines.length - 1 - k];
    scrapPlanPoint(a, la.s, la.t0, pa);
    scrapPlanPoint(b, lb.s, lb.t1, pb);
    assert.ok(Math.abs(pa.x - pb.x) < 1e-9 && Math.abs(pa.y - pb.y) < 1e-9, 'ten sam koniec linii w siatce');
  }
  assert.ok(Math.abs(b.s0 + a.s1) < 1e-9 && Math.abs(b.s1 + a.s0) < 1e-9);
  assert.ok(b.lines[0].s < b.lines[1].s, 'linie rosną od bliskiego końca');
});

test('zakres odłamu wzdłuż osi planu rozdziela sekcję od reszty', () => {
  const cells = rect(0, 0, 40, 10);
  const plan = planScrapCuts(cells, cells.length / 2, { sectionCells: 8 });
  const line = plan.lines[0].s;
  const near = rect(0, 0, 7, 10), far = rect(9, 0, 40, 10);
  const e = { count: 0, s0: 0, s1: 0 };
  const dir = plan.ax;   // +1 albo −1 — bliski koniec zależy od zwrotu osi
  scrapAxisExtent(plan, dir > 0 ? near : far, (dir > 0 ? near : far).length / 2, e);
  assert.ok(e.s1 <= line + 0.75, 'sekcja cała przed linią');
  scrapAxisExtent(plan, dir > 0 ? far : near, (dir > 0 ? far : near).length / 2, e);
  assert.ok(e.s0 >= line - 0.75 + 1, 'reszta za linią');
});

test('wysięgnik: łokieć po swojej stronie, człony tej samej długości; poza zasięgiem — ramię proste', () => {
  const o = { x: 0, y: 0 };
  scrapArmElbow(100, -60, 400, -200, 220, -1, o);
  const d0 = Math.hypot(o.x - 100, o.y + 60), d1 = Math.hypot(o.x - 400, o.y + 200);
  assert.ok(Math.abs(d0 - 220) < 1e-6 && Math.abs(d1 - 220) < 1e-6);
  const l = { x: 0, y: 0 }, r = { x: 0, y: 0 };
  scrapArmElbow(100, -60, 400, 0, 220, -1, l);
  scrapArmElbow(100, 60, 400, 0, 220, 1, r);
  assert.ok(l.y < -30 && r.y > 30, 'łokcie odchodzą od osi statku');
  scrapArmElbow(0, 0, 1000, 0, 220, 1, o);
  assert.deepEqual([o.x, o.y], [500, 0]);
  const rig = scrapRigFor('salvage_hauler');
  assert.equal(rig, SCRAP_RIG_DEFAULT);
  assert.equal(scrapRigFor('nieznany'), SCRAP_RIG_DEFAULT);
  assert.equal(scrapArmSegment(rig, 700, 10), rig.segMin * 700);
  assert.equal(scrapArmSegment(rig, 700, 5000), rig.segMax * 700);
  assert.ok(scrapArmSegment(rig, 700, 500) * 2 > 500, 'dwa człony sięgają celu');
});
