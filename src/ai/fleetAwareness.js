// src/ai/fleetAwareness.js
//
// Wspólny obraz sytuacji (datalink) każdej strony konfliktu.
//
// Dlaczego: AI miało własne, zaszyte „promienie wzroku" — eskorta 6 km,
// fregaty ~3,2 km, aiPickTarget 20 km, koordynator floty 18 km — podczas gdy
// czujniki okrętów (SHIP_SENSOR_PROFILES) sięgają 18–80 km, a radar gracza
// pokazuje wrogów, o których flota „nie wie". Do tego każdy okręt skanował
// wszystkich sam, więc większe promienie kończyły się lagiem.
//
// Teraz raz na ~0,25 s każda strona zbiera ŹRÓDŁA (swoje okręty z ich profilem
// czujników; strona gracza także Atlas, sondy, drony i stacje czujników)
// i wyznacza KONTAKTY: wrogów w zasięgu któregokolwiek źródła, skalowanym
// wykrywalnością celu — tą samą tabelą, której używa mgła wojny gracza.
// Kontakt, który zniknął z czujników, zostaje przez chwilę jako „duch" z ostatnią
// znaną pozycją. Wszystkie okręty strony widzą ten sam obraz: zwiadowca, który
// zobaczy wroga, pokazuje go całej flocie.

import { resolveShipSensors } from '../game/scannerTargeting.js';
import { getEntitySizeModifier } from '../game/sensorSystem.js';
import { SHIP_SENSOR_PROFILES } from '../data/ships.js';

export const AWARENESS_CONFIG = Object.freeze({
  // Odświeżanie obrazu sytuacji (s). Decyzje i tak zapadają co 50 ms.
  updateInterval: 0.25,
  // Jak długo pamiętamy ostatnią znaną pozycję zgubionego kontaktu (s).
  ghostTtl: 25,
  // ESKORTA: skrzydło bije tylko kontakty w tym promieniu od gracza.
  guardRadius: 14000,
  // Obrona stacji: piraci z bazą bronią jej w tym promieniu (+ promień stacji).
  defendRadius: 16000
});

export const SIDE_FRIENDLY = 'friendly';
export const SIDE_PIRATE = 'pirate';

function makeSide(id) {
  return {
    id,
    sources: [],
    sourceCount: 0,
    contacts: [],
    byEntity: new Map()
  };
}

const sides = {
  friendly: makeSide(SIDE_FRIENDLY),
  pirate: makeSide(SIDE_PIRATE)
};

let clock = 0;
let sinceUpdate = Infinity;
// Stempel przebiegu: byt, którego nie było w ostatniej liście npcs (usunięty,
// reset świata), traci kontakt od razu — nie wisi 25 s jako „duch".
let generation = 0;
const EMPTY = Object.freeze([]);

function playerRef() {
  return (typeof window !== 'undefined') ? window.ship : null;
}

function posX(e) { return Number(e?.pos?.x ?? e?.x) || 0; }
function posY(e) { return Number(e?.pos?.y ?? e?.y) || 0; }
function velX(e) { return Number(e?.vel?.x ?? e?.vx) || 0; }
function velY(e) { return Number(e?.vel?.y ?? e?.vy) || 0; }

function isGone(e) {
  return !e || e.dead === true || e.destroyed === true || e.removed === true;
}

// Strona bytu: gracz i sojusznicy → 'friendly', piraci → 'pirate', reszta
// (ruch cywilny, neutralni) nie uczestniczy w obrazie sytuacji.
export function sideOfEntity(e, player = playerRef()) {
  if (!e) return null;
  if (player && e === player) return SIDE_FRIENDLY;
  if (e.friendly === true) return SIDE_FRIENDLY;
  if (e.isPirate === true) return SIDE_PIRATE;
  return null;
}

export function enemySideOf(side) {
  return side === SIDE_FRIENDLY ? SIDE_PIRATE : (side === SIDE_PIRATE ? SIDE_FRIENDLY : null);
}

const FIGHTER_TYPE_RE = /fighter|interceptor|bomber|drone/;

function fallbackSensorProfile(e) {
  const type = String(e?.type || '').toLowerCase();
  if (e?.fighter || FIGHTER_TYPE_RE.test(type)) return SHIP_SENSOR_PROFILES.fighter_combat;
  if (type.includes('frigate')) return SHIP_SENSOR_PROFILES.frigate_combat;
  if (type === 'destroyer') return SHIP_SENSOR_PROFILES.destroyer_combat;
  if (type.includes('battleship')) return SHIP_SENSOR_PROFILES.battleship_combat;
  if (type === 'atlas') return SHIP_SENSOR_PROFILES.atlas_combat;
  if (e?.isCapitalShip || type.includes('carrier') || type.includes('supercapital')) return SHIP_SENSOR_PROFILES.capital_combat;
  return SHIP_SENSOR_PROFILES.frigate_combat;
}

// Zasięg pasywny czujników bytu — ten sam, który pokazuje radar/CIC gracza
// (resolveShipSensors). Byty bez własnego profilu (np. piraci stacji) dostają
// profil swojej klasy z SHIP_SENSOR_PROFILES.
// Cache po tożsamości profilu — zmiana kadłuba gracza podmienia obiekt sensors.
export function resolveAwarenessSensorRange(e) {
  if (!e) return 0;
  const profile = e.sensors || e.sensorProfile || null;
  if (e.__awarenessProfile === profile && Number.isFinite(e.__awarenessRange)) return e.__awarenessRange;
  const range = profile
    ? resolveShipSensors(e).passiveRange
    : (Number(fallbackSensorProfile(e)?.passiveRange) || 18000);
  e.__awarenessProfile = profile;
  e.__awarenessRange = range;
  return range;
}

function pushSource(side, x, y, r) {
  if (!(r > 0)) return;
  let s = side.sources[side.sourceCount];
  if (!s) {
    s = { x: 0, y: 0, r: 0 };
    side.sources[side.sourceCount] = s;
  }
  s.x = x;
  s.y = y;
  s.r = r;
  side.sourceCount++;
}

function collectSources(npcs, player) {
  sides.friendly.sourceCount = 0;
  sides.pirate.sourceCount = 0;
  generation++;
  if (player) player.__awarenessGen = generation;

  if (player && !isGone(player)) {
    pushSource(sides.friendly, posX(player), posY(player), resolveAwarenessSensorRange(player));
  }
  // Sondy, drony zwiadowcze i stacje czujników gracza. Własne koło statku
  // gracza pomijamy — liczymy je z profilu kadłuba, jak radar.
  const extra = (typeof window !== 'undefined') ? window.SensorSystem?.getSensorSources?.() : null;
  if (Array.isArray(extra)) {
    for (let i = 0; i < extra.length; i++) {
      const s = extra[i];
      if (!s || s.type === 'ship') continue;
      pushSource(sides.friendly, Number(s.x) || 0, Number(s.y) || 0, Number(s.range) || 0);
    }
  }

  const list = Array.isArray(npcs) ? npcs : EMPTY;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (isGone(e)) continue;
    e.__awarenessGen = generation;
    const side = sideOfEntity(e, player);
    if (!side) continue;
    pushSource(sides[side], e.x, e.y, resolveAwarenessSensorRange(e));
  }
}

function contactKind(e, player) {
  if (e === player) return 'player';
  if (e.fighter || FIGHTER_TYPE_RE.test(String(e.type || '').toLowerCase())) return 'fighter';
  if (e.isCapitalShip) return 'capital';
  return 'ship';
}

function upsertContact(side, e, player) {
  let c = side.byEntity.get(e);
  if (!c) {
    c = { entity: e, x: 0, y: 0, vx: 0, vy: 0, seenAt: 0, visible: false, kind: 'ship' };
    side.byEntity.set(e, c);
    side.contacts.push(c);
  }
  c.x = posX(e);
  c.y = posY(e);
  c.vx = velX(e);
  c.vy = velY(e);
  c.seenAt = clock;
  c.visible = true;
  c.kind = contactKind(e, player);
  return c;
}

function detectedBy(side, e) {
  const x = posX(e);
  const y = posY(e);
  const mod = getEntitySizeModifier(e);
  for (let i = 0; i < side.sourceCount; i++) {
    const s = side.sources[i];
    const r = s.r * mod;
    const dx = x - s.x;
    const dy = y - s.y;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

function refreshSide(side, npcs, player) {
  const contacts = side.contacts;
  for (let i = 0; i < contacts.length; i++) contacts[i].visible = false;

  const enemySide = enemySideOf(side.id);
  if (side.sourceCount > 0) {
    const list = Array.isArray(npcs) ? npcs : EMPTY;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (isGone(e) || sideOfEntity(e, player) !== enemySide) continue;
      if (detectedBy(side, e)) upsertContact(side, e, player);
    }
    if (enemySide === SIDE_FRIENDLY && player && !isGone(player) && detectedBy(side, player)) {
      upsertContact(side, player, player);
    }
  }

  // Sprzątanie w miejscu: martwe cele i przeterminowane duchy wypadają.
  let write = 0;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    const expired = !c.visible && (clock - c.seenAt) > AWARENESS_CONFIG.ghostTtl;
    const vanished = c.entity.__awarenessGen !== generation;
    if (isGone(c.entity) || expired || vanished) {
      side.byEntity.delete(c.entity);
      continue;
    }
    contacts[write++] = c;
  }
  contacts.length = write;
}

// Wołane z rytmu AI (20 Hz); samo pilnuje, żeby liczyć co updateInterval.
// `force` — przelicz od razu (testy, pierwsza klatka po spawnie).
export function updateFleetAwareness(npcs, player = playerRef(), dt = 0, force = false) {
  const step = Math.max(0, Number(dt) || 0);
  clock += step;
  sinceUpdate += step;
  if (!force && sinceUpdate < AWARENESS_CONFIG.updateInterval) return false;
  sinceUpdate = 0;
  collectSources(npcs, player);
  refreshSide(sides.friendly, npcs, player);
  refreshSide(sides.pirate, npcs, player);
  return true;
}

export function resetFleetAwareness() {
  for (const side of Object.values(sides)) {
    side.sourceCount = 0;
    side.contacts.length = 0;
    side.byEntity.clear();
  }
  clock = 0;
  sinceUpdate = Infinity;
}

export function awarenessClock() {
  return clock;
}

// Kontakty strony (widoczne i duchy). Tablica jest własnością modułu — tylko do odczytu.
export function getSideContacts(side) {
  return sides[side]?.contacts || EMPTY;
}

export function getSideContact(side, entity) {
  return sides[side]?.byEntity.get(entity) || null;
}

export function isVisibleToSide(side, entity) {
  const c = getSideContact(side, entity);
  return !!(c && c.visible);
}

// Najświeższy „duch" strony — ostatnia znana pozycja zgubionego wroga.
export function getFreshestGhost(side) {
  const contacts = getSideContacts(side);
  let best = null;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    if (c.visible) continue;
    if (!best || c.seenAt > best.seenAt) best = c;
  }
  return best;
}

// Smycz celu: KOGO wolno atakować z danej postawy.
//  - skrzydło wsparcia w ESKORCIE: tylko kontakty blisko gracza,
//  - pirat z bazą: tylko kontakty w promieniu obrony stacji,
//  - reszta (ATAK, piraci wezwani): bez smyczy.
export function resolveEngageLeash(npc, player = playerRef()) {
  if (!npc) return null;
  if (npc.friendly === true && npc.supportData) {
    const order = (typeof window !== 'undefined' && window.SupportWing?.order) || 'guard';
    if (order !== 'engage' && player && !isGone(player)) {
      return { x: posX(player), y: posY(player), r: AWARENESS_CONFIG.guardRadius };
    }
    return null;
  }
  const home = npc.home;
  if (npc.isPirate && home && Number.isFinite(home.x) && Number.isFinite(home.y)) {
    return { x: home.x, y: home.y, r: (Number(home.r) || 300) + AWARENESS_CONFIG.defendRadius };
  }
  return null;
}

export function contactInLeash(c, leash) {
  if (!leash) return true;
  const dx = c.x - leash.x;
  const dy = c.y - leash.y;
  return dx * dx + dy * dy <= leash.r * leash.r;
}

// Cel z obrazu sytuacji: najbliższy WIDOCZNY kontakt w smyczy, z premią dla
// wrogich okrętów liniowych i gracza (jak dawny aiPickTarget: +2M ≈ 1,4 km
// „bliżej"). `priority` — cel wskazany przez lidera (namiar gracza): wygrywa,
// jeśli jest widoczny, nawet poza smyczą eskorty.
export function pickContactTarget(npc, opts = {}) {
  const player = opts.player !== undefined ? opts.player : playerRef();
  const side = sideOfEntity(npc, player);
  if (!side) return null;
  const contacts = getSideContacts(side);
  const leash = opts.leash !== undefined ? opts.leash : resolveEngageLeash(npc, player);
  const priority = opts.priority && !isGone(opts.priority) ? opts.priority : null;
  if (priority && isVisibleToSide(side, priority)) return priority;

  let best = null;
  let bestScore = -Infinity;
  const nx = Number(npc.x) || 0;
  const ny = Number(npc.y) || 0;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    if (!c.visible || isGone(c.entity)) continue;
    if (!contactInLeash(c, leash)) continue;
    const dx = c.x - nx;
    const dy = c.y - ny;
    let score = -(dx * dx + dy * dy);
    if (c.kind === 'player' || c.kind === 'capital') score += 2000000;
    if (score > bestScore) {
      bestScore = score;
      best = c.entity;
    }
  }
  return best;
}

// Podgląd dla dewelopera (konsola: FleetAIDebug()).
export function describeFleetAwareness() {
  const out = {};
  for (const side of Object.values(sides)) {
    let visible = 0;
    for (const c of side.contacts) if (c.visible) visible++;
    out[side.id] = {
      sources: side.sourceCount,
      visible,
      ghosts: side.contacts.length - visible
    };
  }
  return out;
}

if (typeof window !== 'undefined') {
  window.updateFleetAwareness = updateFleetAwareness;
  window.pickContactTarget = pickContactTarget;
  window.getSideContacts = getSideContacts;
}
