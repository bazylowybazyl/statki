// src/ai/fleetCoordinator.js
//
// Dowódca floty w duchu Starsectora. Co REBUILD_INTERVAL s, osobno dla każdej
// strony:
//  1) ZAGROŻENIA bierze ze wspólnego obrazu sytuacji (fleetAwareness.js) —
//     tylko widoczne kontakty dopuszczone postawą: ESKORTA broni gracza, pirat
//     z bazą broni swojej stacji, rozkaz ATAK i piraci wezwani — wszystko, co
//     widzą czujniki strony;
//  2) dzieli flotę na GRUPY BOJOWE (fleetFormation.js): okręt flagowy
//     (pancernik, lotniskowiec, superkapitał) i eskorta — niszczyciele i fregaty
//     rozdzielone między grupy po równo;
//  3) stawia SZYK i przydziela sloty (npc.__battleSlot):
//     - 'cruise' — bez zagrożeń: grupy na pierścieniu wokół gracza (piraci:
//       wokół okrętu flagowego floty), eskorta na pierścieniach wokół swojego
//       okrętu flagowego;
//     - 'line' — z zagrożeniem: pierwsza linia z okrętów flagowych (lotniskowce
//       w tylnym rzędzie), druga linia z eskort — blok każdej grupy za jej
//       okrętem flagowym. Gdzie stoi linia, zależy od postawy:
//         ESKORTA — przez gracza (gracz w środku linii), twarzą do zagrożenia;
//         ATAK i piraci — FRONT: startuje tam, gdzie jest flota, schodzi ku
//           wrogowi tempem najwolniejszego okrętu, nigdy dalej niż
//           MAX_FRONT_LEAD przed linią okrętów flagowych;
//     - 'flank' — przy ATAKU, w fazie walki ≥3 małe okręty obchodzą duży cel
//       od tyłu;
//  4) do slotu dopisuje SMYCZ postawy: `leash` — jak daleko od swojego miejsca
//     okręt może odejść, walcząc; `engageR` — jak blisko miejsca musi być cel,
//     żeby w ogóle wyjść z szyku. ESKORTA walczy wokół swoich miejsc (eskorta
//     pilnuje okrętu flagowego, pancerniki gracza), przy ATAKU eskorta poluje
//     swobodnie, a okręty flagowe trzymają linię.
//  Brak widocznych wrogów, ale świeży „duch" i ATAK — faza 'search': front idzie
//  do ostatniej znanej pozycji wroga.
//
// Mózgi w capitalAI.js czytają slot przez getBattleSlot() (z kontrolą świeżości
// i ekstrapolacją pozycji miejsca od chwili przebudowy).

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
  updateFleetAwareness
} from './fleetAwareness.js';
import { flightSpeedLimit, resolveShipFlightSpec } from '../game/flight/shipFlightModel.js';
import {
  FORMATION_CONFIG,
  createFormationState,
  describeFormation,
  keepEscortSlotsClear,
  layoutBattle,
  layoutCruise,
  measureGroups,
  organizeTaskGroups,
  resetFormationState
} from './fleetFormation.js';

const REBUILD_INTERVAL = 0.45;
const SLOT_TTL = 1.4;
const FLANK_MIN_ATTACKERS = 3;
const FLANK_MAX_ATTACKERS = 5;
const FLANK_SEARCH_RANGE_SQ = 9000 * 9000;
// Sloty względem dziobu celu — najpierw sam tył, potem tylne ćwiartki, potem boki.
const FLANK_BEARINGS = [Math.PI, Math.PI - 0.75, Math.PI + 0.75, Math.PI - 1.45, Math.PI + 1.45];
// Front nie wyprzedza linii okrętów flagowych o więcej niż tyle — szybkie okręty czekają na wolne.
const MAX_FRONT_LEAD = 2500;
// Tempo frontu: ułamek prędkości najwolniejszego okrętu (zapas na dojście do slotu).
const PACE_MARGIN = 0.8;
// Faza walki, gdy front zejdzie do ~1,25× najdłuższego dystansu bojowego w linii.
const ENGAGE_PHASE_MUL = 1.25;
// Szyk bojowy trzyma się jeszcze tyle po zniknięciu zagrożeń — kontakt migający
// na granicy smyczy albo czujników nie przełącza floty co 0,45 s między szykami.
const BATTLE_LINGER = 6;
// Wygładzanie kursu szyku przelotowego (za ruchem korzenia) i osi natarcia (s).
const HEADING_TAU = 2.2;
const AXIS_TAU = 3.5;
// Martwa strefa osi natarcia: dopóki zagrożenie jest w tylu radianach od osi,
// linia się nie obraca. Oś goniła każdy ruch wroga — skrajne grupy linii (6–7 km
// od środka) jeździły po łuku z dużą prędkością i całe bloki eskorty kręciły się.
const AXIS_DEADBAND = Math.PI / 12;
// Poniżej tej prędkości korzeń „stoi" — kurs szyku się nie zmienia (gracz
// obracający się w miejscu nie kręci całą flotą).
const HEADING_MIN_SPEED = 120;

// Smycze postaw (j.): jak daleko od swojego miejsca w szyku okręt może odejść,
// walcząc. Przy ESKORCIE eskorta pilnuje swojego okrętu flagowego; przy ATAKU
// poluje, ale w zasięgu swojej grupy (dalej zabiera ją tylko manewr flanki),
// a okręty flagowe trzymają linię.
export const FORMATION_TETHER = Object.freeze({
  guard: Object.freeze({ leader: 1500, escort: 2500 }),
  engage: Object.freeze({ leader: 3000, escort: 6000 })
});

const SMALL_TYPES = new Set(['destroyer', 'frigate', 'frigate_pd', 'frigate_laser']);

let rebuildT = 0;
let clock = 0;
let lastRebuildClock = 0;

function makeSideState() {
  return {
    frontDist: NaN,
    frontSpeed: 0,
    phase: 'idle',
    members: 0,
    threats: 0,
    groups: 0,
    ex: 0,
    ey: 0,
    stance: '',
    battle: false,
    lingerT: 0,
    heading: NaN,
    axisAng: NaN,
    flagship: null,
    form: createFormationState()
  };
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
const flankGroups = new Map(); // victim -> attackers[]
const _threat = { x: 0, y: 0, vx: 0, vy: 0, repr: null, searching: false };
const _root = { x: 0, y: 0, vx: 0, vy: 0, radius: 0, entity: null, angle: NaN };
const _frame = { x: 0, y: 0, dirX: 1, dirY: 0, reserve: 0 };

function unitX(u) { return u.pos ? u.pos.x : (u.x || 0); }
function unitY(u) { return u.pos ? u.pos.y : (u.y || 0); }
function unitVx(u) { return Number(u.vel?.x ?? u.vx) || 0; }
function unitVy(u) { return Number(u.vel?.y ?? u.vy) || 0; }

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

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

function isAlive(e) {
  return !!(e && !e.dead && !e.destroyed);
}

function clearSlot(npc) {
  if (npc.__battleSlot) npc.__battleSlot = null;
}

// Jeden obiekt slotu na okręt (przepisywany co przebudowę) — pola zawsze
// wszystkie, żeby slot flankowy nie zostawił śladu w slocie szyku i odwrotnie.
function slotFor(npc) {
  let s = npc.__formSlot;
  if (!s) {
    s = npc.__formSlot = {
      kind: '',
      role: '',
      phase: '',
      stance: '',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      cx: 0,
      cy: 0,
      facing: 0,
      holdRange: 0,
      leash: Infinity,
      engageR: Infinity,
      leader: null,
      target: null,
      bearing: 0,
      dist: 0,
      t: 0
    };
  }
  return s;
}

function writeFormationSlot(npc, st, kind, role, x, y, vx, vy, facing, standoff, leash, engageR, leader) {
  const s = slotFor(npc);
  s.kind = kind;
  s.role = role;
  s.phase = st.phase;
  s.stance = st.stance;
  s.x = x;
  s.y = y;
  s.vx = vx;
  s.vy = vy;
  s.cx = x;
  s.cy = y;
  s.facing = facing;
  s.holdRange = standoff;
  s.leash = leash;
  s.engageR = engageR;
  s.leader = leader;
  s.target = null;
  s.bearing = 0;
  s.dist = 0;
  s.t = clock;
  npc.__battleSlot = s;
}

function writeFlankSlot(npc, st, victim, bearing, dist) {
  const s = slotFor(npc);
  s.kind = 'flank';
  s.role = 'escort';
  s.phase = st.phase;
  s.stance = st.stance;
  s.x = unitX(victim);
  s.y = unitY(victim);
  s.vx = 0;
  s.vy = 0;
  s.cx = s.x;
  s.cy = s.y;
  s.facing = 0;
  s.holdRange = dist;
  s.leash = Infinity;
  s.engageR = Infinity;
  s.leader = npc.__formLeader || null;
  s.target = victim;
  s.bearing = bearing;
  s.dist = dist;
  s.t = clock;
  npc.__battleSlot = s;
}

function resetSide(st) {
  st.frontDist = NaN;
  st.frontSpeed = 0;
  st.phase = 'idle';
  st.battle = false;
  st.lingerT = 0;
  st.axisAng = NaN;
  st.groups = 0;
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
function sideStance(side) {
  if (side === SIDE_FRIENDLY) {
    const order = (typeof window !== 'undefined' && window.SupportWing?.order) || 'guard';
    return order === 'engage' ? 'engage' : 'guard';
  }
  return 'engage';
}

function collectThreats(side, stance, player, out) {
  out.length = 0;
  const contacts = getSideContacts(side);
  const leash = (side === SIDE_FRIENDLY && stance === 'guard' && isAlive(player))
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
    if (leash && c.entity !== locked && !contactInLeash(c, leash)) continue;
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

function assignFlanks(st, members, threats) {
  flankGroups.clear();
  const groups = st.form.groups;

  for (let i = 0; i < members.length; i++) {
    const npc = members[i];
    // Okręt flagowy (także niszczyciel prowadzący grupę) trzyma linię.
    if (!isSmallShip(npc) || groups.has(npc)) continue;

    // Ofiara: flanka z poprzedniej przebudowy (dopóki cel żyje — bez tego okręt
    // co 0,45 s przeskakiwał między flanką a szykiem, bo cel ruchu zmienia co
    // chwilę), potem aktualny cel, jeśli to duży okręt wroga; inaczej najbliższy
    // duży kontakt z obrazu sytuacji.
    let victim = null;
    const prevSlot = npc.__battleSlot;
    const cur = (npc.forceTarget && !npc.forceTarget.dead) ? npc.forceTarget : npc.target;
    if (prevSlot && prevSlot.kind === 'flank' && isBigShip(prevSlot.target) && !prevSlot.target.destroyed) {
      victim = prevSlot.target;
    } else if (cur && !cur.dead && isBigShip(cur)) {
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

    // Najbliżsi zajmują sloty; nadmiar zostaje w szyku.
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
      writeFlankSlot(npc, st, victim, FLANK_BEARINGS[i], dist);
    }
  }
}

// Smycz slotu: w postawie obronnej okręt walczy wokół swojego miejsca, przy
// ATAKU eskorta poluje (engageR jak dawne „wyłamanie z szyku": 1,6× dystansu
// bojowego + 1,5 km od miejsca).
function slotEngageRadius(stance, standoff, leash) {
  if (stance === 'engage') return standoff * 1.6 + 1500;
  return standoff + leash;
}

// Okręt flagowy floty (korzeń przelotu bez gracza): największy, trwały, dopóki
// prowadzi grupę.
function resolveFlagship(st, fs) {
  const cur = st.flagship;
  if (cur && fs.groups.has(cur) && isAlive(cur)) return cur;
  let best = null;
  let bestR = -1;
  for (let i = 0; i < fs.leaders.length; i++) {
    const L = fs.leaders[i];
    const r = Number(L.radius) || 0;
    if (r > bestR + 1e-6) { bestR = r; best = L; }
  }
  st.flagship = best;
  return best;
}

// Zagrożenie strony: ważony centroid widocznych kontaktów (albo duch przy ATAKU).
// Zwraca false, gdy nic nie ma.
function resolveThreat(side, stance, threats) {
  _threat.repr = null;
  _threat.searching = false;
  if (threats.length > 0) {
    let ex = 0;
    let ey = 0;
    let evx = 0;
    let evy = 0;
    let ew = 0;
    let reprR = 0;
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
        _threat.repr = c.entity;
      }
    }
    _threat.x = ex / ew;
    _threat.y = ey / ew;
    _threat.vx = evx / ew;
    _threat.vy = evy / ew;
    return true;
  }
  // Wróg zniknął z czujników: postawa ofensywna idzie tam, gdzie go ostatnio widziano.
  const ghost = stance === 'engage' ? getFreshestGhost(side) : null;
  if (!ghost) return false;
  _threat.x = ghost.x;
  _threat.y = ghost.y;
  _threat.vx = 0;
  _threat.vy = 0;
  _threat.searching = true;
  return true;
}

function battleFormation(side, st, player, members, threats, dt) {
  const fs = st.form;
  const stance = st.stance;
  const E = _threat;
  const searching = E.searching;

  // Dystanse bojowe i tempo najwolniejszego (przelotowe, dopóki front daleko).
  const cruising = st.phase !== 'engage';
  let minStandoff = Infinity;
  let maxStandoff = 0;
  let pace = Infinity;
  for (let i = 0; i < members.length; i++) {
    const npc = members[i];
    const standoff = resolveStandoff(npc, E.repr) * (searching ? 0.5 : 1);
    npc.__coordStandoff = standoff;
    if (standoff < minStandoff) minStandoff = standoff;
    if (standoff > maxStandoff) maxStandoff = standoff;
    pace = Math.min(pace, memberSpeed(npc, cruising ? 'cruise' : 'combat'));
  }
  pace *= PACE_MARGIN;

  // Punkt odniesienia linii i prędkość układu.
  let mode = 'front';
  let refX = 0;
  let refY = 0;
  let fvx = 0;
  let fvy = 0;
  let reserve = 0;
  if (stance === 'guard' && side === SIDE_FRIENDLY && isAlive(player)) {
    mode = 'guard';
    refX = unitX(player);
    refY = unitY(player);
    fvx = unitVx(player);
    fvy = unitVy(player);
    reserve = Math.max(300, Number(player.radius) || 600) + FORMATION_CONFIG.rootReservePad;
  } else {
    // Front liczymy od linii okrętów flagowych (eskorta stoi za nią).
    const leaders = fs.leaders.length > 0 ? fs.leaders : members;
    for (let i = 0; i < leaders.length; i++) {
      refX += leaders[i].x;
      refY += leaders[i].y;
    }
    refX /= leaders.length;
    refY /= leaders.length;
  }

  // Oś natarcia (wygładzona — śmierć najbliższego wroga nie obraca linii skokiem).
  const tx = E.x - refX;
  const ty = E.y - refY;
  if (tx * tx + ty * ty > 1) {
    const target = Math.atan2(ty, tx);
    if (!st.battle || !Number.isFinite(st.axisAng)) st.axisAng = target;
    else {
      const err = wrapAngle(target - st.axisAng);
      const excess = Math.abs(err) - AXIS_DEADBAND;
      if (excess > 0) st.axisAng += Math.sign(err) * excess * Math.min(1, dt / AXIS_TAU);
    }
  } else if (!Number.isFinite(st.axisAng)) {
    st.axisAng = Number.isFinite(st.heading) ? st.heading : 0;
  }
  const axisX = Math.cos(st.axisAng);
  const axisY = Math.sin(st.axisAng);
  const latX = -axisY;
  const latY = axisX;

  let anchorX = refX;
  let anchorY = refY;
  const dNow = Math.max(0, tx * axisX + ty * axisY);
  if (mode === 'front') {
    // Front: startuje przy linii, idzie ku wrogowi tempem `pace` WZGLĘDEM
    // PRZESTRZENI, nigdy nie wyprzedza linii o więcej niż MAX_FRONT_LEAD i nie
    // wchodzi bliżej niż najkrótszy dystans bojowy. Gdy wróg sam podszedł, front
    // cofa się do floty. (Dawniej front schodził o `pace` względem WROGA — gdy
    // wróg nacierał z tą samą prędkością, linia ATAKU stała w miejscu.)
    const prev = Number.isFinite(st.frontDist) ? st.frontDist : dNow;
    const approach = -(E.vx * axisX + E.vy * axisY);
    let front = prev - (pace + approach) * dt;
    front = Math.max(front, dNow - MAX_FRONT_LEAD);
    front = Math.min(front, dNow);
    front = Math.max(front, minStandoff);
    st.frontSpeed = Math.max(0, (prev - front) / Math.max(1e-3, dt));
    st.frontDist = front;
    st.phase = searching ? 'search' : (front > maxStandoff * ENGAGE_PHASE_MUL ? 'advance' : 'engage');
    anchorX = E.x - axisX * front;
    anchorY = E.y - axisY * front;
  } else {
    st.frontDist = NaN;
    st.frontSpeed = 0;
    st.phase = mode;
  }
  st.ex = E.x;
  st.ey = E.y;

  if (stance === 'engage' && st.phase === 'engage') assignFlanks(st, members, threats);

  _frame.x = anchorX;
  _frame.y = anchorY;
  _frame.dirX = axisX;
  _frame.dirY = axisY;
  _frame.reserve = reserve;
  layoutBattle(fs, _frame);
  if (mode === 'guard') keepEscortSlotsClear(fs, refX, refY, Math.max(300, Number(player.radius) || 600));

  // W walce linia trzyma pole: podchodzi do dystansu bojowego, ale przed
  // wrogiem, który sam naciera, nie ucieka — stoi, dopóki nie wejdzie głębiej
  // niż pasmo osobowości (inaczej snajperzy cofali się bez końca, a bitwa
  // dryfowała przez pół mapy). Pasmo liczymy RAZ dla całej linii (od jej
  // środka): liczone per okręt od jego bieżącej odległości wyginało linię
  // w schody — kto był bliżej wroga, ten bliżej stawał.
  let lineIdeal = 0;
  let lineRange = 0;
  let lineHolding = false;
  if (mode === 'front' && st.phase === 'engage') {
    let n = 0;
    let rMax = 0;
    for (let gi = 0; gi < fs.leaders.length; gi++) {
      const g = fs.groups.get(fs.leaders[gi]);
      if (g.fwd < 0) continue; // tylny rząd trzyma się za linią
      lineIdeal += Number(g.leader.__coordStandoff) || 0;
      rMax = Math.max(rMax, Number(g.leader.radius) || 60);
      n++;
    }
    lineIdeal = n > 0 && lineIdeal > 0 ? lineIdeal / n : Math.max(minStandoff, 1);
    const lead = fs.leaders[0] || members[0];
    const band = resolveHoldRange(dNow, Math.max(st.frontDist, lineIdeal), resolveAiPersonality(lead), 1, rMax + 600);
    lineRange = band.range;
    lineHolding = band.holding;
  }

  const tether = FORMATION_TETHER[stance] || FORMATION_TETHER.engage;
  const facing = st.axisAng;
  for (let gi = 0; gi < fs.leaders.length; gi++) {
    const L = fs.leaders[gi];
    const g = fs.groups.get(L);
    const standoff = Number(L.__coordStandoff) || resolveStandoff(L, E.repr);
    let sx;
    let sy;
    let svx = fvx;
    let svy = fvy;
    if (mode === 'front') {
      let dist = Math.max(st.frontDist, standoff);
      svx = E.vx;
      svy = E.vy;
      if (st.phase === 'engage') {
        // Dłuższa broń (lotniskowiec, superkapitał) stoi proporcjonalnie dalej;
        // pod presją (słaba tarcza) okręt odchodzi na dystans odwrotu.
        dist = lineRange * (standoff / lineIdeal);
        const personality = resolveAiPersonality(L);
        const pressure = updateCombatPressure(L, personality);
        if (pressure > 1) dist = Math.max(dist, standoff * pressure);
        else if (lineHolding) {
          svx = 0;
          svy = 0;
        }
      } else if (dist <= st.frontDist + 1) {
        svx += axisX * st.frontSpeed;
        svy += axisY * st.frontSpeed;
      }
      // Tylny rząd (fwd < 0) stoi dalej od wroga.
      const back = dist - g.fwd;
      sx = E.x - axisX * back + latX * g.lat;
      sy = E.y - axisY * back + latY * g.lat;
    } else {
      sx = anchorX + axisX * g.fwd + latX * g.lat;
      sy = anchorY + axisY * g.fwd + latY * g.lat;
    }
    const leashL = tether.leader;
    writeFormationSlot(L, st, 'line', 'leader', sx, sy, svx, svy, facing, standoff,
      leashL, slotEngageRadius(stance, standoff, leashL), null);

    const lvx = unitVx(L);
    const lvy = unitVy(L);
    for (let k = 0; k < g.escorts.length; k++) {
      const e = g.escorts[k];
      const s = e.__battleSlot;
      if (s && s.kind === 'flank' && s.t === clock) continue; // flankuje
      const standoffE = Number(e.__coordStandoff) || resolveStandoff(e, E.repr);
      const leashE = tether.escort;
      writeFormationSlot(e, st, 'line', 'escort', g.ex[k], g.ey[k], lvx, lvy, facing, standoffE,
        leashE, slotEngageRadius(stance, standoffE, leashE), L);
    }
  }
}

function cruiseFormation(side, st, player, dt) {
  const fs = st.form;
  const stance = st.stance;
  const root = _root;
  root.entity = null;
  root.angle = NaN;
  if (side === SIDE_FRIENDLY && isAlive(player)) {
    root.x = unitX(player);
    root.y = unitY(player);
    root.vx = unitVx(player);
    root.vy = unitVy(player);
    root.radius = Math.max(300, Number(player.radius) || 600);
    root.angle = Number(player.angle);
  } else {
    const flagship = resolveFlagship(st, fs);
    if (!flagship) return false;
    root.x = flagship.x;
    root.y = flagship.y;
    root.vx = unitVx(flagship);
    root.vy = unitVy(flagship);
    root.radius = Number(flagship.radius) || 0;
    root.entity = flagship;
    root.angle = Number(flagship.angle);
  }

  // Kurs szyku: za ruchem korzenia, wygładzony; w miejscu — bez zmian.
  if (!Number.isFinite(st.heading)) {
    st.heading = Number.isFinite(root.angle) ? root.angle : (Number.isFinite(st.axisAng) ? st.axisAng : 0);
  }
  const sp = Math.hypot(root.vx, root.vy);
  if (sp > HEADING_MIN_SPEED) {
    const want = Math.atan2(root.vy, root.vx);
    st.heading += wrapAngle(want - st.heading) * Math.min(1, dt / HEADING_TAU);
  }
  st.heading = wrapAngle(st.heading);
  st.phase = 'cruise';
  st.frontDist = NaN;
  st.frontSpeed = 0;
  st.axisAng = NaN;

  layoutCruise(fs, root, st.heading);
  if (!root.entity) keepEscortSlotsClear(fs, root.x, root.y, root.radius);

  const tether = FORMATION_TETHER[stance] || FORMATION_TETHER.guard;
  const facing = st.heading;
  for (let gi = 0; gi < fs.leaders.length; gi++) {
    const L = fs.leaders[gi];
    const g = fs.groups.get(L);
    if (L === root.entity) {
      // Okręt flagowy floty jest korzeniem — nie ma miejsca, stoi albo walczy sam.
      clearSlot(L);
    } else {
      const standoff = resolveStandoff(L, null);
      writeFormationSlot(L, st, 'cruise', 'leader', g.slotX, g.slotY, root.vx, root.vy, facing, standoff,
        tether.leader, slotEngageRadius(stance, standoff, tether.leader), null);
    }
    const lvx = unitVx(L);
    const lvy = unitVy(L);
    for (let k = 0; k < g.escorts.length; k++) {
      const e = g.escorts[k];
      const standoffE = resolveStandoff(e, null);
      writeFormationSlot(e, st, 'cruise', 'escort', g.ex[k], g.ey[k], lvx, lvy, facing, standoffE,
        tether.escort, slotEngageRadius(stance, standoffE, tether.escort), L);
    }
  }
  return true;
}

function coordinateSide(side, members, player, dt) {
  const st = sideState[side];
  const stance = sideStance(side);
  if (stance !== st.stance) {
    st.stance = stance;
    // Nowa postawa: front liczony od nowa.
    st.frontDist = NaN;
  }

  const threats = collectThreats(side, stance, player, threatsScratch);

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
    resetFormationState(st.form);
    return;
  }

  const fs = st.form;
  organizeTaskGroups(activeMembers, fs);
  measureGroups(fs);
  st.groups = fs.leaders.length;

  let battle = resolveThreat(side, stance, threats);
  if (battle) {
    st.lingerT = BATTLE_LINGER;
  } else if (st.battle && st.lingerT > 0) {
    // Zagrożenie przed chwilą zniknęło — szyk bojowy zostaje, twarzą tam, gdzie było.
    st.lingerT -= dt;
    _threat.x = st.ex;
    _threat.y = st.ey;
    _threat.vx = 0;
    _threat.vy = 0;
    _threat.repr = null;
    _threat.searching = false;
    battle = true;
  }

  if (battle) {
    battleFormation(side, st, player, activeMembers, threats, dt);
    st.battle = true;
    return;
  }
  st.battle = false;
  st.lingerT = 0;
  if (!cruiseFormation(side, st, player, dt)) {
    for (let i = 0; i < activeMembers.length; i++) clearSlot(activeMembers[i]);
    resetSide(st);
  }
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

// Zwraca aktualny slot npc albo null, jeśli przeterminowany/nieaktualny.
// Miejsce jedzie ze swoim korzeniem / okrętem flagowym, więc pozycję (cx, cy)
// ekstrapolujemy od chwili przebudowy prędkością slotu.
export function getBattleSlot(npc) {
  const slot = npc && npc.__battleSlot;
  if (!slot) return null;
  const age = clock - slot.t;
  if (age > SLOT_TTL) return null;
  if (npc.command) return null;
  if (slot.kind === 'flank') {
    const v = slot.target;
    if (!v || v.dead || v.destroyed) return null;
  }
  slot.cx = slot.x + (Number(slot.vx) || 0) * age;
  slot.cy = slot.y + (Number(slot.vy) || 0) * age;
  return slot;
}

// Stan dowódcy strony (faza, front) — do mózgów i podglądu.
export function getFleetPhase(side) {
  return sideState[side] || null;
}

// Grupy bojowe strony (konsola: FleetAIDebug()).
export function describeFleetFormation(side) {
  const st = sideState[side];
  return st ? describeFormation(st.form) : [];
}

export function resetFleetCoordinator() {
  rebuildT = 0;
  clock = 0;
  lastRebuildClock = 0;
  for (const side of [SIDE_FRIENDLY, SIDE_PIRATE]) {
    const st = sideState[side];
    resetSide(st);
    st.stance = '';
    st.heading = NaN;
    st.flagship = null;
    resetFormationState(st.form);
  }
}

if (typeof window !== 'undefined') {
  window.updateFleetCoordinator = updateFleetCoordinator;
  window.getBattleSlot = getBattleSlot;
  window.getFleetPhase = getFleetPhase;
}
