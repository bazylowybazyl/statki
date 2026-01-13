/**
 * hudSystem.js
 * Logika sterująca nowym interfejsem Aero/Glass HUD.
 * Obsługuje aktualizację pasków, animacje paneli oraz integrację z systemem gry.
 */

export class HexArmorHUD {
    constructor(containerId, width, height) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;
        
        this.container.innerHTML = '';
        
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);
        
        this.hexSize = 5; 
        this.hexGap = 2;
        this.grid = [];
        
        // Kształt pancerza (przykładowa macierz)
        this.shape = [
            [0,0,0,1,0,0,0],
            [0,0,1,1,1,0,0],
            [0,1,1,1,1,1,0],
            [0,1,1,1,1,1,0],
            [1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1],
            [0,1,1,1,1,1,0],
            [0,1,1,1,1,1,0],
            [0,0,1,1,1,0,0],
            [0,1,0,0,0,1,0],
            [0,1,0,0,0,1,0]
        ];
        
        this.initGrid();
    }

    initGrid() {
        const rows = this.shape.length;
        const cols = this.shape[0].length;
        
        const hexW = this.hexSize * 1.8; 
        const hexH = this.hexSize * 1.6;
        
        const gridWidth = cols * (hexW + this.hexGap);
        const gridHeight = rows * (hexH + this.hexGap);
        
        const startX = (this.canvas.width - gridWidth) / 2;
        const startY = (this.canvas.height - gridHeight) / 2;

        for(let r=0; r<rows; r++) {
            for(let c=0; c<cols; c++) {
                if(this.shape[r][c] === 1) {
                    const xOffset = (r % 2 === 0) ? 0 : (hexW / 2);
                    
                    this.grid.push({
                        r, c,
                        x: startX + c * (hexW + this.hexGap) + xOffset,
                        y: startY + r * (hexH + this.hexGap),
                        hp: 100, 
                        maxHp: 100,
                        flash: 0 
                    });
                }
            }
        }
    }

    draw() {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.shadowBlur = 4;
        this.ctx.shadowColor = 'rgba(255,255,255,0.2)';

        for(const hex of this.grid) {
            if(hex.hp <= 0) continue; 

            const hpRatio = hex.hp / hex.maxHp;
            let r, g, b, a;
            
            if (hex.flash > 0) {
                r=255; g=255; b=255; a=1.0;
                hex.flash -= 0.1; 
            } else {
                if(hpRatio > 0.6) {
                    r = 200; g = 220; b = 255; a = 0.6 + hpRatio * 0.4;
                } else if (hpRatio > 0.3) {
                    r = 255; g = Math.floor(150 + hpRatio * 100); b = 0; a = 0.8;
                } else {
                    r = 255; g = 0; b = 0; a = 0.9;
                }
            }

            const color = `rgba(${r}, ${g}, ${b}, ${a})`;
            this.drawHex(hex.x, hex.y, this.hexSize, color);
        }
        
        this.ctx.shadowBlur = 0; 
    }

    drawHex(x, y, r, color) {
        this.ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = 2 * Math.PI / 6 * (i + 0.5); 
            const x_i = x + r * Math.cos(angle);
            const y_i = y + r * Math.sin(angle);
            if (i === 0) this.ctx.moveTo(x_i, y_i);
            else this.ctx.lineTo(x_i, y_i);
        }
        this.ctx.closePath();
        this.ctx.fillStyle = color;
        this.ctx.fill();
    }
    
    // Metoda do symulacji uszkodzeń (możesz podpiąć pod system kolizji gry)
    damageHexAt(x, y, amount) {
        // Tu można dodać logikę trafienia w konkretny hex na podstawie coordów
        // Na razie prosta metoda losowa dla testów
        this.damageRandom(amount);
    }

    damageRandom(amount = 40) {
        const activeHexes = this.grid.filter(h => h.hp > 0);
        if(activeHexes.length > 0) {
            const center = activeHexes[Math.floor(Math.random() * activeHexes.length)];
            this.grid.forEach(h => {
                const dist = Math.abs(h.c - center.c) + Math.abs(h.r - center.r); 
                if(dist <= 1 && h.hp > 0) {
                    h.hp -= amount;
                    h.flash = 1.0; 
                }
            });
        }
    }
}

export class HUDSystem {
    constructor() {
        this.menuState = 'IDLE';
        this.menuClearTimer = null;
        this.hexHud = null;
        this.skillKeys = [
            { key: '1', label: 'MODE' },
            { key: '2', label: 'WEAP' },
            { key: '3', label: 'SCAN' },
            { key: '4', label: 'MAP' },
            { key: '5', label: 'AUTO' },
            { key: '6', label: 'AUX' }
        ];
        
        // Cache DOM elements
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
            
            hpWing: document.getElementById('left-wing'), // Lewe skrzydło (kontener)
            hpUnit: document.getElementById('hp-unit'),
            shieldUnit: document.getElementById('shield-unit'),
            
            skillRow: document.getElementById('skill-row')
        };
    }

    init() {
        // Inicjalizacja Heksów
        this.hexHud = new HexArmorHUD('hex-armor-container', 160, 200);

        this.renderSkillKeys();

        // Obsługa Drag & Drop dla panelu Wsparcia (integracja z grą)
        this.setupSupportDrag();

        // Listenery paneli bocznych (zwijanie)
        window.togglePanel = (id) => {
            const panel = document.getElementById(id);
            if(panel) panel.classList.toggle('collapsed');
        };

        // Listenery przycisków w menu dolnym (1 i 2)
        const btn1 = this.dom.skillRow?.querySelector('.glass-key:nth-child(1)');
        if(btn1) btn1.addEventListener('click', () => this.setBottomMenuState('MODE'));

        const btn2 = this.dom.skillRow?.querySelector('.glass-key:nth-child(2)');
        if(btn2) btn2.addEventListener('click', () => this.setBottomMenuState('WEAPONS'));
        
        // Obsługa klawiatury dla menu (jeśli gra nie blokuje)
        window.addEventListener('keydown', (e) => {
            // Ignoruj jeśli piszemy w inputach
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === 'k' || e.key === 'K') {
                this.toggleTopPanel();
            }
            
            if (this.menuState === 'IDLE') {
                if (e.key === '1') this.setBottomMenuState('MODE');
                if (e.key === '2') this.setBottomMenuState('WEAPONS');
            } else if (this.menuState === 'MODE') {
                if (e.key === '1') this.handleMenuAction('close');
                // Tutaj można dodać obsługę 2-6 dla trybów
            } else if (this.menuState === 'WEAPONS') {
                if (e.key === '2') this.handleMenuAction('close');
                // Tutaj obsługa wyboru broni
            }
        });
    }

    /**
     * Podpina logikę przeciągania (Drag & Drop) do nowych kart wsparcia.
     * Wykorzystuje globalną funkcję `beginSupportDrag(key)` z silnika gry.
     */
    setupSupportDrag() {
        const supportPanel = document.getElementById('panel-support');
        if (!supportPanel) return;

        // Pobieramy karty. Zakładamy, że w HTML dodamy atrybut data-spawn-type="fighter" itd.
        // Jeśli nie ma atrybutów, mapujemy po indeksie (mniej bezpieczne, ale zadziała na start).
        const cards = supportPanel.querySelectorAll('.support-card');
        
        // Mapa typów spawnów (musi zgadzać się z SUPPORT_SHIP_TEMPLATES w index.html)
        const spawnTypes = [
            'carrier_capital', // Capital (index 0) - lub 'capital' jeśli tak masz w configu
            'battleship',      // Battleship (index 1)
            'destroyer',       // Destroyer (index 2)
            'frigate_pd',      // Frigate (index 3) - domyślnie PD
            'fighter'          // Fighter (index 4)
        ];

        cards.forEach((card, index) => {
            // Pobierz typ z atrybutu (zalecane) lub z mapy
            const spawnKey = card.dataset.supportSpawn || card.dataset.spawnType || spawnTypes[index];
            const clickOnly = spawnKey === 'fighter' || spawnKey === 'carrier_fighter';
            
            if (spawnKey && !clickOnly) {
                card.addEventListener('mousedown', (event) => {
                    if (event.button !== 0) return; // Tylko lewy przycisk
                    
                    // Wywołanie funkcji globalnej gry
                    if (typeof window.beginSupportDrag === 'function') {
                        window.beginSupportDrag(spawnKey, card);
                        // Opcjonalnie: dźwięk kliknięcia interfejsu
                    } else {
                        console.warn('Game function beginSupportDrag not found!');
                    }
                });
            }
        });
    }

    /**
     * Główna pętla aktualizacji HUD.
     * Wywoływana z pętli gry (render loop).
     * @param {Object} ship - Obiekt statku gracza
     * @param {Object} sys - Obiekt systemów (boost, warp, engine)
     * @param {Object} env - Informacje o świecie (lokacja)
     */
    update(ship, sys, env) {
        // --- POPRAWKA (KROK 4) ---
        // Jeśli główny kontener (centerDock) jest ukryty (np. jesteśmy w menu), 
        // offsetParent będzie null. Wtedy przerywamy rysowanie.
        if (this.dom.centerDock && this.dom.centerDock.offsetParent === null) {
            return; 
        }
        // -------------------------

        if (!ship || !this.dom.hpFill) return;

        // 1. HP & Shield
        const hpPct = Math.max(0, (ship.hull.val / ship.hull.max) * 100);
        const shPct = Math.max(0, (ship.shield.val / ship.shield.max) * 100);

        this.dom.hpFill.style.width = `${hpPct}%`;
        this.dom.hpGhost.style.width = `${hpPct}%`;
        this.dom.shieldFill.style.width = `${shPct}%`;
        this.dom.shieldGhost.style.width = `${shPct}%`;

        this.dom.valHp.innerText = Math.round(ship.hull.val);
        this.dom.valShield.innerText = Math.round(ship.shield.val);

        // Critical State Logic
        if (hpPct < 30) {
            this.dom.hpUnit.classList.add('hull-critical');
            this.dom.centerDock.classList.add('critical');
        } else {
            this.dom.hpUnit.classList.remove('hull-critical');
            this.dom.centerDock.classList.remove('critical');
        }

        if (shPct < 30) {
            this.dom.shieldUnit.classList.add('shield-critical');
        } else {
            this.dom.shieldUnit.classList.remove('shield-critical');
        }

        // 2. Power / Boost / Core
        // Zakładam, że sys zawiera { power: 0-100, boost: 0-100, core: 0-100 }
        if (sys.power !== undefined) this.dom.powerFill.style.width = `${sys.power}%`;
        if (sys.boost !== undefined) this.dom.boostFill.style.width = `${sys.boost}%`;
        // Core - jeśli gra nie ma jeszcze logiki core, można symulować lub dać 100%
        const coreVal = sys.core !== undefined ? sys.core : 100;
        this.dom.coreFill.style.width = `${coreVal}%`;

        // 3. Warp
        if (sys.warpState === 'charging' || sys.warpState === 'active') {
            this.dom.centerDock.classList.add('warp-mode');
            const chargePct = (sys.warpCharge / sys.warpMax) * 100;
            this.dom.warpFill.style.width = `${chargePct}%`;
            this.dom.warpText.innerText = sys.warpState === 'active' ? "WARP ACTIVE" : `CHARGING ${Math.round(chargePct)}%`;
        } else {
            this.dom.centerDock.classList.remove('warp-mode');
            this.dom.warpFill.style.width = '0%';
        }

        // 4. Speed & Location
        const speed = Math.hypot(ship.vel.x, ship.vel.y);
        this.dom.speedVal.innerText = Math.round(speed);
        
        if (env && env.locationName) {
            this.dom.locText.innerText = env.locationName;
        }

        // 5. Hex Armor Draw
        if (this.hexHud) this.hexHud.draw();
    }

    toggleTopPanel() {
        if(this.dom.topDock) this.dom.topDock.classList.toggle('expanded');
    }

    setBottomMenuState(state) {
        if (this.menuClearTimer) {
            clearTimeout(this.menuClearTimer);
            this.menuClearTimer = null;
        }

        if (this.menuState === state && state !== 'IDLE') {
            state = 'IDLE';
        }

        const previousState = this.menuState;
        this.menuState = state;
        const drawer = this.dom.bottomDrawer;
        const wrapper = this.dom.drawerContent;

        if (state === 'IDLE') {
            // Closing
            this.dom.centerDock.classList.remove('expanded');
            drawer.style.height = '0px';
            
            this.menuClearTimer = setTimeout(() => { 
                wrapper.innerHTML = ''; 
                this.menuClearTimer = null;
            }, 400); 
            
        } else {
            // Opening
            const newHTML = this.getMenuHTML(state);

            if (previousState !== 'IDLE' && previousState !== state) {
                // Swapping content
                wrapper.classList.add('fading');
                setTimeout(() => {
                    wrapper.innerHTML = newHTML;
                    const newHeight = wrapper.scrollHeight;
                    // Używamy requestAnimationFrame dla płynności
                    requestAnimationFrame(() => {
                         drawer.style.height = newHeight + 'px';
                         wrapper.classList.remove('fading');
                    });
                }, 150);
            } else {
                // Opening from closed
                wrapper.innerHTML = newHTML;
                drawer.style.height = '0px'; // Reset for transition
                
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
            const btn = this.dom.skillRow.querySelector('.glass-key:nth-child(1)'); // Key 1
            if(btn) btn.classList.add('active');
        } else if (this.menuState === 'WEAPONS') {
            const btn = this.dom.skillRow.querySelector('.glass-key:nth-child(2)'); // Key 2
            if(btn) btn.classList.add('active');
        }
    }

    handleMenuAction(action) {
        // Tutaj można wywołać funkcje gry
        console.log("HUD Action:", action);
        if (action === 'close') {
            this.setBottomMenuState('IDLE');
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
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('close')"><div class="key-hint">1</div><div class="label">BACK</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('battle')" data-mode="battle"><div class="key-hint">2</div><div class="label">BATTLE</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('cruise')" data-mode="cruise"><div class="key-hint">3</div><div class="label">CRUISE</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('salvage')" data-mode="salvage"><div class="key-hint">4</div><div class="label">SALVAGE</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('mining')" data-mode="mining"><div class="key-hint">5</div><div class="label">MINING</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('intel')" data-mode="intel"><div class="key-hint">6</div><div class="label">INTEL</div></div>
                </div>
            `;
        } else if (state === 'WEAPONS') {
            return `
                <div class="menu-header">WEAPON SYSTEMS CONTROL</div>
                <div class="menu-grid" style="align-items:flex-start; height:auto; flex-wrap:wrap; padding-bottom:40px;">
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('special')"><div class="key-hint">1</div><div class="label">SPECIAL</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('close')"><div class="key-hint">2</div><div class="label">BACK</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('main')"><div class="key-hint">3</div><div class="label">MAIN</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('secondary')"><div class="key-hint">4</div><div class="label">SECONDARY</div></div>
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('hangar')"><div class="key-hint">5</div><div class="label">HANGAR</div></div>
                </div>
            `;
        }
        return '';
    }
}