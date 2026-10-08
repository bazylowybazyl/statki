// Wybrane cele misji, w zasięgu radaru gracza. Ten sam język co zaznaczenie Atlasa pod G:
// narożniki kadłuba i ukośny podpis; czerwień wroga (jak na radarze) odróżnia cel od własnej floty; pod nazwą sama odległość.
// Rzutowanie i rozmiary dostarcza gra — działa także z kamerą perspektywy, bez liczenia camera.zoom.
// Cele jednej grupy (`marker.group`, np. okręty parkingu) stojące blisko siebie na ekranie mają ramkę
// każdy, ale JEDEN podpis „GRUPA / ×n · km do najbliższego” — dziesięć okrętów w rzędzie to nie
// dziesięć podpisów z kreskami przez pół ekranu (zgłoszenie użytkownika 2026-10-07).
import { drawSelectionFrame, drawSelectionLabel, layoutSelectionLabels, measureSelectionLabel } from './commandOverlay.js';
import { isCloakHidden } from '../game/cloak.js';
import { RADAR_RGB } from './radar/radarConfig.js';

// Cele misji to wrogowie — barwa wroga z radaru (tarcza, znaczniki krawędzi, skan X), jedno źródło.
const TARGET_RGB = RADAR_RGB.hostile;
const EDGE_MARGIN = 46;
const EDGE_SPACING = 48;
const APPEAR_SEC = 0.18;
// Skupisko: ramki celów tej samej grupy bliżej niż CLUSTER_JOIN px (podpis ma ~120 px — dwa podpisy
// bliżej siebie walczą o miejsce; eskorta w hali stoi co 100–150 px); złączone rozchodzą się dopiero
// powyżej CLUSTER_HOLD px (bez migotania podpisów na granicy przy ruchu i zoomie).
const CLUSTER_JOIN = 90;
const CLUSTER_HOLD = 130;
// Poza kadrem: ta sama grupa na tej samej krawędzi bliżej niż EDGE_CLUSTER px — jeden grot.
const EDGE_CLUSTER = 72;
// Kreska podpisu najwyżej tyle px — dłuższa nie należy już wizualnie do swojej ramki. Podpis grupy bez
// wolnego miejsca znika (ramka zostaje); pojedynczy cel spoza grupy (budynek, okręt flagowy) zawsze ma podpis.
const LAYOUT_OPTS = Object.freeze({ maxGap: 52, drop: (label) => !!(label.isCluster || label.group) });
const byEdgePosition = (a, b) => a.edge - b.edge || a.edgePos - b.edgePos;

function formatKm(meters) {
  const km = meters / 1000;
  return `${km.toFixed(km >= 10 ? 0 : 1).replace('.', ',')} km`;
}

/** Osobny egzemplarz na widok; bufory i stan podpisów zostają między klatkami. */
export function createMissionTargetMarkers() {
  const states = new WeakMap();
  const entries = [];
  const edges = [];
  const edgeItems = [];
  const labels = [];
  const parent = [];
  const clusterPool = [];
  let clusterCount = 0;
  const p = { x: 0, y: 0, depth: 1 };
  const extents = { hx: 0, hy: 0 };

  const takeCluster = (lead, edge) => {
    let c = clusterPool[clusterCount];
    if (!c) {
      c = { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, edge: -1, edgePos: 0, angle: 0, title: '', sub: '', len: 0,
        prev: null, place: null, alpha: 0, grow: 0, count: 0, dist: 0, sumPos: 0, lastPos: 0, lead: null, isCluster: true };
      clusterPool[clusterCount] = c;
    }
    clusterCount++;
    c.lead = lead;
    c.edge = edge;
    c.count = 1;
    c.dist = lead.dist;
    c.alpha = lead.alpha;
    c.grow = lead.grow;
    c.angle = lead.angle;
    c.cx = lead.cx; c.cy = lead.cy;
    c.edgePos = lead.edgePos;
    c.sumPos = lead.edgePos;
    c.lastPos = lead.edgePos;
    c.x0 = lead.x0; c.y0 = lead.y0; c.x1 = lead.x1; c.y1 = lead.y1;
    lead.cluster = c;
    return c;
  };
  const joinCluster = (c, e) => {
    c.count++;
    if (e.dist < c.dist) c.dist = e.dist;
    if (e.alpha > c.alpha) c.alpha = e.alpha;
    if (e.grow < c.grow) c.grow = e.grow;
    if (e.idx < c.lead.idx) c.lead = e;
    if (e.x0 < c.x0) c.x0 = e.x0; if (e.y0 < c.y0) c.y0 = e.y0;
    if (e.x1 > c.x1) c.x1 = e.x1; if (e.y1 > c.y1) c.y1 = e.y1;
    e.cluster = c;
  };
  const findRoot = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };

  return {
    // view: { ship, W, H, radarRange, time, project(x, y, out), halfExtents(marker, out), blockedRects?, hidden?(entity) }
    // hidden — mgła wojny (SensorSystem.hides): cel, którego strona gracza nie widzi, nie dostaje ramki.
    draw(ctx, targets, view) {
      entries.length = 0;
      edges.length = 0;
      edgeItems.length = 0;
      labels.length = 0;
      clusterCount = 0;
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
          entry = { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, title: '', sub: '', len: 0, group: '', dist: 0, idx: 0,
            prev: null, place: null, groupPlace: null, cluster: null, clustered: false,
            born: now, lastSeen: now, alpha: 1, grow: 0, edge: -1, edgePos: 0, angle: 0 };
          states.set(marker, entry);
        }
        if (now - entry.lastSeen > 0.1) { entry.born = now; entry.clustered = false; }
        entry.lastSeen = now;
        entry.prev = entry.place;
        entry.cluster = null;
        entry.group = marker.group ? String(marker.group) : '';
        entry.dist = Math.sqrt(distanceSq);
        entry.title = marker.label.toUpperCase();
        entry.sub = formatKm(entry.dist);
        entry.len = 0;
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
        entry.idx = entries.length;
        entries.push(entry);
      }

      // Skupiska w kadrze: ramki tej samej grupy, które się stykają (z zapasem) — union-find, korzeń = pierwszy cel.
      const n = entries.length;
      for (let i = 0; i < n; i++) parent[i] = i;
      for (let i = 0; i < n; i++) {
        const a = entries[i];
        if (a.edge >= 0 || !a.group) continue;
        for (let j = i + 1; j < n; j++) {
          const b = entries[j];
          if (b.edge >= 0 || b.group !== a.group) continue;
          const gap = Math.max(Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
          if (gap > (a.clustered || b.clustered ? CLUSTER_HOLD : CLUSTER_JOIN)) continue;
          const ra = findRoot(i), rb = findRoot(j);
          if (ra < rb) parent[rb] = ra; else if (rb < ra) parent[ra] = rb;
        }
      }
      for (let i = 0; i < n; i++) {
        const e = entries[i];
        if (e.edge >= 0) continue;
        const root = findRoot(i);
        if (root === i) continue;
        const lead = entries[root];
        joinCluster(lead.cluster || takeCluster(lead, -1), e);
      }

      // Poza kadrem: ta sama grupa blisko siebie na jednej krawędzi — jeden grot ze wspólnym podpisem.
      edges.sort(byEdgePosition);
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        let joined = false;
        if (e.group) {
          for (let k = edgeItems.length - 1; k >= 0; k--) {
            const item = edgeItems[k];
            if (item.edge !== e.edge) break;
            const lead = item.isCluster ? item.lead : item;
            if (lead.group !== e.group) continue;
            if (e.edgePos - (item.isCluster ? item.lastPos : item.edgePos) > EDGE_CLUSTER) continue;
            const c = item.isCluster ? item : takeCluster(item, item.edge);
            if (!item.isCluster) edgeItems[k] = c;
            joinCluster(c, e);
            c.sumPos += e.edgePos;
            c.lastPos = e.edgePos;
            joined = true;
            break;
          }
        }
        if (!joined) edgeItems.push(e);
      }
      for (const item of edgeItems) {
        if (!item.isCluster) continue;
        item.edgePos = item.sumPos / item.count;
        item.angle = item.lead.angle;
        if (item.edge < 2) { item.cx = item.lead.cx; item.cy = item.edgePos; } else { item.cy = item.lead.cy; item.cx = item.edgePos; }
      }
      // Pozostałe groty rozsuń wzdłuż krawędzi — sześć wieżyczek nie stapia się w jeden podpis.
      for (let start = 0; start < edgeItems.length;) {
        let end = start + 1;
        while (end < edgeItems.length && edgeItems[end].edge === edgeItems[start].edge) end++;
        const limit = (edgeItems[start].edge < 2 ? H : W) - EDGE_MARGIN;
        const gap = Math.min(EDGE_SPACING, (limit - EDGE_MARGIN) / Math.max(1, end - start - 1));
        let previous = EDGE_MARGIN - gap;
        for (let i = start; i < end; i++) {
          const e = edgeItems[i];
          e.edgePos = Math.max(previous + gap, Math.min(limit - (end - i - 1) * gap, e.edgePos));
          previous = e.edgePos;
          if (e.edge < 2) e.cy = e.edgePos; else e.cx = e.edgePos;
        }
        start = end;
      }
      // Krawędź kadru bywa przykryta radarem / szyną broni. Wskaźnik zostaje tuż nad panelem.
      for (const e of edgeItems) {
        for (const r of view.blockedRects || []) {
          if (e.cx < r.x0 - 12 || e.cx > r.x1 + 12 || e.cy < r.y0 - 12 || e.cy > r.y1 + 12) continue;
          if (e.edge < 2) e.cx = e.edge === 0 ? r.x1 + 18 : r.x0 - 18;
          else e.cy = e.edge === 2 ? r.y1 + 18 : r.y0 - 18;
        }
        setFrame(e, e.cx - 9, e.cy - 9, e.cx + 9, e.cy + 9);
      }

      // Podpisy w kolejności celów: pojedynczy cel — własny, skupisko — jeden przy pierwszym celu grupy.
      for (const e of entries) {
        const c = e.cluster;
        if (!c) {
          e.len = measureSelectionLabel(ctx, e.title, e.sub);
          labels.push(e);
        } else if (c.lead === e) {
          c.title = e.group.toUpperCase();
          c.sub = `×${c.count} · ${formatKm(c.dist)}`;
          c.len = measureSelectionLabel(ctx, c.title, c.sub);
          c.prev = e.groupPlace;
          labels.push(c);
        }
      }
      layoutSelectionLabels(labels, W, H, view.blockedRects, LAYOUT_OPTS);
      for (let i = 0; i < clusterCount; i++) clusterPool[i].lead.groupPlace = clusterPool[i].place;
      for (const e of entries) e.clustered = !!e.cluster;

      ctx.save();
      ctx.setLineDash([]);
      for (const e of entries) {
        if (e.edge < 0) drawSelectionFrame(ctx, e.x0, e.y0, e.x1, e.y1, TARGET_RGB, e);
      }
      for (const label of labels) {
        if (label.edge >= 0) drawEdgeArrow(ctx, label);
        if (label.place) drawSelectionLabel(ctx, label.x0, label.y0, label.x1, label.y1, label.title, label.sub, TARGET_RGB, label);
      }
      ctx.restore();
      return entries.length;
    }
  };
}

function drawEdgeArrow(ctx, e) {
  ctx.save();
  ctx.translate(e.cx, e.cy);
  ctx.rotate(e.angle);
  ctx.strokeStyle = `rgba(${TARGET_RGB}, ${e.alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-5, -6); ctx.lineTo(3, 0); ctx.lineTo(-5, 6);
  ctx.stroke();
  ctx.restore();
}

function setFrame(entry, x0, y0, x1, y1) {
  entry.x0 = x0; entry.y0 = y0; entry.x1 = x1; entry.y1 = y1;
}
