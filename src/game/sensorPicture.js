// ============================================================
// Obraz czujników z gry dla UI zasięgu radarów (prototyp `?radarZasiegi`, 2026-11-04; plan:
// docs/PLAN-zasieg-czujnikow.md). Czysta logika (bez three / DOM / window) — dane gry dają ADAPTERY.
//
// Co ~0,2 s: rekordy bytów (gracz, NPC stron, stacje, sondy / drony / stacje czujników gracza) → model wykrywania
// (src/game/sensorDetection.js: czujniki × sygnatura × osłona) → WIEDZA strony gracza o radarach wroga
// (identyfikacja = mgła wojny, KONTAKT = model; duch 25 s; stacja odkryta zostaje) → SUMY KÓŁ dla UI
// (src/game/sensorCoverage.js): strefy znanych radarów wroga przy OBECNEJ sygnaturze gracza i własne czujniki dla celu
// o sygnaturze pancernika. Rozgrywki nie zmienia: AI i mgła wojny liczą jak dotąd.
//
// Adaptery (`createSensorPicture(adapters)`): alive(e), sideOf(e) → 'friendly' | 'pirate' | null, posOf(e, out),
// passiveOf(e), activeOf(e, passive), baseSigOf(e), visionOf(e), coverAt(x, y), identified(e) (mgła: !hides),
// cloaked(e), writeState(e, stan, isPlayer) (ciąg, napęd), isStation(e).
// ============================================================

import {
  SENSOR_LEVEL, computeDetectionPicture, contactOffset, contactSizeClass, createDetectionPicture, createSensorState,
  entitySignature, noteSensorFire, noteSensorPing, sensorStrength, stepSensorState
} from './sensorDetection.js';
import {
  addCoverageCircle, beginCoverage, buildCoverage, coverageCountAt, createCoverage, nearestCoverageEdge
} from './sensorCoverage.js';

export const SENSOR_PICTURE_TUNE = Object.freeze({
  // Przebudowa obrazu [s] (5 Hz — jak obraz sytuacji AI, 4 Hz; fale i znaczniki rysują się co klatkę).
  refreshSec: 0.2,
  // Duch zgubionego radaru wroga [s].
  ghostSec: 25,
  // Moc radaru KONTAKTU zgadywana z rozmiaru (MAŁY … OGROMNY), póki nie zidentyfikowany — typowa moc klasy o takiej
  // sygnaturze (fregata 18 km, niszczyciel 30, pancernik 45; okręty z flagą kapitałową mają sygnaturę 1,3 → OGROMNY).
  strengthGuess: Object.freeze([15000, 25000, 35000, 45000]),
  // Własne czujniki pokazujemy dla celu o tej sygnaturze (pancernik).
  refSignature: 1.0,
  // Stacje bez profilu czujników.
  stationStrength: 60000,
  stationSignature: 1.5,
  // Grupa zagrożeń: znani wrogowie bliżej niż tyle [j.] od lidera (najgroźniejszego) to jedna grupa — flota daje jeden
  // znak w UI, nie milion znaczników.
  threatGroupRadius: 15000,
  // Dotychczasowy lider prowadzi dalej, póki inny członek nie ma ułamka większego o ten mnożnik: miejsce kontaktu wędruje
  // (contactOffset), więc bez tego znak wroga przeskakiwałby między stojącymi okrętami.
  threatLeadHold: 1.15,
  // Członek grupy zostaje w niej do promienia × ten mnożnik (+ 2 × błędy miejsca), żeby wędrujące miejsca kontaktów nie
  // rozbijały stojącej floty; wejście do grupy — promień + błędy miejsca obu stron.
  threatStayMul: 1.5
});

const SIDE_PLAYER = 'friendly';

function makeRec() {
  return { e: null, x: 0, y: 0, side: null, strength: 0, signature: 0, cover: 1, ident: 0, kind: 'ship', isPlayer: false, extra: null };
}

/** Obraz czujników (stan modułu wołającego). */
export function createSensorPicture(adapters, tune = SENSOR_PICTURE_TUNE) {
  return {
    A: adapters,
    tune,
    time: 0,
    acc: Infinity,
    version: 0,
    ready: false,
    recs: [],
    n: 0,
    playerRec: null,
    det: createDetectionPicture(64),
    enemy: createCoverage(),       // strefy ZNANYCH radarów wroga (promień = moc × sygnatura gracza × osłona przy graczu)
    own: createCoverage(),         // własne czujniki (gracz, sojusznicy, sondy, drony, stacje) dla celu refSignature
    enemyInfo: [],                 // znacznik koła strefy wroga → wpis wiedzy (est — moc zgadnięta, ghost — duch)
    knowList: [],                  // wiedza strony gracza o bytach wroga (pętla rysunku czyta level / ident / x / y)
    threats: createThreats(64),    // grupy zagrożeń: wrogowie w jednym miejscu — ich i mój zasięg jako ułamek odległości
    know: new WeakMap(),
    states: new WeakMap(),
    nextId: 1,
    player: {
      x: 0, y: 0, signature: 1, cover: 1, sigEff: 1, strength: 0, vision: 0,
      detectedTrue: 0, detectedKnown: 0,
      edge: { x: 0, y: 0, dist: Infinity, inside: false, arc: -1, circle: -1 }
    },
    _pos: { x: 0, y: 0 },
    _off: { x: 0, y: 0, err: 0 }
  };
}

/** Stan czujnikowy bytu (tworzony przy pierwszym użyciu; ciepło gaśnie liczone do czasu obrazu). */
export function sensorStateOf(P, e) {
  let s = P.states.get(e);
  if (!s) {
    s = createSensorState();
    s.t = P.time;
    P.states.set(e, s);
  }
  return s;
}

function stepTo(P, s) {
  const dt = P.time - s.t;
  if (dt > 0) stepSensorState(s, dt);
  s.t = P.time;
}

/** Strzał bytu (hak szyny strzałów gry). */
export function noteSensorPictureFire(P, e, weight = 1) {
  if (!e) return;
  const s = sensorStateOf(P, e);
  stepTo(P, s);
  noteSensorFire(s, weight);
}

/** Impuls skanera X bytu. */
export function noteSensorPicturePing(P, e) {
  if (!e) return;
  const s = sensorStateOf(P, e);
  stepTo(P, s);
  noteSensorPing(s);
}

function pushRec(P) {
  let r = P.recs[P.n];
  if (!r) { r = makeRec(); P.recs[P.n] = r; }
  P.n++;
  return r;
}

function fillEntityRec(P, r, e, side, isPlayer, kind) {
  const A = P.A;
  const T = P.tune;
  const s = sensorStateOf(P, e);
  stepTo(P, s);
  if (A.writeState) A.writeState(e, s, isPlayer);
  const p = A.posOf(e, P._pos);
  r.e = e; r.x = p.x; r.y = p.y; r.side = side; r.isPlayer = isPlayer; r.kind = kind; r.extra = null;
  if (kind === 'station') {
    r.strength = sensorStrength(T.stationStrength, T.stationStrength, s);
    r.signature = entitySignature(T.stationSignature, s);
  } else {
    const passive = A.passiveOf(e);
    r.strength = sensorStrength(passive, A.activeOf(e, passive), s);
    r.signature = A.cloaked(e) ? 0 : entitySignature(A.baseSigOf(e), s);
  }
  r.cover = A.coverAt(r.x, r.y);
  r.ident = A.visionOf(e);
  return r;
}

function knowOf(P, e) {
  let k = P.know.get(e);
  if (!k) {
    k = { e, id: P.nextId++, level: 0, ident: false, seenAt: -1e9, x: 0, y: 0, ang: 0, err: 0, sigSeen: 1, strength: 0, disc: false, rec: -1, listed: false, wasLead: false, groupLeadId: -1 };
    P.know.set(e, k);
  }
  if (!k.listed) { k.listed = true; P.knowList.push(k); }
  return k;
}

/** Stan wiedzy o bycie wroga: 'live' (kontakt / identyfikacja teraz), 'disc' (odkryta stacja), 'ghost', null. */
export function sensorKnowState(P, k) {
  if (k.level > 0) return 'live';
  if (k.disc) return 'disc';
  if (P.time - k.seenAt < P.tune.ghostSec) return 'ghost';
  return null;
}

/**
 * Krok obrazu: dt — czas logiki gry (staje w pauzie); world: { player, npcs, stations, extraSources() }.
 * Przebudowa co `refreshSec`; zwraca true, gdy obraz się zmienił.
 */
export function updateSensorPicture(P, dt, world, force = false) {
  P.time += dt > 0 ? dt : 0;
  P.acc += dt > 0 ? dt : 0;
  if (!force && P.acc < P.tune.refreshSec) return false;
  P.acc = 0;
  rebuild(P, world);
  return true;
}

function rebuild(P, world) {
  const A = P.A;
  const T = P.tune;
  P.n = 0;
  P.playerRec = null;
  const player = world.player;
  if (player && A.alive(player)) {
    const r = fillEntityRec(P, pushRec(P), player, SIDE_PLAYER, true, 'ship');
    P.playerRec = r;
  }
  const npcs = world.npcs;
  if (npcs) {
    for (let i = 0; i < npcs.length; i++) {
      const e = npcs[i];
      if (!e || e === player || !A.alive(e)) continue;
      const side = A.sideOf(e);
      if (!side) continue;
      fillEntityRec(P, pushRec(P), e, side, false, A.isStation && A.isStation(e) ? 'station' : 'ship');
    }
  }
  const stations = world.stations;
  if (stations) {
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      if (!st || !A.alive(st)) continue;
      const side = A.sideOf(st);
      if (!side) continue;
      fillEntityRec(P, pushRec(P), st, side, false, 'station');
    }
  }
  // sondy, drony zwiadu, stacje czujników gracza (SensorSystem.getSensorSources: { x, y, range, type }) — źródła bez bytu
  const extras = world.extraSources ? world.extraSources() : null;
  if (extras) {
    for (let i = 0; i < extras.length; i++) {
      const s = extras[i];
      if (!s || s.type === 'ship' || !(s.range > 0)) continue;
      const r = pushRec(P);
      r.e = null; r.x = s.x; r.y = s.y; r.side = SIDE_PLAYER; r.isPlayer = false; r.kind = 'extra'; r.extra = s.type;
      r.strength = s.range; r.signature = 0; r.cover = 1; r.ident = s.range;
    }
  }

  const n = P.n;
  const det = P.det;
  computeDetectionPicture(det, P.recs, n, P.recs, n);

  // Wiedza strony gracza o bytach wroga: identyfikacja z mgły wojny, KONTAKT z modelu.
  const knowList = P.knowList;
  for (let j = 0; j < knowList.length; j++) knowList[j].rec = -1;
  for (let i = 0; i < n; i++) {
    const r = P.recs[i];
    if (r.side === SIDE_PLAYER || !r.e) continue;
    const k = knowOf(P, r.e);
    k.rec = i;
    k.strength = r.strength;
    const identified = A.identified(r.e);
    const lvl = identified ? SENSOR_LEVEL.IDENTIFIED : (det.level[i] >= SENSOR_LEVEL.CONTACT ? SENSOR_LEVEL.CONTACT : SENSOR_LEVEL.NONE);
    if (lvl > 0) {
      if (lvl === SENSOR_LEVEL.IDENTIFIED) k.ident = true;
      else if (k.level === 0 && P.time - k.seenAt > 1) k.ident = false; // ponowny kontakt po zgubieniu — znów nieznany
      if (r.kind === 'station' && k.ident) k.disc = true;
      k.seenAt = P.time;
      k.sigSeen = r.signature * r.cover;
      if (lvl === SENSOR_LEVEL.IDENTIFIED) k.ang = Number(r.e.angle) || 0;   // kurs znany tylko z identyfikacji
      if (lvl === SENSOR_LEVEL.IDENTIFIED || det.by[i] < 0) {
        k.x = r.x; k.y = r.y; k.err = 0;
      } else {
        const src = P.recs[det.by[i]];
        const dx = r.x - src.x, dy = r.y - src.y;
        const o = contactOffset(k.id, P.time, Math.sqrt(dx * dx + dy * dy), det.detectR[i], src.ident, P._off);
        k.x = r.x + o.x; k.y = r.y + o.y; k.err = o.err;
      }
    }
    k.level = lvl;
  }
  // sprzątanie: byty martwe / usunięte (nie ma ich w rekordach i nie żyją), byty, które przestały być wrogiem (stacja
  // po zmianie reputacji — żywy byt wroga zawsze ma rekord, więc odkryta stacja bez rekordu nie jest już wrogiem),
  // i wygasłe duchy
  let w = 0;
  for (let j = 0; j < knowList.length; j++) {
    const k = knowList[j];
    if (k.rec < 0) k.level = 0;
    let drop = false;
    if (k.rec < 0) {
      if (!A.alive(k.e) || k.disc) drop = true;
      else {
        const side = A.sideOf(k.e);
        drop = !side || side === SIDE_PLAYER || P.time - k.seenAt >= T.ghostSec;
      }
    }
    if (drop) { k.listed = false; k.disc = false; k.level = 0; continue; }
    knowList[w++] = k;
  }
  knowList.length = w;

  // Gracz: sygnatura (z osłoną w jego miejscu), moc czujników, wykrycie.
  const pl = P.player;
  const pr = P.playerRec;
  if (pr) {
    pl.x = pr.x; pl.y = pr.y; pl.signature = pr.signature; pl.cover = pr.cover;
    pl.sigEff = pr.signature * pr.cover; pl.strength = pr.strength; pl.vision = pr.ident;
    pl.detectedTrue = det.seenBy[0];
  } else {
    pl.detectedTrue = 0;
  }

  // Strefy znanych radarów wroga przy obecnej sygnaturze gracza.
  const enemy = P.enemy;
  beginCoverage(enemy);
  let tag = 0;
  for (let j = 0; j < knowList.length; j++) {
    const k = knowList[j];
    const ks = sensorKnowState(P, k);
    if (!ks) continue;
    const est = !k.ident;
    const strength = est ? T.strengthGuess[contactSizeClass(k.sigSeen)] : k.strength;
    let info = P.enemyInfo[tag];
    if (!info) { info = { k: null, est: false, ghost: false, strength: 0 }; P.enemyInfo[tag] = info; }
    info.k = k; info.est = est; info.ghost = ks === 'ghost'; info.strength = strength;
    addCoverageCircle(enemy, k.x, k.y, strength * pl.sigEff, tag);
    tag++;
  }
  buildCoverage(enemy);

  // Własne czujniki.
  const own = P.own;
  beginCoverage(own);
  for (let i = 0; i < n; i++) {
    const r = P.recs[i];
    if (r.side !== SIDE_PLAYER) continue;
    addCoverageCircle(own, r.x, r.y, r.strength * (r.kind === 'extra' ? 1 : T.refSignature), i);
  }
  buildCoverage(own);

  if (pr) {
    pl.detectedKnown = coverageCountAt(enemy, pl.x, pl.y);
    nearestCoverageEdge(enemy, pl.x, pl.y, pl.edge);
  } else {
    pl.detectedKnown = 0;
    pl.edge.arc = -1; pl.edge.dist = Infinity; pl.edge.inside = false;
  }
  buildThreatGroups(P);
  P.version++;
  P.ready = true;
}

// ---------------------------------------------------------------- grupy zagrożeń (ocena obustronna)
// Znani wrogowie w jednym miejscu = jedna grupa. THEM = ich zasięg względem mnie (ich czujniki × moja sygnatura — mój ślad
// sygnałowy), ME = mój zasięg względem nich (moje czujniki × ich sygnatura), oba jako ułamek odległości (≥ 1 — sięga: oni
// mnie widzą / ja ich widzę). LIDER grupy = wróg o największym THEM (z histerezą threatLeadHold): z jego miejsca wychodzi w UI
// znak wroga, jego wpis wiedzy (`lead`) daje rysunkowi pozę renderu. THEM i ME grupy — najlepsi z członków (`themD` — odległość
// tego z największym THEM). Jeden znak ma każda strona: mój przy mnie,
// ich przy nich (użytkownik 2026-11-04: „wachlarz ode mnie i OD przeciwnika, a nie że ja mam dwa”).

function createThreats(cap) {
  return {
    n: 0,
    lead: new Array(cap).fill(null),
    x: new Float64Array(cap), y: new Float64Array(cap),
    ang: new Float64Array(cap), dist: new Float64Array(cap),
    them: new Float64Array(cap), me: new Float64Array(cap),
    themR: new Float64Array(cap), meR: new Float64Array(cap),
    themD: new Float64Array(cap),    // odległość członka o największym THEM (`dist` to odległość lidera)
    leadErr: new Float64Array(cap),  // błąd miejsca lidera
    est: new Uint8Array(cap), count: new Uint16Array(cap),
    // członkowie (scratch): wpis, miejsce, odległość, ułamki, zasięgi, oszacowanie, kolejność po THEM malejąco
    _k: new Array(cap).fill(null),
    _x: new Float64Array(cap), _y: new Float64Array(cap), _d: new Float64Array(cap),
    _t: new Float64Array(cap), _s: new Float64Array(cap), _m: new Float64Array(cap), _tr: new Float64Array(cap), _mr: new Float64Array(cap),
    _e: new Uint8Array(cap), _o: new Int32Array(cap),
    _g: new Int32Array(cap)
  };
}

function buildThreatGroups(P) {
  const T = P.tune;
  const pl = P.player;
  if (!P.threats || P.threats._x.length < P.knowList.length) {
    let cap = P.threats ? P.threats._x.length : 64;
    while (cap < P.knowList.length) cap *= 2;
    P.threats = createThreats(cap);
  }
  const F = P.threats;
  const prevN = F.n;
  F.n = 0;
  let m = 0;
  if (P.playerRec) {
    for (let j = 0; j < P.knowList.length; j++) {
      const k = P.knowList[j];
      const ks = sensorKnowState(P, k);
      if (ks !== 'live' && ks !== 'disc') continue;
      const dx = k.x - pl.x, dy = k.y - pl.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const est = !k.ident;
      const themR = (est ? T.strengthGuess[contactSizeClass(k.sigSeen)] : k.strength) * pl.sigEff;
      const meR = pl.strength * k.sigSeen;
      F._k[m] = k;
      F._x[m] = k.x; F._y[m] = k.y; F._d[m] = d;
      F._tr[m] = themR; F._mr[m] = meR;
      F._t[m] = themR / d; F._m[m] = meR / d;
      F._s[m] = F._t[m] * (k.wasLead ? T.threatLeadHold : 1);
      F._e[m] = est ? 1 : 0;
      F._o[m] = m;
      m++;
    }
  }
  if (m > 0) {
    // najgroźniejsi pierwsi (wstawianie — członków kilka–kilkadziesiąt): pierwszy członek grupy to jej lider i kotwica
    const o = F._o, Th = F._s;
    for (let i = 1; i < m; i++) {
      const v = o[i];
      let j = i - 1;
      while (j >= 0 && Th[o[j]] < Th[v]) { o[j + 1] = o[j]; j--; }
      o[j + 1] = v;
    }
    // grupy zachłannie od najgroźniejszych; dotychczasowy członek zostaje przy swoim liderze z szerszym promieniem
    const R = T.threatGroupRadius, stay = R * T.threatStayMul;
    let gn = 0;
    for (let q = 0; q < m; q++) {
      const i = o[q];
      const k = F._k[i];
      const ex = k.err || 0;
      let g = -1;
      for (let h = 0; h < gn; h++) {
        const dx = F._x[i] - F.x[h], dy = F._y[i] - F.y[h];
        const e = ex + F.leadErr[h];
        const rr = F.lead[h].id === k.groupLeadId ? stay + 2 * e : R + e;
        if (dx * dx + dy * dy <= rr * rr) { g = h; break; }
      }
      if (g < 0) {
        g = gn++;
        F.count[g] = 0; F.them[g] = -1; F.me[g] = -1;
        F.lead[g] = k;
        F.leadErr[g] = ex;
        F.x[g] = F._x[i]; F.y[g] = F._y[i];
        F.ang[g] = Math.atan2(F._y[i] - pl.y, F._x[i] - pl.x);
        F.dist[g] = F._d[i];
      }
      F._g[i] = g;
      F.count[g]++;
      if (F._t[i] > F.them[g]) { F.them[g] = F._t[i]; F.themR[g] = F._tr[i]; F.themD[g] = F._d[i]; F.est[g] = F._e[i]; }
      if (F._m[i] > F.me[g]) { F.me[g] = F._m[i]; F.meR[g] = F._mr[i]; }
    }
    F.n = gn;
  }
  for (let i = 0; i < m; i++) {
    F._k[i].wasLead = false;
    F._k[i].groupLeadId = F.lead[F._g[i]].id;
  }
  for (let g = 0; g < F.n; g++) F.lead[g].wasLead = true;
  // bez trzymania wpisów bytów, których już nie ma
  for (let g = F.n; g < prevN; g++) F.lead[g] = null;
  for (let i = 0; i < m; i++) F._k[i] = null;
}

/** Wpis strefy wroga koła `i` sumy `P.enemy` (także w sumach pochodnych — znacznik koła = indeks wpisu). */
export function enemyCircleInfo(P, cov, i) {
  return P.enemyInfo[cov.tag[i]] || null;
}
