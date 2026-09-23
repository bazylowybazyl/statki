// Kafelkowe tekstury szumu (bake na GPU przy starcie). Detal terenu, fal
// i chmur próbkuje je w kilku skalach, więc koszt na piksel to kilka
// odczytów z mipmapami zamiast dziesiątek oktaw szumu — i zero aliasingu
// z daleka. Okresy kafli w świecie dzielą obwód ringu bez reszty
// (haloDetailScales), więc detal nie ma szwu na u = 0/1.
//
//   tex1 RGBA16F: fbm (wysokość), d/du, d/dv (gradient w jednostkach uv), ridged
//   tex2 RGBA16F: Worley F1, id komórki, fbm #2, F2 − F1 (krawędzie komórek)
import * as THREE from 'three';
import { HALO_GLSL_NOISE } from './haloRingGLSL.js';

const SIZE = 1024;

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */`
${HALO_GLSL_NOISE}
uniform float uPass;
varying vec2 vUv;
float fbmP(vec2 uv, float salt) {
  float sum = 0.0;
  float a = 0.5;
  float period = 8.0;
  for (int i = 0; i < 6; i++) {
    sum += a * haloGnoise2P(uv * period, vec2(period), salt + float(i) * 13.0);
    period *= 2.0;
    a *= 0.5;
  }
  return sum;
}
float ridgedP(vec2 uv, float salt) {
  float sum = 0.0;
  float a = 0.5;
  float period = 6.0;
  float wgt = 1.0;
  for (int i = 0; i < 6; i++) {
    float n = 1.0 - abs(haloGnoise2P(uv * period, vec2(period), salt + float(i) * 7.0));
    n *= n;
    sum += a * n * wgt;
    wgt = clamp(n * 1.8, 0.0, 1.0);
    period *= 2.0;
    a *= 0.5;
  }
  return sum;
}
void main() {
  vec2 uv = vUv;
  if (uPass < 0.5) {
    float e = 1.0 / ${SIZE}.0;
    float h = fbmP(uv, 1.0);
    float hx = (fbmP(uv + vec2(e, 0.0), 1.0) - fbmP(uv - vec2(e, 0.0), 1.0)) / (2.0 * e);
    float hy = (fbmP(uv + vec2(0.0, e), 1.0) - fbmP(uv - vec2(0.0, e), 1.0)) / (2.0 * e);
    gl_FragColor = vec4(h, hx, hy, ridgedP(uv, 5.0) - 0.5);
  } else {
    vec3 w = haloWorleyP(uv * 32.0, vec2(32.0), 11.0);
    float f2 = fbmP(uv, 29.0);
    gl_FragColor = vec4(w.x, w.y, f2, w.z - w.x);
  }
}
`;

export class HaloDetailTextures {
  constructor(renderer) {
    const make = () => {
      const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping
      });
      rt.texture.anisotropy = 8;
      return rt;
    };
    this.rt1 = make();
    this.rt2 = make();
    const material = new THREE.ShaderMaterial({
      uniforms: { uPass: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false
    });
    const scene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    scene.add(quad);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prev = renderer.getRenderTarget();
    material.uniforms.uPass.value = 0;
    renderer.setRenderTarget(this.rt1);
    renderer.render(scene, camera);
    material.uniforms.uPass.value = 1;
    renderer.setRenderTarget(this.rt2);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
    material.dispose();
    quad.geometry.dispose();
    this.textureBytes = SIZE * SIZE * 8 * 2 * 4 / 3;
  }

  get tex1() { return this.rt1.texture; }
  get tex2() { return this.rt2.texture; }

  dispose() {
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
