// Ramki celów na kanwie: celownik celu (narożniki) i pierścień namiaru — cele priorytetowe (T / U)
// i wróg przy kursorze. Celownik broni gracza to osobny moduł (src/ui/weaponReticle.js); dawne
// celowniki MULTI / SUB / SELECT usunięte 2026-10-03. Czysty canvas 2D — funkcje dostają kontekst
// i współrzędne ekranowe, nie znają stanu gry.
import { targetingVisualScale } from '../game/targetingModes.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TARGETING_CORNERS = Object.freeze([[-1, -1], [1, -1], [1, 1], [-1, 1]]);

// Animacje celownika chodza w czasie RZECZYWISTYM. GameState.gameTime biegnie
// z TIME_SCALE = 60, wiec oddech i kreskowanie leciały 60x za szybko.
const uiTime = () => performance.now() / 1000;

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

