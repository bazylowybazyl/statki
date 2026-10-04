// src/ai/fleetFormation.js
//
// Szyk floty: GRUPY BOJOWE (okręt flagowy + eskorta) i ich rozstawienie.
// Czyste funkcje bez window i renderu — woła je dowódca floty
// (fleetCoordinator.js) co ~0,45 s, osobno dla każdej strony.
//
// Dlaczego: dawny dowódca stawiał WSZYSTKIE okręty w jednej linii prostopadłej
// do osi natarcia (odstęp ≥ 620 j.), a szyk eskorty bez wroga (supportGuardSlot
// w index.html) rozstawiał je naprzemiennie na boki gracza co 1500 j. Wezwane
// 50 fregat + 5 niszczycieli + 5 pancerników dawało linię na 37–45 km, a że
// wszystkie terrańskie okręty mają ten sam railgun (dystans bojowy 5,6 km),
// w walce stały dokładnie w jednej prostej.
//
// Teraz:
//  - GRUPY: każdy duży okręt (pancernik, lotniskowiec, superkapitał) prowadzi
//    grupę; niszczyciele i fregaty są rozdzielane między grupy po równo, każda
//    pula osobno (niszczyciel na grupę, reszta fregatami). Przydział jest
//    trwały — okręt zmienia grupę tylko wtedy, gdy jego grupa ma nadmiar (nowy
//    pancernik, śmierć okrętu flagowego). Bez dużych okrętów grupy prowadzą
//    niszczyciele, a bez nich — klucze fregat (prowadzący + 5).
//  - PRZELOT (bez wroga): grupy na pierścieniu wokół KORZENIA szyku (gracz
//    albo okręt flagowy floty), eskorta na pierścieniach wokół swojego okrętu
//    flagowego. Pierścień nie ma wyróżnionego „przodu"
//    poza luką przed korzeniem, więc zakręt gracza przesuwa grupy najwyżej
//    o pół odstępu, zamiast obracać cały szyk (ciężki pancernik zawraca ~7 s).
//  - WALKA: pierwsza linia z okrętów flagowych, lotniskowce w tylnym rzędzie;
//    DRUGA LINIA z eskort — każda grupa w bloku za swoim okrętem flagowym,
//    z wolnym pasem za jego kadłubem, żeby eskorta nie strzelała mu w rufę
//    (isLineOfFireBlocked wstrzymuje ogień przez sojusznika). Eskorta przed
//    linią zasłaniałaby z kolei działa pancerników.
//
// Pozycje eskorty liczymy od AKTUALNEJ pozycji okrętu flagowego (nie od jego
// slotu): grupa leci razem, także gdy ciężki okręt jeszcze dochodzi do szyku.

import { resolveShipFlightSpec } from '../game/flight/shipFlightModel.js';

export const FORMATION_CONFIG = Object.freeze({
  // Odstęp eskort w pierścieniu i w bloku: nie mniej niż tyle, i nie mniej niż
  // dwa promienie + zapas (strefa separacji fregat to ~360–420 j.; przy 460 j.
  // fregaty wchodzące na miejsce ocierały się o sąsiadów).
  escortSpacingMin: 540,
  escortSpacingPad: 300,
  // Pierwszy pierścień eskorty: promienie okrętu flagowego i eskorty + zapas.
  ringClearPad: 450,
  // Luz między obrysami sąsiednich grup (przelot i walka).
  groupGap: 400,
  // Luz między obrysem korzenia (gracza) a pierścieniem grup.
  rootGap: 500,
  // Najmniejszy odstęp okrętów flagowych w linii: 2 promienie + tyle.
  leaderMinPad: 900,
  // Pierwszy rząd eskorty za okrętem flagowym: promienie + tyle.
  blockDepthPad: 600,
  // Pas ognia za okrętem flagowym, wolny od eskorty: jego promień + tyle
  // (isLineOfFireBlocked wstrzymuje ogień, gdy tor mija sojusznika o < r + 15).
  lanePad: 40,
  // Pierwsza linia: najwyżej tyle grup; nadmiar staje w tylnym rzędzie. Linia
  // przez gracza (ESKORTA) jest krótsza — pancerniki mają trzymać się blisko.
  frontRowMax: 6,
  frontRowMaxWithRoot: 4,
  // Klucz fregat bez żadnego większego okrętu: prowadzący + 5.
  squadronSize: 6,
  // Miejsce zostawione w linii dla gracza (jego promień + tyle z każdej strony).
  rootReservePad: 500,
  // Tylny rząd (lotniskowce) za blokami eskorty pierwszej linii.
  rearRowPad: 800,
  // Domyślne promienie, gdy byt nie ma jeszcze kadłuba.
  defaultEscortRadius: 110,
  defaultLeaderRadius: 140
});

const TWO_PI = Math.PI * 2;
const BIG_CLASSES = new Set(['battleship', 'carrier', 'supercapital']);
// Udział w eskorcie ∝ wadze okrętu flagowego.
const LEADER_WEIGHT = Object.freeze({ supercapital: 1.5, carrier: 1, battleship: 1, destroyer: 1, frigate: 1 });

let nextFormUid = 1;
function formUid(e) {
  if (!e.__formUid) e.__formUid = nextFormUid++;
  return e.__formUid;
}
const byUid = (a, b) => formUid(a) - formUid(b);

function wrapAngle(a) {
  let x = Number(a) || 0;
  if (x > Math.PI || x < -Math.PI) x = ((x + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  return x;
}

function radiusOf(e, fallback) {
  const r = Number(e?.radius);
  return Number.isFinite(r) && r > 0 ? r : fallback;
}

// Klasa okrętu dla szyku: klasa lotu kadłuba (shipFlightSpecs), a dla bytów bez
// specyfikacji — typ.
export function formationClassOf(npc) {
  if (!npc) return 'frigate';
  const spec = resolveShipFlightSpec(npc);
  if (spec && spec.flightClass) return spec.flightClass;
  const type = String(npc.type || '').toLowerCase();
  if (type.includes('frigate')) return 'frigate';
  if (type === 'destroyer') return 'destroyer';
  if (type.includes('carrier')) return 'carrier';
  if (type.includes('super') || type === 'atlas') return 'supercapital';
  if (type.includes('battleship')) return 'battleship';
  if (npc.isCapitalShip || radiusOf(npc, 0) >= 90) return 'battleship';
  return 'frigate';
}

export function isBigFormationClass(cls) {
  return BIG_CLASSES.has(cls);
}

function makeGroup(leader) {
  return {
    leader,
    escorts: [],
    cls: 'battleship',
    weight: 1,
    fresh: false,
    quota: 0,
    count: 0,
    // wymiary
    rL: 0,
    rE: 0,
    eS: 0,
    ringR: [],
    ringN: [],
    footprint: 0,
    cols: 0,
    rows: 0,
    laneHalf: 0,
    d0: 0,
    rowGap: 0,
    width: 0,
    depth: 0,
    // wynik rozstawienia
    lat: 0,
    fwd: 0,
    slotX: 0,
    slotY: 0,
    ex: [],
    ey: []
  };
}

export function createFormationState() {
  return {
    leaders: [],
    groups: new Map(),
    // pule robocze (bez alokacji w stanie ustalonym)
    _bigs: [],
    _dds: [],
    _ffs: [],
    _pool: [],
    _unassigned: [],
    _cand: []
  };
}

export function resetFormationState(fs) {
  fs.leaders.length = 0;
  fs.groups.clear();
}

// ---------------------------------------------------------------------------
// Organizacja grup
// ---------------------------------------------------------------------------

// Klucze fregat, gdy flota nie ma nic większego: prowadzący są trwali
// (flaga na okręcie), dobieramy/zdejmujemy tylko różnicę.
function pickSquadronLeads(ffs, out) {
  out.length = 0;
  const size = FORMATION_CONFIG.squadronSize;
  const desired = Math.ceil(ffs.length / size);
  for (let i = 0; i < ffs.length; i++) if (ffs[i].__formSquadLead) out.push(ffs[i]);
  if (out.length > desired) {
    out.sort(byUid);
    for (let i = desired; i < out.length; i++) out[i].__formSquadLead = false;
    out.length = desired;
  } else if (out.length < desired) {
    const sorted = ffs.slice().sort(byUid);
    for (let i = 0; i < sorted.length && out.length < desired; i++) {
      const f = sorted[i];
      if (f.__formSquadLead) continue;
      f.__formSquadLead = true;
      out.push(f);
    }
  }
  return out;
}

function distSq(a, b) {
  const dx = (Number(a.x) || 0) - (Number(b.x) || 0);
  const dy = (Number(a.y) || 0) - (Number(b.y) || 0);
  return dx * dx + dy * dy;
}

// Rozdziela pulę eskorty między grupy: kwoty ∝ wadze okrętu flagowego,
// dotychczasowe przydziały zostają (w ramach kwoty zostają najbliżsi okrętu
// flagowego), reszta idzie do najbliższej grupy z wolnym miejscem.
function assignPool(fs, pool) {
  const n = pool.length;
  if (n === 0) return;
  const leaders = fs.leaders;
  const L = leaders.length;
  let wsum = 0;
  for (let i = 0; i < L; i++) wsum += fs.groups.get(leaders[i]).weight;
  let given = 0;
  for (let i = 0; i < L; i++) {
    const g = fs.groups.get(leaders[i]);
    const exact = (n * g.weight) / wsum;
    g.quota = Math.floor(exact);
    g.__frac = exact - g.quota;
    g.count = 0;
    given += g.quota;
  }
  // Reszta dla największych ułamków (remis: kolejność okrętów flagowych — stabilna).
  for (let r = given; r < n; r++) {
    let best = null;
    for (let i = 0; i < L; i++) {
      const g = fs.groups.get(leaders[i]);
      if (!best || g.__frac > best.__frac + 1e-9) best = g;
    }
    best.quota++;
    best.__frac = -1;
  }

  const unassigned = fs._unassigned;
  unassigned.length = 0;
  const cand = fs._cand;
  // Dotychczasowi członkowie grup.
  for (let i = 0; i < L; i++) {
    const g = fs.groups.get(leaders[i]);
    cand.length = 0;
    for (let k = 0; k < n; k++) {
      const e = pool[k];
      if (e.__formLeader === g.leader) cand.push(e);
    }
    if (cand.length > g.quota) {
      const leader = g.leader;
      cand.sort((a, b) => distSq(a, leader) - distSq(b, leader));
      for (let k = g.quota; k < cand.length; k++) unassigned.push(cand[k]);
      cand.length = g.quota;
    }
    for (let k = 0; k < cand.length; k++) g.escorts.push(cand[k]);
    g.count = cand.length;
  }
  // Nowi i nadmiarowi: do najbliższej grupy z wolnym miejscem.
  for (let k = 0; k < n; k++) {
    const e = pool[k];
    const cur = e.__formLeader ? fs.groups.get(e.__formLeader) : null;
    if (!cur || !cur.fresh) unassigned.push(e);
  }
  for (let k = 0; k < unassigned.length; k++) {
    const e = unassigned[k];
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < L; i++) {
      const g = fs.groups.get(leaders[i]);
      if (g.count >= g.quota) continue;
      const d = distSq(e, g.leader);
      if (d < bestD) { bestD = d; best = g; }
    }
    if (!best) continue; // nie powinno się zdarzyć — kwoty sumują się do n
    best.escorts.push(e);
    best.count++;
    e.__formLeader = best.leader;
  }
}

// Dzieli członków strony na grupy. Wynik: fs.leaders (stabilna kolejność)
// i fs.groups (okręt flagowy → grupa z listą eskorty).
export function organizeTaskGroups(members, fs) {
  const bigs = fs._bigs;
  const dds = fs._dds;
  const ffs = fs._ffs;
  bigs.length = 0;
  dds.length = 0;
  ffs.length = 0;
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const cls = formationClassOf(m);
    m.__formClass = cls;
    if (BIG_CLASSES.has(cls)) bigs.push(m);
    else if (cls === 'destroyer') dds.push(m);
    else ffs.push(m);
  }

  const leaders = fs.leaders;
  leaders.length = 0;
  let escortDds = false;
  if (bigs.length > 0) {
    for (let i = 0; i < bigs.length; i++) leaders.push(bigs[i]);
    escortDds = true;
  } else if (dds.length > 0) {
    for (let i = 0; i < dds.length; i++) leaders.push(dds[i]);
  } else {
    pickSquadronLeads(ffs, leaders);
  }
  leaders.sort(byUid);

  for (const g of fs.groups.values()) g.fresh = false;
  for (let i = 0; i < leaders.length; i++) {
    const leader = leaders[i];
    let g = fs.groups.get(leader);
    if (!g) {
      g = makeGroup(leader);
      fs.groups.set(leader, g);
    }
    g.fresh = true;
    g.escorts.length = 0;
    g.cls = leader.__formClass || formationClassOf(leader);
    g.weight = LEADER_WEIGHT[g.cls] || 1;
    leader.__formLeader = null;
  }
  for (const [leader, g] of fs.groups) {
    if (!g.fresh) fs.groups.delete(leader);
  }
  if (leaders.length === 0) return fs;

  // Pule eskorty osobno — każda grupa dostaje swój udział niszczycieli i fregat.
  if (escortDds) assignPool(fs, dds);
  const pool = fs._pool;
  pool.length = 0;
  for (let i = 0; i < ffs.length; i++) {
    if (!ffs[i].__formSquadLead || bigs.length > 0 || dds.length > 0) pool.push(ffs[i]);
  }
  // Prowadzący klucza przestaje nim być, gdy we flocie jest coś większego.
  if (bigs.length > 0 || dds.length > 0) {
    for (let i = 0; i < ffs.length; i++) ffs[i].__formSquadLead = false;
  }
  assignPool(fs, pool);
  return fs;
}

// ---------------------------------------------------------------------------
// Wymiary grup
// ---------------------------------------------------------------------------

function measureGroup(g) {
  const C = FORMATION_CONFIG;
  const n = g.escorts.length;
  g.rL = radiusOf(g.leader, C.defaultLeaderRadius);
  let rE = 0;
  for (let i = 0; i < n; i++) rE = Math.max(rE, radiusOf(g.escorts[i], C.defaultEscortRadius));
  if (!(rE > 0)) rE = C.defaultEscortRadius;
  g.rE = rE;
  const eS = Math.max(C.escortSpacingMin, 2 * rE + C.escortSpacingPad);
  g.eS = eS;

  // Przelot: pierścienie eskorty wokół okrętu flagowego, od wewnątrz.
  g.ringR.length = 0;
  g.ringN.length = 0;
  let R = g.rL + rE + C.ringClearPad;
  let left = n;
  while (left > 0) {
    const cap = Math.max(1, Math.floor((TWO_PI * R) / eS));
    const take = Math.min(left, cap);
    g.ringR.push(R);
    g.ringN.push(take);
    left -= take;
    if (left > 0) R += eS;
  }
  g.footprint = n > 0 ? R + rE + 150 : g.rL + 150;

  // Walka: blok eskorty za okrętem flagowym, `cols` kolumn z każdej strony
  // wolnego pasa, tyle rzędów, ile trzeba (blok mniej więcej tak głęboki,
  // jak szeroki — nie kolejna długa linia).
  g.cols = Math.max(1, Math.ceil(Math.sqrt(n / 4)));
  const perRow = 2 * g.cols;
  g.rows = n > 0 ? Math.ceil(n / perRow) : 0;
  g.laneHalf = g.rL + C.lanePad;
  g.d0 = g.rL + rE + C.blockDepthPad;
  g.rowGap = eS;
  const halfWidth = n > 0 ? g.laneHalf + (g.cols - 0.5) * eS + rE : g.rL;
  g.width = Math.max(2 * halfWidth, 2 * g.rL + C.leaderMinPad) + C.groupGap;
  g.depth = n > 0 ? g.d0 + (g.rows - 1) * g.rowGap + rE : g.rL;
}

export function measureGroups(fs) {
  for (let i = 0; i < fs.leaders.length; i++) measureGroup(fs.groups.get(fs.leaders[i]));
}

// ---------------------------------------------------------------------------
// Przydział do miejsc bez krzyżowania kursów
// ---------------------------------------------------------------------------

const _cycItems = [];
const _cycAng = [];
const _cycSlots = [];
const _cycSlotAng = [];
const _cycOrder = [];

// Przydział cykliczny: obiekty i miejsca na okręgu wokół (cx, cy), posortowane
// po kącie; szukamy obrotu, który minimalizuje sumę kwadratów przesunięć
// kątowych (dla równych odstępów to optimum — zachowuje kolejność na okręgu).
// Zwraca w `outSlotIdx[i]` indeks miejsca dla items[i].
function assignCyclic(items, count, cx, cy, slotAngles, outSlotIdx) {
  _cycItems.length = 0;
  for (let i = 0; i < count; i++) {
    const e = items[i];
    _cycItems.push(i);
    _cycAng[i] = Math.atan2((Number(e.y) || 0) - cy, (Number(e.x) || 0) - cx);
  }
  _cycItems.sort((a, b) => _cycAng[a] - _cycAng[b]);
  _cycSlots.length = 0;
  for (let j = 0; j < count; j++) {
    _cycSlots.push(j);
    _cycSlotAng[j] = wrapAngle(slotAngles[j]);
  }
  _cycSlots.sort((a, b) => _cycSlotAng[a] - _cycSlotAng[b]);
  let bestK = 0;
  let bestCost = Infinity;
  for (let k = 0; k < count; k++) {
    let cost = 0;
    for (let i = 0; i < count && cost < bestCost; i++) {
      const d = wrapAngle(_cycAng[_cycItems[i]] - _cycSlotAng[_cycSlots[(i + k) % count]]);
      cost += d * d;
    }
    if (cost < bestCost) { bestCost = cost; bestK = k; }
  }
  for (let i = 0; i < count; i++) {
    outSlotIdx[_cycItems[i]] = _cycSlots[(i + bestK) % count];
  }
  _cycOrder.length = 0;
}

// ---------------------------------------------------------------------------
// Szyk przelotowy
// ---------------------------------------------------------------------------

const _ringLeaders = [];
const _ringAngles = [];
const _ringIdx = [];
const _escSorted = [];
const _escAngles = [];
const _escIdx = [];
const _escRing = [];

// Eskorta na pierścieniach wokół AKTUALNEJ pozycji okrętu flagowego.
function layoutEscortRings(g, heading) {
  const n = g.escorts.length;
  g.ex.length = n;
  g.ey.length = n;
  if (n === 0) return;
  const lx = Number(g.leader.x) || 0;
  const ly = Number(g.leader.y) || 0;
  // Bliżsi okrętu flagowego idą na pierścień wewnętrzny.
  _escSorted.length = 0;
  for (let i = 0; i < n; i++) _escSorted.push(i);
  _escSorted.sort((a, b) => distSq(g.escorts[a], g.leader) - distSq(g.escorts[b], g.leader));
  let offset = 0;
  for (let r = 0; r < g.ringR.length; r++) {
    const m = g.ringN[r];
    const R = g.ringR[r];
    _escRing.length = 0;
    for (let k = 0; k < m; k++) {
      _escRing.push(g.escorts[_escSorted[offset + k]]);
      _escAngles[k] = heading + Math.PI / 2 + (TWO_PI * k) / m;
    }
    assignCyclic(_escRing, m, lx, ly, _escAngles, _escIdx);
    for (let k = 0; k < m; k++) {
      const gi = _escSorted[offset + k];
      const a = _escAngles[_escIdx[k]];
      g.ex[gi] = lx + Math.cos(a) * R;
      g.ey[gi] = ly + Math.sin(a) * R;
    }
    offset += m;
  }
}

// Szyk przelotowy wokół korzenia `root` ({ x, y, radius, entity }):
//  - grupa korzenia (gdy korzeniem jest okręt flagowy floty) zostaje w środku,
//  - pozostałe grupy na pierścieniu z luką przed korzeniem (kurs `heading`),
//  - eskorta każdej grupy na pierścieniach wokół jej okrętu flagowego.
// Wynik: g.slotX/slotY (okręt flagowy; pomijany dla korzenia) oraz g.ex/g.ey.
export function layoutCruise(fs, root, heading) {
  const C = FORMATION_CONFIG;
  const rootGroup = root.entity ? fs.groups.get(root.entity) || null : null;
  _ringLeaders.length = 0;
  let gMax = 0;
  for (let i = 0; i < fs.leaders.length; i++) {
    const g = fs.groups.get(fs.leaders[i]);
    if (g === rootGroup) continue;
    _ringLeaders.push(fs.leaders[i]);
    gMax = Math.max(gMax, g.footprint);
  }
  const N = _ringLeaders.length;
  const rootR = rootGroup ? rootGroup.footprint : Math.max(0, Number(root.radius) || 0);
  if (N > 0) {
    const Rg = Math.max(rootR + gMax + C.rootGap, (N * (2 * gMax + C.groupGap)) / TWO_PI);
    for (let j = 0; j < N; j++) _ringAngles[j] = heading + Math.PI / N + (TWO_PI * j) / N;
    assignCyclic(_ringLeaders, N, root.x, root.y, _ringAngles, _ringIdx);
    for (let i = 0; i < N; i++) {
      const g = fs.groups.get(_ringLeaders[i]);
      const a = _ringAngles[_ringIdx[i]];
      g.slotX = root.x + Math.cos(a) * Rg;
      g.slotY = root.y + Math.sin(a) * Rg;
    }
  }
  if (rootGroup) {
    rootGroup.slotX = Number(rootGroup.leader.x) || 0;
    rootGroup.slotY = Number(rootGroup.leader.y) || 0;
  }
  for (let i = 0; i < fs.leaders.length; i++) layoutEscortRings(fs.groups.get(fs.leaders[i]), heading);
}

// ---------------------------------------------------------------------------
// Szyk bojowy
// ---------------------------------------------------------------------------

const _front = [];
const _rear = [];
const _proj = new Map();
const _blkLat = [];
const _blkFwd = [];
const _blkSlotOrder = [];
const _blkEscOrder = [];
const _blkEscLat = [];
const _blkEscFwd = [];

// Blok eskorty za okrętem flagowym, w układzie szyku (oś `dir`, bok `lat`).
// Rząd po rzędzie, od kolumn wewnętrznych; w niepełnym rzędzie strona
// startowa zmienia się co rząd, żeby blok nie przechylał się na jedną burtę.
function layoutEscortBlock(g, dirX, dirY) {
  const n = g.escorts.length;
  g.ex.length = n;
  g.ey.length = n;
  if (n === 0) return;
  const latX = -dirY;
  const latY = dirX;
  const perRow = 2 * g.cols;
  let s = 0;
  for (let r = 0; r < g.rows; r++) {
    const inRow = Math.min(perRow, n - r * perRow);
    const flip = (r & 1) ? 1 : -1;
    for (let k = 0; k < inRow; k++) {
      const col = k >> 1;
      const side = (k & 1) ? -flip : flip;
      _blkLat[s] = side * (g.laneHalf + (col + 0.5) * g.eS);
      _blkFwd[s] = -(g.d0 + r * g.rowGap);
      s++;
    }
  }
  // Miejsca: po boku (od lewej), w kolumnie od przodu.
  _blkSlotOrder.length = 0;
  for (let i = 0; i < n; i++) _blkSlotOrder.push(i);
  _blkSlotOrder.sort((a, b) => (_blkLat[a] - _blkLat[b]) || (_blkFwd[b] - _blkFwd[a]));
  // Eskorta: po rzucie bocznym względem okrętu flagowego, kolumnami; w kolumnie od przodu.
  const lx = Number(g.leader.x) || 0;
  const ly = Number(g.leader.y) || 0;
  _blkEscOrder.length = 0;
  for (let i = 0; i < n; i++) {
    const e = g.escorts[i];
    const rx = (Number(e.x) || 0) - lx;
    const ry = (Number(e.y) || 0) - ly;
    _blkEscLat[i] = rx * latX + ry * latY;
    _blkEscFwd[i] = rx * dirX + ry * dirY;
    _blkEscOrder.push(i);
  }
  _blkEscOrder.sort((a, b) => _blkEscLat[a] - _blkEscLat[b]);
  let i = 0;
  while (i < n) {
    const colLat = _blkLat[_blkSlotOrder[i]];
    let j = i;
    while (j < n && Math.abs(_blkLat[_blkSlotOrder[j]] - colLat) < 1) j++;
    // Kolumna [i, j): eskorta z tego zakresu, posortowana od przodu.
    const colEsc = _blkEscOrder.slice(i, j).sort((a, b) => _blkEscFwd[b] - _blkEscFwd[a]);
    for (let k = 0; k < colEsc.length; k++) {
      const si = _blkSlotOrder[i + k];
      const ei = colEsc[k];
      g.ex[ei] = lx + dirX * _blkFwd[si] + latX * _blkLat[si];
      g.ey[ei] = ly + dirY * _blkFwd[si] + latY * _blkLat[si];
    }
    i = j;
  }
}

// Szyk bojowy w układzie `frame`:
//   { x, y } — punkt odniesienia linii (gracz przy ESKORCIE albo front),
//   { dirX, dirY } — oś natarcia (jednostkowa, w stronę wroga),
//   reserve — półszerokość miejsca w środku pierwszej linii (gracz; 0 = brak).
// Wynik: g.lat / g.fwd okrętu flagowego względem punktu odniesienia (bok / oś;
// dowódca sam liczy odległość linii od wroga) oraz g.ex/g.ey eskorty — blok
// za AKTUALNĄ pozycją okrętu flagowego.
export function layoutBattle(fs, frame) {
  const C = FORMATION_CONFIG;
  const dirX = frame.dirX;
  const dirY = frame.dirY;
  const latX = -dirY;
  const latY = dirX;
  _front.length = 0;
  _rear.length = 0;
  _proj.clear();
  for (let i = 0; i < fs.leaders.length; i++) {
    const L = fs.leaders[i];
    const g = fs.groups.get(L);
    const rx = (Number(L.x) || 0) - frame.x;
    const ry = (Number(L.y) || 0) - frame.y;
    _proj.set(g, { lat: rx * latX + ry * latY, fwd: rx * dirX + ry * dirY });
    if (g.cls === 'carrier') _rear.push(g);
    else _front.push(g);
  }
  const reserve = Math.max(0, Number(frame.reserve) || 0);
  // Nadmiar pierwszej linii: najdalej z tyłu przechodzą do tylnego rzędu.
  const frontMax = reserve > 0 ? C.frontRowMaxWithRoot : C.frontRowMax;
  if (_front.length > frontMax) {
    _front.sort((a, b) => _proj.get(b).fwd - _proj.get(a).fwd);
    for (let i = frontMax; i < _front.length; i++) _rear.push(_front[i]);
    _front.length = frontMax;
  }
  const byLat = (a, b) => _proj.get(a).lat - _proj.get(b).lat;
  _front.sort(byLat);
  _rear.sort(byLat);

  let frontDepth = 0;
  if (reserve > 0) {
    // Gracz w środku linii: lewa połowa od niego w lewo, prawa w prawo.
    const leftCount = Math.floor(_front.length / 2);
    let cursor = -reserve;
    for (let i = leftCount - 1; i >= 0; i--) {
      const g = _front[i];
      g.lat = cursor - g.width / 2;
      cursor -= g.width;
    }
    cursor = reserve;
    for (let i = leftCount; i < _front.length; i++) {
      const g = _front[i];
      g.lat = cursor + g.width / 2;
      cursor += g.width;
    }
  } else {
    let total = 0;
    for (let i = 0; i < _front.length; i++) total += _front[i].width;
    let cursor = -total / 2;
    for (let i = 0; i < _front.length; i++) {
      const g = _front[i];
      g.lat = cursor + g.width / 2;
      cursor += g.width;
    }
  }
  for (let i = 0; i < _front.length; i++) {
    _front[i].fwd = 0;
    frontDepth = Math.max(frontDepth, _front[i].depth);
  }
  if (_rear.length > 0) {
    let rearR = 0;
    let total = 0;
    for (let i = 0; i < _rear.length; i++) {
      rearR = Math.max(rearR, _rear[i].rL);
      total += _rear[i].width;
    }
    // Za pierwszą linią z jej eskortą (i za graczem, gdy stoi w linii).
    const back = Math.max(frontDepth, reserve) + rearR + C.rearRowPad;
    let cursor = -total / 2;
    for (let i = 0; i < _rear.length; i++) {
      const g = _rear[i];
      g.lat = cursor + g.width / 2;
      g.fwd = -back;
      cursor += g.width;
    }
  }
  for (let i = 0; i < fs.leaders.length; i++) layoutEscortBlock(fs.groups.get(fs.leaders[i]), dirX, dirY);
}

// Miejsca eskorty liczone od AKTUALNEJ pozycji okrętu flagowego potrafią
// wypaść na graczu — okręt flagowy zostaje w tyle, gdy gracz się rozpędza, i
// jego pierścień / blok nachodzi na kadłub gracza; fregaty pchały się wtedy na
// Atlasa. Takie miejsce przesuwamy promieniście na brzeg strefy gracza.
export function keepEscortSlotsClear(fs, cx, cy, rootRadius) {
  const r0 = Math.max(0, Number(rootRadius) || 0);
  if (!(r0 > 0)) return;
  for (let i = 0; i < fs.leaders.length; i++) {
    const g = fs.groups.get(fs.leaders[i]);
    const clear = r0 + g.rE + FORMATION_CONFIG.rootGap;
    for (let k = 0; k < g.escorts.length; k++) {
      const dx = g.ex[k] - cx;
      const dy = g.ey[k] - cy;
      const d = Math.hypot(dx, dy);
      if (d >= clear) continue;
      if (d > 1e-3) {
        g.ex[k] = cx + (dx / d) * clear;
        g.ey[k] = cy + (dy / d) * clear;
      } else {
        g.ex[k] = cx + clear;
      }
    }
  }
}

// Podgląd do konsoli (FleetAIDebug).
export function describeFormation(fs) {
  const out = [];
  for (let i = 0; i < fs.leaders.length; i++) {
    const g = fs.groups.get(fs.leaders[i]);
    out.push({ leader: g.leader.type || g.cls, cls: g.cls, escorts: g.escorts.length });
  }
  return out;
}
