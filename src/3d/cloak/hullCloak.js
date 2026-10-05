// src/3d/cloak/hullCloak.js
//
// Klej maskowania z renderem kadłubów (hexShips3D.js) — 2026-10-04, efekt jak w Crysis.
//   • krok wyglądu (src/game/cloakLook.js) raz na klatkę renderu dla encji z `cloak`: poza z renderu
//     (interpolacja gracza), środek sprite'a z kratownicy kadłuba, ruch i obrót;
//   • trzymacze slotu kadłuba (uCloakA..E) — `cloakHullHolder`;
//   • refrakcja tła: siatka partii skór w warstwie DIST (HullCloakDistNodeMaterial — wspólny graf, partia
//     ma swoje trzymacze tekstur) widoczna tylko przy maskowanym kadłubie w partii; krok Core3D.fx zgłasza
//     warstwę (Core3D.setDistortLayerActive — flagę kasuje klatka efektów, więc zgłoszenie idzie z kroku);
//   • cząstki i światła (cloakFx.js), rozgrzewka pipeline'u warstwy DIST na ekranie ładowania.
import * as THREE from 'three/webgpu';
import { Core3D } from '../core3d.js';
import { FX_DISTORT_LAYER } from '../fx/fxFrame.js';
import { HULL_EMPTY_SPRITE_TEXTURE, HULL_FLAT_NORMAL_TEXTURE, HULL_SHARED, HullCloakDistNodeMaterial } from '../hexShips3D.tsl.js';
import { CLOAK_SHARED } from './cloakTSL.js';
import { CloakFx } from './cloakFx.js';
import { setCloakView } from './cloakView.js';
import { CLOAK_LOOK_OFF, createCloakLook, stepCloakLook } from '../../game/cloakLook.js';
import { HullBodies, hullSpriteRotation } from '../../game/hullBodies.js';

/** Trzymacz wartości slotu kadłuba (createHullUniforms): look encji albo „wyłączone”. */
export function cloakHullHolder(entity, key) {
  return {
    get value() {
      const l = entity ? entity.__cloakLook : null;
      return l && l.active ? l[key] : CLOAK_LOOK_OFF[key];
    }
  };
}

const _pose = { x: 0, y: 0, angle: 0, scale: 1, spriteW: 1, spriteH: 1, speed: 0, turn: 0 };
let _seedNext = 1;
let _lastMs = 0;
let _active = 0;
const _probe = (e, x, y) => HullBodies.probe(e, x, y);

/**
 * Raz na klatkę renderu (updateHexShips3D, po wspólnych uniformach kadłubów): wygląd maskowania encji
 * z `cloak` (albo z wyglądem, który jeszcze gaśnie). getPose(e) → { x, y, angle } pozy renderu albo null,
 * zoomPx — px bufora na jednostkę świata (siła refrakcji), player — encja gracza (wstrząs przy zerwaniu).
 * Zwraca liczbę aktywnych wyglądów.
 */
export function updateCloakLooks(entities, nowMs, getPose, zoomPx, player = null) {
  const dt = _lastMs > 0 ? Math.min(0.1, Math.max(0, (nowMs - _lastMs) * 0.001)) : 0;
  _lastMs = nowMs;
  CLOAK_SHARED.uZoomPx.value = zoomPx > 0 ? zoomPx : 1;
  const t = HULL_SHARED.uTime.value;
  let n = 0;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e || (!e.cloak && !e.__cloakLook)) continue;
    let look = e.__cloakLook;
    if (!look) {
      // Od razu przy encji z maskowaniem (także wyłączonym): pierwsze przejście off → engaging to zdarzenie
      // (impuls siatki, cząstki) — wygląd tworzony dopiero w trakcie włączania już by go nie zobaczył.
      if (!e.cloak) continue;
      look = e.__cloakLook = createCloakLook(e.cloak, (_seedNext++ * 7919) & 0xffff);
    }
    if (!writeEntityPose(e, getPose, _pose)) { look.active = false; continue; }
    if (stepCloakLook(look, e.cloak, dt, t, _pose)) {
      n++;
      CloakFx.update(e, look, dt, _probe, e === player);
    }
    if (e === player) updateView(look, dt, t);
  }
  _active = n;
  return n;
}

// Wizjer gracza (cloakView.js): ukrycie, zakłócenie, migotanie przy końcu energii (bez pierścienia przy
// włączaniu — usunięty 2026-10-05). Podzielony ekran — bez wizjera (post jest wspólny dla obu połówek).
function updateView(look, dt, t) {
  if (typeof window !== 'undefined' && window.splitScreenMode) return;
  if (!look.active) return;   // bez zgłoszenia — post wyłącza wizjer sam
  const flick = look.flicker > 0 ? 1 - 0.45 * look.flicker * (0.5 + 0.5 * Math.sin(t * 31) * Math.sin(t * 7.3)) : 1;
  setCloakView((1 - look.vis) * flick, look.glitch);
}

// Poza wzoru: środek sprite'a w świecie gry, kąt osi +u sprite'a, skala i rozmiar sprite'a, ruch.
function writeEntityPose(e, getPose, out) {
  const hull = e.beamHull;
  if (!hull || hull.entity !== e || !hull.body || hull.body.dead) return false;
  const pose = getPose ? getPose(e) : null;
  const ex = pose ? pose.x : (e.pos ? e.pos.x : Number(e.x) || 0);
  const ey = pose ? pose.y : (e.pos ? e.pos.y : Number(e.y) || 0);
  const angle = pose ? pose.angle : (Number(e.angle) || 0);
  const a = angle + hullSpriteRotation(e);
  // Środek sprite'a w układzie ciała (jak modele 3D: latticeMin + anchorD) względem kotwicy encji.
  const theta = -a;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const bx = hull.body.latticeMin.x + hull.anchorDX - HullBodies.anchorLocalX(hull);
  const by = hull.body.latticeMin.y + hull.anchorDY - HullBodies.anchorLocalY(hull);
  // ciało → scena (obrót θ), scena → świat (y odbite)
  out.x = ex + (c * bx - s * by);
  out.y = ey - (s * bx + c * by);
  out.angle = a;
  out.scale = hull.scale;
  out.spriteW = hull.srcWidth;
  out.spriteH = hull.srcHeight;
  const vx = e.vel ? e.vel.x : Number(e.vx) || 0;
  const vy = e.vel ? e.vel.y : Number(e.vy) || 0;
  out.speed = Math.sqrt(vx * vx + vy * vy);
  out.turn = Number(e.angVel ?? e.angularVelocity) || 0;
  return true;
}

/** Cień kadłuba (maska słońca) — schowany, gdy więcej niż pół kadłuba jest ukryte. */
export function cloakHidesShadow(entity) {
  const l = entity ? entity.__cloakLook : null;
  return !!l && l.active && l.vis < 0.5;
}

// ── Refrakcja (warstwa DIST) ────────────────────────────────────────────────────

let _distLive = false;
let _fxStep = null;

function ensureFxStep() {
  if (_fxStep || !Core3D.fx || typeof Core3D.addFxStep !== 'function') return;
  // Flaga warstwy DIST jest kasowana na starcie klatki efektów — zgłoszenie z kroku (jak pule broni).
  _fxStep = Core3D.addFxStep({
    name: 'maskowanie',
    update() { if (_distLive) Core3D.setDistortLayerActive(true); }
  });
}

/** Po ustaleniu widoczności partii skór (syncSkinBatches): siatki DIST partii z maskowanym kadłubem. */
export function syncCloakDist(batches, scene) {
  let live = false;
  if (_active > 0) {
    for (const batch of batches) {
      const want = batch.mesh.visible && batch.anyCloaked();
      if (want && !batch.distMesh) {
        const mesh = batch.attachDist(new HullCloakDistNodeMaterial(batch.material.uniforms), FX_DISTORT_LAYER);
        scene?.add(mesh);
      }
      if (batch.distMesh && batch.distMesh.visible !== want) batch.distMesh.visible = want;
      if (want) live = true;
    }
  } else {
    for (const batch of batches) if (batch.distMesh && batch.distMesh.visible) batch.distMesh.visible = false;
  }
  _distLive = live;
  if (live) ensureFxStep();
  return live;
}

// Rozgrzewka: pipeline warstwy DIST (cel distortionTarget) na ekranie ładowania — pierwsze maskowanie nie
// kompiluje nic w klatce. Trzymacz zostaje w scenie ukryty (stan budowy materiału żyje).
let _probeMesh = null;
function cloakDistProbe() {
  if (_probeMesh) return _probeMesh;
  if (!Core3D.scene) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setAttribute('aShadeHeat', new THREE.BufferAttribute(new Float32Array(16), 4));
  g.setAttribute('aUvSlot', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0]), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
  const mat = new HullCloakDistNodeMaterial({
    uSprite: { value: HULL_EMPTY_SPRITE_TEXTURE },
    uNormalMap: { value: HULL_FLAT_NORMAL_TEXTURE }
  });
  const m = new THREE.Mesh(g, mat);
  m.name = 'hullProbe:cloakDist';
  m.frustumCulled = false;
  m.visible = false;
  m.layers.set(FX_DISTORT_LAYER);
  Core3D.scene.add(m);
  _probeMesh = m;
  return m;
}
Core3D.warmup?.add({ name: 'maskowanie: refrakcja kadłubów', objects: () => cloakDistProbe(), layer: FX_DISTORT_LAYER, phase: 'loading' });

export const HullCloak = {
  get active() { return _active; },
  get distLive() { return _distLive; },
  fx: CloakFx
};
if (typeof window !== 'undefined') window.__hullCloak = HullCloak;
