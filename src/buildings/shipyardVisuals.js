// src/buildings/shipyardVisuals.js

const DOCKS_COUNT = 9;

// Konfiguracja kolorów dla różnych stanów
const PALETTE = {
  idle: { base: '#1e293b', light: '#22c55e', accent: '#0ea5e9', hologram: 'rgba(14, 165, 233, 0.05)', glow: 0 },
  working: { base: '#1e293b', light: '#eab308', accent: '#38bdf8', hologram: 'rgba(14, 165, 233, 0.2)', glow: 1 },
  paused: { base: '#1e293b', light: '#f59e0b', accent: '#38bdf8', hologram: 'rgba(14, 165, 233, 0.2)', glow: 0.5 },
  off: { base: '#0f172a', light: '#ef4444', accent: '#334155', hologram: 'rgba(0, 0, 0, 0)', glow: 0 }
};

// Helpery
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Fallbackowy sprite proceduralny (gdyby assets/fighter.png się nie załadował)
let defaultFighterCanvas = null;
function getDefaultFighterSprite() {
  if (defaultFighterCanvas) return defaultFighterCanvas;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.translate(64, 64);
  
  // Kadłub
  ctx.fillStyle = '#475569';
  ctx.beginPath();
  ctx.moveTo(0, -60); ctx.lineTo(20, -10); ctx.lineTo(20, 40);
  ctx.lineTo(10, 55); ctx.lineTo(-10, 55); ctx.lineTo(-20, 40); ctx.lineTo(-20, -10);
  ctx.fill();
  
  // Skrzydła
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(20, 0); ctx.lineTo(60, 30); ctx.lineTo(60, 50); ctx.lineTo(20, 40);
  ctx.moveTo(-20, 0); ctx.lineTo(-60, 30); ctx.lineTo(-60, 50); ctx.lineTo(-20, 40);
  ctx.fill();
  
  // Detale
  ctx.fillStyle = '#38bdf8'; ctx.fillRect(-5, -20, 10, 15); // Kokpit
  ctx.fillStyle = '#ef4444'; ctx.fillRect(-55, 35, 10, 5); ctx.fillRect(45, 35, 10, 5); // Oznaczenia
  
  defaultFighterCanvas = c;
  return c;
}

// Inicjalizacja stanu dla konkretnej instancji budynku w grze
export function initShipyardState(inst) {
  if (inst.visuals) return;

  inst.visuals = {
    docks: Array.from({ length: DOCKS_COUNT }, (_, i) => ({
      id: i,
      phase: 0, // 0=Blueprint, 1=Masa, 2=Sprite, 3=Transport
      progress: Math.random() * 0.2, // Losowy start dla wariacji
      cranePos: 0,
      transportArmPos: 0,
      shipPos: 0,
      gateProgress: 0,
      particles: []
    })),
    simTime: 0,
    producedUnits: 0,
    // Domyślny stan. W przyszłości można to spiąć z systemem energii/surowców gry.
    currentState: 'working' 
  };
}

// Główna pętla logiczna (wywoływana co klatkę dla każdego stoczniowca)
export function updateShipyardVisuals(inst, dt) {
  if (!inst.visuals) initShipyardState(inst);
  const viz = inst.visuals;
  
  // Jeśli gra ma globalną pauzę, można tu dodać warunek
  // Ale zakładamy, że dt=0 w pauzie, więc animacje same staną.
  
  const isWorking = viz.currentState === 'working';
  const isPaused = viz.currentState === 'paused';
  
  if (isWorking) viz.simTime += dt;

  // Wymiary logiczne (te same co w preview)
  const unitLen = 200;
  const unitThick = 180;
  const dockHeight = 60; // Skala bazowa
  const shipH = dockHeight * 0.75;
  const platLen = 100;
  
  // Granice ruchu w doku
  const topY = -shipH / 2;
  const bottomY = shipH / 2;
  const armParkPos = bottomY + 30;

  // Aktualizacja każdego z 9 doków
  viz.docks.forEach(dock => {
    // 1. Postęp produkcji
    if (isWorking) {
      // Prędkość budowy (zróżnicowana per dok)
      const speed = (0.0008 + (dock.id * 0.00005)) * 60 * dt; // Normalizacja do dt
      dock.progress += speed;
      
      if (dock.progress >= 1.0) {
        dock.progress = 0;
        dock.phase++;
        // Po fazie 3 (transport) reset do fazy 0
        if (dock.phase > 3) {
          dock.phase = 0;
          viz.producedUnits++;
        }
      }
    }

    // 2. Logika Maszyn (Suwnica, Ramię, Brama)
    let targetCrane = dock.cranePos;
    let targetArm = dock.transportArmPos;
    let targetGate = 0; // 0=Zamknięta, 1=Otwarta

    if (isWorking || isPaused) {
      if (dock.phase === 0) { // Blueprint (Druk w dół)
        targetCrane = topY + (dock.progress * (bottomY - topY));
        targetArm = armParkPos;
      } else if (dock.phase === 1) { // Masa (Druk w górę)
        targetCrane = bottomY - (dock.progress * (bottomY - topY));
        targetArm = armParkPos;
      } else if (dock.phase === 2) { // Sprite (Malowanie w dół)
        targetCrane = topY + (dock.progress * (bottomY - topY));
        targetArm = armParkPos;
        // Pod koniec malowania uchyl bramę
        if (dock.progress > 0.8) targetGate = 1;
      } else if (dock.phase === 3) { // Transport
        targetCrane = topY - 20; // Suwnica ucieka
        
        const p = dock.progress;
        
        // Brama otwarta dopóki transport trwa, zamyka się na samym końcu
        targetGate = (p < 0.9) ? 1 : 0;
        
        if (p < 0.3) {
          // Dojazd ramienia do statku
          const subP = p / 0.3;
          targetArm = armParkPos - (subP * armParkPos);
          dock.shipPos = 0;
        } else if (p < 0.35) {
          // Chwytanie (pauza)
          targetArm = 0;
          dock.shipPos = 0;
        } else {
          // Wyjazd do GŁÓWNEGO DOKU (300px w lewo)
          const subP = (p - 0.35) / 0.65;
          const exitDist = 300; 
          targetArm = subP * exitDist;
          dock.shipPos = targetArm;
        }
      }
    } else if (viz.currentState === 'idle') {
      targetCrane = topY - 20;
      targetArm = armParkPos;
      dock.shipPos = 0;
      targetGate = 0;
    } 
    // W stanie 'off' maszyny zamarzają w miejscu (brak zasilania)
    
    // Zabezpieczenie: jeśli ramię jest w bramie, brama musi być otwarta
    if (dock.transportArmPos > 130) targetGate = 1;

    // Aplikowanie fizyki (Lerp)
    if (viz.currentState !== 'off' && !isPaused) {
       const lerp = 5.0 * dt; // Prędkość reakcji
       dock.cranePos += (targetCrane - dock.cranePos) * lerp;
       
       if (dock.phase === 3) dock.transportArmPos = targetArm; // Sztywny chwyt w transporcie
       else dock.transportArmPos += (targetArm - dock.transportArmPos) * (lerp * 0.5);
       
       dock.gateProgress += (targetGate - dock.gateProgress) * (lerp * 0.4);
    }

    // System cząsteczek (iskry przy spawaniu/druku)
    if (isWorking) {
       // Aktualizacja istniejących
       for (let i = dock.particles.length - 1; i >= 0; i--) {
         const p = dock.particles[i];
         p.x += p.vx * 60 * dt;
         p.y += p.vy * 60 * dt;
         p.life -= 2.0 * dt;
         if (p.life <= 0) dock.particles.splice(i, 1);
       }
       
       // Spawn nowych (tylko przy drukowaniu)
       if (dock.phase < 3 && Math.random() < (0.5 * 60 * dt)) {
          const scanW = 80; // Przybliżona szerokość statku
          const laserColor = dock.phase===1 ? '#fbbf24' : (dock.phase===2 ? '#ffffff' : '#38bdf8');
          dock.particles.push({
             x: (Math.random()-0.5)*scanW,
             y: dock.cranePos,
             vx: (Math.random()-0.5)*2, vy: (Math.random()-0.5)*2,
             life: 1.0, 
             color: laserColor
          });
       }
    } else {
       dock.particles = [];
    }
  });
}

// Główna funkcja rysująca (wywoływana z infrastructureView)
export function drawComplexShipyard(ctx, inst, centerScreen, size, zoom = 1.0) {
  if (!inst.visuals) return; // Jeśli nie zainicjalizowano, pomiń klatkę
  const viz = inst.visuals;
  const theme = PALETTE[viz.currentState];
  const time = viz.simTime;
  
  // Pobieramy sprite myśliwca z globalnego obiektu window (z index.html)
  // Jeśli nie ma, używamy generatora
  const spriteImg = (window.fighterSprite && window.fighterSprite.width > 0) 
    ? window.fighterSprite 
    : getDefaultFighterSprite();

  ctx.save();
  ctx.translate(centerScreen.x, centerScreen.y);
  
  // Skalowanie: W preview canvas miał ~1800px szerokości dla 9 doków.
  // W grze budynek ma np. rozmiar 128px na siatce.
  // Musimy mocno zmniejszyć rysunek, żeby pasował.
  // 'size' to rozmiar kafelka w pikselach ekranowych (już z zoomem kamery).
  // Budynek zajmuje np. 8x8 kratek, więc size reprezentuje duży obszar.
  // Bazowy rysunek ma ok 1800x2000px.
  // Przeskalujmy tak, żeby pasował w 'size' * scaleFactor.
  
  const artScale = (size / 2400) * 10.0; // Dopasowanie eksperymentalne
  ctx.scale(artScale, artScale);

  const unitLen = 200;
  const unitThick = 180;
  const spacing = 10;
  const totalHeight = DOCKS_COUNT * (unitThick + spacing);
  
  // Layout (identyczny jak w preview)
  const docksX = 150;
  const spineX = docksX + unitLen / 2 + 20;
  const transportX = docksX - unitLen / 2;
  const platLen = 100;
  const mainDockX = transportX - platLen; // Dosunięty dok

  // 1. TŁO DOKU (Podłoga i wnętrze)
  drawMainDockPart(ctx, mainDockX, 0, 200, totalHeight + 100, 'back', viz);

  // 2. KRĘGOSŁUP (Spine)
  ctx.fillStyle = theme.base;
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 4;
  const spineW = 50;
  ctx.fillRect(spineX - spineW/2, -totalHeight/2 - 20, spineW, totalHeight + 40);
  ctx.strokeRect(spineX - spineW/2, -totalHeight/2 - 20, spineW, totalHeight + 40);
  
  // Rury zasilające na kręgosłupie
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(spineX - 15, -totalHeight/2 - 10, 30, totalHeight + 20);
  
  // Animacja przepływu energii
  if (viz.currentState === 'working') {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 20]);
      ctx.lineDashOffset = time * 50; 
      ctx.beginPath();
      ctx.moveTo(spineX, -totalHeight/2 + 10);
      ctx.lineTo(spineX, totalHeight/2 - 10);
      ctx.stroke();
      ctx.setLineDash([]);
  }

  // 3. DOKI I WIEŻE
  const firstDockY = - (DOCKS_COUNT * (unitThick + spacing) - spacing) / 2 + unitThick/2;
  const towerHeight = 120;
  const topTowerY = firstDockY - unitThick/2 - spacing - towerHeight/2;
  const botTowerY = firstDockY + (DOCKS_COUNT - 1) * (unitThick + spacing) + unitThick/2 + spacing + towerHeight/2;
  
  // Górny blok (Storage + Display)
  drawStorageDisplay(ctx, docksX, topTowerY, unitLen, towerHeight, viz);
  ctx.fillStyle = '#334155'; // Łącznik
  ctx.fillRect(docksX + unitLen/2 - 5, topTowerY - 10, spineX - (docksX + unitLen/2) + 5, 20);

  // Dolna wieża (Control Beta)
  drawControlTower(ctx, docksX, botTowerY, unitLen, towerHeight, false, viz);
  ctx.fillRect(docksX + unitLen/2 - 5, botTowerY - 10, spineX - (docksX + unitLen/2) + 5, 20);

  // Linie produkcyjne (9 sztuk)
  for(let i=0; i<DOCKS_COUNT; i++) {
     const dock = viz.docks[i];
     const y = firstDockY + i * (unitThick + spacing);
     drawShipyardUnit(ctx, dock, docksX, y, unitThick, unitLen, viz, spriteImg);
     
     // Łącznik doku z kręgosłupem
     ctx.fillStyle = '#334155';
     const dockRight = docksX + unitLen/2;
     ctx.fillRect(dockRight - 5, y - 5, spineX - dockRight + 5, 10);
     
     // Kropka statusu
     if (viz.currentState !== 'off') {
         const phaseColor = ['#38bdf8', '#fbbf24', '#ffffff', '#22c55e'][dock.phase];
         ctx.fillStyle = phaseColor;
         ctx.fillRect(dockRight + 15, y - 2, 6, 6);
     }
  }

  // 4. DACH DOKU (Przykrywa wszystko co wjechało)
  drawMainDockPart(ctx, mainDockX, 0, 200, totalHeight + 100, 'front', viz);

  ctx.restore();
}

// --- FUNKCJE POMOCNICZE ---

function drawMainDockPart(ctx, x, y, width, height, layer, viz) {
  const dockW = 380; // Szeroki hangar
  ctx.save();
  ctx.translate(x, y);
  
  if (layer === 'back') {
    // Ciemne wnętrze
    ctx.fillStyle = '#050a10';
    ctx.fillRect(-dockW, -height/2 - 20, dockW, height + 40);
    // Wewnętrzne światła serwisowe
    if (viz.currentState !== 'off') {
        ctx.fillStyle = 'rgba(14, 165, 233, 0.1)';
        for (let i=0; i<8; i++) {
            ctx.fillRect(-dockW + 20 + i*40, -height/2, 2, height);
        }
    }
  } else {
    // Front: Dach i bramy
    // Poszycie dachu (zakrywa statek po wjechaniu)
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-dockW, -height/2, dockW - 5, height); // -5 zostawia szczelinę na bramę
    
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
    ctx.strokeRect(-dockW, -height/2, dockW - 5, height);
    
    // Obudowa zewnętrzna
    ctx.fillRect(-dockW - 20, -height/2 - 30, 20, height + 60); 
    ctx.fillRect(-dockW, -height/2 - 30, dockW, 20); 
    ctx.fillRect(-dockW, height/2 + 10, dockW, 20);
    
    // Detale dachu (linie podziału)
    const numSections = 8;
    const sectionH = height / numSections;
    for(let i=0; i<numSections; i++) {
        const sy = -height/2 + i*sectionH;
        ctx.fillStyle = '#263750';
        ctx.fillRect(-dockW + 10, sy + 5, dockW - 40, 2);
        // Nity
        ctx.fillStyle = '#334155';
        ctx.fillRect(-dockW + 20, sy + 15, 6, 6);
        ctx.fillRect(-dockW + 50, sy + 15, 6, 6);
    }
    
    // Bramy (Gates)
    const unitThick = 180; const spacing = 10;
    const startY = -(DOCKS_COUNT * (unitThick + spacing) - spacing) / 2 + unitThick/2;
    const gateH = 140;

    for (let i = 0; i < DOCKS_COUNT; i++) {
        const dy = startY + i * (unitThick + spacing);
        const dock = viz.docks[i];
        const open = dock.gateProgress * (gateH / 2);
        
        ctx.fillStyle = '#475569';
        // Górne i dolne skrzydło bramy
        ctx.fillRect(-5, dy - gateH/2 - open, 10, gateH/2);
        ctx.fillRect(-5, dy + open, 10, gateH/2);
        
        // Paski ostrzegawcze na bramie
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.moveTo(-5, -gateH/2 - open + dy); 
        ctx.lineTo(5, -gateH/2 - open + 10 + dy);
        ctx.lineTo(5, -gateH/2 - open + 5 + dy);
        ctx.lineTo(-5, -gateH/2 - open - 5 + dy);
        ctx.fill();
        
        // Światła statusu bramy (Zielone/Żółte/Czerwone)
        if (viz.currentState !== 'off') {
            ctx.fillStyle = dock.gateProgress > 0.1 ? (dock.gateProgress > 0.9 ? '#22c55e' : '#eab308') : '#ef4444';
            ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
            ctx.fillRect(8, dy - gateH/2 - 10, 4, gateH + 20);
            ctx.shadowBlur = 0;
        }
    }
    
    // Napis na dachu
    ctx.save();
    ctx.translate(-dockW / 2, 0); 
    ctx.rotate(-Math.PI / 2); 
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText("FIGHTER PRODUCTION ARRAY", 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawStorageDisplay(ctx, x, y, w, h, viz) {
    ctx.save();
    ctx.translate(x, y);
    const theme = PALETTE[viz.currentState];
    
    // Bryła
    ctx.fillStyle = theme.base;
    ctx.beginPath();
    ctx.moveTo(w/2, h/2); ctx.lineTo(-w/2 + 20, h/2);
    ctx.lineTo(-w/2, -h/2); ctx.lineTo(w/2, -h/2);
    ctx.fill(); ctx.stroke();
    
    // Ekran LED
    ctx.fillStyle = '#000';
    ctx.fillRect(-w*0.3, -h*0.3, w*0.6, h*0.6);
    
    // Treść Ekranu
    const isWorking = viz.currentState === 'working';
    let statusStr = viz.currentState.toUpperCase();
    let statusColor = isWorking ? '#eab308' : '#ef4444';
    
    // Miganie tekstu
    if ((viz.currentState === 'paused' || viz.currentState === 'off') && Math.sin(viz.simTime*5) < 0) {
        statusColor = '#451a03'; 
    }

    ctx.shadowBlur = 5; ctx.shadowColor = statusColor;
    ctx.fillStyle = statusColor;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(statusStr, -10, -h*0.3 + 20); 
    
    if (viz.currentState !== 'off') {
        ctx.font = 'bold 10px monospace';
        ctx.shadowColor = '#38bdf8'; ctx.fillStyle = '#38bdf8';
        ctx.fillText("BP: FIGHTER", -10, 0); 
        
        ctx.shadowColor = '#ffffff'; ctx.fillStyle = '#ffffff';
        ctx.fillText(`PROD: ${viz.producedUnits}`, -10, h*0.3 - 20); 
    }
    ctx.shadowBlur = 0;
    
    // Światła boczne
    if (viz.currentState !== 'off') {
        ctx.fillStyle = '#eab308';
        ctx.fillRect(-w*0.3 - 25, -5, 5, 10);
        ctx.fillRect(w*0.3 - 5, -5, 5, 10);
    }
    ctx.restore();
}

function drawControlTower(ctx, x, y, w, h, isTop, viz) {
    ctx.save();
    ctx.translate(x, y);
    const theme = PALETTE[viz.currentState];
    
    // Bryła
    ctx.fillStyle = theme.base;
    ctx.beginPath();
    // Kształt ścięty
    ctx.moveTo(w/2, -h/2);
    ctx.lineTo(-w/2, -h/2);
    ctx.lineTo(-w/2 + 20, h/2);
    ctx.lineTo(w/2, h/2);
    ctx.fill(); ctx.stroke();
    
    // Mostek (Szyba)
    const bridgeW = w * 0.45;
    const bridgeH = h * 0.4;
    const bridgeX = -w/2 + bridgeW/2 + 20;
    
    // Gradient szyby
    const g = ctx.createLinearGradient(bridgeX-bridgeW/2, -bridgeH/2, bridgeX+bridgeW/2, bridgeH/2);
    g.addColorStop(0, '#0284c7'); g.addColorStop(1, '#0c4a6e');
    ctx.fillStyle = g;
    ctx.fillRect(bridgeX - bridgeW/2, -bridgeH/2, bridgeW, bridgeH);
    
    // Panele solarne (wbudowane z boku)
    const pX = bridgeX + bridgeW/2 + 15;
    ctx.fillStyle = '#101525';
    ctx.fillRect(pX, -h*0.3, 30, h*0.6);
    ctx.fillStyle = '#1d4ed8'; // Niebieskie ogniwa
    ctx.fillRect(pX+2, -h*0.3+2, 26, h*0.6-4);
    
    ctx.restore();
}

// Rysowanie pojedynczej linii produkcyjnej
function drawShipyardUnit(ctx, dock, x, y, h, w, viz, spriteImg) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 2); // Obrót o 90 stopni (teraz w = wysokość na ekranie)
    
    const theme = PALETTE[viz.currentState];
    const armWidth = h * 0.15;
    const dockWidth = h * 0.7; // Szerokość pola roboczego
    
    // Platforma wyjściowa (Transport)
    const platLen = 100;
    ctx.save();
    ctx.translate(0, w/2 + platLen/2);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-dockWidth/2, -platLen/2, dockWidth, platLen);
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
    ctx.strokeRect(-dockWidth/2, -platLen/2, dockWidth, platLen);
    
    // MASZT TRANSPORTOWY (Ruchomy)
    // Przeliczamy pozycję absolutną ramienia na lokalną platformy
    const armRelY = dock.transportArmPos - (w/2 + platLen/2);
    ctx.translate(0, armRelY);
    
    // Wózek i ramię
    ctx.fillStyle = '#64748b'; ctx.fillRect(-10, -5, 20, 15);
    ctx.fillStyle = '#334155'; ctx.fillRect(-dockWidth/2 + 10, 0, dockWidth - 20, 6);
    // Uchwyty (Zaciskają się w fazie 3)
    ctx.fillStyle = '#38bdf8';
    if (dock.phase === 3) {
        ctx.fillRect(-dockWidth/2 + 10, -5, 5, 16);
        ctx.fillRect(dockWidth/2 - 15, -5, 5, 16);
    } else {
        ctx.fillRect(-dockWidth/2 + 5, -5, 5, 16);
        ctx.fillRect(dockWidth/2 - 10, -5, 5, 16);
    }
    ctx.restore();

    // Pole robocze
    ctx.fillStyle = theme.hologram;
    ctx.fillRect(-dockWidth/2, -w/2, dockWidth, w);
    if (viz.currentState !== 'off') {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#334155';
        ctx.setLineDash([2,2]);
        ctx.strokeRect(-dockWidth/2, -w/2, dockWidth, w);
        ctx.setLineDash([]);
    }

    // STATEK (Główna wizualizacja)
    const shipW = dockWidth * 0.85;
    const shipH = w * 0.85;
    
    // Jeśli statek nie wjechał głęboko w dok (>600px), rysujemy go
    // Jak wjedzie głębiej, znika pod warstwą dachu (rysowaną w drawMainDock 'front')
    if (dock.phase !== 3 || (dock.phase === 3 && dock.shipPos < 800)) {
       ctx.save();
       const shipY = (dock.phase === 3) ? dock.shipPos : 0;
       ctx.translate(0, shipY);
       
       if (dock.phase === 0) {
           // Faza 0: Blueprint (Druk)
           // Maska od góry do suwnicy
           ctx.save();
           ctx.beginPath();
           ctx.rect(-dockWidth/2, -w/2, dockWidth, (dock.cranePos - (-w/2)) + 2);
           ctx.clip();
           
           ctx.globalAlpha = 0.6;
           ctx.globalCompositeOperation = 'source-atop';
           // Rysujemy ducha blueprintu (niebieski tint)
           if (spriteImg) ctx.drawImage(spriteImg, -shipW/2, -shipH/2, shipW, shipH);
           ctx.fillStyle = 'rgba(0, 200, 255, 0.4)';
           ctx.fillRect(-shipW/2, -shipH/2, shipW, shipH);
           ctx.restore();
       } else if (dock.phase === 1) {
           // Faza 1: Masa (Szara bryła, druk od dołu)
           ctx.save();
           ctx.beginPath();
           ctx.rect(-dockWidth/2, dock.cranePos, dockWidth, (w/2 - dock.cranePos) + 2);
           ctx.clip();
           
           if (spriteImg) ctx.drawImage(spriteImg, -shipW/2, -shipH/2, shipW, shipH);
           ctx.globalCompositeOperation = 'source-atop';
           ctx.fillStyle = '#64748b'; // Szary
           ctx.fillRect(-shipW/2, -shipH/2, shipW, shipH);
           ctx.restore();
       } else {
           // Faza 2 (Malowanie) i 3 (Transport) - Pełny Sprite
           if (dock.phase === 2) {
                // Maska druku (od góry)
                ctx.beginPath();
                ctx.rect(-dockWidth/2, -w/2, dockWidth, (dock.cranePos - (-w/2)) + 2);
                ctx.clip();
           }
           if (spriteImg) ctx.drawImage(spriteImg, -shipW/2, -shipH/2, shipW, shipH);
       }
       ctx.restore();
       
       // Laser Głowicy (Tylko podczas pracy w doku)
       if (viz.currentState === 'working' && dock.phase < 3) {
           const scanY = dock.cranePos;
           const laserColor = dock.phase===1 ? '#fbbf24' : (dock.phase===2 ? '#fff' : '#38bdf8');
           ctx.strokeStyle = laserColor;
           ctx.lineWidth = 2;
           ctx.shadowColor = laserColor; ctx.shadowBlur = 10;
           ctx.beginPath();
           // Rysuj laser tylko na szerokość statku (przybliżona)
           ctx.moveTo(-shipW/2, scanY); ctx.lineTo(shipW/2, scanY);
           ctx.stroke();
           ctx.shadowBlur = 0;
       }
    }

    // Suwnica (Belka)
    ctx.fillStyle = (viz.currentState === 'off') ? '#451a03' : '#eab308';
    if (viz.currentState === 'paused') ctx.fillStyle = '#b45309';
    ctx.fillRect(-dockWidth/2 - 5, dock.cranePos - 2, dockWidth + 10, 4);

    // Głowica (jeździ po belce)
    if (viz.currentState === 'working' && dock.phase < 3) {
        const headX = Math.sin(viz.simTime * 20 + dock.id) * (shipW * 0.5);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(headX - 2, dock.cranePos - 3, 4, 6);
    }

    // Cząsteczki
    if (viz.currentState === 'working') {
        ctx.fillStyle = '#fff';
        for (let p of dock.particles) {
            ctx.globalAlpha = p.life;
            ctx.fillRect(p.x, p.y, 2, 2);
        }
        ctx.globalAlpha = 1;
    }

    ctx.restore();
}
