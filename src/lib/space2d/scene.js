"use strict";

import createREGL from './regl.js';
import * as pointStars from './point-stars.js';
import * as star from './star.js';
import * as nebula from './nebula.js';
import * as copy from './copy.js';
import * as random from './random.js';

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function mixColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

function hslToRgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  s = clamp01(s);
  l = clamp01(l);
  if (s === 0) {
    return [l, l, l];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const toRGB = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [toRGB(h + 1 / 3), toRGB(h), toRGB(h - 1 / 3)];
}

function createNebulaPalette(rand) {
  const hue = rand.random();
  const hueShift = 0.05 + rand.random() * 0.12;
  const satBase = 0.45 + rand.random() * 0.2;
  const satBright = clamp01(satBase + 0.15 + rand.random() * 0.2);
  const deep = hslToRgb(hue, satBase * 0.55, 0.08 + rand.random() * 0.08);
  const mid = hslToRgb(hue + hueShift * 0.5, satBase * 0.75, 0.22 + rand.random() * 0.14);
  const bright = hslToRgb(hue + hueShift, satBright, 0.58 + rand.random() * 0.25);
  const deepTint = mixColor(deep, mid, 0.5 + rand.random() * 0.3);
  return {
    deep: deepTint.map(clamp01),
    bright: bright.map(clamp01)
  };
}

export default class Scene {

  constructor(canvas) {
    this.canvas = canvas;
    let regl = this.regl = createREGL({ canvas: this.canvas });
    this.pointStarTexture = regl.texture();
    this.ping = regl.framebuffer({color: regl.texture(), depth: false, stencil: false, depthStencil: false});
    this.pong = regl.framebuffer({color: regl.texture(), depth: false, stencil: false, depthStencil: false});
    this.starRenderer = star.createRenderer(regl);
    this.nebulaRenderer = nebula.createRenderer(regl);
    this.copyRenderer = copy.createRenderer(regl);
    this.lastWidth = null;
    this.lastHeight = null;
    this.maxTextureSize = regl.limits.maxTextureSize;
  }

  render(props) {
    let ping = this.ping;
    let pong = this.pong;
    let regl = this.regl;

    let width = this.canvas.width;
    let height = this.canvas.height;
    let viewport = { x: 0, y: 0, width: width, height: height };
    let scale = props.shortScale ? Math.min(width, height) : Math.max(width, height);
    if (width !== this.lastWidth || height !== this.lastHeight) {
      ping.resize(width, height);
      pong.resize(width, height);
      this.lastWidth = width;
      this.lastHeight = height;
    }

    regl({ framebuffer: ping })( () => {
      regl.clear({color: [0,0,0,1]});
    });
    regl({ framebuffer: pong })( () => {
      regl.clear({color: [0,0,0,1]});
    });

    let rand = random.rand(props.seed, 0);
    if (props.renderPointStars) {
      let data = pointStars.generateTexture(width, height, 0.05, 0.125, rand.random.bind(rand));
      this.pointStarTexture({
        format: 'rgb',
        width: width,
        height: height,
        wrapS: 'repeat',
        wrapT: 'repeat',
        data: data
      });
      this.copyRenderer({
        source: this.pointStarTexture,
        destination: ping,
        viewport: viewport
      });
    }

    rand = random.rand(props.seed, 1000);
    let nebulaCount = 0;
    if (props.renderNebulae) nebulaCount = Math.round(rand.random() * 4 + 1);
    const nebulaPeriodOptions = [3, 4, 5, 6, 8, 10, 12, 14];
    let nebulaOut = pingPong(ping, ping, pong, nebulaCount, (source, destination) => {
      const basePeriod = nebulaPeriodOptions[Math.floor(rand.random() * nebulaPeriodOptions.length)];
      const aspectMin = Math.max(1, Math.min(width, height));
      const aspectScaleX = width / aspectMin;
      const aspectScaleY = height / aspectMin;
      const periodJitter = 0.8 + rand.random() * 0.4;
      const periodX = basePeriod;
      const periodY = Math.max(3, Math.round(basePeriod * periodJitter));
      const repeatBase = 1.4 + rand.random() * 1.8;
      const repeatX = Math.max(1, Math.round(repeatBase * aspectScaleX));
      const repeatY = Math.max(1, Math.round(repeatBase * aspectScaleY));
      const domainPeriod = [periodX, periodY];
      const domainScale = [periodX * repeatX, periodY * repeatY];
      const palette = createNebulaPalette(rand);
      const density = rand.random() * 0.35 - 0.25;
      const falloff = rand.random() * 2.5 + 2.8;
      const intensity = 0.3 + rand.random() * 0.45;
      this.nebulaRenderer({
        source: source,
        destination: destination,
        offset: [rand.random() * periodX, rand.random() * periodY],
        colorDeep: palette.deep,
        colorBright: palette.bright,
        density,
        falloff,
        intensity,
        domainScale,
        domainPeriod,
        viewport: viewport
      });
    });

    rand = random.rand(props.seed, 2000);
    let starCount = 0;
    if (props.renderStars) starCount = Math.round(rand.random() * 8 + 1);
    let starOut = pingPong(nebulaOut, ping, pong, starCount, (source, destination) => {
      this.starRenderer({
        center: [rand.random(), rand.random()],
        coreRadius: rand.random() * 0.0,
        coreColor: [1,1,1],
        haloColor: [rand.random(), rand.random(), rand.random()],
        haloFalloff: rand.random() * 1024 + 32,
        resolution: [width, height],
        scale: scale,
        source: source,
        destination: destination,
        viewport: viewport
      });
    });

    rand = random.rand(props.seed, 3000);
    let sunOut = false;
    if (props.renderSun) {
      sunOut = starOut === pong ? ping : pong;
      this.starRenderer({
        center: [rand.random(), rand.random()],
        coreRadius: rand.random() * 0.025 + 0.025,
        coreColor: [1,1,1],
        haloColor: [rand.random(), rand.random(), rand.random()],
        haloFalloff: rand.random() * 32 + 32,
        resolution: [width, height],
        scale: scale,
        source: starOut,
        destination: sunOut,
        viewport: viewport
      })
    }

    this.copyRenderer({
      source: sunOut ? sunOut : starOut,
      destination: undefined,
      viewport: viewport
    });

  }

}

function pingPong(initial, alpha, beta, count, func) {
  // Bail if the render count is zero.
  if (count === 0) return initial;
  // Make sure the initial FBO is not the same as the first
  // output FBO.
  if (initial === alpha) {
    alpha = beta;
    beta = initial;
  }
  // Render to alpha using initial as the source.
  func(initial, alpha);
  // Keep track of how many times we've rendered. Currently one.
  let i = 1;
  // If there's only one render, we're already done.
  if (i === count) return alpha;
  // Keep going until we reach our render count.
  while (true) {
    // Render to beta using alpha as the source.
    func(alpha, beta);
    // If we've hit our count, we're done.
    i++;
    if (i === count) return beta;
    // Render to alpha using beta as the source.
    func(beta, alpha);
    // If we've hit our count, we're done.
    i++;
    if (i === count) return alpha;
  }
}
