// src/3d/explosions/explosionFx.js
//
// WYBUCHY WebGPU gry — reżyser jako KROK klatki efektów Core3D (`Core3D.addFxStep`). Zastępuje dawny wybuch
// reaktora src/effects3d/reactorblow.js (port overlaya WebGL: płaskie cząstki, kolce i błysk wybielający kadr —
// użytkownik 2026-10-07: „tragiczne, do usunięcia”). Wejście jak dawniej: `window.makeReactorBlow({ x, y, size,
// profile })` (świat gry) — próg punktów i łańcuch rozpadu suchego doku (misja 1), rozpad stacji (Destruction3D,
// `reactorFactory`), śmierć gracza bez rdzenia (`triggerReactorBlow3D`), skrypty; śmierć okrętu bez detonacji rdzenia —
// z miejsca ZBIORNIKA PALIWA ze strumieniami wzdłuż osi kadłuba (src/game/fuelTank.js, opcje spawn: axisX / axisY,
// jetVelTau) i gaz detonacji rdzenia w barwie frakcji (gasOnly, tint).
//
// Obraz (receptury: explosionRecipes.js):
//   • KULA OGNIA I DYM Z GAZU (src/3d/gas/ — siatka 3D w compute jak Niagara Fluids): rdzeń paliwa i kłęby wokół
//     niego (nieregularna kula), płonące odłamki ciągnące smugi ognia i dymu („pająk”), dogasające ogniska; gaz
//     spala się, rozpręża, kłębi wirami i stygnie w dym, który się rozchodzi i znika. Domeny PŁASKIE (gra z góry),
//     bryły domen w passie ortho (warstwa 0): część za płaszczyzną gry przed kadłubami, przed nią — po nich.
//   • ŻAR porywany polem prędkości gazu (gasEmbers.js) i łby płonących odłamków; BŁYSK (rdzeń + poświata, kwady
//     zwrócone do kamery);
//   • pule gry: ISKRY (SparkSystem3D — te same co trafień i rakiet), rozżarzone ODŁAMKI konstrukcji (WeaponFx
//     DEBRIS — oświetlane siatką świateł), smugi DYMU płonących odłamków poza domeną gazu (dym rakiet — compute
//     z samocieniem); wersja bez gazu (LOD): kula ognia rakiet, ogień ADD broni i kłęby sadzy;
//   • Core3D: ŚWIATŁA w siatce (błysk, ogień, żar — oświetlają kadłuby obok), FALA uderzeniowa jako SAMA
//     refrakcja (bez świecącego okręgu — decyzja użytkownika) i GORĄCE POWIETRZE nad kulą (fxDistortion);
//   • wybuchy WTÓRNE (mniejsze, z opóźnieniem, w tej samej domenie gazu).
//
// LOD: gaz tylko w kadrze; nowa domena od GAS_MIN_PX promienia kuli na ekranie (domen jest `EXPLOSION_GRID.slots`;
// brak wolnej — wersja z cząstek, żywej domeny się nie zabiera). Wybuch, którego kula mieści się w żywej domenie
// (łańcuch doku), i wtórne w domenie rodzica dokładają się do niej bez progu ekranu. Poza kadrem — samo światło. Zegar: SimClock.sim (pauza = wybuch stoi; demo podaje własny zegar).
// Pozycje: świat gry (double) → scena (x, −y) względem `Core3D.fx.origin`; losowanie wizualne tylko fxRandom.
// Rozgrzewka: puste dispatche kerneli gazu i żaru + pipeline'y siatek w passie ortho (kamera z góry i kamery 3D).

import { GasGrid } from '../gas/gasGrid.js';
import { GasGridSet } from '../gas/gasGridSet.js';
import { GAS_HULL_REC, GAS_OBST_IN } from '../gas/gasObstacleLayout.js';
import { GasVolume, GAS_LIGHT_OWNER_BASE } from '../gas/gasVolume.js';
import { GasExplosions } from '../gas/gasExplosions.js';
import { GasEmbers, GasFlashes, EMBER_CAP } from '../gas/gasEmbers.js';
import { createShiftKernel } from '../fx/gpuPoolOrigin.js';
import { gasBlackbodyCpu } from '../gas/gasCommon.js';
import { fxNoise } from '../fx/noise.js';
import { fxRandom } from '../fx/fxRandom.js';
import { sunVisibility, sunFill } from '../sunShadowMask.js';
import { K } from '../weapons/gpuFx.js';
import { SparkSystem3D } from '../sparkSystem3D.js';
import { SMOKE_KIND } from '../rockets/palette.js';
import { GlowSprites } from '../rockets/glow.js';
import {
  SPARK_HOT, SPARK_GOLD, SPARK_WARM, CHUNK_HOT, CHUNK_STEEL, FIRE_COOL, FIRE_DIM
} from '../reactorBlast/palette.js';
import { SimClock, CLOCK_SIM } from '../../game/simClock.js';
import { EngineFrame } from '../engineFrame.js';
import { MAIN_EXHAUST_PALETTES } from '../../data/engineFx.js';
import { ENGINE_IGNITION, ENGINE_SHUTDOWN, ENGINE_IGNITION_TUNE } from '../../game/engineIgnition.js';
import { ActiveCarrier, writeCarrierVelocity } from '../../game/carrierVelocity.js';
import {
  explosionProfile, countScale, fireRadius, explosionLod, explosionInView, rollRange,
  GAS_MIN_PX, LOD_GAS, LOD_PARTICLES, LOD_OFF
} from './explosionRecipes.js';

const TAU = Math.PI * 2;

/**
 * Siatki gazu wybuchów (etap D 2026-10-09): płaskie domeny (gra z góry) w TRZECH atlasach o różnej rozdzielczości —
 * jedna siatka dla reżysera (GasGridSet: indeksy domen globalne, podstawowa 0…, „fine” dalej, „coarse” na końcu):
 *   • PODSTAWOWY `slots` × 96² × 36 (17,8 komórki na promień kuli) — wybuchy 40–60 px promienia na ekranie, wystrzały z lufy
 *     i zapłony silników (strojone na tej komórce),
 *   • „FINE” `fineSlots` × 128² × 48 (23,7 komórki na R, F5b) — kula ≥ `EXPLOSION_TUNE.fineMinPx` (60 px), mniejsze tylko jako
 *     ostatni zapas; więcej iteracji Jacobiego (`fineJacobi` — przy 15 rzut nie domykał drobniejszej siatki: masa dymu +50%,
 *     przy 41: +14%). Koszt w bitwie (12 zgonów naraz, zoom 0,16 — pancerniki ≥ 60 px): klatka +~0,6 ms, CPU kroku +0,11 ms
 *     (A/B `fineGas`); przełącznik `EXPLOSION_TUNE.fineGas`, próg `fineMinPx` (decyzja użytkownika: 60 px),
 *   • „COARSE” `coarseSlots` × 64² × 24 (11,9 komórki na R) — kula < `coarseMaxPx` (40 px: komórka ≤ 3,4 px) — łańcuch doku
 *     i bitwa z daleka dostają gaz zamiast cząstek (łańcuch doku: 10 domen — 11 wybuchów bez domeny, 18 domen — 5).
 * Brak wolnej domeny w atlasie wybuchu — inny atlas (`_slotFor`). Parametry gazu w jednostkach komórek
 * skalowane GasSlot.k (gasGrid.js) — rozdzielczość nie zmienia strojenia. Pamięć: 10 atlasów RGBA16F na domenę (12 ról, dwie
 * pary dzielą teksturę) — podstawowa 26,5 MB, „fine” 62,9 MB, „coarse” 7,9 MB; razem 4 + 2 + 12 domen = 326 MB. Alokacja
 * LENIWA (F17): każdy atlas przy swojej pierwszej domenie, „fine” zwalniany po `fineRelease` s bez domen „fine” (przez
 * większość gry 201 MB). Decyzje użytkownika 2026-10-08: łańcuch doku = kilka ostrych kul, pamięć 175 MB + ~140 MB.
 */
export const EXPLOSION_GRID = Object.freeze({ N: 96, NZ: 36, slots: 4, jacobi: 15, maxSources: 224, maxHulls: 64, hullBands: 32,
  lazy: true,
  fineN: 128, fineNZ: 48, fineSlots: 2, fineMaxSources: 160, fineRelease: 20, fineJacobi: 41,
  coarseN: 64, coarseNZ: 24, coarseSlots: 12, coarseMaxSources: 192 });

/** Indeksy siatek w zestawie (GasGridSet.grids / GasSlot.tier). */
export const GAS_TIER_MAIN = 0;
export const GAS_TIER_FINE = 1;
export const GAS_TIER_COARSE = 2;

/** Komórki na promień kuli ognia przy strojeniu fizyki i obrazu gazu (etapy A–E2: bok domeny 96 komórek = 5,4 R). */
export const GAS_CELLS_PER_R_REF = 96 / 5.4;

/** Najmniejszy promień kuli ognia [komórki domeny], przy którym wybuch dokłada się do cudzej domeny, gdy jest wolna. */
export const MERGE_MIN_CELLS = 8;

/** Obraz domeny w wygaszaniu [0..1], poniżej którego nowy wybuch może ją przejąć, gdy nie ma wolnej. */
export const FADE_RECLAIM = 0.2;

/**
 * Scalanie i dziedziczenie: kula ognia musi leżeć w kole FIT_RR · pół boku domeny (gasReact wygasza skalary od
 * 0,74 promienia elipsoidy, z szumem brzegu ±0,11; gąbka od 0,7) i mieć ≥ MERGE_MIN_R_CELLS komórek promienia.
 */
export const FIT_RR = 0.68;
export const MERGE_MIN_R_CELLS = 3;
/** Bez wolnej domeny: kula musi mieścić się w kole życia gazu żywej domeny tą częścią promienia (etap D — mniej cząstek). */
export const RELAX_FIT_R = 0.5;

/**
 * GAZ WYSTRZAŁU Z LUFY (etap E1 2026-10-09, prośba użytkownika: „wystrzał z lufy — armaty i yamato (yamato niebieski
 * ogień)”): krótki jęzor ognia i kłąb dymu z wylotu wzdłuż lufy w domenie gazu WYSTRZAŁU (GasSlot.tag = MUZZLE_TAG).
 * Domena na OKRĘT strzelający (kolejne wystrzały jego wież — emitery w tej samej domenie, gdy wylot mieści się w kole
 * życia gazu i nośnik się zgadza), mała (komórka z promienia wylotu, nie kuli wybuchu), jedzie z nośnikiem strzelca
 * i żyje krótko po ostatnim strzale. Sufit `muzzleDomains`, zapas wolnych domen dla wybuchów `muzzleReserve`; WYBUCHY MAJĄ
 * PIERWSZEŃSTWO: wystrzał bierze tylko wolną domenę, wybuch jej nie scala, ale może ją przejąć (`_slotFor`). Bez domeny —
 * wylot z cząstek WeaponFx jak dawniej.
 */
export const MUZZLE_TAG = 7;

/**
 * DYM ZAPŁONU SILNIKA (etap E2 2026-10-09, prośba użytkownika: „dym z silnika przy odpalaniu — coś jak rakieta: najpierw
 * idzie dym, potem się zapala; będzie fajny efekt w doku”): domena gazu ZAPŁONU (GasSlot.tag = ENGINE_TAG) na okręt,
 * którego silniki MAIN przechodzą zapłon albo gaszenie (src/game/engineIgnition.js — stan na encji, gra 2D): zimny,
 * jasnoszary dym z każdej dyszy wzdłuż jej osi (EngineFrame — dysze klatki), potem krótki płomień w barwie palety strugi
 * (paleta ognia domeny) i błysk, przy gaszeniu resztkowy dym. Dym zostaje w ŚWIECIE (nośnik = prędkość okrętu z chwili
 * zapłonu — okręt wyjeżdża z obłoku), rozchodzi się i znika. Domeny EFEKTÓW (wystrzały, zapłony) ustępują wybuchom.
 */
export const ENGINE_TAG = 8;

/** Domena EFEKTU (nie wybuchu): wystrzał z lufy albo zapłon silnika — wybuchy mają pierwszeństwo (przejmują ją). */
export function isEffectTag(tag) {
  return tag === MUZZLE_TAG || tag === ENGINE_TAG;
}

/**
 * Paleta ognia domeny zapłonu (gasCommon GAS_FIRE_ROWS: 0 ciało czarne, 1 plazma, 2 wodór) z palety strugi MAIN okrętu
 * (MAIN_EXHAUST_PALETTES — Atlas „plazma”, Terra Nova „wodór”, piraci „rakieta”); palety spoza trzech wierszy — najbliższy.
 */
const ENGINE_FIRE_BY_PALETTE = Object.freeze({
  rakieta: 0, plazma: 1, ksenon: 1.5, bor: 0, antymateria: 0, wodor: 2,
  'ogien-lod': 1, zorza: 2, zachod: 0, mglawica: 1.5, neon: 1, tecza: 0
});
export const ENGINE_FIRE_ROW = Object.freeze(MAIN_EXHAUST_PALETTES.map((p) => ENGINE_FIRE_BY_PALETTE[p.id] ?? 0));

/**
 * Przepis gazu wylotu per rodzina receptury WeaponFx: R — promień kuli wylotu [j.] na jednostkę skali wylotu (S = skala
 * wieżyczki × skala receptury, × moc rozmiaru broni), fire — paleta ognia domeny (gasCommon: 0 ciało czarne, 1 plazma
 * Yamato), tint — barwa dymu domeny (null = sadza), fuel / smoke — mnożniki źródeł, brake — kąt jęzorów hamulca
 * wylotowego [rad] (0 = bez).
 */
export const MUZZLE_GAS = Object.freeze({
  // armata: jeden strzał (Yamato — 2–3 lufy w tej samej domenie), więcej paliwa i dymu; dym prochowy jaśniejszy niż sadza
  // wybuchu (na ciemnym kadłubie sadza ginęła — próba 2026-10-09)
  armata: Object.freeze({ R: 20, fire: 0, tint: Object.freeze([1.7, 1.6, 1.5]), fuel: 1.7, smoke: 2.6, brake: 1.3 }),
  yamato: Object.freeze({ R: 20, fire: 1, tint: Object.freeze([0.86, 0.94, 1.12]), fuel: 1.15, smoke: 0.7, brake: 0 })
});

/** Przełączniki i strojenie (konsola: window.__explosions.tune; harness A/B). */
export const EXPLOSION_TUNE = {
  enabled: true,
  gas: true,          // kula ognia i dym z gazu (wyłączone = wszystko z cząstek)
  drawGas: true,      // bryły gazu rysowane (false — symulacja bez obrazu: A/B kosztu marszu)
  embers: true,       // żar porywany przez gaz i łby odłamków
  sparks: true,       // iskry gry
  chunks: true,       // rozżarzone odłamki konstrukcji (WeaponFx DEBRIS)
  trails: true,       // smugi dymu płonących odłamków (dym rakiet)
  flash: true,
  lights: true,
  gridLight: true,    // światła siatki w dymie (F3; A/B tej samej klatki — bez przebudowy materiału)
  farGlow: true,      // daleki blask ognia w objętości światła (F10; false = glowFar 0 — A/B kosztu i obrazu)
  shock: true,        // fala uderzeniowa (sama refrakcja)
  haze: true,         // gorące powietrze
  secondaries: true,
  gasMinPx: GAS_MIN_PX,
  // Bok domeny gazu / promień kuli ognia. F5a (etap D 2026-10-09) — 4,2 ODRZUCONE pomiarem: dym dochodzi do ścian domeny
  // (sonda: dym w zewnętrznych 10% profilu 0,5–1,0 maksimum, też w pionie), obłok przycięty o ~15%. Rozdzielczość daje atlas
  // „fine” (17,8 → 23,7 komórki na promień). Parametry gazu w jednostkach komórek skalowane GasSlot.k = komórki na R /
  // GAS_CELLS_PER_R_REF — strojenie fizyki i obrazu z etapów A–E2 bez zmian przy każdej rozdzielczości.
  domainScale: 5.4,
  fineGas: true,      // atlas „fine” (F5b) dla kuli ognia dużej na ekranie
  fineMinPx: 60,      // promień kuli ognia [px], od którego wybuch woli domenę „fine”
  coarseGas: true,    // atlas „coarse” dla kuli ognia małej na ekranie
  coarseMaxPx: 40,    // promień kuli ognia [px], poniżej którego wybuch woli domenę „coarse”
  // F13 (etap D): BUDŻET MARSZU obrazu gazu — szacunek próbek klatki (Σ px pudła domeny w kadrze × komórki w pionie /
  // krok), powyżej budżetu [mln próbek] krok marszu rośnie proporcjonalnie (najwyżej × marchStepMax); 0 = stały krok.
  // Zmierzone 2026-10-09 (RTX 5080, 1600 × 900, zatrzymana klatka): domena „fine” na pół kadru ~82 mln próbek = 0,7–2,2 ms
  // marszu (~40–50 mln próbek / ms w gęstym dymie); krok × 2 — marsz ~½.
  marchBudget: 40,
  relaxFit: true,     // bez wolnej domeny — łagodniejsze scalanie (RELAX_FIT_R) zamiast cząstek; false = ścisłe (A/B)
  marchStepMax: 2.5,
  domainLife: 3.0,    // życie domeny po ostatnim wybuchu w niej [s] (potem wygaszanie 1,6 s — obłok znika do ~4,6 s)
  sparkGain: 1,
  lightGain: 1,
  shockGain: 1,
  hazeGain: 1,
  flashGain: 1,
  ambientSky: 1,      // otoczenie dymu × jasność strefy nieba (skyRegion)
  // PRZESZKODY (F2, etap C 2026-10-09; wejście src/game/gasObstacleInput.js): statyka — ściany i bryły hal K-7, kawałki
  // suchego doku (gaz opływa, wylewa się bramami); kadłuby — obrys z żywych węzłów belek z prędkością ciała (kadłub
  // rozcina dym). false = przeszkód nie ma (dawny gaz; zmiana działa od następnego kroku symulacji).
  obstacles: true,
  hullObstacles: true,
  // Wrak-GOSPODARZ (okręt, z którego zbiornika / rdzenia wybucha gaz) nie jest przeszkodą swojego gazu — zbiornik wybucha
  // WEWNĄTRZ kadłuba (A/B etapu C: false = kadłub gospodarza zjada źródła, kula ognia wypychana na brzeg kadłuba).
  hostExclude: true,
  // GAZ WYSTRZAŁU (MUZZLE_GAS, etap E1): domeny wystrzałów — sufit, zapas wolnych domen dla wybuchów, próg promienia wylotu
  // na ekranie [px], komórki na promień wylotu, życie po ostatnim strzale [s], wygaszanie [s], stały zanik dymu [1/s],
  // dym cząstkowy wylotu przy gazie (× gęstości dymu receptury — bez podwójnego dymu), udział prędkości okrętu w nośniku
  // domeny (1 = dym jedzie z okrętem — inercjalny układ strzelca), wysokość źródła nad płaszczyzną [× R] (wylot nad
  // pokładem — gaz w warstwie przed kadłubem), strzelec poza maską przeszkód swojej domeny, błysk wylotu z właścicielem.
  muzzleGas: true,
  muzzleDomains: 3,
  muzzleReserve: 2,
  muzzleMinPx: 6,
  muzzleCellsR: 10,
  muzzleLife: 0.45,
  muzzleFade: 0.6,
  muzzleDecay: 1.6,
  muzzleSmokeK: 0.15,
  muzzleCarrier: 1,
  muzzleLift: 0.5,
  muzzleHostExclude: true,
  muzzleLightOwn: true,
  // DYM ZAPŁONU SILNIKA (ENGINE_TAG, etap E2): domeny zapłonów — sufit (zapas wolnych domen dla wybuchów wspólny z wystrzałami:
  // muzzleReserve), próg promienia dyszy na ekranie [px], komórki domeny na promień źródła (≥ 3 — mniejsze giną w siatce),
  // długość obłoku dymu [× promień dyszy], życie domeny po ostatnim źródle [s], wygaszanie [s], stały zanik dymu [1/s],
  // udział prędkości okrętu z chwili zapłonu w nośniku domeny (0 = dym stoi w świecie), mnożniki dymu i płomienia,
  // barwa dymu (zimny, jasnoszary), wysokość źródeł [× promień źródła], okręt poza maską przeszkód swojej domeny,
  // błysk i światło zapłonu.
  engineGas: true,
  engineDomains: 2,
  engineMinPx: 3,
  engineCellsR: 3.5,
  engineLen: 13,
  engineLinger: 1.3,
  engineFade: 1.5,
  engineDecay: 0.45,
  engineCarrier: 1,
  engineSmoke: 1,
  engineFlame: 1,
  engineTint: [1.8, 1.9, 2.2],
  engineLift: 0.3,
  engineHostExclude: true,
  engineFlash: true,
  // Otoczenie domeny zapłonu we wnętrzu hali K-7 (poprawka E2): × poziom światła hali (`interiorLight` — HallDust,
  // 0 poza halą, 1 przy pełnych lampach). Pod dachem nie ma słońca, a lampy siatki w dymie gasi kolano i samocień
  // (sonda: ~0,55 po kolanie, ~0,2 w gęstym dymie, wobec ~1,8 słońca w pustce) — bez tego dym zapłonu w hali był
  // niewidoczny. Jednostka: światło przed albedo (jak słońce).
  engineHallAmbient: 1.1
};

const BLAST_CAP = 96;       // żywe rekordy wybuchów (światła, fala, gorące powietrze)
const ENGINE_TRACK = 24;    // okręty w sekwencji zapłonu / gaszenia śledzone naraz (obraz)
const ENGINE_LIGHT_CAP = 16; // światła zapłonu naraz
const DELAY_CAP = 64;       // wybuchy wtórne w kolejce
const FRAG_CAP = 160;       // płonące odłamki ze smugą dymu (CPU, dym rakiet)
const BLAST_LIFE = 4.0;     // rekord żyje [s]
const BF = 12;              // float na rekord: R, size, lod, slot, cx, cy, flash, light, shock, haze, seed, power
const FG = 11;              // float na odłamek: vx, vy, cx, cy, life, drag, acc, heat, size, skręt [rad/s], domena gazu (−1 = bez)

// Barwy świateł wybuchu (liniowo): błysk (biel lekko ciepła), ogień, żar.
const LIGHT_FLASH = [1.0, 0.86, 0.66];
const LIGHT_FIRE = [1.0, 0.56, 0.24];
const LIGHT_EMBER = [1.0, 0.42, 0.14];

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

export class ExplosionFx {
  /**
   * @param {object} core Core3D (po init: scena, fx, warmup)
   * @param {object} [o]
   * @param {object} [o.rocketFx] createRocketFx(Core3D) — dym rakiet (smugi odłamków, kłęby LOD), kule ognia LOD
   * @param {object} [o.weaponFx] WeaponFx — pule ADD (ogień) i DEBRIS (odłamki)
   * @param {() => number} [o.clock] zegar wybuchów [s] (domyślnie SimClock.sim — pauza gry = wybuch stoi)
   * @param {object} [o.grid] nadpisanie EXPLOSION_GRID (testy)
   */
  constructor(core, { rocketFx = null, weaponFx = null, clock = null, grid = null } = {}) {
    this.core = core;
    this.rocketFx = rocketFx;
    this.weaponFx = weaponFx;
    this.clock = typeof clock === 'function' ? clock : () => Number(SimClock.sim) || 0;
    this.tune = EXPLOSION_TUNE;
    const scene = core.scene;
    const noise3D = fxNoise.noise3D();
    // window.__EXPLOSION_GRID — nadpisanie siatek przed startem gry (harness: A/B konfiguracji domen, np. dawne 10 domen
    // bez atlasu „fine”); opcja `grid` (testy, dema) bierze górę.
    const cfg = { ...EXPLOSION_GRID, ...(globalThis.__EXPLOSION_GRID || {}), ...(grid || {}) };
    if (globalThis.__EXPLOSION_TUNE_OVR) Object.assign(EXPLOSION_TUNE, globalThis.__EXPLOSION_TUNE_OVR);
    // Atlas podstawowy + „fine” (F5b) — dla reżysera, emiterów i żaru jedna siatka (GasGridSet: indeksy domen globalne).
    const main = new GasGrid({ ...cfg, noise3D, rng: fxRandom, nRef: cfg.N });
    const tier = (n, nz, slots, jacobi, maxSources, opts) => (slots | 0) > 0 ? new GasGrid({ N: n, NZ: nz, slots, jacobi, maxSources,
      maxHulls: cfg.maxHulls, hullBands: cfg.hullBands, noise3D, rng: fxRandom, nRef: cfg.N, lazy: cfg.lazy, ...opts }) : null;
    // Kolejność atlasów stała (GAS_TIER_*) — atlas bez domen to siatka z 0 slotów nie istnieje: zastępca o 0 domen nie jest
    // potrzebny, bo GasGridSet liczy indeksy z tego, co jest (tier = pozycja w liście — niżej `_tierOf`).
    const fine = tier(cfg.fineN, cfg.fineNZ, cfg.fineSlots, cfg.fineJacobi || cfg.jacobi, cfg.fineMaxSources,
      { lazy: true, releaseAfter: cfg.fineRelease });
    const coarse = tier(cfg.coarseN, cfg.coarseNZ, cfg.coarseSlots, cfg.coarseJacobi || cfg.jacobi, cfg.coarseMaxSources, {});
    const grids = [main];
    this._tierIx = [0, -1, -1];   // GAS_TIER_* → indeks w zestawie (−1 — atlasu nie ma)
    if (fine) { this._tierIx[GAS_TIER_FINE] = grids.length; grids.push(fine); }
    if (coarse) { this._tierIx[GAS_TIER_COARSE] = grids.length; grids.push(coarse); }
    this.grid = new GasGridSet(grids);
    this.fine = fine;
    this.coarse = coarse;
    tuneGasForSpace(this.grid.tune);
    this._glowFar = this.grid.tune.glowFar;
    // Światła siatki Core3D.fx.grid w marszu dymu (F3): dysze, lufy, trafienia, reflektory, inne wybuchy. Układ lokalny
    // siatki = układ brył (oba względem Core3D.fx.origin — _update: grid.begin(origin) w klatce efektów).
    const curl3D = fxNoise.curl3D();
    const lightGrid = core.fx?.grid || null;
    this.volume = new GasVolume({ grid: main, noise3D, curl3D, lightGrid });
    tuneLookForGame(this.volume.look);
    // Część za płaszczyzną gry: pass ortho przed kadłubami (kadłub ją zasłania). Część przed płaszczyzną: pass FG
    // (warstwa 2) po bryłach FG — dach i maszty doku, górne ściany hal nie chowają kuli ognia i dymu nad nimi.
    // Otoczenie × wypełnienie maski słońca (cień planety, mrok gęstego pola pasa — jak otoczenie kadłubów).
    const meshOpts = { layer: 0, renderOrderBack: 1, renderOrderFront: 900, sunVisibility, ambientVisibility: () => sunFill(sunVisibility()) };
    this.meshes = this.volume.createMeshes({ ...meshOpts, name: 'Wybuch' });
    this.meshes.front.layers.set(FG_LAYER);
    scene.add(this.meshes.back, this.meshes.front);
    // Bryły pozostałych atlasów („fine”, „coarse”): ten sam obraz (wspólne `look`), właściciel świateł z indeksu globalnego.
    this._volumes = [this.volume];
    this._meshSets = [this.meshes];
    for (let t = 1; t < grids.length; t++) {
      const vol = new GasVolume({ grid: grids[t], noise3D, curl3D, lightGrid, slotBase: this.grid.base[t] });
      vol.look = this.volume.look;
      const ms = vol.createMeshes({ ...meshOpts, name: grids[t] === fine ? 'WybuchFine' : 'WybuchCoarse' });
      ms.front.layers.set(FG_LAYER);
      scene.add(ms.back, ms.front);
      this._volumes.push(vol);
      this._meshSets.push(ms);
    }
    this.director = new GasExplosions({ grid: this.grid, rng: fxRandom, hooks: {}, emitterCap: 384 });
    // Narzucenie prędkości źródeł gaśnie po starcie (F8): strumienie i kłęby po ~0,06 s żyją własną dynamiką.
    this.director.tune.velTau = 0.15;
    // Źródła jadą z nośnikiem domeny (wybuch wraku w ruchu — zbiornik paliwa, detonacja rdzenia).
    this.director.tune.followCarrier = true;
    this.embers = new GasEmbers({ scene, grid: this.grid, rng: fxRandom, renderOrder: 910 });
    this.embers.mesh.name = 'WybuchŻar';
    this.embers.mesh.layers.set(FG_LAYER);
    this.embers.U.fadeIn.value = 0.12;
    this.flashes = new GasFlashes({ scene, grid: this.grid, renderOrder: 920 });
    this.flashes.mesh.name = 'WybuchBłysk';
    this.flashes.mesh.layers.set(FG_LAYER);
    // Błysk gry: mały biały rdzeń nad progiem bloomu, krótko; poświata pod progiem (dema: rdzeń 26 HDR — w grze
    // bloom robił z niego tarczę na pół kadru).
    Object.assign(this.flashes.look, { core: [9, 8, 6.5], glow: [0.75, 0.36, 0.1], coreTau: 0.035, glowLife: 0.28, size0: 0.22, sizeGrow: 0.22 });
    // Łby płonących odłamków (duszki blasku jak w rakietach; własna instancja — pula rakiet przepisuje swoje co klatkę).
    this.glow = new GlowSprites({ scene, capacity: 512, renderOrder: 915 });
    this.glow.mesh.name = 'WybuchOdłamki';
    this.glow.mesh.layers.set(FG_LAYER);
    this.warmMeshes = [this.meshes.back, this.meshes.front, this.embers.mesh, this.flashes.mesh, this.glow.mesh];
    for (let t = 1; t < this._meshSets.length; t++) this.warmMeshes.push(this._meshSets[t].back, this._meshSets[t].front);
    // Żar trzyma pozycje WZGLĘDEM początku pul Core3D (gasEmbers: P.xyz) — przeskok początku przesuwa żywe dane
    // kernelem (rejestracja przed addFxStep: rozgrzewka kroku kompiluje też kernel przesunięcia).
    const origin = core.fx?.origin;
    if (origin && typeof origin.register === 'function') {
      const embers = this.embers;
      this._originEntry = origin.register({
        shiftNode: createShiftKernel(origin, { buffer: embers.P, capacity: EMBER_CAP, pos: [[0, 'xy']], name: 'wybuchŻarShift' }),
        isLive: () => embers.highWater > 0
      });
    }

    // Zegar.
    this.time = 0;
    this._lastClock = null;
    this.dt = 0;
    // Rekordy wybuchów (SoA): pozycja świata w double, reszta float32.
    this.bN = 0;
    this.bX = new Float64Array(BLAST_CAP);
    this.bY = new Float64Array(BLAST_CAP);
    this.bT0 = new Float64Array(BLAST_CAP);
    this.bD = new Float32Array(BLAST_CAP * BF);
    // Wybuchy wtórne (kolejka).
    this.qN = 0;
    this.qT = new Float64Array(DELAY_CAP);
    this.qX = new Float64Array(DELAY_CAP);
    this.qY = new Float64Array(DELAY_CAP);
    this.qS = new Float32Array(DELAY_CAP * 4);   // size, slot, cx, cy
    this.qH = new Float64Array(DELAY_CAP);       // gospodarz rodzica (klucz rodu kadłuba) — wtórny w nowej domenie też
    this.qO = new Float32Array(DELAY_CAP * 2);   // przesunięcie od środka rodzica (świat gry) — wtórny po jego stronie ścian
    this.qB = new Float64Array(DELAY_CAP);       // czas wybuchu rodzica (pozycja wtórnego jedzie z nośnikiem od tej chwili)
    this._clip = { x: 0, y: 0 };
    // Płonące odłamki (CPU): smuga dymu rakiet i iskry po drodze.
    this.fN = 0;
    this.fX = new Float64Array(FRAG_CAP);
    this.fY = new Float64Array(FRAG_CAP);
    this.fT0 = new Float64Array(FRAG_CAP);
    this.fD = new Float32Array(FRAG_CAP * FG);
    // Robocze (bez alokacji przy wybuchu): opcje prymitywów reżysera gazu, kierunki, nośnik, barwy.
    this._puffOpts = { temp: 0, smoke: 0, grow: 1.4, velBlend: 40, noise: 0.55, tau: 0, dir: [0, 0, 0] };
    this._trailOpts = { delay: 0, drag: 1.1, gravity: 0, fuel: 30, temp: 28, smoke: 16, shrink: 0.45, velBlend: 14, tau: 0 };
    this._fireOpts = { delay: 0, fuel: 3, temp: 3, smoke: 1.5, radial: 0, up: [0, 0, 1], lift: 0, velBlend: 6, flicker: 0.55, keep: 1.0 };
    this._jetOpts = { delay: 0, fuel: 0, temp: 0, smoke: 6, radial: 0, velBlend: 30, noise: 0.35, tau: 0.5, flicker: 0.3, grow: 1.3, rampIn: 0.04, rampOut: 0.25, velTau: -1 };
    this._acqOpts = { size: 1, life: 6, carrier: [0, 0, 0], tint: null, now: 0, reuse: false, tag: 0, priority: 0, host: 0, tier: 0, k: 1 };
    this._carrier = { x: 0, y: 0, z: 0, vx: 0, vy: 0, clock: CLOCK_SIM, t0: 0 };
    // Domeny WYSTRZAŁÓW (MUZZLE_TAG): właściciel (encja strzelca) per slot, opcje acquire, wynik dla WeaponFx (bez alokacji).
    this._mzOwner = new Array(this.grid.S).fill(null);
    this._mzAcq = { size: 1, life: 1, carrier: [0, 0, 0], tint: null, now: 0, reuse: false, tag: MUZZLE_TAG, priority: 0, host: 0,
      fire: 0, fadeTime: 0.6, baseDecay: 0, tier: 0, k: 1 };
    this._mzRes = { slot: -1, owner: 0, smokeK: 1 };
    this._mzJet = { delay: 0, fuel: 0, temp: 0, smoke: 0, radial: 0, velBlend: 45, noise: 0.4, tau: 0.05, flicker: 0.1, grow: 1.8, rampIn: 0.005, rampOut: 0.03, velTau: 0.06 };
    this._mzPuff = { temp: 0, smoke: 0, grow: 1.8, velBlend: 30, noise: 0.6, tau: 0, dir: [0, 0, 0] };
    // Zapłony silników (ENGINE_TAG, E2): śledzenie sekwencji per okręt (encja, numer sekwencji, etap obrazu, domena),
    // opcje acquire / emiterów (bez alokacji), światła zapłonu (świat gry).
    this._egE = new Array(ENGINE_TRACK).fill(null);
    this._egSerial = new Int32Array(ENGINE_TRACK);
    this._egStage = new Uint8Array(ENGINE_TRACK);
    this._egFail = new Uint8Array(ENGINE_TRACK);
    this._egSlot = new Int16Array(ENGINE_TRACK).fill(-1);
    this._egAcq = { size: 1, life: 1, carrier: [0, 0, 0], tint: null, now: 0, reuse: false, tag: ENGINE_TAG, priority: 0, host: 0,
      fire: 0, fadeTime: 1.5, baseDecay: 0, ambient: 0, tier: 0, k: 1 };
    // Światło wnętrza (gra: HallDust.interiorLightAt — hala K-7; null = brak) dla otoczenia domen zapłonu.
    this.interiorLight = null;
    this._egJet = { delay: 0, fuel: 0, temp: 0, smoke: 0, radial: 0, velBlend: 30, noise: 0.5, tau: 0.5, flicker: 0.4, grow: 1.6, rampIn: 0.1, rampOut: 0.25, velTau: 0.4 };
    this._egPuff = { temp: 0, smoke: 0, grow: 1.6, velBlend: 30, noise: 0.6, tau: 0, dir: [0, 0, 0] };
    this._elN = 0;
    this._elX = new Float64Array(ENGINE_LIGHT_CAP);
    this._elY = new Float64Array(ENGINE_LIGHT_CAP);
    this._elT0 = new Float64Array(ENGINE_LIGHT_CAP);
    this._elD = new Float32Array(ENGINE_LIGHT_CAP * 6);   // zasięg, r, g, b, domena, wysokość
    // Hak WeaponFx (wylot bogaty, przed recepturą): gaz z lufy armaty i Yamato — WeaponFx nie zna gazu.
    if (weaponFx) {
      const self = this;
      weaponFx.muzzleGas = (family, m, I, S, carrier, shooter) => self.muzzleShot(family, m.x, m.y, m.angle, S, I, carrier, shooter);
    }
    // Opcje bieżącego spawn() (spawn → _spawn): oś strumieni, zanik ich narzucenia, barwa dymu domeny, sam gaz, gospodarz
    // (klucz rodu kadłuba, z którego wybucha zbiornik — jego wrak nie jest przeszkodą tego gazu).
    this._optAxis = false; this._optAxisX = 0; this._optAxisY = 0; this._optJetTau = -1; this._optTint = null; this._optGasOnly = false;
    this._optHost = 0;
    this._bb = [0, 0, 0];
    // PRZESZKODY gazu: wejście klatki gry (src/game/gasObstacleInput.js — GAS_OBST_IN, świat gry) → scena (x, −y):
    // pudła i obrysy statyki (przy zmianie wersji), kadłuby (co klatkę).
    this._obstIn = null;
    this._statVer = -1;
    this._statOff = true;
    this._statSerial = 0;
    this._sceneBoxes = new Float64Array(GAS_OBST_IN.maxBoxes * GAS_OBST_IN.boxStride);
    this._sceneFoots = new Float64Array(GAS_OBST_IN.maxFoots * GAS_HULL_REC.stride);
    this._hullRec = new Float64Array(GAS_HULL_REC.stride);
    // cpuMs — krok update (gaz, żar, błyski, duszki), simMs — w tym grid.simulate (CPU: pakowanie i zlecenie compute),
    // advMs — krok spawn (wtórne, odłamki), spawnMs — ostatni wybuch (receptury na CPU), obstMs — przeszkody (wejście →
    // scena; bez rastra), moved — źródła wybuchu przesunięte z bryły statyki, hulls — rekordy kadłubów w domenach,
    // masked — domeny z bryłami statyki.
    this.stats = { spawned: 0, gasOnly: 0, gas: 0, particles: 0, off: 0, merged: 0, inherited: 0, reclaimed: 0, noSlot: 0, secondaries: 0, live: 0, cpuMs: 0, simMs: 0, advMs: 0, spawnMs: 0, lights: 0, domains: 0,
      obstMs: 0, moved: 0, hulls: 0, masked: 0,
      // wystrzały (E1): z gazem, bez domeny (sufit / zapas), za małe na ekranie, poza kadrem, domeny przejęte przez wybuchy,
      // domeny wystrzałów żywe (ostatnia klatka) i najwięcej naraz
      mzShots: 0, mzGas: 0, mzNoSlot: 0, mzSmall: 0, mzOff: 0, mzTaken: 0, mzDomains: 0, mzMax: 0,
      // zapłony silników (E2): sekwencje (zapłon / gaszenie) zauważone, z gazem (fazy), bez domeny, za małe / poza kadrem,
      // domeny przejęte przez wybuchy, domeny zapłonów żywe i najwięcej naraz
      engSeq: 0, engGas: 0, engNoSlot: 0, engSmall: 0, engTaken: 0, engDomains: 0, engMax: 0,
      // atlas „fine” (F5b, etap D): wybuchy w nim, domeny żywe (ostatnia klatka) i najwięcej naraz
      fineGas: 0, fineDomains: 0, fineMax: 0, coarseGas: 0, coarseDomains: 0, coarseMax: 0,
      // bez wolnej domeny dołożone do żywej przy łagodniejszym teście (RELAX_FIT_R) zamiast cząstek
      relaxed: 0 };
    const self = this;
    this.step = {
      name: 'wybuchy',
      spawn: (ctx) => self._advance(ctx),
      lights: (ctx) => self._lights(ctx),
      update: (ctx) => self._update(ctx),
      warm: (ctx) => self._warm(ctx)
    };
    core.addFxStep(this.step);
  }

  // ------------------------------------------------------------------ wejście

  /**
   * Wybuch w punkcie (x, y) świata gry: size — rozmiar [j.] (Atlas ≈ 280), profile — klucz EXPLOSION_PROFILES,
   * (vx, vy) — prędkość nośnika [j./s] (wybuch leci z rozpadającym się okrętem; dok i stacje stoją). Zwraca true,
   * gdy wybuch ruszył (także jako samo światło poza kadrem).
   */
  spawn(x, y, size = 300, profile = 'capital', vx = 0, vy = 0, opts = null) {
    if (!this.tune.enabled) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(size > 0)) return false;
    const t0 = performance.now();
    const prof = explosionProfile(profile);
    // Opcje tego wybuchu (bez alokacji: pola reżysera na czas _spawn; wtórne z kolejki ich nie dziedziczą):
    //   axisX, axisY — oś strumieni gazu w świecie gry (rozerwany zbiornik paliwa: gaz bije z rury wzdłuż osi
    //                  kadłuba — src/game/fuelTank.js); bez osi — strumienie w losowych kierunkach;
    //   jetVelTau    — zanik narzucenia prędkości strumieni [s] (dłuższy = strumień bije przez całe życie);
    //   tint [r,g,b] — barwa dymu NOWEJ domeny (detonacja rdzenia: barwa plazmy frakcji);
    //   gasOnly      — sama kula ognia i dym z gazu (bez błysku, świateł, fali, iskier, odłamków, smug i wtórnych —
    //                  daje je własny obraz wołającego, np. reactorBlast); bez domeny gazu — nic.
    const ax = Number(opts?.axisX) || 0, ay = Number(opts?.axisY) || 0;
    const al = Math.sqrt(ax * ax + ay * ay);
    this._optAxis = al > 1e-6;
    this._optAxisX = this._optAxis ? ax / al : 0;
    this._optAxisY = this._optAxis ? ay / al : 0;
    this._optJetTau = Number(opts?.jetVelTau) > 0 ? Number(opts.jetVelTau) : -1;
    this._optTint = opts?.tint || null;
    this._optGasOnly = !!opts?.gasOnly;
    //   hostKey      — klucz rodu kadłuba wybuchającego okrętu (hull.dmgKey): jego wrak i odłamy nie są przeszkodą
    //                  gazu tej domeny (zbiornik wybucha WEWNĄTRZ kadłuba — przeszkoda zjadłaby źródło).
    this._optHost = this.tune.hostExclude === false ? 0 : (Number(opts?.hostKey) || 0);
    let ok = false;
    try {
      ok = this._spawn(x, y, size, prof, Number(vx) || 0, Number(vy) || 0, -1, 1);
    } finally {
      this._optAxis = false; this._optJetTau = -1; this._optTint = null; this._optGasOnly = false; this._optHost = 0;
    }
    this.stats.spawnMs = performance.now() - t0;
    return ok;
  }

  _spawn(x, y, size, prof, cx, cy, forceSlot, power) {
    const R = fireRadius(size, prof);
    const T = this.tune;
    // Kadr i skala na ekranie w miejscu wybuchu (ostatnia klatka efektów).
    const core = this.core;
    const view = core.fx?.view || null;
    const reach = R * 2.6;
    const inView = explosionInView(view && view.x1 > view.x0 ? view : null, x, y, reach);
    const ppu = this._pxPerUnit(x, y);
    const gasAllowed = T.gas && prof.gas && this.grid.S > 0;
    let lod = explosionLod(R, ppu, inView, gasAllowed);
    let slot = -1;
    if (lod !== LOD_OFF && gasAllowed) {
      // Wtórny w domenie rodzica i wybuch, którego kula mieści się w żywej domenie — gaz BEZ progu gasMinPx (domena
      // i tak się liczy; drobne „kulki” z cząstek obok płynu psuły spójność łańcucha doku). Nowa domena — tylko od
      // gasMinPx; bez wolnej — cząstki (żywej domeny się nie zabiera).
      const small = R * ppu < T.gasMinPx;
      const parent = forceSlot >= 0 ? this.grid.slots[forceSlot] : null;
      // (domena rodzica zwolniona i zajęta potem przez wystrzał / zapłon — nie dziedziczyć: domena efektu)
      if (parent && parent.active && !isEffectTag(parent.tag) && parent.canHost(this._optHost) && this._ballFits(parent, x, -y, R)) {
        slot = this._extendSlot(forceSlot);
        this.stats.inherited++;
      } else {
        const fit = this._fitSlot(x, y, R, cx, cy);
        // Kula drobna względem domeny (< MERGE_MIN_CELLS komórek promienia) dostaje własną, ostrzejszą domenę, gdy
        // jest wolna (decyzja użytkownika 2026-10-08: łańcuch = kilka ostrych kul, nie jeden rozmyty obłok).
        if (fit >= 0 && (small || R >= MERGE_MIN_CELLS * this.grid.slots[fit].h || !this._hasFreeSlot())) slot = this._mergeSlot(fit);
        else if (!small) {
          slot = this._slotFor(x, y, R, cx, cy, R * ppu);
          if (slot < 0) {
            slot = this._relaxSlot(parent, forceSlot, x, y, R, cx, cy);
            if (slot < 0) this.stats.noSlot++;
          }
        } else slot = this._relaxSlot(parent, forceSlot, x, y, R, cx, cy);
      }
      lod = slot >= 0 ? LOD_GAS : LOD_PARTICLES;
    }
    const gasOnly = this._optGasOnly;
    if (gasOnly && lod !== LOD_GAS) return false;
    this.stats.spawned++;
    if (gasOnly) this.stats.gasOnly++;
    if (lod === LOD_GAS) this.stats.gas++;
    else if (lod === LOD_PARTICLES) this.stats.particles++;
    else this.stats.off++;
    const seed = fxRandom.next();
    // Sam gaz: rekord bez błysku, świateł, fali i gorącego powietrza (daje je obraz wołającego).
    const b = this._record(x, y, R, size, lod, slot, cx, cy, prof, seed, gasOnly ? 0 : power);
    if (lod === LOD_OFF) return true;
    if (gasOnly) {
      this._setCarrier(cx, cy);
      try { this._gasRecipe(slot, x, y, R, prof, power, cx, cy); } finally { ActiveCarrier.clear(); }
      return b >= 0;
    }
    this._setCarrier(cx, cy);
    try {
      if (T.flash) this._flash(x, y, R, prof, power, cx, cy);
      if (lod === LOD_GAS) this._gasRecipe(slot, x, y, R, prof, power, cx, cy);
      else this._particleRecipe(x, y, R, size, prof, power, cx, cy);
      if (T.sparks) this._sparks(x, y, R, size, prof, power, cx, cy);
      if (T.chunks) this._chunks(x, y, R, size, prof, power);
      if (T.trails) this._frags(x, y, R, size, prof, power, cx, cy, slot);
    } finally {
      ActiveCarrier.clear();
    }
    if (T.secondaries && power >= 0.99) this._secondaries(x, y, R, size, prof, slot, cx, cy);
    return b >= 0;
  }

  /**
   * F13: krok marszu obrazu gazu tej klatki (× look.stepCells). Szacunek próbek: Σ po domenach w kadrze — pole pudła domeny
   * przyciętego do kadru [px²] × komórki w pionie / krok (z góry promień idzie przez całą wysokość pudła; obie warstwy).
   * Ponad `marchBudget` krok rośnie proporcjonalnie (koszt marszu ~ liczba próbek), najwyżej × marchStepMax; rośnie od
   * razu, wraca powoli (bez pulsowania kroku przy kolejnych wybuchach).
   */
  _marchStep(ctx) {
    const T = this.tune;
    if (!(T.marchBudget > 0)) { this._stepK = 1; return 1; }
    const core = this.core;
    const g = this.grid;
    const stepC = Math.max(0.05, this.volume.look.stepCells);
    const free = typeof core.isFreePerspectiveCamera === 'function' && core.isFreePerspectiveCamera();
    const cam = core.activeCam1;
    const W = Number(core.composerTarget?.width) || 1600, H = Number(core.composerTarget?.height) || 900;
    let x0, y0, x1, y1;
    if (!free && cam) {
      const z = Math.max(1e-4, Number(cam.zoom) || 1), hw = W * 0.5 / z, hh = H * 0.5 / z;
      const cx = Number(cam.x) || 0, cy = Number(cam.y) || 0;
      x0 = cx - hw; x1 = cx + hw; y0 = cy - hh; y1 = cy + hh;
    } else {
      const v = core.fx?.view;
      if (!v) { this._stepK = 1; return 1; }
      x0 = v.x0; x1 = v.x1; y0 = v.y0; y1 = v.y1;
    }
    let samples = 0;
    for (let i = 0; i < g.S; i++) {
      const s = g.slots[i];
      if (!s.active || s.fade <= 0) continue;
      const half = s.h * s.n * 0.5, gx = s.cx, gy = -s.cy;   // świat gry
      const ox = Math.min(x1, gx + half) - Math.max(x0, gx - half);
      const oy = Math.min(y1, gy + half) - Math.max(y0, gy - half);
      if (ox <= 0 || oy <= 0) continue;
      const ppu = this._pxPerUnit(gx, gy);
      samples += ox * oy * ppu * ppu * (s.nz / stepC);
    }
    const target = clamp(samples / (T.marchBudget * 1e6), 1, Math.max(1, T.marchStepMax));
    const prev = this._stepK || 1;
    const dt = Math.max(0, Number(ctx?.dt) || 0);
    this._stepK = target >= prev ? target : prev + (target - prev) * Math.min(1, dt * 1.5);
    this.stats.marchSamples = samples;
    this.stats.marchStep = this._stepK;
    return this._stepK;
  }

  // Px ekranu na j. świata w punkcie (x, y): kamera z góry — zoom; kamera 3D — rzut z odległości.
  _pxPerUnit(x, y) {
    const core = this.core;
    const H = Number(core.composerTarget?.height) || 1080;
    if (typeof core.isFreePerspectiveCamera === 'function' && core.isFreePerspectiveCamera()) {
      const cam = core.cameraPersp;
      if (cam) {
        const p = cam.position;
        const dx = p.x - x, dy = p.y + y, dz = p.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const tanH = Math.tan(((Number(cam.fov) || 50) * Math.PI / 180) * 0.5);
        return (H * 0.5) / (d * tanH);
      }
    }
    return Math.max(1e-4, Number(core.activeCam1?.zoom) || 1);
  }

  _record(x, y, R, size, lod, slot, cx, cy, prof, seed, power) {
    let i = this.bN;
    if (i >= BLAST_CAP) {
      let oldest = 0;
      for (let k = 1; k < this.bN; k++) if (this.bT0[k] < this.bT0[oldest]) oldest = k;
      i = oldest;
    } else this.bN++;
    this.bX[i] = x; this.bY[i] = y; this.bT0[i] = this.time;
    const o = i * BF, D = this.bD;
    D[o] = R; D[o + 1] = size; D[o + 2] = lod; D[o + 3] = slot; D[o + 4] = cx; D[o + 5] = cy;
    D[o + 6] = prof.flash * power; D[o + 7] = prof.light * power; D[o + 8] = prof.shock * power; D[o + 9] = prof.haze * power;
    D[o + 10] = seed; D[o + 11] = power;
    return i;
  }

  _setCarrier(cx, cy) {
    ActiveCarrier.set(writeCarrierVelocity(cx, cy, CLOCK_SIM, Number(SimClock.sim) || 0, this._carrier));
  }

  // ------------------------------------------------------------------ domeny gazu

  /**
   * Czy kula ognia (sx, sy — scena) o promieniu R mieści się w obszarze, w którym gaz domeny ŻYJE: koło
   * FIT_RR · pół boku domeny (w pasie 0,74–0,97 promienia elipsoidy gasReact wygasza skalary, od 0,7 hamuje gąbka) z
   * zapasem 2 komórek, i nie jest drobniejsza niż MERGE_MIN_R_CELLS komórek (mniejsza w cudzej domenie znika).
   */
  _ballFits(s, sx, sy, R, rk = 1) {
    if (R < MERGE_MIN_R_CELLS * s.h) return false;
    const dx = sx - s.cx, dy = sy - s.cy;
    return Math.sqrt(dx * dx + dy * dy) + R * rk <= FIT_RR * s.h * s.n * 0.5 - 2 * s.h;
  }

  /**
   * Żywa domena, w której kula ognia (x, y) świata o promieniu R mieści się (`_ballFits`) i która jedzie z podobnym
   * nośnikiem; z kilku — najbliższa środkiem. Domena w wygaszaniu (po `until`) — tylko gdy nie ma wolnej (świeża kula
   * nie dziedziczy przygaszonego obrazu, gdy może mieć własną domenę). −1 = żadna.
   */
  _fitSlot(x, y, R, cx, cy, rk = 1) {
    const g = this.grid;
    const sx = x, sy = -y;
    const now = g.time;
    const free = this._hasFreeSlot();
    let best = -1, bestD = Infinity;
    for (let i = 0; i < g.S; i++) {
      const s = g.slots[i];
      if (!s.active || (free && now > s.until)) continue;
      // Domena efektu (gaz z lufy, dym zapłonu) — inny przepis i komórka; wybuch jej nie scala (może ją przejąć w _slotFor).
      if (isEffectTag(s.tag)) continue;
      // Pełna lista gospodarzy (16 rodów) — nowy wybuch z nowym gospodarzem nie scala się (wrak-gospodarz stałby się
      // przeszkodą własnego gazu); idzie do nowej domeny albo cząstkami (przegląd etapu C pkt 4).
      if (!s.canHost(this._optHost)) continue;
      if (!this._ballFits(s, sx, sy, R, rk)) continue;
      const dvx = s.vx - cx, dvy = s.vy + cy;
      if (dvx * dvx + dvy * dvy > 3600) continue;
      const dx = sx - s.cx, dy = sy - s.cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /**
   * Bez domeny (etap D): wybuch, którego kula mieści się w kole życia gazu żywej domeny przynajmniej połową promienia
   * (RELAX_FIT_R — wtórny przy brzegu domeny rodzica, sąsiad w łańcuchu doku), dokłada się do niej — część kuli za kołem
   * życia gaśnie, ale to dalej gaz, nie kulka z cząstek obok płynu. Wołane dopiero, gdy ścisły test i wolna domena zawiodły
   * (kula drobna na ekranie — nowej domeny i tak nie dostaje). −1 = cząstki.
   */
  _relaxSlot(parent, forceSlot, x, y, R, cx, cy) {
    if (this.tune.relaxFit === false) return -1;
    if (parent && parent.active && !isEffectTag(parent.tag) && parent.canHost(this._optHost) && this._ballFits(parent, x, -y, R, RELAX_FIT_R)) {
      this.stats.relaxed++;
      return this._extendSlot(forceSlot);
    }
    const fit = this._fitSlot(x, y, R, cx, cy, RELAX_FIT_R);
    if (fit < 0) return -1;
    this.stats.relaxed++;
    return this._mergeSlot(fit);
  }

  /** Czy wybuch dostanie domenę bez czekania: wolna albo domena efektu (wybuchy mają pierwszeństwo — przejmują ją). */
  _hasFreeSlot() {
    const S = this.grid.slots;
    for (let i = 0; i < S.length; i++) if ((!S[i].active && this._tierAllowed(S[i].tier | 0)) || isEffectTag(S[i].tag)) return true;
    return false;
  }

  /** Wybuch dokłada się do żywej domeny: zasilenie (życie domainLife od teraz, czas zasilenia dla presji), gospodarz. */
  _mergeSlot(i) {
    this.grid.feed(i, this.grid.time + this.tune.domainLife);
    this.grid.slots[i].addHost(this._optHost);
    this.stats.merged++;
    return i;
  }

  /**
   * Nowa domena gazu dla wybuchu (x, y) świata o promieniu kuli R (rPx — na ekranie). Siatka: kula ≥ fineMinPx — najpierw
   * wolna domena „fine” (F5b), potem podstawowa; mniejsza — odwrotnie (atlas „fine” jako zapas, zanim wybuch pójdzie
   * cząstkami). Bez wolnej: domeny po fazie ognia skracają życie (wygasają same), a ten wybuch idzie cząstkami — żywego
   * obłoku się nie zabiera (znikałby w jednej klatce).
   */
  _slotFor(x, y, R, cx, cy, rPx = 0) {
    const g = this.grid;
    const T = this.tune;
    const sx = x, sy = -y;
    const now = g.time;
    // Kolejność atlasów: kula duża na ekranie — „fine”, podstawowy, „coarse”; mała — „coarse”, podstawowy, „fine”; średnia —
    // podstawowy, „coarse”, „fine” (drobniejsza siatka jako ostatni zapas — łańcuch doku: 1–5 wybuchów bez domeny zamiast 7;
    // w bitwie zapas nie zmienił kosztu — A/B 2026-10-09).
    const big = rPx >= T.fineMinPx, small = rPx < T.coarseMaxPx;
    const o = big ? TIER_ORDER_BIG : (small ? TIER_ORDER_SMALL : TIER_ORDER_MID);
    let pick = -1;
    for (let j = 0; j < 3 && pick < 0; j++) if (this._tierAllowed(o[j])) pick = this._freeIn(this._tierIx[o[j]]);
    // Bez wolnej: domena EFEKTU w wygaszaniu (dym z lufy / zapłonu prawie znikł) — wybuchy mają pierwszeństwo.
    if (pick < 0) pick = this._takeEffectSlot(now, true);
    if (pick < 0) {
      // Domena w końcówce wygaszania (obraz ≤ FADE_RECLAIM, dym prawie znikł) ustępuje nowemu wybuchowi — to nie jest
      // zabranie żywego obłoku (ten zostaje nietknięty), a cząstki obok płynu psuły spójność łańcucha doku.
      let best = FADE_RECLAIM;
      for (let i = 0; i < g.S; i++) {
        const s = g.slots[i];
        if (s.active && now > s.until && s.fade <= best) { best = s.fade; pick = i; }
      }
      if (pick >= 0) {
        g.release(pick);
        this.director.dropSlot(pick);
        this._mzOwner[pick] = null;
        // Wtórne w kolejce celujące w przejętą domenę idą zwykłą drogą (bez dziedziczenia).
        for (let q = 0; q < this.qN; q++) if ((this.qS[q * 4 + 1] | 0) === pick) this.qS[q * 4 + 1] = -1;
        this.stats.reclaimed++;
      }
    }
    // Dalej bez domeny: dowolna domena efektu (najdawniej zasilona) — krótki dym z lufy / zapłonu ustępuje kuli ognia.
    if (pick < 0) pick = this._takeEffectSlot(now, false);
    if (pick < 0) {
      // Presja: domeny, których OSTATNIE zasilenie było ponad 2,2 s temu (ogień już zgasł — także po scaleniu wybuchu),
      // wygasają szybciej — zwolnią się za ~2 s. Wiek od `born` ucinał świeżo scaloną kulę.
      for (let i = 0; i < g.S; i++) {
        const s = g.slots[i];
        if (s.active && now - s.fed > 2.2 && s.until > now + 0.4) s.until = now + 0.4;
      }
      return -1;
    }
    const A = this._acqOpts;
    const ps = g.slots[pick];
    A.tier = ps.tier | 0;   // indeks w zestawie
    // Skala komórki domeny wybuchu: komórki na promień kuli względem strojenia (gaz w jednostkach komórek — GasSlot.k).
    A.k = ps.n / T.domainScale / GAS_CELLS_PER_R_REF;
    A.size = R * T.domainScale;
    A.life = T.domainLife;
    A.carrier[0] = cx; A.carrier[1] = -cy; A.carrier[2] = 0;
    A.tint = this._optTint;
    A.host = this._optHost;
    A.now = now;
    const slot = g.acquire(sx, sy, 0, R, A);
    if (slot >= 0 && g.grids[A.tier] === this.fine) this.stats.fineGas++;
    if (slot >= 0 && g.grids[A.tier] === this.coarse) this.stats.coarseGas++;
    return slot;
  }

  /** Atlas GAS_TIER_* istnieje i jest włączony (EXPLOSION_TUNE.fineGas / coarseGas). */
  _tierAllowed(t) {
    if (t < 0) return false;
    if (t === GAS_TIER_FINE && this.tune.fineGas === false) return false;
    if (t === GAS_TIER_COARSE && this.tune.coarseGas === false) return false;
    return (this._tierIx[t] ?? -1) >= 0;
  }

  /** Pierwsza wolna domena siatki o indeksie `tier` w zestawie (indeks globalny) albo −1. */
  _freeIn(tier) {
    const g = this.grid;
    if (tier < 0 || tier >= g.grids.length) return -1;
    const b = g.base[tier], n = g.grids[tier].S;
    for (let i = b; i < b + n; i++) if (!g.slots[i].active) return i;
    return -1;
  }

  _extendSlot(slot) {
    this.grid.feed(slot, this.grid.time + this.tune.domainLife * 0.6);
    this.grid.slots[slot].addHost(this._optHost);
    return slot;
  }

  // ------------------------------------------------------------------ gaz wystrzału z lufy (E1)

  /**
   * Wybuch bierze domenę EFEKTU — wystrzału albo zapłonu (pierwszeństwo wybuchów): w wygaszaniu (`fading`) albo dowolną —
   * najdawniej zasiloną. Domena zwolniona od razu (emitery gasną), jej dym znika. −1 = brak domen efektów.
   */
  _takeEffectSlot(now, fading) {
    const g = this.grid;
    let pick = -1, best = Infinity;
    for (let i = 0; i < g.S; i++) {
      const s = g.slots[i];
      if (!s.active || !isEffectTag(s.tag) || (fading && now <= s.until)) continue;
      if (s.fed < best) { best = s.fed; pick = i; }
    }
    if (pick < 0) return -1;
    if (g.slots[pick].tag === ENGINE_TAG) this.stats.engTaken++;
    else this.stats.mzTaken++;
    g.release(pick);
    this.director.dropSlot(pick);
    this._mzOwner[pick] = null;
    for (let i = 0; i < ENGINE_TRACK; i++) if (this._egSlot[i] === pick) this._egSlot[i] = -1;
    return pick;
  }

  /**
   * GAZ Z LUFY przy wystrzale (hak WeaponFx — wylot bogaty, przed recepturą cząstek): rodzina receptury `family` (MUZZLE_GAS:
   * armata, Yamato), wylot (x, y) świata gry, kąt lufy, S — skala wylotu (wieżyczka × receptura), I — moc rozmiaru broni,
   * carrier — nośnik (prędkość punktu lufy, z — wysokość lufy w kamerach 3D), shooter — encja strzelca (właściciel domeny,
   * ród kadłuba = gospodarz poza maską przeszkód). Zwraca wynik (`slot` ≥ 0 — gaz jest: `owner` — właściciel błysku wylotu
   * w siatce świateł, `smokeK` — mnożnik dymu cząstkowego receptury) albo null (bez gazu — receptura jak dawniej).
   */
  muzzleShot(family, x, y, angle, S, I, carrier, shooter) {
    const rec = MUZZLE_GAS[family];
    if (!rec) return null;
    const T = this.tune;
    this.stats.mzShots++;
    if (!T.enabled || !T.gas || !T.muzzleGas || !(this.grid.S > 0)) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(angle)) return null;
    const R = rec.R * (S > 0 ? S : 1) * (I > 0 ? I : 1);
    const view = this.core.fx?.view || null;
    if (!explosionInView(view && view.x1 > view.x0 ? view : null, x, y, R * 4)) { this.stats.mzOff++; return null; }
    if (R * this._pxPerUnit(x, y) < T.muzzleMinPx) { this.stats.mzSmall++; return null; }
    const k = Number(T.muzzleCarrier) || 0;
    const cvx = (Number(carrier?.vx) || 0) * k, cvy = (Number(carrier?.vy) || 0) * k;
    const host = T.muzzleHostExclude === false ? 0 : (Number(shooter?.beamHull?.dmgKey) || 0);
    const ux = Math.cos(angle), uy = -Math.sin(angle);   // kierunek lufy w scenie (x, −y)
    const slot = this._muzzleSlot(shooter || null, x, -y, ux, uy, R, rec, cvx, cvy, host);
    if (slot < 0) { this.stats.mzNoSlot++; return null; }
    const z = (Number(carrier?.z) || 0) + R * T.muzzleLift;
    this._muzzleRecipe(slot, x, -y, z, ux, uy, R, rec);
    this.stats.mzGas++;
    const res = this._mzRes;
    res.slot = slot;
    res.owner = T.muzzleLightOwn === false ? 0 : GAS_LIGHT_OWNER_BASE + slot;
    res.smokeK = T.muzzleSmokeK;
    return res;
  }

  /**
   * Domena wystrzału dla strzelca: jego żywa domena, w której wylot z obłokiem (≈ 3,5 R wzdłuż lufy) mieści się w kole życia
   * gazu, z tą samą paletą ognia i nośnikiem (±60 j/s), przyjmie gospodarza — zasilenie (życie od teraz); inaczej nowa
   * domena, gdy domen wystrzałów < sufit i wolnych > zapas dla wybuchów. Wystrzał nigdy nie zabiera domeny wybuchowi.
   */
  _muzzleSlot(owner, sx, sy, ux, uy, R, rec, cvx, cvy, host) {
    const g = this.grid;
    const T = this.tune;
    const now = g.time;
    // środek obłoku wylotu (dym idzie wzdłuż lufy)
    const px = sx + ux * R * 1.6, py = sy + uy * R * 1.6;
    let n = 0, free = 0, best = -1, bestD = Infinity;
    for (let i = 0; i < g.S; i++) {
      const s = g.slots[i];
      if (!s.active) { free++; continue; }
      if (s.tag !== MUZZLE_TAG) continue;
      n++;
      if (this._mzOwner[i] !== owner || s.fire !== rec.fire || !s.canHost(host)) continue;
      const dvx = s.vx - cvx, dvy = s.vy + cvy;
      if (dvx * dvx + dvy * dvy > 3600) continue;
      const dx = px - s.cx, dy = py - s.cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d + R * 2.2 > FIT_RR * s.h * s.n * 0.5 - 2 * s.h) continue;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      g.feed(best, now + T.muzzleLife);
      const s = g.slots[best];
      s.addHost(host);
      s.rx = sx; s.ry = sy;   // środek unoszenia gorącego gazu — ostatni wylot
      return best;
    }
    // (domeny efektów tylko w atlasie podstawowym — bez wolnej tam acquire zabrałby domenę wybuchu)
    if (n >= T.muzzleDomains || free <= T.muzzleReserve || this._freeIn(0) < 0) return -1;
    const A = this._mzAcq;
    A.size = (R / Math.max(1, T.muzzleCellsR)) * g.N;
    A.life = T.muzzleLife;
    A.carrier[0] = cvx; A.carrier[1] = -cvy; A.carrier[2] = 0;
    A.tint = rec.tint;
    A.fire = rec.fire;
    A.fadeTime = T.muzzleFade;
    A.baseDecay = T.muzzleDecay;
    A.host = host;
    A.now = now;
    const slot = g.acquire(px, py, 0, R, A);
    if (slot < 0) return -1;
    g.slots[slot].rx = sx; g.slots[slot].ry = sy;
    this._mzOwner[slot] = owner;
    return slot;
  }

  /**
   * Źródła gazu wylotu (scena): jęzor ognia prochowego / plazmy z lufy (krótki strumień z paliwem), kłąb ognia i dymu
   * przed wylotem rozpychany wzdłuż lufy, wolniejszy dym dalej (rozpręża się i znika — domena żyje krótko), hamulec
   * wylotowy armaty — dwa boczne jęzory dymu. Losowanie tylko fxRandom.
   */
  _muzzleRecipe(slot, X, Y, Z, ux, uy, R, rec) {
    const d = this.director;
    d.setOrigin(X, Y);
    const jo = this._mzJet;
    // Jęzor ognia: ~0,08 s, szybki (8 R/s ≈ 80 komórek/s przy 10 komórkach na R), rozchyla się i rwie (narzucenie gaśnie).
    // Źródła ≥ 3 komórki promienia — mniejsze giną w siatce (próba 2026-10-09: przy 1 komórce gazu nie było widać).
    jo.delay = 0; jo.fuel = 16 * rec.fuel; jo.temp = 6; jo.smoke = 3 * rec.smoke; jo.radial = R * 0.6;
    jo.velBlend = 45; jo.noise = 0.4; jo.tau = 0.05; jo.flicker = 0.1; jo.grow = 1.8; jo.rampIn = 0.005; jo.rampOut = 0.03; jo.velTau = 0.06;
    const spread = (fxRandom.next() - 0.5) * 0.08;
    const jx = ux - uy * spread, jy = uy + ux * spread;
    d.jet(slot, X, Y, Z, jx, jy, 0, R * 0.3, R * 0.9, R * 5, 0.1 + fxRandom.next() * 0.03, jo);
    // Kłąb przed wylotem: ogień przechodzący w dym, pchany wzdłuż lufy.
    const po = this._mzPuff;
    po.temp = 4; po.smoke = 5 * rec.smoke; po.grow = 1.8; po.velBlend = 30; po.noise = 0.6; po.tau = 0;
    po.dir[0] = ux * R * 2.5; po.dir[1] = uy * R * 2.5; po.dir[2] = 0;
    d.puff(slot, X + ux * R * 0.5, Y + uy * R * 0.5, Z, R * 0.5, 0.0, 0.08, 8 * rec.fuel, R * 0.8, po);
    // Wolniejszy dym dalej przed lufą (bez paliwa): rozpręża się i znika.
    po.temp = 0.5; po.smoke = 3 * rec.smoke; po.grow = 1.5; po.velBlend = 20; po.noise = 0.65;
    po.dir[0] = ux * R * 1.2; po.dir[1] = uy * R * 1.2; po.dir[2] = 0;
    d.puff(slot, X + ux * R * 1.3, Y + uy * R * 1.3, Z, R * 0.55, 0.05, 0.12, 0, R * 0.4, po);
    // Hamulec wylotowy (armata): dwa boczne jęzory dymu odchylone do tyłu.
    if (rec.brake > 0) {
      jo.fuel = 2.5 * rec.fuel; jo.temp = 1.8; jo.smoke = 6 * rec.smoke; jo.radial = R * 0.8; jo.velBlend = 35; jo.tau = 0.05;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const a = sgn * rec.brake;
        const c = Math.cos(a), sn = Math.sin(a);
        const bx = ux * c - uy * sn, by = ux * sn + uy * c;
        d.jet(slot, X - ux * R * 0.15, Y - uy * R * 0.15, Z, bx, by, 0, R * 0.25, R * 0.4, R * 4.5, 0.06, jo);
      }
    }
    d.clearOrigin();
  }

  // ------------------------------------------------------------------ dym zapłonu silnika (E2)

  /**
   * Przegląd dysz MAIN klatki (EngineFrame — z poprzedniej klatki renderu, tylko okręty w kadrze): okręt, którego silniki
   * są w ZAPŁONIE albo GASZENIU (encja.engineIgn — src/game/engineIgnition.js), dostaje dym tej fazy raz na sekwencję:
   * etap 1 — zimny dym (przed błyskiem), 2 — płomień i błysk, 3 — resztkowy dym gaszenia. Okręt, który wejdzie w kadr
   * w połowie fazy, dostaje resztę jej czasu.
   */
  _engineScan() {
    const T = this.tune;
    const IT = ENGINE_IGNITION_TUNE;
    // sekwencje zakończone: śledzenie wolne (następna sekwencja ma nowy numer)
    for (let i = 0; i < ENGINE_TRACK; i++) {
      const e = this._egE[i];
      if (!e) continue;
      const st = e.engineIgn;
      if (e.dead || !st || (st.state !== ENGINE_IGNITION && st.state !== ENGINE_SHUTDOWN) || st.serial !== this._egSerial[i]) {
        this._egE[i] = null; this._egSlot[i] = -1;
      }
    }
    if (!T.enabled || !T.gas || !T.engineGas || !(this.grid.S > 0) || this.dt <= 0) return;
    const F = EngineFrame;
    for (let k = 0; k < F.count; k++) {
      const e = F.entity[k];
      const st = e?.engineIgn;
      if (!st || (st.state !== ENGINE_IGNITION && st.state !== ENGINE_SHUTDOWN) || F.nzCount[k] === 0) continue;
      let r = -1, freeR = -1;
      for (let i = 0; i < ENGINE_TRACK; i++) {
        if (this._egE[i] === e) { r = i; break; }
        if (freeR < 0 && !this._egE[i]) freeR = i;
      }
      if (r < 0) {
        if (freeR < 0) continue;
        r = freeR;
        this._egE[r] = e; this._egSerial[r] = st.serial; this._egStage[r] = 0; this._egFail[r] = 0; this._egSlot[r] = -1;
        this.stats.engSeq++;
      }
      const flashAt = st.hot ? 0 : IT.smokeTime;
      let stage = 0, dur = 0;
      if (st.state === ENGINE_SHUTDOWN) { stage = 3; dur = IT.shutdownTime - st.t; }
      else if (st.t < flashAt) { stage = 1; dur = flashAt - st.t; }
      else { stage = 2; dur = 0.45; }
      if (stage <= this._egStage[r]) continue;
      // dym prawie po czasie — płomień w następnej fazie
      if ((stage === 1 && dur < 0.15) || (stage === 3 && dur < 0.1)) { this._egStage[r] = stage; continue; }
      // Faza bez gazu (poza kadrem, za mała na ekranie, bez wolnej domeny) — ponawiana w kolejnych klatkach (okręt wejdzie
      // w kadr w połowie dymu — dostaje resztę jego czasu); licznik porażek raz na fazę.
      if (this._engineEmit(k, r, e, stage, Math.max(0.15, dur))) this._egStage[r] = stage;
      else this._egFail[r] = stage;
    }
  }

  /** Domena i źródła fazy `stage` dla okrętu k listy klatki (rekord śledzenia r). Układ sceny (x, y w górę). true = gaz jest. */
  _engineEmit(k, r, e, stage, dur) {
    const T = this.tune;
    const F = EngineFrame;
    const g = this.grid;
    const n0 = F.nzFrom[k], nn = F.nzCount[k];
    let rbar = 0;
    for (let j = 0; j < nn; j++) rbar += F.nzR[n0 + j];
    rbar = rbar / nn;
    if (!(rbar > 0)) return false;
    const CX = F.x[k], CY = F.y[k];
    const dx = F.dirX[k], dy = F.dirY[k];
    const L = T.engineLen * rbar;
    // LOD: obłok za rufą w kadrze i dysza ≥ engineMinPx na ekranie (świat gry: y = −y sceny).
    const view = this.core.fx?.view || null;
    const mx = CX + dx * L * 0.4, my = CY + dy * L * 0.4;
    const first = this._egFail[r] !== stage;
    if (!explosionInView(view && view.x1 > view.x0 ? view : null, mx, -my, L + F.spread[k])
      || rbar * this._pxPerUnit(mx, -my) < T.engineMinPx) { if (first) this.stats.engSmall++; return false; }
    const slot = this._engineSlot(r, e, k, rbar, L, dur);
    if (slot < 0) { if (first) this.stats.engNoSlot++; return false; }
    this.stats.engGas++;
    const s = g.slots[slot];
    const rs = Math.max(rbar * 0.9, T.engineCellsR * s.h);
    const z = rs * T.engineLift;
    const d = this.director;
    d.setOrigin(CX, CY);
    const jo = this._egJet, po = this._egPuff;
    const nUse = Math.min(nn, 8);   // gromada dysz: najwyżej 8 źródeł (emitery reżysera — budżet 384)
    const step = nn / nUse;
    for (let q = 0; q < nUse; q++) {
      const j = n0 + Math.floor(q * step);
      const x = F.nzX[j], y = F.nzY[j];
      const ux = F.nzDX[j], uy = F.nzDY[j];
      if (stage === 1) {
        // ZIMNY DYM: gęsty, jasnoszary, wypluwany z dyszy z przerwami (rozruch), rozchyla się i kłębi.
        const sp = (L * 1.1) / Math.max(0.4, dur);
        jo.delay = 0; jo.fuel = 0; jo.temp = 0.12; jo.smoke = 18 * T.engineSmoke; jo.radial = rs * 1.6;
        jo.velBlend = 26; jo.noise = 0.55; jo.tau = dur * 0.85; jo.flicker = 0.45; jo.grow = 2.0;
        jo.rampIn = 0.12; jo.rampOut = 0.25; jo.velTau = 0.45;
        const spread = (fxRandom.next() - 0.5) * 0.12;
        d.jet(slot, x, y, z, ux - uy * spread, uy + ux * spread, 0, rs, rs, sp, dur + 0.08, jo);
        // dwa kłęby: na starcie i w połowie (krztuszenie przed zapłonem)
        for (let c = 0; c < 2; c++) {
          po.temp = 0.08; po.smoke = 16 * T.engineSmoke; po.grow = 1.9; po.velBlend = 28; po.noise = 0.65; po.tau = 0;
          po.dir[0] = ux * sp * 0.45; po.dir[1] = uy * sp * 0.45; po.dir[2] = 0;
          d.puff(slot, x + ux * rs * 0.8, y + uy * rs * 0.8, z, rs * 1.1, c === 0 ? 0.02 : dur * (0.45 + fxRandom.next() * 0.2),
            0.22, 0, rs * 3.0, po);
        }
      } else if (stage === 2) {
        // PŁOMIEŃ ZAPŁONU: krótki jęzor paliwa w barwie palety strugi (paleta ognia domeny), szybki — przechodzi w strugę.
        jo.delay = 0; jo.fuel = 26 * T.engineFlame; jo.temp = 5; jo.smoke = 2.5 * T.engineSmoke; jo.radial = rs * 1.0;
        jo.velBlend = 45; jo.noise = 0.35; jo.tau = 0.2; jo.flicker = 0.15; jo.grow = 1.7;
        jo.rampIn = 0.01; jo.rampOut = 0.2; jo.velTau = 0.12;
        d.jet(slot, x, y, z, ux, uy, 0, rs * 0.9, rs * 1.6, L * 2.0, dur, jo);
      } else {
        // GASZENIE: resztkowy dym z dysz — ciepły (resztki paliwa dopalają się słabo), wolniejszy, rwie się.
        const sp = (L * 0.7) / Math.max(0.4, dur);
        jo.delay = 0; jo.fuel = 1.5 * T.engineFlame; jo.temp = 0.7; jo.smoke = 10 * T.engineSmoke; jo.radial = rs * 1.3;
        jo.velBlend = 24; jo.noise = 0.55; jo.tau = dur * 0.45; jo.flicker = 0.5; jo.grow = 1.7;
        jo.rampIn = 0.03; jo.rampOut = 0.4; jo.velTau = 0.3;
        d.jet(slot, x, y, z, ux, uy, 0, rs * 0.85, rs, sp, dur * 0.9, jo);
      }
    }
    d.clearOrigin();
    if (stage === 2 && T.engineFlash) {
      // Błysk zapłonu (mały rdzeń nad progiem bloomu, krótko) w środku gromady dysz + światło w siatce (dym i kadłub).
      this.flashes.add(CX, CY, z + 20, (F.spread[k] + rs) * 0.9, 0.55, 0.16, s.vx, s.vy);
      this._engineLight(CX, -CY, F.spread[k] + L * 0.6, F.palette[k], slot, z + 40);
    }
    return true;
  }

  /**
   * Domena zapłonu okrętu: ta sama co w poprzedniej fazie sekwencji (zasilenie — życie od teraz), inaczej nowa — gdy domen
   * zapłonów < sufit i wolnych > zapas dla wybuchów (wspólny z wystrzałami). Zapłon nie zabiera domeny wybuchowi ani
   * wystrzałowi.
   */
  _engineSlot(r, e, k, rbar, L, dur) {
    const T = this.tune;
    const g = this.grid;
    const F = EngineFrame;
    const now = g.time;
    const life = dur + T.engineLinger;
    const prev = this._egSlot[r];
    if (prev >= 0 && g.slots[prev].active && g.slots[prev].tag === ENGINE_TAG && this._mzOwner[prev] === e) {
      g.feed(prev, now + life);
      return prev;
    }
    let n = 0, free = 0;
    for (let i = 0; i < g.S; i++) {
      const s = g.slots[i];
      if (!s.active) free++;
      else if (s.tag === ENGINE_TAG) n++;
    }
    if (n >= T.engineDomains || free <= T.muzzleReserve || this._freeIn(0) < 0) return -1;
    // Obłok: od dysz wzdłuż wydechu na L, szerokość gromady + rozchylenie — domena tak, by mieścił się w kole życia gazu
    // (FIT_RR), komórka ≤ promień dyszy / engineCellsR tylko przy wąskiej gromadzie (szeroka — źródła rosną do 3,5 komórki).
    const Rc = Math.max(F.spread[k] + rbar * 1.5, L * 0.6);
    const half = Rc / FIT_RR + 2 * (rbar / T.engineCellsR);
    const A = this._egAcq;
    A.size = 2 * half;
    A.life = life;
    const kc = Number(T.engineCarrier) || 0;
    A.carrier[0] = F.vx[k] * kc; A.carrier[1] = F.vy[k] * kc; A.carrier[2] = 0;   // EngineFrame: scena (y w górę)
    A.tint = T.engineTint;
    A.fire = ENGINE_FIRE_ROW[F.palette[k]] ?? 0;
    A.fadeTime = T.engineFade;
    A.baseDecay = T.engineDecay;
    A.host = T.engineHostExclude === false ? 0 : (Number(e?.beamHull?.dmgKey) || 0);
    A.now = now;
    const cx = F.x[k] + F.dirX[k] * L * 0.4, cy = F.y[k] + F.dirY[k] * L * 0.4;
    // Światło wnętrza hali (gra podaje `interiorLight(x, y)` świata gry; scena: y odbite).
    const il = typeof this.interiorLight === 'function' ? Number(this.interiorLight(cx, -cy)) || 0 : 0;
    A.ambient = il > 0 ? il * T.engineHallAmbient : 0;
    const slot = g.acquire(cx, cy, 0, rbar, A);
    if (slot < 0) return -1;
    g.slots[slot].rx = F.x[k]; g.slots[slot].ry = F.y[k];
    this._mzOwner[slot] = e;
    this._egSlot[r] = slot;
    return slot;
  }

  /** Światło zapłonu (świat gry): błysk w barwie palety strugi, potem gaśnie z płomieniem. */
  _engineLight(x, y, range, pal, slot, z) {
    let i = this._elN;
    if (i >= ENGINE_LIGHT_CAP) {
      let old = 0;
      for (let q = 1; q < ENGINE_LIGHT_CAP; q++) if (this._elT0[q] < this._elT0[old]) old = q;
      i = old;
    } else this._elN++;
    const c = (MAIN_EXHAUST_PALETTES[pal] || MAIN_EXHAUST_PALETTES[0]).light;
    this._elX[i] = x; this._elY[i] = y; this._elT0[i] = this.time;
    const o = i * 6;
    this._elD[o] = range; this._elD[o + 1] = c[0]; this._elD[o + 2] = c[1]; this._elD[o + 3] = c[2]; this._elD[o + 4] = slot; this._elD[o + 5] = z;
  }

  // ------------------------------------------------------------------ receptury

  /**
   * Kula ognia z gazu: rdzeń paliwa, kłęby wokół (głównie w płaszczyźnie gry — z góry nieregularny kwiat),
   * płonące odłamki („pająk”) i dogasające ogniska. Układ sceny: (x, −y), z ku kamerze.
   */
  _gasRecipe(slot, x, y, R, prof, P, cx, cy) {
    const d = this.director;
    const X = x, Y = -y;
    // Źródła po stronie środka wybuchu (GasExplosions.setOrigin): przy pierwszym wstrzyknięciu — po rastrze ze świeżą
    // statyką tej klatki (kawałek doku, który właśnie pęka, nie jest już bryłą) — kłąb za ścianą wraca przed nią, a
    // środek w bryle (wrak wciśnięty w ścianę hali) — do najbliższej wolnej komórki.
    d.setOrigin(X, Y);
    const po = this._puffOpts;
    const dir = po.dir;
    // Rdzeń: krótki wyrzut paliwa w kuli 0,4 R, rozpychany promieniowo.
    po.temp = 7; po.smoke = 0.9 * prof.smoke; po.grow = 1.5; po.velBlend = 40; po.noise = 0.6; po.tau = 0;
    dir[0] = 0; dir[1] = 0; dir[2] = 0;
    d.puff(slot, X, Y, 0, R * 0.4, 0, 0.13, 13 * P, R * 3.2, po);
    // Kłęby: drobne, blisko rdzenia, prawie w płaszczyźnie (|z| ≤ 0,3) — poszarpany brzeg kuli zamiast kilku balonów.
    const nL = rollRange(prof.lobes, fxRandom) + 2;
    const a0 = fxRandom.next() * TAU;
    for (let i = 0; i < nL; i++) {
      const a = a0 + (i + (fxRandom.next() - 0.5) * 0.9) / nL * TAU;
      let ux = Math.cos(a), uy = Math.sin(a), uz = (fxRandom.next() - 0.5) * 0.6;
      const l = Math.sqrt(ux * ux + uy * uy + uz * uz);
      ux /= l; uy /= l; uz /= l;
      const dist = R * (0.18 + fxRandom.next() * 0.42);
      po.temp = 6.5; po.smoke = 1.0 * prof.smoke; po.grow = 1.4; po.velBlend = 40; po.noise = 0.6;
      dir[0] = ux * R * 2.2; dir[1] = uy * R * 2.2; dir[2] = uz * R * 1.0;
      d.puff(slot, X + ux * dist, Y + uy * dist, uz * dist, R * (0.12 + fxRandom.next() * 0.12), 0.01 + fxRandom.next() * 0.16,
        0.06 + fxRandom.next() * 0.06, (8 + fxRandom.next() * 5) * P, R * (1.4 + fxRandom.next() * 1.2), po);
    }
    // Strumienie gazu z miejsca wybuchu (rozerwane rury, wyrwy — użytkownik 2026-10-07: gaz ma wychodzić z miejsc
    // wybuchu): wąski strumień bije z punktu w płaszczyźnie gry i leci dalej własnym pędem, rozchyla się i kłębi.
    // Część z paliwem (jęzor ognia przechodzący w dym), część sam ciemny gaz.
    // Z osią (rozerwany zbiornik paliwa — src/game/fuelTank.js): strumienie na przemian ku rufie i ku dziobowi wzdłuż
    // osi kadłuba, z małym rozrzutem, pierwszy z paliwem; bez osi — w losowych kierunkach.
    const jo = this._jetOpts;
    const axis = this._optAxis;
    const nJ = rollRange(prof.jets, fxRandom) + (axis ? 1 : 0);
    const aj = axis ? Math.atan2(-this._optAxisY, this._optAxisX) + Math.PI : fxRandom.next() * TAU;
    jo.velTau = this._optJetTau;
    for (let i = 0; i < nJ; i++) {
      const a = axis
        ? aj + ((i & 1) ? Math.PI : 0) + (fxRandom.next() - 0.5) * 2 * JET_AXIS_SPREAD
        : aj + (i + (fxRandom.next() - 0.5) * 0.8) / Math.max(1, nJ) * TAU;
      const ux = Math.cos(a), uy = Math.sin(a), uz = (fxRandom.next() - 0.5) * 0.2;
      const fire = axis ? (i === 0 || fxRandom.next() < 0.5) : fxRandom.next() < 0.5;
      jo.delay = fxRandom.next() * 0.12;
      jo.fuel = fire ? (7 + fxRandom.next() * 4) * P : 0;
      jo.temp = fire ? 5 : 0.3;
      jo.smoke = (fire ? 3 : 8 + fxRandom.next() * 4) * prof.smoke;
      jo.radial = R * 0.14;
      jo.velBlend = 36; jo.noise = 0.3; jo.tau = 0.55 + fxRandom.next() * 0.35; jo.flicker = 0.3; jo.grow = 1.25;
      jo.rampIn = 0.04; jo.rampOut = 0.3;
      const r = R * (0.055 + fxRandom.next() * 0.035);
      const dur = axis ? JET_AXIS_DUR[0] + fxRandom.next() * (JET_AXIS_DUR[1] - JET_AXIS_DUR[0]) : 0.6 + fxRandom.next() * 0.9;
      d.jet(slot, X + ux * R * 0.15, Y + uy * R * 0.15, 0, ux, uy, uz, r, r * 3, R * (5 + fxRandom.next() * 3), dur, jo);
    }
    // Płonące odłamki w gazie: smugi ognia przechodzące w dym (w płaszczyźnie, krótsze niż domena).
    const to = this._trailOpts;
    const nT = rollRange(prof.trails, fxRandom);
    for (let i = 0; i < nT; i++) {
      const a = fxRandom.next() * TAU;
      const uz = (fxRandom.next() - 0.5) * 0.3;
      const sp = R * (1.9 + fxRandom.next() * 1.3);
      const life = 0.7 + fxRandom.next() * 0.7;
      to.delay = 0; to.drag = 1.1; to.fuel = (28 + fxRandom.next() * 14) * P; to.temp = 30; to.smoke = (10 + fxRandom.next() * 6) * prof.smoke;
      to.shrink = 0.45; to.velBlend = 14; to.tau = life * 0.7;
      d.trail(slot, X, Y, 0, Math.cos(a) * sp, Math.sin(a) * sp, uz * sp, R * (0.085 + fxRandom.next() * 0.045), life, to);
      // Łeb odłamka (żar bez porwania — leci balistycznie z oporem jak emiter smugi).
      if (this.tune.embers) {
        this.embers.burst(X, Y, 0, Math.cos(a), Math.sin(a), uz, 0, 1, sp, sp, life + 0.8 + fxRandom.next() * 1.4,
          life + 1.0, R * (0.03 + fxRandom.next() * 0.025), 2.1, -1, 1, 0, slot);
      }
    }
    // Dogasające ogniska (płomień w bok, w płaszczyźnie gry) — wybuchy okrętów i konstrukcji.
    if (prof.afterburn > 0) {
      const fo = this._fireOpts;
      const nF = 1 + Math.floor(fxRandom.next() * 2.2);
      for (let i = 0; i < nF; i++) {
        const a = fxRandom.next() * TAU;
        const dist = R * (0.08 + fxRandom.next() * 0.35);
        fo.delay = 0.3 + fxRandom.next() * 0.4;
        fo.fuel = (2.4 + fxRandom.next() * 1.2) * P; fo.temp = 2.6 + fxRandom.next() * 0.6; fo.smoke = 1.6 + fxRandom.next() * 0.8;
        fo.radial = R * 0.08; fo.lift = R * 0.5; fo.velBlend = 6; fo.flicker = 0.55; fo.keep = 1.0;
        fo.up[0] = Math.cos(a); fo.up[1] = Math.sin(a); fo.up[2] = -0.25;
        d.fire(slot, X + Math.cos(a) * dist, Y + Math.sin(a) * dist, 0, R * (0.1 + fxRandom.next() * 0.06),
          prof.afterburn * (0.6 + fxRandom.next() * 0.6), fo);
      }
    }
    // Żar porywany przez gaz: wolne iskry wirujące w kuli ognia, stygnące w dymie.
    if (this.tune.embers && prof.embers > 0) {
      // Start rozrzucony w kuli ognia (0,4 R) i narastanie 0,12 s (embers.U.fadeIn): setki iskier z jednego punktu
      // dawały w bloomie tarczę na pół kadru (A/B 2026-10-07).
      const n = Math.round(prof.embers * 0.28 * countScale(R / prof.fire) * P);
      this.embers.burst(X, Y, 0, 0, 0, 1, 1.0, Math.round(n * 0.5), R * 0.6, R * 3.0, 0.5, 1.5, R * 0.016, 2.1, slot, 0.18, R * 0.4);
      this.embers.burst(X, Y, 0, 0, 0, 1, 1.0, Math.round(n * 0.5), R * 0.15, R * 1.1, 1.4, 3.4, R * 0.022, 1.6, slot, 0.25, R * 0.5);
    }
    d.clearOrigin();
  }

  /**
   * Wybuch bez gazu (mały na ekranie, brak wolnej domeny, profil drobny): kula ognia rakiet, ogień ADD broni
   * (kłęby stygnące z bieli w czerwień), kłęby sadzy w dymie rakiet.
   */
  _particleRecipe(x, y, R, size, prof, P, cx, cy) {
    const rf = this.rocketFx;
    const fb = rf?.fireballs;
    const rt = rf?.director ? rf.director.time : 0;
    if (fb) {
      fb.add(rt, x, y, 30, R * 0.95, 1.1 * prof.life + 0.25, 1.0, 0.9, cx, cy, Math.min(1.2, P));
      const nL = Math.max(1, rollRange(prof.lobes, fxRandom) - 1);
      const a0 = fxRandom.next() * TAU;
      for (let i = 0; i < nL; i++) {
        const a = a0 + (i + fxRandom.next() * 0.6) / nL * TAU;
        const dd = R * (0.35 + fxRandom.next() * 0.3);
        fb.add(rt + 0.03 + fxRandom.next() * 0.12, x + Math.cos(a) * dd, y + Math.sin(a) * dd, 29, R * (0.45 + fxRandom.next() * 0.2),
          0.8 * prof.life + 0.2, 0.9, 0.85, cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3, Math.min(1.1, P * 0.9));
      }
    }
    const gpu = this._gpu();
    if (gpu) {
      const sk = Math.sqrt(R / 400);
      gpu.add.begin(K.FIRE, fxRandom.round(8 + 10 * P)).at(x, -y).dir(1, 0).cone(Math.PI, 0.18).speed(120 * sk, 520 * sk)
        .life(0.45, 1.0).drag(2.6, 2.6).s0(R * 0.08, R * 0.14).s1(R * 0.2, R * 0.38).colors(FIRE_DIM, FIRE_COOL)
        .mix(2.4).alpha(0.45, 0.8).fade(0.08, 1.3).grow(0.4).spin(1.2).emit();
    }
    const smoke = rf?.smoke;
    if (smoke) {
      const n = Math.round((10 + 16 * prof.smoke) * Math.min(1.6, countScale(size) * 1.2));
      const S = smoke.s;
      for (let i = 0; i < n; i++) {
        const a = fxRandom.next() * TAU;
        const r0 = R * 0.3 * Math.sqrt(fxRandom.next());
        const sp = R * (0.25 + fxRandom.next() * 1.1);
        S.x = x + Math.cos(a) * r0; S.y = y + Math.sin(a) * r0; S.z = 18 + fxRandom.next() * 10;
        S.vx = Math.cos(a) * sp; S.vy = Math.sin(a) * sp; S.cx = cx; S.cy = cy;
        S.size0 = R * (0.12 + fxRandom.next() * 0.12); S.growth = R * (0.35 + fxRandom.next() * 0.3);
        S.life = (2.6 + fxRandom.next() * 2.6) * prof.life; S.temp = 0.3 + fxRandom.next() * 0.25;
        S.pal = SMOKE_KIND.SOOT; S.opacity = 0.18 + fxRandom.next() * 0.12; S.age = 0; S.angle = NaN;
        smoke.push();
      }
    }
  }

  // Błysk (rdzeń + poświata) — kwady zwrócone do kamery; jasność w paśmie HDR: mały biały rdzeń nad progiem,
  // krótko, poświata pod progiem (inaczej bloom zalewa kadr).
  // Błysk jedzie z nośnikiem wybuchu (cx, cy — świat gry; scena: y odwrócone) — przy wraku 250 j/s rozjeżdżał się o ~70 j.
  _flash(x, y, R, prof, P, cx = 0, cy = 0) {
    const k = prof.flash * P * this.tune.flashGain;
    if (!(k > 0)) return;
    this.flashes.add(x, -y, 60, R * 0.95, Math.min(1.25, k), 0.24 + 0.08 * k, cx, -cy);
  }

  _sparks(x, y, R, size, prof, P, cx, cy) {
    const n = Math.round(prof.sparks * countScale(size) * P * this.tune.sparkGain);
    if (n <= 0) return;
    const sk = Math.sqrt(R / 400);
    const S = SparkSystem3D.stage();
    if (!S) return;
    const t0 = Number(SimClock.sim) || 0;
    for (let s = 0; s < n; s++) {
      const a = fxRandom.next() * TAU;
      const r1 = fxRandom.next();
      const sp = (600 + r1 * fxRandom.next() * 4200) * sk;
      const r = fxRandom.next();
      const c = r < 0.3 ? SPARK_HOT : (r < 0.7 ? SPARK_GOLD : SPARK_WARM);
      const st = SparkSystem3D.stage();
      st.x = x; st.y = y; st.vx = Math.cos(a) * sp; st.vy = Math.sin(a) * sp;
      st.life = 0.4 + fxRandom.next() * 1.3; st.size = 0.25 + fxRandom.next() * fxRandom.next() * 0.75;
      st.drag = 0.9 + fxRandom.next() * 1.6; st.r = c[0]; st.g = c[1]; st.b = c[2]; st.gain = r < 0.3 ? 0.7 : 0.6;
      st.cvx = cx; st.cvy = cy; st.t0 = t0; st.clock = CLOCK_SIM;
      SparkSystem3D.pushStaged();
    }
  }

  _chunks(x, y, R, size, prof, P) {
    const gpu = this._gpu();
    if (!gpu || !(prof.chunks > 0)) return;
    const sk = Math.sqrt(R / 400);
    const n = prof.chunks * countScale(size) * P;
    gpu.debris.begin(K.CHUNK, fxRandom.round(n)).at(x, -y).dir(1, 0).cone(Math.PI, 0.2)
      .speed(260 * sk, 1500 * sk).life(1.8, 3.8).drag(0.25, 0.5)
      .s0(4 * sk, 11 * sk).s1(4 * sk, 11 * sk).colors(CHUNK_HOT, CHUNK_STEEL).alpha(1, 1).spin(9).x01(0.9, 0).emit();
  }

  // Płonące odłamki dalekiego zasięgu: CPU (ruch z oporem), smuga dymu rakiet i iskry po drodze, łeb — żar gazu
  // bez porwania (ten sam opór 1,1/s co ruch tutaj).
  _frags(x, y, R, size, prof, P, cx, cy, slot = -1) {
    if (!this.rocketFx?.smoke) return;
    const n = Math.round((prof.trails[0] + prof.trails[1]) * 0.5 * Math.min(1.4, countScale(size)) * P);
    for (let f = 0; f < n; f++) {
      if (this.fN >= FRAG_CAP) break;
      const a = fxRandom.next() * TAU;
      const sp = R * (2.4 + fxRandom.next() * fxRandom.next() * 4.2);
      const g = this.fN++;
      this.fX[g] = x; this.fY[g] = y; this.fT0[g] = this.time;
      const o = g * FG, D = this.fD;
      D[o] = Math.cos(a) * sp; D[o + 1] = Math.sin(a) * sp; D[o + 2] = cx; D[o + 3] = cy;
      D[o + 4] = 0.8 + fxRandom.next() * 1.6; D[o + 5] = 0.9 + fxRandom.next() * 0.6; D[o + 6] = 0;
      D[o + 7] = 0.7 + fxRandom.next() * 0.5; D[o + 8] = (R / 200) * (0.55 + fxRandom.next() * 0.7);
      // Skręt toru: odłamek koziołkuje — smuga lekko się wygina (proste rury wyglądały jak smugi rakiet).
      D[o + 9] = (fxRandom.next() - 0.5) * 1.6;
      D[o + 10] = slot;
    }
  }

  _secondaries(x, y, R, size, prof, slot, cx, cy) {
    const n = rollRange(prof.secondaries, fxRandom);
    for (let i = 0; i < n; i++) {
      if (this.qN >= DELAY_CAP) break;
      const q = this.qN++;
      const a = fxRandom.next() * TAU;
      const dist = R * (0.45 + fxRandom.next() * 0.55);
      this.qT[q] = this.time + 0.3 + fxRandom.next() * 1.3;
      this.qB[q] = this.time;
      this.qX[q] = x + Math.cos(a) * dist;
      this.qY[q] = y + Math.sin(a) * dist;
      this.qO[q * 2] = Math.cos(a) * dist; this.qO[q * 2 + 1] = Math.sin(a) * dist;
      const o = q * 4;
      this.qS[o] = size * (0.3 + fxRandom.next() * 0.22); this.qS[o + 1] = slot; this.qS[o + 2] = cx; this.qS[o + 3] = cy;
      this.qH[q] = this._optHost;
    }
  }

  _gpu() {
    const W = this.weaponFx;
    if (!W) return null;
    if (!W.gpu && typeof W.ensure === 'function') W.ensure();
    return W.gpu || null;
  }

  // ------------------------------------------------------------------ klatka

  // spawn (pierwszy krok klatki efektów): zegar, wybuchy wtórne, ruch odłamków (smugi dymu, iskry).
  _advance(ctx) {
    const tA = performance.now();
    const t = this.clock();
    const dt = this._lastClock === null ? 0 : clamp(t - this._lastClock, 0, 0.1);
    this._lastClock = t;
    this.dt = dt;
    if (dt > 0) this.time += dt;
    const now = this.time;
    // Wtórne: kolejka po czasie (zamiana z ostatnim).
    for (let q = this.qN - 1; q >= 0; q--) {
      if (this.qT[q] > now) continue;
      const o = q * 4;
      // Miejsce wtórnego jedzie z nośnikiem od WYBUCHU rodzica (dawniej od chwili wtórnego — przy wraku 300 j/s i opóźnieniu
      // 0,3–1,6 s wtórny zostawał do ~480 j. za rodzicem i jego domeną; przegląd etapu C pkt 11).
      const x = this.qX[q] + this.qS[o + 2] * (now - this.qB[q]);
      const y = this.qY[q] + this.qS[o + 3] * (now - this.qB[q]);
      const size = this.qS[o], slot = this.qS[o + 1] | 0, cx = this.qS[o + 2], cy = this.qS[o + 3];
      const host = this.qH[q];
      let sx = x, sy = y;
      // Wtórny po stronie rodzica: odcinek środek rodzica → wtórny przez bryłę statyki (ściana hali, brama doku) — wtórny
      // przed bryłą (inaczej jego kula ognia wybuchałaby za ścianą).
      if (slot >= 0 && this.grid.slots[slot]?.active
        && this.grid.clipSegment(slot, x - this.qO[q * 2], -(y - this.qO[q * 2 + 1]), x, -y, this._clip)) { sx = this._clip.x; sy = -this._clip.y; }
      const last = --this.qN;
      if (q !== last) {
        this.qT[q] = this.qT[last]; this.qX[q] = this.qX[last]; this.qY[q] = this.qY[last]; this.qH[q] = this.qH[last]; this.qB[q] = this.qB[last];
        this.qO[q * 2] = this.qO[last * 2]; this.qO[q * 2 + 1] = this.qO[last * 2 + 1];
        for (let k = 0; k < 4; k++) this.qS[o + k] = this.qS[last * 4 + k];
      }
      this.stats.secondaries++;
      this._optHost = host;
      try { this._spawn(sx, sy, size, SECONDARY_PROFILE, cx, cy, slot, 0.75); } finally { this._optHost = 0; }
    }
    // Dym zapłonu i gaszenia silników (E2): przegląd dysz klatki (EngineFrame) i stanów silników.
    this._engineScan();
    this._stepFrags(dt);
    this.stats.advMs = performance.now() - tA;
  }

  _stepFrags(dt) {
    if (!(dt > 0) || this.fN === 0) return;
    const smoke = this.rocketFx?.smoke;
    const D = this.fD;
    const time = this.time;
    for (let g = this.fN - 1; g >= 0; g--) {
      const o = g * FG;
      const a = time - this.fT0[g];
      const life = D[o + 4];
      if (a > life || !smoke) {
        const last = --this.fN;
        if (g !== last) {
          this.fX[g] = this.fX[last]; this.fY[g] = this.fY[last]; this.fT0[g] = this.fT0[last];
          for (let k = 0; k < FG; k++) D[o + k] = D[last * FG + k];
        }
        continue;
      }
      const drag = D[o + 5];
      const e = Math.exp(-drag * dt);
      const x0 = this.fX[g], y0 = this.fY[g];
      // Skręt: obrót prędkości własnej o ω·dt.
      const w = D[o + 9] * dt;
      const cw = Math.cos(w), sw = Math.sin(w);
      const vx = D[o] * cw - D[o + 1] * sw, vy = D[o] * sw + D[o + 1] * cw;
      this.fX[g] = x0 + vx * (1 - e) / drag + D[o + 2] * dt;
      this.fY[g] = y0 + vy * (1 - e) / drag + D[o + 3] * dt;
      D[o] = vx * e; D[o + 1] = vy * e;
      // Odłamek wpadł w bryłę statyki domeny swojego wybuchu (ściana hali, kawałek doku) — także przeskokiem między
      // klatkami (odcinek ruchu): smuga kończy się na ścianie.
      const fs = D[o + 10] | 0;
      if (fs >= 0 && (this.grid.solidAt(fs, this.fX[g], -this.fY[g]) || this.grid.clipSegment(fs, x0, -y0, this.fX[g], -this.fY[g], this._clip))) {
        D[o + 4] = a; continue;
      }
      const ddx = this.fX[g] - x0, ddy = this.fY[g] - y0;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      D[o + 6] += d;
      const u = a / life;
      const heat = D[o + 7] * (1 - u);
      const size = D[o + 8];
      const spacing = 4 * size;
      const S = smoke.s;
      let guard = 0;
      while (D[o + 6] > spacing && guard++ < 64) {
        D[o + 6] -= spacing;
        const k = d > 1e-6 ? clamp(1 - D[o + 6] / d, 0, 1) : 1;
        S.x = x0 + ddx * k; S.y = y0 + ddy * k; S.z = 18;
        S.vx = D[o] * 0.05; S.vy = D[o + 1] * 0.05; S.cx = D[o + 2]; S.cy = D[o + 3];
        // Smuga cieńsza i rzadsza ku końcowi lotu (odłamek dogasa).
        S.size0 = 2.6 * size * (1 - 0.4 * u); S.growth = 18 * size; S.life = 0.9 + fxRandom.next() * 1.5; S.temp = heat * 0.5;
        S.pal = SMOKE_KIND.DEBRIS; S.opacity = 0.17 * (1 - 0.5 * u); S.age = 0; S.angle = NaN;
        smoke.push();
      }
      if (fxRandom.next() < dt * 18 * heat) {
        const aa = fxRandom.next() * TAU;
        const st = SparkSystem3D.stage();
        if (st) {
          st.x = this.fX[g]; st.y = this.fY[g]; st.vx = D[o] * 0.3 + Math.cos(aa) * 160; st.vy = D[o + 1] * 0.3 + Math.sin(aa) * 160;
          st.life = 0.25 + fxRandom.next() * 0.3; st.size = 0.2 + fxRandom.next() * 0.2; st.drag = 3;
          st.r = SPARK_WARM[0]; st.g = SPARK_WARM[1]; st.b = SPARK_WARM[2]; st.gain = 0.8;
          st.cvx = D[o + 2]; st.cvy = D[o + 3]; st.t0 = Number(SimClock.sim) || 0; st.clock = CLOCK_SIM;
          SparkSystem3D.pushStaged();
        }
      }
    }
  }

  // Łby płonących odłamków: duszek blasku (żar stygnie z wiekiem odłamka).
  _fragHeads(ox, oy) {
    const G = this.glow;
    G.begin();
    const D = this.fD;
    const time = this.time;
    for (let g = 0; g < this.fN; g++) {
      const o = g * FG;
      const u = (time - this.fT0[g]) / D[o + 4];
      const heat = D[o + 7] * (1 - u);
      if (heat <= 0.03) continue;
      const S = G.s;
      S.x = this.fX[g] - ox; S.y = -this.fY[g] - oy; S.z = 40;
      S.size = 9 * D[o + 8] * (0.6 + 0.4 * heat);
      S.r = 2.4 * heat; S.g = 1.25 * heat * heat; S.b = 0.45 * heat * heat;
      G.push();
    }
    G.commit(ox, oy);
  }

  // Światła w siatce (świat gry): błysk (biel, ~0,15 s), ogień kuli (pomarańcz, migocze, ~1,4 s), żar (~3,5 s).
  _lights(ctx) {
    const grid = ctx.grid;
    let n = 0;
    if (!this.tune.lights || !grid || (this.bN === 0 && this._elN === 0)) { this.stats.lights = 0; return; }
    n += this._engineLights(grid);
    const now = this.time;
    const gain = this.tune.lightGain;
    const D = this.bD;
    for (let i = 0; i < this.bN; i++) {
      const o = i * BF;
      const a = now - this.bT0[i];
      if (a < 0 || a > BLAST_LIFE) continue;
      const R = D[o];
      const L = D[o + 7] * gain;
      if (!(L > 0)) continue;
      const x = this.bX[i] + D[o + 4] * a;
      const y = this.bY[i] + D[o + 5] * a;
      const fl = Math.exp(-a / 0.05);
      const fire = Math.max(0, 1 - a / 1.4);
      const flick = 0.82 + 0.18 * Math.sin((D[o + 10] * 50 + now) * 31) * Math.sin((D[o + 10] * 17 + now) * 13.7);
      const ember = Math.max(0, 1 - a / 3.5);
      // Jedno światło na wybuch: barwa i moc z sumy faz (siatka ma budżet — bez trzech wpisów na wybuch).
      const pF = 7 * fl * L, pR = 1.6 * fire * fire * flick * L, pE = 0.45 * ember * ember * L;
      const p = pF + pR + pE;
      if (p < 0.02) continue;
      const r = (LIGHT_FLASH[0] * pF + LIGHT_FIRE[0] * pR + LIGHT_EMBER[0] * pE);
      const g = (LIGHT_FLASH[1] * pF + LIGHT_FIRE[1] * pR + LIGHT_EMBER[1] * pE);
      const b = (LIGHT_FLASH[2] * pF + LIGHT_FIRE[2] * pR + LIGHT_EMBER[2] * pE);
      const range = R * (2.2 + 3.2 * fl + 1.0 * fire);
      // Właściciel = domena gazu wybuchu: w SWOIM dymie światło świeci tylko w dalekim polu (gasVolume — bliżej ognia
      // dym oświetla emisja i blask z objętości światła), w cudzym dymie i na kadłubach — normalnie (0 = bez domeny).
      const slot = D[o + 3];
      const owner = slot >= 0 ? GAS_LIGHT_OWNER_BASE + slot : 0;
      if (grid.addWorld(x, y, 70 + R * 0.25, range, r, g, b, 0.25, 0, 0, -1, -2, 0, 0, 0, owner) >= 0) n++;
    }
    this.stats.lights = n;
  }

  // Światła zapłonu silników (E2): błysk w barwie palety strugi (~0,1 s), płomień gaśnie do ~0,6 s; właściciel = domena dymu.
  _engineLights(grid) {
    const now = this.time;
    const gain = this.tune.lightGain;
    let n = 0;
    for (let i = this._elN - 1; i >= 0; i--) {
      const a = now - this._elT0[i];
      if (a > 0.7 || a < 0) {
        const last = --this._elN;
        if (i !== last) {
          this._elX[i] = this._elX[last]; this._elY[i] = this._elY[last]; this._elT0[i] = this._elT0[last];
          for (let k = 0; k < 6; k++) this._elD[i * 6 + k] = this._elD[last * 6 + k];
        }
        continue;
      }
      const o = i * 6;
      const p = (2.6 * Math.exp(-a / 0.08) + 0.7 * Math.max(0, 1 - a / 0.6)) * gain;
      const slot = this._elD[o + 4];
      const owner = slot >= 0 ? GAS_LIGHT_OWNER_BASE + slot : 0;
      if (grid.addWorld(this._elX[i], this._elY[i], this._elD[o + 5], this._elD[o], this._elD[o + 1] * p, this._elD[o + 2] * p, this._elD[o + 3] * p,
        0.25, 0, 0, -1, -2, 0, 0, 0, owner) >= 0) n++;
    }
    return n;
  }

  _update(ctx) {
    const t0 = performance.now();
    const dt = this.dt;
    const origin = ctx.origin;
    const g = this.grid;
    // Rekordy: wygasłe out; fala (sama refrakcja) i gorące powietrze nad kulą.
    const field = (this.tune.shock || this.tune.haze) ? ctx.core?.fxDistortion?.() : null;
    const now = this.time;
    const D = this.bD;
    for (let i = this.bN - 1; i >= 0; i--) {
      const o = i * BF;
      const a = now - this.bT0[i];
      if (a > BLAST_LIFE) {
        const last = --this.bN;
        if (i !== last) {
          this.bX[i] = this.bX[last]; this.bY[i] = this.bY[last]; this.bT0[i] = this.bT0[last];
          for (let k = 0; k < BF; k++) D[o + k] = D[last * BF + k];
        }
        continue;
      }
      if (!field || D[o + 2] === LOD_OFF) continue;
      const R = D[o];
      const x = this.bX[i] + D[o + 4] * a;
      const y = this.bY[i] + D[o + 5] * a;
      const shock = D[o + 8] * this.tune.shockGain;
      if (this.tune.shock && shock > 0 && a < 0.75) {
        // Front hamuje (fala Sedova): promień ~ (1 − e^(−t/τ)); siła gaśnie z wiekiem; grubość rośnie.
        const fr = R * 6.0 * (1 - Math.exp(-a / 0.22));
        const fade = 1 - a / 0.75;
        field.shock(x, y, fr, R * (0.22 + 0.5 * a), 9 * shock * fade * fade, 0.3);
      }
      const haze = D[o + 9] * this.tune.hazeGain;
      if (this.tune.haze && haze > 0 && a < 2.4) {
        field.heat(x, y, R * (1.1 + 0.6 * a), 3.2 * haze * (1 - a / 2.4), 0, 0, 1, 0, D[o + 10] * 10, 0.6);
      }
    }
    // Gaz: początek sceny → domeny, reżyser, symulacja, bryły.
    g.origin.x = origin.x; g.origin.y = origin.y; g.origin.z = 0;
    g.tune.glowFar = this.tune.farGlow === false ? 0 : this._glowFar;
    this._sun(ctx);
    const tO = performance.now();
    g.beginFrame();
    this._applyObstacles();
    // Rastry statyki po świeżej statyce tej klatki (nowe domeny, zmiana budowli) — przed emiterami (odłamek w ścianie
    // gaśnie, źródło w bryle przesunięte) i symulacją.
    g.updateRasters();
    this.stats.obstMs = performance.now() - tO;
    this.director.update(dt);
    const tS = performance.now();
    g.simulate(ctx.renderer, dt);
    this.stats.simMs = performance.now() - tS;
    this.stats.hulls = g.stats.hulls;
    this.stats.masked = g.stats.masked;
    this.stats.moved = this.director.stats.moved;
    // Otoczenie dymu ze strefy nieba (src/game/skyRegion.js — pas asteroid ciemniej, pusta przestrzeń jaśniej;
    // ta sama wygładzona jasność co tło — planet3d.assets.js) i przełącznik świateł siatki.
    const sky = typeof window !== 'undefined' && typeof window.getSkyRegion === 'function' ? Number(window.getSkyRegion()) : 1;
    const stepK = this._marchStep(ctx);
    for (const vol of this._volumes) {
      vol.stepScale = stepK;
      vol.ambientScale = Number.isFinite(sky) ? sky * this.tune.ambientSky : 1;
      vol.gridEnabled = this.tune.gridLight !== false;
      vol.syncLook();
      vol.updateMeshes(origin.x, origin.y, 0);
    }
    const cam = this._camera(ctx);
    this.embers.update(ctx.renderer, dt, cam);
    this.flashes.update(dt, cam);
    this._fragHeads(origin.x, origin.y);
    // Przełączniki warstw działają też na żywe wybuchy (A/B tej samej klatki).
    const T = this.tune;
    // drawGas false — same bryły gazu schowane (symulacja dalej; A/B kosztu marszu tej samej klatki).
    if (!T.gas || T.drawGas === false) {
      this.meshes.back.visible = false; this.meshes.front.visible = false;
      for (const ms of this._meshSets) { ms.back.visible = false; ms.front.visible = false; }
    }
    if (!T.embers) this.embers.mesh.visible = false;
    if (!T.flash) this.flashes.mesh.visible = false;
    // Siatki poza obchodem grafu (Core3D liczy macierze przed klatką efektów).
    syncMeshMatrix(this.embers.mesh, origin.x, origin.y);
    syncMeshMatrix(this.flashes.mesh, origin.x, origin.y);
    this.stats.live = this.bN;
    this.stats.domains = g.stats.active;
    let mz = 0, eg = 0, fd = 0, cd = 0;
    for (let i = 0; i < g.S; i++) {
      if (!g.slots[i].active) continue;
      const gr = g.grids[g.slots[i].tier | 0];
      if (gr === this.fine) fd++;
      else if (gr === this.coarse) cd++;
      if (g.slots[i].tag === MUZZLE_TAG) mz++;
      else if (g.slots[i].tag === ENGINE_TAG) eg++;
    }
    this.stats.fineDomains = fd;
    if (fd > this.stats.fineMax) this.stats.fineMax = fd;
    this.stats.coarseDomains = cd;
    if (cd > this.stats.coarseMax) this.stats.coarseMax = cd;
    this.stats.mzDomains = mz;
    if (mz > this.stats.mzMax) this.stats.mzMax = mz;
    this.stats.engDomains = eg;
    if (eg > this.stats.engMax) this.stats.engMax = eg;
    this.stats.cpuMs = performance.now() - t0;
  }

  // ------------------------------------------------------------------ przeszkody

  /**
   * Wejście klatki przeszkód gazu (Float64Array GAS_OBST_IN — pakuje gra: src/game/gasObstacleInput.js; świat gry). Tablica
   * czytana w kroku efektów tej klatki; bez wejścia — gaz bez przeszkód.
   */
  setObstacleInput(arr) {
    this._obstIn = arr || null;
  }

  /**
   * Prostokąty aktywnych domen gazu w ŚWIECIE GRY (po 4 liczby: x0, y0, x1, y1) do `out` — gra pakuje tylko kadłuby,
   * które je przecinają (bez domen — żadnych). Zwraca liczbę prostokątów.
   */
  domainRects(out) {
    const g = this.grid;
    let n = 0;
    for (let i = 0; i < g.S; i++) {
      const s = g.slots[i];
      if (!s.active) continue;
      if ((n + 1) * 4 > out.length) break;
      const half = s.h * s.n * 0.5;
      const b = n * 4;
      out[b] = s.cx - half; out[b + 1] = -s.cy - half; out[b + 2] = s.cx + half; out[b + 3] = -s.cy + half;
      n++;
    }
    return n;
  }

  // Wejście → scena (x, −y; osie i prędkość odbite, ω z przeciwnym znakiem): statyka przy zmianie wersji (albo przełącznika),
  // kadłuby co klatkę (gdy przeszkody kadłubów włączone).
  _applyObstacles() {
    const g = this.grid;
    const T = this.tune;
    const IN = this._obstIn;
    const I = GAS_OBST_IN;
    const on = T.obstacles !== false && !!IN;
    const ver = on ? IN[I.statVer] : 0;
    if (ver !== this._statVer || !on !== this._statOff) {
      let nb = 0, nf = 0;
      if (on) {
        nb = Math.min(I.maxBoxes, IN[I.boxes] | 0);
        const B = this._sceneBoxes;
        for (let b = 0; b < nb; b++) {
          const o = I.boxBase + b * I.boxStride, d = b * 6;
          B[d] = IN[o]; B[d + 1] = -IN[o + 1]; B[d + 2] = IN[o + 2]; B[d + 3] = -IN[o + 3]; B[d + 4] = IN[o + 4]; B[d + 5] = IN[o + 5];
        }
        nf = Math.min(I.maxFoots, IN[I.foots] | 0);
        for (let f = 0; f < nf; f++) sceneHullRec(IN, I.footBase + f * GAS_HULL_REC.stride, this._sceneFoots, f * GAS_HULL_REC.stride);
      }
      this._statSerial++;
      g.setStatics(this._statSerial, this._sceneBoxes, nb, this._sceneFoots, nf);
      this._statVer = ver;
      this._statOff = !on;
    }
    if (!on || T.hullObstacles === false) return;
    const nh = Math.min(I.maxHulls, IN[I.hulls] | 0);
    for (let k = 0; k < nh; k++) {
      sceneHullRec(IN, I.hullBase + k * GAS_HULL_REC.stride, this._hullRec, 0);
      g.hull(this._hullRec, 0);
    }
  }

  _camera(ctx) {
    const core = ctx.core || this.core;
    if (typeof core.isFreePerspectiveCamera === 'function' && core.isFreePerspectiveCamera()) return core.cameraPersp;
    return core.cameraOrtho || core.cameraPersp;
  }

  // Słońce: kierunek z pozycji słońca względem kamery, 30° nad płaszczyzną (jak dym rakiet).
  _sun(ctx) {
    const sunDir = this.rocketFx?.sunDir;
    if (sunDir) { this.grid.sunDir.copy(sunDir); return; }
    const cam = ctx.core?.activeCam1;
    const sun = typeof window !== 'undefined' ? window.SUN : null;
    if (sun && cam) {
      const dx = sun.x - (Number(cam.x) || 0);
      const dy = -(sun.y - (Number(cam.y) || 0));
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      const ce = Math.cos(SUN_ELEV);
      this.grid.sunDir.set(dx / l * ce, dy / l * ce, Math.sin(SUN_ELEV)).normalize();
    }
  }

  /**
   * Rozgrzewka (raz przy gotowym urządzeniu): puste dispatche kerneli gazu i żaru, pipeline'y siatek w passie
   * ortho z licznikiem instancji jak w prawdziwym rysowaniu — z kamerą z góry i kamerą 3D (typ kamery wchodzi do
   * klucza pipeline'u). Pierwszy wybuch bez kompilacji w swojej klatce.
   */
  _warm(ctx) {
    const core = ctx.core || this.core;
    this.grid.warm(ctx.renderer);
    this.embers.warm(ctx.renderer);
    const MS = this._meshSets;
    const savedG = MS.map((ms) => ms.geometry.instanceCount);
    const saved = [0, this.embers.mesh.count, this.flashes.geo.instanceCount, this.glow.geo.instanceCount];
    const vis = this.warmMeshes.map((m) => m.visible);
    MS.forEach((ms, i) => { ms.geometry.instanceCount = Math.max(2, savedG[i]); });
    this.embers.mesh.count = Math.max(2, saved[1]);
    this.flashes.geo.instanceCount = Math.max(2, saved[2]);
    this.glow.geo.instanceCount = Math.max(2, saved[3]);
    for (const m of this.warmMeshes) m.visible = true;
    try {
      for (const m of this.warmMeshes) {
        const layer = m.layers.isEnabled(FG_LAYER) ? FG_LAYER : 0;
        core.prewarmPass?.(m, layer);
        core.prewarmPass?.(m, layer, { ortho: false });
      }
    } finally {
      MS.forEach((ms, i) => { ms.geometry.instanceCount = savedG[i]; });
      this.embers.mesh.count = saved[1];
      this.flashes.geo.instanceCount = saved[2];
      this.glow.geo.instanceCount = saved[3];
      this.warmMeshes.forEach((m, i) => { m.visible = vis[i]; });
    }
  }

  clear() {
    this.bN = 0; this.qN = 0; this.fN = 0; this._elN = 0;
    this._mzOwner.fill(null);
    this._egE.fill(null); this._egSlot.fill(-1);
    this.director.clear();
    this.grid.clear();
    this.embers.clear();
    this.flashes.clear();
    this.glow.begin();
    this.glow.mesh.visible = false;
    for (const ms of this._meshSets) { ms.back.visible = false; ms.front.visible = false; }
  }

  dispose() {
    this.core?.fx?.removeStep?.(this.step);
    if (this._originEntry) this.core?.fx?.origin?.unregister?.(this._originEntry);
    this.core?.scene?.remove(this.embers.mesh, this.flashes.mesh, this.glow.mesh);
    for (const ms of this._meshSets) this.core?.scene?.remove(ms.back, ms.front);
    this.grid.dispose();
  }
}

const SUN_ELEV = 30 * Math.PI / 180;
// Kolejność atlasów dla nowej domeny wybuchu (GAS_TIER_*): kula duża / mała / średnia na ekranie.
const TIER_ORDER_BIG = [GAS_TIER_FINE, GAS_TIER_MAIN, GAS_TIER_COARSE];
const TIER_ORDER_SMALL = [GAS_TIER_COARSE, GAS_TIER_MAIN, GAS_TIER_FINE];
const TIER_ORDER_MID = [GAS_TIER_MAIN, GAS_TIER_COARSE, GAS_TIER_FINE];
/** Strumienie wzdłuż osi (zbiornik paliwa — src/game/fuelTank.js): rozrzut kierunku ±[rad] i czas bicia [s]. */
const JET_AXIS_SPREAD = 0.22;
const JET_AXIS_DUR = [1.0, 1.8];
/** Warstwa passa FG Core3D (perspektywa nad płaszczyzną gry, po passie ortho). */
const FG_LAYER = 2;

// Wybuch wtórny: mały, w tej samej domenie gazu, bez własnych wtórnych.
const SECONDARY_PROFILE = Object.freeze({
  fire: 1.0, gas: true, power: 0.8, lobes: [2, 3], trails: [1, 2], jets: [0, 1], sparks: 160, embers: 300, chunks: 5, smoke: 0.7,
  flash: 0.55, light: 0.5, shock: 0, haze: 0.5, secondaries: [0, 0], afterburn: 0, life: 0.7
});

/** Fizyka gazu dla wybuchu w próżni (bez wyporu), dym rozchodzi się i znika. */
export function tuneGasForSpace(T) {
  T.buoyancy = 0;
  T.buoyDir = [0, 0, 1];
  T.radialLift = 1.6;      // gorący gaz rozpycha się od środka wybuchu
  // Dym (2026-10-07: obłok ma się rozejść i zniknąć, nie wisieć). Po MacCormacku prędkości (etap A, 2026-10-09) masa dymu
  // kuli okrętu w 1–3 s rosła o 13–57% (więcej mieszania paliwa) — korekta z sondy (`wybuchy-sonda.mjs`, wariant v10):
  // zanik 0,42 → 0,52/s (połowa po ~1,3 s), sadza 0,42 → 0,39, rozprężanie 0,16 → 0,14 — kula „capital” w 1–3 s:
  // masa −2…+7%, objętość −2…0%, promień obłoku −7…−14% względem fizyki sprzed etapu.
  T.smokeDecay = 0.52;
  T.disperse = 0.14;       // zimny dym rozpręża się w próżni — obłok rośnie i rzednie
  // Opór zależny od prędkości (użytkownik 2026-10-07: dym „wisiał w miejscu”, nie wychodził z miejsca wybuchu):
  // szybki front kuli i strumieni hamuje (przy 50 kom./s ~1,7/s), wolny dym dalej odpływa (~0,35/s).
  T.drag = 0.2;
  T.dragQuad = 0.03;
  T.soot = 0.39;           // mniej sadzy na jednostkę paliwa (obłok nie chowa pola walki na długo; 0,42 przed etapem A)
  // Adwekcja prędkości 2. rzędu (MacCormack, F4 audytu 2026-10-08) — wiry nie gasną numerycznie, więc wzmacnianie
  // wirów i turbulencja z szumu (dawniej 3,5 i 35 — kompensowały pierwszy rząd) zbite z pomiaru sondą
  // (scripts/webgpu/wybuchy-sonda.mjs): przy 3,5 / 35 energia w dymie ROSŁA po wygaśnięciu źródeł, a niedobieżność
  // rzutu z 0,04 do 0,9; przy 1 / 10 energia maleje, średnie |ω| w dymie po 2–3 s ~2× dawnego.
  T.velMacCormack = 1;
  T.vorticity = 1.0;       // drobne wiry — kłęby i jęzory zamiast gładkich balonów
  T.turbulence = 10;
  // GĄBKA przy brzegu domeny (F9): opór 3/s od 0,7 promienia elipsoidy domeny i w pasie przy ścianach. Stały i
  // kwadratowy opór w środku ZOSTAJĄ: bez nich (drag 0, dragQuad tylko dla frontu) przy MacCormacku energia finału
  // nie gasła, a niedobieżność rzutu rosła z czasem (0,15 → 0,41 po 4 s) — 15 iteracji Jacobiego nie domyka.
  T.sponge = 3;
  // Kurczenie stygnącego gazu (F7): cel dywergencji −0,3 · tempo stygnięcia w komórkach bez spalania.
  T.contraction = 0.3;
  // Pole pozycji spoczynkowych wraca szybko (detal niesiony z gazem, ale bez rozciągania przez rozprężanie wybuchu —
  // przy 0,05/s detal z rozciągniętych pozycji rysował słoje i marmur; A/B 2026-10-07).
  T.restRelax = 1.5;
  T.fireBurn = 0.03;       // czysty płomień frontu spalania (sumuje się bez pochłaniania — przy 0,05 biel)
  // Daleki blask ognia w dymie (F10, etap B 2026-10-09): pierścień 6 osi na 9 komórkach (gasGrid GLOW_FAR_RADIUS) —
  // dym dalej od ognia (pół promienia kuli) nie jest czarny. Światło własnego wybuchu z siatki świateł gaśnie po ~1,4 s
  // (fazy strojone pod kadłuby), więc późny blask w obłoku daje dopiero objętość światła.
  T.glowFar = 4;
  return T;
}

/** Obraz gazu w grze z góry: dym nie chowa rozgrywki na długo, ogień przykrywa na chwilę. */
export function tuneLookForGame(L) {
  L.stepCells = 0.8;
  L.maxSteps = 80;
  L.density = 0.45;
  L.frontDensity = 0.5;
  L.albedo = [0.15, 0.135, 0.12];   // sadza jaśniejsza niż w demie (z góry czarny obłok czytał się jak dziura w kadrze)
  // Ogień: ciało w paśmie 0,4–1,3 (barwa zostaje barwą po ACES), biel tylko w gorącym jądrze — przy emisji 1
  // kula ognia gry świeciła bielą i bloom robił z niej tarczę.
  L.emission = 0.62;
  // Detal: przesunięcie odczytu polem wirowym i szum z pozycji spoczynkowych (restRelax 1,5/s), lekki szum startu
  // marszu (emisja całkowana po odcinku — gasVolume.js — więc bez słojów), mocniejsze języki ognia.
  L.jitter = 0.4;
  L.warpAmp = 1.4;
  L.detailScale = 0.09;
  L.detail = 0.7;
  L.erosion = 0.9;
  L.flameNoise = 0.9;
  // Blask ognia w dymie (F10, etap B 2026-10-09): 0,55 → 2,5. Człon blasku był ~10× słabszy od słońca (albedo sadzy
  // 0,15), więc dym tuż przy ogniu był czarny; blask istnieje tylko tam, gdzie pali się ogień (gaśnie z nim — w 2,8 s
  // różnica ≤ 13/255 nawet przy 4), więc nie robi z obłoku świecącej mgły. A/B wariantów: .tmp/wybuchy-etapy/B.md.
  L.glowGain = 2.5;
  return L;
}

// Rekord kadłuba / obrysu: świat gry (wejście) → scena gazu (x, −y): kotwica, osie i prędkość z odbitym y, ω z przeciwnym
// znakiem (odbicie zmienia zwrot obrotu); róg i bok teksla maski, zasięg, klucz, uid, wersja i słowa maski bez zmian.
function sceneHullRec(src, o, dst, d) {
  const H = GAS_HULL_REC;
  for (let k = 0; k < H.stride; k++) dst[d + k] = src[o + k];
  dst[d + H.ay] = -src[o + H.ay];
  dst[d + H.ey] = -src[o + H.ey];
  dst[d + H.fy] = -src[o + H.fy];
  dst[d + H.vy] = -src[o + H.vy];
  dst[d + H.w] = -src[o + H.w];
}

function syncMeshMatrix(mesh, ox, oy) {
  if (!mesh || !mesh.visible) return;
  mesh.position.set(ox, oy, 0);
  mesh.updateMatrix();
  mesh.matrixWorld.copy(mesh.matrix);
}

/** Wybuchy w Core3D (wymaga Core3D.init — scena i klatka efektów). */
export function createExplosionFx(core, opts = {}) {
  if (!core?.scene || !core?.fx) return null;
  const fx = new ExplosionFx(core, opts);
  if (typeof window !== 'undefined') window.__explosions = fx;
  return fx;
}

/**
 * Fabryka o sygnaturze dawnego reactorblow.js: `spawn({ x, y, size, profile, vx, vy, axisX?, axisY?, jetVelTau?, tint?,
 * gasOnly? })` (świat gry; opcje — ExplosionFx.spawn) → true, gdy
 * wybuch ruszył. `spawn.system` — reżyser (statystyki, strojenie). Dla `window.makeReactorBlow` i
 * `Destruction3D.init({ reactorFactory })`.
 */
export function createExplosionFactory(core, opts = {}) {
  const system = createExplosionFx(core, opts);
  if (!system) return null;
  const spawn = (o = {}) => system.spawn(o.x ?? 0, o.y ?? 0, o.size ?? 300, o.profile ?? 'capital', o.vx ?? 0, o.vy ?? 0, o);
  spawn.system = system;
  return spawn;
}
