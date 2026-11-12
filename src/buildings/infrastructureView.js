// Ikony budynków edytora infrastruktury stacji (lista budynków i siatka edytora) — w świecie gry się nie rysują.

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

export function drawInfrastructureIcon(ctx, building, center, size, alpha = 1) {
  if (!ctx || !building || !center) return;

  ctx.save();
  ctx.translate(center.x, center.y);
  const scale = size > 0 ? (size / 96) : 1;
  ctx.scale(scale, scale);
  ctx.globalAlpha *= alpha;

  switch (building.icon) {
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
