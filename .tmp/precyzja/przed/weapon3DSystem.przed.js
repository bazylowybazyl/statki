// src/3d/weapon3DSystem.js
//
// Zakres po przebudowie 2026-08-26: pociski, wiązki, błyski wylotowe i wstrząs
// kamery. Wieżyczki NIE są już siatkami Three — rysuje je kanwa 2D
// (src/vfx/turret2D.js), bo modele 3D niosły po kilka oświetlanych draw calli
// na broń i puchły w passie FG przy zbliżeniu na flotę.
//
// Ten moduł pyta Turret2D tylko o pozycję wylotu (`triggerShot`), żeby płomień
// i początek wiązki trzymały się lufy.

import * as THREE from 'three';
import { Core3D } from '/src/3d/core3d.js';
import { DrawCallStats } from '/src/3d/drawCallStats.js';
import { Turret2D, normalizeWeaponFxKey } from '/src/vfx/turret2D.js';
import { Fx3D } from '/src/3d/fxParticles3D.js';
import { MuzzleFX3D } from '/src/3d/muzzleFx3D.js';
import { BulletTrails } from '/src/3d/slugTrail3D.js';
import { getEntityWeaponTier, WEAPON_TIER_SCALE } from '/src/data/ships.js';
import { WeaponShotBus } from '/src/game/weaponShotBus.js';

const WEP_RESOURCES = {
  geos: null,
  bulletHeadTex: null,
  bulletStyles: null,
  bulletInstanceMats: null,
  beamFxMats: null,
};
const BULLET_MAX_INSTANCES = 2000;
const bulletInstances = {
  trails: null,
  cores: null,
  heads: null,
  arcs: null,
  dummy: new THREE.Object3D()
};
const BEAM_SPIRAL_SEGMENTS = 48;
const MAX_CONTINUOUS_BEAM_VISUALS = 56;
// Sufit wizuali wiązki pulsacyjnej (Group + 2 Mesh + 2 materiały każdy, życie
// 0,15 s). Bez niego pula rosła na stałe: przy tysiącach strzałów PD na sekundę
// to było 450–1 100 aktywnych grup i ~2 000 draw calli. Po zapełnieniu
// recykling najstarszej aktywnej (jak MAX_CONTINUOUS_BEAM_VISUALS).
export const MAX_PULSE_BEAM_VISUALS = 96;
const BEAM_ENABLE_SPIRAL = false;
const BEAM_ENABLE_IMPACT_LIGHT = false;

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function makeHeadTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const g = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(190,230,255,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// HDR: mnożniki luminancji emiterów broni. Kolory stylów są LDR (<=1.0) i bez
// podbicia nigdy nie przekraczają progu bloomu (src/3d/bloomConfig.js), a przy
// dalekim zoomie subpikselowe rozcieńczenie MSAA gasiło poświatę skokowo.
// Zapas ~5x na rdzeniu utrzymuje bloom nawet przy ~20% pokrycia piksela.
const BULLET_HDR = Object.freeze({ trail: 2.6, core: 5.0, arc: 3.2 });
const MUZZLE_HDR = Object.freeze({ outer: 2.5, inner: 4.0 });
const BEAM_HDR = Object.freeze({ core: 4.0, glow: 2.4, spiral: 3.0 });

// Barwy HDR stylu pocisku liczone raz na styl. Color.set('#rrggbb') to
// parsowanie stringa regexem — szło 2× na pocisk na klatkę.
const BULLET_ARC_HDR_COLOR = new THREE.Color(0x9bf5ff).multiplyScalar(BULLET_HDR.arc);
function getBulletStyleHdr(style) {
  let hdr = style.__hdr;
  if (!hdr) {
    hdr = style.__hdr = {
      trail: new THREE.Color(style.trailColor).multiplyScalar(BULLET_HDR.trail),
      core: new THREE.Color(style.color).multiplyScalar(BULLET_HDR.core)
    };
  }
  return hdr;
}

// Wysyła na GPU tylko [0, count) instancji zamiast całego bufora — pełne
// bufory pocisków (2000 slotów) szły co klatkę nawet przy jednym pocisku.
// Zakres zastępuje poprzedni: instancje ≥ count i tak nie są rysowane.
function uploadInstancePrefix(attr, count, itemSize) {
  if (!attr || count <= 0) return;
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count * itemSize);
  attr.needsUpdate = true;
}

function ensureWeaponResources() {
  if (!WEP_RESOURCES.geos || !WEP_RESOURCES.bulletStyles) {
    // Po przeniesieniu wieżyczek na kanwę 2D zostaje jedna geometria: płaski
    // quad, z którego zbudowane są pociski, wiązki i błyski wylotowe.
    WEP_RESOURCES.geos = {
      planeUnit: new THREE.PlaneGeometry(1, 1)
    };

    WEP_RESOURCES.bulletHeadTex = makeHeadTexture();

    WEP_RESOURCES.bulletStyles = {
      vulcan: { key: 'vulcan', color: '#ffaa00', trailColor: '#ffc766', trailWidth: 2.0, coreWidth: 0.9, minLen: 14, stretch: 1.05, z: 14, headScale: 8, ionArcs: false },
      helios: { key: 'helios', color: '#ff003c', trailColor: '#ff628d', trailWidth: 3.0, coreWidth: 1.1, minLen: 26, stretch: 1.35, z: 14, headScale: 12, ionArcs: false },
      tempest: { key: 'tempest', color: '#00ccff', trailColor: '#7ee9ff', trailWidth: 3.6, coreWidth: 1.5, minLen: 20, stretch: 1.15, z: 14, headScale: 11, ionArcs: true },
      ciws: { key: 'ciws', color: '#8cffd0', trailColor: '#aaffdf', trailWidth: 1.4, coreWidth: 0.7, minLen: 12, stretch: 0.8, z: 14, headScale: 5, ionArcs: false },
      // Flak leci wolno i krótko — pocisk ma być widoczną, przysadzistą iskrą
      // z rozżarzonym łbem, żeby dało się śledzić, gdzie pęknie.
      flak: { key: 'flak', color: '#ffc258', trailColor: '#ffdc9a', trailWidth: 2.2, coreWidth: 1.0, minLen: 10, stretch: 0.7, z: 14, headScale: 9, ionArcs: false },
      autocannon: { key: 'autocannon', color: '#ffcc8a', trailColor: '#ffdba6', trailWidth: 1.8, coreWidth: 0.9, minLen: 16, stretch: 1.0, z: 14, headScale: 6, ionArcs: false },
      armata: { key: 'armata', color: '#ffb46b', trailColor: '#ffd6a0', trailWidth: 2.5, coreWidth: 1.2, minLen: 24, stretch: 1.2, z: 14, headScale: 10, ionArcs: false },
      plasma: { key: 'plasma', color: '#7cff9c', trailColor: '#aaffb4', trailWidth: 2.2, coreWidth: 1.1, minLen: 18, stretch: 1.1, z: 14, headScale: 9, ionArcs: false },
      rocket: { key: 'rocket', color: '#ffaaaa', trailColor: '#ffdddd', trailWidth: 1.8, coreWidth: 1.0, minLen: 14, stretch: 1.0, z: 14, headScale: 7, ionArcs: false },
      torpedo: { key: 'torpedo', color: '#ff4444', trailColor: '#ff6666', trailWidth: 3.5, coreWidth: 1.8, minLen: 24, stretch: 1.2, z: 14, headScale: 14, ionArcs: false },
      yamato: { key: 'yamato', color: '#ccffff', trailColor: '#00ffff', trailWidth: 7.0, coreWidth: 3.8, minLen: 180, stretch: 1.8, z: 14, headScale: 28, ionArcs: true },
      goliath: { key: 'goliath', color: '#ff8833', trailColor: '#ffaa55', trailWidth: 4.0, coreWidth: 2.0, minLen: 28, stretch: 1.2, z: 14, headScale: 14, ionArcs: false },
      plasmaGatling: { key: 'plasmaGatling', color: '#00ffcc', trailColor: '#66ffdd', trailWidth: 3.5, coreWidth: 1.6, minLen: 22, stretch: 1.3, z: 14, headScale: 12, ionArcs: false },
      laserPD: { key: 'laserPD', color: '#6ec8ff', trailColor: '#a0dfff', trailWidth: 1.2, coreWidth: 0.6, minLen: 10, stretch: 0.7, z: 14, headScale: 4, ionArcs: false },
      hexlance: { key: 'hexlance', color: '#aaddff', trailColor: '#d0eaff', trailWidth: 6.0, coreWidth: 3.2, minLen: 140, stretch: 1.6, z: 14, headScale: 24, ionArcs: true },
      siegeRail: { key: 'siegeRail', color: '#88ffff', trailColor: '#aaffff', trailWidth: 8.0, coreWidth: 4.5, minLen: 200, stretch: 2.0, z: 14, headScale: 32, ionArcs: true },
      default: { key: 'default', color: '#ffffff', trailColor: '#ffffff', trailWidth: 1.5, coreWidth: 0.8, minLen: 16, stretch: 1.0, z: 14, headScale: 6, ionArcs: false }
    };
  }

  ensureBulletInstances();
}

function ensureBulletInstances() {
  if (!Core3D.isInitialized || !Core3D.scene) return;
  if (bulletInstances.trails && bulletInstances.cores && bulletInstances.heads && bulletInstances.arcs) {
    if (!bulletInstances.trails.parent) Core3D.scene.add(bulletInstances.trails);
    if (!bulletInstances.cores.parent) Core3D.scene.add(bulletInstances.cores);
    if (!bulletInstances.heads.parent) Core3D.scene.add(bulletInstances.heads);
    if (!bulletInstances.arcs.parent) Core3D.scene.add(bulletInstances.arcs);
    return;
  }

  if (!WEP_RESOURCES.bulletInstanceMats) {
    WEP_RESOURCES.bulletInstanceMats = {
      trail: new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
      }),
      core: new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.98,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
      }),
      head: new THREE.MeshBasicMaterial({
        map: WEP_RESOURCES.bulletHeadTex,
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
      }),
      arc: new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
      })
    };
  }

  bulletInstances.trails = new THREE.InstancedMesh(WEP_RESOURCES.geos.planeUnit, WEP_RESOURCES.bulletInstanceMats.trail, BULLET_MAX_INSTANCES);
  bulletInstances.cores = new THREE.InstancedMesh(WEP_RESOURCES.geos.planeUnit, WEP_RESOURCES.bulletInstanceMats.core, BULLET_MAX_INSTANCES);
  bulletInstances.heads = new THREE.InstancedMesh(WEP_RESOURCES.geos.planeUnit, WEP_RESOURCES.bulletInstanceMats.head, BULLET_MAX_INSTANCES);
  bulletInstances.arcs = new THREE.InstancedMesh(WEP_RESOURCES.geos.planeUnit, WEP_RESOURCES.bulletInstanceMats.arc, BULLET_MAX_INSTANCES * 2);

  const meshes = [bulletInstances.trails, bulletInstances.cores, bulletInstances.heads, bulletInstances.arcs];
  for (const mesh of meshes) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
  }

  bulletInstances.trails.renderOrder = 78;
  bulletInstances.cores.renderOrder = 79;
  bulletInstances.heads.renderOrder = 80;
  bulletInstances.arcs.renderOrder = 81;

  Core3D.scene.add(bulletInstances.trails);
  Core3D.scene.add(bulletInstances.cores);
  Core3D.scene.add(bulletInstances.heads);
  Core3D.scene.add(bulletInstances.arcs);
}

// ── Błyski wylotowe ─────────────────────────────────────────────────────────
//
// Wieżyczki rysuje kanwa 2D (src/vfx/turret2D.js), ale sam płomień zostaje w
// 3D, żeby dalej szedł przez HDR i bloom razem z pociskami i wiązkami.
//
// Wcześniej każdy błysk był dzieckiem siatki wieżyczki: 2 meshe na lufę, po
// jednym materiale na barwę, setki obiektów w grafie sceny. Teraz cała scena ma
// DWA InstancedMeshe — koszt nie rośnie z liczbą strzelających wież.
const MUZZLE_MAX_INSTANCES = 192;
const MUZZLE_BASE_SIZE = 11;
const MUZZLE_DECAY = 14;

const muzzleInstances = {
  outer: null,
  core: null,
  active: [],
  pool: [],
  _prevCount: 0
};

const _muzzleColor = new THREE.Color();

function ensureMuzzleInstances() {
  if (muzzleInstances.outer || !Core3D.isInitialized || !Core3D.scene) return;
  ensureWeaponResources();

  const makeMat = (opacity) => new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexColors: true
  });

  const outer = new THREE.InstancedMesh(WEP_RESOURCES.geos.planeUnit, makeMat(0.8), MUZZLE_MAX_INSTANCES);
  const core = new THREE.InstancedMesh(WEP_RESOURCES.geos.planeUnit, makeMat(1.0), MUZZLE_MAX_INSTANCES);
  for (const mesh of [outer, core]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
  }
  // Rdzeń nad poświatą, oba nad pociskami (te siedzą na 78–81).
  outer.renderOrder = 82;
  core.renderOrder = 83;

  muzzleInstances.outer = outer;
  muzzleInstances.core = core;
  Core3D.scene.add(outer);
  Core3D.scene.add(core);
}

function spawnMuzzleFlash(x, y, angle, scale, colorHex) {
  ensureMuzzleInstances();
  if (!muzzleInstances.outer) return;
  if (muzzleInstances.active.length >= MUZZLE_MAX_INSTANCES) {
    // Pełna pula: nadpisujemy najstarszy błysk zamiast rosnąć w nieskończoność.
    let oldest = 0;
    for (let i = 1; i < muzzleInstances.active.length; i++) {
      if (muzzleInstances.active[i].life < muzzleInstances.active[oldest].life) oldest = i;
    }
    const reuse = muzzleInstances.active[oldest];
    reuse.x = x; reuse.y = y; reuse.angle = angle;
    reuse.size = MUZZLE_BASE_SIZE * (Number(scale) || 1);
    reuse.life = 1;
    _muzzleColor.set(colorHex || '#ffffff');
    reuse.r = _muzzleColor.r; reuse.g = _muzzleColor.g; reuse.b = _muzzleColor.b;
    return;
  }
  const flash = muzzleInstances.pool.pop() || { x: 0, y: 0, angle: 0, size: 1, life: 0, r: 1, g: 1, b: 1 };
  flash.x = x;
  flash.y = y;
  flash.angle = angle;
  flash.size = MUZZLE_BASE_SIZE * (Number(scale) || 1);
  flash.life = 1;
  _muzzleColor.set(colorHex || '#ffffff');
  flash.r = _muzzleColor.r;
  flash.g = _muzzleColor.g;
  flash.b = _muzzleColor.b;
  muzzleInstances.active.push(flash);
}

const _muzzleMatrix = new THREE.Matrix4();

function updateMuzzleFlashes(dt) {
  const outer = muzzleInstances.outer;
  const core = muzzleInstances.core;
  if (!outer || !core) return;

  const active = muzzleInstances.active;
  const elements = _muzzleMatrix.elements;
  let count = 0;

  for (let i = active.length - 1; i >= 0; i--) {
    const f = active[i];
    f.life -= f.life * MUZZLE_DECAY * dt;
    if (f.life <= 0.03) {
      const last = active.pop();
      if (i < active.length) active[i] = last;
      muzzleInstances.pool.push(f);
      continue;
    }

    // Ta sama krzywa co przed przenosinami: płomień rozdmuchuje się
    // z 0.85 do ~1.95 rozmiaru bazowego i gaśnie.
    const grow = 0.85 + f.life * 1.1;
    // Scena Three ma odwrócony Y względem świata gry, więc kąt też idzie na
    // minus — tak samo jak w macierzach pocisków (atan2(-segY, segX)).
    const cA = Math.cos(-f.angle);
    const sA = Math.sin(-f.angle);
    const wx = f.x;
    const wy = -f.y;

    const so = f.size * grow;
    elements[0] = cA * so; elements[4] = -sA * so; elements[8] = 0; elements[12] = wx;
    elements[1] = sA * so; elements[5] = cA * so;  elements[9] = 0; elements[13] = wy;
    elements[2] = 0;       elements[6] = 0;        elements[10] = 1; elements[14] = 15.0;
    elements[3] = 0;       elements[7] = 0;        elements[11] = 0; elements[15] = 1;
    outer.setMatrixAt(count, _muzzleMatrix);
    const fadeOuter = MUZZLE_HDR.outer * (0.35 + f.life * 0.65);
    outer.setColorAt(count, _muzzleColor.setRGB(f.r * fadeOuter, f.g * fadeOuter, f.b * fadeOuter));

    const sc = so * 0.45;
    elements[0] = cA * sc; elements[4] = -sA * sc; elements[12] = wx;
    elements[1] = sA * sc; elements[5] = cA * sc;  elements[13] = wy;
    elements[14] = 15.01;
    core.setMatrixAt(count, _muzzleMatrix);
    const fadeCore = MUZZLE_HDR.inner * (0.35 + f.life * 0.65);
    core.setColorAt(count, _muzzleColor.setRGB(fadeCore, fadeCore, fadeCore));

    count++;
    if (count >= MUZZLE_MAX_INSTANCES) break;
  }

  outer.count = count;
  core.count = count;
  outer.visible = count > 0;
  core.visible = count > 0;
  uploadInstancePrefix(outer.instanceMatrix, count, 16);
  uploadInstancePrefix(core.instanceMatrix, count, 16);
  uploadInstancePrefix(outer.instanceColor, count, 3);
  uploadInstancePrefix(core.instanceColor, count, 3);
  muzzleInstances._prevCount = count;
  // Dwa InstancedMeshe na calą scenę, niezależnie od liczby strzelających wież.
  DrawCallStats.addWeapon(count > 0 ? 2 : 0);
}

function resolveBulletVisualStyle(bullet) {
  // Opt-out for canvas-only weapons (e.g. osa_micro_missile). Returning null causes
  // the render loop at line 2273 to set __renderedByThree=false → canvas path renders it.
  if (bullet?.forceCanvas) return null;
  if (bullet.__cachedStyle) return bullet.__cachedStyle;
  const key = String(bullet?.vfxKey || bullet?.weaponId || bullet?.weaponName || bullet?.type || '').toLowerCase();
  let result;

  if (key.includes('special_goliath')) result = WEP_RESOURCES.bulletStyles.goliath;
  else if (key.includes('special_plasma')) result = WEP_RESOURCES.bulletStyles.plasmaGatling;
  else if (key.includes('special_valkyrie')) result = WEP_RESOURCES.bulletStyles.tempest;
  else if (key.includes('yamato')) result = WEP_RESOURCES.bulletStyles.yamato;
  else if (key.includes('hexlance')) result = WEP_RESOURCES.bulletStyles.hexlance;
  else if (key.includes('siege_railgun')) result = WEP_RESOURCES.bulletStyles.siegeRail;
  else if (key.includes('vulcan')) result = WEP_RESOURCES.bulletStyles.vulcan;
  else if (key.includes('helios')) result = WEP_RESOURCES.bulletStyles.helios;
  else if (key.includes('tempest') || key.includes('rail')) result = WEP_RESOURCES.bulletStyles.tempest;
  else if (key.includes('laser_pd')) result = WEP_RESOURCES.bulletStyles.laserPD;
  else if (key.includes('flak')) result = WEP_RESOURCES.bulletStyles.flak;
  else if (key.includes('ciws') || key.includes('pd')) result = WEP_RESOURCES.bulletStyles.ciws;
  else if (key.includes('heavy_auto')) result = WEP_RESOURCES.bulletStyles.autocannon;
  else if (key.includes('auto') || key.includes('gatling')) result = WEP_RESOURCES.bulletStyles.autocannon;
  else if (key.includes('armata')) result = WEP_RESOURCES.bulletStyles.armata;
  else if (key.includes('plasma')) result = WEP_RESOURCES.bulletStyles.plasma;
  else if (key.includes('rocket') || key.includes('missile') || key.includes('aim-') || key.includes('asm')) result = WEP_RESOURCES.bulletStyles.rocket;
  else if (key.includes('torpedo')) result = WEP_RESOURCES.bulletStyles.torpedo;
  else if (key.includes('siege')) result = WEP_RESOURCES.bulletStyles.siegeRail;
  else result = WEP_RESOURCES.bulletStyles.default;

  bullet.__cachedStyle = result;
  return result;
}

function resetBulletInstanceCounts() {
  if (bulletInstances.trails) bulletInstances.trails.count = 0;
  if (bulletInstances.cores) bulletInstances.cores.count = 0;
  if (bulletInstances.heads) bulletInstances.heads.count = 0;
  if (bulletInstances.arcs) bulletInstances.arcs.count = 0;
}

function ensureBeamFxMaterials() {
  if (WEP_RESOURCES.beamFxMats) return WEP_RESOURCES.beamFxMats;
  WEP_RESOURCES.beamFxMats = {
    core: new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false
    }),
    glow: new THREE.MeshBasicMaterial({
      color: 0x7defff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false
    }),
    spiral: new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      vertexColors: true
    })
  };
  return WEP_RESOURCES.beamFxMats;
}

function createPulseBeamVisual() {
  if (!Core3D.isInitialized || !Core3D.scene) return null;
  ensureWeaponResources();
  const mats = ensureBeamFxMaterials();
  const core = new THREE.Mesh(WEP_RESOURCES.geos.planeUnit, mats.core.clone());
  const glow = new THREE.Mesh(WEP_RESOURCES.geos.planeUnit, mats.glow.clone());
  core.renderOrder = 58;
  glow.renderOrder = 57;
  core.frustumCulled = false;
  glow.frustumCulled = false;
  const group = new THREE.Group();
  group.add(glow, core);
  group.visible = false;
  group.frustumCulled = false;
  Core3D.scene.add(group);
  return {
    group,
    core,
    glow,
    life: 0,
    maxLife: 0,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    width: 4
  };
}

function createContinuousBeamVisual() {
  if (!Core3D.isInitialized || !Core3D.scene) return null;
  ensureWeaponResources();
  const mats = ensureBeamFxMaterials();
  const group = new THREE.Group();
  group.visible = false;
  group.frustumCulled = false;

  const glow = new THREE.Mesh(WEP_RESOURCES.geos.planeUnit, mats.glow.clone());
  const core = new THREE.Mesh(WEP_RESOURCES.geos.planeUnit, mats.core.clone());
  glow.renderOrder = 56;
  core.renderOrder = 57;
  glow.frustumCulled = false;
  core.frustumCulled = false;
  group.add(glow, core);

  const bodyPlanes = [];
  const bodyOffsets = [-0.8, 0.8];
  for (let i = 0; i < bodyOffsets.length; i++) {
    const body = new THREE.Mesh(WEP_RESOURCES.geos.planeUnit, mats.glow.clone());
    body.renderOrder = 55;
    body.frustumCulled = false;
    body.userData.offset = bodyOffsets[i];
    body.userData.widthMul = 1.15 + Math.abs(bodyOffsets[i]) * 0.42;
    body.userData.opacityMul = Math.max(0.15, 0.42 - Math.abs(bodyOffsets[i]) * 0.12);
    group.add(body);
    bodyPlanes.push(body);
  }

  let spiral = null;
  if (BEAM_ENABLE_SPIRAL) {
    spiral = new THREE.InstancedMesh(WEP_RESOURCES.geos.planeUnit, mats.spiral.clone(), BEAM_SPIRAL_SEGMENTS * 2);
    spiral.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    spiral.frustumCulled = false;
    spiral.renderOrder = 58;
    spiral.count = 0;

    const cA = new THREE.Color(0xffffff).multiplyScalar(BEAM_HDR.spiral);
    const cB = new THREE.Color(0xaaffff).multiplyScalar(BEAM_HDR.spiral);
    for (let i = 0; i < BEAM_SPIRAL_SEGMENTS * 2; i++) {
      spiral.setColorAt(i, i < BEAM_SPIRAL_SEGMENTS ? cA : cB);
    }
    if (spiral.instanceColor) spiral.instanceColor.needsUpdate = true;
    group.add(spiral);
  }

  let impactLight = null;
  if (BEAM_ENABLE_IMPACT_LIGHT) {
    impactLight = new THREE.PointLight(0x7defff, 0, 220, 2.0);
    impactLight.visible = false;
    impactLight.position.set(0, 0, 14.35);
    group.add(impactLight);
  }

  Core3D.scene.add(group);
  return {
    group,
    core,
    glow,
    bodyPlanes,
    spiral,
    impactLight,
    active: false,
    charge: 0,
    lastEventTime: -999,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    targetStartX: 0,
    targetStartY: 0,
    targetEndX: 0,
    targetEndY: 0,
    width: 5,
    targetWidth: 5,
    turretUid: null,
    turretKey: null,
    dummy: new THREE.Object3D()
  };
}

function updatePulseBeamVisual(data, dt) {
  if (!data || !data.group) return false;
  data.life -= dt;
  if (data.life <= 0) {
    data.group.visible = false;
    return false;
  }
  const t = Math.max(0, data.life / Math.max(data.maxLife, 0.0001));
  const dx = data.endX - data.startX;
  const dy = data.endY - data.startY;
  const dist = Math.hypot(dx, dy);
  const angle = Math.atan2(-dy, dx || 1e-6);
  const mx = (data.startX + data.endX) * 0.5;
  const my = (data.startY + data.endY) * 0.5;
  const width = data.width * (0.45 + t * 0.75);
  data.group.visible = true;
  data.glow.position.set(mx, -my, 14.1);
  data.glow.rotation.set(0, 0, angle);
  data.glow.scale.set(dist, width * 1.6, 1);
  data.core.position.set(mx, -my, 14.2);
  data.core.rotation.set(0, 0, angle);
  data.core.scale.set(dist, width * 0.55, 1);
  data.glow.material.opacity = 0.45 * t;
  data.core.material.opacity = 0.95 * t;
  return true;
}

function updateContinuousBeamVisual(data, dt, timeSec) {
  if (!data || !data.group || !data.core || !data.glow) return;
  const hasRecentEvent = (timeSec - data.lastEventTime) <= 0.18;
  if (hasRecentEvent) {
    data.charge = Math.min(1, data.charge + dt * 8.0);
  } else {
    data.charge = Math.max(0, data.charge - dt * 3.2);
  }
  if (data.charge <= 0.001) {
    data.group.visible = false;
    if (data.impactLight) data.impactLight.visible = false;
    if (data.spiral && data.spiral.count !== 0) {
      data.spiral.count = 0;
      data.spiral.instanceMatrix.needsUpdate = true;
    }
    return;
  }

  if (!Number.isFinite(data.startX)) data.startX = data.targetStartX;
  if (!Number.isFinite(data.startY)) data.startY = data.targetStartY;
  if (!Number.isFinite(data.endX)) data.endX = data.targetEndX;
  if (!Number.isFinite(data.endY)) data.endY = data.targetEndY;
  if (!Number.isFinite(data.width)) data.width = data.targetWidth;

  const dxStart = data.targetStartX - data.startX;
  const dyStart = data.targetStartY - data.startY;
  const dxEnd = data.targetEndX - data.endX;
  const dyEnd = data.targetEndY - data.endY;
  const jumpSq = Math.max(dxStart * dxStart + dyStart * dyStart, dxEnd * dxEnd + dyEnd * dyEnd);

  if (jumpSq > 600 * 600) {
    data.startX = data.targetStartX;
    data.startY = data.targetStartY;
    data.endX = data.targetEndX;
    data.endY = data.targetEndY;
  } else {
    data.startX = data.targetStartX;
    data.startY = data.targetStartY;
    const followEnd = Math.min(1, dt * (hasRecentEvent ? 30.0 : 16.0));
    data.endX += dxEnd * followEnd;
    data.endY += dyEnd * followEnd;
  }

  data.width += (data.targetWidth - data.width) * Math.min(1, dt * 14.0);

  const dx = data.endX - data.startX;
  const dy = data.endY - data.startY;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-3) {
    data.group.visible = false;
    if (data.impactLight) data.impactLight.visible = false;
    return;
  }
  const invDist = 1 / dist;
  const dirX = dx * invDist;
  const dirY = dy * invDist;
  const perpX = -dirY;
  const perpY = dirX;
  const angle = Math.atan2(-dy, dx || 1e-6);
  const mx = (data.startX + data.endX) * 0.5;
  const my = (data.startY + data.endY) * 0.5;
  const currentScale = 0.3 + 0.7 * Math.sqrt(data.charge);
  const beamWidth = data.width * currentScale;

  data.group.visible = true;
  data.glow.position.set(mx, -my, 14.1);
  data.glow.rotation.set(0, 0, angle);
  data.glow.scale.set(dist, beamWidth * 2.8, 1);
  data.core.position.set(mx, -my, 14.2);
  data.core.rotation.set(0, 0, angle);
  data.core.scale.set(dist, beamWidth * 0.95, 1);
  data.glow.material.opacity = 0.45 + data.charge * 0.4;
  data.core.material.opacity = 0.82 + data.charge * 0.16;

  const bodyOpacity = 0.18 + data.charge * 0.22;
  if (Array.isArray(data.bodyPlanes)) {
    for (let i = 0; i < data.bodyPlanes.length; i++) {
      const body = data.bodyPlanes[i];
      if (!body) continue;
      const offsetMul = Number(body.userData?.offset) || 0;
      const offset = offsetMul * beamWidth * 0.6;
      body.position.set(mx + perpX * offset, -(my + perpY * offset), 14.05);
      body.rotation.set(0, 0, angle);
      body.scale.set(dist, beamWidth * (Number(body.userData?.widthMul) || 1.4), 1);
      body.material.opacity = bodyOpacity * (Number(body.userData?.opacityMul) || 1);
    }
  }

  if (data.impactLight) {
    data.impactLight.visible = true;
    data.impactLight.position.set(data.endX, -data.endY, 14.35);
    data.impactLight.intensity = 0.12 + data.charge * 0.95;
    data.impactLight.distance = 100 + Math.min(220, dist * 0.12);
  }

  if (data.spiral) {
    let idx = 0;
    const matrixElements = data.dummy.matrix.elements;

    for (let j = 0; j < 2; j++) {
      const turns = j === 0 ? (dist / 150) : -(dist / 200);
      const baseRadius = (j === 0 ? 14.0 : 18.0) * currentScale;
      const spiralSpeed = j === 0 ? 15 : -10;
      const zPos = 14.28 + j * 0.01;

      for (let i = 0; i < BEAM_SPIRAL_SEGMENTS; i++) {
        const t1 = i / BEAM_SPIRAL_SEGMENTS;
        const t2 = (i + 1) / BEAM_SPIRAL_SEGMENTS;

        const n1 = Math.sin(t1 * 20 + timeSec * 8) * 2.0 + Math.cos(t1 * 35 - timeSec * 5) * 1.5;
        const r1 = Math.max(0.1, baseRadius + n1) * currentScale;
        const a1 = t1 * Math.PI * 2 * turns + timeSec * spiralSpeed;

        const n2 = Math.sin(t2 * 20 + timeSec * 8) * 2.0 + Math.cos(t2 * 35 - timeSec * 5) * 1.5;
        const r2 = Math.max(0.1, baseRadius + n2) * currentScale;
        const a2 = t2 * Math.PI * 2 * turns + timeSec * spiralSpeed;

        const x1 = data.startX + dirX * (t1 * dist) + perpX * (Math.cos(a1) * r1);
        const y1 = data.startY + dirY * (t1 * dist) + perpY * (Math.cos(a1) * r1);
        const x2 = data.startX + dirX * (t2 * dist) + perpX * (Math.cos(a2) * r2);
        const y2 = data.startY + dirY * (t2 * dist) + perpY * (Math.cos(a2) * r2);

        const segDx = x2 - x1;
        const segDy = y2 - y1;
        const segDist = Math.hypot(segDx, segDy);
        const segAngle = Math.atan2(-segDy, segDx || 1e-6);

        let endTaper = 1.0;
        if (t1 < 0.05) endTaper = t1 / 0.05;
        if (t1 > 0.95) endTaper = (1.0 - t1) / 0.05;
        const baseThick = j === 0 ? 4.0 : 2.5;
        const thickness = Math.max(0.05, (baseThick + Math.sin(t1 * 30 - timeSec * 10) * 1.0) * currentScale * endTaper);

        const c = Math.cos(segAngle);
        const s = Math.sin(segAngle);
        const sx = segDist * 1.05;
        const sy = thickness;

        matrixElements[0] = c * sx;
        matrixElements[1] = s * sx;
        matrixElements[2] = 0;
        matrixElements[3] = 0;

        matrixElements[4] = -s * sy;
        matrixElements[5] = c * sy;
        matrixElements[6] = 0;
        matrixElements[7] = 0;

        matrixElements[8] = 0;
        matrixElements[9] = 0;
        matrixElements[10] = 1;
        matrixElements[11] = 0;

        matrixElements[12] = (x1 + x2) * 0.5;
        matrixElements[13] = -(y1 + y2) * 0.5;
        matrixElements[14] = zPos;
        matrixElements[15] = 1;

        data.spiral.setMatrixAt(idx++, data.dummy.matrix);
      }
    }
    data.spiral.count = idx;
    data.spiral.instanceMatrix.needsUpdate = true;
  }
}

export const Weapon3DSystem = {
  _preloaded: false,
  _lastFxTimeSec: 0,
  _cameraShakeMag: 0,
  _shotListenerBound: false,
  _shotListener: null,
  _shotBusListener: null,
  _tmpProjectileColor: new THREE.Color(),
  _tmpBeamColor: new THREE.Color(),
  _pulseBeamPool: [],
  _pulseBeamActive: [],
  _continuousBeamPool: [],
  _continuousBeamActive: [],

  // Zmusza Three.js do skompilowania shaderów przed rozpoczęciem walki
  _preloadShaders() {
    if (this._preloaded || !Core3D.isInitialized || !Core3D.scene || !Core3D.renderer) return;
    this._preloaded = true;
    
    this._ensureBeamVisuals();
    ensureBulletInstances();
    ensureMuzzleInstances();

    const tempVisible = [];
    
    const prewarmContinuous = 12;
    const prewarmPulse = 6;

    // Alokujemy pulę wiązek na loadingu, aby uniknąć alokacji w pierwszych sekundach walki.
    for(let i=0; i<prewarmContinuous; i++) {
       const cb = createContinuousBeamVisual();
        if (cb) {
            if (i < 2) {
              cb.group.visible = true;
              tempVisible.push(cb.group);
            } else {
              cb.group.visible = false;
            }
            this._continuousBeamPool.push(cb);
        }
    }
    for(let i=0; i<prewarmPulse; i++) {
       const pb = createPulseBeamVisual();
        if (pb) {
            if (i < 2) {
              pb.group.visible = true;
              tempVisible.push(pb.group);
            } else {
              pb.group.visible = false;
            }
            this._pulseBeamPool.push(pb);
        }
    }   
    
    if (Core3D.camera) {
       Core3D.renderer.compile(Core3D.scene, Core3D.camera);
    }
    
    // Ukrywamy po kompilacji
    for(const group of tempVisible) {
        group.visible = false;
    }
  },

  _ensureBeamVisuals() {
    if (!Core3D.isInitialized || !Core3D.scene) return;
    ensureWeaponResources();
  },

  _acquirePulseBeam() {
    if (!Core3D.isInitialized || !Core3D.scene) return null;
    let data = this._pulseBeamPool.pop();
    if (!data && this._pulseBeamActive.length >= MAX_PULSE_BEAM_VISUALS) {
      // Pula pełna: przejmij najstarszą aktywną (najmniej życia). Zostaje na
      // liście aktywnych — wołający nadpisze jej pozycję i życie.
      const active = this._pulseBeamActive;
      let oldest = active[0] || null;
      for (let i = 1; i < active.length; i++) {
        if (active[i].life < oldest.life) oldest = active[i];
      }
      if (oldest) oldest.group.visible = true;
      return oldest;
    }
    if (!data) data = createPulseBeamVisual();
    if (!data) return null;
    data.group.visible = true;
    this._pulseBeamActive.push(data);
    return data;
  },

  _acquireContinuousBeam() {
    if (!Core3D.isInitialized || !Core3D.scene) return null;
    let data = this._continuousBeamPool.pop();
    if (!data) data = createContinuousBeamVisual();
    if (!data) return null;
    data.group.visible = true;
    this._continuousBeamActive.push(data);
    return data;
  },

  // Początek wiązki ciągłej trzyma się lufy, która ją wypuściła. Wieżyczki są
  // teraz rekordami 2D, więc pytamy o nie Turret2D zamiast chodzić po grafie
  // sceny. Klucz jest stabilny między klatkami, dopóki wieżyczka jest widoczna.
  _resolveBeamMuzzleFromTurretKey(turretKey) {
    if (!turretKey) return null;
    return Turret2D.resolveMuzzle(turretKey);
  },

  _triggerBeamFx(detail) {
    const beam = detail?.beam;
    if (!beam) return;
    const sx = Number(beam.startX);
    const sy = Number(beam.startY);
    const ex = Number(beam.endX);
    const ey = Number(beam.endY);
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) return;
    const mode = String(detail?.beamMode || beam.mode || '').toLowerCase();
    const colorHex = detail?.weaponId === 'beam_pulse' ? '#ff003c' : '#00ffcc';
    const emitterUid = (beam?.emitterUid ?? detail?.emitterUid) != null
      ? String(beam.emitterUid ?? detail.emitterUid)
      : null;

    this._ensureBeamVisuals();
    if (mode === 'continuous') {
      const now = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
      
      let c = null;
      if (emitterUid) {
        for (let i = 0; i < this._continuousBeamActive.length; i++) {
          if (this._continuousBeamActive[i].turretUid === emitterUid) {
            c = this._continuousBeamActive[i];
            break;
          }
        }
      }

      if (!c && !emitterUid) {
        let bestDistSq = Infinity;
        const matchDistSq = 95 * 95;
        const simultaneousWindow = 0.016;
        for (let i = 0; i < this._continuousBeamActive.length; i++) {
          const candidate = this._continuousBeamActive[i];
          if (!candidate) continue;
          if ((now - candidate.lastEventTime) < simultaneousWindow) continue;
          if ((now - candidate.lastEventTime) > 0.35) continue;

          const sdx = sx - candidate.targetStartX;
          const sdy = sy - candidate.targetStartY;
          const distSq = sdx * sdx + sdy * sdy;
          if (distSq < matchDistSq && distSq < bestDistSq) {
            bestDistSq = distSq;
            c = candidate;
          }
        }
      }

      if (!c && !emitterUid && this._continuousBeamActive.length >= MAX_CONTINUOUS_BEAM_VISUALS) {
        let oldestIdx = 0;
        let oldestTime = this._continuousBeamActive[0]?.lastEventTime ?? Infinity;
        for (let i = 1; i < this._continuousBeamActive.length; i++) {
          const t = this._continuousBeamActive[i]?.lastEventTime ?? Infinity;
          if (t < oldestTime) {
            oldestTime = t;
            oldestIdx = i;
          }
        }
        c = this._continuousBeamActive[oldestIdx] || null;
      }

      if (!c) {
        c = this._acquireContinuousBeam();
        if (!c) return;
      }
      c.turretUid = emitterUid;
      // Uchwyt do wieżyczki, z której wyszła wiązka — dzięki niemu początek
      // wiązki jedzie z lufą, gdy okręt się obraca albo przemieszcza.
      c.turretKey = Turret2D.findTurretKey(sx, sy, normalizeWeaponFxKey(detail?.weaponId), detail?.shooter || null);

      c.targetStartX = sx;
      c.targetStartY = sy;
      c.targetEndX = ex;
      c.targetEndY = ey;
      c.targetWidth = Math.max(2.5, Number(beam.width) || 5);
      if (!c.active) {
        c.startX = c.targetStartX;
        c.startY = c.targetStartY;
        c.endX = c.targetEndX;
        c.endY = c.targetEndY;
        c.width = c.targetWidth;
      }
      c.lastEventTime = now;
      c.active = true;
      const color = this._tmpBeamColor.set(colorHex);
      c.glow.material.color.copy(color).multiplyScalar(BEAM_HDR.glow);
      c.core.material.color.set(0xffffff).multiplyScalar(BEAM_HDR.core);
      if (Array.isArray(c.bodyPlanes)) {
        for (let i = 0; i < c.bodyPlanes.length; i++) {
          const body = c.bodyPlanes[i];
          if (!body?.material?.color) continue;
          body.material.color.copy(color).multiplyScalar(BEAM_HDR.glow);
        }
      }
      // Światło punktowe zostaje na LDR — HDR na kolorze światła mnożyłby
      // intensywność, a bloomem steruje sam materiał beamu.
      if (c.impactLight?.color) c.impactLight.color.copy(color);
      return;
    }

    const pulse = this._acquirePulseBeam();
    if (!pulse) return;
    pulse.startX = sx;
    pulse.startY = sy;
    pulse.endX = ex;
    pulse.endY = ey;
    pulse.maxLife = 0.15;
    pulse.life = pulse.maxLife;
    pulse.width = Math.max(2.4, Number(beam.width) || 5);
    pulse.core.material.color.set(0xffffff).multiplyScalar(BEAM_HDR.core);
    pulse.glow.material.color.set(colorHex).multiplyScalar(BEAM_HDR.glow);
  },

  _updateBeamFx(dt, timeSec) {
    if (dt <= 0) return;
    for (let i = this._pulseBeamActive.length - 1; i >= 0; i--) {
      const item = this._pulseBeamActive[i];
      const alive = updatePulseBeamVisual(item, dt);
      if (alive) continue;
      this._pulseBeamActive[i] = this._pulseBeamActive[this._pulseBeamActive.length - 1];
      this._pulseBeamActive.pop();
      this._pulseBeamPool.push(item);
    }
    for (let i = this._continuousBeamActive.length - 1; i >= 0; i--) {
      const beam = this._continuousBeamActive[i];
      const prevTargetStartX = beam.targetStartX;
      const prevTargetStartY = beam.targetStartY;
      const muzzle = this._resolveBeamMuzzleFromTurretKey(beam.turretKey);
      if (muzzle) {
        beam.targetStartX = muzzle.x;
        beam.targetStartY = muzzle.y;
        const sinceEvent = timeSec - beam.lastEventTime;
        if (sinceEvent > 0.001 && sinceEvent < 0.18) {
          const shiftX = beam.targetStartX - prevTargetStartX;
          const shiftY = beam.targetStartY - prevTargetStartY;
          beam.targetEndX += shiftX;
          beam.targetEndY += shiftY;
        }
      }
      updateContinuousBeamVisual(beam, dt, timeSec);
      const stale = (timeSec - beam.lastEventTime) > 0.55;
      if (!stale || beam.charge > 0.002) continue;
      beam.group.visible = false;
      if (beam.impactLight) beam.impactLight.visible = false;
      beam.active = false;
      beam.turretUid = null;
      beam.turretKey = null;
      this._continuousBeamActive[i] = this._continuousBeamActive[this._continuousBeamActive.length - 1];
      this._continuousBeamActive.pop();
      this._continuousBeamPool.push(beam);
    }
  },

  // Strzały z fireWeaponCore przychodzą szyną (src/game/weaponShotBus.js): jeden
  // obiekt detail wielokrotnego użytku, bez zdarzenia DOM per strzał. Rzadki
  // strzał superbroni nadal idzie przez CustomEvent('game_weapon_fired') — oba
  // źródła trafiają do tej samej obsługi. `detail` czytamy tylko synchronicznie
  // (liczby i klucze kopiujemy do własnych wizuali).
  _handleShotDetail(detail) {
    if (!detail) return;
    const weaponKey = normalizeWeaponFxKey(detail.weaponId);
    const shotX = Number(detail.x);
    const shotY = Number(detail.y);
    if (!weaponKey || !Number.isFinite(shotX) || !Number.isFinite(shotY)) return;
    const isBeam = detail?.isBeam === true;
    const beamMode = String(detail?.beamMode || detail?.beam?.mode || '').toLowerCase();
    const isContinuousBeam = isBeam && beamMode === 'continuous';
    if (!isContinuousBeam) {
      this._triggerShotByWorldPoint(weaponKey, shotX, shotY, detail.shooter || null);
    }
    if (isBeam && detail?.beam) this._triggerBeamFx(detail);
  },

  _ensureShotListener() {
    if (typeof window === 'undefined' || this._shotListenerBound) return;
    this._shotListener = (event) => this._handleShotDetail(event?.detail);
    this._shotBusListener = (detail) => this._handleShotDetail(detail);
    window.addEventListener('game_weapon_fired', this._shotListener);
    WeaponShotBus.on(this._shotBusListener);
    this._shotListenerBound = true;
  },

  // Wystrzał: Turret2D wskazuje lufę (i dostaje odrzut), my dokładamy płomień
  // i wstrząs kamery. Gdy żadna wieżyczka nie jest widoczna (kamera daleko,
  // CIC otwarty), błysk po prostu nie powstaje — tak jak wcześniej przy LOD.
  // Lufy szukamy tylko na kadłubie strzelca: strzał myśliwca (bez wieżyczek)
  // nie zapala już cudzego CIWS-a i nie trzęsie kamerą.
  _triggerShotByWorldPoint(weaponKey, shotX, shotY, shooter = null) {
    const shot = Turret2D.triggerShot(weaponKey, shotX, shotY, shooter);
    if (!shot) return;
    // Armata, Yamato i Tempest Ion mają własne recepty z dema
    // (src/3d/muzzleFx3D.js). Gdy taka zadżiała, tani błysk
    // instancjonowany jest zbędny — siedziałby w środku
    // rozbłysku jako druga, jaśniejsza plama.
    const rich = MuzzleFX3D.fire(weaponKey, shot.x, shot.y, shot.angle, shot.scale);
    if (!rich) spawnMuzzleFlash(shot.x, shot.y, shot.angle, shot.scale, shot.color);
    this._cameraShakeMag = Math.min(18, this._cameraShakeMag + (Number(shot.shake) || 0));
  },

  _updateWeaponFx(dt) {
    updateMuzzleFlashes(dt);
  },

  _updateCameraShake(dt) {
    if (typeof window === 'undefined') return;
    const out = window.__weapon3dCameraShake || (window.__weapon3dCameraShake = { x: 0, y: 0 });
    this._cameraShakeMag *= Math.exp(-8.0 * dt);
    if (this._cameraShakeMag < 0.01) this._cameraShakeMag = 0;
    if (this._cameraShakeMag <= 0) {
      out.x = 0;
      out.y = 0;
      return;
    }
    out.x = (Math.random() - 0.5) * this._cameraShakeMag;
    out.y = (Math.random() - 0.5) * this._cameraShakeMag;
  },

  prewarmShaders() {
    if (!Core3D.isInitialized || !Core3D.scene || !Core3D.renderer) return false;
    this._preloadShaders();
    return this._preloaded;
  },

  syncProjectiles(bullets = []) {
    if (!Core3D.isInitialized || !Core3D.scene) return;
    ensureWeaponResources();
    ensureBulletInstances();
    if (!bulletInstances.trails || !bulletInstances.cores || !bulletInstances.heads || !bulletInstances.arcs) return;
    this._ensureShotListener();

    const timeSec = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
    const dt = this._lastFxTimeSec > 0 ? Math.max(0.001, Math.min(0.05, timeSec - this._lastFxTimeSec)) : (1 / 60);
    this._lastFxTimeSec = timeSec;

    this._updateWeaponFx(dt);
    this._updateBeamFx(dt, timeSec);
    this._updateCameraShake(dt);
    // Wspólny bank cząstek (błyski wylotowe + Hexlance) rusza
    // DOKŁADNIE RAZ na klatkę renderu — stąd tutaj, a nie
    // w każdym module efektu z osobna.
    Fx3D.update(dt);
    MuzzleFX3D.beginFrame();
    BulletTrails.beginFrame();

    let instanceCount = 0;
    let arcInstanceCount = 0;
    const dummy = bulletInstances.dummy;
    const matrixElements = dummy.matrix.elements;
    
    const setMatrix = (x, y, z, rot, scaleX, scaleY) => {
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        matrixElements[0] = c * scaleX; matrixElements[4] = -s * scaleY; matrixElements[8] = 0; matrixElements[12] = x;
        matrixElements[1] = s * scaleX; matrixElements[5] = c * scaleY;  matrixElements[9] = 0; matrixElements[13] = y;
        matrixElements[2] = 0;          matrixElements[6] = 0;           matrixElements[10] = 1; matrixElements[14] = z;
        matrixElements[3] = 0;          matrixElements[7] = 0;           matrixElements[11] = 0; matrixElements[15] = 1;
    };

    for (const bullet of bullets) {
      if (!bullet || bullet.life <= 0) continue;
      if (!isFiniteNumber(bullet.x) || !isFiniteNumber(bullet.y)) continue;
      if (instanceCount >= BULLET_MAX_INSTANCES) break;

      const style = resolveBulletVisualStyle(bullet);
      if (!style) {
        bullet.__renderedByThree = false;
        continue;
      }
      bullet.__renderedByThree = true;

      const x = Number(bullet.x) || 0;
      const y = Number(bullet.y) || 0;
      // Smuga świata dla wybranych stylów (Yamato). Musi iść stąd, bo tylko
      // tutaj w jednym miejscu jest i styl pocisku, i jego bieżąca pozycja.
      BulletTrails.track(bullet, style.key, x, y, Number(bullet.vx) || 0, Number(bullet.vy) || 0);
      const px = isFiniteNumber(bullet.px) ? Number(bullet.px) : (x - (Number(bullet.vx) || 0) * 0.016);
      const py = isFiniteNumber(bullet.py) ? Number(bullet.py) : (y - (Number(bullet.vy) || 0) * 0.016);

      const segX = x - px;
      const segY = y - py;
      const segLen = Math.hypot(segX, segY);
      const angle = Math.atan2(-segY, segX || 1e-6);

      const cx = (x + px) * 0.5;
      const cy = (y + py) * 0.5;
      // Ship-class tier scales projectile thickness (S smaller, L/Capital larger).
      // Resolved from the firing entity and cached per bullet.
      let wScale = bullet.__wScale;
      if (wScale === undefined) {
        const tier = bullet.source ? getEntityWeaponTier(bullet.source) : 'Capital';
        wScale = (WEAPON_TIER_SCALE[tier] || WEAPON_TIER_SCALE.Capital).bullet;
        bullet.__wScale = wScale;
      }

      const minLen = style.minLen * wScale;
      const trailLen = Math.max(minLen, segLen * style.stretch);
      const coreLen = Math.max(minLen * 0.55, segLen * 0.7);

      const styleHdr = getBulletStyleHdr(style);
      setMatrix(cx, -cy, style.z, angle, trailLen, style.trailWidth * wScale);
      bulletInstances.trails.setMatrixAt(instanceCount, dummy.matrix);
      bulletInstances.trails.setColorAt(instanceCount, styleHdr.trail);

      setMatrix(x, -y, style.z + 0.01, angle, coreLen, style.coreWidth * wScale);
      bulletInstances.cores.setMatrixAt(instanceCount, dummy.matrix);
      bulletInstances.cores.setColorAt(instanceCount, styleHdr.core);

      // No round "head" blob — projectiles render as a clean straight line
      // (soft trail glow + bright core). The head instance buffer stays empty.

      if (style.ionArcs && arcInstanceCount + 1 < BULLET_MAX_INSTANCES * 2) {
        const pulse = 0.55 + Math.sin(timeSec * 36.0 + x * 0.02 + y * 0.01) * 0.25;
        const arcLen = (5.5 + pulse * 3.5) * wScale;
        const arcWidth = (0.6 + pulse * 0.8) * wScale;
        const jitterX = Math.sin(timeSec * 41.0 + x * 0.03) * 0.6;
        const jitterY = Math.cos(timeSec * 38.0 + y * 0.03) * 0.6;

        setMatrix(x + jitterX, -y + jitterY, style.z + 0.04, angle + Math.PI * 0.5, arcLen, arcWidth);
        bulletInstances.arcs.setMatrixAt(arcInstanceCount, dummy.matrix);
        bulletInstances.arcs.setColorAt(arcInstanceCount, BULLET_ARC_HDR_COLOR);
        arcInstanceCount++;

        setMatrix(x - jitterX, -y - jitterY, style.z + 0.04, angle - Math.PI * 0.5, arcLen * 0.75, arcWidth * 0.75);
        bulletInstances.arcs.setMatrixAt(arcInstanceCount, dummy.matrix);
        bulletInstances.arcs.setColorAt(arcInstanceCount, BULLET_ARC_HDR_COLOR);
        arcInstanceCount++;
      }

      instanceCount++;
    }

    // Po pętli: pociski, których już nie ma w tablicy, oddają swój emiter
    // smugi, a bufor GPU idzie na kartę. Historia gasnie dalej sama.
    BulletTrails.endFrame();

    bulletInstances.trails.count = instanceCount;
    bulletInstances.cores.count = instanceCount;
    bulletInstances.heads.count = 0; // head blob removed — clean-line projectiles
    bulletInstances.arcs.count = arcInstanceCount;
    // InstancedMesh z count = 0 nadal przechodzi setProgram i upload uniformów
    // (three pomija dopiero samo gl.draw*), więc puste pule po prostu chowamy.
    bulletInstances.trails.visible = instanceCount > 0;
    bulletInstances.cores.visible = instanceCount > 0;
    bulletInstances.heads.visible = false;
    bulletInstances.arcs.visible = arcInstanceCount > 0;

    uploadInstancePrefix(bulletInstances.trails.instanceMatrix, instanceCount, 16);
    uploadInstancePrefix(bulletInstances.cores.instanceMatrix, instanceCount, 16);
    uploadInstancePrefix(bulletInstances.trails.instanceColor, instanceCount, 3);
    uploadInstancePrefix(bulletInstances.cores.instanceColor, instanceCount, 3);
    uploadInstancePrefix(bulletInstances.arcs.instanceMatrix, arcInstanceCount, 16);
    uploadInstancePrefix(bulletInstances.arcs.instanceColor, arcInstanceCount, 3);
  },

  disposeAll() {
    if (muzzleInstances.outer) {
      muzzleInstances.active.length = 0;
      muzzleInstances.pool.length = 0;
      muzzleInstances.outer.count = 0;
      muzzleInstances.core.count = 0;
      muzzleInstances._prevCount = 0;
    }
    resetBulletInstanceCounts();
    if (bulletInstances.trails) bulletInstances.trails.instanceMatrix.needsUpdate = true;
    if (bulletInstances.cores) bulletInstances.cores.instanceMatrix.needsUpdate = true;
    if (bulletInstances.heads) bulletInstances.heads.instanceMatrix.needsUpdate = true;
    if (bulletInstances.arcs) bulletInstances.arcs.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this._pulseBeamActive.length; i++) {
      const p = this._pulseBeamActive[i];
      if (p?.group) p.group.visible = false;
      this._pulseBeamPool.push(p);
    }
    this._pulseBeamActive.length = 0;
    for (let i = 0; i < this._pulseBeamPool.length; i++) {
      const p = this._pulseBeamPool[i];
      if (p?.group?.parent) p.group.parent.remove(p.group);
    }
    this._pulseBeamPool.length = 0;

    for (let i = 0; i < this._continuousBeamActive.length; i++) {
      const b = this._continuousBeamActive[i];
      if (b?.group) b.group.visible = false;
      this._continuousBeamPool.push(b);
    }
    this._continuousBeamActive.length = 0;
    for (let i = 0; i < this._continuousBeamPool.length; i++) {
      const b = this._continuousBeamPool[i];
      if (b?.group?.parent) b.group.parent.remove(b.group);
    }
    this._continuousBeamPool.length = 0;

    this._lastFxTimeSec = 0;
    this._cameraShakeMag = 0;
    if (typeof window !== 'undefined' && window.__weapon3dCameraShake) {
      window.__weapon3dCameraShake.x = 0;
      window.__weapon3dCameraShake.y = 0;
    }
    if (typeof window !== 'undefined' && this._shotListenerBound && this._shotListener) {
      window.removeEventListener('game_weapon_fired', this._shotListener);
    }
    if (this._shotBusListener) WeaponShotBus.off(this._shotBusListener);
    this._shotListener = null;
    this._shotBusListener = null;
    this._shotListenerBound = false;
  }
};
