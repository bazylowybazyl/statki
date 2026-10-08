import test from 'node:test';
import assert from 'node:assert/strict';

// Omijanie wraków przez okręty AI (2026-10-08): indeks dużych wraków (src/ai/aiWreckIndex.js)
// i wrak jako KAPSUŁA w ograniczniku prędkości przed przeszkodą (capitalAI.js:
// capitalObstacleSpeedCap / considerWreck) oraz w objeździe. W grze:
// node scripts/webgpu/wraki-omijanie-gra.mjs (skrzydło przez pole wraków, A/B --omijanie 0).

globalThis.window = globalThis.window || {};
Object.assign(globalThis.window, {
  wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
  queryAIGrid: null,
  ship: null,
  __frameId: 1,
  bullets: [],
  __npcRocketThreats: [],
  __playerRocketThreats: []
});

const { capitalObstacleSpeedCap, WRECK_AVOID_TUNE } = await import('../src/ai/capitalAI.js');
const Idx = await import('../src/ai/aiWreckIndex.js');
const { stepShipFlight, resolveShipFlightSpec } = await import('../src/game/flight/shipFlightModel.js');

const wreck = (x, y, radius, angle = 0, extra = {}) => ({ x, y, vx: 0, vy: 0, radius, angle, dead: false, isCollidable: true, ...extra });
const frigate = (x, y, vx = 0, vy = 0) => ({ x, y, vx, vy, angle: 0, angVel: 0, radius: 111, type: 'frigate_pd', shipFrame: 'terran_frigate' });

test('wreck index keeps only big, live, collidable wrecks, sorted by x', () => {
  const idx = Idx.rebuildWreckIndex([
    wreck(500, 0, 300), wreck(-200, 0, 200), wreck(100, 0, 40),
    wreck(50, 0, 300, 0, { dead: true }), wreck(60, 0, 300, 0, { isCollidable: false }), null
  ]);
  assert.equal(idx.count, 2);
  assert.deepEqual([idx.x[0], idx.x[1]], [-200, 500]);
  assert.equal(idx.rMax, 300);
  assert.equal(Idx.wreckLowerBound(0), 1);
  assert.equal(Idx.wreckLowerBound(-1e9), 0);
  assert.equal(Idx.wreckLowerBound(1e9), 2);
  Idx.resetWreckIndex();
});

test('a long wreck across the course brakes the ship, one off to the side does not', () => {
  const spec = resolveShipFlightSpec(frigate(0, 0));
  // Wrak pancernika (pół-długość 391) w poprzek kursu +x, 1,2 km przed fregatą (w horyzoncie
  // hamowania; dalszy wrak ogranicznik bierze, gdy wejdzie w horyzont).
  Idx.rebuildWreckIndex([wreck(1200, 0, 391, Math.PI / 2)]);
  window.__frameId++;
  const ahead = capitalObstacleSpeedCap(frigate(0, 0, 600, 0), 1, 0, 1, 0, spec, true);
  assert.ok(Number.isFinite(ahead), `wrak na kursie nie ogranicza prędkości: ${ahead}`);
  // Mija koniec wraku o włos (środek 450 j. w bok, koniec osi ~260) — dalej blokada.
  window.__frameId++;
  const end = capitalObstacleSpeedCap(frigate(0, 450, 600, 0), 1, 0, 1, 0, spec, true);
  assert.ok(Number.isFinite(end), 'okręt przy końcu długiego wraku przelatuje przez niego');
  // Daleko z boku — wolno.
  window.__frameId++;
  const side = capitalObstacleSpeedCap(frigate(0, 1400, 600, 0), 1, 0, 1, 0, spec, true);
  assert.equal(side, Infinity);
  // Za plecami — wolno.
  window.__frameId++;
  const behind = capitalObstacleSpeedCap(frigate(0, 0, -600, 0), -1, 0, -1, 0, spec, true);
  assert.equal(behind, Infinity);
  Idx.resetWreckIndex();
});

test('a ship already touching a wreck may back off and slide along it, only diving in is blocked', () => {
  const spec = resolveShipFlightSpec(frigate(0, 0));
  Idx.rebuildWreckIndex([wreck(0, 200, 391, 0)]);   // oś wraku wzdłuż x, 200 j. nad fregatą
  const cases = [[0, -1, false], [1, 0, false], [-1, 0, false], [0, 1, true]];
  for (const [dx, dy, blocked] of cases) {
    window.__frameId++;
    const cap = capitalObstacleSpeedCap(frigate(0, 0), dx, dy, NaN, NaN, spec, true);
    assert.equal(cap === 0, blocked, `kierunek (${dx}, ${dy}): ${cap}`);
  }
  Idx.resetWreckIndex();
});

test('a frigate flies around a long wreck lying on its way instead of ramming it', () => {
  const DT = 1 / 120;
  const ff = frigate(-3000, 0);
  const w = wreck(0, 0, 391, Math.PI / 2);
  Idx.rebuildWreckIndex([w]);
  let minGap = Infinity;
  try {
    for (let i = 0; i < 120 * 14; i++) {
      window.__frameId++;
      if (i % 6 === 0) window.capitalArriveTo(ff, 4000, 0, { dt: 1 / 20, speedMode: 'cruise' });
      stepShipFlight(ff, DT);
      // Odległość środka fregaty od osi wraku (odcinek ±(391 − 129) wzdłuż y) minus pół-szerokości.
      const sy = Math.max(-262, Math.min(262, ff.y));
      minGap = Math.min(minGap, Math.hypot(ff.x - 0, ff.y - sy) - 129 - 111 * 0.4);
    }
  } finally {
    Idx.resetWreckIndex();
  }
  assert.ok(Math.hypot(ff.x - 4000, ff.y) < 500, `nie dotarła: ${ff.x.toFixed(0)},${ff.y.toFixed(0)}`);
  assert.ok(minGap > 0, `przeleciała przez wrak: ${minGap.toFixed(0)}`);
});

test('wreck avoidance off: the same ship ignores the wreck (A/B switch)', () => {
  const spec = resolveShipFlightSpec(frigate(0, 0));
  Idx.rebuildWreckIndex([wreck(1200, 0, 391, Math.PI / 2)]);
  WRECK_AVOID_TUNE.enabled = false;
  try {
    window.__frameId++;
    assert.equal(capitalObstacleSpeedCap(frigate(0, 0, 600, 0), 1, 0, 1, 0, spec, true), Infinity);
  } finally {
    WRECK_AVOID_TUNE.enabled = true;
    Idx.resetWreckIndex();
  }
});
