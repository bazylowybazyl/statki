// src/3d/gas/gasVolume.js
//
// OBRAZ GAZU — marsz promienia przez domeny gasGrid (TSL). Dwie drogi, ten sam marsz domeny (`_march`):
//   • `node(depth)` — przebieg PEŁNOEKRANOWY (dema: RTT w połowie rozdzielczości w RenderPipeline, głębia
//     sceny obcina marsz, domeny od najbliższej, wynik składany z obrazem przed bloomem);
//   • `createMeshes()` — BRYŁY DOMEN w passie sceny (gra: Core3D rysuje wszystkie passy do jednego bufora
//     z MSAA i czyści głębię między nimi — tekstury głębi do obcięcia marszu nie ma). Pudło domeny
//     (instancja, strona tylna — kamera może być w środku) liczy promień z przestrzeni widoku (kamera
//     z góry ortho albo perspektywa — rozpoznanie po macierzy rzutu; pozycje lokalne względem początku
//     sceny, bez positionWorld float32), a PŁASZCZYZNA GRY dzieli marsz na dwie warstwy: część za
//     płaszczyzną (od kamery) rysuje się PRZED kadłubami (kolejka nieprzezroczysta — kadłub ją zasłania),
//     część przed płaszczyzną — PO nich (zasłania kadłub). Okręt w dymie jest w dymie bez głębi.
//
// W próbce:
//   • gęstość dymu × detal szumu 3D czytanego z POLA POZYCJI SPOCZYNKOWYCH symulacji (gasGrid: rest —
//     detal jedzie z gazem; dawne fazy mapy przepływu wracały co 0,7 s do startu i dym „szedł i cofał się”),
//     przesunięcie odczytu polem wirowym („kalafior”) z tego samego pola i erozja rzadkich brzegów;
//   • ogień: barwa ciała czarnego z temperatury, sadza świeci wg Kirchhoffa (σ_pochłaniania · B(T)) + czysty
//     płomień frontu spalania, temperatura zaburzona szumem (języki ognia), HDR;
//   • rozpraszanie: słońce × przepuszczalność z objętości światła (samocień kłębów) × faza
//     Henyeya–Greensteina + przybliżenie wielokrotnego rozpraszania (T^¼) + otoczenie + blask ognia
//     z objętości światła (dym przy płomieniu świeci od środka); w grze człon słońca × maska cienia słońca,
//     otoczenie × strefa nieba (skyRegion) × wypełnienie maski (sunFill — cień planety, mrok pola pasa);
//   • ŚWIATŁA SIATKI Core3D.fx.grid (bryły gry, F3 audytu 2026-10-08): dysze, lufy, trafienia, reflektory
//     doku / hal, światła INNYCH wybuchów — pętla `grid.loop` w punkcie próbki co `gridEvery` gęstych próbek
//     (σ > `gridMinSigma`; między nimi ostatnia wartość), z kolanem L / (1 + kolano · ΣL) (dym przy dyszy nie
//     bieleje) i SAMOCIENIEM z przepuszczalności dymu nad próbką wzdłuż promienia kamery (gra z góry, światła siatki
//     nad płaszczyzną: droga do światła ≈ droga do kamery; bez dodatkowych próbek) — inaczej reflektor oświetlał obłok
//     równo w całej objętości i dym tracił bryłę (A/B 2026-10-09: „kremowa wata” pod masztem doku). Światło WŁASNEJ domeny (właściciel GAS_LIGHT_OWNER_BASE + slot — explosionFx._lights) świeci
//     tylko w dalekim polu (x = odległość / zasięg ≥ ownNear…ownFar): bliżej ognia dym oświetla już emisja
//     i blask z objętości światła (bez podwójnej poświaty); dalej — blask ognia z większego zasięgu (F10);
//   • całka zachowująca energię: (S − S·e^(−σΔ)) / σ, front-to-back.
// Wyjście premultiplied: (barwa, 1 − przepuszczalność).

import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, float, int, uint, vec3, vec4, ivec2, uniform, uniformArray, texture, texture3D, screenUV, screenCoordinate,
  getViewPosition, select, mix, clamp, smoothstep, exp, max, min, abs, length, normalize, dot, pow, floor, ceil,
  attribute, positionGeometry, positionView, varyingProperty, cameraProjectionMatrix, cameraWorldMatrix
} from 'three/tsl';
import { gasFirePower, gasFireStops, gasFirePalette, gasFireGlow, gasLuma } from './gasCommon.js';
import { GAS_OCC_PACK } from './gasGrid.js';

/**
 * LUSTRO CPU zakresu kroków marszu z zajętości kolumny (GasVolume._occRange): pA — punkt komórkowy promienia w tmin
 * ({ x, y, z }), dz — przyrost z [komórki] na jednostkę t, code — kod zajętości (gasOccupancyCpu), dtW — krok, jitter,
 * nSteps. Zwraca [kStart, kEnd): poza nim próbka z (przycięta do [0,5; NZ − 0,5], trójliniowo) nie czyta warstw
 * zlo … zhi. Zmiana w shaderze = zmiana tutaj.
 */
export function gasOccRangeCpu(code, pA, dz, tmin, dtW, jitter, nSteps, NZ) {
  if (code < 0) return [0, 0];
  const zlo = Math.floor(code / GAS_OCC_PACK), zhi = code - zlo * GAS_OCC_PACK;
  const zA = zlo < 0.5 ? -1e6 : zlo - 0.5;
  const zB = zhi > NZ - 2.5 ? 1e6 : zhi + 1.5;
  if (!(Math.abs(dz) > 1e-9)) return [0, nSteps];
  const ta = tmin + (zA - pA.z) / dz, tb = tmin + (zB - pA.z) / dz;
  const tlo = Math.min(ta, tb), thi = Math.max(ta, tb);
  const cl = (v) => Math.min(Math.max(v, 0), nSteps);
  return [Math.trunc(cl(Math.floor((tlo - tmin) / dtW - jitter) - 1)), Math.trunc(cl(Math.ceil((thi - tmin) / dtW - jitter) + 2))];
}

/**
 * Właściciel świateł siatki wybuchu w domenie gazu `slot`: GAS_LIGHT_OWNER_BASE + slot (L3.w siatki). Liczba
 * poza zakresem właścicieli statków / dronów (DRONE_LIGHT_OWNER 9217); float32 dokładny.
 */
export const GAS_LIGHT_OWNER_BASE = 30000;

/**
 * Lustro CPU wkładu świateł siatki w dym (gałąź `grid` marszu `_march`) — testy. lights: [{ att, col: [r,g,b],
 * scatter, owner, x }] (jak argumenty `grid.loop`), slot — domena próbki, trans — przepuszczalność nad próbką. Zwraca
 * vec3 PO kolanie i samocieniu (cudze światła × mix(1, trans, gridShadow), własne bez). Zmiana w marszu = zmiana tutaj.
 */
export function gasGridLightCpu(lights, slot, L, trans = 1) {
  const o = [0, 0, 0], m = [0, 0, 0];   // cudze, własne
  const own = GAS_LIGHT_OWNER_BASE + slot;
  for (const l of lights) {
    const k = l.att * (l.scatter * L.gridScatter + 0.5);
    if (Math.abs(l.owner - own) < 0.5) {
      const t = Math.max(0, Math.min(1, (l.x - L.ownNear) / (L.ownFar - L.ownNear)));
      const w = t * t * (3 - 2 * t);
      for (let c = 0; c < 3; c++) m[c] += l.col[c] * k * w;
    } else for (let c = 0; c < 3; c++) o[c] += l.col[c] * k;
  }
  const sum = (o[0] + o[1] + o[2] + m[0] + m[1] + m[2]) * L.gridGain;
  const kn = L.gridGain / (1 + sum * L.gridKnee);
  const sh = 1 + (trans - 1) * L.gridShadow;   // mix(1, trans, gridShadow) — tylko cudze światła
  return [0, 1, 2].map((c) => o[c] * kn * sh + m[c] * kn);
}

/**
 * LUSTRO CPU cienia kuli-przeszkody domeny głębokiej (GasVolume._groundLit; ta sama reguła w cząstkach uderzeń —
 * src/3d/pirateRockImpactFx.js): rel — punkt względem środka kuli [3], sun — kierunek do słońca (jednostkowy) [3], r —
 * promień kuli, w — półszerokość półcienia [j.]. 1 — oświetlony, 0 — w cieniu kuli.
 */
export function gasGroundLitCpu(rel, sun, r, w) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const b = rel[0] * sun[0] + rel[1] * sun[1] + rel[2] * sun[2];
  const px = rel[0] - sun[0] * b, py = rel[1] - sun[1] * b, pz = rel[2] - sun[2] * b;
  const dperp = Math.sqrt(px * px + py * py + pz * pz);
  return Math.max(ss(-w, w, b), ss(r - w, r + w, dperp));
}

/**
 * LUSTRO CPU cięcia promienia kulą (bryły domen głębokich — marsz kończy się na skale): ro, rd (jednostkowy) [3], środek c
 * [3], promień r. Zwraca t pierwszego przecięcia > 0 albo Infinity (promień mija kulę / zaczyna się w niej).
 */
export function gasSphereClipCpu(ro, rd, c, r) {
  const ox = ro[0] - c[0], oy = ro[1] - c[1], oz = ro[2] - c[2];
  const b = ox * rd[0] + oy * rd[1] + oz * rd[2];
  const q = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - q;
  if (!(q > 0) || !(disc > 0)) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : Infinity;
}

/** Parametry obrazu gazu (uniformy). */
export function createGasLook() {
  return {
    density: 0.65,        // gęstość optyczna dymu [na komórkę na jednostkę dymu]
    albedo: [0.095, 0.085, 0.075], // sadza (para wodna ~0,8 — barwa domeny `tint`)
    sunColor: [1.0, 0.95, 0.88],
    sunGain: 1.5,
    ambient: [0.05, 0.06, 0.08],
    phaseG: 0.35,         // anizotropia HG (podświetlenie pod słońce)
    multiScatter: 0.25,   // udział wielokrotnego rozpraszania
    emission: 1.0,        // mnożnik ognia
    glowGain: 0.55,       // blask ognia w dymie
    detail: 0.6,          // siła detalu szumu
    detailScale: 0.065,   // częstotliwość detalu [kafle szumu / komórka] (wyżej — prążki aliasingu)
    erosion: 0.8,         // erozja rzadkich brzegów
    stepCells: 0.6,       // krok marszu [komórki]
    maxSteps: 150,
    flameNoise: 0.6,      // zaburzenie temperatury szumem (języki ognia)
    warpAmp: 1.4,         // przesunięcie odczytu polem wirowym [komórki]
    warpScale: 0.05,      // częstotliwość pola przesunięcia [kafle szumu / komórka]
    jitter: 1,            // przesunięcie startu marszu (0 = bez — A/B pasów)
    nearFade: 10,         // zasięg wygaszenia gazu przed kamerą [komórki]
    frontDensity: 1.0,    // bryły (gra): mnożnik gęstości części PRZED płaszczyzną gry — kadłub widać przez dym nad nim
    // Światła siatki (bryły z `lightGrid`; bez siatki — bez gałęzi w WGSL):
    gridGain: 1.0,        // mnożnik świateł siatki w dymie
    gridKnee: 0.45,       // kolano: L / (1 + kolano · ΣL) — dym przy dyszy / reflektorze nie bieleje
    gridShadow: 0.85,     // samocień: × mix(1, przepuszczalność nad próbką, gridShadow) — obłok ma bryłę
    gridScatter: 1.0,     // waga rozpraszania w ośrodku (L1.w siatki: snopy reflektorów mocniej w dymie)
    gridMinSigma: 0.02,   // pętla świateł tylko w gęstszym dymie (σ na komórkę)
    gridEvery: 3,         // pętla świateł co tyle gęstych próbek (koszt) — między nimi ostatnia wartość
    ownNear: 0.35,        // światło własnej domeny: od x = odległość / zasięg…
    ownFar: 0.75          // …do pełnej wagi (bliżej ognia świeci emisja i blask z objętości światła)
  };
}

const v4Array = (n, name) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4').setName(name);
const _m = new THREE.Matrix4();
const byCamDist = (a, b) => a._camD - b._camD;

export class GasVolume {
  /**
   * @param {object} o
   * @param {import('./gasGrid.js').GasGrid} o.grid
   * @param {THREE.Data3DTexture} o.noise3D szum 3D kafelkowy (fxNoise.noise3D)
   * @param {THREE.Data3DTexture} o.curl3D pole wirowe 3D kafelkowe (fxNoise.curl3D) — przesunięcie odczytu
   * @param {object} [o.lightGrid] siatka świateł (Core3D.fx.grid: loop) — bryły (`createMeshes`) czytają ją w marszu;
   *   null = bez świateł siatki (WGSL bez pętli). Lokalny układ siatki = układ brył (początek pul Core3D.fx.origin).
   */
  constructor({ grid, noise3D, curl3D, lightGrid = null, slotBase = 0 }) {
    this.grid = grid;
    // Indeks globalny pierwszej domeny siatki (GasGridSet: atlas „fine” za podstawowym) — właściciel świateł siatki
    // domeny = GAS_LIGHT_OWNER_BASE + indeks globalny (reżyser: explosionFx._lights).
    this.slotBase = slotBase | 0;
    this.noise3D = noise3D;
    this.curl3D = curl3D;
    this.lightGrid = lightGrid;
    this.look = createGasLook();
    const S = grid.S;
    this.U = {
      invProj: uniform(new THREE.Matrix4()),
      camWorld: uniform(new THREE.Matrix4()),
      camPos: uniform(new THREE.Vector3()),
      count: uniform(0, 'int'),
      domA: v4Array(S, 'gasDomA'),   // minimum pudła (scena lokalnie), rozmiar komórki h
      domB: v4Array(S, 'gasDomB'),   // slot, mnożnik obrazu, ziarno, —
      domC: v4Array(S, 'gasDomC'),   // barwa dymu rgb, paleta ognia (0 — ciało czarne, 1 — plazma Yamato)
      slotK: v4Array(S, 'gasVolSlotK'),   // skala komórki domeny (GasSlot.k) — indeks = slot siatki
      time: uniform(0),
      sunDir: uniform(new THREE.Vector3(0, 1, 0)),
      density: uniform(1), albedo: uniform(new THREE.Vector3(0.5, 0.5, 0.5)),
      sunColor: uniform(new THREE.Vector3(1, 1, 1)), sunGain: uniform(1),
      ambient: uniform(new THREE.Vector3(0.05, 0.05, 0.05)), phaseG: uniform(0.4), multiScatter: uniform(0.4),
      emission: uniform(1), glowGain: uniform(1), detail: uniform(0.5), detailScale: uniform(0.15),
      erosion: uniform(0.5), stepCells: uniform(0.85), maxSteps: uniform(110, 'int'),
      flameNoise: uniform(0.4), fireGain: uniform(1), fireBurn: uniform(1),
      warpAmp: uniform(1.4), warpScale: uniform(0.05), jitter: uniform(1), nearFade: uniform(10),
      frontDensity: uniform(1),
      planeZ: uniform(0),              // płaszczyzna gry (scena lokalnie) — podział warstw brył
      ambientK: uniform(1),            // mnożnik otoczenia (strefa nieba — właściciel, `ambientScale`)
      gridOn: uniform(1), gridGain: uniform(1), gridKnee: uniform(0.45), gridShadow: uniform(0.85), gridScatter: uniform(1),
      gridMinSigma: uniform(0.02), gridEvery: uniform(3, 'int'), ownNear: uniform(0.35), ownFar: uniform(0.75),
      occOn: uniform(1),               // bryły: pomijanie pustych kolumn / odcinków z (zajętość z gasOccupancy; 0 — pełny marsz)
      // Bryły domen głębokich (createDeepMeshes): kierunek słońca dla cienia kuli-przeszkody (skała — słońce z płaszczyzny
      // gry jak materiał skały; właściciel: deepSunDir) i półszerokość półcienia [j.]. Półcień szeroki (450 j.) zamiast
      // ostrego cienia Słońca z 57 AU: rozpraszanie wielokrotne w obłoku rozmywa linię cienia, a ostra granica w obłoku
      // 2–4 km przy terminatorze skały wyglądała jak cięcie (ciemny „prostokąt” w dymie — kamera 3D, 2026-10-19).
      deepSun: uniform(new THREE.Vector3(1, 0, 0)), deepPenumbra: uniform(450)
    };
    // Kierunek słońca dla cienia kuli domen głębokich (scena, jednostkowy) — ustawia właściciel (reżyser wybuchów).
    this.deepSunDir = new THREE.Vector3(1, 0, 0);
    this.deepMeshes = null;
    // Właściciel (gra): mnożnik otoczenia ze strefy nieba i przełącznik świateł siatki (A/B tej samej klatki).
    this.ambientScale = 1;
    this.gridEnabled = true;
    // Pomijanie pustej przestrzeni w marszu brył (zajętość kolumn — GasGrid.occTex; obraz bit w bit ten sam; A/B: false).
    this.skipEmpty = true;
    this.stepScale = 1;
    this._order = [];
    this.stats = { domains: 0 };
    this.meshes = null;
  }

  // --- wspólne węzły marszu (wołane wewnątrz Fn) -------------------------------------------------

  /** Przesunięcie startu marszu: biały szum z haszu PCG piksela (IGN dawał regularną kratkę „wafla”). */
  _jitter() {
    const fc = screenCoordinate.xy;
    const hs = uint(fc.x).add(uint(fc.y).mul(uint(7919))).mul(uint(747796405)).add(uint(2891336453)).toVar();
    const hw = hs.shiftRight(hs.shiftRight(uint(28)).add(uint(4))).bitXor(hs).mul(uint(277803737)).toVar();
    const white = float(hw.shiftRight(uint(22)).bitXor(hw)).mul(1 / 4294967296);
    return white.sub(0.5).mul(this.U.jitter).add(0.5).toVar();
  }

  /**
   * Światło słońca w punkcie pw (scena lokalnie) przy kuli-przeszkodzie ground = { c (środek, scena lokalnie), r }: 1 poza
   * cieniem kuli, 0 w cieniu, półcień ±deepPenumbra. Słońce: U.deepSun. Lustro CPU: gasGroundLitCpu.
   */
  _groundLit(pw, ground) {
    const U = this.U;
    const rel = pw.sub(ground.c);
    const b = dot(rel, U.deepSun);
    const dperp = length(rel.sub(U.deepSun.mul(b)));
    const w = U.deepPenumbra;
    return max(smoothstep(w.negate(), w, b), smoothstep(ground.r.sub(w), ground.r.add(w), dperp));
  }

  /** Faza Henyeya–Greensteina dla kierunku promienia (zmieszana z izotropową). */
  _phase(rd) {
    const U = this.U;
    const cosT = dot(rd, U.sunDir);
    const g = U.phaseG;
    const g2 = g.mul(g);
    const hg = float(1.0).sub(g2).div(pow(max(float(1.0).add(g2).sub(g.mul(cosT).mul(2.0)), 1e-4), 1.5));
    return mix(float(1.0), hg, 0.85).toVar();
  }

  /** Przedział [tmin, tmax] promienia w pudle domeny (bmin, h). */
  _boxSpan(ro, rd, bmin, h) {
    const N = this.grid.N;
    const NZ = this.grid.NZ;
    const inv = vec3(1.0).div(select(abs(rd).lessThan(vec3(1e-6)), vec3(1e-6), rd)).toVar();
    const bmax = bmin.add(vec3(h.mul(N), h.mul(N), h.mul(NZ)));
    const t0s = bmin.sub(ro).mul(inv);
    const t1s = bmax.sub(ro).mul(inv);
    const tn = min(t0s, t1s);
    const tf = max(t0s, t1s);
    return { tmin: max(max(max(tn.x, tn.y), tn.z), 0.0).toVar(), tmax: min(min(tf.x, tf.y), tf.z).toVar() };
  }

  /**
   * Zakres kroków [kStart, kEnd) marszu z ZAJĘTOŚCI KOLUMNY (GasGrid.occTex — kernel gasOccupancy). Tylko gdy promień na
   * całym odcinku czyta te same kolumny atlasu (kamera z góry: promień pionowy) — teksel zajętości kolumny i = floor(x − 0,5)
   * (przycięty do domeny) obejmuje kolumny i, i + 1 — wszystkie, które czyta próbka trójliniowa; inaczej pełny zakres.
   * Pusta kolumna → kEnd = 0. Inaczej próbki z pc.z poza (zlo − 0,5, zhi + 1,5) nie czytają warstw z gazem; zapas ±1–2
   * kroków na zaokrąglenia (wagi filtra w stałym przecinku, narastanie t). Lustro CPU: gasOccRangeCpu.
   */
  _occRange({ ro, rd, tmin, tmax, bmin, h, slot, dtW, jitter, nSteps, kStart, kEnd }) {
    const U = this.U;
    const grid = this.grid;
    const N = grid.N;
    const NZ = grid.NZ;
    If(U.occOn.greaterThan(0.5), () => {
      const pA = ro.add(rd.mul(tmin)).sub(bmin).div(h).toVar();
      const pB = ro.add(rd.mul(tmax)).sub(bmin).div(h).toVar();
      const tap = (v) => clamp(floor(v.sub(0.5)), 0.0, N - 1);
      const iA = tap(pA.x).toVar();
      const jA = tap(pA.y).toVar();
      If(iA.equal(tap(pB.x)).and(jA.equal(tap(pB.y))), () => {
        const code = texture(grid.occTex, ivec2(int(iA), int(jA).add(int(slot.add(0.5)).mul(N)))).setSampler(false).x.toVar();
        If(code.lessThan(0.0), () => {
          kEnd.assign(0);
        }).Else(() => {
          const zlo = floor(code.mul(1 / GAS_OCC_PACK)).toVar();
          const zhi = code.sub(zlo.mul(GAS_OCC_PACK));
          const zA = select(zlo.lessThan(0.5), float(-1e6), zlo.sub(0.5));
          const zB = select(zhi.greaterThan(NZ - 2.5), float(1e6), zhi.add(1.5));
          const dz = rd.z.div(h).toVar();
          If(abs(dz).greaterThan(1e-9), () => {
            const ta = tmin.add(zA.sub(pA.z).div(dz));
            const tb = tmin.add(zB.sub(pA.z).div(dz));
            const nf = float(nSteps);
            const ks = clamp(floor(min(ta, tb).sub(tmin).div(dtW).sub(jitter)).sub(1.0), 0.0, nf);
            const ke = clamp(ceil(max(ta, tb).sub(tmin).div(dtW).sub(jitter)).add(2.0), 0.0, nf);
            kStart.assign(int(ks));
            kEnd.assign(int(ke));
          });
        });
      });
    });
  }

  /**
   * Marsz jednej domeny na odcinku [tmin, tmax] promienia ro + rd·t (scena lokalnie); akumuluje do
   * col / trans (zmienne TSL). sunVis — mnożnik członu słońca (maska cienia słońca gry; dema 1); densK —
   * mnożnik gęstości odcinka (przednia warstwa brył gry); ambVis — mnożnik otoczenia (gra: sunFill maski; null = 1);
   * useGrid — światła siatki `lightGrid` (tylko bryły gry; przebieg pełnoekranowy dem bez zmian).
   */
  _march({ ro, rd, tmin, tmax, bmin, h, slot, fade, seed, tint, fire, jitter, phase, col, trans, sunVis, densK = null, ambVis = null, useGrid = false, domAmb = null, occ = false, ground = null }) {
    const U = this.U;
    const grid = this.grid;
    const N = grid.N;
    const NZ = grid.NZ;
    const S = grid.S;
    const noise = this.noise3D;
    const curl = this.curl3D;
    If(tmax.greaterThan(tmin), () => {
      const span = tmax.sub(tmin);
      const nSteps = clamp(int(span.div(h.mul(U.stepCells))).add(1), int(2), U.maxSteps).toVar();
      const dtW = span.div(float(nSteps)).toVar();       // krok [j. sceny]
      const dtC = dtW.div(h).toVar();                    // krok [komórki]
      const t = tmin.add(dtW.mul(jitter)).toVar();
      const slotZ = slot.mul(NZ);
      // Skala komórki domeny (GasSlot.k, etap D): gęstość optyczna i płomień na komórkę / k, detal i przesunięcie odczytu
      // w tej samej skali względem kuli ognia — drobniejsza siatka zmienia rozdzielczość, nie obraz (k = 1 — jak dawniej).
      const kS = U.slotK.element(int(slot.add(0.5))).x.toVar();
      const nS = N / (grid.nRef || N);
      // Temperatura poprzedniej próbki (−1 = brak): emisja całkowana po odcinku (niżej).
      const Tprev = float(-1.0).toVar();
      // Światła siatki: ostatnia wartość (po kolanie) i licznik gęstych próbek do następnej pętli.
      const lg = useGrid ? this.lightGrid : null;
      const gridL = lg ? vec3(0.0).toVar() : null;   // cudze światła (samocień z kamery)
      const gridS = lg ? vec3(0.0).toVar() : null;   // światło własnej domeny (z wnętrza obłoku — bez samocienia)
      const gridCnt = lg ? int(0).toVar() : null;
      const ownBase = GAS_LIGHT_OWNER_BASE + this.slotBase;
      const ownId = lg ? slot.add(ownBase).toVar() : null;
      if (lg) {
        // Jawne przypisanie przed pętlą (pułapka 29): zmienna TSL powstaje w miejscu pierwszego użycia — inaczej
        // deklaracja w ciele pętli zerowałaby ostatnią wartość i licznik co krok.
        gridL.assign(vec3(0.0));
        gridS.assign(vec3(0.0));
        gridCnt.assign(int(0));
        ownId.assign(slot.add(ownBase));
      }
      const ambient = ambVis ? U.ambient.mul(U.ambientK.mul(ambVis)).toVar() : U.ambient;
      // Paleta ognia domeny (fire 0 — ciało czarne, 1 — plazma Yamato, 2 — wodór; etapy E1 / E2): przystanki raz na marsz, przed pętlą.
      const fireStops = gasFireStops(fire);
      const fireK = float(0.0).toVar();
      fireK.assign(fire);
      // Pomijanie pustej przestrzeni (bryły gry, `occ`): kroki [kStart, kEnd) z zajętości kolumny (_occRange) — poza nim
      // próbka na pewno nie przekracza progu gęstości, więc marsz robiłby tylko gałąź pustą (Tprev = 0). Pozycje próbek
      // bez zmian (t narasta tak samo), kroki przed kStart bez odczytu atlasu, po kEnd koniec pętli — wynik bit w bit.
      // Jawne przypisanie przed gałęziami (pułapka 29).
      const kStart = int(0).toVar();
      const kEnd = int(0).toVar();
      kStart.assign(int(0));
      kEnd.assign(nSteps);
      if (occ) this._occRange({ ro, rd, tmin, tmax, bmin, h, slot, dtW, jitter, nSteps, kStart, kEnd });
      Loop({ start: int(0), end: kEnd, type: 'int', condition: '<', name: 'gstep' }, ({ gstep }) => {
        If(gstep.lessThan(kStart), () => {
          Tprev.assign(0.0);
        }).Else(() => {
          const pw = ro.add(rd.mul(t)).toVar();
          const pc = pw.sub(bmin).div(h).toVar();
          const qz = clamp(pc.z, 0.5, NZ - 0.5);
          const uvw = vec3(pc.x.mul(1 / N), pc.y.mul(1 / N), qz.add(slotZ).mul(1 / (NZ * S)));
          const den0 = texture3D(grid.denA, uvw).level(0);
          If(den0.x.add(den0.y).greaterThan(0.003), () => {
            // Pozycja spoczynkowa gazu (komórki) — detal i przesunięcie odczytu jadą z dymem.
            const rest = texture3D(grid.restA, uvw).level(0).xyz.toVar();
            const seedV = vec3(seed, seed.mul(0.7), seed.mul(1.3));
            // Przesunięcie odczytu polem wirowym (detal poniżej rozdzielczości siatki — „kalafior”).
            const qw = rest.mul(U.warpScale.div(kS)).add(seedV);
            const wa = texture3D(curl, qw).level(0).xy;
            const wb = texture3D(curl, qw.zxy.add(vec3(0.29, 0.61, 0.17))).level(0).x;
            const warp = vec3(wa, wb).mul(U.warpAmp.mul(kS));
            const pq = pc.add(warp);
            const uvq = vec3(pq.x.mul(1 / N), pq.y.mul(1 / N), clamp(pq.z, 0.5, NZ - 0.5).add(slotZ).mul(1 / (NZ * S)));
            const den = texture3D(grid.denA, uvq).level(0).toVar();
            const lgt = texture3D(grid.lightT, uvq).level(0).toVar();
            const n1 = texture3D(noise, rest.mul(U.detailScale.div(kS)).add(seedV)).level(0);
            const nA = n1.x.toVar();
            const nB = n1.y.toVar();
            const nd = nA.mul(0.65).add(nB.mul(0.35)).toVar();
            // Miękkie ściany pudła i elipsoida domeny (symulacja gasi gaz za ~0,97 promienia — zapas).
            const ew = min(pc, vec3(N, N, NZ).sub(pc));
            const halfD = vec3(N * 0.5, N * 0.5, NZ * 0.5);
            const rc = length(pc.sub(halfD).div(halfD));
            const wall = smoothstep(0.6 * nS, 6.0 * nS, min(min(ew.x, ew.y), ew.z)).mul(float(1.0).sub(smoothstep(0.9, 1.05, rc)));
            // Wygaszenie tuż przed kamerą (kamera w dymie / kuli ognia: mgła zamiast nieprzezroczystej ściany).
            const nearFade = U.nearFade.mul(kS);
            const nearK = smoothstep(nearFade.mul(0.15), nearFade, t.div(h));
            // Ciągły próg pominięcia: gęstość czytamy z PRZESUNIĘTEGO miejsca (warp), a próg — z nieprzesuniętego;
            // skok wkładu z 0 na granicy progu rysował poziomice (bez przesunięcia startu marszu — słoje, z nim — ziarno).
            const gate = smoothstep(0.003, 0.06, den0.x.add(den0.y));
            const fw = fade.mul(wall).mul(nearK).mul(gate).toVar();
            // Gęstość: detal mnożny + erozja rzadkich brzegów (strzępy zamiast gładkiej mgły).
            const sm = den.x.mul(fw).toVar();
            const det = mix(float(1.0), nd.mul(2.0), U.detail);
            const ero = U.erosion.mul(float(1.0).sub(nd)).mul(float(1.0).sub(smoothstep(0.0, 1.2, sm)));
            const rho = max(sm.mul(det).sub(ero.mul(0.35)), 0.0).toVar();
            const density = U.density.div(kS);
            const sigma = (densK ? rho.mul(density).mul(densK) : rho.mul(density)).toVar();
            // Ogień: temperatura z językami szumu. Sadza świeci jak ciało czarne (Kirchhoff: emisja =
            // σ_pochłaniania · B(T)); czysty płomień frontu spalania świeci bez sadzy (tempo spalania).
            const T = den.y.mul(float(1.0).add(nA.sub(0.5).mul(2.0).mul(U.flameNoise))).toVar();
            // Emisja ŚREDNIA na odcinku (temperatura liniowo od poprzedniej próbki, 4 podpróbki — sama arytmetyka):
            // front ognia cieńszy niż krok, próbkowany w tych samych płaszczyznach z (kamera z góry), rysował słoje
            // poziomic (bez przesunięcia startu) albo ziarno (z nim). Całka po odcinku je wygładza.
            const T0 = select(Tprev.lessThan(0.0), T, Tprev);
            const gSum = vec3(0.0).toVar();
            const bSum = vec3(0.0).toVar();
            for (const k of [0.125, 0.375, 0.625, 0.875]) {
              const Tk = mix(T0, T, k);
              const bk = gasFirePalette(Tk, fireStops);
              gSum.addAssign(bk.mul(gasFirePower(Tk, float(0.0), U.fireGain, float(0.0))));
              bSum.addAssign(bk);
            }
            Tprev.assign(T);
            const radiance = gSum.mul(0.25).mul(U.emission).mul(fw);
            const flame = bSum.mul(0.25).mul(max(den.w, 0.0).mul(U.fireBurn.div(kS))).mul(U.emission).mul(fw);
            // Rozpraszanie: słońce (samocień, maska cienia słońca gry), wielokrotne (T^¼), otoczenie, blask ognia.
            const sunT = lgt.x;
            let sun = U.sunColor.mul(U.sunGain).mul(sunT.mul(phase).add(pow(max(sunT, 1e-4), 0.25).mul(U.multiScatter))).mul(sunVis);
            // Domena głęboka z kulą-przeszkodą (skała): cień kuli w punkcie próbki (promień od próbki ku słońcu skały przecina
            // kulę — próbka w cieniu; półcień deepPenumbra) — pył nad terminatorem łapie światło, w cieniu skały gaśnie.
            if (ground) sun = sun.mul(this._groundLit(pw, ground));
            const alb = U.albedo.mul(tint).toVar();
            // Blask ognia z objętości światła (kernel liczy go w barwie ciała czarnego) w palecie domeny: luminancja zostaje.
            const glowC = gasFireGlow(lgt.yzw, gasLuma(lgt.yzw), fireK);
            let light = sun.add(ambient).add(glowC.mul(U.glowGain));
            // Otoczenie DOMENY (GasSlot.ambient — kanał w instancji: światło wnętrza hali K-7 dla dymu zapłonu, etap E2;
            // pod dachem nie ma słońca, a lampy siatki przechodzą przez kolano i samocień). 0 = jak dawniej.
            // Z lekkim samocieniem od strony kamery (obłok ma bryłę, nie płaską watę): × mix(1, trans, 0,6).
            if (domAmb) light = light.add(vec3(domAmb).mul(mix(float(1.0), trans, 0.6)));
            if (lg) {
              // Pętla świateł siatki tylko w gęstszym dymie i co `gridEvery` gęstych próbek (w ośrodku światło
              // zmienia się wolno — próbka co ~2 komórki wystarcza); między nimi ostatnia wartość.
              If(U.gridOn.greaterThan(0.5).and(gridCnt.lessThanEqual(0)).and(sigma.greaterThan(U.gridMinSigma.div(kS))), () => {
                const acc = vec3(0.0).toVar();
                const accS = vec3(0.0).toVar();
                lg.loop(pw, ({ att, col, scatter, owner, x }) => {
                  const c = col.mul(att.mul(scatter.mul(U.gridScatter).add(0.5))).toVar();
                  // Własna domena: tylko dalekie pole (bliżej świeci emisja i blask z objętości światła).
                  If(abs(owner.sub(ownId)).lessThan(0.5), () => {
                    accS.addAssign(c.mul(smoothstep(U.ownNear, U.ownFar, x)));
                  }).Else(() => {
                    acc.addAssign(c);
                  });
                });
                // Wspólne kolano (suma wszystkich świateł), potem rozdział: cudze / własne.
                const ga = acc.add(accS).mul(U.gridGain).toVar();
                const kn = U.gridGain.div(ga.x.add(ga.y).add(ga.z).mul(U.gridKnee).add(1.0)).toVar();
                gridL.assign(acc.mul(kn));
                gridS.assign(accS.mul(kn));
                gridCnt.assign(U.gridEvery);
              });
              gridCnt.subAssign(1);
              // Samocień cudzych świateł z przepuszczalności nad próbką (światła nad płaszczyzną, kamera z góry); światło
              // własnego wybuchu świeci z jego środka — bez tego samocienia.
              light = light.add(gridL.mul(mix(float(1.0), trans, U.gridShadow)).add(gridS).mul(U.gridOn));
            }
            const scat = alb.mul(light);
            const segT = exp(sigma.mul(dtC).negate()).toVar();
            const absorb = float(1.0).sub(alb.x.add(alb.y).add(alb.z).div(3.0));
            const src = scat.add(radiance.mul(absorb)).mul(sigma).add(flame);
            const integ = select(sigma.greaterThan(1e-4), src.mul(float(1.0).sub(segT)).div(max(sigma, 1e-4)), src.mul(dtC));
            col.addAssign(integ.mul(trans));
            trans.mulAssign(segT);
          }).Else(() => {
            Tprev.assign(0.0);
          });
        });
        t.addAssign(dtW);
        If(trans.lessThan(0.01), () => { Break(); });
      });
    });
  }

  /**
   * Węzeł obrazu gazu (vec4 premultiplied) dla przebiegu pełnoekranowego (dema). depthNode — tekstura
   * głębi sceny (np. pass(...).getTextureNode('depth')) albo null (bez obcinania).
   */
  node(depthNode) {
    const U = this.U;
    return Fn(() => {
      const uvS = screenUV;
      // Promień z kamery sceny (scena lokalnie względem początku).
      const vFar = getViewPosition(uvS, float(1.0), U.invProj).toVar();
      const rdView = normalize(vFar);
      const rd = normalize(U.camWorld.mul(vec4(rdView, 0.0)).xyz).toVar();
      const ro = U.camPos.toVar();
      const tScene = float(1e9).toVar();
      if (depthNode) {
        const d = depthNode.sample(uvS).x;
        If(d.lessThan(0.99999), () => {
          tScene.assign(length(getViewPosition(uvS, d, U.invProj)));
        });
      }
      const jitter = this._jitter();
      const col = vec3(0.0).toVar();
      const trans = float(1.0).toVar();
      const phase = this._phase(rd);
      Loop({ start: int(0), end: U.count, type: 'int', condition: '<', name: 'gdom' }, ({ gdom }) => {
        If(trans.lessThan(0.01), () => { Break(); });
        const A = U.domA.element(gdom).toVar();
        const B = U.domB.element(gdom).toVar();
        const C = U.domC.element(gdom).toVar();
        const { tmin, tmax } = this._boxSpan(ro, rd, A.xyz, A.w);
        this._march({
          ro, rd, tmin, tmax: min(tmax, tScene), bmin: A.xyz, h: A.w, slot: B.x, fade: B.y, seed: B.z, tint: C.xyz, fire: C.w,
          jitter, phase, col, trans, sunVis: float(1.0)
        });
      });
      return vec4(col, float(1.0).sub(trans));
    })();
  }

  /**
   * BRYŁY DOMEN do passa sceny (gra): dwie siatki instancji (pudło na domenę) — `back` (część za płaszczyzną
   * gry od kamery; kolejka nieprzezroczysta, renderOrder przed kadłubami) i `front` (część przed płaszczyzną;
   * przezroczysta, po kadłubach). Bez testu i zapisu głębi (kolejność warstw robi zasłanianie).
   * opts: layer (warstwa Core3D), renderOrderBack / Front, sunVisibility — () => węzeł mnożnika słońca,
   * ambientVisibility — () => węzeł mnożnika otoczenia (gra: sunFill(sunVisibility()) — cień planety, mrok pola).
   * Z `lightGrid` (konstruktor) marsz czyta światła siatki (bufory storage siatki w etapie fragmentów).
   */
  createMeshes({ layer = 0, renderOrderBack = 1, renderOrderFront = 26, sunVisibility = null, ambientVisibility = null, name = 'GasVolume' } = {}) {
    const U = this.U;
    const grid = this.grid;
    const N = grid.N;
    const NZ = grid.NZ;
    const cap = grid.S;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(box.index);
    geo.setAttribute('position', box.getAttribute('position'));
    const mk = (n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n);
      return a;
    };
    const aA = mk(4); // minimum pudła (lokalnie), h
    const aB = mk(4); // slot, mnożnik obrazu, ziarno, —
    const aC = mk(4); // barwa dymu rgb, paleta ognia
    geo.setAttribute('gasA', aA);
    geo.setAttribute('gasB', aB);
    geo.setAttribute('gasC', aC);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    const vLocal = varyingProperty('vec3', 'vGasLocal');
    const vA = varyingProperty('vec4', 'vGasA');
    const vB = varyingProperty('vec4', 'vGasB');
    const vC = varyingProperty('vec4', 'vGasC');
    const positionNode = Fn(() => {
      const A = attribute('gasA', 'vec4');
      const size = vec3(A.w.mul(N), A.w.mul(N), A.w.mul(NZ));
      const local = A.xyz.add(positionGeometry.add(0.5).mul(size));
      vLocal.assign(local);
      vA.assign(A);
      vB.assign(attribute('gasB', 'vec4'));
      vC.assign(attribute('gasC', 'vec4'));
      return local;
    })();
    const makeLayer = (back) => {
      const mat = new THREE.NodeMaterial();
      mat.name = `${name}${back ? 'Back' : 'Front'}`;
      mat.transparent = !back;           // tył: kolejka nieprzezroczysta (przed kadłubami), przód: przezroczysta
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
      mat.rulonBend = false;             // rulon warpa (gra): marsz liczy pudło nieugięte
      mat.positionNode = positionNode;
      mat.fragmentNode = Fn(() => {
        const P = vLocal;
        const h = vA.w;
        const size = vec3(h.mul(N), h.mul(N), h.mul(NZ));
        // Promień: z góry (ortho — macierz rzutu [3][3] = 1) wzdłuż osi kamery, inaczej od kamery przez piksel.
        const ortho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
        const rdV = select(ortho, vec3(0.0, 0.0, -1.0), normalize(positionView));
        const rd = normalize(cameraWorldMatrix.mul(vec4(rdV, 0.0)).xyz).toVar();
        const ro = select(ortho, P.sub(rd.mul(length(size).mul(2.0))), P.sub(rd.mul(length(positionView)))).toVar();
        const span = this._boxSpan(ro, rd, vA.xyz, h);
        // Płaszczyzna gry: tc — gdzie promień ją przecina (poza zasięgiem — cały promień po stronie kamery).
        const tcRaw = U.planeZ.sub(ro.z).div(select(abs(rd.z).lessThan(1e-6), float(1e-6), rd.z));
        const tc = select(tcRaw.greaterThan(0.0), tcRaw, float(1e12));
        const tmin = back ? max(span.tmin, tc) : span.tmin;
        const tmax = back ? span.tmax : min(span.tmax, tc);
        const col = vec3(0.0).toVar();
        const trans = float(1.0).toVar();
        this._march({
          ro, rd, tmin, tmax, bmin: vA.xyz, h, slot: vB.x, fade: vB.y, seed: vB.z, tint: vC.xyz, fire: vC.w, domAmb: vB.w,
          jitter: this._jitter(), phase: this._phase(rd), col, trans,
          sunVis: sunVisibility ? sunVisibility() : float(1.0),
          densK: back ? null : U.frontDensity,
          ambVis: ambientVisibility ? ambientVisibility() : null,
          useGrid: !!this.lightGrid,
          occ: !!grid.occTex
        });
        return vec4(col, float(1.0).sub(trans));
      })();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = mat.name;
      mesh.frustumCulled = false;
      mesh.renderOrder = back ? renderOrderBack : renderOrderFront;
      mesh.layers.set(layer);
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      return mesh;
    };
    this.meshes = { geometry: geo, attrs: [aA, aB, aC], back: makeLayer(true), front: makeLayer(false) };
    return this.meshes;
  }

  /**
   * Instancje brył tej klatki: domeny względem początku sceny (originX, originY — scena, double), bryły
   * na początku (macierz modelu w double — highPrecision). planeZ — płaszczyzna gry (scena).
   */
  updateMeshes(originX, originY, planeZ = 0) {
    const M = this.meshes;
    if (!M) return 0;
    const grid = this.grid;
    const half = grid.N * 0.5;
    const halfZ = grid.NZ * 0.5;
    const [aA, aB, aC] = M.attrs;
    const A = aA.array, B = aB.array, C = aC.array;
    let n = 0;
    for (const s of grid.slots) {
      // domeny głębokie rysują bryły passa tła (updateDeepMeshes)
      if (!s.active || s.fade <= 0 || s.deep) continue;
      const o = n * 4;
      A[o] = s.cx - half * s.h - originX; A[o + 1] = s.cy - half * s.h - originY; A[o + 2] = s.cz - halfZ * s.h; A[o + 3] = s.h;
      B[o] = s.index; B[o + 1] = s.fade; B[o + 2] = s.seed; B[o + 3] = s.ambient || 0;
      this.U.slotK.array[s.index].x = s.k || 1;
      C[o] = s.tint[0]; C[o + 1] = s.tint[1]; C[o + 2] = s.tint[2]; C[o + 3] = s.fire || 0;
      n++;
    }
    M.geometry.instanceCount = n;
    for (const mesh of [M.back, M.front]) {
      mesh.visible = n > 0;
      mesh.position.set(originX, originY, 0);
      mesh.updateMatrix();
      mesh.matrixWorld.copy(mesh.matrix);
    }
    if (n) for (const a of M.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    this.U.planeZ.value = planeZ;
    this.stats.domains = n;
    return n;
  }

  /**
   * BRYŁY DOMEN GŁĘBOKICH (GasSlot.deep — 2026-10-19, uderzenia w planetoidę pod bazą piratów): pass TŁA (warstwa `layer`,
   * kamera perspektywy jak skała — głęboki obłok w passie ortho stałby w złym miejscu, w perspektywie głęboki punkt zbiega
   * się ku środkowi kadru). Marsz przez całe pudło (bez podziału płaszczyzną gry), koniec na KULI-przeszkodzie domeny
   * (gasD: środek względem początku sceny, promień; skała przesłania obłok za sobą analitycznie), cień kuli w świetle
   * słońca (_groundLit), bez świateł siatki i bez maski słońca płaszczyzny gry. Dwie siatki: `out` — przód pudła z testem
   * głębi (bryły przed obłokiem w passie tła — spadająca wieża, dysk, osada — zasłaniają go; tył pudła pod skałą odpada
   * testem), `in` — tył pudła bez testu, gdy kamera jest w pudle (kamery 3D; przód byłby za kamerą). Instancja = domena.
   */
  createDeepMeshes({ layer = 1, renderOrder = 10, name = 'GasVolumeDeep' } = {}) {
    const U = this.U;
    const grid = this.grid;
    const N = grid.N;
    const NZ = grid.NZ;
    const cap = grid.S;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const vLocal = varyingProperty('vec3', 'vGasDL');
    const vA = varyingProperty('vec4', 'vGasDA');
    const vB = varyingProperty('vec4', 'vGasDB');
    const vC = varyingProperty('vec4', 'vGasDC');
    const vD = varyingProperty('vec4', 'vGasDD');
    const positionNode = Fn(() => {
      const A = attribute('gasA', 'vec4');
      const size = vec3(A.w.mul(N), A.w.mul(N), A.w.mul(NZ));
      const local = A.xyz.add(positionGeometry.add(0.5).mul(size));
      vLocal.assign(local);
      vA.assign(A);
      vB.assign(attribute('gasB', 'vec4'));
      vC.assign(attribute('gasC', 'vec4'));
      vD.assign(attribute('gasD', 'vec4'));
      return local;
    })();
    const fragmentNode = Fn(() => {
      const P = vLocal;
      const h = vA.w;
      const size = vec3(h.mul(N), h.mul(N), h.mul(NZ));
      const ortho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
      const rdV = select(ortho, vec3(0.0, 0.0, -1.0), normalize(positionView));
      const rd = normalize(cameraWorldMatrix.mul(vec4(rdV, 0.0)).xyz).toVar();
      const ro = select(ortho, P.sub(rd.mul(length(size).mul(2.0))), P.sub(rd.mul(length(positionView)))).toVar();
      const span = this._boxSpan(ro, rd, vA.xyz, h);
      // Koniec marszu na kuli-przeszkodzie (skała): pierwsze przecięcie promienia z kulą (gasSphereClipCpu).
      const gc = vD.xyz;
      const gr = vD.w;
      const tmax = span.tmax.toVar();
      If(gr.greaterThan(0.0), () => {
        const oc = ro.sub(gc).toVar();
        const b = dot(oc, rd);
        const q = dot(oc, oc).sub(gr.mul(gr));
        const disc = b.mul(b).sub(q).toVar();
        If(q.greaterThan(0.0).and(disc.greaterThan(0.0)), () => {
          const th = b.negate().sub(disc.max(0.0).sqrt());
          If(th.greaterThan(0.0), () => { tmax.assign(min(tmax, th)); });
        });
      });
      const col = vec3(0.0).toVar();
      const trans = float(1.0).toVar();
      this._march({
        ro, rd, tmin: span.tmin, tmax, bmin: vA.xyz, h, slot: vB.x, fade: vB.y, seed: vB.z, tint: vC.xyz, fire: vC.w, domAmb: vB.w,
        jitter: this._jitter(), phase: this._phase(rd), col, trans, sunVis: float(1.0),
        occ: !!grid.occTex, ground: { c: gc, r: gr }
      });
      return vec4(col, float(1.0).sub(trans));
    })();
    const mk = () => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setIndex(box.index);
      geo.setAttribute('position', box.getAttribute('position'));
      const attrs = ['gasA', 'gasB', 'gasC', 'gasD'].map((k) => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
        geo.setAttribute(k, a);
        return a;
      });
      geo.instanceCount = 0;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
      return { geo, attrs };
    };
    const makeMesh = (inside) => {
      const { geo, attrs } = mk();
      const mat = new THREE.NodeMaterial();
      mat.name = `${name}${inside ? 'In' : 'Out'}`;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.depthTest = !inside;
      mat.side = inside ? THREE.BackSide : THREE.FrontSide;
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
      mat.fragmentNode = fragmentNode;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = mat.name;
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      mesh.layers.set(layer);
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      return { mesh, geo, attrs };
    };
    this.deepMeshes = { out: makeMesh(false), in: makeMesh(true) };
    return this.deepMeshes;
  }

  /**
   * Instancje brył domen głębokich tej klatki: domeny względem początku sceny (originX, originY — scena, double), kamera
   * (camX, camY, camZ — scena; NaN = bez testu: zawsze `out`) — domena z kamerą w pudle (z zapasem margin [j.]) idzie do `in`.
   */
  updateDeepMeshes(originX, originY, camX = NaN, camY = NaN, camZ = NaN, margin = 300) {
    const M = this.deepMeshes;
    if (!M) return 0;
    const grid = this.grid;
    const half = grid.N * 0.5;
    const halfZ = grid.NZ * 0.5;
    const camOk = Number.isFinite(camX) && Number.isFinite(camY) && Number.isFinite(camZ);
    const cnt = [0, 0];
    const sets = [M.out, M.in];
    for (const s of grid.slots) {
      if (!s.active || s.fade <= 0 || !s.deep) continue;
      const hx = half * s.h + margin, hz = halfZ * s.h + margin;
      const inside = camOk && Math.abs(camX - s.cx) < hx && Math.abs(camY - s.cy) < hx && Math.abs(camZ - s.cz) < hz;
      const w = inside ? 1 : 0;
      const set = sets[w];
      const o = cnt[w] * 4;
      cnt[w]++;
      const [aA, aB, aC, aD] = set.attrs;
      const A = aA.array, B = aB.array, C = aC.array, D = aD.array;
      A[o] = s.cx - half * s.h - originX; A[o + 1] = s.cy - half * s.h - originY; A[o + 2] = s.cz - halfZ * s.h; A[o + 3] = s.h;
      B[o] = s.index; B[o + 1] = s.fade; B[o + 2] = s.seed; B[o + 3] = s.ambient || 0;
      this.U.slotK.array[s.index].x = s.k || 1;
      C[o] = s.tint[0]; C[o + 1] = s.tint[1]; C[o + 2] = s.tint[2]; C[o + 3] = s.fire || 0;
      if (s.gr > 0) { D[o] = s.gx - originX; D[o + 1] = s.gy - originY; D[o + 2] = s.gz; D[o + 3] = s.gr; }
      else { D[o] = 0; D[o + 1] = 0; D[o + 2] = 0; D[o + 3] = 0; }
    }
    for (let k = 0; k < 2; k++) {
      const set = sets[k];
      const n = cnt[k];
      set.geo.instanceCount = n;
      set.mesh.visible = n > 0;
      set.mesh.position.set(originX, originY, 0);
      set.mesh.updateMatrix();
      set.mesh.matrixWorld.copy(set.mesh.matrix);
      if (n) for (const a of set.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    }
    const d = this.deepSunDir;
    this.U.deepSun.value.set(d.x, d.y, d.z);
    this.stats.deep = cnt[0] + cnt[1];
    return cnt[0] + cnt[1];
  }

  /** Parametry obrazu → uniformy (raz na klatkę). */
  syncLook() {
    const U = this.U;
    const L = this.look;
    const grid = this.grid;
    U.sunDir.value.copy(grid.sunDir);
    U.density.value = L.density;
    U.albedo.value.set(L.albedo[0], L.albedo[1], L.albedo[2]);
    U.sunColor.value.set(L.sunColor[0], L.sunColor[1], L.sunColor[2]);
    U.sunGain.value = L.sunGain;
    U.ambient.value.set(L.ambient[0], L.ambient[1], L.ambient[2]);
    U.phaseG.value = L.phaseG;
    U.multiScatter.value = L.multiScatter;
    U.emission.value = L.emission;
    U.glowGain.value = L.glowGain;
    U.detail.value = L.detail;
    U.detailScale.value = L.detailScale;
    U.erosion.value = L.erosion;
    // krok marszu × skala klatki (właściciel: budżet marszu F13 — explosionFx._marchStep; 1 = stały)
    U.stepCells.value = L.stepCells * (this.stepScale > 0 ? this.stepScale : 1);
    U.maxSteps.value = L.maxSteps;
    U.flameNoise.value = L.flameNoise;
    U.warpAmp.value = L.warpAmp;
    U.warpScale.value = L.warpScale;
    U.jitter.value = L.jitter;
    U.nearFade.value = L.nearFade;
    U.frontDensity.value = L.frontDensity ?? 1;
    U.ambientK.value = Number.isFinite(this.ambientScale) ? this.ambientScale : 1;
    U.gridOn.value = this.gridEnabled && this.lightGrid ? 1 : 0;
    U.occOn.value = this.skipEmpty === false ? 0 : 1;
    U.gridGain.value = L.gridGain ?? 1;
    U.gridKnee.value = L.gridKnee ?? 0.45;
    U.gridShadow.value = L.gridShadow ?? 0.85;
    U.gridScatter.value = L.gridScatter ?? 1;
    U.gridMinSigma.value = L.gridMinSigma ?? 0.02;
    U.gridEvery.value = Math.max(1, Math.round(L.gridEvery ?? 3));
    U.ownNear.value = L.ownNear ?? 0.35;
    U.ownFar.value = Math.max((L.ownNear ?? 0.35) + 1e-3, L.ownFar ?? 0.75);
    U.fireGain.value = grid.tune.fireGain;
    U.fireBurn.value = grid.tune.fireBurn;
  }

  /**
   * Uniformy przebiegu pełnoekranowego tej klatki (dema): kamera sceny (macierze, pozycja względem
   * początku `origin` gridu), domeny od najbliższej, parametry obrazu.
   */
  update(camera, time) {
    const U = this.U;
    const grid = this.grid;
    const o = grid.origin;
    camera.updateMatrixWorld();
    U.invProj.value.copy(camera.projectionMatrixInverse);
    _m.copy(camera.matrixWorld);
    _m.elements[12] = 0; _m.elements[13] = 0; _m.elements[14] = 0;
    U.camWorld.value.copy(_m);
    const cx = camera.matrixWorld.elements[12];
    const cy = camera.matrixWorld.elements[13];
    const cz = camera.matrixWorld.elements[14];
    U.camPos.value.set(cx - o.x, cy - o.y, cz - o.z);
    U.time.value = time % 1000;
    // Domeny od najbliższej (środek pudła).
    const order = this._order;
    order.length = 0;
    for (const s of grid.slots) {
      if (!s.active || s.fade <= 0) continue;
      const dx = s.cx - cx, dy = s.cy - cy, dz = s.cz - cz;
      s._camD = dx * dx + dy * dy + dz * dz;
      order.push(s);
    }
    order.sort(byCamDist);
    const half = grid.N * 0.5;
    const halfZ = grid.NZ * 0.5;
    for (let k = 0; k < order.length; k++) {
      const s = order[k];
      U.domA.array[k].set(s.cx - half * s.h - o.x, s.cy - half * s.h - o.y, s.cz - halfZ * s.h - o.z, s.h);
      U.domB.array[k].set(s.index, s.fade, s.seed, 0);
      U.slotK.array[s.index].x = s.k || 1;
      U.domC.array[k].set(s.tint[0], s.tint[1], s.tint[2], s.fire || 0);
    }
    U.count.value = order.length;
    this.stats.domains = order.length;
    this.syncLook();
  }
}
