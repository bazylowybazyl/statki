// src/3d/gasField/gasField2D.js
//
// POLE GAZU 2D na GPU (compute WebGPU, TSL) — płyn na siatce Eulera w płaszczyźnie gry, z PRZESZKODAMI
// (etap 1 gazów w grze: pył w halach K-7 — strumień silnika uderza w ścianę i rozlewa się wzdłuż niej;
// wymagania użytkownika 2026-10-07). Wzorce z gazu 3D (src/3d/gas/gasGrid.js): kernele w jednym
// renderer.compute(lista), tekstury na zmianę A / B, Jacobi z rozgrzaniem, pole pozycji spoczynkowych
// (detal jedzie z pyłem), MacCormack z obcięciem. Różnice: 2D, nieściśliwy przepływ z rzutem ciśnienia
// i MASKĄ PRZESZKÓD (bez niej gaz przenika ściany — demo dema/gazy-webgpu.html nie znało przeszkód),
// pył w powietrzu i pył ZALEGAJĄCY (podrywa go szybki przepływ, opada w spokojnym), PARA (gaz z przewodów
// paliwowych i zaworów hali — drugi składnik: nie opada, rozpływa się i znika; 2026-10-07, prośba użytkownika:
// „coś powinno ten gaz produkować i powinien być trochę widoczny”).
//
// Układ: komórki domeny (x w poprzek, y = z hali w głąb), prędkość w komórkach/s. Dane są tylko w
// komórkach — świat (5–10 mln j.) widzi wyłącznie obraz (gasFieldLayer.js, macierz w double).
//
// KROK (stały, domyślnie 1/60 s; najwyżej maxSubsteps na klatkę), kernele w jednej liście:
//   1. wiry      — rotacja pola prędkości (wzmacnianie wirów w adwekcji),
//   2. adwekcja  — RK2 wstecz; strumienie (dysze silników i ŹRÓDŁA gazu — narzucona prędkość w stożku), kadłuby (komórki stałe
//                  pod MASKĄ OBRYSU kadłuba, z prędkością ciała i jego obrotu), wzmacnianie wirów, turbulencja w pyle, opór; surowa adwekcja pyłu
//                  (φ̂) i pozycji spoczynkowych; flagi komórek stałych (przeszkoda + kadłub) na ten krok,
//   3. pył, para — MacCormack obcięty do sąsiadów, podrywanie z pokładu, opadanie, zanik (szybciej w
//                  próżni za bramą), odrastanie kurzu na pokładzie, wstrzykiwanie ze źródeł, brzeg domeny,
//   4. dywergencja (warunek ściany: prędkość komórki stałej), rozgrzanie ciśnienia,
//   5. ciśnienie — Jacobi (K iteracji, nieparzyste): ściana — Neumann (p sąsiada = p komórki), brzeg
//                  domeny — p = 0 (otwarty: gaz wypływa bramami),
//   6. rzut      — v −= ∇p, w komórkach stałych prędkość ciała, sufit prędkości; kopie do tekstur A.
// Każdy kernel pisze najwyżej 4 tekstury storage (domyślny limit WebGPU na etap).
//
// Tekstury (RGBA16F, nx × ny): vel (vx, vy), curl (ω, |ω|), flag (stała, vx, vy ciała), prs (p, prawa
// strona, stała), den (pył w powietrzu, pył na pokładzie, para, prędkość [j/s]), rest (przesunięcie pozycji
// spoczynkowej [komórki]). Rastr komórek (RGBA8, hallDustLayout.js): przeszkoda, pył startowy, wnętrze. Maski
// obrysu kadłubów (R8, pas maskH wierszy na slot kadłuba; src/game/hullFootprint.js).

import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, float, int, uint, vec2, vec3, vec4, uvec2, uniform, uniformArray, instanceIndex,
  texture, texture3D, textureStore, select, mix, clamp, smoothstep, exp, max, min, abs, length, dot, sqrt
} from 'three/tsl';

export const GAS_FIELD_2D_DEFAULTS = Object.freeze({
  jacobi: 31,       // iteracje ciśnienia (nieparzyste — wynik w prsB)
  maxJets: 56,      // strumieni na klatkę: dysze silników (do 16) + źródła gazu hali (do 40 — z buchami złączek)
  maxBodies: 16,    // kadłubów na klatkę
  maskW: 64,        // maska obrysu kadłuba: teksle wzdłuż osi X kadłuba (hallDustLayout.HALL_DUST_MASK)
  maskH: 32,        //   i wzdłuż osi Y
  substep: 1 / 60,  // krok symulacji [s]
  maxSubsteps: 3
});

/** Strojenie pola (uniformy). Prędkości progów w j/s (na komórki przelicza `sync`). */
export function createGasField2DTuning() {
  return {
    drag: 0.45,            // opór prędkości gazu [1/s]
    vorticity: 1.6,        // wzmacnianie wirów ε [komórki]
    turbulence: 7,         // turbulencja z szumu w pyle [komórki/s²]
    turbScale: 0.05,       // częstotliwość szumu turbulencji [1/komórka]
    maxSpeed: 4200,        // sufit prędkości gazu [j/s]
    warm: 0.9,             // rozgrzanie ciśnienia wynikiem poprzedniego kroku
    restRelax: 0.3,        // powrót pozycji spoczynkowych [1/s] (detal nie nawija się w wirach w „słoje”)
    restMax: 14,           // najdalsze przesunięcie pozycji spoczynkowej [komórki] (przy 24 rdzenie wirów miały słoje)
    liftLo: 160,           // prędkość [j/s], od której pył odrywa się od pokładu
    liftHi: 900,           // prędkość pełnego podrywania
    liftRate: 1.8,         // ułamek pyłu z pokładu na sekundę przy pełnym podrywaniu
    liftGain: 2.4,         // gęstość pyłu w powietrzu na jednostkę poderwanego
    settleLo: 70,          // poniżej tej prędkości pył opada w pełni
    settleHi: 320,         // powyżej — nie opada
    settleRate: 0.07,      // tempo opadania [1/s]
    decay: 0.025,          // zanik pyłu w powietrzu w hali [1/s] (najdrobniejszy pył)
    vacuumDecay: 0.7,      // zanik w próżni za bramą [1/s]
    regrow: 0.006,         // odrastanie kurzu na pokładzie do stanu startowego [1/s]
    vaporDecay: 0.2,       // rozpływanie się pary paliwa w hali [1/s] (~3,5 s do połowy)
    vaporVacuum: 0.9,      // dodatkowy zanik pary w próżni za bramą [1/s]
    borderFade: 8         // pas zaniku przy brzegu domeny [komórki]
  };
}

const v4Array = (n, name) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4').setName(name);

function fieldTexture(nx, ny, name) {
  const t = new THREE.StorageTexture(nx, ny);
  t.name = name;
  t.type = THREE.HalfFloatType;
  t.format = THREE.RGBAFormat;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class GasField2D {
  /**
   * @param {object} o
   * @param {number} o.nx @param {number} o.ny wymiary siatki (nx · ny podzielne przez 64)
   * @param {number} o.h bok komórki [j.]
   * @param {Uint8Array} o.cellData rastr komórek RGBA8 (hallDustLayout.rasterizeHallCells)
   * @param {THREE.Data3DTexture} o.noise3D szum 3D (fxNoise.noise3D — R, G fbm, zawijanie)
   */
  constructor(o) {
    const cfg = { ...GAS_FIELD_2D_DEFAULTS, ...o };
    this.nx = cfg.nx | 0;
    this.ny = cfg.ny | 0;
    this.h = cfg.h;
    this.jacobi = cfg.jacobi | 1;
    this.maxJets = cfg.maxJets;
    this.maxBodies = cfg.maxBodies;
    this.substep = cfg.substep;
    this.maxSubsteps = cfg.maxSubsteps;
    this.noise3D = cfg.noise3D;
    this.tune = createGasField2DTuning();
    this.time = 0;
    this._acc = 0;
    this._clear = true;
    this.stats = { substeps: 0, jets: 0, bodies: 0, dispatches: 0 };

    const { nx, ny } = this;
    this.cellTex = new THREE.DataTexture(cfg.cellData, nx, ny, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.cellTex.name = 'gasFieldCells';
    this.cellTex.minFilter = THREE.LinearFilter;
    this.cellTex.magFilter = THREE.LinearFilter;
    this.cellTex.wrapS = this.cellTex.wrapT = THREE.ClampToEdgeWrapping;
    this.cellTex.generateMipmaps = false;
    this.cellTex.flipY = false;
    this.cellTex.colorSpace = THREE.NoColorSpace;
    this.cellTex.needsUpdate = true;

    this.velA = fieldTexture(nx, ny, 'gasFieldVelA');
    this.velB = fieldTexture(nx, ny, 'gasFieldVelB');
    this.curlT = fieldTexture(nx, ny, 'gasFieldCurl');
    this.flagT = fieldTexture(nx, ny, 'gasFieldFlag');
    this.prsA = fieldTexture(nx, ny, 'gasFieldPrsA');
    this.prsB = fieldTexture(nx, ny, 'gasFieldPrsB');
    this.denA = fieldTexture(nx, ny, 'gasFieldDenA');
    this.denB = fieldTexture(nx, ny, 'gasFieldDenB');
    this.denC = fieldTexture(nx, ny, 'gasFieldDenC');
    this.restA = fieldTexture(nx, ny, 'gasFieldRestA');
    this.restB = fieldTexture(nx, ny, 'gasFieldRestB');

    // Strumienie i kadłuby tej klatki (komórki domeny; pakuje właściciel — hallDust.js).
    this.jets = new Float32Array(this.maxJets * 12);
    this.jetCount = 0;
    this.bodies = new Float32Array(this.maxBodies * 12);
    this.bodyCount = 0;

    // Maski OBRYSU kadłubów (kadłub rozcina gaz swoim kształtem, nie pudłem — zgłoszenie użytkownika 2026-10-07):
    // pas maskH wierszy na slot kadłuba, R8 z filtrem liniowym (krawędź = próg 0,5 między tekslami). Dane pisze
    // właściciel (maskData), po zmianie `markMasks()` — wysyłka całej tekstury (32 KB), tylko przy zmianie obrysu.
    this.maskW = cfg.maskW | 0;
    this.maskH = cfg.maskH | 0;
    this.maskData = new Uint8Array(this.maskW * this.maskH * this.maxBodies);
    this.maskTex = new THREE.DataTexture(this.maskData, this.maskW, this.maskH * this.maxBodies, THREE.RedFormat, THREE.UnsignedByteType);
    this.maskTex.name = 'gasFieldBodyMasks';
    this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.magFilter = THREE.LinearFilter;
    this.maskTex.wrapS = this.maskTex.wrapT = THREE.ClampToEdgeWrapping;
    this.maskTex.generateMipmaps = false;
    this.maskTex.flipY = false;
    this.maskTex.unpackAlignment = 1;
    this.maskTex.colorSpace = THREE.NoColorSpace;
    this.maskTex.needsUpdate = true;
    this._masksDirty = false;

    this.U = {
      active: uniform(0),
      dt: uniform(cfg.substep),
      time: uniform(0),
      h: uniform(this.h),
      jetCount: uniform(0, 'int'),
      bodyCount: uniform(0, 'int'),
      // stożek (jetC.w = 0): A — początek (komórki), kierunek (jednostkowy); B — długość, szerokość u nasady
      // (komórki), rozszerzanie, prędkość [kom./s]. PROMIENIOWY (jetC.w = 1, buch pary dookoła złączki przewodu):
      // A — środek (komórki), przesunięcie szumu płatów; B — zasięg, promień obwodu (komórki), —, prędkość [kom./s].
      jetA: v4Array(this.maxJets, 'gasFieldJetA'),
      jetB: v4Array(this.maxJets, 'gasFieldJetB'),
      jetC: v4Array(this.maxJets, 'gasFieldJetC'),   // tempo narzucania [1/s], para [gęstość/s], pył [gęstość/s], tryb
      bodyA: v4Array(this.maxBodies, 'gasFieldBodyA'), // kotwica (komórki), wiersz 0 macierzy K (komórki → teksle maski)
      bodyB: v4Array(this.maxBodies, 'gasFieldBodyB'), // wiersz 1 macierzy K, przesunięcie (teksle)
      bodyC: v4Array(this.maxBodies, 'gasFieldBodyC'), // prędkość [kom./s], prędkość kątowa [rad/s], —
      drag: uniform(0), vorticity: uniform(0), turbulence: uniform(0), turbScale: uniform(0),
      maxSpeed: uniform(0), warm: uniform(0), restRelax: uniform(0), restMax: uniform(0),
      liftLo: uniform(0), liftHi: uniform(0), liftRate: uniform(0), liftGain: uniform(0),
      settleLo: uniform(0), settleHi: uniform(0), settleRate: uniform(0),
      decay: uniform(0), vacuumDecay: uniform(0), regrow: uniform(0), borderFade: uniform(0),
      vaporDecay: uniform(0), vaporVacuum: uniform(0)
    };
    this.syncTune();
    this._buildKernels();
    this._list = [];
  }

  /** Strojenie → uniformy (wołać po zmianie `tune`). */
  syncTune() {
    const T = this.tune;
    const U = this.U;
    for (const key of ['drag', 'vorticity', 'turbulence', 'turbScale', 'warm', 'restRelax', 'restMax', 'liftLo', 'liftHi',
      'liftRate', 'liftGain', 'settleLo', 'settleHi', 'settleRate', 'decay', 'vacuumDecay', 'regrow', 'borderFade',
      'vaporDecay', 'vaporVacuum']) {
      U[key].value = T[key];
    }
    U.maxSpeed.value = T.maxSpeed / this.h;
  }

  // --- TSL: pomocniki ----------------------------------------------------------

  /** Komórka wątku: współrzędne, środek komórki (komórki), adres zapisu. Bez aktywności — wyjście (rozgrzewka). */
  _cell() {
    If(this.U.active.lessThan(0.5), () => { Return(); });
    const nx = this.nx;
    const xi = int(instanceIndex.mod(uint(nx))).toVar();
    const yi = int(instanceIndex.div(uint(nx))).toVar();
    const p = vec2(float(xi), float(yi)).add(0.5).toVar();
    const store = uvec2(uint(xi), uint(yi)).toVar();
    return { xi, yi, p, store };
  }

  /** Próbka tekstury pola w punkcie komórkowym p (dwuliniowo, przycięta do domeny). */
  _at(tex, p) {
    const nx = this.nx;
    const ny = this.ny;
    const q = clamp(p, vec2(0.5), vec2(nx - 0.5, ny - 0.5));
    return texture(tex, q.mul(vec2(1 / nx, 1 / ny))).level(0);
  }

  /**
   * Profil strumienia w komórce p: stożek od nasady (A — początek, kierunek; B — długość, szerokość u nasady,
   * rozszerzanie), maleje w poprzek (Gauss) i ku końcowi. Zwraca { prof, width } (zmienne TSL; 0 poza stożkiem).
   */
  _jetProfile(p, A, B) {
    const prof = float(0.0).toVar();
    const width = float(B.y).toVar();
    const rel = p.sub(A.xy).toVar();
    const along = dot(rel, A.zw).toVar();
    If(along.greaterThan(B.y.negate()).and(along.lessThan(B.x)), () => {
      const across = rel.x.mul(A.w.negate()).add(rel.y.mul(A.z));
      width.assign(B.y.add(max(along, 0.0).mul(B.z)));
      const x = across.div(width);
      prof.assign(exp(x.mul(x).mul(-2.2))
        .mul(float(1.0).sub(smoothstep(B.x.mul(0.5), B.x, along)))
        .mul(smoothstep(B.y.negate(), 0.0, along)));
    });
    return { prof, width };
  }

  /**
   * Strumień PROMIENIOWY w komórce p (jetC.w = 1 — buch pary dookoła złączki przewodu paliwowego, 2026-10-07, prośba
   * użytkownika: przewody „buchają dymem we wszystkie strony po obwodzie” przy przypinaniu i odpinaniu): od obwodu
   * (B.y) do zasięgu (B.x) prędkość narzucana od środka, maleje jak √(r₀ / r); siła płatami z szumu (A.zw —
   * przesunięcie, każdy buch inny) — bez równego okręgu. Zwraca { prof, target } (zmienne TSL).
   */
  _jetRadial(p, A, B) {
    const rel = p.sub(A.xy).toVar();
    const r = length(rel).toVar();
    const dir = rel.div(max(r, 1e-3)).toVar();
    const lobe = this._jetLobe(dir, A);
    const prof = smoothstep(0.0, B.y, r).mul(float(1.0).sub(smoothstep(B.x.mul(0.45), B.x, r))).mul(lobe).toVar();
    const target = dir.mul(B.w.mul(sqrt(B.y.div(max(r, B.y))))).toVar();
    return { prof, target };
  }

  /** Wstrzykiwanie pary strumienia promieniowego: wąski pierścień na obwodzie złączki (dalej niesie ją przepływ). */
  _jetRadialInject(p, A, B) {
    const rel = p.sub(A.xy).toVar();
    const r = length(rel).toVar();
    const dir = rel.div(max(r, 1e-3));
    const w = max(B.y.mul(0.8), 1.0);
    const x = r.sub(B.y).div(w);
    return exp(x.mul(x).negate()).mul(this._jetLobe(dir, A));
  }

  /** Płaty buchu: szum 3D po kierunku (A.zw — przesunięcie na buch), 0,25 … 1,6. */
  _jetLobe(dir, A) {
    const n = texture3D(this.noise3D, vec3(dir.mul(0.85).add(A.zw), 0.37)).level(0).x;
    return clamp(n.sub(0.5).mul(2.6).add(0.9), 0.25, 1.6);
  }

  _buildKernels() {
    const U = this.U;
    const nx = this.nx;
    const ny = this.ny;
    const cells = nx * ny;
    const at = (tex, p) => this._at(tex, p);
    const noise = this.noise3D;

    // 1. Wiry (rotacja z velA).
    this.curlNode = Fn(() => {
      const c = this._cell();
      const V = (dx, dy) => at(this.velA, c.p.add(vec2(dx, dy))).xy;
      const w = V(1, 0).y.sub(V(-1, 0).y).sub(V(0, 1).x.sub(V(0, -1).x)).mul(0.5).toVar();
      textureStore(this.curlT, c.store, vec4(w, abs(w), 0.0, 0.0));
    })().compute(cells).setName('gasFieldCurl');

    // 2. Adwekcja prędkości + siły, flagi komórek stałych, surowa adwekcja pyłu i pozycji spoczynkowych.
    this.advectNode = Fn(() => {
      const c = this._cell();
      const p = c.p;
      const dt = U.dt;
      const info = at(this.cellTex, p).toVar();
      // RK2 wstecz (punkt środkowy)
      const v0 = at(this.velA, p).xy.toVar();
      const vm = at(this.velA, p.sub(v0.mul(dt.mul(0.5)))).xy;
      const pb = p.sub(vm.mul(dt)).toVar();
      const vel = at(this.velA, pb).xy.toVar();
      const den = at(this.denA, pb).toVar();
      const floor0 = at(this.denA, p).y;   // pył na pokładzie nie płynie
      // przesunięcie pozycji spoczynkowej: rest(p) = rest(pb) + (pb − p), powoli wraca do zera
      const off = at(this.restA, pb).xy.add(pb.sub(p)).mul(exp(U.restRelax.negate().mul(dt))).toVar();
      const offL = length(off);
      off.mulAssign(min(float(1.0), U.restMax.div(max(offL, 1e-4))));

      // Strumienie (dysze, źródła gazu): w stożku od nasady prędkość narzucana wzdłuż osi (maleje z odległością
      // i szerokością).
      Loop({ start: int(0), end: U.jetCount, type: 'int', condition: '<', name: 'gfJet' }, ({ gfJet }) => {
        const A = U.jetA.element(gfJet).toVar();
        const B = U.jetB.element(gfJet).toVar();
        const C = U.jetC.element(gfJet).toVar();
        If(C.w.greaterThan(0.5), () => {
          // promieniowy: buch pary dookoła złączki
          const R = this._jetRadial(p, A, B);
          If(R.prof.greaterThan(1e-4), () => {
            vel.assign(mix(vel, R.target, clamp(C.x.mul(dt).mul(R.prof), 0.0, 1.0)));
          });
        }).Else(() => {
          const J = this._jetProfile(p, A, B);
          If(J.prof.greaterThan(1e-4), () => {
            const spread = B.y.div(J.width);
            const target = A.zw.mul(B.w.mul(spread.mul(0.7).add(0.3)));
            vel.assign(mix(vel, target, clamp(C.x.mul(dt).mul(J.prof), 0.0, 1.0)));
          });
        });
      });

      // Wzmacnianie wirów: f = ε (N × ω), N = ∇|ω| / |∇|ω||.
      const W = (dx, dy) => at(this.curlT, p.add(vec2(dx, dy))).y;
      const om = at(this.curlT, p).x;
      const eta = vec2(W(1, 0).sub(W(-1, 0)), W(0, 1).sub(W(0, -1))).mul(0.5).toVar();
      const nv = eta.div(max(length(eta), 1e-4));
      const fvc = vec2(nv.y.mul(om), nv.x.mul(om).negate()).mul(U.vorticity);
      // Turbulencja tylko w pyle (kłęby): szum 3D (x, y, czas).
      const tq = vec3(p.mul(U.turbScale), U.time.mul(0.07));
      const n1 = texture3D(noise, tq).level(0).xy;
      const n2 = texture3D(noise, tq.mul(2.3).add(vec3(0.37, 0.71, 0.13))).level(0).xy;
      const turbW = clamp(den.x.add(den.z).mul(0.8), 0.0, 1.0);
      const ft = n1.sub(0.5).mul(2.0).add(n2.sub(0.5).mul(1.1)).mul(U.turbulence).mul(turbW);
      vel.addAssign(fvc.add(ft).mul(dt));
      vel.mulAssign(exp(U.drag.negate().mul(dt)));

      // Komórki stałe: przeszkoda (rastr) albo KADŁUB — maska obrysu w układzie kadłuba (q = K · rel + off, teksle),
      // próbka liniowa z pasa slotu, próg 0,5; prędkość komórki = prędkość ciała + ω × rel (obrót kadłuba miesza
      // gaz). Lustro CPU: hallBodySolidCpu (hallDustLayout.js).
      const MW = this.maskW;
      const MH = this.maskH;
      const flag = vec3(select(info.x.greaterThan(0.5), float(1.0), float(0.0)), 0.0, 0.0).toVar();
      Loop({ start: int(0), end: U.bodyCount, type: 'int', condition: '<', name: 'gfBody' }, ({ gfBody }) => {
        const A = U.bodyA.element(gfBody).toVar();
        const B = U.bodyB.element(gfBody).toVar();
        const rel = p.sub(A.xy).toVar();
        const q = vec2(dot(A.zw, rel), dot(B.xy, rel)).add(B.zw).toVar();
        If(q.x.greaterThan(0.0).and(q.x.lessThan(float(MW))).and(q.y.greaterThan(0.0)).and(q.y.lessThan(float(MH))), () => {
          const mu = clamp(q.x, 0.5, MW - 0.5).mul(1 / MW);
          const mv = float(gfBody).mul(MH).add(clamp(q.y, 0.5, MH - 0.5)).mul(1 / (MH * this.maxBodies));
          If(texture(this.maskTex, vec2(mu, mv)).level(0).x.greaterThan(0.5), () => {
            const C = U.bodyC.element(gfBody).toVar();
            flag.assign(vec3(1.0, C.x.sub(C.z.mul(rel.y)), C.y.add(C.z.mul(rel.x))));
          });
        });
      });
      const solid = flag.x.greaterThan(0.5).toVar();
      vel.assign(select(solid, flag.yz, vel));
      textureStore(this.velB, c.store, vec4(vel, 0.0, 0.0));
      textureStore(this.flagT, c.store, vec4(flag, 0.0));
      textureStore(this.denB, c.store, vec4(select(solid, float(0.0), den.x), floor0, select(solid, float(0.0), den.z), 0.0));
      textureStore(this.restB, c.store, vec4(off, 0.0, 0.0));
    })().compute(cells).setName('gasFieldAdvect');

    // 3. Pył i para: MacCormack obcięty do 4 sąsiadów punktu wstecz, podrywanie, opadanie, zanik, odrastanie,
    //    wstrzykiwanie ze źródeł, brzeg.
    this.reactNode = Fn(() => {
      const c = this._cell();
      const p = c.p;
      const dt = U.dt;
      const info = at(this.cellTex, p).toVar();
      const v0 = at(this.velA, p).xy.toVar();
      const pb = p.sub(v0.mul(dt)).toVar();
      const phi = at(this.denA, p).toVar();
      const hat = at(this.denB, p).toVar();
      const tilde = at(this.denB, p.add(v0.mul(dt))).toVar();
      const mc = hat.xz.add(phi.xz.sub(tilde.xz).mul(0.5));
      const b0 = pb.sub(0.5).floor().add(0.5).toVar();
      const s00 = at(this.denA, b0).xz.toVar();
      const s10 = at(this.denA, b0.add(vec2(1, 0))).xz.toVar();
      const s01 = at(this.denA, b0.add(vec2(0, 1))).xz.toVar();
      const s11 = at(this.denA, b0.add(vec2(1, 1))).xz.toVar();
      const lo = min(min(s00, s10), min(s01, s11));
      const hi = max(max(s00, s10), max(s01, s11));
      const mcc = clamp(mc, lo, hi).toVar();
      const air = mcc.x.toVar();
      const vapor = mcc.y.toVar();
      const floorD = hat.y.toVar();
      const inside = info.z.toVar();
      const speed = length(at(this.velB, p).xy).mul(U.h).toVar();   // [j/s]
      // podrywanie z pokładu (tylko we wnętrzu hali)
      const lift = floorD.mul(U.liftRate).mul(smoothstep(U.liftLo, U.liftHi, speed)).mul(inside).mul(dt)
        .min(floorD).toVar();
      floorD.subAssign(lift);
      air.addAssign(lift.mul(U.liftGain));
      // opadanie w spokojnym powietrzu (pył wraca na pokład)
      const settle = air.mul(U.settleRate).mul(float(1.0).sub(smoothstep(U.settleLo, U.settleHi, speed))).mul(inside).mul(dt).toVar();
      air.subAssign(settle);
      floorD.addAssign(settle.div(U.liftGain));
      // kurz odrasta do stanu startowego (rastr G)
      floorD.addAssign(info.y.sub(floorD).max(0.0).mul(U.regrow).mul(dt));
      // zanik: najdrobniejszy pył w hali, szybko w próżni za bramą; para rozpływa się i znika
      const outside = float(1.0).sub(inside);
      air.mulAssign(exp(U.decay.add(outside.mul(U.vacuumDecay)).negate().mul(dt)));
      vapor.mulAssign(exp(U.vaporDecay.add(outside.mul(U.vaporVacuum)).negate().mul(dt)));
      // źródła gazu (przewody paliwowe, zawory): wstrzykiwanie pary i pyłu w stożku strumienia
      Loop({ start: int(0), end: U.jetCount, type: 'int', condition: '<', name: 'gfSrc' }, ({ gfSrc }) => {
        const C = U.jetC.element(gfSrc).toVar();
        If(C.y.add(C.z).greaterThan(0.0), () => {
          const A = U.jetA.element(gfSrc).toVar();
          const B = U.jetB.element(gfSrc).toVar();
          const inj = float(0.0).toVar();
          If(C.w.greaterThan(0.5), () => {
            inj.assign(this._jetRadialInject(p, A, B));
          }).Else(() => {
            inj.assign(this._jetProfile(p, A, B).prof);
          });
          vapor.addAssign(inj.mul(C.y).mul(dt));
          air.addAssign(inj.mul(C.z).mul(dt));
        });
      });
      // brzeg domeny: pył i para wypływają i gasną
      const e = min(min(p.x, float(nx).sub(p.x)), min(p.y, float(ny).sub(p.y)));
      const edge = smoothstep(0.0, U.borderFade, e.sub(0.5));
      const fadeE = mix(exp(dt.mul(-6.0)), float(1.0), edge).toVar();
      air.mulAssign(fadeE);
      vapor.mulAssign(fadeE);
      const solid = at(this.flagT, p).x.greaterThan(0.5).toVar();
      textureStore(this.denC, c.store, vec4(select(solid, float(0.0), max(air, 0.0)), clamp(floorD, 0.0, 1.0),
        select(solid, float(0.0), clamp(vapor, 0.0, 8.0)), speed));
    })().compute(cells).setName('gasFieldDust');

    // 4. Dywergencja z warunkiem ściany (komórka stała oddaje prędkość ciała), rozgrzanie ciśnienia.
    this.divNode = Fn(() => {
      const c = this._cell();
      const p = c.p;
      const VN = (dx, dy) => {
        const q = p.add(vec2(dx, dy));
        const f = at(this.flagT, q);
        return select(f.x.greaterThan(0.5), f.yz, at(this.velB, q).xy);
      };
      const div = VN(1, 0).x.sub(VN(-1, 0).x).add(VN(0, 1).y.sub(VN(0, -1).y)).mul(0.5);
      const solid = at(this.flagT, p).x.greaterThan(0.5).toVar();
      const q0 = at(this.prsB, p).x.mul(U.warm);
      textureStore(this.prsA, c.store, vec4(select(solid, float(0.0), q0), select(solid, float(0.0), div),
        select(solid, float(1.0), float(0.0)), 0.0));
    })().compute(cells).setName('gasFieldDivergence');

    // 5. Jacobi: q = (Σ sąsiadów − rhs) / 4; sąsiad stały — Neumann (q komórki), poza domeną — 0 (otwarty brzeg).
    const jacobi = (src, dst, name) => Fn(() => {
      const c = this._cell();
      const p = c.p;
      const C0 = at(src, p).toVar();
      const Q = (dx, dy, inDomain) => {
        const s = at(src, p.add(vec2(dx, dy)));
        return select(inDomain, select(s.z.greaterThan(0.5), C0.x, s.x), float(0.0));
      };
      const xp = Q(1, 0, c.xi.lessThan(int(nx - 1)));
      const xm = Q(-1, 0, c.xi.greaterThan(int(0)));
      const yp = Q(0, 1, c.yi.lessThan(int(ny - 1)));
      const ym = Q(0, -1, c.yi.greaterThan(int(0)));
      const q = xp.add(xm).add(yp).add(ym).sub(C0.y).mul(0.25);
      textureStore(dst, c.store, vec4(select(C0.z.greaterThan(0.5), float(0.0), q), C0.y, C0.z, 0.0));
    })().compute(cells).setName(name);
    this.jacAB = jacobi(this.prsA, this.prsB, 'gasFieldJacobiAB');
    this.jacBA = jacobi(this.prsB, this.prsA, 'gasFieldJacobiBA');

    // 6. Rzut: v −= ∇q (sąsiad stały — bez spadku przez ścianę), komórka stała — prędkość ciała, sufit; kopie do A.
    this.projectNode = Fn(() => {
      const c = this._cell();
      const p = c.p;
      const C0 = at(this.prsB, p).toVar();
      const Q = (dx, dy, inDomain) => {
        const s = at(this.prsB, p.add(vec2(dx, dy)));
        return select(inDomain, select(s.z.greaterThan(0.5), C0.x, s.x), float(0.0));
      };
      const gx = Q(1, 0, c.xi.lessThan(int(nx - 1))).sub(Q(-1, 0, c.xi.greaterThan(int(0))));
      const gy = Q(0, 1, c.yi.lessThan(int(ny - 1))).sub(Q(0, -1, c.yi.greaterThan(int(0))));
      const f = at(this.flagT, p).toVar();
      const v = at(this.velB, p).xy.sub(vec2(gx, gy).mul(0.5)).toVar();
      v.assign(select(f.x.greaterThan(0.5), f.yz, v));
      v.mulAssign(min(float(1.0), U.maxSpeed.div(max(length(v), 1e-3))));
      textureStore(this.velA, c.store, vec4(v, 0.0, 0.0));
      textureStore(this.denA, c.store, at(this.denC, p));
      textureStore(this.restA, c.store, at(this.restB, p));
    })().compute(cells).setName('gasFieldProject');

    // Zerowanie (nowa hala albo długi postój): spokojny gaz, pył tylko na pokładzie (rastr G).
    this.clearNode = Fn(() => {
      const c = this._cell();
      const info = at(this.cellTex, c.p);
      textureStore(this.velA, c.store, vec4(0.0));
      textureStore(this.denA, c.store, vec4(0.0, info.y, 0.0, 0.0));
      textureStore(this.restA, c.store, vec4(0.0));
      textureStore(this.prsB, c.store, vec4(0.0, 0.0, info.x, 0.0));
    })().compute(cells).setName('gasFieldClear');
  }

  // --- CPU: klatka -----------------------------------------------------------------

  /** Maski obrysu kadłubów (`maskData`) zmienione — wysyłka przed najbliższym podkrokiem. */
  markMasks() {
    this._masksDirty = true;
  }

  /** Następny krok zaczyna od czystego stanu (nowa hala). */
  requestClear() {
    this._clear = true;
    this._acc = 0;
  }

  /** Strumienie i kadłuby tej klatki → tablice uniformów (dane w `jets` / `bodies`, liczniki ustawione). */
  _upload() {
    const U = this.U;
    const nj = Math.min(this.jetCount, this.maxJets);
    const J = this.jets;
    for (let i = 0; i < nj; i++) {
      const o = i * 12;
      U.jetA.array[i].set(J[o], J[o + 1], J[o + 2], J[o + 3]);
      U.jetB.array[i].set(J[o + 4], J[o + 5], J[o + 6], J[o + 7]);
      U.jetC.array[i].set(J[o + 8], J[o + 9], J[o + 10], J[o + 11]);
    }
    U.jetCount.value = nj;
    const nb = Math.min(this.bodyCount, this.maxBodies);
    const Bd = this.bodies;
    for (let i = 0; i < nb; i++) {
      const o = i * 12;
      U.bodyA.array[i].set(Bd[o], Bd[o + 1], Bd[o + 2], Bd[o + 3]);
      U.bodyB.array[i].set(Bd[o + 4], Bd[o + 5], Bd[o + 6], Bd[o + 7]);
      U.bodyC.array[i].set(Bd[o + 8], Bd[o + 9], Bd[o + 10], Bd[o + 11]);
    }
    U.bodyCount.value = nb;
    if (this._masksDirty) {
      this.maskTex.needsUpdate = true;
      this._masksDirty = false;
    }
    this.stats.jets = nj;
    this.stats.bodies = nb;
  }

  /**
   * Krok klatki: dt [s] czasu gry (0 w pauzie — symulacja stoi). Kernele (zerowanie, podkroki) w JEDNYM
   * renderer.compute(lista). Zwraca liczbę podkroków.
   */
  step(renderer, dt) {
    const sub = this.substep;
    this._acc = Math.min(this._acc + Math.max(0, dt), sub * this.maxSubsteps);
    let n = 0;
    while (this._acc >= sub && n < this.maxSubsteps) { this._acc -= sub; n++; }
    const L = this._list;
    L.length = 0;
    if (this._clear) { L.push(this.clearNode); this._clear = false; }
    if (n > 0) {
      this._upload();
      this.U.dt.value = sub;
      for (let s = 0; s < n; s++) {
        L.push(this.curlNode, this.advectNode, this.reactNode, this.divNode);
        for (let k = 0; k < this.jacobi; k++) L.push(k % 2 === 0 ? this.jacAB : this.jacBA);
        L.push(this.projectNode);
      }
      this.time += n * sub;
      this.U.time.value = this.time;
    }
    this.stats.substeps = n;
    this.stats.dispatches = L.length;
    if (!L.length || !renderer) return n;
    this.U.active.value = 1;
    renderer.compute(L);
    return n;
  }

  /** Rozgrzewka (ekran ładowania): wszystkie kernele z active = 0 — pipeline'y compute bez pracy. */
  warm(renderer) {
    if (!renderer) return;
    const prev = this.U.active.value;
    this.U.active.value = 0;
    renderer.compute([this.clearNode, this.curlNode, this.advectNode, this.reactNode, this.divNode,
      this.jacAB, this.jacBA, this.projectNode]);
    this.U.active.value = prev;
  }

  /** Wszystkie kernele (testy WGSL w Node). */
  kernels() {
    return [this.clearNode, this.curlNode, this.advectNode, this.reactNode, this.divNode, this.jacAB, this.jacBA, this.projectNode];
  }
}
