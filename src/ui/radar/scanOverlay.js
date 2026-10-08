// src/ui/radar/scanOverlay.js
//
// Aktywny skan X w ŚWIECIE (przebudowa 2026-10-07, zastępuje stare znaczniki kanwy: przerywane okręgi fali,
// rozchodzące się „pingi”, okręgi z klamrami zostające do końca gry i niebieskie strzałki do stacji).
//  - IMPULS: ostra krawędź fali z jasnym czołem i miękkim pasem za nim (bez grubych przerywanych okręgów),
//    zasięg i prędkość jak fala skanera gry (getScannerActiveRange / getScannerWaveSpeed).
//  - KONTAKT, do którego dotarła fala: ramka ZACISKA się na kadłubie (narożniki jak zaznaczenie floty),
//    błysk, podpis po przekątnej (ten sam język co zaznaczenie i cele misji — commandOverlay.js):
//    „T07 · BELLATOR · PANCERNIK” / „9,2 km · 260 m/s · KADŁUB 84%”, tytuł „dekoduje się” przez ~0,35 s.
//    Wyniki trzymają się SCAN_TAG_LIFE s (jak lista skanu w kokpicie) i gasną — nie zostają na zawsze.
//  - Poza kadrem: grot przy krawędzi ekranu w barwie strony; stacje dostają namiar z odległością.
// Rzutowanie, opis bytu, numer śladu radaru i mgłę wojny podaje gra (view) — działa z kamerami 3D.

import { drawSelectionFrame, drawSelectionLabel, layoutSelectionLabels, measureSelectionLabel } from '../commandOverlay.js';
import { RADAR_RGB, formatRadarDistance, scanPulseRadius } from './radarConfig.js';
import { radarColor } from './radarSymbols.js';

const TAU = Math.PI * 2;
export const SCAN_TAG_LIFE = 10;
const FADE = 1.3;
const SNAP = 0.32;
const DECODE = 0.38;
const MAX_LABELS = 6;
const SCAN_LABEL_LAYOUT = Object.freeze({ maxGap: 52, drop: true });
const EDGE_MARGIN = 46;
const EDGE_SPACING = 46;
const GLYPHS = '0123456789ABCDEFGHJKLMNPRSTUWXYZ#/<>=+';

function rgbFor(aff, kind) {
  if (kind === 'station') return aff === 'hostile' ? RADAR_RGB.hostile : RADAR_RGB.station;
  if (aff === 'hostile') return RADAR_RGB.hostile;
  if (aff === 'friendly') return RADAR_RGB.friendly;
  return RADAR_RGB.neutral;
}

function scramble(text, k, seed) {
  if (k >= 1) return text;
  const n = text.length;
  const settled = Math.floor(n * k);
  let out = text.slice(0, settled);
  for (let i = settled; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 32 || text[i] === '·') { out += text[i]; continue; }
    const h = ((seed * 31 + i * 17 + Math.floor(k * 24) * 7) >>> 0) % GLYPHS.length;
    out += GLYPHS[h];
  }
  return out;
}

export function createScanOverlay() {
  const states = new Map();      // byt → stan wyniku skanu
  const navs = [];               // namiary stacji z impulsu
  const entries = [];
  const pool = [];
  const edges = [];
  const p = { x: 0, y: 0, depth: 1 };
  const ext = { hx: 0, hy: 0 };
  const ping = { active: false, t0: 0, x: 0, y: 0, speed: 0, max: 0 };
  let seed = 1;

  function entryFor(i) {
    let e = pool[i];
    if (!e) {
      e = { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, title: '', sub: '', len: 0, prev: null, place: null,
        alpha: 1, grow: 0, edge: -1, edgePos: 0, angle: 0, rgb: '', st: null, label: false, entity: null, dist: 0 };
      pool[i] = e;
    }
    return e;
  }

  return {
    /** Start impulsu (fala z punktu, prędkość j/s, zasięg j.). */
    ping(x, y, speed, max, time) {
      ping.active = true;
      ping.t0 = time;
      ping.x = x; ping.y = y;
      ping.speed = Math.max(1000, speed || 30000);
      ping.max = Math.max(1000, max || 60000);
    },
    /** Fala dotarła do bytu: info = { aff, kind, distance } (opis i numer bierze rysunek z view). */
    reveal(entity, info, time) {
      if (!entity) return;
      let st = states.get(entity);
      if (!st) {
        st = { t0: time, aff: 'unknown', kind: 'ship', seed: seed++, place: null, title: '', sub: '' };
        states.set(entity, st);
      }
      st.t0 = time;
      st.aff = info?.aff || st.aff;
      st.kind = info?.kind || st.kind;
    },
    /** Namiary stacji (poza kadrem) z impulsu: [{ entity, label }]. */
    navBearings(list, time) {
      navs.length = 0;
      for (const n of list || []) if (n?.entity) navs.push({ entity: n.entity, label: String(n.label || 'STACJA'), t0: time, ang: 0, inView: false });
    },
    clear() {
      states.clear();
      navs.length = 0;
      ping.active = false;
    },
    get count() { return states.size; },
    /**
     * view: { W, H, time, ship, project(x, y, out), circle?(x, y, r) → { x, y, r } | null (kamera z góry),
     *   halfExtents(entity, out), describe(entity) → { title, sub }, trackNo(entity), hidden(entity),
     *   ownLabel(entity) — byt ma własny podpis (cel misji), blockedRects — panele HUD }
     */
    draw(ctx, view) {
      const { W, H } = view;
      const now = Number(view.time) || 0;
      if (!(W > 0 && H > 0)) return 0;
      const ship = view.ship?.pos || view.ship;
      ctx.save();
      // ---------------------------------------------------------------- fala impulsu
      if (ping.active) {
        const age = now - ping.t0;
        const r = scanPulseRadius(age, ping.speed);
        const fade = r > ping.max ? Math.max(0, 1 - (r - ping.max) / (ping.speed * 0.35)) : 1;
        if (fade <= 0 || age < 0) {
          ping.active = false;
        } else {
          const rr = Math.min(r, ping.max);
          const c = view.circle ? view.circle(ping.x, ping.y, rr) : null;
          ctx.globalCompositeOperation = 'lighter';
          if (c && c.r > 2) {
            const band = Math.min(140, Math.max(40, c.r * 0.12));
            const inner = Math.max(0, c.r - band);
            // Okrąg dalej niż ~8 ekranów: gradient na tak wielkim promieniu bywa niedokładny — sam brzeg.
            if (c.r < Math.max(W, H) * 8) {
              const g = ctx.createRadialGradient(c.x, c.y, inner, c.x, c.y, c.r);
              g.addColorStop(0, radarColor(RADAR_RGB.ping, 0));
              g.addColorStop(0.82, radarColor(RADAR_RGB.ping, 0.05 * fade));
              g.addColorStop(1, radarColor(RADAR_RGB.ping, 0.13 * fade));
              ctx.fillStyle = g;
              ctx.beginPath();
              ctx.arc(c.x, c.y, c.r, 0, TAU);
              ctx.arc(c.x, c.y, inner, 0, TAU, true);
              ctx.fill();
            }
            ctx.strokeStyle = radarColor(RADAR_RGB.ping, 0.14 * fade);
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(c.x, c.y, c.r, 0, TAU);
            ctx.stroke();
            ctx.strokeStyle = radarColor(RADAR_RGB.ping, 0.85 * fade);
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.strokeStyle = radarColor(RADAR_RGB.ping, 0.22 * fade);
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 10]);
            ctx.beginPath();
            ctx.arc(c.x, c.y, Math.max(1, c.r - 14), 0, TAU);
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (!c) {
            // kamera 3D: okrąg w płaszczyźnie gry jako łamana z rzutów
            ctx.strokeStyle = radarColor(RADAR_RGB.ping, 0.8 * fade);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i <= 96; i++) {
              const a = (i / 96) * TAU;
              view.project(ping.x + Math.cos(a) * rr, ping.y + Math.sin(a) * rr, p);
              if (p.depth <= 0 || !Number.isFinite(p.x)) { started = false; continue; }
              if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
          }
          ctx.globalCompositeOperation = 'source-over';
        }
      }

      // ---------------------------------------------------------------- wyniki skanu
      entries.length = 0;
      edges.length = 0;
      let used = 0;
      for (const [entity, st] of states) {
        const age = now - st.t0;
        if (age > SCAN_TAG_LIFE || age < -1 || !entity || entity.dead || entity.destroyed || entity._destroyed3D
          || entity.removed || (Number.isFinite(entity.hp) && entity.hp <= 0 && !entity.isWreck) || view.hidden?.(entity)) {
          states.delete(entity);
          continue;
        }
        const pos = entity.pos && !Number.isFinite(entity.x) ? entity.pos : entity;
        if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
        view.project(pos.x, pos.y, p);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const e = entryFor(used++);
        e.st = st;
        e.entity = entity;
        e.prev = st.place;
        e.place = st.place;
        e.rgb = rgbFor(st.aff, st.kind);
        const life = SCAN_TAG_LIFE - age;
        const appear = Math.min(1, Math.max(0, age / SNAP));
        const ease = 1 - (1 - appear) ** 3;
        e.alpha = Math.min(1, life / FADE) * (0.4 + 0.6 * ease);
        e.grow = (1 - ease) * 16;
        const d = view.describe ? view.describe(entity) : null;
        const no = view.trackNo ? view.trackNo(entity) : 0;
        let title = String(d?.title || '').toUpperCase();
        if (no) title = `T${no < 10 ? '0' + no : no} · ${title}`;
        e.title = age < DECODE ? scramble(title, age / DECODE, st.seed) : title;
        const dist = ship ? Math.hypot(pos.x - ship.x, pos.y - ship.y) : 0;
        const vx = Number(entity.vx ?? entity.vel?.x) || 0;
        const vy = Number(entity.vy ?? entity.vel?.y) || 0;
        const v = Math.hypot(vx, vy);
        let sub = formatRadarDistance(dist);
        if (st.kind !== 'station' && v >= 5) sub += ` · ${Math.round(v)} m/s`;
        if (d?.sub) sub += ` · ${d.sub}`;
        e.sub = sub;
        e.cx = p.x; e.cy = p.y;
        e.edge = -1;
        e.label = false;
        const behind = p.depth <= 0;
        if (behind || p.x < EDGE_MARGIN || p.x > W - EDGE_MARGIN || p.y < EDGE_MARGIN || p.y > H - EDGE_MARGIN) {
          // wrogie okręty poza kadrem pokazują znaczniki krawędzi (contactMarkers.js) — bez dubla
          if (st.aff === 'hostile' && st.kind === 'ship') { used--; continue; }
          let sx = p.x - W / 2;
          let sy = p.y - H / 2;
          if (behind) { sx = -sx; sy = -sy; }
          if (Math.abs(sx) + Math.abs(sy) < 1e-6) sy = -1;
          const kx = Math.max(1, W / 2 - EDGE_MARGIN) / Math.max(1e-6, Math.abs(sx));
          const ky = Math.max(1, H / 2 - EDGE_MARGIN) / Math.max(1e-6, Math.abs(sy));
          const k = Math.min(kx, ky);
          e.cx = W / 2 + sx * k; e.cy = H / 2 + sy * k;
          e.angle = Math.atan2(sy, sx);
          e.edge = kx < ky ? (sx < 0 ? 0 : 1) : (sy < 0 ? 2 : 3);
          e.edgePos = e.edge < 2 ? e.cy : e.cx;
          e.x0 = e.cx - 9; e.y0 = e.cy - 9; e.x1 = e.cx + 9; e.y1 = e.cy + 9;
          e.dist = dist;
          edges.push(e);
        } else {
          ext.hx = ext.hy = Math.max(1, Number(entity.radius || entity.r) || 40);
          view.halfExtents?.(entity, ext);
          let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
          for (let i = 0; i < 4; i++) {
            view.project(pos.x + ((i & 1) ? ext.hx : -ext.hx), pos.y + ((i & 2) ? ext.hy : -ext.hy), p);
            if (p.depth <= 0 || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
            if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
          }
          if (!Number.isFinite(x0)) { used--; continue; }
          const hx = Math.max(11, (x1 - x0) / 2 + 5);
          const hy = Math.max(11, (y1 - y0) / 2 + 5);
          const cx = (x0 + x1) / 2;
          const cy = (y0 + y1) / 2;
          e.x0 = cx - hx; e.y0 = cy - hy; e.x1 = cx + hx; e.y1 = cy + hy;
          e.dist = dist;
        }
        entries.push(e);
      }
      // Podpisy: wrogie najpierw, potem bliższe — reszta same ramki (bitwa nie zasypuje ekranu tekstem).
      entries.sort((a, b) => (a.st.aff === 'hostile' ? 0 : 1) - (b.st.aff === 'hostile' ? 0 : 1) || a.dist - b.dist);
      let labels = 0;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        // podpis po przekątnej tylko w kadrze; przy krawędzi — zwięzły podpis obok grota; cele misji mają
        // własny podpis (missionTargetMarkers) — tu sama ramka
        if (e.edge < 0 && labels < MAX_LABELS && e.alpha > 0.05 && !view.ownLabel?.(e.entity)) {
          e.label = true;
          labels++;
          e.len = measureSelectionLabel(ctx, e.title, e.sub);
        } else {
          e.len = 0;
        }
      }
      // grot przy krawędzi: rozsunięcie wzdłuż krawędzi
      edges.sort((a, b) => a.edge - b.edge || a.edgePos - b.edgePos);
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
          for (const r of view.blockedRects || []) {
            if (e.cx < r.x0 - 12 || e.cx > r.x1 + 12 || e.cy < r.y0 - 12 || e.cy > r.y1 + 12) continue;
            if (e.edge < 2) e.cx = e.edge === 0 ? r.x1 + 18 : r.x0 - 18;
            else e.cy = e.edge === 2 ? r.y1 + 18 : r.y0 - 18;
          }
          e.x0 = e.cx - 9; e.y0 = e.cy - 9; e.x1 = e.cx + 9; e.y1 = e.cy + 9;
        }
        start = end;
      }
      // kreska podpisu krótka (dłuższa nie należy już do swojej ramki); w tłumie bez miejsca — sama ramka
      layoutSelectionLabels(entries, W, H, view.blockedRects || [], SCAN_LABEL_LAYOUT);
      for (const e of entries) {
        e.st.place = e.place;
        const age = now - e.st.t0;
        if (e.edge < 0) {
          // zaciśnięcie ramki + błysk przy dotarciu fali
          drawSelectionFrame(ctx, e.x0, e.y0, e.x1, e.y1, e.rgb, { alpha: e.alpha, grow: e.grow, outline: age < 2.5 });
          if (age < 0.55) {
            const k = age / 0.55;
            const cx = (e.x0 + e.x1) / 2;
            const cy = (e.y0 + e.y1) / 2;
            const r0 = Math.max(e.x1 - e.x0, e.y1 - e.y0) * 0.5;
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = radarColor(e.rgb, (1 - k) * 0.7);
            ctx.lineWidth = 2 * (1 - k) + 0.6;
            ctx.beginPath();
            ctx.arc(cx, cy, r0 + 6 + k * 34, 0, TAU);
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
          }
        } else {
          ctx.save();
          ctx.translate(e.cx, e.cy);
          ctx.rotate(e.angle);
          ctx.lineJoin = 'round';
          ctx.strokeStyle = radarColor(RADAR_RGB.outline, 0.6 * e.alpha);
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(-5, -6); ctx.lineTo(3, 0); ctx.lineTo(-5, 6);
          ctx.stroke();
          ctx.strokeStyle = radarColor(e.rgb, e.alpha);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
          // zwięzły podpis po stronie ekranu (od krawędzi do środka)
          const toLeft = e.edge === 1 || (e.edge >= 2 && e.cx > W / 2);
          const lx = e.cx + (toLeft ? -12 : 12);
          const ly = e.edge === 3 ? e.cy - 12 : e.edge === 2 ? e.cy + 12 : e.cy;
          ctx.font = '700 10px Consolas, "Courier New", monospace';
          ctx.textAlign = toLeft ? 'right' : 'left';
          ctx.textBaseline = 'bottom';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 3;
          ctx.strokeStyle = radarColor(RADAR_RGB.outline, 0.8 * e.alpha);
          ctx.strokeText(e.title, lx, ly);
          ctx.fillStyle = radarColor('232, 244, 255', e.alpha);
          ctx.fillText(e.title, lx, ly);
          ctx.font = '10px Consolas, "Courier New", monospace';
          ctx.textBaseline = 'top';
          const sub = formatRadarDistance(e.dist);
          ctx.strokeText(sub, lx, ly + 1);
          ctx.fillStyle = radarColor(e.rgb, 0.9 * e.alpha);
          ctx.fillText(sub, lx, ly + 1);
        }
        if (e.label && e.place) drawSelectionLabel(ctx, e.x0, e.y0, e.x1, e.y1, e.title, e.sub, e.rgb, e);
      }

      // ---------------------------------------------------------------- namiary stacji (poza kadrem)
      if (navs.length && ship) {
        view.project(ship.x, ship.y, p);
        const sx0 = p.x;
        const sy0 = p.y;
        const ringR = Math.max(90, Math.min(W, H) * 0.16);
        ctx.font = '10px Consolas, "Courier New", monospace';
        for (const n of navs) {
          const st = n.entity;
          const pos = st.pos && !Number.isFinite(st.x) ? st.pos : st;
          n.ang = Math.atan2(pos.y - ship.y, pos.x - ship.x);
          view.project(pos.x, pos.y, p);
          n.inView = p.depth > 0 && p.x > EDGE_MARGIN && p.x < W - EDGE_MARGIN && p.y > EDGE_MARGIN && p.y < H - EDGE_MARGIN;
        }
        navs.sort((a, b) => a.ang - b.ang);
        let lastAng = -1e9;
        let tier = 0;
        for (const n of navs) {
          const age = now - n.t0;
          const a = Math.min(1, (6 - age) / 1.2) * Math.min(1, age / 0.25);
          if (a <= 0 || n.inView) continue;
          const st = n.entity;
          const pos = st.pos && !Number.isFinite(st.x) ? st.pos : st;
          const ang = n.ang;
          // namiary blisko siebie (< ~13°) — kolejny na dalszym pierścieniu, podpisy się nie nakrywają
          tier = ang - lastAng < 0.23 ? (tier + 1) % 3 : 0;
          lastAng = ang;
          const rr = ringR + tier * 22;
          const x = sx0 + Math.cos(ang) * rr;
          const y = sy0 + Math.sin(ang) * rr;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(ang);
          ctx.strokeStyle = radarColor(RADAR_RGB.outline, 0.55 * a);
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(-4, -6); ctx.lineTo(4, 0); ctx.lineTo(-4, 6);
          ctx.stroke();
          ctx.strokeStyle = radarColor(RADAR_RGB.station, 0.95 * a);
          ctx.lineWidth = 1.8;
          ctx.stroke();
          ctx.restore();
          const dist = Math.hypot(pos.x - ship.x, pos.y - ship.y);
          const lx = x + Math.cos(ang) * 14;
          const ly = y + Math.sin(ang) * 14;
          const align = Math.cos(ang) >= 0 ? 'left' : 'right';
          ctx.textAlign = align;
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 3;
          const text = `${n.label.toUpperCase()} · ${formatRadarDistance(dist)}`;
          ctx.strokeStyle = radarColor(RADAR_RGB.outline, 0.8 * a);
          ctx.strokeText(text, lx, ly);
          ctx.fillStyle = radarColor(RADAR_RGB.station, 0.9 * a);
          ctx.fillText(text, lx, ly);
        }
        for (let i = navs.length - 1; i >= 0; i--) if (now - navs[i].t0 > 6) navs.splice(i, 1);
      }
      ctx.restore();
      return entries.length;
    }
  };
}
