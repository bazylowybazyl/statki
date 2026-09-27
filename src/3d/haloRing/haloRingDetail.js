// Kafelkowe tekstury szumu (bake na GPU przy starcie). Detal terenu, fal
// i chmur próbkuje je w kilku skalach, więc koszt na piksel to kilka
// odczytów z mipmapami zamiast dziesiątek oktaw szumu — i zero aliasingu
// z daleka. Okresy kafli w świecie dzielą obwód ringu bez reszty
// (haloDetailScales), więc detal nie ma szwu na u = 0/1.
//
//   tex1 RGBA16F: fbm (wysokość), d/du, d/dv (gradient w jednostkach uv), ridged
//   tex2 RGBA16F: Worley F1, id komórki, fbm #2, F2 − F1 (krawędzie komórek)
//
// Port WebGPU (zadanie 06): dwa materiały TSL (po jednym na teksturę), cele
// RenderTarget, kompilacja compileAsync na prawdziwych celach przed bake'iem
// (init() — asynchronicznie). Oś Y jak w mapach świata (haloRingWorldGen.js):
// v = 0 w górnym wierszu celu, więc texture(tex, (u, v)) = wartość z GL.
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import { Fn, Loop, float, vec2, vec4, uv, positionGeometry, abs, clamp } from 'three/tsl';
import { haloGnoise2P, haloPureFn, haloWorleyP } from './haloRingTSL.js';

const SIZE = 1024;

// fbm z 6 oktaw okresowego szumu gradientowego (okres 8, 16, …)
const haloFbmP = haloPureFn('haloFbmP', 'float', [['uvp', 'vec2'], ['salt', 'float']], (a) => {
  const sum = float(0.0).toVar();
  const amp = float(0.5).toVar();
  const period = float(8.0).toVar();
  Loop(6, ({ i }) => {
    sum.addAssign(amp.mul(haloGnoise2P(a.uvp.mul(period), vec2(period, period), a.salt.add(float(i).mul(13.0)))));
    period.mulAssign(2.0);
    amp.mulAssign(0.5);
  });
  return sum;
});
const haloRidgedP = haloPureFn('haloRidgedP', 'float', [['uvp', 'vec2'], ['salt', 'float']], (a) => {
  const sum = float(0.0).toVar();
  const amp = float(0.5).toVar();
  const period = float(6.0).toVar();
  const wgt = float(1.0).toVar();
  Loop(6, ({ i }) => {
    const n = float(1.0).sub(abs(haloGnoise2P(a.uvp.mul(period), vec2(period, period), a.salt.add(float(i).mul(7.0))))).toVar();
    n.mulAssign(n);
    sum.addAssign(amp.mul(n).mul(wgt));
    wgt.assign(clamp(n.mul(1.8), 0.0, 1.0));
    period.mulAssign(2.0);
    amp.mulAssign(0.5);
  });
  return sum;
});

// Kwad: v = 0 w GÓRNYM wierszu celu (konwencja WebGPU), pozycja = NDC.
function makeQuadGeometry() {
  const g = new THREE.PlaneGeometry(2, 2);
  const uvAttr = g.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) uvAttr.setY(i, 1 - uvAttr.getY(i));
  return g;
}

export function makeHaloDetailMaterial(pass) {
  const m = new NodeMaterial();
  m.name = `HaloDetail${pass + 1}`;
  m.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
  m.fragmentNode = Fn(() => {
    const p = uv().toVar();
    if (pass === 0) {
      const e = 1.0 / SIZE;
      const h = haloFbmP(p, 1.0);
      const hx = haloFbmP(p.add(vec2(e, 0.0)), 1.0).sub(haloFbmP(p.sub(vec2(e, 0.0)), 1.0)).div(2.0 * e);
      const hy = haloFbmP(p.add(vec2(0.0, e)), 1.0).sub(haloFbmP(p.sub(vec2(0.0, e)), 1.0)).div(2.0 * e);
      return vec4(h, hx, hy, haloRidgedP(p, 5.0).sub(0.5));
    }
    const w = haloWorleyP(p.mul(32.0), vec2(32.0, 32.0), 11.0).toVar();
    const f2 = haloFbmP(p, 29.0);
    return vec4(w.x, w.y, f2, w.z.sub(w.x));
  })();
  m.depthTest = false;
  m.depthWrite = false;
  m.blending = THREE.NoBlending;
  m.toneMapped = false;
  return m;
}

export class HaloDetailTextures {
  constructor(renderer) {
    this.renderer = renderer;
    const make = () => {
      const rt = new THREE.RenderTarget(SIZE, SIZE, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping
      });
      rt.texture.anisotropy = 8;
      rt.texture.colorSpace = THREE.NoColorSpace;
      return rt;
    };
    this.rt1 = make();
    this.rt2 = make();
    this.textureBytes = SIZE * SIZE * 8 * 2 * 4 / 3;
    this.ready = false;
    this.bakeMs = 0;
    this.compileMs = 0;
    this._initPromise = null;
    this._disposed = false;
  }

  // Kompilacja (compileAsync na prawdziwych celach) i bake obu tekstur. Idempotentne.
  init() {
    if (!this._initPromise) this._initPromise = this._init();
    return this._initPromise;
  }

  async _init() {
    const renderer = this.renderer;
    if (typeof renderer.init === 'function') await renderer.init();
    const materials = [makeHaloDetailMaterial(0), makeHaloDetailMaterial(1)];
    const scene = new THREE.Scene();
    const quad = new THREE.Mesh(makeQuadGeometry(), materials[0]);
    quad.frustumCulled = false;
    scene.add(quad);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const targets = [this.rt1, this.rt2];
    const prev = renderer.getRenderTarget();
    try {
      const t0 = performance.now();
      if (typeof renderer.compileAsync === 'function') {
        for (let i = 0; i < 2; i++) {
          if (this._disposed) return;
          quad.material = materials[i];
          renderer.setRenderTarget(targets[i]);
          await renderer.compileAsync(scene, camera);
          renderer.setRenderTarget(prev);
        }
      }
      this.compileMs = performance.now() - t0;
      if (this._disposed) return;
      const t1 = performance.now();
      for (let i = 0; i < 2; i++) {
        quad.material = materials[i];
        renderer.setRenderTarget(targets[i]);
        renderer.render(scene, camera);
      }
      this.bakeMs = performance.now() - t1;
      this.ready = true;
    } finally {
      renderer.setRenderTarget(prev);
      for (const m of materials) m.dispose();
      quad.geometry.dispose();
    }
  }

  get tex1() { return this.rt1.texture; }
  get tex2() { return this.rt2.texture; }

  dispose() {
    this._disposed = true;
    this.rt1.dispose();
    this.rt2.dispose();
  }
}

// Okresy kafli detalu w świecie: L / n, n całkowite → bezszwowo wokół ringu.
export function haloDetailScales(circumference) {
  const want = [420, 105, 26, 6.5];
  return want.map((w) => {
    const n = Math.max(1, Math.round(circumference / w));
    return { count: n, size: circumference / n };
  });
}

// Skale chmur: te same zasady, osobno wzdłuż s i t (chmury ciągną się
// wzdłuż wstęgi, więc okres w s jest 2× dłuższy).
export function haloCloudScales(circumference) {
  const want = [7200, 2600, 950, 340, 120, 45];
  return want.map((w) => {
    const n = Math.max(1, Math.round(circumference / (w * 2)));
    return { count: n, sizeS: circumference / n, sizeT: w };
  });
}
