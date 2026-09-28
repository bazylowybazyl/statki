// dema/rakiety-webgpu/post.js
//
// Post dema: pass sceny (MSAA 4, HalfFloat) → ZNIEKSZTAŁCENIA → bloom → ACES
// gry → sRGB. Zniekształcenia liczone analitycznie ze źródeł w uniformach
// (jak gorące powietrze w uberPassie gry, bez dodatkowego celu renderu):
//   • 0 fala uderzeniowa: pierścień refrakcji (profil pochodnej gaussa —
//     obraz ściśnięty na froncie, rozciągnięty za nim); BEZ świecącego obrysu
//     (feedback usera: fale = sam przezroczysty efekt zakrzywiania);
//   • 1 implozja: próbkowanie OD środka — obraz wsysany do punktu zapadania;
//   • 2 gorące powietrze: płynący szum w kole, słabnący ku brzegowi.
// Dyspersja barw ×0,82 / ×1 / ×1,22 (jak w grze) tylko dla fal i implozji.
// Ekspozycja: chwilowe przygaszenie przed wybuchem supernowej.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, vec2, vec3, vec4, uniform, uniformArray, screenUV, Loop, If,
  exp, sin, cos, max, min, length, mix, smoothstep, clamp
} from 'three/tsl';
import { acesGame } from './common.js';

export const DISTORT_CAP = 32;

export class PostFx {
  constructor() {
    const v4 = (n) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4');
    this.U = {
      count: uniform(0, 'int'),
      A: v4(DISTORT_CAP), // x, y (scena), promień, szerokość
      B: v4(DISTORT_CAP), // siła [px], typ, dyspersja 0..1, faza
      cam: uniform(new THREE.Vector3(0, 0, 1)), // środek kamery (scena), zoom
      size: uniform(new THREE.Vector2(1920, 1080)),
      time: uniform(0),
      exposure: uniform(1),
      on: uniform(1)
    };
    this.sources = [];
  }

  begin() {
    this.sources.length = 0;
  }

  /** Źródło w SCENIE: typ 0 fala, 1 implozja, 2 gorące powietrze. */
  add(type, x, y, radius, width, strengthPx, dispersion = 1) {
    if (this.sources.length >= DISTORT_CAP || !(strengthPx > 0.02)) return;
    this.sources.push({ type, x, y, radius, width, strengthPx, dispersion });
  }

  commit(camX, camY, zoom, W, H, time) {
    const U = this.U;
    U.cam.value.set(camX, camY, zoom);
    U.size.value.set(W, H);
    U.time.value = time;
    const n = this.sources.length;
    for (let i = 0; i < n; i++) {
      const s = this.sources[i];
      U.A.array[i].set(s.x, s.y, s.radius, s.width);
      U.B.array[i].set(s.strengthPx, s.type, s.dispersion, 0);
    }
    U.count.value = n;
  }

  /** Przesunięcie UV (xy) i jego część z dyspersją (zw) dla piksela uvIn. */
  offsetNode(uvIn) {
    const U = this.U;
    return Fn(() => {
      // Piksel → scena (UV ekranu ma y w dół, scena y w górę).
      const px = uvIn.mul(U.size).toVar();
      const P = vec2(px.x.sub(U.size.x.mul(0.5)), U.size.y.mul(0.5).sub(px.y)).div(U.cam.z).add(U.cam.xy).toVar();
      const offPx = vec2(0.0).toVar();
      const dispPx = vec2(0.0).toVar();
      Loop(U.count, ({ i }) => {
        const A = U.A.element(i).toVar();
        const B = U.B.element(i).toVar();
        const d = P.sub(A.xy).toVar();
        const r = max(length(d), 1e-3).toVar();
        const dir = d.div(r).toVar();
        const o = vec2(0.0).toVar();
        If(B.y.lessThan(0.5), () => {
          const x = r.sub(A.z).div(max(A.w, 1.0));
          // Pochodna gaussa, maksimum ±1 przy |x| = 0,71.
          const prof = x.mul(exp(x.mul(x).negate())).mul(2.33);
          o.assign(dir.mul(prof.mul(B.x)));
        }).ElseIf(B.y.lessThan(1.5), () => {
          const u = r.div(max(A.z, 1.0));
          const prof = u.mul(exp(u.mul(u).mul(-2.2))).mul(2.2);
          o.assign(dir.mul(prof.mul(B.x)));
        }).Else(() => {
          const u = r.div(max(A.z, 1.0));
          const fall = float(1.0).sub(smoothstep(0.3, 1.0, u));
          const t = U.time;
          const w = vec2(
            sin(P.x.mul(0.021).add(t.mul(7.3))).add(sin(P.y.mul(0.034).sub(t.mul(5.1)))),
            cos(P.y.mul(0.025).add(t.mul(6.1))).add(cos(P.x.mul(0.029).add(t.mul(4.7))))
          ).mul(0.5);
          o.assign(w.mul(B.x.mul(fall)));
        });
        offPx.addAssign(o);
        dispPx.addAssign(o.mul(B.z));
      });
      // Piksele → UV (oś y ekranu w dół).
      const inv = vec2(1.0, -1.0).div(U.size);
      return vec4(offPx.mul(inv), dispPx.mul(inv)).mul(U.on);
    })();
  }

  /**
   * Węzeł wyjścia: scena (tekstura passu) z przesunięciem, ekspozycja, bloom,
   * ACES gry. bloomFactory(hdrNode) → węzeł bloomu (BloomNode).
   */
  buildOutput(sceneTex, bloomFactory) {
    const U = this.U;
    const base = screenUV;
    const off = this.offsetNode(base);
    const hdr = Fn(() => {
      const o = off.toVar();
      const main = o.xy.sub(o.zw);
      const r = sceneTex.sample(base.add(main).add(o.zw.mul(0.82))).r;
      const g = sceneTex.sample(base.add(main).add(o.zw)).g;
      const b = sceneTex.sample(base.add(main).add(o.zw.mul(1.22))).b;
      // Siatka bezpieczeństwa: pojedynczy NaN/Inf nie może zalać ekranu przez bloom.
      return max(min(vec3(r, g, b).mul(U.exposure), vec3(60000.0)), vec3(0.0));
    })();
    this.bloomNode = bloomFactory(vec4(hdr, 1.0));
    return vec4(acesGame(hdr.add(this.bloomNode.rgb)), 1.0);
  }
}
