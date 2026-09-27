// dema/asteroidy-webgpu/sunMap.js
//
// Mapa transmitancji słońca w polu (FieldSunOcclusion, world.js) nad kadrem:
// mała tekstura R16F w układzie SCENY, czytana przez pył (compute) i mgłę.
// Odświeżana dopiero po odjeździe kamery o ~10% pokrycia (T zmienia się
// na dziesiątkach tysięcy jednostek).

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

const RES = 16;

export class SunFieldMap {
  constructor() {
    this.data = new Uint16Array(RES * RES).fill(THREE.DataUtils.toHalfFloat(1));
    this.texture = new THREE.DataTexture(this.data, RES, RES, THREE.RedFormat, THREE.HalfFloatType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
    this.origin = uniform(new THREE.Vector2());
    this.invSize = uniform(new THREE.Vector2(1, 1));
    this._at = { x: NaN, y: NaN, w: 0 };
  }

  /**
   * Prostokąt sceny o środku (cx, cy) i wymiarach (w, h); sunT(x, y) w świecie
   * gry, (ox, oy) = lokalny początek sceny.
   */
  update(cx, cy, w, h, ox, oy, sunT) {
    const m = this._at;
    if (Math.abs(cx - m.x) < w * 0.1 && Math.abs(cy - m.y) < h * 0.1 && Math.abs(w - m.w) < w * 0.05) return;
    m.x = cx; m.y = cy; m.w = w;
    const x0 = cx - w * 0.5;
    const y0 = cy - h * 0.5;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const sx = x0 + (i + 0.5) * (w / RES);
        const sy = y0 + (j + 0.5) * (h / RES);
        // Scena → świat gry: x + O.x, −y + O.y.
        const T = sunT(sx + ox, -sy + oy);
        this.data[j * RES + i] = THREE.DataUtils.toHalfFloat(Math.max(0, Math.min(1, T)));
      }
    }
    this.texture.needsUpdate = true;
    this.origin.value.set(x0, y0);
    this.invSize.value.set(1 / w, 1 / h);
  }

  /** Nowy lokalny początek: przebudowa przy następnym update. */
  invalidate() {
    this._at.x = NaN;
  }
}
