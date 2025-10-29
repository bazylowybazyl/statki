"use strict";

import Scene from './scene.js';
import * as random from './random.js';

let bg = null;
let off = null;
let ctx2d = null;
let opts = {
  renderPointStars: true,
  renderStars: true,
  renderNebulae: true,
  renderSun: false,
  shortScale: true,
  seed: 'statki'
};

export function initSpaceBg(seedStr = null){
  if (!off) {
    off = document.createElement('canvas');
    off.width = innerWidth;
    off.height = innerHeight;
    ctx2d = off.getContext('2d');
  }
  if (!bg) bg = new Scene(off);
  opts.seed = String(seedStr ?? (window.SUN?.seed ?? random.generateRandomSeed()));
  return true;
}

export function resizeSpaceBg(w, h){
  if (!off) return;
  off.width = Math.max(1, w | 0);
  off.height = Math.max(1, h | 0);
}

export function drawSpaceBg(mainCtx){
  if (!bg || !off) return;
  bg.render(opts);
  mainCtx.drawImage(
    off,
    0,
    0,
    off.width,
    off.height,
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
