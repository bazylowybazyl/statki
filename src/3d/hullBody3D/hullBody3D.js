// src/3d/hullBody3D/hullBody3D.js
//
// BRYŁA KADŁUBA 3D pod wierzchem z kreatora — obraz (niewpięty do gry; demo dema/miasto-3d.html i generator
// dema/kreator-kadluba-webgpu.html, opis docs/OPIS-miasto-3d.md § 11). Geometrię liczy hullBodyGeometry.js (burta
// z rowem i światłami, spód z grzbietem); materiał to materiał modeli floty gry (createShipMaterial — paleta
// SHIP3D_MAT, szwy paneli, światła E_* w emisji), więc bryła wchodzi do „Statków 3D” jak inne modele. Jeden rysunek.
// Nie czyta `window`, DOM ani stanu gry: wołający podaje obrys (pole kreatora), pozę i widoczność.

import * as THREE from 'three/webgpu';
import {
  abs, attribute, diffuseColor, dot, float, floor, fract, fwidth, max, min, mix, normalLocal, normalWorld, positionLocal, sin,
  smoothstep, step, texture, uniform, uv, vec2
} from 'three/tsl';
import { MeshBuilder3D, SHIP3D_MAT as M } from '../ships3d/meshBuilder3D.js';
import { createShipMaterial } from '../ships3d/shipMaterials3D.tsl.js';
import { MAIN_EXHAUST_PALETTES } from '../../data/engineFx.js';
import { buildHullBodyGeometry, hullBodyLoopsFromField } from './hullBodyGeometry.js';

/** Barwa emisji z rampy strugi MAIN gry (liniowa HDR) → { emissive sRGB, power }. */
function rampEmissive(rgb, gain = 1) {
  const m = Math.max(rgb[0], rgb[1], rgb[2], 1e-6);
  const c = new THREE.Color().setRGB(rgb[0] / m, rgb[1] / m, rgb[2] / m, THREE.LinearSRGBColorSpace);
  return { emissive: `#${c.getHexString()}`, power: m * gain };
}
// żar dysz: paleta strugi MAIN „plazma” (src/data/engineFx.js) — pas przy gardzieli z drugiego stopnia rampy, rdzeń
// z trzeciego; moc przycięta (świeci jak emitery gry, nie zalewa kadru bloomem)
const MAIN_PAL = MAIN_EXHAUST_PALETTES.find((p) => p.id === 'plazma') || MAIN_EXHAUST_PALETTES[0];
const ENGINE_GLOW = rampEmissive(MAIN_PAL.ramp[1], 1.1);
const ENGINE_CORE = rampEmissive(MAIN_PAL.ramp[2], 0.7);

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
  [M.E_ICE]: { color: '#10262b', rough: 0.4, metal: 0.2, emissive: '#9fd6ff', power: 2.6, seams: 0 },
  [M.METAL]: { color: '#4d535c', rough: 0.4, metal: 0.75, seams: 0.25 },
  [M.E_ENGINE]: { color: '#0b1424', rough: 0.4, metal: 0.2, emissive: ENGINE_GLOW.emissive, power: ENGINE_GLOW.power, seams: 0 },
  [M.E_WHITE]: { color: '#2a2a2a', rough: 0.4, metal: 0.2, emissive: ENGINE_CORE.emissive, power: ENGINE_CORE.power, seams: 0 }
});

/** Zastępcza tekstura pokładu (jak tekstura skóry kadłuba: sRGB, filtr z mipmapami) — ten sam shader przed i po. */
function placeholderDeck() {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Zastępcza geometria (ten sam układ atrybutów co bryła — rozgrzewka przed pierwszym okrętem). */
function placeholderGeometry() {
  const B = new MeshBuilder3D();
  B.box(0, 0, -10, 10, 10, 10, { mat: M.PAINT });
  const g = B.toGeometry(THREE);
  g.setAttribute('aBand', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count), 1));
  return g;
}

function geometryOf(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
  g.setAttribute('aMat', new THREE.BufferAttribute(d.mat, 1));
  g.setAttribute('aBand', new THREE.BufferAttribute(d.band || new Float32Array(d.mat.length), 1));
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
  // WIERZCH (materiał DECK): obraz kompozytora — ta sama tekstura GPU co skóra kadłuba (acquireHullVisualTexture po
  // stronie wołającego), podmieniana wartością węzła (graf bez zmian)
  const deckEmpty = placeholderDeck();
  const deckNode = texture(deckEmpty, uv());
  const mat = createShipMaterial({
    name: 'bryła kadłuba (hullBody3D)', palette: HULL_BODY_PALETTE, panelW: 46, panelH: 12, rim: 0.7,
    deckMapNode: deckNode, emissiveAdd: diffuseColor.rgb.mul(fill).mul(uFill.w)
  });
  // PŁYTY SPODU (etap 2): jasny spód nie jest jednolity — rzędy płyt wzdłuż sylwetki (pasmo = odległość od burty
  // `aBand`, co 170 j.), styki poprzeczne co 360 j. (rząd przesunięty), ton płyty ±8%, ~8% płyt ciemniejszych (akcenty),
  // pas kila (|y| < 30 j.); tylko farba (PAINT) na ścianach w dół. Szwy gasną z oddaleniem (bez mory).
  {
    const aBand = attribute('aBand', 'float');
    const aMatN = attribute('aMat', 'float');
    const isPaint = step(0.5, aMatN).mul(step(aMatN, 1.5));
    const down = step(normalLocal.z, -0.5);
    const r = aBand.div(170.0);
    const row = floor(r);
    const c = positionLocal.x.add(fract(sin(row.mul(12.9898)).mul(43758.5453)).mul(360.0)).div(360.0);
    const col = floor(c);
    const h = fract(sin(dot(vec2(row, col), vec2(12.9898, 78.233))).mul(43758.5453));
    const tone = h.sub(0.5).mul(0.16).add(1.0).mul(mix(float(1.0), float(0.8), step(h, 0.08)));
    const fr = fract(r), fc = fract(c);
    const edge = min(min(fr, fr.oneMinus()).mul(170.0), min(fc, fc.oneMinus()).mul(360.0));
    const aa = fwidth(aBand).add(fwidth(positionLocal.x)).mul(0.5).add(1e-3);
    const seam = smoothstep(float(0.6), aa.mul(1.5).add(0.6), edge).oneMinus().mul(smoothstep(4.0, 1.5, aa));
    const keel = smoothstep(float(30.0), aa.add(30.0), abs(positionLocal.y)).oneMinus();
    const plates = tone.mul(seam.mul(0.35).oneMinus()).mul(keel.mul(0.22).oneMinus());
    mat.colorNode = mat.colorNode.mul(mix(float(1.0), plates, isPaint.mul(down)));
  }
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
  let built = false, topGrid = null;
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
    topGrid = d.topGrid || null;
    Object.assign(stats, d.stats, { setMs: Math.round(performance.now() - t0) });
    return stats;
  }

  /**
   * Bryła z pola kreatora (obrys ramy z izolinii pola poziomu 0) z WIERZCHEM jako płytkim dachem: `opts.drop` — spadek
   * przy burcie [j.] (0 — płasko), cokoły pod gniazdami modeli gry (mostki i rdzenie v 2), uv z pudła obrazu pola.
   */
  function setFromField(field, opts = {}) {
    const t0 = performance.now();
    const loops = hullBodyLoopsFromField(field);
    stats.outlineMs = Math.round(performance.now() - t0);
    const pins = (field?.expanded?.modules || [])
      .filter((m) => (m.type === 'bridge' || m.type === 'reactor') && (m.v ?? 0) >= 2)
      .map((m) => ({ x: m.x, y: -m.y, r: m.type === 'reactor' ? (m.r || 40) : Math.max(m.w || 40, m.h || 40) }));
    const top = { drop: opts.drop, plateau: opts.plateau, pins, image: field?.image || null };
    // gondole MAIN projektu → bank dysz na rufie (kierunek wylotu: −x modułu)
    const engines = (field?.expanded?.modules || []).filter((m) => m.type === 'engine')
      .map((m) => ({ x: m.x, y: -m.y, w: m.w, h: m.h, rot: -(m.rot || 0) }));
    return setOutline(loops, { ...opts, top, engines });
  }

  /** Tekstura wierzchu (obraz kompozytora na GPU — tekstura skóry kadłuba) albo null. */
  function setTopTexture(tex) {
    deckNode.value = tex || deckEmpty;
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
    setOutline, setFromField, setTopTexture, setPose, setSun, update, stats, group, mesh, uniforms: { uSun, uFill },
    get built() { return built; },
    /** Wysokość wierzchu na siatce (układ sceny względem środka okrętu) — dla miasta: { x0, y0, cell, nx, ny, data }. */
    get topGrid() { return topGrid; },
    warmupMeshes() { return [mesh]; },
    dispose() { scene?.remove(group); mesh.geometry.dispose(); mat.dispose(); deckEmpty.dispose(); }
  };
}
