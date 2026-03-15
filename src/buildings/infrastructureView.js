import { initShipyardState, updateShipyardVisuals, drawComplexShipyard } from './shipyardVisuals.js';

function drawSolarIcon(ctx) {
  ctx.save();
  const grad = ctx.createRadialGradient(0, 0, 6, 0, 0, 32);
  grad.addColorStop(0, '#fff7cc');
  grad.addColorStop(0.5, '#fde68a');
  grad.addColorStop(1, '#f59e0b');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(79,129,255,0.9)'; ctx.fillStyle = 'rgba(59,89,178,0.85)'; ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    ctx.save(); ctx.rotate((Math.PI / 2) * i);
    ctx.beginPath(); ctx.rect(18, -9, 30, 18); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawStorageIcon(ctx, color, label) {
  ctx.save();
  ctx.fillStyle = 'rgba(10,16,34,0.95)';
  ctx.strokeStyle = color || '#60a5fa'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.rect(-30, -24, 60, 48); ctx.fill(); ctx.stroke();
  ctx.fillStyle = (color || '#60a5fa') + '33'; ctx.fillRect(-24, -6, 48, 12);
  ctx.fillStyle = color || '#60a5fa'; ctx.fillRect(-28, 18, 56, 6);
  ctx.fillStyle = '#dbeafe'; ctx.font = 'bold 18px Inter, system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label || 'S', 0, -4);
  ctx.restore();
}

function drawSensorIcon(ctx) {
  ctx.save();
  // Dish base
  ctx.fillStyle = 'rgba(10,16,34,0.9)';
  ctx.strokeStyle = '#14b8a6'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 20, Math.PI * 0.8, Math.PI * 0.2, true);
  ctx.lineTo(6, 8);
  ctx.lineTo(-6, 8);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Antenna
  ctx.strokeStyle = '#5eead4'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(0, -28); ctx.stroke();
  // Signal waves
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const r = 10 + i * 8;
    ctx.globalAlpha = 0.7 - i * 0.2;
    ctx.strokeStyle = '#14b8a6';
    ctx.beginPath();
    ctx.arc(0, -28, r, -Math.PI * 0.4, Math.PI * 0.4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGenericIcon(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(56,80,160,0.9)';
  ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(20, 0); ctx.lineTo(0, 24); ctx.lineTo(-20, 0);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(160,200,255,0.8)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}

export function updateInfrastructureAnimations(dt) {
  if (!window.Game || !window.Game.infrastructure) return;

  // Ensure fighter sprite is loaded (lazy load check)
  if (!window.fighterSprite && !window.fighterSpriteLoading) {
    window.fighterSpriteLoading = true;
    const img = new Image();
    img.src = './assets/fighter.png';
    img.onload = () => { window.fighterSprite = img; window.fighterSpriteLoading = false; };
    img.onerror = () => { window.fighterSpriteLoading = false; };
  }

  window.Game.infrastructure.forEach((list) => {
    for (const inst of list) {
      if (inst.buildingId === 'shipyard_s') {
        updateShipyardVisuals(inst, dt);
      }
    }
  });
}

export function drawInfrastructureIcon(ctx, building, center, size, alpha = 1, instanceData = null) {
  if (!ctx || !building || !center) return;

  if (instanceData && building.id === 'shipyard_s') {
    const rotation = instanceData.rotation || 0;
    drawComplexShipyard(ctx, instanceData, center, size, rotation);
    return;
  }

  ctx.save();
  ctx.translate(center.x, center.y);
  const scale = size > 0 ? (size / 96) : 1;
  ctx.scale(scale, scale);
  ctx.globalAlpha *= alpha;

  switch (building.icon) {
    case 'solar':
      drawSolarIcon(ctx);
      break;
    case 'storage':
      drawStorageIcon(ctx, building.color, building.label);
      break;
    case 'sensor':
      drawSensorIcon(ctx);
      break;
    default:
      if (building.icon === 'shipyard') {
        drawStorageIcon(ctx, '#38bdf8', building.tier || 'S');
      } else {
        drawGenericIcon(ctx);
      }
      break;
  }
  ctx.restore();
}

window.drawInfrastructureIcon = drawInfrastructureIcon;
window.updateInfrastructureAnimations = updateInfrastructureAnimations;
