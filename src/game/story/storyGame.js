// ============================================================
// Fabuła w grze (2026-09-30) — klej reżysera misji z grą. Bez three i DOM (UI: src/ui/storyOverlay.js).
//
// index.html woła:
//   StoryGame.init(deps)                 — raz, przy starcie świata (deps: funkcje i stan gry, niżej);
//   StoryGame.beginNewGame(opts)         — startGame, po ładowaniu, PRZED pierwszą klatką (dok + kamera intro);
//   StoryGame.frame(frameDt)             — co klatkę rAF (czas rzeczywisty: kamera, dialogi, UI);
//   StoryGame.tick(gameDt)               — po krokach fizyki (czas gry: skrypt misji, harmonogram, fale);
//   StoryGame.cameraFrame(p)             — w render(): obiekt kamery free3d kina albo null;
//   StoryGame.applyPlayerLock(ship, dt)  — w physicsStep po całkowaniu gracza (dok, wysuwanie ze stanowiska);
//   StoryGame.emit(nazwa, dane)          — haki gry: 'npcKilled', 'stationDestroyed', 'playerDestroyed', …;
//   StoryGame.worldFrozen                — pętla traktuje jak pauzę (sceny, podsumowanie);
//   StoryGame.blocksInput                — klawisze i mysz gry wyłączone (kino, dok).
// Skrypt misji dostaje `api` (niżej) — tylko przez nie dotyka gry.
// ============================================================
import { createStoryRunner, isStoryCancelled } from './storyRunner.js';
import { createDialogueQueue } from './dialogue.js';
import { createProgress, grantExp, rankProgress } from './progression.js';
import { buildDockIntroKeys, keysDuration, sampleKeys, topDownPose } from './introCamera.js';
import { k7AxesGame, k7BerthPose, k7FrameFor, k7HallCenter, k7HubToGame, k7IsOutsideHall, k7LayoutTemplate } from './k7Dock.js';
import { planFleetWave, SHIPYARD_TUNE } from './shipyardLayout.js';
import { PIRATE_BASE_STRUCTURES, PIRATE_BASE_TUNE, planPirateBase } from './pirateBaseSite.js';
import { planFuelChain } from './pirateBaseFuel.js';
import { beltAmbushReached, planBeltAmbush } from './beltAmbush.js';
import { createCloak, isCloakHidden } from '../cloak.js';
import { K7_POSE_OWNER } from '../k7BerthService.js';
import { ENGINE_OFF, igniteEngine, setEngineState } from '../engineIgnition.js';
import { K7_SERVICE_UNDOCK, k7ServiceDisconnectPose, k7ServiceStep } from '../../3d/haloRing/haloPortK7Layout.js';
import { MISSION01 } from './missions/mission01.js';
import { CAMPAIGN_PHASES, runCampaign } from './campaign.js';

const DEG = Math.PI / 180;
const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const smooth01 = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

// Odległość punktu (px, py) od odcinka (x0, y0) → (x0 + dx, y0 + dy) o długości len.
function segPointDist(x0, y0, dx, dy, len, px, py) {
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (len * len)));
  return Math.hypot(x0 + dx * t - px, y0 + dy * t - py);
}

function newPose() {
  return { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, fov: 40 };
}

// Fazy kampanii (misja 1 „Cicha baza” + misja 2 „Odwet”, src/game/story/campaign.js) — skoki dev ?story=<faza>.
export const STORY_PHASES = CAMPAIGN_PHASES;

// Obsługa stanowiska (zamki pola, ramiona paliwowe, złączki, rygle, przepływ): płynne przejście między „podpięta”
// i „schowana” (`dock.service`) poza sekwencją odcumowania.
const SERVICE_KEYS = ['clamp', 'extension', 'seat', 'lock', 'flow'];

// Odcumowanie na rozkaz gracza (przycisk ODDOKUJ, 2026-10-07 — prośba użytkownika: „gracz musi zacząć w doku
// i kliknąć oddokuj, żeby go oddokowało, i samodzielnie wylecieć”): wspólna sekwencja odłączenia stanowisk capital
// K-7 (K7_SERVICE_UNDOCK, haloPortK7Layout.js — także K7Docking i automat portu): przepływ → kontrolowany upust
// (para z przewodów — źródła gazu hali) → odryglowanie (buch pary dookoła złączek) → złączki w górę → ramiona
// paliwowe się składają → zamki pola; napęd wraca do gracza przy zwolnieniu zamków, ramiona dokładają się nad
// płaszczyzną lotu już w trakcie wylotu. Czas gry [s].
export const STORY_UNDOCK = K7_SERVICE_UNDOCK;

/** Poza obsługi stanowiska w chwili t sekwencji odcumowania (out — obiekt pozy K-7). */
export function storyUndockPose(t, out = {}) {
  return k7ServiceDisconnectPose(K7_SERVICE_UNDOCK, t, null, out);
}

export const StoryGame = {
  deps: null,
  runner: null,
  dialogue: null,
  progress: null,
  active: false,          // kampania w toku
  tutorial: true,
  mission: null,
  startPhase: null,       // skok dev (?story=faza)
  time: 0,                // czas rzeczywisty UI

  // --- kino ---
  // Intro (decyzja użytkownika 2026-09-30): lot kamery perspektywy z pozy menu do pionu nad K-7 (dach zamknięty),
  // potem kamera 2D gry w tym samym kadrze i otwarcie dachu — Atlas jako sprite 2D w doku, bez modelu 3D.
  cine: {
    mode: null,           // null | 'path' (lot kamery perspektywy)
    keys: null, t: 0, duration: 0, devTime: NaN,
    pose: newPose(),
    pathResolve: null,
    coreCam: { x: 0, y: 0, zoom: 1, mode: 'free3d', position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, fov: 40, near: 10, far: 4e7 },
    pendingStart: null,   // poza kamery menu (przechwycona przed stop tła)
    revealZoom: 0.07      // zoom kamery gry w chwili cięcia (kadr całej hali)
  },
  // Otwarcie dachu K-7 po cięciu na kamerę 2D (czas rzeczywisty; świat stoi).
  reveal: null,           // { t, delay, dur, resolve }
  REVEAL_VIEW_HEIGHT: 14500,  // j. świata w pionie kadru przy cięciu (hala 10 440 × 7 150 + zapas)
  REVEAL_SEC: 2.2,
  REVEAL_DELAY_SEC: 0.5,
  letterbox: false,
  hudHidden: false,
  _freeze: new Set(),     // powody zamrożenia świata
  _block: new Set(),      // powody blokady wejścia

  // --- dok / blokada gracza ---
  lock: null,             // { x, y, angle, anim? }
  // seq: odcumowanie w toku ({ t, resolve, pose }) — pozy obsługi z STORY_UNDOCK zamiast jednej wartości `service`
  dock: { berthId: null, service: 1, serviceTarget: 1, planet: null, frame: null, seq: null },

  // --- UI ---
  ui: {
    objective: null,      // { id, text, progress: () => string }
    hint: null,           // { spec, until, done, doneAt, shownAt }
    markers: new Map(),   // id → { x, y, label }
    targets: new Map(),   // id → { entity, label, radius } — wybrane cele do zniszczenia, śledzone na żywo
    summary: null,        // { title, subtitle, reward, resolve }
    action: null,         // panel z przyciskiem (ODDOKUJ): { id, title, subtitle, label, busyLabel, key, rows(), resolve, pressed }
    banner: null,         // { text, until }
    course: null          // { x, y, label }
  },

  _sayQueue: [],
  _timers: [],
  _arrivalQueue: [],
  _groups: [],
  _fogMassIds: new Set(),   // sygnatury masy postawione przez misję (mgła wojny) — zdejmowane przy resecie
  site: null,
  journalEntry: null,

  get worldFrozen() { return this._freeze.size > 0; },
  get blocksInput() { return this._block.size > 0 || this._freeze.size > 0; },
  get cinematic() { return this.cine.mode !== null; },

  init(deps) {
    this.deps = deps;
    this.runner = createStoryRunner({ onPhase: (name) => this._onPhase(name) });
    this.dialogue = createDialogueQueue();
    const player = deps.player?.();
    if (player && !player.progress) player.progress = createProgress();
    this.progress = player?.progress || createProgress();
    const ship = deps.ship?.();
    if (ship && !ship.cloak) ship.cloak = createCloak();
  },

  /**
   * Lot intro w TLE MENU (decyzja użytkownika 2026-09-30: menu pokazuje stronę Ziemi z K-7, kamera leci z tego ujęcia
   * prosto nad halę — ta sama Ziemia i ring, bez przejścia przez czerń). Koniec toru = kadr kamery gry z góry nad
   * stanowiskiem C-01 (Atlas trafia tam na starcie misji), słońce tła przechodzi w słońce gry.
   * p: { menuPose { eye, target, up, fov } (THREE), menuSun { az, el }, gameSun { az, el } (układ ringu), H }.
   * Zwraca plan dla MenuBackdrop3D.fly: { duration, sample(t, out), sun(w), cut(w) } albo null.
   */
  planMenuIntro(p) {
    const earth = this._earth();
    const hc = earth && k7HallCenter(earth, 0);
    const berth = earth && k7BerthPose(earth, 'C-01');
    if (!p?.menuPose || !hc || !berth) return null;
    const H = p.H || this.deps.viewHeight?.() || 1080;
    const zoom = H / this.REVEAL_VIEW_HEIGHT;
    this.cine.revealZoom = zoom;
    const { out } = k7AxesGame(hc.frame);
    const keys = buildDockIntroKeys({
      start: p.menuPose,
      hall: { x: hc.x, y: -hc.y, outX: out.x, outY: -out.y },
      end: topDownPose(berth.x, berth.y, zoom, H, 30)
    });
    const duration = keysDuration(keys);
    const ms = p.menuSun, gs = p.gameSun;
    return {
      duration,
      keys,
      sample: (t, o) => sampleKeys(keys, t, o),
      // słońce: menu → gra w środku lotu (na końcu oświetlenie = gra, cięcie bez zmiany światła)
      sun: (ms && gs) ? (w) => {
        const k = smooth01((w - 0.15) / 0.6);
        return { az: lerpAngle(ms.az, gs.az, k), el: ms.el + (gs.el - ms.el) * k };
      } : null,
      // końcówka lotu (kamera prawie z góry): ring liczy jak w kamerze gry — górna ściana i wycięcia jak po cięciu
      gameView: (w) => w >= 0.72,
      // wycięcie górnej ściany nad halą (jak w grze przy otwartym dachu) — narasta od włączenia widoku gry
      cut: (w) => smooth01((w - 0.72) / 0.2)
    };
  },

  /** Nowa gra w trybie kampanii: dok K-7, intro. opts: { tutorial, menuPose, introFromMenu, startPhase } */
  beginNewGame(opts = {}) {
    if (!this.deps) return false;
    this._reset('new-game');
    this.active = true;
    this.introFromMenu = !!opts.introFromMenu;
    this.tutorial = opts.tutorial !== false;
    this.startPhase = STORY_PHASES.includes(opts.startPhase) ? opts.startPhase : null;
    this.cine.pendingStart = opts.menuPose || null;
    this.mission = MISSION01;
    const ship = this.deps.ship();
    if (ship && !ship.cloak) ship.cloak = createCloak();
    this.runner.start(runCampaign, this._api()).then((result) => {
      if (result === 'complete') this.deps.log?.('Rozdział 1 ukończony.', 'mission');
    });
    return true;
  },

  abort(reason = 'abort') {
    this._reset(reason);
    this.active = false;
  },

  // Stan jednej gry do zera (singleton: druga nowa gra w tej samej sesji zaczyna od czystej karty).
  _reset(reason) {
    this.runner?.cancel(reason);
    if (this.dialogue?.active) this.dialogue.skip();
    for (const req of this._sayQueue) req.resolve('cancelled');
    this._sayQueue.length = 0;
    this._timers.length = 0;
    this._arrivalQueue.length = 0;
    this._groups.length = 0;
    this._clearUi();
    this.ui.banner = null;
    this._freeze.clear();
    this._block.clear();
    const c = this.cine;
    c.mode = null; c.keys = null; c.t = 0; c.duration = 0; c.devTime = NaN;
    c.pathResolve = null;
    if (this.reveal) this.deps?.setHallRoof?.(null);
    this.reveal = null;
    this.letterbox = false;
    this.lock = null;
    this.dock.berthId = null; this.dock.service = 0; this.dock.serviceTarget = 0; this.dock.seq = null;
    this._releaseHallPose();
    this.site = null;
    this.ambushPlan = null;
    this.journalEntry = null;
    this.phase = null;
    // Stan kampanii między misjami (np. wynik pojedynku z supercapitalem herszta w misji 1 → misja 2).
    this.campaign = { m1: null, bossEscaped: false };
    for (const id of this._fogMassIds) this.deps?.clearMassSignature?.(id);
    this._fogMassIds.clear();
    // Fregata zwiadu dana przez kampanię (api.scout.grant) — poza kampanią ładownia pusta (dev ?zwiad zostaje).
    if (this._scoutGranted) this.deps?.scoutBay?.()?.revoke?.();
    this._scoutGranted = false;
    if (this._scoutAvoid) this.deps?.scoutBay?.()?.setAvoid?.(null);
    this._scoutAvoid = false;
  },

  emit(name, data = {}) {
    if (!this.runner || !this.active) return 0;
    return this.runner.emit(name, data);
  },

  // ================================================================ PĘTLA
  frame(frameDt) {
    const dt = Math.max(0, Math.min(0.1, Number(frameDt) || 0));
    this.time += dt;
    if (!this.active) return;
    this._stepReveal(dt);
    this.dialogue.tick(dt);
    this._pumpSay();
    this._stepService(dt);
    this._stepHint();
    if (this.ui.banner && this.time > this.ui.banner.until) this.ui.banner = null;
    this._applyHallState();
  },

  tick(gameDt) {
    if (!this.active || !this.runner) return;
    const dt = Math.max(0, Number(gameDt) || 0);
    if (dt > 0) this._stepTimers(dt);
    if (dt > 0) this._stepUndock(dt);
    if (dt > 0) this._stepSitePower(dt);
    this._stepArrivals();
    this.runner.tick(dt);
  },

  // ================================================================ KAMERA
  /**
   * p: { dt, W, H, camX, camY, zoom (gra), gameCam3d, View3D }
   * Zwraca obiekt kamery free3d (lot intro) albo null (gra prowadzi kamerę sama).
   */
  cameraFrame(p) {
    const c = this.cine;
    if (c.mode !== 'path') return null;
    const dt = Math.max(0, Math.min(0.1, Number(p.dt) || 0));
    // devTime (harness zrzutów): stała chwila toru niezależna od tempa klatek
    c.t = Number.isFinite(c.devTime) ? c.devTime : c.t + dt;
    sampleKeys(c.keys, c.t, c.pose);
    if (c.t >= c.duration && !Number.isFinite(c.devTime)) {
      // Koniec toru = kadr kamery gry z góry: od tej klatki rysuje kamera 2D, dach otwiera reżyser.
      this._endPath();
      return null;
    }
    return this._writeCam(c.pose, p.W, p.H, p.View3D);
  },

  _writeCam(pose, W, H, view) {
    const c = this.cine;
    const dx = pose.target.x - pose.eye.x, dy = pose.target.y - pose.eye.y, dz = pose.target.z - pose.eye.z;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
    const fov = Math.max(30, Math.min(90, pose.fov));
    const near = Math.max(10, Math.min(4000, dist * 0.004));
    view.setLookAt(pose.eye, pose.target, pose.up, fov, W, H, near, 4e7);
    view.offsetX = 0;
    view.offsetY = 0;
    view.active = true;
    view.mode = 'story';
    const cam = c.coreCam;
    view.writeCoreCamera(cam);
    // Pola kamery 2D dla modułów liczących z (x, y, zoom): punkt celu w płaszczyźnie gry, zoom = px/j. na jego głębi.
    cam.x = pose.target.x;
    cam.y = -pose.target.y;
    cam.zoom = Math.max(1e-5, (H * 0.5) / Math.tan(fov * 0.5 * DEG) / dist);
    cam.viewDistance = dist;
    return cam;
  },

  _endPath() {
    const c = this.cine;
    c.mode = null;
    c.keys = null;
    // dach zamknięty jeszcze chwilę w kadrze 2D, potem otwarcie (frame → _stepReveal)
    this.reveal = { t: 0, delay: this.REVEAL_DELAY_SEC, dur: this.REVEAL_SEC, resolve: c.pathResolve };
    c.pathResolve = null;
  },

  _stepReveal(dt) {
    const r = this.reveal;
    if (!r) return;
    r.t += dt;
    const k = smooth01((r.t - r.delay) / Math.max(0.01, r.dur));
    this.deps.setHallRoof?.({ key: 'earth', hall: 0, roofFade: k, cut: 1 });
    if (r.t >= r.delay + r.dur) {
      this.reveal = null;
      this.deps.setHallRoof?.(null);
      // kamera gry wraca do zoomu statku sprężyną (zbliżenie na zadokowanego Atlasa)
      this.deps.releaseGameCamera?.();
      this._freeze.delete('cinema');
      if (r.resolve) r.resolve();
    }
  },

  _endCinema() {
    this.cine.mode = null;
    this.setLetterbox(false);
    this._freeze.delete('cinema');
    this._block.delete('cinema');
    this.setHud(true);
  },

  /** Poza kamery tła menu → start toru (THREE). */
  /**
   * Początek lotu (THREE): Ziemia po stronie DZIENNEJ. Gra zaczyna z czerni (przejście z menu), więc poza menu nie
   * musi się zgadzać — a w grze słońce stoi, więc z kierunku menu widać nocną tarczę. Start: 80° od hali ku słońcu,
   * wysoko; pośrednia poza (mid) — łuk ku hali, bliżej planety (Hermite po cięciwie nie wchodzi w planetę).
   */
  _startPose(ship, hall) {
    const earth = this._earth();
    const sun = this.deps.sun?.();
    const menu = this.cine.pendingStart;
    if (!earth || !hall || !sun) {
      if (menu && menu.eye && menu.target) return { start: menu, mid: null };
      const ex = earth ? earth.x : ship.pos.x, ey = earth ? -earth.y : -ship.pos.y;
      return { start: { eye: { x: ex - 60000, y: ey - 90000, z: 30000 }, target: { x: ex, y: ey, z: 0 }, up: { x: 0, y: 0, z: 1 }, fov: 30 }, mid: null };
    }
    const ex = earth.x, ey = -earth.y;
    const hallAz = Math.atan2(hall.y - ey, hall.x - ex);
    const sunAz = Math.atan2(-sun.y - ey, sun.x - ex);
    let dAz = sunAz - hallAz;
    dAz = ((dAz + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const side = dAz >= 0 ? 1 : -1;
    const R = Math.max(20000, Math.hypot(hall.x - ex, hall.y - ey));   // promień hali ≈ ring
    const at = (az, dist, elDeg) => {
      const el = elDeg * DEG;
      return { x: ex + Math.cos(az) * Math.cos(el) * dist, y: ey + Math.sin(az) * Math.cos(el) * dist, z: Math.sin(el) * dist };
    };
    const start = { eye: at(hallAz + side * 80 * DEG, R * 3.1, 24), target: { x: ex, y: ey, z: 0 }, up: { x: 0, y: 0, z: 1 }, fov: 30 };
    const mid = at(hallAz + side * 38 * DEG, R * 2.0, 26);
    return { start, mid };
  },

  setLetterbox(on) { this.letterbox = !!on; },
  setHud(on) {
    this.hudHidden = !on;
    this.deps.showHud?.(!!on);
  },

  // ================================================================ DOK
  _earth() {
    const planets = this.deps.planets?.() || [];
    return planets.find((p) => String(p?.id || p?.name || '').toLowerCase() === 'earth') || null;
  },

  applyPlayerLock(ship, dt) {
    const L = this.lock;
    if (!L || !ship) return false;
    const ox = ship.pos.x, oy = ship.pos.y;
    let x = L.x, y = L.y, angle = L.angle;
    const a = L.anim;
    if (a) {
      a.t += dt;
      const seg = a.segs[a.i];
      if (seg) {
        const w = smooth01(seg.dur > 0 ? a.t / seg.dur : 1);
        x = seg.x0 + (seg.x1 - seg.x0) * w;
        y = seg.y0 + (seg.y1 - seg.y0) * w;
        angle = lerpAngle(seg.a0, seg.a1, w);
        if (a.t >= seg.dur) {
          L.x = seg.x1; L.y = seg.y1; L.angle = seg.a1;
          a.i++; a.t = 0;
          if (a.i >= a.segs.length) {
            L.anim = null;
            const done = a.resolve;
            if (done) done();
          }
        }
      }
    }
    ship.pos.x = x; ship.pos.y = y;
    ship.x = x; ship.y = y;
    ship.angle = angle;
    ship.angVel = 0;
    const inv = dt > 0 ? 1 / dt : 0;
    ship.vel.x = (x - ox) * inv;
    ship.vel.y = (y - oy) * inv;
    // pierwszy krok po teleporcie nie może dać „prędkości” przez pół układu
    if (Math.abs(ship.vel.x) > 2000 || Math.abs(ship.vel.y) > 2000) { ship.vel.x = 0; ship.vel.y = 0; }
    return true;
  },

  _dockPlace(berthId = 'C-01') {
    const earth = this._earth();
    if (!earth) return false;
    const pose = k7BerthPose(earth, berthId);
    if (!pose) return false;
    this.dock.berthId = berthId;
    this.dock.planet = earth;
    this.dock.frame = pose.frame;
    this.dock.service = 1;
    this.dock.serviceTarget = 1;
    // Dziobem ku bramie G-01 (poprawka użytkownika 2026-10-07: „ułóż go dziobem w stronę wyjścia z hali”) —
    // stanowisko K-7 ma kurs dziobem do ściany tylnej; po ODDOKUJ gracz wylatuje naprzód (W), a silnik dmucha
    // w ścianę tylną. Przewody paliwowe łapią kadłub przy dziobie (te same wlewy stanowiska).
    const angle = pose.angle + Math.PI;
    this.deps.placePlayer(pose.x, pose.y, angle);
    // Silniki MAIN wyłączone w doku (src/game/engineIgnition.js — etap E2): zapłon dopiero przy pierwszym ciągu gracza
    // (W) po ODDOKUJ — autozapłon gry.
    setEngineState(this.deps.ship?.(), ENGINE_OFF);
    this.lock = { x: pose.x, y: pose.y, angle, anim: null };
    this._block.add('dock');
    this._applyHallState(true);
    return true;
  },

  _dockRelease() {
    this.lock = null;
    this._block.delete('dock');
    this.dock.seq = null;
    this.dock.serviceTarget = 0;
    this.dock.berthId = null;
    this._applyHallState(true);
  },

  // Obsługa stanowiska (zamki pola, ramiona i przewody paliwowe) i lampka (hala 0 ringu Ziemi); stan w każdej klatce, bo ring po
  // zbudowaniu zeruje stanowiska. Pozy obsługi idą do rejestru kolidera (deps.k7HallPoses — stan gry: z niego
  // rysuje hala i biorą się źródła gazu z przewodów, src/3d/gasField/), bez niego — wprost do hali (dema, testy).
  // Poza fabuły ma właściciela (owner = 'story'): automat obsługi stanowisk gry swobodnej (src/game/k7BerthService.js)
  // jej nie dotyka, dopóki fabuła jej nie odda (koniec odcumowania, reset).
  _applyHallState(force = false) {
    const hall = this.deps.k7Hall?.(0);
    const poses = this.deps.k7HallPoses?.(0) || null;
    if (!hall && !poses) return;
    const berthId = this.dock.berthId || this._lastBerth;
    if (!berthId) return;
    this._lastBerth = berthId;
    const b = hall?.layout?.berths?.find((x) => x.id === berthId);
    if (b) {
      const occ = this.dock.berthId ? 'player' : null;
      if (b.occupied !== occ || force) { b.occupied = occ; b.reserved = occ; hall.setBerthLamps?.(); }
    }
    const pose = this._servicePose(this._poseScratch || (this._poseScratch = {}));
    if (!this._craneMap) this._craneMap = new Map();
    this._craneMap.set(berthId, Object.assign(this._craneMap.get(berthId) || {}, pose));
    const target = poses?.get(berthId);
    if (target) { Object.assign(target, pose); target.owner = K7_POSE_OWNER.story; }
    else hall?.setServicePoses?.(this._craneMap);
    if (this.dock.service <= 0 && !this.dock.berthId && !this.dock.seq) {
      if (target) target.owner = null;
      this._craneMap.clear();
      this._lastBerth = null;
    }
  },

  /** Oddaje pozę stanowiska fabuły (reset gry, przerwana kampania) — dalej obsługuje ją automat stanowisk. */
  _releaseHallPose() {
    const id = this._lastBerth;
    this._lastBerth = null;
    this._craneMap?.clear();
    const target = id ? this.deps?.k7HallPoses?.(0)?.get(id) : null;
    if (target && target.owner === K7_POSE_OWNER.story) { target.owner = null; target.settle = 0; }
  },

  /**
   * Poza obsługi stanowiska gracza teraz: sekwencja odcumowania albo wszystkie elementy razem (`service`).
   * `settle` — Atlas stoi przypięty (start w doku, powrót): ramiona i przewody paliwowe hali od razu na wlewach, bez
   * ruchu podpinania (poprawka użytkownika 2026-10-14: „zanim kamera pójdzie na statek, już powinien być zadokowany” —
   * w intro świat stoi, więc fizyka ramion dopinała statek dopiero po locie kamery).
   */
  _servicePose(out) {
    const seq = this.dock.seq;
    if (seq) { Object.assign(out, seq.pose); out.settle = 0; return out; }
    const k = this.dock.service;
    for (const key of SERVICE_KEYS) out[key] = k;
    out.vent = 0;
    out.settle = this.lock && k >= 1 ? 1 : 0;
    return out;
  },

  /** Wiersze panelu stanowiska: [etykieta, stan, klasa 'ok' | 'warn' | 'off']. */
  _serviceRows() {
    const p = this._servicePose(this._rowPose || (this._rowPose = {}));
    const tri = (v, on, mid, off) => (v > 0.98 ? on : v < 0.02 ? off : mid);
    return [
      ['PALIWO', p.vent > 0.05 ? 'UPUST' : p.flow > 0.5 ? 'PRZEPŁYW' : 'ODCIĘTE', p.vent > 0.05 ? 'warn' : p.flow > 0.5 ? 'ok' : 'off'],
      ['ZŁĄCZA', tri(p.lock, 'ZARYGLOWANE', 'ODRYGLOWANIE…', 'ODŁĄCZONE'), tri(p.lock, 'ok', 'warn', 'off')],
      ['PRZEWODY', tri(p.extension, 'PODŁĄCZONE', 'ZWIJANIE…', 'ZWINIĘTE'), tri(p.extension, 'ok', 'warn', 'off')],
      ['MOCOWANIA', tri(p.clamp, 'ZAMKNIĘTE', 'ZWALNIANIE…', 'ZWOLNIONE'), tri(p.clamp, 'ok', 'warn', 'off')],
      ['NAPĘD', this.lock ? 'ZABLOKOWANY' : 'GOTOWY', this.lock ? 'warn' : 'ok']
    ];
  },

  /** Krok sekwencji odcumowania (czas gry). */
  _stepUndock(dt) {
    const s = this.dock.seq;
    if (!s) return;
    s.t += dt;
    storyUndockPose(s.t, s.pose);
    // Silniki MAIN zostają zimne (poprawka użytkownika 2026-10-14: „dym z silników niech idzie dopiero, jak gracz wciśnie
    // W”) — zapłon (dym, błysk, struga) odpala autozapłon gry przy pierwszym ciągu po zwolnieniu zamków (index.html:
    // stepPlayerEngineIgnition); wcześniej stery są zablokowane.
    if (!s.drive && s.t >= STORY_UNDOCK.driveAt) {
      // zamki pola zwolnione — napęd wraca do gracza (ramiona paliwowe dokładają się już w trakcie wylotu)
      s.drive = true;
      this.lock = null;
      this._block.delete('dock');
      const done = s.resolve;
      s.resolve = null;
      done?.();
    }
    if (s.t >= STORY_UNDOCK.end) {
      this.dock.seq = null;
      this.dock.service = 0;
      this.dock.serviceTarget = 0;
      this.dock.berthId = null;
      this._applyHallState(true);
    }
  },

  /** Napis kroku odcumowania (cel misji w trakcie sekwencji). */
  undockStep() {
    const s = this.dock.seq;
    if (!s) return this.lock ? '' : 'NAPĘD ODBLOKOWANY';
    return k7ServiceStep(K7_SERVICE_UNDOCK, s.t);
  },

  _stepService(dt) {
    const d = this.dock;
    if (d.service === d.serviceTarget) return;
    const rate = dt / 2.6;
    d.service = d.serviceTarget > d.service ? Math.min(d.serviceTarget, d.service + rate) : Math.max(d.serviceTarget, d.service - rate);
  },

  /**
   * Odcumowanie (gracz kliknął ODDOKUJ): obsługa stanowiska odłącza się po kolei (STORY_UNDOCK), a przy zwolnieniu
   * mocowań napęd wraca do gracza — wylot z hali należy do niego (bez automatycznego wysuwania). Promise: napęd
   * odblokowany.
   */
  _undock() {
    return new Promise((resolve) => {
      if (!this.lock) { this._dockRelease(); resolve(); return; }
      if (this.dock.seq) { const prev = this.dock.seq.resolve; this.dock.seq.resolve = () => { prev?.(); resolve(); }; return; }
      this.dock.seq = { t: 0, resolve, pose: storyUndockPose(0, {}), drive: false };
      this.lock.anim = null;
    });
  },

  // ================================================================ DIALOGI
  _say(lines, mode = 'radio') {
    return new Promise((resolve) => {
      const req = { lines, mode: mode === 'scene' ? 'scene' : 'radio', resolve };
      if (req.mode === 'scene') {
        // scena przerywa radio i idzie pierwsza
        this._sayQueue.unshift(req);
        if (this.dialogue.active && this.dialogue.mode === 'radio') this.dialogue.skip();
      } else {
        this._sayQueue.push(req);
      }
      this._pumpSay();
    });
  },

  _pumpSay() {
    if (this.dialogue.active || !this._sayQueue.length) return;
    const req = this._sayQueue.shift();
    if (req.mode === 'scene') { this._freeze.add('scene'); this._block.add('scene'); }
    this.dialogue.play(req.lines, { mode: req.mode }).then((r) => {
      if (req.mode === 'scene') { this._freeze.delete('scene'); this._block.delete('scene'); }
      req.resolve(r);
      this._pumpSay();
    });
  },

  // ================================================================ UI
  _stepHint() {
    const h = this.ui.hint;
    if (!h) return;
    if (!h.done) {
      let ok = false;
      try { ok = !!(h.until && h.until()); } catch { ok = false; }
      if (ok) { h.done = true; h.doneAt = this.time; }
    } else if (this.time - h.doneAt > 1.4) {
      this.ui.hint = null;
    }
  },

  _clearUi() {
    this.ui.objective = null;
    this.ui.hint = null;
    this.ui.markers.clear();
    this.ui.targets.clear();
    this.ui.course = null;
    this.ui.action = null;
    if (this.ui.summary) { const r = this.ui.summary.resolve; this.ui.summary = null; r?.(); }
  },

  /** Przycisk panelu akcji (ODDOKUJ) — UI woła po kliknięciu albo klawiszu. Raz na panel. */
  triggerAction(id = null) {
    const a = this.ui.action;
    if (!a || a.pressed || (id && a.id !== id)) return false;
    a.pressed = true;
    a.pressedAt = this.time;
    a.resolve?.();
    return true;
  },

  /** Podsumowanie — gracz zamyka (UI woła). */
  closeSummary() {
    const s = this.ui.summary;
    if (!s) return false;
    this.ui.summary = null;
    this._freeze.delete('summary');
    this._block.delete('summary');
    s.resolve();
    return true;
  },

  // ================================================================ HARMONOGRAM (czas gry)
  _after(sec, fn) { this._timers.push({ t: Math.max(0, sec), fn }); },
  _stepTimers(dt) {
    if (!this._timers.length) return;
    const due = [];
    for (let i = this._timers.length - 1; i >= 0; i--) {
      const tm = this._timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { due.push(tm); this._timers.splice(i, 1); }
    }
    for (let i = due.length - 1; i >= 0; i--) {
      try { due[i].fn(); } catch (err) { this.deps.warn?.('[Fabuła] zdarzenie', err); }
    }
  },

  // Przyloty tunelem w kolejce: pula efektów przylotu ma 24 miejsca (WarpNurt), więc fale idą porcjami.
  _stepArrivals() {
    const q = this._arrivalQueue;
    if (!q.length) return;
    const free = this.deps.warpArrivalsFree?.() ?? 24;
    let budget = Math.max(0, free - 2);
    const now = this.runner.time;
    while (q.length && budget > 0 && q[0].notBefore <= now) {
      const job = q.shift();
      budget--;
      // callInWarp woła onSpawned także przy spawnie bez efektu (pula pełna / bez kadłuba)
      const res = this.deps.callInWarp(job.key, {
        mode: job.mode,
        spawnPos: { x: job.x, y: job.y },
        origin: job.origin,
        onSpawned: (list) => {
          job.group._onSpawned(list);
          // znacznik roli (np. __storyBoss — okręt herszta w fali)
          if (job.mark) for (const e of list) if (e) e[job.mark] = true;
        }
      });
      if (!res) job.group._failed++;
    }
  },

  _makeGroup(tag, total) {
    const self = this;
    const g = {
      tag, members: [], _total: total, _failed: 0, retreating: false,
      _onSpawned(list) {
        for (const e of list) {
          if (!e || g.members.includes(e)) continue;
          e.__storyTag = tag;
          e.mission = true;
          g.members.push(e);
        }
      },
      total() { return g._total; },
      arrived() { return g.members.length; },
      pending() { return Math.max(0, g._total - g.members.length - g._failed); },
      // okręt bez dowodzenia (mostek zniszczony — hulk) dryfuje i nie walczy: liczy się jak zniszczony
      alive() { return g.members.filter((e) => e && !e.dead && !e.warpedOut && !(e.hp <= 0) && !hulk(e)).length; },
      killed() { return g.members.filter((e) => e && (e.dead || e.hp <= 0 || hulk(e)) && !e.warpedOut).length; }
    };
    const hulk = (e) => (self.deps.isHulk ? !!self.deps.isHulk(e) : !!e.isBridgeHulk);
    this._groups.push(g);
    return g;
  },

  // ================================================================ POMOCNIKI ŚWIATA
  _shipyardCenter() {
    const d = this.deps;
    const sun = d.sun?.() || { x: 0, y: 0 };
    const earth = this._earth() || d.ship().pos;
    const au = d.worldUnitsPerAu?.() || 42253.52;
    const belt = d.belt?.();
    // Obrzeża (decyzja użytkownika): za pasem i za orbitą Jowisza (50,2 AU mapy — jego ring i księżyce sięgają
    // ~250 tys. j.), przed Saturnem (80,6 AU).
    const r = Math.max(belt && belt.outer > 0 ? belt.outer + 8 * au : 0, 57 * au);
    // Kierunek (poprawka 2026-10-05): stocznia leży PRZED BRAMĄ hali K-7, nie „za Ziemią od Słońca”. Ring ma
    // stały obrót, a Ziemia krąży — brama często patrzyła w stronę Słońca i stocznia wypadała za planetą:
    // gracz objeżdżał studnię, a kurs warpa pojawiał się dopiero za nią. Teraz prosta brama → stocznia nie
    // przecina studni Ziemi, omija Słońce i studnie innych planet; liczy się odchyłka od osi bramy.
    const frame = this._earth() && k7FrameFor(earth, 0);
    const hall = frame && k7HallCenter(earth, 0);
    const gate = hall ? { x: hall.x, y: hall.y } : { x: earth.x, y: earth.y };
    let outA = Math.atan2(earth.y - sun.y, earth.x - sun.x);
    if (frame) { const { out } = k7AxesGame(frame); outA = Math.atan2(out.y, out.x); }
    const clear = 420000;          // [j.] stocznia z dala od planet (studnie, księżyce)
    const pathClear = 300000;      // [j.] tor skoku z dala od innych planet
    const sunClear = 4 * au;       // [j.] tor skoku z dala od Słońca
    const planets = d.planets?.() || [];
    const ea = Math.atan2(gate.y - sun.y, gate.x - sun.x);
    let best = null;
    for (let i = -52; i <= 52; i++) {
      const a = ea + i * 0.06;
      const x = sun.x + Math.cos(a) * r, y = sun.y + Math.sin(a) * r;
      const dx = x - gate.x, dy = y - gate.y;
      const len = Math.hypot(dx, dy) || 1;
      let dev = Math.atan2(dy, dx) - outA;
      dev = Math.abs(Math.atan2(Math.sin(dev), Math.cos(dev)));
      let score = -dev * 6 * au;
      let minD = Infinity;
      for (const p of planets) {
        if (!p || p === earth) continue;
        const dd = Math.hypot(p.x - x, p.y - y);
        if (dd < minD) minD = dd;
        const seg = segPointDist(gate.x, gate.y, dx, dy, len, p.x, p.y);
        if (seg < pathClear) score += (seg - pathClear) * 4;
      }
      if (minD < clear) score += (minD - clear) * 4;
      const sunSeg = segPointDist(gate.x, gate.y, dx, dy, len, sun.x, sun.y);
      if (sunSeg < sunClear) score += (sunSeg - sunClear) * 4;
      if (!best || score > best.score) best = { x, y, score };
    }
    return { x: best.x, y: best.y };
  },

  _planSite() {
    const center = this._shipyardCenter();
    const earth = this._earth() || this.deps.ship().pos;
    // Budynek = BAZA PIRATÓW (szkic użytkownika 2026-10-11, src/3d/portBuildings/pirateBaseLayout.js): habitat, pomosty
    // z okrętami (większość w remoncie, kilkanaście z załogą), zbiorniki paliwa, magazyn. `dock` = miejsce bazy w grze
    // (placePirateBase), `station` = habitat (finał misji), `structures` = wszystkie budowle (byty stacji).
    const plan = planPirateBase(center, earth);
    const self = this;
    const site = {
      ...plan,
      station: null, structures: null,
      parkedList: [], crewList: [], repairList: [], droneList: [], turretList: [], defenderList: [], slipList: [],
      flagship: null, alarmed: false, alarmAt: -1, origin: null,
      // fale dronów z habitatu: ile wystartowało / ile ma być
      droneWave: 0, droneWaves: PIRATE_BASE_TUNE.droneWaves,
      // zasilanie (okna, lampy): cel i wartość płynna (gaśnie stopniowo — okna dysku od środka)
      power: { habitat: 1, disc: 1, fuel: 1, warehouse: 1 },
      powerLive: { habitat: 1, disc: 1, fuel: 1, warehouse: 1 },
      // reakcja łańcuchowa w sieci paliwowej: start z zbiorników / z habitatu, wypalone węzły, okręty zniszczone
      chain: { fuel: false, habitat: false, killed: 0, burnt: new Set() },
      // Okręt jeszcze w stanowisku (nie wystartował) — tylko taki ginie od frontu ognia w rurach.
      inBerth(n) { return !!n && !n.__storyLaunched; },
      parkedCount() { return site.parkedList.length; },
      // Zmiażdżony = zniszczony albo z kadłuba została mniej niż trzecia część konstrukcji.
      parkedCrushed(n) { return !!n && (n.dead || n.hp <= 0 || (self.deps.hullRatio?.(n) ?? 1) < 0.3); },
      parkedKilled() { return site.parkedList.filter((n) => site.parkedCrushed(n)).length; },
      parkedTouching(n) { return !!n && !!self.deps.hasContact?.(self.deps.ship(), n); },
      // rząd do taranu (samouczek): okręty z załogą na zewnętrznej stronie poprzeczki T (ramiona A i B)
      ramList() { return site.parkedList.filter((n) => site.ramBerths.includes(n.__berthId)); },
      // taran: uderzenie w ciało bazy (gra ustawia gateRammed) albo dotknięty okręt w stanowisku
      gateRammed: false,
      // (okręt w remoncie stoi z niepełnymi punktami — porównanie z punktami ze spawnu)
      rammed() { return site.gateRammed || site.parkedList.some((n) => n.dead || n.hp < (n.__hp0 ?? n.maxHp ?? n.hp) * 0.995 || self.deps.hasContact?.(self.deps.ship(), n)); },
      turretCount() { return 0; },
      turretsAlive() { return 0; },
      turretsKilled() { return 0; },
      defenderCount() { return site.defenderList.length; },
      defendersAlive() { return site.defenderList.filter((n) => !n.dead && n.hp > 0).length; },
      defendersKilled() { return site.defenderCount() - site.defendersAlive(); },
      buildingHpFrac() { const s = site.station; return s ? clamp01((s.hp || 0) / Math.max(1, s.maxHp || 1)) : 0; },
      buildingDestroyed() { const s = site.station; return !s || !!s._destroyed3D || s.hp <= 0; },
      structureDestroyed(k) { const s = site.structures?.[k]; return !s || !!s._destroyed3D || !(s.hp > 0); }
    };
    // Skąd przychodzi odwet: dalej od Słońca, za bazą.
    const sun = this.deps.sun?.() || { x: 0, y: 0 };
    const out = Math.atan2(center.y - sun.y, center.x - sun.x);
    site.origin = { x: center.x + Math.cos(out + 0.4) * 900000, y: center.y + Math.sin(out + 0.4) * 900000 };
    this.site = site;
    return site;
  },

  /** opts: { dockHp, dockShield (habitat), repairHp (ułamek punktów okrętu w remoncie) }. */
  _spawnSite(site, opts = {}) {
    const d = this.deps;
    const T = PIRATE_BASE_TUNE;
    const place = site.dock;
    const l = place.layout;
    const hp = { ...T.hp };
    if (Number(opts.dockHp) > 0) hp.habitat = { ...hp.habitat, hp: opts.dockHp, shield: Number(opts.dockShield) >= 0 ? opts.dockShield : hp.habitat.shield };
    const names = { habitat: 'Habitat piratów', fuel: 'Zbiorniki paliwa', warehouse: 'Magazyn piratów', piers: 'Pomosty bazy' };
    const specs = {};
    for (const k of PIRATE_BASE_STRUCTURES) {
      // środek budowli: średnia środków pudeł jej kawałków (bez duchów)
      let sx = 0, sz = 0, n = 0;
      for (const id of l.structures[k]) {
        const c = l.chunkById.get(id);
        if (c.ghost) continue;
        sx += (c.box.x0 + c.box.x1) / 2; sz += (c.box.z0 + c.box.z1) / 2; n++;
      }
      const g = k === 'habitat' ? place.habitat : place.toGame(sx / Math.max(1, n), sz / Math.max(1, n));
      specs[k] = { id: `PIR_BASE_${k.toUpperCase()}`, structure: k, name: names[k], x: g.x, y: g.y, r: 600,
        hp: hp[k].hp, shield: hp[k].shield, steps: hp[k].steps, base: place };
    }
    let st = d.spawnPirateBase ? d.spawnPirateBase(specs, place) : null;
    if (!st) {
      // bez kleju bazy (atrapy testów): zwykłe stacje pirackie w środkach budowli
      st = {};
      for (const k of PIRATE_BASE_STRUCTURES) st[k] = d.spawnPirateStation?.({ ...specs[k], hp: specs[k].hp + specs[k].shield }) || null;
    }
    site.structures = st;
    site.station = st.habitat;
    const repairHp = Number(opts.repairHp ?? T.repairHp);
    site.parked.forEach((p) => {
      const e = this._spawnOne(p.key, 'pirate', p.x, p.y, p.angle);
      if (!e) return;
      e.__dockBerth = p.index;
      e.__berthId = p.berth;
      e.__storyKey = p.key;
      e.__storyLaunch = p.launch || null;
      if (p.boss) {
        // herszt: supercapital w zatoce przy zbiornikach — na alarm startuje pierwszy (trasa z planu)
        e.__storyFlagship = true;
        site.flagship = e;
        this._park(e, 'defender');
        site.defenderList.unshift(e);
        return;
      }
      if (p.repair) {
        if (repairHp > 0 && repairHp < 1 && Number.isFinite(e.maxHp)) e.hp = Math.max(1, Math.round(e.maxHp * repairHp));
        e.__repair = true;
        e.__hp0 = e.hp;
        this._park(e, 'repair');
        site.repairList.push(e);
      } else {
        this._park(e, 'parked');
        site.crewList.push(e);
      }
      site.parkedList.push(e);
    });
  },

  _spawnOne(key, mode, x, y, angle) {
    const res = this.deps.spawnShip(key, { mode, spawnPos: { x, y }, pos: { x, y }, spawnAngle: angle, angle });
    const e = Array.isArray(res) ? res[0] : res;
    if (!e) return null;
    e.angle = angle; e.desiredAngle = angle;
    e.vx = 0; e.vy = 0;
    if (e.vel) { e.vel.x = 0; e.vel.y = 0; }
    if (e.pos) { e.pos.x = x; e.pos.y = y; }
    e.x = x; e.y = y;
    return e;
  },

  _park(e, tag) {
    e.__storyTag = tag;
    e.mission = true;
    // Okręt w stanowisku / na pochylni / w hali stoi z WYŁĄCZONYMI silnikami (etap E2): wylot z doku zaczyna się
    // zapłonem z dymem (storyNpcControl.launch, zegar wodowania — site.ignite przed startem).
    setEngineState(e, ENGINE_OFF);
    this.deps.sleepNpc(e);
  },

  _alarm(site) {
    if (site.alarmed) return;
    site.alarmed = true;
    site.alarmAt = this.time;
    const d = this.deps;
    // herszt startuje pierwszy (rufą z zatoki, potem wzdłuż zatoki — trasa z planu bazy)
    const boss = site.flagship;
    if (boss && !boss.dead) {
      const L = boss.__storyLaunch;
      boss.__storyLaunched = true;
      if (L && Array.isArray(L.path) && L.path.length && d.launchNpc) d.launchNpc(boss, L.path, PIRATE_BASE_TUNE.bossLaunchDelay, { fightFrom: L.fightFrom });
      else d.wakeNpc(boss);
    }
    // drony z hangarów bębna (decyzja użytkownika 2026-10-11: „gracz wykryty — lecą drony”)
    this._launchDrones(site, 0);
    d.shake?.(10, 0.4);
  },

  // Fala dronów: eskadra z każdego hangaru bębna habitatu (zniszczony habitat — nic), kolejna po droneWaveGap s.
  _launchDrones(site, wave) {
    const T = PIRATE_BASE_TUNE;
    if (wave >= T.droneWaves || site.buildingDestroyed()) return;
    site.droneWave = wave + 1;
    const d = this.deps;
    const n = Math.min(site.bays?.length || 0, T.droneBays);
    for (let i = 0; i < n; i++) {
      const b = site.bays[i];
      const roles = T.droneRoles || ['multirole'];
      const role = roles[(i + wave) % roles.length];
      const list = d.launchDrones?.({ x: b.x, y: b.y, angle: b.angle, count: T.droneSquad, owner: site.station, role }) || [];
      for (const e of list) {
        if (!e) continue;
        e.__storyTag = 'drone';
        e.mission = true;
        site.droneList.push(e);
        site.defenderList.push(e);
      }
    }
    if (wave + 1 < T.droneWaves) this._after(T.droneWaveGap, () => this._launchDrones(site, wave + 1));
  },

  _scouted(site) {
    const seen = this.deps.fogSeen;
    if (!seen) return true;
    const ok = (e) => !!e && !e.dead && !!seen(e);
    return Object.values(site.structures || {}).some(ok) || site.parkedList.some(ok) || site.defenderList.some(ok);
  },

  _detected(site) {
    // Fregata zwiadu (bez maskowania): obrona wykrywa ją bliżej niż `scoutDetect` od obwiedni bazy albo od okrętu
    // z załogą / obrońcy — misja ma własną regułę (piraci w stanowiskach śpią do alarmu).
    // Zamaskowana fregata (I przy jej sterach) — niewidoczna dla obrony.
    const fr = this.deps.scoutBay?.()?.npc;
    if (fr && !fr.dead && !isCloakHidden(fr) && site.dock) {
      const fx = fr.pos ? fr.pos.x : fr.x;
      const fy = fr.pos ? fr.pos.y : fr.y;
      const Rf = PIRATE_BASE_TUNE.scoutDetect;
      if (site.dock.distance(fx, fy) < Rf) return true;
      const nearF = (e) => e && !e.dead && !e.__repair && Math.hypot((e.pos ? e.pos.x : e.x) - fx, (e.pos ? e.pos.y : e.y) - fy) < Rf;
      if (site.crewList?.some(nearF) || site.defenderList.some(nearF)) return true;
    }
    const ship = this.deps.ship();
    if (!ship || isCloakHidden(ship)) return false;
    const R = 9000;
    const near = (e) => e && !e.dead && Math.hypot((e.pos ? e.pos.x : e.x) - ship.pos.x, (e.pos ? e.pos.y : e.y) - ship.pos.y) < R;
    // baza: odległość od obwiedni (15 × 8,5 km), nie od środka
    if (site.dock ? site.dock.distance(ship.pos.x, ship.pos.y) < R
      : (site.station && Math.hypot(site.station.x - ship.pos.x, site.station.y - ship.pos.y) < R + 2000)) return true;
    return site.parkedList.some(near) || site.defenderList.some(near);
  },

  // Zniszczony habitat (finał misji): bęben pęka ćwiartkami, szyb, część techniczna i dysk mieszkalny „implodują”
  // (kawałki-duchy pękają ku środkowi), okna gasną od środka; sieć paliwowa zapala się od habitatu (_fuelChain 'H' —
  // bez śluz pełna reakcja). Promise — koniec rozpadu habitatu (reakcja w rurach biegnie dalej).
  _chainExplosion(site, opts = {}) {
    return new Promise((resolve) => {
      const d = this.deps;
      const place = site.dock;
      const l = place?.layout;
      let tLast = 0;
      const at = (t, fn) => { tLast = Math.max(tLast, t); this._after(t, fn); };
      if (!l?.habitat) {
        const c = site.building;
        at(0, () => d.reactorBlow?.({ x: c.x, y: c.y, size: 900 }));
        this._after(tLast + 1.2, resolve);
        return;
      }
      site.chain.habitat = true;
      const H = l.habitat;
      const hc = place.habitat;
      site.power.habitat = 0;
      site.power.disc = 0;
      at(0, () => { d.reactorBlow?.({ x: hc.x, y: hc.y, size: 640 }); d.shake?.(34, 0.9); });
      H.quadrants.forEach((q, i) => {
        const a = (q.a0 + q.a1) / 2;
        const p = place.toGame(Math.cos(a) * H.drumR * 0.8, Math.sin(a) * H.drumR * 0.8);
        at(0.25 + i * 0.3, () => { d.baseBreak?.(q.id, { power: 2.2, speed: 110, dir: 'out' }); d.reactorBlow?.({ x: p.x, y: p.y, size: 380 }); });
      });
      at(1.1, () => d.baseBreak?.('H-T', { power: 1.8, speed: 70, dir: 'in' }));
      at(1.5, () => d.baseBreak?.('H-C', { power: 2.4, speed: 60, dir: 'out' }));
      // winda kosmiczna spod dysku mieszkalnego puszcza: lina i głowica spadają na planetoidę, osada wybucha po kolei
      // (scenariusz — src/3d/portBuildings/pirateRockSite3D.js; prośba użytkownika 2026-10-15)
      at(1.5, () => d.rockCollapse?.());
      for (let k = 0; k < H.discSectors; k++) {
        const a = (k / H.discSectors) * Math.PI * 2;
        const p = place.toGame(Math.cos(a) * H.discR * 0.55, Math.sin(a) * H.discR * 0.55);
        at(1.9 + k * 0.28, () => {
          d.baseBreak?.(`D-${k + 1}`, { power: 1.6, speed: 90, dir: 'in' });
          d.reactorBlow?.({ x: p.x, y: p.y, size: 420 });
          d.shake?.(16, 0.5);
        });
      }
      // koniec: rozpad habitatu i ogień w rurach (od środka i — gdy biegnie — od zbiorników) wygasły
      let fuelDone = Promise.resolve();
      at(0.6, () => { fuelDone = this._fuelChain(site, 'H'); });
      // opts.waitFuel = false (misja pominięta skokiem dev) — bez czekania na ogień w rurach
      this._after(tLast + 1.5, () => { if (opts.waitFuel === false) resolve(); else Promise.all([fuelDone, site.chain.pending || null]).then(resolve); });
    });
  },

  // Reakcja łańcuchowa w rurach (src/game/story/pirateBaseFuel.js): harmonogram z węzła `start` ('P' — zbiorniki,
  // 'H' — habitat) wykonany zegarem gry; okręty w stanowiskach przy zaworach giną (wybuch z ich zbiorników — śmierć
  // okrętu w grze), rury pękają lokalnie, punkty pomostów / magazynu / habitatu spadają. Węzły już wypalone (inny start)
  // pomijane. Promise → liczba okrętów zniszczonych przez reakcję.
  _fuelChain(site, start = 'P') {
    const d = this.deps;
    const place = site.dock;
    const l = place?.layout;
    const ch = site.chain;
    if (!l?.fuel || (start === 'P' && (ch.fuel || ch.burnt.has('P')))) return Promise.resolve(ch.killed);
    if (start === 'P') ch.fuel = true;
    const plan = planFuelChain(l, start, { done: ch.burnt });
    const st = site.structures || {};
    const berthShip = new Map();
    for (const e of site.parkedList) if (e?.__berthId) berthShip.set(e.__berthId, e);
    const hit = (s, x, y, dmg) => {
      if (!s || !(s.hp > 0)) return;
      s.lastHitX = x;
      s.lastHitY = y;
      if (d.damageStation) d.damageStation(s, dmg);
      else s.hp = Math.max(0, s.hp - dmg);
    };
    let tLast = 0;
    for (const ev of plan.events) {
      if (ev.node) ch.burnt.add(ev.node);
      tLast = Math.max(tLast, ev.t);
      this._after(ev.t, () => {
        const p = place.toGame(ev.x, ev.z);
        switch (ev.kind) {
          case 'tank':
            site.power.fuel = 0;
            d.reactorBlow?.({ x: p.x, y: p.y, size: 900 });
            d.shake?.(40, 1.0);
            hit(st.fuel, p.x, p.y, 1e9);
            for (const id of l.structures.fuel) d.baseBreak?.(id, { power: 2.6, speed: 160, dir: 'out', from: p });
            this._blastShips(site, p, 2600);
            break;
          case 'warehouse':
            site.power.warehouse = 0;
            d.reactorBlow?.({ x: p.x, y: p.y, size: 520 });
            hit(st.warehouse, p.x, p.y, 1e9);
            this._structureCollapse(site, 'warehouse');
            break;
          case 'habitat':
            hit(st.habitat, p.x, p.y, 1e9);
            break;
          case 'junction':
            d.reactorBlow?.({ x: p.x, y: p.y, size: 260 });
            hit(st.piers, p.x, p.y, 2500);
            break;
          case 'sluice':
            d.reactorBlow?.({ x: p.x, y: p.y, size: 220 });
            break;
          case 'tap': {
            const e = berthShip.get(ev.berth);
            d.reactorBlow?.({ x: p.x, y: p.y, size: 150 });
            if (e && !e.dead && e.hp > 0 && site.inBerth(e)) { d.killNpc?.(e, 'fuel-chain'); ch.killed++; }
            break;
          }
          default:
            d.reactorBlow?.({ x: p.x, y: p.y, size: 130 });
            hit(st.piers, p.x, p.y, 1600);
        }
      });
    }
    const done = new Promise((resolve) => this._after(tLast + 1, () => resolve(ch.killed)));
    if (start === 'P') ch.pending = done;
    return done;
  },

  // Budowla bazy padła (punkty do zera: magazyn, pomosty): kawałki, które jeszcze stoją, pękają po kolei od budowli.
  _structureCollapse(site, key) {
    const d = this.deps;
    const place = site.dock;
    const l = place?.layout;
    const ids = l?.structures?.[key];
    if (!ids || site.collapsed?.[key]) return;
    (site.collapsed ||= {})[key] = true;
    if (key === 'warehouse') site.power.warehouse = 0;
    const gone = new Set(d.baseBrokenChunks?.() || []);
    let k = 0;
    for (const id of ids) {
      if (gone.has(id)) continue;
      const c = l.chunkById.get(id);
      const p = place.toGame((c.box.x0 + c.box.x1) / 2, (c.box.z0 + c.box.z1) / 2);
      this._after(0.15 + 0.35 * k++, () => {
        d.baseBreak?.(id, { power: 1.9, speed: 90, dir: 'out' });
        if (c.kind !== 'pier') d.reactorBlow?.({ x: p.x, y: p.y, size: 420 });
      });
    }
  },

  // Fala wybuchu zbiorników: okręty w stanowiskach w promieniu `r` (zatoka supercapitali, pomost paliwowy) giną.
  _blastShips(site, p, r) {
    for (const e of [...site.parkedList, ...(site.flagship ? [site.flagship] : [])]) {
      if (!e || e.dead || !(e.hp > 0) || !site.inBerth(e)) continue;
      const x = e.pos ? e.pos.x : e.x;
      const y = e.pos ? e.pos.y : e.y;
      if (Math.hypot(x - p.x, y - p.y) < r) { this.deps.killNpc?.(e, 'fuel-chain'); site.chain.killed++; }
    }
  },

  // Zasilanie bazy (okna, lampy): wartość płynna goni cel — gaśnie ~3 s (okna dysku od środka: faza z promienia).
  _stepSitePower(dt) {
    const s = this.site;
    if (!s?.power || !s.powerLive) return;
    for (const k in s.power) {
      const a = s.powerLive[k];
      const b = s.power[k];
      if (a !== b) s.powerLive[k] = b < a ? Math.max(b, a - dt * 0.3) : Math.min(b, a + dt * 0.6);
    }
  },

  // ================================================================ API SKRYPTU
  _api() {
    const self = this;
    const d = this.deps;
    const ship = () => d.ship();
    const dist = (p) => { const s = ship(); return p ? Math.hypot(s.pos.x - p.x, s.pos.y - p.y) : Infinity; };
    const api = {
      tutorial: this.tutorial,
      startPhase: this.startPhase,
      // Miejsce fazy w kampanii (skoki dev: fazy przed ?story=<faza> są pomijane).
      phaseIndex: (p) => STORY_PHASES.indexOf(p),
      // Czas gry skryptu [s] (zegar reżysera — stoi w pauzie).
      time: () => self.runner.time,
      // Stan kampanii między misjami (wynik misji 1 dla misji 2).
      get campaign() { return self.campaign; },
      say: (lines, mode) => self._say(lines, mode),

      ui: {
        objective(id, text, progress) {
          if (!id) { self.ui.objective = null; return; }
          self.ui.objective = { id, text: String(text || ''), progress: typeof progress === 'function' ? progress : null, since: self.time };
          if (self.journalEntry) {
            self.journalEntry.objective = String(text || '');
            d.onMissionUpdated?.(self.journalEntry, 'progress');
          }
        },
        hint(spec, until) {
          if (!spec) { self.ui.hint = null; return; }
          self.ui.hint = { spec, until: typeof until === 'function' ? until : null, done: false, doneAt: 0, shownAt: self.time };
        },
        // options.action: { mouse: 'rmb' | 'lmb', text } — podpowiedź akcji przy znaczniku (ikona myszy);
        // options.journal = false — znacznik pomocniczy (np. mostek celu), dziennik i CIC go nie śledzą.
        marker(id, point, label = '', options = {}) {
          if (!point) { self.ui.markers.delete(id); return; }
          const m = self.ui.markers.get(id);
          // znacznik ruchomy (co klatkę) — bez nowego obiektu, gdy etykieta ta sama
          if (m && m.label === label && options.journal === false && !options.action) { m.x = point.x; m.y = point.y; return; }
          self.ui.markers.set(id, { x: point.x, y: point.y, label, action: options.action || null });
          if (self.journalEntry && options.journal !== false) self.journalEntry.pos = { x: point.x, y: point.y };
        },
        // Cel bojowy wskazany przez skrypt misji; pozycję i stan czyta HUD z encji, nie ze snapshotu.
        // options.group — nazwa grupy: cele grupy blisko siebie na ekranie dostają jeden wspólny podpis.
        target(id, entity, label = '', options = {}) {
          if (!entity) { self.ui.targets.delete(id); return; }
          self.ui.targets.set(id, { entity, label: String(label || ''), radius: Number(options.radius) || 0,
            group: String(options.group || '') });
          if (options.primary && self.journalEntry) {
            const p = entity.pos || entity;
            self.journalEntry.pos = { x: p.x, y: p.y };
          }
        },
        clearTargets() { self.ui.targets.clear(); },
        banner(text, sec = 3) { self.ui.banner = { text, until: self.time + sec }; },
        // Panel z przyciskiem (np. ODDOKUJ): spec { id, title, subtitle, label, busyLabel, key, rows: () => [[etykieta,
        // stan, klasa]] }. Promise — gracz kliknął (albo klawisz `key`). action(null) chowa panel.
        action(spec) {
          if (!spec) { self.ui.action = null; return Promise.resolve(); }
          return new Promise((resolve) => {
            self.ui.action = { ...spec, resolve, pressed: false, shownAt: self.time };
          });
        },
        summary(data) {
          return new Promise((resolve) => {
            self._freeze.add('summary');
            self._block.add('summary');
            self.ui.summary = { ...data, resolve, shownAt: self.time };
          });
        }
      },

      journal: {
        begin(M, steps) {
          const entry = {
            id: M.id, title: M.title, type: 'story', faction: 'terra_nova', factionLabel: 'Terra Nova',
            stationId: null, pos: null, location: 'Kampania',
            description: M.description, objective: steps[0] || '',
            objectives: steps.map((text) => ({ text, done: false })),
            rewardCredits: M.rewards?.credits || 0, rewardGranted: false, progress: 0,
            startedAt: d.gameTime?.() || 0, status: 'active', banner: M.banner || 'MISJA UKOŃCZONA'
          };
          self.mission = M;
          self.journalEntry = entry;
          d.addMission?.(entry);
          d.onMissionUpdated?.(entry, 'started');
        },
        step(i) {
          const e = self.journalEntry;
          if (!e || !e.objectives[i]) return;
          e.objectives[i].done = true;
          e.progress = e.objectives.filter((o) => o.done).length / e.objectives.length;
          const next = e.objectives.find((o) => !o.done);
          e.objective = next ? next.text : e.objective;
          d.onMissionUpdated?.(e, 'progress');
        },
        complete() {
          const e = self.journalEntry;
          if (!e) return;
          e.rewardGranted = true;   // nagrody wypłaca api.rewards
          d.completeMission?.(e.id, { rewardCredits: e.rewardCredits, banner: e.banner || 'MISJA UKOŃCZONA' });
        },
        fail(reason) {
          const e = self.journalEntry;
          if (!e) return;
          e.status = 'failed';
          e.failReason = reason;
          d.onMissionUpdated?.(e, 'failed');
        }
      },

      dock: {
        place: (berthId) => self._dockPlace(berthId),
        undock: () => self._undock(),
        release: () => self._dockRelease(),
        berthId: () => self.dock.berthId || 'C-01',
        // panel stanowiska: wiersze obsługi i krok odcumowania
        serviceRows: () => self._serviceRows(),
        // WYPOSAŻENIE w doku (D8 planu fitowania): terminal portu K-7 na zakładce kart — przed ODDOKUJ.
        openFitting: () => !!d.openFitting?.(),
        step: () => self.undockStep(),
        locked: () => !!self.lock,
        isOutside() {
          const earth = self.dock.planet || self._earth();
          const frame = self.dock.frame || (earth && k7FrameFor(earth, 0));
          if (!earth || !frame) return true;
          const s = ship();
          return k7IsOutsideHall(earth, frame, s.pos.x, s.pos.y);
        },
        approachPoint() {
          const earth = self._earth();
          const frame = earth && k7FrameFor(earth, 0);
          if (!frame) return { x: ship().pos.x, y: ship().pos.y };
          const l = k7LayoutTemplate();
          return k7HubToGame(earth, frame, -810, l.frontZ + l.apronDepth + 3500, {});
        },
        nearHall(r) { return dist(api.dock.approachPoint()) < r; }
      },

      cinema: {
        // Lot kamery z pozy menu nad K-7 (dach zamknięty) → kamera 2D gry w tym samym kadrze → otwarcie dachu.
        intro() {
          return new Promise((resolve) => {
            const s = ship();
            const earth = self._earth();
            const hc = earth && k7HallCenter(earth, 0);
            if (!hc) { resolve(); return; }
            const H = d.viewHeight?.() || 1080;
            const zoom = self.introFromMenu ? self.cine.revealZoom : H / self.REVEAL_VIEW_HEIGHT;
            self.cine.revealZoom = zoom;
            // kamera gry czeka już w kadrze końca toru (klasyczna, z góry, na Atlasie)
            d.forceClassicCamera?.();
            d.setGameCamera?.(s.pos.x, s.pos.y, zoom);
            d.setHallRoof?.({ key: 'earth', hall: 0, roofFade: 0, cut: 1 });
            self._freeze.add('cinema');
            self._block.add('cinema');
            self.setLetterbox(true);
            self.setHud(false);
            if (self.introFromMenu) {
              // lot był w tle menu (planMenuIntro) — gra zaczyna w jego ostatnim kadrze: od razu otwarcie dachu
              self.reveal = { t: 0, delay: self.REVEAL_DELAY_SEC, dur: self.REVEAL_SEC, resolve };
              return;
            }
            const { out } = k7AxesGame(hc.frame);
            const hall3 = { x: hc.x, y: -hc.y, outX: out.x, outY: -out.y };
            const sp = self._startPose(s, hall3);
            const keys = buildDockIntroKeys({
              start: sp.start,
              mid: sp.mid,
              hall: hall3,
              end: topDownPose(s.pos.x, s.pos.y, zoom, H, 30)
            });
            // chwila bez ruchu na rozjaśnienie ekranu
            for (const k of keys) k.t += 0.7;
            keys.unshift({ ...keys[0], t: 0 });
            self.cine.keys = keys;
            self.cine.t = 0;
            self.cine.duration = keysDuration(keys);
            self.cine.mode = 'path';
            self.cine.pathResolve = resolve;
            sampleKeys(keys, 0, self.cine.pose);
            self._freeze.add('cinema');
            self._block.add('cinema');
            self.setLetterbox(true);
            self.setHud(false);
          });
        },
        // Ujęcie w grze: kamera statku odjeżdża nad punkt świata, trzyma kadr i wraca (świat żyje; sterowanie
        // zablokowane na czas dojazdu). spec: { viewHeight (j. świata w pionie kadru), inSec, holdSec, outSec,
        // holdUntil() — kadr trzyma się do spełnienia warunku (holdSec = limit), wejście odblokowane w kadrze }.
        lookAt(point, spec = {}) {
          if (!point || !d.lookAt) return Promise.resolve();
          self._block.add('look');
          return new Promise((resolve) => {
            d.lookAt({
              ...spec, x: point.x, y: point.y,
              onArrive: () => { if (spec.holdUntil) self._block.delete('look'); },
              onDone: () => { self._block.delete('look'); resolve(); }
            });
          });
        },
        // Koniec ujęć fabularnych: pasy, HUD i sterowanie wracają.
        release() {
          self._endCinema();
          return Promise.resolve();
        },
        // Powrót: przez czerń do stanowiska, kamera gry z góry na zadokowanym Atlasie.
        async dockReturn(berthId = 'C-01') {
          await d.fadeScreen?.(true, 700);
          self._dockPlace(berthId);
          const s = ship();
          d.forceClassicCamera?.();
          d.setGameCamera?.(s.pos.x, s.pos.y, (d.viewHeight?.() || 1080) / self.REVEAL_VIEW_HEIGHT);
          d.releaseGameCamera?.();
          self._block.add('cinema');
          self.setLetterbox(true);
          self.setHud(false);
          d.fadeScreen?.(false, 900);
        }
      },

      site: {
        plan: () => self._planSite(),
        spawn: (site, opts) => self._spawnSite(site, opts),
        // Miejsce z misji 1 (misja 2 walczy nad jego gruzami).
        current: () => self.site,
        // Start okrętu ze stanowiska parkingu / pochylni (zegar wodowania): trasa z planu (rufą przez bramę
        // stanowiska, potem odlot; pochylnia — bramą G-01), brama stanowiska wypchnięta na zewnątrz.
        launch(site, e) {
          if (!e || e.dead || e.__storyLaunched) return false;
          e.__storyLaunched = true;
          const L = e.__storyLaunch;
          if (L && Array.isArray(L.path) && L.path.length && d.launchNpc) d.launchNpc(e, L.path, 0, { fightFrom: L.fightFrom });
          else d.wakeNpc(e);
          return true;
        },
        // Zapłon silników okrętu w stanowisku przed startem (zegar wodowania: start bez czekania na rozruch).
        ignite(e) {
          if (!e || e.dead || e.__storyLaunched) return false;
          return igniteEngine(e);
        },
        // Załoga przy działach: okręt w stanowisku strzela z miejsca (bez lotu), zanim wystartuje.
        arm(e) {
          if (!e || e.dead || e.__storyLaunched) return;
          if (d.armNpc) d.armNpc(e); else d.wakeNpc(e);
        },
        detected: (site) => self._detected(site),
        // Budowle bazy (habitat, zbiorniki, magazyn, pomosty) rozpoznane przez stronę gracza (mgła wojny; bez mgły — od razu).
        structureCount: (site) => Object.keys(site?.structures || {}).length,
        structuresSeen(site) {
          const seen = d.fogSeen;
          const list = Object.values(site?.structures || {});
          if (!seen) return list.length;
          let n = 0;
          for (const st of list) if (st && seen(st)) n++;
          return n;
        },
        // odległość od obwiedni bazy, od której cel misji ostrzega fregatę zwiadu
        scoutWarn: () => PIRATE_BASE_TUNE.scoutWarn,
        // Rozpoznanie przez mgłę wojny: budynek albo okręt stoczni widziany przez stronę gracza (bez mgły — od razu).
        scouted: (site) => self._scouted(site),
        alarm: (site) => self._alarm(site),
        chainExplosion: (site, opts) => self._chainExplosion(site, opts),
        // Reakcja łańcuchowa w rurach bazy (start: 'P' — zbiorniki, 'H' — habitat); Promise → okręty zniszczone.
        fuelChain: (site, start = 'P') => self._fuelChain(site, start),
        // Budowla bazy padła (magazyn, pomosty) — kawałki, które jeszcze stoją, pękają.
        collapse: (site, key) => self._structureCollapse(site, key)
      },

      // Fregata zwiadu w ładowni Atlasa (src/game/scoutBay.js — window.ScoutBay w grze; bez niej wszystko „nie ma”).
      scout: {
        grant() { const b = d.scoutBay?.(); if (!b?.grant) return false; if (!b.available()) self._scoutGranted = true; b.grant(); return b.available(); },
        available: () => !!d.scoutBay?.()?.available?.(),
        // fregata w świecie (start, lot, powrót), stery i kamera gracza na fregacie
        deployed: () => !!d.scoutBay?.()?.deployed?.(),
        controlling: () => !!d.scoutBay?.()?.controlling,
        // fregata zamaskowana (I przy jej sterach) — obrona jej nie wykrywa
        hidden: () => !!d.scoutBay?.()?.cloakHidden?.(),
        // w ładowni (także bez fregaty — nic nie leci)
        stowed: () => { const b = d.scoutBay?.(); return !b || !b.busy?.(); },
        launched: () => (d.scoutBay?.()?.stats?.launches || 0) > 0,
        lost: () => d.scoutBay?.()?.phase === 'lost',
        entity: () => d.scoutBay?.()?.npc || null,
        // odległość fregaty od obwiedni bazy (Infinity — fregaty nie ma w świecie)
        distanceTo(site) {
          const n = d.scoutBay?.()?.npc;
          if (!n || n.dead || !site?.dock) return Infinity;
          return site.dock.distance(n.pos ? n.pos.x : n.x, n.pos ? n.pos.y : n.y);
        },
        marks: () => (d.scoutBay?.()?.marks || []).filter((m) => !m.destroyed).length,
        recall: () => !!d.scoutBay?.()?.recall?.(),
        // Powrót fregaty do ładowni omija bazę: koło wokół obwiedni + zasięg wykrycia + zapas (ScoutBay.setAvoid).
        avoidBase(site) {
          const b = d.scoutBay?.();
          if (!b?.setAvoid || !site?.dock) return;
          b.setAvoid([{ x: site.building.x, y: site.building.y, r: site.dock.radius + PIRATE_BASE_TUNE.scoutDetect + PIRATE_BASE_TUNE.scoutAvoidMargin }]);
          self._scoutAvoid = true;
        },
        clearAvoid() { d.scoutBay?.()?.setAvoid?.(null); self._scoutAvoid = false; }
      },

      nav: {
        setCourse(x, y, label = '') {
          self.ui.course = { x, y, label };
          self.ui.markers.set('course', { x, y, label });
          d.setCourse?.(x, y, label);
          if (self.journalEntry) self.journalEntry.pos = { x, y };
        },
        clearCourse() {
          self.ui.course = null;
          self.ui.markers.delete('course');
          d.clearCourse?.();
        },
        inWarp: () => (d.warpState?.() || 'idle') !== 'idle',
        distanceTo: (p) => dist(p),
        // Zasadzka / zakłócacz (misja 2): wyrwanie z warpa — wyjście bez rampy i hamowanie jak przy studni
        // grawitacji; ładowanie skoku przerwane. true — warp był w toku.
        interdict: () => !!d.interdictWarp?.()
      },

      // Pas asteroid na kursie (misja 2 — zasadzka w drodze powrotnej, src/game/story/beltAmbush.js): miejsce na
      // cięciwie kursu od Atlasa do `to` (przy olbrzymie albo w najgęstszym polu) i wyzwalacz.
      belt: {
        ambushPlan(to) {
          const s = ship();
          const plan = s && to ? planBeltAmbush({
            from: s.pos, to, sun: d.sun?.(), belt: d.belt?.(),
            density: d.beltDensity || null, giants: d.beltGiants?.() || null
          }) : null;
          self.ambushPlan = plan;
          return plan;
        },
        reached(plan) {
          const s = ship();
          return !!s && beltAmbushReached(plan, s.pos, s.vel, d.sun?.(), d.belt?.());
        }
      },

      // Mgła wojny (src/game/fogOfWar.js, SensorSystem): sygnatury masy (czujniki grawitacyjne — miejsce i masa
      // bez tożsamości) i rozpoznanie bytu. Bez mgły (opcja) wszystko „widziane”, sygnatury rozpoznane od razu.
      fog: {
        enabled: () => !!d.fogEnabled?.(),
        seen: (e) => !!e && (d.fogSeen ? !!d.fogSeen(e) : true),
        mass(id, spec) {
          self._fogMassIds.add(id);
          return d.setMassSignature?.(id, spec) || null;
        },
        clearMass(id) {
          self._fogMassIds.delete(id);
          d.clearMassSignature?.(id);
        },
        massResolved: (id) => (d.massResolved ? !!d.massResolved(id) : true)
      },

      cloak: {
        enable(on) { const c = ship()?.cloak; if (c) c.enabled = !!on; },
        hidden: () => isCloakHidden(ship())
      },

      // Kierowanie ogniem gracza (src/game/fireControl.js): misja może wstrzymać wieże na auto
      // (podejście po cichu) i zwolnić je przy alarmie.
      fire: {
        hold(on) { d.setFireHold?.(!!on); }
      },

      fleet: {
        /** Okręt wyłączony z walki: zniszczony, bez dowodzenia (mostek — hulk) albo odleciał warpem. */
        gone: (e) => !e || !!e.dead || !(e.hp > 0) || !!e.warpedOut || api.fleet.isHulk(e),
        isHulk: (e) => !!e && (d.isHulk ? !!d.isHulk(e) : !!e.isBridgeHulk),
        hpFrac: (e) => (e && e.maxHp > 0 ? clamp01(e.hp / e.maxHp) : 1),
        /** Ucieczka (np. herszt przed skokiem): lot w punkt, działa strzelają dalej. */
        flee(e, point) {
          if (!e || e.dead || !point) return;
          if (d.fleeNpc) d.fleeNpc(e, point); else d.wakeNpc(e);
        },
        warpOut(list, origin) { return d.warpOut?.(list, origin) || 0; },
        /** Punkt mostka (słaby punkt okrętu) w świecie gry albo null. */
        bridgePoint: (e, out) => (d.bridgeAimPoint ? d.bridgeAimPoint(e, out) : null),
        /**
         * Fala piratów tunelem warpa: front `distance` od gracza w kierunku miejsca startu odwetu (site.origin)
         * obróconym o `bearing` [rad]. extra: [{ key, mark }] — okręty spoza szyku (np. supercapital herszta) na
         * końcu kolejki, w środku frontu; `mark` — pole-znacznik encji (np. '__storyBoss').
         * opts.at { x, y } — środek frontu wprost (np. zasadzka w pasie), szyk twarzą do gracza (albo `facing`);
         * opts.origin — skąd lecą tunele i dokąd ucieka fala (domyślnie site.origin).
         */
        pirateWave(site, counts, opts = {}) {
          const s = ship();
          const origin = opts.origin || site?.origin || null;
          let center, facing;
          if (opts.at && Number.isFinite(opts.at.x) && Number.isFinite(opts.at.y)) {
            center = { x: opts.at.x, y: opts.at.y };
            facing = Number.isFinite(opts.facing) ? opts.facing : Math.atan2(s.pos.y - center.y, s.pos.x - center.x);
          } else {
            const bearing = Number(opts.bearing) || 0;
            const toOrigin = Math.atan2(origin.y - s.pos.y, origin.x - s.pos.x) + bearing;
            // Front odwetu od gracza (SHIPYARD_TUNE.counterDistance): przy walce z ~1,6 km piraci potrzebują
            // chwili na dojście — to czas na salwy baterii głównej w nadlatujące okręty.
            const R = Number(opts.distance) > 0 ? opts.distance : SHIPYARD_TUNE.counterDistance;
            center = { x: s.pos.x + Math.cos(toOrigin) * R, y: s.pos.y + Math.sin(toOrigin) * R };
            facing = toOrigin + Math.PI;
          }
          const wave = planFleetWave(center, facing, counts, { battleshipKey: 'battleship', destroyerKey: 'destroyer' });
          for (const x of opts.extra || []) wave.push({ key: x.key, x: center.x, y: center.y, angle: facing, mark: x.mark || null });
          const g = self._makeGroup(opts.tag || 'counter', wave.length);
          const now = self.runner.time;
          wave.forEach((w, i) => self._arrivalQueue.push({ ...w, mode: 'pirate', origin, group: g, notBefore: now + i * 0.3 }));
          g.retreat = () => {
            g.retreating = true;
            const alive = g.members.filter((e) => e && !e.dead && !(e.hp <= 0) && !api.fleet.isHulk(e));
            d.warpOut?.(alive, origin);
          };
          return g;
        },
        pirateCounterAttack(site, counts) { return api.fleet.pirateWave(site, counts); },
        earthSupport(site, counts) {
          const s = ship();
          const origin = site.origin;
          const toOrigin = Math.atan2(origin.y - s.pos.y, origin.x - s.pos.x);
          const R = 4500;
          const center = { x: s.pos.x - Math.cos(toOrigin) * R, y: s.pos.y - Math.sin(toOrigin) * R };
          const wave = planFleetWave(center, toOrigin, counts, { battleshipKey: 'battleship', destroyerKey: 'destroyer' });
          const g = self._makeGroup('support', wave.length);
          const now = self.runner.time;
          wave.forEach((w, i) => self._arrivalQueue.push({ ...w, mode: 'friendly', origin: null, group: g, notBefore: now + i * 0.25 }));
          g.returnHome = () => d.returnWing?.();
          return g;
        }
      },

      // Atlas gracza: stan kadłuba i naprawa (misja 2 — przed odwetem). AGENT: naprawa w polu przez okręt
      // wsparcia z rojem dronów naprawczych (osobna sesja) — podmienić `repair`, skrypt misji zostaje.
      player: {
        pos: () => ({ x: ship().pos.x, y: ship().pos.y }),
        speed: () => { const v = ship().vel; return v ? Math.hypot(v.x, v.y) : 0; },
        hullFrac: () => clamp01(d.hullRatio ? d.hullRatio(ship()) : 1),
        repair: () => !!d.repairPlayer?.(),
        repairing: () => !!d.repairActive?.()
      },

      rewards: {
        grant(r) {
          const credits = Math.max(0, Math.round(Number(r.credits) || 0));
          if (credits) d.addCredits?.(credits);
          const rep = [];
          for (const [faction, delta] of Object.entries(r.rep || {})) {
            if (!delta) continue;
            d.changeReputation?.(faction, delta, self.mission?.title || 'Misja');
            rep.push({ faction, delta, label: d.factionLabel?.(faction) || faction });
          }
          const exp = grantExp(self.progress, r.exp || 0);
          const rp = rankProgress(self.progress);
          return { credits, rep, exp: exp.gained, totalExp: exp.exp, rank: rp.name, nextRank: rp.next, rankFrac: rp.frac, promoted: exp.promoted };
        }
      },

      // Skoki dev (?story=<faza>): stan świata jak po pominiętych fazach.
      dev: {
        teleport(x, y, angle) {
          const s = ship();
          d.placePlayer(x, y, Number.isFinite(angle) ? angle : s.angle);
        },
        kill(list) {
          for (const e of list || []) if (e && !e.dead) d.killNpc?.(e, 'story-skip');
        },
        destroyStation(st) {
          if (st && !st._destroyed3D) d.destroyStation?.(st);
        }
      }
    };
    return api;
  },

  _onPhase(name) {
    this.phase = name;
    this.deps.onPhase?.(name);
  }
};

export { isStoryCancelled };
