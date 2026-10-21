// Wielki gryz Ziemi — łata (ściany, dno, kołnierz brzegu) i klamry na kuli planety (gra: planet3d.assets.js,
// tło menu, demo planet). Kształt: earthBiteShape.js (dane src/data/earthBite.js), cieniowanie: gałąź
// uPitMode 2 / 3 w grafie powierzchni (planet3d.assets.tsl.js / earthBite.tsl.js). Kula planety wycina u siebie
// obszar gryzu (uPitMode = 1); łata i klamry siedzą jako dzieci siatki kuli (obrót doby, soczewka warpa i skala
// grupy działają same) i używają tego samego grafu co kula — te same mapy, ten sam szew.
import * as THREE from 'three/webgpu';
import { EARTH_BITE } from '../data/earthBite.js';
import { buildEarthBitePatch, buildEarthBiteRibs, earthBiteFrame } from './earthBiteShape.js';

const _geometry = new Map();

function toGeometry(p) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
  g.setIndex(new THREE.BufferAttribute(p.index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Geometria łaty i klamer — wspólna na promień gryzu (kula o promieniu 1; skala z grupy planety). */
export function earthBiteGeometry(b = EARTH_BITE.radiusR) {
  const key = b.toFixed(4);
  if (!_geometry.has(key)) {
    _geometry.set(key, {
      patch: toGeometry(buildEarthBitePatch(EARTH_BITE, { b })),
      ribs: toGeometry(buildEarthBiteRibs(EARTH_BITE, { b }))
    });
  }
  return _geometry.get(key);
}

/** Wartość uniformu `uBite` (środek gryzu w układzie obiektu kuli + promień bazowy). */
export function earthBiteVector(b = EARTH_BITE.radiusR, out = new THREE.Vector4()) {
  const { C } = earthBiteFrame(EARTH_BITE);
  return out.set(C[0], C[1], C[2], b);
}

/**
 * Uniformy łaty i klamer: te same obiekty `{ value }` co kula (mapy, słońce, mgiełka, cień ringu, `uBite`),
 * własny tylko tryb gryzu.
 */
export function earthBiteUniforms(sphereUniforms, mode) {
  return { ...sphereUniforms, uPitMode: { value: mode } };
}

/** Siatki łaty i klamer dla materiałów `patchMaterial` / `ribMaterial` (lekkie materiały na grafie kuli). */
export function createEarthBiteMeshes(patchMaterial, ribMaterial, b = EARTH_BITE.radiusR) {
  const geo = earthBiteGeometry(b);
  const patch = new THREE.Mesh(geo.patch, patchMaterial);
  patch.name = 'EarthBite';
  const ribs = new THREE.Mesh(geo.ribs, ribMaterial);
  ribs.name = 'EarthBiteRibs';
  return { patch, ribs };
}

const _qa = new THREE.Quaternion();
const _cv = new THREE.Vector3();
let _frame = null;

/**
 * Środek gryzu (i opcjonalnie wschód ramy) z układu siatki kuli `from` w układ obiektu `to` — rodzeństwa
 * w tej samej grupie (chmury obracają się szybciej niż grunt, dysk poświaty patrzy w kamerę). Bez alokacji.
 */
export function earthBiteCenterIn(from, to, outBite, outEast = null, b = EARTH_BITE.radiusR) {
  if (!_frame) _frame = earthBiteFrame(EARTH_BITE);
  _qa.copy(to.quaternion).invert().multiply(from.quaternion);
  _cv.fromArray(_frame.C).applyQuaternion(_qa);
  outBite.set(_cv.x, _cv.y, _cv.z, b);
  if (outEast) outEast.fromArray(_frame.E).applyQuaternion(_qa);
  return outBite;
}
