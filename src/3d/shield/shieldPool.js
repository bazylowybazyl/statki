// src/3d/shield/shieldPool.js
//
// Tarcza z dema WebGPU (dema/tarcza-webgpu, heksy.js + iskry.js) w grze: PULA SLOTÓW.
// W demie każda tarcza miała własne pole (siatka 512 komórek), siatkę płytek (do 16 tys.) i pulę
// 64 tys. iskier — w bitwie ~100 okrętów to setki dispatchy i dziesiątki MB na klatkę. Tu:
//  • SHIELD_SLOTS slotów po SHIELD_SLOT_CAP płytek w JEDNYM zestawie buforów storage; slot dostaje
//    tylko tarcza, która właśnie oberwała (albo pęka) i jest na ekranie — reszta nie kosztuje nic;
//  • każdy kernel to JEDEN dispatch po wszystkich slotach (wątki slotów bez tarczy wychodzą od razu),
//    cała klatka = jedno renderer.compute(lista): zdarzenia → podkroki → stany → wygląd;
//  • pole z dema (osobna siatka kartezjańska: fala h, energia E, przebicie B) liczone WPROST na
//    siatce płytek — fala z laplasjanem heksagonalnym, energia z dyfuzją po sąsiadach (bez tekstury
//    pola i drugiej siatki); przebicie odrywa płytki, a mapa dziur (bit na płytkę, 6 KB) wraca na
//    CPU co ~0,1 s — pociski przelatują przez dziurę do pancerza (index.html, isShieldBreachedAt);
//  • jeden rysunek płytek dla wszystkich tarcz (warstwa tarcz), drugi w warstwie DIST (załamanie
//    tła — zamiast viewportTexture dema), trzeci — poświata pola na pancerzu pod płytkami (mnożenie
//    obrazu kadłuba: energia i fala barwią pancerz), jedna pula iskier ślizgających się po czaszach.
// Dane per slot (poza, barwa, parametry ciała miękkiego, pęknięcie) — jeden blok uniformów vec4.
// Pozycje płytek i iskier w klatce lokalnej tarczy (x wzdłuż kadłuba, y = −y gry, z w górę);
// na scenę obraca je poza slotu względem początku przy kamerze (siatki na mesh.position = początek).
// Czysty od Core3D — klej gry w src/3d/shield3D.js; WGSL budowany w Node (tests/shieldPool.test.mjs).

import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, float, int, uint, vec2, vec3, vec4, instancedArray, instanceIndex, attribute,
  varying, positionGeometry, positionView, normalize, cross, cos, sin, atan, dot, length, exp, max, min,
  abs, mix, floor, fract, smoothstep, saturate, select, sqrt, pow, step, If, Loop, clamp, hash, uv,
  cameraViewMatrix, transformNormalToView
} from 'three/tsl';
import { SHIELD_NEIGHBOR_DIRS } from './shieldLattice.js';

export const SHIELD_SLOTS = 12;
export const SHIELD_SLOT_CAP = 4096;
const TOTAL = SHIELD_SLOTS * SHIELD_SLOT_CAP;
export const SHIELD_BINS = 96;
export const SHIELD_MAX_EVENTS = 128;
export const SHIELD_SPARK_CAP = 1 << 15;
export const SHIELD_MAX_SPARK_SPAWNS = 48;
/** Podkrok ciała miękkiego i fali [s] — wspólny dla slotów (prędkość fali ograniczana per slot z CFL). */
export const SHIELD_SUBSTEP = 1 / 480;
export const SHIELD_MAX_SUBSTEPS = 16;
/** Wysokość czaszy nad płaszczyzną gry (scena) — jak dawna kopuła (mesh na z = 1). */
export const SHIELD_Z = 1;

// Blok slotu: SLOT_VEC4 × vec4 na slot.
export const SLOT_VEC4 = 12;
export const SLOT = {
  POSE: 0,   // przesunięcie od początku (scena x, y), cos, sin obrotu sceny
  LOOK: 1,   // barwa tarczy rgb (liniowa), życie (HP / max)
  GEOM: 2,   // odstęp płytek, promień opisany płytki, wysokość czaszy, slot żywy (0/1)
  SOFT: 3,   // K [1/s²], tłumienie, gojenie wgniecenia, powrót sprężysty (czynniki na podkrok)
  SOFT2: 4,  // granica płynięcia [j.], największe przesunięcie [j.], dyfuzja żaru, dyfuzja energii (na podkrok)
  WAVE: 5,   // c² fali [j²/s²], tłumienie γ [1/s], sztywność k [1/s²], |h| maks. [j.]
  SHAT: 6,   // pęknięcie: punkt x, y (lokalnie), chwila startu, wł.
  SHATK: 7,  // prędkość czoła [j./s], rozrzut oderwania [s], wyprzedzenie szwów [s], barwa pęknięcia (0/1)
  FLAGS: 8,  // odrastanie dozwolone, czoło rozruchu / gaszenia w t (−1 brak), siła czoła [j./s²], zerowanie (0 / 1 gotowe / 2 ukryte)
  MISC: 9,   // epoka slotu (iskry starsze gasną), liczba binów, —, słabe pole (0..1)
  HARD: 10   // twardość: próg przebicia (energia), tempo przebicia [1/s], pokaż tarczę (0..1), —
};

const SQ3 = Math.sqrt(3);

// Klasy trafień gry (pd / main / special / shield) — liczby z dema (tarcza.js HIT_CLASS) i iskier
// (iskry.js SPARK_CLASS: z PRESETS dawnego shieldImpactFx, ×6 bo punkt zamiast wstęgi).
export const SHIELD_HIT_CLASS = {
  pd: { radius: 20, impulse: 140, impulsePerDmg: 3.0, energy: 0.04, energyPerDmg: 0.004 },
  main: { radius: 42, impulse: 120, impulsePerDmg: 2.4, energy: 0.10, energyPerDmg: 0.0024 },
  special: { radius: 115, impulse: 300, impulsePerDmg: 1.0, energy: 0.45, energyPerDmg: 0.0009 },
  shield: { radius: 70, impulse: 80, impulsePerDmg: 0.6, energy: 0.08, energyPerDmg: 0.0012 }
};
export const SHIELD_SPARK_CLASS = {
  pd: { count: [5, 9], life: [0.10, 0.22], speed: [1.05, 2.10], fly: 0.35, heat: 0.8 },
  main: { count: [22, 34], life: [0.26, 0.52], speed: [1.15, 2.45], fly: 0.25, heat: 1.0 },
  special: { count: [80, 140], life: [0.65, 1.35], speed: [1.30, 3.00], fly: 0.2, heat: 1.35 },
  shield: { count: [55, 105], life: [0.50, 1.05], speed: [1.55, 3.20], fly: 0.15, heat: 1.15 }
};
export const SHIELD_SPARK_COUNT_SCALE = 6;

// Pęknięcie (strojenie z dema po spowolnieniu 2026-10-05, heksy.js SHATTER) — przepisywane do
// uniformów co klatkę, więc zmiany z konsoli (window.ShieldTuning.shatter) działają od razu.
export const SHIELD_SHATTER = {
  crossTime: 0.62, speedMin: 1300, speedMax: 4500,
  lag: 0.07, lead: 0.05,
  crack: 0.22, crackRadial: 0.45,
  shardFrac: 0.08,
  kickNear: 260, kickRadius: 240, drift: 60, jitter: 28, dustSpeed: 0.2,
  drag: 1.8, spin: 3.5,
  shardLife: [0.5, 1.1], dustLife: [0.09, 0.2],
  power: 1
};

// Czysta funkcja haszu (bez wołania innych funkcji z layoutem — pułapka 35).
export const shieldHash12 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'shieldHash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const sstepDown = (a, b, x) => float(1.0).sub(smoothstep(b, a, x));

export class ShieldPool {
  constructor() {
    const CAP = SHIELD_SLOT_CAP;
    this.cap = CAP;
    this.slots = SHIELD_SLOTS;

    // ── Uniformy wspólne (wartości przepisuje klej co klatkę) ──────────────────────
    const U = this.U = {
      time: uniform(0), dt: uniform(1 / 60), h: uniform(SHIELD_SUBSTEP),
      heatK: uniform(1), stressK: uniform(1), eCoolK: uniform(1),
      kick: uniform(1), reach: uniform(1.4), heatGain: uniform(2.2), flashGain: uniform(3.0),
      heatPeak: uniform(3.2), stressGain: uniform(1.2), gap: uniform(0.1), spec: uniform(1.0),
      dispScale: uniform(1.0), normalGain: uniform(1.0),
      lightDir: uniform(new THREE.Vector3(-0.45, 0.55, 0.7).normalize()),
      frontGlow: uniform(0), showAll: uniform(0), showSeam: uniform(0.3),
      refr: uniform(1.0), zoomPx: uniform(1.0),
      breachOn: uniform(1), breachDown: uniform(1 / 2.5),
      hullGlow: uniform(1),
      shatV: uniform(new THREE.Vector4()),   // odrzut przy punkcie, jego zasięg, dryf, rozrzut
      shatL: uniform(new THREE.Vector4()),   // życie odłamka min/maks, pyłu min/maks
      shatD: uniform(new THREE.Vector4()),   // opór, obrót, prędkość pyłu, —
      shatC: uniform(new THREE.Vector4()),   // szansa rysy, dodatek promienisty, część odłamków, siła
      evCount: uniform(0, 'int'),
      sparkMinW: uniform(1), sparkGain: uniform(1),
      spCount: uniform(0, 'int'), spSeed: uniform(0)
    };

    // Blok slotów (jeden bufor uniformów).
    this.slotData = Array.from({ length: SHIELD_SLOTS * SLOT_VEC4 }, () => new THREE.Vector4());
    const P = this.P = uniformArray(this.slotData, 'vec4').setName('shieldSlots');
    const prm = (slot, i) => P.element(slot.mul(SLOT_VEC4).add(i));
    this._prm = prm;
    // Zdarzenia klatki: (x, y, promień, impuls fali [j./s]) i (energia, slot, —, —).
    this.evA = Array.from({ length: SHIELD_MAX_EVENTS }, () => new THREE.Vector4());
    this.evB = Array.from({ length: SHIELD_MAX_EVENTS }, () => new THREE.Vector4());
    const EA = uniformArray(this.evA, 'vec4').setName('shieldEvA');
    const EB = uniformArray(this.evB, 'vec4').setName('shieldEvB');
    const DIRS = uniformArray(SHIELD_NEIGHBOR_DIRS.map(([x, y]) => new THREE.Vector4(x, y, 0, 0)), 'vec4').setName('shieldDirs');

    // ── Bufory płytek (TOTAL wpisów; slot s = wpisy [s·CAP, (s+1)·CAP)) ───────────
    const restB = this.restB = instancedArray(TOTAL, 'vec4');   // środek xyz, ziarno (< 0: brak płytki)
    const nrmB = this.nrmB = instancedArray(TOTAL, 'vec4');     // normalna czaszy, t (> 1,5: brak płytki)
    const nbrB = this.nbrB = instancedArray(TOTAL * 6, 'int');  // 6 sąsiadów (indeksy globalne, −1 brzeg)
    // Ciało miękkie: przyczepiona (przesunięcie xy, prędkość xy) / odłamek (prędkość xyz, obrót).
    const defA = instancedArray(TOTAL, 'vec4'), defB = instancedArray(TOTAL, 'vec4');
    // Żar, stres, wgniecenie xy / odłamek: żar, życie [s], rodzaj (1 odłamek, 2 pył), —.
    const heatA = instancedArray(TOTAL, 'vec4'), heatB = instancedArray(TOTAL, 'vec4');
    // Fala i energia (dawne pole dema): h, dh/dt, E, w — przyczepiona: 1 + B, oderwana: −(1 + B),
    // brak płytki: 0 (B = przebicie 0..1; „w > 0,5” = przyczepiona, „|w| > 0,5” = płytka istnieje).
    const waveA = instancedArray(TOTAL, 'vec4'), waveB = instancedArray(TOTAL, 'vec4');
    this.waveA = waveA;
    const stB = instancedArray(TOTAL, 'vec4');     // wiek oderwania (< 0 przyczepiona), wzrost, błysk, pęknięcie
    // Do rysunku:
    const poseB = instancedArray(TOTAL, 'vec4');   // przesunięcie xyz, wiek lotu (0 = przyczepiona)
    const lookB = instancedArray(TOTAL, 'vec4');   // przyczepiona: żar, stres, błysk, wzrost; odłamek: żar, życie, rodzaj, obrót
    const tiltB = instancedArray(TOTAL, 'vec4');   // gradient fali xy, h, E / próg
    this.binsB = instancedArray(SHIELD_SLOTS * SHIELD_BINS, 'float');
    this._gpuOnly = [defA, defB, heatA, heatB, waveA, waveB, stB, poseB, lookB, tiltB];
    // Bez płytek na starcie: ziarno −1, t = 2 (CPU pisze sloty przy przydziale).
    restB.value.array.fill(0);
    for (let i = 0; i < TOTAL; i++) { restB.value.array[i * 4 + 3] = -1; nrmB.value.array[i * 4 + 3] = 2; }
    nbrB.value.array.fill(-1);

    const slotOf = (id) => int(id).div(int(CAP));

    // ── Zerowanie slotów z flagą (przydział, zgaszenie) ───────────────────────────
    this.kReset = Fn(() => {
      const id = instanceIndex;
      const slot = slotOf(id).toVar();
      const mode = prm(slot, SLOT.FLAGS).w.toVar();
      If(mode.greaterThan(0.5), () => {
        const present = nrmB.element(id).w.lessThan(1.5).toVar();
        const s = stB.element(id).toVar();
        If(mode.lessThan(2.5).or(s.x.lessThan(0.0)), () => {
          const grown = select(mode.lessThan(1.5), float(1.0), float(0.0));
          defA.element(id).assign(vec4(0));
          heatA.element(id).assign(vec4(0));
          waveA.element(id).assign(vec4(0.0, 0.0, 0.0, select(present, float(1.0), float(0.0))));
          stB.element(id).assign(vec4(-1.0, grown, 0.0, 0.0));
          poseB.element(id).assign(vec4(0));
          lookB.element(id).assign(vec4(0.0, 0.0, 0.0, grown));
          tiltB.element(id).assign(vec4(0));
        });
      });
    })().compute(TOTAL);

    // ── Zdarzenia klatki: krater (ciało miękkie), żar, błysk rdzenia, impuls fali, energia ──
    const kInject = Fn(() => {
      const id = instanceIndex;
      const slot = slotOf(id).toVar();
      const geom = prm(slot, SLOT.GEOM).toVar();
      const w = waveA.element(id).toVar();
      If(geom.w.greaterThan(0.5).and(w.w.greaterThan(0.5)), () => {
        const r = restB.element(id).toVar();
        const s = stB.element(id).toVar();
        const dv = vec2(0).toVar();
        const dh = float(0).toVar();
        const fl = float(0).toVar();
        const dwv = float(0).toVar();
        const dE = float(0).toVar();
        const cell = geom.x.toVar();
        Loop({ start: 0, end: U.evCount, type: 'int', condition: '<', name: 'ev' }, ({ ev }) => {
          const b = EB.element(ev).toVar();
          If(int(b.y).equal(slot), () => {
            const a = EA.element(ev).toVar();
            const off = r.xy.sub(a.xy).toVar();
            const d2 = dot(off, off).toVar();
            // Krater szerszy niż zdarzenie (uReach) — czytelny z daleka; żar w promieniu zdarzenia.
            const rr = a.z.mul(U.reach).toVar();
            const r2 = rr.mul(rr).toVar();
            If(d2.lessThan(r2.mul(9.0)), () => {
              const g = exp(d2.div(r2).negate());
              const dd = sqrt(d2);
              dv.addAssign(off.div(max(dd, 1e-3)).mul(abs(a.w).mul(dd.div(rr)).mul(g).mul(2.33)));
              const q2 = d2.div(a.z.mul(a.z));
              dh.addAssign(b.x.mul(exp(q2.negate())));
              fl.addAssign(b.x.mul(exp(q2.div(0.16).negate())));
              // Fala i energia: gauss o promieniu zdarzenia, nie węższy niż płytka.
              const rf = max(a.z, cell.mul(0.8));
              const gf = exp(d2.div(rf.mul(rf)).negate());
              dwv.addAssign(a.w.mul(gf));
              dE.addAssign(b.x.mul(gf));
            });
          });
        });
        const dA = defA.element(id).toVar();
        defA.element(id).assign(vec4(dA.xy, dA.zw.add(dv.mul(U.kick))));
        const hA = heatA.element(id).toVar();
        heatA.element(id).assign(vec4(min(hA.x.add(dh.mul(U.heatGain)), 1.6), hA.y, hA.z, hA.w));
        stB.element(id).assign(vec4(s.x, s.y, min(s.z.add(fl.mul(U.flashGain)), 1.0), s.w));
        waveA.element(id).assign(vec4(w.x, clamp(w.y.add(dwv), -6000.0, 6000.0), min(w.z.add(dE), 12.0), w.w));
      });
    })().compute(TOTAL);

    // ── Podkrok: ciało miękkie (jak shader destruktora), fala (laplasjan heksagonalny,
    //    brzeg i dziury h = 0 — odbicie jak od zamocowanej krawędzi), dyfuzja energii (brzeg
    //    bez przepływu). Wiązanie liczone od spoczynku przesuniętego o wgniecenia (plastyczność).
    const makeStep = (dS, dD, hS, hD, wS, wD) => Fn(() => {
      const id = instanceIndex;
      const slot = slotOf(id).toVar();
      const geom = prm(slot, SLOT.GEOM).toVar();
      If(geom.w.greaterThan(0.5), () => {
        const me = dS.element(id).toVar();
        const hm = hS.element(id).toVar();
        const wm = wS.element(id).toVar();
        If(wm.w.greaterThan(0.5), () => {
          const soft = prm(slot, SLOT.SOFT).toVar();
          const soft2 = prm(slot, SLOT.SOFT2).toVar();
          const wave = prm(slot, SLOT.WAVE).toVar();
          const cell = geom.x.toVar();
          const K = soft.x.toVar();
          const F = vec2(0).toVar();
          const nAct = float(0).toVar();
          const strain = float(0).toVar();
          const hSum = float(0).toVar();
          const nHeat = float(0).toVar();
          const lapH = float(0).toVar();
          const lapE = float(0).toVar();
          const base = int(id).mul(6).toVar();
          Loop({ start: 0, end: 6, type: 'int', condition: '<', name: 'nb' }, ({ nb }) => {
            const j = nbrB.element(base.add(nb)).toVar();
            const eRest = DIRS.element(nb).xy.mul(cell).toVar();
            If(j.lessThan(int(0)), () => {
              // Brak sąsiada (za obrysem): punkt zamocowany w spoczynku.
              const Lr = length(eRest).toVar();
              const dir = eRest.div(Lr).toVar();
              const perp = vec2(dir.y.negate(), dir.x).toVar();
              const a = eRest.sub(me.xy).toVar();
              const proj = max(dot(a, dir), Lr.mul(0.22));
              const diff = proj.sub(Lr).toVar();
              const fm = diff.mul(K).mul(select(diff.lessThan(0.0), float(3.2), float(0.9)));
              const dvv = me.zw.negate();
              F.addAssign(dir.mul(fm).add(dir.mul(dot(dvv, dir).mul(14.0))).add(perp.mul(dot(dvv, perp).mul(7.0))));
              nAct.addAssign(1.0);
              strain.assign(max(strain, abs(diff).div(Lr)));
              lapH.subAssign(wm.x);
            }).Else(() => {
              const wj = wS.element(j).toVar();
              If(wj.w.greaterThan(0.5), () => {
                const o = dS.element(j).toVar();
                const hj = hS.element(j).toVar();
                const e = eRest.add(hj.zw).sub(hm.zw).toVar();
                const Lr = length(e).toVar();
                const dir = e.div(Lr).toVar();
                const perp = vec2(dir.y.negate(), dir.x).toVar();
                const a = eRest.add(o.xy).sub(me.xy).toVar();
                const proj = max(dot(a, dir), Lr.mul(0.22)).toVar();
                const diff = proj.sub(Lr).toVar();
                const fm = diff.mul(K).mul(select(diff.lessThan(0.0), float(3.2), float(0.9)));
                // Wybrzuszenie: mocno ściśnięte wiązanie wypycha płytkę w bok.
                const lat = dot(a, perp);
                const bulgeOn = diff.lessThan(Lr.mul(-0.12)).and(proj.greaterThan(Lr.mul(0.45)));
                const bulgeMag = min(diff.negate().mul(K).mul(0.8), Lr.mul(K).mul(0.45));
                const bulge = select(bulgeOn, perp.mul(select(lat.lessThan(0.0), float(-1.0), float(1.0))).mul(bulgeMag), vec2(0.0));
                const dvv = o.zw.sub(me.zw);
                F.addAssign(dir.mul(fm).add(bulge).add(dir.mul(dot(dvv, dir).mul(14.0))).add(perp.mul(dot(dvv, perp).mul(7.0))));
                nAct.addAssign(1.0);
                strain.assign(max(strain, abs(diff).div(Lr)));
                hSum.addAssign(hj.x);
                nHeat.addAssign(1.0);
                lapH.addAssign(wj.x.sub(wm.x));
                lapE.addAssign(wj.z.sub(wm.z));
              }).Else(() => {
                // Sąsiad odpadł (przebicie, pęknięcie): dziura — fala odbija się jak od brzegu, ciało
                // miękkie bez wiązania; energia płynie dalej (dziura to wciąż pole — stygnie i się zamyka).
                lapH.subAssign(wm.x);
                lapE.addAssign(wj.z.sub(wm.z));
              });
            });
          });
          const hstep = U.h;
          const Fn2 = F.div(sqrt(max(nAct, 1.0)));
          const v = me.zw.add(Fn2.mul(hstep)).mul(soft.y).toVar();
          v.assign(select(nAct.lessThan(2.0), v.mul(0.5), v));
          const vl = length(v);
          v.assign(select(vl.greaterThan(2400.0), v.mul(float(2400.0).div(max(vl, 1e-3))), v));
          // Wgniecenie goi się (gorąca płytka wolniej), sprężysta część wraca do wgniecenia;
          // ponad granicą płynięcia wgniecenie idzie za płytką.
          const pl = hm.zw.mul(mix(soft.z, float(1.0), saturate(hm.x).mul(0.7))).toVar();
          const d = me.xy.add(v.mul(hstep)).toVar();
          d.assign(pl.add(d.sub(pl).mul(soft.w)));
          const dl = length(d).toVar();
          d.assign(select(dl.greaterThan(soft2.y), d.mul(soft2.y.div(max(dl, 1e-3))), d));
          const el = d.sub(pl).toVar();
          const ell = length(el);
          pl.assign(select(ell.greaterThan(soft2.x), d.sub(el.mul(soft2.x.div(max(ell, 1e-3)))), pl));
          // Żar: stygnięcie + wyrównanie z sąsiadami; stres: obwiednia naprężenia i przesunięcia.
          const hMean = select(nHeat.greaterThan(0.5), hSum.div(max(nHeat, 1.0)), hm.x);
          const hN = hm.x.add(hMean.sub(hm.x).mul(soft2.z)).mul(U.heatK);
          const sNow = max(strain.div(0.15), length(d).div(cell.mul(0.6)));
          const sN = max(hm.y.mul(U.stressK), min(sNow, 2.0));
          // Fala: h_tt = c²∇²h − γh_t − k·h (laplasjan siatki trójkątnej: 2/(3d²)·Σ(h_j − h)).
          const lap = lapH.mul(2.0 / 3.0).div(cell.mul(cell));
          const fl = prm(slot, SLOT.FLAGS);
          const sw = nrmB.element(id).w.sub(fl.y).div(0.06);
          const fSweep = select(fl.y.greaterThanEqual(0.0), fl.z.mul(exp(sw.mul(sw).negate())), float(0.0));
          const vh = wm.y.add(wave.x.mul(lap).sub(wave.y.mul(wm.y)).sub(wave.z.mul(wm.x)).add(fSweep).mul(hstep));
          const hh = clamp(wm.x.add(vh.mul(hstep)), wave.w.negate(), wave.w);
          const E = clamp(wm.z.add(lapE.mul(soft2.w)).mul(U.eCoolK), 0.0, 12.0);
          dD.element(id).assign(vec4(d, v));
          hD.element(id).assign(vec4(hN, sN, pl));
          wD.element(id).assign(vec4(hh, clamp(vh, -6000.0, 6000.0), E, wm.w));
        }).Else(() => {
          dD.element(id).assign(me);
          hD.element(id).assign(hm);
          // Oderwana płytka (dziura w polu): bez fali, energia dyfunduje po sąsiadach i stygnie.
          const lapE = float(0).toVar();
          If(wm.w.lessThan(-0.5), () => {
            const base = int(id).mul(6).toVar();
            Loop({ start: 0, end: 6, type: 'int', condition: '<', name: 'eb' }, ({ eb }) => {
              const j = nbrB.element(base.add(eb)).toVar();
              If(j.greaterThanEqual(int(0)), () => { lapE.addAssign(wS.element(j).z.sub(wm.z)); });
            });
          });
          const E = clamp(wm.z.add(lapE.mul(prm(slot, SLOT.SOFT2).w)).mul(U.eCoolK), 0.0, 12.0);
          wD.element(id).assign(vec4(0.0, 0.0, select(wm.w.lessThan(-0.5), E, wm.z), wm.w));
        });
      });
    })().compute(TOTAL);
    const stepAB = makeStep(defA, defB, heatA, heatB, waveA, waveB);
    const stepBA = makeStep(defB, defA, heatB, heatA, waveB, waveA);

    // ── Stany płytek (raz na klatkę): oderwanie przy pęknięciu, lot odłamka, powrót, odrastanie.
    const kStates = Fn(() => {
      const id = instanceIndex;
      const slot = slotOf(id).toVar();
      const geom = prm(slot, SLOT.GEOM).toVar();
      const nr = nrmB.element(id).toVar();
      If(geom.w.greaterThan(0.5).and(nr.w.lessThan(1.5)), () => {
        const r = restB.element(id).toVar();
        const s = stB.element(id).toVar();
        const dd = defA.element(id).toVar();
        const hh = heatA.element(id).toVar();
        const ww = waveA.element(id).toVar();
        const fp = poseB.element(id).toVar();
        const sh = prm(slot, SLOT.SHAT).toVar();
        const shk = prm(slot, SLOT.SHATK).toVar();
        const fl = prm(slot, SLOT.FLAGS).toVar();
        const dt = U.dt;
        const shOn = sh.w.greaterThan(0.5).toVar();
        const distS = length(r.xy.sub(sh.xy)).toVar();
        // Czoło pęknięcia dochodzi do płytki w tReach; płytka odpada chwilę później (losowy
        // rozrzut) — siatka kruszy się, zamiast schodzić równą linią.
        const tReach = sh.z.add(distS.div(max(shk.x, 1.0)));
        const tDetach = tReach.add(shieldHash12(vec2(r.w.mul(71.0), 5.1)).mul(shk.y));
        const hitS = shOn.and(U.time.greaterThanEqual(tDetach)).toVar();
        const sweepOK = fl.y.lessThan(0.0).or(nr.w.lessThan(fl.y));
        const regrow = fl.x.greaterThan(0.5).and(sweepOK).toVar();
        const h1 = shieldHash12(vec2(r.w.mul(311.0), sh.z.mul(0.37).add(1.0))).toVar();
        const h2 = shieldHash12(vec2(r.w.mul(173.0).add(5.0), sh.z.mul(0.53).add(2.0))).toVar();
        const h3 = shieldHash12(vec2(r.w.mul(59.0).add(9.0), sh.z.mul(0.71).add(3.0))).toVar();
        // Przebicie (pole dema): B rośnie, gdy energia płytki przekracza próg, maleje poniżej 60%
        // progu; płytka odpada, gdy B przekroczy jej własny próg (0,45–0,7) — dziura rośnie po jednej
        // płytce, nie całą łatą. Wraca, gdy B < 0,25 i tarcza jest aktywna.
        // Próg i tempo przebicia per slot (SLOT.HARD — twardość tarczy: kadłub, tryb TARCZE gracza).
        const hard = prm(slot, SLOT.HARD).toVar();
        const En = ww.z.toVar();
        const up = select(En.greaterThan(hard.x), hard.y, float(0.0));
        const down = select(En.lessThan(hard.x.mul(0.6)), U.breachDown, float(0.0));
        const B = clamp(max(abs(ww.w).sub(1.0), 0.0).add(up.sub(down).mul(dt)), 0.0, 1.0).mul(U.breachOn).toVar();
        const thrB = shieldHash12(vec2(r.w.mul(97.0), 3.7)).mul(0.25).add(0.45);
        const hitB = B.greaterThan(thrB).and(shOn.not()).toVar();
        If(s.x.lessThan(0.0), () => {
          If(hitS, () => {
            // Przy punkcie pęknięcia odrzut od niego (e^(−d/R)), dalej powolny dryf od środka
            // tarczy i wzdłuż normalnej czaszy; pył prawie stoi. Odłamków przy punkcie więcej.
            const SV = U.shatV, SL = U.shatL, SD = U.shatD, SC = U.shatC;
            const near = exp(distS.div(max(SV.y, 1.0)).negate()).toVar();
            const shard = shieldHash12(vec2(r.w.mul(211.0), 7.3)).lessThan(SC.z.mul(mix(float(0.75), float(1.9), near))).toVar();
            const away = r.xy.sub(sh.xy).div(max(distS, 1.0));
            const radial = r.xy.div(max(length(r.xy), 1.0));
            const sp = SC.w.mul(h1.mul(0.7).add(0.65)).mul(select(shard, float(1.0), SD.z)).toVar();
            const lat = away.mul(near.mul(SV.x)).add(radial.mul(SV.z));
            const v3 = vec3(lat, 0.0).add(nr.xyz.mul(SV.z.mul(0.6)))
              .add(vec3(h2.sub(0.5), h3.sub(0.5), h1.mul(0.5)).mul(SV.w.mul(2.0))).mul(sp);
            const hl = shieldHash12(vec2(r.w.mul(131.0), 2.9));
            const life = select(shard, mix(SL.x, SL.y, hl), mix(SL.z, SL.w, hl));
            fp.assign(vec4(dd.x, dd.y, 0.0, 1e-4));
            dd.assign(vec4(v3, h2.sub(0.5).mul(SD.y.mul(2.0)).mul(select(shard, float(1.0), float(0.4)))));
            s.assign(vec4(0.0, s.y, 0.0, 1.0));
            hh.assign(vec4(max(hh.x, 0.8), life, select(shard, float(1.0), float(2.0)), 0.0));
            ww.assign(vec4(0.0, 0.0, ww.z, B.add(1.0).negate()));
          }).ElseIf(hitB, () => {
            // Przebicie: wyrzut wzdłuż normalnej z ruchem płytki (jak demo).
            const sp = h1.mul(0.8).add(0.6).mul(260.0);
            const v3 = vec3(dd.zw.mul(0.6), 0.0).add(nr.xyz.mul(sp.mul(0.55))).add(vec3(h2.sub(0.5), h3.sub(0.5), h1.mul(0.5)).mul(160.0));
            fp.assign(vec4(dd.x, dd.y, 0.0, 1e-4));
            dd.assign(vec4(v3, h2.sub(0.5).mul(16.0)));
            s.assign(vec4(0.0, s.y, 0.0, 0.0));
            hh.assign(vec4(max(hh.x, 1.0), 1.25, 0.0, 0.0));
            ww.assign(vec4(0.0, 0.0, ww.z, B.add(1.0).negate()));
          }).Else(() => {
            const grow = select(regrow, dt.div(0.35), float(0.0));
            s.assign(vec4(s.x, min(s.y.add(grow), 1.0), s.z.mul(exp(dt.mul(-11.0))), s.w));
            ww.assign(vec4(ww.xyz, B.add(1.0)));
          });
        }).Else(() => {
          const age = s.x.add(dt).toVar();
          // Odłamki pęknięcia mocno hamują (wiszą i gasną), odłamki przebicia lecą dalej.
          const nv = dd.xyz.mul(exp(dt.mul(select(hh.z.greaterThan(0.5), U.shatD.x, float(0.9))).negate())).toVar();
          fp.assign(vec4(fp.xyz.add(nv.mul(dt)), age));
          dd.assign(vec4(nv, dd.w));
          hh.assign(vec4(hh.x.mul(exp(dt.mul(-1.6))), hh.y, hh.z, 0.0));
          // Powrót: odłamek zgasł, tarcza aktywna (za czołem rozruchu), pęknięcie skończone, dziura
          // zamknięta (B < 0,25).
          If(regrow.and(age.greaterThan(max(hh.y, 0.05))).and(shOn.not()).and(B.lessThan(0.25)), () => {
            s.assign(vec4(-1.0, h2.mul(-0.9), 0.0, 0.0));
            fp.assign(vec4(0.0));
            dd.assign(vec4(0.0));
            hh.assign(vec4(0.0));
            ww.assign(vec4(0.0, 0.0, ww.z, B.add(1.0)));
          }).Else(() => {
            s.assign(vec4(age, s.y, s.z, s.w));
            ww.assign(vec4(ww.xyz, B.add(1.0).negate()));
          });
        });
        stB.element(id).assign(s);
        defA.element(id).assign(dd);
        heatA.element(id).assign(hh);
        waveA.element(id).assign(ww);
        poseB.element(id).assign(select(s.x.lessThan(0.0), vec4(dd.x, dd.y, 0.0, 0.0), vec4(fp.xyz, max(s.x, 1e-4))));
      });
    })().compute(TOTAL);

    // ── Wygląd (raz na klatkę): dane rysunku, poświata szwów przed czołem pęknięcia, gradient fali.
    const kLook = Fn(() => {
      const id = instanceIndex;
      const slot = slotOf(id).toVar();
      const geom = prm(slot, SLOT.GEOM).toVar();
      const r = restB.element(id).toVar();
      If(geom.w.greaterThan(0.5).and(r.w.greaterThanEqual(0.0)), () => {
        const s = stB.element(id).toVar();
        const dd = defA.element(id).toVar();
        const hh = heatA.element(id).toVar();
        const ww = waveA.element(id).toVar();
        const sh = prm(slot, SLOT.SHAT).toVar();
        const shk = prm(slot, SLOT.SHATK).toVar();
        const cell = geom.x.toVar();
        const thr = max(prm(slot, SLOT.HARD).x, 0.05).toVar();
        If(s.x.lessThan(0.0), () => {
          // Szwy zapalają się przed czołem (wyprzedzenie losowe — brzeg poświaty postrzępiony),
          // najjaśniej przy przejściu czoła, potem przygasają do oderwania; jasność różna na płytkę.
          const distS = length(r.xy.sub(sh.xy));
          const since = U.time.sub(sh.z.add(distS.div(max(shk.x, 1.0)))).toVar();
          const lead = shk.z.mul(shieldHash12(vec2(r.w.mul(43.0), 8.2)).mul(0.8).add(0.6));
          const preVar = shieldHash12(vec2(r.w.mul(29.0), 6.6)).mul(0.7).add(0.6);
          const pre = select(sh.w.greaterThan(0.5), smoothstep(lead.negate(), 0.0, since)
            .mul(float(1.0).sub(smoothstep(0.0, shk.y.add(0.02), since).mul(0.4))).mul(preVar), float(0.0));
          // Gradient fali: Σ kierunek·(h_j − h) / (3d); brzeg i dziury h = 0.
          const g = vec2(0).toVar();
          const base = int(id).mul(6).toVar();
          Loop({ start: 0, end: 6, type: 'int', condition: '<', name: 'gb' }, ({ gb }) => {
            const j = nbrB.element(base.add(gb)).toVar();
            const hj = float(0).toVar();
            If(j.greaterThanEqual(int(0)), () => {
              const wj = waveA.element(j).toVar();
              hj.assign(select(wj.w.greaterThan(0.5), wj.x, float(0.0)));
            });
            g.addAssign(DIRS.element(gb).xy.mul(hj.sub(ww.x)));
          });
          lookB.element(id).assign(vec4(hh.x, hh.y.add(pre), s.z, s.y));
          tiltB.element(id).assign(vec4(g.div(cell.mul(3.0)), ww.x, ww.z.div(thr)));
        }).Else(() => {
          lookB.element(id).assign(vec4(hh.x, hh.y, hh.z, dd.w));
          // Dziura: bez fali, energia zostaje (brzeg przebicia żarzy się, pancerz pod nią świeci).
          tiltB.element(id).assign(vec4(0.0, 0.0, 0.0, ww.z.div(thr)));
        });
      });
    })().compute(TOTAL);

    // ── Mapa przebić dla CPU: bit na płytkę (B > 0,5), 32 płytki na słowo — 6 KB, odczyt co ~0,1 s.
    const breachBits = this.breachBits = instancedArray(TOTAL / 32, 'uint');
    this.kBreach = Fn(() => {
      const w0 = int(instanceIndex).mul(32).toVar();
      const bits = uint(0).toVar();
      Loop({ start: 0, end: 32, type: 'int', condition: '<', name: 'bb' }, ({ bb }) => {
        const w = waveA.element(w0.add(bb)).w;
        If(abs(w).greaterThan(1.5), () => { bits.assign(bits.bitOr(uint(1).shiftLeft(uint(bb)))); });
      });
      breachBits.element(instanceIndex).assign(bits);
    })().compute(TOTAL / 32);

    // Listy przebiegów dla każdej parzystej liczby podkroków (bez alokacji w klatce).
    this._groups = [];
    for (let k = 0; k <= SHIELD_MAX_SUBSTEPS; k += 2) {
      const arr = [kInject];
      for (let m = 0; m < k; m++) arr.push(m % 2 === 0 ? stepAB : stepBA);
      arr.push(kStates, kLook);
      this._groups[k] = arr;
    }
    this._kernels = [this.kReset, kInject, stepAB, stepBA, kStates, kLook, this.kBreach];

    // ── Rysunek płytek (warstwa tarcz) ─────────────────────────────────────────────
    const aRim = attribute('aRim', 'float');
    const restA = restB.toAttribute();
    const nrmA = nrmB.toAttribute();
    const poseA = poseB.toAttribute();
    const lookA = lookB.toAttribute();
    const tiltA = tiltB.toAttribute();
    const slotV = slotOf(instanceIndex);
    const pose = prm(slotV, SLOT.POSE);
    const geomV = prm(slotV, SLOT.GEOM);
    const isFly = step(1e-5, poseA.w);
    const n0 = normalize(nrmA.xyz);
    const nTilt = normalize(n0.sub(vec3(tiltA.xy.mul(U.normalGain), 0.0)));
    const rotN = (n) => vec3(n.x.mul(pose.z).sub(n.y.mul(pose.w)), n.x.mul(pose.w).add(n.y.mul(pose.z)), n.z);
    const flagsV = prm(slotV, SLOT.FLAGS);
    // Widoczność płytki: bez żaru, stresu, błysku i odrastania — zero wielkości (brak fragmentów).
    const grow = saturate(lookA.w);
    const forming = grow.mul(grow.oneMinus()).mul(4.0).mul(U.frontGlow);
    const sweepBand = select(flagsV.y.greaterThanEqual(0.0),
      sstepDown(0.07, 0.0, abs(nrmA.w.sub(flagsV.y))), float(0.0)).mul(U.frontGlow);
    const stressVis = max(lookA.y.sub(0.3), 0.0).div(0.7);
    const visAtt = max(lookA.x.sub(0.035), 0.0).add(stressVis).add(lookA.z).add(forming).add(sweepBand).add(U.showAll)
      .add(prm(slotV, SLOT.HARD).z);
    // Odłamek: pył (siatka rys) gaśnie prawie w miejscu, odłamek pęknięcia (70%) maleje do ~25%.
    const flyLife = max(lookA.y, 0.05);
    const flyK = saturate(poseA.w.div(flyLife));
    const flyScale = mix(float(1.0),
      mix(float(0.7).sub(flyK.mul(0.45)), float(0.92).sub(flyK.mul(0.35)), step(1.5, lookA.z)),
      step(0.5, lookA.z));
    const shown = select(isFly.greaterThan(0.5), step(poseA.w, flyLife), step(0.004, visAtt));
    const circR = geomV.y;
    const tilePosition = Fn(() => {
      const flying = isFly.toVar();
      const N = normalize(mix(nTilt, n0, flying)).toVar();
      const scale = mix(grow, flyScale, flying).mul(U.gap.oneMinus()).mul(shown).mul(circR)
        .mul(step(0.5, geomV.w)).mul(step(0.0, restA.w)).toVar();
      const o2 = positionGeometry.xy.mul(scale).toVar();
      // Płaszczyzna styczna nad punktem siatki: rzut z góry pokrywa się z komórką.
      const lift = o2.x.mul(N.x).add(o2.y.mul(N.y)).negate().div(max(N.z, 0.3));
      const o = vec3(o2, lift).toVar();
      // Odłamek: obrót Rodriguesa wokół osi z ziarna płytki.
      const ax = normalize(vec3(shieldHash12(vec2(restA.w.mul(91.0), 1.0)).sub(0.5),
        shieldHash12(vec2(restA.w.mul(37.0), 2.0)).sub(0.5), shieldHash12(vec2(restA.w.mul(53.0), 3.0)).sub(0.5)).add(vec3(0.001)));
      const ang = lookA.w.mul(poseA.w).mul(flying);
      const c = cos(ang), s = sin(ang);
      const rot = o.mul(c).add(cross(ax, o).mul(s)).add(ax.mul(dot(ax, o)).mul(c.oneMinus()));
      const wave = n0.mul(tiltA.z.mul(U.dispScale)).mul(flying.oneMinus());
      const L = restA.xyz.add(poseA.xyz).add(wave).add(rot).toVar();
      return vec3(pose.x.add(pose.z.mul(L.x)).sub(pose.w.mul(L.y)), pose.y.add(pose.w.mul(L.x)).add(pose.z.mul(L.y)), L.z.add(SHIELD_Z));
    })();
    const vSlot = varying(slotV.toFloat());
    const vE = varying(max(tiltA.w, 0.0));
    const vN = varying(transformNormalToView(rotN(nTilt)));
    const vN0 = varying(transformNormalToView(rotN(n0)));

    // Wspólne wartości fragmentu płytki (barwa slotu, żar, stres, rysy).
    const tileShade = () => {
      const slotF = int(vSlot.add(0.5));
      const look = prm(slotF, SLOT.LOOK).toVar();
      const sh = prm(slotF, SLOT.SHAT).toVar();
      const mixB = prm(slotF, SLOT.SHATK).w.toVar();
      const cell = prm(slotF, SLOT.GEOM).x.toVar();
      const lk = lookA.toVar();
      const rim = aRim.toVar();
      const edge = smoothstep(0.8, 0.97, rim).toVar();
      const base = mix(vec3(1.0, 0.08, 0.04), look.xyz, look.w).toVar();
      const heat = min(lk.x, 1.1).toVar();
      const hq = heat.mul(heat);
      const I = heat.mul(0.26).add(hq.mul(hq).mul(0.74)).mul(U.heatPeak).toVar();
      const st = min(max(lk.y.sub(0.3), 0.0).div(0.7), 2.2).toVar();
      // Rysy pęknięcia: wspólna krawędź dwóch płytek (jej środek w siatce spoczynkowej) losuje raz
      // — rysa ciągła przez szew obu płytek; szwy promieniste od punktu pęknięcia pękają chętniej.
      const pg = positionGeometry.xy.add(vec2(1.3e-4, 0.7e-4)).toVar();
      const eTh = floor(atan(pg.y, pg.x).add(Math.PI / 6).div(Math.PI / 3)).mul(Math.PI / 3);
      const eDir = vec2(cos(eTh), sin(eTh)).toVar();
      const eMid = restA.xy.add(eDir.mul(cell.mul(0.5))).toVar();
      const eKey = floor(eMid.div(cell.mul(0.25)).add(0.5));
      const eRad = normalize(eMid.sub(sh.xy).add(vec2(1e-3, 0.0)));
      const eAl = abs(dot(vec2(eDir.y.negate(), eDir.x), eRad)).toVar();
      const pCrack = eAl.mul(eAl).mul(eAl.mul(eAl)).mul(U.shatC.y).add(U.shatC.x);
      const crack = step(shieldHash12(eKey.mul(vec2(0.0731, 0.0517)).add(fract(sh.z.mul(0.123)).mul(37.0))), pCrack).toVar();
      return { lk, rim, edge, base, heat, I, st, crack, mixB };
    };
    const breakCol = vec3(1.0, 0.35, 0.22);
    const white = vec3(1.3, 1.15, 1.0);

    const mat = this.tileMaterial = new THREE.NodeMaterial();
    mat.name = 'ShieldTiles';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.side = THREE.DoubleSide;
    mat.forceSinglePass = true;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.positionNode = tilePosition;
    mat.fragmentNode = Fn(() => {
      const { lk, rim, edge, base, heat, I, st, crack, mixB } = tileShade();
      const flyAge = poseA.w.toVar();
      const fly = isFly.toVar();
      // Żar: rampa w barwach tarczy (głęboki błękit → barwa tarczy → błękitna biel → biel).
      const ramp = mix(base.mul(0.3), base, smoothstep(0.0, 0.3, heat)).toVar();
      ramp.assign(mix(ramp, mix(base, vec3(0.72, 0.9, 1.0), 0.7), smoothstep(0.3, 0.65, heat)));
      ramp.assign(mix(ramp, vec3(1.0, 0.97, 0.93), smoothstep(0.65, 1.0, heat)));
      // Przeciążenie: energia pola blisko progu → pomarańcz.
      ramp.assign(mix(ramp, vec3(1.0, 0.45, 0.14), smoothstep(0.6, 1.15, vE).mul(0.85)));
      const body = rim.mul(rim).mul(0.45).add(0.1);
      const heatE = ramp.mul(I).mul(body.add(edge.mul(1.3)));
      // Stres: szwy w barwie tarczy (przy pęknięciu — barwa pęknięcia, jasne na rysach, bez wypełnienia).
      const sCol = mix(mix(base, vec3(0.8, 0.93, 1.0), 0.35), breakCol, mixB).toVar();
      const crackK = mix(float(1.0), mix(float(0.2), float(1.35), crack), mixB);
      const stressE = sCol.mul(st.mul(st).mul(0.5).add(st.mul(0.5))).mul(U.stressGain)
        .mul(edge.mul(1.5).mul(crackK).add(mix(float(0.12), float(0.025), mixB)));
      // Błysk rdzenia świeżego trafienia.
      const flashE = vec3(1.0, 0.97, 0.94).mul(lk.z).mul(edge.mul(0.8).add(0.6)).mul(2.6);
      // Odrastanie, fronty rozruchu, „pokaż heksy” — same szwy.
      const g = saturate(lk.w);
      // Tarcza pokazana (SLOT.HARD.z — tryb TARCZE gracza): stałe szwy siatki w barwie tarczy.
      const showK = prm(int(vSlot.add(0.5)), SLOT.HARD).z;
      const formE = sCol.mul(g.mul(g.oneMinus()).mul(4.0).mul(U.frontGlow).add(sweepBand.mul(1.2)).add(U.showAll.mul(0.22))
        .add(showK.mul(U.showSeam))).mul(edge);
      // Połysk: płytka przechylona falą łapie światło (w spoczynku nic).
      const Nv = normalize(vN).toVar();
      const V = normalize(positionView.negate());
      const Lv = normalize(cameraViewMatrix.mul(vec4(U.lightDir, 0.0)).xyz);
      const Hv = normalize(Lv.add(V));
      const dN = Nv.sub(normalize(vN0));
      const tiltK = saturate(length(dN).mul(9.0));
      const spec = sCol.mul(pow(max(dot(Nv, Hv), 0.0), 70.0).mul(tiltK).mul(0.8).mul(U.spec)).mul(body.add(edge));
      const attE = heatE.add(stressE).add(flashE).add(formE).add(spec);
      // Odłamki pęknięcia: szkło pola — jasny brzeg, prawie przezroczyste wnętrze, stygną do
      // ciemnej czerwieni; pył = same linie rys gasnące w ułamku sekundy.
      const k = saturate(flyAge.div(max(lk.y, 0.05))).toVar();
      const fade = k.oneMinus().mul(k.oneMinus()).toVar();
      const hot = exp(flyAge.mul(-12.0)).toVar();
      const ember = mix(breakCol, vec3(0.5, 0.05, 0.03), smoothstep(0.15, 0.85, k));
      const slotF = int(vSlot.add(0.5));
      const sh = prm(slotF, SLOT.SHAT);
      const nearS = exp(length(restA.xy.sub(sh.xy)).div(max(U.shatV.y, 1.0)).negate());
      // Jasność brzegu ~1,4: wyżej tone mapping wybiela pomarańcz do bladego różu.
      const shardE = mix(ember, white, hot.mul(0.45)).mul(edge.mul(1.45)).add(ember.mul(0.05)).add(white.mul(hot).mul(0.12))
        .mul(fade).mul(mix(float(0.55), float(1.0), nearS));
      const dustE = breakCol.mul(edge.mul(crack).mul(1.5)).mul(fade);
      // Odłamek przebicia (rodzaj 0): barwa żaru i pęknięcia, biały rozbłysk przy oderwaniu (jak demo).
      const breachE = mix(ramp, breakCol, 0.6).mul(edge.mul(2.1).add(0.3))
        .add(white.mul(exp(flyAge.mul(-6.0))).mul(edge.mul(0.6).add(0.4)))
        .mul(fade).mul(heat.mul(0.5).add(0.6));
      const debrisE = mix(breachE, mix(shardE, dustE, step(1.5, lk.z)), step(0.5, lk.z));
      return vec4(max(mix(attE, debrisE, fly), vec3(0.0)), 0.0);
    })();

    const geo = hexGeometry();
    const mesh = this.tileMesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ShieldTiles';
    mesh.count = TOTAL;
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.visible = false;

    // ── Załamanie tła (warstwa DIST): przechył płytki × maska świecenia, px w osiach sceny ──
    const dmat = this.distMaterial = new THREE.NodeMaterial();
    dmat.name = 'ShieldTilesDist';
    dmat.transparent = true;
    dmat.depthWrite = false;
    dmat.depthTest = false;
    dmat.side = THREE.DoubleSide;
    dmat.forceSinglePass = true;
    dmat.lights = false;
    dmat.fog = false;
    dmat.blending = THREE.CustomBlending;
    dmat.blendEquation = THREE.AddEquation;
    dmat.blendSrc = THREE.OneFactor;
    dmat.blendDst = THREE.OneFactor;
    dmat.blendEquationAlpha = THREE.AddEquation;
    dmat.blendSrcAlpha = THREE.OneFactor;
    dmat.blendDstAlpha = THREE.OneFactor;
    dmat.positionNode = tilePosition;
    dmat.fragmentNode = Fn(() => {
      const { lk, I, st, mixB } = tileShade();
      // Jak demo: tło za płytką przesunięte o jej przechył tylko tam, gdzie świeci; szwy
      // pęknięcia prawie nie załamują (dawniej łososiowa płyta na całej czaszy).
      const mask = saturate(I.mul(0.12).add(st.mul(mix(float(0.25), float(0.04), mixB))).add(lk.z.mul(0.4)))
        .mul(isFly.oneMinus());
      const dN = normalize(vN).sub(normalize(vN0));
      // Demo: próbka w screenUV + przechył·(90 j. ośrodka · 2,5) → warstwa DIST: próbka w p − o.
      const o = dN.xy.mul(U.zoomPx.mul(U.refr).mul(-225.0)).mul(mask);
      return vec4(o, 0.0, 0.0);
    })();
    const dmesh = this.distMesh = new THREE.Mesh(geo, dmat);
    dmesh.name = 'ShieldTilesDist';
    dmesh.count = TOTAL;
    dmesh.frustumCulled = false;
    dmesh.visible = false;

    // ── Poświata pola na pancerzu (demo: emisja kadłuba ∝ E + |fala| w barwie tarczy × albedo): każda
    //    płytka kładzie pod sobą miękką plamę; mnożenie obrazu w passie tarcz (dst · (1 + src)) przed
    //    płytkami — pancerz pod rozgrzaną łatą błękitnieje (przy przeciążeniu bieleje i pomarańczowieje),
    //    fala przebiega po nim jak odbicie, a ciemne tło prawie się nie zmienia.
    const gmat = this.glowMaterial = new THREE.NodeMaterial();
    gmat.name = 'ShieldHullGlow';
    gmat.transparent = true;
    gmat.depthWrite = false;
    gmat.depthTest = false;
    gmat.side = THREE.DoubleSide;
    gmat.forceSinglePass = true;
    gmat.lights = false;
    gmat.fog = false;
    gmat.blending = THREE.CustomBlending;
    gmat.blendEquation = THREE.AddEquation;
    gmat.blendSrc = THREE.DstColorFactor;
    gmat.blendDst = THREE.OneFactor;
    gmat.blendEquationAlpha = THREE.AddEquation;
    gmat.blendSrcAlpha = THREE.ZeroFactor;
    gmat.blendDstAlpha = THREE.OneFactor;
    const att = isFly.oneMinus();
    const eN = max(tiltA.w, 0.0);
    const glowK = eN.mul(0.8).add(max(lookA.y.sub(0.3), 0.0).div(0.7).mul(0.35).mul(att))
      .add(abs(tiltA.z).mul(0.012).mul(att)).mul(U.hullGlow);
    const vGlow = varying(glowK);
    const vEN = varying(eN);
    gmat.positionNode = Fn(() => {
      const scale = geomV.x.mul(1.3).mul(step(0.004, glowK)).mul(step(0.5, geomV.w)).mul(step(0.0, restA.w));
      const L = restA.xy.add(positionGeometry.xy.mul(scale)).toVar();
      return vec3(pose.x.add(pose.z.mul(L.x)).sub(pose.w.mul(L.y)), pose.y.add(pose.w.mul(L.x)).add(pose.z.mul(L.y)), float(SHIELD_Z * 0.5));
    })();
    gmat.fragmentNode = Fn(() => {
      const look = prm(int(vSlot.add(0.5)), SLOT.LOOK);
      const lColor = mix(vec3(1.0, 0.08, 0.04), look.xyz, look.w);
      const col = mix(mix(lColor, vec3(1.25, 1.3, 1.4), smoothstep(0.42, 0.9, vEN)), vec3(1.9, 0.62, 0.16), smoothstep(0.95, 1.45, vEN));
      const q = positionGeometry.xy;
      // Gauss na kwadracie 2 × 2 (σ ≈ 0,5 odstępu): plamy sąsiadów sumują się w gładkie pole (~×2,6).
      const g = exp(dot(q, q).mul(-2.8)).mul(float(1.0).sub(smoothstep(0.8, 1.0, length(q))));
      return vec4(col.mul(vGlow).mul(g).mul(1.6 / 2.6 * 2.0), 0.0);
    })();
    const gmesh = this.glowMesh = new THREE.Mesh(quadGeometry(), gmat);
    gmesh.name = 'ShieldHullGlow';
    gmesh.count = TOTAL;
    gmesh.frustumCulled = false;
    gmesh.renderOrder = 9;
    gmesh.visible = false;

    this._buildSparks(prm);
  }

  // ── Iskry na czaszach (compute): ślizg po czaszy slotu (r(θ) z binów slotu), na krawędzi
  //    odrywają się; mniejszość odlatuje od razu. Klatka lokalna slotu (jedzie z okrętem).
  _buildSparks(prm) {
    const N = SHIELD_SPARK_CAP;
    const U = this.U;
    const NB = SHIELD_BINS;
    const TWO_PI = Math.PI * 2;
    const pos = this.spPos = instancedArray(N, 'vec4');    // xyz, wiek
    const vel = this.spVel = instancedArray(N, 'vec4');    // prędkość, życie (> 0 ślizg, < 0 lot)
    const info = this.spInfo = instancedArray(N, 'vec4');  // żar, grubość, chwila narodzin, slot
    const bins = this.binsB;
    this.spA = Array.from({ length: SHIELD_MAX_SPARK_SPAWNS }, () => new THREE.Vector4()); // x, y, z, liczba
    this.spB = Array.from({ length: SHIELD_MAX_SPARK_SPAWNS }, () => new THREE.Vector4()); // normalna, start w puli
    this.spC = Array.from({ length: SHIELD_MAX_SPARK_SPAWNS }, () => new THREE.Vector4()); // v min/maks, życie min/maks
    this.spD = Array.from({ length: SHIELD_MAX_SPARK_SPAWNS }, () => new THREE.Vector4()); // lot, żar, grubość, rozrzut
    this.spE = Array.from({ length: SHIELD_MAX_SPARK_SPAWNS }, () => new THREE.Vector4()); // slot, —
    const SA = uniformArray(this.spA, 'vec4').setName('shieldSpA');
    const SB = uniformArray(this.spB, 'vec4').setName('shieldSpB');
    const SCc = uniformArray(this.spC, 'vec4').setName('shieldSpC');
    const SD = uniformArray(this.spD, 'vec4').setName('shieldSpD');
    const SE = uniformArray(this.spE, 'vec4').setName('shieldSpE');
    this._gpuOnly.push(pos, vel, info);

    // r(θ) slotu — Catmull-Rom po binach (jak sampleShieldProfileRadius); wklejana (czyta bufor).
    const profileR = (slot, th) => {
      const f = fract(th.div(TWO_PI)).mul(NB).toVar();
      const fi = floor(f);
      const u = f.sub(fi).toVar();
      const i1 = int(fi).mod(int(NB)).toVar();
      const b0 = slot.mul(NB).toVar();
      const p0 = bins.element(b0.add(i1.add(int(NB - 1)).mod(int(NB))));
      const p1 = bins.element(b0.add(i1));
      const p2 = bins.element(b0.add(i1.add(int(1)).mod(int(NB))));
      const p3 = bins.element(b0.add(i1.add(int(2)).mod(int(NB))));
      const u2 = u.mul(u), u3 = u2.mul(u);
      return p1.mul(2.0).add(p2.sub(p0).mul(u))
        .add(p0.mul(2.0).sub(p1.mul(5.0)).add(p2.mul(4.0)).sub(p3).mul(u2))
        .add(p0.negate().add(p1.mul(3.0)).sub(p2.mul(3.0)).add(p3).mul(u3)).mul(0.5);
    };

    this.kSparks = Fn(() => {
      const idx = instanceIndex;
      const fi = float(idx).toVar();
      const p = pos.element(idx).toVar();
      const v = vel.element(idx).toVar();
      const inf = info.element(idx).toVar();
      // Narodziny: iskra w przedziale [start, start + liczba) któregoś zgłoszenia.
      Loop({ start: 0, end: U.spCount, type: 'int', condition: '<', name: 'sp' }, ({ sp }) => {
        const a = SA.element(sp);
        const b = SB.element(sp);
        const rel = fi.sub(b.w).add(N).mod(N);
        If(rel.lessThan(a.w), () => {
          const c = SCc.element(sp);
          const d = SD.element(sp);
          const e = SE.element(sp);
          const s = fi.add(U.spSeed);
          const h1 = hash(s.mul(3.0).add(1.0));
          const h2 = hash(s.mul(5.0).add(2.0));
          const h3 = hash(s.mul(7.0).add(3.0));
          const h4 = hash(s.mul(11.0).add(4.0));
          const h5 = hash(s.mul(13.0).add(5.0));
          const h6 = hash(s.mul(17.0).add(6.0));
          const speed = mix(c.x, c.y, h3.mul(h3));
          const life = mix(c.z, c.w, h4);
          const fly = h1.lessThan(d.x);
          const rd = vec3(h2.mul(2.0).sub(1.0), h5.mul(2.0).sub(1.0), h6.mul(2.0).sub(1.0));
          const dirF = normalize(b.xyz.add(rd.mul(d.w)).add(vec3(0.0, 0.0, 0.25)));
          // Ślizg: styczna w płaszczyźnie — wachlarz w głąb czaszy i wzdłuż krawędzi.
          const ang = h2.mul(TWO_PI);
          const inward = normalize(a.xy.negate().add(vec2(0.0001, 0.0)));
          const dirS = normalize(vec2(cos(ang), sin(ang)).add(inward.mul(0.55)));
          p.assign(vec4(a.xyz, 0.0));
          v.assign(vec4(select(fly, dirF.mul(speed.mul(1.25)), vec3(dirS.mul(speed.mul(0.35)), 0.0)), select(fly, life.mul(0.7).negate(), life)));
          inf.assign(vec4(d.y, d.z.mul(h5.mul(0.6).add(0.7)), U.time, e.x));
        });
      });
      const slot = int(inf.w).toVar();
      const lifeAbs = abs(v.w).toVar();
      If(p.w.lessThan(lifeAbs), () => {
        If(v.w.greaterThan(0.0), () => {
          // Ślizg po czaszy slotu.
          const xy = p.xy.add(v.xy.mul(U.dt)).toVar();
          const r = length(xy).toVar();
          const R = profileR(slot, atan(xy.y.negate(), xy.x)).toVar();
          const t = r.div(max(R, 1.0)).toVar();
          const domeH = prm(slot, SLOT.GEOM).z;
          If(t.greaterThanEqual(0.995), () => {
            // Krawędź: iskra odrywa się i leci dalej na zewnątrz.
            const out = xy.div(max(r, 0.001));
            v.assign(vec4(v.x.add(out.x.mul(160.0)), v.y.add(out.y.mul(160.0)), 90.0, lifeAbs.negate()));
            p.assign(vec4(xy, 1.0, p.w.add(U.dt)));
          }).Else(() => {
            const q = max(float(1.0).sub(t.mul(t)), 0.02).toVar();
            const z = domeH.mul(pow(q, 0.62));
            // dz/dr ≈ −1,24·h·t·(1 − t²)^−0,38 / R — zbocze ciągnie iskrę ku krawędzi.
            const dzdr = domeH.mul(-1.24).mul(t).mul(pow(q, -0.38)).div(max(R, 1.0));
            const g = xy.div(max(r, 0.001)).mul(dzdr);
            const acc = g.mul(-1400.0).div(dot(g, g).add(1.0));
            const nv = v.xy.add(acc.mul(U.dt)).mul(exp(U.dt.mul(-2.0)));
            v.assign(vec4(nv, 0.0, v.w));
            p.assign(vec4(xy, z.add(1.5), p.w.add(U.dt)));
          });
        }).Else(() => {
          // Lot w przestrzeni: opór, bez grawitacji.
          const nv = v.xyz.mul(exp(U.dt.mul(-2.4)));
          p.assign(vec4(p.xyz.add(nv.mul(U.dt)), p.w.add(U.dt)));
          v.assign(vec4(nv, v.w));
        });
      });
      pos.element(idx).assign(p);
      vel.element(idx).assign(v);
      info.element(idx).assign(inf);
    })().compute(N);
    this._kernels.push(this.kSparks);

    // Rysunek: smugi wzdłuż prędkości (addytywnie, HDR, barwa tarczy → biel w rdzeniu).
    const a = pos.toAttribute();
    const b = vel.toAttribute();
    const c = info.toAttribute();
    const slotS = int(c.w);
    const pose = prm(slotS, SLOT.POSE);
    const geom = prm(slotS, SLOT.GEOM);
    const misc = prm(slotS, SLOT.MISC);
    const look = prm(slotS, SLOT.LOOK);
    const lifeT = abs(b.w);
    const life = saturate(a.w.div(max(lifeT, 0.001)));
    const alive = step(a.w, lifeT).mul(step(0.5, geom.w)).mul(step(misc.x, c.z)).mul(step(0.0001, lifeT));
    const speed = length(b.xyz);
    const mat = this.sparkMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.name = 'ShieldSparks';
    mat.positionNode = vec3(pose.x.add(pose.z.mul(a.x)).sub(pose.w.mul(a.y)), pose.y.add(pose.w.mul(a.x)).add(pose.z.mul(a.y)), a.z.add(SHIELD_Z));
    mat.rotationNode = atan(b.y, b.x).add(atan(pose.w, pose.z));
    const lenW = max(speed.mul(0.024), 5.0);
    const width = max(c.y.mul(mix(float(1.0), float(0.45), life)), U.sparkMinW);
    mat.scaleNode = vec2(lenW.add(U.sparkMinW.mul(2.0)), width).mul(alive);
    const fade = life.oneMinus();
    const lColor = mix(vec3(1.0, 0.08, 0.04), look.xyz, look.w);
    const q = uv().sub(0.5).mul(2.0);
    const core = exp(q.y.mul(q.y).mul(-26.0));
    const heatCol = mix(vec3(3.9, 4.1, 4.4), lColor.mul(2.3), smoothstep(0.0, 0.55, life));
    const col = mix(heatCol, vec3(4.4), core.mul(0.5)).mul(fade.mul(fade)).mul(c.x);
    const maskS = exp(q.x.mul(q.x).mul(-2.2).add(q.y.mul(q.y).mul(-7.0)));
    mat.colorNode = col.mul(maskS).mul(U.sparkGain);
    const sprite = this.sparkSprite = new THREE.Sprite(mat);
    sprite.name = 'ShieldSparks';
    sprite.count = N;
    sprite.frustumCulled = false;
    sprite.renderOrder = 12;
    sprite.visible = false;

    // CPU: kursor puli i zgłoszenia tej klatki.
    this._spCursor = 0;
    this._spCount = 0;
  }

  /** Zgłoszenie iskier (klatka lokalna slotu). Zwraca liczbę iskier. */
  spawnSparks(slot, x, y, z, nx, ny, nz, count, vmin, vmax, lmin, lmax, flyFrac, heat, width, spread) {
    if (this._spCount >= SHIELD_MAX_SPARK_SPAWNS) return 0;
    const n = Math.min(Math.floor(count), SHIELD_SPARK_CAP >> 3);
    if (n <= 0) return 0;
    const i = this._spCount++;
    this.spA[i].set(x, y, z, n);
    this.spB[i].set(nx, ny, nz, this._spCursor);
    this.spC[i].set(vmin, vmax, lmin, lmax);
    this.spD[i].set(flyFrac, heat, width, spread);
    this.spE[i].set(slot, 0, 0, 0);
    this._spCursor = (this._spCursor + n) % SHIELD_SPARK_CAP;
    return n;
  }

  /** Bufor slotu: vec4 nr `i` (SLOT.*) slotu `s` (CPU — wartości wysyła blok uniformów). */
  slotVec(s, i) { return this.slotData[s * SLOT_VEC4 + i]; }

  /** Wgranie siatki obrysu i binów profilu do slotu (wycinki buforów, reszta slotu = brak płytek). */
  uploadSlot(s, lattice, profile) {
    const CAP = SHIELD_SLOT_CAP;
    const n = Math.min(lattice.n, CAP);
    const o = s * CAP;
    const rest = this.restB.value, nrm = this.nrmB.value, nbr = this.nbrB.value;
    rest.array.fill(0, o * 4, (o + CAP) * 4);
    rest.array.set(lattice.rest.subarray(0, n * 4), o * 4);
    nrm.array.fill(0, o * 4, (o + CAP) * 4);
    nrm.array.set(lattice.nrm.subarray(0, n * 4), o * 4);
    for (let k = n; k < CAP; k++) { rest.array[(o + k) * 4 + 3] = -1; nrm.array[(o + k) * 4 + 3] = 2; }
    const nb = nbr.array;
    for (let k = 0; k < CAP * 6; k++) {
      const v = k < n * 6 ? lattice.nbr[k] : -1;
      nb[o * 6 + k] = v >= 0 && v < n ? v + o : -1;
    }
    rest.addUpdateRange(o * 4, CAP * 4); rest.needsUpdate = true;
    nrm.addUpdateRange(o * 4, CAP * 4); nrm.needsUpdate = true;
    nbr.addUpdateRange(o * 6, CAP * 6); nbr.needsUpdate = true;
    const bins = this.binsB.value;
    const src = profile.bins, sn = profile.binCount || src.length;
    for (let i = 0; i < SHIELD_BINS; i++) {
      // Inna liczba binów niż 96: próbka liniowa po kącie.
      const f = (i / SHIELD_BINS) * sn;
      const i0 = Math.floor(f) % sn, i1 = (i0 + 1) % sn, u = f - Math.floor(f);
      bins.array[s * SHIELD_BINS + i] = src[i0] * (1 - u) + src[i1] * u;
    }
    bins.addUpdateRange(s * SHIELD_BINS, SHIELD_BINS); bins.needsUpdate = true;
    return n;
  }

  /** Lista przebiegów klatki dla parzystej liczby podkroków. */
  group(substeps) { return this._groups[Math.max(0, Math.min(SHIELD_MAX_SUBSTEPS, substeps & ~1))]; }

  /** Zgłoszenia iskier tej klatki → uniformy (przed dispatchem); zwraca, czy były. */
  commitSparkSpawns(seed) {
    this.U.spCount.value = this._spCount;
    this.U.spSeed.value = seed;
    const any = this._spCount > 0;
    this._spCount = 0;
    return any;
  }

  get kernels() { return this._kernels; }
  get gpuOnlyBuffers() { return this._gpuOnly; }
}

// Heksagon ostrym wierzchołkiem w górę (komórka Woronoja siatki trójkątnej), promień opisany 1;
// aRim: 0 w środku, 1 na brzegu (liniowo = metryka heksa). Normalne krawędzi co 60° od 0°.
function hexGeometry() {
  const pos = [0, 0, 0];
  const rim = [0];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    pos.push(Math.cos(a), Math.sin(a), 0);
    rim.push(1);
  }
  const idx = [];
  for (let i = 0; i < 6; i++) idx.push(0, 1 + i, 1 + ((i + 1) % 6));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRim', new THREE.Float32BufferAttribute(rim, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

// Kwadrat 2 × 2 (plama poświaty na pancerzu).
function quadGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

/** Promień opisany heksa dla odstępu siatki (komórka Woronoja siatki trójkątnej). */
export function shieldTileCircumradius(cell) { return cell / SQ3; }
