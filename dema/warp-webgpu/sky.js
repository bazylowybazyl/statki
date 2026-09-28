// dema/warp-webgpu/sky.js
//
// Tło jak w grze: mgławica `assets/nebula.png` (NebulaSystem z
// src/3d/planet3d.assets.js — płaszczyzna 800 × 500 tys. j. na z = −150 000,
// paralaksa 0,98, czyli przesuwa się o 2% ruchu kamery). Osobny pass — tylko
// ją zgina soczewka bańki (gwiazd nie: gięte smugi wyglądały jak 3D).

import * as THREE from 'three/webgpu';
import { Fn, vec4, uniform, texture, uv } from 'three/tsl';

export const NEBULA_Z = -150000;
const NEBULA_W = 800000;
const NEBULA_ASPECT = 1.6;

export class WarpSky {
  constructor(scene) {
    const tex = new THREE.TextureLoader().load('/assets/nebula.png');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    this.texture = tex;
    this.u = { gain: uniform(1.0) };
    const mat = new THREE.NodeMaterial();
    mat.depthTest = false;
    mat.depthWrite = false;
    mat.lights = false;
    mat.fog = false;
    mat.fragmentNode = Fn(() => vec4(texture(tex, uv()).rgb.mul(this.u.gain), 1.0))();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(NEBULA_W, NEBULA_W / NEBULA_ASPECT), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.mesh.name = 'nebula';
    scene.add(this.mesh);
  }

  /** Położenie względem kotwicy kamery; (camX, camY) — kamera w scenie (y w górę). */
  update(camX, camY) {
    this.mesh.position.set(-camX * 0.02, -camY * 0.02, NEBULA_Z);
    this.mesh.updateMatrixWorld(true);
  }
}
