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
import { planFleetWave, planShipyard, SHIPYARD_TUNE } from './shipyardLayout.js';
import { createCloak, isCloakHidden } from '../cloak.js';
import { mission01, MISSION01 } from './missions/mission01.js';

const DEG = Math.PI / 180;
const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const smooth01 = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

function newPose() {
  return { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, fov: 40 };
}

export const STORY_PHASES = Object.freeze(['intro', 'briefing', 'undock', 'course', 'approach', 'ram', 'defences', 'shipyard', 'counter', 'victory', 'return', 'done']);

// Stany suwnic: płynne przejście między „podpięta” i „schowana”.
const CRANE_KEYS = ['bridge', 'trolley', 'lower', 'clamp', 'extension', 'lock', 'flow'];

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
  dock: { berthId: null, cranes: 1, craneTarget: 1, planet: null, frame: null },

  // --- UI ---
  ui: {
    objective: null,      // { id, text, progress: () => string }
    hint: null,           // { spec, until, done, doneAt, shownAt }
    markers: new Map(),   // id → { x, y, label }
    summary: null,        // { title, subtitle, reward, resolve }
    banner: null,         // { text, until }
    course: null          // { x, y, label }
  },

  _sayQueue: [],
  _timers: [],
  _arrivalQueue: [],
  _groups: [],
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
    this.runner.start(mission01, this._api()).then((result) => {
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
    this.dock.berthId = null; this.dock.cranes = 0; this.dock.craneTarget = 0;
    this.site = null;
    this.journalEntry = null;
    this.phase = null;
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
    this._stepCrane(dt);
    this._stepHint();
    if (this.ui.banner && this.time > this.ui.banner.until) this.ui.banner = null;
    this._applyHallState();
  },

  tick(gameDt) {
    if (!this.active || !this.runner) return;
    const dt = Math.max(0, Number(gameDt) || 0);
    if (dt > 0) this._stepTimers(dt);
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
    this.dock.cranes = 1;
    this.dock.craneTarget = 1;
    this.deps.placePlayer(pose.x, pose.y, pose.angle);
    this.lock = { x: pose.x, y: pose.y, angle: pose.angle, anim: null };
    this._block.add('dock');
    this._applyHallState(true);
    return true;
  },

  _dockRelease() {
    this.lock = null;
    this._block.delete('dock');
    this.dock.craneTarget = 0;
    this.dock.berthId = null;
    this._applyHallState(true);
  },

  // Suwnice i lampka stanowiska (hala 0 ringu Ziemi); stan w każdej klatce, bo ring po zbudowaniu zeruje stanowiska.
  _applyHallState(force = false) {
    const hall = this.deps.k7Hall?.(0);
    if (!hall) return;
    const berthId = this.dock.berthId || this._lastBerth;
    if (!berthId) return;
    this._lastBerth = berthId;
    const b = hall.layout?.berths?.find((x) => x.id === berthId);
    if (b) {
      const occ = this.dock.berthId ? 'player' : null;
      if (b.occupied !== occ || force) { b.occupied = occ; b.reserved = occ; hall.setBerthLamps?.(); }
    }
    const k = this.dock.cranes;
    if (!this._craneMap) this._craneMap = new Map();
    const pose = this._craneMap.get(berthId) || {};
    for (const key of CRANE_KEYS) pose[key] = k;
    pose.vent = 0;
    this._craneMap.set(berthId, pose);
    hall.setServicePoses?.(this._craneMap);
    if (k <= 0 && !this.dock.berthId) { this._craneMap.clear(); this._lastBerth = null; }
  },

  _stepCrane(dt) {
    const d = this.dock;
    if (d.cranes === d.craneTarget) return;
    const rate = dt / 2.6;
    d.cranes = d.craneTarget > d.cranes ? Math.min(d.craneTarget, d.cranes + rate) : Math.max(d.craneTarget, d.cranes - rate);
  },

  /** Wysunięcie ze stanowiska: suwnice puszczają, rufą w stronę bramy, obrót dziobem do bramy. */
  _undock() {
    return new Promise((resolve) => {
      const earth = this.dock.planet || this._earth();
      const frame = this.dock.frame || k7FrameFor(earth, 0);
      const L = this.lock;
      if (!earth || !frame || !L) { this._dockRelease(); resolve(); return; }
      const layout = k7LayoutTemplate();
      const berth = layout.berths.find((b) => b.id === (this.dock.berthId || 'C-01')) || layout.berths[0];
      const { out } = k7AxesGame(frame);
      const back = k7HubToGame(earth, frame, berth.x, 4700, {});
      const gateHeading = Math.atan2(out.y, out.x);
      this.dock.craneTarget = 0;
      const segs = [
        { dur: 2.8, x0: L.x, y0: L.y, a0: L.angle, x1: L.x, y1: L.y, a1: L.angle },                  // suwnice
        { dur: 6.0, x0: L.x, y0: L.y, a0: L.angle, x1: back.x, y1: back.y, a1: L.angle },            // rufą ku bramie
        { dur: 4.5, x0: back.x, y0: back.y, a0: L.angle, x1: back.x, y1: back.y, a1: gateHeading }   // obrót
      ];
      L.anim = { segs, i: 0, t: 0, resolve: () => { this._dockRelease(); resolve(); } };
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
    this.ui.course = null;
    if (this.ui.summary) { const r = this.ui.summary.resolve; this.ui.summary = null; r?.(); }
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
        onSpawned: (list) => job.group._onSpawned(list)
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
      alive() { return g.members.filter((e) => e && !e.dead && !e.warpedOut && !(e.hp <= 0)).length; },
      killed() { return g.members.filter((e) => e && (e.dead || e.hp <= 0) && !e.warpedOut).length; }
    };
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
    const ea = Math.atan2(earth.y - sun.y, earth.x - sun.x);
    // Obrzeża (decyzja użytkownika): za pasem i za orbitą Jowisza (50,2 AU mapy — jego ring i księżyce sięgają
    // ~250 tys. j.), przed Saturnem (80,6 AU). Kąt: jak najbliżej kierunku Ziemi (krótszy skok), z dala od planet.
    const r = Math.max(belt && belt.outer > 0 ? belt.outer + 8 * au : 0, 57 * au);
    const clear = 420000;
    const planets = d.planets?.() || [];
    let best = null;
    for (let i = -18; i <= 18; i++) {
      const a = ea + i * 0.06;
      const x = sun.x + Math.cos(a) * r, y = sun.y + Math.sin(a) * r;
      let minD = Infinity;
      for (const p of planets) {
        if (!p || p === earth) continue;
        const dd = Math.hypot(p.x - x, p.y - y);
        if (dd < minD) minD = dd;
      }
      // za blisko planety — kara rośnie szybko; dalej od Ziemi (kąt) — łagodnie
      const score = (minD >= clear ? 0 : (minD - clear) * 4) - Math.abs(i) * 0.06 * au;
      if (!best || score > best.score) best = { x, y, score };
    }
    return { x: best.x, y: best.y };
  },

  _planSite() {
    const center = this._shipyardCenter();
    const earth = this._earth() || this.deps.ship().pos;
    // obrys budynku (stacja piracka w skali gry) — rząd, wieżyczki i eskorta za nim
    const buildingRadius = Math.max(600, Number(this.deps.pirateStationVisualRadius?.(280)) || 1000);
    const plan = planShipyard(center, earth, { buildingRadius });
    const self = this;
    const site = {
      ...plan,
      station: null, parkedList: [], turretList: [], defenderList: [], alarmed: false, origin: null,
      parkedCount() { return site.parkedList.length; },
      // Zmiażdżony = zniszczony albo z kadłuba została mniej niż trzecia część konstrukcji (taran zostawia
      // resztkę z ułamkiem punktu — sufit punktów z konstrukcji nie schodzi do zera).
      parkedKilled() { return site.parkedList.filter((n) => n.dead || n.hp <= 0 || (self.deps.hullRatio?.(n) ?? 1) < 0.3).length; },
      rammed() { return site.parkedList.some((n) => n.dead || n.hp < (n.maxHp || n.hp) * 0.995 || self.deps.hasContact?.(self.deps.ship(), n)); },
      turretCount() { return site.turretList.length; },
      turretsAlive() { return site.turretList.filter((n) => !n.dead && n.hp > 0).length; },
      turretsKilled() { return site.turretCount() - site.turretsAlive(); },
      defenderCount() { return site.defenderList.length; },
      defendersAlive() { return site.defenderList.filter((n) => !n.dead && n.hp > 0).length; },
      defendersKilled() { return site.defenderCount() - site.defendersAlive(); },
      buildingHpFrac() { const s = site.station; return s ? clamp01((s.hp || 0) / Math.max(1, s.maxHp || 1)) : 0; },
      buildingDestroyed() { const s = site.station; return !s || !!s._destroyed3D || s.hp <= 0; }
    };
    // Skąd przychodzi odwet: dalej od Słońca, za stocznią.
    const sun = this.deps.sun?.() || { x: 0, y: 0 };
    const out = Math.atan2(center.y - sun.y, center.x - sun.x);
    site.origin = { x: center.x + Math.cos(out + 0.4) * 900000, y: center.y + Math.sin(out + 0.4) * 900000 };
    this.site = site;
    return site;
  },

  _spawnSite(site) {
    const d = this.deps;
    site.station = d.spawnPirateStation({ id: 'PIR_YARD', x: site.building.x, y: site.building.y, r: 280, hp: 16000, shield: 4000, name: 'Stocznia piratów' });
    for (const p of site.parked) {
      const e = this._spawnOne(p.key, 'pirate', p.x, p.y, p.angle);
      if (!e) continue;
      this._park(e, 'parked');
      site.parkedList.push(e);
    }
    for (const t of site.turrets) {
      const e = d.spawnTurret?.({ x: t.x, y: t.y, angle: t.angle });
      if (!e) continue;
      e.__storyTag = 'turret';
      e.mission = true;
      d.sleepNpc(e);
      site.turretList.push(e);
    }
    for (const p of site.defenders) {
      const e = this._spawnOne(p.key, 'pirate', p.x, p.y, p.angle);
      if (!e) continue;
      this._park(e, 'defender');
      site.defenderList.push(e);
    }
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
    this.deps.sleepNpc(e);
  },

  _alarm(site) {
    if (site.alarmed) return;
    site.alarmed = true;
    for (const e of site.turretList) if (!e.dead) this.deps.wakeNpc(e);
    for (const e of site.defenderList) if (!e.dead) this.deps.wakeNpc(e);
    this.deps.shake?.(10, 0.4);
  },

  _detected(site) {
    const ship = this.deps.ship();
    if (!ship || isCloakHidden(ship)) return false;
    const R = 9000;
    const near = (e) => e && !e.dead && Math.hypot((e.pos ? e.pos.x : e.x) - ship.pos.x, (e.pos ? e.pos.y : e.y) - ship.pos.y) < R;
    if (site.station && Math.hypot(site.station.x - ship.pos.x, site.station.y - ship.pos.y) < R + 2000) return true;
    return site.parkedList.some(near) || site.turretList.some(near) || site.defenderList.some(near);
  },

  _chainExplosion(site) {
    return new Promise((resolve) => {
      const d = this.deps;
      const c = site.building;
      // rozmiar wybuchu reaktora w j. świata (Atlas ≈ 280); zakład = seria po obwodzie, potem główny
      const pts = [{ x: c.x, y: c.y, size: 420, t: 0 }];
      for (let i = 0; i < 6; i++) {
        const a = site.axis + i * (Math.PI * 2 / 6) + 0.3;
        const r = 900 + (i % 2) * 700;
        pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, size: 240 + (i % 3) * 90, t: 0.35 + i * 0.32 });
      }
      pts.push({ x: c.x, y: c.y, size: 900, t: 2.5 });
      let tLast = 0;
      const victims = [...site.parkedList, ...site.turretList].filter((e) => e && !e.dead);
      victims.forEach((e, i) => {
        const t = 0.8 + i * 0.22;
        tLast = Math.max(tLast, t);
        this._after(t, () => { if (!e.dead) d.killNpc?.(e, 'shipyard-chain'); });
      });
      for (const p of pts) {
        tLast = Math.max(tLast, p.t);
        this._after(p.t, () => {
          d.reactorBlow?.({ x: p.x, y: p.y, size: p.size });
          d.shake?.(Math.min(40, 8 + p.size * 0.03), 0.6);
        });
      }
      this._after(tLast + 1.2, resolve);
    });
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
        marker(id, point, label = '') {
          if (!point) { self.ui.markers.delete(id); return; }
          self.ui.markers.set(id, { x: point.x, y: point.y, label });
          if (self.journalEntry) self.journalEntry.pos = { x: point.x, y: point.y };
        },
        banner(text, sec = 3) { self.ui.banner = { text, until: self.time + sec }; },
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
            startedAt: d.gameTime?.() || 0, status: 'active'
          };
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
          d.completeMission?.(e.id, { rewardCredits: e.rewardCredits, banner: 'ROZDZIAŁ 1 UKOŃCZONY' });
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
        spawn: (site) => self._spawnSite(site),
        detected: (site) => self._detected(site),
        alarm: (site) => self._alarm(site),
        chainExplosion: (site) => self._chainExplosion(site)
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
        distanceTo: (p) => dist(p)
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
        pirateCounterAttack(site, counts) {
          const s = ship();
          const origin = site.origin;
          const toOrigin = Math.atan2(origin.y - s.pos.y, origin.x - s.pos.x);
          // Front odwetu 18 km od gracza (dawniej 11 km): przy walce z ~1,6 km piraci potrzebują
          // 20–30 s na dojście — to czas na salwy baterii głównej w nadlatujące okręty.
          const R = SHIPYARD_TUNE.counterDistance;
          const center = { x: s.pos.x + Math.cos(toOrigin) * R, y: s.pos.y + Math.sin(toOrigin) * R };
          const facing = toOrigin + Math.PI;
          const wave = planFleetWave(center, facing, counts, { battleshipKey: 'battleship', destroyerKey: 'destroyer' });
          const g = self._makeGroup('counter', wave.length);
          const now = self.runner.time;
          wave.forEach((w, i) => self._arrivalQueue.push({ ...w, mode: 'pirate', origin, group: g, notBefore: now + i * 0.3 }));
          g.retreat = () => {
            g.retreating = true;
            const alive = g.members.filter((e) => e && !e.dead && !(e.hp <= 0));
            d.warpOut?.(alive, origin);
          };
          return g;
        },
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
