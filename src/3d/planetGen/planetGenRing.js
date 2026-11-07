// src/3d/planetGen/planetGenRing.js
//
// Pierścienie olbrzymów generatora (opcjonalne — `spec.look.ring`): profil promieniowy z ziarna (gęstość z pierścieni
// i przerw, barwa w dwóch tonach) pieczony na CPU do tekstury 1024 × 1 (4 kB), płaska siatka w płaszczyźnie równika
// (biegun N = +Y) i materiał TSL: światło od strony słońca słabnie przy słońcu w płaszczyźnie pierścieni, cień planety
// analitycznie (promień ku słońcu przecina kulę), przezroczysty bez zapisu głębi, jeden rysunek (forceSinglePass).
// Graf RAZ (wartości per pierścień w `material.uniforms`, tekstura per obiekt). Cień pierścieni na tarczy — poza
// zakresem (graf powierzchni gry go nie ma).
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, positionLocal, modelWorldMatrixInverse, texture,
  abs, clamp, dot, length, max, min, mix, normalize, smoothstep, sqrt, step, Discard
} from 'three/tsl';
import { makeRng } from './planetGenRng.js';

export const RING_PROFILE_TEXELS = 1024;

/** Profil pierścieni: Uint8Array RGBA (sRGB) RING_PROFILE_TEXELS × 1, od `inner` do `outer`. */
export function bakeRingProfile(ring) {
  const rng = makeRng(ring.seed >>> 0);
  const N = RING_PROFILE_TEXELS;
  const dens = new Float32Array(N);
  // pierścienie główne: 2–4 strefy o różnej gęstości
  const zones = [];
  const nz = rng.int(2, 4);
  let x = 0;
  for (let i = 0; i < nz; i++) {
    const w = (1 - x) * (i === nz - 1 ? 1 : rng.range(0.25, 0.6));
    zones.push({ a: x, b: x + w, d: rng.range(0.25, 1.0) });
    x += w;
  }
  // drobne pierścionki: suma sinusów o niewspółmiernych okresach
  const waves = Array.from({ length: 7 }, () => ({ f: rng.range(30, 420), p: rng.range(0, 6.283), a: rng.range(0.04, 0.16) }));
  const gaps = Array.from({ length: ring.gaps }, () => ({ c: rng.range(0.15, 0.9), w: rng.range(0.006, 0.03) }));
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    let d = 0;
    for (const z of zones) if (t >= z.a && t < z.b) d = z.d * (0.8 + 0.2 * Math.sin((t - z.a) / (z.b - z.a) * Math.PI));
    for (const w of waves) d *= 1 + w.a * Math.sin(t * w.f + w.p);
    for (const g of gaps) d *= Math.min(1, Math.abs(t - g.c) / g.w) ** 2;
    d *= Math.min(1, t / 0.03) * Math.min(1, (1 - t) / 0.02);
    dens[i] = Math.max(0, Math.min(1, d));
  }
  const tone2 = ring.color.map((v, k) => v * (0.75 + 0.2 * rng.next() + (k === 2 ? -0.08 : 0.04)));
  const out = new Uint8Array(N * 4);
  const enc = (v) => Math.round(255 * Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    const k = 0.5 + 0.5 * Math.sin(t * 9.0 + 1.3);
    out[i * 4] = enc(ring.color[0] * (1 - k) + tone2[0] * k);
    out[i * 4 + 1] = enc(ring.color[1] * (1 - k) + tone2[1] * k);
    out[i * 4 + 2] = enc(ring.color[2] * (1 - k) + tone2[2] * k);
    out[i * 4 + 3] = Math.round(255 * dens[i]);
  }
  return out;
}

class RingObjectTextureNode extends THREE.TextureNode {
  static get type() { return 'PlanetGenRingTextureNode'; }
  get updateType() { return THREE.NodeUpdateType.OBJECT; }
  set updateType(_v) { /* stałe OBJECT */ }
  update(frame) {
    const v = frame.material?.uniforms?.ringTexture?.value;
    this.value = (v && v.isTexture) ? v : this.fallback;
  }
  clone() { const n = super.clone(); n.fallback = this.fallback; return n; }
}

let GRAPH = null;
function ringGraph() {
  if (GRAPH) return GRAPH;
  const per = (key, init, type) => uniform(init, type).onObjectUpdate(({ material }) => material.uniforms[key].value);
  const U = {
    sunPosition: per('sunPosition', new THREE.Vector3(), 'vec3'),
    uRing: per('uRing', new THREE.Vector4(), 'vec4')     // x — wewnętrzny, y — zewnętrzny [R], z — krycie, w — jasność
  };
  const fb = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  fb.needsUpdate = true;
  const tex = new RingObjectTextureNode(fb, vec2(0.5, 0.5));
  tex.fallback = fb;
  const node = Fn(() => {
    const p = positionLocal.xy;
    const r = length(p).toVar();
    const t = clamp(r.sub(U.uRing.x).div(U.uRing.y.sub(U.uRing.x)), 0.0, 1.0);
    const prof = texture(tex, vec2(t, 0.5)).toVar();
    // światło: kierunek słońca w układzie siatki (płaszczyzna pierścieni = XY siatki, normalna Z)
    const L = normalize(modelWorldMatrixInverse.mul(vec4(U.sunPosition, 1.0)).xyz.sub(vec3(p, 0.0))).toVar();
    const elev = abs(L.z);
    const lit = smoothstep(0.0, 0.25, elev).mul(0.85).add(0.15);
    // cień planety (kula R = 1 w środku): promień p + s·L, s > 0
    const P = vec3(p, 0.0);
    const b = dot(P, L);
    const c = dot(P, P).sub(1.0);
    const disc = b.mul(b).sub(c);
    const hitS = b.negate().sub(sqrt(max(disc, 0.0)));
    const shadow = step(0.0, disc).mul(step(0.0, hitS));
    const light = lit.mul(float(1.0).sub(shadow.mul(0.92)));
    const a = prof.a.mul(U.uRing.z).toVar();
    Discard(a.lessThan(0.004));
    return vec4(prof.rgb.mul(light).mul(U.uRing.w), a);
  })();
  GRAPH = { node, tex };
  return GRAPH;
}

/** Siatka pierścieni dla opisu olbrzyma; `sunPosition` — węzeł { value } wspólny z powierzchnią planety. */
export function createGenRingMesh(spec, sunPosition) {
  const ring = spec.look.ring;
  const g = ringGraph();
  const data = bakeRingProfile(ring);
  const tex = new THREE.DataTexture(data, RING_PROFILE_TEXELS, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const material = new THREE.NodeMaterial();
  material.name = 'PlanetGenRing';
  material.fragmentNode = g.node;
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.forceSinglePass = true;
  material.lights = false;
  material.uniforms = {
    sunPosition, ringTexture: { value: tex },
    uRing: { value: new THREE.Vector4(ring.inner, ring.outer, ring.opacity, 1.0) }
  };
  const geo = new THREE.RingGeometry(ring.inner, ring.outer, 256, 1);
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = -Math.PI / 2;    // płaszczyzna XY siatki → równik (XZ), normalna → +Y
  mesh.renderOrder = 2;
  return {
    mesh, material, texture: tex,
    dispose() { geo.dispose(); material.dispose(); tex.dispose(); }
  };
}
