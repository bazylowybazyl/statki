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
}

export function drawSpaceBg(mainCtx){
  if (!bg || !offGL) return;
  bg.render(opts);
  mainCtx.drawImage(
    offGL,
    0,
    0,
    offGL.width,
    offGL.height,
    0,
    0,
    mainCtx.canvas.width,
    mainCtx.canvas.height
  );
}

export function setBgOptions(partial){
  Object.assign(opts, partial || {});
}

export function setBgSeed(seed){
  opts.seed = String(seed);
}

export function getBackgroundCanvas(){
  return offGL;
}
