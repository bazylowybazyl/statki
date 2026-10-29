// src/3d/spaceGas/spaceGas.js
//
// GAZ W OTWARTEJ PRZESTRZENI — strona RENDERU (port dema dema/gazy-transport-webgpu.html, docs/PLAN-gazy-kosmos.md;
// wygląd zaakceptowany 2026-10-16, decyzje D1–D8 2026-10-22). Pierwsza scena: PAS ASTEROID (GK-5).
//
// Szew gra ↔ render (wzór pyłu hal K-7): gra pakuje WEJŚCIE (src/game/spaceGasInput.js → Float64Array SPACE_GAS_IN:
// kotwica, kamera, kadr, obwiednia pasa, wiatr, Słońce, odgazowanie skał, dt gry) → `SpaceGas.submit(tablica)`; kadłuby
// — wejście przeszkód gazu wybuchów (GAS_OBST_IN: obrysy z żywych węzłów belek; gra dokłada okno pola do prostokątów
// domen) → `SpaceGas.setObstacleInput(tablica)`; dysze MAIN tej klatki z EngineFrame. Bez `window`, DOM i referencji do
// encji — w workerze renderu ten sam kod (bloki migawki `spaceGas` i `gasObst`).
//
// Klatka (krok Core3D.fx „gaz przestrzeni”): wejście → źródła i przeszkody → pole (spaceGasSim.js, kroki 1/60 s czasu
// gry) → mapy gazu i światła (spaceGasMaps.js) → warstwy w passie ortho (spaceGasLayer.js). Poza obszarem gazu: 0
// dispatchy i 0 rysunków. Pył gazu (spaceGasDust.js, GK-4) rodzi się z gęstości pola i płynie z gazem. Rozgrzewka: `warm` kroku (puste dispatche) + wpis rejestru (siatki warstw).

import { Core3D } from '../core3d.js';
import { EngineFrame } from '../engineFrame.js';
import { SpaceGasSim, SPACE_GAS_CELL, SPACE_GAS_SRC, SPACE_GAS_CONE_REACH } from './spaceGasSim.js';
import { SpaceGasMaps } from './spaceGasMaps.js';
import { SpaceGasLayer } from './spaceGasLayer.js';
import { SpaceGasDust } from './spaceGasDust.js';
import { BeltGasScene, createRingGasLook } from './spaceGasBelt.js';
import { SPACE_GAS_IN, SPACE_GAS_SCENE, SPACE_GAS_VIEW_ASPECT, spaceGasViewHalf } from './spaceGasLayout.js';
import { GAS_HULL_REC, GAS_OBST_IN } from '../gas/gasObstacleLayout.js';
import { SpaceGasCover } from './spaceGasState.js';
import { WARP_WORLD_LENS } from '../warp/worldLens.js';
import { warpFieldVisibility, stepWarpFieldFade } from '../../render/warpLensPhase.js';

const I = SPACE_GAS_IN;

/** Strojenie (konsola: SpaceGas.tune; okno i mapy — przy budowie, reszta na żywo). */
export const SPACE_GAS_TUNE = {
  enabled: true,
  windowCells: 256,       // okno pola (D5: 128 / 256 / 384 — preset grafiki)
  mapW: 768,              // mapy gazu i światła [teksle]
  mapH: 432,
  dustCount: 80000,       // drobiny pyłu gazu (D2: 80 tys. na Wysokiej; 0 — bez pyłu) — przy budowie
  dust: true,             // A/B: pył gazu wł. / wył. (na żywo)
  fogReplace: true,       // gaz zamiast płytkich płatów mgły pasa (fog.js) — jedna mgła; false — obie (A/B)
  sim: true,              // A/B: false — samo pole dalekie (G dema)
  // A/B: false — dt tej strony i własny akumulator kroku (dawniej: pominięte strony workera gubiły czas — utrata 14–48%,
  // faza kroku pola wobec fizyki losowa); true — zegar gry z wejścia (SPACE_GAS_IN.simTime / renderTime)
  clock: true,
  amount: 1.0,            // gęstość gazu w obrazie
  // zanik obrazu przy oddaleniu: pół kadru [j.] (koniec ≤ SPACE_GAS_INPUT_TUNE.maxViewHalf gry — obraz znika, zanim gra
  // wyłączy gaz; strażnik w teście)
  fadeView: [40000, 80000],
  // pół kadru do zaniku (spaceGasViewHalf — to samo wyliczenie co wyłączenie gazu w grze): kadr szerszy niż te proporcje
  // liczy się jak kadr o tej samej wysokości (32:9 gaśnie jak 16:9 — dawniej max(pół szer., pół wys.): na 5120 × 1440 gaz
  // gasł od zoomu 0,064, wracały statyczne płaty mgły); 0 — dawny wzór (A/B)
  fadeAspect: SPACE_GAS_VIEW_ASPECT,
  dustEdge: true,         // A/B: pył gaśnie miękko przy brzegu okna pola (jak mapa), false — ginie na brzegu (prostokąt)
  texelLadder: true,      // A/B: teksel map z drabiny 2^(j/8) (spaceGasMaps.js); false — wprost z kadru (gaz „gotował się” przy zoomie)
  warmStart: 3,           // rozgrzanie pola po starcie okna [s] (× 4 czasu pola — odgazowanie i dryf rozwinięte od razu)
  // dysze MAIN: narzucona prędkość w stożku (dema: ciąg ponad jałowy, długość 300 + 1700·ciąg, prędkość 2600·ciąg)
  jetMinPower: 0.12,
  jetLen: [300, 1700],
  jetSpeed: 2600,
  jetWidth: 1.35,         // pół szerokości u nasady × pół szerokości gromady dysz (EngineFrame.spread)
  jetWidthMin: 60,
  jetWiden: 0.3,
  jetRate: 8,
  jetReach: 450,
  // odgazowanie lodowych skał (wejście gry): struga od Słońca
  ventLen: 1200,
  ventSpeed: 320,
  ventRate: 2.0,
  ventReach: 350,
  ventInject: 1.6,
  // wybuchy (wejście gry): FRONT wypycha gaz na zewnątrz (dziura z wałem), wyrzut pyłu (kanał w); dema: boom()
  // × k = rozmiar / 280 (Atlas): prędkość frontu 1500·√k, grubość 380·k, siła 9000·k, wyrzut 200·k
  blastPush: 1400,
  blastSpeed: 1500,
  blastWidth: 380,
  blastEjectaR: 200,
  blastEjectaRate: 2.2,
  blastEjectaLife: 0.5,
  // pociski (wejście gry): gaz wleczony za pociskiem (dema: bolts)
  boltLen: 650,
  boltWidth: 55,
  boltSpeed: 900,
  boltRate: 3,
  boltVol: 0.3,
  boltLag: 600,
  maxHullObstacles: 32
};

/**
 * Zanik obrazu gazu przy oddaleniu (1 — pełny, 0 — zgaszony; wtedy wracają płytkie płaty mgły pasa). Pół kadru do progu
 * `fadeView` [od, do] z `spaceGasViewHalf` (spaceGasLayout.js — tego samego używa gra do wyłączenia gazu): kadr szerszy
 * niż `aspect` (szer. / wys.) liczy się jak kadr o tej samej wysokości — 21:9 i 32:9 gasną jak 16:9, kadry ≤ 16:9 (i
 * pionowe) bit w bit jak dawny max(pół szer., pół wys.); aspect ≤ 0 — dawny wzór.
 */
export function spaceGasViewFade(halfW, halfH, fadeView, aspect = SPACE_GAS_VIEW_ASPECT) {
  const half = spaceGasViewHalf(halfW, halfH, aspect);
  return 1 - Math.min(1, Math.max(0, (half - fadeView[0]) / (fadeView[1] - fadeView[0])));
}

class SpaceGasSystem {
  constructor() {
    this.input = new Float64Array(I.size);
    this.obstacles = null;
    this.tune = SPACE_GAS_TUNE;
    this.sim = null;
    this.maps = null;
    this.layer = null;
    this.dust = null;
    this.scene = null;
    this.step = null;
    this._serial = -1;
    this._scene = SPACE_GAS_SCENE.none;
    this._rect = { cx: 0, cy: 0, w: 1, h: 1 };
    // ZANIK PRZY SKOKU GRACZA (2026-10-27, jak pole pasa — src/render/warpLensPhase.js warpFieldVisibility): obraz gazu
    // i jego pyłu × udział prawdziwego widoku (1 − β / chargeBeta soczewki świata) — w ładowaniu gaśnie razem z polem
    // i jest pusty przed kopem (gra wyłącza gaz w skoku: `enabled` w index.html); po włączeniu (wyjście, wejście
    // w obszar gazu) wraca od zera w WARP_FIELD_FADE.reveal s. Pokrycie pasa dla płytkiej mgły (SpaceGasCover.belt)
    // zostaje przestrzenne — płaty i gaz gasną razem, płaty nie wracają w miejsce gazu.
    this._warpFade = 0;
    // zegar gry: czas renderu ostatniej przetworzonej strony (przyrost = dt pyłu, wiatru, zaniku); krok pola z numeru
    // kroku fizyki (`tick`, `hz`), chwila obrazu z różnicy SimClock.sim − .render (sim.frame)
    this._renderTime = NaN;
    this._clk = { tick: NaN, hz: 60, sim: 0, render: 0 };
    this.stats = { active: false, cpuMs: 0, sources: 0, vents: 0, blasts: 0, bolts: 0, hulls: 0, raster: false, substeps: 0, dispatches: 0, fade: 0,
      dt: 0, clock: false, viewFade: 0, jetsSkipped: 0 };
  }

  _ensure() {
    if (this.sim) return true;
    if (!Core3D.isInitialized || !Core3D.scene || !Core3D.fx) return false;
    const T = this.tune;
    this.scene = new BeltGasScene();
    const sc = this.scene;
    // wygląd per scena (pole dalekie i kernele te same — przełączane barwy i strojenie w uniformach)
    this.looks = { [SPACE_GAS_SCENE.belt]: sc.look, [SPACE_GAS_SCENE.ring]: createRingGasLook() };
    this.sim = new SpaceGasSim({ farEnv: (q, U) => sc.farEnv(q, U), N: T.windowCells, cell: SPACE_GAS_CELL, maxHulls: T.maxHullObstacles });
    this.maps = new SpaceGasMaps(this.sim, sc, { w: T.mapW, h: T.mapH });
    this.layer = new SpaceGasLayer(this.maps, { grid: Core3D.fx.grid, layer: 0 });
    if (T.dustCount > 0) {
      this.dust = new SpaceGasDust(this.sim, this.maps, { count: T.dustCount, grid: Core3D.fx.grid, layer: 0 });
      this.layer.group.add(this.dust.mesh);
    }
    this.syncLook();
    Core3D.scene.add(this.layer.group);
    this.step = Core3D.addFxStep({
      name: 'gaz przestrzeni',
      update: (ctx) => this._update(ctx),
      // pipeline'y compute powstają synchronicznie — puste dispatche na ekranie ładowania
      warm: (ctx) => { this.sim.warm(ctx.renderer); this.maps.warm(ctx.renderer); if (this.dust) this.dust.warm(ctx.renderer); }
    });
    return true;
  }

  /** Wygląd sceny → uniformy (po zmianie SpaceGas.scene.look). */
  syncLook() {
    const k = this.scene.look;
    this.scene.syncLook();
    this.maps.syncLook(k);
    this.layer.L.sun.value.setRGB(k.sun[0] * k.sunGain, k.sun[1] * k.sunGain, k.sun[2] * k.sunGain);
    this.layer.L.ambient.value.setRGB(k.ambient[0], k.ambient[1], k.ambient[2]);
    if (this.dust) this.dust.syncLook(k);
    const d = k.decay;
    this.sim.tune.decay = d;
    this.sim.syncTune();
  }

  /** Wejście klatki od gry (Float64Array, układ SPACE_GAS_IN). */
  submit(input) {
    if (input && input !== this.input) this.input.set(input.subarray ? input.subarray(0, I.size) : input);
    this._ensure();
  }

  /** Wejście przeszkód gazu wybuchów (GAS_OBST_IN) — kadłuby w oknie pola; null — bez kadłubów. */
  setObstacleInput(f64) {
    this.obstacles = f64 || null;
  }

  /** Siatki warstw do rozgrzewki (Core3D.warmup, ekran ładowania). */
  warmupMeshes() {
    if (!this._ensure()) return [];
    return this.dust ? [...this.layer.warmupMeshes(), this.dust.mesh] : this.layer.warmupMeshes();
  }

  _update(ctx) {
    const t0 = performance.now();
    const IN = this.input, T = this.tune, st = this.stats;
    const scene = IN[I.scene];
    const on = !!(T.enabled && IN[I.active] > 0.5 && (scene === SPACE_GAS_SCENE.belt || scene === SPACE_GAS_SCENE.ring));
    st.active = on;
    SpaceGasCover.belt = 0;
    // ZEGAR (2026-10-29, „gazy i mgła w polu asteroid mocno drżą”): dt = przyrost czasu renderu gry od ostatniej
    // PRZETWORZONEJ strony — worker pomija strony (i klatki efektów), a dt jednej strony gubił czas pominiętych (pole,
    // pył i wiatr szły w 52–86% tempa, ruch na narysowaną klatkę skakał); krok pola z NUMERU kroku fizyki (liczba
    // całkowita z wejścia — sim.frame; bez numeru: akumulator). Bez zegara w wejściu albo A/B `tune.clock = false` — dt
    // tej strony jak dawniej.
    const fresh = IN[I.serial] !== this._serial;
    this._serial = IN[I.serial];
    const tr = IN[I.renderTime], ts = IN[I.simTime];
    const clockOn = !!(T.clock && Number.isFinite(tr) && Number.isFinite(ts));
    let dt;
    if (clockOn) {
      const prev = this._renderTime;
      dt = fresh && Number.isFinite(prev) ? Math.min(0.1, Math.max(0, tr - prev)) : 0;
      this._renderTime = tr;
      const ck = this._clk;
      ck.tick = IN[I.physTick];
      ck.hz = IN[I.physHz] > 0 ? IN[I.physHz] : 60;
      ck.sim = ts;
      ck.render = tr;
    } else {
      dt = fresh ? IN[I.dt] : 0;
      this._renderTime = NaN;
    }
    st.dt = dt;
    st.clock = clockOn;
    if (!on) {
      this.layer.setVisible(false);
      if (this.dust) this.dust.setVisible(false);
      st.substeps = 0;
      st.dispatches = 0;
      this._warpFade = 0;
      st.fade = 0;
      // po wyjściu z obszaru pole startuje od nowa (pole dalekie) przy powrocie
      if (this._scene !== SPACE_GAS_SCENE.none) { this._scene = SPACE_GAS_SCENE.none; this.sim.requestReset(T.warmStart); }
      return;
    }
    if (this._scene !== scene) {
      this._scene = scene;
      // pas ↔ ring: wygląd sceny (barwy, zanik kanałów, pył) i pole od nowa
      if (this.looks[scene] && this.scene.look !== this.looks[scene]) { this.scene.look = this.looks[scene]; this.syncLook(); }
      this.sim.requestReset(T.warmStart);
    }
    const ax = IN[I.anchorX], ay = IN[I.anchorY];
    // środek okna pola (gra: przy prowadzonym okręcie pod śladem, przycięty do kadru — spaceGasInput.js); bez pola — kamera
    const wx = Number.isFinite(IN[I.winX]) ? IN[I.winX] : IN[I.camX];
    const wy = Number.isFinite(IN[I.winY]) ? IN[I.winY] : IN[I.camY];
    this.scene.setEnvelope(IN, I);

    const sim = this.sim;
    sim.beginInputs();
    // budżet źródeł (64): wybuchy pierwsze, potem dysze, odgazowanie, pociski (plan § 2 pkt 2)
    this._blasts(IN);
    this._engines(ax, ay, wx, wy);
    this._vents(IN);
    this._bolts(IN);
    sim.setRaster(IN, I);
    this._hulls(ax, ay, wx, wy);
    st.sources = sim.srcN;
    st.hulls = sim.hullN;
    st.raster = IN[I.rasterOn] > 0.5;
    const resets = sim.stats.resets;
    sim.frame(T.sim ? ctx.renderer : null, T.sim ? dt : 0, wx, wy, IN[I.windX], IN[I.windY], T.sim && clockOn ? this._clk : null);
    if (this.dust && sim.stats.resets !== resets) this.dust.requestReset();
    st.substeps = sim.stats.substeps;

    // mapy wokół kadru (teksel z drabiny — siatka tekseli stoi w świecie przy ruchu zoomu)
    const maps = this.maps;
    maps.ladder = T.texelLadder !== false;
    const r = maps.place(IN[I.camX], IN[I.camY], IN[I.halfW], IN[I.halfH], this._rect);
    maps.U.sunDir.value.set(IN[I.sunX], IN[I.sunY]);
    maps.U.simOn.value = T.sim && sim.image.valid ? 1 : 0;
    maps.U.amount.value = T.amount;
    ctx.renderer.compute(maps.kernels());
    st.dispatches = sim.stats.dispatches + 2;

    const viewFade = spaceGasViewFade(IN[I.halfW], IN[I.halfH], T.fadeView, T.fadeAspect);
    st.viewFade = viewFade;
    // zanik przy skoku gracza (soczewka świata — ten sam stan w trybie off i w workerze; dt gry — pauza trzyma)
    const warpFade = this._warpFade = stepWarpFieldFade(this._warpFade, warpFieldVisibility(WARP_WORLD_LENS.active, WARP_WORLD_LENS.beta), dt);
    st.fade = warpFade;
    const fade = viewFade * warpFade;
    this.layer.L.fade.value = fade;
    this.layer.place(ax + r.cx, ay + r.cy, r.w, r.h);
    this.layer.setVisible(fade > 0.004);
    // płytkie płaty mgły pasa gasną pod gazem (jedna mgła — fog.js); pokrycie przestrzenne (bez zaniku skoku)
    SpaceGasCover.belt = T.fogReplace && scene === SPACE_GAS_SCENE.belt ? viewFade : 0;
    // pył gazu: po polu (czyta jego prędkość i gęstość) i mapach (światło); tylko z ruchem gazu
    const dustOn = !!(this.dust && T.dust && T.sim && fade > 0.004);
    if (this.dust) {
      this.dust.U.edge.value = T.dustEdge ? 1 : 0;
      if (dustOn) st.dispatches += this.dust.frame(ctx.renderer, dt, ctx, ax, ay, r, fade);
      this.dust.setVisible(dustOn);
    }
    st.cpuMs = performance.now() - t0;
  }

  // Dysze MAIN tej klatki (EngineFrame: scena, y w górę = −y gry) → stożki w polu (świat gry względem kotwicy). Stożek,
  // którego pudło nie dotyka okna pola (wx, wy ± pół okna), nie zabiera budżetu źródeł (przy oddaleniu w bitwie dysze
  // okrętów spoza okna wypychały z budżetu dysze w oknie, odgazowanie i pociski) ani pętli kerneli. Pudło = odcinek osi
  // stożka ± SPACE_GAS_CONE_REACH × szerokość końca stożka: tak daleko w poprzek działa kernel (`srcShape`, |x| < 2,6;
  // strefa ściśliwa exp(−x²/2) — 0,14 przy x = 2), więc dysza obok okna (do ~1,6 szerokości dalej niż sam stożek) dalej
  // pcha komórki przy jego brzegu.
  _engines(ax, ay, wx, wy) {
    const T = this.tune, sim = this.sim;
    const half = sim.N * sim.cell * 0.5 + sim.cell;
    let skipped = 0;
    for (let k = 0; k < EngineFrame.count; k++) {
      const th = Math.max(0, (Math.min(EngineFrame.power[k], 1.5) - T.jetMinPower) / (1 - T.jetMinPower));
      if (!(th > 0.01)) continue;
      const x = EngineFrame.x[k] - ax, y = -EngineFrame.y[k] - ay;
      const dx = EngineFrame.dirX[k], dy = -EngineFrame.dirY[k];
      const len = T.jetLen[0] + T.jetLen[1] * th;
      const w0 = Math.max(T.jetWidthMin, EngineFrame.spread[k] * T.jetWidth);
      const we = w0 + len * T.jetWiden;
      const m = we * SPACE_GAS_CONE_REACH;
      const ex = x + dx * len, ey = y + dy * len;
      if (Math.min(x, ex) - m > wx + half || Math.max(x, ex) + m < wx - half ||
        Math.min(y, ey) - m > wy + half || Math.max(y, ey) + m < wy - half) { skipped++; continue; }
      if (!sim.addSource(x, y, dx, dy, len, w0, T.jetWiden, T.jetSpeed * th, T.jetRate, 0, SPACE_GAS_SRC.cone, T.jetReach)) break;
    }
    this.stats.jetsSkipped = skipped;
  }

  // Odgazowanie lodowych skał (wejście gry): struga od Słońca z wylotu po stronie dziennej, wstrzykuje lód (kanał z).
  _vents(IN) {
    const T = this.tune, sim = this.sim;
    const n = IN[I.jets] | 0;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const b = I.jetBase + i * I.jetStride;
      const dx = IN[b + 2], dy = IN[b + 3], r = IN[b + 4], e = IN[b + 5];
      const ox = IN[b] + dx * (r * 0.5 + 40), oy = IN[b + 1] + dy * (r * 0.5 + 40);
      if (!sim.addSource(ox, oy, dx, dy, T.ventLen, r * 0.45 + 25, 0.3, T.ventSpeed * e, T.ventRate, 0, SPACE_GAS_SRC.cone,
        T.ventReach, 0, 0, T.ventInject * e, 0)) break;
      v++;
    }
    this.stats.vents = v;
  }

  // Wybuchy (wejście gry): front wybuchu (strefa ściśliwa — dziura z wałem na brzegu) i wyrzut pyłu na początku.
  _blasts(IN) {
    const T = this.tune, sim = this.sim;
    const n = IN[I.blasts] | 0;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const b = I.blastBase + i * I.blastStride;
      const x = IN[b], y = IN[b + 1], size = IN[b + 2], age = IN[b + 3], life = IN[b + 4];
      const kz = Math.min(4, Math.max(0.25, size / 280));
      const k = Math.max(0, 1 - age / life);
      const speed = T.blastSpeed * Math.sqrt(kz);
      if (!sim.addSource(x, y, 1, 0, 120 + speed * age, T.blastWidth * kz, 0, T.blastPush * k * k * Math.sqrt(kz), 10, 0,
        SPACE_GAS_SRC.front, 0)) break;
      m++;
      const el = T.blastEjectaLife * Math.sqrt(kz);
      if (age < el) {
        const ke = 1 - age / el;
        if (!sim.addSource(x, y, 1, 0, T.blastEjectaR * kz, 0, 0, 160 * ke, 2, 0, SPACE_GAS_SRC.ball, 0, 0, 0, 0, T.blastEjectaRate * ke)) break;
      }
    }
    this.stats.blasts = m;
  }

  // Pociski (wejście gry): narzucona prędkość w wąskim stożku za pociskiem (gaz wleczony jak za strzałem dema).
  _bolts(IN) {
    const T = this.tune, sim = this.sim;
    const n = IN[I.bolts] | 0;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const b = I.boltBase + i * I.boltStride;
      const dx = IN[b + 2], dy = IN[b + 3];
      if (!sim.addSource(IN[b] - dx * T.boltLag, IN[b + 1] - dy * T.boltLag, dx, dy, T.boltLen, T.boltWidth, 0.05, T.boltSpeed,
        T.boltRate, T.boltVol, SPACE_GAS_SRC.cone, T.boltLen)) break;
      m++;
    }
    this.stats.bolts = m;
  }

  // Kadłuby z wejścia przeszkód (GAS_OBST_IN) w oknie pola (wx, wy — środek okna względem kotwicy).
  _hulls(ax, ay, wx, wy) {
    const F = this.obstacles;
    if (!F || !(F[GAS_OBST_IN.serial] >= 0)) return;
    const sim = this.sim;
    const R = GAS_HULL_REC;
    const n = Math.max(0, Math.min(GAS_OBST_IN.maxHulls, F[GAS_OBST_IN.hulls] | 0));
    const half = sim.N * sim.cell * 0.5;
    const cx = wx + ax, cy = wy + ay;
    for (let h = 0; h < n; h++) {
      const o = GAS_OBST_IN.hullBase + h * R.stride;
      const reach = F[o + R.reach];
      if (Math.abs(F[o + R.ax] - cx) > half + reach || Math.abs(F[o + R.ay] - cy) > half + reach) continue;
      if (!sim.addHullRecord(F, o, R, ax, ay)) break;
    }
  }
}

export const SpaceGas = new SpaceGasSystem();

// Rozgrzewka: siatki warstw powstają dopiero na ekranie ładowania (Core3D gotowy) — wpis czeka na urządzenie.
Core3D.warmup.add({ name: 'gaz przestrzeni', objects: () => SpaceGas.warmupMeshes(), phase: 'loading' });
