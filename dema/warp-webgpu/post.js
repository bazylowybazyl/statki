// dema/warp-webgpu/post.js
//
// Składanie klatki (RenderPipeline): cztery passy —
//   niebo (mgławica, kamera persp.),
//   planety + gwiazdy (kamera ortho w pikselach ekranu; tarcze zasłaniają gwiazdy),
//   ośrodek (kamera persp. — głębia = paralaksa; addytywnie, na planetach),
//   gra (kadłuby, szczeliny tuneli, blaski; kamera ortho) —
// potem zniekształcenia, bloom (wartości z bloomConfig.js) i ACES gry.
//
// Zniekształcenia (bez żadnych świecących obręczy — shockwave-style):
//   • FALE — przezroczyste pierścienie refrakcji (skok, wyjście, przylot);
//     przesuwają WSZYSTKIE passy (fala idzie też przez kadłuby);
//   • SOCZEWKA BAŃKI — tylko niebo (mgławica): ściśnięcie przed bańką,
//     rozciągnięcie za nią, talia bez zmian; kieszeń w środku płaska;
//   • SZCZELINA TUNELU — tylko niebo: tło wciągane do osi szczeliny.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec4, uniform, uniformArray, pass, screenUV, Loop, If, max, min,
  length, exp, dot, clamp, smoothstep, abs, sign
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { BLOOM_DEFAULTS } from '../../src/3d/bloomConfig.js';
import { acesGame, sech2 } from './tslCommon.js';

export const WAVE_CAP = 8;
export const LENS_CAP = 8;
export const SEAM_LENS_CAP = 8;

export class WarpPost {
  constructor({ renderer, skyScene, planetScene, medScene, fgScene, bgCam, planetCam, fgCam }) {
    const v4 = (n) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4');
    this.u = {
      viewPx: uniform(new THREE.Vector2(1920, 1080)),
      waveCount: uniform(0, 'int'),
      waveA: v4(WAVE_CAP),   // xy środek [px, y w dół], z promień [px], w szerokość [px]
      waveB: v4(WAVE_CAP),   // x amplituda [px]
      lensCount: uniform(0, 'int'),
      lensA: v4(LENS_CAP),   // xy środek [px], zw oś (ekran, y w dół)
      lensB: v4(LENS_CAP),   // x a [px], y b [px], z amplituda [px], w front (x/a)
      seamCount: uniform(0, 'int'),
      seamA: v4(SEAM_LENS_CAP), // xy środek [px], zw oś
      seamB: v4(SEAM_LENS_CAP), // x pół-długość [px], y pół-szerokość pasa [px], z amplituda [px]
      lensOn: uniform(1)
    };
    const U = this.u;
    this.pipeline = new THREE.RenderPipeline(renderer);
    const skyPass = pass(skyScene, bgCam, { samples: 0 });
    const planetPass = pass(planetScene, planetCam, { samples: 4 });
    const medPass = pass(medScene, bgCam, { samples: 4 });
    const fgPass = pass(fgScene, fgCam, { samples: 4 });
    const sky = skyPass.getTextureNode('output');
    const pl = planetPass.getTextureNode('output');
    const med = medPass.getTextureNode('output');
    const fg = fgPass.getTextureNode('output');

    const distort = Fn(() => {
      const px = screenUV.mul(U.viewPx).toVar();
      const off = vec2(0.0).toVar();
      Loop(U.waveCount, ({ i }) => {
        const A = U.waveA.element(i);
        const B = U.waveB.element(i);
        const d = px.sub(A.xy);
        const r = max(length(d), 1e-3);
        const x = r.sub(A.z).div(max(A.w, 1.0));
        // Pochodna gaussa: w środku pasa w głąb, na zewnątrz na zewnątrz.
        off.addAssign(d.div(r).mul(B.x.mul(x).mul(exp(x.mul(x).negate())).mul(2.33)));
      });
      return off;
    });
    const skyBend = Fn(([pxIn]) => {
      const off = vec2(0.0).toVar();
      Loop(U.lensCount, ({ i }) => {
        const A = U.lensA.element(i);
        const B = U.lensB.element(i);
        const d = pxIn.sub(A.xy).toVar();
        const ax = vec2(A.z, A.w);
        const xl = dot(d, ax);
        const yl = dot(d, vec2(ax.y.negate(), ax.x));
        const q = vec2(xl.div(B.x), yl.div(B.y)).toVar();
        const rho = max(length(q), 1e-3).toVar();
        If(rho.greaterThan(1.0).and(rho.lessThan(4.0)), () => {
          const n = q.div(rho);
          const wall = sech2(rho.sub(1.0).mul(2.6));
          const c = n.x.mul(wall);
          const alive = float(1.0).sub(smoothstep(B.w.sub(0.15), B.w.add(0.15), xl.div(B.x)));
          const radial = d.div(max(length(d), 1e-3));
          off.addAssign(radial.mul(B.z.mul(c.mul(-1.0).add(wall.mul(0.35))).mul(alive)));
        });
      });
      // Szczeliny tuneli: tło wciągane ku osi (tylko w pasie przy szczelinie).
      Loop(U.seamCount, ({ i }) => {
        const A = U.seamA.element(i);
        const B = U.seamB.element(i);
        const d = pxIn.sub(A.xy);
        const ax = vec2(A.z, A.w);
        const pr = vec2(ax.y.negate(), ax.x);
        const xl = dot(d, ax);
        const yl = dot(d, pr);
        const tip = smoothstep(1.2, 0.7, abs(xl).div(max(B.x, 1.0)));
        const band = exp(abs(yl).div(max(B.y, 1.0)).negate());
        off.addAssign(pr.mul(sign(yl).mul(B.z).mul(band).mul(tip)));
      });
      return off;
    });

    const offW = distort().toVar();
    const pxW = screenUV.mul(U.viewPx).add(offW).toVar();
    const offS = skyBend(pxW).mul(U.lensOn);
    const uvW = pxW.div(U.viewPx);
    const uvS = pxW.add(offS).div(U.viewPx);
    const skyC = sky.sample(uvS).rgb;
    const plC = pl.sample(uvW);
    const medC = med.sample(uvW).rgb;
    const fgC = fg.sample(uvW);
    const base = skyC.mul(float(1.0).sub(plC.a)).add(plC.rgb);
    const comp = fgC.rgb.add(base.add(medC).mul(float(1.0).sub(fgC.a)));
    this.bloomNode = bloom(vec4(comp, 1.0), BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold);
    this.bloomOn = uniform(1);
    this.pipeline.outputNode = vec4(acesGame(comp.add(this.bloomNode.rgb.mul(this.bloomOn))), 1.0);
    this.pipeline.outputColorTransform = true;
  }

  setWaves(list) {
    const U = this.u;
    const n = Math.min(WAVE_CAP, list.length);
    for (let i = 0; i < n; i++) {
      const w = list[i];
      U.waveA.array[i].set(w.x, w.y, w.r, w.w);
      U.waveB.array[i].set(w.amp, 0, 0, 0);
    }
    U.waveCount.value = n;
  }

  setLens(list) {
    const U = this.u;
    const n = Math.min(LENS_CAP, list.length);
    for (let i = 0; i < n; i++) {
      const l = list[i];
      U.lensA.array[i].set(l.x, l.y, l.ax, l.ay);
      U.lensB.array[i].set(l.a, l.b, l.amp, l.front);
    }
    U.lensCount.value = n;
  }

  /** Szczeliny w pikselach (y w dół): { x, y, ax, ay, halfLen, band, amp }. */
  setSeams(list) {
    const U = this.u;
    const n = Math.min(SEAM_LENS_CAP, list.length);
    for (let i = 0; i < n; i++) {
      const s = list[i];
      U.seamA.array[i].set(s.x, s.y, s.ax, s.ay);
      U.seamB.array[i].set(s.halfLen, s.band, s.amp, 0);
    }
    U.seamCount.value = n;
  }

  render() {
    this.pipeline.render();
  }
}
