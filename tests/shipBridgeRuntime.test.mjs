// Klej mostków w grze (src/game/shipBridgeRuntime.js) na kadłubach belkowych: klucze kadłubów, podpięcie
// i zdjęcie stanu, hulk po utracie dowodzenia (agonia, dryf, wygląd). Dawna wersja heksowa usunięta
// 2026-10-19; mechanika mostków na belkach: tests/shipBridgeBeams.test.mjs, tests/shipBridge.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

// hullBodies.js czyta window.wrecks — przed importem.
globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];

const { HullBodies } = await import('../src/game/hullBodies.js');
const { makeBridgeShip } = await import('./helpers/bridgeHulls.mjs');
const { bridgeBeamHull, bridgeCellNode, beamLatticeToWorld } = await import('../src/game/shipBridgeBeams.js');
const { BRIDGE_KILL_TIMELINE, BRIDGE_LAYOUT_PROPOSALS } = await import('../src/game/shipBridge.js');
const {
  BRIDGE_EVENT,
  BRIDGE_HULK_SEC,
  applyBridgeHulkVisuals,
  attachEntityBridges,
  beginBridgeHulk,
  bridgePngToWorld,
  isBridgeHulk,
  noteBridgeHit,
  releaseShipBridges,
  resolveBridgeHullKey,
  resolveBridgeLayout,
  stepBridgeHulk,
  updateShipBridges
} = await import('../src/game/shipBridgeRuntime.js');

const ZONE = [{ ...BRIDGE_LAYOUT_PROPOSALS.battleship.variants.standard[0], armorMul: 1.5, killFrac: 0.35 }];

// Wszystkie żywe komórki mostka b — krater na miarę komórki w środku każdej.
function killAllCells(e, b = 0) {
  const hull = bridgeBeamHull(e);
  const bridge = e.bridgeState.bridges[b];
  const cs = hull.body.cellSize;
  const p = {};
  for (let k = 0; k < bridge.total; k++) {
    if (bridgeCellNode(hull, bridge.cellX[k], bridge.cellY[k]) < 0) continue;
    beamLatticeToWorld(hull, (bridge.cellX[k] + 0.5) * cs, (bridge.cellY[k] + 0.5) * cs, p);
    HullBodies.impact(e, p.x, p.y, 1, null, { craterRadius: cs * 0.45 });
  }
}

test('bridge hull keys follow the NPC editor mapping; other hulls have no bridges', () => {
  assert.equal(resolveBridgeHullKey({ type: 'battleship' }), 'battleship');
  assert.equal(resolveBridgeHullKey({ type: 'battleship', isPirate: true }), 'pirate_battleship');
  assert.equal(resolveBridgeHullKey({ type: 'battleship', shipFrame: 'atlas' }), 'atlas');
  // Od 2026-09-25 mostki ma cała flota bojowa (i lokomotywa megafrachtowca), od E13 (2026-10-22) — kadłuby ruchu v2
  // (rama frachtowca); holownik serwisowy i van bez ramy nie.
  assert.equal(resolveBridgeHullKey({ type: 'destroyer' }), 'destroyer');
  assert.equal(resolveBridgeHullKey({ type: 'freighter-large', shipFrame: 'long_haul_freighter' }), 'long_haul_freighter');
  assert.equal(resolveBridgeHullKey({ type: 'freighter-large' }), null);
  assert.equal(resolveBridgeHullKey({ type: 'service_tug', shipFrame: 'service_tug' }), null);
  assert.equal(resolveBridgeHullKey(null), null);
  assert.equal(resolveBridgeLayout('atlas').length, 2, 'Atlas: main + backup by default');
  assert.equal(resolveBridgeLayout('battleship').length, 1);
  assert.equal(resolveBridgeLayout('destroyer').length, 1);
  assert.equal(resolveBridgeLayout('long_haul_freighter').length, 1);
  assert.equal(resolveBridgeLayout('service_tug'), null);
});

test('a hull without bridges gets nothing and drops a stale bridge state', () => {
  const e = makeBridgeShip(HullBodies, 'battleship');
  assert.ok(attachEntityBridges(e, { bridges: ZONE }));
  // `=== null`, nie assert.equal: przy porażce assert rozwija w komunikacie
  // cały stan mostka z kadłubem bez limitu głębokości — brak pamięci.
  assert.ok(attachEntityBridges(e, { key: 'service_tug' }) === null, 'holownik serwisowy bez mostków');
  assert.ok(e.bridgeState === null, 'stary stan mostków zdjęty');
  // Encja bez własnego kadłuba belkowego (cudzy rekord kadłuba) mostków nie ma.
  const other = { type: 'battleship', beamHull: e.beamHull, bridgeState: { bridges: [] } };
  assert.ok(attachEntityBridges(other) === null);
  assert.ok(other.bridgeState === null);
});

test('command loss turns the ship into a drifting hulk that ends after the agony', () => {
  const e = makeBridgeShip(HullBodies, 'battleship', 0, 0, 0);
  e.vx = 30; e.vy = 0; e.angVel = 0;
  e.visual = { mainThrusters: [{ offset: { x: -150, y: 0 }, __throttle: 0.8 }], torqueThrusters: [] };
  e.shield = { val: 500, max: 500, regenTimer: 0 };
  const st = attachEntityBridges(e, { bridges: ZONE });
  assert.ok(st && !isBridgeHulk(e));
  // Trafienie z burty (pocisk +y świata): gaz ucieka w poprzek dryfu.
  const def = st.bridges[0].def;
  const p = bridgePngToWorld(e, def.x, def.y, {});
  noteBridgeHit(e, p.x, p.y, 0, 900, 10);
  killAllCells(e, 0);
  st.probeTimer = 0;
  const flags = updateShipBridges(e, 0.025, 10);
  assert.ok(flags & BRIDGE_EVENT.COMMAND_LOST);
  assert.ok(isBridgeHulk(e));

  beginBridgeHulk(e);
  assert.equal(e.shield.val, 0, 'no power, no shield');
  assert.equal(e.__bridgeBaseThrottle, 0.8);

  const dt = 1 / 120;
  const x0 = e.x;
  let t = 10;
  let done = false;
  let steps = 0;
  let vMax = 0;
  while (!done && steps < 1000) {
    t += dt;
    done = stepBridgeHulk(e, dt, t);
    vMax = Math.max(vMax, Math.hypot(e.vx, e.vy));
    steps++;
  }
  assert.ok(done, 'the agony ends');
  assert.ok(Math.abs((t - 10) - BRIDGE_HULK_SEC) < 2 * dt, `ends at ${t - 10}`);
  assert.ok(e.x > x0 + 50, 'the hulk keeps drifting');
  // Martwe silniki nie pchają: ponad dryf tylko wyrzut atmosfery (∫ 0,028·L·siła dt ≤ 0,028·L·0,72 s).
  const L = Math.max(st.srcW, st.srcH);
  assert.ok(vMax <= 30 + 0.021 * L, `speed ${vMax.toFixed(2)} ≤ drift + vent push`);

  applyBridgeHulkVisuals([e], 10 + BRIDGE_KILL_TIMELINE.engineChokeEnd * 1.2 + BRIDGE_KILL_TIMELINE.engineCoolDown);
  assert.equal(e.visual.mainThrusters[0].__throttle, 0);
  assert.ok(e.visual.mainThrusters[0].vfxScale < 0.01, 'idle glow gone');

  releaseShipBridges(e);
  assert.equal(e.bridgeState, null);
  assert.equal(e.visual.mainThrusters[0].vfxScale, undefined, 'engines restored for a reused NPC object');
  assert.ok(!isBridgeHulk(e));
});

test('the agony outlasts every effect of the kill sequence', () => {
  const T = BRIDGE_KILL_TIMELINE;
  const lastEngine = T.engineChokeEnd * 1.15 + T.engineCoolDown;
  assert.ok(BRIDGE_HULK_SEC >= T.ventEnd);
  assert.ok(BRIDGE_HULK_SEC >= lastEngine, `hulk ${BRIDGE_HULK_SEC} s vs engines ${lastEngine} s`);
});
