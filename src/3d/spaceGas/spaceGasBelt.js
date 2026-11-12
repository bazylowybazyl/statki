// src/3d/spaceGas/spaceGasBelt.js
//
// SCENA PASA gazu w otwartej przestrzeni (docs/PLAN-gazy-kosmos.md GK-5; scena „1 · Pas” dema gazy-transport-webgpu):
// mieszanka trzech gazów — rdzawy pył krzemianowo-żelazny (x), żółta siarka (y), błękitny lód amoniakalny (z) — plus
// wyrzut (w). Wzór (ławice, włókna, strefy) 1:1 z dema; SKALA I MIEJSCE z gry: obwiednia z pola pasa (siatka G × G
// z src/game/spaceGasInput.js — płaty mgły pasa × wyrwy + źródła gazu pola), udział lodu przesuwa skład ku lodowi.
//
// Funkcje TSL są wklejane (bez layoutu — pułapka 35); punkt q = świat gry względem kotwicy (Słońce) — argumenty szumu
// rzędu setek.

import * as THREE from 'three/webgpu';
import { float, vec2, vec4, uniform, texture, smoothstep, max, min, mix, abs, If } from 'three/tsl';
import { fbm, gnoise, fbmCpu, gnoiseCpu } from './spaceGasNoise.js';
import { SPACE_GAS_ENV_RES } from './spaceGasLayout.js';

/**
 * Wartości faktury detalu wygaszonej przy oddaleniu (teksel mapy przerasta jej skalę): ŚREDNIE kanałów faktury
 * (g1 = fbm·0,45 + 1 → 1; fib·0,9 + 0,3 → 0,654; fib3·0,7 + 0,4 → 0,748; eq·1,3 → 0,458 — lustro CPU `detailCpu`,
 * 3 mln próbek, test). Dawne cele (SPACE_GAS_DETAIL_LOD_OLD) nie są średnimi — w zakresie zaniku (zoom 0,12–0,028 na
 * 5120 px) barwa gazu „oddycha” z każdą klatką zoomu (siarka +12%, lód −16% przy minZoom). Mapy biorą DOMYŚLNIE dawne
 * cele; średnie — `SpaceGas.tune.lodMean = true` (zmienia barwę gazu przy oddaleniu: siarka −13%, lód +25%, wyrzut −30%
 * — czeka na decyzję użytkownika, przegląd 2026-10-29).
 */
export const SPACE_GAS_DETAIL_LOD_MEAN = Object.freeze([1.0, 0.654, 0.748, 0.458]);
export const SPACE_GAS_DETAIL_LOD_OLD = Object.freeze([1.0, 0.75, 0.6, 0.65]);
const ssCpu = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Lustro CPU (double) `BeltGasScene.farEnv` — pole dalekie w punkcie (px, py) względem kotwicy; wo = przesunięcie
 * wiatru (U.windOff), env / ice — obwiednia i udział lodu w punkcie (próbka siatki obwiedni), look — wygląd sceny.
 * Zapis w out[0..3]. Zmiana kernela = zmiana lustra (sonda drżenia gazu, testy).
 */
export function farEnvCpu(px, py, wox, woy, env, ice, look, out) {
  out[0] = out[1] = out[2] = out[3] = 0;
  if (!(env > 0.002)) return out;
  const wx = (px - wox) / 5200, wy = (py - woy) / 5200;
  const wqx = fbmCpu(wx * 0.8, wy * 0.8, 3), wqy = fbmCpu(wx * 0.8 + 5.2, wy * 0.8 + 1.3, 3);
  const wwx = wx + wqx * 1.5, wwy = wy + wqy * 1.5;
  const z1 = ssCpu(-0.45, 0.25, fbmCpu(wx * 0.22 + 1.3, wy * 0.22 + 2.9, 2));
  const z2 = ssCpu(-0.25, 0.35, fbmCpu(wx * 0.2 + 8.1, wy * 0.2 - 3.3, 2));
  const z3 = ssCpu(-0.2, 0.4, fbmCpu(wx * 0.25 - 4.4, wy * 0.25 + 6.6, 2));
  const b1 = fbmCpu(wwx, wwy, 5) * 0.5 + 0.5;
  const b2 = fbmCpu(wwx * 1.7 + 11.3, wwy * 1.7 + 4.2, 4) * 0.5 + 0.5;
  const b3 = fbmCpu(wwx * 2.6 - 7.7, wwy * 2.6 + 19.1, 4) * 0.5 + 0.5;
  const ic = ice * look.iceShift, k = env * look.envGain;
  out[0] = ssCpu(0.5, 0.84, b1) * z1 * 0.75 * (1 - ic * 0.4) * k;
  out[1] = ssCpu(0.5, 0.8, b2) * z2 * (1 - ic * 0.6) * k;
  out[2] = ssCpu(0.56, 0.84, b3) * z3 * 0.85 * (ic * 1.3 + 0.35) * k;
  return out;
}

/** Lustro CPU `BeltGasScene.detail` (q — pozycja spoczynkowa, lod 0..1, target — wartości wygaszonej faktury). */
export function detailCpu(qx, qy, lod, target, out) {
  const g1 = fbmCpu(qx / 430, qy / 430, 3) * 0.45 + 1;
  const wqx = gnoiseCpu(qx / 2900, qy / 2900), wqy = gnoiseCpu(qx / 2900 + 5.2, qy / 2900 + 1.3);
  const f1 = Math.max(1 - Math.abs(gnoiseCpu(qx / 1000 + wqx * 0.9, qy / 1000 + wqy * 0.9)), 0);
  const f1s = f1 * f1 * f1, fib = f1s * f1s;
  const f3 = Math.max(1 - Math.abs(gnoiseCpu(qx / 760 + wqx * 0.7 - 7.7, qy / 760 + wqy * 0.7 + 19.1)), 0);
  const f3s = f3 * f3, fib3 = f3s * f3s;
  const eq = ssCpu(-0.35, 0.55, fbmCpu(qx / 340, qy / 340, 4));
  const d0 = g1, d1 = fib * 0.9 + 0.3, d2 = fib3 * 0.7 + 0.4, d3 = eq * 1.3;
  out[0] = d0 + (target[0] - d0) * lod;
  out[1] = d1 + (target[1] - d1) * lod;
  out[2] = d2 + (target[2] - d2) * lod;
  out[3] = d3 + (target[3] - d3) * lod;
  return out;
}

/** Wygląd sceny pasa (dema: SCENES.belt; po zmianie `syncLook`). */
export function createBeltGasLook() {
  return {
    albedo: [[0.62, 0.4, 0.26], [0.95, 0.8, 0.28], [0.45, 0.8, 1.0]],
    ejecta: [0.5, 0.44, 0.38],
    sun: [1.0, 0.9, 0.78],
    sunGain: 1.35,
    ambient: [0.016, 0.015, 0.018],
    decay: [0.002, 0.002, 0.004, 0.04],
    envGain: 1.6,       // obwiednia pasa (≈ 0…1 w rdzeniu pola) → gęstość dema
    iceShift: 1.0,      // udział lodu przesuwa skład ku lodowi amoniakalnemu
    dustW: [1, 0.5, 0.3, 1],
    dustRho: 0.45,
    dustColor: [0.1, 0.085, 0.07],
    dustSulfurDim: 0.3  // pył w ławicy siarki o 30% ciemniejszy (decyzja użytkownika 2026-10-22)
  };
}

/**
 * Wygląd sceny RINGU W BUDOWIE (Jowisz, GK-6; decyzja użytkownika 2026-10-23 „wszędzie pył, gaz”): te same kanały
 * i ten sam wzór pola co pas (bez nowych pipeline'ów — scena to obwiednia z gry i barwy w uniformach), inna mieszanka:
 * szarobrunatny pył budowy (x), żółtawe opary spawania i cięcia płyt z Io (y), sinobiałe odgazowanie (z — przy
 * frontach; obwiednia: src/game/ringGasField.js). Więcej otoczenia — poświata Jowisza.
 */
export function createRingGasLook() {
  return {
    albedo: [[0.5, 0.46, 0.4], [0.66, 0.6, 0.45], [0.34, 0.37, 0.42]],
    ejecta: [0.5, 0.46, 0.42],
    sun: [1.0, 0.92, 0.8],
    sunGain: 1.35,
    ambient: [0.03, 0.026, 0.022],
    decay: [0.002, 0.003, 0.004, 0.04],
    envGain: 1.2,
    iceShift: 1.0,
    dustW: [1, 0.6, 0.2, 1],
    dustRho: 0.45,
    dustColor: [0.1, 0.09, 0.08],
    dustSulfurDim: 0.15
  };
}

export class BeltGasScene {
  constructor() {
    this.look = createBeltGasLook();
    const G = SPACE_GAS_ENV_RES;
    this.envData = new Uint16Array(G * G * 4);
    const t = new THREE.DataTexture(this.envData, G, G, THREE.RGBAFormat, THREE.HalfFloatType);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
    t.name = 'spaceGasBeltEnv';
    t.needsUpdate = true;
    this.envTex = t;
    // PRZENIKANIE KROKU SIATKI OBWIEDNI (2026-10-29, „gazy drżą przy zoomie”): krok siatki = krok okna × 2^k zmienia się
    // raz na oktawę zoomu (0,31 / 0,16 / 0,078 / 0,039 przy oddalaniu) i całe pole dalekie przepróbkowywało się z siatki
    // dwa razy rzadszej w jednej klatce (przy 0,039: 17% pikseli > 4/255). Stara siatka zostaje (zamrożona, w świecie)
    // i gaśnie w `envBlend` s zegara efektów; poza jej zasięgiem (oddalenie — nowa sięga dalej) od razu nowa, z miękkim
    // brzegiem na dwóch próbkach. A/B: SpaceGas.tune.envBlend = 0.
    this.envPrevData = new Uint16Array(G * G * 4);
    const tp = new THREE.DataTexture(this.envPrevData, G, G, THREE.RGBAFormat, THREE.HalfFloatType);
    tp.minFilter = THREE.LinearFilter;
    tp.magFilter = THREE.LinearFilter;
    tp.wrapS = tp.wrapT = THREE.ClampToEdgeWrapping;
    tp.generateMipmaps = false;
    tp.colorSpace = THREE.NoColorSpace;
    tp.name = 'spaceGasBeltEnvPrev';
    tp.needsUpdate = true;
    this.envPrevTex = tp;
    this.U = {
      env: uniform(new THREE.Vector3(0, 0, 1024)),   // róg siatki (środek próbki 0, 0) względem kotwicy, odstęp próbek
      envPrev: uniform(new THREE.Vector3(0, 0, 1024)), // to samo dla poprzedniej siatki (przenikanie kroku)
      envMix: uniform(0),                            // waga poprzedniej siatki (1 → 0 w envBlend s; 0 — bez odczytu)
      envGain: uniform(1),
      iceShift: uniform(1)
    };
    this._ver = -1;
    this._envCell = 0;
    this._envAX = NaN; this._envAY = NaN; this._envKey = NaN;
    this.syncLook();
  }

  syncLook() {
    this.U.envGain.value = this.look.envGain;
    this.U.iceShift.value = this.look.iceShift;
  }

  /**
   * Siatka obwiedni z wejścia gry (pary: obwiednia, udział lodu) — wysyłka tylko przy nowej wersji. `fadeDt` — przyrost
   * zegara przenikania [s] (zegar efektów: biegnie też w pauzie), `fadeS` — czas przenikania kroku siatki [s] (0 —
   * dawniej: nowa siatka od razu). Zmiana kotwicy albo sceny (nowa siatka w innym miejscu) — bez przenikania.
   */
  setEnvelope(IN, I, fadeDt = 0, fadeS = 0) {
    const ver = IN[I.envVer], cell = IN[I.envCell];
    const U = this.U;
    if (U.envMix.value > 0) U.envMix.value = fadeS > 0 ? Math.max(0, U.envMix.value - Math.max(0, fadeDt) / fadeS) : 0;
    // miejsce siatki: kotwica i scena (pas / ring) — inna kotwica = siatka gdzie indziej
    const ax = IN[I.anchorX], ay = IN[I.anchorY], sc = IN[I.scene];
    const same = ax === this._envAX && ay === this._envAY && sc === this._envKey;
    if (fadeS > 0 && same && cell !== this._envCell && this._envCell > 0 && this._ver >= 0) {
      // krok siatki zmieniony: dotychczasowa siatka (dane i położenie sprzed tej klatki) → poprzednia, gaśnie
      this.envPrevData.set(this.envData);
      this.envPrevTex.needsUpdate = true;
      U.envPrev.value.copy(U.env.value);
      U.envMix.value = 1;
    } else if (!same) U.envMix.value = 0;
    this._envCell = cell;
    this._envAX = ax; this._envAY = ay; this._envKey = sc;
    U.env.value.set(IN[I.envX0], IN[I.envY0], cell);
    if (ver === this._ver) return;
    this._ver = ver;
    const G = SPACE_GAS_ENV_RES, D = this.envData, h = THREE.DataUtils.toHalfFloat;
    for (let k = 0; k < G * G; k++) {
      D[k * 4] = h(IN[I.envBase + k * 2]);
      D[k * 4 + 1] = h(IN[I.envBase + k * 2 + 1]);
      D[k * 4 + 2] = 0;
      D[k * 4 + 3] = 0;
    }
    this.envTex.needsUpdate = true;
  }

  /** Gaz wyłączony / poza obszarem: przenikanie od zera przy powrocie (bez starej siatki). */
  resetEnvelopeBlend() {
    this.U.envMix.value = 0;
    this._envCell = 0;
    this._envAX = NaN; this._envAY = NaN; this._envKey = NaN;
  }

  /**
   * Obwiednia (x) i udział lodu (y) w punkcie q (vec2, względem kotwicy). W przenikaniu kroku siatki (U.envMix > 0) —
   * mieszanka z poprzednią siatką, waga × jej zasięg (miękki brzeg na dwóch skrajnych próbkach).
   */
  envAt(q) {
    const G = SPACE_GAS_ENV_RES;
    const e = this.U.env, P = this.U.envPrev, U = this.U;
    const uv = q.sub(e.xy).div(e.z).add(0.5).div(G);
    const res = texture(this.envTex, uv).level(0).toVar();
    If(U.envMix.greaterThan(0.0), () => {
      const up = q.sub(P.xy).div(P.z).add(0.5).div(G).toVar();
      const edge = min(min(up.x, up.y), min(up.x.oneMinus(), up.y.oneMinus())).mul(G);
      const w = smoothstep(0.5, 2.5, edge).mul(U.envMix);
      res.assign(mix(res, texture(this.envPrevTex, up).level(0), w));
    });
    return res;
  }

  /** Pole dalekie: vec4 gęstości (pył, siarka, lód, wyrzut) — wzór dema × obwiednia pasa. */
  farEnv(pw, U) {
    const out = vec4(0).toVar();
    const env = this.envAt(pw).toVar();
    If(env.x.greaterThan(0.002), () => {
      const q = pw.sub(U.windOff).toVar();
      const w = q.div(5200.0).toVar();
      const wq = vec2(fbm(w.mul(0.8), 3), fbm(w.mul(0.8).add(vec2(5.2, 1.3)), 3)).toVar();
      const ww = w.add(wq.mul(1.5)).toVar();
      const z1 = smoothstep(-0.45, 0.25, fbm(w.mul(0.22).add(vec2(1.3, 2.9)), 2));
      const z2 = smoothstep(-0.25, 0.35, fbm(w.mul(0.2).add(vec2(8.1, -3.3)), 2));
      const z3 = smoothstep(-0.2, 0.4, fbm(w.mul(0.25).add(vec2(-4.4, 6.6)), 2));
      const b1 = fbm(ww, 5).mul(0.5).add(0.5);
      const b2 = fbm(ww.mul(1.7).add(vec2(11.3, 4.2)), 4).mul(0.5).add(0.5);
      const b3 = fbm(ww.mul(2.6).add(vec2(-7.7, 19.1)), 4).mul(0.5).add(0.5);
      const ice = env.y.mul(this.U.iceShift).toVar();
      const k = env.x.mul(this.U.envGain).toVar();
      out.assign(vec4(
        smoothstep(0.5, 0.84, b1).mul(z1).mul(0.75).mul(float(1.0).sub(ice.mul(0.4))),
        smoothstep(0.5, 0.8, b2).mul(z2).mul(float(1.0).sub(ice.mul(0.6))),
        smoothstep(0.56, 0.84, b3).mul(z3).mul(0.85).mul(ice.mul(1.3).add(0.35)),
        0.0
      ).mul(k));
    });
    return out;
  }

  /**
   * Faktura detalu (mnożnik na kanał; dema: gasDetail sceny pasa). q — pozycja spoczynkowa (świat + przesunięcie −
   * dryf wiatru), lod 0..1 — 1 = faktura wygaszona (teksel mapy większy niż jej skala — bez migotania przy oddaleniu),
   * target — vec4 wygaszonej faktury (mapy: uniform SPACE_GAS_DETAIL_LOD_MEAN / _OLD; brak — dawne stałe).
   */
  detail(q, lod, target = null) {
    const g1 = fbm(q.div(430.0), 3).mul(0.45).add(1.0);
    const wq = vec2(gnoise(q.div(2900.0)), gnoise(q.div(2900.0).add(vec2(5.2, 1.3)))).toVar();
    // (1 − |n|) obcięte do 0: gnoise sięga ±1,4, a pow z ujemną podstawą to NaN w WGSL
    const f1 = max(float(1.0).sub(abs(gnoise(q.div(1000.0).add(wq.mul(0.9))))), 0.0);
    const f1s = f1.mul(f1).mul(f1);
    const fib = f1s.mul(f1s);
    const f3 = max(float(1.0).sub(abs(gnoise(q.div(760.0).add(wq.mul(0.7)).add(vec2(-7.7, 19.1))))), 0.0);
    const f3s = f3.mul(f3);
    const fib3 = f3s.mul(f3s);
    const eq = smoothstep(-0.35, 0.55, fbm(q.div(340.0), 4));
    const d = vec4(g1, fib.mul(0.9).add(0.3), fib3.mul(0.7).add(0.4), eq.mul(1.3));
    return d.add((target || vec4(...SPACE_GAS_DETAIL_LOD_OLD)).sub(d).mul(lod));
  }
}
