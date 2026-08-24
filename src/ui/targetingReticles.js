// Rysowanie celownikow: SINGLE (pojedynczy cel), MULTI (ramka + wezly)
// i SUB (namiar na podzespol). Czysty canvas 2D — funkcje dostaja kontekst
// i wspolrzedne ekranowe, nie znaja stanu gry.
import { targetingVisualScale } from '../game/targetingModes.js';
import { GameState } from '../game/gameState.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TARGETING_CORNERS = Object.freeze([[-1, -1], [1, -1], [1, 1], [-1, 1]]);

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
  const breath = ready ? (0.84 + 0.16 * Math.sin(GameState.gameTime * 6)) : 1;
  const outer = Math.max(24, radius + 12) + 24 * (1 - q);
  const inner = Math.max(9, outer * 0.38);
  const bevel = clamp(outer * 0.14, 3, 9);

  drawCtx.save();
  drawCtx.translate(x, y);
  drawCtx.scale(scale, scale);
  x = 0;
  y = 0;
  drawCtx.lineCap = 'square';
  drawCtx.lineJoin = 'miter';
  drawCtx.globalAlpha = (0.5 + 0.5 * q) * breath;
  drawCtx.beginPath();
  for (const [sx, sy] of TARGETING_CORNERS) traceTargetingCorner(drawCtx, x, y, sx, sy, outer, inner, bevel);
  targetingStrokeGlass(drawCtx, color, ready ? 2.8 : 2.1);

  drawCtx.globalAlpha *= 0.62;
  drawCtx.beginPath();
  for (const [sx, sy] of TARGETING_CORNERS) traceTargetingCorner(drawCtx, x, y, sx, sy, outer + 9, inner + 6, bevel);
  drawCtx.strokeStyle = color;
  drawCtx.lineWidth = 1.1;
  drawCtx.stroke();

  const axis = outer + 19;
  const ray = clamp(outer * 0.68, 22, 54);
  drawCtx.globalAlpha = (0.42 + 0.35 * q) * breath;
  drawCtx.strokeStyle = color;
  drawCtx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    drawCtx.save();
    drawCtx.translate(x, y);
    drawCtx.rotate(i * Math.PI * 0.5);
    drawCtx.beginPath();
    drawCtx.moveTo(-5, -axis);
    drawCtx.lineTo(0, -axis + 6);
    drawCtx.lineTo(5, -axis);
    drawCtx.stroke();
    drawCtx.setLineDash([2, 6]);
    drawCtx.lineDashOffset = -GameState.gameTime * 18;
    drawCtx.beginPath();
    drawCtx.moveTo(0, -axis - 9);
    drawCtx.lineTo(0, -axis - ray);
    drawCtx.stroke();
    drawCtx.restore();
  }

  drawCtx.setLineDash([]);
  drawCtx.globalAlpha = (0.62 + 0.38 * q) * breath;
  const diamond = ready ? 11 : 9;
  drawCtx.beginPath();
  drawCtx.moveTo(x, y - diamond);
  drawCtx.lineTo(x + diamond, y);
  drawCtx.lineTo(x, y + diamond);
  drawCtx.lineTo(x - diamond, y);
  drawCtx.closePath();
  targetingFillGlass(drawCtx, color, 0.16);
  targetingStrokeGlass(drawCtx, color, 1.5, 0.9);
  drawCtx.fillStyle = color;
  drawCtx.beginPath();
  drawCtx.moveTo(x, y - 4.5);
  drawCtx.lineTo(x + 4.5, y);
  drawCtx.lineTo(x, y + 4.5);
  drawCtx.lineTo(x - 4.5, y);
  drawCtx.closePath();
  drawCtx.fill();
  drawCtx.restore();
  return ready;
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
  const size = clamp(radius * 0.3, 4, 13) + 10 * (1 - q);
  drawCtx.save();
  drawCtx.translate(x, y);
  drawCtx.scale(scale, scale);
  drawCtx.rotate(Math.PI * 0.25);
  drawCtx.globalAlpha = 0.35 + 0.65 * q;
  drawCtx.beginPath();
  drawCtx.rect(-size, -size, size * 2, size * 2);
  targetingFillGlass(drawCtx, color, ready ? 0.18 : 0.09);
  targetingStrokeGlass(drawCtx, color, ready ? 2 : 1.5, 0.86);
  if (ready) {
    drawCtx.fillStyle = color;
    drawCtx.fillRect(-2.5, -2.5, 5, 5);
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
