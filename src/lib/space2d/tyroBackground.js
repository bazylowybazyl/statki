"use strict";

import Scene from './scene.js';
import * as random from './random.js';

let bg = null;
let offGL = null;
let opts = {
  renderPointStars: true,
  renderStars: true,
  renderNebulae: true,
  renderSun: false,
  shortScale: true,
  seed: 'statki'
};

const parallaxState = {
  enabled: true,
  factorX: 0.045,
  factorY: 0.03,
  smoothing: 0.2,
  offsetX: 0,
  offsetY: 0,
  targetX: 0,
  targetY: 0
};

export function initSpaceBg(seedStr = null){
  if (!offGL) {
    offGL = document.createElement('canvas');
    offGL.width = innerWidth;
    offGL.height = innerHeight;
  }
  if (!bg) bg = new Scene(offGL);
  opts.seed = String(seedStr ?? (window.SUN?.seed ?? random.generateRandomSeed()));
  return true;
}

export function resizeSpaceBg(w, h){
  if (!offGL) return;
  offGL.width = Math.max(1, w | 0);
  offGL.height = Math.max(1, h | 0);
  parallaxState.offsetX = 0;
  parallaxState.offsetY = 0;
  parallaxState.targetX = 0;
  parallaxState.targetY = 0;
}

export function drawSpaceBg(mainCtx, camera){
  if (!bg || !offGL) return;
  bg.render(opts);
  const width = mainCtx.canvas.width;
  const height = mainCtx.canvas.height;
  const tileW = offGL.width;
  const tileH = offGL.height;

  let offsetX = 0;
  let offsetY = 0;
  if (parallaxState.enabled && camera) {
    const smooth = Math.max(0, Math.min(1, parallaxState.smoothing));
    parallaxState.targetX = -(camera.x || 0) * parallaxState.factorX;
    parallaxState.targetY = -(camera.y || 0) * parallaxState.factorY;
    if (smooth === 0) {
      parallaxState.offsetX = parallaxState.targetX;
      parallaxState.offsetY = parallaxState.targetY;
    } else {
      parallaxState.offsetX += (parallaxState.targetX - parallaxState.offsetX) * smooth;
      parallaxState.offsetY += (parallaxState.targetY - parallaxState.offsetY) * smooth;
    }
    offsetX = parallaxState.offsetX;
    offsetY = parallaxState.offsetY;
  }

  if (tileW <= 0 || tileH <= 0) return;

  const normalizedOffsetX = wrapOffset(offsetX, tileW);
  const normalizedOffsetY = wrapOffset(offsetY, tileH);

  for (let drawX = -normalizedOffsetX; drawX < width; drawX += tileW) {
    for (let drawY = -normalizedOffsetY; drawY < height; drawY += tileH) {
      mainCtx.drawImage(offGL, drawX, drawY, tileW, tileH);
    }
  }
}

export function setBgOptions(partial){
  Object.assign(opts, partial || {});
}

export function setBgSeed(seed){
  opts.seed = String(seed);
}

export function setParallaxOptions(partial){
  if (!partial) return;
  if (typeof partial.enabled === 'boolean') {
    parallaxState.enabled = partial.enabled;
  }
  if (typeof partial.smoothing === 'number' && Number.isFinite(partial.smoothing)) {
    parallaxState.smoothing = Math.max(0, Math.min(1, partial.smoothing));
  }
  if (partial.factor !== undefined) {
    if (typeof partial.factor === 'number' && Number.isFinite(partial.factor)) {
      parallaxState.factorX = partial.factor;
      parallaxState.factorY = partial.factor;
    } else if (partial.factor && typeof partial.factor === 'object') {
      if (typeof partial.factor.x === 'number' && Number.isFinite(partial.factor.x)) {
        parallaxState.factorX = partial.factor.x;
      }
      if (typeof partial.factor.y === 'number' && Number.isFinite(partial.factor.y)) {
        parallaxState.factorY = partial.factor.y;
      }
    }
  }
}

export function getBackgroundCanvas(){
  return offGL;
}

function wrapOffset(value, dimension){
  const remainder = value % dimension;
  if (remainder === 0) return 0;
  if (remainder < 0) return remainder + dimension;
  return remainder;
}
