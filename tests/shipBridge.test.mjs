import test from 'node:test';
import assert from 'node:assert/strict';

import { DestructorSystem as D, disposeHexBody } from '../src/game/destructor.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import {
  BRIDGE_EVENT,
  BRIDGE_KILL_TIMELINE,
  BRIDGE_LAYOUT_PROPOSALS,
  applyCommandLossVisuals,
  attachShipBridges,
  bridgePngToWorld,
  bridgeZoneContains,
  bridgeZoneDistance,
  compactBridgeDef,
  detachShipBridges,
  evaluateShipBridges,
  formatBridgesJson,
  getBridgeAimPoint,
  getBridgeVent,
  hexCellCenter,
  noteBridgeHit,
  normalizeBridgeDef,
  prepareWindowWave,
  sampleEngineGlow,
  sampleEngineThrottle,
  sampleNavLight,
  sampleVentStrength,
  sampleWindowLight,
  updateShipBridges,
  validateBridgeLayout
} from '../src/game/shipBridge.js';
import { makeDestructorHull as hull } from './helpers/destructorHull.mjs';

// Pełny prostokąt 320×100 (alfa 255 wszędzie), skala PNG → render = 1, więc
// przestrzeń PNG = przestrzeń lokalna kadłuba. Mostek w rufowej połowie.
const STERN_BRIDGE = { id: 'mostek', x: -100, y: 0, w: 60, h: 40, armorMul: 3, killFrac: 0.6 };

function cellPng(e, s) {
  const c = hexCellCenter(s.c, s.r, s.radius);
  return { x: c.x - e.hexGrid.srcWidth * 0.5, y: c.y - e.hexGrid.srcHeight * 0.5 };
}

// Strzał jak w grze: pierwszy żywy heks na odcinku (sweepImpact), potem
// applyImpact w punkcie trafienia z prędkością pocisku.
function fire(e, x0, y0, x1, y1, dmg, speed = 6000) {
  const hit = D.sweepImpact(e, x0, y0, x1, y1, 0);
  if (!hit) return false;
  const wx = hit.worldX;
  const wy = hit.worldY;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  D.applyImpact(e, wx, wy, dmg, { x: (x1 - x0) / len * speed, y: (y1 - y0) / len * speed });
  return true;
}

function withSplitScene(run) {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const oldQueue = D.splitQueue;
  const oldPool = D._wreckPool;
  const entities = [];
  try {
    globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) };
    globalThis.window = { wrecks: [] };
    D.splitQueue = [];
    D._wreckPool = [];
    run(entities);
  } finally {
    for (const e of new Set([...entities, ...globalThis.window.wrecks])) disposeHexBody(e);
    D.splitQueue = oldQueue;
    D._wreckPool = oldPool;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
}

test('marking is exact by cell (c, r), independent of the moving gridX', () => {
  const e = hull({ width: 320, height: 100 });
  try {
    // Wgniecenia przed podpięciem nie mogą zmienić przynależności.
    for (const s of e.hexGrid.shards) { s.gridX += 9; s.gridY -= 7; }
    const st = attachShipBridges(e, [STERN_BRIDGE], { windows: false });
    assert.ok(st, 'state created');
    const bridge = st.bridges[0];
    assert.ok(bridge.total > 20, `bridge has hexes: ${bridge.total}`);
    let inside = 0;
    for (const s of e.hexGrid.shards) {
      const p = cellPng(e, s);
      const shouldBe = bridgeZoneContains(normalizeBridgeDef(STERN_BRIDGE), p.x, p.y);
      assert.equal(s.__bridgeId === 'mostek', shouldBe, `cell ${s.c},${s.r}`);
      if (shouldBe) inside++;
    }
    assert.equal(inside, bridge.total);
  } finally { disposeHexBody(e); }
});

test('armor multiplies bridge hex HP once, re-attach does not stack, detach restores', () => {
  const e = hull({ width: 320, height: 100 });
  try {
    const base = e.hexGrid.shards.map((s) => s.maxHp);
    attachShipBridges(e, [STERN_BRIDGE], { windows: false });
    attachShipBridges(e, [STERN_BRIDGE], { windows: false });
    e.hexGrid.shards.forEach((s, i) => {
      const mul = s.__bridgeId ? 3 : 1;
      assert.ok(Math.abs(s.maxHp - base[i] * mul) < 1e-9, 'maxHp');
      assert.ok(Math.abs(s.hp - base[i] * mul) < 1e-9, 'hp');
    });
    // Strefa przesunięta na dziób: stare heksy wracają do bazy.
    const moved = normalizeBridgeDef({ ...STERN_BRIDGE, x: 100 });
    attachShipBridges(e, [moved], { windows: false });
    e.hexGrid.shards.forEach((s, i) => {
      const p = cellPng(e, s);
      const mul = bridgeZoneContains(moved, p.x, p.y) ? 3 : 1;
      assert.ok(Math.abs(s.maxHp - base[i] * mul) < 1e-9, `after move ${s.c},${s.r}`);
    });
    detachShipBridges(e);
    e.hexGrid.shards.forEach((s, i) => {
      assert.equal(s.maxHp, base[i]);
      assert.equal(s.__bridgeId, undefined);
    });
  } finally { disposeHexBody(e); }
});

test('command is lost exactly when integrity falls to 1 − killFrac', () => {
  for (const killFrac of [0.3, 0.6, 1.0]) {
    const e = hull({ width: 320, height: 100 });
    try {
      const st = attachShipBridges(e, [{ ...STERN_BRIDGE, killFrac }], { windows: false });
      const bridge = st.bridges[0];
      const total = bridge.total;
      const expected = Math.ceil(total * killFrac - 1e-9);
      const order = bridge.shards.slice();
      let lostAt = -1;
      for (let k = 0; k < order.length; k++) {
        D.destroyShard(e, order[k]);
        const flags = evaluateShipBridges(e, k);
        if (flags & BRIDGE_EVENT.COMMAND_LOST) {
          assert.ok(flags & BRIDGE_EVENT.BRIDGE_LOST);
          lostAt = k + 1;
          break;
        }
        assert.equal(bridge.alive, total - (k + 1));
      }
      assert.equal(lostAt, expected, `killFrac ${killFrac}: ${lostAt} vs ${expected} of ${total}`);
      assert.equal(st.commandLost, true);
      assert.equal(st.cause, 'bridge');
      // Martwy statek nie zgłasza kolejnych zdarzeń.
      D.destroyShard(e, order[order.length - 1]);
      assert.equal(evaluateShipBridges(e, 99), BRIDGE_EVENT.NONE);
    } finally { disposeHexBody(e); }
  }
});

test('heavy hits away from the zone destroy the hull but never the bridge', () => {
  const e = hull({ width: 320, height: 100 });
  try {
    const st = attachShipBridges(e, [STERN_BRIDGE], { windows: false });
    const before = e.hexGrid.activeStructuralCount;
    // Ostrzał od dziobu, ale tylko w przednią połowę: pociski kończą lot
    // na x = 0, więc tunel nie może dojść do mostka.
    for (let i = 0; i < 900; i++) {
      const y = -45 + ((i * 7) % 19) * 5;
      fire(e, 400, y, 0, y, 220);
      assert.equal(evaluateShipBridges(e, i) & BRIDGE_EVENT.COMMAND_LOST, 0);
    }
    assert.ok(before - e.hexGrid.activeStructuralCount > 150, 'the bow is gone');
    assert.equal(st.bridges[0].integrity, 1);
    assert.equal(st.commandLost, false);
  } finally { disposeHexBody(e); }
});

test('a bridge severed together with a hull fragment kills the mother hull', () => {
  withSplitScene((entities) => {
    const e = hull({ width: 320, height: 100, noSplit: false });
    entities.push(e);
    const st = attachShipBridges(e, [{ ...STERN_BRIDGE, x: -120, w: 40 }], { windows: false });
    const total = st.bridges[0].total;
    assert.ok(total > 10);
    // Kolumna 9 (x ≈ 67 px siatki) oddziela rufę (kolumny 0–8) od dziobu.
    for (const s of e.hexGrid.shards.filter((s) => s.c === 9)) D.destroyShard(e, s);
    assert.equal(evaluateShipBridges(e, 1) & BRIDGE_EVENT.COMMAND_LOST, 0, 'the bridge itself is intact');
    D.splitQueue.push(e);
    D.processSplits(entities);
    const wreck = entities.find((w) => w.isWreck);
    assert.ok(wreck, 'the stern left as a wreck');
    assert.ok(wreck.hexGrid.shards.every((s) => s.c <= 8));
    assert.ok(st.bridges[0].shards.every((s) => s.active && !s.isDebris), 'bridge hexes are alive — in the wreck');
    const flags = evaluateShipBridges(e, 2);
    assert.ok(flags & BRIDGE_EVENT.COMMAND_LOST, 'mother hull lost command');
    assert.equal(st.bridges[0].alive, 0);
  });
});

test('severing a fragment WITHOUT the bridge keeps the command', () => {
  withSplitScene((entities) => {
    const e = hull({ width: 320, height: 100, noSplit: false });
    entities.push(e);
    const st = attachShipBridges(e, [{ ...STERN_BRIDGE, x: 110, w: 40 }], { windows: false });
    for (const s of e.hexGrid.shards.filter((s) => s.c === 9)) D.destroyShard(e, s);
    D.splitQueue.push(e);
    D.processSplits(entities);
    assert.ok(entities.some((w) => w.isWreck), 'the stern left');
    assert.equal(evaluateShipBridges(e, 1) & BRIDGE_EVENT.COMMAND_LOST, 0);
    assert.equal(st.bridges[0].integrity, 1);
  });
});

test('backup bridge: command survives the first bridge, dies with the second', () => {
  const e = hull({ width: 320, height: 100 });
  try {
    const st = attachShipBridges(e, [
      { ...STERN_BRIDGE, id: 'glowny' },
      { ...STERN_BRIDGE, id: 'zapasowy', role: 'backup', x: 100 }
    ], { windows: false });
    for (const s of st.bridges[0].shards) D.destroyShard(e, s);
    const f1 = evaluateShipBridges(e, 1);
    assert.ok(f1 & BRIDGE_EVENT.BRIDGE_LOST);
    assert.equal(f1 & BRIDGE_EVENT.COMMAND_LOST, 0);
    assert.equal(st.aliveBridges, 1);
    for (const s of st.bridges[1].shards) D.destroyShard(e, s);
    assert.ok(evaluateShipBridges(e, 2) & BRIDGE_EVENT.COMMAND_LOST);
  } finally { disposeHexBody(e); }
});

test('the cadence probe runs every probeEverySec and is O(1) when nothing died', () => {
  const f = hull({ width: 320, height: 100 });
  try {
    const st = attachShipBridges(f, [STERN_BRIDGE], { windows: false });
    const bridge = st.bridges[0];
    D.destroyShard(f, bridge.shards[0]);
    updateShipBridges(f, 0.016, 0.016);          // timer 0 → liczy od razu
    assert.equal(bridge.alive, bridge.total - 1);
    D.destroyShard(f, bridge.shards[1]);
    updateShipBridges(f, 0.03, 0.046);           // w oknie kadencji — bez liczenia
    assert.equal(bridge.alive, bridge.total - 1);
    updateShipBridges(f, 0.06, 0.106);           // po 0,08 s — liczy
    assert.equal(bridge.alive, bridge.total - 2);
    // Nic nie zginęło: brudne sprawdzenie nie dotyka licznika.
    bridge.alive = -123;
    assert.equal(evaluateShipBridges(f, 0.2), BRIDGE_EVENT.NONE);
    assert.equal(bridge.alive, -123);
  } finally { disposeHexBody(f); }
});

test('the same shots give the same kill, shot for shot (determinism)', () => {
  const run = () => {
    const e = hull({ width: 320, height: 100 });
    try {
      attachShipBridges(e, [STERN_BRIDGE], { windows: false });
      const trace = [];
      for (let i = 0; i < 1500; i++) {
        const y = -18 + ((i * 13) % 37);
        fire(e, -400, y, 200, y + (i % 3) - 1, 60, 3000);
        const flags = evaluateShipBridges(e, i);
        trace.push(e.bridgeState.bridges[0].alive);
        if (flags & BRIDGE_EVENT.COMMAND_LOST) return { shots: i + 1, trace };
      }
      return { shots: -1, trace };
    } finally { disposeHexBody(e); }
  };
  const a = run();
  const b = run();
  assert.ok(a.shots > 0, 'the stern fire reaches the bridge');
  assert.deepEqual(a, b);
});

test('aim point and vent direction follow the hull transform', () => {
  const e = hull({ width: 320, height: 100, x: 1000, y: 500, angle: Math.PI / 2 });
  try {
    attachShipBridges(e, [STERN_BRIDGE], { windows: false });
    const p = getBridgeAimPoint(e, { x: 0, y: 0 }, { mode: 'center' });
    assert.ok(Math.abs(p.x - 1000) < 1e-6 && Math.abs(p.y - 400) < 1e-6, `${p.x},${p.y}`);
    // Strzelec „za rufą” (lokalnie −X) — najbliższy żywy heks mostka jest na
    // rufowym brzegu strefy.
    const exposed = getBridgeAimPoint(e, { x: 0, y: 0 }, { mode: 'exposed', fromX: 1000, fromY: -2000 });
    assert.ok(exposed.y < 400 - 20, `exposed hex is on the stern side: ${exposed.y}`);
    // Pocisk leci wzdłuż lokalnego +X (świat: +Y przy kącie 90°); gaz ucieka tunelem wstecz.
    noteBridgeHit(e, 1000, 380, 0, 5000, 10);
    for (const s of e.bridgeState.bridges[0].shards) D.destroyShard(e, s);
    assert.ok(evaluateShipBridges(e, 10.1) & BRIDGE_EVENT.COMMAND_LOST);
    const vent = getBridgeVent(e);
    assert.ok(vent.dirX < -0.99, `vent points back toward the shooter: ${vent.dirX},${vent.dirY}`);
  } finally { disposeHexBody(e); }
});

test('windows sit on bridge hexes inside the zone; the blackout wave starts at the breach', () => {
  const e = hull({ width: 320, height: 100 });
  try {
    const st = attachShipBridges(e, [STERN_BRIDGE], { windowColor: '#ffa050' });
    const win = st.windows;
    assert.ok(win.count >= 6, `windows: ${win.count}`);
    const def = normalizeBridgeDef(STERN_BRIDGE);
    for (let i = 0; i < win.count; i++) {
      assert.ok(bridgeZoneContains(def, win.px[i], win.py[i]));
      assert.equal(win.shard[i].__bridgeId, 'mostek');
    }
    noteBridgeHit(e, -130, 0, 4000, 0, 0);
    for (const s of st.bridges[0].shards) D.destroyShard(e, s);
    evaluateShipBridges(e, 0.1);
    prepareWindowWave(e);
    let nearest = 0;
    for (let i = 1; i < win.count; i++) if (win.delay[i] < win.delay[nearest]) nearest = i;
    assert.ok(win.px[nearest] < -100, 'the first window to die is on the breach side');
  } finally { disposeHexBody(e); }
});

test('kill timeline: flicker then darkness, engines choke to silence, the vent decays', () => {
  const T = BRIDGE_KILL_TIMELINE;
  assert.equal(sampleWindowLight(-1, 0, 0.3), 1);
  assert.equal(sampleWindowLight(0.01, 0, 0.3), 1, 'overload flash at t = 0');
  assert.equal(sampleWindowLight(T.windowFlickerEnd + 0.2 + T.windowFade + 0.01, 0.2, 1), 0);
  assert.equal(sampleNavLight(0.1, 0, 0.5), 1);
  assert.equal(sampleNavLight(T.navDelay + 0.5 + 0.01, 0.5, 0.5), 0);
  assert.equal(sampleEngineThrottle(0.1, 0.5), 1);
  assert.equal(sampleEngineThrottle(T.engineChokeEnd * 1.2, 0.99), 0);
  let sawCough = false;
  let sawGap = false;
  for (let t = T.engineChokeStart; t < T.engineChokeEnd * 0.8; t += 0.01) {
    const v = sampleEngineThrottle(t, 0.4);
    if (v > 0.3) sawCough = true;
    if (v < 0.1) sawGap = true;
  }
  assert.ok(sawCough && sawGap, 'the choke is uneven, not a fade');
  assert.equal(sampleVentStrength(-0.1), 0);
  assert.ok(sampleVentStrength(0.1) > 0.7);
  assert.ok(sampleVentStrength(1.5) < sampleVentStrength(0.5));
  assert.equal(sampleVentStrength(T.ventEnd + 0.01), 0);
  // Deterministycznie: ta sama chwila, ten sam wynik.
  assert.equal(sampleWindowLight(0.23, 0.1, 0.77), sampleWindowLight(0.23, 0.1, 0.77));
});

test('command-loss visuals: engines and their idle glow die, lights go out, detach restores', () => {
  const T = BRIDGE_KILL_TIMELINE;
  const e = hull({ width: 320, height: 100 });
  try {
    e.visual = {
      mainThrusters: [{ offset: { x: -150, y: 10 } }, { offset: { x: -150, y: -10 }, vfxScale: 1.3 }],
      torqueThrusters: [{ offset: { x: 0, y: 40 } }]
    };
    const lights = { position: [{ x: 100, y: 0 }, { x: -100, y: 30 }], road: [{ x: 0, y: 0 }] };
    e.editorLights = lights;
    const st = attachShipBridges(e, [STERN_BRIDGE], { windows: false });
    for (const s of st.bridges[0].shards) D.destroyShard(e, s);
    assert.ok(evaluateShipBridges(e, 10) & BRIDGE_EVENT.COMMAND_LOST);
    const [a, b] = e.visual.mainThrusters;

    applyCommandLossVisuals(e, 10.1, { baseThrottle: 0.6 });
    assert.equal(a.__throttle, 0.6);
    assert.equal(a.vfxScale, 1, 'the flame keeps its size before the choke');
    assert.equal(b.vfxScale, 1.3);
    assert.equal(e.editorLights.position.length, 2, 'lights still on');

    const late = 10 + T.engineChokeEnd * 1.15 + T.engineCoolDown + 0.01;
    applyCommandLossVisuals(e, late, { baseThrottle: 0.6 });
    for (const t of [a, b, e.visual.torqueThrusters[0]]) {
      assert.equal(t.__throttle, 0);
      // Płomyk postojowy (świeci przy ciągu 0) znika razem z dyszą.
      assert.ok(t.vfxScale > 0 && t.vfxScale <= 0.0013, `vfxScale ${t.vfxScale}`);
    }
    assert.equal(e.editorLights.position.length, 0);
    assert.equal(e.editorLights.road.length, 0);
    assert.equal(sampleEngineGlow(0, 0.5), 1);
    assert.ok(sampleEngineGlow(T.engineChokeEnd, 0.5) < sampleEngineGlow(T.engineChokeStart + 0.2, 0.5));

    detachShipBridges(e);
    assert.equal(a.vfxScale, undefined);
    assert.equal(b.vfxScale, 1.3);
    assert.equal(a.__throttle, undefined);
    assert.deepEqual(e.editorLights, lights);
  } finally { disposeHexBody(e); }
});

test('a render pose overrides the physics pose (interpolated player hull)', () => {
  const e = hull({ width: 320, height: 100, x: 100, y: 50, angle: 0.3 });
  try {
    attachShipBridges(e, [STERN_BRIDGE], { windows: false });
    const a = bridgePngToWorld(e, -100, 0, { x: 0, y: 0 });
    const b = bridgePngToWorld(e, -100, 0, { x: 0, y: 0 }, { x: 110, y: 50, angle: 0.3 });
    assert.ok(Math.abs(b.x - a.x - 10) < 1e-9 && Math.abs(b.y - a.y) < 1e-9);
    const c = bridgePngToWorld(e, -100, 0, { x: 0, y: 0 }, { x: 100, y: 50, angle: 0.3 + Math.PI });
    assert.ok(Math.abs((c.x - 100) + (a.x - 100)) < 1e-9, 'the angle comes from the pose too');
  } finally { disposeHexBody(e); }
});

test('proposed zones clear every hardpoint, engine slot and core of the editor defaults', () => {
  // Sonda hardpointu = 14 px renderu → w px PNG: 14 / (render / PNG).
  const margins = { atlas: 14 / (1800 / 3747), battleship: 14 / (624 / 1158), pirate_battleship: 14 / (720 / 1158) };
  for (const [key, entry] of Object.entries(BRIDGE_LAYOUT_PROPOSALS)) {
    const cfg = SHIP_EDITOR_DEFAULTS.ships[key];
    assert.ok(cfg, `editor defaults for ${key}`);
    for (const [variant, list] of Object.entries(entry.variants)) {
      const issues = validateBridgeLayout(list, cfg, { margin: margins[key] });
      assert.deepEqual(issues, [], `${key}/${variant}: ${JSON.stringify(issues)}`);
    }
  }
});

test('export JSON round-trips through normalization in PNG space', () => {
  const def = { id: 'm', x: -281.23, y: 1.56, w: 236.04, h: 92.2, rot: 370, armorMul: 2.345, killFrac: 0.555 };
  const json = formatBridgesJson([def]);
  const back = JSON.parse(json)[0];
  assert.deepEqual(back, compactBridgeDef(def));
  assert.equal(back.rot, 10);
  const n = normalizeBridgeDef(back);
  assert.ok(Math.abs(bridgeZoneDistance(n, n.x, n.y) + Math.min(n.w, n.h) / 2) < 1e-6);
});
