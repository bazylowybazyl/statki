// ============================================================
// Mapa CIC: warstwa „ZASIĘGI” — strefy radarów (prototyp `?radarZasiegi`, 2026-11-04; plan: docs/PLAN-zasieg-czujnikow.md).
// Dane: obraz czujników z gry (src/game/sensorPicture.js) przez `setSource(() => obraz)`; bez źródła warstwa milczy.
//  - strefy ZNANYCH radarów wroga przy obecnej sygnaturze gracza: suma kół = jeden obrys na skupisko (wypełnienie
//    + kontur 1 px; radar zgadnięty z samej sygnatury — kreski), podpis na szczycie skupiska „~3 RADARY · 58 km”,
//  - ocena obustronna (ten sam wygląd co w świecie gry — drawThreatLook z src/ui/radarRangeOverlay.js): wachlarz przy
//    statku i przy wrogu / struna / błona, klawisz ] przełącza,
//  - własne czujniki (cel o sygnaturze pancernika) — przerywany cyjanowy obrys sumy,
//  - panel pod panelem CIC: sygnatura, wykrycie, krawędź, liczby.
// Koszt jak reszta CIC: kontury 1 px, napisy ze stempli, panel pieczony przy zmianie tekstu; wołający łapie wyjątki.
// ============================================================

import { createCoverage } from '../game/sensorCoverage.js';
import { sensorKnowState } from '../game/sensorPicture.js';
import { createThreatLookState, drawThreatLook, RADAR_RANGE_STYLE } from './radarRangeOverlay.js';
import { radarColor } from './radar/radarSymbols.js';
import { formatRadarDistance } from './radar/radarConfig.js';

const TAU = Math.PI * 2;

export const CIC_COVERAGE_TUNE = {
  enemyRgb: '239, 68, 68',
  ownRgb: '96, 196, 255',
  fillEnemy: 0.07,
  fillOwn: 0.03,
  // znak oceny obustronnej przy znaczniku statku na mapie (mniejsza skala niż w świecie gry)
  fanR0: 18,
  maxStamps: 120
};

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  return c;
}

function plural(n, one, few, many) {
  const d = n % 10, h = n % 100;
  if (n === 1) return one;
  if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return few;
  return many;
}

function fmtSig(v) { return (Math.round(v * 100) / 100).toString().replace('.', ','); }

const _p = { x: 0, y: 0 };
const _hh = { hx: 0, hy: 0 };

export function createCicCoverageLayer() {
  const T = CIC_COVERAGE_TUNE;
  const state = { enabled: true, version: 0 };
  let source = null;
  const lookStyle = {
    ...RADAR_RANGE_STYLE, fanGap: 7, fanLw: 1.6, fanHalf: 0.2, fanMaxGroups: 8, fanEdgeInset: 40,
    strunaHalfPx: 44, strunaAmp: 9, strunaGap: 8, strunaLw: 1.4, blonaGap: 4, blonaSig: 9, blonaLift: 46, blonaLw: 1.3
  };
  const lookState = createThreatLookState();
  const stamps = new Map();
  const panel = { canvas: null, w: 0, h: 0, key: '' };
  let pic = null;
  const pickSure = (tag) => !(pic?.enemyInfo[tag]?.est);
  const pickEst = (tag) => !!(pic?.enemyInfo[tag]?.est);
  const stats = { clusters: 0, circles: 0, arcs: 0 };

  function stamp(text, rgb) {
    const key = `${rgb}|${text}`;
    let s = stamps.get(key);
    if (s) return s;
    if (stamps.size >= T.maxStamps) stamps.clear();
    const font = 'bold 9px monospace';
    const probe = makeCanvas(4, 4)?.getContext('2d');
    if (!probe) return null;
    probe.font = font;
    const w = Math.ceil(probe.measureText(text).width) + 10;
    const h = 15;
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(2, 10, 22, 0.78)';
    g.fillRect(0, 0, w, h);
    g.font = font;
    g.textBaseline = 'middle';
    g.fillStyle = radarColor(rgb, 0.95);
    g.fillText(text, 5, h / 2 + 0.5);
    s = { canvas: c, w, h };
    stamps.set(key, s);
    return s;
  }

  function pathUnion(ctx, cov, view) {
    ctx.beginPath();
    for (let i = 0; i < cov.n; i++) {
      if (!cov.alive[i]) continue;
      view.project(cov.x[i], cov.y[i], _p);
      const r = cov.r[i] * view.zoom;
      ctx.moveTo(_p.x + r, _p.y);
      ctx.arc(_p.x, _p.y, r, 0, TAU);
    }
  }

  function pathArcs(ctx, cov, view, pick) {
    ctx.beginPath();
    for (let k = 0; k < cov.arcN; k++) {
      const i = cov.arcCircle[k];
      if (pick && !pick(cov.tag[i])) continue;
      view.project(cov.x[i], cov.y[i], _p);
      const r = cov.r[i] * view.zoom;
      const a0 = cov.arcA0[k], a1 = cov.arcA1[k];
      ctx.moveTo(_p.x + Math.cos(a0) * r, _p.y + Math.sin(a0) * r);
      ctx.arc(_p.x, _p.y, r, a0, a1);
    }
  }

  function clusterText(P, c) {
    const cov = P.enemy;
    let n = 0, est = false;
    for (let i = 0; i < cov.n; i++) {
      if (cov.cluster[i] !== c) continue;
      n++;
      if (P.enemyInfo[cov.tag[i]]?.est) est = true;
    }
    return `${est ? '~' : ''}${n} ${plural(n, 'RADAR', 'RADARY', 'RADARÓW')} · ${formatRadarDistance(cov.clusterMaxR[c])}`;
  }

  /** Rysunek na mapie. view: { project(x, y, out), zoom, roll } (CIC — bez obrotu), time [s]. */
  function draw(ctx, W, H, view, time) {
    if (!state.enabled || !source) return;
    const P = source();
    if (!P || !P.ready) return;
    pic = P;
    ctx.save();
    ctx.lineCap = 'butt';
    // własne czujniki (cel BB): przerywany obrys sumy
    if (P.own.n > 0) {
      pathUnion(ctx, P.own, view);
      ctx.fillStyle = radarColor(T.ownRgb, T.fillOwn);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = radarColor(T.ownRgb, 0.42);
      pathArcs(ctx, P.own, view, null);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const enemy = P.enemy;
    stats.clusters = enemy.clusterN; stats.circles = enemy.n; stats.arcs = enemy.arcN;
    if (enemy.n > 0) {
      pathUnion(ctx, enemy, view);
      ctx.fillStyle = radarColor(T.enemyRgb, T.fillEnemy);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = radarColor(T.enemyRgb, 0.9);
      pathArcs(ctx, enemy, view, pickSure);
      ctx.stroke();
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = radarColor(T.enemyRgb, 0.75);
      pathArcs(ctx, enemy, view, pickEst);
      ctx.stroke();
      ctx.setLineDash([]);
      // podpisy skupisk na szczycie sumy
      for (let c = 0; c < enemy.clusterN; c++) {
        view.project(enemy.clusterTopX[c], enemy.clusterTopY[c], _p);
        if (_p.x < 0 || _p.x > W || _p.y < 14 || _p.y > H) continue;
        const s = stamp(clusterText(P, c), T.enemyRgb);
        if (s) ctx.drawImage(s.canvas, Math.round(_p.x - s.w / 2), Math.round(_p.y - s.h - 3));
      }
    }
    // kontakty bez identyfikacji: „?” w miejscu przybliżonym
    ctx.lineWidth = 1;
    for (let j = 0; j < P.knowList.length; j++) {
      const k = P.knowList[j];
      if (k.ident || sensorKnowState(P, k) !== 'live') continue;
      view.project(k.x, k.y, _p);
      if (_p.x < -20 || _p.x > W + 20 || _p.y < -20 || _p.y > H + 20) continue;
      const r = Math.max(5, Math.min(60, k.err * view.zoom));
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(_p.x, _p.y, r, 0, TAU);
      ctx.strokeStyle = radarColor(T.enemyRgb, 0.55);
      ctx.stroke();
      ctx.setLineDash([]);
      const s = stamp('?', T.enemyRgb);
      if (s) ctx.drawImage(s.canvas, Math.round(_p.x - s.w / 2), Math.round(_p.y - s.h / 2));
    }
    // ocena obustronna (wybrany wygląd), podpisy grupy najgroźniejszej
    // statek w miejscu z tej klatki, nie z przebudowy obrazu (5 Hz); znak poza sylwetką rysowaną w skali mapy
    const sp = view.player?.pos;
    view.project(sp ? sp.x : P.player.x, sp ? sp.y : P.player.y, _p);
    let r0 = T.fanR0;
    if (view.player && view.hullHalf) {
      view.hullHalf(view.player, _hh);
      r0 = Math.max(r0, Math.max(_hh.hx, _hh.hy) + lookStyle.bracketPad + lookStyle.fanPad);
    }
    drawThreatLook(ctx, P, view, _p.x, _p.y, r0, 1, lookStyle, lookState, time, true);
    ctx.restore();
  }

  function panelLines(P) {
    const lines = [['ZASIĘGI RADARÓW · PROTOTYP', '#e2e8f0', 'bold 12px monospace']];
    if (!P || !P.ready) {
      lines.push(['brak obrazu czujników', '#94a3b8']);
    } else {
      const pl = P.player;
      lines.push([`SYGNATURA ${fmtSig(pl.sigEff)}${pl.cover < 1 ? ` (osłona ×${fmtSig(pl.cover)})` : ''} · CZUJNIKI ${formatRadarDistance(pl.strength)} · WZROK ${formatRadarDistance(pl.vision)}`, '#94a3b8']);
      if (pl.detectedKnown > 0) {
        lines.push([`WYKRYTY — w zasięgu ${pl.detectedKnown} ${plural(pl.detectedKnown, 'znanego radaru', 'znanych radarów', 'znanych radarów')}` +
          (pl.edge.arc >= 0 ? ` · wyjście ${formatRadarDistance(pl.edge.dist)}` : ''), '#f87171']);
      } else {
        lines.push([`POZA ZNANYMI STREFAMI${pl.edge.arc >= 0 ? ` · do strefy ${formatRadarDistance(pl.edge.dist)}` : ''}`, '#4ade80']);
      }
      let sure = 0, est = 0, ghost = 0;
      for (let i = 0; i < P.enemy.n; i++) {
        const info = P.enemyInfo[P.enemy.tag[i]];
        if (!info) continue;
        if (info.ghost) ghost++;
        else if (info.est) est++;
        else sure++;
      }
      lines.push([`RADARY WROGA ${sure + est + ghost}: ${sure} zidentyf. · ${est} szacowanych · ${ghost} duchów · skupisk ${P.enemy.clusterN}`, '#fca5a5']);
      // grupy zagrożeń: najgroźniejsze 3 — ich zasięg względem mnie / mój względem nich / odległość
      const F = P.threats;
      if (F && F.n) {
        const used = [];
        for (let q = 0; q < Math.min(3, F.n); q++) {
          let best = -1;
          for (let g = 0; g < F.n; g++) if (!used.includes(g) && (best < 0 || F.them[g] > F.them[best])) best = g;
          used.push(best);
          const brg = Math.round(((F.ang[best] * 180 / Math.PI) + 90 + 360) % 360);
          lines.push([`NAMIAR ${String(brg).padStart(3, '0')}°${F.count[best] > 1 ? ` (${F.count[best]})` : ''}  ONI ${formatRadarDistance(F.themR[best])}`
            + `${F.est[best] ? '?' : ''} · TY ${formatRadarDistance(F.meR[best])} · DO NICH ${formatRadarDistance(F.themD[best])}`,
          F.them[best] >= 1 ? '#f87171' : '#cbd5e1']);
        }
      }
    }
    lines.push(['', null]);
    lines.push(['niebieski — TY sięgasz ich, czerwony — ONI sięgają Ciebie', '#64748b']);
    lines.push(['[Z] warstwa zasięgów · klawisz ] — wygląd', '#64748b']);
    return lines;
  }

  /** Panel pod panelem informacyjnym CIC; zwraca y dolnej krawędzi. */
  function drawPanel(ctx, W, y0, width = 430) {
    if (!state.enabled || !source) return y0;
    const lines = panelLines(source());
    let key = String(width);
    for (const [t] of lines) key += `|${t}`;
    const lineH = 15;
    const h = 16 + lines.length * lineH;
    if (panel.key !== key || !panel.canvas) {
      if (!panel.canvas || panel.w !== width || panel.h !== h) {
        panel.canvas = makeCanvas(width, h);
        panel.w = width;
        panel.h = h;
      }
      const g = panel.canvas?.getContext('2d');
      if (!g) return y0;
      g.clearRect(0, 0, width, h);
      g.fillStyle = 'rgba(4, 12, 26, 0.86)';
      g.fillRect(0, 0, width, h);
      g.strokeStyle = 'rgba(248, 113, 113, 0.45)';
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
      panel.key = key;
    }
    if (!panel.canvas) return y0;
    ctx.drawImage(panel.canvas, W - width - 16, y0);
    return y0 + panel.h;
  }

  return {
    get enabled() { return state.enabled && !!source; },
    get hasSource() { return !!source; },
    setEnabled(on) { state.enabled = !!on; return state.enabled; },
    toggle() { return this.setEnabled(!state.enabled); },
    setSource(fn) { source = typeof fn === 'function' ? fn : null; },
    draw,
    drawPanel,
    stats() { return { enabled: state.enabled, source: !!source, ...stats }; }
  };
}
