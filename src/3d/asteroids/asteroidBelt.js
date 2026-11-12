// src/3d/asteroids/asteroidBelt.js
//
// PAS ASTEROID GRY (zadanie 21) — klej `start()` + `frame()` dema dema/asteroidy-webgpu.js
// jako moduł pasa w Core3D. Dane i logika pola są w src/game/ (bez kopii):
// AsteroidBeltField (skały pasm), FieldSunOcclusion (słońce przesłaniane przez pola),
// StormSimulator (asteroidStorms.js — przez storm.js), olbrzymy (asteroidBeltGiants.js
// + GiantBuilder). Render: moduły produkcyjne dema przeniesione do src/3d/asteroids/
// (tabela w docs/webgpu/DEMO-ASTEROIDY.md § Do portu w grze).
//
// PASSY CORE3D (nie RenderPipeline dema — Core3D renderuje passy ręcznie):
//   • pasmo PLAY (skały gry, pod płaszczyzną: zOf = −1,45 r · skala, z minerałami 1,62),
//     minerały, olbrzymy, płytka mgła, kwad dna ośrodka, pioruny, duszki, iskry —
//     warstwa 0 (pass ortho, kamera z góry); kadłuby gry (z ≈ 0) zawsze nad skałami;
//   • pasma RUBBLE / MID / DEEP, głęboka mgła i zasłona pola — warstwa 1 (pass tła,
//     perspektywa); złożenie = kolejność passów Core3D (tło → … → ortho).
// Wszystko pod JEDNĄ grupą `root` stojącą na początku pola = Core3D.fx.origin (ten sam
// początek co siatka świateł i pule GPU; przeskok po 20 tys. j. — FX_REBASE_DIST =
// REBASE_DIST dema). Dane GPU względem niego (double na CPU), modelViewMatrix w double.
//
// KLATKA (kolejność z § „Do portu w grze”) — krok Core3D.addFxStep, raz na klatkę rAF
// PRZED passami scen (fxFrame.js: spawn → początek pul → siatka świateł → update):
//   lights(ctx): początek pola → kamery (kadr gracza 1, w podzielonym ekranie suma kadrów)
//     → słońce → warstwy skał (komórki z budżetem, LOD per skała) → olbrzymy → mapa pola
//     → mgła → burza → światła: statki (reflektory z mapami cienia — atlas: begin /
//     request / gather), burza, świecące skały → (fx: grid.build)
//   update(ctx): mapy cienia (render atlasu) → ośrodek (update + compute) → iskry →
//     duszki → zasłona pola → pole przesłaniające maski słońca Core3D.
// Poza pasem (kadr nie dotyka pasa) krok nic nie liczy — sceny bez pól bez zmian.
//
// ROZGRYWKA pasa jest po stronie gry (RW-25): src/game/beltWorld.js — pole, cień pól, olbrzymy
// (budowa SDF przy kamerze i statkach, kolizje, pociski, strop), fizyka skał i platforma
// wydobywcza, zegar skał. Ten moduł to sam obraz: WŁASNA instancja pola (konfiguracja z gry —
// `world.createFieldReplica`; id skał deterministyczne), sektory cienia pól z gry
// (`adoptSectors`), wejście klatki = czas bezwzględny skał i dt (`prepareFrame`). Do gry wraca
// tylko zdarzenie `bankRadius` (mapy promienia banku kształtów po pieczeniu → `world.attachShapeRadius`
// — dopiero wtedy powstaje fizyka skał) i potwierdzenie wysłania zmian siatek ciał
// (`world.ackMinedUpload`). Dane gry czytane wprost w trybie `inline` (siatki SDF olbrzymów —
// SharedArrayBuffer, `rig.taken`, ciała wydobycia) w workerze przyjdą z migawki (RW-11c).

import * as THREE from 'three/webgpu';
import { RenderWorld } from '../../render/renderWorld.js';
import { Core3D } from '../core3d.js';
import { compileAsyncNaCelu } from '../rozgrzewka.js';
import { View3D } from '../../game/view3D.js';
import { BELT_BAND } from '../../game/asteroidBeltField.js';
import { FieldSunOcclusion, NIGHT_KNEE, nightKnee } from '../../game/asteroidFieldLight.js';
import { beltPlayZ } from '../../game/beltPlayZ.js';
import { getEntityHullLengthWorld, SHIP_LIGHT_DIR_TUNE } from '../../game/shipLightRuntime.js';
import { addShipLights, CAVE_SHIP_LIGHTS, FIELD_SHIP_LIGHTS } from '../fx/lightGrid.js';
import { createShiftKernel } from '../fx/gpuPoolOrigin.js';
import { RockShapeBankGPU } from './rockBank.js';
import { createRockNoiseVolume } from './rockNoise.js';
import { createRockShared, RockNodeMaterial, RockDepthStampMaterial, ROCK_LIGHT_DEFAULTS } from './rockMaterial.js';
import { RockLayer, ROCK_LOD_ORDER } from './rockLayers.js';
import { MineralTemplates, MineralLayer, MineralMaterial } from './minerals.js';
import { ShadowAtlas } from './spotShadows.js';
import { FieldMap } from './fieldMap.js';
import { VolumeLight } from './volumetrics.js';
import { getBeltMedium } from './beltMedium.js';
import { Sparks, SPARK_CAP } from './sparks.js';
import { StormSystem } from './storm.js';
import { GiantView, GiantBakeKernel } from './giants.js';
import { BeltFog } from './fog.js';
import { GlowSprites } from './glowSprites.js';
import { BeltVeil } from './beltVeil.js';
import { MinedRocks } from './minedRocks.js';
import { MiningView } from './miningView.js';
import { WARP_STARS } from '../warp/stars.js';
import { cameraRoll, rolledHalfExtents } from '../viewRoll.js';
import { warpLensExtraBody, setWarpLensExtra, WARP_WORLD_LENS } from '../warp/worldLens.js';
import { WARP_LENS_DOT_SWAP, warpFieldVisibility, stepWarpFieldFade } from '../../render/warpLensPhase.js';

// SOCZEWKA ŚWIATA — OLBRZYMY PASA (DECYZJE E1, etap 3A 2026-10-26): olbrzym ma rekord dodatkowy soczewki skoku gracza
// (worldLens.js: `giant:<id>` — środek, promień = większa półoś, smuga `smudge`) w tym samym przebiegu co ciała; jego
// obraz w skoku to IMPOSTOR — elipsa półosi × skala obrazu w barwie skały w partii kropek soczewki (hexShips3D:
// HexBodyLensBatch, pod kadłubami), bez budowy SDF (pole olbrzyma powstaje < 420 tys. j. i w skoku i tak jest schowane).
// Prawdziwy widok olbrzyma gaśnie, gdy jego obraz soczewki go zastępuje (udział soczewki ≥ WARP_LENS_DOT_SWAP).
const GIANT_LENS_COLOR = Object.freeze({ r: 0.4, g: 0.37, b: 0.33 });

/** Warstwy passów Core3D: gra (ortho) i tło (perspektywa). */
export const BELT_LAYER_PLAY = 0;
export const BELT_LAYER_BACK = 1;

// Kolejka przezroczystych passa gry: minerały → płytka mgła (−59, −58) → kwad dna
// ośrodka (−50) → [efekty gry ≥ 0: dysze, Fx3D, kadłuby 9–10, odłamki 11] → pioruny (14)
// → duszki (20) → iskry (24). W demie: minerały 2, mgła 8–9, dno 12, pioruny 14, duszki
// 20, iskry 24 — względna kolejność pola ta sama, efekty gry nad pyłem.
// Pass tła (kolejka przezroczysta; OKNO renderOrder (−0,5; 0) NALEŻY DO PASA — beltVeil.js VEIL_RENDER_ORDER): niebo
// i gwiazdy (< −0,5, bez zapisu głębi) → skały tła RUBBLE / MID / DEEP (backRocks + indeks · backBandStep, bliższe
// pasmo pierwsze; w warstwie koszyki od największych na ekranie — rockLayers.js ROCK_LOD_ORDER; −0,45 … −0,20) → zasłona
// pola (−0,1, test głębi — pod skałami tła odpada) → każda inna rzecz passa tła (≥ 0: obiekty bez renderOrder, napisy
// budowli 5, gaz wybuchów w głębi 10, głębokie płaty mgły 10+, …) — zasłona leży tam, gdzie dawniej (−0,5: po niebie,
// przed każdą inną przezroczystą rzeczą tła). DAWNA KOLEJKA (A/B setRockOrder(false) — rockLayers.js renderOrderOld):
// skały tła backRocksOld (2, wszystkie pasma — za zasłoną −0,5 i za rzeczami tła 0…2), skały gry rocks (1), bez odstępów.
export const BELT_RENDER_ORDER = Object.freeze({ rocks: 1, minerals: -70, backRocks: -0.45, backBandStep: 0.1, backRocksOld: 2 });
const RENDER_ORDER = BELT_RENDER_ORDER;
// Znaczek głębi skał gry (_createPlayStamp): skała pomniejszona o 3% względem środka — znaczek ściśle wewnątrz pokrycia
// skały w passie gry (zapas na zaokrąglenia wierzchołka i reguły pokrycia próbek MSAA); brzeg 3% promienia tło liczy jak
// dawniej.
export const PLAY_STAMP_SHRINK = 0.97;

// Wygaszanie pasm tła przy oddaleniu (demo): gruz znika przed mapą taktyczną, środek
// przy samym dole zakresu zoomu, głębia zostaje.
const BACK_FADE = Object.freeze({ [BELT_BAND.RUBBLE]: [0.22, 0.09], [BELT_BAND.MID]: [0.07, 0.03], [BELT_BAND.DEEP]: null });

// PAS W SKOKU NIE JEST RYSOWANY (2026-10-27, decyzja użytkownika: „asteroidy dalej mi się nie podobają — myślę żeby
// całkowicie wywalić”; dawne skały skoku — docs/webgpu/WARP-SKALY.md). TRYB SKOKU PASA = pole wyłączone (_deactivate):
// gwiazdy w smugach (WARP_STARS.stretch > WARP_MODE_STRETCH) i kamera szybsza niż ON (gaśnie < OFF) — przy prędkości
// warpa komórki nie nadążają, maska zacienienia pola ze starego okna czerniła kadłub — albo soczewka skoku gracza
// zasłoniła prawdziwy widok (udział < WARP_FADE.hidden). Progi nad hipercruise'em Mk III (≤ 40 tys. j/s): w hipercruisie
// pas to prawdziwe pole (pomiar kosztu — WARP-SKALY.md, „Usunięcie”). Szybciej niż CUT — skok pozycji (teleport,
// cięcie), nie przelot.
const WARP_MODE_ON = 60000;
const WARP_MODE_OFF = 45000;
const WARP_MODE_STRETCH = 0.05;
const WARP_CUT_SPEED = 1.2e6;
// ZANIK POLA przy skoku gracza: udział prawdziwego widoku = warpFieldVisibility (src/render/warpLensPhase.js: 1 − β /
// chargeBeta soczewki świata WARP_WORLD_LENS — pole gaśnie razem ze „wstawaniem” świata i jest puste już na końcu
// ładowania, przed kopem), po trybie skoku wraca w WARP_FIELD_FADE.reveal s (stepWarpFieldFade). Na istniejących
// uniformach, bez nowych pipeline'ów: próg pikseli skał (`L.minPx` — skała maleje do zera, najpierw najmniejsze na
// ekranie; log od `lo` do promienia największej skały w kadrze `rMax` · zoom), krycie płatów mgły, zasłona, gęstość
// ośrodka, światła pola (statki, świecące skały, burza), siła maski słońca pola. Udział < `hidden` — tryb skoku pasa.
const WARP_FADE = Object.freeze({ hidden: 0.02, lo: 0.7, rMax: 2200 });

// BUDŻET WCZYTYWANIA KOMÓREK (pomiar 2026-10-27 — docs/webgpu/WARP-SKALY.md, „Usunięcie”): budżet klatki dzielony
// między warstwy WAGĄ zaległości (1 + komórki czekające z poprzedniej klatki; czas niewykorzystany przez jedną warstwę
// przechodzi na następne) i rosnący z prędkością kamery od `from` do × `mul` przy `to` j/s (hipercruise Mk III w strefie
// pasa — 32 tys.). Równy podział (¼ na warstwę) zostawiał dziury w kadrze w paśmie MID / RUBBLE już przy Mk II.
export const BELT_LOAD_BOOST = Object.freeze({ from: 20000, to: 32000, mul: 1.5 });

/** Budżet wczytywania komórek pola na klatkę [ms] przy prędkości kamery camSpeed [j/s]. */
export function beltLoadBudgetMs(baseMs, camSpeed, cfg = BELT_LOAD_BOOST) {
  const t = Math.min(1, Math.max(0, ((Number(camSpeed) || 0) - cfg.from) / Math.max(1, cfg.to - cfg.from)));
  return baseMs * (1 + (cfg.mul - 1) * t * t * (3 - 2 * t));
}

// Głęboka noc (dema: nightKnee) — w src/game/asteroidFieldLight.js (platforma wydobywcza liczy
// tę samą wartość); tu re-eksport dla modułów obrazu.
export { NIGHT_KNEE, nightKnee };

// Świecące typy skał (indeksy ROCK_TYPES): kryształ, uran, energetyczna (dynamics.js dema).
const GLOW_ROCK = Object.freeze({ 4: Object.freeze([0.34, 0.82, 1.0]), 6: Object.freeze([0.34, 1.0, 0.24]), 8: Object.freeze([0.62, 0.5, 1.0]) });

export const ASTEROID_BELT_CONFIG = Object.freeze({
  // Czas na generowanie komórek na klatkę (na wszystkie warstwy razem; demo: 3 ms).
  budgetMs: 3,
  maxCachedCells: 7000,
  // Statki ze światłami pola (reflektory z mapami cienia) — najbliższe środka kadru.
  // Reflektor daleki sięga 14 tys. j.: przy bitwie w polu siatka świateł (ITEM_CAP)
  // nasyciłaby się — budżet świateł statków (FX-INFRA §1, ryzyko 21).
  maxLitShips: 6,
  // Mapy cienia skał dla reflektorów tylko tylu pierwszych z listy (gracz pierwszy, potem najbliżsi
  // środka kadru); światła dalszych statków świecą bez cienia skał. Każda mapa to osobny render
  // atlasu (koszt CPU) — pomiar A/B: scripts/webgpu/asteroidy-gra.mjs --ab.
  maxShadowShips: 2,
  // Kadr świateł i świecących skał: półkadr × 1,4 + 800 (lightBox dema).
  lightBoxMul: 1.4,
  lightBoxPad: 800,
  // Strop warstwy skał gry (z) — dno pyłu nad skałami.
  rockLayerTop: 0
});

/**
 * Próg pikseli skał przy zaniku pola (WARP_FADE): fade 1 — 0 (próg warstwy bez zmian), mniej — log od `lo` do promienia
 * największej skały w kadrze (`rMax` · zoom [px bufora / j.]); skała poniżej progu znika, między progiem a dwoma maleje
 * (RockNodeMaterial: smoothstep(minPx, 2 · minPx, promień px)).
 */
export function warpFadeMinPx(fade, zoom, cfg = WARP_FADE) {
  const f = Number(fade);
  if (!(f < 0.999)) return 0;
  const hi = Math.max(cfg.lo * 2, cfg.rMax * (Number(zoom) || 0));
  return cfg.lo * Math.pow(hi / cfg.lo, 1 - (f > 0 ? f : 0));
}

/**
 * Poza świateł pola statku (2026-10-29): gracz — poza renderu (RenderWorld.playerPose: interpolacja między krokami
 * fizyki, ta sama co kadłuba w hexShips3D.getInterpolatedRenderPose), gdy pełna; inny statek albo brak pozy — null
 * (światła w pozie encji). Gracz 2 zostaje w pozie kroku jak jego kadłub.
 */
export function beltShipRenderPose(e) {
  if (!e || e !== RenderWorld.ship) return null;
  const p = RenderWorld.playerPose;
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.angle) ? p : null;
}

export class AsteroidBelt {
  /**
   * Część CPU (natychmiast, bez GPU): własna instancja pola i cienia pól na danych świata pasa gry.
   * @param {object} o
   * @param {import('../../game/beltWorld.js').BeltWorld} o.world świat pasa gry
   */
  constructor({ world, config = null } = {}) {
    this.cfg = { ...ASTEROID_BELT_CONFIG, ...(config || {}) };
    this.world = world;
    this.sun = { x: world.sun.x, y: world.sun.y };
    this.au = world.au;
    // Własne pole (cache komórek, przycięcie co klatkę) — konfiguracja z gry, skały te same co w polu gry.
    this.field = world.createFieldReplica();
    // Cień pól: sektory policzone po stronie gry (ekran ładowania) — bez drugiego liczenia.
    this.occlusion = new FieldSunOcclusion(this.field);
    world.onOcclusion((sectors) => this.occlusion.adoptSectors(sectors));
    // Widoki olbrzymów (GiantView) po id wpisu świata — stan obrazu poza obiektami gry.
    this._giantViews = new Map();
    // Wspólny kernel pieczenia światła olbrzymów (giants.js GiantBakeKernel) — z initGpu, rozgrzany w _prewarmCompute.
    this.giantBake = null;
    this.medium = getBeltMedium();
    // Atlas map cienia reflektorów = mapy cienia SIATKI ŚWIATEŁ GRY: ustawiany przed
    // budową materiałów czytających siatkę (lightGrid.js: `loop` sprawdza `shadows`).
    this.atlas = new ShadowAtlas();
    this.grid = Core3D.fx ? Core3D.fx.grid : null;
    if (this.grid) this.grid.shadows = this.atlas;
    this.enabled = true;
    this.ready = false;
    this.failed = null;
    this.active = false;
    // Zegar skał tej klatki (czas bezwzględny z gry — world.time).
    this.time = 0;
    this._gpuPromise = null;
    // Wejście klatki z index.html (render): dt gry (0 w pauzie), statki do świateł.
    this._in = { time: 0, dt: 0, ship: null, player2: null, npcs: null, prepared: false };
    this._view = { x: 0, y: 0, zoom: 1 };
    this._box3D = { x: 0, y: 0, halfW: 1, halfH: 1 };
    this._frame = { cam: this._view, viewW: 1, viewH: 1, focalPx: 1, time: 0, budgetMs: 0, fadeMinPx: 0 };
    this._mapFrame = { cam: this._view, viewW: 1, viewH: 1, focalPx: 1, originX: 0, originY: 0, sunT: null, field: this.field };
    this._volFrame = { camX: 0, camY: 0, zoom: 1, viewW: 1, viewH: 1, time: 0, originX: 0, originY: 0, fade: 1 };
    this._fogFrame = { cam: this._view, viewW: 1, viewH: 1, focalPx: 1, time: 0, sunX: this.sun.x, sunY: this.sun.y, originX: 0, originY: 0, sunOcc: true, fade: 1 };
    this._stormFrame = { cam: this._view, viewW: 1, viewH: 1, dt: 0, originX: 0, originY: 0 };
    this._stormOpts = { layer: null, zOf: null };
    this._giantFrame = { cam: this._view, viewW: 1, viewH: 1, dt: 0, originX: 0, originY: 0, sunT: 1 };
    this._giantFocus = { x: 0, y: 0, len: 1800 };
    this._originX = NaN;
    this._originY = NaN;
    // Tryb skoku pasa i udział prawdziwego widoku pola (zanik przy skoku gracza — WARP_FADE).
    this._warpMode = false;
    this._fade = 1;
    this._litShips = [];
    this._litDist = [];
    this._owners = new WeakMap();
    this._nextOwner = 1;
    this._shipLightOpts = { time: 0, owner: 0, shadows: null, spotShadows: true, floods: true, nav: true, profile: FIELD_SHIP_LIGHTS, strength: 1, pose: null };
    // ŚWIATŁA STATKÓW BEZ DRŻENIA (2026-10-29, zgłoszenie „snopy front i pomocnicze drżą” — _addShipLights):
    // lightsRenderPose — światła gracza w pozie renderu (tej, w której rysuje się kadłub; false = dawna poza fizyki);
    // navClock — faza poświaty lamp pozycyjnych z zegara klatki efektów jak billboardy i lampy kadłuba ('frame'; 'belt' =
    // dawny zegar skał, stoi w pauzie); lightDirTune — uchwyt A/B osi reflektorów bez zaokrąglenia (SHIP_LIGHT_DIR_TUNE,
    // shipLightRuntime.js — wszystkie statki, nie tylko pas).
    this.lightsRenderPose = true;
    this.navClock = 'frame';
    this.lightDirTune = SHIP_LIGHT_DIR_TUNE;
    this._flashes = [];
    this._flashPool = [];
    this._rockLightBox = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this._rockLightCount = 0;
    this._pendingViews = 0;
    // Wydobycie (zadanie 21b): fizyka skał + platforma gracza — świat pasa gry (powstają po
    // zdarzeniu bankRadius z initGpu); tu ich obraz (minedRocks.js, miningView.js).
    this.mined = null;
    this.miningView = null;
    this._takenVersion = -1;
    this._holeVersion = 0;
    this._minedFrame = { zoom: 1, originX: 0, originY: 0, camX: 0, camY: 0 };
    this._miningFrame = { dt: 0, time: 0, originX: 0, originY: 0, zoom: 1, ship: null, sunT: null };
    this._miningShip = { x: 0, y: 0 };
    this.sunT = (x, y) => nightKnee(this.occlusion.transmittance(x, y));
    // To samo pole na CPU dla Core3D.sunVisibilityAtWorld (diagnostyka narzędzi) — liczone tylko przy aktywnym
    // polu maski (setSunOcclusionField).
    Core3D.sunFieldCpu = this.sunT;
    this.stats = {
      active: false, cpuMs: 0, lights: 0, shipLights: 0, rockLights: 0, rocks: [0, 0, 0, 0], minerals: 0,
      shadowMaps: 0, shadowCasters: 0, volumeColumns: 0, storm: 0, strikes: 0, segments: 0, giantsReady: 0,
      pending: 0, fieldMapBuilds: 0, warpMode: false, fade: 1
    };
    this._step = {
      name: 'asteroidBelt',
      lights: (ctx) => this._lightsStep(ctx),
      update: (ctx) => this._updateStep(ctx),
      warm: (ctx) => this._warmStep(ctx)
    };
  }

  // ── Start ──────────────────────────────────────────────────────────────────

  /** Świat pasa gry: olbrzymy, fizyka skał i platforma (dane gry — w trybie `inline` wprost). */
  get giants() { return this.world.giants; }
  get mining() { return this.world.mining; }
  get rig() { return this.world.rig; }
  get precomputed() { return !!this.occlusion.precomputed; }

  /** Widok GPU olbrzyma (wpis świata pasa) albo null — narzędzia (zrzuty, asteroidy-gra). */
  giantView(entry) {
    return entry ? (this._giantViews.get(entry.id) || null) : null;
  }

  /**
   * Część GPU (po Core3D.ready): bank kształtów, szumy, materiały, warstwy, ośrodek,
   * mgła, burza, iskry, zasłona; krok klatki w Core3D.fx; rozgrzewka pipeline'ów.
   * Promise — wołane na ekranie ładowania (startGame), powtórne wywołanie zwraca to samo.
   */
  initGpu() {
    if (!this._gpuPromise) {
      this._gpuPromise = this._initGpu().catch((err) => {
        this.failed = err;
        console.error('[AsteroidBelt] start GPU nie wyszedł:', err?.stack || err);
        return false;
      });
    }
    return this._gpuPromise;
  }

  async _initGpu() {
    const ok = await Core3D.ready;
    if (!ok || !Core3D.renderer) return false;
    const renderer = Core3D.renderer;
    const fx = Core3D.fx;
    this.renderer = renderer;
    this.grid = fx.grid;
    this.grid.shadows = this.atlas;
    const t0 = performance.now();
    this.bank = await new RockShapeBankGPU().bake(renderer);
    const noise = createRockNoiseVolume(renderer, 64);
    const shared = createRockShared(this.bank, noise);
    shared.noise = noise;
    shared.volume = this.medium;
    shared.rockLayerTop.value = this.cfg.rockLayerTop;
    this.shared = shared;
    // Grupa pola: stoi na początku pola (Core3D.fx.origin), dzieci lokalnie.
    const root = new THREE.Group();
    root.name = 'AsteroidBelt';
    root.matrixAutoUpdate = true;
    this.root = root;
    const playMaterial = new RockNodeMaterial({ shared, backdrop: false });
    this.playMaterial = playMaterial;
    this.atlas.attachCasters({ bank: this.bank, source: playMaterial });
    this.fieldMap = new FieldMap();
    this.volume = new VolumeLight({ renderer, grid: this.grid, fieldMap: this.fieldMap, parent: root, layer: BELT_LAYER_PLAY });
    // Czubek skały gry pod płaszczyzną: kadłuby (z = 0) zawsze nad skałą; skały
    // z minerałami sięgają dalej (czubki kryształów ~1,6 promienia).
    this.playZ = beltPlayZ;
    this.mineralTemplates = new MineralTemplates(this.bank);
    const mineralMat = new MineralMaterial({ shared, layer: playMaterial.L, grid: this.grid, minRockPx: 9 });
    this.playMinerals = new MineralLayer({
      parent: root, layer: BELT_LAYER_PLAY, templates: this.mineralTemplates, material: mineralMat,
      renderOrder: RENDER_ORDER.minerals, name: 'AsteroidBelt:minerals'
    });
    this.layers = [];
    this.playLayer = new RockLayer({
      parent: root, layer: BELT_LAYER_PLAY, bank: this.bank, material: playMaterial, field: this.field, bandIndex: BELT_BAND.PLAY,
      perspective: false, renderOrder: RENDER_ORDER.rocks, zOf: this.playZ, minPx: 0.7, maxLod: 5, sunT: this.sunT, minerals: this.playMinerals
    });
    this.layers.push(this.playLayer);
    [BELT_BAND.RUBBLE, BELT_BAND.MID, BELT_BAND.DEEP].forEach((band, i) => {
      this.layers.push(new RockLayer({
        parent: root, layer: BELT_LAYER_BACK, bank: this.bank, material: new RockNodeMaterial({ shared, backdrop: true }), field: this.field,
        bandIndex: band, perspective: true, renderOrder: RENDER_ORDER.backRocks + i * RENDER_ORDER.backBandStep,
        renderOrderOld: RENDER_ORDER.backRocksOld, minPx: 0.8, fadeZoom: BACK_FADE[band], maxLod: 3, sunT: this.sunT
      }));
    });
    // Znaczek głębi skał gry przed passem tła (Core3D.addPassDepthStamp — rejestracja po dodaniu pola do sceny).
    this._stamp = this._createPlayStamp(playMaterial);
    this.veil = new BeltVeil({ parent: root, layer: BELT_LAYER_BACK });
    this.glow = new GlowSprites({ parent: root, capacity: 4096, layer: BELT_LAYER_PLAY });
    this.sparks = new Sparks({ renderer, parent: root, layer: BELT_LAYER_PLAY });
    this.storm = new StormSystem({ parent: root, layer: BELT_LAYER_PLAY, field: this.field, shared, sparks: this.sparks });
    this.fog = new BeltFog({ renderer, bgParent: root, fgParent: root, bgLayer: BELT_LAYER_BACK, fgLayer: BELT_LAYER_PLAY, field: this.field, grid: this.grid, fieldMap: this.fieldMap });
    // Wydobycie (zadanie 21b): fizyka skał liczy siatki ciał z promienia kształtów banku
    // (odczyt CPU po pieczeniu) — zdarzenie bankRadius do świata pasa gry, który dopiero teraz
    // tworzy fizykę skał i platformę; platforma bierze skały z pola GRY (te same, które rysuje
    // warstwa PLAY z pola obrazu) — przejęte id chowa warstwa (zbiór `taken` platformy).
    this.world.attachShapeRadius({ maps: this.bank.radiusMaps, size: this.bank.readbackSize });
    this.playLayer.hidden = this.rig.taken;
    this.mined = new MinedRocks({
      renderer, parent: root, layer: BELT_LAYER_PLAY, bank: this.bank, shared, playMaterial, grid: this.grid,
      mining: this.mining, mineralTemplates: this.mineralTemplates, shadows: this.atlas, sunT: this.sunT,
      onUploaded: (body) => this.world.ackMinedUpload(body)
    });
    this.miningView = new MiningView({ parent: root, layer: BELT_LAYER_PLAY, shared, grid: this.grid, sparks: this.sparks });
    this.miningView.attach(this.rig);
    // Górnicy NPC w bańce (E24): lasery na skałach pola obrazu (warstwa PLAY), bez skał przejętych przez platformę.
    this.miningView.setNpcField(this.field, BELT_BAND.PLAY, this.rig.taken);
    // Pieczenie światła olbrzymów: JEDEN kernel compute dla wszystkich widoków (pipeline compute powstaje synchronicznie —
    // rozgrzewka pustym dispatchem w _prewarmCompute; dawniej kernel na olbrzyma kompilował się w klatce jego pierwszego widoku).
    this.giantBake = new GiantBakeKernel();
    Core3D.scene.add(root);
    if (typeof Core3D.addPassDepthStamp === 'function') Core3D.addPassDepthStamp('bg', this._stamp);
    // Początek pul: pole trzyma go, dopóki coś jest wczytane; żywe iskry przesuwa kernel.
    const origin = fx.origin;
    this._originEntry = origin.register({ isLive: () => this.active });
    this._sparksEntry = origin.register({
      shiftNode: createShiftKernel(origin, { buffer: this.sparks.pos, capacity: SPARK_CAP, stride: 1, pos: [[0, 'xy']], name: 'beltSparkShift' }),
      isLive: () => this.sparks.alive
    });
    this.initMs = performance.now() - t0;
    this.ready = true;
    await this._prewarm();
    Core3D.addFxStep(this._step);
    this.gpuMs = performance.now() - t0;
    return true;
  }

  // Rozgrzewka pipeline'ów (PLAN §6): compileAsync odtwarza pass — obiekty widoczne,
  // cel composerTarget, kamera passa z warstwą. Siatki pola są ukryte do pierwszej
  // klatki w polu: na czas kompilacji widoczne (bez instancji nic nie rysują).
  // Wpisy rejestru rozgrzewki (Core3D.warmup.run, zadanie 11): czas CPU i pipeline'y
  // każdej części w statystykach, flush() ekranu ładowania czeka na nie.
  async _prewarm() {
    const root = this.root;
    const reg = Core3D.warmup;
    const run = (name, fn) => (reg && typeof reg.run === 'function' ? reg.run(name, fn) : fn());
    // Siatki wydobycia (zadanie 21b) osobnym wpisem — w passach pola zostają ukryte.
    const mining = new Set();
    const addMining = (list) => {
      for (let i = 0; i < list.length; i++) list[i].traverse((o) => { if (o.isMesh) mining.add(o); });
    };
    if (this.mined) addMining(this.mined.warmupMeshes());
    if (this.miningView) addMining(this.miningView.warmupMeshes());
    const withShown = (pick, fn) => {
      const shown = [];
      root.traverse((o) => {
        if (o.isMesh && o.visible === false && pick(o)) { o.visible = true; shown.push(o); }
      });
      try {
        return fn();
      } finally {
        for (let i = 0; i < shown.length; i++) shown[i].visible = false;
      }
    };
    const promises = [];
    promises.push(run('pas asteroid: skały, minerały, mgła, burza, iskry (passy PLAY i BACK)', () => withShown((o) => !mining.has(o), () => Promise.all([
      Core3D.prewarmPass(root, BELT_LAYER_PLAY),
      Core3D.prewarmPass(root, BELT_LAYER_BACK)
    ]))));
    if (mining.size) {
      promises.push(run('pas asteroid: wydobycie (skały z wycięciami, wnętrze, minerały, okruchy, drony, wiązki)', () => withShown((o) => mining.has(o), () => {
        const list = [];
        for (const mesh of mining) list.push(Core3D.prewarmPass(mesh, BELT_LAYER_PLAY));
        return Promise.all(list);
      })));
    }
    // Znaczek głębi skał gry (własna scena bez świateł, kamera passa gry, cel sceny — jak rysunek przed passem tła).
    if (this._stamp) {
      promises.push(run('pas asteroid: znaczek głębi skał gry (przed passem tła)', () => {
        const meshes = this._stamp.pairs.map((p) => p[1]);
        for (const m of meshes) m.visible = true;
        try {
          return Core3D.prewarmPass(this._stamp.scene, 0, { ortho: true });
        } finally {
          for (const m of meshes) m.visible = false;
        }
      }));
    }
    promises.push(run('pas asteroid: atlas cieni reflektorów (wszystkie mapy, cień skał w wydobyciu)', () => this._prewarmShadowAtlas()));
    run('pas asteroid: kernele compute (ośrodek, iskry, atlas wydobycia, pieczenie światła olbrzymów)', () => this._prewarmCompute());
    await Promise.all(promises);
  }

  // Atlas map cienia (własny cel i scena): WSZYSTKIE mapy naraz — każda ma własny materiał
  // cienia (pozycja lampy), więc osobną budowę NodeBuilder; rozgrzana tylko mapa 0 zostawiała
  // 5 budów przy pierwszym wejściu w pole (zadanie 11: shadowCasters_2–6, ~12 ms). Do tego
  // siatki cienia skał w wydobyciu (materiał cienia w trybie wycięć — zadanie 21b).
  _prewarmShadowAtlas() {
    const renderer = this.renderer;
    const atlas = this.atlas;
    const maps = atlas.maps;
    if (!atlas.casters || !maps.length || !maps[0].mesh) return false;
    const prev = renderer.getRenderTarget();
    const setVisible = (v) => {
      for (let i = 0; i < maps.length; i++) {
        maps[i].mesh.visible = v;
        if (maps[i].carved) maps[i].carved.mesh.visible = v;
      }
    };
    try {
      setVisible(true);
      renderer.setRenderTarget(atlas.rt);
      return compileAsyncNaCelu(renderer, atlas.scene, maps[0].cam).catch((err) => {
        console.warn('[AsteroidBelt] rozgrzewka atlasu cieni nie wyszła:', err?.message || err);
        return false;
      });
    } catch (err) {
      console.warn('[AsteroidBelt] rozgrzewka atlasu cieni nie wyszła:', err?.message || err);
      return false;
    } finally {
      setVisible(false);
      renderer.setRenderTarget(prev);
    }
  }

  // Kernele compute: puste dispatche (liczniki w uniformach = 0, krok iskier z dt = 0).
  _prewarmCompute() {
    const renderer = this.renderer;
    try {
      // Ośrodek: oba kernele (lista świateł kolumny i dawna pętla komórki — przełącznik A/B VOLUME_LIGHT_TUNE).
      for (const node of this.volume.computeNodes()) renderer.compute(node, 1);
      const S = this.sparks.U;
      S.count.value = 0;
      renderer.compute(this.sparks.spawnNode, 1);
      // Krok iskier (burza, cięcie, wybuchy — zadanie 11: jeden compute na zimno w burzy).
      // dt = 0 niczego nie zmienia (pula po czyszczeniu i tak martwa).
      const dt = S.dt.value;
      S.dt.value = 0;
      renderer.compute(this.sparks.stepNode);
      S.dt.value = dt;
      // Kopiowanie siatek ciał do atlasu wydobycia (licznik 0 — sam pipeline).
      this.mined?.warm();
    } catch (err) {
      console.warn('[AsteroidBelt] rozgrzewka compute nie wyszła:', err?.message || err);
    }
    // Pieczenie światła olbrzymów (licznik wątków 0 — sam pipeline; olbrzymy powstają w grze, przy punktach uwagi) —
    // osobno: błąd rozgrzewki ośrodka czy iskier nie może jej pominąć (kompilacja wróciłaby do klatki pierwszego widoku).
    try {
      this.giantBake?.warm(renderer);
    } catch (err) {
      console.warn('[AsteroidBelt] rozgrzewka pieczenia olbrzymów nie wyszła:', err?.message || err);
    }
  }

  _warmStep() {
    // Rozgrzewka zrobiona w _prewarm (krok rejestrowany po niej).
  }

  // ── Klatka ─────────────────────────────────────────────────────────────────

  /**
   * Wejście klatki (index.html, render(), przed Core3D.render): zegar skał (czas bezwzględny
   * świata pasa — world.time), dt klatki (world.frameDt: 0 w pauzie) i statki do świateł pola.
   * Bez alokacji — zapamiętane referencje.
   */
  /**
   * Górnicy NPC w bańce (E24): ramka pracy statków ruchu z bloku `trafficWork` (`{ list, count }`; rodzaj MINE —
   * drony i lasery platformy na skałach pola). Strona (`off`) i worker renderu wołają ją przed `Core3D.render`.
   */
  setNpcWork(frame) {
    this.miningView?.setNpcWork(frame);
  }

  prepareFrame(time, dt, ship, player2, npcs) {
    this._lensGiants();
    const i = this._in;
    i.time = Number(time) || 0;
    // dt SUMOWANE do zużycia przez krok pasa (raz na klatkę rAF Core3D.fx): kilka klatek gry na jedną klatkę rAF
    // (harness dema: runFrames) nie gubi czasu iskier i burzy.
    i.dt = (i.prepared ? i.dt : 0) + Math.max(0, Number(dt) || 0);
    i.ship = ship || null;
    i.player2 = player2 || null;
    i.npcs = npcs || null;
    i.prepared = true;
  }

  setEnabled(v) {
    this.enabled = !!v;
  }

  /**
   * ZNACZEK GŁĘBI SKAŁ GRY przed passem tła (2026-10-29, pole asteroid przy 5120 × 1440 — Core3D.addPassDepthStamp):
   * skały pasma PLAY (koszyki skał i księżyców — te same geometrie i instancje) rysowane kamerą passa gry tylko do głębi
   * celu sceny z głębią 0, pomniejszone względem środka (RockDepthStampMaterial — ściśle wewnątrz pokrycia skały).
   * Skały tła, głębokie płaty mgły i zasłona (test głębi) nie liczą fragmentów pod skałami gry, które pass gry i tak
   * zasłania w całości (skała gry nieprzezroczysta, bez odrzucania pikseli). Obraz ten sam. A/B: belt.stampEnabled =
   * false (pas), Core3D.depthStamps = false (wszystkie znaczki).
   */
  _createPlayStamp(playMaterial) {
    const material = new RockDepthStampMaterial(playMaterial, PLAY_STAMP_SHRINK);
    const scene = new THREE.Scene();
    scene.name = 'AsteroidBelt:znaczekGlebiGry';
    const group = new THREE.Group();
    group.name = 'AsteroidBelt:znaczekGlebiGry:pole';
    group.matrixAutoUpdate = false;
    scene.add(group);
    const pairs = [];
    for (const bk of [this.playLayer.buckets, this.playLayer.moonBuckets]) {
      for (const L of bk.lods) {
        const mesh = new THREE.Mesh(L.geo, material);
        mesh.name = `AsteroidBelt:znaczek_${L.mesh.name}`;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        group.add(mesh);
        pairs.push([L.mesh, mesh]);
      }
    }
    this.stampEnabled = true;
    this.stampStats = { renders: 0 };
    return { name: 'pas asteroid: skały gry', scene, group, pairs, material, active: () => this._stampActive() };
  }

  // Wołane przez Core3D przed passem tła tego renderu: widoczność koszyków PLAY (po kompaktowaniu i księżycach z kroku
  // pola) i położenie grupy pola; false — bez znaczka (pole nieaktywne, warstwa PLAY ukryta, puste koszyki).
  _stampActive() {
    const st = this._stamp;
    if (!st || this.stampEnabled === false || !this.ready || !this.active || !this._frameActive || !this.playLayer.enabled) return false;
    let any = false;
    for (let i = 0; i < st.pairs.length; i++) {
      const v = st.pairs[i][0].visible === true;
      st.pairs[i][1].visible = v;
      if (v) any = true;
    }
    if (!any) return false;
    st.group.matrix.copy(this.root.matrixWorld);
    st.group.matrixWorldNeedsUpdate = true;
    this.stampStats.renders++;
    return true;
  }

  /**
   * Kolejka skał (rockLayers.js ROCK_LOD_ORDER): bigFirst — koszyki największych na ekranie pierwsze, pasma tła bliższe
   * pierwsze, skały tła w oknie przed zasłoną (BELT_RENDER_ORDER, domyślnie); false — DOKŁADNIE dawna kolejka sprzed
   * 2026-10-29: renderOrder warstw backRocksOld (tło, 2) / rocks (gra, 1) w każdym koszyku skał i księżyców. A/B w biegu,
   * bez nowych pipeline'ów (renderOrder nie wchodzi do klucza). Sama dawna kolejka stawia skały tła ZA nową zasłoną (−0,1)
   * — zasłona liczy się też pod nimi (obraz ten sam: skała tła bez mieszania nadpisuje ją); dawny obraz passa tła
   * w całości: razem z veil.setDepthCull(false).
   */
  setRockOrder(bigFirst = true) {
    ROCK_LOD_ORDER.bigFirst = bigFirst !== false;
    for (const layer of this.layers) layer.applyOrder();
  }

  // Kadr pola: kamera gracza 1 (Core3D.activeCam1), w podzielonym ekranie suma kadrów
  // obu graczy (zoom mniejszy — LOD grubszy). Zwraca false dla wolnej kamery 3D.
  _computeView() {
    const cam1 = Core3D.activeCam1;
    if (!cam1) return false;
    const target = Core3D.composerTarget;
    const bufW = Math.max(1, target ? target.width : 1);
    const bufH = Math.max(1, target ? target.height : 1);
    const v = this._view;
    if (Core3D.isFreePerspectiveCamera(cam1)) return this._computeView3D(cam1, bufW, bufH);
    // px bufora na j. świata (kadr = bufor / zoom; skala renderu z opcji grafiki — Core3D.viewZoom).
    const z1 = Core3D.viewZoom(cam1);
    let x = Number(cam1.x) || 0;
    let y = Number(cam1.y) || 0;
    let zoom = z1;
    // Obrócony kadr (cam.roll — viewRoll.js, obrót kursem w skoku): pole liczy pudło osi świata obejmujące go
    // (warstwy, mapa pola, mgła, zasłona) — bez tego rogi kadru zostawały bez skał, a brzeg zasłony wchodził w kadr.
    const rh = rolledHalfExtents(bufW * 0.5, bufH * 0.5, cameraRoll(cam1), this._rollHalf || (this._rollHalf = { hw: 0, hh: 0 }));
    let viewW = rh.hw * 2;
    let viewH = rh.hh * 2;
    const split = !!RenderWorld.splitScreenMode;
    const cam2 = split ? RenderWorld.camera2 : null;
    if (cam2 && !Core3D.isFreePerspectiveCamera(cam2)) {
      const z2 = Core3D.viewZoom(cam2);
      const x2 = Number(cam2.x) || 0;
      const y2 = Number(cam2.y) || 0;
      const hw1 = bufW * 0.5 / z1; const hh1 = bufH * 0.5 / z1;
      const hw2 = bufW * 0.5 / z2; const hh2 = bufH * 0.5 / z2;
      const x0 = Math.min(x - hw1, x2 - hw2); const x1 = Math.max(x + hw1, x2 + hw2);
      const y0 = Math.min(y - hh1, y2 - hh2); const y1 = Math.max(y + hh1, y2 + hh2);
      x = (x0 + x1) * 0.5;
      y = (y0 + y1) * 0.5;
      zoom = Math.min(z1, z2);
      viewW = (x1 - x0) * zoom;
      viewH = (y1 - y0) * zoom;
    }
    v.x = x;
    v.y = y;
    v.zoom = zoom;
    const fovDeg = Number(Core3D.cameraPersp?.fov) || 35;
    const focal = (bufH * 0.5) / Math.tan((fovDeg * Math.PI / 180) * 0.5);
    const f = this._frame;
    f.viewW = viewW;
    f.viewH = viewH;
    f.focalPx = focal;
    return true;
  }

  /** Czy kadr (z paralaksą najgłębszego pasma tła) dotyka pasa. */
  // Gra 3D (free3d): widok pola = prostokąt płaszczyzny gry pod stożkiem kamery (View3D.groundBox, zasięg z odległości
  // kamery) jako równoważny widok z góry — koszyki skał i LOD liczą się jak w kamerze klasycznej o tym zasięgu;
  // rysuje prawdziwa kamera perspektywy (skały, mgła i ośrodek są bryłami w świecie).
  _computeView3D(cam1, bufW, bufH) {
    if (!View3D.active) return false;
    const fovDeg = Number(Core3D.cameraPersp?.fov) || 35;
    const focal = (bufH * 0.5) / Math.tan((fovDeg * Math.PI / 180) * 0.5);
    const z1 = Math.max(1e-4, Number(cam1.zoom) || 1);
    const dist = (bufH * 0.5 / Math.tan(17.5 * Math.PI / 180)) / z1;
    const reach = Math.min(90000, Math.max(24000, dist * 6));
    const b = View3D.groundBox(reach, this._box3D);
    const w = Math.max(1, b.halfW * 2);
    const h = Math.max(1, b.halfH * 2);
    const zoom = Math.max(1e-4, Math.min(bufW / w, bufH / h));
    const v = this._view;
    v.x = b.x;
    v.y = b.y;
    v.zoom = zoom;
    const f = this._frame;
    f.viewW = w * zoom;
    f.viewH = h * zoom;
    f.focalPx = focal;
    return true;
  }

  _viewTouchesBelt() {
    const v = this._view;
    const f = this._frame;
    const camZ = f.focalPx / v.zoom;
    const spread = (camZ + 26000) / camZ;
    const hw = f.viewW * 0.5 / v.zoom * spread * 1.3;
    const hh = f.viewH * 0.5 / v.zoom * spread * 1.3;
    return this.field.rectTouchesBelt(v.x - hw, v.y - hh, v.x + hw, v.y + hh);
  }

  _deactivate() {
    if (!this.active && this._cleared) return;
    this.active = false;
    this._cleared = true;
    for (const layer of this.layers) {
      layer.clear();
      // Zanik pola (WARP_FADE) podnosi próg pikseli materiału warstwy — ten sam materiał gry rysuje skałę NEA i okruchy
      // wydobycia (RockSet), więc pole bez kadru zostawia próg bazowy.
      layer.material.L.minPx.value = layer.minPx;
    }
    this.fog.hideAll();
    this.volume.disable();
    // Burza: pioruny i rozbłyski skał wyczyszczone, system zostaje włączony (wraca z polem).
    this.storm.setVisible(false);
    this.storm.setVisible(true);
    this.veil.setVisible(false);
    this.glow.begin();
    this.glow.commit();
    this.atlas.clear();
    for (const view of this._giantViews.values()) view.setVisible(false);
    // Wydobycie: ciała zostają w fizyce, obraz znika z kadrem.
    this.mined?.hide();
    this.miningView?.hide();
    Core3D.clearSunOcclusionField();
    this.stats.active = false;
  }

  _lightsStep(ctx) {
    if (!this.ready) return;
    const t0 = performance.now();
    const input = this._in;
    const dt = input.prepared ? input.dt : 0;
    if (input.prepared) this.time = input.time;
    input.prepared = false;
    this._dt = dt;
    const viewOk = this.enabled && this._computeView();
    // TRYB SKOKU PASA (WARP_MODE_*): pas w skoku nie jest rysowany — pole wyłączone; w ładowaniu skoku gracza gaśnie
    // z β soczewki (puste na końcu ładowania), po trybie skoku wraca w WARP_FIELD_FADE.reveal s (_stepWarpFade).
    const stretch = Number(WARP_STARS.stretch.value) || 0;
    const camSpeed = viewOk ? this._trackCameraSpeed(dt) : 0;
    const lensVis = this._lensVisibility();
    this._warpMode = (stretch > WARP_MODE_STRETCH && camSpeed > (this._warpMode ? WARP_MODE_OFF : WARP_MODE_ON))
      || lensVis < WARP_FADE.hidden;
    const fade = this._stepWarpFade(this._warpMode ? 0 : lensVis, dt);
    this.stats.warpMode = this._warpMode;
    this.stats.fade = fade;
    if (viewOk && this._warpMode) {
      this._deactivate();
      this._frameActive = false;
      this.stats.cpuMs = performance.now() - t0;
      return;
    }
    const touches = viewOk && this._viewTouchesBelt();
    if (!touches) {
      this._deactivate();
      this._frameActive = false;
      this.stats.cpuMs = performance.now() - t0;
      return;
    }
    this._cleared = false;
    this.active = true;
    this._frameActive = true;
    this.stats.active = true;
    const origin = ctx.origin;
    // Początek pola: scena → świat gry (y odwrócone). Przeskok = przepisanie danych.
    const ox = origin.x;
    const oy = -origin.y;
    if (ox !== this._originX || oy !== this._originY) {
      this._originX = ox;
      this._originY = oy;
      for (const layer of this.layers) layer.setOrigin(ox, oy);
      this.fieldMap.invalidate();
      this.root.position.set(origin.x, origin.y, 0);
      this.root.updateMatrixWorld(true);
    }
    this.medium.setOrigin(origin.x, origin.y);
    const v = this._view;
    const f = this._frame;
    this._updateSun();
    this.shared.time.value = this.time;
    // Skały przejęte przez wydobycie (wspólny zbiór `hidden` warstwy PLAY i platformy):
    // zmiana zbioru = przebudowa koszyków warstwy.
    const rig = this.rig;
    if (rig && rig.takenVersion !== this._takenVersion) {
      this._takenVersion = rig.takenVersion;
      this.playLayer._version++;
    }
    // Skały: komórki z budżetem (BELT_LOAD_BOOST — wspólny budżet klatki dzielony wagą zaległości warstw, rośnie
    // z prędkością kamery), LOD per skała.
    f.time = this.time;
    f.fadeMinPx = warpFadeMinPx(fade, v.zoom);
    const layers = this.layers;
    let wsum = 0;
    for (let i = 0; i < layers.length; i++) wsum += 1 + layers[i].stats.pending;
    const loadEnd = performance.now() + beltLoadBudgetMs(this.cfg.budgetMs, camSpeed);
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const w = 1 + layer.stats.pending;
      f.budgetMs = Math.max(0, loadEnd - performance.now()) * w / wsum;
      wsum -= w;
      layer.update(f);
    }
    this.field.endFrame(this.cfg.maxCachedCells);
    // Skały w wydobyciu: atlas siatek ciał (wysyłka zmian), instancje zewnętrza i wnętrza,
    // okruchy — przed zbieraniem rzucających cień.
    if (this.mined) {
      const mf = this._minedFrame;
      mf.zoom = v.zoom; mf.originX = ox; mf.originY = oy; mf.camX = v.x; mf.camY = v.y;
      this.mined.update(mf);
    }
    // Olbrzymy: widoki GPU gotowych siatek (budowę zleca świat pasa gry), przekrój pod stropem.
    this._updateGiants(dt, ox, oy);
    // Mapa pola nad kadrem (słońce, pył, lód, burze): mgła, ośrodek, maska Core3D. Nowe wyrwy (field.setHoles):
    // mapa od nowa — pył rzednie, a cień pól przeliczył świat pasa gry przed operacją dla repliki.
    if ((this.field.holeVersion || 0) !== this._holeVersion) {
      const seen = this._holeVersion;
      this._holeVersion = this.field.holeVersion || 0;
      // Mapa (lokalnie, y w górę) → świat gry; z klinem cienia pól za wyrwą (kanał R = słońce).
      const r = this.fieldMap.rect;
      if (this.fieldMap.valid && this.field.holesTouch(seen, r.x0 + ox, -(r.y0 + r.h) + oy, r.x0 + r.w + ox, -r.y0 + oy, true)) {
        this.fieldMap.invalidate();
      }
    }
    const mf = this._mapFrame;
    mf.viewW = f.viewW; mf.viewH = f.viewH; mf.focalPx = f.focalPx;
    mf.originX = ox; mf.originY = oy;
    mf.sunT = this.sunT;
    this.fieldMap.update(mf);
    const fg = this._fogFrame;
    fg.viewW = f.viewW; fg.viewH = f.viewH; fg.focalPx = f.focalPx;
    fg.time = this.time; fg.originX = ox; fg.originY = oy;
    fg.fade = fade;
    this.fog.update(fg);
    // Burza (przed światłami: łańcuchy świateł kanałów).
    const sf = this._stormFrame;
    sf.viewW = f.viewW; sf.viewH = f.viewH; sf.dt = dt; sf.originX = ox; sf.originY = oy;
    this._stormOpts.layer = this.playLayer;
    this._stormOpts.zOf = this.playZ;
    this.storm.fade = fade;
    this.storm.update(sf, this._stormOpts);
    // Światła pola do siatki gry (początek siatki = początek pola).
    const grid = ctx.grid;
    const atlas = this.atlas;
    atlas.begin();
    const shipLights = this._addShipLights(grid);
    atlas.gather(this.playLayer);
    if (this.mined) atlas.gatherCarved(this.mined.shadowData, this.mined.shadowCount);
    this.storm.addLights(grid, ox, oy);
    this._addRockLights(grid, ox, oy);
    this.miningView?.addLights(grid, ox, oy, this.time);
    const st = this.stats;
    st.shipLights = shipLights;
    st.cpuMs = performance.now() - t0;
  }

  _updateStep(ctx) {
    if (!this.ready || !this._frameActive) {
      // Iskry gasną także poza polem (krok compute tylko przy żywych).
      if (this.ready && this.sparks.alive) this.sparks.update(this._dt || 0, this._view.zoom);
      return;
    }
    const t0 = performance.now();
    const renderer = ctx.renderer;
    const v = this._view;
    const f = this._frame;
    const ox = this._originX;
    const oy = this._originY;
    // Mapy cienia reflektorów (po zebraniu rzucających), potem ośrodek (czyta siatkę i atlas).
    this.atlas.render(renderer);
    const vf = this._volFrame;
    vf.camX = v.x - ox; vf.camY = -(v.y - oy);
    vf.zoom = v.zoom; vf.viewW = f.viewW; vf.viewH = f.viewH; vf.time = this.time;
    vf.originX = ox; vf.originY = oy;
    vf.fade = this._fade;
    this.volume.update(vf);
    this.volume.compute();
    // Platforma wydobywcza: drony, wiązki, iskry cięcia i zdarzenia (przed krokiem iskier).
    if (this.miningView) {
      const mv = this._miningFrame;
      const ship = this._in.ship;
      mv.dt = this._dt; mv.time = this.time; mv.originX = ox; mv.originY = oy; mv.zoom = v.zoom;
      mv.ship = ship && ship.pos ? this._shipRenderPoint(ship, this._miningShip) : null;
      mv.sunT = this.sunT;
      this.miningView.update(mv);
    }
    this.sparks.update(this._dt, v.zoom);
    // Duszki: błyski i żar w miejscach uderzeń piorunów, żar cięcia i ładunki wydobycia.
    this.glow.begin();
    this.storm.addGlows(this.glow, ox, oy);
    this.miningView?.addGlows(this.glow, ox, oy);
    this.glow.commit();
    this._updateVeil();
    // Pole przesłaniające maski słońca Core3D (kadłuby, odłamki: sunVisibility / sunFill)
    // — mapa pola (R = nightKnee(T)) w układzie sceny (początek + prostokąt lokalny).
    const m = this.fieldMap.rect;
    // Siła pola × zanik pola przy skoku gracza (WARP_FADE): kadłub nie ciemnieje przed skałami po powrocie pola.
    if (m.valid) Core3D.setSunOcclusionField(this.fieldMap.texture, ctx.origin.x + m.x0, ctx.origin.y + m.y0, m.w, m.h, this._fade);
    this.root.updateMatrixWorld(true);
    const st = this.stats;
    st.cpuMs += performance.now() - t0;
    st.lights = ctx.grid.stats.lights;
    for (let i = 0; i < this.layers.length; i++) st.rocks[i] = this.layers[i].stats.drawn;
    st.minerals = this.playMinerals.stats.drawn;
    st.shadowMaps = this.atlas.stats.maps;
    st.shadowCasters = this.atlas.stats.casters;
    st.volumeColumns = this.volume.stats.columns;
    st.storm = this.storm.intensity;
    st.strikes = this.storm.stats.strikes;
    st.segments = this.storm.stats.segments;
    st.giantsReady = this.giants.readyCount;
    let pending = 0;
    for (let i = 0; i < this.layers.length; i++) pending += this.layers[i].stats.pending;
    st.pending = pending;
    st.fieldMapBuilds = this.fieldMap.builds;
  }

  /** Udział prawdziwego widoku pola w skoku gracza: warpFieldVisibility (1 − β / chargeBeta; bez soczewki — 1). */
  _lensVisibility() {
    const L = WARP_WORLD_LENS;
    return warpFieldVisibility(L.active, L.beta);
  }

  // Zanik pola (stepWarpFieldFade): w dół razem z celem (β soczewki w ładowaniu jest gładka), w górę najwyżej
  // 1 / reveal na s (powrót po trybie skoku, przerwane ładowanie). Pauza (dt = 0) trzyma stan.
  _stepWarpFade(target, dt) {
    this._fade = stepWarpFieldFade(this._fade, target, dt);
    return this._fade;
  }

  // Prędkość kamery kadru [j/s] (wygładzona ~0,1 s) — tryb skoku. Skok pozycji szybszy niż WARP_CUT_SPEED (teleport,
  // cięcie kamery) zeruje odczyt zamiast udawać przelot.
  _trackCameraSpeed(dt) {
    const v = this._view;
    if (Number.isFinite(this._prevViewX) && dt > 0) {
      const ddx = v.x - this._prevViewX;
      const ddy = v.y - this._prevViewY;
      const sp = Math.sqrt(ddx * ddx + ddy * ddy) / dt;
      if (sp > WARP_CUT_SPEED) this._camSpeed = 0;
      else this._camSpeed = (this._camSpeed || 0) + (sp - (this._camSpeed || 0)) * (1 - Math.exp(-dt / 0.1));
    }
    this._prevViewX = v.x;
    this._prevViewY = v.y;
    return this._camSpeed || 0;
  }

  // Kierunek do słońca (scena) podniesiony o kąt nad płaszczyzną — jak w skałach gry.
  _updateSun() {
    const v = this._view;
    const dx = this.sun.x - v.x;
    const dy = -(this.sun.y - v.y);
    const l = Math.hypot(dx, dy) || 1;
    const e = ROCK_LIGHT_DEFAULTS.sunElevDeg * Math.PI / 180;
    const sd = this.shared.sunDir.value;
    sd.set(dx / l * Math.cos(e), dy / l * Math.cos(e), Math.sin(e)).normalize();
    this.shared.sunOcc.value = 1;
    this.fog.U.sunOcc.value = 1;
  }

  /** Rekordy soczewki olbrzymów (co klatkę, także poza skokiem — gotowe na pierwszą klatkę soczewki). */
  _lensGiants() {
    const giants = this.world?.giants;
    if (!giants || !giants.entries) return;
    const map = this._giantLens || (this._giantLens = new Map());
    for (const e of giants.entries) {
      let rec = map.get(e.id);
      const R = Math.max(1, e.halfX, e.halfY);
      if (!rec) {
        rec = warpLensExtraBody(`giant:${e.id}`, 'small');
        rec.smudge = { r: GIANT_LENS_COLOR.r, g: GIANT_LENS_COLOR.g, b: GIANT_LENS_COLOR.b, ax: e.halfX / R, ay: e.halfY / R, rot: 0 };
        map.set(e.id, rec);
      }
      setWarpLensExtra(rec, e.x, e.y, R, 0);
    }
  }

  /** Olbrzym zastąpiony obrazem soczewki skoku (smuga w HexBodyLensBatch) — prawdziwy widok schowany. */
  _giantLensed(e) {
    const rec = this._giantLens ? this._giantLens.get(e.id) : null;
    const a = rec ? rec.anchor : null;
    return !!(a && a.on && 1 - a.real >= WARP_LENS_DOT_SWAP);
  }

  _updateGiants(dt, ox, oy) {
    const giants = this.giants;
    const v = this._view;
    const ship = this._in.ship;
    const gf = this._giantFrame;
    gf.viewW = this._frame.viewW; gf.viewH = this._frame.viewH; gf.dt = dt;
    gf.originX = ox; gf.originY = oy;
    const focus = this._giantFocus;
    const hasFocus = !!(ship && ship.pos && !ship.dead);
    if (hasFocus) {
      focus.x = ship.pos.x;
      focus.y = ship.pos.y;
      focus.len = Number(ship.w) > 0 ? Number(ship.w) : 1800;
    }
    const halfW = this._frame.viewW * 0.5 / v.zoom;
    const halfH = this._frame.viewH * 0.5 / v.zoom;
    let created = false;
    for (const e of giants.entries) {
      const giant = e.giant;
      if (!giant || !giant.ready) continue;
      let view = this._giantViews.get(e.id);
      if (!view) {
        // Jeden nowy widok na klatkę (wgranie siatki SDF + pieczenie światła + graf).
        if (created) continue;
        view = new GiantView({
          renderer: this.renderer, parent: this.root, layer: BELT_LAYER_PLAY, giant, noise: this.shared.noise,
          shared: this.shared, grid: this.grid, sun: this.sun, sunElevDeg: ROCK_LIGHT_DEFAULTS.sunElevDeg, bake: this.giantBake
        });
        this._giantViews.set(e.id, view);
        created = true;
        Core3D.prewarmPass(view.mesh, BELT_LAYER_PLAY);
      }
      // Widoczny, gdy obrys olbrzyma dotyka kadru (z zapasem).
      const vis = Math.abs(e.x - v.x) < halfW * 1.5 + e.halfX && Math.abs(e.y - v.y) < halfH * 1.5 + e.halfY
        && !this._giantLensed(e);
      view.setVisible(vis);
      if (!vis) continue;
      gf.sunT = this.sunT(e.x, e.y);
      view.update(gf, hasFocus ? focus : null);
    }
  }

  // Światła pola statków: reflektory dalekie (z mapą cienia), otoczenia (mapa na każdy),
  // światło dookoła, lampy pozycyjne — najbliższe środka kadru (budżet), w kadrze świateł.
  // Pod stropem olbrzyma profil jaskini (reflektory w dół, szersze światło dookoła).
  // POZA: światła stoją tam, gdzie rysuje się kadłub — gracz w pozie renderu (RenderWorld.playerPose: interpolacja między
  // krokami fizyki; kadłub, model, lampy kadłuba, billboardy i dysze gracza biorą tę samą). Dawniej poza końca kroku
  // fizyki z encji: przy 240 Hz obrazu i 60 Hz fizyki smugi, rozlewy reflektorów otoczenia i poświata lamp wyprzedzały
  // kadłub o (1 − α) · v / 60 i wracały co krok (piła 2,5 px przy 600 j/s, 12,9 px przy 3000 — zoom 0,34). NPC w workerze
  // mają już pozę renderu w lustrze, gracz 2 i NPC w trybie off — pozę kroku jak ich kadłuby (bez zmian).
  _addShipLights(grid) {
    const input = this._in;
    const v = this._view;
    const f = this._frame;
    const hw = f.viewW * 0.5 / v.zoom * this.cfg.lightBoxMul + this.cfg.lightBoxPad;
    const hh = f.viewH * 0.5 / v.zoom * this.cfg.lightBoxMul + this.cfg.lightBoxPad;
    const list = this._litShips;
    this._litN = 0;
    this._litHw = hw;
    this._litHh = hh;
    // Gracz zawsze pierwszy (odległość −1), potem P2 i NPC — najbliżsi środka kadru.
    if (input.ship && !input.ship.dead && !input.ship.destroyed) {
      list[0] = input.ship; this._litDist[0] = -1; this._litN = 1;
    }
    if (input.player2) this._considerShip(input.player2);
    const npcs = input.npcs;
    if (npcs) for (let i = 0; i < npcs.length; i++) this._considerShip(npcs[i]);
    const n = this._litN;
    const opts = this._shipLightOpts;
    // Faza poświaty lamp pozycyjnych w pyle: zegar klatki efektów (Core3D.frameNowMs — ten sam co billboardy lamp
    // i pętla lamp kadłuba, biegnie też w pauzie); 'belt' — dawny zegar skał (suma dt, w pauzie stoi).
    opts.time = this.navClock === 'belt' ? this.time : Core3D.frameNowMs() * 0.001;
    opts.shadows = this.atlas;
    // zanik pola przy skoku gracza (WARP_FADE): światła pola gasną razem z pyłem, który oświetlają
    opts.strength = this._fade;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      const len = getEntityHullLengthWorld(e) || Number(e.w) || (Number(e.radius) || 300) * 2;
      opts.owner = this._ownerOf(e);
      const pose = this.lightsRenderPose === false ? null : beltShipRenderPose(e);
      opts.pose = pose;
      const x = pose !== null ? pose.x : Number(e.pos?.x ?? e.x);
      const y = pose !== null ? pose.y : Number(e.pos?.y ?? e.y);
      opts.profile = this.world.roofAbove(x, y) ? CAVE_SHIP_LIGHTS : FIELD_SHIP_LIGHTS;
      opts.spotShadows = i < this.cfg.maxShadowShips;
      addShipLights(grid, e, len, opts);
      list[i] = null;
    }
    opts.pose = null;
    return n;
  }

  // Punkt statku dla obrazu przy kadłubie (wiązka ściągająca platformy wydobywczej): gracz w pozie renderu jak jego
  // światła (lightsRenderPose), reszta — poza encji. `out` — obiekt wołającego (bez alokacji).
  _shipRenderPoint(ship, out) {
    const pose = this.lightsRenderPose === false ? null : beltShipRenderPose(ship);
    out.x = pose !== null ? pose.x : ship.pos.x;
    out.y = pose !== null ? pose.y : ship.pos.y;
    return out;
  }

  // Wstawienie statku do posortowanej listy najbliższych środka kadru (bez alokacji).
  _considerShip(e) {
    if (!e || e.dead || e.destroyed || e.fighter) return;
    const v = this._view;
    const x = Number(e.pos?.x ?? e.x);
    const y = Number(e.pos?.y ?? e.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (Math.abs(x - v.x) > this._litHw || Math.abs(y - v.y) > this._litHh) return;
    const d = (x - v.x) * (x - v.x) + (y - v.y) * (y - v.y);
    const list = this._litShips;
    const dist = this._litDist;
    const max = this.cfg.maxLitShips;
    let n = this._litN;
    let at = n;
    while (at > 0 && dist[at - 1] > d) at--;
    if (at >= max) return;
    const last = Math.min(n, max - 1);
    for (let k = last; k > at; k--) { list[k] = list[k - 1]; dist[k] = dist[k - 1]; }
    list[at] = e;
    dist[at] = d;
    if (n < max) n++;
    this._litN = n;
  }

  /** Stały numer właściciela świateł statku (≥ 1) — dla materiałów pomijających własne lampy (18). */
  _ownerOf(e) {
    let id = this._owners.get(e);
    if (!id) {
      id = this._nextOwner++;
      this._owners.set(e, id);
    }
    return id;
  }

  // Świecące skały (kryształ, uran, energetyczna) przy kadrze = światła siatki; moc
  // rośnie z mrokiem pola (dynamics.js dema). Skały energetyczne pulsują.
  _addRockLights(grid, ox, oy) {
    const v = this._view;
    const f = this._frame;
    const hw = f.viewW * 0.5 / v.zoom * this.cfg.lightBoxMul + this.cfg.lightBoxPad;
    const hh = f.viewH * 0.5 / v.zoom * this.cfg.lightBoxMul + this.cfg.lightBoxPad;
    const b = this._rockLightBox;
    b.x0 = v.x - hw; b.x1 = v.x + hw; b.y0 = v.y - hh; b.y1 = v.y + hh;
    this._rockGrid = grid;
    this._rockOx = ox;
    this._rockOy = oy;
    this._rockLightCount = 0;
    if (!this._rockLightCb) this._rockLightCb = (rock) => this._rockLight(rock);
    this.playLayer.forEachLoaded(this._rockLightCb);
    this.stats.rockLights = this._rockLightCount;
  }

  _rockLight(rock) {
    const col = GLOW_ROCK[rock.type];
    if (!col || rock.r < 60) return;
    const b = this._rockLightBox;
    if (rock.x < b.x0 || rock.x > b.x1 || rock.y < b.y0 || rock.y > b.y1) return;
    const dark = 1 - this.sunT(rock.x, rock.y);
    const size = Math.min(1.4, Math.max(0.45, Math.sqrt(rock.r / 400)));
    let I = 0.75 * size * (0.3 + 0.7 * dark);
    // Zanik pola (WARP_FADE): światło maleje razem z bryłą (shader: smoothstep(minPx, 2 · minPx, promień px)).
    const fm = this._frame.fadeMinPx;
    if (fm > 0) {
      const t = Math.min(1, Math.max(0, (rock.r * this._view.zoom - fm) / fm));
      I *= t * t * (3 - 2 * t);
      if (!(I > 0.001)) return;
    }
    if (rock.type === 8) I *= 0.7 + 0.3 * Math.sin(this.time * (1.1 + (rock.seed * 7.1 % 1) * 1.4) + rock.seed * 43.7);
    // W pyle skała świeci lekko (halo wokół bryły).
    const i = this._rockGrid.add(rock.x - this._rockOx, -(rock.y - this._rockOy), rock.r * 0.25, Math.min(2600, rock.r * 4 + 400),
      col[0] * I, col[1] * I, col[2] * I, rock.type === 8 ? 0.1 : 0.12);
    if (i >= 0) this._rockLightCount++;
  }

  // Zasłona gęstego pola i noc (updateSky dema): gęstość pyłu przy kamerze, słońce przy
  // kamerze, kierunek słońca na ekranie, błyski burzy głęboko pod płaszczyzną.
  _updateVeil() {
    const v = this._view;
    const f = this._frame;
    const u = this.veil.u;
    const m = this.field.sampleMacro(v.x, v.y);
    const weight = m.weight;
    const cluster = m.cluster;
    const ice = m.ice || 0;
    const Tcam = this.sunT(v.x, v.y);
    const t = Math.min(1, Math.max(0, (cluster - 0.06) / (0.42 - 0.06)));
    // Wyrwa po wydobyciu rozrzedza zasłonę (m.hole); źródło gazu (m.gas — dziś 0) dołożyłoby swoją.
    const target = weight * t * t * (3 - 2 * t) * m.hole + m.gas;
    u.veil.value = Math.min(1, target * (0.85 + 0.15 * (1 - Tcam))) * this._fade;
    u.sunLevel.value = Tcam;
    u.ice.value = Math.min(1, ice);
    const dx = this.sun.x - v.x;
    const dy = -(this.sun.y - v.y);
    const l = Math.hypot(dx, dy) || 1;
    u.sunDir.value.set(dx / l, dy / l);
    u.offset.value.set(((v.x * 0.002) % 7000 + 7000) % 7000, ((v.y * 0.002) % 7000 + 7000) % 7000);
    this.veil.setVisible(u.veil.value > 0.002);
    // Błyski burzy pod płaszczyzną: pozycja na ekranie z paralaksą tła (bufor sceny).
    let n = 0;
    const flashes = this.storm.flashes;
    const camZ = f.focalPx / v.zoom;
    const target2 = Core3D.composerTarget;
    const W = target2 ? target2.width : f.viewW;
    const H = target2 ? target2.height : f.viewH;
    for (let i = 0; i < flashes.length && n < 4; i++) {
      const fl = flashes[i];
      const k = f.focalPx / (camZ + 6000);
      const q = this._flashPool[n] || (this._flashPool[n] = { sx: 0, sy: 0, r: 0, e: 0 });
      q.sx = (fl.x - v.x) * k + W * 0.5;
      q.sy = (fl.y - v.y) * k + H * 0.5;
      q.r = Math.max(120, fl.range * k * 0.6);
      q.e = fl.e;
      this._flashes[n] = q;
      n++;
    }
    this.veil.setFlashes(this._flashes, n);
  }

  // ── Narzędzia ──────────────────────────────────────────────────────────────

  /** Piorun na żądanie przy punkcie świata (narzędzia, harness): łuk między skałami. */
  forceStrike(x, y) {
    if (!this.ready || !this.storm || !this.playLayer) return false;
    return this.storm.forceStrike(this.playLayer, this.playZ, x, y);
  }
}

let _belt = null;

/** Pas gry (singleton, tworzony przy starcie świata — index.html). */
export function createAsteroidBelt(opts) {
  if (!_belt) _belt = new AsteroidBelt(opts);
  return _belt;
}

export function getAsteroidBelt() {
  return _belt;
}
