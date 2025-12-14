// src/game/shipEntity.js
// Ten plik odpowiada za tworzenie statku gracza i obsługę wejścia (sterowania).

export function createShipEntity({ world, overlayView, overrides }) {
    const defaultPos = { x: world ? world.w / 2 : 0, y: world ? world.h / 2 : 0 };

    const ship = {
        // Fizyka
        pos: overrides.pos ? { ...overrides.pos } : defaultPos,
        vel: overrides.vel ? { ...overrides.vel } : { x: 0, y: 0 },
        angle: overrides.angle || -Math.PI / 2,
        angVel: overrides.angVel || 0,
        mass: overrides.mass || 10,
        inertia: 1200,
        linearDamping: 0.8,
        angularDamping: 2.5,

        // Wymiary
        w: 60,
        h: 120,
        radius: 45,

        // Status
        hull: { val: 2000, max: 2000 },
        // Tarcza - inicjalizacja (szczegóły nadpisze shieldSystem, ale struktura musi być)
        shield: {
            val: 1000, max: 1000,
            regenRate: 60, regenDelay: 3.0, regenTimer: 0,
            state: 'active', activationProgress: 1, currentAlpha: 0,
            impacts: []
        },

        // Systemy
        inventory: new Set(),
        hardpoints: [], // Wypełniane przez logikę w index.html
        weapons: {},

        // Wieżyczki (Główne działa)
        turret:  { angle: 0, angVel: 0, offset: {x: 0, y: -20}, recoil: 0, recoilRecover: 80, maxSpeed: 6, maxAccel: 30, damping: 8 },
        turret2: { angle: 0, angVel: 0, offset: {x: 0, y: 20},  recoil: 0, recoilRecover: 80, maxSpeed: 6, maxAccel: 30, damping: 8 },
        turret3: { angle: 0, angVel: 0, offset: {x: -15, y: 0}, recoil: 0, recoilRecover: 80, maxSpeed: 6, maxAccel: 30, damping: 8 },
        turret4: { angle: 0, angVel: 0, offset: {x: 15, y: 0},  recoil: 0, recoilRecover: 80, maxSpeed: 6, maxAccel: 30, damping: 8 },

        // Obrona punktowa (CIWS)
        ciws: [],

        // Konfiguracja silników (fizyka + wizualia)
        engines: {
            main:       { maxThrust: 1400, offset: {x: 0, y: 55}, visualOffset: {x: 0, y: 65} },
            sideLeft:   { maxThrust: 700,  offset: {x: -35, y: 10} },
            sideRight:  { maxThrust: 700,  offset: {x: 35, y: 10} },
            torqueLeft: { maxThrust: 500,  offset: {x: -35, y: -40} },
            torqueRight:{ maxThrust: 500,  offset: {x: 35, y: -40} }
        },

        // Wizualne kontenery
        pods: [
            { w: 16, h: 32, offset: {x: -42, y: 20} },
            { w: 16, h: 32, offset: {x: 42, y: 20} }
        ],
        sideGunsLeft:  [{x: -28, y: -10}, {x: -28, y: 10}],
        sideGunsRight: [{x: 28, y: -10}, {x: 28, y: 10}],
        visual: {
            spriteScale: 1.0,
            torqueThrusters: []
        },

        // Specjalne
        special: { cooldownTimer: 0 },
        controller: overrides.controller || 'player',

        // Nadpisania z argumentów
        ...overrides
    };

    // Inicjalizacja slotów CIWS
    for (let i = 0; i < 6; i++) {
        ship.ciws.push({
            angle: 0, angVel: 0, cd: 0,
            offset: { x: (i % 2 === 0 ? -20 : 20), y: -40 + i * 15 }
        });
    }

    return ship;
}

export function applyPlayerInput(ship, cmds, inputState) {
    // Funkcja mapująca polecenia (z klawiatury/pada/AI) na stan wejścia fizyki
    if (!inputState) return;

    inputState.main = cmds.main || 0;
    inputState.leftSide = cmds.leftSide || 0;
    inputState.rightSide = cmds.rightSide || 0;
    inputState.torque = cmds.torque || 0;
    
    // Wartości wektorowe (dla AI lub pada analogowego)
    inputState.thrustX = cmds.thrustX || 0;
    inputState.thrustY = cmds.thrustY || 0;
}

export function runShipAI(ship, dt) {
    // Prosty autopilot (stub), jeśli gracz przełączy kontroler na AI
    return {
        main: 0,
        torque: 0,
        leftSide: 0,
        rightSide: 0,
        thrustX: 0,
        thrustY: 0
    };
}
