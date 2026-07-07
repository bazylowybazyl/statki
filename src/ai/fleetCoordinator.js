// src/ai/fleetCoordinator.js
//
// Koordynator bitewny floty. Co REBUILD_INTERVAL sekund grupuje okręty bojowe
// na dwie strony (friendly vs piraci) i przydziela im sloty:
//
//   - 'line'  — pozycja w linii bitewnej (Starsector-style): oś natarcia biegnie
//               od centroidu własnej floty do centroidu wroga, okręty rozstawiają
//               się prostopadle do niej. Duże jednostki w centrum, mniejsze na
//               skrzydłach. Każdy stoi w swoim idealRange od frontu wroga.
//   - 'flank' — gdy >=3 małe okręty (destroyer/fregata) atakują ten sam duży cel,
//               dostają sloty kątowe wokół niego, wypełniane od tyłu (tył = słaby
//               punkt), i obtaczają go.
//
// Wynik trafia do npc.__battleSlot = { kind, ..., t }. Mózgi w capitalAI.js
// czytają go przez getBattleSlot() (z kontrolą świeżości TTL).

import { resolveCapitalIdealRange } from './capitalAiTuning.js';

const REBUILD_INTERVAL = 0.45;
const SLOT_TTL = 1.4;
const ENGAGE_RADIUS = 18000;
const ENGAGE_RADIUS_SQ = ENGAGE_RADIUS * ENGAGE_RADIUS;
const FLANK_MIN_ATTACKERS = 3;
const FLANK_MAX_ATTACKERS = 5;
const FLANK_SEARCH_RANGE_SQ = 9000 * 9000;
// Sloty względem dziobu celu — najpierw sam tył, potem tylne ćwiartki, potem boki.
const FLANK_BEARINGS = [Math.PI, Math.PI - 0.75, Math.PI + 0.75, Math.PI - 1.45, Math.PI + 1.45];

const SMALL_TYPES = new Set(['destroyer', 'frigate', 'frigate_pd', 'frigate_laser']);

let rebuildT = 0;
let clock = 0;

// Scratch — zero alokacji w stanie ustalonym.
const sideFriendly = [];
const sidePirate = [];
const lineBigs = [];
const lineSmalls = [];
const flankGroups = new Map(); // victim -> attackers[]

function unitX(u) { return u.pos ? u.pos.x : (u.x || 0); }
function unitY(u) { return u.pos ? u.pos.y : (u.y || 0); }

function isSmallShip(npc) {
  return SMALL_TYPES.has(String(npc.type || '').toLowerCase());
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

// Waga jednostki przy liczeniu centroidu zagrożenia.
function threatWeight(u) {
  if (u.fighter) return 0.35;
  if (isSmallShip(u)) return 1.6;
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

function assignFlanks(members, enemies) {
  flankGroups.clear();

  for (let i = 0; i < members.length; i++) {
    const npc = members[i];
    if (!isSmallShip(npc)) continue;

    // Ofiara: aktualny cel jeśli to duży okręt wroga, inaczej najbliższy duży wróg.
    let victim = null;
    const cur = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
    if (cur && !cur.dead && isBigShip(cur)) {
      victim = cur;
    } else {
      let bestSq = FLANK_SEARCH_RANGE_SQ;
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (!isBigShip(e)) continue;
        const dx = unitX(e) - npc.x;
        const dy = unitY(e) - npc.y;
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
      const dist = Math.max(
        (victim.radius || 100) + (npc.radius || 40) + 320,
        (Number(npc.preferredRange) || 900) * 0.85
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

function buildLine(members, enemyCenterX, enemyCenterY, axisX, axisY, reprEnemy) {
  const latX = -axisY;
  const latY = axisX;
  const facing = Math.atan2(axisY, axisX);

  lineBigs.length = 0;
  lineSmalls.length = 0;
  for (let i = 0; i < members.length; i++) {
    const npc = members[i];
    const slot = npc.__battleSlot;
    if (slot && slot.kind === 'flank' && slot.t === clock) continue; // już flankuje
    npc.__lineProj = (npc.x - enemyCenterX) * latX + (npc.y - enemyCenterY) * latY;
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
  const ordered = lineBigs;
  let leftCount = 0;
  for (let i = 0; i < lineSmalls.length; i++) {
    if (lineSmalls[i].__lineProj < 0) leftCount++;
  }
  const finalOrder = [];
  for (let i = 0; i < leftCount; i++) finalOrder.push(lineSmalls[i]);
  for (let i = 0; i < ordered.length; i++) finalOrder.push(ordered[i]);
  for (let i = leftCount; i < lineSmalls.length; i++) finalOrder.push(lineSmalls[i]);

  // Odstępy między sąsiadami wg rozmiarów kadłubów.
  let cursor = 0;
  let sum = 0;
  for (let i = 0; i < finalOrder.length; i++) {
    const npc = finalOrder[i];
    if (i > 0) {
      const prev = finalOrder[i - 1];
      cursor += Math.max(620, ((prev.radius || 60) + (npc.radius || 60)) * 2.3);
    }
    npc.__lineOffset = cursor;
    sum += cursor;
  }
  const centerShift = sum / finalOrder.length;

  for (let i = 0; i < finalOrder.length; i++) {
    const npc = finalOrder[i];
    const offset = npc.__lineOffset - centerShift;
    const standoff = resolveStandoff(npc, reprEnemy);
    writeSlot(npc, {
      kind: 'line',
      x: enemyCenterX - axisX * standoff + latX * offset,
      y: enemyCenterY - axisY * standoff + latY * offset,
      facing,
      holdRange: standoff,
      t: 0
    });
  }
}

function coordinateSide(members, enemies, playerAsEnemy) {
  if (members.length === 0) return;

  // Centroid własnej strony.
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < members.length; i++) {
    cx += members[i].x;
    cy += members[i].y;
  }
  cx /= members.length;
  cy /= members.length;

  // Ważony centroid wroga w zasięgu starcia + reprezentatywny duży wróg.
  let ex = 0;
  let ey = 0;
  let ew = 0;
  let reprEnemy = null;
  let reprR = 0;
  const considerEnemy = (u) => {
    const ux = unitX(u);
    const uy = unitY(u);
    const dx = ux - cx;
    const dy = uy - cy;
    if (dx * dx + dy * dy > ENGAGE_RADIUS_SQ) return;
    const w = threatWeight(u);
    ex += ux * w;
    ey += uy * w;
    ew += w;
    if ((u.radius || 0) > reprR && isBigShip(u)) {
      reprR = u.radius || 0;
      reprEnemy = u;
    }
  };
  for (let i = 0; i < enemies.length; i++) considerEnemy(enemies[i]);
  if (playerAsEnemy && playerAsEnemy.pos && !playerAsEnemy.dead && !playerAsEnemy.destroyed) {
    considerEnemy({
      pos: playerAsEnemy.pos,
      radius: playerAsEnemy.radius || 220,
      isCapitalShip: true,
      fighter: false
    });
  }

  if (ew <= 0) {
    for (let i = 0; i < members.length; i++) clearSlot(members[i]);
    return;
  }
  ex /= ew;
  ey /= ew;

  let axisX = ex - cx;
  let axisY = ey - cy;
  const axisLen = Math.hypot(axisX, axisY);
  if (axisLen < 1) { axisX = 1; axisY = 0; }
  else { axisX /= axisLen; axisY /= axisLen; }

  assignFlanks(members, enemies);
  buildLine(members, ex, ey, axisX, axisY, reprEnemy);
}

export function updateFleetCoordinator(npcs, playerShip, dt) {
  clock += Math.max(0, Number(dt) || 0);
  rebuildT -= dt;
  if (rebuildT > 0) return;
  rebuildT = REBUILD_INTERVAL;

  sideFriendly.length = 0;
  sidePirate.length = 0;
  const list = Array.isArray(npcs) ? npcs : [];
  for (let i = 0; i < list.length; i++) {
    const npc = list[i];
    if (!isCoordinatedNpc(npc)) continue;
    if (npc.friendly === true) sideFriendly.push(npc);
    else if (npc.isPirate) sidePirate.push(npc);
  }

  // Wrogami są WSZYSTKIE żywe jednostki przeciwnej strony (też myśliwce — ważone słabiej).
  const list2 = list;
  const friendlyAll = [];
  const pirateAll = [];
  for (let i = 0; i < list2.length; i++) {
    const u = list2[i];
    if (!u || u.dead || !u.mission) continue;
    if (u.friendly === true) friendlyAll.push(u);
    else if (u.isPirate) pirateAll.push(u);
  }

  coordinateSide(sideFriendly, pirateAll, null);
  coordinateSide(sidePirate, friendlyAll, playerShip || null);
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

if (typeof window !== 'undefined') {
  window.updateFleetCoordinator = updateFleetCoordinator;
  window.getBattleSlot = getBattleSlot;
}
