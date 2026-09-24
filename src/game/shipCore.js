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

import { DestructorSystem, DESTRUCTOR_CONFIG } from './destructor.js';

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
  attritionDetonatesFrom: CORE_STATE.CRITICAL
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
    events.push({ type: 'detonate', core, host: core.host, x: w.x, y: w.y, time, reason, blast: computeCoreBlast(core) });
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

/**
 * Plan rozpadu kadłuba przy detonacji rdzenia (odpowiednik spawnReactorBlowBreakup,
 * ale ze środkiem w RDZENIU, nie w środku kadłuba): heksy w promieniu krateru
 * wyparowują, reszta dzieli się na sektory kątowe wokół rdzenia.
 * Zwraca { vaporize: shard[], groups: shard[][], centerGridX, centerGridY }.
 */
export function planCoreBreakup(core, options = {}) {
  const host = core.host;
  const shards = host?.hexGrid?.shards || [];
  const rng = makeRng(options.rng ?? options.seed ?? 1);
  const craterR = Math.max(0, finite(options.craterRadius, core.gridR * core.profile.craterMul));
  const cr2 = craterR * craterR;
  const alive = [];
  const vaporize = [];
  for (const s of shards) {
    if (!isShardAlive(s)) continue;
    const dx = s.gridX - core.gridX;
    const dy = s.gridY - core.gridY;
    if (dx * dx + dy * dy <= cr2) vaporize.push(s);
    else alive.push(s);
  }
  const minGroup = Math.max(3, finite(options.minFragmentShards, 4) | 0);
  let groupCount = Math.max(1, finite(options.groups, 0) | 0);
  if (!(options.groups > 0)) {
    groupCount = 2;
    if (alive.length >= 18) groupCount++;
    if (alive.length >= 36) groupCount++;
    if (alive.length >= 400) groupCount++;
    groupCount = Math.max(1, Math.min(groupCount, Math.floor(alive.length / minGroup) || 1));
  }
  const offset = rng() * Math.PI * 2;
  const sector = (Math.PI * 2) / groupCount;
  const buckets = Array.from({ length: groupCount }, () => []);
  for (const s of alive) {
    let a = Math.atan2(s.gridY - core.gridY, s.gridX - core.gridX) - offset;
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    buckets[Math.min(groupCount - 1, Math.floor(a / sector))].push(s);
  }
  const groups = [];
  const leftovers = [];
  for (const b of buckets) {
    if (b.length >= minGroup) groups.push(b);
    else leftovers.push(...b);
  }
  return { vaporize, groups, leftovers, centerGridX: core.gridX, centerGridY: core.gridY };
}

/**
 * Wykonanie planu na prawdziwym destruktorze: wyparowanie krateru (destroyShard),
 * fragmenty przez spawnWreckEntity z pchnięciem od rdzenia. Zwraca nowe wraki.
 * Uwaga: spawnWreckEntity bierze kanwę z puli wraków (document.createElement,
 * gdy pula pusta) — w node trzeba mieć atrapę document.
 */
export function applyCoreBreakup(core, plan, entities, options = {}) {
  const host = core.host;
  if (!host?.hexGrid || !plan) return [];
  const rng = makeRng(options.rng ?? options.seed ?? 7);
  const kick = finite(options.kickSpeed, 240);
  const local = gridToLocal(host, core.gridX, core.gridY, {});
  const center = localToWorld(host, local.x, local.y, {});
  // Heksy krateru i drobnica lecą jako odłamki OD rdzenia. destroyShard bez
  // wektora dałby im prędkość kadłuba — nieruchomy półksiężyc odłamków
  // wisiałby w miejscu wybuchu (widać na zrzucie detonacji).
  const hostVx = finite(host.vel?.x ?? host.vx);
  const hostVy = finite(host.vel?.y ?? host.vy);
  const sl = {};
  const sw = {};
  const vel = { x: 0, y: 0 };
  const fling = (s, speedMin, speedMax) => {
    gridToLocal(host, s.gridX, s.gridY, sl);
    localToWorld(host, sl.x, sl.y, sw);
    let dx = sw.x - center.x;
    let dy = sw.y - center.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-3) { dx /= d; dy /= d; } else {
      const a = rng() * Math.PI * 2;
      dx = Math.cos(a); dy = Math.sin(a);
    }
    const speed = speedMin + rng() * (speedMax - speedMin);
    vel.x = hostVx + dx * speed;
    vel.y = hostVy + dy * speed;
    DestructorSystem.destroyShard(host, s, vel);
  };
  const vaporMin = finite(options.vaporSpeedMin, kick * 2.5);
  const vaporMax = finite(options.vaporSpeedMax, kick * 5);
  for (const s of plan.vaporize) {
    if (isShardAlive(s)) fling(s, vaporMin, vaporMax);
  }
  for (const s of plan.leftovers) {
    if (isShardAlive(s)) fling(s, kick, kick * 2);
  }
  const wrecks = [];
  for (const group of plan.groups) {
    const live = group.filter(isShardAlive);
    if (live.length < 3) continue;
    const wreck = DestructorSystem.spawnWreckEntity(host, live, entities);
    if (!wreck) continue;
    const dx = entityPosX(wreck) - center.x;
    const dy = entityPosY(wreck) - center.y;
    const d = Math.hypot(dx, dy) || 1;
    const radial = kick * (0.75 + rng() * 0.6);
    const tangential = (rng() - 0.5) * kick * 0.6;
    wreck.vx = finite(wreck.vx) + dx / d * radial - dy / d * tangential;
    wreck.vy = finite(wreck.vy) + dy / d * radial + dx / d * tangential;
    wreck.angVel = finite(wreck.angVel) + (rng() - 0.5) * 0.35;
    wrecks.push(wreck);
  }
  // spawnWreckEntity sam dopisuje wraki do `entities` (i window.wrecks, jeśli jest).
  return wrecks;
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
