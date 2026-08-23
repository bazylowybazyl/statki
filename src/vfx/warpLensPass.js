// Warp lens: soczewka grawitacyjna rysowana pod warstwa 3D podczas skoku.
// Zrodlem obrazu jest albo canvas tla, albo pelna klatka 2D — stad tryb
// 'background' / 'full' i przelaczanie zrodla przy resize.
//
// Stan gry (ctx, canvas, camera, ship, warp) czytamy z GameState w momencie
// wywolania — modul startuje zanim te obiekty powstana.
import { WarpBlackHole } from './warpBlackHole.js';
import { GameState } from '../game/gameState.js';
import { resolveWorldUnitsPerAu } from '../config/units.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep01 = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

const warpBlackHoleFX = new WarpBlackHole({ zIndex: 45, mode: 'offscreen' });
warpBlackHoleFX.setEnabled(false);
let warpLensMode = 'background';
let warpLensSource = null;

const WARP_LENS_DEFAULTS = Object.freeze({
  threshold: 0,
  radiusBase: 0.6,
  radiusScale: 0.3,
  massBase: 0,
  massScale: 0.035,
  softness: 0.6,
  opacityBase: 0.55,
  opacityScale: 0.73,
  tailDepthExtra: -0.2,
  forwardStretch: 1.0
});

const DevVFX = window.DevVFX = window.DevVFX || {};
DevVFX.warpLens = Object.assign({}, WARP_LENS_DEFAULTS, DevVFX.warpLens || {});
window.__WARP_LENS_DEFAULTS = WARP_LENS_DEFAULTS;

function warpLensParam(key) {
  const defaults = WARP_LENS_DEFAULTS;
  const bag = DevVFX?.warpLens || defaults;
  const raw = bag[key];
  return Number.isFinite(raw) ? raw : defaults[key];
}

function getAuToWorldUnits() {
  return resolveWorldUnitsPerAu(window);
}

function getWarpLensThreshold() {
  const v = warpLensParam('threshold');
  if (!Number.isFinite(v)) return WARP_LENS_DEFAULTS.threshold;
  return Math.min(1, Math.max(0, v));
}

export function configureWarpLensSource() {
  if (!warpBlackHoleFX) return;
  const { ctx } = GameState;
  if (!ctx) return;
  if (typeof warpBlackHoleFX.setSourceParallaxTransform === 'function') {
    warpBlackHoleFX.setSourceParallaxTransform(null);
  }
  if (warpLensMode === 'background') {
    const src = ctx?.canvas || null;
    if (src && warpLensSource !== src) {
      warpLensSource = src;
      warpBlackHoleFX.setSourceCanvas(src);
    }
  } else if (warpLensMode === 'full') {
    if (warpLensSource !== ctx.canvas) {
      warpLensSource = ctx.canvas;
      warpBlackHoleFX.setSourceCanvas(ctx.canvas);
    }
  }
}

if (warpBlackHoleFX) {
  window.setWarpLensMode = function (mode) {
    const next = mode === 'full' ? 'full' : 'background';
    if (warpLensMode !== next) {
      warpLensMode = next;
      warpLensSource = null;
      configureWarpLensSource();
    }
  };
  window.addEventListener('resize', configureWarpLensSource);
}

export function renderWarpLensPass(cam, interpPos, interpAngle) {
  if (!warpBlackHoleFX) return;
  const { ctx, canvas, camera, ship, warp, zoneState } = GameState;
  if (!ctx || !canvas || !camera || !ship || !warp) return;
  const isWarpActive = (warp.state === 'active');
  const entryProgress = isWarpActive ? clamp(warp.entryProgress, 0, 1) : 0;
  const warpIntensity = isWarpActive ? smoothstep01(entryProgress) : 0;

  const lensThreshold = getWarpLensThreshold();
  const desiredLensMode = (warpIntensity >= lensThreshold) ? 'full' : 'background';
  if (desiredLensMode !== warpLensMode) {
    warpLensMode = desiredLensMode;
    warpLensSource = null;
  }
  if (!warpLensSource) {
    configureWarpLensSource();
  }

  const zoneAllowsWarpLens = zoneState?.current?.wormholeVfx ?? false;
  const shouldRenderWarpLens = isWarpActive && warpIntensity > 0.001 && zoneAllowsWarpLens;
  warpBlackHoleFX.setEnabled(shouldRenderWarpLens && !!warpLensSource);

  if (!(shouldRenderWarpLens && warpLensSource)) return;

  const engineTail = ship.visual?.mainEngine?.y ?? (ship.h * 0.5);
  const tailDepthExtra = warpLensParam('tailDepthExtra');
  const warpDepth = engineTail + ship.h * tailDepthExtra;

  const tailOffset = rotate({ x: 0, y: warpDepth }, interpAngle);
  const tailWorld = {
    x: interpPos.x + tailOffset.x,
    y: interpPos.y + tailOffset.y
  };
  const s = worldToScreen(tailWorld.x, tailWorld.y, cam);

  const radiusBase = warpLensParam('radiusBase');
  const radiusScale = warpLensParam('radiusScale');
  const massBase = warpLensParam('massBase');
  const massScale = warpLensParam('massScale');
  const softness = Math.min(1, Math.max(0, warpLensParam('softness')));
  const opacityBase = warpLensParam('opacityBase');
  const opacityScale = warpLensParam('opacityScale');

  const baseRadius = Math.max(0.01, radiusBase + radiusScale * warpIntensity);
  const referenceZoom = Math.max(0.0001, camera.defaultZoom || 1);
  const zoomFactor = camera.zoom / referenceZoom;
  const radius = Math.min(1, baseRadius * zoomFactor);

  const baseMass = Math.max(0, (massBase + massScale * warpIntensity) * warpIntensity);
  const mass = Math.min(0.6, baseMass * zoomFactor * zoomFactor);
  const opacity = Math.min(1, Math.max(0, (opacityBase + opacityScale * warpIntensity) * warpIntensity));

  const forwardStretchParam = warpLensParam('forwardStretch');
  const forwardStretchMajor = forwardStretchParam >= 1
    ? forwardStretchParam
    : 1 + (1 - forwardStretchParam);

  const lensStretchFactor = 1 + (forwardStretchMajor - 1) * warpIntensity;
  const lensAngle = ship.angle || 0;

  warpBlackHoleFX.render({
    centerX: s.x,
    centerY: s.y,
    mass,
    radius,
    softness,
    rotation: lensAngle,
    opacity,
    lensStretchForward: lensStretchFactor
  });

  let updated = false;
  if (typeof warpBlackHoleFX.updateOutputBuffer === 'function') {
    updated = warpBlackHoleFX.updateOutputBuffer();
  }

  const warpLensOutputCanvas = (typeof warpBlackHoleFX.getOutputCanvas === 'function')
    ? warpBlackHoleFX.getOutputCanvas()
    : null;

  if (updated && warpLensOutputCanvas && warpLensOutputCanvas.width && warpLensOutputCanvas.height) {
    const shipS = worldToScreen(interpPos.x, interpPos.y, cam);
    const shipSpriteScale = ship.visual?.spriteScale || 1;
    const shipVisualW = Math.max(24, (Number(ship.w) || (Number(ship.radius) || 20) * 2) * shipSpriteScale);
    const shipVisualH = Math.max(24, (Number(ship.h) || (Number(ship.radius) || 20) * 2) * shipSpriteScale);
    const shipMaskScale = 0.58;
    const shipMaskPad = 1.08;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(shipS.x, shipS.y);
    ctx.rotate(interpAngle || 0);
    ctx.ellipse(
      0,
      0,
      shipVisualW * cam.zoom * shipMaskScale * shipMaskPad,
      shipVisualH * cam.zoom * shipMaskScale * shipMaskPad,
      0,
      0,
      Math.PI * 2
    );
    ctx.restore();
    ctx.clip('evenodd');
    ctx.drawImage(
      warpLensOutputCanvas,
      0, 0, warpLensOutputCanvas.width, warpLensOutputCanvas.height,
      0, 0, canvas.width, canvas.height
    );
    ctx.restore();
  }
}

/** Ustawia zrodlo obrazu po starcie gry (nasluch resize podpina blok wyzej). */
export function initWarpLens() {
  configureWarpLensSource();
}
