/**
 * beamPhysicalWeapons3D — bronie, które niszczą PRZEZ SOLVER (docs/PLAN-zniszczenia-swiata-3d.md § 3).
 *
 * Taran wygląda dobrze, bo pęd przechodzi przez solver: zgniot, belki gną się i pękają z przeciążenia,
 * odłamy niosą pęd. Dawne trafienia (krater, teleport węzłów, kasowanie pasa) solver omijały — „dzieje
 * się natychmiast”. Tu broń NIE kasuje węzłów i nie przesuwa ich pozycji. Oddaje konstrukcji:
 *  - PĘD — pocisk działa to ciało jednowęzłowe, Hexlance to pręt z belek (zwykłe ciało silnika).
 *    „Orka”: węzły na torze w kolejności, z każdym zderzenie niesprężyste z węzłem i jego NIECKĄ
 *    (pierścienie sąsiadów po całych belkach), pocisk traci dokładnie tyle pędu, ile oddał.
 *    Rdzeń leci z pociskiem i rwie belki do niecki, niecka się wgniata, konstrukcja dostaje pęd
 *    i obrót (impuls kątowy w środku trafienia);
 *  - CIŚNIENIE — rakieta: fala z frontem biegnącym od wybuchu; węzeł dostaje prędkość (∝ 1/d²),
 *    gdy front przez niego przechodzi;
 *  - CIEPŁO — wiązka: temperatura węzła (`temp`), przewodzenie po belkach, osłabienie belek
 *    (`brk`, `stiffness` × f(T), presety typu przy ostygnięciu), topnienie = ablacja (węzeł odpada
 *    kroplą w stronę strzelca, sąsiedzi dostają odrzut).
 * Tryb `legacy` (A/B, przełącznik dema): dawne trafienia — `applyImpact` (krater / teleport węzłów),
 * fala rakiety z dema, rzaz Hexlance gry (kasowanie pasa + sztuczny impuls), wiązka tykająca kraterami.
 *
 * Bez three: logika na magazynach silnika (destructorBeams3D). Pręt Hexlance powstaje z szablonu
 * (`setLanceStructure` — demo buduje go z modelu, więc ma skórę), rysuje się, gnie i łamie jak każde
 * ciało; dopóki leci szybko, kontakty silnika go pomijają (`pairFilter`), a pęd oddaje orką z CCD
 * (odcinek grotu z kroku). Wbity — jedzie z ciałem, które go zatrzymało.
 * Jednostki strojenia: demo (stacja 120 j., komórka ~2,7 j.); w grze przeliczyć (F1/F2 planu).
 */

import { BEAM_PRESETS } from './beamBody3D.js';
import { activateNode } from './beamActiveRegion3D.js';
import { traceBeamShot } from './beamWeapons3D.js';
import { cloneBeamStructure } from './beamCrashScene3D.js';

export const PW = Object.freeze({ CANNON: 0, ROCKET: 1, BEAM: 2, LANCE: 3 });
export const PW_NAMES = Object.freeze(['DZIAŁO', 'RAKIETA', 'WIĄZKA', 'HEXLANCE']);

/** Strojenie (jednostki dema). Suwaki dema piszą tu na żywo. */
export function createPhysicalWeaponTuning() {
  return {
    // Ułamek pędu pocisku oddany strzelcowi (zasada zachowania = 1; 0 = bez odrzutu). Myśliwiec dema waży ~3 800,
    // a pręt 2400 × 320 j/s — przy pełnym odrzucie odleciałby do tyłu z setkami j/s (Atlas w grze waży ~800 tys.).
    recoil: 0.12,
    // --- działo: pęd, ciało jednowęzłowe ---
    cannonRate: 8,            // strzałów/s
    cannonSpeed: 420,         // j/s
    cannonMass: 40,           // masa pocisku (węzeł stacji ≈ 8,5)
    cannonRadius: 0.35,       // promień pocisku w komórkach
    cannonLife: 2.4,
    // --- orka: niecka i hamowanie (wspólne dla działa i pręta) ---
    dishRings: 2,             // pierścienie sąsiadów po belkach, które jadą z trafionym węzłem
    dishWeight: 0.4,          // udział pierwszego pierścienia (dalej liniowo w dół)
    // Niecka maleje z prędkością uderzenia: przy szybkim trafieniu otoczenie nie zdąży przejąć
    // obciążenia (fala naprężeń jest wolniejsza od pocisku) — rdzeń wylatuje korkiem, a wolny
    // pocisk wgniata szerszą nieckę. Udział × min(1, dishSpeed / prędkość względna).
    dishSpeed: 90,
    lateral: 0.35,            // rozchylenie niecki od osi pocisku (płatki brzegu otworu)
    stopSpeed: 10,            // j/s względem węzła — poniżej pocisk utyka
    impactHeat: 0.0009,       // ciepło ze straty energii zderzenia (na jednostkę energii / masę węzła)
    // --- rakieta: ciśnienie ---
    rocketRate: 1.5,
    rocketSpeed: 165,
    rocketMass: 20,
    rocketLife: 6,
    blastRadius: 3.2,         // komórki (demo: suwak „Promień eksplozji”)
    blastTime: 0.16,          // s — tyle front idzie do brzegu fali
    blastKick: 520,           // j/s prędkości węzła komórkę od środka (∝ 1/d², × siła uzbrojenia / 450)
    blastKickMax: 800,
    blastForward: 0.3,        // domieszka kierunku lotu rakiety do kopnięcia promieniowego
    blastHeat: 0.9,           // temperatura węzła tuż przy kuli ognia (przy kopnięciu maks.)
    // --- wiązka: ciepło ---
    beamRange: 700,
    beamPower: 7,             // temperatura/s w osi wiązki
    beamRadius: 1.1,          // sigma plamy w komórkach
    conduct: 0.8,             // przewodzenie po belkach [1/s]
    cool: 0.25,               // stygnięcie [1/s]
    soften: 0.6,              // od tej temperatury belki tracą wytrzymałość…
    melt: 2.0,                // …a tu węzeł odparowuje (ablacja)
    ablateSpeed: 35,          // j/s kropli w stronę strzelca
    ablateRecoil: 6,          // j/s odrzutu sąsiadów w głąb
    // --- Hexlance: pręt ---
    lanceSpeed: 320,
    lanceMass: 2400,          // ocena użytkownika 2026-10-05: „zdecydowanie większa masa” (było 600)
    lanceCooldown: 1.2,
    lanceSoftness: 0.2,       // ułamek reakcji, który gniecie grot (reszta hamuje pręt jako całość)
    lanceToughness: 1.5,      // materiał pręta: progi plastyczności i zerwania belek × to (twardszy od blachy celu)
    lanceRadius: 1.8,         // promień orki głowicy w komórkach CELU
    // Pręt niszczy jak taran (prośba użytkownika: „niczym statek niszczy stację”): szeroka niecka —
    // otoczenie toru jedzie z głowicą, gnie się i odrywa sekcjami, zamiast samego wąskiego kanału.
    lanceDishSpeed: 500,
    lanceDishRings: 3,
    lanceLife: 20,
    lanceContactSpeed: 25,    // j/s — wolniejszy pręt wraca do zwykłych kontaktów silnika
    // --- stare trafienia (A/B) ---
    legacyDamage: 450,
    legacyRadius: 3,          // komórki (rakieta)
    legacyLanceBand: 1.6,     // komórki — pas rzazu Hexlance gry (kasowanie węzłów)
    legacyLancePush: 30,      // j/s — sztuczny impuls rzazu (masa wyciętego × to)
    legacyBeamTick: 0.05,     // s — wiązka gry: krater co tyle
    legacyBeamDamage: 60
  };
}

const SHELL_CAPACITY = 256;
const BLAST_CAPACITY = 32;
const EFFECT_CAPACITY = 128;
const LEGACY_BLAST_DURATION = 0.22;

function smooth01(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-9, e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Odchylenie z haszu (bez Math.random — wynik nie zależy od kolejności losowań gry).
function hash01(a, b) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return ((h >>> 0) % 100000) / 100000;
}

export class PhysicalWeapons3D {
  constructor(system, opts = {}) {
    this.system = system;
    this.tune = createPhysicalWeaponTuning();
    if (opts.tune) Object.assign(this.tune, opts.tune);
    this.convergence = opts.convergence ?? 450;
    this.legacy = false;
    this.selected = PW.CANNON;
    this.shells = Array.from({ length: SHELL_CAPACITY }, () => ({
      active: false, kind: 0, legacy: false, owner: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      mass: 0, radius: 0, age: 0, life: 0, stopped: false, serial: 0, dishSpeed: 0, dishRings: -1 }));
    this.blasts = Array.from({ length: BLAST_CAPACITY }, () => ({
      active: false, legacy: false, owner: null, x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 0,
      age: 0, radius: 0, kick: 0, frontR: 0, damage: 0 }));
    this.effects = Array.from({ length: EFFECT_CAPACITY }, () => ({
      active: false, kind: 0, x: 0, y: 0, z: 0, age: 0, life: 0, radius: 0 }));
    this.rods = [];
    this.beam = { on: false, active: false, hit: false, owner: null, legacy: false,
      x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, legacyWait: 0 };
    this.hot = new Set();
    this.lanceStructure = null;
    this.wait = new Float64Array(4);
    this.time = 0;
    this._serial = 0;
    this._shellCursor = 0; this._effectCursor = 0; this._barrel = 0;
    this.stats = { shots: [0, 0, 0, 0], hits: [0, 0, 0, 0], impulse: 0, lastHit: -1, active: 0, ablated: 0 };
    // Bufory orki (bez alokacji w kroku).
    this._candT = new Float64Array(256); this._candI = new Int32Array(256); this._candP = new Float64Array(256);
    this._hitStamp = new Int32Array(1024); this._hitGen = 0;
    this._dishI = new Int32Array(256); this._dishW = new Float64Array(256); this._dishR = new Int32Array(256);
    this._dishCount = 0;
    this._bodyOrder = []; this._bodyKey = [];
    this._plowOut = { stopped: false, stopAt: 0, impulse: 0, body: null, hit: false };
    this._hit = {};
    this._v = { x: 0, y: 0, z: 0 }; this._w = { x: 0, y: 0, z: 0 };
    this._muzzle = { x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0 };
    this._rodShell = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mass: 0, radius: 0, owner: null, self: null, stopped: false,
      dishSpeed: 0, dishRings: -1 };
    this._installHooks();
  }

  /** Szablon pręta Hexlance (struktura belek z modelu, oś +X = kierunek lotu). */
  setLanceStructure(structure) { this.lanceStructure = structure || null; }

  reset() {
    for (const p of this.shells) { p.active = false; p.owner = null; }
    for (const b of this.blasts) { b.active = false; b.owner = null; }
    for (const e of this.effects) e.active = false;
    for (const r of this.rods) { if (r.body) { r.body.dead = true; r.body._rodFast = false; r.body._rodHost = null; } }
    this.rods.length = 0;
    this.beam.on = this.beam.active = this.beam.hit = false; this.beam.owner = null;
    this.hot.clear();
    this.wait.fill(0);
    this.time = 0;
    this.stats.shots.fill(0); this.stats.hits.fill(0);
    this.stats.impulse = 0; this.stats.lastHit = -1; this.stats.active = 0; this.stats.ablated = 0;
  }

  // Pręt szybki = poza kontaktami silnika (pęd oddaje orką); wbity = bez kontaktu z gospodarzem.
  // Wrak gorącego ciała dziedziczy temperaturę węzłów — trafia na listę gorących.
  _installHooks() {
    const sys = this.system, self = this;
    if (sys.__physicalWeaponsHooked) { sys.__physicalWeapons = this; return; }
    sys.__physicalWeaponsHooked = true;
    sys.__physicalWeapons = this;
    const prevFilter = sys.pairFilter;
    sys.pairFilter = function physicalWeaponsPairFilter(A, B) {
      if (A._rodFast || B._rodFast) return false;
      if ((A._rodHost && A._rodHost === B) || (B._rodHost && B._rodHost === A)) return false;
      return prevFilter ? prevFilter(A, B) : true;
    };
    const prevWreck = sys.onWreck;
    sys.onWreck = function physicalWeaponsOnWreck(parent, wreck) {
      const weapons = sys.__physicalWeapons || self;
      if (parent && weapons.hot.has(parent)) weapons.hot.add(wreck);
      if (prevWreck) prevWreck(parent, wreck);
    };
  }

  // ------------------------------------------------------------------ STRZAŁ

  /** Spust trzymany w kroku fizyki: wybrana broń (LPM) i rakiety (PPM). */
  hold(dt, owner, bodies, primary, secondary) {
    for (let k = 0; k < 4; k++) this.wait[k] = Math.max(-dt, this.wait[k] - dt);
    const ok = owner && !owner.dead && !owner.static;
    this.beam.on = !!(ok && primary && this.selected === PW.BEAM);
    this.beam.owner = ok ? owner : null;
    if (!ok) return;
    if (primary && this.selected !== PW.BEAM) this.fire(this.selected, owner, bodies);
    if (secondary) this.fire(PW.ROCKET, owner, bodies);
  }

  fire(kind, owner, bodies) {
    if (!owner || owner.dead || owner.static || kind === PW.BEAM) return false;
    if (this.wait[kind] > 1e-8) return false;
    const t = this.tune;
    let ok = false;
    if (kind === PW.LANCE && !this.legacy) ok = this._fireLance(owner, bodies);
    else ok = this._fireShell(kind, owner);
    if (!ok) return false;
    this.wait[kind] += kind === PW.CANNON ? 1 / t.cannonRate : kind === PW.ROCKET ? 1 / t.rocketRate : t.lanceCooldown;
    this.stats.shots[kind]++;
    return true;
  }

  // Wylot: dziób + naprzemienne lufy (oś lokalna Z), zbieżność na `convergence` przed dziobem.
  _aim(owner, side) {
    const m = this.system._refreshRot(owner), b = owner._localBounds, o = this._muzzle;
    const nose = b ? b[0] + b[3] + owner.cellSize : owner.radius;
    const off = side * (b ? b[5] * 0.6 : owner.radius * 0.25);
    o.x = owner.pos.x + m[0] * nose + m[2] * off;
    o.y = owner.pos.y + m[3] * nose + m[5] * off;
    o.z = owner.pos.z + m[6] * nose + m[8] * off;
    const conv = this.convergence;
    let dx = m[0] * conv - m[2] * off, dy = m[3] * conv - m[5] * off, dz = m[6] * conv - m[8] * off;
    const inv = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1);
    o.dx = dx * inv; o.dy = dy * inv; o.dz = dz * inv;
    return o;
  }

  _fireShell(kind, owner) {
    let p = null;
    for (let j = 0; j < SHELL_CAPACITY; j++) {
      const k = (this._shellCursor + j) % SHELL_CAPACITY;
      if (!this.shells[k].active) { p = this.shells[k]; this._shellCursor = (k + 1) % SHELL_CAPACITY; break; }
    }
    if (!p) return false;
    const t = this.tune, cs = this.system.config.cellSize;
    const side = kind === PW.LANCE ? 0 : (this._barrel++ % 2 ? 1 : -1);
    const o = this._aim(owner, side);
    const speed = kind === PW.CANNON ? t.cannonSpeed : kind === PW.ROCKET ? t.rocketSpeed : t.lanceSpeed;
    p.kind = kind; p.legacy = this.legacy; p.owner = owner; p.stopped = false; p.serial = ++this._serial;
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.dx * speed + owner.vel.x; p.vy = o.dy * speed + owner.vel.y; p.vz = o.dz * speed + owner.vel.z;
    p.mass = kind === PW.CANNON ? t.cannonMass : kind === PW.ROCKET ? t.rocketMass : t.lanceMass;
    p.radius = cs * (kind === PW.CANNON ? t.cannonRadius : kind === PW.ROCKET ? 0.3 : t.legacyLanceBand);
    p.age = 0;
    p.life = kind === PW.CANNON ? t.cannonLife : kind === PW.ROCKET ? t.rocketLife : 3;
    p.active = true;
    // Odrzut: pęd pocisku względem strzelca wraca na strzelca (stare trafienia — bez odrzutu, jak w grze).
    if (!this.legacy) this._recoil(owner, o.dx * speed * p.mass, o.dy * speed * p.mass, o.dz * speed * p.mass);
    return true;
  }

  _recoil(owner, px, py, pz) {
    const k = this.tune.recoil;
    if (!(k > 0) || owner.static || owner.anchored || !(owner.mass > 0)) return;
    owner.vel.x -= px * k / owner.mass; owner.vel.y -= py * k / owner.mass; owner.vel.z -= pz * k / owner.mass;
  }

  _fireLance(owner, bodies) {
    const st = this.lanceStructure;
    if (!st || !Array.isArray(bodies)) return false;
    const sys = this.system, t = this.tune;
    const o = this._aim(owner, 0);
    const body = sys.createBody(cloneBeamStructure(st), {
      name: 'hexlance', massMultiplier: t.lanceMass / Math.max(1e-6, st.mass), collisionArmor: 4
    });
    // Materiał pręta: twardszy od blachy celu (kopia magazynu belek — szablon bez zmian).
    const tough = Math.max(1, Number(t.lanceToughness) || 1);
    if (tough !== 1) {
      const e = body.beamStore;
      for (let bi = 0; bi < e.count; bi++) { e.brk[bi] *= tough; e.deform[bi] *= tough; }
    }
    // Oś lokalna +X → kierunek strzału (kwaternion jak w launchCrashPairs).
    const w = 1 + o.dx;
    if (w < 1e-8) Object.assign(body.quat, { x: 0, y: 1, z: 0, w: 0 });
    else {
      const inv = 1 / Math.hypot(o.dy, o.dz, w);
      Object.assign(body.quat, { x: 0, y: -o.dz * inv, z: o.dy * inv, w: w * inv });
    }
    body._rotTick = -1;
    const lb = body._localBounds;
    const tail = lb ? lb[3] - lb[0] : body.radius;      // od środka masy do tyłu pręta
    const lead = tail + owner.cellSize * 1.5;
    body.pos.x = o.x + o.dx * lead; body.pos.y = o.y + o.dy * lead; body.pos.z = o.z + o.dz * lead;
    body.vel.x = owner.vel.x + o.dx * t.lanceSpeed;
    body.vel.y = owner.vel.y + o.dy * t.lanceSpeed;
    body.vel.z = owner.vel.z + o.dz * t.lanceSpeed;
    body._rodFast = true;
    body._rodHost = null;
    body.isProjectile = true;
    bodies.push(body);
    const rod = { body, owner, age: 0, host: null, tipX: 0, tipY: 0, tipZ: 0, _tx: 0, _ty: 0, _tz: 0,
      relX: 0, relY: 0, relZ: 0, relQ: { x: 0, y: 0, z: 0, w: 1 }, lastHitBody: null, lastHitAge: -1,
      anchor: -1, anchorStore: null, anchorIx: 0, anchorIy: 0, anchorIz: 0 };
    this._rodTip(rod);
    rod.tipX = rod._tx; rod.tipY = rod._ty; rod.tipZ = rod._tz;
    this.rods.push(rod);
    this._recoil(owner, o.dx * t.lanceSpeed * body.mass, o.dy * t.lanceSpeed * body.mass, o.dz * t.lanceSpeed * body.mass);
    return true;
  }

  // Grot pręta w świecie (do rod._tx…): środek przedniej ściany obwiedni lokalnej.
  _rodTip(rod) {
    const B = rod.body, m = this.system._refreshRot(B), lb = B._localBounds;
    const lx = lb ? lb[0] + lb[3] : B.radius, ly = lb ? lb[1] : 0, lz = lb ? lb[2] : 0;
    rod._tx = B.pos.x + m[0] * lx + m[1] * ly + m[2] * lz;
    rod._ty = B.pos.y + m[3] * lx + m[4] * ly + m[5] * lz;
    rod._tz = B.pos.z + m[6] * lx + m[7] * ly + m[8] * lz;
  }

  // ------------------------------------------------------------------ KROK

  /** Krok broni — po `integrate`, przed `update` silnika (jak dema). */
  update(dt, bodies) {
    if (!(dt > 0)) return;
    this.time += dt;
    this.stats.active = 0;
    this._updateRods(dt, bodies);
    this._updateShells(dt, bodies);
    this._updateBlasts(dt, bodies);
    this._updateBeam(dt, bodies);
    this._updateThermal(dt);
    for (const e of this.effects) if (e.active) { e.age += dt; if (e.age >= e.life) e.active = false; }
    this.stats.impulse *= Math.exp(-dt * 1.5);
  }

  _effect(kind, x, y, z, radius, life) {
    const e = this.effects[this._effectCursor++ % EFFECT_CAPACITY];
    e.active = true; e.kind = kind; e.x = x; e.y = y; e.z = z; e.radius = radius; e.age = 0; e.life = life;
  }

  _updateShells(dt, bodies) {
    const sys = this.system, t = this.tune, hit = this._hit;
    for (const p of this.shells) {
      if (!p.active) continue;
      if (p.owner && p.owner.dead) p.owner = null;
      const step = Math.min(dt, p.life - p.age);
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
      let travelled = speed * step;
      if (speed > 1e-8 && step > 0) {
        const dx = p.vx / speed, dy = p.vy / speed, dz = p.vz / speed, len = speed * step;
        if (p.kind === PW.LANCE) {
          // Tylko stare trafienia: rzaz gry — kasowanie pasa wzdłuż toru, bez hamowania.
          this._legacyLanceCut(p, bodies, dx, dy, dz, len);
        } else if (p.kind === PW.ROCKET || p.legacy) {
          if (traceBeamShot(sys, bodies, p.owner, p.x, p.y, p.z, dx, dy, dz, len, hit)) {
            travelled = hit.t;
            if (p.kind === PW.ROCKET) this._detonate(p, hit, dx, dy, dz);
            else this._legacyCannonHit(p, hit);
            p.active = false;
          }
        } else {
          travelled = this._plowPath(p, bodies, dx, dy, dz, len);
          if (this._plowOut.hit) {
            this.stats.hits[PW.CANNON]++;
            this._effect(PW.CANNON, p.x + dx * travelled, p.y + dy * travelled, p.z + dz * travelled,
              sys.config.cellSize * 0.8, 0.14);
          }
          if (p.stopped) p.active = false;
        }
        const k = Math.min(travelled, len);
        p.x += dx * k; p.y += dy * k; p.z += dz * k;
      }
      p.age += step;
      if (p.age >= p.life - 1e-9) { p.active = false; p.owner = null; }
      if (p.active) this.stats.active++;
    }
  }

  // ------------------------------------------------------------------ PĘD: ORKA

  /**
   * Odcinek lotu pocisku przez ciała (bez strzelca i samego pocisku-ciała) w kolejności wejścia.
   * Zwraca przebytą drogę (< len, gdy pocisk utknął). `p` — {x,y,z, vx,vy,vz, mass, radius, owner,
   * self?, stopped}; prędkość pocisku maleje o oddany pęd.
   */
  _plowPath(p, bodies, dx, dy, dz, len) {
    const order = this._bodyOrder, key = this._bodyKey;
    order.length = 0; key.length = 0;
    for (let n = 0; n < bodies.length; n++) {
      const b = bodies[n];
      if (!b || b.dead || b === p.owner || b === p.self || b.activeNodes <= 0) continue;
      if (b._rodFast) continue;
      const ex = b.pos.x - p.x, ey = b.pos.y - p.y, ez = b.pos.z - p.z;
      const along = ex * dx + ey * dy + ez * dz;
      const r = b.radius + b.cellSize * 2 + p.radius;
      if (along < -r || along > len + r) continue;
      const perp2 = ex * ex + ey * ey + ez * ez - along * along;
      if (perp2 > r * r) continue;
      const entry = along - Math.sqrt(Math.max(0, r * r - perp2));
      let at = order.length;
      order.push(b); key.push(entry);
      while (at > 0 && key[at - 1] > entry) { order[at] = order[at - 1]; key[at] = key[at - 1]; at--; }
      order[at] = b; key[at] = entry;
    }
    const out = this._plowOut;
    let anyHit = false;
    out.body = null;
    out.lastBody = null;
    for (let n = 0; n < order.length; n++) {
      this._plowBody(order[n], p, dx, dy, dz, len);
      if (out.hit) { anyHit = true; out.lastBody = order[n]; }
      if (p.stopped) { out.hit = true; out.body = order[n]; out.lastBody = order[n]; return out.stopAt; }
    }
    out.hit = anyHit;
    return len;
  }

  _plowBody(B, p, dx, dy, dz, len) {
    const sys = this.system, t = this.tune, out = this._plowOut;
    out.hit = false; out.stopAt = len;
    const m = sys._refreshRot(B);
    const rx = p.x - B.pos.x, ry = p.y - B.pos.y, rz = p.z - B.pos.z;
    const lx = m[0] * rx + m[3] * ry + m[6] * rz, ly = m[1] * rx + m[4] * ry + m[7] * rz, lz = m[2] * rx + m[5] * ry + m[8] * rz;
    const ldx = m[0] * dx + m[3] * dy + m[6] * dz, ldy = m[1] * dx + m[4] * dy + m[7] * dz, ldz = m[2] * dx + m[5] * dy + m[8] * dz;
    const s = B.nodeStore, X = s.x, Y = s.y, Z = s.z, active = s.active;
    const nodeR = B.cellSize * 0.55;
    const reach = p.radius + nodeR, reach2 = reach * reach;
    // Kandydaci: węzły w kapsule toru, posortowane po drodze.
    let n = 0;
    for (let i = 0; i < s.count; i++) {
      if (!active[i]) continue;
      const ex = X[i] - lx, ey = Y[i] - ly, ez = Z[i] - lz;
      const tt = ex * ldx + ey * ldy + ez * ldz;
      if (tt < -reach || tt > len + reach) continue;
      const perp2 = ex * ex + ey * ey + ez * ez - tt * tt;
      if (perp2 > reach2) continue;
      if (n === this._candT.length) this._growCandidates();
      let at = n++;
      while (at > 0 && this._candT[at - 1] > tt) {
        this._candT[at] = this._candT[at - 1]; this._candI[at] = this._candI[at - 1]; this._candP[at] = this._candP[at - 1]; at--;
      }
      this._candT[at] = tt; this._candI[at] = i; this._candP[at] = Math.sqrt(Math.max(0, perp2));
    }
    if (n === 0) return;
    if (this._hitStamp.length < s.count) this._hitStamp = new Int32Array(Math.max(s.count, this._hitStamp.length * 2));
    let gen = (this._hitGen + 1) | 0; if (gen <= 0) { this._hitStamp.fill(0); gen = 1; }
    this._hitGen = gen;
    const stamp = this._hitStamp, local = !!sys.config.localSolver, free = !B.static && !B.anchored;
    const cfg = sys.config;
    let hot = false;
    for (let k = 0; k < n; k++) {
      const i = this._candI[k];
      if (!active[i] || stamp[i] === gen) continue;
      // Prędkość węzła w świecie: ruch sztywny + własny (lokalny) węzła.
      const nx = X[i], ny = Y[i], nz = Z[i];
      const wx = m[0] * nx + m[1] * ny + m[2] * nz, wy = m[3] * nx + m[4] * ny + m[5] * nz, wz = m[6] * nx + m[7] * ny + m[8] * nz;
      const nvx = B.vel.x + (B.angVel.y * wz - B.angVel.z * wy) + m[0] * s.vx[i] + m[1] * s.vy[i] + m[2] * s.vz[i];
      const nvy = B.vel.y + (B.angVel.z * wx - B.angVel.x * wz) + m[3] * s.vx[i] + m[4] * s.vy[i] + m[5] * s.vz[i];
      const nvz = B.vel.z + (B.angVel.x * wy - B.angVel.y * wx) + m[6] * s.vx[i] + m[7] * s.vy[i] + m[8] * s.vz[i];
      const ux = p.vx - nvx, uy = p.vy - nvy, uz = p.vz - nvz;
      const un2 = ux * ux + uy * uy + uz * uz;
      // Węzeł, który już jedzie z pociskiem (rdzeń z poprzedniego kroku), nie hamuje go drugi raz.
      if (ux * dx + uy * dy + uz * dz <= 0) continue;
      if (un2 < t.stopSpeed * t.stopSpeed) {
        p.stopped = true;
        out.hit = true;
        out.stopAt = Math.max(0, this._candT[k] - p.radius);
        break;
      }
      // Zderzenie niesprężyste z rdzeniem i niecką (pierścienie po całych belkach); niecka węższa
      // przy szybszym uderzeniu (dishSpeed).
      const dishSpeed = p.dishSpeed > 0 ? p.dishSpeed : t.dishSpeed;
      const dishScale = Math.min(1, dishSpeed / Math.sqrt(un2));
      const meff = this._gatherDish(B, i, gen, dishScale, p.dishRings >= 0 ? p.dishRings : t.dishRings);
      const perp = this._candP[k];
      const coupling = perp <= p.radius ? 1 : Math.max(0.3, 1 - 0.7 * (perp - p.radius) / nodeR);
      const mu = p.mass * meff / (p.mass + meff) * coupling;
      const jx = mu * ux, jy = mu * uy, jz = mu * uz;
      p.vx -= jx / p.mass; p.vy -= jy / p.mass; p.vz -= jz / p.mass;
      // Węzły: Δv = w · J / m_eff (rdzeń w = 1) w układzie ciała + rozchylenie od osi toru.
      const ax = jx / meff, ay = jy / meff, az = jz / meff;
      const lax = m[0] * ax + m[3] * ay + m[6] * az, lay = m[1] * ax + m[4] * ay + m[7] * az, laz = m[2] * ax + m[5] * ay + m[8] * az;
      const aLen = Math.sqrt(lax * lax + lay * lay + laz * laz);
      const count = this._dishCount, dishI = this._dishI, dishW = this._dishW;
      // Rozchylenie płatków jest wewnętrzne: bez średniej ważonej masą (niecka przy krawędzi jest
      // niesymetryczna — inaczej pchnięcia boczne dokładałyby pęd, którego pocisk nie miał).
      const lateral = t.lateral > 0 && count > 1;
      let mlx = 0, mly = 0, mlz = 0;
      if (lateral) {
        let sm = 0;
        for (let q = 1; q < count; q++) {
          const d = dishI[q];
          if (s.invMass[d] <= 0) continue;
          this._lateralOf(X[d] - lx, Y[d] - ly, Z[d] - lz, ldx, ldy, ldz, t.lateral * dishW[q] * aLen);
          const md = s.mass[d];
          mlx += this._w.x * md; mly += this._w.y * md; mlz += this._w.z * md; sm += md;
        }
        if (sm > 0) { mlx /= sm; mly /= sm; mlz /= sm; }
      }
      for (let q = 0; q < count; q++) {
        const d = dishI[q];
        if (s.invMass[d] <= 0) continue;
        const w = dishW[q];
        s.vx[d] += lax * w; s.vy[d] += lay * w; s.vz[d] += laz * w;
        if (q > 0 && lateral) {
          // Od osi toru (w układzie ciała): płatki brzegu otworu rozchylają się na boki.
          this._lateralOf(X[d] - lx, Y[d] - ly, Z[d] - lz, ldx, ldy, ldz, t.lateral * w * aLen);
          s.vx[d] += this._w.x - mlx; s.vy[d] += this._w.y - mly; s.vz[d] += this._w.z - mlz;
        }
        if (local) activateNode(B, d);
      }
      // Obrót: impuls w punkcie trafienia (ruch liniowy przejmie solver ze średniej węzłów).
      if (free) this._angularImpulse(B, wx, wy, wz, jx, jy, jz);
      // Strata energii zderzenia grzeje rdzeń (żar w miejscu trafienia).
      if (t.impactHeat > 0) {
        const loss = 0.5 * mu * un2 * coupling;
        // Sufit: uderzenie rozgrzewa do czerwieni / pomarańczu (topi dopiero wiązka).
        const T = s.temp[i] + loss * t.impactHeat / Math.max(1e-6, s.mass[i]);
        s.temp[i] = Math.min(t.melt * 0.45, T);
        hot = true;
      }
      out.hit = true;
      this.stats.impulse += Math.sqrt(jx * jx + jy * jy + jz * jz);
      this.stats.lastHit = this.time;
    }
    if (out.hit) {
      sys.wake(B, cfg.wakeHoldFrames);
      B.meshDirty = true;
      if (hot) this.hot.add(B);
    }
  }

  // Rdzeń + pierścienie sąsiadów po całych belkach (BFS). Zwraca masę efektywną zderzenia:
  // rdzeń + Σ w · m (kotwice nie jadą — rdzeń-kotwica waży jak fundament).
  _gatherDish(B, core, gen, scale = 1, ringCount = this.tune.dishRings) {
    const s = B.nodeStore, e = B.beamStore, t = this.tune;
    const adjStart = s.adjStart, adj = s.adj, ea = e.a, eb = e.b, broken = e.broken, active = s.active;
    const stamp = this._hitStamp, rings = Math.max(0, ringCount | 0), w0 = t.dishWeight * scale;
    let dishI = this._dishI, dishW = this._dishW, ring = this._dishR;
    let count = 1, head = 0;
    dishI[0] = core; dishW[0] = 1; ring[0] = 0; stamp[core] = gen;
    let meff = s.invMass[core] > 0 ? s.mass[core] : s.mass[core] * 20;
    while (head < count) {
      const cur = dishI[head], rc = ring[head]; head++;
      if (rc >= rings) continue;
      const w = w0 * (1 - rc / Math.max(1, rings));
      if (!(w > 0)) continue;
      for (let q = adjStart[cur]; q < adjStart[cur + 1]; q++) {
        const bi = adj[q];
        if (broken[bi]) continue;
        const o = ea[bi] === cur ? eb[bi] : ea[bi];
        if (!active[o] || stamp[o] === gen) continue;
        stamp[o] = gen;
        if (count === dishI.length) {
          const grow = count * 2;
          const ni = new Int32Array(grow); ni.set(dishI); dishI = this._dishI = ni;
          const nw = new Float64Array(grow); nw.set(dishW); dishW = this._dishW = nw;
          const nr = new Int32Array(grow); nr.set(ring); ring = this._dishR = nr;
        }
        dishI[count] = o; dishW[count] = w; ring[count] = rc + 1; count++;
        if (s.invMass[o] > 0) meff += w * s.mass[o];
      }
    }
    this._dishCount = count;
    return meff;
  }

  // Wektor od osi toru (ex,ey,ez względem początku odcinka, kierunek d) o długości `len` → this._w.
  _lateralOf(ex, ey, ez, dx, dy, dz, len) {
    const along = ex * dx + ey * dy + ez * dz;
    const qx = ex - dx * along, qy = ey - dy * along, qz = ez - dz * along;
    const ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
    const k = ql > 1e-6 ? len / ql : 0;
    this._w.x = qx * k; this._w.y = qy * k; this._w.z = qz * k;
  }

  _growCandidates() {
    const n = this._candT.length * 2;
    const t = new Float64Array(n); t.set(this._candT); this._candT = t;
    const i = new Int32Array(n); i.set(this._candI); this._candI = i;
    const p = new Float64Array(n); p.set(this._candP); this._candP = p;
  }

  // Impuls kątowy ciała swobodnego: Δω = I⁻¹ (r × J), r i J w świecie (jak applyInvInertia silnika).
  _angularImpulse(B, rx, ry, rz, jx, jy, jz) {
    const tx = ry * jz - rz * jy, ty = rz * jx - rx * jz, tz = rx * jy - ry * jx;
    const m = B._rot, I = B.invInertiaLocal;
    if (!I) return;
    const lx = m[0] * tx + m[3] * ty + m[6] * tz, ly = m[1] * tx + m[4] * ty + m[7] * tz, lz = m[2] * tx + m[5] * ty + m[8] * tz;
    const scale = 1 / Math.max(1e-6, B.rammingMassMult || 1);
    const ax = (I[0] * lx + I[1] * ly + I[2] * lz) * scale;
    const ay = (I[3] * lx + I[4] * ly + I[5] * lz) * scale;
    const az = (I[6] * lx + I[7] * ly + I[8] * lz) * scale;
    B.angVel.x += m[0] * ax + m[1] * ay + m[2] * az;
    B.angVel.y += m[3] * ax + m[4] * ay + m[5] * az;
    B.angVel.z += m[6] * ax + m[7] * ay + m[8] * az;
  }

  // ------------------------------------------------------------------ PRĘT (HEXLANCE)

  _updateRods(dt, bodies) {
    const sys = this.system, t = this.tune, rods = this.rods;
    let write = 0;
    for (let n = 0; n < rods.length; n++) {
      const rod = rods[n], B = rod.body;
      rod.age += dt;
      if (!B || B.dead || rod.age > t.lanceLife) {
        if (B) { B.dead = true; B._rodFast = false; B._rodHost = null; }
        continue;
      }
      rods[write++] = rod;
      if (rod.host) { this._rideHost(rod, bodies); continue; }
      if (!B._rodFast) continue;
      // Grot po całkowaniu; odcinek z poprzedniego kroku = CCD orki.
      this._rodTip(rod);
      const tx = rod._tx, ty = rod._ty, tz = rod._tz;
      const sx = tx - rod.tipX, sy = ty - rod.tipY, sz = tz - rod.tipZ;
      const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (len > 1e-9) {
        const dx = sx / len, dy = sy / len, dz = sz / len;
        const p = this._rodShell;
        p.x = rod.tipX; p.y = rod.tipY; p.z = rod.tipZ;
        p.vx = B.vel.x; p.vy = B.vel.y; p.vz = B.vel.z;
        p.mass = B.mass; p.owner = rod.owner; p.self = B; p.stopped = false;
        p.radius = sys.config.cellSize * t.lanceRadius;
        p.dishSpeed = t.lanceDishSpeed; p.dishRings = t.lanceDishRings;
        const travelled = this._plowPath(p, bodies, dx, dy, dz, len);
        if (this._plowOut.hit) {
          // Błysk tylko przy wejściu w nowe ciało (orka trwa wiele kroków — błyski się nakładały w białą plamę).
          const fresh = rod.lastHitBody !== this._plowOut.lastBody || rod.age - rod.lastHitAge > 0.1;
          rod.lastHitBody = this._plowOut.lastBody;
          rod.lastHitAge = rod.age;
          this.stats.hits[PW.LANCE]++;
          if (fresh) {
            this._effect(PW.LANCE, rod.tipX + dx * travelled, rod.tipY + dy * travelled, rod.tipZ + dz * travelled,
              sys.config.cellSize * 1.2, 0.18);
          }
          // Reakcja: (1 − miękkość) hamuje pręt jako całość, miękkość gniecie grot (pęd zachowany —
          // ruch węzłów grotu solver przeniesie na ciało).
          const dvx = p.vx - B.vel.x, dvy = p.vy - B.vel.y, dvz = p.vz - B.vel.z;
          const soft = Math.max(0, Math.min(1, t.lanceSoftness));
          B.vel.x += dvx * (1 - soft); B.vel.y += dvy * (1 - soft); B.vel.z += dvz * (1 - soft);
          if (soft > 0) this._crumpleTip(B, dvx * soft, dvy * soft, dvz * soft);
        }
        if (p.stopped) {
          // Utknął: wraca na punkt zatrzymania i jedzie z ciałem, które go zatrzymało.
          const back = len - travelled;
          B.pos.x -= dx * back; B.pos.y -= dy * back; B.pos.z -= dz * back;
          this._embed(rod, this._plowOut.body);
        }
      }
      this._rodTip(rod);
      rod.tipX = rod._tx; rod.tipY = rod._ty; rod.tipZ = rod._tz;
      // Wytracony w materiale (trafił coś przed chwilą) — wbija się w to ciało; wolny w próżni
      // (po wyjściu z konstrukcji) — wraca do zwykłych kontaktów silnika.
      if (!rod.host) {
        const v = Math.sqrt(B.vel.x * B.vel.x + B.vel.y * B.vel.y + B.vel.z * B.vel.z);
        if (v < t.lanceContactSpeed) {
          const last = rod.lastHitBody;
          if (last && !last.dead && rod.age - rod.lastHitAge < 0.25) this._embed(rod, last);
          else B._rodFast = false;
        }
      }
      this.stats.active++;
    }
    rods.length = write;
  }

  // Grot (węzły w 1,5 komórki od przodu) dostaje część reakcji w układzie pręta: gniecie się, może pęknąć.
  _crumpleTip(B, dvx, dvy, dvz) {
    const s = B.nodeStore, m = this.system._refreshRot(B), lb = B._localBounds;
    if (!lb) return;
    const front = lb[0] + lb[3] - B.cellSize * 1.5;
    let tipMass = 0;
    for (let i = 0; i < s.count; i++) if (s.active[i] && s.x[i] >= front) tipMass += s.mass[i];
    if (!(tipMass > 0)) return;
    const k = B.mass / tipMass;
    const lx = (m[0] * dvx + m[3] * dvy + m[6] * dvz) * k;
    const ly = (m[1] * dvx + m[4] * dvy + m[7] * dvz) * k;
    const lz = (m[2] * dvx + m[5] * dvy + m[8] * dvz) * k;
    const local = !!this.system.config.localSolver;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i] || s.x[i] < front) continue;
      s.vx[i] += lx; s.vy[i] += ly; s.vz[i] += lz;
      if (local) activateNode(B, i);
    }
    this.system.wake(B, this.system.config.wakeHoldFrames);
  }

  // Wbicie: pręt przypięty do NAJBLIŻSZEGO węzła gospodarza (komórka ix, iy, iz — tożsamość węzła
  // przeżywa zagęszczenie i rozpad). Układ ciała przesuwa się przy przebudowie (środek masy), węzeł nie —
  // pręt przypięty do układu „wędrował”. Węzeł odleciał z odłamem → pręt leci z odłamem.
  _embed(rod, host) {
    const B = rod.body;
    B._rodFast = false;
    if (!host || host.dead) return;
    const m = this.system._refreshRot(host), s = host.nodeStore;
    const rx = rod._tx - host.pos.x, ry = rod._ty - host.pos.y, rz = rod._tz - host.pos.z;
    const tx = m[0] * rx + m[3] * ry + m[6] * rz, ty = m[1] * rx + m[4] * ry + m[7] * rz, tz = m[2] * rx + m[5] * ry + m[8] * rz;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      const d = (s.x[i] - tx) ** 2 + (s.y[i] - ty) ** 2 + (s.z[i] - tz) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return;
    rod.host = host;
    B._rodHost = host;
    rod.anchor = best; rod.anchorStore = s;
    rod.anchorIx = s.ix[best]; rod.anchorIy = s.iy[best]; rod.anchorIz = s.iz[best];
    const px = B.pos.x - host.pos.x, py = B.pos.y - host.pos.y, pz = B.pos.z - host.pos.z;
    rod.relX = m[0] * px + m[3] * py + m[6] * pz - s.x[best];
    rod.relY = m[1] * px + m[4] * py + m[7] * pz - s.y[best];
    rod.relZ = m[2] * px + m[5] * py + m[8] * pz - s.z[best];
    // q_rel = conj(q_host) ⊗ q_rod
    const a = host.quat, b = B.quat;
    const ax = -a.x, ay = -a.y, az = -a.z, aw = a.w;
    rod.relQ.x = aw * b.x + ax * b.w + ay * b.z - az * b.y;
    rod.relQ.y = aw * b.y - ax * b.z + ay * b.w + az * b.x;
    rod.relQ.z = aw * b.z + ax * b.y - ay * b.x + az * b.w;
    rod.relQ.w = aw * b.w - ax * b.x - ay * b.y - az * b.z;
    this._rideHost(rod, null);
  }

  // Węzeł-kotwica pręta: ten sam indeks, jeśli magazyn i komórka się zgadzają; inaczej szukamy komórki
  // u gospodarza, a potem w ciałach tej samej skóry (odłam, który zabrał węzeł). -1 = kotwica zginęła.
  _findAnchor(rod, bodies) {
    const match = (b) => {
      const s = b.nodeStore;
      for (let i = 0; i < s.count; i++) {
        if (s.active[i] && s.ix[i] === rod.anchorIx && s.iy[i] === rod.anchorIy && s.iz[i] === rod.anchorIz) return i;
      }
      return -1;
    };
    const host = rod.host, s = host && !host.dead ? host.nodeStore : null;
    if (s && s === rod.anchorStore && s.active[rod.anchor] && s.ix[rod.anchor] === rod.anchorIx &&
        s.iy[rod.anchor] === rod.anchorIy && s.iz[rod.anchor] === rod.anchorIz) return rod.anchor;
    if (s) {
      const i = match(host);
      if (i >= 0) { rod.anchor = i; rod.anchorStore = s; return i; }
    }
    if (Array.isArray(bodies) && host) {
      for (const b of bodies) {
        if (!b || b.dead || b === host || b === rod.body || (host.skin && b.skin !== host.skin)) continue;
        const i = match(b);
        if (i >= 0) { rod.host = b; rod.body._rodHost = b; rod.anchor = i; rod.anchorStore = b.nodeStore; return i; }
      }
    }
    return -1;
  }

  // Wbity pręt jedzie sztywno z węzłem-kotwicą gospodarza (bez kontaktu z nim — pairFilter).
  _rideHost(rod, bodies) {
    const B = rod.body;
    const anchor = rod.host && !rod.host.dead ? this._findAnchor(rod, bodies) : -1;
    if (anchor < 0) { rod.host = null; B._rodHost = null; return; }
    const host = rod.host, s = host.nodeStore;
    const m = this.system._refreshRot(host);
    const lx = s.x[anchor] + rod.relX, ly = s.y[anchor] + rod.relY, lz = s.z[anchor] + rod.relZ;
    const wx = m[0] * lx + m[1] * ly + m[2] * lz;
    const wy = m[3] * lx + m[4] * ly + m[5] * lz;
    const wz = m[6] * lx + m[7] * ly + m[8] * lz;
    B.pos.x = host.pos.x + wx; B.pos.y = host.pos.y + wy; B.pos.z = host.pos.z + wz;
    B.vel.x = host.vel.x + (host.angVel.y * wz - host.angVel.z * wy);
    B.vel.y = host.vel.y + (host.angVel.z * wx - host.angVel.x * wz);
    B.vel.z = host.vel.z + (host.angVel.x * wy - host.angVel.y * wx);
    B.angVel.x = host.angVel.x; B.angVel.y = host.angVel.y; B.angVel.z = host.angVel.z;
    const a = host.quat, b = rod.relQ, q = B.quat;
    const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
    const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
    const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
    const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
    q.x = x; q.y = y; q.z = z; q.w = w;
    B._rotTick = -1;
  }

  // ------------------------------------------------------------------ STARE TRAFIENIA (A/B)

  _legacyCannonHit(p, hit) {
    const sys = this.system, t = this.tune, cs = sys.config.cellSize;
    const dmg = t.legacyDamage * 0.3;
    const r = cs * 1.15;
    this._v.x = p.vx; this._v.y = p.vy; this._v.z = p.vz;
    sys.applyImpact(hit.body, hit.cx, hit.cy, hit.cz, dmg, this._v,
      { radius: r, breakRadius: r * 0.45, damageFraction: 1, breakProgress: 1, impulseTime: 0 });
    this.stats.hits[PW.CANNON]++;
    this.stats.lastHit = this.time;
    this._effect(PW.CANNON, hit.x, hit.y, hit.z, cs * 0.6, 0.16);
  }

  // Rzaz Hexlance gry (cutSegment z push): węzły w pasie wzdłuż toru giną od razu, odłamki lecą wzdłuż
  // toru, kadłub dostaje sztuczny impuls (masa wyciętego × legacyLancePush). Bez hamowania pocisku.
  _legacyLanceCut(p, bodies, dx, dy, dz, len) {
    const sys = this.system, t = this.tune;
    for (let n = 0; n < bodies.length; n++) {
      const B = bodies[n];
      if (!B || B.dead || B === p.owner || B.static || B.activeNodes <= 0) continue;
      const ex = B.pos.x - p.x, ey = B.pos.y - p.y, ez = B.pos.z - p.z;
      const along = ex * dx + ey * dy + ez * dz;
      const r = B.radius + p.radius + B.cellSize;
      if (along < -r || along > len + r) continue;
      if (ex * ex + ey * ey + ez * ez - along * along > r * r) continue;
      const m = sys._refreshRot(B), s = B.nodeStore;
      const rx = p.x - B.pos.x, ry = p.y - B.pos.y, rz = p.z - B.pos.z;
      const lx = m[0] * rx + m[3] * ry + m[6] * rz, ly = m[1] * rx + m[4] * ry + m[7] * rz, lz = m[2] * rx + m[5] * ry + m[8] * rz;
      const ldx = m[0] * dx + m[3] * dy + m[6] * dz, ldy = m[1] * dx + m[4] * dy + m[7] * dz, ldz = m[2] * dx + m[5] * dy + m[8] * dz;
      const band2 = p.radius * p.radius;
      let cutMass = 0, cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < s.count; i++) {
        if (!s.active[i]) continue;
        const qx = s.x[i] - lx, qy = s.y[i] - ly, qz = s.z[i] - lz;
        const tt = qx * ldx + qy * ldy + qz * ldz;
        if (tt < 0 || tt > len) continue;
        if (qx * qx + qy * qy + qz * qz - tt * tt > band2) continue;
        const speed = 60 * (0.5 + 0.8 * hash01(i, p.serial));
        s.vx[i] = ldx * speed; s.vy[i] = ldy * speed; s.vz[i] = ldz * speed;
        cutMass += s.mass[i]; cx += s.x[i] * s.mass[i]; cy += s.y[i] * s.mass[i]; cz += s.z[i] * s.mass[i];
        sys.destroyNode(B, i);
      }
      if (cutMass > 0) {
        this.stats.hits[PW.LANCE]++;
        this.stats.lastHit = this.time;
        if (!B.anchored && B.mass > 0) {
          const j = cutMass * t.legacyLancePush;
          const dv = Math.min(8, j / B.mass);
          B.vel.x += dx * dv; B.vel.y += dy * dv; B.vel.z += dz * dv;
        }
        cx /= cutMass; cy /= cutMass; cz /= cutMass;
        // Błysk co kilka kroków rzazu (jak przy pręcie — bez białej plamy z nałożonych błysków).
        if ((Math.round(p.age * 120) % 6) === 0) {
          this._effect(PW.LANCE, B.pos.x + m[0] * cx + m[1] * cy + m[2] * cz,
            B.pos.y + m[3] * cx + m[4] * cy + m[5] * cz, B.pos.z + m[6] * cx + m[7] * cy + m[8] * cz,
            sys.config.cellSize * 1.2, 0.18);
        }
      }
    }
  }

  // ------------------------------------------------------------------ CIŚNIENIE: RAKIETY

  _detonate(p, hit, dx, dy, dz) {
    const t = this.tune, cs = this.system.config.cellSize;
    let blast = null;
    for (const b of this.blasts) if (!b.active) { blast = b; break; }
    this.stats.hits[PW.ROCKET]++;
    this.stats.lastHit = this.time;
    this._effect(PW.ROCKET, hit.x, hit.y, hit.z, (p.legacy ? t.legacyRadius : t.blastRadius) * cs, 0.4);
    if (!blast) return;
    blast.active = true; blast.legacy = p.legacy; blast.owner = p.owner; blast.age = 0; blast.frontR = 0;
    blast.x = hit.cx; blast.y = hit.cy; blast.z = hit.cz;
    blast.fx = dx; blast.fy = dy; blast.fz = dz;
    blast.radius = (p.legacy ? t.legacyRadius : t.blastRadius) * cs;
    blast.kick = t.blastKick * (t.legacyDamage / 450);
    blast.damage = t.legacyDamage * 2;
    blast.vx = p.vx; blast.vy = p.vy; blast.vz = p.vz;
  }

  /**
   * Detonacja w punkcie (świat): front fali jak po rakiecie — ciśnienie przez solver (prędkość węzłów
   * ∝ 1/d², bez kasowania), promień [j.], power — mnożnik siły. Bez efektu w pierścieniu `effects`
   * (obraz robi wołający — np. wybuch budowli z gazu). Wybuch reaktora / magazynu od środka bryły.
   * @returns {boolean} false — pula frontów pełna
   */
  detonate(x, y, z, radius, power = 1, owner = null) {
    const t = this.tune;
    let blast = null;
    for (const b of this.blasts) if (!b.active) { blast = b; break; }
    if (!blast) return false;
    blast.active = true; blast.legacy = false; blast.owner = owner; blast.age = 0; blast.frontR = 0;
    blast.x = x; blast.y = y; blast.z = z;
    blast.fx = 0; blast.fy = 0; blast.fz = 0;
    blast.radius = radius;
    blast.kick = t.blastKick * (t.legacyDamage / 450) * power;
    blast.damage = t.legacyDamage * 2 * power;
    blast.vx = 0; blast.vy = 0; blast.vz = 0;
    return true;
  }

  _updateBlasts(dt, bodies) {
    const sys = this.system, t = this.tune;
    for (const blast of this.blasts) {
      if (!blast.active) continue;
      if (blast.legacy) { this._legacyBlast(blast, dt, bodies); continue; }
      const prevR = blast.frontR;
      blast.age += dt;
      const R = blast.radius * Math.min(1, blast.age / Math.max(1e-4, t.blastTime));
      blast.frontR = R;
      const cs = sys.config.cellSize;
      for (let n = 0; n < bodies.length; n++) {
        const B = bodies[n];
        if (!B || B.dead || B.static || B === blast.owner || B.activeNodes <= 0) continue;
        const ex = B.pos.x - blast.x, ey = B.pos.y - blast.y, ez = B.pos.z - blast.z;
        if (ex * ex + ey * ey + ez * ez > (B.radius + R + cs) ** 2) continue;
        this._blastBody(B, blast, prevR, R, cs);
      }
      if (blast.age >= t.blastTime) { blast.active = false; blast.owner = null; }
    }
  }

  // Węzły, przez które front przeszedł w tym kroku (prevR < d ≤ R): prędkość od środka ∝ 1/d².
  _blastBody(B, blast, prevR, R, cs) {
    const sys = this.system, t = this.tune;
    const m = sys._refreshRot(B), s = B.nodeStore;
    const rx = blast.x - B.pos.x, ry = blast.y - B.pos.y, rz = blast.z - B.pos.z;
    const lx = m[0] * rx + m[3] * ry + m[6] * rz, ly = m[1] * rx + m[4] * ry + m[7] * rz, lz = m[2] * rx + m[5] * ry + m[8] * rz;
    const fx = m[0] * blast.fx + m[3] * blast.fy + m[6] * blast.fz;
    const fy = m[1] * blast.fx + m[4] * blast.fy + m[7] * blast.fz;
    const fz = m[2] * blast.fx + m[5] * blast.fy + m[8] * blast.fz;
    const local = !!sys.config.localSolver, free = !B.anchored;
    const d0 = cs * 0.8, kickAt1 = blast.kick * cs * cs;
    let tx = 0, ty = 0, tz = 0, any = false, hot = false;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      const qx = s.x[i] - lx, qy = s.y[i] - ly, qz = s.z[i] - lz;
      const d2 = qx * qx + qy * qy + qz * qz;
      if (d2 > R * R || (prevR > 0 && d2 <= prevR * prevR)) continue;
      const d = Math.sqrt(d2);
      const kick = Math.min(t.blastKickMax, kickAt1 / Math.max(d0 * d0, d2));
      if (s.invMass[i] > 0) {
        let ux = d > 1e-6 ? qx / d : fx, uy = d > 1e-6 ? qy / d : fy, uz = d > 1e-6 ? qz / d : fz;
        ux += fx * t.blastForward; uy += fy * t.blastForward; uz += fz * t.blastForward;
        const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
        const vx = ux / ul * kick, vy = uy / ul * kick, vz = uz / ul * kick;
        s.vx[i] += vx; s.vy[i] += vy; s.vz[i] += vz;
        if (free) {
          // Moment pędu w świecie: r (węzeł od środka ciała) × m Δv.
          const wx = m[0] * s.x[i] + m[1] * s.y[i] + m[2] * s.z[i];
          const wy = m[3] * s.x[i] + m[4] * s.y[i] + m[5] * s.z[i];
          const wz = m[6] * s.x[i] + m[7] * s.y[i] + m[8] * s.z[i];
          const jx = (m[0] * vx + m[1] * vy + m[2] * vz) * s.mass[i];
          const jy = (m[3] * vx + m[4] * vy + m[5] * vz) * s.mass[i];
          const jz = (m[6] * vx + m[7] * vy + m[8] * vz) * s.mass[i];
          tx += wy * jz - wz * jy; ty += wz * jx - wx * jz; tz += wx * jy - wy * jx;
        }
        if (local) activateNode(B, i);
      }
      if (t.blastHeat > 0) {
        const T = t.blastHeat * kick / t.blastKickMax;
        if (T > s.temp[i]) { s.temp[i] = T; hot = true; }
      }
      any = true;
    }
    if (!any) return;
    if (free && B.invInertiaLocal) {
      // Δω = I⁻¹ L (L w świecie) — jak _angularImpulse, z gotowym momentem.
      const I = B.invInertiaLocal;
      const lx2 = m[0] * tx + m[3] * ty + m[6] * tz, ly2 = m[1] * tx + m[4] * ty + m[7] * tz, lz2 = m[2] * tx + m[5] * ty + m[8] * tz;
      const scale = 1 / Math.max(1e-6, B.rammingMassMult || 1);
      const ax = (I[0] * lx2 + I[1] * ly2 + I[2] * lz2) * scale;
      const ay = (I[3] * lx2 + I[4] * ly2 + I[5] * lz2) * scale;
      const az = (I[6] * lx2 + I[7] * ly2 + I[8] * lz2) * scale;
      B.angVel.x += m[0] * ax + m[1] * ay + m[2] * az;
      B.angVel.y += m[3] * ax + m[4] * ay + m[5] * az;
      B.angVel.z += m[6] * ax + m[7] * ay + m[8] * az;
    }
    sys.wake(B, sys.config.wakeHoldFrames);
    B.meshDirty = true;
    if (hot) this.hot.add(B);
  }

  // Fala dema (BeamWeapons3D.updateBlasts): applyImpact co krok z rosnącym postępem.
  _legacyBlast(blast, dt, bodies) {
    const sys = this.system;
    const before = smooth01(0, LEGACY_BLAST_DURATION, blast.age);
    blast.age = Math.min(LEGACY_BLAST_DURATION, blast.age + dt);
    const after = smooth01(0, LEGACY_BLAST_DURATION, blast.age);
    const opts = this._legacyOpts ||= { radius: 0, breakRadius: 0, damageFraction: 1, breakProgress: 1, impulseTime: 0.12 };
    opts.damageFraction = after - before; opts.breakProgress = after; opts.impulseTime = 0.12;
    opts.radius = blast.radius; opts.breakRadius = blast.radius * 0.7;
    this._v.x = blast.vx; this._v.y = blast.vy; this._v.z = blast.vz;
    for (let n = 0; n < bodies.length; n++) {
      const B = bodies[n];
      if (!B || B.dead || B.static || B === blast.owner) continue;
      if (Math.hypot(B.pos.x - blast.x, B.pos.y - blast.y, B.pos.z - blast.z) > B.radius + blast.radius) continue;
      sys.applyImpact(B, blast.x, blast.y, blast.z, blast.damage, this._v, opts);
    }
    if (blast.age >= LEGACY_BLAST_DURATION) { blast.active = false; blast.owner = null; }
  }

  // ------------------------------------------------------------------ CIEPŁO: WIĄZKA

  _updateBeam(dt, bodies) {
    const sys = this.system, t = this.tune, beam = this.beam;
    if (!beam.on || !beam.owner || beam.owner.dead) { beam.active = false; beam.hit = false; return; }
    const o = this._aim(beam.owner, 0), hit = this._hit, cs = sys.config.cellSize;
    beam.active = true; beam.legacy = this.legacy;
    beam.x0 = o.x; beam.y0 = o.y; beam.z0 = o.z;
    if (!traceBeamShot(sys, bodies, beam.owner, o.x, o.y, o.z, o.dx, o.dy, o.dz, t.beamRange, hit)) {
      beam.hit = false;
      beam.x1 = o.x + o.dx * t.beamRange; beam.y1 = o.y + o.dy * t.beamRange; beam.z1 = o.z + o.dz * t.beamRange;
      return;
    }
    beam.hit = true;
    beam.x1 = hit.x; beam.y1 = hit.y; beam.z1 = hit.z;
    this.stats.lastHit = this.time;
    const B = hit.body;
    if (this.legacy) {
      // Wiązka gry: krater co takt.
      beam.legacyWait -= dt;
      if (beam.legacyWait <= 0) {
        beam.legacyWait += t.legacyBeamTick;
        this._v.x = o.dx; this._v.y = o.dy; this._v.z = o.dz;
        sys.applyImpact(B, hit.cx, hit.cy, hit.cz, t.legacyBeamDamage, this._v,
          { radius: cs * 1.15, breakRadius: cs * 0.5, damageFraction: 1, breakProgress: 1, impulseTime: 0 });
        this.stats.hits[PW.BEAM]++;
      }
      return;
    }
    // Plama ciepła wokół trafionego węzła (Gauss, sigma = beamRadius komórek).
    const m = sys._refreshRot(B), s = B.nodeStore;
    const i0 = hit.nodeIndex;
    const cx = s.x[i0], cy = s.y[i0], cz = s.z[i0];
    const sigma = Math.max(1e-6, t.beamRadius * B.cellSize), reach2 = 9 * sigma * sigma, inv = 1 / (2 * sigma * sigma);
    const heat = t.beamPower * dt;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      const qx = s.x[i] - cx, qy = s.y[i] - cy, qz = s.z[i] - cz;
      const d2 = qx * qx + qy * qy + qz * qz;
      if (d2 > reach2) continue;
      s.temp[i] += heat * Math.exp(-d2 * inv);
    }
    // Kierunek ablacji: w stronę strzelca (lokalnie).
    B._heatDirX = -(m[0] * o.dx + m[3] * o.dy + m[6] * o.dz);
    B._heatDirY = -(m[1] * o.dx + m[4] * o.dy + m[7] * o.dz);
    B._heatDirZ = -(m[2] * o.dx + m[5] * o.dy + m[8] * o.dz);
    this.hot.add(B);
    this.stats.hits[PW.BEAM]++;
  }

  // Przewodzenie, stygnięcie, osłabienie belek, ablacja — tylko ciała z ciepłem.
  _updateThermal(dt) {
    const sys = this.system, t = this.tune;
    const coolK = Math.exp(-t.cool * dt);
    const cond = Math.min(0.03, t.conduct * dt * 0.1);
    for (const B of this.hot) {
      if (!B || B.dead) { this.hot.delete(B); continue; }
      const s = B.nodeStore, e = B.beamStore, T = s.temp, active = s.active;
      const adjStart = s.adjStart, adj = s.adj, ea = e.a, eb = e.b, broken = e.broken, type = e.type;
      const brk = e.brk, stiffness = e.stiffness;
      const local = !!sys.config.localSolver;
      let maxT = 0, changed = false;
      for (let i = 0; i < s.count; i++) {
        if (!active[i] || !(T[i] > 0)) continue;
        // Przewodzenie po całych belkach (od gorętszego do chłodniejszego).
        if (cond > 0) {
          for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
            const bi = adj[q];
            if (broken[bi]) continue;
            const o = ea[bi] === i ? eb[bi] : ea[bi];
            if (!active[o] || T[o] >= T[i]) continue;
            const flow = (T[i] - T[o]) * cond;
            T[i] -= flow; T[o] += flow;
          }
        }
        T[i] *= coolK;
        if (T[i] < 0.004) T[i] = 0;
        // Osłabienie belek węzła: próg zerwania i sztywność z presetu typu × f(T gorętszego końca).
        for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
          const bi = adj[q];
          if (broken[bi]) continue;
          const a = ea[bi], b = eb[bi];
          const Tm = Math.max(T[a], T[b]);
          const soft = smooth01(t.soften, t.melt, Tm);
          const preset = BEAM_PRESETS[type[bi]];
          if (!preset) continue;
          brk[bi] = preset.break * (1 - 0.85 * soft);
          stiffness[bi] = preset.stiffness * (1 - 0.6 * soft);
        }
        if (T[i] >= t.melt && s.invMass[i] > 0) {
          this._ablate(B, i);
          changed = true;
          continue;
        }
        // Żar do rysowania w grze (shader czyta heat 0–1); demo czyta temp wprost.
        s.heat[i] = Math.min(1, T[i] / t.melt);
        if (T[i] > maxT) maxT = T[i];
        if (local && T[i] > t.soften) activateNode(B, i);
      }
      if (changed) { sys.wake(B, sys.config.wakeHoldFrames); B.meshDirty = true; }
      if (maxT > 0.6 * t.soften) sys.wake(B, 2);
      if (!(maxT > 0)) this.hot.delete(B);
    }
  }

  // Odparowanie węzła: kropla leci w stronę źródła ciepła, sąsiedzi dostają odrzut w głąb.
  _ablate(B, i) {
    const sys = this.system, t = this.tune, s = B.nodeStore;
    const hx = B._heatDirX || 0, hy = B._heatDirY || 0, hz = B._heatDirZ || 0;
    const r1 = hash01(i, B.id) - 0.5, r2 = hash01(i + 7, B.id) - 0.5;
    const sp = t.ablateSpeed;
    s.vx[i] = hx * sp + r1 * sp * 0.6; s.vy[i] = hy * sp + r2 * sp * 0.6; s.vz[i] = hz * sp + (r1 - r2) * sp * 0.3;
    const adjStart = s.adjStart, adj = s.adj, e = B.beamStore;
    for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
      const bi = adj[q];
      if (e.broken[bi]) continue;
      const o = e.a[bi] === i ? e.b[bi] : e.a[bi];
      if (!s.active[o] || s.invMass[o] <= 0) continue;
      s.vx[o] -= hx * t.ablateRecoil; s.vy[o] -= hy * t.ablateRecoil; s.vz[o] -= hz * t.ablateRecoil;
    }
    s.temp[i] = 0;
    sys.destroyNode(B, i);
    this.stats.ablated++;
    if ((this.stats.ablated & 3) === 0) {
      const m = sys._refreshRot(B);
      this._effect(PW.BEAM, B.pos.x + m[0] * s.x[i] + m[1] * s.y[i] + m[2] * s.z[i],
        B.pos.y + m[3] * s.x[i] + m[4] * s.y[i] + m[5] * s.z[i],
        B.pos.z + m[6] * s.x[i] + m[7] * s.y[i] + m[8] * s.z[i], B.cellSize * 0.7, 0.25);
    }
  }
}
