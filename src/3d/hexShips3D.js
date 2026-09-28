import * as THREE from 'three';
import { refreshHexBodyCache, DestructorSystem, isPackedShardBoundary, DESTRUCTOR_CONFIG, shardHeatNow } from '../game/destructor.js';
import { Core3D } from './core3d.js';
import { EngineVfxSystem } from './engineVfxSystem.js';
import { WeaponFx } from './weapons/weaponFx.js';
import { Fx3D } from './fxParticles3D.js';
import { MainExhaust3D } from './mainExhaust3D.js';
import { WarpPlume3D } from './warpPlume3D.js';
import { Turret2D } from '../vfx/turret2D.js';
import {
  MAX_SHADER_SHIP_LIGHTS,
  buildCombinedShipLightShaderPayload,
  buildNavLightClusters,
  buildPositionLightWorldSprites,
  buildRoadLightWorldEmitters,
  buildShipLightShaderPayload,
  computeRoadEmitterReach,
  createRoadEmitterReach,
  hasEntityLightSource,
  roadEmittersMayReach
} from '../game/shipLightRuntime.js';
import { ShipLights3D } from './shipLights3D.js';
import { allowsSolidArmorLod } from './hexLodPolicy.js';
import { DrawCallStats } from './drawCallStats.js';
import { HexBodyImpostorBatch, computeAverageBodyColor } from './hexBodyImpostorBatch.js';
import { prepareColdWreckImpostor, pushColdWreckImpostors } from './coldWreckImpostors.js';
import { COLD_WRECK_CONFIG } from '../game/coldWrecks.js';
import { HullLacquer, MAX_ENGINE_ZONES, computeEngineZones } from './hullLacquer.js';
import { HULL_SDF_OCCLUDER_FLOATS, HullShadowSdf, packHullShaftOccluder } from './hullShadowSdf.js';
import {
  DEBRIS_SHARED,
  HULL_EMPTY_SPRITE_TEXTURE,
  HULL_FLAT_NORMAL_TEXTURE,
  HULL_LIGHT_ZONE_OFFSET,
  HULL_SHARED,
  HullDebrisNodeMaterial,
  HullLightStore,
  HullNodeMaterial
} from './hexShips3D.tsl.js';
import { buildHullSkinTopology, writeHullSkin, writeHullSkinQuads, clearHullSkinDirty } from './beamHullSkin.js';
import { HullBodies, hullSpriteRotation } from '../game/hullBodies.js';
import { HullDebris3D } from './hullDebris3D.js';

// Materiały kadłubów (skóra belek, siatka heksów, płyta pancerza, szczątki GPU)
// są w TSL: src/3d/hexShips3D.tsl.js — graf na wariant, wartości per encja
// w material.uniforms (obiekty `{ value }` jak w ShaderMaterial), lampy statku
// i strefy dysz w buforze storage HullLightStore (slot na kadłub). Port WebGPU,
// zadanie 04: kod aktualizacji niżej pisze `material.uniforms.X.value` jak dawniej;
// wartości wspólne dla wszystkich kadłubów (czas, strojenie światła, żar) idą raz
// na klatkę do HULL_SHARED.

const state = {
  entityMeshes: new Map(),
  // Pudło kadru i zoom z ostatniego updateHexShips3D — pytanie „czy zamrożenie
  // wraku będzie widać” (isColdFreezeVisuallySafe) pada między klatkami.
  lastCull: null,
  lastCameraZoom: 1,
  dummy: new THREE.Object3D(),
  maxVisibleEntities: 18,
  midDistanceWorld: 2400,
  farDistanceWorld: 5200,
  lastTime: typeof performance !== 'undefined' ? performance.now() : 0,
  frameId: 0,
  hadRenderableLastFrame: false,
  validEntities: [],
  vfxEntities: [],
  visibleHexEntities: [],
  visibleVfxEntities: [],
  // Podzbiory visible* w PUDLE RYSOWANIA (kadr + margines) — patrz isEntityInDrawBox.
  drawHexEntities: [],
  drawVfxEntities: [],
  roadLightEmitters: [],
  // Pudło zasięgu emiterów drogowych klatki (computeRoadEmitterReach).
  roadLightReach: createRoadEmitterReach(),
  navLightClusters: [],
  worldOmniLights: [],
  navLightSprites: [],
  staleEntities: [],
  validEntitySet: new Set(),
  damageTintEnabled: true
};

const HEX_LOD = Object.freeze({ FULL: 0, HYBRID: 1, IMPOSTOR: 2 });
// Poniżej tego promienia ekranowego CIAŁA (nie heksa) wrak przestaje być
// rysowany własnym wywołaniem i wpada do wspólnego batcha smug. Dotyczy tylko
// wraków i fragmentów — żywe kadłuby mają swoją ścieżkę LOD. Histereza trzyma
// przełączenie z dala od progu, żeby nie migotało przy powolnym zoomie.
const WRECK_IMPOSTOR_PX = 15;
const WRECK_IMPOSTOR_EXIT_MUL = 1.35;
const HEX_LOD_FULL_PX = 1.25;
const HEX_LOD_IMPOSTOR_PX = 0.45;
const HEX_LOD_HYSTERESIS = 0.20;
const HEX_LOD_FADE_MS = 150;

const lodFrameStats = {
  fullBodies: 0,
  hybridBodies: 0,
  impostorBodies: 0,
  fullHexes: 0,
  hybridHexes: 0,
  totalStructuralHexes: 0,
  // Bilans cullingu. Bez tego nie da sie odpowiedziec na pytanie „czy odwrocenie
  // kamery cokolwiek zdejmuje" — reszta licznikow patrzy dopiero NA TO, co juz
  // przeszlo przez bramke. `entitiesIn` to wejscie, `culled` to odrzuty pudlem
  // widoku, `shaftCands` to kandydaci na okludery cieni (ta petla NIE uzywa
  // pudla widoku, tylko wlasnego zasiegu, wiec kamera jej nie zmniejsza).
  entitiesIn: 0,
  culled: 0,
  // W pudle rozgrzania, ale poza pudlem rysowania: mesh istnieje, nic sie nie
  // liczy i nie rysuje (patrz isEntityInDrawBox).
  warmOnly: 0,
  shaftCands: 0,
  // Kadłuby zgłoszone do passa cieni i pieczenia ich SDF w tej klatce.
  shaftHulls: 0,
  shaftBakes: 0,
  // Smugi zimnych wraków w batchu (bez meshy, patrz coldWreckImpostors.js).
  coldImpostors: 0
};

// Bufor okludera jednego kadłuba (packHullShaftOccluder -> pushShaftHullSdf).
const shaftOccluderScratch = new Float32Array(HULL_SDF_OCCLUDER_FLOATS);

const drawPerfScratch = {
  coreCallMs: 0,
  coreRenderMs: 0,
  composerMs: 0,
  blitMs: 0
};

const SHIP_LIGHT_DEFAULTS = Object.freeze({
  terminatorStart: -0.08,
  terminatorEnd: 0.20,
  nightMin: 0.10,
  nightBandStart: -0.25,
  nightBandEnd: 0.02,
  nightTintR: 0.015,
  nightTintG: 0.025,
  nightTintB: 0.045,
  dayAmbient: 0.24,
  dayDiffuseMul: 1.18,
  specularMul: 0.30
});

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function getShipLightTuning() {
  if (typeof window === 'undefined') return SHIP_LIGHT_DEFAULTS;
  if (!window.__shipLightTune) window.__shipLightTune = { ...SHIP_LIGHT_DEFAULTS };
  return window.__shipLightTune;
}

// Tune-epoch: globalne wartości tuningu zmieniają się rzadko (panel debug),
// więc zamiast pisać 9 uniformów per statek per klatkę, sprawdzamy raz
// na klatkę czy się zmieniły i propagujemy do meshy tylko gdy trzeba.
let _tuneEpoch = 0;
const _tuneSnapshot = {
  terminatorStart: NaN,
  terminatorEnd: NaN,
  nightMin: NaN,
  nightBandStart: NaN,
  nightBandEnd: NaN,
  nightTintR: NaN,
  nightTintG: NaN,
  nightTintB: NaN,
  dayAmbient: NaN,
  dayDiffuseMul: NaN,
  specularMul: NaN
};
function refreshTuneEpoch() {
  const t = getShipLightTuning();
  if (
    t.terminatorStart !== _tuneSnapshot.terminatorStart ||
    t.terminatorEnd !== _tuneSnapshot.terminatorEnd ||
    t.nightMin !== _tuneSnapshot.nightMin ||
    t.nightBandStart !== _tuneSnapshot.nightBandStart ||
    t.nightBandEnd !== _tuneSnapshot.nightBandEnd ||
    t.nightTintR !== _tuneSnapshot.nightTintR ||
    t.nightTintG !== _tuneSnapshot.nightTintG ||
    t.nightTintB !== _tuneSnapshot.nightTintB ||
    t.dayAmbient !== _tuneSnapshot.dayAmbient ||
    t.dayDiffuseMul !== _tuneSnapshot.dayDiffuseMul ||
    t.specularMul !== _tuneSnapshot.specularMul
  ) {
    _tuneSnapshot.terminatorStart = t.terminatorStart;
    _tuneSnapshot.terminatorEnd = t.terminatorEnd;
    _tuneSnapshot.nightMin = t.nightMin;
    _tuneSnapshot.nightBandStart = t.nightBandStart;
    _tuneSnapshot.nightBandEnd = t.nightBandEnd;
    _tuneSnapshot.nightTintR = t.nightTintR;
    _tuneSnapshot.nightTintG = t.nightTintG;
    _tuneSnapshot.nightTintB = t.nightTintB;
    _tuneSnapshot.dayAmbient = t.dayAmbient;
    _tuneSnapshot.dayDiffuseMul = t.dayDiffuseMul;
    _tuneSnapshot.specularMul = t.specularMul;
    _tuneEpoch++;
  }
  return t;
}

function ensureShipLightPanelApi() { }

function getEntityPosX(entity) { return entity?.pos ? entity.pos.x : entity?.x || 0; }
function getEntityPosY(entity) { return entity?.pos ? entity.pos.y : entity?.y || 0; }
function getEntityScaleX(entity) {
  if (entity?.visual && typeof entity.visual.spriteScaleX === 'number') return entity.visual.spriteScaleX;
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

function getEntityScaleY(entity) {
  if (entity?.visual && typeof entity.visual.spriteScaleY === 'number') return entity.visual.spriteScaleY;
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

function getEntityScale(entity) {
  return Math.max(getEntityScaleX(entity), getEntityScaleY(entity));
}

function usesBillboardLighting(entity) {
  return entity?.isAsteroidHex === true || entity?.visual?.preserveBillboardLighting === true;
}

function usesBillboardOrientation(entity) {
  return entity?.isAsteroidHex === true || entity?.visual?.preserveBillboardOrientation === true;
}

function isEntityInCull(entity, cull) {
  if (!cull) return true;
  const x = getEntityPosX(entity);
  const y = getEntityPosY(entity);
  const r = Math.max(140, Number(entity?.radius) || Number(entity?.r) || 140);
  return (
    Math.abs(x - cull.x) <= cull.halfW + r &&
    Math.abs(y - cull.y) <= cull.halfH + r
  );
}

// Pudło RYSOWANIA. Pudło z index.html (cull.halfW/halfH = 3× połowa widoku,
// czyli 9 ekranów) zostaje pudłem ROZGRZANIA: mesh powstaje zawczasu, emitery
// świateł drogowych i dysze trzymają ciągłość. Pełna aktualizacja mesha
// (instancje, LOD, lampy, uniformy), draw call, billboardy świateł i wieżyczki
// 2D idą tylko dla encji, które mogą być na ekranie — meshe kadłubów mają
// frustumCulled=false, więc bez tego ~8/9 wywołań trafiało poza kadr.
// Promień z wymiarów sprite'a × skala (entity.radius wraków jest w jednostkach
// siatki), plus pivot i stały margines ekranowy na dryf/deformację.
// Bez cull.drawHalfW (np. lot po mieście) — dawne zachowanie: rysuj całe pudło.
const DRAW_BOX_MARGIN_PX = 96;

function isEntityInDrawBox(entity, cull, cameraZoom) {
  if (!cull || !Number.isFinite(cull.drawHalfW) || !Number.isFinite(cull.drawHalfH)) return true;
  const x = getEntityPosX(entity);
  const y = getEntityPosY(entity);
  // Kadłub na belkach niesie te same wymiary sprite'a i pivot co siatka heksów.
  const grid = entity?.hexGrid || entity?.beamHull;
  let r;
  if (grid) {
    const sx = Math.abs(getEntityScaleX(entity)) || 1;
    const sy = Math.abs(getEntityScaleY(entity)) || 1;
    const pivotX = (Number(grid.pivot?.x) || 0) * sx;
    const pivotY = (Number(grid.pivot?.y) || 0) * sy;
    r = Math.hypot((Number(grid.srcWidth) || 0) * sx, (Number(grid.srcHeight) || 0) * sy) * 0.5
      + Math.hypot(pivotX, pivotY);
  } else {
    r = Math.max(140, Number(entity?.radius) || Number(entity?.r) || 140);
  }
  r += DRAW_BOX_MARGIN_PX / Math.max(0.0001, cameraZoom);
  return (
    Math.abs(x - cull.x) <= cull.drawHalfW + r &&
    Math.abs(y - cull.y) <= cull.drawHalfH + r
  );
}

function getInterpolatedRenderPose(entity) {
  if (typeof window === 'undefined') return null;
  if (!window.ship || entity !== window.ship) return null;
  const pose = window.__interpShipPose;
  if (!pose) return null;
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.angle)) return null;
  return pose;
}

// Rzeczywisty zasięg AKTYWNYCH heksów w układzie lokalnym mesha (piksele
// sprite'a, względem pivota — jak translacje instancji). Fragment dziedziczy
// srcWidth/srcHeight rodzica (musi: próbkuje jego teksturę), więc rozmiar
// liczony z src dawał promień CAŁEGO kadłuba: fragmenty dużych okrętów nigdy
// nie wchodziły do batcha smug, te z małych rysowały smugę wielkości statku,
// a przy selekcji cieni drobnica wypychała żywe okręty z 12 slotów.
// Cache na siatce: po meshRevision, a przy deformacji najwyżej co 250 ms.
const ACTIVE_EXTENT_REFRESH_MS = 250;

function getGridActiveExtent(grid, nowMs) {
  const shards = grid?.shards;
  let ext = grid.__activeExtent;
  if (!ext) {
    ext = grid.__activeExtent = { rev: -1, shardsRef: null, at: -Infinity, halfW: 0, halfH: 0, cx: 0, cy: 0 };
  }
  const rev = Number(grid.meshRevision) || 0;
  if (ext.shardsRef === shards && (ext.rev === rev || nowMs - ext.at < ACTIVE_EXTENT_REFRESH_MS)) return ext;

  const pivotX = Number(grid?.pivot?.x) || 0;
  const pivotY = Number(grid?.pivot?.y) || 0;
  const offX = (Number(grid.srcWidth) || 0) * 0.5 + pivotX;
  const offY = (Number(grid.srcHeight) || 0) * 0.5 + pivotY;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  if (Array.isArray(shards)) {
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      if (!s || !s.active || s.isDebris) continue;
      const x = (Number(s.gridX) || 0) - offX;
      const y = (Number(s.gridY) || 0) - offY;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) {
    // Brak aktywnych heksów — zachowawczo cały sprite (środek = -pivot).
    ext.halfW = (Number(grid.srcWidth) || 0) * 0.5;
    ext.halfH = (Number(grid.srcHeight) || 0) * 0.5;
    ext.cx = -pivotX;
    ext.cy = -pivotY;
  } else {
    const pad = Math.max(2, Number(shards[0]?.radius) || 20);
    ext.halfW = (maxX - minX) * 0.5 + pad;
    ext.halfH = (maxY - minY) * 0.5 + pad;
    ext.cx = (minX + maxX) * 0.5;
    ext.cy = (minY + maxY) * 0.5;
  }
  ext.rev = rev;
  ext.shardsRef = shards;
  ext.at = nowMs;
  return ext;
}

function getEntityLightPosition(entity) {
  const interpPose = getInterpolatedRenderPose(entity);
  return {
    x: interpPose ? interpPose.x : getEntityPosX(entity),
    y: interpPose ? interpPose.y : getEntityPosY(entity)
  };
}

function getEntityLightAngle(entity) {
  const interpPose = getInterpolatedRenderPose(entity);
  const baseAngle = interpPose ? interpPose.angle : (Number(entity?.angle) || 0);
  return baseAngle + (Number(entity?.capitalProfile?.spriteRotation) || 0);
}

const SHIP_LIGHT_TRANSFORM_OPTIONS = {
  getPosition: getEntityLightPosition,
  getAngle: getEntityLightAngle,
  getSpriteScaleX: getEntityScaleX,
  getSpriteScaleY: getEntityScaleY
};

// 128: reflektory otoczenia (rufa + burty) dokładają do 5 emiterów na okręt.
const SHIP_LIGHT_EMITTER_OPTIONS = {
  ...SHIP_LIGHT_TRANSFORM_OPTIONS,
  maxEmitters: 128,
  out: null
};

// Grupy lamp pozycyjnych (rozlew czerwieni na inne kadłuby) i payload kadłuba
// z nimi — `externalOmniLights` ustawiane co klatkę na state.navLightClusters.
const NAV_CLUSTER_OPTIONS = {
  ...SHIP_LIGHT_TRANSFORM_OPTIONS,
  getGrid: (entity) => entity?.hexGrid || entity?.beamHull,
  out: null,
  time: 0,
  maxClusters: 256
};
const SHIP_LIGHT_PAYLOAD_OPTIONS = {
  ...SHIP_LIGHT_TRANSFORM_OPTIONS,
  externalOmniLights: null
};

const NAV_LIGHT_SPRITE_OPTIONS = {
  ...SHIP_LIGHT_TRANSFORM_OPTIONS,
  getGrid: (entity) => entity?.hexGrid || entity?.beamHull,
  out: null,
  zoom: 1,
  minHaloWorld: 0
};

function computeShardStress(shard) {
  if (shard && shard.deformation) {
    const def = shard.deformation;
    const target = shard.targetDeformation || def;
    const sx = (Number(target.x) || 0) - (Number(def.x) || 0);
    const sy = (Number(target.y) || 0) - (Number(def.y) || 0);
    const absX = sx < 0 ? -sx : sx;
    const absY = sy < 0 ? -sy : sy;
    const defStress = absX > absY ? absX + absY * 0.4 : absY + absX * 0.4;
    const velX = Math.abs(Number(shard.__velX) || 0) + Math.abs(Number(shard.__collVelX) || 0);
    const velY = Math.abs(Number(shard.__velY) || 0) + Math.abs(Number(shard.__collVelY) || 0);
    const velStress = (velX > velY ? velX + velY * 0.4 : velY + velX * 0.4) * 0.18;
    return defStress > velStress ? defStress : velStress;
  }
  return 0;
}

function isLegacyBoundaryShard(shard) {
  const neighbors = shard?.neighbors;
  if (!Array.isArray(neighbors) || neighbors.length < 6) return true;
  for (let index = 0; index < 6; index++) {
    const neighbor = neighbors[index];
    if (!neighbor || !neighbor.active || neighbor.isDebris || neighbor.hp <= 0) return true;
  }
  return false;
}

function shouldRenderHybridShard(shard, nowSec = 0) {
  if (!shard?.active || shard.isDebris || shard.hp <= 0) return false;
  if (isPackedShardBoundary(shard) || isLegacyBoundaryShard(shard)) return true;
  if (Number(shard.hp) < (Number(shard.maxHp) || Number(shard.hp)) * 0.995) return true;
  const deform = shard.deformation;
  const target = shard.targetDeformation;
  if (Math.abs(Number(deform?.x) || 0) + Math.abs(Number(deform?.y) || 0) > 0.08) return true;
  if (Math.abs(Number(target?.x) || 0) + Math.abs(Number(target?.y) || 0) > 0.08) return true;
  // Rozżarzony heks WNĘTRZA musi zostać w instancjach, inaczej w trybie HYBRID
  // żar znika pod płytą pancerza — a płyta nie ma jak go pokazać (vHeat = 0).
  if (shardHeatNow(shard, nowSec) > 0.03) return true;
  return computeShardStress(shard) > 0.08;
}

function resolveHexLod(data, screenRadiusPx, now, solidArmorAllowed = true) {
  // A split body still samples the original sprite in each individual hex.
  // Its solid armor plane, however, contains the entire parent sprite. Never
  // let that plane fade in for wrecks/fragments: it produced the visible loop
  // "whole ship -> fragments -> whole ship" around the LOD thresholds.
  if (!solidArmorAllowed) {
    if (data.lodMode !== HEX_LOD.FULL || data.instanceLodMode !== HEX_LOD.FULL) {
      data.needsInstanceRefresh = true;
    }
    data.lodMode = HEX_LOD.FULL;
    data.instanceLodMode = HEX_LOD.FULL;
    data.lodFadeStart = now;
    data.lodFromHexOpacity = 1;
    data.lodFromArmorOpacity = 0;
    data.hexOpacity = 1;
    data.armorOpacity = 0;
    data.mesh.material.uniforms.uLodOpacity.value = 1;
    data.armorMesh.material.uniforms.uLodOpacity.value = 0;
    data.mesh.visible = true;
    data.armorMesh.visible = false;
    return;
  }

  const current = data.lodMode;
  let desired = current;
  const h = HEX_LOD_HYSTERESIS;

  if (current === HEX_LOD.FULL) {
    if (screenRadiusPx < HEX_LOD_FULL_PX * (1 - h)) desired = HEX_LOD.HYBRID;
  } else if (current === HEX_LOD.HYBRID) {
    if (screenRadiusPx > HEX_LOD_FULL_PX * (1 + h)) desired = HEX_LOD.FULL;
    else if (screenRadiusPx < HEX_LOD_IMPOSTOR_PX * (1 - h)) desired = HEX_LOD.IMPOSTOR;
  } else if (screenRadiusPx > HEX_LOD_IMPOSTOR_PX * (1 + h)) {
    desired = HEX_LOD.HYBRID;
  }

  if (desired !== current) {
    data.lodMode = desired;
    data.lodFadeStart = now;
    data.lodFromHexOpacity = data.hexOpacity;
    data.lodFromArmorOpacity = data.armorOpacity;
    // Upgrades may reveal detailed geometry immediately at zero opacity.  During
    // downgrades keep the old geometry until the armor has faded in, avoiding a
    // one-frame hole where the interior disappears.
    if (desired < current || current === HEX_LOD.IMPOSTOR) {
      data.instanceLodMode = desired;
      data.needsInstanceRefresh = true;
    }
  }

  const elapsed = Math.max(0, now - data.lodFadeStart);
  const t = Math.min(1, elapsed / HEX_LOD_FADE_MS);
  const smooth = t * t * (3 - 2 * t);
  const targetHex = data.lodMode === HEX_LOD.IMPOSTOR ? 0 : 1;
  const targetArmor = data.lodMode === HEX_LOD.FULL ? 0 : 1;
  data.hexOpacity = data.lodFromHexOpacity + (targetHex - data.lodFromHexOpacity) * smooth;
  data.armorOpacity = data.lodFromArmorOpacity + (targetArmor - data.lodFromArmorOpacity) * smooth;
  if (t >= 1 && data.instanceLodMode !== data.lodMode) {
    data.instanceLodMode = data.lodMode;
    data.needsInstanceRefresh = true;
  }
  data.mesh.material.uniforms.uLodOpacity.value = data.hexOpacity;
  data.armorMesh.material.uniforms.uLodOpacity.value = data.armorOpacity;
  data.mesh.visible = data.lodMode !== HEX_LOD.IMPOSTOR || data.hexOpacity > 0.001;
  data.armorMesh.visible = data.armorOpacity > 0.001;
}

function setAttrUpdateRange(attr, start, count) {
  if (!attr) return;
  if (typeof attr.clearUpdateRanges === 'function') {
    attr.clearUpdateRanges();
    if (typeof attr.addUpdateRange === 'function' && Number.isFinite(count) && count > 0) {
      attr.addUpdateRange(start, count);
    }
    return;
  }
  if (!attr.updateRange) attr.updateRange = { offset: 0, count: -1 };
  attr.updateRange.offset = start;
  attr.updateRange.count = count;
}

function createManagedTexture(source, isLinearData = false) {
  if (!source) return null;
  const isCanvas =
    (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas);
  const texture = isCanvas ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  // WebGPU (jak dawniej WebGL2) ma mipmapy także dla tekstur NPOT (sprite'y
  // kadłubów), więc zawsze trilinear + anizotropia do 4.
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.max(1, Math.min(4, Core3D.getMaxAnisotropy() || 1));
  texture.colorSpace = isLinearData ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const sharedVisualTextures = new WeakMap();

function acquireSharedVisualTexture(source) {
  let entry = sharedVisualTextures.get(source);
  if (!entry) {
    entry = { texture: createManagedTexture(source), refs: 0 };
    sharedVisualTextures.set(source, entry);
  }
  entry.refs++;
  return entry.texture;
}

function releaseSharedVisualTexture(source) {
  if (!source) return;
  const entry = sharedVisualTextures.get(source);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.texture?.dispose?.();
    sharedVisualTextures.delete(source);
  }
}

// Lekkie batche kadłubów (shipProxyBatch3D.js): TA SAMA tekstura co kadłub pełnego
// NPC z tego obrazka (licznik referencji) i to samo strojenie światła statków.
export function acquireHullVisualTexture(image) {
  return image ? acquireSharedVisualTexture(image) : null;
}
export function releaseHullVisualTexture(image) {
  releaseSharedVisualTexture(image);
}
export function getHullLightTuning() {
  return getShipLightTuning();
}

// Slot kadłuba w buforze lamp i stref dysz (HullLightStore, hexShips3D.tsl.js).
// Potrzebny tylko, gdy są lampy albo strefy — zwalniany przy zerze obu i przy
// zwolnieniu mesha. Pula pełna: kadłub rysuje się bez lamp i stref (liczniki 0),
// a zapis ponawia się w kolejnej klatce (podpis lamp / strefy nie są zapamiętane).
function ensureHullLightSlot(data) {
  if (data.lightSlot >= 0) return true;
  const slot = HullLightStore.acquire();
  if (slot < 0) return false;
  data.lightSlot = slot;
  data.mesh.material.uniforms.uLightBase.value = slot * HullLightStore.slotVec4;
  return true;
}

function releaseHullLightSlotIfUnused(data) {
  const uniforms = data?.mesh?.material?.uniforms;
  if (!(data?.lightSlot >= 0) || !uniforms) return;
  if (uniforms.uShipLightCount.value > 0 || uniforms.uEngineZoneCount.value > 0) return;
  HullLightStore.release(data.lightSlot);
  data.lightSlot = -1;
  uniforms.uLightBase.value = 0;
}

// Lakier nie dotyczy pierścienia ani asteroid (te wychodzą z shadera wcześniej).
function allowsHullLacquer(entity) {
  return entity?.isRingSegment !== true && !usesBillboardLighting(entity);
}

// Lakier per encja: waga, wygaszanie odblasku po rozmiarze kadłuba na ekranie
// (flota z daleka to nie brokat) i strefy dysz. Strefy przeliczamy tylko przy
// zmianie układu silników albo wymiarów siatki — jak sygnatura świateł.
function syncEntityLacquer(entity, data, grid, entityScale, zoomPx) {
  const uniforms = data.mesh.material.uniforms;
  if (!uniforms.uLacquerWeight) return;
  const tune = HullLacquer.getTuning();

  let weight = allowsHullLacquer(entity) ? 1 : 0;
  if (weight > 0 && (entity.isWreck === true || grid.isFragment === true)) {
    weight = clamp(tune.wreckMul, 0, 1);
  }
  uniforms.uLacquerWeight.value = weight;

  const bodyRadiusPx = Math.max(data.srcWidth, data.srcHeight) * 0.5 * entityScale * zoomPx;
  const glintMin = clamp(tune.glintMinPx, 0, 10000);
  const glintFull = Math.max(glintMin + 1, clamp(tune.glintFullPx, 0, 10000));
  const g = clamp((bodyRadiusPx - glintMin) / (glintFull - glintMin), 0, 1);
  uniforms.uLacquerGlint.value = g * g * (3 - 2 * g);

  const main = entity.visual?.mainThrusters || null;
  const side = entity.visual?.torqueThrusters || null;
  // NaN z ręcznie podmienionego tuningu nie może psuć porównania (przeliczanie co klatkę).
  const zoneMulRaw = Number(tune.engineZoneMul);
  const zoneMul = Number.isFinite(zoneMulRaw) ? zoneMulRaw : 1;
  if (
    data.zoneMainRef === main && data.zoneSideRef === side &&
    data.zoneSrcW === data.srcWidth && data.zoneSrcH === data.srcHeight &&
    data.zonePivotX === data.pivotX && data.zonePivotY === data.pivotY &&
    data.zoneMul === zoneMul
  ) return;
  const zones = computeEngineZones(main, side, grid, tune);
  const zoneCount = Math.min(MAX_ENGINE_ZONES, zones.length);
  if (zoneCount > 0 && !ensureHullLightSlot(data)) {
    // Pula pełna: bez stref (lakier także na dyszach) — ponowna próba w następnej klatce.
    uniforms.uEngineZoneCount.value = 0;
    return;
  }
  // Strefy w slocie kadłuba (od HULL_LIGHT_ZONE_OFFSET); shader czyta je tylko do
  // uEngineZoneCount, więc zapis i wysyłka dotyczą samych zmienionych stref.
  if (zoneCount > 0) {
    const arr = HullLightStore.array();
    const base = HullLightStore.slotFloatOffset(data.lightSlot) + HULL_LIGHT_ZONE_OFFSET * 4;
    for (let i = 0; i < zoneCount; i++) {
      const zone = zones[i];
      const o = base + i * 4;
      arr[o] = zone.x; arr[o + 1] = zone.y; arr[o + 2] = zone.r; arr[o + 3] = 0;
    }
    HullLightStore.markDirty(data.lightSlot, HULL_LIGHT_ZONE_OFFSET, zoneCount);
  }
  uniforms.uEngineZoneCount.value = zoneCount;
  if (zoneCount === 0) releaseHullLightSlotIfUnused(data);
  data.zoneMainRef = main;
  data.zoneSideRef = side;
  data.zoneSrcW = data.srcWidth;
  data.zoneSrcH = data.srcHeight;
  data.zonePivotX = data.pivotX;
  data.zonePivotY = data.pivotY;
  data.zoneMul = zoneMul;
}

// Lampy w shaderze kadłuba: poniżej tego promienia kadłuba na ekranie są
// niewidoczne (billboardy ShipLights3D gasną już przy ~2,5 px), a payload —
// normalizacja bloku lamp, tablice i podpis-string — szedł co klatkę dla
// każdej encji w pudle cullingu.
const SHIP_LIGHT_SHADER_MIN_PX = 4;
const SHIP_LIGHTS_OFF_SIGNATURE = '__lights_off__';

// Pudło zasięgu emiterów poszerzone o grupy lamp pozycyjnych (koło zasięgu).
function extendReachWithOmniLights(reach, lights) {
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    const r = Math.max(1, Number(l.rangeWorld) || 1);
    if (reach.count === 0) {
      reach.minX = Infinity; reach.maxX = -Infinity; reach.minY = Infinity; reach.maxY = -Infinity;
    }
    if (l.x - r < reach.minX) reach.minX = l.x - r;
    if (l.x + r > reach.maxX) reach.maxX = l.x + r;
    if (l.y - r < reach.minY) reach.minY = l.y - r;
    if (l.y + r > reach.maxY) reach.maxY = l.y + r;
    reach.count++;
  }
  return reach;
}

function syncEntityLightUniforms(entity, data, grid, externalRoadLights = null, bodyRadiusPx = Infinity) {
  const uniforms = data?.mesh?.material?.uniforms;
  if (!uniforms?.uShipLightCount) return;

  // Emitery drogowe liczą się tylko, gdy któryś może sięgnąć pudła encji —
  // dawniej jeden emiter gdziekolwiek w pudle rozgrzania (np. reflektory gracza)
  // wymuszał pełny payload z pętlą po emiterach dla KAŻDEGO kadłuba i wraku.
  const hasExternalRoadLights = ((Array.isArray(externalRoadLights) && externalRoadLights.length > 0)
      || state.navLightClusters.length > 0)
    && bodyRadiusPx >= SHIP_LIGHT_SHADER_MIN_PX
    && roadEmittersMayReach(state.roadLightReach, entity, grid, SHIP_LIGHT_TRANSFORM_OPTIONS);
  if (bodyRadiusPx < SHIP_LIGHT_SHADER_MIN_PX || (!hasExternalRoadLights && !hasEntityLightSource(entity))) {
    if (data.lightSignature !== SHIP_LIGHTS_OFF_SIGNATURE) {
      uniforms.uShipLightCount.value = 0;
      releaseHullLightSlotIfUnused(data);
      data.lightSignature = SHIP_LIGHTS_OFF_SIGNATURE;
    }
    return;
  }

  SHIP_LIGHT_PAYLOAD_OPTIONS.externalOmniLights = state.navLightClusters;
  const payload = hasExternalRoadLights
    ? buildCombinedShipLightShaderPayload(entity, grid, externalRoadLights, SHIP_LIGHT_PAYLOAD_OPTIONS)
    : buildShipLightShaderPayload(entity, grid, MAX_SHADER_SHIP_LIGHTS);
  if (payload.signature === data.lightSignature) return;

  // Lampy w slocie kadłuba (HullLightStore): 3 vec4 na lampę, tylko `count`
  // pierwszych (pętla w shaderze kończy się na uShipLightCount) — wysyłka na GPU
  // raz, przy zmianie podpisu, nie przy każdym rysowaniu.
  const count = Math.min(MAX_SHADER_SHIP_LIGHTS, payload.count | 0);
  if (count > 0 && !ensureHullLightSlot(data)) {
    uniforms.uShipLightCount.value = 0;
    data.lightSignature = null; // pula pełna — ponowna próba w następnej klatce
    return;
  }
  if (count > 0) {
    const arr = HullLightStore.array();
    const base = HullLightStore.slotFloatOffset(data.lightSlot);
    for (let i = 0; i < count; i++) {
      const o = base + i * 12;
      const light = payload.lights[i];
      if (!light) {
        arr[o] = 0; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
        arr[o + 4] = 0; arr[o + 5] = 0; arr[o + 6] = 0; arr[o + 7] = 0;
        arr[o + 8] = 0; arr[o + 9] = -1; arr[o + 10] = 0; arr[o + 11] = 0;
        continue;
      }
      const coneRad = Math.max(1, Math.min(179, Number(light.coneDeg) || 40)) * Math.PI / 360;
      // Dane: pozycja w pikselach sprite'a, promień, moc.
      arr[o] = light.pos.x; arr[o + 1] = light.pos.y; arr[o + 2] = light.radiusPx; arr[o + 3] = light.power;
      // Barwa i typ w shaderze: 0 lampa pozycyjna, 1 reflektor dziobu (też zewnętrzny),
      // 2 rozlew grupy lamp innego statku (bez rdzenia), 3 reflektor otoczenia
      // (własny: sama lampa; innego statku: stożek z zanikiem z odległością).
      arr[o + 4] = light.color.r;
      arr[o + 5] = light.color.g;
      arr[o + 6] = light.color.b;
      arr[o + 7] = light.kind === 'omni' ? 2 : light.kind === 'flood' ? 3 : light.kind === 'road' ? 1 : 0;
      // Własny reflektor otoczenia świeci NA ZEWNĄTRZ: stożek na własnym
      // pancerzu malował białe kliny na płetwach (zostaje lampa: rdzeń + poświata).
      const ownFlood = light.kind === 'flood' && !light.external;
      arr[o + 8] = Number(light.dir?.x) || 0;
      arr[o + 9] = Number(light.dir?.y) || -1;
      arr[o + 10] = ownFlood ? 0 : (Number(light.rangePx) || 0);
      arr[o + 11] = Math.cos(coneRad);
    }
    HullLightStore.markDirty(data.lightSlot, 0, count * 3);
  }
  uniforms.uShipLightCount.value = count;
  if (count === 0) releaseHullLightSlotIfUnused(data);

  data.lightSignature = payload.signature;
}

function disposeMeshData(data) {
  if (!data) return;
  if (Core3D.scene && data.mesh) {
    Core3D.scene.remove(data.mesh);
  }
  if (Core3D.scene && data.armorMesh) {
    Core3D.scene.remove(data.armorMesh);
  }
  data.mesh?.geometry?.dispose?.();
  data.mesh?.material?.dispose?.();
  data.armorMesh?.geometry?.dispose?.();
  data.armorMesh?.material?.dispose?.();
  if (data.visualImageRef) releaseSharedVisualTexture(data.visualImageRef);
  else data.texture?.dispose?.();
  data.normalTexture?.dispose?.();
  if (data.shapeImageRef) HullLacquer.releaseShapeUniform(data.shapeImageRef);
  if (data.lightSlot >= 0) {
    HullLightStore.release(data.lightSlot);
    data.lightSlot = -1;
  }
}

const GPU_DEBRIS_MAX = 10000;

class GpuDebrisPool {
  constructor(gridRef) {
    this.textureKey = gridRef.armorImage;
    this.currentIndex = 0;
    // Dirty-span spawnów między klatkami. Poprzednio każdy spawn robił
    // clearUpdateRanges() — przy wielu odłamkach w jednej klatce na GPU
    // trafiał tylko zakres OSTATNIEGO spawnu (reszta miała stare atrybuty).
    this._dirtyMin = Infinity;
    this._dirtyMax = -1;
    this._dirtyWrapped = false;
    this.lastExpiryTime = -Infinity;
    this.geometry = new THREE.CircleGeometry(25, 6);

    this.startPosArray = new Float32Array(GPU_DEBRIS_MAX * 2);
    this.startVelArray = new Float32Array(GPU_DEBRIS_MAX * 2);
    this.rotationArray = new Float32Array(GPU_DEBRIS_MAX * 3);
    this.timeArray = new Float32Array(GPU_DEBRIS_MAX * 2);
    this.gridPosArray = new Float32Array(GPU_DEBRIS_MAX * 2);
    this.heatArray = new Float32Array(GPU_DEBRIS_MAX);

    this.geometry.setAttribute('aStartPos', new THREE.InstancedBufferAttribute(this.startPosArray, 2));
    this.geometry.setAttribute('aStartVel', new THREE.InstancedBufferAttribute(this.startVelArray, 2));
    this.geometry.setAttribute('aRotationData', new THREE.InstancedBufferAttribute(this.rotationArray, 3));
    this.geometry.setAttribute('aTimeData', new THREE.InstancedBufferAttribute(this.timeArray, 2));
    this.geometry.setAttribute('aGridPos', new THREE.InstancedBufferAttribute(this.gridPosArray, 2));
    this.geometry.setAttribute('aHeat', new THREE.InstancedBufferAttribute(this.heatArray, 1));

    // Materiał TSL (hexShips3D.tsl.js, graf wspólny dla pul): wartości puli
    // w `uniforms`; zanik i siła żaru wspólne (DEBRIS_SHARED, updateTime).
    // Przezroczysty, bez głębi, DoubleSide w jednym przejściu.
    this.material = new HullDebrisNodeMaterial({
      uSprite: { value: createManagedTexture(gridRef.armorImage) },
      uSpriteSize: { value: new THREE.Vector2(gridRef.srcWidth || 1, gridRef.srcHeight || 1) },
      uTime: { value: 0 },
      uLightDir: { value: new THREE.Vector3(0, 0, 1) },
      uDayAmbient: { value: SHIP_LIGHT_DEFAULTS.dayAmbient },
      uDayDiffuseMul: { value: SHIP_LIGHT_DEFAULTS.dayDiffuseMul }
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, GPU_DEBRIS_MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    Core3D.scene.add(this.mesh);
  }

  spawn(shard, worldX, worldY, vx, vy, angVel, startAngle, scale, globalTime) {
    const i = this.currentIndex;

    this.startPosArray[i * 2] = worldX;
    this.startPosArray[i * 2 + 1] = worldY;
    this.startVelArray[i * 2] = vx;
    this.startVelArray[i * 2 + 1] = vy;

    this.rotationArray[i * 3] = startAngle;
    this.rotationArray[i * 3 + 1] = angVel;
    this.rotationArray[i * 3 + 2] = scale * ((shard.radius || 20) / 25.0);

    const worldRadius = Math.max(0, (shard.radius || 5) * scale);
    const lifetime = 5 + 7 * Math.min(1, Math.max(0, (worldRadius - 5) / 15));
    this.timeArray[i * 2] = globalTime;
    this.timeArray[i * 2 + 1] = lifetime;

    // UV odłamka z pozycji siatki bez deformacji — poza spritem shader go odrzuci.
    this.gridPosArray[i * 2] = shard.origGridX ?? shard.gridX ?? 0;
    this.gridPosArray[i * 2 + 1] = shard.origGridY ?? shard.gridY ?? 0;

    // Żar zabrany z kadłuba, wyliczony na moment oderwania (ta sama formuła co
    // shardHeatNow w destructorze). PODŁOGA: metal urwany rozciąganiem przez
    // solver GPU nie przeszedł przez strefę zgniotu i miałby zerowy żar — ma
    // się świecić słabo, ale nie wcale.
    const heatPeak = Number(shard.heat) || 0;
    const heatAge = globalTime - (Number(shard.heatStamp) || 0);
    const heatNow = heatPeak > 0 && heatAge > 0
      ? heatPeak * Math.exp(-heatAge * (Number(DESTRUCTOR_CONFIG.heatDecay) || 0.45))
      : heatPeak;
    this.heatArray[i] = Math.max(Number(DESTRUCTOR_CONFIG.debrisHeatFloor) || 0, heatNow);

    if (i < this._dirtyMin) this._dirtyMin = i;
    if (i > this._dirtyMax) this._dirtyMax = i;
    this.lastExpiryTime = Math.max(this.lastExpiryTime, globalTime + lifetime);

    this.currentIndex = (this.currentIndex + 1) % GPU_DEBRIS_MAX;
    if (this.currentIndex === 0) this._dirtyWrapped = true;
    if (this.mesh.count < GPU_DEBRIS_MAX) this.mesh.count++;
  }

  // Jeden upload zakresu na klatkę (wołany z GpuDebrisManager.updateTime).
  commit() {
    if (this._dirtyMax < this._dirtyMin && !this._dirtyWrapped) return;
    const start = this._dirtyWrapped ? 0 : this._dirtyMin;
    const count = this._dirtyWrapped ? GPU_DEBRIS_MAX : (this._dirtyMax - this._dirtyMin + 1);
    const apply = (name, stride) => {
      const attr = this.geometry.getAttribute(name);
      setAttrUpdateRange(attr, start * stride, count * stride);
      attr.needsUpdate = true;
    };
    apply('aStartPos', 2);
    apply('aStartVel', 2);
    apply('aRotationData', 3);
    apply('aTimeData', 2);
    apply('aGridPos', 2);
    apply('aHeat', 1);
    this._dirtyMin = Infinity;
    this._dirtyMax = -1;
    this._dirtyWrapped = false;
  }

  dispose() {
    if (Core3D.scene && this.mesh) Core3D.scene.remove(this.mesh);
    this.geometry?.dispose?.();
    this.material?.uniforms?.uSprite?.value?.dispose?.();
    this.material?.dispose?.();
  }
}

const GpuDebrisManager = {
  pools: new Map(),
  globalTime: 0,
  // Ustawiane z updateHexShips3D razem z uStressTint kadłubów (state.damageTintEnabled).
  heatTintEnabled: true,

  spawn(shard, gridRef, wx, wy, vx, vy, drot, angle, scale) {
    const texKey = shard.img;
    if (!texKey) return;

    let pool = this.pools.get(texKey);
    if (!pool) {
      pool = new GpuDebrisPool({
        armorImage: texKey,
        srcWidth: texKey.width || gridRef.srcWidth,
        srcHeight: texKey.height || gridRef.srcHeight
      });
      this.pools.set(texKey, pool);
    }
    pool.spawn(shard, wx, wy, vx, vy, drot, angle, scale, this.globalTime);
  },

  updateTime(time) {
    this.globalTime = time;
    // Żar odłamków respektuje ten sam przełącznik co żar kadłuba (wspólne dla pul).
    DEBRIS_SHARED.uHeatDecay.value = Math.max(0, Number(DESTRUCTOR_CONFIG.heatDecay) || 0);
    DEBRIS_SHARED.uHeatTint.value = this.heatTintEnabled
      ? Math.max(0, Number(DESTRUCTOR_CONFIG.debrisHeatGlow) || 0)
      : 0;
    const sun = typeof window !== 'undefined' ? window.SUN : null;
    const camera = typeof window !== 'undefined' ? window.camera : null;
    for (const pool of this.pools.values()) {
      pool.commit();
      // All sizes have expired; a later small chip must not truncate a big one.
      // żeby pula po długiej bitwie nie mieliła na stałe 10k martwych slotów.
      if (pool.mesh.count > 0 && time > pool.lastExpiryTime) {
        pool.mesh.count = 0;
        pool.currentIndex = 0;
      }
      pool.material.uniforms.uTime.value = time;
      if (sun && camera && pool.mesh.count > 0) {
        const dx = sun.x - camera.x;
        const dy = -(sun.y - camera.y);
        // In-place: bez alokacji Vector3 per pool per klatkę
        pool.material.uniforms.uLightDir.value.set(dx, dy, 600).normalize();
      }
    }
  },

  dispose() {
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    this.globalTime = 0;
  }
};

if (typeof window !== 'undefined') {
  window.spawnGpuDebris = (shard, grid, wx, wy, vx, vy, drot, ang, scale) => {
    GpuDebrisManager.spawn(shard, grid, wx, wy, vx, vy, drot, ang, scale);
  };
}

function updateDebrisRendering() { }

function createEntityMesh(entity) {
  if (!entity?.hexGrid || !Array.isArray(entity.hexGrid.shards)) return null;

  refreshHexBodyCache(entity);

  const grid = entity.hexGrid;
  const shards = grid.shards;
  const count = shards.length;
  if (count <= 0) return null;

  const baseRadius = Math.max(2, Number(shards[0]?.radius) || 20);
  const geometry = new THREE.CircleGeometry(baseRadius * 1.04, 6);

  // Geometria/destrukcja może pracować na lekkiej, zmniejszonej masce, ale
  // render powinien próbkować oryginalny sprite, żeby małe klasy nie pikselowały
  // po przybliżeniu kamery.
  const visualImage = grid.visualImage || null;
  const armorSource = visualImage || grid.armorImage || grid.cacheCanvas;
  const texture = visualImage
    ? acquireSharedVisualTexture(visualImage)
    : createManagedTexture(armorSource);

  let normalTexture = null;
  if (grid.normalMapImage) {
    normalTexture = createManagedTexture(grid.normalMapImage, true);
  }

  // Mapa kształtu lakieru jest wspólna dla wszystkich kadłubów z tym samym
  // sprite'em (pieczona z jego alfy). Bez sprite'a albo bez lakieru — płaska.
  const shapeImageRef = (visualImage && allowsHullLacquer(entity)) ? visualImage : null;
  const shapeUniform = shapeImageRef
    ? HullLacquer.acquireShapeUniform(shapeImageRef)
    : HullLacquer.flatShapeUniform;

  // Graf wariantu „hex” (hexShips3D.tsl.js): przezroczysty, z zapisem głębi, FrontSide.
  const material = new HullNodeMaterial('hex',
    createHullUniforms(entity, texture, normalTexture, shapeUniform, grid.srcWidth, grid.srcHeight));

  return finishEntityMesh(entity, grid, shards, count, geometry, material, texture, visualImage,
    shapeImageRef, normalTexture, baseRadius);
}

// Wartości per encja materiału kadłuba (siatka heksów, płyta pancerza, skóra belek):
// obiekty `{ value }` czytane per obiekt przez graf wariantu (hexShips3D.tsl.js).
// Płyta pancerza dzieli je z siatką heksów (spread) poza uLodOpacity. Wartości
// wspólne dla wszystkich kadłubów (czas, strojenie światła, żar, lakier, maska
// słońca) są w węzłach grafu — tu ich nie ma. Lampy i strefy dysz: slot w
// HullLightStore (uLightBase), liczniki uShipLightCount / uEngineZoneCount.
function createHullUniforms(entity, texture, normalTexture, shapeUniform, srcWidth, srcHeight) {
  return {
      uSprite: { value: texture || HULL_EMPTY_SPRITE_TEXTURE },
      uNormalMap: { value: normalTexture || HULL_FLAT_NORMAL_TEXTURE },
      uHasNormalMap: { value: normalTexture ? 1 : 0 },
      uLightDir: { value: new THREE.Vector3(0, 0, 1) },
      uRotation: { value: 0.0 },
      uSpriteSize: { value: new THREE.Vector2(srcWidth || 1, srcHeight || 1) },
      uBillboardLighting: { value: usesBillboardLighting(entity) ? 1 : 0 },
      uLodOpacity: { value: 1 },
      uShipLightCount: { value: 0 },
      uEngineZoneCount: { value: 0 },
      uLightBase: { value: 0 },
      // Mapa kształtu lakieru: obiekt `{ value }` wspólny dla kadłubów z tym samym
      // sprite'em (HullLacquer.acquireShapeUniform) — pieczenie podmienia teksturę wszystkim.
      uShapeMap: shapeUniform,
      uLacquerWeight: { value: 0 },
      uLacquerGlint: { value: 1 }
  };
}

function finishEntityMesh(entity, grid, shards, count, geometry, material, texture, visualImage,
  shapeImageRef, normalTexture, baseRadius) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const enableShadowCast = !entity?.isRingSegment;
  mesh.renderOrder = entity?.isRingSegment ? 0 : 10;
  mesh.castShadow = false;           // <-- CAŁKOWICIE WYŁĄCZONE RZUCANIE CIENIA
  mesh.customDepthMaterial = null;   // <-- CAŁKOWICIE WYŁĄCZONY MATERIAŁ DLA CIENI

  const initialArray = mesh.instanceMatrix.array;
  for (let i = 0; i < count; i++) {
    const offset = i * 16;
    initialArray[offset + 0] = 1.0;
    initialArray[offset + 5] = 1.0;
    initialArray[offset + 10] = 1.0;
    initialArray[offset + 15] = 1.0;
  }

  const gridPosArray = new Float32Array(count * 2);
  const stressArray = new Float32Array(count);
  // Żar startuje z POLA SHARDA, nie z zera: wrak odłączony w spawnWreckEntity
  // dostaje te same obiekty shardów i nowy mesh, więc rozgrzana blacha nie może
  // ostygnąć tylko dlatego, że zmieniła właściciela.
  const heatArray = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const shard = shards[i];
    if (typeof shard?.gridX === 'number' && typeof shard?.gridY === 'number') {
      // aGridPos = kotwica UV pancerza. Shader odrzuca UV poza [0,1], więc czyta się
      // ją z pozycji siatki BEZ deformacji — ekranową pozycję daje instance matrix
      // (gridX + deformation) liczony w updateEntityMesh.
      gridPosArray[i * 2] = shard.gridX;
      gridPosArray[i * 2 + 1] = shard.gridY;
    } else {
      const cx = (grid.srcWidth || 0) * 0.5;
      const cy = (grid.srcHeight || 0) * 0.5;
      gridPosArray[i * 2] = (shard?.lx || 0) + cx;
      gridPosArray[i * 2 + 1] = (shard?.ly || 0) + cy;
    }
    stressArray[i] = computeShardStress(shard);
    heatArray[i * 2] = Number(shard?.heat) || 0;
    heatArray[i * 2 + 1] = Number(shard?.heatStamp) || 0;
  }

  mesh.geometry.setAttribute('aGridPos', new THREE.InstancedBufferAttribute(gridPosArray, 2));
  mesh.geometry.setAttribute('aStress', new THREE.InstancedBufferAttribute(stressArray, 1));
  mesh.geometry.getAttribute('aStress').setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('aHeat', new THREE.InstancedBufferAttribute(heatArray, 2));
  mesh.geometry.getAttribute('aHeat').setUsage(THREE.DynamicDrawUsage);

  // The armor layer reuses the exact same texture and lighting uniforms.  At
  // distance it replaces thousands of interior hex instances, while boundary,
  // damaged and deforming hexes remain individually rendered above it.
  const armorGeometry = new THREE.PlaneGeometry(grid.srcWidth || 1, grid.srcHeight || 1);
  armorGeometry.translate(-(Number(grid?.pivot?.x) || 0), -(Number(grid?.pivot?.y) || 0), 0);
  const armorUniforms = { ...material.uniforms, uLodOpacity: { value: 0 } };
  const armorMaterial = new HullNodeMaterial('armor', armorUniforms);
  const armorMesh = new THREE.Mesh(armorGeometry, armorMaterial);
  armorMesh.frustumCulled = false;
  armorMesh.renderOrder = entity?.isRingSegment ? -1 : 9;
  armorMesh.visible = false;
  armorMesh.position.z = -0.25;

  Core3D.scene.add(armorMesh);
  Core3D.scene.add(mesh);

  const data = {
    mesh,
    armorMesh,
    texture,
    visualImageRef: visualImage,
    // Źródło tekstury, gdy sprite'a brak (fragmenty asteroid) — patrz needsRebuild.
    armorImageRef: visualImage ? null : (grid.armorImage || null),
    shapeImageRef,
    normalTexture,
    normalMapRef: grid.normalMapImage || null,
    gridPosAttr: mesh.geometry.getAttribute('aGridPos'),
    stressAttr: mesh.geometry.getAttribute('aStress'),
    heatAttr: mesh.geometry.getAttribute('aHeat'),
    shardsRef: shards,
    shardCount: count,
    srcWidth: grid.srcWidth || 1,
    srcHeight: grid.srcHeight || 1,
    pivotX: Number(grid?.pivot?.x) || 0,
    pivotY: Number(grid?.pivot?.y) || 0,
    baseRadius,
    lodMode: HEX_LOD.FULL,
    instanceLodMode: HEX_LOD.FULL,
    lodFadeStart: state.lastTime,
    lodFromHexOpacity: 1,
    lodFromArmorOpacity: 0,
    hexOpacity: 1,
    armorOpacity: 0,
    renderedHexCount: count,
    needsInstanceRefresh: true,
    // Slot lamp i stref dysz w HullLightStore (-1 = brak).
    lightSlot: -1
  };
  state.entityMeshes.set(entity, data);
  return data;
}

function updateEntityMesh(entity, data, camX, camY, cameraZoom) {
  if (!entity?.hexGrid || !data?.mesh) return;
  const grid = entity.hexGrid;
  const shards = grid.shards;
  // `let`: po przebudowie niżej mesh MUSI wskazywać nowy obiekt. Dawniej reszta
  // funkcji pisała do starego, już zwolnionego mesha (count, uniformy, pozycja),
  // a flagi czyściła w nowych danych — nowy kadłub zostawał z macierzami
  // jednostkowymi (wszystkie heksy w środku) aż do pełnego odświeżenia.
  let mesh = data.mesh;
  const pivotX = Number(grid?.pivot?.x) || 0;
  const pivotY = Number(grid?.pivot?.y) || 0;

  const needsRebuild =
    data.shardCount < shards.length ||
    data.srcWidth !== (grid.srcWidth || 1) ||
    data.srcHeight !== (grid.srcHeight || 1) ||
    data.visualImageRef !== (grid.visualImage || null) ||
    // Bez sprite'a tekstura idzie z armorImage — wrak z puli dostający siatkę
    // innego typu (fragment innej asteroidy) zachowywał starą teksturę.
    (!grid.visualImage && data.armorImageRef !== (grid.armorImage || null)) ||
    data.normalMapRef !== (grid.normalMapImage || null);

  if (needsRebuild) {
    // Najpierw nowe dane, dopiero potem zwolnienie starych: przy tym samym
    // sprite'cie współdzielona tekstura i mapa kształtu lakieru nie spadają do
    // zera referencji (inaczej ponowny upload tekstury z mipmapami i pieczenie).
    const previous = data;
    state.entityMeshes.delete(entity);
    data = createEntityMesh(entity);
    disposeMeshData(previous);
    if (!data) return;
    mesh = data.mesh;
  } else if (data.shardsRef !== shards) {
    const gridPosAttr = data.mesh.geometry.getAttribute('aGridPos');
    const cx = (grid.srcWidth || 0) * 0.5;
    const cy = (grid.srcHeight || 0) * 0.5;

    for (let i = 0; i < shards.length; i++) {
      const shard = shards[i];
      // UV z pozycji siatki bez deformacji — patrz komentarz w createEntityMesh.
      const baseX = shard.gridX;
      const baseY = shard.gridY;
      gridPosAttr.array[i * 2] = (typeof baseX === 'number') ? baseX : ((shard.lx || 0) + cx);
      gridPosAttr.array[i * 2 + 1] = (typeof baseY === 'number') ? baseY : ((shard.ly || 0) + cy);
    }
    gridPosAttr.needsUpdate = true;
    data.shardsRef = shards;
    data.needsInstanceRefresh = true;
  }

  if (pivotX !== data.pivotX || pivotY !== data.pivotY) {
    data.armorMesh.geometry.translate(data.pivotX - pivotX, data.pivotY - pivotY, 0);
    data.pivotX = pivotX;
    data.pivotY = pivotY;
    data.needsInstanceRefresh = true;
  }

  const interpPose = getInterpolatedRenderPose(entity);
  const ex = interpPose ? interpPose.x : getEntityPosX(entity);
  const ey = interpPose ? interpPose.y : getEntityPosY(entity);
  const entityAngle = interpPose ? interpPose.angle : (entity.angle || 0);
  const entityScale = getEntityScale(entity);
  const zoomPx = Math.max(0.0001, cameraZoom) * (Core3D.pixelRatio || 1);
  const screenRadiusPx = data.baseRadius * entityScale * zoomPx;
  const solidArmorAllowed = allowsSolidArmorLod(entity);

  // Wrak z oddali: jedna smuga we wspólnym batchu zamiast własnego wywołania
  // i zamiast pełnego przeliczenia macierzy wszystkich heksów.
  if (!solidArmorAllowed) {
    // Zasięg AKTYWNYCH heksów, nie sprite'a (fragment ma src rodzica).
    const lodScaleX = getEntityScaleX(entity);
    const lodScaleY = getEntityScaleY(entity);
    const extent = getGridActiveExtent(grid, state.lastTime);
    const bodyRadiusPx = Math.max(extent.halfW * Math.abs(lodScaleX), extent.halfH * Math.abs(lodScaleY)) * zoomPx;
    const tuning = (typeof window !== 'undefined' && window.DevTuning) ? window.DevTuning : null;
    const enterPx = Number.isFinite(Number(tuning?.wreckImpostorPx)) ? Number(tuning.wreckImpostorPx) : WRECK_IMPOSTOR_PX;
    const exitPx = enterPx * WRECK_IMPOSTOR_EXIT_MUL;
    const wasImpostor = data.batchedImpostor === true;
    const isImpostor = wasImpostor ? (bodyRadiusPx < exitPx) : (bodyRadiusPx < enterPx);

    if (isImpostor) {
      if (data.impostorColor === undefined) {
        data.impostorColor = computeAverageBodyColor(grid.visualImage || grid.armorImage || grid.cacheCanvas) || null;
      }
      if (data.impostorColor) {
        if (data.mesh.visible) data.mesh.visible = false;
        if (data.armorMesh.visible) data.armorMesh.visible = false;
        // Powrót do pełnego detalu musi przeliczyć wszystko od zera — przez czas
        // w batchu nie śledziliśmy meshDirty.
        data.needsInstanceRefresh = true;
        data.batchedImpostor = true;
        const halfW = extent.halfW * lodScaleX;
        const halfH = extent.halfH * lodScaleY;
        // Środek smugi = środek aktywnych heksów, przeniesiony tym samym
        // przekształceniem co mesh: T(ex, -ey) · Rz(rot) · S(sx, -sy).
        const rot = usesBillboardOrientation(entity) ? entityAngle : -entityAngle;
        const offX = extent.cx * lodScaleX;
        const offY = -extent.cy * lodScaleY;
        const cosRot = Math.cos(rot);
        const sinRot = Math.sin(rot);
        // Skalary zamiast obiektu per wrak per klatkę.
        const impostorColor = data.impostorColor;
        HexBodyImpostorBatch.pushRaw(
          ex + offX * cosRot - offY * sinRot,
          -ey + offX * sinRot + offY * cosRot,
          rot,
          halfW,
          halfH,
          impostorColor.r,
          impostorColor.g,
          impostorColor.b,
          1
        );
        DrawCallStats.addImpostor(1);
        lodFrameStats.impostorBodies++;
        lodFrameStats.totalStructuralHexes += shards.length;
        return;
      }
    }
    data.batchedImpostor = false;
  }

  resolveHexLod(data, screenRadiusPx, state.lastTime, solidArmorAllowed);

  // Upload tekstury pancerza = pełny texImage2D + regeneracja mipmap. W ostrzale
  // destroyShard ustawiał gpuTextureNeedsUpdate przy KAŻDYM heksie → kilka pełnych
  // uploadów na klatkę. Throttle per statek; flagi zostają ustawione, więc upload
  // dogania w pierwszej klatce po oknie (przy 100 ms wizualnie niezauważalne).
  const TEX_UPLOAD_MIN_MS = 100;
  if (!!grid.cacheDirty || !!grid.textureDirty || !!grid.gpuTextureNeedsUpdate) {
    const lastUpload = Number(data._lastTexUploadMs) || 0;
    if (lastUpload === 0 || (state.lastTime - lastUpload) >= TEX_UPLOAD_MIN_MS) {
      if (grid.cacheDirty) refreshHexBodyCache(entity);
      data.texture.needsUpdate = true;
      grid.textureDirty = false;
      grid.cacheDirty = false;
      grid.gpuTextureNeedsUpdate = false;
      data._lastTexUploadMs = state.lastTime;
    }
  }

  // Zegar kadłuba (zanik żaru, sekwencja świateł pozycyjnych) to wspólny węzeł
  // HULL_SHARED.uTime — jeden zapis na klatkę w updateHexShips3D dla wszystkich.
  const nowSec = state.lastTime * 0.001;

  if (!!grid.meshDirty || data.needsInstanceRefresh) {
    const stressAttr = data.stressAttr;
    const gridPosAttr = data.gridPosAttr;
    const heatAttr = data.heatAttr;

    const instanceArray = mesh.instanceMatrix.array;
    const cx = (grid.srcWidth || 0) * 0.5;
    const cy = (grid.srcHeight || 0) * 0.5;

    const hasRange =
      Number.isFinite(grid.meshDirtyStart) &&
      Number.isFinite(grid.meshDirtyEnd) &&
      grid.meshDirtyStart >= 0 &&
      grid.meshDirtyEnd >= grid.meshDirtyStart;

    const fullLod = data.instanceLodMode === HEX_LOD.FULL;
    const fullRefresh = !fullLod || data.needsInstanceRefresh || !!grid.meshDirtyAll || !hasRange;

    let start = 0;
    let end = shards.length - 1;

    if (!fullRefresh) {
      start = Math.max(0, grid.meshDirtyStart | 0);
      end = Math.min(shards.length - 1, grid.meshDirtyEnd | 0);
      if (end < start) {
        start = 0;
        end = shards.length - 1;
      }
    }

    if (fullLod) {
      mesh.count = shards.length;
      for (let i = start; i <= end; i++) {
        const shard = shards[i];
        const offset = i * 16;

        if (shard && shard.active && !shard.isDebris) {
          const deform = shard.deformation;
          const gx = shard.gridX + (deform ? deform.x : 0);
          const gy = shard.gridY + (deform ? deform.y : 0);

          instanceArray[offset + 12] = gx - cx - data.pivotX;
          instanceArray[offset + 13] = gy - cy - data.pivotY;
          instanceArray[offset + 0] = 1.0;
          instanceArray[offset + 5] = 1.0;

          const baseX = shard.gridX;
          const baseY = shard.gridY;
          gridPosAttr.array[i * 2] = Number(baseX) || 0;
          gridPosAttr.array[i * 2 + 1] = Number(baseY) || 0;
          stressAttr.array[i] = computeShardStress(shard);
          heatAttr.array[i * 2] = Number(shard.heat) || 0;
          heatAttr.array[i * 2 + 1] = Number(shard.heatStamp) || 0;
        } else {
          instanceArray[offset + 0] = 0.0;
          instanceArray[offset + 5] = 0.0;
          instanceArray[offset + 12] = 0.0;
          instanceArray[offset + 13] = 0.0;
          stressAttr.array[i] = 0;
          heatAttr.array[i * 2] = 0;
          heatAttr.array[i * 2 + 1] = 0;
        }
      }
    } else {
      // Compact selected instances into the leading span.  InstancedMesh.count
      // then actually lowers GPU vertex work; merely setting scale to zero would
      // still submit every interior hex.
      let writeIndex = 0;
      if (data.instanceLodMode === HEX_LOD.HYBRID) {
        for (let shardIndex = 0; shardIndex < shards.length; shardIndex++) {
          const shard = shards[shardIndex];
          if (!shouldRenderHybridShard(shard, nowSec)) continue;
          const offset = writeIndex * 16;
          const deform = shard.deformation;
          const gx = shard.gridX + (deform ? deform.x : 0);
          const gy = shard.gridY + (deform ? deform.y : 0);
          instanceArray[offset + 0] = 1.0;
          instanceArray[offset + 5] = 1.0;
          instanceArray[offset + 10] = 1.0;
          instanceArray[offset + 15] = 1.0;
          instanceArray[offset + 12] = gx - cx - data.pivotX;
          instanceArray[offset + 13] = gy - cy - data.pivotY;
          const baseX = shard.gridX;
          const baseY = shard.gridY;
          gridPosAttr.array[writeIndex * 2] = Number(baseX) || 0;
          gridPosAttr.array[writeIndex * 2 + 1] = Number(baseY) || 0;
          stressAttr.array[writeIndex] = computeShardStress(shard);
          heatAttr.array[writeIndex * 2] = Number(shard.heat) || 0;
          heatAttr.array[writeIndex * 2 + 1] = Number(shard.heatStamp) || 0;
          writeIndex++;
        }
      }
      mesh.count = writeIndex;
      data.renderedHexCount = writeIndex;
    }

    if (fullRefresh) {
      setAttrUpdateRange(mesh.instanceMatrix, 0, -1);
      setAttrUpdateRange(stressAttr, 0, -1);
      setAttrUpdateRange(gridPosAttr, 0, -1);
      setAttrUpdateRange(heatAttr, 0, -1);
    } else {
      const count = Math.max(0, end - start + 1);
      setAttrUpdateRange(mesh.instanceMatrix, start * 16, count * 16);
      setAttrUpdateRange(stressAttr, start, count);
      setAttrUpdateRange(gridPosAttr, start * 2, count * 2);
      setAttrUpdateRange(heatAttr, start * 2, count * 2);
    }

    mesh.instanceMatrix.needsUpdate = true;
    stressAttr.needsUpdate = true;
    gridPosAttr.needsUpdate = true;
    heatAttr.needsUpdate = true;
    if (fullLod) data.renderedHexCount = mesh.count;
    data.needsInstanceRefresh = false;
    grid.meshDirty = false;
    grid.meshDirtyAll = false;
    grid.meshDirtyStart = -1;
    grid.meshDirtyEnd = -1;
  }

  // Strojenie światła (panel), glow naprężenia i żar heksów (DESTRUCTOR_CONFIG)
  // to wspólne węzły HULL_SHARED — zapis raz na klatkę w syncHullSharedUniforms.

  const sun = typeof window !== 'undefined' ? window.SUN : null;
  if (sun) {
    const dx = sun.x - ex;
    const dy = -(sun.y - ey);
    // In-place: bez alokacji Vector3 per klatkę per statek
    mesh.material.uniforms.uLightDir.value.set(dx, dy, 600).normalize();
  }

  if (mesh.material.uniforms.uBillboardLighting) {
    mesh.material.uniforms.uBillboardLighting.value = usesBillboardLighting(entity) ? 1 : 0;
  }
  const bodyRadiusPx = Math.max(data.srcWidth, data.srcHeight) * 0.5 * entityScale * zoomPx;
  syncEntityLightUniforms(entity, data, grid, state.roadLightEmitters, bodyRadiusPx);
  syncEntityLacquer(entity, data, grid, entityScale, zoomPx);
  const renderRotation = usesBillboardOrientation(entity) ? entityAngle : -entityAngle;
  mesh.material.uniforms.uRotation.value = renderRotation;

  mesh.position.set(ex, -ey, 0);
  mesh.rotation.set(0, 0, renderRotation);
  const scaleX = getEntityScaleX(entity);
  const scaleY = getEntityScaleY(entity);
  mesh.scale.set(scaleX, -scaleY, 1);
  data.armorMesh.position.set(ex, -ey, -0.25);
  data.armorMesh.rotation.set(0, 0, renderRotation);
  data.armorMesh.scale.set(scaleX, -scaleY, 1);

  // Jedno ciało = jedno wywolanie na siatke heksow i jedno na plyte pancerza —
  // w praktyce widoczna jest jedna z nich naraz, ale w oknie przenikania LOD-u
  // obie. Wraki liczymy osobno, bo to one narastaja przez cala bitwe.
  const bodyDraws = (data.mesh.visible ? 1 : 0) + (data.armorMesh.visible ? 1 : 0);
  if (bodyDraws > 0) DrawCallStats.addHexBody(bodyDraws, !allowsSolidArmorLod(entity));

  lodFrameStats.totalStructuralHexes += shards.length;
  if (data.lodMode === HEX_LOD.FULL) {
    lodFrameStats.fullBodies++;
    lodFrameStats.fullHexes += data.renderedHexCount;
  } else if (data.lodMode === HEX_LOD.HYBRID) {
    lodFrameStats.hybridBodies++;
    lodFrameStats.hybridHexes += data.renderedHexCount;
  } else {
    lodFrameStats.impostorBodies++;
  }
}

// ============================ KADŁUBY NA BELKACH ============================
// Encja z `beamHull` (hullBodies.js): jeden mesh na ciało — czworokąt na węzeł, pozycje
// w układzie ciała, mesh.position = początek ciała w świecie (z pozy RENDERU encji,
// więc interpolacja gracza działa jak u heksów). Materiał = shader kadłubów gry.

function isBeamHullEntity(entity) {
  const hull = entity?.beamHull;
  return !!hull && hull.entity === entity && !!hull.body && !hull.body.dead && hull.body.activeNodes > 0;
}

const _beamSkinRange = { min: 0, max: -1 };

// Sylwetka do cieni (hullShadowSdf, siatka komórkowa): środki węzłów SPOCZYNKOWYCH
// w pikselach sprite'a od lewego górnego rogu — jak gridX/gridY heksów. Względem
// latticeMin są stałe dla magazynu (rozpad w miejscu przesuwa oba o to samo), więc
// liczy się je raz na magazyn; żywe = active magazynu (widok, nie kopia).
function beamShadowGrid(hull) {
  const body = hull.body, s = body.nodeStore;
  let g = hull._shadowGrid;
  if (!g || g.store !== s) {
    const n = s.count;
    const cellX = new Float32Array(n), cellY = new Float32Array(n);
    const lx = body.latticeMin.x, top = body.latticeMin.y + hull.ny * body.cellSize, k = 1 / hull.scale;
    for (let i = 0; i < n; i++) {
      cellX[i] = (s.ox[i] - lx) * k;
      cellY[i] = (top - s.oy[i]) * k;
    }
    g = hull._shadowGrid = {
      store: s,
      cellX, cellY,
      cellActive: s.active,
      cellCount: n,
      // Koło opisane na komórce kwadratowej (√2/2 boku) z małym zapasem — koła pokrywają płytę.
      cellRadius: hull.pixelPitch * 0.72,
      srcWidth: hull.srcWidth,
      srcHeight: hull.srcHeight,
      pivot: hull.pivot,
      armorImage: hull.image,
      visualImage: hull.visualImage,
      isFragment: hull.isFragment,
      activeStructuralCount: body.activeNodes
    };
  }
  g.activeStructuralCount = body.activeNodes;
  g.isFragment = hull.isFragment;
  g.pivot = hull.pivot;
  return g;
}

function createBeamSkinMesh(entity) {
  if (!isBeamHullEntity(entity)) return null;
  const hull = entity.beamHull;
  const visualImage = hull.visualImage || null;
  const texture = visualImage ? acquireSharedVisualTexture(visualImage) : createManagedTexture(hull.image);
  const normalTexture = hull.normalMapImage ? createManagedTexture(hull.normalMapImage, true) : null;
  const shapeImageRef = (visualImage && allowsHullLacquer(entity)) ? visualImage : null;
  const shapeUniform = shapeImageRef ? HullLacquer.acquireShapeUniform(shapeImageRef) : HullLacquer.flatShapeUniform;
  // Graf wariantu „beam” (hexShips3D.tsl.js): przezroczysty, z zapisem głębi,
  // DoubleSide w jednym przejściu (zgnieciony czworokąt potrafi się przewrócić —
  // z FrontSide zostałaby dziura).
  const material = new HullNodeMaterial('beam',
    createHullUniforms(entity, texture, normalTexture, shapeUniform, hull.srcWidth, hull.srcHeight));
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.castShadow = false;
  Core3D.scene.add(mesh);
  const data = {
    kind: 'beam',
    mesh,
    armorMesh: null,
    texture,
    visualImageRef: visualImage,
    armorImageRef: visualImage ? null : hull.image,
    shapeImageRef,
    normalTexture,
    normalMapRef: hull.normalMapImage || null,
    hull,
    body: hull.body,
    topo: null,
    positions: null,
    shade: null,
    heat: null,
    visibleQuads: 0,
    needsFullWrite: true,
    srcWidth: hull.srcWidth,
    srcHeight: hull.srcHeight,
    pivotX: hull.pivot.x,
    pivotY: hull.pivot.y,
    baseRadius: hull.cellSize * 0.5,
    lodMode: HEX_LOD.FULL,
    renderedHexCount: 0,
    // Slot lamp i stref dysz w HullLightStore (-1 = brak).
    lightSlot: -1
  };
  rebuildBeamSkinGeometry(data);
  state.entityMeshes.set(entity, data);
  return data;
}

function rebuildBeamSkinGeometry(data) {
  const body = data.body;
  const topo = buildHullSkinTopology(body);
  const vertices = topo.count * 4;
  data.positions = new Float32Array(vertices * 3);
  data.shade = new Float32Array(vertices);
  data.heat = new Float32Array(vertices * 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aShade', new THREE.BufferAttribute(data.shade, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aHeat', new THREE.BufferAttribute(data.heat, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(topo.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(topo.indices, 1));
  data.mesh.geometry.dispose();
  data.mesh.geometry = geometry;
  data.topo = topo;
  setBeamSkinHeatClock(topo);
  data.visibleQuads = writeHullSkin(body, topo, data.positions, data.shade, data.heat);
  clearHullSkinDirty(body);
  data.needsFullWrite = false;
  body.meshDirty = false;
}

// Żar narożników skóry liczony na chwilę zapisu — zegar renderera (performance.now, jak
// znaczniki żaru silnika) i zanik z configu kadłubów (ten sam co w shaderze).
function setBeamSkinHeatClock(topo) {
  topo.heatNow = state.lastTime * 0.001;
  topo.heatDecay = Math.max(0, Number(HullBodies.config.heatDecay) || 0);
}

// Zapis skóry: po rozpadzie z zagęszczeniem od nowa; pod solverem lokalnym tylko
// czworokąty węzłów zmienionych od ostatniego rysowania (i ten zakres bufora na GPU).
function updateBeamSkinGeometry(data) {
  const body = data.body, topo = data.topo;
  if (topo.store !== body.nodeStore || topo.beamStore !== body.beamStore) {
    rebuildBeamSkinGeometry(data);
    return;
  }
  if (!body.meshDirty && !data.needsFullWrite) return;
  setBeamSkinHeatClock(topo);
  const geometry = data.mesh.geometry;
  const position = geometry.attributes.position, shade = geometry.attributes.aShade, heat = geometry.attributes.aHeat;
  const region = body._region;
  if (!data.needsFullWrite && region && region.store === body.nodeStore && !region.dirtyAll) {
    if (region.dirtyCount > 0) {
      const range = writeHullSkinQuads(body, topo, data.positions, data.shade, data.heat,
        region.dirty, region.dirtyCount, _beamSkinRange);
      clearHullSkinDirty(body);
      if (range.max >= range.min) {
        const quads = range.max - range.min + 1;
        setAttrUpdateRange(position, range.min * 12, quads * 12);
        setAttrUpdateRange(shade, range.min * 4, quads * 4);
        setAttrUpdateRange(heat, range.min * 8, quads * 8);
        position.needsUpdate = true;
        shade.needsUpdate = true;
        heat.needsUpdate = true;
      }
    }
    data.visibleQuads = body.activeNodes;
  } else {
    data.visibleQuads = writeHullSkin(body, topo, data.positions, data.shade, data.heat);
    clearHullSkinDirty(body);
    setAttrUpdateRange(position, 0, -1);
    setAttrUpdateRange(shade, 0, -1);
    setAttrUpdateRange(heat, 0, -1);
    position.needsUpdate = true;
    shade.needsUpdate = true;
    heat.needsUpdate = true;
  }
  data.needsFullWrite = false;
  body.meshDirty = false;
}

function updateBeamSkinMesh(entity, data, camX, camY, cameraZoom) {
  const hull = entity.beamHull;
  if (!isBeamHullEntity(entity)) return;
  let mesh = data.mesh;
  if (data.hull !== hull || data.body !== hull.body ||
      data.visualImageRef !== (hull.visualImage || null) || data.normalMapRef !== (hull.normalMapImage || null)) {
    // Najpierw nowe dane, potem zwolnienie starych (wspólna tekstura nie spada do zera).
    const previous = data;
    state.entityMeshes.delete(entity);
    data = createBeamSkinMesh(entity);
    disposeMeshData(previous);
    if (!data) return;
    mesh = data.mesh;
  }
  const body = hull.body;
  const interpPose = getInterpolatedRenderPose(entity);
  const ex = interpPose ? interpPose.x : getEntityPosX(entity);
  const ey = interpPose ? interpPose.y : getEntityPosY(entity);
  const entityAngle = interpPose ? interpPose.angle : (entity.angle || 0);
  const theta = -(entityAngle + hullSpriteRotation(entity));
  const c = Math.cos(theta), s = Math.sin(theta);
  const ax = HullBodies.anchorLocalX(hull), ay = HullBodies.anchorLocalY(hull);
  // Początek ciała w świecie Core3D (x, −y): kotwica encji minus R·kotwica lokalna.
  const originX = ex - (c * ax - s * ay);
  const originY = -ey - (s * ax + c * ay);
  const entityScale = hull.scale;
  const zoomPx = Math.max(0.0001, cameraZoom) * (Core3D.pixelRatio || 1);
  data.pivotX = hull.pivot.x;
  data.pivotY = hull.pivot.y;

  // Wrak z oddali: smuga we wspólnym batchu (zasięg żywych węzłów, nie sprite'a rodzica).
  if (!allowsSolidArmorLod(entity)) {
    const mm = body._boundsMinMax;
    const halfW = (mm[3] - mm[0]) * 0.5 + body.cellSize * 0.5;
    const halfH = (mm[4] - mm[1]) * 0.5 + body.cellSize * 0.5;
    const bodyRadiusPx = Math.max(halfW, halfH) * zoomPx;
    const tuning = (typeof window !== 'undefined' && window.DevTuning) ? window.DevTuning : null;
    const enterPx = Number.isFinite(Number(tuning?.wreckImpostorPx)) ? Number(tuning.wreckImpostorPx) : WRECK_IMPOSTOR_PX;
    const exitPx = enterPx * WRECK_IMPOSTOR_EXIT_MUL;
    const isImpostor = data.batchedImpostor === true ? bodyRadiusPx < exitPx : bodyRadiusPx < enterPx;
    if (isImpostor) {
      if (data.impostorColor === undefined) {
        data.impostorColor = computeAverageBodyColor(hull.visualImage || hull.image) || null;
      }
      if (data.impostorColor) {
        if (mesh.visible) mesh.visible = false;
        data.batchedImpostor = true;
        const cxL = (mm[0] + mm[3]) * 0.5, cyL = (mm[1] + mm[4]) * 0.5;
        const color = data.impostorColor;
        HexBodyImpostorBatch.pushRaw(
          originX + c * cxL - s * cyL,
          originY + s * cxL + c * cyL,
          theta, halfW, halfH, color.r, color.g, color.b, 1
        );
        DrawCallStats.addImpostor(1);
        lodFrameStats.impostorBodies++;
        lodFrameStats.totalStructuralHexes += body.activeNodes;
        return;
      }
    }
    data.batchedImpostor = false;
  }

  updateBeamSkinGeometry(data);

  const uniforms = mesh.material.uniforms;
  // Czas, strojenie światła i żar skóry belek (HULL_BODY_CONFIG — żar belek to
  // wyłącznie zgniot i brzeg rany ZDERZENIA; heatGlowPeak destruktora zostaje
  // heksom) to wspólne węzły HULL_SHARED (syncHullSharedUniforms).
  const sun = typeof window !== 'undefined' ? window.SUN : null;
  if (sun) uniforms.uLightDir.value.set(sun.x - ex, -(sun.y - ey), 600).normalize();
  uniforms.uBillboardLighting.value = usesBillboardLighting(entity) ? 1 : 0;
  const bodyRadiusPx = Math.max(hull.srcWidth, hull.srcHeight) * 0.5 * entityScale * zoomPx;
  syncEntityLightUniforms(entity, data, hull, state.roadLightEmitters, bodyRadiusPx);
  syncEntityLacquer(entity, data, hull, entityScale, zoomPx);
  uniforms.uRotation.value = theta;

  mesh.position.set(originX, originY, 0);
  mesh.rotation.set(0, 0, theta);
  mesh.scale.set(1, 1, 1);
  mesh.visible = data.visibleQuads > 0;

  if (mesh.visible) DrawCallStats.addHexBody(1, !allowsSolidArmorLod(entity));
  lodFrameStats.totalStructuralHexes += body.activeNodes;
  lodFrameStats.fullBodies++;
  lodFrameStats.fullHexes += body.activeNodes;
  data.renderedHexCount = body.activeNodes;
}

export function initHexShips3D({ canvas = null } = {}) {
  if (!Core3D.isInitialized) Core3D.init(canvas);
  ensureShipLightPanelApi();
  return true;
}

// Trzymacze grafów kadłubów: jeden ukryty mesh na wariant (skóra belek, płyta
// pancerza) z materiałem, którego nie zwalniamy. NodeManager usuwa stan budowy
// materiału (i pipeline), gdy ostatni obiekt przestaje go używać — bez trzymacza
// śmierć ostatniego kadłuba w kadrze kosztowałaby pełną przebudowę grafu przy
// następnym spawnie. Rozgrzewka (prewarmPass) buduje je na ekranie ładowania,
// więc pierwszy kadłub bierze gotowy pipeline. Siatka heksów (InstancedMesh)
// ma w kluczu three uuid obiektu — trzymacz nic by jej nie dał.
let _hullProbes = null;
function hullVariantProbes() {
  if (_hullProbes) return _hullProbes;
  if (!Core3D.scene) return [];
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  beamGeo.setAttribute('aShade', new THREE.BufferAttribute(new Float32Array([1, 1, 1, 1]), 1));
  beamGeo.setAttribute('aHeat', new THREE.BufferAttribute(new Float32Array(8), 2));
  beamGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
  beamGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const holders = () => createHullUniforms(null, null, null, HullLacquer.flatShapeUniform, 1, 1);
  const beam = new THREE.Mesh(beamGeo, new HullNodeMaterial('beam', holders()));
  beam.renderOrder = 10;
  const armor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new HullNodeMaterial('armor', holders()));
  armor.renderOrder = 9;
  armor.position.z = -0.25;
  for (const m of [beam, armor]) {
    m.name = `hullProbe:${m.material.name}`;
    m.frustumCulled = false;
    m.visible = false;
    Core3D.scene.add(m);
  }
  _hullProbes = [beam, armor];
  return _hullProbes;
}

function disposeHullVariantProbes() {
  if (!_hullProbes) return;
  for (const m of _hullProbes) {
    m.parent?.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  }
  _hullProbes = null;
}

// Bank cząstek Fx3D (iskry dysz, mostki, rdzenie) ma własne programy shaderowe. Bez
// kompilacji na ekranie ładowania pierwsze użycie gubi klatkę. Efekty broni (WeaponFx,
// pule GPU z dema bronie-webgpu) rozgrzewa krok Core3D.fx (warm: kernele + prewarmPass).
function prewarmFx3D() {
  // Core3D.renderer istnieje dopiero przy gotowym urządzeniu WebGPU.
  if (!Fx3D.ensure() || !Core3D.renderer || !Core3D.cameraOrtho) return false;
  const meshes = Fx3D.meshes;
  for (const trail of [MainExhaust3D.prewarm()]) {
    if (trail) meshes.push(trail);
  }
  // Plazma warpa: raymarch to najcięższy program w grze — bez tego pierwszy
  // skok gubi klatki na kompilacji. Instancja zostaje w puli.
  meshes.push(...WarpPlume3D.prewarm());
  // Odłamki kadłubów na belkach: program gotowy przed pierwszym trafieniem.
  meshes.push(...HullDebris3D.prewarm());
  // Kadłuby (graf na wariant): pipeline skóry belek i płyty pancerza przed
  // pierwszym NPC; trzymacze zostają w scenie ukryte.
  meshes.push(...hullVariantProbes());
  const prev = meshes.map((m) => m.visible);
  for (const m of meshes) m.visible = true;
  // compileAsync bez blokowania (Core3D.prewarmPass: cel composerTarget, warstwa
  // ortho, bez cullingu); projekcja idzie synchronicznie, więc widoczność można
  // przywrócić zaraz po wywołaniu. Błąd tylko do konsoli.
  Core3D.prewarmPass(Core3D.scene, 0);
  meshes.forEach((m, i) => { m.visible = prev[i]; });
  return true;
}

export function prewarmHexShips3D({ canvas = null } = {}) {
  if (!Core3D.isInitialized) Core3D.init(canvas);
  WeaponFx.prewarm();
  prewarmFx3D();
  return true;
}

export function resizeHexShips3D(width, height) {
  if (Core3D.isInitialized) Core3D.resize(width, height);
}

export function setHexDamageTintEnabled(enabled) {
  state.damageTintEnabled = enabled !== false;
  GpuDebrisManager.heatTintEnabled = state.damageTintEnabled;
  // Glow naprężenia i szczyt żaru to wspólne węzły — jeden zapis dla wszystkich kadłubów.
  syncHullSharedUniforms();
  return state.damageTintEnabled;
}

// Wartości wspólne kadłubów (węzły HULL_SHARED, hexShips3D.tsl.js): raz na klatkę
// zamiast per mesh. Strojenie światła z panelu (window.__shipLightTune) tylko przy
// zmianie epoki; żar pod przełącznikiem glow stresu, jasność z configu (suwaki
// „heat glow peak”): skóra belek — HULL_BODY_CONFIG, heksy — DESTRUCTOR_CONFIG.
let _appliedTuneEpoch = -1;
function syncHullSharedUniforms() {
  const shared = HULL_SHARED;
  shared.uTime.value = state.lastTime * 0.001;
  // Epoka 0 = migawka strojenia jeszcze pusta (NaN) — do pierwszego refreshTuneEpoch.
  if (_tuneEpoch > 0 && _appliedTuneEpoch !== _tuneEpoch) {
    const tune = _tuneSnapshot;
    shared.uDayAmbient.value = clamp(tune.dayAmbient, 0.0, 1.0);
    shared.uDayDiffuseMul.value = clamp(tune.dayDiffuseMul, 0.0, 3.0);
    shared.uSpecularMul.value = clamp(tune.specularMul, 0.0, 1.5);
    _appliedTuneEpoch = _tuneEpoch;
  }
  const tint = state.damageTintEnabled;
  shared.uStressTint.value = tint ? 0.30 : 0.0;
  shared.beamHeatDecay.value = Math.max(0, Number(HullBodies.config.heatDecay) || 0);
  shared.beamHeatPeak.value = tint ? Math.max(0, Number(HullBodies.config.heatGlowPeak) || 0) : 0.0;
  shared.hexHeatDecay.value = Math.max(0, Number(DESTRUCTOR_CONFIG.heatDecay) || 0);
  shared.hexHeatPeak.value = tint ? Math.max(0, Number(DESTRUCTOR_CONFIG.heatGlowPeak) || 0) : 0.0;
}

export function isHexDamageTintEnabled() {
  return state.damageTintEnabled !== false;
}

// coldWrecks: zimne wraki (src/game/coldWrecks.js) — tylko smugi z batcha.
/**
 * Światła świata dla pancerzy na tę klatkę (np. błyski burzy): tablica
 * { x, y, color: {r,g,b}, power, rangeWorld, mean } — rozlew typu 2 w pętli
 * lamp kadłuba (jak grupy lamp pozycyjnych innych statków). Wołać przed
 * updateHexShips3D; pusta tablica = brak.
 */
export function setHexShipWorldLights(lights) {
  const out = state.worldOmniLights;
  out.length = 0;
  if (!Array.isArray(lights)) return;
  for (let i = 0; i < lights.length; i++) if (lights[i]) out.push(lights[i]);
}

export function updateHexShips3D(viewCamera, entities = [], cullInfo = null, coldWrecks = null) {
  if (!Core3D.isInitialized) return;

  const now = performance.now();
  state.lastTime = now;
  state.frameId++;

  Core3D.syncCamera(viewCamera);

  // Raz na klatkę: migawka globalnego strojenia (epoka) i wspólne węzły kadłubów
  // (czas, strojenie, żar) — jeden zapis dla wszystkich materiałów.
  refreshTuneEpoch();
  syncHullSharedUniforms();

  // Lakier: wspólne uniformy, tekstury odbić i kolejka pieczenia map
  // kształtu (jeden sprite na klatkę). Nic z kamery — odbicia zależą tylko od
  // położenia i obrotu statku.
  HullLacquer.update();

  const camX = Number(viewCamera?.x) || 0;
  const camY = Number(viewCamera?.y) || 0;
  const cameraZoom = Math.max(0.0001, Number(viewCamera?.zoom) || 1);
  state.lastCull = cullInfo;
  state.lastCameraZoom = cameraZoom;
  DrawCallStats.begin();
  HexBodyImpostorBatch.begin();
  lodFrameStats.fullBodies = 0;
  lodFrameStats.hybridBodies = 0;
  lodFrameStats.impostorBodies = 0;
  lodFrameStats.fullHexes = 0;
  lodFrameStats.hybridHexes = 0;
  lodFrameStats.totalStructuralHexes = 0;
  lodFrameStats.entitiesIn = 0;
  lodFrameStats.culled = 0;
  lodFrameStats.warmOnly = 0;
  lodFrameStats.shaftCands = 0;
  lodFrameStats.shaftHulls = 0;
  lodFrameStats.shaftBakes = 0;
  lodFrameStats.coldImpostors = 0;

  const valid = state.validEntities;
  const vfxEntities = state.vfxEntities;
  const visibleHex = state.visibleHexEntities;
  const visibleVfx = state.visibleVfxEntities;
  const drawHex = state.drawHexEntities;
  const drawVfx = state.drawVfxEntities;
  const stale = state.staleEntities;
  const validSet = state.validEntitySet;
  valid.length = 0;
  vfxEntities.length = 0;
  visibleHex.length = 0;
  visibleVfx.length = 0;
  drawHex.length = 0;
  drawVfx.length = 0;
  stale.length = 0;
  validSet.clear();
  for (const entity of entities) {
    if (!entity || entity.dead) continue;
    lodFrameStats.entitiesIn++;
    valid.push(entity);
    const hideHexVisual = entity.hideHexVisual === true || entity.visual?.hideHexMesh === true;
    if (hideHexVisual) {
      const data = state.entityMeshes.get(entity);
      if (data?.mesh) data.mesh.visible = false;
      if (data?.armorMesh) data.armorMesh.visible = false;
      continue;
    }
    const hasBody = !!entity.hexGrid || isBeamHullEntity(entity);
    if (hasBody) validSet.add(entity);

    const visible = isEntityInCull(entity, cullInfo);
    if (!visible) {
      lodFrameStats.culled++;
      const data = state.entityMeshes.get(entity);
      if (data?.mesh) data.mesh.visible = false;
      if (data?.armorMesh) data.armorMesh.visible = false;
      continue;
    }

    visibleVfx.push(entity);
    const inDrawBox = isEntityInDrawBox(entity, cullInfo, cameraZoom);
    if (inDrawBox) drawVfx.push(entity);
    else lodFrameStats.warmOnly++;
    if (!hasBody) continue;
    visibleHex.push(entity);
    if (inDrawBox) drawHex.push(entity);
  }

  // Emitery świateł drogowych z CAŁEGO pudła rozgrzania: statek tuż poza
  // kadrem może oświetlać kadłub, który w kadrze jest.
  SHIP_LIGHT_EMITTER_OPTIONS.out = state.roadLightEmitters;
  buildRoadLightWorldEmitters(visibleHex, SHIP_LIGHT_EMITTER_OPTIONS);
  computeRoadEmitterReach(state.roadLightEmitters, state.roadLightReach);
  // Grupy lamp pozycyjnych: rozlew czerwieni na sąsiednie kadłuby (typ 2
  // w pętli lamp). Tylko przy dwóch+ kadłubach — własnych lamp kadłub ma swoje.
  NAV_CLUSTER_OPTIONS.out = state.navLightClusters;
  NAV_CLUSTER_OPTIONS.time = now * 0.001;
  if (visibleHex.length > 1) buildNavLightClusters(visibleHex, NAV_CLUSTER_OPTIONS);
  else state.navLightClusters.length = 0;
  // Światła świata tej klatki (np. błyski burzy w polu asteroid) — ta sama
  // ścieżka co grupy lamp: rozlew na pancerzu (typ 2), bez rdzenia lampy.
  for (let i = 0; i < state.worldOmniLights.length; i++) state.navLightClusters.push(state.worldOmniLights[i]);
  extendReachWithOmniLights(state.roadLightReach, state.navLightClusters);

  // Światła pozycyjne jako addytywne billboardy na warstwie FG: emisja, maski
  // cienia nie czytają — świecą HDR-owo pod bloom także w cieniu planety.
  const navBuild = ShipLights3D.getSpriteBuildParams(cameraZoom);
  NAV_LIGHT_SPRITE_OPTIONS.out = state.navLightSprites;
  NAV_LIGHT_SPRITE_OPTIONS.zoom = cameraZoom;
  NAV_LIGHT_SPRITE_OPTIONS.haloScale = navBuild.haloScale;
  NAV_LIGHT_SPRITE_OPTIONS.minHaloWorld = navBuild.minHaloWorld;
  buildPositionLightWorldSprites(drawHex, NAV_LIGHT_SPRITE_OPTIONS);
  ShipLights3D.sync(state.navLightSprites, now * 0.001);

  let hasRenderable = false;
  const frameId = state.frameId;
  for (const entity of drawHex) {
    const beam = !entity.hexGrid;
    let data = state.entityMeshes.get(entity);
    // Encja zmieniła rodzaj ciała (heksy ↔ belki): stary mesh do zwolnienia.
    if (data && (data.kind === 'beam') !== beam) {
      state.entityMeshes.delete(entity);
      disposeMeshData(data);
      data = null;
    }
    if (!data) data = beam ? createBeamSkinMesh(entity) : createEntityMesh(entity);
    if (!data) continue;

    // Powrót do pudła rysowania po przerwie: przez ten czas nie liczyliśmy
    // instancji ani LOD-u, więc jedno pełne odświeżenie.
    if (data.lastDrawFrame !== frameId - 1) data.needsInstanceRefresh = true;
    if (beam) updateBeamSkinMesh(entity, data, camX, camY, cameraZoom);
    else updateEntityMesh(entity, data, camX, camY, cameraZoom);
    // updateEntityMesh potrafi przebudować dane encji — znacznik na aktualnych.
    (state.entityMeshes.get(entity) || data).lastDrawFrame = frameId;
    hasRenderable = true;
  }

  // Lampy i strefy dysz zapisane w tej klatce: jedna wersja bufora storage
  // (zakresy zmienionych slotów idą na GPU przy pierwszym rysowaniu kadłuba).
  HullLightStore.commit();

  // Pudło rozgrzania: mesh ma istnieć, zanim encja wejdzie w kadr (bez
  // przycięcia na tworzeniu), ale nic tu nie liczymy i nie rysujemy.
  for (const entity of visibleHex) {
    let data = state.entityMeshes.get(entity);
    if (data && data.lastDrawFrame === frameId) continue;
    if (!data) data = entity.hexGrid ? createEntityMesh(entity) : createBeamSkinMesh(entity);
    if (!data) continue;
    if (data.mesh?.visible) data.mesh.visible = false;
    if (data.armorMesh?.visible) data.armorMesh.visible = false;
  }

  // Okludery shadow shafts: sylwetka kadłuba jako pole odległości
  // (hullShadowSdf.js). Shader passa idzie po nim promieniem do słońca, więc
  // smuga zaczyna się na burcie, obejmuje kolce i rozwidlenia, a kadłub nie
  // rzuca cienia sam na siebie. Działa na każdym zoomie, także dla statków
  // tuż poza kadrem. Selekcja od największych — dostają warstwę i pieczenie
  // pierwsze; ring-segmenty pomijamy, pierścień ma własny okluder
  // (setShaftRingOccluder).
  if (typeof Core3D.beginShaftHullFrame === 'function') Core3D.beginShaftHullFrame();
  const shaftHullBudget = typeof Core3D.getShaftHullBudget === 'function' ? Core3D.getShaftHullBudget() : 0;
  if (shaftHullBudget > 0) {
    HullShadowSdf.beginFrame(frameId);
    Core3D.setShaftHullSdfTexture(HullShadowSdf.ensureTexture());
    const halfView = Math.max(window.innerWidth || 1920, window.innerHeight || 1080) * 0.5 / cameraZoom;
    const occluderReach = halfView + 30000;
    const cands = state.shaftHullCandidates || (state.shaftHullCandidates = []);
    cands.length = 0;
    for (const entity of valid) {
      if (entity.isRingSegment) continue;
      if (entity.hideHexVisual === true || entity.visual?.hideHexMesh === true) continue;
      const beam = !entity.hexGrid && isBeamHullEntity(entity);
      if (!entity.hexGrid && !beam) continue;
      const grid = beam ? beamShadowGrid(entity.beamHull) : entity.hexGrid;
      const scaleX = Math.abs(getEntityScaleX(entity)) || 1;
      const scaleY = Math.abs(getEntityScaleY(entity)) || 1;
      let w = (Number(grid.srcWidth) || 0) * scaleX;
      let h = (Number(grid.srcHeight) || 0) * scaleY;
      if (beam && (entity.isWreck === true || grid.isFragment === true)) {
        // Wrak na belkach: rozmiar z obrysu żywych węzłów (j. świata).
        const mm = entity.beamHull.body._boundsMinMax;
        w = mm[3] - mm[0];
        h = mm[4] - mm[1];
      } else if (entity.isWreck === true || grid.isFragment === true) {
        // Wrak/fragment: rozmiar z aktywnych heksów — src to sprite rodzica,
        // więc drobnica sortowała się jak cały okręt i zabierała mu slot cienia.
        const ext = getGridActiveExtent(grid, now);
        w = ext.halfW * 2 * scaleX;
        h = ext.halfH * 2 * scaleY;
      }
      const size = Math.max(w, h);
      if (size < 40) continue; // drobnica nie rzuca sensownego cienia
      const ex = getEntityPosX(entity);
      const ey = getEntityPosY(entity);
      if (Math.abs(ex - camX) > occluderReach || Math.abs(ey - camY) > occluderReach) continue;
      cands.push({ entity, grid, size, ex, ey, scaleX, scaleY });
    }
    lodFrameStats.shaftCands = cands.length;
    if (cands.length > 1) cands.sort((a, b) => b.size - a.size);
    let pushed = 0;
    for (let i = 0; i < cands.length && pushed < shaftHullBudget; i++) {
      const c = cands[i];
      // null = sylwetka czeka na pieczenie (budżet klatki) — cień od następnej.
      const occ = HullShadowSdf.acquire(c.grid, now);
      if (!occ) continue;
      const interpPose = getInterpolatedRenderPose(c.entity);
      const px = interpPose ? interpPose.x : c.ex;
      const py = interpPose ? interpPose.y : c.ey;
      const rawAng = interpPose ? interpPose.angle : (c.entity.angle || 0);
      // rotation.z mesha kadłuba (updateEntityMesh): -kąt, billboard +kąt.
      const rot = usesBillboardOrientation(c.entity) ? rawAng : -rawAng;
      packHullShaftOccluder(shaftOccluderScratch, 0, px, py, rot,
        getEntityScaleX(c.entity), getEntityScaleY(c.entity), occ.layout, occ.layer);
      // pushShaftHullSdf zwraca false po zapełnieniu rejestru — koniec.
      if (!Core3D.pushShaftHullSdf(shaftOccluderScratch, 0)) break;
      pushed++;
    }
    lodFrameStats.shaftHulls = pushed;
    lodFrameStats.shaftBakes = HullShadowSdf.stats.bakes;
  }

  // Wieżyczki: zbieramy je do bufora 2D, rysuje je pętla renderu w index.html.
  // Bufor MUSI powstać przed syncProjectiles — błyski wylotowe i początki
  // wiązek szukają w nim lufy, z której padł strzał.
  // Przelacznik "Bronie" w perf HUD gasi teraz wiezyczki 2D (wczesniej chowal
  // kontenery siatek) — zostaje dzwignia do porownania kosztu w locie.
  Turret2D.enabled = Core3D.perfToggles?.fgWeapons !== false;
  Turret2D.beginFrame();
  // Tylko pudło rysowania — Turret2D.draw i tak odrzuca wieżyczki spoza kadru,
  // a sync liczył je dla całych 9 ekranów.
  for (const entity of drawVfx) {
    const interpPose = getInterpolatedRenderPose(entity);
    const ex = interpPose ? interpPose.x : getEntityPosX(entity);
    const ey = interpPose ? interpPose.y : getEntityPosY(entity);
    const eAngle = interpPose ? interpPose.angle : (entity.angle || 0);
    const scale = getEntityScale(entity);
    Turret2D.sync(entity, ex, ey, eAngle, scale);
  }
  DrawCallStats.setTurrets2D(Turret2D.frameCount);
  // Wygaszanie odrzutu — raz na klatke, niezaleznie od liczby passow 2D
  // (split-screen rysuje ten sam bufor dwa razy).
  Turret2D.update();
  // Efekty broni (zadanie 17): pociski, smugi, lot, wstrząs strzałów, bank Fx3D — raz na klatkę
  // renderu, po Turret2D.sync (lufy wiązek ciągłych i błysków z rekordów tej klatki).
  WeaponFx.sync((typeof window !== 'undefined' && Array.isArray(window.bullets)) ? window.bullets : []);

  GpuDebrisManager.heatTintEnabled = state.damageTintEnabled;
  GpuDebrisManager.updateTime(now * 0.001);
  // Odłamki kadłubów na belkach (płyty i kształtowniki z dema).
  HullDebris3D.update(now * 0.001);
  updateDebrisRendering();

  for (const [entity] of state.entityMeshes) {
    if (!validSet.has(entity)) stale.push(entity);
  }
  for (const entity of stale) {
    const data = state.entityMeshes.get(entity);
    disposeMeshData(data);
    state.entityMeshes.delete(entity);
  }

  // Zimne wraki: sama smuga, po gorących (te mają pierwszeństwo w batchu).
  // Nie są okluderami cieni, źródłami świateł, rekordami Turret2D ani encjami
  // VFX — dlatego nie idą przez listę `entities`.
  if (Array.isArray(coldWrecks) && coldWrecks.length > 0) {
    const pushed = pushColdWreckImpostors(HexBodyImpostorBatch, coldWrecks, cullInfo, COLD_WRECK_CONFIG.impostorOpacity);
    if (pushed > 0) DrawCallStats.addImpostor(pushed);
    lodFrameStats.coldImpostors = pushed;
  }

  HexBodyImpostorBatch.flush();

  vfxEntities.push(...visibleVfx);
  EngineVfxSystem.update(visibleVfx);

  state.hadRenderableLastFrame = hasRenderable || visibleHex.length > 0;
  if (typeof window !== 'undefined') window.__hexLodStats = lodFrameStats;
}

function resetDrawPerfScratch() {
  drawPerfScratch.coreCallMs = 0;
  drawPerfScratch.coreRenderMs = 0;
  drawPerfScratch.composerMs = 0;
  drawPerfScratch.blitMs = 0;
}

function addCoreDrawPerf(coreCallMs) {
  drawPerfScratch.coreCallMs += coreCallMs;
  const corePerf = Core3D.lastFramePerf;
  if (!corePerf) return;
  drawPerfScratch.coreRenderMs += Number(corePerf.renderTotalMs) || 0;
  drawPerfScratch.composerMs += Number(corePerf.composerMs) || 0;
}

function publishDrawPerfScratch() {
  if (typeof window !== 'undefined') {
    window.__hexShips3DLastDrawPerf = drawPerfScratch;
  }
}

export function drawHexShips3D(ctx, width, height) {
  resetDrawPerfScratch();
  if (!ctx || !Core3D.isInitialized) {
    publishDrawPerfScratch();
    return;
  }
  const src = Core3D.canvas;
  if (!src) {
    publishDrawPerfScratch();
    return;
  }

  const w = Math.max(1, Number(width) || ctx.canvas?.width || 1);
  const h = Math.max(1, Number(height) || ctx.canvas?.height || 1);
  const isSplit = typeof window !== 'undefined'
    && window.splitScreenMode && Core3D.activeCam2;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (isSplit) {
    const halfW = Math.floor(w / 2);
    const srcW = src.width;
    const srcH = src.height;
    // Crop center 50% of the full render — correct perspective for half-screen
    const srcCropX = Math.floor(srcW / 4);
    const srcCropW = Math.floor(srcW / 2);

    // P1 (left half)
    let tDrawPerf0 = performance.now();
    Core3D.renderSingle(Core3D.activeCam1);
    addCoreDrawPerf(performance.now() - tDrawPerf0);
    tDrawPerf0 = performance.now();
    ctx.drawImage(src, srcCropX, 0, srcCropW, srcH, 0, 0, halfW, h);
    drawPerfScratch.blitMs += performance.now() - tDrawPerf0;

    // P2 (right half)
    tDrawPerf0 = performance.now();
    Core3D.renderSingle(Core3D.activeCam2);
    addCoreDrawPerf(performance.now() - tDrawPerf0);
    tDrawPerf0 = performance.now();
    ctx.drawImage(src, srcCropX, 0, srcCropW, srcH, halfW, 0, w - halfW, h);
    drawPerfScratch.blitMs += performance.now() - tDrawPerf0;
  } else {
    const tDrawPerf0 = performance.now();
    Core3D.renderSingle(Core3D.activeCam1);
    addCoreDrawPerf(performance.now() - tDrawPerf0);
    const tBlit0 = performance.now();
    ctx.drawImage(src, 0, 0, w, h);
    drawPerfScratch.blitMs += performance.now() - tBlit0;
  }

  ctx.restore();
  publishDrawPerfScratch();
}

// Kadłuby NPC: tekstura sprite'a i mapa kształtu lakieru powstawały przy
// pierwszym meshu danego typu w kadrze (upload + ~10 ms pieczenia w tej
// klatce), a po śmierci ostatniego statku typu były zwalniane — następna
// flota płaciła znowu. Rozgrzanie przy inicjalizacji ciała heksowego (NPC
// dostają je przy spawnie, także poza kadrem) trzyma stałą referencję: upload
// idzie w wolnej chwili z kolejki Core3D, lakier w kolejce pieczenia, oba
// zostają na resztę sesji (jeden egzemplarz na typ kadłuba).
const prewarmedHullImages = new WeakSet();
export function prewarmHexShipVisual(image) {
  if (!image || prewarmedHullImages.has(image) || !Core3D.isInitialized) return false;
  prewarmedHullImages.add(image);
  Core3D.queueTextureUpload(acquireSharedVisualTexture(image));
  HullLacquer.acquireShapeUniform(image);
  return true;
}

export function invalidateHexShipEntity3D(entity) {
  if (!entity) return false;
  const data = state.entityMeshes.get(entity);
  if (!data) return false;
  disposeMeshData(data);
  state.entityMeshes.delete(entity);
  return true;
}

// === ZIMNE WRAKI (src/game/coldWrecks.js) ===

function getWreckImpostorEnterPx() {
  const tuning = (typeof window !== 'undefined' && window.DevTuning) ? window.DevTuning : null;
  return Number.isFinite(Number(tuning?.wreckImpostorPx)) ? Number(tuning.wreckImpostorPx) : WRECK_IMPOSTOR_PX;
}

/**
 * Czy zamrożenie wraku przejdzie niezauważone: wrak jest poza pudłem
 * rysowania ostatniej klatki albo już leży w batchu smug (to samo kryterium
 * co updateEntityMesh), więc zamiana heksów na smugę nie przeskoczy obrazem.
 */
export function isColdFreezeVisuallySafe(entity) {
  const cull = state.lastCull;
  if (!entity || !cull) return true;
  if (!isEntityInDrawBox(entity, cull, state.lastCameraZoom)) return true;
  const data = state.entityMeshes.get(entity);
  if (data) return data.batchedImpostor === true;
  // W kadrze, ale bez meshu (dopiero wszedł): policz jak updateEntityMesh.
  const grid = entity.hexGrid;
  if (!grid) return true;
  const ext = getGridActiveExtent(grid, state.lastTime);
  const zoomPx = Math.max(0.0001, state.lastCameraZoom) * (Core3D.pixelRatio || 1);
  const bodyRadiusPx = Math.max(ext.halfW * Math.abs(getEntityScaleX(entity)), ext.halfH * Math.abs(getEntityScaleY(entity))) * zoomPx;
  return bodyRadiusPx < getWreckImpostorEnterPx();
}

// Kolor smugi per obraz kadłuba — ta sama średnia co data.impostorColor
// gorącego wraku (computeAverageBodyColor na visualImage/armorImage).
const coldImpostorColorBySource = new WeakMap();

/**
 * Przy zamrażaniu, PRZED invalidateHexShipEntity3D: kolor (z meshu, póki
 * istnieje) i gotowa smuga na zrzucie (`snapshot.color`, `snapshot.impostor`).
 */
export function captureColdWreckImpostor(entity, snapshot) {
  if (!entity || !snapshot?.extent) return false;
  let color = state.entityMeshes.get(entity)?.impostorColor || null;
  if (!color) {
    const source = snapshot.visualImage || snapshot.armorImage || entity.hexGrid?.cacheCanvas || null;
    if (source) {
      color = coldImpostorColorBySource.get(source);
      if (color === undefined) {
        color = computeAverageBodyColor(source) || null;
        coldImpostorColorBySource.set(source, color);
      }
    }
  }
  if (color) snapshot.color = { r: color.r, g: color.g, b: color.b };
  const angle = Number(entity.angle) || 0;
  const rot = usesBillboardOrientation(entity) ? angle : -angle;
  return !!prepareColdWreckImpostor(
    snapshot,
    getEntityPosX(entity),
    getEntityPosY(entity),
    rot,
    getEntityScaleX(entity),
    getEntityScaleY(entity)
  );
}

export function disposeHexShips3D() {
  for (const [, data] of state.entityMeshes) disposeMeshData(data);
  state.entityMeshes.clear();
  GpuDebrisManager.dispose();
  HullDebris3D.dispose();
  EngineVfxSystem.disposeAll();
  WeaponFx.reset();
  Turret2D.clear();
  ShipLights3D.dispose();
  HullShadowSdf.reset();
  disposeHullVariantProbes();
  state.navLightSprites.length = 0;
  state.navLightClusters.length = 0;
  state.frameId = 0;
  state.hadRenderableLastFrame = false;
}
