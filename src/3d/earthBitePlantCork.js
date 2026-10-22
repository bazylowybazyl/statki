// Elektrownia „KOREK” — KOREK: czarna megabudowla zatykająca jądro na dnie gryzu (stoi w jeziorze płaszcza), z kraterem
// wylotu promienia pośrodku. Geometria CPU w ramie elektrowni (earthBitePlantFrame.js: y — wysokość nad dnem gryzu),
// części z rodzajem powierzchni (PART) — materiał metalu (earthBitePlant.tsl.js).
import * as THREE from 'three/webgpu';
import { PART, finalizePart } from './earthBitePlantFrame.js';

/** Wymiary korka (R Ziemi). corkR, corkTopH, apertureH, apertureR — w PLANT_LAYOUT (wspólne z promieniem i obudową). */
export const CORK_DEFAULTS = Object.freeze({
  // tarasy ku wylotowi: środkowy, wewnętrzny, krater
  corkMidR: 0.098, corkMidH: 0.059,
  corkInnerR: 0.046, corkInnerH: 0.065,
  corkCraterR: 0.024,
  // wieże chłodnicze na środkowym tarasie, żebra wymienników na boku
  corkTowers: 8, corkTowerRing: 0.073, corkTowerR: 0.0115, corkTowerH: 0.032,
  corkFins: 56
});

/** Korek: { metal: części, flow: części } w ramie elektrowni. */
export function buildCork(L, b) {
  const V = (r, h) => new THREE.Vector2(r, h);
  const metal = [];
  const profile = [
    V(L.corkR * 0.86, -0.03), V(L.corkR * 0.92, 0.02), V(L.corkR, L.corkTopH - 0.009), V(L.corkR, L.corkTopH - 0.004),
    V(L.corkR - 0.005, L.corkTopH), V(L.corkMidR + 0.002, L.corkTopH), V(L.corkMidR, L.corkMidH), V(L.corkInnerR + 0.002, L.corkMidH),
    V(L.corkInnerR, L.corkInnerH), V(L.corkCraterR + 0.002, L.corkInnerH), V(L.corkCraterR, L.apertureH),
    V(L.apertureR + 0.0025, L.apertureH), V(L.apertureR, L.apertureH - 0.012), V(L.apertureR * 0.97, 0.0)
  ];
  metal.push(finalizePart(new THREE.LatheGeometry(profile, 192), PART.HULL));
  for (let i = 0; i < L.corkTowers; i++) {
    const a = (i / L.corkTowers) * Math.PI * 2 + Math.PI / L.corkTowers;
    const t = new THREE.CylinderGeometry(L.corkTowerR * 0.78, L.corkTowerR, L.corkTowerH, 40, 1, false);
    t.translate(Math.cos(a) * L.corkTowerRing, L.corkMidH + L.corkTowerH * 0.5, Math.sin(a) * L.corkTowerRing);
    metal.push(finalizePart(t, PART.HULL, i / L.corkTowers));
  }
  for (let i = 0; i < L.corkFins; i++) {
    const f = new THREE.BoxGeometry(0.02, L.corkTopH - 0.016, 0.0024);
    f.translate(L.corkR * 0.97, (L.corkTopH - 0.016) * 0.5 + 0.004, 0);
    f.rotateY(-(i / L.corkFins) * Math.PI * 2);
    metal.push(finalizePart(f, PART.STRUCT, i / L.corkFins));
  }
  return { metal, flow: [] };
}
