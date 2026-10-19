// Mostki: część ogólna src/game/shipBridge.js (strefy, walidacja, eksport, oś czasu, klucze kadłubów, API
// bez stanu mostków) i mechanika przez to API na kadłubach belkowych (shipBridgeBeams.js — prawdziwe
// sprite'y, HullBodies). Dawna wersja heksowa usunięta 2026-10-19 razem z silnikiem heksów; pozostałe
// przypadki belek (pancerz każdego kadłuba, Atlas z zapasowym, odcięcie mostka, model 3D, celowanie):
// tests/shipBridgeBeams.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

// hullBodies.js czyta window.wrecks — przed importem.
globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];

const { SHIP_EDITOR_DEFAULTS } = await import('../src/data/hardpointEditorDefaults.js');
const { getHullRenderSize, getWeaponTierForHull } = await import('../src/data/ships.js');
const { HullBodies } = await import('../src/game/hullBodies.js');
const { makeBridgeShip } = await import('./helpers/bridgeHulls.mjs');
const RT = await import('../src/game/shipBridgeRuntime.js');
const BB = await import('../src/game/shipBridgeBeams.js');
const {
  BRIDGE_EVENT,
  BRIDGE_KILL_TIMELINE,
  BRIDGE_LAYOUT_PROPOSALS,
  applyCommandLossVisuals,
  bridgeGridToWorld,
  bridgePngToWorld,
  bridgeWorldToGrid,
  bridgeWorldToPng,
  bridgeZoneMargin,
  bridgeZoneContains,
  bridgeZoneDistance,
  compactBridgeDef,
  detachShipBridges,
  evaluateShipBridges,
  formatBridgesJson,
  getBridgeAimPoint,
  noteBridgeHit,
  normalizeBridgeDef,
  prepareWindowWave,
  sampleEngineGlow,
  sampleEngineThrottle,
  sampleNavLight,
  sampleVentStrength,
  sampleWindowLight,
  stepCommandLossDrift,
  updateShipBridges,
  validateBridgeLayout
} = await import('../src/game/shipBridge.js');
const { normalizeBridgeHullKey, resolveBridgeHullKey } = RT;

// Strefa mostka Bellatora (PNG) — na niej przypadki z własnym killFrac / przesunięciem.
const BELLATOR_ZONE = BRIDGE_LAYOUT_PROPOSALS.battleship.variants.standard[0];

function ship(key = 'battleship', x = 0, y = 0, angle = 0, bridges = null) {
  const e = makeBridgeShip(HullBodies, key, x, y, angle);
  RT.attachEntityBridges(e, bridges ? { bridges } : {});
  return e;
}

// Krater na miarę komórki w środku komórki k mostka b (zabija jej węzeł, sąsiadów nie). false — już martwa.
function killCell(e, b, k) {
  const hull = e.beamHull;
  const bridge = e.bridgeState.bridges[b];
  const cs = hull.body.cellSize;
  if (BB.bridgeCellNode(hull, bridge.cellX[k], bridge.cellY[k]) < 0) return false;
  const p = BB.beamLatticeToWorld(hull, (bridge.cellX[k] + 0.5) * cs, (bridge.cellY[k] + 0.5) * cs, {});
  HullBodies.impact(e, p.x, p.y, 1, null, { craterRadius: cs * 0.45 });
  return true;
}

function killNextCell(e, b) {
  const bridge = e.bridgeState.bridges[b];
  for (let k = 0; k < bridge.total; k++) if (killCell(e, b, k)) return true;
  return false;
}

function killAllCells(e, b) {
  const bridge = e.bridgeState.bridges[b];
  for (let k = 0; k < bridge.total; k++) killCell(e, b, k);
}

function cellKeys(bridge) {
  const out = new Set();
  for (let k = 0; k < bridge.total; k++) out.add(`${bridge.cellX[k]},${bridge.cellY[k]}`);
  return out;
}

test('without a bridge state the API gives empty values (no hex fallback)', () => {
  const e = { x: 5, y: 7, angle: 0.4 };
  assert.deepEqual(bridgePngToWorld(e, 10, 10, {}), { x: 5, y: 7 });
  assert.deepEqual(bridgeGridToWorld(e, 10, 10, {}, { x: 1, y: 2, angle: 0 }), { x: 1, y: 2 }, 'poza renderu');
  assert.deepEqual(bridgeWorldToPng(e, 10, 10, {}), { x: 0, y: 0 });
  assert.deepEqual(bridgeWorldToGrid(e, 10, 10, {}), { x: 0, y: 0 });
  assert.equal(getBridgeAimPoint(e, {}), null);
  assert.equal(updateShipBridges(e, 1, 1), BRIDGE_EVENT.NONE);
  assert.equal(evaluateShipBridges(e, 1), BRIDGE_EVENT.NONE);
  assert.equal(detachShipBridges(e), false);
  // Stan bez backendu (nie z attachBeamBridges) — też pusto, bez wyjątku.
  e.bridgeState = { bridges: [], commandLost: true, commandLostAt: 0, vent: null };
  e.vx = 10;
  stepCommandLossDrift(e, 0.1, 1);
  assert.equal(e.vx, 10, 'bez backendu hulk nie dryfuje');
  e.bridgeState.commandLost = false;
  assert.equal(updateShipBridges(e, 1, 1), BRIDGE_EVENT.NONE);
  assert.equal(getBridgeAimPoint(e, {}), null);
  // Encja bez kadłuba belkowego nie dostaje mostków; stary stan zdjęty.
  assert.ok(RT.attachEntityBridges(e, { key: 'battleship' }) === null);
  assert.ok(e.bridgeState === null);
});

test('marking uses the rest lattice: nodes displaced before attach give the same bridge cells', () => {
  const a = makeBridgeShip(HullBodies, 'battleship');
  const b = makeBridgeShip(HullBodies, 'battleship');
  // Wgniecenia przed podpięciem nie zmieniają przynależności (komórka = tożsamość węzła, środek spoczynkowy).
  const s = b.beamHull.body.nodeStore;
  const cs = b.beamHull.body.cellSize;
  for (let i = 0; i < s.count; i++) { s.x[i] += cs * 0.6; s.y[i] -= cs * 0.45; }
  b.beamHull.body._hashTick = -1;
  const sa = RT.attachEntityBridges(a);
  const sb = RT.attachEntityBridges(b);
  assert.ok(sa.bridges[0].total > 4, `komórki mostka: ${sa.bridges[0].total}`);
  assert.deepEqual(Array.from(sb.bridges[0].cellX), Array.from(sa.bridges[0].cellX));
  assert.deepEqual(Array.from(sb.bridges[0].cellY), Array.from(sa.bridges[0].cellY));
});

test('armour follows the zone: moving it on the same hull returns old cells to base HP, detach restores all', () => {
  const e = makeBridgeShip(HullBodies, 'battleship');
  const ns = e.beamHull.body.nodeStore;
  const base = Float64Array.from(ns.maxHp);
  RT.attachEntityBridges(e);
  // Strefa przesunięta ku dziobowi (edytor stref dema): stare komórki wracają do bazy, nowe dostają pancerz.
  const moved = { ...BELLATOR_ZONE, x: BELLATOR_ZONE.x + 380 };
  const st = RT.attachEntityBridges(e, { bridges: [moved] });
  const def = st.bridges[0].def;
  const inZone = cellKeys(st.bridges[0]);
  assert.ok(inZone.size > 4);
  for (let i = 0; i < ns.count; i++) {
    if (!ns.active[i]) continue;
    const mul = inZone.has(`${ns.ix[i]},${ns.iy[i]}`) ? def.armorMul : 1;
    assert.ok(Math.abs(ns.maxHp[i] - base[i] * mul) < 1e-6, `węzeł ${i} (${ns.ix[i]}, ${ns.iy[i]})`);
  }
  detachShipBridges(e);
  for (let i = 0; i < ns.count; i++) if (ns.active[i]) assert.ok(Math.abs(ns.maxHp[i] - base[i]) < 1e-6, `węzeł ${i} po odpięciu`);
  assert.equal(e.bridgeState, null);
});

test('command is lost exactly when integrity falls to 1 − killFrac', () => {
  for (const killFrac of [0.3, 0.6, 1.0]) {
    const e = ship('battleship', 0, 0, 0, [{ ...BELLATOR_ZONE, killFrac }]);
    const st = e.bridgeState;
    const bridge = st.bridges[0];
    const total = bridge.total;
    assert.ok(total >= 8, `komórki: ${total}`);
    let lostAt = -1;
    for (let k = 0; k < total && lostAt < 0; k++) {
      killCell(e, 0, k);
      const flags = evaluateShipBridges(e, k);
      const alive = BB.beamBridgeAliveCells(e, 0);
      const below = alive <= total * (1 - killFrac);
      if (flags & BRIDGE_EVENT.COMMAND_LOST) {
        assert.ok(flags & BRIDGE_EVENT.BRIDGE_LOST);
        assert.ok(below, `killFrac ${killFrac}: utrata przy ${alive}/${total}`);
        lostAt = k;
      } else {
        assert.ok(!below, `killFrac ${killFrac}: ${alive}/${total} bez utraty`);
        assert.equal(bridge.alive, alive);
      }
    }
    assert.ok(lostAt >= 0, `killFrac ${killFrac}: dowodzenie padło`);
    assert.equal(st.commandLost, true);
    assert.equal(st.cause, 'bridge');
    // Martwy statek nie zgłasza kolejnych zdarzeń.
    killNextCell(e, 0);
    assert.equal(evaluateShipBridges(e, 99), BRIDGE_EVENT.NONE);
  }
});

test('severing a fragment WITHOUT the bridge keeps the command', () => {
  window.wrecks.length = 0;
  const e = ship('battleship');
  const st = e.bridgeState;
  // Rzaz w poprzek dziobu (Bellator: mostek na rufie, x ≈ −282 PNG; sprite 1158 px szerokości).
  const a = bridgePngToWorld(e, 350, -500, {});
  const b = bridgePngToWorld(e, 350, 500, {});
  HullBodies.cutSegment(e, a.x, a.y, b.x, b.y, e.beamHull.cellSize * 1.2, { push: true });
  for (let i = 0; i < 30; i++) HullBodies.step(1 / 120, [e, ...window.wrecks]);
  assert.ok(window.wrecks.some((w) => w.beamHull && w.beamHull.dmgKey === st.lineage), 'dziób odpadł (odłam rodu)');
  assert.equal(evaluateShipBridges(e, 1) & BRIDGE_EVENT.COMMAND_LOST, 0);
  assert.equal(st.bridges[0].integrity, 1);
  assert.equal(BB.beamBridgeAliveCells(e, 0), st.bridges[0].total, 'mostek został na kadłubie-matce');
  window.wrecks.length = 0;
});

test('heavy hits away from the zone wreck the bow but never the bridge', () => {
  window.wrecks.length = 0;
  const e = ship('battleship');
  const st = e.bridgeState;
  const before = e.beamHull.body.activeNodes;
  const cs = e.beamHull.body.cellSize;
  // Kratery w przedniej części kadłuba (PNG x ≥ 150): daleko od mostka na rufie.
  for (let i = 0; i < 60; i++) {
    const p = bridgePngToWorld(e, 150 + (i % 10) * 40, -250 + Math.floor(i / 10) * 100, {});
    HullBodies.impact(e, p.x, p.y, 1, null, { craterRadius: cs * 1.5 });
    assert.equal(evaluateShipBridges(e, i) & BRIDGE_EVENT.COMMAND_LOST, 0);
  }
  assert.ok(before - e.beamHull.body.activeNodes > 60, `dziób zniszczony: ${before - e.beamHull.body.activeNodes} węzłów`);
  assert.equal(st.bridges[0].integrity, 1);
  assert.equal(st.commandLost, false);
  window.wrecks.length = 0;
});

test('the cadence probe runs every probeEverySec and is O(1) when nothing died', () => {
  const e = ship('battleship');
  const bridge = e.bridgeState.bridges[0];
  killNextCell(e, 0);
  updateShipBridges(e, 0.016, 0.016);          // timer 0 → liczy od razu
  const a1 = bridge.alive;
  assert.equal(a1, BB.beamBridgeAliveCells(e, 0));
  assert.ok(a1 < bridge.total);
  killNextCell(e, 0);
  updateShipBridges(e, 0.03, 0.046);           // w oknie kadencji — bez liczenia
  assert.equal(bridge.alive, a1);
  updateShipBridges(e, 0.06, 0.106);           // po 0,08 s — liczy
  assert.equal(bridge.alive, BB.beamBridgeAliveCells(e, 0));
  assert.ok(bridge.alive < a1);
  // Nic nie zginęło: brudne sprawdzenie nie dotyka licznika.
  bridge.alive = -123;
  assert.equal(evaluateShipBridges(e, 0.2), BRIDGE_EVENT.NONE);
  assert.equal(bridge.alive, -123);
});

test('the same craters give the same kill, crater for crater (determinism)', () => {
  const run = () => {
    window.wrecks.length = 0;
    const e = ship('battleship');
    const def = e.bridgeState.bridges[0].def;
    const cs = e.beamHull.body.cellSize;
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const trace = [];
    for (let i = 0; i < 400; i++) {
      const p = bridgePngToWorld(e, def.x + (rnd() - 0.5) * def.w * 1.4, def.y + (rnd() - 0.5) * def.h * 1.4, {});
      HullBodies.impact(e, p.x, p.y, 1, null, { craterRadius: cs * (0.6 + rnd()) });
      const flags = evaluateShipBridges(e, i);
      trace.push(e.bridgeState.bridges[0].alive);
      if (flags & BRIDGE_EVENT.COMMAND_LOST) return { shots: i + 1, trace };
    }
    return { shots: -1, trace };
  };
  const a = run();
  const b = run();
  window.wrecks.length = 0;
  assert.ok(a.shots > 0, 'kratery w strefie dochodzą do mostka');
  assert.deepEqual(a, b);
});

test('windows sit on bridge cells inside the zone; the blackout wave starts at the breach', () => {
  const e = ship('battleship');
  const st = e.bridgeState;
  const win = st.windows;
  assert.ok(win.count >= 6, `okna: ${win.count}`);
  const def = st.bridges[0].def;
  const cells = cellKeys(st.bridges[0]);
  for (let i = 0; i < win.count; i++) {
    assert.ok(bridgeZoneContains(def, win.px[i], win.py[i]));
    assert.ok(cells.has(`${win.cellX[i]},${win.cellY[i]}`), `okno ${i} na komórce mostka`);
  }
  // Trafienie od rufy (pocisk leci ku dziobowi, +x PNG = +x świata przy kącie 0): wyrwa na rufowym brzegu.
  const hit = bridgePngToWorld(e, def.x - def.w * 0.45, def.y, {});
  noteBridgeHit(e, hit.x, hit.y, 4000, 0, 0);
  killAllCells(e, 0);
  assert.ok(evaluateShipBridges(e, 0.1) & BRIDGE_EVENT.COMMAND_LOST);
  prepareWindowWave(e);
  let nearest = 0;
  for (let i = 1; i < win.count; i++) if (win.delay[i] < win.delay[nearest]) nearest = i;
  assert.ok(win.px[nearest] < def.x, 'pierwsze gaśnie okno od strony wyrwy');
  assert.ok(st.vent.dirX < -0.99, `gaz ucieka tunelem ku strzelcowi: ${st.vent.dirX}`);
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
  const e = makeBridgeShip(HullBodies, 'battleship');
  e.visual = {
    mainThrusters: [{ offset: { x: -150, y: 10 } }, { offset: { x: -150, y: -10 }, vfxScale: 1.3 }],
    torqueThrusters: [{ offset: { x: 0, y: 40 } }]
  };
  const lights = { position: [{ x: 100, y: 0 }, { x: -100, y: 30 }], road: [{ x: 0, y: 0 }] };
  e.editorLights = lights;
  RT.attachEntityBridges(e);
  killAllCells(e, 0);
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
  assert.equal(e.editorLights.flood.length, 0);
  assert.equal(e.editorLights.autoFlood, false, 'hulk bez reflektorów otoczenia z obrysu lamp');
  assert.equal(sampleEngineGlow(0, 0.5), 1);
  assert.ok(sampleEngineGlow(T.engineChokeEnd, 0.5) < sampleEngineGlow(T.engineChokeStart + 0.2, 0.5));

  detachShipBridges(e);
  assert.equal(a.vfxScale, undefined);
  assert.equal(b.vfxScale, 1.3);
  assert.equal(a.__throttle, undefined);
  assert.deepEqual(e.editorLights, lights);
});

test('a render pose overrides the physics pose (interpolated player hull)', () => {
  const e = ship('battleship', 100, 50, 0.3);
  const def = e.bridgeState.bridges[0].def;
  const a = bridgePngToWorld(e, def.x, def.y, { x: 0, y: 0 });
  const b = bridgePngToWorld(e, def.x, def.y, { x: 0, y: 0 }, { x: 110, y: 50, angle: 0.3 });
  assert.ok(Math.abs(b.x - a.x - 10) < 1e-9 && Math.abs(b.y - a.y) < 1e-9);
  const c = bridgePngToWorld(e, def.x, def.y, { x: 0, y: 0 }, { x: 100, y: 50, angle: 0.3 + Math.PI });
  assert.ok(Math.abs((c.x - 100) + (a.x - 100)) < 1e-6 && Math.abs((c.y - 50) + (a.y - 50)) < 1e-6, 'the angle comes from the pose too');
  // Siatka (piksele obrazu kadłuba) ↔ świat — w obie strony.
  const st = e.bridgeState;
  const g = bridgeWorldToGrid(e, a.x, a.y, {});
  assert.ok(Math.abs(g.x - (st.srcW * 0.5 + def.x * st.scaleX)) < 1e-6 && Math.abs(g.y - (st.srcH * 0.5 + def.y * st.scaleY)) < 1e-6);
});

// Sprite i profil renderu kadłubów ze strefami. Rozmiar PNG czytamy z pliku:
// podmieniony sprite (jak migracja piratów 2026-09-24) wywala test, zanim
// strefy i model mostka rozjadą się z obrazkiem.
const BRIDGE_HULL_SPRITES = {
  atlas: ['assets/capital_ship_rect_v1.png', 3747, 1677, 'atlas'],
  battleship: ['src/assets/ships/terranbattleship.png', 1158, 714, 'terran_battleship'],
  pirate_battleship: ['src/assets/ships/piratebattleship.png', 1727, 911, 'pirate_battleship'],
  frigate: ['src/assets/ships/terranfrigate.png', 2400, 1792, 'terran_frigate'],
  destroyer: ['src/assets/ships/terrandestroyer.png', 768, 573, 'terran_destroyer'],
  terran_carrier: ['src/assets/ships/terrancarrier.png', 1672, 941, 'terran_carrier'],
  terran_supercapital: ['src/assets/ships/terransupercapital.png', 1672, 941, 'terran_supercapital'],
  pirate_frigate: ['src/assets/ships/piratefrigate.png', 1942, 809, 'pirate_frigate'],
  pirate_destroyer: ['src/assets/ships/piratedestroyer.png', 1840, 854, 'pirate_destroyer'],
  pirate_supercapital: ['src/assets/ships/piratecapital.png', 1671, 941, 'pirate_supercapital'],
  megafreighter: ['assets/megafreighterfront.png', 1672, 941, 'megafreighter']
};

function pngSize(path) {
  const b = readFileSync(new URL(`../${path}`, import.meta.url));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('every hull with bridge zones has a known sprite of the recorded size', () => {
  for (const key of Object.keys(BRIDGE_LAYOUT_PROPOSALS)) {
    const spr = BRIDGE_HULL_SPRITES[key];
    assert.ok(spr, `${key}: brak sprite'a w BRIDGE_HULL_SPRITES`);
    assert.deepEqual(pngSize(spr[0]), [spr[1], spr[2]], `${key}: sprite zmienił rozmiar — przesuń strefy mostka i model`);
  }
});

test('proposed zones clear every hardpoint, engine slot and core of the editor defaults', () => {
  // Zapas = korpus wieżyczki klasy kadłuba (bridgeZoneMargin), w px PNG.
  for (const [key, entry] of Object.entries(BRIDGE_LAYOUT_PROPOSALS)) {
    const cfg = SHIP_EDITOR_DEFAULTS.ships[key];
    assert.ok(cfg, `editor defaults for ${key}`);
    const [, pw, ph, profile] = BRIDGE_HULL_SPRITES[key];
    const size = getHullRenderSize(profile, pw, ph);
    const margin = bridgeZoneMargin(Math.min(size.w / pw, size.h / ph), getWeaponTierForHull(profile));
    for (const [variant, list] of Object.entries(entry.variants)) {
      const issues = validateBridgeLayout(list, cfg, { margin });
      assert.deepEqual(issues, [], `${key}/${variant}: ${JSON.stringify(issues)}`);
      // Strefa w obrysie sprite'a.
      for (const z of list) {
        assert.ok(Math.abs(z.x) + z.w / 2 <= pw / 2 && Math.abs(z.y) + z.h / 2 <= ph / 2, `${key}/${z.id}: poza obrazkiem`);
      }
    }
  }
});

test('bridge hull keys: player hull ids, NPC types and frames, megafreighter locomotive only', () => {
  const cases = [
    ['player', 'atlas'], ['atlas', 'atlas'], ['frigate', 'frigate'], ['corvus', 'frigate'], ['terran_frigate', 'frigate'],
    ['destroyer', 'destroyer'], ['battleship', 'battleship'], ['carrier', 'terran_carrier'], ['supercapital', 'terran_supercapital'],
    ['pirate_frigate', 'pirate_frigate'], ['pirate_destroyer', 'pirate_destroyer'], ['megafreighter', 'megafreighter'], ['', null]
  ];
  for (const [inKey, outKey] of cases) assert.equal(normalizeBridgeHullKey(inKey), outKey, inKey);
  const npc = (o) => resolveBridgeHullKey(o);
  assert.equal(npc({ type: 'frigate' }), 'frigate');
  assert.equal(npc({ type: 'frigate', isPirate: true }), 'pirate_frigate');
  assert.equal(npc({ type: 'destroyer', isPirate: true, shipFrame: 'pirate_destroyer' }), 'pirate_destroyer');
  assert.equal(npc({ type: 'battleship', shipFrame: 'terran_battleship' }), 'battleship');
  assert.equal(npc({ type: 'carrier', shipFrame: 'terran_carrier' }), 'terran_carrier');
  assert.equal(npc({ type: 'supercapital' }), 'terran_supercapital');
  assert.equal(npc({ type: 'megafreighter_front', shipFrame: 'megafreighter' }), 'megafreighter');
  assert.equal(npc({ type: 'megafreighter_wagon', shipFrame: 'megafreighter' }), null);
  assert.equal(npc({ type: 'megafreighter_back', shipFrame: 'megafreighter' }), null);
  assert.equal(npc({ type: 'freighter-large', shipFrame: 'long_haul_freighter' }), null);
  for (const key of Object.keys(BRIDGE_LAYOUT_PROPOSALS)) assert.ok(SHIP_EDITOR_DEFAULTS.ships[key], `${key}: klucz edytora`);
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
