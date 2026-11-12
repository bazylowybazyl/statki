// src/game/k7HallSound.js
//
// DŹWIĘKI HALI K-7 — REŻYSER (2026-11-11, prośba użytkownika: „dorobisz dźwięki do hali K7 (misja pierwsza): syk,
// maszyny, ambient, zwolnienie zacisków z maszyny, głos speakera gadający różne statusy o ringu”).
//
// Część CZYSTA (bez Web Audio, three i DOM; testy node `tests/k7HallSound.test.mjs`): co klatkę wybiera halę K-7 przy
// kamerze (jak wejście pyłu hal, `packHallDustFrame`), czyta STAN GRY hali i mówi warstwie dźwięku, co grać:
//   • tło hali (pętla bez położenia) i pompownię przy ścianie tylnej — głośność z obecności kamery w hali;
//   • pozy obsługi stanowisk capital z rejestru kolidera (`registry.halls[k].poses`: fabuła i automat stanowisk):
//     zamki pola (`clamp`) → załączenie / zwolnienie zacisków, rygle (`lock`) przez 0,5 → zapięcie złączki / buch pary
//     (te same progi co buchy pary pola gazu — `hallGasSources.js`), ruch ramion (`extension`, `seat`) → pętla serwa,
//     przepływ (`flow`) → pętla paliwa, kontrolowany upust (`vent`) → pętla syku;
//   • zawory hali (szpule na słupkach i upusty przy ścianie tylnej) wg harmonogramu `k7VentEnvelope` z zegara migania
//     hali (`HaloRingWorld.clock`) — syk w tej samej chwili co kogut i para w polu gazu;
//   • spiker hali: gong i status ringu co `annMin`…`annMax` s, komunikaty obsługi stanowiska gracza (odcumowanie,
//     zwolnienie mocowań, dokowanie) — kolejka głosów bez nakładania.
// Pierwszy odczyt hali (start, zmiana hali) tylko zapamiętuje pozy: statek zastany przypięty nie dostaje zdarzeń.
//
// Ujście (`sink`): { graj(id, x, y, glos) → bool, petla(klucz, id, glos, x, y), ostatniaDlugosc? } — `x, y` w świecie
// gry (NaN — bez położenia); `ostatniaDlugosc` [s] — długość tego, co właśnie zagrało (kolejka spikera czeka na koniec).
// Pętle podtrzymuje się wołaniem co klatkę (warstwa gasi nieodświeżone po 0,25 s). Zero alokacji na klatkę.
import { createK7Layout } from '../3d/haloRing/haloPortK7Layout.js';
import { k7LightRig, k7VentEnvelope } from '../3d/haloRing/haloPortK7Lights.js';
import { hallToGameAffine } from './hallDustInput.js';

/** Strojenie (na żywo: window.K7HallSoundTune). Odległości [j.], czasy [s]. */
export const K7_HALL_SOUND_TUNE = {
  enabled: true,
  reach: 2200,          // obecność gaśnie liniowo tyle za obrysem hali
  farView: 14000,       // pół przekątnej kadru, od której tło hali cichnie (kamera wysoko nad halą)
  farMin: 0.3,          // najmniejsza obecność z oddalenia kadru
  machines: 0.8,        // pompownia przy ścianie tylnej
  flow: 0.7,            // przepływ paliwa (× flow pozy)
  servoFull: 0.6,       // szybkość pozy ramion [1/s] dla pełnej głośności serwa
  servoMin: 0.02,       // poniżej — serwo stoi
  servoRelease: 0.18,   // wygaszanie poziomu serwa [s]
  ventReel: 0.55,       // zawór szpuli na słupku
  ventWall: 0.9,        // upust magazynu przy ścianie tylnej
  ventPose: 1,          // kontrolowany upust obsługi (poza `vent`)
  annFirst: 9,          // pierwszy status po wejściu do hali
  annMin: 40,           // odstęp statusów
  annMax: 75,
  gongLead: 1.7,        // głos po gongu
  voiceGap: 8,          // odstęp startów dwóch komunikatów, gdy warstwa nie podaje długości kwestii
  voicePad: 1.2,        // cisza po końcu kwestii (echo hali) przed następnym komunikatem
  playerBerth: 900      // gracz „na stanowisku”: kotwica bliżej środka stanowiska niż tyle
};

/** Komunikaty spikera hali (id dźwięków w tabeli DZWIEKI_HALI). */
export const K7_HALL_VOICE = Object.freeze({
  status: 'spikerStatus',
  undock: 'spikerOdcumowanie',
  clamps: 'spikerMocowania',
  docked: 'spikerDokowanie'
});

const LAYOUT = createK7Layout();
const RIG = k7LightRig(LAYOUT);
const CAPITAL = LAYOUT.berths.filter((b) => b.size === 'CAPITAL');
const NB = CAPITAL.length;
// pozy: clamp, ext, seat, lock, flow, vent
const PK = 6;
const MACHINES = Object.freeze({ x: 0, z: LAYOUT.backZ + 320 });
const FUEL_Z = 760;          // słupki paliwowe stanowiska (serviceAnchors: z + 760)
const VOICE_CAP = 6;
// opcje kolejki (stałe — bez obiektu na wywołanie)
const Q_GONG = Object.freeze({ gong: true, urgent: false });
const Q_GONG_URGENT = Object.freeze({ gong: true, urgent: true });
const Q_URGENT = Object.freeze({ gong: false, urgent: true });

function num(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * Stan reżysera. `rand` — losowość (gra: `fxRandomGame`, zasada żelazna 9).
 */
export function createK7HallSound({ rand = () => 0.5, tune = K7_HALL_SOUND_TUNE } = {}) {
  return {
    T: tune,
    rand,
    hall: 0,
    owner: null,
    aff: { p0x: 0, p0y: 0, ax: 1, ay: 0, bx: 0, by: 1 },
    presence: 0,
    prev: new Float64Array(NB * PK).fill(-1),
    servo: new Float64Array(NB),
    time: 0,
    annAt: tune.annFirst,
    // kolejka komunikatów: [id, czas] (id null — pusta)
    qId: new Array(VOICE_CAP).fill(null),
    qAt: new Float64Array(VOICE_CAP),
    nextVoiceAt: 0,
    env: { warn: 0, gas: 0, u: 0 },
    p: { x: 0, y: 0 },
    g: 0,
    stats: { events: Object.create(null), voices: 0, inside: false }
  };
}

function toGame(st, x, z, out) {
  const a = st.aff;
  out.x = a.p0x + x * a.ax + z * a.bx;
  out.y = a.p0y + x * a.ay + z * a.by;
  return out;
}

function note(st, name) {
  st.stats.events[name] = (st.stats.events[name] || 0) + 1;
}

// Głośność przez `st.g`, nie argument: helper bez wklejenia pakowałby liczbę double (alokacja na wywołanie).
function play(st, sink, id, x, z) {
  const g = st.g;
  if (!(g > 0.003)) return;
  toGame(st, x, z, st.p);
  sink.graj(id, st.p.x, st.p.y, g);
  note(st, id);
}

function loop(st, sink, key, id, x, z) {
  const g = st.g;
  if (!(g > 0.003)) return;
  toGame(st, x, z, st.p);
  sink.petla(key, id, g, st.p.x, st.p.y);
}

/** Komunikat do kolejki: `gong` — z gongiem przed głosem; `urgent` — przed statusem, który jeszcze nie zagrał. */
export function queueK7HallVoice(st, id, { gong = true, urgent = false } = {}) {
  const T = st.T;
  // status czekający w kolejce ustępuje komunikatowi obsługi
  if (urgent) {
    for (let i = 0; i < VOICE_CAP; i++) {
      if (st.qId[i] === K7_HALL_VOICE.status || st.qId[i] === 'gong') st.qId[i] = null;
    }
  }
  let t = Math.max(st.time, st.nextVoiceAt - (gong ? T.gongLead : 0));
  for (let i = 0; i < VOICE_CAP; i++) if (st.qId[i] && st.qAt[i] + T.voiceGap > t) t = Math.max(t, st.qAt[i] + (st.qId[i] === 'gong' ? T.gongLead + T.voiceGap : T.voiceGap));
  let slots = 0;
  for (let i = 0; i < VOICE_CAP; i++) if (!st.qId[i]) slots++;
  if (slots < (gong ? 2 : 1)) return false;
  if (gong) {
    for (let i = 0; i < VOICE_CAP; i++) if (!st.qId[i]) { st.qId[i] = 'gong'; st.qAt[i] = t; break; }
    t += T.gongLead;
  }
  for (let i = 0; i < VOICE_CAP; i++) if (!st.qId[i]) { st.qId[i] = id; st.qAt[i] = t; break; }
  st.nextVoiceAt = t + T.voiceGap;
  return true;
}

function resetHall(st) {
  st.prev.fill(-1);
  st.servo.fill(0);
  for (let i = 0; i < VOICE_CAP; i++) st.qId[i] = null;
  st.annAt = st.time + st.T.annFirst;
}

/**
 * Klatka reżysera. `o`: rings (HaloRingWorld.entries — pola `collider`), camX / camY (środek kadru), viewHalf (pół
 * przekątnej kadru [j.]), clock (zegar migania hal [s] — HaloRingWorld.clock), dt — czas klatki [s] (0 w pauzie),
 * paused, playerX / playerY (kotwica statku gracza; NaN — brak). Obecność 0…1 — `st.presence` (bez wartości zwracanej:
 * liczba double z funkcji bez wklejenia to alokacja na klatkę).
 */
export function stepK7HallSound(st, sink, o) {
  const T = st.T;
  const dt = Math.max(0, num(o.dt));
  st.time += dt;
  st.stats.inside = false;
  if (!T.enabled || o.paused) { st.presence = 0; return; }
  const camX = num(o.camX, NaN);
  const camY = num(o.camY, NaN);
  const rings = o.rings;
  if (!rings || !Number.isFinite(camX) || !Number.isFinite(camY)) { st.presence = 0; return; }
  // hala najbliżej kamery
  let bestD = Infinity;
  let key = 0;
  let bestOwner = null;
  const a = st.aff;
  for (let ri = 0; ri < rings.length; ri++) {
    const col = rings[ri] && rings[ri].collider;
    const halls = col && col.registry && col.registry.halls;
    if (!halls || !col.place) continue;
    for (let k = 0; k < halls.length; k++) {
      const owner = halls[k];
      if (!owner || !owner.frame) continue;
      hallToGameAffine(col.place, owner.frame, _aff);
      // gameToHall + odległość od prostokąta hali wpisane tu: wywołanie z liczbami double poza wklejeniem TurboFana
      // pakuje argumenty (alokacja na halę w każdej klatce)
      const ddx = camX - _aff.p0x;
      const ddy = camY - _aff.p0y;
      const det = _aff.ax * _aff.by - _aff.bx * _aff.ay;
      const hx = (_aff.by * ddx - _aff.bx * ddy) / det;
      const hz = (_aff.ax * ddy - _aff.ay * ddx) / det;
      const ex = Math.abs(hx) - LAYOUT.halfWidth;
      const ez = hz < LAYOUT.backZ ? LAYOUT.backZ - hz : (hz > LAYOUT.frontZ ? hz - LAYOUT.frontZ : 0);
      const exx = ex > 0 ? ex : 0;
      const d = Math.sqrt(exx * exx + ez * ez);
      if (d < bestD) {
        bestD = d;
        key = (ri + 1) * 16 + (num(owner.index, k) + 1);
        bestOwner = owner;
        a.p0x = _aff.p0x; a.p0y = _aff.p0y; a.ax = _aff.ax; a.ay = _aff.ay; a.bx = _aff.bx; a.by = _aff.by;
      }
    }
  }
  let pres = key ? Math.max(0, 1 - bestD / T.reach) : 0;
  const vh = num(o.viewHalf, 0);
  if (vh > T.farView) pres *= Math.max(T.farMin, T.farView / vh);
  if (key !== st.hall) {
    st.hall = key;
    st.owner = bestOwner;
    resetHall(st);
  }
  st.presence = pres;
  if (!(pres > 0.003)) {
    // poza halą: pozy dalej śledzone przy powrocie od nowa (bez zdarzeń za stan zastany)
    st.prev.fill(-1);
    return;
  }
  st.stats.inside = bestD <= 0;

  // --- tło i pompownia
  sink.petla('hala:tlo', 'halaTlo', pres, NaN, NaN);
  st.g = pres * T.machines;
  loop(st, sink, 'hala:maszyny', 'halaMaszyny', MACHINES.x, MACHINES.z);

  // --- gracz na stanowisku? (komunikaty obsługi tylko dla jego stanowiska)
  let playerBerth = -1;
  const px = num(o.playerX, NaN);
  const py = num(o.playerY, NaN);
  if (Number.isFinite(px) && Number.isFinite(py)) {
    const ddx = px - a.p0x;
    const ddy = py - a.p0y;
    const det = a.ax * a.by - a.bx * a.ay;
    const hx = (a.by * ddx - a.bx * ddy) / det;
    const hz = (a.ax * ddy - a.ay * ddx) / det;
    let best = T.playerBerth;
    for (let i = 0; i < NB; i++) {
      const b = CAPITAL[i];
      const dx = hx - b.x;
      const dz = hz - b.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < best) { best = d; playerBerth = i; }
    }
  }

  // --- pozy obsługi stanowisk capital
  const poses = bestOwner && bestOwner.poses;
  const getPose = poses && typeof poses.get === 'function';
  for (let i = 0; i < NB; i++) {
    const b = CAPITAL[i];
    const p = getPose ? poses.get(b.id) : null;
    const clamp = p ? num(p.clamp) : 0;
    const ext = p ? num(p.extension) : 0;
    const seat = p ? num(p.seat) : 0;
    const lock = p ? num(p.lock) : 0;
    const flow = p ? num(p.flow) : 0;
    const vent = p ? num(p.vent) : 0;
    const o6 = i * PK;
    const P = st.prev;
    const fx = b.x;
    const fz = b.z + FUEL_Z;
    if (P[o6] >= 0) {
      const pc = P[o6], pe = P[o6 + 1], ps = P[o6 + 2], pl = P[o6 + 3], pf = P[o6 + 4];
      // zamki pola: start zwalniania / załączania (dźwięk z ruchem, nie po nim)
      if (pc >= 0.98 && clamp < 0.98) {
        st.g = pres;
        play(st, sink, 'zaciskiZwolnienie', b.x, b.z);
        if (i === playerBerth) { queueK7HallVoice(st, K7_HALL_VOICE.clamps, Q_URGENT); note(st, 'voice:clamps'); }
      } else if (pc <= 0.02 && clamp > 0.02) {
        st.g = pres;
        play(st, sink, 'zaciskiZalaczenie', b.x, b.z);
      }
      // rygle złączek: te same progi co buchy pary w polu gazu (hallGasSources.js)
      if (pl >= 0.5 && lock < 0.5 && seat > 0.4) { st.g = pres; play(st, sink, 'buchPary', fx, fz); }
      else if (pl < 0.5 && lock >= 0.5 && seat > 0.8) { st.g = pres; play(st, sink, 'zlaczeZapiecie', fx, fz); }
      // przepływ: odcięcie = początek odcumowania; pełny po podpięciu = koniec dokowania
      if (i === playerBerth) {
        if (pf >= 0.98 && flow < 0.98) { queueK7HallVoice(st, K7_HALL_VOICE.undock, Q_GONG_URGENT); note(st, 'voice:undock'); }
        else if (pf < 0.98 && flow >= 0.98) { queueK7HallVoice(st, K7_HALL_VOICE.docked, Q_GONG_URGENT); note(st, 'voice:docked'); }
      }
      // ramiona: szybkość pozy → poziom serwa (wygaszany)
      if (dt > 0) {
        const rate = (Math.abs(ext - pe) + Math.abs(seat - ps)) / dt;
        const target = rate > T.servoMin ? Math.min(1, rate / T.servoFull) : 0;
        const decay = Math.exp(-dt / T.servoRelease);
        st.servo[i] = Math.max(target, st.servo[i] * decay);
      }
    }
    P[o6] = clamp; P[o6 + 1] = ext; P[o6 + 2] = seat; P[o6 + 3] = lock; P[o6 + 4] = flow; P[o6 + 5] = vent;
    if (st.servo[i] > 0.01) { st.g = pres * st.servo[i]; loop(st, sink, SERVO_KEYS[i], 'serwo', fx, fz); }
    if (flow > 0.05) { st.g = pres * T.flow * Math.min(1, flow); loop(st, sink, FLOW_KEYS[i], 'przeplyw', fx, fz); }
    if (vent > 0.01) { st.g = pres * T.ventPose * Math.min(1, vent); loop(st, sink, PURGE_KEYS[i], 'syk', fx, fz); }
  }

  // --- zawory hali wg harmonogramu (kogut i para w tej samej fazie)
  const clock = num(o.clock);
  const env = st.env;
  for (let v = 0; v < RIG.vents.length; v++) {
    const vt = RIG.vents[v];
    k7VentEnvelope(clock, vt.phase, vt.period, env);
    if (env.gas > 0.01) { st.g = pres * env.gas * (vt.kind === 'wall' ? T.ventWall : T.ventReel); loop(st, sink, VENT_KEYS[v], 'syk', vt.x, vt.z); }
  }

  // --- spiker: statusy ringu (w hali), kolejka komunikatów
  if (bestD <= 0 && st.time >= st.annAt) {
    queueK7HallVoice(st, K7_HALL_VOICE.status, Q_GONG);
    st.annAt = st.time + T.annMin + (T.annMax - T.annMin) * st.rand();
  }
  for (let i = 0; i < VOICE_CAP; i++) {
    const id = st.qId[i];
    if (!id || st.qAt[i] > st.time) continue;
    st.qId[i] = null;
    const ok = sink.graj(id, NaN, NaN, pres);
    note(st, id);
    if (id === 'gong') continue;
    st.stats.voices++;
    // kwestie mają 4–11 s: kolejka rusza po końcu tej, która właśnie zagrała (warstwa podaje długość)
    const len = ok === false ? 0 : num(sink.ostatniaDlugosc, 0);
    if (len > 0) holdVoiceQueue(st, st.time + len + T.voicePad);
  }
}

/** Komunikaty w kolejce nie zaczną się przed `end` (przesunięcie całej kolejki — gong zostaje przed swoim głosem). */
function holdVoiceQueue(st, end) {
  let first = Infinity;
  for (let i = 0; i < VOICE_CAP; i++) if (st.qId[i] && st.qAt[i] < first) first = st.qAt[i];
  const shift = first < end ? end - first : 0;
  if (shift > 0) for (let i = 0; i < VOICE_CAP; i++) if (st.qId[i]) st.qAt[i] += shift;
  if (end > st.nextVoiceAt) st.nextVoiceAt = end;
}

const _aff = { p0x: 0, p0y: 0, ax: 1, ay: 0, bx: 0, by: 1 };
const SERVO_KEYS = CAPITAL.map((b) => `hala:serwo:${b.id}`);
const FLOW_KEYS = CAPITAL.map((b) => `hala:przeplyw:${b.id}`);
const PURGE_KEYS = CAPITAL.map((b) => `hala:upust:${b.id}`);
const VENT_KEYS = RIG.vents.map((v) => `hala:zawor:${v.id}`);

/** Na potrzeby testów: stanowiska capital hali (kolejność slotów reżysera) i zawory. */
export const K7_HALL_SOUND_LAYOUT = Object.freeze({ berths: CAPITAL, vents: RIG.vents, machines: MACHINES, fuelZ: FUEL_Z });
