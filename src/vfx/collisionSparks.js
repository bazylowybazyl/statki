// src/vfx/collisionSparks.js
//
// Iskry tarcia jako SUBSKRYBENT CollisionFX. Wywołanie SparkSystem3D siedziało
// wcześniej wprost w collideEntities — destructor.js nie zna już warstwy 3D,
// a każdy kolejny efekt zderzenia (shake, shockwave, dźwięk) wchodzi tą samą
// drogą zamiast dopisywać się do pętli fizyki.
//
// Import tego modułu ma efekt uboczny: rejestruje subskrybenta.

import { CollisionFX } from './collisionFx.js';

// Próg energii jest ten sam co przed przeniesieniem — iskrzy dopiero realne
// tarcie, a nie każdy tick stykających się kadłubów.
const MIN_GRIND_ENERGY = 15;

function onGrind(ev) {
  const sparks = typeof window !== 'undefined' ? window.SparkSystem3D : null;
  if (!sparks?.isInitialized) return;

  const totalEnergy = ev.bounceForce + Math.abs(ev.slideSpeed) * 3.0;
  if (totalEnergy <= MIN_GRIND_ENERGY) return;

  // Prędkość punktu styku po stronie A niesie iskry razem z kadłubem.
  const baseVx = ev.contactVelX * 0.4;
  const baseVy = ev.contactVelY * 0.4;

  if (ev.pointCount > 1 && typeof sparks.grindingSeam === 'function') {
    sparks.grindingSeam(
      ev.points, ev.pointCount,
      ev.tx, ev.ty,
      ev.bounceForce, ev.slideSpeed,
      baseVx, baseVy
    );
    return;
  }

  // Fallback: jeden kontakt = jeden snop w uśrednionym punkcie (stan sprzed szwu).
  sparks.grindingBurst(
    ev.x, ev.y,
    -ev.nx, -ev.ny,
    ev.tx, ev.ty,
    ev.bounceForce, ev.slideSpeed,
    baseVx, baseVy
  );
}

let installed = false;

export function installCollisionSparks() {
  if (installed) return false;
  installed = CollisionFX.on('grind', onGrind);
  return installed;
}

export function uninstallCollisionSparks() {
  if (!installed) return false;
  CollisionFX.off('grind', onGrind);
  installed = false;
  return true;
}

installCollisionSparks();
