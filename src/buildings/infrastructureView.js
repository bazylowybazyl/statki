import { initShipyardState, updateShipyardVisuals, drawComplexShipyard } from './shipyardVisuals.js';

// --- STARE PROSTE IKONY ---

function drawSolarIcon(ctx) {
  ctx.save();
  const grad = ctx.createRadialGradient(0, 0, 6, 0, 0, 32);
  grad.addColorStop(0, '#fff7cc');
  grad.addColorStop(0.5, '#fde68a');
  grad.addColorStop(1, '#f59e0b');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(79,129,255,0.9)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((Math.PI / 2) * i);
    ctx.beginPath();
    ctx.rect(18, -9, 30, 18);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawStorageIcon(ctx, color, label) {
  ctx.save();
  ctx.fillStyle = 'rgba(10,16,34,0.95)';
  ctx.strokeStyle = color || '#60a5fa';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(-30, -24, 60, 48);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = (color || '#60a5fa') + '33';
  ctx.fillRect(-24, -6, 48, 12);
  ctx.fillStyle = color || '#60a5fa';
  ctx.fillRect(-28, 18, 56, 6);
  ctx.fillStyle = '#dbeafe';
  ctx.font = 'bold 18px Inter, system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label || 'S', 0, -4);
  ctx.restore();
}

function drawGenericIcon(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(56,80,160,0.9)';
  ctx.beginPath();
  ctx.moveTo(0, -24);
  ctx.lineTo(20, 0);
  ctx.lineTo(0, 24);
  ctx.lineTo(-20, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,200,255,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

// --- LOGIKA GŁÓWNA ---

// Funkcja wywoływana co klatkę w physicsStep lub render loopie
// Aktualizuje animacje budynków
export function updateInfrastructureAnimations(dt) {
    if (!window.Game || !window.Game.infrastructure) return;
    
    window.Game.infrastructure.forEach((list) => {
        for (const inst of list) {
            // Jeśli to stocznia (dowolnego tieru)
            if (inst.buildingId.includes('shipyard')) {
                updateShipyardVisuals(inst, dt);
            }
        }
    });
}

// Funkcja rysująca (podmieniamy nią drawInfrastructureIcon w index.html)
export function drawInfrastructureIcon(ctx, building, center, size, alpha = 1, instanceData = null) {
  if (!ctx || !building || !center) return;

  // 1. ZAAWANSOWANA STOCZNIA
  // Rysujemy ją tylko jeśli to faktycznie zbudowana instancja (instanceData != null)
  // W podglądzie budowy (grid) rysujemy uproszczoną ikonę
  if (instanceData && building.id.includes('shipyard')) {
     drawComplexShipyard(ctx, instanceData, center, size, 1.0);
     return;
  }

  // 2. STANDARDOWE IKONY (Fallback)
  ctx.save();
  ctx.translate(center.x, center.y);
  // size to szerokość kafelka w px. Ikony są skalowane do ~96px bazowo.
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
    // Możesz tu dodać inne (np. refineries)
    default:
      // Dla stoczni w trybie podglądu (przed zbudowaniem) rysujemy generyczną ikonę
      // lub uproszczoną wersję
      if (building.icon === 'shipyard') {
          drawStorageIcon(ctx, '#38bdf8', building.tier || 'S'); 
      } else {
          drawGenericIcon(ctx);
      }
      break;
  }
  ctx.restore();
}

// Eksport globalny dla index.html (jeśli nie używasz bundlera)
window.drawInfrastructureIcon = drawInfrastructureIcon;
window.updateInfrastructureAnimations = updateInfrastructureAnimations;
```

### Instrukcja integracji w `index.html`

1.  **Dodaj importy:**
    Na górze skryptu modułowego (tam gdzie importujesz `THREE`):
    ```javascript
    import { drawInfrastructureIcon, updateInfrastructureAnimations } from './src/buildings/infrastructureView.js';
    ```

2.  **Podepnij pętlę aktualizacji:**
    W funkcji `physicsStep(dt)` dodaj wywołanie:
    ```javascript
    // ... wewnątrz physicsStep ...
    updateInfrastructureState(dt); // To jest logika budowania (istniejąca)
    
    // DODAJ NOWE: Aktualizacja wizualna (animacje fabryki)
    updateInfrastructureAnimations(dt); 
    // ...
    ```

3.  **Podmień wywołania rysowania:**
    W `drawInfrastructureInstances`:
    ```javascript
    // STARE: drawInfrastructureIcon(ctx, building, screen, size, 0.95);
    // NOWE: Przekaż 'inst' jako ostatni parametr
    drawInfrastructureIcon(ctx, building, screen, size, 0.95, inst);
    ```

    W `drawInfrastructureGrid` (podgląd siatki):
    ```javascript
    // STARE: drawInfrastructureIcon(ctx, building, centerScreen, iconSize, alpha);
    // NOWE: Przekaż null (brak instancji, tylko ikona)
    drawInfrastructureIcon(ctx, building, centerScreen, iconSize, alpha, null);
    ```

4.  **Wyczyść stare funkcje:**
    Możesz usunąć z `index.html` stare funkcje `drawSolarIcon`, `drawShipyardIcon`, `drawStorageIcon`, `drawGenericIcon` oraz starą wersję `drawInfrastructureIcon`, bo teraz są one w `infrastructureView.js`.

To wszystko! Twoja gra ma teraz w pełni funkcjonalną, animowaną fabrykę myśliwców.
