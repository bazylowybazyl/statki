/**
 * hudSystem.js
 * Logika sterująca nowym interfejsem Aero/Glass HUD.
 * Zoptymalizowana wersja z DOM Caching i Zero-GC Batching.
 */

export class HexArmorHUD {
    constructor(containerId, width, height) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.container.innerHTML = '';

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'hex-armor-canvas';
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);

        this.gridRef = null;
        this.layoutCells = [];
        this.shardsRef = null;
        this.shardCount = 0;
        this.lastDrawMs = 0;
        
        // Możesz teraz spróbować zmienić to na 33 (30 FPS) lub nawet 16 (60 FPS)
        this.minDrawIntervalMs = 80; 
        
        this.fillMissing = 'rgba(10, 10, 10, 0.95)';
        this.strokeMissing = 'rgba(55, 55, 55, 0.85)';
        this.strokeAlive = 'rgba(15, 20, 10, 0.85)';
        
        // Generujemy zestaw pre-renderowanych obrazków (Sprite'ów) dla maksymalnej wydajności
        this.hexSprites = new Array(102);
        this.generateHexSprites();
    }

    // TA FUNKCJA WYKONA SIĘ TYLKO RAZ - RYSUJE SPRITE'Y DO PAMIĘCI
    generateHexSprites() {
        const size = 32;     // Rozmiar wirtualnego płótna dla 1 heksa
        const r = 14;        // Promień heksa (zostawia 2px marginesu na ramkę)
        const cx = size / 2;
        const cy = size / 2;

        for (let i = 0; i < 102; i++) {
            const offscreenCanvas = document.createElement('canvas');
            offscreenCanvas.width = size;
            offscreenCanvas.height = size;
            const oCtx = offscreenCanvas.getContext('2d');

            let fill = this.fillMissing;
            let stroke = this.strokeMissing;

            if (i <= 100) {
                const t = i / 100;
                const red = Math.round(255 * (1 - t));
                const green = Math.round(255 * t);
                fill = `rgba(${red}, ${green}, 40, 0.95)`;
                stroke = this.strokeAlive;
            }

            oCtx.beginPath();
            for (let k = 0; k < 6; k++) {
                const angle = (Math.PI / 3) * k + Math.PI / 6;
                const px = cx + r * Math.cos(angle);
                const py = cy + r * Math.sin(angle);
                if (k === 0) oCtx.moveTo(px, py);
                else oCtx.lineTo(px, py);
            }
            oCtx.closePath();
            
            oCtx.fillStyle = fill;
            oCtx.fill();
            oCtx.lineWidth = 1.5; // Lekko pogrubiona, by ładnie wyglądała po zmniejszeniu
            oCtx.strokeStyle = stroke;
            oCtx.stroke();

            // Zapisujemy gotowy stempel
            this.hexSprites[i] = offscreenCanvas;
        }
    }

    updateFromShip(ship) {
        if (!this.ctx) return;

        const grid = ship?.hexGrid;
        if (!grid?.shards?.length) {
            this.gridRef = null;
            this.layoutCells = [];
            this.shardsRef = null;
            this.shardCount = 0;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            return;
        }

        const shards = grid.shards;
        const needsRebuild = this.gridRef !== grid || this.shardsRef !== shards || this.shardCount !== shards.length;
        if (needsRebuild) {
            this.gridRef = grid;
            this.shardsRef = shards;
            this.shardCount = shards.length;
            this.rebuildLayout(grid);
        }

        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (!needsRebuild && (now - this.lastDrawMs) < this.minDrawIntervalMs) return;

        this.draw();
        this.lastDrawMs = now;
    }

    rebuildLayout(grid) {
        const width = this.canvas.width || 1;
        const height = this.canvas.height || 1;
        const srcW = Number(grid.srcWidth) || 1;
        const srcH = Number(grid.srcHeight) || 1;
        const cx = srcW * 0.5;
        const cy = srcH * 0.5;
        const pX = Number(grid?.pivot?.x) || 0;
        const pY = Number(grid?.pivot?.y) || 0;
        const shards = grid.shards || [];

        if (!shards.length) {
            this.layoutCells = [];
            return;
        }

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        const transformed = new Array(shards.length);
        for (let i = 0; i < shards.length; i++) {
            const shard = shards[i];
            if (!shard) continue;
            const localX = (Number(shard.gridX) || 0) - cx - pX;
            const localY = (Number(shard.gridY) || 0) - cy - pY;
            const radius = Math.max(1, Number(shard.radius) || 1);

            const rotX = localY;
            const rotY = -localX;

            transformed[i] = { shard, x: rotX, y: rotY, radius };
            minX = Math.min(minX, rotX - radius);
            maxX = Math.max(maxX, rotX + radius);
            minY = Math.min(minY, rotY - radius);
            maxY = Math.max(maxY, rotY + radius);
        }

        const spanX = Math.max(1, maxX - minX);
        const spanY = Math.max(1, maxY - minY);
        const padding = 8;
        const usableW = Math.max(1, width - padding * 2);
        const usableH = Math.max(1, height - padding * 2);
        const scale = Math.max(0.1, Math.min(usableW / spanX, usableH / spanY));
        const midX = (minX + maxX) * 0.5;
        const midY = (minY + maxY) * 0.5;

        this.layoutCells = transformed.filter(Boolean).map(cell => ({
            shard: cell.shard,
            x: (cell.x - midX) * scale + width * 0.5,
            y: (cell.y - midY) * scale + height * 0.5,
            radius: Math.max(1.2, cell.radius * scale * 0.95)
        }));
    }

    draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Wyłączamy wygładzanie obrazu dla ostrych krawędzi (opcjonalne, dodaje ostrości miniaturom)
        ctx.imageSmoothingEnabled = false;

        for (let i = 0; i < this.layoutCells.length; i++) {
            const cell = this.layoutCells[i];
            const shard = cell.shard;
            
            let spriteIdx = 101; // Domyślnie zniszczony heks
            
            if (shard && shard.active && !shard.isDebris && shard.hp > 0) {
                const maxHp = Math.max(1, Number(shard.maxHp) || 1);
                const hpRatio = Math.max(0, Math.min(1, (Number(shard.hp) || 0) / maxHp));
                spriteIdx = Math.max(0, Math.min(100, Math.round(hpRatio * 100)));
            }
            
            const r = cell.radius;
            // Skalujemy oryginalny sprite 32x32 (z narysowanym heksem o promieniu 14) do potrzebnego rozmiaru
            const drawSize = 32 * (r / 14);
            const halfSize = drawSize * 0.5;
            
            // JEDYNA OPERACJA RYSOWANIA - Używa sprzętowego przyspieszenia GPU!
            ctx.drawImage(this.hexSprites[spriteIdx], cell.x - halfSize, cell.y - halfSize, drawSize, drawSize);
        }
    }
}

export class HUDSystem {
    constructor() {
        this.menuState = 'IDLE';
        this.menuClearTimer = null;
        this.stationTerminalLastRefreshMs = 0;
        this.hexHud = null;
        this.terminalState = {
            step: 'OFF',
            targetStation: null,
            bootTimer: null,
            connectTimer: null
        };
        this.terminalInteraction = {
            hover: false,
            pointerDown: false
        };
        
        // Obiekt do Caching'u DOM - zapobiega DOM Thrashing
        this.cache = {};

        this.skillKeys = [
            { key: '4', label: 'MODE' },
            { key: '5', label: 'COMM' },
            { key: 'CAPS', label: 'SCAN' },
            { key: '6', label: 'MAP' },
            { key: '7', label: 'AUTO' },
            { key: '8', label: 'AUX' }
        ];
        
        this.dom = {
            hpFill: document.getElementById('fill-hp'),
            hpGhost: document.getElementById('ghost-hp'),
            shieldFill: document.getElementById('fill-shield'),
            shieldGhost: document.getElementById('ghost-shield'),
            valHp: document.getElementById('val-hp'),
            valShield: document.getElementById('val-shield'),
            
            powerFill: document.getElementById('fill-power'),
            boostFill: document.getElementById('fill-boost'),
            coreFill: document.getElementById('fill-core'),
            warpFill: document.getElementById('fill-warp'),
            
            warpContainer: document.getElementById('warp-container'),
            warpText: document.getElementById('warp-text'),
            
            speedVal: document.getElementById('val-speed'),
            locText: document.getElementById('loc-text'),
            
            centerDock: document.getElementById('hud-center-dock'),
            topDock: document.getElementById('hud-top-dock'),
            bottomDrawer: document.getElementById('bottom-drawer'),
            drawerContent: document.getElementById('drawer-content-wrapper'),
            
            hpWing: document.getElementById('left-wing'), 
            hpUnit: document.getElementById('hp-unit'),
            shieldUnit: document.getElementById('shield-unit'),
            
            skillRow: document.getElementById('skill-row')
        };

        this.agilityUI = {
            container: null,
            dash: null,
            strafe: null,
            arc: null
        };
    }

    init() {
        this.hexHud = new HexArmorHUD('hex-armor-container', 160, 200);
        this.renderSkillKeys();
        this.setupSupportDrag();
        this.createAgilityUI();

        window.togglePanel = (id) => {
            const panel = document.getElementById(id);
            if(panel) panel.classList.toggle('collapsed');
        };

        const btn1 = this.dom.skillRow?.querySelector('.glass-key:nth-child(1)');
        if(btn1) btn1.addEventListener('click', () => this.setBottomMenuState('MODE'));

        const btn2 = this.dom.skillRow?.querySelector('.glass-key:nth-child(2)');
        if(btn2) btn2.addEventListener('click', () => this.setBottomMenuState('COMM'));

        const btn3 = this.dom.skillRow?.querySelector('.glass-key:nth-child(3)');
        if(btn3) btn3.addEventListener('click', () => this.setBottomMenuState('SCAN'));

        const terminalHost = this.dom.drawerContent;
        if (terminalHost) {
            terminalHost.addEventListener('pointerenter', () => {
                this.terminalInteraction.hover = true;
            });
            terminalHost.addEventListener('pointerleave', () => {
                this.terminalInteraction.hover = false;
                this.terminalInteraction.pointerDown = false;
            });
            terminalHost.addEventListener('pointerdown', () => {
                this.terminalInteraction.pointerDown = true;
            });
            terminalHost.addEventListener('pointerup', () => {
                this.terminalInteraction.pointerDown = false;
            });
            terminalHost.addEventListener('pointercancel', () => {
                this.terminalInteraction.pointerDown = false;
            });
        }
        
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (typeof window.isStationUIOpen === 'function' && window.isStationUIOpen()) return;
            const digitKey = (e.code && e.code.startsWith('Digit')) ? e.code.slice(5)
                : (e.code && e.code.startsWith('Numpad')) ? e.code.slice(6)
                : null;

            if (e.key === 'k' || e.key === 'K') {
                this.toggleTopPanel();
            }
            
            if (this.menuState === 'IDLE') {
                if (digitKey === '4' || e.key === '4') this.setBottomMenuState('MODE');
                if (digitKey === '5' || e.key === '5') this.setBottomMenuState('COMM');
                if (e.code === 'CapsLock') this.setBottomMenuState('SCAN');
            } else if (this.menuState === 'MODE') {
                if (digitKey === '4' || e.key === '4') this.handleMenuAction('close');
            } else if (this.menuState === 'COMM') {
                if (digitKey === '4' || e.key === '4') this.handleMenuAction('gate-toggle');
                if (digitKey === '5' || e.key === '5') this.handleMenuAction('close');
                if (digitKey === '6' || e.key === '6') this.handleMenuAction('gate-auto');
            } else if (this.menuState === 'SCAN' || this.menuState === 'STATION') {
                if (digitKey === '4' || e.key === '4') this.handleMenuAction('close');
                if (e.key === '0' || e.key === 'Escape' || e.code === 'CapsLock') this.handleMenuAction('close');
            }
        });
    }

    createAgilityUI() {
        const container = document.createElement('div');
        container.className = 'agility-hud-container hidden'; 
        
        container.style.cssText = `
            position: absolute;
            bottom: 140px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 15px;
            pointer-events: none;
            z-index: 100;
        `;

        const createSkillSlot = (label, key) => {
            const slot = document.createElement('div');
            slot.className = 'agility-skill-slot';
            slot.style.cssText = `
                width: 50px; height: 50px;
                background: rgba(10, 20, 40, 0.6);
                border: 1px solid rgba(100, 200, 255, 0.3);
                border-radius: 6px;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                color: #aab; font-family: monospace; font-size: 10px;
                position: relative; overflow: hidden;
            `;
            
            const fill = document.createElement('div');
            fill.className = 'agility-skill-fill';
            fill.style.cssText = `
                position: absolute; bottom: 0; left: 0; width: 100%; height: 0%;
                background: rgba(255, 50, 50, 0.4);
                transition: height 0.1s linear;
            `;

            const text = document.createElement('span');
            text.innerHTML = `<strong>${key}</strong><br>${label}`;
            text.style.position = 'relative';
            text.style.textAlign = 'center';

            slot.appendChild(fill);
            slot.appendChild(text);

            return { root: slot, fill: fill };
        };

        this.agilityUI.dash = createSkillSlot('DASH', 'W/S');
        this.agilityUI.strafe = createSkillSlot('STRAF', 'Q/E');
        this.agilityUI.arc = createSkillSlot('ORBIT', 'A/D');

        container.appendChild(this.agilityUI.dash.root);
        container.appendChild(this.agilityUI.strafe.root);
        container.appendChild(this.agilityUI.arc.root);

        const hudBottom = document.getElementById('hud-bottom-container');
        if (hudBottom) {
            hudBottom.appendChild(container);
        } else {
            document.body.appendChild(container);
        }
        
        this.agilityUI.container = container;
    }

    setupSupportDrag() {
        const supportPanel = document.getElementById('panel-support');
        if (!supportPanel) return;

        const cards = supportPanel.querySelectorAll('.support-card');
        const spawnTypes = ['carrier_capital', 'battleship', 'destroyer', 'frigate_pd', 'fighter'];

        cards.forEach((card, index) => {
            const spawnKey = card.dataset.supportSpawn || card.dataset.spawnType || spawnTypes[index];
            const clickOnly = spawnKey === 'fighter' || spawnKey === 'carrier_fighter';
            
            if (spawnKey && !clickOnly) {
                card.addEventListener('mousedown', (event) => {
                    if (event.button !== 0) return; 
                    if (typeof window.beginSupportDrag === 'function') {
                        window.beginSupportDrag(spawnKey, card);
                    }
                });
            }
        });
    }

    update(ship, sys, env) {
        if (this.dom.centerDock && this.dom.centerDock.offsetParent === null) return;
        if (!ship || !this.dom.hpFill) return;
        if (this.menuState === 'SCAN' || this.menuState === 'STATION') {
            const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const canRefreshStationList =
                this.terminalState.step === 'LIST' &&
                !this.terminalInteraction.hover &&
                !this.terminalInteraction.pointerDown;
            if (canRefreshStationList && (nowMs - this.stationTerminalLastRefreshMs) >= 1200) {
                this.refreshOpenMenu();
                this.stationTerminalLastRefreshMs = nowMs;
            }
        }

        // DOM CACHING - przeliczamy i ustawiamy wartości tylko jeśli uległy zmianie!
        const hpPct = Math.max(0, (ship.hull.val / ship.hull.max) * 100).toFixed(1);
        if (this.cache.hpPct !== hpPct) {
            this.dom.hpFill.style.width = `${hpPct}%`;
            this.dom.hpGhost.style.width = `${hpPct}%`;
            this.cache.hpPct = hpPct;
            
            const isCritical = hpPct < 30;
            if (this.cache.hpCritical !== isCritical) {
                this.dom.hpUnit.classList.toggle('hull-critical', isCritical);
                this.dom.centerDock.classList.toggle('critical', isCritical);
                this.cache.hpCritical = isCritical;
            }
        }

        const shPct = Math.max(0, (ship.shield.val / ship.shield.max) * 100).toFixed(1);
        if (this.cache.shPct !== shPct) {
            this.dom.shieldFill.style.width = `${shPct}%`;
            this.dom.shieldGhost.style.width = `${shPct}%`;
            this.cache.shPct = shPct;
            
            const shCritical = shPct < 30;
            if (this.cache.shCritical !== shCritical) {
                this.dom.shieldUnit.classList.toggle('shield-critical', shCritical);
                this.cache.shCritical = shCritical;
            }
        }

        const hpVal = Math.round(ship.hull.val);
        if (this.cache.hpVal !== hpVal) {
            this.dom.valHp.textContent = hpVal;
            this.cache.hpVal = hpVal;
        }

        const shVal = Math.round(ship.shield.val);
        if (this.cache.shVal !== shVal) {
            this.dom.valShield.textContent = shVal;
            this.cache.shVal = shVal;
        }

        if (sys.power !== undefined) {
            const pwr = Math.round(sys.power);
            if (this.cache.power !== pwr) {
                this.dom.powerFill.style.width = `${pwr}%`;
                this.cache.power = pwr;
            }
        }

        if (sys.boost !== undefined) {
            const bst = Math.round(sys.boost);
            if (this.cache.boost !== bst) {
                this.dom.boostFill.style.width = `${bst}%`;
                this.cache.boost = bst;
            }
        }

        const coreVal = sys.core !== undefined ? Math.round(sys.core) : 100;
        if (this.cache.core !== coreVal) {
            this.dom.coreFill.style.width = `${coreVal}%`;
            this.cache.core = coreVal;
        }

        const isWarping = (sys.warpState === 'charging' || sys.warpState === 'active');
        if (this.cache.isWarping !== isWarping) {
            this.dom.centerDock.classList.toggle('warp-mode', isWarping);
            if (!isWarping) this.dom.warpFill.style.width = '0%';
            this.cache.isWarping = isWarping;
        }

        if (isWarping) {
            const chargePct = Math.round((sys.warpCharge / sys.warpMax) * 100);
            if (this.cache.warpCharge !== chargePct) {
                this.dom.warpFill.style.width = `${chargePct}%`;
                this.dom.warpText.textContent = sys.warpState === 'active' ? "WARP ACTIVE" : `CHARGING ${chargePct}%`;
                this.cache.warpCharge = chargePct;
            }
        }

        const speed = Math.round(Math.hypot(ship.vel.x, ship.vel.y));
        if (this.cache.speed !== speed) {
            this.dom.speedVal.textContent = speed;
            this.cache.speed = speed;
        }
        
        if (env && env.locationName && this.cache.locName !== env.locationName) {
            this.dom.locText.textContent = env.locationName;
            this.cache.locName = env.locationName;
        }

        // --- AKTUALIZACJA UI AGILITY (Z CACHINGIEM) ---
        if (this.agilityUI && this.agilityUI.container) {
            const agilActive = !!(ship.agility && ship.agility.active);
            if (this.cache.agilActive !== agilActive) {
                this.agilityUI.container.classList.toggle('hidden', !agilActive);
                this.cache.agilActive = agilActive;
            }

            if (agilActive) {
                const dashPct = Math.round((ship.agility.cooldowns.dash / ship.agility.maxCooldowns.dash) * 100);
                if (this.cache.dashPct !== dashPct) {
                    this.agilityUI.dash.fill.style.height = `${Math.max(0, dashPct)}%`;
                    this.agilityUI.dash.root.style.borderColor = dashPct <= 0 ? 'rgba(100, 255, 100, 0.8)' : 'rgba(100, 200, 255, 0.3)';
                    this.cache.dashPct = dashPct;
                }

                const strafePct = Math.round((ship.agility.cooldowns.strafe / ship.agility.maxCooldowns.strafe) * 100);
                if (this.cache.strafePct !== strafePct) {
                    this.agilityUI.strafe.fill.style.height = `${Math.max(0, strafePct)}%`;
                    this.agilityUI.strafe.root.style.borderColor = strafePct <= 0 ? 'rgba(100, 255, 100, 0.8)' : 'rgba(100, 200, 255, 0.3)';
                    this.cache.strafePct = strafePct;
                }

                const arcPct = Math.round((ship.agility.cooldowns.arc / ship.agility.maxCooldowns.arc) * 100);
                const isArcCharging = ship.agility.arcCharge > 0;
                
                if (this.cache.arcPct !== arcPct || this.cache.isArcCharging !== isArcCharging) {
                    this.agilityUI.arc.fill.style.height = `${Math.max(0, arcPct)}%`;
                    if (isArcCharging) {
                        this.agilityUI.arc.root.style.borderColor = 'rgba(255, 200, 50, 0.9)';
                        this.agilityUI.arc.fill.style.height = '100%';
                        this.agilityUI.arc.fill.style.background = 'rgba(255, 200, 50, 0.4)';
                    } else {
                        this.agilityUI.arc.root.style.borderColor = arcPct <= 0 ? 'rgba(100, 255, 100, 0.8)' : 'rgba(100, 200, 255, 0.3)';
                        this.agilityUI.arc.fill.style.background = 'rgba(255, 50, 50, 0.4)';
                    }
                    this.cache.arcPct = arcPct;
                    this.cache.isArcCharging = isArcCharging;
                }
            }
        }

        // To zostaje, HexArmorHUD samo zarządza swoimi interwałami 
        if (this.hexHud) this.hexHud.updateFromShip(ship);
    }

    toggleTopPanel() {
        if(this.dom.topDock) this.dom.topDock.classList.toggle('expanded');
    }

    setBottomMenuState(state) {
        if (state === 'STATION') state = 'SCAN';
        if (this.menuState === 'STATION') this.menuState = 'SCAN';

        if (this.menuClearTimer) {
            clearTimeout(this.menuClearTimer);
            this.menuClearTimer = null;
        }

        if (this.menuState === state && state !== 'IDLE') {
            state = 'IDLE';
        }

        const previousState = this.menuState;
        this.menuState = state;

        if (this.terminalState.bootTimer) {
            clearTimeout(this.terminalState.bootTimer);
            this.terminalState.bootTimer = null;
        }
        if (this.terminalState.connectTimer) {
            clearTimeout(this.terminalState.connectTimer);
            this.terminalState.connectTimer = null;
        }

        if (state === 'SCAN' && previousState !== 'SCAN') {
            this.terminalState.step = 'BOOTING';
            this.terminalState.targetStation = null;
            this.stationTerminalLastRefreshMs = 0;
            this.terminalState.bootTimer = setTimeout(() => {
                this.handleMenuAction('terminal-boot-done');
            }, 1200);
        }
        if (state !== 'SCAN') {
            this.terminalState.step = 'OFF';
            this.terminalState.targetStation = null;
        }
        const drawer = this.dom.bottomDrawer;
        const wrapper = this.dom.drawerContent;

        if (state === 'IDLE') {
            this.dom.centerDock.classList.remove('expanded');
            drawer.style.height = '0px';
            
            this.menuClearTimer = setTimeout(() => { 
                wrapper.innerHTML = ''; 
                this.menuClearTimer = null;
            }, 400); 
            
        } else {
            const newHTML = this.getMenuHTML(state);

            if (previousState !== 'IDLE' && previousState !== state) {
                wrapper.classList.add('fading');
                setTimeout(() => {
                    wrapper.innerHTML = newHTML;
                    const newHeight = wrapper.scrollHeight;
                    requestAnimationFrame(() => {
                         drawer.style.height = newHeight + 'px';
                         wrapper.classList.remove('fading');
                    });
                }, 150);
            } else {
                wrapper.innerHTML = newHTML;
                drawer.style.height = '0px'; 
                
                requestAnimationFrame(() => {
                    const targetHeight = wrapper.scrollHeight;
                    drawer.style.height = targetHeight + 'px';
                    this.dom.centerDock.classList.add('expanded');
                });
            }
        }
        this.updateActiveKeys();
    }

    updateActiveKeys() {
        if (!this.dom.skillRow) return;
        const btns = this.dom.skillRow.querySelectorAll('.glass-key');
        btns.forEach(b => b.classList.remove('active'));
        
        if (this.menuState === 'MODE') {
            const btn = this.dom.skillRow.querySelector('.glass-key:nth-child(1)'); 
            if(btn) btn.classList.add('active');
        } else if (this.menuState === 'COMM') {
            const btn = this.dom.skillRow.querySelector('.glass-key:nth-child(2)'); 
            if(btn) btn.classList.add('active');
        } else if (this.menuState === 'SCAN' || this.menuState === 'STATION') {
            const btn = this.dom.skillRow.querySelector('.glass-key:nth-child(3)');
            if(btn) btn.classList.add('active');
        }
    }

    handleMenuAction(action, payload) {
        console.log("HUD Action:", action, payload);
        if (action === 'close') {
            this.setBottomMenuState('IDLE');
            return;
        }
        if (action === 'terminal-boot-done') {
            if (this.menuState !== 'SCAN') return;
            this.terminalState.step = 'LIST';
            this.terminalState.bootTimer = null;
            this.refreshOpenMenu();
            return;
        }
        if (action === 'terminal-connect') {
            if (this.menuState !== 'SCAN') return;
            this.terminalState.step = 'CONNECTING';
            this.terminalState.targetStation = payload || null;
            this.refreshOpenMenu();
            if (this.terminalState.connectTimer) {
                clearTimeout(this.terminalState.connectTimer);
            }
            this.terminalState.connectTimer = setTimeout(() => {
                this.handleMenuAction('terminal-connected');
            }, 1500);
            return;
        }
        if (action === 'terminal-connected') {
            if (this.menuState !== 'SCAN') return;
            this.terminalState.step = 'CONNECTED';
            this.terminalState.connectTimer = null;
            this.refreshOpenMenu();
            return;
        }
        if (action === 'terminal-open-service') {
            const stationId = this.terminalState.targetStation;
            const stationIdKey = stationId != null ? String(stationId) : '';
            const stations = Array.isArray(window.stations) ? window.stations : [];
            let station = stations.find((st) => st && String(st.id) === stationIdKey);
            if (!station && window.ship?.pos && stations.length) {
                let bestDist = Infinity;
                for (let i = 0; i < stations.length; i++) {
                    const st = stations[i];
                    if (!st) continue;
                    const dx = (Number(st.x) || 0) - window.ship.pos.x;
                    const dy = (Number(st.y) || 0) - window.ship.pos.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < bestDist) {
                        bestDist = distSq;
                        station = st;
                    }
                }
            }
            if (!station) return;
            const rawTab = String(payload || 'upgrades').toLowerCase();
            const tabId = rawTab === 'market' ? 'trade' : rawTab;
            if (window.stationUI) {
                window.stationUI.tab = tabId;
            }
            if (typeof window.openStationUI === 'function') {
                window.openStationUI(station, tabId);
                this.setBottomMenuState('IDLE');
            }
            return;
        }
    }

    refreshOpenMenu() {
        if (this.menuState === 'IDLE') return;
        if (!this.dom.drawerContent) return;
        const nextHTML = this.getMenuHTML(this.menuState);
        if (this.cache.lastMenuHTML === nextHTML) return;
        this.dom.drawerContent.innerHTML = nextHTML;
        this.cache.lastMenuHTML = nextHTML;
        if (this.dom.bottomDrawer) {
            this.dom.bottomDrawer.style.height = `${this.dom.drawerContent.scrollHeight}px`;
        }
    }

    renderSkillKeys() {
        if (!this.dom.skillRow || this.dom.skillRow.children.length) return;
        this.skillKeys.forEach((entry) => {
            const keyEl = document.createElement('div');
            keyEl.className = 'glass-key';
            const hint = document.createElement('span');
            hint.textContent = entry.label;
            keyEl.appendChild(hint);
            keyEl.appendChild(document.createTextNode(entry.key));
            this.dom.skillRow.appendChild(keyEl);
        });
    }

    getMenuHTML(state) {
        if (state === 'MODE') {
            return `
                <div class="menu-header">SHIP OPERATION MODES</div>
                <div class="menu-grid">
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('close')"><div class="key-hint">4</div><div class="label">BACK</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('battle')" data-mode="battle"><div class="key-hint">—</div><div class="label">BATTLE</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('hypercruise')" data-mode="hypercruise"><div class="key-hint">—</div><div class="label">HC</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('cruise')" data-mode="cruise"><div class="key-hint">—</div><div class="label">CRUISE</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('mining')" data-mode="mining"><div class="key-hint">—</div><div class="label">MINING</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('intel')" data-mode="intel"><div class="key-hint">—</div><div class="label">INTEL</div></div>
                </div>
            `;
        } else if (state === 'COMM') {
            return `
                <div class="menu-header">COMM</div>
                <div class="menu-grid" style="align-items:flex-start; height:auto; flex-wrap:wrap; padding-bottom:40px;">
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('close')"><div class="key-hint">5</div><div class="label">BACK</div></div>
                </div>
                <div class="term-text" style="padding:12px; color:#66d9ff; font-size:11px;">
                    POLE SIŁOWE: AUTO<br>
                    Bariery energetyczne otwierają się automatycznie przy zbliżeniu.
                </div>
            `;
        } else if (state === 'SCAN' || state === 'STATION') {
            let content = '';

            if (this.terminalState.step === 'BOOTING') {
                content = `<div class="term-text blink">> sys.init()...<br>> uplink.establish()... PENDING<br>> scanning local space...</div>`;
            } else if (this.terminalState.step === 'LIST') {
                let stationsListHTML = '<div class="term-text" style="color:#ef4444;">NO SIGNAL DETECTED</div>';
                if (Array.isArray(window.stations) && window.ship?.pos) {
                    const sorted = window.stations
                        .map((st) => ({
                            ...st,
                            dist: Math.hypot((st?.x || 0) - window.ship.pos.x, (st?.y || 0) - window.ship.pos.y)
                        }))
                        .sort((a, b) => a.dist - b.dist)
                        .slice(0, 3);
                    stationsListHTML = sorted.map((st) => {
                        const distAU = (st.dist / 3000).toFixed(2);
                        const stName = st.planet ? st.planet.name : (st.name || st.id || 'Station');
                        return `
                        <div class="term-row">
                            <span class="term-target">[${String(st.id || 'N/A').toUpperCase()}] ${stName} - ${distAU} AU</span>
                            <button class="term-btn" onclick="hudSystem.handleMenuAction('terminal-connect', '${String(st.id || '')}')">CONNECT</button>
                        </div>`;
                    }).join('');
                }
                content = `<div class="term-text">> LOCAL NETWORK NODES FOUND:</div>${stationsListHTML}`;
            } else if (this.terminalState.step === 'CONNECTING') {
                content = `<div class="term-text blink">> Handshake with node [${this.terminalState.targetStation || 'N/A'}]...<br>> Exchanging encryption keys...<br>> Please wait.</div>`;
            } else if (this.terminalState.step === 'CONNECTED') {
                content = `
                    <div class="term-text" style="color: #4ade80;">> CONNECTION ESTABLISHED. AVAILABLE SERVICES:</div>
                    <div class="term-grid">
                        <button class="term-btn large" onclick="hudSystem.handleMenuAction('terminal-open-service', 'upgrades')">UPGRADES</button>
                        <button class="term-btn large" onclick="hudSystem.handleMenuAction('terminal-open-service', 'trade')">MARKET</button>
                        <button class="term-btn large" onclick="hudSystem.handleMenuAction('terminal-open-service', 'hangar')">HANGAR</button>
                        <button class="term-btn large" onclick="hudSystem.handleMenuAction('terminal-open-service', 'mechanic')">MECHANIC</button>
                        <button class="term-btn large" onclick="hudSystem.handleMenuAction('terminal-open-service', 'infrastructure')">INFRASTRUCTURE</button>
                    </div>
                `;
            } else {
                content = `<div class="term-text">> TERMINAL OFFLINE</div>`;
            }

            return `
                <div class="menu-header terminal-menu-header">UPLINK TERMINAL v1.0</div>
                <div class="terminal-container">
                    ${content}
                </div>
            `;
        }
        return '';
    }
}
