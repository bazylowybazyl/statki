// src/vfx/collisionSparks.js
//
// Iskry tarcia jako SUBSKRYBENT CollisionFX. Wywołanie SparkSystem3D siedziało
// wcześniej wprost w collideEntities — destructor.js nie zna już warstwy 3D,
// a każdy kolejny efekt zderzenia (shake, shockwave, dźwięk) wchodzi tą samą
// drogą zamiast dopisywać się do pętli fizyki.
//
// BUDŻET TO TEMPO, nie liczba na wywołanie. 'grind' leci z każdego kroku
// fizyki, w którym para się styka (120 Hz, czasem dwa razy na krok), a jego
// `bounceForce` to impuls (masa × prędkość). Dawny budżet „5 + 0,15 · (impuls
// + 3 · poślizg), do 120 na wywołanie” przy masach kadłubów na belkach
// (10⁵–10⁶) nasycał się przy każdym dotyku. Pomiar 2026-09-26 (HullBodies):
// taran 300 j./s sypał ~6 400 iskier/s, 900 j./s ~10 200/s, dosunięcie 15 j./s
// ~240/s — każda z białą głową HDR 4 pod bloomem overlaya (próg 0,15), czyli
// biała plama na całym zgniocie. Teraz tempo rośnie z PRĘDKOŚCIĄ styku
// (zbliżanie + poślizg), liczy się w czasie symulacji pary (niezależnie od
// PHYS_HZ i od liczby wywołań na krok), a iskra tarcia jest ciemniejsza od
// iskry trafienia. Chwilę zderzenia akcentuje jednorazowy snop na 'impact'.
// Model zderzeń i to, co iskrzy, zostają bez zmian.
//
// Import tego modułu ma efekt uboczny: rejestruje subskrybentów.

import { CollisionFX } from './collisionFx.js';
// Losowość warstwy efektów (zadanie 23): wizualia nie zużywają Math.random gry — przebieg rozgrywki nie zależy od obrazu.
import { fxRandom } from '../3d/fx/fxRandom.js';

export const COLLISION_SPARKS_TUNE = {
  ratePerSec: 420,   // iskry/s na parę kadłubów przy pełnym tarciu
  speedMin: 8,       // j./s — styk wolniejszy nie iskrzy (docisk, dosunięcie)
  speedFull: 260,    // j./s (zbliżanie + poślizg) — pełne tempo
  gain: 0.5,         // jasność iskry tarcia względem iskry trafienia (SparkSystem3D.emit)
  gapSec: 0.1,       // przerwa w styku pary dłuższa niż to = nowy styk, bez nadrabiania
  // Snop UDERZENIA (zdarzenie 'impact': pierwszy styk pary, z cooldownem). Zgniot
  // wytraca prędkość styku już w pierwszych krokach, więc samo tempo tarcia dawało
  // przy taranie ułamek iskry w chwili zderzenia — tu jednorazowe „chrupnięcie”.
  impactSparks: 56,  // iskry przy impactSpeedFull
  impactSpeedFull: 400
};

const T = COLLISION_SPARKS_TUNE;

// Pierwsze zdarzenie styku (i styk po przerwie) liczy się jak jeden krok fizyki
// gry (window.PHYS_HZ, `?physHz`); bez gry — krok domyślny 120 Hz.
function physicsStepSec() {
  const hz = typeof window !== 'undefined' ? Number(window.PHYS_HZ) : NaN;
  return hz > 0 ? 1 / hz : 1 / 120;
}

// Stan pary: czas symulacji ostatniego zdarzenia i ułamek iskry przenoszony
// między krokami (przy kilkuset iskrach/s na krok 120 Hz przypada ~1–3).
const _pairs = new WeakMap();
const _loose = { t: -Infinity, acc: 0 };

function isKey(v) {
  return v !== null && (typeof v === 'object' || typeof v === 'function');
}

function pairState(a, b) {
  if (!isKey(a) || !isKey(b)) return _loose;
  let pa = _pairs.get(a);
  let rec = pa?.get(b);
  if (!rec) {
    if (!pa) _pairs.set(a, pa = new WeakMap());
    let pb = _pairs.get(b);
    if (!pb) _pairs.set(b, pb = new WeakMap());
    rec = { t: -Infinity, acc: fxRandom.next() };
    pa.set(b, rec);
    pb.set(a, rec);
  }
  return rec;
}

/**
 * Tempo iskier tarcia [iskry/s] przy danej prędkości styku (j./s).
 * @param {number} approachSpeed prędkość zbliżania po normalnej
 * @param {number} slideSpeed prędkość poślizgu (znak bez znaczenia)
 */
export function grindSparkRate(approachSpeed, slideSpeed) {
  const speed = Math.max(0, Number(approachSpeed) || 0) + Math.abs(Number(slideSpeed) || 0);
  const span = Math.max(1e-6, T.speedFull - T.speedMin);
  const k = Math.min(1, Math.max(0, (speed - T.speedMin) / span));
  return T.ratePerSec * k;
}

/**
 * Ile iskier wysypać za to zdarzenie 'grind': tempo × czas symulacji od
 * poprzedniego zdarzenia TEJ pary. Drugie wywołanie w tym samym kroku daje 0.
 */
export function grindSparkBudget(ev) {
  const rec = pairState(ev.A, ev.B);
  const now = Number(ev.simTime) || 0;
  let dt = now - rec.t;
  if (!(dt > 0)) return 0;
  rec.t = now;
  if (dt > T.gapSec) dt = physicsStepSec();
  const rate = grindSparkRate(ev.approachSpeed, ev.slideSpeed);
  if (rate <= 0) return 0;
  rec.acc += rate * dt;
  const count = Math.floor(rec.acc);
  rec.acc -= count;
  return count;
}

/** Iskry jednorazowego snopu uderzenia przy danej prędkości zbliżania (j./s). */
export function impactSparkCount(approachSpeed) {
  const k = Math.min(1, Math.max(0, (Number(approachSpeed) || 0) / Math.max(1e-6, T.impactSpeedFull)));
  return Math.round(T.impactSparks * k);
}

function onImpact(ev) {
  const sparks = typeof window !== 'undefined' ? window.SparkSystem3D : null;
  if (!sparks?.isInitialized) return;
  const count = impactSparkCount(ev.approachSpeed);
  if (count <= 0) return;
  sparks.grindingBurst(
    ev.x, ev.y,
    -ev.nx, -ev.ny,
    ev.tx, ev.ty,
    ev.approachSpeed, ev.slideSpeed,
    ev.contactVelX * 0.4, ev.contactVelY * 0.4,
    count, T.gain
  );
}

function onGrind(ev) {
  const sparks = typeof window !== 'undefined' ? window.SparkSystem3D : null;
  if (!sparks?.isInitialized) return;

  const count = grindSparkBudget(ev);
  if (count <= 0) return;

  // Prędkość punktu styku po stronie A niesie iskry razem z kadłubem.
  const baseVx = ev.contactVelX * 0.4;
  const baseVy = ev.contactVelY * 0.4;

  if (ev.pointCount > 1 && typeof sparks.grindingSeam === 'function') {
    sparks.grindingSeam(
      ev.points, ev.pointCount,
      ev.tx, ev.ty,
      ev.approachSpeed, ev.slideSpeed,
      baseVx, baseVy,
      count, T.gain
    );
    return;
  }

  // Fallback: jeden kontakt = jeden snop w uśrednionym punkcie (stan sprzed szwu).
  sparks.grindingBurst(
    ev.x, ev.y,
    -ev.nx, -ev.ny,
    ev.tx, ev.ty,
    ev.approachSpeed, ev.slideSpeed,
    baseVx, baseVy,
    count, T.gain
  );
}

let installed = false;

export function installCollisionSparks() {
  if (installed) return false;
  installed = CollisionFX.on('grind', onGrind);
  if (installed) CollisionFX.on('impact', onImpact);
  return installed;
}

export function uninstallCollisionSparks() {
  if (!installed) return false;
  CollisionFX.off('grind', onGrind);
  CollisionFX.off('impact', onImpact);
  installed = false;
  return true;
}

installCollisionSparks();
