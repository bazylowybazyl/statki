// Wybrane cele misji, w zasięgu radaru gracza. Ten sam język co zaznaczenie Atlasa pod G:
// narożniki kadłuba i ukośny podpis; ciepły akcent + „ZNISZCZ” odróżniają cel od własnej floty.
// Rzutowanie i rozmiary dostarcza gra — działa także z kamerą perspektywy, bez liczenia camera.zoom.
import { drawSelectionFrame, drawSelectionLabel, layoutSelectionLabels, measureSelectionLabel } from './commandOverlay.js';
import { isCloakHidden } from '../game/cloak.js';

const TARGET_RGB = '255, 171, 105';
const EDGE_MARGIN = 46;
const EDGE_SPACING = 48;
const APPEAR_SEC = 0.18;
const byEdgePosition = (a, b) => a.edge - b.edge || a.edgePos - b.edgePos;

/** Osobny egzemplarz na widok; bufory i stan podpisów zostają między klatkami. */
export function createMissionTargetMarkers() {
  const states = new WeakMap();
  const entries = [];
  const edges = [];
  const p = { x: 0, y: 0, depth: 1 };
  const extents = { hx: 0, hy: 0 };

  return {
    // view: { ship, W, H, radarRange, time, project(x, y, out), halfExtents(marker, out), blockedRects?, hidden?(entity) }
    // hidden — mgła wojny (SensorSystem.hides): cel, którego strona gracza nie widzi, nie dostaje ramki.
    draw(ctx, targets, view) {
      entries.length = 0;
      edges.length = 0;
      const ship = view.ship?.pos || view.ship;
      const { W, H } = view;
      const range = Number(view.radarRange);
      if (!ship || !targets?.size || !(range > 0) || !(W > 0 && H > 0)) return 0;
      const now = Number(view.time) || 0;
      for (const marker of targets.values()) {
        const entity = marker.entity;
        if (!entity || entity.dead || entity.destroyed || entity._destroyed3D || entity.removed
          || entity.warpedOut || entity.hp <= 0 || isCloakHidden(entity) || view.hidden?.(entity)) continue;
        const pos = entity.pos || entity;
        if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
        const dx = pos.x - ship.x, dy = pos.y - ship.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq > range * range) continue;

        view.project(pos.x, pos.y, p);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        let entry = states.get(marker);
        if (!entry) {
          entry = { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, title: '', sub: '', len: 0,
            prev: null, place: null, born: now, lastSeen: now, alpha: 1, grow: 0, edge: -1, edgePos: 0, angle: 0 };
          states.set(marker, entry);
        }
        if (now - entry.lastSeen > 0.1) entry.born = now;
        entry.lastSeen = now;
        entry.prev = entry.place;
        entry.title = marker.label.toUpperCase();
        const km = Math.sqrt(distanceSq) / 1000;
        entry.sub = `ZNISZCZ · ${km.toFixed(km >= 10 ? 0 : 1).replace('.', ',')} km`;
        entry.len = measureSelectionLabel(ctx, entry.title, entry.sub);
        const ease = 1 - (1 - Math.min(1, Math.max(0, (now - entry.born) / APPEAR_SEC))) ** 2;
        entry.alpha = 0.35 + 0.65 * ease;
        entry.grow = (1 - ease) * 6;
        entry.cx = p.x; entry.cy = p.y;
        const behind = p.depth <= 0;
        entry.edge = -1;
        if (behind || p.x < EDGE_MARGIN || p.x > W - EDGE_MARGIN || p.y < EDGE_MARGIN || p.y > H - EDGE_MARGIN) {
          let sx = p.x - W / 2, sy = p.y - H / 2;
          if (behind) { sx = -sx; sy = -sy; }
          if (Math.abs(sx) + Math.abs(sy) < 1e-6) sy = -1;
          const kx = Math.max(1, W / 2 - EDGE_MARGIN) / Math.max(1e-6, Math.abs(sx));
          const ky = Math.max(1, H / 2 - EDGE_MARGIN) / Math.max(1e-6, Math.abs(sy));
          const k = Math.min(kx, ky);
          entry.cx = W / 2 + sx * k; entry.cy = H / 2 + sy * k;
          entry.angle = Math.atan2(sy, sx);
          entry.edge = kx < ky ? (sx < 0 ? 0 : 1) : (sy < 0 ? 2 : 3);
          entry.edgePos = entry.edge < 2 ? entry.cy : entry.cx;
          edges.push(entry);
          setFrame(entry, entry.cx - 9, entry.cy - 9, entry.cx + 9, entry.cy + 9);
        } else {
          extents.hx = extents.hy = Math.max(1, Number(marker.radius || entity.radius || entity.r) || 14);
          view.halfExtents?.(marker, extents);
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let i = 0; i < 4; i++) {
            view.project(pos.x + ((i & 1) ? extents.hx : -extents.hx), pos.y + ((i & 2) ? extents.hy : -extents.hy), p);
            if (p.depth <= 0 || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
            x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
          }
          if (!Number.isFinite(x0)) continue;
          // Ramka co najmniej 24 px, nawet kiedy platforma staje się punktem przy oddaleniu.
          const hx = Math.max(12, (x1 - x0) / 2 + 5), hy = Math.max(12, (y1 - y0) / 2 + 5);
          const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
          setFrame(entry, Math.max(8, cx - hx), Math.max(8, cy - hy), Math.min(W - 8, cx + hx), Math.min(H - 8, cy + hy));
        }
        entries.push(entry);
      }
      // Cele poza kadrem rozsuń wzdłuż krawędzi — sześć wieżyczek nie stapia się w jeden podpis.
      edges.sort(byEdgePosition);
      for (let start = 0; start < edges.length;) {
        let end = start + 1;
        while (end < edges.length && edges[end].edge === edges[start].edge) end++;
        const limit = (edges[start].edge < 2 ? H : W) - EDGE_MARGIN;
        const gap = Math.min(EDGE_SPACING, (limit - EDGE_MARGIN) / Math.max(1, end - start - 1));
        let previous = EDGE_MARGIN - gap;
        for (let i = start; i < end; i++) {
          const e = edges[i];
          e.edgePos = Math.max(previous + gap, Math.min(limit - (end - i - 1) * gap, e.edgePos));
          previous = e.edgePos;
          if (e.edge < 2) e.cy = e.edgePos; else e.cx = e.edgePos;
          setFrame(e, e.cx - 9, e.cy - 9, e.cx + 9, e.cy + 9);
        }
        start = end;
      }
      // Krawędź kadru bywa przykryta radarem / szyną broni. Wskaźnik zostaje tuż nad panelem.
      for (const e of edges) {
        for (const r of view.blockedRects || []) {
          if (e.cx < r.x0 - 12 || e.cx > r.x1 + 12 || e.cy < r.y0 - 12 || e.cy > r.y1 + 12) continue;
          if (e.edge < 2) e.cx = e.edge === 0 ? r.x1 + 18 : r.x0 - 18;
          else e.cy = e.edge === 2 ? r.y1 + 18 : r.y0 - 18;
        }
        setFrame(e, e.cx - 9, e.cy - 9, e.cx + 9, e.cy + 9);
      }
      layoutSelectionLabels(entries, W, H, view.blockedRects);
      ctx.save();
      ctx.setLineDash([]);
      for (const entry of entries) {
        if (entry.edge < 0) {
          drawSelectionFrame(ctx, entry.x0, entry.y0, entry.x1, entry.y1, TARGET_RGB, entry);
        } else {
          ctx.save();
          ctx.translate(entry.cx, entry.cy);
          ctx.rotate(entry.angle);
          ctx.strokeStyle = `rgba(${TARGET_RGB}, ${entry.alpha})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-5, -6); ctx.lineTo(3, 0); ctx.lineTo(-5, 6);
          ctx.stroke();
          ctx.restore();
        }
        drawSelectionLabel(ctx, entry.x0, entry.y0, entry.x1, entry.y1, entry.title, entry.sub, TARGET_RGB, entry);
      }
      ctx.restore();
      return entries.length;
    }
  };
}

function setFrame(entry, x0, y0, x1, y1) {
  entry.x0 = x0; entry.y0 = y0; entry.x1 = x1; entry.y1 = y1;
}
