// dema/rakiety-webgpu/smoke.js
//
// DYM I ŻAR RAKIET na GPU (compute). Jedna pula cząstek (pierścień 2¹⁹) dla
// spalin, dymu chemicznego supernowej, sadzy wybuchów, pary wyrzutu i dymu
// płonących odłamków — różnią się paletą (palette.js, SMOKE_PALETTES).
//
// Fizyka gazu (feedback usera: smuga = porcje gazu, nie linia pozycji):
//   • cząstka ma NOŚNIK (prędkość układu rakiety = pęd wyrzutni, stały) i ruch
//     WŁASNY (dziedziczony ruch rakiety + wylot z dyszy), opór tylko na własny;
//   • turbulencja z pola wirowego (noiseTex.js) rośnie z wiekiem: świeża smuga
//     jest gładka, starsza się kłębi;
//   • fale wybuchów (pchnięcie na froncie, implozja supernowej ciągnie do
//     środka) i ślady rakiet przelatujących przez stary dym (tunel w chmurze).
//
// Światło: mapa gęstości dymu (render cząstek do małego celu HalfFloat, kamera
// nad kadrem) → dla każdej cząstki marsz ku słońcu po mapie = samocień chmury;
// światła siatki (lights.js dema asteroid: dysze rakiet, błyski wybuchów,
// reflektory statków) z kierunkiem dominującym, tłumione gęstością wokół.
// Render: kłęby-impostory (normalna kuli + faktura), premultiplied „over”;
// żar świeżego gazu jako emisja (pasmo HDR: tylko drobne, świeże cząstki
// przy dyszy przekraczają próg bloomu).
//
// Kolejność w klatce: step(dt) → emit (nowe cząstki już „w chwili teraz”,
// CPU liczy ich przesunięcie o wiek z ułamka klatki) → renderDensity → light.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, instancedArray, attributeArray,
  instanceIndex, texture, texture3D, positionGeometry, uv, varyingProperty, Loop, If, Return,
  select, mix, smoothstep, clamp, abs, exp, sin, cos, min, max, dot, length, normalize, sqrt
} from 'three/tsl';
import { SMOKE_PALETTES } from './palette.js';

export const SMOKE_CAP = 1 << 19;
export const SPAWN_CAP = 1 << 14;
export const BLAST_CAP = 16;
export const WAKE_CAP = 64;
const PAL_CAP = 8;
const DENSITY_W = 480;
const DENSITY_H = 270;
const SHADOW_TAPS = 8;

const v4Array = (n) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4');

export class SmokeSystem {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Scene} o.scene scena gry (kamera ortho)
   * @param {import('./lights.js').LightGrid} o.grid
   * @param {THREE.Data3DTexture} o.curlTex pole wirowe (noiseTex.js)
   * @param {THREE.Texture} o.noise2D faktura kłębów
   */
  constructor({ renderer, scene, grid, curlTex, noise2D }) {
    this.renderer = renderer;
    this.grid = grid;
    this.head = 0;
    this.highWater = 0;
    this.spawnCount = 0;
    this.lastSpawnTime = -1e9;
    this.maxLife = 0;
    this.time = 0;
    this.stats = { spawned: 0, alive: 0, steps: 0 };

    this.sP = instancedArray(SMOKE_CAP, 'vec4').setName('smokeP'); // xyz, wiek
    this.sV = instancedArray(SMOKE_CAP, 'vec4').setName('smokeV'); // ruch własny, życie
    this.sC = instancedArray(SMOKE_CAP, 'vec4').setName('smokeC'); // nośnik xy, rozmiar0, przyrost
    this.sD = instancedArray(SMOKE_CAP, 'vec4').setName('smokeD'); // żar0, paleta, ziarno, krycie0
    this.sL = instancedArray(SMOKE_CAP, 'vec4').setName('smokeL'); // światło punktowe rgb, T słońca
    this.sM = instancedArray(SMOKE_CAP, 'vec4').setName('smokeM'); // kierunek światła, przesłonięcie

    // Zlecenia z CPU (zakres [0, spawnCount) wysyłany co klatkę).
    this.qA = attributeArray(SPAWN_CAP, 'vec4').setName('smokeQA');
    this.qB = attributeArray(SPAWN_CAP, 'vec4').setName('smokeQB');
    this.qC = attributeArray(SPAWN_CAP, 'vec4').setName('smokeQC');
    this.qD = attributeArray(SPAWN_CAP, 'vec4').setName('smokeQD');
    this._qa = this.qA.value.array;
    this._qb = this.qB.value.array;
    this._qc = this.qC.value.array;
    this._qd = this.qD.value.array;

    this.U = {
      dt: uniform(1 / 60),
      time: uniform(0),
      count: uniform(0, 'uint'),
      spawnCount: uniform(0, 'uint'),
      head: uniform(0, 'uint'),
      cap: uniform(SMOKE_CAP, 'uint'),
      pal: v4Array(PAL_CAP * 4),
      blastCount: uniform(0, 'int'),
      blastA: v4Array(BLAST_CAP), // xy środek, z promień frontu, w szerokość
      blastB: v4Array(BLAST_CAP), // x siła (+ pchnięcie, − ssanie), y typ (0 fala, 1 implozja), z zasięg ssania, w —
      wakeCount: uniform(0, 'int'),
      wakeA: v4Array(WAKE_CAP),   // xy początek, zw koniec odcinka
      wakeB: v4Array(WAKE_CAP),   // x promień, y siła, zw prędkość rakiety (xy)
      turbGain: uniform(1),
      turbTime: uniform(0),
      // Mapa gęstości i światło.
      dRect: uniform(new THREE.Vector4(0, 0, 1, 1)), // x0, y0, 1/szer, 1/wys
      dStep: uniform(new THREE.Vector2(0, 0)),       // krok marszu ku słońcu (scena)
      kappa: uniform(0.55),
      occK: uniform(0.22),
      sunDir: uniform(new THREE.Vector3(-0.6, 0.5, 0.62).normalize()),
      sunCol: uniform(new THREE.Vector3(1.0, 0.95, 0.88)),
      sunGain: uniform(0.5),
      ambient: uniform(new THREE.Vector3(0.05, 0.058, 0.075)),
      pointGain: uniform(1),
      emitGain: uniform(1),
      opacityGain: uniform(1),
      densityGain: uniform(1),
      litOn: uniform(1),
      shadowOn: uniform(1),
      viewRect: uniform(new THREE.Vector4(-1e6, -1e6, 1e6, 1e6))
    };
    this.setPalettes(SMOKE_PALETTES);
    this.curlTex = curlTex;
    this.noise2D = noise2D;

    this.densityRT = new THREE.RenderTarget(DENSITY_W, DENSITY_H, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    });
    this.densityRT.texture.name = 'smokeDensity';
    this.densityScene = new THREE.Scene();
    this.densityCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    this.densityCam.position.set(0, 0, 1000);

    this._buildCompute();
    this._buildRender(scene);
  }

  setPalettes(list) {
    const A = this.U.pal.array;
    list.slice(0, PAL_CAP).forEach((p, k) => {
      A[k * 4].set(p.albedo[0], p.albedo[1], p.albedo[2], p.drag);
      A[k * 4 + 1].set(p.hot[0], p.hot[1], p.hot[2], p.tempTau);
      A[k * 4 + 2].set(p.warm[0], p.warm[1], p.warm[2], p.turb);
      A[k * 4 + 3].set(p.turbScale, p.fadeTau, p.stretch || 0, 0);
    });
  }

  // --- wspólne funkcje TSL ---------------------------------------------------

  _palette(k, j) {
    return this.U.pal.element(int(k).mul(4).add(j));
  }

  /** Promień kłębu: rozprężenie żaru + dyfuzja ~√wiek. */
  _size(C, D, age) {
    const thermal = float(1.0).add(D.x.mul(1.6).mul(float(1.0).sub(exp(age.div(-0.07)))));
    return C.z.mul(thermal).add(C.w.mul(sqrt(max(age, 0.0))));
  }

  /** Krycie z wiekiem (wejście, zanik wykładniczy, wygaszenie przed końcem). */
  _opacity(D, age, life, fadeTau) {
    const fadeIn = smoothstep(0.0, 0.035, age);
    const fadeOut = float(1.0).sub(smoothstep(life.mul(0.62), life, age));
    const decay = mix(float(1.0), exp(age.negate().div(max(fadeTau, 0.05))), 0.8);
    return D.w.mul(fadeIn).mul(fadeOut).mul(decay).mul(this.U.opacityGain);
  }

  _buildCompute() {
    const U = this.U;
    const { sP, sV, sC, sD, sL, sM, qA, qB, qC, qD } = this;

    // Emisja: zlecenia → pierścień.
    this.emitNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.spawnCount), () => { Return(); });
      const slot = U.head.add(instanceIndex).mod(U.cap).toVar();
      sP.element(slot).assign(qA.element(instanceIndex));
      sV.element(slot).assign(qB.element(instanceIndex));
      sC.element(slot).assign(qC.element(instanceIndex));
      sD.element(slot).assign(qD.element(instanceIndex));
      sL.element(slot).assign(vec4(0.0, 0.0, 0.0, 1.0));
      sM.element(slot).assign(vec4(0.0, 0.0, 1.0, 1.0));
    })().compute(SPAWN_CAP).setName('smokeEmit');

    const curl = this.curlTex;
    this.stepNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const P = sP.element(instanceIndex).toVar();
      const V = sV.element(instanceIndex).toVar();
      If(P.w.greaterThanEqual(V.w), () => { Return(); });
      const C = sC.element(instanceIndex).toVar();
      const D = sD.element(instanceIndex).toVar();
      const p = P.xyz.toVar();
      const v = V.xyz.toVar();
      const age = P.w.add(U.dt).toVar();
      const pal0 = this._palette(D.y, 0).toVar();
      const pal2 = this._palette(D.y, 2).toVar();
      const pal3 = this._palette(D.y, 3).toVar();
      // Opór tylko na ruch własny (nośnik = pęd wyrzutni zostaje).
      v.mulAssign(exp(pal0.w.negate().mul(U.dt)));

      // Fale wybuchów: pchnięcie na froncie; implozja ciągnie do środka.
      Loop(U.blastCount, ({ i }) => {
        const A = U.blastA.element(i).toVar();
        const B = U.blastB.element(i).toVar();
        const d = p.xy.sub(A.xy).toVar();
        const dist = max(length(d), 1.0).toVar();
        const dir = d.div(dist);
        If(B.y.lessThan(0.5), () => {
          const x = dist.sub(A.z).div(max(A.w, 1.0));
          const shell = exp(x.mul(x).negate());
          v.xy.addAssign(dir.mul(B.x.mul(shell).mul(U.dt)));
        }).Else(() => {
          const reach = float(1.0).sub(smoothstep(B.z.mul(0.35), B.z, dist));
          const core = smoothstep(A.w.mul(0.4), A.w, dist);
          v.xy.subAssign(dir.mul(B.x.mul(reach).mul(core).mul(U.dt)));
        });
      });

      // Ślady rakiet: odpychanie od odcinka lotu + wleczenie wzdłuż.
      Loop(U.wakeCount, ({ i }) => {
        const A = U.wakeA.element(i).toVar();
        const B = U.wakeB.element(i).toVar();
        const ab = A.zw.sub(A.xy).toVar();
        const t = clamp(dot(p.xy.sub(A.xy), ab).div(max(dot(ab, ab), 1e-3)), 0.0, 1.0);
        const q = p.xy.sub(A.xy.add(ab.mul(t))).toVar();
        const dist = length(q).toVar();
        If(dist.lessThan(B.x), () => {
          const f = float(1.0).sub(dist.div(B.x));
          const push = q.div(max(dist, 0.5)).mul(f.mul(f).mul(B.y));
          const drag = B.zw.mul(f.mul(f).mul(0.05));
          v.xy.addAssign(push.add(drag));
        });
      });

      // Turbulencja (nie kumuluje się w prędkości): pole wirowe, 2 oktawy.
      const scale = max(pal3.x, 10.0).mul(4.0);
      const uvw = vec3(p.x.div(scale), p.y.div(scale), U.turbTime.add(D.z.mul(0.13)));
      const c1 = texture3D(curl, uvw).level(0).xy;
      const c2 = texture3D(curl, uvw.mul(vec3(2.3, 2.3, 1.7)).add(vec3(0.37, 0.61, 0.11))).level(0).xy;
      const ramp = float(1.0).sub(exp(age.div(-0.9)));
      const vt = c1.add(c2.mul(0.5)).mul(pal2.w.mul(ramp).mul(U.turbGain));

      p.addAssign(vec3(v.xy.add(C.xy).add(vt), v.z).mul(U.dt));
      sP.element(instanceIndex).assign(vec4(p, age));
      sV.element(instanceIndex).assign(vec4(v, V.w));
    })().compute(SMOKE_CAP).setName('smokeStep');

    // Światło (raz na klatkę, po mapie gęstości).
    const grid = this.grid;
    const densTex = this.densityRT.texture;
    this.lightNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const P = sP.element(instanceIndex).toVar();
      const V = sV.element(instanceIndex).toVar();
      If(P.w.greaterThanEqual(V.w), () => { Return(); });
      const p = P.xyz.toVar();
      const inView = p.x.greaterThan(U.viewRect.x).and(p.x.lessThan(U.viewRect.z)).and(p.y.greaterThan(U.viewRect.y)).and(p.y.lessThan(U.viewRect.w));
      If(inView.not(), () => { Return(); });
      const dUv = (q) => q.sub(U.dRect.xy).mul(U.dRect.zw);
      const dAt = (q) => texture(densTex, dUv(q)).level(0).x;
      // Samocień: marsz ku słońcu po mapie gęstości.
      const tau = float(0.0).toVar();
      If(U.shadowOn.greaterThan(0.5), () => {
        for (let k = 1; k <= SHADOW_TAPS; k++) {
          tau.addAssign(dAt(p.xy.add(U.dStep.mul(k))));
        }
      });
      const sunT = exp(tau.mul(U.kappa).negate().mul(U.densityGain).div(SHADOW_TAPS / 4)).toVar();
      const local = dAt(p.xy).mul(U.densityGain);
      const occ = exp(local.mul(U.occK).negate()).toVar();
      const irr = vec3(0.0).toVar();
      const dirAcc = vec3(0.0).toVar();
      grid.loop(p, ({ toL, att, col }) => {
        const c = col.mul(att);
        irr.addAssign(c);
        dirAcc.addAssign(toL.mul(dot(c, vec3(0.3, 0.5, 0.2))));
      });
      const dl = length(dirAcc);
      const ldir = select(dl.greaterThan(1e-5), dirAcc.div(max(dl, 1e-5)), vec3(0.0, 0.0, 1.0));
      sL.element(instanceIndex).assign(vec4(irr.mul(occ.mul(0.6).add(0.4)), sunT));
      sM.element(instanceIndex).assign(vec4(ldir, occ));
    })().compute(SMOKE_CAP).setName('smokeLight');
  }

  _buildRender(scene) {
    const U = this.U;
    const { sP, sV, sC, sD, sL, sM } = this;
    const vA = varyingProperty('vec4', 'vSmA'); // uv faktury (xy), wiek/życie, żar
    const vB = varyingProperty('vec4', 'vSmB'); // światło punktowe, T słońca
    const vC = varyingProperty('vec4', 'vSmC'); // kierunek światła, przesłonięcie
    const vD = varyingProperty('vec4', 'vSmD'); // albedo, krycie
    const vE = varyingProperty('vec4', 'vSmE'); // barwa żaru (rgb), obrót (cos)
    const vF = varyingProperty('vec4', 'vSmF'); // sin obrotu, erozja, ziarno, —

    const common = (densityOnly) => Fn(() => {
      const P = sP.element(instanceIndex).toVar();
      const V = sV.element(instanceIndex).toVar();
      const C = sC.element(instanceIndex).toVar();
      const D = sD.element(instanceIndex).toVar();
      const age = P.w.toVar();
      const life = V.w.toVar();
      const alive = age.lessThan(life).and(age.greaterThanEqual(0.0));
      const pal1 = this._palette(D.y, 1).toVar();
      const pal3 = this._palette(D.y, 3).toVar();
      const size = select(alive, this._size(C, D, age), float(0.0)).toVar();
      // Kąt kłębu = kierunek toru (część ułamkowa D.y), lekki obrót z wiekiem;
      // świeży kłąb wydłużony wzdłuż toru (ciągła wstęga zamiast koralików).
      const rot = D.y.fract().mul(6.2831853).add(age.mul(D.z.mul(97.0).fract().sub(0.5).mul(0.35))).toVar();
      const cr = cos(rot);
      const sr = sin(rot);
      const stretch = float(1.0).add(pal3.z.mul(exp(age.div(-1.4)))).toVar();
      const q = positionGeometry.xy.mul(2.0).mul(vec2(stretch, 1.0)).toVar();
      const off = vec2(q.x.mul(cr).sub(q.y.mul(sr)), q.x.mul(sr).add(q.y.mul(cr))).mul(size);
      const opacity = this._opacity(D, age, life, pal3.y).toVar();
      const temp = D.x.mul(exp(age.negate().div(max(pal1.w, 0.01)))).toVar();
      vA.assign(vec4(D.z.mul(17.3).fract(), D.z.mul(31.7).fract(), age.div(max(life, 1e-3)), temp));
      if (!densityOnly) {
        const L = sL.element(instanceIndex);
        const M = sM.element(instanceIndex);
        const pal0 = this._palette(D.y, 0);
        const pal2 = this._palette(D.y, 2);
        vB.assign(L);
        vC.assign(M);
        vD.assign(vec4(pal0.xyz, opacity));
        // Żar: gorący → chłodny, gaśnie z temperaturą.
        const hot = pal1.xyz;
        const warm = pal2.xyz;
        const glow = mix(warm, hot, smoothstep(0.35, 1.0, temp)).mul(smoothstep(0.015, 0.3, temp)).mul(temp);
        vE.assign(vec4(glow.mul(U.emitGain), cr));
        vF.assign(vec4(sr, smoothstep(0.1, 1.0, age.div(max(life, 1e-3))), D.z, 0.0));
      } else {
        vD.assign(vec4(0.0, 0.0, 0.0, opacity));
      }
      return vec3(P.xy.add(off), P.z);
    })();

    const noiseTex = this.noise2D;
    const puffDensity = (erosion) => {
      const q = uv().sub(0.5).mul(2.0).toVar();
      const r2 = dot(q, q).toVar();
      const n = texture(noiseTex, uv().mul(0.55).add(vA.xy)).toVar();
      const n2 = texture(noiseTex, uv().mul(1.35).add(vA.yx.mul(1.7))).toVar();
      const prof = max(float(1.0).sub(r2), 0.0).toVar();
      // Faktura: duże płaty × drobne włókna; młody dym gładki, starszy
      // coraz bardziej poszarpany (vA.z = wiek / życie).
      const detail = mix(float(0.78), n.x.mul(0.75).add(n2.z.mul(0.5)).sub(0.1), smoothstep(0.0, 0.25, vA.z));
      const base = prof.mul(sqrt(prof)).mul(detail);
      const dens = clamp(base.sub(erosion.mul(float(1.0).sub(n.y.mul(0.6).add(n2.w.mul(0.4)))).mul(0.7)), 0.0, 1.0);
      return { q, r2, n, dens, prof };
    };

    // Materiał główny: kłąb oświetlony + żar.
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = common(false);
    mat.fragmentNode = Fn(() => {
      const { q, r2, n, dens, prof } = puffDensity(vF.y);
      const a = clamp(dens.mul(vD.w), 0.0, 1.0).toVar();
      // Normalna kuli + zaburzenie faktury, obrót kwadu z powrotem do sceny.
      const cr = vE.w;
      const sr = vF.x;
      const qs = vec2(q.x.mul(cr).sub(q.y.mul(sr)), q.x.mul(sr).add(q.y.mul(cr)));
      const nz = sqrt(max(float(1.0).sub(r2), 0.0)).add(0.25);
      const N = normalize(vec3(qs.mul(0.85).add(n.zw.sub(0.5).mul(0.7)), nz)).toVar();
      const ndl = dot(N, U.sunDir);
      const wrap = clamp(ndl.add(0.25).div(1.25), 0.0, 1.0);
      const sun = U.sunCol.mul(U.sunGain).mul(mix(float(1.0), vB.w, U.shadowOn)).mul(wrap.mul(0.9).add(0.1));
      const pdl = clamp(dot(N, vC.xyz).mul(0.5).add(0.5), 0.0, 1.0);
      const pnt = vB.xyz.mul(pdl.mul(0.7).add(0.3)).mul(U.pointGain);
      // Miękkie nasycenie światła punktowego: błysk rozświetla chmurę, ale
      // oświetlony dym zostaje pod progiem bloomu zamiast białej płyty.
      const pntSat = pnt.div(vec3(1.0).add(pnt.div(1.0)));
      const amb = U.ambient.mul(N.z.mul(0.4).add(0.6)).mul(vC.w.mul(0.5).add(0.5));
      const light = mix(vec3(0.62), sun.add(pntSat).add(amb), U.litOn);
      const col = vD.xyz.mul(light).toVar();
      // Żar: środek kłębu (bez erozji), niezależnie od krycia.
      const glowShape = prof.mul(prof).mul(n.x.mul(0.6).add(0.7));
      const emit = vE.xyz.mul(glowShape);
      return vec4(col.mul(a).add(emit), a);
    })();
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.name = 'smoke';
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.material = mat;
    scene.add(this.mesh);

    // Materiał mapy gęstości (addytywny, sama gęstość w R).
    const dmat = new THREE.NodeMaterial();
    dmat.transparent = true;
    dmat.depthWrite = false;
    dmat.depthTest = false;
    dmat.lights = false;
    dmat.fog = false;
    dmat.blending = THREE.CustomBlending;
    dmat.blendSrc = THREE.OneFactor;
    dmat.blendDst = THREE.OneFactor;
    dmat.blendSrcAlpha = THREE.OneFactor;
    dmat.blendDstAlpha = THREE.OneFactor;
    dmat.blendEquation = THREE.AddEquation;
    dmat.blendEquationAlpha = THREE.AddEquation;
    dmat.positionNode = common(true);
    dmat.fragmentNode = Fn(() => {
      const { dens } = puffDensity(float(0.3));
      return vec4(dens.mul(vD.w), 0.0, 0.0, 0.0);
    })();
    this.densityMesh = new THREE.Mesh(geo, dmat);
    this.densityMesh.frustumCulled = false;
    this.densityMesh.count = 0;
    this.densityScene.add(this.densityMesh);
  }

  // --- CPU -------------------------------------------------------------------

  /**
   * Zlecenie cząstki (współrzędne SCENY). Parametry: pozycja, ruch własny,
   * nośnik (xy), rozmiar0 [j.], przyrost [j./√s], życie [s], żar 0..1,
   * paleta, krycie, wiek początkowy (już po ruchu — liczy go wołający).
   */
  spawn(x, y, z, vx, vy, vz, cx, cy, size0, growth, life, temp, pal, opacity, age = 0, angle = null) {
    const i = this.spawnCount;
    if (i >= SPAWN_CAP) return false;
    this.spawnCount++;
    const o = i * 4;
    const A = this._qa;
    const B = this._qb;
    const C = this._qc;
    const D = this._qd;
    A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = age;
    B[o] = vx; B[o + 1] = vy; B[o + 2] = vz; B[o + 3] = life;
    C[o] = cx; C[o + 1] = cy; C[o + 2] = size0; C[o + 3] = growth;
    // Kąt kłębu (scena) w części ułamkowej indeksu palety; bez kąta — losowy.
    const a01 = angle === null ? Math.random() : (((angle / (Math.PI * 2)) % 1) + 1) % 1;
    D[o] = temp; D[o + 1] = pal + Math.min(a01, 0.999); D[o + 2] = Math.random(); D[o + 3] = opacity;
    if (life > this.maxLife) this.maxLife = life;
    return true;
  }

  /** Krok symulacji istniejących cząstek (przed emisją nowych). */
  step(dt, time) {
    this.time = time;
    this.U.time.value = time;
    this.U.turbTime.value = (time * 0.018) % 1;
    const U = this.U;
    if (this.highWater > 0) {
      // Podkroki przy długiej klatce (fale wybuchów mają cienki front).
      const n = Math.max(1, Math.min(4, Math.ceil(dt / (1 / 60))));
      U.dt.value = dt / n;
      U.count.value = this.highWater;
      for (let k = 0; k < n; k++) this.renderer.compute(this.stepNode, this.highWater);
      this.stats.steps = n;
    }
    // Pula wygasła w całości → od zera (krótszy dispatch i rysowanie).
    if (this.highWater > 0 && this.spawnCount === 0 && time - this.lastSpawnTime > this.maxLife + 0.5) {
      this.highWater = 0;
      this.head = 0;
      this.maxLife = 0;
    }
  }

  /** Wysyła zlecenia z tej klatki na GPU i wpisuje je do pierścienia. */
  emit(time) {
    const n = this.spawnCount;
    if (!n) return;
    for (const node of [this.qA, this.qB, this.qC, this.qD]) {
      const at = node.value;
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * 4);
      at.needsUpdate = true;
    }
    this.U.spawnCount.value = n;
    this.U.head.value = this.head;
    this.renderer.compute(this.emitNode, n);
    this.head = (this.head + n) % SMOKE_CAP;
    this.highWater = Math.min(SMOKE_CAP, Math.max(this.highWater, this.head === 0 ? SMOKE_CAP : this.head));
    if (this.head < n) this.highWater = SMOKE_CAP;
    this.stats.spawned += n;
    this.spawnCount = 0;
    this.lastSpawnTime = time;
  }

  /**
   * Mapa gęstości nad prostokątem sceny [x0, x1] × [y0, y1] i marsz ku słońcu.
   * sunDir — kierunek DO słońca (scena, jednostkowy), shadowLen [j.].
   */
  renderDensity(x0, y0, x1, y1, sunDir, shadowLen) {
    const U = this.U;
    const cam = this.densityCam;
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1;
    cam.position.set(0, 0, 1000);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    U.dRect.value.set(x0, y0, 1 / (x1 - x0), 1 / (y1 - y0));
    const h = Math.hypot(sunDir.x, sunDir.y) || 1;
    const step = shadowLen / SHADOW_TAPS;
    U.dStep.value.set(sunDir.x / h * step, sunDir.y / h * step);
    U.sunDir.value.copy(sunDir);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const n = this.highWater;
    this.densityMesh.count = n > 1 ? n : 0;
    this.densityMesh.visible = n > 1;
    r.setRenderTarget(this.densityRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    if (n > 1) r.render(this.densityScene, cam);
    r.setRenderTarget(prev);
  }

  /** Oświetlenie cząstek w prostokącie widoku (scena). */
  light(vx0, vy0, vx1, vy1) {
    const n = this.highWater;
    this.U.viewRect.value.set(vx0, vy0, vx1, vy1);
    this.mesh.count = n > 1 ? n : 0;
    this.mesh.visible = n > 1;
    this.stats.alive = n;
    if (n > 1) this.renderer.compute(this.lightNode, n);
  }

  /** Źródła sił na tę klatkę (wybuchy i ślady rakiet). */
  setForces(blasts, wakes) {
    const U = this.U;
    const nb = Math.min(BLAST_CAP, blasts.length);
    for (let i = 0; i < nb; i++) {
      const b = blasts[i];
      U.blastA.array[i].set(b.x, b.y, b.front, b.width);
      U.blastB.array[i].set(b.strength, b.type, b.reach || 0, 0);
    }
    U.blastCount.value = nb;
    const nw = Math.min(WAKE_CAP, wakes.length);
    for (let i = 0; i < nw; i++) {
      const w = wakes[i];
      U.wakeA.array[i].set(w.x0, w.y0, w.x1, w.y1);
      U.wakeB.array[i].set(w.radius, w.strength, w.vx, w.vy);
    }
    U.wakeCount.value = nw;
  }
}
