// Demo mostków — edytor strefy mostka (przesuw, rozmiar, obrót) w przestrzeni PNG sprite'a.
// Kadłuby na silniku belek (dema/mostki-webgpu.html, klawisz E); do 2026-10-19 żył w heksowym
// dema/mostki-demo.html (usunięte razem z silnikiem heksów).
//
// Eksport jest w przestrzeni PNG sprite'a (jak hardpointEditorDefaults), NIE w przestrzeni renderu.
// Edytor hardpointów gry w trybie „Current Ship” eksportuje w przestrzeni kanwy renderu (Atlas ×0,48 —
// memory hardpoint-editor-scale); tu mysz idzie przez bridgeWorldToPng (skala render / PNG kadłuba).
// Strefy w grze czyta BRIDGE_LAYOUT_PROPOSALS (src/game/shipBridge.js) — tam wkleja się eksport.

import {
  bridgePngToWorld,
  bridgeWorldToPng,
  normalizeBridgeDef
} from '../../src/game/shipBridge.js';

const DEG = Math.PI / 180;

export function createZoneEditor() {
  const ed = {
    active: false,
    drag: null          // { kind, start: {x,y} PNG, def0 }
  };

  // Uchwyty w świecie (do rysowania i trafiania myszą). Strefa wielokątna (`poly`) — bez uchwytów.
  ed.handles = (entity, def) => {
    if (!entity || !def || def.poly) return null;
    const r = def.rot * DEG;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const pts = [];
    const push = (kind, u, v) => {
      const px = def.x + u * c - v * s;
      const py = def.y + u * s + v * c;
      const w = bridgePngToWorld(entity, px, py, { x: 0, y: 0 });
      pts.push({ kind, x: w.x, y: w.y, u, v });
    };
    push('move', 0, 0);
    push('corner', -def.w / 2, -def.h / 2);
    push('corner', def.w / 2, -def.h / 2);
    push('corner', def.w / 2, def.h / 2);
    push('corner', -def.w / 2, def.h / 2);
    const k = entity.__hardpointScale || 1;
    push('rotate', 0, -def.h / 2 - 26 / Math.max(0.05, k));
    return pts;
  };

  ed.pick = (entity, def, toScreen, sx, sy) => {
    const hs = ed.handles(entity, def);
    if (!hs) return null;
    let best = null;
    let bestD = 11 * 11;
    for (const h of hs) {
      const q = toScreen(h.x, h.y);
      const d = (q.x - sx) ** 2 + (q.y - sy) ** 2;
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  };

  ed.begin = (entity, def, handle, worldX, worldY) => {
    const p = bridgeWorldToPng(entity, worldX, worldY, { x: 0, y: 0 });
    ed.drag = { kind: handle.kind, start: p, def0: { ...def } };
  };

  // Zwraca nową definicję (albo null, gdy nic się nie zmieniło).
  ed.move = (entity, worldX, worldY) => {
    if (!ed.drag) return null;
    const p = bridgeWorldToPng(entity, worldX, worldY, { x: 0, y: 0 });
    const d0 = ed.drag.def0;
    const next = { ...d0 };
    if (ed.drag.kind === 'move') {
      next.x = Math.round(d0.x + (p.x - ed.drag.start.x));
      next.y = Math.round(d0.y + (p.y - ed.drag.start.y));
    } else if (ed.drag.kind === 'corner') {
      const r = d0.rot * DEG;
      const dx = p.x - d0.x;
      const dy = p.y - d0.y;
      const u = dx * Math.cos(r) + dy * Math.sin(r);
      const v = -dx * Math.sin(r) + dy * Math.cos(r);
      next.w = Math.max(6, Math.round(Math.abs(u) * 2));
      next.h = Math.max(6, Math.round(Math.abs(v) * 2));
    } else if (ed.drag.kind === 'rotate') {
      const a = Math.atan2(p.y - d0.y, p.x - d0.x) / DEG + 90;
      let rot = Math.round(a);
      while (rot > 180) rot -= 360;
      while (rot <= -180) rot += 360;
      next.rot = rot;
    }
    return normalizeBridgeDef(next);
  };

  ed.end = () => { ed.drag = null; };
  return ed;
}

/** Uchwyty edytora na kanwie 2D: krzyż (przesuw), kwadraty (rogi), koło (obrót). */
export function drawEditorGizmo(ctx, toScreen, handles) {
  if (!handles) return;
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#7cc9ff';
  ctx.lineWidth = 1.2;
  for (const h of handles) {
    const q = toScreen(h.x, h.y);
    ctx.beginPath();
    if (h.kind === 'rotate') ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
    else if (h.kind === 'move') { ctx.moveTo(q.x - 7, q.y); ctx.lineTo(q.x + 7, q.y); ctx.moveTo(q.x, q.y - 7); ctx.lineTo(q.x, q.y + 7); }
    else ctx.rect(q.x - 5, q.y - 5, 10, 10);
    if (h.kind !== 'move') ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Tekst eksportu: lista stref per kadłub i wariant (przestrzeń PNG) — gotowa do wklejenia jako
 * `<wariant>: Object.freeze([...])` w BRIDGE_LAYOUT_PROPOSALS.<klucz>.variants (src/game/shipBridge.js).
 * `entries`: [{ key, variant, list }], `formatList` — formatBridgesJson.
 */
export function formatZonesExport(entries, formatList) {
  const parts = ['// Strefy mostków — przestrzeń PNG sprite\'a (jak hardpointy w hardpointEditorDefaults.js).',
    '// Wklej jako BRIDGE_LAYOUT_PROPOSALS.<klucz>.variants.<wariant> w src/game/shipBridge.js.'];
  for (const { key, variant, list } of entries) {
    parts.push(`// ${key} · wariant „${variant}”`);
    parts.push(`${variant}: Object.freeze(${formatList(list)})`);
  }
  return parts.join('\n');
}
