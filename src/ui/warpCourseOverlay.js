// HUD kursu warpa. Kąty ekranowe dostaje po rzucie worldToScreen (także kamery 3D).
const GREEN = '#75efb0', AMBER = '#ffc978', RED = '#ff897e';
const units = (n) => `${Math.round(Math.max(0, n)).toLocaleString('pl-PL')} j.`;

export function drawWarpCourseHud(ctx, s) {
  const busy = s.state === 'charging' || s.state === 'active' || s.exiting;
  const good = busy ? s.autoExit : s.aligned && s.canWarp;
  const color = good ? GREEN : (busy ? RED : AMBER);
  const x = s.clipX + s.clipW / 2, y = 118, width = Math.min(360, s.clipW - 24);
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
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = '#07131de6';
  ctx.fillRect(x - width / 2, y, width, 106);
  ctx.fillStyle = color;
  ctx.fillRect(x - width / 2, y, 3, 106);
  ctx.textAlign = 'center';
  ctx.font = '12px monospace';
  const label = s.label || 'PUNKT KURSU';
  ctx.fillText(`WARP · ${label}`, x, y + 20, width - 24);
  ctx.font = 'bold 14px monospace';
  let status;
  if (s.exiting) status = 'WYJŚCIE · HAMOWANIE';
  else if (s.state === 'charging') status = s.autoExit ? 'ŁADOWANIE · WYJŚCIE AUTO' : 'ŁADOWANIE · WYJŚCIE RĘCZNE';
  else if (s.state === 'active') {
    if (s.autoExit) status = `WYJŚCIE AUTO ZA ${Math.max(0, s.exitIn).toFixed(1)} s`;
    else status = s.along <= 0 ? 'CEL ZA STATKIEM' : (s.exitIn < -0.15 ? 'ZA PÓŹNO' : (s.exitIn <= 0.15 ? 'WYJDŹ TERAZ [9 / SHIFT]' : `WYJŚCIE ZA ${s.exitIn.toFixed(1)} s`));
  } else if (!s.canWarp) status = 'BLISKO CELU · DOLEĆ NAPĘDEM';
  else if (s.aligned) status = 'KURS OK · ±5° · [9 / SHIFT]';
  else status = `${s.err < 0 ? '← A · W LEWO' : 'D · W PRAWO →'} ${Math.abs(s.err * 180 / Math.PI).toFixed(1)}°`;
  ctx.fillText(status, x, y + 46, width - 24);
  ctx.font = '11px monospace';
  ctx.fillStyle = '#c0d3df';
  ctx.fillText(busy ? `MINIĘCIE PUNKTU: ${units(s.miss)}` : `DO PUNKTU: ${units(s.dist)}`, x, y + 68, width - 24);
  ctx.fillText(s.exiting ? 'Rampa wyjścia zatrzymuje okręt'
    : (good ? (busy ? 'Komputer zakończy skok przy punkcie kursu' : 'Komputer doprecyzuje kurs i zakończy skok')
      : (busy ? 'Bez automatu · puść Shift lub naciśnij 9' : 'Obróć dziób według strzałki · tolerancja ±5°')), x, y + 90, width - 24);
  ctx.restore();
}
