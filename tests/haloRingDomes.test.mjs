// Kopuły-biosfery (ECUMENE + orbital_ring_demo_2): rozstawienie, bryły, szkło — bez GPU.
// node --test tests/haloRingDomes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { HALO_LANDMARK, buildHaloLandmarkPlan, haloCivicContext } from '../src/3d/haloRing/haloRingLandmarks.js';
import { HALO_DOME, HALO_DOME_SPECS, HALO_DOME_TYPES, buildHaloDomePlan, haloDomeParts } from '../src/3d/haloRing/haloRingDomes.js';
import { HALO_INSTANCE_STRIDE, HALO_LIGHT_STRIDE, buildHaloRoofPlan } from '../src/3d/haloRing/haloRingRoofPlan.js';
import { HALO_TAU, haloPortSites } from '../src/3d/haloRing/haloRingConfig.js';

const domainFor = (layout) => ({ segCount: Math.max(8, Math.round(layout.circumference / layout.floor.length)) * 8 });
const wrapS = (ds, L) => ds - L * Math.round(ds / L);

// Megabudowle i kopuły ze wspólnego kontekstu (jak index.js).
function civicPlan(layout, options = {}) {
  const ctx = haloCivicContext(layout, options);
  const landmarks = buildHaloLandmarkPlan(layout, { ctx });
  const domes = buildHaloDomePlan(layout, { ctx });
  return { landmarks, domes };
}

test('kopuły: 12 z planu ECUMENE w sektorach o tych samych nazwach, typy wnętrz z demo_2, deterministycznie', () => {
  const layout = createHaloRingLayout({});
  const a = civicPlan(layout).domes;
  const b = civicPlan(layout).domes;
  assert.deepEqual(a, b, 'determinizm');
  assert.equal(a.length, HALO_DOME_SPECS.length);
  assert.equal(new Set(a.map((d) => d.name)).size, a.length, 'nazwy unikalne');
  for (const [i, dm] of a.entries()) {
    const spec = HALO_DOME_SPECS[i];
    const sec = layout.sectors[dm.sector];
    assert.equal(sec.name, spec.sector, `${dm.name}: sektor ${sec.name}`);
    assert.ok(!sec.port && sec.type !== 'industrial', `${dm.name}: sektor ${sec.type}`);
    assert.equal(dm.type, spec.type);
    assert.equal(HALO_DOME_TYPES[dm.typeIndex], dm.type);
    assert.equal(dm.r, spec.r);
    assert.ok(dm.h > dm.r * 0.7 && dm.h <= dm.r, `${dm.name}: wysokość ${dm.h}`);
    assert.equal(dm.warm, sec.type !== 'glass');
  }
  // wszystkie typy wnętrz w użyciu
  assert.equal(new Set(a.map((d) => d.type)).size, HALO_DOME_TYPES.length);
});

test('miejsca kopuł: pod płaszczyzną gry, z dala od portu, tranzytów, megabudowli i od siebie', () => {
  const layout = createHaloRingLayout({});
  const P = HALO_LANDMARK;
  const L = layout.circumference;
  const floorMid = layout.radii.floorMid;
  const { landmarks, domes } = civicPlan(layout);
  const sites = haloPortSites(floorMid);
  const all = [...landmarks, ...domes];
  for (const dm of domes) {
    // płaska podłoga z rampą w dolnej połowie wstęgi, szkło nie sięga z = 0
    assert.ok(layout.floorZAtT(dm.t + dm.reachQ) <= -P.planeGap + 1, `${dm.name}: rampa sięga płaszczyzny gry`);
    assert.ok(layout.floorZAtT(dm.t) + dm.r < -P.planeGap, `${dm.name}: szkło nad płaszczyzną gry`);
    assert.ok(dm.t - dm.reachQ >= P.wallGap - 1, `${dm.name}: w dolnej ścianie`);
    for (const site of sites) {
      const ds = Math.abs(wrapS(dm.s - site.theta * floorMid, L));
      const gap = site.kind === 'transit' ? site.halfS + P.transitGap : site.halfS + (site.zoneRes || 0) + P.portGap;
      assert.ok(ds >= gap + dm.reachA - 1, `${dm.name} za blisko ${site.kind} #${site.index}`);
    }
    for (const o of all) {
      if (o === dm) continue;
      assert.ok(Math.abs(wrapS(dm.s - o.s, L)) >= dm.reachA + o.reachA + P.spacing - 1, `${dm.name} / ${o.name}`);
    }
    // płaski pas mieści kołnierz i fartuch; park obejmuje rampę
    assert.equal(dm.flatR, dm.r + HALO_DOME.collar + HALO_DOME.apron);
    assert.ok(dm.park.halfA >= dm.flatR + dm.ramp && dm.park.halfQ >= dm.flatR + dm.ramp, `${dm.name}: park ${JSON.stringify(dm.park)}`);
  }
});

test('woda w kopule tylko przy niskiej podłodze (woda w terenie = poziom 0)', () => {
  const layout = createHaloRingLayout({});
  const high = civicPlan(layout, { heightAt: () => 80 }).domes;
  for (const dm of high) {
    if (dm.water) assert.ok(dm.floorH <= HALO_DOME.waterFloor, `${dm.name}: podłoga ${dm.floorH}`);
    else assert.equal(dm.floorH, 80, `${dm.name}: dzicz na terenie`);
  }
});

test('bryły kopuły: kołnierz na obwodzie, wejścia na zewnątrz w płaskim pasie, światła obwodu i szczytu', () => {
  const layout = createHaloRingLayout({});
  for (const dm of civicPlan(layout).domes) {
    const parts = haloDomeParts(dm);
    assert.deepEqual(parts.glass, { r: dm.r, h: dm.h });
    const collar = parts.boxes.filter((b) => b.mat === 'stone' && b.u0 < 0);
    assert.ok(collar.length >= 24, `${dm.name}: kołnierz ${collar.length}`);
    for (const b of collar) {
      const d = Math.hypot(b.a, b.q);
      assert.ok(Math.abs(d - dm.r) <= HALO_DOME.collar, `${dm.name}: kołnierz na ${d.toFixed(0)} przy r ${dm.r}`);
      assert.ok(b.fixed && Number.isFinite(b.dir), 'kołnierz w osiach ringu, stycznie');
    }
    const halls = parts.boxes.filter((b) => b.mat === 'facade');
    assert.equal(halls.length, dm.entrances.length);
    for (const b of halls) {
      const d = Math.hypot(b.a, b.q);
      assert.ok(d - b.sa / 2 >= dm.r - 12, `${dm.name}: hala wejściowa pod szkłem`);
      assert.ok(d + b.sa / 2 <= dm.flatR, `${dm.name}: hala poza płaskim pasem (${(d + b.sa / 2).toFixed(0)} > ${dm.flatR})`);
    }
    const beacon = parts.lights.filter((l) => l.color === 'red');
    assert.equal(beacon.length, 1);
    assert.ok(beacon[0].u > dm.h, `${dm.name}: światło przeszkodowe pod szczytem`);
    // bez świateł „wiszących” w powietrzu pod szkłem
    for (const l of parts.lights) {
      if (l.color === 'red') continue;
      assert.ok(Math.hypot(l.a, l.q) >= dm.r, `${dm.name}: światło pod szkłem`);
    }
  }
});

test('plan dachu: jedna instancja szkła na kopułę (osobna siatka), kołnierze w punktach orientacyjnych', () => {
  const layout = createHaloRingLayout({});
  const { landmarks, domes } = civicPlan(layout);
  const domain = domainFor(layout);
  const base = buildHaloRoofPlan(layout, domain, { landmarks });
  const plan = buildHaloRoofPlan(layout, domain, { landmarks, domes });
  assert.equal(base.glass.total, 0);
  assert.equal(plan.glass.total, domes.length);
  assert.equal(plan.domes.length, domes.length);
  let boxes = 0;
  let lights = 0;
  for (const dm of domes) {
    const parts = haloDomeParts(dm);
    boxes += parts.boxes.length;
    lights += parts.lights.length;
  }
  assert.equal(plan.prims[0].landmark.total, base.prims[0].landmark.total + boxes);
  assert.equal(plan.landmarkLights.total, base.landmarkLights.total + lights);
  for (let p = 0; p < plan.prims.length; p++) assert.equal(plan.prims[p].detail.total, base.prims[p].detail.total, 'dach bez zmian');
  const floorMid = layout.radii.floorMid;
  const G = plan.glass.data;
  const seen = new Set();
  for (let k = 0; k < plan.glass.total; k++) {
    const o = k * HALO_INSTANCE_STRIDE;
    for (let i = 0; i < HALO_INSTANCE_STRIDE; i++) assert.ok(Number.isFinite(G[o + i]), 'NaN w szkle');
    const th = G[o] * plan.segAngle + G[o + 1] / floorMid;
    const dm = domes.find((d) => {
      let d0 = th - d.theta;
      d0 -= HALO_TAU * Math.round(d0 / HALO_TAU);
      return Math.abs(d0) * floorMid < 1;
    });
    assert.ok(dm, `szkło bez kopuły (θ ${th.toFixed(4)})`);
    seen.add(dm);
    assert.ok(Math.abs(G[o + 3] - dm.z) < 1e-3 + Math.abs(layout.floor.normal.z) * dm.floorH, `${dm.name}: z szkła`);
    assert.ok(Math.abs(G[o + 2] - (layout.floorRadiusAtT(dm.t) - floorMid + layout.floor.normal.r * dm.floorH)) < 0.01, `${dm.name}: promień szkła`);
    assert.deepEqual([G[o + 4], G[o + 5], G[o + 6]], [2 * dm.r, 2 * dm.r, dm.h]);
    // +256 punkt orientacyjny, typ wnętrza w palecie, ciepłe wnętrze w emisji
    const mat = G[o + 7];
    assert.ok(mat >= 256);
    assert.equal((mat - 256) % 32, dm.typeIndex);
    assert.equal(Math.floor((mat - 256) / 32), dm.warm ? 1 : 0);
  }
  assert.equal(seen.size, domes.length);
  // segmenty z kopułą mają granice (wybór w kadrze)
  for (const dm of domes) {
    const seg = Math.floor((((dm.theta % HALO_TAU) + HALO_TAU) % HALO_TAU) / plan.segAngle) % plan.segCount;
    const b = plan.landmarkBounds[seg];
    assert.ok(b, `${dm.name}: brak granic segmentu`);
    assert.ok(b.rMax - b.rMin >= dm.h * 0.9 * Math.abs(layout.floor.normal.r), `${dm.name}: granice nie obejmują szkła`);
  }
  assert.ok(plan.landmarkLights.data.length === plan.landmarkLights.total * HALO_LIGHT_STRIDE);
});

test('wariant Halo (góra ku osi): kopuły rosną do środka ringu', () => {
  const layout = createHaloRingLayout({ habitatFacing: 'inward' });
  const { landmarks, domes } = civicPlan(layout);
  assert.equal(domes.length, HALO_DOME_SPECS.length);
  const plan = buildHaloRoofPlan(layout, domainFor(layout), { landmarks, domes });
  assert.equal(plan.glass.total, domes.length);
  const floorMid = layout.radii.floorMid;
  for (let k = 0; k < plan.glass.total; k++) {
    const o = k * HALO_INSTANCE_STRIDE;
    const th = plan.glass.data[o] * plan.segAngle + plan.glass.data[o + 1] / floorMid;
    const dm = domes.find((d) => Math.abs(wrapS(th - d.theta, HALO_TAU)) * floorMid < 1);
    // kwaternion stawia lokalne z (góra kopuły) wzdłuż normalnej podłogi: ku osi
    // (składowa promieniowa obrazu osi z: 2(yz − wx))
    const [x, y, z, w] = [plan.glass.data[o + 8], plan.glass.data[o + 9], plan.glass.data[o + 10], plan.glass.data[o + 11]];
    const upR = 2 * (y * z - w * x);
    assert.ok(Math.sign(upR) === Math.sign(layout.floor.normal.r), `${dm.name}: góra kopuły ${upR.toFixed(2)}`);
  }
});
