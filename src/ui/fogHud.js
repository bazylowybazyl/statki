// HUD mgły wojny (2026-10-04; logika src/game/fogOfWar.js, obraz mgły — post Core3D, src/3d/fog/).
//  - SYGNATURA MASY: ramka obszaru niepewności (narożniki jak zaznaczenie floty), podpis „NIEZNANA MASA”
//    z szacunkiem masy i odległością; poza kadrem — szewron przy krawędzi. Barwa zimny fiolet: nieznane,
//    nie cel (cele misji są ciepłe).
//  - DUCH kontaktu w kadrze (ostatnia znana pozycja zgubionego okrętu): mały pusty romb, gaśnie z wiekiem.
// Rzutowanie dostarcza gra (view.project — działa też z kamerami 3D). Bez alokacji na klatkę.
import { drawSelectionFrame, drawSelectionLabel, drawTargetDiamond, layoutSelectionLabels, measureSelectionLabel } from './commandOverlay.js';

const MASS_RGB = '186, 160, 255';
const GHOST_RGB = '150, 170, 196';
const EDGE_MARGIN = 46;
const MIN_FRAME_PX = 30;

/** view: { ship, W, H, time, project(x, y, out), blockedRects?, masses: [...], ghosts: Map, formatMass(t) }. */
export function createFogHud() {
  const p = { x: 0, y: 0, depth: 1 };
  const entries = [];
  const pool = [];
  const states = new Map();      // id sygnatury → stan podpisu (układ i pojawianie się)

  function entryFor(i) {
    let e = pool[i];
    if (!e) {
      e = { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, title: '', sub: '', len: 0, prev: null, place: null,
        alpha: 1, grow: 0, edge: -1, angle: 0, st: null };
      pool[i] = e;
    }
    return e;
  }

  return {
    draw(ctx, view) {
      const { W, H } = view;
      if (!(W > 0 && H > 0)) return 0;
      const ship = view.ship?.pos || view.ship;
      entries.length = 0;
      let used = 0;
      const masses = view.masses || [];
      for (let i = 0; i < masses.length; i++) {
        const m = masses[i];
        if (!m || !(m.alpha > 0.01)) continue;
        view.project(m.shownX, m.shownY, p);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const e = entryFor(used++);
        let st = states.get(m.id);
        if (!st) { st = { place: null, seen: 0 }; states.set(m.id, st); }
        st.seen = view.time;
        e.st = st;
        e.prev = st.place;
        e.place = st.place;
        e.alpha = Math.max(0, Math.min(1, m.alpha));
        e.grow = 0;
        e.title = (m.label || 'Nieznana masa').toUpperCase();
        const km = ship ? Math.hypot(m.shownX - ship.x, m.shownY - ship.y) / 1000 : 0;
        const massTxt = view.formatMass ? view.formatMass(m.mass) : '';
        e.sub = `${massTxt}${massTxt ? ' · ' : ''}${km.toFixed(km >= 10 ? 0 : 1).replace('.', ',')} km`;
        e.len = measureSelectionLabel(ctx, e.title, e.sub);
        const behind = p.depth <= 0;
        if (behind || p.x < EDGE_MARGIN || p.x > W - EDGE_MARGIN || p.y < EDGE_MARGIN || p.y > H - EDGE_MARGIN) {
          let sx = p.x - W / 2, sy = p.y - H / 2;
          if (behind) { sx = -sx; sy = -sy; }
          if (Math.abs(sx) + Math.abs(sy) < 1e-6) sy = -1;
          const k = Math.min(Math.max(1, W / 2 - EDGE_MARGIN) / Math.max(1e-6, Math.abs(sx)),
            Math.max(1, H / 2 - EDGE_MARGIN) / Math.max(1e-6, Math.abs(sy)));
          e.cx = W / 2 + sx * k; e.cy = H / 2 + sy * k;
          e.angle = Math.atan2(sy, sx);
          e.edge = 1;
          for (const r of view.blockedRects || []) {
            if (e.cx < r.x0 - 12 || e.cx > r.x1 + 12 || e.cy < r.y0 - 12 || e.cy > r.y1 + 12) continue;
            if (Math.abs(sx) * H > Math.abs(sy) * W) e.cx = sx < 0 ? r.x1 + 18 : r.x0 - 18;
            else e.cy = sy < 0 ? r.y1 + 18 : r.y0 - 18;
          }
          e.x0 = e.cx - 9; e.y0 = e.cy - 9; e.x1 = e.cx + 9; e.y1 = e.cy + 9;
        } else {
          // ramka = obszar niepewności (rzut dwóch rogów), co najmniej 30 px
          const cx = p.x, cy = p.y;
          view.project(m.shownX + m.spread, m.shownY + m.spread, p);
          let hx = Math.abs(p.x - cx), hy = Math.abs(p.y - cy);
          if (!Number.isFinite(hx) || !Number.isFinite(hy) || p.depth <= 0) { hx = hy = MIN_FRAME_PX; }
          hx = Math.max(MIN_FRAME_PX * 0.5, Math.min(W * 0.45, hx));
          hy = Math.max(MIN_FRAME_PX * 0.5, Math.min(H * 0.45, hy));
          e.cx = cx; e.cy = cy;
          e.edge = -1;
          e.x0 = Math.max(8, cx - hx); e.y0 = Math.max(8, cy - hy);
          e.x1 = Math.min(W - 8, cx + hx); e.y1 = Math.min(H - 8, cy + hy);
        }
        entries.push(e);
      }
      layoutSelectionLabels(entries, W, H, view.blockedRects);
      ctx.save();
      ctx.setLineDash([]);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.edge < 0) {
          drawSelectionFrame(ctx, e.x0, e.y0, e.x1, e.y1, MASS_RGB, { alpha: e.alpha * 0.85, outline: false, width: 1.5 });
          // „?” w środku — miejsce wskazane przez czujniki, nie pewne
          ctx.font = '700 13px Consolas, "Courier New", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3;
          ctx.strokeStyle = `rgba(3, 5, 8, ${0.7 * e.alpha})`;
          ctx.strokeText('?', e.cx, e.cy);
          ctx.fillStyle = `rgba(${MASS_RGB}, ${0.95 * e.alpha})`;
          ctx.fillText('?', e.cx, e.cy);
        } else {
          ctx.save();
          ctx.translate(e.cx, e.cy);
          ctx.rotate(e.angle);
          ctx.strokeStyle = `rgba(${MASS_RGB}, ${e.alpha})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-5, -6); ctx.lineTo(3, 0); ctx.lineTo(-5, 6);
          ctx.stroke();
          ctx.restore();
        }
        drawSelectionLabel(ctx, e.x0, e.y0, e.x1, e.y1, e.title, e.sub, MASS_RGB, e);
        // układ podpisu zapamiętany na następną klatkę (bez skakania)
        if (e.st) e.st.place = e.place;
      }
      // sygnatury, których już nie ma
      if (states.size > masses.length) {
        for (const [id, st] of states) if (st.seen !== view.time) states.delete(id);
      }

      // Duchy w kadrze (poza kadrem rysuje je ContactMarkers).
      const ghosts = view.ghosts;
      if (ghosts && ghosts.size) {
        ctx.font = '9px Consolas, "Courier New", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (const [, g] of ghosts) {
          if (!g) continue;
          view.project(g.x, g.y, p);
          if (p.depth <= 0 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
          const life = g.maxAge > 0 ? Math.max(0, 1 - g.age / g.maxAge) : 0;
          if (life <= 0.02) continue;
          const a = 0.25 + 0.5 * life;
          drawTargetDiamond(ctx, p.x, p.y, GHOST_RGB, 5, a);
          ctx.fillStyle = `rgba(${GHOST_RGB}, ${0.8 * a})`;
          ctx.fillText(`${Math.floor(g.age)} s`, p.x + 9, p.y);
        }
      }
      ctx.restore();
      return entries.length;
    }
  };
}
