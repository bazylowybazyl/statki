// src/ai/npcShipSystem.js
//
// Systemy F okrętów NPC (definicje: src/data/shipSystems.js, stan: src/game/shipSystem.js) — kiedy AI ich używa:
//   ZRYW SILNIKÓW (Terra Nova) — punkt, do którego pilot leci (intencja lotu: dolot do celu poza zasięgiem dział,
//     dołączanie do szyku, ucieczka), leży dalej niż prędkość bojowa × czas zrywu × burstDistK, a dziób patrzy
//     w jego stronę; nie, gdy cel jest w zasięgu dział (walka, poza ucieczką) albo na kursie stoi przeszkoda
//     (pilot przycina dolot — approachCap).
//   SZYBKI OGIEŃ (piraci) — co najmniej rapidShare dział (grupy main / special, bez obrony punktowej) ma cel
//     w zasięgu i w łuku.
// Warunek musi trwać chwilę (burstHold / rapidHold), ładowanie jak u gracza. Maskowany gracz nie jest powodem
// (isCloakHidden). Szarży i manewru AI nie używa (Atlas-NPC — bez systemu).
//
// Krok: processAutonomousWeapons (capitalAI.js — wszystkie mózgi i rozkazy misji), raz na takt mózgu. Skutki:
//   szybki ogień — źródło 'system' modyfikatorów okrętu (src/game/shipModifiers.js): fireRate = 1 / fireRateMul
//                     (mnożnik przeładowania wszystkich broni — capitalAI i fireWeaponCore); zmiana przelicza
//                     przeładowania w toku (`weapon.cd`), więc działa od razu; npc.__fSysRate — szybkostrzelność ×k
//                     (diagnostyka);
//   npc.__fSysBoost — zryw: dopalacz w intencji lotu (boostSpeedMul / boostAccelMul — shipFlightModel.js,
//                     commitCapitalFlight) i struga MAIN jak przy dopalaczu (engineVfxSystem.js).

import { npcShipSystemFor } from '../data/shipSystems.js';
import {
  bindShipSystem, createShipSystemState, shipSystemFireRateMul, shipSystemMainBoost, startShipSystemBurst,
  stepShipSystem, stopShipSystem, wrapSysAngle
} from '../game/shipSystem.js';
import { isCloakHidden } from '../game/cloak.js';
import { getFlightIntent, resolveShipFlightSpec } from '../game/flight/shipFlightModel.js';
import { clearModifierSource, fireRateModifier, modifierFireRate, setModifierSource } from '../game/shipModifiers.js';

export const NPC_SYSTEM_AI = Object.freeze({
  // Szybki ogień: ułamek dział z celem w zasięgu i łuku; warunek trwa tyle sekund.
  rapidShare: 0.6,
  rapidHold: 0.4,
  // Zryw: punkt dalej niż max(burstMinDist, prędkość bojowa × czas zrywu × burstDistK) [j.].
  burstDistK: 0.8,
  burstMinDist: 2500,
  // …dziób w jego stronę (cos kąta), cel bliżej niż zasięg najdalszego działa × burstRangeK = walka.
  burstFace: 0.5,
  burstRangeK: 1.15,
  burstHold: 0.3
});

/** Licznik użyć (diagnostyka i skrypty w grze). */
export const NPC_SYSTEM_STATS = { engine_burst: 0, rapid_fire: 0 };

// Definicja systemu NPC — z pamięci encji (shipFrame / typ zmieniają się rzadko).
export function npcShipSystemDef(npc) {
  if (!npc) return null;
  if (npc.__fSysFrame !== npc.shipFrame || npc.__fSysType !== npc.type || npc.__fSysPick !== npc.shipSystemId) {
    npc.__fSysFrame = npc.shipFrame;
    npc.__fSysType = npc.type;
    npc.__fSysPick = npc.shipSystemId;
    npc.__fSysDef = npcShipSystemFor(npc);
  }
  return npc.__fSysDef || null;
}

/** Czy okręt ma zryw silników (aiDestroyer: dawny dopalacz flanki zastępuje wtedy system F). */
export function npcHasEngineBurst(npc) {
  const def = npcShipSystemDef(npc);
  return !!def && def.id === 'engine_burst';
}

/** Szybkostrzelność ×k NPC z szybkiego ognia (1 bez niego; przeładowanie — modifiers.fireRate). */
export function npcFireRateMul(npc) {
  const r = npc ? npc.__fSysRate : 1;
  return r > 1 ? r : 1;
}

// Rozkazy, w których AI nie sięga po system: wylot z doku trasą, uśpienie (misja), tunel warpa, powrót,
// platforma obronna misji (kadłub zastępczy fregaty).
function npcSystemBlocked(npc) {
  return !!(npc.dead || npc.destroyed || npc.combatDisabled === true || npc.__dockLaunching || npc.__warpReturn
    || npc.__storyTurret || npc.isCollidable === false || npc.state === 'warping_in');
}

function targetX(t) { return t.pos ? t.pos.x : t.x; }
function targetY(t) { return t.pos ? t.pos.y : t.y; }
function isProjectile(t) { return t.type === 'rocket' || t.type === 'torpedo'; }
function isGun(w) { return !!w && (w.group === 'main' || w.group === 'special') && !w.pd; }

// Zasięg najdalszego działa (pamięć do zmiany listy broni).
function npcGunRange(npc) {
  const ws = npc.autoWeapons;
  const n = Array.isArray(ws) ? ws.length : 0;
  if (npc.__fSysRangeN === n && npc.__fSysRange !== undefined) return npc.__fSysRange;
  let r = 0;
  for (let i = 0; i < n; i++) {
    const w = ws[i];
    if (!isGun(w)) continue;
    const br = Number(w.def?.baseRange) || 0;
    if (br > r) r = br;
  }
  npc.__fSysRangeN = n;
  npc.__fSysRange = r;
  return r;
}

/** Szybki ogień: czy dość dział ma teraz cel (okręt, nie pocisk) w zasięgu i w łuku. */
export function npcWantsRapidFire(npc, share = NPC_SYSTEM_AI.rapidShare) {
  const ws = npc.autoWeapons;
  if (!Array.isArray(ws) || ws.length === 0) return false;
  const nx = Number(npc.x) || 0;
  const ny = Number(npc.y) || 0;
  const ang = Number(npc.angle) || 0;
  let guns = 0;
  let engaged = 0;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (!isGun(w)) continue;
    const hp = w.hpOffset;
    if (hp && hp.destroyed) continue;
    if (w.ammo !== null && w.ammo !== undefined && w.ammo <= 0) continue;
    guns++;
    const t = w.cachedTarget;
    if (!t || t.dead || t.destroyed || t.isWreck || isProjectile(t) || isCloakHidden(t)) continue;
    const dx = (Number(targetX(t)) || 0) - nx;
    const dy = (Number(targetY(t)) || 0) - ny;
    const range = (Number(w.def?.baseRange) || 1000) + (Number(t.radius) || 0);
    if (dx * dx + dy * dy > range * range) continue;
    const arc = Number(w.arc);
    if (arc >= 0 && Math.abs(wrapSysAngle(Math.atan2(dy, dx) - (ang + (Number(w.mountAngle) || 0)))) > arc) continue;
    engaged++;
  }
  return guns > 0 && engaged >= Math.max(1, Math.ceil(guns * share));
}

/** Zryw silników: czy pilot leci daleko (intencja lotu), dziobem w tę stronę, a cel nie jest w zasięgu dział. */
export function npcWantsEngineBurst(npc, def, ai = NPC_SYSTEM_AI) {
  const it = npc.__flightIntent;
  if (!it || it.mode !== 'arrive') return false;
  // Wszystkie dysze MAIN zniszczone (src/game/engineDamage.js — stan na encji, bez importu): zryw nie ma czym
  // pchać (jak u gracza i szarży); częściowo — zryw słabszy sam (model lotu mnoży ciąg przez żywe dysze).
  const dmg = npc.__engineDamage;
  if (dmg && dmg.count > 0 && dmg.dead >= dmg.count) return false;
  const spec = resolveShipFlightSpec(npc);
  if (!spec) return false;
  const nx = Number(npc.x) || 0;
  const ny = Number(npc.y) || 0;
  const dx = it.x + it.refVx * it.age - nx;
  const dy = it.y + it.refVy * it.age - ny;
  const d = Math.sqrt(dx * dx + dy * dy);
  const need = Math.max(ai.burstMinDist, spec.maxSpeed * (Number(def.duration) || 4) * ai.burstDistK);
  if (d - (Number(it.arrival) || 0) < need) return false;
  const ang = Number(npc.angle) || 0;
  if (dx * Math.cos(ang) + dy * Math.sin(ang) < ai.burstFace * d) return false;
  // Pilot przycina dolot przed przeszkodą (okręt, wrak) — nie pędzimy w nią.
  if (it.approachCap < spec.maxSpeed * 0.9) return false;
  if (npc.__fleeing) return true;
  const t = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
  if (t && !t.dead && !t.destroyed && !isProjectile(t) && !isCloakHidden(t)) {
    const reach = npcGunRange(npc) * ai.burstRangeK + (Number(t.radius) || 0);
    const ex = (Number(targetX(t)) || 0) - nx;
    const ey = (Number(targetY(t)) || 0) - ny;
    if (ex * ex + ey * ey < reach * reach) return false;
  }
  return true;
}

/**
 * Krok systemu F okrętu NPC (raz na takt mózgu): ładunek, decyzja, skutki (modyfikatory okrętu, npc.__fSysBoost,
 * dopalacz w intencji lotu).
 */
export function stepNpcShipSystem(npc, dt) {
  if (!npc) return;
  const def = npcShipSystemDef(npc);
  if (!def) {
    if (npc.__fSysBoost) clearBurstFlight(npc);
    syncRapidFire(npc, 1);
    npc.__fSysBoost = false;
    return;
  }
  const st = npc.__fSys || (npc.__fSys = createShipSystemState());
  bindShipSystem(st, def);
  const blocked = npcSystemBlocked(npc);
  if (blocked && st.active) stopShipSystem(st);
  stepShipSystem(st, def, dt);
  if (!blocked && !st.active && st.charge >= 1) {
    const rapid = def.id === 'rapid_fire';
    const want = rapid ? npcWantsRapidFire(npc) : npcWantsEngineBurst(npc, def);
    st.want = want ? st.want + dt : 0;
    if (st.want >= (rapid ? NPC_SYSTEM_AI.rapidHold : NPC_SYSTEM_AI.burstHold) && startShipSystemBurst(st, def)) {
      st.want = 0;
      NPC_SYSTEM_STATS[def.id] = (NPC_SYSTEM_STATS[def.id] || 0) + 1;
    }
  } else {
    st.want = 0;
  }
  syncRapidFire(npc, shipSystemFireRateMul(st, def));
  const boost = shipSystemMainBoost(st, def);
  if (def.id === 'engine_burst') {
    if (boost) {
      const it = getFlightIntent(npc);
      it.boost = true;
      it.boostSpeedMul = Number(def.speedMul) || 1;
      it.boostAccelMul = Number(def.thrustMul) || 1;
    } else if (npc.__fSysBoost) {
      clearBurstFlight(npc);
    }
  }
  npc.__fSysBoost = boost;
}

// Szybki ogień ×mul → źródło 'system' modyfikatorów (fireRate = 1 / mul); przy zmianie przeładowania w toku
// (`weapon.cd` > 0) przeliczone tym samym stosunkiem.
const _rapidMods = { fireRate: 1 };
function syncRapidFire(npc, mul) {
  const cur = npc.__fSysRate > 1 ? npc.__fSysRate : 1;
  if (mul === cur) return;
  npc.__fSysRate = mul;
  const before = modifierFireRate(npc);
  if (mul > 1) {
    _rapidMods.fireRate = fireRateModifier(mul);
    setModifierSource(npc, 'system', _rapidMods);
  } else {
    clearModifierSource(npc, 'system');
  }
  const ratio = modifierFireRate(npc) / before;
  const ws = npc.autoWeapons;
  if (ratio === 1 || !Array.isArray(ws)) return;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (w && w.cd > 0) w.cd *= ratio;
  }
}

function clearBurstFlight(npc) {
  const it = npc.__flightIntent;
  if (!it) return;
  it.boost = false;
  it.boostSpeedMul = 0;
  it.boostAccelMul = 0;
}
