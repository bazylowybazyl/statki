// src/ai/fleetCoordinator.js
//
// Dowódca floty w duchu Starsectora. Co REBUILD_INTERVAL s, osobno dla każdej
// strony:
//  1) ZAGROŻENIA bierze ze wspólnego obrazu sytuacji (fleetAwareness.js) —
//     tylko widoczne kontakty dopuszczone postawą: ESKORTA broni gracza, pirat
//     z bazą broni swojej stacji, rozkaz ATAK i piraci wezwani — wszystko, co
//     widzą czujniki strony. (Dawniej: wszyscy wrogowie w 18 km od środka floty,
//     bez względu na czujniki.)
//  2) prowadzi FRONT: linia startuje tam, gdzie jest flota, i przesuwa się ku
//     wrogowi tempem najwolniejszego okrętu, nigdy dalej niż MAX_FRONT_LEAD
//     przed środkiem floty — flota idzie razem, zamiast rozsypywać się na
//     pojedyncze okręty pędzące każdy swoją prędkością;
//  3) przydziela sloty (npc.__battleSlot):
//     - 'line'  — miejsce w linii prostopadłej do osi natarcia; duże w centrum,
//                 małe na skrzydłach; każdy staje najdalej na własnym dystansie
//                 bojowym (dłuższa broń = dalej). `role: 'screen'` — w fazie
//                 zbliżania fregaty idą przed frontem jako zwiad: ich czujniki
//                 pierwsze widzą wroga, a obraz trafia do całej floty;
//     - 'flank' — w fazie walki ≥3 małe okręty obchodzą duży cel od tyłu.
//  Brak widocznych wrogów, ale świeży „duch" i postawa ofensywna — faza
//  'search': front idzie do ostatniej znanej pozycji wroga.
//
// Mózgi w capitalAI.js czytają slot przez getBattleSlot() (z kontrolą świeżości).

import {
  resolveAiPersonality,
  resolveCapitalIdealRange,
  resolveHoldRange,
  updateCombatPressure
} from './capitalAiTuning.js';
import {
  AWARENESS_CONFIG,
  SIDE_FRIENDLY,
  SIDE_PIRATE,
  contactInLeash,
  getFreshestGhost,
  getSideContacts,
  resolveAwarenessSensorRange,
  updateFleetAwareness
} from './fleetAwareness.js';
import { flightSpeedLimit, resolveShipFlightSpec } from '../game/flight/shipFlightModel.js';

const REBUILD_INTERVAL = 0.45;
const SLOT_TTL = 1.4;
const FLANK_MIN_ATTACKERS = 3;
const FLANK_MAX_ATTACKERS = 5;
const FLANK_SEARCH_RANGE_SQ = 9000 * 9000;
// Sloty względem dziobu celu — najpierw sam tył, potem tylne ćwiartki, potem boki.
const FLANK_BEARINGS = [Math.PI, Math.PI - 0.75, Math.PI + 0.75, Math.PI - 1.45, Math.PI + 1.45];
// Front nie wyprzedza środka floty o więcej niż tyle — szybkie okręty czekają na wolne.
const MAX_FRONT_LEAD = 2500;
// Tempo frontu: ułamek prędkości najwolniejszego okrętu (zapas na dojście do slotu).
const PACE_MARGIN = 0.8;
// Faza walki, gdy front zejdzie do ~1,25× najdłuższego dystansu bojowego w linii.
const ENGAGE_PHASE_MUL = 1.25;
// Zwiad fregat przed frontem: ułamek ich zasięgu czujników, w granicach.
const SCREEN_LEAD_FRAC = 0.35;
const SCREEN_LEAD_MIN = 2500;
const SCREEN_LEAD_MAX = 7000;

const SMALL_TYPES = new Set(['destroyer', 'frigate', 'frigate_pd', 'frigate_laser']);
const SCREEN_TYPES = new Set(['frigate', 'frigate_pd', 'frigate_laser']);

let rebuildT = 0;
let clock = 0;
let lastRebuildClock = 0;

function makeSideState() {
  return { frontDist: NaN, frontSpeed: 0, phase: 'idle', members: 0, threats: 0, ex: 0, ey: 0 };
}
const sideState = {
  [SIDE_FRIENDLY]: makeSideState(),
  [SIDE_PIRATE]: makeSideState()
};

// Scratch — zero alokacji w stanie ustalonym.
const sideFriendly = [];
const sidePirate = [];
const threatsScratch = [];
const activeMembers = [];
const lineBigs = [];
const lineSmalls = [];
const lineOrder = [];
const flankGroups = new Map(); // victim -> attackers[]

function unitX(u) { return u.pos ? u.pos.x : (u.x || 0); }
function unitY(u) { return u.pos ? u.pos.y : (u.y || 0); }

function isSmallShip(npc) {
  return SMALL_TYPES.has(String(npc.type || '').toLowerCase());
}

function isScreenShip(npc) {
  return SCREEN_TYPES.has(String(npc.type || '').toLowerCase());
}

function isBigShip(u) {
  if (!u || u.dead) return false;
  if (u.fighter) return false;
  if (isSmallShip(u)) return false;
  return !!u.isCapitalShip || (u.radius || 0) >= 90;
}

function isCoordinatedNpc(npc) {
  if (!npc || npc.dead || !npc.mission || npc.fighter) return false;
  if (npc.staticDummy || npc.combatDisabled) return false;
  if (!npc.ai) return false;
  if (npc.command) return false; // rozkazy RTS mają priorytet
  if (npc.state === 'warping_in') return false;
  return !!npc.isCapitalShip || isSmallShip(npc) || isBigShip(npc);
}

function clearSlot(npc) {
  if (npc.__battleSlot) npc.__battleSlot = null;
}

function writeSlot(npc, slot) {
  slot.t = clock;
  npc.__battleSlot = slot;
}

function resetSide(st) {
  st.frontDist = NaN;
  st.frontSpeed = 0;
  st.phase = 'idle';
}

// Waga kontaktu przy liczeniu centroidu zagrożenia.
function threatWeight(c) {
  if (c.kind === 'fighter') return 0.35;
  const e = c.entity;
  if (e && isSmallShip(e)) return 1.6;
  return 3.0;
}

function resolveStandoff(npc, reprEnemy) {
  let standoff = resolveCapitalIdealRange(npc, reprEnemy);
  const type = String(npc.type || '').toLowerCase();
  // Lotniskowce i frachtowce trzymają się za linią.
  if (type.includes('carrier') || type.includes('freighter') || type.includes('super')) {
    standoff *= 1.5;
  }
  return standoff;
}

// Postawa strony: gracz ustawia ją rozkazem skrzydła (ESKORTA / ATAK);
// piraci są ofensywni, a obronę stacji załatwia smycz bazy per okręt.
function sidePosture(side) {
  if (side === SIDE_FRIENDLY) {
    const order = (typeof window !== 'undefined' && window.SupportWing?.order) || 'guard';
    return order === 'engage' ? 'engage' : 'guard';
  }
  return 'engage';
}

function collectThreats(side, posture, player, out) {
  out.length = 0;
  const contacts = getSideContacts(side);
  const guardLeash = (side === SIDE_FRIENDLY && posture === 'guard' && player && !player.dead && !player.destroyed)
    ? { x: unitX(player), y: unitY(player), r: AWARENESS_CONFIG.guardRadius }
    : null;
  // Cel namierzony przez gracza jest zagrożeniem nawet poza smyczą eskorty —
  // skrzydło wspiera dowódcę.
  const locked = (side === SIDE_FRIENDLY && typeof window !== 'undefined')
    ? (window.getPlayerLockedTarget?.() || null)
    : null;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    if (!c.visible) continue;
    if (guardLeash && c.entity !== locked && !contactInLeash(c, guardLeash)) continue;
    out.push(c);
  }
  return out;
}

function homeLeash(npc) {
  const home = npc.home;
  if (!npc.isPirate || !home || !Number.isFinite(home.x) || !Number.isFinite(home.y)) return null;
  return { x: home.x, y: home.y, r: (Number(home.r) || 300) + AWARENESS_CONFIG.defendRadius };
}

function anyThreatInLeash(threats, leash) {
  for (let i = 0; i < threats.length; i++) {
    if (contactInLeash(threats[i], leash)) return true;
  }
  return false;
}

function memberSpeed(npc, mode) {
  const spec = resolveShipFlightSpec(npc);
  if (spec) return flightSpeedLimit(spec, mode);
  return Math.max(60, Number(npc.maxSpeed) || 300);
}

function screenLead(npc) {
  const r = resolveAwarenessSensorRange(npc) * SCREEN_LEAD_FRAC;
  return Math.max(SCREEN_LEAD_MIN, Math.min(SCREEN_LEAD_MAX, r));
}

function assignFlanks(members, threats) {
  flankGroups.clear();

  for (let i = 0; i < members.length; i++) {
    const npc = members[i];
    if (!isSmallShip(npc)) continue;

    // Ofiara: aktualny cel, jeśli to duży okręt wroga; inaczej najbliższy
    // duży kontakt z obrazu sytuacji.
    let victim = null;
    const cur = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
    if (cur && !cur.dead && isBigShip(cur)) {
      victim = cur;
    } else {
      let bestSq = FLANK_SEARCH_RANGE_SQ;
      for (let j = 0; j < threats.length; j++) {
        const e = threats[j].entity;
        if (!isBigShip(e)) continue;
        const dx = threats[j].x - npc.x;
        const dy = threats[j].y - npc.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestSq) { bestSq = dSq; victim = e; }
      }
    }
    if (!victim) continue;

    let group = flankGroups.get(victim);
    if (!group) { group = []; flankGroups.set(victim, group); }
    group.push(npc);
  }

  for (const [victim, group] of flankGroups) {
    if (group.length < FLANK_MIN_ATTACKERS) continue;

    // Najbliżsi zajmują sloty; nadmiar zostaje w linii.
    group.sort((a, b) => {
      const da = (unitX(victim) - a.x) ** 2 + (unitY(victim) - a.y) ** 2;
      const db = (unitX(victim) - b.x) ** 2 + (unitY(victim) - b.y) ** 2;
      return da - db;
    });

    const count = Math.min(group.length, FLANK_MAX_ATTACKERS, FLANK_BEARINGS.length);
    for (let i = 0; i < count; i++) {
      const npc = group[i];
      // Ten sam dystans bojowy co przy walce solo (bateria główna × osobowość),
      // trochę bliżej — flanka ma być wewnątrz zasięgu, nie na jego granicy.
      const dist = Math.max(
        (victim.radius || 100) + (npc.radius || 40) + 320,
        resolveCapitalIdealRange(npc, victim) * 0.85
      );
      writeSlot(npc, {
        kind: 'flank',
        target: victim,
        bearing: FLANK_BEARINGS[i],
        dist,
        t: 0
      });
    }
  }
}

function buildLine(members, st, ex, ey, axisX, axisY, evx, evy) {
  const latX = -axisY;
  const latY = axisX;
  const facing = Math.atan2(axisY, axisX);
  const screening = st.phase === 'advance' || st.phase === 'search';

  lineBigs.length = 0;
  lineSmalls.length = 0;
  for (let i = 0; i < members.length; i++) {
    const npc = members[i];
    const slot = npc.__battleSlot;
    if (slot && slot.kind === 'flank' && slot.t === clock) continue; // już flankuje
    npc.__lineProj = (npc.x - ex) * latX + (npc.y - ey) * latY;
    if (isSmallShip(npc)) lineSmalls.push(npc);
    else lineBigs.push(npc);
  }

  const total = lineBigs.length + lineSmalls.length;
  if (total === 0) return;

  const byProj = (a, b) => a.__lineProj - b.__lineProj;
  lineBigs.sort(byProj);
  lineSmalls.sort(byProj);

  // Duże w centrum (w kolejności bocznej — bez krzyżowania kursów),
  // małe rozdzielone na skrzydła po stronie, po której już są.
  let leftCount = 0;
  for (let i = 0; i < lineSmalls.length; i++) {
    if (lineSmalls[i].__lineProj < 0) leftCount++;
  }
  lineOrder.length = 0;
  for (let i = 0; i < leftCount; i++) lineOrder.push(lineSmalls[i]);
  for (let i = 0; i < lineBigs.length; i++) lineOrder.push(lineBigs[i]);
  for (let i = leftCount; i < lineSmalls.length; i++) lineOrder.push(lineSmalls[i]);

  // Odstępy między sąsiadami wg rozmiarów kadłubów.
  let cursor = 0;
  let sum = 0;
  for (let i = 0; i < lineOrder.length; i++) {
    const npc = lineOrder[i];
    if (i > 0) {
      const prev = lineOrder[i - 1];
      cursor += Math.max(620, ((prev.radius || 60) + (npc.radius || 60)) * 2.3);
    }
    npc.__lineOffset = cursor;
    sum += cursor;
  }
  const centerShift = sum / lineOrder.length;

  for (let i = 0; i < lineOrder.length; i++) {
    const npc = lineOrder[i];
    const standoff = npc.__coordStandoff;
    const screen = screening && isScreenShip(npc);
    let dist = Math.max(st.frontDist, standoff);
    let lateral = npc.__lineOffset - centerShift;
    // Slot jedzie razem z wrogiem, a jeśli stoi na froncie — także z frontem.
    let svx = evx;
    let svy = evy;
    if (screen) {
      dist = Math.max(standoff, st.frontDist - screenLead(npc));
      lateral *= 1.5;
      svx += axisX * st.frontSpeed;
      svy += axisY * st.frontSpeed;
    } else if (st.phase === 'engage') {
      // W walce linia trzyma pole: podchodzi do dystansu bojowego, ale przed
      // wrogiem, który sam naciera, nie ucieka — stoi, dopóki nie wejdzie głębiej
      // niż pasmo osobowości (inaczej snajperzy cofali się bez końca, a bitwa
      // dryfowała przez pół mapy). Pod presją (słaba tarcza) — odwrót.
      const personality = resolveAiPersonality(npc);
      const cur = Math.hypot(npc.x - ex, npc.y - ey);
      const clearance = (Number(npc.radius) || 60) + 600;
      const band = resolveHoldRange(cur, dist, personality, updateCombatPressure(npc, personality), clearance);
      dist = band.range;
      if (band.holding) {
        svx = 0;
        svy = 0;
      }
    } else if (dist <= st.frontDist + 1) {
      svx += axisX * st.frontSpeed;
      svy += axisY * st.frontSpeed;
    }
    writeSlot(npc, {
      kind: 'line',
      role: screen ? 'screen' : 'line',
      phase: st.phase,
      x: ex - axisX * dist + latX * lateral,
      y: ey - axisY * dist + latY * lateral,
      vx: svx,
      vy: svy,
      facing,
      holdRange: standoff,
      t: 0
    });
  }
}

function coordinateSide(side, members, player, dt) {
  const st = sideState[side];
  const posture = sidePosture(side);
  const threats = collectThreats(side, posture, player, threatsScratch);

  // Piraci z bazą dołączają do natarcia tylko wtedy, gdy wróg jest w zasięgu
  // obrony ich stacji — reszta czasu pilnują domu.
  activeMembers.length = 0;
  for (let i = 0; i < members.length; i++) {
    const npc = members[i];
    const leash = homeLeash(npc);
    if (leash && !anyThreatInLeash(threats, leash)) {
      clearSlot(npc);
      continue;
    }
    activeMembers.push(npc);
  }
  st.members = activeMembers.length;
  st.threats = threats.length;
  if (activeMembers.length === 0) {
    resetSide(st);
    return;
  }

  // Centroid zagrożenia (ważony) i jego prędkość.
  let ex = 0;
  let ey = 0;
  let evx = 0;
  let evy = 0;
  let ew = 0;
  let repr = null;
  let reprR = 0;
  let searching = false;
  if (threats.length > 0) {
    for (let i = 0; i < threats.length; i++) {
      const c = threats[i];
      const w = threatWeight(c);
      ex += c.x * w;
      ey += c.y * w;
      evx += c.vx * w;
      evy += c.vy * w;
      ew += w;
      const r = Number(c.entity?.radius) || 0;
      if (r > reprR && isBigShip(c.entity)) {
        reprR = r;
        repr = c.entity;
      }
    }
  } else {
    // Wróg zniknął z czujników: postawa ofensywna idzie tam, gdzie go ostatnio widziano.
    const ghost = posture === 'engage' ? getFreshestGhost(side) : null;
    if (!ghost) {
      for (let i = 0; i < activeMembers.length; i++) clearSlot(activeMembers[i]);
      resetSide(st);
      return;
    }
    ex = ghost.x;
    ey = ghost.y;
    ew = 1;
    searching = true;
  }
  ex /= ew;
  ey /= ew;
  evx /= ew;
  evy /= ew;

  // Centroid floty.
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < activeMembers.length; i++) {
    cx += activeMembers[i].x;
    cy += activeMembers[i].y;
  }
  cx /= activeMembers.length;
  cy /= activeMembers.length;

  let axisX = ex - cx;
  let axisY = ey - cy;
  const dNow = Math.hypot(axisX, axisY);
  if (dNow < 1) { axisX = 1; axisY = 0; }
  else { axisX /= dNow; axisY /= dNow; }

  // Dystanse bojowe i tempo najwolniejszego (przelotowe, dopóki front daleko).
  const cruising = st.phase !== 'engage';
  let minStandoff = Infinity;
  let maxStandoff = 0;
  let pace = Infinity;
  for (let i = 0; i < activeMembers.length; i++) {
    const npc = activeMembers[i];
    const standoff = resolveStandoff(npc, repr) * (searching ? 0.5 : 1);
    npc.__coordStandoff = standoff;
    if (standoff < minStandoff) minStandoff = standoff;
    if (standoff > maxStandoff) maxStandoff = standoff;
    pace = Math.min(pace, memberSpeed(npc, cruising ? 'cruise' : 'combat'));
  }
  pace *= PACE_MARGIN;

  // Front: startuje przy flocie, schodzi ku wrogowi tempem `pace`, nigdy nie
  // wyprzedza środka floty o więcej niż MAX_FRONT_LEAD i nie wchodzi bliżej niż
  // najkrótszy dystans bojowy. Gdy wróg sam podszedł, front cofa się do floty.
  const prev = Number.isFinite(st.frontDist) ? st.frontDist : dNow;
  let front = prev - pace * dt;
  front = Math.max(front, dNow - MAX_FRONT_LEAD);
  front = Math.min(front, dNow);
  front = Math.max(front, minStandoff);
  st.frontSpeed = Math.max(0, (prev - front) / Math.max(1e-3, dt));
  st.frontDist = front;
  st.phase = searching ? 'search' : (front > maxStandoff * ENGAGE_PHASE_MUL ? 'advance' : 'engage');
  st.ex = ex;
  st.ey = ey;

  if (st.phase === 'engage') assignFlanks(activeMembers, threats);
  buildLine(activeMembers, st, ex, ey, axisX, axisY, evx, evy);
}

export function updateFleetCoordinator(npcs, playerShip, dt) {
  const step = Math.max(0, Number(dt) || 0);
  updateFleetAwareness(npcs, playerShip, step);
  clock += step;
  rebuildT -= step;
  if (rebuildT > 0) return;
  rebuildT = REBUILD_INTERVAL;
  const since = Math.max(step, clock - lastRebuildClock);
  lastRebuildClock = clock;

  sideFriendly.length = 0;
  sidePirate.length = 0;
  const list = Array.isArray(npcs) ? npcs : [];
  for (let i = 0; i < list.length; i++) {
    const npc = list[i];
    if (!isCoordinatedNpc(npc)) continue;
    if (npc.friendly === true) sideFriendly.push(npc);
    else if (npc.isPirate) sidePirate.push(npc);
  }

  coordinateSide(SIDE_FRIENDLY, sideFriendly, playerShip || null, since);
  coordinateSide(SIDE_PIRATE, sidePirate, playerShip || null, since);
}

// Zwraca aktualny slot bitewny npc albo null, jeśli przeterminowany/nieaktualny.
export function getBattleSlot(npc) {
  const slot = npc && npc.__battleSlot;
  if (!slot) return null;
  if ((clock - slot.t) > SLOT_TTL) return null;
  if (npc.command) return null;
  if (slot.kind === 'flank') {
    const v = slot.target;
    if (!v || v.dead || v.destroyed) return null;
  }
  return slot;
}

// Stan dowódcy strony (faza, front) — do mózgów i podglądu.
export function getFleetPhase(side) {
  return sideState[side] || null;
}

export function resetFleetCoordinator() {
  rebuildT = 0;
  clock = 0;
  lastRebuildClock = 0;
  resetSide(sideState[SIDE_FRIENDLY]);
  resetSide(sideState[SIDE_PIRATE]);
}

if (typeof window !== 'undefined') {
  window.updateFleetCoordinator = updateFleetCoordinator;
  window.getBattleSlot = getBattleSlot;
  window.getFleetPhase = getFleetPhase;
}
