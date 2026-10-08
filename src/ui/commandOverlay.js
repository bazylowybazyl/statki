// Nakładki dowodzenia w świecie gry (kanwa 2D, px ekranu) w języku HUD kokpitu (kopuła klastra,
// radar — cockpit-ui.css, cicDisplay.js): cienkie linie, kropki i narożniki zamiast neonowych,
// pulsujących strzałek i pełnych kółek. Kolory z palety HUD: sojusznik / wróg jak na radarze,
// rodzaj rozkazu własnym akcentem. Tu jest SAM rysunek — stan zaznaczenia, trafienia w menu
// (hitTestCommandMenu) i geometria rozkazów (computeCommandVisual) zostają w index.html
// i src/game/worldCommandMenu.js.

// Trójki RGB (alfa dokładana w miejscu użycia).
export const COMMAND_RGB = Object.freeze({
  move: '92, 200, 255',
  movePlayer: '159, 220, 255',
  attack: '255, 74, 74',
  approach: '61, 220, 150',
  ram: '255, 179, 71',
  orbit: '181, 140, 255',
  scan: '120, 205, 255',
  salvage: '255, 196, 120',
  selection: '92, 200, 255',
  hover: '190, 215, 235',
  neutral: '200, 208, 216',
  accent: '255, 102, 0'
});

const TAU = Math.PI * 2;
const HULL_OK = '#3ddc84';
const HULL_WARN = '#ffb347';
const HULL_CRIT = '#ff4a4a';
const SHIELD_FILL = '#5ca8ff';

export function commandRgbFor(type, { player = false, targetEntity = false } = {}) {
  switch (String(type || '').toLowerCase()) {
    case 'orbit': return COMMAND_RGB.orbit;
    case 'ram': return COMMAND_RGB.ram;
    case 'approach': return COMMAND_RGB.approach;
    case 'attack':
    case 'attack-move': return targetEntity ? COMMAND_RGB.attack : (player ? COMMAND_RGB.movePlayer : COMMAND_RGB.move);
    default: return player ? COMMAND_RGB.movePlayer : COMMAND_RGB.move;
  }
}

// Grot „›” w (x, y) skierowany wzdłuż (ux, uy).
function strokeChevron(ctx, x, y, ux, uy, size) {
  const nx = -uy;
  const ny = ux;
  ctx.beginPath();
  ctx.moveTo(x - ux * size * 0.55 + nx * size * 0.8, y - uy * size * 0.55 + ny * size * 0.8);
  ctx.lineTo(x + ux * size * 0.45, y + uy * size * 0.45);
  ctx.lineTo(x - ux * size * 0.55 - nx * size * 0.8, y - uy * size * 0.55 - ny * size * 0.8);
  ctx.stroke();
}

/**
 * Ścieżka rozkazu: ledwie widoczny tor i kropki płynące ku celowi (gęstnieją przy celu),
 * grot w połowie drogi — kierunek widać też na stopklatce.
 * opts: { time (s), alpha, startGap, endGap (px), spacing, dot, speed, chevron }
 */
export function drawCommandPath(ctx, x0, y0, x1, y1, rgb, opts = {}) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 6)) return;
  const ux = dx / len;
  const uy = dy / len;
  const startGap = Math.min(len * 0.45, Math.max(0, Number(opts.startGap) || 0));
  const endGap = Math.min(len * 0.45, Math.max(0, Number(opts.endGap) || 0));
  const sx = x0 + ux * startGap;
  const sy = y0 + uy * startGap;
  const ex = x1 - ux * endGap;
  const ey = y1 - uy * endGap;
  const alpha = opts.alpha == null ? 1 : Math.max(0, Math.min(1, Number(opts.alpha) || 0));
  const spacing = Number(opts.spacing) || 11;
  const time = Number(opts.time) || 0;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(${rgb}, ${0.15 * alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  const fade = ctx.createLinearGradient(sx, sy, ex, ey);
  fade.addColorStop(0, `rgba(${rgb}, ${0.22 * alpha})`);
  fade.addColorStop(1, `rgba(${rgb}, ${0.95 * alpha})`);
  ctx.strokeStyle = fade;
  ctx.lineWidth = Number(opts.dot) || 2.4;
  ctx.setLineDash([0.001, spacing]);
  ctx.lineDashOffset = -((time * (Number(opts.speed) || 24)) % spacing);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);

  const pathLen = len - startGap - endGap;
  if (opts.chevron !== false && pathLen > 90) {
    const mid = 0.5 * pathLen;
    ctx.strokeStyle = `rgba(${rgb}, ${0.9 * alpha})`;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    strokeChevron(ctx, sx + ux * mid, sy + uy * mid, ux, uy, 6);
  }
  ctx.restore();
}

/**
 * Punkt docelowy: pierścień z ciemnym podkładem, kropka i cztery kreski jak w celowniku;
 * opcjonalnie strefa dojścia (areaRadius, px) — blade koło z przerywanym brzegiem.
 */
export function drawWaypointMarker(ctx, x, y, rgb, opts = {}) {
  const alpha = opts.alpha == null ? 1 : Number(opts.alpha) || 0;
  const r = Number(opts.radius) || 6;
  const area = Number(opts.areaRadius) || 0;
  ctx.save();
  if (area > r + 8) {
    ctx.fillStyle = `rgba(${rgb}, ${0.05 * alpha})`;
    ctx.strokeStyle = `rgba(${rgb}, ${0.3 * alpha})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.arc(x, y, area, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = `rgba(0, 0, 0, ${0.5 * alpha})`;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = `rgba(${rgb}, ${0.95 * alpha})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.moveTo(x, y - r - 3);
  ctx.lineTo(x, y - r - 7);
  ctx.moveTo(x, y + r + 3);
  ctx.lineTo(x, y + r + 7);
  ctx.moveTo(x - r - 3, y);
  ctx.lineTo(x - r - 7, y);
  ctx.moveTo(x + r + 3, y);
  ctx.lineTo(x + r + 7, y);
  ctx.stroke();
  ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
  ctx.beginPath();
  ctx.arc(x, y, 1.7, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Cel rozkazu na jednostce (atak, podejście, taran): romb jak kontakt na radarze. */
export function drawTargetDiamond(ctx, x, y, rgb, size = 6, alpha = 1) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.fillStyle = `rgba(${rgb}, ${0.22 * alpha})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(0, 0, 0, ${0.5 * alpha})`;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = `rgba(${rgb}, ${0.95 * alpha})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** Strefa dojścia wokół celu (dystans podejścia / taranu), kropkowany pierścień. */
export function drawArrivalRing(ctx, x, y, r, rgb, alpha = 1) {
  if (!(r > 10)) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(${rgb}, ${0.5 * alpha})`;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([0.001, 8]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * Orbita: kropkowany okrąg płynący w kierunku obiegu i trzy grot krążące po nim;
 * dir = +1 zgodnie ze wskazówkami (oś y w dół), −1 przeciwnie.
 */
export function drawOrbitGuide(ctx, cx, cy, r, dir, rgb, opts = {}) {
  if (!(r > 4)) return;
  const time = Number(opts.time) || 0;
  const alpha = opts.alpha == null ? 1 : Number(opts.alpha) || 0;
  const sign = dir >= 0 ? 1 : -1;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(${rgb}, ${0.14 * alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = `rgba(${rgb}, ${0.6 * alpha})`;
  ctx.lineWidth = 2.2;
  ctx.setLineDash([0.001, 10]);
  ctx.lineDashOffset = -sign * ((time * 18) % 10);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = `rgba(${rgb}, ${0.95 * alpha})`;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  const phase = time * 0.35 * sign;
  for (let k = 0; k < 3; k++) {
    const a = phase + k * (TAU / 3);
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    strokeChevron(ctx, px, py, -Math.sin(a) * sign, Math.cos(a) * sign, 6.5);
  }
  ctx.restore();
}

/**
 * Zaznaczona jednostka: prostokąt opisany na kadłubie — narożniki L z ciemnym podkładem i blady
 * pełny obrys (jak ramka zaznaczania). (x0, y0)–(x1, y1) px ekranu; opts.grow — odsunięcie
 * narożników na zewnątrz (animacja zaciśnięcia przy zaznaczeniu i rozejścia przy wygaszaniu).
 */
export function drawSelectionFrame(ctx, x0, y0, x1, y1, rgb, opts = {}) {
  const alpha = opts.alpha == null ? 1 : Math.max(0, Math.min(1, Number(opts.alpha) || 0));
  if (alpha <= 0.002) return;
  const grow = Number(opts.grow) || 0;
  const left = Math.round(Math.min(x0, x1) - grow) + 0.5;
  const top = Math.round(Math.min(y0, y1) - grow) + 0.5;
  const right = Math.round(Math.max(x0, x1) + grow) + 0.5;
  const bottom = Math.round(Math.max(y0, y1) + grow) + 0.5;
  const w = right - left;
  const h = bottom - top;
  const arm = Math.max(5, Math.min(14, w * 0.28, h * 0.28));
  const width = Number(opts.width) || 2;
  ctx.save();
  if (opts.outline !== false) {
    ctx.strokeStyle = `rgba(${rgb}, ${0.14 * alpha})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, w, h);
  }
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(left, top + arm); ctx.lineTo(left, top); ctx.lineTo(left + arm, top);
  ctx.moveTo(right - arm, top); ctx.lineTo(right, top); ctx.lineTo(right, top + arm);
  ctx.moveTo(right, bottom - arm); ctx.lineTo(right, bottom); ctx.lineTo(right - arm, bottom);
  ctx.moveTo(left + arm, bottom); ctx.lineTo(left, bottom); ctx.lineTo(left, bottom - arm);
  ctx.strokeStyle = `rgba(0, 0, 0, ${0.5 * alpha})`;
  ctx.lineWidth = width + 2.2;
  ctx.stroke();
  ctx.strokeStyle = `rgba(${rgb}, ${0.95 * alpha})`;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

// Podpis zaznaczenia biegnie po przekątnej od narożnika ramki, stałym kątem (podpisy floty równoległe).
const SELECTION_LABEL_ANGLE = 0.56;
const SELECTION_LABEL_COS = Math.cos(SELECTION_LABEL_ANGLE);
const SELECTION_LABEL_SIN = Math.sin(SELECTION_LABEL_ANGLE);
// Kolejne próby układu: dłuższa kreska wyprowadzenia i cztery narożniki (w górę-prawo pierwszy).
const SELECTION_LABEL_GAPS = Object.freeze([10, 30, 52, 80, 120, 180]);
const SELECTION_LABEL_DIRS = Object.freeze([[1, -1], [-1, -1], [1, 1], [-1, 1]]);
// Pół grubości pasa podpisu w poprzek kreski (tytuł nad nią, masa pod nią) i margines ekranu.
const SELECTION_LABEL_HALF = 13;
const SELECTION_LABEL_MARGIN = 8;
const SELECTION_LABEL_TITLE_FONT = '700 10px Consolas, "Courier New", monospace';
const SELECTION_LABEL_SUB_FONT = '10px Consolas, "Courier New", monospace';

function setLetterSpacing(ctx, value) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = value;
}

/** Długość podpisu wzdłuż kreski (px) — do układu i rysunku. */
export function measureSelectionLabel(ctx, title, sub) {
  const titleText = String(title || '');
  const subText = String(sub || '');
  if (!titleText && !subText) return 0;
  ctx.save();
  ctx.font = SELECTION_LABEL_TITLE_FONT;
  setLetterSpacing(ctx, '1px');
  const titleW = titleText ? ctx.measureText(titleText).width : 0;
  ctx.font = SELECTION_LABEL_SUB_FONT;
  setLetterSpacing(ctx, '0.6px');
  const subW = subText ? ctx.measureText(subText).width : 0;
  ctx.restore();
  return Math.max(titleW, subW) + 4;
}

// Czworokąt pasa podpisu (8 liczb: x, y × 4) dla narożnika (sx, sy) ramki, kreski gap i długości len.
function selectionLabelQuad(frame, sx, sy, gap, len) {
  const cx = sx > 0 ? frame.x1 : frame.x0;
  const cy = sy < 0 ? frame.y0 : frame.y1;
  const dx = sx * SELECTION_LABEL_COS;
  const dy = sy * SELECTION_LABEL_SIN;
  const nx = -dy * SELECTION_LABEL_HALF;
  const ny = dx * SELECTION_LABEL_HALF;
  const ax = cx + dx * gap;
  const ay = cy + dy * gap;
  const bx = cx + dx * (gap + len);
  const by = cy + dy * (gap + len);
  return [ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny];
}

function rectQuad(x0, y0, x1, y1) {
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

// SAT dla dwóch czworokątów wypukłych (prostokąty obrócone / osiowe).
function quadsOverlap(a, b) {
  for (const q of [a, b]) {
    for (let e = 0; e < 2; e++) {
      const ax = q[e * 2 + 2] - q[e * 2];
      const ay = q[e * 2 + 3] - q[e * 2 + 1];
      let minA = Infinity; let maxA = -Infinity; let minB = Infinity; let maxB = -Infinity;
      for (let k = 0; k < 8; k += 2) {
        const pa = -ay * a[k] + ax * a[k + 1];
        const pb = -ay * b[k] + ax * b[k + 1];
        if (pa < minA) minA = pa; if (pa > maxA) maxA = pa;
        if (pb < minB) minB = pb; if (pb > maxB) maxB = pb;
      }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

function quadInView(q, viewW, viewH) {
  for (let k = 0; k < 8; k += 2) {
    if (q[k] < SELECTION_LABEL_MARGIN || q[k] > viewW - SELECTION_LABEL_MARGIN) return false;
    if (q[k + 1] < SELECTION_LABEL_MARGIN || q[k + 1] > viewH - SELECTION_LABEL_MARGIN) return false;
  }
  return true;
}

/**
 * Układ podpisów zaznaczenia bez nachodzenia. entries: [{ x0, y0, x1, y1, len, prev }] w kolejności
 * ważności; każdy wpis z len > 0 dostaje `place` = { sx, sy, gap }: najpierw poprzednie miejsce
 * (podpis nie skacze przy ruchu), potem narożniki i dłuższe kreski — pierwsze, które mieści się
 * w ekranie i nie przecina ułożonych już podpisów ani cudzych ramek. Bez wolnego miejsca: poprzednie
 * albo domyślne (w górę-prawo). Ramki wpisów bez podpisu też są przeszkodą; opcjonalne blockedRects
 * [{ x0, y0, x1, y1 }] rezerwują miejsca zajęte przez panele HUD.
 * opts: { maxGap — najdłuższa kreska wyprowadzenia (px; dłuższe miejsca, także poprzednie, odpadają),
 * drop — bez wolnego miejsca podpis nie dostaje `place` (zostaje sama ramka); true albo funkcja (wpis) → bool }.
 */
export function layoutSelectionLabels(entries, viewW = Infinity, viewH = Infinity, blockedRects = [], opts = null) {
  const maxGap = Number(opts?.maxGap) > 0 ? Number(opts.maxGap) : Infinity;
  const drop = opts?.drop || false;
  const frames = entries.map((e) => rectQuad(e.x0 - 3, e.y0 - 3, e.x1 + 3, e.y1 + 3));
  for (const r of blockedRects || []) frames.push(rectQuad(r.x0, r.y0, r.x1, r.y1));
  const placed = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    entry.place = null;
    if (!(entry.len > 0)) continue;
    let chosen = null;
    let chosenQuad = null;
    const tryPlace = (sx, sy, gap) => {
      const quad = selectionLabelQuad(entry, sx, sy, gap, entry.len);
      if (!quadInView(quad, viewW, viewH)) return false;
      for (const other of placed) if (quadsOverlap(quad, other)) return false;
      for (let j = 0; j < frames.length; j++) if (j !== i && quadsOverlap(quad, frames[j])) return false;
      chosen = { sx, sy, gap };
      chosenQuad = quad;
      return true;
    };
    const prev = entry.prev && entry.prev.gap <= maxGap ? entry.prev : null;
    let found = !!prev && tryPlace(prev.sx, prev.sy, prev.gap);
    for (let g = 0; !found && g < SELECTION_LABEL_GAPS.length && SELECTION_LABEL_GAPS[g] <= maxGap; g++) {
      for (let d = 0; !found && d < SELECTION_LABEL_DIRS.length; d++) {
        found = tryPlace(SELECTION_LABEL_DIRS[d][0], SELECTION_LABEL_DIRS[d][1], SELECTION_LABEL_GAPS[g]);
      }
    }
    if (!found && (typeof drop === 'function' ? drop(entry) : drop)) continue;
    if (!found) {
      chosen = prev ? { sx: prev.sx, sy: prev.sy, gap: prev.gap } : { sx: 1, sy: -1, gap: SELECTION_LABEL_GAPS[0] };
      chosenQuad = selectionLabelQuad(entry, chosen.sx, chosen.sy, chosen.gap, entry.len);
    }
    entry.place = chosen;
    placed.push(chosenQuad);
  }
  return entries;
}

/**
 * Podpis jednostki po przekątnej: kreska wyprowadzenia z narożnika ramki (opts.place — wynik
 * layoutSelectionLabels; domyślnie prawy górny narożnik w górę-prawo), nad nią `title`
 * (nazwa · klasa), pod nią `sub` (masa). opts: { alpha, grow, place }
 */
export function drawSelectionLabel(ctx, x0, y0, x1, y1, title, sub, rgb, opts = {}) {
  const alpha = opts.alpha == null ? 1 : Math.max(0, Math.min(1, Number(opts.alpha) || 0));
  if (alpha <= 0.002 || (!title && !sub)) return;
  const grow = Number(opts.grow) || 0;
  const place = opts.place || { sx: 1, sy: -1, gap: SELECTION_LABEL_GAPS[0] };
  const sx = place.sx < 0 ? -1 : 1;
  const sy = place.sy > 0 ? 1 : -1;
  const gap = Number(place.gap) || SELECTION_LABEL_GAPS[0];
  const cornerX = sx > 0 ? Math.max(x0, x1) + grow : Math.min(x0, x1) - grow;
  const cornerY = sy < 0 ? Math.min(y0, y1) - grow : Math.max(y0, y1) + grow;
  const dx = sx * SELECTION_LABEL_COS;
  const dy = sy * SELECTION_LABEL_SIN;
  const titleText = String(title || '');
  const subText = String(sub || '');
  const reach = gap + measureSelectionLabel(ctx, titleText, subText);

  ctx.save();
  // Kreska wyprowadzenia od narożnika i podkreślenie pod tekstem — jedna linia po przekątnej.
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(0, 0, 0, ${0.45 * alpha})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cornerX + dx * 2, cornerY + dy * 2);
  ctx.lineTo(cornerX + dx * reach, cornerY + dy * reach);
  ctx.stroke();
  ctx.strokeStyle = `rgba(${rgb}, ${0.8 * alpha})`;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Tekst obrócony wzdłuż kreski, zawsze czytelny od lewej do prawej.
  const reversed = dx < 0;
  const phi = Math.atan2(dy, dx) + (reversed ? Math.PI : 0);
  ctx.translate(cornerX + dx * gap, cornerY + dy * gap);
  ctx.rotate(phi);
  ctx.textAlign = reversed ? 'right' : 'left';
  const tx = reversed ? -2 : 2;
  ctx.lineJoin = 'round';
  if (titleText) {
    ctx.font = SELECTION_LABEL_TITLE_FONT;
    setLetterSpacing(ctx, '1px');
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = `rgba(3, 5, 8, ${0.75 * alpha})`;
    ctx.lineWidth = 3;
    ctx.strokeText(titleText, tx, -4);
    ctx.fillStyle = `rgba(232, 244, 255, ${alpha})`;
    ctx.fillText(titleText, tx, -4);
  }
  if (subText) {
    ctx.font = SELECTION_LABEL_SUB_FONT;
    setLetterSpacing(ctx, '0.6px');
    ctx.textBaseline = 'top';
    ctx.strokeStyle = `rgba(3, 5, 8, ${0.75 * alpha})`;
    ctx.lineWidth = 3;
    ctx.strokeText(subText, tx, 4);
    ctx.fillStyle = `rgba(${rgb}, ${0.9 * alpha})`;
    ctx.fillText(subText, tx, 4);
  }
  ctx.restore();
}

// Nazwy kadłubów Terra Nova z wezwań (rezerwa kokpitu) — okręty wsparcia nie mają własnych imion.
const TERRAN_HULL_NAMES = Object.freeze({
  frigate_pd: 'Custos',
  frigate_laser: 'Custos-L',
  destroyer: 'Hasta',
  battleship: 'Bellator',
  carrier: 'Citadella',
  supercapital: 'Colossus'
});

export function unitClassLabel(typeKey, unit = null) {
  const key = String(typeKey || '').toLowerCase();
  if (key.includes('supercapital') || key.includes('atlas')) return 'SUPERCAPITAL';
  if (key.includes('carrier')) return 'LOTNISKOWIEC';
  if (key.includes('battleship')) return 'PANCERNIK';
  if (key.includes('destroyer')) return 'NISZCZYCIEL';
  if (key.includes('frigate_laser')) return 'FREGATA LASEROWA';
  if (key.includes('frigate') || key.includes('custos')) return 'FREGATA';
  if (key.includes('fighter') || key.includes('interceptor')) return 'MYŚLIWIEC';
  if (key.includes('freighter') || key.includes('tanker') || key.includes('container')) return 'FRACHTOWIEC';
  return unit?.isCapitalShip ? 'OKRĘT' : 'JEDNOSTKA';
}

/** Masa gry w tonach: „50 000 t”, od miliona „1,2 Mt”. */
export function formatUnitMass(mass) {
  const value = Number(mass);
  if (!(value > 0)) return '';
  if (value >= 1e6) return `${(value / 1e6).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} Mt`;
  return `${Math.round(value).toLocaleString('pl-PL')} t`;
}

/**
 * Sam tytuł podpisu jednostki („BELLATOR · PANCERNIK”), bez masy. Radar kokpitu i skan X pytają o niego dla
 * każdego kontaktu (~10 Hz × setki okrętów) — `formatUnitMass` (toLocaleString) kosztował tam ~0,7 ms/klatkę.
 * opts: { name, typeKey } — jak describeSelectedUnit.
 */
export function describeUnitTitle(unit, opts = null) {
  const typeKey = String(opts?.typeKey || unit?.callInTemplateKey || unit?.type || '').toLowerCase();
  const cls = unitClassLabel(typeKey, unit);
  let name = String(opts?.name || unit?.displayName || '').trim();
  if (!name && typeof unit?.name === 'string' && unit.name.trim() && unit.name.trim().toLowerCase() !== typeKey) name = unit.name.trim();
  if (!name && unit?.friendly && !unit?.isPirate) name = TERRAN_HULL_NAMES[unit?.callInTemplateKey || typeKey] || '';
  return name && name.toUpperCase() !== cls ? `${name.toUpperCase()} · ${cls}` : cls;
}

/**
 * Podpis zaznaczonej jednostki: { title: „BELLATOR · PANCERNIK”, sub: „MASA 50 000 t” }.
 * opts: { name, typeKey } — nadpisania (statek gracza: nazwa i id kadłuba z katalogu).
 */
export function describeSelectedUnit(unit, opts = {}) {
  const title = describeUnitTitle(unit, opts);
  const mass = formatUnitMass(unit?.mass);
  return { title, sub: mass ? `MASA ${mass}` : '' };
}

function hullColor(frac) {
  return frac > 0.6 ? HULL_OK : frac > 0.3 ? HULL_WARN : HULL_CRIT;
}

/**
 * Paski stanu nad jednostką: tarcza (opcjonalna) i kadłub, 3 px, na ciemnej podkładce.
 * (x, y) = lewy górny róg, width w px. shield = null — bez paska tarczy.
 */
export function drawUnitVitals(ctx, x, y, width, hull, shield = null) {
  const w = Math.max(12, width);
  const barH = 3;
  const gap = 2;
  const rows = shield == null ? 1 : 2;
  const h = rows * barH + (rows - 1) * gap;
  ctx.save();
  ctx.fillStyle = 'rgba(3, 5, 8, 0.72)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  let rowY = y;
  if (shield != null) {
    const s = Math.max(0, Math.min(1, Number(shield) || 0));
    ctx.fillStyle = 'rgba(92, 168, 255, 0.18)';
    ctx.fillRect(x, rowY, w, barH);
    ctx.fillStyle = SHIELD_FILL;
    ctx.fillRect(x, rowY, w * s, barH);
    rowY += barH + gap;
  }
  const f = Math.max(0, Math.min(1, Number(hull) || 0));
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.fillRect(x, rowY, w, barH);
  ctx.fillStyle = hullColor(f);
  ctx.fillRect(x, rowY, w * f, barH);
  ctx.restore();
}

/** Ramka zaznaczania (RTS): blade wypełnienie, cienki brzeg, jaśniejsze narożniki. */
export function drawSelectionBox(ctx, x0, y0, x1, y1, rgb = COMMAND_RGB.selection) {
  const x = Math.round(Math.min(x0, x1)) + 0.5;
  const y = Math.round(Math.min(y0, y1)) + 0.5;
  const w = Math.round(Math.abs(x1 - x0));
  const h = Math.round(Math.abs(y1 - y0));
  if (w < 2 || h < 2) return;
  const arm = Math.min(12, w * 0.3, h * 0.3);
  ctx.save();
  ctx.fillStyle = `rgba(${rgb}, 0.06)`;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = `rgba(${rgb}, 0.45)`;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = `rgba(${rgb}, 0.95)`;
  ctx.lineWidth = 2;
  ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(x, y + arm); ctx.lineTo(x, y); ctx.lineTo(x + arm, y);
  ctx.moveTo(x + w - arm, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + arm);
  ctx.moveTo(x + w, y + h - arm); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - arm, y + h);
  ctx.moveTo(x + arm, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - arm);
  ctx.stroke();
  ctx.restore();
}

// Znaki pozycji menu PPM (Segoe UI Symbol / Consolas — bez znaków, które Windows rysuje jako emoji).
const COMMAND_MENU_ICONS = Object.freeze({
  attack: '◆',
  ram: '➤',
  approach: '→',
  orbit: '↻',
  travel: '»',
  scan: '◎',
  drone: '⌖',
  salvage: '⌁',
  tow: '⊸',
  move: '✛',
  'move-formation': '∴',
  hold: '■'
});
const COMMAND_MENU_ROW_RGB = Object.freeze({
  attack: COMMAND_RGB.attack,
  ram: COMMAND_RGB.ram,
  approach: COMMAND_RGB.approach,
  orbit: COMMAND_RGB.orbit,
  scan: COMMAND_RGB.scan,
  drone: COMMAND_RGB.scan,
  salvage: COMMAND_RGB.salvage,
  tow: COMMAND_RGB.salvage
});

export function commandMenuIcon(action) {
  const key = String(action || '');
  if (key.startsWith('orbit-range')) return '◌';
  return COMMAND_MENU_ICONS[key] || '›';
}

function commandMenuRowRgb(action, accentRgb) {
  const key = String(action || '');
  if (key.startsWith('orbit-range')) return COMMAND_RGB.orbit;
  return COMMAND_MENU_ROW_RGB[key] || accentRgb;
}

function fitText(ctx, text, maxWidth) {
  const value = String(text || '');
  if (ctx.measureText(value).width <= maxWidth) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(value.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return value.slice(0, lo) + '…';
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export const COMMAND_MENU_HEAD_H = 28;
export const COMMAND_MENU_FOOT_H = 20;

/**
 * Menu PPM w świecie gry (płytka jak panele kontekstowe HUD). Wiersze leżą DOKŁADNIE tam,
 * gdzie liczy je hitTestCommandMenu (menu.y + i · itemHeight); nagłówek jest NAD menu.y,
 * stopka pod ostatnim wierszem — obie strefy poza trafieniami.
 * o: { hover, alpha, reveal (0–1), accentRgb, toneRgb, title, meta, footer }
 */
export function drawCommandMenu(ctx, menu, o = {}) {
  const items = Array.isArray(menu?.items) ? menu.items : [];
  if (!items.length) return;
  const x = Number(menu.x) || 0;
  const y = Number(menu.y) || 0;
  const w = Number(menu.width) || 206;
  const rowH = Number(menu.itemHeight) || 30;
  const headH = COMMAND_MENU_HEAD_H;
  const footH = o.footer ? COMMAND_MENU_FOOT_H : 0;
  const top = y - headH;
  const bodyH = rowH * items.length;
  const totalH = headH + bodyH + footH;
  const alpha = o.alpha == null ? 1 : Math.max(0, Math.min(1, Number(o.alpha) || 0));
  const reveal = o.reveal == null ? 1 : Math.max(0, Math.min(1, Number(o.reveal) || 0));
  const accentRgb = o.accentRgb || COMMAND_RGB.accent;
  const toneRgb = o.toneRgb || accentRgb;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(0, (1 - alpha) * -6);
  ctx.globalAlpha = alpha;

  roundedRectPath(ctx, x, top, w, totalH, 6);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  const plate = ctx.createLinearGradient(0, top, 0, top + totalH);
  plate.addColorStop(0, 'rgba(22, 24, 28, 0.95)');
  plate.addColorStop(1, 'rgba(7, 9, 12, 0.96)');
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  roundedRectPath(ctx, x + 0.5, top + 0.5, w - 1, totalH - 1, 6);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = `rgba(${accentRgb}, 0.6)`;
  ctx.fillRect(x + w * 0.15, top, w * 0.7, 1);

  // Nagłówek: kropka strony (wróg / sojusznik / punkt), nazwa, odczyt po prawej.
  const headMid = top + headH * 0.5;
  ctx.fillStyle = `rgba(${toneRgb}, 0.28)`;
  ctx.beginPath();
  ctx.arc(x + 13, headMid, 5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = `rgb(${toneRgb})`;
  ctx.beginPath();
  ctx.arc(x + 13, headMid, 2.6, 0, TAU);
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.font = '10px Consolas, "Courier New", monospace';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.5px';
  let metaW = 0;
  if (o.meta) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(200, 208, 216, 0.62)';
    ctx.fillText(String(o.meta), x + w - 10, headMid);
    metaW = ctx.measureText(String(o.meta)).width + 10;
  }
  ctx.textAlign = 'left';
  ctx.font = '700 10px Consolas, "Courier New", monospace';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1.2px';
  ctx.fillStyle = '#e8eaec';
  ctx.fillText(fitText(ctx, String(o.title || '').toUpperCase(), w - 34 - metaW), x + 24, headMid);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(x + 8, y - 0.5, w - 16, 1);

  // Wiersze: odsłaniane kolejno przy otwarciu, podświetlenie w kolorze akcji.
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rowReveal = Math.max(0, Math.min(1, (reveal - i * 0.065) / 0.45));
    if (rowReveal <= 0) continue;
    const rowY = y + i * rowH;
    const mid = rowY + rowH * 0.5;
    const hot = item === o.hover;
    const rowRgb = commandMenuRowRgb(item.action, accentRgb);
    const disabled = !!item.disabled;
    ctx.globalAlpha = alpha * rowReveal;
    if (i > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
      ctx.fillRect(x + 32, rowY, w - 42, 1);
    }
    if (hot && !disabled) {
      const glow = ctx.createLinearGradient(x, 0, x + w, 0);
      glow.addColorStop(0, `rgba(${rowRgb}, 0.24)`);
      glow.addColorStop(1, `rgba(${rowRgb}, 0.02)`);
      ctx.fillStyle = glow;
      ctx.fillRect(x + 1, rowY + 1, w - 2, rowH - 2);
      ctx.fillStyle = `rgb(${rowRgb})`;
      ctx.fillRect(x + 1, rowY + 6, 2, rowH - 12);
    }
    ctx.textAlign = 'center';
    ctx.font = '13px "Segoe UI Symbol", Consolas, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.fillStyle = disabled ? 'rgba(200, 208, 216, 0.3)' : `rgba(${rowRgb}, ${hot ? 1 : 0.82})`;
    ctx.fillText(commandMenuIcon(item.action), x + 18, mid + 0.5);
    ctx.textAlign = 'left';
    ctx.font = '700 11px Consolas, "Courier New", monospace';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = disabled ? 'rgba(200, 208, 216, 0.35)' : hot ? '#ffffff' : '#c6ccd2';
    ctx.fillText(fitText(ctx, item.label || String(item.action || '').toUpperCase(), w - 44), x + 34 + (hot ? 2 : 0), mid + 0.5);
  }

  if (o.footer) {
    ctx.globalAlpha = alpha * reveal;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fillRect(x + 8, y + bodyH, w - 16, 1);
    ctx.textAlign = 'left';
    ctx.font = '9px Consolas, "Courier New", monospace';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.6px';
    ctx.fillStyle = 'rgba(200, 208, 216, 0.5)';
    ctx.fillText(fitText(ctx, String(o.footer), w - 20), x + 10, y + bodyH + footH * 0.5 + 0.5);
  }
  ctx.restore();
}
