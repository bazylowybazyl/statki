// src/3d/rockets/smoke.js
//
// DYM I ŻAR RAKIET na GPU (compute) — port `SmokeSystem` z dema rakiet
// (dema/rakiety-webgpu/smoke.js) do Core3D (zadanie 19). Jedna pula cząstek (pierścień
// 2¹⁹) dla spalin, dymu chemicznego supernowej, sadzy wybuchów, pary wyrzutu i dymu
// płonących odłamków — różnią się paletą (palette.js, SMOKE_PALETTES).
//
// Fizyka gazu (feedback użytkownika: smuga = porcje gazu, nie linia pozycji):
//   • cząstka ma NOŚNIK (prędkość układu rakiety = pęd wyrzutni, stały — agents.md
//     § Nośnik) i ruch WŁASNY (dziedziczony ruch rakiety + wylot z dyszy), opór tylko
//     na własny; nośnik całkowany tym samym krokiem co lot rakiet (zegar reżysera =
//     suma dt z rocketSystem3D.update — dym jedzie z rakietą co do kroku, w pauzie stoi
//     jak dawne cząstki rakiet);
//   • turbulencja z pola wirowego (fxNoise.curl3D) rośnie z wiekiem: świeża smuga
//     gładka, starsza się kłębi;
//   • fale wybuchów (pchnięcie na froncie, implozja supernowej ciągnie do środka)
//     i ślady rakiet przelatujących przez STARY dym (> 0,8 s — bug V z dema).
//
// Światło: mapa gęstości dymu (render cząstek do małego celu HalfFloat, kamera nad
// kadrem) → dla każdej cząstki marsz ku słońcu po mapie = samocień chmury; światła
// siatki Core3D.fx.grid (dysze rakiet, błyski wybuchów, efekty broni) z kierunkiem
// dominującym. Render: kłęby-impostory (normalna kuli + faktura), premultiplied „over”;
// człon słońca gaśnie w masce cienia słońca gry (sunVisibility — cień planety, kadłubów).
//
// Układ (precyzja, FX-INFRA §6): pozycje WZGLĘDEM początku Core3D.fx.origin (scena:
// x, −y świata gry), siatka puli stoi na `mesh.position = początek`; przeskok początku
// przesuwa żywe cząstki kernelem (createShiftKernel). Zlecenia z CPU trzymają pozycję
// świata w double i przeliczają ją przy wysyłce (stara rama, przed origin.update).
//
// Bufory storage (limit 8 na etap — PLAN §3): stan 6 × vec4 + zlecenia w JEDNYM buforze
// (4 × vec4 na zlecenie; demo miało 4 osobne = 10 w kernelu emisji).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, instancedArray, attributeArray,
  instanceIndex, texture, texture3D, positionGeometry, uv, varyingProperty, If, Return, Loop,
  select, mix, smoothstep, clamp, exp, sin, cos, max, dot, length, normalize, sqrt
} from 'three/tsl';
import { SMOKE_PALETTES, SMOKE_DRAG } from './palette.js';
import { createShiftKernel } from '../fx/gpuPoolOrigin.js';
import { sunVisibility } from '../sunShadowMask.js';

export const SMOKE_CAP = 1 << 19;
export const SPAWN_CAP = 1 << 14;
export const BLAST_CAP = 16;
export const WAKE_CAP = 64;
const PAL_CAP = 8;
export const DENSITY_W = 480;
export const DENSITY_H = 270;
const SHADOW_TAPS = 8;
/** Długość marszu ku słońcu [j.] (demo: SHADOW_LEN). */
export const SMOKE_SHADOW_LEN = 240;

// Barwa czyszczenia renderera sprzed mapy gęstości (przywracana — bez alokacji).
const _prevClear = new THREE.Color();
const v4Array = (n, name) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4').setName(name);

export class SmokeSystem {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene scena Core3D (warstwa 0 — pass ortho)
   * @param {import('../fx/lightGrid.js').LightGrid} o.grid siatka świateł (Core3D.fx.grid)
   * @param {import('../fx/gpuPoolOrigin.js').FxPoolOrigin} o.origin początek pul (Core3D.fx.origin)
   * @param {THREE.Data3DTexture} o.curlTex pole wirowe (fxNoise.curl3D)
   * @param {THREE.Texture} o.noise2D faktura kłębów (fxNoise.cloud2D)
   * @param {{ random: { next(): number } }} o.rng generator efektów (fxRandom)
   * @param {number} [o.renderOrder]
   */
  constructor({ scene, grid, origin, curlTex, noise2D, rng, renderOrder = 30 }) {
    this.grid = grid;
    this.origin = origin;
    this.rng = rng;
    this.head = 0;
    this.highWater = 0;
    this.spawnCount = 0;
    this.lastSpawnTime = -1e9;
    this.maxLife = 0;
    this.time = 0;
    this.stats = { spawned: 0, alive: 0, steps: 0, dropped: 0 };
    // Wpis roboczy dla push(): pętle klatki (smuga rakiet, odłamki) wypełniają pola zamiast
    // przekazywać liczby przez argumenty (V8 opakowuje je w obiekty przy wywołaniu, którego
    // nie wklei). Pola jak argumenty spawn; angle = NaN — kąt losowy.
    this.s = { x: 0, y: 0, z: 0, vx: 0, vy: 0, cx: 0, cy: 0, size0: 0, growth: 0, life: 0, temp: 0, pal: 0, opacity: 0, age: 0, angle: NaN };

    this.sP = instancedArray(SMOKE_CAP, 'vec4').setName('rocketSmokeP'); // xyz (lokalnie), wiek
    this.sV = instancedArray(SMOKE_CAP, 'vec4').setName('rocketSmokeV'); // ruch własny, życie
    this.sC = instancedArray(SMOKE_CAP, 'vec4').setName('rocketSmokeC'); // nośnik xy (scena), rozmiar0, przyrost
    this.sD = instancedArray(SMOKE_CAP, 'vec4').setName('rocketSmokeD'); // żar0, paleta(+kąt), ziarno, krycie0
    this.sL = instancedArray(SMOKE_CAP, 'vec4').setName('rocketSmokeL'); // światło punktowe rgb, T słońca
    this.sM = instancedArray(SMOKE_CAP, 'vec4').setName('rocketSmokeM'); // kierunek światła, przesłonięcie

    // Zlecenia z CPU: pozycja świata w double (przeliczana przy wysyłce), reszta float32.
    this._qx = new Float64Array(SPAWN_CAP);
    this._qy = new Float64Array(SPAWN_CAP);
    this._qdata = new Float32Array(SPAWN_CAP * 14);
    // Bufor zleceń na GPU: 4 × vec4 na zlecenie (A pozycja + wiek, B ruch + życie, C nośnik +
    // rozmiar + przyrost, D żar + paleta + ziarno + krycie). Zakres wysyłki na stałe.
    this.q = attributeArray(SPAWN_CAP * 4, 'vec4').setName('rocketSmokeQ');
    this._q = this.q.value.array;
    this._qRange = { start: 0, count: 16 };
    this.q.value.updateRanges.length = 0;
    this.q.value.updateRanges.push(this._qRange);
    this.q.value.clearUpdateRanges = () => {};

    this.U = {
      dt: uniform(1 / 60),
      count: uniform(0, 'uint'),
      spawnCount: uniform(0, 'uint'),
      head: uniform(0, 'uint'),
      cap: uniform(SMOKE_CAP, 'uint'),
      pal: v4Array(PAL_CAP * 4, 'rocketSmokePal'),
      blastCount: uniform(0, 'int'),
      blastA: v4Array(BLAST_CAP, 'rocketSmokeBlastA'), // xy środek (lokalnie), z promień frontu, w szerokość
      blastB: v4Array(BLAST_CAP, 'rocketSmokeBlastB'), // x siła (+ pchnięcie, − ssanie), y typ (0 fala, 1 implozja), z zasięg ssania
      wakeCount: uniform(0, 'int'),
      wakeA: v4Array(WAKE_CAP, 'rocketSmokeWakeA'),   // xy początek, zw koniec odcinka (lokalnie)
      wakeB: v4Array(WAKE_CAP, 'rocketSmokeWakeB'),   // x promień, y siła, zw prędkość rakiety (scena)
      turbGain: uniform(1),
      turbTime: uniform(0),
      // Mapa gęstości i światło (prostokąty w układzie lokalnym).
      dRect: uniform(new THREE.Vector4(0, 0, 1, 1)), // x0, y0, 1/szer, 1/wys
      dStep: uniform(new THREE.Vector2(0, 0)),       // krok marszu ku słońcu
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
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      samples: 0
    });
    this.densityRT.texture.name = 'rocketSmokeDensity';
    this.densityScene = new THREE.Scene();
    this.densityScene.name = 'rocketSmokeDensity';
    this.densityCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    this.densityCam.position.set(0, 0, 1000);

    this._buildCompute();
    this._buildRender(scene, renderOrder);
    // Przeskok początku pul: żywe cząstki (pozycje xy w sP) jednym dispatchem.
    this.shiftNode = createShiftKernel(origin, { buffer: this.sP, capacity: SMOKE_CAP, pos: [[0, 'xy']], name: 'rocketSmokeShift' });
    const sys = this;
    this.originEntry = origin.register({
      shiftNode: this.shiftNode,
      isLive: () => sys.highWater > 0,
      get dispatchCount() { return Math.max(1, sys.highWater); }
    });
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
    const { sP, sV, sC, sD, sL, sM, q } = this;

    // Emisja: zlecenia → pierścień.
    this.emitNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.spawnCount), () => { Return(); });
      const slot = U.head.add(instanceIndex).mod(U.cap).toVar();
      const base = instanceIndex.mul(uint(4)).toVar();
      sP.element(slot).assign(q.element(base));
      sV.element(slot).assign(q.element(base.add(uint(1))));
      sC.element(slot).assign(q.element(base.add(uint(2))));
      sD.element(slot).assign(q.element(base.add(uint(3))));
      sL.element(slot).assign(vec4(0.0, 0.0, 0.0, 1.0));
      sM.element(slot).assign(vec4(0.0, 0.0, 1.0, 1.0));
    })().compute(SPAWN_CAP).setName('rocketSmokeEmit');

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
      Loop({ start: int(0), end: U.blastCount, type: 'int', condition: '<', name: 'blastItem' }, ({ blastItem }) => {
        const A = U.blastA.element(blastItem).toVar();
        const B = U.blastB.element(blastItem).toVar();
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

      // Ślady rakiet w STARYM dymie: odpychanie od odcinka lotu + wleczenie wzdłuż. Tylko
      // dym starszy niż ~0,8 s (pełna siła od 1,6 s): odcinek śladu obejmuje też świeży dym
      // za własną dyszą i smugi poprzedniczek lecących gęsiego w salwie — bez progu
      // rozpychało je na dwie strony i każda rakieta miała dwa ogony w kształcie litery V
      // (bug zgłoszony w demie, potwierdzony A/B).
      const wakeK = smoothstep(0.8, 1.6, age).toVar();
      If(wakeK.greaterThan(0.0), () => {
        Loop({ start: int(0), end: U.wakeCount, type: 'int', condition: '<', name: 'wakeItem' }, ({ wakeItem }) => {
          const A = U.wakeA.element(wakeItem).toVar();
          const B = U.wakeB.element(wakeItem).toVar();
          const ab = A.zw.sub(A.xy).toVar();
          const t = clamp(dot(p.xy.sub(A.xy), ab).div(max(dot(ab, ab), 1e-3)), 0.0, 1.0);
          const qd = p.xy.sub(A.xy.add(ab.mul(t))).toVar();
          const dist = length(qd).toVar();
          If(dist.lessThan(B.x), () => {
            const f = float(1.0).sub(dist.div(B.x));
            const push = qd.div(max(dist, 0.5)).mul(f.mul(f).mul(B.y));
            const drag = B.zw.mul(f.mul(f).mul(0.05));
            v.xy.addAssign(push.add(drag).mul(wakeK));
          });
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
    })().compute(SMOKE_CAP).setName('rocketSmokeStep');

    // Światło (raz na klatkę, po mapie gęstości i siatce świateł tej klatki).
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
      const dUv = (qq) => qq.sub(U.dRect.xy).mul(U.dRect.zw);
      const dAt = (qq) => texture(densTex, dUv(qq)).level(0).x;
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
    })().compute(SMOKE_CAP).setName('rocketSmokeLight');
  }

  _buildRender(scene, renderOrder) {
    const U = this.U;
    const { sP, sV, sC, sD, sL, sM } = this;
    const vA = varyingProperty('vec4', 'vRkSmA'); // uv faktury (xy), wiek/życie, żar
    const vB = varyingProperty('vec4', 'vRkSmB'); // światło punktowe, T słońca
    const vC = varyingProperty('vec4', 'vRkSmC'); // kierunek światła, przesłonięcie
    const vD = varyingProperty('vec4', 'vRkSmD'); // albedo, krycie
    const vE = varyingProperty('vec4', 'vRkSmE'); // barwa żaru (rgb), obrót (cos)
    const vF = varyingProperty('vec4', 'vRkSmF'); // sin obrotu, erozja, ziarno, —

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
      // Kąt kłębu = kierunek toru (część ułamkowa D.y), lekki obrót z wiekiem; świeży kłąb
      // wydłużony wzdłuż toru (ciągła wstęga zamiast koralików).
      const rot = D.y.fract().mul(6.2831853).add(age.mul(D.z.mul(97.0).fract().sub(0.5).mul(0.35))).toVar();
      const cr = cos(rot);
      const sr = sin(rot);
      const stretch = float(1.0).add(pal3.z.mul(exp(age.div(-1.4)))).toVar();
      const qq = positionGeometry.xy.mul(2.0).mul(vec2(stretch, 1.0)).toVar();
      const off = vec2(qq.x.mul(cr).sub(qq.y.mul(sr)), qq.x.mul(sr).add(qq.y.mul(cr))).mul(size);
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
    // Węzeł bazowy tekstury z jawnym uv (bez macierzy uv na każdy odczyt — PLAN §3, pułapka 7).
    const noiseBase = texture(noiseTex, vec2(0.0));
    const puffDensity = (erosion) => {
      const qq = uv().sub(0.5).mul(2.0).toVar();
      const r2 = dot(qq, qq).toVar();
      const n = texture(noiseBase, uv().mul(0.55).add(vA.xy)).toVar();
      const n2 = texture(noiseBase, uv().mul(1.35).add(vA.yx.mul(1.7))).toVar();
      const prof = max(float(1.0).sub(r2), 0.0).toVar();
      // Faktura: duże płaty × drobne włókna; młody dym gładki, starszy coraz bardziej
      // poszarpany (vA.z = wiek / życie).
      const detail = mix(float(0.78), n.x.mul(0.75).add(n2.z.mul(0.5)).sub(0.1), smoothstep(0.0, 0.25, vA.z));
      const base = prof.mul(sqrt(prof)).mul(detail);
      const dens = clamp(base.sub(erosion.mul(float(1.0).sub(n.y.mul(0.6).add(n2.w.mul(0.4)))).mul(0.7)), 0.0, 1.0);
      return { q: qq, r2, n, dens, prof };
    };

    // Materiał główny: kłąb oświetlony + żar.
    const mat = new THREE.NodeMaterial();
    mat.name = 'RocketSmoke';
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
      const { q: qq, r2, n, dens, prof } = puffDensity(vF.y);
      const a = clamp(dens.mul(vD.w), 0.0, 1.0).toVar();
      // Normalna kuli + zaburzenie faktury, obrót kwadu z powrotem do sceny.
      const cr = vE.w;
      const sr = vF.x;
      const qs = vec2(qq.x.mul(cr).sub(qq.y.mul(sr)), qq.x.mul(sr).add(qq.y.mul(cr)));
      const nz = sqrt(max(float(1.0).sub(r2), 0.0)).add(0.25);
      const N = normalize(vec3(qs.mul(0.85).add(n.zw.sub(0.5).mul(0.7)), nz)).toVar();
      const ndl = dot(N, U.sunDir);
      const wrap = clamp(ndl.add(0.25).div(1.25), 0.0, 1.0);
      // Maska cienia słońca gry (cień planety, kadłubów): gaśnie tylko człon słońca.
      const sun = U.sunCol.mul(U.sunGain).mul(mix(float(1.0), vB.w, U.shadowOn)).mul(wrap.mul(0.9).add(0.1)).mul(sunVisibility());
      const pdl = clamp(dot(N, vC.xyz).mul(0.5).add(0.5), 0.0, 1.0);
      const pnt = vB.xyz.mul(pdl.mul(0.7).add(0.3)).mul(U.pointGain);
      // Miękkie nasycenie światła punktowego: błysk rozświetla chmurę, ale oświetlony dym
      // zostaje pod progiem bloomu zamiast białej płyty.
      const pntSat = pnt.div(vec3(1.0).add(pnt));
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
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'RocketSmoke';
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    this.material = mat;
    scene.add(this.mesh);

    // Materiał mapy gęstości (addytywny, sama gęstość w R).
    const dmat = new THREE.NodeMaterial();
    dmat.name = 'RocketSmokeDensity';
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
    this.densityMesh.visible = false;
    this.densityScene.add(this.densityMesh);
  }

  // --- CPU -------------------------------------------------------------------

  /**
   * Zlecenie cząstki (ŚWIAT gry: x, y w double). Parametry: z sceny, ruch własny (vx, vy
   * świata), nośnik (cx, cy świata), rozmiar0 [j.], przyrost [j./√s], życie [s], żar 0..1,
   * paleta, krycie, wiek początkowy [s] (ruch o ten wiek dolicza wołający), kąt toru
   * (świat, null = losowy).
   */
  spawn(x, y, z, vx, vy, cx, cy, size0, growth, life, temp, pal, opacity, age = 0, angle = null) {
    const s = this.s;
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.cx = cx; s.cy = cy;
    s.size0 = size0; s.growth = growth; s.life = life; s.temp = temp; s.pal = pal; s.opacity = opacity;
    s.age = age; s.angle = angle === null ? NaN : angle;
    return this.push();
  }

  /** Zlecenie z wpisu roboczego `s` (pola jak argumenty spawn). */
  push() {
    const s = this.s;
    const i = this.spawnCount;
    if (i >= SPAWN_CAP) { this.stats.dropped++; return false; }
    this.spawnCount = i + 1;
    this._qx[i] = s.x;
    this._qy[i] = s.y;
    const o = i * 14;
    const Q = this._qdata;
    // Kąt kłębu (scena: y odwrócone) w części ułamkowej indeksu palety; bez kąta — losowy.
    const angle = s.angle;
    const a01 = angle !== angle ? this.rng.next() : ((((-angle) / (Math.PI * 2)) % 1) + 1) % 1;
    const life = s.life;
    Q[o] = s.z; Q[o + 1] = s.age;
    Q[o + 2] = s.vx; Q[o + 3] = -s.vy; Q[o + 4] = life;
    Q[o + 5] = s.cx; Q[o + 6] = -s.cy; Q[o + 7] = s.size0; Q[o + 8] = s.growth;
    Q[o + 9] = s.temp; Q[o + 10] = s.pal + Math.min(a01, 0.999); Q[o + 11] = this.rng.next(); Q[o + 12] = s.opacity;
    if (life > this.maxLife) this.maxLife = life;
    return true;
  }

  /** Opór ruchu własnego palety (CPU — przesunięcie porcji o wiek początkowy). */
  paletteDrag(pal) {
    return SMOKE_DRAG[pal] || 1;
  }

  /** Krok symulacji istniejących cząstek (przed emisją nowych). */
  step(renderer, dt, time) {
    const L = this._stepList(dt, time, this._lista || (this._lista = []));
    for (let k = 0; k < L.length; k++) renderer.compute(L[k], this.highWater);
    this._afterStep(time);
  }

  /**
   * Krok i emisja tej klatki w JEDNYM passie compute (zadanie 23): podkroki (ten sam kernel, te same
   * uniformy) i emisja (osobne uniformy: spawnCount, head) jedną listą — dispatch w passie to osobny zakres
   * użycia bufora cząstek, kolejność i wynik jak osobne wywołania.
   */
  stepAndEmit(renderer, dt, time) {
    const L = this._lista || (this._lista = []);
    L.length = 0;
    // krok tylko przy dt > 0 — jak dawne wywołanie step() z rocketFx (zegar, wygasanie puli)
    if (dt > 0) {
      this._stepList(dt, time, L);
      this._afterStep(time);
    }
    const n = this._prepareEmit();
    if (n) L.push(this.emitNode);
    if (L.length === 1) renderer.compute(L[0]);
    else if (L.length > 1) renderer.compute(L);
    if (n) this._afterEmit(n, time);
  }

  // Lista podkroków (kernel kroku n razy, wątków = highWater); pusta, gdy nic nie żyje albo dt = 0.
  _stepList(dt, time, L) {
    L.length = 0;
    this.time = time;
    this.U.turbTime.value = (time * 0.018) % 1;
    const U = this.U;
    this.stats.steps = 0;
    if (this.highWater > 0 && dt > 0) {
      // Podkroki przy długiej klatce (fale wybuchów mają cienki front).
      const n = Math.max(1, Math.min(4, Math.ceil(dt / (1 / 60))));
      U.dt.value = dt / n;
      U.count.value = this.highWater;
      this.stepNode.count = this.highWater;
      for (let k = 0; k < n; k++) L.push(this.stepNode);
      this.stats.steps = n;
    }
    return L;
  }

  _afterStep(time) {
    // Pula wygasła w całości → od zera (krótszy dispatch i rysowanie).
    if (this.highWater > 0 && this.spawnCount === 0 && time - this.lastSpawnTime > this.maxLife + 0.5) {
      this.highWater = 0;
      this.head = 0;
      this.maxLife = 0;
    }
  }

  /**
   * Wysyła zlecenia na GPU (pozycje świata → lokalne względem BIEŻĄCEGO początku — stara
   * rama klatki, przed origin.update) i wpisuje je do pierścienia.
   */
  emit(renderer, time) {
    const n = this._prepareEmit();
    if (!n) return;
    renderer.compute(this.emitNode, n);
    this._afterEmit(n, time);
  }

  // Zlecenia do bufora kolejki (układ lokalny bieżącego początku) i uniformy emisji; zwraca liczbę zleceń.
  _prepareEmit() {
    const n = this.spawnCount;
    if (!n) return 0;
    const ox = this.origin.x;
    const oy = this.origin.y;
    const G = this._q;
    const Q = this._qdata;
    for (let i = 0; i < n; i++) {
      const g = i * 16;
      const o = i * 14;
      G[g] = this._qx[i] - ox; G[g + 1] = -this._qy[i] - oy; G[g + 2] = Q[o]; G[g + 3] = Q[o + 1];
      G[g + 4] = Q[o + 2]; G[g + 5] = Q[o + 3]; G[g + 6] = 0; G[g + 7] = Q[o + 4];
      G[g + 8] = Q[o + 5]; G[g + 9] = Q[o + 6]; G[g + 10] = Q[o + 7]; G[g + 11] = Q[o + 8];
      G[g + 12] = Q[o + 9]; G[g + 13] = Q[o + 10]; G[g + 14] = Q[o + 11]; G[g + 15] = Q[o + 12];
    }
    this._qRange.start = 0;
    this._qRange.count = n * 16;
    this.q.value.needsUpdate = true;
    this.U.spawnCount.value = n;
    this.U.head.value = this.head;
    this.emitNode.count = n;
    return n;
  }

  _afterEmit(n, time) {
    this.head = (this.head + n) % SMOKE_CAP;
    this.highWater = Math.min(SMOKE_CAP, Math.max(this.highWater, this.head === 0 ? SMOKE_CAP : this.head));
    if (this.head < n) this.highWater = SMOKE_CAP;
    this.stats.spawned += n;
    this.spawnCount = 0;
    this.lastSpawnTime = time;
  }

  /** Siatka puli na początku pul (po origin.update tej klatki). */
  syncOrigin() {
    const m = this.mesh;
    m.position.set(this.origin.x, this.origin.y, 0);
    m.updateMatrix();
    m.matrixWorld.copy(m.matrix);
  }

  /**
   * Mapa gęstości nad prostokątem LOKALNYM [x0, x1] × [y0, y1] i marsz ku słońcu.
   * sunDir — kierunek DO słońca (scena, jednostkowy), shadowLen [j.].
   */
  renderDensity(renderer, x0, y0, x1, y1, sunDir, shadowLen) {
    const U = this.U;
    const cam = this.densityCam;
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1;
    cam.position.set(0, 0, 1000);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    U.dRect.value.set(x0, y0, 1 / (x1 - x0), 1 / (y1 - y0));
    const h = Math.sqrt(sunDir.x * sunDir.x + sunDir.y * sunDir.y) || 1;
    const step = shadowLen / SHADOW_TAPS;
    U.dStep.value.set(sunDir.x / h * step, sunDir.y / h * step);
    U.sunDir.value.copy(sunDir);
    const n = this.highWater;
    this.densityMesh.count = n > 1 ? n : 0;
    this.densityMesh.visible = n > 1;
    const prev = renderer.getRenderTarget();
    renderer.getClearColor(_prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.densityRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    if (n > 1) renderer.render(this.densityScene, cam);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(_prevClear, prevAlpha);
  }

  /** Oświetlenie cząstek w prostokącie LOKALNYM widoku. */
  light(renderer, vx0, vy0, vx1, vy1) {
    const n = this.highWater;
    this.U.viewRect.value.set(vx0, vy0, vx1, vy1);
    this.mesh.count = n > 1 ? n : 0;
    this.mesh.visible = n > 1;
    this.stats.alive = n;
    if (n > 1) {
      this.U.count.value = n;
      renderer.compute(this.lightNode, n);
    }
  }

  /** Czy pula ma żywe cząstki (pomiar, statystyki). */
  get live() { return this.highWater > 0; }

  clear() {
    this.highWater = 0;
    this.head = 0;
    this.spawnCount = 0;
    this.maxLife = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}
