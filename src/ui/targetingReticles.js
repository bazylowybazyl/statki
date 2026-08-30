// Rysowanie celownikow: SINGLE (pojedynczy cel), MULTI (ramka + wezly)
// i SUB (namiar na podzespol). Czysty canvas 2D — funkcje dostaja kontekst
// i wspolrzedne ekranowe, nie znaja stanu gry.
import { targetingVisualScale } from '../game/targetingModes.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TARGETING_CORNERS = Object.freeze([[-1, -1], [1, -1], [1, 1], [-1, 1]]);

// Animacje celownika chodza w czasie RZECZYWISTYM. GameState.gameTime biegnie
// z TIME_SCALE = 60, wiec oddech i kreskowanie leciały 60x za szybko.
const uiTime = () => performance.now() / 1000;

export const TARGETING_READY_FX = 0.35;

export function targetingStrokeGlass(drawCtx, color, width = 1.5, alpha = 1) {
  drawCtx.save();
  drawCtx.globalAlpha *= alpha;
  drawCtx.strokeStyle = color;
  drawCtx.lineWidth = width;
  drawCtx.shadowColor = color;
  drawCtx.shadowBlur = 10;
  drawCtx.stroke();
  drawCtx.shadowBlur = 0;
  drawCtx.globalAlpha *= 0.68;
  drawCtx.strokeStyle = '#eaffff';
  drawCtx.lineWidth = Math.max(0.55, width * 0.32);
  drawCtx.stroke();
  drawCtx.restore();
}

function targetingFillGlass(drawCtx, color, alpha = 0.12) {
  drawCtx.save();
  drawCtx.globalAlpha *= alpha;
  drawCtx.fillStyle = color;
  drawCtx.shadowColor = color;
  drawCtx.shadowBlur = 8;
  drawCtx.fill();
  drawCtx.restore();
}

function traceTargetingCorner(drawCtx, x, y, sx, sy, outer, inner, bevel) {
  drawCtx.moveTo(x + sx * inner, y + sy * outer);
  drawCtx.lineTo(x + sx * (outer - bevel), y + sy * outer);
  drawCtx.lineTo(x + sx * outer, y + sy * (outer - bevel));
  drawCtx.lineTo(x + sx * outer, y + sy * inner);
}

export function drawSingleTargetingReticle(drawCtx, x, y, radius, progress, base = '#ffb648', accent = '#ffd27a', visualScale = 1) {
  const scale = targetingVisualScale(visualScale);
  radius = Math.max(0, Number(radius) || 0) / scale;
  const p = clamp(progress, 0, 1);
  const ready = p >= 1;
  const q = 1 - Math.pow(1 - p, 2.4);
  const color = ready ? accent : base;
  const t = uiTime();
  const breath = ready ? (0.84 + 0.16 * Math.sin(t * 6)) : 1;
  const outer = Math.max(24, radius + 12) + 24 * (1 - q);
  const inner = Math.max(9, outer * 0.38);
  const bevel = clamp(outer * 0.14, 3, 9);

  drawCtx.save();
  drawCtx.translate(x, y);
  drawCtx.scale(scale, scale);
  drawCtx.lineCap = 'square';
  drawCtx.lineJoin = 'miter';
  drawCtx.globalAlpha = (0.5 + 0.5 * q) * breath;
  drawCtx.beginPath();
  for (const [sx, sy] of TARGETING_CORNERS) traceTargetingCorner(drawCtx, 0, 0, sx, sy, outer, inner, bevel);
  targetingStrokeGlass(drawCtx, color, ready ? 3.4 : 2.1);

  drawCtx.globalAlpha = (0.5 + 0.5 * q) * breath * 0.62;
  drawCtx.beginPath();
  for (const [sx, sy] of TARGETING_CORNERS) traceTargetingCorner(drawCtx, 0, 0, sx, sy, outer + 9, inner + 6, bevel);
  drawCtx.strokeStyle = color;
  drawCtx.lineWidth = 1.1;
  drawCtx.stroke();

  // READY = zamkniety pierscien + kreski ukosne. Sam skok odcienia bursztynu
  // byl nieczytelny, wiec stan "mozna LPM" dostaje wlasny ksztalt.
  if (ready) {
    drawCtx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 5);
    drawCtx.strokeStyle = accent;
    drawCtx.shadowColor = accent;
    drawCtx.shadowBlur = 12;
    drawCtx.lineWidth = 1.8;
    drawCtx.beginPath();
    drawCtx.arc(0, 0, outer + 5, 0, Math.PI * 2);
    drawCtx.stroke();
    drawCtx.globalAlpha = 0.95;
    drawCtx.lineWidth = 2.6;
    for (let i = 0; i < 4; i++) {
      drawCtx.save();
      drawCtx.rotate(i * Math.PI * 0.5 + Math.PI * 0.25);
      drawCtx.beginPath();
      drawCtx.moveTo(0, -outer - 1);
      drawCtx.lineTo(0, -outer - 12);
      drawCtx.stroke();
      drawCtx.restore();
    }
    drawCtx.shadowBlur = 0;
  }

  const axis = outer + 19;
  const ray = clamp(outer * 0.68, 22, 54);
  drawCtx.globalAlpha = (0.42 + 0.35 * q) * breath;
  drawCtx.strokeStyle = color;
  drawCtx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    drawCtx.save();
    drawCtx.rotate(i * Math.PI * 0.5);
    drawCtx.beginPath();
    drawCtx.moveTo(-5, -axis);
    drawCtx.lineTo(0, -axis + 6);
    drawCtx.lineTo(5, -axis);
    drawCtx.stroke();
    drawCtx.setLineDash([2, 6]);
    drawCtx.lineDashOffset = -t * 18;
    drawCtx.beginPath();
    drawCtx.moveTo(0, -axis - 9);
    drawCtx.lineTo(0, -axis - ray);
    drawCtx.stroke();
    drawCtx.restore();
  }

  // Centralny zamek z projektu: obrys diamentu, wypelniony rdzen i 4 szewrony.
  drawCtx.setLineDash([]);
  drawCtx.globalAlpha = (0.62 + 0.38 * q) * breath;
  const d = ready ? 5.5 : 4.5;
  const d2 = d * 2;
  drawCtx.beginPath();
  drawCtx.moveTo(0, -d2);
  drawCtx.lineTo(d2, 0);
  drawCtx.lineTo(0, d2);
  drawCtx.lineTo(-d2, 0);
  drawCtx.closePath();
  targetingFillGlass(drawCtx, color, 0.16);
  targetingStrokeGlass(drawCtx, color, 1.5, 0.9);
  drawCtx.fillStyle = color;
  drawCtx.beginPath();
  drawCtx.moveTo(0, -d);
  drawCtx.lineTo(d, 0);
  drawCtx.lineTo(0, d);
  drawCtx.lineTo(-d, 0);
  drawCtx.closePath();
  drawCtx.fill();

  // Szewrony skaluja sie z celem — na duzym kadlubie musza odjechac od srodka.
  const chevron = clamp(outer * 0.42, 16, 60) + 7 * (1 - q);
  drawCtx.strokeStyle = color;
  drawCtx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    drawCtx.save();
    drawCtx.rotate(i * Math.PI * 0.5);
    drawCtx.beginPath();
    drawCtx.moveTo(-4, -chevron + 4);
    drawCtx.lineTo(0, -chevron);
    drawCtx.lineTo(4, -chevron + 4);
    drawCtx.stroke();
    drawCtx.restore();
  }
  drawCtx.restore();
  return ready;
}

// "Snap" po zlozeniu namiaru — echo rozchodzace sie na zewnatrz celownika.
export function drawTargetingSnapEcho(drawCtx, x, y, radius, fx, color = '#ffd27a', visualScale = 1, duration = TARGETING_READY_FX) {
  if (!(fx > 0)) return;
  const scale = targetingVisualScale(visualScale);
  const r = Math.max(0, Number(radius) || 0) / scale;
  const k = clamp(fx / Math.max(0.0001, duration), 0, 1);
  drawCtx.save();
  drawCtx.translate(x, y);
  drawCtx.scale(scale, scale);
  drawCtx.globalAlpha = k * 0.9;
  drawCtx.strokeStyle = color;
  drawCtx.shadowColor = color;
  drawCtx.shadowBlur = 8;
  drawCtx.lineWidth = 2;
  drawCtx.beginPath();
  drawCtx.arc(0, 0, r * (1 + (1 - k) * 0.7), 0, Math.PI * 2);
  drawCtx.stroke();
  drawCtx.restore();
}

// Cel ZATWIERDZONY: wolno obracany pierscien kreskowany + kreski osiowe.
export function drawTargetingLockRing(drawCtx, x, y, radius, color = '#ff4d5e', visualScale = 1) {
  const scale = targetingVisualScale(visualScale);
  const r = Math.max(0, Number(radius) || 0) / scale;
  const t = uiTime();
  drawCtx.save();
  drawCtx.translate(x, y);
  drawCtx.scale(scale, scale);
  drawCtx.strokeStyle = color;
  drawCtx.shadowColor = color;
  drawCtx.shadowBlur = 6;

  drawCtx.save();
  drawCtx.rotate(-t * 1.1);
  drawCtx.globalAlpha = 0.55;
  drawCtx.lineWidth = 1;
  drawCtx.setLineDash([4, 10]);
  drawCtx.beginPath();
  drawCtx.arc(0, 0, r + 9, 0, Math.PI * 2);
  drawCtx.stroke();
  drawCtx.restore();

  drawCtx.setLineDash([]);
  drawCtx.globalAlpha = 0.8;
  drawCtx.lineWidth = 1.4;
  drawCtx.beginPath();
  drawCtx.moveTo(0, -r - 5); drawCtx.lineTo(0, -r + 3);
  drawCtx.moveTo(0, r - 3); drawCtx.lineTo(0, r + 5);
  drawCtx.moveTo(-r - 5, 0); drawCtx.lineTo(-r + 3, 0);
  drawCtx.moveTo(r - 3, 0); drawCtx.lineTo(r + 5, 0);
  drawCtx.stroke();
  drawCtx.restore();
}

export function drawMultiTargetingFrame(drawCtx, cx, cy, width, height, angle, color, alpha = 0.95, visualScale = 1) {
  const scale = targetingVisualScale(visualScale);
  width = Math.max(1, Number(width) || 1) / scale;
  height = Math.max(1, Number(height) || 1) / scale;
  const x1 = -width * 0.5;
  const x2 = width * 0.5;
  const top = -height * 0.5;
  const bottom = height * 0.5;
  const shoulder = clamp(height * 0.18, 24, 68);
  const arm = clamp(width * 0.12, 28, 64);

  drawCtx.save();
  drawCtx.translate(cx, cy);
  drawCtx.rotate(angle);
  drawCtx.scale(scale, scale);
  drawCtx.globalAlpha = alpha;
  drawCtx.lineCap = 'square';
  drawCtx.lineJoin = 'miter';
  for (const side of [-1, 1]) {
    const x = side < 0 ? x1 : x2;
    const inward = -side;
    drawCtx.beginPath();
    drawCtx.moveTo(x + inward * arm, top);
    drawCtx.lineTo(x, top + shoulder);
    drawCtx.lineTo(x, bottom - shoulder);
    drawCtx.lineTo(x + inward * arm, bottom);
    targetingStrokeGlass(drawCtx, color, 4.6);

    drawCtx.globalAlpha = alpha * 0.66;
    drawCtx.beginPath();
    drawCtx.moveTo(x + inward * (arm + 10), top - 5);
    drawCtx.lineTo(x + inward * 8, top + shoulder - 2);
    drawCtx.lineTo(x + inward * 8, -height * 0.12);
    drawCtx.moveTo(x + inward * 8, height * 0.12);
    drawCtx.lineTo(x + inward * 8, bottom - shoulder + 2);
    drawCtx.lineTo(x + inward * (arm + 10), bottom + 5);
    targetingStrokeGlass(drawCtx, color, 1.8, 0.68);

    const glassW = clamp(width * 0.035, 8, 15);
    const glassH = clamp(height * 0.13, 18, 42);
    drawCtx.globalAlpha = alpha * 0.78;
    drawCtx.beginPath();
    drawCtx.moveTo(x, -glassH);
    drawCtx.lineTo(x + inward * glassW, -glassH + 4);
    drawCtx.lineTo(x + inward * glassW, glassH - 4);
    drawCtx.lineTo(x, glassH);
    drawCtx.closePath();
    targetingFillGlass(drawCtx, color, 0.13);

    drawCtx.globalAlpha = alpha * 0.82;
    drawCtx.fillStyle = color;
    const tip = x + inward * (arm + 2);
    drawCtx.beginPath();
    drawCtx.moveTo(tip, 0);
    drawCtx.lineTo(tip - inward * 11, -7);
    drawCtx.lineTo(tip - inward * 11, 7);
    drawCtx.closePath();
    drawCtx.fill();

    drawCtx.globalAlpha = alpha * 0.58;
    drawCtx.strokeStyle = color;
    drawCtx.lineWidth = 2.2;
    drawCtx.setLineDash([8, 6]);
    drawCtx.beginPath();
    drawCtx.moveTo(x + inward * (arm + 22), top + 5);
    drawCtx.lineTo(x + inward * (arm + 42), top - 20);
    drawCtx.moveTo(x + inward * (arm + 10), bottom - 5);
    drawCtx.lineTo(x + inward * (arm + 30), bottom + 24);
    drawCtx.stroke();
    drawCtx.setLineDash([]);
  }
  drawCtx.restore();
}

export function drawMultiTargetingNode(drawCtx, x, y, radius, progress, base = '#ffb648', accent = '#ffd27a', visualScale = 1) {
  const scale = targetingVisualScale(visualScale);
  radius = Math.max(0, Number(radius) || 0) / scale;
  const p = clamp(progress, 0, 1);
  const ready = p >= 1;
  const q = 1 - Math.pow(1 - p, 2.4);
  const color = ready ? accent : base;
  // Romb musi OBEJMOWAC cel. Stary sufit clamp(...,4,13) trzymal boks przy 13 px
  // niezaleznie od klasy okretu, wiec krazownik dostawal ten sam znacznik co dron.
  // Sufit ustawia juz _targetingScreenRadius (340 px ekranu), wiec tutaj romb
  // ma po prostu isc za rozmiarem celu; kurczenie sie limituje tylko od dolu.
  const size = Math.max(9, radius * 0.92) + (10 + Math.min(radius * 0.3, 60)) * (1 - q);
  const t = uiTime();
  drawCtx.save();
  drawCtx.translate(x, y);
  drawCtx.scale(scale, scale);
  drawCtx.rotate(Math.PI * 0.25);
  drawCtx.globalAlpha = 0.35 + 0.65 * q;
  drawCtx.beginPath();
  drawCtx.rect(-size, -size, size * 2, size * 2);
  targetingFillGlass(drawCtx, color, ready ? 0.18 : 0.09);
  targetingStrokeGlass(drawCtx, color, ready ? clamp(size * 0.06, 2.2, 5) : 1.5, 0.86);
  if (ready) {
    // Gotowy kontakt: pelne naroza + pulsujacy rdzen — widac go z drugiego konca ramki.
    const dot = clamp(size * 0.16, 3, 11);
    drawCtx.fillStyle = color;
    drawCtx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 5);
    drawCtx.fillRect(-dot, -dot, dot * 2, dot * 2);
    const notch = clamp(size * 0.34, 6, 34);
    drawCtx.globalAlpha = 0.95;
    drawCtx.strokeStyle = color;
    drawCtx.lineWidth = clamp(size * 0.08, 2.4, 6);
    drawCtx.beginPath();
    for (const [sx, sy] of TARGETING_CORNERS) {
      drawCtx.moveTo(sx * size, sy * size - sy * notch);
      drawCtx.lineTo(sx * size, sy * size);
      drawCtx.lineTo(sx * size - sx * notch, sy * size);
    }
    drawCtx.stroke();
  }
  drawCtx.restore();
  return ready;
}

export function drawSelectTargetingReticle(drawCtx, x, y, radius, progress, visualScale = 1) {
  const scale = targetingVisualScale(visualScale);
  radius = Math.max(0, Number(radius) || 0) / scale;
  const p = clamp(progress, 0, 1);
  const diamond = clamp(radius * 0.7, 8, 14);
  const gap = diamond + 5;
  const dash = clamp(radius * 0.55, 9, 20);

  drawCtx.save();
  drawCtx.translate(x, y);
  drawCtx.scale(scale, scale);
  drawCtx.globalAlpha = 0.45 + 0.2 * p;
  drawCtx.strokeStyle = '#ffffff';
  drawCtx.lineWidth = 1.5;
  drawCtx.lineCap = 'square';
  drawCtx.lineJoin = 'miter';

  drawCtx.save();
  drawCtx.rotate(Math.PI * 0.25);
  drawCtx.strokeRect(-diamond, -diamond, diamond * 2, diamond * 2);
  drawCtx.restore();

  drawCtx.beginPath();
  drawCtx.moveTo(-gap - dash, 0);
  drawCtx.lineTo(-gap, 0);
  drawCtx.moveTo(gap, 0);
  drawCtx.lineTo(gap + dash, 0);
  drawCtx.stroke();

  drawCtx.restore();
  return p >= 1;
}

export function drawSubTargetingReticle(drawCtx, x, y, radius, progress, base = '#ffb648', accent = '#ffd27a', visualScale = 1) {
  const scale = targetingVisualScale(visualScale);
  radius = Math.max(0, Number(radius) || 0) / scale;
  const p = clamp(progress, 0, 1);
  const ready = p >= 1;
  const q = 1 - Math.pow(1 - p, 2.4);
  const color = ready ? accent : base;
  const core = clamp(radius, 10, 28);
  const half = core + 9 * (1 - q);
  const arm = Math.max(7, core * 0.55);

  drawCtx.save();
  drawCtx.translate(x, y);
  drawCtx.scale(scale, scale);
  x = 0;
  y = 0;
  drawCtx.globalAlpha = 0.52 + 0.48 * q;
  drawCtx.lineCap = 'square';
  drawCtx.beginPath();
  for (const [sx, sy] of TARGETING_CORNERS) {
    const px = x + sx * half;
    const py = y + sy * half;
    drawCtx.moveTo(px - sx * arm, py);
    drawCtx.lineTo(px, py);
    drawCtx.lineTo(px, py - sy * arm);
  }
  targetingStrokeGlass(drawCtx, color, ready ? 2.1 : 1.6, 0.92);

  const guide = half + 10;
  drawCtx.strokeStyle = color;
  drawCtx.lineWidth = 1.5;
  drawCtx.beginPath();
  drawCtx.moveTo(x - guide - 5, y - 4);
  drawCtx.lineTo(x - guide, y);
  drawCtx.lineTo(x - guide - 5, y + 4);
  drawCtx.moveTo(x + guide + 5, y - 4);
  drawCtx.lineTo(x + guide, y);
  drawCtx.lineTo(x + guide + 5, y + 4);
  drawCtx.stroke();

  const box = ready ? 7 : 6;
  drawCtx.beginPath();
  drawCtx.rect(x - box, y - box, box * 2, box * 2);
  targetingFillGlass(drawCtx, color, 0.18);
  targetingStrokeGlass(drawCtx, color, 1.4, 0.9);
  drawCtx.fillStyle = color;
  drawCtx.beginPath();
  drawCtx.moveTo(x, y - 4);
  drawCtx.lineTo(x + 4, y);
  drawCtx.lineTo(x, y + 4);
  drawCtx.lineTo(x - 4, y);
  drawCtx.closePath();
  drawCtx.fill();
  drawCtx.restore();
  return ready;
}
