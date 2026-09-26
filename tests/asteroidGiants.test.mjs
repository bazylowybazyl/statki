import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GIANT_PRESET_IDS,
  GIANT_PRESETS,
  BAND_VOXELS,
  buildGiantPlan,
  giantGridDims,
  fillGiantGrid,
  GiantRock,
  giantSdf,
  ValueNoise3
} from '../src/game/asteroidGiants.js';

// Siatki olbrzymów liczą się sekundami — każdy preset raz na cały plik.
const cache = new Map();
function giantOf(id, seed = 1) {
  const key = `${id}:${seed}`;
  if (!cache.has(key)) {
    const plan = buildGiantPlan(id, seed);
    const g = new GiantRock(plan, 1000, -2000);
    fillGiantGrid(plan, g.grid, g.dims);
    g.ready = true;
    cache.set(key, g);
  }
  return cache.get(key);
}

test('plans are deterministic and every preset has a route and a void', () => {
  for (const id of GIANT_PRESET_IDS) {
    const a = buildGiantPlan(id, 7);
    const b = buildGiantPlan(id, 7);
    assert.deepEqual(a.routes, b.routes, `${id}: trasa deterministyczna`);
    assert.deepEqual(a.lobes, b.lobes, `${id}: bryła deterministyczna`);
    assert.ok(a.routes.length >= 1 && a.routes[0].pts.length >= 3, `${id}: ma trasę`);
    assert.ok(a.tunnels.length + a.canyons.length + a.caverns.length > 0, `${id}: ma pustki`);
    assert.equal(a.half.length, 3);
    assert.equal(GIANT_PRESETS[id].voxel, a.voxel);
  }
  assert.notDeepEqual(buildGiantPlan('warren', 1).routes, buildGiantPlan('warren', 2).routes, 'inne ziarno = inny układ');
});

test('grid fill in slabs (workers) equals the full fill', () => {
  const plan = buildGiantPlan('arch', 1);
  const dims = giantGridDims(plan);
  const full = new Uint8Array(dims.nx * dims.ny * dims.nz);
  fillGiantGrid(plan, full, dims);
  const split = new Uint8Array(full.length);
  const SLAB = 12;
  for (let z0 = 0; z0 < dims.nz; z0 += SLAB) {
    const z1 = Math.min(dims.nz, z0 + SLAB);
    const slab = new Uint8Array(dims.nx * dims.ny * (z1 - z0));
    fillGiantGrid(plan, slab, dims, z0, z1, z0);
    split.set(slab, z0 * dims.nx * dims.ny);
  }
  let diff = 0;
  for (let i = 0; i < full.length; i++) if (full[i] !== split[i]) diff++;
  assert.equal(diff, 0, 'plastry z workerów składają się w tę samą siatkę');
  assert.ok(!full.includes(0), 'każdy woksel wypełniony (0 = niezapisany)');
});

test('routes are open at the game plane and tunnels have a roof', () => {
  for (const id of GIANT_PRESET_IDS) {
    const g = giantOf(id);
    const route = g.plan.routes[0].pts;
    let blocked = 0;
    let samples = 0;
    let roofed = 0;
    let inside = 0;
    for (let i = 1; i < route.length; i++) {
      const [ax, ay] = route[i - 1];
      const [bx, by] = route[i];
      for (let t = 0; t < 1; t += 0.1) {
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        samples++;
        if (g.sampleLocal(x, y, 0) < 250) blocked++;
        // Punkt w obrysie bryły: nad nim zwykle strop (tunel), w kanionie nie.
        if (Math.abs(x) < g.plan.half[0] * 0.6 && Math.abs(y) < g.plan.half[1] * 0.6) {
          inside++;
          if (g.solidAbove(g.x + x, g.y + y, 300)) roofed++;
        }
      }
    }
    assert.ok(blocked / samples < 0.03, `${id}: trasa drożna na z = 0 (${blocked}/${samples} zablokowanych)`);
    // Szczelina to kanion (otwarty od góry), Łuk to przelot między nogami
    // podkowy — pod stropem tylko pod łukiem; reszta tras pod stropem.
    if (id === 'arch') assert.ok(roofed > 0, `arch: pod łukiem strop (${roofed}/${inside})`);
    else if (id !== 'crevasse') assert.ok(inside === 0 || roofed / inside > 0.5, `${id}: w środku bryły trasa idzie pod stropem (${roofed}/${inside})`);
  }
});

test('hollow giant has a fleet-sized cavern with pillars and shallow floor', () => {
  const g = giantOf('hollow');
  const cav = g.plan.caverns[0];
  assert.ok(cav.rx * 2 > 20000 && cav.ry * 2 > 18000, 'jaskinia mieści flotę (> 20 × 18 tys. j.)');
  assert.ok(cav.pillars.length >= 4, 'filary w jaskini');
  // Środek jaskini na płaszczyźnie gry: próżnia; dno płytko pod nią, strop wysoko.
  let open = 0;
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2;
    const x = Math.cos(a) * cav.rx * 0.2;
    const y = Math.sin(a) * cav.ry * 0.2;
    if (g.sampleLocal(x, y, 0) > 0) open++;
  }
  assert.ok(open >= 30, `jaskinia otwarta na z = 0 (${open}/40)`);
  const floor = cav.z - cav.rz;
  assert.ok(floor > -2600 && floor < -500, `dno jaskini w zasięgu świateł statku (${floor.toFixed(0)})`);
  assert.ok(g.solidAbove(g.x, g.y + cav.ry * 0.3, 300), 'nad jaskinią strop');
  // Filary: skała na płaszczyźnie gry (nie stoją na drodze wlotów).
  for (const p of cav.pillars) assert.ok(g.sampleLocal(p.x, p.y, 0) < 0, `filar (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) to skała`);
});

test('collideCircle pushes out of the rock towards open space', () => {
  const g = giantOf('arch');
  // Najgłębszy punkt przekroju z = 0 (z dala od rys i przelotu).
  let best = null;
  for (let y = -g.plan.half[1]; y <= g.plan.half[1]; y += 300) {
    for (let x = -g.plan.half[0]; x <= g.plan.half[0]; x += 300) {
      const d = g.sampleLocal(x, y, 0);
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  assert.ok(best.d < -g.band * 0.9, 'w przekroju jest lita skała');
  const hit = g.collideCircle(g.x + best.x, g.y + best.y, 400);
  assert.ok(hit && hit.depth > 400, 'w skale: głębokie wbicie');
  // Idąc od tego punktu w −x do brzegu: przy brzegu normalna ku próżni (−x).
  let edge = null;
  for (let r = 0; r < 40000; r += 60) {
    if (g.sampleLocal(best.x - r, best.y, 0) > 0) { edge = best.x - r; break; }
  }
  assert.ok(edge !== null);
  const h2 = g.collideCircle(g.x + edge + 150, g.y + best.y, 400);
  assert.ok(h2 && h2.nx < -0.3, `normalna ku próżni (nx = ${h2 && h2.nx.toFixed(2)})`);
  // Daleko od bryły: brak kolizji.
  assert.equal(g.collideCircle(g.x + 1e6, g.y, 400), null);
});

test('SDF band encoding: surface at 128, clamp at ±BAND_VOXELS voxels', () => {
  const g = giantOf('arch');
  const band = BAND_VOXELS * g.plan.voxel;
  assert.equal(g.band, band);
  // Daleko od bryły: dokładnie +pasmo; poza pudłem też.
  assert.ok(Math.abs(g.sampleLocal(0, 0, g.dims.ext[2] - g.plan.voxel) - band) < band * 0.05 || g.sampleLocal(0, 0, g.dims.ext[2] - g.plan.voxel) > 0);
  assert.equal(g.sampleLocal(1e7, 0, 0), band);
  // Zgodność z funkcją SDF przy powierzchni (trilinear z siatki vs dokładnie).
  const noise = new ValueNoise3(g.plan.noiseSeed);
  let n = 0;
  let err = 0;
  for (let i = 0; i < 400; i++) {
    const x = (Math.sin(i * 12.9898) * 0.5) * g.plan.half[0] * 1.6;
    const y = (Math.sin(i * 78.233) * 0.5) * g.plan.half[1] * 1.6;
    const z = (Math.sin(i * 37.719) * 0.5) * g.plan.half[2];
    const exact = giantSdf(g.plan, noise, x, y, z);
    if (Math.abs(exact) > band * 0.6) continue;
    err += Math.abs(g.sampleLocal(x, y, z) - exact);
    n++;
  }
  assert.ok(n > 10, 'są próbki przy powierzchni');
  assert.ok(err / n < g.plan.voxel * 0.5, `siatka zgodna z SDF przy powierzchni (śr. błąd ${(err / n).toFixed(1)} j.)`);
});
