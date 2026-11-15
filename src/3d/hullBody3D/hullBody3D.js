// src/3d/hullBody3D/hullBody3D.js
//
// BRYŁA KADŁUBA 3D pod wierzchem z kreatora — obraz (niewpięty do gry; demo dema/miasto-3d.html i generator
// dema/kreator-kadluba-webgpu.html, opis docs/OPIS-miasto-3d.md § 11). Geometrię liczy hullBodyGeometry.js (burta
// z rowem i światłami, spód z grzbietem); materiał to materiał modeli floty gry (createShipMaterial — paleta
// SHIP3D_MAT, szwy paneli, światła E_* w emisji), więc bryła wchodzi do „Statków 3D” jak inne modele. Jeden rysunek.
// Nie czyta `window`, DOM ani stanu gry: wołający podaje obrys (pole kreatora), pozę i widoczność.

import * as THREE from 'three/webgpu';
import { diffuseColor, dot, max, normalWorld, uniform } from 'three/tsl';
import { MeshBuilder3D, SHIP3D_MAT as M } from '../ships3d/meshBuilder3D.js';
import { createShipMaterial } from '../ships3d/shipMaterials3D.tsl.js';
import { buildHullBodyGeometry, hullBodyLoopsFromField } from './hullBodyGeometry.js';

/**
 * Paleta bryły (nadpisania SHIP3D_MAT): burta jasnoszara jak płyty Terra Novy, rów ciemny, światła rowu ciepłe
 * i chłodne — rzadkie (emisja nad progiem bloomu tylko w samym kwadracie światła).
 */
export const HULL_BODY_PALETTE = Object.freeze({
  [M.PAINT]: { color: '#a3a9b2', rough: 0.62, metal: 0.28, seams: 0.85 },
  [M.PANEL]: { color: '#6c727b', rough: 0.66, metal: 0.3, seams: 0.6 },
  [M.DARK]: { color: '#16191e', rough: 0.6, metal: 0.4, seams: 0.5 },
  [M.BRIGHT]: { color: '#c9ced5', rough: 0.45, metal: 0.4, seams: 0.2 },
  [M.E_WINDOW]: { color: '#2b2518', rough: 0.3, metal: 0.1, emissive: '#ffd7a0', power: 2.4, seams: 0 },
  [M.E_ICE]: { color: '#10262b', rough: 0.4, metal: 0.2, emissive: '#9fd6ff', power: 2.6, seams: 0 }
});

/** Zastępcza geometria (ten sam układ atrybutów co bryła — rozgrzewka przed pierwszym okrętem). */
function placeholderGeometry() {
  const B = new MeshBuilder3D();
  B.box(0, 0, -10, 10, 10, 10, { mat: M.PAINT });
  return B.toGeometry(THREE);
}

function geometryOf(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
  g.setAttribute('aMat', new THREE.BufferAttribute(d.mat, 1));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Bryła jednego okrętu. `opts`: { scene }. Metody: setFromField(pole kreatora) / setOutline(łamane projektu),
 * setPose(x, y, kąt) [świat gry], update(widoczność), warmupMeshes(), dispose(); `stats`.
 */
export function createHullBody3D({ scene } = {}) {
  // WYPEŁNIENIE ŚWIATŁEM (demo): w grze modele oświetla mapa otoczenia (applyShip3DEnv, shipModels3DGame.js — leniwa,
  // `needsUpdate` po kompilacji), a światła sceny Core3D są słabe; tu do emisji idzie barwa × (otoczenie + słońce
  // jak kadłub i miasto: kierunek do słońca z z = 600 + niebo). uFill.w = 0 — sam materiał floty.
  const uSun = uniform(new THREE.Vector3(-0.7, 0.7, 0.01));
  const uFill = uniform(new THREE.Vector4(0.3, 1.05, 0.1, 1));
  const fill = uFill.x.add(uFill.y.mul(max(dot(normalWorld, uSun), 0.0))).add(uFill.z.mul(normalWorld.z.mul(0.5).add(0.5)));
  const mat = createShipMaterial({
    name: 'bryła kadłuba (hullBody3D)', palette: HULL_BODY_PALETTE, panelW: 46, panelH: 12, rim: 0.7,
    emissiveAdd: diffuseColor.rgb.mul(fill).mul(uFill.w)
  });
  const mesh = new THREE.Mesh(placeholderGeometry(), mat);
  mesh.name = 'HullBody3D';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const group = new THREE.Group();
  group.name = 'HullBody3D';
  group.add(mesh);
  group.visible = false;
  if (scene) scene.add(group);
  const stats = { triangles: 0, lights: 0, setMs: 0, outlineMs: 0, depth: 0, edgeDepth: 0 };
  let built = false;
  const pose = { x: 0, y: 0 };

  /** Bryła z łamanych poziomu 0 (układ projektu). */
  function setOutline(loops0, opts = {}) {
    const t0 = performance.now();
    const d = buildHullBodyGeometry(loops0, opts);
    if (!d) { built = false; group.visible = false; return stats; }
    const old = mesh.geometry;
    mesh.geometry = geometryOf(d);
    old.dispose();
    built = true;
    Object.assign(stats, d.stats, { setMs: Math.round(performance.now() - t0) });
    return stats;
  }

  /** Bryła z pola kreatora (obrys ramy z izolinii pola poziomu 0). */
  function setFromField(field, opts = {}) {
    const t0 = performance.now();
    const loops = hullBodyLoopsFromField(field);
    stats.outlineMs = Math.round(performance.now() - t0);
    return setOutline(loops, opts);
  }

  /** Poza kadłuba [świat gry]: środek okrętu (układ projektu = środek obrazu) i kąt (jak miasto 3D). */
  function setPose(x, y, angle = 0) {
    pose.x = x; pose.y = y;
    group.position.set(x, -y, 0);
    group.rotation.set(0, 0, -angle);
    group.updateMatrixWorld(true);
  }

  /** Słońce [świat gry] — kierunek wypełnienia jak kadłub i miasto (niemal poziomo, z = 600). */
  function setSun(x, y) {
    uSun.value.set(x - pose.x, -(y - pose.y), 600).normalize();
  }

  /** Widoczność; `fill` — siła wypełnienia (otoczenie, słońce, niebo; null — bez zmian). */
  function update(visibility = 1, opts = null) {
    group.visible = built && visibility > 0.01;
    if (opts?.fill) uFill.value.set(opts.fill.ambient ?? uFill.value.x, opts.fill.sun ?? uFill.value.y, opts.fill.sky ?? uFill.value.z, opts.fill.on === false ? 0 : 1);
  }

  return {
    setOutline, setFromField, setPose, setSun, update, stats, group, mesh, uniforms: { uSun, uFill },
    get built() { return built; },
    warmupMeshes() { return [mesh]; },
    dispose() { scene?.remove(group); mesh.geometry.dispose(); mat.dispose(); }
  };
}
