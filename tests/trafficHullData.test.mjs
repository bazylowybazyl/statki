// Kadłuby ruchu v2 jako pełne kadłuby gry (E13, 2026-10-22): statek bańki awansowany do NPC (src/game/trafficPromotion.js)
// dostaje mostek (BRIDGE_LAYOUT_PROPOSALS, poziom z pola kadłuba — src/data/shipClasses.js), rdzeń reaktora
// (REACTOR_CORE_MARKERS), zbiornik paliwa (FUEL_TANK_MARKERS), dysze MAIN i SIDE (SHIP_EDITOR_DEFAULTS, ENGINE_FX_DEFAULTS),
// a okręty (przemytnik, rajder, łowca, kuter policji) — gniazda broni. Miejsca dobrane na sprite'ach; tu: komplet
// wpisów, odstępy (mostek od dysz i gniazd, obudowa rdzenia od mostka, zbiornik poza komorą) i PRAWDZIWY kadłub
// belkowy (sprite w rozmiarze renderu): komórki strefy, komory i zbiornika na kadłubie.
// node --test tests/trafficHullData.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { TRAFFIC_HULLS, TRAFFIC_UNIT_HULLS } = await import('../src/data/trafficHulls.js');
const { SHIP_EDITOR_DEFAULTS } = await import('../src/data/hardpointEditorDefaults.js');
const { REACTOR_CORE_MARKERS } = await import('../src/data/reactorCores.js');
const { FUEL_TANK_MARKERS } = await import('../src/data/fuelTanks.js');
const { ENGINE_FX_DEFAULTS } = await import('../src/data/engineFx.js');
const { BRIDGE_LEVELS } = await import('../src/data/bridgeLevels.js');
const { SHIP_CLASSES } = await import('../src/data/shipClasses.js');
const { getHullRenderSize, getWeaponTierForHull, HULL_RENDER_PROFILES } = await import('../src/data/ships.js');
const { BRIDGE_LAYOUT_PROPOSALS, bridgeZoneMargin, validateBridgeLayout } = await import('../src/game/shipBridge.js');
const { createNpcHardpointRuntime, TRAFFIC_EDITOR_FRAMES } = await import('../src/game/npcHardpointRuntime.js');
const { npcHasPhysicalThrusters } = await import('../src/game/flight/npcFlight.js');
const { readPng } = await import('../scripts/webgpu/png.mjs');
const { resizeBox } = await import('./helpers/reactorHulls.mjs');
const { HullBodies } = await import('../src/game/hullBodies.js');
const RT = await import('../src/game/shipBridgeRuntime.js');
const BB = await import('../src/game/shipBridgeBeams.js');
const { attachReactorCores, reactorCellNode, reactorHull } = await import('../src/game/reactorCore.js');
const { attachFuelTank } = await import('../src/game/fuelTank.js');
const { autoReactorMarker } = await import('../src/game/reactorCoreGame.js');

const SHIPS = SHIP_EDITOR_DEFAULTS.ships;
// Kadłuby ruchu z danymi pełnego kadłuba (bez floty z `editorKey`, megafrachtowca — pociąg modułów — i holownika
// serwisowego, który ma własny wpis).
const HULLS = Object.keys(TRAFFIC_HULLS).filter((id) => !TRAFFIC_HULLS[id].editorKey && id !== 'megafreighter' && id !== 'service_tug');
const ARMED = new Set(['smuggler', 'pirate_raider', 'bounty_hunter', 'police_cutter']);
const zoneOf = (id) => { const e = BRIDGE_LAYOUT_PROPOSALS[id]; return e.variants[e.defaultVariant][0]; };

const _png = new Map();
function png(id) {
  if (!_png.has(id)) _png.set(id, readPng(fileURLToPath(TRAFFIC_HULLS[id].sprite)));
  return _png.get(id);
}
function scaleOf(id) {
  const img = png(id);
  const size = getHullRenderSize(id, img.width, img.height);
  return { x: size.w / img.width, y: size.h / img.height, w: size.w, h: size.h };
}

test('18 kadłubów ruchu: wpis edytora, mostek z poziomem, rdzeń, zbiornik, rozmiar dysz', () => {
  assert.equal(HULLS.length, 18, HULLS.join(', '));
  for (const id of HULLS) {
    const cfg = SHIPS[id];
    assert.ok(cfg, `${id}: wpis edytora`);
    assert.ok(TRAFFIC_EDITOR_FRAMES.has(id), `${id}: rama → klucz edytora (getEditorShipIdForNpc)`);
    assert.ok(HULL_RENDER_PROFILES[id], `${id}: profil renderu`);
    assert.ok(zoneOf(id)?.level >= 1, `${id}: strefa mostka z poziomem`);
    assert.equal(REACTOR_CORE_MARKERS[id]?.length, 1, `${id}: rdzeń`);
    assert.equal(FUEL_TANK_MARKERS[id]?.length, 1, `${id}: zbiornik`);
    assert.ok(ENGINE_FX_DEFAULTS[id]?.mainNozzle > 0, `${id}: średnica dysz MAIN`);
    // Dysze MAIN = dysze proxy bańki (TRAFFIC_HULLS[].main), wydech ku rufie.
    assert.deepEqual(cfg.engines.main.map((m) => [m.x, m.y]), TRAFFIC_HULLS[id].main.map(([x, y]) => [x, y]), `${id}: MAIN jak proxy`);
    for (const m of cfg.engines.main) assert.equal(m.deg, 90);
    assert.ok(cfg.engines.side.length >= 2, `${id}: dysze SIDE`);
    if (ARMED.has(id)) {
      assert.notEqual(cfg.sideOnly, true, `${id}: okręt — pełny wpis`);
      assert.ok(cfg.hardpoints.length >= 2, `${id}: gniazda broni`);
    } else {
      assert.equal(cfg.sideOnly, true, `${id}: cywil — wpis sideOnly`);
      assert.equal(cfg.hardpoints, undefined, `${id}: cywil bez gniazd`);
    }
  }
  // Role z kadłubami Z11.
  assert.equal(TRAFFIC_UNIT_HULLS.hunter, 'bounty_hunter');
  assert.equal(TRAFFIC_UNIT_HULLS.police, 'police_cutter');
  assert.equal(TRAFFIC_UNIT_HULLS.rescue, 'rescue_ship');
});

test('poziom mostka = klasa z pola kadłuba; strefa = obrys poziomu / s (wahadłowiec i dron — pomniejszone)', () => {
  const SHRUNK = { inter_station_shuttle: 0.93, repair_drone: 0.8 };
  for (const id of HULLS) {
    const img = png(id);
    const s = scaleOf(id);
    let n = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] >= 40) n++;
    const area = n * s.x * s.y;
    const level = SHIP_CLASSES.find((c) => area <= c.areaMax).level;
    const z = zoneOf(id);
    assert.equal(z.level, level, `${id}: pole ${area.toFixed(0)} j² → poziom ${level}`);
    const lv = BRIDGE_LEVELS[level - 1];
    const k = SHRUNK[id] || 1;
    assert.ok(Math.abs(z.w - lv.w / s.x * k) < 0.2 && Math.abs(z.h - lv.h / s.y * k) < 0.2, `${id}: strefa ${z.w} × ${z.h}`);
    assert.ok(Math.abs(z.x) + z.w / 2 <= img.width / 2 && Math.abs(z.y) + z.h / 2 <= img.height / 2, `${id}: strefa poza obrazkiem`);
  }
});

test('odstępy: mostek od dysz i gniazd, obudowa rdzenia od mostka, zbiornik poza komorą reaktora', () => {
  for (const id of HULLS) {
    const s = scaleOf(id);
    const z = zoneOf(id);
    // Okręt — zapas korpusu wieżyczki (bridgeZoneMargin); cywil bez wież — strefa nie przykrywa osi dysz (min. 14 px).
    const margin = ARMED.has(id) ? bridgeZoneMargin(Math.min(s.x, s.y), getWeaponTierForHull(id)) : 14;
    assert.deepEqual(validateBridgeLayout([z], SHIPS[id], { margin }), [], `${id}: mostek przy dyszach / gniazdach`);
    const c = REACTOR_CORE_MARKERS[id][0];
    const dx = Math.max(0, Math.abs(c.x - z.x) - z.w / 2), dy = Math.max(0, Math.abs(c.y - z.y) - z.h / 2);
    assert.ok(Math.hypot(dx, dy) > c.hr * 1.2, `${id}: obudowa rdzenia na mostku`);
    assert.ok(c.tier === `R${z.level}`, `${id}: poziom rdzenia = poziom mostka`);
    const t = FUEL_TANK_MARKERS[id][0];
    assert.ok(Math.hypot(t.x - c.x, t.y - c.y) > Math.max(c.r, t.r), `${id}: środek zbiornika w komorze reaktora`);
  }
});

test('prawdziwy kadłub belkowy: mostek ma komórki na kadłubie, komora i zbiornik z tabel (nie z automatu)', () => {
  for (const id of HULLS) {
    const img = png(id);
    const s = scaleOf(id);
    const e = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 1e4, hp: 1000, maxHp: 1000, type: id, shipFrame: id };
    HullBodies.createHull(e, resizeBox(img, s.w, s.h), { visualImage: { naturalWidth: img.width, naturalHeight: img.height, width: img.width, height: img.height } });
    try {
      assert.ok(e.beamHull, `${id}: kadłub belkowy`);
      assert.equal(RT.resolveBridgeHullKey(e), id, `${id}: klucz mostka z ramy`);
      RT.attachEntityBridges(e);
      const st = e.bridgeState;
      assert.ok(st && st.bridges.length === 1, `${id}: mostek zamontowany`);
      assert.ok(st.bridges[0].total >= 1, `${id}: strefa bez komórek`);
      const z = zoneOf(id), hull = e.beamHull, cs = hull.body.cellSize, p = { x: 0, y: 0 };
      BB.beamPngToLattice(st, z.x, z.y, p);
      assert.ok(BB.bridgeCellNode(hull, Math.floor(p.x / cs), Math.floor(p.y / cs)) >= 0, `${id}: środek strefy poza kadłubem`);
      const [core] = attachReactorCores(e, REACTOR_CORE_MARKERS[id], { pngWidth: img.width, pngHeight: img.height });
      assert.ok(core && !core.invalid && core.cellX.length >= 1, `${id}: komora reaktora`);
      const rh = reactorHull(e);
      assert.ok(reactorCellNode(rh, Math.floor(core.gx / rh.body.cellSize), Math.floor(core.gy / rh.body.cellSize)) >= 0, `${id}: pod rdzeniem brak kadłuba`);
      e.reactorCores = [core];
      const tank = attachFuelTank(e, id);
      assert.ok(tank && tank.auto === false && tank.cellX.length >= 1, `${id}: zbiornik z tabeli`);
      RT.releaseShipBridges?.(e);
    } finally {
      HullBodies.release(e);
    }
  }
});

test('NPC ruchu: cywil — dysze MAIN tylko do obrazu (lot bez zmian) i SIDE; okręt — gniazda i fizyczne dysze', () => {
  const rt = createNpcHardpointRuntime({ defaultShips: SHIPS, storageKey: 'trafficHullData.test.none' });
  rt.refreshCache(true);
  for (const id of HULLS) {
    const s = scaleOf(id);
    const npc = { type: id, shipFrame: id, __hardpointScaleX: s.x, __hardpointScaleY: s.y };
    assert.equal(rt.applyLayoutToNpc(npc), true, id);
    assert.equal(npc.__editorLayoutShipId, id);
    assert.equal(npc.visual.mainThrusters.length, TRAFFIC_HULLS[id].main.length, `${id}: dysze MAIN`);
    assert.ok(npc.visual.torqueThrusters.length >= 2, `${id}: dysze SIDE`);
    assert.ok(npc.visual.engineFx, `${id}: rozmiar strug`);
    if (ARMED.has(id)) {
      assert.equal(npcHasPhysicalThrusters(npc), true, `${id}: okręt lata dyszami`);
      assert.equal(npc.editorHardpoints.length, SHIPS[id].hardpoints.length, `${id}: gniazda`);
    } else {
      assert.equal(npc.visual.mainVisualOnly, true, id);
      assert.equal(npcHasPhysicalThrusters(npc), false, `${id}: lot cywila bez zmian`);
      assert.equal(npc.editorHardpoints, undefined, `${id}: bez gniazd`);
    }
  }
});

// Taran w megafrachtowiec (E6, 2026-10-26): statek ruchu awansuje jako JEDEN kadłub na belkach ze sprite'a całego
// składu (nie pociąg modułów). Mostek — wariant `sklad` strefy lokomotywy (ten sam blok „C” dziobu), rdzeń i zbiornik
// z automatu.
test('megafrachtowiec ruchu: kadłub ze sprite\'a składu, mostek `sklad` na kadłubie, rdzeń i zbiornik z automatu', () => {
  const id = 'megafreighter';
  const img = png(id);
  const s = scaleOf(id);
  const e = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 1e4, hp: 1000, maxHp: 1000, type: id, shipFrame: id };
  HullBodies.createHull(e, resizeBox(img, s.w, s.h), { visualImage: { naturalWidth: img.width, naturalHeight: img.height, width: img.width, height: img.height } });
  try {
    assert.ok(e.beamHull, 'kadłub belkowy');
    assert.equal(RT.resolveBridgeHullKey(e), 'megafreighter');
    assert.equal(RT.resolveBridgeVariant(e), 'sklad');
    assert.equal(RT.resolveBridgeVariant({ type: 'megafreighter_front' }), null, 'lokomotywa pociągu — strefa domyślna');
    RT.attachEntityBridges(e);
    const st = e.bridgeState;
    assert.ok(st && st.bridges.length === 1, 'mostek zamontowany');
    const z = BRIDGE_LAYOUT_PROPOSALS.megafreighter.variants.sklad[0];
    assert.equal(st.bridges[0].def.x, z.x, 'strefa `sklad`, nie lokomotywy');
    // Strefa cała na kadłubie (komórki z węzłem) — bez dziur na starcie mostek nie jest od razu „zniszczony”.
    assert.ok(st.bridges[0].total >= 4, `komórek strefy: ${st.bridges[0].total}`);
    const hull = e.beamHull, cs = hull.body.cellSize, p = { x: 0, y: 0 };
    for (const [ox, oy] of [[0, 0], [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
      BB.beamPngToLattice(st, z.x + ox * z.w, z.y + oy * z.h, p);
      assert.ok(BB.bridgeCellNode(hull, Math.floor(p.x / cs), Math.floor(p.y / cs)) >= 0, `róg strefy ${ox},${oy} poza kadłubem`);
    }
    // Strefa w świecie = strefa lokomotywy (model mostka bez skalowania), ±2%.
    const loco = BRIDGE_LAYOUT_PROPOSALS.megafreighter.variants.standard[0];
    const lk = getHullRenderSize('megafreighter', 1672, 941);
    assert.ok(Math.abs(z.w * s.x / (loco.w * lk.w / 1672) - 1) < 0.02 && Math.abs(z.h * s.y / (loco.h * lk.h / 941) - 1) < 0.02);
    assert.equal(REACTOR_CORE_MARKERS[id], undefined, 'rdzeń z automatu (ReactorGame.attach)');
    const [core] = attachReactorCores(e, [autoReactorMarker(e, img.width, img.height)], { pngWidth: img.width, pngHeight: img.height });
    assert.ok(core && !core.invalid && core.cellX.length >= 1, 'komora reaktora z automatu');
    e.reactorCores = [core];
    const tank = attachFuelTank(e, id);
    assert.ok(tank && tank.cellX.length >= 1, 'zbiornik');
    RT.releaseShipBridges?.(e);
  } finally {
    HullBodies.release(e);
  }
});
