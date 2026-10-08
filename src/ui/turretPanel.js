// src/ui/turretPanel.js
//
// SYLWETKA OKRĘTU z wieżami nad szyną broni (2026-10-03, wzór: World of Warships). Okręt gracza ze
// sprite'a, STALE dziobem w górę (decyzja użytkownika), poszerzony w poprzek (schemat — wieże nie
// zachodzą na siebie). Wieże w miejscach gniazd, obrócone tak, jak naprawdę stoją, w kolorach celownika
// (src/ui/weaponReticle.js): grupa w ręku — pierścienie stanu z przeładowaniem, grupy na AUTO — kropki.
// Przerywana linia = kierunek kursora względem kadłuba.
//
// Czysty canvas 2D. Sylwetkę (obrys z alfy sprite'a) liczy buildHullSilhouette raz na kadłub.

import { FC_TURRET } from '../game/fireControl.js';
import { strokeTurretState, turretStateColor, RETICLE_COLORS } from './weaponReticle.js';

const TAU = Math.PI * 2;

// Poszerzenie sylwetki w poprzek (schemat jak w WoWS).
export const PANEL_WIDTH_STRETCH = 1.35;

/**
 * Sylwetka dziobem w górę: wypełnienie + obrys, w rozmiarze boxW × boxH px (już po DPR).
 * `img` — sprite kadłuba dziobem w +X (gracz: spriteRotation 0). Zwraca canvas albo null.
 */
export function buildHullSilhouette(img, boxW, boxH, color = '#afcde1') {
  if (!img || !(img.width > 0) || !(boxW > 2) || !(boxH > 2) || typeof document === 'undefined') return null;
  const w = Math.round(boxW), h = Math.round(boxH);
  const mask = document.createElement('canvas');
  mask.width = w; mask.height = h;
  const m = mask.getContext('2d');
  m.translate(w / 2, h / 2);
  m.rotate(-Math.PI / 2);
  // Po obrocie oś x obrazu (dziób) idzie w górę: szerokość obrazu → wysokość pudełka.
  m.drawImage(img, -h / 2, -w / 2, h, w);
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.globalCompositeOperation = 'source-in';
  m.fillStyle = color;
  m.fillRect(0, 0, w, h);

  // Obrys: sylwetka przesunięta w 8 stronach minus środek.
  const edge = document.createElement('canvas');
  edge.width = w; edge.height = h;
  const e = edge.getContext('2d');
  const d = Math.max(1, Math.round(Math.min(w, h) / 90));
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) if (dx || dy) e.drawImage(mask, dx * d, dy * d);
  }
  e.globalCompositeOperation = 'destination-out';
  e.drawImage(mask, 0, 0);

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const o = out.getContext('2d');
  o.globalAlpha = 0.13;
  o.drawImage(mask, 0, 0);
  o.globalAlpha = 0.85;
  o.drawImage(edge, 0, 0);
  return out;
}

/**
 * Panel. `p`:
 *   W, H        — rozmiar kanwy panelu [px CSS], dpr
 *   sil         — sylwetka z buildHullSilhouette (albo null — sam prostokąt)
 *   hullLen, hullWid — wymiary obrazu kadłuba w jednostkach gniazd (ship.w·spriteScale, ship.h·spriteScale)
 *   heading     — kurs kadłuba [rad] (kąty wież są w świecie)
 *   groups      — [{ list, count, hand, big }] (fc.turrets[grupa] + turretCount)
 *   cursorRel   — kierunek kursora w układzie kadłuba [rad] albo NaN
 *   engines, engineCount — dysze MAIN [{ x, y, dead }] w jednostkach gniazd (src/game/engineDamage.js:
 *                 zniszczona — czerwony krzyżyk do remontu w doku); engineCount 0 — bez dysz
 *   title, titleColor, sub, subColor — napisy nad sylwetką
 */
export function drawTurretPanel(ctx, p) {
  const W = p.W, H = p.H;
  ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const top = 30;
  const boxH = Math.max(10, H - top - 6);
  const len = Math.max(1, p.hullLen), wid = Math.max(1, p.hullWid);
  let boxW = boxH * (wid / len) * PANEL_WIDTH_STRETCH;
  if (boxW > W - 16) boxW = W - 16;
  const cx = W * 0.5;
  const cy = top + boxH * 0.5;
  if (p.sil) ctx.drawImage(p.sil, cx - boxW / 2, cy - boxH / 2, boxW, boxH);

  const sx = boxW / wid, sy = boxH / len;
  // Kierunek kursora.
  if (p.cursorRel === p.cursorRel) {
    const L = boxH * 0.62;
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255, 210, 122, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(p.cursorRel) * L, cy - Math.cos(p.cursorRel) * L);
    ctx.stroke();
    ctx.restore();
  }

  // Dysze MAIN (pod wieżami): sprawna — wylot w barwie strugi, zniszczona — czerwony krzyżyk.
  const engineCount = p.engineCount | 0;
  for (let i = 0; i < engineCount; i++) {
    const en = p.engines[i];
    const px = cx + en.y * sx;
    const py = cy - en.x * sy;
    if (en.dead) {
      drawCross(ctx, px, py, 3.2, '#ff4d5e');
    } else {
      ctx.beginPath();
      ctx.moveTo(px - 2.6, py - 1.6);
      ctx.lineTo(px + 2.6, py - 1.6);
      ctx.lineTo(px + 1.6, py + 2.4);
      ctx.lineTo(px - 1.6, py + 2.4);
      ctx.closePath();
      ctx.fillStyle = 'rgba(127, 216, 255, 0.75)';
      ctx.fill();
    }
  }

  ctx.lineCap = 'butt';
  // Najpierw grupy na auto (kropki), na wierzchu grupa w ręku.
  for (let pass = 0; pass < 2; pass++) {
    for (let g = 0; g < p.groups.length; g++) {
      const grp = p.groups[g];
      if (!grp || (pass === 0) === !!grp.hand) continue;
      for (let i = 0; i < grp.count; i++) {
        const t = grp.list[i];
        const px = cx + t.y * sx;
        const py = cy - t.x * sy;
        const rel = t.angle - p.heading;
        const dx = Math.sin(rel), dy = -Math.cos(rel);
        if (grp.hand) {
          const r = grp.big ? 5.2 : 3.4;
          const lw = grp.big ? 2.2 : 1.6;
          if (t.state !== FC_TURRET.DOWN) {
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + dx * (r + 5), py + dy * (r + 5));
            ctx.strokeStyle = 'rgba(230, 240, 255, 0.85)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
          strokeTurretState(ctx, px, py, r, -Math.PI / 2, -Math.PI / 2 + TAU, t, lw);
          ctx.beginPath();
          ctx.arc(px, py, Math.max(1, r - lw * 0.5 - 0.6), 0, TAU);
          ctx.fillStyle = '#0b1018';
          ctx.fill();
          if (t.state === FC_TURRET.DOWN) drawCross(ctx, px, py, r, '#ff4d5e');
        } else if (t.state === FC_TURRET.DOWN) {
          drawCross(ctx, px, py, 2.4, 'rgba(255, 77, 94, 0.7)');
        } else {
          ctx.beginPath();
          ctx.arc(px, py, 2.4, 0, TAU);
          ctx.fillStyle = t.state === FC_TURRET.RELOAD ? 'rgba(127, 216, 255, 0.28)'
            : t.state === FC_TURRET.READY ? turretStateColor(FC_TURRET.READY) : RETICLE_COLORS.idle;
          ctx.fill();
        }
      }
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 4;
  if (p.title) {
    ctx.font = '600 12px Consolas, monospace';
    ctx.fillStyle = p.titleColor || '#ffd27a';
    ctx.fillText(p.title, cx, 12);
  }
  if (p.sub) {
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = p.subColor || RETICLE_COLORS.text;
    ctx.fillText(p.sub, cx, 25);
  }
  ctx.shadowBlur = 0;
}

function drawCross(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}
