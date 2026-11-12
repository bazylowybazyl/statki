// Światła nawigacyjne okrętów (src/data/shipNavLights.js, decyzja użytkownika 2026-11-06): sześć lamp na każdym kadłubie,
// lewa burta czerwona, prawa zielona, „blink blink”; oświetlają tylko w błysku; styl ostrzegawczy dla konstrukcyjnych;
// lampy leżą na kadłubie (wiążą się z komórką siatki belek); zapis edytora z dawnymi lampami przechodzi na nowe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { readPng } from '../scripts/webgpu/png.mjs';
import { TRAFFIC_HULLS } from '../src/data/trafficHulls.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import {
  NAV_BLINK_PATTERNS,
  NAV_LIGHT_LAYOUT,
  NAV_LIGHT_POINTS,
  NAV_LIGHT_STYLES,
  migrateSavedNavLights,
  navBlinkCode,
  navBlinkValue,
  navPhaseFromId,
  navPhaseOf,
  restyleNavLights,
  shipNavLightMarkers
} from '../src/data/shipNavLights.js';
import { migratePirateSpriteLayout } from '../src/data/pirateSpriteMigration.js';
import { createNpcHardpointRuntime } from '../src/game/npcHardpointRuntime.js';
import {
  buildCombinedShipLightShaderPayload,
  buildNavLightClusters,
  buildPositionLightWorldSprites,
  buildShipLightShaderPayload,
  getEntityLights
} from '../src/game/shipLightRuntime.js';
import { compactLightMarker, LIGHT_KINDS, normalizeLightsBlock } from '../src/ui/shipLightEditorModel.js';

const SHIPS = SHIP_EDITOR_DEFAULTS.ships;
const RED = NAV_LIGHT_STYLES.aviation.port;
const GREEN = NAV_LIGHT_STYLES.aviation.starboard;

// Sprite kadłuba wg klucza edytora (jak scripts/lampy-nawigacyjne.mjs).
const spriteOf = (key) => {
  const extra = {
    atlas: 'assets/capital_ship_rect_v1.png',
    terran_supercapital: 'src/assets/ships/terransupercapital.png',
    pirate_supercapital: 'src/assets/ships/piratecapital.png',
    capital_carrier: 'assets/carrier.png',
    megafreighter_front: 'assets/megafreighterfront.png'
  };
  if (extra[key]) return fileURLToPath(new URL(`../${extra[key]}`, import.meta.url));
  const id = Object.keys(TRAFFIC_HULLS).find((k) => (TRAFFIC_HULLS[k].editorKey || k) === key);
  return fileURLToPath(TRAFFIC_HULLS[id].sprite);
};

test('każdy kadłub z edytora ma sześć lamp: dziób, najszersze miejsce, rufa, po parze na burtę', () => {
  assert.deepEqual(Object.keys(NAV_LIGHT_POINTS).sort(), Object.keys(SHIPS).sort(), 'tabela = wszystkie kadłuby edytora');
  for (const [key, cfg] of Object.entries(SHIPS)) {
    const p = cfg.lights.position;
    assert.equal(p.length, 6, key);
    assert.deepEqual(p.map((m) => m.id), ['nav_bow_l', 'nav_bow_r', 'nav_wide_l', 'nav_wide_r', 'nav_stern_l', 'nav_stern_r'], key);
    assert.equal(cfg.lights.navLayout, NAV_LIGHT_LAYOUT, key);
    for (let i = 0; i < 6; i += 2) {
      assert.equal(p[i].x, p[i + 1].x, `${key}: para w jednej kolumnie`);
      assert.ok(p[i].y < p[i + 1].y, `${key}: lewa burta nad prawą (y w dół obrazka)`);
    }
    assert.ok(p[0].x > p[2].x && p[2].x > p[4].x, `${key}: dziób przed najszerszym, najszersze przed rufą`);
    const width = (i) => p[i + 1].y - p[i].y;
    assert.ok(width(2) >= width(0) && width(2) >= width(4), `${key}: najszersza para ${width(2)} (dziób ${width(0)}, rufa ${width(4)})`);
  }
});

test('barwy: lewa burta czerwona, prawa zielona; styl ostrzegawczy na kadłubach konstrukcyjnych', () => {
  for (const [key, cfg] of Object.entries(SHIPS)) {
    const warning = key === 'construction_tug' || key === 'service_tug';
    const style = warning ? NAV_LIGHT_STYLES.warning : NAV_LIGHT_STYLES.aviation;
    cfg.lights.position.forEach((m, i) => {
      assert.equal(m.color, i % 2 ? style.starboard : style.port, `${key}/${m.id}`);
      assert.equal(m.blink, style.pattern, `${key}/${m.id}`);
      assert.equal(m.lag, i % 2 ? style.sideLag : 0, `${key}/${m.id}`);
    });
  }
  assert.equal(SHIPS.atlas.lights.position[0].color, RED);
  assert.equal(SHIPS.atlas.lights.position[1].color, GREEN);
  assert.equal(NAV_LIGHT_STYLES.warning.port, NAV_LIGHT_STYLES.warning.starboard, 'żółte na obu burtach');
  assert.equal(NAV_LIGHT_STYLES.warning.sideLag, 0.5, 'burty na przemian');
});

test('lampy leżą na kadłubie: alfa sprite\'a pod lampą i w promieniu 4 px PNG (mocowanie do komórki siatki belek)', () => {
  for (const key of Object.keys(SHIPS)) {
    const img = readPng(spriteOf(key));
    const solid = (x, y) => {
      const xi = Math.floor(img.width / 2 + x);
      const yi = Math.floor(img.height / 2 + y);
      return xi >= 0 && yi >= 0 && xi < img.width && yi < img.height && img.data[(yi * img.width + xi) * 4 + 3] > 127;
    };
    for (const m of SHIPS[key].lights.position) {
      for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) {
        assert.ok(solid(m.x + dx, m.y + dy), `${key}/${m.id}: (${m.x + dx}, ${m.y + dy}) poza kadłubem`);
      }
    }
  }
});

test('reflektory: kadłuby z dawnego obrysu lamp zostają przy swoich, pozostałe bez reflektorów otoczenia', () => {
  const expected = { atlas: 5, terran_carrier: 5, terran_supercapital: 5, destroyer: 1 };
  for (const [key, cfg] of Object.entries(SHIPS)) {
    assert.equal(cfg.lights.flood.length, expected[key] || 0, key);
    const block = getEntityLights({ editorLights: cfg.lights });
    assert.equal(block.flood.length, expected[key] || 0, `${key}: bez dokładania z obrysu lamp`);
  }
  assert.equal(SHIPS.atlas.lights.road.length, 2, 'reflektory dalekie Atlasa bez zmian');
  assert.equal(SHIPS.destroyer.lights.road.length, 1);
});

test('NPC po układzie edytora i lokomotywa dostają lampy z tabeli', () => {
  const rt = createNpcHardpointRuntime({ defaultShips: SHIPS });
  rt.refreshCache(true);
  const civil = { type: 'freighter-medium', shipFrame: 'container_ship', __hardpointScaleX: 0.176, __hardpointScaleY: 0.176 };
  assert.equal(rt.applyLayoutToNpc(civil), true);
  assert.deepEqual(civil.editorLights.position, SHIPS.container_ship.lights.position);
  const pirate = { type: 'frigate', isPirate: true, __hardpointScaleX: 1, __hardpointScaleY: 1 };
  assert.equal(rt.applyLayoutToNpc(pirate), true);
  assert.deepEqual(pirate.editorLights.position, SHIPS.pirate_frigate.lights.position);
  assert.equal(getEntityLights(pirate).position[0].blink ?? 0, 0);
  const loco = { type: 'megafreighter_front', shipFrame: 'megafreighter', disableEditorLayout: true, __hardpointScaleX: 1, __hardpointScaleY: 1 };
  rt.applyLayoutToNpc(loco);
  assert.equal(loco.editorLights.position.length, 6, 'lokomotywa też ma lampy');
});

test('miganie „blink blink”: dwa błyski na cykl, między nimi ciemno; sygnalizator — jeden', () => {
  const pulses = (code, p) => {
    let rises = 0;
    let lit = 0;
    let was = false;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const v = navBlinkValue((i / n) * p.period, code);
      assert.ok(v >= 0 && v <= 1, `jasność ${v}`);
      const on = v > 0.5;
      if (on && !was) rises++;
      if (v > 0.004) lit++;
      was = on;
    }
    return { rises, litFrac: lit / n };
  };
  const [double, beacon] = NAV_BLINK_PATTERNS;
  const a = pulses(navBlinkCode(0, 0.3), double);
  assert.equal(a.rises, 2, 'blink blink');
  assert.ok(a.litFrac < 0.2, `lampa ciemna przez większość cyklu (${a.litFrac})`);
  const b = pulses(navBlinkCode(1, 0.3), beacon);
  assert.equal(b.rises, 1, 'jeden puls sygnalizatora');
  assert.equal(navBlinkValue(0.025, navBlinkCode(0, 0)), 1, 'pełny błysk');
  assert.equal(navBlinkValue(1, navBlinkCode(0, 0)), 0, 'przerwa');
  assert.equal(navBlinkValue(1, -1), 1, 'kod ujemny: światło stałe');
  // Faza nie przechodzi w następny wzór przy float32.
  assert.equal(Math.floor(Math.fround(navBlinkCode(0, 0.9999999))), 0);
  assert.equal(Math.floor(Math.fround(navBlinkCode(1, 1.2))), 1, 'faza zawinięta do [0, 1)');
});

test('faza okrętu: flota nie miga równo, ten sam okręt zawsze tak samo, proxy z własnego pola', () => {
  assert.notEqual(navPhaseFromId('npc-1'), navPhaseFromId('npc-2'));
  assert.equal(navPhaseFromId('npc-1'), navPhaseFromId('npc-1'));
  for (const id of [0, 1, 7, 123456, 'a', 'haul-00050']) {
    const p = navPhaseFromId(id);
    assert.ok(p >= 0 && p < 1, `${id}: ${p}`);
  }
  assert.equal(navPhaseFromId(undefined), 0);
  const e = { id: 'npc-1' };
  assert.equal(navPhaseOf(e), navPhaseFromId('npc-1'));
  assert.equal(navPhaseOf({ id: 'npc-1', navPhase: 0.25 }), 0.25);
  // NPC bez id: ród kadłuba rozdziela fazy (nazwa jest wspólna dla typu).
  const a = navPhaseOf({ name: 'Bellator', beamHull: { dmgKey: 3 } });
  const b = navPhaseOf({ name: 'Bellator', beamHull: { dmgKey: 4 } });
  assert.ok(Math.abs(a - b) > 0.1, `fazy ${a}, ${b}`);
  // Bez tożsamości: 0 i bez pamięci — kadłub dochodzi później.
  const late = {};
  assert.equal(navPhaseOf(late), 0);
  late.beamHull = { dmgKey: 3 };
  assert.equal(navPhaseOf(late), a);
});

const atlasAt = (id, x, y) => ({ id, x, y, angle: 0, radius: 900, __hardpointScale: 0.48, __hardpointScaleX: 0.48, __hardpointScaleY: 0.48, editorLights: SHIPS.atlas.lights });

test('oświetlanie tylko w błysku: lampa = światło z kodem migania, czerwień z lewej burty, zieleń z prawej', () => {
  const ship = atlasAt('a', 0, 0);
  const code = navBlinkCode(0, navPhaseOf(ship));
  const phase = code % 1 / 0.999;
  const period = NAV_BLINK_PATTERNS[0].period;
  const flashT = (10 + 0.025 - phase) * period;   // chwila pełnego błysku tego okrętu
  const darkT = (10 + 0.6 - phase) * period;
  const at = (t) => buildNavLightClusters([ship], { time: t });
  const lit = at(flashT).map((c) => ({ pulse: c.pulse, color: { ...c.color }, y: c.y }));
  assert.equal(lit.length, 6);
  for (const c of lit) {
    assert.ok(Math.abs(c.pulse - 1) < 1e-6, `pełny błysk ${c.pulse}`);
    if (c.y < 0) assert.ok(c.color.r > 0.9 && c.color.g < 0.3, 'lewa burta czerwona');
    else assert.ok(c.color.g > 0.9 && c.color.r < 0.3, 'prawa burta zielona');
  }
  for (const c of at(darkT)) assert.equal(c.pulse, 0, 'między błyskami bez światła');

  // Kadłub obok dostaje rozlew z kodem migania lampy; shader gasi go między błyskami, więc podpis nie zależy od czasu.
  const target = { id: 't', x: 0, y: 700, angle: 0, radius: 400, editorLights: { position: [], road: [] } };
  const grid = { srcWidth: 800, srcHeight: 300 };
  const a = buildCombinedShipLightShaderPayload(target, grid, [], { externalOmniLights: at(flashT).slice() });
  const signature = a.signature;
  const lamps = a.lights.map((l) => ({ kind: l.kind, blink: l.blink }));
  assert.ok(lamps.length > 0);
  for (const l of lamps) {
    assert.equal(l.kind, 'omni');
    assert.ok(l.blink >= 0 && l.blink < 1);
  }
  const b = buildCombinedShipLightShaderPayload(target, grid, [], { externalOmniLights: at(darkT).slice() });
  assert.equal(b.signature, signature, 'podpis lamp bez zmian co klatkę');
  // Światło świata (błysk burzy) bez kodu świeci stale.
  const storm = buildCombinedShipLightShaderPayload(target, grid, [], {
    externalOmniLights: [{ x: 0, y: 700, color: { r: 1, g: 1, b: 1 }, power: 2, rangeWorld: 500, mean: 1 }]
  });
  assert.equal(storm.lights[0].blink, -1);
});

test('billboard i slot lampy na kadłubie mają ten sam kod migania', () => {
  const ship = atlasAt('b', 0, 0);
  const own = buildShipLightShaderPayload(ship, { srcWidth: 1800, srcHeight: 806 }).lights.filter((l) => l.kind === 'position');
  const sprites = buildPositionLightWorldSprites([ship], { zoom: 1 });
  assert.equal(sprites.length, 6);
  assert.deepEqual(sprites.map((s) => s.blink), own.map((l) => l.blink));
  // Reflektor nie miga.
  for (const l of buildShipLightShaderPayload(ship, { srcWidth: 1800, srcHeight: 806 }).lights) {
    if (l.kind !== 'position') assert.equal(l.blink, -1, l.id);
  }
  // Styl ostrzegawczy: burty na przemian, inny wzór.
  const tug = { ...atlasAt('c', 0, 0), editorLights: restyleNavLights(SHIPS.atlas.lights, 'warning') };
  const s = buildPositionLightWorldSprites([tug], { zoom: 1 });
  assert.equal(Math.floor(s[0].blink), 1);
  assert.ok(Math.abs(Math.abs(s[0].blink - s[1].blink) - 0.5) < 0.01, 'prawa burta pół cyklu później');
  assert.ok(s[0].color.r > 0.9 && s[0].color.g > 0.5 && s[0].color.b < 0.3, 'żółta lampa');
});

test('edytor: wzór i przesunięcie przechodzą normalizację i zapis', () => {
  const warning = shipNavLightMarkers('construction_tug');
  const block = normalizeLightsBlock({ position: warning });
  assert.equal(block.position[1].blink, 1);
  assert.equal(block.position[1].lag, 0.5);
  const saved = compactLightMarker(block.position[1], LIGHT_KINDS.POSITION);
  assert.equal(saved.blink, 1);
  assert.equal(saved.lag, 0.5);
  // Lampa bez pól — wzór domyślny, jak dawniej.
  const plain = normalizeLightsBlock({ position: [{ id: 'p', x: 1, y: 2 }] }).position[0];
  assert.equal(plain.blink, undefined);
  assert.equal(plain.lag, undefined);
});

test('zapis edytora: dawne lampy obrysu → światła nawigacyjne raz, układ zapisany po zmianie zostaje', () => {
  const old = {
    hardpoints: [],
    lights: {
      position: Array.from({ length: 42 }, (_, i) => ({ id: `m${i}`, x: i, y: 0, color: '#ff2b2b' })),
      road: [{ id: 'r', x: 5, y: 0, deg: 90 }],
      flood: []
    }
  };
  const m = migrateSavedNavLights('atlas', old);
  assert.equal(m.lights.position.length, 6);
  assert.deepEqual(m.lights.road, old.lights.road, 'reflektory dalekie z zapisu');
  assert.equal(m.lights.flood.length, 5, 'reflektory otoczenia kadłuba');
  assert.equal(old.lights.position.length, 42, 'bez mutacji wejścia');
  assert.strictEqual(migrateSavedNavLights('atlas', m), m, 'idempotentna');
  assert.equal(migratePirateSpriteLayout('atlas', old).lights.position.length, 6, 'wspólna ścieżka gracza, NPC i edytora');
  // Własne reflektory z zapisu mają pierwszeństwo.
  const ownFlood = migrateSavedNavLights('atlas', { lights: { position: [], flood: [{ id: 'f', x: 0, y: 0 }] } });
  assert.deepEqual(ownFlood.lights.flood.map((f) => f.id), ['f']);
  // Układ po zmianie (`navLayout`) — decyzja użytkownika, bez ruszania.
  const mine = { lights: { navLayout: NAV_LIGHT_LAYOUT, position: [{ id: 'moja', x: 1, y: 1 }], road: [], flood: [] } };
  assert.strictEqual(migrateSavedNavLights('atlas', mine), mine);
  // Wpis bez lamp i kadłub spoza tabeli — bez zmian.
  const noLights = { hardpoints: [] };
  assert.strictEqual(migrateSavedNavLights('atlas', noLights), noLights);
  const unknown = { lights: { position: [] } };
  assert.strictEqual(migrateSavedNavLights('nieznany', unknown), unknown);
});
