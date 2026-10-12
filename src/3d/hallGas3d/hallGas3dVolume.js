// src/3d/hallGas3d/hallGas3dVolume.js
//
// OBRAZ GAZU HALI K-7 v2 (etap E1 — NAJPROSTSZY: gęstość, otoczenie, słońce przez otwór dachu; docs/BRIEF-gaz-hali-3d.md
// § 6, § 9). Marsz promienia przez siatkę 3D solvera (hallGas3dGrid.js) w UKŁADZIE KOMÓREK hali (sześcienne — długość
// drogi i grubość optyczna w jednostkach hali), dwie bryły (wzór gasVolume.js):
//   • `back`  — wysokości 0…116 (pod szczytem kadłuba): pass ortho (warstwa 0), kolejka nieprzezroczysta przed kadłubami
//               (renderOrder 1 — kadłub, renderOrder 10, zasłania gaz pod sobą),
//   • `front` — 116…szczyt domeny: pass FG (warstwa 2), przezroczysta, po bryłach FG; kryjący dach (obraz, K7RoofFade)
//               zasłania gaz pod sobą (krycie z wejścia — `roofView`).
// Wysokość → z sceny jak bryły hali (k7HeightToZ: pod 116 1:1, wyżej × 0,42) — każda bryła ma swój odcinek liniowy, więc
// macierz bryły (komórki → scena) jest afiniczna. Wyznacznik macierzy zawsze > 0 (pułapka 37: przy odbiciu przekształcenia
// hala → gra odwracamy oś głębi w geometrii — `flip`), pozycja w double przez macierz modelu (highPrecision).
// Wyjście premultiplied (barwa, 1 − przepuszczalność). E2 dokłada objętość światła, fakturę, drobiny, HG, siatkę świateł.

import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, float, int, vec2, vec3, vec4, uniform, texture3D, select, mix, clamp, exp, max, min, abs,
  length, normalize, positionGeometry, positionView, varyingProperty, cameraProjectionMatrix, cameraWorldMatrix,
  screenCoordinate, fract, sin, dot
} from 'three/tsl';
import { K7_HEIGHTS, K7_ABOVE_SCALE } from '../haloRing/haloPortK7Layout.js';

/** Wygląd E1 (uniformy; na żywo: HallGas3D.look + syncLook()). Gęstości optyczne na komórkę drogi na jednostkę pola. */
export function createHallGas3dLook() {
  return {
    densDust: 0.5,
    densVapor: 0.55,
    densExhaust: 0.01,   // spaliny prawie przezroczyste (ciepły, czysty gaz; nad kadłubem przepuszczalność ≥ 0,7)
    albedoDust: [0.62, 0.56, 0.47],
    albedoVapor: [0.78, 0.85, 0.95],
    albedoExhaust: [0.5, 0.43, 0.37],
    ambient: [0.11, 0.115, 0.13],    // światło wnętrza hali bez lamp (jak warstwa pyłu 2D) — E2: objętość światła i siatka
    lampColor: [0.2, 0.19, 0.17],    // × poziom lamp hali (0,22 dzień … 0,72 noc) — dawne 0,05 × (0,4 + lampy) dawało pył
                                     //   ciemniejszy od pokładu („czarny dym”)
    lightKnee: 0.18,                 // miękkie kolano światła L / (1 + k · ΣL): gęsty gaz w słońcu nie bieleje do bloomu
    sunColor: [1.0, 0.96, 0.9],
    sunGain: 1.4,
    stepCells: 0.6,
    maxSteps: 96,
    fade: 1
  };
}

/**
 * LUSTRO CPU przepuszczalności kolumny (miara „nad kadłubem ≥ 0,7”): warstwy z polami (pył, para, spaliny) i udziałem
 * drogi w warstwie [komórki] → exp(−Σ σ · droga). Ta sama gęstość optyczna co marsz.
 */
export function hallGas3dTransmittanceCpu(samples, look) {
  let tau = 0;
  for (const s of samples) tau += (look.densDust * s.dust + look.densVapor * s.vapor + look.densExhaust * s.exhaust) * s.len;
  return Math.exp(-tau);
}

export class HallGas3dVolume {
  /**
   * @param {object} o
   * @param {import('./hallGas3dGrid.js').HallGas3dGrid} o.grid
   */
  constructor({ grid }) {
    this.grid = grid;
    this.domain = grid.domain;
    this.look = createHallGas3dLook();
    const dom = this.domain;
    // przejście warstw: szczyt kadłuba (wysokość K-7) w komórkach
    this.splitCells = K7_HEIGHTS.hullTop / dom.h;
    this.U = {
      dens: uniform(new THREE.Vector3(0.5, 0.55, 0.04)),
      aDust: uniform(new THREE.Vector3()), aVapor: uniform(new THREE.Vector3()), aExh: uniform(new THREE.Vector3()),
      ambient: uniform(new THREE.Vector3()), sun: uniform(new THREE.Vector3()),
      step: uniform(0.6), maxSteps: uniform(96, 'int'), fade: uniform(1), knee: uniform(0.18),
      roofOpen: uniform(0), roofRect: uniform(new THREE.Vector4()), roofView: uniform(0)
    };
    this._mats = {};
    this.meshes = this._createMeshes();
    this.syncLook();
  }

  syncLook(L = this.look) {
    const U = this.U;
    U.dens.value.set(L.densDust, L.densVapor, L.densExhaust);
    U.aDust.value.fromArray(L.albedoDust);
    U.aVapor.value.fromArray(L.albedoVapor);
    U.aExh.value.fromArray(L.albedoExhaust);
    U.step.value = L.stepCells;
    U.maxSteps.value = L.maxSteps | 0;
    U.fade.value = L.fade;
    U.knee.value = L.lightKnee;
  }

  /** Oświetlenie klatki: poziom lamp hali (0,22 dzień … 0,72 noc), słońce (mnożnik), dach (otwarcie, prostokąt [komórki], krycie obrazu). */
  setLighting(lamps, sunK, roofOpen, rect, roofView) {
    const U = this.U;
    const L = this.look;
    U.ambient.value.set(L.ambient[0] + L.lampColor[0] * lamps, L.ambient[1] + L.lampColor[1] * lamps, L.ambient[2] + L.lampColor[2] * lamps);
    U.sun.value.set(L.sunColor[0] * L.sunGain * sunK, L.sunColor[1] * L.sunGain * sunK, L.sunColor[2] * L.sunGain * sunK);
    U.roofOpen.value = roofOpen;
    U.roofRect.value.copy(rect);
    U.roofView.value = roofView;
  }

  _createMeshes() {
    const grid = this.grid;
    const dom = this.domain;
    const { nx, nd, nh } = dom;
    const U = this.U;
    const dims = vec3(nx, nd, nh);
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0.5, 0.5, 0.5);   // [0, 1]³
    const geo = new THREE.BufferGeometry();
    geo.setIndex(box.index);
    geo.setAttribute('position', box.getAttribute('position'));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    const make = (front) => {
      const z0 = front ? this.splitCells : 0;
      const z1 = front ? nh : this.splitCells;
      // macierz komórki → lokalne bryły (u, v, w ∈ [0, 1]) i odwrotność kierunków scena → komórki (CPU, place)
      const mU = {
        flip: uniform(0),
        invM: uniform(new THREE.Matrix3())
      };
      const vCell = varyingProperty('vec3', front ? 'vHg3Front' : 'vHg3Back');
      const positionNode = Fn(() => {
        const g = positionGeometry;
        // komórki: x = u·nx, głąb = (flip ? 1 − v : v)·nd, wysokość = z0 + w·(z1 − z0)
        const cd = select(mU.flip.greaterThan(0.5), float(1.0).sub(g.y), g.y).mul(nd);
        vCell.assign(vec3(g.x.mul(nx), cd, g.z.mul(z1 - z0).add(z0)));
        return g;
      })();
      const mat = new THREE.NodeMaterial();
      mat.name = front ? 'HallGas3dFront' : 'HallGas3dBack';
      mat.transparent = front;
      mat.depthWrite = false;
      mat.depthTest = false;
      mat.side = THREE.BackSide;
      mat.forceSinglePass = true;
      mat.lights = false;
      mat.fog = false;
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      mat.blendSrcAlpha = THREE.OneFactor;
      mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      mat.blendEquation = THREE.AddEquation;
      mat.blendEquationAlpha = THREE.AddEquation;
      mat.rulonBend = false;
      mat.positionNode = positionNode;
      mat.fragmentNode = Fn(() => {
        const P = vCell.toVar();
        // promień w scenie: z góry (ortho) wzdłuż osi kamery, inaczej od kamery przez piksel → komórki (macierz odwrotna)
        const ortho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
        const rdV = select(ortho, vec3(0.0, 0.0, -1.0), normalize(positionView));
        const rdS = cameraWorldMatrix.mul(vec4(rdV, 0.0)).xyz;
        const rdC = mU.invM.mul(rdS).toVar();
        const camDist = select(ortho, float(1e5), length(positionView));
        const ro = P.sub(rdC.mul(camDist)).toVar();
        const rd = normalize(rdC).toVar();
        // pudło bryły [0, nx] × [0, nd] × [z0, z1] (komórki)
        const bmin = vec3(0.0, 0.0, z0);
        const bmax = vec3(nx, nd, z1);
        const inv = vec3(1.0).div(select(abs(rd).lessThan(vec3(1e-6)), vec3(1e-6), rd));
        const t0 = bmin.sub(ro).mul(inv);
        const t1 = bmax.sub(ro).mul(inv);
        const tn = min(t0, t1);
        const tf = max(t0, t1);
        const tA = max(max(max(tn.x, tn.y), tn.z), 0.0).toVar();
        const tB = min(min(tf.x, tf.y), tf.z).toVar();
        const col = vec3(0.0).toVar();
        const trans = float(1.0).toVar();
        If(tB.greaterThan(tA), () => {
          const span = tB.sub(tA);
          const stepL = max(U.step, span.div(float(U.maxSteps))).toVar();
          // przesunięcie startu (bez pasów): hasz piksela
          const jit = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453));
          const t = tA.add(stepL.mul(jit)).toVar();
          const sunOpen = U.roofOpen.toVar();
          Loop({ start: int(0), end: U.maxSteps, type: 'int', condition: '<', name: 'hg3m' }, () => {
            If(t.greaterThanEqual(tB).or(trans.lessThan(0.01)), () => { Break(); });
            const q = ro.add(rd.mul(t));
            const s = texture3D(grid.denA, clamp(q, vec3(0.5), vec3(nx - 0.5, nd - 0.5, nh - 0.5)).div(dims)).level(0);
            const sig = max(s.x, 0.0).mul(U.dens.x).add(max(s.y, 0.0).mul(U.dens.y)).add(max(s.z, 0.0).mul(U.dens.z)).toVar();
            If(sig.greaterThan(1e-4), () => {
              const alb = U.aDust.mul(max(s.x, 0.0).mul(U.dens.x)).add(U.aVapor.mul(max(s.y, 0.0).mul(U.dens.y)))
                .add(U.aExh.mul(max(s.z, 0.0).mul(U.dens.z))).div(sig);
              // słońce przez otwór dachu (pion — przepuszczalność kolumny ≈ dotychczasowa droga z góry)
              const R = U.roofRect;
              const inOpen = q.x.greaterThan(R.x).and(q.x.lessThan(R.z)).and(q.y.greaterThan(R.y)).and(q.y.lessThan(R.w));
              const sunL = U.sun.mul(select(inOpen, sunOpen, float(0.0))).mul(trans);
              const Lt = U.ambient.add(sunL);
              const S = alb.mul(Lt.div(Lt.x.add(Lt.y).add(Lt.z).mul(U.knee).add(1.0)));
              const a = exp(sig.mul(stepL).negate());
              col.addAssign(S.mul(trans).mul(float(1.0).sub(a)));
              trans.mulAssign(a);
            });
            t.addAssign(stepL);
          });
        });
        // kryjący dach (obraz) zasłania gaz w hali nad szczytem kadłuba
        const k = front ? float(1.0).sub(U.roofView.mul(texture3D(grid.statTex, clamp(P, vec3(0.5), vec3(nx - 0.5, nd - 0.5, nh - 0.5)).div(dims)).level(0).w)) : float(1.0);
        const f = U.fade.mul(k);
        return vec4(col.mul(f), float(1.0).sub(trans).mul(f));
      })();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = mat.name;
      mesh.frustumCulled = false;
      mesh.renderOrder = front ? 26 : 1;
      mesh.layers.set(front ? 2 : 0);
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      mesh.userData.hg3 = { mU, z0, z1, front };
      return mesh;
    };
    const group = new THREE.Group();
    group.name = 'HallGas3D';
    const back = make(false);
    const front = make(true);
    group.add(back, front);
    return { group, back, front, geometry: geo };
  }

  /**
   * Bryły w scenie z przekształcenia hala → gra (aff: p0x, p0y, ax, ay, bx, by — double). Komórka (cx, cd, ch) → hala
   * (x0 + cx·h, z0 + cd·h, ch·h) → gra → scena (x, −y, k7HeightToZ). Macierz bryły (u, v, w ∈ [0, 1]) z odbiciem osi
   * głębi, gdy wyznacznik wyszedłby ujemny.
   */
  place(aff) {
    const dom = this.domain;
    const h = dom.h;
    const { nx, nd } = dom;
    const det2 = aff.ax * aff.by - aff.bx * aff.ay;
    // kolumny komórki → scena: e_x = h·(ax, −ay, 0), e_d = h·(bx, −by, 0), e_h = h·s·(0, 0, 1); det = −h³·s·det2
    const flip = det2 > 0 ? 1 : 0;
    for (const mesh of [this.meshes.back, this.meshes.front]) {
      const { mU, z0, z1, front } = mesh.userData.hg3;
      const s = front ? K7_ABOVE_SCALE : 1;
      const zBase = (z0 * h - K7_HEIGHTS.hullTop) * s;   // z sceny dolnej ściany bryły
      // u → x komórek ∈ [0, nx], v → głąb (flip: nd − v·nd), w → wysokość [z0, z1]
      const ex = nx * h, ed = nd * h, ew = (z1 - z0) * h * s;
      const gx0 = aff.p0x + dom.x0 * aff.ax + dom.z0 * aff.bx;
      const gy0 = aff.p0y + dom.x0 * aff.ay + dom.z0 * aff.by;
      // początek (u, v, w) = 0: róg komórek (0, flip ? nd : 0, z0)
      const dz0 = flip ? ed : 0;
      const ox = gx0 + dz0 * aff.bx;
      const oy = -(gy0 + dz0 * aff.by);
      const sv = flip ? -1 : 1;
      const m = mesh.matrix;
      m.set(
        ex * aff.ax, sv * ed * aff.bx, 0, ox,
        -ex * aff.ay, -sv * ed * aff.by, 0, oy,
        0, 0, ew, zBase,
        0, 0, 0, 1
      );
      mesh.matrixWorld.copy(m);
      mesh.matrixWorldNeedsUpdate = false;
      // kierunek sceny → komórki: odwrotność części liniowej komórki → scena (bez odbicia — komórki są „prawdziwe”)
      const a11 = h * aff.ax, a12 = h * aff.bx, a21 = -h * aff.ay, a22 = -h * aff.by;
      const d = a11 * a22 - a12 * a21;
      mU.invM.value.set(
        a22 / d, -a12 / d, 0,
        -a21 / d, a11 / d, 0,
        0, 0, 1 / (h * s)
      );
      mU.flip.value = flip;
    }
  }

  setVisible(on) {
    this.meshes.back.visible = on;
    this.meshes.front.visible = on;
  }

  /** Siatki do rozgrzewki (Core3D.warmup — pass ortho i FG). */
  warmupMeshes() {
    return [this.meshes.back, this.meshes.front];
  }
}
