// dema/asteroidy-webgpu/rockSpin.tsl.js (kopia src/3d/asteroids/rockSpin.tsl.js — zmiana w obu)
//
// Kwaternion skały pola w czasie (shader skał — rockMaterial.js, wierzchołki): obrót wokół osi
// instancji (iSpin.xyz, tempo iSpin.w, faza iShape.w) złożony z orientacją bazową (iRot) — jak
// dotąd — i KOZIOŁKOWANIE skał tła (strumień D planu pasa, etap D2, 2026-10-12): część skał
// (fract(ziarno · 8) < udział) precesuje osią obrotu wokół osi L = iRot · ẑ z tempem
// |iSpin.w| × mix(rate) (fract(ziarno · 64)) — ruch niezasadniczy (Toutatis, Apophis):
// q = qL(Ω t) · qObrót · q0. Bez koziołkowania (tumble = false: pasmo gry, minerały, cienie)
// wyrażenie jest dokładnie dawnym — ten sam WGSL.
//
// Lustro CPU: src/game/asteroidRotation.js (rockTumble, rockOrientationAt) — zmiana tu = zmiana
// tam (i odwrotnie); stałe w TUMBLE_CONFIG. Funkcja wklejana (bez setLayout — woła funkcje
// z layoutem, pułapka 35).

import { float, vec3, vec4, sin, cos, fract, mix, abs, select } from 'three/tsl';
import { quatMul, quatRotate } from './tslCommon.js';
import { TUMBLE_CONFIG } from '../../src/game/asteroidRotation.js';

/**
 * @param iRot vec4 orientacja bazowa, @param iSpin vec4 (oś, tempo), @param iShape vec4 (…, ziarno z,
 * faza w), @param time czas obrotu (S.time), @param tumble bool — wariant grafu z koziołkowaniem (tło).
 */
export function rockSpinQuat(iRot, iSpin, iShape, time, tumble = false) {
  const ang = iShape.w.add(iSpin.w.mul(time)).mul(0.5).toVar();
  const q = quatMul(vec4(iSpin.xyz.mul(sin(ang)), cos(ang)), iRot).toVar();
  if (!tumble) return q;
  const seed = iShape.z;
  const on = fract(seed.mul(8.0)).lessThan(float(TUMBLE_CONFIG.share));
  const k = mix(float(TUMBLE_CONFIG.rate[0]), float(TUMBLE_CONFIG.rate[1]), fract(seed.mul(64.0)));
  const axis = quatRotate(iRot, vec3(0.0, 0.0, 1.0)).toVar();
  const pa = abs(iSpin.w).mul(k).mul(time).mul(0.5).toVar();
  const qp = quatMul(vec4(axis.mul(sin(pa)), cos(pa)), q);
  return select(on, qp, q).toVar();
}
