const DOCKS_COUNT = 9;

const PALETTE = {
  idle: { base: '#1e293b', light: '#22c55e', accent: '#0ea5e9', hologram: 'rgba(14, 165, 233, 0.05)', glow: 0 },
  working: { base: '#1e293b', light: '#eab308', accent: '#38bdf8', hologram: 'rgba(14, 165, 233, 0.2)', glow: 1 },
  paused: { base: '#1e293b', light: '#f59e0b', accent: '#38bdf8', hologram: 'rgba(14, 165, 233, 0.2)', glow: 0.5 },
  off: { base: '#0f172a', light: '#ef4444', accent: '#334155', hologram: 'rgba(0, 0, 0, 0)', glow: 0 }
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let defaultFighterCanvas = null;
function getDefaultFighterSprite() {
  if (defaultFighterCanvas) return defaultFighterCanvas;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.translate(64, 64);
  ctx.fillStyle = '#475569';
  ctx.beginPath();
  ctx.moveTo(0, -60); ctx.lineTo(20, -10); ctx.lineTo(20, 40);
  ctx.lineTo(10, 55); ctx.lineTo(-10, 55); ctx.lineTo(-20, 40); ctx.lineTo(-20, -10);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(20, 0); ctx.lineTo(60, 30); ctx.lineTo(60, 50); ctx.lineTo(20, 40);
  ctx.moveTo(-20, 0); ctx.lineTo(-60, 30); ctx.lineTo(-60, 50); ctx.lineTo(-20, 40);
  ctx.fill();
  ctx.fillStyle = '#38bdf8'; ctx.fillRect(-5, -20, 10, 15);
  ctx.fillStyle = '#ef4444'; ctx.fillRect(-55, 35, 10, 5); ctx.fillRect(45, 35, 10, 5);
  defaultFighterCanvas = c;
  return c;
}

export function initShipyardState(inst) {
  if (inst.visuals) return;
  inst.visuals = {
    docks: Array.from({ length: DOCKS_COUNT }, (_, i) => ({
      id: i,
      phase: 0,
      progress: Math.random() * 0.2,
      cranePos: 0,
      transportArmPos: 0,
      shipPos: 0,
      gateProgress: 0,
      particles: []
    })),
    simTime: 0,
    producedUnits: 0,
    currentState: 'working'
  };
}

export function updateShipyardVisuals(inst, dt) {
  if (!inst.visuals) initShipyardState(inst);
  const viz = inst.visuals;
  
  const isWorking = viz.currentState === 'working';
  const isPaused = viz.currentState === 'paused';
  
  if (isWorking) viz.simTime += dt;

  const dockHeight = 60;
  const shipH = dockHeight * 0.75;
  const platLen = 100;
  const topY = -shipH / 2;
  const bottomY = shipH / 2;
  const armParkPos = bottomY + 30;

  viz.docks.forEach(dock => {
    if (isWorking) {
      const speed = (0.0008 + (dock.id * 0.00005)) * 60 * dt; 
      dock.progress += speed;
      
      if (dock.progress >= 1.0) {
        dock.progress = 0;
        dock.phase++;
        if (dock.phase > 3) {
          dock.phase = 0;
          viz.producedUnits++;
        }
      }
    }

    let targetCrane = dock.cranePos;
    let targetArm = dock.transportArmPos;
    let targetGate = 0;

    if (isWorking || isPaused) {
       if (dock.phase === 0) {
           targetCrane = topY + (dock.progress * (bottomY - topY));
           targetArm = armParkPos; 
       } else if (dock.phase === 1) {
           targetCrane = bottomY - (dock.progress * (bottomY - topY));
           targetArm = armParkPos;
       } else if (dock.phase === 2) {
           targetCrane = topY + (dock.progress * (bottomY - topY));
           targetArm = armParkPos;
           if (dock.progress > 0.8) targetGate = 1;
       } else if (dock.phase === 3) {
           targetCrane = topY - 20;
           const p = dock.progress;
           targetGate = (p < 0.9) ? 1 : 0;
           
           if (p < 0.3) {
               const subP = p / 0.3;
               targetArm = armParkPos - (subP * armParkPos);
               dock.shipPos = 0;
           } else if (p < 0.35) {
               targetArm = 0;
               dock.shipPos = 0;
           } else {
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

    if (dock.transportArmPos > 130) targetGate = 1;

    const lerp = 5.0 * dt;
    dock.cranePos += (targetCrane - dock.cranePos) * lerp;
    
    if (dock.phase === 3) dock.transportArmPos = targetArm;
    else dock.transportArmPos += (targetArm - dock.transportArmPos) * (lerp * 0.5);
    
    dock.gateProgress += (targetGate - dock.gateProgress) * (lerp * 0.5);

    if (isWorking) {
       for (let i = dock.particles.length - 1; i >= 0; i--) {
         const p = dock.particles[i];
         p.x += p.vx * 60 * dt; p.y += p.vy * 60 * dt;
         p.life -= 2.0 * dt;
         if (p.life <= 0) dock.particles.splice(i, 1);
       }
       if (dock.phase < 3 && Math.random() < (0.3 * 60 * dt)) {
          const scanW = 80; 
          const col = dock.phase===1 ? '#fbbf24' : (dock.phase===2 ? '#ffffff' : '#38bdf8');
          dock.particles.push({
             x: (Math.random()-0.5)*scanW, y: dock.cranePos,
             vx: (Math.random()-0.5)*2, vy: (Math.random()-0.5)*2,
             life: 1.0, color: col
          });
       }
    } else {
       dock.particles = [];
    }
  });
}

function drawMainDockPart(ctx, x, y, width, height, layer, viz) {
  const dockW = 380;
  ctx.save();
  ctx.translate(x, y);
  
  if (layer === 'back') {
    ctx.fillStyle = '#050a10';
    ctx.fillRect(-dockW, -height/2 - 20, dockW, height + 40);
    if (viz.currentState !== 'off') {
        ctx.fillStyle = 'rgba(14, 165, 233, 0.1)';
        for (let i=0; i<8; i++) ctx.fillRect(-dockW + 20 + i*40, -height/2, 2, height);
    }
  } else {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-dockW, -height/2, dockW - 5, height); 
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
    ctx.strokeRect(-dockW, -height/2, dockW - 5, height);
    ctx.fillRect(-dockW - 20, -height/2 - 30, 20, height + 60); 
    ctx.fillRect(-dockW, -height/2 - 30, dockW, 20); 
    ctx.fillRect(-dockW, height/2 + 10, dockW, 20);
    
    const numSections = 8;
    const sectionH = height / numSections;
    for(let i=0; i<numSections; i++) {
        const sy = -height/2 + i*sectionH;
        ctx.fillStyle = '#263750';
        ctx.fillRect(-dockW + 10, sy + 5, dockW - 40, 2);
        ctx.fillStyle = '#334155';
        ctx.fillRect(-dockW + 20, sy + 15, 6, 6);
        ctx.fillRect(-dockW + 50, sy + 15, 6, 6);
    }
    
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 3;
    ctx.strokeRect(-dockW, -height/2 - 20, dockW, height + 40);

    const unitThick = 180; const spacing = 10;
    const startY = -(DOCKS_COUNT * (unitThick + spacing) - spacing) / 2 + unitThick/2;
    const gateH = 140;

    for (let i = 0; i < DOCKS_COUNT; i++) {
        const dy = startY + i * (unitThick + spacing);
        const dock = viz.docks[i];
        const open = dock.gateProgress * (gateH / 2);
        
        ctx.fillStyle = '#475569';
        ctx.fillRect(-5, dy - gateH/2 - open, 10, gateH/2); 
        ctx.fillRect(-5, dy + open, 10, gateH/2); 
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.moveTo(-5, -gateH/2 - open + dy); ctx.lineTo(5, -gateH/2 - open + 10 + dy);
        ctx.lineTo(5, -gateH/2 - open + 5 + dy); ctx.lineTo(-5, -gateH/2 - open - 5 + dy);
        ctx.fill();
        
        if (viz.currentState !== 'off') {
            ctx.fillStyle = dock.gateProgress > 0.1 ? (dock.gateProgress > 0.9 ? '#22c55e' : '#eab308') : '#ef4444';
            ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
            ctx.fillRect(8, dy - gateH/2 - 10, 4, gateH + 20);
            ctx.shadowBlur = 0;
        }
    }
    
    ctx.save();
    ctx.translate(-dockW / 2, 0); 
    ctx.rotate(-Math.PI / 2); 
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText("FIGHTER PRODUCTION ARRAY", 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawStorageDisplay(ctx, x, y, w, h, viz) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#1e293b'; 
    ctx.beginPath();
    ctx.moveTo(w/2, h/2); ctx.lineTo(-w/2 + 20, h/2);
    ctx.lineTo(-w/2, -h/2); ctx.lineTo(w/2, -h/2);
    ctx.fill(); ctx.stroke();
    
    ctx.fillStyle = '#000';
    ctx.fillRect(-w*0.3, -h*0.3, w*0.6, h*0.6);
    
    let statusColor = viz.currentState === 'working' ? '#eab308' : '#ef4444';
    if ((viz.currentState === 'paused' || viz.currentState === 'off') && Math.sin(viz.simTime*5) < 0) {
        statusColor = '#451a03'; 
    }

    ctx.shadowBlur = 5; ctx.shadowColor = statusColor;
    ctx.fillStyle = statusColor;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(viz.currentState.toUpperCase(), 0, -5);
    ctx.fillStyle = '#fff';
    ctx.fillText(`PROD: ${viz.producedUnits}`, 0, 15);
    
    ctx.restore();
}

function drawControlTower(ctx, x, y, w, h, isTop, viz) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-w/2, -h/2, w, h);
    ctx.strokeRect(-w/2, -h/2, w, h);
    
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(-w/2 + 20, -10, w*0.4, 20);
    
    const pX = 20;
    ctx.fillStyle = '#101525';
    ctx.fillRect(pX, -h*0.3, 30, h*0.6);
    ctx.fillStyle = '#1d4ed8'; 
    ctx.fillRect(pX+2, -h*0.3+2, 26, h*0.6-4);
    
    ctx.restore();
}

function drawShipyardUnit(ctx, dock, x, y, h, w, viz, spriteImg) { 
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 2);
    const theme = PALETTE[viz.currentState];
    const dockWidth = h * 0.7; 
    const platLen = 100;
    
    ctx.save();
    ctx.translate(0, w/2 + platLen/2);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-dockWidth/2, -platLen/2, dockWidth, platLen);
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
    ctx.strokeRect(-dockWidth/2, -platLen/2, dockWidth, platLen);
    const armRelY = dock.transportArmPos - (w/2 + platLen/2);
    ctx.translate(0, armRelY);
    ctx.fillStyle = '#64748b'; ctx.fillRect(-10, -5, 20, 15);
    ctx.fillStyle = '#334155'; ctx.fillRect(-dockWidth/2 + 10, 0, dockWidth - 20, 6);
    ctx.fillStyle = '#38bdf8';
    if (dock.phase === 3) {
        ctx.fillRect(-dockWidth/2 + 10, -5, 5, 16); ctx.fillRect(dockWidth/2 - 15, -5, 5, 16);
    } else {
        ctx.fillRect(-dockWidth/2 + 5, -5, 5, 16); ctx.fillRect(dockWidth/2 - 10, -5, 5, 16);
    }
    ctx.restore();

    ctx.fillStyle = theme.hologram;
    ctx.fillRect(-dockWidth/2, -w/2, dockWidth, w);
    if (viz.currentState !== 'off') {
        ctx.lineWidth = 2; ctx.strokeStyle = '#334155';
        ctx.setLineDash([2,2]); ctx.strokeRect(-dockWidth/2, -w/2, dockWidth, w); ctx.setLineDash([]);
    }

    const shipW = dockWidth * 0.85;
    const shipH = w * 0.85;
    
    if (dock.phase !== 3 || (dock.phase === 3 && dock.shipPos < 800)) { 
       ctx.save();
       const shipY = (dock.phase === 3) ? dock.shipPos : 0;
       ctx.translate(0, shipY);
       
       if (dock.phase === 0) {
           ctx.save(); ctx.beginPath();
           ctx.rect(-dockWidth/2, -w/2, dockWidth, (dock.cranePos - (-w/2)) + 2); ctx.clip();
           ctx.globalAlpha = 0.6; ctx.globalCompositeOperation = 'source-atop';
           if (spriteImg) ctx.drawImage(spriteImg, -shipW/2, -shipH/2, shipW, shipH);
           ctx.fillStyle = 'rgba(0, 200, 255, 0.4)'; ctx.fillRect(-shipW/2, -shipH/2, shipW, shipH);
           ctx.restore();
       } else if (dock.phase === 1) {
           ctx.save(); ctx.beginPath();
           ctx.rect(-dockWidth/2, dock.cranePos, dockWidth, (w/2 - dock.cranePos) + 2); ctx.clip();
           if (spriteImg) ctx.drawImage(spriteImg, -shipW/2, -shipH/2, shipW, shipH);
           ctx.globalCompositeOperation = 'source-atop';
           ctx.fillStyle = '#64748b'; ctx.fillRect(-shipW/2, -shipH/2, shipW, shipH);
           ctx.restore();
       } else {
           if (dock.phase === 2) {
                ctx.beginPath(); ctx.rect(-dockWidth/2, -w/2, dockWidth, (dock.cranePos - (-w/2)) + 2); ctx.clip();
           }
           if (spriteImg) ctx.drawImage(spriteImg, -shipW/2, -shipH/2, shipW, shipH);
       }
       ctx.restore();
       
       if (viz.currentState === 'working' && dock.phase < 3) {
           const scanY = dock.cranePos;
           const laserColor = dock.phase===1 ? '#fbbf24' : (dock.phase===2 ? '#fff' : '#38bdf8');
           ctx.strokeStyle = laserColor; ctx.lineWidth = 2;
           ctx.shadowColor = laserColor; ctx.shadowBlur = 10;
           ctx.beginPath(); ctx.moveTo(-shipW/2, scanY); ctx.lineTo(shipW/2, scanY); ctx.stroke();
           ctx.shadowBlur = 0;
       }
    }

    ctx.fillStyle = (viz.currentState === 'off') ? '#451a03' : '#eab308';
    ctx.fillRect(-dockWidth/2 - 5, dock.cranePos - 2, dockWidth + 10, 4);

    if (viz.currentState === 'working' && dock.phase < 3) {
        const headX = Math.sin(viz.simTime * 20 + dock.id) * (shipW * 0.5);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(headX - 2, dock.cranePos - 3, 4, 6);
    }

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

export function drawComplexShipyard(ctx, inst, centerScreen, size, rotation) {
  if (!inst.visuals) return;
  const viz = inst.visuals;
  const theme = PALETTE[viz.currentState];
  const time = viz.simTime;
  const spriteImg = (window.fighterSprite && window.fighterSprite.width > 0) ? window.fighterSprite : getDefaultFighterSprite();

  ctx.save();
  ctx.translate(centerScreen.x, centerScreen.y);
  if (rotation) ctx.rotate(rotation * Math.PI / 2);

  const artScale = (size / 2400) * 12.0; 
  ctx.scale(artScale, artScale);

  const unitLen = 200;
  const unitThick = 180;
  const spacing = 10;
  const totalHeight = DOCKS_COUNT * (unitThick + spacing);
  const docksX = 150;
  const spineX = docksX + unitLen / 2 + 20;
  const transportX = docksX - unitLen / 2;
  const mainDockX = transportX - 100;

  drawMainDockPart(ctx, mainDockX, 0, 200, totalHeight + 100, 'back', viz);

  ctx.fillStyle = theme.base;
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 4;
  const spineW = 50;
  ctx.fillRect(spineX - spineW/2, -totalHeight/2 - 20, spineW, totalHeight + 40);
  ctx.strokeRect(spineX - spineW/2, -totalHeight/2 - 20, spineW, totalHeight + 40);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(spineX - 15, -totalHeight/2 - 10, 30, totalHeight + 20);
  
  if (viz.currentState === 'working') {
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 4;
      ctx.setLineDash([10, 20]);
      ctx.lineDashOffset = time * 50; 
      ctx.beginPath(); ctx.moveTo(spineX, -totalHeight/2+10); ctx.lineTo(spineX, totalHeight/2-10); ctx.stroke();
      ctx.setLineDash([]);
  }

  const firstDockY = - (DOCKS_COUNT * (unitThick + spacing) - spacing) / 2 + unitThick/2;
  const towerHeight = 120;
  const topTowerY = firstDockY - unitThick/2 - spacing - towerHeight/2;
  const botTowerY = firstDockY + (DOCKS_COUNT - 1) * (unitThick + spacing) + unitThick/2 + spacing + towerHeight/2;
  
  drawStorageDisplay(ctx, docksX, topTowerY, unitLen, towerHeight, viz);
  ctx.fillStyle = '#334155'; ctx.fillRect(docksX + unitLen/2 - 5, topTowerY - 10, spineX - (docksX + unitLen/2) + 5, 20);

  drawControlTower(ctx, docksX, botTowerY, unitLen, towerHeight, false, viz);
  ctx.fillRect(docksX + unitLen/2 - 5, botTowerY - 10, spineX - (docksX + unitLen/2) + 5, 20);

  for(let i=0; i<DOCKS_COUNT; i++) {
     const dock = viz.docks[i];
     const y = firstDockY + i * (unitThick + spacing);
     drawShipyardUnit(ctx, dock, docksX, y, unitThick, unitLen, viz, spriteImg);
     ctx.fillStyle = '#334155';
     const dockRight = docksX + unitLen/2;
     ctx.fillRect(dockRight - 5, y - 5, spineX - dockRight + 5, 10);
     if (viz.currentState !== 'off') {
         const phaseColor = ['#38bdf8', '#fbbf24', '#ffffff', '#22c55e'][dock.phase];
         ctx.fillStyle = phaseColor; ctx.fillRect(dockRight + 15, y - 2, 6, 6);
     }
  }

  drawMainDockPart(ctx, mainDockX, 0, 200, totalHeight + 100, 'front', viz);

  ctx.restore();
}
