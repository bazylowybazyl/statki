import test from 'node:test';
import assert from 'node:assert/strict';

import { SHIPS } from '../src/data/ships.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { createNpcHardpointRuntime } from '../src/game/npcHardpointRuntime.js';
import {
  NPC_SPEC_WEAPON_TYPES,
  resolveNpcSpecFrameId,
  selectSpecSlots,
  pickEvenlyByAngle
} from '../src/game/npcWeaponSpec.js';
import { readIndexHtml, loadIndexFunction } from './helpers/indexSource.mjs';

const html = readIndexHtml();

// equipNpcWeapons prosto z index.html — z prawdziwym katalogiem ram i broni.
const equipNpcWeapons = loadIndexFunction(html, 'function equipNpcWeapons(npc, faction) {', 'equipNpcWeapons', {
  SHIPS, MASTER_WEAPONS, resolveNpcSpecFrameId, selectSpecSlots
});

// Layout „jak z hpEditor.v1”: dużo więcej gniazd niż spec, rozstawionych
// dookoła kadłuba (obie burty, dziób, rufa). Kolejność zapisu celowo po burtach
// — najpierw cała lewa, potem cała prawa — żeby „pierwsze N” dało jedną burtę.
function oversizedLayout({ main = 24, aux = 30, missile = 12 } = {}) {
  const out = [];
  let id = 0;
  for (const [type, count] of [['main', main], ['aux', aux], ['missile', missile]]) {
    const half = Math.ceil(count / 2);
    for (let i = 0; i < count; i++) {
      const side = i < half ? -1 : 1; // lewa burta najpierw
      const k = i < half ? i : i - half;
      const span = Math.max(1, half - 1);
      out.push({ id: `hp_${id++}`, type, x: -300 + (600 * k) / span, y: side * (80 + (k % 3) * 20), rot: 0 });
    }
  }
  return out;
}

function countMounted(npc) {
  const counts = {};
  for (const hp of npc.editorHardpoints) {
    if (hp.mount) counts[hp.type] = (counts[hp.type] || 0) + 1;
  }
  return counts;
}

const SPEC_FRAMES = Object.keys(SHIPS).filter((id) => SHIPS[id]?.spec);

test('każda rama z ships.js: obsadzone gniazda ≤ spec, reszta pusta', () => {
  assert.ok(SPEC_FRAMES.length >= 8, `za mało ram ze spec: ${SPEC_FRAMES.length}`);
  for (const frameId of SPEC_FRAMES) {
    for (const faction of ['terran', 'pirate']) {
      const npc = { shipFrame: frameId, type: 'battleship', editorHardpoints: oversizedLayout() };
      equipNpcWeapons(npc, faction);
      const spec = SHIPS[frameId].spec;
      const mounted = countMounted(npc);
      for (const type of NPC_SPEC_WEAPON_TYPES) {
        const available = npc.editorHardpoints.filter((hp) => hp.type === type).length;
        const expected = Math.min(available, Math.max(0, spec[type] | 0));
        assert.equal(mounted[type] || 0, expected, `${frameId}/${faction}/${type}: ${mounted[type] || 0} ≠ ${expected}`);
        assert.equal(npc.weapons[type].length, expected, `${frameId}/${type}: npc.weapons nie zgadza się z gniazdami`);
        for (const loadout of npc.weapons[type]) {
          assert.equal(loadout.hp.mount, loadout.weapon.id, 'wpis broni wskazuje obsadzone gniazdo');
        }
      }
      // Nieobsadzone gniazdo nie może udawać broni (Turret2D, AI, integralność).
      for (const hp of npc.editorHardpoints) {
        if (!npc.weapons[hp.type]?.some((l) => l.hp === hp)) assert.ok(!hp.mount, `${frameId}: puste gniazdo z mount=${hp.mount}`);
      }
    }
  }
});

test('wybrane gniazda są rozłożone na obie burty, nie „pierwsze N”', () => {
  for (const frameId of SPEC_FRAMES) {
    const npc = { shipFrame: frameId, editorHardpoints: oversizedLayout() };
    equipNpcWeapons(npc, 'terran');
    for (const type of NPC_SPEC_WEAPON_TYPES) {
      const picked = npc.weapons[type].map((l) => l.hp);
      if (picked.length < 2) continue;
      const left = picked.filter((hp) => hp.y < 0).length;
      const right = picked.filter((hp) => hp.y > 0).length;
      assert.ok(left > 0 && right > 0, `${frameId}/${type}: ${left} lewa / ${right} prawa — jednostronna burta`);
      assert.ok(Math.abs(left - right) <= 1, `${frameId}/${type}: ${left}/${right} — nierówno`);
    }
  }
});

test('domyślne layouty z edytora też są przycinane do spec', () => {
  const editorToFrame = {
    frigate: 'terran_frigate',
    destroyer: 'terran_destroyer',
    battleship: 'terran_battleship',
    pirate_frigate: 'pirate_frigate',
    pirate_destroyer: 'pirate_destroyer',
    pirate_battleship: 'pirate_battleship',
    terran_carrier: 'terran_carrier',
    terran_supercapital: 'terran_supercapital',
    atlas: 'atlas'
  };
  for (const [editorId, frameId] of Object.entries(editorToFrame)) {
    const cfg = SHIP_EDITOR_DEFAULTS.ships[editorId];
    assert.ok(cfg, `brak layoutu ${editorId}`);
    const npc = {
      shipFrame: frameId,
      editorHardpoints: cfg.hardpoints.map((hp, i) => ({ id: hp.id || `e${i}`, type: String(hp.type).toLowerCase(), x: hp.x, y: hp.y }))
    };
    equipNpcWeapons(npc, 'terran');
    const mounted = countMounted(npc);
    for (const type of NPC_SPEC_WEAPON_TYPES) {
      assert.ok((mounted[type] || 0) <= SHIPS[frameId].spec[type], `${editorId}/${type}: ${mounted[type]} > spec`);
    }
  }
});

// Pułapka 4 briefu: 'hpEditor.v1' w localStorage nadpisuje layouty NPC
// (npcHardpointRuntime). Limit ma działać niezależnie od źródła layoutu.
test('layout nadpisany przez hpEditor.v1 (20 aux na fregacie) też kończy na spec', () => {
  const saved = globalThis.localStorage;
  const custom = { version: 1, ships: { frigate: { frontAxis: '+X', hardpoints: oversizedLayout({ main: 4, aux: 20, missile: 0 }) } } };
  globalThis.localStorage = { getItem: (key) => (key === 'hpEditor.v1' ? JSON.stringify(custom) : null) };
  try {
    const runtime = createNpcHardpointRuntime({ defaultShips: SHIP_EDITOR_DEFAULTS.ships });
    runtime.refreshCache(true);
    const npc = { type: 'frigate', shipFrame: 'terran_frigate', friendly: true };
    assert.equal(runtime.applyLayoutToNpc(npc), true);
    assert.equal(npc.editorHardpoints.filter((hp) => hp.type === 'aux').length, 20, 'layout z localStorage nie wszedł');
    equipNpcWeapons(npc, 'terran');
    const mounted = countMounted(npc);
    assert.equal(mounted.aux, SHIPS.terran_frigate.spec.aux, `aux: ${mounted.aux}`);
    assert.equal(mounted.main, 4);
    const auxPicked = npc.weapons.aux.map((l) => l.hp);
    assert.ok(auxPicked.some((hp) => hp.y < 0) && auxPicked.some((hp) => hp.y > 0), 'aux na obu burtach');
  } finally {
    if (saved === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = saved;
  }
});

test('rama ze shipFrame, a bez niej z typu; nieznana rama = bez limitu', () => {
  assert.equal(resolveNpcSpecFrameId({ shipFrame: 'pirate_destroyer', type: 'frigate' }, SHIPS), 'pirate_destroyer');
  assert.equal(resolveNpcSpecFrameId({ type: 'frigate_pd', isPirate: false }, SHIPS), 'terran_frigate');
  assert.equal(resolveNpcSpecFrameId({ type: 'destroyer', isPirate: true }, SHIPS), 'pirate_destroyer');
  assert.equal(resolveNpcSpecFrameId({ type: 'capital_carrier', shipFrame: 'capital_carrier' }, SHIPS), 'terran_carrier');
  assert.equal(resolveNpcSpecFrameId({ type: 'fighter' }, SHIPS), null);

  const npc = { type: 'mystery', editorHardpoints: oversizedLayout({ main: 5, aux: 7, missile: 0 }) };
  equipNpcWeapons(npc, 'terran');
  assert.deepEqual(countMounted(npc), { main: 5, aux: 7 }, 'bez ramy zachowanie jak dawniej: każde gniazdo');
});

test('pickEvenlyByAngle: deterministyczny, całość przy k ≥ n, pusto przy k = 0', () => {
  const slots = oversizedLayout({ main: 0, aux: 10, missile: 0 });
  const a = pickEvenlyByAngle(slots, 4).map((hp) => hp.id);
  const b = pickEvenlyByAngle(slots, 4).map((hp) => hp.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 4, 'bez powtórzeń');
  assert.equal(pickEvenlyByAngle(slots, 99).length, 10);
  assert.equal(pickEvenlyByAngle(slots, 0).length, 0);
  assert.equal(pickEvenlyByAngle([], 3).length, 0);
});
