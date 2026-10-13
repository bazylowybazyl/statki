// E0: dolna granica kosztu siatki. Puste równania, rzeczywiste odczyty/zapisy docelowych tekstur.
// AGENT: wynik E0 nie jest kosztem gotowego solvera; E1 mierzy wszystkie rzeczywiste kernele osobno.
import * as THREE from 'three/webgpu';
import { Fn, If, Return, instanceIndex, uint, float, vec3, vec4, uvec3, uniform,
  texture3D, textureStore, clamp } from 'three/tsl';
import { hallGasDomain } from './hallGasLayout.js';

export function hallGasTexture(d, name) {
  const t = new THREE.Storage3DTexture(d.nx, d.ny, d.nz);
  t.name = name; t.type = THREE.HalfFloatType; t.format = THREE.RGBAFormat;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class HallGasBenchmark {
  constructor(h = 48) {
    this.domain = hallGasDomain(h);
    const d = this.domain;
    this.active = uniform(0);
    this.textures = Array.from({ length: 10 }, (_, i) => hallGasTexture(d, `HallGas:E0:${i}`));
    const at = (t, p) => texture3D(t, clamp(p, vec3(0.5), vec3(d.nx - 0.5, d.ny - 0.5, d.nz - 0.5))
      .div(vec3(d.nx, d.ny, d.nz))).level(0);
    const cell = () => {
      If(this.active.lessThan(0.5), () => { Return(); });
      If(instanceIndex.greaterThanEqual(uint(d.cells)), () => { Return(); });
      const q = uvec3(instanceIndex.mod(uint(d.nx)), instanceIndex.div(uint(d.nx)).mod(uint(d.ny)),
        instanceIndex.div(uint(d.nx * d.ny))).toVar();
      return { q, p: vec3(q).add(0.5).toVar() };
    };
    const [va, vb, da, db, pa, pb] = this.textures;
    this.advect = Fn(() => {
      const c = cell();
      textureStore(vb, c.q, at(va, c.p)); textureStore(db, c.q, at(da, c.p));
    })().compute(d.cells).setName('HallGas:E0:adwekcja');
    const jac = (a, b) => Fn(() => {
      const c = cell();
      let sum = float(0);
      for (const v of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])
        sum = sum.add(at(a, c.p.add(vec3(...v))).x);
      textureStore(b, c.q, vec4(sum.div(6), 0, 0, 0));
    })().compute(d.cells).setName('HallGas:E0:Jacobi');
    this.ab = jac(pa, pb); this.ba = jac(pb, pa);
    this.list = [this.advect];
    for (let i = 0; i < 30; i++) this.list.push(i % 2 ? this.ba : this.ab);
    this.warmList = [this.advect, this.ab, this.ba];
  }
  warm(renderer) { this.active.value = 0; renderer.compute(this.warmList); }
  step(renderer) { this.active.value = 1; renderer.compute(this.list); }
  dispose() { for (const t of this.textures) t.dispose(); }
  get memoryBytes() { return this.domain.cells * 8 * this.textures.length; }
}
