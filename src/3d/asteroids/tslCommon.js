// src/3d/asteroids/tslCommon.js
//
// Wspólne funkcje TSL pola asteroid (port z dema dema/asteroidy-webgpu/tslCommon.js,
// zadanie 21): mapowanie oktaedryczne banku kształtów (lustro dawnego
// ROCK_OCT_GLSL) i kwaterniony. Funkcje z `setLayout` są CZYSTE — bez uniformów
// w domknięciu (błąd r183, docs/webgpu/PLAN.md §3). ACES dema nie wchodzi: post
// gry (src/3d/tsl/postGry.js) robi swój.

import { Fn, float, vec2, vec3, vec4, abs, max, select, normalize, cross, dot, If } from 'three/tsl';

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
}).setLayout({ name: 'beltOctEncode', type: 'vec2', inputs: [{ name: 'n', type: 'vec3' }] });

/** uv mapy oktaedrycznej → kierunek (rockOctDecode). */
export const octDecode = Fn(([uv]) => {
  const f = uv.mul(2.0).sub(1.0).toVar();
  const nz = float(1.0).sub(abs(f.x)).sub(abs(f.y)).toVar();
  const t = max(nz.negate(), 0.0).toVar();
  const nx = f.x.add(select(f.x.greaterThanEqual(0.0), t.negate(), t));
  const ny = f.y.add(select(f.y.greaterThanEqual(0.0), t.negate(), t));
  return normalize(vec3(nx, ny, nz));
}).setLayout({ name: 'beltOctDecode', type: 'vec3', inputs: [{ name: 'uv', type: 'vec2' }] });

/** Współrzędna tekstury kierunku przy środkach tekseli na krawędziach (rockOctTexUv). */
export const octTexUv = Fn(([dir, size]) => {
  return octEncode(dir).mul(size.sub(1.0)).add(0.5).div(size);
}).setLayout({ name: 'beltOctTexUv', type: 'vec2', inputs: [{ name: 'dir', type: 'vec3' }, { name: 'size', type: 'float' }] });

export const quatRotate = Fn(([q, v]) => {
  const t = cross(q.xyz, v).mul(2.0).toVar();
  return v.add(t.mul(q.w)).add(cross(q.xyz, t));
}).setLayout({ name: 'beltQuatRotate', type: 'vec3', inputs: [{ name: 'q', type: 'vec4' }, { name: 'v', type: 'vec3' }] });

export const quatMul = Fn(([a, b]) => {
  return vec4(b.xyz.mul(a.w).add(a.xyz.mul(b.w)).add(cross(a.xyz, b.xyz)), a.w.mul(b.w).sub(dot(a.xyz, b.xyz)));
}).setLayout({ name: 'beltQuatMul', type: 'vec4', inputs: [{ name: 'a', type: 'vec4' }, { name: 'b', type: 'vec4' }] });

// Zakres wysyłki bufora NA STAŁE (jak liveAttribute w fxParticles3D.js, LightGrid w
// src/3d/fx/lightGrid.js): three czyści listę zakresów po każdej wysyłce, a ponowne
// addUpdateRange alokowało obiekt i tablicę na klatkę. Tu jeden zakres na bufor —
// klatka zmienia tylko jego `count`.
function keepUpdateRanges() {}

/** Bufor / atrybut z jednym stałym zakresem wysyłki; zwraca obiekt zakresu. */
export function permanentUpdateRange(bufferOrAttr) {
  const range = { start: 0, count: bufferOrAttr.array.length };
  bufferOrAttr.updateRanges.length = 0;
  bufferOrAttr.updateRanges.push(range);
  bufferOrAttr.clearUpdateRanges = keepUpdateRanges;
  return range;
}

/** Oznacza pierwsze `count` elementów (liczb) bufora do wysłania. */
export function markLiveRange(bufferOrAttr, range, count) {
  if (!(count > 0)) return;
  range.count = Math.min(count, bufferOrAttr.array.length);
  bufferOrAttr.needsUpdate = true;
}
