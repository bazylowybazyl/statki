// src/game/asteroidMiningRig.js
//
// PLATFORMA WYDOBYWCZA GRACZA (zadanie 21b portu WebGPU): drony z laserami, piła,
// ładunki S–XL, detonacja, wiązka ściągająca, skaner i urobek do ładowni — system
// gry na fizyce skał src/game/asteroidMining.js. Bez three i DOM-u: render czyta stan
// (drony, wiązki, piła, ładunki, zdarzenia efektów) — src/3d/asteroids/miningView.js
// i minedRocks.js; wejście i HUD — index.html. Wzór zachowania: dema/asteroidy-webgpu/
// miningRig.js (scena Kopalnia), nie 1:1:
//   • krok w CZASIE SYMULACJI (physicsStep, 120 Hz) — stałe są na sekundę (wykładniki
//     od dt), więc krok 60 / 120 Hz daje ten sam przebieg; drony, piła, wiązka i fizyka
//     skał idą razem z grą (w pauzie stoją);
//   • skała pola pod celem przechodzi do fizyki z danych pola (AsteroidBeltField — ta
//     sama skała, którą rysuje warstwa PLAY), nie z bufora renderu; przejęte id skał
//     (`taken`, `takenVersion`) chowa warstwa pola (rockLayers.hide);
//   • ciężkie operacje (przejęcie skały 10–30 ms, wybuch 10–60 ms) najwyżej jedna na
//     klatkę (`beginFrame` z pętli gry) — kolejne ładunki wybuchają w następnych klatkach
//     (seria), żadna klatka nie stoi > 50 ms;
//   • urobek: ruda w tonach surowców resources.js do ładowni gracza (`onCargo`), skała
//     płonna odpada; wiązka nie łapie odłamu, którego ruda nie zmieści się w ładowni
//     (`cargoFree`); ładunki z magazynka gracza (`stock` — PLAYER.miningCharges);
//   • bez Math.random (fizyka skał losuje z id ciała — determinizm), bez alokacji na
//     krok poza zdarzeniami (wybuch, przejęcie, zbiórka).
//
// Układ: przestrzeń skał = scena bez przesunięcia początku — X = x świata gry, Y = −y,
// Z = z (w górę, do kamery). Wejście (kursor, statek) w świecie gry.

import { createYield } from './asteroidMining.js';
import { chargeForDepth } from './asteroidMaterials.js';
import { BELT_BAND } from './asteroidBeltField.js';
import { ROCK_TYPE_INDEX, ROCK_TYPE_LABELS_PL, pickShape } from './asteroidRockKinds.js';
import { ASTEROID_YIELD, RESOURCES } from '../data/resources.js';
import { MINING_CHARGES, createMiningChargeStock } from '../data/miningCharges.js';

export const MINING_RIG_CONFIG = Object.freeze({
  drones: 3,
  // Moc lasera drona (1 = digVolumeRate z asteroidMaterials.js); trzy drony dokopują się
  // do rdzenia skały r ≈ 650 j. w kilkanaście sekund (demo).
  dronePower: 1.5,
  // Krąg dronów nad celem (wiązki pod kątem — z góry pionowa byłaby punktem) i wysokość.
  droneRing: 300,
  droneZ: 170,
  droneSpin: 0.35,
  droneMaxSpeed: 2600,
  // Drony tną, gdy są bliżej swojego miejsca nad celem niż tyle [j.].
  workRadius: 220,
  // Zasięg pracy dronów od statku [j.] — dalej cel jest odrzucany.
  droneRange: 9000,
  // Dok na grzbiecie statku: wzdłuż kadłuba (× długość), odstęp w poprzek, wysokość.
  dockAlong: -0.18,
  dockSpacing: 110,
  dockZ: 60,
  // Wiązka ściągająca (udźwig = najcięższy odłam [t] — do decyzji użytkownika).
  tractorRadius: 3600,
  tractorCapacity: 450,
  tractorCapture: 260,
  tractorTargets: 12,
  // Piła: szczelina [j.], tempo 380 / (0,2 + twardość) j./s, zapas linii, cięcie co tyle s
  // czasu symulacji (rozpad po cięciu sprawdza etykietowanie całej siatki).
  sawKerf: 44,
  sawSpeed: 380,
  sawSpeedAir: 1400,
  sawPad: 150,
  sawMinLen: 60,
  sawInterval: 0.1,
  sawWire: 260,
  sawZ: 120,
  // Szukanie skały pola pod kursorem: promień kwadratu [j.] (największa skała PLAY
  // r = 1300 × rozciągnięcie 1,2), ponowna próba nie częściej niż co tyle s.
  pickReach: 1700,
  aimRetry: 0.25,
  // Ładunek osadzany pod dnem otworu (× laserRadius), najwięcej naraz.
  chargeDepth: 0.6,
  maxCharges: 8,
  // Skaner pod kursorem co tyle s (probe liczy głębokość w 48 kierunkach).
  hoverInterval: 0.1,
  // Ciała i okruchy dalej od statku niż tyle [j.] są zwalniane (skała nietknięta wraca do pola).
  farRelease: 60000,
  releaseCheck: 1.0,
  // Urobek (pełne tony) do ładowni co tyle s czasu symulacji.
  flushInterval: 0.25,
  // Komunikaty: ile ostatnich, jak długo żyją [s].
  messageCap: 6,
  messageLife: 9
});

/** Rodzaje zdarzeń efektów (pierścień `fx`). */
export const MINING_FX = Object.freeze({ BLAST: 1, CONTAINED: 2, SPLIT: 3, COLLECT: 4, ACTIVATE: 5 });
const FX_CAP = 64;

// Surowce rudy (klucze resources.js) — stały zestaw pól worka (obiekt w trybie szybkim).
export const MINING_ORE_KEYS = Object.freeze([...new Set(Object.values(ASTEROID_YIELD))]);

function makeOreBag() {
  const bag = {};
  for (const k of MINING_ORE_KEYS) bag[k] = 0;
  return bag;
}

/** Urobek z polami wszystkich rud od razu (pisany co krok — bez przejścia w tryb słownikowy). */
export function createRigYield() {
  const y = createYield();
  y.ore = makeOreBag();
  return y;
}

function fmt1(v) { return (Math.round(v * 10) / 10).toFixed(1).replace('.', ','); }

export class MiningRig {
  /**
   * @param {object} o
   * @param {import('./asteroidMining.js').AsteroidMining} o.mining fizyka skał
   * @param {{ forEachRockInRect(band, x0, y0, x1, y1, minD, cb): number }} o.field pole (AsteroidBeltField)
   * @param {(rock) => number} o.playZ z sceny środka skały PLAY (ten sam co warstwa renderu)
   * @param {(x:number, y:number) => number} [o.sunT] transmitancja słońca do renderu (świat gry)
   * @param {() => number} [o.timeSource] czas obrotu skał pola (zegar shadera skał) — faza przejętej skały
   * @param {object} [o.stock] magazynek ładunków { S, M, L, XL } (PLAYER.miningCharges)
   * @param {object} [o.config] nadpisania MINING_RIG_CONFIG
   */
  constructor({ mining, field, playZ, sunT = null, timeSource = null, stock = null, config = null } = {}) {
    this.mining = mining;
    this.field = field;
    this.playZ = playZ || ((rock) => -rock.r * 1.45 * Math.max(rock.sx ?? 1, rock.sy ?? 1, rock.sz ?? 1));
    this.sunT = sunT;
    this.timeSource = timeSource;
    this.cfg = { ...MINING_RIG_CONFIG, ...(config || {}) };
    this.stock = stock || createMiningChargeStock();
    // Stan wejścia.
    this.enabled = false;
    this.firing = false;
    this.aimX = 0; this.aimY = 0;       // cel dronów (przestrzeń skał: x, −y)
    this.cursorX = 0; this.cursorY = 0; // kursor (przestrzeń skał)
    this.hasCursor = false;
    this.chargeIndex = 1;
    this.tractorOn = false;
    this.time = 0;
    // Drony (przestrzeń skał).
    this.drones = [];
    for (let i = 0; i < this.cfg.drones; i++) {
      this.drones.push({
        p: [0, 0, 0], v: [0, 0, 0], phase: (i / this.cfg.drones) * Math.PI * 2, yaw: 0,
        parked: true, placed: false, laserOn: false, role: 0,
        hit: { body: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, ore: 0, lx: 0, ly: 0, lz: 0 },
        tx: 0, ty: 0, tz: 0
      });
    }
    this._aimHit = { body: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, ore: 0, lx: 0, ly: 0, lz: 0 };
    this._probeHit = { body: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, ore: 0, lx: 0, ly: 0, lz: 0 };
    this._aimValid = false;
    this._aimFailX = NaN; this._aimFailY = NaN; this._aimFailT = -1e9;
    this._rangeWarnT = -1e9;
    // Piła: linia (przestrzeń skał), postęp, cięcie co sawInterval.
    this.saw = { active: false, done: false, x0: 0, y0: 0, dx: 1, dy: 0, nx: 0, ny: 1, len: 0, t: 0, cutT: 0, nextCut: 0, doneAt: -1e9, cut: 0 };
    this.sawPoint = { x: 0, y: 0, z: -200, hit: false };
    this.sawPreview = { on: false, ax: 0, ay: 0, bx: 0, by: 0 };
    this._sweep = { x: 1, y: 0, z: 0, from: 0, to: 0 };
    // Ładunki osadzone i kolejka detonacji.
    this.charges = [];
    this._detQueue = [];
    this._pendingPlant = null;
    // Wiązka: cele do rysowania (referencje do p obiektów) i ich liczba.
    this.tractorTargets = new Array(this.cfg.tractorTargets).fill(null);
    this._tractorDist = new Float64Array(this.cfg.tractorTargets);
    this.tractorCount = 0;
    // Skały pola przejęte przez fizykę (chowa je warstwa renderu).
    this.taken = new Set();
    this.takenVersion = 0;
    this._testIds = 1;
    // Urobek bieżący (ułamki ton czekają na pełną tonę) i sumy sesji.
    this.yield = createRigYield();
    this.totals = { ore: makeOreBag(), waste: 0, lost: 0, lostOre: 0, collected: 0, blasts: 0 };
    this.onCargo = null;     // (klucz surowca, tony całkowite) => przyjęte tony
    this.cargoFree = null;   // () => wolne tony w ładowni
    this.onMessage = null;   // (tekst) => void
    this.onBlast = null;     // (x, y świata gry, energia, wynik) => void (wstrząs kamery, dźwięk)
    this._fullWarnT = -1e9;
    // Pierścień zdarzeń efektów (render czyta od swojego licznika).
    this.fx = [];
    for (let i = 0; i < FX_CAP; i++) this.fx.push({ kind: 0, x: 0, y: 0, z: 0, energy: 0, size: 0, n: 0, res: null, t: 0 });
    this.fxWrite = 0;
    // Komunikaty HUD-u (pierścień).
    this.messages = [];
    for (let i = 0; i < this.cfg.messageCap; i++) this.messages.push({ text: '', t: -1e9 });
    this.messageWrite = 0;
    // Skaner.
    this.hover = null;
    this._hoverT = -1e9;
    this._releaseT = 0;
    this._flushT = 0;
    // Budżet ciężkich operacji na klatkę (beginFrame); bez beginFrame — na krok.
    this._heavy = 1;
    this._frameBudget = false;
    this.stats = { heavyMs: 0, activations: 0, deferred: 0 };
  }

  // --- Sterowanie ---------------------------------------------------------------

  get charge() { return MINING_CHARGES[this.chargeIndex]; }

  setEnabled(v) {
    this.enabled = !!v;
    if (!this.enabled) {
      this.firing = false;
      this.tractorOn = false;
      this.sawPreview.on = false;
      this.hover = null;
    }
  }

  /** Kursor (świat gry) i stan przycisku lasera. */
  pointer(wx, wy, down) {
    this.cursorX = wx;
    this.cursorY = -wy;
    this.hasCursor = true;
    this.firing = this.enabled && !!down;
    if (this.firing) { this.aimX = wx; this.aimY = -wy; }
  }

  cycleCharge(dir = 1) {
    const n = MINING_CHARGES.length;
    this.chargeIndex = (this.chargeIndex + (dir < 0 ? n - 1 : 1)) % n;
    return this.charge;
  }

  toggleTractor() {
    if (!this.enabled) return false;
    this.tractorOn = !this.tractorOn;
    return this.tractorOn;
  }

  /** Podgląd linii piły (świat gry). */
  previewSaw(ax, ay, bx, by) {
    const s = this.sawPreview;
    s.on = true; s.ax = ax; s.ay = -ay; s.bx = bx; s.by = -by;
  }

  clearSawPreview() { this.sawPreview.on = false; }

  /** Piła wzdłuż linii (świat gry): od a do b, z zapasem po obu stronach. */
  startSaw(ax, ay, bx, by) {
    this.sawPreview.on = false;
    if (!this.enabled) return false;
    const cfg = this.cfg;
    const x0 = ax, y0 = -ay, x1 = bx, y1 = -by;
    const len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    if (len < cfg.sawMinLen) return false;
    const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
    const s = this.saw;
    s.active = true; s.done = false;
    s.x0 = x0 - dx * cfg.sawPad; s.y0 = y0 - dy * cfg.sawPad;
    s.len = len + cfg.sawPad * 2;
    s.dx = dx; s.dy = dy; s.nx = -dy; s.ny = dx;
    s.t = 0; s.cutT = 0; s.nextCut = this.time + cfg.sawInterval; s.cut = 0; s.doneAt = -1e9;
    this._say(`Piła: cięcie ${Math.round(len)} j. — drony prowadzą drut wzdłuż linii`);
    return true;
  }

  /** Ładunek w dnie otworu pod punktem (świat gry). Zwraca ładunek, 'deferred' albo null. */
  plantCharge(wx, wy) {
    if (!this.enabled) return null;
    const ch = this.charge;
    if (!((this.stock[ch.id] | 0) > 0)) { this._say(`Brak ładunków ${ch.id} w magazynku (dok stacji: rynek → Ładunki górnicze)`); return null; }
    if (this.charges.length >= this.cfg.maxCharges) { this._say(`Najwyżej ${this.cfg.maxCharges} ładunków naraz — odpal (F)`); return null; }
    const x = wx, y = -wy;
    let hit = this._probeDown(x, y, this._probeHit);
    if (!hit) {
      if (!this._takeHeavy()) { this._pendingPlant = { x: wx, y: wy }; this.stats.deferred++; return 'deferred'; }
      if (!this._activateAt(x, y)) { this._say('Ładunek: pod kursorem nie ma skały'); return null; }
      hit = this._probeDown(x, y, this._probeHit);
      if (!hit) return null;
    }
    const cfg = this.mining.cfg;
    const px = hit.x, py = hit.y, pz = hit.z - cfg.laserRadius * this.cfg.chargeDepth;
    const local = hit.body.worldToLocal(px, py, pz, [0, 0, 0]);
    const charge = { body: hit.body, local, energy: ch.energy, id: ch.id, t0: this.time };
    this.charges.push(charge);
    this.stock[ch.id] = (this.stock[ch.id] | 0) - 1;
    const depth = this.mining.probe(hit.body, px, py, pz).depth;
    const need = chargeForDepth(hit.body.material, depth);
    // Płytko potrzeba ułamka energii — „≥ 0,0” myliło; najmniejsza pokazywana wartość 0,1.
    this._say(`Ładunek ${ch.id} (${fmt1(ch.energy)}) ${Math.round(depth)} j. pod powierzchnią — do przebicia ≥ ${fmt1(Math.max(0.1, need))}`);
    return charge;
  }

  /** Wszystkie ładunki do detonacji (seria: jeden wybuch na klatkę). */
  detonate() {
    if (!this.charges.length) { this._say('Brak ładunków (PPM na skale)'); return 0; }
    const n = this.charges.length;
    for (let i = 0; i < n; i++) this._detQueue.push(this.charges[i]);
    this.charges.length = 0;
    return n;
  }

  /** Skała testowa danego typu przed dziobem statku (dev / harness — jak scena Kopalnia dema). */
  spawnTestRock(typeId, ship, r = 650, ahead = 1700) {
    const type = ROCK_TYPE_INDEX[typeId] ?? ROCK_TYPE_INDEX.copper;
    const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
    const x = ship.x + c * ahead, y = ship.y + s * ahead;
    const id = 9e15 + this._testIds++;
    const rock = {
      id, x, y, r, d: 2 * r, shape: pickShape(type, 2 * r, 0.37, 0.5), type,
      qx: 0.12, qy: 0.34, qz: 0.05, qw: 0.93, ax: 0, ay: 0, az: 1, spin: 0, phase: 0,
      sx: 1.05, sy: 0.95, sz: 0.9, seed: 0.41
    };
    const l = Math.sqrt(rock.qx * rock.qx + rock.qy * rock.qy + rock.qz * rock.qz + rock.qw * rock.qw);
    rock.qx /= l; rock.qy /= l; rock.qz /= l; rock.qw /= l;
    // Skały pola w obrysie testowej znikają (nie przenikają się).
    const reach = r * 1.35 + this.cfg.pickReach;
    this.field?.forEachRockInRect(BELT_BAND.PLAY, x - reach, y - reach, x + reach, y + reach, 0, (f) => {
      const dx = f.x - x, dy = f.y - y;
      if (Math.sqrt(dx * dx + dy * dy) < r * 1.35 + f.r) this._hideRock(f.id);
    });
    const body = this.mining.activate(rock, { z: this.playZ(rock), time: this._rockTime(), sunT: this._sunT(x, y), anchored: true });
    body.userData = { test: true, fieldId: 0 };
    this._fx(MINING_FX.ACTIVATE, body.p[0], body.p[1], body.p[2], 0, body.boundR, 0, body.oreRes);
    this._say(`Skała testowa: ${ROCK_TYPE_LABELS_PL[typeId] || typeId}, r ${r} j., ${fmt1(body.mass)} t, rudy ${fmt1(body.oreMass)} t`);
    return body;
  }

  /** Wszystko do pola: ciała i okruchy znikają, schowane skały wracają (dev). */
  reset() {
    const m = this.mining;
    for (const b of m.bodies) b.alive = false;
    m.bodies.length = 0;
    m.pebbles.length = 0;
    this.charges.length = 0;
    this._detQueue.length = 0;
    this.taken.clear();
    this.takenVersion++;
    this.saw.active = false;
    this.firing = false;
    this.tractorOn = false;
    this.hover = null;
  }

  // --- Krok -----------------------------------------------------------------------

  /** Nowa klatka gry: budżet ciężkich operacji (przejęcie skały, wybuch) = 1. */
  beginFrame() {
    this._frameBudget = true;
    this._heavy = 1;
  }

  /**
   * Krok symulacji (physicsStep). ship: { x, y, angle, len } w świecie gry
   * (len = długość kadłuba [j.] — dok dronów).
   */
  step(dt, ship) {
    if (!(dt > 0)) return;
    const cfg = this.cfg;
    this.time += dt;
    if (!this._frameBudget) this._heavy = 1;
    // Zaległe: ładunek czekający na przejęcie skały, detonacje (jedna na klatkę).
    if (this._pendingPlant && this._heavy > 0) {
      const p = this._pendingPlant;
      this._pendingPlant = null;
      this.plantCharge(p.x, p.y);
    }
    if (this._detQueue.length && this._heavy > 0) this._detonateNext();
    // Ładunki na zebranych / zniszczonych ciałach przepadają.
    for (let i = this.charges.length - 1; i >= 0; i--) if (!this.charges[i].body.alive) this.charges.splice(i, 1);
    this._stepAim();
    this._stepDrones(dt, ship);
    this._stepSaw(dt);
    this._stepTractor(dt, ship);
    this.mining.step(dt);
    this._drainMiningEvents();
    // Urobek do ładowni co flushInterval (odczyt worka po kluczu pakuje liczby — nie co krok).
    this._flushT += dt;
    if (this._flushT >= cfg.flushInterval) { this._flushT = 0; this._flushYield(); }
    this._stepHover();
    this._releaseT += dt;
    if (this._releaseT >= cfg.releaseCheck) { this._releaseT = 0; this._releaseFar(ship); }
  }

  _stepAim() {
    this._aimValid = false;
    if (!this.firing) return;
    let hit = this._probeDown(this.aimX, this.aimY, this._aimHit);
    if (!hit) {
      // Skała pola pod celem: przejęcie (ciężkie — najwyżej jedno na klatkę; po chybieniu
      // w pustkę ponowna próba dopiero po aimRetry albo po ruchu celu).
      const moved = Math.abs(this.aimX - this._aimFailX) > 40 || Math.abs(this.aimY - this._aimFailY) > 40;
      if ((moved || this.time - this._aimFailT > this.cfg.aimRetry) && this._takeHeavy()) {
        if (this._activateAt(this.aimX, this.aimY)) hit = this._probeDown(this.aimX, this.aimY, this._aimHit);
        else { this._aimFailX = this.aimX; this._aimFailY = this.aimY; this._aimFailT = this.time; }
      }
    }
    this._aimValid = !!hit;
  }

  _stepDrones(dt, ship) {
    const cfg = this.cfg;
    const n = this.drones.length;
    const sc = Math.cos(ship.angle), ss = Math.sin(ship.angle);
    const len = Math.max(200, Number(ship.len) || 1800);
    // Cel w zasięgu dronów?
    let inRange = false;
    if (this.firing) {
      const ddx = this.aimX - ship.x, ddy = this.aimY + ship.y;
      inRange = ddx * ddx + ddy * ddy <= cfg.droneRange * cfg.droneRange;
      if (!inRange && this.time - this._rangeWarnT > 3) {
        this._rangeWarnT = this.time;
        this._say(`Cel poza zasięgiem dronów (${Math.round(cfg.droneRange / 1000)} tys. j. od statku)`);
      }
    }
    const saw = this.saw;
    const sawing = saw.active && !saw.done;
    const k = 1 - Math.exp(-5 * dt);
    const laserR = this.mining.cfg.laserRadius;
    for (let i = 0; i < n; i++) {
      const d = this.drones[i];
      d.laserOn = false;
      let gx, gy, gz;
      let working = false;
      if (sawing && i < 2) {
        // Dwa drony trzymają drut piły nad linią cięcia (końce drutu w poprzek linii).
        const side = i === 0 ? -1 : 1;
        const px = saw.x0 + saw.dx * saw.t, py = saw.y0 + saw.dy * saw.t;
        gx = px + saw.nx * cfg.sawWire * side;
        gy = py + saw.ny * cfg.sawWire * side;
        gz = cfg.sawZ;
        d.role = 2;
        working = true;
      } else if (this.firing && inRange) {
        const a = d.phase + this.time * cfg.droneSpin;
        gx = this.aimX + Math.cos(a) * cfg.droneRing;
        gy = this.aimY + Math.sin(a) * cfg.droneRing;
        gz = cfg.droneZ;
        d.role = 1;
        working = true;
      } else {
        // Dok: nad grzbietem statku, rząd w poprzek.
        const along = len * cfg.dockAlong;
        const side = (i - (n - 1) / 2) * cfg.dockSpacing;
        gx = ship.x + sc * along - ss * side;
        gy = -(ship.y + ss * along + sc * side);
        gz = cfg.dockZ;
        d.role = 0;
      }
      d.tx = gx; d.ty = gy; d.tz = gz;
      if (!d.placed) {
        // Pierwszy krok: dron startuje z doku na grzbiecie statku.
        const along = len * cfg.dockAlong;
        const side = (i - (n - 1) / 2) * cfg.dockSpacing;
        d.p[0] = ship.x + sc * along - ss * side;
        d.p[1] = -(ship.y + ss * along + sc * side);
        d.p[2] = cfg.dockZ;
        d.v[0] = 0; d.v[1] = 0; d.v[2] = 0;
        d.placed = true;
        d.yaw = -ship.angle;
      }
      if (working) d.parked = false;
      if (d.parked && !working) {
        d.p[0] = gx; d.p[1] = gy; d.p[2] = gz;
        d.v[0] = 0; d.v[1] = 0; d.v[2] = 0;
      } else {
        // Sprężyna krytyczna z limitem prędkości (czas symulacji — wykładnik od dt).
        const wx = (gx - d.p[0]) * 3.2, wy = (gy - d.p[1]) * 3.2, wz = (gz - d.p[2]) * 3.2;
        const wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
        const lim = cfg.droneMaxSpeed / Math.max(cfg.droneMaxSpeed, wl);
        d.v[0] += (wx * lim - d.v[0]) * k; d.v[1] += (wy * lim - d.v[1]) * k; d.v[2] += (wz * lim - d.v[2]) * k;
        d.p[0] += d.v[0] * dt; d.p[1] += d.v[1] * dt; d.p[2] += d.v[2] * dt;
        const ex = gx - d.p[0], ey = gy - d.p[1], ez = gz - d.p[2];
        if (!working && ex * ex + ey * ey + ez * ez < 900) d.parked = true;
      }
      // Laser: dron blisko swojego miejsca, skała pod celem.
      if (d.role === 1 && this._aimValid) {
        const ex = gx - d.p[0], ey = gy - d.p[1];
        if (ex * ex + ey * ey < cfg.workRadius * cfg.workRadius) {
          const tz = this._aimHit.z - laserR * 0.3;
          let dx = this.aimX - d.p[0], dy = this.aimY - d.p[1], dz = tz - d.p[2];
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          dx /= l; dy /= l; dz /= l;
          const hit = this.mining.raycast(d.p[0], d.p[1], d.p[2], dx, dy, dz, 8000, null, d.hit);
          if (hit) {
            this.mining.laser(hit.body, hit.x, hit.y, hit.z, dx, dy, dz, cfg.dronePower, dt, this.yield);
            d.laserOn = true;
          }
        }
      }
      // Kierunek drona (render): do celu przy pracy, inaczej z ruchem / za statkiem.
      let yawTarget = d.yaw;
      if (d.role === 1) yawTarget = Math.atan2(this.aimY - d.p[1], this.aimX - d.p[0]);
      else if (d.role === 2) yawTarget = Math.atan2(saw.dy, saw.dx);
      else if (d.v[0] * d.v[0] + d.v[1] * d.v[1] > 400) yawTarget = Math.atan2(d.v[1], d.v[0]);
      else yawTarget = -ship.angle;
      let dyaw = yawTarget - d.yaw;
      dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
      d.yaw += dyaw * (1 - Math.exp(-6 * dt));
    }
  }

  _stepSaw(dt) {
    const sw = this.saw;
    this.sawPoint.hit = false;
    if (!sw.active || sw.done) return;
    const cfg = this.cfg;
    const mining = this.mining;
    // Punkt piły i skała pod nim: tempo zależy od twardości skały.
    const px = sw.x0 + sw.dx * sw.t, py = sw.y0 + sw.dy * sw.t;
    const under = this._probeDown(px, py, this._probeHit);
    const hard = under ? under.body.material.hardness : 0;
    const speed = under ? cfg.sawSpeed / (0.2 + hard) : cfg.sawSpeedAir;
    sw.t = Math.min(sw.len, sw.t + speed * dt);
    const sp = this.sawPoint;
    sp.x = px; sp.y = py; sp.z = under ? under.z : -200; sp.hit = !!under;
    // Cięcie pasem [cutT, t] co sawInterval (i na końcu linii).
    if (this.time >= sw.nextCut || sw.t >= sw.len) {
      sw.nextCut = this.time + cfg.sawInterval;
      const from = sw.cutT - 20, to = sw.t + 20;
      const sweep = this._sweep;
      sweep.x = sw.dx; sweep.y = sw.dy; sweep.z = 0; sweep.from = from; sweep.to = to;
      const bodies = mining.bodies;
      // Od końca: rozpad dopisuje nowe ciała na koniec, usuwa tylko cięte (niższe indeksy bez zmian).
      for (let i = bodies.length - 1; i >= 0; i--) {
        const body = bodies[i];
        if (!body || !body.alive) continue;
        const r = body.boundR;
        const ex = body.p[0] - sw.x0, ey = body.p[1] - sw.y0;
        const along = ex * sw.dx + ey * sw.dy;
        const off = Math.abs(ex * sw.nx + ey * sw.ny);
        if (off > r || along + r < from || along - r > to) continue;
        const res = mining.slice(body, sw.x0, sw.y0, body.p[2], sw.nx, sw.ny, 0, cfg.sawKerf, sweep, this.yield);
        sw.cut += res.lost || 0;
        if (res.bodies && res.bodies.length) this._say(`Piła przecięła skałę: ${res.bodies.length + 1} części`);
      }
      sw.cutT = sw.t;
    }
    if (sw.t >= sw.len) { sw.done = true; sw.doneAt = this.time; this._say('Piła: koniec cięcia'); }
  }

  _stepTractor(dt, ship) {
    this.tractorCount = 0;
    if (!this.tractorOn || !this.enabled) return;
    const cfg = this.cfg;
    const tx = ship.x, ty = -ship.y, tz = 0;
    // Ile rudy jeszcze wejdzie (ułamki czekające w urobku też zajmują miejsce).
    let free = Infinity;
    if (this.cargoFree) {
      let pending = 0;
      for (let i = 0; i < MINING_ORE_KEYS.length; i++) pending += this.yield.ore[MINING_ORE_KEYS[i]];
      free = Math.max(0, Number(this.cargoFree()) - pending);
    }
    const got = this.mining.tractor(tx, ty, tz, cfg.tractorRadius, cfg.tractorCapacity, cfg.tractorCapture, dt, this.yield, 1, free);
    for (let i = 0; i < got.length; i++) {
      const g = got[i];
      this.totals.collected++;
      this._fx(MINING_FX.COLLECT, g.x, g.y, g.z, g.ore, 0, 0, g.oreRes);
      const res = g.oreRes ? RESOURCES[g.oreRes] : null;
      if (g.ore > 0.05 && res) this._say(`+${fmt1(g.ore)} t: ${res.label.toLowerCase()} (${g.kind === 'body' ? 'odłam' : 'okruch'})`);
    }
    // Cele do rysowania: najbliższe (do tractorTargets) w zasięgu i udźwigu.
    const P = this.mining.pebbles;
    for (let i = 0; i < P.length; i++) this._considerTractor(P[i], P[i].mass, tx, ty, tz);
    const B = this.mining.bodies;
    for (let i = 0; i < B.length; i++) this._considerTractor(B[i], B[i].mass, tx, ty, tz);
    if (free <= 0.5 && this.time - this._fullWarnT > 4) {
      this._fullWarnT = this.time;
      this._say('Ładownia pełna — wiązka trzyma urobek przy statku');
    }
  }

  // Wstawienie celu wiązki do posortowanej listy najbliższych (bez alokacji).
  _considerTractor(o, mass, tx, ty, tz) {
    const cfg = this.cfg;
    if (mass > cfg.tractorCapacity) return;
    const dx = o.p[0] - tx, dy = o.p[1] - ty, dz = o.p[2] - tz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > cfg.tractorRadius * cfg.tractorRadius) return;
    const list = this.tractorTargets;
    const dist = this._tractorDist;
    const cap = list.length;
    let n = this.tractorCount;
    let at = n;
    while (at > 0 && dist[at - 1] > d2) at--;
    if (at >= cap) return;
    const last = Math.min(n, cap - 1);
    for (let k = last; k > at; k--) { list[k] = list[k - 1]; dist[k] = dist[k - 1]; }
    list[at] = o.p;
    dist[at] = d2;
    if (n < cap) n++;
    this.tractorCount = n;
  }

  _detonateNext() {
    const ch = this._detQueue.shift();
    if (!ch) return;
    const mining = this.mining;
    const w = ch.body.localToWorld(ch.local[0], ch.local[1], ch.local[2], [0, 0, 0]);
    // Ciało mogło się rozpaść: ładunek siedzi w tym, które ma go w środku.
    let body = ch.body.alive ? ch.body : null;
    if (!body || body.sample(ch.local[0], ch.local[1], ch.local[2]) < 0.3) {
      body = null;
      const l = [0, 0, 0];
      for (let i = 0; i < mining.bodies.length; i++) {
        const b = mining.bodies[i];
        b.worldToLocal(w[0], w[1], w[2], l);
        if (b.sample(l[0], l[1], l[2]) >= 0.3) { body = b; break; }
      }
    }
    this._heavy--;
    if (!body) {
      this._fx(MINING_FX.CONTAINED, w[0], w[1], w[2], ch.energy * 0.35, 0, 0, null);
      this._say(`Ładunek ${ch.id}: wybuch w próżni (skała odleciała)`);
      return;
    }
    const t0 = nowMs();
    const res = mining.detonate(body, w[0], w[1], w[2], ch.energy, this.yield);
    this.stats.heavyMs = nowMs() - t0;
    this.totals.blasts++;
    const pieces = res.bodies.length + res.pebbles.length + res.gravel.length;
    if (res.outcome === 'breach') this._say(`Wybuch ${ch.id}: ${pieces} odłamów`);
    else this._say(`Ładunek ${ch.id} za słaby — skała pękła w środku, skorupa trzyma (następny sięgnie dalej)`);
    if (this.onBlast) this.onBlast(w[0], -w[1], res.energy, res.outcome);
  }

  _drainMiningEvents() {
    const ev = this.mining.drainEvents();
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.kind === 'blast') {
        this._fx(e.outcome === 'breach' ? MINING_FX.BLAST : MINING_FX.CONTAINED, e.x, e.y, e.z, e.energy, e.outcome === 'breach' ? e.rc : e.rf * 0.3, e.pieces || 0, e.body?.oreRes || null);
      } else if (e.kind === 'split') {
        const b = e.body;
        if (b) this._fx(MINING_FX.SPLIT, b.p[0], b.p[1], b.p[2], 0, b.boundR, e.pieces || 0, b.oreRes);
      }
      // 'collect' — zdarzenia efektów pisze już _stepTractor (pozycje złapanych).
    }
  }

  _flushYield() {
    const y = this.yield;
    const T = this.totals;
    for (let i = 0; i < MINING_ORE_KEYS.length; i++) {
      const key = MINING_ORE_KEYS[i];
      const t = y.ore[key];
      if (!(t >= 1)) continue;
      const whole = Math.floor(t);
      y.ore[key] = t - whole;
      let took = whole;
      if (this.onCargo) took = Math.max(0, Math.min(whole, Math.floor(Number(this.onCargo(key, whole)) || 0)));
      T.ore[key] += took;
      if (took < whole) {
        T.lostOre += whole - took;
        if (this.time - this._fullWarnT > 4) {
          this._fullWarnT = this.time;
          this._say('Ładownia pełna — urobek laserów przepada');
        }
      }
    }
    if (y.waste > 0) { T.waste += y.waste; y.waste = 0; }
    if (y.lost > 0) { T.lost += y.lost; y.lost = 0; }
  }

  _stepHover() {
    if (!this.enabled || !this.hasCursor) { this.hover = null; return; }
    if (this.time - this._hoverT < this.cfg.hoverInterval && this.time >= this._hoverT) return;
    this._hoverT = this.time;
    const h = this.mining.raycast(this.cursorX, this.cursorY, 6000, 0, 0, -1, 1e6);
    if (!h) { this.hover = null; return; }
    const pr = this.mining.probe(h.body, h.x, h.y, h.z - 1);
    const need = chargeForDepth(h.body.material, Math.max(pr.depth, this.mining.cfg.laserRadius));
    this.hover = { hit: h, probe: pr, need };
  }

  _releaseFar(ship) {
    const cfg = this.cfg;
    const sx = ship.x, sy = -ship.y;
    const R2 = cfg.farRelease * cfg.farRelease;
    const m = this.mining;
    for (let i = m.bodies.length - 1; i >= 0; i--) {
      const b = m.bodies[i];
      const dx = b.p[0] - sx, dy = b.p[1] - sy;
      if (dx * dx + dy * dy <= R2) continue;
      // Nietknięta skała wraca do pola; naruszona zostaje schowana (rozebrana).
      const fieldId = b.userData?.fieldId;
      if (fieldId && b.generation === 0 && b.version <= 1 && !b.damage) this._unhideRock(fieldId);
      m.release(b);
    }
    for (let i = m.pebbles.length - 1; i >= 0; i--) {
      const p = m.pebbles[i];
      const dx = p.p[0] - sx, dy = p.p[1] - sy;
      if (dx * dx + dy * dy <= R2) continue;
      p.alive = false;
      m.pebbles.splice(i, 1);
    }
    for (let i = this.charges.length - 1; i >= 0; i--) if (!this.charges[i].body.alive) this.charges.splice(i, 1);
  }

  // --- Skały pola -------------------------------------------------------------------

  /**
   * Skała pola PLAY pod punktem (przestrzeń skał) → ciało fizyki (zakotwiczone).
   * Najwyższy wierzch spośród skał, w których obrysie leży punkt. Zwraca ciało albo null.
   */
  _activateAt(x, y) {
    if (!this.field) return null;
    const wx = x, wy = -y;
    const reach = this.cfg.pickReach;
    let best = null, bestTop = -Infinity, bestZ = 0;
    this.field.forEachRockInRect(BELT_BAND.PLAY, wx - reach, wy - reach, wx + reach, wy + reach, 0, (rock) => {
      if (this.taken.has(rock.id)) return;
      const s = Math.max(rock.sx ?? 1, rock.sy ?? 1, rock.sz ?? 1);
      const R = rock.r * s * 1.05;
      const dx = rock.x - wx, dy = rock.y - wy;
      if (dx * dx + dy * dy > R * R) return;
      const z = this.playZ(rock);
      const top = z + rock.r * s;
      if (top > bestTop) { bestTop = top; best = rock; bestZ = z; }
    });
    if (!best) return null;
    const t0 = nowMs();
    const body = this.mining.activate(best, { z: bestZ, time: this._rockTime(), sunT: this._sunT(best.x, best.y), anchored: true });
    this.stats.heavyMs = nowMs() - t0;
    this.stats.activations++;
    body.userData = { fieldId: best.id };
    this._hideRock(best.id);
    this._fx(MINING_FX.ACTIVATE, body.p[0], body.p[1], body.p[2], 0, body.boundR, 0, body.oreRes);
    const label = ROCK_TYPE_LABELS_PL[body.typeId] || body.typeId;
    const hidden = body.oreTypeId && body.typeId === 'rock' ? ' (ukryty rdzeń!)' : '';
    this._say(`Przejęta skała: ${label}, r ${Math.round(best.r)} j., ${fmt1(body.mass)} t, rudy ${fmt1(body.oreMass)} t${hidden}`);
    return body;
  }

  _hideRock(id) {
    if (!this.taken.has(id)) { this.taken.add(id); this.takenVersion++; }
  }

  _unhideRock(id) {
    if (this.taken.delete(id)) this.takenVersion++;
  }

  /** Pionowy promień w dół w punkcie (przestrzeń skał) — trafienie albo null. */
  _probeDown(x, y, out) {
    return this.mining.raycast(x, y, 6000, 0, 0, -1, 1e6, null, out);
  }

  _takeHeavy() {
    if (this._heavy <= 0) return false;
    this._heavy--;
    return true;
  }

  _rockTime() { return this.timeSource ? Number(this.timeSource()) || 0 : 0; }

  _sunT(x, y) { return this.sunT ? this.sunT(x, y) : 1; }

  _fx(kind, x, y, z, energy, size, n, res) {
    const e = this.fx[this.fxWrite % FX_CAP];
    e.kind = kind; e.x = x; e.y = y; e.z = z; e.energy = energy; e.size = size; e.n = n; e.res = res; e.t = this.time;
    this.fxWrite++;
  }

  _say(text) {
    const m = this.messages[this.messageWrite % this.messages.length];
    m.text = text;
    m.t = this.time;
    this.messageWrite++;
    if (this.onMessage) this.onMessage(text);
  }

  /** Ostatnie komunikaty (od najnowszego), najwyżej `n`, nie starsze niż messageLife. */
  recentMessages(n = 3, out = []) {
    out.length = 0;
    const cap = this.messages.length;
    for (let i = 1; i <= Math.min(cap, this.messageWrite) && out.length < n; i++) {
      const m = this.messages[(this.messageWrite - i) % cap];
      if (this.time - m.t <= this.cfg.messageLife) out.push(m.text);
    }
    return out;
  }

  /** Czy drony / piła / wiązka / ładunki coś robią (render: drony widoczne). */
  get busy() {
    if (this.enabled) return true;
    for (let i = 0; i < this.drones.length; i++) if (!this.drones[i].parked) return true;
    return this.charges.length > 0 || this._detQueue.length > 0;
  }
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
