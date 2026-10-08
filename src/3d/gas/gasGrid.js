// src/3d/gas/gasGrid.js
//
// GAZ NA SIATCE 3D — symulacja płynu na GPU (compute WebGPU, TSL) w duchu „Grid 3D Gas” z Niagara
// Fluids: ogień, kula ognia i dym wybuchów oraz pożarów budowli (plan docs/PLAN-zniszczenia-swiata-3d.md
// § 12). Siatka Eulera, nie cząstki: dym ma kłęby, wiry i wstęgi z prawdziwego pola prędkości.
//
// DOMENY (przegródki): każdy wybuch / pożar dostaje sześcian N³ komórek ustawiony w scenie (środek
// w double, rozmiar komórki h — mały wybuch = drobna siatka). Wszystkie domeny leżą w JEDNYM atlasie
// tekstur 3D (N × N × N·S, RGBA16F, Storage3DTexture) — jeden dispatch liczy wszystkie aktywne domeny
// (lista aktywnych w uniformie; wątków = N³ · aktywne). Symulacja jest w UKŁADZIE KOMÓREK domeny
// (prędkość w komórkach/s), więc przesunięcie początku sceny (precyzja float32 przy 5–10 mln j.) to
// tylko inny uniform pozycji domeny — dane na GPU nic nie wiedzą o świecie. Domena może jechać z
// nośnikiem (wrak w ruchu): dym leci z nim jak efekty z `ActiveCarrier` (agents.md § Nośnik).
//
// KROK (stały, domyślnie 1/60 s; podkroki przy dłuższej klatce), kernele w jednym renderer.compute:
//   1. wiry      — rotacja pola prędkości (do wzmacniania wirów),
//   2a. adwekcja — RK2 wstecz (semi-Lagrange, trójliniowo sprzętowo) prędkości; źródła prędkości
//                  (kapsuły: prędkość promieniowa i kierunkowa), przeszkody (kule z prędkością — okręty
//                  i odłamki rozpychają dym), opór, siły: wzmacnianie wirów, wypór, unoszenie od środka
//                  wybuchu, turbulencja z szumu 3D (2 oktawy); surowa adwekcja skalarów (φ̂),
//   2b. reakcja  — skalary z korekcją MacCormacka (2. rząd, obcięta do sąsiadów — ostre kłęby zamiast
//                  rozmytej waty), źródła (paliwo, temperatura, dym, szum brzegu), SPALANIE (paliwo
//                  gorętsze od zapłonu płonie: ciepło, sadza, rozprężanie), stygnięcie (Newton + T⁴),
//                  zanik dymu i paliwa, miękki brzeg domeny,
//   3. dywergencja z celem ROZPRĘŻANIA (spalanie = źródło objętości — kula ognia „puchnie”),
//   4. ciśnienie — Jacobi (K iteracji, nieparzyste; rozgrzany wynikiem poprzedniego kroku), otwarte
//                  brzegi (p = 0 poza domeną — gaz swobodnie wypływa),
//   5. rzut      — v −= ∇p, kopia skalarów do tekstur startowych następnego kroku.
// Pole POZYCJI SPOCZYNKOWYCH (rest): współrzędna komórki, z której przypłynął gaz (adwekcja jak skalary, powolny
// powrót do tożsamości) — obraz czyta detal z tego pola, więc drobne kłęby jadą Z dymem. Dawny detal przesuwany
// fazami mapy przepływu co 0,7 s wracał do startu — dym „szedł i cofał się” (zgłoszenie użytkownika 2026-10-05,
// A/B: 9 zawrotek środka dymu na 3 s, bez detalu 0).
// Raz na klatkę: OBJĘTOŚĆ ŚWIATŁA — przepuszczalność ku słońcu (marsz po dymie = samocień kłębów)
// i blask ognia rozproszony w dymie (dym przy płomieniu świeci od środka na pomarańczowo).
//
// Tekstury (atlas, RGBA16F): vel (vx, vy, vz, —), den (dym, temperatura, paliwo, tempo spalania),
// prs (ciśnienie, prawa strona), curl (ω, |ω|), light (T słońca, blask rgb), rest (pozycja spoczynkowa).
// vel/prs/rest po dwie, den trzy. Pamięć: 11 × N³·S × 8 B (N = 64, S = 6: ~138 MB; gra zmniejszy N / S).

import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, float, int, uint, vec3, vec4, uvec3, uniform, uniformArray, instanceIndex, instancedArray,
  texture3D, textureStore, select, mix, clamp, smoothstep, exp, max, min, abs, length, cross, dot
} from 'three/tsl';
import { gasBlackbody, gasFirePower } from './gasCommon.js';
import { fxRandom } from '../fx/fxRandom.js';

export const GAS_GRID_DEFAULTS = Object.freeze({
  N: 64,             // komórek na bok domeny (x, y)
  NZ: 0,             // komórek w pionie (z); 0 = N. Gra z góry: płaska domena (np. 48 × 48 × 24)
  slots: 6,          // domen naraz
  jacobi: 25,        // iteracje ciśnienia (nieparzyste)
  maxSources: 192,   // źródeł na klatkę (wszystkie domeny)
  maxObstacles: 96,  // przeszkód na klatkę
  substep: 1 / 60,   // krok symulacji [s]
  maxSubsteps: 3
});

/**
 * Strojenie fizyki gazu (wspólne dla domen; uniformy). Jednostki: komórki, sekundy, temperatura
 * gazu (gasCommon.js — 1 ≈ 1600 K). Wartości dobrane w demie dema/wybuchy-webgpu.html.
 */
export function createGasTuning() {
  return {
    ignition: 0.32,     // temperatura zapłonu paliwa
    burnRate: 5.5,      // ułamek paliwa spalany na sekundę przy pełnym zapłonie
    heat: 1.0,          // przyrost temperatury na jednostkę spalonego paliwa
    soot: 0.75,         // dym (sadza) na jednostkę spalonego paliwa
    expansion: 0.5,     // rozprężanie [1/s na komórkę] na jednostkę tempa spalania (∫ = 0,5 · spalone paliwo ≈ 1,5 →
                        // objętość spalin ~5×; przy 1,4 kula ognia rosła 60× i wypełniała domenę sześcianem)
    cooling: 1.0,       // stygnięcie Newtona [1/s]
    edgeCooling: 2.5,   // przyspieszenie stygnięcia w rzadkim gazie (brzeg kuli ognia)
    radiative: 0.3,     // stygnięcie promieniste (∝ T⁴)
    smokeDecay: 0.16,   // zanik dymu [1/s] (połowa po ~4 s — dym ma się rozejść i zniknąć, decyzja użytkownika 2026-10-05)
    disperse: 0.06,     // rozprężanie zimnego dymu w próżni [1/s na jednostkę dymu] — obłok rośnie i rzednie
    restRelax: 0.05,    // powrót pola pozycji spoczynkowych do tożsamości [1/s] (detal nie rozciąga się bez końca)
    fuelDecay: 0.25,    // ulatnianie się niespalonego paliwa [1/s]
    drag: 0.9,          // opór prędkości [1/s] (front kuli ognia hamuje w ~0,5 s)
    dragQuad: 0,        // opór zależny od prędkości [1/komórka] (opór = drag + dragQuad·|v|): szybki front hamuje,
                        // wolny dym dalej odpływa (w próżni stały opór zatrzymywał dym — „wisiał w miejscu”)
    vorticity: 2.0,     // wzmacnianie wirów (ε)
    turbulence: 35,     // siła turbulencji z szumu [komórki/s²]
    turbScale: 0.055,   // częstotliwość szumu turbulencji [1/komórka]
    turbSpeed: 0.08,    // tempo zmian szumu turbulencji
    buoyancy: 7,        // wypór [komórki/s² na jednostkę T] wzdłuż buoyDir
    sootWeight: 0.6,    // ciężar dymu przeciw wyporowi
    radialLift: 2.5,    // unoszenie gorącego gazu od środka wybuchu [komórki/s² na jednostkę T]
    maxSpeed: 110,      // sufit prędkości [komórki/s]
    borderFade: 5,      // pas zaniku przy brzegu domeny [komórki]
    warm: 0.92,         // rozgrzanie ciśnienia wynikiem poprzedniego kroku
    buoyDir: [0, 1, 0], // kierunek wyporu (scena; w grze z góry — 0 albo ku kamerze)
    // Światło (objętość raz na klatkę)
    shadow: 0.9,        // gęstość optyczna dymu dla słońca [na komórkę na jednostkę dymu]
    lightStep: 2.0,     // krok marszu ku słońcu [komórki]
    fireGain: 0.45,     // moc żaru ∝ T² (T = 1 → 0,45 HDR, T = 1,5 → 1, T = 2,5 → 2,8 — ACES nie przepala barwy)
    fireBurn: 0.05,     // czysty płomień frontu spalania ∝ tempo spalania [na komórkę]
    glow: 0.8           // blask ognia rozproszony w dymie
  };
}

const LIGHT_STEPS = 16;
// Kierunki zbierania blasku ognia (6 osi + 8 przekątnych, jednostkowe) i promienie [komórki].
const GLOW_DIRS = (() => {
  const d = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const k = 1 / Math.sqrt(3);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) d.push([sx * k, sy * k, sz * k]);
  return d;
})();
const GLOW_RADII = [2.0, 4.5];

const v4Array = (n, name) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4').setName(name);

function atlasTexture(N, NZ, S, name) {
  const t = new THREE.Storage3DTexture(N, N, NZ * S);
  t.name = name;
  t.type = THREE.HalfFloatType;
  t.format = THREE.RGBAFormat;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Domena (przegródka atlasu) — stan CPU. */
class GasSlot {
  constructor(index) {
    this.index = index;
    this.active = false;
    this.cx = 0; this.cy = 0; this.cz = 0;   // środek (scena, double)
    this.h = 1;                              // rozmiar komórki [j. sceny]
    this.vx = 0; this.vy = 0; this.vz = 0;   // nośnik [j./s]
    this.rx = 0; this.ry = 0; this.rz = 0;   // środek unoszenia (scena)
    this.born = 0;
    this.until = 0;                          // koniec życia (potem wygaszanie)
    this.fadeTime = 1.6;
    this.fade = 1;                           // mnożnik obrazu 0..1
    this.extraDecay = 0;                     // dodatkowy zanik dymu przy wygaszaniu [1/s]
    this.seed = 0;
    this.clear = false;                      // wyzerować komórki przed krokiem
    this.tint = [1, 1, 1];                   // barwa dymu domeny (para / sadza)
    this.tag = 0;                            // znacznik właściciela (np. id wybuchu)
    this.priority = 0;                       // pierwszeństwo przy braku wolnej domeny (gra: stacja > okręt > kurz)
    this._camD = 0;                          // odległość² od kamery (sortowanie obrazu)
    // Zakresy źródeł / przeszkód tej klatki (pakowanie).
    this._src0 = 0; this._srcN = 0; this._obs0 = 0; this._obsN = 0;
  }
  get size() { return this.h; }
}

export class GasGrid {
  /**
   * @param {object} o
   * @param {THREE.Data3DTexture} o.noise3D szum 3D kafelkowy (fxNoise.noise3D — R, G fbm)
   * @param {number} [o.N] @param {number} [o.slots] @param {number} [o.jacobi]
   * @param {number} [o.maxSources] @param {number} [o.maxObstacles]
   * @param {{ next(): number }} [o.rng] generator efektów (domyślnie fxRandom — wizualia nie ruszają Math.random gry) — ziarna domen
   */
  constructor(o = {}) {
    const cfg = { ...GAS_GRID_DEFAULTS, ...o };
    this.N = cfg.N | 0;
    this.NZ = (cfg.NZ | 0) || this.N;
    this.S = cfg.slots | 0;
    this.jacobi = (cfg.jacobi | 1);
    this.maxSources = cfg.maxSources;
    this.maxObstacles = cfg.maxObstacles;
    this.substep = cfg.substep;
    this.maxSubsteps = cfg.maxSubsteps;
    this.noise3D = o.noise3D;
    this.rng = o.rng || fxRandom;
    this.tune = createGasTuning();
    this.time = 0;
    this._acc = 0;
    this.origin = { x: 0, y: 0, z: 0 };
    this.sunDir = new THREE.Vector3(0.45, 0.75, 0.48).normalize();
    this.slots = Array.from({ length: this.S }, (_, i) => new GasSlot(i));
    this.active = [];            // aktywne domeny w kolejności pakowania
    this.stats = { active: 0, sources: 0, obstacles: 0, substeps: 0, dropped: 0, cells: 0 };

    const N = this.N, NZ = this.NZ, S = this.S;
    this.velA = atlasTexture(N, NZ, S, 'gasVelA');
    this.velB = atlasTexture(N, NZ, S, 'gasVelB');
    this.denA = atlasTexture(N, NZ, S, 'gasDenA');
    this.denB = atlasTexture(N, NZ, S, 'gasDenB');
    this.denC = atlasTexture(N, NZ, S, 'gasDenC');
    this.prsA = atlasTexture(N, NZ, S, 'gasPrsA');
    this.prsB = atlasTexture(N, NZ, S, 'gasPrsB');
    this.curlT = atlasTexture(N, NZ, S, 'gasCurl');
    this.restA = atlasTexture(N, NZ, S, 'gasRestA');
    this.restB = atlasTexture(N, NZ, S, 'gasRestB');
    this.lightT = atlasTexture(N, NZ, S, 'gasLight');

    // Źródła i przeszkody tej klatki (CPU, świat w double → komórki przy pakowaniu).
    this._src = new Float64Array(this.maxSources * 18);
    this._srcSlot = new Int32Array(this.maxSources);
    this._srcN = 0;
    this._obs = new Float64Array(this.maxObstacles * 8);
    this._obsN = 0;

    const U = this.U = {
      dt: uniform(cfg.substep),
      time: uniform(0),
      activeCount: uniform(0, 'uint'),
      // Na aktywną domenę k: [3k] slot, początek źródeł, liczba źródeł, początek przeszkód;
      // [3k+1] liczba przeszkód, środek unoszenia (komórki); [3k+2] zanik dodatkowy, ziarno, czyść, —.
      act: v4Array(S * 3, 'gasAct'),
      srcA: v4Array(this.maxSources, 'gasSrcA'),   // p0 (komórki), promień
      srcB: v4Array(this.maxSources, 'gasSrcB'),   // p1 (komórki), siła narzucenia prędkości [1/s]
      srcC: v4Array(this.maxSources, 'gasSrcC'),   // paliwo/s, temperatura/s, dym/s, prędkość promieniowa [kom./s]
      srcD: v4Array(this.maxSources, 'gasSrcD'),   // prędkość kierunkowa [kom./s], szum brzegu
      obsA: v4Array(this.maxObstacles, 'gasObsA'), // środek (komórki), promień
      obsB: v4Array(this.maxObstacles, 'gasObsB'), // prędkość [kom./s], siła
      ignition: uniform(0), burnRate: uniform(0), heat: uniform(0), soot: uniform(0),
      expansion: uniform(0), cooling: uniform(0), radiative: uniform(0), smokeDecay: uniform(0),
      fuelDecay: uniform(0), edgeCooling: uniform(0), restRelax: uniform(0.05), disperse: uniform(0), drag: uniform(0), dragQuad: uniform(0), vorticity: uniform(0), turbulence: uniform(0),
      turbScale: uniform(0), buoyancy: uniform(0), sootWeight: uniform(0), radialLift: uniform(0),
      maxSpeed: uniform(100), borderFade: uniform(4), warm: uniform(0.9),
      buoyDir: uniform(new THREE.Vector3(0, 1, 0)),
      sunDir: uniform(new THREE.Vector3(0, 1, 0)),
      shadow: uniform(1), lightStep: uniform(2), fireGain: uniform(1), fireBurn: uniform(1), glow: uniform(1)
    };
    this._syncTune();
    this._buildKernels();
    this._list = [];
  }

  // --- TSL: pomocniki ----------------------------------------------------------

  /** Komórka wątku: indeks aktywnej domeny, slot, współrzędne, środek komórki, adres zapisu. */
  _cell() {
    const U = this.U;
    const N = this.N;
    const NZ = this.NZ;
    const N3 = N * N * NZ;
    const k = instanceIndex.div(uint(N3)).toVar();
    If(k.greaterThanEqual(U.activeCount), () => { Return(); });
    const local = instanceIndex.mod(uint(N3)).toVar();
    const xi = int(local.mod(uint(N))).toVar();
    const yi = int(local.div(uint(N)).mod(uint(N))).toVar();
    const zi = int(local.div(uint(N * N))).toVar();
    const a0 = U.act.element(int(k).mul(3)).toVar();
    const sF = a0.x.toVar();
    const slotI = int(sF.add(0.5)).toVar();
    const p = vec3(float(xi), float(yi), float(zi)).add(0.5).toVar();
    const store = uvec3(uint(xi), uint(yi), uint(zi).add(uint(slotI).mul(uint(NZ)))).toVar();
    return { k, a0, xi, yi, zi, sF, p, store };
  }

  /** Próbka atlasu w punkcie komórkowym p domeny sF (trójliniowo, przycięta do domeny). */
  _at(tex, p, sF) {
    const N = this.N;
    const NZ = this.NZ;
    const q = clamp(p, vec3(0.5), vec3(N - 0.5, N - 0.5, NZ - 0.5));
    const uvw = vec3(q.x.mul(1 / N), q.y.mul(1 / N), q.z.add(sF.mul(NZ)).mul(1 / (NZ * this.S)));
    return texture3D(tex, uvw).level(0);
  }

  /**
   * Cel dywergencji komórki z pola den (x dym, w tempo spalania): rozprężanie spalania (źródło objętości —
   * kula ognia puchnie) i zimnego dymu w próżni. Wspólny dla kernela dywergencji i sondy (niedobieżność rzutu).
   */
  _rhsTarget(D) {
    const U = this.U;
    return D.w.mul(U.expansion).add(min(D.x, 3.0).mul(U.disperse));
  }

  _buildKernels() {
    const U = this.U;
    const N = this.N;
    const NZ = this.NZ;
    const cells = N * N * NZ * this.S;
    const at = (tex, p, sF) => this._at(tex, p, sF);
    const noise = this.noise3D;

    // 1. Wiry z pola prędkości (przed adwekcją).
    this.curlNode = Fn(() => {
      const c = this._cell();
      const V = (dx, dy, dz) => at(this.velA, c.p.add(vec3(dx, dy, dz)), c.sF).xyz;
      const xp = V(1, 0, 0).toVar(); const xm = V(-1, 0, 0).toVar();
      const yp = V(0, 1, 0).toVar(); const ym = V(0, -1, 0).toVar();
      const zp = V(0, 0, 1).toVar(); const zm = V(0, 0, -1).toVar();
      const w = vec3(
        yp.z.sub(ym.z).sub(zp.y.sub(zm.y)),
        zp.x.sub(zm.x).sub(xp.z.sub(xm.z)),
        xp.y.sub(xm.y).sub(yp.x.sub(ym.x))
      ).mul(0.5).toVar();
      textureStore(this.curlT, c.store, vec4(w, length(w)));
    })().compute(cells).setName('gasCurl');

    // Źródła domeny: pętla po kapsułach p0–p1 z promieniem (brzeg zaburzony szumem 3D); each(w, C, D, B, d, dist).
    const forSources = (c, p, a2, each) => {
      const s0 = int(c.a0.y.add(0.5));
      const sN = int(c.a0.z.add(0.5));
      Loop({ start: s0, end: s0.add(sN), type: 'int', condition: '<', name: 'gsrc' }, ({ gsrc }) => {
        const A = U.srcA.element(gsrc).toVar();
        const B = U.srcB.element(gsrc).toVar();
        const ab = B.xyz.sub(A.xyz).toVar();
        const t = clamp(dot(p.sub(A.xyz), ab).div(max(dot(ab, ab), 1e-4)), 0.0, 1.0);
        const d = p.sub(A.xyz.add(ab.mul(t))).toVar();
        const dist = length(d).toVar();
        const D = U.srcD.element(gsrc).toVar();
        If(dist.lessThan(A.w.mul(D.w.add(1.0))), () => {
          const C = U.srcC.element(gsrc).toVar();
          const nz = texture3D(noise, p.mul(0.12).add(vec3(a2.y, a2.y.mul(1.7), U.time.mul(0.31)))).level(0).x;
          const rEff = A.w.mul(float(1.0).add(D.w.mul(nz.sub(0.5).mul(2.0))));
          const w = float(1.0).sub(smoothstep(rEff.mul(0.45), max(rEff, 0.6), dist)).toVar();
          each(w, C, D, B, d, dist, nz);
        });
      });
    };
    // RK2 wstecz (punkt środkowy) z pola velA.
    const backtrace = (p, sF, dt) => {
      const v0 = at(this.velA, p, sF).xyz.toVar();
      const pm = p.sub(v0.mul(dt.mul(0.5)));
      const vm = at(this.velA, pm, sF).xyz.toVar();
      return { v0, pb: p.sub(vm.mul(dt)).toVar() };
    };

    // 2a. Adwekcja prędkości (+ źródła prędkości, przeszkody, siły) i surowa adwekcja skalarów (φ̂ do MacCormacka).
    this.advectNode = Fn(() => {
      const c = this._cell();
      const p = c.p;
      const sF = c.sF;
      const dt = U.dt;
      const a1 = U.act.element(int(c.k).mul(3).add(1)).toVar();
      const a2 = U.act.element(int(c.k).mul(3).add(2)).toVar();
      const { pb } = backtrace(p, sF, dt);
      const vel = at(this.velA, pb, sF).xyz.toVar();
      const den = at(this.denA, pb, sF).toVar();
      textureStore(this.denB, c.store, den);
      // Pozycja spoczynkowa: niesiona z gazem, powoli wraca do własnej komórki.
      const rest = at(this.restA, pb, sF).xyz;
      textureStore(this.restB, c.store, vec4(mix(rest, p, float(1.0).sub(exp(U.restRelax.negate().mul(dt)))), 0.0));
      const smoke = den.x;
      const temp = den.y;

      // Źródła: narzucona prędkość promieniowa (od osi kapsuły) i kierunkowa.
      // Prędkość promieniowa zaburzona szumem — front wybuchu wychodzi „palcami”, nie gładką kulą.
      forSources(c, p, a2, (w, C, D, B, d, dist, nz) => {
        const dir = d.div(max(dist, 0.35));
        const vTarget = dir.mul(C.w.mul(nz.mul(1.1).add(0.45))).add(D.xyz);
        vel.assign(mix(vel, vTarget, clamp(B.w.mul(w).mul(dt), 0.0, 1.0)));
      });

      // Przeszkody (kadłuby, odłamki): narzucona prędkość w kuli z miękkim brzegiem.
      const o0 = int(c.a0.w.add(0.5));
      const oN = int(a1.x.add(0.5));
      Loop({ start: o0, end: o0.add(oN), type: 'int', condition: '<', name: 'gobs' }, ({ gobs }) => {
        const A = U.obsA.element(gobs).toVar();
        const d = p.sub(A.xyz).toVar();
        const dist = length(d).toVar();
        If(dist.lessThan(A.w.add(1.5)), () => {
          const B = U.obsB.element(gobs).toVar();
          const w = float(1.0).sub(smoothstep(A.w.sub(1.0), A.w.add(1.5), dist)).mul(B.w).toVar();
          // Prędkość ciała + wypchnięcie na zewnątrz (gaz nie wchodzi w kadłub).
          const out = d.div(max(dist, 0.3)).mul(max(length(B.xyz), 6.0).mul(0.35));
          vel.assign(mix(vel, B.xyz.add(out), w));
        });
      });

      // Siły: wzmacnianie wirów (ε h (N × ω)), wypór, unoszenie od środka wybuchu, turbulencja (2 oktawy).
      const W = (dx, dy, dz) => at(this.curlT, p.add(vec3(dx, dy, dz)), sF).w;
      const om = at(this.curlT, p, sF).xyz.toVar();
      const eta = vec3(W(1, 0, 0).sub(W(-1, 0, 0)), W(0, 1, 0).sub(W(0, -1, 0)), W(0, 0, 1).sub(W(0, 0, -1))).mul(0.5).toVar();
      const nv = eta.div(max(length(eta), 1e-4));
      const fvc = cross(nv, om).mul(U.vorticity);
      const fb = U.buoyDir.mul(temp.mul(U.buoyancy).sub(smoke.mul(U.sootWeight)));
      const rd = p.sub(a1.yzw).toVar();
      const fr = rd.div(max(length(rd), 1.0)).mul(temp.mul(U.radialLift));
      const tq = p.mul(U.turbScale).add(vec3(a2.y.mul(3.1), a2.y.mul(1.3), U.time.mul(0.6)));
      const n1 = texture3D(noise, tq).level(0).xy;
      const n2 = texture3D(noise, tq.mul(1.37).add(vec3(0.41, 0.17, 0.73))).level(0).x;
      const tq2 = p.mul(U.turbScale.mul(2.7)).add(vec3(a2.y.mul(1.7), U.time.mul(1.1), a2.y.mul(2.3)));
      const n3 = texture3D(noise, tq2).level(0).xy;
      const n4 = texture3D(noise, tq2.mul(1.29).add(vec3(0.63, 0.29, 0.11))).level(0).x;
      const turbW = clamp(temp.mul(1.6).add(smoke.mul(0.35)), 0.0, 1.0);
      const ft = vec3(n1.x, n1.y, n2).sub(0.5).mul(2.0).add(vec3(n3.x, n3.y, n4).sub(0.5).mul(1.1)).mul(U.turbulence).mul(turbW);
      vel.addAssign(fvc.add(fb).add(fr).add(ft).mul(dt));
      vel.mulAssign(exp(U.drag.add(U.dragQuad.mul(length(vel))).negate().mul(dt)));
      textureStore(this.velB, c.store, vec4(vel, 0.0));
    })().compute(cells).setName('gasAdvect');

    // 2b. Skalary: korekcja MacCormacka (φ̂ + ½(φ − φ̃), obcięta do sąsiadów punktu wstecz — ostre kłęby
    // bez drgań), źródła, SPALANIE, stygnięcie, zanik, brzeg domeny.
    this.reactNode = Fn(() => {
      const c = this._cell();
      const p = c.p;
      const sF = c.sF;
      const dt = U.dt;
      const a2 = U.act.element(int(c.k).mul(3).add(2)).toVar();
      const { v0, pb } = backtrace(p, sF, dt);
      const phi = at(this.denA, p, sF).xyz;
      const hat = at(this.denB, p, sF).xyz.toVar();
      const tilde = at(this.denB, p.add(v0.mul(dt)), sF).xyz;
      const mc = hat.add(phi.sub(tilde).mul(0.5)).toVar();
      // Obcięcie do min / max 8 komórek wokół punktu wstecz (stabilność, brak nowych ekstremów).
      const b0 = pb.sub(0.5).floor().add(0.5).toVar();
      const lo = vec3(1e6).toVar();
      const hi = vec3(-1e6).toVar();
      for (let i = 0; i < 8; i++) {
        const s = at(this.denA, b0.add(vec3(i & 1, (i >> 1) & 1, (i >> 2) & 1)), sF).xyz;
        lo.assign(min(lo, s));
        hi.assign(max(hi, s));
      }
      const den = clamp(mc, lo, hi).toVar();
      const smoke = den.x.toVar();
      const temp = den.y.toVar();
      const fuel = den.z.toVar();
      // Źródła: paliwo (nierówno — drobny szum daje gorące kieszenie i chłodniejsze pasma), temperatura
      // (zapłon), dym.
      const fuelNoise = texture3D(noise, p.mul(0.19).add(vec3(a2.y.mul(2.3), a2.y, a2.y.mul(0.7)))).level(0).y;
      const fuelK = fuelNoise.mul(1.6).add(0.2).toVar();
      forSources(c, p, a2, (w, C) => {
        fuel.addAssign(C.x.mul(w).mul(dt).mul(fuelK));
        // Zapłon też nierówny (równa temperatura źródła dawała w pierwszej 0,1 s gładki czerwony dysk).
        temp.addAssign(C.y.mul(w).mul(dt).mul(fuelK.mul(0.7).add(0.3)));
        smoke.addAssign(C.z.mul(w).mul(dt));
      });
      // Spalanie paliwa: zapłon od temperatury, ciepło, sadza, rozprężanie (tempo w den.w).
      const ign = smoothstep(U.ignition, U.ignition.mul(1.8), temp);
      const burn = min(fuel, fuel.mul(U.burnRate).mul(ign).mul(dt)).toVar();
      fuel.subAssign(burn);
      temp.addAssign(burn.mul(U.heat));
      smoke.addAssign(burn.mul(U.soot));
      const burnRate = burn.div(dt);
      // Stygnięcie: Newton (szybsze w rzadkim gazie — brzeg kuli ognia stygnie pierwszy i owija ją
      // ciemna skóra sadzy) + promieniste ∝ T⁴; zanik dymu i paliwa.
      const thin = float(1.0).sub(smoothstep(0.15, 1.6, smoke));
      const cool = U.cooling.mul(thin.mul(U.edgeCooling).add(1.0));
      const t2 = temp.mul(temp);
      temp.assign(max(temp.mul(exp(cool.negate().mul(dt))).sub(t2.mul(t2).mul(U.radiative).mul(dt)), 0.0));
      smoke.mulAssign(exp(U.smokeDecay.add(a2.x).negate().mul(dt)));
      fuel.mulAssign(exp(U.fuelDecay.negate().mul(dt)));
      // Brzeg domeny: KULA z brzegiem zaburzonym szumem (0,74–0,97 promienia) + pas przy ścianach —
      // nasycona domena wygląda jak nieregularny obłok, nie pudło (reaktor wypełniał sześcian).
      const e = min(min(min(p.x, float(N).sub(p.x)), min(p.y, float(N).sub(p.y))), min(p.z, float(NZ).sub(p.z)));
      const halfD = vec3(N * 0.5, N * 0.5, NZ * 0.5);
      const rr = length(p.sub(halfD).div(halfD));
      const bn = texture3D(noise, p.mul(0.021).add(vec3(a2.y.mul(0.37), a2.y.mul(0.11), 0.5))).level(0).y;
      const ball = float(1.0).sub(smoothstep(0.74, 0.97, rr.add(bn.sub(0.5).mul(0.22))));
      const edge = smoothstep(0.0, U.borderFade, e.sub(0.5)).mul(ball);
      const edgeK = mix(exp(dt.mul(-9.0)), float(1.0), edge);
      smoke.mulAssign(edgeK);
      temp.mulAssign(edgeK);
      fuel.mulAssign(edgeK);
      textureStore(this.denC, c.store, vec4(max(smoke, 0.0), temp, max(fuel, 0.0), burnRate));
    })().compute(cells).setName('gasReact');

    // 3. Dywergencja (prawa strona równania ciśnienia) z celem rozprężania.
    this.divNode = Fn(() => {
      const c = this._cell();
      const V = (dx, dy, dz) => at(this.velB, c.p.add(vec3(dx, dy, dz)), c.sF).xyz;
      const div = V(1, 0, 0).x.sub(V(-1, 0, 0).x).add(V(0, 1, 0).y.sub(V(0, -1, 0).y)).add(V(0, 0, 1).z.sub(V(0, 0, -1).z)).mul(0.5);
      const D = at(this.denC, c.p, c.sF);
      const rhs = div.sub(this._rhsTarget(D));
      const q0 = at(this.prsB, c.p, c.sF).x.mul(U.warm);
      textureStore(this.prsA, c.store, vec4(q0, rhs, 0.0, 0.0));
    })().compute(cells).setName('gasDivergence');

    // 4. Jacobi: q = (Σ sąsiadów − rhs) / 6, poza domeną q = 0 (otwarty brzeg).
    const jacobi = (src, dst, name) => Fn(() => {
      const c = this._cell();
      const Q = (dx, dy, dz) => at(src, c.p.add(vec3(dx, dy, dz)), c.sF).x;
      const xp = select(c.xi.lessThan(int(N - 1)), Q(1, 0, 0), float(0.0));
      const xm = select(c.xi.greaterThan(int(0)), Q(-1, 0, 0), float(0.0));
      const yp = select(c.yi.lessThan(int(N - 1)), Q(0, 1, 0), float(0.0));
      const ym = select(c.yi.greaterThan(int(0)), Q(0, -1, 0), float(0.0));
      const zp = select(c.zi.lessThan(int(NZ - 1)), Q(0, 0, 1), float(0.0));
      const zm = select(c.zi.greaterThan(int(0)), Q(0, 0, -1), float(0.0));
      const rhs = at(src, c.p, c.sF).y.toVar();
      const q = xp.add(xm).add(yp).add(ym).add(zp).add(zm).sub(rhs).div(6.0);
      textureStore(dst, c.store, vec4(q, rhs, 0.0, 0.0));
    })().compute(cells).setName(name);
    this.jacAB = jacobi(this.prsA, this.prsB, 'gasJacobiAB');
    this.jacBA = jacobi(this.prsB, this.prsA, 'gasJacobiBA');

    // 5. Rzut: v −= ∇q; skalary do tekstur startowych.
    this.projectNode = Fn(() => {
      const c = this._cell();
      const Q = (dx, dy, dz) => at(this.prsB, c.p.add(vec3(dx, dy, dz)), c.sF).x;
      const xp = select(c.xi.lessThan(int(N - 1)), Q(1, 0, 0), float(0.0));
      const xm = select(c.xi.greaterThan(int(0)), Q(-1, 0, 0), float(0.0));
      const yp = select(c.yi.lessThan(int(N - 1)), Q(0, 1, 0), float(0.0));
      const ym = select(c.yi.greaterThan(int(0)), Q(0, -1, 0), float(0.0));
      const zp = select(c.zi.lessThan(int(NZ - 1)), Q(0, 0, 1), float(0.0));
      const zm = select(c.zi.greaterThan(int(0)), Q(0, 0, -1), float(0.0));
      const grad = vec3(xp.sub(xm), yp.sub(ym), zp.sub(zm)).mul(0.5);
      const v = at(this.velB, c.p, c.sF).xyz.sub(grad).toVar();
      const sp = length(v);
      v.mulAssign(min(float(1.0), U.maxSpeed.div(max(sp, 1e-3))));
      textureStore(this.velA, c.store, vec4(v, 0.0));
      textureStore(this.denA, c.store, at(this.denC, c.p, c.sF));
      textureStore(this.restA, c.store, at(this.restB, c.p, c.sF));
    })().compute(cells).setName('gasProject');

    // Zerowanie domen zajętych na nowo (flaga w act[3k+2].z).
    this.clearNode = Fn(() => {
      const c = this._cell();
      const a2 = U.act.element(int(c.k).mul(3).add(2));
      If(a2.z.lessThan(0.5), () => { Return(); });
      textureStore(this.velA, c.store, vec4(0.0));
      textureStore(this.denA, c.store, vec4(0.0));
      textureStore(this.prsB, c.store, vec4(0.0));
      textureStore(this.restA, c.store, vec4(c.p, 0.0));
    })().compute(cells).setName('gasClear');

    // Objętość światła: przepuszczalność ku słońcu i blask ognia (raz na klatkę).
    this.lightNode = Fn(() => {
      const c = this._cell();
      const p = c.p;
      const sF = c.sF;
      const tau = float(0.0).toVar();
      for (let i = 1; i <= LIGHT_STEPS; i++) {
        const q = p.add(U.sunDir.mul(U.lightStep.mul(i)));
        const inside = q.x.greaterThan(0.0).and(q.x.lessThan(float(N))).and(q.y.greaterThan(0.0)).and(q.y.lessThan(float(N)))
          .and(q.z.greaterThan(0.0)).and(q.z.lessThan(float(NZ)));
        tau.addAssign(select(inside, at(this.denA, q, sF).x, float(0.0)));
      }
      const sunT = exp(tau.mul(U.lightStep).mul(U.shadow).negate());
      const glow = vec3(0.0).toVar();
      for (const dir of GLOW_DIRS) {
        for (const r of GLOW_RADII) {
          const s = at(this.denA, p.add(vec3(dir[0] * r, dir[1] * r, dir[2] * r)), sF);
          const pw = gasFirePower(s.y, s.w, U.fireGain, U.fireBurn);
          glow.addAssign(gasBlackbody(s.y).mul(pw).mul(1 / (1 + r * r * 0.06)));
        }
      }
      const g = glow.mul(U.glow.div(GLOW_DIRS.length * GLOW_RADII.length * 0.5));
      textureStore(this.lightT, c.store, vec4(sunT, g));
    })().compute(cells).setName('gasLight');
  }

  _syncTune() {
    const T = this.tune;
    const U = this.U;
    for (const key of ['ignition', 'burnRate', 'heat', 'soot', 'expansion', 'cooling', 'radiative', 'smokeDecay',
      'fuelDecay', 'edgeCooling', 'restRelax', 'disperse', 'drag', 'dragQuad', 'vorticity', 'turbulence', 'turbScale', 'buoyancy', 'sootWeight', 'radialLift',
      'maxSpeed', 'borderFade', 'warm', 'shadow', 'lightStep', 'fireGain', 'fireBurn', 'glow']) {
      U[key].value = T[key];
    }
    const b = T.buoyDir;
    const bl = Math.hypot(b[0], b[1], b[2]) || 1;
    U.buoyDir.value.set(b[0] / bl, b[1] / bl, b[2] / bl);
  }

  // --- CPU: domeny ---------------------------------------------------------------

  /**
   * Domena dla zdarzenia w punkcie (x, y, z) sceny o promieniu `radius` [j.]. Wybuch w środku
   * żywej domeny (z zapasem) dokłada się do niej (dłuższe życie) — sąsiednie wybuchy mieszają się
   * w jednym płynie, bez nakładania pudeł. Bez wolnej domeny — zabiera najstarszą.
   * @returns {number} indeks domeny albo −1
   * opts: size [j.] (bok domeny; domyślnie 4 × promień), offset [x,y,z] (przesunięcie środka domeny,
   * np. ku górze dla dymu z wyporem), life [s] (życie po ostatnim zasileniu), carrier [vx,vy,vz],
   * tint [r,g,b], now [s] (zegar wołającego), reuse (domyślnie true), tag.
   */
  acquire(x, y, z, radius, opts = {}) {
    const now = opts.now ?? this.time;
    const life = opts.life ?? 12;
    const size = opts.size ?? radius * 4;
    if (opts.reuse !== false) {
      for (let i = 0; i < this.S; i++) {
        const s = this.slots[i];
        if (!s.active || s.until < now) continue;
        const half = s.h * this.N * 0.5;
        const m = half * 0.62 - radius;
        if (m <= 0) continue;
        // Pion: domena może być płaska (NZ < N) — wystarczy, że punkt leży w jej środkowym pasie.
        if (Math.abs(x - s.cx) < m && Math.abs(y - s.cy) < m && Math.abs(z - s.cz) < s.h * this.NZ * 0.3) {
          s.until = Math.max(s.until, now + life);
          s.rx = x; s.ry = y; s.rz = z;
          return i;
        }
      }
    }
    let pick = -1;
    for (let i = 0; i < this.S; i++) if (!this.slots[i].active) { pick = i; break; }
    if (pick < 0) {
      let best = Infinity;
      for (let i = 0; i < this.S; i++) {
        const s = this.slots[i];
        if (s.until < best) { best = s.until; pick = i; }
      }
      this.stats.dropped++;
    }
    if (pick < 0) return -1;
    const s = this.slots[pick];
    const off = opts.offset;
    s.active = true;
    s.cx = x + (off ? off[0] : 0);
    s.cy = y + (off ? off[1] : 0);
    s.cz = z + (off ? off[2] : 0);
    s.h = size / this.N;
    const car = opts.carrier;
    s.vx = car ? car[0] : 0; s.vy = car ? car[1] : 0; s.vz = car ? car[2] : 0;
    s.rx = x; s.ry = y; s.rz = z;
    s.born = now;
    s.until = now + life;
    s.fade = 1;
    s.extraDecay = 0;
    s.seed = this.rng.next() * 17.0;
    s.clear = true;
    const tint = opts.tint;
    s.tint[0] = tint ? tint[0] : 1; s.tint[1] = tint ? tint[1] : 1; s.tint[2] = tint ? tint[2] : 1;
    s.tag = opts.tag ?? 0;
    s.priority = opts.priority ?? 0;
    return pick;
  }

  /** Zwalnia domenę od razu (bez wygaszania). */
  release(slot) {
    const s = this.slots[slot];
    if (s) { s.active = false; s.clear = true; }
  }

  /** Przedłuża życie domeny (zasilanie pożarem). */
  keepAlive(slot, until) {
    const s = this.slots[slot];
    if (s && s.active) s.until = Math.max(s.until, until);
  }

  /** Czy punkt (scena) leży w domenie (z marginesem w komórkach). */
  contains(slot, x, y, z, marginCells = 2) {
    const s = this.slots[slot];
    if (!s || !s.active) return false;
    const half = s.h * (this.N * 0.5 - marginCells);
    const halfZ = s.h * Math.max(0.5, this.NZ * 0.5 - marginCells);
    return Math.abs(x - s.cx) < half && Math.abs(y - s.cy) < half && Math.abs(z - s.cz) < halfZ;
  }

  /** Domena zawierająca punkt (pierwsza z aktywnych) albo −1. */
  slotAt(x, y, z, marginCells = 2) {
    for (let i = 0; i < this.S; i++) if (this.contains(i, x, y, z, marginCells)) return i;
    return -1;
  }

  /**
   * Źródło w tej klatce (świat sceny, double): kapsuła (x0,y0,z0)–(x1,y1,z1), promień r [j.];
   * tempa na sekundę: paliwo, temperatura, dym; prędkość promieniowa od osi kapsuły [j./s];
   * prędkość kierunkowa (vx, vy, vz) [j./s]; velBlend — siła narzucenia prędkości [1/s];
   * noise — zaburzenie promienia szumem (0..1).
   */
  source(slot, x0, y0, z0, x1, y1, z1, r, fuel, temp, smoke, radial, vx, vy, vz, velBlend, noise) {
    const i = this._srcN;
    if (i >= this.maxSources || slot < 0) { this.stats.dropped++; return false; }
    this._srcN = i + 1;
    this._srcSlot[i] = slot;
    const o = i * 18;
    const A = this._src;
    A[o] = x0; A[o + 1] = y0; A[o + 2] = z0; A[o + 3] = x1; A[o + 4] = y1; A[o + 5] = z1;
    A[o + 6] = r; A[o + 7] = fuel; A[o + 8] = temp; A[o + 9] = smoke; A[o + 10] = radial;
    A[o + 11] = vx; A[o + 12] = vy; A[o + 13] = vz; A[o + 14] = velBlend; A[o + 15] = noise;
    return true;
  }

  /** Przeszkoda w tej klatce (kula sceny z prędkością [j./s]); trafia do domen, które przecina. */
  obstacle(x, y, z, r, vx, vy, vz, strength = 1) {
    const i = this._obsN;
    if (i >= this.maxObstacles) return false;
    this._obsN = i + 1;
    const o = i * 8;
    const A = this._obs;
    A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = r; A[o + 4] = vx; A[o + 5] = vy; A[o + 6] = vz; A[o + 7] = strength;
    return true;
  }

  /** Czy jakaś domena żyje. */
  get live() {
    for (let i = 0; i < this.S; i++) if (this.slots[i].active) return true;
    return false;
  }

  /**
   * Krok klatki: domeny (nośnik, życie, wygaszanie), pakowanie źródeł i przeszkód, podkroki
   * symulacji i objętość światła — wszystko w JEDNYM renderer.compute(lista). Źródła i
   * przeszkody tej klatki trzeba dodać przed wywołaniem (kasowane na końcu).
   */
  simulate(renderer, dt) {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.time += dt;
    const now = this.time;
    // Domeny: ruch z nośnikiem, wygaszanie po końcu życia.
    const act = this.active;
    act.length = 0;
    for (let i = 0; i < this.S; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      s.cx += s.vx * dt; s.cy += s.vy * dt; s.cz += s.vz * dt;
      s.rx += s.vx * dt; s.ry += s.vy * dt; s.rz += s.vz * dt;
      if (now > s.until) {
        const k = (now - s.until) / s.fadeTime;
        s.fade = Math.max(0, 1 - k);
        s.extraDecay = 1.2 + 3 * k;
        if (s.fade <= 0) { s.active = false; continue; }
      } else {
        s.fade = 1;
        s.extraDecay = 0;
      }
      act.push(s);
    }
    this.stats.active = act.length;
    if (!act.length) {
      this._srcN = 0;
      this._obsN = 0;
      this.stats.substeps = 0;
      return;
    }
    this._syncTune();
    this._pack();
    // Podkroki: co najmniej jeden na klatkę z ruchem (źródła klatki muszą wejść — przy 144 Hz
    // stały krok 1/60 gubiłby co drugą klatkę zleceń), krok ≤ substep, najwyżej maxSubsteps.
    const n = dt > 0 ? Math.min(this.maxSubsteps, Math.max(1, Math.ceil(dt / this.substep - 1e-6))) : 0;
    const L = this._list;
    L.length = 0;
    const count = this.N * this.N * this.NZ * act.length;
    this.stats.cells = count;
    let clear = false;
    for (const s of act) if (s.clear) { clear = true; s.clear = false; }
    if (clear) { this.clearNode.count = count; L.push(this.clearNode); }
    this.U.dt.value = n > 0 ? dt / n : this.substep;
    for (let k = 0; k < n; k++) {
      this.curlNode.count = count; L.push(this.curlNode);
      this.advectNode.count = count; L.push(this.advectNode);
      this.reactNode.count = count; L.push(this.reactNode);
      this.divNode.count = count; L.push(this.divNode);
      for (let j = 0; j < this.jacobi; j++) {
        const node = (j & 1) === 0 ? this.jacAB : this.jacBA;
        node.count = count;
        L.push(node);
      }
      this.projectNode.count = count; L.push(this.projectNode);
    }
    this.lightNode.count = count;
    L.push(this.lightNode);
    this.U.time.value = (now * this.tune.turbSpeed) % 64;
    renderer.compute(L);
    // Flagi zerowania zjedzone: następna klatka bez czyszczenia.
    const A = this.U.act.array;
    for (let k = 0; k < act.length; k++) A[k * 3 + 2].z = 0;
    this.stats.substeps = n;
    this._srcN = 0;
    this._obsN = 0;
  }

  // Pakowanie: lista aktywnych (act), źródła i przeszkody posortowane po domenach (komórki).
  _pack() {
    const U = this.U;
    const act = this.active;
    const A = U.act.array;
    const sun = this.sunDir;
    U.sunDir.value.copy(sun);
    U.activeCount.value = act.length;
    let srcOut = 0;
    let obsOut = 0;
    const N = this.N;
    for (let k = 0; k < act.length; k++) {
      const s = act[k];
      const h = s.h;
      const inv = 1 / h;
      const half = N * 0.5;
      const halfZ = this.NZ * 0.5;
      // Źródła tej domeny → komórki.
      const src0 = srcOut;
      for (let i = 0; i < this._srcN; i++) {
        if (this._srcSlot[i] !== s.index) continue;
        if (srcOut >= this.maxSources) break;
        const o = i * 18;
        const S = this._src;
        const a = U.srcA.array[srcOut], b = U.srcB.array[srcOut], c = U.srcC.array[srcOut], d = U.srcD.array[srcOut];
        a.set((S[o] - s.cx) * inv + half, (S[o + 1] - s.cy) * inv + half, (S[o + 2] - s.cz) * inv + halfZ, S[o + 6] * inv);
        b.set((S[o + 3] - s.cx) * inv + half, (S[o + 4] - s.cy) * inv + half, (S[o + 5] - s.cz) * inv + halfZ, S[o + 14]);
        c.set(S[o + 7], S[o + 8], S[o + 9], S[o + 10] * inv);
        d.set(S[o + 11] * inv, S[o + 12] * inv, S[o + 13] * inv, S[o + 15]);
        srcOut++;
      }
      // Przeszkody przecinające domenę.
      const obs0 = obsOut;
      const ext = h * half;
      const extZ = h * halfZ;
      for (let i = 0; i < this._obsN; i++) {
        if (obsOut >= this.maxObstacles) break;
        const o = i * 8;
        const P = this._obs;
        const r = P[o + 3];
        if (Math.abs(P[o] - s.cx) > ext + r || Math.abs(P[o + 1] - s.cy) > ext + r || Math.abs(P[o + 2] - s.cz) > extZ + r) continue;
        U.obsA.array[obsOut].set((P[o] - s.cx) * inv + half, (P[o + 1] - s.cy) * inv + half, (P[o + 2] - s.cz) * inv + halfZ, r * inv);
        U.obsB.array[obsOut].set(P[o + 4] * inv, P[o + 5] * inv, P[o + 6] * inv, P[o + 7]);
        obsOut++;
      }
      A[k * 3].set(s.index, src0, srcOut - src0, obs0);
      A[k * 3 + 1].set(obsOut - obs0, (s.rx - s.cx) * inv + half, (s.ry - s.cy) * inv + half, (s.rz - s.cz) * inv + halfZ);
      A[k * 3 + 2].set(s.extraDecay, s.seed, s.clear ? 1 : 0, 0);
    }
    this.stats.sources = srcOut;
    this.stats.obstacles = obsOut;
  }

  // --- Sonda (strojenie, testy): profile przez środek domeny i maksima kolumn ------------------

  _buildProbe() {
    const N = this.N;
    const NZ = this.NZ;
    this._probeBuf = instancedArray(N * 9, 'vec4').setName('gasProbeLine');
    this._probeMax = instancedArray(N * NZ, 'vec4').setName('gasProbeMax');
    this._probeSlot = uniform(0);
    const at = (tex, p, sF) => this._at(tex, p, sF);
    const sF = this._probeSlot;
    this._probeLineNode = Fn(() => {
      const i = instanceIndex;
      const axis = int(i.div(uint(N)));
      const j = float(i.mod(uint(N))).add(0.5);
      const c = float(N * 0.5);
      const cz = float(NZ * 0.5);
      const p = select(axis.equal(int(0)), vec3(j, c, cz), select(axis.equal(int(1)), vec3(c, j, cz), vec3(c, c, j))).toVar();
      this._probeBuf.element(i.mul(uint(3))).assign(at(this.denA, p, sF));
      this._probeBuf.element(i.mul(uint(3)).add(uint(1))).assign(at(this.velA, p, sF));
      this._probeBuf.element(i.mul(uint(3)).add(uint(2))).assign(at(this.prsB, p, sF));
    })().compute(N * 3).setName('gasProbeLine');
    this._probeMaxNode = Fn(() => {
      const i = instanceIndex;
      const y = float(i.mod(uint(N))).add(0.5);
      const z = float(i.div(uint(N))).add(0.5);
      const m = vec4(0.0).toVar();
      Loop({ start: int(0), end: int(N), type: 'int', condition: '<', name: 'px' }, ({ px }) => {
        const p = vec3(float(px).add(0.5), y, z);
        const d = at(this.denA, p, sF);
        const v = at(this.velA, p, sF).xyz;
        const q = at(this.prsB, p, sF).x;
        m.assign(max(m, vec4(d.x, d.y, length(v), abs(q))));
      });
      this._probeMax.element(i).assign(m);
    })().compute(N * NZ).setName('gasProbeMax');
    // Sumy kontrolne (strojenie fizyki: energia, wiry, niedobieżność rzutu) — kolumna (y, z), wnętrze domeny.
    this._probeSum = instancedArray(N * NZ * 2, 'vec4').setName('gasProbeSum');
    this._probeSumNode = Fn(() => {
      const i = instanceIndex;
      const yi = int(i.mod(uint(N)));
      const zi = int(i.div(uint(N)));
      const sA = vec4(0.0).toVar();
      const sB = vec4(0.0).toVar();
      const inner = yi.greaterThan(int(0)).and(yi.lessThan(int(N - 1))).and(zi.greaterThan(int(0))).and(zi.lessThan(int(NZ - 1)));
      Loop({ start: int(1), end: int(N - 1), type: 'int', condition: '<', name: 'px' }, ({ px }) => {
        const p = vec3(float(px), float(yi), float(zi)).add(0.5).toVar();
        const v = at(this.velA, p, sF).xyz.toVar();
        const d = at(this.denA, p, sF).toVar();
        const w = at(this.curlT, p, sF).w.toVar();
        const V = (dx, dy, dz) => at(this.velA, p.add(vec3(dx, dy, dz)), sF).xyz;
        const div = V(1, 0, 0).x.sub(V(-1, 0, 0).x).add(V(0, 1, 0).y.sub(V(0, -1, 0).y)).add(V(0, 0, 1).z.sub(V(0, 0, -1).z)).mul(0.5);
        const res = select(inner, abs(div.sub(this._rhsTarget(d))), float(0.0)).toVar();
        const v2 = dot(v, v).toVar();
        sA.addAssign(vec4(v2, d.x, res, d.x.mul(v2)));
        sB.assign(vec4(max(sB.x, w), max(sB.y, res), sB.z.add(d.x.mul(w)), sB.w.add(d.y)));
      });
      this._probeSum.element(i.mul(uint(2))).assign(sA);
      this._probeSum.element(i.mul(uint(2)).add(uint(1))).assign(sB);
    })().compute(N * NZ).setName('gasProbeSum');
  }

  /**
   * Odczyt kontrolny domeny `slot` (async, GPU → CPU): profile pól wzdłuż osi przez środek
   * ({ x, y, z }: tablice { smoke, T, fuel, burn, vx, vy, vz, q }) i maksima w domenie.
   */
  async probe(renderer, slot) {
    if (!this._probeLineNode) this._buildProbe();
    this._probeSlot.value = slot;
    renderer.compute([this._probeLineNode, this._probeMaxNode, this._probeSumNode]);
    const line = new Float32Array(await renderer.getArrayBufferAsync(this._probeBuf.value));
    const mx = new Float32Array(await renderer.getArrayBufferAsync(this._probeMax.value));
    const sm = new Float32Array(await renderer.getArrayBufferAsync(this._probeSum.value));
    const N = this.N;
    const axes = {};
    ['x', 'y', 'z'].forEach((name, a) => {
      const arr = [];
      for (let j = 0; j < N; j++) {
        const o = ((a * N + j) * 3) * 4;
        arr.push({
          smoke: line[o], T: line[o + 1], fuel: line[o + 2], burn: line[o + 3],
          vx: line[o + 4], vy: line[o + 5], vz: line[o + 6], q: line[o + 8], rhs: line[o + 9]
        });
      }
      axes[name] = arr;
    });
    const max4 = [0, 0, 0, 0];
    let nan = 0;
    for (let i = 0; i < mx.length; i += 4) {
      for (let k = 0; k < 4; k++) {
        const v = mx[i + k];
        if (!Number.isFinite(v)) nan++;
        else if (v > max4[k]) max4[k] = v;
      }
    }
    // Sumy: energia Σ|v|² [kom.²/s²], masa dymu Σs, energia w dymie Σs|v|², wiry max |ω| i średnie w dymie
    // Σs|ω| / Σs, niedobieżność rzutu |div v − cel| (średnia i maks. we wnętrzu), Σ T.
    let ke = 0, mass = 0, res = 0, keS = 0, wMax = 0, resMax = 0, wS = 0, heat = 0;
    for (let i = 0; i < sm.length; i += 8) {
      for (let k = 0; k < 8; k++) if (!Number.isFinite(sm[i + k])) nan++;
      ke += sm[i]; mass += sm[i + 1]; res += sm[i + 2]; keS += sm[i + 3];
      if (sm[i + 4] > wMax) wMax = sm[i + 4];
      if (sm[i + 5] > resMax) resMax = sm[i + 5];
      wS += sm[i + 6]; heat += sm[i + 7];
    }
    const inner = (N - 2) * (N - 2) * Math.max(1, this.NZ - 2);
    const sum = { ke, keS, mass, heat, wMax, wSmoke: mass > 1e-6 ? wS / mass : 0, divRes: res / inner, divResMax: resMax };
    return { axes, max: { smoke: max4[0], T: max4[1], speed: max4[2], q: max4[3] }, sum, nan };
  }

  /** Rozgrzewka: puste dispatche (licznik aktywnych 0) — pipeline'y compute bez przestoju w klatce. */
  warm(renderer) {
    this.U.activeCount.value = 0;
    const L = [this.clearNode, this.curlNode, this.advectNode, this.reactNode, this.divNode, this.jacAB, this.jacBA, this.projectNode, this.lightNode];
    for (const node of L) node.count = 64;
    renderer.compute(L);
  }

  /** Wszystkie domeny wygaszone natychmiast. */
  clear() {
    for (const s of this.slots) { s.active = false; s.clear = true; }
    this.active.length = 0;
    this._srcN = 0;
    this._obsN = 0;
  }

  dispose() {
    for (const t of [this.velA, this.velB, this.denA, this.denB, this.denC, this.prsA, this.prsB, this.curlT, this.lightT, this.restA, this.restB]) t.dispose();
  }
}
