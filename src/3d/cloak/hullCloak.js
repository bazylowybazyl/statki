// src/3d/cloak/hullCloak.js
//
// Klej maskowania z renderem kadłubów (hexShips3D.js) — 2026-10-04, efekt jak w Crysis.
//   • obraz wyglądu (cząstki, światła, wizjer) z kroku tej klatki, który liczy gra (RW-26 — src/game/cloakLooks.js:
//     poza z renderu, środek sprite'a z kratownicy kadłuba, ruch i obrót, src/game/cloakLook.js);
//   • trzymacze slotu kadłuba (uCloakA..E) — `cloakHullHolder`;
//   • refrakcja tła: siatka partii skór w warstwie DIST (HullCloakDistNodeMaterial — wspólny graf, partia
//     ma swoje trzymacze tekstur) widoczna tylko przy maskowanym kadłubie w partii; krok Core3D.fx zgłasza
//     warstwę (Core3D.setDistortLayerActive — flagę kasuje klatka efektów, więc zgłoszenie idzie z kroku);
//   • cząstki i światła (cloakFx.js), rozgrzewka pipeline'u warstwy DIST na ekranie ładowania.
import * as THREE from 'three/webgpu';
import { Core3D } from '../core3d.js';
import { FX_DISTORT_LAYER } from '../fx/fxFrame.js';
import { HULL_EMPTY_SPRITE_TEXTURE, HULL_FLAT_NORMAL_TEXTURE, HullCloakDistNodeMaterial } from '../hexShips3D.tsl.js';
import { CLOAK_SHARED } from './cloakTSL.js';
import { CloakFx } from './cloakFx.js';
import { setCloakView } from './cloakView.js';
import { CLOAK_LOOK_OFF } from '../../game/cloakLook.js';
import { HullBodies } from '../../game/hullBodies.js';

/** Trzymacz wartości slotu kadłuba (createHullUniforms): look encji albo „wyłączone”. */
export function cloakHullHolder(entity, key) {
  return {
    get value() {
      const l = entity ? entity.__cloakLook : null;
      return l && l.active ? l[key] : CLOAK_LOOK_OFF[key];
    }
  };
}

let _active = 0;
const _probe = (e, x, y) => HullBodies.probe(e, x, y);

/**
 * Raz na klatkę renderu (updateHexShips3D, po wspólnych uniformach kadłubów): OBRAZ maskowania z kroku wyglądu tej
 * klatki, który policzyła gra (RW-26: src/game/cloakLooks.js — `stepCloakLooks` przed updateHexShips3D): cząstki
 * i światła (CloakFx) encji z aktywnym wyglądem, wizjer gracza, siła refrakcji. frame — CLOAK_LOOK_FRAME (null —
 * bez maskowania w tej klatce), zoomPx — px bufora na jednostkę świata. Zwraca liczbę aktywnych wyglądów.
 */
export function renderCloakLooks(frame, zoomPx) {
  CLOAK_SHARED.uZoomPx.value = zoomPx > 0 ? zoomPx : 1;
  if (!frame) { _active = 0; return 0; }
  const list = frame.list;
  const dt = frame.dt;
  const player = frame.player;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const look = e.__cloakLook;
    if (look) CloakFx.update(e, look, dt, _probe, e === player);
  }
  if (frame.playerLook) updateView(frame.playerLook, dt, frame.time);
  _active = list.length;
  return _active;
}

// Wizjer gracza (cloakView.js): ukrycie, zakłócenie, migotanie przy końcu energii (bez pierścienia przy
// włączaniu — usunięty 2026-10-05). Podzielony ekran — bez wizjera (post jest wspólny dla obu połówek).
function updateView(look, dt, t) {
  if (typeof window !== 'undefined' && window.splitScreenMode) return;
  if (!look.active) return;   // bez zgłoszenia — post wyłącza wizjer sam
  const flick = look.flicker > 0 ? 1 - 0.45 * look.flicker * (0.5 + 0.5 * Math.sin(t * 31) * Math.sin(t * 7.3)) : 1;
  setCloakView((1 - look.vis) * flick, look.glitch);
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
