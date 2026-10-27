import { getEntityPosX, getEntityPosY, getEntityScaleX, getEntityScaleY, getEntityScale } from '../render/drawBox.js';
import * as THREE from 'three';
// Kadłuby na silniku belek (hullBodies.js). Nazwa modułu z czasów kadłubów heksowych — ścieżkę siatki heksów,
// płyty pancerza LOD i pulę szczątków GPU usunięto 2026-10-19 razem z silnikiem heksów (destructor.js).
import { isCanvasSource } from './canvas2d.js';
import { RenderWorld } from '../render/renderWorld.js';
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
  buildExternalLightIndex,
  computeRoadEmitterReach,
  createExternalLightIndex,
  createRoadEmitterReach,
  hasEntityLightSource,
  roadEmittersMayReach
} from '../game/shipLightRuntime.js';
import { ShipLights3D } from './shipLights3D.js';
import { allowsSolidArmorLod } from './hexLodPolicy.js';
import { DrawCallStats } from './drawCallStats.js';
import { HexBodyImpostorBatch, HexBodyLensBatch, computeAverageBodyColor } from './hexBodyImpostorBatch.js';
import { WARP_WORLD_LENS, WARP_LENS_SHARED, WARP_LENS_EXTRA, lensImageToWorld } from './warp/worldLens.js';
import { WARP_LENS_DOT_SWAP } from '../render/warpLensPhase.js';
// Pudła klatki (rozgrzanie / rysowanie) i próg smugi — wspólne z grą (src/game/coldWreckView.js, RW-31).
import {
  isEntityInCull, isEntityInDrawBox, DRAW_BOX_MARGIN_PX, WRECK_IMPOSTOR_PX, wreckImpostorEnterPx,
  beamBodyRadiusPx as beamBodyRadiusPxAt
} from '../render/drawBox.js';
import { pushColdWreckImpostors } from './coldWreckImpostors.js';
import { COLD_WRECK_CONFIG } from '../game/coldWrecks.js';
import { HullLacquer, MAX_ENGINE_ZONES, computeEngineZones } from './hullLacquer.js';
// Oświetlenie kadłubów v2 (2026-10-06): model PBR (hullLighting.js) i mapy powierzchni ze sprite'ów.
import { HullLighting } from './hullLighting.js';
import { HullSurface } from './hullSurface.js';
import { EngineFrame } from './engineFrame.js';
import { MAIN_EXHAUST_PALETTES } from '../data/engineFx.js';
import { HULL_SDF_OCCLUDER_FLOATS, HullShadowSdf, packHullShaftOccluder } from './hullShadowSdf.js';
import { WARP_HULL_SHADOW } from './warp/player.js';
import {
  HULL_EMPTY_SPRITE_TEXTURE,
  HULL_FLAT_NORMAL_TEXTURE,
  HULL_LIGHT_ZONE_OFFSET,
  HULL_SHARED,
  HULL_WARP_OFF,
  HullLightStore,
  HullNodeMaterial,
  HullObjectStore
} from './hexShips3D.tsl.js';
import { buildHullSkinTopology, writeHullSkin, writeHullSkinQuads, clearHullSkinDirty } from './beamHullSkin.js';
import { HullBodies, hullSpriteRotation } from '../game/hullBodies.js';
import { HullDebris3D } from './hullDebris3D.js';
import { HullSkinBatch } from './hullSkinBatch.js';
import { HullDamageMap } from './hullDamageMap.js';
import { cloakHidesShadow, cloakHullHolder, syncCloakDist, renderCloakLooks } from './cloak/hullCloak.js';

// Materiały kadłubów (skóra belek, partia skór, maskowanie) są w TSL:
// src/3d/hexShips3D.tsl.js — graf na wariant, wartości per encja
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
  // Indeks przestrzenny emiterów i grup lamp klatki — payload kadłuba sprawdza tylko światła z komórek swojego pudła.
  externalLightIndex: createExternalLightIndex(),
  navLightClusters: [],
  worldOmniLights: [],
  navLightSprites: [],
  staleEntities: [],
  validEntitySet: new Set()
};

// Poniżej tego promienia ekranowego CIAŁA wrak przestaje być rysowany własną
// skórą i wpada do wspólnego batcha smug. Dotyczy tylko wraków i fragmentów —
// żywe kadłuby rysują się zawsze skórą. Histereza trzyma przełączenie z dala
// od progu, żeby nie migotało przy powolnym zoomie.
const WRECK_IMPOSTOR_EXIT_MUL = 1.35;

// Liczniki klatki (PerfHUD „LOD kadłubów pełne/smugi”, culling, cienie). `fullHexes` / `totalStructuralHexes` —
// węzły kadłubów na belkach (nazwy z czasów heksów).
const lodFrameStats = {
  fullBodies: 0,
  impostorBodies: 0,
  fullHexes: 0,
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
  coldImpostors: 0,
  // Kropki soczewki skoku gracza (HexBodyLensBatch: encje z lensDot, zimne wraki, smugi rekordów dodatkowych).
  lensDots: 0
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

function usesBillboardLighting(entity) {
  return entity?.visual?.preserveBillboardLighting === true;
}

function usesBillboardOrientation(entity) {
  return entity?.visual?.preserveBillboardOrientation === true;
}

// Pudło rozgrzania i pudło RYSOWANIA (isEntityInCull, isEntityInDrawBox, DRAW_BOX_MARGIN_PX) — src/render/drawBox.js:
// te same reguły liczy gra (src/game/coldWreckView.js — flaga `__inDrawBox`, zimne wraki).

// SOCZEWKA ŚWIATA — FLOTY, NPC I WRAKI JAKO KROPKI (DECYZJE E2 / E3, etap 3A 2026-10-26): w skoku gracza encja, którą
// soczewka zastępuje (strona gry: index.html stampWarpLensDots → `__lensDot`, lustro workera: ENT_FLAG.LENS_DOT; skóra
// i dodatki schowane jak we mgle — predykat ukrycia), rysuje się kropką partii HexBodyLensBatch (jeden rysunek, pod
// kadłubami — WARP_LENS_DOT_Z) na swojej pozycji w soczewce (worldLens.js: WARP_LENS_SHARED.mapPoint — ta sama mapa
// i β co ciała; w wyjściu punkt wraca na prawdziwe miejsce w 0,3 s od przejścia frontu smug gwiazd, a kropka, której
// prawdziwe miejsce jest poza kadrem, gaśnie — out.alpha), barwa = średnia sprite'a jak smuga dalekiego wraku, najmniej
// ~2 px widocznej plamki, krycie × widoczność maskowania (wróg z maskowaniem nie świeci kropką). Zimne wraki mapuje
// render sam (smuga z migawki; udział soczewki ≥ WARP_LENS_DOT_SWAP — skóra i zwykła smuga pominięte w tej klatce).
// Rekordy dodatkowe soczewki ze smugą (olbrzymy pasa) — elipsa w barwie rekordu.
const LENS_DOT = Object.freeze({
  minHalfLen: 2.2,     // [px bufora] połowa długości kropki (miękki brzeg smugi zjada ~45% — widać ~2,4 px)
  minHalfWid: 1.8,     // [px bufora] połowa szerokości (widać ~2 px)
  fallback: Object.freeze({ r: 0.62, g: 0.66, b: 0.72 })   // encja bez sprite'a kadłuba (myśliwce)
});
const _lensImg = { x: 0, y: 0, q: 0, beta: 0, alpha: 1 };
const _lensWorld = { x: 0, y: 0, k: 1 };

function lensDotFlag(entity) {
  return entity.__mirror === true ? entity.lensDot === true : entity.__lensDot === true;
}

/** Smuga w partii kropek soczewki z obrazu [px bufora od środka kadru]; false — poza kadrem albo partia pełna. */
function pushLensSmudge(ix, iy, rot, pxL, pxW, r, g, b, opacity) {
  const L = WARP_WORLD_LENS;
  const reach = pxL > pxW ? pxL : pxW;
  if (Math.abs(ix) - reach > L.W * 0.5 || Math.abs(iy) - reach > L.H * 0.5) return false;
  const zoom = Math.max(1e-9, Number(L.zoom) || 1);
  lensImageToWorld(L, ix, iy, 0, true, _lensWorld);
  return HexBodyLensBatch.pushRaw(_lensWorld.x, -_lensWorld.y, rot, pxL / zoom, pxW / zoom, r, g, b, opacity);
}

/** Kropka encji z `lensDot` na jej pozycji w soczewce (mapPoint) — długość i barwa z kadłuba na belkach. */
function pushEntityLensDot(entity) {
  const ex = getEntityPosX(entity);
  const ey = getEntityPosY(entity);
  const hull = isBeamHullEntity(entity) ? entity.beamHull : null;
  let halfL;
  let halfW;
  let rot;
  let color = null;
  if (hull) {
    halfL = (Number(hull.srcWidth) || 0) * (Number(hull.scale) || 1) * 0.5;
    halfW = (Number(hull.srcHeight) || 0) * (Number(hull.scale) || 1) * 0.5;
    rot = -((Number(entity.angle) || 0) + hullSpriteRotation(entity));
    color = computeAverageBodyColor(hull.visualImage || hull.image);
  } else {
    halfL = Number(entity.radius) || Number(entity.r) || 60;
    halfW = halfL * 0.6;
    rot = -(Number(entity.angle) || 0);
  }
  const img = WARP_LENS_SHARED.mapPoint(ex, ey, _lensImg, halfL);
  // maskowanie (hak przekrojowy: rzecz przy kadłubie gaśnie z nim) — widoczność wyglądu maskowania encji
  const cl = entity.__cloakLook;
  const opacity = img.alpha * (cl && cl.active ? Math.max(0, Math.min(1, Number(cl.vis) || 0)) : 1);
  if (!(opacity > 0.004)) return false;
  const c = color || LENS_DOT.fallback;
  return pushLensSmudge(img.x, img.y, rot,
    Math.max(img.q * halfL, LENS_DOT.minHalfLen), Math.max(img.q * halfW, LENS_DOT.minHalfWid), c.r, c.g, c.b, opacity);
}

/**
 * Zimne wraki w soczewce: udział soczewki w miejscu wraku ≥ WARP_LENS_DOT_SWAP — smuga z migawki (`impostor`) na pozycji
 * soczewki, znacznik `_lensDotFrame` (skóra ciała i zwykła smuga pomijają wrak w tej klatce). Zwraca liczbę smug.
 */
function pushColdWreckLensDots(coldWrecks, frameId) {
  let n = 0;
  for (let i = 0; i < coldWrecks.length; i++) {
    const w = coldWrecks[i];
    const imp = w?._coldSnapshot?.impostor;
    if (!imp || w.dead) continue;
    const img = WARP_LENS_SHARED.mapPoint(imp.wx, imp.wy, _lensImg, imp.halfW);
    if (!(img.beta >= WARP_LENS_DOT_SWAP)) continue;
    w._lensDotFrame = frameId;
    w._coldSkinFrame = frameId;
    const alpha = (Number.isFinite(imp.opacity) ? imp.opacity : COLD_WRECK_CONFIG.impostorOpacity) * img.alpha;
    if (!(alpha > 0.004)) continue;
    if (pushLensSmudge(img.x, img.y, imp.rot, Math.max(img.q * imp.halfW, LENS_DOT.minHalfLen),
      Math.max(img.q * imp.halfH, LENS_DOT.minHalfWid), imp.r, imp.g, imp.b, alpha)) n++;
  }
  return n;
}

/** Rekordy dodatkowe soczewki ze smugą (olbrzymy pasa — worldLens.js: WARP_LENS_EXTRA, `smudge`): elipsa w kotwicy. */
function pushLensExtraSmudges() {
  const L = WARP_WORLD_LENS;
  const zoom = Math.max(1e-9, Number(L.zoom) || 1);
  const roll = Number(L.roll) || 0;
  const rc = roll ? Math.cos(roll) : 1;
  const rs = roll ? Math.sin(roll) : 0;
  let n = 0;
  for (let i = 0; i < WARP_LENS_EXTRA.length; i++) {
    const rec = WARP_LENS_EXTRA[i];
    const sm = rec.smudge;
    const a = rec.anchor;
    // smuga zastępuje prawdziwy widok od tego samego progu co kropki (właściciel chowa wtedy prawdziwy obiekt)
    if (!sm || !a || !a.on || !a.vis || !(a.px > 0.3) || !(1 - a.real >= WARP_LENS_DOT_SWAP)) continue;
    // kotwica = punkt płaszczyzny gry pod obrazem (tło z paralaksą — writeLensAnchor) → px od środka kadru (osie ekranu)
    const ux = (a.x - L.camX) * zoom;
    const uy = (a.y - L.camY) * zoom;
    if (pushLensSmudge(rc * ux + rs * uy, -rs * ux + rc * uy, Number(sm.rot) || 0,
      a.px * (Number(sm.ax) || 1), a.px * (Number(sm.ay) || 1), sm.r, sm.g, sm.b, 1)) n++;
  }
  return n;
}

function getInterpolatedRenderPose(entity) {
  const ship = RenderWorld.ship;
  if (!ship || entity !== ship) return null;
  const pose = RenderWorld.playerPose;
  if (!pose) return null;
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.angle)) return null;
  return pose;
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
  getGrid: (entity) => entity?.beamHull,
  out: null,
  time: 0,
  maxClusters: 256
};
const SHIP_LIGHT_PAYLOAD_OPTIONS = {
  ...SHIP_LIGHT_TRANSFORM_OPTIONS,
  externalOmniLights: null,
  // indeks przestrzenny świateł klatki (buildExternalLightIndex w updateHexShips3D)
  externalIndex: null
};

const NAV_LIGHT_SPRITE_OPTIONS = {
  ...SHIP_LIGHT_TRANSFORM_OPTIONS,
  getGrid: (entity) => entity?.beamHull,
  out: null,
  zoom: 1,
  minHaloWorld: 0
};

function createManagedTexture(source, isLinearData = false) {
  if (!source) return null;
  const isCanvas = isCanvasSource(source);
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
  // Zimny wrak bez świateł sąsiadów (COLD_WRECK_CONFIG.nearLights = false): ścieżka „bez lamp” niżej.
  if (entity.isCold === true && coldRenderHooks.config?.nearLights === false) bodyRadiusPx = 0;

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
  data.mesh?.geometry?.dispose?.();
  data.mesh?.material?.dispose?.();
  if (data.visualImageRef) releaseSharedVisualTexture(data.visualImageRef);
  else data.texture?.dispose?.();
  data.normalTexture?.dispose?.();
  if (data.shapeImageRef) HullLacquer.releaseShapeUniform(data.shapeImageRef);
  if (data.surfaceImageRef) HullSurface.releaseUniform(data.surfaceImageRef);
  if (data.lightSlot >= 0) {
    HullLightStore.release(data.lightSlot);
    data.lightSlot = -1;
  }
  if (data.batchEntry) {
    data.batch.remove(data.batchEntry);
    data.batchEntry = null;
  }
  const hullSlot = data.mesh?.material?.uniforms?.uHullSlot;
  if (hullSlot && hullSlot.value > 0) {
    HullObjectStore.release(hullSlot.value);
    hullSlot.value = 0;
  }
}

// Wartości per encja materiału kadłuba (skóra belek): obiekty `{ value }`, które
// HullObjectStore przepisuje do bufora storage slotu (graf wariantu — hexShips3D.tsl.js).
// Wartości wspólne dla wszystkich kadłubów (czas, strojenie światła, żar, lakier, maska
// słońca) są w węzłach grafu — tu ich nie ma. Lampy i strefy dysz: slot w
// HullLightStore (uLightBase), liczniki uShipLightCount / uEngineZoneCount.
function createHullUniforms(entity, texture, normalTexture, shapeUniform, srcWidth, srcHeight, surfaceUniform = null) {
  return {
      uSprite: { value: texture || HULL_EMPTY_SPRITE_TEXTURE },
      uNormalMap: { value: normalTexture || HULL_FLAT_NORMAL_TEXTURE },
      uHasNormalMap: { value: normalTexture ? 1 : 0 },
      // Mapa powierzchni (oświetlenie v2, hullSurface.js): obiekt `{ value }` wspólny dla kadłubów
      // z tym samym obrazem — wypiek w workerze podmienia teksturę wszystkim (do tego czasu płaska).
      uSurfaceMap: surfaceUniform || HullSurface.flatUniform,
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
      uLacquerGlint: { value: 1 },
      // Mapa ran (skóra belek, zadanie 18-C): slot puli (base, w, h, on) z HullDamageMap.bind,
      // rozmiar kadłuba w świecie (szum brzegu rany), właściciel świateł siatki (0 = żaden).
      uDmgSlot: { value: new THREE.Vector4(0, 1, 1, 0) },
      uDmgWorld: { value: new THREE.Vector2(1, 1) },
      uGridOwner: { value: 0 },
      // Siatka komórek kadłuba w uv sprite'a (komórki wzdłuż u, wzdłuż v; 0 — nieznana): płyty łat polowych roju
      // dronów naprawczych wyrównane do komórek (hexShips3D.tsl.js — wygląd łaty).
      uCellGrid: { value: new THREE.Vector2(0, 0) },
      // Warp „Nurt” (zadanie 22): odsłanianie, szew i żar brzegu — wartości pisze sterownik
      // warpa w entity.__warpHullU ({ a, b, c } — Vector4, px sprite'a); bez nich wyłączone.
      uWarpA: warpHullHolder(entity, 'a'),
      uWarpB: warpHullHolder(entity, 'b'),
      uWarpC: warpHullHolder(entity, 'c'),
      // Maskowanie (2026-10-04, src/game/cloakLook.js → entity.__cloakLook): mozaika heksów, poświata
      // brzegu, zakłócenie; bez wyglądu — wyłączone (gałąź shadera pominięta).
      uCloakA: cloakHullHolder(entity, 'a'),
      uCloakB: cloakHullHolder(entity, 'b'),
      uCloakC: cloakHullHolder(entity, 'c'),
      uCloakD: cloakHullHolder(entity, 'd'),
      uCloakE: cloakHullHolder(entity, 'e'),   // heksy-ekrany (2026-10-05)
      // Otwarty luk ładowni (2026-10-11, fregata zwiadu Atlasa — src/3d/cargo/scoutBay3D.js): prostokąt w uv sprite'a
      // (u0, v0, u1, v1), w którym skóra znika, póki wrota nie są zamknięte; entity.__bayCut — bez niego wyłączone.
      uBayCut: { get value() { return (entity && entity.__bayCut) || HULL_BAY_CUT_OFF; } },
      // Skóra belek (zadanie 23): slot w HullObjectStore — wartości wyżej i macierze kadłuba trafiają
      // do bufora storage przed passem ortho; w grupie „object” materiału zostaje tylko ten numer.
      uHullSlot: { value: 0 }
  };
}

// Partie skór kadłubów (hullSkinBatch.js, zadanie 23): jeden rysunek na zestaw tekstur (sprite albo obraz
// kadłuba, mapa normalnych, mapa kształtu lakieru) — ~145 rysunków skór w dużej bitwie → kilka. Siatka
// kadłuba (data.mesh) zostaje nośnikiem transformacji i material.uniforms (dane slotu), ale nie jest w scenie.
const _skinBatches = new Map();
const _batchImgIds = new WeakMap();
let _batchImgNext = 1;
function batchImgId(img) {
  if (!img) return 0;
  let id = _batchImgIds.get(img);
  if (!id) { id = _batchImgNext++; _batchImgIds.set(img, id); }
  return id;
}

function acquireSkinBatch(data) {
  const key = `${batchImgId(data.visualImageRef || data.armorImageRef)}|${batchImgId(data.normalMapRef)}|${batchImgId(data.shapeImageRef)}`;
  let batch = _skinBatches.get(key);
  if (batch) return batch;
  // Tekstury partii (własne referencje — kadłub i jego tekstury mogą zniknąć wcześniej niż partia)
  const texture = data.visualImageRef ? acquireSharedVisualTexture(data.visualImageRef) : createManagedTexture(data.armorImageRef);
  const normal = data.normalMapRef ? createManagedTexture(data.normalMapRef, true) : null;
  const shape = data.shapeImageRef ? HullLacquer.acquireShapeUniform(data.shapeImageRef) : HullLacquer.flatShapeUniform;
  // Mapa powierzchni (oświetlenie v2) — z obrazu partii (jak sprite), referencja na życie partii.
  const surfaceImg = data.visualImageRef || data.armorImageRef || null;
  const surface = surfaceImg ? HullSurface.acquireUniform(surfaceImg) : HullSurface.flatUniform;
  const material = new HullNodeMaterial('beamBatch', {
    uSprite: { value: texture || HULL_EMPTY_SPRITE_TEXTURE },
    uNormalMap: { value: normal || HULL_FLAT_NORMAL_TEXTURE },
    uShapeMap: shape,
    uSurfaceMap: surface
  });
  batch = new HullSkinBatch(key, material);
  batch.owned = { visualImageRef: data.visualImageRef, texture, normal, shapeImageRef: data.shapeImageRef };
  batch.mesh.visible = false;
  Core3D.scene.add(batch.mesh);
  _skinBatches.set(key, batch);
  return batch;
}

// Widoczność partii: bez widocznego kadłuba poza listą rysowania (three liczyłby jej wiązania co klatkę,
// a niewidoczne kadłuby i tak zwija wierzchołek). Wołane po pętli kadłubów (widoczność nośników ustalona).
function syncSkinBatches() {
  for (const batch of _skinBatches.values()) {
    const vis = batch.anyVisible();
    if (batch.mesh.visible !== vis) batch.mesh.visible = vis;
  }
  // Maskowanie: refrakcja tła w warstwie DIST na geometrii partii z maskowanym kadłubem (hullCloak.js).
  syncCloakDist(_skinBatches.values(), Core3D.scene);
}

// Zapis slotów HullObjectStore przed passem ortho (kamera TEGO passa — macierz model-widok jak three).
let _hullObjectHook = false;
function ensureHullObjectHook() {
  if (_hullObjectHook || typeof Core3D.addPassHook !== 'function') return;
  Core3D.addPassHook('ortho', (camera) => { HullObjectStore.commit(camera); });
  _hullObjectHook = true;
}

const HULL_BAY_CUT_OFF = new THREE.Vector4(0, 0, 0, 0);

function warpHullHolder(entity, key) {
  return {
    get value() {
      const w = entity ? entity.__warpHullU : null;
      return w ? w[key] : HULL_WARP_OFF[key];
    }
  };
}

// ============================ KADŁUBY NA BELKACH ============================
// Encja z `beamHull` (hullBodies.js): jeden mesh na ciało — czworokąt na węzeł, pozycje
// w układzie ciała, mesh.position = początek ciała w świecie (z pozy RENDERU encji,
// więc interpolacja gracza działa jak u heksów). Materiał = shader kadłubów gry.

// Opcja „Statki 3D” (src/3d/ships3d/shipModels3DGame.js): encja rysowana modelem 3D — bez skóry sprite'a
// (kadłub, cień SDF, lampy i efekty zostają). Predykat ustawia gra (index.html).
let beamSkinSuppressor = null;
export function setBeamSkinSuppressor(fn) {
  beamSkinSuppressor = typeof fn === 'function' ? fn : null;
}

// Mgła wojny (src/game/fogOfWar.js): encja ukryta przed graczem — bez kadłuba, lamp, wież, dysz i cienia, ale
// siatka ZOSTAJE (jak poza kadrem), żeby okręt na brzegu kręgu wzroku nie przebudowywał skóry. Predykat — gra.
let entityHiddenTest = null;
export function setEntityHiddenTest(fn) {
  entityHiddenTest = typeof fn === 'function' ? fn : null;
}

function isBeamHullEntity(entity) {
  const hull = entity?.beamHull;
  // bryła 3D (budowla, jej odłam — hullBodies.createSolid) nie ma sprite'a: rysuje ją skóra brył budowli (worldBodies3D)
  return !!hull && hull.entity === entity && !hull.solid3D && !!hull.body && !hull.body.dead && hull.body.activeNodes > 0;
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
  // Ciało świata (budowla, jej wyspa i odłam — worldBodies.js) skóry sprite'a nie ma nigdy, także na zapas w pudle
  // rozgrzania: rysuje je worldBodies3D, a `hull.image` to raster kawałka ({ width, height, data }) — tekstura, partia
  // i wypiek mapy powierzchni (HullSurface: createImageBitmap / drawImage rastra) szły na marne, z ostrzeżeniem
  // w konsoli na każdy kawałek bazy piratów (zgłoszenie 2026-10-27).
  if (hull.world) return null;
  const visualImage = hull.visualImage || null;
  const texture = visualImage ? acquireSharedVisualTexture(visualImage) : createManagedTexture(hull.image);
  const normalTexture = hull.normalMapImage ? createManagedTexture(hull.normalMapImage, true) : null;
  const shapeImageRef = (visualImage && allowsHullLacquer(entity)) ? visualImage : null;
  const shapeUniform = shapeImageRef ? HullLacquer.acquireShapeUniform(shapeImageRef) : HullLacquer.flatShapeUniform;
  // Mapa powierzchni (oświetlenie v2): z obrazu, który rysuje skóra (sprite albo obraz kadłuba).
  const surfaceImageRef = visualImage || hull.image || null;
  const surfaceUniform = surfaceImageRef ? HullSurface.acquireUniform(surfaceImageRef) : HullSurface.flatUniform;
  // Graf wariantu „beam” (hexShips3D.tsl.js): przezroczysty, z zapisem głębi,
  // DoubleSide w jednym przejściu (zgnieciony czworokąt potrafi się przewrócić —
  // z FrontSide zostałaby dziura).
  const material = new HullNodeMaterial('beam',
    createHullUniforms(entity, texture, normalTexture, shapeUniform, hull.srcWidth, hull.srcHeight, surfaceUniform));
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  ensureHullObjectHook();
  // Nośnik transformacji i danych slotu — rysuje go partia (hullSkinBatch.js), siatka poza sceną.
  mesh.userData.hullBatched = true;
  material.uniforms.uHullSlot.value = HullObjectStore.acquire(mesh);
  // Rozmiar kadłuba w świecie od razu (nie dopiero z slotem mapy ran): skala szumu poszarpanego brzegu
  // dziur (hullTearFray) i rany; HullDamageMap.bind wpisuje tę samą wartość.
  material.uniforms.uDmgWorld.value.set(hull.srcWidth * hull.scale, hull.srcHeight * hull.scale);
  if (hull.pixelPitch > 0) material.uniforms.uCellGrid.value.set(hull.srcWidth / hull.pixelPitch, hull.srcHeight / hull.pixelPitch);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.castShadow = false;
  const data = {
    kind: 'beam',
    mesh,
    texture,
    visualImageRef: visualImage,
    armorImageRef: visualImage ? null : hull.image,
    shapeImageRef,
    surfaceImageRef,
    normalTexture,
    normalMapRef: hull.normalMapImage || null,
    hull,
    body: hull.body,
    topo: null,
    positions: null,
    shade: null,
    heat: null,
    tear: null,
    visibleQuads: 0,
    needsFullWrite: true,
    srcWidth: hull.srcWidth,
    srcHeight: hull.srcHeight,
    pivotX: hull.pivot.x,
    pivotY: hull.pivot.y,
    // Slot lamp i stref dysz w HullLightStore (-1 = brak).
    lightSlot: -1,
    batch: null,
    batchEntry: null
  };
  data.batch = acquireSkinBatch(data);
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
  data.tear = new Float32Array(vertices);
  data.topo = topo;
  setBeamSkinHeatClock(topo);
  data.visibleQuads = writeHullSkin(body, topo, data.positions, data.shade, data.heat, data.tear);
  clearHullSkinDirty(body);
  data.needsFullWrite = false;
  body.meshDirty = false;
  // Partia (zadanie 23): stary wpis (poprzednia topologia) znika, nowy na końcu partii z całą skórą —
  // wysyłka tylko zmienionych czworokątów w kolejnych klatkach (zbierzZakresy partii).
  if (data.batchEntry) data.batch.remove(data.batchEntry);
  data.batchEntry = data.batch.add(data.mesh.material.uniforms.uHullSlot.value, topo, data.positions, data.shade, data.heat, data.mesh, data.tear);
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
  const region = body._region;
  if (!data.needsFullWrite && region && region.store === body.nodeStore && !region.dirtyAll) {
    if (region.dirtyCount > 0) {
      const range = writeHullSkinQuads(body, topo, data.positions, data.shade, data.heat,
        region.dirty, region.dirtyCount, _beamSkinRange, data.tear);
      clearHullSkinDirty(body);
      if (range.max >= range.min) {
        data.batch.writeQuads(data.batchEntry, data.positions, data.shade, data.heat, range.min, range.max);
      }
    }
    data.visibleQuads = body.activeNodes;
  } else {
    data.visibleQuads = writeHullSkin(body, topo, data.positions, data.shade, data.heat, data.tear);
    clearHullSkinDirty(body);
    data.batch.writeAll(data.batchEntry, data.positions, data.shade, data.heat);
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
    const tuning = RenderWorld.devTuning || null;
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
  const sun = RenderWorld.sun;
  if (sun) uniforms.uLightDir.value.set(sun.x - ex, -(sun.y - ey), 600).normalize();
  uniforms.uBillboardLighting.value = usesBillboardLighting(entity) ? 1 : 0;
  const bodyRadiusPx = Math.max(hull.srcWidth, hull.srcHeight) * 0.5 * entityScale * zoomPx;
  syncEntityLightUniforms(entity, data, hull, state.roadLightEmitters, bodyRadiusPx);
  syncEntityLacquer(entity, data, hull, entityScale, zoomPx);
  // Mapa ran rodu (kadłub, wrak, odłamy — wspólny klucz): slot do materiału, widoczność dla LRU.
  HullDamageMap.bind(hull.dmgKey, uniforms);
  uniforms.uRotation.value = theta;

  // __skinZ: kadłub pod innym w passie ortho (holownik serwisowy pod statkiem na pokładzie — serviceTugGame.js).
  // __renderScale: obraz okrętu mniejszy wokół jego środka (fregata zwiadu na dnie luku Atlasa — scoutBay3D.js).
  const rs = Number(entity.__renderScale);
  if (rs > 0 && rs !== 1) {
    mesh.position.set(ex + (originX - ex) * rs, -ey + (originY + ey) * rs, Number(entity.__skinZ) || 0);
    mesh.rotation.set(0, 0, theta);
    mesh.scale.set(rs, rs, rs);
  } else {
    mesh.position.set(originX, originY, Number(entity.__skinZ) || 0);
    mesh.rotation.set(0, 0, theta);
    mesh.scale.set(1, 1, 1);
  }
  mesh.visible = data.visibleQuads > 0;
  // nośnik poza sceną (partia) — macierz świata jak z scene.updateMatrixWorld (dziecko sceny)
  mesh.updateMatrixWorld();

  if (mesh.visible) DrawCallStats.addHexBody(1, !allowsSolidArmorLod(entity));
  lodFrameStats.totalStructuralHexes += body.activeNodes;
  lodFrameStats.fullBodies++;
  lodFrameStats.fullHexes += body.activeNodes;
}

export function initHexShips3D({ canvas = null } = {}) {
  if (!Core3D.isInitialized) Core3D.init(canvas);
  ensureShipLightPanelApi();
  return true;
}

// Trzymacze grafów kadłubów: jeden ukryty mesh na wariant (skóra belek, partia
// skór) z materiałem, którego nie zwalniamy. NodeManager usuwa stan budowy
// materiału (i pipeline), gdy ostatni obiekt przestaje go używać — bez trzymacza
// śmierć ostatniego kadłuba w kadrze kosztowałaby pełną przebudowę grafu przy
// następnym spawnie. Rozgrzewka (prewarmPass) buduje je na ekranie ładowania,
// więc pierwszy kadłub bierze gotowy pipeline. (Do 2026-10-19 także płyta
// pancerza LOD kadłubów heksowych — w grze nieużywana, a kompilowana przy starcie.)
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
  // partia skór (zadanie 23): ten sam układ atrybutów co HullSkinBatch
  const batchGeo = new THREE.BufferGeometry();
  batchGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  batchGeo.setAttribute('aShadeHeat', new THREE.BufferAttribute(new Float32Array(16), 4));
  batchGeo.setAttribute('aUvSlot', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0]), 3));
  batchGeo.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
  const batchProbe = new THREE.Mesh(batchGeo, new HullNodeMaterial('beamBatch', holders()));
  batchProbe.renderOrder = 10;
  for (const m of [beam, batchProbe]) {
    m.name = `hullProbe:${m.material.name}`;
    m.frustumCulled = false;
    m.visible = false;
    Core3D.scene.add(m);
  }
  _hullProbes = [beam, batchProbe];
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
  // Kadłuby (graf na wariant): pipeline skóry belek i partii skór przed
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
  // Mapa ran: krok klatki efektów (kernel kompiluje się na ekranie ładowania, pula powstaje na GPU).
  HullDamageMap.ensureStep();
  return true;
}

export function resizeHexShips3D(width, height) {
  if (Core3D.isInitialized) Core3D.resize(width, height);
}

// Poświata dysz MAIN na blachę (oświetlenie v2): gromada dysz okrętu z tej klatki (EngineFrame — te same
// dysze, moc i paleta co struga MAIN i poświata na pyle) = światło punktowe tuż za wylotem, barwą palety;
// przy ciągu i dopalaczu rufa, dysze i krawędzie zwrócone do wydechu łapią światło (także sąsiednie kadłuby).
// Rozproszenie w ośrodku 0 — pył ma własną poświatę dysz (writeDustPlumes).
function pushEngineHullLights() {
  const lights = Core3D.fx ? Core3D.fx.lights : null;
  if (!lights || !HullLighting.isPbr()) return;
  const gain = HullLighting.engineGain();
  if (!(gain > 0)) return;
  const F = EngineFrame;
  for (let k = 0; k < F.count; k++) {
    const p = Math.min(F.power[k], 1.5);
    if (!(p > 0.06)) continue;
    const pal = MAIN_EXHAUST_PALETTES[F.palette[k]] || MAIN_EXHAUST_PALETTES[0];
    const c = pal.light || pal.spark || ENGINE_LIGHT_FALLBACK;
    const R = F.radius[k];
    const back = R * 0.8;
    // EngineFrame w układzie SCENY (y w górę) → świat gry (y w dół)
    const x = F.x[k] + F.dirX[k] * back;
    const y = -(F.y[k] + F.dirY[k] * back);
    lights.point(x, y, c[0], c[1], c[2], gain * p, (F.spread[k] + 4 * R) * 2.5, R * 1.5 + 15, 0);
  }
}
const ENGINE_LIGHT_FALLBACK = Object.freeze([0.5, 0.7, 1.0]);

// Wartości wspólne kadłubów (węzły HULL_SHARED, hexShips3D.tsl.js): raz na klatkę
// zamiast per mesh. Strojenie światła z panelu (window.__shipLightTune) tylko przy
// zmianie epoki; zanik i jasność żaru skóry belek z HULL_BODY_CONFIG.
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
  shared.beamHeatDecay.value = Math.max(0, Number(HullBodies.config.heatDecay) || 0);
  shared.beamHeatPeak.value = Math.max(0, Number(HullBodies.config.heatGlowPeak) || 0);
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

export function updateHexShips3D(viewCamera, entities = [], cullInfo = null, coldWrecks = null, cloakFrame = null) {
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
  // Oświetlenie v2: strojenie → wspólne węzły, kolejka wypieku map powierzchni (worker). Wieże 3D czytają
  // maskę słońca w materiale (B3D — kanwa wieżyczek nie rysuje).
  HullLighting.update();
  HullSurface.pump();

  const camX = Number(viewCamera?.x) || 0;
  const camY = Number(viewCamera?.y) || 0;
  const cameraZoom = Math.max(0.0001, Number(viewCamera?.zoom) || 1);
  state.lastCull = cullInfo;
  state.lastCameraZoom = cameraZoom;
  DrawCallStats.begin();
  HexBodyImpostorBatch.begin();
  // Soczewka skoku gracza (E2): kropki flot i wraków — tylko gdy soczewka tej klatki żyje (planet3d: update przed nami).
  const lensDots = WARP_LENS_SHARED.live && WARP_WORLD_LENS.active === true;
  HexBodyLensBatch.begin();
  lodFrameStats.fullBodies = 0;
  lodFrameStats.impostorBodies = 0;
  lodFrameStats.fullHexes = 0;
  lodFrameStats.totalStructuralHexes = 0;
  lodFrameStats.entitiesIn = 0;
  lodFrameStats.culled = 0;
  lodFrameStats.warmOnly = 0;
  lodFrameStats.shaftCands = 0;
  lodFrameStats.shaftHulls = 0;
  lodFrameStats.shaftBakes = 0;
  lodFrameStats.coldImpostors = 0;
  lodFrameStats.lensDots = 0;

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
      continue;
    }
    const hasBody = isBeamHullEntity(entity);
    if (hasBody) validSet.add(entity);
    // kropka soczewki (E2) — skórę i dodatki chowa predykat ukrycia niżej (lensDot ⊂ ukryte)
    if (lensDots && lensDotFlag(entity) && pushEntityLensDot(entity)) lodFrameStats.lensDots++;
    if (entityHiddenTest && entityHiddenTest(entity)) {
      entity.__hiddenFromView = true;
      const data = state.entityMeshes.get(entity);
      if (data?.mesh) data.mesh.visible = false;
      continue;
    }
    entity.__hiddenFromView = false;

    const visible = isEntityInCull(entity, cullInfo);
    if (!visible) {
      lodFrameStats.culled++;
      const data = state.entityMeshes.get(entity);
      if (data?.mesh) data.mesh.visible = false;
      continue;
    }

    visibleVfx.push(entity);
    // Flagę `entity.__inDrawBox` (LOD dysz w engineVfxSystem.js, stan dysz w modelu lotu) liczy GRA przed tym
    // przebiegiem z tych samych reguł (src/game/coldWreckView.js stampDrawBoxFlags, RW-31) — render jej nie pisze.
    const inDrawBox = isEntityInDrawBox(entity, cullInfo, cameraZoom);
    if (inDrawBox) drawVfx.push(entity);
    else lodFrameStats.warmOnly++;
    if (!hasBody) continue;
    visibleHex.push(entity);
    if (inDrawBox) drawHex.push(entity);
  }

  // Maskowanie: wygląd tej klatki liczy gra przed updateHexShips3D (RW-26 — src/game/cloakLooks.js, `cloakFrame`);
  // tu obraz (src/3d/cloak/hullCloak.js) PRZED światłami i dyszami tej klatki (gaszą się z komórką pod sobą —
  // cloakVisAtWorld), cząstki frontu i zerwania, wizjer.
  renderCloakLooks(cloakFrame, cameraZoom * (Core3D.pixelRatio || 1));

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
  SHIP_LIGHT_PAYLOAD_OPTIONS.externalIndex = buildExternalLightIndex(state.externalLightIndex, state.roadLightEmitters, state.navLightClusters);

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
    // Model 3D zamiast skóry: nośnik chowa pętla pudła rozgrzania niżej (lastDrawFrame ≠ tej klatki).
    if (beamSkinSuppressor !== null && beamSkinSuppressor(entity)) continue;
    let data = state.entityMeshes.get(entity);
    if (!data) data = createBeamSkinMesh(entity);
    if (!data) continue;
    updateBeamSkinMesh(entity, data, camX, camY, cameraZoom);
    // updateBeamSkinMesh potrafi przebudować dane encji (nowe ciało) — znacznik na aktualnych.
    (state.entityMeshes.get(entity) || data).lastDrawFrame = frameId;
    hasRenderable = true;
  }

  // Zimne wraki w soczewce skoku (E2): smugi na pozycjach soczewki — przed skórą ciał i zwykłą smugą (znacznik klatki).
  if (lensDots && Array.isArray(coldWrecks) && coldWrecks.length > 0) lodFrameStats.lensDots += pushColdWreckLensDots(coldWrecks, frameId);
  // Zimne wraki na belkach (src/game/coldWrecks.js): w kadrze i większe od smugi — skóra z ciała do rysowania
  // (poza fizyką, ta sama skóra, mapa ran i cień co u wraku śpiącego); pozostałe — smuga z migawki (niżej).
  if (Array.isArray(coldWrecks) && coldWrecks.length > 0 &&
      updateColdBeamWrecks(coldWrecks, cullInfo, camX, camY, cameraZoom, frameId, valid, validSet)) {
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
    if (!data) data = createBeamSkinMesh(entity);
    if (!data) continue;
    if (data.mesh?.visible) data.mesh.visible = false;
  }
  // Partie skór: widoczność po ustaleniu widoczności wszystkich nośników (kadr, pudło rozgrzania).
  syncSkinBatches();

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
    const halfView = Math.max(RenderWorld.viewWidth || 1920, RenderWorld.viewHeight || 1080) * 0.5 / cameraZoom;
    const occluderReach = halfView + 30000;
    const cands = state.shaftHullCandidates || (state.shaftHullCandidates = []);
    cands.length = 0;
    for (const entity of valid) {
      if (entity.isRingSegment) continue;
      if (entity.hideHexVisual === true || entity.visual?.hideHexMesh === true) continue;
      if (entity.__hiddenFromView === true) continue;   // mgła wojny: cień zdradzałby okręt
      if (cloakHidesShadow(entity)) continue;            // maskowanie: ukryty kadłub nie rzuca cienia
      if (!isBeamHullEntity(entity)) continue;
      const grid = beamShadowGrid(entity.beamHull);
      const scaleX = Math.abs(getEntityScaleX(entity)) || 1;
      const scaleY = Math.abs(getEntityScaleY(entity)) || 1;
      let w = (Number(grid.srcWidth) || 0) * scaleX;
      let h = (Number(grid.srcHeight) || 0) * scaleY;
      if (entity.isWreck === true || grid.isFragment === true) {
        // Wrak / odłam: rozmiar z obrysu żywych węzłów (j. świata) — src to sprite rodzica,
        // więc drobnica sortowałaby się jak cały okręt i zabierała mu slot cienia.
        const mm = entity.beamHull.body._boundsMinMax;
        w = mm[3] - mm[0];
        h = mm[4] - mm[1];
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
      // Gracz w skoku: cień gaśnie (warp/player.js: WARP_HULL_SHADOW — tło skoku w nieskończoności).
      const strength = c.entity === RenderWorld.ship ? WARP_HULL_SHADOW.player : 1;
      if (!(strength > 0.001)) continue;
      // null = sylwetka czeka na pieczenie (budżet klatki) — cień od następnej.
      const occ = HullShadowSdf.acquire(c.grid, now);
      if (!occ) continue;
      const interpPose = getInterpolatedRenderPose(c.entity);
      const px = interpPose ? interpPose.x : c.ex;
      const py = interpPose ? interpPose.y : c.ey;
      const rawAng = interpPose ? interpPose.angle : (c.entity.angle || 0);
      // obrót jak skóra kadłuba: -kąt, billboard +kąt.
      const rot = usesBillboardOrientation(c.entity) ? rawAng : -rawAng;
      const rsc = Number(c.entity.__renderScale) > 0 ? Number(c.entity.__renderScale) : 1;
      packHullShaftOccluder(shaftOccluderScratch, 0, px, py, rot,
        getEntityScaleX(c.entity) * rsc, getEntityScaleY(c.entity) * rsc, occ.layout, occ.layer, strength);
      // pushShaftHullSdf zwraca false po zapełnieniu rejestru — koniec.
      if (!Core3D.pushShaftHullSdf(shaftOccluderScratch, 0)) break;
      pushed++;
    }
    lodFrameStats.shaftHulls = pushed;
    lodFrameStats.shaftBakes = HullShadowSdf.stats.bakes;
  }

  // Wieżyczki: rekordy klatki (Turret2D) — rysuje je partia wież 3D (shipModels3DGame.js, B3D).
  // Bufor MUSI powstać przed syncProjectiles — błyski wylotowe i początki
  // wiązek szukają w nim lufy, z której padł strzał.
  // Przełącznik "Bronie" w perf HUD gasi rekordy (a z nimi wieże 3D) — dźwignia do porównania kosztu w locie.
  // Rekordy wież liczy gra przed updateHexShips3D (RW-26: Turret2D.syncFrame w render() index.html — te same encje,
  // co drawVfx: src/render/drawBox.js), razem z odrzutem (strzały — WeaponShotBus w index.html).
  DrawCallStats.setTurrets2D(Turret2D.frameCount);
  // Efekty broni (zadanie 17): pociski, smugi, lot, wstrząs strzałów, bank Fx3D — raz na klatkę
  // renderu, po Turret2D.sync (lufy wiązek ciągłych i błysków z rekordów tej klatki).
  WeaponFx.sync(Array.isArray(RenderWorld.bullets) ? RenderWorld.bullets : []);

  // Odłamki kadłubów na belkach (płyty i kształtowniki z dema).
  HullDebris3D.update(now * 0.001);

  for (const [entity] of state.entityMeshes) {
    if (!validSet.has(entity)) stale.push(entity);
  }
  for (const entity of stale) {
    const data = state.entityMeshes.get(entity);
    disposeMeshData(data);
    state.entityMeshes.delete(entity);
  }

  // Zimne wraki: smuga, po gorących (te mają pierwszeństwo w batchu). Nie są
  // źródłami świateł, rekordami Turret2D ani encjami VFX — dlatego nie idą przez
  // listę `entities`. Wraki na belkach rysowane w tej klatce skórą (albo jej smugą
  // z updateBeamSkinMesh) mają znacznik `_coldSkinFrame` i tu ich nie ma.
  if (Array.isArray(coldWrecks) && coldWrecks.length > 0) {
    const pushed = pushColdWreckImpostors(HexBodyImpostorBatch, coldWrecks, cullInfo, COLD_WRECK_CONFIG.impostorOpacity, frameId);
    if (pushed > 0) DrawCallStats.addImpostor(pushed);
    lodFrameStats.coldImpostors = pushed;
  }

  HexBodyImpostorBatch.flush();
  // Kropki soczewki: rekordy dodatkowe ze smugą (olbrzymy pasa), potem jeden rysunek partii (pusta — schowana).
  if (lensDots) lodFrameStats.lensDots += pushLensExtraSmudges();
  HexBodyLensBatch.flush();

  vfxEntities.push(...visibleVfx);
  // margines pudła rysowania [j. świata] — okręt spoza pudła ma kadłub co najmniej tyle za kadrem (LOD dysz SIDE);
  // kadr (środek i połowy boków) — LOD dysz MAIN za kadrem
  EngineVfxSystem.update(visibleVfx, cullInfo ? DRAW_BOX_MARGIN_PX / cameraZoom : Infinity, cullInfo);
  pushEngineHullLights();

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
  const isSplit = RenderWorld.splitScreenMode && Core3D.activeCam2;

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
  // Mapa powierzchni (oświetlenie v2): wypiek w workerze rusza przy spawnie, nie przy pierwszym widoku.
  HullSurface.acquireUniform(image);
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

/**
 * Sprite kadłuba encji (tekstura z mipmapami, flipY = false) — smuga sylwetki warpa
 * (src/3d/warp/warpNurt.js). null, gdy encja nie ma jeszcze siatki.
 */
export function getEntityHullSprite(entity) {
  const data = entity ? state.entityMeshes.get(entity) : null;
  const tex = data?.mesh?.material?.uniforms?.uSprite?.value;
  return (tex && tex.isTexture && tex !== HULL_EMPTY_SPRITE_TEXTURE) ? tex : null;
}

// === ZIMNE WRAKI (src/game/coldWrecks.js) ===

function getWreckImpostorEnterPx() {
  return wreckImpostorEnterPx(RenderWorld.devTuning || null);
}

// Haki gry (index.html): które zimne wraki na belkach mają w tej klatce ciało do rysowania (`drawn` — wybiera je GRA
// przed tym przebiegiem: src/game/coldWreckView.js selectColdRenderBodies, budżet węzłów coldWreckSystem; RW-31 — render
// nie prosi gry o ciało) i konfiguracja systemu zimnych (COLD_WRECK_CONFIG z nadpisaniami, strojenie na żywo).
const coldRenderHooks = { drawn: null, config: null, listedForExtras: null };
export function setColdWreckRenderHooks(hooks = {}) {
  coldRenderHooks.drawn = typeof hooks.drawn === 'function' ? hooks.drawn : null;
  coldRenderHooks.config = hooks.config || null;
  coldRenderHooks.listedForExtras = typeof hooks.listedForExtras === 'function' ? hooks.listedForExtras : null;
}

// Promień zasięgu żywych węzłów kadłuba na belkach na ekranie [px] — miara smugi z updateBeamSkinMesh.
function beamBodyRadiusPx(entity, zoom) {
  return beamBodyRadiusPxAt(entity, zoom, Core3D.pixelRatio);
}

/**
 * (Gra liczy to samo sama — src/game/coldWreckView.js coldFreezeVisuallySafe, RW-31; tu zostaje zapas po stronie
 * renderu.)
 * Czy zamrożenie wraku przejdzie niezauważone: wrak jest poza pudłem rysowania ostatniej klatki albo — przy pełnym
 * wyglądzie zimnego (staticSkin + nearExtras — ta sama skóra, mostek, rdzeń i cień co u śpiącego) — w kadrze do
 * `inViewFreezeMaxPx`; bez niego — tylko na poziomie smugi. Ukryty mgłą wojny w kadrze — nie (zimny rysuje się jak
 * teren, bez mgły).
 */
export function isColdFreezeVisuallySafe(entity, config = null) {
  const cull = state.lastCull;
  if (!entity || !cull) return true;
  if (!isEntityInDrawBox(entity, cull, state.lastCameraZoom)) return true;
  const data = state.entityMeshes.get(entity);
  if (isBeamHullEntity(entity)) {
    if (entity.__hiddenFromView === true) return false;
    const cfg = config || coldRenderHooks.config || COLD_WRECK_CONFIG;
    const rPx = beamBodyRadiusPx(entity, state.lastCameraZoom);
    if (cfg.staticSkin !== false && cfg.nearExtras !== false) {
      const limit = Number(cfg.inViewFreezeMaxPx);
      return !(limit < Infinity) || rPx < limit;
    }
    if (data) return data.batchedImpostor === true;
    return rPx < getWreckImpostorEnterPx();
  }
  return true;
}

/**
 * Zimne wraki na belkach w tej klatce (z updateHexShips3D, po kadłubach z listy encji). Ciało do rysowania wybiera
 * GRA przed tym przebiegiem (src/game/coldWreckView.js selectColdRenderBodies: wrak w pudle rysowania i większy od
 * 0,8 progu smugi, z ciałem — do połowy progu albo poza kadrem w pudle rozgrzania; budżet węzłów na klatkę) i oznacza
 * je (`coldRenderHooks.drawn`); reszta — smuga z migawki w pushColdWreckImpostors.
 * Wrak z ciałem: ta sama ścieżka skóry co wrak śpiący (updateBeamSkinMesh: skóra albo jej smuga, mapa ran,
 * lakier); w pudle rozgrzania poza kadrem — siatka czeka ukryta. Z nearExtras trafia do `valid` (cień SDF).
 * Model 3D okrętu („Statki 3D”) rysuje syncShipModels3D z listy encji zimnych z ciałem (index.html).
 * Zwraca, czy narysowano jakąś skórę.
 */
function updateColdBeamWrecks(coldWrecks, cull, camX, camY, cameraZoom, frameId, valid, validSet) {
  const drawn = coldRenderHooks.drawn;
  if (!drawn) return false;
  const cfg = coldRenderHooks.config || COLD_WRECK_CONFIG;
  const boxed = !!cull && Number.isFinite(cull.x) && Number.isFinite(cull.y);
  const drawBoxed = boxed && Number.isFinite(cull.drawHalfW) && Number.isFinite(cull.drawHalfH);
  const margin = DRAW_BOX_MARGIN_PX / Math.max(0.0001, cameraZoom);
  const extras = cfg.nearExtras !== false;
  let drew = false;
  for (let i = 0; i < coldWrecks.length; i++) {
    const w = coldWrecks[i];
    const snap = w?._coldSnapshot;
    if (!snap || snap.kind !== 'beam' || w.dead) continue;
    const imp = snap.impostor;
    if (!imp) continue;
    if (boxed && (Math.abs(imp.wx - cull.x) > cull.halfW + imp.reach || Math.abs(imp.wy - cull.y) > cull.halfH + imp.reach)) continue;
    const inDraw = !drawBoxed || (Math.abs(imp.wx - cull.x) <= cull.drawHalfW + imp.reach + margin &&
      Math.abs(imp.wy - cull.y) <= cull.drawHalfH + imp.reach + margin);
    if (!drawn(w) || !isBeamHullEntity(w)) continue;
    // w soczewce skoku (pushColdWreckLensDots) — smuga soczewki zamiast skóry
    if (w._lensDotFrame === frameId) {
      validSet.add(w);   // siatka zostaje (jak poza kadrem) — bez przebudowy skóry po skoku
      const hidden = state.entityMeshes.get(w);
      if (hidden?.mesh?.visible) hidden.mesh.visible = false;
      continue;
    }
    // Zimny rysuje się jak teren — bez mgły wojny (flaga z czasu, gdy był na liście encji, nie gasi cienia).
    w.__hiddenFromView = false;
    validSet.add(w);
    if (extras) valid.push(w);
    let data = state.entityMeshes.get(w);
    // Model 3D okrętu („Statki 3D”) rysuje syncShipModels3D tylko z nearExtras — bez nich skóra jak u „Statków 2D”.
    const modelDrawn = extras && beamSkinSuppressor !== null && beamSkinSuppressor(w) &&
      (coldRenderHooks.listedForExtras === null || coldRenderHooks.listedForExtras(w));
    if (!inDraw || modelDrawn) {
      if (data?.mesh?.visible) data.mesh.visible = false;
      if (modelDrawn) w._coldSkinFrame = frameId;
      continue;
    }
    if (!data) data = createBeamSkinMesh(w);
    if (!data) continue;
    updateBeamSkinMesh(w, data, camX, camY, cameraZoom);
    (state.entityMeshes.get(w) || data).lastDrawFrame = frameId;
    w._coldSkinFrame = frameId;
    drew = true;
  }
  return drew;
}

export function disposeHexShips3D() {
  for (const [, data] of state.entityMeshes) disposeMeshData(data);
  state.entityMeshes.clear();
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
