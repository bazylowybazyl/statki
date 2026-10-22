// Elektrownia „KOREK” — ODBIORNIK NA ORBICIE: pierścień-stacja na osi gryzu (pod wewnętrzną krawędzią ringu „Halo”),
// czasza zbierająca promień z korka (zwrócona w dół), zaczepy lin wind i nadajnik promienia przekaźnikowego do ringu.
// Geometria CPU w ramie elektrowni (earthBitePlantFrame.js), części z rodzajem powierzchni (PART) — materiał metalu.
import * as THREE from 'three/webgpu';
import { PART, finalizePart, hubHeight } from './earthBitePlantFrame.js';

/** Wymiary odbiornika (R Ziemi). hubRadius (od środka Ziemi), hubRing (promień pierścienia) — w PLANT_LAYOUT. */
export const HUB_DEFAULTS = Object.freeze({
  hubTube: 0.006,          // grubość pierścienia
  hubSpokes: 6
});

/** Odbiornik: { metal: części, flow: części } w ramie elektrowni. */
export function buildOrbital(L, b) {
  const hHub = hubHeight(L, b);
  const metal = [];
  const torus = new THREE.TorusGeometry(L.hubRing, L.hubTube, 24, 180);
  torus.rotateX(Math.PI / 2);
  torus.translate(0, hHub, 0);
  metal.push(finalizePart(torus, PART.HULL));
  for (let i = 0; i < L.hubSpokes; i++) {
    const s = new THREE.BoxGeometry(L.hubRing, L.hubTube * 0.6, L.hubTube * 0.9);
    s.translate(L.hubRing * 0.5, hHub, 0);
    // obrót wokół osi Y przechodzi przez środek odbiornika (x = z = 0), więc wysokość zostaje
    s.rotateY((i / L.hubSpokes) * Math.PI * 2);
    metal.push(finalizePart(s, PART.STRUCT, i / L.hubSpokes));
  }
  const dish = new THREE.CylinderGeometry(0.012, 0.022, 0.012, 48, 1, false);
  dish.translate(0, hHub - 0.004, 0);
  metal.push(finalizePart(dish, PART.HULL, 0.5));
  return { metal, flow: [] };
}
