/**
 * hullBodies — kadłuby gry na silniku WĘZŁÓW i BELEK (destructorBeams3D, tryb płaski).
 *
 * Zastępuje heksowy destruktor (destructor.js) dla statków, NPC i ich wraków.
 * Kadłub powstaje z tego samego obrazu co dawniej initHexBody (sprite w rozmiarze
 * renderu), komórka = 15 px jak w demie destruktor2d.html. Rozgrywka zostaje w 2D gry:
 *  - gra całkuje ruch encji (x, y, angle, vx, vy, angVel) jak dotąd,
 *  - przed krokiem silnika ciało dostaje pozę i prędkość encji (syncIn),
 *  - silnik liczy kontakty, zgniot, rozpady i zwraca poprawkę ruchu (syncOut).
 *
 * Układy. Silnik: X = x gry, Y = −y gry (odbicie), θ = −(kąt + obrót sprite'a),
 * ω = −ω gry — to ten sam układ co render Core3D (x, −y), więc skórę kadłuba
 * ustawia się wprost z ciała. Kotwica encji (x, y) to u statku ŚRODEK SPRITE'A
 * (gniazda, dysze, światła liczą się od niego), u wraku ŚRODEK MASY (odłam daleko
 * od środka sprite'a rodzica nie może mieć tam swojej pozycji). Kotwica statku leży
 * w układzie spoczynkowym ciała (latticeMin + stała), więc rozpad jej nie rusza.
 *
 * Encja z kadłubem ma `beamHull` (rekord niżej); `hexGrid` jej nie dotyczy.
 */

import { DestructorBeams3D as D, createBeamConfig } from './destructorBeams3D.js';
import { buildSpriteBeamStructure } from './beamSprite2D.js';
import { defineLazyViews } from './beamStore3D.js';
import { activeRegion, markSkinDirty } from './beamActiveRegion3D.js';
import { areTowBodiesCollisionDisabled } from './towSystem.js';
import { transferSalvageToWreck, clearSalvage } from './salvage.js';
import { CollisionFX, impactEvent, grindEvent } from '../vfx/collisionFx.js';

// Odstęp heksów dawnego destruktora (px sprite'a) — jednostka, w której strojono HP
// kadłubów, kratery i łup. Węzeł siatki `cellPx` liczy się za (cellPx / HEX_PITCH_PX)²
// heksów: tyle ma HP, tyle waży w łupie, a krater mierzy się w heksach, nie w węzłach.
export const HEX_PITCH_PX = 7.5;

export const HULL_BODY_CONFIG = {
  // --- budowa ---
  // Bok komórki w pikselach sprite'a — siatka dema. Przy 7,5 (heks) kadłub miał 4× więcej
  // węzłów: pchany okręt budził się cały i nie zasypiał (ciągły styk ~20× droższy),
  // a kadłub pękał zamiast sprężynować jak w demie.
  cellPx: 15,
  alphaCutoff: 40,          // jak initHexBody
  frameStride: 2,
  bulkheadEvery: 8,

  // --- masa zderzeń ---
  // Ciało w silniku ma masę z POWIERZCHNI kadłuba przy jednej gęstości dla wszystkich (jak
  // destruktor2d.html: Atlas 1800×806 px = 672 400 j.² = 800 tys.). Zderzenie kadłubów zależy
  // tylko od stosunków mas, a szablony gry dawały kapitałom 4–5× mniej masy na j.² niż fregatom
  // i niszczycielom (mały okręt „odbijał” Atlasa jak ciężki). Masa ENCJI zostaje masą gry
  // (ciąg dysz, separacja AI, holowanie, asteroidy) w swojej skali.
  massPerArea: 1.19,

  // --- silnik (strojenie z dema destruktor2d.html) ---
  crushStrength: 300000,
  globalBreakMul: 0.6,
  maxContacts: 384,
  maxWrecks: 400,           // wraki w ruchu jednocześnie; ponad to odłamy idą w odłamki
  splitMaxFragments: 20,
  heatGain: 1,
  heatSpeed: 150,           // j./s zbliżania, przy których zgniatana blacha jest biała
  heatDecay: 0.35,          // 1/s — ten sam zanik co DESTRUCTOR_CONFIG.heatDecay (shader kadłuba)
  // Szczyt HDR żaru skóry (uHeatPeak w hexShips3D.js; jasność = szczyt × (0,26h + 0,74h⁴)).
  // Dawniej 9 z DESTRUCTOR_CONFIG: zgniatana powierzchnia (h = heatContact 0,35) stała na
  // progu bloomu (0,92), brzeg rany (h = 1) świecił bielą HDR 9 i bloom (×~7,5 energii)
  // zalewał zgniot. Pomiar A/B 2026-09-26: po poprawce iskier to żar dawał ~¾ nadmiarowej
  // jasności styku (przy 4,5). Przy 2,5 pierścień brzegu (h ≈ 0,55 → 0,53) i powierzchnia
  // (0,26) tlą się pomarańczem pod progiem, a bielą z małą poświatą świeci tylko świeży brzeg
  // rany — deformacja zostaje czytelna.
  heatGlowPeak: 2.5,

  // --- trafienia: krater ---
  // Budżet HP = craterHpPerDamage · obrażenia, schodzi z węzłów od najbliższego (HP węzła =
  // 80 · heksy na węzeł, ten sam pancerz na powierzchnię co heksy). Promień krateru ogranicza,
  // jak daleko sięga nadmiar ciężkiego pocisku; liczony w HEKSACH (HEX_PITCH_PX), nie w węzłach.
  craterHpPerDamage: 0.9,   // dawny heks: bezpośrednie trafienie zdejmowało 0,9 · obrażeń
  craterMinCells: 1.5,
  craterMaxCells: 5,
  craterRefDamage: 80,      // obrażenia, przy których promień rośnie o heks
  hitReachCells: 0.55,      // promień węzła dla pocisków i wiązek (koła pokrywają płytę bez szpar)
  probeReachCells: 0.8,     // sonda punktowa (podparcie gniazd broni i rdzeni)

  // --- zdarzenia zderzeń (CollisionFX, jak DESTRUCTOR_CONFIG) ---
  contactHoldSec: 0.1,      // okno „para w styku” dla AI (hasContact)
  impactMinSpeed: 40,
  impactCooldown: 1.5,
  seamSparkPoints: 6,

  // --- wraki ---
  wreckFriction: 0.9986,
  wreckFullCollisionTime: 2.5,
  wreckWakeRelSpeed: 70,
  wreckColdAngVel: 0.06
};

const C = HULL_BODY_CONFIG;

// ============================ ENCJA ============================

function entityPosX(e) { return (e.pos && typeof e.pos.x === 'number') ? e.pos.x : (Number(e.x) || 0); }
function entityPosY(e) { return (e.pos && typeof e.pos.y === 'number') ? e.pos.y : (Number(e.y) || 0); }
function entityVelX(e) { return (e.vel && typeof e.vel.x === 'number') ? e.vel.x : (Number(e.vx) || 0); }
function entityVelY(e) { return (e.vel && typeof e.vel.y === 'number') ? e.vel.y : (Number(e.vy) || 0); }

function setEntityPos(e, x, y) {
  if (e.pos && typeof e.pos.x === 'number') { e.pos.x = x; e.pos.y = y; }
  e.x = x;
  e.y = y;
}

function setEntityVel(e, vx, vy) {
  if (e.vel && typeof e.vel.x === 'number') { e.vel.x = vx; e.vel.y = vy; }
  e.vx = vx;
  e.vy = vy;
}

// Obrót sprite'a jak getEntitySpriteRotation destruktora (gracz zawsze 0).
export function hullSpriteRotation(e) {
  if (e?.isPlayer) return 0;
  const r = (e?.visual && typeof e.visual.spriteRotation === 'number') ? e.visual.spriteRotation
    : (e?.capitalProfile && typeof e.capitalProfile.spriteRotation === 'number') ? e.capitalProfile.spriteRotation
      : (e?.profile && typeof e.profile.spriteRotation === 'number') ? e.profile.spriteRotation : 0;
  return Number.isFinite(r) ? r : 0;
}

// Skala sprite'a (j. świata na piksel). Siatka jest kwadratowa: skala X obowiązuje obie osie.
function entitySpriteScale(e) {
  const v = e?.visual;
  const s = (v && typeof v.spriteScaleX === 'number') ? v.spriteScaleX
    : (v && typeof v.spriteScale === 'number') ? v.spriteScale : 1;
  return Number.isFinite(s) && s > 0 ? s : 1;
}

// ============================ OBRAZ ============================

function readImageRGBA(image) {
  if (image && image.data && Number.isFinite(image.width) && Number.isFinite(image.height)) return image;
  const w = Math.max(1, Math.round(Number(image?.width) || Number(image?.naturalWidth) || 0));
  const h = Math.max(1, Math.round(Number(image?.height) || Number(image?.naturalHeight) || 0));
  let ctx = null;
  if (typeof image?.getContext === 'function') {
    ctx = image.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h)
      : (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : null);
    if (!canvas) return null;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
  }
  return ctx.getImageData(0, 0, w, h);
}

function cloneStructure(src) {
  // Widoki `nodes` / `beams` kopii powstają dopiero na żądanie.
  return defineLazyViews({
    ...src,
    nodeStore: src.nodeStore.clone(),
    beamStore: src.beamStore.clone(),
    invInertia: src.invInertia.slice()
  });
}

// ============================ SCRATCH ============================

const _pose = { x: 0, y: 0, theta: 0, c: 1, s: 0 };
const _local = { x: 0, y: 0 };
const _sweepOut = { t: Infinity, node: -1 };
const _impactVel = { x: 0, y: 0, z: 0 };
const _impactOpts = { radius: 0, hpBudget: 0, damageFraction: 1 };
const _nodeWorld = { x: 0, y: 0 };

/** Wynik sweep() — współdzielony, ważny do następnego wywołania. */
export const hullSweepResult = { t: 0, worldX: 0, worldY: 0, projectileX: 0, projectileY: 0, node: -1, hitShard: null };

// ============================ SYSTEM ============================

export const HullBodies = {
  config: C,
  engine: D,
  ready: false,
  simTime: 0,
  perf: { lastStepMs: 0, bodies: 0, contacts: 0, lastContacts: 0 },
  _bodies: [],
  _hulls: [],
  _pairs: new WeakMap(),
  _structures: new WeakMap(),
  _seam: new Float32Array(64),
  onWreckSpawned: null,       // (wreckEntity, parentEntity) — gra: listy, łup, ładunek

  init() {
    if (this.ready) return this;
    const cfg = createBeamConfig(C.cellPx);
    Object.assign(cfg, {
      planar: true,
      localSolver: true,
      crushStrength: C.crushStrength,
      globalBreakMul: C.globalBreakMul,
      maxContacts: C.maxContacts,
      maxWrecks: C.maxWrecks,
      splitMaxFragments: C.splitMaxFragments,
      heatGain: C.heatGain,
      heatSpeed: C.heatSpeed,
      heatDecay: C.heatDecay
    });
    D.init(cfg);
    D.pairFilter = pairFilter;
    D.onContact = onContact;
    D.onWreck = onWreck;
    D.onNodeDebris = onNodeDebris;
    this.ready = true;
    return this;
  },

  // --------------------------- BUDOWA ---------------------------

  /** Konstrukcja z obrazu (jedna na obraz × rozmiar × skalę — flota jednego typu dzieli budowę). */
  structureFor(image, scale = 1) {
    const W = Math.max(1, Math.round(Number(image?.width) || Number(image?.naturalWidth) || 0));
    const H = Math.max(1, Math.round(Number(image?.height) || Number(image?.naturalHeight) || 0));
    const key = `${W}x${H}|${scale}|${C.cellPx}`;
    let byKey = this._structures.get(image);
    const cached = byKey?.get(key);
    if (cached) return cached;
    const rgba = readImageRGBA(image);
    if (!rgba) return null;
    const cellsAlong = Math.max(4, Math.round(W / C.cellPx));
    const structure = buildSpriteBeamStructure(rgba, {
      worldLength: W * scale,
      cellsAlong,
      alphaCutoff: C.alphaCutoff,
      frameStride: C.frameStride,
      bulkheadEvery: C.bulkheadEvery
    });
    structure.imageWidth = W;
    structure.imageHeight = H;
    // Węzeł liczy się za tyle dawnych heksów, ile ich mieści jego komórka: tyle razy więcej
    // HP (ten sam pancerz na powierzchnię co heksy 80 HP), tyle waży w łupie.
    const hexPerNode = ((W / cellsAlong) / HEX_PITCH_PX) ** 2;
    const ns = structure.nodeStore;
    let coverage = 0;
    for (let i = 0; i < ns.count; i++) {
      ns.hp[i] *= hexPerNode;
      ns.maxHp[i] *= hexPerNode;
      if (ns.active[i]) coverage += ns.coverage[i];
    }
    structure.hexPerNode = hexPerNode;
    // Powierzchnia kadłuba w j.² świata — podstawa masy zderzeń (massPerArea).
    structure.area = coverage * structure.cellSize * structure.cellSize;
    if (!byKey) { byKey = new Map(); this._structures.set(image, byKey); }
    byKey.set(key, structure);
    return structure;
  },

  /**
   * Kadłub dla encji z obrazu sprite'a (ten sam, który dostawał initHexBody).
   * Zwraca rekord `entity.beamHull` albo null (pusty obraz, błąd odczytu).
   */
  createHull(entity, image, opts = {}) {
    if (!entity || !image) return null;
    this.init();
    const scale = entitySpriteScale(entity);
    let structure = null;
    try {
      structure = this.structureFor(image, scale);
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[HullBodies] budowa kadłuba nie powiodła się:', err);
      return null;
    }
    if (!structure) return null;
    // Masa zderzeń z powierzchni (jedna gęstość dla wszystkich kadłubów); masa gry encji bez zmian,
    // a bez niej (transportowce) — masa zderzeń.
    const collisionMass = C.massPerArea * structure.area;
    const body = D.createBody(cloneStructure(structure), {
      name: String(entity.name || entity.type || 'kadłub'),
      massMultiplier: collisionMass / structure.mass
    });
    const entityMass = Number(entity.mass);
    const mass = Number.isFinite(entityMass) && entityMass > 0 ? entityMass : body.mass;
    const skin = structure.spriteSkin;
    const W = structure.imageWidth, H = structure.imageHeight;
    const hull = {
      entity,
      body,
      image,
      visualImage: opts.visualImage || null,
      normalMapImage: opts.normalMapImage || null,
      srcWidth: W,
      srcHeight: H,
      scale,
      cellSize: body.cellSize,
      pixelPitch: skin.pixelPitch,
      nx: skin.nx,
      ny: skin.ny,
      pivot: { x: 0, y: 0 },
      anchorMode: 'sprite',
      // Środek sprite'a w układzie ciała = latticeMin + (anchorDX, anchorDY).
      anchorDX: W * 0.5 * scale,
      anchorDY: skin.ny * body.cellSize - H * 0.5 * scale,
      baseNodes: body.activeNodes,
      hexPerNode: structure.hexPerNode,  // dawne heksy na węzeł (krater, łup, tempo cięcia)
      massScale: mass / body.mass,       // masa gry na jednostkę masy zderzeń (przy budowie)
      isFragment: false,
      radius: 0,
      revision: 0,
      shieldCells: null,
      _massRef: body.mass,               // masa ciała przy ostatniej synchronizacji masy encji
      _inPx: 0, _inPy: 0, _inVx: 0, _inVy: 0, _inW: 0, _inNodes: 0
    };
    body.entity = entity;
    body.hull = hull;
    hull.radius = anchorRadius(hull);
    entity.beamHull = hull;
    entity.mass = mass;
    entity.radius = hull.radius;
    entity._bpRadius = hull.radius;
    syncBodyPose(hull);
    return hull;
  },

  /** Kadłub encji przestaje istnieć (encja znika albo oddała go wrakowi). */
  release(entity) {
    const hull = entity?.beamHull;
    if (!hull) return;
    entity.beamHull = null;
    if (hull.entity === entity) {
      hull.body.dead = true;
      hull.body.entity = null;
      hull.entity = null;
    }
  },

  // --------------------------- KROK ---------------------------

  /** Krok fizyki kadłubów. `entities` — lista destruktora (encje bez beamHull są pomijane). */
  step(dt, entities) {
    const t0 = nowMs();
    if (!this.ready) this.init();
    this.simTime += dt;
    this.perf.contacts = 0;
    const bodies = this._bodies, hulls = this._hulls;
    bodies.length = 0;
    hulls.length = 0;
    for (let k = 0; k < entities.length; k++) {
      const e = entities[k];
      const hull = e?.beamHull;
      if (!hull || hull.entity !== e) continue;
      const body = hull.body;
      if (!body || body.dead || body.activeNodes <= 0) continue;
      if (e.dead && !e.isWreck) continue;
      syncIn(hull);
      bodies.push(body);
      hulls.push(hull);
    }
    const count = hulls.length;
    if (count > 0) D.update(dt, bodies);
    for (let k = 0; k < count; k++) {
      const hull = hulls[k];
      dissolveCrumbWreck(hull.body);
      syncOut(hull);
    }
    this.perf.bodies = bodies.length;
    this.perf.lastContacts = this.perf.contacts;
    this.perf.lastStepMs = nowMs() - t0;
  },

  /**
   * Naprawa (klawisz R): belki się zrastają, długości spoczynkowe i węzły wracają do kształtu
   * spoczynkowego, HP węzłów rośnie. Zwraca, czy coś się jeszcze zmieniło (false = gotowe).
   * Bez solvera: D.repair budził wszystkie węzły kadłuba (Atlas: 12 tys. węzłów, 50 tys. belek
   * co krok, ~4,5 ms), a solver i naprawa ciągnęły długości w przeciwne strony — naprawa nie
   * kończyła się nigdy. Tu węzły i długości zbiegają wprost do spoczynku (kształt spójny, więc
   * solver nie ma czego poprawiać), z progami domknięcia; skóra tylko dla zmienionych węzłów.
   */
  repair(entities, dt) {
    if (!this.ready) this.init();
    let any = false;
    for (const e of entities) {
      const hull = e?.beamHull;
      if (!hull || hull.entity !== e || hull.body.dead) continue;
      if (repairBody(hull.body, dt)) any = true;
    }
    return any;
  },

  // --------------------------- ZAPYTANIA ---------------------------

  /** Stan struktury do sufitu HP (jak getHexStructuralState): żywe węzły kadłuba vs startowe. */
  structuralState(entity, out = {}) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity) return null;
    const active = hull.body.dead ? 0 : hull.body.activeNodes;
    const total = Math.max(1, hull.baseNodes);
    out.active = active;
    out.total = total;
    out.ratio = Math.max(0, Math.min(1, active / total));
    return out;
  },

  hasHull(entity) {
    const hull = entity?.beamHull;
    return !!hull && hull.entity === entity && !hull.body.dead && hull.body.activeNodes > 0;
  },

  /** Czy para jest w styku metal-metal (AI ustępuje wtedy fizyce, jak przy destruktorze). */
  hasContact(a, b) {
    const pair = this._pairs.get(a)?.get(b);
    return !!pair && pair.until > this.simTime;
  },

  /**
   * Pierwszy żywy węzeł na odcinku pocisku (świat gry, y w dół). Wynik we współdzielonym
   * hullSweepResult albo null. `worldX/Y` = punkt wejścia na koło węzła — z niego
   * impact() zaczyna krater, więc trafia ten sam węzeł.
   */
  sweep(entity, x0, y0, x1, y1, radius = 0) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity || hull.body.dead) return null;
    const body = hull.body;
    const pose = entityPose(hull, _pose);
    toLocal(hull, pose, x0, y0, _local);
    const lx0 = _local.x, ly0 = _local.y;
    toLocal(hull, pose, x1, y1, _local);
    const reach = C.hitReachCells * body.cellSize + Math.max(0, Number(radius) || 0);
    if (D.sweepLocal2D(body, lx0, ly0, _local.x, _local.y, reach, _sweepOut) < 0) return null;
    const t = _sweepOut.t;
    const r = hullSweepResult;
    r.t = t;
    r.node = _sweepOut.node;
    r.hitShard = null;
    r.projectileX = x0 + (x1 - x0) * t;
    r.projectileY = y0 + (y1 - y0) * t;
    r.worldX = r.projectileX;
    r.worldY = r.projectileY;
    return r;
  },

  /** Czy w punkcie (świat gry) jest żywy węzeł — podparcie gniazd broni i rdzeni. */
  probe(entity, x, y, reach = 0) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity || hull.body.dead) return false;
    const pose = entityPose(hull, _pose);
    toLocal(hull, pose, x, y, _local);
    const r = reach > 0 ? reach : C.probeReachCells * hull.body.cellSize;
    return D.probeLocal2D(hull.body, _local.x, _local.y, r) >= 0;
  },

  /**
   * Trafienie w punkt (świat gry): krater nearest-first z budżetem HP ∝ obrażeniom,
   * wgniecenie wzdłuż wektora pocisku. opts.radius — promień krateru w j. świata (np. wybuch).
   * Zwraca, czy trafienie objęło jakikolwiek węzeł.
   */
  impact(entity, x, y, damage, vel = null, opts = null) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity || hull.body.dead) return false;
    const dmg = Math.max(0, Number(damage) || 0);
    if (dmg <= 0) return this.probe(entity, x, y);
    const body = hull.body;
    syncBodyPose(hull);
    // Promień w heksach (strojenie heksowe), odstęp heksa w j. świata = komórka / √(heksy na węzeł).
    const hexPitch = body.cellSize / Math.sqrt(hull.hexPerNode || 1);
    const hexes = Math.max(C.craterMinCells, Math.min(C.craterMaxCells, C.craterMinCells + Math.sqrt(dmg / C.craterRefDamage)));
    _impactOpts.radius = Number(opts?.radius) > 0 ? Number(opts.radius) : hexes * hexPitch;
    _impactOpts.hpBudget = dmg * C.craterHpPerDamage;
    _impactOpts.damageFraction = 1;
    _impactVel.x = Number(vel?.x) || 0;
    _impactVel.y = -(Number(vel?.y) || 0);
    _impactVel.z = 0;
    const hit = D.applyImpact(body, x, -y, 0, dmg, _impactVel, _impactOpts);
    if (hit && entity.isWreck) {
      entity._wreckSleeping = false;
      entity._wreckSleepTimer = 0;
      entity._lastImpactMs = this.simTime * 1000;
    }
    return hit;
  },

  /**
   * Rzaz (Hexlance): niszczy żywe węzły w pasie o półszerokości `halfWidth` wokół odcinka
   * (świat gry). Zwraca liczbę zniszczonych węzłów; pierwszy punkt wejścia w `hullSweepResult`.
   */
  cutSegment(entity, x0, y0, x1, y1, halfWidth) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity || hull.body.dead) return 0;
    const body = hull.body;
    syncBodyPose(hull);
    const pose = entityPose(hull, _pose);
    toLocal(hull, pose, x0, y0, _local);
    const lx0 = _local.x, ly0 = _local.y;
    toLocal(hull, pose, x1, y1, _local);
    const lx1 = _local.x, ly1 = _local.y;
    if (D.sweepLocal2D(body, lx0, ly0, lx1, ly1, halfWidth, _sweepOut) < 0) return 0;
    const t = _sweepOut.t;
    hullSweepResult.t = t;
    hullSweepResult.worldX = hullSweepResult.projectileX = x0 + (x1 - x0) * t;
    hullSweepResult.worldY = hullSweepResult.projectileY = y0 + (y1 - y0) * t;
    return cutLocalBand(body, lx0, ly0, lx1, ly1, halfWidth);
  },

  /** Cięcie wraku w polu: zdejmuje do `count` żywych węzłów najbliżej punktu (świat gry). */
  cutNearest(entity, x, y, count) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity || hull.body.dead) return 0;
    const body = hull.body, s = body.nodeStore;
    syncBodyPose(hull);
    const pose = entityPose(hull, _pose);
    toLocal(hull, pose, x, y, _local);
    let removed = 0;
    for (let n = 0; n < count && !body.dead; n++) {
      // Najbliższy żywy węzeł: sonda rosnącym promieniem (wrak tnie się od strony tnącego).
      let i = -1;
      for (let reach = body.cellSize; reach < body.radius * 2 + body.cellSize * 4 && i < 0; reach *= 2) {
        i = D.probeLocal2D(body, _local.x, _local.y, reach);
      }
      if (i < 0) {
        for (let k = 0; k < s.count; k++) if (s.active[k]) { i = k; break; }
      }
      if (i < 0) break;
      D.destroyNode(body, i);
      removed++;
    }
    if (removed > 0 && !body.noSplit && D.splitQueue.indexOf(body) === -1) D.splitQueue.push(body);
    return removed;
  },

  /** Cięcie w polu: zdejmuje żywy węzeł najdalszy od środka masy — wrak znika od krawędzi. */
  cutOuterNode(entity) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity || hull.body.dead) return false;
    const body = hull.body, s = body.nodeStore;
    let best = -1, bestD2 = -1;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      const d2 = s.ox[i] * s.ox[i] + s.oy[i] * s.oy[i];
      if (d2 > bestD2) { bestD2 = d2; best = i; }
    }
    if (best < 0) return false;
    D.destroyNode(body, best);
    if (!body.dead && !body.noSplit && D.splitQueue.indexOf(body) === -1) {
      body.structureDirty = true;
      D.splitQueue.push(body);
    }
    return true;
  },

  /**
   * Wrak-nośnik ładunku frachtowca: z ocalałych węzłów, a gdy nie zostało nic — z jednego
   * odtworzonego węzła najbliżej środka masy (jak odtworzony heks w dawnym destruktorze).
   */
  ensureCargoCarrier(entity) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity) return null;
    const body = hull.body, s = body.nodeStore;
    if (body.dead || body.activeNodes <= 0) {
      let best = -1, bestD2 = Infinity;
      for (let i = 0; i < s.count; i++) {
        const d2 = s.ox[i] * s.ox[i] + s.oy[i] * s.oy[i];
        if (d2 < bestD2) { bestD2 = d2; best = i; }
      }
      if (best < 0) return null;
      s.active[best] = 1;
      s.hp[best] = Math.max(1, s.maxHp[best]);
      s.x[best] = s.ox[best]; s.y[best] = s.oy[best]; s.z[best] = s.oz[best];
      s.vx[best] = 0; s.vy[best] = 0; s.vz[best] = 0;
      body.dead = false;
      body.activeNodes = 1;
      body.mass = Math.max(1, s.mass[best]);
      body.invMass = 1 / body.mass;
      body.structureDirty = true;
      body.meshDirty = true;
      body._hashTick = -1;
      if (body._region) body._region.dirtyAll = true;
      D._updateRadius(body);
    }
    return this.convertToWreck(entity);
  },

  /**
   * Krytyczny wybuch reaktora: kadłub przechodzi we wrak, rdzeń wokół punktu wybuchu idzie
   * w odłamki (lecą promieniście), reszta pęka wzdłuż promieni na kilka ciężkich odłamów,
   * które dostają pchnięcie od wybuchu. Zwraca { fragments, debris } jak dawny rozpad heksów.
   */
  shatter(entity, worldX, worldY, severity = 0) {
    const wreck = this.convertToWreck(entity);
    if (!wreck) return { fragments: 0, debris: 0 };
    const hull = wreck.beamHull, body = hull.body, s = body.nodeStore, cs = body.cellSize;
    const sev = Math.max(0, Math.min(1.4, Number(severity) || 0));
    const nodes = body.activeNodes;
    syncBodyPose(hull);
    const pose = entityPose(hull, _pose);
    toLocal(hull, pose, worldX, worldY, _local);
    const lx = _local.x, ly = _local.y;

    // 1) Rdzeń: ~22–50% węzłów najbliżej wybuchu w odłamki (promień z pola powierzchni).
    const debrisFrac = Math.min(0.5, 0.22 + Math.min(0.28, sev * 0.2));
    const coreR = Math.sqrt(nodes * debrisFrac * cs * cs / Math.PI);
    const coreR2 = coreR * coreR;
    const speedMul = 1 + Math.min(0.8, sev * 0.55);
    let debris = 0;
    for (let i = 0; i < s.count && !body.dead; i++) {
      if (!s.active[i]) continue;
      const dx = s.x[i] - lx, dy = s.y[i] - ly, d2 = dx * dx + dy * dy;
      if (d2 > coreR2) continue;
      const d = Math.sqrt(d2) || 1;
      const speed = (420 + Math.random() * 560) * speedMul;
      s.vx[i] = dx / d * speed + (Math.random() - 0.5) * 180;
      s.vy[i] = dy / d * speed + (Math.random() - 0.5) * 180;
      D.destroyNode(body, i);
      debris++;
    }
    if (body.dead) return { fragments: 0, debris };

    // 2) Promieniste rzazy od wybuchu: 2–5 odłamów zależnie od wielkości i siły.
    const remaining = body.activeNodes;
    let frags = 2;
    if (remaining >= 400) frags++;
    if (remaining >= 1600) frags++;
    if (remaining >= 3200 && sev > 0.95) frags++;
    const span = body.radius * 2 + cs * 4;
    const phase = Math.random() * Math.PI * 2;
    for (let k = 0; k < frags && !body.dead; k++) {
      const a = phase + (k / frags) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      cutLocalBand(body, lx, ly, lx + Math.cos(a) * span, ly + Math.sin(a) * span, cs * 0.75);
    }

    // 3) Rozpad od razu (nie czekamy na krok): powstają encje wraków.
    const wrecks = typeof window !== 'undefined' && Array.isArray(window.wrecks) ? window.wrecks : null;
    const before = wrecks ? wrecks.length : 0;
    if (!body.dead) {
      const queued = D.splitQueue;
      D.splitQueue = [body];
      body.structureDirty = true;
      const tmp = [body];
      D.processSplits(tmp);
      for (const b of queued) if (b !== body && D.splitQueue.indexOf(b) === -1) D.splitQueue.push(b);
    }

    // 4) Pchnięcie od wybuchu: promieniście + stycznie + obrót (jak dawny rozpad heksów).
    const kick = (w) => {
      if (!w || w.dead) return;
      const dx = w.x - worldX, dy = w.y - worldY;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = dx / dist, ny = dy / dist;
      const radial = (150 + Math.random() * 180) * speedMul;
      const tangential = (Math.random() - 0.5) * 220 * speedMul;
      w.vx = (w.vx || 0) + nx * radial - ny * tangential;
      w.vy = (w.vy || 0) + ny * radial + nx * tangential;
      w.angVel = (w.angVel || 0) + (Math.random() - 0.5) * 0.42 * speedMul;
    };
    kick(wreck);
    let fragments = 1;
    if (wrecks) {
      for (let i = before; i < wrecks.length; i++) { kick(wrecks[i]); fragments++; }
    }
    return { fragments, debris };
  },

  /** Budzi solver kadłuba (np. śpiący wrak, w który coś wjeżdża). */
  wake(entity, hold = 0) {
    const hull = entity?.beamHull;
    if (!hull || hull.body.dead) return;
    D.wake(hull.body, hold);
  },

  /** Usypia kadłub (wrak zasnął w pętli wraków): solver go nie liczy, dopóki coś nie obudzi. */
  sleep(entity) {
    const hull = entity?.beamHull;
    if (!hull || hull.body.dead) return;
    hull.body.isSleeping = true;
    hull.body.wakeHold = 0;
  },

  sweepResult: hullSweepResult,

  /** Wrak z CAŁEGO kadłuba encji (śmierć statku). Kadłub przechodzi na nową encję wraku. */
  convertToWreck(entity) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity) return null;
    const body = hull.body;
    if (body.dead || body.activeNodes <= 0) return null;
    syncIn(hull);
    body.isWreck = true;
    const wreck = makeWreckEntity(entity, body, hull);
    entity.beamHull = null;
    finishWreck(wreck, entity, body.activeNodes, null);
    return wreck;
  },

  /** Wrak do usunięcia (despawn, budżet): jak recycleWreck — ładunek blokuje, łup czyszczony. */
  recycleWreck(wreck) {
    if (!wreck || !wreck.isWreck) return false;
    if (Object.values(wreck._cargoManifest || {}).some(amount => (Number(amount) || 0) > 0)) return false;
    wreck.dead = true;
    wreck.isCollidable = false;
    clearSalvage(wreck);
    wreck._wreckAge = 0;
    wreck._wreckSleepTimer = 0;
    wreck._wreckSleeping = false;
    wreck.isCold = false;
    wreck._coldSnapshot = null;
    this.release(wreck);
    return true;
  },

  /** Czy komórka `ix,iy` (klucz łupu) należy do żywej części kadłuba encji. */
  hasCell(entity, key) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity) return false;
    return bodyHasCell(hull.body, key);
  },

  /** Klucz komórki (ix,iy) najbliższej punktowi w pikselach sprite'a względem środka (gniazda broni). */
  cellKeyAtSpritePx(entity, px, py) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity) return null;
    const body = hull.body, s = body.nodeStore;
    const lx = body.latticeMin.x + hull.anchorDX + px * hull.scale;
    const ly = body.latticeMin.y + hull.anchorDY - py * hull.scale;
    let best = -1, bestD2 = Infinity;
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      const dx = s.ox[i] - lx, dy = s.oy[i] - ly;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    return best >= 0 ? `${s.ix[best]},${s.iy[best]}` : null;
  },

  /**
   * Obrys do tarczy-obrysu (shieldSystem): środki WSZYSTKICH węzłów spoczynkowych
   * w pikselach sprite'a względem środka, y w dół — jak origLx/origLy heksów.
   */
  shieldCells(entity) {
    const hull = entity?.beamHull;
    if (!hull) return null;
    if (hull.shieldCells) return hull.shieldCells;
    const body = hull.body, s = body.nodeStore;
    const out = new Float32Array(s.count * 2);
    const cx = body.latticeMin.x + hull.anchorDX, cy = body.latticeMin.y + hull.anchorDY;
    for (let i = 0; i < s.count; i++) {
      out[i * 2] = (s.ox[i] - cx) / hull.scale;
      out[i * 2 + 1] = -(s.oy[i] - cy) / hull.scale;
    }
    hull.shieldCells = out;
    return out;
  },

  /** Pozycja węzła w świecie gry (y w dół). */
  nodeWorld(hull, i, out = _nodeWorld) {
    const body = hull.body, s = body.nodeStore;
    const pose = entityPose(hull, _pose);
    const ax = anchorLocalX(hull), ay = anchorLocalY(hull);
    const lx = s.x[i] - ax, ly = s.y[i] - ay;
    out.x = pose.x + pose.c * lx - pose.s * ly;
    out.y = pose.y - (pose.s * lx + pose.c * ly);
    return out;
  },

  anchorLocalX,
  anchorLocalY,
  entityPose
};

// ============================ KOTWICA I POZA ============================

function anchorLocalX(hull) {
  return hull.anchorMode === 'com' ? 0 : hull.body.latticeMin.x + hull.anchorDX;
}

function anchorLocalY(hull) {
  return hull.anchorMode === 'com' ? 0 : hull.body.latticeMin.y + hull.anchorDY;
}

// Poza encji w układzie silnika: kotwica (x gry, −y gry → out.x = x gry, out.y = y gry),
// kąt θ i jego sin/cos.
function entityPose(hull, out) {
  const e = hull.entity;
  out.x = entityPosX(e);
  out.y = entityPosY(e);
  out.theta = -((Number(e.angle) || 0) + hullSpriteRotation(e));
  out.c = Math.cos(out.theta);
  out.s = Math.sin(out.theta);
  return out;
}

// Punkt świata gry → układ ciała (węzły). Kotwica encji = anchorLocal.
function toLocal(hull, pose, wx, wy, out) {
  const dx = wx - pose.x, dy = -(wy - pose.y);
  out.x = pose.c * dx + pose.s * dy + anchorLocalX(hull);
  out.y = -pose.s * dx + pose.c * dy + anchorLocalY(hull);
  return out;
}

// Ciało ← poza encji (bez prędkości). Zwraca R·anchorLocal w _local (do prędkości).
function syncBodyPose(hull) {
  const b = hull.body;
  const pose = entityPose(hull, _pose);
  const ax = anchorLocalX(hull), ay = anchorLocalY(hull);
  const rax = pose.c * ax - pose.s * ay, ray = pose.s * ax + pose.c * ay;
  b.pos.x = pose.x - rax;
  b.pos.y = -pose.y - ray;
  b.pos.z = 0;
  const half = pose.theta * 0.5;
  b.quat.x = 0; b.quat.y = 0; b.quat.z = Math.sin(half); b.quat.w = Math.cos(half);
  b._rotTick = -1;
  _local.x = rax;
  _local.y = ray;
}

function syncIn(hull) {
  const b = hull.body, e = hull.entity;
  syncBodyPose(hull);
  const rax = _local.x, ray = _local.y;
  const w = -(Number(e.angVel) || 0);
  // Prędkość początku ciała = prędkość kotwicy + ω × (początek − kotwica).
  b.vel.x = entityVelX(e) + w * ray;
  b.vel.y = -entityVelY(e) - w * rax;
  b.vel.z = 0;
  b.angVel.x = 0; b.angVel.y = 0; b.angVel.z = w;
  hull._inPx = b.pos.x; hull._inPy = b.pos.y;
  hull._inVx = b.vel.x; hull._inVy = b.vel.y; hull._inW = w;
  hull._inNodes = b.activeNodes;
}

function syncOut(hull) {
  const b = hull.body, e = hull.entity;
  if (!e) return;
  const nodesChanged = b.activeNodes !== hull._inNodes;
  // Masa encji idzie za metalem (jak dawny becomeDebris: mass −= masa heksa) — w SWOJEJ skali:
  // masa ciała to masa zderzeń, masa encji to masa gry. Moment bezwładności razem z nią —
  // ciąg dysz gracza rośnie z masą, więc uszkodzony statek nie obraca się wolniej. Po masie
  // ciała, nie po węzłach kroku: trafienia zabijają węzły MIĘDZY krokami (przed syncIn).
  if (b.mass !== hull._massRef) {
    const ratio = hull._massRef > 0 ? b.mass / hull._massRef : 1;
    if (ratio > 0 && ratio !== 1 && Number.isFinite(ratio)) {
      const mass = Number(e.mass) > 0 ? Number(e.mass) : b.mass * hull.massScale;
      e.mass = Math.max(10, mass * ratio);
      if (Number(e.inertia) > 0) e.inertia *= ratio;
    }
    hull._massRef = b.mass;
  }
  if (nodesChanged) hull.revision++;
  if (b.pos.x === hull._inPx && b.pos.y === hull._inPy && b.vel.x === hull._inVx &&
      b.vel.y === hull._inVy && b.angVel.z === hull._inW && !nodesChanged) return;
  const pose = entityPose(hull, _pose);
  if (hull.anchorMode === 'com') updateComPivot(hull);
  const ax = anchorLocalX(hull), ay = anchorLocalY(hull);
  const rax = pose.c * ax - pose.s * ay, ray = pose.s * ax + pose.c * ay;
  const w = b.angVel.z;
  setEntityPos(e, b.pos.x + rax, -(b.pos.y + ray));
  setEntityVel(e, b.vel.x - w * ray, -(b.vel.y + w * rax));
  e.angVel = -w;
  if (nodesChanged && hull.anchorMode === 'com') {
    e.radius = b.radius;
    e._bpRadius = b.radius;
    hull.radius = b.radius;
  }
}

// Zasięg kadłuba od kotwicy (statek: od środka sprite'a) — okrąg broadphase gry.
function anchorRadius(hull) {
  const b = hull.body, s = b.nodeStore;
  const ax = anchorLocalX(hull), ay = anchorLocalY(hull);
  let r2 = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const dx = s.x[i] - ax, dy = s.y[i] - ay;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) r2 = d2;
  }
  return Math.sqrt(r2) + b.cellSize;
}

// Pivot wraku = piksel sprite'a początku ciała (środka masy) względem środka sprite'a.
function updateComPivot(hull) {
  const b = hull.body;
  hull.pivot.x = -b.latticeMin.x / hull.scale - hull.srcWidth * 0.5;
  hull.pivot.y = (b.latticeMin.y + hull.ny * b.cellSize) / hull.scale - hull.srcHeight * 0.5;
}

function bodyHasCell(body, key) {
  if (!body || body.dead || typeof key !== 'string') return false;
  const comma = key.indexOf(',');
  if (comma < 0) return false;
  const ix = Number(key.slice(0, comma)), iy = Number(key.slice(comma + 1));
  if (!Number.isInteger(ix) || !Number.isInteger(iy)) return false;
  const d = body.dims;
  if (ix < 0 || iy < 0 || ix >= d.x || iy >= d.y) return false;
  const i = D._latticeIndex(body).cells[ix + iy * d.x];
  return i >= 0 && body.nodeStore.active[i] === 1;
}

// Naprawa kadłuba (HullBodies.repair): zbieżność wprost do spoczynku, bez solvera.
const REPAIR_RATE = 2.5;        // 1/s — kształt i długości belek (stała czasowa 0,4 s)
const REPAIR_HP_RATE = 0.8;     // maxHp na sekundę

function repairBody(body, dt) {
  const s = body.nodeStore, e = body.beamStore, active = s.active;
  const step = Math.max(0, Number(dt) || 0);
  const k = Math.min(1, step * REPAIR_RATE);
  const region = activeRegion(body);
  // Dużo zmienionych węzłów = pełny zapis skóry (tańszy niż 9 czworokątów na węzeł).
  const bulk = Math.max(64, s.count >> 3);
  let marked = 0, changed = false, moved = false;
  const mark = (i) => {
    if (region.dirtyAll) return;
    if (++marked > bulk) { region.dirtyAll = true; return; }
    markSkinDirty(body, i);
  };
  const ea = e.a, eb = e.b, rest = e.rest, restBase = e.restBase, broken = e.broken, fatigue = e.fatigue;
  let live = 0;
  for (let bi = 0; bi < e.count; bi++) {
    const a = ea[bi], c = eb[bi];
    // Belka do martwego węzła (albo do węzła, który odleciał z wrakiem) nie wraca.
    if (!active[a] || !active[c]) continue;
    live++;
    if (fatigue[bi] > 0) { fatigue[bi] = Math.max(0, fatigue[bi] - step * 2); changed = true; }
    const r = rest[bi], base = restBase[bi];
    if (r !== base) {
      const next = r + (base - r) * k;
      rest[bi] = Math.abs(next - base) < base * 0.002 ? base : next;
      changed = true;
      mark(a); mark(c);
    }
    if (broken[bi]) { broken[bi] = 0; changed = true; mark(a); mark(c); }
  }
  body.liveBeams = live;
  let maxDisp = 0;
  const x = s.x, y = s.y, z = s.z, ox = s.ox, oy = s.oy, oz = s.oz;
  for (let i = 0; i < s.count; i++) {
    if (!active[i]) continue;
    const dx = ox[i] - x[i], dy = oy[i] - y[i], dz = oz[i] - z[i];
    if (dx !== 0 || dy !== 0 || dz !== 0) {
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 0.02) { x[i] = ox[i]; y[i] = oy[i]; z[i] = oz[i]; }
      else { x[i] += dx * k; y[i] += dy * k; z[i] += dz * k; }
      s.vx[i] = 0; s.vy[i] = 0; s.vz[i] = 0;
      changed = true;
      moved = true;
      mark(i);
    }
    const disp = Math.max(Math.abs(x[i] - ox[i]), Math.abs(y[i] - oy[i]), Math.abs(z[i] - oz[i]));
    if (disp > maxDisp) maxDisp = disp;
    if (s.hp[i] < s.maxHp[i]) {
      s.hp[i] = Math.min(s.maxHp[i], s.hp[i] + s.maxHp[i] * step * REPAIR_HP_RATE);
      changed = true;
    }
  }
  if (changed) {
    body.meshDirty = true;
    body._maxDisp = maxDisp;
    body._hashTick = -1;
    if (moved) D._updateRadius(body);
  }
  return changed;
}

// Wrak mniejszy niż najmniejszy odłam rozpadu (silnik robi z takich odłamki) to okruch:
// rozpad łączników potrafi zostawić z odłamu kilka węzłów w linii jeden węzeł. Idzie
// w odłamki GPU, ciało umiera, a pętla wraków gry go usuwa (brak żywych węzłów).
function dissolveCrumbWreck(body) {
  if (!body.isWreck || body.dead || body.activeNodes <= 0) return;
  if (body.activeNodes >= Math.max(2, D.config.splitMinNodes | 0)) return;
  const s = body.nodeStore;
  for (let i = 0; i < s.count && !body.dead; i++) if (s.active[i]) D.destroyNode(body, i);
}

// Pas wokół odcinka (układ ciała): zniszcz wszystkie żywe węzły bliżej niż halfWidth.
function cutLocalBand(body, x0, y0, x1, y1, halfWidth) {
  const s = body.nodeStore, x = s.x, y = s.y, active = s.active;
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
  const r2 = halfWidth * halfWidth;
  const minX = Math.min(x0, x1) - halfWidth, maxX = Math.max(x0, x1) + halfWidth;
  const minY = Math.min(y0, y1) - halfWidth, maxY = Math.max(y0, y1) + halfWidth;
  let killed = 0;
  for (let i = 0; i < s.count; i++) {
    if (!active[i]) continue;
    const px = x[i], py = y[i];
    if (px < minX || px > maxX || py < minY || py > maxY) continue;
    let t = len2 > 1e-12 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x0 + dx * t - px, ey = y0 + dy * t - py;
    if (ex * ex + ey * ey > r2) continue;
    D.destroyNode(body, i);
    killed++;
    if (body.dead) break;
  }
  if (killed > 0) {
    D.wake(body, D.config.wakeHoldFrames);
    if (!body.noSplit && D.splitQueue.indexOf(body) === -1) D.splitQueue.push(body);
  }
  return killed;
}

// ============================ HAKI SILNIKA ============================

function isColdWreck(e) {
  if (!e.isWreck) return false;
  if (e._wreckSleeping) return true;
  if ((Number(e._wreckAge) || 0) <= C.wreckFullCollisionTime) return false;
  const vx = entityVelX(e), vy = entityVelY(e);
  return vx * vx + vy * vy < C.wreckWakeRelSpeed * C.wreckWakeRelSpeed &&
    Math.abs(Number(e.angVel) || 0) < C.wreckColdAngVel;
}

function pairFilter(A, B) {
  const ea = A.entity, eb = B.entity;
  if (!ea || !eb) return true;
  if (ea.isCollidable === false || eb.isCollidable === false) return false;
  // Składy i moduły jednego właściciela (pociąg megafrachtowca) — jak dawny destruktor.
  // Wraki zderzają się z rodzicem i rodzeństwem: odłam z tarana leci po fizyce.
  if (!ea.isWreck && !eb.isWreck) {
    const ra = ea.owner || ea, rb = eb.owner || eb;
    if (ra === rb || ra === eb || rb === ea) return false;
  }
  if (areTowBodiesCollisionDisabled(ea, eb)) return false;
  // Dwa stare, wolne wraki nie mielą się bez końca w stosie złomu.
  if (ea.isWreck && eb.isWreck && isColdWreck(ea) && isColdWreck(eb)) return false;
  return true;
}

function pairRecord(a, b) {
  const pairs = HullBodies._pairs;
  let pa = pairs.get(a);
  let pair = pa?.get(b);
  if (!pair) {
    if (!pa) pairs.set(a, pa = new WeakMap());
    let pb = pairs.get(b);
    if (!pb) pairs.set(b, pb = new WeakMap());
    pair = { until: 0, fresh: false, lastImpactTime: -Infinity, yieldPressure: 0 };
    pa.set(b, pair);
    pb.set(a, pair);
  }
  const now = HullBodies.simTime;
  pair.fresh = pair.until <= now;
  pair.until = now + C.contactHoldSec;
  return pair;
}

function fillCollisionEvent(ev, A, B, ea, eb, info) {
  const nx = info.nx, ny = -info.ny;                  // gra: y w dół
  const rAx = info.x - A.pos.x, rAy = info.y - A.pos.y;
  const wA = A.angVel.z;
  const massA = Math.max(1, A.mass), massB = Math.max(1, B.mass);
  const reduced = (massA * massB) / (massA + massB);
  ev.A = ea;
  ev.B = eb;
  ev.x = info.x;
  ev.y = -info.y;
  ev.nx = nx;
  ev.ny = ny;
  ev.tx = -ny;
  ev.ty = nx;
  ev.approachSpeed = info.approach;
  ev.impactSpeed = info.relSpeed;
  ev.slideSpeed = info.slide;
  ev.contactVelX = A.vel.x - wA * rAy;
  ev.contactVelY = -(A.vel.y + wA * rAx);
  ev.massA = massA;
  ev.massB = massB;
  ev.reducedMass = reduced;
  ev.energy = 0.5 * reduced * info.approach * info.approach;
  ev.contactsCount = info.count;
  ev.hullPair = true;
  ev.isRingCollision = false;
  ev.brittle = false;
  ev.simTime = HullBodies.simTime;
}

// Punkty szwu dla iskier: do K par kontaktu równym krokiem, każda z własną normalną.
function fillSeamPoints(A, B, count) {
  const target = Math.max(0, C.seamSparkPoints | 0);
  if (target <= 0 || count <= 0) return 0;
  let seam = HullBodies._seam;
  if (seam.length < target * 4) seam = HullBodies._seam = new Float32Array(target * 4);
  const ma = D._refreshRot(A), mb = D._refreshRot(B);
  const sa = A.nodeStore, sb = B.nodeStore, ca = A._contacts, cb = B._contacts;
  const stride = Math.max(1, Math.ceil(count / target));
  let n = 0;
  for (let c = 0; c < count && n < target; c += stride) {
    const ia = ca[c], ib = cb[c];
    const ax = A.pos.x + ma[0] * sa.x[ia] + ma[1] * sa.y[ia];
    const ay = A.pos.y + ma[3] * sa.x[ia] + ma[4] * sa.y[ia];
    const bx = B.pos.x + mb[0] * sb.x[ib] + mb[1] * sb.y[ib];
    const by = B.pos.y + mb[3] * sb.x[ib] + mb[4] * sb.y[ib];
    let nx = ax - bx, ny = ay - by;
    const len = Math.sqrt(nx * nx + ny * ny);
    if (len > 1e-6) { nx /= len; ny /= len; } else { nx = 0; ny = 0; }
    const o = n * 4;
    seam[o] = (ax + bx) * 0.5;
    seam[o + 1] = -(ay + by) * 0.5;
    seam[o + 2] = nx;
    seam[o + 3] = -ny;
    n++;
  }
  return n;
}

function onContact(A, B, info) {
  if (!info.doDamage) return;
  const ea = A.entity, eb = B.entity;
  if (!ea || !eb) return;
  HullBodies.perf.contacts += info.count;
  const pair = pairRecord(ea, eb);
  if (pair.fresh) {
    pair.yieldPressure = 0;
    // Wektor unikania AI przestaje obowiązywać przy pierwszym dotyku metalu.
    ea.__sepDecisionTick = -1;
    eb.__sepDecisionTick = -1;
  }
  // Szybki styk budzi odpoczywający wrak (licznik snu od nowa).
  if (info.relSpeed >= C.wreckWakeRelSpeed) {
    if (ea.isWreck) { ea._wreckSleepTimer = 0; ea._lastImpactMs = HullBodies.simTime * 1000; }
    if (eb.isWreck) { eb._wreckSleepTimer = 0; eb._lastImpactMs = HullBodies.simTime * 1000; }
  }

  fillCollisionEvent(grindEvent, A, B, ea, eb, info);
  grindEvent.bounceForce = Math.abs(info.impulse);
  grindEvent.pointCount = fillSeamPoints(A, B, info.count);
  grindEvent.points = HullBodies._seam;
  CollisionFX.onGrind(grindEvent);

  const now = HullBodies.simTime;
  if (pair.fresh && info.approach >= C.impactMinSpeed && now - pair.lastImpactTime >= C.impactCooldown) {
    pair.lastImpactTime = now;
    fillCollisionEvent(impactEvent, A, B, ea, eb, info);
    CollisionFX.onImpact(impactEvent);
  }
}

// Ginący węzeł = odłamek jak w demie belek (hullDebris3D.js): pogięta płyta poszycia albo
// kształtownik (węzeł z wręgiem/grodzią), kolor blachy komórki, rozmiar ~ bok komórki.
function onNodeDebris(body, i, wx, wy, wz, vx, vy) {
  const hull = body.hull;
  if (!hull || typeof window === 'undefined' || typeof window.spawnHullDebris !== 'function') return;
  const s = body.nodeStore;
  // Rozmiar jak odłamki dema: ~0,9–1,8 komórki (siatka gry = siatka dema, 15 j.).
  const scale = body.cellSize * (0.9 + Math.random() * 0.9);
  const structural = s.beamCount[i] > s.localBeamCount[i] && Math.random() < 0.4;
  window.spawnHullDebris(wx, -wy, vx, -vy, s.r[i], s.g[i], s.b[i], scale, structural);
}

// Masa gry na jednostkę masy zderzeń rodzica. Rozpad dzieje się w kroku silnika, przed syncOut,
// więc masa encji rodzica wciąż odpowiada `_massRef` (masie jego ciała sprzed kroku).
function gameMassScale(parent, parentHull) {
  const mass = Number(parent?.mass);
  if (mass > 0 && parentHull._massRef > 0) return mass / parentHull._massRef;
  return parentHull.massScale > 0 ? parentHull.massScale : 1;
}

function makeWreckEntity(parent, body, parentHull) {
  const scale = parentHull.scale;
  const rot = hullSpriteRotation(parent);
  const theta = 2 * Math.atan2(body.quat.z, body.quat.w);
  const angle = -theta - rot;
  const massScale = gameMassScale(parent, parentHull);
  const wreck = {
    x: body.pos.x,
    y: -body.pos.y,
    vx: body.vel.x,
    vy: -body.vel.y,
    angle,
    angVel: -body.angVel.z,
    radius: body.radius,
    _bpRadius: body.radius,
    mass: Math.max(10, body.mass * massScale),   // masa gry (holowanie), nie masa zderzeń
    friction: C.wreckFriction,
    dead: false,
    isWreck: true,
    isAsteroidHex: false,
    noWreckSleep: false,
    destructionMaterial: parent.destructionMaterial,
    isCollidable: true,
    _inPool: false,
    isCold: false,
    _coldSnapshot: null,
    _coldUnsupported: false,
    _wreckAge: 0,
    _wreckSleepTimer: 0,
    _wreckSleeping: false,
    _wreckSleptSec: 0,
    _lastImpactMs: HullBodies.simTime * 1000,
    _cargoOrderId: null,
    _cargoWreckId: null,
    _cargoManifest: null,
    owner: parent.owner || parent,
    shipFrame: parent.shipFrame,
    displayName: parent.displayName,
    visual: {
      spriteScale: scale,
      spriteScaleX: scale,
      spriteScaleY: scale,
      preserveBillboardLighting: parent.visual?.preserveBillboardLighting === true,
      preserveBillboardOrientation: parent.visual?.preserveBillboardOrientation === true,
      spriteRotation: rot
    },
    beamHull: null
  };
  const hull = {
    entity: wreck,
    body,
    image: parentHull.image,
    visualImage: parentHull.visualImage,
    normalMapImage: parentHull.normalMapImage,
    srcWidth: parentHull.srcWidth,
    srcHeight: parentHull.srcHeight,
    scale,
    cellSize: parentHull.cellSize,
    pixelPitch: parentHull.pixelPitch,
    nx: parentHull.nx,
    ny: parentHull.ny,
    pivot: { x: 0, y: 0 },
    anchorMode: 'com',
    anchorDX: parentHull.anchorDX,
    anchorDY: parentHull.anchorDY,
    baseNodes: body.activeNodes,
    hexPerNode: parentHull.hexPerNode,
    massScale,
    isFragment: true,
    radius: body.radius,
    revision: 0,
    shieldCells: null,
    _massRef: body.mass,
    _inPx: 0, _inPy: 0, _inVx: 0, _inVy: 0, _inW: 0, _inNodes: body.activeNodes
  };
  updateComPivot(hull);
  body.entity = wreck;
  body.hull = hull;
  body.isWreck = true;
  wreck.beamHull = hull;
  return wreck;
}

// Łup, ładunek i listy gry — wspólne dla rozpadu i śmierci.
function finishWreck(wreck, parent, nodes, parentBody) {
  if (parent) {
    transferSalvageToWreck(parent, wreck, (key) => bodyHasCell(wreck.beamHull.body, key), nodes);
    // Rekord cargo wybiera dokładnie jeden fizyczny wrak jako właściciela partii.
    if (parent.dead && parent._cargoOrderId && !parent._cargoWreck) {
      wreck._cargoOrderId = parent._cargoOrderId;
      wreck._cargoWreckId = `cargo-wreck:${parent._cargoOrderId}`;
      parent._cargoWreck = wreck;
    }
  }
  if (typeof window !== 'undefined' && Array.isArray(window.wrecks) && !window.wrecks.includes(wreck)) {
    window.wrecks.push(wreck);
  }
  if (typeof HullBodies.onWreckSpawned === 'function') HullBodies.onWreckSpawned(wreck, parent, parentBody);
}

function onWreck(parentBody, wreckBody) {
  const parentHull = parentBody.hull;
  const parent = parentBody.entity;
  if (!parentHull) return;
  const wreck = makeWreckEntity(parent || { visual: null }, wreckBody, parentHull);
  // Nowy wrak nie był w syncIn tego kroku — jego stan to od razu stan silnika.
  wreck.beamHull._inNodes = wreckBody.activeNodes;
  finishWreck(wreck, parent, wreckBody.activeNodes, parentBody);
}

function nowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
}

if (typeof window !== 'undefined') window.HullBodies = HullBodies;
