const STYLE_ID = 'radar-targeting-ui-style';
const ROOT_ID = 'radar-targeting-labels';

const STYLES = `
#${ROOT_ID} { position:fixed; bottom:160px; left:50%; transform:translateX(-50%); display:flex; flex-wrap:wrap; gap:8px; justify-content:center; max-width:90vw; pointer-events:none; z-index:200; }
#${ROOT_ID} .label-container { position:relative; pointer-events:none; display:none; flex-shrink:0; }
#${ROOT_ID} .target-label {
  position:relative; color:#33ff33; font-family:'Courier New', Courier, monospace;
  font-size:11px; background:rgba(4,12,20,0.8); padding:6px 8px;
  box-shadow:0 0 5px rgba(51,255,51,0.2); border-left:2px solid #33ff33; border-right:1px solid transparent;
  pointer-events:auto; cursor:crosshair; text-transform:uppercase; transform-origin:left center;
  animation:radar-frame-enter 0.3s cubic-bezier(0.25,0.46,0.45,0.94) forwards; opacity:0.75;
  will-change:transform; max-width:140px;
  transition:background 0.15s,border-color 0.15s,transform 0.1s,opacity 0.2s,max-width 0.3s cubic-bezier(0.25,1,0.5,1) 0s;
}
#${ROOT_ID} .target-label:hover { background:rgba(10,40,20,0.95); border-color:#aaffaa; opacity:1; }
#${ROOT_ID} .target-label.locked {
  background:rgba(40,5,5,0.9); border-left:3px solid #ff3333; border-right:1px solid #ff3333;
  color:#ffaa33; box-shadow:0 0 10px rgba(255,51,51,0.5); animation:none; opacity:1;
}
#${ROOT_ID} .target-label.scanned {
  max-width:360px;
  transition:background 0.15s,border-color 0.15s,transform 0.1s,opacity 0.2s,max-width 0.3s cubic-bezier(0.25,1,0.5,1) 0.3s;
}
#${ROOT_ID} .target-label table { border-collapse:collapse; border:none; width:100%; }
#${ROOT_ID} .target-label td { padding:1px 2px; border:none; white-space:nowrap; }
#${ROOT_ID} .target-label .hdr { color:#4ade80; font-weight:bold; transition:color 0.2s; padding-right:8px; }
#${ROOT_ID} .target-label.locked .hdr { color:#ef4444; }
#${ROOT_ID} .action-menu {
  max-height:0; opacity:0; overflow:hidden;
  transition:max-height 0.3s cubic-bezier(0.25,1,0.5,1),opacity 0.2s ease-in-out,margin-top 0.2s ease-in-out;
  display:flex; flex-direction:column; gap:4px;
}
#${ROOT_ID} .target-label.expanded .action-menu { max-height:150px; opacity:1; margin-top:8px; }
#${ROOT_ID} .action-menu::before {
  content:''; display:block; width:100%; height:1px; background:linear-gradient(90deg, rgba(51,255,51,0.8), transparent);
  margin-bottom:4px; transition:background 0.2s;
}
#${ROOT_ID} .target-label.locked .action-menu::before { background:linear-gradient(90deg, rgba(239,68,68,0.8), transparent); }
#${ROOT_ID} .action-btn {
  background:rgba(6,20,30,0.8); border:1px solid rgba(51,255,51,0.3); color:#94a3b8; padding:5px 8px;
  font-family:inherit; font-size:10px; text-transform:uppercase; cursor:pointer; text-align:left;
  transition:background 0.2s,color 0.2s,border-color 0.2s,padding-left 0.2s;
}
#${ROOT_ID} .action-btn:hover { background:rgba(51,255,51,0.2); color:#e0f2fe; border-color:#33ff33; padding-left:12px; }
#${ROOT_ID} .action-btn.scan-btn { border-color:rgba(56,189,248,0.4); color:#bae6fd; }
#${ROOT_ID} .action-btn.scan-btn:hover { background:rgba(56,189,248,0.2); color:#e0f2fe; border-color:#38bdf8; }
#${ROOT_ID} .scan-results {
  max-height:0; opacity:0; overflow:hidden; display:flex; flex-direction:row; gap:15px;
  font-size:9px; color:#bae6fd; cursor:default;
  transition:max-height 0.3s cubic-bezier(0.25,1,0.5,1) 0.3s, opacity 0.2s ease-in-out 0.3s;
}
#${ROOT_ID} .target-label.scanned .scan-results {
  max-height:250px; opacity:1; margin-top:8px;
  transition:max-height 0.3s cubic-bezier(0.25,1,0.5,1) 0s, opacity 0.2s ease-in-out 0s;
}
#${ROOT_ID} .scan-col-text { flex:1; display:flex; flex-direction:column; gap:2px; min-width:120px; }
#${ROOT_ID} .scan-col-blueprint { width:180px; display:flex; flex-direction:column; gap:2px; opacity:0; transition:opacity 0.2s ease-in-out 0s; }
#${ROOT_ID} .target-label.scanned .scan-col-blueprint { opacity:1; transition:opacity 0.4s ease-in-out 0.6s; }
#${ROOT_ID} .blueprint-canvas {
  background:rgba(4,12,20,0.5); border:1px solid rgba(56,189,248,0.2); border-radius:4px; margin-top:4px;
  box-shadow:inset 0 0 10px rgba(56,189,248,0.1);
}
#${ROOT_ID} .scan-hdr { color:#38bdf8; font-weight:bold; border-bottom:1px solid rgba(56,189,248,0.3); margin-top:6px; padding-bottom:2px; }
#${ROOT_ID} .scan-row { display:flex; justify-content:space-between; padding:1px 0; gap:8px; }
#${ROOT_ID} .scan-row span:first-child { color:#7dd3fc; }
#${ROOT_ID} .scan-row span:last-child { color:#e0f2fe; font-weight:bold; text-align:right; }
#${ROOT_ID} .glitch-text { opacity:0; animation:radar-text-glitch 0.45s steps(8) forwards; animation-delay:0.1s; }
@keyframes radar-frame-enter {
  0% { transform:scaleX(0) scaleY(0.02); opacity:0; background:rgba(51,255,51,0.9); }
  30% { transform:scaleX(1) scaleY(0.02); opacity:1; background:rgba(51,255,51,0.6); }
  60% { transform:scaleX(1) scaleY(1.1); background:rgba(4,12,20,0.8); }
  100% { transform:scaleX(1) scaleY(1); opacity:1; }
}
@keyframes radar-text-glitch {
  0% { opacity:0; clip-path:inset(50% 0 50% 0); transform:translateX(-15px); }
  10% { opacity:1; clip-path:inset(10% 0 60% 0); transform:translateX(10px); text-shadow:2px 0 #33ff33, -2px 0 #ff3333; }
  20% { clip-path:inset(80% 0 5% 0); transform:translateX(-5px); text-shadow:-2px 0 #33ff33, 2px 0 #ff3333; }
  30% { clip-path:inset(20% 0 30% 0); transform:translateX(4px); text-shadow:2px 0 #33ff33, -2px 0 #ff3333; }
  45% { clip-path:inset(0 0 0 0); transform:translateX(0); text-shadow:none; }
  100% { opacity:1; clip-path:inset(0 0 0 0); transform:translateX(0); }
}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function createRoot() {
  let root = document.getElementById(ROOT_ID);
  if (root) return root;
  root = document.createElement('div');
  root.id = ROOT_ID;
  document.body.appendChild(root);
  return root;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function projectToScreenEdge(dirX, dirY, width, height, margin) {
  const halfW = (width * 0.5) - margin;
  const halfH = (height * 0.5) - margin;
  const safeX = Math.abs(dirX) < 1e-3 ? 1e-3 : dirX;
  const safeY = Math.abs(dirY) < 1e-3 ? 1e-3 : dirY;
  const scale = Math.min(halfW / Math.abs(safeX), halfH / Math.abs(safeY));
  return { x: width * 0.5 + dirX * scale, y: height * 0.5 + dirY * scale };
}

function drawBlueprintCanvas(canvas, blueprint) {
  if (!canvas || !blueprint) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const width = Math.max(1, Number(blueprint.width) || 180);
  const height = Math.max(1, Number(blueprint.height) || 120);
  const padding = 16;
  const scale = Math.min((canvas.width - padding) / width, (canvas.height - padding) / height);

  ctx.save();
  ctx.translate(canvas.width * 0.5, canvas.height * 0.5);
  ctx.scale(scale, scale);

  const shards = Array.isArray(blueprint.shards) ? blueprint.shards : [];
  for (let i = 0; i < shards.length; i++) {
    const shard = shards[i];
    if (!shard) continue;
    const hpRatio = clamp((Number(shard.hp) || 0) / Math.max(1, Number(shard.maxHp) || 1), 0, 1);
    const alpha = shard.active === false ? 0.18 : (0.18 + hpRatio * 0.55);
    const fill = shard.active === false
      ? `rgba(71,85,105,${alpha})`
      : `rgba(${Math.round(30 + (1 - hpRatio) * 190)}, ${Math.round(180 + hpRatio * 50)}, ${Math.round(220 * hpRatio)}, ${alpha})`;
    ctx.fillStyle = fill;
    ctx.fillRect(shard.x - 2, shard.y - 2, 4, 4);
  }

  const hardpoints = Array.isArray(blueprint.hardpoints) ? blueprint.hardpoints : [];
  for (let i = 0; i < hardpoints.length; i++) {
    const hp = hardpoints[i];
    if (!hp) continue;
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = hp.destroyed ? '#ef4444' : '#38bdf8';
    ctx.shadowBlur = 10;
    ctx.shadowColor = hp.destroyed ? 'rgba(239,68,68,0.5)' : 'rgba(56,189,248,0.45)';
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  const cores = Array.isArray(blueprint.cores) ? blueprint.cores : [];
  for (let i = 0; i < cores.length; i++) {
    const core = cores[i];
    if (!core) continue;
    ctx.beginPath();
    ctx.rect(core.x - 4, core.y - 4, 8, 8);
    ctx.strokeStyle = core.destroyed ? '#f97316' : '#f8fafc';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

function buildScanHtml(data, unitId) {
  const weapons = Array.isArray(data?.weapons) ? data.weapons : [];
  const cargo = Array.isArray(data?.cargo) ? data.cargo : [];
  let hpRows = weapons.map(w => `<div class="scan-row"><span>${w.type}</span><span>${w.count}x ${w.name}</span></div>`).join('');
  let cargoRows = cargo.map(c => `<div class="scan-row"><span>${c.name}</span><span>${c.amount}</span></div>`).join('');
  if (!hpRows) hpRows = `<div class="scan-row"><span>-</span><span>Brak Danych</span></div>`;
  if (!cargoRows) cargoRows = `<div class="scan-row"><span>-</span><span>Pusta</span></div>`;
  return `
    <div class="scan-col-text">
      <div class="scan-hdr">UZBROJENIE</div>${hpRows}
      <div class="scan-hdr">LADOWNIA</div>${cargoRows}
    </div>
    <div class="scan-col-blueprint">
      <div class="scan-hdr" style="margin-top:6px;">HARDPOINT HEALTH</div>
      <canvas id="blueprint-${unitId}" class="blueprint-canvas" width="180" height="120"></canvas>
    </div>
  `;
}

export function initRadarTargetingUI(opts = {}) {
  ensureStyles();
  const root = createRoot();
  const states = new WeakMap();
  let lastRuntime = null;
  let enabled = false;

  function getState(target) {
    let state = states.get(target);
    if (state) return state;
    state = {
      isDeepScanned: false,
      isScanning: false,
      scanTimer: 0,
      lastDist: -1,
      blueprintDrawn: false,
      meta: null,
      scanData: null,
      containerEl: null,
      labelEl: null,
      distEl: null
    };
    states.set(target, state);
    return state;
  }

  function collapseOtherLabels(current) {
    root.querySelectorAll('.target-label.expanded').forEach((el) => {
      if (el !== current) el.classList.remove('expanded');
    });
  }

  function clearLocks() {
    opts.clearLocks?.();
  }

  function ensureLabel(target, runtime) {
    const state = getState(target);
    if (state.containerEl && state.labelEl) return state;
    const meta = runtime.getMeta(target);
    const container = document.createElement('div');
    container.className = 'label-container';
    const label = document.createElement('div');
    label.className = 'target-label';

    const buildInnerHtml = () => {
      const statusDisplay = runtime.isLocked(target) ? 'table-row' : 'none';
      const scanHtml = state.scanData ? buildScanHtml(state.scanData, meta.unitId) : '';
      return `
        <table class="glitch-text">
          <tr><td class="hdr">NAME</td><td>${meta.unitId}</td></tr>
          <tr><td class="hdr">CLASS</td><td>${meta.unitClass}</td></tr>
          <tr class="dist-row"><td class="hdr">DST</td><td class="dist-val">0 u</td></tr>
          <tr class="status-row" style="display:${statusDisplay};"><td colspan="2" class="hdr" style="color:#ff4444; text-align:center;">LOCKED</td></tr>
        </table>
        <div class="scan-results">${scanHtml}</div>
        <div class="action-menu">
          <button class="action-btn" data-action="approach">▶ Approach</button>
          <button class="action-btn" data-action="orbit">▶ Orbit</button>
          <button class="action-btn" data-action="warp">▶ Jump (Warp)</button>
          <button class="action-btn scan-btn" data-action="scan">▶ Direct Scan</button>
        </div>
      `;
    };

    label.innerHTML = buildInnerHtml();
    label.addEventListener('click', (e) => {
      if (e.target.closest('.action-btn') || e.target.closest('.scan-results')) return;
      runtime.toggleLock(target);
      applyLockClass(label, runtime.isLocked(target));
    });
    label.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      collapseOtherLabels(label);
      label.classList.toggle('expanded');
    });
    label.querySelectorAll('.action-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'scan') {
          state.isScanning = true;
          state.scanTimer = Number(runtime.deepScanDuration) || 2;
          label.classList.remove('expanded');
          runtime.onStatus?.(`ROZKAZ: GLEBOKI SKAN ${meta.unitId}...`);
          return;
        }
        runtime.onAction?.(action, target);
        label.classList.remove('expanded');
      });
    });

    state.meta = meta;
    state.containerEl = container;
    state.containerEl.__targetRef = target;
    state.labelEl = label;
    state.distEl = label.querySelector('.dist-val');
    container.appendChild(label);
    root.appendChild(container);
    applyLockClass(label, runtime.isLocked(target));
    return state;
  }

  function applyLockClass(label, locked) {
    if (!label) return;
    label.classList.toggle('locked', !!locked);
    const row = label.querySelector('.status-row');
    if (row) row.style.display = locked ? 'table-row' : 'none';
  }

  function updateScanVisuals(target, runtime, state) {
    if (!state.labelEl) return;
    if (state.isScanning) {
      state.scanTimer -= runtime.dt;
      if (state.scanTimer <= 0) {
        state.isScanning = false;
        state.isDeepScanned = true;
        state.scanData = runtime.getScanData(target);
        state.blueprintDrawn = false;
        state.labelEl.classList.add('scanned');
        state.labelEl.innerHTML = state.labelEl.innerHTML.replace('<div class="scan-results"></div>', `<div class="scan-results">${buildScanHtml(state.scanData, state.meta.unitId)}</div>`);
        state.distEl = state.labelEl.querySelector('.dist-val');
        applyLockClass(state.labelEl, runtime.isLocked(target));
        state.labelEl.querySelectorAll('.action-btn').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'scan') return;
            runtime.onAction?.(action, target);
            state.labelEl.classList.remove('expanded');
          });
        });
        runtime.onDeepScanComplete?.(target);
      }
    }
    if (state.isDeepScanned && !state.blueprintDrawn) {
      const cvs = document.getElementById(`blueprint-${state.meta.unitId}`);
      if (cvs) {
        drawBlueprintCanvas(cvs, state.scanData?.blueprint);
        state.blueprintDrawn = true;
      }
    }
  }

  function hideAll() {
    root.querySelectorAll('.label-container').forEach((el) => { el.style.display = 'none'; });
  }

  function closeExpandedMenus() {
    root.querySelectorAll('.target-label.expanded').forEach((el) => el.classList.remove('expanded'));
  }

  function isTargetVisibleOnScreen(target, runtime) {
    if (!target || !runtime?.worldToScreen) return false;
    const s = runtime.worldToScreen(target.x, target.y, runtime.camera);
    return s.x >= 0 && s.x <= runtime.width && s.y >= 0 && s.y <= runtime.height;
  }

  function togglePrimaryActionMenu() {
    if (!enabled || !lastRuntime) return null;
    const targets = Array.isArray(lastRuntime.targets) ? lastRuntime.targets : [];
    const visibleTargets = targets.filter((target) => target && !target.dead && isTargetVisibleOnScreen(target, lastRuntime));
    if (!visibleTargets.length) {
      closeExpandedMenus();
      return null;
    }

    let target = visibleTargets.find((item) => lastRuntime.isLocked?.(item)) || null;
    if (!target) {
      target = visibleTargets
        .slice()
        .sort((a, b) => (lastRuntime.distanceTo?.(a) || 0) - (lastRuntime.distanceTo?.(b) || 0))[0] || null;
    }
    if (!target) {
      closeExpandedMenus();
      return null;
    }

    const state = ensureLabel(target, lastRuntime);
    const label = state?.labelEl;
    if (!label) return null;

    const wasExpanded = label.classList.contains('expanded');
    collapseOtherLabels(label);
    label.classList.toggle('expanded', !wasExpanded);
    return target;
  }

  window.addEventListener('click', (e) => {
    if (!enabled) return;
    if (!e.target.closest('.target-label')) {
      root.querySelectorAll('.target-label.expanded').forEach((el) => el.classList.remove('expanded'));
    }
  });

  function update(runtime) {
    lastRuntime = runtime;
    enabled = !!runtime.enabled;
    if (!enabled) {
      hideAll();
      return;
    }

    const active = new Set();
    const targets = Array.isArray(runtime.targets) ? runtime.targets : [];
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (!target || target.dead) continue;
      active.add(target);
      const state = ensureLabel(target, runtime);
      updateScanVisuals(target, runtime, state);
      state.containerEl.style.display = 'block';

      const dist = Math.round(runtime.distanceTo(target));
      if (state.distEl && state.lastDist !== dist) {
        state.lastDist = dist;
        state.distEl.textContent = `${dist} u`;
      }
      applyLockClass(state.labelEl, runtime.isLocked(target));
    }

    root.querySelectorAll('.label-container').forEach((node) => {
      const target = node.__targetRef;
      if (target && !active.has(target)) node.style.display = 'none';
    });
  }

  function draw(ctx, runtime) {
    if (!enabled) return;
    const targets = Array.isArray(runtime.targets) ? runtime.targets : [];
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (!target || target.dead) continue;
      const state = getState(target);
      const meta = state.meta || runtime.getMeta(target);
      const s = runtime.worldToScreen(target.x, target.y, runtime.camera);
      const offscreen = s.x < 0 || s.x > runtime.width || s.y < 0 || s.y > runtime.height;
      const zoomFactor = Math.max(0.0001, Number(runtime.camera?.zoom) || 1);
      const baseRad = Math.max(18, ((meta.shipLength || target.radius || 40) * 0.5 + 10) * zoomFactor);

      if (runtime.isLocked(target) && offscreen) {
        const cx = runtime.width * 0.5;
        const cy = runtime.height * 0.5;
        const dirX = s.x - cx;
        const dirY = s.y - cy;
        const edge = projectToScreenEdge(dirX, dirY, runtime.width, runtime.height, 30);
        const angle = Math.atan2(dirY, dirX);
        ctx.save();
        ctx.translate(edge.x, edge.y);
        ctx.rotate(angle);
        ctx.fillStyle = 'rgba(239,68,68,0.8)';
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(239,68,68,0.5)';
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(-10, -8);
        ctx.lineTo(-5, 0);
        ctx.lineTo(-10, 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        continue;
      }

      if (offscreen) continue;

      if (state.isDeepScanned && !state.isScanning) {
        const futureX = target.x + (Number(target.vx) || 0) * 2.0;
        const futureY = target.y + (Number(target.vy) || 0) * 2.0;
        const f = runtime.worldToScreen(futureX, futureY, runtime.camera);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(f.x, f.y);
        ctx.strokeStyle = 'rgba(251,191,36,0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(f.x, f.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251,191,36,0.6)';
        ctx.fill();
        ctx.restore();
      }

      if (state.isScanning) {
        const progress = 1 - (state.scanTimer / Math.max(0.001, runtime.deepScanDuration));
        const hw = ((meta.shipLength || 40) * zoomFactor) * 0.5;
        const hh = ((meta.shipWidth || 20) * zoomFactor) * 0.5;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(Number(target.angle) || 0);
        ctx.strokeStyle = 'rgba(56,189,248,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-hw - 4, -hh - 4, hw * 2 + 8, hh * 2 + 8);
        const scanX = -hw + (hw * 2) * progress;
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(scanX, -hh - 12);
        ctx.lineTo(scanX, hh + 12);
        ctx.stroke();
        ctx.fillStyle = 'rgba(56,189,248,0.15)';
        ctx.fillRect(-hw, -hh, scanX + hw, hh * 2);
        ctx.restore();
      }

      if (!runtime.isLocked(target)) continue;
      const pulse = 0.82 + 0.18 * Math.sin(runtime.lockAnim);
      const sweep = runtime.lockAnim % (Math.PI * 2);
      ctx.save();
      ctx.strokeStyle = `rgba(255,110,110,${0.92 * pulse})`;
      ctx.lineWidth = Math.max(2, 3 * Math.sqrt(zoomFactor));
      ctx.shadowBlur = 16 * zoomFactor;
      ctx.shadowColor = 'rgba(255,90,90,0.45)';
      const inner = baseRad * 0.72;
      ctx.beginPath();
      ctx.moveTo(s.x - baseRad, s.y - inner); ctx.lineTo(s.x - baseRad, s.y - baseRad); ctx.lineTo(s.x - inner, s.y - baseRad);
      ctx.moveTo(s.x + inner, s.y - baseRad); ctx.lineTo(s.x + baseRad, s.y - baseRad); ctx.lineTo(s.x + baseRad, s.y - inner);
      ctx.moveTo(s.x - baseRad, s.y + inner); ctx.lineTo(s.x - baseRad, s.y + baseRad); ctx.lineTo(s.x - inner, s.y + baseRad);
      ctx.moveTo(s.x + inner, s.y + baseRad); ctx.lineTo(s.x + baseRad, s.y + baseRad); ctx.lineTo(s.x + baseRad, s.y + inner);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(6, baseRad * 0.22), sweep - 0.42, sweep + 0.42);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([5 * zoomFactor, 5 * zoomFactor]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, baseRad + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  return {
    update,
    draw,
    isEnabled: () => enabled,
    hide: hideAll,
    closeExpandedMenus,
    togglePrimaryActionMenu
  };
}
