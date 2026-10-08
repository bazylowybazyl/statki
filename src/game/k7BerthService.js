// src/game/k7BerthService.js
//
// AUTOMAT OBSŁUGI STANOWISK CAPITAL K-7 (2026-10-07) — gra swobodna, TYLKO OBRAZ I GAZ (sterowanie bez zmian:
// gracz nie jest przypinany, napęd zostaje jego). Część CZYSTA: bez three, DOM i Core3D (testy node).
//
// Gdy statek gracza (Atlas albo kadłub, który mieści się na stanowisku) stoi na polu stanowiska capital dowolnej
// hali K-7 (pole `capture` z createK7Layout, prędkość < `settleSpeed`, kurs zgodny z kursem stanowiska albo
// odwrotny ±`angleTol`) przez `dwell` s, obsługa podpina się jak w automacie K-7 (K7_SERVICE_DOCK — wspólna
// sekwencja K7Docking / PortDocking / fabuły): zamki pola, ramiona paliwowe SCARA nad wlewy, złączki na wlewy, rygle
// (buch pary dookoła złączek), przepływ. Gdy statek ruszy (prędkość > `releaseSpeed` albo zjedzie z pola) — AWARYJNE
// ODPIĘCIE (K7_SERVICE_RELEASE): przepływ odcięty, krótki upust, rygle szybko (buch pary), złączki w górę, ramiona
// się składają, zamki od razu. Suwnic nie ma (2026-10-07).
//
// Pozy obsługi to STAN GRY w rejestrze kolidera (`collider.registry.halls[k].poses`: berthId → poza K-7) — z nich
// rysuje hala (HaloRingGame._portVisuals → hall.update) i biorą się źródła gazu (packHallDustFrame). Właściciel
// pozy: pole `owner` — K7_POSE_OWNER.story (fabuła: StoryGame._applyHallState) albo inny niepusty znacznik =
// CUDZA poza: automat jej nie dotyka i czeka, aż właściciel ją odda (owner = null). Wtedy statek musi najpierw
// zjechać z pola (`armed`) — inaczej po ODDOKUJ fabuły przewody podpięłyby się z powrotem; poza zostawiona przez
// właściciela niezwinięta (przerwana kampania) zwija się sekwencją odpięcia. Automat pisze `owner = 'auto'`, gdy
// obsługuje stanowisko, i null w spoczynku.
//
// Czas: dt gry (pauza i sceny fabuły = 0 — obsługa stoi jak symulacja). Zero alokacji na krok.
import {
  K7_SERVICE_DOCK, K7_SERVICE_KEYS, K7_SERVICE_RELEASE, k7AngleDelta, k7ServiceConnectPose, k7ServiceDisconnectPose
} from '../3d/haloRing/haloPortK7Layout.js';
import { gameToHall, gameVecToHall, hallToGameAffine } from './hallDustInput.js';

const DEG = Math.PI / 180;

/** Znaczniki właściciela pozy obsługi (pole `owner` pozy w rejestrze hali). */
export const K7_POSE_OWNER = Object.freeze({ story: 'story', auto: 'auto' });

/** Strojenie automatu (na żywo: window.K7ServiceTune). Prędkości [j/s], czasy [s], kąty [rad]. */
export const K7_SERVICE_TUNE = {
  enabled: true,
  dwell: 2,                 // postój na polu przed podpięciem
  settleSpeed: 25,          // postój: prędkość poniżej
  settleSpin: 0.07,         // postój: obrót poniżej [rad/s]
  angleTol: 12 * DEG,       // kurs: zgodny z kursem stanowiska albo odwrotny
  releaseSpeed: 45,         // obsługiwany statek: odpięcie powyżej
  leaveMargin: 80,          // obsługiwany statek: zapas pola [j.] (bez drgania na brzegu)
  leaveAngle: 8 * DEG,      // obsługiwany statek: zapas kursu
  minLength: 1000           // kadłub krótszy nie sięga wlewów stanowiska (wlewy Atlasa: 0,395 długości od środka)
};

// Sekwencje obsługi: wspólne z K7Docking, PortDocking i fabułą (haloPortK7Layout.js).
export { K7_SERVICE_DOCK, K7_SERVICE_RELEASE };
const KEYS = K7_SERVICE_KEYS;

/** Stany automatu stanowiska. */
export const K7_SERVICE_STATE = Object.freeze({ idle: 0, settle: 1, dock: 2, docked: 3, release: 4, foreign: 5 });
export const K7_SERVICE_STATE_NAMES = Object.freeze(['idle', 'settle', 'dock', 'docked', 'release', 'foreign']);
const ST = K7_SERVICE_STATE;

/** Lampka stanowiska z automatu: 0 wolne, 1 zarezerwowane (postój na polu), 2 zajęte (obsługa). */
export const K7_SERVICE_LAMP = Object.freeze({ free: 0, reserved: 1, occupied: 2 });

/** Warunek statku na polu: 0 brak, 1 „trzyma” (obsługiwany może zostać), 2 „stoi” (postój do podpięcia). */
const COND_NONE = 0;
const COND_STAY = 1;
const COND_SETTLE = 2;

/**
 * Stan automatu dla jednego ringu (rejestr kolidera: `registry.halls` — wszystkie hale K-7 kompleksów).
 * Pozy z rejestru (te same obiekty, które rysuje hala i czyta wejście pyłu).
 */
export function createK7BerthService(registry) {
  const halls = (registry?.halls || []).map((owner) => ({
    owner,
    berths: owner.layout.berths.filter((b) => b.size === 'CAPITAL').map((b) => ({
      id: b.id,
      berth: b,
      // pole w osiach stanowiska (jak PortDocking.eligibility: halfWidth wzdłuż x układu stanowiska)
      ca: Math.cos(b.angle),
      sa: Math.sin(b.angle),
      tolAlong: Math.abs(Math.cos(b.angle)) > 0.5 ? b.capture.halfWidth : b.capture.halfLength,
      tolAcross: Math.abs(Math.cos(b.angle)) > 0.5 ? b.capture.halfLength : b.capture.halfWidth,
      state: ST.idle,
      t: 0,
      armed: true,
      from: { clamp: 0, extension: 0, seat: 0, lock: 0, flow: 0, vent: 0 },
      lamp: K7_SERVICE_LAMP.free
    }))
  }));
  return {
    halls,
    aff: { p0x: 0, p0y: 0, ax: 1, ay: 0, bx: 0, by: 1 },
    stats: { settle: 0, dock: 0, docked: 0, release: 0, foreign: 0 }
  };
}

// Statki w układzie hali (bufor modułu: najwyżej MAX_SHIPS na krok).
const MAX_SHIPS = 4;
const _sx = new Float64Array(MAX_SHIPS);
const _sz = new Float64Array(MAX_SHIPS);
const _sa = new Float64Array(MAX_SHIPS);
const _sv = new Float64Array(MAX_SHIPS);
const _sw = new Float64Array(MAX_SHIPS);
const _sl = new Float64Array(MAX_SHIPS);
const _sb = new Float64Array(MAX_SHIPS);
const _h = { x: 0, z: 0 };
const _d = { x: 0, z: 0 };

function num(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/** Odchyłka kursu statku od osi stanowiska — zgodnego albo odwrotnego [rad, 0..π/2]. */
export function k7BerthHeadingError(shipHubAngle, berthAngle) {
  const d = Math.abs(k7AngleDelta(shipHubAngle, berthAngle));
  return Math.min(d, Math.PI - d);
}

function shipCond(rec, i, T, serviced) {
  const b = rec.berth;
  const len = _sl[i];
  if (!(len <= b.maxLength && _sb[i] <= b.maxBeam && len >= T.minLength)) return COND_NONE;
  const dx = _sx[i] - b.x;
  const dz = _sz[i] - b.z;
  const along = Math.abs(dx * rec.ca + dz * rec.sa);
  const across = Math.abs(-dx * rec.sa + dz * rec.ca);
  const err = k7BerthHeadingError(_sa[i], b.angle);
  if (along <= rec.tolAlong && across <= rec.tolAcross && err <= T.angleTol
    && _sv[i] < T.settleSpeed && _sw[i] < T.settleSpin) return COND_SETTLE;
  if (!serviced) return COND_NONE;
  const m = T.leaveMargin;
  if (along <= rec.tolAlong + m && across <= rec.tolAcross + m && err <= T.angleTol + T.leaveAngle
    && _sv[i] <= T.releaseSpeed) return COND_STAY;
  return COND_NONE;
}

function isStowed(pose) {
  for (let k = 0; k < KEYS.length; k++) if (num(pose[KEYS[k]]) > 1e-4) return false;
  return true;
}

function capture(rec, pose) {
  for (let k = 0; k < KEYS.length; k++) rec.from[KEYS[k]] = Math.min(1, Math.max(0, num(pose[KEYS[k]])));
  rec.t = 0;
}

function stow(pose) {
  for (let k = 0; k < KEYS.length; k++) if (pose[KEYS[k]] !== 0) pose[KEYS[k]] = 0;
}

/** Poza podpinania w chwili t (od pozy `from` — także przerwanego odpięcia). */
export function k7ServiceDockPose(t, from, out) {
  return k7ServiceConnectPose(K7_SERVICE_DOCK, t, from, out);
}

/** Poza awaryjnego odpięcia w chwili t (od pozy `from`). Upust tylko z zaryglowanych przewodów. */
export function k7ServiceReleasePose(t, from, out) {
  return k7ServiceDisconnectPose(K7_SERVICE_RELEASE, t, from, out);
}

function setConnected(pose) {
  for (let k = 0; k < KEYS.length; k++) {
    const key = KEYS[k];
    const v = key === 'vent' ? 0 : 1;
    if (pose[key] !== v) pose[key] = v;
  }
}

/**
 * Krok automatu jednego ringu. dt — czas gry [s] (0 = stoi), place — umieszczenie ringu w grze (kolider:
 * `collider.place`), ships — statki graczy (pos, vel, angle, angVel, w, h; null / martwe pomijane), count — ile
 * z listy. Pisze pozy rejestru i `rec.lamp`; zwraca svc.stats.
 */
export function stepK7BerthService(svc, dt, place, ships, count = ships ? ships.length : 0, T = K7_SERVICE_TUNE) {
  const step = dt > 0 ? dt : 0;
  const st = svc.stats;
  st.settle = 0; st.dock = 0; st.docked = 0; st.release = 0; st.foreign = 0;
  const aff = svc.aff;
  const n0 = Math.min(MAX_SHIPS, count | 0);
  for (let hi = 0; hi < svc.halls.length; hi++) {
    const H = svc.halls[hi];
    const owner = H.owner;
    const poses = owner.poses;
    if (!poses) continue;
    // statki w układzie tej hali
    let n = 0;
    if (T.enabled && place && owner.frame) {
      hallToGameAffine(place, owner.frame, aff);
      for (let i = 0; i < n0; i++) {
        const s = ships[i];
        if (!s || s.dead || s.destroyed) continue;
        const px = num(s.pos ? s.pos.x : s.x, NaN);
        const py = num(s.pos ? s.pos.y : s.y, NaN);
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        gameToHall(aff, px, py, _h);
        const a = num(s.angle);
        gameVecToHall(aff, Math.cos(a), Math.sin(a), _d);
        _sx[n] = _h.x;
        _sz[n] = _h.z;
        _sa[n] = Math.atan2(_d.z, _d.x);
        const vx = num(s.vel ? s.vel.x : s.vx);
        const vy = num(s.vel ? s.vel.y : s.vy);
        _sv[n] = Math.sqrt(vx * vx + vy * vy);
        _sw[n] = Math.abs(num(s.angVel));
        _sl[n] = num(s.w);
        _sb[n] = num(s.h);
        n++;
      }
    }
    for (let bi = 0; bi < H.berths.length; bi++) {
      const rec = H.berths[bi];
      const pose = poses.get(rec.id);
      if (!pose) continue;
      // cudza poza (fabuła): bez zapisu; po oddaniu statek musi najpierw zjechać z pola
      if (pose.owner && pose.owner !== K7_POSE_OWNER.auto) {
        rec.state = ST.foreign;
        rec.t = 0;
        rec.armed = false;
        st.foreign++;
        continue;
      }
      if (rec.state === ST.foreign) {
        rec.state = ST.idle;
        if (!isStowed(pose)) { capture(rec, pose); rec.state = ST.release; }
      }
      const serviced = rec.state === ST.dock || rec.state === ST.docked;
      let cond = COND_NONE;
      for (let i = 0; i < n && cond < COND_SETTLE; i++) {
        const c = shipCond(rec, i, T, serviced);
        if (c > cond) cond = c;
      }
      switch (rec.state) {
        case ST.idle:
          if (cond === COND_NONE) rec.armed = true;
          else if (cond === COND_SETTLE && rec.armed) { rec.state = ST.settle; rec.t = 0; }
          break;
        case ST.settle:
          if (cond !== COND_SETTLE) { rec.state = ST.idle; rec.t = 0; break; }
          rec.t += step;
          if (rec.t >= T.dwell) { capture(rec, pose); rec.state = ST.dock; }
          break;
        case ST.dock:
          if (cond === COND_NONE) { capture(rec, pose); rec.state = ST.release; rec.armed = true; break; }
          rec.t += step;
          k7ServiceDockPose(rec.t, rec.from, pose);
          if (rec.t >= K7_SERVICE_DOCK.end) { rec.state = ST.docked; rec.t = 0; }
          break;
        case ST.docked:
          if (cond === COND_NONE) { capture(rec, pose); rec.state = ST.release; rec.armed = true; break; }
          setConnected(pose);
          break;
        default:
          break;
      }
      if (rec.state === ST.release) {
        rec.t += step;
        k7ServiceReleasePose(rec.t, rec.from, pose);
        if (rec.t >= K7_SERVICE_RELEASE.end) { rec.state = ST.idle; rec.t = 0; }
      }
      if (rec.state === ST.idle || rec.state === ST.settle) stow(pose);
      pose.owner = rec.state === ST.idle ? null : K7_POSE_OWNER.auto;
      rec.lamp = rec.state === ST.dock || rec.state === ST.docked || rec.state === ST.release ? K7_SERVICE_LAMP.occupied
        : rec.state === ST.settle ? K7_SERVICE_LAMP.reserved : K7_SERVICE_LAMP.free;
      if (rec.state === ST.settle) st.settle++;
      else if (rec.state === ST.dock) st.dock++;
      else if (rec.state === ST.docked) st.docked++;
      else if (rec.state === ST.release) st.release++;
    }
  }
  return st;
}

/**
 * Lampki stanowisk hali `hallIndex` z automatu: `berths` — stanowiska RYSOWANEJ hali (hall.layout.berths, te same
 * obiekty co `hall.berthMap`). Pomija stanowiska cudzej pozy (fabuła ustawia swoje sama). Zwraca true, gdy coś
 * zmienił — wtedy hall.setBerthLamps().
 */
export function syncK7BerthLamps(svc, hallIndex, berths) {
  const H = svc.halls[hallIndex];
  if (!H || !berths) return false;
  let changed = false;
  for (let bi = 0; bi < H.berths.length; bi++) {
    const rec = H.berths[bi];
    if (rec.state === ST.foreign) continue;
    let b = null;
    for (let j = 0; j < berths.length; j++) if (berths[j].id === rec.id) { b = berths[j]; break; }
    if (!b) continue;
    const occ = rec.lamp === K7_SERVICE_LAMP.occupied ? 'player' : null;
    const res = rec.lamp >= K7_SERVICE_LAMP.reserved ? 'player' : null;
    if (b.occupied !== occ || b.reserved !== res) { b.occupied = occ; b.reserved = res; changed = true; }
  }
  return changed;
}

/** Stan stanowiska (diagnostyka, skrypty gry): { state, t, armed, lamp } albo null. */
export function k7BerthServiceState(svc, hallIndex, berthId) {
  const rec = svc?.halls?.[hallIndex]?.berths?.find((r) => r.id === berthId);
  return rec ? { state: K7_SERVICE_STATE_NAMES[rec.state], t: rec.t, armed: rec.armed, lamp: rec.lamp } : null;
}
