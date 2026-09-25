// Rdzeń statku (reaktor): komora w kadłubie heksowym, maszyna stanów stopienia
// i detonacja. Logika bez DOM i bez three — renderem zajmuje się coreFx3D.js,
// a dema i gra wołają te same funkcje (demo: dema/rdzen-demo.html, integracja:
// docs/PORT-rdzen.md).
//
// Model w skrócie:
//   * rdzeń = punkt z `cores[]` edytora (przestrzeń PNG sprite'a, (0,0) = środek,
//     +X = dziób) + komora o promieniu `r` (też PNG) i pancerzu `armorMul`;
//   * heksy komory dostają `shard.__coreId` RAZ, z pozycji startowej siatki,
//     i pancerz maxHp/hp × armorMul — znacznik jedzie z obiektem heksa, także
//     do wraku po rozpadzie kadłuba;
//   * stan liczony w kadencji sondy integralności (0,08 s jak hardpointy):
//     NOMINALNY → ODSŁONIĘTY (padł pierwszy heks komory) → KRYTYCZNY (osłona
//     pod progiem) → STOPIENIE (odliczanie klasy) → DETONACJA (zawsze);
//   * warunek killa przełączalny: sonda punktu jak dziś w grze (2 kontrole bez
//     heksa w 5 punktach) albo próg osłony komory (HP żywych heksów komory);
//   * przestrzeń: siatka heksów (gridX/gridY) jest wspólna dla kadłuba i jego
//     wraków (ten sam srcWidth/srcHeight, różny tylko pivot), więc rdzeń trzyma
//     pozycję w siatce, a lokalną i światową liczy od bieżącego gospodarza.
//
// Przeliczenie PNG → siatka jest JEDNO dla gracza i NPC (layout = rozmiar siatki
// / rozmiar PNG). Markery nigdy nie są przeskalowane z góry — to jest poprawka
// uśpionego błędu podwójnego skalowania rdzeni gracza (PORT, poprawka 1).

import { DestructorSystem, DESTRUCTOR_CONFIG, addShardHeat, getHexProbeDrift } from './destructor.js';

export const CORE_STATE = Object.freeze({
  NOMINAL: 'nominal',
  EXPOSED: 'exposed',
  CRITICAL: 'critical',
  MELTDOWN: 'meltdown',
  DETONATED: 'detonated'
});

export const CORE_STATE_LABEL = Object.freeze({
  nominal: 'NOMINALNY',
  exposed: 'ODSŁONIĘTY',
  critical: 'KRYTYCZNY',
  meltdown: 'STOPIENIE',
  detonated: 'DETONACJA'
});

const STATE_RANK = Object.freeze({ nominal: 0, exposed: 1, critical: 2, meltdown: 3, detonated: 4 });

export function coreStateRank(state) {
  return STATE_RANK[state] ?? 0;
}

export const CORE_KILL_MODE = Object.freeze({
  // Dzisiejsza sonda gry (index.html isCoreHexSupported): probeImpact w punkcie
  // rdzenia i w 4 punktach na promieniu coreProbeRadius; kill po 2 kontrolach
  // bez heksa. Komora (r) służy wtedy tylko stanom i wyglądowi.
  PROBE: 'probe',
  // Próg osłony komory: HP żywych heksów komory / HP startowe < killFrac.
  CONTAINMENT: 'containment'
});

// Kadencja i promień sondy = HARDPOINT_INTEGRITY_CONFIG z index.html.
export const CORE_PROBE_CONFIG = Object.freeze({
  probeEverySec: 0.08,
  coreProbeRadius: 12,          // PNG px (× skala układu, jak w grze)
  coreLostChecksToDestroy: 2
});

// Progi klas = REACTOR_BLOW_PROFILE_BY_RADIUS z index.html (promień kadłuba
// po initHexBody, w jednostkach świata).
export const CORE_CLASS_BY_RADIUS = Object.freeze([
  Object.freeze({ minRadius: 210, id: 'capital' }),
  Object.freeze({ minRadius: 150, id: 'cruiser' }),
  Object.freeze({ minRadius: 0, id: 'escort' })
]);

// Profile klas. Wymiary komory w px SIATKI (skala renderu kadłuba) — w markerze
// edytora `r` jest w px PNG i przelicza się przez skalę układu.
//   chamberR     — promień komory, gdy marker go nie podaje (px siatki);
//   armorMul     — mnożnik HP heksów komory;
//   criticalFrac — osłona, poniżej której rdzeń jest KRYTYCZNY;
//   killFrac     — osłona, poniżej której zaczyna się STOPIENIE (tryb containment);
//   meltdownSec  — odliczanie stopienia (okno taktyczne);
//   blastProfile — profil fabryki reactorblow.js (escort/cruiser/capital);
//   aoe*         — obszarowe HP jak dziś w tryTriggerCriticalReactorBlow
//                  (promień max(min, promień kadłuba × mul), obrażenia max(min, maxHp × frac));
//   hex*         — NOWE: krater w kadłubie sąsiada od strony wybuchu (applyImpact),
//                  bez tego wybuch reaktora nie rusza heksów sąsiadów;
//   shock*       — NOWE: fala na komory sąsiadów w promieniu aoeRadius × shockRadiusMul
//                  (obrażenia HP heksów komory × spadek odległości do RDZENIA) — to
//                  jest napęd łańcucha: krater rzadko sięga rdzenia 150–250 px w głąb,
//                  fala wybija osłonę i przez dziury widać żar sąsiada;
//   craterMul    — ile promieni komory wyparowuje we własnym kadłubie przy detonacji.
export const CORE_CLASS_PROFILES = Object.freeze({
  escort: Object.freeze({
    id: 'escort', chamberR: 12, armorMul: 2.0, criticalFrac: 0.6, killFrac: 0.3, meltdownSec: 1.5,
    blastProfile: 'escort', aoeRadiusMul: 6, aoeRadiusMin: 700, aoeDamageFrac: 0.45, aoeDamageMin: 60,
    hexDamage: 500, hexRadius: 40, hexSpeed: 2500, shockRadiusMul: 0.3, shockDamage: 150, craterMul: 2.0
  }),
  cruiser: Object.freeze({
    id: 'cruiser', chamberR: 18, armorMul: 2.5, criticalFrac: 0.6, killFrac: 0.3, meltdownSec: 2.5,
    blastProfile: 'cruiser', aoeRadiusMul: 6, aoeRadiusMin: 700, aoeDamageFrac: 0.45, aoeDamageMin: 60,
    hexDamage: 900, hexRadius: 60, hexSpeed: 3000, shockRadiusMul: 0.35, shockDamage: 250, craterMul: 2.2
  }),
  capital: Object.freeze({
    id: 'capital', chamberR: 26, armorMul: 3.0, criticalFrac: 0.6, killFrac: 0.3, meltdownSec: 3.5,
    blastProfile: 'capital', aoeRadiusMul: 6, aoeRadiusMin: 700, aoeDamageFrac: 0.45, aoeDamageMin: 60,
    hexDamage: 1400, hexRadius: 90, hexSpeed: 3500, shockRadiusMul: 0.4, shockDamage: 400, craterMul: 2.5
  })
});

export const CORE_DEFAULTS = Object.freeze({
  killMode: CORE_KILL_MODE.CONTAINMENT,
  // Ile martwych heksów komory = ODSŁONIĘTY. Jeden: dziura weszła w komorę.
  exposeMinHexes: 1,
  // Rdzeń oderwany z fragmentem: osłona rozerwana przy separacji, stopienie
  // krótsze niż na całym kadłubie.
  severMeltdownMul: 0.5,
  // Łańcuch: wybuch z głębokości >= maxChainDepth rani już tylko pulę HP
  // (bez krateru), więc nie odsłoni kolejnego rdzenia. 1 = jak dziś
  // (_critChainDepth: wybuch wywołany wybuchem nie ma AoE heksów).
  maxChainDepth: 1,
  chainFalloff: 0.6,
  // Jak długo po trafieniu falą stopienie liczy się jako „łańcuch” (s).
  chainWindowSec: 0.5,
  // Śmierć z puli HP (wyniszczenie) przy rdzeniu w tym stanie lub gorszym =
  // detonacja zamiast losowania. null = nigdy (tylko STOPIENIE detonuje).
  attritionDetonatesFrom: CORE_STATE.CRITICAL,
  // Wariant detonacji: null = losowanie z CORE_VARIANT_WEIGHTS klasy, albo id
  // z CORE_DETONATION_VARIANTS (shatter/halves/thirds/hole/jet/orb).
  detonationVariant: null
});

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

let _coreIdSeq = 0;
function nextCoreId() {
  _coreIdSeq = (_coreIdSeq + 1) | 0;
  return `core_${_coreIdSeq.toString(36)}`;
}

export function resolveCoreClassId(entityOrRadius) {
  const radius = typeof entityOrRadius === 'number'
    ? entityOrRadius
    : finite(entityOrRadius?.radius, 0);
  for (const tier of CORE_CLASS_BY_RADIUS) {
    if (radius >= tier.minRadius) return tier.id;
  }
  return 'escort';
}

export function getCoreClassProfile(classId) {
  return CORE_CLASS_PROFILES[classId] || CORE_CLASS_PROFILES.capital;
}

// ---------------------------------------------------------------------------
// Przestrzenie: PNG sprite'a → siatka heksów → lokalna → świat
// ---------------------------------------------------------------------------

// Skala układu PNG → siatka. Siatka ma rozmiar kanwy renderu zaokrąglony w górę
// do parzystego (initHexBody), a sprite jest na nią rozciągany (UV w hexShips3D
// = aGridPos / srcSize), więc to jest dokładne przeliczenie „piksel PNG → heks”.
// Skala hardpointów gry (renderW / pngW) różni się od niej najwyżej o 0,5 px.
export function computeCoreLayout(pngWidth, pngHeight, grid) {
  const pw = positive(pngWidth, 1);
  const ph = positive(pngHeight, 1);
  const gw = positive(grid?.srcWidth, pw);
  const gh = positive(grid?.srcHeight, ph);
  const x = gw / pw;
  const y = gh / ph;
  return { x, y, uniform: (x + y) * 0.5, pngWidth: pw, pngHeight: ph };
}

// Marker edytora może nieść dowolne pola — zachowujemy wszystkie znane, a nie
// tylko id/x/y (dzisiejsze normalizeEditorCore / compactMarker('core') gubią resztę).
export function normalizeCoreMarker(raw, index = 0) {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const out = { id: raw?.id ? String(raw.id) : `core_${index}`, x, y };
  const r = Number(raw?.r);
  if (Number.isFinite(r) && r > 0) out.r = r;
  const armorMul = Number(raw?.armorMul);
  if (Number.isFinite(armorMul) && armorMul > 0) out.armorMul = armorMul;
  if (raw?.profile && CORE_CLASS_PROFILES[raw.profile]) out.profile = raw.profile;
  const meltdownSec = Number(raw?.meltdownSec);
  if (Number.isFinite(meltdownSec) && meltdownSec > 0) out.meltdownSec = meltdownSec;
  if (raw?.color) out.color = String(raw.color);
  return out;
}

export function coreMarkerToGrid(marker, layout, grid) {
  const cx = finite(grid?.srcWidth, 0) * 0.5;
  const cy = finite(grid?.srcHeight, 0) * 0.5;
  return {
    gridX: finite(marker?.x) * layout.x + cx,
    gridY: finite(marker?.y) * layout.y + cy
  };
}

export function gridToCoreMarker(gridX, gridY, layout, grid) {
  const cx = finite(grid?.srcWidth, 0) * 0.5;
  const cy = finite(grid?.srcHeight, 0) * 0.5;
  return { x: (gridX - cx) / layout.x, y: (gridY - cy) / layout.y };
}

function entityPosX(e) { return (e?.pos && typeof e.pos.x === 'number') ? e.pos.x : finite(e?.x); }
function entityPosY(e) { return (e?.pos && typeof e.pos.y === 'number') ? e.pos.y : finite(e?.y); }
function entityScaleX(e) {
  if (e?.visual && typeof e.visual.spriteScaleX === 'number') return e.visual.spriteScaleX;
  if (e?.visual && typeof e.visual.spriteScale === 'number') return e.visual.spriteScale;
  return 1;
}
function entityScaleY(e) {
  if (e?.visual && typeof e.visual.spriteScaleY === 'number') return e.visual.spriteScaleY;
  if (e?.visual && typeof e.visual.spriteScale === 'number') return e.visual.spriteScale;
  return 1;
}
function entitySpriteRotation(e) {
  if (e?.isPlayer) return 0;
  const r = (e?.visual && typeof e.visual.spriteRotation === 'number') ? e.visual.spriteRotation
    : (e?.capitalProfile && typeof e.capitalProfile.spriteRotation === 'number') ? e.capitalProfile.spriteRotation
      : (e?.profile && typeof e.profile.spriteRotation === 'number') ? e.profile.spriteRotation
        : 0;
  return Number.isFinite(r) ? r : 0;
}
function billboardOrientation(e) {
  return e?.isAsteroidHex === true || e?.visual?.preserveBillboardOrientation === true;
}

// Kąt i skala dokładnie jak w destruktorze (getEntityHexAngle, getFinalScaleX/Y,
// localDeltaToWorldX/Y) — sonda, krater i efekty muszą trafiać w te same heksy.
export function getEntityHexAngle(entity) {
  return finite(entity?.angle) + entitySpriteRotation(entity) + finite(DESTRUCTOR_CONFIG.visualRotationOffset);
}

export function gridToLocal(entity, gridX, gridY, out = {}) {
  const grid = entity?.hexGrid;
  out.x = gridX - finite(grid?.srcWidth) * 0.5 - finite(grid?.pivot?.x);
  out.y = gridY - finite(grid?.srcHeight) * 0.5 - finite(grid?.pivot?.y);
  return out;
}

export function localToWorld(entity, localX, localY, out = {}) {
  const ang = getEntityHexAngle(entity);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const lx = localX * entityScaleX(entity);
  const ly = localY * entityScaleY(entity);
  if (billboardOrientation(entity)) {
    out.x = entityPosX(entity) + lx * c + ly * s;
    out.y = entityPosY(entity) - lx * s + ly * c;
  } else {
    out.x = entityPosX(entity) + lx * c - ly * s;
    out.y = entityPosY(entity) + lx * s + ly * c;
  }
  return out;
}

export function worldToLocal(entity, worldX, worldY, out = {}) {
  const ang = getEntityHexAngle(entity);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const dx = worldX - entityPosX(entity);
  const dy = worldY - entityPosY(entity);
  if (billboardOrientation(entity)) {
    out.x = (dx * c - dy * s) / entityScaleX(entity);
    out.y = (dx * s + dy * c) / entityScaleY(entity);
  } else {
    out.x = (dx * c + dy * s) / entityScaleX(entity);
    out.y = (-dx * s + dy * c) / entityScaleY(entity);
  }
  return out;
}

const _tmpLocal = { x: 0, y: 0 };

export function getCoreLocal(core, out = {}) {
  return gridToLocal(core.host, core.gridX, core.gridY, out);
}

export function getCoreWorld(core, out = {}) {
  gridToLocal(core.host, core.gridX, core.gridY, _tmpLocal);
  return localToWorld(core.host, _tmpLocal.x, _tmpLocal.y, out);
}

// ---------------------------------------------------------------------------
// Komora: znakowanie i pancerz
// ---------------------------------------------------------------------------

function isShardAlive(shard) {
  return !!shard && shard.active === true && shard.isDebris !== true && !(shard.hp <= 0);
}

// Heks należy do siatki encji — ten sam test co _heatWoundRim w destruktorze:
// po podziale obiekt heksa ma nowy __meshIndex w siatce nowego właściciela.
export function isShardOnEntity(shard, entity) {
  const shards = entity?.hexGrid?.shards;
  if (!shards || !shard) return false;
  const idx = shard.__meshIndex;
  return shards[idx] === shard;
}

function restoreShardArmor(shard) {
  const base = Number(shard?.__coreArmorBase);
  if (!Number.isFinite(base) || base <= 0) return;
  const frac = shard.maxHp > 0 ? Math.max(0, shard.hp) / shard.maxHp : 1;
  shard.maxHp = base;
  shard.hp = Math.min(base, frac * base);
  delete shard.__coreArmorBase;
}

function applyShardArmor(shard, armorMul) {
  if (!(armorMul > 0)) return;
  const base = Number.isFinite(Number(shard.__coreArmorBase)) ? Number(shard.__coreArmorBase) : shard.maxHp;
  const frac = shard.maxHp > 0 ? Math.max(0, shard.hp) / shard.maxHp : 1;
  shard.__coreArmorBase = base;
  shard.maxHp = base * armorMul;
  shard.hp = frac * shard.maxHp;
}

function buildCoreRuntime(entity, marker, index, options) {
  const grid = entity.hexGrid;
  const layout = options.layout;
  const classId = marker.profile || options.classId || resolveCoreClassId(entity);
  const profile = getCoreClassProfile(classId);
  const rPng = positive(marker.r, profile.chamberR / layout.uniform);
  const gridR = rPng * layout.uniform;
  const armorMul = positive(marker.armorMul, profile.armorMul);
  const pos = coreMarkerToGrid(marker, layout, grid);

  const core = {
    id: marker.id || `core_${index}`,
    uid: nextCoreId(),
    marker: { ...marker, r: rPng, armorMul },
    classId,
    profile,
    killMode: options.killMode,
    config: options.config,
    host: entity,
    origin: entity,
    gridX: pos.gridX,
    gridY: pos.gridY,
    gridR,
    armorMul,
    meltdownSec: positive(marker.meltdownSec, profile.meltdownSec),
    color: marker.color || options.color || null,
    // komora
    chamber: [],
    chamberGridX: null,
    chamberGridY: null,
    chamberMaxHp: null,
    chamberMaxHpSum: 0,
    chamberAlive: null,
    aliveCount: 0,
    deadCount: 0,
    elsewhereCount: 0,
    integrity: 1,
    invalid: null,
    // stan
    state: CORE_STATE.NOMINAL,
    stateTime: 0,
    stateEnteredAt: 0,
    exposedAt: -1,
    criticalAt: -1,
    meltdownAt: -1,
    meltdownDuration: 0,
    meltdownRemaining: 0,
    detonatedAt: -1,
    cause: null,
    chainDepth: 0,
    severed: false,
    probeTimer: 0,
    probeMisses: 0,
    probeSupported: true,
    lastProbe: null
  };

  const shards = grid.shards;
  const r2 = gridR * gridR;
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    if (!isShardAlive(s)) continue;
    // Pozycja startowa (spoczynkowa) — znakowanie raz, niezależne od chwilowej deformacji.
    const sx = Number.isFinite(s.origGridX) ? s.origGridX : s.gridX;
    const sy = Number.isFinite(s.origGridY) ? s.origGridY : s.gridY;
    const dx = sx - core.gridX;
    const dy = sy - core.gridY;
    if (dx * dx + dy * dy > r2) continue;
    if (s.__coreId && s.__coreId !== core.id) continue; // komory się nie nakładają
    core.chamber.push(s);
  }

  const n = core.chamber.length;
  core.chamberGridX = new Float32Array(n);
  core.chamberGridY = new Float32Array(n);
  core.chamberMaxHp = new Float32Array(n);
  core.chamberAlive = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = core.chamber[i];
    s.__coreId = core.id;
    s.__coreUid = core.uid;
    applyShardArmor(s, armorMul);
    core.chamberGridX[i] = Number.isFinite(s.origGridX) ? s.origGridX : s.gridX;
    core.chamberGridY[i] = Number.isFinite(s.origGridY) ? s.origGridY : s.gridY;
    core.chamberMaxHp[i] = s.maxHp;
    core.chamberMaxHpSum += s.maxHp;
    core.chamberAlive[i] = 1;
  }
  core.aliveCount = n;
  // Rdzeń bez ani jednego heksa komory leży poza obrysem (albo w dziurze
  // sprite'a). Dzisiejsza sonda gry uznałaby go za zniszczony po 0,16 s —
  // tak wygląda uśpiony błąd klucza `pirate_` (PORT, poprawka 2). Tu taki
  // rdzeń jest nieważny i nigdy nie zabija.
  if (n === 0) core.invalid = 'poza-kadłubem';
  return core;
}

/**
 * Montuje rdzenie na kadłubie heksowym (po initHexBody).
 * @param {object} entity  encja z hexGrid
 * @param {Array} markers  markery `cores[]` w przestrzeni PNG
 * @param {object} options { layout | pngWidth+pngHeight, classId?, killMode?, config?, color? }
 * @returns {Array} runtime rdzeni (także w entity.shipCores)
 */
export function attachShipCores(entity, markers, options = {}) {
  if (!entity?.hexGrid) return [];
  detachShipCores(entity);
  const layout = options.layout || computeCoreLayout(options.pngWidth, options.pngHeight, entity.hexGrid);
  const opts = {
    layout,
    classId: options.classId || null,
    killMode: options.killMode || CORE_DEFAULTS.killMode,
    config: { ...CORE_DEFAULTS, ...(options.config || {}) },
    color: options.color || null
  };
  const cores = [];
  const list = Array.isArray(markers) ? markers : [];
  for (let i = 0; i < list.length; i++) {
    const marker = normalizeCoreMarker(list[i], i);
    if (!marker) continue;
    cores.push(buildCoreRuntime(entity, marker, i, opts));
  }
  entity.shipCores = cores;
  entity.__coreLayout = layout;
  return cores;
}

// Zdjęcie pancerza i znaczników (edytor w demie przebudowuje komory na żywo).
export function detachShipCores(entity) {
  const cores = entity?.shipCores;
  if (!Array.isArray(cores)) return;
  for (const core of cores) {
    for (const s of core.chamber) {
      if (s.__coreUid !== core.uid) continue;
      restoreShardArmor(s);
      delete s.__coreId;
      delete s.__coreUid;
    }
  }
  entity.shipCores = [];
}

// ---------------------------------------------------------------------------
// Ocena komory i maszyna stanów
// ---------------------------------------------------------------------------

function sampleChamber(core) {
  const host = core.host;
  let alive = 0;
  let elsewhere = 0;
  let hpSum = 0;
  const chamber = core.chamber;
  for (let i = 0; i < chamber.length; i++) {
    const s = chamber[i];
    if (!isShardAlive(s)) {
      core.chamberAlive[i] = 0;
      continue;
    }
    if (!isShardOnEntity(s, host)) {
      core.chamberAlive[i] = 0;
      elsewhere++;
      continue;
    }
    core.chamberAlive[i] = 1;
    alive++;
    hpSum += Math.max(0, Math.min(s.hp, s.maxHp));
  }
  core.aliveCount = alive;
  core.elsewhereCount = elsewhere;
  core.deadCount = chamber.length - alive - elsewhere;
  core.integrity = core.chamberMaxHpSum > 0 ? Math.max(0, Math.min(1, hpSum / core.chamberMaxHpSum)) : 0;
}

const _probeWorld = { x: 0, y: 0 };

// Sonda jak isCoreHexSupported w index.html: 5 punktów (środek + 4 na promieniu
// coreProbeRadius × skala układu × skala encji), probeImpact = „jest heks”.
export function probeCoreSupport(core, probeFn = null) {
  const host = core.host;
  if (!host?.hexGrid) return false;
  const probe = probeFn || ((e, x, y) => DestructorSystem.probeImpact(e, x, y));
  const w = getCoreWorld(core, _probeWorld);
  const layout = core.host.__coreLayout || core.origin?.__coreLayout || { uniform: 1 };
  const r = CORE_PROBE_CONFIG.coreProbeRadius * layout.uniform * Math.max(entityScaleX(host), entityScaleY(host));
  const pts = core.lastProbe || (core.lastProbe = new Float32Array(10));
  pts[0] = w.x; pts[1] = w.y;
  pts[2] = w.x + r; pts[3] = w.y;
  pts[4] = w.x - r; pts[5] = w.y;
  pts[6] = w.x; pts[7] = w.y + r;
  pts[8] = w.x; pts[9] = w.y - r;
  for (let i = 0; i < 10; i += 2) {
    if (probe(host, pts[i], pts[i + 1])) return true;
  }
  return false;
}

function setState(core, next, time, events, extra = null) {
  const prev = core.state;
  if (prev === next) return;
  core.state = next;
  core.stateTime = 0;
  core.stateEnteredAt = time;
  if (next === CORE_STATE.EXPOSED && core.exposedAt < 0) core.exposedAt = time;
  if (next === CORE_STATE.CRITICAL && core.criticalAt < 0) core.criticalAt = time;
  if (events) events.push({ type: 'state', core, host: core.host, from: prev, to: next, time, ...(extra || {}) });
}

function beginMeltdown(core, time, cause, events, durationMul = 1) {
  if (coreStateRank(core.state) >= STATE_RANK.meltdown) return false;
  // STOPIENIE jest nieodwracalne, a stany pośrednie pokazujemy jako historię.
  if (core.exposedAt < 0) core.exposedAt = time;
  const host = core.host;
  const chain = host?.__coreChain;
  if (chain && time <= chain.until && (cause === 'containment' || cause === 'probe' || cause === 'attrition')) {
    core.chainDepth = chain.depth;
    core.cause = 'chain';
  } else {
    core.cause = cause;
  }
  core.meltdownAt = time;
  // Wariant znany od początku stopienia: obraz wybuchu startuje z wyprzedzeniem
  // (chargeTime reactorblow), a gra może zapowiadać wyrzut (strona wyrwy).
  core.pendingVariant = chooseCoreDetonationVariant(core, { time });
  core.meltdownDuration = Math.max(0.05, core.meltdownSec * durationMul);
  core.meltdownRemaining = core.meltdownDuration;
  setState(core, CORE_STATE.MELTDOWN, time, events, { cause: core.cause, duration: core.meltdownDuration, chainDepth: core.chainDepth });
  if (host) host.__coreDoomed = true;
  return true;
}

function detonate(core, time, events, reason) {
  if (core.state === CORE_STATE.DETONATED) return false;
  core.meltdownRemaining = 0;
  core.detonatedAt = time;
  const w = getCoreWorld(core, { x: 0, y: 0 });
  setState(core, CORE_STATE.DETONATED, time, null);
  if (events) {
    events.push({ type: 'state', core, host: core.host, from: CORE_STATE.MELTDOWN, to: CORE_STATE.DETONATED, time, reason });
    const variant = core.pendingVariant || chooseCoreDetonationVariant(core, { time });
    events.push({ type: 'detonate', core, host: core.host, x: w.x, y: w.y, time, reason, variant, blast: applyVariantToBlast(computeCoreBlast(core), variant) });
  }
  return true;
}

function findShardOwner(shard, candidates) {
  if (!Array.isArray(candidates)) return null;
  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];
    if (!e || e.dead || !e.hexGrid) continue;
    if (isShardOnEntity(shard, e)) return e;
  }
  return null;
}

// Rdzeń idzie za większością żywych heksów swojej komory. Jeśli ta większość
// siedzi na fragmencie, rdzeń przechodzi na wrak (wraz z odliczaniem krótszym
// o severMeltdownMul), a stary gospodarz traci zasilanie.
function handleSevering(core, time, ctx, events) {
  if (core.elsewhereCount <= core.aliveCount) return false;
  let best = null;
  let bestCount = 0;
  const counts = new Map();
  for (let i = 0; i < core.chamber.length; i++) {
    const s = core.chamber[i];
    if (!isShardAlive(s) || isShardOnEntity(s, core.host)) continue;
    const owner = findShardOwner(s, ctx?.entities);
    if (!owner) continue;
    const c = (counts.get(owner) || 0) + 1;
    counts.set(owner, c);
    if (c > bestCount) { bestCount = c; best = owner; }
  }
  if (!best || bestCount <= core.aliveCount) return false;
  const from = core.host;
  const idx = Array.isArray(from.shipCores) ? from.shipCores.indexOf(core) : -1;
  if (idx >= 0) from.shipCores.splice(idx, 1);
  core.host = best;
  core.severed = true;
  if (!Array.isArray(best.shipCores)) best.shipCores = [];
  best.shipCores.push(core);
  if (!best.__coreLayout) best.__coreLayout = from.__coreLayout;
  events.push({ type: 'severed', core, from, to: best, time });
  sampleChamber(core);
  beginMeltdown(core, time, 'severed', events, core.config?.severMeltdownMul ?? CORE_DEFAULTS.severMeltdownMul);
  const remaining = Array.isArray(from.shipCores)
    ? from.shipCores.filter((c) => c.state !== CORE_STATE.DETONATED && !c.invalid)
    : [];
  if (remaining.length === 0 && !from.__coreReactorLost) {
    from.__coreReactorLost = true;
    events.push({ type: 'reactorLost', host: from, core, time });
  }
  return true;
}

function evaluateCore(core, time, ctx, events) {
  if (core.invalid || coreStateRank(core.state) >= STATE_RANK.meltdown) {
    if (core.state === CORE_STATE.MELTDOWN) sampleChamber(core);
    return;
  }
  sampleChamber(core);
  if (handleSevering(core, time, ctx, events)) return;

  const cfg = core.config || CORE_DEFAULTS;
  const profile = core.profile;
  const exposeMin = Math.max(1, cfg.exposeMinHexes | 0);

  if (core.state === CORE_STATE.NOMINAL && core.deadCount >= exposeMin) {
    setState(core, CORE_STATE.EXPOSED, time, events);
  }
  // KRYTYCZNY = osłona pod progiem, także bez dziury (fala z sąsiedniego
  // wybuchu potrafi osłabić wszystkie heksy komory, nie zabijając żadnego).
  if (core.state !== CORE_STATE.CRITICAL && core.integrity < profile.criticalFrac) {
    setState(core, CORE_STATE.CRITICAL, time, events);
  }

  let kill = false;
  let cause = null;
  if (core.killMode === CORE_KILL_MODE.PROBE) {
    const supported = probeCoreSupport(core, ctx?.probe || null);
    core.probeSupported = supported;
    if (supported) core.probeMisses = 0;
    else core.probeMisses++;
    if (core.probeMisses >= CORE_PROBE_CONFIG.coreLostChecksToDestroy) { kill = true; cause = 'probe'; }
  } else if (core.integrity <= profile.killFrac) {
    kill = true;
    cause = 'containment';
  }
  if (kill) beginMeltdown(core, time, cause, events);
}

/**
 * Krok rdzeni encji. Wołać w pętli fizyki (np. co 3. podkrok z sumą dt,
 * jak updateHardpointIntegrity). Odliczanie stopienia jedzie co wywołanie,
 * ocena komory w kadencji CORE_PROBE_CONFIG.probeEverySec.
 * @param {object} entity
 * @param {number} dt
 * @param {object} ctx { time, entities (kandydaci na wrak przy odcięciu), probe?, events? }
 * @returns {Array} zdarzenia (state / severed / reactorLost / detonate)
 */
export function updateShipCores(entity, dt, ctx = {}) {
  const events = ctx.events || [];
  const cores = entity?.shipCores;
  if (!Array.isArray(cores) || cores.length === 0) return events;
  const time = finite(ctx.time, 0);
  const step = Math.max(0, finite(dt, 0));
  // Kopia: odcięty rdzeń wypada z tablicy w trakcie pętli.
  const list = cores.slice();
  for (const core of list) {
    if (core.host !== entity) continue;
    if (core.state === CORE_STATE.DETONATED) continue;
    core.stateTime += step;
    if (core.state === CORE_STATE.MELTDOWN) {
      core.meltdownRemaining -= step;
      if (core.meltdownRemaining <= 0) {
        detonate(core, time, events, 'meltdown');
        continue;
      }
    }
    core.probeTimer -= step;
    if (core.probeTimer > 0) continue;
    core.probeTimer = CORE_PROBE_CONFIG.probeEverySec;
    evaluateCore(core, time, ctx, events);
  }
  return events;
}

/**
 * Gospodarz zginął z innej przyczyny (pula HP, sufit heksów, AoE). Rdzeń
 * w STOPIENIU detonuje natychmiast; KRYTYCZNY (lub gorszy — attritionDetonatesFrom)
 * też, bo osłona już puszczała. Zwraca zdarzenia detonacji (puste = czysta śmierć,
 * decyzja o wraku / losowaniu zostaje po stronie gry).
 */
export function notifyCoreHostKilled(entity, time = 0, reason = 'attrition', events = []) {
  const cores = entity?.shipCores;
  if (!Array.isArray(cores)) return events;
  let fired = false;
  for (const core of cores) {
    if (fired || core.invalid || core.state === CORE_STATE.DETONATED || core.host !== entity) continue;
    const from = core.config?.attritionDetonatesFrom ?? CORE_DEFAULTS.attritionDetonatesFrom;
    const rank = coreStateRank(core.state);
    const threshold = from ? coreStateRank(from) : STATE_RANK.meltdown;
    if (rank < threshold) continue;
    if (core.state !== CORE_STATE.MELTDOWN) beginMeltdown(core, time, reason, events);
    detonate(core, time, events, reason);
    fired = true;
  }
  if (fired) consumeHostCores(entity, time);
  return events;
}

// Po detonacji jednego rdzenia kadłub przestaje istnieć — pozostałe rdzenie
// tego samego gospodarza znikają razem z nim (jeden wybuch na statek).
export function consumeHostCores(entity, time = 0) {
  const cores = entity?.shipCores;
  if (!Array.isArray(cores)) return;
  for (const core of cores) {
    if (core.host !== entity || core.state === CORE_STATE.DETONATED) continue;
    core.state = CORE_STATE.DETONATED;
    core.detonatedAt = time;
    core.cause = core.cause || 'consumed';
  }
}

// Wymuszenie stopienia (demo, testy, skrypty misji).
export function forceCoreMeltdown(core, time = 0, cause = 'forced', events = []) {
  beginMeltdown(core, time, cause, events);
  return events;
}

// Trafienie falą detonacji: jeśli w oknie chainWindowSec któryś rdzeń celu
// wejdzie w STOPIENIE, liczy się jako ogniwo łańcucha o głębokości depth.
export function markCoreChainExposure(entity, depth, time, windowSec = CORE_DEFAULTS.chainWindowSec) {
  if (!entity) return;
  const prev = entity.__coreChain;
  const until = time + Math.max(0, windowSec);
  if (prev && prev.until >= time && prev.depth <= depth) {
    prev.until = Math.max(prev.until, until);
    return;
  }
  entity.__coreChain = { depth, until };
}

// ---------------------------------------------------------------------------
// Wybuch: parametry, AoE, krater, rozpad
// ---------------------------------------------------------------------------

export function computeCoreBlast(core) {
  const host = core.host;
  const profile = core.profile;
  const cfg = core.config || CORE_DEFAULTS;
  const depth = core.chainDepth | 0;
  const falloff = Math.pow(finite(cfg.chainFalloff, 0.6), depth);
  const hostRadius = Math.max(40, finite(host?.radius, 40));
  const hostMaxHp = Math.max(1, finite(host?.maxHp, finite(host?.hull?.max, 1)));
  const allowHex = depth < Math.max(0, cfg.maxChainDepth | 0);
  const aoeRadius = Math.max(profile.aoeRadiusMin, hostRadius * profile.aoeRadiusMul);
  return {
    reactorProfile: profile.blastProfile,
    classId: core.classId,
    chainDepth: depth,
    aoeRadius,
    aoeDamage: Math.max(profile.aoeDamageMin, hostMaxHp * profile.aoeDamageFrac) * falloff,
    hexDamage: allowHex ? profile.hexDamage * falloff : 0,
    shockRadius: aoeRadius * profile.shockRadiusMul,
    shockDamage: allowHex ? profile.shockDamage * falloff * finite(cfg.shockMul, 1) : 0,
    hexRadius: profile.hexRadius,
    hexSpeed: profile.hexSpeed,
    craterRadius: core.gridR * profile.craterMul,
    visualSize: hostRadius * 1.5 * 1.8
  };
}

/**
 * Fala na komory sąsiadów: każdy żywy heks komory rdzenia w promieniu
 * shockRadius traci shockDamage × (1 − d/shockRadius) HP (d = odległość wybuchu
 * od RDZENIA). Zabite heksy idą przez destroyShard, więc to prawdziwe dziury —
 * przez nie prześwieca żar sąsiada. Zwraca liczbę dotkniętych rdzeni.
 */
export function applyBlastCoreShock(blast, blastX, blastY, entities, source = null) {
  if (!(blast?.shockDamage > 0) || !(blast.shockRadius > 0) || !Array.isArray(entities)) return 0;
  let touched = 0;
  const w = { x: 0, y: 0 };
  for (const e of entities) {
    if (!e || e === source || e.dead || !Array.isArray(e.shipCores)) continue;
    for (const core of e.shipCores) {
      if (core.invalid || core.host !== e || coreStateRank(core.state) >= STATE_RANK.meltdown) continue;
      getCoreWorld(core, w);
      const d = Math.hypot(w.x - blastX, w.y - blastY);
      if (d >= blast.shockRadius) continue;
      const dmg = blast.shockDamage * (1 - d / blast.shockRadius);
      for (const s of core.chamber) {
        if (!isShardAlive(s) || !isShardOnEntity(s, e)) continue;
        s.hp -= dmg;
        if (s.hp <= 0) DestructorSystem.destroyShard(e, s);
      }
      core.probeTimer = 0; // ocena w najbliższym kroku, nie za 0,08 s
      touched++;
    }
  }
  return touched;
}

// Liniowy spadek jak applyAoeExplosionDamage w grze.
export function coreBlastFalloff(dist, radius) {
  if (!(radius > 0) || dist >= radius) return 0;
  return 1 - Math.max(0, dist) / radius;
}

/**
 * Punkt kadłuba celu zwrócony do wybuchu: pierwszy heks na odcinku od środka
 * wybuchu do środka celu (sweepImpact). Tam idzie krater applyImpact.
 */
export function findBlastFacingPoint(target, blastX, blastY) {
  if (!target?.hexGrid) return null;
  const hit = DestructorSystem.sweepImpact(target, blastX, blastY, entityPosX(target), entityPosY(target), 0);
  if (!hit) return null;
  return { x: hit.worldX, y: hit.worldY, shard: hit.hitShard };
}

/**
 * Krater od fali w kadłubie sąsiada. Zwraca true, gdy trafił w heks.
 * hexDamage skaluje się spadkiem odległości do punktu kadłuba.
 */
export function applyBlastHexDamage(target, blast, blastX, blastY) {
  if (!(blast?.hexDamage > 0)) return false;
  const point = findBlastFacingPoint(target, blastX, blastY);
  if (!point) return false;
  const dist = Math.hypot(point.x - blastX, point.y - blastY);
  const t = coreBlastFalloff(dist, blast.aoeRadius);
  if (t <= 0) return false;
  const dirX = point.x - blastX;
  const dirY = point.y - blastY;
  const len = Math.hypot(dirX, dirY) || 1;
  const speed = blast.hexSpeed * t;
  return DestructorSystem.applyImpact(
    target, point.x, point.y, blast.hexDamage * t,
    { x: dirX / len * speed, y: dirY / len * speed },
    { radius: Math.max(DESTRUCTOR_CONFIG.bendingRadius, blast.hexRadius * (0.5 + 0.5 * t)) }
  );
}

function makeRng(seed) {
  if (typeof seed === 'function') return seed;
  let s = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Warianty detonacji: jak pęka kadłub i dokąd idzie plazma z komory
// ---------------------------------------------------------------------------
//
// Plazma krąży w komorze jak torus w polu utrzymującym. Przy detonacji pole
// puszcza za każdym razem inaczej — stąd warianty (losowane z wag klasy albo
// wymuszone przez config.detonationVariant):
//   shatter — rozprysk: krater i 2–5 sektorów kątowych (dawny jedyny rozpad);
//   halves  — przełamanie: pęknięcie przez rdzeń, zwykle w poprzek kadłuba;
//             dwie połowy odchodzą od szczeliny i rozchylają się;
//   thirds  — rozerwanie: trzy pęknięcia co ~120° od rdzenia, trzy części;
//   hole    — wyrwa: duży poszarpany krater, kadłub zostaje jednym martwym
//             wrakiem z dziurą (odcięte wyspy odpadną w processSplits);
//   jet     — wyrzut: pole pęka z jednej strony, strumień plazmy wypala kanał
//             do krawędzi i bije dalej jak wiązka — rani, co spotka; odrzut
//             pcha kadłub w przeciwną stronę, wybuch w komorze słabszy;
//   orb     — kula plazmy: torus wypada z komory jako kula i topi wszystko,
//             przez co leci — najpierw własny kadłub, którym wychodzi, potem
//             każdy kadłub i wrak na drodze; wybucha po zapalniku liczonym od
//             wyjścia z kadłuba (tarcza zatrzymuje ją wybuchem).
// Kierunek wyrzutu i kuli jest losowy (coreExitDirection 'random'); tryb
// 'wound' — przez wyrwę komory — zostaje w options.exit planCoreBreakup.

// keepHost: kadłub zostaje (martwy wrak), bez fragmentów z planu.
// craterMul × krater klasy; aoeMul/hexMul — udział wybuchu w komorze (reszta
// energii idzie w strumień albo kulę). Obraz: blowShift — o ile klas mniejszy
// profil reactorblow (null = bez niego: błysk capital ×12 przez 1,2 s zakryłby
// strumień i start kuli; przełamanie, rozerwanie i wyrwa biorą najmniejszy
// profil (fighter): kolce escort/cruiser/capital przez pierwsze 0,3–0,5 s
// wybielały ekran i chowały pęknięcie — ich obraz niesie coreFx3D: rozbłysk,
// pierścień, iskry z puli gry, snopy z pęknięć), blowSizeMul × rozmiar; flashMul/ringMul × promień AoE
// — rozbłysk i pierścień plazmy z coreFx3D (0 = brak). secondaryChance — szansa
// na wybuchy wtórne (amunicja, paliwo) na tym, co zostało.
export const CORE_DETONATION_VARIANTS = Object.freeze({
  shatter: Object.freeze({ id: 'shatter', label: 'rozprysk', keepHost: false, craterMul: 1, aoeMul: 1, hexMul: 1, blowShift: 0, blowSizeMul: 1, flashMul: 0, ringMul: 0.45, secondaryChance: 0.55 }),
  halves: Object.freeze({ id: 'halves', label: 'przełamanie na pół', keepHost: false, craterMul: 0.55, aoeMul: 0.9, hexMul: 0.85, blowShift: -3, blowSizeMul: 0.7, flashMul: 0.26, ringMul: 0.4, secondaryChance: 0.5 }),
  thirds: Object.freeze({ id: 'thirds', label: 'rozerwanie na trzy', keepHost: false, craterMul: 0.7, aoeMul: 0.95, hexMul: 0.9, blowShift: -3, blowSizeMul: 0.7, flashMul: 0.26, ringMul: 0.4, secondaryChance: 0.5 }),
  hole: Object.freeze({ id: 'hole', label: 'wyrwa bez rozpadu', keepHost: true, craterMul: 1.5, aoeMul: 1.15, hexMul: 1, blowShift: -3, blowSizeMul: 0.9, flashMul: 0.3, ringMul: 0.6, secondaryChance: 0.7 }),
  jet: Object.freeze({ id: 'jet', label: 'wyrzut plazmy', keepHost: true, craterMul: 0.45, aoeMul: 0.55, hexMul: 0.6, blowShift: null, blowSizeMul: 0, flashMul: 0.14, ringMul: 0, secondaryChance: 0.35 }),
  orb: Object.freeze({ id: 'orb', label: 'kula plazmy', keepHost: true, craterMul: 0.35, aoeMul: 0.5, hexMul: 0.5, blowShift: null, blowSizeMul: 0, flashMul: 0.12, ringMul: 0.25, secondaryChance: 0.25 })
});
export const CORE_VARIANT_IDS = Object.freeze(Object.keys(CORE_DETONATION_VARIANTS));

// Wagi losowania na klasę. Eskorta nie ma torusa na tyle dużego, żeby wypadł.
export const CORE_VARIANT_WEIGHTS = Object.freeze({
  escort: Object.freeze({ shatter: 45, halves: 30, thirds: 0, hole: 15, jet: 10, orb: 0 }),
  cruiser: Object.freeze({ shatter: 28, halves: 24, thirds: 14, hole: 14, jet: 12, orb: 8 }),
  capital: Object.freeze({ shatter: 20, halves: 20, thirds: 16, hole: 14, jet: 16, orb: 14 })
});

// Strumień plazmy (wyrzut). lengthMul × promień AoE (min. JET_MIN_LENGTH),
// energia = energyMul × obrażenia AoE bazowego wybuchu rozłożone na czas
// trwania; hexDamage — krater applyImpact w trafionym kadłubie co `tick` s;
// recoil — odrzut kadłuba (j/s).
export const CORE_JET_PROFILES = Object.freeze({
  escort: Object.freeze({ lengthMul: 0.75, duration: 0.65, energyMul: 1.2, recoil: 200, widthMul: 0.9, hexDamage: 160, tick: 0.05 }),
  cruiser: Object.freeze({ lengthMul: 0.8, duration: 1.0, energyMul: 1.4, recoil: 140, widthMul: 1, hexDamage: 260, tick: 0.05 }),
  capital: Object.freeze({ lengthMul: 0.85, duration: 1.4, energyMul: 1.6, recoil: 90, widthMul: 1.1, hexDamage: 380, tick: 0.05 })
});
const JET_MIN_LENGTH = 500;

// Kula plazmy. Prędkość względem kadłuba (j/s); zapalnik (s) liczony od wyjścia
// z własnego kadłuba; promień × promień komory. Topi wszystko, przez co leci:
// heksy w promieniu kuli giną rozżarzone (meltRimHeat — żar brzegu kanału, jak
// _heatWoundRim w zderzeniu), kadłub dostaje meltDps puli HP, a w cudzym
// kadłubie kula grzęźnie (meltDrag, 1/s). Wybuch kuli = ułamki bazowego
// wybuchu rdzenia.
export const CORE_ORB_PROFILES = Object.freeze({
  escort: Object.freeze({ speedMin: 320, speedMax: 480, fuseMin: 0.8, fuseMax: 1.2, radiusMul: 0.9, aoeRadiusMul: 0.6, aoeDamageMul: 0.6, hexMul: 0.8, recoil: 90, profile: 'fighter', meltDps: 700, meltDrag: 1.4, meltRimHeat: 0.8 }),
  cruiser: Object.freeze({ speedMin: 280, speedMax: 420, fuseMin: 1.0, fuseMax: 1.6, radiusMul: 0.9, aoeRadiusMul: 0.65, aoeDamageMul: 0.6, hexMul: 0.8, recoil: 60, profile: 'escort', meltDps: 1100, meltDrag: 1.2, meltRimHeat: 0.82 }),
  capital: Object.freeze({ speedMin: 240, speedMax: 380, fuseMin: 1.2, fuseMax: 2.0, radiusMul: 0.9, aoeRadiusMul: 0.7, aoeDamageMul: 0.6, hexMul: 0.8, recoil: 45, profile: 'cruiser', meltDps: 1600, meltDrag: 1.0, meltRimHeat: 0.85 })
});
// Kula uwięziona we własnym kadłubie (nie wychodzi) wybucha najpóźniej po
// zapalniku + tyle sekund.
const ORB_TRAPPED_SEC = 3;
// Żar stopionego heksa i rozrzut kropli (j/s od środka kuli). Kropla z żarem 1
// świeci bielą (debrisHeatGlow) — setki takich w kanale zlewały się w plamę.
const ORB_DROP_HEAT = 0.7;
const ORB_DROP_SPEED_MIN = 60;
const ORB_DROP_SPEED_MAX = 180;

// Wybuchy wtórne: ile i kiedy (s po detonacji), krater każdego.
export const CORE_SECONDARY_PROFILES = Object.freeze({
  escort: Object.freeze({ countMin: 1, countMax: 2, delayMin: 0.2, delayMax: 1.0, hexDamage: 220, hexRadius: 22, size: 22, profile: 'fighter' }),
  cruiser: Object.freeze({ countMin: 2, countMax: 3, delayMin: 0.25, delayMax: 1.4, hexDamage: 320, hexRadius: 28, size: 34, profile: 'fighter' }),
  capital: Object.freeze({ countMin: 2, countMax: 5, delayMin: 0.3, delayMax: 1.8, hexDamage: 420, hexRadius: 34, size: 48, profile: 'fighter' })
});

const GRID_HEX_SPACING = Math.max(2, finite(DESTRUCTOR_CONFIG.gridDivisions, 5)) * 1.5;

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function lattice1(i, seed) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Gładki szum 1D (0–1) do poszarpanych krawędzi pęknięć i wyrw.
function smoothNoise1(t, seed) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return lattice1(i, seed) * (1 - u) + lattice1(i + 1, seed) * u;
}

/**
 * Wariant detonacji: wymuszony (options.force / core.config.detonationVariant)
 * albo losowany z wag klasy. Ogniwo łańcucha (chainDepth > 0) rzadziej daje
 * strumień i kulę, częściej wyrwę — bez kaskady wyrzutów przez całą flotę.
 */
export function chooseCoreDetonationVariant(core, options = {}) {
  const forced = options.force ?? core?.config?.detonationVariant ?? null;
  if (forced && CORE_DETONATION_VARIANTS[forced]) return forced;
  const seed = options.seed ?? ((hashString(String(core?.uid || '')) ^ Math.round(finite(options.time, 0) * 1000)) >>> 0);
  const rng = makeRng(options.rng ?? seed);
  const classId = core?.classId || 'capital';
  const base = options.weights || core?.config?.variantWeights || CORE_VARIANT_WEIGHTS[classId] || CORE_VARIANT_WEIGHTS.capital;
  const depth = core?.chainDepth | 0;
  let total = 0;
  const w = {};
  for (const id of CORE_VARIANT_IDS) {
    let v = Math.max(0, finite(base[id], 0));
    if (depth > 0) {
      if (id === 'jet' || id === 'orb') v *= 0.5;
      else if (id === 'hole') v *= 1.5;
    }
    w[id] = v;
    total += v;
  }
  if (!(total > 0)) return 'shatter';
  let r = rng() * total;
  for (const id of CORE_VARIANT_IDS) {
    r -= w[id];
    if (r < 0) return id;
  }
  return 'shatter';
}

/**
 * Wybuch w komorze po wariancie: ułamki AoE/krateru/obrazu. Wartości bazowe
 * zostają w base* — strumień i kula biorą z nich swoją część energii.
 */
const REACTOR_PROFILE_ORDER = Object.freeze(['fighter', 'escort', 'cruiser', 'capital']);

export function applyVariantToBlast(blast, variantId) {
  const v = CORE_DETONATION_VARIANTS[variantId] || CORE_DETONATION_VARIANTS.shatter;
  const baseProfile = blast.baseReactorProfile ?? blast.reactorProfile;
  let reactorProfile = null;
  if (v.blowShift !== null && v.blowShift !== undefined) {
    const pi = REACTOR_PROFILE_ORDER.indexOf(baseProfile);
    reactorProfile = pi < 0 ? baseProfile : REACTOR_PROFILE_ORDER[Math.max(0, Math.min(REACTOR_PROFILE_ORDER.length - 1, pi + v.blowShift))];
  }
  const baseRadius = blast.baseAoeRadius ?? blast.aoeRadius;
  return {
    ...blast,
    variant: v.id,
    reactorProfile,
    baseReactorProfile: baseProfile,
    flashRadius: baseRadius * finite(v.flashMul, 0),
    ringRadius: baseRadius * finite(v.ringMul, 0),
    baseAoeRadius: blast.baseAoeRadius ?? blast.aoeRadius,
    baseAoeDamage: blast.baseAoeDamage ?? blast.aoeDamage,
    baseHexDamage: blast.baseHexDamage ?? blast.hexDamage,
    baseShockDamage: blast.baseShockDamage ?? blast.shockDamage,
    baseVisualSize: blast.baseVisualSize ?? blast.visualSize,
    aoeDamage: blast.aoeDamage * v.aoeMul,
    hexDamage: blast.hexDamage * v.hexMul,
    shockDamage: blast.shockDamage * v.aoeMul,
    craterRadius: blast.craterRadius * v.craterMul,
    visualSize: (blast.baseVisualSize ?? blast.visualSize) * finite(v.blowSizeMul, 1)
  };
}

// Kierunek w siatce → świat (obrót jak localToWorld, bez skali).
export function gridDirToWorld(entity, dx, dy, out = {}) {
  const ang = getEntityHexAngle(entity);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  if (billboardOrientation(entity)) {
    out.x = dx * c + dy * s;
    out.y = -dx * s + dy * c;
  } else {
    out.x = dx * c - dy * s;
    out.y = dx * s + dy * c;
  }
  return out;
}

/**
 * Kierunek ucieczki plazmy w przestrzeni siatki. 'random' (domyślnie): dowolny
 * kąt. 'wound': przez wyrwę komory (średnia martwych heksów komory względem
 * rdzenia) z rozrzutem ±25°, a bez wyrwy (stopienie od fali) — w bok kadłuba,
 * prostopadle do osi dziób–rufa.
 */
export function coreExitDirection(core, rng = Math.random, out = {}, mode = 'random') {
  if (mode !== 'wound') {
    const a = rng() * Math.PI * 2;
    out.x = Math.cos(a);
    out.y = Math.sin(a);
    return out;
  }
  let sx = 0;
  let sy = 0;
  let n = 0;
  const alive = core.chamberAlive;
  for (let i = 0; i < core.chamber.length; i++) {
    if (alive && alive[i]) continue;
    if (!alive && isShardAlive(core.chamber[i])) continue;
    sx += core.chamberGridX[i] - core.gridX;
    sy += core.chamberGridY[i] - core.gridY;
    n++;
  }
  let a;
  if (n > 0 && Math.hypot(sx, sy) > 1e-3) a = Math.atan2(sy, sx) + (rng() - 0.5) * 0.87;
  else a = (rng() < 0.5 ? 1 : -1) * Math.PI * 0.5 + (rng() - 0.5) * 0.9;
  out.x = Math.cos(a);
  out.y = Math.sin(a);
  return out;
}

/**
 * Plan rozpadu kadłuba przy detonacji rdzenia — środek w RDZENIU, nie w środku
 * kadłuba (jak spawnReactorBlowBreakup w grze). options.mode = wariant
 * (CORE_DETONATION_VARIANTS, domyślnie shatter), options.seed — powtarzalność,
 * options.exit — 'random' | 'wound' (kierunek wyrzutu i kuli), options.exitDir
 * — wymuszony kierunek w siatce.
 * Zwraca {
 *   mode, keepHost,
 *   vaporize: shard[]          — heksy, które wyparowują (krater, pęknięcia, kanał),
 *   vaporizeDir: number[]      — po 3 liczby na heks: kierunek odrzutu w siatce
 *                                (0,0 = od rdzenia) i mnożnik prędkości,
 *   groups: shard[][]          — fragmenty (wraki), groupDirs: {x,y,spin,speedMul}[],
 *   leftovers: shard[]         — drobnica za mała na wrak (leci jak odłamki),
 *   edgeShards: shard[]        — żywe heksy przy wyparowanych (żar brzegu),
 *   cuts: {x,y,dx,dy,both}[]   — pęknięcia/kanał w siatce (iskry, FX),
 *   dirGridX/Y                 — kierunek strumienia/kuli (siatka),
 *   craterRadius, centerGridX/Y
 * }.
 */
export function planCoreBreakup(core, options = {}) {
  const mode = CORE_DETONATION_VARIANTS[options.mode] ? options.mode : 'shatter';
  const v = CORE_DETONATION_VARIANTS[mode];
  const host = core.host;
  const shards = host?.hexGrid?.shards || [];
  const rng = makeRng(options.rng ?? options.seed ?? 1);
  const noiseSeed = rng() * 1000;
  const cx = core.gridX;
  const cy = core.gridY;
  const hex = GRID_HEX_SPACING;
  const baseCrater = Math.max(0, finite(options.craterRadius, core.gridR * core.profile.craterMul));
  const plan = {
    mode, keepHost: v.keepHost,
    vaporize: [], vaporizeDir: [], groups: [], groupDirs: [], leftovers: [], edgeShards: [], cuts: [],
    dirGridX: 0, dirGridY: 0, craterRadius: 0, centerGridX: cx, centerGridY: cy
  };
  const alive = [];
  for (const s of shards) if (isShardAlive(s)) alive.push(s);
  const vapor = new Set();
  const vaporize = (s, dx, dy, speedMul) => {
    if (vapor.has(s)) return;
    vapor.add(s);
    plan.vaporize.push(s);
    plan.vaporizeDir.push(dx, dy, speedMul);
  };

  // Krater: okrągły, a w wyrwie poszarpany (promień zależny od kąta).
  let craterR = baseCrater * v.craterMul;
  if (mode === 'hole') craterR *= 0.9 + rng() * 0.2;
  const ph0 = rng() * 6.2832;
  const ph1 = rng() * 6.2832;
  const ph2 = rng() * 6.2832;
  plan.craterRadius = craterR;
  for (const s of alive) {
    const dx = s.gridX - cx;
    const dy = s.gridY - cy;
    let R = craterR;
    if (mode === 'hole') {
      const a = Math.atan2(dy, dx);
      R *= 1 + 0.2 * Math.sin(3 * a + ph0) + 0.1 * Math.sin(7 * a + ph1) + 0.06 * Math.sin(13 * a + ph2);
    }
    if (dx * dx + dy * dy <= R * R) vaporize(s, 0, 0, 1);
  }

  // Pęknięcie/kanał: heksy w paśmie wokół półprostej od rdzenia (both = prosta).
  // Szerokość faluje szumem, więc brzeg jest poszarpany jak rozdarta blacha.
  const carve = (ux, uy, both, halfWidth, speedMul, alongFling) => {
    plan.cuts.push({ x: cx, y: cy, dx: ux, dy: uy, both });
    for (const s of alive) {
      if (vapor.has(s)) continue;
      const dx = s.gridX - cx;
      const dy = s.gridY - cy;
      const t = dx * ux + dy * uy;
      if (!both && t < 0) continue;
      const d = -dx * uy + dy * ux;
      if (Math.abs(d) >= halfWidth(Math.abs(t))) continue;
      if (alongFling) vaporize(s, ux, uy, speedMul);
      else {
        const side = d >= 0 ? 1 : -1;
        vaporize(s, -uy * side, ux * side, speedMul);
      }
    }
  };
  const crackHalf = (t) => hex * (0.45 + 0.55 * smoothNoise1(t / (hex * 2.5), noiseSeed));

  const rest = () => alive.filter((s) => !vapor.has(s));
  const minGroup = Math.max(3, finite(options.minFragmentShards, 4) | 0);
  const pushBuckets = (buckets, dirs) => {
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length >= minGroup) {
        plan.groups.push(buckets[i]);
        plan.groupDirs.push(dirs ? dirs[i] : null);
      } else plan.leftovers.push(...buckets[i]);
    }
  };

  if (mode === 'shatter') {
    const remaining = rest();
    let groupCount = Math.max(1, finite(options.groups, 0) | 0);
    if (!(options.groups > 0)) {
      groupCount = 2;
      if (remaining.length >= 18) groupCount++;
      if (remaining.length >= 36) groupCount++;
      if (remaining.length >= 400) groupCount++;
      groupCount = Math.max(1, Math.min(groupCount, Math.floor(remaining.length / minGroup) || 1));
    }
    const offset = rng() * Math.PI * 2;
    const sector = (Math.PI * 2) / groupCount;
    const buckets = Array.from({ length: groupCount }, () => []);
    for (const s of remaining) {
      let a = Math.atan2(s.gridY - cy, s.gridX - cx) - offset;
      a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      buckets[Math.min(groupCount - 1, Math.floor(a / sector))].push(s);
    }
    pushBuckets(buckets, null);
  } else if (mode === 'halves') {
    // Zwykle w poprzek osi dziób–rufa (±26°), czasem pod dowolnym kątem.
    const phi = rng() < 0.7 ? Math.PI * 0.5 + (rng() - 0.5) * 0.9 : rng() * Math.PI;
    const lx = Math.cos(phi);
    const ly = Math.sin(phi);
    carve(lx, ly, true, crackHalf, 0.8, false);
    const nx = -ly;
    const ny = lx;
    const buckets = [[], []];
    for (const s of rest()) buckets[((s.gridX - cx) * nx + (s.gridY - cy) * ny) >= 0 ? 0 : 1].push(s);
    // Połowy odchodzą od szczeliny i rozchylają się (przeciwne obroty).
    const spin = (0.12 + rng() * 0.2) * (rng() < 0.5 ? 1 : -1);
    pushBuckets(buckets, [
      { x: nx, y: ny, spin, speedMul: 0.7 },
      { x: -nx, y: -ny, spin: -spin, speedMul: 0.7 }
    ]);
  } else if (mode === 'thirds') {
    const a0 = rng() * Math.PI * 2;
    const angles = [a0, a0 + 2.0944 + (rng() - 0.5) * 0.6, a0 + 4.1888 + (rng() - 0.5) * 0.6];
    for (const a of angles) carve(Math.cos(a), Math.sin(a), false, crackHalf, 0.8, false);
    const sorted = angles.map((a) => ((a % 6.2832) + 6.2832) % 6.2832).sort((p, q) => p - q);
    const buckets = [[], [], []];
    for (const s of rest()) {
      const a = ((Math.atan2(s.gridY - cy, s.gridX - cx) % 6.2832) + 6.2832) % 6.2832;
      let k = 2;
      if (a >= sorted[0] && a < sorted[1]) k = 0;
      else if (a >= sorted[1] && a < sorted[2]) k = 1;
      buckets[k].push(s);
    }
    const dirs = [0, 1, 2].map((k) => {
      const a = k < 2 ? (sorted[k] + sorted[k + 1]) * 0.5 : (sorted[2] + sorted[0] + 6.2832) * 0.5;
      return { x: Math.cos(a), y: Math.sin(a), spin: (rng() - 0.5) * 0.5, speedMul: 0.85 };
    });
    pushBuckets(buckets, dirs);
  } else if (mode === 'jet' || mode === 'orb') {
    // options.exitDir {x, y} (siatka) wymusza kierunek — testy i ujęcia dema
    const forced = options.exitDir;
    const fl = forced ? Math.hypot(finite(forced.x), finite(forced.y)) : 0;
    const dir = fl > 1e-9
      ? { x: finite(forced.x) / fl, y: finite(forced.y) / fl }
      : coreExitDirection(core, rng, {}, options.exit || 'random');
    plan.dirGridX = dir.x;
    plan.dirGridY = dir.y;
    // Strumień wypala kanał od razu; kula topi sobie drogę sama (stepPlasmaOrbs).
    if (mode === 'jet') {
      const width = core.gridR * 0.55;
      carve(dir.x, dir.y, false, (t) => width * (0.8 + 0.4 * smoothNoise1(t / (hex * 3), noiseSeed)), 1.6, true);
    }
  }
  // hole: sam krater, kadłub zostaje (brak grup).

  const edge = new Set();
  for (const s of plan.vaporize) {
    const nbs = s.neighbors;
    if (!Array.isArray(nbs)) continue;
    for (const n of nbs) if (n && !vapor.has(n) && isShardAlive(n)) edge.add(n);
  }
  plan.edgeShards = [...edge];
  return plan;
}

/**
 * Wykonanie planu na prawdziwym destruktorze. Zwraca { wrecks, keptHost, recoil }:
 * wyparowane heksy lecą jako odłamki (od rdzenia albo od szczeliny/w kanał),
 * grupy stają się wrakami (spawnWreckEntity) z pchnięciem, a przy keepHost
 * kadłub zostaje (do splitQueue — odcięte wyspy odpadną) z odrzutem od
 * strumienia/kuli. W node trzeba mieć atrapę document (pula kanw wraków).
 */
export function applyCoreDetonation(core, plan, entities, options = {}) {
  const host = core.host;
  const out = { wrecks: [], keptHost: null, recoil: null };
  if (!host?.hexGrid || !plan) return out;
  const rng = makeRng(options.rng ?? options.seed ?? 7);
  const kick = finite(options.kickSpeed, 240);
  const local = gridToLocal(host, core.gridX, core.gridY, {});
  const center = localToWorld(host, local.x, local.y, {});
  // Bez wektora destroyShard dałby odłamkom prędkość kadłuba — nieruchomy
  // półksiężyc wisiałby w miejscu wybuchu.
  const hostVx = finite(host.vel?.x ?? host.vx);
  const hostVy = finite(host.vel?.y ?? host.vy);
  const sl = {};
  const sw = {};
  const wd = {};
  const vel = { x: 0, y: 0 };
  const fling = (s, speedMin, speedMax, gdx, gdy) => {
    let dx;
    let dy;
    if (gdx || gdy) {
      gridDirToWorld(host, gdx, gdy, wd);
      dx = wd.x;
      dy = wd.y;
    } else {
      gridToLocal(host, s.gridX, s.gridY, sl);
      localToWorld(host, sl.x, sl.y, sw);
      dx = sw.x - center.x;
      dy = sw.y - center.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-3) { dx /= d; dy /= d; } else {
        const a = rng() * Math.PI * 2;
        dx = Math.cos(a); dy = Math.sin(a);
      }
    }
    // rozrzut ±20°, żeby szczelina nie strzelała idealnym wachlarzem
    const j = (rng() - 0.5) * 0.7;
    const cj = Math.cos(j);
    const sj = Math.sin(j);
    const speed = speedMin + rng() * (speedMax - speedMin);
    vel.x = hostVx + (dx * cj - dy * sj) * speed;
    vel.y = hostVy + (dx * sj + dy * cj) * speed;
    DestructorSystem.destroyShard(host, s, vel);
  };
  const vaporMin = finite(options.vaporSpeedMin, kick * 2.5);
  const vaporMax = finite(options.vaporSpeedMax, kick * 5);
  const dirs = plan.vaporizeDir || [];
  for (let i = 0; i < plan.vaporize.length; i++) {
    const s = plan.vaporize[i];
    if (!isShardAlive(s)) continue;
    const m = dirs.length ? (dirs[i * 3 + 2] || 1) : 1;
    fling(s, vaporMin * m, vaporMax * m, dirs[i * 3] || 0, dirs[i * 3 + 1] || 0);
  }
  for (const s of plan.leftovers) {
    if (isShardAlive(s)) fling(s, kick, kick * 2, 0, 0);
  }

  if (plan.keepHost) {
    out.keptHost = host;
    if (!host.noSplit && Array.isArray(DestructorSystem.splitQueue) && DestructorSystem.splitQueue.indexOf(host) === -1) {
      DestructorSystem.splitQueue.push(host);
    }
    if ((plan.mode === 'jet' || plan.mode === 'orb') && (plan.dirGridX || plan.dirGridY)) {
      // Odrzut: przeciwnie do wyrzutu; moment od ramienia rdzenia względem środka.
      const prof = plan.mode === 'jet'
        ? (CORE_JET_PROFILES[core.classId] || CORE_JET_PROFILES.capital)
        : (CORE_ORB_PROFILES[core.classId] || CORE_ORB_PROFILES.capital);
      const recoil = finite(options.recoilSpeed, prof.recoil);
      gridDirToWorld(host, plan.dirGridX, plan.dirGridY, wd);
      const rvx = -wd.x * recoil;
      const rvy = -wd.y * recoil;
      host.vx = finite(host.vx) + rvx;
      host.vy = finite(host.vy) + rvy;
      if (host.vel) { host.vel.x = finite(host.vel.x) + rvx; host.vel.y = finite(host.vel.y) + rvy; }
      const torque = local.x * -plan.dirGridY - local.y * -plan.dirGridX;
      const spin = Math.max(-0.5, Math.min(0.5, torque * finite(options.recoilSpin, 0.0025)));
      host.angVel = finite(host.angVel) + spin;
      out.recoil = { x: rvx, y: rvy, spin };
    }
    return out;
  }

  for (let gi = 0; gi < plan.groups.length; gi++) {
    const live = plan.groups[gi].filter(isShardAlive);
    if (live.length < 3) continue;
    const wreck = DestructorSystem.spawnWreckEntity(host, live, entities);
    if (!wreck) continue;
    const gd = plan.groupDirs?.[gi] || null;
    let dx;
    let dy;
    if (gd) {
      gridDirToWorld(host, gd.x, gd.y, wd);
      dx = wd.x;
      dy = wd.y;
    } else {
      dx = entityPosX(wreck) - center.x;
      dy = entityPosY(wreck) - center.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
    }
    const radial = kick * (0.75 + rng() * 0.6) * (gd?.speedMul ?? 1);
    const tangential = (rng() - 0.5) * kick * (gd ? 0.25 : 0.6);
    wreck.vx = finite(wreck.vx) + dx * radial - dy * tangential;
    wreck.vy = finite(wreck.vy) + dy * radial + dx * tangential;
    wreck.angVel = finite(wreck.angVel) + (gd ? gd.spin : (rng() - 0.5) * 0.35);
    out.wrecks.push(wreck);
  }
  // spawnWreckEntity sam dopisuje wraki do `entities` (i window.wrecks, jeśli jest).
  return out;
}

// Zgodność wstecz: sam rozpad bez zagrożeń — zwraca listę wraków.
export function applyCoreBreakup(core, plan, entities, options = {}) {
  return applyCoreDetonation(core, plan, entities, options).wrecks;
}

// ---------------------------------------------------------------------------
// Zagrożenia po detonacji: strumień plazmy i kula plazmy (fizyka 2D)
// ---------------------------------------------------------------------------

const _jetO = { x: 0, y: 0 };
const _jetD = { x: 0, y: 0 };

/**
 * Strumień plazmy z wyrwy. Źródło i kierunek siedzą w układzie kadłuba, więc
 * odrzut i obrót wraku wodzą strumieniem po okolicy.
 */
export function createCoreJet(core, plan, blast) {
  const host = core.host;
  const prof = CORE_JET_PROFILES[core.classId] || CORE_JET_PROFILES.capital;
  const local = gridToLocal(host, core.gridX, core.gridY, {});
  const scale = Math.max(entityScaleX(host), entityScaleY(host));
  const baseAoe = finite(blast.baseAoeDamage, blast.aoeDamage);
  const baseRadius = finite(blast.baseAoeRadius, blast.aoeRadius);
  return {
    host,
    classId: core.classId,
    color: core.color || null,
    localX: local.x,
    localY: local.y,
    dirX: plan.dirGridX,
    dirY: plan.dirGridY,
    length: Math.max(JET_MIN_LENGTH, baseRadius * prof.lengthMul),
    width: Math.max(8, core.gridR * 2 * prof.widthMul * scale),
    duration: prof.duration,
    dps: baseAoe * prof.energyMul / prof.duration,
    hexDamage: finite(blast.hexDamage) > 0 ? prof.hexDamage : 0,
    tick: prof.tick,
    tickAcc: 0,
    chainDepth: blast.chainDepth | 0,
    age: 0,
    done: false,
    hits: 0,
    originX: 0, originY: 0, endX: 0, endY: 0, dirWX: 0, dirWY: 0,
    hitEntity: null
  };
}

// Obwiednia mocy strumienia: szybkie narastanie, ostatnie 30% gaśnie.
export function coreJetEnvelope(jet) {
  const t = jet.age;
  const d = Math.max(1e-3, jet.duration);
  const up = Math.min(1, t / 0.06);
  const down = t > d * 0.7 ? Math.max(0, 1 - (t - d * 0.7) / (d * 0.3)) : 1;
  return up * down;
}

/**
 * Krok strumienia: pierwszy kadłub na promieniu (sweepImpact) dostaje krater
 * applyImpact co `tick` i obrażenia puli przez ctx.hooks.hullDamage(entity,
 * dmg, 'core_jet'); ctx.hooks.blocksHexes(entity) = true (tarcza) wyłącza
 * krater. Zwraca false po wygaśnięciu. Sam gospodarz jest pomijany.
 */
export function stepCoreJet(jet, dt, entities, ctx = {}) {
  if (!jet || jet.done) return false;
  jet.age += Math.max(0, finite(dt, 0));
  if (jet.age >= jet.duration || !jet.host?.hexGrid) {
    jet.done = true;
    return false;
  }
  const host = jet.host;
  localToWorld(host, jet.localX, jet.localY, _jetO);
  gridDirToWorld(host, jet.dirX, jet.dirY, _jetD);
  const ox = _jetO.x;
  const oy = _jetO.y;
  const dx = _jetD.x;
  const dy = _jetD.y;
  const ex0 = ox + dx * jet.length;
  const ey0 = oy + dy * jet.length;
  let bestD = jet.length;
  let best = null;
  let bestHit = null;
  const list = Array.isArray(entities) ? entities : [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || e === host || !e.hexGrid || (e.dead && !e.isWreck)) continue;
    const rx = entityPosX(e) - ox;
    const ry = entityPosY(e) - oy;
    const t = rx * dx + ry * dy;
    const rad = Math.max(40, finite(e.radius, 40)) + jet.width;
    if (t < -rad || t > bestD + rad) continue;
    const px = rx - dx * t;
    const py = ry - dy * t;
    if (px * px + py * py > rad * rad) continue;
    const hit = DestructorSystem.sweepImpact(e, ox, oy, ex0, ey0, jet.width * 0.25);
    if (!hit) continue;
    const hd = Math.hypot(hit.worldX - ox, hit.worldY - oy);
    if (hd < bestD) { bestD = hd; best = e; bestHit = hit; }
  }
  jet.originX = ox;
  jet.originY = oy;
  jet.dirWX = dx;
  jet.dirWY = dy;
  jet.endX = ox + dx * bestD;
  jet.endY = oy + dy * bestD;
  jet.hitEntity = best;
  jet.tickAcc += dt;
  if (!best) {
    jet.tickAcc = Math.min(jet.tickAcc, jet.tick);
    return true;
  }
  if (jet.tickAcc < jet.tick) return true;
  const n = Math.floor(jet.tickAcc / jet.tick);
  jet.tickAcc -= n * jet.tick;
  const env = coreJetEnvelope(jet);
  // Tarcza trzyma ostrzał (także plazmę): heksów nie rusza, pulę bierze tarcza.
  const shielded = ctx.hooks?.blocksHexes?.(best) === true;
  if (jet.hexDamage > 0 && env > 0 && !shielded) {
    DestructorSystem.applyImpact(best, jet.endX, jet.endY, jet.hexDamage * n * env,
      { x: dx * 3000, y: dy * 3000 },
      { radius: Math.max(finite(DESTRUCTOR_CONFIG.bendingRadius, 24), jet.width * 0.6), shard: bestHit?.hitShard || null });
  }
  if (env > 0) ctx.hooks?.hullDamage?.(best, jet.dps * jet.tick * n * env, 'core_jet');
  markCoreChainExposure(best, (jet.chainDepth | 0) + 1, finite(ctx.time, 0));
  jet.hits += n;
  return true;
}

/**
 * Kula plazmy: torus wypadł przez wyrwę. Leci z prędkością kadłuba + wyrzut,
 * gospodarza ignoruje, dopóki go nie opuści, wybucha przy zetknięciu z innym
 * kadłubem albo po zapalniku. Wybuch kuli to osobny, mniejszy blast.
 */
export function createPlasmaOrb(core, plan, blast, options = {}) {
  const host = core.host;
  const prof = CORE_ORB_PROFILES[core.classId] || CORE_ORB_PROFILES.capital;
  const rng = makeRng(options.seed ?? 3);
  const w = getCoreWorld(core, {});
  const d = gridDirToWorld(host, plan.dirGridX, plan.dirGridY, {});
  const speed = prof.speedMin + rng() * (prof.speedMax - prof.speedMin);
  const hvx = finite(host.vel?.x ?? host.vx);
  const hvy = finite(host.vel?.y ?? host.vy);
  const scale = Math.max(entityScaleX(host), entityScaleY(host));
  const baseRadius = finite(blast.baseAoeRadius, blast.aoeRadius);
  const baseAoe = finite(blast.baseAoeDamage, blast.aoeDamage);
  const baseHex = finite(blast.baseHexDamage, blast.hexDamage);
  const baseShock = finite(blast.baseShockDamage, blast.shockDamage);
  const aoeRadius = baseRadius * prof.aoeRadiusMul;
  return {
    x: w.x, y: w.y, px: w.x, py: w.y,
    vx: hvx + d.x * speed,
    vy: hvy + d.y * speed,
    radius: Math.max(6, core.gridR * prof.radiusMul * scale),
    fuse: prof.fuseMin + rng() * (prof.fuseMax - prof.fuseMin),
    age: 0,
    host,
    left: false,
    classId: core.classId,
    color: core.color || null,
    spin: (rng() < 0.5 ? -1 : 1) * (5 + rng() * 4),
    detonated: false,
    // lot poza własnym kadłubem (zapalnik) i topienie
    flight: 0,
    chainDepth: blast.chainDepth | 0,
    meltDps: prof.meltDps,
    meltDrag: prof.meltDrag,
    meltRimHeat: prof.meltRimHeat,
    // dla efektu: heksy stopione od ostatniego odczytu (efekt zeruje), gdzie i w czym
    meltCount: 0,
    meltTotal: 0,
    meltEntity: null,
    meltX: 0,
    meltY: 0,
    splitAt: -1,
    blast: {
      ...blast,
      variant: 'orb-burst',
      reactorProfile: prof.profile,
      aoeRadius,
      aoeDamage: baseAoe * prof.aoeDamageMul,
      hexDamage: baseHex * prof.hexMul,
      shockRadius: aoeRadius * (core.profile?.shockRadiusMul ?? 0.4),
      shockDamage: baseShock * prof.aoeDamageMul,
      visualSize: finite(blast.baseVisualSize, blast.visualSize) * 0.55
    }
  };
}

// Siatka heksów jak w initHexBody: środek (c, r) = (c·HEX_SPACING, r·HEX_HEIGHT
// + pół wiersza w kolumnach nieparzystych).
const HEX_R_GRID = Math.max(1, finite(DESTRUCTOR_CONFIG.gridDivisions, 5));
const HEX_SPACING_GRID = HEX_R_GRID * 1.5;
const HEX_HEIGHT_GRID = Math.sqrt(3) * HEX_R_GRID;
const _meltShards = [];
const _meltLocal = { x: 0, y: 0 };
const _meltVel = { x: 0, y: 0 };

function heatClockSec() {
  return ((typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()) * 0.001;
}

// Żywe heksy siatki w kole (pozycja wizualna: gridX + wgniecenie). Okno komórek
// jak findBeamHexShard w destruktorze, poszerzone o dryf wgnieceń — bez tego
// wgniecione heksy wypadałyby z okna (heksy-duchy). Wynik w `out` (bez alokacji).
function collectHexesInDisc(grid, gx, gy, radius, out) {
  out.length = 0;
  const cells = grid?.grid;
  const cols = grid?.cols | 0;
  const rows = grid?.rows | 0;
  if (!cells || cols <= 0 || rows <= 0 || !(radius > 0)) return out;
  const reach = radius + getHexProbeDrift(grid);
  const c0 = Math.max(0, Math.floor((gx - reach) / HEX_SPACING_GRID));
  const c1 = Math.min(cols - 1, Math.ceil((gx + reach) / HEX_SPACING_GRID));
  const r0 = Math.max(0, Math.floor((gy - reach) / HEX_HEIGHT_GRID) - 1);
  const r1 = Math.min(rows - 1, Math.ceil((gy + reach) / HEX_HEIGHT_GRID));
  const r2 = radius * radius;
  const shards = grid.shards;
  for (let r = r0; r <= r1; r++) {
    const base = r * cols;
    for (let c = c0; c <= c1; c++) {
      const sh = cells[base + c];
      if (!isShardAlive(sh) || shards[sh.__meshIndex] !== sh) continue;
      const dx = sh.gridX + (sh.deformation?.x || 0) - gx;
      const dy = sh.gridY + (sh.deformation?.y || 0) - gy;
      if (dx * dx + dy * dy <= r2) out.push(sh);
    }
  }
  return out;
}

// Topienie w jednym kroku: heksy w promieniu kuli giną rozżarzone — brzeg kanału
// świeci mechanizmem destruktora (_heatWoundRim, kontekst = meltRimHeat), a
// odłamek GPU leci jako świecąca, stygnąca kropla (debrisHeatGlow), rozpryśnięta
// od kuli na boki.
function meltOrbInto(orb, e, time, hooks, step) {
  const grid = e.hexGrid;
  worldToLocal(e, orb.x, orb.y, _meltLocal);
  const gx = _meltLocal.x + finite(grid.srcWidth) * 0.5 + finite(grid.pivot?.x);
  const gy = _meltLocal.y + finite(grid.srcHeight) * 0.5 + finite(grid.pivot?.y);
  const rGrid = orb.radius / Math.max(1e-3, Math.max(entityScaleX(e), entityScaleY(e)));
  collectHexesInDisc(grid, gx, gy, rGrid, _meltShards);
  const n = _meltShards.length;
  if (n === 0) return 0;
  const now = heatClockSec();
  const evx = finite(e.vel?.x ?? e.vx);
  const evy = finite(e.vel?.y ?? e.vy);
  const prevCtx = DestructorSystem._woundHeatContext;
  DestructorSystem._woundHeatContext = orb.meltRimHeat;
  try {
    for (let i = 0; i < n; i++) {
      const sh = _meltShards[i];
      addShardHeat(sh, ORB_DROP_HEAT, now);
      // kropla: od środka kuli (w siatce) na boki + ułamek ruchu kuli
      const dx = sh.gridX - gx;
      const dy = sh.gridY - gy;
      const dl = Math.hypot(dx, dy);
      const a = dl > 1e-6 ? Math.atan2(dy, dx) + getEntityHexAngle(e) : Math.random() * Math.PI * 2;
      const sp = ORB_DROP_SPEED_MIN + Math.random() * (ORB_DROP_SPEED_MAX - ORB_DROP_SPEED_MIN);
      _meltVel.x = evx + (orb.vx - evx) * 0.1 + Math.cos(a) * sp;
      _meltVel.y = evy + (orb.vy - evy) * 0.1 + Math.sin(a) * sp;
      DestructorSystem.destroyShard(e, sh, _meltVel);
    }
  } finally {
    DestructorSystem._woundHeatContext = prevCtx;
  }
  _meltShards.length = 0;
  // Odcięte wyspy odpadną w processSplits — nie częściej niż co 0,12 s (flood fill).
  if (!e.noSplit && time - orb.splitAt >= 0.12 && Array.isArray(DestructorSystem.splitQueue) && DestructorSystem.splitQueue.indexOf(e) === -1) {
    DestructorSystem.splitQueue.push(e);
    orb.splitAt = time;
  }
  if (e !== orb.host) {
    hooks?.hullDamage?.(e, orb.meltDps * step, 'core_orb');
    markCoreChainExposure(e, (orb.chainDepth | 0) + 1, time);
  }
  orb.meltCount += n;
  orb.meltTotal += n;
  orb.meltEntity = e;
  orb.meltX = orb.x;
  orb.meltY = orb.y;
  return n;
}

/**
 * Krok kul: ruch, topienie wszystkiego w promieniu kuli (także własnego kadłuba,
 * którym wychodzi), zapalnik liczony od wyjścia z kadłuba. Tarcza trzyma plazmę
 * jak ostrzał (ctx.hooks.blocksHexes(entity) === true): kula wybucha na niej.
 * ctx.hooks.hullDamage(entity, dmg, 'core_orb') — pula HP topionych kadłubów.
 * Zwraca zdarzenia { type: 'orbDetonate', orb, x, y, hit, blast } (hit = kadłub
 * z tarczą albo null).
 */
export function stepPlasmaOrbs(orbs, dt, entities, ctx = {}) {
  const events = ctx.events || [];
  const step = Math.max(0, finite(dt, 0));
  const list = Array.isArray(entities) ? entities : [];
  const time = finite(ctx.time, 0);
  const hooks = ctx.hooks || null;
  for (const orb of orbs || []) {
    if (!orb || orb.detonated) continue;
    orb.age += step;
    orb.px = orb.x;
    orb.py = orb.y;
    orb.x += orb.vx * step;
    orb.y += orb.vy * step;
    const host = orb.host;
    if (!orb.left) {
      const r = Math.max(40, finite(host?.radius, 40)) + orb.radius;
      if (!host || !host.hexGrid || (host.dead && !host.isWreck) || Math.hypot(orb.x - entityPosX(host), orb.y - entityPosY(host)) > r) orb.left = true;
    }
    if (orb.left) orb.flight += step;
    let blocked = null;
    let bx = 0;
    let by = 0;
    let dragFrom = null;
    const travel = Math.hypot(orb.x - orb.px, orb.y - orb.py);
    for (let i = 0; i < list.length && !blocked; i++) {
      const e = list[i];
      if (!e || !e.hexGrid || (e.dead && !e.isWreck)) continue;
      const rad = Math.max(40, finite(e.radius, 40)) + orb.radius + travel;
      const ex = entityPosX(e) - orb.x;
      const ey = entityPosY(e) - orb.y;
      if (ex * ex + ey * ey > rad * rad) continue;
      if (e !== host && hooks?.blocksHexes?.(e) === true) {
        const hit = DestructorSystem.sweepImpact(e, orb.px, orb.py, orb.x, orb.y, orb.radius);
        if (hit) { blocked = e; bx = hit.worldX; by = hit.worldY; }
        continue;
      }
      if (meltOrbInto(orb, e, time, hooks, step) > 0 && e !== host) dragFrom = e;
    }
    if (dragFrom && orb.meltDrag > 0) {
      // Grzęźnie w cudzym kadłubie: prędkość względem niego gaśnie.
      const k = Math.exp(-orb.meltDrag * step);
      const evx = finite(dragFrom.vel?.x ?? dragFrom.vx);
      const evy = finite(dragFrom.vel?.y ?? dragFrom.vy);
      orb.vx = evx + (orb.vx - evx) * k;
      orb.vy = evy + (orb.vy - evy) * k;
    }
    if (blocked || orb.flight >= orb.fuse || orb.age >= orb.fuse + ORB_TRAPPED_SEC) {
      orb.detonated = true;
      // ostatnie cięcie kanału — wyspy odpadną w najbliższym processSplits
      if (orb.meltEntity && !orb.meltEntity.noSplit && Array.isArray(DestructorSystem.splitQueue) && DestructorSystem.splitQueue.indexOf(orb.meltEntity) === -1) {
        DestructorSystem.splitQueue.push(orb.meltEntity);
      }
      events.push({
        type: 'orbDetonate', orb, hit: blocked,
        x: blocked ? bx : orb.x, y: blocked ? by : orb.y,
        blast: orb.blast, time
      });
    }
  }
  return events;
}

// Czy wariant dostaje wybuchy wtórne (i ile) — losowane jednym ziarnem.
export function rollSecondaryBlasts(variantId, classId, rng = Math.random) {
  const v = CORE_DETONATION_VARIANTS[variantId] || CORE_DETONATION_VARIANTS.shatter;
  const prof = CORE_SECONDARY_PROFILES[classId] || CORE_SECONDARY_PROFILES.capital;
  const classMul = classId === 'escort' ? 0.4 : (classId === 'cruiser' ? 0.7 : 1);
  if (rng() >= v.secondaryChance * classMul) return 0;
  return prof.countMin + Math.floor(rng() * (prof.countMax - prof.countMin + 1));
}

/**
 * Wybuchy wtórne (amunicja, paliwo) na tym, co zostało z kadłuba: losowe żywe
 * heksy kawałków, chętniej przy świeżych krawędziach. Zwraca posortowaną listę
 * { entity, shard, delay, hexDamage, hexRadius, size, profile } — wołający
 * odpala je w czasie (heks mógł w międzyczasie przejść do innego wraku).
 */
export function planSecondaryBlasts(pieces, options = {}) {
  const rng = makeRng(options.rng ?? options.seed ?? 11);
  const prof = CORE_SECONDARY_PROFILES[options.classId] || CORE_SECONDARY_PROFILES.capital;
  const count = Math.max(0, finite(options.count, 0) | 0);
  const cands = (pieces || []).filter((e) => e?.hexGrid?.shards?.length);
  const out = [];
  if (!cands.length || count <= 0) return out;
  const edges = Array.isArray(options.edgeShards) ? options.edgeShards : null;
  for (let k = 0; k < count; k++) {
    const e = cands[Math.floor(rng() * cands.length)];
    const shards = e.hexGrid.shards;
    let pick = null;
    if (edges && edges.length && rng() < 0.6) {
      for (let t = 0; t < 10 && !pick; t++) {
        const c = edges[Math.floor(rng() * edges.length)];
        if (isShardAlive(c) && isShardOnEntity(c, e)) pick = c;
      }
    }
    for (let t = 0; t < 16 && !pick; t++) {
      const c = shards[Math.floor(rng() * shards.length)];
      if (isShardAlive(c)) pick = c;
    }
    if (!pick) continue;
    out.push({
      entity: e, shard: pick,
      delay: prof.delayMin + rng() * (prof.delayMax - prof.delayMin),
      hexDamage: prof.hexDamage, hexRadius: prof.hexRadius, size: prof.size * (0.75 + rng() * 0.5), profile: prof.profile
    });
  }
  out.sort((a, b) => a.delay - b.delay);
  return out;
}

/**
 * Pozycja heksa w świecie u obecnego właściciela (po podziałach heks mógł
 * przejść do innego wraku). Zwraca { entity, x, y } albo null.
 */
export function locateShard(shard, candidates, out = {}) {
  const owner = isShardAlive(shard) ? findShardOwner(shard, candidates) : null;
  if (!owner) return null;
  gridToLocal(owner, shard.gridX, shard.gridY, _tmpLocal);
  localToWorld(owner, _tmpLocal.x, _tmpLocal.y, out);
  out.entity = owner;
  return out;
}

// ---------------------------------------------------------------------------
// Lock, podsumowanie, eksport
// ---------------------------------------------------------------------------

// Punkt locka „rdzeń” dla gracza i AI: najbardziej zagrożony żywy rdzeń
// (najwyższy stan, potem najniższa osłona). null = brak celu.
export function getCoreLockPoint(entity, out = {}) {
  const cores = entity?.shipCores;
  if (!Array.isArray(cores)) return null;
  let best = null;
  for (const core of cores) {
    if (core.invalid || core.state === CORE_STATE.DETONATED || core.host !== entity) continue;
    if (!best) { best = core; continue; }
    const rb = coreStateRank(best.state);
    const rc = coreStateRank(core.state);
    if (rc > rb || (rc === rb && core.integrity < best.integrity)) best = core;
  }
  if (!best) return null;
  getCoreWorld(best, out);
  out.core = best;
  return out;
}

export function summarizeCore(core) {
  return {
    id: core.id,
    state: core.state,
    label: CORE_STATE_LABEL[core.state] || core.state,
    classId: core.classId,
    integrity: core.integrity,
    chamber: core.chamber.length,
    alive: core.aliveCount,
    dead: core.deadCount,
    elsewhere: core.elsewhereCount,
    meltdownRemaining: core.state === CORE_STATE.MELTDOWN ? Math.max(0, core.meltdownRemaining) : 0,
    meltdownDuration: core.meltdownDuration,
    cause: core.cause,
    chainDepth: core.chainDepth,
    severed: core.severed,
    invalid: core.invalid,
    probeMisses: core.probeMisses
  };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

// Eksport do defaultów edytora: przestrzeń PNG, te same pola co marker.
export function exportCoreMarkers(markers) {
  const out = [];
  for (let i = 0; i < (markers || []).length; i++) {
    const m = normalizeCoreMarker(markers[i], i);
    if (!m) continue;
    const row = { id: m.id, x: round2(m.x), y: round2(m.y) };
    if (m.r) row.r = round2(m.r);
    if (m.armorMul) row.armorMul = round2(m.armorMul);
    if (m.profile) row.profile = m.profile;
    if (m.meltdownSec) row.meltdownSec = round2(m.meltdownSec);
    out.push(row);
  }
  return out;
}
