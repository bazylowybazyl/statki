// Lampy i dysze na kadłubach belkowych gasną z komórką kadłuba pod sobą (src/game/hullMounts.js):
// po rozpadzie lampy i dysze odpadłej części nie zostają na rodzicu (shipLightRuntime.js — payload kadłuba,
// billboardy, grupy lamp, emitery; lightGrid.addShipLights; engineVfxSystem.js — MAIN / SIDE). Prawdziwe
// sprite'y i układy z edytora (hardpointEditorDefaults), HullBodies z rozpadem.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];

const { HullBodies } = await import('../src/game/hullBodies.js');
const { bridgeHullImage, makeBridgeShip } = await import('./helpers/bridgeHulls.mjs');
const { createNpcHardpointRuntime } = await import('../src/game/npcHardpointRuntime.js');
const { SHIP_EDITOR_DEFAULTS } = await import('../src/data/hardpointEditorDefaults.js');
const LR = await import('../src/game/shipLightRuntime.js');
const HM = await import('../src/game/hullMounts.js');
const { EngineNozzleInternals } = await import('../src/3d/engineVfxSystem.js');
const { LightGrid, LIGHT_FLOATS, addShipLights } = await import('../src/3d/fx/lightGrid.js');

const KINDS = ['position', 'road', 'flood'];
const layouts = createNpcHardpointRuntime({ defaultShips: SHIP_EDITOR_DEFAULTS.ships, storageKey: 'hullMounts.test.none' });
layouts.refreshCache(true);

// Okręt NPC jak w demie mostków (dema/mostki-webgpu/swiat.js): kadłub belkowy, lampy i dysze z edytora.
function ship(key, x = 0, y = 0, angle = 0) {
  const { image, visual, def } = bridgeHullImage(key);
  const kx = image.width / visual.naturalWidth, ky = image.height / visual.naturalHeight;
  const e = {
    id: `t_${key}`, x, y, vx: 0, vy: 0, angle, angVel: 0, mass: def.npc.mass, hp: 12000, maxHp: 12000,
    type: def.npc.type, isPirate: def.npc.isPirate, shipFrame: def.npc.shipFrame,
    __hardpointScaleX: kx, __hardpointScaleY: ky, __hardpointScale: (kx + ky) * 0.5, visual: { spriteScale: 1 }
  };
  layouts.applyLayoutToNpc(e);
  HullBodies.createHull(e, image, { visualImage: visual, hullProfileId: def.profile });
  return e;
}

const lampCount = (block) => KINDS.reduce((n, k) => n + block[k].length, 0);
const nozzleFx = (e) => ({ exhausts: EngineNozzleInternals.buildSlots(e).map((slot) => ({ slot })), mounts: null });

// Punkt sprite'a (px renderu od środka, y w dół) → świat gry przy pozie encji (obrót sprite'a 0).
function spriteToWorld(e, sx, sy) {
  const c = Math.cos(e.angle), s = Math.sin(e.angle);
  return { x: e.x + sx * c - sy * s, y: e.y + sx * s + sy * c };
}
function worldToSpriteX(e, wx, wy) {
  return (wx - e.x) * Math.cos(e.angle) + (wy - e.y) * Math.sin(e.angle);
}

// Rzaz w poprzek kadłuba na x sprite'a `cutX` i kroki fizyki — odłam za rzazem odlatuje jako wrak rodu.
function cutAcross(e, cutX) {
  const H = e.beamHull.srcHeight;
  const a = spriteToWorld(e, cutX, -H), b = spriteToWorld(e, cutX, H);
  HullBodies.cutSegment(e, a.x, a.y, b.x, b.y, e.beamHull.cellSize * 1.2, { push: true });
  for (let i = 0; i < 30; i++) HullBodies.step(1 / 120, [e, ...window.wrecks]);
}

test('intact beam hulls: every editor lamp and nozzle binds to a hull cell and stays lit; the lamp block keeps its identity', () => {
  for (const key of ['atlas', 'terran_carrier', 'terran_supercapital', 'destroyer', 'frigate', 'pirate_frigate']) {
    const e = ship(key);
    const block = LR.getEntityLights(e);
    const set = HM.createHullMountSet();
    const rest = HM.beginHullMountBind(set, e.beamHull, 0);
    for (const k of KINDS) {
      for (const m of block[k]) {
        assert.ok(HM.bindHullMount(e.beamHull, m.x * e.__hardpointScaleX, m.y * e.__hardpointScaleY, rest) >= 0,
          `${key}: lampa ${k} ${m.id} na kadłubie`);
      }
    }
    assert.equal(LR.getEntityLights(e), block, `${key}: nietknięty kadłub — ten sam blok (cache payloadu i grup lamp)`);
    const fx = nozzleFx(e);
    const alive = EngineNozzleInternals.syncNozzleMounts(e, fx);
    assert.ok(fx.exhausts.length > 0, `${key}: dysze`);
    for (let i = 0; i < fx.exhausts.length; i++) {
      assert.ok(fx.mounts.cells[i] >= 0, `${key}: dysza ${i} związana z komórką`);
      assert.equal(alive[i], 1, `${key}: dysza ${i} pali się`);
    }
  }
});

test('stern cut off: the parent drops lamps and nozzles of the detached part everywhere (payload, billboards, groups, emitters, engines)', () => {
  window.wrecks.length = 0;
  const e = ship('atlas', 7.08e6, 6.29e6, 0.4);
  const full = LR.getEntityLights(e);
  const kx = e.__hardpointScaleX;
  const payloadBefore = LR.buildShipLightShaderPayload(e, e.beamHull);
  const fx = nozzleFx(e);
  EngineNozzleInternals.syncNozzleMounts(e, fx);

  const cutX = -0.22 * e.beamHull.srcWidth;
  cutAcross(e, cutX);
  const frag = window.wrecks.find((w) => w.beamHull?.dmgKey === e.beamHull.dmgKey);
  assert.ok(frag, 'odłam rodu powstał');
  assert.ok(e.beamHull.body.activeNodes < e.beamHull.baseNodes);

  // Pas rzazu (1,2 komórki) i promień wiązania (2 komórki) — poza nim podział jest jednoznaczny.
  const margin = e.beamHull.cellSize * (1.2 + HM.HULL_MOUNT.bindReachCells + 0.5);
  const block = LR.getEntityLights(e);
  assert.equal(LR.getEntityLights(e), block, 'ten sam stan ciała — ten sam blok');
  assert.ok(lampCount(block) < lampCount(full), 'część lamp zgasła');
  for (const k of KINDS) {
    for (const m of full[k]) {
      const x = m.x * kx;
      const kept = block[k].includes(m);
      if (x < cutX - margin) assert.ok(!kept, `lampa ${k} ${m.id} (x ${x.toFixed(0)}) odcięta z rufą`);
      if (x > cutX + margin) assert.ok(kept, `lampa ${k} ${m.id} (x ${x.toFixed(0)}) zostaje`);
    }
  }
  assert.equal(block.hullLenPx, full.hullLenPx, 'długość obrysu (progi reflektorów) bez zmian');

  // Shader kadłuba: mniej lamp, żadna za rzazem (piksele obrazu kadłuba: x − W/2).
  const payload = LR.buildShipLightShaderPayload(e, e.beamHull);
  assert.ok(payload.count < payloadBefore.count && payload.signature !== payloadBefore.signature);
  for (const l of payload.lights) assert.ok(l.pos.x - e.beamHull.srcWidth * 0.5 > cutX - margin, `lampa ${l.id} w shaderze przed rzazem`);
  // Billboardy, grupy lamp i reflektory — w świecie, przed rzazem.
  const sprites = LR.buildPositionLightWorldSprites([e], {});
  assert.equal(sprites.length, block.position.length);
  for (const s of sprites) assert.ok(worldToSpriteX(e, s.x, s.y) > cutX - margin, 'billboard przed rzazem');
  for (const c of LR.buildNavLightClusters([e], { time: 0 })) assert.ok(worldToSpriteX(e, c.x, c.y) > cutX - margin, 'grupa lamp przed rzazem');
  for (const em of LR.buildRoadLightWorldEmitters([e], {})) assert.ok(worldToSpriteX(e, em.x, em.y) > cutX - margin, `reflektor ${em.id} przed rzazem`);
  // Odłam nie ma własnych lamp (nie dostaje ich też jako rozlewu — ród, shipLightRuntime).
  assert.equal(LR.getEntityLights(frag), LR.getEntityLights({}));

  // Dysze: MAIN i SIDE na rufie gasną, dziobowe SIDE palą się dalej.
  const alive = EngineNozzleInternals.syncNozzleMounts(e, fx);
  let deadMain = 0, liveSide = 0;
  for (let i = 0; i < fx.exhausts.length; i++) {
    const slot = fx.exhausts[i].slot;
    const x = Number(slot.offset.x);
    if (x < cutX - margin) assert.equal(alive[i], 0, `dysza ${slot.kind} x ${x.toFixed(0)} odcięta`);
    if (x > cutX + margin) assert.equal(alive[i], 1, `dysza ${slot.kind} x ${x.toFixed(0)} zostaje`);
    if (slot.kind === 'main' && !alive[i]) deadMain++;
    if (slot.kind === 'side' && alive[i]) liveSide++;
  }
  assert.ok(deadMain > 0 && liveSide > 0, 'rufa bez strug, dziób z dyszami bocznymi');
  window.wrecks.length = 0;
});

test('a lamp shot off goes out; a hit elsewhere keeps the block; the hulk agony list cannot bring a dead lamp back', () => {
  window.wrecks.length = 0;
  const e = ship('atlas', 0, 0, 0);
  const source = e.editorLights;
  const full = LR.getEntityLights(e);
  const kx = e.__hardpointScaleX, ky = e.__hardpointScaleY;
  const cs = e.beamHull.cellSize;
  const lamp = full.position[0];
  // Trafienie daleko od lamp (środek kadłuba) — liczba węzłów się zmienia, lampy nie.
  let far = null, farD = 0;
  for (let gx = -300; gx <= 300; gx += 50) {
    let d = Infinity;
    for (const k of KINDS) for (const m of full[k]) d = Math.min(d, Math.hypot(m.x * kx - gx, m.y * ky));
    if (d > farD) { farD = d; far = gx; }
  }
  assert.ok(farD > cs * 4, 'punkt trafienia z dala od lamp');
  const nodes = e.beamHull.body.activeNodes;
  HullBodies.impact(e, far, 0, 1, null, { craterRadius: cs * 0.9 });
  assert.ok(e.beamHull.body.activeNodes < nodes, 'trafienie zabiło węzły');
  assert.equal(LR.getEntityLights(e), full, 'lampy bez zmian — ten sam blok');

  // Lampa zestrzelona: krater w jej miejscu.
  const p = spriteToWorld(e, lamp.x * kx, lamp.y * ky);
  HullBodies.impact(e, p.x, p.y, 1, null, { craterRadius: cs * 3 });
  const hit = LR.getEntityLights(e);
  assert.ok(!hit.position.includes(lamp), 'lampa zgasła z komórką');

  // Agonia hulka (shipBridge.js: applyCommandLossVisuals) podmienia źródło — nowe wiązanie po siatce
  // spoczynkowej: lampa nad martwą komórką nie wraca, reszta świeci.
  e.editorLights = { position: source.position.slice(), road: [], flood: [], autoFlood: false };
  const agony = LR.getEntityLights(e);
  assert.ok(agony.position.length > 0 && agony.position.length < source.position.length);
  for (const m of agony.position) assert.ok(Math.hypot(m.x - lamp.x, m.y - lamp.y) > 1e-6, 'zestrzelona lampa nie wraca');
});

test('field lights: no substitute bow pair for a ship whose own headlights died (hulk agony, cut bow); the pair goes out with the bow', () => {
  window.wrecks.length = 0;
  const spots = (g) => {
    let n = 0;
    for (let i = 0; i < g.count; i++) if (g.lights[i * LIGHT_FLOATS + 11] > -1.5) n++;
    return n;
  };
  // Hulk po zgaszeniu reflektorów: road [] w źródle, pierwotne w bridgeState.navOriginal.
  const hulk = { x: 0, y: 0, angle: 0, editorLights: { position: [], road: [], autoFlood: false },
    bridgeState: { navOriginal: { position: [], road: [{ x: 300, y: 0, deg: 90 }] } } };
  const g0 = new LightGrid();
  g0.begin(0, 0);
  addShipLights(g0, hulk, 700, { time: 0 });
  assert.equal(spots(g0), 0, 'agonia: reflektory zgasły i nie wracają parą zastępczą');
  assert.equal(LR.entityOwnRoadLightCount(hulk), 1);

  // Bellator bez lamp edytora: zastępcza para na dziobie — do odcięcia dziobu.
  const e = makeBridgeShip(HullBodies, 'battleship', 0, 0, 0);
  const L = e.beamHull.srcWidth * e.beamHull.scale;
  const g1 = new LightGrid();
  g1.begin(0, 0);
  addShipLights(g1, e, L, { time: 0 });
  assert.equal(spots(g1), 2, 'para na dziobie');
  cutAcross(e, 0.2 * e.beamHull.srcWidth);
  assert.ok(window.wrecks.some((w) => w.beamHull?.dmgKey === e.beamHull.dmgKey), 'dziób odpadł');
  const g2 = new LightGrid();
  g2.begin(0, 0);
  addShipLights(g2, e, L, { time: 0 });
  assert.equal(spots(g2), 0, 'bez dziobu — bez pary reflektorów');
  window.wrecks.length = 0;
});
