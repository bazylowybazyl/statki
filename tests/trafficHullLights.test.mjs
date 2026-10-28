// Lampy pozycyjne cywilnych kadłubów ruchu v2 (E17, src/data/trafficHullLights.js): każdy cywil (wpis edytora
// `sideOnly`) ma lampy na kadłubie (alfa sprite'a pod lampą i wokół niej), czerwona na lewej burcie, zielona na prawej,
// wpis edytora je niesie, NPC po awansie dostaje je w `editorLights` (applySideOnlyLayout), bez reflektorów otoczenia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { readPng } from '../scripts/webgpu/png.mjs';
import { TRAFFIC_HULLS } from '../src/data/trafficHulls.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { TRAFFIC_HULL_LIGHT_POINTS, trafficCivilLights } from '../src/data/trafficHullLights.js';
import { createNpcHardpointRuntime } from '../src/game/npcHardpointRuntime.js';
import { getEntityLights } from '../src/game/shipLightRuntime.js';

const SHIPS = SHIP_EDITOR_DEFAULTS.ships;
const CIVIL = Object.keys(TRAFFIC_HULLS).filter((id) => SHIPS[TRAFFIC_HULLS[id].editorKey || id]?.sideOnly === true);

test('każdy cywilny kadłub ruchu ma lampy pozycyjne: dziób, rufa, czerwona lewa i zielona prawa burta', () => {
  assert.ok(CIVIL.length >= 14, `cywile: ${CIVIL.length}`);
  for (const id of CIVIL) {
    const block = trafficCivilLights(id);
    assert.ok(block, `${id}: brak lamp`);
    assert.equal(block.autoFlood, false, `${id}: bez reflektorów otoczenia`);
    assert.equal(block.road.length + block.flood.length, 0);
    const p = block.position;
    assert.ok(p.length >= 6, `${id}: ${p.length} lamp`);
    assert.equal(new Set(p.map((m) => m.id)).size, p.length, `${id}: id lamp`);
    for (const m of p) {
      if (m.color === '#ff2b2b') assert.ok(m.y < 0, `${id}/${m.id}: czerwona na lewej burcie (−y)`);
      if (m.color === '#2bff6a') assert.ok(m.y > 0, `${id}/${m.id}: zielona na prawej burcie (+y)`);
    }
    const bow = p.find((m) => m.id === 'civ_bow');
    const stern = p.find((m) => m.id === 'civ_stern');
    assert.ok(bow && stern && bow.x > 0 && stern.x < 0, `${id}: dziób z przodu, rufa z tyłu`);
  }
  assert.deepEqual(Object.keys(TRAFFIC_HULL_LIGHT_POINTS).sort(), [...CIVIL].sort(), 'tabela = wszyscy cywile ruchu');
});

test('lampy leżą na kadłubie: alfa sprite\'a pod lampą i w promieniu 4 px PNG (mocowanie do komórki siatki belek)', () => {
  for (const id of CIVIL) {
    const img = readPng(fileURLToPath(TRAFFIC_HULLS[id].sprite));
    const solid = (x, y) => {
      const xi = Math.floor(img.width / 2 + x);
      const yi = Math.floor(img.height / 2 + y);
      return xi >= 0 && yi >= 0 && xi < img.width && yi < img.height && img.data[(yi * img.width + xi) * 4 + 3] > 127;
    };
    for (const m of trafficCivilLights(id).position) {
      for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) {
        assert.ok(solid(m.x + dx, m.y + dy), `${id}/${m.id}: (${m.x + dx}, ${m.y + dy}) poza kadłubem`);
      }
    }
  }
});

test('wpis edytora cywila niesie lampy, NPC po awansie dostaje je (applySideOnlyLayout) — przez getEntityLights', () => {
  for (const id of CIVIL) assert.equal(SHIPS[id].lights, trafficCivilLights(id), `${id}: lampy we wpisie edytora`);
  const rt = createNpcHardpointRuntime({ defaultShips: SHIPS });
  rt.refreshCache(true);
  const npc = { type: 'freighter-medium', shipFrame: 'container_ship', __hardpointScaleX: 0.176, __hardpointScaleY: 0.176 };
  assert.equal(rt.applyLayoutToNpc(npc), true);
  assert.equal(npc.editorLights.position.length, trafficCivilLights('container_ship').position.length);
  assert.equal(npc.editorLights.autoFlood, false);
  // Blok lamp encji: same pozycyjne (bez automatycznych reflektorów otoczenia).
  const block = getEntityLights(npc);
  assert.equal(block.position.length, 6);
  assert.equal(block.flood.length, 0);
  // Lokomotywa megafrachtowca (układ edytora wyłączony) — bez lamp z tabeli.
  const loco = { type: 'megafreighter_front', shipFrame: 'megafreighter', disableEditorLayout: true, __hardpointScaleX: 1, __hardpointScaleY: 1 };
  rt.applyLayoutToNpc(loco);
  assert.ok(!loco.editorLights);
});
