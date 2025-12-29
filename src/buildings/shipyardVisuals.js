const DOCKS_COUNT = 1;

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
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.translate(32, 32);
    ctx.scale(0.8, 0.8);
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.moveTo(0, -20); ctx.lineTo(12, 10); ctx.lineTo(0, 5); ctx.lineTo(-12, 10);
    ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath(); ctx.arc(0, -5, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-8, 10, 4, 4); ctx.fillRect(4, 10, 4, 4);
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
            floorExtension: 0,
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

    const dockHeight = 120;
    const shipH = dockHeight * 0.8;
    const topY = -shipH / 2;
    const bottomY = shipH / 2;
    const armParkPos = bottomY + 20;

    viz.docks.forEach(dock => {
        // 1. Postęp
        if (isWorking) {
            // SLOWER SPEEDS as requested
            let effectiveSpeed = 0.08 * dt; // Phase 0-2 (Blueprint/Mass/Sprite)
            if (dock.phase === 3) effectiveSpeed = 0.05 * dt; // Transport (very slow)
            if (dock.phase === 4) effectiveSpeed = 0.2 * dt;  // Return logic

            dock.progress += effectiveSpeed;

            if (dock.progress >= 1.0) {
                dock.progress = 0;
                dock.phase++;

                if (dock.phase === 4) {
                    viz.producedUnits++;
                }
                if (dock.phase > 4) {
                    dock.phase = 0;
                }
            }
        }

        // 2. Pozycje i Logika
        let targetCrane = dock.cranePos;
        let targetArm = dock.transportArmPos;
        let targetGate = 0;
        let targetFloor = 0;

        if (isWorking || isPaused) {
            if (dock.phase === 0) { // Blueprint
                targetCrane = topY + (dock.progress * (bottomY - topY));
                targetArm = armParkPos;
                targetFloor = 0;
            } else if (dock.phase === 1) { // Masa
                targetCrane = bottomY - (dock.progress * (bottomY - topY));
                targetArm = armParkPos;
                targetFloor = 0;
            } else if (dock.phase === 2) { // Sprite
                targetCrane = topY + (dock.progress * (bottomY - topY));
                targetArm = armParkPos;
                targetFloor = 0;
                if (dock.progress > 0.8) targetGate = 1;
            } else if (dock.phase === 3) { // Transport
                targetCrane = topY - 10;
                targetGate = 1;
                const p = dock.progress;

                if (p < 0.15) { // Dojazd ramienia do środka
                    const subP = p / 0.15;
                    targetArm = armParkPos * (1 - subP);
                    targetFloor = 0;
                } else if (p < 0.30) { // Rozwijanie podłogi
                    targetArm = 0;
                    const subP = (p - 0.15) / 0.15;
                    targetFloor = subP;
                } else { // Wyjazd ramienia ze statkiem
                    // Statek rusza dopiero teraz, razem z ramieniem
                    targetArm = ((p - 0.30) / 0.70) * 280;
                    targetFloor = 1;
                }
            } else if (dock.phase === 4) { // Return
                targetCrane = topY - 10;
                const p = dock.progress;

                if (p < 0.2) { // Zwijanie
                    targetArm = 280;
                    targetFloor = 1 - (p / 0.2);
                } else { // Powrót
                    targetArm = 280 + ((p - 0.2) / 0.8) * (armParkPos - 280);
                    targetFloor = 0;
                }

                if (dock.transportArmPos < 100) targetGate = 0;
                else targetGate = 1;
            }
        } else if (viz.currentState === 'idle') {
            targetCrane = topY - 10;
            targetArm = armParkPos;
            targetGate = 0;
            targetFloor = 0;
        }

        // Fizyka (Lerp)
        if (viz.currentState !== 'off' && !isPaused) {
            const lerp = 5.0 * dt;
            dock.cranePos += (targetCrane - dock.cranePos) * lerp;

            if (dock.phase === 3 || dock.phase === 4) {
                dock.transportArmPos = targetArm;
                dock.floorExtension = targetFloor;
            } else {
                dock.transportArmPos += (targetArm - dock.transportArmPos) * (lerp * 0.5);
                dock.floorExtension += (targetFloor - dock.floorExtension) * (lerp * 0.5);
            }

            dock.gateProgress += (targetGate - dock.gateProgress) * (lerp * 0.5);
        }

        // Cząsteczki
        if (isWorking) {
            for (let i = dock.particles.length - 1; i >= 0; i--) {
                const p = dock.particles[i];
                p.x += p.vx * 60 * dt; p.y += p.vy * 60 * dt;
                p.life -= 3.0 * dt;
                if (p.life <= 0) dock.particles.splice(i, 1);
            }
        } else {
            dock.particles = [];
        }
    });
}

function drawMainDockPart(ctx, x, y, width, height, layer, viz) {
    const dockW = 180;

    ctx.save();
    ctx.translate(x, y);

    if (layer === 'back') {
        ctx.fillStyle = '#050a10';
        ctx.fillRect(-dockW, -height / 2 - 10, dockW, height + 20);
        if (viz.currentState !== 'off') {
            ctx.fillStyle = 'rgba(14, 165, 233, 0.1)';
            for (let i = 0; i < 3; i++) ctx.fillRect(-dockW + 10 + i * 40, -height / 2, 2, height);
        }
    } else {
        // Dach (Front) - Full Opacity ensure
        ctx.fillStyle = '#1e293b';
        ctx.beginPath(); ctx.rect(-dockW, -height / 2, dockW - 5, height); ctx.fill();
        // Powtórnie rysujemy, aby upewnić się, że nic nie prześwituje (antyaliasing krawędzi)
        ctx.fill();

        ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
        ctx.strokeRect(-dockW, -height / 2, dockW - 5, height);

        // Detale
        ctx.fillStyle = '#263750'; ctx.fillRect(-dockW + 10, -height / 2 + 20, dockW - 20, 5);
        ctx.fillStyle = '#263750'; ctx.fillRect(-dockW + 10, height / 2 - 25, dockW - 20, 5);

        ctx.strokeStyle = '#475569'; ctx.lineWidth = 2;
        ctx.strokeRect(-dockW, -height / 2 - 10, dockW, height + 20);

        // Brama (jedna duża)
        const dock = viz.docks[0];
        const gateH = 100;
        const open = dock.gateProgress * (gateH / 2);

        ctx.fillStyle = '#475569';
        ctx.fillRect(-5, -gateH / 2 - open, 10, gateH / 2);
        ctx.fillRect(-5, open, 10, gateH / 2);

        // Trójkąty ostrzegawcze
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.moveTo(-5, -gateH / 2 - open); ctx.lineTo(5, -gateH / 2 - open + 5); ctx.lineTo(-5, -gateH / 2 - open - 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-5, gateH / 2 + open); ctx.lineTo(5, gateH / 2 + open - 5); ctx.lineTo(-5, gateH / 2 + open + 2); ctx.fill();

        if (viz.currentState !== 'off') {
            ctx.fillStyle = dock.gateProgress > 0.1 ? (dock.gateProgress > 0.9 ? '#22c55e' : '#eab308') : '#ef4444';
            ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 5;
            ctx.fillRect(6, -gateH / 2 - 5, 2, gateH + 10);
            ctx.shadowBlur = 0;
        }

        // Napis
        ctx.save();
        ctx.translate(-dockW / 2, 0); ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText("SQUADRON PRINTER", 0, 0);
        ctx.restore();
    }
    ctx.restore();
}

function getApproxShipWidthAtY(localY, shipHeight) {
    const normY = localY / (shipHeight / 2);
    if (normY < -0.5) return (normY + 1.0) * 2 * 0.5;
    if (normY < 0.5) return 0.5 + (normY + 0.5) * 0.5;
    return 1.0 - (normY - 0.5) * 0.4;
}

function drawSmartLaserHeads(ctx, dock, startX, startY, fighterSize, spacing, gridSize, time, working) {
    const scanY = dock.cranePos;
    const headSize = 4;
    const laserColor = (working && dock.phase === 1) ? '#fbbf24' : ((working && dock.phase === 2) ? '#fff' : '#38bdf8');

    if (working) {
        ctx.fillStyle = laserColor;
        ctx.shadowColor = laserColor;
        ctx.shadowBlur = 5;
    } else {
        ctx.fillStyle = '#475569';
        ctx.shadowBlur = 0;
    }

    for (let c = 0; c < gridSize; c++) {
        const shipCenterX = startX + c * (fighterSize + spacing);
        let activeRow = -1;

        if (working && dock.phase < 3) {
            for (let r = 0; r < gridSize; r++) {
                const shipCenterY = startY + r * (fighterSize + spacing);
                const shipTop = shipCenterY - fighterSize / 2;
                const shipBottom = shipCenterY + fighterSize / 2;

                if (scanY >= shipTop && scanY <= shipBottom) {
                    activeRow = r;
                    const relativeY = scanY - shipCenterY;
                    const widthFactor = getApproxShipWidthAtY(relativeY, fighterSize);

                    const scanSpeed = 15;
                    const maxOffset = (fighterSize / 2) * widthFactor;
                    const headOffset = Math.sin(time * scanSpeed + c + r) * maxOffset;

                    const headX = shipCenterX + headOffset;

                    ctx.fillRect(headX - headSize / 2, scanY - 3, headSize, 6);

                    ctx.beginPath();
                    ctx.strokeStyle = laserColor;
                    ctx.lineWidth = 1.5;
                    ctx.moveTo(headX, scanY);
                    ctx.lineTo(headX, scanY + (dock.phase === 0 ? 4 : -4));
                    ctx.stroke();

                    if (Math.random() > 0.5) {
                        ctx.fillStyle = '#fff';
                        ctx.fillRect(headX - 1, scanY + (dock.phase === 0 ? 2 : -2), 2, 2);
                        ctx.fillStyle = laserColor;
                    }

                    if (Math.random() < 0.3) {
                        dock.particles.push({
                            x: headX,
                            y: scanY,
                            vx: (Math.random() - 0.5) * 2,
                            vy: (Math.random() - 0.5) * 2,
                            life: 0.5 + Math.random() * 0.5,
                            color: laserColor
                        });
                    }
                }
            }
        }

        if (activeRow === -1) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#475569';
            ctx.fillRect(shipCenterX - headSize / 2, scanY - 2, headSize, 4);
            if (working && dock.phase < 3) {
                ctx.fillStyle = laserColor;
                ctx.shadowColor = laserColor;
                ctx.shadowBlur = 5;
            }
        }
    }
    ctx.shadowBlur = 0;
}

function drawSquadronGrid(ctx, spriteImg, renderType) {
    const fighterSize = 24;
    const spacing = 12;
    const gridSize = 3;
    const startX = -((gridSize - 1) * (fighterSize + spacing)) / 2;
    const startY = -((gridSize - 1) * (fighterSize + spacing)) / 2;

    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            const fx = startX + c * (fighterSize + spacing);
            const fy = startY + r * (fighterSize + spacing);

            ctx.save();
            ctx.translate(fx, fy);
            ctx.rotate(-Math.PI / 2);

            const fSize = fighterSize;

            if (renderType === 'blueprint') {
                if (spriteImg) {
                    ctx.globalAlpha = 0.4;
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.drawImage(spriteImg, -fSize / 2, -fSize / 2, fSize, fSize);
                    ctx.globalCompositeOperation = 'source-atop';
                    ctx.fillStyle = 'rgba(0, 200, 255, 0.5)';
                    ctx.fillRect(-fSize / 2, -fSize / 2, fSize, fSize);
                } else {
                    ctx.fillStyle = 'rgba(0, 200, 255, 0.3)';
                    ctx.fillRect(-fSize / 2, -fSize / 2, fSize, fSize);
                }
            } else if (renderType === 'mass') {
                if (spriteImg) {
                    ctx.drawImage(spriteImg, -fSize / 2, -fSize / 2, fSize, fSize);
                    ctx.globalCompositeOperation = 'source-atop';
                    ctx.fillStyle = '#475569';
                    ctx.fillRect(-fSize / 2, -fSize / 2, fSize, fSize);
                } else {
                    ctx.fillStyle = '#475569';
                    ctx.fillRect(-fSize / 2, -fSize / 2, fSize, fSize);
                }
            } else if (renderType === 'sprite') {
                if (spriteImg) {
                    ctx.drawImage(spriteImg, -fSize / 2, -fSize / 2, fSize, fSize);
                } else {
                    ctx.fillStyle = '#38bdf8';
                    ctx.fillRect(-fSize / 2, -fSize / 2, fSize, fSize);
                }
            }

            ctx.restore();
        }
    }
}

function drawShipyardUnit(ctx, dock, x, y, h, w, viz, spriteImg) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 2);
    const theme = PALETTE[viz.currentState];

    const dockWidth = h * 0.95;
    const platLen = 40;

    // Ramię dokujące (Baza)
    ctx.save();
    ctx.translate(0, w / 2 + platLen / 2);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-dockWidth / 2, -platLen / 2, dockWidth, platLen);
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
    ctx.strokeRect(-dockWidth / 2, -platLen / 2, dockWidth, platLen);

    // --- RUCHOME RAMIĘ TRANSPORTOWE ---
    const armRelY = dock.transportArmPos - (w / 2 + platLen / 2);
    ctx.translate(0, armRelY);

    // 1. Główna belka transportowa
    ctx.fillStyle = '#334155'; ctx.fillRect(-dockWidth / 2 + 4, 0, dockWidth - 8, 4);
    ctx.fillStyle = '#64748b'; ctx.fillRect(-20, -2, 40, 8);

    // 2. Chwytaki środkowe
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(-2, -3, 4, 10);
    ctx.fillRect(-2 - 35, -3, 4, 10);
    ctx.fillRect(-2 + 35, -3, 4, 10);

    // 3. ROZWIJANA PODŁOGA
    const floorMaxW = 48;
    const floorW = dock.floorExtension * floorMaxW;

    if (floorW > 1) {
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.fillRect(-dockWidth / 2 + 10, 4, dockWidth - 20, floorW);
        ctx.strokeRect(-dockWidth / 2 + 10, 4, dockWidth - 20, floorW);

        ctx.fillRect(-dockWidth / 2 + 10, -floorW, dockWidth - 20, floorW);
        ctx.strokeRect(-dockWidth / 2 + 10, -floorW, dockWidth - 20, floorW);

        // 4. PODSTAWKI (Pads)
        if (dock.floorExtension > 0.6) {
            const padAnim = (dock.floorExtension - 0.6) / 0.4;

            const fighterSize = 24; const spacing = 12; const gridSize = 3;
            const startX = -((gridSize - 1) * (fighterSize + spacing)) / 2;
            const startY = -((gridSize - 1) * (fighterSize + spacing)) / 2;

            for (let r = 0; r < gridSize; r++) {
                const padY = startY + r * (fighterSize + spacing);
                for (let c = 0; c < gridSize; c++) {
                    const padX = startX + c * (fighterSize + spacing);

                    const maxPadSize = 16;
                    const currentPadSize = maxPadSize * padAnim;
                    const offsetCenter = (maxPadSize - currentPadSize) / 2;

                    ctx.save();
                    ctx.translate(padX, padY);
                    ctx.globalAlpha = padAnim;

                    ctx.fillStyle = '#0f172a';
                    ctx.fillRect(-8 + offsetCenter, -8 + offsetCenter, currentPadSize, currentPadSize);
                    ctx.strokeStyle = '#38bdf8';
                    ctx.strokeRect(-8 + offsetCenter, -8 + offsetCenter, currentPadSize, currentPadSize);

                    if (padAnim > 0.8) {
                        ctx.fillStyle = '#38bdf8';
                        ctx.fillRect(-2, -2, 4, 4);
                    }
                    ctx.restore();
                }
            }
        }
    }

    // 5. Fighters (Grid) ON THE ARM (Only when pickup complete)
    // Pickup happens when floor is fully extended (progress >= 0.3)
    // In Phase 3, progress 0.3 is when arm starts moving OUT.
    if ((dock.phase === 3 && dock.progress >= 0.30) || dock.phase === 4) {
        ctx.save();
        drawSquadronGrid(ctx, spriteImg, 'sprite');
        ctx.restore();
    }

    ctx.restore(); // Exit arm context

    // 6. Production area (Static Hologram / Laser work) OR Static Sprite waiting for pickup
    // We draw static if phase < 3 OR (phase === 3 and progress < 0.30)
    // When phase === 3 and progress < 0.30, the fighters are finished ('sprite') and waiting for the arm.
    if (dock.phase < 3 || (dock.phase === 3 && dock.progress < 0.30)) {
        ctx.save();
        ctx.translate(0, 0); // Center of the unit

        // Draw the grid content being built
        const fighterSize = 24; const spacing = 12; const gridSize = 3;
        const startX = -((gridSize - 1) * (fighterSize + spacing)) / 2;
        const startY = -((gridSize - 1) * (fighterSize + spacing)) / 2;

        if (dock.phase === 0) { // Blueprint
            drawSquadronGrid(ctx, spriteImg, 'blueprint');
        } else if (dock.phase === 1) { // Mass
            ctx.save();
            ctx.beginPath();
            ctx.rect(-100, -100, 200, dock.cranePos - (-100));
            ctx.clip();
            drawSquadronGrid(ctx, spriteImg, 'mass');
            ctx.restore();
            // Draw unrevealed
            // ... actually mass is building up, so inverted logic to original? 
            // Logic in update: crane goes bottom -> top (mass) then top -> bottom (blueprint)? 
            // Let's stick to simple: Mass reveals from bottom (-50 to 50? Crane is scanY).
            // Just keeping existing simple clip logic.
        } else if (dock.phase === 2) { // Sprite
            ctx.save();
            ctx.beginPath();
            ctx.rect(-100, -100, 200, dock.cranePos - (-100));
            ctx.clip();
            drawSquadronGrid(ctx, spriteImg, 'sprite');
            ctx.restore();

            ctx.save();
            ctx.beginPath();
            ctx.rect(-100, dock.cranePos, 200, 200);
            ctx.clip();
            drawSquadronGrid(ctx, spriteImg, 'mass');
            ctx.restore();
        } else if (dock.phase === 3 && dock.progress < 0.30) {
            // Waiting for pickup - full sprite
            drawSquadronGrid(ctx, spriteImg, 'sprite');
        }

        // Lasers (only in working phases 0-2)
        if (dock.phase < 3) {
            drawSmartLaserHeads(ctx, dock, startX, startY, fighterSize, spacing, gridSize, viz.simTime, viz.currentState === 'working');
        }

        ctx.restore();
    }

    // Crane Beam
    ctx.fillStyle = (viz.currentState === 'off') ? '#451a03' : '#eab308';
    ctx.fillRect(-dockWidth / 2 - 5, dock.cranePos - 2, dockWidth + 10, 4);

    // Particles
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

function drawControlTower(ctx, x, y, w, h, isTop, viz) {
    ctx.save();
    ctx.translate(x, y);
    const theme = PALETTE[viz.currentState];
    ctx.fillStyle = theme.base;
    ctx.beginPath();
    const rightX = w / 2; const leftX = -w / 2;
    const topY = -h / 2; const botY = h / 2;
    if (isTop) {
        ctx.moveTo(rightX, botY); ctx.lineTo(leftX, botY);
        ctx.lineTo(leftX + 10, topY); ctx.lineTo(rightX, topY);
    } else {
        ctx.moveTo(rightX, topY); ctx.lineTo(leftX, topY);
        ctx.lineTo(leftX + 10, botY); ctx.lineTo(rightX, botY);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 2; ctx.stroke();

    // Bridge
    const bridgeW = w * 0.6; const bridgeH = h * 0.5;
    const bridgeX = leftX + bridgeW / 2 + 10; const bridgeY = isTop ? 5 : -5;
    ctx.fillStyle = (viz.currentState === 'off') ? '#0f172a' : '#0c4a6e';
    ctx.fillRect(bridgeX - bridgeW / 2, bridgeY - bridgeH / 2, bridgeW, bridgeH);
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1;
    ctx.strokeRect(bridgeX - bridgeW / 2, bridgeY - bridgeH / 2, bridgeW, bridgeH);
    ctx.restore();
}

function drawStorageDisplay(ctx, x, y, w, h, viz) {
    ctx.save();
    ctx.translate(x, y);

    // Using Control Tower shape for storage as well to match style
    drawControlTower(ctx, 0, 0, w, h, true, viz);

    // Overlay text
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`PROD: ${viz.producedUnits}`, 0, 5);

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

    const sourceHeight = 500;
    const scale = (size / sourceHeight) * 2.5;
    ctx.scale(scale, scale);

    const unitLen = 160;
    const unitThick = 150;
    const spacing = 10;
    const totalHeight = DOCKS_COUNT * (unitThick + spacing);

    const docksX = 50;
    const spineX = docksX + unitLen / 2 + 20;
    const transportX = docksX - unitLen / 2;
    const mainDockX = transportX - 60; // Adjusted for better alignment

    // Background Dock
    drawMainDockPart(ctx, mainDockX, 0, 200, totalHeight + 20, 'back', viz);

    // Spine
    ctx.fillStyle = theme.base;
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 4;
    const spineW = 40;
    ctx.fillRect(spineX - spineW / 2, -totalHeight / 2 - 20, spineW, totalHeight + 40);
    ctx.strokeRect(spineX - spineW / 2, -totalHeight / 2 - 20, spineW, totalHeight + 40);

    if (viz.currentState === 'working') {
        ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 4;
        ctx.setLineDash([10, 20]);
        ctx.lineDashOffset = time * 50;
        ctx.beginPath(); ctx.moveTo(spineX, -totalHeight / 2 + 10); ctx.lineTo(spineX, totalHeight / 2 - 10); ctx.stroke();
        ctx.setLineDash([]);
    }

    // Towers
    const towerHeight = 60;
    const topTowerY = -totalHeight / 2 - towerHeight / 2 - 10;
    const botTowerY = totalHeight / 2 + towerHeight / 2 + 10;

    drawStorageDisplay(ctx, docksX, topTowerY, unitLen, towerHeight, viz);
    drawControlTower(ctx, docksX, botTowerY, unitLen, towerHeight, false, viz);

    // Docks
    const firstDockY = 0;
    for (let i = 0; i < DOCKS_COUNT; i++) {
        const dock = viz.docks[i];
        const y = firstDockY + i * (unitThick + spacing);
        drawShipyardUnit(ctx, dock, docksX, y, unitThick, unitLen, viz, spriteImg);

        // Connector to spine
        ctx.fillStyle = '#334155';
        const dockRight = docksX + unitLen / 2;
        ctx.fillRect(dockRight - 5, y - 5, spineX - dockRight + 5, 10);
    }

    // Front Dock Layer
    drawMainDockPart(ctx, mainDockX, 0, 200, totalHeight + 20, 'front', viz);

    ctx.restore();
}
