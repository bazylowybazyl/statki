// src/game/hullDesign/hullDesignCastles.js
//
// KREATOR KADŁUBÓW — KASZTELE: schodkowe nadbudówki w stylu Terra Novy (czyste dane, bez three i DOM). Kasztel to
// blok-trapez — rogi od strony burty ścięte pod 45° (`taper`, osobno dziób / rufa: `taperF`, `taperB`), od strony osi
// lekko (`taperIn`) — z drugim, węższym piętrem: domyślnie przy burcie (`high: 'out'` — wysoka część od burty, schodek
// w dół ku osi, jak kasztel rufowy Citadelli, wieże rufowe Bellatora i Hasty), `'in'` — przy osi. Na górnym piętrze
// kratka-radiator (listwy albo krata), na niższym iluminator i klapy na stopniu.
// Rozwinięcie (expandHullDesign) zamienia kasztel na wielokąty pięter i moduły — reszta kreatora o kasztelach nie wie.
//
// Projekt: castles: [{ x, y (środek), w, h (pół-wymiary: wzdłuż i w poprzek kadłuba), rot, tiers (1–2), taper (0–0,95:
// faza rogów od burty, ułamek h; taperF / taperB — osobno róg dziobowy / rufowy), taperIn (od osi), high ('out' |
// 'in'), level (poziom pierwszego piętra 1–3, domyślnie 2 — nadbudówka),
// clip (poziom, do którego przyciąć: 1 — kasztel rośnie tylko na płytach pancerza; bez clip — lita bryła, przykrywa
// szczeliny pod sobą), split (0,15–1: część wysokości kasztelu, którą zajmuje drugie piętro, licząc od burty przy
// high 'out' / od osi przy 'in' — np. 0,4: górna półka z kratą jak kasztel rufowy Citadelli; kasztel na osi przy
// 'out' dostaje dwie półki, po jednej przy każdej burcie; 1 — piętro na prawie całym kasztelu), vent ('slats' |
// 'grid' | 'none'), port (iluminator), hatches (0–4 klap), mirror }]. Strona burty = znak y (kasztel na osi —
// symetryczny, faza z obu stron). Lustro: kopia po drugiej burcie odbita.

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const VENTS = ['slats', 'grid', 'none'];

/** Kasztel po walidacji (null — niepoprawny). */
export function normalizeCastle(c, levels = 4) {
  if (!c || typeof c !== 'object') return null;
  const out = {
    x: num(c.x), y: num(c.y), w: Math.max(2, num(c.w, 40)), h: Math.max(2, num(c.h, 30)), rot: num(c.rot),
    tiers: clamp(Math.round(num(c.tiers, 2)), 1, 2),
    taper: clamp(num(c.taper, 0.45), 0, 1.9), taperIn: clamp(num(c.taperIn, 0.12), 0, 0.95),
    split: clamp(num(c.split, 1), 0.15, 1),
    high: c.high === 'in' ? 'in' : 'out',
    level: clamp(Math.round(num(c.level, 2)), 1, levels - 1),
    vent: VENTS.includes(c.vent) ? c.vent : 'slats',
    port: c.port === true,
    hatches: clamp(Math.round(num(c.hatches, 2)), 0, 4)
  };
  if (c.taperF !== undefined) out.taperF = clamp(num(c.taperF), 0, 1.9);
  if (c.taperB !== undefined) out.taperB = clamp(num(c.taperB), 0, 1.9);
  if (c.clip !== undefined) out.clip = clamp(Math.round(num(c.clip)), 0, levels - 1);
  if (c.mirror === false) out.mirror = false;
  return out;
}

/**
 * Obrys piętra w układzie kasztelu: prostokąt [x0, x1] × [y0, y1] z fazą rogów od strony burty (−y przy os = −1):
 * `cf` — róg dziobowy (x1), `cb` — rufowy (x0), `ci` — rogi od osi.
 */
function tierLoop(x0, x1, y0, y1, cf, cb, ci, os) {
  const w = x1 - x0, h = y1 - y0;
  const i = Math.min(ci, w * 0.3, h * 0.45);
  // faza od burty może sięgać prawie całej wysokości (blok-trapez), przód + tył — w szerokości
  const lim = (c) => Math.min(c, w * 0.96, (h - i) * 0.97);
  let f = lim(cf), b = lim(cb);
  if (f + b > w * 0.96) { const k = (w * 0.96) / (f + b); f *= k; b *= k; }
  // strona burty: y0 przy os = −1 (y rośnie ku osi), y1 przy os = +1
  const yOut = os < 0 ? y0 : y1, yIn = os < 0 ? y1 : y0, sOut = os < 0 ? 1 : -1, sIn = -sOut;
  const pts = [
    [x0 + b, yOut], [x1 - f, yOut], [x1, yOut + sOut * f], [x1, yIn + sIn * i],
    [x1 - i, yIn], [x0 + i, yIn], [x0, yIn + sIn * i], [x0, yOut + sOut * b]
  ];
  return os < 0 ? pts : pts.reverse();
}

/** Obrys piętra kasztelu na osi (symetryczny): faza `co` z obu stron. */
function tierLoopAxis(x0, x1, hy, cf, cb = cf) {
  let f = Math.min(cf, hy * 0.97), b = Math.min(cb, hy * 0.97);
  const w = x1 - x0;
  if (f + b > w * 0.96) { const k = (w * 0.96) / (f + b); f *= k; b *= k; }
  return [[x0 + b, -hy], [x1 - f, -hy], [x1, -hy + f], [x1, hy - f], [x1 - f, hy], [x0 + b, hy], [x0, hy - b], [x0, -hy + b]];
}

/**
 * Kasztel → { shapes, modules } w układzie projektu. `flip` — kopia lustra (y → −y), `detail` — jd [j.] (kratki,
 * klapy i iluminator w skali detalu okrętu), `levels` — liczba poziomów projektu.
 */
export function expandCastle(c, flip = false, detail = 0.6, levels = 4) {
  const D = detail;
  const axis = Math.abs(c.y) < c.h * 0.35;
  const os = axis ? 0 : (c.y < 0 ? -1 : 1);
  const cr = Math.cos(c.rot || 0), sr = Math.sin(c.rot || 0);
  const fy = flip ? -1 : 1;
  const toW = ([lx, ly]) => [c.x + lx * cr - ly * sr, (c.y + lx * sr + ly * cr) * fy];
  const rotW = (a) => ((c.rot || 0) + a) * fy;
  const shapes = [], modules = [];
  const ci = c.taperIn * c.h;
  const cf = (c.taperF ?? c.taper) * c.h, cb = (c.taperB ?? c.taper) * c.h;
  const chamfer = Math.max(0.6, 1.4 * D);
  // piętro 1
  const t1 = axis ? tierLoopAxis(-c.w, c.w, c.h, cf, cb) : tierLoop(-c.w, c.w, -c.h, c.h, cf, cb, ci, os);
  const lv1 = c.level;
  shapes.push({ kind: 'poly', op: 'add', level: lv1, pts: t1.map(toW), ch: chamfer, clip: c.clip, mirror: false, castle: true });
  // piętro 2: węższe, krótsze z obu końców; przy burcie (high 'out' — schodek w dół ku osi) albo przy osi ('in')
  const step = Math.max(Math.min(c.w, c.h) * 0.22, 3 * D);
  const nearOut = c.high !== 'in';
  let top = { x0: -c.w, x1: c.w, y0: -c.h, y1: c.h };
  if (c.tiers >= 2 && lv1 + 1 < levels) {
    const x0 = -c.w + step, x1 = c.w - step;
    const a = nearOut ? 0.35 : 1.6, b = nearOut ? 1.6 : 0.35;      // wcięcie od burty / od osi [× step]
    const sp = c.split ?? 1;
    // pasy y piętra 2 (w układzie kasztelu): półka przy burcie / przy osi (split) albo prawie cały kasztel
    const bands = [];
    if (axis) {
      if (sp >= 0.999) bands.push([-c.h + step, c.h - step]);
      else if (nearOut) { bands.push([-c.h + step * 0.35, -c.h + sp * c.h]); bands.push([c.h - sp * c.h, c.h - step * 0.35]); }
      else bands.push([-sp * c.h, sp * c.h]);
    } else {
      // y0 przy burcie dla os < 0 (burta = −h), dla os > 0 burta = +h
      let lo = -c.h + step * (os < 0 ? a : b), hi = c.h - step * (os < 0 ? b : a);
      if (sp < 0.999) {
        const span = sp * 2 * c.h;
        const outerLo = os < 0;                                     // burta przy −h
        if (nearOut === outerLo) hi = Math.min(hi, -c.h + span); else lo = Math.max(lo, c.h - span);
      }
      bands.push([lo, hi]);
    }
    for (const [y0, y1] of bands) {
      if (!(x1 - x0 > 4 * D && y1 - y0 > 3 * D)) continue;
      const k = (y1 - y0) / (2 * c.h);
      // fazy piętra: przy burcie jak piętro 1 (przeskalowane), od strony stopnia lekko
      const t2 = axis
        ? tierLoopAxis(x0, x1, (y1 - y0) / 2, Math.min(cf, (y1 - y0) * 0.45) * 0.8, Math.min(cb, (y1 - y0) * 0.45) * 0.8).map(([x, y]) => [x, y + (y0 + y1) / 2])
        : tierLoop(x0, x1, y0, y1, cf * Math.max(k, 0.35), cb * Math.max(k, 0.35), ci * 0.6, os);
      // piętro 2 przycięte do poziomu piętra 1 (nie wystaje poza fazy kasztelu ani płyty pod nim)
      shapes.push({ kind: 'poly', op: 'add', level: lv1 + 1, pts: t2.map(toW), ch: chamfer, clip: lv1, mirror: false, castle: true });
      top = { x0, x1, y0, y1 };
    }
  }
  const tcx = (top.x0 + top.x1) / 2, tcy = (top.y0 + top.y1) / 2;
  const thw = (top.x1 - top.x0) / 2, thh = (top.y1 - top.y0) / 2;
  // kratka-radiator na górnym piętrze: dłuższa w poprzek kasztelu (listwy wzdłuż), bliżej burty i rufy
  if (c.vent !== 'none' && thw > 5 * D && thh > 5 * D) {
    const vw = clamp(thw * 0.3, 2.5 * D, 16 * D), vh = clamp(thh * 0.5, 3 * D, 22 * D);
    const vx = tcx - thw * 0.15;
    const vy = axis ? tcy : tcy + os * (thh - vh) * 0.35;
    const [x, y] = toW([vx, vy]);
    modules.push({ type: 'vent', x, y, w: vw, h: vh, rot: rotW(0), v: c.vent === 'grid' ? 2 : 1, mirror: false, castle: true });
  }
  // iluminator na piętrze 1 przy rogu od osi, z przodu
  if (c.port) {
    const pr = clamp(Math.min(c.w, c.h) * 0.16, 2 * D, 12 * D);
    const py = axis ? 0 : -os * (c.h - pr * 1.9);
    const px = axis ? c.w - pr * 1.9 : c.w * 0.45;
    const [x, y] = toW([px, py]);
    modules.push({ type: 'well', x, y, r: pr, v: 1, mirror: false, castle: true });
  }
  // klapy na stopniu (między krawędzią piętra 1 a piętrem 2: od osi przy high 'out', od burty przy 'in')
  if (c.hatches > 0) {
    const sideK = nearOut ? -os : os;
    const hy = axis ? -(c.h - step * 0.5) : sideK * (c.h - step * 0.62);
    const hw = clamp(c.w * 0.09, 1.6 * D, 7 * D), hh = clamp(step * 0.26, 1.1 * D, 4 * D);
    const xs = c.hatches === 1 ? [0] : Array.from({ length: c.hatches }, (_, k) => -c.w * 0.55 + (k * c.w * 1.1) / (c.hatches - 1));
    for (const hx of xs) {
      const [x, y] = toW([hx, hy]);
      modules.push({ type: 'hatch', x, y, w: hw, h: hh, rot: rotW(0), v: 1, mirror: false, castle: true });
    }
  }
  return { shapes, modules };
}
