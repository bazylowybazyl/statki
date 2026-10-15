// src/3d/hullDesign/hullDecalAtlas.js
//
// KREATOR KADŁUBÓW — atlas naklejek: emblematy wektorowe (src/game/hullDesign/hullEmblems.js) i napisy rysowane
// kanwą 2D do jednej tekstury (alfa = kształt), półki od góry. Kompozytor (hullComposer.js) próbkuje atlas w
// układzie naklejki. Moduł przeglądarkowy (kanwa); dane wyjściowe — zwykła tablica RGBA (wiersz 0 = góra).

import { HD_EMBLEMS } from '../../game/hullDesign/hullEmblems.js';

const ATLAS = 1024;
const PAD = 4;

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Atlas dla naklejek-emblematów i napisów z listy (rozwiniętej — z kopiami lustra). Wspólne kafle dla tych
 * samych treści i proporcji. Zwraca { data, width, height, rects: Map naklejka → [u0, v0, u1, v1] }.
 */
export function buildHullDecalAtlas(decals) {
  const canvas = makeCanvas(ATLAS, ATLAS);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, ATLAS, ATLAS);
  const rects = new Map();
  const shared = new Map();
  let x = PAD, y = PAD, rowH = 0;
  for (const d of decals) {
    if (d.kind !== 'emblem' && d.kind !== 'text') continue;
    const aspect = Math.max(0.1, d.w / d.h);
    const key = `${d.kind}|${d.kind === 'text' ? `${d.text}|${d.weight || 700}` : d.id}|${aspect.toFixed(2)}`;
    if (shared.has(key)) { rects.set(d, shared.get(key)); continue; }
    const sh = d.kind === 'text' ? 96 : 192;
    const sw = Math.min(ATLAS - 2 * PAD, Math.max(16, Math.round(sh * aspect)));
    const sh2 = Math.round(sw / aspect);
    if (x + sw + PAD > ATLAS) { x = PAD; y += rowH + PAD; rowH = 0; }
    if (y + sh2 + PAD > ATLAS) break;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#fff';
    if (d.kind === 'emblem') {
      const em = HD_EMBLEMS[d.id] || HD_EMBLEMS.wing;
      ctx.scale(sw / 100, sh2 / 100);
      ctx.beginPath();
      for (const path of em.paths) {
        path.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
      }
      ctx.fill('evenodd');
    } else {
      // napis: krój szeryfowy-blokowy wypełnia kafel (rozciągnięty w poziomie do szerokości)
      const fs = 100;
      ctx.font = `${d.weight || 700} ${fs}px "Segoe UI", "Arial Narrow", Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const m = ctx.measureText(d.text);
      const tw = Math.max(1, m.width), th = fs * 0.74;
      ctx.translate(sw / 2, sh2 / 2);
      ctx.scale((sw * 0.96) / tw, (sh2 * 0.92) / th);
      ctx.fillText(d.text, 0, fs * 0.03);
    }
    ctx.restore();
    const rect = [x / ATLAS, y / ATLAS, (x + sw) / ATLAS, (y + sh2) / ATLAS];
    rects.set(d, rect);
    shared.set(key, rect);
    x += sw + PAD;
    rowH = Math.max(rowH, sh2);
  }
  const img = ctx.getImageData(0, 0, ATLAS, ATLAS);
  return { data: new Uint8Array(img.data.buffer.slice(0)), width: ATLAS, height: ATLAS, rects };
}
