// src/ui/weaponReticle.js
//
// JEDEN CELOWNIK gracza (2026-10-03, zastępuje tryby SINGLE / MULTI / SUB / SELECT i koło ŚPM celownika).
// Wzór: World of Warships — pierścień wokół kursora, jeden segment na wieżę grupy W RĘKU
// (src/game/fireControl.js: fc.turrets[grupa], stany FC_TURRET):
//   • czerwony, wypełnia się zgodnie z zegarem — przeładowanie;
//   • zielony — naładowana, lufa na kursorze (LPM strzeli);
//   • przygaszony zielony — naładowana, lufa jeszcze się obraca;
//   • cienki szary — kursor poza łukiem ostrzału tej wieży;
//   • błękitny, wypełnia się — ładowanie przed strzałem (Valkyrie, Mjolnir);
//   • ciemny — gniazdo zniszczone.
// Prawa połowa pierścienia = prawa burta (od dziobu w dół), lewa = lewa burta (od rufy w górę) — widać,
// która bateria jest gotowa. Obok: liczba gotowych, a pod nią odległość / czas do najbliższej / „POZA ŁUKIEM”.
//
// KOMPAS ŁUKÓW: pierścień wokół okrętu, grubość = ile wież grupy w ręku sięga w danym kierunku, czerwony
// = martwy kierunek; pokazywany kontekstowo (klej gry podaje alfę).
//
// Czysty canvas 2D: funkcje dostają kontekst i dane, nie znają stanu gry. Zero alokacji w rysowaniu.

import { FC_TURRET } from '../game/fireControl.js';

const TAU = Math.PI * 2;
const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

export const RETICLE_COLORS = Object.freeze({
  reload: '#ff4d5e',
  ready: '#52ff9a',
  traverse: 'rgba(82, 255, 154, 0.38)',
  noArc: '#6f8b99',
  charge: '#7fd8ff',
  still: '#ffb347',
  down: '#3b2a2e',
  idle: 'rgba(127, 216, 255, 0.55)',
  track: 'rgba(255, 255, 255, 0.13)',
  cross: '#ffd27a',
  text: '#8fa3b0'
});

export function turretStateColor(state) {
  switch (state) {
    case FC_TURRET.RELOAD: return RETICLE_COLORS.reload;
    case FC_TURRET.READY: return RETICLE_COLORS.ready;
    case FC_TURRET.TRAVERSE: return RETICLE_COLORS.traverse;
    case FC_TURRET.NO_ARC: return RETICLE_COLORS.noArc;
    case FC_TURRET.CHARGE: return RETICLE_COLORS.charge;
    case FC_TURRET.DOWN: return RETICLE_COLORS.down;
    case FC_TURRET.STILL: return RETICLE_COLORS.still;
    default: return RETICLE_COLORS.idle;
  }
}

/**
 * Kolejność segmentów: prawa burta (y > 0) od dziobu do rufy, potem lewa od rufy do dziobu — idąc
 * zgodnie z zegarem od góry pierścienia. `out` — tablica wielokrotnego użytku. Zwraca liczbę.
 */
export function orderRingTurrets(list, count, out) {
  let n = 0;
  for (let i = 0; i < count; i++) if (list[i].y > 0) out[n++] = list[i];
  const star = n;
  for (let i = 0; i < count; i++) if (!(list[i].y > 0)) out[n++] = list[i];
  // Wstawianie (≤ ~20 wież, bez alokacji): prawa burta po x malejąco, lewa po x rosnąco.
  for (let i = 1; i < n; i++) {
    const t = out[i];
    const lo = i < star ? 0 : star;
    let j = i - 1;
    while (j >= lo && (i < star ? out[j].x < t.x : out[j].x > t.x)) { out[j + 1] = out[j]; j--; }
    out[j + 1] = t;
  }
  out.length = n;
  return n;
}

function arc(ctx, x, y, r, a0, a1, color, width) {
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Segment / pierścień stanu wieży między kątami a0..a1 (wypełnienie zgodnie z zegarem). */
export function strokeTurretState(ctx, x, y, r, a0, a1, t, width) {
  arc(ctx, x, y, r, a0, a1, RETICLE_COLORS.track, width);
  const s = t.state;
  if (s === FC_TURRET.RELOAD || s === FC_TURRET.CHARGE) {
    if (t.progress > 0.002) arc(ctx, x, y, r, a0, a0 + (a1 - a0) * t.progress, turretStateColor(s), width);
  } else if (s === FC_TURRET.NO_ARC || s === FC_TURRET.STILL) {
    arc(ctx, x, y, r, a0, a1, turretStateColor(s), Math.max(1, width * 0.32));
  } else if (s === FC_TURRET.DOWN) {
    arc(ctx, x, y, r, a0, a1, RETICLE_COLORS.down, width);
  } else {
    arc(ctx, x, y, r, a0, a1, turretStateColor(s), width);
  }
}

const _missileRing = { state: FC_TURRET.READY, progress: 1 };

function fmt1(v) {
  return (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
}

/**
 * Celownik broni. `ring` / `n` — wieże grupy w ręku w kolejności orderRingTurrets.
 * opts: { scale, distance [j.], cold (PRZELOT — broń zimna), dim (MASKOWANIE), tag (napis pod spodem),
 *         tagColor, missiles: { ready, total, left } dla rakiet w ręku (bez wież) }
 */
export function drawWeaponReticle(ctx, x, y, ring, n, opts) {
  const s = Math.max(0.6, Number(opts?.scale) || 1);
  const R = 27 * s;
  ctx.save();
  ctx.lineCap = 'butt';
  if (opts?.dim) ctx.globalAlpha = 0.6;

  // Krzyż: punkt celowania.
  ctx.strokeStyle = opts?.cold ? RETICLE_COLORS.noArc : RETICLE_COLORS.cross;
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  const g0 = 4 * s, g1 = 11 * s;
  ctx.moveTo(x + g0, y); ctx.lineTo(x + g1, y);
  ctx.moveTo(x - g0, y); ctx.lineTo(x - g1, y);
  ctx.moveTo(x, y + g0); ctx.lineTo(x, y + g1);
  ctx.moveTo(x, y - g0); ctx.lineTo(x, y - g1);
  ctx.stroke();

  let ready = 0;
  let next = Infinity;
  let inArc = 0;
  let still = 0;
  if (opts?.cold) {
    arc(ctx, x, y, R, 0, TAU, 'rgba(111, 139, 153, 0.55)', 1.2 * s);
  } else if (n > 0) {
    const width = (n > 8 ? 3.4 : 4.6) * s;
    const step = TAU / n;
    const gap = Math.min(step * 0.3, (n > 8 ? 0.06 : 0.1));
    for (let i = 0; i < n; i++) {
      const t = ring[i];
      const a0 = -Math.PI / 2 + i * step + gap * 0.5;
      strokeTurretState(ctx, x, y, R, a0, a0 + step - gap, t, width);
      if (t.state === FC_TURRET.READY) ready++;
      else if (t.state === FC_TURRET.STILL) still++;
      if (t.state !== FC_TURRET.NO_ARC && t.state !== FC_TURRET.DOWN) {
        inArc++;
        if (t.state === FC_TURRET.RELOAD && t.left < next) next = t.left;
      }
    }
  } else if (opts?.missiles) {
    const m = opts.missiles;
    ready = m.ready;
    inArc = m.total;
    _missileRing.state = m.ready > 0 ? FC_TURRET.READY : FC_TURRET.RELOAD;
    _missileRing.progress = m.progress ?? 1;
    strokeTurretState(ctx, x, y, R, -Math.PI / 2 + 0.05, -Math.PI / 2 + TAU - 0.05, _missileRing, 3.4 * s);
    if (!m.ready && m.left > 0) next = m.left;
  } else {
    arc(ctx, x, y, R, 0, TAU, RETICLE_COLORS.track, 1.2 * s);
  }

  // Odczyty: liczba gotowych i druga linia.
  const tx = x + R + 11 * s;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 4;
  if (!opts?.cold && (n > 0 || opts?.missiles)) {
    const total = opts?.missiles ? opts.missiles.total : n;
    ctx.font = `600 ${Math.round(17 * s)}px Consolas, monospace`;
    ctx.fillStyle = ready > 0 ? RETICLE_COLORS.ready : RETICLE_COLORS.reload;
    const label = String(ready);
    ctx.fillText(label, tx, y + 1 * s);
    const w = ctx.measureText(label).width;
    ctx.font = `${Math.round(12 * s)}px Consolas, monospace`;
    ctx.fillStyle = RETICLE_COLORS.text;
    ctx.fillText(`/${total}`, tx + w + 2 * s, y + 1 * s);
    let sub;
    let color = RETICLE_COLORS.text;
    if (inArc === 0) { sub = 'POZA ŁUKIEM'; color = '#8fb0bf'; }
    else if (ready === 0 && still > 0) { sub = 'WYMAGA POSTOJU'; color = RETICLE_COLORS.still; }
    else if (ready === 0 && next < Infinity) { sub = `za ${fmt1(next)} s`; color = '#ff8a94'; }
    else sub = Number.isFinite(opts?.distance) ? `${fmt1(opts.distance / 1000)} km` : '';
    if (sub) {
      ctx.fillStyle = color;
      ctx.fillText(sub, tx, y + 16 * s);
    }
  }
  if (opts?.tag) {
    ctx.font = `${Math.round(11 * s)}px Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = opts.tagColor || RETICLE_COLORS.text;
    ctx.fillText(opts.tag, x, y + R + 20 * s);
  }
  ctx.restore();
  return ready;
}

/**
 * Kompas łuków wokół okrętu. `turrets` / `count` — wieże grupy w ręku (pola arcC, arcH w układzie
 * kadłuba), `heading` — kurs kadłuba [rad, ekran = świat], `cursorBearing` — kierunek kursora od środka
 * okrętu [rad] albo NaN. Zwraca, ile wież sięga w kierunku kursora (-1 bez kursora).
 */
export function drawArcCompass(ctx, cx, cy, radius, heading, turrets, count, cursorBearing, alpha, scale = 1) {
  if (!(alpha > 0.01) || count <= 0) return -1;
  let total = 0;
  for (let i = 0; i < count; i++) if (turrets[i].state !== FC_TURRET.DOWN) total++;
  if (total <= 0) return -1;
  const bins = 72;
  const binA = TAU / bins;
  ctx.save();
  ctx.lineCap = 'butt';
  for (let b = 0; b < bins; b++) {
    const bearing = b * binA;
    const rel = wrap(bearing - heading);
    let k = 0;
    for (let i = 0; i < count; i++) {
      const t = turrets[i];
      if (t.state === FC_TURRET.DOWN) continue;
      if (Math.abs(wrap(rel - t.arcC)) <= t.arcH + 1e-6) k++;
    }
    ctx.globalAlpha = alpha * (k ? 0.15 + 0.65 * (k / total) : 0.5);
    arc(ctx, cx, cy, radius, bearing - binA * 0.5 + 0.012, bearing + binA * 0.5 - 0.012,
      k ? '#52ff9a' : '#ff4d5e', (k ? 1.4 + 3 * (k / total) : 1.4) * scale);
  }
  let atCursor = -1;
  if (cursorBearing === cursorBearing) {
    const rel = wrap(cursorBearing - heading);
    atCursor = 0;
    for (let i = 0; i < count; i++) {
      const t = turrets[i];
      if (t.state !== FC_TURRET.DOWN && Math.abs(wrap(rel - t.arcC)) <= t.arcH + 1e-6) atCursor++;
    }
    const c = Math.cos(cursorBearing), sn = Math.sin(cursorBearing);
    ctx.globalAlpha = alpha;
    ctx.translate(cx + c * radius, cy + sn * radius);
    ctx.rotate(cursorBearing);
    ctx.beginPath();
    ctx.moveTo(-10 * scale, 0);
    ctx.lineTo(-1 * scale, -5 * scale);
    ctx.lineTo(-1 * scale, 5 * scale);
    ctx.closePath();
    ctx.fillStyle = '#ffd27a';
    ctx.fill();
  }
  ctx.restore();
  if (atCursor >= 0) {
    const c = Math.cos(cursorBearing), sn = Math.sin(cursorBearing);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${Math.round(12 * scale)}px Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = atCursor ? '#ffd27a' : '#ff8a94';
    ctx.fillText(`${atCursor}/${total}`, cx + c * (radius + 22 * scale), cy + sn * (radius + 22 * scale));
    ctx.restore();
  }
  return atCursor;
}
