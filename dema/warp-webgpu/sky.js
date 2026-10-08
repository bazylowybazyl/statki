// dema/warp-webgpu/sky.js
//
// Tło jak w grze: mgławica `assets/nebula.webp` (NebulaSystem z
// src/3d/planet3d.assets.js — płaszczyzna 800 × 500 tys. j. na z = −150 000,
// paralaksa 0,98, czyli przesuwa się o 2% ruchu kamery). Osobny pass — tylko
// ją zgina soczewka bańki (gwiazd nie: gięte smugi wyglądały jak 3D).
// RULON (rulon.js): piksel ekranu cofany na płaską mgławicę odwrotnością
// walca — próbka przesunięta o różnicę przez pochodne uv (mgławica to
// płaszczyzna, więc dokładnie); za horyzontem rulonu czerń.

import * as THREE from 'three/webgpu';
import { Fn, vec2, vec4, uniform, texture, uv, screenCoordinate, dFdx, dFdy } from 'three/tsl';
import { rulonInverse } from './rulon.js';

export const NEBULA_Z = -150000;
const NEBULA_W = 800000;
const NEBULA_ASPECT = 1.6;

export class WarpSky {
  constructor(scene) {
    const tex = new THREE.TextureLoader().load('/assets/nebula.webp');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    this.texture = tex;
    this.u = { gain: uniform(1.0), viewPx: uniform(new THREE.Vector2(1920, 1080)) };
    const mat = new THREE.NodeMaterial();
    mat.depthTest = false;
    mat.depthWrite = false;
    mat.lights = false;
    mat.fog = false;
    mat.fragmentNode = Fn(() => {
      const U = this.u;
      // Pochodne przed wszystkim (pułapki 15, 29); dFdy w TSL — oś y w górę.
      const uv0 = uv();
      const gx = vec2(0).toVar();
      const gy = vec2(0).toVar();
      gx.assign(dFdx(uv0));
      gy.assign(dFdy(uv0));
      // Piksel [px, y w górę, od środka kadru]; screenCoordinate liczy y od góry.
      const q = vec2(screenCoordinate.x.sub(U.viewPx.x.mul(0.5)), U.viewPx.y.mul(0.5).sub(screenCoordinate.y));
      const r = rulonInverse(q).toVar();
      const off = r.xy.sub(q);
      const uvR = uv0.add(gx.mul(off.x)).add(gy.mul(off.y));
      return vec4(texture(tex, uvR).rgb.mul(U.gain).mul(r.z), 1.0);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(NEBULA_W, NEBULA_W / NEBULA_ASPECT), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.mesh.name = 'nebula';
    scene.add(this.mesh);
  }

  /** Położenie względem kotwicy kamery; (camX, camY) — kamera w scenie (y w górę). */
  update(camX, camY, W, H) {
    if (W && H) this.u.viewPx.value.set(W, H);
    this.mesh.position.set(-camX * 0.02, -camY * 0.02, NEBULA_Z);
    this.mesh.updateMatrixWorld(true);
  }
}
