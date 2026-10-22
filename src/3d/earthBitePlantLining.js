// Elektrownia „KOREK” — OBUDOWA DZIURY: infrastruktura na dnie, ścianach i brzegu gryzu — przewody energii od korka do
// kotwic wind i do podstacji na ścianach. Geometria CPU w ramie elektrowni (earthBitePlantFrame.js), części z rodzajem
// powierzchni (PART): bryły — materiał metalu, przewody — materiał przepływu (impulsy wzdłuż uv.y).
import * as THREE from 'three/webgpu';
import {
  DEG, PART, finalizePart, bowlPoint, surfacePoint, biteCenter, plantZ0, rimAngle, rimPsi
} from './earthBitePlantFrame.js';
// AGENT: przewody mają zaczynać się przy stopie ściany (`wallFootPoint`, `bowlPsiAtHeight` — earthBitePlantFrame.js);
// od korka do stopy prowadzi je korek po mostach nad lawą (docs/BRIEF-korek.md § Kontrakt).

/** Wymiary obudowy (R Ziemi). */
export const LINING_DEFAULTS = Object.freeze({
  // przewody po dnie i ścianach: od korka do kotwic wind (główne) i do stacji na ścianach (boczne); promień rury,
  // zasięg bocznych (ułamek drogi do krawędzi), podstacje na przewodzie
  liningConduitR: 0.0035, liningSideConduits: [0, 60, 120, 180, 240, 300], liningSideReach: 0.62, liningSubstations: 3
});

/** Ścieżki przewodów: od podstawy korka po dnie i ścianie (ψ rośnie) — główne do kotwic za krawędzią, boczne do stacji. */
export function conduitPaths(L, b) {
  const z0 = plantZ0(b);
  const paths = [];
  // ψ podstawy korka: β · sin ψ = promień korka przy dnie
  const psi0 = Math.asin(Math.min(1, (L.corkR * 0.95) / b));
  const add = (az, reach, main) => {
    const phi = az * DEG;
    const psiRim = rimPsi(phi, b);
    const psi1 = psi0 + (psiRim - 0.02 - psi0) * reach;
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push(bowlPoint(phi, psi0 + (psi1 - psi0) * (i / 40), L.liningConduitR * 1.6, b, z0));
    if (main) {
      // przez krawędź do kotwicy (po kuli Ziemi, tuż nad gruntem)
      const thRim = rimAngle(phi, b);
      for (let i = 1; i <= 6; i++) pts.push(surfacePoint(thRim + L.anchorPad * (i / 6), phi, 1 + L.liningConduitR * 1.6, z0));
    }
    paths.push({ az, main, pts });
  };
  for (const az of L.elevators) add(az, 1, true);
  for (const az of L.liningSideConduits) add(az, L.liningSideReach, false);
  return paths;
}

/** Obudowa: { metal: części, flow: części } w ramie elektrowni. */
export function buildLining(L, b) {
  const metal = [];
  const flow = [];
  for (const { pts, main } of conduitPaths(L, b)) {
    const curve = new THREE.CatmullRomCurve3(pts);
    const len = curve.getLength();
    const tube = new THREE.TubeGeometry(curve, 160, L.liningConduitR * (main ? 1 : 0.7), 8, false);
    // materiał przepływu: uv.y wzdłuż (impulsy od korka na zewnątrz)
    const uvA = tube.attributes.uv;
    for (let k = 0; k < uvA.count; k++) { const along = uvA.getX(k); uvA.setXY(k, 0.25, along); }
    flow.push(finalizePart(tube, PART.PIPE, main ? 0.25 : 0.75, len, 1));
    for (let i = 1; i <= L.liningSubstations; i++) {
      const t = i / (L.liningSubstations + 1);
      const at = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      // pion stacji: od punktu ku środkowi kuli gryzu (normalna ściany ≈ ku C)
      const toC = biteCenter(b).sub(at).normalize();
      const x = new THREE.Vector3().crossVectors(toC, tan).normalize();
      const z = new THREE.Vector3().crossVectors(x, toC);
      const m = new THREE.Matrix4().makeBasis(x, toC, z).setPosition(at);
      const box = new THREE.BoxGeometry(0.016, 0.008, 0.022);
      box.applyMatrix4(m);
      metal.push(finalizePart(box, PART.HULL, (i * 0.37) % 1));
    }
  }
  return { metal, flow };
}
