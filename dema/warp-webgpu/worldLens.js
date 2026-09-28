// dema/warp-webgpu/worldLens.js
//
// Soczewka świata — widok ciał (planety, księżyce) w skoku w PRAWDZIWYCH
// odległościach. Czyste funkcje przeniesione 1:1 z src/3d/warpWorldLens.js
// (propozycja 1, user: „podoba mi się”); tamten moduł ciągnie Core3D (WebGL),
// więc tu jest kopia samej matematyki. Zmiana zachowania = zmiana w obu.
//
// Skrót zasady (szczegóły: nagłówek src/3d/warpWorldLens.js, docs/BRIEF-warp.md §4.3):
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

export const WORLD_LENS_DEFAULTS = Object.freeze({
  framingDist: 90000,
  zoomRefSpeed: 150000,
  lensScaleMax: 0.5,
  lensScaleLag: 0.15,
  sizeDepth: 30000,
  flybyHeight: 100000,
  flybyTilt: 1,
  targetWindow: 450000,
  sizeK: 600,
  sizeD0: 30000,
  holdSize: 0.5,
  holdPeek: 0.5,
  holdSoft: 40,
  edgeGap: 24
});

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Odległość od statku do krawędzi kadru wzdłuż (ux, uy) [px] (y w dół). */
export function viewEdgeDistance(ux, uy, hw, hh, sx = 0, sy = 0) {
  const w = Math.max(0, Number(hw) || 0);
  const h = Math.max(0, Number(hh) || 0);
  const x0 = Number(sx) || 0;
  const y0 = Number(sy) || 0;
  const tx = ux > 1e-9 ? (w - x0) / ux : (ux < -1e-9 ? (-w - x0) / ux : Infinity);
  const ty = uy > 1e-9 ? (h - y0) / uy : (uy < -1e-9 ? (-h - y0) / uy : Infinity);
  const t = Math.min(tx, ty);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** Skala soczewki [px/j.] od nominalnej prędkości skoku. */
export function warpLensScale(speed, edgePx, p = WORLD_LENS_DEFAULTS, maxScale = Infinity) {
  const vr = Math.max(1, Number(p.zoomRefSpeed) || WORLD_LENS_DEFAULTS.zoomRefSpeed);
  const v = Math.max(1, Math.abs(Number(speed) || 0));
  const D = Math.max(1, Number(p.framingDist) || WORLD_LENS_DEFAULTS.framingDist) * Math.min(1, v / vr);
  const s = Math.max(1, Number(edgePx) || 1) / D;
  return Math.min(s, maxScale > 0 ? maxScale : Infinity);
}

/** Perspektywa wzdłuż kursu: mnożnik wielkości ciała a przed dziobem / za rufą. */
export function warpDepthScale(along, depth) {
  const h = Math.max(1, Number(depth) || 1);
  const a = Number(along) || 0;
  return h / Math.sqrt(a * a + h * h);
}

/** Obrót ciała przy przelocie: oś (ax, ay, 0) i kąt (układ sceny, y w górę). */
export function flybyTurn(ox, oy, h, out = { ax: 1, ay: 0, angle: 0 }) {
  const hor = Math.hypot(ox, oy);
  if (!(hor > 1e-9)) {
    out.ax = 1;
    out.ay = 0;
    out.angle = 0;
    return out;
  }
  out.ax = -oy / hor;
  out.ay = ox / hor;
  out.angle = Math.atan2(hor, Math.max(1e-9, Number(h) || 0));
  return out;
}

/**
 * Ciało względem statku → przesunięcie środka na ekranie [px, y w dół],
 * promień [px] i odstęp krawędzi od statku. Kopia mapWorldLens z
 * src/3d/warpWorldLens.js (opis parametrów tam).
 */
export function mapWorldLens(dx, dy, r, o, out = {}) {
  const P = WORLD_LENS_DEFAULTS;
  const d = Math.hypot(dx, dy);
  const zoom = Math.max(1e-6, Number(o.zoom) || 1);
  const flat = Number(o.flatScale) > 0 ? Number(o.flatScale) : zoom;
  const beta = clamp(Number(o.beta) || 0, 0, 1);
  const va = Number(o.velAngle) || 0;
  const theta = d > 1e-9 ? Math.atan2(dy, dx) : va;
  const rr = Math.max(0, r);
  const flatSize = rr * flat;
  const flatGap = d * flat - flatSize;
  out.d = d;
  out.edge = 0;
  if (beta <= 0) {
    out.x = dx * flat;
    out.y = dy * flat;
    out.size = flatSize;
    out.theta = theta;
    out.gap = flatGap;
    return out;
  }
  const S = Math.max(1e-12, Number(o.lensScale) || 0);
  const along = d * Math.cos(theta - va);
  let lensSize = rr * S * (Number(o.sizeBoost) || 1) * warpDepthScale(along, Number(o.sizeDepth) || P.sizeDepth);
  let lensGap = S * d - lensSize;
  const hold = clamp(Number(o.hold) || 0, 0, 1) * smoothstep(0, 0.5, Math.cos(theta - va));
  if (hold > 0) {
    const cu = Math.cos(theta - va);
    const cv = Math.sin(theta - va);
    const edgePx = viewEdgeDistance(Math.cos(theta), Math.sin(theta), o.viewHalfW, o.viewHalfH, o.shipSx, o.shipSy);
    const margin = Math.max(0, Number(o.gapPx) || 0)
      + Math.abs(cu) * Math.max(0, Number(o.hullHalfLen) || 0)
      + Math.abs(cv) * Math.max(0, Number(o.hullHalfWid) || 0);
    const K = Number(o.sizeK) || P.sizeK;
    const d0 = Math.max(1, Number(o.sizeD0) || P.sizeD0);
    const sh = rr * K / (d + d0) * Math.max(1e-3, Number(o.holdSize) || 1);
    const peek = clamp(Number.isFinite(o.holdPeek) ? o.holdPeek : 0.5, 0, 1);
    const gh = Math.max(margin, edgePx - 2 * sh * peek);
    const win = Math.max(1, Number(o.targetWindow) || P.targetWindow);
    const gn = margin + Math.max(0, edgePx - margin) * Math.max(0, d - rr) / win;
    const w = Math.max(1, Number(o.holdSoft) || 1);
    const gm = 0.5 * (gn + gh + Math.sqrt((gn - gh) * (gn - gh) + w * w));
    lensGap += (gm - lensGap) * hold;
    lensSize = (lensSize > 1e-12 && sh > 1e-12)
      ? Math.exp(Math.log(lensSize) * (1 - hold) + Math.log(sh) * hold)
      : lensSize + (sh - lensSize) * hold;
    out.edge = edgePx;
  }
  const gap = flatGap + (lensGap - flatGap) * beta;
  const size = (flatSize > 1e-9 && lensSize > 1e-9)
    ? Math.exp(Math.log(flatSize) * (1 - beta) + Math.log(lensSize) * beta)
    : flatSize * (1 - beta) + lensSize * beta;
  const rho = Math.max(0, gap + size);
  out.x = Math.cos(theta) * rho;
  out.y = Math.sin(theta) * rho;
  out.size = size;
  out.theta = theta;
  out.gap = gap;
  return out;
}

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
