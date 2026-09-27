// dema/asteroidy-webgpu/sky.js
//
// Tło passa tła: gwiazdy i ciemna mgławica (proceduralnie, w przestrzeni
// ekranu z bardzo wolną paralaksą), przykryte zasłoną pyłu gęstego pola jak
// w src/3d/beltDust3D.js (w rdzeniu pola galaktyki prawie nie widać; po
// stronie słońca łuna, gasnąca w mroku pola). Pełnoekranowy kwad bez testu
// głębi, rysowany pierwszy.

import * as THREE from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, uniform, screenCoordinate, screenSize, floor, dot,
  mix, smoothstep, clamp, max, exp, hash, mx_fractal_noise_float, attribute
} from 'three/tsl';

export class Sky {
  constructor(scene) {
    this.u = {
      offset: uniform(new THREE.Vector2()),      // przesunięcie gwiazd [px] (paralaksa)
      veil: uniform(0.9),                         // 0..1 — ile tła zasłania pył
      sunLevel: uniform(1),                       // słońce przy kamerze (transmitancja)
      sunDir: uniform(new THREE.Vector2(1, 0)),   // kierunek do słońca na ekranie (y w górę)
      dark: uniform(new THREE.Vector3(0.0042, 0.0048, 0.0062)),
      lit: uniform(new THREE.Vector3(0.019, 0.02, 0.023)),
      glow: uniform(new THREE.Vector3(0.03, 0.03, 0.031)),
      starGain: uniform(1)
    };
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
      const px = screenCoordinate.xy.add(U.offset).toVar();
      // Gwiazdy: komórki 7 px, gwiazda w części komórek, gauss pod piksel.
      const cellSize = 7.0;
      const cell = floor(px.div(cellSize)).toVar();
      const s = cell.x.add(cell.y.mul(4099.0)).add(1.0e6).toUint().toVar();
      const h1 = hash(s);
      const h2 = hash(s.bitXor(uint(0x68E31DA4)));
      const h3 = hash(s.bitXor(uint(0xB5297A4D)));
      const h4 = hash(s.bitXor(uint(0x1B56C4E9)));
      const starPos = cell.add(vec2(h2, h3).mul(0.8).add(0.1)).mul(cellSize);
      const d = px.sub(starPos);
      const r2 = dot(d, d);
      const bright = smoothstep(0.93, 1.0, h1).mul(h1.mul(h1).mul(h1)).toVar();
      const tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.86, 0.7), h4);
      const star = tint.mul(bright).mul(exp(r2.mul(-0.9)).mul(1.4).add(exp(r2.mul(-0.12)).mul(0.08)));
      // Mgławica: ciemna, chłodna, wolno zmienna.
      const q = px.div(900.0);
      const neb = mx_fractal_noise_float(vec3(q, 0.37), 4, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
      const neb2 = mx_fractal_noise_float(vec3(q.mul(2.3).add(5.1), 1.7), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
      const nebula = vec3(0.012, 0.013, 0.02).mul(smoothstep(0.35, 0.8, neb)).add(vec3(0.006, 0.004, 0.009).mul(smoothstep(0.45, 0.9, neb2)));
      const space = star.mul(U.starGain).add(nebula).toVar();
      // Zasłona pyłu gęstego pola.
      const uvc = screenCoordinate.xy.div(screenSize).sub(0.5).mul(vec2(1.0, -1.0));
      const cloud = smoothstep(0.35, 0.75, mx_fractal_noise_float(vec3(px.div(1400.0), 2.9), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5)).toVar();
      const veilCol = mix(U.dark, U.lit, cloud.mul(0.8)).mul(U.sunLevel).toVar();
      const side = clamp(dot(uvc, U.sunDir).mul(1.4).add(0.5), 0.0, 1.0);
      veilCol.addAssign(U.glow.mul(side.mul(side).mul(float(3.0).sub(side.mul(2.0)))).mul(U.sunLevel).mul(cloud.mul(0.4).add(0.6)));
      const a = U.veil.mul(mix(mix(0.9, 0.99, cloud), 1.0, float(1.0).sub(U.sunLevel)));
      return vec4(max(mix(space, veilCol, a), vec3(0.0)), 1.0);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.mesh.name = 'sky';
    scene.add(this.mesh);
  }
}
