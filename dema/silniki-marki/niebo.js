// dema/silniki-marki/niebo.js
//
// Tło dema marek silników: gwiazdy, które POKAZUJĄ PRĘDKOŚĆ. Okręt stoi w kadrze dziobem w prawo, więc gwiazdy płyną
// w lewo; im szybciej, tym dłuższa smuga (długość = prędkość × czas naświetlania). Trzy warstwy paralaksy w długich
// komórkach (smuga nigdy nie wychodzi poza komórkę) i gęste, nieruchome tło punktów, które gaśnie w warpie.
// Przesunięcia warstw całkuje CPU (przesunięcie += prędkość · dt) — bez czasu × prędkość w shaderze.
// Tło jest nieprzezroczyste (alfa 1): bez niego poświata bloomu w pustce wychodzi ~2× jaśniej.

import * as THREE from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, attribute, uniform, screenCoordinate, floor, dot, exp, abs,
  max, mix, smoothstep, clamp, hash, mx_fractal_noise_float
} from 'three/tsl';

const CX = 720;                     // długość komórki warstw ruchomych [px]
const CY = [5, 7, 9];               // wysokości komórek warstw
const PARALAKSA = [0.35, 0.62, 1];  // ułamek prędkości pokazowej
const ZAWIN = CX * 4096;

export class Niebo {
  constructor(scene) {
    this.u = {
      scroll: uniform(new THREE.Vector3(0, 0, 0)),   // przesunięcie warstw [px]
      smuga: uniform(new THREE.Vector3(0, 0, 0)),    // półdługość smugi warstw [px]
      warp: uniform(0),                              // 0…1 — chłodny odcień i wygaszenie tła punktów
      gain: uniform(1),
      mglawica: uniform(1)
    };
    this._scroll = [0, 0, 0];
    this._len = [0, 0, 0];
    this._far = 0;
    const U = this.u;
    const mat = new THREE.NodeMaterial();
    mat.depthTest = false;
    mat.depthWrite = false;
    mat.lights = false;
    mat.fog = false;
    mat.vertexNode = Fn(() => {
      const p = attribute('position', 'vec3');
      return vec4(p.xy, 0.5, 1.0);
    })();
    mat.fragmentNode = Fn(() => {
      const px = screenCoordinate.xy.toVar();
      const col = vec3(0.0).toVar();

      // Dalekie tło: punkty w komórkach 7 px, prawie bez ruchu.
      const c0 = floor(px.add(vec2(U.scroll.x.mul(0.04), 0.0)).div(7.0)).toVar();
      const s0 = c0.x.add(c0.y.mul(4099.0)).add(3.0e6).toUint().toVar();
      const b0 = hash(s0);
      const p0 = c0.add(vec2(hash(s0.bitXor(uint(0x68E31DA4))), hash(s0.bitXor(uint(0xB5297A4D)))).mul(0.8).add(0.1)).mul(7.0);
      const d0 = px.add(vec2(U.scroll.x.mul(0.04), 0.0)).sub(p0);
      const r0 = dot(d0, d0);
      const bright0 = smoothstep(0.975, 1.0, b0).mul(b0.mul(b0)).mul(0.4);
      col.addAssign(vec3(0.8, 0.86, 1.0).mul(bright0).mul(exp(r0.mul(-1.4))).mul(float(1.0).sub(U.warp.mul(0.85))));

      // Trzy warstwy ruchome: gwiazda = odcinek o półdługości `smuga` wzdłuż ruchu.
      for (let i = 0; i < 3; i++) {
        const cs = vec2(CX, CY[i]);
        const ell = [U.smuga.x, U.smuga.y, U.smuga.z][i];
        const sc = [U.scroll.x, U.scroll.y, U.scroll.z][i];
        const q = vec2(px.x.add(sc), px.y.add(131.7 * i)).toVar();
        const cell = floor(q.div(cs)).toVar();
        const s = cell.x.add(cell.y.mul(4099.0)).add(1.0e6 * (i + 1)).toUint().toVar();
        const h1 = hash(s);
        const h2 = hash(s.bitXor(uint(0x68E31DA4)));
        const h3 = hash(s.bitXor(uint(0xB5297A4D)));
        const h4 = hash(s.bitXor(uint(0x1B56C4E9)));
        const m = clamp(ell.div(CX).add(0.01), 0.0, 0.45);
        const star = vec2(h2.mul(float(1.0).sub(m.mul(2.0))).add(m).mul(CX), h3.mul(0.6).add(0.2).mul(CY[i]));
        const d = q.sub(cell.mul(cs).add(star));
        const ex = max(abs(d.x).sub(ell), 0.0);
        const r2 = ex.mul(ex).add(d.y.mul(d.y));
        const bright = smoothstep(0.72, 1.0, h1).mul(h1.mul(h1).mul(h1));
        const shape = exp(r2.mul(-1.3)).mul(0.85).add(exp(r2.mul(-0.16)).mul(0.04));
        const tint = mix(mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.86, 0.7), h4), vec3(0.72, 0.86, 1.25), U.warp);
        const k = float(1.0).div(ell.mul(0.02).add(1.0));
        col.addAssign(tint.mul(bright).mul(shape).mul(k).mul(0.55 + 0.3 * i));
      }

      // Ciemna, chłodna mgławica — stoi (jest bardzo daleko).
      const nq = px.div(900.0);
      const neb = mx_fractal_noise_float(vec3(nq, 0.37), 4, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
      const neb2 = mx_fractal_noise_float(vec3(nq.mul(2.3).add(5.1), 1.7), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
      const nebula = vec3(0.012, 0.013, 0.021).mul(smoothstep(0.35, 0.8, neb)).add(vec3(0.008, 0.004, 0.011).mul(smoothstep(0.45, 0.9, neb2)));
      return vec4(max(col.mul(U.gain).add(nebula.mul(U.mglawica)).add(vec3(0.003, 0.0035, 0.005)), vec3(0.0)), 1.0);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.mesh.name = 'niebo';
    scene.add(this.mesh);
  }

  /**
   * @param {number} dt
   * @param {number} speedPx prędkość pokazowa najbliższej warstwy [px/s]
   * @param {number} warp 0…1
   */
  update(dt, speedPx, warp) {
    const s = this._scroll;
    for (let i = 0; i < 3; i++) s[i] = (s[i] + speedPx * PARALAKSA[i] * dt) % ZAWIN;
    this.u.scroll.value.set(s[0], s[1], s[2]);
    // Smuga rośnie z prędkością nieliniowo: w zwykłym locie gwiazdy zostają punktami, w hipercruisie to krótkie
    // kreski, w warpie długie smugi; nie dłuższa niż 0,42 komórki.
    const lim = CX * 0.42;
    for (let i = 0; i < 3; i++) {
      const v = speedPx * PARALAKSA[i];
      this._len[i] = Math.min(lim, v * v / (v + 2500) / 40);
    }
    this.u.smuga.value.set(this._len[0], this._len[1], this._len[2]);
    this.u.warp.value = warp;
  }
}
