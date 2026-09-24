// src/ui/wreckFieldMarkers.js
//
// Pola zimnych wraków w CIC (M / Tab): przerywany okrąg pola, romb w środku,
// etykieta „POLE WRAKÓW · N” i streszczenie (działa, ładunek, złom). Po
// zbliżeniu (statek w zasięgu pola) — lista najbliższych wraków pola, jak
// wynik skanu: nazwa, ile kadłuba zostało, uzbrojenie, ładunek, dystans.
// Holowanie albo cięcie wraku z listy wybudza go (thawWreck) — tu tylko obraz.
//
// Moduł nie zna gry: pola (src/game/wreckFields.js), kanwa i rzut świat→ekran
// przychodzą z CICDisplay.draw.

export const WRECK_FIELD_MARKER_CONFIG = Object.freeze({
  color: '#f5b041',
  // Lista wraków pola pokazuje się, gdy statek jest bliżej niż promień + tyle [j.].
  listReach: 8000,
  listMax: 6
});

function defaultFormatDistance(dist) {
  const d = Math.max(0, Number(dist) || 0);
  return d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
}

export function describeWreckField(field) {
  const s = field?.summary || {};
  const parts = [];
  if (s.weapons > 0) parts.push(`${s.weapons} dz.`);
  if (s.cargoWrecks > 0) parts.push('ładunek');
  if (s.scrapWrecks > 0) parts.push('złom');
  return parts.join(' · ');
}

export function describeFieldWreck(wreck) {
  const s = wreck?._coldSnapshot?.summary;
  const label = String(s?.label || wreck?._salvage?.label || 'Wrak');
  const hull = s ? `${Math.round((s.aliveFrac || 0) * 100)}%` : '';
  const extras = [];
  if (s?.weapons > 0) extras.push(`${s.weapons} dz.`);
  if (s?.hasCargo) extras.push('ładunek');
  return [label, hull, ...extras].filter(Boolean).join(' · ');
}

// k najbliższych punktu (x, y) członków pola — bez sortowania całej listy.
export function nearestFieldWrecks(field, x, y, k) {
  const picked = [];
  const members = field?.members || [];
  for (const w of members) {
    const dx = (Number(w.x) || 0) - x;
    const dy = (Number(w.y) || 0) - y;
    const d = dx * dx + dy * dy;
    if (picked.length < k) {
      picked.push({ w, d });
      picked.sort((a, b) => a.d - b.d);
    } else if (d < picked[k - 1].d) {
      picked[k - 1] = { w, d };
      picked.sort((a, b) => a.d - b.d);
    }
  }
  return picked.map(p => ({ wreck: p.w, distance: Math.sqrt(p.d) }));
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} fields  rekordy z buildWreckFields
 * @param {object} view  { toScreen(wx, wy) → {x, y}, zoom, W, H, shipX, shipY, isSystemScale, formatDistance? }
 * @returns {object|null} pole z listą (statek w zasięgu) albo null
 */
export function drawWreckFieldMarkers(ctx, fields, view) {
  if (!ctx || !Array.isArray(fields) || fields.length === 0 || !view?.toScreen) return null;
  const { toScreen, zoom, W, H } = view;
  const color = WRECK_FIELD_MARKER_CONFIG.color;
  const fmt = typeof view.formatDistance === 'function' ? view.formatDistance : defaultFormatDistance;
  const shipX = Number(view.shipX) || 0;
  const shipY = Number(view.shipY) || 0;

  let nearField = null;
  let nearDistSq = Infinity;
  for (const f of fields) {
    const dx = f.x - shipX;
    const dy = f.y - shipY;
    const distSq = dx * dx + dy * dy;
    const reach = f.radius + WRECK_FIELD_MARKER_CONFIG.listReach;
    if (distSq <= reach * reach && distSq < nearDistSq) {
      nearField = f;
      nearDistSq = distSq;
    }

    const sp = toScreen(f.x, f.y);
    const sr = Math.max(0, f.radius * zoom);
    const pad = Math.max(sr, 60);
    if (sp.x + pad < 0 || sp.x - pad > W || sp.y + pad < 0 || sp.y - pad > H) continue;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    if (sr >= 12 && !view.isSystemScale) {
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Romb pola — widać go na każdym zoomie, także w widoku systemu.
    const d = 5;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y - d);
    ctx.lineTo(sp.x + d, sp.y);
    ctx.lineTo(sp.x, sp.y + d);
    ctx.lineTo(sp.x - d, sp.y);
    ctx.closePath();
    ctx.stroke();

    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const labelY = sp.y - Math.max(d, Math.min(sr, 120)) - 8;
    ctx.fillText(`POLE WRAKÓW · ${f.count}`, sp.x, labelY);
    const details = describeWreckField(f);
    if (details) {
      ctx.globalAlpha = 0.7;
      ctx.font = '8px monospace';
      ctx.fillText(details, sp.x, labelY + 11);
    }
    ctx.restore();
  }

  // Po zbliżeniu: lista najbliższych wraków pola (jak wynik skanu).
  if (nearField) {
    const rows = nearestFieldWrecks(nearField, shipX, shipY, WRECK_FIELD_MARKER_CONFIG.listMax);
    const x = 16;
    let y = Math.max(40, (H || 0) - 24 - (rows.length + 1) * 13);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`POLE WRAKÓW · ${nearField.count} (zimne — hol/cięcie budzi)`, x, y);
    ctx.font = '9px monospace';
    for (const row of rows) {
      y += 13;
      ctx.fillText(`${describeFieldWreck(row.wreck)} · ${fmt(row.distance)}`, x, y);
    }
    ctx.restore();
  }
  return nearField;
}
