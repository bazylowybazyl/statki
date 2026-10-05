// Identyfikatory nośnika prędkości (src/game/carrierVelocity.js) i zegara
// symulacji (src/game/simClock.js), których używa kod wycinany z index.html
// (fireWeaponCore, spawnBulletAdapter, fireRailBarrel). Harnessy dokładają je
// do zakresu `with (scope)` / kontekstu vm — to te same moduły co w grze.

import { SimClock, CLOCK_RENDER, CLOCK_SIM } from '../../src/game/simClock.js';
import { continuousBeamState, continuousBeamAngle } from '../../src/game/continuousBeam.js';
import {
  ActiveCarrier,
  createCarrier,
  writeCarrier,
  writeCarrierVelocity,
  writePointVelocity,
  isInterpolatedEntity
} from '../../src/game/carrierVelocity.js';

export const CARRIER_SCOPE = Object.freeze({
  SimClock,
  continuousBeamState,
  continuousBeamAngle,
  CLOCK_RENDER,
  CLOCK_SIM,
  ActiveCarrier,
  createCarrier,
  writeCarrier,
  writeCarrierVelocity,
  writePointVelocity,
  isInterpolatedEntity
});
