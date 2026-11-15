// dema/silniki-marki/post.js
//
// Post dema marek silników: pass sceny (MSAA 4, HalfFloat) → REFRAKCJA → bloom gry → ACES gry → sRGB.
// Refrakcja liczona analitycznie ze źródeł w uniformach, w PIKSELACH ekranu (źródła rzutuje CPU kamerą —
// działa też w kamerze pochylonej):
//   • 0 gorące powietrze dyszy: stożek za wylotem, wzór płynie od dyszy (faza całkowana na CPU), szczyt ~1,5 promienia
//     za wargą (rufa kadłuba nie faluje), gaśnie wykładniczo wzdłuż stożka;
//   • 1 fala skoku warpa: pierścień samej refrakcji (profil pochodnej gaussa), bez świecącego obrysu.
// Dyspersja barw tylko dla fali (jak w grze).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, uniformArray, screenUV, Loop, If,
  exp, max, min, abs, length, dot, smoothstep, clamp, mx_noise_float
} from 'three/tsl';

export const ZRODLA_CAP = 32;

/** Tone mapping gry: dopasowanie ACES Narkowicza bez przeskalowania wejścia (jak uberPass Core3D). */
const acesGame = (c) => {
  const x = max(c, vec3(0.0));
  return clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0.0, 1.0);
};

export class PostSilnikow {
  constructor() {
    const v4 = (n, nazwa) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4').setName(nazwa);
    this.U = {
      count: uniform(0, 'int'),
      A: v4(ZRODLA_CAP, 'silnikiZrA'), // px x, y; kierunek x, y (ekran, y w dół)
      B: v4(ZRODLA_CAP, 'silnikiZrB'), // promień [px], długość [px], siła [px], typ
      C: v4(ZRODLA_CAP, 'silnikiZrC'), // faza, rozwarcie, dyspersja, —
      size: uniform(new THREE.Vector2(1920, 1080)),
      on: uniform(1),
      exposure: uniform(1)
    };
    this.n = 0;
    this.bloomNode = null;
  }

  begin() {
    this.n = 0;
  }

  /** Gorące powietrze dyszy: (x, y) wargi i kierunek wydechu w px ekranu, promień wylotu i długość stożka w px. */
  cone(x, y, dx, dy, radiusPx, lengthPx, strengthPx, phase, spread = 0.16) {
    if (this.n >= ZRODLA_CAP || !(strengthPx > 0.03) || !(radiusPx > 0.5)) return;
    const i = this.n++;
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    this.U.A.array[i].set(x, y, dx / l, dy / l);
    this.U.B.array[i].set(radiusPx, Math.max(lengthPx, radiusPx * 2), strengthPx, 0);
    this.U.C.array[i].set(phase, spread, 0, 0);
  }

  /** Fala skoku: pierścień refrakcji o promieniu i szerokości w px. */
  ring(x, y, radiusPx, widthPx, strengthPx, dispersion = 1) {
    if (this.n >= ZRODLA_CAP || !(strengthPx > 0.03)) return;
    const i = this.n++;
    this.U.A.array[i].set(x, y, 1, 0);
    this.U.B.array[i].set(radiusPx, Math.max(widthPx, 1), strengthPx, 1);
    this.U.C.array[i].set(0, 0, dispersion, 0);
  }

  commit(W, H) {
    this.U.size.value.set(W, H);
    this.U.count.value = this.n;
  }

  /** Przesunięcie UV (xy) i jego część z dyspersją (zw) dla piksela uvIn. */
  offsetNode(uvIn) {
    const U = this.U;
    return Fn(() => {
      const px = uvIn.mul(U.size).toVar();
      const offPx = vec2(0.0).toVar();
      const dispPx = vec2(0.0).toVar();
      Loop(U.count, ({ i }) => {
        const A = U.A.element(i).toVar();
        const B = U.B.element(i).toVar();
        const C = U.C.element(i).toVar();
        const d = px.sub(A.xy).toVar();
        If(B.w.lessThan(0.5), () => {
          const dir = A.zw;
          const nrm = vec2(dir.y.negate(), dir.x);
          const along = dot(d, dir).toVar();
          const perp = dot(d, nrm).toVar();
          const r0 = max(B.x, 1.0).toVar();
          const hw = r0.mul(1.25).add(max(along, 0.0).mul(C.y)).toVar();
          If(along.greaterThan(0.0).and(along.lessThan(B.y.mul(1.6))).and(abs(perp).lessThan(hw)), () => {
            const mask = smoothstep(0.2, 1.8, along.div(r0)).mul(exp(along.div(B.y).mul(-2.2))).mul(float(1.0).sub(smoothstep(0.35, 1.0, abs(perp).div(hw))));
            const a = along.div(r0);
            const b = perp.div(r0);
            const n1 = mx_noise_float(vec3(a.mul(0.55).sub(C.x), b.mul(1.3), C.x.mul(0.3)));
            const n2 = mx_noise_float(vec3(a.mul(0.5).sub(C.x.mul(1.1)).add(7.3), b.mul(1.2).add(3.1), C.x.mul(0.25)));
            offPx.addAssign(nrm.mul(n1).add(dir.mul(n2.mul(0.5))).mul(B.z.mul(mask)));
          });
        }).Else(() => {
          const r = max(length(d), 1e-3).toVar();
          const x = r.sub(B.x).div(max(B.y, 1.0));
          const prof = x.mul(exp(x.mul(x).negate())).mul(2.33);
          const o = d.div(r).mul(prof.mul(B.z)).toVar();
          offPx.addAssign(o);
          dispPx.addAssign(o.mul(C.z));
        });
      });
      const inv = vec2(1.0).div(U.size);
      return vec4(offPx.mul(inv), dispPx.mul(inv)).mul(U.on);
    })();
  }

  /** Węzeł wyjścia: scena z przesunięciem → bloom → ACES gry. bloomFactory(hdr) → BloomNode. */
  buildOutput(sceneTex, bloomFactory) {
    const U = this.U;
    const off = this.offsetNode(screenUV);
    const hdr = Fn(() => {
      const o = off.toVar();
      const main = o.xy.sub(o.zw);
      const r = sceneTex.sample(screenUV.add(main).add(o.zw.mul(0.82))).r;
      const g = sceneTex.sample(screenUV.add(main).add(o.zw)).g;
      const b = sceneTex.sample(screenUV.add(main).add(o.zw.mul(1.22))).b;
      // Siatka bezpieczeństwa: pojedynczy NaN / Inf nie może zalać ekranu przez bloom.
      return max(min(vec3(r, g, b).mul(U.exposure), vec3(60000.0)), vec3(0.0));
    })();
    this.bloomNode = bloomFactory(vec4(hdr, 1.0));
    return vec4(acesGame(hdr.add(this.bloomNode.rgb)), 1.0);
  }
}
