// ============================================================
// Pole tarczy na GPU — siatka kartezjańska w płaszczyźnie kadłuba (klatka
// lokalna 3D: x wzdłuż kadłuba, y w górę), prostokąt obejmujący obrys
// z marginesem. Komórka poza obrysem (r > r(θ)) albo w przebiciu to brzeg.
// Siatka kartezjańska, nie biegunowa: laplasjan izotropowy, fala nie
// rozciąga się przy krawędzi.
//
// Stan (bufory storage, ping-pong):
//   fala   (h, v)      — h_tt = c²∇²h − γ·h_t − k·h + źródła; brzeg: h = 0
//                        (odbicie od obrysu i od brzegu przebicia);
//   ciepło (E, B, W, —) — energia trafień (dyfuzja + stygnięcie), przebicie
//                        (rośnie, gdy E > próg; maleje, gdy E < 0,6 progu),
//                        obwiednia aktywności fali (heksy „po przejściu fali”).
// Klatka: wstrzyknięcie zdarzeń → n podkroków fali (krok stały ≤ 1/240 s i z warunku
// CFL, akumulator czasu, kroki parami — wynik w A) → rozmycie E wzdłuż x → wzdłuż y +
// stygnięcie + przebicie + obwiednia + zapis tekstury (h, E, B, W).
// Dyfuzja jako rozmycie gaussowskie σ² = 2·D·dt — dokładne rozwiązanie
// równania ciepła, stabilne przy każdej rozdzielczości siatki.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, float, int, ivec2, vec2, vec4, instancedArray, instanceIndex, textureStore,
  texture, Loop, If, select, length, exp, max, min, abs, dot, clamp as tclamp
} from 'three/tsl';
import { sampleShieldProfileRadius } from '../../shieldSystem.js';

const MARGIN_CELLS = 3;
export const MAX_EVENTS = 256;
export const MAX_SOURCES = 8;
const MAX_SUBSTEPS = 32;
const MAX_BLUR = 12;

// Układ siatki dla profilu: dłuższy bok = longCells komórek.
export function fieldLayout(profile, longCells) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const S = 1440;
  for (let i = 0; i < S; i++) {
    const a = (i / S) * Math.PI * 2;
    const r = sampleShieldProfileRadius(profile, a);
    const x = Math.cos(a) * r, y = -Math.sin(a) * r;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX, h = maxY - minY;
  const cell = Math.max(w, h) / (longCells - 2 * MARGIN_CELLS);
  const W = Math.ceil(w / cell) + 2 * MARGIN_CELLS;
  const H = Math.ceil(h / cell) + 2 * MARGIN_CELLS;
  const x0 = (minX + maxX) * 0.5 - W * cell * 0.5;
  const y0 = (minY + maxY) * 0.5 - H * cell * 0.5;

  // Maska: t = r / r(θ) w środku komórki (≥ 1 poza obrysem).
  const mask = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const y = y0 + (j + 0.5) * cell;
    for (let i = 0; i < W; i++) {
      const x = x0 + (i + 0.5) * cell;
      const R = sampleShieldProfileRadius(profile, Math.atan2(-y, x));
      mask[j * W + i] = Math.hypot(x, y) / Math.max(R, 1e-3);
    }
  }
  return { W, H, cell, x0, y0, sizeX: W * cell, sizeY: H * cell, mask };
}

// Węzły wspólne — przeżywają przebudowę siatki (suwak jakości): materiały
// próbkują texNode.sample(uv), przebudowa podmienia texNode.value; CPU pisze
// zdarzenia i parametry do tych samych uniformów.
export function createFieldShared() {
  const placeholder = new THREE.StorageTexture(4, 4);
  placeholder.type = THREE.HalfFloatType;
  const evA = Array.from({ length: MAX_EVENTS }, () => new THREE.Vector4());   // x, y, promień, impuls fali [j./s]
  const evB = Array.from({ length: MAX_EVENTS }, () => new THREE.Vector4());   // energia, —, —, —
  const src = Array.from({ length: MAX_SOURCES }, () => new THREE.Vector4());  // x, y, promień, siła [j./s²]
  return {
    texNode: texture(placeholder),
    maskTexNode: texture(placeholder),
    uOrigin: uniform(new THREE.Vector2()),
    uSize: uniform(new THREE.Vector2(1, 1)),
    uCell: uniform(1),
    uTexel: uniform(new THREE.Vector2(1, 1)),
    uMarker: uniform(new THREE.Vector4(0, 0, 0, 0)), // widok kontrolny: x, y, promień, siła
    evA, evB, src,
    uEvA: uniformArray(evA, 'vec4'),
    uEvB: uniformArray(evB, 'vec4'),
    uEvCount: uniform(0, 'int'),
    uSrc: uniformArray(src, 'vec4'),
    uSrcCount: uniform(0, 'int'),
    // Fala
    uDtSub: uniform(1 / 240),
    uC2: uniform(900 * 900),        // c² [j²/s²]
    uDamp: uniform(1.6),            // γ [1/s]
    uStiff: uniform(9.0),           // k [1/s²] — powrót do spoczynku
    uHMax: uniform(60),
    uWavesOn: uniform(1),
    uSweep: uniform(-1),            // czoło rozruchu/gaszenia w t (−1 = brak)
    uSweepW: uniform(0.06),
    uSweepAmp: uniform(0),          // siła czoła [j./s²] (ujemna = w dół)
    // Ciepło
    uDtFrame: uniform(1 / 60),
    uCoolK: uniform(1),             // exp(−dt/τ)
    uSigma: uniform(1),             // σ rozmycia [komórki]
    uBlurK: uniform(3, 'int'),      // zasięg rozmycia [komórki]
    uThr: uniform(1.4),             // próg przebicia
    uBreachUp: uniform(1 / 0.7),
    uBreachDown: uniform(1 / 2.5),
    uWDecay: uniform(1),            // exp(−dt/τW)
    uWGain: uniform(1 / 420),       // |v| → W
    uEnergyOn: uniform(1)
  };
}

// Zasoby GPU pola dla danego układu. Tekstura: wiersz j = v j/H (StorageTexture
// nie jest odwracana — §9.5), więc uv = (xy − origin) / size bez odwracania v.
export function createField(renderer, profile, longCells, P) {
  const L = fieldLayout(profile, longCells);
  const W = L.W, H = L.H, N = W * H;
  const tex = new THREE.StorageTexture(W, H);
  tex.type = THREE.HalfFloatType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  // Maska jako tekstura tylko dla widoku kontrolnego (izolinie t siatki).
  const maskTex = new THREE.StorageTexture(W, H);
  maskTex.type = THREE.HalfFloatType;
  maskTex.minFilter = THREE.LinearFilter;
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.generateMipmaps = false;

  const maskBuf = instancedArray(L.mask, 'float');
  const waveA = instancedArray(N, 'vec2');
  const waveB = instancedArray(N, 'vec2');
  const heatA = instancedArray(N, 'vec4');
  const heatB = instancedArray(N, 'vec4');

  P.uOrigin.value.set(L.x0, L.y0);
  P.uCell.value = L.cell;
  P.uSize.value.set(L.sizeX, L.sizeY);
  P.uTexel.value.set(1 / W, 1 / H);
  P.texNode.value = tex;
  P.maskTexNode.value = maskTex;

  const at = (x, y) => min(max(x, int(0)), int(W - 1)).add(min(max(y, int(0)), int(H - 1)).mul(int(W)));
  const cellPos = (i, j) => P.uOrigin.add(vec2(float(i).add(0.5), float(j).add(0.5)).mul(P.uCell));

  // ── Zerowanie stanu (start, reset)
  const init = Fn(() => {
    const id = int(instanceIndex);
    waveA.element(id).assign(vec2(0));
    waveB.element(id).assign(vec2(0));
    heatA.element(id).assign(vec4(0));
    heatB.element(id).assign(vec4(0));
    const ij = ivec2(id.mod(int(W)), id.div(int(W)));
    textureStore(tex, ij, vec4(0));
    textureStore(maskTex, ij, vec4(maskBuf.element(id), 0.0, 0.0, 1.0));
  })().compute(N);

  // ── Wstrzyknięcie zdarzeń (raz na klatkę): impuls prędkości fali + energia.
  const inject = Fn(() => {
    const id = int(instanceIndex);
    const i = id.mod(int(W)).toVar();
    const j = id.div(int(W)).toVar();
    const p = cellPos(i, j).toVar();
    const inside = select(maskBuf.element(id).lessThan(1.0), float(1.0), float(0.0)).toVar();
    const dv = float(0).toVar();
    const dE = float(0).toVar();
    Loop({ start: 0, end: P.uEvCount, type: 'int', condition: '<', name: 'ev' }, ({ ev }) => {
      const a = P.uEvA.element(ev);
      const off = p.sub(a.xy);
      const d2 = dot(off, off);
      const r2 = a.z.mul(a.z);
      If(d2.lessThan(r2.mul(9.0)), () => {
        const g = exp(d2.div(r2).negate());
        dv.addAssign(a.w.mul(g));
        dE.addAssign(P.uEvB.element(ev).x.mul(g));
      });
    });
    const w = waveA.element(id);
    waveA.element(id).assign(vec2(w.x, w.y.add(dv.mul(inside).mul(P.uWavesOn))));
    const hA = heatA.element(id);
    heatA.element(id).assign(vec4(hA.x.add(dE.mul(inside).mul(P.uEnergyOn)), hA.y, hA.z, hA.w));
  })().compute(N);

  // ── Podkrok fali: src → dst (symplektyczny Euler). Poza obrysem i w przebiciu h = 0,
  //    więc sąsiad-brzeg daje w laplasjanie zero (odbicie jak od zamocowanej krawędzi).
  const makeWaveStep = (src, dst) => Fn(() => {
    const id = int(instanceIndex);
    const i = id.mod(int(W)).toVar();
    const j = id.div(int(W)).toVar();
    const t = maskBuf.element(id).toVar();
    const breach = heatA.element(id).y;
    const inside = select(t.lessThan(1.0).and(breach.lessThan(0.5)), float(1.0), float(0.0)).toVar();
    const c = src.element(id).toVar();
    const hL = src.element(at(i.sub(int(1)), j)).x;
    const hR = src.element(at(i.add(int(1)), j)).x;
    const hD = src.element(at(i, j.sub(int(1)))).x;
    const hU = src.element(at(i, j.add(int(1)))).x;
    const lap = hL.add(hR).add(hD).add(hU).sub(c.x.mul(4.0)).div(P.uCell.mul(P.uCell));
    const f = P.uC2.mul(lap).sub(P.uDamp.mul(c.y)).sub(P.uStiff.mul(c.x)).toVar();
    const p = cellPos(i, j).toVar();
    Loop({ start: 0, end: P.uSrcCount, type: 'int', condition: '<', name: 'sr' }, ({ sr }) => {
      const s = P.uSrc.element(sr);
      const off = p.sub(s.xy);
      const d2 = dot(off, off);
      f.addAssign(s.w.mul(exp(d2.div(s.z.mul(s.z)).negate())));
    });
    // Czoło rozruchu / gaszenia: pierścień siły jadący po t.
    const sw = t.sub(P.uSweep).div(P.uSweepW);
    f.addAssign(select(P.uSweep.greaterThanEqual(0.0), P.uSweepAmp.mul(exp(sw.mul(sw).negate())), float(0.0)));
    const v = c.y.add(f.mul(P.uDtSub)).mul(inside).mul(P.uWavesOn);
    const hN = tclamp(c.x.add(v.mul(P.uDtSub)), P.uHMax.negate(), P.uHMax).mul(inside);
    dst.element(id).assign(vec2(hN, tclamp(v, -6000.0, 6000.0)));
  })().compute(N);
  const stepAB = makeWaveStep(waveA, waveB);
  const stepBA = makeWaveStep(waveB, waveA);

  // ── Rozmycie gaussowskie energii wzdłuż osi (brzeg: wartość środka — brak przepływu).
  const blurAxis = (buf, i, j, dx, dy, e0) => {
    const sum = e0.toVar();
    const wsum = float(1).toVar();
    const inv2s2 = float(0.5).div(max(P.uSigma.mul(P.uSigma), 1e-4)).toVar();
    Loop({ start: 1, end: P.uBlurK.add(int(1)), type: 'int', condition: '<', name: 'bk' }, ({ bk }) => {
      const kf = float(bk);
      const w = exp(kf.mul(kf).mul(inv2s2).negate());
      const iA = i.add(int(bk).mul(int(dx))), jA = j.add(int(bk).mul(int(dy)));
      const iB = i.sub(int(bk).mul(int(dx))), jB = j.sub(int(bk).mul(int(dy)));
      const nA = at(iA, jA), nB = at(iB, jB);
      const eA = select(maskBuf.element(nA).lessThan(1.0), buf.element(nA).x, e0);
      const eB = select(maskBuf.element(nB).lessThan(1.0), buf.element(nB).x, e0);
      sum.addAssign(eA.add(eB).mul(w));
      wsum.addAssign(w.mul(2.0));
    });
    return sum.div(wsum);
  };

  const blurX = Fn(() => {
    const id = int(instanceIndex);
    const i = id.mod(int(W)).toVar();
    const j = id.div(int(W)).toVar();
    const h0 = heatA.element(id).toVar();
    const inside = maskBuf.element(id).lessThan(1.0);
    const e = select(inside, blurAxis(heatA, i, j, 1, 0, h0.x), float(0.0));
    heatB.element(id).assign(vec4(e, h0.y, h0.z, h0.w));
  })().compute(N);

  const blurYUpdate = Fn(() => {
    const id = int(instanceIndex);
    const i = id.mod(int(W)).toVar();
    const j = id.div(int(W)).toVar();
    const h0 = heatB.element(id).toVar();
    const insideB = maskBuf.element(id).lessThan(1.0).toVar();
    const inside = select(insideB, float(1.0), float(0.0)).toVar();
    const eBlur = select(insideB, blurAxis(heatB, i, j, 0, 1, h0.x), float(0.0));
    const E = tclamp(eBlur.mul(P.uCoolK), 0.0, 12.0).mul(P.uEnergyOn).toVar();
    // Przebicie: rośnie nad progiem, maleje pod 60% progu, pomiędzy trzyma.
    const up = select(E.greaterThan(P.uThr), P.uBreachUp, float(0.0));
    const down = select(E.lessThan(P.uThr.mul(0.6)), P.uBreachDown, float(0.0));
    const B = tclamp(h0.y.add(up.sub(down).mul(P.uDtFrame)), 0.0, 1.0).mul(inside).mul(P.uEnergyOn).toVar();
    // Obwiednia aktywności fali: szybki szczyt, wolne wygasanie.
    const wv = waveA.element(id).toVar();
    const Wn = max(h0.z.mul(P.uWDecay), min(abs(wv.y).mul(P.uWGain), 1.5)).mul(inside).toVar();
    heatA.element(id).assign(vec4(E, B, Wn, 0.0));
    textureStore(tex, ivec2(i, j), vec4(wv.x, E, B, Wn));
  })().compute(N);

  // Mapa przebić dla CPU: 64×64, maksimum B w bloku komórek (przepuszczanie pocisków).
  const BM = 64;
  const bx = Math.ceil(W / BM), by = Math.ceil(H / BM);
  const breachMap = instancedArray(BM * BM, 'float');
  const breachReduce = Fn(() => {
    const id = int(instanceIndex);
    const ci = id.mod(int(BM)).mul(int(bx)).toVar();
    const cj = id.div(int(BM)).mul(int(by)).toVar();
    const m = float(0).toVar();
    Loop({ start: 0, end: by, type: 'int', condition: '<', name: 'rj' }, ({ rj }) => {
      Loop({ start: 0, end: bx, type: 'int', condition: '<', name: 'ri' }, ({ ri }) => {
        m.assign(max(m, heatA.element(at(ci.add(ri), cj.add(rj))).y));
      });
    });
    breachMap.element(id).assign(m);
  })().compute(BM * BM);
  const breachCpu = new Float32Array(BM * BM);
  let breachBusy = false;
  let breachAny = false;

  // Tablice przebiegów dla każdej parzystej liczby podkroków (bez alokacji w klatce).
  const waveGroups = [];
  for (let n = 0; n <= MAX_SUBSTEPS; n += 2) {
    const arr = [inject];
    for (let k = 0; k < n; k++) arr.push(k % 2 === 0 ? stepAB : stepBA);
    arr.push(blurX, blurYUpdate);
    waveGroups[n] = arr;
  }

  let needsInit = true;
  const field = {
    layout: L, tex, P, lastSubsteps: 0,
    describe() { return `${W}×${H} · ${L.cell.toFixed(2)} j.`; },
    // Stały krok fali: ≤ 1/240 s i z warunku CFL (Courant 0,5) dla tej siatki.
    stepFor(c) { return Math.min(1 / 240, 0.5 * L.cell / Math.max(c, 1)); },
    // Prędkość fali, przy której 60 kl./s mieści się w MAX_SUBSTEPS krokach.
    maxWaveSpeed() { return 0.5 * L.cell * MAX_SUBSTEPS * 60; },
    maxSubsteps: MAX_SUBSTEPS,
    reset() { renderer.compute(init); needsInit = false; },
    // n — parzysta liczba podkroków (0..MAX_SUBSTEPS): wstrzyknięcie, n kroków fali, ciepło.
    step(dt, n) {
      if (needsInit) { renderer.compute(init); needsInit = false; }
      renderer.compute(waveGroups[n]);
      this.lastSubsteps = n;
    },
    blurRadiusFor(sigmaCells) { return Math.max(1, Math.min(MAX_BLUR, Math.ceil(sigmaCells * 3))); },
    // Odczyt mapy przebić (asynchronicznie, nie częściej niż jeden naraz).
    requestBreachMap() {
      if (breachBusy) return;
      breachBusy = true;
      renderer.compute(breachReduce);
      renderer.getArrayBufferAsync(breachMap.value).then((buf) => {
        breachCpu.set(new Float32Array(buf, 0, BM * BM));
        let any = false;
        for (let i = 0; i < BM * BM; i++) if (breachCpu[i] > 0.5) { any = true; break; }
        breachAny = any;
      }).catch(() => {}).finally(() => { breachBusy = false; });
    },
    clearBreachMap() { breachCpu.fill(0); breachAny = false; },
    // Przebicie w punkcie lokalnym (klatka 3D) wg ostatniego odczytu.
    breachAt(lx, ly) {
      if (!breachAny) return false;
      const i = Math.floor((lx - L.x0) / L.cell / bx);
      const j = Math.floor((ly - L.y0) / L.cell / by);
      if (i < 0 || j < 0 || i >= BM || j >= BM) return false;
      return breachCpu[j * BM + i] > 0.5;
    },
    get breachAny() { return breachAny; },
    dispose() {
      tex.dispose();
      maskTex.dispose();
      for (const node of [init, inject, stepAB, stepBA, blurX, blurYUpdate, breachReduce]) node.dispose?.();
      for (const b of [maskBuf, waveA, waveB, heatA, heatB, breachMap]) b.value?.dispose?.();
    }
  };
  return field;
}
