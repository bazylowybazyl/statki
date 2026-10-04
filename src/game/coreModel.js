// Model rdzenia statku (reaktora) NIEZALEŻNY od silnika kadłuba: stany i ich kolejność,
// profile klas, warianty detonacji z wagami, profile strumienia, kuli i wybuchów wtórnych,
// parametry wybuchu (computeCoreBlast), losowanie wariantu, obwiednia strumienia, eksport
// markerów edytora. Czysty moduł — bez DOM, three i silników.
//
// Wydzielony z src/game/shipCore.js (kadłuby heksowe, stare demo dema/rdzen-demo.html),
// który re-eksportuje te nazwy bez zmian; rdzeń na kadłubach belkowych (src/game/reactorCore.js,
// demo dema/rdzen-webgpu.html) bierze stąd te same liczby — jedno źródło balansu dla obu.

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

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

export const CORE_STATE_RANK = Object.freeze({ nominal: 0, exposed: 1, critical: 2, meltdown: 3, detonated: 4 });
const STATE_RANK = CORE_STATE_RANK;

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

// Liniowy spadek jak applyAoeExplosionDamage w grze.
export function coreBlastFalloff(dist, radius) {
  if (!(radius > 0) || dist >= radius) return 0;
  return 1 - Math.max(0, dist) / radius;
}

export function makeCoreRng(seed) {
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
export const JET_MIN_LENGTH = 500;

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
export const ORB_TRAPPED_SEC = 3;
// Żar stopionego heksa i rozrzut kropli (j/s od środka kuli). Kropla z żarem 1
// świeci bielą (debrisHeatGlow) — setki takich w kanale zlewały się w plamę.
export const ORB_DROP_HEAT = 0.7;
export const ORB_DROP_SPEED_MIN = 60;
export const ORB_DROP_SPEED_MAX = 180;

// Wybuchy wtórne: ile i kiedy (s po detonacji), krater każdego.
export const CORE_SECONDARY_PROFILES = Object.freeze({
  escort: Object.freeze({ countMin: 1, countMax: 2, delayMin: 0.2, delayMax: 1.0, hexDamage: 220, hexRadius: 22, size: 22, profile: 'fighter' }),
  cruiser: Object.freeze({ countMin: 2, countMax: 3, delayMin: 0.25, delayMax: 1.4, hexDamage: 320, hexRadius: 28, size: 34, profile: 'fighter' }),
  capital: Object.freeze({ countMin: 2, countMax: 5, delayMin: 0.3, delayMax: 1.8, hexDamage: 420, hexRadius: 34, size: 48, profile: 'fighter' })
});

export function hashCoreString(str) {
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
export function coreSmoothNoise1(t, seed) {
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
  const seed = options.seed ?? ((hashCoreString(String(core?.uid || '')) ^ Math.round(finite(options.time, 0) * 1000)) >>> 0);
  const rng = makeCoreRng(options.rng ?? seed);
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
export const REACTOR_PROFILE_ORDER = Object.freeze(['fighter', 'escort', 'cruiser', 'capital']);

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

// Obwiednia mocy strumienia: szybkie narastanie, ostatnie 30% gaśnie.
export function coreJetEnvelope(jet) {
  const t = jet.age;
  const d = Math.max(1e-3, jet.duration);
  const up = Math.min(1, t / 0.06);
  const down = t > d * 0.7 ? Math.max(0, 1 - (t - d * 0.7) / (d * 0.3)) : 1;
  return up * down;
}

// Czy wariant dostaje wybuchy wtórne (i ile) — losowane jednym ziarnem.
export function rollSecondaryBlasts(variantId, classId, rng = Math.random) {
  const v = CORE_DETONATION_VARIANTS[variantId] || CORE_DETONATION_VARIANTS.shatter;
  const prof = CORE_SECONDARY_PROFILES[classId] || CORE_SECONDARY_PROFILES.capital;
  const classMul = classId === 'escort' ? 0.4 : (classId === 'cruiser' ? 0.7 : 1);
  if (rng() >= v.secondaryChance * classMul) return 0;
  return prof.countMin + Math.floor(rng() * (prof.countMax - prof.countMin + 1));
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
