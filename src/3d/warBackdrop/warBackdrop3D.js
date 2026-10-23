// src/3d/warBackdrop/warBackdrop3D.js — BITWA W GŁĘBI sceny „Wojna” (2026-10-19): obraz tłumu okrętów nad i pod
// płaszczyzną gry oraz planety głęboko pod nią.
//
// User (2026-10-19): „bitwa o Coruscant = masa statków na wielu płaszczyznach naparzająca się; planeta znacznie niżej niż
// płaszczyzna gry; statki poza zasięgiem gracza duże blisko kamery (inny Atlas wali serię w battleshipa i go niszczy),
// wylot z warpa Atlasa i supercapitala piratów, którzy niszczą się obaj; masa statków w oddali i w przybliżeniu”.
// Rozgrywka zostaje w płaszczyźnie gry (floty sceny w index.html); tu wyłącznie OBRAZ (zasada żelazna 1):
//   • pasma głębokości (src/render/warBackdropPlan.js: WB_BANDS) — pod płaszczyzną w passie TŁA (warstwa 1, kamera
//     perspektywy: dalej = mniejsze, wolniejsza paralaksa, mgiełka), nad nią w passie FG (warstwa 2, bliżej kamery =
//     większe, szybsza paralaksa); okręty, odłamy i myśliwce z symulacji widoku (warBackdropSim.js);
//   • bohaterowie (planWarHero — ten sam plan liczy gra dla kamery) w paśmie FG;
//   • planeta (mapy z PLANET_MAPS, światła miast) ~200 km pod płaszczyzną, terminator pod środkiem bitwy.
// Wejście klatki: stan sceny z gry (blok `warBackdrop` migawki — worker, albo obiekt gry wprost — tryb off / inline)
// i kamera gry. Tekstury (atlas sprite'ów, mapy planety) wczytują się przy pierwszej scenie; siatki i grafy powstają
// przy starcie modułu i idą do rozgrzewki (`Core3D.warmup`, faza 'after').
// Bez Math.random (zasada żelazna 9): symulacja i ziarna efektów z ziarna sceny.
import * as THREE from 'three/webgpu';
import { createCanvas2D, loadImageBitmap } from '../canvas2d.js';
import { PLANET_MAPS } from '../planetMaps.js';
import { zbierzZakres } from '../zakresyWysylki.js';
import { WARIANT_INSTANCJI } from '../rozgrzewka.js';
import { WB_CLASSES, WB_BAND_FG, planWarHero } from '../../render/warBackdropPlan.js';
import { WB_PLANET_MAPS } from '../../render/blocks/warBackdropBlock.js';
import { cameraRoll, rolledHalfExtents } from '../viewRoll.js';

const _wbRollHalf = { hw: 0, hh: 0 };
import { createWarBackdropSim, WB_MODE, WB_STEP, WB_NOOP_SINK } from './warBackdropSim.js';
import {
  createWarBackdropUniforms, createWarBackdropMaterials, createQuadBatch, WB_HULL_STRIDE, WB_GLOW_STRIDE, WB_EVENT_STRIDE, WB_EVK
} from './warBackdropTSL.js';

const LAYER_BG = 1;
const LAYER_FG = 2;
const HULL_NAMES = ['wbH0', 'wbH1', 'wbH2', 'wbH3', 'wbH4', 'wbH5'];
const GLOW_NAMES = ['wbG0', 'wbG1', 'wbG2'];
const EVENT_NAMES = ['wbE0', 'wbE1', 'wbE2', 'wbE3'];
const CAP = Object.freeze({ hullBg: 2048, hullFg: 384, glowBg: 2304, glowFg: 512, evBg: 8192, evFg: 3072 });
const SHELL = 1.035;

/** Strojenie wyglądu (tryb off — konsola: window.WarBackdropLook; worker — stałe modułu). */
export const WB_LOOK = {
  hazeL: 150000,       // [j.] skala mgiełki głębi (1 − e^(z / hazeL))
  hazeMax: 0.72,
  fadeNear: [0.2, 0.42], // krycie pasma FG z odległości od kamery (ułamki wysokości kamery)
  engineTN: [0.45, 0.72, 1.0, 2.4],
  enginePIR: [1.0, 0.45, 0.2, 2.2],
  fighterTN: [0.6, 0.85, 1.0, 2.0],
  fighterPIR: [1.0, 0.6, 0.3, 2.0],
  heroGlow: 1.4,
  cullMargin: 1.35,
  prewarmBudgetMs: 6
};

// Sprite'y kadłubów (jak HULL_SPRITE_PATHS_BY_ID w index.html; Atlas — sprite gracza).
const SPRITES = {
  terran_frigate: new URL('../../assets/ships/terranfrigate.png', import.meta.url).href,
  terran_destroyer: new URL('../../assets/ships/terrandestroyer.png', import.meta.url).href,
  terran_battleship: new URL('../../assets/ships/terranbattleship.png', import.meta.url).href,
  terran_carrier: new URL('../../assets/ships/terrancarrier.png', import.meta.url).href,
  terran_supercapital: new URL('../../assets/ships/terransupercapital.png', import.meta.url).href,
  atlas: new URL('../../../assets/capital_ship_rect_v1.png', import.meta.url).href,
  pirate_frigate: new URL('../../assets/ships/piratefrigate.png', import.meta.url).href,
  pirate_destroyer: new URL('../../assets/ships/piratedestroyer.png', import.meta.url).href,
  pirate_battleship: new URL('../../assets/ships/piratebattleship.png', import.meta.url).href,
  pirate_supercapital: new URL('../../assets/ships/piratecapital.png', import.meta.url).href
};

// Atlas 4096 × 2144: komórki z proporcji PNG (szerokość wg wielkości okrętu na ekranie — bohaterowie do ~1536 px).
const ATLAS_W = 4096;
const ATLAS_H = 2144;
const ATLAS_CELLS = Object.freeze([
  ['pirate_supercapital', 0, 0, 1536, 865],
  ['terran_supercapital', 1544, 0, 1536, 864],
  ['terran_frigate', 3088, 0, 504, 376],
  ['terran_destroyer', 3088, 384, 504, 376],
  ['pirate_frigate', 3600, 0, 496, 207],
  ['pirate_destroyer', 3600, 215, 496, 230],
  ['terran_carrier', 0, 873, 1280, 720],
  ['atlas', 1288, 873, 1536, 687],
  ['terran_battleship', 2832, 873, 1024, 631],
  ['pirate_battleship', 0, 1601, 1024, 540]
]);

// uv komórki klasy (u0, v0, du, dv; v = 0 u góry atlasu — tekstura bez odwracania)
const CLASS_UV = new Float32Array(WB_CLASSES.length * 4);
for (let c = 0; c < WB_CLASSES.length; c++) {
  const cell = ATLAS_CELLS.find((e) => e[0] === WB_CLASSES[c].sprite);
  if (!cell) continue;
  CLASS_UV[c * 4] = (cell[1] + 1) / ATLAS_W;
  CLASS_UV[c * 4 + 1] = (cell[2] + 1) / ATLAS_H;
  CLASS_UV[c * 4 + 2] = (cell[3] - 2) / ATLAS_W;
  CLASS_UV[c * 4 + 3] = (cell[4] - 2) / ATLAS_H;
}

function smooth01(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function emptyTexture(srgb) {
  const t = new THREE.Texture();
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

export class WarBackdrop3D {
  constructor(core) {
    this.core = core;
    this.U = createWarBackdropUniforms();
    this.atlasTex = emptyTexture(true);
    this.atlasTex.flipY = false;
    this.atlasTex.anisotropy = Math.max(1, Math.min(8, core.getMaxAnisotropy?.() || 1));
    this.planetTex = { day: emptyTexture(true), night: emptyTexture(true), clouds: emptyTexture(false) };
    for (const k of ['day', 'night', 'clouds']) this.planetTex[k].wrapS = THREE.RepeatWrapping;
    this.mats = createWarBackdropMaterials(this.U, this.atlasTex, this.planetTex, SHELL);
    this.root = new THREE.Group();
    this.root.name = 'WarBackdrop';
    this.root.visible = false;
    // narzędzia (tryb off): Core3D.scene.getObjectByName('WarBackdrop').userData.owner.state()
    this.root.userData.owner = this;
    this.hullBg = createQuadBatch(this.mats.hull, CAP.hullBg, WB_HULL_STRIDE, HULL_NAMES, LAYER_BG, 'WarBackdropHullBg', 2);
    this.hullFg = createQuadBatch(this.mats.hull, CAP.hullFg, WB_HULL_STRIDE, HULL_NAMES, LAYER_FG, 'WarBackdropHullFg', 2);
    this.glowBg = createQuadBatch(this.mats.glow, CAP.glowBg, WB_GLOW_STRIDE, GLOW_NAMES, LAYER_BG, 'WarBackdropGlowBg', 8);
    this.glowFg = createQuadBatch(this.mats.glow, CAP.glowFg, WB_GLOW_STRIDE, GLOW_NAMES, LAYER_FG, 'WarBackdropGlowFg', 8);
    this.evBg = createQuadBatch(this.mats.event, CAP.evBg, WB_EVENT_STRIDE, EVENT_NAMES, LAYER_BG, 'WarBackdropFxBg', 9);
    this.evFg = createQuadBatch(this.mats.event, CAP.evFg, WB_EVENT_STRIDE, EVENT_NAMES, LAYER_FG, 'WarBackdropFxFg', 9);
    for (const R of [this.evBg, this.evFg]) {
      R.head = 0;
      R.dirty0 = -1;
      R.dirtyN = 0;
      this._clearRing(R);
      R.mesh.geometry.instanceCount = R.cap;
    }
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), this.mats.planet);
    this.planet.name = 'WarBackdropPlanet';
    this.planet.layers.set(LAYER_BG);
    this.planet.renderOrder = 0;
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), this.mats.atmo);
    this.atmo.name = 'WarBackdropAtmo';
    this.atmo.layers.set(LAYER_BG);
    this.atmo.renderOrder = 5;
    this.root.add(this.planet, this.atmo, this.hullBg.mesh, this.hullFg.mesh, this.glowBg.mesh, this.glowFg.mesh, this.evBg.mesh, this.evFg.mesh);
    core.scene.add(this.root);
    // stan sceny
    this.sim = null;
    this.sceneId = -1;
    this.offset = 0;
    this.prewarmLeft = 0;
    this.heroesAdded = 0;
    this.active = false;
    this.cx = 0;
    this.cy = 0;
    this._fxSeed = 1;
    // kamera (układ gry, względem środka sceny)
    this.cam = { relX: 0, relY: 0, H: 40000, halfW: 20000, halfH: 12000, free: false };
    // tekstury (wgrywanie kolejką — jedna na klatkę: atlas 35 MB i mapy planety naraz to ~65 ms w jednej klatce)
    this.atlasState = 'none';
    this.planetMaps = null;
    this._uploadQ = [];
    this.stats = { hullBg: 0, hullFg: 0, glowBg: 0, glowFg: 0, evBg: 0, evFg: 0, culled: 0, prewarmMs: 0 };
    const self = this;
    this.sink = {
      shot(x0, y0, z0, x1, y1, z1, t0, dur, kind, width, impact) { self._shot(x0, y0, z0, x1, y1, z1, t0, dur, kind, width, impact); },
      flash(x, y, z, size, t0, dur, kind) { if (self._vis(x, y, z, size)) self._ev(z >= 0, x, y, z, t0, x, y, z, dur, size, WB_EVK.FLASH, kind, 0, 0, 0, 0); },
      ring(x, y, z, size, t0, dur) { if (self._vis(x, y, z, size)) self._ev(z >= 0, x, y, z, t0, x, y, z, dur, size, WB_EVK.RING, 0, 0, 0, 0, 0); },
      debris(x, y, z, vx, vy, vz, t0, dur, size, kind) {
        if (self._vis(x, y, z, size + Math.abs(vx) + Math.abs(vy))) self._ev(z >= 0, x, y, z, t0, x, y, z, dur, size, WB_EVK.DEBRIS, kind, vx, -vy, vz, 0);
      },
      beam(x0, y0, z0, x1, y1, z1, t0, dur, width, kind) {
        const mx = (x0 + x1) * 0.5;
        const my = (y0 + y1) * 0.5;
        const half = 0.5 * Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
        if (self._vis(mx, my, z0, half + width)) self._ev(z0 >= 0, x0, y0, z0, t0, x1, y1, z1, dur, width, WB_EVK.BEAM, kind, 0, 0, 0, 0);
      },
      streak(x, y, z, dx, dy, len, t0, dur, fac) {
        if (self._vis(x - dx * len * 0.5, y - dy * len * 0.5, z, len)) {
          self._ev(z >= 0, x, y, z, t0, x, y, z, dur, len, WB_EVK.STREAK, fac, dx, -dy, Math.max(40, len * 0.03), 0);
        }
      }
    };
  }

  // ── pierścień zdarzeń ─────────────────────────────────────────────────────────────────────────────────────────
  _clearRing(R) {
    const A = R.arr;
    for (let i = 0; i < R.cap; i++) A[i * WB_EVENT_STRIDE + 3] = 1e9;
    R.head = 0;
    R.dirty0 = 0;
    R.dirtyN = R.cap;
  }

  _rnd() {
    this._fxSeed = (Math.imul(this._fxSeed, 1664525) + 1013904223) >>> 0;
    return this._fxSeed / 4294967296;
  }

  /** Rekord zdarzenia (układ gry → sceny: y = −y). */
  _ev(fg, x0, y0, z0, t0, x1, y1, z1, dur, size, kind, sub, a, b, c, d) {
    const R = fg ? this.evFg : this.evBg;
    const i = R.head;
    R.head = (i + 1) % R.cap;
    if (R.dirtyN === 0) R.dirty0 = i;
    R.dirtyN++;
    const A = R.arr;
    const o = i * WB_EVENT_STRIDE;
    A[o] = x0; A[o + 1] = -y0; A[o + 2] = z0; A[o + 3] = t0;
    A[o + 4] = x1; A[o + 5] = -y1; A[o + 6] = z1; A[o + 7] = dur;
    A[o + 8] = size; A[o + 9] = kind; A[o + 10] = sub; A[o + 11] = this._rnd() * 40;
    A[o + 12] = a; A[o + 13] = b; A[o + 14] = c; A[o + 15] = d;
  }

  _shot(x0, y0, z0, x1, y1, z1, t0, dur, kind, width, impact) {
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const half = 0.5 * Math.sqrt(dx * dx + dy * dy);
    if (!this._vis(mx, my, z0, half + impact)) return;
    const trail = width * (kind >= 4 ? 30 : 26);
    this._ev(z0 >= 0, x0, y0, z0, t0, x1, y1, z1, dur, width, WB_EVK.SHOT, kind, impact, trail, 0, 0);
  }

  _uploadRing(R) {
    if (R.dirtyN <= 0) return;
    if (R.dirtyN >= R.cap || R.dirty0 + R.dirtyN > R.cap) zbierzZakres(R.buf, 0, R.cap * WB_EVENT_STRIDE);
    else zbierzZakres(R.buf, R.dirty0 * WB_EVENT_STRIDE, R.dirtyN * WB_EVENT_STRIDE);
    R.dirtyN = 0;
  }

  // ── kamera i odcinanie ─────────────────────────────────────────────────────────────────────────────────────────
  _camera(cam, frame) {
    const core = this.core;
    const C = this.cam;
    const w = Number(core.width) || 1600;
    const h = Number(core.height) || 900;
    const zoom = Math.max(1e-4, Number(cam?.zoom) || 1);
    const pc = core.cameraPersp;
    const fov = THREE.MathUtils.degToRad((pc && pc.fov) || 35);
    const tanH = Math.tan(fov * 0.5);
    C.free = !!(core.isFreePerspectiveCamera && core.isFreePerspectiveCamera());
    C.H = (h * 0.5) / tanH / zoom;
    // obrót kadru (viewRoll.js): pudło osi świata wokół obróconego kadru
    const rh = rolledHalfExtents((w * 0.5) / zoom, (h * 0.5) / zoom, cameraRoll(cam), _wbRollHalf);
    C.halfW = rh.hw;
    C.halfH = rh.hh;
    C.relX = (Number(cam?.x) || 0) - frame.cx;
    C.relY = (Number(cam?.y) || 0) - frame.cy;
    const bufH = h * (Number(core.pxScale) || 1);
    this.U.uPxK.value = (2 * tanH) / Math.max(1, bufH);
  }

  /** Czy punkt (układ gry względem środka sceny) o promieniu r może być w kadrze (zapas WB_LOOK.cullMargin). */
  _vis(x, y, z, r) {
    const C = this.cam;
    if (C.free) return true;
    const d = C.H - z;
    if (d <= 50) return false;
    const k = (d / C.H) * WB_LOOK.cullMargin;
    return Math.abs(x - C.relX) < C.halfW * k + r && Math.abs(y - C.relY) < C.halfH * k + r;
  }

  // ── tekstury ──────────────────────────────────────────────────────────────────────────────────────────────────
  _loadAtlas() {
    if (this.atlasState !== 'none') return;
    this.atlasState = 'loading';
    const canvas = createCanvas2D(ATLAS_W, ATLAS_H);
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx) { this.atlasState = 'failed'; return; }
    const jobs = ATLAS_CELLS.map(([key, x, y, w, h]) => loadImageBitmap(SPRITES[key]).then((bmp) => {
      ctx.drawImage(bmp, x, y, w, h);
      if (typeof bmp.close === 'function') bmp.close();
    }, (err) => console.warn(`[WarBackdrop3D] sprite ${key}:`, err)));
    Promise.all(jobs).then(() => {
      this._uploadQ.push(() => {
        this.atlasTex.image = canvas;
        this.atlasTex.needsUpdate = true;
        this.atlasState = 'ready';
      });
    });
  }

  _loadPlanet(mapsIdx) {
    const name = WB_PLANET_MAPS[mapsIdx | 0] || 'venus';
    if (this.planetMaps === name) return;
    this.planetMaps = name;
    const M = PLANET_MAPS[name] || PLANET_MAPS.venus || PLANET_MAPS.earth;
    if (!M) return;
    const load = (url, tex, w, h) => {
      if (!url) return;
      loadImageBitmap(url, { width: w, height: h }).then((bmp) => {
        if (this.planetMaps !== name) return;
        this._uploadQ.push(() => {
          tex.image = bmp;
          tex.needsUpdate = true;
        });
      }, (err) => console.warn(`[WarBackdrop3D] mapa ${url}:`, err));
    };
    load(M.day, this.planetTex.day, 4096, 2048);
    load(M.night, this.planetTex.night, 4096, 2048);
    load(M.clouds, this.planetTex.clouds, 2048, 1024);
    this.U.uCloud.value = M.clouds ? 0.75 : 0;
  }

  // ── scena ─────────────────────────────────────────────────────────────────────────────────────────────────────
  _start(frame) {
    this.sceneId = frame.id;
    this.cx = frame.cx;
    this.cy = frame.cy;
    this.root.position.set(frame.cx, -frame.cy, 0);
    this.root.updateMatrixWorld(true);
    this.sim = createWarBackdropSim({ seed: frame.seed, density: frame.density, frontAxis: frame.axis, sink: this.sink });
    this.offset = Math.max(0, Number(frame.prewarm) || 0);
    this.prewarmLeft = this.offset;
    this.heroesAdded = 0;
    this._fxSeed = ((frame.seed >>> 0) ^ 0x9E3779B9) >>> 0 || 1;
    this._clearRing(this.evBg);
    this._clearRing(this.evFg);
    this.active = true;
    this._loadAtlas();
    this._loadPlanet(frame.planet.maps);
  }

  _stop() {
    this.active = false;
    this.sim = null;
    this.sceneId = -1;
    this.root.visible = false;
  }

  _addHeroes(frame) {
    while (this.heroesAdded < frame.heroN) {
      const h = frame.heroes[this.heroesAdded++];
      this.sim.addHero(planWarHero({ kind: h.kind, t0: h.t0 + this.offset, x: h.x, y: h.y, z: h.z, heading: h.heading, seed: h.seed }));
    }
  }

  /**
   * Klatka: `frame` — stan sceny (createWarBackdropFrame), `cam` — kamera gry (x, y, zoom). Bez sceny — nic nie rysuje.
   */
  update(frame, cam) {
    if (!frame || !frame.has) { if (this.active) this._stop(); return; }
    if (frame.id !== this.sceneId || !this.sim) this._start(frame);
    const sim = this.sim;
    if (this._uploadQ.length) this._uploadQ.shift()();
    this._camera(cam, frame);
    this._addHeroes(frame);
    if (this.prewarmLeft > 0) {
      // rozbieg w porcjach (bitwa „trwa” od początku sceny; do końca rozbiegu obraz schowany)
      const t0 = performance.now();
      const sink = sim.sink;
      sim.sink = WB_NOOP_SINK;
      while (this.prewarmLeft > 0 && performance.now() - t0 < WB_LOOK.prewarmBudgetMs) {
        sim.step(WB_STEP, 1);
        this.prewarmLeft -= WB_STEP;
      }
      sim.sink = sink;
      this.stats.prewarmMs += performance.now() - t0;
      if (this.prewarmLeft > 0) { this.root.visible = false; return; }
      sim.time = this.offset;
      sim.acc = 0;
    }
    const target = Math.max(0, Number(frame.t) || 0) + this.offset;
    const now = sim.time + sim.acc;
    if (target > now) sim.step(target - now, 30);
    this.U.uTime.value = sim.time + sim.acc;
    this.U.uFxGain.value = Math.max(0, Math.min(1, Number(frame.fade) || 0));
    this._pack(frame);
    this._uploadRing(this.evBg);
    this._uploadRing(this.evFg);
    this._planet(frame);
    this.root.visible = true;
  }

  // ── pakowanie instancji ───────────────────────────────────────────────────────────────────────────────────────
  _hull(B, x, y, z, ang, hl, hw, pu, pv, cls, b0, b1, s0, s1, side, cut, heat, alpha, glow, burn, haze, seed) {
    if (B.count >= B.cap) return;
    const A = B.arr;
    const o = B.count * WB_HULL_STRIDE;
    B.count++;
    A[o] = x; A[o + 1] = -y; A[o + 2] = z; A[o + 3] = -ang;
    A[o + 4] = hl; A[o + 5] = hw; A[o + 6] = pu; A[o + 7] = -pv;
    A[o + 8] = CLASS_UV[cls * 4]; A[o + 9] = CLASS_UV[cls * 4 + 1]; A[o + 10] = CLASS_UV[cls * 4 + 2]; A[o + 11] = CLASS_UV[cls * 4 + 3];
    A[o + 12] = b0; A[o + 13] = b1; A[o + 14] = s0; A[o + 15] = s1;
    A[o + 16] = side; A[o + 17] = cut; A[o + 18] = heat; A[o + 19] = alpha;
    A[o + 20] = glow; A[o + 21] = burn; A[o + 22] = haze; A[o + 23] = seed;
  }

  _glow(B, x, y, z, kind, dx, dy, len, width, col, gain, phase) {
    if (B.count >= B.cap) return;
    const A = B.arr;
    const o = B.count * WB_GLOW_STRIDE;
    B.count++;
    A[o] = x; A[o + 1] = -y; A[o + 2] = z; A[o + 3] = kind;
    A[o + 4] = dx; A[o + 5] = -dy; A[o + 6] = len; A[o + 7] = width;
    A[o + 8] = col[0] * col[3] * gain; A[o + 9] = col[1] * col[3] * gain; A[o + 10] = col[2] * col[3] * gain; A[o + 11] = phase;
  }

  _haze(z) {
    return z < 0 ? Math.min(WB_LOOK.hazeMax, 1 - Math.exp(z / WB_LOOK.hazeL)) : 0;
  }

  _fade(z, hero) {
    const C = this.cam;
    if (hero || C.free || z <= 0) return 1;
    const f = WB_LOOK.fadeNear;
    return smooth01(f[0] * C.H, f[1] * C.H, C.H - z);
  }

  _pack(frame) {
    const sim = this.sim;
    const lead = sim.acc;
    const fade = Math.max(0, Math.min(1, Number(frame.fade) || 0));
    const hb = this.hullBg;
    const hf = this.hullFg;
    const gb = this.glowBg;
    const gf = this.glowFg;
    hb.count = 0; hf.count = 0; gb.count = 0; gf.count = 0;
    let culled = 0;
    const L = WB_LOOK;
    for (let i = 0; i < sim.n; i++) {
      if (!sim.active[i]) continue;
      const cls = sim.cls[i];
      const c = WB_CLASSES[cls];
      const s = sim.scale[i];
      const hl = c.len * 0.5 * s;
      const hw = c.wid * 0.5 * s;
      const x = sim.x[i] + sim.vx[i] * lead;
      const y = sim.y[i] + sim.vy[i] * lead;
      const z = sim.z[i];
      if (!this._vis(x, y, z, hl)) { culled++; continue; }
      const hero = sim.hero[i] >= 0;
      const fg = sim.band[i] === WB_BAND_FG;
      const a = this._fade(z, hero) * fade;
      if (a < 0.02) continue;
      const seed = (sim.seed[i] & 0xffff) / 65535 * 50;
      this._hull(fg ? hf : hb, x, y, z, sim.ang[i], hl, hw, 0, 0, cls, -2, 2, 0, 0, 0, 0, 0, a,
        sim.glow[i], sim.burn[i], this._haze(z), seed);
      const thrust = sim.thrust[i];
      if (sim.mode[i] !== WB_MODE.DYING && thrust > 0.05) {
        const ca = Math.cos(sim.ang[i]);
        const sa = Math.sin(sim.ang[i]);
        const sx = x - ca * hl * 0.9;
        const sy = y - sa * hl * 0.9;
        const col = sim.fac[i] === 0 ? L.engineTN : L.enginePIR;
        const len = hl * 2 * (0.22 + 0.4 * thrust);
        this._glow(fg ? gf : gb, sx, sy, z, 0, ca, sa, len, hw * 0.6, col, a * (hero ? L.heroGlow : 1) * (0.55 + 0.45 * thrust), seed);
      }
    }
    for (let k = 0; k < sim.cActive.length; k++) {
      if (!sim.cActive[k]) continue;
      const cls = sim.cCls[k];
      const c = WB_CLASSES[cls];
      const s = sim.cScale[k];
      const hl = c.len * 0.5 * s;
      const hw = c.wid * 0.5 * s;
      const x = sim.cx[k] + sim.cvx[k] * lead;
      const y = sim.cy[k] + sim.cvy[k] * lead;
      const z = sim.cz[k];
      if (!this._vis(x, y, z, hl * 2)) { culled++; continue; }
      const fg = sim.cBand[k] === WB_BAND_FG;
      const age = sim.cAge[k];
      const life = sim.cLife[k];
      const a = this._fade(z, sim.cHero[k] === 1) * fade * (1 - smooth01(life - 2.5, life, age));
      if (a < 0.02) continue;
      const seed = (sim.cSeed[k] & 0xffff) / 65535 * 50;
      this._hull(fg ? hf : hb, x, y, z, sim.cAng[k], hl, hw, sim.cPu[k], sim.cPv[k], cls,
        sim.cB0[k], sim.cB1[k], sim.cS0[k], sim.cS1[k], sim.cSide[k], sim.cCut[k], Math.max(0, 1 - age / 5), a,
        0, Math.max(0, 0.85 - age / 7), this._haze(z), seed);
    }
    for (let j = 0; j < sim.fActive.length; j++) {
      if (!sim.fActive[j]) continue;
      const x = sim.fx[j] + sim.fvx[j] * lead;
      const y = sim.fy[j] + sim.fvy[j] * lead;
      const z = sim.fz[j];
      if (!this._vis(x, y, z, 300)) { culled++; continue; }
      const fg = sim.fBand[j] === WB_BAND_FG;
      const a = this._fade(z, false) * fade;
      if (a < 0.02) continue;
      const vx = sim.fvx[j];
      const vy = sim.fvy[j];
      const vl = Math.sqrt(vx * vx + vy * vy) || 1;
      const sc = 1 + (fg ? 0 : Math.min(2.5, -z / 50000));
      this._glow(fg ? gf : gb, x, y, z, 1, vx / vl, vy / vl, 260 * sc, 44 * sc,
        sim.fFac[j] === 0 ? L.fighterTN : L.fighterPIR, a, j * 1.7);
    }
    for (const B of [hb, hf]) {
      B.mesh.geometry.instanceCount = B.count;
      if (B.count > 0) zbierzZakres(B.buf, 0, B.count * WB_HULL_STRIDE);
    }
    for (const B of [gb, gf]) {
      B.mesh.geometry.instanceCount = B.count;
      if (B.count > 0) zbierzZakres(B.buf, 0, B.count * WB_GLOW_STRIDE);
    }
    const st = this.stats;
    st.hullBg = hb.count; st.hullFg = hf.count; st.glowBg = gb.count; st.glowFg = gf.count; st.culled = culled;
  }

  _planet(frame) {
    const p = frame.planet;
    const on = p.on > 0 && p.r > 0;
    this.planet.visible = on;
    this.atmo.visible = on;
    if (!on) return;
    this._loadPlanet(p.maps);
    this.planet.position.set(p.dx, -p.dy, p.z);
    this.planet.scale.setScalar(p.r);
    this.planet.rotation.set(0, p.spin + this.sim.time * 0.0012, 0.28);
    this.atmo.position.copy(this.planet.position);
    this.atmo.scale.setScalar(p.r * SHELL);
    this.planet.updateMatrixWorld(true);
    this.atmo.updateMatrixWorld(true);
    // słońce: kierunek ze środka sceny ku Słońcu (scena: y = −y gry), lekko z góry
    const dx = frame.sunX - frame.cx;
    const dy = -(frame.sunY - frame.cy);
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    this.U.uSunDir.value.set(dx / l, dy / l, 0.12).normalize();
    this.U.uCloudShift.value = (this.sim.time * 0.00035) % 1;
  }

  /** Siatki do rozgrzewki (Core3D.warmup). */
  warmupMeshes() {
    return [this.planet, this.atmo, this.hullBg.mesh, this.hullFg.mesh, this.glowBg.mesh, this.glowFg.mesh, this.evBg.mesh, this.evFg.mesh];
  }

  /** Stan (debug, narzędzia). */
  state() {
    const sim = this.sim;
    return { active: this.active, sceneId: this.sceneId, prewarmLeft: +this.prewarmLeft.toFixed(2), atlas: this.atlasState,
      planet: this.planetMaps, time: sim ? +sim.time.toFixed(2) : null, sim: sim ? { ...sim.count() } : null, draw: { ...this.stats } };
  }
}

/** Obraz bitwy w głębi na `core` (Core3D) z wpisem rozgrzewki (faza 'after' — scena rusza dopiero z konsoli / flagi). */
export function createWarBackdrop3D(core) {
  const wb = new WarBackdrop3D(core);
  try {
    core.warmup?.add?.({ name: 'bitwa w głębi (scena Wojna)', objects: () => wb.warmupMeshes(), phase: 'after', variant: WARIANT_INSTANCJI });
  } catch (e) {
    console.warn('[WarBackdrop3D] rozgrzewka:', e);
  }
  return wb;
}
