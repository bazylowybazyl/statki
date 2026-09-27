// Engineeffects.js
// Tekstury poświaty dysz bocznych (SIDE): anamorficzna flara, heat glow, heat ring.
// Czyta je src/3d/engineExhaustBatch.js (warstwy poświaty na instancjach).
//
// Port WebGPU (zadanie 13): dawny płomień z własnym shaderem
// (createShortNeedleExhaust / createWarpExhaustBlue) i menedżer getEngineVFX
// z WŁASNYM WebGLRenderer były martwe (gra brała z pliku tylko tekstury) —
// usunięte. Płomień SIDE żyje w engineExhaustBatch.js (TSL).

import * as THREE from "three";

// --- TEKSTURY POMOCNICZE ---

export function makeFlareTexture() {
    // Anamorficzna flara - ostra pozioma linia
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 32;
    const ctx = canvas.getContext('2d');

    // Gradient poziomy (zanika na końcach)
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0.0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.2, 'rgba(100, 200, 255, 0.1)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.8, 'rgba(100, 200, 255, 0.1)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    // Wysokość tylko 2px dla ostrości
    ctx.ellipse(128, 16, 128, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hotspot w centrum
    const coreGrad = ctx.createRadialGradient(128, 16, 0, 128, 16, 16);
    coreGrad.addColorStop(0, 'rgba(255,255,255,0.8)');
    coreGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(128, 16, 8, 0, Math.PI * 2);
    ctx.fill();

    return new THREE.CanvasTexture(canvas);
}

export function makeGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.2, 'rgba(255, 120, 50, 0.8)');
    grad.addColorStop(0.5, 'rgba(255, 60, 0, 0.3)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
}

export function makeRingTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 200, 100, 1)';
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(255, 50, 0, 1)';
    ctx.beginPath();
    ctx.arc(32, 32, 20, 0, Math.PI * 2);
    ctx.stroke();
    return new THREE.CanvasTexture(canvas);
}
