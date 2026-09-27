// dema/asteroidy-webgpu/tslCommon.js
//
// Wspólne funkcje TSL dema: mapowanie oktaedryczne banku kształtów (lustro
// ROCK_OCT_GLSL z src/3d/rocks/rockShapes3D.js), kwaterniony, ACES gry.

import { Fn, float, vec2, vec3, vec4, abs, max, min, select, normalize, cross, dot, clamp, If } from 'three/tsl';

/** Kierunek → uv mapy oktaedrycznej [0, 1]² (rockOctEncode). */
export const octEncode = Fn(([nIn]) => {
  const n = nIn.div(abs(nIn.x).add(abs(nIn.y)).add(abs(nIn.z))).toVar();
  const p = n.xy.toVar();
  If(n.z.lessThan(0.0), () => {
    const sx = select(p.x.greaterThanEqual(0.0), float(1.0), float(-1.0));
    const sy = select(p.y.greaterThanEqual(0.0), float(1.0), float(-1.0));
    p.assign(vec2(float(1.0).sub(abs(p.y)).mul(sx), float(1.0).sub(abs(p.x)).mul(sy)));
  });
  return p.mul(0.5).add(0.5);
}).setLayout({ name: 'octEncode', type: 'vec2', inputs: [{ name: 'n', type: 'vec3' }] });

/** uv mapy oktaedrycznej → kierunek (rockOctDecode). */
export const octDecode = Fn(([uv]) => {
  const f = uv.mul(2.0).sub(1.0).toVar();
  const nz = float(1.0).sub(abs(f.x)).sub(abs(f.y)).toVar();
  const t = max(nz.negate(), 0.0).toVar();
  const nx = f.x.add(select(f.x.greaterThanEqual(0.0), t.negate(), t));
  const ny = f.y.add(select(f.y.greaterThanEqual(0.0), t.negate(), t));
  return normalize(vec3(nx, ny, nz));
}).setLayout({ name: 'octDecode', type: 'vec3', inputs: [{ name: 'uv', type: 'vec2' }] });

/** Współrzędna tekstury kierunku przy środkach tekseli na krawędziach (rockOctTexUv). */
export const octTexUv = Fn(([dir, size]) => {
  return octEncode(dir).mul(size.sub(1.0)).add(0.5).div(size);
}).setLayout({ name: 'octTexUv', type: 'vec2', inputs: [{ name: 'dir', type: 'vec3' }, { name: 'size', type: 'float' }] });

export const quatRotate = Fn(([q, v]) => {
  const t = cross(q.xyz, v).mul(2.0).toVar();
  return v.add(t.mul(q.w)).add(cross(q.xyz, t));
}).setLayout({ name: 'quatRotate', type: 'vec3', inputs: [{ name: 'q', type: 'vec4' }, { name: 'v', type: 'vec3' }] });

export const quatMul = Fn(([a, b]) => {
  return vec4(b.xyz.mul(a.w).add(a.xyz.mul(b.w)).add(cross(a.xyz, b.xyz)), a.w.mul(b.w).sub(dot(a.xyz, b.xyz)));
}).setLayout({ name: 'quatMul', type: 'vec4', inputs: [{ name: 'a', type: 'vec4' }, { name: 'b', type: 'vec4' }] });

/**
 * Tone mapping gry (uberPass w src/3d/core3d.js): dopasowanie ACES
 * Narkowicza bez przeskalowania wejścia — three ma inną krzywą (÷0,6).
 */
export const acesGame = Fn(([c]) => {
  const x = max(c, vec3(0.0));
  return clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0.0, 1.0);
}).setLayout({ name: 'acesGame', type: 'vec3', inputs: [{ name: 'c', type: 'vec3' }] });

export const saturate01 = (x) => clamp(x, 0.0, 1.0);
export const minf = min;
