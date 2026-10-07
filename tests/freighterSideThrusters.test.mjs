// Dysze SIDE frachtowców (2026-10-07): wahadłowiec, kontenerowiec, frachtowiec dalekiego zasięgu, ciężki frachtowiec
// i lokomotywa megafrachtowca biorą z edytora (SHIP_EDITOR_DEFAULTS, wpisy `sideOnly`) po 4 dysze SIDE w narożnikach
// kadłuba — modele 3D w szarej palecie cywilnej i strugi SIDE. Bez dysz MAIN (ścieżka lotu bez zmian), gniazd, rdzeni
// i świateł; furgony ładunku (sprite fregaty), wagony i ogon megafrachtowca — bez dysz.
// node --test tests/freighterSideThrusters.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readPng } from '../scripts/webgpu/png.mjs';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { createNpcHardpointRuntime } from '../src/game/npcHardpointRuntime.js';
import { npcHasPhysicalThrusters } from '../src/game/flight/npcFlight.js';
import { TRAFFIC_HULLS } from '../src/data/trafficHulls.js';
import { MEGAFREIGHTER_TRAIN_MODULES } from '../src/game/megafreighterTrain.js';
import { getHullRenderSize, getWeaponTierForHull, resolveEntityHullProfileId } from '../src/data/ships.js';
import { CARGO_BAY_HULLS } from '../src/data/cargoBays.js';
import { BRIDGE_LAYOUT_PROPOSALS, bridgeZoneMargin, validateBridgeLayout } from '../src/game/shipBridge.js';
import { getEngineVfxScaleForHullId } from '../src/3d/engineVfxScale.js';
import { SIDE_NOZZLE_MOUTH, SIDE_NOZZLE_RADIUS } from '../src/3d/sideNozzleFrame.js';
import { SIDE_THRUSTER_PALETTE, sideThrusterPaletteFor } from '../src/3d/ships3d/thrusters/sideThruster3D.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SHIPS = SHIP_EDITOR_DEFAULTS.ships;
const LOCOMOTIVE = MEGAFREIGHTER_TRAIN_MODULES.find((m) => m.role === 'front');

// Wpis edytora → sprite, który gra rysuje (getHullSpriteForNpc: HULL_SPRITE_PATHS_BY_ID / TRAFFIC_HULLS, lokomotywa —
// sprite modułu), profil renderu (skala kadłuba i klasa dysz) i NPC, który go dostaje.
const HULLS = [
  { key: 'inter_station_shuttle', profile: 'inter_station_shuttle', sprite: TRAFFIC_HULLS.inter_station_shuttle.sprite,
    bays: 'inter_station_shuttle', npc: { type: 'freighter-small', shipFrame: 'inter_station_shuttle' } },
  { key: 'container_ship', profile: 'container_ship', sprite: TRAFFIC_HULLS.container_ship.sprite,
    bays: 'container_ship', npc: { type: 'freighter-medium', shipFrame: 'container_ship' } },
  { key: 'long_haul_freighter', profile: 'long_haul_freighter', sprite: TRAFFIC_HULLS.long_haul_freighter.sprite,
    bays: 'long_haul_freighter', npc: { type: 'freighter-large', shipFrame: 'long_haul_freighter' } },
  // Ciężki frachtowiec rysuje się dziś sprite'em frachtowca dalekiego zasięgu (ładownie jak na tym spricie).
  { key: 'heavy_freighter', profile: 'heavy_freighter', sprite: TRAFFIC_HULLS.heavy_freighter.sprite,
    bays: 'long_haul_freighter', npc: { type: 'freighter-capital', shipFrame: 'heavy_freighter' } },
  { key: 'megafreighter_front', profile: 'megafreighter', sprite: LOCOMOTIVE.spriteSrc, bays: null, bridge: 'megafreighter',
    npc: { type: 'megafreighter_front', shipFrame: 'megafreighter', disableEditorLayout: true } }
];

const spriteCache = new Map();
function sprite(url) {
  if (!spriteCache.has(url)) spriteCache.set(url, readPng(fileURLToPath(url)));
  return spriteCache.get(url);
}

// Skala markerów jak getNpcHexInitSource (index.html): kadłub w świecie / płótno PNG.
function hullScale(profile, img) {
  const size = getHullRenderSize(profile, img.width, img.height);
  return { x: size.w / img.width, y: size.h / img.height };
}

// Promień wylotu dzwonu w px PNG (engineVfxSystem.js: SIDE_NOZZLE_RADIUS × skala klasy kadłuba, sprite w skali 1).
function nozzleRadiusPx(profile, scale) {
  const world = SIDE_NOZZLE_RADIUS * getEngineVfxScaleForHullId(profile);
  return { x: world / scale.x, y: world / scale.y };
}

const ALPHA_CUTOFF = 40; // hullBodies.js (alphaCutoff kadłuba)
function solidAt(img, x, y) {
  const xi = Math.floor(img.width / 2 + x);
  const yi = Math.floor(img.height / 2 + y);
  if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) return false;
  return img.data[(yi * img.width + xi) * 4 + 3] >= ALPHA_CUTOFF;
}

// Płyta sponsonu w px PNG (sideThruster3D.js: PLATE x0 = −1,5 R w głąb, x1 = +1,12 R na zewnątrz, ±1,2 R wzdłuż kadłuba).
function plateRect(m, R) {
  const out = m.y > 0 ? 1 : -1;
  const a = m.y - out * 1.5 * R.y;
  const b = m.y + out * 1.12 * R.y;
  return { x0: m.x - 1.2 * R.x, x1: m.x + 1.2 * R.x, y0: Math.min(a, b), y1: Math.max(a, b) };
}
const overlaps = (r, cx, cy, w, h, gap = 0) =>
  r.x1 > cx - w / 2 - gap && r.x0 < cx + w / 2 + gap && r.y1 > cy - h / 2 - gap && r.y0 < cy + h / 2 + gap;

function runtime() {
  const rt = createNpcHardpointRuntime({ defaultShips: SHIPS, storageKey: 'freighterSideThrusters.test.none' });
  rt.refreshCache(true);
  return rt;
}

test('dane edytora: wpisy sideOnly — 4 narożniki, wydech na zewnątrz burty, bez MAIN, gniazd, rdzeni i świateł', () => {
  for (const { key } of HULLS) {
    const cfg = SHIPS[key];
    assert.ok(cfg, `${key}: brak wpisu`);
    assert.equal(cfg.sideOnly, true, `${key}: sideOnly`);
    assert.deepEqual(cfg.engines.main, [], `${key}: bez dysz MAIN (npcHasPhysicalThrusters zmieniłby lot)`);
    for (const field of ['hardpoints', 'cores', 'lights']) assert.equal(cfg[field], undefined, `${key}: bez ${field}`);
    const side = cfg.engines.side;
    assert.equal(side.length, 4, `${key}: 4 dysze SIDE`);
    assert.deepEqual(side.map((m) => m.mount).sort(), ['lower_left', 'lower_right', 'upper_left', 'upper_right'], `${key}: narożniki`);
    assert.equal(new Set(side.map((m) => m.id)).size, 4, `${key}: id dysz`);
    for (const m of side) {
      const left = m.mount.endsWith('_left');
      assert.equal(left, m.y < 0, `${key}/${m.id}: lewa burta = −y obrazka`);
      assert.equal(m.mount.startsWith('upper'), m.x > 0, `${key}/${m.id}: upper = przód (+x), lower = rufa`);
      assert.equal(m.deg, left ? 180 : 0, `${key}/${m.id}: kąt z burty`);
      assert.deepEqual([m.gimbalMinDeg, m.gimbalMaxDeg], [-90, 90]);
    }
  }
  // Ciężki frachtowiec ma sprite frachtowca dalekiego zasięgu — te same markery; własny sprite = nowy pomiar.
  assert.equal(TRAFFIC_HULLS.heavy_freighter.sprite, TRAFFIC_HULLS.long_haul_freighter.sprite);
  assert.deepEqual(SHIPS.heavy_freighter.engines.side, SHIPS.long_haul_freighter.engines.side);
  // Megafrachtowiec gracza (układ dysz z applyHullThrusterLayout) — wpis bez dysz, inaczej edytor podmieniłby mu dysze.
  assert.deepEqual(SHIPS.megafreighter.engines, { main: [], side: [] });
});

test('markery na sprite\'ach gry: oś na kadłubie ~0,5 R od krawędzi, sponson na kadłubie, dzwon i struga w pustce', () => {
  for (const h of HULLS) {
    const img = sprite(h.sprite);
    const scale = hullScale(h.profile, img);
    const R = nozzleRadiusPx(h.profile, scale);
    for (const m of SHIPS[h.key].engines.side) {
      const out = m.y > 0 ? 1 : -1;
      const tag = `${h.key}/${m.id}`;
      assert.ok(solidAt(img, m.x, m.y), `${tag}: oś dyszy na kadłubie`);
      let inset = 0;
      while (solidAt(img, m.x, m.y + out * (inset + 1))) inset++;
      assert.ok(inset >= 0.2 * R.y && inset <= 1.2 * R.y, `${tag}: oś ${inset} px od krawędzi (R = ${R.y.toFixed(1)} px)`);
      // Dzwon (do SIDE_NOZZLE_MOUTH · R od osi) i początek strugi (+1 R) nad pustką na całej szerokości wylotu.
      for (const dx of [-R.x, 0, R.x]) {
        for (let d = inset + 2; d <= (SIDE_NOZZLE_MOUTH + 1) * R.y; d++) {
          assert.ok(!solidAt(img, m.x + dx, m.y + out * d), `${tag}: kadłub na drodze wydechu (dx ${dx.toFixed(0)}, ${d} px)`);
        }
      }
      // Sponson przykręcony do kadłuba: część płyty w głąb od osi (1,5 R × 2,4 R) w ≥ 90% na kadłubie.
      let n = 0, solid = 0;
      for (let ax = -1.2 * R.x; ax <= 1.2 * R.x; ax += 2) {
        for (let d = 0; d <= 1.5 * R.y; d += 2) { n++; if (solidAt(img, m.x + ax, m.y - out * d)) solid++; }
      }
      assert.ok(solid / n >= 0.9, `${tag}: płyta sponsonu w ${(100 * solid / n).toFixed(0)}% na kadłubie`);
    }
  }
});

test('sponsony poza lukami ładowni (cargoBays.js) i strefą mostka lokomotywy', () => {
  for (const h of HULLS) {
    const img = sprite(h.sprite);
    const scale = hullScale(h.profile, img);
    const R = nozzleRadiusPx(h.profile, scale);
    const side = SHIPS[h.key].engines.side;
    if (h.bays) {
      const bays = CARGO_BAY_HULLS[h.bays];
      assert.deepEqual([bays.png.w, bays.png.h], [img.width, img.height], `${h.key}: ładownie na tym samym płótnie`);
      for (const m of side) {
        for (const b of bays.bays) assert.ok(!overlaps(plateRect(m, R), b.x, b.y, b.w, b.h, 2), `${h.key}/${m.id} na ładowni ${b.id}`);
      }
    }
    if (h.bridge) {
      const entry = BRIDGE_LAYOUT_PROPOSALS[h.bridge];
      const zones = entry.variants[entry.defaultVariant];
      const margin = bridgeZoneMargin(Math.min(scale.x, scale.y), getWeaponTierForHull(h.profile));
      assert.deepEqual(validateBridgeLayout(zones, { engines: { side } }, { margin }), [], `${h.key}: dysze przy mostku`);
      for (const m of side) for (const z of zones) assert.ok(!overlaps(plateRect(m, R), z.x, z.y, z.w, z.h, 2), `${h.key}/${m.id} na mostku`);
    }
  }
});

test('NPC frachtowców: 4 dysze SIDE z kadłubem, wydech na zewnątrz burt, lot, gniazda, rdzenie i światła bez zmian', () => {
  const rt = runtime();
  for (const h of HULLS) {
    const img = sprite(h.sprite);
    const scale = hullScale(h.profile, img);
    const lights = { position: [], road: [] };
    const npc = { ...h.npc, editorLights: lights };
    if (npc.disableEditorLayout) {
      // Lokomotywa: wezwanie tworzy encję z typem szablonu (układ edytora wyłączony), moduł dostaje typ potem.
      npc.type = 'megafreighter';
      assert.equal(rt.applyLayoutToNpc(npc), true);
      assert.equal(npc.__editorLayoutShipId, 'disabled');
      npc.type = h.npc.type;
    }
    const before = { hardpoints: npc.editorHardpoints, cores: npc.editorCores, lights: npc.editorLights, engines: npc.engines };
    // Przed budową kadłuba (skala markerów nieznana) — bez dysz: offsety w px PNG wypadłyby za sprite'em.
    assert.equal(rt.applyLayoutToNpc(npc), false, `${h.key}: przed kadłubem`);
    assert.equal(npc.visual?.torqueThrusters, undefined);
    npc.__hardpointScaleX = scale.x;
    npc.__hardpointScaleY = scale.y;
    assert.equal(rt.applyLayoutToNpc(npc), true, h.key);
    assert.equal(npc.__editorLayoutShipId, h.key);
    const side = npc.visual.torqueThrusters;
    assert.equal(side.length, 4, `${h.key}: dysze SIDE`);
    const markers = SHIPS[h.key].engines.side;
    side.forEach((t, i) => {
      const left = t.offset.y < 0;
      assert.ok(Math.abs(t.offset.x - markers[i].x * scale.x) < 1e-9 && Math.abs(t.offset.y - markers[i].y * scale.y) < 1e-9);
      assert.equal(t.side, left ? 'left' : 'right');
      assert.equal(t.baseDeg, left ? 180 : 0, `${h.key}: baza kąta z burty`);
      assert.ok(left ? -t.forward.y < -0.99 : -t.forward.y > 0.99, `${h.key}: wydech na zewnątrz burty`);
    });
    // Sam wygląd: bez dysz MAIN (ścieżka lotu jak dawniej), gniazda, rdzenie, światła i napęd nietknięte.
    assert.equal(npc.visual.mainThrusters, undefined);
    assert.equal(npc.visual.engineFx, undefined);
    assert.equal(npcHasPhysicalThrusters(npc), false);
    assert.equal(npc.editorHardpoints, before.hardpoints);
    assert.equal(npc.editorCores, before.cores);
    assert.equal(npc.editorLights, before.lights);
    assert.equal(npc.engines, before.engines);
    // Ten sam układ i skala — bez przebudowy (lista dysz to klucz pamięci podręcznej modeli i mocowań).
    assert.equal(rt.applyLayoutToNpc(npc), true);
    assert.equal(npc.visual.torqueThrusters, side);
    // Farba dyszy z profilu kadłuba: szary cywilny.
    assert.equal(sideThrusterPaletteFor(resolveEntityHullProfileId(npc)), SIDE_THRUSTER_PALETTE.CIVIL, `${h.key}: paleta`);
  }
});

test('moduły składu megafrachtowca: kadłub ze sprite\'a modułu, nie z obrazka całego składu (TRAFFIC_HULLS.megafreighter)', () => {
  // Dysze lokomotywy (i strefa mostka, ładownie wagonów) leżą w px sprite'a modułu — kadłub z obrazka całego składu
  // (proxy ruchu v2) przesuwał je obok kadłuba (w grze skala markerów 2760 / 1774 zamiast 2760 / 1672).
  assert.notEqual(TRAFFIC_HULLS.megafreighter.sprite, LOCOMOTIVE.spriteSrc);
  const src = read('index.html');
  const at = src.indexOf('function getHullSpriteForNpc(npc) {');
  assert.ok(at > 0, 'getHullSpriteForNpc');
  const fn = src.slice(at, src.indexOf('\n    }\n', at));
  const guard = fn.indexOf("if (String(npc?.type || '').startsWith('megafreighter_')) return null;");
  assert.ok(guard > 0 && guard < fn.indexOf('TRAFFIC_HULLS[hullProfileId]'), 'moduł składu bez sprite\'a z TRAFFIC_HULLS');
  assert.match(src, /getHullSpriteForNpc\(npc\) \|\| \(npc\.capitalSprite && npc\.capitalSprite\.ready \? npc\.capitalSprite : null\)/,
    'zapas wywołującego: sprite modułu (capitalSprite)');
});

test('bez dysz frachtowca: furgony ładunku (sprite fregaty), wagony i ogon megafrachtowca; typ bez ramy jak FREIGHTER_HULL_BY_TYPE', () => {
  const rt = runtime();
  // Furgon ładunku (materializeCargoOrder): rama terran_frigate — rysuje się sprite'em fregaty Terra Nova, markery
  // frachtowca wypadłyby poza nią, a układ fregaty dałby dysze MAIN (inna ścieżka lotu).
  const van = { type: 'freighter-small', shipFrame: 'terran_frigate', isCargoVan: true, __hardpointScaleX: 0.08, __hardpointScaleY: 0.08 };
  assert.equal(rt.applyLayoutToNpc(van), false);
  assert.equal(van.visual, undefined);
  for (const type of ['megafreighter_wagon', 'megafreighter_back']) {
    const npc = { type, shipFrame: 'megafreighter', disableEditorLayout: true, __hardpointScaleX: 1.65, __hardpointScaleY: 1.65, visual: {} };
    assert.equal(rt.applyLayoutToNpc(npc), true);
    assert.equal(npc.__editorLayoutShipId, 'disabled', type);
    assert.equal(npc.visual.torqueThrusters, undefined, type);
  }
  // Typ bez ramy kadłuba (przed assignNpcShipFrame) — wpis jak sprite z FREIGHTER_HULL_BY_TYPE (index.html).
  const pairs = (src) => Object.fromEntries([...src.match(/const FREIGHTER_HULL_BY_TYPE = Object\.freeze\(\{([\s\S]*?)\}\);/)[1]
    .matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
  const game = pairs(read('index.html'));
  assert.deepEqual(pairs(read('src/game/npcHardpointRuntime.js')), game, 'lustro FREIGHTER_HULL_BY_TYPE');
  for (const [type, key] of Object.entries(game)) {
    const npc = { type, __hardpointScaleX: 0.3, __hardpointScaleY: 0.3 };
    assert.equal(rt.applyLayoutToNpc(npc), true, type);
    assert.equal(npc.__editorLayoutShipId, key, type);
  }
});
