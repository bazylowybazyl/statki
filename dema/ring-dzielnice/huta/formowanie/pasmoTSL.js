// HUTA — formowanie, etapy „Pasmo w polu” i „Kropla”: MATERIAŁ I SIATKA METALU LINII (TSL, jeden graf, jeden rysunek).
//
// Siatka: `STACJE.n` przekrojów × (`STACJE.ring` + 1) punktów obwodu; atrybut `position` niesie tylko numer stacji i
// punktu obwodu, wierzchołek liczy shader z bufora storage stacji (`stacje.js`): środek, nadelipsa (a, b, n), rama ze
// stycznej osi zapisanej w stacji (struga po łuku wylewki, błona z ugięciem, pasmo; oś poprzeczna = z). Normalna:
// gradient nadelipsy w przekroju + nachylenie wzdłuż (różnica sąsiednich stacji) — fale, czoło i szyja cieniują się z
// geometrii. Ta sama siatka rysuje POWŁOKĘ POLA (`createFieldShellMaterial`): przekrój powiększony o warstwę pola.
//
// Wygląd (ta sama mowa co kula wytopu — `heatColor` / `heatPower`, komórki `cells3`, lustro otoczenia), ale własne
// otoczenie odbić na ZEWNĄTRZ komory: czarne niebo hali, ciepły odblask pokładu, słońce z cieniem naczynia, chłodne
// emitery bram pola i kołyski (siła z kanałów pola). CIECZ: żar z temperatury, komórki konwekcji płynące z metalem,
// lustro z połyskiem; KRZEPNIĘCIE: skóra rośnie od brzegów do środka (udział fazy stałej na licu), komórki zamierają
// w ziarno, połysk gaśnie; CIAŁO STAŁE: matowy żar z temperatury lica, zgorzelina (wzór w układzie MASY — wydłuża się
// z metalem), stygnięcie barwą od żółto-pomarańczowej do ciemnej czerwieni i szarości. Paleta stali i miedzi mieszana
// udziałem miedzi (przejściówka po zmianie metalu).
import * as THREE from 'three';
import { NodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import {
  Fn, If, Loop, abs, atan, attribute, cameraProjectionMatrix, clamp, cos, cross, dFdx, dFdy, dot, exp, float, floor, fract, int, length,
  max, min, mix, modelViewMatrix, normalize, pow, reflect, sign, sin, smoothstep, sqrt, storage, uniform, varyingProperty, vec2,
  vec3, vec4
} from 'three/tsl';
import { METALE } from '../wytop/metale.js';
import { LUMA, cells3, heatPower, noise3 } from '../wytop/wspolneTSL.js';
import { BLONA, HALA, LINIA, ZACISK } from './geometria.js';
import { BRAMY, CHLODNICE, STACJE } from './stacje.js';
import { STRUGA_WZOR } from './strugaWzor.js';
import { vesselShadow } from './swiatloLinii.js';
import { POLE_K } from './polePasma.js';
import { blendAddytywnePremul } from '../../../../src/3d/tsl/mieszanie.js';
import { WALC } from './walcownia.js';
import { tunnelLight } from './otoczenieTSL.js';
import { edgeAt, edgeGlow, pxWorld } from '../dzielenie/krawedzTSL.js';
// (runda 9, „Czysta stal”) lico taśmy za stacją odzgorzania: czysty metal (`czystaStalTSL.js`)
import { OZ_X0, OZ_X1 } from './odzgorzanie.js';
import { MOTT_CLEAN, cleanMetal, cleanWeight } from './czystaStalTSL.js';

const TAU = Math.PI * 2;
const SV = STACJE.stride / 4;    // vec4 na stację (v5 — powłoka pola: etap „Wyciskanie”; v6 — jeziorko pasma: runda 7)
/** Półszerokość odniesienia wzoru pasma [j.] (runda 7): wzór w poprzek jest w układzie MATERIAŁU — rozciąga się z
 * pasmem, gdy bramy je spłaszczają i poszerzają (a 44 przy G0 → 100 za G4; za G4 wzór jak dotąd — w j. od osi). */
const STRIP_AREF = 100;
/**
 * (poprawki rundy 7) LICO CIECZY — wysokość powierzchni jeziorka z komórek konwekcji (kopuła nad wznoszącym się środkiem
 * komórki, rynna na granicy) i zmarszczek płynących z metalem [j.]; normalna z pochodnych ekranu (bez siatki — piksel).
 * Ciecz to lustro: ostre odblaski słońca na kopułach i zmarszczkach (płyną z przepływem), odbicie emiterów i pokładu.
 */
export const LICO_CIECZY = Object.freeze({ cellH: 4.0, laneH: 1.6, ripH: 1.3, sunSharp: 110, sunK: 1.3, sunWide: 36, sunWideK: 0.22 });
/**
 * (poprawki rundy 7) SKORUPA — temperatura lica zakrzepłej skorupy w poprzek taśmy: ciepło z rdzenia przechodzi przez
 * skorupę grubiejącą od brzegu jeziorka ku krawędzi (przewodzenie: spadek ∝ √ψ, ψ — położenie w skorupie 0…1), więcej przy
 * panelach chłodnic (strumień z `chillFlux`, kanały 20–31). Spadek T̃ na krawędzi: `dT` + `dTchill` · strumień, × k skorupy
 * metalu (`METAL_FIZ.kSkin`: stal 1, miedź 0,08 — miedź przewodzi ~13× lepiej). Gaśnie, gdy lico stygnie (rdzeń oddał
 * ciepło utajone — gradient w skorupie maleje). Jasność z tej samej palety (`heatColor`); `LM.gate.y` = 0 wyłącza (A/B).
 */
export const SKORUPA = Object.freeze({ dT: 0.085, dTchill: 0.03, Toff: 0.66, Ton: 0.8 });

/**
 * Kanały pola (siła emiterów: `OU.pole`, 16 kanałów w 4 × vec4) — wspólne z materiałem otoczenia. Etap „Kropla”:
 * `kolnierz` (pierścień pola na wardze wylewki), `struga1`, `struga2` (pierścienie za wargą), `struga3` (pierścień na
 * łuku), `zacisk` (bramki zacisku wzdłuż błony — etap „Wyciskanie”; jasność bramki z położenia zacisku w shaderze),
 * `loze0–2` (łoże pola pod błoną), G0 (gardziel formująca), G1–G4, poduszka.
 */
export const POLE_KANAL = POLE_K;

/** Uniformy materiału metalu linii (od zer — pułapka 46). */
export function createLineUniforms() {
  return {
    // czas linii [s], faza linii pola [j.] (droga metalu w błonie), s wejścia strugi w błonę (koniec widocznej strugi —
    // runda 8), wzór strugi sprzed rundy 8 (1 — A/B `?strugaWzor=0`, 0 — zwykle)
    time: uniform(new THREE.Vector4(0, 0, 0, 0)),
    // strojenie: jasność żaru, gęstość komórek [1/j.], połysk, emisyjność lustra
    look: uniform(new THREE.Vector4(1.0, 1 / 34, 1.0, 0.4)),
    // zacisk pola (etap „Wyciskanie”): x zacisku [j.] (położenie w klatce), siła zacisku, 0, 0
    press: uniform(new THREE.Vector4(0, 0, 0, 0)),
    // wejście strugi w błonę: x, y [j.], siła dopływu 0…1, promień strugi przy wejściu [j.]
    hit: uniform(new THREE.Vector4(0, 0, 0, 0)),
    // (runda 7) światło robocze tunelu bramy „DO ZWIJARKI” 0…1, 0, 0, 0
    gate: uniform(new THREE.Vector4(0, 0, 0, 0)),
    // (runda 8, dzielenie) ŻAR BRZEGU CIĘCIA na czole pasma: x czoła [j.], nadwyżka T̃ na licu cięcia, szerokość pasa
    // żaru [j.], 1 — czoło cięte (0 — brak; wtedy obraz pasma bez zmian)
    cut: uniform(new THREE.Vector4(0, 0, 0, 0))
  };
}

/** Bufor storage stacji (`STACJE.n` × 5 vec4) i jego węzeł (stała nazwa — jeden program dla każdego egzemplarza). */
export function createStationBuffer() {
  const array = new Float32Array(STACJE.n * STACJE.stride);
  const attr = new StorageBufferAttribute(array, 4);
  const node = storage(attr, 'vec4', STACJE.n * SV).toReadOnly().setName('FormowaniePasmoStacje');
  return { array, attr, node };
}

/** Siatka rury metalu: wierzchołek = (numer stacji, numer punktu obwodu, 0). */
export function createMetalLineGeometry() {
  const N = STACJE.n;
  const R = STACJE.ring;
  const cols = R + 1;
  const pos = new Float32Array(N * cols * 3);
  for (let i = 0; i < N; i++) for (let j = 0; j < cols; j++) { const o = (i * cols + j) * 3; pos[o] = i; pos[o + 1] = j; }
  const idx = new Uint32Array((N - 1) * R * 6);
  let k = 0;
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < R; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = (i + 1) * cols + j + 1;
      const d = i * cols + j + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = a; idx[k++] = c; idx[k++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(1500, -1000, 0), 4000);
  return g;
}

const PASS_Y = HALA.passY;
const DECK_Y = HALA.deckY;
/** Emitery bram G1–G4 (płaszczyzny x, odległość pary emiterów od osi z) — jak w `polePasma.js`. */
export const GATE_POSTS = Object.freeze(LINIA.gates.slice(1).map((g) => Object.freeze({ x: g.x, z: Math.max(g.a + 48, 118) })));
export const G0_RING = Object.freeze({ x: LINIA.gates[0].x, r: 115 });

const F1 = (e) => { const v = float(0.0).toVar(); v.assign(e); return v; };
const V2 = (e) => { const v = vec2(0.0).toVar(); v.assign(e); return v; };
const V3 = (e) => { const v = vec3(0.0).toVar(); v.assign(e); return v; };
const V4 = (e) => { const v = vec4(0.0).toVar(); v.assign(e); return v; };

/**
 * Wierzchołek rury stacji (wspólny dla metalu i powłoki pola; wklejany w `Fn` — bez layoutu). `shell` — powłoka pola:
 * półosie przekroju z v5 (metal + warstwa pola albo zapadnięty rękaw bez metalu), metal: z v1. Zwraca punkt, normalną,
 * dane stacji, położenie w przekroju i parametr obwodu.
 */
function tubeVertex(ST, shell) {
  const N_ST = STACJE.n;
  const p0 = attribute('position', 'vec3');
  const i = int(p0.x).toVar();
  const th = F1(p0.y.mul(TAU / STACJE.ring));
  const ct = F1(cos(th));
  const sn = F1(sin(th));
  const iP = int(max(i.sub(1), int(0))).toVar();
  const iN = int(min(i.add(1), int(N_ST - 1))).toVar();
  // punkt obwodu stacji ii przy kącie th (nadelipsa: |x/a|ⁿ + |y/b|ⁿ = 1); rama ze stycznej osi w stacji (płaszczyzna x-y)
  const ringPt = (ii) => {
    const v0 = V4(ST.element(ii.mul(SV)));
    const v1 = V4(ST.element(ii.mul(SV).add(1)));
    const v4 = V4(ST.element(ii.mul(SV).add(4)));
    const v5 = shell ? V4(ST.element(ii.mul(SV).add(5))) : null;
    const tl = F1(length(v4.xy));
    const T = V3(vec3(v4.x.div(max(tl, 1e-4)).add(step01(float(1e-4).sub(tl))), v4.y.div(max(tl, 1e-4)), 0.0));
    const Up = V3(vec3(T.y.negate(), T.x, 0.0));
    const ax = F1(shell ? v5.x : v1.x);
    const ay = F1(shell ? v5.y : v1.y);
    const e = F1(float(2.0).div(max(v1.z, 2.0)));
    const lx = F1(ax.mul(sign(ct)).mul(pow(max(abs(ct), 1e-6), e)));
    const ly = F1(ay.mul(sign(sn)).mul(pow(max(abs(sn), 1e-6), e)));
    return { P: V3(v0.xyz.add(vec3(0.0, 0.0, lx)).add(Up.mul(ly))), v0, v1, v4, v5, T, Up, lx, ly, e, ax, ay };
  };
  const c = ringPt(i);
  const Pp = ringPt(iP).P;
  const Pn = ringPt(iN).P;
  const dPds = V3(Pn.sub(Pp));
  // normalna przekroju (gradient nadelipsy) i nachylenie wzdłuż
  const ee = F1(float(2.0).sub(c.e));
  const gx = F1(sign(ct).mul(pow(max(abs(ct), 1e-6), ee)).div(max(c.ax, 0.05)));
  const gy = F1(sign(sn).mul(pow(max(abs(sn), 1e-6), ee)).div(max(c.ay, 0.05)));
  const N2 = V3(normalize(vec3(0.0, 0.0, gx).add(c.Up.mul(gy)).add(vec3(0.0, 0.0, 1e-7))));
  const along = F1(max(dot(c.T, dPds), 1e-3));
  const k = F1(clamp(dot(N2, dPds).div(along), -4.0, 4.0));
  return { c, i, ct, sn, N: V3(normalize(N2.sub(c.T.mul(k)))) };
}

/**
 * (runda 8) Szumy wolnych pól temperatury strugi w punkcie (te same co we fragmencie, `strugaWzor.js`): `qx` — współrzędna
 * wzdłuż już w komórkach (pc · look · zoneK), `cq` — punkt przekroju obrócony skrętem [j.] · look. → vec2(szum 1, szum 2).
 */
const W8 = STRUGA_WZOR;
const jetZoneNoiseQ = (Q, time) => vec2(
  noise3(Q.mul(W8.slowF).add(vec3(0.0, time.mul(W8.slowT), 5.0))),
  noise3(Q.mul(W8.slow2F).add(vec3(time.mul(W8.slow2T), 7.3, 0.0)))
);
/**
 * (poprawki rundy 8) Zagęszczenie pól strugi i kontrast pól na strudze z `LM.time.w`: 0 — poprawki (`zoneK`, `jetA`),
 * 2 — etap „Struga — jasność” (`zoneK8`, pełna amplituda; A/B `?strugaWzor=2`), 1 — wzór sprzed rundy 8 (bez bilansu).
 */
const jetR8 = (LM) => clamp(LM.time.w.sub(1.5).mul(1e6), 0.0, 1.0);
const jetZoneK = (LM) => mix(float(W8.zoneK), float(W8.zoneK8), jetR8(LM));
const jetAmp = (LM) => mix(float(W8.jetA), float(1.0), jetR8(LM));
const NJ_ALL = STACJE.jet.n;
const NJ_MEAN = Math.ceil(NJ_ALL / W8.meanEvery);
/**
 * (runda 8) Średnia szumów pól po WIDOCZNEJ powierzchni strugi w miejscu przekroju (`lx`, `ly`) — pętla po co
 * `meanEvery`-tej stacji strugi (waga = rzut z góry a · |t_x|, tylko nad wejściem w błonę `LM.time.z`); dla stacji spoza
 * strugi vec2(0,5). Kopia na CPU: `jetAreaMean`.
 */
const jetZoneMeanV = (ST, LM, kind, lx, ly) => {
  const out = vec2(0.5, 0.5).toVar();
  If(kind.lessThan(1.5), () => {
    const ang0 = F1(atan(ly, lx));
    const rad = F1(length(vec2(lx, ly)).mul(LM.look.y));
    const sum = vec3(0.0).toVar();
    Loop({ start: 0, end: NJ_MEAN, type: 'int', condition: '<', name: 'zj' }, ({ zj }) => {
      const idx = int(STACJE.jet.i0).add(zj.mul(W8.meanEvery)).toVar();
      const v0 = V4(ST.element(idx.mul(SV)));
      const v1 = V4(ST.element(idx.mul(SV).add(1)));
      const v3 = V4(ST.element(idx.mul(SV).add(3)));
      const v4 = V4(ST.element(idx.mul(SV).add(4)));
      const w = F1(v1.x.mul(max(abs(v4.x), 0.05)).mul(step01(v1.x.sub(0.05))).mul(step01(LM.time.z.sub(v0.w))));
      const ang = F1(ang0.add(v3.w));
      const Q = V3(vec3(v3.x.mul(LM.look.y).mul(jetZoneK(LM)), cos(ang).mul(rad), sin(ang).mul(rad)));
      const n = V2(jetZoneNoiseQ(Q, LM.time.x));
      sum.addAssign(vec3(n.mul(w), w));
    });
    If(sum.z.greaterThan(1e-3), () => { out.assign(sum.xy.div(sum.z)); });
  });
  return out;
};

/**
 * Materiał metalu linii. `U` — uniformy wytopu (kamera, słońce, jasność), `LM` — uniformy linii, `ST` — węzeł stacji,
 * `pole` — kanały siły pola (`uniformArray` 4 × vec4 materiału otoczenia).
 */
export function createMetalLineMaterial(U, LM, ST, pole) {
  const vP = varyingProperty('vec3', 'vLnP');
  const vN = varyingProperty('vec3', 'vLnN');
  const vA = varyingProperty('vec4', 'vLnA');
  const vB = varyingProperty('vec4', 'vLnB');
  const vC = varyingProperty('vec4', 'vLnC');
  const vD = varyingProperty('vec4', 'vLnD');
  const vG = varyingProperty('vec4', 'vLnG');
  const vH = varyingProperty('vec4', 'vLnH');

  const vertex = Fn(() => {
    const t = tubeVertex(ST, false);
    const c = t.c;
    vP.assign(c.P);
    vN.assign(t.N);
    vA.assign(ST.element(t.i.mul(SV).add(2)));
    vB.assign(ST.element(t.i.mul(SV).add(3)));
    // rodzaj, położenie w przekroju (poprzecznie, pionowo [j.]), parametr poprzeczny −1…1
    vC.assign(vec4(c.v1.w, c.lx, c.ly, t.ct));
    // (runda 7) położenie w przekroju unormowane do półosi (z góry: −1…1 od brzegu do brzegu), jeziorko pasma (v6)
    // (runda 8) STRUGA — BILANS CIEPŁA ODCINKA (`strugaWzor.js`): średnia szumów pól po widocznej powierzchni strugi w tym
    // miejscu przekroju (z.w) — fragment odejmuje ją od pola, więc pola tylko przenoszą ciepło wewnątrz strugi
    const zm = V2(jetZoneMeanV(ST, LM, c.v1.w, c.lx, c.ly));
    vD.assign(vec4(c.lx.div(max(c.ax, 1e-3)), c.ly.div(max(c.ay, 1e-3)), zm.x, zm.y));
    vG.assign(ST.element(t.i.mul(SV).add(6)));
    // (runda 7) strefa walcowni: zgorzelina wwalcowana, wydłużenie (v4.z, v4.w); poza nią — pole powłoki bram
    vH.assign(c.v4);
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(c.P, 1.0)));
  })();

  // --- żar: palety stali i miedzi (stałe z `METALE`), mieszane udziałem miedzi ---------------------------------------
  const ramp = (m, k) => vec3(...METALE[m].ramp[k]);
  const heatColorX = (T, x) => {
    const a = clamp(T.sub(0.35).div(0.27), 0.0, 1.0);
    const b = clamp(T.sub(0.62).div(0.33), 0.0, 1.0);
    const cc = clamp(T.sub(0.95).div(0.35), 0.0, 1.0);
    const cs = V3(mix(mix(mix(ramp(0, 0), ramp(0, 1), a), ramp(0, 2), b), ramp(0, 3), cc));
    const cu = V3(mix(mix(mix(ramp(1, 0), ramp(1, 1), a), ramp(1, 2), b), ramp(1, 3), cc));
    const col = V3(mix(cs.div(max(dot(cs, LUMA), 1e-3)), cu.div(max(dot(cu, LUMA), 1e-3)), clamp(x, 0.0, 1.0)));
    return col;
  };

  /**
   * Otoczenie odbite w metalu (promień r z punktu P): { c — ile żaru wraca z tego kierunku (ciepły pokład pod spodem,
   * ciemna hala w górze), L — jasne źródła: emitery pola (cyjan), słońce }.
   */
  const environment = (P, r, mu) => {
    const L = vec3(0.0).toVar();
    const soft = F1(mu.mul(1.1).add(0.5));
    // pokład pod spodem: oświetlony żarem pasma (ciepły), dalej ciemniej; góra: czarna hala pod błoną pola
    const tD = F1(float(DECK_Y).sub(P.y).div(min(r.y, -0.02)));
    const near = F1(exp(max(tD, 0.0).div(-520.0)));
    const c = F1(mix(float(0.07), float(0.24).add(near.mul(0.3)), smoothstep(-0.1, 0.5, r.y.negate())));
    // emitery bram G1–G4: para pasów na |z| = z bramy, ±36 j. wokół osi pasma
    const cyan = vec3(0.16, 0.75, 1.0);
    const rxs = F1(r.x.add(sign(r.x).mul(1e-4)).add(1e-5));
    GATE_POSTS.forEach((g, k) => {
      const t = F1(float(g.x).sub(P.x).div(rxs));
      const hy = F1(P.y.add(r.y.mul(t)).sub(PASS_Y));
      const hz = F1(abs(P.z.add(r.z.mul(t))));
      const band = exp(hz.sub(g.z - 6).div(soft.mul(15.0)).mul(hz.sub(g.z - 6).div(soft.mul(15.0))).negate())
        .mul(float(1.0).sub(smoothstep(30.0, 44.0, abs(hy)))).mul(smoothstep(0.0, 4.0, t));
      const ch = 9 + k;
      L.addAssign(cyan.mul(band.mul(pole.element(ch >> 2)[['x', 'y', 'z', 'w'][ch & 3]]).mul(float(0.38).div(t.div(260.0).add(1.0)))));
    });
    // wylot G0: pierścień C (otwarty u góry)
    {
      const t = F1(float(G0_RING.x).sub(P.x).div(rxs));
      const hy = F1(P.y.add(r.y.mul(t)).sub(PASS_Y));
      const hz = F1(P.z.add(r.z.mul(t)));
      const rr = F1(length(vec2(hy, hz)));
      const band = exp(rr.sub(G0_RING.r).div(soft.mul(15.0)).mul(rr.sub(G0_RING.r).div(soft.mul(15.0))).negate())
        .mul(float(1.0).sub(smoothstep(0.82, 0.95, hy.div(max(rr, 1.0))))).mul(smoothstep(0.0, 4.0, t));
      L.addAssign(cyan.mul(band.mul(pole.element(2).x).mul(float(0.38).div(t.div(260.0).add(1.0)))));
    }
    // ZACISK POLA (etap „Wyciskanie”): świecąca bramka przy zacisku — para płetw-emiterów na |z| = zR, x z uniformu,
    // siła zacisku z symulacji (pionowy pas w płaszczyźnie x zacisku)
    {
      const zA = ZACISK.zR - 4;
      const t = F1(LM.press.x.sub(P.x).div(rxs));
      const hy = F1(P.y.add(r.y.mul(t)));
      const hz = F1(abs(P.z.add(r.z.mul(t))));
      const q = F1(hz.sub(zA).div(soft.mul(16.0)));
      const b = exp(q.mul(q).negate()).mul(smoothstep(ZACISK.sillY + 10, ZACISK.sillY + 30, hy)).mul(float(1.0).sub(smoothstep(ZACISK.finTop - 20, ZACISK.finTop, hy))).mul(smoothstep(0.0, 4.0, t));
      L.addAssign(cyan.mul(b.mul(LM.press.y).mul(float(0.4).div(t.div(300.0).add(1.0)))));
    }
    // słońce: ostry odblask i szeroka poświata (z cieniem naczynia)
    const sd = F1(max(dot(r, U.sunDir), 0.0));
    const glint = pow(sd, 420.0).mul(0.5).add(pow(sd, 50.0).mul(0.08)).add(pow(sd, 8.0).mul(0.02));
    const sv = F1(vesselShadow(U, P.add(r.mul(4.0))));
    L.addAssign(U.sunColor.mul(glint).mul(sv).mul(U.t2.z));
    // światło ciepłe od dołu (pokład oświetlony pasmem) jako szerokie pasmo
    L.addAssign(vec3(0.05, 0.026, 0.012).mul(smoothstep(0.05, 0.6, r.y.negate())).mul(near));
    return { c, L, sd, sv };
  };

  const fragment = Fn(() => {
    const P = V3(vP);
    const N0 = V3(normalize(vN));
    const V = V3(normalize(U.cam.sub(P)));
    const N = V3(N0.mul(sign(dot(N0, V).add(1e-5))));
    const Tt = vA.x;
    const Tl0 = vA.y;
    const fl = vA.z;
    const xi = vA.w;
    const pc = vB.x;
    const xcu = vB.y;
    const tcell = vB.z;
    const aux = vB.w;
    const kind = vC.x;
    const latJ = vC.y;
    const upJ = vC.z;
    const latN = F1(clamp(vC.w, -1.0, 1.0));
    const time = LM.time.x;
    const isJet = F1(float(1.0).sub(smoothstep(1.2, 1.8, kind)));
    const isRes = F1(smoothstep(1.2, 1.8, kind).mul(float(1.0).sub(smoothstep(2.2, 2.8, kind))));
    // --- współrzędne wzoru: wzdłuż (płynie z metalem), w przekroju; struga obraca wzór skrętem wiru gardzieli ---------
    // (w paśmie wzór rozciągnięty wzdłuż — metal przyspiesza w wylocie G0 z ~4 j./s w zasobniku do prędkości linii)
    const isStrip = F1(smoothstep(2.2, 2.8, kind));
    const ang = F1(atan(upJ, latJ).add(aux.mul(isJet)));
    const rad = F1(length(vec2(latJ, upJ)));
    // (runda 7) pasmo: położenie w poprzek unormowane do półszerokości (−1…1) — wzór w układzie materiału (rozciąga się z
    // pasmem, gdy bramy je spłaszczają: komórki przy G0 gęste, za G4 szerokie)
    const latA = F1(clamp(vD.x, -1.0, 1.0));
    const crossQ0 = V2(mix(vec2(latJ, upJ), vec2(cos(ang), sin(ang)).mul(rad), isJet));
    const crossQ = V2(mix(crossQ0, vec2(latA.mul(STRIP_AREF), upJ), isStrip));
    // (błona — poprawki rundy 6: wzór wyciągnięty wzdłuż +x (× 0,38) i płynący z metalem ku gardzieli — przepływ w
    // napiętym worku, nie komórki kuli)
    const Q = V3(vec3(pc.mul(mix(mix(float(1.0), float(0.55), isStrip), float(0.38), isRes)), crossQ.x, crossQ.y).mul(LM.look.y));
    // --- krzepnięcie: skóra od brzegów do środka (brzegi oddają ciepło z trzech stron) --------------------------------
    const edge = F1(latN.mul(latN));
    // (brzegi łapią skórę przy f_lica ≈ 0…0,45, środek przy 0,5…0,95 — ciekły język zwęża się ku frontowi)
    const skinF = F1(smoothstep(0.0, 1.0, fl.mul(2.2).sub(float(1.0).sub(edge).mul(1.1))));
    // JEZIORKO (runda 7, pasmo): ciekły rdzeń widziany z góry — |z| < w_p · a (w_p z f_s rdzenia i f lica, `stacje.js`);
    // poza nim skóra. Klin cieczy zwęża się od brzegów ku środkowi i kończy na froncie; połysk gaśnie w wąskim pasie
    // na brzegu jeziorka
    const wpool = vG.x;
    const bwp = F1(max(vG.w, 0.02));
    const poolV = F1(float(1.0).sub(smoothstep(wpool.sub(bwp), wpool.add(bwp.mul(0.3)), abs(latA))).mul(smoothstep(0.0, 0.06, wpool)));
    const skin = F1(mix(skinF, float(1.0).sub(poolV), isStrip));
    // temperatura powierzchni: jeziorko — rdzeń (konwekcja odnawia powierzchnię), skóra — chłodniejsza od średniej lica
    // tyle, żeby średnia po szerokości dała liczoną temperaturę lica (w_p / (1 − w_p) różnicy rdzeń − lico)
    const Tcore = F1(mix(Tl0, max(vG.z, Tl0), isStrip));
    const kSk = F1(clamp(wpool.div(max(float(1.0).sub(wpool), 0.05)), 0.0, 2.5));
    const Tskin0 = F1(Tl0.sub(max(vG.z.sub(Tl0), 0.0).mul(kSk).mul(isStrip)));
    // (poprawki rundy 7) SKORUPA w poprzek taśmy (`SKORUPA`): ψ — położenie w skorupie od brzegu jeziorka (0) do krawędzi
    // taśmy (1); spadek przez przewodzenie ∝ √ψ, większy naprzeciw paneli chłodnic (strumień odebrany z pasma — kanały
    // 20–31 pola), × k skorupy metalu; gaśnie, gdy lico stygnie poniżej `Toff`
    const SK = SKORUPA;
    const CH = CHLODNICE;
    const chDx = (CH.x1 - CH.x0) / CH.n;
    const cxf = F1(clamp(P.x.sub(CH.x0).div(chDx).sub(0.5), 0.0, CH.n - 1.001));
    const ci = int(floor(cxf)).toVar();
    const chanF = (cc) => {
      const v = pole.element(cc.div(4));
      const m = F1(float(cc.sub(cc.div(4).mul(4))));
      return mix(mix(v.x, v.y, step01(m.sub(0.5))), mix(v.z, v.w, step01(m.sub(2.5))), step01(m.sub(1.5)));
    };
    const chillHere = F1(max(mix(chanF(ci.add(CH.kanal)), chanF(min(ci.add(1), int(CH.n - 1)).add(CH.kanal)), fract(cxf)), 0.0)
      .mul(smoothstep(CH.x0 - 30, CH.x0 + 10, P.x)).mul(float(1.0).sub(smoothstep(CH.x1 - 10, CH.x1 + 30, P.x))));
    const psi = F1(clamp(abs(latA).sub(wpool).div(max(float(1.0).sub(wpool), 0.08)), 0.0, 1.0));
    const kSkM = F1(mix(float(1.0), float(0.08), clamp(xcu, 0.0, 1.0)));
    const dShell = F1(float(SK.dT).add(chillHere.mul(SK.dTchill)).mul(kSkM).mul(sqrt(psi)).mul(smoothstep(SK.Toff, SK.Ton, Tl0)).mul(isStrip).mul(LM.gate.y));
    const Tskin = F1(Tskin0.sub(dShell));
    // strefa jeziorka i świeżej skóry przy froncie (lico T̃ > 0,84…0,9) — tylko tu zmiany rundy 7 dotykają ciała stałego;
    // dalej (stygnięcie, walcownia) skóra jak dotąd
    const hotK = F1(isStrip.mul(smoothstep(0.84, 0.9, Tl0)));
    const mu = F1(clamp(dot(N, V), 0.0, 1.0));
    // --- CIECZ: wolne pola cieplejsze i chłodniejsze, komórki konwekcji (żywe w gorących polach, płyną w czasie, stoją
    // po zastygnięciu), chłodniejsze brzegi — ta sama mowa co kula wytopu ------------------------------------------------
    const tC = F1(mix(time, tcell, skin));
    // (runda 8) STRUGA: pola wzdłuż gęstsze `zoneK` razy (kilka pól na widocznej strudze, płyną z metalem) i liczone
    // względem średniej po widocznej strudze (vD.zw z etapu wierzchołków — bilans ciepła odcinka); błona i pasmo bez zmian
    // (LM.time.w: 0 — poprawki, 2 — etap „Struga — jasność”, 1 — wzór sprzed rundy 8)
    const jetNew = F1(isJet.mul(float(1.0).sub(clamp(float(1.0).sub(abs(LM.time.w.sub(1.0))).mul(1e6), 0.0, 1.0))));
    const Qz = V3(vec3(Q.x.mul(mix(float(1.0), jetZoneK(LM), jetNew)), Q.y, Q.z));
    const zn = V2(jetZoneNoiseQ(Qz, time));
    const slow = F1(zn.x);
    const slow2 = F1(zn.y);
    const zMean = V2(mix(vec2(0.5, 0.5), vD.zw, jetNew));
    const warp = V3(vec3(noise3(Q.mul(0.9).add(vec3(11.0, tC.mul(0.03), 0.0))), noise3(Q.mul(0.9).add(vec3(0.0, 23.0, tC.mul(0.03)))), noise3(Q.mul(0.9).add(vec3(tC.mul(0.03), 0.0, 37.0)))).sub(0.5));
    const cell = V4(cells3(Q.add(warp.mul(1.6)), tC.mul(0.36)));
    const lane = F1(float(1.0).sub(smoothstep(0.0, 0.4, cell.y.sub(cell.x))));
    const core = F1(float(1.0).sub(smoothstep(0.0, 0.85, cell.x)));
    const vigor = F1(smoothstep(0.26, 0.7, slow2).mul(0.82).add(0.18));
    const cellT = F1(vigor.mul(core.mul(0.05).sub(lane.mul(lane).mul(lane).mul(0.045)).add(cell.z.sub(0.5).mul(0.03))));
    // (runda 7: w paśmie wolne pola temperatury słabsze — duże pola zimniejsze zasłaniały klin jeziorka; życie cieczy
    // niosą komórki płynące z metalem)
    const tzone = F1(slow.sub(zMean.x).mul(W8.slowA).add(slow2.sub(zMean.y).mul(W8.slow2A)).mul(float(1.0).sub(isStrip.mul(0.96)).sub(isRes.mul(0.45)))
      .mul(mix(float(1.0), jetAmp(LM), jetNew)));
    // błona: ciemniejsze brzegi (metal przy ścianie worka stygnie), jaśniejszy kanał środkiem ku gardzieli (u = aux)
    const uBag = F1(clamp(aux, 0.0, 1.0));
    const bagT = F1(isRes.mul(float(1.0).sub(edge).mul(smoothstep(0.4, 0.95, uBag)).mul(0.045).sub(edge.mul(0.05))));
    const edgeCool = F1(edge.mul(edge).mul(edge).mul(0.07));
    const live = F1(float(1.0).sub(skin));
    // WEJŚCIE STRUGI w błonę: jasna plama wejścia i kolista fala biegnąca od niego po powierzchni (siła z dopływu)
    const hdx = F1(P.x.sub(LM.hit.x));
    const hd = F1(length(vec2(hdx, P.z)));
    const rj = F1(max(LM.hit.w, 8.0));
    const hitK = F1(LM.hit.z.mul(isRes).mul(step01(P.y.sub(BLONA.yc))));
    const ph = F1(hd.sub(rj).mul(TAU / 38.0).sub(time.mul(TAU * 2.2)));
    const ringEnv = F1(exp(max(hd.sub(rj), 0.0).div(-150.0)).mul(smoothstep(rj.mul(0.8), rj.mul(1.4), hd)).mul(hitK));
    const spot = F1(exp(hd.div(rj.mul(1.7)).mul(hd.div(rj.mul(1.7))).negate()).mul(hitK));
    // (runda 7, pasmo: komórki konwekcji w jeziorku wyraźniejsze — z kamery gry to one niosą ruch cieczy)
    const Tliq = F1(Tcore.mul(float(1.0).add(tzone.add(cellT.mul(isStrip.mul(0.4).add(1.0))).mul(live))).sub(edgeCool).add(bagT).add(spot.mul(0.09)).add(sin(ph).mul(ringEnv).mul(0.018)).sub(float(1.0).sub(mu).mul(float(1.0).sub(mu)).mul(0.22)));
    // drobne zmarszczki cieczy (normalna), gasną ze skórą; błona napięta — gładsza; fala kolista od wejścia strugi
    // (runda 7: w jeziorku pasma zmarszczki mocniejsze — płyną z metalem, przesuwają po powierzchni odbicia emiterów)
    const rip = V3(vec3(noise3(Q.mul(2.6).add(vec3(0.0, time.mul(0.9), 0.0))), noise3(Q.mul(2.6).add(vec3(7.0, 0.0, time.mul(0.9)))), 0.0).sub(0.5));
    const rdir = V3(vec3(hdx, 0.0, P.z).div(max(hd, 1.0)));
    const NlOld = V3(normalize(N.add(vec3(rip.x, 0.0, rip.y).mul(float(0.12).mul(live).mul(float(1.0).sub(isRes.mul(0.55))).mul(isStrip.mul(0.6).add(1.0)))).add(rdir.mul(cos(ph).mul(ringEnv).mul(0.32)))));
    // (poprawki rundy 7) LICO CIECZY PASMA: wysokość z kopuł komórek konwekcji, rynien na ich granicach i zmarszczek (płyną
    // z metalem — wzór w układzie masy), normalna z pochodnych ekranu (gradient powierzchni: Mikkelsen). Pochodne liczone
    // tu, przed gałęziami (pułapka 15). Skóra i ciało stałe zostają przy normalnej geometrii (mat).
    const LC = LICO_CIECZY;
    const hgt = F1(core.mul(LC.cellH).sub(lane.mul(LC.laneH)).mul(vigor).add(rip.x.mul(LC.ripH * 2)).mul(live).mul(isStrip));
    const dpx = V3(dFdx(P));
    const dpy = V3(dFdy(P));
    const dhx = F1(dFdx(hgt));
    const dhy = F1(dFdy(hgt));
    const rb1 = V3(cross(dpy, N));
    const rb2 = V3(cross(N, dpx));
    const detB = F1(dot(dpx, rb1));
    const gradB = V3(rb1.mul(dhx).add(rb2.mul(dhy)).mul(sign(detB.add(1e-12))));
    const Nb = V3(normalize(N.mul(abs(detB).add(1e-12)).sub(gradB)));
    const Nl = V3(normalize(mix(NlOld, Nb, isStrip)));
    const r = V3(reflect(V.negate(), Nl));
    const E = environment(P, r, mu);
    const eps = LM.look.w;
    const limb = F1(pow(max(mu, 1e-4), 0.9).mul(0.55).add(0.45));
    const om = F1(float(1.0).sub(mu));
    const fres = F1(om.mul(om).mul(om).mul(om).mul(om).mul(0.5).add(0.5));
    const hcL = V3(heatColorX(Tliq, xcu));
    const hpL = F1(heatPower(Tliq).mul(U.t1.x).mul(LM.look.x).mul(U.t4.x));
    // (runda 7, pasmo: jeziorko świeci co najmniej jak matowa skóra przy tej samej temperaturze — jasność cieczy i skóry
    // wynika z temperatury, a różni je połysk, wzór i ruch; inaczej lustro odbijające czarną górę hali dawało jeziorko
    // ciemniejsze od skóry przy końcu klina, gdzie rdzeń i lico mają prawie tę samą temperaturę)
    const emLq = F1(max(eps.add(float(1.0).sub(eps).mul(E.c)), isStrip.mul(0.46)));
    const liquid = V3(hcL.mul(hpL.mul(emLq).mul(limb)).add(E.L.mul(fres).mul(LM.look.z)));
    // (poprawki rundy 7) ODBLASKI SŁOŃCA na lustrze cieczy pasma: ostry szczyt (HDR — tylko tu, w ciekłym jądrze) i węższa
    // poświata; leżą na kopułach komórek i zmarszczkach, więc płyną z metalem i znikają, gdy lico łapie skórę (mat)
    liquid.addAssign(U.sunColor.mul(pow(E.sd, LC.sunSharp).mul(LC.sunK).add(pow(E.sd, LC.sunWide).mul(LC.sunWideK))
      .mul(E.sv).mul(U.t2.z).mul(fres).mul(isStrip).mul(LM.look.z)));
    // --- CIAŁO STAŁE: matowy żar lica, ziarno skóry, ZGORZELINA w układzie masy: smugi wzdłuż pasma (metal się
    // wydłuża), rośnie z grubością warstwy ξ; na gorącym paśmie ciemniejsza o kilka procent temperatury, po ostygnięciu
    // szaro-czarna plamista warstwa
    // (poprawki rundy 6 — zamiast kontrastowych smug wzdłuż pasma, które czytały się jak słoje drewna albo płomień:
    // spokojna, matowa powierzchnia o niskim kontraście; zgorzelina to ŁUSKI rosnące z ξ, nie smugi)
    // ziarno lica: drobny, prawie izotropowy szum w układzie masy (wydłuża się z taśmą po klatkach — znacznik ruchu)
    const gQ = V3(vec3(pc.mul(0.5), latJ, upJ.add(3.7)).mul(0.17));
    const grain = F1(noise3(gQ).mul(0.6).add(noise3(gQ.mul(2.9)).mul(0.4)));
    // plamki i łuski zgorzeliny: komórki w układzie masy z wejściem zaburzonym szumem (nieregularne plamy, nie
    // wielokąty), pokrycie rośnie z grubością warstwy ξ (komórka „łuska”, gdy jej hasz < pokrycie), miękki brzeg łuski
    // (gaśnie ku granicy komórki — bez siatki pęknięć); każda łuska trochę inna (hasz)
    const fQ0 = V3(vec3(pc.mul(0.14), latJ.mul(0.12), upJ.mul(0.12).add(11.3)));
    const fQ = V3(fQ0.add(vec3(noise3(fQ0.mul(1.9)), noise3(fQ0.mul(1.9).add(17.0)), noise3(fQ0.mul(1.9).add(31.0))).sub(0.5).mul(0.9)));
    const fc = V4(cells3(fQ, float(0.0)));
    const cover = F1(clamp(xi.mul(1.7).sub(0.06), 0.0, 0.92));
    const isFl0 = F1(float(1.0).sub(smoothstep(cover.sub(0.04), cover.add(0.04), fc.z)));
    const soft0 = F1(smoothstep(0.0, 0.22, fc.y.sub(fc.x)));
    const cold = F1(clamp(float(0.85).sub(Tl0), 0.0, 1.0));
    // zgorzelina na gorącym paśmie: cienka i sama żarząca się — ciemniejsza o 1–2 % T̃; po ostygnięciu o kilka procent
    const scaleM0 = F1(isFl0.mul(soft0));
    const flakeTone0 = F1(fract(fc.z.mul(7.31)).mul(0.6).add(0.7));
    const scaleDT0 = F1(scaleM0.mul(float(0.008).add(cold.mul(0.045))).mul(flakeTone0));
    // (runda 7) STREFA WALCOWNI (od krawędzi walca F1 — przejście pod walcem, niewidoczne z góry): zgorzelina z liczonego
    // stanu klatek. Łuska izoluje lico (gorąca warstwa tlenku ma na wierzchu kilkadziesiąt K mniej) — wyspy łuski są
    // ciemniejsze o ok. 3 % T̃ (ok. 35 K), świeży metal za klatką bez łuski świeci jaśniej i przygasa, gdy łuska odrasta:
    //   ŁUSKA NOWA — od zera za klatką (ξ − ξ wwalcowanej); wyspy w układzie FIZYCZNYM przęsła (współrzędna masy × λ
    //     przęsła: okrągłe plamki, nie rozciągnięte), pokrycie rośnie z ξ;
    //   ŁUSKA WWALCOWANA — resztka (`xiKeep`) wysp sprzed klatki: TE SAME wyspy co przed klatką (to samo pole, ten sam
    //     układ: λ przęsła przed klatką), teraz wydłużone o stosunek wydłużeń — smugi wzdłuż taśmy, coraz dłuższe za każdą
    //     klatką (1 : 1,5 : 2,3 : 3,3), jadą z taśmą;
    //   SMUGI WALCOWANIA — lico odbija szlif walców: drobne prążki wzdłuż taśmy (w poprzek co ok. 3,5 j.);
    //   POŁYSK świeżego lica (gładsze — matowieje z czasem od klatki).
    const xF1 = WALC.stands[0].x;
    const xF2 = WALC.stands[1].x;
    const xF3 = WALC.stands[2].x;
    const isMill = F1(isStrip.mul(smoothstep(xF1 - 74, xF1 - 66, P.x)));
    const k1 = F1(step01(P.x.sub(xF1)));
    const k2 = F1(step01(P.x.sub(xF2)));
    const k3 = F1(step01(P.x.sub(xF3)));
    const L1 = WALC.T[0] / WALC.T[1];
    const L2 = WALC.T[0] / WALC.T[2];
    const L3 = WALC.T[0] / WALC.T[3];
    // λ przęsła (po ostatniej klatce): układ fizyczny nowej łuski
    const lamS = F1(float(1.0).add(k1.mul(L1 - 1)).add(k2.mul(L2 - L1)).add(k3.mul(L3 - L2)));
    const millCells = (lam) => {
      const q0 = V3(vec3(pc.mul(lam).mul(0.14), latJ.mul(0.12), upJ.mul(0.12).add(11.3)));
      const q = V3(q0.add(vec3(noise3(q0.mul(1.9)), noise3(q0.mul(1.9).add(17.0)), noise3(q0.mul(1.9).add(31.0))).sub(0.5).mul(0.9)));
      return V4(cells3(q, float(0.0)));
    };
    const xiRem = F1(max(vH.z, 0.0).mul(isMill));
    const xiNew = F1(max(xi.sub(xiRem), 0.0));
    // (koszt: wzory strefy walcowni liczone tylko tam, gdzie strefa jest — gałąź; bez pochodnych ekranu w środku)
    const scaleMm = F1(0.0);
    const toneN = F1(1.0);
    const strk = F1(0.0);
    // (poprawki rundy 7) ŁUSKA WWALCOWANA = te same wyspy starej łuski co przed F1 (wzór `fc` w układzie MASY, λ = 1): każda
    // klatka wydłuża je o swoje λ — za F1 ×1,5, za F2 ×2,3, za F3 ×3,3 (narastająco, jak plastry); gruba stara łuska izoluje
    // mocniej (ciemniejsza). Łuska NOWA rośnie od zera za klatką — cienka, z początku ledwie widoczna (świeże lico).
    const remK = F1(0.0);
    If(isMill.greaterThan(0.0), () => {
      const fcN = millCells(lamS);
      const coverN = F1(clamp(xiNew.mul(1.2).sub(0.06), 0.0, 0.92));
      const newM = F1(float(1.0).sub(smoothstep(coverN.sub(0.04), coverN.add(0.04), fcN.z)).mul(smoothstep(0.0, 0.22, fcN.y.sub(fcN.x))));
      const coverR = F1(clamp(xiRem.div(WALC.xiKeep).mul(1.7).sub(0.06), 0.0, 0.92).mul(0.75).mul(k1));
      const remM = F1(float(1.0).sub(smoothstep(coverR.sub(0.03), coverR.add(0.03), fc.z)).mul(smoothstep(0.0, 0.18, fc.y.sub(fc.x))));
      // (łuska nowa cienka — izoluje słabiej: kontrast rośnie z jej grubością; wwalcowana — gruba stara łuska, ciemna)
      scaleMm.assign(max(newM.mul(clamp(xiNew.mul(2.6), 0.0, 1.0)).mul(0.45), remM));
      remK.assign(remM);
      toneN.assign(fract(fcN.z.mul(7.31)).mul(0.5).add(0.75));
      // smugi walcowania (prążki szlifu walca w lico — wzdłuż taśmy; od F1) w układzie MASY: każda kolejna klatka je
      // wydłuża — krótkie za F1, długie za F3 (długość ∝ λ ∝ prędkość przęsła)
      strk.assign(noise3(vec3(latJ.mul(0.28), pc.mul(0.016), 9.1)).sub(0.5).mul(k1).mul(isMill));
    });
    const tSince = F1(vG.y);
    const fresh = F1(exp(max(tSince, 0.0).div(-0.45)).mul(step01(tSince.add(1e-3))).mul(isMill));
    // PLAMY CIEPLNE z krzepnięcia (lico nierówno ostygłe po polu, fali grubości i chłodnicach — typowo ±ok. 30 K): duże plamy w układzie MASY,
    // od strefy dojazdu do F1 (x od 2 140 — za frontem przy każdym przepływie) do bramy; wydłużają się w każdej klatce
    // i jadą z taśmą — znacznik prędkości 1 : 1,5 : 2,3 : 3,3 widoczny z kamery gry
    const mottK = F1(isStrip.mul(smoothstep(2140.0, 2240.0, P.x)).mul(float(1.0).sub(hotK)));
    const mott = F1(0.0);
    If(mottK.greaterThan(0.0), () => {
      mott.assign(noise3(vec3(pc.mul(0.028), latJ.mul(0.042), 2.3)).mul(0.7).add(noise3(vec3(pc.mul(0.061), latJ.mul(0.09), 7.9)).mul(0.3)).sub(0.5).mul(mottK).mul(1.5));
    });
    // (poprawki rundy 7: stara łuska wwalcowana ciemniejsza od nowej — grubsza warstwa tlenku; cienki film nowej łuski
    // przygasza lico, gdy rośnie — tuż za klatką lico czyste i jaśniejsze)
    const scaleDTm = F1(max(scaleMm.mul(float(0.04).add(cold.mul(0.045))).mul(toneN), remK.mul(float(0.075).add(cold.mul(0.03)))).add(xiNew.mul(0.12)).add(strk.mul(0.016)));
    const scaleM = F1(mix(scaleM0, scaleMm, isMill));
    // (runda 9) za stacją odzgorzania lico ma jednolitą emisyjność (czysty metal — bez wysp tlenku o innej emisyjności):
    // plamy jasności spadają do rzeczywistej różnicy temperatury lica (ok. ±30 K — × `MOTT_CLEAN`)
    const clK0 = F1(cleanWeight(xi).mul(isStrip).mul(smoothstep(OZ_X0 - 2, OZ_X1, P.x)));
    const scaleDT = F1(mix(scaleDT0, scaleDTm, isMill).sub(mott.mul(0.25).mul(mix(float(1.0), float(MOTT_CLEAN), clK0))));
    // świeża skóra: słaby odcisk zamarłych komórek tuż za frontem, znika pod zgorzeliną
    const imprint = F1(cellT.mul(0.2).mul(float(1.0).sub(smoothstep(0.05, 0.25, xi))));
    // brzegi stygną szybciej (ciepło uchodzi z trzech stron) — ciemniejszy pas przy krawędzi taśmy
    // (runda 7, pasmo: skóra poza jeziorkiem z temperatury skóry; ziarno świeżej skóry wyraźniejsze — inna faktura niż ciecz)
    const Tsol = F1(Tskin.mul(float(1.0).add(imprint)).add(grain.sub(0.5).mul(float(0.008).add(hotK.mul(0.008)))).sub(scaleDT).sub(edge.mul(edge).mul(edge).mul(0.06)));
    // (ta sama zależność od kąta patrzenia co ciecz — przyciemnienie brzegu bryły; bez niej lico zakrzepłe przy froncie
    // świeciło jaśniej niż ciecz tuż przed nim i front czytał się jak kapturek nad taśmą)
    const TsolV = F1(Tsol.sub(float(1.0).sub(mu).mul(float(1.0).sub(mu)).mul(0.22)));
    const hcS = V3(heatColorX(TsolV, xcu));
    // (poprawki rundy 6: mnożnik świecenia lica 0,8 → 0,46 × przyciemnienie brzegu — tyle, ile ciecz widziana z góry przy tej samej temperaturze (emisyjność i
    // odbicie otoczenia ~0,5); zakrzepła część na froncie nie jest jaśniejsza od ciekłej, dalej przygasa z temperaturą)
    // świeża skóra tuż za frontem świeci i lśni jak ciecz (ta sama emisyjność i odbicie otoczenia), a matowieje, gdy
    // rośnie zgorzelina — połysk znika w wąskim pasie za frontem, bez skoku jasności
    // (runda 7, pasmo: skóra poza jeziorkiem matowa od razu — połysk gaśnie na brzegu jeziorka, nie dopiero ze zgorzeliną)
    const matteE = F1(max(smoothstep(0.02, 0.3, xi), float(1.0).sub(poolV).mul(hotK).mul(0.85)));
    // (runda 7: świeże lico za klatką gładsze — mniej matowe w ODBICIU; świecenie liczone jak dotąd)
    const matte = F1(matteE.mul(float(1.0).sub(fresh.mul(0.7))));
    const emL = F1(eps.add(float(1.0).sub(eps).mul(E.c)));
    const gainS = F1(U.t1.x.mul(LM.look.x).mul(U.t4.x).mul(mix(emL, float(0.46), matteE).sub(scaleM.mul(0.03))).mul(limb));
    const hpS = F1(heatPower(TsolV).mul(gainS));
    // (runda 8, dzielenie) ŻAR BRZEGU CIĘCIA na czole pasma — ten sam wzór co tył arkusza (`krawedzTSL.js`): nadwyżka i
    // szerokość pasa z modelu (√t), od lica cięcia w głąb taśmy, pas węższy od piksela rozciągnięty z zachowaniem energii
    // (poprawki rundy 8) LM.cut = (x czoła, nadwyżka T̃ w chwili cięcia, wiek w środku [τ], zmiana wieku na 1 j. z) — brzeg
    // starszy po tej stronie, od której ognisko zaczęło przemiatanie (jak tył arkusza)
    const cutK = F1(step01(LM.cut.x).mul(isStrip));
    const eC = edgeAt(LM.cut.y.mul(cutK), LM.cut.z.add(LM.cut.w.mul(P.z)));
    const gC = edgeGlow(TsolV, eC.E, eC.w, max(LM.cut.x.sub(P.x), 0.0), pxWorld(U.cam, P));
    const cutE = V3(heatColorX(gC.T, xcu).mul(gC.P.mul(gainS).mul(cutK)));
    const ndl = F1(max(dot(N, U.sunDir), 0.0));
    const shadow = F1(vesselShadow(U, P.add(N.mul(6.0))));
    const albedo = V3(mix(vec3(0.06, 0.058, 0.057), vec3(0.034, 0.033, 0.034), scaleM).mul(grain.mul(0.16).add(0.92)).mul(strk.mul(0.4).add(1.0)));
    // (rozproszone światło na licu: na gorącej taśmie przy froncie przygaszone jak w lustrze cieczy — inaczej szara
    // warstwa rozjaśniała zakrzepłą część tuż za frontem; pełne po ostygnięciu)
    // (runda 7, pasmo: na gorącej skórze przy jeziorku rozproszone światło słabsze — inaczej słońce rozjaśniało skórę ponad
    // ciecz, która odbija ciemną górę hali, i klin jeziorka czytał się z ukosa jak chłodniejszy)
    // (runda 7) światło robocze tunelu bramy „DO ZWIJARKI” na licu (szare, zimne czoło widać w tunelu i we wlocie)
    const tun = V3(tunnelLight(P, N).mul(LM.gate.x).mul(isStrip));
    const diffuse = V3(albedo.mul(U.sunColor.mul(ndl.mul(shadow)).add(U.ambient.mul(N.y.mul(0.3).add(0.7))).add(vec3(0.05, 0.045, 0.04))).mul(mix(mix(float(0.35), float(0.12), hotK), float(1.0), smoothstep(0.0, 0.35, cold))).add(albedo.mul(tun).mul(7.0)));
    const rS = V3(reflect(V.negate(), N));
    const specS = F1(pow(max(dot(rS, U.sunDir), 0.0), mix(float(7.0), float(30.0), fresh)).mul(mix(float(0.035), float(0.22), fresh)).mul(shadow).mul(float(1.0).sub(scaleM.mul(0.6))));
    // (runda 9) CZYSTA STAL za stacją odzgorzania (pas od początku strefy; waga z ξ lica — bez stacji, A/B, ξ zostaje i
    // lico jak dotąd): jednolity metal ze smugami walcowania, odbicie słońca, emiterów i hali zamiast matowej łuski
    const clK = clK0;
    const clean = cleanMetal(U, N, V, P, Tl0, xcu, strk, grain, shadow, E.L, fres);
    const diffuseX = V3(mix(diffuse, clean.diffuse, clK));
    const specX = V3(mix(U.sunColor.mul(specS), clean.spec, clK));
    const solid = V3(hcS.mul(hpS).add(cutE).add(diffuseX).add(specX).add(E.L.mul(fres).mul(mix(LM.look.z.mul(0.7), float(0.04), matte)).mul(float(1.0).sub(scaleM.mul(0.5))).mul(float(1.0).sub(clK))));
    const outc = vec3(0.0).toVar();
    outc.assign(mix(liquid, solid, skin));
    // zasobnik w kołysce: chłodna poświata pola na brzegu (odbicie emiterów kołyski u dołu bryły)
    outc.addAssign(vec3(0.05, 0.25, 0.34).mul(isRes.mul(om.mul(om).mul(om)).mul(0.25).mul(pole.element(1).y)));
    const lum = dot(outc, LUMA);
    outc.mulAssign(min(float(1.0), float(2.4).div(max(lum, 1e-3))));
    return vec4(max(outc, vec3(0.0)), 1.0);
  })();

  const m = new NodeMaterial();
  m.name = 'FormowaniePasmo';
  m.vertexNode = vertex;
  m.fragmentNode = fragment;
  m.side = THREE.FrontSide;
  m.fog = false;
  m.lights = false;
  m.toneMapped = false;
  return m;
}

/** 1 dla x > 0 (krok bez stałych odwróconych). */
function step01(x) { return clamp(x.mul(1e6), 0.0, 1.0); }

/**
 * POWŁOKA POLA wokół strugi i błony (ta sama siatka stacji, przekrój powiększony o warstwę pola; addytywna, bez zapisu
 * głębi — nie zasłania metalu): pole widać jako chłodną błonę, która jaśnieje na brzegu (Fresnel) i tam, gdzie metal
 * napiera — jasność z symulacji w stacji (`v4.z`: napięcie błony, ścisk prasy, uderzenie strugi, fala, mody). Linie
 * sił biegną wzdłuż osi (od prasy ku gardzieli — zbiegają się w gardzieli formującej); fala η (`v4.w`) skręca je i
 * rozjaśnia. Wzór stoi w układzie błony (kąt obwodu) — rusza się z błoną, nie jest zapętloną animacją.
 */
export function createFieldShellMaterial(U, LM, ST) {
  const vP = varyingProperty('vec3', 'vPlP');
  const vN = varyingProperty('vec3', 'vPlN');
  const vD = varyingProperty('vec4', 'vPlD');
  const vE = varyingProperty('vec4', 'vPlE');
  const vF = varyingProperty('vec4', 'vPlF');
  const vertex = Fn(() => {
    // przekrój powłoki z v5 (stacje): struga — metal + 7 j., błona — metal + 9 j. + napór, za zaciskiem płaski
    // zapadnięty rękaw (bez metalu), na zacisku przewężenie; w paśmie — strefa BRAM POLA G0–G4 (runda 7, rodzaj 4:
    // metal + warstwa pola, przewężona na płaszczyźnie bramy, z mostami do lic emiterów), dalej brak (v5 = 0)
    const t = tubeVertex(ST, true);
    const c = t.c;
    vP.assign(c.P);
    vN.assign(t.N);
    const kind = c.v5.z;
    const wK = F1(step01(kind.sub(0.5)));
    // [jasność pola, fala η, rodzaj powłoki (1 struga, 2 błona), waga], [kąt obwodu, siła zacisku, a, b]
    vD.assign(vec4(c.v4.z, c.v4.w, kind, wK));
    vE.assign(vec4(atan(t.sn, t.ct), c.v5.w, c.v5.x, c.v5.y));
    // (runda 7) odległość punktu powłoki od obrysu metalu w poprzek [j.] (> 0 — most pola poza metalem)
    // (poprawki rundy 7) półszerokość metalu i wysokość punktu nad osią przekroju — wachlarz linii pola bramy
    vF.assign(vec4(abs(c.lx).sub(c.v1.x), c.v1.x, c.ly, c.v1.y));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(c.P, 1.0)));
  })();
  const fragment = Fn(() => {
    const P = V3(vP);
    const N0 = V3(normalize(vN));
    const V = V3(normalize(U.cam.sub(P)));
    const mu = F1(abs(dot(N0, V)));
    const glow = F1(vD.x);
    const eta = vD.y;
    const kind = vD.z;
    const wK = vD.w;
    const ang = vE.x;
    // (runda 7) bramy pola w paśmie — rodzaj 4; rodzaje 1–3 liczą się dokładnie jak dotąd (mnożniki 1 i 0)
    const isGate = F1(smoothstep(3.4, 3.6, kind));
    const isBag = F1(smoothstep(1.4, 1.6, kind).mul(float(1.0).sub(isGate)));
    // zapadnięty rękaw za zaciskiem (rodzaj 3): płaska błona bez metalu — linie sił widać też z góry (przygaszona powłoka)
    const isColl = F1(smoothstep(2.4, 2.6, kind).mul(float(1.0).sub(isGate)));
    // brzeg (Fresnel): pole widać przy krawędzi, na wprost prawie przezroczyste — metal pod spodem bez zasłony
    const om = F1(float(1.0).sub(mu));
    const rim = F1(om.mul(om).mul(om).mul(om));
    // linie sił wzdłuż osi: na błonie 12 włókien po obwodzie (od prasy ku gardzieli — zbiegają się w gardzieli
    // formującej), na strudze 8 (rękaw pola); cienkie, widać je głównie z ukosa; poprzecznych pierścieni nie ma — w
    // poprzek biegnie tylko fala naporu (jasność z fali η i ze stanu w stacji)
    const nM = F1(mix(float(8.0), float(12.0), isBag));
    const merid = F1(cos(ang.mul(nM).add(eta.mul(3.0))).mul(0.5).add(0.5));
    const fib = F1(pow(merid, 40.0));
    // ZACISK (etap „Wyciskanie”): na przewężeniu błony linie sił zagęszczają się (drugi zestaw 24 włókien) i biegnie
    // poprzeczny jasny pas — z góry jasna kreska w poprzek rękawa, która jedzie od tyłu ku gardzieli; siła zacisku w
    // stacji (`v5.w` — z symulacji: ciśnienie trzymane przez bramkę, ścisk regulatora, posuw), nie animacja
    const pinB = F1(clamp(vE.y, 0.0, 2.0).mul(isBag));
    const frontB = F1(min(pinB, 1.0));
    const merid2 = F1(cos(ang.mul(24.0).add(eta.mul(3.0)).add(1.3)).mul(0.5).add(0.5));
    const fib2 = F1(pow(merid2, 30.0).mul(frontB));
    const arc = F1(pinB.mul(pinB).mul(0.55));
    const lines = F1(fib.mul(mix(float(0.5), float(0.7), isBag)).add(fib2.mul(0.8)));
    const cyan = vec3(0.32, 0.82, 1.0);
    const I0 = F1(glow.mul(rim.mul(0.5).add(lines.mul(om.mul(0.45).add(0.04).add(isColl.mul(0.22)))).add(float(0.018).add(isColl.mul(0.03)))).add(arc.mul(0.95)).mul(wK));
    // BRAMY POLA (runda 7): ta sama skóra pola — przezroczysta na wprost, jasny brzeg, linie sił wzdłuż pasma; na
    // płaszczyźnie bramy powłoka dociska metal (przewężenie z geometrii stacji) i sięga mostem do lic emiterów; jasność,
    // drugi zestaw gęstszych linii i pas siły rosną z liczonym NACISKIEM bramy (v5.w; `stacje.js`). Nad metalem pas
    // przygaszony (z góry metal bez zasłony), na moście do emitera — pełny. Bez HDR: pole nie rozlewa poświaty.
    // (poprawki rundy 7) LINIE POLA BRAMY jak w powłoce błony, ale WACHLARZEM: od lica emitera (szerokość lica ±12 j.) do
    // krawędzi taśmy, gdzie się zbiegają (gęstość pola rośnie ku metalowi — tam jaśniej). Nad samym metalem powłoka jest
    // prawie niewidoczna (słaby brzeg) — bez welonu na całej szerokości; z góry metal bez zasłony. Jasność z nacisku bramy.
    const fin = F1(smoothstep(1.0, 6.0, vF.x));
    const bandG = F1(clamp(vE.y, 0.0, 2.0));
    const dG = F1(float(1e4));
    const zG = F1(float(120.0));
    for (let k = 0; k < BRAMY.n; k++) {
      const d = F1(P.x.sub(BRAMY.x[k]));
      const sel = F1(step01(abs(dG).sub(abs(d))));
      dG.assign(mix(dG, d, sel));
      zG.assign(mix(zG, float(BRAMY.zE[k]), sel));
    }
    const span = F1(max(zG.sub(vF.y), 8.0));
    const tF = F1(clamp(vF.x.div(span), 0.0, 1.0));
    const wF = F1(mix(float(2.5), float(13.0), tF));
    const uF = F1(dG.div(wF));
    const inFan = F1(float(1.0).sub(smoothstep(0.85, 1.05, abs(uF))));
    // 7 linii w wachlarzu (u = −1…1), cienkie; pionowo linie leżą na powłoce mostu — z boku widać łuki od lica do brzegu
    const lineF = F1(pow(cos(uF.mul(Math.PI * 3.0)).mul(0.5).add(0.5), 18.0));
    const conv = F1(float(1.0).div(tF.mul(1.6).add(0.45)));
    const contact = F1(exp(vF.x.div(4.0).mul(vF.x.div(4.0)).negate()).mul(exp(dG.div(5.0).mul(dG.div(5.0)).negate())));
    const linesG = F1(lineF.mul(inFan).mul(fin).mul(conv).mul(0.95).add(inFan.mul(fin).mul(0.06)));
    const IG = F1(min(min(bandG, 1.5).mul(linesG.add(contact.mul(0.9))).add(glow.mul(rim).mul(0.12).mul(float(1.0).sub(fin))), 1.1).mul(wK));
    const I = F1(mix(I0, IG, isGate));
    // HDR tylko w najjaśniejszych miejscach naporu (> próg poświaty ~0,9 dopiero przy mocnym ścisku / uderzeniu)
    return vec4(cyan.mul(min(I, 1.6)), 1.0);
  })();
  const m = new NodeMaterial();
  m.name = 'FormowaniePolePowloka';
  m.vertexNode = vertex;
  m.fragmentNode = fragment;
  m.side = THREE.FrontSide;
  m.transparent = true;
  m.depthWrite = false;
  m.forceSinglePass = true;
  m.fog = false;
  m.lights = false;
  m.toneMapped = false;
  blendAddytywnePremul(m);
  return m;
}
