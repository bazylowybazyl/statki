// Demo mostków — warstwa HUD 2D (kanwa nad obrazem WebGL, jak HUD gry).
// Strefy, heksy mostka, siatka, hardpointy, działo, lock i panel stanu.
// Zaznaczenie strefy żyje TYLKO tutaj (brief: skan/lock = HUD 2D), nie w 3D.

import {
  bridgeGridToWorld,
  bridgePngToWorld,
  bridgeShardIsAlive,
  bridgeZoneCorners,
  getShipBridgeSummary
} from '../src/game/shipBridge.js';
import { getHexStructuralState } from '../src/game/destructor.js';

const HP_COLORS = {
  main: '#53a7ff', missile: '#65e58e', aux: '#f8bd53', hangar: '#be7fff',
  special: '#ff6a6a', special_missile: '#ff7ae6', builtin: '#7ee7ff'
};

const _p = { x: 0, y: 0 };
const _q = { x: 0, y: 0 };
const _corners = [];

export function makeView(cam, W, H) {
  return {
    cam, W, H,
    toScreen(x, y, out = { x: 0, y: 0 }) {
      out.x = (x - cam.x) * cam.zoom + W * 0.5;
      out.y = (y - cam.y) * cam.zoom + H * 0.5;
      return out;
    },
    toWorld(sx, sy, out = { x: 0, y: 0 }) {
      out.x = (sx - W * 0.5) / cam.zoom + cam.x;
      out.y = (sy - H * 0.5) / cam.zoom + cam.y;
      return out;
    }
  };
}

function hardpointWorld(entity, hp, out) {
  const kx = entity.__hardpointScaleX || 1;
  const ky = entity.__hardpointScaleY || 1;
  const a = entity.angle || 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  out.x = entity.x + hp.x * kx * c - hp.y * ky * s;
  out.y = entity.y + hp.x * kx * s + hp.y * ky * c;
  return out;
}

function zonePath(ctx, view, entity, def) {
  bridgeZoneCorners(def, _corners);
  ctx.beginPath();
  for (let i = 0; i < _corners.length; i += 2) {
    bridgePngToWorld(entity, _corners[i], _corners[i + 1], _p);
    view.toScreen(_p.x, _p.y, _q);
    if (i === 0) ctx.moveTo(_q.x, _q.y); else ctx.lineTo(_q.x, _q.y);
  }
  ctx.closePath();
}

function stateColor(b) {
  if (b.missing) return '#7d919b';
  if (b.dead) return '#ff6b5e';
  if (b.integrity < 1) return '#f0b060';
  return '#7be3a0';
}

export function drawGrid(ctx, view, entity) {
  const g = entity.hexGrid;
  if (!g) return;
  const size = Math.max(1, Math.min(3, view.cam.zoom * 3));
  ctx.fillStyle = 'rgba(160,220,255,0.35)';
  for (let i = 0; i < g.shards.length; i++) {
    const s = g.shards[i];
    if (!s.active || s.isDebris) continue;
    bridgeGridToWorld(entity, s.gridX + s.deformation.x, s.gridY + s.deformation.y, _p);
    view.toScreen(_p.x, _p.y, _q);
    if (_q.x < -4 || _q.y < -4 || _q.x > view.W + 4 || _q.y > view.H + 4) continue;
    ctx.fillRect(_q.x - size * 0.5, _q.y - size * 0.5, size, size);
  }
}

export function drawBridgeHexes(ctx, view, entity) {
  const st = entity.bridgeState;
  if (!st) return;
  const g = entity.hexGrid;
  const r = Math.max(1.2, Math.min(4, view.cam.zoom * 3.2));
  for (const b of st.bridges) {
    for (const s of b.shards) {
      const alive = bridgeShardIsAlive(g, s);
      const inGrid = g.shards[s.__meshIndex] === s;
      bridgeGridToWorld(entity, s.gridX + s.deformation.x, s.gridY + s.deformation.y, _p);
      view.toScreen(_p.x, _p.y, _q);
      if (alive) {
        const hpFrac = s.maxHp > 0 ? Math.max(0, s.hp / s.maxHp) : 1;
        ctx.fillStyle = `rgba(${Math.round(255 - 150 * hpFrac)},${Math.round(120 + 110 * hpFrac)},255,0.85)`;
        ctx.fillRect(_q.x - r, _q.y - r, r * 2, r * 2);
      } else if (!inGrid && s.active && !s.isDebris) {
        // Żywy, ale w odciętym fragmencie — dla kadłuba-matki stracony.
        ctx.strokeStyle = 'rgba(240,176,96,0.9)';
        ctx.strokeRect(_q.x - r, _q.y - r, r * 2, r * 2);
      } else {
        ctx.strokeStyle = 'rgba(255,107,94,0.75)';
        ctx.beginPath();
        ctx.moveTo(_q.x - r, _q.y - r); ctx.lineTo(_q.x + r, _q.y + r);
        ctx.moveTo(_q.x + r, _q.y - r); ctx.lineTo(_q.x - r, _q.y + r);
        ctx.stroke();
      }
    }
  }
}

export function drawZones(ctx, view, entity, opts = {}) {
  const st = entity.bridgeState;
  const defs = st ? st.bridges.map((b) => b.def) : (opts.defs || []);
  ctx.save();
  ctx.lineWidth = 1.5;
  for (let i = 0; i < defs.length; i++) {
    const b = st ? st.bridges[i] : null;
    const col = b ? stateColor(b) : '#7cc9ff';
    ctx.strokeStyle = col;
    ctx.setLineDash(b && b.def.role === 'backup' ? [6, 4] : []);
    zonePath(ctx, view, entity, defs[i]);
    ctx.stroke();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = col;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (b && opts.labels !== false) {
      // Zapasowy podpisany POD strefą — na Atlasie oba mostki leżą na
      // kręgosłupie i podpisy nad strefami nachodziłyby na siebie.
      const below = b.def.role === 'backup';
      bridgePngToWorld(entity, defs[i].x, defs[i].y + (below ? 0.5 : -0.5) * defs[i].h, _p);
      view.toScreen(_p.x, _p.y, _q);
      if (below) _q.y += 18;
      ctx.fillStyle = col;
      ctx.font = '11px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center';
      const pct = Math.round(b.integrity * 100);
      const thr = Math.round((1 - b.def.killFrac) * 100);
      ctx.fillText(`${b.def.label}: ${b.missing ? 'brak heksów' : `${pct}% (próg ${thr}%)`}${b.dead ? ' — ZNISZCZONY' : ''}`, _q.x, _q.y - 6);
    }
  }
  ctx.restore();
}

export function drawHardpoints(ctx, view, entity) {
  const list = entity.editorHardpoints || [];
  const r = Math.max(3, Math.min(9, 14 * (entity.__hardpointScale || 1) * view.cam.zoom));
  ctx.save();
  ctx.lineWidth = 1.2;
  for (const hp of list) {
    hardpointWorld(entity, hp, _p);
    view.toScreen(_p.x, _p.y, _q);
    ctx.strokeStyle = HP_COLORS[hp.type] || '#fff';
    ctx.globalAlpha = hp.destroyed ? 0.45 : 0.9;
    ctx.beginPath();
    ctx.arc(_q.x, _q.y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (hp.destroyed) {
      ctx.beginPath();
      ctx.moveTo(_q.x - r, _q.y - r); ctx.lineTo(_q.x + r, _q.y + r);
      ctx.moveTo(_q.x + r, _q.y - r); ctx.lineTo(_q.x - r, _q.y + r);
      ctx.stroke();
    }
  }
  // Sloty silników (edytor) — kwadraty.
  const eng = [...(entity.visual?.mainThrusters || []), ...(entity.visual?.torqueThrusters || [])];
  ctx.strokeStyle = '#ff5cff';
  ctx.globalAlpha = 0.8;
  const a = entity.angle || 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (const t of eng) {
    const lx = t.offset.x;
    const ly = t.offset.y;
    view.toScreen(entity.x + lx * c - ly * s, entity.y + lx * s + ly * c, _q);
    ctx.strokeRect(_q.x - r * 0.7, _q.y - r * 0.7, r * 1.4, r * 1.4);
  }
  ctx.restore();
}

export function drawGunAndAim(ctx, view, gun, aim, lockPoint, opts = {}) {
  view.toScreen(gun.x, gun.y, _q);
  const gx = _q.x;
  const gy = _q.y;
  ctx.save();
  if (aim && opts.showAim) {
    view.toScreen(aim.x, aim.y, _p);
    ctx.strokeStyle = 'rgba(124,201,255,0.35)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(_p.x, _p.y); ctx.stroke();
    ctx.setLineDash([]);
  }
  // Działo: trójkąt skierowany w cel.
  const ang = aim ? Math.atan2(aim.y - gun.y, aim.x - gun.x) : 0;
  ctx.translate(gx, gy);
  ctx.rotate(ang);
  ctx.fillStyle = '#cfe6f2';
  ctx.strokeStyle = '#0b1620';
  ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -7); ctx.lineTo(-4, 0); ctx.lineTo(-8, 7); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
  if (lockPoint) {
    view.toScreen(lockPoint.x, lockPoint.y, _p);
    ctx.save();
    ctx.strokeStyle = '#ff9d4a';
    ctx.lineWidth = 1.5;
    const r = 10;
    for (let k = 0; k < 4; k++) {
      const a0 = k * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(_p.x, _p.y, r, a0 - 0.45, a0 + 0.45);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff9d4a';
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('LOCK: MOSTEK', _p.x + 14, _p.y - 10);
    ctx.restore();
  }
}

const STATE_LABEL = {
  alive: 'AKTYWNY',
  backup: 'MOSTEK GŁÓWNY STRACONY — DOWODZENIE Z ZAPASOWEGO',
  spare: 'MOSTEK ZAPASOWY STRACONY — DOWODZENIE Z GŁÓWNEGO',
  command: 'UTRATA DOWODZENIA (mostek)',
  pool: 'ZNISZCZONY (pula HP)',
  ceiling: 'ZNISZCZONY (sufit heksów)',
  hardpoints: 'ZNISZCZONY (utrata hardpointów)',
  hexes: 'ZNISZCZONY (brak heksów)'
};

function targetStatus(t) {
  const c = t.combat;
  if (c?.dead) return c.deathCause === 'bridge' ? 'command' : (c.deathCause || 'pool');
  const st = t.bridgeState;
  if (!st) return 'alive';
  if (st.bridges.some((b) => b.dead && b.def.role !== 'backup')) return 'backup';
  if (st.bridges.some((b) => b.dead)) return 'spare';
  return 'alive';
}

function bar(ctx, x, y, w, h, frac, col, mark = null) {
  ctx.fillStyle = 'rgba(20,34,44,0.9)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  if (mark != null) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + w * mark - 1, y - 2, 2, h + 4);
  }
}

const _summary = [];

/** Panel stanu celów (lewy górny róg). */
export function drawInfo(ctx, view, sim, info) {
  const x0 = 10;
  let y = 12;
  ctx.save();
  ctx.font = '11px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lines = [];
  for (const t of sim.targets) {
    const c = t.combat;
    const hs = getHexStructuralState(t);
    const status = targetStatus(t);
    const h = 86 + (t.bridgeState ? t.bridgeState.bridges.length * 16 : 0) + (info.extra?.get(t)?.length || 0) * 14;
    ctx.fillStyle = 'rgba(7,13,19,0.86)';
    ctx.fillRect(x0 - 4, y - 4, 360, h);
    ctx.fillStyle = status === 'alive' ? '#7cc9ff' : (status === 'backup' || status === 'spare' ? '#f0b060' : '#ff8a6e');
    ctx.fillText(`${(t.displayName || t.hullKey).toUpperCase()} — ${STATE_LABEL[status] || status}`, x0, y);
    y += 16;
    ctx.fillStyle = '#d6e2e8';
    ctx.fillText(`Pula HP ${Math.max(0, Math.round(t.hp))}/${t.maxHp}`, x0, y);
    bar(ctx, x0 + 150, y + 2, 190, 7, t.hp / t.maxHp, '#7be3a0');
    y += 14;
    ctx.fillText(`Tarcza ${Math.round(t.shield?.val || 0)}/${t.shield?.max || 0}${t.shield?.enabled ? '' : ' (wył.)'}`, x0, y);
    bar(ctx, x0 + 150, y + 2, 190, 7, (t.shield?.val || 0) / Math.max(1, t.shield?.max || 1), '#6fb8ff');
    y += 14;
    ctx.fillText(`Heksy ${hs ? hs.active : 0}/${hs ? hs.total : 0} (${hs ? Math.round(hs.ratio * 100) : 0}%) · hardpointy stracone ${Math.round(c?.hardpointsLost || 0)}/${(t.editorHardpoints || []).length}`, x0, y);
    y += 14;
    ctx.fillText(`Trafienia ${c?.hullHits || 0} · sufit −${Math.round(c?.ceilingDamage || 0)} · hardp. −${Math.round(c?.hardpointDamage || 0)}`, x0, y);
    y += 16;
    if (t.bridgeState) {
      getShipBridgeSummary(t, _summary);
      for (const b of _summary) {
        ctx.fillStyle = b.dead ? '#ff6b5e' : (b.integrity < 1 ? '#f0b060' : '#7be3a0');
        ctx.fillText(`${b.role === 'backup' ? 'Zapas.' : 'Mostek'} ${String(Math.round(b.integrity * 100)).padStart(3)}% ${b.alive}/${b.total} ×${b.armorMul}`, x0, y);
        bar(ctx, x0 + 190, y + 2, 150, 7, b.integrity, ctx.fillStyle, b.threshold);
        y += 16;
      }
    }
    for (const line of info.extra?.get(t) || []) {
      ctx.fillStyle = line.color || '#9fb4bf';
      ctx.fillText(line.text, x0, y);
      y += 14;
    }
    y += 10;
    lines.push(y);
  }
  // Pasek broni i stanu symulacji.
  ctx.fillStyle = 'rgba(7,13,19,0.86)';
  ctx.fillRect(x0 - 4, view.H - 58, 520, 50);
  ctx.fillStyle = '#d6e2e8';
  ctx.fillText(info.weaponLine || '', x0, view.H - 54);
  ctx.fillStyle = '#9fb4bf';
  ctx.fillText(info.simLine || '', x0, view.H - 38);
  ctx.fillText(info.probeLine || '', x0, view.H - 22);
  ctx.restore();
}

export function drawMessages(ctx, view, messages, now) {
  ctx.save();
  ctx.font = '13px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  let y = 22;
  for (const m of messages) {
    const age = now - m.t;
    if (age > m.life) continue;
    ctx.globalAlpha = Math.min(1, (m.life - age) / 0.6);
    ctx.fillStyle = 'rgba(7,13,19,0.8)';
    const w = ctx.measureText(m.text).width + 20;
    ctx.fillRect(view.W * 0.5 - w * 0.5, y - 4, w, 22);
    ctx.fillStyle = m.color || '#ffd08a';
    ctx.fillText(m.text, view.W * 0.5, y + 12);
    y += 26;
  }
  ctx.restore();
}

export function drawEditorGizmo(ctx, view, handles) {
  if (!handles) return;
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#7cc9ff';
  ctx.lineWidth = 1.2;
  for (const h of handles) {
    view.toScreen(h.x, h.y, _q);
    ctx.beginPath();
    if (h.kind === 'rotate') ctx.arc(_q.x, _q.y, 6, 0, Math.PI * 2);
    else if (h.kind === 'move') { ctx.moveTo(_q.x - 7, _q.y); ctx.lineTo(_q.x + 7, _q.y); ctx.moveTo(_q.x, _q.y - 7); ctx.lineTo(_q.x, _q.y + 7); }
    else ctx.rect(_q.x - 5, _q.y - 5, 10, 10);
    if (h.kind !== 'move') ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
