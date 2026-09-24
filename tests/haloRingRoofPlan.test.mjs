// Plan megastruktury dachu i portu (M3): czysta matematyka, bez GPU.
// node --test tests/haloRingRoofPlan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import {
  HALO_INSTANCE_STRIDE,
  HALO_LIGHT_STRIDE,
  buildHaloRoofPlan,
  computeRoofLanes,
  haloHashI,
  haloLowbias
} from '../src/3d/haloRing/haloRingRoofPlan.js';
import { HALO_PORT, HALO_STATION_ANGLE, HALO_TAU, HALO_TRANSIT, haloTransitAngles } from '../src/3d/haloRing/haloRingConfig.js';

// Domena segmentów jak w index.js (terrain.rootCount × 8).
function domainFor(layout) {
  const rootCount = Math.max(8, Math.round(layout.circumference / layout.floor.length));
  return { segCount: rootCount * 8 };
}

function rotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx)
  ];
}

// Narożniki bryły instancji w układzie ringu: promień i z.
function corners(data, o, plan, floorMid) {
  const seg = data[o];
  const theta = seg * plan.segAngle + data[o + 1] / floorMid;
  const r = floorMid + data[o + 2];
  const z = data[o + 3];
  const sx = data[o + 4];
  const sy = data[o + 5];
  const sz = data[o + 6];
  const q = [data[o + 8], data[o + 9], data[o + 10], data[o + 11]];
  const out = [];
  for (const cx of [-0.5, 0.5]) {
    for (const cy of [-0.5, 0.5]) {
      for (const cz of [0, 1]) {
        const v = rotate(q, [cx * sx, cy * sy, cz * sz]);
        out.push({ r: Math.hypot(r + v[1], v[0]), z: z + v[2], theta });
      }
    }
  }
  return out;
}

test('hasz całkowity = lowbias32 (ten sam bit w bit w GLSL)', () => {
  // wartości policzone niezależnie (Python, arytmetyka mod 2^32)
  assert.equal(haloLowbias(0), 0);
  assert.equal(haloLowbias(1), 1753845952);
  assert.equal(haloLowbias(123456789), 2834422664);
  assert.equal(haloHashI(0, 0, 11), 0.42712289094924927);
  assert.equal(haloHashI(4703, 7, 12), 0.757071316242218);
  assert.equal(haloHashI(100, 3, 21), 0.06779998540878296);
});

test('pasy dachu mieszczą się w szerokości przy każdej wysokości ścian', () => {
  for (const wallHeight of [800, 1200, 1500, 2100]) {
    const L = createHaloRingLayout({ wallHeight });
    const w = Math.abs(L.radii.rim - L.radii.back);
    const lanes = computeRoofLanes(w);
    const seq = [0, lanes.rimEnd, lanes.rowA[0], lanes.rowA[1], lanes.rowB[0], lanes.rowB[1],
      lanes.maglev[0], lanes.maglev[1], lanes.industrial[0], lanes.industrial[1], lanes.hull0, w];
    for (let i = 1; i < seq.length; i++) assert.ok(seq[i] >= seq[i - 1] - 1e-9, `kolejność pasów przy ścianie ${wallHeight}: ${seq}`);
    assert.ok(lanes.industrial[1] - lanes.industrial[0] >= 100, `pas przemysłowy przy ${wallHeight}`);
  }
});

test('plan deterministyczny: detal na dachu, doki wpięte w podłogę w płaszczyźnie gry', () => {
  const layout = createHaloRingLayout({});
  const domain = domainFor(layout);
  const a = buildHaloRoofPlan(layout, domain);
  const b = buildHaloRoofPlan(layout, domain);
  const floorMid = layout.radii.floorMid;
  let detail = 0;
  let landmark = 0;
  let dockRMin = Infinity;
  let dockRMax = 0;
  let tunnelRMin = Infinity;
  let tunnelRMax = 0;
  const transitArc = (theta) => Math.min(...haloTransitAngles().map((a) => {
    let d = theta - a;
    d -= HALO_TAU * Math.round(d / HALO_TAU);
    return Math.abs(d) * floorMid;
  }));
  for (let p = 0; p < a.prims.length; p++) {
    for (const set of ['detail', 'landmark']) {
      const A = a.prims[p][set];
      const B = b.prims[p][set];
      assert.deepEqual(Array.from(A.data.slice(0, 600)), Array.from(B.data.slice(0, 600)), 'determinizm');
      assert.equal(A.total, B.total);
      for (let k = 0; k < A.total; k++) {
        const o = k * HALO_INSTANCE_STRIDE;
        for (const c of corners(A.data, o, a, floorMid)) {
          if (set === 'detail') {
            // detal dachu leży na płycie dachu i nie wystaje ponad z.top
            assert.ok(c.z >= layout.z.roof - 30 && c.z <= layout.z.top + 0.5, `${a.prims[p].name}/detal #${k}: z = ${c.z.toFixed(1)} poza dachem`);
            assert.ok(c.r >= layout.radii.min - 1 && c.r <= layout.radii.max + 1, `detal poza obwiednią: r = ${c.r.toFixed(0)}`);
          } else if (transitArc(c.theta) < 4000) {
            // tranzyty: tunel w płycie podłogi, portale na podłodze i kadłubie
            assert.ok(c.z >= HALO_TRANSIT.portalZ[0] - 1 && c.z <= HALO_TRANSIT.portalZ[1] + 1, `${a.prims[p].name}/tranzyt #${k}: z = ${c.z.toFixed(1)}`);
            tunnelRMin = Math.min(tunnelRMin, c.r);
            tunnelRMax = Math.max(tunnelRMax, c.r);
          } else {
            // doki: w pasie kołnierza wokół płaszczyzny gry, od podłogi na zewnątrz
            assert.ok(c.z >= HALO_PORT.plugZMin - 1 && c.z <= HALO_PORT.plugZMax + 1, `${a.prims[p].name}/dok #${k}: z = ${c.z.toFixed(1)}`);
            dockRMin = Math.min(dockRMin, c.r);
            dockRMax = Math.max(dockRMax, c.r);
          }
        }
      }
      if (set === 'detail') detail += A.total; else landmark += A.total;
    }
  }
  assert.ok(detail > 50000, `detal dachu: ${detail} instancji`);
  assert.ok(landmark > 50, `doki: ${landmark} instancji`);
  assert.equal(a.docks.length, HALO_PORT.docks * HALO_PORT.complexes);
  // tył doku w podłodze: bryły styku z podłogą wpuszczone zgodnie z krzywizną
  // (szeroka zatoka: końce ~140 j. niżej niż środek), ale w płycie kadłuba
  assert.ok(dockRMin > floorMid - 250 && dockRMin < floorMid + 10, `tył doków: r = ${dockRMin.toFixed(0)}`);
  assert.ok(dockRMin > layout.radii.back + 100, 'tył doku przebija kadłub');
  assert.ok(dockRMax > layout.radii.rim + 1000, `wylot zatoki za krawędzią ścian: r = ${dockRMax.toFixed(0)}`);
  // tunele tranzytów przechodzą przez całą płytę: od kadłuba (planeta) po podłogę (habitat)
  assert.equal(a.transits.length, HALO_TRANSIT.count);
  assert.ok(tunnelRMin < layout.radii.back - 50 && tunnelRMax > floorMid + 100, `tunel r ${tunnelRMin.toFixed(0)}–${tunnelRMax.toFixed(0)}`);
  // zatoki transportowe przy kompleksach (co 90° od kąta stacji), po bokach hal K-7
  for (const d of a.docks) {
    let dd = d.theta - HALO_STATION_ANGLE;
    dd -= (Math.PI / 2) * Math.round(dd / (Math.PI / 2));
    assert.ok(Math.abs(dd) < 0.35, 'zatoka przy kompleksie');
    assert.ok(Math.abs(dd) * floorMid > HALO_PORT.k7HalfWidth + HALO_PORT.collar + d.length / 2, 'dok transportowy nie zachodzi na K-7');
    // pasy MEGA przy obu ścianach zatoki, stanowisko w głębi zatoki
    assert.equal(d.lanes.length, 2);
    assert.ok(d.berthY > 0 && d.berthY < d.depth, 'stanowisko MEGA w zatoce');
  }
  // światła dachu na dachu, światła doków przy płaszczyźnie gry
  const Ld = a.lights.data;
  for (let k = 0; k < a.lights.total; k++) {
    const z = Ld[k * HALO_LIGHT_STRIDE + 3];
    assert.ok(z >= layout.z.roof - 1 && z <= layout.z.top + 12, `światło dachu z = ${z}`);
  }
  const Lm = a.landmarkLights.data;
  assert.ok(a.landmarkLights.total >= a.docks.length * 8 + a.transits.length * 16, 'światła doków i tranzytów');
  for (let k = 0; k < a.landmarkLights.total; k++) {
    const z = Lm[k * HALO_LIGHT_STRIDE + 3];
    assert.ok(z > Math.min(HALO_PORT.plugZMin, HALO_TRANSIT.portalZ[0]) && z < Math.max(HALO_PORT.plugZMax, HALO_TRANSIT.portalZ[1]) + 20, `światło doku/tranzytu z = ${z}`);
  }
  // budżet bufora: najgęstszy segment
  const maxPerSeg = Math.max(...a.prims.map((p) => p.detail.maxPerSeg));
  assert.ok(maxPerSeg < 2500, `najgęstszy segment: ${maxPerSeg}`);
});

test('wariant Halo (do planety) nie dostaje doków, dach nadal pełny', () => {
  const layout = createHaloRingLayout({ habitatFacing: 'inward' });
  const plan = buildHaloRoofPlan(layout, domainFor(layout));
  assert.equal(plan.docks.length, 0);
  assert.ok(plan.prims[0].detail.total > 30000);
});

test('przemysł: zestaw brył działki mieści się w działce i pod limitem wysokości', async () => {
  const { indKitPart, indKitType, IND_LOT, IND_PARTS } = await import('../src/3d/haloRing/haloRingIndustryKit.js');
  const { HALO_CITY } = await import('../src/3d/haloRing/haloRingCity.js').catch(() => ({ HALO_CITY: { maxHeight: { industrial: 125 } } }));
  const kinds = new Set();
  for (let i = 0; i < 4000; i++) {
    const lotH = (i + 0.5) / 4000;
    kinds.add(indKitType(lotH));
    for (let p = 0; p < IND_PARTS; p++) {
      const { A, B } = indKitPart(lotH, p);
      if (B[1] <= 0) continue;
      const box = p < 2;
      const hu = box ? A[2] / 2 : A[2];
      const hw = box ? A[3] / 2 : A[2];
      assert.ok(Math.abs(A[0]) + hu <= IND_LOT.halfU + 4.5, `lotH ${lotH} część ${p}: wzdłuż ${Math.abs(A[0]) + hu}`);
      assert.ok(Math.abs(A[1]) + hw <= IND_LOT.halfW + 0.5, `lotH ${lotH} część ${p}: w poprzek ${Math.abs(A[1]) + hw}`);
      assert.ok(B[0] + B[1] <= HALO_CITY.maxHeight.industrial, `lotH ${lotH} część ${p}: wysokość ${B[0] + B[1]}`);
    }
  }
  assert.equal(kinds.size, 7, 'siedem rodzajów zakładów');
});
