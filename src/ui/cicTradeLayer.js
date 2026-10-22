/**
 * KOMPUTER HANDLOWY na mapie CIC (E7, docs/BRIEF-ruch-v2.md § 2.3) — warstwa „HANDEL”.
 *
 * Agregat z warstwy rekordów ruchu v2 (`traffic/tradeSummary.js`, przez most `requestTradeSummary`),
 * nie tysiące statków: trasy z ładunkiem teraz w powietrzu (grubość = tony, barwa = rodzaj głównego
 * towaru, grot przy odbiorcy), przy portach najtańszy zakup i najlepszy skup, w panelu najgęstsze
 * trasy, okazje handlowe i towar w drodze. Dane przychodzą co `CIC_TRADE_TUNE.refreshMs` (czas
 * rzeczywisty), tylko gdy warstwa jest włączona — koszt w workerze na żądanie, nie co tick.
 *
 * Rysunek: ≤ 40 linii, napisy ze stempli (płótno na napis, pieczone raz), panel pieczony przy nowych
 * danych — reguła `radar-cic` (bez `shadowBlur` i gradientów co klatkę).
 */

import { RESOURCES, CATEGORY } from '../data/resources.js';

export const CIC_TRADE_TUNE = {
  refreshMs: 2000,
  /** Ile tras dostaje podpis na mapie. */
  routeLabels: 8,
  /** Ile wierszy tras i okazji w panelu. */
  panelRoutes: 6,
  panelDeals: 5,
  maxStamps: 400
};

const CATEGORY_COLOR = {
  [CATEGORY.ORE]: '#d9a85c',
  [CATEGORY.GAS]: '#2dd4bf',
  [CATEGORY.VOLATILE]: '#7dd3fc',
  [CATEGORY.METAL]: '#a5b4fc',
  [CATEGORY.ELECTRONIC]: '#facc15',
  [CATEGORY.FUEL]: '#fb923c',
  [CATEGORY.CHEMICAL]: '#f0abfc',
  [CATEGORY.COMPONENT]: '#c4b5fd',
  [CATEGORY.WEAPON]: '#f87171',
  [CATEGORY.ORDNANCE]: '#fca5a5',
  [CATEGORY.SALVAGE]: '#94a3b8'
};

function colorOf(resourceId) {
  return CATEGORY_COLOR[RESOURCES[resourceId]?.category] || '#7dd3fc';
}

function shortOf(resourceId) {
  const def = RESOURCES[resourceId];
  return def?.short || def?.label || resourceId || '?';
}

function labelOf(resourceId) {
  return RESOURCES[resourceId]?.label || resourceId || '?';
}

/** Cena: całkowita od 10 CR, poniżej z jedną cyfrą po przecinku. */
export function formatPrice(price) {
  const p = Number(price) || 0;
  return p >= 10 ? String(Math.round(p)) : p.toFixed(1).replace('.', ',');
}

function portLabel(name) {
  const text = String(name || '?');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Tony: „840 t”, „2,4 kt”, „1,2 Mt”. */
export function formatTons(tons) {
  const t = Math.max(0, Number(tons) || 0);
  if (t >= 1e6) return `${(t / 1e6).toFixed(1).replace('.', ',')} Mt`;
  if (t >= 1e3) return `${(t / 1e3).toFixed(1).replace('.', ',')} kt`;
  return `${Math.round(t)} t`;
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  return c;
}

export function createCicTradeLayer(options = {}) {
  /** `() => Promise<summary|null>` — most gry (`TrafficBridge.requestTradeSummary`). */
  let source = typeof options.request === 'function' ? options.request : null;
  const state = {
    enabled: false,
    summary: null,
    portById: new Map(),
    requestedAt: -Infinity,
    pending: false,
    failed: false,
    version: 0
  };
  const stamps = new Map();
  const panel = { canvas: null, version: -1, w: 0, h: 0 };

  function stamp(text, color, font = '10px monospace') {
    const key = `${font}|${color}|${text}`;
    let entry = stamps.get(key);
    if (entry) return entry;
    if (stamps.size > CIC_TRADE_TUNE.maxStamps) stamps.clear();
    const probe = makeCanvas(1, 1);
    const pctx = probe?.getContext('2d');
    if (!pctx) return null;
    pctx.font = font;
    const w = Math.ceil(pctx.measureText(text).width) + 6;
    const h = 14;
    const canvas = makeCanvas(w, h);
    const g = canvas.getContext('2d');
    g.font = font;
    g.fillStyle = 'rgba(4, 12, 26, 0.72)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(text, 3, h / 2 + 0.5);
    entry = { canvas, w, h };
    stamps.set(key, entry);
    return entry;
  }

  function accept(summary) {
    state.pending = false;
    if (!summary) return;
    state.summary = summary;
    state.portById.clear();
    for (const port of summary.ports || []) state.portById.set(port.id, port);
    state.version++;
  }

  function update(nowMs) {
    if (!state.enabled || !source || state.pending) return;
    if (nowMs - state.requestedAt < CIC_TRADE_TUNE.refreshMs) return;
    state.requestedAt = nowMs;
    state.pending = true;
    let promise;
    try { promise = source(); } catch (error) { promise = Promise.reject(error); }
    Promise.resolve(promise).then(accept, error => {
      state.pending = false;
      if (!state.failed) console.warn('[CIC] komputer handlowy: brak danych z ruchu v2', error);
      state.failed = true;
    });
  }

  /** Trasy i porty na mapie. `toScreen(wx, wy)` → `{ x, y }` (układ CIC). */
  function draw(ctx, W, H, toScreen) {
    const summary = state.summary;
    if (!state.enabled || !summary) return;
    const routes = summary.routes || [];
    let maxTons = 1;
    for (const route of routes) maxTons = Math.max(maxTons, route.tons || 0);

    ctx.save();
    ctx.lineCap = 'round';
    for (let i = routes.length - 1; i >= 0; i--) {
      const route = routes[i];
      const a = state.portById.get(route.from);
      const b = state.portById.get(route.to);
      if (!a || !b) continue;
      const pa = toScreen(a.x, a.y);
      const pb = toScreen(b.x, b.y);
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (!(len > 4)) continue;
      const width = 1 + 6 * Math.sqrt((route.tons || 0) / maxTons);
      ctx.strokeStyle = colorOf(route.main);
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      // Grot przy odbiorcy: kierunek przepływu.
      const ux = dx / len;
      const uy = dy / len;
      const tipX = pb.x - ux * Math.min(len * 0.12, 26);
      const tipY = pb.y - uy * Math.min(len * 0.12, 26);
      const head = 5 + width;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - ux * head - uy * head * 0.55, tipY - uy * head + ux * head * 0.55);
      ctx.lineTo(tipX - ux * head + uy * head * 0.55, tipY - uy * head - ux * head * 0.55);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Podpisy najgęstszych tras (środek odcinka).
    for (let i = 0; i < routes.length && i < CIC_TRADE_TUNE.routeLabels; i++) {
      const route = routes[i];
      const a = state.portById.get(route.from);
      const b = state.portById.get(route.to);
      if (!a || !b) continue;
      const pa = toScreen(a.x, a.y);
      const pb = toScreen(b.x, b.y);
      const mx = (pa.x + pb.x) / 2;
      const my = (pa.y + pb.y) / 2;
      if (mx < -40 || my < -20 || mx > W + 40 || my > H + 20) continue;
      const s = stamp(`${shortOf(route.main)} ${formatTons(route.tons)} · ${route.courses}`, colorOf(route.main));
      if (s) ctx.drawImage(s.canvas, Math.round(mx - s.w / 2), Math.round(my - s.h / 2));
    }

    // Porty: najtańszy zakup (▼ kupisz) i najlepszy skup (▲ sprzedasz).
    for (const port of summary.ports || []) {
      const p = toScreen(port.x, port.y);
      if (p.x < -60 || p.y < -30 || p.x > W + 60 || p.y > H + 30) continue;
      let dy = 14;
      const buy = port.buy?.[0];
      const sell = port.sell?.[0];
      if (buy) {
        const s = stamp(`▼ ${shortOf(buy.id)} ${formatPrice(buy.price)} CR`, '#86efac');
        if (s) { ctx.drawImage(s.canvas, Math.round(p.x - s.w / 2), Math.round(p.y + dy)); dy += s.h + 1; }
      }
      if (sell) {
        const s = stamp(`▲ ${shortOf(sell.id)} ${formatPrice(sell.price)} CR`, '#fcd34d');
        if (s) ctx.drawImage(s.canvas, Math.round(p.x - s.w / 2), Math.round(p.y + dy));
      }
    }
    ctx.restore();
  }

  function bakePanel(width) {
    const summary = state.summary;
    const lines = [];
    const portName = id => portLabel(state.portById.get(id)?.name || id);
    lines.push(['KOMPUTER HANDLOWY', '#e2e8f0', 'bold 12px monospace']);
    if (!summary) {
      lines.push([state.failed ? 'brak danych z ruchu v2' : 'pobieram dane…', '#94a3b8']);
    } else {
      const totals = summary.totals || {};
      lines.push([`W DRODZE ${totals.courses || 0} kursów · ${formatTons(totals.tons)} · tras ${totals.routes || 0}`, '#94a3b8']);
      if (summary.mining?.courses) {
        lines.push([`WYPRAWY GÓRNICZE ${summary.mining.courses} · urobek ${formatTons(summary.mining.tons)}`, '#94a3b8']);
      }
      lines.push(['', null]);
      lines.push(['NAJGĘSTSZE TRASY', '#7dd3fc']);
      for (const route of (summary.routes || []).slice(0, CIC_TRADE_TUNE.panelRoutes)) {
        lines.push([`${portName(route.from)} → ${portName(route.to)}  ${labelOf(route.main)}  ${formatTons(route.tons)} (${route.courses})`,
          colorOf(route.main)]);
      }
      if (summary.opportunities?.length) {
        lines.push(['', null]);
        lines.push(['OKAZJE (kup → sprzedaj, za sztukę)', '#86efac']);
        for (const deal of summary.opportunities.slice(0, CIC_TRADE_TUNE.panelDeals)) {
          lines.push([`${labelOf(deal.id)}: ${portName(deal.from)} ${formatPrice(deal.buy)} → ${portName(deal.to)} ${formatPrice(deal.sell)} CR`, '#bbf7d0']);
        }
      }
    }
    lines.push(['', null]);
    lines.push(['[H] warstwa handlu  ▼ kupisz tanio  ▲ sprzedasz drogo', '#64748b']);

    const lineH = 15;
    const h = 16 + lines.length * lineH;
    if (!panel.canvas || panel.w !== width || panel.h !== h) {
      panel.canvas = makeCanvas(width, h);
      panel.w = width;
      panel.h = h;
    }
    const g = panel.canvas?.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, width, h);
    g.fillStyle = 'rgba(4, 12, 26, 0.86)';
    g.fillRect(0, 0, width, h);
    g.strokeStyle = 'rgba(125, 211, 252, 0.45)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, width - 1, h - 1);
    g.textBaseline = 'middle';
    lines.forEach(([text, color, font], i) => {
      if (!text) return;
      g.font = font || '10px monospace';
      g.fillStyle = color || '#cbd5e1';
      let t = text;
      while (t.length > 4 && g.measureText(t).width > width - 20) t = t.slice(0, -2);
      g.fillText(t === text ? t : `${t}…`, 10, 12 + i * lineH);
    });
    panel.version = state.version + (state.failed ? 0.5 : 0);
  }

  /** Panel pod panelem informacyjnym CIC (prawa strona); zwraca y dolnej krawędzi. */
  function drawPanel(ctx, W, y0, width = 430) {
    if (!state.enabled) return y0;
    const want = state.version + (state.failed ? 0.5 : 0);
    if (!panel.canvas || panel.version !== want || panel.w !== width) bakePanel(width);
    if (!panel.canvas) return y0;
    ctx.drawImage(panel.canvas, W - width - 16, y0);
    return y0 + panel.h;
  }

  return {
    get enabled() { return state.enabled; },
    get summary() { return state.summary; },
    setEnabled(on) {
      state.enabled = !!on;
      if (state.enabled) state.requestedAt = -Infinity;
      return state.enabled;
    },
    toggle() { return this.setEnabled(!state.enabled); },
    setSource(fn) { source = typeof fn === 'function' ? fn : null; state.failed = false; },
    update,
    draw,
    drawPanel,
    stats() {
      return { enabled: state.enabled, routes: state.summary?.routes?.length || 0, ports: state.portById.size, stamps: stamps.size, pending: state.pending };
    }
  };
}
