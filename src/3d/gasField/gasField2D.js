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
//   2. adwekcja  — RK2 wstecz; strumienie (dysze silników i ŹRÓDŁA gazu — narzucona prędkość w stożku; dysze MAIN są też
//                  ŹRÓDŁEM OBJĘTOŚCI: wydatek gazu przy wylotach, velB.z), kadłuby (komórki stałe
//                  pod MASKĄ OBRYSU kadłuba, z prędkością ciała i jego obrotu), wzmacnianie wirów, turbulencja w pyle, opór; surowa adwekcja pyłu
//                  (φ̂) i pozycji spoczynkowych; flagi komórek stałych (przeszkoda + kadłub) na ten krok,
//   3. pył, para — MacCormack obcięty do sąsiadów, rozrzedzanie gazem z dysz, podrywanie z pokładu, opadanie
//                  wszędzie (zasada zachowania pyłu), zanik (śladowy w hali, szybki w próżni za bramą), wstrzykiwanie ze źródeł, brzeg domeny,
//   4. dywergencja (warunek ściany: prędkość komórki stałej) minus CEL dywergencji (wydatek dysz z velB.z — rzut usuwa
//                  div − cel, więc strumień ROZPYCHA zapylone powietrze zamiast zasysać je z boków), rozgrzanie ciśnienia,
//   5. ciśnienie — Jacobi (K iteracji, nieparzyste; opcjonalnie miękki rzut — tune.soft): ściana — Neumann (p sąsiada = p komórki), brzeg
//                  domeny — p = 0 (otwarty: gaz wypływa bramami),
//   6. rzut      — v −= ∇p, w komórkach stałych prędkość ciała, sufit prędkości; kopie do tekstur A.
// Każdy kernel pisze najwyżej 4 tekstury storage (domyślny limit WebGPU na etap).
//
// Tekstury (RGBA16F, nx × ny): vel (vx, vy; velB.z — wydatek źródeł objętości [1/s], velB.w — rozrzedzanie spalinami [1/s]), curl (ω, |ω|), flag (stała, vx, vy ciała), prs (p, prawa
// strona, stała), den (pył w powietrzu, pył na pokładzie, para, prędkość [j/s]), rest (przesunięcie pozycji
// spoczynkowej [komórki]). Rastr komórek (RGBA8, hallDustLayout.js): przeszkoda, pył startowy, wnętrze. Maski
// obrysu kadłubów (R8, pas maskH wierszy na slot kadłuba; src/game/hullFootprint.js).

import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, Break, float, int, uint, vec2, vec3, vec4, uvec2, uniform, uniformArray, instanceIndex,
  texture, texture3D, textureStore, select, mix, clamp, smoothstep, exp, exp2, log2, floor, max, min, abs, length, dot, sqrt,
  sign, fract, hash
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
    drag: 0.2,             // opór prędkości gazu [1/s] (dawniej 0,45 — przepływ gasł w ~3 s, a wiry zastygały ostre)
    dragQuad: 0.004,       // opór szybkiego frontu [1/komórka]: drag + dragQuad·|v|·front poza stożkami strumieni (jak gaz
    dragFrontLo: 600,      //   3D wybuchów); pasmo prędkości [j/s], w którym wchodzi (front 0 → 1)
    dragFrontHi: 1500,
    vorticity: 1.6,        // wzmacnianie wirów ε [komórki]
    turbulence: 7,         // turbulencja z szumu [komórki/s²] — w pyle i parze …
    turbShear: 0.15,       // … i w czystym gazie przy dużym ścinaniu: waga |ω| [s] (rdzenie wirów nie żyją bez zaburzeń)
    dustDiff: 0.6,         // dyfuzja pyłu i pary [komórki²/s] (bez niej spirale zastygały ostre — „słoje”)
    eddyDiff: 0.12,        // dyfuzja wirowa: + eddyDiff·|ω| [komórki²]
    turbScale: 0.05,       // częstotliwość szumu turbulencji [1/komórka]
    maxSpeed: 4200,        // sufit prędkości gazu [j/s]
    warm: 0.9,             // rozgrzanie ciśnienia wynikiem poprzedniego kroku
    soft: 0.01,            // MIĘKKI RZUT [1/komórka²]: cel dywergencji −soft·p (słaba ściśliwość = „ucieczka w pion” nad kadłuby
                           //   w prawdziwej hali 720 j. wysokości); Jacobi rozwiązuje (∇² − soft)·p = div − cel. 0 — nieściśliwy
    restRelax: 0.3,        // powrót pozycji spoczynkowych [1/s] (detal nie nawija się w wirach w „słoje”)
    restMax: 14,           // najdalsze przesunięcie pozycji spoczynkowej [komórki] (przy 24 rdzenie wirów miały słoje)
    liftLo: 150,           // prędkość [j/s], od której pył odrywa się od pokładu
    liftHi: 650,           // prędkość pełnego podrywania (~0,5 szczytu prędkości przy wylotach MAIN — ~1150 j/s 4–10 komórek za wylotem;
                           //   dawne 900 — pełne podrywanie tylko w rdzeniu, wąski klin oczyszczonego pokładu)
    liftRate: 1.8,         // ułamek pyłu z pokładu na sekundę przy pełnym podrywaniu
    liftGain: 2.4,         // gęstość pyłu w powietrzu na jednostkę poderwanego
    settleLo: 70,          // poniżej tej prędkości pył opada w pełni
    settleHi: 320,         // powyżej — nie opada
    settleRate: 0.09,      // tempo opadania [1/s]
    settleMin: 0.3,        // opadanie przy szybkim przepływie (≥ settleHi): ułamek pełnego — pył opada WSZĘDZIE, nigdy 0
    decay: 0.002,          // zanik pyłu w powietrzu w hali [1/s] — śladowy (zasada zachowania: pył wraca na pokład)
    vacuumDecay: 0.7,      // zanik w próżni za bramą [1/s]
    regrow: 0,             // odrastanie kurzu na pokładzie do stanu startowego [1/s] (0 — kurz wraca tylko opadaniem)
    vaporDecay: 0.2,       // rozpływanie się pary paliwa w hali [1/s] (~3,5 s do połowy)
    vaporVacuum: 0.9,      // dodatkowy zanik pary w próżni za bramą [1/s]
    borderFade: 8,        // pas zaniku przy brzegu domeny [komórki]
    jetClean: 6,          // rozrzedzanie pyłu i pary w stożku dysz MAIN [1/s] × profil: strumień to spaliny z dysz, nie zapylone
                          //   powietrze — kurz poderwany pod strumieniem nie zostaje w jego rdzeniu (tunel na szerokość gromady)
    jetFlat: 0.69         // profil PŁASKI strumienia z gromady dysz (jetD.z = 1): exp(−k·(x / w)⁴), k = ln 2 — połowa na brzegu
  };
}

const smoothCpu = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * LUSTRO CPU profilu stożka (_jetProfile): along / across [komórki] względem nasady; len, w0, widen — jetB.xyz;
 * flat — profil płaski (jetD.z), k — strojenie jetFlat.
 */
export function jetProfileCpu(along, across, len, w0, widen, flat, k = 0.69) {
  if (!(along > -w0 && along < len)) return 0;
  const width = w0 + Math.max(along, 0) * widen;
  const x2 = (across / width) ** 2;
  const shape = flat ? Math.exp(-k * x2 * x2) : Math.exp(-2.2 * x2);
  return shape * (1 - smoothCpu(0.5 * len, len, along)) * smoothCpu(-w0, 0, along);
}

/** LUSTRO CPU wagi źródła objętości wzdłuż osi (_jetSourceAlong). */
export function jetSourceAlongCpu(along, Ls) {
  return smoothCpu(-1, 2, along) * (1 - smoothCpu(0.5 * Ls, Ls, along));
}

/**
 * LUSTRO CPU zasłaniania stożka (_jetVisible): rastr komórek (RGBA8, hallDustLayout.rasterizeHallCells) o wymiarach
 * nx × ny, komórka (px, py) i wylot (ax, ay) w komórkach; próbka kanału A dwuliniowo jak tekstura (środki teksli w +0,5).
 */
export function jetVisibleCpu(cells, nx, ny, px, py, ax, ay) {
  const A = (x, y) => {
    const fx = Math.min(Math.max(x, 0.5), nx - 0.5) - 0.5;
    const fy = Math.min(Math.max(y, 0.5), ny - 0.5) - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const i1 = Math.min(i + 1, nx - 1), j1 = Math.min(j + 1, ny - 1);
    const g = (ii, jj) => cells[(jj * nx + ii) * 4 + 3] / 255;
    return ((g(i, j) * (1 - u) + g(i1, j) * u) * (1 - v) + (g(i, j1) * (1 - u) + g(i1, j1) * u) * v) * 63.75;
  };
  const tx = ax - px, ty = ay - py;
  const L = Math.sqrt(tx * tx + ty * ty);
  const dx = tx / Math.max(L, 1e-3), dy = ty / Math.max(L, 1e-3);
  let t = 0;
  for (let k = 0; k < 8; k++) {
    if (t >= L) break;
    const d = A(px + dx * t, py + dy * t);
    if (d < 0.6) return 0;
    t += Math.max(d - 0.5, 0.75);
  }
  return 1;
}

/** LUSTRO CPU zaokrąglania stochastycznego zapisu (_sround): r ∈ [0, 1), bias — U.roundBias (0 obcięcie, 0,5 do najbliższej). */
export function sroundCpu(x, r, bias = 0) {
  const e = Math.max(Math.floor(Math.log2(Math.max(Math.abs(x), 1e-30))), -14);
  return x + Math.sign(x) * (r - bias) * 2 ** (e - 10);
}

/** ∫ exp(−k·x⁴) dx po całej osi = 2·Γ(5/4)·k^(−1/4). */
const FLAT_ACROSS = 2 * 0.9064024770554771;

/**
 * Całka profilu źródła objętości stożka płaskiego po komórkach [komórki²]: ∫∫ prof · waga źródła dA (wzdłuż — 48
 * punktów środkowych, w poprzek — analitycznie). Wydatek na komórkę = wydatek strumienia [komórki²/s] / całka — suma
 * celu dywergencji po komórkach domeny = zadany wydatek (tests/hallDust.test.mjs). Bez alokacji.
 */
export function jetSourceIntegralCpu(len, w0, widen, Ls, k = 0.69) {
  const a0 = -Math.min(w0, 1);
  const a1 = Math.min(len, Ls);
  if (!(a1 > a0)) return 0;
  const n = 48;
  const da = (a1 - a0) / n;
  const across = FLAT_ACROSS * Math.pow(k, -0.25);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i + 0.5) * da;
    const width = w0 + Math.max(a, 0) * widen;
    s += width * across * (1 - smoothCpu(0.5 * len, len, a)) * smoothCpu(-w0, 0, a) * jetSourceAlongCpu(a, Ls);
  }
  return s * da;
}

/**
 * TEST ZAOKRĄGLANIA zapisu f32 → f16 do tekstury storage na urządzeniu (raz; raw WebGPU — poza grafem three): zapis
 * 1 + 0,75·2⁻¹⁰ do rgba16float i odczyt. 'trunc' (obcięcie ku zeru — RTX / D3D12, pomiar 2026-10-12) albo 'nearest'.
 * Wynik ustawia GasField2D.U.roundBias (_sround). Bez urządzenia / przy błędzie — null (zostaje obcięcie).
 */
export async function probeHalfRounding(device) {
  if (!device || typeof device.createComputePipeline !== 'function' || typeof GPUBufferUsage === 'undefined') return null;
  try {
    const tex = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
    const code = '@group(0) @binding(0) var t: texture_storage_2d<rgba16float, write>;\n' +
      '@compute @workgroup_size(1) fn main() { textureStore(t, vec2<u32>(0u, 0u), vec4<f32>(1.000732421875)); }';
    const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
    const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView() }] });
    const buf = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(1); pass.end();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: 256 }, [1, 1]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const h = new Uint16Array(buf.getMappedRange().slice(0, 2))[0];
    buf.unmap(); buf.destroy(); tex.destroy();
    return h === 0x3c00 ? 'trunc' : 'nearest';   // 0x3c00 = 1,0 (obcięte); 0x3c01 = 1 + 2⁻¹⁰ (do najbliższej)
  } catch (e) {
    return null;
  }
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
    this._seed = 0;
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
    // czwarta liczba-wektor strumienia (jetD): wydatek, zasięg źródła, profil, zasłanianie — zera = dawny strumień
    this.jetsD = new Float32Array(this.maxJets * 4);
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
      seed: uniform(0, 'uint'),   // ziarno klatki (zaokrąglanie stochastyczne zapisu)
      roundBias: uniform(0),      // 0 — zapis f16 obcina (RTX / D3D12), 0,5 — zaokrągla do najbliższej (probeHalfRounding)
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
      // stożek: wydatek gazu [1/s na komórkę] (źródło objętości — cel dywergencji), zasięg źródła od wylotu [komórki],
      // profil (0 — Gauss źródeł hali, 1 — płaski na szerokość gromady dysz), zasłanianie przeszkodami (1 — tak)
      jetD: v4Array(this.maxJets, 'gasFieldJetD'),
      bodyA: v4Array(this.maxBodies, 'gasFieldBodyA'), // kotwica (komórki), wiersz 0 macierzy K (komórki → teksle maski)
      bodyB: v4Array(this.maxBodies, 'gasFieldBodyB'), // wiersz 1 macierzy K, przesunięcie (teksle)
      bodyC: v4Array(this.maxBodies, 'gasFieldBodyC'), // prędkość [kom./s], prędkość kątowa [rad/s], —
      drag: uniform(0), soft: uniform(0), vorticity: uniform(0), turbulence: uniform(0), turbScale: uniform(0),
      dragQuad: uniform(0), dragFrontLo: uniform(0), dragFrontHi: uniform(0), turbShear: uniform(0),
      dustDiff: uniform(0), eddyDiff: uniform(0),
      maxSpeed: uniform(0), warm: uniform(0), restRelax: uniform(0), restMax: uniform(0),
      liftLo: uniform(0), liftHi: uniform(0), liftRate: uniform(0), liftGain: uniform(0),
      settleLo: uniform(0), settleHi: uniform(0), settleRate: uniform(0), settleMin: uniform(0),
      decay: uniform(0), vacuumDecay: uniform(0), regrow: uniform(0), borderFade: uniform(0),
      vaporDecay: uniform(0), vaporVacuum: uniform(0), jetFlat: uniform(0), jetClean: uniform(0)
    };
    this.syncTune();
    this._buildKernels();
    this._list = [];
  }

  /**
   * Test zaokrąglania zapisu f16 na urządzeniu renderera (raz, w tle): ustawia U.roundBias. Do wyniku — obcięcie
   * (roundBias 0, jak na RTX). `this.halfRounding` — wynik ('trunc' / 'nearest' / null).
   */
  probeRounding(renderer) {
    if (this._probe) return;
    const dev = renderer && renderer.backend && renderer.backend.device;
    if (!dev) return;
    this._probe = probeHalfRounding(dev).then((mode) => {
      this.halfRounding = mode;
      this.U.roundBias.value = mode === 'nearest' ? 0.5 : 0;
    });
  }

  /** Strojenie → uniformy (wołać po zmianie `tune`). */
  syncTune() {
    const T = this.tune;
    const U = this.U;
    for (const key of ['drag', 'soft', 'dragQuad', 'turbShear', 'dustDiff', 'eddyDiff', 'vorticity', 'turbulence', 'turbScale', 'warm', 'restRelax', 'restMax', 'liftLo', 'liftHi',
      'liftRate', 'liftGain', 'settleLo', 'settleHi', 'settleRate', 'settleMin', 'decay', 'vacuumDecay', 'regrow', 'borderFade',
      'vaporDecay', 'vaporVacuum', 'jetFlat', 'jetClean']) {
      U[key].value = T[key];
    }
    U.maxSpeed.value = T.maxSpeed / this.h;
    U.dragFrontLo.value = T.dragFrontLo / this.h;
    U.dragFrontHi.value = T.dragFrontHi / this.h;
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
   * rozszerzanie), maleje w poprzek i ku końcowi. W poprzek: Gauss exp(−2,2·x²) (źródła gazu hali, D.z = 0) albo PŁASKI
   * exp(−k·x⁴) na szerokość gromady dysz MAIN (D.z = 1; 2026-10-12, audyt pyłu — Gauss dawał skrajnym dyszom połowę
   * wagi środka). Zwraca { prof, width, along } (zmienne TSL; 0 poza stożkiem). Lustro CPU: jetProfileCpu.
   */
  _jetProfile(p, A, B, D = null) {
    const prof = float(0.0).toVar();
    const width = float(B.y).toVar();
    const rel = p.sub(A.xy).toVar();
    const along = dot(rel, A.zw).toVar();
    If(along.greaterThan(B.y.negate()).and(along.lessThan(B.x)), () => {
      const across = rel.x.mul(A.w.negate()).add(rel.y.mul(A.z));
      width.assign(B.y.add(max(along, 0.0).mul(B.z)));
      const x = across.div(width);
      const x2 = x.mul(x).toVar();
      const shape = D ? select(D.z.greaterThan(0.5), exp(x2.mul(x2).mul(this.U.jetFlat.negate())), exp(x2.mul(-2.2)))
        : exp(x2.mul(-2.2));
      prof.assign(shape
        .mul(float(1.0).sub(smoothstep(B.x.mul(0.5), B.x, along)))
        .mul(smoothstep(B.y.negate(), 0.0, along)));
    });
    return { prof, width, along };
  }

  /**
   * ZASŁANIANIE stożka przeszkodami (jetD.w = 1 — dysze MAIN): marsz od komórki p ku wylotowi A.xy po polu odległości
   * od przeszkód (rastr komórek, kanał A — komórki × 4), najwyżej 8 kroków; komórka za ścianą (marsz trafia w przeszkodę)
   * nie dostaje ani narzuconej prędkości, ani wydatku (dawniej stożek za ścianą tylną pompował równanie ciśnienia po
   * złej stronie ściany — audyt 2026-10-12 § 3.6). Zwraca 0 / 1 (zmienna TSL). Lustro CPU: jetVisibleCpu.
   */
  _jetVisible(p, A) {
    const to = A.xy.sub(p).toVar();
    const L = length(to).toVar();
    const dir = to.div(max(L, 1e-3)).toVar();
    const t = float(0.0).toVar();
    const vis = float(1.0).toVar();
    Loop({ start: int(0), end: int(8), type: 'int', condition: '<', name: 'gfOcc' }, () => {
      If(t.greaterThanEqual(L), () => { Break(); });
      const d = this._at(this.cellTex, p.add(dir.mul(t))).w.mul(63.75).toVar();
      If(d.lessThan(0.6), () => { vis.assign(0.0); Break(); });
      t.addAssign(max(d.sub(0.5), 0.75));
    });
    return vis;
  }

  /** Waga ŹRÓDŁA OBJĘTOŚCI wzdłuż osi: od wylotu (along ≈ 0) do zasięgu źródła Ls (D.y), wygaszona w drugiej połowie. */
  _jetSourceAlong(along, Ls) {
    return smoothstep(-1.0, 2.0, along).mul(float(1.0).sub(smoothstep(Ls.mul(0.5), Ls, along)));
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

  /**
   * ZAOKRĄGLANIE STOCHASTYCZNE zapisu do RGBA16F (r ∈ [0, 1)): x + znak(x)·(r − roundBias)·ulp(|x|). Zapis f32 → f16 do
   * tekstury storage zaokrągla w sposób zależny od sprzętu — na RTX (D3D12) OBCINA ku zeru (pomiar 2026-10-12:
   * 1,00073 → 1; probeHalfRounding). Pokład trzyma kurz 0,25…1 (odstęp liczb 2,4·10⁻⁴…4,9·10⁻⁴), a opadanie
   * dokłada w podkroku ~10⁻⁵…10⁻⁴: obcięcie zjadało każdy przyrost, a każdy ubytek zaokrąglało w dół o cały odstęp —
   * pył znikał (audyt: „~20–25 % ginie numerycznie”; spoczynek: −1300 w 24 s), prędkość gasła szybciej niż z oporu.
   * Z szumem wartość oczekiwana zapisu = x przy obcięciu (roundBias 0) i przy zaokrągleniu do najbliższej (0,5 —
   * ustawia probeHalfRounding po teście na urządzeniu).
   */
  _sround(x, r) {
    const ax = abs(x);
    const e = max(floor(log2(max(ax, 1e-30))), -14.0);
    return x.add(sign(x).mul(r.sub(this.U.roundBias)).mul(exp2(e.sub(10.0))));
  }

  /** Liczba losowa komórki w tym kroku [0, 1) (hash PCG z numeru komórki, ziarna klatki i soli kernela). */
  _rnd(salt) {
    return hash(instanceIndex.add(this.U.seed.mul(uint(this.nx * this.ny * 4))).add(uint(salt * this.nx * this.ny)));
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
      // próbka pyłu i pary tylko z komórek GAZU: ściany (rastr R) trzymają 0, więc zwykła próbka liniowa przy ścianie
      // mieszała zera i pył przy ścianach ginął w każdym podkroku (zasada zachowania — audyt 2026-10-12); dzielenie
      // przez udział gazu w tej samej próbce = interpolacja po sąsiadach-gazie
      const den = at(this.denA, pb).toVar();
      const fluid = float(1.0).sub(at(this.cellTex, pb).x);
      den.xz.divAssign(max(fluid, 0.05));
      const floor0 = at(this.denA, p).y;   // pył na pokładzie nie płynie
      // przesunięcie pozycji spoczynkowej: rest(p) = rest(pb) + (pb − p), powoli wraca do zera
      const off = at(this.restA, pb).xy.add(pb.sub(p)).mul(exp(U.restRelax.negate().mul(dt))).toVar();
      const offL = length(off);
      off.mulAssign(min(float(1.0), U.restMax.div(max(offL, 1e-4))));

      // Strumienie (dysze, źródła gazu): w stożku od nasady prędkość narzucana wzdłuż osi (maleje z odległością
      // i szerokością). Dysze MAIN są też ŹRÓDŁEM OBJĘTOŚCI (D.x — wydatek gazu [1/s na komórkę] przy wylotach): suma
      // idzie do velB.z i staje się celem dywergencji rzutu (divNode) — gaz z dysz rozpycha zapylone powietrze.
      const src = float(0.0).toVar();
      const jetW = float(0.0).toVar();   // najsilniejszy stożek w komórce (bez oporu kwadratowego w strumieniu)
      const clean = float(0.0).toVar();  // udział spalin dysz MAIN w komórce (rozrzedzanie pyłu — velB.w)
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
          const D = U.jetD.element(gfJet).toVar();
          const J = this._jetProfile(p, A, B, D);
          If(J.prof.greaterThan(1e-4).and(D.w.greaterThan(0.5)), () => {
            J.prof.mulAssign(this._jetVisible(p, A));   // komórka za przeszkodą — poza strumieniem
          });
          If(J.prof.greaterThan(1e-4), () => {
            const spread = B.y.div(J.width);
            const target = A.zw.mul(B.w.mul(spread.mul(0.7).add(0.3)));
            vel.assign(mix(vel, target, clamp(C.x.mul(dt).mul(J.prof), 0.0, 1.0)));
            jetW.assign(max(jetW, J.prof));
            clean.assign(max(clean, J.prof.mul(D.z)));   // stożek dysz MAIN (profil płaski) — spaliny
            src.addAssign(D.x.mul(J.prof).mul(this._jetSourceAlong(J.along, D.y)));
          });
        });
      });

      // Wzmacnianie wirów: f = ε (N × ω), N = ∇|ω| / |∇|ω||.
      const W = (dx, dy) => at(this.curlT, p.add(vec2(dx, dy))).y;
      const om = at(this.curlT, p).x;
      const eta = vec2(W(1, 0).sub(W(-1, 0)), W(0, 1).sub(W(0, -1))).mul(0.5).toVar();
      const nv = eta.div(max(length(eta), 1e-4));
      const fvc = vec2(nv.y.mul(om), nv.x.mul(om).negate()).mul(U.vorticity);
      // Turbulencja w pyle i parze (kłęby) oraz w czystym gazie przy dużym ścinaniu (|ω|): szum 3D (x, y, czas).
      const tq = vec3(p.mul(U.turbScale), U.time.mul(0.07));
      const n1 = texture3D(noise, tq).level(0).xy;
      const n2 = texture3D(noise, tq.mul(2.3).add(vec3(0.37, 0.71, 0.13))).level(0).xy;
      const turbW = clamp(den.x.add(den.z).mul(0.8).add(abs(om).mul(U.turbShear)), 0.0, 1.0);
      const ft = n1.sub(0.5).mul(2.0).add(n2.sub(0.5).mul(1.1)).mul(U.turbulence).mul(turbW);
      vel.addAssign(fvc.add(ft).mul(dt));
      // opór: stały + kwadratowy dla szybkiego frontu (pasmo dragFrontLo…Hi) poza stożkami strumieni (dysza trzyma rdzeń)
      const spd = length(vel);
      const front = clamp(spd.sub(U.dragFrontLo).div(max(U.dragFrontHi.sub(U.dragFrontLo), 1e-3)), 0.0, 1.0);
      const quad = U.dragQuad.mul(spd).mul(front).mul(float(1.0).sub(clamp(jetW.mul(2.0), 0.0, 1.0)));
      vel.mulAssign(exp(U.drag.add(quad).negate().mul(dt)));

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
      const ra = this._rnd(0).toVar();
      const velW = vec2(this._sround(vel.x, ra), this._sround(vel.y, fract(ra.add(0.618034))));
      textureStore(this.velB, c.store, vec4(velW, select(solid, float(0.0), src), select(solid, float(0.0), clean.mul(U.jetClean))));
      textureStore(this.flagT, c.store, vec4(flag, 0.0));
      textureStore(this.denB, c.store, vec4(select(solid, float(0.0), this._sround(den.x, fract(ra.add(0.31)))), floor0,
        select(solid, float(0.0), this._sround(den.z, fract(ra.add(0.77)))), 0.0));
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
      const pf = p.add(v0.mul(dt)).toVar();
      const tilde = at(this.denB, pf).toVar();
      tilde.xz.divAssign(max(float(1.0).sub(at(this.cellTex, pf).x), 0.05));   // jak w adwekcji: tylko komórki gazu
      const mc = hat.xz.add(phi.xz.sub(tilde.xz).mul(0.5));
      const b0 = pb.sub(0.5).floor().add(0.5).toVar();
      const s00 = at(this.denA, b0).xz.toVar();
      const s10 = at(this.denA, b0.add(vec2(1, 0))).xz.toVar();
      const s01 = at(this.denA, b0.add(vec2(0, 1))).xz.toVar();
      const s11 = at(this.denA, b0.add(vec2(1, 1))).xz.toVar();
      const lo = min(min(s00, s10), min(s01, s11));
      const hi = max(max(s00, s10), max(s01, s11));
      const mcc = clamp(mc, lo, hi).toVar();
      // dyfuzja pyłu i pary (stała + wirowa ∝ |ω|): laplasjan z 4 sąsiadów stanu z początku kroku; sąsiad stały — Neumann
      // (wartość komórki), więc ściana pyłu nie zjada. Rozmywa spirale wirów („słoje” zastygały ostre).
      const ND = (dx, dy) => {
        const q = p.add(vec2(dx, dy));
        return select(at(this.flagT, q).x.greaterThan(0.5), phi.xz, at(this.denA, q).xz);
      };
      const lap = ND(1, 0).add(ND(-1, 0)).add(ND(0, 1)).add(ND(0, -1)).sub(phi.xz.mul(4.0));
      const nu = U.dustDiff.add(U.eddyDiff.mul(at(this.curlT, p).y));
      mcc.addAssign(lap.mul(clamp(nu.mul(dt), 0.0, 0.2)));
      const air = mcc.x.toVar();
      const vapor = mcc.y.toVar();
      const floorD = hat.y.toVar();
      const inside = info.z.toVar();
      const vB = at(this.velB, p).toVar();
      const speed = length(vB.xy).mul(U.h).toVar();   // [j/s]
      // gaz z dysz (źródło objętości, vB.z [1/s]) rozrzedza pył i parę w komórce: Dc/Dt = −c·∇·v (czysty gaz wypycha
      // zapylone powietrze, a nie przejmuje jego gęstości)
      // + spaliny w stożku dysz (vB.w = jetClean · profil): rdzeń strumienia nie niesie kurzu poderwanego pod nim
      const dilute = exp(vB.z.add(vB.w).negate().mul(dt)).toVar();
      air.mulAssign(dilute);
      vapor.mulAssign(dilute);
      // podrywanie z pokładu (tylko we wnętrzu hali)
      const lift = floorD.mul(U.liftRate).mul(smoothstep(U.liftLo, U.liftHi, speed)).mul(inside).mul(dt)
        .min(floorD).toVar();
      floorD.subAssign(lift);
      air.addAssign(lift.mul(U.liftGain));
      // opadanie: pył wraca na pokład wszędzie w hali — w spokojnym powietrzu w pełni, w szybkim przepływie wolniej
      // (settleMin), nigdy 0 (zasada zachowania pyłu, audyt 2026-10-12: dawniej pył wirujący przy ścianie ginął w
      // zaniku, a pokład odrastał minutami — drugie odpalenie nie miało czego podnieść)
      const settle = air.mul(U.settleRate).mul(mix(U.settleMin, float(1.0), float(1.0).sub(smoothstep(U.settleLo, U.settleHi, speed))))
        .mul(inside).mul(dt).min(max(float(1.0).sub(floorD), 0.0).mul(U.liftGain)).toVar();
      // (nie ponad sufit pokładu 1: pył nad pełnym pokładem zostaje w powietrzu i osiada obok — dawniej nadmiar ginął)
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
      // zapis z zaokrągleniem stochastycznym (_sround) — drobne przyrosty opadania / podrywania nie giną w RGBA16F
      const rnd = this._rnd(1).toVar();
      const airW = this._sround(max(air, 0.0), rnd);
      // (pełny pokład 1 bez szumu — obcięcie szumu do sufitu dawałoby ubytek na każdej pełnej komórce)
      const floorW = select(floorD.greaterThanEqual(1.0), float(1.0), this._sround(max(floorD, 0.0), fract(rnd.add(0.618034))));
      const vaporW = this._sround(clamp(vapor, 0.0, 8.0), fract(rnd.add(0.31)));
      textureStore(this.denC, c.store, vec4(select(solid, float(0.0), max(airW, 0.0)), clamp(floorW, 0.0, 1.0),
        select(solid, float(0.0), max(vaporW, 0.0)), speed));
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
      // prawa strona = div − cel; cel = wydatek źródeł objętości (velB.z — dysze MAIN)
      const div = VN(1, 0).x.sub(VN(-1, 0).x).add(VN(0, 1).y.sub(VN(0, -1).y)).mul(0.5).sub(at(this.velB, p).z);
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
      // (∇² − soft)·q = rhs: soft > 0 — miękki rzut (cel dywergencji −soft·q, gaz pod ciśnieniem „ucieka w pion”)
      const q = xp.add(xm).add(yp).add(ym).sub(C0.y).div(U.soft.add(4.0));
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
      const rp = this._rnd(2).toVar();
      textureStore(this.velA, c.store, vec4(this._sround(v.x, rp), this._sround(v.y, fract(rp.add(0.618034))), 0.0, 0.0));
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
      const d = i * 4;
      U.jetD.array[i].set(this.jetsD[d], this.jetsD[d + 1], this.jetsD[d + 2], this.jetsD[d + 3]);
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
    this._seed = (this._seed + 1) >>> 0;
    this.U.seed.value = this._seed;
    this.stats.substeps = n;
    this.stats.dispatches = L.length;
    if (!L.length || !renderer) return n;
    this.probeRounding(renderer);
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
