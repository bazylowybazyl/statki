// Nakładki debug dema rdzenia na kanwie 2D (po kopii klatki WebGL, jak HUD gry).
import { DESTRUCTOR_CONFIG } from '../src/game/destructor.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import {
  getCoreWorld,
  gridToLocal,
  localToWorld,
  computeCoreLayout,
  coreMarkerToGrid,
  computeCoreBlast,
  CORE_STATE,
  CORE_STATE_LABEL,
  CORE_PROBE_CONFIG
} from '../src/game/shipCore.js';
import { HULLS, expandCandidate } from './rdzen-hulls-data.js';

const HEX_R = DESTRUCTOR_CONFIG.gridDivisions;
const STATE_COLOR = {
  nominal: '#7cc9ff',
  exposed: '#ffd166',
  critical: '#ff9a3c',
  meltdown: '#ff4b3e',
  detonated: '#888'
};

const _w = { x: 0, y: 0 };
const _l = { x: 0, y: 0 };

export function worldToScreen(view, x, y, out = {}) {
  out.x = (x - view.camX) * view.zoom + view.W * 0.5;
  out.y = (y - view.camY) * view.zoom + view.H * 0.5;
  return out;
}

export function screenToWorld(view, sx, sy, out = {}) {
  out.x = (sx - view.W * 0.5) / view.zoom + view.camX;
  out.y = (sy - view.H * 0.5) / view.zoom + view.camY;
  return out;
}

function hexPath(ctx, cx, cy, r, angle) {
  ctx.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  for (let i = 1; i < 6; i++) {
    const a = angle + i * Math.PI / 3;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function shardWorld(entity, shard, out) {
  const grid = entity.hexGrid;
  const gx = shard.gridX + (shard.deformation?.x || 0);
  const gy = shard.gridY + (shard.deformation?.y || 0);
  _l.x = gx - grid.srcWidth * 0.5 - (grid.pivot?.x || 0);
  _l.y = gy - grid.srcHeight * 0.5 - (grid.pivot?.y || 0);
  return localToWorld(entity, _l.x, _l.y, out);
}

function drawGrid(ctx, view, entity) {
  const grid = entity.hexGrid;
  if (!grid || view.zoom < 0.35) return;
  const r = HEX_R * view.zoom * 0.98;
  const ang = (entity.angle || 0);
  const s = { x: 0, y: 0 };
  ctx.beginPath();
  let n = 0;
  for (const shard of grid.shards) {
    if (!shard.active || shard.isDebris) continue;
    shardWorld(entity, shard, _w);
    worldToScreen(view, _w.x, _w.y, s);
    if (s.x < -10 || s.y < -10 || s.x > view.W + 10 || s.y > view.H + 10) continue;
    hexPath(ctx, s.x, s.y, r, ang);
    if (++n > 16000) break;
  }
  ctx.strokeStyle = 'rgba(160,200,230,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawChamber(ctx, view, core, opts) {
  const host = core.host;
  if (!host?.hexGrid) return;
  const grid = host.hexGrid;
  const s = { x: 0, y: 0 };
  const r = HEX_R * view.zoom * 0.9;
  const ang = host.angle || 0;
  const alive = new Path2D();
  const dead = new Path2D();
  for (let i = 0; i < core.chamber.length; i++) {
    const gx = core.chamberGridX[i];
    const gy = core.chamberGridY[i];
    gridToLocal(host, gx, gy, _l);
    localToWorld(host, _l.x, _l.y, _w);
    worldToScreen(view, _w.x, _w.y, s);
    const path = core.chamberAlive[i] ? alive : dead;
    path.moveTo(s.x + Math.cos(ang) * r, s.y + Math.sin(ang) * r);
    for (let k = 1; k < 6; k++) {
      const a = ang + k * Math.PI / 3;
      path.lineTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
    }
    path.closePath();
  }
  const col = STATE_COLOR[core.state] || '#7cc9ff';
  if (view.zoom >= 0.25) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = col + 'aa';
    ctx.stroke(alive);
    ctx.strokeStyle = 'rgba(255,70,60,0.9)';
    ctx.stroke(dead);
  }
  getCoreWorld(core, _w);
  worldToScreen(view, _w.x, _w.y, s);
  const scale = Math.max(host.visual?.spriteScale ?? 1, 0.0001);
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(s.x, s.y, Math.max(3, core.gridR * scale * view.zoom), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y);
  ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6);
  ctx.stroke();
  if (opts.probe) drawProbe(ctx, view, core);
  if (opts.state) drawCoreLabel(ctx, view, core, s);
  if (opts.blast && core.state !== CORE_STATE.DETONATED) {
    const blast = computeCoreBlast(core);
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = 'rgba(255,120,80,0.35)';
    ctx.beginPath(); ctx.arc(s.x, s.y, blast.aoeRadius * view.zoom, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,200,80,0.5)';
    ctx.beginPath(); ctx.arc(s.x, s.y, blast.shockRadius * view.zoom, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawProbe(ctx, view, core) {
  const pts = core.lastProbe;
  if (!pts) return;
  const s = { x: 0, y: 0 };
  const hitR = HEX_R * 1.3 * 2 * view.zoom;
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i += 2) {
    worldToScreen(view, pts[i], pts[i + 1], s);
    ctx.strokeStyle = core.probeSupported ? 'rgba(120,255,160,0.8)' : 'rgba(255,80,80,0.9)';
    ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, Math.PI * 2); ctx.stroke();
    if (i === 0) { ctx.beginPath(); ctx.arc(s.x, s.y, hitR + CORE_PROBE_CONFIG.coreProbeRadius * 0.5 * view.zoom, 0, Math.PI * 2); ctx.stroke(); }
  }
}

function drawCoreLabel(ctx, view, core, s) {
  const col = STATE_COLOR[core.state] || '#fff';
  const lines = [
    `${core.id} · ${CORE_STATE_LABEL[core.state] || core.state}${core.severed ? ' (odcięty)' : ''}${core.invalid ? ' · NIEWAŻNY' : ''}`,
    `osłona ${(core.integrity * 100).toFixed(0)}% · martwe ${core.deadCount}/${core.chamber.length}${core.elsewhereCount ? ` · gdzie indziej ${core.elsewhereCount}` : ''}`
  ];
  if (core.state === CORE_STATE.MELTDOWN) lines.push(`STOPIENIE ${Math.max(0, core.meltdownRemaining).toFixed(2)} s${core.chainDepth ? ` · łańcuch ${core.chainDepth}` : ''}`);
  ctx.font = '11px ui-monospace, Consolas, monospace';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10;
  const x = s.x + 14;
  const y = s.y - 16 - lines.length * 13;
  ctx.fillStyle = 'rgba(5,10,14,0.72)';
  ctx.fillRect(x - 4, y - 11, w, lines.length * 13 + 6);
  ctx.fillStyle = col;
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * 13));
}

function editorKeyFor(entity) {
  return HULLS[entity.__hullId]?.editorKey || entity.__hullId;
}

function markerWorld(entity, marker, layout, out) {
  const g = coreMarkerToGrid(marker, layout, entity.hexGrid);
  gridToLocal(entity, g.gridX, g.gridY, _l);
  return localToWorld(entity, _l.x, _l.y, out);
}

function drawHardpoints(ctx, view, entity) {
  const cfg = SHIP_EDITOR_DEFAULTS.ships[editorKeyFor(entity)];
  if (!cfg || !entity.hexGrid) return;
  const layout = entity.__coreLayout || computeCoreLayout(entity.__pngWidth, entity.__pngHeight, entity.hexGrid);
  const s = { x: 0, y: 0 };
  const dot = (m, col, r) => {
    markerWorld(entity, m, layout, _w);
    worldToScreen(view, _w.x, _w.y, s);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
  };
  for (const m of cfg.hardpoints || []) dot(m, 'rgba(255,70,70,0.85)', 3);
  for (const m of [...(cfg.engines?.main || []), ...(cfg.engines?.side || [])]) dot(m, 'rgba(255,170,40,0.9)', 3);
}

function drawCandidates(ctx, view, entity) {
  const def = HULLS[entity.__hullId];
  if (!def?.candidates || !entity.hexGrid) return;
  const layout = entity.__coreLayout || computeCoreLayout(entity.__pngWidth, entity.__pngHeight, entity.hexGrid);
  const s = { x: 0, y: 0 };
  ctx.font = '11px ui-monospace, Consolas, monospace';
  for (const cand of def.candidates) {
    for (const m of expandCandidate(cand)) {
      markerWorld(entity, m, layout, _w);
      worldToScreen(view, _w.x, _w.y, s);
      ctx.strokeStyle = 'rgba(120,255,140,0.55)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(s.x, s.y, m.r * layout.uniform * view.zoom, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(160,255,170,0.9)';
      ctx.fillText(cand.id.split('_').pop(), s.x - 3, s.y + 4);
    }
  }
}

// Duchy uśpionych błędów integracji (PORT-rdzen.md, poprawki 1 i 2).
function drawBugGhosts(ctx, view, entity) {
  if (!entity.hexGrid) return;
  const layout = entity.__coreLayout || computeCoreLayout(entity.__pngWidth, entity.__pngHeight, entity.hexGrid);
  const s = { x: 0, y: 0 };
  ctx.font = '11px ui-monospace, Consolas, monospace';
  const ghost = (m, label, col) => {
    markerWorld(entity, m, layout, _w);
    worldToScreen(view, _w.x, _w.y, s);
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(s.x - 7, s.y - 7); ctx.lineTo(s.x + 7, s.y + 7);
    ctx.moveTo(s.x + 7, s.y - 7); ctx.lineTo(s.x - 7, s.y + 7);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillText(label, s.x + 9, s.y - 6);
  };
  if (entity.isPlayer) {
    // #1: buildPlayerDefaultEditorCores mnoży przez __hardpointScaleX, potem
    // getEntityCoreLocalPos drugi raz → marker ląduje w skali ×layout od środka.
    for (const core of entity.shipCores || []) {
      const m = core.marker;
      ghost({ x: m.x * layout.x, y: m.y * layout.y }, `#1 ${core.id} ×${layout.x.toFixed(2)}²`, 'rgba(255,90,220,0.95)');
    }
  }
  if (entity.__hullId === 'pirate_battleship') {
    // #2: toEditorHullAlias('pirate_battleship') = 'battleship' → gracz na Iron
    // Skullu dostaje rdzenie (i hardpointy) Bellatora w SWOJEJ skali.
    for (const m of HULLS.battleship.cores) ghost(m, `#2 ${m.id} (Bellator)`, 'rgba(255,140,60,0.95)');
  }
}

function drawGun(ctx, view, gun, aim, info) {
  if (!gun) return;
  const s = worldToScreen(view, gun.x, gun.y, {});
  const a = aim ? worldToScreen(view, aim.x, aim.y, {}) : null;
  if (a) {
    ctx.strokeStyle = info.lock ? 'rgba(255,90,80,0.55)' : 'rgba(140,220,255,0.35)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(a.x, a.y); ctx.stroke();
    ctx.setLineDash([]);
    if (info.lock) {
      ctx.strokeStyle = 'rgba(255,90,80,0.9)';
      ctx.beginPath(); ctx.arc(a.x, a.y, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a.x - 15, a.y); ctx.lineTo(a.x - 6, a.y); ctx.moveTo(a.x + 6, a.y); ctx.lineTo(a.x + 15, a.y);
      ctx.moveTo(a.x, a.y - 15); ctx.lineTo(a.x, a.y - 6); ctx.moveTo(a.x, a.y + 6); ctx.lineTo(a.x, a.y + 15); ctx.stroke();
    }
  }
  ctx.fillStyle = '#9fd8ff';
  ctx.strokeStyle = '#0b2230';
  ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.font = '11px ui-monospace, Consolas, monospace';
  ctx.fillStyle = '#cfefff';
  ctx.fillText(info.weaponName || '', s.x + 11, s.y + 4);
}

function drawRockets(ctx, view, rockets) {
  const s = { x: 0, y: 0 };
  ctx.fillStyle = '#ffbb77';
  for (const r of rockets) {
    worldToScreen(view, r.x, r.y, s);
    ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
  }
}

/**
 * @param view { camX, camY, zoom, W, H }
 * @param world { ships, destructibles, cores, gun, aim, rockets, editor }
 * @param opts  { grid, chamber, probe, state, hp, cands, bugs, blast, lock, weaponName }
 */
export function drawOverlays2D(ctx, view, world, opts) {
  ctx.save();
  if (opts.grid) for (const e of world.destructibles) drawGrid(ctx, view, e);
  if (opts.hp) for (const e of world.ships) drawHardpoints(ctx, view, e);
  if (opts.cands) for (const e of world.ships) drawCandidates(ctx, view, e);
  if (opts.bugs) for (const e of world.ships) drawBugGhosts(ctx, view, e);
  if (opts.chamber) {
    for (const core of world.cores) {
      if (core.state === CORE_STATE.DETONATED || !core.host?.hexGrid || core.host.dead) continue;
      drawChamber(ctx, view, core, opts);
    }
  }
  if (world.editor?.active && world.editor.selected) {
    const s = worldToScreen(view, world.editor.selected.x, world.editor.selected.y, {});
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(8, world.editor.selected.r * view.zoom), 0, Math.PI * 2); ctx.stroke();
  }
  drawRockets(ctx, view, world.rockets || []);
  drawGun(ctx, view, world.gun, world.aim, opts);
  ctx.restore();
}
