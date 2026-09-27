// dema/asteroidy-webgpu/sky.js
//
// Tło passa tła: gwiazdy i mgławica (proceduralnie, w przestrzeni ekranu
// z bardzo wolną paralaksą), przykryte zasłoną pyłu gęstego pola jak
// w src/3d/beltDust3D.js. Pełnoekranowy kwad bez testu głębi, rysowany pierwszy.
//
// NOC W POLU (demo WebGPU): w rdzeniu pola galaktyki prawie nie widać, ale
// ciemność nie jest płaska — zasłona ma wielkie, ledwo widoczne kłęby, od
// strony słońca świeci przesiane przez pole światło (łuna ~√T: nawet w głębi
// zostaje ślad kierunku), przez rzadkie prześwity mrugają pojedyncze gwiazdy,
// a błyski burzy głęboko pod płaszczyzną rozświetlają chmury od środka
// (do 4 błysków — pozycje ekranu z storm.js).

import * as THREE from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, uniform, uniformArray, screenCoordinate, screenSize, floor, dot,
  mix, smoothstep, clamp, max, exp, sqrt, hash, mx_fractal_noise_float, attribute, length
} from 'three/tsl';

export const SKY_FLASH_CAP = 4;

export class Sky {
  constructor(scene) {
    this.u = {
      offset: uniform(new THREE.Vector2()),      // przesunięcie gwiazd [px] (paralaksa)
      veil: uniform(0.9),                         // 0..1 — ile tła zasłania pył
      sunLevel: uniform(1),                       // słońce przy kamerze (transmitancja)
      sunDir: uniform(new THREE.Vector2(1, 0)),   // kierunek do słońca na ekranie (y w górę)
      dark: uniform(new THREE.Vector3(0.0036, 0.0042, 0.0058)),
      lit: uniform(new THREE.Vector3(0.019, 0.02, 0.023)),
      glow: uniform(new THREE.Vector3(0.03, 0.03, 0.031)),
      night: uniform(new THREE.Vector3(0.006, 0.0075, 0.012)),   // łuna przesiana przez pole
      ice: uniform(0),                            // udział lodu (Kuiper: zasłona chłodniejsza)
      starGain: uniform(1),
      // Błyski burzy: xy = piksel ekranu (y w dół), z = promień [px], w = jasność.
      flashes: uniformArray(Array.from({ length: SKY_FLASH_CAP }, () => new THREE.Vector4()), 'vec4'),
      flashColor: uniform(new THREE.Vector3(0.5, 0.42, 1.0))
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
      // Rzadkie gwiazdy (~1,2% komórek), większość słaba, pojedyncze jasne.
      const bright = smoothstep(0.988, 1.0, h1).mul(h4.mul(h4).mul(0.85).add(0.15)).mul(0.9).toVar();
      const tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.86, 0.7), h4);
      const star = tint.mul(bright).mul(exp(r2.mul(-0.9)).mul(1.4).add(exp(r2.mul(-0.12)).mul(0.08)));
      // Mgławica: chłodne pasma (granat, fiolet, turkus), ciemne włókna pyłu.
      const q = px.div(900.0);
      const neb = mx_fractal_noise_float(vec3(q, 0.37), 4, 2.0, 0.5, 1.0).mul(0.5).add(0.5).toVar();
      const neb2 = mx_fractal_noise_float(vec3(q.mul(2.3).add(5.1), 1.7), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5).toVar();
      const neb3 = mx_fractal_noise_float(vec3(q.mul(0.45).add(11.3), 3.1), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5).toVar();
      const band = smoothstep(0.38, 0.82, neb);
      const nebula = vec3(0.010, 0.014, 0.032).mul(band)
        .add(vec3(0.012, 0.006, 0.02).mul(smoothstep(0.5, 0.9, neb2)))
        .add(vec3(0.004, 0.016, 0.022).mul(smoothstep(0.55, 0.85, neb3)).mul(band))
        .mul(float(1.0).sub(smoothstep(0.55, 0.8, neb2.mul(0.6).add(neb3.mul(0.5))).mul(0.6)))
        .toVar();
      const space = star.mul(U.starGain).add(nebula).toVar();
      // Zasłona pyłu gęstego pola.
      const uvc = screenCoordinate.xy.div(screenSize).sub(0.5).mul(vec2(1.0, -1.0));
      const cloud = smoothstep(0.35, 0.75, mx_fractal_noise_float(vec3(px.div(1400.0), 2.9), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5)).toVar();
      const big = mx_fractal_noise_float(vec3(px.div(3600.0), 7.3), 2, 2.0, 0.5, 1.0).mul(0.5).add(0.5).toVar();
      const coolTint = mix(vec3(1.0), vec3(0.8, 0.95, 1.25), U.ice);
      const veilCol = mix(U.dark, U.lit, cloud.mul(0.8)).mul(U.sunLevel).mul(coolTint).toVar();
      const side = clamp(dot(uvc, U.sunDir).mul(1.4).add(0.5), 0.0, 1.0).toVar();
      const sideS = side.mul(side).mul(float(3.0).sub(side.mul(2.0))).toVar();
      veilCol.addAssign(U.glow.mul(sideS).mul(U.sunLevel).mul(cloud.mul(0.4).add(0.6)).mul(coolTint));
      // Noc: łuna ~√T od strony słońca, kłęby z dużej skali (ciemność ma głębię).
      const nightK = sqrt(max(U.sunLevel, 0.0)).mul(float(1.0).sub(U.sunLevel)).toVar();
      veilCol.addAssign(U.night.mul(coolTint).mul(nightK).mul(sideS.mul(1.6).add(0.25)).mul(cloud.mul(0.7).add(big.mul(0.6)).add(0.15)));
      // Błyski burzy pod płaszczyzną: chmury rozświetlone od środka.
      const flash = vec3(0.0).toVar();
      for (let i = 0; i < SKY_FLASH_CAP; i++) {
        const f = U.flashes.element(i);
        const dd = length(screenCoordinate.xy.sub(f.xy)).div(max(f.z, 1.0));
        flash.addAssign(U.flashColor.mul(f.w).mul(exp(dd.mul(dd).mul(-2.2))));
      }
      veilCol.addAssign(flash.mul(cloud.mul(0.8).add(big.mul(0.5)).add(0.1)).mul(0.06));
      const a = U.veil.mul(mix(mix(0.9, 0.99, cloud), 1.0, float(1.0).sub(U.sunLevel)));
      // Prześwity: w najrzadszych miejscach zasłony mrugają pojedyncze gwiazdy —
      // w rdzeniu pola (słońce przy kamerze < 0,1) gasną prawie do zera.
      const gap = smoothstep(0.78, 0.95, float(1.0).sub(cloud).mul(0.6).add(big.mul(-0.4).add(0.4)));
      const deep = smoothstep(0.0, 0.1, U.sunLevel).mul(0.9).add(0.1);
      const through = star.mul(U.starGain).mul(gap).mul(0.12).mul(U.veil).mul(deep);
      return vec4(max(mix(space, veilCol, a).add(through), vec3(0.0)), 1.0);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.mesh.name = 'sky';
    scene.add(this.mesh);
  }

  /** Błyski burzy: lista { sx, sy [px ekranu], r [px], e } (max SKY_FLASH_CAP). */
  setFlashes(list) {
    const A = this.u.flashes.array;
    for (let i = 0; i < SKY_FLASH_CAP; i++) {
      const f = list[i];
      if (f) A[i].set(f.sx, f.sy, f.r, f.e);
      else A[i].set(0, 0, 1, 0);
    }
  }
}
