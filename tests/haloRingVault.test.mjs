// Kryte habitaty Marsa (2026-10-22, warstwa wyłączalna polem profilu `habitatVault`): szklane sklepienie
// nad pasem habitatu ECUMENE — bez sklepienia nad płytami portu, tranzytami, kopułami i supertallami,
// zabudowa pod sklepieniem nie przebija szkła; bez pola profilu habitat zostaje otwarty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { haloRingLayoutFor } from '../src/game/haloRingPlanets.js';
import { buildEcumeneInstances, createEcumenePlan, ecumeneVault } from '../src/3d/haloRing/arch/ecumenePlan.js';

const mars = haloRingLayoutFor({ id: 'mars' });
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('sklepienie: łuk od korony do korony ścian, pokrycie poza portem, kopułami i supertallami', () => {
  const plan = createEcumenePlan(mars);
  const v = ecumeneVault(plan);
  assert.ok(v, 'Mars ma kryte habitaty (profil)');
  assert.equal(v.hAt(plan.HW), mars.wallHeight);
  assert.equal(v.hAt(-plan.HW), mars.wallHeight);
  assert.equal(v.hAt(0), v.apex);
  const covered = v.covered.reduce((s, c) => s + c, 0);
  assert.ok(covered / v.n > 0.25 && covered / v.n < 0.7, `pokrycie ${covered}/${v.n}`);
  for (let i = 0; i < v.n; i++) {
    if (!v.covered[i]) continue;
    const th = mars.sectorStart + (i + 0.5) * v.dA;
    for (const f of [-0.85, 0, 0.85]) assert.notEqual(plan.portClass(th, f * plan.HW, 0), 2, 'sklepienie nad płytą portu');
  }
  for (const d of plan.domeSpots) {
    const p = plan.sectors.findIndex((sec) => sec.district === d.s);
    const th = plan.theta0(p) + (d.u * plan.LEN) / plan.R;
    assert.equal(v.coveredAt(th), false, 'sklepienie nad kopułą');
  }
});

test('sklepienie: zabudowa pod nim nie przebija szkła; bez pola profilu — otwarty habitat', () => {
  const plan = createEcumenePlan(mars);
  const v = ecumeneVault(plan);
  const inst = buildEcumeneInstances(plan);
  let checked = 0;
  for (const B of inst.per) {
    const b = B.box;
    for (let i = 0; i < b.count; i++) {
      const o = i * 16;
      const x = b.m[o + 12];
      const y = b.m[o + 13];
      const z = b.m[o + 14];
      const th = Math.atan2(y, x);
      if (!v.coveredAt(th)) continue;
      // góra bryły: podstawa (r − R) + wysokość (długość osi Y macierzy)
      const base = Math.hypot(x, y) - plan.R;
      const h = Math.hypot(b.m[o + 4], b.m[o + 5], b.m[o + 6]);
      assert.ok(base + h <= v.hAt(z) + 1, `bryła ${(base + h).toFixed(0)} > sklepienie ${v.hAt(z).toFixed(0)}`);
      checked++;
    }
  }
  assert.ok(checked > 200, `sprawdzone bryły ${checked}`);
  // profil bez sklepienia (habitatVault: null) — otwarty habitat
  const openPlan = { ...plan, layout: { ...plan.layout, planetProfile: { ...plan.layout.planetProfile, habitatVault: null } } };
  assert.equal(ecumeneVault(openPlan), null);
  const src = read('src/3d/haloRing/arch/ecumene.js');
  assert.match(src, /materials\.glass\(\{ alpha: 0\.035, fg: true \}\)/, 'górna połowa w FG (zanik jak górna ściana)');
});
