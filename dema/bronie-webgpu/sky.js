// dema/bronie-webgpu/sky.js
//
// Tło dema: ciemne niebo z gwiazdami (siatka komórek w ekranie z paralaksą
// 2% ruchu kamery) i słabą mgławicą z tekstury szumu. Celowo przygaszone —
// efekty broni mają być najjaśniejsze w kadrze.

import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, uniform, uv, texture, floor, fract, hash, uint, exp, dot, smoothstep, sin, max, positionGeometry } from 'three/tsl';

export class Sky {
  constructor({ scene, noise }) {
    this.U = {
      cam: uniform(new THREE.Vector2()),
      view: uniform(new THREE.Vector2(1920, 1080)),
      zoom: uniform(1),
      time: uniform(0),
      level: uniform(1)
    };
    const U = this.U;
    const mat = new THREE.NodeMaterial();
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.lights = false;
    mat.fog = false;
    // Kwad na cały kadr: pozycja z kamery (scena), rozmiar = kadr w j. świata.
    mat.positionNode = Fn(() => {
      const half = U.view.div(U.zoom).mul(0.5);
      return vec3(U.cam.add(positionGeometry.xy.mul(half.mul(2.0))), -200.0);
    })();
    mat.fragmentNode = Fn(() => {
      const px = uv().sub(0.5).mul(U.view).add(U.cam.mul(U.zoom).mul(0.02)).toVar();
      const star = float(0.0).toVar();
      // dwie warstwy gwiazd: rzadkie jasne i gęste słabe
      for (const [cell, dens, bright] of [[46, 0.12, 1.6], [17, 0.35, 0.35]]) {
        const c = floor(px.div(cell));
        const f = fract(px.div(cell)).sub(0.5);
        const h = hash(uint(c.x.add(4096.0)).mul(uint(8191)).add(uint(c.y.add(4096.0))));
        const h2 = hash(uint(c.x.add(911.0)).mul(uint(7919)).add(uint(c.y.add(373.0))));
        const off = vec2(h2, h.mul(1.7).fract()).sub(0.5).mul(0.7);
        const r2 = dot(f.sub(off), f.sub(off)).mul(cell * cell);
        const on = smoothstep(1.0 - dens, 1.0, h);
        const tw = sin(U.time.mul(h2.mul(3.0).add(1.0)).add(h.mul(40.0))).mul(0.25).add(0.75);
        star.addAssign(exp(r2.mul(-0.9)).mul(on).mul(bright).mul(tw));
      }
      const nq = px.div(2600.0);
      const neb = texture(this.noiseTex, nq).a.mul(texture(this.noiseTex, nq.mul(3.1).add(0.37)).r);
      const nebCol = vec3(0.016, 0.014, 0.024).mul(neb).add(vec3(0.006, 0.009, 0.016).mul(texture(this.noiseTex, nq.mul(0.6)).g));
      const col = vec3(0.002, 0.0025, 0.004).add(nebCol).add(vec3(0.7, 0.75, 0.85).mul(star));
      return vec4(max(col.mul(U.level), vec3(0.0)), 1.0);
    })();
    this.noiseTex = noise;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.mesh.name = 'sky';
    scene.add(this.mesh);
  }

  update(camX, camY, zoom, W, H, time) {
    this.U.cam.value.set(camX, camY);
    this.U.zoom.value = zoom;
    this.U.view.value.set(W, H);
    this.U.time.value = time;
  }
}
