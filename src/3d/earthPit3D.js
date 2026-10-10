// Wielka kopalnia ringu na Ziemi — łata-bryła na kuli planety (gra: planet3d.assets.js, tło menu).
// Kształt: earthPitShape.js (dane src/data/earthPit.js), cieniowanie: gałąź uPitMode = 2 w grafie
// powierzchni (planet3d.assets.tsl.js / earthPit.tsl.js). Kula planety wycina u siebie obszar
// dziury (uPitMode = 1); łata siedzi jako dziecko siatki kuli (obrót doby, soczewka warpa i skala
// grupy działają same) i używa tego samego materiału co kula — te same mapy, ten sam szew.
import * as THREE from 'three/webgpu';
import { buildEarthPitPatch } from './earthPitShape.js';

let _geometry = null;

/** Geometria łaty — wspólna (kula o promieniu 1; skala z grupy planety). */
export function earthPitGeometry() {
  if (_geometry) return _geometry;
  const p = buildEarthPitPatch();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
  g.setIndex(new THREE.BufferAttribute(p.index, 1));
  g.computeBoundingSphere();
  _geometry = g;
  return g;
}

/**
 * Uniformy łaty: te same obiekty `{ value }` co kula (mapy, słońce, mgiełka, cień ringu),
 * własny tylko tryb dziury.
 */
export function earthPitUniforms(sphereUniforms) {
  return { ...sphereUniforms, uPitMode: { value: 2 } };
}

/** Siatka łaty dla materiału `material` (lekki materiał na grafie kuli). */
export function createEarthPitMesh(material) {
  const mesh = new THREE.Mesh(earthPitGeometry(), material);
  mesh.name = 'EarthPit';
  return mesh;
}
