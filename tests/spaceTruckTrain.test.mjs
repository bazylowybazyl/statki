// Kinematyka zestawu ciągnika kosmicznego: przeguby się nie rozjeżdżają, ogranicznik zgięcia, obrysy sąsiadów, zgodność
// 60 / 120 Hz, brak alokacji w stanie ustalonym, cofanie bez scyzoryka. Dane: dopięte rachunki i atlas.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRUCK_ATLAS, TRUCK_ATLAS_CELLS, TRUCK_CARGO, TRUCK_LIVERIES, TRUCK_MODULE, TRUCK_SCALES, TRUCK_SPRITE_BOUNDS, TRUCK_SPRITE_PNG,
  TRUCK_LIGHT_KINDS, TRUCK_TRACTORS, TRUCK_TRACTOR_IDS, TRUCK_TRAILER, truckCargoForResource, truckHexLinear, truckMinTurnRadius,
  truckRigLength, truckRigTonnes, truckRigWidth, truckSteadyBend
} from '../src/data/spaceTrucks.js';
import { CARGO_CONTAINER } from '../src/data/cargoBays.js';
import { createTruckTrain, placeTruckTrain, stepTruckTrain, truckTrainHitch, truckTrainPose } from '../src/game/spaceTruckTrain.js';
import { allocatedBytes, untilSteady } from './helpers/alokacje.mjs';

// Czoło jedzie po torze: łuki i proste (długość łuku → poza). Tor bez nagłych zmian kursu: promień ≥ `r`.
function trackPose(s, r, out) {
  const seg = 400;
  const arc = Math.PI * r;
  const period = 2 * (seg + arc);
  const u = ((s % period) + period) % period;
  if (u < seg) { out.x = u; out.y = 0; out.a = 0; return out; }
  if (u < seg + arc) {
    const t = (u - seg) / r;
    out.x = seg + r * Math.sin(t); out.y = r - r * Math.cos(t); out.a = t;
    return out;
  }
  if (u < 2 * seg + arc) { out.x = seg - (u - seg - arc); out.y = 2 * r; out.a = Math.PI; return out; }
  const t = (u - 2 * seg - arc) / r;
  out.x = -r * Math.sin(t); out.y = r + r * Math.cos(t); out.a = Math.PI + t;
  return out;
}

function runTrack(train, { r = 120, speed = 170, hz = 60, seconds = 40, onStep = null } = {}) {
  const p = {};
  const dt = 1 / hz;
  trackPose(0, r, p);
  placeTruckTrain(train, p.x, p.y, p.a);
  const steps = Math.round(seconds * hz);
  for (let k = 1; k <= steps; k++) {
    trackPose(k * dt * speed, r, p);
    stepTruckTrain(train, p.x, p.y, p.a, dt);
    if (onStep) onStep(k);
  }
}

// Punkty obrysu części j (co ~0,25 j.): ciągnik — profil rufy `tail` i wyloty dysz; naczepa — prostokąt bryły.
function outline(train, j) {
  const out = [];
  const add = (x0, y0, x1, y1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.25));
    for (let k = 0; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  };
  if (j === 0) {
    const t = TRUCK_TRACTORS[train.tractorId];
    const tl = t.tail;
    add(tl[0][0], -tl[0][1], tl[0][0], tl[0][1]);
    for (let k = 1; k < tl.length; k++) {
      add(tl[k - 1][0], tl[k - 1][1], tl[k][0], tl[k][1]);
      add(tl[k - 1][0], -tl[k - 1][1], tl[k][0], -tl[k][1]);
    }
    for (const [x, y, d] of t.nozzles) add(x, y - d / 2, x, y + d / 2);
  } else {
    const [x0, x1, hw] = TRUCK_TRAILER.body;
    add(x0, -hw, x1, -hw); add(x1, -hw, x1, hw); add(x1, hw, x0, hw); add(x0, hw, x0, -hw);
  }
  const c = Math.cos(train.a[j]);
  const s = Math.sin(train.a[j]);
  const q = train.scale;
  return out.map(([x, y]) => [train.x[j] + q * (x * c - y * s), train.y[j] + q * (x * s + y * c)]);
}

// Czy któryś punkt obrysu poprzednika wchodzi w prostokąt naczepy i (zapas `pad` w skali 1).
function cornerOverlap(train, i, pad = 0) {
  const pts = outline(train, i - 1);
  const c = Math.cos(train.a[i]);
  const s = Math.sin(train.a[i]);
  const q = train.scale;
  const [x0, x1, hw] = TRUCK_TRAILER.body;
  for (const [wx, wy] of pts) {
    const dx = wx - train.x[i];
    const dy = wy - train.y[i];
    const lx = (dx * c + dy * s) / q;
    const ly = (-dx * s + dy * c) / q;
    if (lx > x0 - pad && lx < x1 + pad && Math.abs(ly) < hw + pad) return true;
  }
  return false;
}

test('przeguby trzymają się: hak poprzednika = oko dyszla następcy na każdym kroku', () => {
  for (const id of TRUCK_TRACTOR_IDS) {
    const train = createTruckTrain(id, 5);
    const h = {};
    runTrack(train, {
      r: 100, seconds: 12, onStep: () => {
        for (let i = 1; i < train.count; i++) {
          truckTrainHitch(train, i, h);
          const lead = i === 1 ? train.hitchHead : train.hitchRear;
          const lx = train.x[i - 1] + Math.cos(train.a[i - 1]) * lead;
          const ly = train.y[i - 1] + Math.sin(train.a[i - 1]) * lead;
          const fx = train.x[i] + Math.cos(train.a[i]) * train.kingpin;
          const fy = train.y[i] + Math.sin(train.a[i]) * train.kingpin;
          assert.ok(Math.hypot(lx - h.x, ly - h.y) < 1e-6, 'hak poprzednika');
          assert.ok(Math.hypot(fx - h.x, fy - h.y) < 1e-6, 'oko dyszla');
        }
      }
    });
  }
});

test('zgięcie nie przekracza ogranicznika nawet przy skoku kursu czoła', () => {
  const train = createTruckTrain('heavy', 5);
  placeTruckTrain(train, 0, 0, 0);
  // Obrót czoła w miejscu o 180° w 20 krokach — ogranicznik obraca całe ogniwa.
  for (let k = 1; k <= 20; k++) stepTruckTrain(train, 0, 0, k * Math.PI / 20, 1 / 60);
  assert.ok(train.limited >= 1, 'ogranicznik zadziałał');
  for (let i = 1; i < train.count; i++) assert.ok(Math.abs(train.bend[i]) <= train.maxBend + 1e-6, `przegub ${i}`);
});

test('przy maksymalnym zgięciu obrysy sąsiadów się nie dotykają (także 1 × 1)', () => {
  for (const scale of [TRUCK_SCALES.module, TRUCK_SCALES.container]) {
    for (const id of TRUCK_TRACTOR_IDS) {
      const train = createTruckTrain(id, 3, { scale });
      placeTruckTrain(train, 0, 0, 0);
      for (const sign of [1, -1]) {
        placeTruckTrain(train, 0, 0, 0);
        // Pełny skręt czoła: każdy kolejny przegub dochodzi do ogranicznika.
        for (let k = 1; k <= 80; k++) stepTruckTrain(train, 0, 0, sign * k * 0.08, 1 / 60);
        for (let i = 1; i < train.count; i++) {
          assert.ok(!cornerOverlap(train, i, 0.3), `${id} skala ${scale}, przegub ${i}, zgięcie ${(train.bend[i] * 57.3).toFixed(1)}°`);
        }
      }
    }
  }
});

test('zgodność 60 / 120 Hz: poza końcowa prawie bez różnicy', () => {
  for (const r of [70, 160, 400]) {
    const a = createTruckTrain('heavy', 5);
    const b = createTruckTrain('heavy', 5);
    runTrack(a, { r, hz: 60, seconds: 30, speed: 210 });
    runTrack(b, { r, hz: 120, seconds: 30, speed: 210 });
    for (let i = 0; i < a.count; i++) {
      assert.ok(Math.hypot(a.x[i] - b.x[i], a.y[i] - b.y[i]) < 0.6, `r ${r}, część ${i}: ${Math.hypot(a.x[i] - b.x[i], a.y[i] - b.y[i])} j.`);
      assert.ok(Math.abs(a.a[i] - b.a[i]) < 0.015, `r ${r}, część ${i}: kąt`);
    }
  }
});

test('stan ustalony na łuku: zgięcie zgodne z geometrią, rachunek z danych, ogranicznik nie pracuje', () => {
  const Rmin = truckMinTurnRadius('standard', 4);
  assert.ok(Rmin > 40 && Rmin < 90, `promień ${Rmin}`);
  // Długi łuk o promieniu 1,05 Rmin: ogranicznik nie pracuje, naczepy się układają, zgięcia jak z rachunku.
  const R = Rmin * 1.05;
  const train = createTruckTrain('standard', 4);
  placeTruckTrain(train, R, 0, Math.PI / 2);
  const dt = 1 / 60;
  const w = 120 / R;
  let limitedTotal = 0;
  for (let k = 1; k <= 60 * 40; k++) {
    const t = k * dt * w;
    stepTruckTrain(train, R * Math.cos(t), R * Math.sin(t), t + Math.PI / 2, dt);
    if (k > 60 * 20) limitedTotal += train.limited;
  }
  assert.equal(limitedTotal, 0, 'ogranicznik nie pracuje przy R ≥ Rmin');
  let worst = 0;
  for (let i = 1; i < train.count; i++) {
    assert.ok(train.bend[i] < 0, `zgięcie ku środkowi: ${train.bend[i]}`);
    worst = Math.max(worst, -train.bend[i]);
  }
  assert.ok(Math.abs(worst - truckSteadyBend('standard', 4, R)) < 0.02, `zgięcie ${worst} kontra rachunek ${truckSteadyBend('standard', 4, R)}`);
});

test('cofanie: kolejne zgięcia nie przekraczają ogranicznika, światła wiedzą o wstecznym', () => {
  const train = createTruckTrain('standard', 3);
  placeTruckTrain(train, 0, 0, 0);
  const dt = 1 / 60;
  for (let k = 1; k <= 60 * 8; k++) {
    const a = Math.sin(k * dt) * 0.15;
    stepTruckTrain(train, -k * dt * 60, Math.sin(k * dt) * 6, a, dt);
    for (let i = 1; i < train.count; i++) {
      assert.ok(Math.abs(train.bend[i]) <= train.maxBend + 1e-6);
      assert.ok(!cornerOverlap(train, i, 0.2), `przegub ${i}`);
    }
  }
  assert.equal(train.reverse, true);
});

test('interpolacja pozy: alfa 0 i 1 = końce kroku, kąt przez krótszy łuk', () => {
  const train = createTruckTrain('light', 1);
  placeTruckTrain(train, 0, 0, Math.PI - 0.01);
  stepTruckTrain(train, 4, 0, -Math.PI + 0.01, 1 / 60);
  const o = {};
  truckTrainPose(train, 0, 0, o);
  assert.ok(Math.abs(o.x) < 1e-9);
  truckTrainPose(train, 0, 1, o);
  assert.ok(Math.abs(o.x - 4) < 1e-9);
  truckTrainPose(train, 0, 0.5, o);
  assert.ok(Math.abs(Math.abs(o.a) - Math.PI) < 1e-6, 'środek przez ±π');
});

test('krok bez alokacji w stanie ustalonym', async () => {
  const train = createTruckTrain('heavy', 5);
  const p = {};
  const dt = 1 / 60;
  let s = 0;
  const o = {};
  const step = () => {
    s += 3;
    trackPose(s, 120, p);
    stepTruckTrain(train, p.x, p.y, p.a, dt);
    truckTrainPose(train, 3, 0.5, o);
  };
  trackPose(0, 120, p);
  placeTruckTrain(train, p.x, p.y, p.a);
  const warm = () => { for (let i = 0; i < 3000; i++) step(); };
  warm();
  // Sufit: pakowanie trzech liczb argumentów przy wywołaniu (48 B), funkcja kroku sama nie alokuje.
  const limit = 2000 * 64;
  const bytes = await untilSteady(() => allocatedBytes(step, 2000), (b) => b < limit, { warm });
  assert.ok(bytes < limit, `alokacje ${bytes} B na 2000 kroków`);
});

test('dane: moduł = chwyt L, długości, ładowność, światła znane, atlas w płótnie', () => {
  assert.equal(TRUCK_MODULE.L, CARGO_CONTAINER.L * 2 + CARGO_CONTAINER.gap);
  assert.equal(TRUCK_MODULE.W, CARGO_CONTAINER.W * 2 + CARGO_CONTAINER.gap);
  assert.ok(TRUCK_TRAILER.body[1] - TRUCK_TRAILER.body[0] > TRUCK_MODULE.L, 'moduł mieści się na ramie');
  assert.ok(TRUCK_TRAILER.body[2] * 2 > TRUCK_MODULE.W);
  assert.ok(truckRigLength('light', 1) < 90);
  assert.ok(truckRigLength('heavy', 5) < 300);
  assert.ok(truckRigWidth('heavy') < 40);
  assert.equal(truckRigTonnes(2), 60);
  assert.equal(TRUCK_TRACTORS.heavy.trailersMax, 5);
  assert.ok(TRUCK_LIVERIES.length >= 5);
  for (const id of TRUCK_TRACTOR_IDS) {
    for (const [, , kind] of TRUCK_TRACTORS[id].lights) assert.ok(TRUCK_LIGHT_KINDS[kind], kind);
    for (const [, , kind] of TRUCK_TRAILER.lights) assert.ok(TRUCK_LIGHT_KINDS[kind], kind);
    assert.ok(TRUCK_TRACTORS[id].nozzles.length >= 2);
  }
  // Emitery HDR > 1 (próg bloomu gry ~0,9).
  for (const k of Object.values(TRUCK_LIGHT_KINDS)) assert.ok(k.power > 1);
  const [W, H] = TRUCK_ATLAS.size;
  const cells = Object.entries(TRUCK_ATLAS_CELLS);
  assert.equal(cells.length, Object.keys(TRUCK_SPRITE_BOUNDS).length);
  for (const [name, c] of cells) {
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H, `${name} w atlasie`);
    assert.ok(TRUCK_SPRITE_PNG[name], `${name}: ścieżka PNG`);
  }
  for (const c of Object.values(TRUCK_CARGO)) for (const s of c.sprites) assert.ok(TRUCK_ATLAS_CELLS[s], s);
  assert.equal(truckCargoForResource('fuel_rods'), 'hazmat');
  assert.deepEqual(truckHexLinear('#ffffff'), [1, 1, 1]);
});
