// HUD kursu warpa. Kąty ekranowe dostaje po rzucie worldToScreen (także kamery 3D).
// Warp zawsze do celu (DECYZJE-2 T1): każdy skok ma punkt wyjścia — kurs TRAVEL TO (±5°), cel w stożku ±20° albo skok
// awaryjny (s.jumpKind: 'course' | 'cone' | 'emergency'); podpis s.label = cel skoku. Kurs w stożku ±20° (s.inCone) też
// daje skok kursem (komputer dociąga dziób w ładowaniu) — zielone pasmo ±5° zostaje jako „kurs OK”. Odcinek napędem ze
// studni startu do jej brzegu (s.wellExit — BRIEF-studnie: start skoku w studni planety zablokowany) — „WYLEĆ NAPĘDEM”.
//
// BEZ RAMKI U GÓRY EKRANU (2026-11-11, decyzja użytkownika: „usuń ten box — nie podoba mi się; informacje o warp
// (streszczone) przerzuć na kursor myszy — on jest centralnym miejscem wyświetlania informacji”). Przy statku zostają
// pasmo ±5°, grot namiaru, kreska dzioba i punkt zatrzymania (drawWarpCourseHud); stan skoku — dwie linie pod
// celownikiem (warpCursorLines → drawWarpCursorInfo, klej: `_drawCursorDriveInfo` w index.html). Ładowanie skoku
// pokazuje koło na pierścieniu celownika (src/ui/cursorChargeRing.js).
import { formatLocalDistance } from '../config/units.js';

const GREEN = '#75efb0', AMBER = '#ffc978', RED = '#ff897e';
const DETAIL = '#c0d3df';
const fmt1 = (v) => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
const deg = (rad) => fmt1(Math.abs(rad * 180 / Math.PI));

function warpCourseBusy(s) {
  return s.state === 'charging' || s.state === 'active' || !!s.exiting;
}

/** Barwa stanu: zielona — kurs OK / wyjście automatyczne, czerwona — skok bez automatu, bursztynowa — reszta. */
export function warpCourseColor(s) {
  const busy = warpCourseBusy(s);
  const good = busy ? s.autoExit : s.aligned && s.canWarp;
  return good ? GREEN : (busy ? RED : AMBER);
}

/**
 * Streszczenie stanu skoku pod celownik: `out.status` (linia w barwie stanu), `out.detail` (cel i odległość),
 * `out.color`. Zwraca `out`.
 */
export function warpCursorLines(s, out) {
  const busy = warpCourseBusy(s);
  out.color = warpCourseColor(s);
  let st;
  if (s.exiting) st = 'WARP · HAMOWANIE';
  else if (s.state === 'charging') st = s.autoExit ? 'WARP · ŁADOWANIE · AUTO' : 'WARP · ŁADOWANIE · RĘCZNE';
  else if (s.state === 'active') {
    if (s.autoExit) st = `WARP · WYJŚCIE ZA ${fmt1(Math.max(0, s.exitIn))} s`;
    else if (s.along <= 0) st = 'WARP · CEL ZA STATKIEM';
    else if (s.exitIn < -0.15) st = 'WARP · ZA PÓŹNO';
    else if (s.exitIn <= 0.15) st = 'WYJDŹ TERAZ · CAPS';
    else st = `WARP · WYJŚCIE ZA ${fmt1(s.exitIn)} s · CAPS`;
  } else if (!s.canWarp) {
    st = s.wellExit ? 'STUDNIA · WYLEĆ NAPĘDEM' : (s.detour ? 'OBJAZD STUDNI · NAPĘDEM' : 'BLISKO CELU · NAPĘDEM');
  } else if (s.aligned) st = 'WARP · KURS OK · CAPS';
  else if (s.inCone) st = s.err < 0 ? `← ${deg(s.err)}° · CAPS: SKOK KURSEM` : `CAPS: SKOK KURSEM · ${deg(s.err)}° →`;
  else st = s.err < 0 ? `← A ${deg(s.err)}° DO KURSU` : `DO KURSU ${deg(s.err)}° D →`;
  out.status = st;
  const label = s.label || 'PUNKT KURSU';
  if (s.exiting) out.detail = label;
  else if (busy && !s.autoExit) out.detail = `${label} · MINIĘCIE ${formatLocalDistance(s.miss)}`;
  else if (busy) out.detail = `${label} · ${formatLocalDistance(Math.max(0, s.along))}`;
  else out.detail = `${label} · ${formatLocalDistance(s.dist)}`;
  return out;
}

/** Dwie linie stanu skoku wyśrodkowane na x; y — linia bazowa pierwszej. */
export function drawWarpCursorInfo(ctx, x, y, lines, scale = 1) {
  const s = Math.max(0.6, Number(scale) || 1);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 4;
  const maxW = 300 * s;
  ctx.font = `600 ${Math.round(12 * s)}px Consolas, monospace`;
  ctx.fillStyle = lines.color;
  ctx.fillText(lines.status, x, y, maxW);
  ctx.font = `${Math.round(11 * s)}px Consolas, monospace`;
  ctx.fillStyle = DETAIL;
  ctx.fillText(lines.detail, x, y + 14 * s, maxW);
  ctx.restore();
}

/** Przy statku: pasmo ±5°, grot namiaru, kreska dzioba, przewidywany punkt zatrzymania. */
export function drawWarpCourseHud(ctx, s) {
  const busy = warpCourseBusy(s);
  const color = warpCourseColor(s);
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  // Dziób (biały grot), punkt kursu (kolorowy grot) i pasmo tolerancji ±5°.
  const r = s.radius;
  if (s.shipX > s.clipX + r && s.shipX < s.clipX + s.clipW - r && s.shipY > r && s.shipY < s.height - r) {
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(s.shipX, s.shipY, r, s.bearingScreen - 0.0873, s.bearingScreen + 0.0873);
    ctx.lineWidth = 5 * s.scale;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    const delta = Math.atan2(Math.sin(s.bearingScreen - s.headingScreen), Math.cos(s.bearingScreen - s.headingScreen));
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(s.shipX, s.shipY, r, s.headingScreen, s.headingScreen + delta, delta < 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(s.shipX, s.shipY);
    ctx.rotate(s.bearingScreen);
    ctx.beginPath();
    ctx.moveTo(r + 12 * s.scale, 0);
    ctx.lineTo(r - 2 * s.scale, -6 * s.scale);
    ctx.lineTo(r - 2 * s.scale, 6 * s.scale);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#ecf7ff';
    ctx.beginPath();
    ctx.moveTo(s.shipX + Math.cos(s.headingScreen) * (r - 8), s.shipY + Math.sin(s.headingScreen) * (r - 8));
    ctx.lineTo(s.shipX + Math.cos(s.headingScreen) * (r + 8), s.shipY + Math.sin(s.headingScreen) * (r + 8));
    ctx.stroke();
  }
  // Przewidywany punkt zatrzymania: przy ładowaniu najbliższe podejście, w locie koniec rampy.
  if (busy && s.previewX > s.clipX + 12 && s.previewX < s.clipX + s.clipW - 12
    && s.previewY > 12 && s.previewY < s.height - 120) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(s.previewX, s.previewY, 9, 0, Math.PI * 2);
    ctx.moveTo(s.previewX - 14, s.previewY); ctx.lineTo(s.previewX + 14, s.previewY);
    ctx.moveTo(s.previewX, s.previewY - 14); ctx.lineTo(s.previewX, s.previewY + 14);
    ctx.stroke();
  }
  ctx.restore();
}
