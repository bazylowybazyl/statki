// Wieże okrętów ruchu v2 na proxy bańki (E17b) — tabela dla OBRAZU proxy (src/data/trafficProxyTurrets.js).
// NPC po awansie dostaje broń z gniazd edytora (applyEditorLayoutToNpc → equipNpcWeapons z index.html — zestaw frakcji,
// limit gniazd ramy), kąt spoczynku wieży z initAutonomousWeapons (capitalAI: łuk gniazda) i rekord wieży z Turret2D
// (pozycja w skali gniazd renderu, skala sylwetki, promień spec do LOD). Proxy nie ma tej logiki w renderze, więc ten
// skrypt liczy ją PRAWDZIWYM kodem gry w Node dla każdego okrętu ruchu (TRAFFIC_COMBAT_HULLS) i obu zestawów broni
// (terran / pirate — jak trafficWeaponFaction) i wypisuje tabelę. Strażnik: tests/turretProxy.test.mjs (tabela = gra).
//
//   node scripts/wieze-proxy-ruchu.mjs
import { fileURLToPath } from 'node:url';

globalThis.window ??= globalThis;
window.wrecks ??= [];

const { SHIPS, getHullRenderSize } = await import('../src/data/ships.js');
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const { SHIP_EDITOR_DEFAULTS } = await import('../src/data/hardpointEditorDefaults.js');
const { TRAFFIC_HULLS } = await import('../src/data/trafficHulls.js');
const { createNpcHardpointRuntime } = await import('../src/game/npcHardpointRuntime.js');
const { resolveNpcSpecFrameId, selectSpecSlots } = await import('../src/game/npcWeaponSpec.js');
const { TRAFFIC_COMBAT_HULLS } = await import('../src/game/trafficPromotion.js');
const { initAutonomousWeapons } = await import('../src/ai/capitalAI.js');
const { Turret2D } = await import('../src/vfx/turret2D.js');
const { readIndexHtml, loadIndexFunction } = await import('../tests/helpers/indexSource.mjs');

const equipNpcWeapons = loadIndexFunction(readIndexHtml(), 'function equipNpcWeapons(npc, faction) {', 'equipNpcWeapons', {
  SHIPS, MASTER_WEAPONS, resolveNpcSpecFrameId, selectSpecSlots
});
const runtime = createNpcHardpointRuntime({ defaultShips: SHIP_EDITOR_DEFAULTS?.ships || {} });

const round = (v, k = 100) => Math.round(v * k) / k;

/**
 * Wieże NPC kadłuba ruchu `hullId` z zestawem `faction` ('terran' | 'pirate') w spoczynku, okręt w (0, 0) z kątem 0:
 * [[weaponId, x, y, kąt, skala, r], …] — x, y [j. świata] od środka sprite'a (y w dół), kąt spoczynku lufy względem
 * kadłuba [rad], skala i promień sylwetki rekordu Turret2D.
 */
export function proxyTurretsFor(hullId, faction) {
  const def = TRAFFIC_HULLS[hullId];
  const role = TRAFFIC_COMBAT_HULLS[hullId];
  if (!def || !role) return [];
  const size = getHullRenderSize(hullId, def.png[0], def.png[1]);
  const sx = Math.max(64, size.w) / def.png[0];
  const sy = Math.max(64, size.h) / def.png[1];
  const npc = {
    x: 0, y: 0, angle: 0, type: role.type, shipFrame: hullId, isPirate: faction === 'pirate',
    __hardpointScaleX: sx, __hardpointScaleY: sy, __hardpointScale: (sx + sy) * 0.5,
    weapons: { main: [], aux: [], missile: [], hangar: [], special: [], special_missile: [], builtin: [] }
  };
  runtime.applyLayoutToNpc(npc);
  equipNpcWeapons(npc, faction);
  initAutonomousWeapons(npc);
  for (const w of npc.autoWeapons || []) w.visualAngle = npc.angle + (Number(w.mountAngle) || 0);
  Turret2D.beginFrame();
  Turret2D.sync(npc, 0, 0, 0, 1);
  const recs = Turret2D.recordsFor(npc) || [];
  return recs.map((r) => [r.weaponId, round(r.wx), round(r.wy), round(r.ang, 1e4), round(r.scale, 1e4), round(Number(r.spec?.r) || 0, 1e3)]);
}

export function trafficCombatHullIds() {
  return Object.keys(TRAFFIC_COMBAT_HULLS).filter((id) => TRAFFIC_HULLS[id]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('export const TRAFFIC_PROXY_TURRETS = Object.freeze({');
  const ids = trafficCombatHullIds();
  ids.forEach((id, k) => {
    const row = (f) => proxyTurretsFor(id, f).map((t) => `[${JSON.stringify(t[0]).replace(/"/g, "'")}, ${t.slice(1).join(', ')}]`).join(', ');
    console.log(`  ${id}: Object.freeze({`);
    console.log(`    terran: Object.freeze([${row('terran')}]),`);
    console.log(`    pirate: Object.freeze([${row('pirate')}])`);
    console.log(`  })${k < ids.length - 1 ? ',' : ''}`);
  });
  console.log('});');
}
