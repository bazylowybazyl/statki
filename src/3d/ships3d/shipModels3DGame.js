// ============================================================
// Modele 3D okrętów i broni w grze 2D — opcje nowej gry „Statki 2D / 3D” i „Bronie 2D / 3D”
// (src/game/visualMode.js, menu „Nowa gra”; 2026-09-30). Rozgrywka bez zmian — model to tylko wygląd.
//
//  • Statki 3D: encja z modelem w rejestrze (ships/ships3D.js) i kadłubem na belkach (HullBodies, sprite)
//    rysuje się bryłą 3D zamiast skóry sprite'a (hexShips3D ją pomija — setBeamSkinSuppressor). Bryła jest
//    skórą FFD na węzłach kadłuba 2D (hullSkin3D.js): wgniecenia, dziury, rozpad i wraki jak na sprite'cie.
//    Wraki i odłamy dziedziczą model rodu (hull.dmgKey).
//  • Bronie 3D: wieże 3D (weapons/weapons3D.js) w miejscach wieżyczek gry z rekordów Turret2D tej klatki
//    (kurs lufy, odrzut) — na modelu i na sprite'cie; wieżyczek kanwy z modelem 3D Turret2D nie rysuje
//    (Turret2D.skipDraw, index.html). Rysunek w PARTIACH (turretBatch3D.js): jeden na rodzinę broni dla
//    wszystkich wież w kadrze — tu tylko stan wieży (pochylenie, wirnik, wylot) i jej rekord instancji.
//  • Dysze SIDE 3D (2026-10-07, każdy wariant wyglądu — sprite'y nie mają namalowanych dysz manewrowych): model
//    thrusters/sideThruster3D.js w markerze dyszy, dzwon za kierunkiem wydechu, farba frakcji kadłuba; pozycje,
//    kąty, ciąg i żar z listy SideNozzleFrame (pisze EngineVfxSystem w updateHexShips3D tej klatki), jedna partia
//    (thrusterBatch3D.js). Na modelu 3D oś dzwonu w połowie burty (skrzynki RCS kadłuba — wyłączone: rcs: false).
//
// Poza jak skóra sprite'a (hexShips3D): korzeń = początek ciała (pozycja renderu encji − R·kotwica lokalna),
// kąt θ = −(kąt + obrót sprite'a); grupa modelu w środku sprite'a (latticeMin + anchorD) ze skalą sprite'a.
// Kamera statków jest ortho z góry — głębię modeli pisze modelSlabDepth.js (cienka warstwa tam, gdzie
// leżała skóra sprite'a: pod pociskami, efektami i sprite'ami, nad skałami pasa). Dysze, światła pozycyjne,
// tarcze, mapa ran i efekty zostają z gry 2D.
// ============================================================
import * as THREE from 'three/webgpu';
import { Fn, vec3, mix, normalize, positionLocal, max, dot, exp, pow, attribute, uniform, select, fract, min } from 'three/tsl';
import { Core3D } from '../core3d.js';
import { buildShip3D, SHIP3D_MODELS } from './ships/ships3D.js';
import { WEAPON3D_FAMILY, weapon3DScale } from './weapons/weapons3D.js';
import { createShipMaterial, createDeckTexture, createDeckNormalTexture } from './shipMaterials3D.tsl.js';
import {
  hullSkinLattice, buildHullSkinGeometry, makeHullSkinMaterial, makeHullCutMaterial, ensureHullSkinSlot, releaseHullSkinSlot,
  writeHullSkinField
} from './hullSkin3D.js';
import {
  applyModelSlabDepth, setSlab, setModelSlabDepthOn, SLAB_HULL, SLAB_TURRET_ON_MODEL, SLAB_TURRET_ON_SPRITE,
  SLAB_NOZZLE_ON_MODEL, SLAB_NOZZLE_ON_SPRITE
} from './modelSlabDepth.js';
import { applySunShadowToBuiltinMaterial } from '../sunShadowMask.js';
import { HullBodies, hullSpriteRotation } from '../../game/hullBodies.js';
import { HullDamageMap } from '../hullDamageMap.js';
import { sceneOriginNearCamera } from '../sceneOrigin.js';
import { MASTER_WEAPONS } from '../../data/weapons.js';
import { entityCloakVisAt } from '../../game/cloakLook.js';
import {
  TurretBatchSet, createTurretBatchMaterial, buildTurretFamilyArrays, turretInstanceScratch,
  turretBatchWarmHolder
} from './turretBatch3D.js';
// Dysze SIDE 3D (wszystkie tryby wyglądu): lista klatki od EngineVfxSystem, jedna partia, farba frakcji kadłuba.
import { SideNozzleFrame } from '../sideNozzleFrame.js';
import { ThrusterBatch, createThrusterBatchMaterial, sideThrusterInstanceScratch, thrusterBatchWarmHolder } from './thrusterBatch3D.js';
import {
  buildSideThrusterArrays, sideThrusterPaletteFor, SIDE_THRUSTER_AXIS_Z, SIDE_THRUSTER_HALF_WIDTH
} from './thrusters/sideThruster3D.js';
import { resolveEntityHullProfileId } from '../../data/ships.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Ustawienia (gra: configureShipModels3D przy starcie i po zmianie opcji)
// ---------------------------------------------------------------------------
const _cfg = { ships: false, weapons: false, modelIdOf: null, view3D: false };

/** ships / weapons — opcje nowej gry; modelIdOf(e) — id modelu encji (gracz, NPC) albo null. */
export function configureShipModels3D({ ships = false, weapons = false, modelIdOf = null } = {}) {
  _cfg.ships = !!ships;
  _cfg.weapons = !!weapons;
  if (typeof modelIdOf === 'function') _cfg.modelIdOf = modelIdOf;
}

export function shipModels3DConfig() {
  return { ships: _cfg.ships, weapons: _cfg.weapons, view3D: _cfg.view3D };
}

/**
 * Kamera 3D tej klatki (src/game/game3D.js, raz na klatkę przed updateHexShips3D): w perspektywie statki
 * i bronie są zawsze modelami (sprite i wieżyczki kanwy leżałyby płasko), a model pisze prawdziwą głębię
 * (bez warstwy passa ortho — modelSlabDepth.js).
 */
export function setShipModels3DView(active) {
  _cfg.view3D = !!active;
  setModelSlabDepthOn(!_cfg.view3D);
}
const shipsOn = () => _cfg.ships || _cfg.view3D;
const weaponsOn = () => _cfg.weapons || _cfg.view3D;

// Model rodu kadłuba (hull.dmgKey): wrak i odłamy rysują się modelem statku, z którego powstały.
const _lineage = new Map();

function liveHull(e) {
  const h = e?.beamHull;
  return h && h.entity === e && h.body && !h.body.dead && h.body.activeNodes > 0 ? h : null;
}

/** Id modelu, którym encja rysuje się w tej klatce (opcja „Statki 3D”), albo null (skóra sprite'a). */
export function shipModel3DIdFor(e) {
  if (!shipsOn() || !e || e.dead) return null;
  // Maskowanie (src/game/cloakLook.js): na czas efektu okręt rysuje skóra sprite'a z shaderem maskowania
  // (mozaika heksów, refrakcja w warstwie DIST). AGENT: rozpuszczanie samej bryły 3D tym samym wzorem.
  if (e.__cloakLook && e.__cloakLook.active) return null;
  const hull = liveHull(e);
  if (!hull) return null;
  let id = _cfg.modelIdOf ? _cfg.modelIdOf(e) : null;
  if (!id || !SHIP3D_MODELS[id]) id = _lineage.get(hull.dmgKey) || null;
  if (!id || !SHIP3D_MODELS[id]) return null;
  const a = modelAssets(id);
  if (!a || !a.ready) return null;
  if (_lineage.get(hull.dmgKey) !== id) _lineage.set(hull.dmgKey, id);
  return id;
}

// ---------------------------------------------------------------------------
// Zasoby per model (raz na grę): kadłub, geometria, tekstury pokładu, materiały
// ---------------------------------------------------------------------------
const _models = new Map();   // id → { hull, geometry, material, skinMaterial, skinGeo: Map(klucz → { geo, lat }) }

function loadImage(src) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`sprite ${src}`));
    img.src = src;
  });
}

// Materiał modelu w grze: mapa otoczenia, maska słońca (cień planet i ringu), głębia w warstwie.
function gameMaterial(mat) {
  applyShipEnv(mat);
  applySunShadowToBuiltinMaterial(mat);
  applyModelSlabDepth(mat);
  return mat;
}

function modelAssets(id) {
  let m = _models.get(id);
  if (m) return m;
  const spec = SHIP3D_MODELS[id];
  if (!spec) return null;
  m = { id, hull: null, geometry: null, material: null, skinMaterial: null, skinGeo: new Map(), minZ: 0, maxZ: 1, ready: false, error: null };
  _models.set(id, m);
  try {
    // rcs: false — dysze SIDE rysuje partia dysz (thrusterBatch3D.js), nie nieruchome skrzynki w bryle kadłuba
    m.hull = buildShip3D(id, { rcs: false });
    m.geometry = m.hull.builder.toGeometry(THREE, m.hull.scale);
    m.geometry.computeBoundingSphere();
    m.geometry.computeBoundingBox();
    m.minZ = m.geometry.boundingBox.min.z;
    m.maxZ = m.geometry.boundingBox.max.z;
  } catch (err) {
    m.error = err;
    console.warn('[ships3D] model', id, err);
    return m;
  }
  // Materiał bez tekstury od razu (bryła widoczna), pokład ze sprite'a po wczytaniu obrazu.
  m.material = gameMaterial(createShipMaterial({ palette: m.hull.palette || null, name: `okręt 3D ${id}` }));
  m.skinMaterial = gameMaterial(makeHullSkinMaterial(createShipMaterial({ palette: m.hull.palette || null, name: `okręt 3D ${id} (skóra)` })));
  m.ready = true;
  if (spec.sprite && typeof Image !== 'undefined') {
    loadImage(spec.sprite).then((img) => {
      const aniso = Math.min(8, Number(Core3D.getMaxAnisotropy?.()) || 8);
      const deck = createDeckTexture(img, aniso);
      const deckN = createDeckNormalTexture(img);
      const mat = gameMaterial(createShipMaterial({ deckMap: deck, deckNormalMap: deckN, palette: m.hull.palette || null, name: `okręt 3D ${id} (pokład)` }));
      const skin = gameMaterial(makeHullSkinMaterial(createShipMaterial({ deckMap: deck, deckNormalMap: deckN, palette: m.hull.palette || null, name: `okręt 3D ${id} (pokład, skóra)` })));
      // Materiały z pokładem podmieniane dopiero po kompilacji w tle — bez przestoju klatki.
      const swap = () => {
        m.material = mat;
        m.skinMaterial = skin;
        for (const inst of _instances.values()) {
          if (inst.modelId !== id) continue;
          if (inst.hullMesh) inst.hullMesh.material = mat;
          if (inst.skinMesh) inst.skinMesh.material = skin;
        }
      };
      const w = Core3D.warmup;
      if (!w?.now) { swap(); return; }
      w.now([_warmHolder(m.geometry, mat), _warmHolder(skinWarmGeometry(), skin)], { layer: 0 }).then(swap, swap);
    }).catch((err) => console.warn('[ships3D]', err.message));
  }
  return m;
}

// Klucz geometrii skóry: obraz kadłuba (konstrukcja belek) i skala sprite'a.
const _imageIds = new WeakMap();
let _nextImageId = 1;
function skinKey(hull) {
  let id = _imageIds.get(hull.image);
  if (!id) { id = _nextImageId++; _imageIds.set(hull.image, id); }
  return `${id}|${hull.scale}|${hull.anchorDX}|${hull.anchorDY}`;
}

/** Geometria skóry modelu na kratownicy kadłuba (obraz i skala sprite'a encji). */
function skinGeometry(m, hull) {
  const key = skinKey(hull);
  let e = m.skinGeo.get(key);
  if (e) return e;
  const structure = HullBodies.structureFor(hull.image, hull.scale);
  if (!structure) return null;
  const lat = hullSkinLattice(structure, hull.anchorDX, hull.anchorDY);
  e = { key, lat, geo: buildHullSkinGeometry(m.geometry, lat, hull.scale) };
  m.skinGeo.set(key, e);
  return e;
}

// Geometria rozgrzewki skóry: jeden trójkąt z tym samym układem atrybutów (klucz pipeline'u).
let _skinWarmGeo = null;
function skinWarmGeometry() {
  if (_skinWarmGeo) return _skinWarmGeo;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
  g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(3), 1));
  g.setAttribute('aLat', new THREE.BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('aOwn', new THREE.BufferAttribute(new Float32Array(9), 3));
  _skinWarmGeo = g;
  return g;
}

// Wieże w partiach (turretBatch3D.js): materiał partii (pozycja z rekordu wieży, warstwa głębi z rekordu) z mapą
// otoczenia i maską słońca jak reszta modeli; zestaw partii — jeden na grę, siatki w Core3D.scene.
let _turretMat = null;
function turretMaterial() {
  if (!_turretMat) {
    _turretMat = createTurretBatchMaterial();
    applyShipEnv(_turretMat);
    applySunShadowToBuiltinMaterial(_turretMat);
  }
  return _turretMat;
}
let _batches = null;
function turretBatches() {
  if (!_batches) _batches = new TurretBatchSet(Core3D.scene, turretMaterial());
  return _batches;
}

// Dysze SIDE (thrusterBatch3D.js): materiał jak wieże (mapa otoczenia, maska słońca), jedna partia na grę.
let _nozzleMat = null;
function nozzleMaterial() {
  if (!_nozzleMat) {
    _nozzleMat = createThrusterBatchMaterial();
    applyShipEnv(_nozzleMat);
    applySunShadowToBuiltinMaterial(_nozzleMat);
  }
  return _nozzleMat;
}
let _nozzles = null;
function nozzleBatch() {
  if (!_nozzles) _nozzles = new ThrusterBatch(Core3D.scene, nozzleMaterial());
  return _nozzles;
}

// Mapa otoczenia modeli 3D (tylko materiały okrętów — reszta sceny bez zmian): w kosmosie bez niej
// metal kadłuba w cieniu jest czarny. PMREM z ciemnego gradientu z chłodnym pasem mgławicy i ciepłą
// „stroną słońca” — raz, po gotowości urządzenia, poza pętlą renderu.
let _env = null;
let _envPending = false;
const _envMats = new Set();
let SHIP3D_ENV_INTENSITY = 3.5; // A/B 2026-09-30: 1,6 — kadłub za ciemny w świetle sceny gry, 5 — prześwietlone jasne palety

/** Strojenie wyglądu (konsola / harness): env — siła mapy otoczenia materiałów okrętów. */
export function setShipModels3DLook({ env } = {}) {
  if (Number.isFinite(env) && env >= 0) {
    SHIP3D_ENV_INTENSITY = env;
    for (const mm of _envMats) mm.envMapIntensity = env;
  }
  return { env: SHIP3D_ENV_INTENSITY };
}
function applyShipEnv(mat) {
  if (!mat) return;
  _envMats.add(mat);
  if (_env) { mat.envMap = _env; mat.envMapIntensity = SHIP3D_ENV_INTENSITY; mat.needsUpdate = true; return; }
  if (_envPending || !Core3D.ready?.then) return;
  _envPending = true;
  Core3D.ready.then((ok) => {
    if (!ok || !Core3D.renderer) return;
    setTimeout(() => {
      try {
        const envScene = new THREE.Scene();
        const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
        m.colorNode = Fn(() => {
          const d = normalize(positionLocal);
          const up = d.z.mul(0.5).add(0.5);
          const base = mix(vec3(0.010, 0.012, 0.020), vec3(0.060, 0.070, 0.100), up);
          const band = exp(dot(d, normalize(vec3(0.25, 0.35, 0.9))).pow(2.0).mul(-6.0));
          const warm = pow(max(dot(d, normalize(vec3(0.6, -0.4, 0.55))), 0.0), 6.0);
          return base.add(vec3(0.020, 0.030, 0.060).mul(band)).add(vec3(0.45, 0.40, 0.32).mul(warm));
        })();
        envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), m));
        const pm = new THREE.PMREMGenerator(Core3D.renderer);
        const rt = pm.fromScene(envScene, 0.04, 0.1, 1000);
        pm.dispose();
        _env = rt.texture;
        for (const mm of _envMats) { mm.envMap = _env; mm.envMapIntensity = SHIP3D_ENV_INTENSITY; mm.needsUpdate = true; }
      } catch (err) {
        console.warn('[ships3D] mapa otoczenia:', err?.message || err);
      }
    }, 0);
  });
}

function _warmHolder(geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

// Światła modelu (lampy pozycyjne i reflektory z danych okrętu — w 2D rysuje je shader skóry sprite'a):
// kule HDR pod bloom. Geometria instancji RAZ na model (Mesh + InstancedBufferGeometry — nie InstancedMesh,
// którego uuid wchodzi do klucza programu), materiał raz na grę; miganie lamp w shaderze z czasu egzemplarza,
// stan świateł (L — reflektory, wraki) per obiekt.
let _lightMat = null;
let _lightBase = null;
function lightMaterial() {
  if (_lightMat) return _lightMat;
  const m = new THREE.MeshBasicNodeMaterial();
  m.name = 'światła okrętu 3D';
  const iPos = attribute('iPos', 'vec3');
  const iCol = attribute('iCol', 'vec4'); // rgb × moc, w: 1 — reflektor, 0 — lampa pozycyjna
  const uT = uniform(0).onObjectUpdate(({ object }) => Number(object?.userData?.lightT) || 0);
  const uOn = uniform(1).onObjectUpdate(({ object }) => (object?.userData?.lightsOn === false ? 0 : 1));
  const uRoad = uniform(1).onObjectUpdate(({ object }) => (object?.userData?.roadOn === false ? 0 : 1));
  const road = iCol.w.greaterThan(0.5);
  m.positionNode = positionLocal.mul(select(road, 2.4, 2.0)).add(iPos);
  m.colorNode = Fn(() => {
    // sekwencja lamp wzdłuż kadłuba (jak dawny rig świateł dema Atlasa)
    const ph = fract(iPos.x.div(1800).mul(1.4).add(uT.mul(0.9)));
    const tri = min(ph, ph.oneMinus()).mul(9);
    const nav = exp(tri.mul(tri).negate()).mul(7).add(0.25);
    return iCol.xyz.mul(select(road, uRoad.mul(2.2), nav)).mul(uOn);
  })();
  applyModelSlabDepth(m);
  _lightMat = m;
  return m;
}

function lightsGeometry(m) {
  if (m.lightsGeo !== undefined) return m.lightsGeo;
  const list = m.hull?.lights || [];
  if (!list.length) { m.lightsGeo = null; return null; }
  if (!_lightBase) _lightBase = new THREE.SphereGeometry(1, 10, 8);
  const g = new THREE.InstancedBufferGeometry();
  g.index = _lightBase.index;
  g.setAttribute('position', _lightBase.attributes.position);
  g.setAttribute('normal', _lightBase.attributes.normal);
  g.setAttribute('uv', _lightBase.attributes.uv);
  const n = list.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const l = list[i];
    pos[i * 3] = l.x; pos[i * 3 + 1] = l.y; pos[i * 3 + 2] = l.z;
    c.set(l.color || '#ff3030');
    const p = Number(l.power) || 1;
    col[i * 4] = c.r * p; col[i * 4 + 1] = c.g * p; col[i * 4 + 2] = c.b * p;
    col[i * 4 + 3] = l.kind === 'road' ? 1 : 0;
  }
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
  g.setAttribute('iCol', new THREE.InstancedBufferAttribute(col, 4));
  g.instanceCount = n;
  m.lightsGeo = g;
  return g;
}

// ---------------------------------------------------------------------------
// Wieża 3D
// ---------------------------------------------------------------------------
// Stan wieży między klatkami (rysuje ją partia rodziny — turretBatch3D.js): pochylenie lufy, kąt wirnika,
// wylot dla kamer 3D.
const TWO_PI = Math.PI * 2;
class TurretState {
  constructor(family, weaponId, hullTier) {
    const fa = buildTurretFamilyArrays(family);
    this.family = family;
    this.model = fa.model;
    this.height = fa.height;
    this.weaponId = weaponId;
    this.scale = weapon3DScale(MASTER_WEAPONS[weaponId] || null, hullTier);
    const m = this.model;
    // lufa poziomo (wyrzutnie — podniesione); od spoczynku `rest` z prędkością 1,6 rad/s
    this.pitchWant = Math.min(m.pitch[1] * DEG, Math.max(m.pitch[0] * DEG, m.launcher ? 25 * DEG : 0));
    this.pitchAngle = (m.rest || 0) * DEG;
    this.pitchCos = Math.cos(this.pitchAngle);
    this.pitchSin = Math.sin(this.pitchAngle);
    this.spin = 0;
    this.hasSpin = !!m.parts.spin;
    this.muzzleK = (m.trunnion?.[1] || 0) + (m.barrels?.[0]?.[1] || 0);
    this.key = '';
    this.seen = 0;
    this.shown = 0; // klatka, w której wieża trafiła do partii (widoczna)
    this.wx = 0;
    this.wy = 0;
    this.muzzleZ = 0;
  }

  /** recoil 0..1, dt → odrzut lufy (j. lokalne); pochylenie i wirnik jak dawne drzewo siatek wieży. */
  pose(recoil01, dt) {
    const m = this.model;
    const d = this.pitchWant - this.pitchAngle;
    if (d !== 0) {
      const step = 1.6 * dt;
      this.pitchAngle += Math.max(-step, Math.min(step, d));
      this.pitchCos = Math.cos(this.pitchAngle);
      this.pitchSin = Math.sin(this.pitchAngle);
    }
    if (this.hasSpin && recoil01 > 0.05) {
      this.spin += 30 * dt;
      if (this.spin > TWO_PI) this.spin -= TWO_PI * Math.floor(this.spin / TWO_PI);
    }
    return m.recoil * Math.max(0, Math.min(1, recoil01));
  }
}

// ---------------------------------------------------------------------------
// Egzemplarz (encja)
// ---------------------------------------------------------------------------
const _instances = new Map(); // encja → inst

function createInstance(entity) {
  const root = new THREE.Group();
  root.name = 'okręt 3D';
  const modelGroup = new THREE.Group();
  modelGroup.name = 'model';
  root.add(modelGroup);
  root.visible = false;
  Core3D.scene.add(root);
  const inst = {
    entity, modelId: null, assets: null, root, modelGroup,
    hullMesh: null, skinMesh: null, skinKey: null, lightMesh: null, slab: new THREE.Vector4(),
    turrets: new Map(), frame: 0
  };
  _instances.set(entity, inst);
  return inst;
}

// Faza sekwencji lamp z id encji (bez Math.random gry).
function fxSeed(e) {
  const s = String(e?.id ?? e?.name ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 100;
}

function setInstanceModel(inst, id) {
  if (inst.modelId === id) return;
  if (inst.hullMesh) { inst.modelGroup.remove(inst.hullMesh); inst.hullMesh = null; }
  if (inst.lightMesh) { inst.modelGroup.remove(inst.lightMesh); inst.lightMesh = null; }
  if (inst.skinMesh) { inst.root.remove(inst.skinMesh); inst.skinMesh = null; inst.skinKey = null; }
  inst.modelId = id;
  inst.assets = id ? modelAssets(id) : null;
  if (!inst.assets?.ready) return;
  const mesh = new THREE.Mesh(inst.assets.geometry, inst.assets.material);
  mesh.name = 'kadłub 3D';
  mesh.receiveShadow = true;
  mesh.userData.slab = inst.slab;
  mesh.layers.set(0);
  inst.modelGroup.add(mesh);
  inst.hullMesh = mesh;
  const lg = lightsGeometry(inst.assets);
  if (lg) {
    const lm = new THREE.Mesh(lg, lightMaterial());
    lm.name = 'światła okrętu 3D';
    lm.frustumCulled = false;
    lm.userData.slab = inst.slab;
    lm.userData.lightT = fxSeed(inst.entity);
    lm.layers.set(0);
    inst.modelGroup.add(lm);
    inst.lightMesh = lm;
  }
}

function disposeInstance(inst) {
  if (inst.root.parent) inst.root.parent.remove(inst.root);
  _instances.delete(inst.entity);
}

// Skóra FFD na węzłach kadłuba (siatka w układzie ciała = korzeń egzemplarza).
function syncSkin(inst, hull) {
  const key = skinKey(hull);
  if (!inst.skinMesh || inst.skinKey !== key) {
    const sg = skinGeometry(inst.assets, hull);
    if (!sg) return false;
    if (inst.skinMesh) inst.root.remove(inst.skinMesh);
    const mesh = new THREE.Mesh(sg.geo, inst.assets.skinMaterial);
    mesh.name = 'kadłub 3D (skóra belek)';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.slab = inst.slab;
    mesh.userData.lat = sg.lat;
    mesh.layers.set(0);
    inst.root.add(mesh);
    inst.skinMesh = mesh;
    inst.skinKey = key;
  }
  const body = hull.body;
  // Stan skóry przy CIELE (przeżywa przejście kadłuba na encję wraku — convertToWreck).
  if (body.__skin3DHull !== hull) {
    if (body.__skin3D) hull.__skin3D = body.__skin3D;
    body.__skin3DHull = hull;
  }
  let st = hull.__skin3D;
  if (!st || st.body !== body) {
    st = ensureHullSkinSlot(hull, inst.skinMesh.userData.lat.occ);
    body.__skin3D = st;
  }
  if (!st) { inst.skinMesh.visible = false; return false; }
  writeHullSkinField(hull);
  inst.skinMesh.userData.skin3D = st;
  // Mapa ran rodu (ten slot i uv co skóra sprite'a): bind co klatkę — widoczność dla LRU i stygnięcia w kadrze.
  const du = inst.dmgU || (inst.dmgU = {
    uDmgSlot: { value: new THREE.Vector4(0, 1, 1, 0) },
    uDmgWorld: { value: new THREE.Vector2(1, 1) },
    uv: new THREE.Vector4()
  });
  HullDamageMap.bind(hull.dmgKey, du);
  du.uv.set(hull.pixelPitch / hull.srcWidth, hull.pixelPitch / hull.srcHeight, hull.ny, 0);
  inst.skinMesh.userData.dmgSlot = du.uDmgSlot.value;
  inst.skinMesh.userData.dmgUv = du.uv;
  inst.skinMesh.userData.dmgWorld = du.uDmgWorld.value;
  inst.skinMesh.visible = true;
  return true;
}

// ---------------------------------------------------------------------------
// Ścianki przekroju w dziurach (kamery 3D; z góry stoją bokiem — w kamerze klasycznej schowane i nieliczone).
// Pionowy prostokąt na każdej krawędzi żywa ↔ zniszczona komórka (zniszczona = w pierwotnej konstrukcji, nie
// w tym ciele: dziura, odłam wraku), od dna do pokładu modelu (heightAt / bottomAt), na AKTUALNYCH pozycjach
// węzłów (idzie za wgnieceniem), normalna do środka dziury. Przebudowa tylko przy zmianie węzłów (revision).
// ---------------------------------------------------------------------------
let _cutMat = null;
function cutMaterial() {
  if (!_cutMat) _cutMat = gameMaterial(makeHullCutMaterial());
  return _cutMat;
}
const CUT_DIRS = [1, 0, -1, 0, 0, 1, 0, -1];

function syncCutWalls(inst, hull, show) {
  let cw = inst.cut;
  if (!show || !inst.skinMesh || !inst.skinMesh.visible) {
    if (cw?.mesh && cw.mesh.visible) cw.mesh.visible = false;
    return;
  }
  const body = hull.body;
  if (!cw) cw = inst.cut = { mesh: null, geo: null, rev: -1, body: null, cap: 0, count: 0, alive: null };
  if (cw.rev === hull.revision && cw.body === body) {
    if (cw.mesh) cw.mesh.visible = cw.count > 0;
    return;
  }
  cw.rev = hull.revision;
  cw.body = body;
  const lat = inst.skinMesh.userData.lat;
  const mh = inst.assets.hull;
  if (!lat || !mh?.heightAt || !mh?.bottomAt) return;
  const d = body.dims, st = body.nodeStore, W = d.x, H = d.y;
  if (!cw.alive || cw.alive.length !== W * H) cw.alive = new Int32Array(W * H);
  const alive = cw.alive;
  alive.fill(-1);
  for (let i = 0; i < st.count; i++) if (st.active[i] && st.iz[i] === 0) alive[st.ix[i] + st.iy[i] * W] = i;
  const occ = lat.occ;
  const cs = body.cellSize, lm = body.latticeMin, k = hull.scale;
  const scx = lm.x + hull.anchorDX, scy = lm.y + hull.anchorDY;
  // pierwszy przebieg: liczba ścianek (pojemność buforów)
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (alive[x + y * W] < 0) continue;
    for (let q = 0; q < 8; q += 2) {
      const nx = x + CUT_DIRS[q], ny = y + CUT_DIRS[q + 1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = nx + ny * W;
      if (occ[j] && alive[j] < 0) n++;
    }
  }
  if (n === 0) {
    cw.count = 0;
    if (cw.mesh) cw.mesh.visible = false;
    return;
  }
  if (n > cw.cap) {
    cw.cap = Math.ceil(n * 1.5) + 16;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cw.cap * 18), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(cw.cap * 18), 3));
    g.setAttribute('aLat', new THREE.BufferAttribute(new Float32Array(cw.cap * 18), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    if (cw.mesh) { inst.root.remove(cw.mesh); cw.geo?.dispose(); }
    cw.geo = g;
    cw.mesh = new THREE.Mesh(g, cutMaterial());
    cw.mesh.name = 'przekrój kadłuba 3D';
    cw.mesh.frustumCulled = false;
    cw.mesh.receiveShadow = true;
    cw.mesh.layers.set(0);
    inst.root.add(cw.mesh);
  }
  const P = cw.geo.attributes.position.array, N = cw.geo.attributes.normal.array, L = cw.geo.attributes.aLat.array;
  let v = 0;
  const put = (px, py, pz, dx, dy, lx, ly) => {
    const o = v * 3;
    P[o] = px; P[o + 1] = py; P[o + 2] = pz;
    N[o] = dx; N[o + 1] = dy; N[o + 2] = 0;
    L[o] = lx; L[o + 1] = ly; L[o + 2] = 0;
    v++;
  };
  let walls = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = alive[x + y * W];
    if (i < 0) continue;
    for (let q = 0; q < 8; q += 2) {
      const dx = CUT_DIRS[q], dy = CUT_DIRS[q + 1];
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = nx + ny * W;
      if (!occ[j] || alive[j] >= 0) continue;
      // krawędź przy węźle (aktualna pozycja w układzie ciała), styczna ± pół komórki
      const ex = st.x[i] + dx * 0.5 * cs, ey = st.y[i] + dy * 0.5 * cs;
      const tx = -dy * 0.5 * cs, ty = dx * 0.5 * cs;
      const mx = (ex - scx) / k, my = (ey - scy) / k;
      const zt = mh.heightAt(mx, my) * k, zb = mh.bottomAt(mx, my) * k;
      if (!(Number.isFinite(zt) && Number.isFinite(zb)) || zt - zb < 1) continue;
      // kolejność B → A: normalna (dx, dy) — do środka dziury
      const ax = ex + tx, ay = ey + ty, bx = ex - tx, by = ey - ty;
      const lxa = x + 0.5 * dx - 0.5 * dy, lya = y + 0.5 * dy + 0.5 * dx;
      const lxb = x + 0.5 * dx + 0.5 * dy, lyb = y + 0.5 * dy - 0.5 * dx;
      put(bx, by, zb, dx, dy, lxb, lyb); put(ax, ay, zb, dx, dy, lxa, lya); put(ax, ay, zt, dx, dy, lxa, lya);
      put(bx, by, zb, dx, dy, lxb, lyb); put(ax, ay, zt, dx, dy, lxa, lya); put(bx, by, zt, dx, dy, lxb, lyb);
      walls++;
    }
  }
  cw.count = walls;
  cw.geo.setDrawRange(0, walls * 6);
  cw.geo.attributes.position.needsUpdate = true;
  cw.geo.attributes.normal.needsUpdate = true;
  cw.geo.attributes.aLat.needsUpdate = true;
  // mapa ran i warstwa głębi — te same holdery co skóra
  const ud = inst.skinMesh.userData;
  cw.mesh.userData.slab = inst.slab;
  cw.mesh.userData.dmgSlot = ud.dmgSlot;
  cw.mesh.userData.dmgUv = ud.dmgUv;
  cw.mesh.userData.dmgWorld = ud.dmgWorld;
  cw.mesh.visible = walls > 0;
}

// ---------------------------------------------------------------------------
// Klatka
// ---------------------------------------------------------------------------
let _frame = 0;

/**
 * Raz na klatkę renderu PO updateHexShips3D (rekordy Turret2D tej klatki). p:
 *   entities — encje renderu (gracz, NPC, wraki)
 *   poseOf(e) — { x, y, angle } interpolowana poza renderu (gracz) albo null
 *   turrets  — Turret2D (rekordy encji: recordsFor(e))
 *   inView(e) — encja w kadrze (bez niej — wszystkie)
 *   zoom     — zoom kamery (LOD wież: poniżej TURRET3D_HIDE_PX na ekranie wieży nie ma, jak w Turret2D)
 *   zoomAt(x, y) — px ekranu na jednostkę świata w punkcie (kamera 3D: rzut perspektywy); bez niej — zoom
 *   dt       — czas klatki
 */
const _org = { x: 0, y: 0 };
export function syncShipModels3D(p) {
  _frame++;
  let shown = 0;
  // Partie wież: liczniki na zero i początek przy kamerze (x, −y świata gry) — rekordy tej klatki względem niego.
  const batches = weaponsOn() && Core3D.scene ? turretBatches() : _batches;
  if (batches) {
    if (weaponsOn()) sceneOriginNearCamera(_org);
    batches.begin(_org.x, _org.y);
  }
  if (shipsOn() || weaponsOn()) {
    const dt = Math.max(0, Number(p.dt) || 0);
    for (const e of p.entities) {
      if (!e || e.dead) continue;
      const hull = liveHull(e);
      const id = hull ? shipModel3DIdFor(e) : null;
      const recs = weaponsOn() && !e.isWreck && p.turrets?.recordsFor ? p.turrets.recordsFor(e) : null;
      const nRecs = recs ? recs.length : 0;
      e.__model3D = !!id;
      if (!id && nRecs === 0) continue;
      if (p.inView && !p.inView(e)) continue;
      let inst = _instances.get(e);
      if (!inst) inst = createInstance(e);
      inst.frame = _frame;
      setInstanceModel(inst, id);
      // Poza: początek ciała i kąt jak skóra sprite'a (hexShips3D.updateBeamSkinMesh).
      const pose = p.poseOf ? p.poseOf(e) : null;
      const ex = pose ? pose.x : (e.pos ? e.pos.x : e.x);
      const ey = pose ? pose.y : (e.pos ? e.pos.y : e.y);
      const angle = pose ? pose.angle : (Number(e.angle) || 0);
      const theta = -(angle + hullSpriteRotation(e));
      const c = Math.cos(theta), s = Math.sin(theta);
      let ox = ex, oy = -ey, scx = 0, scy = 0, k = spriteScale(e);
      if (hull) {
        const ax = HullBodies.anchorLocalX(hull), ay = HullBodies.anchorLocalY(hull);
        ox = ex - (c * ax - s * ay);
        oy = -ey - (s * ax + c * ay);
        scx = hull.body.latticeMin.x + hull.anchorDX;
        scy = hull.body.latticeMin.y + hull.anchorDY;
        k = hull.scale;
      }
      inst.root.position.set(ox, oy, 0);
      inst.root.rotation.set(0, 0, theta);
      inst.modelGroup.position.set(scx, scy, 0);
      inst.modelGroup.scale.setScalar(k);
      // Kadłub: skóra FFD (zapas — bryła sztywna, gdy brak miejsca w polu).
      if (id && inst.assets?.ready) {
        setSlab(inst.slab, inst.assets.minZ * k, inst.assets.maxZ * k, SLAB_HULL);
        const skinned = syncSkin(inst, hull);
        if (inst.hullMesh) inst.hullMesh.visible = !skinned;
        syncCutWalls(inst, hull, skinned && _cfg.view3D);
        const lm = inst.lightMesh;
        if (lm) {
          lm.visible = !e.isWreck;
          lm.userData.lightT += dt;
          lm.userData.lightsOn = !e.lightsOff;
          lm.userData.roadOn = !e.roadLightsOff;
        }
      } else {
        if (inst.skinMesh) inst.skinMesh.visible = false;
        if (inst.cut?.mesh) inst.cut.mesh.visible = false;
      }
      // Wieże 3D (rekordy partii).
      if (nRecs > 0 && batches) syncTurrets(inst, e, recs, ox, oy, c, s, scx, scy, k, dt, !!id, Number(p.zoom) || 1, p.zoomAt || null);
      // Korzeń egzemplarza niesie tylko bryłę modelu — bez niej (wieże na sprite'cie) nie ma czego liczyć.
      const showRoot = !!(id && inst.assets?.ready);
      if (inst.root.visible !== showRoot) inst.root.visible = showRoot;
      if (showRoot) inst.root.updateMatrixWorld(true);
      shown++;
    }
  }
  if (batches) batches.end();
  // Dysze SIDE 3D — w każdym wariancie wyglądu (lista klatki od EngineVfxSystem).
  syncSideNozzles(p);
  // Encje nieobecne w tej klatce (zniknęły, poza kadrem, opcje wyłączone) — chowamy; martwe po chwili zwalniamy.
  for (const inst of _instances.values()) {
    if (inst.frame === _frame) continue;
    if (inst.root.visible) inst.root.visible = false;
    const h = inst.entity?.beamHull;
    const dead = inst.entity?.dead || (h && h.body?.dead);
    if (dead || _frame - inst.frame > 600) {
      if (dead && h?.__skin3D) { releaseHullSkinSlot(h); if (h.body) h.body.__skin3D = null; }
      disposeInstance(inst);
    }
  }
  return shown;
}

function spriteScale(e) {
  const v = e?.visual;
  const sc = (v && typeof v.spriteScaleX === 'number') ? v.spriteScaleX : (v && typeof v.spriteScale === 'number') ? v.spriteScale : 1;
  return Number.isFinite(sc) && sc > 0 ? sc : 1;
}

// Wieża mniejsza na ekranie (promień sylwetki Turret2D × zoom) — bez modelu, jak na kanwie (z daleka wieża ma
// 1–2 px, a jej wierzchołki i rekord nic nie wnoszą).
export const TURRET3D_HIDE_PX = 2.0; // = TURRET_HIDE_PX Turret2D (kanwa od tego progu też nie rysuje)

// Rekord instancji wieży (pola — bez wywołań z liczbami double w gorącej pętli).
const _rec = turretInstanceScratch();

function syncTurrets(inst, e, recs, ox, oy, c, s, scx, scy, k, dt, onModel, zoom, zoomAt) {
  const hull3D = onModel ? inst.assets?.hull : null;
  const tier = e.isPlayer ? 'Capital' : (e.weaponTier || 'Capital');
  const slab = onModel ? SLAB_TURRET_ON_MODEL : SLAB_TURRET_ON_SPRITE;
  const B = _batches;
  const T = _rec;
  // pierścień obraca się z kadłubem (θ), obudowa i lufy z kursem lufy
  T.hullCos = c;
  T.hullSin = s;
  T.lo = slab.lo;
  T.hi = slab.hi;
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const fam = WEAPON3D_FAMILY[rec.weaponId];
    if (!fam) continue;
    const z = zoomAt ? zoomAt(rec.wx, rec.wy) : zoom;
    if ((Number(rec.spec?.r) || 10) * (Number(rec.scale) || 1) * z < TURRET3D_HIDE_PX) continue;
    let t = inst.turrets.get(rec.key);
    if (!t || t.weaponId !== rec.weaponId) {
      t = new TurretState(fam, rec.weaponId, tier);
      t.key = rec.key;
      inst.turrets.set(rec.key, t);
    }
    t.seen = _frame;
    // Maskowanie: wieża znika razem z komórką kadłuba pod sobą (lustro wzoru z shadera).
    if (e.__cloakLook && entityCloakVisAt(e, rec.wx, rec.wy) < 0.5) continue;
    // Pokład pod wieżą (model): świat (x, −y) → układ ciała (odwrotny obrót) → grupa modelu (środek i skala sprite'a).
    let hzs = 0;
    if (hull3D && hull3D.heightAt) {
      const dx = rec.wx - ox, dy = -rec.wy - oy;
      const hz = hull3D.heightAt((c * dx + s * dy - scx) / k, (-s * dx + c * dy - scy) / k);
      if (Number.isFinite(hz)) hzs = hz;
    }
    const kick = Math.max(0.1, Number(rec.recoil) || 0.1);
    const recoil01 = rec.state ? (Number(rec.state.barrel) || 0) / kick : 0;
    const back = t.pose(recoil01, dt);
    const K = t.scale * k;
    const zb = hzs * k;
    // Kurs lufy z rekordu (świat gry, y w dół): α = −kąt w układzie sceny.
    T.x = rec.wx - B.orgX;
    T.y = -rec.wy - B.orgY;
    T.z = zb;
    T.scale = K;
    T.yawCos = Math.cos(rec.ang);
    T.yawSin = -Math.sin(rec.ang);
    T.pitchCos = t.pitchCos;
    T.pitchSin = t.pitchSin;
    T.back = back;
    T.spin = t.spin;
    T.zb = zb;
    T.zt = Math.max(zb + t.height * K, zb + 1e-3);
    // wylot lufy nad płaszczyzną (turretMuzzleZ — błysk i pocisk w kamerach 3D)
    t.wx = rec.wx;
    t.wy = rec.wy;
    t.muzzleZ = zb + t.muzzleK * K;
    t.shown = _frame;
    B.family(fam).push(T);
  }
  // Stan wież niewidzianych od 300 klatek (zdjęta broń, odcięta część) — przegląd co 64 klatki.
  if ((_frame & 63) === 0) {
    for (const t of inst.turrets.values()) if (_frame - t.seen > 300) inst.turrets.delete(t.key);
  }
}

/**
 * Kamery 3D: wysokość lufy (z świata) wieży 3D encji najbliższej punktowi (x, y gry) — błysk wylotu
 * (WeaponFx.muzzleZOf) i start pocisku; bez wieży — połowa wysokości pokładu modelu; w kamerze z góry 0
 * (w ortho wysokość efektu nie zmienia obrazu).
 */
export function turretMuzzleZ(entity, x, y) {
  if (!_cfg.view3D || !entity) return 0;
  const inst = _instances.get(entity);
  if (!inst) return 0;
  let best = null, bd = Infinity;
  for (const t of inst.turrets.values()) {
    if (t.shown !== _frame || !Number.isFinite(t.muzzleZ)) continue;
    const dx = t.wx - x, dy = t.wy - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = t; }
  }
  if (best) return best.muzzleZ;
  return inst.assets ? Math.max(0, inst.assets.maxZ * 0.5 * (inst.modelGroup.scale.x || 1)) : 0;
}

// ---------------------------------------------------------------------------
// Dysze SIDE 3D (model: thrusters/sideThruster3D.js, partia: thrusterBatch3D.js). Rekordy z SideNozzleFrame — oś
// obrotu (marker), kierunek podstawy i wydechu, promień wylotu, ciąg i żar liczy EngineVfxSystem w tej samej pętli co
// płomień SIDE (maskowanie i odpadanie z kadłubem już tam). Tu: kadr, LOD, wysokość i warstwa głębi (sprite / model),
// farba z profilu kadłuba.
// ---------------------------------------------------------------------------
/** Pół szerokości sponsonu na ekranie [px], poniżej której dysza nie ma modelu (jak wieże: TURRET3D_HIDE_PX). */
export const SIDE_NOZZLE3D_HIDE_PX = 2.0;
const _nozzleRec = sideThrusterInstanceScratch();
const _nozzleMount = new WeakMap(); // obiekt dyszy → { id, z } — oś dzwonu na modelu (j. modelu, skala 1)
const _nozzlePal = new WeakMap();   // encja → { key, pal }
let _nozzleSerial = -1;
let _nozzleShown = 0;
const _nozzleOrg = { x: 0, y: 0 };

// Farba z profilu kadłuba (Terra Nova biel, Atlas szary, frachtowce szary cywilny, piraci rdza).
function nozzlePalette(e) {
  const key = `${e.model3DProfileId || ''}|${e.shipFrame || ''}|${e.activeHullId || ''}|${e.type || ''}|${e.isPirate ? 1 : 0}`;
  let c = _nozzlePal.get(e);
  if (!c || c.key !== key) {
    c = { key, pal: sideThrusterPaletteFor(e.model3DProfileId || resolveEntityHullProfileId(e)) };
    _nozzlePal.set(e, c);
  }
  return c.pal;
}

// Oś dzwonu na modelu 3D: połowa wysokości burty pod markerem (z = 0 — płaszczyzna gry); raz na dyszę i model.
function nozzleAxisOnModel(id, src, ox, oy) {
  const c = src ? _nozzleMount.get(src) : null;
  if (c && c.id === id) return c.z;
  const h = modelAssets(id)?.hull;
  let z = 0;
  if (h?.heightAt) {
    const deck = Number(h.deckZ) || 0;
    const top = h.heightAt(ox, -oy);
    z = 0.5 * Math.max(0, Math.min(Number.isFinite(top) ? top : deck, deck));
  }
  if (src) _nozzleMount.set(src, { id, z });
  return z;
}

function syncSideNozzles(p) {
  const F = SideNozzleFrame;
  const fresh = F.serial !== _nozzleSerial;
  _nozzleSerial = F.serial;
  _nozzleShown = 0;
  if (!F.enabled || !fresh || F.count === 0 || !Core3D.scene) {
    if (_nozzles) { _nozzles.begin(0, 0); _nozzles.end(); }
    return;
  }
  const B = nozzleBatch();
  sceneOriginNearCamera(_nozzleOrg);
  B.begin(_nozzleOrg.x, _nozzleOrg.y);
  const T = _nozzleRec;
  const zoom = Number(p.zoom) || 1;
  const zoomAt = p.zoomAt || null;
  const height = buildSideThrusterArrays().height;
  let lastE = null, ok = false, modelId = null, k = 1, pal = 0;
  for (let i = 0; i < F.count; i++) {
    const e = F.entity[i];
    if (e !== lastE) {
      lastE = e;
      ok = !!e && !e.dead && (!p.inView || p.inView(e));
      if (ok) {
        modelId = shipModel3DIdFor(e);
        const h = liveHull(e);
        k = h ? h.scale : spriteScale(e);
        pal = nozzlePalette(e);
      }
    }
    if (!ok) continue;
    const R = F.radius[i];
    const zpx = zoomAt ? zoomAt(F.x[i], -F.y[i]) : zoom;
    if (R * SIDE_THRUSTER_HALF_WIDTH * zpx < SIDE_NOZZLE3D_HIDE_PX) continue;
    // Sprite: sponson na płaszczyźnie sprite'a. Model: oś dzwonu w połowie burty (sponson w kadłubie — z góry
    // warstwa głębi i tak kładzie dyszę nad kadłubem, z boku w kamerach 3D dzwon wychodzi z burty).
    let zb = 0;
    let slab = SLAB_NOZZLE_ON_SPRITE;
    if (modelId) {
      zb = nozzleAxisOnModel(modelId, F.source[i], F.ox[i], F.oy[i]) * k - SIDE_THRUSTER_AXIS_Z * R;
      slab = SLAB_NOZZLE_ON_MODEL;
    }
    T.x = F.x[i] - B.orgX;
    T.y = F.y[i] - B.orgY;
    T.z = zb;
    T.scale = R;
    T.baseCos = F.baseX[i];
    T.baseSin = F.baseY[i];
    T.dirCos = F.dirX[i];
    T.dirSin = F.dirY[i];
    T.throttle = F.throttle[i];
    T.heat = F.heat[i];
    T.palette = pal;
    T.zb = zb;
    T.zt = zb + height * R;
    T.lo = slab.lo;
    T.hi = slab.hi;
    B.push(T);
  }
  B.end();
  _nozzleShown = B.count;
}

// ---------------------------------------------------------------------------
// Rozgrzewka (rejestr Core3D.warmup, ekran ładowania): modele obecne w świecie (lista od gry) — bryła
// sztywna, skóra, partia wież (jeden program na wszystkie rodziny) i partia dysz SIDE, pass ortho (warstwa 0).
// ---------------------------------------------------------------------------
export function warmupShipModels3D(ids = []) {
  // Modele rysują też kamery 3D (niezależnie od opcji) — rozgrzewka zawsze.
  const out = [];
  {
    for (const id of ids) {
      const a = modelAssets(id);
      if (!a?.ready) continue;
      out.push(_warmHolder(a.geometry, a.material), _warmHolder(skinWarmGeometry(), a.skinMaterial));
      const lg = lightsGeometry(a);
      if (lg) out.push(_warmHolder(lg, lightMaterial()));
    }
    // ścianki przekroju (kamery 3D): ten sam układ atrybutów co syncCutWalls
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    cg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]), 3));
    cg.setAttribute('aLat', new THREE.BufferAttribute(new Float32Array(9), 3));
    out.push(_warmHolder(cg, cutMaterial()));
  }
  {
    // partia wież: układ atrybutów i stan jak siatki partii (receiveShadow — w kluczu programu three)
    const fam = WEAPON3D_FAMILY.railgun_mk2 || Object.values(WEAPON3D_FAMILY).find(Boolean);
    if (fam) out.push(turretBatchWarmHolder(turretMaterial(), fam));
  }
  // partia dysz SIDE (rysowana w każdym wariancie wyglądu — sprite'y i modele)
  out.push(thrusterBatchWarmHolder(nozzleMaterial()));
  return out;
}

let _warmIds = () => [];
export function setShipModels3DWarmIds(fn) { if (typeof fn === 'function') _warmIds = fn; }
Core3D.warmup?.add({ name: 'modele 3D statków i broni', objects: () => warmupShipModels3D(_warmIds()), layer: 0, phase: 'loading' });
Core3D.warmup?.add({ name: 'modele 3D statków i broni (kamery 3D)', objects: () => warmupShipModels3D(_warmIds()), layer: 0, ortho: false, phase: 'loading' });

/** Stan ostatniej klatki: egzemplarze, widoczne (model albo wieże), wieże w partiach, skóry, rysunki partii. */
export function shipModels3DStats() {
  let turrets = 0, skins = 0, visible = 0;
  for (const inst of _instances.values()) {
    if (inst.frame !== _frame) continue;
    let n = 0;
    for (const t of inst.turrets.values()) if (t.shown === _frame) n++;
    if (!inst.root.visible && n === 0) continue;
    visible++;
    turrets += n;
    if (inst.skinMesh?.visible) skins++;
  }
  const b = _batches;
  return {
    instances: _instances.size, visible, turrets, skins, models: [..._models.keys()],
    turretDraws: b ? b.draws || 0 : 0, turretFamilies: b ? b.list.length : 0,
    sideNozzles: _nozzleShown, sideNozzleDraws: _nozzles ? _nozzles.draws : 0
  };
}
