import * as THREE from 'three';
import { Core3D } from './core3d.js';

const WEP_RESOURCES = {
  mats: null,
  geos: null,
  bulletHeadTex: null,
  bulletStyles: null,
  flashMats: null,
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
const BEAM_ENABLE_SPIRAL = false;
const BEAM_ENABLE_IMPACT_LIGHT = false;

const WEAPON_FX_PROFILE = {
  vulcan_minigun: { key: 'vulcan', recoil: 3.0, shake: 2.0 },
  helios_laser: { key: 'helios', recoil: 6.0, shake: 3.0 },
  railgun_mk1: { key: 'tempest', recoil: 4.0, shake: 2.5 },
  railgun_mk2: { key: 'tempest', recoil: 4.0, shake: 2.5 },
  armata_mk1: { key: 'armata', recoil: 12.0, shake: 6.5 },
  beam_continuous: { key: 'beam', recoil: 1.0, shake: 1.5 },
  beam_pulse: { key: 'beam', recoil: 6.0, shake: 3.5 },
  special_goliath_autocannon: { key: 'goliath', recoil: 20.0, shake: 10.0 },
  special_plasma_gatling: { key: 'plasmaGatling', recoil: 15.0, shake: 8.0 },
  special_valkyrie_railgun: { key: 'tempest', recoil: 20.0, shake: 12.0 },
  special_yamato_cannon: { key: 'yamato', recoil: 60.0, shake: 20.0 },
  tempest_ion_mk1: { key: 'tempest', recoil: 4.0, shake: 2.5 },
  tempest_ion_mk2: { key: 'tempest', recoil: 4.0, shake: 2.5 },
  heavy_autocannon: { key: 'autocannon', recoil: 8.0, shake: 4.0 },
  ciws_mk1: { key: 'ciws', recoil: 1.5, shake: 1.0 },
  laser_pd_mk1: { key: 'laserPD', recoil: 0.5, shake: 0.3 },
  missile_rack: { key: 'rocket', recoil: 4.0, shake: 2.0 },
  fast_missile_rack: { key: 'rocket', recoil: 3.0, shake: 1.5 },
  siege_torpedo: { key: 'torpedo', recoil: 6.0, shake: 3.0 },
  siege_torpedo_mk2: { key: 'torpedo', recoil: 8.0, shake: 4.0 },
  torpedo_salvo: { key: 'torpedo', recoil: 5.0, shake: 2.5 },
  hexlance_siege: { key: 'hexlance', recoil: 30.0, shake: 15.0 },
  siege_railgun: { key: 'siegeRail', recoil: 120.0, shake: 80.0 },
};

const WEAPON_3D_SCALE_BY_SIZE = Object.freeze({
  Capital: 1.75,
  L: 1.02,
  M: 0.76,
  S: 0.52
});

const WEAPON_3D_CATEGORY_TRIM = Object.freeze({
  beam: 0.94,
  ciws: 0.88,
  rocket: 0.82,
  torpedo: 0.90,
  default: 1.0
});

function normalizeWeaponFxKey(weaponId) {
  const id = String(weaponId || '').toLowerCase();
  if (!id) return '';
  if (id.includes('vulcan')) return 'vulcan';
  if (id.includes('helios')) return 'helios';
  if (id.includes('tempest') || id === 'railgun_mk1' || id === 'railgun_mk2') return 'tempest';
  if (id.includes('armata') || id.includes('heavy_cannon')) return 'armata';
  if (id.includes('beam_continuous') || id.includes('beam_pulse')) return 'beam';
  if (id.includes('special_goliath')) return 'goliath';
  if (id.includes('special_plasma')) return 'plasmaGatling';
  if (id.includes('heavy_auto')) return 'autocannon';
  if (id.includes('ciws')) return 'ciws';
  if (id.includes('laser_pd')) return 'laserPD';
  if (id.includes('fast_missile_rack')) return 'rocket';
  if (id.includes('missile_rack')) return 'rocket';
  if (id.includes('siege_torpedo')) return 'torpedo';
  if (id.includes('torpedo_salvo')) return 'torpedo';
  if (id.includes('hexlance')) return 'hexlance';
  if (id.includes('siege_railgun')) return 'siegeRail';
  if (id.includes('special_valkyrie')) return 'tempest';
  if (id.includes('special_yamato')) return 'yamato';
  return id;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function shouldRenderWeapon3D(def) {
  if (!def) return false;
  const mountType = String(def.mountType || '').toLowerCase();
  if (mountType === 'hangar') return false;
  return true;
}

function getWeapon3DScale(size, category) {
  const base = WEAPON_3D_SCALE_BY_SIZE[String(size || '').trim()] || WEAPON_3D_SCALE_BY_SIZE.M;
  const trim = WEAPON_3D_CATEGORY_TRIM[String(category || '').toLowerCase()] || WEAPON_3D_CATEGORY_TRIM.default;
  return base * trim;
}

function getEntityWeaponLocalScale(entity) {
  const scaleXRaw = Number(entity?.__hardpointScaleX);
  const scaleYRaw = Number(entity?.__hardpointScaleY);
  const uniformRaw = Number(entity?.__hardpointScale);
  const scaleX = Number.isFinite(scaleXRaw) && scaleXRaw > 0 ? scaleXRaw : null;
  const scaleY = Number.isFinite(scaleYRaw) && scaleYRaw > 0 ? scaleYRaw : null;
  const uniform = Number.isFinite(uniformRaw) && uniformRaw > 0 ? uniformRaw : 1;
  return {
    x: scaleX ?? uniform,
    y: scaleY ?? uniform
  };
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

function ensureWeaponResources() {
  if (!WEP_RESOURCES.mats || !WEP_RESOURCES.geos || !WEP_RESOURCES.bulletStyles) {
    const makeGlowMaterial = (color, opacity = 0.98) => new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });

    WEP_RESOURCES.mats = {
      base: new THREE.MeshStandardMaterial({ color: 0x3a465b, roughness: 0.72, metalness: 0.62 }),
      barrel: new THREE.MeshStandardMaterial({ color: 0x5a6982, roughness: 0.42, metalness: 0.82 }),
      armor: new THREE.MeshStandardMaterial({ color: 0x647596, roughness: 0.48, metalness: 0.74 }),
      glowBlue: makeGlowMaterial(0x8ad9ff, 0.96),
      glowCyan: makeGlowMaterial(0x86f4ff, 0.98),
      glowRed: makeGlowMaterial(0xff7b93, 0.96),
      glowAmber: makeGlowMaterial(0xffd78f, 0.96),
    };

    WEP_RESOURCES.geos = {
      // Original shared
      railBase: new THREE.BoxGeometry(18, 22, 6),
      railBarrel: new THREE.BoxGeometry(38, 3, 3),
      railGlow: new THREE.BoxGeometry(28, 1, 1),
      armataBase: new THREE.BoxGeometry(20, 24, 8),
      armataBarrel: new THREE.BoxGeometry(28, 7, 7),
      autoBase: new THREE.CylinderGeometry(8, 8, 8, 16),
      autoBarrel: new THREE.BoxGeometry(22, 4, 4),
      ciwsBase: new THREE.BoxGeometry(10, 10, 5),
      ciwsBarrel: new THREE.BoxGeometry(14, 3, 3),
      defaultBase: new THREE.BoxGeometry(14, 18, 6),
      barrelTube: new THREE.CylinderGeometry(1.15, 1.15, 24, 8),
      planeUnit: new THREE.PlaneGeometry(1, 1),
      // Goliath — shared barrel + brake
      goliathBarrel: new THREE.CylinderGeometry(3.5, 4.5, 36, 10),
      goliathHousing: new THREE.BoxGeometry(30, 28, 18),
      // Plasma Gatling — shared barrel (no bulbs)
      plasmaBarrel: new THREE.CylinderGeometry(3, 3.5, 18, 8),
      plasmaHousing: new THREE.CylinderGeometry(14, 16, 14, 8),
      // Beam Emitter — dish + crystal
      beamDish: new THREE.CylinderGeometry(10, 10, 2, 12),
      beamHousing: new THREE.BoxGeometry(18, 20, 10),
      beamCrystal: new THREE.OctahedronGeometry(2.5, 0),
      // Heavy Autocannon
      heavyAutoHousing: new THREE.BoxGeometry(16, 14, 6),
      heavyAutoBarrel: new THREE.CylinderGeometry(2.5, 3.5, 28, 8),
      // CIWS — dome + single cluster barrel
      ciwsDome: new THREE.SphereGeometry(6, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      ciwsClusterBarrel: new THREE.CylinderGeometry(2.5, 2.5, 18, 8),
      // Laser PD — single glow lens
      laserPDLens: new THREE.CylinderGeometry(2.5, 2, 10, 8),
      // Missile Rack — housing + glow strip
      missileHousing: new THREE.BoxGeometry(20, 18, 14),
      missileGlowStrip: new THREE.BoxGeometry(16, 14, 2),
      // Siege Torpedo — housing + tube
      torpedoHousing: new THREE.BoxGeometry(24, 26, 16),
      torpedoTube: new THREE.CylinderGeometry(5, 5.5, 28, 10),
      // Hexlance — hex housing + core + glow + ring
      hexHousing: new THREE.CylinderGeometry(16, 18, 10, 6),
      hexCore: new THREE.CylinderGeometry(3, 3, 40, 6),
      hexCoreGlow: new THREE.CylinderGeometry(2, 2, 38, 6),
      hexFrontRing: new THREE.TorusGeometry(12, 1.5, 6, 6),
      // Siege Railgun — housing + rails + core
      siegeHousing: new THREE.BoxGeometry(28, 26, 18),
      siegeRailBar: new THREE.BoxGeometry(60, 4, 5),
      siegeCore: new THREE.CylinderGeometry(1.5, 1.5, 58, 8),
    };
    WEP_RESOURCES.geos.autoBase.rotateX(Math.PI / 2);
    WEP_RESOURCES.geos.barrelTube.rotateZ(Math.PI * 0.5);
    WEP_RESOURCES.geos.goliathBarrel.rotateZ(Math.PI * 0.5);
    WEP_RESOURCES.geos.plasmaBarrel.rotateZ(Math.PI * 0.5);
    WEP_RESOURCES.geos.plasmaHousing.rotateX(Math.PI / 2);
    WEP_RESOURCES.geos.beamDish.rotateZ(Math.PI * 0.5);
    WEP_RESOURCES.geos.heavyAutoBarrel.rotateZ(Math.PI * 0.5);
    WEP_RESOURCES.geos.ciwsClusterBarrel.rotateZ(Math.PI * 0.5);
    WEP_RESOURCES.geos.laserPDLens.rotateZ(Math.PI * 0.5);
    WEP_RESOURCES.geos.torpedoTube.rotateZ(Math.PI * 0.5);
    WEP_RESOURCES.geos.hexHousing.rotateX(Math.PI / 2);
    WEP_RESOURCES.geos.hexCore.rotateZ(Math.PI * 0.5);
    WEP_RESOURCES.geos.hexCoreGlow.rotateZ(Math.PI * 0.5);
    WEP_RESOURCES.geos.siegeCore.rotateZ(Math.PI * 0.5);

    WEP_RESOURCES.bulletHeadTex = makeHeadTexture();

    WEP_RESOURCES.bulletStyles = {
      vulcan: { key: 'vulcan', color: '#ffaa00', trailColor: '#ffc766', trailWidth: 2.0, coreWidth: 0.9, minLen: 14, stretch: 1.05, z: 14, headScale: 8, ionArcs: false },
      helios: { key: 'helios', color: '#ff003c', trailColor: '#ff628d', trailWidth: 3.0, coreWidth: 1.1, minLen: 26, stretch: 1.35, z: 14, headScale: 12, ionArcs: false },
      tempest: { key: 'tempest', color: '#00ccff', trailColor: '#7ee9ff', trailWidth: 3.6, coreWidth: 1.5, minLen: 20, stretch: 1.15, z: 14, headScale: 11, ionArcs: true },
      ciws: { key: 'ciws', color: '#8cffd0', trailColor: '#aaffdf', trailWidth: 1.4, coreWidth: 0.7, minLen: 12, stretch: 0.8, z: 14, headScale: 5, ionArcs: false },
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

  if (!WEP_RESOURCES.flashMats) WEP_RESOURCES.flashMats = new Map();
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

function markMeshTree(root, value = true) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = value;
    obj.receiveShadow = value;
  });
}

function promoteWeaponOverlay(root, renderOrder = 60) {
  root.renderOrder = renderOrder;
  const glowMaterials = WEP_RESOURCES.mats
    ? new Set([WEP_RESOURCES.mats.glowBlue, WEP_RESOURCES.mats.glowCyan, WEP_RESOURCES.mats.glowRed, WEP_RESOURCES.mats.glowAmber])
    : new Set();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const mat = obj.material;
    const materials = Array.isArray(mat) ? mat : [mat];
    const isGlow = materials.some((material) => material && glowMaterials.has(material));
    obj.renderOrder = isGlow ? (renderOrder + 3) : renderOrder;
    obj.frustumCulled = false;
    if (!mat) return;
    for (const material of materials) {
      if (!material) continue;
      material.depthTest = false;
      material.depthWrite = false;
      material.transparent = true;
      if (isGlow) material.toneMapped = false;
      if (!Number.isFinite(material.opacity)) material.opacity = 1;
      material.needsUpdate = true;
    }
  });
}

function getMuzzleFlashMats(colorHex) {
  ensureWeaponResources();
  const key = String(colorHex || '#ffffff').toLowerCase();
  const cached = WEP_RESOURCES.flashMats.get(key);
  if (cached) return cached;

  const base = new THREE.Color(key);
  const outer = new THREE.MeshBasicMaterial({
    color: base,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const inner = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const mats = { outer, inner };
  WEP_RESOURCES.flashMats.set(key, mats);
  return mats;
}

function createMuzzleFlash(colorHex, baseScale = 11) {
  const group = new THREE.Group();
  const mats = getMuzzleFlashMats(colorHex);
  const plane = WEP_RESOURCES.geos.planeUnit;

  const p1 = new THREE.Mesh(plane, mats.outer);
  p1.scale.set(baseScale, baseScale, 1);
  const p2 = new THREE.Mesh(plane, mats.outer);
  p2.scale.set(baseScale * 0.9, baseScale * 0.9, 1);
  p2.rotation.x = Math.PI * 0.5;
  const core = new THREE.Mesh(plane, mats.inner);
  core.scale.set(baseScale * 0.45, baseScale * 0.45, 1);

  group.add(p1, p2, core);
  group.visible = false;
  group.userData.baseScale = new THREE.Vector3(1, 1, 1);
  return group;
}

function cacheBasePosition(object3D) {
  if (!object3D) return;
  object3D.userData.basePosX = Number(object3D.position.x) || 0;
  object3D.userData.basePosY = Number(object3D.position.y) || 0;
  object3D.userData.basePosZ = Number(object3D.position.z) || 0;
}

function attachWeaponFxData(group, {
  weaponId,
  housing = null,
  barrels = [],
  muzzlePoints = [],
  muzzleColor = '#ffffff',
  recoil = null,
  shake = null
} = {}) {
  if (!group) return;
  const profile = WEAPON_FX_PROFILE[String(weaponId || '').toLowerCase()] || null;
  const recoilStrength = Number.isFinite(recoil) ? recoil : (profile?.recoil ?? 3.0);
  const shakeStrength = Number.isFinite(shake) ? shake : (profile?.shake ?? 1.8);
  const weaponKey = profile?.key || normalizeWeaponFxKey(weaponId);

  const barrelRoots = (Array.isArray(barrels) ? barrels : []).filter(Boolean);
  const flashes = [];
  const flashStates = [];
  const points = [];

  if (housing) cacheBasePosition(housing);
  for (const barrel of barrelRoots) cacheBasePosition(barrel);

  for (let i = 0; i < muzzlePoints.length; i++) {
    const point = muzzlePoints[i];
    if (!point) continue;
    const p = point.clone ? point.clone() : new THREE.Vector3(point.x || 0, point.y || 0, point.z || 0);
    points.push(p);
    const flash = createMuzzleFlash(muzzleColor, 11);
    flash.position.copy(p);
    group.add(flash);
    flashes.push(flash);
    flashStates.push(0);
  }

  group.userData.weaponFx = {
    weaponId: String(weaponId || ''),
    weaponKey,
    recoilStrength: Math.max(0.1, recoilStrength),
    shakeStrength: Math.max(0, shakeStrength),
    housing: housing || null,
    barrels: barrelRoots,
    muzzlePoints: points,
    muzzleFlashes: flashes,
    housingRecoil: 0,
    barrelRecoil: new Array(Math.max(1, barrelRoots.length)).fill(0),
    flashStates,
    nextBarrel: 0
  };
}

function triggerMeshShotFx(mesh, scale = 1) {
  const fx = mesh?.userData?.weaponFx;
  if (!fx) return;
  const recoilKick = Math.max(0.1, fx.recoilStrength * Math.max(0.25, scale));
  fx.housingRecoil = Math.min(fx.housingRecoil + recoilKick * 0.4, recoilKick * 3.0);

  const barrelCount = Math.max(1, fx.barrelRecoil.length);
  const barrelIndex = fx.nextBarrel % barrelCount;
  fx.nextBarrel = (fx.nextBarrel + 1) % barrelCount;
  fx.barrelRecoil[barrelIndex] = Math.max(fx.barrelRecoil[barrelIndex], recoilKick);

  if (fx.flashStates.length > 0) {
    const flashIndex = Math.min(fx.flashStates.length - 1, barrelIndex);
    fx.flashStates[flashIndex] = 1.0;
  }

  if (mesh.userData.spinGroup) {
    mesh.userData.spinBoost = Math.min(20, (mesh.userData.spinBoost || 0) + 8);
  }
}

function updateMeshWeaponFx(mesh, dt) {
  const fx = mesh?.userData?.weaponFx;
  if (!fx || dt <= 0) return;

  fx.housingRecoil = Math.max(0, fx.housingRecoil - fx.housingRecoil * 10 * dt);
  for (let i = 0; i < fx.barrelRecoil.length; i++) {
    fx.barrelRecoil[i] = Math.max(0, fx.barrelRecoil[i] - fx.barrelRecoil[i] * 15 * dt);
  }

  if (fx.housing) {
    const baseX = Number(fx.housing.userData.basePosX) || 0;
    fx.housing.position.x = baseX - fx.housingRecoil;
  }

  for (let i = 0; i < fx.barrels.length; i++) {
    const barrel = fx.barrels[i];
    if (!barrel) continue;
    const recoil = fx.barrelRecoil[Math.min(i, fx.barrelRecoil.length - 1)] || 0;
    const baseX = Number(barrel.userData.basePosX) || 0;
    barrel.position.x = baseX - recoil;
  }

  for (let i = 0; i < fx.muzzleFlashes.length; i++) {
    const flash = fx.muzzleFlashes[i];
    if (!flash) continue;
    const current = Math.max(0, (fx.flashStates[i] || 0) - (fx.flashStates[i] || 0) * 14 * dt);
    fx.flashStates[i] = current;
    flash.visible = current > 0.03;
    if (flash.visible) {
      const scale = 0.85 + current * 1.1;
      flash.scale.set(scale, scale, 1);
    }
  }

  if (mesh.userData.spinGroup) {
    const spinBoost = Math.max(0, (mesh.userData.spinBoost || 0) - 18 * dt);
    mesh.userData.spinBoost = spinBoost;
    const spinSpeed = 7.5 + spinBoost;
    mesh.userData.spinAngle = (mesh.userData.spinAngle || 0) + spinSpeed * dt;
    mesh.userData.spinGroup.rotation.y = mesh.userData.spinAngle;
  }
}

function buildVulcanTurret(sizeMult) {
  const mats = WEP_RESOURCES.mats;
  const geos = WEP_RESOURCES.geos;
  const group = new THREE.Group();

  const housing = new THREE.Mesh(new THREE.BoxGeometry(26, 16, 14), mats.armor);
  housing.position.set(5, 0, 8);
  group.add(housing);

  const barrelPivot = new THREE.Group();
  barrelPivot.rotation.z = -Math.PI * 0.5;
  barrelPivot.position.set(18, 0, 8);
  group.add(barrelPivot);

  const spinGroup = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const barrel = new THREE.Mesh(geos.barrelTube, mats.barrel);
    barrel.position.y = 12;
    barrel.position.x = Math.cos((i / 6) * Math.PI * 2) * 3;
    barrel.position.z = Math.sin((i / 6) * Math.PI * 2) * 3;
    spinGroup.add(barrel);
  }
  barrelPivot.add(spinGroup);

  const glowRing = new THREE.Mesh(new THREE.TorusGeometry(4, 0.75, 8, 20), mats.glowAmber);
  glowRing.rotation.x = Math.PI * 0.5;
  glowRing.position.set(26, 0, 8);
  group.add(glowRing);

  attachWeaponFxData(group, {
    weaponId: 'vulcan_minigun',
    housing,
    barrels: [barrelPivot],
    muzzlePoints: [new THREE.Vector3(45, 0, 8)],
    muzzleColor: '#ffaa00'
  });
  group.userData.spinGroup = spinGroup;
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildHeliosTurret(sizeMult) {
  const mats = WEP_RESOURCES.mats;
  const group = new THREE.Group();

  const housing = new THREE.Mesh(new THREE.BoxGeometry(20, 22, 12), mats.armor);
  housing.position.set(2, 0, 8);
  group.add(housing);

  const createLaserBarrel = (yPos) => {
    const barrelGroup = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(35, 3, 4), mats.barrel);
    barrel.position.x = 17.5;
    barrelGroup.add(barrel);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(30, 1.5, 4.2), mats.glowRed);
    glow.position.x = 17.5;
    barrelGroup.add(glow);
    barrelGroup.position.set(12, yPos, 8);
    return barrelGroup;
  };

  const barrelL = createLaserBarrel(6);
  const barrelR = createLaserBarrel(-6);
  group.add(barrelL);
  group.add(barrelR);

  const noseGlow = new THREE.Mesh(new THREE.BoxGeometry(4, 15, 5), mats.glowRed);
  noseGlow.position.set(43, 0, 8);
  group.add(noseGlow);

  attachWeaponFxData(group, {
    weaponId: 'helios_laser',
    housing,
    barrels: [barrelL, barrelR],
    muzzlePoints: [new THREE.Vector3(47, 6, 8), new THREE.Vector3(47, -6, 8)],
    muzzleColor: '#ff003c'
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildArmataTurret(sizeMult) {
  const mats = WEP_RESOURCES.mats;
  const group = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(26, 24, 16), mats.armor);
  housing.position.set(3, 0, 9);
  group.add(housing);

  const barrelPivot = new THREE.Group();
  barrelPivot.position.set(14, 0, 9);
  barrelPivot.rotation.z = -Math.PI * 0.5;
  group.add(barrelPivot);

  const railL = new THREE.Mesh(new THREE.BoxGeometry(2, 35, 6), mats.barrel);
  railL.position.set(-6, 17.5, 0);
  const railR = new THREE.Mesh(new THREE.BoxGeometry(2, 35, 6), mats.barrel);
  railR.position.set(6, 17.5, 0);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(3, 1), mats.glowAmber);
  crystal.position.y = 5;
  const focusRing = new THREE.Mesh(new THREE.TorusGeometry(5, 1, 8, 16), mats.glowAmber);
  focusRing.position.y = 35;
  focusRing.rotation.x = Math.PI * 0.5;
  barrelPivot.add(railL, railR, crystal, focusRing);

  attachWeaponFxData(group, {
    weaponId: 'armata_mk1',
    housing,
    barrels: [barrelPivot],
    muzzlePoints: [new THREE.Vector3(55, 0, 10)],
    muzzleColor: '#ff5500',
    recoil: 15,
    shake: 8
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildBeamContinuousTurret(sizeMult) {
  const mats = WEP_RESOURCES.mats;
  const group = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(26, 24, 16), mats.armor);
  housing.position.set(3, 0, 9);
  group.add(housing);

  const barrelPivot = new THREE.Group();
  barrelPivot.position.set(15, 0, 9);
  barrelPivot.rotation.z = -Math.PI * 0.5;
  group.add(barrelPivot);

  const railL = new THREE.Mesh(new THREE.BoxGeometry(2, 35, 6), mats.barrel);
  railL.position.set(-6, 17.5, 0);
  const railR = new THREE.Mesh(new THREE.BoxGeometry(2, 35, 6), mats.barrel);
  railR.position.set(6, 17.5, 0);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(3, 1), mats.glowCyan);
  crystal.position.y = 5;
  const focusRing = new THREE.Mesh(new THREE.TorusGeometry(5, 1, 8, 16), mats.glowCyan);
  focusRing.position.y = 35;
  focusRing.rotation.x = Math.PI * 0.5;
  barrelPivot.add(railL, railR, crystal, focusRing);

  attachWeaponFxData(group, {
    weaponId: 'beam_continuous',
    housing,
    barrels: [barrelPivot],
    muzzlePoints: [new THREE.Vector3(55, 0, 10)],
    muzzleColor: '#00ffcc',
    recoil: 1,
    shake: 1.5
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildBeamPulseTurret(sizeMult) {
  const mats = WEP_RESOURCES.mats;
  const group = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 15), mats.armor);
  housing.position.set(5, 0, 10);
  group.add(housing);

  const barrels = [];
  const muzzlePoints = [];
  const positions = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const pivot = new THREE.Group();
    pivot.rotation.z = -Math.PI * 0.5;
    pivot.position.set(15, pos[1] * 6, 10 + pos[0] * 4);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 20, 8), mats.barrel);
    barrel.position.y = 10;
    pivot.add(barrel);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 5, 8), mats.glowRed);
    glow.position.y = 18;
    pivot.add(glow);
    barrels.push(pivot);
    group.add(pivot);
    muzzlePoints.push(new THREE.Vector3(38, pos[1] * 6, 10 + pos[0] * 4));
  }

  attachWeaponFxData(group, {
    weaponId: 'beam_pulse',
    housing,
    barrels,
    muzzlePoints,
    muzzleColor: '#ff003c',
    recoil: 6,
    shake: 3.5
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildTempestTurret(sizeMult, barrelCount = 1) {
  const mats = WEP_RESOURCES.mats;
  const group = new THREE.Group();

  const housing = new THREE.Mesh(new THREE.BoxGeometry(18, 16, 16), mats.armor);
  housing.position.set(2, 0, 8);
  group.add(housing);

  const makeBarrel = (yOffset = 0) => {
    const barrelSys = new THREE.Group();
    const mainBarrel = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 20, 12), mats.barrel);
    mainBarrel.position.y = 10;
    barrelSys.add(mainBarrel);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 1, 8, 16), mats.glowCyan);
    ring.position.y = 16;
    ring.rotation.x = Math.PI * 0.5;
    barrelSys.add(ring);

    barrelSys.rotation.z = -Math.PI * 0.5;
    barrelSys.position.set(11, yOffset, 8);
    return barrelSys;
  };

  const barrels = [];
  if (barrelCount <= 1) {
    const single = makeBarrel(0);
    barrels.push(single);
    group.add(single);
  } else {
    const left = makeBarrel(-5);
    const right = makeBarrel(5);
    barrels.push(left, right);
    group.add(left);
    group.add(right);
  }

  const muzzleGlow = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 10, 8), mats.glowCyan);
  muzzleGlow.rotation.z = Math.PI * 0.5;
  muzzleGlow.position.set(34, 0, 8);
  group.add(muzzleGlow);

  const muzzlePoints = barrelCount <= 1
    ? [new THREE.Vector3(34, 0, 8)]
    : [new THREE.Vector3(34, -5, 8), new THREE.Vector3(34, 5, 8)];
  attachWeaponFxData(group, {
    weaponId: barrelCount <= 1 ? 'railgun_mk1' : 'railgun_mk2',
    housing,
    barrels,
    muzzlePoints,
    muzzleColor: '#00ccff'
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildYamatoTurret(sizeMult) {
  const mats = WEP_RESOURCES.mats;
  const group = new THREE.Group();

  const barbette = new THREE.Mesh(new THREE.CylinderGeometry(16, 18, 6, 6), mats.armor);
  barbette.position.set(2, 0, 0);
  barbette.rotation.x = Math.PI / 2;
  group.add(barbette);

  // Ksztalt Yamato Turret
  const turretShape = new THREE.Shape();
  turretShape.moveTo(-11, -14);
  turretShape.lineTo(11, -14);
  turretShape.lineTo(17, 0);
  turretShape.lineTo(7, 19);
  turretShape.lineTo(-7, 19);
  turretShape.lineTo(-17, 0);
  turretShape.lineTo(-11, -14);

  const extrudeSettings = { depth: 10, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.75, bevelThickness: 0.75 };
  const housing = new THREE.Mesh(new THREE.ExtrudeGeometry(turretShape, extrudeSettings), mats.armor);
  housing.rotation.x = Math.PI / 2;
  housing.rotation.z = -Math.PI / 2;
  housing.position.set(-6, 0, 10);
  group.add(housing);

  const radiator = new THREE.Mesh(new THREE.BoxGeometry(6, 24, 7), mats.base);
  radiator.position.set(-2, 0, 8);
  radiator.rotation.x = Math.PI / 2;
  group.add(radiator);

  const barrelsGroup = new THREE.Group();
  barrelsGroup.position.set(6, 0, 12);
  group.add(barrelsGroup);

  const barrels = [];
  const muzzlePoints = [];

  const createRailgun = (yOffset, scale = 1) => {
      const parentGun = new THREE.Group();
      const gun = new THREE.Group();

      const base = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 4), mats.armor);
      base.position.set(5, 0, 0);
      gun.add(base);

      const railGeo = new THREE.BoxGeometry(40, 5, 2);
      const leftRail = new THREE.Mesh(railGeo, mats.base);
      leftRail.position.set(25, -1.75, 0);
      gun.add(leftRail);

      const rightRail = new THREE.Mesh(railGeo, mats.base);
      rightRail.position.set(25, 1.75, 0);
      gun.add(rightRail);

      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 38, 8), mats.glowCyan);
      core.rotation.z = Math.PI / 2;
      core.position.set(26, 0, 0);
      gun.add(core);

      gun.position.y = yOffset;
      gun.scale.set(scale, scale, scale);
      
      parentGun.add(gun);
      return parentGun;
  };

  const leftGun = createRailgun(7.5, 0.9);
  const centerGun = createRailgun(0, 1.0);
  const rightGun = createRailgun(-7.5, 0.9);

  barrels.push(leftGun, centerGun, rightGun);
  barrelsGroup.add(leftGun, centerGun, rightGun);
  
  // Wspolrzedne XY do emitowania particle'i (odpowiada za flash Muzzle)
  muzzlePoints.push(new THREE.Vector3(56, 7.5 * 0.9, 12));
  muzzlePoints.push(new THREE.Vector3(58, 0, 12));
  muzzlePoints.push(new THREE.Vector3(56, -7.5 * 0.9, 12));

  attachWeaponFxData(group, {
    weaponId: 'special_yamato_cannon',
    housing: housing,
    barrels: [leftGun, centerGun, rightGun],
    muzzlePoints: muzzlePoints,
    muzzleColor: '#00ffff',
    recoil: 60,
    shake: 25
  });

  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

// ── NEW WEAPON BUILDERS (optimized: max 2-4 meshes each) ────────

function buildGoliathTurret(sizeMult) {
  const { mats, geos } = WEP_RESOURCES;
  const group = new THREE.Group();
  // 1. Housing (shared)
  const housing = new THREE.Mesh(geos.goliathHousing, mats.armor);
  housing.position.set(4, 0, 10);
  group.add(housing);
  // 2-3. Two barrel groups (shared barrel geo, recoil-capable)
  const barrels = [];
  const muzzlePoints = [];
  for (const yOff of [7, -7]) {
    const bGroup = new THREE.Group();
    bGroup.position.set(20, yOff, 10);
    const barrel = new THREE.Mesh(geos.goliathBarrel, mats.barrel);
    barrel.position.set(18, 0, 0);
    bGroup.add(barrel);
    barrels.push(bGroup);
    group.add(bGroup);
    muzzlePoints.push(new THREE.Vector3(58, yOff, 10));
  }
  // Total: 3 meshes (1 housing + 2 barrels)
  attachWeaponFxData(group, {
    weaponId: 'special_goliath_autocannon', housing, barrels, muzzlePoints,
    muzzleColor: '#ff6600', recoil: 20, shake: 10
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildPlasmaGatlingTurret(sizeMult) {
  const { mats, geos } = WEP_RESOURCES;
  const group = new THREE.Group();
  // 1. Housing (shared cylinder)
  const housing = new THREE.Mesh(geos.plasmaHousing, mats.armor);
  housing.position.set(2, 0, 8);
  group.add(housing);
  // 2-3. Two barrels in spin group (shared barrel geo)
  const barrelPivot = new THREE.Group();
  barrelPivot.position.set(16, 0, 8);
  barrelPivot.rotation.z = -Math.PI * 0.5;
  group.add(barrelPivot);
  const spinGroup = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const angle = (i / 2) * Math.PI * 2;
    const barrel = new THREE.Mesh(geos.plasmaBarrel, mats.glowCyan);
    barrel.position.set(Math.cos(angle) * 6, 9, Math.sin(angle) * 6);
    spinGroup.add(barrel);
  }
  barrelPivot.add(spinGroup);
  // Total: 3 meshes (1 housing + 2 barrels)
  attachWeaponFxData(group, {
    weaponId: 'special_plasma_gatling', housing, barrels: [barrelPivot],
    muzzlePoints: [new THREE.Vector3(42, 0, 8)],
    muzzleColor: '#00ffff', recoil: 15, shake: 8
  });
  group.userData.spinGroup = spinGroup;
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildBeamEmitterTurret(sizeMult) {
  const { mats, geos } = WEP_RESOURCES;
  const group = new THREE.Group();
  // 1. Housing (shared)
  const housing = new THREE.Mesh(geos.beamHousing, mats.armor);
  housing.position.set(0, 0, 7);
  group.add(housing);
  // Barrel group (for recoil)
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(10, 0, 7);
  group.add(barrelGroup);
  // 2. Dish (shared)
  const dish = new THREE.Mesh(geos.beamDish, mats.base);
  dish.position.set(22, 0, 0);
  barrelGroup.add(dish);
  // 3. Crystal (shared)
  const crystal = new THREE.Mesh(geos.beamCrystal, mats.glowCyan);
  crystal.position.set(26, 0, 0);
  barrelGroup.add(crystal);
  // Total: 3 meshes (1 housing + 1 dish + 1 crystal)
  attachWeaponFxData(group, {
    weaponId: 'beam_continuous', housing, barrels: [barrelGroup],
    muzzlePoints: [new THREE.Vector3(48, 0, 7)],
    muzzleColor: '#00ffcc', recoil: 1, shake: 1.5
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildHeavyAutocannonTurret(sizeMult) {
  const { mats, geos } = WEP_RESOURCES;
  const group = new THREE.Group();
  // 1. Base (reused autoBase)
  const base = new THREE.Mesh(geos.autoBase, mats.base);
  base.position.set(2, 0, 6);
  group.add(base);
  // 2. Housing (shared)
  const housing = new THREE.Mesh(geos.heavyAutoHousing, mats.armor);
  housing.position.set(6, 0, 8);
  group.add(housing);
  // 3. Barrel (shared, in pivot for recoil)
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(14, 0, 8);
  group.add(barrelGroup);
  const mainBarrel = new THREE.Mesh(geos.heavyAutoBarrel, mats.barrel);
  mainBarrel.position.set(14, 0, 0);
  barrelGroup.add(mainBarrel);
  // Total: 3 meshes (1 base + 1 housing + 1 barrel)
  attachWeaponFxData(group, {
    weaponId: 'heavy_autocannon', housing, barrels: [barrelGroup],
    muzzlePoints: [new THREE.Vector3(42, 0, 8)],
    muzzleColor: '#ffcc8a', recoil: 8, shake: 4
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildCIWSTurret(sizeMult) {
  const { mats, geos } = WEP_RESOURCES;
  const group = new THREE.Group();
  // 1. Base plate (reused ciwsBase)
  const basePlate = new THREE.Mesh(geos.ciwsBase, mats.base);
  group.add(basePlate);
  // 2. Dome (shared hemisphere)
  const dome = new THREE.Mesh(geos.ciwsDome, mats.armor);
  dome.position.set(0, 0, 3);
  group.add(dome);
  // 3. Single cluster barrel (shared thick cylinder, no spin overhead)
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(6, 0, 5);
  group.add(barrelGroup);
  const barrel = new THREE.Mesh(geos.ciwsClusterBarrel, mats.barrel);
  barrel.position.set(9, 0, 0);
  barrelGroup.add(barrel);
  // Total: 3 meshes (1 base + 1 dome + 1 barrel)
  attachWeaponFxData(group, {
    weaponId: 'ciws_mk1', housing: dome, barrels: [barrelGroup],
    muzzlePoints: [new THREE.Vector3(22, 0, 5)],
    muzzleColor: '#8cffd0', recoil: 1.5, shake: 1
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildLaserPDTurret(sizeMult) {
  const { mats, geos } = WEP_RESOURCES;
  const group = new THREE.Group();
  // 1. Base (reused ciwsBase)
  const base = new THREE.Mesh(geos.ciwsBase, mats.base);
  base.position.set(0, 0, 2);
  group.add(base);
  // 2. Lens barrel (shared, glowBlue material = visible emitter)
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(8, 0, 5);
  group.add(barrelGroup);
  const lens = new THREE.Mesh(geos.laserPDLens, mats.glowBlue);
  lens.position.set(5, 0, 0);
  barrelGroup.add(lens);
  // Total: 2 meshes (1 base + 1 lens)
  attachWeaponFxData(group, {
    weaponId: 'laser_pd_mk1', housing: base, barrels: [barrelGroup],
    muzzlePoints: [new THREE.Vector3(18, 0, 5)],
    muzzleColor: '#6ec8ff', recoil: 0.5, shake: 0.3
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildMissileRackTurret(sizeMult) {
  const { mats, geos } = WEP_RESOURCES;
  const group = new THREE.Group();
  // 1. Housing (shared)
  const housing = new THREE.Mesh(geos.missileHousing, mats.armor);
  housing.position.set(4, 0, 8);
  group.add(housing);
  // 2. Glow strip (shared — suggests loaded warheads inside)
  const glowStrip = new THREE.Mesh(geos.missileGlowStrip, mats.glowAmber);
  glowStrip.position.set(14, 0, 8);
  group.add(glowStrip);
  // Total: 2 meshes (1 housing + 1 glow strip)
  attachWeaponFxData(group, {
    weaponId: 'missile_rack', housing, barrels: [],
    muzzlePoints: [
      new THREE.Vector3(16, -5, 5), new THREE.Vector3(16, 0, 5), new THREE.Vector3(16, 5, 5),
      new THREE.Vector3(16, -5, 11), new THREE.Vector3(16, 0, 11), new THREE.Vector3(16, 5, 11)
    ],
    muzzleColor: '#ffbb77', recoil: 4, shake: 2
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildSiegeTorpedoTurret(sizeMult) {
  const { mats, geos } = WEP_RESOURCES;
  const group = new THREE.Group();
  // 1. Housing (shared)
  const housing = new THREE.Mesh(geos.torpedoHousing, mats.armor);
  housing.position.set(0, 0, 9);
  group.add(housing);
  // 2-3. Two torpedo tubes (shared geo, as barrel groups for alternating recoil)
  const barrels = [];
  const muzzlePoints = [];
  for (const yOff of [7, -7]) {
    const tubeGroup = new THREE.Group();
    tubeGroup.position.set(12, yOff, 9);
    const tube = new THREE.Mesh(geos.torpedoTube, mats.barrel);
    tubeGroup.add(tube);
    barrels.push(tubeGroup);
    group.add(tubeGroup);
    muzzlePoints.push(new THREE.Vector3(30, yOff, 9));
  }
  // Total: 3 meshes (1 housing + 2 tubes)
  attachWeaponFxData(group, {
    weaponId: 'siege_torpedo', housing, barrels, muzzlePoints,
    muzzleColor: '#ff4444', recoil: 6, shake: 3
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildHexlanceTurret(sizeMult) {
  const { mats, geos } = WEP_RESOURCES;
  const group = new THREE.Group();
  // 1. Housing (shared hex cylinder)
  const housing = new THREE.Mesh(geos.hexHousing, mats.armor);
  housing.position.set(0, 0, 8);
  group.add(housing);
  // Barrel group (for recoil)
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(10, 0, 8);
  group.add(barrelGroup);
  // 2. Core barrel (shared)
  const core = new THREE.Mesh(geos.hexCore, mats.barrel);
  core.position.set(20, 0, 0);
  barrelGroup.add(core);
  // 3. Core glow (shared)
  const coreGlow = new THREE.Mesh(geos.hexCoreGlow, mats.glowBlue);
  coreGlow.position.set(20, 0, 0);
  barrelGroup.add(coreGlow);
  // 4. Front ring (shared)
  const frontRing = new THREE.Mesh(geos.hexFrontRing, mats.glowBlue);
  frontRing.rotation.y = Math.PI * 0.5;
  frontRing.position.set(32, 0, 0);
  barrelGroup.add(frontRing);
  // Total: 4 meshes (1 housing + 1 core + 1 coreGlow + 1 ring)
  attachWeaponFxData(group, {
    weaponId: 'hexlance_siege', housing, barrels: [barrelGroup],
    muzzlePoints: [new THREE.Vector3(52, 0, 8)],
    muzzleColor: '#d0eaff', recoil: 30, shake: 15
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function buildSiegeRailgunTurret(sizeMult) {
  const { mats, geos } = WEP_RESOURCES;
  const group = new THREE.Group();
  // 1. Housing (shared)
  const housing = new THREE.Mesh(geos.siegeHousing, mats.armor);
  housing.position.set(0, 0, 10);
  group.add(housing);
  // Barrel group (for recoil)
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(14, 0, 10);
  group.add(barrelGroup);
  // 2-3. Two rails (shared)
  const railL = new THREE.Mesh(geos.siegeRailBar, mats.barrel);
  railL.position.set(30, 5, 0);
  barrelGroup.add(railL);
  const railR = new THREE.Mesh(geos.siegeRailBar, mats.barrel);
  railR.position.set(30, -5, 0);
  barrelGroup.add(railR);
  // 4. Core glow (shared)
  const core = new THREE.Mesh(geos.siegeCore, mats.glowCyan);
  core.position.set(30, 0, 0);
  barrelGroup.add(core);
  // Total: 4 meshes (1 housing + 2 rails + 1 core)
  attachWeaponFxData(group, {
    weaponId: 'siege_railgun', housing, barrels: [barrelGroup],
    muzzlePoints: [new THREE.Vector3(80, 0, 10)],
    muzzleColor: '#aaffff', recoil: 120, shake: 80
  });
  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function createFallbackWeaponMesh(category, sizeMult) {
  const group = new THREE.Group();
  const mBase = WEP_RESOURCES.mats.base;
  const mBarrel = WEP_RESOURCES.mats.barrel;
  const mGlowB = WEP_RESOURCES.mats.glowBlue;
  const mGlowR = WEP_RESOURCES.mats.glowRed;

  if (category === 'rail') {
    const base = new THREE.Mesh(WEP_RESOURCES.geos.railBase, mBase);
    base.position.z = 3;
    const b1 = new THREE.Mesh(WEP_RESOURCES.geos.railBarrel, mBarrel);
    b1.position.set(15, -5, 3);
    const b2 = new THREE.Mesh(WEP_RESOURCES.geos.railBarrel, mBarrel);
    b2.position.set(15, 5, 3);
    const g1 = new THREE.Mesh(WEP_RESOURCES.geos.railGlow, mGlowB);
    g1.position.set(15, -5, 4.6);
    const g2 = new THREE.Mesh(WEP_RESOURCES.geos.railGlow, mGlowB);
    g2.position.set(15, 5, 4.6);
    group.add(base, b1, b2, g1, g2);
  } else if (category === 'armata' || category === 'plasma') {
    const base = new THREE.Mesh(WEP_RESOURCES.geos.armataBase, mBase);
    base.position.z = 4;
    const barrel = new THREE.Mesh(WEP_RESOURCES.geos.armataBarrel, mBarrel);
    barrel.position.set(14, 0, 4);
    const g = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 8.2), category === 'plasma' ? mGlowB : mGlowR);
    g.position.set(16, 0, 4);
    group.add(base, barrel, g);
  } else if (category === 'autocannon') {
    const base = new THREE.Mesh(WEP_RESOURCES.geos.autoBase, mBase);
    base.position.z = 4;
    const barrel = new THREE.Mesh(WEP_RESOURCES.geos.autoBarrel, mBarrel);
    barrel.position.set(11, 0, 4);
    group.add(base, barrel);
  } else if (category === 'ciws' || category === 'beam') {
    const base = new THREE.Mesh(WEP_RESOURCES.geos.ciwsBase, mBase);
    base.position.z = 2.5;
    const barrel = new THREE.Mesh(WEP_RESOURCES.geos.ciwsBarrel, category === 'beam' ? mGlowB : mBarrel);
    barrel.position.set(7, 0, 2.5);
    group.add(base, barrel);
  } else {
    const base = new THREE.Mesh(WEP_RESOURCES.geos.defaultBase, mBase);
    base.position.z = 3;
    group.add(base);
  }

  group.scale.setScalar(sizeMult);
  markMeshTree(group, false);
  return group;
}

function createWeapon3DMesh(weaponId, category, size) {
  ensureWeaponResources();
  const scaleMult = getWeapon3DScale(size, category);
  const key = String(weaponId || '').toLowerCase();

  let mesh;
  if (key === 'vulcan_minigun') mesh = buildVulcanTurret(scaleMult);
  else if (key === 'helios_laser') mesh = buildHeliosTurret(scaleMult);
  else if (key === 'armata_mk1') mesh = buildArmataTurret(scaleMult);
  else if (key === 'beam_continuous') mesh = buildBeamEmitterTurret(scaleMult);
  else if (key === 'beam_pulse') mesh = buildBeamPulseTurret(scaleMult);
  else if (key === 'special_goliath_autocannon') mesh = buildGoliathTurret(scaleMult);
  else if (key === 'special_plasma_gatling') mesh = buildPlasmaGatlingTurret(scaleMult);
  else if (key === 'special_valkyrie_railgun') mesh = buildTempestTurret(scaleMult, 2);
  else if (key === 'special_yamato_cannon') mesh = buildYamatoTurret(scaleMult);
  else if (key === 'railgun_mk1' || key === 'tempest_ion_mk1') mesh = buildTempestTurret(scaleMult, 1);
  else if (key === 'railgun_mk2' || key === 'tempest_ion_mk2') mesh = buildTempestTurret(scaleMult, 2);
  else if (key === 'heavy_autocannon') mesh = buildHeavyAutocannonTurret(scaleMult);
  else if (key === 'ciws_mk1') mesh = buildCIWSTurret(scaleMult);
  else if (key === 'laser_pd_mk1') mesh = buildLaserPDTurret(scaleMult);
  else if (key === 'missile_rack' || key === 'fast_missile_rack') mesh = buildMissileRackTurret(scaleMult);
  else if (key === 'siege_torpedo' || key === 'siege_torpedo_mk2') mesh = buildSiegeTorpedoTurret(scaleMult);
  else if (key === 'torpedo_salvo') mesh = buildMissileRackTurret(scaleMult);
  else if (key === 'hexlance_siege') mesh = buildHexlanceTurret(scaleMult);
  else if (key === 'siege_railgun') mesh = buildSiegeRailgunTurret(scaleMult);
  else mesh = createFallbackWeaponMesh(category, scaleMult);
  if (!mesh.userData.weaponFx) {
    attachWeaponFxData(mesh, {
      weaponId: key,
      housing: null,
      barrels: [],
      muzzlePoints: [new THREE.Vector3(18, 0, 6)],
      muzzleColor: '#b8d7ff',
      recoil: 2.0,
      shake: 1.0
    });
  }
  promoteWeaponOverlay(mesh);
  return mesh;
}

function resolveBulletVisualStyle(bullet) {
  ensureWeaponResources();
  const key = String(bullet?.vfxKey || bullet?.weaponId || bullet?.weaponName || bullet?.type || '').toLowerCase();

  if (key.includes('special_goliath')) return WEP_RESOURCES.bulletStyles.goliath;
  if (key.includes('special_plasma')) return WEP_RESOURCES.bulletStyles.plasmaGatling;
  if (key.includes('special_valkyrie')) return WEP_RESOURCES.bulletStyles.tempest;
  if (key.includes('yamato')) return WEP_RESOURCES.bulletStyles.yamato;
  if (key.includes('hexlance')) return WEP_RESOURCES.bulletStyles.hexlance;
  if (key.includes('siege_railgun')) return WEP_RESOURCES.bulletStyles.siegeRail;
  if (key.includes('vulcan')) return WEP_RESOURCES.bulletStyles.vulcan;
  if (key.includes('helios')) return WEP_RESOURCES.bulletStyles.helios;
  if (key.includes('tempest') || key.includes('rail')) return WEP_RESOURCES.bulletStyles.tempest;
  if (key.includes('laser_pd')) return WEP_RESOURCES.bulletStyles.laserPD;
  if (key.includes('ciws') || key.includes('pd')) return WEP_RESOURCES.bulletStyles.ciws;
  if (key.includes('heavy_auto')) return WEP_RESOURCES.bulletStyles.autocannon;
  if (key.includes('auto') || key.includes('gatling')) return WEP_RESOURCES.bulletStyles.autocannon;
  if (key.includes('armata') || key.includes('flak')) return WEP_RESOURCES.bulletStyles.armata;
  if (key.includes('plasma')) return WEP_RESOURCES.bulletStyles.plasma;
  if (key.includes('rocket') || key.includes('missile') || key.includes('aim-') || key.includes('asm')) return WEP_RESOURCES.bulletStyles.rocket;
  if (key.includes('torpedo')) return WEP_RESOURCES.bulletStyles.torpedo;
  if (key.includes('siege')) return WEP_RESOURCES.bulletStyles.siegeRail;
  return WEP_RESOURCES.bulletStyles.default;
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

    const cA = new THREE.Color(0xffffff);
    const cB = new THREE.Color(0xaaffff);
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

function clearWeaponMeshes(container) {
  const meshes = container?.userData?.meshes;
  if (!meshes) return;
  for (const [, mesh] of meshes) {
    container.remove(mesh);
  }
  meshes.clear();
}

export const Weapon3DSystem = {
  containers: new Map(),
  _preloaded: false,
  _lastFxTimeSec: 0,
  _cameraShakeMag: 0,
  _shotListenerBound: false,
  _shotListener: null,
  _tmpShotPos: new THREE.Vector3(),
  _tmpMuzzlePos: new THREE.Vector3(),
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
    
    const commonColors = ['#ffaa00', '#ff003c', '#00ccff', '#ff5500', '#00ffcc', '#b8d7ff'];
    for (const c of commonColors) {
        getMuzzleFlashMats(c);
    }
    
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

  _findClosestTurretUid(shotX, shotY) {
    let bestUid = null;
    let bestDistSq = Infinity;
    const shotPos = this._tmpShotPos;
    shotPos.set(shotX, -shotY, 0);

    for (const [, container] of this.containers) {
      const meshes = container?.userData?.meshes;
      if (!meshes || meshes.size === 0) continue;
      
      container.updateMatrixWorld(true);

      for (const [uid, mesh] of meshes) {
        const fx = mesh?.userData?.weaponFx;
        if (!fx) continue;

        const points = fx.muzzlePoints;
        if (Array.isArray(points) && points.length > 0) {
          for (let i = 0; i < points.length; i++) {
            this._tmpMuzzlePos.copy(points[i]).applyMatrix4(mesh.matrixWorld);
            const dx = this._tmpMuzzlePos.x - shotPos.x;
            const dy = this._tmpMuzzlePos.y - shotPos.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestDistSq) {
              bestDistSq = d2;
              bestUid = uid;
            }
          }
        } else {
          mesh.getWorldPosition(this._tmpMuzzlePos);
          const dx = this._tmpMuzzlePos.x - shotPos.x;
          const dy = this._tmpMuzzlePos.y - shotPos.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestUid = uid;
          }
        }
      }
    }
    return bestUid;
  },

  _resolveBeamMuzzleFromTurretUid(turretUid) {
    if (!turretUid) return null;
    const uidRaw = String(turretUid);
    const barrelMatch = /:b(\d+)$/.exec(uidRaw);
    const barrelIndex = barrelMatch ? Math.max(0, Number(barrelMatch[1]) || 0) : 0;
    const meshUid = barrelMatch ? uidRaw.slice(0, barrelMatch.index) : uidRaw;

    for (const [, container] of this.containers) {
      const meshes = container?.userData?.meshes;
      if (!meshes) continue;
      const mesh = meshes.get(meshUid);
      if (!mesh) continue;

      container.updateMatrixWorld(true);
      const fx = mesh.userData?.weaponFx;
      const points = fx?.muzzlePoints;
      if (Array.isArray(points) && points.length > 0) {
        const pointIndex = Math.min(barrelIndex, points.length - 1);
        this._tmpMuzzlePos.copy(points[pointIndex]).applyMatrix4(mesh.matrixWorld);
      } else {
        mesh.getWorldPosition(this._tmpMuzzlePos);
      }
      return { x: this._tmpMuzzlePos.x, y: -this._tmpMuzzlePos.y };
    }
    return null;
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
      c.glow.material.color.copy(color);
      c.core.material.color.set(0xffffff);
      if (Array.isArray(c.bodyPlanes)) {
        for (let i = 0; i < c.bodyPlanes.length; i++) {
          const body = c.bodyPlanes[i];
          if (!body?.material?.color) continue;
          body.material.color.copy(color);
        }
      }
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
    pulse.core.material.color.set(0xffffff);
    pulse.glow.material.color.set(colorHex);
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
      const muzzle = this._resolveBeamMuzzleFromTurretUid(beam.turretUid);
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
      this._continuousBeamActive[i] = this._continuousBeamActive[this._continuousBeamActive.length - 1];
      this._continuousBeamActive.pop();
      this._continuousBeamPool.push(beam);
    }
  },

  _ensureShotListener() {
    if (typeof window === 'undefined' || this._shotListenerBound) return;
    this._shotListener = (event) => {
      const detail = event?.detail || {};
      const weaponKey = normalizeWeaponFxKey(detail.weaponId);
      const shotX = Number(detail.x);
      const shotY = Number(detail.y);
      if (!weaponKey || !Number.isFinite(shotX) || !Number.isFinite(shotY)) return;
      const isBeam = detail?.isBeam === true;
      const beamMode = String(detail?.beamMode || detail?.beam?.mode || '').toLowerCase();
      const isContinuousBeam = isBeam && beamMode === 'continuous';
      if (!isContinuousBeam) {
        this._triggerShotByWorldPoint(weaponKey, shotX, shotY);
      }
      if (isBeam && detail?.beam) this._triggerBeamFx(detail);
    };
    window.addEventListener('game_weapon_fired', this._shotListener);
    this._shotListenerBound = true;
  },

  _triggerShotByWorldPoint(weaponKey, shotX, shotY) {
    let bestMesh = null;
    let bestDistSq = Infinity;
    const shotPos = this._tmpShotPos;
    shotPos.set(shotX, -shotY, 0);

    for (const [, container] of this.containers) {
      const meshes = container?.userData?.meshes;
      if (!meshes || meshes.size === 0) continue;
      container.updateMatrixWorld(true);
      for (const [, mesh] of meshes) {
        const fx = mesh?.userData?.weaponFx;
        if (!fx) continue;
        if (weaponKey && fx.weaponKey !== weaponKey) continue;

        const points = fx.muzzlePoints;
        if (Array.isArray(points) && points.length > 0) {
          for (let i = 0; i < points.length; i++) {
            this._tmpMuzzlePos.copy(points[i]).applyMatrix4(mesh.matrixWorld);
            const dx = this._tmpMuzzlePos.x - shotPos.x;
            const dy = this._tmpMuzzlePos.y - shotPos.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestDistSq) {
              bestDistSq = d2;
              bestMesh = mesh;
            }
          }
        } else {
          mesh.getWorldPosition(this._tmpMuzzlePos);
          const dx = this._tmpMuzzlePos.x - shotPos.x;
          const dy = this._tmpMuzzlePos.y - shotPos.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestMesh = mesh;
          }
        }
      }
    }

    if (!bestMesh) return;
    triggerMeshShotFx(bestMesh);
    const fx = bestMesh.userData?.weaponFx;
    const shake = Number(fx?.shakeStrength) || 0;
    this._cameraShakeMag = Math.min(18, this._cameraShakeMag + shake);
  },

  _updateWeaponFx(dt) {
    for (const [, container] of this.containers) {
      const meshes = container?.userData?.meshes;
      if (!meshes) continue;
      for (const [, mesh] of meshes) {
        updateMeshWeaponFx(mesh, dt);
      }
    }
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

  syncWeapons(entity, shipEx, shipEy, shipAngle, shipScale) {
    if (!this._preloaded) this._preloadShaders();
    
    ensureWeaponResources();
    this._ensureShotListener();

    const wepDataList = [];

    if (entity.autoWeapons) {
      for (let i = 0; i < entity.autoWeapons.length; i++) {
        const w = entity.autoWeapons[i];
        const def = w?.def;
        if (!shouldRenderWeapon3D(def) || !w.hpOffset || w.hpOffset.x == null || w.hpOffset.y == null) continue;
        wepDataList.push({
          uid: `npc_wep_${i}_${def.id || def.category || 'x'}`,
          weaponId: def.id,
          category: def.category,
          size: def.size,
          localX: Number(w.hpOffset.x) || 0,
          localY: Number(w.hpOffset.y) || 0,
          angle: w.visualAngle !== undefined ? w.visualAngle : shipAngle,
          useHardpointScale: true
        });
      }
    } else if (entity.isPlayer && entity.weapons) {
      const interpTurretAngles = (typeof window !== 'undefined' && entity === window.ship && window.__interpShipTurretAngles)
        ? window.__interpShipTurretAngles
        : null;
      const turret1Angle = Number.isFinite(interpTurretAngles?.turret1) ? interpTurretAngles.turret1 : (entity.turret?.angle || shipAngle);
      const turret2Angle = Number.isFinite(interpTurretAngles?.turret2) ? interpTurretAngles.turret2 : (entity.turret2?.angle || shipAngle);
      const turret3Angle = Number.isFinite(interpTurretAngles?.turret3) ? interpTurretAngles.turret3 : (entity.turret3?.angle || shipAngle);
      const turret4Angle = Number.isFinite(interpTurretAngles?.turret4) ? interpTurretAngles.turret4 : (entity.turret4?.angle || shipAngle);
      const ciwsInterpAngles = Array.isArray(interpTurretAngles?.ciws) ? interpTurretAngles.ciws : null;
      const turrets = [
        { t: entity.turret, ang: turret1Angle },
        { t: entity.turret2, ang: turret2Angle },
        { t: entity.turret3, ang: turret3Angle },
        { t: entity.turret4, ang: turret4Angle }
      ];

      const mains = entity.weapons.main || [];
      for (let i = 0; i < mains.length; i++) {
        const loadout = mains[i];
        const def = loadout?.weapon;
        if (!shouldRenderWeapon3D(def)) continue;
        const hp = loadout.hp?.pos || loadout.hp;
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let ti = 0; ti < turrets.length; ti++) {
          const tur = turrets[ti];
          const dx = (hp?.x || 0) - (tur.t?.offset?.x || 0);
          const dy = (hp?.y || 0) - (tur.t?.offset?.y || 0);
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist) {
            bestDist = d2;
            bestIdx = ti;
          }
        }
        const turret = turrets[bestIdx];
        wepDataList.push({
          uid: `p_main_${i}_${def.id || def.category || 'x'}`,
          weaponId: def.id,
          category: def.category,
          size: def.size,
          localX: hp?.x ?? turret.t?.offset?.x ?? 0,
          localY: hp?.y ?? turret.t?.offset?.y ?? 0,
          angle: turret.ang
        });
      }

      const auxes = entity.weapons.aux || [];
      for (let i = 0; i < auxes.length; i++) {
        const loadout = auxes[i];
        const def = loadout?.weapon;
        if (!shouldRenderWeapon3D(def)) continue;
        const c = entity.ciws?.[i];
        const hp = loadout.hp?.pos || loadout.hp;
        wepDataList.push({
          uid: `p_aux_${i}_${def.id || def.category || 'x'}`,
          weaponId: def.id,
          category: def.category,
          size: def.size,
          localX: hp?.x ?? c?.offset?.x ?? 0,
          localY: hp?.y ?? c?.offset?.y ?? 0,
          angle: Number.isFinite(ciwsInterpAngles?.[i]) ? ciwsInterpAngles[i] : (c?.angle !== undefined ? c.angle : shipAngle)
        });
      }

      const missiles = entity.weapons.missile || [];
      for (let i = 0; i < missiles.length; i++) {
        const loadout = missiles[i];
        const def = loadout?.weapon;
        if (!shouldRenderWeapon3D(def)) continue;
        const hp = loadout.hp?.pos || loadout.hp;
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let ti = 0; ti < turrets.length; ti++) {
          const tur = turrets[ti];
          const dx = (hp?.x || 0) - (tur.t?.offset?.x || 0);
          const dy = (hp?.y || 0) - (tur.t?.offset?.y || 0);
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist) {
            bestDist = d2;
            bestIdx = ti;
          }
        }
        const turret = turrets[bestIdx];
        wepDataList.push({
          uid: `p_missile_${i}_${def.id || def.category || 'x'}`,
          weaponId: def.id,
          category: def.category,
          size: def.size,
          localX: hp?.x ?? 0,
          localY: hp?.y ?? 0,
          angle: turret.ang
        });
      }

      const specials = entity.weapons.special || [];
      for (let i = 0; i < specials.length; i++) {
        const loadout = specials[i];
        const def = loadout?.weapon;
        if (!shouldRenderWeapon3D(def)) continue;
        const hp = loadout.hp?.pos || loadout.hp;
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let ti = 0; ti < turrets.length; ti++) {
          const tur = turrets[ti];
          const dx = (hp?.x || 0) - (tur.t?.offset?.x || 0);
          const dy = (hp?.y || 0) - (tur.t?.offset?.y || 0);
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist) {
            bestDist = d2;
            bestIdx = ti;
          }
        }
        const turret = turrets[bestIdx];
        wepDataList.push({
          uid: `p_special_${i}_${def.id || def.category || 'x'}`,
          weaponId: def.id,
          category: def.category,
          size: def.size,
          localX: hp?.x ?? 0,
          localY: hp?.y ?? 0,
          angle: turret.ang
        });
      }
    }

    const hadContainer = this.containers.has(entity);
    if (wepDataList.length === 0) {
      if (hadContainer) this.disposeEntity(entity);
      return;
    }

    let container = this.containers.get(entity);
    if (!container) {
      container = new THREE.Group();
      container.userData.meshes = new Map();
      container.userData.fgCategory = 'weapons';
      container.renderOrder = 60;
      container.userData.tiltX = 0;
      container.userData.tiltY = 0;
      Core3D.scene.add(container);
      Core3D.enableForeground3D(container);
      this.containers.set(entity, container);
    }

    let targetTiltX = 0;
    let targetTiltY = 0;
    if (typeof window !== 'undefined' && window.camera) {
      const camX = Number(window.camera.x) || 0;
      const camY = Number(window.camera.y) || 0;
      const camZoom = Math.max(0.01, Number(window.camera.zoom) || 1);
      const relX = shipEx - camX;
      const relY = camY - shipEy;
      const len = Math.hypot(relX, relY);
      if (len > 1e-3) {
        const nx = relX / len;
        const ny = relY / len;
        const deadZonePx = 100 / camZoom;
        const response = Math.min(1, Math.max(0, (len - deadZonePx) / (2300 / camZoom)));
        const maxTilt = 0.44;
        targetTiltX = ny * maxTilt * response;
        targetTiltY = -nx * maxTilt * response;
      }
    }
    
    const tiltLerp = 0.2;
    container.userData.tiltX += (targetTiltX - container.userData.tiltX) * tiltLerp;
    container.userData.tiltY += (targetTiltY - container.userData.tiltY) * tiltLerp;

    container.rotation.x = container.userData.tiltX;
    container.rotation.y = container.userData.tiltY;
    container.rotation.z = 0;

    container.position.set(shipEx, -shipEy, 0.0);

    const currentMeshes = container.userData.meshes;
    const usedUids = new Set();
    const cosAngle = Math.cos(shipAngle);
    const sinAngle = Math.sin(shipAngle);
    const weaponLocalScale = getEntityWeaponLocalScale(entity);

    for (const wData of wepDataList) {
      usedUids.add(wData.uid);
      let mesh = currentMeshes.get(wData.uid);
      if (!mesh) {
        mesh = createWeapon3DMesh(wData.weaponId, wData.category, wData.size);
        container.add(mesh);
        Core3D.enableForeground3D(mesh);
        currentMeshes.set(wData.uid, mesh);
      }

      const positionScaleX = wData.useHardpointScale ? weaponLocalScale.x : shipScale;
      const positionScaleY = wData.useHardpointScale ? weaponLocalScale.y : shipScale;
      const lx = (Number(wData.localX) || 0) * positionScaleX;
      const ly = (Number(wData.localY) || 0) * positionScaleY;
      const rx = lx * cosAngle - ly * sinAngle;
      const ry = lx * sinAngle + ly * cosAngle;
      mesh.position.set(rx, -ry, 0);
      mesh.rotation.z = -wData.angle;
    }

    for (const [uid, mesh] of currentMeshes.entries()) {
      if (usedUids.has(uid)) continue;
      container.remove(mesh);
      currentMeshes.delete(uid);
    }
  },

  cleanupEntities(activeEntities) {
    if (!(activeEntities instanceof Set)) return;
    for (const [entity] of this.containers) {
      if (!activeEntities.has(entity)) this.disposeEntity(entity);
    }
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

    let instanceCount = 0;
    let arcInstanceCount = 0;
    const dummy = bulletInstances.dummy;
    const colorObj = this._tmpProjectileColor;
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
      const px = isFiniteNumber(bullet.px) ? Number(bullet.px) : (x - (Number(bullet.vx) || 0) * 0.016);
      const py = isFiniteNumber(bullet.py) ? Number(bullet.py) : (y - (Number(bullet.vy) || 0) * 0.016);

      const segX = x - px;
      const segY = y - py;
      const segLen = Math.hypot(segX, segY);
      const angle = Math.atan2(-segY, segX || 1e-6);

      const cx = (x + px) * 0.5;
      const cy = (y + py) * 0.5;
      const trailLen = Math.max(style.minLen, segLen * style.stretch);
      const coreLen = Math.max(style.minLen * 0.55, segLen * 0.7);

      setMatrix(cx, -cy, style.z, angle, trailLen, style.trailWidth);
      bulletInstances.trails.setMatrixAt(instanceCount, dummy.matrix);
      bulletInstances.trails.setColorAt(instanceCount, colorObj.set(style.trailColor));

      setMatrix(x, -y, style.z + 0.01, angle, coreLen, style.coreWidth);
      bulletInstances.cores.setMatrixAt(instanceCount, dummy.matrix);
      bulletInstances.cores.setColorAt(instanceCount, colorObj.set(style.color));

      setMatrix(x, -y, style.z + 0.02, 0, style.headScale, style.headScale);
      bulletInstances.heads.setMatrixAt(instanceCount, dummy.matrix);
      bulletInstances.heads.setColorAt(instanceCount, colorObj.set(style.color));

      if (style.ionArcs && arcInstanceCount + 1 < BULLET_MAX_INSTANCES * 2) {
        const pulse = 0.55 + Math.sin(timeSec * 36.0 + x * 0.02 + y * 0.01) * 0.25;
        const arcLen = 5.5 + pulse * 3.5;
        const arcWidth = 0.6 + pulse * 0.8;
        const jitterX = Math.sin(timeSec * 41.0 + x * 0.03) * 0.6;
        const jitterY = Math.cos(timeSec * 38.0 + y * 0.03) * 0.6;

        setMatrix(x + jitterX, -y + jitterY, style.z + 0.04, angle + Math.PI * 0.5, arcLen, arcWidth);
        bulletInstances.arcs.setMatrixAt(arcInstanceCount, dummy.matrix);
        bulletInstances.arcs.setColorAt(arcInstanceCount, colorObj.set(0x9bf5ff));
        arcInstanceCount++;

        setMatrix(x - jitterX, -y - jitterY, style.z + 0.04, angle - Math.PI * 0.5, arcLen * 0.75, arcWidth * 0.75);
        bulletInstances.arcs.setMatrixAt(arcInstanceCount, dummy.matrix);
        bulletInstances.arcs.setColorAt(arcInstanceCount, colorObj.set(0x9bf5ff));
        arcInstanceCount++;
      }

      instanceCount++;
    }

    bulletInstances.trails.count = instanceCount;
    bulletInstances.cores.count = instanceCount;
    bulletInstances.heads.count = instanceCount;
    bulletInstances.arcs.count = arcInstanceCount;

    bulletInstances.trails.instanceMatrix.needsUpdate = true;
    bulletInstances.cores.instanceMatrix.needsUpdate = true;
    bulletInstances.heads.instanceMatrix.needsUpdate = true;
    bulletInstances.arcs.instanceMatrix.needsUpdate = true;

    if (bulletInstances.trails.instanceColor) bulletInstances.trails.instanceColor.needsUpdate = true;
    if (bulletInstances.cores.instanceColor) bulletInstances.cores.instanceColor.needsUpdate = true;
    if (bulletInstances.heads.instanceColor) bulletInstances.heads.instanceColor.needsUpdate = true;
    if (bulletInstances.arcs.instanceColor) bulletInstances.arcs.instanceColor.needsUpdate = true;
  },

  disposeEntity(entity) {
    const container = this.containers.get(entity);
    if (!container) return;
    clearWeaponMeshes(container);
    if (container.parent) container.parent.remove(container);
    this.containers.delete(entity);
  },

  disposeAll() {
    for (const [entity] of this.containers) {
      this.disposeEntity(entity);
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
    this._shotListener = null;
    this._shotListenerBound = false;
  }
};
