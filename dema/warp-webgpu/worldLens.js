// dema/warp-webgpu/worldLens.js
//
// Soczewka świata — widok ciał (planety, księżyce) w skoku w PRAWDZIWYCH
// odległościach (propozycja 1, user: „podoba mi się”). Czyste funkcje z gry
// (src/3d/warp/worldLens.js — od 2026-10-07 soczewka jest też w grze, jedno źródło
// matematyki); tu tylko widok ciał dema bez Core3D (WorldLensView).
//
// Skrót zasady (szczegóły: nagłówek src/3d/warp/worldLens.js, docs/BRIEF-warp.md §4.3):
//   • jedna skala S [px na jednostkę świata] dla wszystkich ciał, z NOMINALNEJ
//     prędkości skoku (warpLensScale) — mijana planeta leci po prostej w swojej
//     prawdziwej odległości od kursu;
//   • wielkość × perspektywa wzdłuż kursu h/√(a² + h²) — rośnie przy zbliżaniu,
//     prawdziwa przy mijaniu, maleje za rufą; statek zwalnia przy ciele
//     (warpFlybySlowdown, src/game/warpDrive.js);
//   • przelot obraca ciało (flybyTurn — wirtualna kamera nad statkiem);
//   • CEL wisi przy krawędzi kadru przed dziobem i rośnie; przy wyjściu z warpa
//     β spada do 0 i cel „wskakuje” na swoje prawdziwe miejsce pod statkiem.
// Przejście β: odstęp liniowo, wielkość w logarytmie.

import { WORLD_LENS_DEFAULTS, mapWorldLens, warpLensScale, flybyTurn } from '../../src/3d/warp/worldLens.js';

export { WORLD_LENS_DEFAULTS, viewEdgeDistance, warpLensScale, warpDepthScale, flybyTurn, mapWorldLens } from '../../src/3d/warp/worldLens.js';

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

/**
 * Widok ciał w klatce (odpowiednik WarpWorldLens.applyToBodies bez Core3D):
 * dla każdego ciała pozycja na ekranie [px od środka, y w dół], promień [px],
 * obrót przelotu i kierunek słońca w układzie ciała. Wynik w `out` (pula).
 * ctx: { ship: {x, y}, velAngle, speed (nominalna), zoom, W, H, shipSx, shipSy,
 *   beta (soczewka ciał), bodyZoom (odjazd od planety startu), target (ciało),
 *   hullHalfLen, hullHalfWid [px], dt, sun: {x, y}, persp: { focal, camZ } }
 */
export class WorldLensView {
  constructor(params = {}) {
    this.params = { ...WORLD_LENS_DEFAULTS, ...params };
    this.lensScale = 0;
    this.out = [];
    this._opts = {
      zoom: 1, flatScale: 0, lensScale: 0.001, sizeDepth: this.params.sizeDepth,
      viewHalfW: 400, viewHalfH: 300, shipSx: 0, shipSy: 0, targetWindow: this.params.targetWindow,
      sizeK: this.params.sizeK, sizeD0: this.params.sizeD0, gapPx: this.params.edgeGap,
      hullHalfLen: 0, hullHalfWid: 0, hold: 0, holdSize: this.params.holdSize,
      holdPeek: this.params.holdPeek, holdSoft: this.params.holdSoft, beta: 0, velAngle: 0, sizeBoost: 1
    };
    this._map = {};
    this._tgt = {};
    this._turn = { ax: 1, ay: 0, angle: 0 };
  }

  reset() {
    this.lensScale = 0;
  }

  /** bodies: [{ id, x, y, r, parentId, farPlane }] w chwili klatki. */
  update(bodies, ctx) {
    const p = this.params;
    const o = this._opts;
    const zoom = Math.max(1e-6, ctx.zoom);
    const beta = clamp(Number(ctx.beta) || 0, 0, 1);
    const bodyZoom = Number(ctx.bodyZoom) > 0 ? Math.min(Number(ctx.bodyZoom), 4) : 1;
    const dt = clamp(Number(ctx.dt) || 0, 0, 0.1);
    const target = warpLensScale(Number.isFinite(ctx.speed) ? ctx.speed : p.zoomRefSpeed, Math.min(ctx.W, ctx.H) * 0.5, p, zoom * p.lensScaleMax);
    if (!(this.lensScale > 0) || dt <= 0) this.lensScale = target;
    else this.lensScale *= Math.pow(target / this.lensScale, 1 - Math.exp(-dt / Math.max(1e-3, p.lensScaleLag)));
    o.zoom = zoom;
    o.lensScale = this.lensScale;
    o.viewHalfW = ctx.W * 0.5;
    o.viewHalfH = ctx.H * 0.5;
    o.shipSx = ctx.shipSx;
    o.shipSy = ctx.shipSy;
    o.hullHalfLen = Math.max(0, ctx.hullHalfLen || 0);
    o.hullHalfWid = Math.max(0, ctx.hullHalfWid || 0);
    o.velAngle = ctx.velAngle;
    o.hold = 0;
    // Skala zwykłego widoku ciała: planety przy ringu leżą w płaszczyźnie gry
    // (zoom), reszta w passie perspektywicznym 50 tys. j. pod nią.
    const flatOf = (b) => (b.farPlane ? ctx.persp.focal / (ctx.persp.camZ + 50000) : zoom) * bodyZoom;
    const tBody = ctx.target || null;
    let tScale = 0;
    let tx0 = 0;
    let ty0 = 0;
    if (tBody) {
      o.hold = 1;
      o.beta = 1;
      o.flatScale = flatOf(tBody);
      o.sizeBoost = 1;
      mapWorldLens(tBody.x - ctx.ship.x, tBody.y - ctx.ship.y, tBody.r, o, this._tgt);
      o.hold = 0;
      tScale = this._tgt.size / tBody.r;
      tx0 = tBody.x;
      ty0 = tBody.y;
    }
    const tilt = Math.max(0, p.flybyTilt);
    const hCam = Math.max(1, p.flybyHeight);
    const sun = ctx.sun;
    this.out.length = 0;
    for (const b of bodies) {
      const dx = b.x - ctx.ship.x;
      const dy = b.y - ctx.ship.y;
      const isTarget = b === tBody;
      const inGroup = !isTarget && tScale > 0 && tBody && b.parentId === tBody.id;
      const fl = flatOf(b);
      const m = this._map;
      if (inGroup) {
        // Księżyc celu: wokół obrazu celu w jego skali.
        const lx = this._tgt.x + (b.x - tx0) * tScale;
        const ly = this._tgt.y + (b.y - ty0) * tScale;
        const ls = b.r * tScale;
        m.x = dx * fl + (lx - dx * fl) * beta;
        m.y = dy * fl + (ly - dy * fl) * beta;
        m.size = Math.exp(Math.log(b.r * fl) * (1 - beta) + Math.log(Math.max(ls, 1e-6)) * beta);
      } else {
        o.beta = beta;
        o.flatScale = fl;
        o.hold = isTarget ? 1 : 0;
        mapWorldLens(dx, dy, b.r, o, m);
        o.hold = 0;
      }
      // Obrót przelotu (w soczewce), światło z prawdziwego kierunku słońca.
      let ax = 1;
      let ay = 0;
      let ang = 0;
      if (tilt > 0 && beta > 0.002) {
        flybyTurn(dx, -dy, hCam, this._turn);
        ax = this._turn.ax;
        ay = this._turn.ay;
        ang = this._turn.angle * tilt * beta;
      }
      const sdx = sun.x - b.x;
      const sdy = -(sun.y - b.y);
      const sl = Math.hypot(sdx, sdy) || 1;
      this.out.push({
        body: b,
        x: ctx.shipSx + m.x,
        y: ctx.shipSy + m.y,
        size: m.size,
        turnAx: ax, turnAy: ay, turnAngle: ang,
        sunX: sdx / sl, sunY: sdy / sl,
        isTarget
      });
    }
    return this.out;
  }
}
