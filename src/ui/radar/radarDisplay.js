// src/ui/radar/radarDisplay.js
//
// Tarcza radaru (płótno 2D) — wskaźnik PPI z nakładką śledzenia. Kolejność warstw (od spodu):
//   szkło (gradient + ziarno) → podkład terenu (ląd, ring, pas, budowle; radarTerrain.js) z POŚWIATĄ
//   PRZEMIATANIA (teren jaśnieje, gdy przejdzie wiązka) → pierścienie zasięgu i podziałka namiaru →
//   zasięg wzroku (mgła) i zasięg broni w ręku → wiązka anteny → SUROWE ECHO śladów (luminofor, gaśnie)
//   i ślad ostatnich pozycji → znaczniki zniszczeń, sygnatury masy, duchy → SYMBOLE śladów z wektorami
//   prędkości, namiar / zaznaczenie, etykiety (numer śladu, klasa, odległość) → cel podróży i cele misji
//   → własny okręt (sylwetka, linia kursu, wektor prędkości) → impuls skanera X → znaczniki na obrzeżu
//   (kurs, północ), zagrożenia z tyłu (kopuła), linia namiaru i znacznik odległości pod kursorem (Alt).
//
// Układ: płótno kwadratowe W×W, środek = okręt, promień zasięgu R = 0,455 W. u = W / 280 (jednostka
// projektu — 280 to średnica płótna kokpitu po Alt przy 1080p). Kąty jak w płótnie: 0 = w prawo,
// zgodnie z zegarem; obrót świat → tarcza θ (radarTracker.radarTheta).

import { RADAR_TUNE, RADAR_RGB, formatRadarDistance, formatRadarRing, scanPulseRadius } from './radarConfig.js';
import { radarEchoLevel, relativeBearing, normAngle } from './radarTracker.js';
import { createRadarTerrain } from './radarTerrain.js';
import {
  drawRadarSymbol, drawRadarText, radarAffRgb, radarColor, radarSymbolSize, strokeRadarBrackets
} from './radarSymbols.js';

const TAU = Math.PI * 2;
const RING_STEPS = Object.freeze([500, 1000, 2000, 2500, 5000, 10000, 15000, 20000, 25000, 50000, 100000]);
// Podpisy pierścieni na namiarze ~godz. 1 (w kopule widoczne, nad prawym barkiem).
const RING_LABEL_ANGLE = -Math.PI / 2 + 0.42;

export function radarRingStep(range) {
  const want = range / 4.2;
  for (let i = 0; i < RING_STEPS.length; i++) if (RING_STEPS[i] >= want) return RING_STEPS[i];
  return RING_STEPS[RING_STEPS.length - 1];
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function makeCanvas() {
  if (typeof document === 'undefined') return null;
  return document.createElement('canvas');
}

export function createRadarDisplay(tune = RADAR_TUNE) {
  const terrain = createRadarTerrain(tune);
  const scratch = makeCanvas();
  const scratchCtx = scratch ? scratch.getContext('2d') : null;
  const cache = { bg: null, bgKey: '', face: null, faceKey: '' };
  const blobs = new Map();          // rgb → kropla echa (radialny gradient)
  const silhouettes = new Map();    // klucz → zabarwiona sylwetka kadłuba
  const silIds = new WeakMap();
  let silSeq = 1;
  const picks = [];
  let pickCount = 0;
  const tagRects = [];
  let tagRectCount = 0;
  const _p = { x: 0, y: 0 };
  const _q = { x: 0, y: 0 };
  const stats = { drawMs: 0, tracks: 0, echoes: 0 };
  let hovered = null;

  function blob(rgb) {
    let c = blobs.get(rgb);
    if (c || !scratch) return c || null;
    c = makeCanvas();
    c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, radarColor(rgb, 1));
    grad.addColorStop(0.35, radarColor(rgb, 0.75));
    grad.addColorStop(0.7, radarColor(rgb, 0.22));
    grad.addColorStop(1, radarColor(rgb, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    blobs.set(rgb, c);
    return c;
  }

  function silhouette(source, w, h, rgb) {
    if (!source) return null;
    const sw = Number(source.naturalWidth || source.width) || 0;
    const sh = Number(source.naturalHeight || source.height) || 0;
    if (!(sw > 0 && sh > 0)) return null;
    const qw = Math.max(4, Math.round(w / 4) * 4);
    const qh = Math.max(4, Math.round(h / 4) * 4);
    if (qw > 512 || qh > 512) return null;
    let id = silIds.get(source);
    if (!id) { id = silSeq++; silIds.set(source, id); }
    const key = `${id}|${qw}x${qh}|${rgb}`;
    let c = silhouettes.get(key);
    if (c) return c;
    if (silhouettes.size > 160) silhouettes.clear();
    c = makeCanvas();
    if (!c) return null;
    c.width = qw; c.height = qh;
    const g = c.getContext('2d');
    try {
      g.drawImage(source, 0, 0, qw, qh);
    } catch {
      return null;
    }
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = radarColor(rgb, 1);
    g.fillRect(0, 0, qw, qh);
    silhouettes.set(key, c);
    return c;
  }

  // ------------------------------------------------------------------ szkło (pamięć podręczna)
  function background(W) {
    const key = `${W}`;
    if (cache.bg && cache.bgKey === key) return cache.bg;
    const c = makeCanvas();
    c.width = W; c.height = W;
    const g = c.getContext('2d');
    const cx = W / 2;
    const rim = W / 2;
    const grad = g.createRadialGradient(cx, cx, 0, cx, cx, rim);
    grad.addColorStop(0, radarColor(RADAR_RGB.bgCenter, 0.95));
    grad.addColorStop(0.72, radarColor('7, 12, 19', 0.96));
    grad.addColorStop(1, radarColor(RADAR_RGB.bgRim, 0.98));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cx, rim, 0, TAU);
    g.fill();
    // ziarno luminoforu (stałe — szum w czasie robi przemiatanie)
    const img = g.getImageData(0, 0, W, W);
    const d = img.data;
    let seed = 0x2545F491;
    const amp = tune.grain * 255;
    for (let i = 0; i < d.length; i += 4) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const n = ((seed >>> 0) / 4294967295 - 0.5) * amp;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 1.3));
    }
    g.putImageData(img, 0, 0);
    // odblask szkła przy brzegu
    const edge = g.createRadialGradient(cx, cx, rim * 0.86, cx, cx, rim);
    edge.addColorStop(0, 'rgba(120, 170, 220, 0)');
    edge.addColorStop(0.85, 'rgba(120, 170, 220, 0.05)');
    edge.addColorStop(1, 'rgba(120, 170, 220, 0)');
    g.fillStyle = edge;
    g.beginPath();
    g.arc(cx, cx, rim, 0, TAU);
    g.fill();
    cache.bg = c;
    cache.bgKey = key;
    return c;
  }

  // ------------------------------------------------------------------ pierścienie i podziałka
  function face(W, range, f) {
    const R = W * 0.455;
    const key = `${W}|${Math.round(range)}|${f.orient}|${f.mode}|${Math.round(f.fontPx * 10)}`;
    if (cache.face && cache.faceKey === key) return cache.face;
    let c = cache.face;
    if (!c) { c = makeCanvas(); cache.face = c; }
    if (c.width !== W) { c.width = W; c.height = W; }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    const cx = W / 2;
    const rim = W / 2;
    const u = W / 280;
    const k = R / range;
    // szprychy co 30° (od środka do skraju zasięgu)
    g.strokeStyle = radarColor(RADAR_RGB.grid, 0.05);
    g.lineWidth = Math.max(0.6, 0.6 * u);
    g.beginPath();
    for (let deg = 0; deg < 360; deg += 30) {
      const a = deg * Math.PI / 180;
      g.moveTo(cx + Math.cos(a) * R * 0.06, cx + Math.sin(a) * R * 0.06);
      g.lineTo(cx + Math.cos(a) * R, cx + Math.sin(a) * R);
    }
    g.stroke();
    // pierścienie zasięgu: co drugi przerywany; skraj jaśniej
    const step = radarRingStep(range);
    g.font = `${f.fontPx}px Consolas, "Courier New", monospace`;
    let idx = 0;
    for (let dist = step; dist < range - step * 0.2; dist += step) {
      const r = dist * k;
      idx++;
      if (r < 7 * u) continue;
      g.strokeStyle = radarColor(RADAR_RGB.grid, idx % 2 ? 0.075 : 0.11);
      g.lineWidth = Math.max(0.6, 0.7 * u);
      if (idx % 2) g.setLineDash([2.5 * u, 3.5 * u]);
      g.beginPath();
      g.arc(cx, cx, r, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      const lx = cx + Math.cos(RING_LABEL_ANGLE) * r + 2 * u;
      const ly = cx + Math.sin(RING_LABEL_ANGLE) * r;
      drawRadarText(g, formatRadarRing(dist), lx, ly, RADAR_RGB.label, 0.5, 'left', 'middle', 2.5 * u);
    }
    g.strokeStyle = radarColor(RADAR_RGB.grid, 0.2);
    g.lineWidth = Math.max(0.8, 0.9 * u);
    g.beginPath();
    g.arc(cx, cx, R, 0, TAU);
    g.stroke();
    // podziałka namiaru: 5° / 10° / 30° z podpisami (H-UP: namiar względny, 000 = dziób)
    for (let pass = 0; pass < 3; pass++) {
      g.beginPath();
      for (let deg = 0; deg < 360; deg += 5) {
        const level = deg % 30 === 0 ? 2 : deg % 10 === 0 ? 1 : 0;
        if (level !== pass) continue;
        const a = deg * Math.PI / 180 - Math.PI / 2;
        const len = (level === 2 ? 5.5 : level === 1 ? 3.4 : 2) * u;
        const r0 = rim - 1.2 * u;
        g.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * (r0 - len), cx + Math.sin(a) * (r0 - len));
      }
      g.strokeStyle = radarColor(RADAR_RGB.grid, pass === 2 ? 0.5 : pass === 1 ? 0.27 : 0.15);
      g.lineWidth = Math.max(0.7, (pass === 2 ? 1.1 : 0.8) * u);
      g.stroke();
    }
    const labelR = rim - 6.5 * u - f.fontPx * 0.62;
    for (let deg = 0; deg < 360; deg += 30) {
      // kopuła: dolna połowa i tak schowana — bez podpisów (mniej pracy i bałaganu na cięciwie);
      // pod odczytem nad tarczą (WRÓG · zasięg · H-UP) — bez 000 (kopuła: także 330 i 030), dziób znaczy grot kursu
      if (f.mode === 'dome' && deg > 90 && deg < 270) continue;
      if (deg === 0 || (f.mode === 'dome' && (deg === 30 || deg === 330))) continue;
      const a = deg * Math.PI / 180 - Math.PI / 2;
      const text = deg === 0 && f.orient !== 'north' ? '000' : String(deg).padStart(3, '0');
      drawRadarText(g, text, cx + Math.cos(a) * labelR, cx + Math.sin(a) * labelR, RADAR_RGB.label,
        deg === 0 ? 0.75 : 0.42, 'center', 'middle', 2.5 * u);
    }
    // Rdzeń: maleńki krzyż w środku (sylwetka okrętu i tak go przykrywa przy zbliżeniu).
    cache.faceKey = key;
    return c;
  }

  // ------------------------------------------------------------------ pomocnicze
  // radarProject z cos / sin kąta tarczy liczonymi raz na rysunek (draw: f.cosT, f.sinT) — to samo wyrażenie,
  // te same liczby; dawniej dwie funkcje trygonometryczne na każdy rzut (setki na klatkę w bitwie).
  function proj(dx, dy, f, out) {
    const c = f.cosT;
    const s = f.sinT;
    out.x = f.cx + (dx * c - dy * s) * f.k;
    out.y = f.cy + (dx * s + dy * c) * f.k;
    return out;
  }

  function inDisc(x, y, f, pad = 0) {
    const dx = x - f.cx;
    const dy = y - f.cy;
    const r = f.R + pad;
    return dx * dx + dy * dy <= r * r;
  }

  function pushPick(track, x, y, r) {
    let p = picks[pickCount];
    if (!p) { p = { track: null, x: 0, y: 0, r: 0 }; picks[pickCount] = p; }
    p.track = track; p.x = x; p.y = y; p.r = r;
    pickCount++;
  }

  function rectFree(x0, y0, x1, y1) {
    for (let i = 0; i < tagRectCount; i++) {
      const r = tagRects[i];
      if (x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0) return false;
    }
    return true;
  }

  function pushRect(x0, y0, x1, y1) {
    let r = tagRects[tagRectCount];
    if (!r) { r = { x0: 0, y0: 0, x1: 0, y1: 0 }; tagRects[tagRectCount] = r; }
    r.x0 = x0; r.y0 = y0; r.x1 = x1; r.y1 = y1;
    tagRectCount++;
  }

  // ------------------------------------------------------------------ warstwy dynamiczne
  function drawTerrain(ctx, f) {
    terrain.update({
      time: f.time, ox: f.own.x, oy: f.own.y, range: f.range, k: f.k, R: f.R, u: f.u,
      settled: f.settled, world: f.world
    });
    const L = terrain.layer;
    if (!L.valid || !L.drawn) return;
    // podkład przygaszony
    terrain.draw(ctx, f.cx, f.cy, f.theta, f.own.x, f.own.y, f.k, 0.52);
    // poświata przemiatania: ten sam podkład maskowany smugą wiązki, dodany jasno
    if (!scratchCtx) return;
    if (scratch.width !== f.W) { scratch.width = f.W; scratch.height = f.W; }
    const g = scratchCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, f.W, f.W);
    terrain.draw(g, f.cx, f.cy, f.theta, f.own.x, f.own.y, f.k, 1);
    if (typeof g.createConicGradient !== 'function') return;
    const trail = 1.25;
    const start = f.sweep - trail;
    const grad = g.createConicGradient(start, f.cx, f.cy);
    const end = trail / TAU;
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(end * 0.55, 'rgba(255,255,255,0.18)');
    grad.addColorStop(end * 0.97, 'rgba(255,255,255,0.95)');
    grad.addColorStop(end, 'rgba(255,255,255,1)');
    grad.addColorStop(Math.min(1, end + 0.004), 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = grad;
    g.fillRect(0, 0, f.W, f.W);
    g.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.62;
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
  }

  function drawSweep(ctx, f) {
    const a = f.sweep;
    const reach = f.rim;
    if (typeof ctx.createConicGradient === 'function') {
      const trail = 1.1;
      const grad = ctx.createConicGradient(a - trail, f.cx, f.cy);
      const end = trail / TAU;
      grad.addColorStop(0, radarColor(RADAR_RGB.sweep, 0));
      grad.addColorStop(end * 0.7, radarColor(RADAR_RGB.sweep, 0.035));
      grad.addColorStop(end, radarColor(RADAR_RGB.sweep, 0.16));
      grad.addColorStop(Math.min(1, end + 0.002), radarColor(RADAR_RGB.sweep, 0));
      grad.addColorStop(1, radarColor(RADAR_RGB.sweep, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(f.cx, f.cy);
      ctx.arc(f.cx, f.cy, reach, a - trail, a + 0.004);
      ctx.closePath();
      ctx.fill();
    }
    const x1 = f.cx + Math.cos(a) * f.R;
    const y1 = f.cy + Math.sin(a) * f.R;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = radarColor(RADAR_RGB.sweep, 0.06);
    ctx.lineWidth = 3.4 * f.u;
    ctx.beginPath();
    ctx.moveTo(f.cx, f.cy);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const lg = ctx.createLinearGradient(f.cx, f.cy, x1, y1);
    lg.addColorStop(0, radarColor(RADAR_RGB.sweep, 0.05));
    lg.addColorStop(0.6, radarColor(RADAR_RGB.sweep, 0.32));
    lg.addColorStop(1, radarColor(RADAR_RGB.sweep, 0.55));
    ctx.strokeStyle = lg;
    ctx.lineWidth = Math.max(0.7, 0.85 * f.u);
    ctx.beginPath();
    ctx.moveTo(f.cx, f.cy);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  function drawEchoes(ctx, f, tr) {
    const list = tr.list;
    const echoBlob = blob(RADAR_RGB.echo);
    if (!echoBlob) return;
    const beam = tune.beamWidth;
    const histLife = tune.historyLen * tune.sweepPeriod;
    let n = 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!(t.paints > 0)) continue;
      const level = radarEchoLevel(tr, t, tune);
      // ślad ostatnich pozycji (malowania sprzed obecnego)
      if (t.hN > 1 && t.kind !== 'station') {
        const rgb = radarAffRgb(t.aff, t.kind);
        const dot = Math.max(0.8, 0.95 * f.u);
        for (let j = 1; j < t.hN; j++) {
          const idx = (t.hHead - 1 - j + tune.historyLen * 2) % tune.historyLen;
          const age = tr.time - t.hT[idx];
          const a = 0.5 * (1 - age / histLife);
          if (a <= 0.02) continue;
          proj(t.hx[idx] - f.own.x, t.hy[idx] - f.own.y, f, _p);
          if (!inDisc(_p.x, _p.y, f)) continue;
          ctx.fillStyle = radarColor(rgb, a);
          ctx.fillRect(_p.x - dot * 0.5, _p.y - dot * 0.5, dot, dot);
        }
      }
      // stacje: echo lądu robi podkład terenu (prawdziwy obrys), kropla tylko by go zalała
      if (level < 0.025 || t.kind === 'station') continue;
      proj(t.px - f.own.x, t.py - f.own.y, f, _p);
      if (!inDisc(_p.x, _p.y, f, 6 * f.u)) continue;
      const lenPx = t.length * f.k;
      const widPx = t.width * f.k;
      const big = Math.max(lenPx, widPx);
      const alpha = Math.min(1, level);
      // kadłub większy niż kropla: echo w kształcie sylwetki (jak radar wysokiej rozdzielczości)
      if (big >= 8 * f.u && t.sprite) {
        const sil = silhouette(t.sprite, lenPx, widPx, RADAR_RGB.echo);
        if (sil) {
          const rot = t.pAngle + t.spriteRot + f.theta;
          const c = Math.cos(rot);
          const s = Math.sin(rot);
          ctx.globalAlpha = alpha * 0.85;
          ctx.setTransform(c * lenPx, s * lenPx, -s * widPx, c * widPx, _p.x, _p.y);
          ctx.drawImage(sil, -0.5, -0.5, 1, 1);
          ctx.globalAlpha = alpha * 0.22;
          ctx.setTransform(c * lenPx * 1.35, s * lenPx * 1.35, -s * widPx * 1.8, c * widPx * 1.8, _p.x, _p.y);
          ctx.drawImage(echoBlob, -0.5, -0.5, 1, 1);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          n++;
          continue;
        }
      }
      // kropla: w azymucie szersza z odległością (szerokość wiązki), w promieniu ~długość impulsu
      const rPx = Math.hypot(_p.x - f.cx, _p.y - f.cy);
      const radial = Math.atan2(_p.y - f.cy, _p.x - f.cx);
      const size = t.kind === 'missile' ? 0.55 : t.kind === 'fighter' ? 0.75 : 1;
      const across = Math.max(2.6 * f.u * size, beam * rPx + big * 0.9, 1.6);
      const along = Math.max(2.1 * f.u * size, big * 0.75, 1.4);
      const c = Math.cos(radial);
      const s = Math.sin(radial);
      ctx.globalAlpha = alpha;
      ctx.setTransform(c * along * 2, s * along * 2, -s * across * 2, c * across * 2, _p.x, _p.y);
      ctx.drawImage(echoBlob, -0.5, -0.5, 1, 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      n++;
    }
    ctx.restore();
    stats.echoes = n;
  }

  function drawKills(ctx, f, tr) {
    const kills = tr.kills;
    if (!kills.length) return;
    ctx.save();
    for (let i = 0; i < kills.length; i++) {
      const k = kills[i];
      const age = tr.time - k.t;
      const life = tune.killFade;
      const a = Math.max(0, 1 - age / life);
      if (a <= 0) continue;
      proj(k.x - f.own.x, k.y - f.own.y, f, _p);
      if (!inDisc(_p.x, _p.y, f)) continue;
      const rgb = radarAffRgb(k.aff, k.kind);
      const s = (k.capital ? 4.6 : 3.2) * f.su;
      const blink = age < 0.9 ? (Math.floor(age * 8) % 2 === 0 ? 1 : 0.35) : 1;
      ctx.strokeStyle = radarColor(rgb, a * blink);
      ctx.lineWidth = Math.max(0.9, 1.2 * f.u);
      ctx.beginPath();
      ctx.moveTo(_p.x - s, _p.y - s); ctx.lineTo(_p.x + s, _p.y + s);
      ctx.moveTo(_p.x + s, _p.y - s); ctx.lineTo(_p.x - s, _p.y + s);
      ctx.stroke();
      const ring = s + age * 10 * f.u;
      ctx.strokeStyle = radarColor(rgb, a * 0.35);
      ctx.beginPath();
      ctx.arc(_p.x, _p.y, ring, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMasses(ctx, f) {
    const masses = f.overlay?.masses;
    if (!masses || !masses.length) return;
    ctx.save();
    ctx.font = `${f.fontPx}px Consolas, monospace`;
    for (let i = 0; i < masses.length; i++) {
      const m = masses[i];
      const alpha = Math.max(0, Math.min(1, Number(m.alpha ?? 1)));
      if (alpha <= 0.02) continue;
      proj(m.x - f.own.x, m.y - f.own.y, f, _p);
      const r = Math.max(5 * f.u, (Number(m.spread) || 4000) * f.k);
      if (!inDisc(_p.x, _p.y, f, r)) continue;
      const pulse = 0.65 + 0.35 * Math.sin(f.time * 2.6 + i);
      ctx.fillStyle = radarColor(RADAR_RGB.mass, 0.07 * alpha);
      ctx.beginPath();
      ctx.arc(_p.x, _p.y, r, 0, TAU);
      ctx.fill();
      ctx.setLineDash([3 * f.u, 3 * f.u]);
      ctx.lineDashOffset = -f.time * 6 * f.u;
      ctx.strokeStyle = radarColor(RADAR_RGB.mass, 0.65 * alpha * pulse);
      ctx.lineWidth = Math.max(0.8, 1 * f.u);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      if (inDisc(_p.x, _p.y, f)) {
        drawRadarText(ctx, '?', _p.x, _p.y, RADAR_RGB.mass, 0.9 * alpha, 'center', 'middle', 2.5 * f.u);
        drawRadarText(ctx, 'MASA', _p.x, _p.y + f.fontPx * 0.95, RADAR_RGB.mass, 0.65 * alpha, 'center', 'middle', 2.5 * f.u);
      }
    }
    ctx.restore();
  }

  function drawGhosts(ctx, f) {
    const ghosts = f.overlay?.ghosts;
    if (!ghosts) return;
    const iter = typeof ghosts.values === 'function' ? ghosts.values() : ghosts;
    for (const g of iter) {
      if (!g) continue;
      const life = Number(g.maxAge) || 8;
      const a = Math.max(0, 1 - (Number(g.age) || 0) / life) * 0.7;
      if (a <= 0.03) continue;
      proj(g.x - f.own.x, g.y - f.own.y, f, _p);
      if (!inDisc(_p.x, _p.y, f)) continue;
      drawRadarSymbol(ctx, _p.x, _p.y, {
        kind: 'ship', aff: 'hostile', rgb: RADAR_RGB.ghost, s: (g.isCapital ? 4.6 : 3.4) * f.su,
        alpha: a, fill: 0, dashed: true, lw: 1 * f.u
      });
      drawRadarText(ctx, '?', _p.x + 6.5 * f.su, _p.y - 5.5 * f.su, RADAR_RGB.ghost, a, 'left', 'middle', 2.5 * f.u);
    }
  }

  function vectorSeconds(f) {
    return f.range / tune.vectorBase;
  }

  // Tor punktu (dx, dy) + v·T, przycięty do vectorMaxFrac·R.
  function vectorEnd(x, y, vx, vy, f, out) {
    const T = vectorSeconds(f);
    const c = f.cosT;
    const s = f.sinT;
    let ex = (vx * c - vy * s) * T * f.k;
    let ey = (vx * s + vy * c) * T * f.k;
    const len = Math.hypot(ex, ey);
    const max = f.R * tune.vectorMaxFrac;
    if (len > max) { ex *= max / len; ey *= max / len; }
    out.x = x + ex;
    out.y = y + ey;
    return len;
  }

  function trackPriority(t) {
    if (t.locked) return 0;
    if (t.selected) return 1;
    if (t.objective) return 2;
    if (t.kind === 'missile' && t.aff === 'hostile') return 3;
    if (t.aff === 'hostile') return 4 + t.dist * 1e-7;
    return 9 + t.dist * 1e-7;
  }

  const _tagQueue = [];
  function drawTracks(ctx, f, tr) {
    const list = tr.list;
    pickCount = 0;
    _tagQueue.length = 0;
    const time = tr.time;
    let drawn = 0;
    // dwa przebiegi: zwykłe ślady, potem namierzone / wybrane / cele (na wierzchu)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const top = t.locked || t.selected || t.objective;
        if ((pass === 1) !== top) continue;
        const dx = t.sx - f.own.x;
        const dy = t.sy - f.own.y;
        proj(dx, dy, f, _p);
        const inside = inDisc(_p.x, _p.y, f, -1);
        if (!inside) {
          if (top) drawRimPointer(ctx, f, t, _p);
          continue;
        }
        const rgb = radarAffRgb(t.aff, t.kind);
        const mature = t.no > 0 || t.continuous;
        // Ślad bez ustalenia (jedno malowanie): kwadrat pozyskiwania, przerywany.
        const fresh = !mature;
        const echoA = t.continuous ? 1 : Math.max(0.42, Math.min(1, radarEchoLevel(tr, t, tune) + 0.45));
        const alpha = t.kind === 'station' ? 0.92 : echoA;
        const s = radarSymbolSize(t.kind, t.classified ? t.cls : '', t.capital) * f.su;
        // wektor prędkości
        const speed = Math.hypot(t.svx, t.svy);
        if (mature && speed > tune.vectorMinSpeed && t.kind !== 'station' && t.kind !== 'wreck') {
          vectorEnd(_p.x, _p.y, t.svx, t.svy, f, _q);
          ctx.strokeStyle = radarColor(rgb, alpha * (t.kind === 'missile' ? 0.95 : 0.7));
          ctx.lineWidth = Math.max(0.75, (t.kind === 'missile' ? 1.1 : 0.9) * f.u);
          ctx.beginPath();
          const ang = Math.atan2(_q.y - _p.y, _q.x - _p.x);
          ctx.moveTo(_p.x + Math.cos(ang) * s * 1.1, _p.y + Math.sin(ang) * s * 1.1);
          ctx.lineTo(_q.x, _q.y);
          ctx.stroke();
        }
        const rot = Math.atan2(t.svy, t.svx) + f.theta;
        const heading = (t.kind === 'fighter' || t.kind === 'missile')
          ? (speed > 5 ? rot : t.angle + f.theta) : 0;
        if (fresh && t.kind !== 'station' && t.kind !== 'missile' && t.kind !== 'fighter' && t.kind !== 'drone') {
          ctx.setLineDash([2 * f.u, 2 * f.u]);
          ctx.strokeStyle = radarColor(rgb, 0.75 * echoA);
          ctx.lineWidth = Math.max(0.75, 0.9 * f.u);
          ctx.strokeRect(_p.x - s, _p.y - s, s * 2, s * 2);
          ctx.setLineDash([]);
        } else {
          drawRadarSymbol(ctx, _p.x, _p.y, {
            kind: t.kind, aff: t.aff, cls: t.classified ? t.cls : '', capital: t.capital, s, alpha,
            rotation: heading, lw: Math.max(0.85, 1.15 * f.u), halo: t.kind === 'missile' ? 1 : (t.aff === 'hostile' ? 0.6 : 0.3)
          });
        }
        // nowy wrogi ślad: rozchodzący się pierścień
        const newAge = time - t.newT;
        if (newAge >= 0 && newAge < tune.newContactSec) {
          const k = newAge / tune.newContactSec;
          ctx.strokeStyle = radarColor(rgb, (1 - k) * 0.8);
          ctx.lineWidth = Math.max(0.8, 1 * f.u);
          ctx.beginPath();
          ctx.arc(_p.x, _p.y, s + 2 * f.u + k * 9 * f.u, 0, TAU);
          ctx.stroke();
        }
        // impuls skanera właśnie przeszedł: błysk
        const pingAge = time - t.pingT;
        if (pingAge >= 0 && pingAge < 0.7) {
          const k = pingAge / 0.7;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = radarColor(RADAR_RGB.ping, (1 - k) * 0.9);
          ctx.lineWidth = Math.max(0.8, 1.3 * f.u * (1 - k) + 0.5);
          ctx.beginPath();
          ctx.arc(_p.x, _p.y, s + 1.5 * f.u + k * 6 * f.u, 0, TAU);
          ctx.stroke();
          ctx.restore();
        }
        // namiar / zaznaczenie / cel misji
        if (t.locked) {
          ctx.strokeStyle = radarColor(RADAR_RGB.locked, 0.95);
          ctx.lineWidth = Math.max(0.9, 1.1 * f.u);
          const br = s + 3.4 * f.u;
          strokeRadarBrackets(ctx, _p.x, _p.y, br, Math.max(2.4 * f.u, br * 0.45), Math.sin(time * 1.7) * 0.12);
        } else if (t.selected) {
          ctx.strokeStyle = radarColor(RADAR_RGB.selected, 0.9);
          ctx.lineWidth = Math.max(0.9, 1 * f.u);
          const br = s + 3 * f.u;
          strokeRadarBrackets(ctx, _p.x, _p.y, br, Math.max(2.2 * f.u, br * 0.4));
        }
        if (t.objective && !t.locked) {
          ctx.strokeStyle = radarColor(RADAR_RGB.objective, 0.8 + 0.2 * Math.sin(time * 3));
          ctx.lineWidth = Math.max(0.9, 1.1 * f.u);
          const br = s + 4.2 * f.u;
          strokeRadarBrackets(ctx, _p.x, _p.y, br, Math.max(2 * f.u, br * 0.38), Math.PI / 4);
        }
        pushPick(t, _p.x, _p.y, Math.max(s, 4 * f.u));
        drawn++;
        // etykieta: kolejka (namierzone / wybrane zawsze, reszta wg trybu)
        if (t.kind !== 'wreck' && (top || (f.mode === 'full' && t.aff === 'hostile' && mature && t.kind !== 'missile') || t === hovered)) {
          t._tagX = _p.x; t._tagY = _p.y; t._tagS = s;
          _tagQueue.push(t);
        }
      }
    }
    stats.tracks = drawn;
    // Etykiety: priorytet, limit trybu, bez nachodzenia na siebie i na symbole śladów
    if (_tagQueue.length) {
      for (let i = 0; i < pickCount; i++) {
        const p = picks[i];
        pushRect(p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r);
      }
      _tagQueue.sort((a, b) => trackPriority(a) - trackPriority(b));
      const limit = f.mode === 'full' ? tune.tagsFull : tune.tagsDome;
      let placed = 0;
      for (let i = 0; i < _tagQueue.length; i++) {
        const t = _tagQueue[i];
        const forced = t === hovered || t.locked || t.selected;
        if (!forced && placed >= limit) continue;
        if (drawTag(ctx, f, t, forced)) placed++;
      }
    }
  }

  function tagLines(t, f) {
    const cls = t.classified ? t.cls : '??';
    let l1;
    if (t.kind === 'station') l1 = t.name || 'STACJA';
    else if (t.no) l1 = `T${pad2(t.no)} ${cls}`;
    else l1 = t.classified ? cls : 'KONTAKT';
    if (t.locked) l1 += ' ◆';
    let l2 = formatRadarDistance(t.dist);
    const detail = t === hovered || t.locked || t.selected;
    if (f.mode === 'full' && detail && t.kind !== 'station') {
      const v = Math.hypot(t.svx, t.svy);
      if (v >= 5) l2 += ` · ${Math.round(v)} m/s`;
    }
    const l3 = (f.mode === 'full' && t.classified && t.name && t.kind !== 'station' && (t === hovered || t.selected || t.locked))
      ? t.name : '';
    return [l1, l2, l3];
  }

  function drawTag(ctx, f, t, forced) {
    const [l1, l2, l3] = tagLines(t, f);
    const fs = f.fontPx;
    ctx.font = `${fs}px Consolas, monospace`;
    const w = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width, l3 ? ctx.measureText(l3).width : 0);
    const lines = l3 ? 3 : 2;
    const h = fs * 1.12 * lines;
    const off = t._tagS + 5 * f.u;
    const x = t._tagX;
    const y = t._tagY;
    const cands = [[1, -1], [-1, -1], [1, 1], [-1, 1]];
    for (let c = 0; c < cands.length; c++) {
      const [sx, sy] = cands[c];
      const ax = x + sx * off;
      const ay = y + sy * off;
      const x0 = sx > 0 ? ax : ax - w;
      const y0 = sy > 0 ? ay : ay - h;
      const x1 = x0 + w;
      const y1 = y0 + h;
      // w tarczy (rogi etykiety w kole zasięgu) i bez nachodzenia
      if (!inDisc(x0, y0, f, 2 * f.u) || !inDisc(x1, y0, f, 2 * f.u) || !inDisc(x0, y1, f, 2 * f.u) || !inDisc(x1, y1, f, 2 * f.u)) continue;
      if (f.mode === 'dome' && y1 > f.cy + 10 * f.u) continue;
      if (!rectFree(x0 - 2, y0 - 2, x1 + 2, y1 + 2)) continue;
      pushRect(x0, y0, x1, y1);
      const rgb = t.locked ? RADAR_RGB.locked : radarAffRgb(t.aff, t.kind);
      ctx.strokeStyle = radarColor(rgb, 0.55);
      ctx.lineWidth = Math.max(0.7, 0.8 * f.u);
      ctx.beginPath();
      ctx.moveTo(x + sx * t._tagS * 0.9, y + sy * t._tagS * 0.9);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      const tx = sx > 0 ? x0 : x1;
      const align = sx > 0 ? 'left' : 'right';
      let ty = y0 + fs * 0.56;
      drawRadarText(ctx, l1, tx, ty, rgb, 0.95, align, 'middle', 2.6 * f.u);
      ty += fs * 1.12;
      drawRadarText(ctx, l2, tx, ty, RADAR_RGB.label, 0.82, align, 'middle', 2.6 * f.u);
      if (l3) {
        ty += fs * 1.12;
        drawRadarText(ctx, l3, tx, ty, rgb, 0.7, align, 'middle', 2.6 * f.u);
      }
      return true;
    }
    return false;
  }

  // Cel namierzony / wybrany / misji poza zasięgiem tarczy: grot na obrzeżu z odległością.
  function drawRimPointer(ctx, f, t, p) {
    const ang = Math.atan2(p.y - f.cy, p.x - f.cx);
    const r = f.R - 4 * f.u;
    const x = f.cx + Math.cos(ang) * r;
    const y = f.cy + Math.sin(ang) * r;
    if (f.mode === 'dome' && y > f.cy + 10 * f.u) return;
    const rgb = t.locked ? RADAR_RGB.locked : t.objective ? RADAR_RGB.objective : RADAR_RGB.selected;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = radarColor(rgb, 0.92);
    ctx.beginPath();
    ctx.moveTo(3.6 * f.u, 0);
    ctx.lineTo(-2.4 * f.u, 2.8 * f.u);
    ctx.lineTo(-2.4 * f.u, -2.8 * f.u);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    pushPick(t, x, y, 5 * f.u);
  }

  function drawNav(ctx, f) {
    const ov = f.overlay;
    if (!ov) return;
    const marks = ov.objectives;
    if (Array.isArray(marks)) {
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        if (!m || m.tracked) continue;
        drawNavMark(ctx, f, m.x, m.y, RADAR_RGB.objective, m.label || 'CEL');
      }
    }
    const nav = ov.nav;
    if (nav && Number.isFinite(nav.x) && Number.isFinite(nav.y)) drawNavMark(ctx, f, nav.x, nav.y, RADAR_RGB.nav, nav.label || 'KURS', true);
  }

  function drawNavMark(ctx, f, x, y, rgb, label, isNav = false) {
    const dx = x - f.own.x;
    const dy = y - f.own.y;
    const dist = Math.hypot(dx, dy);
    proj(dx, dy, f, _p);
    const inside = inDisc(_p.x, _p.y, f, -2 * f.u);
    if (inside) {
      const s = 4.2 * f.su;
      ctx.strokeStyle = radarColor(rgb, 0.92);
      ctx.lineWidth = Math.max(0.9, 1.15 * f.u);
      ctx.beginPath();
      ctx.moveTo(_p.x, _p.y - s); ctx.lineTo(_p.x + s, _p.y); ctx.lineTo(_p.x, _p.y + s); ctx.lineTo(_p.x - s, _p.y);
      ctx.closePath();
      ctx.stroke();
      if (isNav) {
        ctx.beginPath();
        ctx.arc(_p.x, _p.y, 1.2 * f.u, 0, TAU);
        ctx.fillStyle = radarColor(rgb, 0.95);
        ctx.fill();
      }
      return;
    }
    // poza zasięgiem: grot na obrzeżu i odległość (cel podróży bywa setki km dalej)
    const ang = Math.atan2(_p.y - f.cy, _p.x - f.cx);
    const r = f.R - 3 * f.u;
    const x1 = f.cx + Math.cos(ang) * r;
    const y1 = f.cy + Math.sin(ang) * r;
    if (f.mode === 'dome' && y1 > f.cy + 10 * f.u) return;
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(ang);
    ctx.strokeStyle = radarColor(rgb, 0.95);
    ctx.lineWidth = Math.max(0.9, 1.2 * f.u);
    ctx.beginPath();
    ctx.moveTo(-3 * f.u, -3.2 * f.u);
    ctx.lineTo(1.6 * f.u, 0);
    ctx.lineTo(-3 * f.u, 3.2 * f.u);
    ctx.stroke();
    ctx.restore();
    const tx = f.cx + Math.cos(ang) * (r - 9 * f.u);
    const ty = f.cy + Math.sin(ang) * (r - 9 * f.u);
    ctx.font = `${f.fontPx}px Consolas, monospace`;
    drawRadarText(ctx, formatRadarDistance(dist), tx, ty, rgb, 0.85, 'center', 'middle', 2.6 * f.u);
    if (isNav && f.mode === 'full' && label) drawRadarText(ctx, label.toUpperCase(), tx, ty + f.fontPx * 1.05, rgb, 0.6, 'center', 'middle', 2.6 * f.u);
  }

  function drawRanges(ctx, f) {
    const ov = f.overlay;
    if (!ov) return;
    ctx.save();
    ctx.font = `${f.fontPx}px Consolas, monospace`;
    // zasięg wzroku strony gracza (mgła wojny)
    const vision = Number(ov.vision) || 0;
    if (vision > 0) {
      const r = vision * f.k;
      if (r < f.R * 1.02 && r > 8 * f.u) {
        ctx.setLineDash([1.5 * f.u, 3 * f.u]);
        ctx.strokeStyle = radarColor(RADAR_RGB.mass, 0.38);
        ctx.lineWidth = Math.max(0.8, 1 * f.u);
        ctx.beginPath();
        ctx.arc(f.cx, f.cy, r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        if (f.mode === 'full') {
          const a = -Math.PI / 2 - 0.5;
          drawRadarText(ctx, 'WZROK', f.cx + Math.cos(a) * r - 2 * f.u, f.cy + Math.sin(a) * r, RADAR_RGB.mass, 0.6, 'right', 'middle', 2.5 * f.u);
        }
      }
    }
    // zasięg broni w ręku
    const weapons = ov.weapons;
    if (Array.isArray(weapons)) {
      for (let i = 0; i < weapons.length; i++) {
        const w = weapons[i];
        const r = (Number(w?.r) || 0) * f.k;
        if (!(r > 6 * f.u && r < f.R * 1.01)) continue;
        const rgb = w.rgb || RADAR_RGB.weapon;
        ctx.setLineDash([5 * f.u, 3.5 * f.u]);
        ctx.strokeStyle = radarColor(rgb, i === 0 ? 0.36 : 0.22);
        ctx.lineWidth = Math.max(0.75, 0.9 * f.u);
        ctx.beginPath();
        ctx.arc(f.cx, f.cy, r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        if (w.label && f.mode === 'full') {
          const a = -Math.PI / 2 + 0.95 + i * 0.22;
          drawRadarText(ctx, w.label, f.cx + Math.cos(a) * r + 2 * f.u, f.cy + Math.sin(a) * r, rgb, 0.7, 'left', 'middle', 2.5 * f.u);
        }
      }
    }
    ctx.restore();
  }

  function drawOwnShip(ctx, f) {
    const own = f.own;
    const u = f.u;
    // linia kursu (dziób) przerywana do skraju zasięgu
    const hd = (Number(own.heading) || 0) + f.theta;
    const hx = Math.cos(hd);
    const hy = Math.sin(hd);
    ctx.save();
    ctx.setLineDash([3 * u, 4 * u]);
    ctx.strokeStyle = radarColor(RADAR_RGB.heading, 0.42);
    ctx.lineWidth = Math.max(0.8, 0.9 * u);
    ctx.beginPath();
    ctx.moveTo(f.cx + hx * 9 * u, f.cy + hy * 9 * u);
    ctx.lineTo(f.cx + hx * f.R, f.cy + hy * f.R);
    ctx.stroke();
    ctx.setLineDash([]);
    // wektor prędkości własnej (dryf widać jako odchylenie od linii kursu)
    const v = Math.hypot(own.vx || 0, own.vy || 0);
    if (v > tune.vectorMinSpeed) {
      vectorEnd(f.cx, f.cy, own.vx, own.vy, f, _q);
      ctx.strokeStyle = radarColor(RADAR_RGB.own, 0.85);
      ctx.lineWidth = Math.max(0.9, 1.2 * u);
      ctx.beginPath();
      ctx.moveTo(f.cx, f.cy);
      ctx.lineTo(_q.x, _q.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(_q.x, _q.y, 1.4 * u, 0, TAU);
      ctx.fillStyle = radarColor(RADAR_RGB.own, 0.9);
      ctx.fill();
    }
    // sylwetka (przy zbliżeniu) albo grot
    const lenPx = (Number(own.length) || 0) * f.k;
    const widPx = (Number(own.width) || 0) * f.k;
    const sil = Math.max(lenPx, widPx) >= 9 * u && own.sprite ? silhouette(own.sprite, lenPx, widPx, RADAR_RGB.own) : null;
    if (sil) {
      const rot = (Number(own.angle ?? own.heading) || 0) + (Number(own.spriteRot) || 0) + f.theta;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      ctx.globalAlpha = 0.9;
      ctx.setTransform(c * lenPx, s * lenPx, -s * widPx, c * widPx, f.cx, f.cy);
      ctx.drawImage(sil, -0.5, -0.5, 1, 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      ctx.translate(f.cx, f.cy);
      ctx.rotate(hd);
      const s = 1.15 * f.su;
      ctx.beginPath();
      ctx.moveTo(6 * s, 0);
      ctx.lineTo(-4 * s, 3.8 * s);
      ctx.lineTo(-2.2 * s, 0);
      ctx.lineTo(-4 * s, -3.8 * s);
      ctx.closePath();
      ctx.fillStyle = radarColor(RADAR_RGB.own, 0.95);
      ctx.strokeStyle = radarColor(RADAR_RGB.outline, 0.8);
      ctx.lineWidth = Math.max(0.7, 0.8 * u);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPing(ctx, f, tr) {
    const ping = tr.ping;
    const age = tr.time - ping.t0;
    if (!ping.started || !(age >= 0) || age > 1.6) return;
    proj(ping.x - f.own.x, ping.y - f.own.y, f, _p);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // poświata obszaru, przez który przeszła fala (luminofor po impulsie)
    const washR = Math.min(scanPulseRadius(age, ping.speed), ping.max) * f.k;
    const wash = Math.exp(-age / 0.45) * 0.16;
    if (washR > 2 && wash > 0.01) {
      const wg = ctx.createRadialGradient(_p.x, _p.y, 0, _p.x, _p.y, washR);
      wg.addColorStop(0, radarColor(RADAR_RGB.ping, wash * 0.25));
      wg.addColorStop(1, radarColor(RADAR_RGB.ping, wash));
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.arc(_p.x, _p.y, washR, 0, TAU);
      ctx.fill();
    }
    if (!ping.active) { ctx.restore(); return; }
    const r = Math.min(ping.r, ping.max) * f.k;
    const fade = ping.r > ping.max ? Math.max(0, 1 - ping.fade / 0.45) : 1;
    if (r < 1 || fade <= 0) { ctx.restore(); return; }
    const tail = Math.max(6 * f.u, f.R * tune.pingTail);
    const inner = Math.max(0, r - tail);
    const grad = ctx.createRadialGradient(_p.x, _p.y, inner, _p.x, _p.y, r);
    grad.addColorStop(0, radarColor(RADAR_RGB.ping, 0));
    grad.addColorStop(1, radarColor(RADAR_RGB.ping, 0.2 * fade));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(_p.x, _p.y, r, 0, TAU);
    ctx.arc(_p.x, _p.y, inner, 0, TAU, true);
    ctx.fill();
    ctx.strokeStyle = radarColor(RADAR_RGB.ping, 0.95 * fade);
    ctx.lineWidth = Math.max(1, 1.5 * f.u);
    ctx.beginPath();
    ctx.arc(_p.x, _p.y, r, 0, TAU);
    ctx.stroke();
    for (let i = 1; i <= 2; i++) {
      const ri = r - i * 4.5 * f.u;
      if (ri <= 0) break;
      ctx.strokeStyle = radarColor(RADAR_RGB.ping, (0.3 / i) * fade);
      ctx.lineWidth = Math.max(0.7, 0.8 * f.u);
      ctx.beginPath();
      ctx.arc(_p.x, _p.y, ri, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRim(ctx, f, tr) {
    const u = f.u;
    // kurs: pomarańczowy grot na obrzeżu
    const hd = (Number(f.own.heading) || 0) + f.theta;
    const r0 = f.rim - 1.5 * u;
    ctx.save();
    ctx.translate(f.cx + Math.cos(hd) * r0, f.cy + Math.sin(hd) * r0);
    ctx.rotate(hd);
    ctx.fillStyle = radarColor(RADAR_RGB.heading, 1);
    ctx.beginPath();
    ctx.moveTo(-6.5 * u, 0);
    ctx.lineTo(0, 3.4 * u);
    ctx.lineTo(0, -3.4 * u);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // północ (góra ekranu gry) — przy H-UP wędruje po obrzeżu
    if (f.orient !== 'north') {
      const na = -Math.PI / 2 + f.theta;
      const rn = f.rim - 4.2 * u;
      const x = f.cx + Math.cos(na) * rn;
      const y = f.cy + Math.sin(na) * rn;
      if (!(f.mode === 'dome' && y > f.cy + 10 * u)) {
        const rr = Math.max(3.6 * u, f.fontPx * 0.5);
        ctx.fillStyle = radarColor(RADAR_RGB.outline, 0.85);
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = radarColor(RADAR_RGB.nav, 0.75);
        ctx.lineWidth = Math.max(0.7, 0.8 * u);
        ctx.stroke();
        ctx.font = `bold ${Math.round(f.fontPx * 0.82)}px Consolas, monospace`;
        drawRadarText(ctx, 'N', x, y + 0.5, RADAR_RGB.nav, 0.95, 'center', 'middle', 0.01);
        ctx.font = `${f.fontPx}px Consolas, monospace`;
      }
    }
    // kurs nad ziemią (kierunek prędkości) — pusty grot, gdy statek się porusza
    const v = Math.hypot(f.own.vx || 0, f.own.vy || 0);
    if (v > 25) {
      const ca = Math.atan2(f.own.vy, f.own.vx) + f.theta;
      const x = f.cx + Math.cos(ca) * (f.rim - 1.5 * u);
      const y = f.cy + Math.sin(ca) * (f.rim - 1.5 * u);
      if (!(f.mode === 'dome' && y > f.cy + 10 * u)) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ca);
        ctx.strokeStyle = radarColor(RADAR_RGB.own, 0.9);
        ctx.lineWidth = Math.max(0.8, 1 * u);
        ctx.beginPath();
        ctx.moveTo(-5.5 * u, 0);
        ctx.lineTo(0, 3 * u);
        ctx.lineTo(0, -3 * u);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }
    // Rakiety wroga lecące na okręt: łuk na obrzeżu w ich namiarze (ostrzeżenie jak RWR), miga.
    {
      const list = tr.list;
      const reachSq = (f.range * 1.25) ** 2;
      const blink = Math.floor(tr.time * 5) % 2 === 0 ? 1 : 0.45;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t.kind !== 'missile' || t.aff !== 'hostile') continue;
        const dx = t.sx - f.own.x;
        const dy = t.sy - f.own.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > reachSq || t.svx * dx + t.svy * dy >= 0) continue;
        const near = 1 - Math.min(1, Math.sqrt(d2) / (f.range * 1.25));
        const a = Math.atan2(dy, dx) + f.theta;
        const half = 0.05 + 0.06 * near;
        ctx.strokeStyle = radarColor(RADAR_RGB.missileHostile, (0.35 + 0.65 * near) * blink);
        ctx.lineWidth = Math.max(1.5, 2.6 * u);
        ctx.beginPath();
        ctx.arc(f.cx, f.cy, f.rim - 2.4 * u, a - half, a + half);
        ctx.stroke();
      }
    }
    // kopuła: zagrożenia z tyłu (dolna połowa schowana) — czerwone groty nad cięciwą
    if (f.mode === 'dome') {
      const list = tr.list;
      const rangeSq = f.range * f.range;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t.aff !== 'hostile' || !(t.paints > 0) || t.kind === 'wreck') continue;
        const dx = t.sx - f.own.x;
        const dy = t.sy - f.own.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > rangeSq) continue;
        // pozycja na tarczy: dolna połowa = za okrętem (dla H-UP i N-UP tak samo — liczy się ekran)
        proj(dx, dy, f, _p);
        if (_p.y < f.cy + 10 * u) continue;
        const near = 1 - Math.sqrt(d2) / f.range;
        const missile = t.kind === 'missile';
        const blink = missile ? (Math.floor(tr.time * 6) % 2 === 0 ? 1 : 0.4) : 1;
        const a = (0.35 + 0.65 * near) * blink;
        const x = Math.max(f.cx - f.R * 0.92, Math.min(f.cx + f.R * 0.92, _p.x));
        const y = f.cy + 8 * u;
        const s = (missile ? 2.4 : t.capital ? 3.6 : 2.9) * u;
        ctx.fillStyle = radarColor(missile ? RADAR_RGB.missileHostile : RADAR_RGB.hostile, a);
        ctx.beginPath();
        ctx.moveTo(x, y + s);
        ctx.lineTo(x + s * 1.1, y - s * 0.4);
        ctx.lineTo(x - s * 1.1, y - s * 0.4);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawHover(ctx, f) {
    const h = f.hover;
    if (!h) return;
    const dx = h.x - f.cx;
    const dy = h.y - f.cy;
    const rr = Math.hypot(dx, dy);
    if (rr > f.R) return;
    const u = f.u;
    // linia namiaru (EBL) i znacznik odległości (VRM)
    ctx.save();
    ctx.setLineDash([2 * u, 3 * u]);
    ctx.strokeStyle = radarColor(RADAR_RGB.label, 0.38);
    ctx.lineWidth = Math.max(0.7, 0.8 * u);
    const a = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(f.cx, f.cy);
    ctx.lineTo(f.cx + Math.cos(a) * f.R, f.cy + Math.sin(a) * f.R);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(f.cx, f.cy, rr, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    // odczyt: namiar (H-UP — względny od dzioba, N-UP — od góry ekranu) i odległość
    const world = rr / f.k;
    let brg = normAngle(a + Math.PI / 2);
    const deg = Math.round(brg * 180 / Math.PI) % 360;
    const text = `NAMIAR ${String(deg).padStart(3, '0')}° · ${formatRadarDistance(world)}`;
    ctx.font = `${f.fontPx}px Consolas, monospace`;
    // odczyt w stałym miejscu u dołu tarczy (nie wchodzi na etykiety śladów pod kursorem)
    drawRadarText(ctx, text, f.cx, f.cy + f.R - f.fontPx * 1.1, RADAR_RGB.label, 0.92, 'center', 'middle', 2.6 * u);
    ctx.restore();
  }

  // ------------------------------------------------------------------ API
  return {
    terrain,
    stats,
    /**
     * f: { tracker, own: {x,y,vx,vy,heading,angle,length,width,sprite,spriteRot}, theta, orient, range,
     *   settled, mode: 'dome'|'full', fontPx, symbolScale, time, hover: {x,y}|null, world, overlay }
     */
    draw(ctx, W, H, f) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      const tr = f.tracker;
      const size = Math.min(W, H);
      f.W = size;
      f.cx = W / 2;
      f.cy = H / 2;
      f.rim = size / 2;
      f.R = size * 0.455;
      f.u = size / 280;
      f.su = f.u * (Number(f.symbolScale) || 1);
      f.k = f.R / Math.max(1, f.range);
      f.cosT = Math.cos(f.theta);
      f.sinT = Math.sin(f.theta);
      f.sweep = tr.sweep;
      tagRectCount = 0;
      hovered = null;
      if (f.hover) {
        // najbliższy symbol pod kursorem (z poprzedniej klatki — pozycje prawie te same)
        let best = (12 * f.u) ** 2;
        for (let i = 0; i < pickCount; i++) {
          const p = picks[i];
          const dx = p.x - f.hover.x;
          const dy = p.y - f.hover.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) { best = d2; hovered = p.track; }
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.beginPath();
      ctx.arc(f.cx, f.cy, f.rim, 0, TAU);
      ctx.clip();
      ctx.drawImage(background(size), f.cx - size / 2, f.cy - size / 2);
      drawTerrain(ctx, f);
      ctx.drawImage(face(size, f.range, f), f.cx - size / 2, f.cy - size / 2);
      drawRanges(ctx, f);
      drawSweep(ctx, f);
      drawEchoes(ctx, f, tr);
      drawKills(ctx, f, tr);
      drawMasses(ctx, f);
      drawGhosts(ctx, f);
      ctx.font = `${f.fontPx}px Consolas, monospace`;
      drawTracks(ctx, f, tr);
      drawNav(ctx, f);
      drawOwnShip(ctx, f);
      drawPing(ctx, f, tr);
      drawRim(ctx, f, tr);
      drawHover(ctx, f);
      ctx.restore();
      if (typeof performance !== 'undefined') stats.drawMs = performance.now() - t0;
      return stats;
    },
    /** Ślad pod punktem płótna (px) z ostatniego rysunku albo null. */
    pick(x, y, radius = 0) {
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < pickCount; i++) {
        const p = picks[i];
        const dx = p.x - x;
        const dy = p.y - y;
        const d2 = dx * dx + dy * dy;
        const r = Math.max(p.r, radius);
        if (d2 <= r * r * 2.2 && d2 < bestD) { bestD = d2; best = p.track; }
      }
      return best;
    },
    get hovered() { return hovered; },
    /** Pozycje symboli z ostatniego rysunku (diagnostyka, harness): [{ track, x, y, r }]. */
    debugPicks() {
      const out = [];
      for (let i = 0; i < pickCount; i++) out.push({ track: picks[i].track, x: picks[i].x, y: picks[i].y, r: picks[i].r });
      return out;
    }
  };
}
