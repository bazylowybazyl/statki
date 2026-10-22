// Elektrownia „KOREK” — WINDY KOSMICZNE: kotwice tuż za krawędzią gryzu i liny do pierścienia odbiornika na orbicie
// (kabiny jadą w górę i w dół). Geometria CPU w ramie elektrowni (earthBitePlantFrame.js), części z rodzajem powierzchni
// (PART): kotwice — materiał metalu, liny — materiał przepływu (kabiny wzdłuż uv.y).
import * as THREE from 'three/webgpu';
import {
  DEG, PART, finalizePart, surfacePoint, surfaceUp, basisAt, cylinderBetween, plantZ0, hubHeight, rimAngle
} from './earthBitePlantFrame.js';

/** Wymiary wind (R Ziemi). Azymuty (`elevators`), odsunięcie kotwic (`anchorPad`) — w PLANT_LAYOUT. */
export const ELEV_DEFAULTS = Object.freeze({
  elevTetherR: 0.0012,     // promień liny
  elevTopR: 1.043          // promień od środka Ziemi, z którego wychodzi lina (szczyt wieży kotwicy)
});

/** Punkt zaczepienia liny na pierścieniu odbiornika (rama elektrowni) dla azymutu phi. */
export function tetherHubPoint(L, b, phi, out = new THREE.Vector3()) {
  return out.set(Math.cos(phi) * L.hubRing, hubHeight(L, b), -Math.sin(phi) * L.hubRing);
}

/** Windy: { metal: części, flow: części } w ramie elektrowni. */
export function buildElevators(L, b) {
  const z0 = plantZ0(b);
  const metal = [];
  const flow = [];
  L.elevators.forEach((az, i) => {
    const phi = az * DEG;
    const th = rimAngle(phi, b) + L.anchorPad;
    const up = surfaceUp(th, phi);
    const base = surfacePoint(th, phi, 1, z0);
    const m = basisAt(up, base);
    // kotwica: blok i wieża wzdłuż pionu miejsca
    const block = new THREE.BoxGeometry(0.03, 0.012, 0.03);
    block.translate(0, 0.004, 0);
    block.applyMatrix4(m);
    metal.push(finalizePart(block, PART.HULL, i / L.elevators.length));
    const tower = new THREE.CylinderGeometry(0.0035, 0.006, 0.035, 16, 1, false);
    tower.translate(0, 0.0175 + 0.008, 0);
    tower.applyMatrix4(m);
    metal.push(finalizePart(tower, PART.HULL, (i + 0.5) / L.elevators.length));
    // lina: szczyt wieży → pierścień odbiornika; połowa lin — kabiny w górę, połowa — w dół
    const top = surfacePoint(th, phi, L.elevTopR, z0);
    const hub = tetherHubPoint(L, b, phi);
    const g = cylinderBetween(top, hub, L.elevTetherR, 8);
    flow.push(finalizePart(g, PART.TETHER, i / L.elevators.length, top.distanceTo(hub), i % 2 ? -1 : 1));
  });
  return { metal, flow };
}
