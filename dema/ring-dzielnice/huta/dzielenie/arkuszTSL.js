// HUTA — element 4 (dzielenie): MATERIAŁY TSL — PARTIA ARKUSZY (arkusze, odpad, opaski paczek; 1 rysunek) i OSTRZE POLA
// (addytywne, 1 rysunek). Tylko TSL, graf raz na moduł; uniformy od zer (pułapka 46); bez pochodnych ekranu.
//
// (Runda 9) iF.y = PRZECHYŁ θ [rad] wokół dolnej krawędzi −z płyty (zawias: z środka − największa półszerokość, spód
// płyty; iA.y / iA.z — środek płyty przy θ = 0); obrót odpadu w rynnie, błona pola na arkuszu i opaski paczek — usunięte.
// ARKUSZ: prostopadłościan z 16 odcinkami wzdłuż długości (język czoła odpadu zwęża się w planie), dane z modelu w buforze
// instancji (krok `ARK_STRIDE` f32): iA = (x tyłu, y środka, z środka, długość), iB = (półszerokość tył / przód, półgrubość,
// rodzaj: 0 arkusz, 1 odpad z językiem czoła, 2 opaska paczki, 3 odpad), iC = T̃ w 4 węzłach (przód → tył), iD = żar brzegów
// cięcia z wieku (poprawki rundy 8: nadwyżka T̃ w chwili cięcia i wiek w jednostkach τ w środku brzegu — tył, przód), iE =
// (współrzędna wzoru na przodzie, wzoru na 1 j., ξ, udział miedzi), iF = (ξ łuski wwalcowanej — resztka sprzed F3 z obrazu
// pasma w chwili rozdzielenia, obrót wokół pionu [rad] — kawałek w rynnie, BŁONA POLA 0…1 — przyspieszenie nadawane polem,
// 0), iG = (zmiana wieku brzegu tyłu i przodu wzdłuż brzegu [τ / j.] — ognisko przeszło przez jeden koniec wcześniej, 0, 0).
// Wygląd lica = taśma za F3 (`../formowanie/pasmoTSL.js`, strefa walcowni za ostatnią klatką): ta sama paleta żaru, łuska
// wwalcowana i nowa, smugi walcowania, plamy cieplne, ziarno — te same wzory i liczby (w chwili rozdzielenia arkusz
// wygląda jak taśma klatkę wcześniej). Żar brzegów cięcia — `krawedzTSL.js` (model √t, pas rozciągnięty do piksela).
//
// OSTRZE: pas pola w poprzek taśmy na x ostrza (obecność i szerokość z fazy krzywki), linie sił z lic emiterów zbiegające
// się w OGNISKU (jedyne HDR), za ogniskiem świecąca szczelina (lica w solidusie, wzór brzegu cięcia), po rozdzieleniu
// wąska szczelina-wnęka między czołem pasma a tyłem arkusza (gaśnie, gdy się otwiera); jasność pola = moc ostrza z modelu.
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, abs, attribute, cameraProjectionMatrix, clamp, cos, dot, exp, float, floor, fract, max, min, mix, modelViewMatrix, normalize, pow,
  reflect, sign, sin, smoothstep, sqrt, uniform, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { LUMA, cells3, heatPower, noise3 } from '../wytop/wspolneTSL.js';
import { METALE } from '../wytop/metale.js';
import { vesselShadow } from '../formowanie/swiatloLinii.js';
import { blendAddytywnePremul } from '../../../../src/3d/tsl/mieszanie.js';
import { edgeAt, edgeGlow, pxWorld } from './krawedzTSL.js';
import { chuteShade } from './rynnaTSL.js';
import { WALC } from '../formowanie/walcownia.js';
// (runda 9, „Czysta stal”) arkusz cięty z czystej taśmy (za stacją odzgorzania) dziedziczy czyste lico
import { MOTT_CLEAN, cleanMetal, cleanWeight } from '../formowanie/czystaStalTSL.js';

/** Wydłużenie przęsła za F3 (układ fizyczny nowej łuski) i resztka łuski wwalcowanej — jak w `pasmoTSL.js`. */
const LAM3 = WALC.T[0] / WALC.T[3];
const XI_KEEP = WALC.xiKeep;

/** Krok rekordu instancji arkusza [f32]. */
export const ARK_STRIDE = 28;
/** Odcinki wzdłuż długości (język czoła odpadu, 4 węzły temperatury). */
export const ARK_SEG = 16;

const F1 = (e) => { const v = float(0.0).toVar(); v.assign(e); return v; };
const V3 = (e) => { const v = vec3(0.0).toVar(); v.assign(e); return v; };
const V4 = (e) => { const v = vec4(0.0).toVar(); v.assign(e); return v; };

/**
 * Geometria arkusza: wierzchołek = (u wzdłuż 0…1 od tyłu, v w poprzek −1…1, w w pionie −1…1), normalna lokalna (x wzdłuż,
 * y w pionie, z w poprzek). Ściany: wierzch, spód, boki (po 16 odcinków), tył, przód.
 */
export function createSheetGeometry() {
  const pos = [];
  const nor = [];
  const quad = (a, b, c, d, n) => { for (const p of [a, b, c, a, c, d]) { pos.push(...p); nor.push(...n); } };
  const S = ARK_SEG;
  for (let i = 0; i < S; i++) {
    const u0 = i / S;
    const u1 = (i + 1) / S;
    quad([u0, -1, 1], [u0, 1, 1], [u1, 1, 1], [u1, -1, 1], [0, 1, 0]);
    quad([u0, -1, -1], [u1, -1, -1], [u1, 1, -1], [u0, 1, -1], [0, -1, 0]);
    quad([u0, 1, -1], [u1, 1, -1], [u1, 1, 1], [u0, 1, 1], [0, 0, 1]);
    quad([u0, -1, -1], [u0, -1, 1], [u1, -1, 1], [u1, -1, -1], [0, 0, -1]);
  }
  quad([0, -1, -1], [0, 1, -1], [0, 1, 1], [0, -1, 1], [-1, 0, 0]);
  quad([1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1], [1, 0, 0]);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.instanceCount = 0;
  return g;
}

/**
 * Uniformy ostrza (od zer — pułapka 46): A = (x ostrza, y wierzchu taśmy, z ogniska, moc ostrza z modelu), B = (przemiatanie
 * 0…1 albo −1, kierunek, półszerokość pasa pola [j.], obecność pasa 0…1 z fazy krzywki), C = (T̃ taśmy pod ostrzem,
 * nadwyżka T̃ lica szczeliny (solidus − taśma), udział miedzi, przyrost wieku lic za ogniskiem [τ / j. drogi ogniska] —
 * ślad ogniska stygnie za ostrzem), D, E — szczelina po rozdzieleniu (niżej).
 */
export function createBladeUniforms() {
  return {
    A: uniform(new THREE.Vector4(0, 0, 0, 0)), B: uniform(new THREE.Vector4(0, 0, 0, 0)), C: uniform(new THREE.Vector4(0, 0, 0, 0)),
    // SZCZELINA PO ROZDZIELENIU: x środka szczeliny (między czołem pasma a tyłem arkusza), jej szerokość [j.], nadwyżka T̃
    // lic cięcia w chwili cięcia, 1 — szczelina wąska (lica widać z góry jak wnękę)
    D: uniform(new THREE.Vector4(0, 0, 0, 0)),
    // (poprawki rundy 8) wiek lic szczeliny po rozdzieleniu w jednostkach τ: w środku (z = 0), zmiana na 1 j. z, 0, 0
    E: uniform(new THREE.Vector4(0, 0, 0, 0))
  };
}

/** Barwa żaru stali / miedzi (palety `METALE`, unormowana do luminancji 1), mieszana udziałem miedzi — jak taśma. */
function heatColorX(T, x) {
  const ramp = (m, k) => vec3(...METALE[m].ramp[k]);
  const a = clamp(T.sub(0.35).div(0.27), 0.0, 1.0);
  const b = clamp(T.sub(0.62).div(0.33), 0.0, 1.0);
  const cc = clamp(T.sub(0.95).div(0.35), 0.0, 1.0);
  const cs = V3(mix(mix(mix(ramp(0, 0), ramp(0, 1), a), ramp(0, 2), b), ramp(0, 3), cc));
  const cu = V3(mix(mix(mix(ramp(1, 0), ramp(1, 1), a), ramp(1, 2), b), ramp(1, 3), cc));
  return V3(mix(cs.div(max(dot(cs, LUMA), 1e-3)), cu.div(max(dot(cu, LUMA), 1e-3)), clamp(x, 0.0, 1.0)));
}

/**
 * Materiał partii arkuszy. `U` — uniformy wytopu (kamera, słońce, otoczenie, jasność), `LM` — uniformy metalu linii
 * (`look.x` — jasność żaru: ten sam mnożnik co taśma), `buf` — `InstancedInterleavedBuffer` (krok `ARK_STRIDE`).
 */
export function createSheetMaterial(U, LM, buf) {
  const iA = new THREE.InterleavedBufferAttribute(buf, 4, 0);
  const iB = new THREE.InterleavedBufferAttribute(buf, 4, 4);
  const iC = new THREE.InterleavedBufferAttribute(buf, 4, 8);
  const iD = new THREE.InterleavedBufferAttribute(buf, 4, 12);
  const iE = new THREE.InterleavedBufferAttribute(buf, 4, 16);
  const iF = new THREE.InterleavedBufferAttribute(buf, 4, 20);
  const iG = new THREE.InterleavedBufferAttribute(buf, 4, 24);
  const vP = varyingProperty('vec3', 'vArP');
  const vN = varyingProperty('vec3', 'vArN');
  const vL = varyingProperty('vec4', 'vArL');      // u, v, w, rodzaj
  const vT = varyingProperty('vec4', 'vArT');      // T̃ węzłów
  const vE = varyingProperty('vec4', 'vArE');      // brzegi
  const vW = varyingProperty('vec4', 'vArW');      // wzór
  const vG = varyingProperty('vec4', 'vArG');      // długość, półszerokość tu, półgrubość, 0
  const vF = varyingProperty('vec4', 'vArF');      // ξ łuski wwalcowanej (resztka sprzed F3), obrót, błona pola, 0
  const vS = varyingProperty('vec4', 'vArS');      // zmiana wieku brzegów wzdłuż brzegu (tył, przód), 0, 0
  const geo = { iA, iB, iC, iD, iE, iF, iG };
  const vertex = Fn(() => {
    const p0 = attribute('position', 'vec3');
    const n0 = attribute('normal', 'vec3');
    const A = V4(attribute('iA', 'vec4'));
    const Bq = V4(attribute('iB', 'vec4'));
    const kind = F1(floor(Bq.w.add(0.5)));
    const u = F1(p0.x);
    // język czoła odpadu (rodzaj 1): w planie zaokrąglony na ~0,7 półszerokości od przodu (jak czoło taśmy)
    const isTongue = F1(float(1.0).sub(min(abs(kind.sub(1.0)), 1.0)));
    const hw0 = F1(mix(Bq.x, Bq.y, u));
    const ew = F1(max(hw0.mul(0.7), 10.0));
    const dF = F1(float(1.0).sub(u).mul(A.w));
    const gw = F1(clamp(dF.div(ew), 0.0, 1.0));
    const kw = F1(sqrt(gw.mul(float(2.0).sub(gw))));
    const hw = F1(hw0.mul(mix(float(1.0), kw.mul(0.7).add(0.3), isTongue)));
    // (runda 9) PRZECHYŁ θ wokół zawiasu — dolnej krawędzi −z płyty (z_h = z środka − półszerokość największa, y_b = spód):
    // punkt (rz, ry) względem zawiasu → (z_h + rz cos θ − ry sin θ, y_b + rz sin θ + ry cos θ); θ = 90° — płyta na sztorc
    const Fq = V4(attribute('iF', 'vec4'));
    const ct = F1(cos(Fq.y));
    const st = F1(sin(Fq.y));
    const zh = F1(A.z.sub(max(Bq.x, Bq.y)));
    const yb = F1(A.y.sub(Bq.z));
    const rz = F1(A.z.add(p0.y.mul(hw)).sub(zh));
    const ry = F1(p0.z.add(1.0).mul(Bq.z));
    const P = V3(vec3(A.x.add(u.mul(A.w)), yb.add(rz.mul(st)).add(ry.mul(ct)), zh.add(rz.mul(ct)).sub(ry.mul(st))));
    vP.assign(P);
    // normalna lokalna (x wzdłuż, y w pionie, z w poprzek) obrócona tak samo
    vN.assign(vec3(n0.x, n0.z.mul(st).add(n0.y.mul(ct)), n0.z.mul(ct).sub(n0.y.mul(st))));
    vL.assign(vec4(u, p0.y, p0.z, kind));
    vT.assign(attribute('iC', 'vec4'));
    vE.assign(attribute('iD', 'vec4'));
    vW.assign(attribute('iE', 'vec4'));
    vF.assign(Fq);
    vS.assign(attribute('iG', 'vec4'));
    vG.assign(vec4(A.w, hw, Bq.z, 0.0));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(P, 1.0)));
  })();
  const fragment = Fn(() => {
    const P = V3(vP);
    const N0 = V3(normalize(vN));
    const V = V3(normalize(U.cam.sub(P)));
    const N = V3(N0.mul(sign(dot(N0, V).add(1e-5))));
    const u = F1(clamp(vL.x, 0.0, 1.0));
    const kind = F1(vL.w);
    const isBand = F1(float(1.0).sub(min(abs(kind.sub(2.0)), 1.0)));
    const len = F1(max(vG.x, 1.0));
    const latJ = F1(vL.y.mul(vG.y));
    const upJ = F1(vL.z.mul(vG.z));
    // temperatura wzdłuż: węzły w środkach ćwiartek (przód q = 0 przy u = 7/8 … tył q = 3 przy u = 1/8)
    const q = F1(clamp(float(3.5).sub(u.mul(4.0)), 0.0, 3.0));
    const qi = F1(floor(q));
    const qf = F1(q.sub(qi));
    const T01 = F1(mix(vT.x, vT.y, clamp(q, 0.0, 1.0)));
    const T12 = F1(mix(vT.y, vT.z, clamp(q.sub(1.0), 0.0, 1.0)));
    const T23 = F1(mix(vT.z, vT.w, clamp(q.sub(2.0), 0.0, 1.0)));
    const Tu = F1(mix(mix(T01, T12, step01(qi.sub(0.5))), T23, step01(qi.sub(1.5))));
    void qf;
    // odległość od lica cięcia (tył / przód) w głąb arkusza [j.] — żar brzegów niżej (`krawedzTSL.js`)
    const dB = F1(u.mul(len));
    const dFr = F1(float(1.0).sub(u).mul(len));
    // wzór lica w układzie MASY (jak taśma za F3): współrzędna wzoru na przodzie + droga od przodu × wzór na 1 j.
    const pc = F1(vW.x.add(dFr.mul(vW.y)).negate());
    const xi = F1(vW.z);
    const xcu = F1(vW.w);
    const gQ = V3(vec3(pc.mul(0.5), latJ, upJ.add(3.7)).mul(0.17));
    const grain = F1(noise3(gQ).mul(0.6).add(noise3(gQ.mul(2.9)).mul(0.4)));
    const fQ0 = V3(vec3(pc.mul(0.14), latJ.mul(0.12), upJ.mul(0.12).add(11.3)));
    const fQ = V3(fQ0.add(vec3(noise3(fQ0.mul(1.9)), noise3(fQ0.mul(1.9).add(17.0)), noise3(fQ0.mul(1.9).add(31.0))).sub(0.5).mul(0.9)));
    const fc = V4(cells3(fQ, float(0.0)));
    // ZGORZELINA jak taśma za F3 (`pasmoTSL.js`, strefa walcowni za ostatnią klatką — te same wzory i liczby, więc w
    // chwili rozdzielenia arkusz wygląda jak taśma klatkę wcześniej):
    //   ŁUSKA WWALCOWANA — wyspy starej łuski sprzed F3 (`fc`, układ masy), pokrycie z ξ resztki (0,15 · ξ przed F3 —
    //     z obrazu pasma w chwili cięcia, `iF.x`);
    //   ŁUSKA NOWA — od zera za F3 (ξ − ξ resztki), wyspy w układzie fizycznym przęsła (λ za F3);
    //   SMUGI WALCOWANIA, PLAMY CIEPLNE — jak na taśmie.
    const xiRem = F1(max(vF.x, 0.0));
    // (runda 9) czyste lico (taśma za stacją odzgorzania): jednolita emisyjność — plamy jasności do ±30 K (`MOTT_CLEAN`)
    const clK0 = F1(cleanWeight(xi.add(xiRem)).mul(float(1.0).sub(isBand)));
    const xiNew = F1(max(xi.sub(xiRem), 0.0));
    const qN0 = V3(vec3(pc.mul(LAM3 * 0.14), latJ.mul(0.12), upJ.mul(0.12).add(11.3)));
    const qN = V3(qN0.add(vec3(noise3(qN0.mul(1.9)), noise3(qN0.mul(1.9).add(17.0)), noise3(qN0.mul(1.9).add(31.0))).sub(0.5).mul(0.9)));
    const fcN = V4(cells3(qN, float(0.0)));
    const coverN = F1(clamp(xiNew.mul(1.2).sub(0.06), 0.0, 0.92));
    const newM = F1(float(1.0).sub(smoothstep(coverN.sub(0.04), coverN.add(0.04), fcN.z)).mul(smoothstep(0.0, 0.22, fcN.y.sub(fcN.x))));
    const coverR = F1(clamp(xiRem.div(XI_KEEP).mul(1.7).sub(0.06), 0.0, 0.92).mul(0.75));
    const remM = F1(float(1.0).sub(smoothstep(coverR.sub(0.03), coverR.add(0.03), fc.z)).mul(smoothstep(0.0, 0.18, fc.y.sub(fc.x))));
    const scaleM = F1(max(newM.mul(clamp(xiNew.mul(2.6), 0.0, 1.0)).mul(0.45), remM));
    const toneN = F1(fract(fcN.z.mul(7.31)).mul(0.5).add(0.75));
    const mott = F1(noise3(vec3(pc.mul(0.028), latJ.mul(0.042), 2.3)).mul(0.7).add(noise3(vec3(pc.mul(0.061), latJ.mul(0.09), 7.9)).mul(0.3)).sub(0.5).mul(1.5));
    const strk = F1(noise3(vec3(latJ.mul(0.28), pc.mul(0.016), 9.1)).sub(0.5));
    const Tl0 = F1(Tu);
    const cold = F1(clamp(float(0.85).sub(Tl0), 0.0, 1.0));
    const scaleDT = F1(max(scaleM.mul(float(0.04).add(cold.mul(0.045))).mul(toneN), remM.mul(float(0.075).add(cold.mul(0.03))))
      .add(xiNew.mul(0.12)).add(strk.mul(0.016)).sub(mott.mul(0.25).mul(mix(float(1.0), float(MOTT_CLEAN), clK0))));
    const latN = F1(clamp(vL.y, -1.0, 1.0));
    const edgeW = F1(latN.mul(latN));
    const mu = F1(clamp(dot(N, V), 0.0, 1.0));
    const Ts = F1(Tl0.add(grain.sub(0.5).mul(0.008)).sub(scaleDT).sub(edgeW.mul(edgeW).mul(edgeW).mul(0.06)));
    // (runda 9) płyta na sztorc pokazuje kamerze gry lica pod kątem ślizgowym: rozżarzony metal świeci prawie jednakowo we
    // wszystkie strony (emisyjność metalu spada dopiero przy ślizgu) — przyciemnienie ślizgowe słabsze niż na taśmie (dla
    // płyty płaskiej oglądanej z góry μ ≈ 1 — bez zmian)
    const TsV = F1(Ts.sub(float(1.0).sub(mu).mul(float(1.0).sub(mu)).mul(0.07)));
    const limb = F1(pow(max(mu, 1e-4), 0.9).mul(0.25).add(0.75));
    const hc = V3(heatColorX(TsV, xcu));
    const gainE = F1(U.t1.x.mul(LM.look.x).mul(U.t4.x).mul(float(0.46).sub(scaleM.mul(0.03))).mul(limb).mul(float(1.0).sub(isBand)));
    const hp = F1(heatPower(TsV).mul(gainE));
    // ŻAR BRZEGÓW CIĘCIA (tył, przód): nadwyżka i szerokość pasa z modelu (√t), świecenie = różnica mocy żaru nad licem,
    // pas węższy od piksela rozciągnięty z zachowaniem energii (bez migotania przy ruchu)
    const px = F1(pxWorld(U.cam, P));
    // (poprawki rundy 8) nadwyżka i pas z WIEKU brzegu, zmiennego wzdłuż brzegu (ognisko przemiatało szerokość taśmy ok.
    // 0,19 s — koniec, od którego zaczęło, jest starszy i chłodniejszy)
    const eB = edgeAt(vE.x, vE.y.add(vS.x.mul(latJ)));
    const eF = edgeAt(vE.z, vE.w.add(vS.y.mul(latJ)));
    const gB = edgeGlow(TsV, eB.E, eB.w, dB, px);
    const gF = edgeGlow(TsV, eF.E, eF.w, dFr, px);
    const edgeE = V3(heatColorX(gB.T, xcu).mul(gB.P).add(heatColorX(gF.T, xcu).mul(gF.P)).mul(gainE));
    // światło: słońce z cieniem naczynia, otoczenie, odblask pokładu; (poprawki rundy 8) w rynnie odpadu — tylko przez
    // szczelinę między koronami (`rynnaTSL.js`: dno w głębokim cieniu, jak dno pod kawałkiem)
    const ndl = F1(max(dot(N, U.sunDir), 0.0));
    const chS = vec2(0.0).toVar();
    chS.assign(chuteShade(U.sunDir, P, N));
    const shadow = F1(vesselShadow(U, P.add(N.mul(6.0))).mul(chS.x));
    const albedoS = V3(mix(vec3(0.06, 0.058, 0.057), vec3(0.034, 0.033, 0.034), scaleM).mul(grain.mul(0.16).add(0.92)).mul(strk.mul(0.4).add(1.0)));
    // opaska paczki: taśma stalowa (jaśniejsza, z żółtym znacznikiem na wierzchu)
    const bandMark = F1(float(1.0).sub(smoothstep(0.08, 0.14, abs(vL.y))).mul(step01(vL.z.sub(0.9))));
    const albedoB = V3(mix(vec3(0.12, 0.122, 0.13), vec3(0.5, 0.33, 0.04), bandMark));
    const albedo = V3(mix(albedoS, albedoB, isBand));
    const diffuse = V3(albedo.mul(U.sunColor.mul(ndl.mul(shadow)).add(U.ambient.mul(N.y.mul(0.3).add(0.7)).add(vec3(0.05, 0.045, 0.04)).mul(chS.y)))
      .mul(mix(float(0.35), float(1.0), max(smoothstep(0.0, 0.35, cold), isBand))));
    const rS = V3(reflect(V.negate(), N));
    const specS = F1(pow(max(dot(rS, U.sunDir), 0.0), mix(float(7.0), float(9.0), isBand)).mul(mix(float(0.035), float(0.25), isBand)).mul(shadow).mul(float(1.0).sub(scaleM.mul(0.6).mul(float(1.0).sub(isBand)))));
    const outc = vec3(0.0).toVar();
    // (runda 9) CZYSTE LICO: waga z tlenku arkusza (ξ z chwili cięcia + łuska wwalcowana z obrazu taśmy) — arkusz z taśmy
    // za stacją odzgorzania jest czysty także po ostygnięciu (w osłonie argonu tlenek nie rośnie); opaski bez zmian
    const clK = clK0;
    const clean = cleanMetal(U, N, V, P, Tl0, xcu, strk, grain, shadow, vec3(0.0), float(0.5));
    outc.assign(hc.mul(hp).add(edgeE).add(mix(diffuse, clean.diffuse.mul(chS.y.mul(0.5).add(0.5)), clK)).add(mix(U.sunColor.mul(specS.mul(chS.x)), clean.spec.mul(chS.x), clK)));
    const lum = dot(outc, LUMA);
    outc.mulAssign(min(float(1.0), float(2.4).div(max(lum, 1e-3))));
    return vec4(max(outc, vec3(0.0)), 1.0);
  })();
  const m = new NodeMaterial();
  m.name = 'DzielenieArkusze';
  m.vertexNode = vertex;
  m.fragmentNode = fragment;
  m.side = THREE.FrontSide;
  m.fog = false;
  m.lights = false;
  m.toneMapped = false;
  return { material: m, attrs: geo };
}

/**
 * Siatka ostrza: pas nad taśmą (x −1…1 — szerokość pasa, z −1…1 — szerokość taśmy z zapasem), 24 × 48 odcinków.
 */
export function createBladeGeometry() {
  // (obraz liczy fragment — wystarczy prostokąt; x −1…1 skaluje się do zasięgu pasa, z −1…1 do lic emiterów)
  const pos = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(3550, -1060, 0), 400);
  return g;
}

/** Lico emitera wózka noża (wewnętrzna ściana, z ±110) — do niego sięgają linie sił. */
const BLADE_HZ = 110;
/** Zasięg siatki ostrza w x poza pasem pola [j.] — ślad szczeliny i ognisko rozciągnięte do piksela z kamery gry. */
const BLADE_EXT = 16;

/**
 * Materiał ostrza pola (addytywny, bez zapisu głębi, `forceSinglePass`). Język powłoki pola i bram: przezroczysta skóra
 * pasa, jasne brzegi pasa, linie sił z lic emiterów zbiegające się w OGNISKU (jedyne HDR — kropla ciekłego metalu w
 * ognisku pola); za ogniskiem świeci szczelina — dwa lica cięcia w temperaturze solidusu, wzorem żaru brzegu
 * (`krawedzTSL.js`, ten sam co tył arkusza i czoło pasma po rozdzieleniu). Jasność pola = moc ostrza z modelu × obecność
 * pasa z fazy krzywki (pas istnieje tylko od zrównania wózków z taśmą do zwinięcia po rozdzieleniu).
 */
export function createBladeMaterial(U, OB, LM) {
  const vQ = varyingProperty('vec3', 'vOsQ');
  const vertex = Fn(() => {
    const p0 = attribute('position', 'vec3');
    const ext = F1(max(OB.B.z, 1.0).add(BLADE_EXT));
    // zasięg w x: pas ostrza, a po rozdzieleniu także szczelina (wózki odjeżdżają od niej)
    const gapOn = F1(step01(OB.D.w.sub(0.5)));
    const x0 = F1(mix(OB.A.x.sub(ext), min(OB.A.x.sub(ext), OB.D.x.sub(BLADE_EXT)), gapOn));
    const x1 = F1(mix(OB.A.x.add(ext), max(OB.A.x.add(ext), OB.D.x.add(BLADE_EXT)), gapOn));
    const xw = F1(mix(x0, x1, p0.x.mul(0.5).add(0.5)));
    const P = V3(vec3(xw, OB.A.y, p0.z.mul(BLADE_HZ)));
    vQ.assign(vec3(xw.sub(OB.A.x), P.z, 0.0));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(P, 1.0)));
  })();
  const fragment = Fn(() => {
    const dx = F1(vQ.x);
    const z = F1(vQ.y);
    const P = V3(vec3(OB.A.x.add(dx), OB.A.y, z));
    const px = F1(pxWorld(U.cam, P));
    const pw = F1(OB.A.w);
    const zF = F1(OB.A.z);
    const sw = F1(OB.B.x);
    const dir = F1(OB.B.y);
    const hw = F1(max(OB.B.z, 1.0));
    const env = F1(OB.B.w);
    const Tb = F1(OB.C.x);
    const E0 = F1(OB.C.y);
    const xcu = F1(OB.C.z);
    const onSweep = F1(step01(sw.add(0.5)));
    // kreska o szerokości wd [j.] w odległości dd — rozciągnięta do piksela z zachowaniem energii (bez migotania)
    const kreska = (dd, wd) => {
      const wv = F1(max(wd, px.mul(0.85)));
      const a = F1(dd.div(wv));
      return exp(a.mul(a).negate()).mul(wd.div(wv));
    };
    // --- PAS POLA: przezroczysta skóra, jasne brzegi (ciągła kreska), poza pasem nic ---
    const ax = F1(abs(dx));
    const inBand = F1(float(1.0).sub(smoothstep(hw.sub(0.6), hw.add(0.6), ax)));
    const rim = F1(kreska(ax.sub(hw), float(0.9)));
    const skin = F1(inBand.mul(0.06));
    // --- LINIE SIŁ: z lica emitera (rozstaw ± pas) zbiegają się w ognisku; t = 0 w ognisku, 1 na licu ---
    const side = F1(step01(z.sub(zF)));
    const zE = F1(mix(float(-BLADE_HZ), float(BLADE_HZ), side));
    const t = F1(clamp(abs(z.sub(zF)).div(max(abs(zE.sub(zF)), 1.0)), 0.0, 1.0));
    const spread = F1(hw.add(4.0).mul(t));
    const q = F1(dx.div(max(spread, 0.05)).mul(3.0));
    const qf = F1(q.sub(floor(q.add(0.5))));
    const fan = F1(kreska(qf.mul(spread).div(3.0), float(0.55)).mul(step01(float(3.4).sub(abs(q)))).mul(smoothstep(0.04, 0.3, t)).mul(0.5));
    // przed ogniskiem (nieprzecięta część) pas słabszy, za nim (szczelina) pełny
    const behind = F1(step01(zF.sub(z).mul(dir)));
    // (nad otwartą szczeliną pole się rozstępuje — lica cięcia widać bez cyjanowej nakładki)
    const parted = F1(exp(dx.div(2.5).mul(dx.div(2.5)).negate()).mul(behind).mul(onSweep).mul(0.85));
    const fieldK = F1(rim.mul(0.5).add(skin).add(fan).mul(mix(float(1.0), mix(float(0.55), float(1.0), behind), onSweep)).mul(float(1.0).sub(parted)));
    const cyan = vec3(0.16, 0.72, 1.0);
    const field = V3(cyan.mul(fieldK.mul(min(pw, 1.5)).mul(env).mul(0.55)));
    // --- SZCZELINA za ogniskiem: dwa lica cięcia (|dx| = 1) w temperaturze solidusu, pas żaru w0 = 1,5 j.; z góry w głąb
    // szczeliny widać lica pod kątem (połowa mocy) ---
    const onStrip = F1(float(1.0).sub(smoothstep(99.0, 101.0, abs(z))));
    const gainE = F1(U.t1.x.mul(LM.look.x).mul(U.t4.x).mul(0.46));
    const dK = F1(max(abs(dx).sub(DZIEL_WK2), 0.0));
    const inSlot = F1(float(1.0).sub(step01(abs(dx).sub(DZIEL_WK2))));
    // (poprawki rundy 8) ŚLAD OGNISKA stygnie za ostrzem: wiek lic = droga ogniska od tego miejsca × C.w (model brzegu
    // √t od chwili przejścia ogniska — przy rozdzieleniu ten sam wiek co brzegi arkusza i czoła pasma, bez skoku)
    const sK = F1(max(zF.sub(z).mul(dir), 0.0).mul(OB.C.w));
    const eK = edgeAt(E0, sK);
    const gK = edgeGlow(Tb, eK.E, eK.w, dK, px);
    const kerf = V3(heatColorX(gK.T, xcu).mul(gK.P.mul(gainE).mul(float(1.0).sub(inSlot.mul(0.5)))).mul(behind.mul(onSweep).mul(onStrip)));
    // --- OGNISKO (HDR): kropla ciekłego metalu w ognisku pola (T̃ ponad likwidusem — pole grzeje), r ≈ 3 j. ---
    const dzF = F1(z.sub(zF));
    const r = F1(sqrt(dx.mul(dx).add(dzF.mul(dzF))));
    const rv = F1(max(float(3.0), px.mul(1.1)));
    const core = F1(exp(r.div(rv).mul(r.div(rv)).negate()).mul(float(3.0).div(rv)).mul(float(3.0).div(rv)));
    const Tf = F1(Tb.add(E0).add(0.12));
    const focus = V3(heatColorX(Tf, xcu).mul(heatPower(Tf).mul(gainE).mul(1.6)).add(vec3(0.75, 0.92, 1.0).mul(min(pw, 1.5).mul(0.9)))
      .mul(core.mul(onSweep).mul(onStrip)));
    // --- SZCZELINA PO ROZDZIELENIU (wąska): między licem czoła pasma a licem tyłu arkusza patrzymy z góry w wąską wnękę
    // o ściankach w temperaturze brzegu (model √t) — dopóki szczelina jest wąska (≤ grubość taśmy), widać lica jak w
    // śladzie szczeliny za ogniskiem (połowa mocy), potem wnęka się otwiera i widać już rynnę pod spodem ---
    const gw = F1(max(OB.D.y, 0.0));
    const gwv = F1(max(gw, px.mul(0.85)));
    const dG = F1(abs(P.x.sub(OB.D.x)));
    const inGap = F1(float(1.0).sub(smoothstep(gwv.mul(0.5).sub(px.mul(0.5)), gwv.mul(0.5).add(px.mul(0.5)), dG)).mul(gw.div(max(gwv, 1e-3))));
    const cav = F1(float(1.0).sub(smoothstep(2.0, 12.0, gw)).mul(0.5).mul(step01(OB.D.w.sub(0.5))));
    const eG = edgeAt(OB.D.z, OB.E.x.add(OB.E.y.mul(z)));
    const Tg = F1(Tb.add(eG.E));
    const gap = V3(heatColorX(Tg, xcu).mul(max(heatPower(Tg).sub(heatPower(Tb)), 0.0).mul(gainE).mul(cav).mul(inGap).mul(onStrip)));
    const c = V3(field.add(kerf).add(focus).add(gap));
    return vec4(c, max(max(c.x, c.y), c.z));
  })();
  const m = new NodeMaterial();
  m.name = 'DzielenieOstrze';
  m.vertexNode = vertex;
  m.fragmentNode = fragment;
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  m.fog = false;
  m.lights = false;
  m.toneMapped = false;
  blendAddytywnePremul(m);
  return m;
}

/** Połowa szerokości szczeliny [j.]. */
const DZIEL_WK2 = 1.0;

/** 1 dla x > 0. */
function step01(x) { return clamp(x.mul(1e6), 0.0, 1.0); }
void fract;
