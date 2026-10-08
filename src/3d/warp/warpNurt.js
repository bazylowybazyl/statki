// src/3d/warp/warpNurt.js
//
// Warp „Nurt” w grze (zadanie 22 portu WebGPU; demo: dema/warp-webgpu.html, opis
// docs/webgpu/DEMO-WARP.md). Sterownik: co klatkę renderu (index.html, przed updatePlanets3D)
// czyta stan gry — automat warpa gracza (GameState.warp: ładowanie → skok → lot → wyjście),
// okręty NPC w warp-in (spawnPirateHeavyFleet: state 'warping_in') i zgłoszenia API (wezwania,
// harness) — i rozdaje efekt do Core3D:
//   • OŚRODEK (medium.js): krok compute 1/240 s w kroku efektów Core3D (addFxStep — klatka efektów
//     przed passami), render w passie warstwy 8 (Core3D.renderPassWarp). Bez baniek, szczelin
//     i wzbudzenia (~4 s po ostatniej) ośrodek ŚPI: zero dispatchy i zero draw calli;
//   • SZCZELINY, BŁYSKI, SMUGI sylwetki (sprites.js) — warstwa 0 (ortho), jeden draw call na rodzaj;
//   • GWIAZDY (stars.js: WARP_STARS) i ZGIĘCIE TŁA (skyBend.js — materiał mgławicy);
//   • FALE — przezroczysta refrakcja, źródła zniekształceń „uber” (Core3D.fxDistortion().shock);
//   • KADŁUB — odsłanianie, szew, żar brzegu (entity.__warpHullU → materiał kadłuba, 04) i plazma
//     WARP z dysz (entity.__warpNurtMode → engineVfxSystem / warpPlume3D, 13).
// Rozgrywka bez zmian: efekt tylko słucha stanu gry (automat warpa, pozycje encji).
//
// PRZESTRZEŃ WIDOCZNA. Warp gry leci setki tysięcy j/s (biegi 10–80 tys. × strefa); ośrodek
// płynie z prędkością WIDOCZNĄ (bieg I 16 tys., wyżej 21 tys. j/s — player.js: WARP_FLOW), jak
// w demie. Kamera ośrodka (camM) idzie za kamerą gry z prędkością obciętą do tej granicy; drobiny
// żyją względem niej (kotwica = kamera — przesunięcie na krok), efekty zawieszone w przestrzeni
// widocznej (punkt skoku) też. Gwiazdy: limit przesuwu wzoru 14 tys. j/s (demo) w warpie.

import { Core3D } from '../core3d.js';
import { GameState } from '../../game/gameState.js';
import { planWarpFleetArrival, warpSizeScale } from '../../game/warpDrive.js';
import { getEntityHullSprite } from '../hexShips3D.js';
import { WarpMedium, BUBBLE_CAP, SEAM_CAP, MEDIUM_COUNT_DEFAULT, RULON_BOX } from './medium.js';
import { RiftSprites, GlowSprites, SmearPool, GLOW_ROUND, GLOW_LINE } from './sprites.js';
import { WarpFrame, newWarpSlot, cullWarpFrameToView } from './frame.js';
import { WarpPlayerFx, WARP_BUBBLE } from './player.js';
import { planWarpArrivalFx, warpArrivalFxState, planWarpDepartureFx, warpDepartureFxState, departFxPose, arrivalFxPose, setMovingBrake } from './arrivals.js';
import { setRulon, resetRulon, RULON_STATE } from './rulon.js';
import { WARP_WORLD_LENS, resetWarpWorldLens } from './worldLens.js';
import { WARP_STARS, WARP_STAR_CAMERA, resetWarpStars } from './stars.js';
import { writeWarpSkyBend, clearWarpSkyBend } from './skyBend.js';
import { entityWarpPaletteId } from './palette.js';
import * as THREE from 'three/webgpu';

export const WARP_STEP = 1 / 240;
const MAX_STEPS_PER_FRAME = 16;        // 1/15 s — dłuższa przerwa (zacięcie) nie nadrabia kroków
const MEDIUM_SLEEP_AFTER = 4.0;        // [s] od ostatniej bańki / szczeliny / poświaty
const MEDIUM_TAIL_FADE = 1.6;          // [s] końcówka przed uśpieniem — gaszenie resztek wzbudzenia
const CAMERA_JUMP = 60000;             // [j.] skok kamery (teleport, RTS) = nowa kotwica bez przepływu
const IDLE_FLOW_CAP = 60000;           // [j/s] poza warpem ośrodek nadąża za zwykłym ruchem kamery
const STAR_SPEED_CAP = 14000;          // [j/s] demo: kamera gwiazd w warpie
const ARRIVAL_CAP = 24;

const _v4 = () => new THREE.Vector4();

function entityHullLength(e) {
  const h = e?.beamHull;
  if (h && h.srcWidth > 0 && h.scale > 0) return h.srcWidth * h.scale;
  const sc = Number(e?.visual?.spriteScale) || 1;
  if (Number(e?.w) > 0) return e.w * sc;
  return Math.max(120, (Number(e?.radius) || 200) * 2.2);
}

function entityHullWidth(e) {
  const h = e?.beamHull;
  if (h && h.srcHeight > 0 && h.scale > 0) return h.srcHeight * h.scale;
  const sc = Number(e?.visual?.spriteScale) || 1;
  if (Number(e?.h) > 0) return e.h * sc;
  return entityHullLength(e) * 0.45;
}

/** Poza encji w świecie (gracz: poza interpolowana renderu; NPC: x/y — kanoniczne). */
function entityPose(e, out) {
  const isPlayer = e && e === GameState.ship;
  const ip = isPlayer && typeof window !== 'undefined' ? window.__interpShipPose : null;
  if (ip && Number.isFinite(ip.x)) {
    out.x = ip.x; out.y = ip.y; out.angle = ip.angle;
  } else if (Number.isFinite(e?.x) && Number.isFinite(e?.y)) {
    // NPC: x/y kanoniczne (pos/vel to lustro — memory „x kanoniczne”).
    out.x = e.x; out.y = e.y; out.angle = Number(e.angle) || 0;
  } else {
    out.x = Number(e?.pos?.x) || 0;
    out.y = Number(e?.pos?.y) || 0;
    out.angle = Number(e?.angle) || 0;
  }
  out.vx = Number(Number.isFinite(e?.vx) ? e.vx : e?.vel?.x) || 0;
  out.vy = Number(Number.isFinite(e?.vy) ? e.vy : e?.vel?.y) || 0;
  out.visible = !(e?.dead);
  return out;
}

export const WarpNurt = {
  initialized: false,
  enabled: true,
  time: 0,
  medium: null,
  rifts: null,
  glow: null,
  smears: null,
  frame: null,
  player: null,
  count: MEDIUM_COUNT_DEFAULT,
  // przestrzeń widoczna (ośrodek)
  camMX: 0, camMY: 0, prevCamMX: 0, prevCamMY: 0,
  anchorMX: 0, anchorMY: 0,
  prevCamX: NaN, prevCamY: NaN,
  // kamera gry względem statku gracza w poprzedniej klatce (offset riga w j. świata)
  _camOffX: NaN, _camOffY: NaN,
  flow: 0, flowX: 0, flowY: 0,
  stepAcc: 0,
  wakeT: 0,
  awake: false,
  // Ośrodek od nowa (jednorodne pudło) przed następnym krokiem: po przebudzeniu i po skoku kamery.
  _reseed: false,
  lastBusyT: -1e9,
  // przegródki ośrodka: stałe indeksy przez życie przegródki
  _slotBubble: new Array(BUBBLE_CAP).fill(null),
  _slotFreedAt: new Array(BUBBLE_CAP).fill(-1e9),
  _slotOf: new Map(),
  _slotStamp: 0,
  _packed: Array.from({ length: BUBBLE_CAP }, () => ({ x: 0, y: 0, dx: 1, dy: 0, R: 1, asp: 1, A: 0, front: 3, vx: 0, vy: 0, strain: 0, turb: 0, pullR: 1, pullGain: 0, release: false, jetSpeed: 0, heraldLen: 0, heraldGain: 0, excite: 1, rear: false })),
  _packedList: new Array(BUBBLE_CAP).fill(null),
  _releaseStep: new Int32Array(BUBBLE_CAP),
  _rearStep: new Int32Array(BUBBLE_CAP),
  _seamPacked: Array.from({ length: SEAM_CAP }, () => ({ x: 0, y: 0, dx: 1, dy: 0, halfLen: 0, halfWidth: 0, push: 0, flow: 0 })),
  _seamCount: 0,
  // plan kroków tej klatki (wykonuje krok efektów Core3D)
  _steps: Array.from({ length: MAX_STEPS_PER_FRAME }, () => ({ sx: 0, sy: 0, t: 0, back: 0 })),
  _stepCount: 0,
  // przyloty / odloty NPC
  arrivals: [],
  _seenWarpIn: new WeakSet(),
  _pose: { x: 0, y: 0, angle: 0, vx: 0, vy: 0, visible: true },
  _hullTouched: new Set(),
  _hullTouchedPrev: new Set(),
  _lensPx: Array.from({ length: 8 }, () => ({ x: 0, y: 0, ax: 1, ay: 0, a: 1, b: 1, amp: 0, front: 3 })),
  _seamPx: Array.from({ length: 8 }, () => ({ x: 0, y: 0, ax: 1, ay: 0, halfLen: 1, band: 1, amp: 0 })),
  _col: [0, 0, 0],
  _playerGame: { state: 'idle', charge: 0, gear: 1, speed: 0, angle: 0, x: 0, y: 0, length: 0, width: 0, palette: 'magenta', vRelX: 0, vRelY: 0, flyby: 1, cruise: 0 },
  _map: { camX: 0, camY: 0 },
  _view: { bufW: 1, bufH: 1, focal: 1, camZ: 1 },
  _rulonArgs: { bend: 0, field: 0, hx: 1, hy: 0, shipX: 0, shipY: 0, bubbleW: 50, bubbleL: 70, W: 1, H: 1, F: 1, strength: 1 },
  _medCtx: { camMX: 0, camMY: 0, flow: 0, flowX: 0, flowY: 0 },
  _fxStep: null,
  onShake: null,
  stats: { awake: false, steps: 0, stepsTotal: 0, releases: 0, bubbles: 0, seams: 0, rifts: 0, glows: 0, smears: 0, waves: 0, arrivals: 0, flow: 0, lens: 0 },

  /** Tworzy zasoby i rejestruje krok compute (raz). Wołać po Core3D.init(). */
  init(opts = {}) {
    if (this.initialized || !Core3D.isInitialized || !Core3D.scene) return this;
    this.count = Math.max(4096, Math.floor(Number(opts.count) || this.count));
    this.medium = new WarpMedium({ count: this.count });
    this.rifts = new RiftSprites();
    this.glow = new GlowSprites();
    this.smears = new SmearPool(8);
    this.frame = new WarpFrame();
    this.player = new WarpPlayerFx();
    this.player.bubble = newWarpSlot();
    this.player.push = newWarpSlot();
    this.player.onShake = (mag, dur) => this.onShake?.(mag, dur);
    Core3D.scene.add(this.medium.mesh);
    this.rifts.mesh.layers.set(0);
    this.glow.mesh.layers.set(0);
    Core3D.scene.add(this.rifts.mesh);
    Core3D.scene.add(this.glow.mesh);
    for (const it of this.smears.items) { it.mesh.layers.set(0); Core3D.scene.add(it.mesh); }
    this._fxStep = {
      name: 'warpNurt',
      warm: (ctx) => this._warm(ctx),
      update: (ctx) => this._runSteps(ctx)
    };
    Core3D.addFxStep(this._fxStep);
    this.initialized = true;
    if (typeof window !== 'undefined') window.WarpNurt = this;
    return this;
  },

  // Rozgrywka potoków przy gotowym urządzeniu: drobiny od razu na GPU (ziarno stałe —
  // powtarzalnie), kernele i materiały skompilowane — pierwszy skok bez przestoju.
  _warm(ctx) {
    const renderer = ctx.renderer;
    if (!renderer || !this.medium) return;
    this.medium.setCount(renderer, this.count, 1);
    this.medium.warm(renderer);
    const med = this.medium.mesh;
    Core3D.prewarmPass(med, 8);
    const touch = [this.rifts, this.glow];
    for (const s of touch) { s.geo.instanceCount = 1; s.mesh.visible = true; }
    const sm = this.smears.items[0].mesh;
    sm.visible = true;
    Promise.all([Core3D.prewarmPass(this.rifts.mesh, 0), Core3D.prewarmPass(this.glow.mesh, 0), Core3D.prewarmPass(sm, 0)])
      .finally(() => {
        for (const s of touch) { if (s.count === 0) { s.geo.instanceCount = 0; s.mesh.visible = false; } }
        if (this.smears.count === 0) sm.visible = false;
      });
    for (const s of touch) { if (s.count === 0) { s.geo.instanceCount = 0; s.mesh.visible = false; } }
    if (this.smears.count === 0) sm.visible = false;
  },

  /**
   * Klatka efektu. o = { dt (czas gry — 0 w pauzie), cam (kamera gry bez wstrząsu: x, y, zoom),
   * camShake (kamera renderu, ze wstrząsem), camFollow (kamera statku bez przejścia — kamera =
   * statek + offset riga), ship, warp (GameState.warp), npcs, zoneWarpMul }.
   */
  update(o) {
    if (!this.initialized || !this.enabled) { resetWarpWorldLens(); return; }
    const dt = Math.max(0, Math.min(0.1, Number(o.dt) || 0));
    this.time += dt;
    const t = this.time;
    const cam = o.cam;
    const camX = Number(cam?.x) || 0;
    const camY = Number(cam?.y) || 0;
    const zoom = Math.max(1e-4, Number(cam?.zoom) || 1);
    const frame = this.frame;
    frame.reset();

    const player = this.player;
    const map = this._map;
    map.camX = camX;
    map.camY = camY;
    const med = this._medCtx;
    med.camMX = this.camMX;
    med.camMY = this.camMY;

    // --- skok gracza: przejścia automatu (przed ruchem kamery ośrodka — prędkość widoczna) ---
    const ship = o.ship;
    const warp = o.warp;
    const g = this._playerGame;
    const hasPlayer = !!(ship && !ship.dead && warp);
    if (hasPlayer) {
      const pose = entityPose(ship, this._pose);
      g.state = warp.state;
      g.charge = warp.chargeTime > 0 ? Math.min(1, (Number(warp.charge) || 0) / warp.chargeTime) : 0;
      g.chargeTime = Number(warp.chargeTime) || 0.8;
      g.gear = warp.gear || 1;
      g.speed = Math.sqrt(pose.vx * pose.vx + pose.vy * pose.vy);
      g.angle = warp.state === 'active' && warp.dir && (warp.dir.x || warp.dir.y) ? Math.atan2(warp.dir.y, warp.dir.x) : pose.angle;
      g.x = pose.x;
      g.y = pose.y;
      g.length = entityHullLength(ship);
      g.width = entityHullWidth(ship);
      g.palette = entityWarpPaletteId(ship);
      g.entity = ship;
      g.exitRamp = warp.exitRamp || null;
      g.flyby = Number.isFinite(warp.flybyFactor) ? warp.flybyFactor : 1;
      g.cruise = Number(warp.cruise) || Number(warp.speed) || 0;
      player.advance(t, dt, g, map, med);
    } else {
      player.reset();
    }

    // --- przestrzeń widoczna: kamera ośrodka ---
    // W skoku i przy wyjściu prędkość WIDOCZNA wzdłuż kursu (player.js — demo: 900 → bieg w 0,45 s,
    // przy wyjściu do ~0 w 0,25 s), poza nimi prawdziwy ruch kamery gry (z sufitem).
    this.prevCamMX = this.camMX;
    this.prevCamMY = this.camMY;
    let dx = camX - this.prevCamX;
    let dy = camY - this.prevCamY;
    let jumped = false;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx * dx + dy * dy > CAMERA_JUMP * CAMERA_JUMP) {
      // Inne miejsce świata: ślad poprzedniego skoku (rozrzedzenie, warkocz) nie może tu zostać.
      dx = 0; dy = 0;
      this._reseed = true;
      jumped = true;
    }
    this.prevCamX = camX;
    this.prevCamY = camY;
    // Kamera gry względem statku (rig kamery: wyprzedzenie, kop warpa — zadanie 22-B). W skoku
    // kamera ośrodka = widoczna droga STATKU + zmiana tego offsetu, jak w demie (kamera = statek +
    // kurs · (wyprzedzenie − cofnięcie)): przy kopie statek odskakuje od drobin, a kamera go dogania,
    // i statek względem ośrodka jedzie gładko. Bańka dostaje prędkość STATKU (przepływ kamery +
    // ruch statku w kadrze, vRel = −zmiana offsetu / dt), smugi drobin — prędkość kamery (demo:
    // bańka = ship.vx, smugi = prędkość kotwicy). Tylko przy kamerze statku bez przejścia (camFollow).
    let offDX = 0;
    let offDY = 0;
    if (hasPlayer) {
      const offX = camX - g.x;
      const offY = camY - g.y;
      if (o.camFollow && !jumped && Number.isFinite(this._camOffX)) {
        offDX = offX - this._camOffX;
        offDY = offY - this._camOffY;
      }
      this._camOffX = offX;
      this._camOffY = offY;
      g.vRelX = dt > 0 ? -offDX / dt : 0;
      g.vRelY = dt > 0 ? -offDY / dt : 0;
    } else {
      this._camOffX = NaN;
      this._camOffY = NaN;
    }
    const vis = hasPlayer ? player.visibleFlow(t) : null;
    if (vis !== null) {
      dx = Math.cos(player.angle) * vis * dt + offDX;
      dy = Math.sin(player.angle) * vis * dt + offDY;
    } else {
      const cap = IDLE_FLOW_CAP * dt;
      const dl = Math.sqrt(dx * dx + dy * dy);
      if (dl > cap) { const k = cap / dl; dx *= k; dy *= k; }
    }
    this.camMX += dx;
    this.camMY += dy;
    if (dt > 0) {
      this.flowX = dx / dt;
      this.flowY = dy / dt;
      this.flow = Math.sqrt(this.flowX * this.flowX + this.flowY * this.flowY);
    }
    med.camMX = this.camMX;
    med.camMY = this.camMY;
    med.flow = this.flow;
    med.flowX = this.flowX;
    med.flowY = this.flowY;

    if (hasPlayer) {
      player.fill(t, g, frame, map, med);
      this._applyHull(ship, player.hull);
    }

    // --- przyloty NPC: warp-in piratów (spawnPirateHeavyFleet) ---
    const npcs = o.npcs;
    if (Array.isArray(npcs)) {
      for (let i = 0; i < npcs.length; i++) {
        const n = npcs[i];
        if (!n || n.dead || n.state !== 'warping_in' || this._seenWarpIn.has(n)) continue;
        this._seenWarpIn.add(n);
        this.arrive(n, { moving: true });
      }
    }
    this._updateArrivals(t, frame, camX, camY);

    // --- ośrodek: budzenie / sen, plan kroków ---
    // Tylko przegródki i szczeliny w zasięgu pudła ośrodka wokół kamery (daleki przylot go nie budzi).
    const view = this._viewParams(zoom);
    this._commitWorldLens(o, t, dt, camX, camY, zoom, view, hasPlayer);
    cullWarpFrameToView(frame, view.bufW * 0.5, view.bufH * 0.5, view.focal, view.camZ);
    const busy = frame.bubbles.length > 0 || frame.seams.count > 0 || frame.warpVis > 0.001;
    if (busy) {
      this.lastBusyT = t;
      if (!this.awake) this._wake();
    }
    const idleFor = t - this.lastBusyT;
    if (this.awake && idleFor > MEDIUM_SLEEP_AFTER) this.awake = false;
    let fade = frame.mediumFade;
    if (!busy && idleFor > MEDIUM_SLEEP_AFTER - MEDIUM_TAIL_FADE) fade = Math.max(fade, 3);
    this.medium.setFade(fade);
    this._stepCount = 0;
    if (this.awake && this.medium.initialized) this._planSteps(t, dt, frame);
    const drawMedium = this.awake && this.medium.initialized;
    Core3D.setWarpLayerActive(drawMedium);
    if (drawMedium) this._viewMedium(o, t, zoom);

    // --- rysowane w passie gry, fale, tło, gwiazdy ---
    this._commitSprites(camX, camY, zoom);
    this._commitWaves(camX, camY, zoom);
    this._commitSky(o, camX, camY, zoom);
    this._commitStars(o, camX, camY, zoom, ship);
    this._commitRulon(o, camX, camY, zoom);
    this._finishHulls();

    const s = this.stats;
    s.awake = drawMedium;
    s.steps = this._stepCount;
    s.bubbles = frame.bubbles.length;
    s.seams = frame.seams.count;
    s.rifts = frame.rifts.count;
    s.glows = this.glow.count;
    s.smears = this.smears.count;
    s.waves = frame.waves.count;
    s.arrivals = this.arrivals.length;
    s.flow = Math.round(this.flow);
    s.lens = frame.lens.count + frame.seamLens.count;
  },

  _wake() {
    this.awake = true;
    // Po śnie ośrodek od nowa: drobiny nie wracają same do równej gęstości (rozrzedzenie za
    // bańką czy zebrana nić zostałyby w tym miejscu na zawsze), a pudło mogło zmienić rozmiar.
    this._reseed = true;
    this.wakeT = this.time;
    // Kotwica = kamera ośrodka: drobiny (jednorodne pudło wokół kamery) zostają, gdzie były.
    this.anchorMX = this.camMX;
    this.anchorMY = this.camMY;
    this.stepAcc = 0;
  },

  _planSteps(t, dt, frame) {
    // Przegródki: stałe indeksy (tożsamość obiektu), zwolnione czekają 0,05 s (ośrodek je
    // „dogasza” w pustej przegródce).
    this._syncSlots(frame.bubbles, t);
    const accPrev = this.stepAcc;
    const n0 = dt > 0 ? Math.floor((accPrev + dt) / WARP_STEP) : 0;
    this.stepAcc = dt > 0 ? accPrev + dt - n0 * WARP_STEP : accPrev;
    let n = n0;
    // Ostatni krok przed klatką był w t0 − accPrev; kroki co WARP_STEP. Zacięcie (za dużo
    // kroków): ostatnie MAX kroków kończy się w chwili klatki (bez nadrabiania).
    let tFirst = t - dt - accPrev + WARP_STEP;
    if (n > MAX_STEPS_PER_FRAME) {
      n = MAX_STEPS_PER_FRAME;
      this.stepAcc = 0;
      tFirst = t - (n - 1) * WARP_STEP;
    }
    const t0 = t - dt;
    const invDt = dt > 0 ? 1 / dt : 0;
    for (let k = 0; k < BUBBLE_CAP; k++) { this._releaseStep[k] = -1; this._rearStep[k] = -1; }
    for (let i = 0; i < n; i++) {
      // Czas kroku i kamera ośrodka w nim (liniowo między klatkami).
      const ts = tFirst + i * WARP_STEP;
      const f = Math.min(1, Math.max(0, (ts - t0) * invDt));
      const cx = this.prevCamMX + (this.camMX - this.prevCamMX) * f;
      const cy = this.prevCamMY + (this.camMY - this.prevCamMY) * f;
      const st = this._steps[i];
      // Scena: x w prawo, y w górę (świat gry: y w dół). Zegar ośrodka od przebudzenia (mały —
      // faza zawirowań `prędkość · czas` bez utraty precyzji float32).
      st.sx = cx - this.anchorMX;
      st.sy = -(cy - this.anchorMY);
      st.t = ts - this.wakeT;
      // Przegródki (pakowane niżej raz na klatkę) mają pozycje z chwili t — krok cofa je o tyle.
      st.back = Math.max(0, t - ts);
      this.anchorMX = cx;
      this.anchorMY = cy;
      const tPrev = ts - WARP_STEP;
      for (let k = 0; k < BUBBLE_CAP; k++) {
        const b = this._slotBubble[k];
        if (!b) continue;
        if (this._releaseStep[k] < 0 && b.releaseT > tPrev && b.releaseT <= ts) this._releaseStep[k] = i;
        if (this._rearStep[k] < 0 && b.rearT > tPrev && b.rearT <= ts) this._rearStep[k] = i;
      }
    }
    this._stepCount = n;
    // Przegródki względem kamery ośrodka (scena).
    for (let k = 0; k < BUBBLE_CAP; k++) {
      const b = this._slotBubble[k];
      if (!b) { this._packedList[k] = null; continue; }
      const p = this._packed[k];
      p.x = b.x;
      p.y = -b.y;
      p.dx = Math.cos(b.angle);
      p.dy = -Math.sin(b.angle);
      p.R = b.R;
      p.asp = b.asp;
      p.A = b.A;
      p.front = b.front;
      p.vx = b.vx;
      p.vy = -b.vy;
      p.strain = b.strain;
      p.turb = b.turb;
      p.pullR = b.pullR;
      p.pullGain = b.pullGain;
      p.jetSpeed = b.jetSpeed;
      p.heraldLen = b.heraldLen;
      p.heraldGain = b.heraldGain;
      p.excite = b.excite;
      p.release = false;
      p.rear = false;
      this._packedList[k] = p;
    }
    const seams = frame.seams;
    const ns = Math.min(SEAM_CAP, seams.count);
    for (let j = 0; j < ns; j++) {
      const s = seams.items[j];
      const p = this._seamPacked[j];
      p.x = s.x;
      p.y = -s.y;
      p.dx = Math.cos(s.angle);
      p.dy = -Math.sin(s.angle);
      p.halfLen = s.halfLen;
      p.halfWidth = s.halfWidth;
      p.push = s.push;
      p.flow = s.flow;
    }
    this._seamCount = ns;
    // Kamera ośrodka w krokach tej klatki jedzie liniowo (cx, cy wyżej) — z tą prędkością
    // (scena: y w górę) krok cofa przegródki do swojej chwili (medium.js: bubbleBack).
    this.medium.setBubbleFlow(this.flowX, -this.flowY);
    this.medium.setCloudOrigin(this.camMX, -this.camMY);
    this.stats.stepsTotal += n;
  },

  // Krok efektów Core3D (raz na klatkę, przed passami): dispatche zaplanowanych kroków.
  _runSteps(ctx) {
    const n = this._stepCount;
    if (!n || !this.medium?.initialized) return;
    const renderer = ctx.renderer;
    const medium = this.medium;
    if (this._reseed) {
      // Jeden dispatch na całe pudło (to samo ziarno — powtarzalnie); kotwica = kamera ośrodka.
      medium.reset(renderer);
      this._reseed = false;
    }
    medium.setSeams(this._seamPacked, this._seamCount);
    for (let i = 0; i < n; i++) {
      let flags = false;
      for (let k = 0; k < BUBBLE_CAP; k++) {
        const p = this._packedList[k];
        if (!p) continue;
        const rel = this._releaseStep[k] === i;
        const rear = this._rearStep[k] === i;
        if (p.release !== rel || p.rear !== rear) { p.release = rel; p.rear = rear; flags = true; }
        if (rel || rear) this.stats.releases++;
      }
      if (i === 0 || flags) medium.setBubbles(this._packedList, BUBBLE_CAP);
      const st = this._steps[i];
      medium.step(renderer, WARP_STEP, st.t, st.sx, st.sy, st.back);
    }
    this._stepCount = 0;
  },

  _syncSlots(list, t) {
    const stamp = ++this._slotStamp;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      let k = this._slotOf.get(b);
      if (k === undefined) {
        k = -1;
        for (let j = 0; j < BUBBLE_CAP; j++) {
          if (!this._slotBubble[j] && t - this._slotFreedAt[j] > 0.05) { k = j; break; }
        }
        if (k < 0) continue;
        this._slotBubble[k] = b;
        this._slotOf.set(b, k);
      }
      b._stamp = stamp;
    }
    for (let j = 0; j < BUBBLE_CAP; j++) {
      const b = this._slotBubble[j];
      if (b && b._stamp !== stamp) {
        this._slotOf.delete(b);
        this._slotBubble[j] = null;
        this._slotFreedAt[j] = t;
      }
    }
  },

  // Widok ośrodka: siatka w kamerze gry, przesunięcie kamery ośrodka, dosunięcie, pudła.
  // Cel renderu [px], ogniskowa kamery perspektywy [px] i jej odległość od płaszczyzny gry [j.].
  // Soczewka świata (worldLens.js): planety i księżyce w skoku gracza — stan klatki, który
  // planet3d.assets.js (updatePlanets3D, po tym kroku) rozstawia na scenie. Kamera bez wstrząsu (tę
  // samą dostają planety), statek w pozie renderu; cel — planeta przy końcu odcinka (index.html:
  // planPlayerWarp). Bez skoku albo poza kamerą z góry jednego gracza (`lensAllowed`) — wyłączona.
  _commitWorldLens(o, t, dt, camX, camY, zoom, view, hasPlayer) {
    const p = this.player;
    const beta = hasPlayer && o.lensAllowed !== false ? p.lensBeta(t) : 0;
    if (!(beta > 0.0005)) { resetWarpWorldLens(); return; }
    const g = this._playerGame;
    const L = WARP_WORLD_LENS;
    L.active = true;
    L.beta = beta;
    L.speed = Math.max(1, Number(g.cruise) || 0);
    L.velAngle = p.angle;
    L.zoom = zoom;
    L.W = view.bufW;
    L.H = view.bufH;
    L.focal = view.focal;
    L.camZ = view.camZ;
    L.camX = camX;
    L.camY = camY;
    L.shipX = g.x;
    L.shipY = g.y;
    L.shipSx = (g.x - camX) * zoom;
    L.shipSy = (g.y - camY) * zoom;
    L.hullHalfLen = Math.max(0, Number(g.length) || 0) * zoom * 0.5;
    L.hullHalfWid = Math.max(0, Number(g.width) || 0) * zoom * 0.5;
    L.dt = dt;
    L.target = o.warp?.targetBody || null;
  },

  _viewParams(zoom) {
    const v = this._view;
    const rt = Core3D.composerTarget;
    v.bufW = Math.max(1, rt?.width || Core3D.width || 1);
    v.bufH = Math.max(1, rt?.height || Core3D.height || 1);
    const persp = Core3D.cameraPersp;
    v.focal = (v.bufH * 0.5) / Math.tan(THREE.MathUtils.degToRad((persp?.fov || 35) * 0.5));
    v.camZ = v.focal / Math.max(1e-4, zoom);
    return v;
  },

  _viewMedium(o, t, zoom) {
    const medium = this.medium;
    const cam = o.cam;
    const { bufW, bufH, focal, camZ } = this._view;
    // Zapas pudeł na rulon tylko na czas zwinięcia (poza skokiem gęstość jak przed rulonem).
    medium.setBoxes(zoom, bufW, bufH, focal, 1 + (RULON_BOX - 1) * Math.min(1, this.player.rulonBend));
    const mesh = medium.mesh;
    mesh.position.set(Number(cam.x) || 0, -(Number(cam.y) || 0), 0);
    // Przesunięcie kamery ośrodka względem ostatniego kroku (scena: y w górę).
    const offX = this.anchorMX - this.camMX;
    const offY = -(this.anchorMY - this.camMY);
    medium.setView(this.flowX, -this.flowY, offX, offY, this.stepAcc, bufW * 0.5, bufH * 0.5, zoom, camZ, t - this.wakeT, this.frame.warpVis);
  },

  // Szczeliny, błyski, smugi — scena względem kamery (mesh.position = kamera gry).
  _commitSprites(camX, camY, zoom) {
    const frame = this.frame;
    const rifts = this.rifts;
    const glow = this.glow;
    const smears = this.smears;
    rifts.begin();
    for (let i = 0; i < frame.rifts.count; i++) {
      const r = frame.rifts.items[i];
      // Brzeg cienki (~1–2 px) — jedyny element szczeliny nad progiem bloomu.
      const edge = Math.max(1.2 / zoom, r.halfWidth * 0.07);
      rifts.add(r.x, -r.y, Math.cos(r.angle), -Math.sin(r.angle), r.halfLen, r.halfWidth, edge,
        r.core, 2.6, r.body, 1.0, r.k, r.dirty, r.seed, 1.8, r.fill);
    }
    rifts.commit(this.time, camX, -camY);
    glow.begin();
    for (let i = 0; i < frame.flashes.count; i++) {
      const f = frame.flashes.items[i];
      const col = f.pal ? (f.raw ? f.pal.core : f.pal.glow) : FLASH_WHITE;
      const k = f.k * (f.raw ? 1.6 : 4.0);
      glow.add(f.x, -f.y, 8, f.size, col[0] * k, col[1] * k, col[2] * k, GLOW_ROUND);
    }
    for (let i = 0; i < frame.glares.count; i++) {
      const g = frame.glares.items[i];
      const col = g.pal.core;
      const thick = Math.max(1.6 / zoom, g.len * 0.004);
      const k = 3.2 * g.k;
      glow.add(g.x, -g.y, 9, thick, col[0] * k, col[1] * k, col[2] * k, GLOW_LINE, Math.cos(g.angle), -Math.sin(g.angle), g.len / thick, 0.5);
    }
    // Szew poza sylwetką (gracz przy wyjściu): cienka linia w poprzek kursu na linii frontu.
    this._seamLines(zoom);
    glow.commit(camX, -camY);
    smears.begin();
    for (let i = 0; i < frame.smears.count; i++) {
      const s = frame.smears.items[i];
      const tex = getEntityHullSprite(s.entity);
      if (!tex) continue;
      const c = Math.cos(s.angle);
      const sn = Math.sin(s.angle);
      // Przód smugi przy dziobie, reszta za rufą.
      const bowX = s.x + c * s.length * 0.5;
      const bowY = s.y + sn * s.length * 0.5;
      const cx = bowX - c * s.length * s.total * 0.5;
      const cy = bowY - sn * s.length * s.total * 0.5;
      const pc = s.pal.body;
      smears.add(tex, cx, -cy, -s.angle, s.length * s.total, s.width, pc[0], pc[1], pc[2], 1.4 * s.k);
    }
    smears.commit(camX, -camY);
  },

  _seamLines(zoom) {
    const glow = this.glow;
    const list = this._seamLineSrc;
    for (let i = 0; i < list.count; i++) {
      const s = list.items[i];
      const c = Math.cos(s.angle);
      const sn = Math.sin(s.angle);
      const px = s.x + c * s.line;
      const py = s.y + sn * s.line;
      const len = s.width * 1.12;
      const thick = Math.max(1.8 / zoom, s.width * 0.003);
      const col = s.rgb;
      const k = 0.2 * s.k;
      glow.add(px, -py, 6, thick, col[0] * k, col[1] * k, col[2] * k, GLOW_LINE, Math.sin(s.angle), Math.cos(s.angle), len / thick, 0.35);
    }
    list.count = 0;
  },

  _commitWaves(camX, camY, zoom) {
    const frame = this.frame;
    if (!frame.waves.count) return;
    const D = Core3D.fxDistortion?.();
    if (!D) return;
    for (let i = 0; i < frame.waves.count; i++) {
      const w = frame.waves.items[i];
      if (!(w.amp > 0.05)) continue;
      // Demo: szerokość ≥ 6 px, fala bez dyspersji (przesuwa wszystkie kanały razem).
      D.shock(camX + w.x, camY + w.y, w.r, Math.max(6 / zoom, w.width), w.amp, 0);
    }
  },

  // Zgięcie tła (mgławica): soczewka bańki gracza i szczeliny w pikselach celu (y w dół).
  _commitSky(o, camX, camY, zoom) {
    const frame = this.frame;
    const nl = frame.lens.count;
    const ns = frame.seamLens.count;
    if (!nl && !ns) { clearWarpSkyBend(); return; }
    const rt = Core3D.composerTarget;
    const bufW = Math.max(1, rt?.width || 1);
    const bufH = Math.max(1, rt?.height || 1);
    const shake = o.camShake || o.cam;
    const sx0 = camX - (Number(shake?.x) || camX);
    const sy0 = camY - (Number(shake?.y) || camY);
    const lens = this._lensPx;
    let li = 0;
    for (let i = 0; i < nl && li < lens.length; i++) {
      const l = frame.lens.items[i];
      if (!(l.amp > 0.01)) continue;
      const d = lens[li++];
      d.x = bufW * 0.5 + (l.x + sx0) * zoom;
      d.y = bufH * 0.5 + (l.y + sy0) * zoom;
      d.ax = Math.cos(l.angle);
      d.ay = Math.sin(l.angle);
      d.a = l.a * zoom;
      d.b = l.b * zoom;
      d.amp = l.amp;
      d.front = l.front;
    }
    const seams = this._seamPx;
    let si = 0;
    for (let j = 0; j < ns && si < seams.length; j++) {
      const s = frame.seamLens.items[j];
      const d = seams[si++];
      d.x = bufW * 0.5 + (s.x + sx0) * zoom;
      d.y = bufH * 0.5 + (s.y + sy0) * zoom;
      d.ax = Math.cos(s.angle);
      d.ay = Math.sin(s.angle);
      d.halfLen = s.halfLen * zoom;
      d.band = Math.max(4, s.band * zoom);
      d.amp = s.amp;
    }
    writeWarpSkyBend(lens, li, seams, si);
  },

  _commitStars(o, camX, camY, zoom, ship) {
    const st = this.frame.stars;
    const W = WARP_STARS;
    if (st.stretch > 0.0005) {
      const shake = o.camShake || o.cam;
      const scx = Number(shake?.x) || camX;
      const scy = Number(shake?.y) || camY;
      W.stretch.value = st.stretch;
      W.heading.value.set(Math.cos(st.angle), -Math.sin(st.angle));
      W.frontOn.value = st.frontOn;
      W.frontPx.value = st.frontS * zoom;
      W.shipPx.value.set((st.refX + camX - scx) * zoom, -(st.refY + camY - scy) * zoom);
      W.warpTint.value = st.warpTint;
    } else if (W.stretch.value !== 0) {
      resetWarpStars();
    }
    // Kamera gwiazd: w warpie (i póki statek po wyjściu leci szybciej) wzór nie szaleje.
    const p = this.player;
    let cap = 0;
    if (p.active || p.mode === 'exit') cap = STAR_SPEED_CAP;
    else if (ship && ship.vel && ship.vel.x * ship.vel.x + ship.vel.y * ship.vel.y > STAR_SPEED_CAP * STAR_SPEED_CAP) cap = STAR_SPEED_CAP;
    WARP_STAR_CAMERA.speedCap = cap;
  },

  // RULON (rulon.js): oś = kurs skoku przez statek (y w górę na ekranie), kieszeń = bańka gracza,
  // piksele = bufor celu sceny, F = ogniskowa kamery perspektywy ośrodka. Bez skoku — płasko.
  _commitRulon(o, camX, camY, zoom) {
    const p = this.player;
    if (!(p.rulonBend > 1e-4) || !p.active) { resetRulon(); return; }
    const st = this.frame.stars;
    const shake = o.camShake || o.cam;
    const scx = Number(shake?.x) || camX;
    const scy = Number(shake?.y) || camY;
    const v = this._view;
    const R = Math.max(40, this._playerGame.length || 1800) * WARP_BUBBLE.radiusK * zoom;
    const a = this._rulonArgs;
    a.bend = p.rulonBend;
    a.field = p.rulonField;
    a.hx = Math.cos(p.angle);
    a.hy = -Math.sin(p.angle);
    a.shipX = (st.refX + camX - scx) * zoom;
    a.shipY = -(st.refY + camY - scy) * zoom;
    a.bubbleW = R;
    a.bubbleL = R * WARP_BUBBLE.asp;
    a.W = v.bufW;
    a.H = v.bufH;
    a.F = v.focal;
    setRulon(a);
    // Rulon wciąga do kadru świat zza jego brzegu (cała gra się zgina — rulon.js): culling three
    // z płaszczyznami kadru odsuniętymi o szerokość kadru (dalej świat leży mikroskopijny przy horyzoncie
    // walca; 3 kadry = ~2× rysunków i kilka ms CPU w skoku — scripts/webgpu/travel-gra.mjs --bezCullingu).
    RULON_STATE.cullMargin = Math.max(v.bufW, v.bufH) / Math.max(1e-4, zoom);
  },

  /** Kadłub encji: odsłanianie / szew / żar (fx w j. świata) → Vector4 materiału (px sprite'a). */
  _applyHull(entity, fx) {
    if (!entity || !fx || !fx.on) return;
    const hull = entity.beamHull;
    const scale = hull && hull.scale > 0 ? hull.scale : 0;
    if (!(scale > 0)) return;
    let u = entity.__warpHullU;
    if (!u) u = entity.__warpHullU = { a: _v4(), b: _v4(), c: _v4() };
    const k = 1 / scale;
    const mode = fx.revealMode || 0;
    if (mode) u.a.set(fx.revealLine * k, mode, fx.seamLine * k, Math.max(0.5, fx.seamW * k));
    else u.a.set(-1e6, 1, fx.seamLine * k, Math.max(0.5, fx.seamW * k));
    const sk = fx.seam || 0;
    const rimPx = Math.max(1, fx.rimW * k);
    u.b.set(fx.seamRGB[0] * sk, fx.seamRGB[1] * sk, fx.seamRGB[2] * sk, Math.max(0, Math.min(8, Math.log2(rimPx))));
    u.c.set(fx.heatRGB[0], fx.heatRGB[1], fx.heatRGB[2], 1);
    this._hullTouched.add(entity);
    // Szew poza sylwetką (linia w poprzek kursu) tylko przy wyjściu gracza — jak w demie.
    if (fx === this.player.hull && sk > 0) {
      const pose = entityPose(entity, this._pose);
      const it = this._seamLineSrc.add();
      if (it) {
        it.x = pose.x - this._map.camX;
        it.y = pose.y - this._map.camY;
        it.angle = pose.angle;
        it.line = fx.seamLine;
        it.width = entityHullWidth(entity);
        it.k = sk;
        it.rgb[0] = fx.seamRGB[0]; it.rgb[1] = fx.seamRGB[1]; it.rgb[2] = fx.seamRGB[2];
      }
    }
  },

  // Encje, którym efekt zdjął odsłanianie / żar w tej klatce — trzymacze materiału wracają do „off”.
  _finishHulls() {
    for (const e of this._hullTouchedPrev) {
      if (!this._hullTouched.has(e) && e.__warpHullU) e.__warpHullU = null;
    }
    const prev = this._hullTouchedPrev;
    this._hullTouchedPrev = this._hullTouched;
    this._hullTouched = prev;
    this._hullTouched.clear();
  },

  // ── Przyloty i odloty NPC ──────────────────────────────────────────────────

  _updateArrivals(t, frame, camX, camY) {
    const list = this.arrivals;
    let shake = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const rec = list[i];
      const e = rec.entity;
      if (e && e.dead && rec.kind === 'arrival') { this._releaseDrive(rec); rec.entity = null; }
      if (rec.kind === 'arrival') {
        // Długość kadłuba znana dopiero po zbudowaniu siatki (warp-in piratów, wezwanie podpięte
        // w chwili pojawienia się) — przeliczenie PRZED próbką.
        if (rec.entity && !rec.sized && rec.entity.beamHull) this._resize(rec);
        const fx = rec.fx;
        const en = rec.entity;
        let pose = null;
        if (en) {
          // Warp-in prowadzony przez grę: hamowanie od chwili, gdy okręt wyszedł z 'warping_in'.
          if (fx.moving && fx.tBrake === Infinity && en.state !== 'warping_in') {
            const p0 = entityPose(en, this._pose);
            setMovingBrake(fx, t, Math.max(fx.v0, Math.sqrt(p0.vx * p0.vx + p0.vy * p0.vy)));
          }
          if (fx.drive && t < fx.tStop) {
            // Wlot i hamowanie prowadzi efekt (duch — bez zderzeń; okręt pojawia się za kadrem).
            if (!rec.driving) {
              rec.driving = true;
              rec.wasCollidable = en.isCollidable !== false;
              en.isCollidable = false;
            }
            const p = arrivalFxPose(fx, t, this._drivePose);
            this._writePose(en, p.x, p.y, p.vx, p.vy);
            en.angle = fx.angle;
            if (Number.isFinite(en.desiredAngle)) en.desiredAngle = fx.angle;
            en.angVel = 0;
          } else if (rec.driving) {
            // Zatrzymanie: okręt stoi w miejscu zwiastuna i wraca do gry.
            this._writePose(en, fx.x, fx.y, 0, 0);
            this._releaseDrive(rec);
          }
          pose = entityPose(en, this._pose);
        }
        const sh = warpArrivalFxState(fx, t, frame, camX, camY, pose);
        shake = Math.max(shake, sh);
        if (en) {
          if (t < fx.tAppear) this._hideHull(en);
          else this._applyHull(en, fx.hull);
          en.__warpNurtMode = fx.plasmaMode;
        }
        if (!rec.burstShaken && t >= fx.tBrake) {
          rec.burstShaken = true;
          this._burstShake(fx, camX, camY);
        }
        if (t > fx.tEnd) {
          this._releaseDrive(rec);
          if (rec.entity) rec.entity.__warpNurtMode = null;
          list.splice(i, 1);
        }
      } else {
        const d = rec.fx;
        let pose = null;
        if (e && !e.dead) {
          if (d.drive && t >= d.tDive) {
            // Efekt prowadzi okręt w rozpędzie (POWRÓT skrzydła na Ziemię — src/game/supportWarp.js;
            // harness). Okręt jest wtedy duchem (isCollidable = false), więc nikogo nie taranuje.
            const p = departFxPose(d, t, this._drivePose);
            this._writePose(e, p.x, p.y, p.vx, p.vy);
          }
          pose = entityPose(e, this._pose);
        }
        shake = Math.max(shake, warpDepartureFxState(d, t, frame, camX, camY, pose));
        if (e && !e.dead) {
          this._applyHull(e, d.hull);
          e.__warpNurtMode = d.plasmaMode;
          if (t >= d.tGone) {
            // Po zniknięciu w punkcie skoku okręt zostaje schowany, dopóki gra go nie usunie.
            this._hideHull(e);
            if (!rec.goneFired) { rec.goneFired = true; rec.onGone?.(e); }
          }
        }
        if (t > d.tEnd && (!e || e.dead || rec.goneFired)) {
          if (t > d.tEnd + 0.5 || !e || e.dead) {
            if (e) e.__warpNurtMode = null;
            if (!e || e.dead) list.splice(i, 1);
          }
        }
      }
    }
    frame.shake = shake;
  },

  // Pozycja i prędkość encji z osi efektu (NPC: x/y kanoniczne + lustro pos/vel).
  _writePose(e, x, y, vx, vy) {
    if (Number.isFinite(e.x)) { e.x = x; e.y = y; e.vx = vx; e.vy = vy; }
    if (e.pos) { e.pos.x = x; e.pos.y = y; }
    if (e.vel) { e.vel.x = vx; e.vel.y = vy; }
  },

  // Koniec prowadzenia przylotu: okręt znów zderza się i słucha gry.
  _releaseDrive(rec) {
    if (!rec.driving) return;
    rec.driving = false;
    const e = rec.entity;
    if (e && !e.dead && rec.wasCollidable) e.isCollidable = true;
  },

  _hideHull(e) {
    const hull = e.beamHull;
    if (!hull || !(hull.scale > 0)) return;
    let u = e.__warpHullU;
    if (!u) u = e.__warpHullU = { a: _v4(), b: _v4(), c: _v4() };
    u.a.set(-1e6, -1, -1e6, 1);   // tryb −1, linia daleko za rufą: nic nie widać
    u.b.set(0, 0, 0, 4);
    u.c.set(0, 0, 0, 1);
    this._hullTouched.add(e);
  },

  _burstShake(fx, camX, camY) {
    if (!this.onShake) return;
    const ddx = fx.x - camX;
    const ddy = fx.y - camY;
    const d = Math.sqrt(ddx * ddx + ddy * ddy);
    const near = Math.max(0, 1 - d / Math.max(4000, fx.hullLength * 6));
    if (near <= 0) return;
    this.onShake(12 * (0.4 + 0.8 * fx.sizeScale) * near, 0.35);   // demo: 6 px × (0,4 + 0,8 s)
  },

  // Wymiary z prawdziwego kadłuba (podpięty okręt): oś wlotu i hamowania zostaje (okręt może już
  // lecieć), zmieniają się tylko wymiary efektu (bańka, błyski, odsłanianie).
  _resize(rec) {
    const e = rec.entity;
    rec.sized = true;
    const fx = rec.fx;
    fx.hullLength = entityHullLength(e);
    fx.hullWidth = entityHullWidth(e);
    fx.sizeScale = warpSizeScale(fx.hullLength);
  },

  /**
   * Przylot okrętu w chwili pojawienia się w grze (bez zapowiedzi — rozgrywka nie zna go
   * wcześniej): okręt wpada z daleka i hamuje w miejscu, w którym postawiła go gra (efekt prowadzi
   * go przez wlot — duch). opts.moving — pozycję prowadzi gra (warp-in piratów: odsłanianie od
   * miejsca pojawienia się, hamowanie po wyjściu z 'warping_in').
   */
  arrive(entity, opts = {}) {
    if (!this.initialized || !entity || this.arrivals.length >= ARRIVAL_CAP) return null;
    const pose = entityPose(entity, this._pose);
    const angle = opts.angle ?? pose.angle;
    const moving = !!opts.moving;
    const speed = Math.max(Number(entity.warpData?.speed) || 0, Math.sqrt(pose.vx * pose.vx + pose.vy * pose.vy));
    const fx = planWarpArrivalFx({
      x: pose.x, y: pose.y, angle, hullLength: entityHullLength(entity), hullWidth: entityHullWidth(entity),
      palette: opts.palette || entityWarpPaletteId(entity), pirate: !!(opts.pirate ?? entity.isPirate),
      moving, appearTime: this.time, speed, entity, rush: opts.rush
    });
    if (moving) { fx.x0 = pose.x; fx.y0 = pose.y; }
    const rec = { kind: 'arrival', fx, entity, sized: !!entity.beamHull, moving, burstShaken: false, driving: false, wasCollidable: true };
    this.arrivals.push(rec);
    return rec;
  },

  /**
   * Wezwanie bez zapowiedzi: wynik spawnCallInShip (encja albo lista) — każdy okręt kadłubowy
   * wpada w chwili pojawienia się (myśliwce bez efektu). Zwykłe wezwanie z zakładki wsparcia
   * idzie z wyprzedzeniem (planArrival + attach, src/game/supportWarp.js); tędy tylko tryb LINIE
   * i wezwania bez punktu albo przy pełnej puli przylotów.
   */
  arriveAll(result) {
    if (!result) return;
    if (Array.isArray(result)) {
      for (let i = 0; i < result.length; i++) this.arriveAll(result[i]);
      return;
    }
    if (typeof result !== 'object' || result.dead || result.fighter || result.isFighter) return;
    this.arrive(result);
  },

  /**
   * Przylot zaplanowany (zwiastun → wlot → hamowanie): efekt zaczyna się teraz w (x, y) = miejsce
   * zatrzymania; hamowanie po czasie zwiastuna (albo `burstIn` s). Wołający stawia okręt w grze
   * w chwili `rec.fx.tSpawn` (= pojawienie się daleko za celem, czas WarpNurt.time) i podpina go
   * `attach(rec, encja)` — efekt prowadzi go przez wlot i hamowanie (wezwania z zakładki
   * wsparcia: src/game/supportWarp.js). o.heraldReach — nić krótsza (start przy Ziemi).
   */
  planArrival(o) {
    if (!this.initialized || this.arrivals.length >= ARRIVAL_CAP) return null;
    const fx = planWarpArrivalFx({
      x: o.x, y: o.y, angle: o.angle || 0, hullLength: o.hullLength, hullWidth: o.hullWidth,
      palette: o.palette || 'magenta', pirate: !!o.pirate, moving: false, rush: o.rush,
      startTime: Number.isFinite(o.burstIn) ? undefined : this.time + (Number(o.delay) || 0),
      burstTime: Number.isFinite(o.burstIn) ? this.time + o.burstIn : undefined, heraldExtra: o.heraldExtra || 0,
      heraldReach: o.heraldReach
    });
    const rec = { kind: 'arrival', fx, entity: null, sized: true, moving: false, burstShaken: false, driving: false, wasCollidable: true };
    this.arrivals.push(rec);
    return rec;
  },

  /** Wezwanie floty z planem (planWarpFleetArrival): zwiastuny razem, wyrzuty od najmniejszego. */
  planFleetArrival(ships, opts = {}) {
    const plan = planWarpFleetArrival(ships.map((s) => ({ hullLength: s.hullLength })), { ...opts, startTime: this.time });
    return plan.map((p) => this.planArrival({ ...ships[p.index], delay: p.startTime - this.time, heraldExtra: p.heraldExtra }));
  },

  attach(rec, entity) {
    if (!rec || !entity) return;
    rec.entity = entity;
    rec.fx.entity = entity;
    // Wymiary z prawdziwego kadłuba, gdy już jest — oś wlotu i hamowania bez zmian.
    rec.sized = false;
    if (entity.beamHull) this._resize(rec);
  },

  /**
   * Odlot tunelem: ładowanie (punkt skoku przed dziobem), szczelina, okręt wchodzi w nią od
   * dziobu. opts.drive — efekt prowadzi okręt w szczelinie (pozycja z osi dema), opts.onGone(e)
   * — okręt zniknął (wołający usuwa encję); do tego czasu kadłub zostaje schowany.
   */
  depart(entity, opts = {}) {
    if (!this.initialized || !entity || this.arrivals.length >= ARRIVAL_CAP) return null;
    const pose = entityPose(entity, this._pose);
    const d = planWarpDepartureFx({
      x: pose.x, y: pose.y, angle: opts.angle ?? pose.angle, hullLength: entityHullLength(entity),
      hullWidth: entityHullWidth(entity), startTime: this.time + (Number(opts.delay) || 0),
      palette: opts.palette || entityWarpPaletteId(entity), pirate: !!(opts.pirate ?? entity.isPirate),
      drive: !!opts.drive, rush: opts.rush, entity
    });
    const rec = { kind: 'departure', fx: d, entity, onGone: opts.onGone || null, goneFired: false };
    this.arrivals.push(rec);
    return rec;
  },

  /** Wszystko do zera (nowa gra, teleport w harnessie). */
  clear() {
    for (const rec of this.arrivals) if (rec.entity) { rec.entity.__warpNurtMode = null; rec.entity.__warpHullU = null; }
    this.arrivals.length = 0;
    this.player?.reset();
    this.lastBusyT = -1e9;
    this._reseed = true;
  }
};

// Pula linii szwu (gracz) — obiekty wielokrotnego użytku.
WarpNurt._seamLineSrc = {
  items: Array.from({ length: 4 }, () => ({ x: 0, y: 0, angle: 0, line: 0, width: 0, k: 0, rgb: [0, 0, 0] })),
  count: 0,
  add() { return this.count < this.items.length ? this.items[this.count++] : null; }
};
WarpNurt._drivePose = { x: 0, y: 0, vx: 0, vy: 0 };

const FLASH_WHITE = Object.freeze([0.55, 0.85, 1.0]);
