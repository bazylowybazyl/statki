// dema/asteroidy-webgpu/giants.js
//
// Olbrzymie asteroidy (tunele, szczeliny, jaskinie) — port
// src/3d/rocks/giantRock3D.js na three/webgpu. Siatka SDF liczona w workerach
// (GiantBuilder z src/game/asteroidGiantBuilder.js — ta sama tablica służy
// kolizjom i testowi stropu), tu:
//   • tekstura 3D R8 z tą samą tablicą (wąskie pasmo ±BAND_VOXELS wokseli,
//     128 = powierzchnia);
//   • pieczenie światła w COMPUTE do tekstury storage 3D RGBA8: R widoczność
//     słońca (miękki cień przez bryłę), G AO, B poświata złóż, A barwa złoża;
//   • raymarching w passie gry (ortho z góry): marsz pionowy po SDF, głębia
//     z punktu trafienia (kadłuby chowają się pod stropem), PRZEKRÓJ — okno
//     wokół statku pod stropem (ciemna płaszczyzna cięcia z obwódką ścian);
//   • światło: słońce wypieczone × przesłanianie pola, otoczenie gaśnie
//     w tunelach, WSZYSTKIE światła siatki (reflektory statku w jaskini, pioruny,
//     wybuchy), światło wolumetryczne nad powierzchnią.
//
// Marsz promienia to wspólny węzeł głębi i koloru: three buduje zapis głębi
// PRZED fragmentem (NodeMaterial.setupDepth), więc wynik marszu jest zmienną
// liczoną raz w depthNode i czytaną przez fragmentNode.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, vec2, vec3, vec4, uniform, uniformArray, instanceIndex, textureStore, texture3D,
  positionWorld, cameraProjectionMatrix, cameraViewMatrix, Loop, If, Break, Return, Discard, select,
  mix, smoothstep, clamp, exp, max, min, pow, sin, atan, dot, normalize, length, step, dFdx, dFdy,
  cross, sign, abs, uint
} from 'three/tsl';
import { BAND_VOXELS } from '../../src/game/asteroidGiants.js';

const DEPOSIT_CAP = 16;
const CRATER_CAP = 64;

export const GIANT_LOOK = Object.freeze({
  rockA: [0.1, 0.102, 0.106],
  rockB: [0.034, 0.035, 0.038],
  cap: [0.016, 0.015, 0.014]
});

export class GiantView {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Scene} o.scene pass gry
   * @param {import('../../src/game/asteroidGiants.js').GiantRock} o.giant gotowa siatka
   * @param {THREE.Texture} o.noise objętość szumu skał (rockNoise.js)
   * @param {object} o.shared uniformy skał (słońce, otoczenie, S.volume)
   * @param {import('./lights.js').LightGrid} o.grid
   * @param {{x:number,y:number}} o.sun
   */
  constructor(o) {
    this.renderer = o.renderer;
    this.giant = o.giant;
    this.S = o.shared;
    this.grid = o.grid;
    const { nx, ny, nz, ext } = this.giant.dims;
    const v = this.giant.plan.voxel;
    this.sdfTexture = new THREE.Data3DTexture(this.giant.grid, nx, ny, nz);
    this.sdfTexture.format = THREE.RedFormat;
    this.sdfTexture.type = THREE.UnsignedByteType;
    this.sdfTexture.minFilter = THREE.LinearFilter;
    this.sdfTexture.magFilter = THREE.LinearFilter;
    this.sdfTexture.wrapS = this.sdfTexture.wrapT = this.sdfTexture.wrapR = THREE.ClampToEdgeWrapping;
    this.sdfTexture.unpackAlignment = 1;
    this.sdfTexture.generateMipmaps = false;
    this.sdfTexture.colorSpace = THREE.NoColorSpace;
    this.sdfTexture.needsUpdate = true;
    this.lightN = [Math.ceil(nx / 2), Math.ceil(ny / 2), Math.ceil(nz / 2)];
    this.lightTexture = new THREE.Storage3DTexture(this.lightN[0], this.lightN[1], this.lightN[2]);
    this.lightTexture.name = `giantLight_${this.giant.plan.id}`;
    this.lightTexture.minFilter = THREE.LinearFilter;
    this.lightTexture.magFilter = THREE.LinearFilter;
    this.lightTexture.wrapS = this.lightTexture.wrapT = this.lightTexture.wrapR = THREE.ClampToEdgeWrapping;
    this.lightTexture.generateMipmaps = false;
    this.lightTexture.colorSpace = THREE.NoColorSpace;
    this.noise = o.noise;
    this.U = {
      ext: uniform(new THREE.Vector3(ext[0], ext[1], ext[2])),
      gridN: uniform(new THREE.Vector3(nx, ny, nz)),
      voxel: uniform(v),
      band: uniform(BAND_VOXELS * v),
      lightN: uniform(new THREE.Vector3(...this.lightN)),
      sunG: uniform(new THREE.Vector3(1, 0, 0)),
      sunS: uniform(new THREE.Vector3(1, 0, 0)),
      depCount: uniform(0, 'int'),
      dep: uniformArray(Array.from({ length: DEPOSIT_CAP }, () => new THREE.Vector4()), 'vec4'),
      depHue: uniformArray(Array.from({ length: DEPOSIT_CAP }, () => new THREE.Vector4()), 'vec4'),
      craterCount: uniform(0, 'int'),
      craters: uniformArray(Array.from({ length: CRATER_CAP }, () => new THREE.Vector4()), 'vec4'),
      cut: uniform(new THREE.Vector4(0, 0, 0, 1)),
      cutZ: uniform(300),
      pxPerUnit: uniform(1),
      rockA: uniform(new THREE.Vector3(...GIANT_LOOK.rockA)),
      rockB: uniform(new THREE.Vector3(...GIANT_LOOK.rockB)),
      capColor: uniform(new THREE.Vector3(...GIANT_LOOK.cap)),
      center: uniform(new THREE.Vector3()),   // środek olbrzyma w scenie
      sunT: uniform(1),                       // przesłanianie słońca przez pole w miejscu olbrzyma
      lightGain: uniform(1)
    };
    const craters = this.giant.plan.craters || [];
    this.U.craterCount.value = Math.min(CRATER_CAP, craters.length);
    craters.slice(0, CRATER_CAP).forEach((c, i) => this.U.craters.array[i].set(c.x, c.y, c.r, c.fresh ?? 0.5));
    this._buildBake();
    this._buildMaterial();
    const sx = nx * v; const sy = ny * v; const sz = nz * v;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const cx = -ext[0] - v / 2 + sx / 2;
    const cy = -ext[1] - v / 2 + sy / 2;
    const cz = -ext[2] - v / 2 + sz / 2;
    geo.translate(cx, -cy, cz);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = `giant_${this.giant.plan.id}`;
    o.scene.add(this.mesh);
    this.cut = { open: 0, x: 0, y: 0, radius: 0, soft: 0, z: 300 };
    this.sunElevDeg = o.sunElevDeg ?? 24;
    this.bake(o.sun || { x: 0, y: 0 });
  }

  // --- SDF (TSL) -------------------------------------------------------------

  _uvw(g) {
    const U = this.U;
    return g.add(U.ext).add(U.voxel.mul(0.5)).div(U.gridN.mul(U.voxel));
  }

  _sdf(g) {
    const U = this.U;
    const uvw = this._uvw(g).toVar();
    const out = uvw.x.lessThan(0.0).or(uvw.y.lessThan(0.0)).or(uvw.z.lessThan(0.0))
      .or(uvw.x.greaterThan(1.0)).or(uvw.y.greaterThan(1.0)).or(uvw.z.greaterThan(1.0));
    const d = texture3D(this.sdfTexture, uvw).level(0).r.mul(255.0).sub(128.0).mul(U.band.div(127.0));
    return select(out, U.band, d);
  }

  _normal(g, e) {
    const n = vec3(
      this._sdf(g.add(vec3(e, 0, 0))).sub(this._sdf(g.sub(vec3(e, 0, 0)))),
      this._sdf(g.add(vec3(0, e, 0))).sub(this._sdf(g.sub(vec3(0, e, 0)))),
      this._sdf(g.add(vec3(0, 0, e))).sub(this._sdf(g.sub(vec3(0, 0, e))))
    ).toVar();
    const l = length(n);
    return select(l.greaterThan(1e-6), n.div(l), vec3(0, 0, 1));
  }

  // --- Pieczenie światła (compute) --------------------------------------------

  _buildBake() {
    const U = this.U;
    const [lx, ly, lz] = this.lightN;
    this.bakeNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(uint(lx * ly * lz)), () => { Return(); });
      const ix = instanceIndex.mod(uint(lx));
      const iy = instanceIndex.div(uint(lx)).mod(uint(ly));
      const iz = instanceIndex.div(uint(lx * ly));
      const uvw = vec3(float(ix).add(0.5), float(iy).add(0.5), float(iz).add(0.5)).div(U.lightN);
      const g0 = uvw.mul(U.gridN).mul(U.voxel).sub(U.ext).sub(U.voxel.mul(0.5)).toVar();
      const n = this._normal(g0, U.voxel).toVar();
      // Teksel rzutowany na najbliższą powierzchnię (teksel w skale liczyłby cień ze środka skały).
      const g = g0.sub(n.mul(this._sdf(g0))).toVar();
      // Miękki cień słońca: marsz po SDF od punktu nad powierzchnią w stronę słońca.
      const vis = float(1.0).toVar();
      const t = U.voxel.mul(1.5).toVar();
      const o = g.add(n.mul(U.voxel.mul(0.75))).toVar();
      Loop({ start: 0, end: 48, type: 'int', condition: '<', name: 'si' }, () => {
        const q = o.add(U.sunG.mul(t)).toVar();
        const h = this._sdf(q).toVar();
        // SDF obcięte do ±pasma: kara półcienia tylko przy geometrii.
        If(h.lessThan(U.band.mul(0.95)), () => { vis.assign(min(vis, h.mul(12.0).div(t))); });
        If(vis.lessThan(0.01), () => { Break(); });
        t.addAssign(clamp(h, U.voxel.mul(0.6), U.voxel.mul(6.0)));
        If(t.greaterThan(U.voxel.mul(260.0)).or(q.z.greaterThan(U.ext.z)), () => { Break(); });
      });
      vis.assign(clamp(vis, 0.0, 1.0));
      // AO: próbki wzdłuż normalnej na rosnących odległościach.
      const occ = float(0.0).toVar();
      let w = 0.5;
      for (let k = 0; k < 5; k++) {
        const dist = U.voxel.mul(1.0 + k * k * 1.2);
        occ.addAssign(clamp(dist.sub(this._sdf(g.add(n.mul(dist)))).div(dist), 0.0, 1.0).mul(w));
        w *= 0.62;
      }
      const ao = clamp(float(1.0).sub(occ.mul(1.15)), 0.0, 1.0);
      // Złoża: poświata w ich pobliżu (barwa w kanale A).
      const glow = float(0.0).toVar();
      const hue = float(0.0).toVar();
      Loop({ start: 0, end: DEPOSIT_CAP, type: 'int', condition: '<', name: 'di' }, ({ di }) => {
        If(di.greaterThanEqual(U.depCount), () => { Break(); });
        const dp = U.dep.element(di);
        const dd = g.sub(dp.xyz);
        const e = exp(dot(dd, dd).div(dp.w.mul(dp.w)).negate()).toVar();
        If(e.greaterThan(glow), () => { hue.assign(U.depHue.element(di).x); });
        glow.assign(max(glow, e));
      });
      textureStore(this.lightTexture, vec3(ix, iy, iz), vec4(vis, ao, glow, hue));
    })().compute(lx * ly * lz).setName('giantLightBake');
  }

  /** Pieczenie światła dla słońca w (sun.x, sun.y) świata gry. */
  bake(sun, sunElevDeg = this.sunElevDeg) {
    this.sunElevDeg = sunElevDeg;
    const dx = sun.x - this.giant.x;
    const dy = sun.y - this.giant.y;
    const l = Math.hypot(dx, dy) || 1;
    const el = sunElevDeg * Math.PI / 180;
    const gx = dx / l * Math.cos(el); const gy = dy / l * Math.cos(el); const gz = Math.sin(el);
    this.U.sunG.value.set(gx, gy, gz);
    this.U.sunS.value.set(gx, -gy, gz);
    const deps = this.giant.plan.deposits || [];
    this.U.depCount.value = Math.min(DEPOSIT_CAP, deps.length);
    for (let i = 0; i < DEPOSIT_CAP; i++) {
      const d = deps[i];
      if (d) {
        this.U.dep.array[i].set(d.x, d.y, d.z, d.r);
        this.U.depHue.array[i].set(d.hue || 0, 0, 0, 0);
      }
    }
    const t0 = performance.now();
    this.renderer.compute(this.bakeNode);
    this.bakeMs = performance.now() - t0;
  }

  // --- Raymarching ---------------------------------------------------------------

  _buildMaterial() {
    const U = this.U;
    const S = this.S;
    const grid = this.grid;
    const toG = (s) => vec3(s.x, s.y.negate(), s.z);
    const mat = new THREE.NodeMaterial();
    mat.lights = false;
    mat.fog = false;
    mat.side = THREE.BackSide;
    mat.depthTest = true;
    mat.depthWrite = true;
    mat.transparent = false;
    // Marsz: x = z trafienia (układ olbrzyma), y = trafienie, z = przekrój.
    const march = Fn(() => {
      const ps = positionWorld.xy.sub(U.center.xy).toVar();
      const gTop = toG(vec3(ps, 0.0)).toVar();
      const zTop = U.ext.z.toVar();
      const zc = float(1e9).toVar();
      If(U.cut.z.greaterThan(1.0), () => {
        const rho = length(ps.sub(U.cut.xy));
        const k = smoothstep(U.cut.z, U.cut.z.add(U.cut.w), rho);
        If(k.lessThan(1.0), () => { zc.assign(mix(U.cutZ, U.ext.z.add(U.voxel.mul(2.0)), k)); });
      });
      const inCut = zc.lessThan(zTop);
      const z = min(zTop, zc).toVar();
      const cap = float(0.0).toVar();
      const hit = float(0.0).toVar();
      If(inCut.and(this._sdf(vec3(gTop.xy, z)).lessThan(0.0)), () => {
        cap.assign(1.0);
        hit.assign(1.0);
      }).Else(() => {
        const zEnd = U.ext.z.negate();
        Loop({ start: 0, end: 112, type: 'int', condition: '<', name: 'mi' }, () => {
          const d = this._sdf(vec3(gTop.xy, z)).toVar();
          If(d.lessThan(U.voxel.mul(0.06)), () => { hit.assign(1.0); Break(); });
          z.subAssign(max(d.mul(0.9), U.voxel.mul(0.3)));
          If(z.lessThan(zEnd), () => { Break(); });
        });
        If(hit.greaterThan(0.5), () => {
          const lo = z.toVar();
          const hi = z.add(U.voxel.mul(0.6)).toVar();
          for (let k = 0; k < 4; k++) {
            const m = lo.add(hi).mul(0.5).toVar();
            If(this._sdf(vec3(gTop.xy, m)).lessThan(0.0), () => { lo.assign(m); }).Else(() => { hi.assign(m); });
          }
          z.assign(hi);
        });
      });
      return vec4(z, hit, cap, 0.0);
    });
    const res = march().toVar('giantMarch');
    this._march = res;
    mat.depthNode = Fn(() => {
      const ps = positionWorld.xy.sub(U.center.xy);
      const sPos = vec3(ps.add(U.center.xy), res.x.add(U.center.z));
      const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(sPos, 1.0));
      return clamp(clip.z.div(clip.w), 0.0, 1.0);
    })();
    mat.fragmentNode = Fn(() => {
      If(res.y.lessThan(0.5), () => { Discard(); });
      const ps = positionWorld.xy.sub(U.center.xy).toVar();
      const g = vec3(ps.x, ps.y.negate(), res.x).toVar();
      const sPos = vec3(positionWorld.xy, res.x.add(U.center.z)).toVar();
      // Szum i pochodne PRZED rozgałęzieniem przekrój/powierzchnia.
      const gn = vec3(
        dot(vec3(0.80, -0.60, 0.0), g), dot(vec3(0.36, 0.48, 0.80), g), dot(vec3(-0.48, -0.64, 0.60), g)
      ).toVar();
      const n1 = texture3D(this.noise, gn.div(3100.0)).level(0).toVar();
      const n2 = texture3D(this.noise, gn.div(900.0).add(0.37)).level(0).toVar();
      const n3 = texture3D(this.noise, gn.div(260.0).add(0.71)).level(0).toVar();
      const near = smoothstep(0.06, 0.3, U.pxPerUnit).toVar();
      const detail = smoothstep(0.004, 0.05, U.pxPerUnit).toVar();
      const hBump = n2.r.mul(0.7).add(n1.r.mul(0.3)).mul(160.0).mul(detail).add(n3.r.mul(50.0).mul(near)).toVar();
      const dpx = dFdx(sPos).toVar();
      const dpy = dFdy(sPos).toVar();
      const dhx = dFdx(hBump).toVar();
      const dhy = dFdy(hBump).toVar();
      const sunT = mix(float(1.0), U.sunT, S.sunOcc).toVar();
      const col = vec3(0.0).toVar();
      If(res.z.greaterThan(0.5), () => {
        // Przekrój: ciemna płaszczyzna cięcia z warstwami i obwódką ścian.
        const dIn = this._sdf(g).negate();
        const rim = float(1.0).sub(smoothstep(0.0, U.voxel.mul(1.4), dIn));
        const strata = sin(g.x.mul(0.0021).add(g.y.mul(0.0013)).add(n1.r.mul(6.0))).mul(0.5).add(0.5);
        col.assign(U.capColor.mul(strata.mul(0.35).add(0.75).add(n2.g.mul(0.3))).add(vec3(0.035, 0.037, 0.04).mul(rim)));
        col.mulAssign(float(1.0).sub(float(1.0).sub(sunT).mul(0.5)));
      }).Else(() => {
        const nG = this._normal(g, U.voxel).toVar();
        const N = vec3(nG.x, nG.y.negate(), nG.z).toVar();
        const lt = texture3D(this.lightTexture, this._uvw(g)).level(0).toVar();
        const bakedSun = lt.r;
        const ao = lt.g.toVar();
        const albedo = mix(U.rockB, U.rockA, smoothstep(0.2, 0.8, n1.r.mul(0.5).add(n2.r.mul(0.5)))).toVar();
        const strata = sin(dot(g, vec3(0.00093, 0.00061, 0.0036)).add(n1.g.mul(6.0)));
        albedo.mulAssign(strata.mul(0.11).add(0.9));
        albedo.mulAssign(mix(0.64, 1.0, smoothstep(0.32, 0.62, n1.a)));
        const fresh = smoothstep(0.58, 0.74, n2.a.mul(0.5).add(n1.g.mul(0.3)).add(n3.a.mul(0.2))).mul(smoothstep(0.55, 0.9, ao));
        albedo.assign(mix(albedo, U.rockA.mul(1.55), fresh.mul(0.55)));
        albedo.addAssign(U.rockA.mul(0.8).mul(smoothstep(0.88, 0.97, n3.b.mul(0.7).add(n2.r.mul(0.3)))).mul(near));
        albedo.mulAssign(mix(vec3(0.96, 0.99, 1.05), vec3(1.03, 1.0, 0.97), smoothstep(0.35, 0.65, n1.b)));
        albedo.mulAssign(n3.r.mul(0.24).add(0.86));
        // Kratery: ciemniejsze dno, jasny wał, świeże — jasny wyrzut z promieniami.
        If(g.z.greaterThan(0.0), () => {
          Loop({ start: 0, end: CRATER_CAP, type: 'int', condition: '<', name: 'ci' }, ({ ci }) => {
            If(ci.greaterThanEqual(U.craterCount), () => { Break(); });
            const c = U.craters.element(ci).toVar();
            const dc = g.xy.sub(c.xy).toVar();
            const rho = length(dc).div(c.z).toVar();
            If(rho.lessThan(3.2), () => {
              const floorM = float(1.0).sub(smoothstep(0.55, 0.9, rho));
              const rimM = exp(rho.sub(1.0).mul(rho.sub(1.0)).div(0.012).negate());
              const ang = atan(dc.y, dc.x);
              const rays = sin(ang.mul(11.0).add(c.w.mul(40.0))).mul(sin(ang.mul(5.0).sub(c.w.mul(17.0)))).mul(0.45).add(0.55);
              const ejecta = smoothstep(3.1, 1.05, rho).mul(step(1.0, rho)).mul(c.w).mul(c.w).mul(rays);
              albedo.mulAssign(float(1.0).sub(floorM.mul(0.25)));
              albedo.mulAssign(float(1.0).add(rimM.mul(0.45)).add(ejecta.mul(0.9)));
            });
          });
        });
        albedo.assign(mix(albedo.mul(0.55), albedo, smoothstep(0.25, 0.85, ao)));
        // Detal wypukłości z szumu (gradient powierzchni) — przy zbliżeniu.
        const Nn = N.toVar();
        const r1 = cross(dpy, Nn);
        const r2 = cross(Nn, dpx);
        const det = dot(dpx, r1).toVar();
        const grad = r1.mul(dhx).add(r2.mul(dhy)).mul(sign(det));
        If(abs(det).greaterThan(1e-12).and(detail.greaterThan(0.001)), () => {
          Nn.assign(normalize(Nn.mul(abs(det)).sub(grad)));
        });
        const Ls = U.sunS;
        const Vv = vec3(0.0, 0.0, 1.0);
        const ndl = dot(Nn, Ls).toVar();
        const sunVis = bakedSun.mul(sunT).toVar();
        const fill = mix(float(0.22), float(1.0), sunT).mul(float(1.0).sub(float(1.0).sub(sunT).mul(0.96))).toVar();
        const diffuse = clamp(ndl.add(0.1).div(1.1), 0.0, 1.0);
        const up = clamp(Nn.z.mul(0.5).add(0.5), 0.0, 1.0);
        // Otoczenie: w tunelach i jaskiniach gaśnie z AO i brakiem słońca.
        const open = smoothstep(0.05, 0.6, bakedSun).mul(0.65).add(ao.mul(0.35));
        const ambient = S.ambientTop.mul(up.mul(0.5).add(0.5)).add(S.ambientBounce.mul(max(0.0, ndl.negate()))).mul(ao).mul(open);
        col.assign(albedo.mul(S.sunColor.mul(diffuse).mul(sunVis).add(ambient.mul(fill))));
        const Hh = normalize(Ls.add(Vv));
        col.addAssign(S.sunColor.mul(pow(max(dot(Nn, Hh), 0.0), 18.0)).mul(0.03).mul(sunVis));
        // Światła siatki: reflektory w jaskini, pioruny, wybuchy.
        const fDiff = vec3(0.0).toVar();
        const fSpec = vec3(0.0).toVar();
        grid.loop(sPos, ({ toL, att, col: lc }) => {
          const c = lc.mul(att).toVar();
          const nl = dot(Nn, toL).toVar();
          fDiff.addAssign(c.mul(clamp(nl.add(0.1).div(1.1), 0.0, 1.0)));
          fSpec.addAssign(c.mul(pow(max(dot(Nn, normalize(toL.add(Vv))), 0.0), 16.0)).mul(0.05).mul(step(0.0, nl)));
        });
        col.addAssign(albedo.mul(fDiff).mul(ao.mul(0.6).add(0.4)).add(fSpec).mul(U.lightGain));
        // Złoża: świecące plamy kryształu (cyjan) i uranu (zieleń).
        const glow = lt.b.toVar();
        If(glow.greaterThan(0.01), () => {
          const gc = mix(vec3(0.25, 0.75, 1.0), vec3(0.3, 1.0, 0.25), step(0.5, lt.a));
          const veins = smoothstep(0.55, 0.7, n2.b).add(smoothstep(0.62, 0.8, n3.g).mul(0.6));
          col.addAssign(gc.mul(glow).mul(veins.mul(1.6).mul(glow).add(0.08)));
        });
      });
      const out = max(col, vec3(0.0)).mul(S.exposure).toVar();
      if (S.volume) {
        const vv = S.volume.sample(sPos);
        out.assign(out.mul(vv.a).add(vv.rgb));
      }
      return vec4(out, 1.0);
    })();
    this.material = mat;
  }

  /**
   * Co klatkę: pozycja względem początku sceny, przekrój wokół statku pod
   * stropem, skala pikseli.
   * @param {object} f { cam, viewW, viewH, dt, originX, originY, sunT }
   * @param {{x:number,y:number,len:number}|null} focus statek gracza
   */
  update(f, focus = null) {
    const U = this.U;
    const zoom = Math.max(1e-5, f.cam.zoom || 1);
    U.pxPerUnit.value = zoom;
    const px = this.giant.x - f.originX;
    const py = -(this.giant.y - f.originY);
    this.mesh.position.set(px, py, 0);
    this.mesh.updateMatrixWorld(true);
    U.center.value.set(px, py, 0);
    U.sunT.value = f.sunT ?? 1;
    const c = this.cut;
    let want = 0;
    if (focus && this.giant.ready && this.giant.containsWorld(focus.x, focus.y, this.giant.band)) {
      if (this.giant.solidAbove(focus.x, focus.y, c.z)) want = 1;
    }
    const dt = Math.min(0.25, Math.max(0, f.dt || 0));
    c.open += (want - c.open) * (dt > 0 ? 1 - Math.exp(-dt / 0.28) : 1);
    if (focus) {
      c.x = focus.x - this.giant.x;
      c.y = focus.y - this.giant.y;
      const view = Math.min(f.viewW, f.viewH) / zoom;
      c.radius = Math.max((focus.len || 1800) * 1.25, view * 0.36);
      c.soft = c.radius * 0.14;
    }
    const r = c.radius * c.open;
    U.cut.value.set(c.x, -c.y, r, Math.max(1, c.soft * c.open));
    U.cutZ.value = c.z;
  }

  setVisible(v) { this.mesh.visible = !!v; }
}
