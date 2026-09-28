// dema/warp-webgpu/stars.js
//
// Gwiazdy jak w grze (StarSystem z src/3d/planet3d.assets.js): pole zawijane
// 220 tys. j., trzy warstwy paralaksy (starParallax.js: głęboka / środkowa /
// „prędkości”), te same barwy i proporcje warstw. Rysowane kwadami o stałym
// rozmiarze w pikselach (jak gl_PointSize) w passie planet (kamera ortho
// w pikselach ekranu) — pierwsze, więc tarcze planet je zasłaniają.
// Wyjście z warpa (user 2026-09-27: „jak w Star Wars”): smugi wracają do
// punktów w ułamku sekundy.
//
// Warp (decyzje usera z BRIEF-warp.md): smugi PŁASKIE, równoległe do kursu,
// ogonem do tyłu, rosną już przy ładowaniu; bez tunelu 3D i bez gięcia przez
// bańkę. Wyjście: FRONT rzeczywistości idzie od dziobu ku rufie — gwiazdy
// przed nim wracają do punktów pierwsze.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, attribute, floor, sin, exp, sqrt, max, mix, clamp,
  smoothstep, positionGeometry, varyingProperty
} from 'three/tsl';
import { STAR_PARALLAX_LAYERS, pickStarParallaxLayer, computeStarParallaxFactor } from '../../src/3d/starParallax.js';

export const STAR_WRAP = 220000;
const STAR_COUNT = 26000;

/** Deterministyczny generator (mulberry32) — ten sam układ gwiazd przy każdym starcie. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WarpStars {
  constructor(scene) {
    const n = STAR_COUNT;
    const r = rng(20260927);
    const A = new Float32Array(n * 4);
    const B = new Float32Array(n * 4);
    const C = new Float32Array(n * 4);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const layer = pickStarParallaxLayer(r());
      const o = i * 4;
      A[o] = (r() - 0.5) * STAR_WRAP;
      A[o + 1] = (r() - 0.5) * STAR_WRAP;
      A[o + 2] = computeStarParallaxFactor(layer, r());
      A[o + 3] = (0.75 + Math.pow(r(), 3) * 3.2) * layer.sizeMul;
      const c = r();
      col.setHex(c > 0.82 ? 0x8fb7ff : c > 0.58 ? 0xdbe8ff : c > 0.22 ? 0xffffff : 0xb8d4ff);
      B[o] = col.r; B[o + 1] = col.g; B[o + 2] = col.b;
      B[o + 3] = (0.34 + r() * 0.56) * layer.brightnessMul;
      C[o] = layer.stretchMul;
      C[o + 1] = r() * 6.283;
      C[o + 2] = 0;
      C[o + 3] = 0;
    }
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    geo.setAttribute('sA', new THREE.InstancedBufferAttribute(A, 4));
    geo.setAttribute('sB', new THREE.InstancedBufferAttribute(B, 4));
    geo.setAttribute('sC', new THREE.InstancedBufferAttribute(C, 4));
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    this.u = {
      cam: uniform(new THREE.Vector2()),          // kamera gwiazd (świat, scena)
      zoomComp: uniform(1),
      zoom: uniform(0.1),
      shakePx: uniform(new THREE.Vector2()),       // wstrząs kamery [px, y w górę]
      viewHalfPx: uniform(new THREE.Vector2(960, 540)),
      heading: uniform(new THREE.Vector2(1, 0)),  // kurs na ekranie (px, y w górę)
      stretch: uniform(0),                         // 0..1 (ładowanie → skok), > 1 = przestrzał przy skoku
      stretchPx: uniform(74),
      frontOn: uniform(0),                         // front wyjścia aktywny
      frontPx: uniform(0),                         // położenie frontu wzdłuż kursu od statku [px]
      shipPx: uniform(new THREE.Vector2()),        // statek na ekranie [px od środka]
      bright: uniform(1),
      warpTint: uniform(0),
      time: uniform(0)
    };
    const U = this.u;
    const sA = attribute('sA', 'vec4');
    const sB = attribute('sB', 'vec4');
    const sC = attribute('sC', 'vec4');
    const vCol = varyingProperty('vec3', 'vStarCol');
    const vAlong = varyingProperty('float', 'vStarAlong');
    const vSide = varyingProperty('float', 'vStarSide');
    const vLen = varyingProperty('float', 'vStarLen');
    const vW = varyingProperty('float', 'vStarW');

    const mat = new THREE.NodeMaterial();
    // Lista NIEPRZEZROCZYSTA (mieszanie addytywne i tak działa): renderOrder
    // −200 stawia gwiazdy przed tarczami planet — z listą przezroczystych
    // rysowałyby się po nich (depthTest wyłączony).
    mat.transparent = false;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;

    mat.vertexNode = Fn(() => {
      // Pozycja względem kamery gwiazd tej warstwy, zawinięta w pole.
      const off = sA.xy.sub(U.cam.mul(sA.z)).toVar();
      const rel = off.sub(floor(off.div(STAR_WRAP).add(0.5)).mul(STAR_WRAP)).mul(U.zoomComp);
      const s0 = rel.mul(U.zoom).sub(U.shakePx).toVar();
      // Front wyjścia: gwiazdy przed nim (wzdłuż kursu) już w rzeczywistości.
      const s = s0.sub(U.shipPx).dot(U.heading);
      const real = U.frontOn.mul(smoothstep(U.frontPx.sub(60.0), U.frontPx.add(60.0), s));
      const st = U.stretch.mul(float(1.0).sub(real)).toVar();
      const size = sA.w.mul(float(1.0).add(st.mul(0.25))).toVar();
      const L = st.mul(U.stretchPx).mul(sC.x).toVar();
      const dir = U.heading.negate();
      const perp = vec2(dir.y.negate(), dir.x);
      const w = max(size.mul(0.62), 0.55).toVar();
      const g = positionGeometry.xy;
      const alongPx = g.x.add(0.5).mul(L.add(w.mul(2.0))).sub(w);
      const side = g.y.mul(2.0).mul(w);
      const pix = s0.add(dir.mul(alongPx)).add(perp.mul(side));
      const tw = sin(U.time.mul(3.0).add(sC.y)).mul(0.09).add(0.91);
      // W skoku barwa bieleje/błękitnieje, jasność rośnie — energia rozłożona na smugę.
      const tint = mix(sB.rgb, vec3(0.72, 0.86, 1.0), clamp(st.mul(U.warpTint).mul(0.75), 0.0, 1.0));
      const energy = float(1.0).add(st.mul(0.9)).div(sqrt(float(1.0).add(L.div(max(w.mul(3.0), 1.0)).mul(0.35))));
      vCol.assign(tint.mul(sB.w).mul(tw).mul(U.bright).mul(energy).mul(1.15));
      vAlong.assign(alongPx);
      vSide.assign(side);
      vLen.assign(L);
      vW.assign(w);
      return vec4(pix.div(U.viewHalfPx), 0.5, 1.0);
    })();

    mat.fragmentNode = Fn(() => {
      const da = max(max(vAlong.negate(), vAlong.sub(vLen)), 0.0);
      const d2 = da.mul(da).add(vSide.mul(vSide)).div(vW.mul(vW));
      const prof = exp(d2.mul(-2.6));
      const taper = mix(float(1.0), float(0.08), clamp(vAlong.div(max(vLen, 1.0)), 0.0, 1.0));
      return vec4(vCol.mul(prof).mul(taper), 0.0);
    })();

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -200;
    this.mesh.name = 'warpStars';
    scene.add(this.mesh);
    this.layers = STAR_PARALLAX_LAYERS;
  }
}
