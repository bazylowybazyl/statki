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
import { float, vec2, vec4, uniform, texture, smoothstep, max, abs, If } from 'three/tsl';
import { fbm, gnoise } from './spaceGasNoise.js';
import { SPACE_GAS_ENV_RES } from './spaceGasLayout.js';

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
    this.U = {
      env: uniform(new THREE.Vector3(0, 0, 1024)),   // róg siatki (środek próbki 0, 0) względem kotwicy, odstęp próbek
      envGain: uniform(1),
      iceShift: uniform(1)
    };
    this._ver = -1;
    this.syncLook();
  }

  syncLook() {
    this.U.envGain.value = this.look.envGain;
    this.U.iceShift.value = this.look.iceShift;
  }

  /** Siatka obwiedni z wejścia gry (pary: obwiednia, udział lodu) — wysyłka tylko przy nowej wersji. */
  setEnvelope(IN, I) {
    const ver = IN[I.envVer];
    this.U.env.value.set(IN[I.envX0], IN[I.envY0], IN[I.envCell]);
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

  /** Obwiednia (x) i udział lodu (y) w punkcie q (vec2, względem kotwicy). */
  envAt(q) {
    const G = SPACE_GAS_ENV_RES;
    const e = this.U.env;
    const uv = q.sub(e.xy).div(e.z).add(0.5).div(G);
    return texture(this.envTex, uv).level(0);
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
   * dryf wiatru), lod 0..1 — 1 = faktura wygaszona (teksel mapy większy niż jej skala — bez migotania przy oddaleniu).
   */
  detail(q, lod) {
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
    return d.add(vec4(1.0, 0.75, 0.6, 0.65).sub(d).mul(lod));
  }
}
