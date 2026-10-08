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

import { DestructorBeams3D as D, createBeamConfig, pinBeamNodes, BEAM_TYPE } from './destructorBeams3D.js';
import { getHullCollisionArmor } from '../data/hullArmor.js';
import { buildSpriteBeamStructure } from './beamSprite2D.js';
import { computeStoreInertia } from './beamBody3D.js';
import { defineLazyViews, BeamNodeStore, BeamLinkStore, BeamNodeView, buildAdjacency, cachedNodeViews,
  NODE_STORE_FIELDS, BEAM_STORE_FIELDS } from './beamStore3D.js';
import { activeRegion, markSkinDirty, resetActiveRegion } from './beamActiveRegion3D.js';
import { beamSolverScratch } from './beamConstraintSolver3D.js';
import { areTowBodiesCollisionDisabled } from './towSystem.js';
import { transferSalvageToWreck, clearSalvage } from './salvage.js';
import { CollisionFX, impactEvent, grindEvent } from '../vfx/collisionFx.js';
// Losowość warstwy efektów (zadanie 23): wizualia nie zużywają Math.random gry — przebieg rozgrywki nie zależy od obrazu.
import { fxRandom } from '../3d/fx/fxRandom.js';

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

  // --- rzaz z pędem (cutSegment z opts.push — Hexlance, 2026-09-29) ---
  // Pocisk przecinający kadłub oddaje pęd: wycięty metal (odłamki) leci WZDŁUŻ toru, a kadłub dostaje
  // impuls w środku masy rzazu = masa wyciętych węzłów × cutPushSpeed wzdłuż toru (ruch i obrót encji —
  // odcięte części dziedziczą go przy rozpadzie, zamiast wisieć w miejscu).
  cutPushSpeed: 260,        // [j/s]
  cutPushMaxDv: 220,        // [j/s] sufit zmiany prędkości kadłuba na jeden rzaz
  cutPushMaxDw: 1.2,        // [rad/s] sufit zmiany prędkości obrotu na jeden rzaz
  cutDebrisSpeed: 520,      // [j/s] odłamki rzazu: wzdłuż toru × (0,5–1,3), na boki od linii cięcia 0,15–0,5
  // Brzeg rzazu: odłam, który odpadnie po rzazie (rozpad w silniku do cutEdgeWindow s później), dostaje
  // pęd od węzłów przy linii cięcia — cutEdgeSpeed wzdłuż toru (i cutEdgeSpread od linii) na węzeł przy
  // brzegu pasa, liniowo do zera cutEdgeCells komórek dalej, jako impuls na masę odłamu (z obrotem):
  // mały odprysk przy rzazie leci szybko, duża połowa kadłuba — powoli.
  cutEdgeSpeed: 240,        // [j/s]
  cutEdgeSpread: 0.35,
  cutEdgeCells: 2.5,
  cutEdgeWindow: 0.5,       // [s] czasu symulacji
  probeReachCells: 0.8,     // sonda punktowa (podparcie gniazd broni i rdzeni)

  // --- zapytania powierzchni (tylko odczyt: surfaceNormal, traceThrough, spriteUvAt) ---
  // Marsz przez materiał: punkt jest „w środku”, gdy żywy węzeł leży bliżej niż ten promień.
  // Koła 0,55 z trafień zostawiają w pełnej płycie dziurki przy narożnikach komórek
  // (narożnik jest 0,707 komórki od czterech węzłów) — sonda punktowa musi je przykryć.
  traceReachCells: 0.72,
  traceRefineSteps: 4,      // połowienia przejścia materiał ↔ próżnia (krok marszu / 16)
  normalProbeCells: 2,      // węzeł normalnej: najbliższy żywy w tym promieniu od punktu trafienia
  normalWindowCells: 2.5,   // okno gradientu zajętości: koło o tym promieniu w komórkach siatki
  uvProbeCells: 1.5,        // węzeł uv, gdy wołający go nie podał

  // --- zdarzenia zderzeń (CollisionFX, jak DESTRUCTOR_CONFIG) ---
  contactHoldSec: 0.1,      // okno „para w styku” dla AI (hasContact)
  impactMinSpeed: 40,
  impactCooldown: 1.5,
  seamSparkPoints: 6,

  // --- wraki ---
  wreckFriction: 0.9986,
  wreckFullCollisionTime: 2.5,
  wreckWakeRelSpeed: 70,
  wreckColdAngVel: 0.06,
  // Para wrak × wrak RZADZIEJ (flaga, 1 = wył.; audyt 2026-10-07 § 5.5): oba wraki starsze niż
  // wreckFullCollisionTime i wolne względem siebie (prędkość środków + |ω|·promień obu < wreckPairSpeed)
  // zderzają się co wreckPairEvery kroków z krokiem × wreckPairEvery (silnik: pairFilter → liczba).
  // Zmienia fizykę wraków (przenikanie między krokami ≈ prędkość · (k − 1) · dt). Pomiar 2026-10-07
  // (faza wraków, 48 okrętów → ~70 wraków, 3 ziarna): po tańszym skanie par zysk k = 2 / 4 to setne
  // części ms na krok, a mediana penetracji styków wraków rośnie 0,2 → 0,3 j. — dlatego wyłączona.
  wreckPairEvery: 1,
  wreckPairSpeed: 120,

  // --- odrost (regrowCandidates / regrowCell / restoreHull) ---
  // Nowy węzeł staje w spoczynku swojej komórki przesuniętym o średnie przemieszczenie żywych sąsiadów, belki szablonu
  // do żywych węzłów w długości spoczynkowej. Każda musi wejść w zakres sprężysty: |długość − spoczynkowa| ≤
  // regrowStrain · deform · spoczynkowa — przy wgnieceniu solver szarpnąłby nowym węzłem, zerwał belki i węzeł znów
  // by zginął (odłamki, front odrostu w kółko). Wgniecione otoczenie najpierw prostuje naprawa (R).
  regrowStrain: 0.5,
  // Początek układu ciała wraca do środka masy (przesunięcie magazynu = skóra całego kadłuba od nowa), gdy odrost
  // odsunął środek masy dalej niż tyle komórek; drobny odrost poprawia tylko masę i bezwładność.
  regrowRecenterCells: 0.25
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
const _impactOpts = { radius: 0, hpBudget: 0, damageFraction: 1, killRadius: 0 };
const _nodeWorld = { x: 0, y: 0 };
// Zapytania powierzchni mają własne scratche: syncBodyPose pisze do _pose i _local.
const _qPose = { x: 0, y: 0, theta: 0, c: 1, s: 0 };
const _qLocal = { x: 0, y: 0 };
const _qEnd = { x: 0, y: 0 };
// Odrost: pozycja nowego węzła (układ ciała) i lista węzłów do odświeżenia mocowań.
const _regrowPos = { x: 0, y: 0, z: 0 };
const _regrowTouched = [];

// Klucz mapy ran (18-C): kolejny numer kadłuba, dziedziczony przez wraki i odłamy.
let _nextDmgKey = 0;

/** Wynik sweep() — współdzielony, ważny do następnego wywołania. */
export const hullSweepResult = { t: 0, worldX: 0, worldY: 0, projectileX: 0, projectileY: 0, node: -1, hitShard: null };

/**
 * Wynik impact() / cutSegment() — współdzielony, ważny do następnego wywołania.
 * kind: 'impact' | 'cut'; hit — jak zwrot funkcji (cut: zniszczono coś); killed — ubytek
 * żywych węzłów ciała w tym wywołaniu (krater + utrata oparcia; rozpad liczy się dopiero
 * w kroku); radius — promień krateru / półszerokość rzazu [j.]; node — węzeł, od którego
 * zaczyna krater (najbliższy punktowi) albo węzeł wejścia rzazu — indeks ważny do rozpadu
 * w następnym kroku; u, v — uv sprite'a tego punktu (konwencja skóry, liczone PRZED
 * kraterem); x, y — punkt (świat gry; cut: wejście); dmgKey — klucz mapy ran kadłuba;
 * dirX, dirY — kierunek jednostkowy (impact: wektor `vel`, cut: odcinek; 0, 0 = brak), len — cut:
 * droga od wejścia do końca odcinka (stemple rzazu mapy ran, 18-C), impact: 0; crater — impact:
 * zasięg prawdziwej dziury = najdalszy węzeł zabity przez krater od punktu [j.] (0 = krater nikogo
 * nie zabił; utrata oparcia się nie liczy) — w tym promieniu mapa ran maluje lej (zadanie 25c), cut: 0.
 */
export const hullImpactResult = {
  kind: '', hit: false, killed: 0, radius: 0, node: -1, u: 0, v: 0, x: 0, y: 0, dmgKey: 0, dirX: 0, dirY: 0, len: 0,
  crater: 0
};

/** Wynik surfaceNormal() — normalna na zewnątrz (świat gry) i węzeł, przy którym ją liczono. */
export const hullNormalResult = { nx: 0, ny: 0, node: -1 };

/** Wynik traceThrough() — pierwszy ciągły odcinek materiału na odcinku zapytania. */
export const hullTraceResult = { solidLen: 0, entryT: -1, exitT: -1, node: -1 };

/** Wynik spriteUvAt() — uv sprite'a w konwencji skóry (v = 0 to górny wiersz obrazu). */
export const hullUvResult = { u: 0, v: 0, ok: false, node: -1 };

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
  // (entity, hullImpactResult) — po impact() / cutSegment(), które coś trafiły (mapa ran,
  // wybuchy rakiet). Domyślnie brak: gra zachowuje się jak dawniej.
  onImpact: null,
  // (entity, dt, changed) — po naprawie kadłuba w repair() (mapa ran: wygaszanie osmalenia
  // i przestrzelin; changed = false — naprawa zakończona; też po pełnym remoncie restoreHull). Domyślnie brak.
  onRepair: null,
  // (entity, ratioBefore, ratioAfter) — po odroście węzłów (regrowCell, restoreHull): udział żywych węzłów kadłuba
  // przed i po (jak structuralState). Gra: punkty kadłuba rosną z sufitem konstrukcji
  // (hullIntegrity.raiseHullHpForRegrowth). Domyślnie brak.
  onRegrow: null,
  // (entity, hull, u, v, x, y) — węzeł zniszczony POZA trafieniem broni (zderzenie i zgniot, oparcie po
  // zerwanych belkach, odpryski rozpadu, cięcie wraku, wybuch reaktora): uv jego komórki w konwencji
  // skóry i punkt świata gry. Trafienia (impact, cutSegment) mają własny hak onImpact. Mapa ran: rozdarcie
  // (poszarpany, osmalony brzeg dziury). Domyślnie brak.
  onNodeLost: null,
  // (islandEntity, parentEntity) — wyspa ciała ŚWIATA, która przy rozpadzie dalej trzyma się kotwicy: osobna encja
  // budowli (isWorldPiece, stoi), nie wrak. Gra (worldBodies.js) dopisuje ją do swojego kawałka. Domyślnie brak.
  onWorldIsland: null,
  // > 0 w trakcie impact() / cutSegment(): zniszczone węzły należą do krateru / rzazu (onImpact).
  _weaponDepth: 0,

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

  /**
   * Konstrukcja z obrazu (jedna na obraz × rozmiar × skalę — flota jednego typu dzieli budowę).
   * `cellPx` — bok komórki w pikselach obrazu (domyślnie siatka kadłubów; raster budowli świata ma
   * kilka j. na piksel, więc komórka 15 j. to parę pikseli).
   */
  structureFor(image, scale = 1, cellPx = C.cellPx) {
    const W = Math.max(1, Math.round(Number(image?.width) || Number(image?.naturalWidth) || 0));
    const H = Math.max(1, Math.round(Number(image?.height) || Number(image?.naturalHeight) || 0));
    const px = Number(cellPx) > 0 ? Number(cellPx) : C.cellPx;
    const key = `${W}x${H}|${scale}|${px}`;
    let byKey = this._structures.get(image);
    const cached = byKey?.get(key);
    if (cached) return cached;
    const rgba = readImageRGBA(image);
    if (!rgba) return null;
    const cellsAlong = Math.max(4, Math.round(W / px));
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
   * Ciała ŚWIATA (budowle — src/game/worldBodies.js, docs/PLAN-zniszczenia-swiata-3d.md F1/F2): raster z góry
   * zamiast sprite'a i opcje: `cellPx` (bok komórki w pikselach rastra), `anchored` + `pins(x, y)` — kotwice
   * (węzły z invMass 0; test w układzie sprite'a od jego środka: x — w prawo obrazu, y — w GÓRĘ obrazu,
   * j. świata), `massPerArea`, `collisionArmor`, `hexPerNode` (HP węzła), `world` (rekord kawałka — idzie
   * za odłamami: HullBodies.onWorldIsland).
   */
  createHull(entity, image, opts = {}) {
    if (!entity || !image) return null;
    this.init();
    const scale = entitySpriteScale(entity);
    let structure = null;
    try {
      structure = this.structureFor(image, scale, opts.cellPx);
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[HullBodies] budowa kadłuba nie powiodła się:', err);
      return null;
    }
    if (!structure) return null;
    // Masa zderzeń z powierzchni (jedna gęstość dla wszystkich kadłubów); masa gry encji bez zmian,
    // a bez niej (transportowce) — masa zderzeń.
    const density = Number(opts.massPerArea) > 0 ? Number(opts.massPerArea) : C.massPerArea;
    const collisionMass = density * structure.area;
    const armor = Number(opts.collisionArmor) > 0 ? Number(opts.collisionArmor)
      : getHullCollisionArmor(opts.hullProfileId || entity.shipFrame || entity.activeHullId || entity.model3DProfileId || entity.type);
    const massMul = collisionMass / structure.mass;
    const body = D.createBody(cloneStructure(structure), {
      name: String(entity.name || entity.type || 'kadłub'),
      collisionArmor: armor,
      massMultiplier: massMul,
      anchored: !!opts.anchored
    });
    // Żywy kadłub statku trzyma magazyn w układzie konstrukcji (bez zagęszczania po rozpadzie — fizyka ta sama):
    // odrost (regrowCell, restoreHull) ożywia wpisy w miejscu, z ich masą i pancerzem (mostek, komora reaktora).
    // Wrak (convertToWreck) i budowla zagęszczają się jak dawniej.
    body.keepLayout = !opts.world && !opts.anchored;
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
      // dawne heksy na węzeł (krater, łup, tempo cięcia); ciało świata — z opcji (raster ma inny piksel)
      hexPerNode: Number(opts.hexPerNode) > 0 ? Number(opts.hexPerNode) : structure.hexPerNode,
      massScale: mass / body.mass,       // masa gry na jednostkę masy zderzeń (przy budowie)
      massMul,                           // masa zderzeń węzła / masa węzła konstrukcji (odrost z szablonu)
      isFragment: false,
      world: opts.world || null,         // ciało świata: rekord kawałka (worldBodies.js), dziedziczą go odłamy
      cellPx: Number(opts.cellPx) > 0 ? Number(opts.cellPx) : C.cellPx,  // bok komórki w pikselach obrazu (klucz konstrukcji)
      pins: 0,
      // Klucz mapy ran: nowy kadłub = nowy numer; wrak i odłamy dziedziczą go (makeWreckEntity),
      // więc rany rodu leżą w jednej warstwie w uv rodzica.
      dmgKey: ++_nextDmgKey,
      radius: 0,
      revision: 0,
      shieldCells: null,
      _shieldCellsOf: null,              // magazyn, z którego policzono shieldCells
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
    // HP węzła z opcji (ciało świata: piksel rastra ≠ piksel sprite'a, więc heksy na węzeł z obrazu nie pasują).
    if (Number(opts.hexPerNode) > 0 && structure.hexPerNode > 0 && opts.hexPerNode !== structure.hexPerNode) {
      const k = opts.hexPerNode / structure.hexPerNode, s = body.nodeStore;
      for (let i = 0; i < s.count; i++) { s.hp[i] *= k; s.maxHp[i] *= k; }
    }
    // Kotwice ciała świata: test w układzie sprite'a (od środka obrazu; x w prawo, y w górę obrazu).
    if (opts.anchored && typeof opts.pins === 'function') {
      const ax = body.latticeMin.x + hull.anchorDX, ay = body.latticeMin.y + hull.anchorDY;
      hull.pins = pinBeamNodes(body, (ox, oy) => !!opts.pins(ox - ax, oy - ay));
    }
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
      const changed = repairBody(hull.body, dt);
      if (changed) any = true;
      if (typeof this.onRepair === 'function') this.onRepair(e, dt, changed);
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
   * opts.craterRadius — krater NA MIARĘ RANY (zadanie 25c, ciężka broń: promień leja z
   * hullDamageStamps.craterRadiusFor): wszystkie węzły bliżej niż ten promień giną — z wgnieceniem,
   * odrzutem wybitej blachy, zerwaniem belek i rozpadem silnika (D.applyImpact, killRadius), bez
   * budżetu HP; wgniecenie sięga komórkę dalej (brzeg dziury).
   * Zwraca, czy trafienie objęło jakikolwiek węzeł. Szczegóły (węzeł, uv, zabite węzły, zasięg
   * dziury, klucz mapy ran) w `hullImpactResult`.
   */
  impact(entity, x, y, damage, vel = null, opts = null) {
    const r = resetImpactResult('impact', x, y);
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity || hull.body.dead) return false;
    r.dmgKey = hull.dmgKey;
    const dmg = Math.max(0, Number(damage) || 0);
    if (dmg <= 0) return (r.hit = this.probe(entity, x, y));
    const body = hull.body;
    syncBodyPose(hull);
    // Promień w heksach (strojenie heksowe), odstęp heksa w j. świata = komórka / √(heksy na węzeł).
    const hexPitch = body.cellSize / Math.sqrt(hull.hexPerNode || 1);
    const hexes = Math.max(C.craterMinCells, Math.min(C.craterMaxCells, C.craterMinCells + Math.sqrt(dmg / C.craterRefDamage)));
    const baseRadius = Number(opts?.radius) > 0 ? Number(opts.radius) : hexes * hexPitch;
    const craterR = Number(opts?.craterRadius) > 0 ? Number(opts.craterRadius) : 0;
    _impactOpts.radius = craterR > 0 ? Math.max(baseRadius, craterR + body.cellSize) : baseRadius;
    _impactOpts.hpBudget = craterR > 0 ? 0 : dmg * C.craterHpPerDamage;
    _impactOpts.killRadius = craterR;
    _impactOpts.damageFraction = 1;
    _impactVel.x = Number(vel?.x) || 0;
    _impactVel.y = -(Number(vel?.y) || 0);
    _impactVel.z = 0;
    writeImpactDir(r, _impactVel.x, -_impactVel.y, 0);
    // Węzeł i uv PRZED kraterem: krater zaczyna od najbliższego żywego węzła w swoim promieniu
    // (silnik bierze promień nie mniejszy niż komórka konfiguracji), ten sam trafi do stempla.
    r.radius = Math.max(Number(D.config?.cellSize) || 0, _impactOpts.radius);
    toLocal(hull, entityPose(hull, _qPose), x, y, _qLocal);
    r.node = D.probeLocal2D(body, _qLocal.x, _qLocal.y, r.radius);
    writeSpriteUv(hull, r.node, _qLocal.x, _qLocal.y, r);
    const before = body.activeNodes;
    let hit;
    this._weaponDepth++;
    try {
      hit = D.applyImpact(body, x, -y, 0, dmg, _impactVel, _impactOpts);
    } finally {
      this._weaponDepth--;
    }
    r.hit = hit;
    r.killed = before - body.activeNodes;
    r.crater = hit ? D.lastCraterReach : 0;
    if (hit && entity.isWreck) {
      entity._wreckSleeping = false;
      entity._wreckSleepTimer = 0;
      entity._lastImpactMs = this.simTime * 1000;
    }
    if (hit && typeof this.onImpact === 'function') this.onImpact(entity, r);
    return hit;
  },

  /**
   * Rzaz (Hexlance): niszczy żywe węzły w pasie o półszerokości `halfWidth` wokół odcinka
   * (świat gry). Zwraca liczbę zniszczonych węzłów; pierwszy punkt wejścia w `hullSweepResult`,
   * węzeł i uv wejścia w `hullImpactResult` (kind 'cut'). `opts.push` — rzaz pocisku z pędem
   * (odcinek = tor): odłamki lecą wzdłuż toru, kadłub dostaje impuls (applyCutPush); bez niego
   * węzły giną w miejscu jak dawniej.
   */
  cutSegment(entity, x0, y0, x1, y1, halfWidth, opts = null) {
    const r = resetImpactResult('cut', x0, y0);
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity || hull.body.dead) return 0;
    r.dmgKey = hull.dmgKey;
    r.radius = halfWidth;
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
    r.x = hullSweepResult.worldX;
    r.y = hullSweepResult.worldY;
    r.node = _sweepOut.node;
    writeSpriteUv(hull, r.node, lx0 + (lx1 - lx0) * t, ly0 + (ly1 - ly0) * t, r);
    writeImpactDir(r, x1 - x0, y1 - y0, 1 - t);
    const before = body.activeNodes;
    const push = !!opts?.push;
    let killed;
    this._weaponDepth++;
    try {
      killed = cutLocalBand(body, lx0, ly0, lx1, ly1, halfWidth, push);
    } finally {
      this._weaponDepth--;
    }
    if (push && killed > 0 && !body.dead) {
      applyCutPush(hull, lx0, ly0, lx1, ly1);
      rememberPushCut(hull, lx0, ly0, lx1, ly1, halfWidth);
    }
    r.hit = killed > 0;
    r.killed = before - body.activeNodes;
    if (killed > 0 && typeof this.onImpact === 'function') this.onImpact(entity, r);
    return killed;
  },

  /**
   * Normalna powierzchni na zewnątrz w punkcie trafienia (świat gry, y w dół): gradient
   * zajętości żywych węzłów w kole `normalWindowCells` komórek siatki wokół najbliższego
   * węzła. Tylko odczyt, bez losowania — wołać PRZED impact() (krater zabija węzły).
   * Normalna nie patrzy w stronę lotu (dir): trafienie „od tyłu” cienkiej krawędzi daje
   * styczną. Brak węzła albo zerowy gradient (pręt 1 komórki) → −kierunek (dirX, dirY),
   * a bez kierunku — promieniście od kotwicy encji. Wynik w `out` (domyślnie hullNormalResult).
   */
  surfaceNormal(entity, x, y, dirX = 0, dirY = 0, out = hullNormalResult) {
    out.node = -1;
    const dl = Math.sqrt(dirX * dirX + dirY * dirY);
    const ux = dl > 1e-12 ? dirX / dl : 0, uy = dl > 1e-12 ? dirY / dl : 0;
    const hull = entity?.beamHull;
    let found = false;
    if (hull && hull.entity === entity && !hull.body.dead) {
      const body = hull.body, s = body.nodeStore, cs = body.cellSize;
      const pose = entityPose(hull, _qPose);
      toLocal(hull, pose, x, y, _qLocal);
      const i = D.probeLocal2D(body, _qLocal.x, _qLocal.y, C.normalProbeCells * cs);
      if (i >= 0) {
        out.node = i;
        const cells = D._latticeIndex(body).cells, active = s.active, d = body.dims;
        const ix = s.ix[i], iy = s.iy[i];
        const R = C.normalWindowCells, R2 = R * R, w = Math.floor(R);
        let gx = 0, gy = 0;
        for (let dy = -w; dy <= w; dy++) {
          const cy = iy + dy;
          for (let dx = -w; dx <= w; dx++) {
            if ((dx === 0 && dy === 0) || dx * dx + dy * dy > R2) continue;
            const cx = ix + dx;
            if (cx < 0 || cy < 0 || cx >= d.x || cy >= d.y) continue;       // poza siatką = próżnia
            const j = cells[cx + cy * d.x];
            if (j >= 0 && active[j]) { gx -= dx; gy -= dy; }                  // od materiału na zewnątrz
          }
        }
        const gl = Math.sqrt(gx * gx + gy * gy);
        if (gl > 1e-9) {
          const lx = gx / gl, ly = gy / gl;
          let nx = pose.c * lx - pose.s * ly;              // układ ciała → świat gry (y w dół)
          let ny = -(pose.s * lx + pose.c * ly);
          const along = nx * ux + ny * uy;
          if (along > 0) {                                 // normalna z kierunkiem lotu: styczna
            nx -= along * ux; ny -= along * uy;
            const tl = Math.sqrt(nx * nx + ny * ny);
            if (tl > 1e-6) { nx /= tl; ny /= tl; found = true; }
          } else found = true;
          if (found) { out.nx = nx; out.ny = ny; }
        }
      }
    }
    if (found) return out;
    if (dl > 1e-12) { out.nx = -ux; out.ny = -uy; return out; }
    const rx = entity ? x - entityPosX(entity) : 0, ry = entity ? y - entityPosY(entity) : 0;
    const rl = Math.sqrt(rx * rx + ry * ry);
    out.nx = rl > 1e-9 ? rx / rl : 1;
    out.ny = rl > 1e-9 ? ry / rl : 0;
    return out;
  },

  /**
   * Przejście przez materiał wzdłuż odcinka (świat gry): marsz co pół komórki sondą
   * żywych węzłów (promień `traceReachCells` · komórka + radius), przejścia doprecyzowane
   * połowieniem. Liczy PIERWSZY ciągły odcinek materiału: entryT — początek (0, gdy
   * odcinek zaczyna się w środku; −1 — brak materiału), exitT — wyjście (−1 = materiał
   * trwa do końca odcinka), solidLen — jego długość [j.], node — ostatni węzeł w materiale.
   * Tylko odczyt. Zwraca `out` (domyślnie hullTraceResult) albo null bez kadłuba.
   */
  traceThrough(entity, x0, y0, x1, y1, radius = 0, out = hullTraceResult) {
    out.solidLen = 0;
    out.entryT = -1;
    out.exitT = -1;
    out.node = -1;
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity || hull.body.dead) return null;
    const body = hull.body, cs = body.cellSize;
    const pose = entityPose(hull, _qPose);
    toLocal(hull, pose, x0, y0, _qLocal);
    toLocal(hull, pose, x1, y1, _qEnd);
    const ax = _qLocal.x, ay = _qLocal.y, dx = _qEnd.x - ax, dy = _qEnd.y - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    const reach = C.traceReachCells * cs + Math.max(0, Number(radius) || 0);
    const n = Math.max(1, Math.ceil(len / (cs * 0.5)));
    let prevT = 0;
    let prevNode = D.probeLocal2D(body, ax, ay, reach);
    if (prevNode >= 0) { out.entryT = 0; out.node = prevNode; }
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const node = D.probeLocal2D(body, ax + dx * t, ay + dy * t, reach);
      const inside = node >= 0;
      if (inside !== (prevNode >= 0)) {
        // Połowienie przejścia między próbkami (lo = strona prevNode, hi = strona node).
        let lo = prevT, hi = t;
        for (let r = 0; r < C.traceRefineSteps; r++) {
          const m = (lo + hi) * 0.5;
          const mn = D.probeLocal2D(body, ax + dx * m, ay + dy * m, reach);
          if ((mn >= 0) === inside) hi = m;
          else { lo = m; if (mn >= 0) out.node = mn; }
        }
        if (inside) {
          if (out.entryT < 0) out.entryT = hi;
        } else if (out.entryT >= 0) {
          out.exitT = lo;
          out.solidLen = (lo - out.entryT) * len;
          return out;
        }
      }
      if (inside) out.node = node;
      prevNode = node;
      prevT = t;
    }
    if (out.entryT >= 0) out.solidLen = (1 - out.entryT) * len;
    return out;
  },

  /**
   * UV sprite'a punktu (świat gry) w konwencji skóry kadłuba (beamHullSkin: v = 0 to górny
   * wiersz obrazu): cx = ix + 0,5 + (l − x_węzła)/cs, u = cx · pitch / W, v = (ny − cy) · pitch / H.
   * Przesunięcie liczone względem węzła (podanego `nodeHint` albo najbliższego w
   * `uvProbeCells`), więc uv jedzie z wgnieceniem jak skóra. Wraki i odłamy leżą w uv
   * rodzica (węzły zachowują ix/iy). ok = false: brak węzła w pobliżu (uv ze spoczynku).
   */
  spriteUvAt(entity, x, y, nodeHint = -1, out = hullUvResult) {
    out.u = 0;
    out.v = 0;
    out.ok = false;
    out.node = -1;
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity) return out;
    const body = hull.body, s = body.nodeStore;
    toLocal(hull, entityPose(hull, _qPose), x, y, _qLocal);
    let i = Number.isInteger(nodeHint) && nodeHint >= 0 && nodeHint < s.count ? nodeHint : -1;
    if (i < 0 && !body.dead) i = D.probeLocal2D(body, _qLocal.x, _qLocal.y, C.uvProbeCells * body.cellSize);
    writeSpriteUv(hull, i, _qLocal.x, _qLocal.y, out);
    out.ok = i >= 0;
    out.node = i;
    return out;
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
   * które dostają pchnięcie od wybuchu. Zwraca { fragments, debris, wreck } jak dawny rozpad heksów.
   * opts (opcjonalnie; bez nich zachowanie jak dawniej) — rozpad budowli (worldBodies.breakPiece): debrisFrac
   * (udział węzłów rdzenia w odłamki), debrisMax (sufit liczby odłamków rdzenia), debrisSpeed [min, max] j/s,
   * cuts (rzazy promieniste), chords (dodatkowe rzazy przez ciało w losowych miejscach), cutWidth (półszerokość
   * rzazu w komórkach), cells (pęknięcia Voronoi: tyle komórek z ziaren w żywych węzłach — belki między komórkami
   * pękają, odłamy podobnej wielkości z poszarpanym brzegiem), crackDebris (udział węzłów na szwach Voronoi, które
   * sypią się w odłamki), minFragmentNodes (odłam mniejszy — cały w odłamki), kick(wrak, x, y) — pchnięcie odłamów
   * zamiast pchnięcia od wybuchu.
   */
  shatter(entity, worldX, worldY, severity = 0, opts = null) {
    const wreck = this.convertToWreck(entity);
    if (!wreck) return { fragments: 0, debris: 0, wreck: null };
    const hull = wreck.beamHull, body = hull.body, s = body.nodeStore, cs = body.cellSize;
    const sev = Math.max(0, Math.min(1.4, Number(severity) || 0));
    const nodes = body.activeNodes;
    syncBodyPose(hull);
    const pose = entityPose(hull, _pose);
    toLocal(hull, pose, worldX, worldY, _local);
    const lx = _local.x, ly = _local.y;

    // 1) Rdzeń: ~22–50% węzłów najbliżej wybuchu w odłamki (promień z pola powierzchni).
    let debrisFrac = opts && Number.isFinite(opts.debrisFrac)
      ? Math.max(0, Math.min(0.9, opts.debrisFrac))
      : Math.min(0.5, 0.22 + Math.min(0.28, sev * 0.2));
    if (opts && Number.isFinite(opts.debrisMax) && nodes > 0) debrisFrac = Math.min(debrisFrac, Math.max(0, opts.debrisMax) / nodes);
    const coreR = Math.sqrt(nodes * debrisFrac * cs * cs / Math.PI);
    const coreR2 = coreR * coreR;
    const speedMul = 1 + Math.min(0.8, sev * 0.55);
    const dsMin = opts?.debrisSpeed ? opts.debrisSpeed[0] : 420;
    const dsSpan = opts?.debrisSpeed ? opts.debrisSpeed[1] - opts.debrisSpeed[0] : 560;
    const dsJitter = opts?.debrisSpeed ? dsMin * 0.4 : 180;
    let debris = 0;
    for (let i = 0; i < s.count && !body.dead; i++) {
      if (!s.active[i]) continue;
      const dx = s.x[i] - lx, dy = s.y[i] - ly, d2 = dx * dx + dy * dy;
      if (d2 > coreR2) continue;
      const d = Math.sqrt(d2) || 1;
      const speed = (dsMin + Math.random() * dsSpan) * speedMul;
      s.vx[i] = dx / d * speed + (Math.random() - 0.5) * dsJitter;
      s.vy[i] = dy / d * speed + (Math.random() - 0.5) * dsJitter;
      D.destroyNode(body, i);
      debris++;
    }
    if (body.dead) return { fragments: 0, debris, wreck };

    // 2) Promieniste rzazy od wybuchu: 2–5 odłamów zależnie od wielkości i siły.
    const remaining = body.activeNodes;
    let frags = 2;
    if (remaining >= 400) frags++;
    if (remaining >= 1600) frags++;
    if (remaining >= 3200 && sev > 0.95) frags++;
    if (opts && Number.isFinite(opts.cuts)) frags = Math.max(0, opts.cuts | 0);
    const cutW = opts && Number.isFinite(opts.cutWidth) ? cs * opts.cutWidth : cs * 0.75;
    const span = body.radius * 2 + cs * 4;
    const phase = Math.random() * Math.PI * 2;
    for (let k = 0; k < frags && !body.dead; k++) {
      const a = phase + (k / frags) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      cutLocalBand(body, lx, ly, lx + Math.cos(a) * span, ly + Math.sin(a) * span, cutW);
    }
    // 2b) Rzazy przez ciało w losowych miejscach (budowle: płyty i ściany pękają na drobne odłamy, nie tylko od
    // punktu trafienia). Punkt przecięcia losowany z żywych węzłów — linia zawsze idzie przez konstrukcję.
    const chords = opts && Number.isFinite(opts.chords) ? Math.max(0, opts.chords | 0) : 0;
    for (let k = 0; k < chords && !body.dead; k++) {
      let pick = -1;
      for (let tries = 0; tries < 8 && pick < 0; tries++) {
        const i = Math.floor(Math.random() * s.count);
        if (s.active[i]) pick = i;
      }
      if (pick < 0) break;
      const a = Math.random() * Math.PI;
      const ux = Math.cos(a) * span, uy = Math.sin(a) * span;
      cutLocalBand(body, s.x[pick] - ux, s.y[pick] - uy, s.x[pick] + ux, s.y[pick] + uy, cutW);
    }
    // 2c) Pęknięcia Voronoi (budowle): ziarna w żywych węzłach, belka między komórkami pęka — odłamy podobnej
    // wielkości z poszarpanym brzegiem zamiast długich linii rzazu; część węzłów na szwach sypie się w odłamki
    // (lecą od punktu rozpadu). Alokacje raz na rozpad.
    const cells = opts && Number.isFinite(opts.cells) ? Math.max(0, opts.cells | 0) : 0;
    if (cells > 1 && !body.dead) debris += voronoiFracture(body, cells, opts.crackDebris, lx, ly, dsMin * 0.6);

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
    const kick = typeof opts?.kick === 'function' ? (w) => { if (w && !w.dead) opts.kick(w, worldX, worldY); } : (w) => {
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
    // 5) Drobne odłamy (budowle — opts.minFragmentNodes) całe w odłamki: kilkanaście węzłów nie robi bryły,
    // a każdy odłam-wrak to osobny rysunek skóry.
    const minFrag = opts && Number.isFinite(opts.minFragmentNodes) ? opts.minFragmentNodes | 0 : 0;
    if (minFrag > 0) {
      const crumble = (w) => {
        const b = w?.beamHull?.entity === w ? w.beamHull.body : null;
        if (!b || b.dead || b.activeNodes <= 0 || b.activeNodes >= minFrag) return;
        debris += crumbleWreck(w, dsMin * 0.5);
        fragments--;
      };
      crumble(wreck);
      if (wrecks) for (let i = before; i < wrecks.length; i++) crumble(wrecks[i]);
    }
    return { fragments, debris, wreck };
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
  impactResult: hullImpactResult,
  normalResult: hullNormalResult,
  traceResult: hullTraceResult,
  uvResult: hullUvResult,

  /** Wrak z CAŁEGO kadłuba encji (śmierć statku). Kadłub przechodzi na nową encję wraku. */
  convertToWreck(entity) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity) return null;
    const body = hull.body;
    if (body.dead || body.activeNodes <= 0) return null;
    syncIn(hull);
    body.isWreck = true;
    body.keepLayout = false;           // wrak nie odrasta — po rozpadzie może się zagęścić
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
    const body = hull.body, s = body.nodeStore;
    // Indeksy jak w BIEŻĄCYM magazynie (plan kadłuba czyta je razem z HP węzłów) — nowy magazyn (zagęszczenie,
    // odrost z szablonu) = obrys od nowa.
    if (hull.shieldCells && hull._shieldCellsOf === s) return hull.shieldCells;
    hull._shieldCellsOf = s;
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

  // --------------------------- ODROST ---------------------------
  // Podstawa każdej naprawy, która przywraca zniszczoną konstrukcję (dok, a dalej rój dronów, okręt inżynieryjny,
  // stocznia). Wzorem jest KONSTRUKCJA SZABLONU kadłuba (structureFor — ta, z której powstało ciało); komórka (ix, iy)
  // siatki to tożsamość węzła wspólna dla kadłuba i szablonu. Odrastać może żywy statek (kotwica sprite'a), nie wrak
  // ani budowla. Szczegóły: sekcja ODROST niżej.

  /**
   * Front odrostu: komórki szablonu nieżywe w ciele encji, które mogą odrosnąć TERAZ — przy żywym kadłubie (dziura
   * zarasta od brzegów, odcięta sekcja od kikuta: co najmniej dwóch żywych sąsiadów przez belki poszycia, przy węźle
   * z ≥ 4 belkami poszycia tylu, ilu trzyma mocowanie wręgów), a nowe belki mieszczą się w zakresie sprężystym
   * (regrowStrain — komórka przy wgnieceniu czeka, aż naprawa je wyprostuje). `out` — tablica par [ix, iy, ix, iy, …]
   * (czyszczona). opts.any — także komórki przy wgnieceniach (bez testu belek; regrowCell ich nie przyjmie).
   * Zwraca liczbę komórek. Tylko odczyt.
   */
  regrowCandidates(entity, out = [], opts = null) {
    out.length = 0;
    const hull = regrowableHull(entity);
    const tpl = hull ? hullTemplate(hull) : null;
    if (!tpl) return 0;
    const body = hull.body, d = body.dims, lattice = D._latticeIndex(body).cells, active = body.nodeStore.active;
    const ts = tpl.structure.nodeStore, strict = !opts?.any;
    for (let t = 0; t < ts.count; t++) {
      const j = lattice[ts.ix[t] + ts.iy[t] * d.x + ts.iz[t] * d.x * d.y];
      if (j >= 0 && active[j]) continue;
      if (regrowPlacement(hull, tpl, t, strict, _regrowPos)) out.push(ts.ix[t], ts.iy[t]);
    }
    return out.length >> 1;
  },

  /**
   * Odrost jednej komórki frontu (regrowCandidates): węzeł w spoczynku komórki przeniesionym do bieżącego układu
   * ciała (+ średnie przemieszczenie żywych sąsiadów), belki szablonu do żywych węzłów zrośnięte w długości
   * spoczynkowej, masa i bezwładność ciała, skóra, siatka węzłów i kolizje od nowa. opts.hpMul — HP nowego węzła
   * jako ułamek jego maks. HP (łaty polowe mogą być słabsze; naprawa R doleczy resztę). Hak onRegrow (punkty
   * kadłuba). Zwraca, czy węzeł odrósł (false: komórka żywa, poza szablonem, poza frontem albo przy wgnieceniu).
   */
  regrowCell(entity, ix, iy, opts = null) {
    const hull = regrowableHull(entity);
    const tpl = hull ? hullTemplate(hull) : null;
    if (!tpl || !Number.isInteger(ix) || !Number.isInteger(iy)) return false;
    const body = hull.body, d = body.dims;
    if (ix < 0 || iy < 0 || ix >= d.x || iy >= d.y || d.z !== 1) return false;
    const cell = ix + iy * d.x;
    const t = tpl.cells[cell];
    if (t < 0) return false;
    let i = D._latticeIndex(body).cells[cell];
    if (i >= 0 && body.nodeStore.active[i]) return false;
    if (!regrowPlacement(hull, tpl, t, true, _regrowPos)) return false;
    const before = body.activeNodes;
    if (i < 0) {
      // Magazyn zagęszczony po rozpadzie (ciało bez keepLayout): raz wszystkie komórki szablonu jako martwe wpisy.
      expandBodyToTemplate(hull, tpl);
      i = D._latticeIndex(body).cells[cell];
      if (i < 0) return false;
    }
    const hpMul = Number.isFinite(opts?.hpMul) ? Math.max(0, Math.min(1, opts.hpMul)) : 1;
    reviveNode(body, i, _regrowPos.x, _regrowPos.y, _regrowPos.z, hpMul);
    finishRegrow(hull, before, false);
    return true;
  },

  /**
   * Pełny remont (dok): kadłub wraca do SZABLONU — każda komórka szablonu żywa w spoczynku, wszystkie belki szablonu
   * całe w długości spoczynkowej, bez zmęczenia, żaru i ruchu solvera, węzły z pełnym HP; masa, bezwładność, skóra,
   * siatka węzłów, obrys od nowa. Tożsamość kadłuba zostaje (ciało, klucz mapy ran, mostki, rdzenie, mocowania). Haki:
   * onRegrow (punkty kadłuba), onRepair(…, false) (mapa ran — naprawa zakończona). Zwraca liczbę odrośniętych węzłów
   * (0 — kadłub był cały), −1 — encja bez kadłuba, który może odrastać.
   */
  restoreHull(entity) {
    const hull = regrowableHull(entity);
    const tpl = hull ? hullTemplate(hull) : null;
    if (!tpl) return -1;
    const body = hull.body, before = body.activeNodes;
    expandBodyToTemplate(hull, tpl);
    const revived = restoreBodyToRest(body);
    finishRegrow(hull, before, true);
    if (typeof this.onRepair === 'function') this.onRepair(entity, 0, false);
    return revived;
  },

  /**
   * Środek komórki (ix, iy) w spoczynku, w świecie gry (y w dół) przy bieżącej pozie encji — cel drona odrostu.
   * Wynik w `out` (domyślnie współdzielony) albo null bez kadłuba.
   */
  cellWorld(entity, ix, iy, out = _nodeWorld) {
    const hull = entity?.beamHull;
    if (!hull || hull.entity !== entity) return null;
    const body = hull.body, cs = body.cellSize, lm = body.latticeMin;
    const pose = entityPose(hull, _qPose);
    const lx = lm.x + (ix + 0.5) * cs - anchorLocalX(hull), ly = lm.y + (iy + 0.5) * cs - anchorLocalY(hull);
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

// UV sprite'a punktu (układ ciała) w konwencji skóry gry (beamHullSkin.js, v = 0 u góry
// obrazu). Węzeł i: komórka (ix, iy) + przesunięcie punktu względem BIEŻĄCEJ pozycji węzła
// (uv jedzie z wgnieceniem); i < 0: spoczynek siatki (środek komórki = latticeMin + (i+½)·cs).
function writeSpriteUv(hull, i, lx, ly, out) {
  const body = hull.body, s = body.nodeStore, cs = body.cellSize;
  let cx, cy;
  if (i >= 0) {
    cx = s.ix[i] + 0.5 + (lx - s.x[i]) / cs;
    cy = s.iy[i] + 0.5 + (ly - s.y[i]) / cs;
  } else {
    cx = (lx - body.latticeMin.x) / cs;
    cy = (ly - body.latticeMin.y) / cs;
  }
  out.u = cx * hull.pixelPitch / hull.srcWidth;
  out.v = (hull.ny - cy) * hull.pixelPitch / hull.srcHeight;
  return out;
}

function resetImpactResult(kind, x, y) {
  const r = hullImpactResult;
  r.kind = kind;
  r.hit = false;
  r.killed = 0;
  r.radius = 0;
  r.node = -1;
  r.u = 0;
  r.v = 0;
  r.x = x;
  r.y = y;
  r.dmgKey = 0;
  r.dirX = 0;
  r.dirY = 0;
  r.len = 0;
  r.crater = 0;
  return r;
}

// Kierunek (świat gry) do hullImpactResult: jednostkowy wektor (dx, dy) i droga `frac`·|d|
// (cut: od wejścia do końca odcinka; impact: 0 — wektor to prędkość, nie droga).
function writeImpactDir(r, dx, dy, frac) {
  const l = Math.sqrt(dx * dx + dy * dy);
  if (!(l > 1e-9)) return r;
  r.dirX = dx / l;
  r.dirY = dy / l;
  r.len = frac > 0 ? l * frac : 0;
  return r;
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

// ============================ ODROST ============================
//
// Żywy kadłub statku trzyma magazyn w układzie konstrukcji (body.keepLayout — rozpad bez zagęszczania), więc wpis
// węzła każdej komórki istnieje: martwy ma swój spoczynek (latticeMin + (i + ½) · cs — przesuwa się z każdym
// wyrównaniem środka masy), masę, maks. HP z pancerzem (mostek, komora reaktora) i kolor — odrost tylko go ożywia.
// Magazyn zagęszczony (ciało bez flagi) dostaje raz wszystkie brakujące komórki szablonu (expandBodyToTemplate).

const _templates = new WeakMap();
const NODE_FIELD_NAMES = Object.keys(NODE_STORE_FIELDS);
const BEAM_FIELD_NAMES = Object.keys(BEAM_STORE_FIELDS);

// Kadłub encji, który może odrastać: żywy statek (kotwica sprite'a), nie wrak, nie budowla, nie zakotwiczony.
function regrowableHull(entity) {
  const hull = entity?.beamHull;
  if (!hull || hull.entity !== entity || hull.world || hull.anchorMode !== 'sprite') return null;
  if (entity.dead || entity.destroyed || entity.isWreck) return null;
  const body = hull.body;
  if (!body || body.dead || body.isWreck || body.anchored || body.static || body.activeNodes <= 0) return null;
  return hull;
}

// Szablon kadłuba (konstrukcja z obrazu — ta sama, z której powstało ciało) z indeksem komórka → węzeł szablonu,
// raz na konstrukcję; null — inna siatka niż ciało.
function hullTemplate(hull) {
  if (!hull.image) return null;
  let structure = null;
  try {
    structure = HullBodies.structureFor(hull.image, hull.scale, hull.cellPx);
  } catch {
    return null;
  }
  const d = structure?.dims, bd = hull.body.dims;
  if (!d || d.x !== bd.x || d.y !== bd.y || d.z !== bd.z) return null;
  let tpl = _templates.get(structure);
  if (!tpl) {
    const s = structure.nodeStore;
    const cells = new Int32Array(d.x * d.y * d.z).fill(-1);
    for (let i = 0; i < s.count; i++) cells[s.ix[i] + s.iy[i] * d.x + s.iz[i] * d.x * d.y] = i;
    tpl = { structure, cells };
    _templates.set(structure, tpl);
  }
  return tpl;
}

/**
 * Czy komórka szablonu `t` (martwa w ciele) może odrosnąć teraz; pozycja nowego węzła w `out` (układ ciała).
 * Sąsiedzi = żywe węzły ciała na końcach belek POSZYCIA szablonu (8 sąsiadów siatki): co najmniej dwóch — nowe belki
 * leżą wtedy na cyklu ciała, więc rozpad (połączenie bez drogi obejścia) ich nie rwie, a próg oparcia nie zabija
 * węzła; przy ≥ 4 belkach poszycia tylu, ilu trzyma mocowanie wręgów (mountMinSupportRatio — inaczej solver zerwałby
 * wręgi nowego węzła); komórka z 1–3 belkami poszycia (brzeg sylwetki) — tylu, ile ich ma, najwyżej dwóch.
 * Pozycja: spoczynek komórki + średnie przemieszczenie tych sąsiadów. `strict` — każda belka szablonu do żywego
 * węzła (też wręgi) w zakresie sprężystym (regrowStrain).
 */
function regrowPlacement(hull, tpl, t, strict, out) {
  const body = hull.body, s = body.nodeStore, d = body.dims, cs = body.cellSize, lm = body.latticeMin;
  const lattice = D._latticeIndex(body).cells, active = s.active;
  const ts = tpl.structure.nodeStore, te = tpl.structure.beamStore;
  const tAdj = ts.adj, ta = te.a, tb = te.b, q0 = ts.adjStart[t], q1 = ts.adjStart[t + 1];
  const dx = d.x, dxy = d.x * d.y;
  let n = 0, sx = 0, sy = 0, sz = 0;
  for (let q = q0; q < q1; q++) {
    const bi = tAdj[q];
    if (te.type[bi] >= BEAM_TYPE.FRAME) continue;
    const o = ta[bi] ^ tb[bi] ^ t;
    const j = lattice[ts.ix[o] + ts.iy[o] * dx + ts.iz[o] * dxy];
    if (j < 0 || !active[j]) continue;
    n++;
    sx += s.x[j] - s.ox[j]; sy += s.y[j] - s.oy[j]; sz += s.z[j] - s.oz[j];
  }
  const local = ts.localBeamCount[t];
  const need = local >= 4 ? Math.max(2, Math.ceil(local * (D.config?.mountMinSupportRatio ?? 0.3) - 1e-9)) : Math.min(2, local);
  if (n === 0 || n < need) return false;
  const px = lm.x + (ts.ix[t] + 0.5) * cs + sx / n;
  const py = lm.y + (ts.iy[t] + 0.5) * cs + sy / n;
  const pz = lm.z + (ts.iz[t] + 0.5) * cs + sz / n;
  if (strict) {
    const k = C.regrowStrain, restBase = te.restBase, deform = te.deform;
    for (let q = q0; q < q1; q++) {
      const bi = tAdj[q];
      const o = ta[bi] ^ tb[bi] ^ t;
      const j = lattice[ts.ix[o] + ts.iy[o] * dx + ts.iz[o] * dxy];
      if (j < 0 || !active[j]) continue;
      const ex = s.x[j] - px, ey = s.y[j] - py, ez = s.z[j] - pz;
      const base = restBase[bi];
      if (Math.abs(Math.sqrt(ex * ex + ey * ey + ez * ez) - base) > k * deform[bi] * base) return false;
    }
  }
  out.x = px; out.y = py; out.z = pz;
  return true;
}

// Martwy wpis i ożywiony w pozycji (x, y, z) układu ciała: bez prędkości, żaru i ruchu solvera (kadłub się nie
// budzi), HP = maks. HP · hpMul (najmniej 1), belki do żywych węzłów zrośnięte w długości spoczynkowej szablonu,
// bez zmęczenia. Próg oparcia (beamCount) jak po rozpadzie — od żywych belek; rośnie, gdy odrastają kolejni sąsiedzi.
function reviveNode(body, i, x, y, z, hpMul) {
  const s = body.nodeStore, e = body.beamStore, adj = s.adj, active = s.active;
  const ea = e.a, eb = e.b, broken = e.broken;
  active[i] = 1;
  s.x[i] = x; s.y[i] = y; s.z[i] = z;
  s.px[i] = x; s.py[i] = y; s.pz[i] = z;
  s.vx[i] = 0; s.vy[i] = 0; s.vz[i] = 0;
  s.hp[i] = Math.max(1, s.maxHp[i] * hpMul);
  s.heat[i] = 0; s.heatStamp[i] = 0; s.temp[i] = 0; s.crushDepth[i] = 0;
  s.act[i] = 0; s.quiet[i] = 0;
  const touched = _regrowTouched;
  touched.length = 0;
  touched.push(i);
  let live = 0;
  for (let q = s.adjStart[i]; q < s.adjStart[i + 1]; q++) {
    const bi = adj[q];
    const o = ea[bi] ^ eb[bi] ^ i;
    if (!active[o]) continue;
    if (broken[bi]) { broken[bi] = 0; body.liveBeams++; }
    e.rest[bi] = e.restBase[bi];
    e.fatigue[bi] = 0;
    e.strain[bi] = 0;
    live++;
    touched.push(o);
  }
  s.beamCount[i] = live;
  for (let k = 1; k < touched.length; k++) raiseBeamCount(s, e, touched[k]);
  body.activeNodes++;
  body.mass += s.mass[i];
  if (!body.static && !body.anchored) body.invMass = 1 / body.mass;
  // Mocowania wręgów węzła i sąsiadów od nowa (solver lokalny przelicza je tylko w swoim obszarze).
  D._refreshMountsLocal(body, beamSolverScratch(body), touched, touched.length);
  markSkinDirty(body, i);      // czworokąt węzła i 8 sąsiadów (wspólne narożniki)
  D._noteDisplacement(body, i);
  s.shapeVersion++;
  body.meshDirty = true;
  body.structureDirty = true;
  body._hashTick = -1;
  D._touchGeometry(body);
}

// Próg oparcia węzła j nie mniejszy niż jego żywe belki (zrośnięta belka podnosi go z powrotem ku szablonowi).
function raiseBeamCount(s, e, j) {
  let n = 0;
  for (let q = s.adjStart[j]; q < s.adjStart[j + 1]; q++) if (!e.broken[s.adj[q]]) n++;
  if (n > s.beamCount[j]) s.beamCount[j] = n;
}

// Wszystkie węzły i belki magazynu w spoczynku szablonu (pełny remont): żywe, w spoczynku, bez prędkości, żaru,
// zmęczenia i ruchu solvera, belki całe w długości spoczynkowej, HP pełne, próg oparcia = wszystkie belki węzła.
// Zwraca liczbę ożywionych węzłów (środek masy i bezwładność — finishRegrow).
function restoreBodyToRest(body) {
  const s = body.nodeStore, e = body.beamStore, n = s.count;
  let revived = 0;
  for (let i = 0; i < n; i++) {
    if (!s.active[i]) { s.active[i] = 1; revived++; }
    const ox = s.ox[i], oy = s.oy[i], oz = s.oz[i];
    s.x[i] = ox; s.y[i] = oy; s.z[i] = oz;
    s.px[i] = ox; s.py[i] = oy; s.pz[i] = oz;
    s.vx[i] = 0; s.vy[i] = 0; s.vz[i] = 0;
    s.hp[i] = s.maxHp[i];
    s.heat[i] = 0; s.heatStamp[i] = 0; s.temp[i] = 0; s.crushDepth[i] = 0;
    s.act[i] = 0; s.quiet[i] = 0;
    s.beamCount[i] = s.adjStart[i + 1] - s.adjStart[i];
  }
  for (let b = 0; b < e.count; b++) {
    e.broken[b] = 0; e.rest[b] = e.restBase[b]; e.fatigue[b] = 0; e.strain[b] = 0;
  }
  body.activeNodes = n;
  body.liveBeams = e.count;
  body._maxDisp = 0;
  if (body._solverScratch) body._solverScratch.mountFailed.fill(0);
  resetActiveRegion(body);     // pusty obszar solvera, skóra całego kadłuba do przepisania
  s.shapeVersion++;
  body.meshDirty = true;
  body.structureDirty = true;
  body._hashTick = -1;
  D._touchGeometry(body);
  return revived;
}

// Po odroście: masa, bezwładność, obrys, rewizja kadłuba (model 3D, przekroje) i hak punktów (onRegrow).
// `recenter` — początek układu zawsze do środka masy (remont); inaczej dopiero, gdy odjechał o regrowRecenterCells.
function finishRegrow(hull, activeBefore, recenter) {
  const body = hull.body;
  const info = computeStoreInertia(body.nodeStore, body.cellSize);
  if (info) {
    const c = info.com;
    if (recenter || Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z) > C.regrowRecenterCells * body.cellSize) {
      shiftBodyOrigin(hull, c.x, c.y, c.z);
    }
    body.mass = Math.max(1, info.mass);
    if (!body.static && !body.anchored) body.invMass = 1 / body.mass;
    body.invInertiaLocal = info.invInertia;
  }
  D._updateRadius(body);
  hull.revision++;
  const hook = HullBodies.onRegrow;
  if (typeof hook === 'function' && hull.entity) {
    const base = Math.max(1, hull.baseNodes);
    hook(hull.entity, Math.min(1, activeBefore / base), Math.min(1, body.activeNodes / base));
  }
}

// Początek układu ciała przesunięty o (cx, cy, cz), jak przy przebudowie po rozpadzie: magazyn i latticeMin razem,
// więc kotwica sprite'a (latticeMin + stała) zostaje na swoim miejscu kadłuba, a encja tam, gdzie była; ciało bierze
// pozę od encji.
function shiftBodyOrigin(hull, cx, cy, cz) {
  const body = hull.body;
  D._shiftStore(body.nodeStore, cx, cy, cz);
  body.latticeMin.x -= cx; body.latticeMin.y -= cy; body.latticeMin.z -= cz;
  if (body._region) body._region.dirtyAll = true;   // wszystkie czworokąty skóry w nowym układzie
  body.nodeStore.shapeVersion++;
  body._hashTick = -1;
  D._touchGeometry(body);
  syncBodyPose(hull);
}

/**
 * Magazyn zagęszczony po rozpadzie (ciało bez keepLayout) → wszystkie komórki szablonu: istniejące węzły i belki
 * zostają pod swoimi indeksami (kolejność belek węzła w CSR ta sama — solver i wyspy liczą jak dotąd), brakujące
 * komórki dochodzą na końcu jako martwe wpisy (spoczynek w bieżącym układzie, masa, maks. HP i kolor z szablonu), ich
 * belki szablonu — na końcu jako zerwane. Pancerz komórek zabitych przed zagęszczeniem przepadł razem z nimi (HP
 * szablonu). Zwraca false, gdy magazyn ma już każdą komórkę.
 */
function expandBodyToTemplate(hull, tpl) {
  const body = hull.body, s = body.nodeStore, e = body.beamStore, d = body.dims;
  const T = tpl.structure, ts = T.nodeStore, te = T.beamStore;
  const lattice = D._latticeIndex(body).cells, dxy = d.x * d.y;
  const n0 = s.count;
  const map = new Int32Array(ts.count);
  let n = n0;
  for (let t = 0; t < ts.count; t++) {
    const i = lattice[ts.ix[t] + ts.iy[t] * d.x + ts.iz[t] * dxy];
    map[t] = i >= 0 ? i : n++;
  }
  if (n === n0) return false;
  const ns = new BeamNodeStore(n);
  for (const f of NODE_FIELD_NAMES) ns[f].set(s[f]);
  ns.shapeVersion = s.shapeVersion + 1;
  const mul = hull.massMul > 0 ? hull.massMul : templateMassMul(s, ts, map, n0);
  const lm = body.latticeMin, tlm = T.latticeMin;
  const offX = lm.x - tlm.x, offY = lm.y - tlm.y, offZ = lm.z - tlm.z;
  for (let t = 0; t < ts.count; t++) {
    const i = map[t];
    if (i < n0) continue;
    const ox = ts.ox[t] + offX, oy = ts.oy[t] + offY, oz = ts.oz[t] + offZ;
    ns.ox[i] = ox; ns.oy[i] = oy; ns.oz[i] = oz;
    ns.x[i] = ox; ns.y[i] = oy; ns.z[i] = oz;
    ns.px[i] = ox; ns.py[i] = oy; ns.pz[i] = oz;
    const m = ts.mass[t] * mul;
    ns.mass[i] = m;
    ns.invMass[i] = m > 0 ? 1 / m : 0;
    ns.maxHp[i] = ts.maxHp[t];
    ns.coverage[i] = ts.coverage[t];
    ns.r[i] = ts.r[t]; ns.g[i] = ts.g[t]; ns.b[i] = ts.b[t];
    ns.ix[i] = ts.ix[t]; ns.iy[i] = ts.iy[t]; ns.iz[i] = ts.iz[t]; ns.depth[i] = ts.depth[t];
    ns.beamCount[i] = ts.beamCount[t]; ns.localBeamCount[i] = ts.localBeamCount[t];
    ns.platingCount[i] = ts.platingCount[t]; ns.surface[i] = ts.surface[t];
  }
  let extra = 0;
  for (let b = 0; b < te.count; b++) if (map[te.a[b]] >= n0 || map[te.b[b]] >= n0) extra++;
  const bs = new BeamLinkStore(e.count + extra);
  for (const f of BEAM_FIELD_NAMES) bs[f].set(e[f]);
  let k = e.count;
  for (let b = 0; b < te.count; b++) {
    const a = map[te.a[b]], c = map[te.b[b]];
    if (a < n0 && c < n0) continue;
    bs.a[k] = a; bs.b[k] = c;
    bs.rest[k] = te.restBase[b]; bs.restBase[k] = te.restBase[b];
    bs.stiffness[k] = te.stiffness[b]; bs.deform[k] = te.deform[b]; bs.brk[k] = te.brk[b];
    bs.type[k] = te.type[b]; bs.restBridge[k] = te.restBridge[b];
    bs.broken[k] = 1;
    k++;
  }
  buildAdjacency(ns, bs);
  const views = cachedNodeViews(body);
  const failed = body._solverScratch ? body._solverScratch.mountFailed : null;
  body.nodeStore = ns;
  body.beamStore = bs;
  if (views) {
    // Widoki węzłów (kod spoza silnika) przechodzą na nowy magazyn pod tymi samymi indeksami — tożsamość zostaje.
    const next = new Array(n);
    for (let i = 0; i < n0; i++) { views[i]._s = ns; next[i] = views[i]; }
    for (let i = n0; i < n; i++) next[i] = new BeamNodeView(ns, i);
    body.nodes = next;
  } else {
    body.nodes = null;
  }
  body.beams = null;
  body._integrity = new Int32Array(n);
  body._solverScratch = null;
  if (failed) beamSolverScratch(body).mountFailed.set(failed.subarray(0, Math.min(n0, failed.length)));
  body._region = null;     // nowy obszar przy pierwszym użyciu: lista z flag act, cała skóra
  body._lattice = null;
  body._hashTick = -1;
  D._touchGeometry(body);
  return true;
}

// Masa węzła ciała / masa węzła szablonu z dowolnej wspólnej komórki (kadłub sprzed pola massMul).
function templateMassMul(s, ts, map, n0) {
  for (let t = 0; t < ts.count; t++) {
    const i = map[t];
    if (i < n0 && ts.mass[t] > 0 && s.mass[i] > 0) return s.mass[i] / ts.mass[t];
  }
  return 1;
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

// Hasz węzła 0..1 (rozrzut odłamków rzazu bez Math.random — przebieg gry nie zależy od obrazu).
function nodeHash01(i, salt) {
  let h = Math.imul((i + 1) ^ salt, 0x9E3779B1);
  h ^= h >>> 15; h = Math.imul(h, 0x85EBCA77); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// Wycięty metal rzazu z pędem (cutLocalBand, push): masa i środek masy w układzie ciała.
const _cutCut = { mass: 0, x: 0, y: 0 };

// Pas wokół odcinka (układ ciała): zniszcz wszystkie żywe węzły bliżej niż halfWidth. push — rzaz
// pocisku (odcinek = tor): węzeł dostaje prędkość odłamka wzdłuż toru i na bok od linii cięcia
// (onNodeDebris bierze prędkość węzła), masa i środek wyciętego metalu → _cutCut (applyCutPush).
function cutLocalBand(body, x0, y0, x1, y1, halfWidth, push = false) {
  const s = body.nodeStore, x = s.x, y = s.y, active = s.active;
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
  const r2 = halfWidth * halfWidth;
  const minX = Math.min(x0, x1) - halfWidth, maxX = Math.max(x0, x1) + halfWidth;
  const minY = Math.min(y0, y1) - halfWidth, maxY = Math.max(y0, y1) + halfWidth;
  const len = Math.sqrt(len2);
  const ux = len > 1e-9 ? dx / len : 0, uy = len > 1e-9 ? dy / len : 0;
  const cut = _cutCut;
  cut.mass = 0; cut.x = 0; cut.y = 0;
  let killed = 0;
  for (let i = 0; i < s.count; i++) {
    if (!active[i]) continue;
    const px = x[i], py = y[i];
    if (px < minX || px > maxX || py < minY || py > maxY) continue;
    let t = len2 > 1e-12 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x0 + dx * t - px, ey = y0 + dy * t - py;
    if (ex * ex + ey * ey > r2) continue;
    if (push && len > 1e-9) {
      // Odłamek: wzdłuż toru × (0,5–1,3), na bok od linii cięcia (strona węzła) 0,15–0,5.
      const side = (px - x0) * -uy + (py - y0) * ux >= 0 ? 1 : -1;
      const sp = C.cutDebrisSpeed * (0.5 + 0.8 * nodeHash01(i, 0x3C6EF372));
      const lat = side * (0.15 + 0.35 * nodeHash01(i, 0x1B873593));
      s.vx[i] = (ux - uy * lat) * sp;
      s.vy[i] = (uy + ux * lat) * sp;
      const m = s.mass[i];
      cut.mass += m; cut.x += px * m; cut.y += py * m;
    }
    D.destroyNode(body, i);
    killed++;
    if (body.dead) break;
  }
  if (cut.mass > 0) { cut.x /= cut.mass; cut.y /= cut.mass; }
  if (killed > 0) {
    D.wake(body, D.config.wakeHoldFrames);
    if (!body.noSplit && D.splitQueue.indexOf(body) === -1) D.splitQueue.push(body);
  }
  return killed;
}

// Pęknięcia Voronoi (shatter → opts.cells): `cells` ziaren w losowych żywych węzłach (z drganiem pół komórki),
// każdy żywy węzeł należy do najbliższego ziarna, belka między węzłami dwóch komórek pęka. Węzły na szwach
// z prawdopodobieństwem `crackDebris` idą w odłamki — prędkość od punktu (lx, ly) układu ciała, `speed` j/s
// (× 0,5–1,5, rozrzut). Zwraca liczbę odłamków; rozpad na wyspy robi processSplits (shatter, krok 3).
function voronoiFracture(body, cells, crackDebris, lx, ly, speed) {
  const s = body.nodeStore, n = s.count, cs = body.cellSize;
  const sx = new Float64Array(cells), sy = new Float64Array(cells);
  let k = 0;
  for (let tries = 0; tries < cells * 16 && k < cells; tries++) {
    const i = Math.floor(Math.random() * n);
    if (!s.active[i]) continue;
    sx[k] = s.x[i] + (Math.random() - 0.5) * cs;
    sy[k] = s.y[i] + (Math.random() - 0.5) * cs;
    k++;
  }
  if (k < 2) return 0;
  const owner = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    if (!s.active[i]) continue;
    let best = 0, bd = Infinity;
    for (let q = 0; q < k; q++) {
      const dx = s.x[i] - sx[q], dy = s.y[i] - sy[q];
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = q; }
    }
    owner[i] = best;
  }
  const e = body.beamStore, ea = e.a, eb = e.b, broken = e.broken;
  const seam = new Uint8Array(n);
  let cut = 0;
  for (let bi = 0; bi < e.count; bi++) {
    if (broken[bi]) continue;
    const a = ea[bi], b = eb[bi];
    if (!s.active[a] || !s.active[b] || owner[a] === owner[b]) continue;
    broken[bi] = 1;
    seam[a] = 1; seam[b] = 1;
    cut++;
  }
  if (!cut) return 0;
  body.liveBeams = Math.max(0, body.liveBeams - cut);
  D.perf.beamsBroken += cut;
  body.structureDirty = true;
  body.meshDirty = true;
  let debris = 0;
  const p = Math.max(0, Math.min(1, Number(crackDebris) || 0));
  for (let i = 0; i < n && p > 0 && !body.dead; i++) {
    if (!seam[i] || !s.active[i] || Math.random() >= p) continue;
    const dx = s.x[i] - lx, dy = s.y[i] - ly;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const v = speed * (0.5 + Math.random());
    s.vx[i] = dx / d * v + (Math.random() - 0.5) * speed * 0.6;
    s.vy[i] = dy / d * v + (Math.random() - 0.5) * speed * 0.6;
    D.destroyNode(body, i);
    debris++;
  }
  D.wake(body, D.config.wakeHoldFrames);
  if (!body.noSplit && D.splitQueue.indexOf(body) === -1) D.splitQueue.push(body);
  return debris;
}

// Drobny odłam (shatter → opts.minFragmentNodes) cały w odłamki: węzły lecą z prędkością ENCJI wraku (pchnięcie
// z kroku 4, którego ciało jeszcze nie zna — syncIn dopiero w kroku) i rozrzutem do `speed` j/s.
function crumbleWreck(w, speed) {
  const hull = w.beamHull, body = hull.body, s = body.nodeStore;
  const pose = entityPose(hull, _pose);
  const c = pose.c, sn = pose.s;
  // brakująca prędkość (świat silnika: y w górę) → układ ciała (Rᵀ)
  const wx = (Number(w.vx) || 0) - body.vel.x, wy = -(Number(w.vy) || 0) - body.vel.y;
  const lvx = c * wx + sn * wy, lvy = -sn * wx + c * wy;
  let n = 0;
  for (let i = 0; i < s.count && !body.dead; i++) {
    if (!s.active[i]) continue;
    const a = Math.random() * Math.PI * 2, v = speed * Math.random();
    s.vx[i] = lvx + Math.cos(a) * v;
    s.vy[i] = lvy + Math.sin(a) * v;
    D.destroyNode(body, i);
    n++;
  }
  return n;
}

// Impuls rzazu z pędem (po cutLocalBand z push): masa wyciętego metalu × cutPushSpeed wzdłuż toru,
// przyłożony w środku masy rzazu — ruch postępowy i obrót kadłuba. Gra całkuje ruch encji, a syncIn
// nadpisuje body.vel z encji, więc zmiana prędkości idzie do ENCJI (jak syncOut: kotwica = początek
// ciała + ra). Odcięte części dziedziczą ją przy rozpadzie (prędkość rodzica + ω × r) — odlatują
// wzdłuż toru i rozchodzą się obrotem zamiast wisieć. Sufity: cutPushMaxDv, cutPushMaxDw.
function applyCutPush(hull, lx0, ly0, lx1, ly1) {
  const b = hull.body, e = hull.entity, cut = _cutCut;
  if (!e || !(cut.mass > 0) || !(b.invMass > 0)) return;
  const dlx = lx1 - lx0, dly = ly1 - ly0;
  const dl = Math.sqrt(dlx * dlx + dly * dly);
  if (!(dl > 1e-9)) return;
  const pose = entityPose(hull, _pose);
  const c = pose.c, s = pose.s;
  // Układ ciała → świat silnika: R = [[c, −s], [s, c]] (toLocal = Rᵀ).
  const dirX = (c * dlx - s * dly) / dl, dirY = (s * dlx + c * dly) / dl;
  const rx = c * cut.x - s * cut.y, ry = s * cut.x + c * cut.y;
  const jx = dirX * cut.mass * C.cutPushSpeed, jy = dirY * cut.mass * C.cutPushSpeed;
  let dvx = jx * b.invMass, dvy = jy * b.invMass;
  const dv = Math.sqrt(dvx * dvx + dvy * dvy);
  if (dv > C.cutPushMaxDv) { dvx *= C.cutPushMaxDv / dv; dvy *= C.cutPushMaxDv / dv; }
  const inv = b.invInertiaLocal;
  const invIz = inv && inv.length > 8 ? Number(inv[8]) || 0 : 0;
  let dw = invIz * (rx * jy - ry * jx);
  if (dw > C.cutPushMaxDw) dw = C.cutPushMaxDw; else if (dw < -C.cutPushMaxDw) dw = -C.cutPushMaxDw;
  // Kotwica encji względem początku ciała (jak syncOut).
  const ax = anchorLocalX(hull), ay = anchorLocalY(hull);
  const rax = c * ax - s * ay, ray = s * ax + c * ay;
  setEntityVel(e, entityVelX(e) + dvx - dw * ray, entityVelY(e) - (dvy + dw * rax));
  e.angVel = (Number(e.angVel) || 0) - dw;
  if (e.isWreck) { e._wreckSleeping = false; e._wreckSleepTimer = 0; }
}

// Ostatni rzaz z pędem kadłuba (brzeg dla odłamów z rozpadu — applyCutEdgeImpulse). Współrzędne
// SIATKI (układ ciała − latticeMin): nie zmieniają się przy przebudowie ciała i są te same w odłamie.
function rememberPushCut(hull, lx0, ly0, lx1, ly1, halfWidth) {
  const b = hull.body, lm = b.latticeMin;
  const c = hull._pushCut || (hull._pushCut = { t: 0, x0: 0, y0: 0, x1: 0, y1: 0, hw: 0 });
  c.t = HullBodies.simTime;
  c.x0 = lx0 - lm.x; c.y0 = ly0 - lm.y;
  c.x1 = lx1 - lm.x; c.y1 = ly1 - lm.y;
  c.hw = halfWidth;
}

// Odłam z rozpadu po rzazie z pędem (hak onWreck, przed encją wraku): węzły przy brzegu rzazu oddają
// pęd wzdłuż toru i od linii cięcia — suma impulsów na masę odłamu (ruch) i moment wokół jego środka
// masy (obrót; początek odłamu = środek masy). Układ odłamu = układ rodzica (ten sam obrót przy rozpadzie).
function applyCutEdgeImpulse(parentHull, wb) {
  const cut = parentHull._pushCut;
  if (!cut || !(HullBodies.simTime - cut.t <= C.cutEdgeWindow) || !(wb.mass > 0)) return;
  const dx = cut.x1 - cut.x0, dy = cut.y1 - cut.y0, len2 = dx * dx + dy * dy;
  if (!(len2 > 1e-12)) return;
  const len = Math.sqrt(len2), ux = dx / len, uy = dy / len;
  const s = wb.nodeStore, lm = wb.latticeMin, active = s.active;
  const reach = cut.hw + C.cutEdgeCells * wb.cellSize, band = reach - cut.hw;
  let px = 0, py = 0, tq = 0;
  for (let i = 0; i < s.count; i++) {
    if (!active[i]) continue;
    const gx = s.x[i] - lm.x, gy = s.y[i] - lm.y;
    let t = ((gx - cut.x0) * dx + (gy - cut.y0) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = gx - (cut.x0 + dx * t), ey = gy - (cut.y0 + dy * t);
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d >= reach) continue;
    const w = d <= cut.hw ? 1 : 1 - (d - cut.hw) / band;
    const j = s.mass[i] * C.cutEdgeSpeed * w;
    const side = ex * -uy + ey * ux >= 0 ? C.cutEdgeSpread : -C.cutEdgeSpread;
    const jx = (ux - uy * side) * j, jy = (uy + ux * side) * j;
    px += jx; py += jy;
    tq += s.x[i] * jy - s.y[i] * jx;
  }
  if (px === 0 && py === 0) return;
  const m = D._refreshRot(wb);
  wb.vel.x += (m[0] * px + m[1] * py) / wb.mass;
  wb.vel.y += (m[3] * px + m[4] * py) / wb.mass;
  const inv = wb.invInertiaLocal;
  const dw = (inv && inv.length > 8 ? Number(inv[8]) || 0 : 0) * tq;
  wb.angVel.z += dw > C.cutPushMaxDw * 2 ? C.cutPushMaxDw * 2 : dw < -C.cutPushMaxDw * 2 ? -C.cutPushMaxDw * 2 : dw;
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
  // Odłamy JEDNEGO kawałka budowli (worldBodies.breakPiece — pęknięcia Voronoi) nie zderzają się między sobą:
  // rodzą się na styk wzdłuż szwów i rozchodzą; ich styki to ~⅓ kroku po rozpadzie suchego doku (pomiar
  // 2026-10-07). Z okrętami, budowlą i odłamami innych kawałków — zwykłe zderzenia.
  if (ea.worldDebris && eb.worldDebris && ea.beamHull?.world === eb.beamHull?.world) return false;
  // Składy i moduły jednego właściciela (pociąg megafrachtowca) — jak dawny destruktor.
  // Wraki zderzają się z rodzicem i rodzeństwem: odłam z tarana leci po fizyce.
  if (!ea.isWreck && !eb.isWreck) {
    const ra = ea.owner || ea, rb = eb.owner || eb;
    if (ra === rb || ra === eb || rb === ea) return false;
    // Ciała budowli (worldBodies.js): gospodarz miejsca decyduje, kto przez nie przelatuje (piraci przez własny dok).
    if (ea.isWorldPiece && ea.worldPiece?.site?.passes?.(eb)) return false;
    if (eb.isWorldPiece && eb.worldPiece?.site?.passes?.(ea)) return false;
  }
  if (areTowBodiesCollisionDisabled(ea, eb)) return false;
  // Dwa stare, wolne wraki nie mielą się bez końca w stosie złomu.
  if (ea.isWreck && eb.isWreck && isColdWreck(ea) && isColdWreck(eb)) return false;
  // Flaga wreckPairEvery: wolna para wraków po czasie pełnych kolizji — co k-ty krok, krokiem k · dt.
  if (C.wreckPairEvery > 1 && ea.isWreck && eb.isWreck && isSlowWreckPair(A, B, ea, eb)) return C.wreckPairEvery;
  return true;
}

// Para wraków bez szybkiego styku: oba po czasie pełnych kolizji (świeży odłam rozdziela się co krok),
// prędkość względna środków + obrót obu (|ω| · promień) poniżej wreckPairSpeed. Ciała po syncIn tego kroku.
function isSlowWreckPair(A, B, ea, eb) {
  if ((Number(ea._wreckAge) || 0) <= C.wreckFullCollisionTime || (Number(eb._wreckAge) || 0) <= C.wreckFullCollisionTime) return false;
  const dvx = A.vel.x - B.vel.x, dvy = A.vel.y - B.vel.y;
  const surface = Math.sqrt(dvx * dvx + dvy * dvy) + Math.abs(A.angVel.z) * A.radius + Math.abs(B.angVel.z) * B.radius;
  return surface < C.wreckPairSpeed;
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
const _lostUv = { u: 0, v: 0 };

function onNodeDebris(body, i, wx, wy, wz, vx, vy) {
  const hull = body.hull;
  if (!hull) return;
  const s = body.nodeStore;
  // Rozdarcie poza trafieniem broni (hak onNodeLost — mapa ran): uv komórki węzła w konwencji skóry.
  if (HullBodies._weaponDepth === 0 && typeof HullBodies.onNodeLost === 'function' && hull.entity) {
    writeSpriteUv(hull, i, s.x[i], s.y[i], _lostUv);
    HullBodies.onNodeLost(hull.entity, hull, _lostUv.u, _lostUv.v, wx, -wy);
  }
  if (typeof window === 'undefined' || typeof window.spawnHullDebris !== 'function') return;
  // Rozmiar jak odłamki dema: ~0,9–1,8 komórki (siatka gry = siatka dema, 15 j.).
  const scale = body.cellSize * (0.9 + fxRandom.next() * 0.9);
  const structural = s.beamCount[i] > s.localBeamCount[i] && fxRandom.next() < 0.4;
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
    massMul: parentHull.massMul,
    isFragment: true,
    dmgKey: parentHull.dmgKey,         // rany rodzica (wrak z całego kadłuba, odłamy, wybuch reaktora)
    world: parentHull.world || null,   // odłam ciała świata: render rysuje go bryłą 3D kawałka budowli
    cellPx: parentHull.cellPx || C.cellPx,
    pins: 0,
    radius: body.radius,
    revision: 0,
    shieldCells: null,
    _shieldCellsOf: null,
    _massRef: body.mass,
    _inPx: 0, _inPy: 0, _inVx: 0, _inVy: 0, _inW: 0, _inNodes: body.activeNodes
  };
  updateComPivot(hull);
  body.entity = wreck;
  body.hull = hull;
  body.isWreck = true;
  wreck.beamHull = hull;
  // Odłam ciała świata (worldBodies.js): rysuje go skóra brył budowli (worldBodies3D.js — `worldDebris`); odłam
  // kawałka-ducha (dach nad płaszczyzną gry) niczego nie dotyka — pociski i kadłuby przelatują pod nim.
  if (parentHull.world) {
    wreck.worldDebris = true;
    if (parentHull.world.ghost) wreck.isCollidable = false;
  }
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
  // Ciało świata (budowla): wyspa, która dalej trzyma się kotwicy, zostaje BUDOWLĄ — stoi, bez listy wraków,
  // łupu i holowania; gra (worldBodies.js) dopisuje ją do kawałka przez hak onWorldIsland. Wyspa bez kotwicy
  // to zwykły wrak (lista wraków całkuje jego ruch) z obrazem budowli (hull.world).
  if (parentHull.world && wreckBody.anchored) {
    const island = makeWreckEntity(parent || { visual: null }, wreckBody, parentHull);
    island.isWreck = false;
    island.worldDebris = false;
    island.isWorldPiece = true;
    island.vx = 0; island.vy = 0; island.angVel = 0;
    island.friction = 1;
    island.beamHull._inNodes = wreckBody.activeNodes;
    wreckBody.isWreck = false;
    if (typeof HullBodies.onWorldIsland === 'function') HullBodies.onWorldIsland(island, parent);
    return;
  }
  // Odłam z rzazu z pędem (Hexlance): pęd brzegu rzazu, zanim encja wraku weźmie prędkość ciała.
  applyCutEdgeImpulse(parentHull, wreckBody);
  const wreck = makeWreckEntity(parent || { visual: null }, wreckBody, parentHull);
  // Nowy wrak nie był w syncIn tego kroku — jego stan to od razu stan silnika.
  wreck.beamHull._inNodes = wreckBody.activeNodes;
  finishWreck(wreck, parent, wreckBody.activeNodes, parentBody);
}

function nowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
}

if (typeof window !== 'undefined') window.HullBodies = HullBodies;
