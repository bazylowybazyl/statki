/**
 * hudSystem.js — fasada interfejsu gracza nad kokpitem (src/ui/cockpitUI.js).
 *
 * Dawny HUD „Aero/Glass” (dolny dok z paskami, kafelki broni, panele boczne, mini-radar CIC)
 * usunięty 2026-10-19 — kokpit rysuje wszystko sam. Zostają:
 *  - klawisze łączności (`), dziennika misji (Esc) i zamykania COMM — handler rejestruje się
 *    w init(), PRZED handlerami index.html, więc przy otwartym COMM / dzienniku blokuje dalsze
 *    (stopImmediatePropagation: 0 nie gasi silników, Esc nie otwiera menu);
 *  - cienkie przejścia do kokpitu, z których korzysta gra i skrypty narzędzi
 *    (window.hudSystem.cockpit / pushAlert / getRadarRange).
 */

import { CockpitUI } from './cockpitUI.js';

export class HUDSystem {
    constructor() {
        this.cockpit = null;
    }

    init() {
        this.cockpit = new CockpitUI().init();
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
    }

    onKeyDown(e) {
        if (e.repeat) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const cockpit = this.cockpit;
        if (!cockpit) return;
        if (e.code === 'Escape' && cockpit.missionOpen) {
            cockpit.closeMissionJournal();
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
        if (typeof window.isStationUIOpen === 'function' && window.isStationUIOpen()) return;
        if (!cockpit.commOpen) {
            // ` — łączność ze stacjami (CapsLock to warp od 2026-10-05).
            if (e.code === 'Backquote') cockpit.toggleComm(true);
            return;
        }
        const digitKey = (e.code && e.code.startsWith('Digit')) ? e.code.slice(5)
            : (e.code && e.code.startsWith('Numpad')) ? e.code.slice(6)
            : null;
        // 8 zamyka COMM i idzie dalej do gry (tryb torped).
        if (digitKey === '8' || e.key === '8') cockpit.closeComm();
        if (e.key === '0' || e.key === 'Escape' || e.code === 'Backquote') {
            cockpit.closeComm();
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }

    update(ship, sys, env) {
        this.cockpit?.update?.(ship, sys, env);
    }

    getRadarRange() {
        return this.cockpit?.getRadarRange?.() || 20000;
    }

    /** Odświeża otwarty terminal łączności (lista stacji). */
    refreshOpenMenu() {
        if (this.cockpit?.commOpen) this.cockpit.renderComm();
    }

    toggleMissionJournal(force = null) {
        return this.cockpit?.toggleMissionJournal?.(force) || false;
    }

    logEvent(message, tone = '') {
        this.cockpit?.log?.(message, tone);
    }

    /** Komunikat statku (pushZoneMessage) — linia nad klastrem w kokpicie. */
    pushAlert(message, options = {}) {
        this.cockpit?.pushAlert?.(message, options);
    }

    logZone(label, zoneId = '') {
        this.cockpit?.logZone?.(label, zoneId);
    }

    onMissionUpdated(mission, event = 'updated') {
        this.cockpit?.onMissionUpdated?.(mission, event);
    }
}
