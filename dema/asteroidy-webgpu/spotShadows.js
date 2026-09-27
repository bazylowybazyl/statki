// dema/asteroidy-webgpu/spotShadows.js
//
// Cień skał w smugach reflektorów dziobu: dla każdego statku jedna mapa
// odległości z pozycji jego reflektorów dalekich (kamera persp. wzdłuż osi
// stożka, skały gry na osobnej warstwie three, materiał RockShadowMaterial:
// wyjście 1 / odległość). Mapę czytają oświetlenie pyłu (compute) i powierzchni
// (GridLightsNode) — światło z flagą mapy gaśnie za skałą, więc w pyle widać
// ciemne smugi cienia, a skały zasłonięte przez bliższe nie łapią reflektora.

import * as THREE from 'three/webgpu';
import { float, vec2, vec4, uniform, texture, If, abs, length, smoothstep, max } from 'three/tsl';

export const SHADOW_LAYER = 1;
const SIZE = 512;

export class SpotShadowMaps {
  /**
   * @param {object} o
   * @param {number} [o.count] liczba map (statków)
   * @param {THREE.NodeMaterial} o.material RockShadowMaterial
   */
  constructor({ count = 2, material }) {
    this.material = material;
    this.maps = [];
    for (let i = 0; i < count; i++) {
      const rt = new THREE.RenderTarget(SIZE, SIZE, {
        type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: true, stencilBuffer: false,
        generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter
      });
      rt.texture.colorSpace = THREE.NoColorSpace;
      const cam = new THREE.PerspectiveCamera(40, 1, 20, 12000);
      cam.up.set(0, 0, 1);
      cam.layers.set(SHADOW_LAYER);
      this.maps.push({
        rt, cam, active: false,
        matrix: uniform(new THREE.Matrix4()),
        pos: uniform(new THREE.Vector3()),
        on: uniform(0)
      });
    }
    this.enabled = true;
    this._target = new THREE.Vector3();
  }

  /**
   * Ustawia mapę i (scena): pozycja lampy, oś stożka (jednostkowa), pełny kąt
   * stożka [°] i zasięg. active = false wyłącza mapę (światło bez cienia).
   */
  set(i, active, x, y, z, ax, ay, az, coneDeg, range) {
    const m = this.maps[i];
    if (!m) return;
    m.active = !!active && this.enabled;
    m.on.value = m.active ? 1 : 0;
    if (!m.active) return;
    const cam = m.cam;
    cam.fov = Math.min(120, coneDeg + 10);
    cam.near = 20;
    cam.far = Math.max(1000, range);
    cam.position.set(x, y, z);
    this._target.set(x + ax, y + ay, z + az);
    cam.lookAt(this._target);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    m.matrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    m.pos.value.set(x, y, z);
    this.material.lightPos.value.set(x, y, z);
  }

  /** Render aktywnych map (skały gry na warstwie SHADOW_LAYER). */
  render(renderer, scene) {
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.material;
    try {
      for (const m of this.maps) {
        if (!m.active) continue;
        this.material.lightPos.value.copy(m.pos.value);
        renderer.setRenderTarget(m.rt);
        renderer.clear();
        renderer.render(scene, m.cam);
      }
    } finally {
      scene.overrideMaterial = prevOverride;
      renderer.setRenderTarget(prevTarget);
    }
  }

  /**
   * TSL: widoczność punktu P (scena) dla światła z flagą mapy s (1..n; 0 =
   * bez cienia). Miękki brzeg z filtrowania mapy 1/odległość.
   */
  visibility(s, P) {
    const vis = float(1.0).toVar();
    If(s.greaterThan(0.5), () => {
      this.maps.forEach((m, k) => {
        If(abs(s.sub(k + 1)).lessThan(0.5).and(m.on.greaterThan(0.5)), () => {
          const clip = m.matrix.mul(vec4(P, 1.0)).toVar();
          If(clip.w.greaterThan(1.0), () => {
            const ndc = clip.xy.div(clip.w).toVar();
            If(abs(ndc.x).lessThan(1.0).and(abs(ndc.y).lessThan(1.0)), () => {
              const uvs = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
              const occ = texture(m.rt.texture, uvs).level(0).r;
              const invP = float(1.0).div(max(length(P.sub(m.pos)), 1.0));
              // Zasłona bliżej niż punkt (1/d większe) → cień; miękko przy krawędzi.
              vis.assign(float(1.0).sub(smoothstep(invP.mul(1.015), invP.mul(1.06), occ)));
            });
          });
        });
      });
    });
    return vis;
  }
}
