// dema/rakiety-webgpu/nebula.js
//
// POZOSTAŁOŚĆ SUPERNOWEJ — dziesiątki tysięcy cząstek generowanych na GPU
// (compute, jedno zlecenie na wybuch — CPU nie dotyka cząstek) i poruszanych
// analitycznie w shaderze wierzchołków:
//   • kierunek z hasha (równomiernie na sferze), prędkość zależna od kierunku
//     (duże płaty szumu 3D) — powłoka nie jest kulą, rosną z niej „palce”
//     jak niestabilność Rayleigha–Taylora;
//   • jasność z grzbietów szumu (włókna), barwa ze składników pozostałości
//     supernowych: Hα (róż) we włóknach, [O III] (turkus) na szybkich płatach,
//     [S II] (czerwień) w zagęszczeniach; gorące wnętrze błękitno-białe;
//   • hamowanie r(t) = v·(1 − e^(−k·t))/k (faza Sedova w skrócie), rzut na
//     płaszczyznę gry: pojaśnienie brzegu powłoki wychodzi samo z geometrii,
//     bez rysowanego pierścienia (feedback usera: żadnych świecących okręgów).
// Pasmo HDR ciała 0,3–1,2 po sumowaniu (normalizacja nakładania), zagęszczenia
// do ~3 — iskrzą w bloomie.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, vec4, uniform, instancedArray, instanceIndex, hash, texture3D,
  positionGeometry, uv, varyingProperty, If, Return, Loop, Break, select, mix, smoothstep, clamp, exp, sqrt,
  cos, sin, max, min, abs, dot, pow, length, normalize, cross
} from 'three/tsl';
import { NEBULA_COLORS } from './palette.js';

export const NEBULA_CAP = 1 << 18;

export class NebulaSystem {
  constructor({ renderer, scene, noise3D, renderOrder = 75 }) {
    this.renderer = renderer;
    this.head = 0;
    this.highWater = 0;
    this.events = [];
    this.nA = instancedArray(NEBULA_CAP, 'vec4').setName('nebA'); // kierunek, t0
    this.nB = instancedArray(NEBULA_CAP, 'vec4').setName('nebB'); // prędkość, opór, rozmiar, życie
    this.nC = instancedArray(NEBULA_CAP, 'vec4').setName('nebC'); // w[O III], w[S II], jasność, rodzaj
    this.nD = instancedArray(NEBULA_CAP, 'vec4').setName('nebD'); // środek xy, ułamek promienia, ziarno
    this.nE = instancedArray(NEBULA_CAP, 'vec4').setName('nebE'); // kierunek włókna (xyz, na sferze)
    this.U = {
      time: uniform(0),
      zoom: uniform(1),
      gain: uniform(1),
      start: uniform(0, 'uint'),
      count: uniform(0, 'uint'),
      seed: uniform(0, 'uint'),
      center: uniform(new THREE.Vector2()),
      t0: uniform(0),
      speed: uniform(1500),
      size: uniform(9),
      life: uniform(3.6),
      cHa: uniform(new THREE.Vector3(...NEBULA_COLORS.halpha)),
      cO3: uniform(new THREE.Vector3(...NEBULA_COLORS.oiii)),
      cS2: uniform(new THREE.Vector3(...NEBULA_COLORS.sii)),
      cHot: uniform(new THREE.Vector3(...NEBULA_COLORS.hot))
    };
    this._buildInit(noise3D);
    this._buildRender(scene, renderOrder);
  }

  _buildInit(noise3D) {
    const U = this.U;
    const { nA, nB, nC, nD, nE } = this;
    const ridgeAt = (d, seedOff) => {
      const f0 = texture3D(noise3D, d.mul(1.1).add(seedOff.mul(1.9))).level(0).y;
      const f1 = texture3D(noise3D, d.mul(2.3).add(seedOff.mul(0.7))).level(0).x;
      return float(1.0).sub(abs(f0.mul(0.65).add(f1.mul(0.35)).mul(2.0).sub(1.0)));
    };
    this.initNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const slot = U.start.add(instanceIndex).mod(uint(NEBULA_CAP)).toVar();
      const s = instanceIndex.mul(uint(747796405)).add(U.seed.mul(uint(2891336453))).toVar();
      const h3 = hash(s.bitXor(uint(0xB5297A4D)));
      const h4 = hash(s.bitXor(uint(0x1B56C4E9)));
      const h5 = hash(s.bitXor(uint(0x3C6EF372)));
      const seedOff = vec3(float(U.seed.mod(uint(97))).mul(0.137), float(U.seed.mod(uint(89))).mul(0.211), 0.37);
      // Populacje: 0 włókna (70%), 1 gorące wnętrze (12%), 2 zagęszczenia (3%),
      // 3 rozmyta powłoka [O III] (15%).
      const kind = select(h3.lessThan(0.12), float(1.0), select(h3.lessThan(0.15), float(2.0), select(h3.lessThan(0.3), float(3.0), float(0.0)))).toVar();
      // Kierunek: dla włókien i zagęszczeń próbkowanie z odrzucaniem — do 10
      // prób, aż kierunek trafi na grzbiet szumu (sieć włókien na sferze).
      const dir = vec3(0.0, 0.0, 1.0).toVar();
      const fil = float(0.0).toVar();
      const onRidge = kind.equal(0.0).or(kind.equal(2.0));
      const tries = select(onRidge, int(10), int(1));
      const k = int(0).toVar();
      Loop(tries, ({ i }) => {
        const si = s.add(uint(i).mul(uint(0x9E3779B9))).toVar();
        const z = hash(si).mul(2.0).sub(1.0).toVar();
        const phi = hash(si.bitXor(uint(0x68E31DA4))).mul(6.2831853);
        const rxy = sqrt(max(float(1.0).sub(z.mul(z)), 0.0));
        const d = vec3(rxy.mul(cos(phi)), rxy.mul(sin(phi)), z).toVar();
        const ridge = ridgeAt(d, seedOff);
        const r2 = ridge.mul(ridge);
        dir.assign(d);
        fil.assign(r2.mul(r2));
        If(fil.greaterThan(0.62), () => { Break(); });
      });
      // Kierunek włókna: prostopadły do gradientu grzbietu w płaszczyźnie stycznej.
      const up = select(abs(dir.z).lessThan(0.9), vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0));
      const t1 = normalize(cross(up, dir)).toVar();
      const t2 = cross(dir, t1).toVar();
      const e = float(0.02);
      const g1 = ridgeAt(normalize(dir.add(t1.mul(e))), seedOff).sub(ridgeAt(normalize(dir.sub(t1.mul(e))), seedOff));
      const g2 = ridgeAt(normalize(dir.add(t2.mul(e))), seedOff).sub(ridgeAt(normalize(dir.sub(t2.mul(e))), seedOff));
      const fdir = t1.mul(g2.negate()).add(t2.mul(g1)).toVar();
      const lobe = texture3D(noise3D, dir.mul(0.42).add(seedOff)).level(0).x.toVar();
      const lobeK = smoothstep(0.25, 0.8, lobe);
      const speed = U.speed.mul(mix(float(0.7), float(1.25), lobeK)).mul(h4.mul(0.12).add(0.94)).toVar();
      const frac = select(kind.equal(1.0), h5.mul(0.6), select(kind.equal(3.0), h5.mul(0.2).add(0.8), h5.mul(0.08).add(0.92))).toVar();
      const bright = select(kind.equal(1.0), float(0.45),
        select(kind.equal(2.0), float(2.4),
          select(kind.equal(3.0), float(0.2), mix(float(0.12), float(1.0), smoothstep(0.35, 0.9, fil)))));
      // Barwy: [O III] na rozmytej powłoce i szybkich płatach, [S II] w zagęszczeniach.
      const wO3 = select(kind.equal(3.0), float(1.0), smoothstep(0.55, 0.85, lobe).mul(0.8));
      const wS2 = select(kind.equal(2.0), float(0.6), smoothstep(0.55, 0.85, h4).mul(0.35));
      const life = U.life.mul(select(kind.equal(1.0), float(0.5), h5.mul(0.3).add(0.8)));
      const size = U.size.mul(select(kind.equal(3.0), float(2.2), select(kind.equal(2.0), float(1.3), h3.mul(0.6).add(0.7))));
      nA.element(slot).assign(vec4(dir, U.t0));
      nB.element(slot).assign(vec4(speed, select(kind.equal(3.0), float(0.0), fil), size, life));
      nC.element(slot).assign(vec4(wO3, wS2, bright, kind));
      nD.element(slot).assign(vec4(U.center, frac, h4));
      nE.element(slot).assign(vec4(fdir.div(max(length(fdir), 1e-5)), 0.0));
    })().compute(NEBULA_CAP).setName('nebulaInit');
  }

  _buildRender(scene, renderOrder) {
    const U = this.U;
    const { nA, nB, nC, nD, nE } = this;
    const vCol = varyingProperty('vec3', 'vNbCol');
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = Fn(() => {
      const A = nA.element(instanceIndex).toVar();
      const B = nB.element(instanceIndex).toVar();
      const C = nC.element(instanceIndex).toVar();
      const D = nD.element(instanceIndex).toVar();
      const age = U.time.sub(A.w).toVar();
      const life = B.w;
      const alive = age.greaterThanEqual(0.0).and(age.lessThan(life));
      const k = float(1.05);
      const fil = B.y;
      const r = B.x.mul(float(1.0).sub(exp(age.negate().mul(k)))).div(k).mul(D.z).toVar();
      // Lekkie skręcenie włókien w czasie (ścinanie powłoki).
      const tw = age.mul(0.08).mul(D.w.sub(0.5));
      const cx = cos(tw);
      const sx = sin(tw);
      const d2 = vec2(A.x.mul(cx).sub(A.y.mul(sx)), A.x.mul(sx).add(A.y.mul(cx)));
      const center = D.xy.add(d2.mul(r));
      const ageN = clamp(age.div(max(life, 1e-3)), 0.0, 1.0);
      const env = smoothstep(0.0, 0.07, age).mul(float(1.0).sub(smoothstep(0.35, 1.0, ageN)));
      // Barwa: gorący błysk na starcie → składniki pozostałości.
      const ha = U.cHa;
      const mixed = mix(mix(ha, U.cO3, C.x), U.cS2, C.y);
      const shell = select(C.w.equal(1.0), U.cHot, mixed);
      const hotStart = exp(age.div(-0.22));
      const col = mix(shell, U.cHot.mul(1.6), hotStart.mul(0.85));
      // Świeża plazma: szerokie, gładkie plamy; potem włókna wzdłuż ekspansji
      // (smuga w kierunku promienia — promieniste palce jak w Mgławicy Kraba).
      const early = exp(age.div(-0.28));
      const sizeW = B.z.mul(r.div(700.0).add(0.6)).mul(early.mul(1.6).add(1.0)).toVar();
      const px = sizeW.mul(U.zoom).toVar();
      const pxC = max(px, 2.0);
      const energy = min(px.div(pxC), 1.0);
      const radial = d2.div(max(length(d2), 0.05)).toVar();
      const E = nE.element(instanceIndex).toVar();
      const fl = vec2(E.x.mul(cx).sub(E.y.mul(sx)), E.x.mul(sx).add(E.y.mul(cx)));
      const flL = length(fl);
      // Rzut kierunku włókna (krótki, gdy włókno biegnie ku kamerze → promień).
      const axis0 = mix(radial, fl.div(max(flL, 1e-3)), smoothstep(0.15, 0.5, flL).mul(0.85));
      const axis = axis0.div(max(length(axis0), 1e-3)).toVar();
      const stretch = mix(float(1.2).add(fil.mul(3.2)), float(1.0), early);
      const perp = vec2(axis.y.negate(), axis.x);
      const g = positionGeometry.xy;
      const wPx = pxC.div(U.zoom);
      const q = axis.mul(g.x.mul(wPx).mul(stretch)).add(perp.mul(g.y.mul(wPx).mul(0.7))).mul(select(alive, float(1.0), float(0.0)));
      vCol.assign(col.mul(C.z).mul(env).mul(energy.mul(energy)).mul(U.gain).div(stretch.mul(0.35).add(0.65)));
      return vec3(center.add(q), 26.0);
    })();
    mat.fragmentNode = Fn(() => {
      const q = uv().sub(0.5).mul(2.0);
      const d = dot(q, q);
      const g = exp(d.mul(-4.0)).mul(float(1.0).sub(smoothstep(0.6, 1.0, d)));
      return vec4(vCol.mul(g), 0.0);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'nebula';
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Nowa pozostałość w (x, y) SCENY; count cząstek, prędkość, rozmiar, życie. */
  spawn(time, x, y, { count = 98304, speed = 1500, size = 9, life = 3.8, gain = 1 } = {}) {
    const U = this.U;
    const n = Math.min(count, NEBULA_CAP);
    U.start.value = this.head;
    U.count.value = n;
    U.seed.value = (Math.random() * 0xffffffff) >>> 0;
    U.center.value.set(x, y);
    U.t0.value = time;
    U.speed.value = speed;
    U.size.value = size;
    U.life.value = life;
    U.gain.value = gain;
    this.renderer.compute(this.initNode, n);
    this.head = (this.head + n) % NEBULA_CAP;
    this.highWater = Math.min(NEBULA_CAP, Math.max(this.highWater, this.head === 0 ? NEBULA_CAP : this.head));
    if (this.head < n) this.highWater = NEBULA_CAP;
    this.events.push({ t0: time, life: life * 1.2 });
  }

  update(time, zoom) {
    this.U.time.value = time;
    this.U.zoom.value = zoom;
    this.events = this.events.filter((e) => time - e.t0 < e.life);
    if (!this.events.length && this.highWater) {
      this.highWater = 0;
      this.head = 0;
    }
    this.mesh.count = this.highWater > 1 ? this.highWater : 0;
    this.mesh.visible = this.highWater > 1;
  }
}
