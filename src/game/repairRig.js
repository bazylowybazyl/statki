// src/game/repairRig.js
//
// RÓJ DRONÓW NAPRAWCZYCH OKRĘTU — logika (decyzje użytkownika 2026-10-08 w src/data/repairDrones.js). Bez three i DOM,
// bez Math.random, krok w CZASIE GRY (physicsStep; pauza i sceny fabuły — stoi). Render czyta stan dronów
// (src/3d/repair/repairDrones3D.js), gra podpina trafienia i HUD (index.html, rejestr src/game/repairSwarm.js).
//
// NOSICIEL i CEL osobno: drony startują z doku nosiciela (grzbiet kadłuba), materiał biorą z JEGO ładowni (`cargo` —
// zwykły worek { scrap, steel, hull_plate }), naprawiają CEL (domyślnie nosiciel; holownik serwisowy — gracza).
//
// PLAN (co planInterval): skan celu — HullBodies.repairNeeds (wgniecenia, otwarte szwy, HP), front odrostu
// (regrowCandidates) i gniazda broni z gry (env.sockets). Kolejność pracy (klasy): 0 — wgniecenia przy dziurze, front
// odrostu i gniazda (komórka przy wgnieceniu nie wchodzi do frontu, dopóki dron jej nie wyprostuje — lokalnie prostowanie
// idzie przed odrostem), 1 — pozostałe wgniecenia, 2 — samo HP. Wolny dron bierze najbliższe zadanie najwyższej klasy,
// co najmniej spacingCells od pracy innych dronów (gdy się da; prostowanie — straightenRadius · 2 + 1, obszary bez
// nakładania).
// ZADANIA:
//   • PROSTOWANIE komórki: dron nad komórką, co krok HullBodies.straightenAt (kwadrat ±straightenRadius) do skutku;
//   • ODROST komórki (łata): dron niesie płytę, spawa weldTime, materiał zdejmuje NA POCZĄTKU spawania (1 komórka;
//     jednostka ładowni → cellsPerUnit komórek w zapasie rigu), na końcu: wolne miejsce (env.cellBlocked — wrak odciętej
//     sekcji obok) → HullBodies.regrowCell(…, { hpMul: patchHpMul, patch: true }) → env.onCellRegrown (mapa ran: łata
//     czyści lej i osmalenie komórki);
//   • GNIAZDO broni (env.sockets / env.restoreSocket — gra: gniazdo nad żywą komórką wraca, broń tylko z inwentarza).
// PUNKTY KADŁUBA („HP wraca tyle, ile naprawiono”): praca do zrobienia = martwe komórki szablonu + brak HP żywych węzłów
// (w węzłach, hullRepairNeedsResult); każda wykonana jednostka pracy oddaje punkty proporcjonalnie: brak punktów do
// celu × jednostka / pozostała praca. Cel = maks. × (1 − (1 − patchHpMul) · udział łat po naprawie) — po pełnej naprawie
// łaty są warte patchHpMul węzła (Atlas z 16% łat: ~97,5% punktów, reszta w doku). Odrost dokłada sam różnicę sufitów
// konstrukcji × patchHpMul (hak gry HullBodies.onRegrow — raiseHullHpForRegrowth z wartością węzła), więc rig dopełnia
// tylko lukę ponad to, co hak dołoży za resztę martwych komórek — suma kończy dokładnie na celu; sufit konstrukcji
// (hullIntegrity.js) pilnuje, żeby punkty nie wyprzedzały odrostu. Bez punktów za pracę ciężka broń (krater na miarę
// rany: węzły giną bez zdejmowania HP sąsiadom) zostawiała okręt po pełnej naprawie z połową punktów.
// LOT w układzie CELU (współrzędne względem kotwicy encji, obrócone o jej kąt): kadłub w nim stoi, więc dron sam
// dopasowuje ruch i obrót okrętu, przy pracy jest PRZYKLEJONY do komórki. Powrót do doku — w układzie nosiciela.
// Koniec pracy, brak materiału (gdy nie ma już nic do prostowania) i drugie R — powrót; bez wycofania pod ostrzałem.
// TRAFIENIA (rozgrywka, CPU): hitSegment (pocisk / wiązka — odcinek × koło drona), blast (wybuch), damageDrone.

import { HullBodies, REPAIR_NEED, hullRepairNeedsResult } from './hullBodies.js';
import { REPAIR_TUNE, REPAIR_MATERIALS, repairMaterialCells } from '../data/repairDrones.js';
import { hullIntegrityExponent, hullIntegrityCapFrac } from './hullIntegrity.js';

export const DRONE_STATE = Object.freeze({ DOCKED: 0, FLY: 1, WORK: 2, RETURN: 3, DEAD: 4 });
export const REPAIR_JOB = Object.freeze({ NONE: 0, STRAIGHTEN: 1, REGROW: 2, SOCKET: 3 });
/** Zdarzenia dla obrazu (pierścień `fx`). */
export const REPAIR_FX = Object.freeze({ REGROWN: 1, DRONE_LOST: 2, LAUNCH: 3, DOCK: 4, SOCKET: 5, WELD_START: 6 });
/** Komunikaty (rig.onMessage(tekst, rodzaj)). */
export const REPAIR_MSG = Object.freeze({
  LAUNCH: 'launch', DONE: 'done', NO_MATERIAL: 'material', LOST: 'lost', NO_DRONES: 'nodrones', NOTHING: 'nothing',
  RECALL: 'recall'
});

const FX_CAP = 64;
const MSG_CAP = 6;
const SOCKET_KEY_BASE = 1e7;   // klucz zadania gniazda = baza + numer gniazda z gry (komórki < baza)

function entX(e) { return (e?.pos && typeof e.pos.x === 'number') ? e.pos.x : (Number(e?.x) || 0); }
function entY(e) { return (e?.pos && typeof e.pos.y === 'number') ? e.pos.y : (Number(e?.y) || 0); }
function wrapAngle(a) { return a - Math.round(a / (Math.PI * 2)) * Math.PI * 2; }

function entityAlive(e) {
  return !!e && !e.dead && !e.destroyed && !e.isWreck;
}

/** Długość kadłuba [j.] (dok, zasięg). */
export function repairHullLength(e) {
  const h = e?.beamHull;
  if (h && h.entity === e) return Math.max(h.srcWidth, h.srcHeight) * h.scale;
  return Math.max(Number(e?.w) || 0, Number(e?.h) || 0, Number(e?.radius) * 2 || 0, 200);
}

function makeDrone(index) {
  return {
    index,
    state: DRONE_STATE.DOCKED,
    hp: 0,
    frame: 0,              // 0 — układ celu, 1 — układ nosiciela
    lx: 0, ly: 0, lz: 0,   // pozycja w układzie (j., z — wysokość nad płaszczyzną)
    vx: 0, vy: 0, vz: 0,
    yaw: 0,                // kurs w układzie
    wx: 0, wy: 0, wz: 0,   // świat gry (po kroku)
    wyaw: 0,
    launchAt: 0,
    // zadanie
    job: REPAIR_JOB.NONE,
    jobIx: 0, jobIy: 0, jobKey: -1,
    jobLx: 0, jobLy: 0, jobYaw: 0,
    jobT: 0, jobTimer: 0, jobPaid: false, jobSocket: -1,
    // obraz
    plate: 0, weld: 0, arm: 0, thrust: 0, hitT: -1e9,
    weldX: 0, weldY: 0
  };
}

/**
 * Rig dronów jednego nosiciela.
 * @param {object} o
 * @param {object} o.carrier nosiciel (encja z kadłubem belkowym)
 * @param {object} [o.cargo] ładownia nosiciela — worek { scrap, steel, hull_plate } (gracz: PLAYER.cargo)
 * @param {number} [o.drones] liczba dronów (repairDroneCountFor)
 * @param {object} [o.tune] strojenie (domyślnie REPAIR_TUNE = window.RepairTune — czytane co krok)
 * @param {object} [o.dock] dok: { along, side, z } (× długość / szerokość kadłuba; z w j.)
 * @param {object} [o.env] haki gry: cellBlocked(cel, x, y, r), healPoints(cel, punkty) → przyrost, sockets(cel, out),
 *   restoreSocket(cel, klucz) → bool, onCellRegrown(cel, ix, iy, x, y), onDroneLost(rig, dron), friendly(nosiciel)
 */
export class RepairRig {
  constructor({ carrier = null, cargo = null, drones = 0, tune = null, dock = null, env = null } = {}) {
    this.carrier = carrier;
    this.target = carrier;
    this.cargo = cargo || {};
    this.tune = tune || REPAIR_TUNE;
    this.env = env || {};
    this.dock = { along: dock?.along ?? null, side: dock?.side ?? null, z: dock?.z ?? null };
    this.drones = [];
    this.setDroneCount(drones);
    this.launched = false;      // drony wypuszczone (R), do powrotu wszystkich
    this.recalling = false;     // powrót (drugie R, koniec pracy, brak materiału)
    this.material = 0;          // zapas komórek po rozpakowaniu jednostki ładowni
    this.time = 0;
    this.friendly = true;       // strona nosiciela (trafienia: bez ognia własnej strony)
    this._planT = 0;
    this._noMaterial = false;
    this._nothingLeft = false;
    this._cooled = 0;           // kandydaci pominięci w ostatnim planie (pauza komórki)
    this._idleT = 0;            // czas bez zadań (koniec pracy — po pauzach komórek)
    // Kandydaci planu: [rodzaj, ix, iy, klasa, lx, ly, klucz] × n (tablica liczb, długość czyszczona).
    this._jobs = [];
    this._jobN = 0;
    this._needs = [];
    this._front = [];
    this._sockets = [];
    this._cool = new Map();     // klucz komórki → czas końca pauzy
    this._cellW = 0;            // szerokość siatki celu (klucz komórki = ix + iy · W)
    this._work = 0;             // pozostała praca (martwe komórki szablonu + komórki do prostowania + gniazda)
    this._workMax = 0;
    this._units = 0;            // praca do punktów: martwe komórki + brak HP żywych węzłów [węzły]
    this._patchedAfter = 0;     // łaty po naprawie (żywe łaty + martwe komórki) — cel punktów
    // Obwiednia dronów w powietrzu (świat gry) — szybkie odrzucenie pocisków.
    this.out = 0;
    this.minX = 0; this.minY = 0; this.maxX = 0; this.maxY = 0;
    this.stats = {
      alive: 0, total: 0, out: 0, working: 0, materialCells: 0, progress: 1,
      cellsRegrown: 0, hpRestored: 0, pointsRestored: 0, sockets: 0, dronesLost: 0, straightenJobs: 0, straightenTimeouts: 0,
      used: { scrap: 0, steel: 0, hull_plate: 0 }
    };
    // Pierścienie dla obrazu i HUD-u.
    this.fx = [];
    for (let i = 0; i < FX_CAP; i++) this.fx.push({ kind: 0, x: 0, y: 0, z: 0, a: 0, drone: -1, t: 0 });
    this.fxWrite = 0;
    this.messages = [];
    for (let i = 0; i < MSG_CAP; i++) this.messages.push({ text: '', kind: '', t: -1e9 });
    this.messageWrite = 0;
    this.onMessage = null;
    this._hit = { index: -1, t: 0, x: 0, y: 0 };
  }

  // ------------------------------------------------------------------ sterowanie

  /** Liczba dronów (dok: uzupełnienie dokłada brakujące / przywraca zestrzelone — żywe w doku). */
  setDroneCount(n) {
    const count = Math.max(0, Math.floor(Number(n) || 0));
    while (this.drones.length < count) {
      const d = makeDrone(this.drones.length);
      d.hp = this.tune.droneHp;
      this.drones.push(d);
    }
    if (this.drones.length > count) this.drones.length = count;
    return count;
  }

  /** Uzupełnienie w doku: zestrzelone drony wracają do doku z pełnym HP. Zwraca liczbę uzupełnionych. */
  refill(max = Infinity) {
    let n = 0;
    for (const d of this.drones) {
      if (n >= max) break;
      if (d.state === DRONE_STATE.DEAD) {
        d.state = DRONE_STATE.DOCKED;
        d.hp = this.tune.droneHp;
        n++;
      } else if (d.state === DRONE_STATE.DOCKED) {
        d.hp = this.tune.droneHp;
      }
    }
    return n;
  }

  /** Zestrzelone drony (do uzupełnienia w doku). */
  missing() {
    let n = 0;
    for (const d of this.drones) if (d.state === DRONE_STATE.DEAD) n++;
    return n;
  }

  /** Cel naprawy (domyślnie nosiciel). Zmiana celu — drony porzucają zadania i planują od nowa. */
  setTarget(entity) {
    const next = entity || this.carrier;
    if (next === this.target) return;
    // Drony w powietrzu przechodzą do układu nowego celu.
    for (const d of this.drones) {
      if (d.state === DRONE_STATE.FLY || d.state === DRONE_STATE.WORK) {
        this._dropJob(d);
        d.state = DRONE_STATE.FLY;
        this._toFrameEntity(d, next, 0);
      }
    }
    this.target = next;
    this._cool.clear();
    this._workMax = 0;
    this._planT = 0;
  }

  /** R: wypuść drony (zwraca, czy wystartowały). */
  launch() {
    if (this.launched && !this.recalling) return true;
    if (!entityAlive(this.carrier) || !HullBodies.hasHull(this.target)) return false;
    let docked = 0;
    for (const d of this.drones) if (d.state === DRONE_STATE.DOCKED) docked++;
    const flying = this.drones.some((d) => d.state === DRONE_STATE.FLY || d.state === DRONE_STATE.WORK || d.state === DRONE_STATE.RETURN);
    if (docked === 0 && !flying) {
      this._say(this.drones.length ? 'DRONY NAPRAWCZE: WSZYSTKIE ZNISZCZONE — UZUPEŁNIJ W DOKU' : 'BRAK DRONÓW NAPRAWCZYCH', REPAIR_MSG.NO_DRONES);
      return false;
    }
    this._noMaterial = false;
    this._nothingLeft = false;
    this._plan();
    if (this._jobN === 0) {
      if (this._front.length > 0 && this.materialCells() <= 0) {
        this._say('NAPRAWA: BRAK MATERIAŁU (złom, stal, płyty kadłubowe w ładowni)', REPAIR_MSG.NO_MATERIAL);
      } else if (this._cooled > 0) {
        this._say('NAPRAWA: MIEJSCE ZAJĘTE — SPRÓBUJ ZA CHWILĘ', REPAIR_MSG.NOTHING);
      } else {
        this._say('NAPRAWA: KADŁUB SPRAWNY', REPAIR_MSG.NOTHING);
      }
      return false;
    }
    this.launched = true;
    this.recalling = false;
    this._workMax = this._work;
    let k = 0;
    for (const d of this.drones) {
      if (d.state === DRONE_STATE.DOCKED) {
        d.launchAt = this.time + k * this.tune.launchInterval;
        d.hp = d.hp > 0 ? d.hp : this.tune.droneHp;
        k++;
      } else if (d.state === DRONE_STATE.RETURN) {
        d.state = DRONE_STATE.FLY;     // wracające zawracają do pracy
        this._toFrameEntity(d, this.target, 0);
      }
    }
    this._say(`DRONY NAPRAWCZE: START (${this.aliveCount()})`, REPAIR_MSG.LAUNCH);
    return true;
  }

  /** R drugi raz: wszystkie drony wracają do doku (spawanie w toku przepada razem z materiałem komórki). */
  recall(reason = 'recall') {
    if (!this.launched) return false;
    this.recalling = true;
    for (const d of this.drones) {
      if (d.state === DRONE_STATE.FLY || d.state === DRONE_STATE.WORK) {
        this._dropJob(d);
        this._beginReturn(d);
      }
    }
    if (reason === 'recall') this._say('DRONY NAPRAWCZE: POWRÓT', REPAIR_MSG.RECALL);
    return true;
  }

  /** Wszystkie drony od razu w doku (dok stacji, nosiciel w hangarze) — bez lotu powrotnego. */
  dockAll() {
    for (const d of this.drones) {
      if (d.state === DRONE_STATE.FLY || d.state === DRONE_STATE.WORK || d.state === DRONE_STATE.RETURN) {
        this._dropJob(d);
        d.state = DRONE_STATE.DOCKED;
        d.plate = 0; d.weld = 0; d.arm = 0; d.thrust = 0;
      }
      if (d.state === DRONE_STATE.DOCKED) d.launchAt = Infinity;
    }
    this.launched = false;
    this.recalling = false;
    this._updateStats();
  }

  /** R: przełącznik (start / powrót). */
  toggle() {
    if (this.launched && !this.recalling) { this.recall(); return false; }
    return this.launch();
  }

  /** Drony pracują (są poza dokiem). */
  get active() {
    return this.launched;
  }

  aliveCount() {
    let n = 0;
    for (const d of this.drones) if (d.state !== DRONE_STATE.DEAD) n++;
    return n;
  }

  /** Komórki materiału: zapas rigu + ładownia nosiciela. */
  materialCells() {
    return Math.floor(this.material) + repairMaterialCells(this.cargo, this.tune);
  }

  // ------------------------------------------------------------------ krok

  step(dt) {
    if (!(dt > 0)) return;
    this.time += dt;
    const T = this.tune;
    if (!entityAlive(this.carrier)) {
      // Nosiciel zniszczony — drony w powietrzu nie mają domu (giną z nim).
      for (const d of this.drones) {
        if (d.state !== DRONE_STATE.DEAD && d.state !== DRONE_STATE.DOCKED) this._killDrone(d, false);
        else if (d.state === DRONE_STATE.DOCKED) d.state = DRONE_STATE.DEAD;
      }
      this.launched = false;
      this.recalling = false;
      this._updateStats();
      return;
    }
    if (this.target !== this.carrier && !HullBodies.hasHull(this.target)) this.setTarget(this.carrier);
    if (typeof this.env.friendly === 'function') this.friendly = !!this.env.friendly(this.carrier);
    if (this.launched && !this.recalling) {
      this._planT -= dt;
      if (this._planT <= 0) {
        this._plan();
        this._planT = T.planInterval;
      }
    }
    let busy = 0;
    for (const d of this.drones) {
      if (d.state === DRONE_STATE.DEAD) continue;
      this._stepDrone(d, dt);
      if (d.state === DRONE_STATE.FLY || d.state === DRONE_STATE.WORK || d.state === DRONE_STATE.RETURN) busy++;
    }
    // Koniec: nic do roboty i nikt nie pracuje → powrót; wszystkie w doku → rig nieaktywny.
    if (this.launched && !this.recalling) {
      let working = 0, pending = 0;
      for (const d of this.drones) {
        if (d.state === DRONE_STATE.WORK || (d.state === DRONE_STATE.FLY && d.job !== REPAIR_JOB.NONE)) working++;
        if (d.state === DRONE_STATE.DOCKED && d.launchAt > this.time) pending++;
      }
      this._idleT = (working === 0 && pending === 0 && this._liveJobs() === 0) ? this._idleT + dt : 0;
      // Komórki w pauzie (zajęte miejsce, świeżo prostowane) — drony czekają, aż pauza minie i plan spróbuje znowu.
      const wait = this._cooled > 0 ? T.blockedCooldown + T.planInterval * 2 : T.planInterval;
      if (this._idleT > wait) {
        const regrowLeft = this._noMaterial && this._work > 0;
        this._say(regrowLeft ? 'NAPRAWA: BRAK MATERIAŁU — DRONY WRACAJĄ' : 'NAPRAWA KADŁUBA ZAKOŃCZONA — DRONY WRACAJĄ',
          regrowLeft ? REPAIR_MSG.NO_MATERIAL : REPAIR_MSG.DONE);
        this.recall('done');
      }
    }
    if (this.launched && this.recalling && busy === 0) {
      let anyOut = false;
      for (const d of this.drones) if (d.state === DRONE_STATE.FLY || d.state === DRONE_STATE.WORK || d.state === DRONE_STATE.RETURN) anyOut = true;
      if (!anyOut) {
        this.launched = false;
        this.recalling = false;
        for (const d of this.drones) if (d.state === DRONE_STATE.DOCKED) d.launchAt = 0;
      }
    }
    this._updateStats();
  }

  // ------------------------------------------------------------------ plan

  _plan() {
    const e = this.target;
    const T = this.tune;
    const jobs = this._jobs;
    jobs.length = 0;
    this._jobN = 0;
    this._cooled = 0;
    const hull = e?.beamHull;
    if (!hull || hull.entity !== e || !HullBodies.hasHull(e)) { this._work = 0; return; }
    this._cellW = hull.body.dims.x;
    const W = this._cellW;
    const now = this.time;
    const pose = this._pose(e, _pose);
    // Wgniecenia, szwy, HP.
    const needs = this._needs;
    const nNeeds = HullBodies.repairNeeds(e, needs, { patchHpMul: T.patchHpMul });
    for (let k = 0; k < needs.length; k += 3) {
      const ix = needs[k], iy = needs[k + 1], f = needs[k + 2];
      const key = ix + iy * W;
      if (this._cooling(key, now)) continue;
      const cls = (f & REPAIR_NEED.BLOCKING) ? 0 : ((f & REPAIR_NEED.DENT) ? 1 : 2);
      this._pushJob(e, pose, REPAIR_JOB.STRAIGHTEN, ix, iy, cls, key);
    }
    // Front odrostu (tylko z materiałem).
    const front = this._front;
    const nFront = HullBodies.regrowCandidates(e, front);
    const material = this.material >= 1 || repairMaterialCells(this.cargo, T) > 0;
    if (!material && nFront > 0 && this.launched && !this._noMaterial) {
      this._noMaterial = true;
      this._say('NAPRAWA: BRAK MATERIAŁU (złom, stal, płyty kadłubowe w ładowni)', REPAIR_MSG.NO_MATERIAL);
    }
    if (material) {
      this._noMaterial = false;
      for (let k = 0; k < front.length; k += 2) {
        const ix = front[k], iy = front[k + 1];
        const key = ix + iy * W;
        if (this._cooling(key, now)) continue;
        this._pushJob(e, pose, REPAIR_JOB.REGROW, ix, iy, 0, key);
      }
    }
    // Gniazda broni (gra).
    let nSockets = 0;
    if (typeof this.env.sockets === 'function') {
      const out = this._sockets;
      out.length = 0;
      this.env.sockets(e, out);
      for (let k = 0; k < out.length; k++) {
        const s = out[k];
        if (!s) continue;
        const key = SOCKET_KEY_BASE + (s.key | 0);
        if (this._cooling(key, now)) continue;
        nSockets++;
        this._pushJobWorld(pose, REPAIR_JOB.SOCKET, s.key | 0, 0, 0, key, s.x, s.y);
      }
    }
    const R = hullRepairNeedsResult;
    this._work = R.dead + nNeeds + nSockets;
    if (this._work > this._workMax) this._workMax = this._work;
    this._units = R.dead + R.hpUnits;
    this._patchedAfter = R.patched + R.dead;
    void nFront;
  }

  // Punkty kadłuba za jednostki pracy (opis w nagłówku).
  _credit(units) {
    if (!(units > 0)) return;
    const e = this.target;
    const rem = Math.max(units, this._units);
    const target = this._pointsTarget(e);
    const val = pointsOf(e);
    const gap = target - val - this._regrowPointsLeft(e);
    if (gap > 0) {
      const gain = gap * Math.min(1, units / rem);
      const got = typeof this.env.healPoints === 'function' ? this.env.healPoints(e, gain) : defaultHealPoints(e, gain);
      this.stats.pointsRestored += Number(got) || 0;
    }
    this._units = Math.max(0, this._units - units);
  }

  // Punkty, które dołoży sam odrost reszty martwych komórek (hak gry HullBodies.onRegrow = raiseHullHpForRegrowth:
  // różnica sufitów konstrukcji do pełnego udziału × wartość łaty); bez haka — 0.
  _regrowPointsLeft(e) {
    if (typeof HullBodies.onRegrow !== 'function') return 0;
    const st = HullBodies.structuralState(e, _struct);
    if (!st || st.ratio >= 1) return 0;
    const max = e?.hull && Number(e.hull.max) > 0 ? Number(e.hull.max) : Math.max(1, Number(e?.maxHp) || Number(e?.hp) || 1);
    return max * (1 - hullIntegrityCapFrac(st.ratio, hullIntegrityExponent(e))) * this.tune.patchHpMul;
  }

  _pointsTarget(e) {
    const h = e?.beamHull;
    const base = Math.max(1, h ? h.baseNodes : 1);
    const frac = 1 - (1 - this.tune.patchHpMul) * Math.min(1, this._patchedAfter / base);
    const max = e?.hull && Number(e.hull.max) > 0 ? Number(e.hull.max) : Math.max(1, Number(e?.maxHp) || Number(e?.hp) || 1);
    return max * frac;
  }

  _liveJobs() {
    let n = 0;
    const material = this.material >= 1 || repairMaterialCells(this.cargo, this.tune) > 0;
    for (let j = 0; j < this._jobN; j++) {
      const kind = this._jobs[j * 7];
      if (kind === REPAIR_JOB.NONE || (kind === REPAIR_JOB.REGROW && !material)) continue;
      n++;
    }
    return n;
  }

  _cooling(key, now) {
    const until = this._cool.get(key);
    if (until === undefined) return false;
    if (until > now) { this._cooled++; return true; }
    this._cool.delete(key);
    return false;
  }

  _pushJob(e, pose, kind, ix, iy, cls, key) {
    const w = HullBodies.cellWorld(e, ix, iy, _cellWorld);
    if (!w) return;
    this._pushJobWorld(pose, kind, ix, iy, cls, key, w.x, w.y);
  }

  _pushJobWorld(pose, kind, ix, iy, cls, key, wx, wy) {
    const dx = wx - pose.x, dy = wy - pose.y;
    const lx = pose.c * dx + pose.s * dy;
    const ly = -pose.s * dx + pose.c * dy;
    this._jobs.push(kind, ix, iy, cls, lx, ly, key);
    this._jobN++;
  }

  // Najlepsze wolne zadanie dla drona (indeks rekordu w _jobs albo −1): najwyższa dostępna klasa (kolejność pracy ściśle),
  // w niej najbliższe zadanie co najmniej spacingCells od pracy innych dronów, a gdy takiego nie ma — najbliższe w klasie.
  _pickJob(d) {
    const jobs = this._jobs, n = this._jobN, T = this.tune;
    if (n === 0) return -1;
    const material = this.material >= 1 || repairMaterialCells(this.cargo, T) > 0;
    const cs = this._cellSize();
    const spacing = T.spacingCells * cs;
    const sp2 = spacing * spacing;
    // Obszary prostowania (kwadrat ±r) bez nakładania — sąsiednie drony nie ciągną tych samych węzłów.
    const spS = Math.max(T.spacingCells, T.straightenRadius * 2 + 1) * cs;
    const sp2S = spS * spS;
    let bestFree = -1, bestFreeScore = Infinity, bestAny = -1, bestAnyScore = Infinity;
    for (let j = 0; j < n; j++) {
      const o = j * 7;
      const kind = jobs[o], key = jobs[o + 6];
      if (kind === REPAIR_JOB.NONE) continue;
      if (kind === REPAIR_JOB.REGROW && !material) continue;
      if (this._claimed(key, d)) continue;
      const lx = jobs[o + 4], ly = jobs[o + 5];
      const dx = lx - d.lx, dy = ly - d.ly;
      const score = jobs[o + 3] * 1e9 + Math.sqrt(dx * dx + dy * dy);
      if (score < bestAnyScore) { bestAnyScore = score; bestAny = j; }
      if (score < bestFreeScore && !this._crowded(lx, ly, kind === REPAIR_JOB.STRAIGHTEN ? sp2S : sp2, d, kind)) {
        bestFreeScore = score;
        bestFree = j;
      }
    }
    if (bestAny < 0) return -1;
    // Klasa (1e9 · klasa w wyniku) rozstrzyga przed odstępem.
    return (bestFree >= 0 && Math.floor(bestFreeScore / 1e9) === Math.floor(bestAnyScore / 1e9)) ? bestFree : bestAny;
  }

  _claimed(key, self) {
    for (const d of this.drones) {
      if (d === self || d.job === REPAIR_JOB.NONE) continue;
      if (d.jobKey === key) return true;
    }
    return false;
  }

  _crowded(lx, ly, sp2, self, kind) {
    const T = this.tune, cs = this._cellSize();
    for (const d of this.drones) {
      if (d === self || d.job === REPAIR_JOB.NONE) continue;
      // Prostowanie przy dowolnej pracy innego drona — odstęp obszaru prostowania; pozostałe pary — spacingCells.
      let lim = sp2;
      if (d.job === REPAIR_JOB.STRAIGHTEN && kind !== REPAIR_JOB.STRAIGHTEN) {
        const sp = Math.max(T.spacingCells, T.straightenRadius * 2 + 1) * cs;
        lim = sp * sp;
      }
      const dx = d.jobLx - lx, dy = d.jobLy - ly;
      if (dx * dx + dy * dy < lim) return true;
    }
    return false;
  }

  // Zadanie wykonane / nieaktualne: rekord planu wypada (inne drony go nie wezmą przed następnym planem).
  _consumeJob(key) {
    const jobs = this._jobs;
    for (let j = 0; j < this._jobN; j++) if (jobs[j * 7 + 6] === key) jobs[j * 7] = REPAIR_JOB.NONE;
  }

  _cellSize() {
    const h = this.target?.beamHull;
    return h ? h.cellSize : 15;
  }

  _assign(d) {
    const j = this._pickJob(d);
    if (j < 0) return false;
    const o = j * 7, jobs = this._jobs;
    d.job = jobs[o];
    d.jobIx = jobs[o + 1];
    d.jobIy = jobs[o + 2];
    d.jobLx = jobs[o + 4];
    d.jobLy = jobs[o + 5];
    d.jobKey = jobs[o + 6];
    d.jobSocket = d.job === REPAIR_JOB.SOCKET ? d.jobIx : -1;
    d.jobT = 0;
    d.jobTimer = 0;
    d.jobPaid = false;
    // Kurs pracy: od drona ku komórce (płyta pod dziobem nad komórką).
    const dx = d.jobLx - d.lx, dy = d.jobLy - d.ly;
    d.jobYaw = (dx * dx + dy * dy > 1) ? Math.atan2(dy, dx) : d.yaw;
    return true;
  }

  // Przerwane zadanie (odwołanie, zmiana celu): płyta wraca z dronem do zapasu; zestrzelony dron — przepada (refund false).
  _dropJob(d, refund = true) {
    if (d.job === REPAIR_JOB.REGROW && d.jobPaid && refund) this.material += 1;
    if (d.job === REPAIR_JOB.STRAIGHTEN && d.jobT > 0) HullBodies.settleRepair(this.target);
    d.job = REPAIR_JOB.NONE;
    d.jobKey = -1;
    d.jobPaid = false;
    d.jobSocket = -1;
  }

  // ------------------------------------------------------------------ drony

  _stepDrone(d, dt) {
    const T = this.tune;
    if (d.state === DRONE_STATE.DOCKED) {
      d.plate = 0; d.weld = 0; d.arm = 0; d.thrust = 0;
      if (!this.launched || this.recalling || d.launchAt > this.time) return;
      // Start: z doku na grzbiecie nosiciela, w układzie nosiciela → układ celu.
      this._dockLocal(_dockL);
      d.frame = 1;
      d.lx = _dockL.x; d.ly = _dockL.y; d.lz = _dockL.z;
      d.vx = 0; d.vy = 0; d.vz = 0;
      d.yaw = 0;
      this._toFrameEntity(d, this.target, 0);
      d.state = DRONE_STATE.FLY;
      this._updateWorld(d);
      this._fx(REPAIR_FX.LAUNCH, d.wx, d.wy, d.wz, 0, d.index);
    }
    if (d.state === DRONE_STATE.FLY) {
      if (d.job === REPAIR_JOB.NONE && !this.recalling) this._assign(d);
      if (d.job === REPAIR_JOB.NONE) {
        // Bez zadania: zawis nad kadłubem do najbliższego planu (koniec pracy rozstrzyga step()).
        this._hover(d, dt);
      } else {
        this._goalForJob(d, _goal);
        const arrived = this._flyTo(d, _goal.x, _goal.y, _goal.z, _goal.yaw, dt);
        if (arrived) d.state = DRONE_STATE.WORK;
      }
      d.plate = d.job === REPAIR_JOB.REGROW ? 1 : 0;
      d.weld = 0;
      d.arm = Math.max(0, d.arm - dt * 3);
    } else if (d.state === DRONE_STATE.WORK) {
      this._work1(d, dt);
    } else if (d.state === DRONE_STATE.RETURN) {
      this._dockLocal(_dockL);
      const ent = this._frameEntity(d);
      if (ent !== this.carrier) this._toFrameEntity(d, this.carrier, 1);
      const arrived = this._flyTo(d, _dockL.x, _dockL.y, _dockL.z, 0, dt);
      d.plate = 0; d.weld = 0;
      d.arm = Math.max(0, d.arm - dt * 3);
      if (arrived) {
        d.state = DRONE_STATE.DOCKED;
        d.launchAt = Infinity;
        this._fx(REPAIR_FX.DOCK, d.wx, d.wy, d.wz, 0, d.index);
      }
    }
    if (d.state !== DRONE_STATE.DOCKED && d.state !== DRONE_STATE.DEAD) this._updateWorld(d);
  }

  _work1(d, dt) {
    const T = this.tune;
    const e = this.target;
    this._goalForJob(d, _goal);
    // Przyklejony do komórki: pozycja = cel (układ kadłuba stoi), bez prędkości.
    d.lx = _goal.x; d.ly = _goal.y; d.lz = _goal.z;
    d.vx = 0; d.vy = 0; d.vz = 0;
    d.yaw = _goal.yaw;
    d.thrust = 0.12;
    d.arm = Math.min(1, d.arm + dt * 3);
    d.jobT += dt;
    if (d.job === REPAIR_JOB.STRAIGHTEN) {
      d.plate = 0;
      d.weld = 0.55;
      const r = HullBodies.straightenAt(e, d.jobIx, d.jobIy, {
        radius: T.straightenRadius, dt, rate: T.straightenRate, hpRate: T.straightenHpRate, patchHpMul: T.patchHpMul
      });
      if (r.hp > 0) {
        this.stats.hpRestored += r.hp;
        this._credit(r.hpUnits);
      }
      if (!r.changed || r.nodes === 0 || d.jobT >= T.straightenTimeout) {
        if (r.changed && r.nodes > 0) this.stats.straightenTimeouts++;
        HullBodies.settleRepair(e);
        this._cool.set(d.jobKey, this.time + T.cellCooldown);
        this.stats.straightenJobs++;
        this._finishJob(d);
      }
    } else if (d.job === REPAIR_JOB.REGROW) {
      d.plate = 1;
      if (!d.jobPaid) {
        // Komórka mogła zarosnąć (inny dron) albo wypaść z frontu od planu — bez materiału, następne zadanie.
        if (!HullBodies.canRegrow(e, d.jobIx, d.jobIy)) {
          this._consumeJob(d.jobKey);
          if (!HullBodies.cellAlive(e, d.jobIx, d.jobIy)) this._cool.set(d.jobKey, this.time + this.tune.planInterval * 2);
          this._finishJob(d);
          return;
        }
        if (!this._takeMaterial()) {
          if (!this._noMaterial) {
            this._noMaterial = true;
            this._say('NAPRAWA: BRAK MATERIAŁU (złom, stal, płyty kadłubowe w ładowni)', REPAIR_MSG.NO_MATERIAL);
          }
          this._finishJob(d);
          return;
        }
        d.jobPaid = true;
        this._fx(REPAIR_FX.WELD_START, d.wx, d.wy, d.wz, 0, d.index);
      }
      d.weld = 1;
      d.jobTimer += dt;
      if (d.jobTimer >= T.weldTime) {
        const w = HullBodies.cellWorld(e, d.jobIx, d.jobIy, _cellWorld);
        const cs = this._cellSize();
        const blocked = !!(w && typeof this.env.cellBlocked === 'function' && this.env.cellBlocked(e, w.x, w.y, cs * 0.75));
        let ok = false;
        if (!blocked) ok = HullBodies.regrowCell(e, d.jobIx, d.jobIy, { hpMul: T.patchHpMul, patch: true });
        if (ok) {
          this.stats.cellsRegrown++;
          d.jobPaid = false;
          this._consumeJob(d.jobKey);
          this._credit(1);
          if (w) {
            this._fx(REPAIR_FX.REGROWN, w.x, w.y, 0, 0, d.index);
            if (typeof this.env.onCellRegrown === 'function') this.env.onCellRegrown(e, d.jobIx, d.jobIy, w.x, w.y);
          }
        } else {
          // Komórka niedostępna (zajęta przez inne ciało albo poza frontem po zmianie kadłuba) — materiał wraca.
          this.material += 1;
          d.jobPaid = false;
          this._cool.set(d.jobKey, this.time + (blocked ? T.blockedCooldown : T.cellCooldown));
        }
        this._finishJob(d);
      }
    } else if (d.job === REPAIR_JOB.SOCKET) {
      d.plate = 0;
      d.weld = 1;
      d.jobTimer += dt;
      if (d.jobTimer >= T.socketTime) {
        const ok = typeof this.env.restoreSocket === 'function' ? !!this.env.restoreSocket(e, d.jobSocket) : false;
        if (ok) {
          this.stats.sockets++;
          this._fx(REPAIR_FX.SOCKET, d.wx, d.wy, d.wz, 0, d.index);
        }
        this._cool.set(d.jobKey, this.time + T.blockedCooldown);
        this._finishJob(d);
      }
    } else {
      this._finishJob(d);
    }
  }

  _finishJob(d) {
    // Rekord zadania wypada z listy planu (bez tego dron wziąłby to samo zadanie od razu ponownie).
    if (d.jobKey >= 0) this._consumeJob(d.jobKey);
    d.job = REPAIR_JOB.NONE;
    d.jobKey = -1;
    d.jobPaid = false;
    d.jobSocket = -1;
    d.weld = 0;
    d.state = this.recalling ? DRONE_STATE.RETURN : DRONE_STATE.FLY;
    if (this.recalling) this._beginReturn(d);
    // Następne zadanie od razu (plan sprzed chwili; nieaktualne odpadnie przy wykonaniu).
    else this._assign(d);
  }

  _beginReturn(d) {
    d.state = DRONE_STATE.RETURN;
    if (this._frameEntity(d) !== this.carrier) this._toFrameEntity(d, this.carrier, 1);
  }

  // Cel drona przy zadaniu (układ celu): środek płyty nad komórką — dron cofnięty o plateForward wzdłuż kursu pracy.
  _goalForJob(d, out) {
    const T = this.tune;
    const c = Math.cos(d.jobYaw), s = Math.sin(d.jobYaw);
    let gx = d.jobLx - c * T.plateForward, gy = d.jobLy - s * T.plateForward;
    if (d.job === REPAIR_JOB.STRAIGHTEN) {
      // Prostowanie: dron krąży powoli nad obszarem (nad kwadratem ±r), ramiona przy blasze.
      const r = this._cellSize() * 0.6;
      const a = this.time * 1.3 + d.index * 2.1;
      gx += Math.cos(a) * r;
      gy += Math.sin(a) * r;
    }
    out.x = gx; out.y = gy; out.z = T.workZ; out.yaw = d.jobYaw;
    return out;
  }

  // Zawis bez zadania: wolne hamowanie na wysokości przelotu.
  _hover(d, dt) {
    const T = this.tune;
    const k = Math.exp(-3 * dt);
    d.vx *= k; d.vy *= k;
    d.vz += ((T.cruiseZ - d.lz) * 2 - d.vz) * Math.min(1, dt * 4);
    d.lx += d.vx * dt; d.ly += d.vy * dt; d.lz += d.vz * dt;
    d.thrust = Math.min(1, Math.sqrt(d.vx * d.vx + d.vy * d.vy) / T.maxSpeed);
  }

  /**
   * Lot do (gx, gy, gz) w układzie drona: hamowanie na drodze (v = √(2·a·d)), limit przyspieszenia i prędkości,
   * przelot na cruiseZ, zejście nad celem. Zwraca, czy dron dotarł (wtedy stoi dokładnie w celu).
   */
  _flyTo(d, gx, gy, gz, gyaw, dt) {
    const T = this.tune;
    const dx = gx - d.lx, dy = gy - d.ly;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const near = dist < 70;
    const tz = near ? gz : Math.max(gz, T.cruiseZ);
    const dz = tz - d.lz;
    // Prędkość zadana: hamowanie przed celem, kierunek ku celowi.
    let ux = 0, uy = 0;
    if (dist > 1e-6) {
      const vmax = Math.min(T.maxSpeed, Math.sqrt(2 * T.accel * 0.8 * dist));
      ux = dx / dist * vmax; uy = dy / dist * vmax;
    }
    const uz = Math.max(-260, Math.min(260, dz * 6));
    let ax = ux - d.vx, ay = uy - d.vy, az = uz - d.vz;
    const al = Math.sqrt(ax * ax + ay * ay);
    const amax = T.accel * dt;
    if (al > amax) { ax *= amax / al; ay *= amax / al; }
    const azMax = T.accel * 0.5 * dt;
    if (az > azMax) az = azMax; else if (az < -azMax) az = -azMax;
    d.vx += ax; d.vy += ay; d.vz += az;
    d.lx += d.vx * dt; d.ly += d.vy * dt; d.lz += d.vz * dt;
    const sp = Math.sqrt(d.vx * d.vx + d.vy * d.vy);
    d.thrust = Math.min(1, sp / T.maxSpeed + al / Math.max(1, amax) * 0.25);
    // Kurs: wzdłuż ruchu w locie, przy celu — kurs pracy.
    const want = (sp > 40 && dist > 30) ? Math.atan2(d.vy, d.vx) : gyaw;
    const diff = wrapAngle(want - d.yaw);
    const turn = T.turnRate * dt;
    d.yaw = wrapAngle(d.yaw + (Math.abs(diff) <= turn ? diff : Math.sign(diff) * turn));
    const ex = gx - d.lx, ey = gy - d.ly, ez = gz - d.lz;
    if (ex * ex + ey * ey < T.arriveDist * T.arriveDist && Math.abs(ez) < 1.5) {
      d.lx = gx; d.ly = gy; d.lz = gz;
      d.vx = 0; d.vy = 0; d.vz = 0;
      return true;
    }
    return false;
  }

  _frameEntity(d) {
    return d.frame === 1 ? this.carrier : this.target;
  }

  _pose(e, out) {
    out.x = entX(e); out.y = entY(e);
    const a = Number(e?.angle) || 0;
    out.a = a; out.c = Math.cos(a); out.s = Math.sin(a);
    return out;
  }

  // Przejście drona do układu encji `ent` (frame: 0 — cel, 1 — nosiciel): ta sama pozycja i prędkość w świecie.
  _toFrameEntity(d, ent, frame) {
    const from = this._frameEntity(d);
    if (from === ent) { d.frame = frame; return; }
    const pa = this._pose(from, _poseA), pb = this._pose(ent, _poseB);
    const wx = pa.x + pa.c * d.lx - pa.s * d.ly;
    const wy = pa.y + pa.s * d.lx + pa.c * d.ly;
    const wvx = pa.c * d.vx - pa.s * d.vy, wvy = pa.s * d.vx + pa.c * d.vy;
    const dx = wx - pb.x, dy = wy - pb.y;
    d.lx = pb.c * dx + pb.s * dy;
    d.ly = -pb.s * dx + pb.c * dy;
    d.vx = pb.c * wvx + pb.s * wvy;
    d.vy = -pb.s * wvx + pb.c * wvy;
    d.yaw = wrapAngle(d.yaw + pa.a - pb.a);
    d.frame = frame;
  }

  _updateWorld(d) {
    const p = this._pose(this._frameEntity(d), _poseA);
    d.wx = p.x + p.c * d.lx - p.s * d.ly;
    d.wy = p.y + p.s * d.lx + p.c * d.ly;
    d.wz = d.lz;
    d.wyaw = d.yaw + p.a;
    // Punkt spawania (obraz): krawędź płyty pod dziobem, obiega obwód płyty z czasem pracy.
    const c = Math.cos(d.wyaw), s = Math.sin(d.wyaw);
    const T = this.tune;
    const f = T.plateForward, half = this._cellSize() * 0.5;
    const u = (d.jobTimer / Math.max(0.1, T.weldTime)) * 4;
    const side = Math.floor(u) & 3, t = (u - Math.floor(u)) * 2 - 1;
    let px = 0, py = 0;
    if (side === 0) { px = half; py = t * half; } else if (side === 1) { px = -t * half; py = half; }
    else if (side === 2) { px = -half; py = -t * half; } else { px = t * half; py = -half; }
    d.weldX = d.wx + c * (f + px) - s * py;
    d.weldY = d.wy + s * (f + px) + c * py;
  }

  // Dok na grzbiecie nosiciela (układ nosiciela).
  _dockLocal(out) {
    const T = this.tune;
    const len = repairHullLength(this.carrier);
    const along = this.dock.along ?? T.dockAlong;
    const side = this.dock.side ?? T.dockSide;
    out.x = along * len;
    out.y = side * len * 0.45;
    out.z = this.dock.z ?? T.dockZ;
    return out;
  }

  // ------------------------------------------------------------------ materiał

  _takeMaterial() {
    if (this.material >= 1) { this.material -= 1; return true; }
    const T = this.tune;
    const cargo = this.cargo;
    for (const key of REPAIR_MATERIALS) {
      const n = Math.floor(Number(cargo[key]) || 0);
      if (n <= 0) continue;
      if (n - 1 > 0) cargo[key] = n - 1; else delete cargo[key];
      this.material += Number(T.cellsPerUnit[key]) || 0;
      this.stats.used[key] = (this.stats.used[key] || 0) + 1;
      if (this.material >= 1) { this.material -= 1; return true; }
    }
    return false;
  }

  // ------------------------------------------------------------------ trafienia

  /**
   * Pierwszy dron na odcinku (świat gry) o promieniu r (pocisk) — wynik w rig._hit ({ index, t, x, y }) albo null.
   * Tylko drony w powietrzu (nie w doku).
   */
  hitSegment(x0, y0, x1, y1, r = 0) {
    if (this.out === 0) return null;
    const R = this.tune.hitRadius + (r > 0 ? r : 0);
    const minX = Math.min(x0, x1) - R, maxX = Math.max(x0, x1) + R;
    const minY = Math.min(y0, y1) - R, maxY = Math.max(y0, y1) + R;
    if (maxX < this.minX || minX > this.maxX || maxY < this.minY || minY > this.maxY) return null;
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    let best = -1, bestT = Infinity;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (d.state === DRONE_STATE.DOCKED || d.state === DRONE_STATE.DEAD) continue;
      const fx = d.wx - x0, fy = d.wy - y0;
      let t = len2 > 1e-9 ? (fx * dx + fy * dy) / len2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const cx = x0 + dx * t - d.wx, cy = y0 + dy * t - d.wy;
      if (cx * cx + cy * cy > R * R) continue;
      if (t >= bestT || this._shieldedDrone(d)) continue;
      bestT = t; best = i;
    }
    if (best < 0) return null;
    const h = this._hit;
    h.index = best; h.t = bestT; h.x = x0 + dx * bestT; h.y = y0 + dy * bestT;
    return h;
  }

  /** Obrażenia drona; zwraca, czy zginął. */
  damageDrone(i, dmg) {
    const d = this.drones[i];
    if (!d || d.state === DRONE_STATE.DOCKED || d.state === DRONE_STATE.DEAD) return false;
    d.hp -= Math.max(0, Number(dmg) || 0);
    d.hitT = this.time;
    if (d.hp > 0) return false;
    this._killDrone(d, true);
    return true;
  }

  /** Wybuch (świat gry): drony w promieniu dostają obrażenia (pełne w środku, ½ na brzegu). Zwraca liczbę trafionych. */
  blast(x, y, radius, dmg) {
    if (this.out === 0 || !(radius > 0)) return 0;
    const R = radius + this.tune.hitRadius;
    if (x + R < this.minX || x - R > this.maxX || y + R < this.minY || y - R > this.maxY) return 0;
    let n = 0;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (d.state === DRONE_STATE.DOCKED || d.state === DRONE_STATE.DEAD) continue;
      const dx = d.wx - x, dy = d.wy - y;
      const r2 = dx * dx + dy * dy;
      if (r2 > R * R || this._shieldedDrone(d)) continue;
      const k = 1 - 0.5 * Math.sqrt(r2) / R;
      this.damageDrone(i, dmg * k);
      n++;
    }
    return n;
  }

  // Dron pod działającą tarczą celu albo nosiciela (hak env.shielded — gra; bez haka tarcza nie chroni). Pociski i wiązki
  // kończą się na obrysie tarczy i tak — test zamyka wybuchy oraz krok pocisku tuż za obrysem.
  _shieldedDrone(d) {
    const f = this.env.shielded;
    if (typeof f !== 'function' || !this.tune.shieldProtects) return false;
    if (f(this.target, d.wx, d.wy)) return true;
    return this.carrier !== this.target && !!f(this.carrier, d.wx, d.wy);
  }

  _killDrone(d, notify) {
    this._dropJob(d, false);
    d.state = DRONE_STATE.DEAD;
    d.hp = 0;
    d.plate = 0; d.weld = 0; d.thrust = 0;
    this.stats.dronesLost++;
    this._fx(REPAIR_FX.DRONE_LOST, d.wx, d.wy, d.wz, d.wyaw, d.index);
    if (notify) {
      this._say(`DRON NAPRAWCZY ZNISZCZONY (${this.aliveCount()}/${this.drones.length})`, REPAIR_MSG.LOST);
      if (typeof this.env.onDroneLost === 'function') this.env.onDroneLost(this, d);
    }
  }

  // ------------------------------------------------------------------ stan

  _updateStats() {
    const st = this.stats;
    let alive = 0, out = 0, working = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of this.drones) {
      if (d.state === DRONE_STATE.DEAD) continue;
      alive++;
      if (d.state === DRONE_STATE.DOCKED) continue;
      out++;
      if (d.state === DRONE_STATE.WORK) working++;
      if (d.wx < minX) minX = d.wx;
      if (d.wx > maxX) maxX = d.wx;
      if (d.wy < minY) minY = d.wy;
      if (d.wy > maxY) maxY = d.wy;
    }
    this.out = out;
    this.minX = minX; this.minY = minY; this.maxX = maxX; this.maxY = maxY;
    st.alive = alive;
    st.total = this.drones.length;
    st.out = out;
    st.working = working;
    st.materialCells = this.materialCells();
    st.progress = this._workMax > 0 ? Math.max(0, Math.min(1, 1 - this._work / this._workMax)) : 1;
  }

  _fx(kind, x, y, z, a, drone) {
    const f = this.fx[this.fxWrite % FX_CAP];
    f.kind = kind; f.x = x; f.y = y; f.z = z; f.a = a; f.drone = drone; f.t = this.time;
    this.fxWrite++;
  }

  _say(text, kind) {
    const m = this.messages[this.messageWrite % MSG_CAP];
    m.text = text; m.kind = kind; m.t = this.time;
    this.messageWrite++;
    if (typeof this.onMessage === 'function') this.onMessage(text, kind, this);
  }
}

/** Punkty kadłuba encji: gracz / P2 — hull.val, NPC — hp. */
function pointsOf(e) {
  if (e?.hull && Number(e.hull.max) > 0) return Number(e.hull.val) || 0;
  return Number(e?.hp) || 0;
}

/**
 * Punkty kadłuba za naprawę (bez haka gry): gracz / P2 — hull.val, NPC — hp; nie ponad sufit konstrukcji
 * (maks. × udział żywych węzłów^wykładnik — hullIntegrity.js) ani maks. Zwraca przyrost.
 */
export function defaultHealPoints(e, points) {
  if (!e || !(points > 0) || e.dead || e.destroyed || e.isWreck) return 0;
  const st = HullBodies.structuralState(e, _struct);
  const ratio = st ? st.ratio : 1;
  const capFrac = hullIntegrityCapFrac(ratio, hullIntegrityExponent(e));
  if (e.hull && Number(e.hull.max) > 0) {
    const val = Number(e.hull.val) || 0;
    if (!(val > 0)) return 0;
    const cap = Math.min(e.hull.max, e.hull.max * capFrac);
    const next = Math.min(cap, val + points);
    if (next <= val) return 0;
    e.hull.val = next;
    return next - val;
  }
  const max = Math.max(1, Number(e.maxHp) || Number(e.hp) || 1);
  const hp = Number(e.hp) || 0;
  if (!(hp > 0)) return 0;
  const cap = Math.min(max, max * capFrac);
  const next = Math.min(cap, hp + points);
  if (next <= hp) return 0;
  e.hp = next;
  return next - hp;
}

const _pose = { x: 0, y: 0, a: 0, c: 1, s: 0 };
const _poseA = { x: 0, y: 0, a: 0, c: 1, s: 0 };
const _poseB = { x: 0, y: 0, a: 0, c: 1, s: 0 };
const _goal = { x: 0, y: 0, z: 0, yaw: 0 };
const _dockL = { x: 0, y: 0, z: 0 };
const _cellWorld = { x: 0, y: 0 };
const _struct = { active: 0, total: 0, ratio: 1 };
