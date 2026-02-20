"use strict";

import createREGL from './regl.js';
import * as vec2 from './vec2.js';

export function generateNoiseTexture(regl, rng, size){
  const l = size * size * 2;
  const array = new Uint8Array(l);
  const randomFunc = rng && typeof rng.random === 'function' ? rng.random.bind(rng) : null;
  for (let i = 0; i < l; i++){
    const r = vec2.random(randomFunc);
    array[i * 2 + 0] = Math.round(0.5 * (1.0 + r[0]) * 255);
    array[i * 2 + 1] = Math.round(0.5 * (1.0 + r[1]) * 255);
  }
  return regl.texture({
    format: 'luminance alpha',
    width: size,
    height: size,
    wrapS: 'repeat',
    wrapT: 'repeat',
    data: array
  });
}

export function createRenderer(regl) {
  let pgWidth = 256;
  let pgTexture = generateNoiseTexture(regl, null, pgWidth);

  return regl({
    vert: `
      precision highp float;
      attribute vec2 position;
      attribute vec2 uv;
      varying vec2 vUV;
      void main() {
        gl_Position = vec4(position, 0, 1);
        vUV = uv;
      }
    `,
    frag: `
      precision highp float;
      uniform sampler2D source, tNoise;
      uniform vec3 colorDeep;
      uniform vec3 colorBright;
      uniform vec2 offset;
      uniform vec2 domainScale;
      uniform vec2 domainPeriod;
      uniform float density, falloff, tNoiseSize, intensity;
      varying vec2 vUV;

      float smootherstep(float a, float b, float r) {
          r = clamp(r, 0.0, 1.0);
          r = r * r * r * (r * (6.0 * r - 15.0) + 10.0);
          return mix(a, b, r);
      }

      float wrapPeriodic(float value, float period) {
          return mod(mod(value, period) + period, period);
      }

      vec2 wrapPeriodic(vec2 value, vec2 period) {
          return vec2(wrapPeriodic(value.x, period.x), wrapPeriodic(value.y, period.y));
      }

      vec2 gradient(vec2 lattice) {
          vec2 sampleUV = (lattice + 0.5) / tNoiseSize;
          vec2 g = texture2D(tNoise, sampleUV).ba;
          return 2.0 * g - 1.0;
      }

      float perlin_2d(vec2 p, vec2 period) {
          vec2 cell = floor(p);
          vec2 local = fract(p);

          vec2 base = wrapPeriodic(cell, period);
          vec2 p0 = base;
          vec2 p1 = vec2(wrapPeriodic(base.x + 1.0, period.x), base.y);
          vec2 p2 = vec2(wrapPeriodic(base.x + 1.0, period.x), wrapPeriodic(base.y + 1.0, period.y));
          vec2 p3 = vec2(base.x, wrapPeriodic(base.y + 1.0, period.y));

          vec2 d0 = gradient(p0);
          vec2 d1 = gradient(p1);
          vec2 d2 = gradient(p2);
          vec2 d3 = gradient(p3);

          vec2 p0p = local;
          vec2 p1p = local - vec2(1.0, 0.0);
          vec2 p2p = local - vec2(1.0, 1.0);
          vec2 p3p = local - vec2(0.0, 1.0);

          float dp0 = dot(d0, p0p);
          float dp1 = dot(d1, p1p);
          float dp2 = dot(d2, p2p);
          float dp3 = dot(d3, p3p);

          float fx = local.x;
          float fy = local.y;
          float m01 = smootherstep(dp0, dp1, fx);
          float m32 = smootherstep(dp3, dp2, fx);
          float m01m32 = smootherstep(m01, m32, fy);
          return m01m32;
      }

      float normalnoise(vec2 p, vec2 period) {
          return perlin_2d(p, period) * 0.5 + 0.5;
      }

      float fbm(vec2 p, vec2 period) {
          float amplitude = 0.6;
          float total = 0.0;
          float sum = 0.0;
          vec2 freq = vec2(1.0);
          vec2 per = period;
          for (int i = 0; i < 5; i++) {
              total += normalnoise(p * freq, per) * amplitude;
              sum += amplitude;
              amplitude *= 0.55;
              freq *= 2.0;
              per *= 2.0;
          }
          return total / sum;
      }

      void main() {
        vec4 p = texture2D(source, vUV);
        vec2 repeat = domainPeriod;
        vec2 domain = vUV * domainScale + offset;
        float base = fbm(domain, repeat);
        float maskBase = clamp(base + density, 0.0, 1.0);
        float highlightBase = clamp(base + density * 0.5, 0.0, 1.0);
        float mask = pow(maskBase, falloff);
        float highlight = pow(highlightBase, max(1.0, falloff * 0.6));
        vec3 tint = mix(colorDeep, colorBright, highlight);
        vec3 finalColor = mix(p.rgb, tint, mask * intensity);
        gl_FragColor = vec4(finalColor, 1);
      }
    `,
    attributes: {
      position: regl.buffer([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]),
      uv: regl.buffer([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])
    },
    uniforms: {
      source: regl.prop('source'),
      offset: regl.prop('offset'),
      domainScale: regl.prop('domainScale'),
      falloff: regl.prop('falloff'),
      colorDeep: regl.prop('colorDeep'),
      colorBright: regl.prop('colorBright'),
      density: regl.prop('density'),
      tNoise: pgTexture,
      tNoiseSize: pgWidth,
      domainPeriod: regl.prop('domainPeriod'),
      intensity: regl.prop('intensity')
    },
    framebuffer: regl.prop('destination'),
    viewport: regl.prop('viewport'),
    count: 6
  });
}
