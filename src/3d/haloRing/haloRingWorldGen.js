// Mapy habitatu pieczone na GPU (render-to-texture), raz na przebudowę.
//
// Mapa to „projekt” świata: gdzie morza, góry, rzeki, lasy, miasta. Detal
// poniżej teksela dokłada shader powierzchni z kafelkowych tekstur szumu,
// więc mapa nie musi mieć rozdzielczości metra. Współrzędne mapy:
//   u = θ / 2π (wzdłuż ringu, zawija się), v = t / Wf (w poprzek podłogi).
// Szum jest liczony na walcu (x, y) = R·(cos θ, sin θ), więc mapa jest
// bezszwowa na u = 0/1 bez żadnych sztuczek.
//
//   mapA RGBA16F: wysokość [j.], odległość od rzeki [j.], wilgotność, temperatura
//   mapB RGBA8:   park (megabudowle, kopuły), wagi typów: miasto-ogród, przemysł, szkło
//   mapC RGBA8:   las, zabudowa, odsłonięta konstrukcja, skała
//
// Pierwsza klatka dostaje mapę niskiej rozdzielczości w jednym przebiegu,
// pełna rozdzielczość dopieka się plastrami w tle (brief §12).
//
// Port WebGPU (zadanie 06): pieczenie w TSL (NodeMaterial), cele RenderTarget,
// odczyt CPU asynchroniczny (readRenderTargetPixelsAsync). Kolejność:
//   const maps = new HaloWorldMaps(renderer, layout, quality);   // bez GPU
//   await maps.init();       // kompilacja pipeline'ów na PRAWDZIWYCH celach, bake niskiej, odczyt CPU
//   await maps.setCivic(…)   // place i kopuły → ponowny bake niskiej i odczyt CPU
//   maps.step()              // co klatkę: plaster pełnej rozdzielczości
// Oś Y: bake pisze v = t/Wf = 0 w GÓRNYM wierszu celu (konwencja WebGPU i uv
// QuadMesh: v = 0 = wiersz 0 tekstury), więc texture(mapa, (u, v)) w materiałach
// ringu i odczyt CPU (wiersz 0 = góra celu = v ≈ 0) zgadzają się bez odwracania —
// cpu.heights ma ten sam układ co w WebGL (wiersz y ↔ v = (y + 0,5)/h).
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, Loop, Break, float, int, vec2, vec3, vec4, uv, positionGeometry,
  abs, floor, fract, sqrt, exp, pow, sin, cos, min, max, clamp, mix, step, smoothstep, dot, length, mod
} from 'three/tsl';
import { HALO_TAU, haloGnoise3, haloHash12, haloHash22, haloPortSitesTSL, haloPureFn } from './haloRingTSL.js';
import { createUniformBlock, nodeOf } from './haloUniformsAdapter.js';
import { HALO_SECTOR_TYPES, HALO_TERRAIN } from './haloRingConfig.js';
import { haloPortTileUniforms } from './haloRingUniforms.js';
import { haloSectorFeatures, resolveHaloProfile } from './haloRingProfiles.js';
import { HALO_LANDMARK } from './haloRingLandmarks.js';
import { HALO_DOME } from './haloRingDomes.js';

const MAX_SECTORS = 32;
const RIVERS = 3;
const MAX_LANDMARKS = HALO_LANDMARK.maxCount;
const MAX_DOMES = HALO_DOME.maxCount;

// Mapa CPU (odczyt): 2048 × max(32, round(96 · W/6000)) — niezależna od jakości.
export function haloCpuMapSize(layout) {
  return { w: 2048, h: Math.max(32, Math.round(96 * layout.width / 6000)) };
}

// Surowy odczyt readRenderTargetPixelsAsync → wysokości (kanał 0) w układzie
// wierszy WebGL (wiersz y ↔ v = (y + 0,5)/h). WebGPU: wiersze wyrównane do 256 B
// (wynik nieprzycięty, ostatni wiersz bez dopełnienia), wiersz 0 = góra celu.
// flipY = true, gdy cel był rysowany z v = 0 na DOLE (orientacja GL).
export function haloUnpackReadback(raw, w, h, { channels = 4, channel = 0, flipY = false } = {}) {
  const bpe = raw.BYTES_PER_ELEMENT;
  const rowElems = Math.ceil((w * channels * bpe) / 256) * 256 / bpe;
  const need = (h - 1) * rowElems + w * channels;
  if (raw.length < need) throw new Error(`haloUnpackReadback: ${raw.length} < ${need} (w ${w}, h ${h})`);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = (flipY ? h - 1 - y : y) * rowElems + channel;
    const dst = y * w;
    for (let x = 0; x < w; x++) out[dst + x] = raw[src + x * channels];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Funkcje świata — czyste funkcje WGSL (bez uniformów) i wklejany haloWorldAt.
const haloCylP = haloPureFn('haloCylP', 'vec3', [['s', 'float'], ['t', 'float'], ['scale', 'float'], ['geo', 'vec4'], ['noiseOff', 'vec4']], (a) => {
  const th = a.s.div(a.geo.x).mul(HALO_TAU);
  const Rn = a.geo.x.div(HALO_TAU);
  return vec3(cos(th).mul(Rn), sin(th).mul(Rn), a.t).div(a.scale).add(a.noiseOff.xyz);
});
const haloFbm3 = haloPureFn('haloFbm3', 'float', [['p0', 'vec3'], ['oct', 'int']], (a) => {
  const p = vec3(a.p0).toVar();
  const amp = float(0.5).toVar();
  const sum = float(0.0).toVar();
  Loop(8, ({ i }) => {
    If(i.greaterThanEqual(a.oct), () => { Break(); });
    sum.addAssign(amp.mul(haloGnoise3(p)));
    p.assign(p.mul(2.03).add(vec3(17.1, 9.3, 5.7)));
    amp.mulAssign(0.5);
  });
  return sum;
});
const haloRidged3 = haloPureFn('haloRidged3', 'float', [['p0', 'vec3'], ['oct', 'int']], (a) => {
  const p = vec3(a.p0).toVar();
  const amp = float(0.5).toVar();
  const sum = float(0.0).toVar();
  const wgt = float(1.0).toVar();
  Loop(8, ({ i }) => {
    If(i.greaterThanEqual(a.oct), () => { Break(); });
    const n = float(1.0).sub(abs(haloGnoise3(p))).toVar();
    n.assign(n.mul(n));
    sum.addAssign(amp.mul(n).mul(wgt));
    wgt.assign(clamp(n.mul(1.7), 0.0, 1.0));
    p.assign(p.mul(2.07).add(vec3(3.3, 11.9, 7.1)));
    amp.mulAssign(0.5);
  });
  return sum;
});
const haloTypeOneHot = haloPureFn('haloTypeOneHot', 'vec4', [['k', 'float']], (a) =>
  vec4(step(abs(a.k.sub(0.0)), 0.1), step(abs(a.k.sub(1.0)), 0.1), step(abs(a.k.sub(2.0)), 0.1), step(abs(a.k.sub(3.0)), 0.1)));
// Kratery (profil: Mars, Io): misy z wałem, siatka komórek w (s, t) okresowa
// wzdłuż ringu (komórka dzieli obwód bez reszty; indeks zawijany z zapasem 0,5).
const haloCraters = haloPureFn('haloCraters', 'float', [['s', 'float'], ['t', 'float'], ['L', 'float'], ['cell', 'float'], ['salt', 'float']], (a) => {
  const nS = max(1.0, floor(a.L.div(a.cell).add(0.5))).toVar();
  const cs = a.L.div(nS).toVar();
  const p = vec2(a.s.div(cs), a.t.div(a.cell)).toVar();
  const i0 = floor(p).toVar();
  const f = p.sub(i0).toVar();
  const h = float(0.0).toVar();
  Loop({ start: -1, end: 1, condition: '<=', name: 'cy', type: 'int' }, ({ cy }) => {
    Loop({ start: -1, end: 1, condition: '<=', name: 'cx', type: 'int' }, ({ cx }) => {
      const o = vec2(float(cx), float(cy)).toVar();
      const c = i0.add(o).toVar();
      c.x.assign(c.x.sub(nS.mul(floor(c.x.add(0.5).div(nS)))));
      const pres = step(0.45, haloHash12(c.add(a.salt).add(4.1)));
      const j = haloHash22(c.add(a.salt));
      const R = mix(0.14, 0.4, haloHash12(c.add(a.salt).add(9.7))).mul(a.cell).toVar();
      const d = o.add(0.2).add(j.mul(0.6)).sub(f).mul(vec2(cs, a.cell));
      const q = length(d).div(R).toVar();
      const bowl = q.lessThan(1.0).select(q.mul(q).sub(1.0), 0.0);
      const rim = exp(q.sub(1.0).negate().mul(q.sub(1.0)).div(0.05));
      h.addAssign(pres.mul(bowl.mul(0.24).add(rim.mul(0.07))).mul(R));
    });
  });
  return h;
});
// granica parku: prostokąt o zaokrąglonych narożnikach (odległość ze znakiem)
const haloParkSd = haloPureFn('haloParkSd', 'float', [['d', 'vec2'], ['halfP', 'vec2']], (a) => {
  const R = min(320.0, float(0.45).mul(min(a.halfP.x, a.halfP.y))).toVar();
  const q = abs(a.d).sub(a.halfP.sub(R)).toVar();
  return length(max(q, 0.0)).add(min(max(q.x, q.y), 0.0)).sub(R);
});

// Obiekty obywatelskie (haloRingLandmarks.js, haloRingDomes.js): plac lub
// podłoga kopuły (wypłaszczenie z rampą), rdzeń i obrzeże płyty placu, pas bez
// drzew, park, staw, wnętrze kopuły. Wklejane (tablice uniformów bake'u).
function haloCivicAt(U, s, t, L, warp) {
  const c = {
    flatW: float(0.0).toVar(), flatH: float(0.0).toVar(), core: float(0.0).toVar(), rim: float(0.0).toVar(),
    clear: float(0.0).toVar(), park: float(0.0).toVar(), pond: float(0.0).toVar(), dome: float(0.0).toVar(),
    domeQ: float(10.0).toVar(), domeType: float(0.0).toVar(), domeSeed: float(0.0).toVar(), apron: float(0.0).toVar()
  };
  Loop(MAX_LANDMARKS, ({ i }) => {
    If(float(i).greaterThanEqual(U.uLandmarkCount), () => { Break(); });
    const A = U.uLandmarkA.element(i).toVar();
    const B = U.uLandmarkB.element(i).toVar();
    const C = U.uLandmarkC.element(i).toVar();
    const D = U.uLandmarkD.element(i).toVar();
    const ds = s.sub(A.x).toVar();
    ds.subAssign(L.mul(floor(ds.div(L).add(0.5))));
    const dt = t.sub(A.z).toVar();
    const d = max(abs(ds).sub(A.y), abs(dt).sub(A.w)).toVar();
    const w = float(1.0).sub(smoothstep(B.y, B.y.add(B.z), d)).toVar();
    If(w.greaterThan(c.flatW), () => { c.flatW.assign(w); c.flatH.assign(B.x); });
    c.core.assign(max(c.core, float(1.0).sub(smoothstep(-70.0, -40.0, d))));
    c.rim.assign(max(c.rim, float(1.0).sub(smoothstep(0.0, 80.0, d))));
    c.clear.assign(max(c.clear, float(1.0).sub(smoothstep(B.y.sub(20.0), B.y.add(10.0), d))));
    // budowla przemysłowa (Jowisz): wokół płyty fartuch z gołego metalu, bez trawnika
    c.apron.assign(max(c.apron, B.w.mul(float(1.0).sub(smoothstep(B.y, B.y.add(B.z), d)))));
    const dp = haloParkSd(vec2(ds, dt), C.xy).add(warp);
    c.park.assign(max(c.park, float(1.0).sub(smoothstep(-80.0, 20.0, dp))));
    If(D.z.greaterThan(0.5), () => {
      const e = length(vec2(ds.sub(D.x).div(D.z), dt.sub(D.y).div(D.w))).add(warp.mul(0.0015));
      c.pond.assign(max(c.pond, float(1.0).sub(smoothstep(0.86, 1.0, e))));
    });
  });
  Loop(MAX_DOMES, ({ i }) => {
    If(float(i).greaterThanEqual(U.uDomeCount), () => { Break(); });
    const A = U.uDomeA.element(i).toVar();
    const B = U.uDomeB.element(i).toVar();
    const C = U.uDomeC.element(i).toVar();
    const ds = s.sub(A.x).toVar();
    ds.subAssign(L.mul(floor(ds.div(L).add(0.5))));
    const dt = t.sub(A.y).toVar();
    const dist = length(vec2(ds, dt)).toVar();
    const w = float(1.0).sub(smoothstep(B.z, B.z.add(B.w), dist)).toVar();
    If(w.greaterThan(c.flatW), () => { c.flatW.assign(w); c.flatH.assign(A.w); });
    const inside = float(1.0).sub(smoothstep(A.z.sub(6.0), A.z.add(2.0), dist)).toVar();
    If(dist.lessThan(A.z.mul(1.5)).and(dist.div(A.z).lessThan(c.domeQ)), () => {
      c.domeQ.assign(dist.div(A.z));
      c.domeType.assign(B.x);
      c.domeSeed.assign(B.y);
    });
    c.dome.assign(max(c.dome, inside));
    c.clear.assign(max(c.clear, smoothstep(A.z.mul(0.86), A.z.mul(0.92), dist).mul(float(1.0).sub(smoothstep(B.z.sub(10.0), B.z.add(20.0), dist)))));
    const dp = haloParkSd(vec2(ds, dt), C.xy).add(warp);
    c.park.assign(max(c.park, float(1.0).sub(smoothstep(-80.0, 20.0, dp)).mul(float(1.0).sub(inside))));
  });
  return c;
}

// Świat w punkcie (s, t) — wklejany do materiału bake'u. U = węzły uniformów bake'u.
export function haloWorldAt(U, s, t) {
  const P = haloPortSitesTSL(U);
  const cylP = (ss, tt, scale) => haloCylP(ss, tt, float(scale), U.uGeo, U.uNoiseOff);
  const fbm3 = (p, oct) => haloFbm3(p, int(oct));
  const ridged3 = (p, oct) => haloRidged3(p, int(oct));
  const L = U.uGeo.x;
  const Wf = U.uGeo.y;
  const wallH = U.uGeo.z;
  const v = clamp(t.div(Wf), 0.0, 1.0).toVar();
  const theta = s.div(L).mul(HALO_TAU).toVar();

  // --- sektory: przejścia na ~1/3 sektora, granica falowana szumem
  const x = mod(theta.sub(U.uSectorStart), HALO_TAU).div(U.uSectorSpan).toVar();
  x.addAssign(haloGnoise3(cylP(s, t, 4200.0).add(31.0)).mul(0.1));
  const k = floor(x).toVar();
  const f = x.sub(k).toVar();
  const b = 1.0 / 6.0;
  const wk = float(1.0).toVar();
  const wo = float(0.0).toVar();
  const ko = k.toVar();
  If(f.lessThan(b), () => {
    const aa = smoothstep(0.0, 1.0, f.add(b).div(2.0 * b));
    wk.assign(aa);
    wo.assign(float(1.0).sub(aa));
    ko.assign(k.sub(1.0));
  }).ElseIf(f.greaterThan(1.0 - b), () => {
    const aa = smoothstep(0.0, 1.0, f.sub(1.0 - b).div(2.0 * b));
    wk.assign(float(1.0).sub(aa));
    wo.assign(aa);
    ko.assign(k.add(1.0));
  });
  const ik = int(mod(k, U.uSectorCount)).toVar();
  const io = int(mod(ko, U.uSectorCount)).toVar();
  const typeW = haloTypeOneHot(U.uSectorType.element(ik)).mul(wk).add(haloTypeOneHot(U.uSectorType.element(io)).mul(wo)).toVar();
  const cl = U.uSectorClimate.element(ik).mul(wk).add(U.uSectorClimate.element(io).mul(wo)).toVar();
  const feat = U.uSectorFeat.element(ik).mul(wk).add(U.uSectorFeat.element(io).mul(wo)).toVar();
  // --- strefy wokół doków: płyta doku → pas fabryczny → osady → sektor
  const zWarp = fbm3(cylP(s, t, 1700.0).add(13.0), 3).mul(520.0).toVar();
  const pz = P.haloPortZones(s, t, L, zWarp).toVar();
  const zInd = pz.x.toVar();
  // nad dokiem (strona kamery gry) teren niski: bez gór, pas fabryczny i osady
  const zShield = pz.w.toVar();
  const zNear = max(zInd, zShield).toVar();
  typeW.assign(typeW.mul(float(1.0).sub(zInd)).add(vec4(0.0, 0.0, zInd, 0.0)));
  // obiekty obywatelskie: plac / podłoga kopuły, park, staw, wnętrze kopuły
  const cv = haloCivicAt(U, s, t, L, zWarp.mul(0.15));
  const civFlat = max(cv.flatW, cv.dome).toVar();

  // --- kontynenty i morza (zawinięta domena, okresowa na walcu)
  const q = cylP(s, t, 14000.0).toVar();
  const warp = vec3(fbm3(q.add(3.1), 3), fbm3(q.add(7.7), 3), fbm3(q.add(11.3), 3)).toVar();
  const cont = fbm3(cylP(s, t, 7200.0).add(warp.mul(0.9)), 6).toVar();
  const thr = cl.x.sub(0.5).mul(0.72);
  const wallZone = float(1.0).sub(smoothstep(0.0, 0.27, min(v, float(1.0).sub(v)))).toVar();
  const mountAmt = cl.y.toVar();
  const e = cont.sub(thr).add(wallZone.mul(mountAmt).mul(0.32)).toVar();
  e.assign(mix(e, max(e, 0.22), zNear));  // pod pasem fabrycznym i nad dokiem ląd, nie morze
  e.assign(mix(e, max(e, 0.3), civFlat));
  const coast = smoothstep(-0.015, 0.015, e).toVar();
  const seaH = float(-8.0).sub(U.uSeaDepth.mul(smoothstep(0.0, 0.3, e.negate()))).toVar();

  // --- góry: pasma przy ścianach + grzbiety wewnątrz, do ~60% wysokości ścian
  const hMax = wallH.mul(0.6).toVar();
  const rid = ridged3(cylP(s, t, 3600.0).add(warp.mul(0.45)), 6).toVar();
  const ranges = smoothstep(0.42, 0.8, fbm3(cylP(s, t, 11000.0).add(5.0), 3).add(0.5));
  const mMask = clamp(wallZone.mul(0.95).add(ranges.mul(0.5)), 0.0, 1.0).mul(mountAmt);
  const mountains = pow(max(rid, 0.0), 1.7).mul(mMask).mul(hMax).mul(1.35).mul(float(1.0).sub(zShield)).toVar();
  // osady przy porcie tylko tam, gdzie teren sektora nie ma gór
  const zRes = pz.y.mul(float(1.0).sub(zInd)).mul(float(1.0).sub(smoothstep(0.1, 0.28, mountains.div(max(hMax, 1.0))))).toVar();
  typeW.assign(typeW.mul(float(1.0).sub(zRes)).add(vec4(0.0, zRes, 0.0, 0.0)));
  const hills = fbm3(cylP(s, t, 1500.0).add(2.0), 4).mul(0.5).add(0.5).mul(float(14.0).add(float(55.0).mul(mountAmt))).toVar();
  const landBase = float(3.0).add(float(60.0).mul(smoothstep(0.0, 0.5, e))).toVar();
  const landH = landBase.add(hills.mul(smoothstep(0.0, 0.12, e))).add(mountains.mul(smoothstep(-0.05, 0.25, e.add(wallZone.mul(0.3))))).toVar();

  // pustynia: wydmy wzdłuż wstęgi + mesy tarasowe
  const desert = smoothstep(0.3, 0.12, cl.w).mul(smoothstep(0.6, 0.85, cl.z)).toVar();
  const dp = cylP(s, t, 520.0).toVar();
  dp.z.assign(t.div(150.0).add(U.uNoiseOff.w));
  // GLSL: pow(1 − |n|, 3.0). Szum bywa |n| > 1 → ujemna podstawa: WGSL pow = NaN
  // (NaN · 0 w mix() psuł wysokość nawet bez pustyni), a FXC (baza WebGL) liczył
  // potęgę całkowitą mnożeniem — tu też mnożenie, wynik jak w bazie.
  const duneB = float(1.0).sub(abs(haloGnoise3(dp.add(warp)))).toVar();
  const dunes = duneB.mul(duneB).mul(duneB).mul(24.0).toVar();
  const mesaN = fbm3(cylP(s, t, 2600.0).add(21.0), 4).toVar();
  const mesa = smoothstep(0.08, 0.13, mesaN).mul(130.0).add(smoothstep(0.25, 0.29, mesaN).mul(85.0)).toVar();
  dunes.mulAssign(float(1.0).add(feat.z));
  mesa.mulAssign(float(1.0).add(float(0.5).mul(feat.w)));
  const dShape = max(desert, max(feat.z, feat.w).mul(0.85));
  landH.assign(mix(landH, landBase.mul(0.5).add(dunes).add(mesa).add(mountains.mul(0.55)), dShape));
  // lodowiec: doliny wypełnione lodem (spłaszczone)
  const glacial = smoothstep(0.25, 0.08, cl.z);
  landH.assign(mix(landH, max(landH, float(26.0).add(hills.mul(0.4))), glacial.mul(0.55)));
  // płaskowyż (profil: Mars): ląd z dala od wybrzeży wyżej, poza strefami portu
  landH.addAssign(U.uProfBake.x.mul(smoothstep(0.0, 0.25, e)).mul(float(1.0).sub(zNear)));
  // kaniony (profil: Mars): szerokie meandry wzdłuż ringu, ściany tarasami
  const cutK = feat.x.mul(float(1.0).sub(zNear)).mul(float(1.0).sub(civFlat)).toVar();
  const streamW = float(0.0).toVar();
  If(cutK.greaterThan(0.001), () => {
    const uuC = s.div(L).toVar();
    Loop(2, ({ i }) => {
      const ca = U.uCanyonA.element(i).toVar();
      If(ca.w.greaterThan(0.5), () => {
        const m1 = U.uCanyonM1.element(i).toVar();
        const m2 = U.uCanyonM2.element(i).toVar();
        const vc = ca.x.add(m1.y.mul(sin(float(HALO_TAU).mul(uuC).mul(m1.x).add(m1.z))))
          .add(m2.y.mul(sin(float(HALO_TAU).mul(uuC).mul(m2.x).add(m2.z)))).toVar();
        const dC = abs(v.sub(vc)).mul(Wf).toVar();
        const hw = ca.y.mul(float(0.8).add(float(0.4).mul(haloGnoise3(cylP(s, float(0.0), 6000.0).add(float(i).mul(5.1))).mul(0.5).add(0.5)))).toVar();
        const xw = clamp(dC.sub(hw.mul(0.28)).div(hw.mul(0.72)), 0.0, 1.0).toVar();
        const xs = floor(xw.mul(4.0)).add(smoothstep(0.55, 1.0, fract(xw.mul(4.0)))).mul(0.25);
        const floorC = max(landH.sub(ca.z), float(5.0).add(float(4.0).mul(haloGnoise3(cylP(s, t, 300.0).add(9.0)).mul(0.5).add(0.5))));
        landH.assign(mix(landH, min(landH, mix(floorC, landH, xs)), cutK));
        streamW.assign(max(streamW, float(1.0).sub(smoothstep(10.0, 22.0, dC)).mul(cutK)));
      });
    });
  });
  // kratery (profil: Mars, Io — kaldery): dwie skale, poza portem i placami
  const cratK = feat.y.mul(float(1.0).sub(zNear)).mul(float(1.0).sub(civFlat)).toVar();
  If(cratK.greaterThan(0.001), () => {
    landH.addAssign(haloCraters(s, t, L, 2400.0, 13.0).add(float(0.8).mul(haloCraters(s, t, L, 800.0, 29.0))).mul(cratK));
  });
  const hLand = mix(seaH, landH, coast).toVar();

  // miasto-ogród: tarasy schodzące do jezior
  const terr = landBase.add(hills.mul(0.55)).add(mountains.mul(0.3)).toVar();
  const stepH = 12.0;
  const tq = terr.div(stepH).toVar();
  const terraced = floor(tq).add(smoothstep(0.74, 1.0, fract(tq))).mul(stepH);
  const hGarden = mix(seaH.mul(0.35), terraced, coast).toVar();
  // przemysł: płaskie platformy na trzech poziomach + kanały
  const pad = floor(fbm3(cylP(s, t, 2200.0).add(41.0), 2).mul(0.5).add(0.5).mul(3.0)).mul(7.0).add(5.0);
  const canal = max(float(1.0).sub(smoothstep(22.0, 32.0, abs(t.sub(Wf.mul(0.3))))), float(1.0).sub(smoothstep(22.0, 32.0, abs(t.sub(Wf.mul(0.71))))));
  const hInd = mix(pad, -7.0, canal).toVar();
  hInd.assign(mix(seaH.mul(0.3), hInd, smoothstep(-0.22, -0.12, e)));
  // szkło: płaskie parki i jeziora
  const hGlass = mix(seaH.mul(0.4), float(5.0).add(hills.mul(0.25)), coast).toVar();

  const h = typeW.x.mul(hLand).add(typeW.y.mul(hGarden)).add(typeW.z.mul(hInd)).add(typeW.w.mul(hGlass)).toVar();
  // doki wpięte w podłogę (K-7 + zatoki) i portale tranzytów: płaska płyta bez zabudowy
  const dockPad = P.haloPortPad(s, t, L, 0.0, 300.0).toVar();
  h.assign(mix(h, 7.0, dockPad));
  // wnętrze kopuły wg typu: woda, las, park, wzgórza i klimat
  const dWater = float(0.0).toVar();
  const dForest = float(0.0).toVar();
  const dPark = float(0.0).toVar();
  const dHill = float(0.0).toVar();
  const dUrban = float(0.0).toVar();
  const dClim = vec2(0.6, 0.7).toVar();
  If(cv.dome.greaterThan(0.001), () => {
    const dn = fbm3(cylP(s, t, 160.0).add(cv.domeSeed.mul(37.0)), 3).mul(0.5).add(0.5).toVar();
    const dn2 = fbm3(cylP(s, t, 70.0).add(cv.domeSeed.mul(53.0)).add(11.0), 2).mul(0.5).add(0.5).toVar();
    const dq = cv.domeQ;
    If(cv.domeType.lessThan(0.5), () => {
      // las: staw na środku, gęsty las
      dWater.assign(float(1.0).sub(smoothstep(0.2, 0.26, dq.add(dn.sub(0.5).mul(0.12)))));
      dForest.assign(0.95); dPark.assign(0.25); dHill.assign(float(6.0).mul(dn2)); dClim.assign(vec2(0.5, 0.82));
    }).ElseIf(cv.domeType.lessThan(1.5), () => {
      // tropiki: sadzawka, rozlewiska, wzgórza, palmy
      dWater.assign(max(float(1.0).sub(smoothstep(0.13, 0.18, dq)), smoothstep(0.6, 0.66, dn)));
      dForest.assign(1.0); dPark.assign(0.2); dClim.assign(vec2(0.9, 0.95));
      dHill.assign(float(26.0).mul(smoothstep(0.35, 0.75, dn2)).mul(float(1.0).sub(smoothstep(0.52, 0.6, dn))));
    }).ElseIf(cv.domeType.lessThan(2.5), () => {
      // ogród botaniczny: fontanna na środku, ścieżki, rzadkie drzewa
      dWater.assign(float(1.0).sub(smoothstep(0.08, 0.11, dq)));
      dForest.assign(float(0.3).mul(smoothstep(0.5, 0.7, dn))); dPark.assign(1.0); dClim.assign(vec2(0.62, 0.72));
    }).ElseIf(cv.domeType.lessThan(3.5), () => {
      // park rekreacyjny: jeziora, trawniki, ścieżki
      dWater.assign(smoothstep(0.6, 0.64, dn).mul(smoothstep(0.12, 0.18, dq)));
      dForest.assign(float(0.35).mul(smoothstep(0.45, 0.65, dn2))); dPark.assign(1.0); dClim.assign(vec2(0.6, 0.66));
    }).ElseIf(cv.domeType.lessThan(4.5), () => {
      // dzicz: las iglasty i łąki, wzgórza
      dWater.assign(smoothstep(0.68, 0.72, dn));
      dForest.assign(float(0.95).mul(smoothstep(0.42, 0.5, dn2))); dHill.assign(float(30.0).mul(smoothstep(0.4, 0.8, dn))); dClim.assign(vec2(0.34, 0.78));
    }).ElseIf(cv.domeType.lessThan(5.5), () => {
      // akwarium: woda z wyspami
      const isl = smoothstep(0.6, 0.64, dn).mul(smoothstep(0.18, 0.24, dq)).toVar();
      dWater.assign(float(1.0).sub(isl)); dForest.assign(float(0.6).mul(isl)); dPark.assign(float(0.6).mul(isl)); dClim.assign(vec2(0.75, 0.9));
    }).Else(() => {
      // miasto pod kopułą (Mars): zabudowa do ~0,6 promienia, dalej skwery i rzadkie drzewa
      dUrban.assign(float(0.92).mul(float(1.0).sub(smoothstep(0.56, 0.64, dq))));
      dForest.assign(float(0.3).mul(smoothstep(0.5, 0.7, dn)).mul(float(1.0).sub(dUrban)));
      dPark.assign(float(0.45).mul(float(1.0).sub(dUrban)));
      dClim.assign(vec2(0.58, 0.55));
    });
    // brzeg szkła bez wody i wzgórz (kołnierz); woda tylko przy niskiej podłodze
    dWater.mulAssign(float(1.0).sub(smoothstep(0.84, 0.92, dq)).mul(float(1.0).sub(smoothstep(12.0, 16.0, cv.flatH))));
    dHill.mulAssign(float(1.0).sub(smoothstep(0.7, 0.9, dq)));
  });
  h.assign(mix(h, cv.flatH.add(dHill.mul(cv.dome)), civFlat));
  // stawy parków i woda w kopułach (woda w terenie = poziom 0)
  const civWater = max(cv.pond, dWater.mul(cv.dome)).toVar();
  h.assign(mix(h, min(h, -5.0), civWater));

  // struga na dnie kanionu (woda w terenie = poziom 0)
  h.assign(mix(h, min(h, -4.0), streamW.mul(typeW.x).mul(float(1.0).sub(dockPad))));

  // --- rzeki: meandry okresowe (parametry z layoutu), zanikają w górach
  const uu = s.div(L).toVar();
  const rd = float(1e5).toVar();
  Loop(RIVERS, ({ i }) => {
    const ra = U.uRiverA.element(i).toVar();
    const r1 = U.uRiverM1.element(i).toVar();
    const r2 = U.uRiverM2.element(i).toVar();
    const r3 = U.uRiverM3.element(i).toVar();
    const vc = ra.x
      .add(r1.y.mul(sin(float(HALO_TAU).mul(uu).mul(r1.x).add(r1.z))))
      .add(r2.y.mul(sin(float(HALO_TAU).mul(uu).mul(r2.x).add(r2.z))))
      .add(r3.y.mul(sin(float(HALO_TAU).mul(uu).mul(r3.x).add(r3.z)))).toVar();
    const halfW = ra.y.mul(float(0.5).add(float(0.5).mul(haloGnoise3(cylP(s, float(0.0), 9000.0).add(float(i).mul(7.3))).mul(0.5).add(0.5))));
    rd.assign(min(rd, abs(v.sub(vc)).mul(Wf).sub(halfW)));
  });
  const riverW = clamp(typeW.x.add(typeW.y).add(typeW.w.mul(0.7)), 0.0, 1.0)
    .mul(float(1.0).sub(desert.mul(0.85))).mul(float(1.0).sub(dockPad)).mul(float(1.0).sub(zInd)).mul(float(1.0).sub(civFlat)).mul(U.uProfBake.y).toVar();
  const fadeHigh = float(1.0).sub(smoothstep(150.0, 320.0, h)).toVar();
  const bankT = smoothstep(0.0, 110.0, max(rd, 0.0));
  const riverH = rd.lessThan(0.0).select(
    float(-5.0).sub(float(6.0).mul(clamp(rd.negate().div(30.0), 0.0, 1.0))),
    mix(1.2, h, bankT)
  );
  h.assign(mix(h, min(h, riverH), riverW.mul(fadeHigh)));
  rd.assign(mix(600.0, rd, riverW.mul(fadeHigh)));

  // --- klimat lokalny, las, zabudowa
  const nearWater = float(1.0).sub(smoothstep(0.0, 420.0, rd)).mul(0.22).add(float(1.0).sub(coast).mul(0.12));
  const moist = clamp(cl.w.add(nearWater), 0.0, 1.0).toVar();
  const temp = clamp(cl.z.sub(max(h, 0.0).div(max(hMax, 1.0)).mul(0.5)), 0.0, 1.0).toVar();
  moist.assign(mix(moist, dClim.y, cv.dome));
  temp.assign(mix(temp, dClim.x, cv.dome));
  const fN = fbm3(cylP(s, t, 1200.0).add(57.0), 4).mul(0.5).add(0.5);
  const forest = smoothstep(0.42, 0.7, fN.mul(0.62).add(moist.mul(0.55)).sub(0.08))
    .mul(smoothstep(0.16, 0.3, temp)).mul(smoothstep(-2.0, 4.0, h)).mul(float(1.0).sub(desert))
    .mul(clamp(typeW.x.add(typeW.y.mul(0.4)).add(typeW.w.mul(0.35)), 0.0, 1.0)).toVar();
  const cityN = fbm3(cylP(s, t, 2300.0).add(71.0), 3).mul(0.5).add(0.5).toVar();
  const dry = smoothstep(-3.0, 3.0, h).mul(smoothstep(-10.0, 25.0, rd)).toVar();
  const urban = typeW.y.mul(smoothstep(0.34, 0.5, cityN))
    .add(typeW.z.mul(0.95))
    .add(typeW.w.mul(smoothstep(0.38, 0.55, cityN)).mul(0.75)).mul(dry).mul(float(1.0).sub(smoothstep(110.0, 260.0, h))).toVar();
  // pas fabryczny gęsty, osady w dolinach gęstsze niż zwykłe miasto-ogród
  urban.assign(max(urban, zInd.mul(0.95).add(zRes.mul(smoothstep(0.16, 0.3, cityN))).mul(dry).mul(float(1.0).sub(smoothstep(110.0, 260.0, h)))));
  urban.assign(clamp(urban, 0.0, 1.0).mul(float(1.0).sub(dockPad)).mul(float(1.0).sub(max(civFlat, cv.park))));
  urban.assign(max(urban, dUrban.mul(cv.dome)));
  forest.mulAssign(float(1.0).sub(urban.mul(0.9)).mul(float(1.0).sub(dockPad)).mul(float(1.0).sub(zInd)));
  // park: kępy drzew z szumu i pojedyncze drzewa na trawnikach; kopuła: las wg typu
  const clump = smoothstep(0.47, 0.62, fbm3(cylP(s, t, 230.0).add(77.0), 3).mul(0.5).add(0.5));
  forest.assign(mix(forest, max(clump.mul(0.9), 0.08), cv.park));
  forest.assign(mix(forest, dForest, cv.dome));
  forest.mulAssign(float(1.0).sub(cv.clear).mul(float(1.0).sub(civWater)));
  const exN = fbm3(cylP(s, t, 4800.0).add(91.0), 3);
  // płyta doku: goły metal z liniami (fartuch portu), bez zabudowy i lasu;
  // pod płytą placu megabudowli rdzeń (bez drzew i detalu), obrzeże spłaszczone
  const exposed = max(typeW.z.mul(smoothstep(0.22, 0.36, exN)).mul(dry).mul(float(1.0).sub(dockPad)), dockPad).toVar();
  exposed.assign(max(exposed, max(cv.core, cv.rim.mul(0.3))));
  exposed.assign(max(exposed, cv.apron));
  forest.mulAssign(float(1.0).sub(cv.apron));
  const rock = clamp(smoothstep(230.0, 540.0, h).mul(0.75).add(desert.mul(smoothstep(40.0, 110.0, h)).mul(0.8)), 0.0, 1.0);

  // bez drzew na płycie placu, trawniku, przy brzegu szkła i na pasie wokół
  // kopuły: waga ogrodu → szkło, sam koniec
  typeW.assign(mix(typeW, vec4(0.0, 0.0, 0.0, 1.0), cv.clear));

  return {
    h,
    riverDist: clamp(rd, -200.0, 600.0),
    moist,
    temp,
    typeW,
    forest,
    urban,
    exposed,
    rock,
    // park (kanał R mapy B): ścieżki i kwietniki rysuje shader terenu
    park: clamp(max(cv.park.mul(float(1.0).sub(cv.core)), dPark.mul(cv.dome)), 0.0, 1.0).mul(float(1.0).sub(civWater))
  };
}

// Kwad bake'u: v = 0 w GÓRNYM wierszu celu (jak uv QuadMesh), pozycja = NDC.
function makeBakeGeometry() {
  const g = new THREE.PlaneGeometry(2, 2);
  const uvAttr = g.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) uvAttr.setY(i, 1 - uvAttr.getY(i));
  return g;
}

// Materiał bake'u wyjścia 'A' | 'B' | 'C' (graf świata budowany przy budowie materiału).
export function makeHaloBakeMaterial(uniforms, output) {
  const U = {};
  for (const [k, entry] of Object.entries(uniforms)) U[k] = nodeOf(entry);
  const m = new NodeMaterial();
  m.name = `HaloWorldBake${output}`;
  m.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
  m.fragmentNode = Fn(() => {
    const vUv = uv();
    const uvR = mix(U.uRegion.xy, U.uRegion.zw, vUv).toVar();
    const s = uvR.x.mul(U.uGeo.x).toVar();
    const t = uvR.y.mul(U.uGeo.y).toVar();
    const W = haloWorldAt(U, s, t);
    if (output === 'A') return vec4(W.h, W.riverDist, W.moist, W.temp);
    if (output === 'B') return vec4(W.park, W.typeW.y, W.typeW.z, W.typeW.w);
    return vec4(W.forest, W.urban, W.exposed, W.rock);
  })();
  m.depthTest = false;
  m.depthWrite = false;
  m.blending = THREE.NoBlending;
  m.toneMapped = false;
  return m;
}

function makeTarget(width, height, type, mipmaps) {
  const rt = new THREE.RenderTarget(width, height, {
    type,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: mipmaps,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping
  });
  rt.texture.anisotropy = 8;
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

// Rozgrzewka pieczenia (port WebGPU, zadania 06 i 11): klucz pipeline'u zależy od formatu
// celu (rgba16float / rgba8unorm / rgba32float), więc HaloWorldMaps.init() kompiluje
// PRAWDZIWE obiekty bake'u na PRAWDZIWYCH celach (compileAsync) przed pierwszym bake'iem —
// dawna scena rozgrzewki dla tła menu (createHaloBakeWarmup) usunięta w zadaniu 11.
export class HaloWorldMaps {
  constructor(renderer, layout, quality) {
    this.renderer = renderer;
    this.layout = layout;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(makeBakeGeometry());
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.uniforms = this._makeUniforms(layout);
    this.materials = {
      A: this._makeMaterial('A'),
      B: this._makeMaterial('B'),
      C: this._makeMaterial('C')
    };
    this.low = null;
    this.full = null;
    this.pending = null;
    this.cpu = null;
    this.cpuVersion = 0;
    this.ready = false;
    this.version = 0;
    this.textureBytes = 0;
    this.disposed = false;
    this.readTarget = null;
    this.timings = { compileMs: 0, lowBakeMs: 0, readbackMs: [], civicMs: 0, fullBakeMs: 0, slicesMs: [] };
    this._initPromise = null;
  }

  // Kompilacja + mapa niska + odczyt CPU. Idempotentne (jedna obietnica).
  init() {
    if (!this._initPromise) this._initPromise = this._init();
    return this._initPromise;
  }

  async _init() {
    const r = this.renderer;
    if (typeof r.init === 'function') await r.init();
    if (this.disposed) return;
    this.low = this._allocSet(this._mapSize(0.125), true);
    const cpuSize = haloCpuMapSize(this.layout);
    this.readTarget = new THREE.RenderTarget(cpuSize.w, cpuSize.h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
    this.readTarget.texture.colorSpace = THREE.NoColorSpace;
    const t0 = performance.now();
    await this._compile();
    this.timings.compileMs = performance.now() - t0;
    if (this.disposed) return;
    const t1 = performance.now();
    this._bakeRegion(this.low, 0, 1);
    this.timings.lowBakeMs = performance.now() - t1;
    await this._readbackCpu();
    if (this.disposed) return;
    this.pending = this._allocSet(this._mapSize(1), true);
    this.pending.nextSlice = 0;
    this.pending.slices = 24;
    this._updateBytes();
    this.version++;
  }

  // Pipeline'y bake'u na PRAWDZIWYCH celach (format wchodzi do klucza pipeline'u):
  // A → rgba16float (mapa) i rgba32float (odczyt CPU), B i C → rgba8unorm.
  async _compile() {
    const r = this.renderer;
    if (typeof r.compileAsync !== 'function') return;
    const jobs = [['A', this.low.A], ['B', this.low.B], ['C', this.low.C], ['A', this.readTarget]];
    for (const [key, target] of jobs) {
      if (this.disposed) return;
      // compileAsync czyta cel synchronicznie (renderer już zainicjowany) — cel wraca
      // PRZED czekaniem, żeby klatka gry w międzyczasie nie trafiła w cel bake'u
      const prevTarget = r.getRenderTarget();
      this.quad.material = this.materials[key];
      r.setRenderTarget(target);
      let pending;
      try {
        pending = r.compileAsync(this.scene, this.camera);
      } finally {
        r.setRenderTarget(prevTarget);
      }
      await pending;
    }
  }

  _makeUniforms(layout) {
    const typeIndex = (type) => Math.max(0, HALO_SECTOR_TYPES.indexOf(type));
    const sectorType = new Array(MAX_SECTORS).fill(0);
    const sectorClimate = Array.from({ length: MAX_SECTORS }, () => new THREE.Vector4());
    const sectorPort = new Array(MAX_SECTORS).fill(0);
    const sectorFeat = Array.from({ length: MAX_SECTORS }, () => new THREE.Vector4());
    layout.sectors.forEach((sector, i) => {
      if (i >= MAX_SECTORS) return;
      sectorType[i] = typeIndex(sector.type);
      sectorClimate[i].set(sector.climate.sea, sector.climate.mount, sector.climate.temp, sector.climate.moist);
      sectorPort[i] = sector.port ? 1 : 0;
      sectorFeat[i].set(...haloSectorFeatures(sector));
    });
    // profil planety: płaskowyż, rzeki, morza, kaniony (meandry z layoutu)
    const profile = resolveHaloProfile(layout.planetProfile);
    const canyonA = [0, 1].map((i) => {
      const c = layout.canyons?.[i];
      return c ? new THREE.Vector4(c.center, c.halfWidth, c.depth, 1) : new THREE.Vector4(0.5, 1, 1, 0);
    });
    const canyonM1 = [0, 1].map((i) => new THREE.Vector3(...(layout.canyons?.[i]?.m1 || [1, 0, 0])));
    const canyonM2 = [0, 1].map((i) => new THREE.Vector3(...(layout.canyons?.[i]?.m2 || [1, 0, 0])));
    const riverA = [];
    const m1 = [];
    const m2 = [];
    const m3 = [];
    for (let i = 0; i < RIVERS; i++) {
      const r = layout.rivers[i];
      riverA.push(new THREE.Vector4(r.center, r.width, r.phase, 1));
      m1.push(new THREE.Vector3(...r.m1));
      m2.push(new THREE.Vector3(...r.m2));
      m3.push(new THREE.Vector3(...r.m3));
    }
    const sectorStart = ((layout.sectorStart % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const port = haloPortTileUniforms(layout);
    const v4s = (n, make) => ({ array: Array.from({ length: n }, make) });
    // jeden blok = jeden bufor uniformów (limit WebGPU: 12 buforów na etap)
    return createUniformBlock({
      uGeo: new THREE.Vector4(layout.circumference, layout.floor.length, layout.wallHeight, layout.radii.floorMid),
      uNoiseOff: new THREE.Vector4(...layout.noiseOffset.map((v) => v * 0.1)),
      uSectorCount: layout.sectors.length,
      uSectorStart: sectorStart,
      uSectorSpan: layout.sectorSpan,
      uSectorType: { array: sectorType, type: 'float' },
      uSectorClimate: { array: sectorClimate },
      uSectorPort: { array: sectorPort, type: 'float' },
      uRiverA: { array: riverA },
      uRiverM1: { array: m1 },
      uRiverM2: { array: m2 },
      uRiverM3: { array: m3 },
      uRegion: new THREE.Vector4(0, 0, 1, 1),
      uSeaDepth: Number.isFinite(profile.terrain?.seaDepth) ? profile.terrain.seaDepth : HALO_TERRAIN.seaDepth,
      uSectorFeat: { array: sectorFeat },
      uProfBake: new THREE.Vector4(profile.terrain?.plateau || 0, profile.terrain?.rivers ?? 1, 0, 0),
      uCanyonA: { array: canyonA },
      uCanyonM1: { array: canyonM1 },
      uCanyonM2: { array: canyonM2 },
      uLandmarkCount: 0,
      uLandmarkA: v4s(MAX_LANDMARKS, () => new THREE.Vector4()),
      uLandmarkB: v4s(MAX_LANDMARKS, () => new THREE.Vector4(0, 0, 1, 0)),
      uLandmarkC: v4s(MAX_LANDMARKS, () => new THREE.Vector4()),
      uLandmarkD: v4s(MAX_LANDMARKS, () => new THREE.Vector4(0, 0, 0, 1)),
      uDomeCount: 0,
      uDomeA: v4s(MAX_DOMES, () => new THREE.Vector4(0, 0, 1, 0)),
      uDomeB: v4s(MAX_DOMES, () => new THREE.Vector4(0, 0, 0, 1)),
      uDomeC: v4s(MAX_DOMES, () => new THREE.Vector4()),
      uPortTile: port.tile,
      uPortRects: { array: port.rects },
      uPortZones: { array: port.zones }
    }, 'haloBakeU').uniforms;
  }

  _makeMaterial(output) {
    return makeHaloBakeMaterial(this.uniforms, output);
  }

  _mapSize(scale = 1) {
    const q = this.quality;
    const w = Math.max(256, Math.round(q.mapU * scale));
    const h = Math.max(32, Math.round(q.mapVPer6000 * (this.layout.width / 6000) * scale));
    return { w, h: Math.min(h, 2048) };
  }

  _allocSet(size, mipmaps) {
    return {
      A: makeTarget(size.w, size.h, THREE.HalfFloatType, mipmaps),
      B: makeTarget(size.w, size.h, THREE.UnsignedByteType, mipmaps),
      C: makeTarget(size.w, size.h, THREE.UnsignedByteType, mipmaps),
      size,
      rows: 0
    };
  }

  _render(target, material, region, rect) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    this.uniforms.uRegion.value.set(region[0], region[1], region[2], region[3]);
    this.quad.material = material;
    // viewport/nożyczki celu three czyta w setRenderTarget — ustawić przed
    target.viewport.set(rect[0], rect[1], rect[2], rect[3]);
    target.scissor.set(rect[0], rect[1], rect[2], rect[3]);
    target.scissorTest = true;
    try {
      r.setRenderTarget(target);
      r.render(this.scene, this.camera);
    } finally {
      target.scissorTest = false;
      target.viewport.set(0, 0, target.width, target.height);
      target.scissor.set(0, 0, target.width, target.height);
      r.setRenderTarget(prevTarget);
      r.autoClear = prevAutoClear;
    }
  }

  _bakeRegion(set, u0, u1) {
    const { w, h } = set.size;
    const x0 = Math.round(u0 * w);
    const x1 = Math.round(u1 * w);
    const rect = [x0, 0, Math.max(1, x1 - x0), h];
    const region = [x0 / w, 0, x1 / w, 1];
    for (const key of ['A', 'B', 'C']) this._render(set[key], this.materials[key], region, rect);
  }

  // CPU: wysokość w niskiej rozdzielczości (kolizje płyty, LOD terenu,
  // rozstawienie budowli, dynamiczny near kamery). Asynchronicznie — mapa
  // (this.cpu) pojawia się dopiero po odczycie; do tego czasu ring nie jest gotowy.
  async _readbackCpu() {
    const rt = this.readTarget;
    if (!rt || this.disposed) return;
    const { width: w, height: h } = rt;
    const t0 = performance.now();
    this._render(rt, this.materials.A, [0, 0, 1, 1], [0, 0, w, h]);
    const raw = await this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
    if (this.disposed) return;
    this.cpu = { w, h, heights: haloUnpackReadback(raw, w, h, { channels: 4, channel: 0, flipY: false }) };
    this.cpuVersion++;
    this.timings.readbackMs.push(performance.now() - t0);
  }

  // Megabudowle i kopuły (buildHaloLandmarkPlan / buildHaloDomePlan — miejsca
  // wybrane z mapy sprzed placów): place, parki, stawy, wnętrza kopuł do
  // uniformów bake'u, ponowny bake mapy niskiej i odczyt CPU (wysokość placu
  // dla lotu i kamery); pełna mapa dopieka się już z nimi.
  async setCivic({ landmarks = [], domes = [] } = {}) {
    const u = this.uniforms;
    const nl = Math.min(landmarks.length, MAX_LANDMARKS);
    for (let i = 0; i < MAX_LANDMARKS; i++) {
      const lm = i < nl ? landmarks[i] : null;
      const pd = lm?.pond;
      u.uLandmarkA.value[i].set(lm ? lm.s : 0, lm ? lm.plaza.halfA : 0, lm ? lm.t : 0, lm ? lm.plaza.halfQ : 0);
      u.uLandmarkB.value[i].set(lm ? lm.plazaH : 0, lm ? lm.plaza.lawn : 0, lm ? lm.plaza.ramp : 1, lm?.apron ? 1 : 0);
      u.uLandmarkC.value[i].set(lm ? lm.park.halfA : 0, lm ? lm.park.halfQ : 0, 0, 0);
      u.uLandmarkD.value[i].set(pd ? pd.da : 0, pd ? pd.dq : 0, pd ? pd.ra : 0, pd ? pd.rb : 1);
    }
    const nd = Math.min(domes.length, MAX_DOMES);
    for (let i = 0; i < MAX_DOMES; i++) {
      const dm = i < nd ? domes[i] : null;
      u.uDomeA.value[i].set(dm ? dm.s : 0, dm ? dm.t : 0, dm ? dm.r : 1, dm ? dm.floorH : 0);
      u.uDomeB.value[i].set(dm ? dm.typeIndex : 0, dm ? dm.seed : 0, dm ? dm.flatR : 0, dm ? dm.ramp : 1);
      u.uDomeC.value[i].set(dm ? dm.park.halfA : 0, dm ? dm.park.halfQ : 0, 0, 0);
    }
    const changed = u.uLandmarkCount.value !== nl || u.uDomeCount.value !== nd || nl > 0 || nd > 0;
    u.uLandmarkCount.value = nl;
    u.uDomeCount.value = nd;
    if (!changed || !this.low || this.disposed) return;
    const t0 = performance.now();
    this._bakeRegion(this.low, 0, 1);
    await this._readbackCpu();
    this.timings.civicMs = performance.now() - t0;
    if (this.disposed) return;
    if (this.pending) this.pending.nextSlice = 0;
    this.version++;
  }

  heightAtUV(u, v) {
    if (!this.cpu) return 0;
    const { w, h, heights } = this.cpu;
    const x = ((u % 1) + 1) % 1 * w - 0.5;
    const y = Math.max(0, Math.min(h - 1, v * h - 0.5));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const X0 = ((x0 % w) + w) % w;
    const X1 = (X0 + 1) % w;
    const Y1 = Math.min(h - 1, y0 + 1);
    const a = heights[y0 * w + X0] * (1 - fx) + heights[y0 * w + X1] * fx;
    const b = heights[Y1 * w + X0] * (1 - fx) + heights[Y1 * w + X1] * fx;
    return a * (1 - fy) + b * fy;
  }

  // Dopieka plaster pełnej mapy; zwraca true, gdy mapa się zmieniła.
  step() {
    const p = this.pending;
    if (!p || this.disposed) return false;
    const t0 = performance.now();
    const u0 = p.nextSlice / p.slices;
    const u1 = (p.nextSlice + 1) / p.slices;
    // Mipmapy mapy w budowie tylko po pierwszym plastrze (tekstura powstaje wtedy
    // z poziomami mip) i po ostatnim — WebGPU generuje je po KAŻDYM renderze do
    // celu (24 plastry × 3 mapy); mapy w budowie nikt nie próbkuje, wynik ten sam.
    const mips = p.nextSlice === 0 || p.nextSlice === p.slices - 1;
    for (const key of ['A', 'B', 'C']) p[key].texture.generateMipmaps = mips;
    this._bakeRegion(p, u0, u1);
    p.nextSlice++;
    const dt = performance.now() - t0;
    this.timings.slicesMs.push(dt);
    this.timings.fullBakeMs += dt;
    if (p.nextSlice < p.slices) return false;
    // gotowe: podmiana i zwolnienie mapy niskiej
    this.full = p;
    this.pending = null;
    this._disposeSet(this.low);
    this.low = null;
    this.ready = true;
    this.version++;
    this._updateBytes();
    return true;
  }

  get progress() {
    if (this.ready) return 1;
    if (!this.pending) return 0;
    return this.pending.nextSlice / this.pending.slices;
  }

  get current() {
    return this.full || this.low;
  }

  _updateBytes() {
    const bytes = (set, bpp) => (set ? set.size.w * set.size.h * bpp * 4 / 3 : 0);
    let total = 0;
    for (const set of [this.low, this.full, this.pending]) {
      if (!set) continue;
      total += bytes(set, 8) + bytes(set, 4) * 2;
    }
    this.textureBytes = total;
  }

  _disposeSet(set) {
    if (!set) return;
    set.A.dispose();
    set.B.dispose();
    set.C.dispose();
  }

  dispose() {
    this.disposed = true;
    this._disposeSet(this.low);
    this._disposeSet(this.full);
    this._disposeSet(this.pending);
    this.readTarget?.dispose();
    this.readTarget = null;
    for (const m of Object.values(this.materials)) m.dispose();
    this.quad.geometry.dispose();
    this.low = this.full = this.pending = null;
  }
}
