// ============================================================
// Tarcze 3D w grze — tarcza z dema WebGPU (dema/tarcza-webgpu.html, 2026-10-05) zamiast dawnej
// kopuły z łatami trafień i wstęg shieldImpactFx (usunięte):
//  • tarcza PRZEZROCZYSTA — widać ją tylko tam, gdzie coś w nią uderzyło: płytki-heksy na czaszy
//    nad obrysem kadłuba (ciało miękkie jak stary destruktor GPU: krater, front naprężenia, żar
//    stygnący od bieli do błękitu, przeciążenie na pomarańcz), fala biegnąca po całej tarczy
//    (połysk, załamanie tła w warstwie DIST), iskry ślizgające się po czaszy, światła trafień;
//  • PĘKNIĘCIE: czoło rys od ostatniego trafienia przez całą tarczę, płytki kruszą się — większość
//    gaśnie w miejscu (same linie rys), nieliczne odpadają jako dryfujące odłamki;
//  • PRZEBICIE: długi ostrzał w jedno miejsce przegrzewa pole, płytki odpadają, a pocisk trafiający
//    tarczę w dziurze leci do pancerza (isShieldBreachedAt — index.html, pętla pocisków); dziura
//    zamyka się, gdy pole ostygnie;
//  • rozruch i gaszenie widoczne: siatka odrasta za czołem, pole „budzi się” z drgnięciem fali;
//  • poświata pola na pancerzu pod rozgrzaną łatą i pod falą (mnożenie obrazu kadłuba).
// Wszystkie tarcze dzielą PULĘ slotów (src/3d/shield/shieldPool.js): slot dostaje tarcza, która
// oberwała albo pęka i jest na ekranie (≥ ShieldTuning.minPx promienia); bez slotu trafienie daje
// tylko światło. Jeden przebieg compute i jeden rysunek dla wszystkich tarcz, w spoczynku zero.
// Kształt i stany z shieldSystem.js (obrys r(θ), updateShieldFx, registerShieldImpact); tarcze bez
// kadłuba (stacje, platformy, myśliwce) — obrys koła o promieniu tarczy.
// Klatka: updateShields3D (render(), przed Core3D.render) zbiera trafienia i stany → zdarzenia
// slotów, światła i iskry; krok Core3D.fx „tarcze” (przed passami) liczy compute.
// ============================================================
import * as THREE from 'three/webgpu';
import { Core3D } from './core3d.js';
import { FX_DISTORT_LAYER } from './fx/fxFrame.js';
import { fxRandom } from './fx/fxRandom.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { oddajKopieCpu } from './tsl/kopiaCpu.js';
import { ActiveCarrier, writeCarrier, createCarrier } from '../game/carrierVelocity.js';
import {
  ShieldPool, SHIELD_SLOTS, SHIELD_SLOT_CAP, SLOT, SHIELD_SUBSTEP, SHIELD_MAX_SUBSTEPS, SHIELD_MAX_EVENTS,
  SHIELD_BINS, SHIELD_HIT_CLASS, SHIELD_SPARK_CLASS, SHIELD_SPARK_COUNT_SCALE, SHIELD_SHATTER, shieldTileCircumradius
} from './shield/shieldPool.js';
import { acquireShieldLattice, circleShieldProfile, nearestShieldTile } from './shield/shieldLattice.js';
import {
  getEntityShieldBaseRadius, getEntityShieldProfile, getShieldHullAngle, isShieldSuppressed, sampleShieldProfileRadius
} from '../../shieldSystem.js';

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// ── Strojenie (konsola: window.ShieldTuning — działa od razu) ────────────────────────────────
export const SHIELD_TUNING = {
  waveSpeed: 900,      // j./s — fala po tarczy (dawne pole dema)
  damping: 1.6,        // 1/s — tłumienie fali
  stiffness: 9,        // 1/s² — powrót czaszy do spoczynku
  coolTime: 2.6,       // s — stygnięcie energii (żar płytek: 0,5 ×)
  threshold: 1.4,      // próg przeciążenia (pomarańcz) i przebicia — energia względem pojedynczego trafienia
  breach: true,        // przebicie: przegrzane pole odpada, pociski przelatują przez dziurę do pancerza
  hullGlow: 1,         // poświata pola na pancerzu (energia i fala barwią kadłub pod tarczą)
  diffusion: 1000,     // j²/s — rozpływanie energii (tarcza Atlasa; × (rozmiar / 900 j.)²)
  kick: 1,             // wgniecenie płytek (krater)
  heat: 1,             // żar płytek
  stress: 1,           // poświata szwów
  refraction: 1,       // załamanie tła (0 = bez warstwy DIST)
  lights: 1,           // światła trafień i rozgrzanych miejsc
  sparks: 1,           // liczba iskier
  fronts: true,        // rozruch i gaszenie widoczne (siatka odrasta za czołem, czoło pcha falę)
  minPx: 9,            // promień tarczy na ekranie [px], poniżej którego tarcza nie dostaje slotu
  awakeAfterHit: 4.5,  // s — slot trzyma tarczę po ostatnim trafieniu (fala, żar i iskry gasną)
  // Twardość (encja.shield.hardness, domyślnie 1): próg przebicia × twardość, tempo przebicia
  // ÷ √twardość — twardsze pole potrzebuje więcej ognia w jedno miejsce, a dziura rośnie wolniej.
  breachRate: 1 / 0.7, // 1/s — narastanie przebicia przy twardości 1
  // Pokazana tarcza (encja.shield.show — tryb TARCZE gracza): stałe szwy siatki.
  showSeam: 0.3,       // jasność szwów pokazanej tarczy
  showFade: 0.35,      // s — wejście / zejście pokazania
  shatter: SHIELD_SHATTER // pęknięcie (czoło, rysy, odłamki — opis w shieldPool.js)
};

const SHIELD_FULL_COLOR = new THREE.Color('#5992f7');
const LOW_POWER_THRESHOLD = 0.35;

// Światła na klasę (siatka świateł Core3D: tłumienie (1 − x²)² / (1 + 4x²), x = d / zasięg):
// życie [s], moc, zasięg [j.] — skalowane rozmiarem tarczy jak w demie.
const HIT_LIGHT = {
  pd: { life: 0.12, power: 2.4, range: 300 },
  main: { life: 0.32, power: 4.5, range: 520 },
  special: { life: 0.85, power: 9.0, range: 1050 },
  shield: { life: 0.45, power: 4.0, range: 600 },
  break: { life: 0.45, power: 6.5, range: 1500 },
  breakDome: { life: 0.6, power: 2.0, range: 1900 }
};
const BREAK_SPARKS = { count: 240, speed: [260, 1100], life: [0.3, 0.8], fly: 0.3, heat: 1.1, width: 2.6, spread: 1.1 };
const CRACKLE = { count: 10, sparks: [16, 34], speed: [120, 520], life: [0.14, 0.38], jitter: 0.05 };
const MAX_HOT = 6;
const MAX_ASSIGNS_PER_FRAME = 3;   // nowe sloty na klatkę (wgranie siatki ~230 KB) — pęknięcia poza limitem
const EVICT_MARGIN = 1.5;          // wyparcie slotu tylko przez wyraźnie ważniejszą tarczę (bez mielenia w bitwie)

// ── Stan ─────────────────────────────────────────────────────────────────────────────────────
let pool = null;
let fxStep = null;
let warmed = false;
let cpuDropPending = false;
const group = new THREE.Group();
group.name = 'ShieldPool';
const recs = new Map();                      // encja → stan tarczy
const slotRec = new Array(SHIELD_SLOTS).fill(null);
let clock = 0;                               // zegar tarcz [s] (czas gry renderu; pauza stoi)
let frameNo = 0;
let simDt = 0;
let acc = 0;
let evCount = 0;
let resetPending = false;
let anyAlive = false;
let sparksUntil = -1;
let assignsThisFrame = 0;
// Mapa przebić z GPU (bit na płytkę, odczyt co BREACH_READ_EVERY s; jeden w locie).
const BREACH_READ_EVERY = 0.1;
let breachCpu = null;
let breachReadAt = 0;
let breachBusy = false;
const _breachRecsInFlight = new Array(SHIELD_SLOTS).fill(null); // rec slotu w chwili zlecenia odczytu
// Siatki płytek budowane w wolnych chwilach (3–8 ms na nową klasę kadłuba), zanim tarcza oberwie.
const latticeQueue = [];
let latticeIdle = false;
function scheduleLattice(rec) {
  if (rec.lattice || rec.latticeQueued) return;
  rec.latticeQueued = true;
  latticeQueue.push(rec);
  if (latticeIdle) return;
  latticeIdle = true;
  const ric = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 16);
  const work = (deadline) => {
    while (latticeQueue.length) {
      const r = latticeQueue.shift();
      r.latticeQueued = false;
      if (!r.lattice && r.profile) r.lattice = acquireShieldLattice(r.profile, SHIELD_SLOT_CAP);
      if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() < 8) break;
    }
    if (latticeQueue.length) ric(work);
    else latticeIdle = false;
  };
  ric(work);
}
const _origin = { x: 0, y: 0 };
const _carrier = createCarrier();
const _pose = { x: 0, y: 0, angle: 0 };
const _color = new THREE.Color();

function newRec(entity) {
  return {
    entity, profile: null, lattice: null, slot: -1, seen: 0, lastImpactId: -1, prevState: null,
    px: 0, py: 0, angle: 0, c: 1, s: 0, sizeK: 1, meanR: 1, rPx: 0, onScreen: false,
    lastHitX: 0, lastHitY: 0, wakeUntil: -1, shatterStart: -1, shatterOn: false, shatterEnd: -1, frontSpeed: 1,
    resetMode: 0, score: 0, latticeQueued: false, hard: 1, show: 0,
    hot: Array.from({ length: MAX_HOT }, () => ({ on: false, x: 0, y: 0, z: 0, e: 0 })),
    crackles: Array.from({ length: CRACKLE.count }, () => ({ on: false, t: 0, x: 0, y: 0, z: 0 }))
  };
}

function ensurePool() {
  if (pool) return pool;
  if (!Core3D.isInitialized || !Core3D.scene) return null;
  pool = new ShieldPool();
  Core3D.enableShield3D(pool.tileMesh);
  Core3D.enableShield3D(pool.sparkSprite);
  Core3D.enableShield3D(pool.glowMesh);
  pool.distMesh.layers.set(FX_DISTORT_LAYER);
  group.add(pool.glowMesh, pool.tileMesh, pool.sparkSprite, pool.distMesh);
  Core3D.scene.add(group);
  if (Core3D.fx && typeof Core3D.addFxStep === 'function') {
    fxStep = Core3D.addFxStep({
      name: 'tarcze',
      update(ctx) { dispatchFrame(ctx.renderer); },
      // Pipeline'y compute powstają synchronicznie — rozgrzewka pustymi dispatchami (wszystkie
      // wątki wychodzą od razu: żaden slot nie żyje).
      warm(ctx) {
        const r = ctx.renderer;
        if (!r || !pool) return;
        pool.U.evCount.value = 0;
        pool.commitSparkSpawns(0);
        r.compute(pool.kReset);
        r.compute(pool.group(2));
        r.compute(pool.kSparks);
        r.compute(pool.kBreach);
        warmed = true;
        cpuDropPending = true;
      }
    });
  }
  return pool;
}

// ── Poza encji (gracz z interpolacji renderu) ───────────────────────────────────────────────
function resolveEntityPose(entity, interp, out) {
  let x = Number.isFinite(entity.x) ? entity.x : entity.pos?.x;
  let y = Number.isFinite(entity.y) ? entity.y : entity.pos?.y;
  let angle = getShieldHullAngle(entity);
  if (interp && entity.isPlayer && entity === (typeof window !== 'undefined' ? window.ship : null)) {
    x = interp.x; y = interp.y;
    if (Number.isFinite(interp.angle)) angle = interp.angle;
  }
  out.x = Number(x) || 0;
  out.y = Number(y) || 0;
  out.angle = Number(angle) || 0;
  return out;
}

// Punkt klatki lokalnej tarczy (x wzdłuż kadłuba, y = −y gry) → świat gry.
function localToWorldX(rec, lx, ly) { return rec.px + lx * rec.c + ly * rec.s; }
function localToWorldY(rec, lx, ly) { return rec.py + lx * rec.s - ly * rec.c; }

function domeZ(rec, lx, ly) {
  const p = rec.profile;
  const R = sampleShieldProfileRadius(p, Math.atan2(-ly, lx));
  const t = Math.hypot(lx, ly) / Math.max(R, 1e-3);
  const H = clamp(p.minR * 0.85, 8, 140);
  return H * Math.pow(Math.max(0, 1 - t * t), 0.62);
}

// ── Sloty ───────────────────────────────────────────────────────────────────────────────────
function acquireSlot(rec, force = false) {
  if (!force && assignsThisFrame >= MAX_ASSIGNS_PER_FRAME) return -1;
  let s = -1;
  for (let i = 0; i < SHIELD_SLOTS; i++) if (!slotRec[i]) { s = i; break; }
  if (s < 0) {
    // Pełna pula: zwalnia slot najmniej ważnej tarczy (mała na ekranie, dawno trafiona, nie pęka).
    let worst = -1, worstScore = Infinity;
    for (let i = 0; i < SHIELD_SLOTS; i++) {
      const o = slotRec[i];
      if (o.shatterOn && clock < o.shatterEnd) continue;
      const sc = o.rPx / (1 + Math.max(0, clock - (o.wakeUntil - SHIELD_TUNING.awakeAfterHit)));
      if (sc < worstScore) { worstScore = sc; worst = i; }
    }
    if (worst < 0 || worstScore * EVICT_MARGIN >= rec.rPx) return -1;
    releaseSlot(slotRec[worst], 'wyparta');
    s = worst;
  }
  if (!rec.lattice) rec.lattice = acquireShieldLattice(rec.profile, SHIELD_SLOT_CAP);
  pool.uploadSlot(s, rec.lattice, rec.profile);
  assignsThisFrame++;
  slotRec[s] = rec;
  rec.slot = s;
  const st = rec.entity.shield?.state;
  // Siatka gotowa (niewidoczna — płytki mają zerową wielkość bez żaru); w rozruchu odrasta za czołem.
  rec.resetMode = st === 'activating' ? 2 : 1;
  resetPending = true;
  pool.slotVec(s, SLOT.MISC).x = clock;      // iskry starsze niż przydział gasną
  writeSlotStatic(rec);
  return s;
}

const _releaseLog = [];
function releaseSlot(rec, why = '') {
  const s = rec.slot;
  if (s < 0) return;
  _releaseLog.push(why + '@' + clock.toFixed(2));
  if (_releaseLog.length > 12) _releaseLog.shift();
  slotRec[s] = null;
  rec.slot = -1;
  setEntityBreach(rec, false);
  pool.slotVec(s, SLOT.GEOM).w = 0;
  pool.slotVec(s, SLOT.FLAGS).w = 0;
}

// Parametry slotu zależne od siatki i strojenia (na podkrok SHIELD_SUBSTEP).
function writeSlotStatic(rec) {
  const T = SHIELD_TUNING;
  const L = rec.lattice;
  const s = rec.slot;
  const h = SHIELD_SUBSTEP;
  const cell = L.cell;
  // Prędkość fali w siatce ≈ prędkość fali pola (ciało miękkie: c ≤ 0,15·d/h — warunek CFL).
  const cSoft = Math.min(T.waveSpeed, 0.15 * cell / h);
  const k = cSoft / (0.642 * cell);
  pool.slotVec(s, SLOT.GEOM).set(cell, shieldTileCircumradius(cell), L.domeHeight, 1);
  pool.slotVec(s, SLOT.SOFT).set(k * k, Math.exp(-4 * h), Math.exp(-h / 1.1), Math.exp(-h / 0.5));
  // Rozpływ energii skalowany rozmiarem tarczy (jak promień trafień, sizeK): na małym kadłubie
  // łata trafień jest mniejsza, a stały rozpływ (dobrany pod Atlasa) rozlewał ją, zanim ostrzał
  // zdążył ją przegrzać — przebicie było nieosiągalne poza największymi okrętami.
  const diff = T.diffusion * rec.sizeK * rec.sizeK;
  pool.slotVec(s, SLOT.SOFT2).set(0.1 * cell, 0.46 * cell,
    Math.min(0.2, 4 * 400 * h / (cell * cell)), Math.min(0.15, diff * h * (2 / 3) / (cell * cell)));
  const cWave = Math.min(T.waveSpeed, 0.45 * cell / h);
  pool.slotVec(s, SLOT.WAVE).set(cWave * cWave, T.damping, T.stiffness, L.domeHeight * 0.32);
}

function writeSlotFrame(rec) {
  const s = rec.slot;
  const sh = rec.entity.shield;
  const life = clamp((Number(sh.val) || 0) / (Number(sh.max) || 1), 0, 1);
  // Scena: (x, −y), obrót −kąt (jak Core3D) — przesunięcie względem początku przy kamerze w double.
  pool.slotVec(s, SLOT.POSE).set(rec.px - _origin.x, -rec.py - _origin.y, rec.c, -rec.s);
  pool.slotVec(s, SLOT.LOOK).set(SHIELD_FULL_COLOR.r, SHIELD_FULL_COLOR.g, SHIELD_FULL_COLOR.b, life);
  // Pęknięcie gra do końca (także gdy tarcza w tym czasie odrośnie): po nim płytki mogą wracać.
  if (rec.shatterOn && clock >= rec.shatterEnd) rec.shatterOn = false;
  pool.slotVec(s, SLOT.SHAT).set(rec.lastShatX ?? 0, rec.lastShatY ?? 0, rec.shatterStart, rec.shatterOn ? 1 : 0);
  pool.slotVec(s, SLOT.SHATK).set(rec.frontSpeed, SHIELD_SHATTER.lag, SHIELD_SHATTER.lead, clock < rec.shatterEnd ? 1 : 0);
  const st = sh.state;
  const sweeping = st === 'activating' || st === 'deactivating';
  const ap = clamp(Number(sh.activationProgress) || 0, 0, 1);
  // Czoło rozruchu pcha pole w górę, gaszenia w dół (demo: 1300 / −1700 j./s²).
  pool.slotVec(s, SLOT.FLAGS).set((st === 'active' || st === 'activating') ? 1 : 0, sweeping ? ap * 1.2 : -1,
    st === 'activating' ? 1300 : -1700, rec.resetMode);
  const lowPower = (st === 'active' || st === 'activating') ? clamp((LOW_POWER_THRESHOLD - life) / LOW_POWER_THRESHOLD, 0, 1) : 0;
  const misc = pool.slotVec(s, SLOT.MISC);
  misc.y = SHIELD_BINS; misc.w = lowPower;
  pool.slotVec(s, SLOT.HARD).set(Math.max(0.05, SHIELD_TUNING.threshold) * rec.hard,
    SHIELD_TUNING.breachRate / Math.sqrt(rec.hard), rec.show, 0);
}

// ── Zdarzenia, iskry, światła ───────────────────────────────────────────────────────────────
function pushEvent(slot, lx, ly, radius, impulse, energy) {
  if (evCount >= SHIELD_MAX_EVENTS) return;
  pool.evA[evCount].set(lx, ly, radius, impulse);
  pool.evB[evCount].set(energy, slot, 0, 0);
  evCount++;
}

function lightColor(rec) {
  const sh = rec.entity.shield;
  const life = clamp((Number(sh.val) || 0) / (Number(sh.max) || 1), 0, 1);
  return _color.setRGB(1.0, 0.08, 0.04).lerp(SHIELD_FULL_COLOR, life);
}

function flash(rec, lx, ly, cls, dmg) {
  const fl = Core3D.fx?.lights;
  if (!fl || !(SHIELD_TUNING.lights > 0)) return;
  const k = HIT_LIGHT[cls] || HIT_LIGHT.main;
  const boost = (0.8 + 0.2 * Math.min(2, dmg / 150)) * rec.sizeK * SHIELD_TUNING.lights;
  const c = lightColor(rec);
  const wx = localToWorldX(rec, lx, ly), wy = localToWorldY(rec, lx, ly);
  const e = rec.entity;
  ActiveCarrier.set(writeCarrier(e, wx, wy, typeof window !== 'undefined' && e === window.ship, _carrier));
  fl.flash(wx, wy, c.r * 0.6 + 0.4, c.g * 0.6 + 0.4, c.b * 0.6 + 0.4, k.power * boost, k.range * rec.sizeK, k.life, 2, 0,
    40 + domeZ(rec, lx * 0.95, ly * 0.95));
  ActiveCarrier.clear();
}

// Energia w pobliżu (90 j.) dokłada się do istniejącego gorącego punktu (światło co klatkę).
function addHeat(rec, lx, ly, energy) {
  let free = null, weakest = null;
  for (let i = 0; i < MAX_HOT; i++) {
    const h = rec.hot[i];
    if (!h.on) { if (!free) free = h; continue; }
    const dx = h.x - lx, dy = h.y - ly;
    if (dx * dx + dy * dy < 8100) {
      const w = energy / (h.e + energy);
      h.x += (lx - h.x) * w; h.y += (ly - h.y) * w;
      h.e = Math.min(6, h.e + energy);
      return;
    }
    if (!weakest || h.e < weakest.e) weakest = h;
  }
  const h = free || weakest;
  h.on = true; h.x = lx; h.y = ly; h.e = energy; h.z = 20 + domeZ(rec, lx, ly);
}

function emitHot(rec, dt) {
  const fl = Core3D.fx?.lights;
  const cool = Math.exp(-dt / Math.max(0.05, SHIELD_TUNING.coolTime));
  const thr = Math.max(0.05, SHIELD_TUNING.threshold) * rec.hard;
  let c = null;
  for (let i = 0; i < MAX_HOT; i++) {
    const h = rec.hot[i];
    if (!h.on) continue;
    h.e *= cool;
    const eN = h.e / thr;
    if (eN < 0.04) { h.on = false; continue; }
    if (!fl || !(SHIELD_TUNING.lights > 0) || !rec.onScreen) continue;
    if (!c) c = lightColor(rec);
    // Barwa jak energia na płytkach: barwa tarczy → biel → pomarańcz.
    const w = clamp((eN - 0.42) / 0.48, 0, 1), o = clamp((eN - 0.95) / 0.5, 0, 1);
    const ws = w * w * (3 - 2 * w), os = o * o * (3 - 2 * o);
    let r = c.r + (1.25 - c.r) * ws, g = c.g + (1.3 - c.g) * ws, b = c.b + (1.4 - c.b) * ws;
    r += (1.9 - r) * os; g += (0.62 - g) * os; b += (0.16 - b) * os;
    const p = Math.min(eN, 2.2) * 2.0 * SHIELD_TUNING.lights;
    fl.point(localToWorldX(rec, h.x, h.y), localToWorldY(rec, h.x, h.y), r * p, g * p, b * p, p > 0 ? 1 : 0, 420 * rec.sizeK, h.z);
  }
}

function sparks(rec, x, y, z, nx, ny, nz, count, vmin, vmax, lmin, lmax, fly, heat, width, spread) {
  if (rec.slot < 0 || !(SHIELD_TUNING.sparks > 0)) return;
  const n = pool.spawnSparks(rec.slot, x, y, z, nx, ny, nz, count * SHIELD_TUNING.sparks, vmin, vmax, lmin, lmax, fly, heat, width, spread);
  if (n > 0 && clock + lmax + 0.1 > sparksUntil) sparksUntil = clock + lmax + 0.1;
}

// Trafienie klasy gry w punkt obrysu (lx, ly): zdarzenie cofnięte do wnętrza, światło, żar, iskry.
function hitEvent(rec, lx, ly, dmg, cls) {
  const k = SHIELD_HIT_CLASS[cls] || SHIELD_HIT_CLASS.main;
  const radius = k.radius * rec.sizeK * (0.85 + 0.15 * Math.min(2, dmg / 150));
  const sh = rec.entity.shield;
  const life = clamp((Number(sh.val) || 0) / (Number(sh.max) || 1), 0, 1);
  const lowPower = clamp((LOW_POWER_THRESHOLD - life) / LOW_POWER_THRESHOLD, 0, 1);
  const weak = 1 - 0.5 * lowPower;
  const r = Math.hypot(lx, ly) || 1;
  const inset = Math.min(r * 0.25, radius * 0.6);
  const ix = lx * (1 - inset / r), iy = ly * (1 - inset / r);
  const energy = k.energy + k.energyPerDmg * dmg;
  pushEvent(rec.slot, ix, iy, radius, -(k.impulse + k.impulsePerDmg * dmg) * weak, energy);
  addHeat(rec, ix, iy, energy);
  // Iskry klasy (skala jak w grze: promień w miejscu trafienia zmieszany ze średnią statku).
  const sk = SHIELD_SPARK_CLASS[cls] || SHIELD_SPARK_CLASS.main;
  const R = Math.hypot(ix, iy) * 0.7 + rec.meanR * 0.3;
  const power = clamp(0.25 + dmg / 260, 0.2, 2.0);
  const count = (sk.count[0] + fxRandom.next() * (sk.count[1] - sk.count[0])) * SHIELD_SPARK_COUNT_SCALE * (0.62 + 0.38 * power);
  const ri = Math.hypot(ix, iy) || 1;
  sparks(rec, ix, iy, domeZ(rec, ix, iy) + 2, ix / ri, iy / ri, 0.35, count,
    sk.speed[0] * R * (0.7 + 0.3 * power), sk.speed[1] * R * (0.7 + 0.3 * power),
    sk.life[0] * 1.6, sk.life[1] * 1.8, sk.fly, sk.heat, 2.4 + 1.6 * power, 0.9);
}

// Pęknięcie: czoło rys od ostatniego trafienia, błysk, snop iskier, trzaski za czołem.
function shatter(rec) {
  const S = SHIELD_SHATTER;
  const maxDist = rec.profile.maxR * 2;
  rec.frontSpeed = clamp(maxDist / S.crossTime, S.speedMin, S.speedMax);
  rec.shatterStart = clock;
  rec.shatterOn = true;
  rec.lastShatX = rec.lastHitX;
  rec.lastShatY = rec.lastHitY;
  rec.shatterEnd = clock + maxDist / rec.frontSpeed + S.lag + Math.max(S.shardLife[1], S.dustLife[1]) + 0.2;
  const hx = rec.lastHitX, hy = rec.lastHitY;
  flash(rec, hx, hy, 'break', 300);
  flash(rec, 0, 0, 'breakDome', 150);
  for (let i = 0; i < CRACKLE.count; i++) rec.crackles[i].on = false;
  if (rec.slot < 0) return;
  const r = Math.hypot(hx, hy) || 1;
  const B = BREAK_SPARKS;
  sparks(rec, hx, hy, domeZ(rec, hx * 0.95, hy * 0.95) + 2, hx / r, hy / r, 0.6,
    B.count, B.speed[0], B.speed[1], B.life[0], B.life[1], B.fly, B.heat, B.width, B.spread);
  // Trzaski: losowe płytki, każda w chwili, gdy dojdzie do niej czoło pęknięcia.
  const L = rec.lattice;
  for (let i = 0; i < CRACKLE.count; i++) {
    const c = rec.crackles[i];
    const k = fxRandom.int(L.n);
    c.x = L.rest[k * 4]; c.y = L.rest[k * 4 + 1]; c.z = L.rest[k * 4 + 2];
    c.t = clock + Math.hypot(c.x - hx, c.y - hy) / rec.frontSpeed + fxRandom.next() * CRACKLE.jitter;
    c.on = true;
  }
}

function emitCrackles(rec) {
  const C = CRACKLE;
  for (let i = 0; i < C.count; i++) {
    const c = rec.crackles[i];
    if (!c.on || clock < c.t) continue;
    c.on = false;
    const r = Math.hypot(c.x, c.y) || 1;
    const count = C.sparks[0] + fxRandom.next() * (C.sparks[1] - C.sparks[0]);
    sparks(rec, c.x, c.y, c.z + 2, c.x / r, c.y / r, 0.5, count, C.speed[0], C.speed[1], C.life[0], C.life[1], 0.12, 1.0, 1.8, 0.8);
  }
}

// ── Klatka (render(), przed Core3D.render) ──────────────────────────────────────────────────
function viewContains(rec) {
  const v = Core3D.fx?.view;
  if (!v || !(v.x1 > v.x0)) return true;
  const R = rec.profile.maxR;
  return rec.px + R >= v.x0 && rec.px - R <= v.x1 && rec.py + R >= v.y0 && rec.py - R <= v.y1;
}

function processEntity(entity, interp, zoomPx) {
  const sh = entity?.shield;
  if (!sh || !sh.max) return;
  let rec = recs.get(entity);
  if (!rec) { rec = newRec(entity); recs.set(entity, rec); }
  rec.seen = frameNo;
  const profile = getEntityShieldProfile(entity) || circleShieldProfile(getEntityShieldBaseRadius(entity));
  if (rec.profile !== profile) {
    if (rec.slot >= 0) releaseSlot(rec, 'obrys');
    rec.profile = profile;
    rec.lattice = null;
    rec.sizeK = clamp(profile.maxR / 900, 0.35, 1.2);
    rec.meanR = (profile.maxR + profile.minR) * 0.5;
  }
  if (!rec.lattice) scheduleLattice(rec);
  rec.hard = Number(sh.hardness) > 0 ? Math.max(0.25, Number(sh.hardness)) : 1;
  resolveEntityPose(entity, interp, _pose);
  rec.px = _pose.x; rec.py = _pose.y; rec.angle = _pose.angle;
  rec.c = Math.cos(_pose.angle); rec.s = Math.sin(_pose.angle);
  rec.rPx = profile.maxR * zoomPx;
  rec.onScreen = viewContains(rec) && rec.rPx >= SHIELD_TUNING.minPx;

  // Nowe trafienia po id (najnowsze na początku). Pierwsza klatka encji: stare trafienia pomija.
  const imps = sh.impacts || [];
  let fresh = 0;
  const firstSeen = rec.lastImpactId < 0;
  for (let i = imps.length - 1; i >= 0; i--) {
    const imp = imps[i];
    if (!(imp.id > rec.lastImpactId)) continue;
    rec.lastImpactId = imp.id;
    if (firstSeen) continue;
    const a = Number.isFinite(imp.gridAngle) ? imp.gridAngle : 0;
    const R = sampleShieldProfileRadius(profile, a);
    const lx = Math.cos(a) * R, ly = -Math.sin(a) * R;
    rec.lastHitX = lx; rec.lastHitY = ly;
    const dmg = Number.isFinite(imp.damage) ? imp.damage : Math.max(0, ((Number(imp.intensity) || 1) - 0.25) * 260);
    const cls = imp.fxClass || 'main';
    if (rec.onScreen) {
      if (rec.slot < 0 && pool) acquireSlot(rec);
      if (rec.slot >= 0) hitEvent(rec, lx, ly, dmg, cls);
      flash(rec, lx, ly, cls, dmg);
    }
    rec.wakeUntil = clock + SHIELD_TUNING.awakeAfterHit;
    fresh++;
  }
  if (firstSeen && rec.lastImpactId < 0) rec.lastImpactId = 0;

  // Przejścia stanów.
  const st = sh.state;
  // Rozruch i gaszenie widoczne: tarcza na ekranie bierze slot na czas czoła (+ dopalenie).
  if (SHIELD_TUNING.fronts && (st === 'activating' || st === 'deactivating') && rec.onScreen) {
    if (rec.slot < 0 && pool) acquireSlot(rec);
    rec.wakeUntil = Math.max(rec.wakeUntil, clock + 0.8);
  }
  // Pokazana tarcza (tryb TARCZE gracza): stała siatka, póki pole stoi; slot trzymany na czas pokazania.
  const showOn = !!sh.show && (st === 'active' || st === 'activating') && !isShieldSuppressed(entity);
  const fadeK = simDt / Math.max(0.05, SHIELD_TUNING.showFade);
  rec.show = showOn ? Math.min(1, rec.show + fadeK) : Math.max(0, rec.show - fadeK);
  if (rec.show > 0 && rec.onScreen) {
    if (rec.slot < 0 && pool) acquireSlot(rec);
    rec.wakeUntil = Math.max(rec.wakeUntil, clock + 0.25);
  }
  if (rec.prevState !== st) {
    if (st === 'breaking' && rec.prevState !== null) {
      if (rec.slot < 0 && rec.onScreen && pool) acquireSlot(rec, true);
      shatter(rec);
    }
    rec.prevState = st;
  }
  if (rec.slot >= 0) emitCrackles(rec);

  // Zwolnienie slotu: tarcza zgasła bez pęknięcia, spokój po trafieniach, pęknięcie dobiegło końca,
  // tarcza zeszła z ekranu.
  if (rec.slot >= 0) {
    const shattering = rec.shatterOn && clock < rec.shatterEnd;
    const idle = clock > rec.wakeUntil && !shattering;
    const gone = (st === 'off' && !shattering) || (isShieldSuppressed(entity) && st !== 'deactivating' && !shattering);
    if (idle || gone || (!rec.onScreen && !shattering)) releaseSlot(rec, idle ? 'spokój' : (gone ? 'zgasła' : 'poza ekranem'));
  }
}

let _cpuMs = 0;
export function updateShields3D(dt, entities, interpPoseOverride = null) {
  if (!Core3D.isInitialized) return;
  const t0 = performance.now();
  updateShieldsFrame(dt, entities, interpPoseOverride);
  _cpuMs = _cpuMs * 0.9 + (performance.now() - t0) * 0.1;
}

function updateShieldsFrame(dt, entities, interpPoseOverride) {
  const p = ensurePool();
  simDt = clamp(Number(dt) || 0, 0, 0.1);
  clock += simDt;
  frameNo++;
  assignsThisFrame = 0;
  const cam = Core3D.activeCam1;
  const zoomPx = Math.max(0.0001, Number(cam?.zoom) || 1) * (Core3D.pixelRatio || 1);
  sceneOriginNearCamera(_origin);

  if (entities) {
    for (const e of entities) processEntity(e, interpPoseOverride, zoomPx);
  }
  // Encje, których w tej klatce nie było (zniszczone, poza mgłą, bez tarczy): stan znika.
  for (const [e, rec] of recs) {
    if (rec.seen !== frameNo) {
      if (rec.slot >= 0) releaseSlot(rec, 'znikła');
      recs.delete(e);
    } else if (rec.hot[0].on || rec.hot[1].on || rec.hot[2].on || rec.hot[3].on || rec.hot[4].on || rec.hot[5].on) {
      emitHot(rec, simDt);
    }
  }
  if (!p) return;

  anyAlive = false;
  for (let s = 0; s < SHIELD_SLOTS; s++) {
    const rec = slotRec[s];
    if (!rec) continue;
    writeSlotStatic(rec);
    writeSlotFrame(rec);
    anyAlive = true;
  }
  const sparksLive = clock < sparksUntil;
  const U = p.U;
  U.zoomPx.value = zoomPx;
  U.sparkMinW.value = 1.3 / zoomPx;
  U.frontGlow.value = SHIELD_TUNING.fronts ? 1 : 0;
  p.tileMesh.visible = anyAlive;
  p.glowMesh.visible = anyAlive && SHIELD_TUNING.hullGlow > 0;
  p.distMesh.visible = anyAlive && SHIELD_TUNING.refraction > 0;
  p.sparkSprite.visible = sparksLive && anyAlive;
  for (const o of [p.tileMesh, p.distMesh, p.sparkSprite, p.glowMesh]) o.position.set(_origin.x, _origin.y, 0);
  if (typeof Core3D.setShieldLayerActive === 'function') Core3D.setShieldLayerActive(anyAlive);
}

// ── Compute (krok Core3D.fx, przed passami) ─────────────────────────────────────────────────
function dispatchFrame(renderer) {
  if (!pool || !renderer) return;
  if (cpuDropPending && warmed) {
    if (oddajKopieCpu(renderer, pool.gpuOnlyBuffers) === 0) cpuDropPending = false;
  }
  const sparksLive = clock < sparksUntil;
  if (!anyAlive && !resetPending) { evCount = 0; pool.commitSparkSpawns(0); return; }
  const T = SHIELD_TUNING;
  const U = pool.U;
  const h = SHIELD_SUBSTEP;
  U.time.value = clock;
  U.dt.value = simDt;
  U.h.value = h;
  U.heatK.value = Math.exp(-h / Math.max(0.05, T.coolTime * 0.5));
  U.stressK.value = Math.exp(-h / 0.22);
  U.eCoolK.value = Math.exp(-h / Math.max(0.05, T.coolTime));
  U.kick.value = T.kick;
  U.heatPeak.value = 3.2 * T.heat;
  U.stressGain.value = 1.2 * T.stress;
  U.showSeam.value = T.showSeam;
  U.refr.value = T.refraction;
  U.breachOn.value = T.breach ? 1 : 0;
  U.hullGlow.value = T.hullGlow;
  const S = SHIELD_SHATTER;
  U.shatV.value.set(S.kickNear, S.kickRadius, S.drift, S.jitter);
  U.shatL.value.set(S.shardLife[0], S.shardLife[1], S.dustLife[0], S.dustLife[1]);
  U.shatD.value.set(S.drag, S.spin, S.dustSpeed, 0);
  U.shatC.value.set(S.crack, S.crackRadial, S.shardFrac, S.power);
  if (resetPending) {
    renderer.compute(pool.kReset);
    for (let s = 0; s < SHIELD_SLOTS; s++) {
      pool.slotVec(s, SLOT.FLAGS).w = 0;
      if (slotRec[s]) slotRec[s].resetMode = 0;
    }
    resetPending = false;
  }
  if (anyAlive) {
    acc += simDt;
    let pairs = Math.floor(acc / (2 * h));
    const maxPairs = SHIELD_MAX_SUBSTEPS / 2;
    if (pairs > maxPairs) { pairs = maxPairs; acc = 0; } else acc -= pairs * 2 * h;
    U.evCount.value = evCount;
    renderer.compute(pool.group(pairs * 2));
    if (sparksLive) {
      pool.commitSparkSpawns(fxRandom.int(1000000));
      renderer.compute(pool.kSparks);
    } else pool.commitSparkSpawns(0);
    if (T.refraction > 0) Core3D.setDistortLayerActive(true);
    if (T.breach && !breachBusy && clock >= breachReadAt) requestBreachMap(renderer);
  }
  evCount = 0;
}

// ── Przebicie: mapa dziur z GPU → flaga encji i test punktu (pętla pocisków w index.html) ──────
function setEntityBreach(rec, on) {
  const e = rec.entity;
  if (e) e.__shieldBreach = on ? true : null;
}

function onBreachRead(buf) {
  const words = new Uint32Array(buf);
  if (!breachCpu || breachCpu.length !== words.length) breachCpu = new Uint32Array(words.length);
  breachCpu.set(words);
  const wordsPerSlot = SHIELD_SLOT_CAP >> 5;
  for (let s = 0; s < SHIELD_SLOTS; s++) {
    const rec = _breachRecsInFlight[s];
    _breachRecsInFlight[s] = null;
    // Slot przeszedł w tym czasie do innej tarczy — odczyt jej nie dotyczy.
    if (!rec || slotRec[s] !== rec) continue;
    let any = false;
    for (let w = s * wordsPerSlot, e = w + wordsPerSlot; w < e; w++) if (breachCpu[w] !== 0) { any = true; break; }
    setEntityBreach(rec, any);
  }
}
function onBreachFail() { /* następny odczyt */ }
function onBreachDone() { breachBusy = false; }

function requestBreachMap(renderer) {
  breachBusy = true;
  breachReadAt = clock + BREACH_READ_EVERY;
  for (let s = 0; s < SHIELD_SLOTS; s++) _breachRecsInFlight[s] = slotRec[s];
  renderer.compute(pool.kBreach);
  renderer.getArrayBufferAsync(pool.breachBits.value).then(onBreachRead, onBreachFail).finally(onBreachDone);
}

/**
 * Czy pocisk trafiający tarczę encji w punkcie świata (x, y) przelatuje przez przebicie? Punkt to
 * wejście w obrys tarczy; płytki stoją kawałek głębiej (energia trafień ląduje cofnięta do wnętrza),
 * więc sprawdzana jest najbliższa płytka 1 i 2 odstępy w głąb od punktu wejścia. Bez slotu (tarcza
 * poza ekranem albo spokojna) i przed pierwszym odczytem — false. Wołający sprawdza najpierw tanią
 * flagę encja.__shieldBreach.
 */
const _breachQ = { calls: 0, yes: 0, last: null };
export function isShieldBreachedAt(entity, x, y) {
  _breachQ.calls++;
  const e = entity?._realEntity || entity;
  const rec = e ? recs.get(e) : null;
  if (!rec || rec.slot < 0 || !rec.lattice || !breachCpu || !e.__shieldBreach) return false;
  const dx = x - rec.px, dy = y - rec.py;
  // Świat gry → klatka lokalna tarczy (odwrotność localToWorld).
  const lx = dx * rec.c + dy * rec.s;
  const ly = dx * rec.s - dy * rec.c;
  // Punkt na obrysie w kierunku trafienia (pocisk podaje wejście w pole, rakieta — pozycję głowicy).
  const r = Math.hypot(lx, ly) || 1;
  const R = sampleShieldProfileRadius(rec.profile, Math.atan2(-ly, lx));
  const base = rec.slot * SHIELD_SLOT_CAP;
  for (let k = 1; k <= 2; k++) {
    const f = Math.max(0, R - k * rec.lattice.cell) / r;
    const t = nearestShieldTile(rec.lattice, lx * f, ly * f);
    if (t < 0) continue;
    const g = base + t;
    if ((breachCpu[g >> 5] >>> (g & 31)) & 1) { _breachQ.yes++; return true; }
  }
  return false;
}

// ── Rozgrzewka (ekran ładowania: index.html → Core3D.warmup.run) ────────────────────────────
// Pule tworzone raz; materiały płytek i iskier (pass tarcz, warstwa 7) i płytek w warstwie DIST
// (cel distortionTarget) — compileAsync pomija niewidoczne, więc odsłonięte na czas projekcji.
// Kernele compute rozgrzewa krok „tarcze” (warm) przy rejestracji.
export function prewarmShields3D() {
  const p = ensurePool();
  if (!p || !Core3D.renderer || !Core3D.cameraOrtho) return false;
  const vis = [p.tileMesh.visible, p.sparkSprite.visible, p.distMesh.visible, p.glowMesh.visible];
  p.tileMesh.visible = p.sparkSprite.visible = p.distMesh.visible = p.glowMesh.visible = true;
  try {
    Core3D.prewarmPass(p.glowMesh, 7);
    Core3D.prewarmPass(p.tileMesh, 7);
    Core3D.prewarmPass(p.sparkSprite, 7);
    Core3D.prewarmPass(p.distMesh, FX_DISTORT_LAYER);
  } finally {
    [p.tileMesh.visible, p.sparkSprite.visible, p.distMesh.visible, p.glowMesh.visible] = vis;
  }
  return true;
}

/** Diagnostyka (narzędzia): pole slotu z GPU — energia, przebicie, płytki przyczepione / oderwane. */
export async function probeShieldSlot(s = 0) {
  if (!pool || !Core3D.renderer) return null;
  const w = new Float32Array(await Core3D.renderer.getArrayBufferAsync(pool.waveA.value));
  let maxE = 0, maxB = 0, att = 0, det = 0, maxH = 0;
  for (let k = s * SHIELD_SLOT_CAP, e = k + SHIELD_SLOT_CAP; k < e; k++) {
    const ww = w[k * 4 + 3];
    if (ww === 0) continue;
    if (ww > 0) att++; else det++;
    maxE = Math.max(maxE, w[k * 4 + 2]);
    maxB = Math.max(maxB, Math.abs(ww) - 1);
    maxH = Math.max(maxH, Math.abs(w[k * 4]));
  }
  const rec = slotRec[s];
  return { maxE, maxB, maxH, att, det, thr: SHIELD_TUNING.threshold * (rec ? rec.hard : 1) };
}

/** Stan puli (narzędzia, testy w grze): sloty, tarcze z płytkami, iskry. */
export function getShieldPoolStats() {
  let alive = 0;
  const slots = [];
  for (let s = 0; s < SHIELD_SLOTS; s++) {
    const rec = slotRec[s];
    if (!rec) continue;
    alive++;
    slots.push({ slot: s, tiles: rec.lattice ? rec.lattice.n : 0, cell: rec.lattice ? rec.lattice.cell : 0, state: rec.entity.shield?.state, hard: rec.hard, show: +rec.show.toFixed(2), shatter: rec.shatterOn, breach: !!rec.entity.__shieldBreach });
  }
  return { alive, slots, tracked: recs.size, sparksLive: clock < sparksUntil, clock, ready: !!pool, warmed, released: _releaseLog.slice(), cpuMs: +_cpuMs.toFixed(3), breachQ: { calls: _breachQ.calls, yes: _breachQ.yes } };
}
