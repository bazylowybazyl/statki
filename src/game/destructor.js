/**
 * Hybrid hex destruction engine ported from
 * destruktorhybridclaude_crushfix_edgefix_perf_flickerfix.html.
 */

import { DestructorGpuSoftBody } from './destructorGpuSoftBody.js';
import { getHexContactGrid, findHexContact, getHexShardDrift } from './hexContactGrid.js';
import { areTowBodiesCollisionDisabled } from './towSystem.js';
import { transferSalvageToWreck, clearSalvage } from './salvage.js';
import { CollisionFX, impactEvent as _impactEvent, grindEvent as _grindEvent } from '../vfx/collisionFx.js';
import { ticksAt120 } from './stepDecay.js';
import {
  attachHexGridToArena,
  getHexArenaStats as getPackedHexArenaStats,
  getPackedCollisionBody,
  getPackedShardRef,
  isPackedShardBoundary,
  rebuildHexGridArena,
  releaseHexGridArena,
  releaseInactiveHexShards,
  setPackedShardActive
} from './hexArenaBridge.js';

const _ZERO_VEL = Object.freeze({ x: 0, y: 0 });
const DEFAULT_CONTACT_DAMAGE_SCALE = 0.18;

export const DESTRUCTOR_CONFIG = {
  gridDivisions: 5, //
  packedHexArena: 1,
  edgeCollision: 1,
  shardMass: 10.0, //
  visualRotationOffset: 0, //
  shardHP: 80, //
  inflictedDamageMult: 1.0, //
  maxDeform: 100.0,            // Max deformacja (px)
  tearThreshold: 34.0, //
  yieldPoint: 22.0, //
  deformMul: 0.45, //
  bendingRadius: 24.0, //
  softBodyTension: 0.14,       // Propagacja k
  gpuPropagationDamping: 0.96, //
  recoverSpeed: 1.0, //
  repairRate: 100, //
  visualLerpSpeed: 14.0, //
  elasticSleepFrames: 30,      // Klatki ciszy zanim grid zasypia (brak symulacji)
  elasticSleepThreshold: 0.15, //
  elasticSleepVelocityThreshold: 0.03, //
  elasticSleepSnapThreshold: 0.04, //
  elasticWakeFrames: 20,       // Force-awake po uderzeniu (zapobiega przedwczesnemu zasypianiu)
  // === MODEL ZDERZEŃ ===
  // Impuls z restytucji, deformacja i uszkodzenia warstwy kontaktowej.
  // Przy przewadze masy kadłub ustępuje płynnie ze wzrostem prędkości;
  // nie przełączamy trybu kolizji na sztywnym progu masy lub prędkości.
  restitution: 0.05,                  // sprężystość odbicia (0 = zderzenie idealnie plastyczne)
  frictionCoeff: 0.5,                 // µ — sufit impulsu stycznego względem normalnego
  tangentImpulseScale: 0.8,           // ile impulsu stycznego faktycznie trafia w ciała
  separationPercent: 0.9,             // ułamek korekty penetracji (pełna przy ścianie/głębokim zanurzeniu)
  crushMinSpeed: 12.0,                // podłoga WYDAJNOŚCIOWA: poniżej tej prędkości zbliżania
  //                                     wgniecenie byłoby subpikselowe — pomijamy pętlę kontaktów
  crushImpulseScale: 0.25,            // prędkość zbliżania → energia zgniotu
  //                                     (przy 0.25 pasmo 0-230 u/s rozdziela się na
  //                                     realne głębokości; wyżej materiał jest wysycony)
  crushDeformScale: 1.0,              // energia zgniotu → deformacja heksów
  contactDamageScale: DEFAULT_CONTACT_DAMAGE_SCALE, // deformacja → obrażenia heksa
  ramYieldSpeed: 80.0,               // skala płynnego ustępowania lżejszego kadłuba (u/s)
  contactDamageCapFrac: 1.5,          // BEZPIECZNIK obrażeń heksa na tick (× jego HP).
  //                                     Nie jest regulatorem siły: przy 0.25 prędkość
  //                                     przestawała mieć znaczenie dla zniszczeń, bo
  //                                     sufit wiązał zawsze. Ma ciąć tylko wystrzały
  //                                     numeryczne — resztę robi energia uderzenia.
  // Ile kontaktow tworzy PELNA plame styku. Przy taranie 400-1500 u/s i kroku
  // 1/120 kadluby zanurzaja sie w siebie o mniej niz jeden heks, wiec narrowphase
  // znajduje 1 kontakt (budzet to 24-32, to NIE jest limit). Caly impuls dziala
  // wtedy w jednym punkcie poza srodkiem masy i zamienia sie w moment obrotowy.
  // Pomiar: fregata (10k) rozkrecana do 5.65 rad/s, pancernik (50k) do 1.44 —
  // stosunek 3.9x, zgodny z modelem (16.8x odwrotnej bezwladnosci / 5x mniejszy
  // impuls). Lekki kadlub koziolkuje i stacza sie z dziobu, zanim zdazy sie
  // zemlec. Jeden kontakt to artefakt dyskretyzacji, nie fizyka — prawdziwy
  // taran dziobem ma szeroki styk. Tlumimy wiec czlon KATOWY proporcjonalnie do
  // jakosci probki; przy szerokim styku nic sie nie zmienia.
  contactPatchFullCount: 4,

  // Nadmiar obrazen ponad sufit heksa nie moze znikac. Bez tego jeden kontakt to
  // zawsze DOKLADNIE jeden zniszczony heks i taran przy 1500 u/s robi to samo co
  // przy 500 — predkosc przestaje cokolwiek znaczyc. Nadmiar idzie w promieniste
  // rozejscie sie uszkodzen (ta sama sciezka co pociski), wiec szybszy taran
  // wybija SZERSZA dziure, a nie glebsza w tej samej komorce.
  ramOverkillMinDamage: 25.0,
  ramOverkillRadiusScale: 1.6,
  ramOverkillMaxRadius: 180.0,

  shearK: 0.06, //

  // Próg "szybkiej pary" — WYŁĄCZNIE wydajność: powyżej niego druga iteracja kolizji
  // jest pomijana, a budżet kontaktów przechodzi w tryb otarcia. Nie zmienia fizyki.
  fastPairSpeedThreshold: 200.0,

  collisionDeformScale: 1.15, //
  collisionSearchRadius: 5, //
  // Sufit dryfu (px siatki), który pokrywają okna sond trafień: probeImpact,
  // sweepImpact i raymarch wiązki (findBeamHexShard). Sondy szukają heksów po
  // komórkach POCZĄTKOWYCH, a wgnieciony heks stoi o `_maxHexDrift` dalej —
  // bez zapasu był „duchem”: pocisk i wiązka przelatywały przez wgniecenie.
  // 120 ≈ maxDeform × collisionDeformScale (dalej heks jest już urwany), więc
  // sufit tnie tylko koszt przy dryfie patologicznym. 0 = dawne okna bez zapasu.
  probeDriftCap: 120,
  collisionIterations: 2, //
  // Przebiegi poprawkowe (2.+) tylko dla par z ciałem ruszonym przez kontakt.
  // Wynik identyczny z pełnym przebiegiem; 0 = pełny przebieg (do porównań).
  collisionRefineMovedOnly: 1,
  // Sprężystość CPU tylko po liście heksów w ruchu (simulateElasticity).
  // Wynik identyczny z pełną iteracją; 0 = każdy heks co klatkę (do porównań).
  elasticActiveList: 1,
  broadphaseCellSize: 1200, //
  // Zapas w KOMORKACH doliczany do zmierzonego dryfu heksow przy wyborze searchR.
  // null = mechanizm WYLACZONY (searchR jak dotad). Liczba wlacza adaptacyjny
  // sufit: nietkniety kadlub schodzi z dysku 49-81 komorek na ~13.
  searchRDriftMargin: null,
  broadphaseMaxCandidates: 128, //

  splitForceThreshold: 50, //
  splitDamageThreshold: 200, //
  splitCheckInterval: 12, //
  splitMaxPerTick: 1, //
  splitTimeBudgetMs: 1.2, //
  splitDeferTicks: 8, //
  splitDeferSpeedThreshold: 140, //

  gpuSoftBody: 1, //
  // Kroki solvera sprężyn GPU na sekundę CZASU GRY (DestructorGpuSoftBody.tick).
  // Kernel całkuje prędkość na iterację bez dt, więc dispatch co klatkę renderu
  // wgniatał przy 144 FPS 2,4× szybciej niż przy 60. Poniżej tej częstotliwości
  // klatek: krok na klatkę jak dawniej. 0 = zawsze dispatch co klatkę.
  gpuSoftBodyHz: 60,
  gpuSoftBodyMinShards: 64, //
  gpuSoftBodyCrashShardThreshold: 1200, //
  gpuSoftBodyCrashIters: 1, //

  wreckSplitLinearResponse: 0.23, //
  wreckSplitOutwardKick: 0.010, //
  wreckSplitAngularResponse: 0.030, //
  wreckSplitMinAngularKick: 0.012, //
  fractureImpactMemory: 0.6,           // seconds; retain the cut direction until the budgeted split check
  wreckSplitImpactResponse: 0.16,      // fraction of local crush speed released at a fracture
  wreckSplitMaxAngularKick: 0.35,      // rad/s; heavy pieces peel away without spinning like confetti
  wreckSplitMaxFragments: 8,          // additional islands become pooled chips, not more physics bodies

  // === WARSTWA PREZENTACJI ZDERZEŃ (CollisionFX) ===
  // Nic tutaj nie wchodzi w model zderzeń: te liczby decydują wyłącznie o tym,
  // KIEDY leci zdarzenie i JAK MOCNO żarzy się blacha. Zerowanie któregokolwiek
  // gasi efekt, nie zmienia fizyki.
  //
  // Zderzenie ma mieć moment. Strumień identycznych ticków 120 Hz nie niesie
  // informacji "właśnie uderzyło" — stąd osobne zdarzenie pierwszego zetknięcia,
  // z progiem prędkości i cooldownem na parę.
  impactMinSpeed: 40.0,        // u/s; poniżej tego zbliżania zetknięcie to
  //                              dosunięcie się burtą, nie uderzenie
  impactCooldown: 1.5,         // s czasu SYMULACJI; odbicie i powrót w tym oknie
  //                              to wciąż to samo zderzenie, nie drugie uderzenie
  collisionFxDebug: 0,         // 1 = console.debug przy każdym onImpact

  // Iskry lecą z K punktów rozłożonych po szwie zamiast z jednego snopu w
  // centroidzie. Budżet iskier jest ten sam — dzielony, nie mnożony.
  seamSparkPoints: 6,          // 0/1 = dawny pojedynczy snop

  // === KANAŁ HEAT ===
  // Rozżarzenie heksa żyje NIEZALEŻNIE od deformacji: strefa zgniotu stygnie
  // przez kilka sekund także po tym, jak siatka zaśnie i po wypaleniu
  // plastycznym (aStress jest wtedy zerowy). Zanik liczy shader z (heat,
  // heatStamp) — CPU nie chodzi po shardach ani razu więcej niż dotąd.
  //
  // GDZIE ma świecić: na KADŁUBIE, na brzegu rany i na powierzchni tarcia.
  // Pierwsza wersja grzała tylko heksy z bufora kontaktów — a te przy taranie
  // giną w tym samym ticku i odlatują. Pomiar (taran w róg, 60 ticków): odłamki
  // średnio 0.97, brzeg rany 0.41, dziób taranującego 0. Świeciły odłamki,
  // a ocalała krawędź wyrwy była ledwie pomarańczowa. Stąd dwa źródła niżej:
  // żar brzegu rany (przy każdym zniszczonym heksie) i żar styku (tarcie).
  heatGain: 0.9,               // ułamek HP zdjęty w ticku → przyrost żaru (0-1)
  heatDecay: 0.35,             // 1/s; biały ~1 s, pomarańcz do ~2.3 s, wiśnia do ~5 s
  // Jasność BIAŁEGO żaru w HDR. Próg bloomu gry to 0.9 (bloomConfig.js), ACES
  // odbarwia do bieli powyżej ~1.5, przepalony biały rdzeń leży w 8-12. Reszta rampy
  // spada ~h^4 (Stefan-Boltzmann), więc stygnący metal schodzi POD próg i zostaje
  // nasyconym pomarańczem/wiśnią zamiast szarej poświaty. Dawny `heatTint` (1.6)
  // dawał szczyt ledwie nad progiem — stąd "pomarańczowy obwód" zamiast żaru.
  heatGlowPeak: 9.0,           // 0 = kanał wyłączony

  // ŻAR BRZEGU RANY. Kiedy heks ginie, jego OCALALI sąsiedzi stają się nową
  // krawędzią wyrwy — to ona ma świecić, nie odlatujący kawałek. Pierścień 1
  // dostaje pełną wartość, pierścień 2 ułamek (strefa wpływu ciepła).
  woundHeat: 1.0,              // żar brzegu przy zniszczeniu w zderzeniu (0-1)
  woundHeatSpeed: 150.0,       // u/s zbliżania, przy której brzeg jest biały;
  //                              wolniejszy zgniot zostawia brzeg pomarańczowy
  woundHeatInherit: 0.85,      // ile własnego żaru ginący heks oddaje brzegowi —
  //                              tym żar idzie za frontem zgniotu i za rozdarciem
  //                              GPU, które zaczyna się w gorącej strefie
  woundHeatRing2: 0.55,        // pierścień 2 względem pierścienia 1

  // ŻAR STYKU (tarcie i zgniot powierzchni). Liczony z prędkości względnej
  // w punkcie styku, symetrycznie dla OBU kadłubów — dziób taranującego też
  // się rozgrzewa. Działa także wtedy, gdy zbliżanie jest poniżej crushMinSpeed
  // (czyste otarcie), bo to właśnie tarcie ma grzać.
  contactHeatRate: 3.0,        // żar/s przy contactHeatSpeed
  contactHeatSpeed: 120.0,     // u/s; poniżej tempo spada z KWADRATEM prędkości,
  //                              więc powolne dosunięcie burtą nie świeci

  // Odłamki świecą w paśmie BARWY (bez białego szczytu) — mają być tłem dla
  // żaru na kadłubie, nie głównym aktorem.
  debrisHeatGlow: 1.2,
  debrisHeatFloor: 0.25,       // metal urwany ROZCIĄGANIEM (GPU tear) nie ma
  //                              historii zgniotu — ma się żarzyć słabo, ale nie wcale
  heatFromProjectiles: 0,      // 1 = trafienia pociskami też grzeją blachę
};

// Prekomputowane stringi koloru stresu — unikamy template literal per shard w drawShape()
const STRESS_COLORS = Array.from({ length: 32 }, (_, i) => {
  const r = i / 31;
  return `rgba(255,${Math.floor(r * 100)},0,${(r * 0.6).toFixed(3)})`;
});

const HEX_R = DESTRUCTOR_CONFIG.gridDivisions;
const HEX_HEIGHT = Math.sqrt(3) * HEX_R;
const HEX_SPACING = HEX_R * 1.5;
const HIT_RAD = HEX_R * 1.3;
const BENDING_RAD_SQ = DESTRUCTOR_CONFIG.bendingRadius * DESTRUCTOR_CONFIG.bendingRadius;

const HEX_MASK_SAMPLE_OFFSETS = [
  [0.00, 0.00, 2.00],
  [-0.52, 0.00, 1.00],
  [0.52, 0.00, 1.00],
  [-0.26, -0.44, 0.90],
  [0.26, -0.44, 0.90],
  [-0.26, 0.44, 0.90],
  [0.26, 0.44, 0.90],
  [0.00, -0.62, 0.65],
  [0.00, 0.62, 0.65]
];

const HEX_MASK_VERTEX_DIRS = [
  [1.0, 0.0],
  [0.5, 0.8660254038],
  [-0.5, 0.8660254038],
  [-1.0, 0.0],
  [-0.5, -0.8660254038],
  [0.5, -0.8660254038]
];

const HEX_MASK_RAY_STEPS = [0.18, 0.34, 0.52, 0.70, 0.88, 1.04];

const WRECK_FULL_COLLISION_TIME = 2.5;
const WRECK_SLEEP_LINEAR_SPEED = 22.0;
const WRECK_SLEEP_ANGULAR_SPEED = 0.03;
const WRECK_SLEEP_SETTLE_TIME = 1.4;
const WRECK_WAKE_REL_SPEED = 70.0;
const WRECK_WAKE_OVERLAP_PAD = HEX_SPACING * 1.5;
// Kontakt budzi wrak tylko wtedy, gdy faktycznie go ruszył (patrz
// _wreckContactWakes): tyle zmiany prędkości albo przesunięcia w jednym kontakcie.
// Spoczynkowy styk (wrak pod zaparkowanym okrętem) zostaje poniżej obu progów.
const WRECK_CONTACT_WAKE_DV = 2.0;
const WRECK_CONTACT_WAKE_DP = 0.5;

function sampleHexMaskProfile(alphaData, width, height, centerX, centerY, radius, alphaThreshold, sampleThreshold) {
  let centerAlpha = 0;
  let maxAlpha = 0;
  let hitWeight = 0;
  let totalWeight = 0;
  const sampleRadius = radius * 0.92;

  for (let i = 0; i < HEX_MASK_SAMPLE_OFFSETS.length; i++) {
    const sample = HEX_MASK_SAMPLE_OFFSETS[i];
    const px = Math.max(0, Math.min(width - 1, Math.round(centerX + sample[0] * sampleRadius)));
    const py = Math.max(0, Math.min(height - 1, Math.round(centerY + sample[1] * sampleRadius)));
    const alpha = alphaData[(py * width + px) * 4 + 3];
    const weight = sample[2];

    if (i === 0) centerAlpha = alpha;
    if (alpha > maxAlpha) maxAlpha = alpha;
    totalWeight += weight;
    if (alpha > sampleThreshold) hitWeight += weight;
  }

  const coverage = totalWeight > 0 ? (hitWeight / totalWeight) : 0;
  const edgeMask = new Array(6);
  const rayThreshold = Math.max(4, alphaThreshold * 0.45);

  for (let i = 0; i < 6; i++) {
    const dir = HEX_MASK_VERTEX_DIRS[i];
    let support = 0.0;
    for (let s = 0; s < HEX_MASK_RAY_STEPS.length; s++) {
      const step = HEX_MASK_RAY_STEPS[s];
      const px = Math.max(0, Math.min(width - 1, Math.round(centerX + dir[0] * radius * step)));
      const py = Math.max(0, Math.min(height - 1, Math.round(centerY + dir[1] * radius * step)));
      const alpha = alphaData[(py * width + px) * 4 + 3];
      if (alpha > sampleThreshold) support = step;
      else if (alpha > rayThreshold) support = Math.max(support, step * 0.82);
    }
    const clampedSupport = Math.max(0.16, Math.min(1.0, support));
    edgeMask[i] = clampedSupport;
  }

  for (let i = 0; i < 6; i++) {
    const prev = edgeMask[(i + 5) % 6];
    const cur = edgeMask[i];
    const next = edgeMask[(i + 1) % 6];
    edgeMask[i] = Math.max(cur, Math.min(1.0, (prev + cur * 2 + next) * 0.25));
  }

  let smoothedMin = 1;
  let smoothedSum = 0;
  for (let i = 0; i < 6; i++) {
    const v = edgeMask[i];
    smoothedSum += v;
    if (v < smoothedMin) smoothedMin = v;
  }

  const radialCoverage = smoothedSum / 6;
  const finalCoverage = Math.max(coverage, Math.min(1, radialCoverage * 0.92));
  const keep = centerAlpha > alphaThreshold || finalCoverage >= 0.24 || (maxAlpha > alphaThreshold && finalCoverage >= 0.11);

  return {
    keep,
    coverage: finalCoverage,
    radialCoverage,
    edgeMask: smoothedMin >= 0.985 ? null : edgeMask
  };
}

function getShardMass(shard) {
  const mass = Number(shard?.mass);
  return Number.isFinite(mass) && mass > 0 ? mass : DESTRUCTOR_CONFIG.shardMass;
}

function sumShardMass(shards) {
  if (!Array.isArray(shards) || shards.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < shards.length; i++) total += getShardMass(shards[i]);
  return total;
}

function getShardHitRadius(shard) {
  const hitRadius = Number(shard?.hitRadius);
  return Number.isFinite(hitRadius) && hitRadius > 0 ? hitRadius : HIT_RAD;
}

function segmentCircleToi2D(x0, y0, x1, y1, cx, cy, radius) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const radiusSq = radius * radius;
  if (fx * fx + fy * fy <= radiusSq) return 0;
  const a = dx * dx + dy * dy;
  if (a <= 1e-12) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radiusSq;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return -1;
  const root = Math.sqrt(discriminant);
  const inv = 1 / (2 * a);
  const near = (-b - root) * inv;
  if (near >= 0 && near <= 1) return near;
  const far = (-b + root) * inv;
  return far >= 0 && far <= 1 ? far : -1;
}

function nowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

function markRingSegmentHot(entity, physicsHoldMs = 2500, visualHoldMs = physicsHoldMs) {
  if (!entity?.isRingSegment) return;
  const now = nowMs();
  const physicsUntil = now + Math.max(0, Number(physicsHoldMs) || 0);
  const visualUntil = now + Math.max(0, Number(visualHoldMs) || 0);
  const prevPhysics = Number(entity.__destructorHotUntilMs) || 0;
  const prevVisual = Number(entity.__ringVisualHotUntilMs) || 0;

  if (physicsUntil > prevPhysics) entity.__destructorHotUntilMs = physicsUntil;
  if (visualUntil > prevVisual) entity.__ringVisualHotUntilMs = visualUntil;
}

function resetGridMeshDirtyRange(grid) {
  if (!grid) return;
  grid.meshDirtyAll = false;
  grid.meshDirtyStart = -1;
  grid.meshDirtyEnd = -1;
}

function resetGridVisualDirtyRange(grid) {
  if (!grid) return;
  grid.visualDirtyAll = false;
  grid.visualDirtyStart = -1;
  grid.visualDirtyEnd = -1;
}

function bumpGridMeshRevision(grid) {
  if (!grid) return;
  const next = (Number(grid.meshRevision) || 0) + 1;
  grid.meshRevision = next > 1000000000 ? 1 : next;
}

function markGridVisualDirtyAll(grid) {
  if (!grid) return;
  const count = Array.isArray(grid.shards) ? grid.shards.length : 0;
  grid.visualDirtyAll = true;
  grid.visualDirtyStart = 0;
  grid.visualDirtyEnd = Math.max(0, count - 1);
}

function markGridVisualDirtyRange(grid, minIndex, maxIndex) {
  if (!grid) return;
  const count = Array.isArray(grid.shards) ? grid.shards.length : 0;
  if (count <= 0) {
    markGridVisualDirtyAll(grid);
    return;
  }

  const a = Number(minIndex);
  const b = Number(maxIndex);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    markGridVisualDirtyAll(grid);
    return;
  }

  let start = a | 0;
  let end = b | 0;
  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  if (start < 0 || end < 0 || start >= count || end >= count) {
    markGridVisualDirtyAll(grid);
    return;
  }

  if (grid.visualDirtyAll) return;
  const curStart = Number(grid.visualDirtyStart);
  const curEnd = Number(grid.visualDirtyEnd);
  if (!Number.isFinite(curStart) || !Number.isFinite(curEnd) || curStart < 0 || curEnd < curStart) {
    grid.visualDirtyStart = start;
    grid.visualDirtyEnd = end;
    return;
  }

  if (start < curStart) grid.visualDirtyStart = start;
  if (end > curEnd) grid.visualDirtyEnd = end;
}

function markGridMeshDirtyAll(grid) {
  if (!grid) return;
  grid.meshDirty = true;
  bumpGridMeshRevision(grid);
  const count = Array.isArray(grid.shards) ? grid.shards.length : 0;
  grid.meshDirtyAll = true;
  grid.meshDirtyStart = 0;
  grid.meshDirtyEnd = Math.max(0, count - 1);
  markGridVisualDirtyAll(grid);
}

function markGridMeshDirtyRange(grid, minIndex, maxIndex) {
  if (!grid) return;
  const count = Array.isArray(grid.shards) ? grid.shards.length : 0;
  if (count <= 0) {
    markGridMeshDirtyAll(grid);
    return;
  }
  const a = Number(minIndex);
  const b = Number(maxIndex);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    markGridMeshDirtyAll(grid);
    return;
  }
  let start = a | 0;
  let end = b | 0;
  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  if (start < 0 || end < 0 || start >= count || end >= count) {
    markGridMeshDirtyAll(grid);
    return;
  }
  grid.meshDirty = true;
  bumpGridMeshRevision(grid);
  markGridVisualDirtyRange(grid, start, end);
  if (grid.meshDirtyAll) return;
  const curStart = Number(grid.meshDirtyStart);
  const curEnd = Number(grid.meshDirtyEnd);
  if (!Number.isFinite(curStart) || !Number.isFinite(curEnd) || curStart < 0 || curEnd < curStart) {
    grid.meshDirtyStart = start;
    grid.meshDirtyEnd = end;
    return;
  }
  if (start < curStart) grid.meshDirtyStart = start;
  if (end > curEnd) grid.meshDirtyEnd = end;
}

function markGridMeshDirtyByShard(grid, shard) {
  const idx = Number(shard?.__meshIndex);
  if (!Number.isFinite(idx)) {
    markGridMeshDirtyAll(grid);
    return;
  }
  markGridMeshDirtyRange(grid, idx | 0, idx | 0);
}

function clampCrushVector(fx, fy, ratio, mag, maxCrushLimit, out) {
  const limit = maxCrushLimit * (0.15 + ratio * 1.0);
  if (mag > limit) {
    out.x = (fx / mag) * limit;
    out.y = (fy / mag) * limit;
  } else {
    out.x = fx;
    out.y = fy;
  }
}

let HEX_SHIPS_3D_ACTIVE = false;

export function setHexShips3DActive(active) {
  HEX_SHIPS_3D_ACTIVE = !!active;
}

export function isHexShips3DActive() {
  return HEX_SHIPS_3D_ACTIVE;
}

const SEARCH_OFFSETS_CACHE = Object.create(null);

function getSearchOffsets(radius) {
  const r = Math.max(0, radius | 0);
  let arr = SEARCH_OFFSETS_CACHE[r];
  if (arr) return arr;
  const list = [];
  const r2 = r * r;
  for (let dc = -r; dc <= r; dc++) {
    for (let dr = -r; dr <= r; dr++) {
      if (dc * dc + dr * dr <= r2) list.push(dc, dr);
    }
  }
  arr = sortSearchOffsets(list, r);
  SEARCH_OFFSETS_CACHE[r] = arr;
  return arr;
}

// Kolejność offsetów decyduje o dwóch rzeczach naraz, bo pętla kontaktów w
// collideEntities przerywa na PIERWSZYM trafieniu:
//  - koszt: w porządku rastrowym (0,0) leżało dopiero na ~41. pozycji z 81 dla r=5,
//    więc każde trafienie płaciło połowę dysku zanim sprawdziło komórkę oczywistą;
//  - jakość: wybierany był heks o najmniejszym dc, nie najbliższy — normalne
//    kontaktu miały stały bias w stronę -c.
// Sortujemy metryką rzeczywistą (HEX_SPACING != HEX_HEIGHT), nie po indeksach.
function sortSearchOffsets(list, extent) {
  const order = [];
  for (let i = 0; i < list.length; i += 2) order.push(i);
  const metric = (i) => {
    const wx = list[i] * HEX_SPACING;
    const wy = list[i + 1] * HEX_HEIGHT;
    return wx * wx + wy * wy;
  };
  order.sort((a, b) => (metric(a) - metric(b)) || (list[a] - list[b]) || (list[a + 1] - list[b + 1]));
  const sorted = [];
  for (let i = 0; i < order.length; i++) sorted.push(list[order[i]], list[order[i] + 1]);
  return (extent <= 127) ? new Int8Array(sorted) : new Int16Array(sorted);
}

// OKNO SONDY PUNKTOWEJ Z ZAPASEM NA DRYF. Komórka (dc, dr) wchodzi do okna,
// gdy heks z niej MOŻE stać w promieniu sondy od punktu: jego spoczynkowy
// środek leży najwyżej o komórkę od środka komórki punktu na każdej osi
// (zaokrąglenie punktu + przesunięcie nieparzystych kolumn), a pozycja
// kolizyjna odjeżdża od spoczynkowej najwyżej o `drift` na oś — tak liczy
// getHexShardDrift. Dysk searchR zostaje w oknie: dla drift = 0 warunek daje
// kwadrat 5×5, który mieści się w dysku searchR = 3, więc nietknięty kadłub
// ma bajt w bajt dawne okno. Kwant dryfu 2 px ogranicza liczbę tablic w cache.
const PROBE_OFFSETS_CACHE = new Map();
const PROBE_DRIFT_QUANTUM = 2;
const PROBE_MAX_HIT_RADIUS = HIT_RAD * 2; // getShardHitRadius <= HIT_RAD, sonda liczy ×2

function getProbeSearchOffsets(searchR, drift) {
  const r = Math.max(0, searchR | 0);
  const q = drift > 0 ? Math.ceil(drift / PROBE_DRIFT_QUANTUM) : 0;
  const key = r * 4096 + q;
  let arr = PROBE_OFFSETS_CACHE.get(key);
  if (arr) return arr;
  const d = q * PROBE_DRIFT_QUANTUM;
  const extC = Math.max(r, 1 + Math.floor((PROBE_MAX_HIT_RADIUS + d) / HEX_SPACING));
  const extR = Math.max(r, 1 + Math.floor((PROBE_MAX_HIT_RADIUS + d) / HEX_HEIGHT));
  const r2 = r * r;
  const reach2 = PROBE_MAX_HIT_RADIUS * PROBE_MAX_HIT_RADIUS;
  const list = [];
  for (let dc = -extC; dc <= extC; dc++) {
    const gx = Math.max(0, (Math.abs(dc) - 1) * HEX_SPACING - d);
    for (let dr = -extR; dr <= extR; dr++) {
      const gy = Math.max(0, (Math.abs(dr) - 1) * HEX_HEIGHT - d);
      if (dc * dc + dr * dr <= r2 || gx * gx + gy * gy < reach2) list.push(dc, dr);
    }
  }
  arr = sortSearchOffsets(list, Math.max(extC, extR));
  PROBE_OFFSETS_CACHE.set(key, arr);
  return arr;
}

// Dryf heksów (px siatki), który okna sond trafień muszą pokryć: zmierzony
// `_maxHexDrift` przycięty sufitem probeDriftCap. Brak pomiaru = 0 (dawne okna).
export function getHexProbeDrift(grid) {
  const drift = Number(grid?._maxHexDrift);
  if (!(drift > 0)) return 0;
  const cap = Number(DESTRUCTOR_CONFIG.probeDriftCap);
  if (!(cap > 0)) return 0;
  return drift < cap ? drift : cap;
}

// Punkt raymarchu wiązki (index.html, fireWeaponCore): najbliższy żywy heks,
// którego pozycja WIZUALNA (gridX + deformation) leży bliżej niż √hitRadSq od
// punktu siatki. Dawne okno 3×3 nie rosło z dryfem i wiązka przelatywała przez
// wgniecenie: heks z okna odjechał, a heks, który stoi w tym miejscu, należy do
// komórki spoza okna. Zasięg okna wprost z układu initHexBody: środek heksa
// (c, r) to (c·HEX_SPACING, r·HEX_HEIGHT + pół wiersza w kolumnach
// nieparzystych) plus dryf ≤ `drift` na oś. Przy dryfie 0 to dawne 3×3
// i nieparzyste kolumny wiersza niżej. Najbliższy, a nie pierwszy w porządku
// rastrowym, bo zwrócony heks idzie do applyImpact.
export function findBeamHexShard(grid, gridX, gridY, hitRadSq) {
  const cells = grid?.grid;
  const cols = grid?.cols | 0;
  const rows = grid?.rows | 0;
  if (!cells || cols <= 0 || rows <= 0 || !(hitRadSq > 0)) return null;
  const reach = Math.sqrt(hitRadSq) + getHexProbeDrift(grid);
  const extC = Math.floor(reach / HEX_SPACING + 0.5);
  const rowsUp = Math.floor(reach / HEX_HEIGHT + 0.5);
  // Kolumny nieparzyste leżą pół wiersza niżej, więc sięgają o wiersz dalej w dół.
  const rowsDownOdd = Math.floor(reach / HEX_HEIGHT + 1);
  const approxC = Math.round(gridX / HEX_SPACING);
  const approxR = Math.round(gridY / HEX_HEIGHT);
  const c0 = Math.max(0, approxC - extC);
  const c1 = Math.min(cols - 1, approxC + extC);
  const r1 = Math.min(rows - 1, approxR + rowsUp);
  let best = null;
  let bestD2 = hitRadSq;
  for (let r = Math.max(0, approxR - rowsDownOdd); r <= r1; r++) {
    const rowBase = r * cols;
    const oddOnly = r < approxR - rowsUp;
    for (let c = c0; c <= c1; c++) {
      if (oddOnly && (c & 1) === 0) continue;
      const shard = cells[rowBase + c];
      if (!shard || !shard.active || shard.isDebris) continue;
      const dx = shard.gridX + (shard.deformation?.x || 0) - gridX;
      const dy = shard.gridY + (shard.deformation?.y || 0) - gridY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = shard;
      }
    }
  }
  return best;
}

// Heks podany przez wołającego (sweepImpact, raymarch wiązki) jest wciąż żywy
// i należy do TEJ siatki — po splicie heks mógł przejść do wraku.
function isLiveGridShard(grid, shard) {
  if (!shard || !shard.active || shard.isDebris) return false;
  const shards = grid?.shards;
  return Array.isArray(shards) && shards[shard.__meshIndex] === shard;
}

function isHexEligible(entity) {
  if (!entity) return false;
  if (entity.fighter) return false;
  if (entity.type && ['fighter', 'interceptor', 'drone'].includes(entity.type)) return false;
  return true;
}

function isBrittleEntity(entity) {
  return entity?.destructionMaterial === 'brittle' || entity?.noElasticity === true;
}

// Czy propagację tej encji prowadzi GPU. Warunki muszą odpowiadać bramkom
// w DestructorGpuSoftBody.tick(), bo od tego zależy, kto jest właścicielem
// pól __velX/__velY (wyjście solvera) i __collVelX/__collVelY (jego wejście).
function isGpuSoftBodyOwned(entity, grid) {
  if ((DESTRUCTOR_CONFIG.gpuSoftBody | 0) !== 1) return false;
  if (!DestructorGpuSoftBody?.active) return false;
  if (!entity || entity.isRingSegment) return false;
  if (entity.noGpuSoftBody === true) return false;
  if (isBrittleEntity(entity)) return false;
  const count = grid?.shards?.length || 0;
  return count >= Math.max(16, Number(DESTRUCTOR_CONFIG.gpuSoftBodyMinShards) || 64);
}

function markBrittleSettleRange(grid, minIndex, maxIndex) {
  if (!grid) return;
  const count = Array.isArray(grid.shards) ? grid.shards.length : 0;
  if (count <= 0) return;

  let start = Number(minIndex);
  let end = Number(maxIndex);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;

  start |= 0;
  end |= 0;
  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  if (start < 0 || end < 0 || start >= count || end >= count) {
    start = 0;
    end = count - 1;
  }

  const curStart = Number(grid.__brittleSettleStart);
  const curEnd = Number(grid.__brittleSettleEnd);
  if (!Number.isFinite(curStart) || !Number.isFinite(curEnd) || curStart < 0 || curEnd < curStart) {
    grid.__brittleSettleStart = start;
    grid.__brittleSettleEnd = end;
    return;
  }

  if (start < curStart) grid.__brittleSettleStart = start;
  if (end > curEnd) grid.__brittleSettleEnd = end;
}

function markBrittleTransient(entity, frames = 0, minIndex = NaN, maxIndex = NaN) {
  const grid = entity?.hexGrid;
  if (!grid || !isBrittleEntity(entity)) return;

  const splitHold = Math.max(2, (DESTRUCTOR_CONFIG.splitCheckInterval | 0) + 2);
  const requested = Number(frames);
  const hold = Math.max(splitHold, Number.isFinite(requested) ? (requested | 0) : 0);
  grid.__brittleTransientFrames = Math.max(Number(grid.__brittleTransientFrames) || 0, hold);
  grid.__brittleNeedsSettle = true;
  grid.isSleeping = false;
  grid.sleepFrames = 0;

  const wakeHold = Number(grid.wakeHoldFrames) || 0;
  if (wakeHold > hold) grid.wakeHoldFrames = hold;
  markBrittleSettleRange(grid, minIndex, maxIndex);
}

function settleBrittleVisualState(grid, sleepFramesLimit, framesPerTick = 1) {
  const transientFrames = Number(grid.__brittleTransientFrames) || 0;
  if (transientFrames > 0) {
    grid.__brittleTransientFrames = Math.max(0, transientFrames - framesPerTick);
    grid.isSleeping = false;
    grid.sleepFrames = 0;
    return;
  }

  if (grid.__brittleNeedsSettle) {
    const shards = grid.shards;
    const rangeStart = Number(grid.__brittleSettleStart);
    const rangeEnd = Number(grid.__brittleSettleEnd);
    const hasRange =
      Number.isFinite(rangeStart) &&
      Number.isFinite(rangeEnd) &&
      rangeStart >= 0 &&
      rangeEnd >= rangeStart &&
      rangeStart < shards.length;
    const start = hasRange ? Math.max(0, rangeStart | 0) : 0;
    const end = hasRange ? Math.min(shards.length - 1, rangeEnd | 0) : (shards.length - 1);
    let dirtyMin = Number.POSITIVE_INFINITY;
    let dirtyMax = -1;

    for (let i = start; i <= end; i++) {
      const s = shards[i];
      if (!s || !s.active || s.isDebris) continue;

      const def = s.deformation;
      const target = s.targetDeformation;
      const hadResidual =
        Math.abs(Number(def?.x) || 0) > 0.0001 ||
        Math.abs(Number(def?.y) || 0) > 0.0001 ||
        Math.abs(Number(target?.x) || 0) > 0.0001 ||
        Math.abs(Number(target?.y) || 0) > 0.0001 ||
        Math.abs(Number(s.__velX) || 0) > 0.0001 ||
        Math.abs(Number(s.__velY) || 0) > 0.0001 ||
        Math.abs(Number(s.__collVelX) || 0) > 0.0001 ||
        Math.abs(Number(s.__collVelY) || 0) > 0.0001;

      if (!hadResidual) continue;

      if (def) {
        def.x = 0;
        def.y = 0;
      }
      if (target) {
        target.x = 0;
        target.y = 0;
      }
      s.__velX = 0;
      s.__velY = 0;
      s.__collVelX = 0;
      s.__collVelY = 0;

      const idx = Number(s.__meshIndex);
      if (Number.isFinite(idx)) {
        if (idx < dirtyMin) dirtyMin = idx;
        if (idx > dirtyMax) dirtyMax = idx;
      } else {
        dirtyMin = 0;
        dirtyMax = shards.length - 1;
      }
    }

    if (dirtyMax >= 0 && Number.isFinite(dirtyMin)) markGridMeshDirtyRange(grid, dirtyMin, dirtyMax);
    grid.__brittleNeedsSettle = false;
    grid.__brittleSettleStart = -1;
    grid.__brittleSettleEnd = -1;
  }

  grid.__brittleTransientFrames = 0;
  grid.wakeHoldFrames = 0;
  grid.sleepFrames = Math.max(Number(grid.sleepFrames) || 0, sleepFramesLimit);
  grid.isSleeping = true;
}

function getFinalScaleX(entity) {
  if (entity?.visual && typeof entity.visual.spriteScaleX === 'number') return entity.visual.spriteScaleX;
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

function getFinalScaleY(entity) {
  if (entity?.visual && typeof entity.visual.spriteScaleY === 'number') return entity.visual.spriteScaleY;
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

function getFinalScale(entity) {
  return Math.max(getFinalScaleX(entity), getFinalScaleY(entity));
}

function hasActiveStructuralHexes(entity) {
  const grid = entity?.hexGrid;
  if (!grid) return false;
  const active = Number(grid.activeStructuralCount);
  return !Number.isFinite(active) || active > 0;
}

function getBroadphaseRadius(entity) {
  if (!entity) return 100;
  let radius = Number(entity.radius);
  if (!Number.isFinite(radius) || radius <= 0) radius = Number(entity.r) || 100;
  radius = Math.max(80, radius);
  if (entity.isRingSegment) {
    const gridRadius = Number(entity?.hexGrid?.rawRadius);
    if (Number.isFinite(gridRadius) && gridRadius > 0) {
      const scaledGridRadius = gridRadius * Math.max(0.0001, getFinalScale(entity));
      radius = Math.max(radius, Math.max(140, scaledGridRadius + 80));
    }
  }
  const drift = Math.max(0, Number(entity.hexGrid?._maxHexDrift) || 0);
  return radius + drift * Math.SQRT2 * getFinalScale(entity);
}

function circleOverlapsEntityRect(worldX, worldY, worldRadius, entity, extraMargin = 0) {
  const grid = entity?.hexGrid;
  if (!grid) return true;
  const width = Number(grid.srcWidth) || 0;
  const height = Number(grid.srcHeight) || 0;
  if (width <= 0 || height <= 0) return true;

  const scaleX = Math.max(0.0001, getFinalScaleX(entity));
  const scaleY = Math.max(0.0001, getFinalScaleY(entity));
  const angle = getEntityHexAngle(entity);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = worldX - getEntityPosX(entity);
  const dy = worldY - getEntityPosY(entity);

  const billboardOrientation = usesBillboardOrientation(entity);
  const lx = worldDeltaToLocalX(dx, dy, scaleX, scaleY, c, s, billboardOrientation);
  const ly = worldDeltaToLocalY(dx, dy, scaleX, scaleY, c, s, billboardOrientation);
  const pX = grid.pivot ? grid.pivot.x : 0;
  const pY = grid.pivot ? grid.pivot.y : 0;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const minX = -cx - pX;
  const maxX = width - cx - pX;
  const minY = -cy - pY;
  const maxY = height - cy - pY;
  const marginX = (Math.max(0, Number(worldRadius) || 0) / scaleX) + Math.max(0, Number(extraMargin) || 0);
  const marginY = (Math.max(0, Number(worldRadius) || 0) / scaleY) + Math.max(0, Number(extraMargin) || 0);

  return (
    lx >= (minX - marginX) &&
    lx <= (maxX + marginX) &&
    ly >= (minY - marginY) &&
    ly <= (maxY + marginY)
  );
}

// OBB (obrócony prostokąt kadłuba) w przestrzeni świata, cache'owany per tick fizyki.
// Osie ux/vy są jednostkowe; skala siedzi w ekstentach eu/ev.
function refreshEntityObb(entity, tick) {
  let obb = entity._destrObb;
  if (!obb) {
    obb = entity._destrObb = { cx: 0, cy: 0, ux: 1, uy: 0, vx: 0, vy: 1, eu: 0, ev: 0, valid: false };
  }
  const grid = entity.hexGrid;
  if (entity._destrObbTick === tick && entity._destrObbRevision === grid?.meshRevision) return obb;
  entity._destrObbTick = tick;
  entity._destrObbRevision = grid?.meshRevision;
  const w = Number(grid?.srcWidth) || 0;
  const h = Number(grid?.srcHeight) || 0;
  if (w <= 0 || h <= 0) {
    obb.valid = false;
    return obb;
  }

  const scaleX = Math.max(0.0001, getFinalScaleX(entity));
  const scaleY = Math.max(0.0001, getFinalScaleY(entity));
  const angle = getEntityHexAngle(entity);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const billboardOrientation = usesBillboardOrientation(entity);
  const pX = grid.pivot ? grid.pivot.x : 0;
  const pY = grid.pivot ? grid.pivot.y : 0;

  obb.cx = getEntityPosX(entity) + localDeltaToWorldX(-pX, -pY, scaleX, scaleY, c, s, billboardOrientation);
  obb.cy = getEntityPosY(entity) + localDeltaToWorldY(-pX, -pY, scaleX, scaleY, c, s, billboardOrientation);
  obb.ux = localDeltaToWorldX(1, 0, scaleX, scaleY, c, s, billboardOrientation) / scaleX;
  obb.uy = localDeltaToWorldY(1, 0, scaleX, scaleY, c, s, billboardOrientation) / scaleX;
  obb.vx = localDeltaToWorldX(0, 1, scaleX, scaleY, c, s, billboardOrientation) / scaleY;
  obb.vy = localDeltaToWorldY(0, 1, scaleX, scaleY, c, s, billboardOrientation) / scaleY;

  // Zapas na deformacje shardów (collision pos = gridX + deformation*cds) i hitRadius.
  // Skladnik deformacyjny byl STALY i wymiarowany na maxDeform (100 x 1.15 = 115),
  // czyli na teoretyczny clamp, nie na rzeczywistosc. Pomiar w bitwie 212 statkow:
  // mediana najwiekszego dryfu na cialo 10.2 j., p99 22.0, maksimum 33.4, a 125 z
  // 420 cial mialo dryf ZEROWY. Stad pudlo fregaty mialo 7.57x pole kadluba i
  // bramka SAT praktycznie nic nie odrzucala (2-4 kontakty na klatke przy 12 ms
  // w Kolizjach). Teraz skladnik idzie z pomiaru. Dryf plastyczny moze przekroczyc
  // maxDeform, wiec tylko BRAK pomiaru korzysta ze starego sufitu jako fallbacku.
  const deformCeil = (Number(DESTRUCTOR_CONFIG.maxDeform) || 100) * Math.max(1, Number(DESTRUCTOR_CONFIG.collisionDeformScale) || 1);
  const driftRaw = Number(grid._maxHexDrift);
  const driftPad = Number.isFinite(driftRaw) && driftRaw >= 0 ? driftRaw : deformCeil;
  const pad = driftPad + HEX_SPACING * 4;
  obb.eu = (w * 0.5 + pad) * scaleX;
  obb.ev = (h * 0.5 + pad) * scaleY;
  obb.valid = true;
  return obb;
}

function obbsSeparatedOnAxis(nx, ny, dx, dy, a, b, margin) {
  const dist = Math.abs(dx * nx + dy * ny);
  const ra = a.eu * Math.abs(a.ux * nx + a.uy * ny) + a.ev * Math.abs(a.vx * nx + a.vy * ny);
  const rb = b.eu * Math.abs(b.ux * nx + b.uy * ny) + b.ev * Math.abs(b.vx * nx + b.vy * ny);
  return dist > ra + rb + margin;
}

// SAT dla pary OBB (4 osie). Zwraca true, gdy prostokąty (z marginesem) się przecinają.
// Konserwatywnie true, gdy któraś encja nie ma wymiarów gridu.
export function entityObbsOverlap(A, B, tick, margin = 0) {
  const a = refreshEntityObb(A, tick);
  if (!a.valid) return true;
  const b = refreshEntityObb(B, tick);
  if (!b.valid) return true;

  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const m = Math.max(0, Number(margin) || 0);

  if (obbsSeparatedOnAxis(a.ux, a.uy, dx, dy, a, b, m)) return false;
  if (obbsSeparatedOnAxis(a.vx, a.vy, dx, dy, a, b, m)) return false;
  if (obbsSeparatedOnAxis(b.ux, b.uy, dx, dy, a, b, m)) return false;
  if (obbsSeparatedOnAxis(b.vx, b.vy, dx, dy, a, b, m)) return false;
  return true;
}


// ============================================================================
// DIAGNOSTYKA BRAMEK KOLIZJI (DevFlags.showCollisionBounds)
// ============================================================================
// Overlay w index.html MUSI pokazywac to, co NAPRAWDE testuje broadphase, wiec
// OBB bierzemy z refreshEntityObb — tej samej funkcji, z ktorej korzysta
// entityObbsOverlap. Drugie, "podobne" liczenie ekstentow w warstwie rysowania
// pokazywaloby ladny prostokat i ukrywalo dokladnie ten blad, ktorego szukamy.
//
// Tick jest sztuczny i rosnacy, bo refreshEntityObb cache'uje po `_destrObbTick`.
// Encja, ktora w tej klatce nie trafila do zadnej pary, ma OBB z dowolnie starej
// klatki — bez wymuszenia rysowalibysmy pudlo sprzed sekund.
let _obbDebugTick = 0x40000000;

export function getCollisionBoundsDebug(entity, out = {}) {
  out.valid = false;
  const grid = entity?.hexGrid;
  const w = Number(grid?.srcWidth) || 0;
  const h = Number(grid?.srcHeight) || 0;
  if (w <= 0 || h <= 0) return out;

  const obb = refreshEntityObb(entity, _obbDebugTick++);
  if (!obb.valid) return out;

  const scaleX = Math.max(0.0001, getFinalScaleX(entity));
  const scaleY = Math.max(0.0001, getFinalScaleY(entity));
  // Kopia wzoru z refreshEntityObb — gdy tam sie zmieni, tu tez trzeba.
  const pad = obb.eu / scaleX - w * 0.5;

  out.valid = true;
  out.cx = obb.cx;
  out.cy = obb.cy;
  out.ux = obb.ux;
  out.uy = obb.uy;
  out.vx = obb.vx;
  out.vy = obb.vy;
  // Ekstenty Z PADEM — to jest bramka, ktora odrzuca (albo nie) pare.
  out.eu = obb.eu;
  out.ev = obb.ev;
  // Ekstenty BEZ PADU — rzeczywisty obrys kadluba, do porownania na ekranie.
  out.euRaw = w * 0.5 * scaleX;
  out.evRaw = h * 0.5 * scaleY;
  out.pad = pad;
  out.padU = pad * scaleX;
  out.padV = pad * scaleY;
  out.drift = Number(grid._maxHexDrift) || 0;
  // Ustawiane przez _prepareBroadphase; 0 gdy encja wypadla z broadphase.
  out.bpRadius = Number(entity._bpRadius) || 0;
  out.hasActiveHex = entity._hasActiveHex !== false;
  // Ile razy wieksze POLE zajmuje pudlo z padem. 1.0 = pad zerowy.
  out.areaRatio = (out.eu * out.ev) / Math.max(1e-6, out.euRaw * out.evRaw);
  return out;
}

export function getBroadphaseDebugInfo() {
  const pad = ((Number(DESTRUCTOR_CONFIG.maxDeform) || 100) *
    Math.max(1, Number(DESTRUCTOR_CONFIG.collisionDeformScale) || 1)) + HEX_SPACING * 4;
  return {
    cellSize: Math.max(300, Number(DESTRUCTOR_CONFIG.broadphaseCellSize) || 2400),
    pad,
    hexSpacing: HEX_SPACING,
    maxDeform: Number(DESTRUCTOR_CONFIG.maxDeform) || 100,
    deformScale: Number(DESTRUCTOR_CONFIG.collisionDeformScale) || 1,
    // perf.lastContacts, nie _frameContacts: to drugie jest zerowane na poczatku
    // KAZDEGO podkroku, wiec w fazie rysowania trzymaloby polowiczny stan. HUD
    // ("Kontakty/klatka") czyta lastContacts — overlay ma pokazywac te sama liczbe.
    contacts: Number(DestructorSystem?.perf?.lastContacts) || 0,
    entities: Array.isArray(DestructorSystem?._visualEntities) ? DestructorSystem._visualEntities.length : 0
  };
}

function getEntitySpriteRotation(entity) {
  if (entity?.isPlayer) return 0;
  const r =
    (entity?.visual && typeof entity.visual.spriteRotation === 'number') ? entity.visual.spriteRotation
      : (entity?.capitalProfile && typeof entity.capitalProfile.spriteRotation === 'number') ? entity.capitalProfile.spriteRotation
        : (entity?.profile && typeof entity.profile.spriteRotation === 'number') ? entity.profile.spriteRotation
          : 0;
  return Number.isFinite(r) ? r : 0;
}

function getEntityPosX(entity) {
  if (!entity) return 0;
  if (entity.pos && typeof entity.pos.x === 'number') return entity.pos.x;
  return Number(entity.x) || 0;
}

function getEntityPosY(entity) {
  if (!entity) return 0;
  if (entity.pos && typeof entity.pos.y === 'number') return entity.pos.y;
  return Number(entity.y) || 0;
}

function setEntityPos(entity, x, y) {
  if (!entity) return;
  entity._destrObbTick = -1;
  if (entity.pos && typeof entity.pos.x === 'number' && typeof entity.pos.y === 'number') {
    entity.pos.x = x;
    entity.pos.y = y;
  }
  entity.x = x;
  entity.y = y;
}

function addEntityPosition(entity, dx, dy) {
  setEntityPos(entity, getEntityPosX(entity) + dx, getEntityPosY(entity) + dy);
}

function getEntityVelX(entity) {
  if (!entity) return 0;
  if (entity.vel && typeof entity.vel.x === 'number') return entity.vel.x;
  return Number(entity.vx) || 0;
}

function getEntityVelY(entity) {
  if (!entity) return 0;
  if (entity.vel && typeof entity.vel.y === 'number') return entity.vel.y;
  return Number(entity.vy) || 0;
}

function setEntityVelocity(entity, vx, vy) {
  if (!entity) return;
  if (entity.vel && typeof entity.vel.x === 'number' && typeof entity.vel.y === 'number') {
    entity.vel.x = vx;
    entity.vel.y = vy;
  }
  entity.vx = vx;
  entity.vy = vy;
}

function addEntityVelocity(entity, dvx, dvy) {
  setEntityVelocity(entity, getEntityVelX(entity) + dvx, getEntityVelY(entity) + dvy);
}

function getEntityAngle(entity) {
  return Number(entity?.angle) || 0;
}

function getEntityHexAngle(entity) {
  return getEntityAngle(entity) + getEntitySpriteRotation(entity) + DESTRUCTOR_CONFIG.visualRotationOffset;
}

function usesBillboardOrientation(entity) {
  return entity?.isAsteroidHex === true || entity?.visual?.preserveBillboardOrientation === true;
}

function localDeltaToWorldX(localX, localY, scaleX, scaleY, c, s, billboardOrientation = false) {
  return billboardOrientation
    ? (localX * scaleX) * c + (localY * scaleY) * s
    : (localX * scaleX) * c - (localY * scaleY) * s;
}

function localDeltaToWorldY(localX, localY, scaleX, scaleY, c, s, billboardOrientation = false) {
  return billboardOrientation
    ? -(localX * scaleX) * s + (localY * scaleY) * c
    : (localX * scaleX) * s + (localY * scaleY) * c;
}

function worldDeltaToLocalX(dx, dy, scaleX, _scaleY, c, s, billboardOrientation = false) {
  return billboardOrientation
    ? (dx * c - dy * s) / scaleX
    : (dx * c + dy * s) / scaleX;
}

function worldDeltaToLocalY(dx, dy, _scaleX, scaleY, c, s, billboardOrientation = false) {
  return billboardOrientation
    ? (dx * s + dy * c) / scaleY
    : (-dx * s + dy * c) / scaleY;
}

function getEntityAngVel(entity) {
  return Number(entity?.angVel) || 0;
}

function addEntityAngVel(entity, da) {
  if (!entity) return;
  entity.angVel = getEntityAngVel(entity) + da;
}

function getEntityMass(entity) {
  const m = Number(entity?.mass);
  if (Number.isFinite(m) && m > 0) return m;
  return 100;
}

function getEntityRammingMass(entity) {
  const baseMass = getEntityMass(entity);
  const rammingMass = Number(entity?.rammingMass);
  if (Number.isFinite(rammingMass) && rammingMass > 0) {
    return Math.max(baseMass, rammingMass);
  }
  return baseMass;
}

function worldToScreenFallback(wx, wy, cam, ctx) {
  return {
    x: (wx - cam.x) * cam.zoom + ctx.canvas.width / 2,
    y: (wy - cam.y) * cam.zoom + ctx.canvas.height / 2
  };
}

function updateShardLocal(entity, shard) {
  const cx = entity.hexGrid.srcWidth * 0.5;
  const cy = entity.hexGrid.srcHeight * 0.5;
  const px = entity.hexGrid.pivot ? entity.hexGrid.pivot.x : 0;
  const py = entity.hexGrid.pivot ? entity.hexGrid.pivot.y : 0;
  shard.lx = getShardVisualGridX(shard) - cx - px;
  shard.ly = getShardVisualGridY(shard) - cy - py;
}

function getShardVisualGridX(shard) {
  return shard.gridX + shard.deformation.x;
}

function getShardVisualGridY(shard) {
  return shard.gridY + shard.deformation.y;
}

// Odświeżane raz na tick w DestructorSystem.update()/updateVisuals(). Wcześniej
// każde z tych wywołań czytało config + robiło ?? i Number() — dwa razy na każdą
// kandydacką komórkę w najgłębszej pętli narrowphase. Panel strojenia może to
// zmieniać w locie, więc wartość nie może być zamrożona na stałe.
let COLLISION_DEFORM_SCALE = Number(DESTRUCTOR_CONFIG.collisionDeformScale ?? 1.0);

function refreshCollisionDeformScale() {
  COLLISION_DEFORM_SCALE = Number(DESTRUCTOR_CONFIG.collisionDeformScale ?? 1.0);
}

function getShardCollisionGridX(shard) {
  return shard.gridX + shard.deformation.x * COLLISION_DEFORM_SCALE;
}

function getShardCollisionGridY(shard) {
  return shard.gridY + shard.deformation.y * COLLISION_DEFORM_SCALE;
}

// ============================================================================
// DRYF HEKSOW = ADAPTACYJNY PAD OBB
// ============================================================================
// refreshEntityObb musi objac kazda pozycje kolizyjna heksa. Ta pozycja to
// `gridX + deformation * COLLISION_DEFORM_SCALE` (getShardCollisionGridX), a
// nominalne pudlo obejmuje tylko `origGridX`. Nadmiar ma wiec dwie skladowe:
//   - dryf PLASTYCZNY  (gridX - origGridX), wypalany w simulateElasticity,
//   - dryf SPREZYSTY   (deformation * cds).
// During relaxation/GPU readback current displacement may exceed the target.
// Bounds must contain both, including accumulated plastic displacement.
function shardDriftBound(s) {
  return getHexShardDrift(s, COLLISION_DEFORM_SCALE);
}

// Wlascicielem licznika jest STRONA ROSNACA (kolizja), bo tylko ona wie, ze
// dryf sie zwiekszyl, i nie ma zadnych bramek. Wygaszanie robi osobno
// refreshMaxHexDrift z ungated petli updateVisualDeformation — gdyby to
// wygaszanie siedzialo w simulateElasticity, licznik zostawalby zawyzony na
// zawsze dla kadlubow >500 heksow, obslugiwanych przez GPU, brittle i ringow
// (piec bramek). To ta sama pulapka, co _gpuForceAwakeFrames.
function noteHexDrift(grid, shard) {
  if (!grid || !shard) return;
  const d = shardDriftBound(shard);
  if (d > (Number(grid._maxHexDrift) || 0)) grid._maxHexDrift = d;
}

// ── Lista aktywnych heksów sprężystości ────────────────────────────────────
// simulateElasticity przechodził WSZYSTKIE heksy obudzonej siatki (≤ 500)
// z 6 sąsiadami co klatkę, a w bitwie każdy ostrzelany okręt jest budzony na
// 20 klatek. Pętla robi coś tylko dla heksa „w ruchu” (|targetDeformation|²
// ≥ 0,01, także NaN, albo nad progiem plastyczności) oraz dla heksa, którego
// sąsiad do przodu jest w ruchu — reszta to pewne no-opy.
//
// Znaczniki per siatka (Uint8Array po indeksie tablicy shards): heks w ruchu
// znaczy siebie i wszystkich sąsiadów. Pętla idzie jak dawniej rosnąco po
// indeksie, ale wchodzi tylko w oznaczone; po każdym heksie i każdej parze
// heksy dalej w ruchu znaczą się na nowo (dalej w tym przebiegu albo na
// następny). Oznaczenie z zapasem daje co najwyżej no-op, więc wynik jest
// identyczny z pełną iteracją (test: tests/elasticActiveList.test.mjs).
//
// Znaczniki PRZEŻYWAJĄ uśpienie siatki, własność GPU i stan > 500 heksów:
// uśpiona siatka może trzymać heksy w ruchu (sen liczy się z aktywności
// wizualnej), a po obudzeniu pełna pętla znów by je przetwarzała.
// Zapisy targetDeformation spoza pętli: kolizje i uszkodzenia —
// noteElasticShard obok noteHexDrift; naprawa i wynik GPU — pełny rescan
// (grid._elasticRescan). Nowa tablica shards (split, wrak z puli, odtworzenie
// z zimnego) — też pełny rescan, bo przeniesione heksy niosą swoje wgniecenia.
const ELASTIC_REST_SQ = 0.01;

function isElasticShardMoving(s, yieldSq) {
  const x = s.targetDeformation.x;
  const y = s.targetDeformation.y;
  const d = x * x + y * y;
  return !(d < ELASTIC_REST_SQ) || d > yieldSq;
}

function fillElasticMarks(grid, marks) {
  marks.fill(1);
  grid._elasticMarkCount = marks.length;
}

function markElasticAround(grid, marks, s) {
  const shards = grid.shards;
  const idx = s.__meshIndex;
  if (!(idx >= 0 && idx < marks.length) || shards[idx] !== s) {
    // Heks spoza tej tablicy albo zły indeks (np. współdzielony przez wrak):
    // bez pewności co znaczyć — znaczymy całą siatkę (= dawna pełna pętla).
    fillElasticMarks(grid, marks);
    return;
  }
  if (marks[idx] === 0) { marks[idx] = 1; grid._elasticMarkCount++; }
  const neighbors = s.neighbors;
  for (let k = 0; k < neighbors.length; k++) {
    const n = neighbors[k];
    if (!n) continue;
    const ni = n.__meshIndex;
    if (!(ni >= 0 && ni < marks.length) || shards[ni] !== n) {
      fillElasticMarks(grid, marks);
      return;
    }
    if (marks[ni] === 0) { marks[ni] = 1; grid._elasticMarkCount++; }
  }
}

// Zapis targetDeformation spoza simulateElasticity (kolizja, uszkodzenie).
function noteElasticShard(grid, shard) {
  if (!grid || !shard) return;
  const marks = grid._elasticMarks;
  if (!marks || grid._elasticShardsRef !== grid.shards || marks.length !== grid.shards.length) {
    grid._elasticRescan = true;
    return;
  }
  markElasticAround(grid, marks, shard);
}

// Znaczniki gotowe do przebiegu; pełny rescan, gdy tablica shards jest nowa
// albo ktoś zgłosił zapis hurtowy (naprawa, GPU).
function prepareElasticMarks(grid, yieldSq) {
  const shards = grid.shards;
  const len = shards.length;
  let marks = grid._elasticMarks;
  if (marks && marks.length === len && grid._elasticShardsRef === shards && !grid._elasticRescan) return marks;
  if (!marks || marks.length !== len) marks = grid._elasticMarks = new Uint8Array(len);
  else marks.fill(0);
  grid._elasticMarkCount = 0;
  grid._elasticShardsRef = shards;
  grid._elasticRescan = false;
  for (let i = 0; i < len; i++) {
    const shard = shards[i];
    if (!shard || !shard.active || shard.isDebris) continue;
    if (isElasticShardMoving(shard, yieldSq)) markElasticAround(grid, marks, shard);
  }
  return marks;
}

// Dokladny przelicz: pozwala licznikowi ZMALEC, gdy blacha sie wyprostowala.
// O(aktywne heksy) — wolane round-robin, nie dla kazdego ciala co klatke.
function refreshMaxHexDrift(grid) {
  const shards = grid?.shards;
  if (!Array.isArray(shards)) return;
  let mx = 0;
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    if (!s || !s.active || s.isDebris) continue;
    const d = shardDriftBound(s);
    if (d > mx) mx = d;
  }
  grid._maxHexDrift = mx;
}

function rebuildNeighbors(grid) {
  if (!grid?.shards || !grid.grid) return;
  const cols = grid.cols | 0;
  const rows = grid.rows | 0;

  for (const s of grid.shards) {
    s.neighbors = [];
    const odd = (s.c % 2 !== 0);
    const offsets = odd
      ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
      : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];

    for (let i = 0; i < 6; i++) {
      const nc = s.c + offsets[i][0];
      const nr = s.r + offsets[i][1];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const n = grid.grid[nc + nr * cols];
      if (n) s.neighbors.push(n);
    }
  }
}

function updateHexCache(entity) {
  if (!entity?.hexGrid?.cacheCtx) return;
  const g = entity.hexGrid;
  const ctx = g.cacheCtx;

  ctx.clearRect(0, 0, g.srcWidth, g.srcHeight);
  for (const s of g.shards) {
    if (!s.active || s.isDebris) continue;
    updateShardLocal(entity, s);
    s.drawShape(ctx);
  }

  g.cacheDirty = false;
  g.textureDirty = false;
  g.meshDirty = false;
  resetGridMeshDirtyRange(g);
  g.gpuTextureNeedsUpdate = false;
}

export function refreshHexBodyCache(entity) {
  if (!entity?.hexGrid) return;
  const grid = entity.hexGrid;
  const needsMeshRefresh2D = !HEX_SHIPS_3D_ACTIVE && !!grid.meshDirty;
  const needsTextureRebuild = !HEX_SHIPS_3D_ACTIVE && !!grid.textureDirty;
  const needsCacheRebuild = !!grid.cacheDirty && (!HEX_SHIPS_3D_ACTIVE || !grid.armorImage);

  if (needsCacheRebuild || needsTextureRebuild || needsMeshRefresh2D) updateHexCache(entity);
}

// === ŻAR HEKSA (kanał heat) ===
// Dwa pola na shardzie: `heat` (szczyt, 0-1) i `heatStamp` (sekundy). Zanik
// liczy SHADER z tej pary, nie CPU — inaczej każde rozżarzenie kosztowałoby
// pętlę po wszystkich shardach wszystkich encji co klatkę, a żar ma trwać
// dokładnie wtedy, gdy siatka już śpi i nic jej nie odwiedza.
//
// Baza czasu musi być TA SAMA co w rendererze: hexShips3D zapisuje
// uTime = state.lastTime * 0.001, gdzie lastTime to performance.now().
function shardHeatNow(shard, nowSec) {
  const peak = Number(shard?.heat) || 0;
  if (peak <= 0) return 0;
  const age = nowSec - (Number(shard.heatStamp) || 0);
  if (age <= 0) return peak;
  return peak * Math.exp(-age * (Number(DESTRUCTOR_CONFIG.heatDecay) || 0.45));
}

// Dokładanie żaru startuje od WARTOŚCI PO ZANIKU, nie od zapamiętanego szczytu —
// inaczej długie tarcie trzymałoby heks w białym żarze bez końca.
function addShardHeat(shard, amount, nowSec) {
  if (!shard || !(amount > 0)) return;
  const next = shardHeatNow(shard, nowSec) + amount;
  shard.heat = next > 1 ? 1 : next;
  shard.heatStamp = nowSec;
}

// PODNIESIENIE do poziomu (max), nie dodawanie. Brzeg rany ma temperaturę
// wyrwy, a nie sumę tego, ilu sąsiadów zginęło obok — inaczej pierwszy heks
// z trzema martwymi sąsiadami byłby "trzy razy biały". Zwraca true, gdy zapis
// faktycznie nastąpił (do zakresu dirty).
function raiseShardHeat(shard, value, nowSec) {
  const peak = Number(shard.heat) || 0;
  // Szczyt poniżej celu = wartość po zaniku też poniżej: bez exp().
  if (peak >= value && shardHeatNow(shard, nowSec) >= value) return false;
  shard.heat = value > 1 ? 1 : value;
  shard.heatStamp = nowSec;
  return true;
}

// Żar zmienia wyłącznie ATRYBUT RENDERU, nie geometrię. Zwykłe
// markGridMeshDirtyRange podbija meshRevision, a ten unieważnia indeks
// kontaktów i cache OBB — przy tarciu co tick przebudowywalibyśmy je bez
// powodu. Tu tylko rozszerzamy zakres uploadu instancji; lerp deformacji
// (visualDirty*) też nie ma czego robić. W trybie 2D żaru nie widać, a samo
// meshDirty wymusiłoby przerysowanie cache płótna — więc tam nic.
function markGridHeatDirtyRange(grid, minIndex, maxIndex) {
  if (!grid || !HEX_SHIPS_3D_ACTIVE) return;
  const count = Array.isArray(grid.shards) ? grid.shards.length : 0;
  let start = minIndex | 0;
  let end = maxIndex | 0;
  if (count <= 0 || start < 0 || end < start || end >= count) {
    grid.meshDirty = true;
    grid.meshDirtyAll = true;
    grid.meshDirtyStart = 0;
    grid.meshDirtyEnd = Math.max(0, count - 1);
    return;
  }
  grid.meshDirty = true;
  if (grid.meshDirtyAll) return;
  const curStart = Number(grid.meshDirtyStart);
  const curEnd = Number(grid.meshDirtyEnd);
  if (!Number.isFinite(curStart) || !Number.isFinite(curEnd) || curStart < 0 || curEnd < curStart) {
    grid.meshDirtyStart = start;
    grid.meshDirtyEnd = end;
    return;
  }
  if (start < curStart) grid.meshDirtyStart = start;
  if (end > curEnd) grid.meshDirtyEnd = end;
}

// Wierzchołki i „strzępy” heksa są tylko czytane (_traceHexPath), a strzępów
// nikt nigdy nie ustawia — wspólne, zamrożone tablice zamiast 13 obiektów na
// heks (kadłub capitala to tysiące heksów, flota — dziesiątki tysięcy). Zapis
// do nich rzuci błędem zamiast po cichu przestawić wszystkie heksy naraz.
const HEX_ZERO_FRAYS = Object.freeze(Array.from({ length: 6 }, () => Object.freeze({ x: 0, y: 0 })));
const _sharedHexVerts = new Map();
function getSharedHexVerts(radius) {
  let verts = _sharedHexVerts.get(radius);
  if (!verts) {
    const list = [];
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      list.push(Object.freeze({ x: Math.cos(a) * radius, y: Math.sin(a) * radius }));
    }
    verts = Object.freeze(list);
    _sharedHexVerts.set(radius, verts);
  }
  return verts;
}

class HexShard {
  constructor(img, gridX, gridY, radius, c, r, color = null) {
    this.img = img;
    this.gridX = gridX;
    this.gridY = gridY;
    this.origGridX = gridX;
    this.origGridY = gridY;
    this.radius = radius;
    this.c = c;
    this.r = r;
    this.color = color;
    this.active = true;
    this.isDebris = false;
    this.maxHp = DESTRUCTOR_CONFIG.shardHP;
    this.hp = this.maxHp;
    this.coverage = 1;
    this.edgeMask = null;
    this.mass = DESTRUCTOR_CONFIG.shardMass;
    this.hitRadius = HIT_RAD;
    this.deformation = { x: 0, y: 0 };
    this.targetDeformation = { x: 0, y: 0 };
    this.frays = HEX_ZERO_FRAYS;
    this.worldX = 0;
    this.worldY = 0;
    this.dvx = 0;
    this.dvy = 0;
    this.drot = 0;
    this.alpha = 1;
    this.angle = 0;
    this.scale = 1;
    this.__collVelX = 0;
    this.__collVelY = 0;
    // Żar: szczyt i znacznik czasu (patrz shardHeatNow). Zanik liczy shader.
    this.heat = 0;
    this.heatStamp = 0;
    this.neighbors = [];
    this.verts = getSharedHexVerts(radius);

    this.lx = 0;
    this.ly = 0;
    this.origLx = 0;
    this.origLy = 0;
    this._crushStamp = 0;
    this._bakedOffX = 0;
    this._bakedOffY = 0;
    this._pristineX = gridX;
    this._pristineY = gridY;
    this.__meshIndex = -1;
  }

  repair(dt) {
    if (!this.active || this.isDebris) return false;
    const k = Math.min(1, DESTRUCTOR_CONFIG.recoverSpeed * dt);
    const keep = 1 - k;
    const snap = Math.max(0.0001, Number(DESTRUCTOR_CONFIG.elasticSleepSnapThreshold) || 0.04);
    let changed = false;

    const defX = Number(this.deformation.x) || 0;
    const defY = Number(this.deformation.y) || 0;
    const targetX = Number(this.targetDeformation.x) || 0;
    const targetY = Number(this.targetDeformation.y) || 0;
    if (Math.abs(defX) > 0.0001 || Math.abs(defY) > 0.0001 || Math.abs(targetX) > 0.0001 || Math.abs(targetY) > 0.0001) {
      let nextX = defX * keep;
      let nextY = defY * keep;
      if (Math.abs(nextX) <= snap) nextX = 0;
      if (Math.abs(nextY) <= snap) nextY = 0;
      this.deformation.x = nextX;
      this.deformation.y = nextY;
      this.targetDeformation.x = nextX;
      this.targetDeformation.y = nextY;
      changed = true;
    }

    const offX = (Number(this.gridX) || 0) - this.origGridX;
    const offY = (Number(this.gridY) || 0) - this.origGridY;
    if (Math.abs(offX) > 0.0001 || Math.abs(offY) > 0.0001) {
      let nextGridX = this.gridX - offX * k;
      let nextGridY = this.gridY - offY * k;
      if (Math.abs(nextGridX - this.origGridX) <= snap) nextGridX = this.origGridX;
      if (Math.abs(nextGridY - this.origGridY) <= snap) nextGridY = this.origGridY;
      this.gridX = nextGridX;
      this.gridY = nextGridY;
      this._bakedOffX = this.gridX - this.origGridX;
      this._bakedOffY = this.gridY - this.origGridY;
      changed = true;
    } else if (Math.abs(Number(this._bakedOffX) || 0) > 0.0001 || Math.abs(Number(this._bakedOffY) || 0) > 0.0001) {
      this._bakedOffX = 0;
      this._bakedOffY = 0;
      changed = true;
    }

    if (
      Math.abs(Number(this.__velX) || 0) > 0.0001 ||
      Math.abs(Number(this.__velY) || 0) > 0.0001 ||
      Math.abs(Number(this.__collVelX) || 0) > 0.0001 ||
      Math.abs(Number(this.__collVelY) || 0) > 0.0001
    ) {
      this.__velX = 0;
      this.__velY = 0;
      this.__collVelX = 0;
      this.__collVelY = 0;
      changed = true;
    }

    this._pristineX = this.origGridX;
    this._pristineY = this.origGridY;

    const oldHp = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + DESTRUCTOR_CONFIG.repairRate * dt);
    if (this.hp !== oldHp) changed = true;
    return changed;
  }

  // bypassLimit dotyczy WYŁĄCZNIE celu deformacji. Zgniot z kolizji niesie
  // fizyczną skalę uderzenia i targetDeformation musi ją dostać w całości —
  // ale `deformation` to pole, które renderer wstawia wprost do instance
  // matrix (hexShips3D: gridX + deformation). Wpisanie tam pełnego zgniotu
  // teleportowało heks: taran fregaty w pancernik przy 300 u/s dawał push
  // ~144 jednostek, czyli 19 szerokości komórki (HEX_SPACING = 7.5) w JEDNYM
  // ticku fizyki. Natychmiastowy zapis jest więc ograniczony zawsze, a resztę
  // drogi do celu dokłada lerp w updateVisualDeformation — blacha się wgniata
  // zamiast skakać.
  applyDeformation(vecX, vecY, waveMult = 1.0, bypassLimit = false) {
    const MAX_INSTANT = 8.0;
    const magSq = vecX * vecX + vecY * vecY;
    let instX = vecX, instY = vecY;
    let tgtX = vecX, tgtY = vecY;

    if (magSq > MAX_INSTANT * MAX_INSTANT) {
      const mag = Math.sqrt(magSq);
      instX = (vecX / mag) * MAX_INSTANT;
      instY = (vecY / mag) * MAX_INSTANT;
      if (!bypassLimit) {
        tgtX = instX;
        tgtY = instY;
      }
    }

    this.targetDeformation.x += tgtX;
    this.targetDeformation.y += tgtY;
    this.deformation.x += instX;
    this.deformation.y += instY;

    // Weapon velocity (distributeStructuralDamage) stays on __velX and gets damped by GPU.
    this.__collVelX = (this.__collVelX || 0) + vecX * 1.5 * waveMult;
    this.__collVelY = (this.__collVelY || 0) + vecY * 1.5 * waveMult;

    const vSq = this.__collVelX * this.__collVelX + this.__collVelY * this.__collVelY;
    const MAX_VEL = Math.max(1.0, 160.0 * waveMult);

    if (vSq > MAX_VEL * MAX_VEL) {
      const vMag = Math.sqrt(vSq);
      this.__collVelX = (this.__collVelX / vMag) * MAX_VEL;
      this.__collVelY = (this.__collVelY / vMag) * MAX_VEL;
    }
  }

  becomeDebris(velocityX, velocityY, parentEntity, scale = 1.0) {
    if (this.isDebris) return;
    this.scale = scale;
    const px = getEntityPosX(parentEntity);
    const py = getEntityPosY(parentEntity);
    const rotation = getEntityHexAngle(parentEntity);
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const billboardOrientation = usesBillboardOrientation(parentEntity);
    const cx = parentEntity.hexGrid.srcWidth * 0.5;
    const cy = parentEntity.hexGrid.srcHeight * 0.5;
    const pX = parentEntity.hexGrid.pivot ? parentEntity.hexGrid.pivot.x : 0;
    const pY = parentEntity.hexGrid.pivot ? parentEntity.hexGrid.pivot.y : 0;
    const startLx = (this.gridX - cx) + this.deformation.x - pX;
    const startLy = (this.gridY - cy) + this.deformation.y - pY;
    const scaleX = Math.max(0.0001, getFinalScaleX(parentEntity));
    const scaleY = Math.max(0.0001, getFinalScaleY(parentEntity));
    const startWx = localDeltaToWorldX(startLx, startLy, scaleX, scaleY, c, s, billboardOrientation);
    const startWy = localDeltaToWorldY(startLx, startLy, scaleX, scaleY, c, s, billboardOrientation);

    this.worldX = px + startWx;
    this.worldY = py + startWy;

    let vx = velocityX;
    let vy = velocityY;
    const angVel = getEntityAngVel(parentEntity);
    const rx = startWx;
    const ry = startWy;

    vx += -angVel * ry;
    vy += angVel * rx;

    // Contact input and solver output are local to the hull. Carry both into
    // world-space debris, including when stress tears a hex after the impact.
    // Deformation is a displacement, not a velocity; an old dent adds no kick.
    const localVx = (Number(this.__collVelX) || 0) + (Number(this.__velX) || 0);
    const localVy = (Number(this.__collVelY) || 0) + (Number(this.__velY) || 0);
    const impulseWx = localDeltaToWorldX(localVx, localVy, scaleX, scaleY, c, s, billboardOrientation);
    const impulseWy = localDeltaToWorldY(localVx, localVy, scaleX, scaleY, c, s, billboardOrientation);
    this.dvx = vx + impulseWx;
    this.dvy = vy + impulseWy;
    const spinRadius = Math.max(1, this.radius * scale);
    const contactSpin = (rx * impulseWy - ry * impulseWx) / (rx * rx + ry * ry + spinRadius * spinRadius);
    this.drot = angVel + Math.max(-2.4, Math.min(2.4, contactSpin)) + (Math.random() - 0.5) * 0.4;
    this.angle = rotation;
    this.alpha = 1;
    this.isDebris = true;
    this.active = false;

    if (typeof window !== 'undefined' && window.spawnGpuDebris) {
      window.spawnGpuDebris(this, parentEntity.hexGrid, this.worldX, this.worldY, this.dvx, this.dvy, this.drot, this.angle, scale);
    }

    if (parentEntity.mass) {
      parentEntity.mass -= getShardMass(this);
      if (parentEntity.mass < 10) parentEntity.mass = 10;
    }
  }

  drawShape(ctx) {
    ctx.save();
    ctx.translate(this.gridX + this.deformation.x, this.gridY + this.deformation.y);
    this._drawHexPath(ctx);
    ctx.clip();

    if (this.color) {
      ctx.fillStyle = this.color;
      ctx.fill();
    } else if (this.img) {
      ctx.drawImage(this.img, -this.origGridX, -this.origGridY);
    } else {
      ctx.fillStyle = '#222';
      ctx.fill();
    }

    const stressSq = this.deformation.x * this.deformation.x + this.deformation.y * this.deformation.y;
    if (stressSq > 25) {
      const ratio = Math.min(1, Math.sqrt(stressSq) / DESTRUCTOR_CONFIG.tearThreshold);
      ctx.fillStyle = STRESS_COLORS[Math.min(31, Math.round(ratio * 31))];
      ctx.fill();
    }
    ctx.restore();
  }

  _drawHexPath(ctx) {
    ctx.beginPath();
    this._traceHexPath(ctx, 0, 0, 1.08);
  }

  _traceHexPath(ctx, originX, originY, overlap) {
    const mask = this.edgeMask;
    let radialScale = mask ? mask[0] : 1;
    let fx = this.verts[0].x * radialScale + this.frays[0].x * radialScale;
    let fy = this.verts[0].y * radialScale + this.frays[0].y * radialScale;

    ctx.moveTo(originX + fx * overlap, originY + fy * overlap);

    for (let i = 1; i < 6; i++) {
      radialScale = mask ? mask[i] : 1;
      fx = this.verts[i].x * radialScale + this.frays[i].x * radialScale;
      fy = this.verts[i].y * radialScale + this.frays[i].y * radialScale;
      ctx.lineTo(originX + fx * overlap, originY + fy * overlap);
    }
    ctx.closePath();
  }
}

const _staticProbeResult = { hitShard: null, localX: 0, localY: 0, scale: 1, scaleX: 1, scaleY: 1, c: 1, s: 0, cx: 0, cy: 0, pX: 0, pY: 0, billboardOrientation: false };
const _staticSweepResult = { hitShard: null, t: 0, worldX: 0, worldY: 0, projectileX: 0, projectileY: 0 };

// Czy któreś z ciał ruszonych w tym kroku (lista z resolveCollisions) jest
// w zasięgu testu odległości pary: ten sam wzór co w pętli kandydatów
// (ar + querySpeedA + br + min(frameSpeedB, 2·br)), więc odrzucenie tutaj
// odrzuca dokładnie te pary, które odpadłyby tam.
function isNearCollisionMoved(ax, ay, reachA, list) {
  for (let t = 0; t < list.length; t++) {
    const T = list[t];
    if (!T || T.dead) continue;
    const tr = Number(T._bpRadius) || 100;
    const rs = reachA + tr + Math.min(Number(T._frameSpeed) || 0, tr * 2);
    const dx = ax - getEntityPosX(T);
    const dy = ay - getEntityPosY(T);
    if (dx * dx + dy * dy <= rs * rs) return true;
  }
  return false;
}

export const DestructorSystem = {
  splitQueue: [],
  _tick: 0,
  _stepDt: 1 / 120,
  _frameContacts: 0,
  // Ciała przesunięte przez kontakt w bieżącym / poprzednim przebiegu kolizji
  // (resolveCollisions). Przebiegi poprawkowe liczą tylko pary z takim ciałem.
  _collIterStamp: 0,
  _collMovedCur: [],
  _collMovedSpare: [],
  // Lista encji z ostatniego kroku fizyki — updateVisuals() (render rate) korzysta z niej,
  // gdy wywołanie nie dostarcza własnej listy.
  _visualEntities: null,

  // Limit removed: 1024 contacts to handle very large hull surfaces in one pass.
  _contactsBuf: Array.from({ length: 1024 }, () => ({
    shardA: null,
    shardB: null,
    worldAx: 0,
    worldAy: 0,
    worldBx: 0,
    worldBy: 0,
    normalX: 0,
    normalY: 0,
    penetration: 0
  })),

  _hullContactPairs: new WeakMap(),
  _simulationTime: 0,

  // Próbki szwu dla CollisionFX: [x, y, nx, ny] × K. Alokowane RAZ; rosną tylko
  // wtedy, gdy ktoś podniesie seamSparkPoints w panelu deweloperskim.
  _grindPoints: new Float32Array(8 * 4),

  // Żar brzegu rany dla heksów ginących W TRAKCIE zgniotu (collideEntities,
  // łącznie z rozejściem nadmiaru przez applyImpact). Poza zderzeniem 0 —
  // pocisk zabijający zimny heks nie rozżarza wyrwy.
  _woundHeatContext: 0,

  // Heks właśnie zginął: jego OCALALI sąsiedzi są teraz krawędzią wyrwy.
  // To ona ma świecić — odłamek odlatuje i znika, brzeg zostaje na kadłubie.
  // Koszt: do 6 + 36 sąsiadów na zniszczony heks, bez pętli po siatce.
  _heatWoundRim(entity, shard) {
    const grid = entity.hexGrid;
    const neighbors = shard.neighbors;
    if (!grid || !neighbors || neighbors.length === 0) return;
    const context = this._woundHeatContext;
    // Zimne zabicie poza zderzeniem (np. pocisk) — nie ma czego rozprowadzać.
    if (!(context > 0) && !((Number(shard.heat) || 0) > 0)) return;

    const nowSec = nowMs() * 0.001;
    const inherit = Math.max(0, Number(DESTRUCTOR_CONFIG.woundHeatInherit) || 0);
    const rim = Math.min(1, Math.max(context, shardHeatNow(shard, nowSec) * inherit));
    if (rim < 0.02) return;
    const ring2 = rim * Math.max(0, Number(DESTRUCTOR_CONFIG.woundHeatRing2) || 0);

    const shards = grid.shards;
    let dirtyMin = Number.POSITIVE_INFINITY;
    let dirtyMax = -1;

    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      if (!n || !n.active || n.isDebris) continue;
      // Po podziale sąsiad mógł przejść do innej encji — piszemy tylko w swoją.
      const nIdx = n.__meshIndex;
      if (shards[nIdx] !== n) continue;
      if (raiseShardHeat(n, rim, nowSec)) {
        if (nIdx < dirtyMin) dirtyMin = nIdx;
        if (nIdx > dirtyMax) dirtyMax = nIdx;
      }
      const outer = n.neighbors;
      if (ring2 < 0.02 || !outer) continue;
      for (let j = 0; j < outer.length; j++) {
        const m = outer[j];
        if (!m || m === shard || !m.active || m.isDebris) continue;
        const mIdx = m.__meshIndex;
        if (shards[mIdx] !== m) continue;
        if (raiseShardHeat(m, ring2, nowSec)) {
          if (mIdx < dirtyMin) dirtyMin = mIdx;
          if (mIdx > dirtyMax) dirtyMax = mIdx;
        }
      }
    }

    if (dirtyMax >= 0) markGridHeatDirtyRange(grid, dirtyMin, dirtyMax);
  },

  _recordFractureImpact(entity, wx, wy, vx, vy) {
    const grid = entity.hexGrid;
    const impact = grid._fractureImpact || (grid._fractureImpact = { x: 0, y: 0, vx: 0, vy: 0, time: 0 });
    const angle = getEntityHexAngle(entity), c = Math.cos(angle), s = Math.sin(angle);
    const sx = Math.max(0.0001, getFinalScaleX(entity)), sy = Math.max(0.0001, getFinalScaleY(entity));
    const billboard = usesBillboardOrientation(entity);
    // Store sprite-local coordinates so the remembered cut follows a turning hull.
    impact.x = worldDeltaToLocalX(wx - getEntityPosX(entity), wy - getEntityPosY(entity), sx, sy, c, s, billboard) + grid.srcWidth * 0.5 + (grid.pivot?.x || 0);
    impact.y = worldDeltaToLocalY(wx - getEntityPosX(entity), wy - getEntityPosY(entity), sx, sy, c, s, billboard) + grid.srcHeight * 0.5 + (grid.pivot?.y || 0);
    impact.vx = worldDeltaToLocalX(vx, vy, sx, sy, c, s, billboard);
    impact.vy = worldDeltaToLocalY(vx, vy, sx, sy, c, s, billboard);
    impact.time = this._simulationTime;
  },

  _queueStretchedFracture(entity, shard) {
    if (entity.noSplit || !entity.hexGrid._fractureImpact || this.splitQueue.indexOf(entity) !== -1) return;
    const limit = HEX_HEIGHT + Math.max(HEX_HEIGHT * 1.5, Number(DESTRUCTOR_CONFIG.tearThreshold) || 34);
    const x = getShardVisualGridX(shard), y = getShardVisualGridY(shard);
    for (const neighbor of shard.neighbors) {
      if (!neighbor.active || neighbor.isDebris) continue;
      const dx = getShardVisualGridX(neighbor) - x, dy = getShardVisualGridY(neighbor) - y;
      if (dx * dx + dy * dy > limit * limit) {
        this.splitQueue.push(entity);
        return;
      }
    }
  },

  hasHullContact(A, B) {
    const pair = this._hullContactPairs.get(A)?.get(B);
    // `hull` odróżnia rekordy par kadłub-kadłub od rekordów ringu i asteroid,
    // które trafiają do tej samej mapy wyłącznie na potrzeby CollisionFX.
    // AI ustępuje destructorowi tylko przy metalu o metal, jak dotąd.
    return !!pair && pair.hull === true && pair.until > this._simulationTime;
  },

  // Rekord pary dla KAŻDEGO zetknięcia — także z ring segmentem i z asteroidą.
  // `fresh` mówi, że para właśnie się zetknęła po separacji (okno 0.1 s); na tym
  // stoi jednorazowe zdarzenie uderzenia. Historia ustępowania (yieldPressure)
  // i zrzut wektora AI zostają wyłącznie w gałęzi kadłubowej niżej.
  _pairRecord(A, B) {
    let pairsA = this._hullContactPairs.get(A);
    let pair = pairsA?.get(B);
    if (!pair) {
      if (!pairsA) this._hullContactPairs.set(A, pairsA = new WeakMap());
      let pairsB = this._hullContactPairs.get(B);
      if (!pairsB) this._hullContactPairs.set(B, pairsB = new WeakMap());
      pair = {
        until: 0,
        yieldPressure: 0,
        hull: false,
        fresh: false,
        lastImpactTime: -Infinity,
        lastImpactEnergy: 0
      };
      pairsA.set(B, pair);
      pairsB.set(A, pair);
    }
    pair.fresh = pair.until <= this._simulationTime;
    pair.until = this._simulationTime + 0.1;
    return pair;
  },

  _recordHullContact(A, B) {
    const pair = this._pairRecord(A, B);
    pair.hull = true;
    if (pair.fresh) {
      pair.yieldPressure = 0;
      // Drop the cached AI avoidance vector immediately on physical contact.
      A.__sepDecisionTick = -1;
      B.__sepDecisionTick = -1;
    }
    return pair;
  },

  perf: {
    lastUpdateMs: 0,
    lastDeformMs: 0,
    lastVisualDeformMs: 0,
    lastGpuSoftBodyMs: 0,
    lastElasticityMs: 0,
    lastCollisionMs: 0,
    lastSplitMs: 0,
    lastEraseMs: 0,
    lastContacts: 0
  },

  // Tracer TARANU. Istniejacy _liveCollisionDebug jest profilerem (czasy, liczby
  // par) i nie pokazuje WARTOSCI fizycznych, a przy taranie fregaty vs Bellatora
  // roznica siedzi wlasnie w liczbach: predkosc zblizania po impulsie, liczba
  // kontaktow, glebokosc zgniotu. Wlaczenie: DestructorSystem.ramDebug.enabled = true
  ramDebug: {
    enabled: false,
    intervalMs: 120,
    _lastLogMs: 0,
    // Loguj tylko pary, w ktorych bierze udzial gracz — inaczej bitwa zaleje konsole.
    playerOnly: true
  },

  _dbgRam(A, B, info) {
    const dbg = this.ramDebug;
    if (!dbg?.enabled) return;
    if (dbg.playerOnly && !(A?.isPlayer || B?.isPlayer || A?._isPlayerShip || B?._isPlayerShip)) return;
    const now = nowMs();
    if (now - dbg._lastLogMs < dbg.intervalMs) return;
    dbg._lastLogMs = now;
    const name = (e) => String(e?.type || e?.shipFrame || (e?.isPlayer ? 'PLAYER' : '?'));
    console.log(
      '[RAM] ' + name(A) + '(' + Math.round(info.massA) + ') vs ' + name(B) + '(' + Math.round(info.massB) + ')' +
      ' | impact=' + info.impactSpeed.toFixed(1) +
      ' approach=' + info.approachSpeed.toFixed(1) +
      ' | kontakty=' + info.contactsCount +
      ' | crushE=' + info.crushEnergy.toFixed(2) +
      ' | ratioA=' + info.realRatioA.toFixed(3) + ' ratioB=' + info.realRatioB.toFixed(3) +
      ' | zgniotA=' + info.rawCrushMagA.toFixed(2) + ' zgniotB=' + info.rawCrushMagB.toFixed(2) +
      ' (limit ' + info.maxCrushLimit.toFixed(0) + ')' +
      ' | angVelB=' + (Number(getEntityAngVel(B)) || 0).toFixed(3)
    );
  },

  _liveCollisionDebug: {
    enabled: false,
    intervalMs: 1000,
    startedAt: 0,
    lastFlushAt: 0,
    frames: 0,
    frameMsSum: 0,
    frameMsMax: 0,
    pairCandidates: 0,
    pairNarrow: 0,
    ringPairs: 0,
    queryCandidates: 0,
    queryReturned: 0,
    buckets: Object.create(null)
  },

  _dbgCollisionReset(intervalMs = null) {
    const dbg = this._liveCollisionDebug;
    if (!dbg) return;
    if (intervalMs != null) dbg.intervalMs = Math.max(250, Number(intervalMs) || 1000);
    dbg.frames = 0;
    dbg.frameMsSum = 0;
    dbg.frameMsMax = 0;
    dbg.pairCandidates = 0;
    dbg.pairNarrow = 0;
    dbg.ringPairs = 0;
    dbg.queryCandidates = 0;
    dbg.queryReturned = 0;
    dbg.buckets = Object.create(null);
  },

  setCollisionLiveDebug(enabled = true, intervalMs = 1000) {
    const dbg = this._liveCollisionDebug;
    if (!dbg) return null;
    dbg.enabled = !!enabled;
    dbg.intervalMs = Math.max(250, Number(intervalMs) || 1000);
    const now = nowMs();
    if (dbg.enabled) {
      dbg.startedAt = now;
      dbg.lastFlushAt = now;
      this._dbgCollisionReset();
      console.log(`[ColFuncDBG] ON interval=${dbg.intervalMs}ms`);
    } else {
      console.log('[ColFuncDBG] OFF');
      this._dbgCollisionReset();
    }
    return { enabled: dbg.enabled, intervalMs: dbg.intervalMs };
  },

  _dbgCollisionRecord(name, ms) {
    const dbg = this._liveCollisionDebug;
    if (!dbg?.enabled) return;
    const key = String(name || '');
    let bucket = dbg.buckets[key];
    if (!bucket) {
      bucket = dbg.buckets[key] = { calls: 0, sum: 0, max: 0 };
    }
    bucket.calls++;
    bucket.sum += ms;
    if (ms > bucket.max) bucket.max = ms;
  },

  _dbgCollisionFlush(now = nowMs(), force = false) {
    const dbg = this._liveCollisionDebug;
    if (!dbg?.enabled) return;
    if (!force && (now - dbg.lastFlushAt) < dbg.intervalMs) return;

    const fmt = (name) => {
      const b = dbg.buckets[name];
      if (!b || b.calls <= 0) return '0.000/0.00ms x0';
      const avg = b.sum / b.calls;
      return `${avg.toFixed(3)}/${b.max.toFixed(2)}ms x${b.calls}`;
    };

    let topName = '';
    let topMs = 0;
    for (const [name, b] of Object.entries(dbg.buckets)) {
      if ((b?.max || 0) > topMs) {
        topMs = b.max;
        topName = name;
      }
    }

    const elapsed = (now - dbg.startedAt) / 1000;
    const frameAvg = dbg.frames > 0 ? (dbg.frameMsSum / dbg.frames) : 0;

    console.log(`[ColFuncDBG ${elapsed.toFixed(1)}s]`, {
      frame: `${frameAvg.toFixed(2)}/${dbg.frameMsMax.toFixed(2)}ms x${dbg.frames}`,
      pairs: `cand=${dbg.pairCandidates} narrow=${dbg.pairNarrow} ring=${dbg.ringPairs}`,
      query: `cand=${dbg.queryCandidates} ret=${dbg.queryReturned}`,
      update: fmt('update'),
      deformTotal: `${(Number(this.perf?.lastDeformMs) || 0).toFixed(2)}ms`,
      visualDeform: fmt('updateVisualDeformation'),
      gpuSoftBody: fmt('gpuSoftBodyTick'),
      prepare: fmt('prepareBroadphase'),
      resolve: fmt('resolveCollisions'),
      queryFn: fmt('queryBroadphase'),
      collide: fmt('collideEntities'),
      elasticity: fmt('simulateElasticity'),
      impact: fmt('applyImpact'),
      deform: fmt('distributeStructuralDamage'),
      split: fmt('processSplits'),
      eraseFlush: fmt('flushPendingShardErases'),
      topSpike: topName ? `${topName}:${topMs.toFixed(2)}ms` : 'n/a'
    });

    dbg.lastFlushAt = now;
    this._dbgCollisionReset();
  },

  // --- ZMIENNE OPTYMALIZACYJNE ---
  _bpTable: Array.from({ length: 4096 }, () => []),
  _bpMask: 4095,
  _bpTouched: [],
  _wreckPool: [],
  _bpCellSize: DESTRUCTOR_CONFIG.broadphaseCellSize,
  _bpQueryBuffer: [],
  _bpQueryCount: 0,
  _bpQueryStamp: 1,
  _bpGatherStamp: 1,
  _splitStamp: 1,
  _splitUniqueBuffer: [],
  _crushStampCounter: 0,
  _crushStampA: 0,
  _crushStampB: 0,

  // Ciało ruszone kontaktem w przebiegu `stamp` (raz na przebieg na liście).
  _markCollisionMoved(entity, stamp) {
    if (!entity || entity._collMovedStamp === stamp) return;
    entity._collMovedStamp = stamp;
    this._collMovedCur.push(entity);
  },

  wakeWreck(wreck) {
    if (!wreck?.isWreck) return;
    wreck._wreckSleeping = false;
    wreck._wreckSleepTimer = 0;
  },

  // Czy kontakt w collideEntities ma obudzić wrak (px..w = stan wraku sprzed
  // kontaktu). Szybka para albo ruchome ciało obok (ten sam próg co sen wraku
  // w pętli wraków) — tak; poza tym tylko gdy kontakt naprawdę ruszył wrak.
  // Styk dwóch ciał w spoczynku nie zeruje licznika snu.
  _wreckContactWakes(wreck, other, relSpeed, px, py, vx, vy, w) {
    if (relSpeed >= WRECK_WAKE_REL_SPEED) return true;
    const ovx = getEntityVelX(other);
    const ovy = getEntityVelY(other);
    if (ovx * ovx + ovy * ovy >= WRECK_SLEEP_LINEAR_SPEED * WRECK_SLEEP_LINEAR_SPEED) return true;
    const dvx = getEntityVelX(wreck) - vx;
    const dvy = getEntityVelY(wreck) - vy;
    if (dvx * dvx + dvy * dvy >= WRECK_CONTACT_WAKE_DV * WRECK_CONTACT_WAKE_DV) return true;
    if (Math.abs(getEntityAngVel(wreck) - w) >= WRECK_SLEEP_ANGULAR_SPEED) return true;
    const dx = getEntityPosX(wreck) - px;
    const dy = getEntityPosY(wreck) - py;
    return dx * dx + dy * dy >= WRECK_CONTACT_WAKE_DP * WRECK_CONTACT_WAKE_DP;
  },

  _prepareBroadphase(entities) {
    const dbgEnabled = this._liveCollisionDebug?.enabled === true;
    const tBroadphase0 = dbgEnabled ? nowMs() : 0;
    const cellSize = Math.max(300, Number(DESTRUCTOR_CONFIG.broadphaseCellSize) || 2400);
    this._bpCellSize = cellSize;
    const table = this._bpTable;
    const touched = this._bpTouched;

    for (let i = 0; i < touched.length; i++) {
      table[touched[i]].length = 0;
    }
    touched.length = 0;

    const mask = this._bpMask;
    const len = entities.length;

    for (let i = 0; i < len; i++) {
      const ent = entities[i];
      if (!ent?.hexGrid || ent.dead || ent.isCollidable === false) {
        if (ent) {
          ent._hasActiveHex = false;
          ent._bpRadius = 0;
        }
        continue;
      }

      const hasActiveHex = hasActiveStructuralHexes(ent);
      ent._hasActiveHex = hasActiveHex;

      if (!hasActiveHex) {
        ent._bpRadius = 0;
        continue;
      }

      const x = getEntityPosX(ent);
      const y = getEntityPosY(ent);
      const vx = getEntityVelX(ent) * (1 / 60);
      const vy = getEntityVelY(ent) * (1 / 60);
      const rawSpeed = Math.sqrt(vx * vx + vy * vy);
      const speedExtension = Math.min(rawSpeed, cellSize);
      ent._frameSpeed = rawSpeed; // cache for swept collision

      // Sito kolizji = sam kadłub. Tarcza nie jest ciałem fizycznym (blokuje
      // ostrzał, nie kadłuby), więc nie poszerza promienia broadphase.
      const bpRadius = getBroadphaseRadius(ent);
      ent._bpRadius = bpRadius;

      const radius = bpRadius + speedExtension;
      const minCx = Math.floor((x - radius) / cellSize);
      const maxCx = Math.floor((x + radius) / cellSize);
      const minCy = Math.floor((y - radius) / cellSize);
      const maxCy = Math.floor((y + radius) / cellSize);

      ent._destrBpIndex = i;

      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const hash = ((cx * 73856093) ^ (cy * 19349663));
          const posHash = (hash >>> 0) & mask;
          const bucket = table[posHash];
          if (bucket.length === 0) touched.push(posHash);
          bucket.push(ent);
        }
      }
    }

    if (dbgEnabled) this._dbgCollisionRecord('prepareBroadphase', nowMs() - tBroadphase0);
  },

  _queryBroadphase(x, y, radius) {
    const dbgEnabled = this._liveCollisionDebug?.enabled === true;
    const tQuery0 = dbgEnabled ? nowMs() : 0;

    const finish = (retCount) => {
      if (dbgEnabled) {
        this._liveCollisionDebug.queryReturned += retCount;
        this._dbgCollisionRecord('queryBroadphase', nowMs() - tQuery0);
      }
      return retCount;
    };

    const queryRadius = Math.max(80, Number(radius) || 80);
    const cellSize = this._bpCellSize || 2400;
    const minCx = Math.floor((x - queryRadius) / cellSize);
    const maxCx = Math.floor((x + queryRadius) / cellSize);
    const minCy = Math.floor((y - queryRadius) / cellSize);
    const maxCy = Math.floor((y + queryRadius) / cellSize);

    const out = this._bpQueryBuffer;
    let count = 0;
    const maxCandidates = Math.max(64, Number(DESTRUCTOR_CONFIG.broadphaseMaxCandidates) || 256);

    let gatherStamp = (this._bpGatherStamp + 1) | 0;
    if (gatherStamp <= 0) gatherStamp = 1;
    this._bpGatherStamp = gatherStamp;

    const mask = this._bpMask;
    const table = this._bpTable;

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const hash = ((cx * 73856093) ^ (cy * 19349663));
        const posHash = (hash >>> 0) & mask;
        const cell = table[posHash];

        for (let i = 0; i < cell.length; i++) {
          const ent = cell[i];
          if (dbgEnabled) this._liveCollisionDebug.queryCandidates++;
          if (ent?._destrBpGather === gatherStamp) continue;

          ent._destrBpGather = gatherStamp;
          if (!ent?._hasActiveHex) continue;

          const dx = x - getEntityPosX(ent);
          const dy = y - getEntityPosY(ent);
          const rs = queryRadius + (Number(ent?._bpRadius) || 100);

          if (dx * dx + dy * dy > rs * rs) continue;

          out[count++] = ent;
          if (count >= maxCandidates) {
            this._bpQueryCount = count;
            return finish(count);
          }
        }
      }
    }

    this._bpQueryCount = count;
    return finish(count);
  },

  wakeHexEntity(entity, holdFrames = 0) {
    const grid = entity?.hexGrid;
    if (!grid) return;
    grid.isSleeping = false;
    grid.sleepFrames = 0;
    if (holdFrames > 0) {
      const prevHold = Number(grid.wakeHoldFrames) || 0;
      grid.wakeHoldFrames = Math.max(prevHold, holdFrames | 0);
    }
  },

  _queueShardErase(entity, shard) {
    const grid = entity?.hexGrid;
    if (!grid || !shard) return;
    let queue = grid._pendingEraseQueue;

    if (!Array.isArray(queue)) {
      queue = [];
      grid._pendingEraseQueue = queue;
    }

    if (shard.__eraseQueued) return;
    shard.__eraseQueued = true;
    queue.push(shard);
  },

  _flushPendingShardErases(entities) {
    const list = Array.isArray(entities) ? entities : [];

    for (let i = 0; i < list.length; i++) {
      const entity = list[i];
      const grid = entity?.hexGrid;
      const queue = grid?._pendingEraseQueue;

      if (!grid || !Array.isArray(queue) || queue.length === 0) continue;

      const ctx = grid.cacheCtx;

      if (ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        for (let q = 0; q < queue.length; q++) {
          const shard = queue[q];
          if (!shard) continue;
          const x = shard.gridX + shard.deformation.x;
          const y = shard.gridY + shard.deformation.y;
          shard._traceHexPath(ctx, x, y, 1.12);
          shard.__eraseQueued = false;
          queue[q] = null;
        }
        ctx.fill();
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
      } else {
        for (let q = 0; q < queue.length; q++) {
          const shard = queue[q];
          if (shard) shard.__eraseQueued = false;
          queue[q] = null;
        }
      }
      queue.length = 0;
      grid.gpuTextureNeedsUpdate = true;
    }
  },

  update(dt, entities) {
    const dbgEnabled = this._liveCollisionDebug?.enabled === true;
    const tUpdate0 = nowMs();
    const list = Array.isArray(entities) ? entities : [];
    const step = Number.isFinite(dt) ? Math.max(0.0001, dt) : (1 / 120);
    refreshCollisionDeformScale();

    // Praca wizualna (lerp deformacji, GPU soft body, elastyczność, erase cache)
    // wykonuje się raz na klatkę renderu w updateVisuals() — tu zostaje sama fizyka.
    this._visualEntities = list;
    this._tick++;
    // Liczniki w krokach (split, odroczenie splitu) są strojone przy 1/120 s —
    // przy innym kroku fizyki (?physHz) przeliczamy je przez ticksAt120.
    this._stepDt = step;
    this._simulationTime += step;

    this._frameContacts = 0;
    const tCollision0 = nowMs();
    this._prepareBroadphase(list);

    const iters = Math.max(1, DESTRUCTOR_CONFIG.collisionIterations | 0);
    for (let i = 0; i < iters; i++) {
      const doDamage = (i === 0);
      const skipRingPairs = (i > 0);
      this.resolveCollisions(list, step, doDamage, skipRingPairs, true, i);
    }


    const tAfterCollision = nowMs();
    const splitInterval = ticksAt120(Math.max(1, DESTRUCTOR_CONFIG.splitCheckInterval | 0), step);
    if (this._tick % splitInterval === 0 && this.splitQueue.length > 0) this.processSplits(list);
    const tUpdateEnd = nowMs();

    this.perf.lastUpdateMs = tUpdateEnd - tUpdate0;
    this.perf.lastCollisionMs = tAfterCollision - tCollision0;
    this.perf.lastSplitMs = tUpdateEnd - tAfterCollision;
    this.perf.lastContacts = this._frameContacts;

    if (dbgEnabled) {
      const frameMs = tUpdateEnd - tUpdate0;
      const dbg = this._liveCollisionDebug;
      dbg.frames++;
      dbg.frameMsSum += frameMs;
      if (frameMs > dbg.frameMsMax) dbg.frameMsMax = frameMs;
      this._dbgCollisionRecord('update', frameMs);
      this._dbgCollisionFlush(tUpdateEnd, false);
    }
  },

  // Wywoływane raz na klatkę renderu (rAF), NIE w pętli fizyki 120 Hz.
  // dt = czas realnej klatki; lerp/sprężyny są skalowane dt, więc wynik wizualny
  // jest ten sam, a koszt spada z (kroki fizyki × praca) do (1 × praca) na klatkę.
  updateVisuals(dt, entities = null) {
    const dbgEnabled = this._liveCollisionDebug?.enabled === true;
    const list = Array.isArray(entities)
      ? entities
      : (Array.isArray(this._visualEntities) ? this._visualEntities : []);
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0.0001, dt)) : (1 / 60);
    refreshCollisionDeformScale();

    const tDeform0 = nowMs();
    this.updateVisualDeformation(list, step);
    const tAfterVisualDeform = nowMs();
    DestructorGpuSoftBody.tick(list, DESTRUCTOR_CONFIG, step);
    const tAfterGpuSoftBody = nowMs();
    this.simulateElasticity(list, step);
    const tAfterDeform = nowMs();
    this._flushPendingShardErases(list);
    const tAfterErase = nowMs();

    this.perf.lastDeformMs = tAfterDeform - tDeform0;
    this.perf.lastVisualDeformMs = tAfterVisualDeform - tDeform0;
    this.perf.lastGpuSoftBodyMs = tAfterGpuSoftBody - tAfterVisualDeform;
    this.perf.lastElasticityMs = tAfterDeform - tAfterGpuSoftBody;
    this.perf.lastEraseMs = tAfterErase - tAfterDeform;

    if (dbgEnabled) {
      this._dbgCollisionRecord('updateVisualDeformation', tAfterVisualDeform - tDeform0);
      this._dbgCollisionRecord('gpuSoftBodyTick', tAfterGpuSoftBody - tAfterVisualDeform);
      this._dbgCollisionRecord('flushPendingShardErases', tAfterErase - tAfterDeform);
    }
  },

  updateVisualDeformation(entities, dt) {
    const sleepFramesLimit = Math.max(1, DESTRUCTOR_CONFIG.elasticSleepFrames | 0);
    const sleepThreshold = Math.max(0.0001, Number(DESTRUCTOR_CONFIG.elasticSleepThreshold) || 0.08);
    const velThreshold = Math.max(0.0001, Number(DESTRUCTOR_CONFIG.elasticSleepVelocityThreshold) || 0.03);
    const snapThreshold = Math.max(0.0001, Number(DESTRUCTOR_CONFIG.elasticSleepSnapThreshold) || 0.04);
    const visThreshold = 0.05;
    const lerpK = Math.min(1, Math.max(0, DESTRUCTOR_CONFIG.visualLerpSpeed * dt));
    // Liczniki sleep/wake są skalibrowane w tickach fizyki (1/120 s). Ta metoda działa
    // teraz w rytmie renderu, więc przeliczamy dt na ekwiwalent ticków — czas realny
    // usypiania/budzenia nie zależy od fps.
    const framesPerTick = Math.max(1, Math.round(dt * 120));

    // Wygaszanie licznika dryfu: podbija go kolizja, ale nikt by go nie obnizyl,
    // gdy blacha sie wyprostuje (repair) — a wtedy pudlo OBB zostaje zawyzone na
    // stale. Przelicz jest O(heksy), wiec idzie round-robin: w kazdej klatce
    // porcja cial, cale pole odswieza sie w DRIFT_REFRESH_FRAMES klatek. Miedzy
    // przeliczami licznik moze byc tylko ZA WYSOKI (kolizja go podbija od razu),
    // czyli pudlo bywa za duze — nigdy za male.
    const DRIFT_REFRESH_FRAMES = 8;
    const driftCursor = this._driftCursor = ((Number(this._driftCursor) || 0) + 1) % DRIFT_REFRESH_FRAMES;
    let driftIndex = 0;

    for (const e of entities) {
      const grid = e?.hexGrid;
      if (!grid?.shards) continue;

      if ((driftIndex++ % DRIFT_REFRESH_FRAMES) === driftCursor) refreshMaxHexDrift(grid);

      // WYGASZANIE _gpuForceAwakeFrames NALEZY DO DESTRUKTORA, nie do solvera.
      // Flage ustawia collideEntities i distributeStructuralDamage (16/30 klatek),
      // a dekrementowal ja WYLACZNIE DestructorGpuSoftBody._isEntityHot — czyli
      // kod, ktory: (a) w ogole nie startuje bez WebGPU, (b) zaczynal petle
      // zawsze od indeksu 0 i przerywal po 2-3 dispatchach, (c) pomijal encje
      // <64 heksow, brittle i ring-segmenty. Wszystko, czego nie dotknal,
      // zostawalo "forced awake" NA ZAWSZE: siatka nigdy nie zasypiala, a w
      // dispatcherze forcedAwake omija cooldown i backpressure kolejki, wiec te
      // same pierwsze encje z listy dozywotnio zjadaly caly budzet GPU.
      // Tutaj petla po encjach leci raz na klatke renderu i BEZ zadnych bramek.
      // Licznik jest w klatkach 60 Hz (16/30 = 0,27/0,5 s) i schodzi o dt·60 —
      // dekrement o 1 na klatke skracal okno przy 144 FPS 2,4 raza (solver GPU
      // liczy kroki w czasie gry, patrz gpuSoftBodyHz).
      const forceAwake = Number(e._gpuForceAwakeFrames) || 0;
      if (forceAwake > 0) e._gpuForceAwakeFrames = Math.max(0, forceAwake - dt * 60);

      if (isBrittleEntity(e)) {
        settleBrittleVisualState(grid, sleepFramesLimit, framesPerTick);
        continue;
      }
      const shards = grid.shards;
      const len = shards.length;
      // __collVel* to impuls kolizji CZEKAJĄCY na _dispatch (konsumuje go
      // dopiero upload do GPU). Kasowanie go tutaj, w rytmie renderu, gubiło
      // słabsze uderzenia, jeśli encja nie została w tej klatce wysłana na GPU.
      // __velX/__velY są wyjściem solvera i shader snapuje je do zera przy tym
      // samym progu 0.03, więc tam czyszczenie jest bezpieczne.
      const gpuOwned = isGpuSoftBodyOwned(e, grid);
      let wakeHoldFrames = Number(grid.wakeHoldFrames) || 0;
      if (wakeHoldFrames > 0) {
        wakeHoldFrames = Math.max(0, wakeHoldFrames - framesPerTick);
        grid.wakeHoldFrames = wakeHoldFrames;
      }

      const gpuAwake = forceAwake > 0;
      const visualStartRaw = Number(grid.visualDirtyStart);
      const visualEndRaw = Number(grid.visualDirtyEnd);
      const hasVisualRange =
        !!grid.visualDirtyAll ||
        (
          Number.isFinite(visualStartRaw) &&
          Number.isFinite(visualEndRaw) &&
          visualStartRaw >= 0 &&
          visualEndRaw >= visualStartRaw &&
          visualStartRaw < len
        );

      if (!hasVisualRange) {
        if (wakeHoldFrames > 0 || gpuAwake) {
          grid.sleepFrames = 0;
          grid.isSleeping = false;
          continue;
        }
        if (grid.isSleeping) continue;

        const frames = (Number(grid.sleepFrames) || 0) + framesPerTick;
        grid.sleepFrames = frames;
        if (frames >= sleepFramesLimit) grid.isSleeping = true;
        continue;
      }

      if (grid.isSleeping && wakeHoldFrames <= 0 && !gpuAwake) grid.isSleeping = false;

      const start = grid.visualDirtyAll ? 0 : Math.max(0, visualStartRaw | 0);
      const end = grid.visualDirtyAll ? (len - 1) : Math.min(len - 1, visualEndRaw | 0);
      resetGridVisualDirtyRange(grid);

      let visualChanged = false;
      let keepAwake = wakeHoldFrames > 0 || gpuAwake;
      let peakDeformation = 0;
      let dirtyMin = Number.POSITIVE_INFINITY;
      let dirtyMax = -1;

      for (let i = start; i <= end; i++) {
        const s = shards[i];
        if (!s || !s.active || s.isDebris) continue;

        const tdx = s.targetDeformation.x;
        const tdy = s.targetDeformation.y;
        const dx = s.deformation.x;
        const dy = s.deformation.y;

        const diffX = tdx - dx;
        const diffY = tdy - dy;
        const absDiffX = Math.abs(diffX);
        const absDiffY = Math.abs(diffY);

        const velX = Math.abs(Number(s.__velX) || 0) + Math.abs(Number(s.__collVelX) || 0);
        const velY = Math.abs(Number(s.__velY) || 0) + Math.abs(Number(s.__collVelY) || 0);

        if (velX > velThreshold || velY > velThreshold) keepAwake = true;

        if (absDiffX > visThreshold || absDiffY > visThreshold) {
          s.deformation.x += diffX * lerpK;
          s.deformation.y += diffY * lerpK;
          visualChanged = true;
          keepAwake = true;
          if (i < dirtyMin) dirtyMin = i;
          if (i > dirtyMax) dirtyMax = i;
          const afterPeak = Math.max(
            Math.abs(s.targetDeformation.x - s.deformation.x),
            Math.abs(s.targetDeformation.y - s.deformation.y)
          );
          if (afterPeak > peakDeformation) peakDeformation = afterPeak;
          continue;
        }

        const restPeak = Math.max(
          Math.abs(tdx), Math.abs(tdy),
          Math.abs(dx), Math.abs(dy),
          absDiffX, absDiffY,
          velX, velY
        );
        const activityPeak = Math.max(absDiffX, absDiffY, velX, velY);

        const pendingVel = gpuOwned
          ? 0
          : Math.abs(Number(s.__collVelX) || 0) + Math.abs(Number(s.__collVelY) || 0);

        if (restPeak <= snapThreshold) {
          const hadResidual =
            Math.abs(tdx) > 0.0001 || Math.abs(tdy) > 0.0001 ||
            Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001 ||
            Math.abs(Number(s.__velX) || 0) > 0.0001 ||
            Math.abs(Number(s.__velY) || 0) > 0.0001 ||
            pendingVel > 0.0001;
          if (hadResidual) {
            s.deformation.x = 0;
            s.deformation.y = 0;
            s.targetDeformation.x = 0;
            s.targetDeformation.y = 0;
            s.__velX = 0;
            s.__velY = 0;
            if (!gpuOwned) {
              s.__collVelX = 0;
              s.__collVelY = 0;
            }
            visualChanged = true;
            if (i < dirtyMin) dirtyMin = i;
            if (i > dirtyMax) dirtyMax = i;
          }
        } else {
          const erasableVel =
            Math.abs(Number(s.__velX) || 0) + Math.abs(Number(s.__velY) || 0) + pendingVel;
          if (activityPeak <= velThreshold && erasableVel > 0.0001) {
            s.__velX = 0;
            s.__velY = 0;
            if (!gpuOwned) {
              s.__collVelX = 0;
              s.__collVelY = 0;
            }
            visualChanged = true;
            if (i < dirtyMin) dirtyMin = i;
            if (i > dirtyMax) dirtyMax = i;
          }
          if (activityPeak > peakDeformation) peakDeformation = activityPeak;
        }
      }

      if (visualChanged) {
        if (dirtyMax >= 0 && Number.isFinite(dirtyMin)) markGridMeshDirtyRange(grid, dirtyMin, dirtyMax);
        else markGridMeshDirtyAll(grid);
      }

      if (keepAwake) {
        grid.sleepFrames = 0;
        grid.isSleeping = false;
        continue;
      }

      if (!gpuAwake && peakDeformation <= sleepThreshold && wakeHoldFrames <= 0) {
        const frames = (Number(grid.sleepFrames) || 0) + framesPerTick;
        grid.sleepFrames = frames;
        if (frames >= sleepFramesLimit) grid.isSleeping = true;
      } else {
        grid.sleepFrames = 0;
        grid.isSleeping = false;
      }
    }
  },

  simulateElasticity(entities, dt) {
    const dbgEnabled = this._liveCollisionDebug?.enabled === true;
    const tElastic0 = dbgEnabled ? nowMs() : 0;

    try {
      const tension = DESTRUCTOR_CONFIG.softBodyTension;
      if (tension <= 0) return;

      const k = 1 - Math.exp(-tension * dt * 60);
      // Próg pieczenia jak w pętli niżej (yieldP), do testu „heks w ruchu”.
      const elasticYieldP = DESTRUCTOR_CONFIG.yieldPoint || 80;
      const elasticYieldSq = elasticYieldP * elasticYieldP;
      const elasticListMode = (DESTRUCTOR_CONFIG.elasticActiveList | 0) === 1;
      // Opcje dla asynchronicznego GPU
      const useGpu = (DESTRUCTOR_CONFIG.gpuSoftBody | 0) === 1;
      const gpuMin = DESTRUCTOR_CONFIG.gpuSoftBodyMinShards || 64;

      for (const e of entities) {
        const grid = e?.hexGrid;
        if (!grid?.shards) continue;
        if (isBrittleEntity(e)) continue;
        if (grid.isSleeping && (Number(grid.wakeHoldFrames) || 0) <= 0) continue;

        // CPU load killer: skip CPU elasticity for ships handled asynchronously by GPU.
        const shardCount = grid.shards.length;
        if (shardCount > 500) continue;
        if (useGpu && DestructorGpuSoftBody && DestructorGpuSoftBody.active && shardCount >= gpuMin) continue; // This ship is currently simulated asynchronously on GPU.
        if (e?.isRingSegment) continue; // Always skip rings in CPU elasticity loop

        // Tylko heksy z listy aktywnych (patrz prepareElasticMarks) — pusta
        // lista = cała siatka w spoczynku, pętla byłaby samymi no-opami.
        const marks = prepareElasticMarks(grid, elasticYieldSq);
        if (!elasticListMode) fillElasticMarks(grid, marks);
        if (grid._elasticMarkCount === 0) continue;

        // -------------------------------------------------------------
        let changed = false;
        let dirtyMin = Number.POSITIVE_INFINITY;
        let dirtyMax = -1;

        const shards = grid.shards;
        for (let si = 0; si < shards.length; si++) {
          if (marks[si] === 0) continue;
          marks[si] = 0;
          grid._elasticMarkCount--;
          const s = shards[si];
          if (!s.active || s.isDebris) continue;

          const ax = s.targetDeformation.x;
          const ay = s.targetDeformation.y;
          const defSq = ax * ax + ay * ay;
          const isResting = defSq < 0.01;

          // True plasticity baking: once yield is exceeded, commit part of the offset to base grid.
          const yieldP = DESTRUCTOR_CONFIG.yieldPoint || 80;
          // defLen służy WYŁĄCZNIE do testu progu poniżej, a defSq jest już policzone.
          // Bezwarunkowy pierwiastek kosztował tu jeden sqrt na heks na klatkę dla
          // każdego obudzonego statku. defLen > yieldP <=> defSq > yieldP^2 (obie >= 0).
          if (defSq > yieldP * yieldP) {
            const defLen = Math.sqrt(defSq);
            const excess = defLen - yieldP;
            const ratio = excess / defLen;
            const tx = s.targetDeformation.x * ratio;
            const ty = s.targetDeformation.y * ratio;
            s.gridX += tx;
            s.gridY += ty;
            s._bakedOffX = (Number(s._bakedOffX) || 0) + tx;
            s._bakedOffY = (Number(s._bakedOffY) || 0) + ty;
            s.targetDeformation.x -= tx;
            s.targetDeformation.y -= ty;
            noteHexDrift(grid, s);
            changed = true;

            const idxS = Number(s.__meshIndex);
            if (Number.isFinite(idxS)) {
              if (idxS < dirtyMin) dirtyMin = idxS;
              if (idxS > dirtyMax) dirtyMax = idxS;
            } else {
              dirtyMin = 0;
              dirtyMax = grid.shards.length - 1;
            }
          }

          // Keep CPU elasticity active even for tiny deformation magnitudes.
          for (const n of s.neighbors) {
            if (!n) continue;
            if (!n.active || n.isDebris) continue;
            // Prevent double-processing the same shard pair
            if (n.c < s.c || (n.c === s.c && n.r <= s.r)) continue;

            const bx = n.targetDeformation.x;
            const by = n.targetDeformation.y;
            if (isResting && bx * bx + by * by < 0.01) continue;

            // DODANO: Zrywanie/oslabianie sprezyn przy poteznych wgnieceniach
            const defSq = ax * ax + ay * ay;
            const yieldSq = DESTRUCTOR_CONFIG.yieldPoint * DESTRUCTOR_CONFIG.yieldPoint;
            let currentK = k;

            if (defSq > yieldSq) {
              currentK = k * 0.1; // Odksztalcenie plastyczne (blacha sie wgniata i nie wraca!)
            }

            const avgX = (ax + bx) * 0.5;
            const avgY = (ay + by) * 0.5;
            const dax = (avgX - ax) * currentK;
            const day = (avgY - ay) * currentK;
            const dbx = (avgX - bx) * currentK;
            const dby = (avgY - by) * currentK;

            if (Math.abs(dax) > 1e-5 || Math.abs(day) > 1e-5 || Math.abs(dbx) > 1e-5 || Math.abs(dby) > 1e-5) {
              changed = true;
              const idxS = Number(s.__meshIndex);
              if (Number.isFinite(idxS)) {
                if (idxS < dirtyMin) dirtyMin = idxS;
                if (idxS > dirtyMax) dirtyMax = idxS;
              } else {
                dirtyMin = 0;
                dirtyMax = grid.shards.length - 1;
              }

              const idxN = Number(n.__meshIndex);
              if (Number.isFinite(idxN)) {
                if (idxN < dirtyMin) dirtyMin = idxN;
                if (idxN > dirtyMax) dirtyMax = idxN;
              } else {
                dirtyMin = 0;
                dirtyMax = grid.shards.length - 1;
              }
            }

            s.targetDeformation.x += dax;
            s.targetDeformation.y += day;
            n.targetDeformation.x += dbx;
            n.targetDeformation.y += dby;
            // Sąsiad dalej w ruchu: on i jego sąsiedzi zostają na liście (ci
            // dalej w tablicy jeszcze w tym przebiegu, reszta w następnym).
            if (isElasticShardMoving(n, elasticYieldSq)) markElasticAround(grid, marks, n);
          }
          if (isElasticShardMoving(s, elasticYieldSq)) markElasticAround(grid, marks, s);
        }

        if (changed) {
          if (dirtyMax >= 0 && Number.isFinite(dirtyMin)) markGridMeshDirtyRange(grid, dirtyMin, dirtyMax);
          else markGridMeshDirtyAll(grid);
          grid.isSleeping = false;
          grid.sleepFrames = 0;
        }
      }
    } finally {
      if (dbgEnabled) this._dbgCollisionRecord('simulateElasticity', nowMs() - tElastic0);
    }
  },

  repair(entities, dt) {
    const list = Array.isArray(entities) ? entities : [];
    const step = Number.isFinite(dt) ? Math.max(0.0001, dt) : 0.1;
    let repairedAny = false;

    for (const e of list) {
      if (!e?.hexGrid?.shards) continue;

      let anyFix = false;
      let dirtyMin = Number.POSITIVE_INFINITY;
      let dirtyMax = -1;
      const shards = e.hexGrid.shards;

      for (let i = 0; i < shards.length; i++) {
        const s = shards[i];
        if (!s.active || s.isDebris) continue;
        const needsRepair =
          Math.abs(s.deformation.x) > 0.001 ||
          Math.abs(s.deformation.y) > 0.001 ||
          Math.abs(s.targetDeformation.x) > 0.001 ||
          Math.abs(s.targetDeformation.y) > 0.001 ||
          Math.abs((Number(s.gridX) || 0) - s.origGridX) > 0.001 ||
          Math.abs((Number(s.gridY) || 0) - s.origGridY) > 0.001 ||
          Math.abs(Number(s._bakedOffX) || 0) > 0.001 ||
          Math.abs(Number(s._bakedOffY) || 0) > 0.001 ||
          Math.abs(Number(s.__velX) || 0) > 0.001 ||
          Math.abs(Number(s.__velY) || 0) > 0.001 ||
          Math.abs(Number(s.__collVelX) || 0) > 0.001 ||
          Math.abs(Number(s.__collVelY) || 0) > 0.001 ||
          s.hp < s.maxHp;
        if (needsRepair && s.repair(step)) {
          anyFix = true;
          repairedAny = true;
          const idx = Number(s.__meshIndex);
          if (Number.isFinite(idx) && idx >= 0) {
            if (idx < dirtyMin) dirtyMin = idx;
            if (idx > dirtyMax) dirtyMax = idx;
          } else {
            dirtyMin = 0;
            dirtyMax = shards.length - 1;
          }
        }
      }

      if (anyFix) {
        e._gpuRepairStamp = ((Number(e._gpuRepairStamp) || 0) + 1) | 0;
        // Naprawa przepisuje targetDeformation hurtem — lista aktywnych od nowa.
        e.hexGrid._elasticRescan = true;
        this.wakeHexEntity(e, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);
        if (dirtyMax >= 0 && Number.isFinite(dirtyMin)) markGridMeshDirtyRange(e.hexGrid, dirtyMin, dirtyMax);
        else markGridMeshDirtyAll(e.hexGrid);
        if (!HEX_SHIPS_3D_ACTIVE) {
          e.hexGrid.textureDirty = true;
          e.hexGrid.cacheDirty = true;
        }
      }
    }
    return repairedAny;
  },

  // anyHit = wołający potrzebuje tylko odpowiedzi "czy cokolwiek trafia".
  // Bez tego probeImpact() skanował wszystkie ~29 komórek szukając najbliższego
  // heksa i wyrzucał wynik, zwracając boolean. Przy 5 sondach na hardpoint
  // (isHardpointHexSupported) to się mnożyło przez liczbę hardpointów i encji.
  // knownShard = heks już trafiony przez wołającego (sprawdzony isLiveGridShard):
  // liczymy tylko układ lokalny punktu, bez ponownego szukania.
  _probeImpactData(entity, worldX, worldY, anyHit = false, knownShard = null) {
    if (!entity?.hexGrid || !isHexEligible(entity)) return null;

    const angle = getEntityHexAngle(entity);
    const scaleX = Math.max(0.0001, getFinalScaleX(entity));
    const scaleY = Math.max(0.0001, getFinalScaleY(entity));
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const dx = worldX - getEntityPosX(entity);
    const dy = worldY - getEntityPosY(entity);
    const billboardOrientation = usesBillboardOrientation(entity);

    const localX = worldDeltaToLocalX(dx, dy, scaleX, scaleY, c, s, billboardOrientation);
    const localY = worldDeltaToLocalY(dx, dy, scaleX, scaleY, c, s, billboardOrientation);
    const cx = entity.hexGrid.srcWidth * 0.5;
    const cy = entity.hexGrid.srcHeight * 0.5;
    const pX = entity.hexGrid.pivot ? entity.hexGrid.pivot.x : 0;
    const pY = entity.hexGrid.pivot ? entity.hexGrid.pivot.y : 0;
    const gridX = localX + cx + pX;
    const gridY = localY + cy + pY;

    const cols = entity.hexGrid.cols | 0;
    const rows = entity.hexGrid.rows | 0;
    const grid = entity.hexGrid.grid;

    if (!grid || cols <= 0 || rows <= 0) return null;

    let hitShard = null;
    if (knownShard) {
      // Heks wołającego musi stać przy punkcie trafienia W TYM układzie:
      // promień sondy plus różnica pozycji wizualnej (raymarch wiązki) i
      // kolizyjnej (× collisionDeformScale). Inna geometria u wołającego
      // (np. obiekt billboardowy) = szukamy tak, jakby heksa nie podał.
      const dx = getShardCollisionGridX(knownShard) - gridX;
      const dy = getShardCollisionGridY(knownShard) - gridY;
      const reach = PROBE_MAX_HIT_RADIUS + 0.5 + Math.abs(COLLISION_DEFORM_SCALE - 1) *
        (Math.abs(knownShard.deformation.x) + Math.abs(knownShard.deformation.y));
      if (dx * dx + dy * dy <= reach * reach) hitShard = knownShard;
    }
    if (!hitShard) {
      const approxC = Math.round(gridX / HEX_SPACING);
      const approxR = Math.round(gridY / HEX_HEIGHT);
      const searchR = Math.max(2, (DESTRUCTOR_CONFIG.collisionSearchRadius | 0) - 2);
      // Siatka jest indeksowana komórką POCZĄTKOWĄ heksa, więc okno obejmuje
      // też zmierzony dryf — inaczej heks wgnieciony poza okno jest „duchem”.
      const offsets = getProbeSearchOffsets(searchR, getHexProbeDrift(entity.hexGrid));
      let bestD2 = Infinity;

      for (let oi = 0; oi < offsets.length; oi += 2) {
        const ic = approxC + offsets[oi];
        const ir = approxR + offsets[oi + 1];
        if (ic < 0 || ir < 0 || ic >= cols || ir >= rows) continue;
        const shard = grid[ic + ir * cols];
        if (!shard || !shard.active || shard.isDebris) continue;

        const sx = getShardCollisionGridX(shard);
        const sy = getShardCollisionGridY(shard);
        const d2 = (sx - gridX) ** 2 + (sy - gridY) ** 2;
        const hitRad = getShardHitRadius(shard) * 2;

        if (d2 < hitRad * hitRad && d2 < bestD2) {
          bestD2 = d2;
          hitShard = shard;
          // Offsety są posortowane rosnąco po odległości, więc pierwsze trafienie
          // jest już najbliższe albo bardzo blisko niego.
          if (anyHit) break;
        }
      }
    }

    if (!hitShard) return null;

    _staticProbeResult.hitShard = hitShard;
    _staticProbeResult.localX = localX;
    _staticProbeResult.localY = localY;
    _staticProbeResult.scaleX = scaleX;
    _staticProbeResult.scaleY = scaleY;
    _staticProbeResult.scale = Math.max(scaleX, scaleY);
    _staticProbeResult.c = c;
    _staticProbeResult.s = s;
    _staticProbeResult.cx = cx;
    _staticProbeResult.cy = cy;
    _staticProbeResult.pX = pX;
    _staticProbeResult.pY = pY;
    _staticProbeResult.billboardOrientation = billboardOrientation;

    return _staticProbeResult;
  },

  // Zwraca pierwszy AKTYWNY heks przecięty przez odcinek pocisku. Okrąg
  // `entity.radius` jest tylko broadphase'em i zwykle zawiera dużo pustego miejsca
  // przed dziobem/burtą. Punkt wejścia w ten okrąg nie może więc służyć jako punkt
  // trafienia — szybki pocisk przeszedłby przez cały pozostały odcinek bez kolejnej
  // sondy. Testujemy dokładnie heksy leżące w korytarzu ruchu i wybieramy najmniejsze t.
  sweepImpact(entity, worldX0, worldY0, worldX1, worldY1, projectileRadius = 0) {
    if (!entity?.hexGrid || !isHexEligible(entity)) return null;

    const gridData = entity.hexGrid;
    const cols = gridData.cols | 0;
    const rows = gridData.rows | 0;
    const grid = gridData.grid;
    if (!grid || cols <= 0 || rows <= 0) return null;

    const angle = getEntityHexAngle(entity);
    const scaleX = Math.max(0.0001, getFinalScaleX(entity));
    const scaleY = Math.max(0.0001, getFinalScaleY(entity));
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const entityX = getEntityPosX(entity);
    const entityY = getEntityPosY(entity);
    const billboardOrientation = usesBillboardOrientation(entity);

    const localX0 = worldDeltaToLocalX(worldX0 - entityX, worldY0 - entityY, scaleX, scaleY, c, s, billboardOrientation);
    const localY0 = worldDeltaToLocalY(worldX0 - entityX, worldY0 - entityY, scaleX, scaleY, c, s, billboardOrientation);
    const localX1 = worldDeltaToLocalX(worldX1 - entityX, worldY1 - entityY, scaleX, scaleY, c, s, billboardOrientation);
    const localY1 = worldDeltaToLocalY(worldX1 - entityX, worldY1 - entityY, scaleX, scaleY, c, s, billboardOrientation);
    const cx = gridData.srcWidth * 0.5;
    const cy = gridData.srcHeight * 0.5;
    const pX = gridData.pivot ? gridData.pivot.x : 0;
    const pY = gridData.pivot ? gridData.pivot.y : 0;
    const gridX0 = localX0 + cx + pX;
    const gridY0 = localY0 + cy + pY;
    const gridX1 = localX1 + cx + pX;
    const gridY1 = localY1 + cy + pY;

    // Pudło komórek wprost z geometrii. Heks trafia, gdy jego pozycja
    // kolizyjna leży bliżej toru niż 2 × hitRadius (≤ 2 × HIT_RAD) + promień
    // pocisku; ta pozycja odjeżdża od spoczynkowej najwyżej o zmierzony dryf na
    // oś, a spoczynkowa leży najwyżej pół komórki od środka komórki. Dawny stały
    // zapas (collisionSearchRadius − 2 komórki) był z jednej strony za duży dla
    // nietkniętego kadłuba (~2× więcej komórek), a z drugiej nie obejmował
    // wgnieceń głębszych niż ~9 px — stąd „heksy-duchy”.
    // Promień pocisku przeliczamy konserwatywnie przez mniejszą skalę osi.
    const localProjectileRadius = Math.max(0, Number(projectileRadius) || 0) / Math.min(scaleX, scaleY);
    const hitReach = PROBE_MAX_HIT_RADIUS + localProjectileRadius;
    const cellReach = hitReach + getHexProbeDrift(gridData) + 0.01;
    const segMinX = Math.min(gridX0, gridX1);
    const segMaxX = Math.max(gridX0, gridX1);
    const segMinY = Math.min(gridY0, gridY1);
    const segMaxY = Math.max(gridY0, gridY1);
    const minC = Math.max(0, Math.ceil((segMinX - cellReach) / HEX_SPACING - 0.5));
    const maxC = Math.min(cols - 1, Math.floor((segMaxX + cellReach) / HEX_SPACING + 0.5));
    const minR = Math.max(0, Math.ceil((segMinY - cellReach) / HEX_HEIGHT - 0.5));
    const maxR = Math.min(rows - 1, Math.floor((segMaxY + cellReach) / HEX_HEIGHT + 0.5));

    // Większość heksów w pudle stoi przy swoich komórkach, daleko od toru —
    // odrzuca je prostokąt toru poszerzony o zasięg trafienia, zanim policzymy
    // przecięcie z okręgiem.
    const bbMinX = segMinX - hitReach;
    const bbMaxX = segMaxX + hitReach;
    const bbMinY = segMinY - hitReach;
    const bbMaxY = segMaxY + hitReach;
    let bestT = Infinity;
    let hitShard = null;
    for (let ir = minR; ir <= maxR; ir++) {
      const rowOffset = ir * cols;
      for (let ic = minC; ic <= maxC; ic++) {
        const shard = grid[rowOffset + ic];
        if (!shard || !shard.active || shard.isDebris) continue;
        const sx = getShardCollisionGridX(shard);
        if (sx < bbMinX || sx > bbMaxX) continue;
        const sy = getShardCollisionGridY(shard);
        if (sy < bbMinY || sy > bbMaxY) continue;
        const hitRadius = getShardHitRadius(shard) * 2 + localProjectileRadius;
        const t = segmentCircleToi2D(gridX0, gridY0, gridX1, gridY1, sx, sy, hitRadius);
        if (t < 0 || t >= bestT) continue;
        bestT = t;
        hitShard = shard;
      }
    }

    if (!hitShard) return null;
    const projectileGridX = gridX0 + (gridX1 - gridX0) * bestT;
    const projectileGridY = gridY0 + (gridY1 - gridY0) * bestT;
    const shardGridX = getShardCollisionGridX(hitShard);
    const shardGridY = getShardCollisionGridY(hitShard);
    let normalX = projectileGridX - shardGridX;
    let normalY = projectileGridY - shardGridY;
    let normalLength = Math.hypot(normalX, normalY);
    if (normalLength <= 1e-9) {
      normalX = gridX0 - gridX1;
      normalY = gridY0 - gridY1;
      normalLength = Math.hypot(normalX, normalY) || 1;
    }
    const probeRadius = getShardHitRadius(hitShard) * 2 * 0.995;
    const impactGridX = shardGridX + normalX * (probeRadius / normalLength);
    const impactGridY = shardGridY + normalY * (probeRadius / normalLength);
    const impactLocalX = impactGridX - cx - pX;
    const impactLocalY = impactGridY - cy - pY;

    _staticSweepResult.hitShard = hitShard;
    _staticSweepResult.t = bestT;
    // worldX/Y leżą minimalnie WEWNĄTRZ fizycznego heksa, żeby applyImpact()
    // (punktowa sonda z ostrą granicą) zawsze trafił w ten sam pierwszy shard.
    _staticSweepResult.worldX = entityX + localDeltaToWorldX(impactLocalX, impactLocalY, scaleX, scaleY, c, s, billboardOrientation);
    _staticSweepResult.worldY = entityY + localDeltaToWorldY(impactLocalX, impactLocalY, scaleX, scaleY, c, s, billboardOrientation);
    _staticSweepResult.projectileX = worldX0 + (worldX1 - worldX0) * bestT;
    _staticSweepResult.projectileY = worldY0 + (worldY1 - worldY0) * bestT;
    return _staticSweepResult;
  },

  probeImpact(entity, worldX, worldY) {
    return !!this._probeImpactData(entity, worldX, worldY, true);
  },

  // opts.shard = heks już trafiony przez wołającego w tym punkcie (sweepImpact
  // pocisku, raymarch wiązki). Ponowne szukanie sondą gubiło trafienia: sonda
  // ma inny promień (2 × hitRadius, na brzegu kadłuba ~5,5 px) niż raymarch
  // wiązki (~9,5 px) i patrzy w inne okno komórek niż sweep. Martwy heks albo
  // heks z innej siatki (split) = zwykła sonda jak bez opts.shard.
  applyImpact(entity, worldX, worldY, damage = 0, bulletVel = { x: 0, y: 0 }, opts = null) {
    const dbgEnabled = this._liveCollisionDebug?.enabled === true;
    const tImpact0 = dbgEnabled ? nowMs() : 0;

    try {
      const knownShard = isLiveGridShard(entity?.hexGrid, opts?.shard) ? opts.shard : null;
      const probe = this._probeImpactData(entity, worldX, worldY, false, knownShard);
      if (!probe) return false;

      const { hitShard, localX, localY, scaleX, scaleY, c, s, cx, cy, pX, pY } = probe;

      if (damage <= 0) {
        if (opts?.wakeOnProbe === true) this.wakeHexEntity(entity, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);
        return true;
      }

      let forceX = worldDeltaToLocalX(
        bulletVel?.x || 0,
        bulletVel?.y || 0,
        Math.max(0.0001, scaleX || 1),
        Math.max(0.0001, scaleY || 1),
        c,
        s,
        probe.billboardOrientation === true
      );
      let forceY = worldDeltaToLocalY(
        bulletVel?.x || 0,
        bulletVel?.y || 0,
        Math.max(0.0001, scaleX || 1),
        Math.max(0.0001, scaleY || 1),
        c,
        s,
        probe.billboardOrientation === true
      );

      if (Math.sqrt(forceX * forceX + forceY * forceY) < 0.001) {
        const fx = (getShardCollisionGridX(hitShard) - cx - pX) - localX;
        const fy = (getShardCollisionGridY(hitShard) - cy - pY) - localY;
        const fm = Math.sqrt(fx * fx + fy * fy) || 1;
        forceX = (fx / fm) * Math.max(10, damage * 0.4);
        forceY = (fy / fm) * Math.max(10, damage * 0.4);
      }

      const damageScale = Math.max(0.35, damage / 80);
      markRingSegmentHot(entity, 1500, 15000);
      this.wakeHexEntity(entity, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);
      if (entity.isWreck) {
        this.wakeWreck(entity);
        // Czas symulacji (nie zegar ściany) — pauza nie „odlicza” ciszy po trafieniu.
        entity._lastImpactMs = this._simulationTime * 1000;
      }

      const customRadius = opts?.radius || DESTRUCTOR_CONFIG.bendingRadius;

      this.distributeStructuralDamage(
        entity,
        localX,
        localY,
        forceX * 0.05 * damageScale,
        forceY * 0.05 * damageScale,
        1.0,
        customRadius
      );

      const directDamage = Math.max(1, damage * 0.9);
      hitShard.hp -= directDamage;
      if ((DESTRUCTOR_CONFIG.heatFromProjectiles | 0) === 1) {
        const shardHp = Math.max(1, Number(hitShard.maxHp) || DESTRUCTOR_CONFIG.shardHP);
        const gain = Math.max(0, Number(DESTRUCTOR_CONFIG.heatGain) || 0);
        addShardHeat(hitShard, Math.min(1, directDamage / shardHp) * gain, nowMs() * 0.001);
      }
      const splitDamageThreshold = DESTRUCTOR_CONFIG.splitDamageThreshold ?? 200;

      if (hitShard.hp <= 0 && !hitShard.isDebris) {
        this.destroyShard(entity, hitShard);
        if (!entity.noSplit && damage >= splitDamageThreshold) this.splitQueue.push(entity);
      }

      markGridMeshDirtyByShard(entity.hexGrid, hitShard);

      if (!HEX_SHIPS_3D_ACTIVE) {
        entity.hexGrid.textureDirty = true;
        entity.hexGrid.cacheDirty = true;
      }

      return true;
    } finally {
      if (dbgEnabled) this._dbgCollisionRecord('applyImpact', nowMs() - tImpact0);
    }
  },

  distributeBrittleDamage(entity, impactLocalX, impactLocalY, forceX, forceY, damageScale = 1.0, customRadius = null) {
    if (!entity?.hexGrid?.shards) return;
    this.wakeHexEntity(entity, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);

    const radius = customRadius || DESTRUCTOR_CONFIG.bendingRadius;
    const invRadius = 1 / Math.max(0.0001, radius);
    const currentBendingRadSq = radius * radius;
    const forceMag = Math.hypot(forceX, forceY);
    const hardness = Math.max(0, Math.min(1, Number(entity?.hardness) || 0));
    const brittleness = Math.max(0.35, 1.25 - hardness * 0.55);

    const pX = entity.hexGrid.pivot ? entity.hexGrid.pivot.x : 0;
    const pY = entity.hexGrid.pivot ? entity.hexGrid.pivot.y : 0;
    const impactX = impactLocalX + pX;
    const impactY = impactLocalY + pY;
    const cx = entity.hexGrid.srcWidth * 0.5;
    const cy = entity.hexGrid.srcHeight * 0.5;
    const cols = entity.hexGrid.cols;
    const rows = entity.hexGrid.rows;
    const grid = entity.hexGrid.grid;
    if (!grid || !cols || !rows) return;

    const approxC = Math.round((impactX + cx) / HEX_SPACING);
    const approxR = Math.round((impactY + cy) / HEX_HEIGHT);
    const cellRadC = Math.ceil(radius / HEX_SPACING) + 2;
    const cellRadR = Math.ceil(radius / HEX_HEIGHT) + 2;
    const c0 = Math.max(0, approxC - cellRadC);
    const c1 = Math.min(cols - 1, approxC + cellRadC);
    const r0 = Math.max(0, approxR - cellRadR);
    const r1 = Math.min(rows - 1, approxR + cellRadR);

    let anyDestroyed = false;
    let dirtyMin = Number.POSITIVE_INFINITY;
    let dirtyMax = -1;
    const impactDmgBase = Math.max(1, damageScale * 8 + forceMag * 0.045);

    for (let r = r0; r <= r1; r++) {
      const rowBase = r * cols;
      for (let c = c0; c <= c1; c++) {
        const shard = grid[rowBase + c];
        if (!shard || !shard.active || shard.isDebris) continue;

        const dx = (getShardCollisionGridX(shard) - cx) - impactX;
        const dy = (getShardCollisionGridY(shard) - cy) - impactY;
        const d2 = dx * dx + dy * dy;
        if (d2 >= currentBendingRadSq) continue;

        const factor = 1 - Math.sqrt(d2) * invRadius;
        if (factor <= 0) continue;

        const influence = factor * factor * (3 - 2 * factor);
        const shardDamage = impactDmgBase * influence * brittleness;
        shard.hp -= shardDamage;
        shard.__collVelX = (Number(shard.__collVelX) || 0) + forceX * influence * 0.04;
        shard.__collVelY = (Number(shard.__collVelY) || 0) + forceY * influence * 0.04;

        const shardIdx = Number(shard.__meshIndex);
        if (Number.isFinite(shardIdx)) {
          if (shardIdx < dirtyMin) dirtyMin = shardIdx;
          if (shardIdx > dirtyMax) dirtyMax = shardIdx;
        } else {
          dirtyMin = 0;
          dirtyMax = entity.hexGrid.shards.length - 1;
        }

        if (shard.hp <= 0 && !shard.isDebris) {
          this.destroyShard(entity, shard);
          anyDestroyed = true;
        }
      }
    }

    if (dirtyMax >= 0 && Number.isFinite(dirtyMin)) {
      markBrittleTransient(entity, 0, dirtyMin, dirtyMax);
      markGridMeshDirtyRange(entity.hexGrid, dirtyMin, dirtyMax);
    }
    if (anyDestroyed && !entity.noSplit) this.splitQueue.push(entity);
  },

  distributeStructuralDamage(entity, impactLocalX, impactLocalY, forceX, forceY, damageScale = 1.0, customRadius = null) {
    const dbgEnabled = this._liveCollisionDebug?.enabled === true;
    const tDeform0 = dbgEnabled ? nowMs() : 0;

    try {
      if (!entity?.hexGrid?.shards) return;
      if (isBrittleEntity(entity)) {
        this.distributeBrittleDamage(entity, impactLocalX, impactLocalY, forceX, forceY, damageScale, customRadius);
        return;
      }
      this.wakeHexEntity(entity, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);

      const radius = customRadius || DESTRUCTOR_CONFIG.bendingRadius;
      const invRadius = 1 / radius;
      const currentBendingRadSq = radius * radius;
      const deformMul = DESTRUCTOR_CONFIG.deformMul;
      // Żar od pocisków — domyślnie WYŁĄCZONY (heatFromProjectiles = 0). Kanał
      // heat jest wymiarowany na strefę zgniotu; ostrzał ma własny język blizn.
      const projectileHeatGain = (DESTRUCTOR_CONFIG.heatFromProjectiles | 0) === 1
        ? Math.max(0, Number(DESTRUCTOR_CONFIG.heatGain) || 0)
        : 0;
      const heatNowSec = projectileHeatGain > 0 ? nowMs() * 0.001 : 0;

      let anyDestroyed = false;
      let anyMeshChange = false;
      let dirtyMin = Number.POSITIVE_INFINITY;
      let dirtyMax = -1;
      let anyTextureChange = false;

      const pX = entity.hexGrid.pivot ? entity.hexGrid.pivot.x : 0;
      const pY = entity.hexGrid.pivot ? entity.hexGrid.pivot.y : 0;
      const impactX = impactLocalX + pX;
      const impactY = impactLocalY + pY;
      const forceMag = Math.sqrt(forceX * forceX + forceY * forceY);

      const cx = entity.hexGrid.srcWidth * 0.5;
      const cy = entity.hexGrid.srcHeight * 0.5;
      const cols = entity.hexGrid.cols;
      const rows = entity.hexGrid.rows;
      const grid = entity.hexGrid.grid;

      const impactWinX = impactX + cx;
      const impactWinY = impactY + cy;
      const approxC = Math.round(impactWinX / HEX_SPACING);
      const approxR = Math.round(impactWinY / HEX_HEIGHT);
      const cellRadC = Math.ceil(radius / HEX_SPACING) + 2;
      const cellRadR = Math.ceil(radius / HEX_HEIGHT) + 2;

      let c0 = approxC - cellRadC;
      let c1 = approxC + cellRadC;
      let r0 = approxR - cellRadR;
      let r1 = approxR + cellRadR;

      if (grid && cols && rows) {
        if (c0 < 0) c0 = 0;
        if (r0 < 0) r0 = 0;
        if (c1 >= cols) c1 = cols - 1;
        if (r1 >= rows) r1 = rows - 1;

        for (let r = r0; r <= r1; r++) {
          const rowBase = r * cols;
          for (let c = c0; c <= c1; c++) {
            const shard = grid[rowBase + c];
            if (!shard || !shard.active || shard.isDebris) continue;

            const dx = (getShardCollisionGridX(shard) - cx) - impactX;
            const dy = (getShardCollisionGridY(shard) - cy) - impactY;
            const d2 = dx * dx + dy * dy;

            if (d2 >= currentBendingRadSq) continue;

            const factor = 1 - Math.sqrt(d2) * invRadius;
            if (factor <= 0) continue;

            const influence = factor * factor * (3 - 2 * factor);
            const dist = Math.sqrt(d2);
            let radialX = 0, radialY = 0;

            // Wylicz wektor promienisty od epicentrum uderzenia
            if (dist > 0.001) {
              radialX = dx / dist;
              radialY = dy / dist;
            }

            const pushX = forceX * influence * deformMul;
            const pushY = forceY * influence * deformMul;
            const bulgeFactor = 0.0;
            const bulgeX = 0.0;
            const bulgeY = 0.0;

            const appliedDefX = pushX;
			const appliedDefY = pushY;

			entity._gpuForceAwakeFrames = 30;

			// 1) środek trafienia dostaje natychmiastowy wizualny kick
			if (factor > 0.58) {
			shard.applyDeformation(
			appliedDefX * 0.28,
			appliedDefY * 0.28,
			0.60,
			false
		);
			// UWAGA: `grid` w tym zakresie to PLASKA TABLICA shardow (grid[rowBase + c]),
			// a nie obiekt siatki. Licznik musi trafic na entity.hexGrid, inaczej
			// zapis idzie na tablice i refreshEntityObb nigdy go nie zobaczy.
			noteHexDrift(entity.hexGrid, shard);
			noteElasticShard(entity.hexGrid, shard);
	} else {
  // 2) reszta pola uderzenia: seed do płynnej propagacji
  shard.targetDeformation.x += appliedDefX * 0.16;
  shard.targetDeformation.y += appliedDefY * 0.16;
  noteHexDrift(entity.hexGrid, shard);
  noteElasticShard(entity.hexGrid, shard);
}

// 3) główna fala osiowa do propagacji
const waveVel = 0.20 + influence * 0.10; // 0.20 .. 0.30
shard.__velX = (Number(shard.__velX) || 0) + (appliedDefX * waveVel);
shard.__velY = (Number(shard.__velY) || 0) + (appliedDefY * waveVel);

// 4) delikatny rim-bulge jako prędkość tymczasowa, NIE jako stałe odsunięcie
if (forceMag > 0.35 && factor > 0.18 && factor < 0.72 && dist > 0.001) {
  const rimVel = forceMag * influence * (1.0 - factor) * 0.06;
  shard.__velX += radialX * rimVel;
  shard.__velY += radialY * rimVel;
}

            anyMeshChange = true;
            const shardIdx = Number(shard.__meshIndex);

            if (Number.isFinite(shardIdx)) {
              if (shardIdx < dirtyMin) dirtyMin = shardIdx;
              if (shardIdx > dirtyMax) dirtyMax = shardIdx;
            } else {
              dirtyMin = 0;
              dirtyMax = entity.hexGrid.shards.length - 1;
            }

            // Thermal damage and friction scraping
            if (damageScale > 0) {
              // CPU no longer instantly deletes shards from pure kinetic spikes.
              // Convert impact into heat so damage accumulates over sustained scraping.
              // Shards should wear down over time instead of evaporating in one frame.
              const frictionHeat = (Math.abs(appliedDefX) + Math.abs(appliedDefY)) * 0.05;
              shard.hp -= frictionHeat;
              if (projectileHeatGain > 0) {
                const shardHp = Math.max(1, Number(shard.maxHp) || DESTRUCTOR_CONFIG.shardHP);
                addShardHeat(shard, Math.min(1, frictionHeat / shardHp) * projectileHeatGain, heatNowSec);
              }
              if (!HEX_SHIPS_3D_ACTIVE && frictionHeat > 0.5) anyTextureChange = true;

              // Shard dies from friction, or from GPU stress tearing.
              if (shard.hp <= 0 && !shard.isDebris) {
                this.destroyShard(entity, shard);
                anyDestroyed = true;
              }
            }
          }
        }
      }

      const splitForceThreshold = DESTRUCTOR_CONFIG.splitForceThreshold ?? 50;
      if (!entity.noSplit && damageScale > 0 && anyDestroyed && forceMag > splitForceThreshold) this.splitQueue.push(entity);

      if (anyMeshChange || anyDestroyed) markRingSegmentHot(entity, 1200, 12000);
      if (anyMeshChange) {
        if (dirtyMax >= 0 && Number.isFinite(dirtyMin)) markGridMeshDirtyRange(entity.hexGrid, dirtyMin, dirtyMax);
        else markGridMeshDirtyAll(entity.hexGrid);
      }
      if (anyTextureChange && !HEX_SHIPS_3D_ACTIVE) {
        entity.hexGrid.textureDirty = true;
        entity.hexGrid.cacheDirty = true;
      }
    } finally {
      if (dbgEnabled) this._dbgCollisionRecord('distributeStructuralDamage', nowMs() - tDeform0);
    }
  },

  resolveCollisions(entities, dt, doDamage, skipRingPairs = false, broadphasePrepared = false, iterIndex = 0) {
    const dbgEnabled = this._liveCollisionDebug?.enabled === true;
    const tResolve0 = dbgEnabled ? nowMs() : 0;

    // Przebieg poprawkowy (iterIndex > 0) liczy tylko pary z ciałem, które
    // przesunął kontakt w poprzednim przebiegu albo wcześniej w tym. Para dwóch
    // nieruszonych ciał ma stan identyczny jak w poprzednim przebiegu, który
    // nie znalazł w niej kontaktu (inaczej oba byłyby ruszone) — wynik byłby
    // ten sam. Pełny przebieg robił zapytanie broadphase dla KAŻDEGO ciała,
    // zwykle dla 0–1 kontaktu na krok. Kolejność i role par (niższy indeks
    // jako A) zostają jak w pełnym przebiegu, więc wynik jest identyczny.
    const prevStamp = this._collIterStamp;
    let stamp = (prevStamp + 1) | 0;
    if (stamp <= 0) stamp = 1;
    this._collIterStamp = stamp;
    const prevMoved = this._collMovedCur;
    const curMoved = this._collMovedSpare;
    curMoved.length = 0;
    this._collMovedSpare = prevMoved;
    this._collMovedCur = curMoved;
    const refine = iterIndex > 0 && (DESTRUCTOR_CONFIG.collisionRefineMovedOnly | 0) === 1;

    try {
      const len = entities.length;
      if (len <= 1) return;
      if (refine && prevMoved.length === 0) return;
      if (!broadphasePrepared) this._prepareBroadphase(entities);

      for (let i = 0; i < len; i++) {
        const A = entities[i];
        if (!A?.hexGrid || A.dead || A.isCollidable === false) continue;
        if (!A?._hasActiveHex) continue;
        if (A.isWreck && A._wreckSleeping) continue;
        if (A.isRingSegment) continue;

        const ax = getEntityPosX(A);
        const ay = getEntityPosY(A);
        const ar = Number(A?._bpRadius) || 100;
        const velAx = getEntityVelX(A);
        const velAy = getEntityVelY(A);
        const speedAMag = Math.sqrt(velAx * velAx + velAy * velAy);

        if (A.hexGrid?.isSleeping && speedAMag < 0.5 && Math.abs(getEntityAngVel(A)) < 0.01) continue;

        const speedA = speedAMag * (1 / 60);
        const querySpeedA = Math.min(speedA, ar * 2);
        let aMoved = true;
        if (refine) {
          aMoved = A._collMovedStamp === prevStamp || A._collMovedStamp === stamp;
          if (!aMoved
            && !isNearCollisionMoved(ax, ay, ar + querySpeedA, prevMoved)
            && !isNearCollisionMoved(ax, ay, ar + querySpeedA, curMoved)) continue;
        }
        const queryCount = this._queryBroadphase(ax, ay, Math.max(80, ar + querySpeedA));

        let queryStamp = (this._bpQueryStamp + 1) | 0;
        if (queryStamp <= 0) queryStamp = 1;
        this._bpQueryStamp = queryStamp;
        const candidates = this._bpQueryBuffer;

        for (let ci = 0; ci < queryCount; ci++) {
          const B = candidates[ci];

          if (!B?.hexGrid || B.dead || B.isCollidable === false) continue;
          if (!B?._hasActiveHex) continue;
          if (B === A) continue;
          if (B._destrBpSeen === queryStamp) continue;

          B._destrBpSeen = queryStamp;
          if ((B._destrBpIndex | 0) <= i) continue;
          if (!aMoved && B._collMovedStamp !== prevStamp && B._collMovedStamp !== stamp) continue;
          if (skipRingPairs && B.isRingSegment) continue;
          if (A.isRingSegment && B.isRingSegment) continue;

          const rootA = A.owner || A;
          const rootB = B.owner || B;
          if (rootA === rootB || rootA === B || rootB === A) continue;
          if (areTowBodiesCollisionDisabled(rootA, rootB)) continue;

          if (dbgEnabled) this._liveCollisionDebug.pairCandidates++;

          // Najtańszy test (dystans) idzie pierwszy. Prędkość B bierzemy z cache
          // broadphase (_frameSpeed z początku kroku) — bez sqrt per kandydat.
          const dx = ax - getEntityPosX(B);
          const dy = ay - getEntityPosY(B);
          const br = Number(B?._bpRadius) || 100;
          const cappedSpeedB = Math.min(Number(B._frameSpeed) || 0, br * 2);
          const rs = ar + br + querySpeedA + cappedSpeedB;

          if (dx * dx + dy * dy > rs * rs) continue;

          const velBx = getEntityVelX(B);
          const velBy = getEntityVelY(B);
          const speedBMag = Math.sqrt(velBx * velBx + velBy * velBy);
          const relVx = velAx - velBx;
          const relVy = velAy - velBy;
          const relSpeedSq = relVx * relVx + relVy * relVy;
          const shardSum = (A.hexGrid?.shards?.length || 0) + (B.hexGrid?.shards?.length || 0);
          const heavyPair = shardSum > 2500;
          const fastPairSpeedThreshold = Number(DESTRUCTOR_CONFIG.fastPairSpeedThreshold) || 200.0;
          const isFastFrame = relSpeedSq > (fastPairSpeedThreshold * fastPairSpeedThreshold);
          const aIsWreck = !!A.isWreck;
          const bIsWreck = !!B.isWreck;

          if (iterIndex > 0 && (heavyPair || isFastFrame)) continue;

          // Tarcze NIE biorą udziału w zderzeniach (model „Star Wars", 2026-09-23):
          // pole zatrzymuje ostrzał, ale kadłuby przechodzą przez nie i stykają
          // się metalem. Dawny rezolwer tarcza-tarcza odbijał taranującego na
          // obrysie pola i zamieniał taran w obrażenia tarczy — osłoniętego
          // okrętu nie dało się zgnieść.

          if (bIsWreck && B._wreckSleeping) {
            // Budź TYLKO przy znaczącej prędkości względnej (nie przy wolnym przelocie obok)
            if (relSpeedSq >= (WRECK_WAKE_REL_SPEED * WRECK_WAKE_REL_SPEED)) {
              this.wakeWreck(B);
            } else {
              continue;
            }
          }

          if (aIsWreck && B.isRingSegment) {
            const aColdWreck = A._wreckSleeping || (
              (Number(A._wreckAge) || 0) > WRECK_FULL_COLLISION_TIME &&
              speedAMag < WRECK_WAKE_REL_SPEED &&
              Math.abs(getEntityAngVel(A)) < (WRECK_SLEEP_ANGULAR_SPEED * 2.0)
            );
            if (aColdWreck) continue;
          }

          if (aIsWreck && bIsWreck) {
            const aColdWreck = A._wreckSleeping || (
              (Number(A._wreckAge) || 0) > WRECK_FULL_COLLISION_TIME &&
              speedAMag < WRECK_WAKE_REL_SPEED &&
              Math.abs(getEntityAngVel(A)) < (WRECK_SLEEP_ANGULAR_SPEED * 2.0)
            );
            const bColdWreck = B._wreckSleeping || (
              (Number(B._wreckAge) || 0) > WRECK_FULL_COLLISION_TIME &&
              speedBMag < WRECK_WAKE_REL_SPEED &&
              Math.abs(getEntityAngVel(B)) < (WRECK_SLEEP_ANGULAR_SPEED * 2.0)
            );
            if (aColdWreck && bColdWreck) continue;
          }

          if (B.isRingSegment && !circleOverlapsEntityRect(
            ax,
            ay,
            ar + querySpeedA + cappedSpeedB,
            B,
            HEX_SPACING * 6.0
          )) continue;

          // Pary statek–statek: bramka OBB vs OBB. Odrzuca mijanki burta w burtę,
          // które przechodzą test okręgów (długi kadłub -> duży okrąg otaczający),
          // zanim zapłacimy pełną pętlę narrowphase po shardach.
          if (!B.isRingSegment && !entityObbsOverlap(A, B, this._tick, querySpeedA + cappedSpeedB)) continue;

          if (dbgEnabled) {
            this._liveCollisionDebug.pairNarrow++;
            if (A.isRingSegment || B.isRingSegment) this._liveCollisionDebug.ringPairs++;
          }

          // Kontakt (i tylko on) zmienia stan pary: collideEntities bez kontaktu
          // wraca przed jakimkolwiek zapisem, więc przyrost licznika = ruszone ciała.
          const contactsBefore = this._frameContacts;

          // Swept collision: if closing speed is high relative to object sizes,
          // substep along trajectory to prevent tunneling.
          const closingSpeed = Math.sqrt(relVx * relVx + relVy * relVy) * dt;
          const combinedRadius = ar + br;
          const sweepRatio = combinedRadius > 1 ? closingSpeed / combinedRadius : 0;

          if (sweepRatio > 1.5) {
            const maxSubsteps = (ar > 300 || br > 300) ? 2 : 8;
            const substeps = Math.min(maxSubsteps, Math.ceil(sweepRatio));
            const subDt = dt / substeps;
            // Save original positions
            const origAx = getEntityPosX(A);
            const origAy = getEntityPosY(A);
            const origBx = getEntityPosX(B);
            const origBy = getEntityPosY(B);
            let hit = false;

            // Accumulate physical separation corrections across substeps
            let accumCorrAx = 0, accumCorrAy = 0;
            let accumCorrBx = 0, accumCorrBy = 0;

            for (let sub = 0; sub < substeps; sub++) {
              // Interpolate positions along trajectory
              const t = (sub + 0.5) / substeps;
              const sweepAx = origAx - velAx * dt * (1 - t);
              const sweepAy = origAy - velAy * dt * (1 - t);
              const sweepBx = origBx - velBx * dt * (1 - t);
              const sweepBy = origBy - velBy * dt * (1 - t);
              const sdx = sweepAx - sweepBx;
              const sdy = sweepAy - sweepBy;

              if (sdx * sdx + sdy * sdy < (ar + br) * (ar + br)) {
                // Set interpolated position + accumulated corrections so far
                setEntityPos(A, sweepAx + accumCorrAx, sweepAy + accumCorrAy);
                setEntityPos(B, sweepBx + accumCorrBx, sweepBy + accumCorrBy);

                // Record position before collideEntities applies separation
                const beforeAx = getEntityPosX(A), beforeAy = getEntityPosY(A);
                const beforeBx = getEntityPosX(B), beforeBy = getEntityPosY(B);

                this.collideEntities(A, B, subDt, doDamage && !hit);

                // Accumulate the separation/push applied by collideEntities
                accumCorrAx += getEntityPosX(A) - beforeAx;
                accumCorrAy += getEntityPosY(A) - beforeAy;
                accumCorrBx += getEntityPosX(B) - beforeBx;
                accumCorrBy += getEntityPosY(B) - beforeBy;
                hit = true;
              }
            }
            // Restore end-of-frame positions, keeping the accumulated separation
            setEntityPos(A, origAx + accumCorrAx, origAy + accumCorrAy);
            setEntityPos(B, origBx + accumCorrBx, origBy + accumCorrBy);
          } else {
            this.collideEntities(A, B, dt, doDamage);
          }
          if (this._frameContacts !== contactsBefore) {
            this._markCollisionMoved(A, stamp);
            this._markCollisionMoved(B, stamp);
          }
        }
      }

      // === SWEPT PASS for very fast objects (speed > 3x radius per frame) ===
      // These may have been missed by the capped broadphase query above
      for (let i = 0; i < len; i++) {
        const A = entities[i];
        if (!A?.hexGrid || A.dead || A.isCollidable === false || !A._hasActiveHex) continue;
        if (A.isRingSegment) continue;

        const frameSpeed = A._frameSpeed || 0;
        const ar = Number(A._bpRadius) || 100;
        if (frameSpeed < ar * 3) continue; // only for ultra-fast objects

        const ax = getEntityPosX(A);
        const ay = getEntityPosY(A);
        const velAx = getEntityVelX(A);
        const velAy = getEntityVelY(A);

        // Przebieg poprawkowy: nieruszone ciało bez ruszonego sąsiada w zasięgu
        // toru (|v|·dt + ar od pozycji) dałoby ten sam wynik co poprzednio.
        if (refine && A._collMovedStamp !== prevStamp && A._collMovedStamp !== stamp) {
          const sweepReach = Math.sqrt(velAx * velAx + velAy * velAy) * dt + ar;
          if (!isNearCollisionMoved(ax, ay, sweepReach, prevMoved)
            && !isNearCollisionMoved(ax, ay, sweepReach, curMoved)) continue;
        }

        // Sample points along trajectory
        const steps = Math.min(8, Math.ceil(frameSpeed / ar));
        // Korekty separacji nałożone przez collideEntities muszą przetrwać
        // przywrócenie pozycji końca klatki (jak w głównym torze swept powyżej).
        let corrAx = 0;
        let corrAy = 0;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const sampleX = ax - velAx * dt * t;
          const sampleY = ay - velAy * dt * t;
          const qCount = this._queryBroadphase(sampleX, sampleY, ar * 2);
          const cands = this._bpQueryBuffer;

          for (let ci = 0; ci < qCount; ci++) {
            const B = cands[ci];
            if (!B?.hexGrid || B.dead || B === A || B.isCollidable === false) continue;
            if (!B._hasActiveHex) continue;

            const rootA = A.owner || A;
            const rootB = B.owner || B;
            if (rootA === rootB || rootA === B || rootB === A) continue;
            if (areTowBodiesCollisionDisabled(rootA, rootB)) continue;
            const relVx = velAx - getEntityVelX(B);
            const relVy = velAy - getEntityVelY(B);
            const shardSum = (A.hexGrid?.shards?.length || 0) + (B.hexGrid?.shards?.length || 0);
            const heavyPair = shardSum > 2500;
            const fastPairSpeedThreshold = Number(DESTRUCTOR_CONFIG.fastPairSpeedThreshold) || 200.0;
            const isFastFrame = (relVx * relVx + relVy * relVy) > (fastPairSpeedThreshold * fastPairSpeedThreshold);
            if (iterIndex > 0 && (heavyPair || isFastFrame)) continue;

            const bx = getEntityPosX(B);
            const by = getEntityPosY(B);
            const br = Number(B._bpRadius) || 100;
            const sdx = sampleX - bx;
            const sdy = sampleY - by;

            if (sdx * sdx + sdy * sdy < (ar + br) * (ar + br)) {
              // Temporarily position A at sample point for collision
              setEntityPos(A, sampleX + corrAx, sampleY + corrAy);
              const sweepContactsBefore = this._frameContacts;
              this.collideEntities(A, B, dt / steps, doDamage);
              if (this._frameContacts !== sweepContactsBefore) {
                this._markCollisionMoved(A, stamp);
                this._markCollisionMoved(B, stamp);
              }
              // Zachowaj separację, którą collideEntities nałożyło na A,
              // przywracając pozycję końca klatki.
              corrAx = getEntityPosX(A) - sampleX;
              corrAy = getEntityPosY(A) - sampleY;
              setEntityPos(A, ax + corrAx, ay + corrAy);
              break; // one hit per sweep pass is enough
            }
          }
        }
      }
    } finally {
      if (dbgEnabled) this._dbgCollisionRecord('resolveCollisions', nowMs() - tResolve0);
    }
  },

  collideEntities(A, B, dt, doDamage) {
    const dbgEnabled = this._liveCollisionDebug?.enabled === true;
    const tCollide0 = dbgEnabled ? nowMs() : 0;

    try {
      // Wrak budzimy dopiero PO znalezieniu kontaktu i tylko, gdy kontakt coś
      // zmienia (_wreckContactWakes, na końcu). Bezwarunkowe wakeWreck w tym
      // miejscu zerowało licznik snu każdej parze z nachodzącymi OBB, także bez
      // styku — wrak pod zaparkowanym okrętem nigdy nie zasypiał, więc nie mógł
      // też przejść w stan zimny.
      const aWreck = A?.isWreck === true;
      const bWreck = B?.isWreck === true;
      const aPreX = aWreck ? getEntityPosX(A) : 0;
      const aPreY = aWreck ? getEntityPosY(A) : 0;
      const aPreVx = aWreck ? getEntityVelX(A) : 0;
      const aPreVy = aWreck ? getEntityVelY(A) : 0;
      const aPreW = aWreck ? getEntityAngVel(A) : 0;
      const bPreX = bWreck ? getEntityPosX(B) : 0;
      const bPreY = bWreck ? getEntityPosY(B) : 0;
      const bPreVx = bWreck ? getEntityVelX(B) : 0;
      const bPreVy = bWreck ? getEntityVelY(B) : 0;
      const bPreW = bWreck ? getEntityAngVel(B) : 0;

      let iterator = A;
      let gridHolder = B;

      if (A.hexGrid.shards.length > B.hexGrid.shards.length) {
        iterator = B;
        gridHolder = A;
      }

      const scaleAX = Math.max(0.0001, getFinalScaleX(A));
      const scaleAY = Math.max(0.0001, getFinalScaleY(A));
      const scaleBX = Math.max(0.0001, getFinalScaleX(B));
      const scaleBY = Math.max(0.0001, getFinalScaleY(B));
      const scaleIterX = Math.max(0.0001, getFinalScaleX(iterator));
      const scaleIterY = Math.max(0.0001, getFinalScaleY(iterator));
      const scaleGridX = Math.max(0.0001, getFinalScaleX(gridHolder));
      const scaleGridY = Math.max(0.0001, getFinalScaleY(gridHolder));
      const collisionScaleIter = Math.max(scaleIterX, scaleIterY);
      const collisionScaleGrid = Math.max(scaleGridX, scaleGridY);
      const massA = getEntityRammingMass(A);
      const massB = getEntityRammingMass(B);
      const hullPair = !A.isRingSegment && !B.isRingSegment && !isBrittleEntity(A) && !isBrittleEntity(B);
      const massContrast = (massA - massB) * (massA - massB) / (massA * massB);
      const angIter = getEntityHexAngle(iterator);
      const angGrid = getEntityHexAngle(gridHolder);

      const cosI = Math.cos(angIter);
      const sinI = Math.sin(angIter);
      const cosG = Math.cos(angGrid);
      const sinG = Math.sin(angGrid);
      const iterBillboardOrientation = usesBillboardOrientation(iterator);
      const gridBillboardOrientation = usesBillboardOrientation(gridHolder);

      const cxI = iterator.hexGrid.srcWidth * 0.5;
      const cyI = iterator.hexGrid.srcHeight * 0.5;
      const cxG = gridHolder.hexGrid.srcWidth * 0.5;
      const cyG = gridHolder.hexGrid.srcHeight * 0.5;
      const pIx = iterator.hexGrid.pivot ? iterator.hexGrid.pivot.x : 0;
      const pIy = iterator.hexGrid.pivot ? iterator.hexGrid.pivot.y : 0;
      const pGx = gridHolder.hexGrid.pivot ? gridHolder.hexGrid.pivot.x : 0;
      const pGy = gridHolder.hexGrid.pivot ? gridHolder.hexGrid.pivot.y : 0;

      const iterRadius = iterator.radius || 100;
      const ix = getEntityPosX(iterator);
      const iy = getEntityPosY(iterator);
      const gx = getEntityPosX(gridHolder);
      const gy = getEntityPosY(gridHolder);
      const baseSearchR = Math.max(3, Number(DESTRUCTOR_CONFIG.collisionSearchRadius) || 4);
      const isRingCollision = !!(A?.isRingSegment || B?.isRingSegment);
      const shardSum = (A.hexGrid?.shards?.length || 0) + (B.hexGrid?.shards?.length || 0);
      const heavyPair = shardSum > 2500;

      let searchR = isRingCollision
        ? Math.max(2, Math.min(4, baseSearchR | 0))
        : (heavyPair ? Math.max(3, Math.min(4, (baseSearchR | 0) - 1)) : baseSearchR);

      const relVx = getEntityVelX(A) - getEntityVelX(B);
      const relVy = getEntityVelY(A) - getEntityVelY(B);
      const relSpeed = Math.sqrt(relVx * relVx + relVy * relVy);
      const scrapeSpeedThreshold = (Number(DESTRUCTOR_CONFIG.fastPairSpeedThreshold) || 200.0) * 0.45;
      const scrapePair = relSpeed < scrapeSpeedThreshold;
      const speedHexes = Math.ceil((relSpeed * dt) / HEX_SPACING);
      const searchRCap = isRingCollision ? 5 : (heavyPair ? 5 : 6);
      if (scrapePair) searchR = Math.min(searchR, 3);
      else if (!isRingCollision && heavyPair) searchR = Math.min(searchR, 4);
      const searchBoost = Math.min(isRingCollision ? 1 : (heavyPair ? 1 : 2), speedHexes);
      searchR = Math.min(searchRCap, searchR + searchBoost);

      // ADAPTACYJNY SUFIT: przeszukujemy siatke HOLDERA, wiec zasieg musi objac
      // dryf JEGO heksow (o tyle heks odjechal od swojej nominalnej komorki) plus
      // promienie trafienia obu stron. Stale 4-6 bylo wymiarowane na teoretyczny
      // maxDeform, a pomiar w bitwie 174 statkow daje dryf ZEROWY dla wiekszosci
      // kadlubow. Dysk r=5 to 81 komorek na heks brzegowy, r=2 tylko 13.
      // To sufit, nie wartosc: moze wylacznie ZMNIEJSZYC searchR, nigdy zwiekszyc,
      // wiec przy braku licznika (_maxHexDrift undefined) zachowanie jest dawne.
      // DOMYSLNIE WYLACZONE (searchRDriftMargin = null). Zmiana dotyka WYKRYWANIA
      // kolizji: za ciasny skan gubi kontakt i kadluby zaczynaja sie przenikac,
      // a tego nie udalo sie na razie zmierzyc w biegu. Wlaczanie do testow:
      //   DESTRUCTOR_CONFIG.searchRDriftMargin = 3
      // Metryka bezpieczenstwa to liczba kontaktow na klatke — jesli po wlaczeniu
      // spada, margines jest za maly.
      const marginCells = DESTRUCTOR_CONFIG.searchRDriftMargin;
      const holderDrift = Number(gridHolder.hexGrid?._maxHexDrift);
      if (Number.isFinite(marginCells) && marginCells >= 0 &&
          Number.isFinite(holderDrift) && holderDrift >= 0) {
        const driftCells = Math.ceil(holderDrift / HEX_SPACING) + marginCells;
        searchR = Math.min(searchR, Math.max(1, driftCells));
      }

      const contacts = this._contactsBuf;
      // Budżet kontaktów jest wyłącznie sprawą wydajności — zależy od rozmiaru siatek
      // i od tego, czy para się ociera, a nie od przewagi masy.
      const maxContacts = isRingCollision
        ? 64
        : (heavyPair ? 24 : ((shardSum > 1400 || scrapePair) ? 28 : 32));
      let contactsCount = 0;
      const holderGrid = gridHolder.hexGrid.grid;
      const holderCols = gridHolder.hexGrid.cols || 0;
      const holderRows = gridHolder.hexGrid.rows || 0;
      const shardsIter = iterator.hexGrid.shards;
      const packedIteratorBody = (DESTRUCTOR_CONFIG.packedHexArena | 0) === 1 &&
        (DESTRUCTOR_CONFIG.edgeCollision | 0) === 1
        ? getPackedCollisionBody(iterator)
        : null;
      const centerIx = ix - gx, centerIy = iy - gy;
      const depthG = Math.min(
        cxG - Math.abs(worldDeltaToLocalX(centerIx, centerIy, scaleGridX, scaleGridY, cosG, sinG, gridBillboardOrientation) + pGx),
        cyG - Math.abs(worldDeltaToLocalY(centerIx, centerIy, scaleGridX, scaleGridY, cosG, sinG, gridBillboardOrientation) + pGy)
      );
      const depthI = Math.min(
        cxI - Math.abs(worldDeltaToLocalX(-centerIx, -centerIy, scaleIterX, scaleIterY, cosI, sinI, iterBillboardOrientation) + pIx),
        cyI - Math.abs(worldDeltaToLocalY(-centerIx, -centerIy, scaleIterX, scaleIterY, cosI, sinI, iterBillboardOrientation) + pIy)
      );
      const overlapDepth = Math.max(0, depthG, depthI);
      // Boundary-only traversal is valid at the surface. During an overrun,
      // interior cells also intersect metal (even if displaced edge cells miss).
      // Keep the same contact budget and rotating cursor for this traversal.
      const useBoundary = packedIteratorBody?.boundaryCount > 0 && !(hullPair && massContrast > 0 && overlapDepth > 0);
      const lenIter = useBoundary
        ? packedIteratorBody.boundaryCount
        : shardsIter.length;
      const offsets = getSearchOffsets(searchR);
      // Large deformation invalidates the original c/r lookup. Index current
      // positions once per mesh revision instead of widening every search disk.
      const contactGrid = holderDrift > HEX_SPACING * 2
        ? getHexContactGrid(gridHolder.hexGrid, COLLISION_DEFORM_SCALE, HEX_SPACING * 2, HIT_RAD)
        : null;

      if (!holderGrid || holderCols <= 0 || holderRows <= 0 || lenIter <= 0) return;

      // Continue after the last sampled edge. Always restarting at zero starves
      // the advancing bow when a deep overlap fills the small contact budget.
      const startIndex = (iterator.hexGrid._contactCursor || 0) % lenIter;
      for (let scanned = 0; scanned < lenIter; scanned++) {
        const i = (startIndex + scanned) % lenIter;
        const sI = useBoundary
          ? getPackedShardRef(packedIteratorBody.boundaryIndices[i])
          : shardsIter[i];
        if (!sI || !sI.active || sI.isDebris) continue;
        const hitRadI = getShardHitRadius(sI) * collisionScaleIter;

        const relIx = (getShardCollisionGridX(sI) - cxI) - pIx;
        const relIy = (getShardCollisionGridY(sI) - cyI) - pIy;
        const worldIx = ix + localDeltaToWorldX(relIx, relIy, scaleIterX, scaleIterY, cosI, sinI, iterBillboardOrientation);
        const worldIy = iy + localDeltaToWorldY(relIx, relIy, scaleIterX, scaleIterY, cosI, sinI, iterBillboardOrientation);

        const dx = worldIx - gx;
        const dy = worldIy - gy;
        const localGx = worldDeltaToLocalX(dx, dy, scaleGridX, scaleGridY, cosG, sinG, gridBillboardOrientation);
        const localGy = worldDeltaToLocalY(dx, dy, scaleGridX, scaleGridY, cosG, sinG, gridBillboardOrientation);
        const gridGx = localGx + cxG + pGx;
        const gridGy = localGy + cyG + pGy;
        const approxC = Math.round(gridGx / HEX_SPACING);
        const approxR = Math.round(gridGy / HEX_HEIGHT);

        if (!contactGrid && (approxC < -searchR || approxC >= holderCols + searchR || approxR < -searchR || approxR >= holderRows + searchR)) continue;

        for (let oi = 0; oi < (contactGrid ? 1 : offsets.length); oi += 2) {
          let sG;
          if (contactGrid) {
            sG = findHexContact(contactGrid, gridGx, gridGy, scaleGridX, scaleGridY, hitRadI, HIT_RAD);
          } else {
            const gc = approxC + offsets[oi];
            const gr = approxR + offsets[oi + 1];
            if (gc < 0 || gr < 0 || gc >= holderCols || gr >= holderRows) continue;
            sG = holderGrid[gc + gr * holderCols];
          }
          if (!sG || !sG.active || sG.isDebris) continue;

          const relGx = (getShardCollisionGridX(sG) - cxG) - pGx;
          const relGy = (getShardCollisionGridY(sG) - cyG) - pGy;
          const worldGx = gx + localDeltaToWorldX(relGx, relGy, scaleGridX, scaleGridY, cosG, sinG, gridBillboardOrientation);
          const worldGy = gy + localDeltaToWorldY(relGx, relGy, scaleGridX, scaleGridY, cosG, sinG, gridBillboardOrientation);

          const normalX = worldIx - worldGx;
          const normalY = worldIy - worldGy;
          const distSq = normalX * normalX + normalY * normalY;
          // Pozycje shardów są już przeskalowane do świata, więc ich promienie też
          // muszą być w world units. Brak tej skali zostawiał szerokie szczeliny w
          // dużych asteroidach (np. spriteScale=3), przez które statek przelatywał.
          const hitRadG = getShardHitRadius(sG) * collisionScaleGrid;
          const hitRad = (hitRadI + hitRadG) * 0.78;

          if (distSq >= hitRad * hitRad) continue;

          const dist = Math.sqrt(distSq);
          const swapped = iterator !== A;
          const ct = contacts[contactsCount];
          
          ct.shardA = swapped ? sG : sI;
          ct.shardB = swapped ? sI : sG;
          ct.worldAx = swapped ? worldGx : worldIx;
          ct.worldAy = swapped ? worldGy : worldIy;
          ct.worldBx = swapped ? worldIx : worldGx;
          ct.worldBy = swapped ? worldIy : worldGy;
          ct.normalX = swapped ? -normalX : normalX;
          ct.normalY = swapped ? -normalY : normalY;
          ct.penetration = Math.max(0, hitRad - dist);
          
          contactsCount++;
          break;
        }
        if (contactsCount >= maxContacts) {
          iterator.hexGrid._contactCursor = (i + 1) % lenIter;
          break;
        }
      }

      if (contactsCount === 0) return;

      // Rekord pary powstaje ZAWSZE — zdarzenie uderzenia musi działać także
      // dla ringu i asteroid. Historia ustępowania zostaje kadłubowa.
      const pairRecord = hullPair ? this._recordHullContact(A, B) : this._pairRecord(A, B);
      const hullContact = hullPair ? pairRecord : null;

      this.wakeHexEntity(A, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);
      this.wakeHexEntity(B, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);
      this._frameContacts += contactsCount;

      let worldHitX = 0;
      let worldHitY = 0;
      let nx = 0;
      let ny = 0;
      let penetration = 0;

      for (let i = 0; i < contactsCount; i++) {
        const ct = contacts[i];
        worldHitX += (ct.worldAx + ct.worldBx) * 0.5;
        worldHitY += (ct.worldAy + ct.worldBy) * 0.5;
        nx += ct.normalX;
        ny += ct.normalY;
        if (ct.penetration > penetration) penetration = ct.penetration;
      }

      worldHitX /= contactsCount;
      worldHitY /= contactsCount;

      const aX = getEntityPosX(A);
      const aY = getEntityPosY(A);
      const bX = getEntityPosX(B);
      const bY = getEntityPosY(B);
      let normalLenSq = nx * nx + ny * ny;

      if (normalLenSq < 1e-12) {
        nx = aX - bX;
        ny = aY - bY;
        normalLenSq = nx * nx + ny * ny;
        if (normalLenSq < 1e-12) normalLenSq = 1;
      }

      const invNormalLen = 1 / Math.sqrt(normalLenSq);
      nx *= invNormalLen;
      ny *= invNormalLen;

      // Normalna ze środków mas — stabilna, nie zależy od tego, w którą komórkę
      // siatki trafił narrowphase.
      const centerDx = aX - bX;
      const centerDy = aY - bY;
      const centerLenSq = centerDx * centerDx + centerDy * centerDy;
      let centerNx = nx;
      let centerNy = ny;
      if (centerLenSq > 1e-8) {
        const invCenterLen = 1 / Math.sqrt(centerLenSq);
        centerNx = centerDx * invCenterLen;
        centerNy = centerDy * invCenterLen;
      }

      // JAKOŚĆ PRÓBKI STYKU decyduje, na ile ufamy normalnej kontaktu.
      // Jeden kontakt na siatce heksów NIE niesie kierunku zderzenia: kolumny są
      // przesunięte o pół wysokości heksa, więc narrowphase trafia na przemian
      // w komórkę nad i pod linią styku, a normalna przeskakuje między dwoma
      // kierunkami lustrzanymi. Pomiar przy taranie CZOŁOWYM (oba kadłuby w osi):
      // kąt normalnej skakał -155° <-> +154°, 148 razy na 240 ticków, przy
      // contactsCount = 1 — i szarpał ofiarę BOKIEM (135 zwrotów vy), mimo że
      // zderzenie nie miało żadnej składowej bocznej.
      // Mieszamy więc normalną styku ze stabilną normalną środków tą samą miarą
      // (contactPatchFullCount), którą już tłumimy człon kątowy niżej. Przy
      // szerokim styku (4+ kontaktów) nic się nie zmienia.
      const patchFull = Math.max(1, Number(DESTRUCTOR_CONFIG.contactPatchFullCount) || 4);
      const patchFactor = Math.min(1, contactsCount / patchFull);

      if (patchFactor < 1) {
        const blendNx = nx * patchFactor + centerNx * (1 - patchFactor);
        const blendNy = ny * patchFactor + centerNy * (1 - patchFactor);
        const blendLenSq = blendNx * blendNx + blendNy * blendNy;
        // Gdy obie normalne są niemal przeciwne, mieszanka degeneruje się do
        // zera — wtedy zostaje ta stabilna.
        if (blendLenSq > 1e-6) {
          const invBlend = 1 / Math.sqrt(blendLenSq);
          nx = blendNx * invBlend;
          ny = blendNy * invBlend;
        } else {
          nx = centerNx;
          ny = centerNy;
        }
      }

      // Inside a hull, nearest-cell normals flip whenever a moving hex crosses
      // a cell centre. Centre-to-centre approach also changes sign halfway
      // through the victim. Neither describes the direction of a deep ram.
      // Blend toward the actual travel direction only as a mass-dominant pair
      // enters the other's hull bounds; surface contacts keep their normals.
      const crushMinSpeed = Math.max(0, Number(DESTRUCTOR_CONFIG.crushMinSpeed) || 0);
      const yieldSpeed = Math.max(1, Number(DESTRUCTOR_CONFIG.ramYieldSpeed) || 80);
      if (hullPair && massContrast > 0 && relSpeed > crushMinSpeed) {
        const depthWeight = Math.min(1, overlapDepth / (HEX_SPACING * 4));
        const pressure = massContrast * ((relSpeed - crushMinSpeed) / yieldSpeed) ** 2;
        const blend = depthWeight * pressure / (1 + pressure);
        const bx = nx * (1 - blend) - (relVx / relSpeed) * blend;
        const by = ny * (1 - blend) - (relVy / relSpeed) * blend;
        const len = Math.hypot(bx, by);
        if (len > 1e-6) { nx = bx / len; ny = by / len; }
      }

      const rAx = worldHitX - aX;
      const rAy = worldHitY - aY;
      const rBx = worldHitX - bX;
      const rBy = worldHitY - bY;

      const vAx = getEntityVelX(A) - getEntityAngVel(A) * rAy;
      const vAy = getEntityVelY(A) + getEntityAngVel(A) * rAx;
      const vBx = getEntityVelX(B) - getEntityAngVel(B) * rBy;
      const vBy = getEntityVelY(B) + getEntityAngVel(B) * rBx;

      const dvx = vAx - vBx;
      const dvy = vAy - vBy;

      // Define impactSpeed early so crush logic can use it consistently.
      const impactSpeed = Math.sqrt(dvx * dvx + dvy * dvy);
      const velAlongNormal = dvx * nx + dvy * ny;
      const approachSpeed = Math.max(0, -velAlongNormal);
      const centerApproachSpeed = Math.max(0, -(relVx * centerNx + relVy * centerNy));
      const effectiveApproachSpeed = Math.max(approachSpeed, centerApproachSpeed);
      const tx = -ny;
      const ty = nx;
      const velTangent = dvx * tx + dvy * ty;

      const invMassA = 1 / massA;
      const invMassB = 1 / massB;
      // A yielding hull must keep closing while its contact layer is crushed.
      // A full rigid impulse immediately launches the lighter ship away, leaving
      // only one tick of damage. Blend continuously with speed and mass contrast;
      // rings and brittle bodies retain their existing rigid response.
      const yieldApproach = Math.max(0, effectiveApproachSpeed - crushMinSpeed);
      let ramPressure = hullPair ? massContrast * (yieldApproach / yieldSpeed) ** 2 : 0;
      if (hullContact) {
        // A contact layer that has yielded does not become rigid again as the
        // ram slows down inside it. Reset this history only after separation.
        ramPressure = Math.max(ramPressure, hullContact.yieldPressure);
        hullContact.yieldPressure = ramPressure;
      }
      const ramYield = ramPressure / (1 + ramPressure);
      // The compliant response is a rate calibrated at 120 Hz. Otherwise a
      // smaller physics step pushes the target twice as often for equal damage.
      const rigidShare = 1 - Math.pow(ramYield, Math.max(0, dt) * 120);
      const slop = 0.01;
      // Dawny przełącznik useCenterNormal (centerApproachSpeed > approachSpeed)
      // rozwiązywał ten sam problem, ale SKOKIEM: przy taranie obie prędkości są
      // prawie równe, więc przełącznik sam migotał i podmieniał kierunek separacji
      // co tick. Zastąpiony ciągłym mieszaniem po jakości styku wyżej — nx/ny są
      // już zmieszane, więc cała reszta funkcji używa jednej, spójnej normalnej.

      let bounceForce = 0;

      if (velAlongNormal < 0) {
        const iaScale = 0.5;
        const ra = Math.max(1, A.radius || 100);
        const rb = Math.max(1, B.radius || 100);
        const invIa = 1 / (iaScale * massA * ra * ra);
        const invIb = 1 / (iaScale * massB * rb * rb);

        const rnA = rAx * ny - rAy * nx;
        const rnB = rBx * ny - rBy * nx;
        // Zdegenerowana plama styku (1 kontakt) daje falszywie duzy MOMENT, ale
        // nie falszywy impuls normalny. Tlumimy wiec wylacznie to, co aplikujemy
        // na predkosc katowa — MIANOWNIK zostaje pelny.
        //
        // Pierwsza wersja tlumila tez mianownik "dla spojnosci" i to byla regresja:
        // przy pancerniku (50k, invMassB 2e-5) czlon katowy 3.3e-5 DOMINOWAL nad
        // masowym, wiec jego przyciecie o 75% skracalo mianownik z 5.3e-5 do
        // 2.9e-5 i niemal PODWAJALO impuls j. Kadlub dostawal dwa razy mocniejszy
        // kop liniowy, odskakiwal, Atlas go doganial pod ciagiem i kopal znowu —
        // drzenie ~60 Hz zamiast mielenia.
        // patchFull/patchFactor policzone wyzej, razem z mieszaniem normalnej.
        const denom = invMassA + invMassB + rnA * rnA * invIa + rnB * rnB * invIb;
        const angInvIa = invIa * patchFactor;
        const angInvIb = invIb * patchFactor;

        if (Number.isFinite(denom) && denom > 1e-8) {
          // Equal and opposite impulses preserve momentum while the remaining
          // approach is spent crushing the yielding contact layer below.
          const restitution = Math.max(0, Math.min(1, Number(DESTRUCTOR_CONFIG.restitution) || 0));
          const j = (-(1 + restitution) * velAlongNormal) / denom * rigidShare;

          bounceForce = Math.abs(j);

          const impulseX = j * nx;
          const impulseY = j * ny;

          addEntityVelocity(A, impulseX * invMassA, impulseY * invMassA);
          addEntityVelocity(B, -impulseX * invMassB, -impulseY * invMassB);
          addEntityAngVel(A, rnA * j * angInvIa);
          addEntityAngVel(B, -rnB * j * angInvIb);

          let jt = -velTangent;
          const tDen = invMassA + invMassB + (rAx * ty - rAy * tx) ** 2 * invIa + (rBx * ty - rBy * tx) ** 2 * invIb;
          jt = (Number.isFinite(tDen) && tDen > 1e-8) ? (jt / tDen) : 0;

          const mu = Math.max(0, Number(DESTRUCTOR_CONFIG.frictionCoeff) || 0);
          const maxF = Math.abs(j) * mu;
          if (Math.abs(jt) > maxF) jt = -maxF * Math.sign(velTangent || 1);

          jt *= Math.max(0, Math.min(1, Number(DESTRUCTOR_CONFIG.tangentImpulseScale) || 0));

          const fX = jt * tx;
          const fY = jt * ty;

          addEntityVelocity(A, fX * invMassA, fY * invMassA);
          addEntityVelocity(B, -fX * invMassB, -fY * invMassB);
          addEntityAngVel(A, (rAx * ty - rAy * tx) * jt * angInvIa);
          addEntityAngVel(B, -(rBx * ty - rBy * tx) * jt * angInvIb);

          // GPU collision sparks — scale with impact violence
        }
      }

      // === WARSTWA PREZENTACJI (CollisionFX) ===
      // Iskry, a w przyszlosci shake/shockwave/dzwiek/slow-mo, wisza na tych
      // dwoch zdarzeniach. Destructor nie zna juz SparkSystem3D.
      // Tarcie sprawdzamy zawsze, niezaleznie od tego czy uderzenie bylo czolowe.
      const slideSpeed = velTangent;
      const brittlePair = hullPair ? false : (isBrittleEntity(A) || isBrittleEntity(B));
      const reducedMass = (massA * massB) / (massA + massB);
      const impactEnergy = 0.5 * reducedMass * effectiveApproachSpeed * effectiveApproachSpeed;

      // Probki szwu. Jeden snop w usrednionym punkcie gubil cala geometrie styku:
      // przy otarciu burta w burte iskry leca ze srodka 300-jednostkowego szwu.
      // Bierzemy do K kontaktow rownomiernym krokiem, kazdy z WLASNA normalna —
      // na zakrzywionej burcie rozni sie ona od usrednionej.
      const seamTarget = Math.max(0, DESTRUCTOR_CONFIG.seamSparkPoints | 0);
      let seamCount = 0;
      if (seamTarget > 0) {
        if (this._grindPoints.length < seamTarget * 4) this._grindPoints = new Float32Array(seamTarget * 4);
        const seamPoints = this._grindPoints;
        const stride = Math.max(1, Math.ceil(contactsCount / seamTarget));
        for (let c = 0; c < contactsCount && seamCount < seamTarget; c += stride) {
          const ct = contacts[c];
          const base = seamCount * 4;
          seamPoints[base] = (ct.worldAx + ct.worldBx) * 0.5;
          seamPoints[base + 1] = (ct.worldAy + ct.worldBy) * 0.5;
          const cnLen = Math.sqrt(ct.normalX * ct.normalX + ct.normalY * ct.normalY);
          if (cnLen > 1e-6) {
            seamPoints[base + 2] = ct.normalX / cnLen;
            seamPoints[base + 3] = ct.normalY / cnLen;
          } else {
            seamPoints[base + 2] = nx;
            seamPoints[base + 3] = ny;
          }
          seamCount++;
        }
      }

      _grindEvent.A = A;
      _grindEvent.B = B;
      _grindEvent.x = worldHitX;
      _grindEvent.y = worldHitY;
      _grindEvent.nx = nx;
      _grindEvent.ny = ny;
      _grindEvent.tx = tx;
      _grindEvent.ty = ty;
      _grindEvent.approachSpeed = effectiveApproachSpeed;
      _grindEvent.impactSpeed = impactSpeed;
      _grindEvent.slideSpeed = slideSpeed;
      _grindEvent.contactVelX = vAx;
      _grindEvent.contactVelY = vAy;
      _grindEvent.massA = massA;
      _grindEvent.massB = massB;
      _grindEvent.reducedMass = reducedMass;
      _grindEvent.energy = impactEnergy;
      _grindEvent.contactsCount = contactsCount;
      _grindEvent.hullPair = hullPair;
      _grindEvent.isRingCollision = isRingCollision;
      _grindEvent.brittle = brittlePair;
      _grindEvent.simTime = this._simulationTime;
      _grindEvent.bounceForce = bounceForce;
      _grindEvent.points = this._grindPoints;
      _grindEvent.pointCount = seamCount;
      CollisionFX.onGrind(_grindEvent);

      // UDERZENIE: tylko przy pierwszym zetknieciu pary (pair.fresh), tylko z
      // iteracji 0 (collisionIterations = 2 wolaloby to dwa razy na tick) i nie
      // czesciej niz raz na impactCooldown — odbicie i powrot w tym oknie to
      // wciaz TO SAMO zderzenie.
      const impactMinSpeed = Math.max(0, Number(DESTRUCTOR_CONFIG.impactMinSpeed) || 0);
      const impactCooldown = Math.max(0, Number(DESTRUCTOR_CONFIG.impactCooldown) || 0);
      if (
        doDamage &&
        pairRecord.fresh &&
        effectiveApproachSpeed >= impactMinSpeed &&
        (this._simulationTime - pairRecord.lastImpactTime) >= impactCooldown
      ) {
        pairRecord.lastImpactTime = this._simulationTime;
        pairRecord.lastImpactEnergy = impactEnergy;

        _impactEvent.A = A;
        _impactEvent.B = B;
        _impactEvent.x = worldHitX;
        _impactEvent.y = worldHitY;
        _impactEvent.nx = nx;
        _impactEvent.ny = ny;
        _impactEvent.tx = tx;
        _impactEvent.ty = ty;
        _impactEvent.approachSpeed = effectiveApproachSpeed;
        _impactEvent.impactSpeed = impactSpeed;
        _impactEvent.slideSpeed = slideSpeed;
        _impactEvent.contactVelX = vAx;
        _impactEvent.contactVelY = vAy;
        _impactEvent.massA = massA;
        _impactEvent.massB = massB;
        _impactEvent.reducedMass = reducedMass;
        _impactEvent.energy = impactEnergy;
        _impactEvent.contactsCount = contactsCount;
        _impactEvent.hullPair = hullPair;
        _impactEvent.isRingCollision = isRingCollision;
        _impactEvent.brittle = brittlePair;
        _impactEvent.simTime = this._simulationTime;

        CollisionFX.debug = DESTRUCTOR_CONFIG.collisionFxDebug | 0;
        CollisionFX.onImpact(_impactEvent);
      }

      // ŻAR STYKU: tarcie i zgniot rozgrzewają powierzchnię OBU kadłubów.
      // Raz na tick (iteracja 0) i niezależnie od crushPass — czyste otarcie
      // burtą, bez zbliżania, to właśnie ten przypadek, który ma świecić.
      // Wyłącznie zapis atrybutu: nic tu nie dotyka pędu, deformacji ani HP.
      if (doDamage) {
        const heatRate = Math.max(0, Number(DESTRUCTOR_CONFIG.contactHeatRate) || 0);
        const heatRef = Math.max(1, Number(DESTRUCTOR_CONFIG.contactHeatSpeed) || 120);
        const rubRatio = impactSpeed / heatRef;
        // Poniżej prędkości odniesienia tempo spada z kwadratem — dosunięcie się
        // burtą przy kilku u/s nie ma prawa się żarzyć.
        const contactHeat = heatRate * dt * (rubRatio < 1 ? rubRatio * rubRatio : rubRatio);
        if (contactHeat > 0.0005) {
          const heatNowSec = nowMs() * 0.001;
          const shardsA = A.hexGrid.shards;
          const shardsB = B.hexGrid.shards;
          let heatMinA = Number.POSITIVE_INFINITY;
          let heatMaxA = -1;
          let heatMinB = Number.POSITIVE_INFINITY;
          let heatMaxB = -1;
          for (let c = 0; c < contactsCount; c++) {
            const ct = contacts[c];
            const hA = ct.shardA;
            const hB = ct.shardB;
            if (hA && hA.active && !hA.isDebris) {
              addShardHeat(hA, contactHeat, heatNowSec);
              const idx = hA.__meshIndex;
              if (shardsA[idx] === hA) {
                if (idx < heatMinA) heatMinA = idx;
                if (idx > heatMaxA) heatMaxA = idx;
              }
            }
            if (hB && hB.active && !hB.isDebris) {
              addShardHeat(hB, contactHeat, heatNowSec);
              const idx = hB.__meshIndex;
              if (shardsB[idx] === hB) {
                if (idx < heatMinB) heatMinB = idx;
                if (idx > heatMaxB) heatMaxB = idx;
              }
            }
          }
          if (heatMaxA >= 0) markGridHeatDirtyRange(A.hexGrid, heatMinA, heatMaxA);
          if (heatMaxB >= 0) markGridHeatDirtyRange(B.hexGrid, heatMinB, heatMaxB);
        }
      }

      // Deformacja i obrażenia liczą się ZAWSZE, skalowane wprost impulsem — jedyny
      // próg to podłoga wydajnościowa: poniżej niej wgniecenie byłoby subpikselowe,
      // a pełna pętla kontaktów co tick dla ocierających się kadłubów kosztuje.
      const crushPass = doDamage && effectiveApproachSpeed > crushMinSpeed;

      if (crushPass) {
        // Znacznik żaru w bazie czasu RENDERERA (performance.now), bo zanik
        // liczy shader z uTime. Raz na wywołanie, nie raz na kontakt.
        const nowSec = nowMs() * 0.001;
        const heatGain = Math.max(0, Number(DESTRUCTOR_CONFIG.heatGain) || 0);
        // Heksy ginące od tego miejsca do końca rozejścia nadmiaru (applyImpact)
        // rozżarzają brzeg wyrwy — patrz _heatWoundRim. Szybszy taran = bielszy brzeg.
        const woundSpeed = Math.max(1, Number(DESTRUCTOR_CONFIG.woundHeatSpeed) || 150);
        this._woundHeatContext = Math.max(0, Number(DESTRUCTOR_CONFIG.woundHeat) || 0) *
          Math.min(1, effectiveApproachSpeed / woundSpeed);
        const gpuAwakeFrames = heavyPair ? 12 : 16;
        A._gpuForceAwakeFrames = Math.max(Number(A._gpuForceAwakeFrames) || 0, gpuAwakeFrames);
        B._gpuForceAwakeFrames = Math.max(Number(B._gpuForceAwakeFrames) || 0, gpuAwakeFrames);

        const splitDeferSpeed = Math.max(40, Number(DESTRUCTOR_CONFIG.splitDeferSpeedThreshold) || 140);
        if (impactSpeed > splitDeferSpeed || heavyPair) {
          const deferTicks = ticksAt120(
            Math.max(4, Number(DESTRUCTOR_CONFIG.splitDeferTicks) || 8) + (heavyPair ? 2 : 0),
            this._stepDt
          );
          const deferUntilTick = this._tick + deferTicks;
          if (!A.noSplit && this.splitQueue.indexOf(A) === -1) {
            A._splitDeferUntilTick = Math.max(Number(A._splitDeferUntilTick) || 0, deferUntilTick);
          }
          if (!B.noSplit && this.splitQueue.indexOf(B) === -1) {
            B._splitDeferUntilTick = Math.max(Number(B._splitDeferUntilTick) || 0, deferUntilTick);
          }
        }

        const angA = getEntityHexAngle(A);
        const angB = getEntityHexAngle(B);
        const dtScale = dt * 60;
        const totalMass = massA + massB;
        const ca = Math.cos(angA), sa = Math.sin(angA);
        const cb = Math.cos(angB), sb = Math.sin(angB);
        const shearK = DESTRUCTOR_CONFIG.shearK ?? 0.06;
        // Skalą zgniotu jest PRĘDKOŚĆ ZBLIŻANIA, nie pęd. Mnożenie przez masę
        // zredukowaną dawało energie rzędu 1e7-1e10 przy zaciskaczu ~1e2 — deformacja
        // była zawsze nasycona, więc nie niosła żadnej informacji o sile uderzenia
        // (stąd wrażenie przełącznika zamiast fizyki). Podział energii między kadłuby
        // załatwia realRatioA/B niżej, liczone z mas — masa nie znika z modelu.
        const crushEnergy = impactSpeed * (DESTRUCTOR_CONFIG.crushImpulseScale ?? 0.25) * dtScale;

        const crushNx = nx;
        const crushNy = ny;
        let wForceAx = crushNx * crushEnergy;
        let wForceAy = crushNy * crushEnergy;
        let wForceBx = -crushNx * crushEnergy;
        let wForceBy = -crushNy * crushEnergy;

        // Note: removed synthetic crush boost from penetration term.
        // Penetration now only handles separation correction at the end of function.
        if (Math.abs(velTangent) > 0.1) {
          const sh = velTangent * shearK * dtScale;
          wForceAx += tx * sh;
          wForceAy += ty * sh;
          wForceBx -= tx * sh;
          wForceBy -= ty * sh;
        }

        const forceAx = (wForceAx * ca + wForceAy * sa) / scaleAX;
        const forceAy = (-wForceAx * sa + wForceAy * ca) / scaleAY;
        const forceBx = (wForceBx * cb + wForceBy * sb) / scaleBX;
        const forceBy = (-wForceBx * sb + wForceBy * cb) / scaleBY;
        const crushScale = Math.max(0, Number(DESTRUCTOR_CONFIG.crushDeformScale) || 0);

        // 2. Nonlinear impact weighting (squared mass ratios)
        const baseRatioA = (invMassB === 0) ? 0.0 : (invMassA === 0 ? 1.0 : massB / totalMass);
        const baseRatioB = (invMassA === 0) ? 0.0 : (invMassB === 0 ? 1.0 : massA / totalMass);

        // Squaring strongly favors damage transfer into lighter body.
        // Example: ship vs ring -> almost all damage stays on the lighter ship.
        const sumSq = (baseRatioA * baseRatioA) + (baseRatioB * baseRatioB);
        const realRatioA = (baseRatioA * baseRatioA) / sumSq;
        const realRatioB = (baseRatioB * baseRatioB) / sumSq;

        if (hullPair && ramYield > 0.05) {
          this._recordFractureImpact(A, worldHitX, worldHitY, nx * effectiveApproachSpeed * realRatioA, ny * effectiveApproachSpeed * realRatioA);
          this._recordFractureImpact(B, worldHitX, worldHitY, -nx * effectiveApproachSpeed * realRatioB, -ny * effectiveApproachSpeed * realRatioB);
        }

        let crushDefAx = forceAx * (realRatioA * 2) * crushScale;
        let crushDefAy = forceAy * (realRatioA * 2) * crushScale;
        let crushDefBx = forceBx * (realRatioB * 2) * crushScale;
        let crushDefBy = forceBy * (realRatioB * 2) * crushScale;

        const maxCrushLimit = DESTRUCTOR_CONFIG.maxDeform || 220.0;
        const rawCrushMagA = Math.sqrt(crushDefAx * crushDefAx + crushDefAy * crushDefAy);
        const rawCrushMagB = Math.sqrt(crushDefBx * crushDefBx + crushDefBy * crushDefBy);

        // Nadmiar obrazen ponad sufit heksa, zbierany przez wszystkie kontakty pary.
        let overkillA = 0;
        let overkillB = 0;

        if (this.ramDebug?.enabled) {
          this._dbgRam(A, B, {
            massA, massB, impactSpeed,
            approachSpeed: effectiveApproachSpeed,
            contactsCount, crushEnergy,
            realRatioA, realRatioB,
            rawCrushMagA, rawCrushMagB, maxCrushLimit
          });
        }

        // Static reusable objects to avoid GC pressure
        const _clampA = this._clampResultA || (this._clampResultA = { x: 0, y: 0 });
        const _clampB = this._clampResultB || (this._clampResultB = { x: 0, y: 0 });

        clampCrushVector(crushDefAx, crushDefAy, realRatioA, rawCrushMagA, maxCrushLimit, _clampA);
        clampCrushVector(crushDefBx, crushDefBy, realRatioB, rawCrushMagB, maxCrushLimit, _clampB);

        const clampA = _clampA;
        const clampB = _clampB;
        let crushStampB = (this._crushStampCounter + 2) | 0;

        if (crushStampB <= 1) crushStampB = 2;
        this._crushStampCounter = crushStampB;
        this._crushStampA = crushStampB - 1;
        this._crushStampB = crushStampB;

        const massAdvantageA = massA / (massB + 1);
        const massAdvantageB = massB / (massA + 1);
        const brittleA = isBrittleEntity(A);
        const brittleB = isBrittleEntity(B);
        // Jeden ciągły sufit obrażeń na heks na tick — ułamek jego HP. Zamiast
        // kaskady progów (hardWall/overrun/steel) energia zderzenia po prostu
        // rozkłada się w czasie: żeby wyparować dziób, trzeba w nim posiedzieć.
        const contactDamageCapFrac = Math.max(0.01, Number(DESTRUCTOR_CONFIG.contactDamageCapFrac) || 0.25);
        const contactDamageScale = Math.max(0, Number(DESTRUCTOR_CONFIG.contactDamageScale) || 0);
        // Damage from advancing through a cell is local work, not a fixed pool
        // divided by the number of sampled contacts. A wider contact must not
        // make every plate harder to crush. Each shard is still charged once.
        const crushDamageTravel = effectiveApproachSpeed * dt * ramYield *
          (contactDamageScale / DEFAULT_CONTACT_DAMAGE_SCALE);
        const crushTravelA = crushDamageTravel * realRatioA;
        const crushTravelB = crushDamageTravel * realRatioB;
        const damageWidthA = 2 * Math.max(scaleAX, scaleAY);
        const damageWidthB = 2 * Math.max(scaleBX, scaleBY);

        let dirtyMinA = Number.POSITIVE_INFINITY;
        let dirtyMaxA = -1;
        let dirtyMinB = Number.POSITIVE_INFINITY;
        let dirtyMaxB = -1;

        for (let c = 0; c < contactsCount; c++) {
          const ct = contacts[c];
          const sA = ct.shardA;
          const sB = ct.shardB;

          // OBIEKT A
          if (sA && sA.active && sA._crushStamp !== this._crushStampA) {
            sA._crushStamp = this._crushStampA;
            // Wpychamy heksy proporcjonalnie do przewagi masy
            const pushMult = 1.0 + Math.min(6.0, massAdvantageB * 0.2);
            const pushX = clampA.x * pushMult;
            const pushY = clampA.y * pushMult;

            if (brittleA) {
              sA.__collVelX = (sA.__collVelX || 0) + (pushX * 0.35);
              sA.__collVelY = (sA.__collVelY || 0) + (pushY * 0.35);
            } else {
              sA.applyDeformation(pushX, pushY, 1.0, true);
              noteHexDrift(A.hexGrid, sA);
              noteElasticShard(A.hexGrid, sA);

              const defSqA = sA.targetDeformation.x * sA.targetDeformation.x + sA.targetDeformation.y * sA.targetDeformation.y;
              const hardLimitSq = maxCrushLimit * maxCrushLimit * 1.5;
              if (defSqA > hardLimitSq) {
                const defScale = Math.sqrt(hardLimitSq / defSqA);
                sA.targetDeformation.x *= defScale;
                sA.targetDeformation.y *= defScale;
                sA.deformation.x *= defScale;
                sA.deformation.y *= defScale;
              }
            }

            const idxA = Number(sA.__meshIndex);
            if (Number.isFinite(idxA)) {
              if (idxA < dirtyMinA) dirtyMinA = idxA;
              if (idxA > dirtyMaxA) dirtyMaxA = idxA;
            } else {
              dirtyMinA = 0;
              dirtyMaxA = A.hexGrid.shards.length - 1;
            }

            // Prędkość kontaktu dokłada już applyDeformation (vec * 1.5, z
            // clampem MAX_VEL). Drugi dopisek *1.2 szedł PO tym clampie, więc
            // sumarycznie heks dostawał 2.7x push i wychodził poza sufit —
            // przy pushX = 144 dawało to __collVel ~333, a shader dopuszcza
            // 180, czyli def += 180 w jednej iteracji. Jedno źródło impulsu.

            if (doDamage) {
              const shardHpA = Math.max(1, Number(sA.maxHp) || DESTRUCTOR_CONFIG.shardHP);
              const kineticDmg = (rawCrushMagA * realRatioA * contactDamageScale) / Math.sqrt(contactsCount);
              const crushDamage = shardHpA * crushTravelA / Math.max(1, getShardHitRadius(sA) * damageWidthA);
              const damage = kineticDmg * (brittleA ? 3.5 : 1.0) + crushDamage;
              const cap = brittleA ? (shardHpA * 0.75) : (shardHpA * contactDamageCapFrac);
              sA.hp -= Math.min(cap, damage);
              if (damage > cap) overkillA += damage - cap;
              // Żar PRZED testem hp — heks niszczony w tym ticku ma odlecieć
              // rozgrzany, a nie zimny.
              if (heatGain > 0) addShardHeat(sA, Math.min(1, damage / shardHpA) * heatGain, nowSec);
            }

            if (sA.hp <= 0) {
              this.destroyShard(A, sA);
              if (!A.noSplit && this.splitQueue.indexOf(A) === -1) this.splitQueue.push(A);
            } else if (hullPair) {
              this._queueStretchedFracture(A, sA);
            }
          }

          // OBIEKT B
          if (sB && sB.active && sB._crushStamp !== this._crushStampB) {
            sB._crushStamp = this._crushStampB;
            const pushMult = 1.0 + Math.min(6.0, massAdvantageA * 0.2);
            const pushX = clampB.x * pushMult;
            const pushY = clampB.y * pushMult;

            if (brittleB) {
              sB.__collVelX = (sB.__collVelX || 0) + (pushX * 0.35);
              sB.__collVelY = (sB.__collVelY || 0) + (pushY * 0.35);
            } else {
              sB.applyDeformation(pushX, pushY, 1.0, true);
              noteHexDrift(B.hexGrid, sB);
              noteElasticShard(B.hexGrid, sB);

              const defSqB = sB.targetDeformation.x * sB.targetDeformation.x + sB.targetDeformation.y * sB.targetDeformation.y;
              const hardLimitSqB = maxCrushLimit * maxCrushLimit * 1.5;
              if (defSqB > hardLimitSqB) {
                const defScaleB = Math.sqrt(hardLimitSqB / defSqB);
                sB.targetDeformation.x *= defScaleB;
                sB.targetDeformation.y *= defScaleB;
                sB.deformation.x *= defScaleB;
                sB.deformation.y *= defScaleB;
              }
            }

            const idxB = Number(sB.__meshIndex);
            if (Number.isFinite(idxB)) {
              if (idxB < dirtyMinB) dirtyMinB = idxB;
              if (idxB > dirtyMaxB) dirtyMaxB = idxB;
            } else {
              dirtyMinB = 0;
              dirtyMaxB = B.hexGrid.shards.length - 1;
            }

            // Patrz komentarz przy obiekcie A — impuls kontaktu wchodzi
            // wyłącznie przez applyDeformation.

            if (doDamage) {
              const shardHpB = Math.max(1, Number(sB.maxHp) || DESTRUCTOR_CONFIG.shardHP);
              const kineticDmg = (rawCrushMagB * realRatioB * contactDamageScale) / Math.sqrt(contactsCount);
              const crushDamage = shardHpB * crushTravelB / Math.max(1, getShardHitRadius(sB) * damageWidthB);
              const damage = kineticDmg * (brittleB ? 3.5 : 1.0) + crushDamage;
              const cap = brittleB ? (shardHpB * 0.75) : (shardHpB * contactDamageCapFrac);
              sB.hp -= Math.min(cap, damage);
              if (damage > cap) overkillB += damage - cap;
              // Patrz komentarz przy obiekcie A.
              if (heatGain > 0) addShardHeat(sB, Math.min(1, damage / shardHpB) * heatGain, nowSec);
            }

            if (sB.hp <= 0) {
              this.destroyShard(B, sB);
              if (!B.noSplit && this.splitQueue.indexOf(B) === -1) this.splitQueue.push(B);
            } else if (hullPair) {
              this._queueStretchedFracture(B, sB);
            }
          }
        }

        // Szybszy taran = SZERSZA dziura. Nadmiar ponad sufit heksa idzie w
        // promieniste rozejscie sie uszkodzen w srodku plamy styku — ta sama
        // sciezka, ktorej uzywaja pociski. Bez tego jeden kontakt to zawsze
        // dokladnie jeden zniszczony heks i predkosc powyzej ~500 u/s nie ma
        // zadnego znaczenia dla zniszczen.
        const overkillMin = Number(DESTRUCTOR_CONFIG.ramOverkillMinDamage) || 25;
        if (overkillA > overkillMin || overkillB > overkillMin) {
          const radiusScale = Number(DESTRUCTOR_CONFIG.ramOverkillRadiusScale) || 1.6;
          const radiusMax = Number(DESTRUCTOR_CONFIG.ramOverkillMaxRadius) || 180;
          if (overkillA > overkillMin && A.hexGrid) {
            const rA = Math.min(radiusMax, Math.sqrt(overkillA) * radiusScale);
            this.applyImpact(A, worldHitX, worldHitY, overkillA, _ZERO_VEL, { radius: rA });
          }
          if (overkillB > overkillMin && B.hexGrid) {
            const rB = Math.min(radiusMax, Math.sqrt(overkillB) * radiusScale);
            this.applyImpact(B, worldHitX, worldHitY, overkillB, _ZERO_VEL, { radius: rB });
          }
        }
        this._woundHeatContext = 0;

        if (A.hexGrid && dirtyMaxA >= 0 && Number.isFinite(dirtyMinA)) {
          if (brittleA) markBrittleTransient(A, 0, dirtyMinA, dirtyMaxA);
          markGridMeshDirtyRange(A.hexGrid, dirtyMinA, dirtyMaxA);
          if (!HEX_SHIPS_3D_ACTIVE) A.hexGrid.textureDirty = true;
        }

        if (B.hexGrid && dirtyMaxB >= 0 && Number.isFinite(dirtyMinB)) {
          if (brittleB) markBrittleTransient(B, 0, dirtyMinB, dirtyMaxB);
          markGridMeshDirtyRange(B.hexGrid, dirtyMinB, dirtyMaxB);
          if (!HEX_SHIPS_3D_ACTIVE) B.hexGrid.textureDirty = true;
        }
      }

      // Correct rigid penetration; the yielding fraction is consumed by crush.
      // Full correction here would eject the target even with a soft impulse.
      // Contacts destroyed or moved apart by this very crush no longer support
      // a correction. Reuse the bounded contact buffer, not another hull scan.
      penetration = 0;
      const cosA = iterator === A ? cosI : cosG, sinA = iterator === A ? sinI : sinG;
      const cosB = iterator === B ? cosI : cosG, sinB = iterator === B ? sinI : sinG;
      for (let i = 0; i < contactsCount; i++) {
        const ct = contacts[i];
        if (!ct.shardA.active || ct.shardA.isDebris || !ct.shardB.active || ct.shardB.isDebris) continue;
        let remaining = ct.penetration;
        if (crushPass) {
          const laX = getShardCollisionGridX(ct.shardA) - A.hexGrid.srcWidth * 0.5 - (A.hexGrid.pivot?.x || 0);
          const laY = getShardCollisionGridY(ct.shardA) - A.hexGrid.srcHeight * 0.5 - (A.hexGrid.pivot?.y || 0);
          const lbX = getShardCollisionGridX(ct.shardB) - B.hexGrid.srcWidth * 0.5 - (B.hexGrid.pivot?.x || 0);
          const lbY = getShardCollisionGridY(ct.shardB) - B.hexGrid.srcHeight * 0.5 - (B.hexGrid.pivot?.y || 0);
          const wxA = aX + localDeltaToWorldX(laX, laY, scaleAX, scaleAY, cosA, sinA, usesBillboardOrientation(A));
          const wyA = aY + localDeltaToWorldY(laX, laY, scaleAX, scaleAY, cosA, sinA, usesBillboardOrientation(A));
          const wxB = bX + localDeltaToWorldX(lbX, lbY, scaleBX, scaleBY, cosB, sinB, usesBillboardOrientation(B));
          const wyB = bY + localDeltaToWorldY(lbX, lbY, scaleBX, scaleBY, cosB, sinB, usesBillboardOrientation(B));
          const radius = (getShardHitRadius(ct.shardA) * Math.max(scaleAX, scaleAY) +
            getShardHitRadius(ct.shardB) * Math.max(scaleBX, scaleBY)) * 0.78;
          remaining = Math.max(0, radius - Math.hypot(wxA - wxB, wyA - wyB));
        }
        if (remaining > penetration) penetration = remaining;
      }
      const deepPenetration = penetration > (HIT_RAD * 0.35);
      const isHittingWallSep = (invMassA === 0 || invMassB === 0) || isRingCollision;
      const sepPercent = (isHittingWallSep || deepPenetration)
        ? 1.0
        : Math.max(0.05, Math.min(1, Number(DESTRUCTOR_CONFIG.separationPercent) || 0.9));

      if (penetration > slop) {
        const correctionRate = hullPair ? -Math.expm1(-12 * dt) : 1;
        const corr = Math.max(penetration - slop, 0) / (invMassA + invMassB) * sepPercent * rigidShare * correctionRate;
        const sepNx = nx;
        const sepNy = ny;
        addEntityPosition(A, sepNx * corr * invMassA, sepNy * corr * invMassA);
        addEntityPosition(B, -sepNx * corr * invMassB, -sepNy * corr * invMassB);
      }

      // Kontakt, który ruszył wrak, budzi go i liczy się jako trafienie
      // (zimne wraki: warunek „od ostatniego kontaktu minęło…”).
      if (aWreck && this._wreckContactWakes(A, B, relSpeed, aPreX, aPreY, aPreVx, aPreVy, aPreW)) {
        this.wakeWreck(A);
        A._lastImpactMs = this._simulationTime * 1000;
      }
      if (bWreck && this._wreckContactWakes(B, A, relSpeed, bPreX, bPreY, bPreVx, bPreVy, bPreW)) {
        this.wakeWreck(B);
        B._lastImpactMs = this._simulationTime * 1000;
      }
    } finally {
      // Wyjątek w środku zgniotu nie może zostawić kontekstu rany włączonego —
      // następny pocisk rozżarzyłby wyrwę jak taran.
      this._woundHeatContext = 0;
      if (dbgEnabled) this._dbgCollisionRecord('collideEntities', nowMs() - tCollide0);
    }
  },

  // velVector optionally overrides the parent's world-space linear velocity.
  // Rotation and local contact/solver motion are added once by becomeDebris.
  destroyShard(entity, shard, velVector) {
    if (!entity?.hexGrid || !shard || shard.isDebris) return;
    this.wakeHexEntity(entity, DESTRUCTOR_CONFIG.elasticWakeFrames | 0);
    markBrittleTransient(entity, 0, Number(shard.__meshIndex), Number(shard.__meshIndex));
    shard.hp = 0;

    const shouldEraseCache = !(HEX_SHIPS_3D_ACTIVE && (entity.isRingSegment || !!entity.hexGrid.armorImage));
    const suppressDebris = HEX_SHIPS_3D_ACTIVE && entity.isRingSegment;
    if (shouldEraseCache) this._queueShardErase(entity, shard);

    const scale = getFinalScale(entity);

    if (suppressDebris) {
      shard.isDebris = true;
      shard.active = false;
    } else {
      shard.becomeDebris(
        velVector?.x ?? getEntityVelX(entity),
        velVector?.y ?? getEntityVelY(entity),
        entity,
        scale
      );
    }

    // Po oderwaniu (shard jest już nieaktywny, więc pętla pierścieni go pomija).
    this._heatWoundRim(entity, shard);

    if (Number.isFinite(entity.hexGrid.activeStructuralCount)) {
      entity.hexGrid.activeStructuralCount = Math.max(0, entity.hexGrid.activeStructuralCount - 1);
    }
    if ((DESTRUCTOR_CONFIG.packedHexArena | 0) === 1) {
      setPackedShardActive(entity, shard, false, true);
    }
    if (shard.__asteroidCore === true && Number.isFinite(entity.hexGrid.asteroidCoreActive)) {
      entity.hexGrid.asteroidCoreActive = Math.max(0, entity.hexGrid.asteroidCoreActive - 1);
    }

    markGridMeshDirtyByShard(entity.hexGrid, shard);

    if (shouldEraseCache) entity.hexGrid.gpuTextureNeedsUpdate = true;
  },

  recycleWreck(wreck) {
    if (!wreck || !wreck.isWreck || wreck._inPool) return;
    // Rekord transportowy ma jedyną fizyczną kopię ładunku w tym manifeście.
    // Wrak może wrócić do puli dopiero po atomowym odzysku całej partii.
    if (Object.values(wreck._cargoManifest || {}).some(amount => (Number(amount) || 0) > 0)) return false;
    wreck.dead = true;
    wreck.isCollidable = false;
    // Bez tego łup wyciekłby do następnego wraku biorącego ten obiekt z puli.
    clearSalvage(wreck);
    wreck._wreckAge = 0;
    wreck._wreckSleepTimer = 0;
    wreck._wreckSleeping = false;
    // Zimny wrak (hexGrid === null) też tu trafia — releaseHexGridArena to
    // toleruje, a spawnWreckEntity da mu nową skorupę siatki przy wydaniu z puli.
    if ((DESTRUCTOR_CONFIG.packedHexArena | 0) === 1) releaseHexGridArena(wreck);
    wreck.isCold = false;
    wreck._coldSnapshot = null;
    wreck._inPool = true;
    this._wreckPool.push(wreck);
    return true;
  },

  processSplits(entities) {
    const dbgEnabled = this._liveCollisionDebug?.enabled === true;
    const tSplitDbg0 = dbgEnabled ? nowMs() : 0;
    
    try {
      const queued = this.splitQueue;
      if (!queued.length) return;
      this.splitQueue = [];

      let stamp = (this._splitStamp + 1) | 0;
      if (stamp <= 0) stamp = 1;
      this._splitStamp = stamp;

      const queue = this._splitUniqueBuffer;
      queue.length = 0;

      for (let i = 0; i < queued.length; i++) {
        const entity = queued[i];
        if (!entity) continue;
        if (entity._destrSplitStamp === stamp) continue;
        entity._destrSplitStamp = stamp;
        queue.push(entity);
      }

      const splitBudgetMs = Math.max(0.25, Number(DESTRUCTOR_CONFIG.splitTimeBudgetMs) || 1.2);
      const splitMaxPerTick = Math.max(1, DESTRUCTOR_CONFIG.splitMaxPerTick | 0);
      const startedAt = nowMs();
      let processedCount = 0;
      const deferred = this.splitQueue;

      for (const entity of queue) {
        if (!entity?.hexGrid) continue;

        const splitDeferUntilTick = Number(entity._splitDeferUntilTick) || 0;
        if (splitDeferUntilTick > 0) {
          if (splitDeferUntilTick > this._tick) {
            deferred.push(entity);
            continue;
          }
          entity._splitDeferUntilTick = 0;
        }

        if (processedCount >= splitMaxPerTick || (nowMs() - startedAt) > splitBudgetMs) {
          deferred.push(entity);
          continue;
        }

        const impact = entity.hexGrid._fractureImpact;
        const freshImpact = impact && this._simulationTime - impact.time < DESTRUCTOR_CONFIG.fractureImpactMemory;
        const groups = this.findIslands(entity.hexGrid, !!freshImpact);
        if (groups.length <= 1) continue;

        if (entity.isAsteroidHex) {
          // Asteroida zostaje przy fragmencie zawierającym rdzeń, nie przy
          // największym pustym pierścieniu. O(shards), tylko przy faktycznym splicie.
          let mainIndex = 0;
          let bestCoreCount = -1;
          let bestLength = -1;
          for (let gi = 0; gi < groups.length; gi++) {
            const group = groups[gi];
            let coreCount = 0;
            for (let si = 0; si < group.length; si++) {
              if (group[si]?.__asteroidCore === true) coreCount++;
            }
            if (coreCount > bestCoreCount || (coreCount === bestCoreCount && group.length > bestLength)) {
              mainIndex = gi;
              bestCoreCount = coreCount;
              bestLength = group.length;
            }
          }
          if (mainIndex !== 0) {
            const tmp = groups[0];
            groups[0] = groups[mainIndex];
            groups[mainIndex] = tmp;
          }
        } else {
          groups.sort((a, b) => b.length - a.length);
        }
        const main = groups[0];
        const loose = groups.slice(1);

        let spawnedFragments = 0;
        const maxFragments = Math.max(1, DESTRUCTOR_CONFIG.wreckSplitMaxFragments | 0);
        // Detach chips while the original packed body still owns their slots.
        // Rebuilding the main island first left stale boundary references and
        // orphaned arena allocations when many small islands broke together.
        for (const group of loose) {
          if (entity.isAsteroidHex || group.length < 3 || spawnedFragments >= maxFragments) {
            for (const s of group) this.destroyShard(entity, s);
            continue;
          }
          spawnedFragments++;
        }
        releaseInactiveHexShards(entity.hexGrid.shards);
        this.rebuildEntityGrid(entity, main);
        entity._splitRecoil = 0;
        entity._collectSplitRecoil = true;
        for (const group of loose) {
          if (group[0].active && !group[0].isDebris) this.spawnWreckEntity(entity, group, entities);
        }
        entity._collectSplitRecoil = false;
        // One bounded reaction for the retained part, after every loose part has
        // inherited the same pre-fracture angular velocity.
        addEntityAngVel(entity, Math.max(-0.18, Math.min(0.18, entity._splitRecoil)));
        if (impact) impact.time = -Infinity;
        entity.hexGrid.activeStructuralCount = entity.hexGrid.shards.length;
        processedCount++;
      }
    } finally {
      if (dbgEnabled) this._dbgCollisionRecord('processSplits', nowMs() - tSplitDbg0);
    }
  },

  findIslands(grid, breakStretchedBonds = false) {
    const cols = grid?.cols | 0;
    const rows = grid?.rows | 0;
    const cells = grid?.grid;
    if (!cells || cols <= 0 || rows <= 0) return [];

    const total = cols * rows;
    const tearLength = HEX_HEIGHT + Math.max(HEX_HEIGHT * 1.5, Number(DESTRUCTOR_CONFIG.tearThreshold) || 34);
    const tearLengthSq = tearLength * tearLength;
    let visited = grid._islandVisited;

    if (!(visited instanceof Uint8Array) || visited.length < total) {
      visited = new Uint8Array(total);
      grid._islandVisited = visited;
    } else {
      visited.fill(0, 0, total);
    }

    let stack = grid._islandStack;
    if (!(stack instanceof Int32Array) || stack.length < total) {
      stack = new Int32Array(total);
      grid._islandStack = stack;
    }

    const groups = [];

    for (let seedIdx = 0; seedIdx < total; seedIdx++) {
      if (visited[seedIdx]) continue;

      const seed = cells[seedIdx];
      if (!seed || !seed.active || seed.isDebris) {
        visited[seedIdx] = 1;
        continue;
      }

      const group = [];
      let stackSize = 0;
      stack[stackSize++] = seedIdx;
      visited[seedIdx] = 1;

      while (stackSize > 0) {
        const curIdx = stack[--stackSize];
        const cur = cells[curIdx];
        if (!cur || !cur.active || cur.isDebris) continue;

        group.push(cur);

        for (const n of cur.neighbors || []) {
          if (!n || !n.active || n.isDebris) continue;
          const nc = n.c | 0;
          const nr = n.r | 0;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          
          const nIdx = nc + nr * cols;
          if (visited[nIdx]) continue;
          if (cells[nIdx] !== n) continue;

          // Real tensile opening, measured after visible bending. Compression
          // alone must not cut bonds or turn an intact plate into confetti.
          if (breakStretchedBonds) {
            const dx = getShardVisualGridX(n) - getShardVisualGridX(cur);
            const dy = getShardVisualGridY(n) - getShardVisualGridY(cur);
            if (dx * dx + dy * dy > tearLengthSq) continue;
          }

          visited[nIdx] = 1;
          stack[stackSize++] = nIdx;
        }
      }
      if (group.length) groups.push(group);
    }
    return groups;
  },

  rebuildEntityGrid(entity, shards) {
    const cols = entity.hexGrid.cols || Math.ceil(entity.hexGrid.srcWidth / HEX_SPACING);
    const rows = entity.hexGrid.rows || Math.ceil(entity.hexGrid.srcHeight / HEX_HEIGHT);
    const map = {};
    const grid = new Array(cols * rows);

    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      s.__meshIndex = i;
      map[s.c + ',' + s.r] = s;
      if (s.c >= 0 && s.c < cols && s.r >= 0 && s.r < rows) grid[s.c + s.r * cols] = s;
    }

    entity.hexGrid.shards = shards;
    // The grid now represents only one island of the original sprite. Its
    // source texture remains shared for sharp per-hex UVs, but it must never
    // use the full-sprite armor impostor in the renderer.
    entity.hexGrid.isFragment = true;
    entity.hexGrid.disableSolidArmorLod = true;

    if (!Array.isArray(entity.hexGrid._pendingEraseQueue)) entity.hexGrid._pendingEraseQueue = [];
    else entity.hexGrid._pendingEraseQueue.length = 0;

    entity.hexGrid.map = map;
    entity.hexGrid.grid = grid;
    entity.hexGrid.cols = cols;
    entity.hexGrid.rows = rows;

    if (!HEX_SHIPS_3D_ACTIVE) {
      entity.hexGrid.textureDirty = true;
      entity.hexGrid.cacheDirty = true;
    } else {
      entity.hexGrid.textureDirty = false;
      entity.hexGrid.cacheDirty = false;
    }

    markGridMeshDirtyAll(entity.hexGrid);

    entity.hexGrid.isSleeping = false;
    entity.hexGrid.sleepFrames = 0;
    entity.hexGrid.wakeHoldFrames = DESTRUCTOR_CONFIG.elasticWakeFrames | 0;
    entity.hexGrid.activeStructuralCount = shards.length;

    entity.hexGrid.baseStructuralCount = Math.max(
      Number(entity.hexGrid.baseStructuralCount) || 0,
      shards.length
    );

    rebuildNeighbors(entity.hexGrid);
    if ((DESTRUCTOR_CONFIG.packedHexArena | 0) === 1) rebuildHexGridArena(entity, shards);
    if (!entity.isPlayer && !entity.isAsteroidHex) entity.mass = Math.max(10, sumShardMass(shards));
  },

  spawnWreckEntity(parent, shards, entities) {
    if (!parent?.hexGrid || !shards?.length) return;

    let sumX = 0, sumY = 0;
    for (const s of shards) {
      sumX += s.gridX + s.deformation.x;
      sumY += s.gridY + s.deformation.y;
    }

    const avgX = sumX / shards.length;
    const avgY = sumY / shards.length;
    const cx = parent.hexGrid.srcWidth * 0.5;
    const cy = parent.hexGrid.srcHeight * 0.5;
    const relX = avgX - cx;
    const relY = avgY - cy;
    const parentOffsetX = relX - (parent.hexGrid.pivot?.x || 0);
    const parentOffsetY = relY - (parent.hexGrid.pivot?.y || 0);

    let maxD2 = 0;
    for (const s of shards) {
      const d2 = ((s.gridX + s.deformation.x) - avgX) ** 2 + ((s.gridY + s.deformation.y) - avgY) ** 2;
      if (d2 > maxD2) maxD2 = d2;
    }

    const newRadius = Math.sqrt(maxD2) + DESTRUCTOR_CONFIG.gridDivisions * 2;
    const scaleX = getFinalScaleX(parent);
    const scaleY = getFinalScaleY(parent);
    const ang = getEntityHexAngle(parent);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const billboardOrientation = usesBillboardOrientation(parent);

    const worldX = getEntityPosX(parent) + localDeltaToWorldX(parentOffsetX, parentOffsetY, scaleX, scaleY, c, s, billboardOrientation);
    const worldY = getEntityPosY(parent) + localDeltaToWorldY(parentOffsetX, parentOffsetY, scaleX, scaleY, c, s, billboardOrientation);

    const angVel = getEntityAngVel(parent);
    let wreckVx = getEntityVelX(parent);
    let wreckVy = getEntityVelY(parent);

    if (angVel) {
      const rx = worldX - getEntityPosX(parent);
      const ry = worldY - getEntityPosY(parent);
      wreckVx += -angVel * ry;
      wreckVy += angVel * rx;
    }

    let shardImpulseX = 0;
    let shardImpulseY = 0;
    let shardTorque = 0;
    let energizedShards = 0;
    for (const shard of shards) {
      const localVx = (Number(shard?.__velX) || 0) + (Number(shard?.__collVelX) || 0);
      const localVy = (Number(shard?.__velY) || 0) + (Number(shard?.__collVelY) || 0);
      const speedSq = localVx * localVx + localVy * localVy;
      if (speedSq < 0.0001) continue;
      shardImpulseX += localVx;
      shardImpulseY += localVy;
      shardTorque += (((shard.gridX + shard.deformation.x) - avgX) * localVy) - (((shard.gridY + shard.deformation.y) - avgY) * localVx);
      energizedShards++;
    }

    const localToWorldX = (x, y) => localDeltaToWorldX(x, y, scaleX, scaleY, c, s, billboardOrientation);
    const localToWorldY = (x, y) => localDeltaToWorldY(x, y, scaleX, scaleY, c, s, billboardOrientation);

    if (energizedShards > 0) {
      const invEnergized = 1 / energizedShards;
      const avgImpulseX = shardImpulseX * invEnergized;
      const avgImpulseY = shardImpulseY * invEnergized;
      const splitLinearResponse = Math.max(0.05, Number(DESTRUCTOR_CONFIG.wreckSplitLinearResponse) || 0.20);
      wreckVx += localToWorldX(avgImpulseX, avgImpulseY) * splitLinearResponse;
      wreckVy += localToWorldY(avgImpulseX, avgImpulseY) * splitLinearResponse;
    }

    const radialWorldX = localToWorldX(parentOffsetX, parentOffsetY);
    const radialWorldY = localToWorldY(parentOffsetX, parentOffsetY);
    const radialLen = Math.hypot(radialWorldX, radialWorldY);
    if (radialLen > 0.001) {
      const outwardKickMul = Math.max(0.002, Number(DESTRUCTOR_CONFIG.wreckSplitOutwardKick) || 0.010);
      const outwardKick = Math.min(12, Math.max(2, newRadius * outwardKickMul));
      wreckVx += (radialWorldX / radialLen) * outwardKick;
      wreckVy += (radialWorldY / radialLen) * outwardKick;
    }

    let splitAngKick = 0;
    if (energizedShards > 0) {
      const angResponse = Math.max(0.004, Number(DESTRUCTOR_CONFIG.wreckSplitAngularResponse) || 0.030);
      const torqueDenom = Math.max(80, energizedShards * Math.max(18, newRadius * newRadius * 0.08));
      splitAngKick = (shardTorque / torqueDenom) * angResponse;
    }

    const impact = parent.hexGrid._fractureImpact;
    const impactAge = impact ? this._simulationTime - impact.time : Infinity;
    const memory = Math.max(0.001, Number(DESTRUCTOR_CONFIG.fractureImpactMemory) || 0.6);
    const freshImpact = impactAge >= 0 && impactAge < memory;
    if (freshImpact) {
      const armX = localToWorldX(impact.x - avgX, impact.y - avgY);
      const armY = localToWorldY(impact.x - avgX, impact.y - avgY);
      const impactVx = localToWorldX(impact.vx, impact.vy);
      const impactVy = localToWorldY(impact.vx, impact.vy);
      const radiusWorld = Math.max(1, newRadius * Math.max(scaleX, scaleY));
      const proximity = radiusWorld / (radiusWorld + Math.hypot(armX, armY));
      const response = Math.max(0, Number(DESTRUCTOR_CONFIG.wreckSplitImpactResponse) || 0) * proximity * (1 - impactAge / memory);
      const speed = Math.hypot(impactVx, impactVy);
      const gain = Math.min(response, 90 / Math.max(1, speed));
      const kickX = impactVx * gain, kickY = impactVy * gain;
      wreckVx += kickX;
      wreckVy += kickY;
      splitAngKick += (armX * kickY - armY * kickX) / Math.max(25, radiusWorld * radiusWorld * 0.5);
    }

    if (!freshImpact && Math.abs(splitAngKick) < 0.003 && radialLen > 0.001) {
      const dominantAxisSign = Math.abs(relX) >= Math.abs(relY)
        ? Math.sign(relX || 1)
        : -Math.sign(relY || 1);
      const minSpin = Math.max(0.002, Number(DESTRUCTOR_CONFIG.wreckSplitMinAngularKick) || 0.012);
      splitAngKick = dominantAxisSign * Math.min(0.035, Math.max(minSpin, newRadius / 2200));
    }

    const maxSpin = Math.max(0, Number(DESTRUCTOR_CONFIG.wreckSplitMaxAngularKick) || 0.35);
    splitAngKick = Math.max(-maxSpin, Math.min(maxSpin, splitAngKick));
    if (freshImpact && parent._collectSplitRecoil) {
      const fragmentRadius = newRadius * Math.max(scaleX, scaleY);
      const parentRadius = Math.max(fragmentRadius, Number(parent.radius) || Math.max(cx * scaleX, cy * scaleY));
      parent._splitRecoil -= splitAngKick * sumShardMass(shards) * fragmentRadius * fragmentRadius /
        Math.max(1, getEntityMass(parent) * parentRadius * parentRadius);
    }

    const cols = parent.hexGrid.cols || Math.ceil(parent.hexGrid.srcWidth / HEX_SPACING);
    const rows = parent.hexGrid.rows || Math.ceil(parent.hexGrid.srcHeight / HEX_HEIGHT);

    let wreck = this._wreckPool.pop();

    if (!wreck) {
      wreck = { hexGrid: createWreckGridShell() };
    } else if (!wreck.hexGrid) {
      // Zimny wrak wyrzucony limitem MAX_COLD_WRECKS wrócił do puli bez siatki.
      wreck.hexGrid = createWreckGridShell();
    }

    wreck._inPool = false;
    wreck.isCold = false;
    wreck._coldSnapshot = null;
    wreck._coldUnsupported = false;
    wreck._wreckSleptSec = 0;
    // Świeży fragment właśnie oderwało trafienie albo zgniot.
    wreck._lastImpactMs = this._simulationTime * 1000;
    wreck._destrObbTick = -1;
    wreck.x = worldX;
    wreck.y = worldY;
    wreck.vx = wreckVx;
    wreck.vy = wreckVy;
    wreck.angle = getEntityAngle(parent);
    wreck.angVel = getEntityAngVel(parent) + splitAngKick;
    wreck.radius = newRadius;
    const parentBaseCount = Math.max(
      1,
      Number(parent.hexGrid.baseStructuralCount) || Number(parent.hexGrid.shards?.length) || shards.length
    );
    const inheritedMass = parent.isAsteroidHex
      ? Math.max(10, getEntityMass(parent) * (shards.length / parentBaseCount))
      : Math.max(10, sumShardMass(shards));
    wreck.mass = inheritedMass;
    wreck.friction = parent.isAsteroidHex ? 1.0 : 0.9986;
    wreck.dead = false;
    wreck.isWreck = true;
    wreck.isAsteroidHex = !!parent.isAsteroidHex;
    wreck.noWreckSleep = !!parent.isAsteroidHex;
    wreck.destructionMaterial = parent.destructionMaterial;
    wreck.noElasticity = parent.noElasticity === true;
    wreck.noGpuSoftBody = parent.noGpuSoftBody === true;
    wreck.isCollidable = true;
    wreck._wreckAge = 0;
    wreck._wreckSleepTimer = 0;
    wreck._wreckSleeping = false;
    wreck._cargoOrderId = null;
    wreck._cargoWreckId = null;
    wreck._cargoManifest = null;
    wreck.owner = parent.owner || parent;
    wreck.visual = {
      spriteScale: Math.max(scaleX, scaleY),
      spriteScaleX: scaleX,
      spriteScaleY: scaleY,
      preserveBillboardLighting: parent.visual?.preserveBillboardLighting === true,
      preserveBillboardOrientation: parent.visual?.preserveBillboardOrientation === true,
      spriteRotation: getEntitySpriteRotation(parent)
    };

    const wGrid = wreck.hexGrid;
    wGrid._fractureImpact = null;
    wGrid._maxHexDrift = Number(parent.hexGrid._maxHexDrift) || 0;
    wGrid.shards = shards;
    wGrid.isFragment = true;
    wGrid.disableSolidArmorLod = true;

    if (!Array.isArray(wGrid._pendingEraseQueue)) wGrid._pendingEraseQueue = [];
    else wGrid._pendingEraseQueue.length = 0;

    wGrid.cols = cols;
    wGrid.rows = rows;
    wGrid.srcWidth = parent.hexGrid.srcWidth;
    wGrid.srcHeight = parent.hexGrid.srcHeight;
    wGrid.armorImage = parent.hexGrid.armorImage || null;
    wGrid.visualImage = parent.hexGrid.visualImage || null;
    // Fragment żyje na komórkach szablonu rodzica (te same c/r, src, cols/rows),
    // więc dziedziczy jego klucz — z niego zimny wrak odtwarza siatkę.
    wGrid.hexTemplate = parent.hexGrid.hexTemplate || null;
    wGrid.templateImage = parent.hexGrid.templateImage || null;
    wGrid.templateAlpha = parent.hexGrid.templateAlpha;

    if (!HEX_SHIPS_3D_ACTIVE) {
      wGrid.cacheDirty = true;
      wGrid.textureDirty = true;
    } else {
      wGrid.cacheDirty = false;
      wGrid.textureDirty = false;
    }

    markGridMeshDirtyAll(wGrid);
    wGrid.gpuTextureNeedsUpdate = false;
    wGrid.isSleeping = false;
    wGrid.sleepFrames = 0;
    wGrid.wakeHoldFrames = DESTRUCTOR_CONFIG.elasticWakeFrames | 0;
    wGrid.activeStructuralCount = shards.length;
    wGrid.baseStructuralCount = shards.length;

    wGrid.pivot.x = relX;
    wGrid.pivot.y = relY;

    wGrid.cacheCanvas.width = wGrid.srcWidth;
    wGrid.cacheCanvas.height = wGrid.srcHeight;
    wGrid.cacheCtx.drawImage(parent.hexGrid.cacheCanvas, 0, 0);

    const gridLen = cols * rows;
    if (wGrid.grid.length < gridLen) wGrid.grid = new Array(gridLen);
    else wGrid.grid.fill(undefined);

    for (const key in wGrid.map) delete wGrid.map[key];

    for (let i = 0; i < shards.length; i++) {
      const hs = shards[i];
      hs.__meshIndex = i;
      wGrid.map[hs.c + ',' + hs.r] = hs;
      if (hs.c >= 0 && hs.c < cols && hs.r >= 0 && hs.r < rows) {
        wGrid.grid[hs.c + hs.r * cols] = hs;
      }
    }

    rebuildNeighbors(wGrid);
    if ((DESTRUCTOR_CONFIG.packedHexArena | 0) === 1) rebuildHexGridArena(wreck, shards);

    // Łup wędruje z rodzica na fragment: materiały proporcjonalnie do liczby
    // komórek, broń za tym kawałkiem kadłuba, do którego była przykręcona.
    // wGrid.map jest już kluczowane 'c,r', więc służy jako test przynależności.
    transferSalvageToWreck(
      parent,
      wreck,
      (cellKey) => wGrid.map[cellKey] !== undefined,
      shards.length
    );

    // Rekord cargo wybiera dokładnie jeden fizyczny wrak jako nowego
    // właściciela partii. Kolejne fragmenty kadłuba nie mogą skopiować ładunku.
    if (parent.dead && parent._cargoOrderId && !parent._cargoWreck) {
      wreck._cargoOrderId = parent._cargoOrderId;
      wreck._cargoWreckId = `cargo-wreck:${parent._cargoOrderId}`;
      parent._cargoWreck = wreck;
    }

    if (Array.isArray(entities) && !entities.includes(wreck)) entities.push(wreck);

    if (typeof window !== 'undefined' && Array.isArray(window.wrecks) && !window.wrecks.includes(wreck)) {
      window.wrecks.push(wreck);
    }
    return wreck;
  }
};

// Szablon ciała heksowego per obraz. Próbkowanie maski (getImageData całego
// sprite'a + profil KAŻDEJ komórki) i pierwsze wypełnienie kanwy cache (clip +
// drawImage na KAŻDY heks) zależą tylko od obrazka i parametrów siatki, a flota
// tych samych kadłubów liczyła to od zera dla każdego statku — przy wejściu
// floty w kadr kilkanaście razy w jednej klatce. Obraz pancerza (src) jest
// tylko czytany, więc też jest wspólny, a z nim pula odłamków GPU kluczowana
// tym obrazem (dotąd osobna pula na każdy uszkodzony statek, nigdy nie
// zwalniana). Klucz = obiekt obrazka: źródła kadłubów, asteroid i pasm
// pierścienia są tworzone raz i nie są przerysowywane.
const _hexBodyTemplates = new WeakMap();

function getHexBodyTemplate(image, w, h, r, hexHeight, alphaThreshold, alphaSampleThreshold) {
  const key = w + 'x' + h + '|' + r + '|' + alphaThreshold;
  let byKey = _hexBodyTemplates.get(image);
  const cached = byKey ? byKey.get(key) : null;
  if (cached) return cached;

  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const srcCtx = src.getContext('2d', { willReadFrequently: true });
  let data;

  try {
    srcCtx.drawImage(image, 0, 0, w, h);
    data = srcCtx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  const cols = Math.ceil(w / (r * 1.5));
  const rows = Math.ceil(h / hexHeight);
  const cx = w * 0.5;
  const cy = h * 0.5;
  const cells = [];
  let rawRadiusSq = 0;

  for (let c = 0; c < cols; c++) {
    for (let ro = 0; ro < rows; ro++) {
      const x = c * r * 1.5;
      let y = ro * hexHeight;
      if (c % 2 !== 0) y += hexHeight * 0.5;

      const px = Math.floor(x);
      const py = Math.floor(y);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;

      const maskProfile = sampleHexMaskProfile(data, w, h, x, y, r, alphaThreshold, alphaSampleThreshold);
      if (!maskProfile.keep) continue;

      cells.push({
        c,
        ro,
        x,
        y,
        coverage: maskProfile.coverage,
        radialCoverage: maskProfile.radialCoverage,
        edgeMask: maskProfile.edgeMask
      });
      const lx = x - cx;
      const ly = y - cy;
      const d2 = lx * lx + ly * ly;
      if (d2 > rawRadiusSq) rawRadiusSq = d2;
    }
  }

  const template = { w, h, cols, rows, cells, rawRadiusSq, src, pristineCache: null, uses: 0 };
  if (!byKey) {
    byKey = new Map();
    _hexBodyTemplates.set(image, byKey);
  }
  byKey.set(key, template);
  return template;
}

// Świeży kadłub = zawsze ten sam obraz w cache. Pierwsze użycie szablonu rysuje
// heksy wprost (jednorazowe obrazki nie płacą za dodatkową kanwę), drugie
// zapisuje wzorzec, kolejne kopiują go jednym drawImage. Wzorzec jest
// programowy (willReadFrequently) jak kanwy encji — kopia bez odczytu z GPU.
function fillPristineHexCache(template, shards, cacheCtx) {
  template.uses++;
  if (template.pristineCache) {
    cacheCtx.drawImage(template.pristineCache, 0, 0);
    return;
  }
  if (template.uses < 2) {
    for (const s of shards) s.drawShape(cacheCtx);
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = template.w;
  canvas.height = template.h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (const s of shards) s.drawShape(ctx);
  template.pristineCache = canvas;
  cacheCtx.drawImage(canvas, 0, 0);
}

// Profil komórki szablonu: pokrycie maską wyznacza HP, masę i promień trafienia
// heksa. initHexBody i odtworzenie zimnego wraku liczą to tym samym kodem, więc
// odtworzony heks jest fizycznie tym samym heksem.
function applyTemplateCellProfile(shard, cell) {
  const coverage = Math.max(0.18, Math.min(1, Number(cell.coverage) || 1));
  const radialCoverage = Math.max(0.22, Math.min(1, Number(cell.radialCoverage) || coverage));
  const physicalScale = Math.max(0.30, Math.min(1, coverage * 0.82 + radialCoverage * 0.18));

  shard.coverage = coverage;
  shard.edgeMask = cell.edgeMask;
  shard.maxHp = DESTRUCTOR_CONFIG.shardHP * physicalScale;
  shard.hp = shard.maxHp;
  shard.mass = DESTRUCTOR_CONFIG.shardMass * physicalScale;
  shard.hitRadius = HIT_RAD * Math.max(0.42, Math.min(1, radialCoverage * 1.04));
}

// Indeks komórki szablonu po `c + ro * cols` (-1 = komórka poza maską).
// Liczony raz na szablon, przy pierwszym zrzucie albo odtworzeniu.
function getTemplateCellIndex(template) {
  let index = template.cellIndex;
  if (index) return index;
  index = new Int32Array(template.cols * template.rows).fill(-1);
  const cells = template.cells;
  for (let i = 0; i < cells.length; i++) index[cells[i].c + cells[i].ro * template.cols] = i;
  template.cellIndex = index;
  return index;
}

function createWreckGridShell() {
  const canvas = document.createElement('canvas');
  return {
    map: {},
    grid: [],
    cacheCanvas: canvas,
    cacheCtx: canvas.getContext('2d', { willReadFrequently: true }),
    pivot: { x: 0, y: 0 },
    _pendingEraseQueue: [],
    meshDirtyAll: false,
    meshDirtyStart: -1,
    meshDirtyEnd: -1
  };
}

export function initHexBody(entity, image, isProjectile = false, massOverride = null, alphaCutoff = 40) {
  if (!entity || !image?.width || !isHexEligible(entity)) return;

  const w = Math.ceil(image.width / 2) * 2;
  const h = Math.ceil(image.height / 2) * 2;
  const r = DESTRUCTOR_CONFIG.gridDivisions;
  const hexHeight = Math.sqrt(3) * r;

  const alphaThreshold = Math.max(0, Math.min(255, Number(alphaCutoff) || 40));
  const alphaSampleThreshold = Math.max(8, Math.min(255, alphaThreshold * 0.75));

  const template = getHexBodyTemplate(image, w, h, r, hexHeight, alphaThreshold, alphaSampleThreshold);
  if (!template) return;
  const src = template.src;

  const shards = [];
  const map = {};
  const cols = template.cols;
  const rows = template.rows;
  const grid = new Array(cols * rows);
  const cx = w * 0.5;
  const cy = h * 0.5;
  const cells = template.cells;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const x = cell.x;
    const y = cell.y;
    const c = cell.c;
    const ro = cell.ro;

    const shard = new HexShard(isProjectile ? null : src, x, y, r, c, ro, isProjectile ? '#ffcc00' : null);
    applyTemplateCellProfile(shard, cell);
    shard.__meshIndex = shards.length;
    shard.lx = x - cx;
    shard.ly = y - cy;
    shard.origLx = shard.lx;
    shard.origLy = shard.ly;

    shards.push(shard);
    map[c + ',' + ro] = shard;
    grid[c + ro * cols] = shard;
  }

  if (!shards.length) return;
  const rawRadiusSq = template.rawRadiusSq;

  const cacheCanvas = document.createElement('canvas');
  cacheCanvas.width = w;
  cacheCanvas.height = h;
  const cacheCtx = cacheCanvas.getContext('2d', { willReadFrequently: true });

  if (isProjectile) cacheCtx.drawImage(image, 0, 0, w, h);
  else fillPristineHexCache(template, shards, cacheCtx);

  entity.hexGrid = {
    shards,
    map,
    grid,
    cols,
    rows,
    srcWidth: w,
    srcHeight: h,
    armorImage: src,
    rawRadius: Math.sqrt(rawRadiusSq) + r,
    cacheCanvas,
    cacheCtx,
    _pendingEraseQueue: [],
    cacheDirty: false,
    textureDirty: false,
    meshDirty: false,
    meshDirtyAll: false,
    meshDirtyStart: -1,
    meshDirtyEnd: -1,
    meshRevision: 0,
    visualDirtyAll: false,
    visualDirtyStart: -1,
    visualDirtyEnd: -1,
    gpuTextureNeedsUpdate: false,
    isFragment: false,
    disableSolidArmorLod: false,
    isSleeping: false,
    sleepFrames: 0,
    wakeHoldFrames: DESTRUCTOR_CONFIG.elasticWakeFrames | 0,
    activeStructuralCount: shards.length,
    baseStructuralCount: shards.length,
    // Najwiekszy dryf heksa poza nominalny obrys — zrodlo padu OBB.
    // Swiezy kadlub ma 0, wiec pudlo startuje ciasno.
    _maxHexDrift: 0,
    pivot: null,
    // Klucz szablonu (getHexBodyTemplate) — z niego zimny wrak odtwarza siatkę
    // (captureHexBodySnapshot / initHexBodyFromSnapshot). Fragmenty go dziedziczą.
    hexTemplate: isProjectile ? null : template,
    templateImage: isProjectile ? null : image,
    templateAlpha: alphaThreshold
  };

  rebuildNeighbors(entity.hexGrid);
  if ((DESTRUCTOR_CONFIG.packedHexArena | 0) === 1) attachHexGridToArena(entity, shards);

  entity.radius = entity.hexGrid.rawRadius * Math.max(getFinalScaleX(entity), getFinalScaleY(entity));
  entity.isProjectile = !!isProjectile;

  if (Number.isFinite(massOverride)) entity.mass = massOverride;
  else if (!Number.isFinite(entity.mass) || entity.mass <= 0) {
    entity.mass = Math.max(10, sumShardMass(shards));
  }
}

// === ZIMNY WRAK: ZRZUT I ODTWORZENIE SIATKI ===
// Zimny wrak (src/game/coldWrecks.js) nie ma hexGrid — heksy wracają do areny,
// a stan siatki żyje w zwartym zrzucie po komórkach szablonu. Zrzut robimy PRZED
// zwolnieniem areny i KOPIUJEMY liczby do własnych tablic: slot areny dostanie po
// zwolnieniu inny heks. Deformacja sprężysta (deformation/targetDeformation) nie
// przeżywa zamrożenia — zamarza tylko wrak uśpiony od dawna, więc i tak wygasła.
// Zostaje trwały kształt (_bakedOffX/Y, a z nim gridX/gridY), HP i maska żywych.
//
// null = siatka nie leży na komórkach szablonu (np. awaryjny wrak z
// createWreckage bez destruktora albo kula-pocisk) — takiego wraku nie zamrażamy.
export function captureHexBodySnapshot(entity) {
  const grid = entity?.hexGrid;
  const template = grid?.hexTemplate;
  const shards = grid?.shards;
  if (!template || !Array.isArray(shards) || shards.length === 0) return null;
  const cols = template.cols;
  const rows = template.rows;
  if ((grid.cols | 0) !== cols || (grid.rows | 0) !== rows) return null;
  if ((Number(grid.srcWidth) || 0) !== template.w || (Number(grid.srcHeight) || 0) !== template.h) return null;

  let live = 0;
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    if (s && s.active && !s.isDebris) live++;
  }
  if (live === 0) return null;

  const cellIndex = getTemplateCellIndex(template);
  const cells = new Uint32Array(live);
  const hp = new Float32Array(live);
  const maxHp = new Float32Array(live);
  const bakedX = new Float32Array(live);
  const bakedY = new Float32Array(live);

  // Zasięg AKTYWNYCH heksów w układzie mesha — ten sam wzór co
  // getGridActiveExtent w hexShips3D.js, więc smuga zimnego wraku pokrywa się
  // ze smugą, którą rysował jeszcze jako gorący.
  const pivotX = Number(grid.pivot?.x) || 0;
  const pivotY = Number(grid.pivot?.y) || 0;
  const offX = template.w * 0.5 + pivotX;
  const offY = template.h * 0.5 + pivotY;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let k = 0;
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    if (!s || !s.active || s.isDebris) continue;
    const c = s.c | 0;
    const r = s.r | 0;
    if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
    const key = c + r * cols;
    if (cellIndex[key] < 0) return null;
    cells[k] = key;
    hp[k] = Number(s.hp) || 0;
    maxHp[k] = Number(s.maxHp) || 0;
    bakedX[k] = Number(s._bakedOffX) || 0;
    bakedY[k] = Number(s._bakedOffY) || 0;
    const x = (Number(s.gridX) || 0) - offX;
    const y = (Number(s.gridY) || 0) - offY;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    k++;
  }
  const pad = Math.max(2, Number(shards[0]?.radius) || 20);
  const storedActive = Number(grid.activeStructuralCount);

  return {
    version: 1,
    // Klucz szablonu = to, czym kluczuje getHexBodyTemplate. `template` i obrazy
    // to referencje, nie dane do JSON.
    // AGENT: zrzut zimnego wraku do zapisu świata — obrazy przez id typu kadłuba,
    // typed arrays jako tablice/base64; `template` odtwarza getHexBodyTemplate.
    template,
    templateImage: grid.templateImage || null,
    templateAlpha: grid.templateAlpha,
    srcWidth: template.w,
    srcHeight: template.h,
    hexRadius: Number(shards[0]?.radius) || DESTRUCTOR_CONFIG.gridDivisions,
    cols,
    rows,
    armorImage: grid.armorImage || null,
    visualImage: grid.visualImage || null,
    normalMapImage: grid.normalMapImage || null,
    pivot: grid.pivot ? { x: pivotX, y: pivotY } : null,
    isFragment: grid.isFragment === true,
    disableSolidArmorLod: grid.disableSolidArmorLod === true,
    activeStructuralCount: Number.isFinite(storedActive) ? storedActive : live,
    baseStructuralCount: Number(grid.baseStructuralCount) || live,
    maxHexDrift: Number(grid._maxHexDrift) || 0,
    rawRadius: Number.isFinite(Number(grid.rawRadius)) ? Number(grid.rawRadius) : null,
    x: getEntityPosX(entity),
    y: getEntityPosY(entity),
    angle: getEntityAngle(entity),
    radius: Number(entity.radius) || 0,
    scaleX: getFinalScaleX(entity),
    scaleY: getFinalScaleY(entity),
    // Żywe heksy w kolejności siatki: klucz komórki (c + r·cols), HP, trwałe wgniecenie.
    cells,
    hp,
    maxHp,
    bakedX,
    bakedY,
    // Smuga (px sprite'a względem pivota), kolor dopisuje renderer przy zamrażaniu.
    extent: {
      halfW: (maxX - minX) * 0.5 + pad,
      halfH: (maxY - minY) * 0.5 + pad,
      cx: (minX + maxX) * 0.5,
      cy: (minY + maxY) * 0.5
    },
    color: null
  };
}

// Odtwarza hexGrid ze zrzutu: te same komórki szablonu, te same HexShard i ten
// sam profil komórki co initHexBody, to samo wpięcie w arenę; sąsiedzi jak w
// initHexBody. `image` = obraz szablonu, potrzebny tylko gdy zrzut nie niesie
// referencji do szablonu (np. po wczytaniu z zapisu). Fragment zachowuje
// srcWidth/srcHeight rodzica (to wymiary szablonu) — próbkuje jego teksturę.
export function initHexBodyFromSnapshot(entity, image, snapshot) {
  if (!entity || !snapshot?.cells) return false;
  const r = Number(snapshot.hexRadius) || DESTRUCTOR_CONFIG.gridDivisions;
  let template = snapshot.template || null;
  if (!template) {
    const source = image || snapshot.templateImage;
    if (!source) return false;
    const alphaThreshold = Math.max(0, Math.min(255, Number(snapshot.templateAlpha) || 40));
    const alphaSampleThreshold = Math.max(8, Math.min(255, alphaThreshold * 0.75));
    template = getHexBodyTemplate(source, snapshot.srcWidth, snapshot.srcHeight, r, Math.sqrt(3) * r, alphaThreshold, alphaSampleThreshold);
  }
  if (!template || template.cols !== snapshot.cols || template.rows !== snapshot.rows) return false;

  const cellIndex = getTemplateCellIndex(template);
  const src = template.src;
  const cols = template.cols;
  const rows = template.rows;
  const w = template.w;
  const h = template.h;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const shards = [];
  const map = {};
  const gridCells = new Array(cols * rows);

  for (let i = 0; i < snapshot.cells.length; i++) {
    const key = snapshot.cells[i];
    const ci = key < cellIndex.length ? cellIndex[key] : -1;
    if (ci < 0) continue;
    const cell = template.cells[ci];
    const shard = new HexShard(src, cell.x, cell.y, r, cell.c, cell.ro, null);
    applyTemplateCellProfile(shard, cell);
    shard.maxHp = snapshot.maxHp[i];
    shard.hp = snapshot.hp[i];
    const bx = snapshot.bakedX[i];
    const by = snapshot.bakedY[i];
    // Niezmiennik obu ścieżek wypalania (CPU i GPU): gridX = origGridX + _bakedOffX.
    shard.gridX = cell.x + bx;
    shard.gridY = cell.y + by;
    shard._bakedOffX = bx;
    shard._bakedOffY = by;
    shard.lx = cell.x - cx;
    shard.ly = cell.y - cy;
    shard.origLx = shard.lx;
    shard.origLy = shard.ly;
    shard.__meshIndex = shards.length;
    shards.push(shard);
    map[cell.c + ',' + cell.ro] = shard;
    gridCells[key] = shard;
  }
  if (!shards.length) return false;

  const cacheCanvas = document.createElement('canvas');
  cacheCanvas.width = w;
  cacheCanvas.height = h;
  const cacheCtx = cacheCanvas.getContext('2d', { willReadFrequently: true });
  const storedActive = Number(snapshot.activeStructuralCount);

  const grid = {
    shards,
    map,
    grid: gridCells,
    cols,
    rows,
    srcWidth: w,
    srcHeight: h,
    armorImage: snapshot.armorImage || src,
    visualImage: snapshot.visualImage || null,
    cacheCanvas,
    cacheCtx,
    _pendingEraseQueue: [],
    // 2D rysuje kanwę cache od zera z heksów; 3D bierze teksturę z visualImage/armorImage.
    cacheDirty: !HEX_SHIPS_3D_ACTIVE,
    textureDirty: !HEX_SHIPS_3D_ACTIVE,
    meshDirty: false,
    meshDirtyAll: false,
    meshDirtyStart: -1,
    meshDirtyEnd: -1,
    meshRevision: 0,
    visualDirtyAll: false,
    visualDirtyStart: -1,
    visualDirtyEnd: -1,
    gpuTextureNeedsUpdate: false,
    isFragment: snapshot.isFragment === true,
    disableSolidArmorLod: snapshot.disableSolidArmorLod === true,
    isSleeping: false,
    sleepFrames: 0,
    wakeHoldFrames: DESTRUCTOR_CONFIG.elasticWakeFrames | 0,
    activeStructuralCount: Number.isFinite(storedActive)
      ? Math.max(0, Math.min(shards.length, storedActive))
      : shards.length,
    baseStructuralCount: Math.max(shards.length, Number(snapshot.baseStructuralCount) || 0),
    _maxHexDrift: Number(snapshot.maxHexDrift) || 0,
    _fractureImpact: null,
    pivot: snapshot.pivot ? { x: snapshot.pivot.x, y: snapshot.pivot.y } : null,
    hexTemplate: template,
    templateImage: snapshot.templateImage || image || null,
    templateAlpha: snapshot.templateAlpha
  };
  if (snapshot.normalMapImage) grid.normalMapImage = snapshot.normalMapImage;
  if (Number.isFinite(snapshot.rawRadius)) grid.rawRadius = snapshot.rawRadius;

  entity.hexGrid = grid;
  markGridMeshDirtyAll(grid);
  rebuildNeighbors(grid);
  if ((DESTRUCTOR_CONFIG.packedHexArena | 0) === 1) attachHexGridToArena(entity, shards);
  entity._destrObbTick = -1;
  return true;
}

export function getHexStructuralState(entity) {
  const grid = entity?.hexGrid;
  if (!grid || !Array.isArray(grid.shards)) return null;

  let active = Number(grid.activeStructuralCount);
  if (!Number.isFinite(active)) {
    active = 0;
    for (let i = 0; i < grid.shards.length; i++) {
      const shard = grid.shards[i];
      if (shard?.active && !shard?.isDebris && shard.hp > 0) active++;
    }
    grid.activeStructuralCount = active;
  }

  active = Math.max(0, active);
  let total = Number(grid.baseStructuralCount);

  if (!Number.isFinite(total) || total <= 0) {
    total = grid.shards.length;
    grid.baseStructuralCount = total;
  }

  total = Math.max(0, total);
  const ratio = total > 0 ? Math.max(0, Math.min(1, active / total)) : 0;
  return { active, total, ratio };
}

export function getHexArenaStats() {
  return getPackedHexArenaStats();
}

export function disposeHexBody(entity) {
  return releaseHexGridArena(entity);
}

export { isPackedShardBoundary };

// Żar heksa czyta renderer (hexShips3D) i wszystko, co chce wiedzieć, jak
// gorąca jest blacha w tej chwili.
export { shardHeatNow, addShardHeat };

if (typeof window !== 'undefined') {
  // Do debugowania z konsoli, jak window.DestructorSystem — nie ścieżka produkcyjna.
  window.CollisionFX = CollisionFX;
  window.ColFuncDbgStart = (intervalMs = 1000) => DestructorSystem.setCollisionLiveDebug(true, intervalMs);
  window.ColFuncDbgStop = () => DestructorSystem.setCollisionLiveDebug(false);
  window.ColFuncDbgDump = () => DestructorSystem._dbgCollisionFlush(nowMs(), true);
}
