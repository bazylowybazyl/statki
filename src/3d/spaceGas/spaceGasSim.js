// src/3d/spaceGas/spaceGasSim.js
//
// POLE GAZU 2D Z TRANSPORTEM GĘSTOŚCI w otwartej przestrzeni (pas, ring, ławice mgły) — rdzeń portu dema
// dema/gazy-transport-webgpu.html do gry (docs/PLAN-gazy-kosmos.md, etap GK-1; wygląd dema zaakceptowany 2026-10-16,
// decyzje D1–D8 z rekomendacjami przyjęte 2026-10-22). Sam rdzeń: kernele, stan GPU, okno i krok — bez obrazu (GK-3)
// i bez wejścia gry (GK-2).
//
// Okno N × N komórek po `cell` j. wokół kamery, przesuwane o całe komórki (komórki wjeżdżające dostają POLE DALEKIE).
// Kernele 1:1 z dema (strojenie SPACE_GAS_TUNE = SIMT dema): wiry → adwekcja RK2 prędkości + siły → MacCormack skalarów,
// ciągłość z faktyczną dywergencją → dywergencja − cel → Jacobi → rzut z komórkami stałymi i otwartym brzegiem.
// Fizyka (opis dema): pole dalekie (start okna, komórki wjeżdżające, dopływ przez brzeg, gęstość ODNIESIENIA), ciśnienie
// gazu κ(ρ − ρ_ref), STREFY ŚCIŚLIWE (stożek dyszy, front wybuchu, „pług” wokół kadłuba — D6), opór (ku wiatrowi, w próżni,
// kwadratowy), wiatr = prędkość tła (D4), pozycje spoczynkowe faktury.
//
// Różnice względem dema (blokery z przeglądu 2026-10-15, plan § 2):
//   • UKŁAD: świat GRY (y w dół) WZGLĘDEM KOTWICY sceny (`anchor` — pas: Słońce; ring: planeta), liczony na CPU w double.
//     Bufory trzymają tylko stan komórek (bez pozycji bezwzględnych), więc 5–10 mln j. świata nie dotyka float32,
//     a szum pola dalekiego ma argumenty rzędu setek. Zmiana kotwicy = start okna od nowa.
//   • bez bufora `flagB`: komórka stała = znacznik w `velB.w` (2; strefa ściśliwa ≤ 1), prędkość ciała w `velB.xy` —
//     kAdvect i kProject mają po 7 buforów storage (zapas jednego do limitu 8); kShift zeruje ciśnienie zamiast je
//     przenosić (rozgrzanie Jacobiego po przesunięciu okna od zera — 7 buforów).
//   • KADŁUBY = maski obrysu z żywych węzłów belek (rekord GAS_HULL_REC — jak przeszkody gazu wybuchów), nie koła; pas
//     „pługa” wokół prostokąta maski z normalną od najbliższego punktu prostokąta.
//   • POLE DALEKIE wstrzykiwane przez scenę (`farEnv(q, U)` → vec4 gęstości kanałów; q — punkt względem kotwicy).
//   • OBRAZ 60 Hz → dwie pary tekstur (krok na zmianę): obraz przenika poprzedni i bieżący krok wg ułamka kroku (plan
//     § 2 pkt 5), każda tekstura z własnym rogiem okna (przesunięcie okna nie przestawia już zapisanej tekstury).
//   • okno przesuwane TYLKO w klatce z krokiem (lekcja drżenia dema 2026-10-13).
//
// Zero `window`, DOM i referencji do encji (szew gra ↔ render): wejście klatki pakuje właściciel (spaceGas.js).

import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Return, float, int, ivec2, vec2, vec3, vec4, uniform, uniformArray, instancedArray, instanceIndex,
  textureStore, texture, mix, smoothstep, saturate, clamp, exp, max, min, abs, dot, length, floor, select
} from 'three/tsl';
import { gnoise } from './spaceGasNoise.js';
import { GAS_HULL_MASK } from '../gas/gasObstacleLayout.js';

/** Bok komórki pola [j.] — strojenie jest w jednostkach komórek (D5: stała). */
export const SPACE_GAS_CELL = 64;
/** Krok symulacji [s] i najwięcej kroków na klatkę (× 4 w rozgrzaniu sceny). */
export const SPACE_GAS_SUB = 1 / 60;
export const SPACE_GAS_MAX_SUB = 2;

/** Strojenie pola (= SIMT dema; po zmianie `sim.syncTune()`). */
export function createSpaceGasTune() {
  return {
    drag: 0.2,            // opór prędkości ku wiatrowi [1/s]
    dragVac: 2.0,         // dodatkowy opór tam, gdzie gazu brak (ρ < vacRho): pas spalin po zgaszeniu silnika staje
    vacRho: 0.25,
    dragQuad: 0.3,        // opór szybkiego gazu poza stożkami [1/komórka]: wał zepchnięty przez strumień staje w ~1 s
    cmTau: 1.0,           // pamięć strefy ściśliwej [s]
    hullShell: 130,       // pas „pługa” wokół kadłuba [j.]
    vort: 1.0,            // wzmacnianie wirów [komórki]
    soft: 0.004,          // miękki rzut [1/komórka²] — wał przed dziobem / na czole strumienia / wybuchu
    baro: 0.012,          // ciśnienie gazu κ [1/s] — kanał zamyka się dopływem w ~minutę
    baroFloor: 0.3,       // ρ₀ — próżnia nie jest „rozrzedzona”
    turb: 0.008,          // turbulencja w gazie [komórki/s²]
    turbShear: 0.6,       // waga |ω| [s] w turbulencji
    restRelax: 0.35,      // powrót pozycji spoczynkowych faktury [1/s]
    restMax: 6,           // najdalsze przesunięcie faktury [komórki]
    maxSpeed: 4200,       // sufit prędkości [j/s]
    warm: 0.9,            // rozgrzanie ciśnienia
    jacobi: 31,           // iteracje (nieparzyste — wynik w prsB)
    diff: 0.05,           // dyfuzja skalarów [komórki²/s]
    capRef: 3.0,          // sufit zagęszczenia: capRef × gęstość odniesienia + capAdd
    capAdd: 0.6,
    decay: [0.002, 0.002, 0.004, 0.04]   // zanik w próżni [1/s] na kanał (w — wyrzut)
  };
}

const v4Array = (n, name) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4').setName(name);

function imageTexture(N, name) {
  const t = new THREE.StorageTexture(N, N);
  t.type = THREE.HalfFloatType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.name = name;
  return t;
}

/** Tryby źródła (srcC.z). */
export const SPACE_GAS_SRC = Object.freeze({ cone: 0, ball: 1, front: 2 });

/**
 * Lustro CPU profilu źródła `srcShape` (bez zasłaniania przeszkodami): { prof, near, cmp, tx, ty }. A, B, C — tablice 4
 * liczb jak rekord źródła (A: początek, kierunek; B: długość / promień, szerokość u nasady / grubość frontu, rozszerzanie,
 * prędkość [j/s]; C: tempo narzucania, wydatek objętości, tryb, zasięg źródła od wylotu). Zmiana kernela = zmiana lustra.
 */
export function srcShapeCpu(px, py, A, B, C, out = {}) {
  out.prof = 0; out.near = 0; out.cmp = 0; out.tx = 0; out.ty = 0;
  const rx = px - A[0], ry = py - A[1];
  if (C[2] > 1.5) {
    const d = Math.sqrt(rx * rx + ry * ry);
    if (d < B[0] + B[1]) {
      out.prof = Math.min(1, Math.max(0, 1 - Math.abs(d - B[0]) / B[1]));
      out.cmp = 1;
      const k = B[3] / Math.max(d, 1);
      out.tx = rx * k; out.ty = ry * k;
    }
  } else if (C[2] > 0.5) {
    const d = Math.sqrt(rx * rx + ry * ry);
    if (d < B[0] * 1.7) {
      const x = d / B[0];
      out.prof = Math.exp(-2 * x * x);
      out.near = out.prof;
      out.cmp = out.prof;
      const k = B[3] / Math.max(d, 1);
      out.tx = rx * k; out.ty = ry * k;
    }
  } else {
    const along = rx * A[2] + ry * A[3];
    if (along > -B[1] && along < B[0]) {
      const across = -rx * A[3] + ry * A[2];
      const width = B[1] + Math.max(along, 0) * B[2];
      const x = across / width;
      const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
      const fade = (1 - ss(B[0] * 0.5, B[0], along)) * ss(-B[1], 0, along);
      if (Math.abs(x) < 2.6 && fade > 1e-3) {
        const x2 = x * x;
        out.prof = Math.exp(-2.2 * x2) * fade;
        out.near = out.prof * (1 - ss(C[3] * 0.5, C[3], along));
        const sp = B[3] * (B[1] / width * 0.7 + 0.3);
        const side = x * B[2] * sp * 2;
        out.tx = A[2] * sp - A[3] * side;
        out.ty = A[3] * sp + A[2] * side;
        out.cmp = Math.exp(-0.5 * x2) * fade;
      }
    }
  }
  return out;
}

export class SpaceGasSim {
  /**
   * @param {object} o
   * @param {(q: any, U: object) => any} o.farEnv pole dalekie: vec4 gęstości kanałów (x, y, z — gazy sceny, w — wyrzut)
   *   w punkcie q (vec2, świat gry względem kotwicy); U — uniformy pola (np. U.windOff — dryf wzoru z wiatrem)
   * @param {number} [o.N] okno [komórki] (128 / 256 / 384 — D5)
   * @param {number} [o.cell] bok komórki [j.]
   * @param {number} [o.maxSources] źródeł na klatkę
   * @param {number} [o.maxRocks] kół-przeszkód (przekroje olbrzymów pasa, jądra komet)
   * @param {number} [o.maxHulls] kadłubów-przeszkód (maski obrysu) na klatkę
   */
  constructor({ farEnv, N = 256, cell = SPACE_GAS_CELL, maxSources = 64, maxRocks = 64, maxHulls = 32, name = 'spaceGas' } = {}) {
    if (typeof farEnv !== 'function') throw new Error('SpaceGasSim: brak farEnv');
    this.N = N;
    this.cell = cell;
    this.maxSources = maxSources;
    this.maxRocks = maxRocks;
    this.maxHulls = maxHulls;
    this.name = name;
    this.tune = createSpaceGasTune();
    const NN = N * N;
    const U = this.U = {
      live: uniform(1),                         // 0 — kernele wychodzą od razu (rozgrzewka pustymi dispatchami)
      origin: uniform(new THREE.Vector2()),     // róg komórki (0, 0) okna [j., świat gry względem kotwicy]
      shift: uniform(new THREE.Vector2()),      // przesunięcie okna [komórki] (nowe − stare)
      windOff: uniform(new THREE.Vector2()),    // całka wiatru [j.] — wzór pola dalekiego płynie z wiatrem
      windC: uniform(new THREE.Vector2()),      // wiatr [komórki/s]
      dt: uniform(SPACE_GAS_SUB),
      step: uniform(0, 'int'),
      time: uniform(0),                         // zegar pola [s] (turbulencja)
      decay: uniform(new THREE.Vector4()),
      srcCount: uniform(0, 'int'),
      rockCount: uniform(0, 'int'),
      hullCount: uniform(0, 'int'),
      srcA: v4Array(maxSources, `${name}SrcA`),
      srcB: v4Array(maxSources, `${name}SrcB`),
      srcC: v4Array(maxSources, `${name}SrcC`),
      srcD: v4Array(maxSources, `${name}SrcD`),
      rock: v4Array(maxRocks, `${name}Rock`),   // x, y, promień, —
      // kadłub (rekord GAS_HULL_REC → pole): A — kotwica xy, wiersz 0 macierzy K (świat → teksle maski);
      // B — wiersz 1 K, przesunięcie (teksle); C — prędkość kotwicy [j/s], ω [rad/s], pasmo maski; D — bok teksla xy [j.]
      hullA: v4Array(maxHulls, `${name}HullA`),
      hullB: v4Array(maxHulls, `${name}HullB`),
      hullC: v4Array(maxHulls, `${name}HullC`),
      hullD: v4Array(maxHulls, `${name}HullD`)
    };
    const ST = this.ST = {};
    for (const k of ['drag', 'dragVac', 'vacRho', 'dragQuad', 'cmTau', 'hullShell', 'vort', 'soft', 'baro', 'baroFloor',
      'turb', 'turbShear', 'restRelax', 'restMax', 'maxSpeed', 'warm', 'diff', 'capRef', 'capAdd']) ST[k] = uniform(0);
    this.syncTune();

    // maski obrysu kadłubów: pasmo 64 × 32 na slot (R8, filtr liniowy, próg 0,5)
    const HM = GAS_HULL_MASK;
    this.hullMaskData = new Uint8Array(HM.w * HM.h * maxHulls);
    const mt = new THREE.DataTexture(this.hullMaskData, HM.w, HM.h * maxHulls, THREE.RedFormat, THREE.UnsignedByteType);
    mt.minFilter = THREE.LinearFilter;
    mt.magFilter = THREE.LinearFilter;
    mt.generateMipmaps = false;
    mt.name = `${name}HullMasks`;
    mt.needsUpdate = true;
    this.hullMaskTex = mt;

    const B = this.buf = {
      velA: instancedArray(NN, 'vec2').setName(`${name}VelA`),
      velB: instancedArray(NN, 'vec4').setName(`${name}VelB`),     // xy prędkość po siłach / ciała, z — cel dywergencji, w — strefa ściśliwa (2 = stała)
      curlB: instancedArray(NN, 'vec2').setName(`${name}Curl`),
      prsA: instancedArray(NN, 'vec4').setName(`${name}PrsA`),     // q, prawa strona, stała
      prsB: instancedArray(NN, 'vec4').setName(`${name}PrsB`),
      denA: instancedArray(NN, 'vec4').setName(`${name}DenA`),
      denB: instancedArray(NN, 'vec4').setName(`${name}DenB`),
      denC: instancedArray(NN, 'vec4').setName(`${name}DenC`),
      restA: instancedArray(NN, 'vec4').setName(`${name}RestA`),   // przesunięcie faktury xy [komórki], z — gęstość odniesienia, w — strefa ściśliwa
      restB: instancedArray(NN, 'vec4').setName(`${name}RestB`)
    };
    // obraz: gęstości (x, y, z — gazy, w — wyrzut) i faktura / stała / prędkość — dwie pary (krok na zmianę)
    this.denTex = [imageTexture(N, `${name}Den0`), imageTexture(N, `${name}Den1`)];
    this.restTex = [imageTexture(N, `${name}Rest0`), imageTexture(N, `${name}Rest1`)];
    // stan obrazu dla warstwy: róg okna każdej tekstury (świat gry względem kotwicy), waga tekstury 1 w przenikaniu
    this.image = { origin: [new THREE.Vector2(), new THREE.Vector2()], w1: 0, cur: 0, prev: 0, valid: false };

    this._farEnv = farEnv;
    this._buildKernels();

    // okno i krok
    this.ox = 0;                 // róg okna [komórki, względem kotwicy]
    this.oy = 0;
    this.acc = 0;
    this.steps = 0;
    this.warmLeft = 0;           // rozgrzanie po starcie okna [s] (czas pola × 4)
    this._reset = true;
    this._list = [];
    this.srcN = 0;
    this.rockN = 0;
    this.hullN = 0;
    this._maskDirty = false;
    this.stats = { substeps: 0, dispatches: 0, sources: 0, rocks: 0, hulls: 0, resets: 0, shifts: 0 };
  }

  syncTune() {
    const T = this.tune, ST = this.ST;
    for (const k in ST) ST[k].value = T[k];
    ST.maxSpeed.value = T.maxSpeed / this.cell;
    const d = T.decay;
    this.U.decay.value.set(d[0], d[1], d[2], d[3]);
  }

  /** Start okna od nowa w następnym kroku (nowa scena, zmiana kotwicy, teleport). */
  requestReset(warmSeconds = 0) {
    this._reset = true;
    this.warmLeft = Math.max(this.warmLeft, warmSeconds);
  }

  // --- TSL ---------------------------------------------------------------------------------------------------------

  _buildKernels() {
    const N = this.N, NN = N * N, C = this.cell;
    const U = this.U, ST = this.ST, B = this.buf, HM = GAS_HULL_MASK, maxHulls = this.maxHulls;
    const { velA, velB, curlB, prsA, prsB, denA, denB, denC, restA, restB } = B;
    const farEnv = (pw) => this._farEnv(pw, U);
    const sum4 = (v) => v.x.add(v.y).add(v.z).add(v.w);
    const ci = (v) => min(max(v, int(0)), int(N - 1));
    const at = (x, y) => ci(x).add(ci(y).mul(int(N)));
    this._at = at;
    const rd = (buf, x, y) => buf.element(at(x, y));
    const bil = (buf, pos) => {
      const g = pos.sub(0.5).toVar();
      const f0 = floor(g).toVar();
      const f = g.sub(f0).toVar();
      const ix = int(f0.x).toVar();
      const iy = int(f0.y).toVar();
      return mix(mix(rd(buf, ix, iy), rd(buf, ix.add(1), iy), f.x), mix(rd(buf, ix, iy.add(1)), rd(buf, ix.add(1), iy.add(1)), f.x), f.y);
    };
    const inDom = (pos) => pos.x.greaterThan(1.0).and(pos.x.lessThan(N - 1)).and(pos.y.greaterThan(1.0)).and(pos.y.lessThan(N - 1));
    const cell = () => {
      If(U.live.lessThan(0.5), () => { Return(); });
      const id = int(instanceIndex).toVar();
      const i = id.mod(int(N)).toVar();
      const j = id.div(int(N)).toVar();
      const p = vec2(float(i).add(0.5), float(j).add(0.5)).toVar();
      const pw = U.origin.add(p.mul(C)).toVar();
      return { id, i, j, p, pw };
    };
    const isSolid = (w) => w.greaterThan(1.5);

    // Kadłub k w punkcie świata pw: q — teksle maski, rel — względem kotwicy.
    const hullFrame = (k, pw) => {
      const A = U.hullA.element(k).toVar();
      const Bh = U.hullB.element(k).toVar();
      const rel = pw.sub(A.xy).toVar();
      const q = vec2(dot(A.zw, rel), dot(Bh.xy, rel)).add(Bh.zw).toVar();
      return { A, Bh, rel, q };
    };

    // Komórka stała w punkcie świata: koła (przekroje olbrzymów, jądra), kadłuby (maska obrysu, prędkość ciała + ω × r).
    // vec3(stała, vx, vy) [komórki/s].
    const solidAt = (pw) => {
      const f = vec3(0).toVar();
      Loop({ start: 0, end: U.rockCount, type: 'int', condition: '<', name: 'sgr' }, ({ sgr }) => {
        const r = U.rock.element(sgr);
        If(length(pw.sub(r.xy)).lessThan(r.z), () => { f.assign(vec3(1.0, 0.0, 0.0)); });
      });
      Loop({ start: 0, end: U.hullCount, type: 'int', condition: '<', name: 'sgh' }, ({ sgh }) => {
        const H = hullFrame(sgh, pw);
        If(H.q.x.greaterThan(0.0).and(H.q.x.lessThan(float(HM.w))).and(H.q.y.greaterThan(0.0)).and(H.q.y.lessThan(float(HM.h))), () => {
          const Cc = U.hullC.element(sgh).toVar();
          const mu = clamp(H.q.x, 0.5, HM.w - 0.5).mul(1 / HM.w);
          const mv = Cc.w.mul(HM.h).add(clamp(H.q.y, 0.5, HM.h - 0.5)).mul(1 / (HM.h * maxHulls));
          If(texture(this.hullMaskTex, vec2(mu, mv)).level(0).x.greaterThan(0.5), () => {
            f.assign(vec3(1.0, Cc.x.sub(Cc.z.mul(H.rel.y)).div(C), Cc.y.add(Cc.z.mul(H.rel.x)).div(C)));
          });
        });
      });
      return f;
    };
    // Odcinek a → b wolny od kół-przeszkód (strumień nie przechodzi przez skałę).
    const visible = (a, b) => {
      const vis = float(1.0).toVar();
      const ab = b.sub(a).toVar();
      const ab2 = max(dot(ab, ab), 1.0).toVar();
      Loop({ start: 0, end: U.rockCount, type: 'int', condition: '<', name: 'sgo' }, ({ sgo }) => {
        const r = U.rock.element(sgo);
        const t = saturate(dot(r.xy.sub(a), ab).div(ab2));
        If(length(a.add(ab.mul(t)).sub(r.xy)).lessThan(r.z), () => { vis.assign(0.0); });
      });
      return vis;
    };
    // Profil źródła (lustro CPU: srcShapeCpu).
    const srcShape = (pw, A, Bs, Cc) => {
      const prof = float(0.0).toVar();
      const near = float(0.0).toVar();
      const cmp = float(0.0).toVar();
      const tgt = vec2(0.0).toVar();
      const rel = pw.sub(A.xy).toVar();
      If(Cc.z.greaterThan(1.5), () => {
        const d = length(rel).toVar();
        If(d.lessThan(Bs.x.add(Bs.y)), () => {
          prof.assign(saturate(float(1.0).sub(abs(d.sub(Bs.x)).div(Bs.y))));
          cmp.assign(1.0);
          tgt.assign(rel.div(max(d, 1.0)).mul(Bs.w));
        });
      }).ElseIf(Cc.z.greaterThan(0.5), () => {
        const d = length(rel).toVar();
        If(d.lessThan(Bs.x.mul(1.7)), () => {
          const x = d.div(Bs.x);
          prof.assign(exp(x.mul(x).mul(-2.0)));
          near.assign(prof);
          cmp.assign(prof);
          tgt.assign(rel.div(max(d, 1.0)).mul(Bs.w));
        });
      }).Else(() => {
        const along = dot(rel, A.zw).toVar();
        If(along.greaterThan(Bs.y.negate()).and(along.lessThan(Bs.x)), () => {
          const across = rel.x.mul(A.w.negate()).add(rel.y.mul(A.z));
          const width = Bs.y.add(max(along, 0.0).mul(Bs.z)).toVar();
          const x = across.div(width).toVar();
          const fade = float(1.0).sub(smoothstep(Bs.x.mul(0.5), Bs.x, along)).mul(smoothstep(Bs.y.negate(), 0.0, along)).toVar();
          If(abs(x).lessThan(2.6).and(fade.greaterThan(1e-3)), () => {
            fade.mulAssign(visible(pw, A.xy));
            const x2 = x.mul(x);
            prof.assign(exp(x2.mul(-2.2)).mul(fade));
            near.assign(prof.mul(float(1.0).sub(smoothstep(Cc.w.mul(0.5), Cc.w, along))));
            const sp = Bs.w.mul(Bs.y.div(width).mul(0.7).add(0.3));
            tgt.assign(A.zw.mul(sp).add(vec2(A.w.negate(), A.z).mul(x.mul(Bs.z).mul(sp).mul(2.0))));
            cmp.assign(exp(x2.mul(-0.5)).mul(fade));
          });
        });
      });
      return { prof, near, tgt, cmp };
    };

    // 0. Start: całe okno z pola dalekiego, gaz płynie z wiatrem (obraz — tekstura 0).
    this.kInit = Fn(() => {
      const c = cell();
      const far = farEnv(c.pw).toVar();
      velA.element(c.id).assign(U.windC);
      velB.element(c.id).assign(vec4(U.windC, 0.0, 0.0));
      denA.element(c.id).assign(far);
      restA.element(c.id).assign(vec4(0.0, 0.0, sum4(far), 0.0));
      prsA.element(c.id).assign(vec4(0.0));
      prsB.element(c.id).assign(vec4(0.0));
      textureStore(this.denTex[0], ivec2(c.i, c.j), far);
      textureStore(this.restTex[0], ivec2(c.i, c.j), vec4(0.0));
    })().compute(NN).setName(`${this.name}Init`);

    // Przesunięcie okna o całe komórki: stan z komórki (i + sx, j + sy); spoza starego okna — pole dalekie.
    // Ciśnienie od zera (bez przenoszenia — kernel w 7 buforach).
    this.kShift = Fn(() => {
      const c = cell();
      const si = c.i.add(int(U.shift.x)).toVar();
      const sj = c.j.add(int(U.shift.y)).toVar();
      const ok = si.greaterThanEqual(int(0)).and(si.lessThan(int(N))).and(sj.greaterThanEqual(int(0))).and(sj.lessThan(int(N)));
      If(ok, () => {
        const o = si.add(sj.mul(int(N)));
        velB.element(c.id).assign(vec4(velA.element(o), 0.0, 0.0));
        denB.element(c.id).assign(denA.element(o));
        restB.element(c.id).assign(restA.element(o));
      }).Else(() => {
        const far = farEnv(c.pw).toVar();
        velB.element(c.id).assign(vec4(U.windC, 0.0, 0.0));
        denB.element(c.id).assign(far);
        restB.element(c.id).assign(vec4(0.0, 0.0, sum4(far), 0.0));
      });
      prsB.element(c.id).assign(vec4(0.0));
    })().compute(NN).setName(`${this.name}Shift`);
    this.kShiftCopy = Fn(() => {
      If(U.live.lessThan(0.5), () => { Return(); });
      const id = int(instanceIndex);
      velA.element(id).assign(velB.element(id).xy);
      denA.element(id).assign(denB.element(id));
      restA.element(id).assign(restB.element(id));
    })().compute(NN).setName(`${this.name}ShiftCopy`);

    // 1. Wiry.
    this.kCurl = Fn(() => {
      const c = cell();
      const V = (dx, dy) => rd(velA, c.i.add(dx), c.j.add(dy));
      const w = V(1, 0).y.sub(V(-1, 0).y).sub(V(0, 1).x.sub(V(0, -1).x)).mul(0.5);
      curlB.element(c.id).assign(vec2(w, abs(w)));
    })().compute(NN).setName(`${this.name}Curl`);

    // 2. Adwekcja prędkości (RK2) + siły, surowa adwekcja skalarów i faktury, dopływ z pola dalekiego przez brzeg, komórki
    //    stałe, cel dywergencji (źródła + ciśnienie gazu).
    this.kAdvect = Fn(() => {
      const c = cell();
      const p = c.p;
      const dt = U.dt;
      const v0 = velA.element(c.id).toVar();
      const vm = bil(velA, p.sub(v0.mul(dt.mul(0.5))));
      const pb = p.sub(vm.mul(dt)).toVar();
      const vel = vec2(U.windC).toVar();
      const den = vec4(0.0).toVar();
      const rest = vec4(0.0).toVar();
      If(inDom(pb), () => {
        vel.assign(bil(velA, pb));
        den.assign(bil(denA, pb));
        rest.assign(bil(restA, pb));
      }).Else(() => {
        den.assign(farEnv(U.origin.add(pb.mul(C))));   // dopływ przez brzeg okna
      });
      const edgeC = min(min(p.x, float(N).sub(p.x)), min(p.y, float(N).sub(p.y)));
      If(edgeC.lessThan(1.5), () => { vel.assign(U.windC); });
      // faktura: przesunięcie względem wiatru (wzór pola dalekiego płynie z wiatrem osobno — windOff)
      const off = rest.xy.add(pb.sub(p)).add(U.windC.mul(dt)).mul(exp(ST.restRelax.negate().mul(dt))).toVar();
      off.mulAssign(min(float(1.0), ST.restMax.div(max(length(off), 1e-4))));
      const rA = restA.element(c.id).toVar();
      // gęstość odniesienia (pole dalekie w tym punkcie) — co 8. krok w ósmej części komórek
      const ref = rA.z.toVar();
      If(c.id.mod(int(8)).equal(U.step.mod(int(8))), () => { ref.assign(sum4(farEnv(c.pw))); });

      // źródła: narzucona prędkość w stożku / kuli / na froncie, źródło objętości przy wylocie, strefa ściśliwa
      const src = float(0.0).toVar();
      const cm = rA.w.mul(exp(dt.negate().div(ST.cmTau))).toVar();
      const jetW = float(0.0).toVar();
      Loop({ start: 0, end: U.srcCount, type: 'int', condition: '<', name: 'sgv' }, ({ sgv }) => {
        const A = U.srcA.element(sgv).toVar();
        const Bs = U.srcB.element(sgv).toVar();
        const Cc = U.srcC.element(sgv).toVar();
        const S = srcShape(c.pw, A, Bs, Cc);
        If(S.prof.greaterThan(1e-4).or(S.cmp.greaterThan(1e-4)), () => {
          vel.assign(mix(vel, S.tgt.div(C), saturate(Cc.x.mul(dt).mul(S.prof))));
          src.addAssign(Cc.y.mul(S.near));
          cm.assign(max(cm, S.cmp));
          jetW.assign(max(jetW, S.prof));
        });
      });
      // kadłuby: PŁUG — gaz przy burcie od strony ruchu dostaje składową normalną prędkości burty (tylko pchanie, bez
      // ssania); pas wokół prostokąta maski jest ściśliwy (wał przed dziobem i na burtach, pusty ślad za rufą)
      Loop({ start: 0, end: U.hullCount, type: 'int', condition: '<', name: 'sgp' }, ({ sgp }) => {
        const H = hullFrame(sgp, c.pw);
        const D = U.hullD.element(sgp).toVar();
        // odległość od prostokąta maski: w tekslach → świat (oś teksla × bok teksla)
        const qc = clamp(H.q, vec2(0.0), vec2(HM.w, HM.h));
        const dq = H.q.sub(qc).toVar();
        const ex = H.A.zw.mul(D.x).toVar();          // oś x kadłuba (jednostkowa) = wiersz K × bok teksla
        const fy = H.Bh.xy.mul(D.y).toVar();
        const dw = ex.mul(dq.x.mul(D.x)).add(fy.mul(dq.y.mul(D.y))).toVar();
        const d = length(dw).toVar();
        If(d.greaterThan(0.5).and(d.lessThan(ST.hullShell)), () => {
          const Cc = U.hullC.element(sgp).toVar();
          const ws = float(1.0).sub(d.div(ST.hullShell)).toVar();
          const n = dw.div(d).toVar();
          const vb = vec2(Cc.x.sub(Cc.z.mul(H.rel.y)), Cc.y.add(Cc.z.mul(H.rel.x))).div(C);
          const vn = dot(vb, n).toVar();
          const push = max(vn.sub(dot(vel, n)), 0.0).mul(select(vn.greaterThan(0.0), ws, float(0.0)));
          vel.addAssign(n.mul(push));
          cm.assign(max(cm, ws));
        });
      });
      // wzmacnianie wirów
      const W = (dx, dy) => rd(curlB, c.i.add(dx), c.j.add(dy)).y;
      const om = curlB.element(c.id).x;
      const eta = vec2(W(1, 0).sub(W(-1, 0)), W(0, 1).sub(W(0, -1))).mul(0.5).toVar();
      const nv = eta.div(max(length(eta), 1e-4));
      vel.addAssign(vec2(nv.y.mul(om), nv.x.mul(om).negate()).mul(ST.vort).mul(dt));
      // turbulencja w gazie (wolny szum świata)
      const rho = sum4(den).toVar();
      const tq = c.pw.div(2600.0).add(vec2(U.time.mul(0.05), U.time.mul(-0.04)));
      const tn = vec2(gnoise(tq), gnoise(tq.add(vec2(17.3, -9.1))));
      vel.addAssign(tn.mul(ST.turb).mul(min(rho, 1.0).add(abs(om).mul(ST.turbShear))).mul(dt));
      // opór ku wiatrowi; w próżni mocniejszy; kwadratowy dla szybkiego gazu poza stożkami
      const rv = vel.sub(U.windC).toVar();
      const dragE = ST.drag.add(ST.dragVac.mul(float(1.0).sub(smoothstep(0.0, ST.vacRho, rho))))
        .add(ST.dragQuad.mul(length(rv)).mul(float(1.0).sub(saturate(jetW.mul(2.0)))));
      vel.assign(U.windC.add(rv.mul(exp(dragE.negate().mul(dt)))));
      // ciśnienie gazu: rozrzedzony — zbieżność (dopływ), zagęszczony — rozpływ
      const baro = clamp(rho.sub(ref).div(max(ref, ST.baroFloor)).mul(ST.baro), ST.baro.negate(), ST.baro);
      const fl = solidAt(c.pw).toVar();
      const solid = fl.x.greaterThan(0.5).toVar();
      // stała: prędkość ciała w xy, znacznik 2 w w (strefa ściśliwa ≤ 1)
      velB.element(c.id).assign(vec4(select(solid, fl.yz, vel), select(solid, float(0.0), src.add(baro)), select(solid, float(2.0), cm)));
      denB.element(c.id).assign(select(solid, vec4(0.0), den));
      restB.element(c.id).assign(vec4(select(solid, vec2(0.0), off), ref, select(solid, float(1.0), cm)));
    })().compute(NN).setName(`${this.name}Advect`);

    // 3. Skalary: MacCormack obcięty do sąsiadów punktu wstecz, dyfuzja, ciągłość z faktyczną dywergencją, zanik.
    this.kReact = Fn(() => {
      const c = cell();
      const p = c.p;
      const dt = U.dt;
      const v0 = velA.element(c.id).toVar();
      const pb = p.sub(v0.mul(dt)).toVar();
      const pf = p.add(v0.mul(dt)).toVar();
      const phi = denA.element(c.id).toVar();
      const res = denB.element(c.id).toVar();
      If(inDom(pb).and(inDom(pf)), () => {
        const tilde = bil(denB, pf);
        const mc = res.add(phi.sub(tilde).mul(0.5));
        const g = pb.sub(0.5).floor().toVar();
        const ix = int(g.x).toVar();
        const iy = int(g.y).toVar();
        const s00 = rd(denA, ix, iy).toVar();
        const s10 = rd(denA, ix.add(1), iy).toVar();
        const s01 = rd(denA, ix, iy.add(1)).toVar();
        const s11 = rd(denA, ix.add(1), iy.add(1)).toVar();
        res.assign(clamp(mc, min(min(s00, s10), min(s01, s11)), max(max(s00, s10), max(s01, s11))));
        // dyfuzja (sąsiad stały — Neumann)
        const ND = (dx, dy) => {
          const k = at(c.i.add(dx), c.j.add(dy));
          return select(isSolid(velB.element(k).w), phi, denA.element(k));
        };
        const lap = ND(1, 0).add(ND(-1, 0)).add(ND(0, 1)).add(ND(0, -1)).sub(phi.mul(4.0));
        res.addAssign(lap.mul(min(ST.diff.mul(dt), 0.2)));
      });
      // ciągłość: Dρ/Dt = −ρ·∇·v (faktyczna dywergencja prędkości tego kroku)
      const VD = (dx, dy) => rd(velA, c.i.add(dx), c.j.add(dy));
      const divE = VD(1, 0).x.sub(VD(-1, 0).x).add(VD(0, 1).y.sub(VD(0, -1).y)).mul(0.5);
      const grow = exp(clamp(divE.negate().mul(dt), -3.0, 0.4));
      const capR = restA.element(c.id).z.mul(ST.capRef).add(ST.capAdd);
      res.mulAssign(min(grow, max(float(1.0), capR.div(max(sum4(res), 1e-4)))));
      res.mulAssign(exp(U.decay.negate().mul(dt)));
      Loop({ start: 0, end: U.srcCount, type: 'int', condition: '<', name: 'sgi' }, ({ sgi }) => {
        const D = U.srcD.element(sgi).toVar();
        If(sum4(D).greaterThan(0.0), () => {
          const S = srcShape(c.pw, U.srcA.element(sgi).toVar(), U.srcB.element(sgi).toVar(), U.srcC.element(sgi).toVar());
          res.addAssign(D.mul(S.near.mul(dt)));
        });
      });
      denC.element(c.id).assign(select(isSolid(velB.element(c.id).w), vec4(0.0), clamp(res, 0.0, 12.0)));
    })().compute(NN).setName(`${this.name}React`);

    // 4. Dywergencja (sąsiad stały oddaje prędkość ciała — ta sama `velB.xy`) minus cel; rozgrzanie ciśnienia.
    this.kDiv = Fn(() => {
      const c = cell();
      const VN = (dx, dy) => rd(velB, c.i.add(dx), c.j.add(dy)).xy;
      const vC = velB.element(c.id).toVar();
      const solid = isSolid(vC.w);
      // strefa ściśliwa (velB.w): rzut nie poprawia tam dywergencji (pchnięty gaz zostaje zepchnięty)
      const div = VN(1, 0).x.sub(VN(-1, 0).x).add(VN(0, 1).y.sub(VN(0, -1).y)).mul(0.5).sub(vC.z).mul(saturate(vC.w).oneMinus());
      prsA.element(c.id).assign(vec4(select(solid, float(0.0), prsB.element(c.id).x.mul(ST.warm)), select(solid, float(0.0), div),
        select(solid, float(1.0), float(0.0)), 0.0));
    })().compute(NN).setName(`${this.name}Divergence`);

    // 5. Jacobi: (∇² − soft)·q = prawa strona; sąsiad stały — Neumann, poza oknem — 0 (otwarty brzeg).
    const jac = (src, dst, nm) => Fn(() => {
      const c = cell();
      const C0 = src.element(c.id).toVar();
      const Q = (dx, dy, inD) => {
        const s = rd(src, c.i.add(dx), c.j.add(dy));
        return select(inD, select(s.z.greaterThan(0.5), C0.x, s.x), float(0.0));
      };
      const q = Q(1, 0, c.i.lessThan(int(N - 1))).add(Q(-1, 0, c.i.greaterThan(int(0))))
        .add(Q(0, 1, c.j.lessThan(int(N - 1)))).add(Q(0, -1, c.j.greaterThan(int(0)))).sub(C0.y).div(ST.soft.add(4.0));
      dst.element(c.id).assign(vec4(select(C0.z.greaterThan(0.5), float(0.0), q), C0.y, C0.z, 0.0));
    })().compute(NN).setName(nm);
    this.kJacAB = jac(prsA, prsB, `${this.name}JacobiAB`);
    this.kJacBA = jac(prsB, prsA, `${this.name}JacobiBA`);

    // 6. Rzut, sufit prędkości, kopie do A, tekstury obrazu (para `k` — krok na zmianę).
    const project = (k) => Fn(() => {
      const c = cell();
      const C0 = prsB.element(c.id).toVar();
      const Q = (dx, dy, inD) => {
        const s = rd(prsB, c.i.add(dx), c.j.add(dy));
        return select(inD, select(s.z.greaterThan(0.5), C0.x, s.x), float(0.0));
      };
      const gx = Q(1, 0, c.i.lessThan(int(N - 1))).sub(Q(-1, 0, c.i.greaterThan(int(0))));
      const gy = Q(0, 1, c.j.lessThan(int(N - 1))).sub(Q(0, -1, c.j.greaterThan(int(0))));
      const vb = velB.element(c.id).toVar();
      const solid = isSolid(vb.w).toVar();
      const v = vb.xy.sub(vec2(gx, gy).mul(select(solid, float(0.0), float(0.5)))).toVar();
      v.mulAssign(min(float(1.0), ST.maxSpeed.div(max(length(v), 1e-3))));
      velA.element(c.id).assign(v);
      const d = denC.element(c.id).toVar();
      const r = restB.element(c.id).toVar();
      denA.element(c.id).assign(d);
      restA.element(c.id).assign(r);
      textureStore(this.denTex[k], ivec2(c.i, c.j), d);
      textureStore(this.restTex[k], ivec2(c.i, c.j), vec4(r.xy, select(solid, float(1.0), float(0.0)), length(v).mul(C)));
    })().compute(NN).setName(`${this.name}Project${k}`);
    this.kProject = [project(0), project(1)];
  }

  /** Wszystkie kernele (rozgrzewka, testy WGSL w Node). */
  kernels() {
    return [this.kInit, this.kShift, this.kShiftCopy, this.kCurl, this.kAdvect, this.kReact, this.kDiv, this.kJacAB, this.kJacBA,
      this.kProject[0], this.kProject[1]];
  }

  /** Pipeline'y compute powstają synchronicznie — puste dispatche (kernele wychodzą od razu) na ekranie ładowania. */
  warm(renderer) {
    if (!renderer) return;
    const live = this.U.live.value;
    this.U.live.value = 0;
    try { renderer.compute(this.kernels()); } finally { this.U.live.value = live; }
  }

  // --- wejście klatki (CPU) ----------------------------------------------------------------------------------------

  /** Początek pakowania klatki: źródła, koła i kadłuby od zera. */
  beginInputs() {
    this.srcN = 0;
    this.rockN = 0;
    this.hullN = 0;
  }

  /**
   * Źródło (świat gry względem kotwicy, j/s): A — początek xy, kierunek xy; B — długość / promień, szerokość / grubość,
   * rozszerzanie, prędkość; C — tempo narzucania [1/s], wydatek objętości, tryb (SPACE_GAS_SRC), zasięg źródła;
   * D — wstrzykiwanie gęstości na kanał [1/s]. false — brak miejsca.
   */
  addSource(ax, ay, dx, dy, len, w0, widen, speed, rate, vol, mode, reach, i1 = 0, i2 = 0, i3 = 0, ie = 0) {
    if (this.srcN >= this.maxSources) return false;
    const n = this.srcN++;
    const U = this.U;
    U.srcA.array[n].set(ax, ay, dx, dy);
    U.srcB.array[n].set(len, w0, widen, speed);
    U.srcC.array[n].set(rate, vol, mode, reach);
    U.srcD.array[n].set(i1, i2, i3, ie);
    return true;
  }

  /** Koło-przeszkoda (świat gry względem kotwicy). */
  addRock(x, y, r) {
    if (this.rockN >= this.maxRocks) return false;
    this.U.rock.array[this.rockN++].set(x, y, r, 0);
    return true;
  }

  /**
   * Kadłub-przeszkoda z rekordu GAS_HULL_REC (F — tablica, o — początek rekordu; świat gry) z kotwicą (kx, ky):
   * maska obrysu do pasma slotu (bity rozpakowane tylko przy zmianie uid / wersji). false — brak miejsca.
   */
  addHullRecord(F, o, R, kx, ky) {
    if (this.hullN >= this.maxHulls) return false;
    const n = this.hullN++;
    const U = this.U;
    const tx = F[o + R.tx] || 1, ty = F[o + R.ty] || 1;
    const ex = F[o + R.ex], ey = F[o + R.ey], fx = F[o + R.fx], fy = F[o + R.fy];
    U.hullA.array[n].set(F[o + R.ax] - kx, F[o + R.ay] - ky, ex / tx, ey / tx);
    U.hullB.array[n].set(fx / ty, fy / ty, -F[o + R.x0] / tx, -F[o + R.y0] / ty);
    U.hullC.array[n].set(F[o + R.vx], F[o + R.vy], F[o + R.w], n);
    U.hullD.array[n].set(tx, ty, F[o + R.reach], 0);
    this._syncMask(n, F, o, R);
    return true;
  }

  _syncMask(n, F, o, R) {
    if (!this._maskUid) { this._maskUid = new Float64Array(this.maxHulls).fill(NaN); this._maskVer = new Float64Array(this.maxHulls).fill(NaN); }
    const uid = F[o + R.uid], ver = F[o + R.ver];
    if (this._maskUid[n] === uid && this._maskVer[n] === ver) return;
    this._maskUid[n] = uid;
    this._maskVer[n] = ver;
    const HM = GAS_HULL_MASK, D = this.hullMaskData, base = n * HM.w * HM.h;
    for (let k = 0; k < HM.w * HM.h; k++) D[base + k] = ((F[o + R.mask + (k >>> 5)] >>> (k & 31)) & 1) ? 255 : 0;
    this._maskDirty = true;
  }

  // --- krok klatki -------------------------------------------------------------------------------------------------

  /**
   * Klatka pola: zegar kroku (1/60 s, ≤ SPACE_GAS_MAX_SUB na klatkę, × 4 w rozgrzaniu), okno przy kamerze (tylko w klatce
   * z krokiem), kernele w JEDNYM renderer.compute(lista). Wejścia (źródła, koła, kadłuby) dodane przed wywołaniem.
   * @param {object} renderer
   * @param {number} dt czas gry klatki [s] (0 — pauza: pole stoi, obraz bez zmian)
   * @param {number} camX kamera — świat gry względem kotwicy
   * @param {number} camY
   * @param {number} windX wiatr [j/s]
   * @param {number} windY
   * @returns {number} liczba kroków
   */
  frame(renderer, dt, camX, camY, windX = 0, windY = 0) {
    const U = this.U, C = this.cell, N = this.N, st = this.stats;
    dt = Math.max(0, Math.min(dt || 0, 0.1));
    U.srcCount.value = this.srcN;
    U.rockCount.value = this.rockN;
    U.hullCount.value = this.hullN;
    st.sources = this.srcN; st.rocks = this.rockN; st.hulls = this.hullN;
    if (this._maskDirty) { this.hullMaskTex.needsUpdate = true; this._maskDirty = false; }
    U.windOff.value.x += windX * dt;
    U.windOff.value.y += windY * dt;
    U.windC.value.set(windX / C, windY / C);

    const reset = this._reset;
    const speed = this.warmLeft > 0 ? 4 : 1;
    if (this.warmLeft > 0) this.warmLeft = Math.max(0, this.warmLeft - dt);
    if (reset) this.acc = 0;
    this.acc = Math.min(this.acc + dt * speed, SPACE_GAS_SUB * SPACE_GAS_MAX_SUB * speed);
    let n = 0;
    while (this.acc >= SPACE_GAS_SUB && n < SPACE_GAS_MAX_SUB * speed) { this.acc -= SPACE_GAS_SUB; n++; }
    if (reset && n === 0) n = 1;   // start okna: obraz od razu z pola (jeden krok)

    const L = this._list;
    L.length = 0;
    const img = this.image;
    if (reset || n > 0) {
      const ox = Math.floor(camX / C) - (N >> 1), oy = Math.floor(camY / C) - (N >> 1);
      const sx = ox - this.ox, sy = oy - this.oy;
      if (reset || Math.abs(sx) >= N || Math.abs(sy) >= N) {
        L.push(this.kInit);
        img.cur = 0; img.prev = 0;
        st.resets++;
        this._reset = false;
      } else if (sx || sy) {
        U.shift.value.set(sx, sy);
        L.push(this.kShift, this.kShiftCopy);
        st.shifts++;
      }
      this.ox = ox; this.oy = oy;
      U.origin.value.set(ox * C, oy * C);
      if (L[0] === this.kInit) img.origin[0].copy(U.origin.value);
    }
    for (let k = 0; k < n; k++) {
      L.push(this.kCurl, this.kAdvect, this.kReact, this.kDiv);
      for (let j = 0; j < this.tune.jacobi; j++) L.push(j % 2 === 0 ? this.kJacAB : this.kJacBA);
      const tgt = img.cur ^ 1;
      L.push(this.kProject[tgt]);
      img.prev = img.cur;
      img.cur = tgt;
      img.origin[tgt].copy(U.origin.value);
    }
    // jeden zestaw uniformów na listę: przy dwóch krokach oba z tym samym zegarem (krok pola 1/60 s, turbulencja wolna)
    this.steps += n;
    U.step.value = this.steps;
    U.time.value += n * SPACE_GAS_SUB;
    if (L.length && renderer) renderer.compute(L);
    // przenikanie obrazu: poprzedni → bieżący krok wg ułamka kroku (opóźnienie o krok, bez skoków przy 144 Hz)
    const frac = Math.min(1, this.acc / SPACE_GAS_SUB);
    img.w1 = img.prev === img.cur ? img.cur : (img.cur === 1 ? frac : 1 - frac);
    img.valid = true;
    st.substeps = n;
    st.dispatches = L.length;
    return n;
  }
}
