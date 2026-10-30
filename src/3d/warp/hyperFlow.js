// src/3d/warp/hyperFlow.js
//
// OPŁYW HIPERCRUISE'U (2026-10-29, zgłoszenie użytkownika: „dać [haze] większy z silników i efekt à la opływowy,
// aerodynamiczny haze wzdłuż statku w dół — żeby oddać prędkość”; całość wyglądu — hyperLook.js). Przezroczyste
// zniekształcenie (warstwa DIST — sama refrakcja, bez świecenia i bez okręgów) przypięte do statku gracza w hipercruisie:
//   • OTOCZKA — warstwa przyścienna wzdłuż burt: pas tuż za obrysem kadłuba (L × W z pudła sprite'a × hullWidth, dziób
//     zbieżny — pół szerokości 0,3 → 1 na pierwszych 45% długości), grubiejący od dzioba ku rufie, z pasmami szumu
//     wydłużonymi wzdłuż kursu i płynącymi ku rufie; wnętrze kadłuba bez przesunięcia (kadłub ostry); za rufą burty
//     schodzą się w KILWATER (pas szerzeje i gaśnie wykładniczo);
//   • STRUGI DYSZ — długie smugi gorącego powietrza z każdej dyszy MAIN (dłuższe niż stożek „uber”, wzór szybszy).
// Jeden rysunek: kwady na instancjach (0 — otoczka, 1..N — dysze), dane względem statku (duży offset w mesh.position —
// pozycja świata nie idzie do shadera we float32). Kierunek przesunięcia w osiach EKRANU z modelViewMatrix (obrót kadru
// kursem w górę liczy kamera ortho passa DIST).
// Klatka: WarpNurt.update → setShip (statek, obwiednia siły z fazy hipercruise'u), engineVfxSystem → nozzle (dysze
// gracza tej klatki, ta sama poza renderu), krok Core3D.fx → commit (bufor instancji, zgłoszenie warstwy DIST — flagę
// kasuje start klatki efektów, więc zgłoszenie idzie z kroku, jak maskowanie i pule broni). Działa tak samo w trybie
// off i w workerze renderu (bez pól migawki — RenderWorld.hyper i encja gracza już są).

import * as THREE from 'three/webgpu';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, float, vec2, vec3, vec4, uniform, attribute, positionGeometry, modelViewMatrix, varyingProperty,
  texture, abs, max, exp, sqrt, smoothstep, clamp, length
} from 'three/tsl';
import { Core3D } from '../core3d.js';
import { FX_DISTORT_LAYER } from '../fx/fxFrame.js';
import { fxNoise } from '../fx/noise.js';
import { fxRandom } from '../fx/fxRandom.js';
import { zbierzZakres } from '../zakresyWysylki.js';
import { WARIANT_INSTANCJI } from '../rozgrzewka.js';
import { hyperLegacyLookOn } from './hyperLook.js';

/** Najwięcej dysz MAIN gracza ze strugą opływu. */
export const HYPER_FLOW_NOZZLE_CAP = 12;
const CAP = 1 + HYPER_FLOW_NOZZLE_CAP;
const STRIDE = 12;

/**
 * Strojenie (konsola: HyperFlow.tune). Amplituda przesunięcia [px bufora] = clamp(rozmiar na ekranie × k, lo, hi) —
 * rozmiar: promień kadłuba (otoczka) albo promień dyszy (struga); przy dalekim zoomie dolna granica trzyma efekt widocznym.
 * Przepływ wzoru [j/s] = clamp(prędkość × flowK, flowMin · L, flowMax · L) (struga × wakeFlow), FAZA całkowana na CPU
 * (faza += przepływ · dt — zmiana prędkości zmienia tempo, nie położenie wzoru) i ograniczona do aliasK długości wzoru
 * na sekundę (lenA — cecha bazowa szumu; stosunek przepływu do lenA nie zależy od zoomu): przy 60 kl/s druga oktawa
 * przesuwa się ≤ ~¼ komórki na klatkę — wzór płynie, nie migocze. Długość wzoru: otoczka 3,2 r, struga sheathLenA …
 * wakeLenA × długość strugi (Lz).
 */
export const HYPER_FLOW_TUNE = {
  // szerokość kadłuba z pudła sprite'a (entityWarpHullWidth) × hullWidth — sprite ma margines (Atlas: kadłub ~0,63 pudła)
  hullWidth: 0.8,
  sheathK: 0.2, sheathLo: 2, sheathHi: 9,
  wakeK: 1.1, wakeLo: 2, wakeHi: 10,
  flowK: 0.2, flowMin: 1.2, flowMax: 3.5, wakeFlow: 1.6,
  wakeLenR: 30, wakeLenL: 0.5, wakeLenA: 0.35, aliasK: 4,
  // obwiednia: rozbieg otoczki z prędkością (ułamek vmax), narost po kopie [s], dogasanie po wyjściu [s], żar dysz
  // w rozruchu (ułamek strugi)
  sheathFrom: 0.03, sheathFull: 0.5, kickRise: 0.8, exitFade: 1.1, spoolWake: 0.25
};

const smooth01 = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Obwiednia siły opływu z fazy efektu hipercruise'u (WarpPlayerFx: mode 'charging' | 'warp' | 'exit' | 'idle', kickT,
 * exitT, charge) i prędkości prowadzonej (speed / vmax). Czysta (testy). out = { sheath, wake } ∈ [0, 1]; `hold` —
 * pamięć siły z lotu (dogasanie po wyjściu idzie od niej).
 */
export function hyperFlowEnvelope(mode, t, kickT, exitT, charge, speed, vmax, hold, out, tune = HYPER_FLOW_TUNE) {
  let s = 0;
  let w = 0;
  if (mode === 'warp') {
    const a = smooth01(0, Math.max(0.05, tune.kickRise), t - kickT);
    const f = vmax > 1 ? Math.max(0, Math.min(1, speed / vmax)) : 0;
    s = a * smooth01(tune.sheathFrom, tune.sheathFull, f);
    w = Math.max(tune.spoolWake, a) * (0.55 + 0.45 * smooth01(0, 0.6, f));
    hold.sheath = s;
    hold.wake = w;
  } else if (mode === 'exit') {
    const k = 1 - smooth01(0, Math.max(0.05, tune.exitFade), t - exitT);
    s = (hold.sheath || 0) * k;
    w = (hold.wake || 0) * k;
  } else if (mode === 'charging') {
    w = tune.spoolWake * smooth01(0.4, 1, charge);
    hold.sheath = 0;
    hold.wake = w;
  }
  out.sheath = s;
  out.wake = w;
  return out;
}

/* ============================================================================
   MATERIAŁ (TSL) — kwad na instancję: x wzdłuż prądu (otoczka: od środka kadłuba, + ku rufie; struga: od wylotu),
   y w poprzek [j. świata]. Przesunięcie w px bufora, osie ekranu (x w prawo, y w górę), B = A = 0 (maskowanie).
   ========================================================================== */
const U = {
  zoomPx: uniform(0.1),
  sheath: uniform(new THREE.Vector4(0.2, 2, 9, 0)),    // k, lo, hi [px], faza wzoru [j.] (całkowana na CPU)
  wake: uniform(new THREE.Vector4(1.1, 2, 10, 0)),
  wakeLenA: uniform(0.35)                               // długość wzoru strugi × Lz
};

function makeFlowMaterial(noiseTex) {
  const A = attribute('iFlowA', 'vec4');   // środek kwadu (względem siatki, scena), oś z prądem (scena, jednostkowa)
  const B = attribute('iFlowB', 'vec4');   // pół długości, pół szerokości, przesunięcie x (lokalne → układ efektu), siła
  const C = attribute('iFlowC', 'vec4');   // rodzaj (0 otoczka, 1 struga), p1, p2, ziarno
  const vP = varyingProperty('vec4', 'vHfP');   // x, y [j.], rodzaj, siła
  const vQ = varyingProperty('vec4', 'vHfQ');   // p1, p2, ziarno, —
  const vAx = varyingProperty('vec2', 'vHfAx'); // oś prądu w osiach ekranu
  const vE = varyingProperty('vec2', 'vHfE');   // położenie w kwadzie (±1) — zanik do zera na brzegu kwadu

  const m = new NodeMaterial();
  m.name = 'HyperFlowDist';
  m.positionNode = Fn(() => {
    const q = positionGeometry.xy.mul(2.0);   // PlaneGeometry(1, 1): ±0,5 → ±1
    vE.assign(q);
    const dir = A.zw;
    const perp = vec2(dir.y.negate(), dir.x);
    const along = q.x.mul(B.x);
    const across = q.y.mul(B.y);
    vP.assign(vec4(along.add(B.z), across, C.x, B.w));
    vQ.assign(vec4(C.y, C.z, C.w, 0.0));
    const axS = modelViewMatrix.mul(vec4(dir, 0.0, 0.0)).xy;
    vAx.assign(axS.div(max(length(axS), 1e-6)));
    return vec3(A.xy.add(dir.mul(along)).add(perp.mul(across)), 0.0);
  })();
  m.fragmentNode = Fn(() => {
    const x = vP.x.toVar();
    const y = vP.y.toVar();
    const k = clamp(vP.w, 0.0, 1.0).toVar();
    const p1 = max(vQ.x, 1.0).toVar();
    const p2 = max(vQ.y, 1.0).toVar();
    const seed = vQ.z;
    const mask = float(0.0).toVar();
    const lenA = float(1.0).toVar();   // skala wzoru wzdłuż prądu [j.]
    const lenC = float(1.0).toVar();   // w poprzek
    const phase = float(0.0).toVar();  // faza wzoru wzdłuż prądu [j.]
    const amp = float(0.0).toVar();    // amplituda [px]
    If(vP.z.lessThan(0.5), () => {
      // OTOCZKA: kadłub = klin z zaokrąglonym przodem — pół szerokości r · (0,3 → 1) na pierwszych 45% długości od
      // dzioba, dalej r do rufy (kapitały mają ostre dzioby; stadion zostawiał „jajo” czystego tła przed dziobem);
      // d > 0 na zewnątrz (pas przy burtach, przed dziobem i za rufą)
      const half = vQ.x;
      const r = p2;
      const ay = abs(y);
      const s = clamp(x.add(half).div(half.mul(2.0)), 0.0, 1.0);          // 0 — dziób, 1 — rufa
      const hw = r.mul(smoothstep(0.0, 0.45, s).mul(0.7).add(0.3));
      const d = max(max(ay.sub(hw), x.add(half).negate()), x.sub(half)).toVar();
      const th = r.mul(s.mul(0.8).add(0.3));                              // grubość warstwy rośnie ku rufie
      const layer = smoothstep(0.0, r.mul(0.3), d).mul(exp(d.div(max(th, 1.0)).negate()));
      const onHull = float(1.0).sub(smoothstep(half.sub(r.mul(0.2)), half.add(r.mul(1.0)), x));
      // kilwater: za rufą pas szerzeje i gaśnie
      const xw = x.sub(half.sub(r.mul(0.3)));
      const xwp = max(xw, 0.0);
      const ww = r.mul(xwp.div(r.mul(4.0)).mul(0.45).add(0.8));
      const yy = ay.div(max(ww, 1.0));
      const wake = smoothstep(0.0, r.mul(0.8), xw).mul(exp(xwp.div(half.mul(1.1)).negate())).mul(exp(yy.mul(yy).negate()));
      const inside = smoothstep(r.mul(-0.05), r.mul(0.12), d);            // 0 w kadłubie — kadłub ostry
      mask.assign(max(layer.mul(onHull), wake.mul(0.85)).mul(inside));
      lenA.assign(r.mul(3.2));
      lenC.assign(r.mul(0.55));
      phase.assign(U.sheath.w);
      amp.assign(clamp(r.mul(U.zoomPx).mul(U.sheath.x), U.sheath.y, U.sheath.z));
    }).Else(() => {
      // STRUGA DYSZY: x od wylotu, promień wylotu R, długość Lz; stożek szerzeje 1,1 → 3,7 R
      const R = p1;
      const Lz = p2;
      const xp = max(x, 0.0);
      const w = R.mul(xp.div(Lz).mul(2.6).add(1.1));
      const yy = y.div(max(w, 1.0));
      const across = exp(yy.mul(yy).mul(-1.5));
      const along = smoothstep(R.mul(-0.2), R.mul(1.5), x).mul(exp(xp.div(Lz.mul(0.42)).negate()));
      mask.assign(across.mul(along));
      lenA.assign(Lz.mul(U.wakeLenA));
      lenC.assign(R.mul(0.6));
      phase.assign(U.wake.w);
      amp.assign(clamp(R.mul(U.zoomPx).mul(U.wake.x), U.wake.y, U.wake.z));
    });
    // pasma szumu wydłużone wzdłuż prądu, płynące z prądem (dwie oktawy, druga drobniejsza i nieco szybsza); faza
    // całkowana na CPU — zmiana prędkości zmienia tempo, nie położenie wzoru
    const u1 = y.div(lenC).add(seed.mul(7.31));
    const n1 = texture(noiseTex, vec2(u1.mul(0.25), x.sub(phase).div(lenA).mul(0.25))).rg;
    const n2 = texture(noiseTex, vec2(u1.mul(0.55).add(0.37), x.sub(phase.mul(1.15)).div(lenA).mul(0.6))).rg;
    // zanik do zera na brzegu kwadu (koniec strugi i kilwateru, boki) — bez szwu na stałej linii przy statku
    const edge = float(1.0).sub(smoothstep(0.82, 1.0, vE.x)).mul(float(1.0).sub(smoothstep(0.82, 1.0, abs(vE.y))));
    // fbm tekstury (0..1) jest skupione przy 0,5 (typowo ±0,15) — wzmocnienie do ~±0,5, szczyty ±1
    const n = n1.sub(0.5).mul(3.2).add(n2.sub(0.5).mul(1.8));
    const ax = vAx;
    const pr = vec2(ax.y.negate(), ax.x);
    const off = pr.mul(n.x).add(ax.mul(n.y.mul(0.35))).mul(amp.mul(mask).mul(k).mul(edge));
    return vec4(off, 0.0, 0.0);
  })();
  // Warstwa DIST sumuje przesunięcia (także ujemne) — mieszanie One / One w kolorze i alfie, bez głębi.
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  m.fog = false;
  m.lights = false;
  m.premultipliedAlpha = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendEquationAlpha = THREE.AddEquation;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneFactor;
  return m;
}

/* ============================================================================
   PARTIA
   ========================================================================== */
const ATTRS = [['iFlowA', 0], ['iFlowB', 4], ['iFlowC', 8]];
let _base = null;
function createFlowGeometry(capacity) {
  if (!_base) _base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(_base.index);
  g.setAttribute('position', _base.getAttribute('position'));
  const arr = new Float32Array(Math.max(1, capacity) * STRIDE);
  const buf = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1);
  for (const [name, offset] of ATTRS) g.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, 4, offset));
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return { geometry: g, data: arr, buffer: buf };
}

let mesh = null;
let geo = null;
let mat = null;
let data = null;
let buffer = null;
let warmMesh = null;
let fxStep = null;

// Stan klatki: statek (świat gry — y w dół), wymiary kadłuba, siła, dysze (scena — y w górę, double).
const ship = { armed: false, x: 0, y: 0, angle: 0, length: 0, width: 0, sheath: 0, wake: 0, cloakVis: 1 };
// Faza wzoru wzdłuż prądu [j.] (otoczka, strugi) i czas efektu ostatniej klatki: faza += przepływ · dt (zawijana co 2^20 j. —
// precyzja float32 we współrzędnych szumu; skok wzoru raz na kilka minut lotu, w szumie niewidoczny).
const PHASE_WRAP = 1048576;
const flowPh = { sheath: 0, wake: 0, lastT: -1 };
const nzX = new Float64Array(HYPER_FLOW_NOZZLE_CAP);
const nzY = new Float64Array(HYPER_FLOW_NOZZLE_CAP);
const nzDX = new Float32Array(HYPER_FLOW_NOZZLE_CAP);
const nzDY = new Float32Array(HYPER_FLOW_NOZZLE_CAP);
const nzR = new Float32Array(HYPER_FLOW_NOZZLE_CAP);
let nzN = 0;
const seeds = new Float32Array(CAP);

function ensureBuilt() {
  if (mesh) return true;
  if (!Core3D.isInitialized || !Core3D.scene) return false;
  ({ geometry: geo, data, buffer } = createFlowGeometry(CAP));
  mat = makeFlowMaterial(fxNoise.tile2D());
  mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'HyperFlow';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.layers.set(FX_DISTORT_LAYER);
  Core3D.scene.add(mesh);
  for (let i = 0; i < CAP; i++) seeds[i] = fxRandom.next() * 16;
  return true;
}

function ensureStep() {
  if (fxStep || !Core3D.fx || typeof Core3D.addFxStep !== 'function') return;
  fxStep = Core3D.addFxStep({
    name: 'hipercruise: opływ',
    update() { if (HyperFlow._commit()) Core3D.setDistortLayerActive(true); }
  });
}

function writeInstance(i, cx, cy, ax, ay, halfLen, halfWid, off, k, kind, p1, p2) {
  const o = i * STRIDE;
  data[o] = cx; data[o + 1] = cy; data[o + 2] = ax; data[o + 3] = ay;
  data[o + 4] = halfLen; data[o + 5] = halfWid; data[o + 6] = off; data[o + 7] = k;
  data[o + 8] = kind; data[o + 9] = p1; data[o + 10] = p2; data[o + 11] = seeds[i];
}

export const HyperFlow = {
  enabled: true,
  tune: HYPER_FLOW_TUNE,
  /** Statystyki ostatniej klatki (narzędzia): instancje, rysunki. */
  stats: { instances: 0, draws: 0 },

  /**
   * Klatka (WarpNurt.update, przed modułami kadłubów): statek gracza w pozie renderu (świat gry), kadłub [j.], siła
   * otoczki i strug (obwiednia — hyperFlowEnvelope), prędkość prowadzona [j/s], czas efektu [s] (stoi w pauzie), px bufora
   * na j. świata. Siła 0 — nic (dysze z tej klatki nie wejdą).
   */
  setShip(x, y, angle, length, width, sheath, wake, speed, time, zoomPx) {
    nzN = 0;
    ship.armed = false;
    ship.cloakVis = 1;
    if (!this.enabled || !(sheath > 0.002 || wake > 0.002) || hyperLegacyLookOn()) { flowPh.lastT = -1; return false; }
    if (!ensureBuilt()) return false;
    ensureStep();
    ship.armed = true;
    ship.x = x; ship.y = y; ship.angle = angle;
    ship.length = Math.max(40, Number(length) || 0);
    ship.width = Math.max(20, Number(width) || 0);
    ship.sheath = Math.min(1, sheath);
    ship.wake = Math.min(1, wake);
    const T = this.tune;
    const L = ship.length;
    const v = Math.max(T.flowMin * L, Math.min(T.flowMax * L, Math.abs(Number(speed) || 0) * T.flowK));
    // przepływ wzoru ≤ aliasK długości wzoru na sekundę (otoczka: 3,2 r; struga: wakeLenA × najkrótsza Lz = wakeLenL · L)
    const r = ship.width * 0.5 * T.hullWidth;
    const vS = Math.min(v, T.aliasK * 3.2 * r);
    const vW = Math.min(v * T.wakeFlow, T.aliasK * T.wakeLenA * T.wakeLenL * L);
    // faza całkowana czasem efektu (stoi w pauzie; po przerwie albo skoku czasu — bez przyrostu)
    const tt = Number(time) || 0;
    const dt = flowPh.lastT >= 0 ? tt - flowPh.lastT : 0;
    const step = dt > 0 && dt < 0.25 ? dt : 0;
    flowPh.lastT = tt;
    flowPh.sheath = (flowPh.sheath + vS * step) % PHASE_WRAP;
    flowPh.wake = (flowPh.wake + vW * step) % PHASE_WRAP;
    U.zoomPx.value = zoomPx > 0 ? zoomPx : 0.1;
    U.sheath.value.set(T.sheathK, T.sheathLo, T.sheathHi, flowPh.sheath);
    U.wake.value.set(T.wakeK, T.wakeLo, T.wakeHi, flowPh.wake);
    U.wakeLenA.value = T.wakeLenA;
    return true;
  },

  /**
   * Dysza MAIN gracza tej klatki (engineVfxSystem.js — scena, y w górę): wylot, kierunek wydechu, promień [j.], widoczność
   * maskowania przy dyszy (najniższa z dysz gasi też otoczkę — rzecz przy kadłubie gaśnie z maskowaniem).
   */
  nozzle(sx, sy, dirX, dirY, radius, cloakVis = 1) {
    if (ship.armed && cloakVis < ship.cloakVis) ship.cloakVis = Math.max(0, cloakVis);
    if (!ship.armed || nzN >= HYPER_FLOW_NOZZLE_CAP || !(radius > 0)) return;
    if (!(Number.isFinite(sx) && Number.isFinite(sy))) return;
    nzX[nzN] = sx; nzY[nzN] = sy; nzDX[nzN] = dirX; nzDY[nzN] = dirY; nzR[nzN] = radius;
    nzN++;
  },

  /** Krok Core3D.fx (przed passami): bufor instancji tej klatki; true — warstwa DIST ma treść. */
  _commit() {
    if (!mesh) return false;
    const armed = ship.armed;
    ship.armed = false;
    if (!armed) {
      if (mesh.visible) mesh.visible = false;
      this.stats.instances = 0; this.stats.draws = 0;
      return false;
    }
    const T = this.tune;
    const L = ship.length;
    const W = ship.width;
    // scena: y w górę; oś z prądem = ku rufie
    const ox = ship.x;
    const oy = -ship.y;
    const ca = Math.cos(ship.angle);
    const sa = Math.sin(ship.angle);
    const axX = -ca;
    const axY = sa;
    let n = 0;
    const sheathK = ship.sheath * ship.cloakVis;
    if (sheathK > 0.002) {
      const r = W * 0.5 * T.hullWidth;
      const half = L * 0.5;
      const x0 = -half - 1.2 * r;                   // przed dziobem
      const tailX = half + 2.6 * half;              // koniec kilwateru
      const halfLen = (tailX - x0) * 0.5;
      const mid = (tailX + x0) * 0.5;               // środek kwadu wzdłuż osi (od środka kadłuba)
      const wakeEnd = r * (0.8 + 0.45 * (2.6 * half) / (4 * r));
      const halfWid = Math.max(r * 3.8, wakeEnd * 2.2);
      writeInstance(n++, axX * mid, axY * mid, axX, axY, halfLen, halfWid, mid, sheathK, 0, half, r);
    }
    if (ship.wake > 0.002) {
      const lenL = T.wakeLenL * L;
      for (let i = 0; i < nzN; i++) {
        const R = nzR[i];
        const Lz = Math.max(T.wakeLenR * R, lenL);
        let dx = nzDX[i];
        let dy = nzDY[i];
        const dl = Math.sqrt(dx * dx + dy * dy);
        if (dl > 1e-6) { dx /= dl; dy /= dl; } else { dx = axX; dy = axY; }
        const x0 = -0.4 * R;
        const halfLen = (Lz - x0) * 0.5;
        const mid = (Lz + x0) * 0.5;
        writeInstance(n++, nzX[i] - ox + dx * mid, nzY[i] - oy + dy * mid, dx, dy, halfLen, R * 6.2, mid, ship.wake, 1, R, Lz);
      }
    }
    nzN = 0;
    if (n === 0) {
      if (mesh.visible) mesh.visible = false;
      this.stats.instances = 0; this.stats.draws = 0;
      return false;
    }
    mesh.position.set(ox, oy, 0);
    // Core3D liczy macierze sceny RAZ na klatkę, PRZED krokami Core3D.fx (`_syncSceneMatrices`) — bez odświeżenia opływ
    // rysował się z macierzą poprzedniej klatki, v / fps za statkiem (83–167 j. przy 20–40 tys. j/s i 240 Hz), a przy
    // nierównych odstępach stron drgał
    mesh.updateMatrixWorld();
    if (geo.instanceCount !== n) geo.instanceCount = n;
    zbierzZakres(buffer, 0, n * STRIDE);
    if (!mesh.visible) mesh.visible = true;
    this.stats.instances = n; this.stats.draws = 1;
    return true;
  },

  /** Rozgrzewka (Core3D.warmup, ekran ładowania): trzymacz z układem atrybutów partii (warstwa DIST). */
  warmupMesh() {
    if (!ensureBuilt()) return null;
    if (!warmMesh) {
      const { geometry } = createFlowGeometry(1);
      geometry.instanceCount = 1;
      warmMesh = new THREE.Mesh(geometry, mat);
      warmMesh.name = 'HyperFlow (rozgrzewka)';
      warmMesh.frustumCulled = false;
      warmMesh.visible = false;
      warmMesh.layers.set(FX_DISTORT_LAYER);
      Core3D.scene.add(warmMesh);
    }
    return warmMesh;
  }
};

Core3D.warmup?.add({
  name: 'hipercruise: opływ (DIST)', objects: () => HyperFlow.warmupMesh(), layer: FX_DISTORT_LAYER, phase: 'loading',
  variant: WARIANT_INSTANCJI
});

// Dla testów: graf materiału (WGSL w Node) i uniformy.
export const HyperFlowInternals = Object.freeze({ makeFlowMaterial, U, STRIDE, CAP });
