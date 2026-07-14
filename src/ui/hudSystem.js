/**
 * hudSystem.js
 * Logika sterująca nowym interfejsem Aero/Glass HUD.
 * Zoptymalizowana wersja z DOM Caching i Zero-GC Batching.
 */

import { drawCicHudRadarSurface } from './cicDisplay.js';
import { CockpitUI } from './cockpitUI.js';

const CIC_MINI_RADAR_RANGES = Object.freeze([5000, 10000, 20000, 40000, 60000]);

class CicMiniRadarHUD {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.canvas = this.container?.querySelector?.('.hud-radar-canvas') || null;
        this.ctx = this.canvas?.getContext?.('2d') || null;
        this.totalEl = this.container?.querySelector?.('.hud-radar-readout .total') || null;
        this.hostileEl = this.container?.querySelector?.('.hud-radar-readout .hostile') || null;
        this.asteroidEl = this.container?.querySelector?.('.hud-radar-readout .asteroid') || null;
        this.rangeEl = this.container?.querySelector?.('.hud-radar-readout .range') || null;
        this.rangeButtons = Array.from(this.container?.querySelectorAll?.('[data-radar-range]') || []);
        this.lastDrawMs = 0;
        this.minDrawIntervalMs = 66;
        this.viewRange = 20000;
        this.model = null;
        this.cache = {};
        this.bindRangeControls();
        this.updateRangeControls();
    }

    update(model) {
        if (!this.ctx || !this.canvas) return;
        this.model = model;
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if ((now - this.lastDrawMs) < this.minDrawIntervalMs) return;
        this.lastDrawMs = now;
        this.draw(model);
        this.updateReadout(model);
    }

    bindRangeControls() {
        for (const button of this.rangeButtons) {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.setViewRange(Number(button.dataset.radarRange));
            });
        }
    }

    setViewRange(range) {
        const nextRange = Number(range);
        if (!CIC_MINI_RADAR_RANGES.includes(nextRange)) return;
        this.viewRange = nextRange;
        this.lastDrawMs = 0;
        this.updateRangeControls();
        this.updateReadout(this.model);
        if (this.ctx && this.canvas) this.draw(this.model);
    }

    updateRangeControls() {
        for (const button of this.rangeButtons) {
            const active = Number(button.dataset.radarRange) === this.viewRange;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
    }

    ensureCanvasSize() {
        const rect = this.canvas.getBoundingClientRect?.();
        const cssW = Math.max(1, Math.round(rect?.width || this.canvas.width || 176));
        const cssH = Math.max(1, Math.round(rect?.height || this.canvas.height || 176));
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const targetW = Math.round(cssW * dpr);
        const targetH = Math.round(cssH * dpr);
        if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
            this.canvas.width = targetW;
            this.canvas.height = targetH;
        }
        return { width: targetW, height: targetH };
    }

    updateReadout(model) {
        const counts = model?.counts || {};
        const total = Math.max(0, Number(counts.total) || 0);
        const hostile = Math.max(0, Number(counts.hostile) || 0);
        const asteroid = Math.max(0, Number(counts.asteroid) || 0);
        const rangeK = Math.max(1, Math.round(this.viewRange / 1000));
        if (this.cache.total !== total && this.totalEl) {
            this.totalEl.textContent = `C:${total}`;
            this.cache.total = total;
        }
        if (this.cache.hostile !== hostile && this.hostileEl) {
            this.hostileEl.textContent = `H:${hostile}`;
            this.cache.hostile = hostile;
        }
        if (this.cache.asteroid !== asteroid && this.asteroidEl) {
            this.asteroidEl.textContent = `A:${asteroid}`;
            this.cache.asteroid = asteroid;
        }
        if (this.cache.rangeK !== rangeK && this.rangeEl) {
            this.rangeEl.textContent = `${rangeK}K`;
            this.cache.rangeK = rangeK;
        }
    }

    draw(model) {
        const { width, height } = this.ensureCanvasSize();
        drawCicHudRadarSurface(this.ctx, width, height, model, {
            range: this.viewRange
        });
    }
}

export class HUDSystem {
    constructor() {
        this.menuState = 'IDLE';
        this.menuClearTimer = null;
        this.stationTerminalLastRefreshMs = 0;
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
        this.radarHud = null;
        this.cockpit = null;
        
        // Obiekt do Caching'u DOM - zapobiega DOM Thrashing
        this.cache = {};

        this.skillKeys = [
            { key: '1', label: 'MAIN', weaponType: 'main' },
            { key: '2', label: 'SPEC', weaponType: 'special' },
            { key: '3', label: 'MISS', weaponType: 'missile' },
            { key: '4', label: 'B-IN', weaponType: 'builtin' },
            { key: '5', label: 'SP.MISS', weaponType: 'special_missile' },
            { key: 'CAPS', label: 'SCAN', menuState: 'SCAN' },
            { key: '6', label: 'ENERGY' },
            { key: '7', label: 'AUTO' },
            { key: '8', label: 'MODE', menuState: 'MODE' },
            { key: '9', label: 'WARP' }
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
            driveReadout: document.getElementById('drive-readout'),
            driveMode: document.getElementById('drive-mode'),
            driveGear: document.getElementById('drive-gear'),
            driveRpm: document.getElementById('drive-rpm'),
            driveRpmFill: document.getElementById('drive-rpm-fill'),
            locDisplay: document.getElementById('location-display'),
            locLabel: document.getElementById('loc-label'),
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
        this.cockpit = new CockpitUI().init();
        this.radarHud = null;

        window.togglePanel = (id) => {
            const panel = document.getElementById(id);
            if(panel) panel.classList.toggle('collapsed');
        };

        const btn1 = this.dom.skillRow?.querySelector('.glass-key[data-menu-state="MODE"]');
        if(btn1) btn1.addEventListener('click', () => this.setBottomMenuState('MODE'));

        // slot 5 is now SP.MISS weapon, no COMM menu

        const btn3 = this.dom.skillRow?.querySelector('.glass-key[data-menu-state="SCAN"]');
        if(btn3) btn3.addEventListener('click', () => this.setBottomMenuState('SCAN'));

        const autoButton = this.dom.skillRow?.querySelector('.glass-key[data-key="7"]');
        if (autoButton) autoButton.addEventListener('click', () => window.shipDriveControls?.toggleAuto?.());

        const warpButton = this.dom.skillRow?.querySelector('.glass-key[data-key="9"]');
        if (warpButton) warpButton.addEventListener('click', () => window.shipDriveControls?.toggleWarp?.());

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
            if (e.code === 'Escape' && this.cockpit?.missionOpen) {
                this.cockpit.closeMissionJournal();
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
            if (typeof window.isStationUIOpen === 'function' && window.isStationUIOpen()) return;
            const digitKey = (e.code && e.code.startsWith('Digit')) ? e.code.slice(5)
                : (e.code && e.code.startsWith('Numpad')) ? e.code.slice(6)
                : null;

            if (e.key === 'k' || e.key === 'K') {
                this.toggleTopPanel();
            }
            
            if (this.menuState === 'IDLE') {
                if (digitKey === '8' || e.key === '8') this.setBottomMenuState('MODE');
                if (e.code === 'CapsLock') this.setBottomMenuState('SCAN');
            } else if (this.menuState === 'MODE') {
                if (digitKey === '8' || e.key === '8') this.handleMenuAction('close');
            } else if (this.menuState === 'SCAN' || this.menuState === 'STATION') {
                if (digitKey === '8' || e.key === '8') this.handleMenuAction('close');
                if (e.key === '0' || e.key === 'Escape' || e.code === 'CapsLock') {
                    this.handleMenuAction('close');
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
            }
        });
    }

    getRadarRange() {
        return this.cockpit?.getRadarRange?.() || this.radarHud?.viewRange || 20000;
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
        const spawnTypes = ['carrier', 'battleship', 'pirate_battleship', 'destroyer', 'frigate_pd', 'fighter'];

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
        this.cockpit?.update?.(ship, sys, env);
        if (this.dom.centerDock && this.dom.centerDock.offsetParent === null) return;
        if (!ship || !this.dom.hpFill) return;
        this.updateWeaponSlots(env?.weaponHud);
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

        const driveModeLabel = String(sys.driveModeLabel || sys.driveMode || 'BOJOWY').toUpperCase();
        if (this.cache.driveModeLabel !== driveModeLabel && this.dom.driveMode) {
            this.dom.driveMode.textContent = driveModeLabel;
            this.cache.driveModeLabel = driveModeLabel;
        }
        const driveGear = Math.max(1, Number(sys.driveGear) || 1);
        const driveGearCount = Math.max(driveGear, Number(sys.driveGearCount) || 1);
        const driveGearText = `G ${driveGear}/${driveGearCount}`;
        if (this.cache.driveGearText !== driveGearText && this.dom.driveGear) {
            this.dom.driveGear.textContent = driveGearText;
            this.cache.driveGearText = driveGearText;
        }
        const driveRpm = Math.max(0, Math.min(100, Math.round((Number(sys.driveRpm) || 0) * 100)));
        if (this.cache.driveRpm !== driveRpm) {
            if (this.dom.driveRpm) this.dom.driveRpm.textContent = `RPM ${driveRpm}%`;
            if (this.dom.driveRpmFill) this.dom.driveRpmFill.style.width = `${driveRpm}%`;
            this.cache.driveRpm = driveRpm;
        }
        const driveShiftBoost = !!sys.driveShiftBoost;
        if (this.cache.driveShiftBoost !== driveShiftBoost && this.dom.driveReadout) {
            this.dom.driveReadout.classList.toggle('shift-boost', driveShiftBoost);
            this.cache.driveShiftBoost = driveShiftBoost;
        }
        const driveAuto = !!sys.driveAuto;
        if (this.cache.driveAuto !== driveAuto) {
            const autoButton = this.dom.skillRow?.querySelector('.glass-key[data-key="7"]');
            if (autoButton) autoButton.classList.toggle('active', driveAuto);
            this.cache.driveAuto = driveAuto;
        }
        const driveMenuKey = `${sys.driveMode || ''}:${driveAuto ? 1 : 0}`;
        if (this.cache.driveMenuKey !== driveMenuKey) {
            this.cache.driveMenuKey = driveMenuKey;
            if (this.menuState === 'MODE') {
                this.cache.lastMenuHTML = null;
                this.refreshOpenMenu();
            }
        }
        
        if (this.dom.locDisplay && this.dom.locText && this.dom.locLabel) {
            const banner = env?.bannerMessage || null;
            const visible = !!banner;
            const topDockExpanded = !!this.dom.topDock?.classList.contains('expanded');
            if (visible) {
                const nextLabel = banner?.label || 'SHIP ALERT';
                const nextText = banner?.text || '';
                const nextTone = (banner?.tone || 'status').toLowerCase();

                if (this.cache.locBannerLabel !== nextLabel) {
                    this.dom.locLabel.textContent = nextLabel;
                    this.cache.locBannerLabel = nextLabel;
                }
                if (this.cache.locBannerText !== nextText) {
                    this.dom.locText.textContent = nextText;
                    this.cache.locBannerText = nextText;
                }
                if (this.cache.locTone !== nextTone) {
                    this.dom.locDisplay.classList.remove('tone-sector', 'tone-status', 'tone-warning');
                    this.dom.locDisplay.classList.add(
                        nextTone === 'sector' ? 'tone-sector' :
                        (nextTone === 'warning' ? 'tone-warning' : 'tone-status')
                    );
                    this.cache.locTone = nextTone;
                }
            }
            if (this.cache.locVisible !== visible) {
                this.dom.locDisplay.classList.toggle('is-visible', visible);
                this.dom.locDisplay.classList.toggle('is-hidden', !visible);
                this.cache.locVisible = visible;
            }
            const topDockHidden = !visible && !topDockExpanded;
            if (this.dom.topDock && this.cache.topDockHidden !== topDockHidden) {
                this.dom.topDock.classList.toggle('banner-hidden', topDockHidden);
                this.cache.topDockHidden = topDockHidden;
            }
            if (!visible && env?.locationName) {
                this.cache.locName = env.locationName;
            }
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

        if (this.radarHud) {
            this.radarHud.update(env?.radar);
        }

    }

    toggleTopPanel() {
        if(this.dom.topDock) this.dom.topDock.classList.toggle('expanded');
    }

    setBottomMenuState(state) {
        if (this.cockpit) {
            if (state === 'SCAN' || state === 'STATION') {
                const opened = this.cockpit.toggleComm();
                this.menuState = opened ? 'SCAN' : 'IDLE';
            } else if (state === 'IDLE') {
                this.cockpit.closeComm();
                this.menuState = 'IDLE';
            } else {
                this.menuState = 'IDLE';
            }
            return;
        }
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

        const autoButton = this.dom.skillRow.querySelector('.glass-key[data-key="7"]');
        if (autoButton) autoButton.classList.toggle('active', !!window.shipDriveControls?.getState?.()?.auto);
        
        if (this.menuState === 'MODE') {
            const btn = this.dom.skillRow.querySelector('.glass-key[data-menu-state="MODE"]'); 
            if(btn) btn.classList.add('active');
        } else if (this.menuState === 'COMM') {
            const btn = this.dom.skillRow.querySelector('.glass-key[data-menu-state="COMM"]'); 
            if(btn) btn.classList.add('active');
        } else if (this.menuState === 'SCAN' || this.menuState === 'STATION') {
            const btn = this.dom.skillRow.querySelector('.glass-key[data-menu-state="SCAN"]');
            if(btn) btn.classList.add('active');
        }
    }

    handleMenuAction(action, payload) {
        console.log("HUD Action:", action, payload);
        if (this.cockpit) {
            if (action === 'close') {
                this.setBottomMenuState('IDLE');
                return;
            }
            if (action === 'terminal-connect') {
                if (!this.cockpit.commOpen) this.cockpit.toggleComm(true);
                this.menuState = 'SCAN';
                this.cockpit.commBootUntil = 0;
                this.cockpit.connectStationById(payload);
                return;
            }
            if (action === 'terminal-open-service') {
                this.cockpit.openStationService(payload);
                return;
            }
            if (action === 'drive-combat' || action === 'drive-maneuver' || action === 'drive-travel') {
                window.shipDriveControls?.setMode?.(action.slice(6));
                return;
            }
            if (action === 'drive-auto') {
                window.shipDriveControls?.toggleAuto?.();
                return;
            }
        }
        if (action === 'close') {
            this.setBottomMenuState('IDLE');
            return;
        }
        if (action === 'drive-combat' || action === 'drive-maneuver' || action === 'drive-travel') {
            window.shipDriveControls?.setMode?.(action.slice(6));
            this.setBottomMenuState('IDLE');
            return;
        }
        if (action === 'drive-auto') {
            window.shipDriveControls?.toggleAuto?.();
            this.cache.lastMenuHTML = null;
            this.refreshOpenMenu();
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
            if (this.terminalState.bootTimer) {
                clearTimeout(this.terminalState.bootTimer);
                this.terminalState.bootTimer = null;
            }
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
        if (this.cockpit) {
            if (this.cockpit.commOpen) this.cockpit.renderComm();
            return;
        }
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

    toggleMissionJournal(force = null) {
        return this.cockpit?.toggleMissionJournal?.(force) || false;
    }

    logEvent(message, tone = '') {
        this.cockpit?.log?.(message, tone);
    }

    logZone(label, zoneId = '') {
        this.cockpit?.logZone?.(label, zoneId);
    }

    onMissionUpdated(mission, event = 'updated') {
        this.cockpit?.onMissionUpdated?.(mission, event);
    }

    renderSkillKeys() {
        if (!this.dom.skillRow || this.dom.skillRow.children.length) return;
        this.skillKeys.forEach((entry) => {
            const keyEl = document.createElement('div');
            keyEl.className = 'glass-key';
            const hint = document.createElement('span');
            hint.className = 'glass-key-hint';
            hint.textContent = entry.label;
            keyEl.dataset.key = entry.key;
            if (entry.weaponType) {
                keyEl.classList.add('glass-key-weapon');
                keyEl.dataset.weaponType = entry.weaponType;
                const icon = document.createElement('div');
                icon.className = 'glass-key-weapon-icon';
                icon.dataset.placeholder = entry.weaponType;
                const charge = document.createElement('div');
                charge.className = 'glass-key-weapon-charge';
                icon.appendChild(charge);
                keyEl.appendChild(hint);
                keyEl.appendChild(icon);
                const code = document.createElement('span');
                code.className = 'glass-key-code';
                code.textContent = entry.key;
                keyEl.appendChild(code);
            } else {
                if (entry.menuState) keyEl.dataset.menuState = entry.menuState;
                keyEl.appendChild(hint);
                const code = document.createElement('span');
                code.className = 'glass-key-code';
                code.textContent = entry.key;
                keyEl.appendChild(code);
            }
            this.dom.skillRow.appendChild(keyEl);
        });
    }

    updateWeaponSlots(weaponHud) {
        if (!this.dom.skillRow) return;
        const slots = this.dom.skillRow.querySelectorAll('.glass-key[data-weapon-type]');
        if (!slots.length) return;

        const iconPaths = window.WEAPON_ICON_PATHS || {};
        const slotState = weaponHud || {};
        const hasTargets = !!slotState.hasTargets;

        slots.forEach((slot) => {
            const weaponType = slot.dataset.weaponType;
            const state = slotState[weaponType] || null;
            const weapon = state?.weapon || null;
            const enabled = !!state?.enabled;
            const charge = Math.max(0, Math.min(1, Number(state?.charge) || 0));
            const iconHost = slot.querySelector('.glass-key-weapon-icon');
            if (!iconHost) return;
            const chargeEl = iconHost.querySelector('.glass-key-weapon-charge');

            const weaponId = weapon?.id || '';
            const iconPath = weaponId ? iconPaths[weaponId] : '';
            const cacheKey = `${weaponType}:${weaponId}:${iconPath || 'none'}`;
            if (slot.dataset.weaponCacheKey !== cacheKey) {
                const preservedCharge = chargeEl || document.createElement('div');
                preservedCharge.className = 'glass-key-weapon-charge';
                iconHost.innerHTML = '';
                iconHost.appendChild(preservedCharge);
                if (iconPath) {
                    const img = document.createElement('img');
                    img.src = iconPath;
                    img.loading = 'lazy';
                    img.alt = weapon?.name || weaponType;
                    iconHost.appendChild(img);
                } else {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'glass-key-weapon-placeholder';
                    placeholder.dataset.type = weaponType;
                    placeholder.textContent = weapon ? 'NO ART' : 'EMPTY';
                    iconHost.appendChild(placeholder);
                }
                slot.dataset.weaponCacheKey = cacheKey;
                slot.title = weapon?.name || '';
            }

            slot.classList.remove('weapon-slot-neutral', 'weapon-slot-standby', 'weapon-slot-armed', 'weapon-slot-empty');
            if (!weapon) {
                slot.classList.add('weapon-slot-empty');
                const liveCharge = iconHost.querySelector('.glass-key-weapon-charge');
                if (liveCharge) liveCharge.style.transform = 'scaleY(0)';
                return;
            }
            if (!hasTargets) {
                slot.classList.add('weapon-slot-neutral');
            } else {
                slot.classList.add(enabled ? 'weapon-slot-armed' : 'weapon-slot-standby');
            }
            const liveCharge = iconHost.querySelector('.glass-key-weapon-charge');
            if (liveCharge) liveCharge.style.transform = `scaleY(${charge.toFixed(3)})`;
        });
    }

    getMenuHTML(state) {
        if (state === 'MODE') {
            const drive = window.shipDriveControls?.getState?.() || {};
            const activeClass = (mode) => drive.mode === mode ? ' active' : '';
            return `
                <div class="menu-header">DRIVE MODE / TRANSMISSION</div>
                <div class="menu-grid">
                    <div class="menu-btn" onclick="hudSystem.handleMenuAction('close')"><div class="key-hint">8</div><div class="label">BACK</div></div>
                    <div class="menu-btn${activeClass('combat')}" onclick="hudSystem.handleMenuAction('drive-combat')" data-mode="combat"><div class="key-hint">5K</div><div class="label">BOJOWY</div></div>
                    <div class="menu-btn${activeClass('maneuver')}" onclick="hudSystem.handleMenuAction('drive-maneuver')" data-mode="maneuver"><div class="key-hint">2K</div><div class="label">MANEWROWY</div></div>
                    <div class="menu-btn${activeClass('travel')}" onclick="hudSystem.handleMenuAction('drive-travel')" data-mode="travel"><div class="key-hint">20K</div><div class="label">PODRÓŻ</div></div>
                    <div class="menu-btn${drive.auto ? ' active' : ''}" onclick="hudSystem.handleMenuAction('drive-auto')" data-mode="auto"><div class="key-hint">7</div><div class="label">AUTO ${drive.auto ? 'ON' : 'OFF'}</div></div>
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
