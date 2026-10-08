// src/ui/radar/cockpitRadar.js
//
// Radar kokpitu: śledzenie (radarTracker.js) + tarcza (radarDisplay.js) + stan widoku: zasięg z płynnym
// przejściem (kółko / klik), orientacja H-UP ↔ N-UP (przejście kąta, bez opóźnienia przy obrocie okrętu),
// kursor nad tarczą (linia namiaru, odległość, podświetlenie śladu), wybór śladu kliknięciem.
// Zasięg i orientacja zapisane w localStorage (sc_radar_range, sc_radar_orient).

import { RADAR_RANGES, RADAR_TUNE, stepRadarRange } from './radarConfig.js';
import { angleDelta, createRadarTracker, radarTheta, radarUnproject, stepRadarTracker } from './radarTracker.js';
import { createRadarDisplay } from './radarDisplay.js';

const LS_RANGE = 'sc_radar_range';
const LS_ORIENT = 'sc_radar_orient';

function loadNumber(key, fallback) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch { return fallback; }
}

function loadString(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function save(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* prywatne okno */ }
}

export class CockpitRadar {
  constructor(tune = RADAR_TUNE) {
    this.tune = tune;
    this.tracker = createRadarTracker(tune);
    this.display = createRadarDisplay(tune);
    const r = loadNumber(LS_RANGE, 20000);
    this.range = RADAR_RANGES.includes(r) ? r : 20000;
    this.rangeShown = this.range;
    this.orient = loadString(LS_ORIENT, 'head') === 'north' ? 'north' : 'head';
    this.orientBlend = this.orient === 'head' ? 1 : 0;
    this.lastNow = 0;
    this.hover = null;
    this.frame = {
      tracker: this.tracker, own: null, theta: 0, orient: this.orient, range: this.range, settled: true,
      mode: 'dome', fontPx: 10, symbolScale: 1, time: 0, hover: null, world: null, overlay: null
    };
    this.stats = { drawMs: 0, stepMs: 0 };
  }

  setRange(range) {
    if (!RADAR_RANGES.includes(range)) return this.range;
    this.range = range;
    save(LS_RANGE, range);
    return range;
  }

  cycleRange(direction, wrap = false) {
    return this.setRange(stepRadarRange(this.range, direction, wrap));
  }

  setOrient(orient) {
    this.orient = orient === 'north' ? 'north' : 'head';
    save(LS_ORIENT, this.orient);
    return this.orient;
  }

  toggleOrient() {
    return this.setOrient(this.orient === 'head' ? 'north' : 'head');
  }

  setHover(x, y) {
    if (x == null || y == null) { this.hover = null; return; }
    if (!this.hover) this.hover = { x: 0, y: 0 };
    this.hover.x = x;
    this.hover.y = y;
  }

  /**
   * Krok i rysunek. feed — radarFeed.feed (gra), opts: { mode: 'dome'|'full', dpr, shrink, now (ms) }.
   */
  render(ctx, W, H, feed, opts = {}) {
    if (!ctx || !feed) return null;
    const now = Number(opts.now) || (typeof performance !== 'undefined' ? performance.now() : 0);
    const dtReal = this.lastNow > 0 ? Math.min(0.25, Math.max(0, (now - this.lastNow) / 1000)) : 0;
    this.lastNow = now;
    const dt = feed.paused ? 0 : dtReal;
    // orientacja: mieszanie θ(N-UP) = 0 → θ(H-UP) bez opóźnienia względem kursu
    const target = this.orient === 'head' ? 1 : 0;
    const ob = 1 - Math.exp(-dtReal / Math.max(0.01, this.tune.orientEase / 3));
    this.orientBlend += (target - this.orientBlend) * ob;
    if (Math.abs(target - this.orientBlend) < 0.002) this.orientBlend = target;
    const heading = Number(feed.own?.heading) || 0;
    const thetaHead = radarTheta(heading, 'head');
    const theta = angleDelta(0, thetaHead) * this.orientBlend;
    // zasięg: przejście w skali logarytmicznej
    const rk = 1 - Math.exp(-dtReal / Math.max(0.01, this.tune.rangeEase / 3));
    const lr = Math.log(this.rangeShown) + (Math.log(this.range) - Math.log(this.rangeShown)) * rk;
    this.rangeShown = Math.exp(lr);
    const settled = Math.abs(Math.log(this.range / this.rangeShown)) < 0.003;
    if (settled) this.rangeShown = this.range;

    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    feed.theta = theta;
    stepRadarTracker(this.tracker, feed, dt, this.tune);
    const t1 = typeof performance !== 'undefined' ? performance.now() : 0;

    const f = this.frame;
    f.own = feed.own;
    f.theta = theta;
    f.orient = this.orientBlend > 0.5 ? 'head' : 'north';
    f.range = this.rangeShown;
    f.settled = settled;
    f.mode = opts.mode === 'full' ? 'full' : 'dome';
    const dpr = Math.max(1, Number(opts.dpr) || 1);
    const shrink = Math.max(0.4, Math.min(1, Number(opts.shrink) || 1));
    // czcionka ≥ 10 px CSS po pomniejszeniu kopuły (zasada kokpitu), na dużych ekranach z projektem
    const u = Math.min(W, H) / 280;
    f.fontPx = Math.max(10 * dpr / shrink, 8.6 * u / Math.sqrt(shrink));
    f.symbolScale = 1 / Math.sqrt(shrink);
    f.time = this.tracker.time;
    f.hover = f.mode === 'full' ? this.hover : null;
    f.world = feed.world;
    f.overlay = feed.overlay;
    this.display.draw(ctx, W, H, f);
    const t2 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.stats.stepMs = t1 - t0;
    this.stats.drawMs = t2 - t1;
    return f;
  }

  pick(x, y, radius = 0) {
    return this.display.pick(x, y, radius);
  }

  /**
   * Punkt płótna tarczy (px) → świat gry wg ostatniego rysunku (obrót H-UP, zasięg); null poza kołem
   * zasięgu. Upuszczenie karty wsparcia na radar (cockpitUI.finishSupportDrag).
   */
  worldAt(px, py, out = { x: 0, y: 0 }) {
    const f = this.frame;
    if (!f.own || !(f.W > 0)) return null;
    const dx = px - f.cx;
    const dy = py - f.cy;
    if (dx * dx + dy * dy > f.R * f.R) return null;
    radarUnproject(px, py, f.theta, f.k, f.cx, f.cy, out);
    out.x += f.own.x;
    out.y += f.own.y;
    return out;
  }

  get counts() {
    return this.tracker.counts;
  }
}
