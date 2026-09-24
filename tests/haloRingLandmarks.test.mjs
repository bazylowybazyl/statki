// Megabudowle — landmarki miast z dema ECUMENE: rozstawienie i bryły, bez GPU.
// node --test tests/haloRingLandmarks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import {
  HALO_LANDMARK,
  HALO_LANDMARK_SPECS,
  buildHaloLandmarkPlan,
  haloLandmarkParts
} from '../src/3d/haloRing/haloRingLandmarks.js';
import { HALO_INSTANCE_STRIDE, HALO_LIGHT_STRIDE, HALO_MAT, HALO_EMIT, buildHaloRoofPlan } from '../src/3d/haloRing/haloRingRoofPlan.js';
import { HALO_TAU, haloPortSites } from '../src/3d/haloRing/haloRingConfig.js';

// Domena segmentów jak w index.js (terrain.rootCount × 8).
const domainFor = (layout) => ({ segCount: Math.max(8, Math.round(layout.circumference / layout.floor.length)) * 8 });
const wrapS = (ds, L) => ds - L * Math.round(ds / L);

function rotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

// Kotwica instancji na płycie placu budowli (odrzuca bryły doków i tranzytów).
function onPlaza(data, o, plan, floorMid, lm) {
  let d = data[o] * plan.segAngle + data[o + 1] / floorMid - lm.theta;
  d -= HALO_TAU * Math.round(d / HALO_TAU);
  return Math.abs(d * (floorMid + data[o + 2])) <= lm.plaza.halfA + 100 && Math.abs(data[o + 3] - lm.z) <= lm.plaza.halfQ + 100;
}

// Narożniki instancji w układzie budowli: wzdłuż (łuk od środka budowli),
// promień i z. Anchor w (θ, r), przesunięcie narożnika w bazie kotwicy.
function corners(data, o, plan, floorMid, lm) {
  const thA = data[o] * plan.segAngle + data[o + 1] / floorMid;
  const rA = floorMid + data[o + 2];
  const zA = data[o + 3];
  const q = [data[o + 8], data[o + 9], data[o + 10], data[o + 11]];
  const out = [];
  for (const cx of [-0.5, 0.5]) {
    for (const cy of [-0.5, 0.5]) {
      for (const cz of [0, 1]) {
        const v = rotate(q, [cx * data[o + 4], cy * data[o + 5], cz * data[o + 6]]);
        const px = rA * Math.cos(thA) + v[0] * -Math.sin(thA) + v[1] * Math.cos(thA);
        const py = rA * Math.sin(thA) + v[0] * Math.cos(thA) + v[1] * Math.sin(thA);
        const r = Math.hypot(px, py);
        let d = Math.atan2(py, px) - lm.theta;
        d -= HALO_TAU * Math.round(d / HALO_TAU);
        out.push({ along: d * r, r, z: zA + v[2] });
      }
    }
  }
  return out;
}

test('megabudowle ECUMENE: 9 budowli w sektorach miast o tych samych nazwach, deterministycznie', () => {
  const layout = createHaloRingLayout({});
  const a = buildHaloLandmarkPlan(layout);
  const b = buildHaloLandmarkPlan(layout);
  assert.deepEqual(a, b, 'determinizm');
  assert.equal(a.length, HALO_LANDMARK_SPECS.length);
  assert.equal(new Set(a.map((l) => l.name)).size, a.length);
  for (const lm of a) {
    const sec = layout.sectors[lm.sector];
    assert.ok(sec.type === 'garden' || sec.type === 'glass', `${lm.name} w sektorze ${sec.name} (${sec.type})`);
    assert.ok(!sec.port, `${lm.name} w sektorze portu`);
    const spec = HALO_LANDMARK_SPECS.find((s) => s.name === lm.name);
    assert.equal(sec.name, spec.sector, `${lm.name}: sektor ${sec.name}`);
    assert.equal(lm.warm, sec.type === 'garden', `${lm.name}: okna ciepłe w ogrodzie, chłodne w szkle`);
  }
});

test('place: pod płaszczyzną gry, z dala od ściany, portu, tranzytów i od siebie', () => {
  const layout = createHaloRingLayout({});
  const P = HALO_LANDMARK;
  const L = layout.circumference;
  const floorMid = layout.radii.floorMid;
  const plan = buildHaloLandmarkPlan(layout);
  const sites = haloPortSites(floorMid);
  for (const lm of plan) {
    // plac z rampą nie sięga płaszczyzny gry — budowla nie jest przeszkodą lotu
    const zTop = layout.floorZAtT(lm.t + lm.reachQ);
    assert.ok(zTop <= -P.planeGap + 1, `${lm.name}: plac sięga z = ${zTop.toFixed(0)}`);
    assert.ok(lm.t - lm.reachQ >= P.wallGap - 1, `${lm.name}: plac w dolnej ścianie`);
    for (const site of sites) {
      const ds = Math.abs(wrapS(lm.s - site.theta * floorMid, L));
      const gap = site.kind === 'transit' ? site.halfS + P.transitGap : site.halfS + (site.zoneRes || 0) + P.portGap;
      assert.ok(ds >= gap + lm.reachA - 1, `${lm.name} za blisko ${site.kind} #${site.index}: ${ds.toFixed(0)} j.`);
    }
    for (const o of plan) {
      if (o === lm) continue;
      assert.ok(Math.abs(wrapS(lm.s - o.s, L)) >= lm.reachA + o.reachA + P.spacing - 1, `${lm.name} / ${o.name}`);
    }
    assert.ok(lm.plazaH >= P.minPlazaH && lm.plazaH <= P.maxPlazaH, `${lm.name}: plac na ${lm.plazaH}`);
  }
});

test('teren: suche miejsce wygrywa z morzem, wysokość placu z mapy', () => {
  const layout = createHaloRingLayout({});
  // ląd (40 j.) tylko w pasie 0,62–0,88 każdego sektora, dalej morze
  const uOf = (theta) => {
    const x = (theta - layout.sectorStart) / layout.sectorSpan;
    return x - Math.floor(x);
  };
  const heightAt = (theta) => {
    const u = uOf(theta);
    return u > 0.62 && u < 0.88 ? 40 : -20;
  };
  const plan = buildHaloLandmarkPlan(layout, { heightAt });
  let dry = 0;
  for (const lm of plan) {
    if (lm.plazaH === 40) {
      dry++;
      const u = uOf(lm.theta);
      assert.ok(u > 0.62 && u < 0.88, `${lm.name}: suchy plac poza lądem (u = ${u.toFixed(2)})`);
    } else {
      // brak suchego miejsca (port, tranzyt, sąsiedzi): plac nad wodą, z lądem z bake'u
      assert.equal(lm.plazaH, HALO_LANDMARK.minPlazaH, `${lm.name}: plac ${lm.plazaH}`);
    }
  }
  assert.ok(dry >= 5, `suchych placów: ${dry} z ${plan.length}`);
});

test('bryły: na placu w podłodze, w górę mieszkańców, w zestawie punktów orientacyjnych', () => {
  const layout = createHaloRingLayout({});
  const landmarks = buildHaloLandmarkPlan(layout);
  const domain = domainFor(layout);
  const base = buildHaloRoofPlan(layout, domain);
  const plan = buildHaloRoofPlan(layout, domain, { landmarks });
  const floorMid = layout.radii.floorMid;
  assert.equal(plan.landmarks.length, landmarks.length);
  for (let p = 0; p < plan.prims.length; p++) {
    assert.equal(plan.prims[p].detail.total, base.prims[p].detail.total, 'dach bez zmian');
  }
  // same prostopadłościany: bez nowego draw calla walców i kopuł
  assert.equal(plan.prims[1].landmark.total, base.prims[1].landmark.total);
  assert.equal(plan.prims[2].landmark.total, base.prims[2].landmark.total);
  const allowedPal = new Set([HALO_MAT.roofMid, HALO_MAT.gardenRoof, HALO_MAT.stone, HALO_MAT.brass, HALO_MAT.lamp, HALO_MAT.facadeWarm, HALO_MAT.facadeCool]);
  const A = plan.prims[0].landmark;
  let lightsExtra = 0;
  for (const lm of landmarks) {
    const parts = haloLandmarkParts(lm);
    lightsExtra += parts.lights.length;
    const floorR = layout.floorRadiusAtT(lm.t);
    let n = 0;
    let top = -Infinity;
    let facades = 0;
    for (let k = 0; k < A.total; k++) {
      const o = k * HALO_INSTANCE_STRIDE;
      if (!onPlaza(A.data, o, plan, floorMid, lm)) continue;
      const cs = corners(A.data, o, plan, floorMid, lm);
      n++;
      const mat = A.data[o + 7];
      assert.ok(mat >= 256, 'punkt orientacyjny (bez zaniku z odległością)');
      const code = mat - 256;
      const emit = Math.floor(code / 32);
      const pal = code - 32 * emit;
      assert.ok(allowedPal.has(pal), `${lm.name}: paleta ${pal}`);
      assert.ok(emit === HALO_EMIT.none || emit === HALO_EMIT.facade, `${lm.name}: emisja ${emit}`);
      if (emit === HALO_EMIT.facade) facades++;
      for (const c of cs) {
        const alt = c.r - floorR;
        assert.ok(alt >= lm.plazaH - HALO_LANDMARK.plinthDepth - 1, `${lm.name}: pod fundamentem (${alt.toFixed(0)})`);
        assert.ok(Math.abs(c.along) <= lm.plaza.halfA + 1, `${lm.name}: poza płytą wzdłuż (${c.along.toFixed(0)})`);
        assert.ok(Math.abs(c.z - lm.z) <= lm.plaza.halfQ + 1, `${lm.name}: poza płytą w poprzek (${(c.z - lm.z).toFixed(0)})`);
        assert.ok(c.z < 0, `${lm.name}: bryła nad płaszczyzną gry`);
        top = Math.max(top, alt);
      }
    }
    assert.equal(n, parts.boxes.length, `${lm.name}: instancje ${n} / ${parts.boxes.length}`);
    assert.ok(facades >= 5, `${lm.name}: fasad ${facades}`);
    assert.ok(top > lm.plazaH + lm.h * 0.9 && top < lm.plazaH + lm.h + 200, `${lm.name}: szczyt ${top.toFixed(0)} przy h ${lm.h}`);
  }
  assert.equal(plan.landmarkLights.total, base.landmarkLights.total + lightsExtra);
  // światło przeszkodowe (czerwone) na szczycie każdej budowli
  const Lm = plan.landmarkLights.data;
  for (const lm of landmarks) {
    let beacon = false;
    for (let k = 0; k < plan.landmarkLights.total; k++) {
      const o = k * HALO_LIGHT_STRIDE;
      const th = Lm[o] * plan.segAngle + Lm[o + 1] / floorMid;
      let d = th - lm.theta;
      d -= HALO_TAU * Math.round(d / HALO_TAU);
      if (Math.abs(d) * floorMid > 3000 || Lm[o + 6] !== 1) continue;
      if (floorMid + Lm[o + 2] - layout.floorRadiusAtT(lm.t) > lm.plazaH + lm.h * 0.6) beacon = true;
    }
    assert.ok(beacon, `${lm.name}: brak światła przeszkodowego`);
  }
});

test('wariant Halo (góra ku osi): budowle rosną do środka ringu, front ku górnej ścianie', () => {
  const layout = createHaloRingLayout({ habitatFacing: 'inward' });
  const landmarks = buildHaloLandmarkPlan(layout);
  assert.equal(landmarks.length, HALO_LANDMARK_SPECS.length);
  const plan = buildHaloRoofPlan(layout, domainFor(layout), { landmarks });
  const floorMid = layout.radii.floorMid;
  const A = plan.prims[0].landmark;
  for (const lm of landmarks.slice(0, 3)) {
    const floorR = layout.floorRadiusAtT(lm.t);
    let deepest = Infinity;
    let entranceZ = -Infinity;
    const parts = haloLandmarkParts(lm);
    for (let k = 0; k < A.total; k++) {
      const o = k * HALO_INSTANCE_STRIDE;
      if (!onPlaza(A.data, o, plan, floorMid, lm)) continue;
      for (const c of corners(A.data, o, plan, floorMid, lm)) {
        deepest = Math.min(deepest, c.r - floorR);
        entranceZ = Math.max(entranceZ, c.z);
      }
    }
    assert.ok(deepest < -(lm.plazaH + lm.h * 0.9), `${lm.name}: szczyt ${deepest.toFixed(0)} (ku osi)`);
    // hala wejściowa i żebra (front) po stronie +z, czyli górnej ściany
    const frontQ = Math.max(...parts.boxes.filter((b) => !b.fixed).map((b) => b.q + b.sq / 2));
    assert.ok(entranceZ > lm.z + frontQ * 0.8, `${lm.name}: front ${entranceZ.toFixed(0)} przy z ${lm.z.toFixed(0)}`);
  }
});
