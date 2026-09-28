// src/3d/asteroids/fieldMap.js
//
// Mapa pola nad kadrem — port dema/asteroidy-webgpu/sunMap.js (zadanie 21), bez zmian
// w liczeniu. Mała tekstura RGBA16F w układzie LOKALNYM pola (scena − początek),
// czytana przez mgłę, ośrodek światła wolumetrycznego i maskę słońca Core3D:
//   R = słońce do renderu (transmitancja FieldSunOcclusion przez nightKnee),
//   G = gęstość pyłu (waga pasa × (0,25 + 0,75 · pole)),
//   B = udział lodu (barwa mgły i ośrodka),
//   A = natężenie burzy (stormIntensity).
// Wiersz j rośnie z +y sceny (v = 0 przy najmniejszym y) — jak mapa, której oczekuje
// pole przesłaniające w masce słońca Core3D (setSunOcclusionField, kanał R).
// Pokrycie: kadr na najgłębszej warstwie tła (perspektywa) z zapasem — przebudowa
// dopiero, gdy kadr dojedzie do brzegu albo zoom zmieni potrzebny rozmiar.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { stormIntensity } from '../../game/asteroidStorms.js';

const RES = 48;
const DEEP = 26000;

export class FieldMap {
  constructor() {
    const one = THREE.DataUtils.toHalfFloat(1);
    const zero = THREE.DataUtils.toHalfFloat(0);
    this.res = RES;
    this.data = new Uint16Array(RES * RES * 4);
    for (let i = 0; i < RES * RES; i++) {
      this.data[i * 4] = one;
      this.data[i * 4 + 1] = zero;
      this.data[i * 4 + 2] = zero;
      this.data[i * 4 + 3] = zero;
    }
    this.texture = new THREE.DataTexture(this.data, RES, RES, THREE.RGBAFormat, THREE.HalfFloatType);
    this.texture.name = 'AsteroidBelt:fieldMap';
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
    this.origin = uniform(new THREE.Vector2());
    this.invSize = uniform(new THREE.Vector2(1, 1));
    // Prostokąt mapy (lokalnie): x0, y0 = róg, w = h = bok.
    this._map = { x0: 0, y0: 0, w: 1, h: 1, valid: false };
    this.builds = 0;
    this.buildMs = 0;
  }

  get valid() { return this._map.valid; }
  get rect() { return this._map; }

  /**
   * @param {object} f cam {x, y, zoom} (świat gry), viewW, viewH [px], focalPx,
   *   originX, originY (początek pola w świecie gry), sunT(x, y), field
   */
  update(f) {
    const zoom = Math.max(1e-5, f.cam.zoom || 1);
    const camZ = f.focalPx / zoom;
    const spread = (camZ + DEEP) / camZ;
    const halfW = (f.viewW * 0.5 / zoom) * spread;
    const halfH = (f.viewH * 0.5 / zoom) * spread;
    const need = Math.max(halfW, halfH) * 2;
    // Lokalnie: X = x − O.x, Y = −(y − O.y).
    const cx = f.cam.x - f.originX;
    const cy = -(f.cam.y - f.originY);
    const m = this._map;
    const inside = m.valid
      && cx - halfW >= m.x0 && cx + halfW <= m.x0 + m.w
      && cy - halfH >= m.y0 && cy + halfH <= m.y0 + m.h
      && need >= m.w * 0.3;
    if (!inside) this._build(cx, cy, need, f);
  }

  _build(cx, cy, need, f) {
    const t0 = performance.now();
    const size = Math.pow(2, Math.ceil(Math.log2(need * 1.6)));
    const texel = size / RES;
    const x0 = Math.floor((cx - size * 0.5) / texel) * texel;
    const y0 = Math.floor((cy - size * 0.5) / texel) * texel;
    const H = THREE.DataUtils.toHalfFloat;
    const field = f.field;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const sx = x0 + (i + 0.5) * texel;
        const sy = y0 + (j + 0.5) * texel;
        // Lokalnie → świat gry: x + O.x, −y + O.y.
        const wx = sx + f.originX;
        const wy = -sy + f.originY;
        const T = f.sunT(wx, wy);
        const mac = field.sampleMacro(wx, wy);
        const dust = mac.weight * (0.25 + 0.75 * Math.min(1, mac.cluster));
        const storm = stormIntensity(field.seed, wx, wy, mac.cluster);
        const o = (j * RES + i) * 4;
        this.data[o] = H(Math.max(0, Math.min(1, T)));
        this.data[o + 1] = H(Math.max(0, Math.min(1.5, dust)));
        this.data[o + 2] = H(Math.max(0, Math.min(1, mac.ice || 0)));
        this.data[o + 3] = H(Math.max(0, Math.min(1, storm)));
      }
    }
    this.texture.needsUpdate = true;
    const m = this._map;
    m.x0 = x0; m.y0 = y0; m.w = size; m.h = size; m.valid = true;
    this.origin.value.set(x0, y0);
    this.invSize.value.set(1 / size, 1 / size);
    this.builds++;
    this.buildMs = performance.now() - t0;
  }

  /** Nowy początek pola / nowa gęstość pola: przebudowa przy następnym update. */
  invalidate() {
    this._map.valid = false;
  }
}
