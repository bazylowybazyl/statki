// dema/autostrada/styl-malowanie.js
//
// STYL „MALOWANIE ŚWIATŁEM” — z góry prawdziwa autostrada namalowana światłem: kreski, krawędzie, STOP i K-7 rozciągnięte jak farba na zdjęciu
// lotniczym, klin zjazdu z szrafurą, ucho węzła. Sygnał to stan nawierzchni: przy czerwonym droga SAMA się przemalowuje pod prąd, kreska po kresce
// (żółta fala, za nią czerwona), w pustym polu K-7 pasy gasną i wschodzą linie radialne, a przy zwolnieniu zielona fala idzie trzy razy wolniej.
//
// Zasady wyglądu (ocena panelu): asfalt L ≤ 0,006 z gradientem od krawędzi, ciemność robi podkład bazy; hierarchia kresek wchodzi z zoomem samą matematyką
// zachowanej całki (`kresa`), drobne pasy dopiero od zoomu ok. 0,3; na jezdni wyłącznie STOP i K-7; pulsacja przepływu ±6%, nierówna jasność kresek i światła
// mijania na asfalcie, żeby wzór nie był martwą mapą. Próg bloomu liczy luminancję (Rec. 709), więc barwy są znormalizowane do luminancji 1, a każda
// linia ma szczyt ≤ 0,84; ponad progiem świeci tylko bar stopu i wieża (lampy z bazy).
//
// AGENT: stan fal jest funkcją (faza, czas fazy) K-7 — liczony co klatkę, bez pamięci poza czasem ostatniego CZYSZCZENIA, więc przełączenie stylu i
// `przewin` w środku sekwencji nic nie psują. Wszystkie gałęzie w shaderze wstęgi to maski (step), bez If — pochodne policzone na początku (pułapki 15, 29).
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, uniformArray, float, vec2, vec3, vec4, max, min, abs, mix, exp, clamp, smoothstep, step, fract, floor, length, sin, cos,
  positionGeometry, positionLocal, modelViewMatrix, varying, fwidth, texture
} from 'three/tsl';
import { U, materialAddytywny, linia, przerywana, sladPikselaW, zaKula } from './wspolne.tsl.js';
import { HW, NODE, DEG, R0, complexes, bays, transits, hubToWorld } from './siec.js';
import { FAZA } from './ruch.js';
import { createCanvas2D } from '../../src/3d/canvas2d.js';
import { resolveRingPlanetWorldRadius } from '../../src/3d/ringScale.js';

const TAU = Math.PI * 2;

// Przekrój jezdni w układzie q: 0 — prawa krawędź (pobocze), 1440 — lewa, przy rozdziale; ten sam na obu jezdniach.
const Q = Object.freeze({
  POBOCZE: HW.iL3 - HW.widths.L3 * 0.5 - HW.edgeIn,   // 400: pobocze | L3
  L3_SR: HW.iL3 - HW.edgeIn,                          // 520: oś L3 (pasma ciężarówek co 26 j.)
  L23: HW.iL2 - HW.widths.L2 * 0.5 - HW.edgeIn,       // 640
  L2_SR: HW.iL2 - HW.edgeIn,                          // 840
  L12: HW.iL1 - HW.widths.L1 * 0.5 - HW.edgeIn,       // 1040
  L1_SR: HW.iL1 - HW.edgeIn,                          // 1240
  LEWA: HW.iL1 + HW.widths.L1 * 0.5 - HW.edgeIn       // 1440
});
const R_WEWN = (HW.edgeIn + HW.iL1 + HW.widths.L1 * 0.5) * 0.5;
const R_ZEWN = (HW.edgeOut + HW.oL1 - HW.widths.L1 * 0.5) * 0.5;
const R_LEWA_W = HW.iL1 + HW.widths.L1 * 0.5;         // 60 940
const R_LEWA_Z = HW.oL1 - HW.widths.L1 * 0.5;         // 62 540

// Wzdłuż drogi liczymy s na promieniu odniesienia: okresy to całkowite dzielniki obwodu, wzór domyka się na obu jezdniach (bez szwu).
const R_REF = 62000;
const L0 = TAU * R_REF;
const P_M = L0 / 304;     // ≈ 1281: kreski granic pasów L1 | L2 | L3
const P_S = L0 / 608;     // ≈ 641: kreski podziału L1 i L2
const P_T = L0 / 4682;    // ≈ 83: pasma ciężarówek w L3
const P_POMOC = L0 / 1216; // ≈ 320: gruba krótka kreska pasa wyhamowania
const P_PULS = L0 / 43;   // ≈ 9060: pulsacja przepływu
const POL_PUDLA = (NODE.boxHalf / HW.median) * R_REF;
const D_STOP_W = (NODE.stopX / HW.iL2) * R_REF;
const D_STOP_Z = (NODE.stopX / HW.oL2) * R_REF;
const STOPIEN = (DEG * R_REF);    // j. odniesienia na stopień kąta

// Fale przemalowania [j./s, j.]: żółta i czerwona 1800, zielona trzy razy wolniej.
const V_FALI = 1800;
const V_ZIELONEJ = 600;
const ZASIEG = 18000;
const ZASIEG_ZOLTEJ = ZASIEG + 3600;
const PAS_ZIELENI = 2200;
const CZAS_ZOLTEGO = 3;
const WYL = -1e5;
const D_K7 = 2900;        // środek napisu K-7 przed linią stopu

// Barwy o luminancji 1 (próg bloomu liczy luminancję, więc L w tabeli to wprost szczyt luminancji).
const BIEL = Object.freeze([0.93, 1.0, 1.18]);
const BIEL_W = Object.freeze([1.08, 0.99, 0.86]);   // jezdnia wewnętrzna: ciepła biel
const BIEL_Z = Object.freeze([0.88, 1.0, 1.26]);    // zewnętrzna: chłodna
const BURSZ = Object.freeze([2.03, 0.79, 0.026]);
const ZOLC = Object.freeze([1.67, 0.90, 0.017]);
const ZIEL = Object.freeze([0.033, 1.33, 0.577]);
const CZER = Object.freeze([4.43, 0.078, 0.031]);
const v3 = (c) => vec3(c[0], c[1], c[2]);
const SUFIT = 0.84;

/** Linia z filtrem `linia` (roofLine) i naprawdę zachowaną całką: węższa niż ~2 px gaśnie zamiast trzymać jasność. */
const kresa = (x, hw, fw) => linia(x, float(hw), fw).mul(min(float(1), float(2 * hw).div(fw)));
const haszN = (n) => fract(sin(n.mul(12.9898)).mul(43758.5453));
const halo = (x, s, fw) => { const sg = max(float(s), fw.mul(1.2)); const u = x.div(sg); return exp(u.mul(u).mul(-0.5)).mul(float(s).div(sg)); };
const miedzy = (x, a, b, fw) => smoothstep(float(a).sub(fw), float(a).add(fw), x).mul(float(1).sub(smoothstep(float(b).sub(fw), float(b).add(fw), x)));

// ---------------------------------------------------------------------------
// Uniformy stylu

const uFale = uniformArray([0, 1, 2, 3].map(() => new THREE.Vector4(WYL, WYL, WYL, 0)), 'vec4').setName('uMalFale');   // x front żółtej, y czerwonej, z zielonej, w pole przemalowane 0…1
const uAtlas = uniform(new THREE.Vector4(1, 0, 0, 0)).setName('uMalAtlas');   // x, y — kierunek promieniowy K-7 Atlasa, z — promień dziobu, w — aktywność

const widocznosc = (poz) => mix(float(1), zaKula(modelViewMatrix.mul(vec4(poz, 1)).xyz, modelViewMatrix.mul(vec4(0, 0, 0, 1)).xyz, max(U.rZiemi, 1)), step(1, U.rZiemi));

// ---------------------------------------------------------------------------
// Wstęga: jeden graf na całą sieć (jezdnie, rozdział, rampy, zawrotki, wrota, pasy K-7, drogi ciężkich, ucho)

const RZ = Object.freeze({ WEWN: 0, ZEWN: 1, ROZDZIAL: 2, ZJAZD: 3, WJAZD: 4, ZAWROTKA: 5, WROTA_WE: 6, WROTA_WY: 7, PUDLO: 8, CIEZKI: 9, UCHO: 10 });

function zbudujMaterialWstegi(ctx) {
  const pole = ctx.pole.tekstura;
  const aSV = attribute('aSV', 'vec2');
  const aMeta = attribute('aMeta', 'vec4');
  const rid = aMeta.x;
  const jestV = (x) => float(1).sub(step(0.5, abs(rid.sub(x))));
  const skalaS = jestV(RZ.WEWN).mul(R_REF / R_WEWN).add(jestV(RZ.ZEWN).mul(R_REF / R_ZEWN)).add(jestV(RZ.ROZDZIAL).mul(R_REF / HW.median)).add(step(2.5, rid));
  const vS = varying(aSV.x.mul(skalaS), 'vMalS');
  const vV = varying(aSV.y, 'vMalV');
  const vM = varying(aMeta, 'vMalM');
  const vP = varying(positionLocal.xy, 'vMalP');
  const vFP = varying(uFale.element(aMeta.w.max(0).add(0.5).toInt()), 'vMalFP');
  const vZa = varying(widocznosc(positionLocal), 'vMalZa');

  const fragment = Fn(() => {
    // Pochodne przed wszystkim (pułapki 15, 29); gałęzi nie ma, same maski.
    const fwV = float(0).toVar();
    fwV.assign(clamp(fwidth(vV), 1e-3, 3000));
    const fwS = float(0).toVar();
    fwS.assign(clamp(fwidth(vS), 1e-3, 3000));
    const rr = float(0).toVar();
    rr.assign(length(vP));
    const rod = vM.x;
    const pol = vM.y;
    const kier = vM.z;
    const jest = (x) => float(1).sub(step(0.5, abs(rod.sub(x))));
    const mW = jest(RZ.WEWN);
    const mZ = jest(RZ.ZEWN);
    const mR = jest(RZ.ROZDZIAL);
    const mJ = mW.add(mZ);
    const czas = U.czas;

    // ---- Układ jezdni i najbliższe K-7 po stronie napływu ----
    const q = float(0).toVar();
    q.assign(pol.add(kier.mul(vV)));
    const kf = floor(vS.div(L0 / 4));
    const k = clamp(kf, 0, 3).toInt();
    const fala = vec4(0).toVar();
    fala.assign(uFale.element(k));
    const stan = float(0).toVar();
    stan.assign(U.sygnaly.element(k).x);
    const sOs = float(0).toVar();
    sOs.assign(kf.add(0.5).mul(L0 / 4));
    const dOsZ = float(0).toVar();           // ze znakiem [j. odn.], + w stronę θ
    dOsZ.assign(vS.sub(sOs));
    const sStop = float(0).toVar();
    sStop.assign(sOs.sub(kier.mul(mix(float(D_STOP_W), float(D_STOP_Z), mZ))));
    const d = float(0).toVar();              // pod prąd od linii stopu
    d.assign(kier.mul(sStop.sub(vS)));
    const wPudle = float(1).sub(smoothstep(POL_PUDLA - 40, POL_PUDLA + 40, abs(dOsZ))).toVar();

    // ---- Fale: x żółta, y czerwona, z pas zieleni za czołem ----
    const odcien = (dX, m) => {
      const przod = step(0, dX);
      const nad = smoothstep(fala.z, fala.z.add(m), dX);
      const cz = przod.mul(float(1).sub(smoothstep(fala.y.sub(m), fala.y, dX))).mul(nad);
      const zl = przod.mul(float(1).sub(smoothstep(fala.x.sub(m), fala.x, dX))).mul(nad).mul(float(1).sub(cz));
      const zi = przod.mul(float(1).sub(smoothstep(fala.z.sub(m), fala.z, dX))).mul(smoothstep(fala.z.sub(PAS_ZIELENI), fala.z.sub(PAS_ZIELENI * 0.25), dX));
      return vec3(zl, cz, zi);
    };
    const zar = mix(float(0.42), float(1), exp(max(d, 0).div(5200).negate())).toVar();
    const barwa = (t, baza) => baza.mul(float(1).sub(t.x).sub(t.y).sub(t.z).max(0))
      .add(v3(ZOLC).mul(t.x).mul(0.55)).add(v3(CZER).mul(t.y).mul(zar).mul(0.42)).add(v3(ZIEL).mul(t.z).mul(0.5));
    const barwaK = (t, baza) => baza.mul(float(1).sub(t.x).sub(t.y).sub(t.z).max(0))
      .add(v3(ZOLC).mul(t.x).mul(0.45)).add(v3(CZER).mul(t.y).mul(zar).mul(0.17)).add(v3(ZIEL).mul(t.z).mul(0.42));
    const barwaH = (t, baza) => baza.mul(float(1).sub(t.x).sub(t.y).sub(t.z).max(0))
      .add(v3(ZOLC).mul(t.x).mul(0.22)).add(v3(CZER).mul(t.y).mul(zar).mul(0.07)).add(v3(ZIEL).mul(t.z).mul(0.16));
    const tC = vec3(0).toVar();
    tC.assign(odcien(d, float(240)));

    // Kreski granic pasów przemalowują się w całości: jedna kreska = jeden odcień, front skacze kreska po kresce. Druga linia z połówkowym przesunięciem.
    const sA = vS;
    const nA = floor(sA.div(P_M)).toVar();
    const dA = kier.mul(sStop.sub(nA.add(0.5).mul(P_M))).toVar();
    const tA = vec3(0).toVar();
    tA.assign(odcien(dA, float(P_M * 0.16)).mul(step(0, d)));
    const sB = vS.add(P_M * 0.5);
    const nB = floor(sB.div(P_M)).toVar();
    const dB = kier.mul(sStop.sub(nB.add(0.5).mul(P_M).sub(P_M * 0.5))).toVar();
    const tB = vec3(0).toVar();
    tB.assign(odcien(dB, float(P_M * 0.16)).mul(step(0, d)));

    // ---- Struktura z bliska: koraliki LED (średnia 1), pulsacja przepływu ±6% z prądem, nierówna jasność kresek (gaśnie, gdy kreska mała) ----
    const blisko = float(1).sub(smoothstep(0.6, 2, fwS)).toVar();
    const koral = mix(float(1), float(0.68).add(przerywana(vS, 6, 0.5, fwS).mul(0.64)), blisko).toVar();
    const puls = (v) => float(1).add(sin(kier.mul(vS).sub(czas.mul(v)).div(P_PULS).mul(TAU)).mul(0.06));
    const nierowno = (n) => mix(float(1), float(0.84).add(haszN(n).mul(0.28)), smoothstep(3, 9, float(P_M / 3).div(fwS)));
    const rura = (x, hw) => mix(float(1), float(1).sub(clamp(x.div(hw), 0, 1).mul(clamp(x.div(hw), 0, 1)).mul(0.42)), float(1).sub(smoothstep(hw * 0.25, hw * 0.5, fwV)));

    // Gęstość ruchu z pola: jasność asfaltu i lekko kresek (rząd pola z q, jeden odczyt z filtrem liniowym).
    const rzad = clamp(float(Q.L1_SR).sub(q).div(400), 0, 1).add(clamp(float(Q.L2_SR).sub(q).div(320), 0, 1));
    const pr = texture(pole, vec2(vS.div(L0), mZ.mul(3).add(rzad).add(0.5).div(6))).level(0).toVar();
    const gest = clamp(pr.r.mul(5), 0, 1).toVar();

    const pudloOn = fala.w.mul(wPudle).toVar();

    // ---- Jezdnia: krawędzie i kreski ----
    const em = vec3(0).toVar();
    const bazaB = mix(v3(BIEL_W), v3(BIEL_Z), mZ).toVar();
    const bazaB2 = v3(BURSZ);
    // Długie linie nie są równe: wolna nierówność wzdłuż (całkowite krotności obwodu, bez szwu), jak na długim naświetlaniu.
    const fazaS = vS.div(L0).mul(TAU).toVar();
    const wahanie = float(1).add(sin(fazaS.mul(37).add(kier.mul(1.3))).mul(0.14)).add(sin(fazaS.mul(101).add(2.1)).mul(0.09)).toVar();
    // Wyloty ramp przerywają prawą krawędź, pas wyhamowania ma grubą krótką kreskę zamiast ciągłej.
    const kat = abs(dOsZ).div(STOPIEN).toVar();
    const nazew = mZ;
    const ustaZatoka = float(1).sub(smoothstep(1.3, 1.5, abs(kat.sub(NODE.bay)))).toVar();
    const ustaTranzyt = smoothstep(45 - 1.15, 45 - 1.0, kat);
    const ustaWrota = float(1).sub(smoothstep(0.55, 0.7, abs(kat.sub(NODE.dIn + 0.55))));
    const usta = mix(ustaZatoka.add(ustaTranzyt), ustaWrota, nazew).clamp(0, 1).toVar();
    const pomocZatoka = float(1).sub(smoothstep(4.6, 4.9, abs(kat.sub(NODE.bay))));
    const pomocTranzyt = smoothstep(45 - 4.5, 45 - 4.2, kat);
    const pomocWrota = miedzy(kat, NODE.dIn, NODE.dIn + 4.4, float(0.05));
    const pomoc = mix(pomocZatoka.add(pomocTranzyt), pomocWrota, nazew).clamp(0, 1).toVar();
    // Ostatnie metry przed stopem linie są ciągłe, jak na prawdziwej drodze.
    const ciagla = float(1).sub(smoothstep(680, 760, d)).mul(step(0, d)).toVar();
    const drobne = float(1).sub(smoothstep(7, 12, fwV)).toVar();
    const drobniutkie = float(1).sub(smoothstep(2.6, 5, fwV)).toVar();

    const bezPudla = float(1).sub(pudloOn.mul(0.92)).toVar();
    const bezUst = float(1).sub(usta).toVar();
    const xPrawa = abs(q).toVar();
    const lPrawa = kresa(q, 8, fwV).mul(rura(xPrawa, 8)).mul(koral).mul(puls(800)).mul(wahanie).mul(0.3).add(kresa(q.sub(30), 1.6, fwV).mul(drobne).mul(0.14));
    const hPrawa = halo(q, 60, fwV).mul(0.024).add(halo(q, 240, fwV).mul(0.006));
    em.addAssign(barwaK(tC, bazaB).mul(min(lPrawa, SUFIT).mul(bezUst).mul(bezPudla)));
    em.addAssign(barwaH(tC, bazaB).mul(hPrawa.mul(bezUst).mul(bezPudla)));
    const xLewa = q.sub(Q.LEWA).toVar();
    const lLewa = kresa(xLewa, 5, fwV).mul(koral).mul(puls(1500)).mul(wahanie).mul(0.15);
    const hLewa = halo(xLewa, 44, fwV).mul(0.012).add(halo(xLewa, 170, fwV).mul(0.0026));
    em.addAssign(barwaK(tC, bazaB2).mul(min(lLewa, SUFIT).mul(bezPudla)));
    em.addAssign(barwaH(tC, bazaB2).mul(hLewa.mul(bezPudla)));
    const lPobC = kresa(q.sub(Q.POBOCZE), 3, fwV).mul(0.15);
    const lPobP = kresa(q.sub(Q.POBOCZE), 6, fwV).mul(przerywana(vS, P_POMOC, 0.5, fwS)).mul(0.32);
    const lPob = mix(lPobC, lPobP, pomoc).mul(bezPudla);
    em.addAssign(barwa(tC, bazaB).mul(min(lPob, SUFIT)));

    // Granice pasów. Pod napisem K-7 kreska L1 | L2 ma przerwę (suma farby nie wchodzi w próg).
    const pozaNapisem = smoothstep(800, 900, abs(d.sub(D_K7))).mul(float(1).sub(miedzy(d, 170, 1250, float(30)))).toVar();
    const przerK7 = pozaNapisem;
    const wzA = max(przerywana(sA, P_M, 1 / 3, fwS.add(44)), ciagla).toVar();
    const xA = abs(q.sub(Q.L12)).toVar();
    const lA = kresa(xA, 5.5, fwV).mul(wzA).mul(przerK7).mul(rura(xA, 5.5)).mul(koral).mul(nierowno(nA.add(1.7))).mul(puls(1350)).mul(gest.mul(0.25).add(1)).mul(bezPudla);
    const blyskA = exp(max(fala.y.sub(dA), 0).div(P_M * 1.4).negate()).mul(tA.y).mul(0.45);
    em.addAssign(barwa(tA, bazaB).mul(min(lA.mul(0.46).mul(blyskA.add(1)), SUFIT)));
    const hA = halo(xA, 30, fwV).mul(przerywana(sA, P_M, 1 / 3, fwS.add(70))).mul(przerK7).mul(0.026).mul(bezPudla);
    em.addAssign(barwaH(tA, bazaB).mul(hA));
    const wzB = max(przerywana(sB, P_M, 1 / 3, fwS.add(44)), ciagla).toVar();
    const xB = abs(q.sub(Q.L23)).toVar();
    const lB = kresa(xB, 5.5, fwV).mul(wzB).mul(rura(xB, 5.5)).mul(koral).mul(nierowno(nB.add(5.3))).mul(puls(1000)).mul(gest.mul(0.25).add(1)).mul(bezPudla);
    const blyskB = exp(max(fala.y.sub(dB), 0).div(P_M * 1.4).negate()).mul(tB.y).mul(0.45);
    em.addAssign(barwa(tB, bazaB).mul(min(lB.mul(0.46).mul(blyskB.add(1)), SUFIT)));
    const hB = halo(xB, 30, fwV).mul(przerywana(sB, P_M, 1 / 3, fwS.add(70))).mul(0.026).mul(bezPudla);
    em.addAssign(barwaH(tB, bazaB).mul(hB));

    // Kocie oczy w przerwach kresek (zachowana powierzchnia: z daleka nikną).
    const oko = (x, s) => {
      const u = fract(s.div(P_M).sub(0.64).add(0.5)).sub(0.5).mul(P_M);
      const sg = max(float(3.2), max(fwV, fwS).mul(0.8));
      const e = float(3.2).div(sg);
      const r2 = u.mul(u).add(x.mul(x));
      return exp(r2.div(sg.mul(sg)).mul(-0.5)).mul(e).mul(e).add(exp(r2.div(sg.mul(sg).mul(16)).mul(-0.5)).mul(e).mul(e).mul(0.05));
    };
    em.addAssign(v3(BIEL).mul(oko(xA, sA).add(oko(xB, sB)).mul(0.5).mul(bezPudla)));

    // Drobne: podział L1 i L2 od zoomu ~0,12, pasma ciężarówek w L3 i tarka pobocza od ~0,3 (całka zachowana, bez skoku).
    const wzS = max(przerywana(vS.add(P_S * 0.25), P_S, 1 / 3, fwS), ciagla).toVar();
    const lS = kresa(q.sub(Q.L2_SR), 1.8, fwV).add(kresa(q.sub(Q.L1_SR), 1.8, fwV)).mul(wzS).mul(pozaNapisem).mul(drobne).mul(0.24).mul(bezPudla);
    em.addAssign(barwa(tC, bazaB).mul(min(lS, SUFIT)));
    const tq = q.sub(Q.L3_SR).toVar();
    const tf = fract(tq.div(26).add(0.5)).sub(0.5).mul(26);
    const lT = kresa(tf, 0.5, fwV).mul(float(1).sub(smoothstep(100, 108, abs(tq)))).mul(przerywana(vS.add(floor(tq.div(26)).mul(P_T * 0.37)), P_T, 1 / 3, fwS)).mul(drobniutkie).mul(0.26).mul(bezPudla);
    em.addAssign(barwa(tC, bazaB).mul(min(lT, SUFIT)));
    const tarka = kresa(q.sub(58), 14, fwV).mul(przerywana(vS, 42, 0.36, fwS)).mul(drobniutkie).mul(0.08).mul(bezUst).mul(bezPudla);
    em.addAssign(bazaB.mul(tarka));

    em.mulAssign(mJ);

    // ---- Linia stopu: wypełnienie ≤ 0,8 (rdzeń ponad progiem to bar lamp z bazy) i pas czoła fali przez całą jezdnię ----
    const naJezdni = miedzy(q, 0, Q.LEWA, fwV.mul(0.5)).mul(mJ).toVar();
    const barL = kresa(d.sub(18), 18, fwS).mul(naJezdni);
    const stCz = step(1.5, stan);
    const stZo = step(0.5, stan).mul(float(1).sub(stCz));
    const barZiel = float(1).sub(step(1.5, stan)).mul(float(1).sub(stZo)).mul(step(0, fala.z)).mul(float(1).sub(smoothstep(4000, 9000, fala.z)));
    const barKol = v3(BIEL).mul(0.007).add(v3(ZOLC).mul(stZo).mul(0.42)).add(v3(CZER).mul(stCz).mul(0.18)).add(v3(ZIEL).mul(barZiel).mul(0.3));
    em.addAssign(barKol.mul(barL));
    const pasFali = (f, sig) => { const u = d.sub(f).div(sig); return exp(u.mul(u).mul(-0.5)).mul(step(0, d)); };
    em.addAssign(v3(CZER).mul(pasFali(fala.y, 340).mul(float(1).sub(smoothstep(ZASIEG - 800, ZASIEG, fala.y))).mul(0.013)).mul(naJezdni));
    em.addAssign(v3(ZOLC).mul(pasFali(fala.x, 300).mul(float(1).sub(smoothstep(ZASIEG_ZOLTEJ - 800, ZASIEG_ZOLTEJ, fala.x))).mul(0.018)).mul(naJezdni));
    em.addAssign(v3(ZIEL).mul(pasFali(fala.z, 240).mul(step(0, fala.z)).mul(0.016)).mul(naJezdni));

    // ---- Asfalt: gradient od krawędzi, ciemność robi podkład ----
    const gr = exp(q.div(230).negate()).add(exp(float(Q.LEWA).sub(q).div(230).negate())).toVar();
    const poboczeK = mix(float(0.5), float(1), smoothstep(390, 410, q));
    const asfL = float(0.0022).add(gr.mul(0.0038)).mul(poboczeK).mul(gest.mul(0.8).add(1)).mul(puls(1200)).toVar();
    const barwaAsf = vec3(0.78, 0.92, 1.28);
    const naglow = gr.mul(0.6).add(0.4).toVar();
    const asfalt = barwaAsf.mul(asfL)
      .add(v3(CZER).mul(tC.y).mul(zar).mul(0.002).mul(naglow))
      .add(v3(ZOLC).mul(tC.x).mul(0.0014).mul(naglow))
      .add(v3(ZIEL).mul(tC.z).mul(0.0009).mul(naglow))
      .add(v3(CZER).mul(pr.b.mul(5).clamp(0, 1)).mul(0.0012));
    em.addAssign(asfalt.mul(naJezdni));

    // ---- Pole K-7: kratka (żółknie przy żółtym i czyszczeniu), pas rozdziału w polu ustępuje asfaltowi ----
    const wlasny = mW.mul(step(HW.edgeIn, rr)).mul(float(1).sub(step(R_LEWA_W, rr)))
      .add(mR.mul(step(R_LEWA_W, rr)).mul(float(1).sub(step(R_LEWA_Z, rr))))
      .add(mZ.mul(step(R_LEWA_Z, rr)).mul(float(1).sub(step(HW.edgeOut, rr)))).toVar();
    const fwH = fwS.add(fwV);
    const krat = max(przerywana(vS.add(rr), 520, 0.016, fwH), przerywana(vS.sub(rr), 520, 0.016, fwH));
    const kratJ = float(0.003).add(step(0.5, stan).mul(float(0.13).sub(fala.w.mul(0.1))));
    em.addAssign(v3(ZOLC).mul(krat.mul(kratJ).mul(wPudle).mul(wlasny)));
    em.addAssign(barwaAsf.mul(0.0034).mul(wPudle).mul(mR).mul(wlasny));

    // ---- Pasy K-7 (promieniowe): duch stale, w fazie przejazdu pełne linie, szewrony i królik; pas Atlasa jaśniejszy przed dziobem ----
    const mP = jest(RZ.PUDLO);
    const xP = abs(vV).toVar();
    const zasiegP = float(1).sub(smoothstep(65000, 70000, rr)).mul(smoothstep(HW.redaOuter - 5300, HW.redaOuter - 5000, rr)).toVar();
    const on = vFP.w.toVar();
    const rx = uAtlas.x;
    const ry = uAtlas.y;
    const xHub = vP.y.mul(rx).sub(vP.x.mul(ry));
    const pasAtlasa = float(1).sub(smoothstep(700, 760, abs(xHub.sub(NODE.boxLanes[1])))).mul(step(1, vP.x.mul(rx).add(vP.y.mul(ry)))).mul(uAtlas.w).toVar();
    const przedDziobem = smoothstep(uAtlas.z.sub(300), uAtlas.z.add(300), rr);
    const mnozAtlas = mix(float(1), mix(float(0.34), float(1.5), przedDziobem), pasAtlasa).toVar();
    const lPB = kresa(xP.sub(pol), 5, fwV).mul(on.mul(pasAtlasa.mul(0.17).add(0.05)).add(0.01)).add(halo(xP.sub(pol), 50, fwV).mul(on).mul(0.008));
    const szew = przerywana(vS.add(xP.mul(0.8)), 1500, 0.014, fwS.add(fwV)).mul(float(1).sub(smoothstep(pol.sub(160), pol.sub(100), xP))).mul(on).mul(pasAtlasa).mul(przedDziobem).mul(0.12);
    const krolik = przerywana(vS.sub(czas.mul(3000)), 3000, 0.007, fwS).mul(float(1).sub(smoothstep(pol.sub(40), pol, xP))).mul(on).mul(pasAtlasa.mul(0.12).add(0.05));
    const osP = kresa(vV, 2, fwV).mul(przerywana(vS, 640, 1 / 3, fwS)).mul(on.mul(0.08).add(0.004));
    em.addAssign(v3(BIEL).mul(lPB.add(osP)).add(v3(ZIEL).mul(szew)).add(vec3(1.05, 1.0, 0.86).mul(krolik)).mul(mnozAtlas).mul(zasiegP).mul(mP));
    em.addAssign(barwaAsf.mul(0.0028).mul(float(1).sub(smoothstep(pol.sub(20), pol.add(20), xP))).mul(on).mul(zasiegP).mul(mP));

    // ---- Rampy, zawrotki, wrota, ucho: krawędzie, oś, asfalt; na samej jezdni tylko gruba przerywana lewego brzegu ----
    const mRampW = jest(RZ.ZJAZD).add(jest(RZ.WJAZD));
    const mRampZ = jest(RZ.WROTA_WE).add(jest(RZ.WROTA_WY));
    const mU = jest(RZ.ZAWROTKA);
    const mUcho = jest(RZ.UCHO);
    const poza = mRampW.mul(float(1).sub(step(HW.edgeIn, rr)))
      .add(mRampZ.add(mUcho).mul(step(HW.edgeOut, rr)))
      .add(mU.mul(step(R_LEWA_W, rr)).mul(float(1).sub(step(R_LEWA_Z, rr)))).toVar();
    const mRampa = mRampW.add(mRampZ).add(mU).add(mUcho).toVar();
    const zanikWrot = mix(float(1), float(1).sub(smoothstep(71000, 80000, rr)), mRampZ).toVar();
    const xR = abs(vV).toVar();
    const lRampy = kresa(xR.sub(pol), 5, fwV).mul(koral).mul(mix(float(0.22), float(0.17), mUcho)).add(halo(xR.sub(pol), 44, fwV).mul(0.012));
    const osR = kresa(vV, 1.8, fwV).mul(przerywana(vS, 640, 1 / 3, fwS)).mul(0.14);
    const wnetrzeR = float(1).sub(smoothstep(pol.sub(10), pol.add(10), xR)).toVar();
    const gr2 = exp(pol.sub(xR).div(70).negate());
    const kolJ = v3(BIEL).mul(lRampy.add(osR)).add(barwaAsf.mul(wnetrzeR.mul(gr2.mul(0.004).add(0.0022))));
    em.addAssign(kolJ.mul(poza).mul(zanikWrot).mul(mRampa));
    // Na jezdni: lewy brzeg (v > 0 po lewej od kierunku jazdy) grubą krótką kreską.
    const lewyNaJezdni = kresa(vV.sub(pol), 5, fwV).mul(przerywana(vS, P_POMOC, 0.5, fwS)).mul(0.26).mul(float(1).sub(poza));
    em.addAssign(v3(BIEL).mul(lewyNaJezdni).mul(mRampW.add(mRampZ).add(mU)));
    // Wjazd z głębi: królik „do mnie” 1 Hz po drabinie poprzeczek; zjazd bez królika.
    const mWe = jest(RZ.WROTA_WE);
    const drabina = przerywana(vS, 2400, 0.018, fwS).mul(0.05).add(przerywana(vS.sub(czas.mul(2400)), 2400, 0.024, fwS).mul(0.22));
    const zDrabina = drabina.mul(wnetrzeR).mul(smoothstep(HW.edgeOut + 1600, HW.edgeOut + 2400, rr)).mul(zanikWrot).mul(mWe);
    em.addAssign(v3(BIEL).mul(zDrabina));

    // ---- Drogi ciężkich przed halą: ledwie duch ----
    const mC = jest(RZ.CIEZKI);
    em.addAssign(v3(BIEL).mul(kresa(abs(vV).sub(pol), 7, fwV).mul(0.028)).mul(float(1).sub(step(HW.edgeIn, rr))).mul(mC));

    return vec4(clamp(em.mul(vZa), vec3(0), vec3(12)), 1);
  });
  return materialAddytywny(fragment(), null, 'malowanie-wstega');
}

// ---------------------------------------------------------------------------
// Ucho węzła: pętla 270° za krawędzią zewnętrzną (po jednej na K-7, po stronie −θ, bez kolizji z wrotami), ten sam przekrój i ten sam graf co rampy.
// AGENT: ucho to na razie sam obraz, ruch z niego nie korzysta (sieć wspólna go nie zna).

const R_UCHA = 2800;
const POL_UCHA = 170;

function zbudujUszy() {
  const pos = [];
  const sv = [];
  const meta = [];
  const idx = [];
  const dodajWstege = (xs, ys, ss) => {
    const n = xs.length;
    const start = pos.length / 3;
    const m = POL_UCHA + 260;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const l = Math.hypot(xs[b] - xs[a], ys[b] - ys[a]) || 1;
      const nx = -(ys[b] - ys[a]) / l;
      const ny = (xs[b] - xs[a]) / l;
      for (const bok of [1, -1]) {
        pos.push(xs[i] + nx * m * bok, ys[i] + ny * m * bok, 0);
        sv.push(ss[i], m * bok);
        meta.push(RZ.UCHO, POL_UCHA, 1, -1);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = start + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  for (const c of complexes()) {
    const a = c - NODE.bay;
    const dist = HW.oShoulder + R_UCHA;
    const cx = R_UCHA;
    const rz = Math.sqrt(dist * dist - cx * cx);
    const cz = rz - R0;
    const xs = [];
    const ys = [];
    const ss = [];
    let s = 0;
    const dopisz = (x, z) => {
      const p = hubToWorld(a, x, z);
      if (xs.length) s += Math.hypot(p.x - xs[xs.length - 1], p.y - ys[ys.length - 1]);
      xs.push(p.x); ys.push(p.y); ss.push(s);
    };
    // Dobieg po poboczu: 1,5 tys. j. przed styczną.
    const katS = Math.atan2(cx, rz) / DEG;
    for (let i = 0; i <= 12; i++) {
      const th = a + katS - ((12 - i) * 125) / HW.oShoulder / DEG;
      const p = { x: HW.oShoulder * Math.cos(th * DEG), y: HW.oShoulder * Math.sin(th * DEG) };
      if (xs.length) s += Math.hypot(p.x - xs[xs.length - 1], p.y - ys[ys.length - 1]);
      xs.push(p.x); ys.push(p.y); ss.push(s);
    }
    // Styczna w hubie: od kierunku ku środkowi Ziemi, przez 270°, do osi x = 0.
    const fi0 = Math.atan2(-rz / dist, -cx / dist) + TAU;
    const fi1 = Math.PI + TAU;
    const n = 120;
    for (let i = 1; i <= n; i++) {
      const f = fi0 + ((fi1 - fi0) * i) / n;
      dopisz(cx + R_UCHA * Math.cos(f), cz + R_UCHA * Math.sin(f));
    }
    // Prosta ku drodze.
    const zK = HW.edgeOut + 160 - R0;
    for (let i = 1; i <= 6; i++) dopisz(0, cz + ((zK - cz) * i) / 6);
    dodajWstege(xs, ys, ss);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aSV', new THREE.BufferAttribute(new Float32Array(sv), 2));
  g.setAttribute('aMeta', new THREE.BufferAttribute(new Float32Array(meta), 4));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  return g;
}

function zbudujPodkladUszu(geom) {
  // Jak podkład bazy (mnożenie nieba), ale bazowy zna tylko wstęgi sieci.
  const aSV = attribute('aSV', 'vec2');
  const aMeta = attribute('aMeta', 'vec4');
  const vV = varying(aSV.y, 'vMalPdV');
  const vPol = varying(aMeta.y, 'vMalPdP');
  const vZa = varying(widocznosc(positionLocal), 'vMalPdZ');
  const vP = varying(positionLocal.xy, 'vMalPdR');
  const alfa = float(1).sub(smoothstep(vPol, vPol.add(120), abs(vV))).mul(step(HW.edgeOut, length(vP))).mul(0.62).mul(vZa);
  const m = new THREE.NodeMaterial();
  m.name = 'malowanie-podklad-uszu';
  m.lights = false;
  m.fog = false;
  m.transparent = false;
  m.depthWrite = false;
  m.depthTest = false;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.ZeroFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.fragmentNode = vec4(0, 0, 0, alfa);
  const mesh = new THREE.Mesh(geom, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = 'MalowaniePodkladUszu';
  return mesh;
}

// ---------------------------------------------------------------------------
// Kliny zjazdów: szrafura między ramieniem rampy a krawędzią (zatoki i tranzyty — wyspa między zjazdem a wjazdem; wrota — trójkąt jednostronny)

function zbudujKliny() {
  const pos = [];
  const lok = [];
  const idx = [];
  const pasek = (a, rzedy) => {
    const start = pos.length / 3;
    for (const q of rzedy) {
      for (const x of [q.xL, q.xR]) {
        const p = hubToWorld(a, x, q.z);
        pos.push(p.x, p.y, 0);
        lok.push(x, q.z, q.fade);
      }
    }
    for (let i = 0; i < rzedy.length - 1; i++) {
      const b = start + i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  };
  const R = NODE.turnR;
  const rb = R + 170;
  const wyspa = (a, X) => {
    const cx = X + R;
    const dist = HW.iShoulder - R;
    const rz = Math.sqrt(dist * dist - cx * cx);
    const cz = rz - R0;
    const zGora = cz + rb - 1;
    const zDol = cz - 1200;
    const rzedy = [];
    for (let z = zGora; z >= zDol; z -= 30) {
      const dz = z - cz;
      const xb = z >= cz ? cx - Math.sqrt(Math.max(rb * rb - dz * dz, 0)) : X - 170;
      const fade = Math.min(1, Math.max(0, (z - zDol) / 900));
      rzedy.push({ xL: -xb, xR: xb, z, fade });
    }
    pasek(a, rzedy);
  };
  for (const a of bays()) wyspa(a, NODE.spurX);
  for (const a of transits()) wyspa(a, NODE.tSpurX);
  // Wrota: rampa w promieniu dTurnR, klin po stronie odległej od rampy.
  const Rg = NODE.dTurnR;
  const rbg = Rg + 170;
  const klinWrot = (a, znak) => {
    const dist = HW.oShoulder + Rg;
    const cx = Rg;
    const rz = Math.sqrt(dist * dist - cx * cx);
    const cz = rz - R0;
    const zE = HW.edgeOut - R0;
    const zT = cz + 260;
    const rzedy = [];
    for (let z = zE; z <= zT; z += 30) {
      const dz = z - cz;
      const xb = z <= cz ? -Rg + Math.sqrt(Math.max(rbg * rbg - dz * dz, 0)) : 170;
      const xw = 1500 + ((170 - 1500) * (z - zE)) / (zT - zE);
      if (xw <= xb) break;
      rzedy.push({ xL: znak * xb, xR: znak * xw, z, fade: 1 });
    }
    if (rzedy.length > 1) pasek(a, rzedy);
  };
  for (const c of complexes()) {
    klinWrot(c + NODE.dOut, 1);
    klinWrot(c + NODE.dIn, -1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aKlin', new THREE.BufferAttribute(new Float32Array(lok), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));

  const aK = attribute('aKlin', 'vec3');
  const vK = varying(aK, 'vMalK');
  const vZa = varying(widocznosc(positionLocal), 'vMalKZ');
  const fragment = Fn(() => {
    const u = abs(vK.x).add(vK.y).toVar();
    const fw = float(0).toVar();
    fw.assign(clamp(fwidth(u), 1e-3, 3000));
    const wz = przerywana(u, 150, 0.26, fw);
    return vec4(clamp(v3(BIEL).mul(wz.mul(vK.z).mul(0.24).mul(vZa)), vec3(0), vec3(1)), 1);
  });
  const mesh = new THREE.Mesh(g, materialAddytywny(fragment(), null, 'malowanie-kliny'));
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'MalowanieKliny';
  return mesh;
}

// ---------------------------------------------------------------------------
// Atlas napisów: R — pole odległości (ostro z bliska), G — pokrycie z mipmapami (z daleka). Jeden wariant, rozciągany wzdłuż jazdy jak farba.

const ATLAS_N = 1024;
const ROZLEW = 26;
const KOM = Object.freeze({
  STOP: Object.freeze([0, 0, 1, 0.5]),
  K7: Object.freeze([0, 0.5, 0.5, 1]),
  STRZ_P: Object.freeze([0.5, 0.5, 0.75, 1]),
  STRZ_L: Object.freeze([0.75, 0.5, 1, 1])
});

function przejscieOdl(f, n, d, v, z) {
  const INF = 1e20;
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let p = v[k];
    let s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
    while (s <= z[k]) {
      k--;
      p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}
function odleglosci(maska, N, wartoscCelu) {
  const INF = 1e20;
  const pole = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) pole[i] = maska[i] === wartoscCelu ? 0 : INF;
  const f = new Float64Array(N);
  const d = new Float64Array(N);
  const v = new Int32Array(N);
  const z = new Float64Array(N + 1);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) f[y] = pole[y * N + x];
    przejscieOdl(f, N, d, v, z);
    for (let y = 0; y < N; y++) pole[y * N + x] = d[y];
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) f[x] = pole[y * N + x];
    przejscieOdl(f, N, d, v, z);
    for (let x = 0; x < N; x++) pole[y * N + x] = d[x];
  }
  return pole;
}

function zbudujAtlas() {
  const N = ATLAS_N;
  const pl = createCanvas2D(N, N);
  const c = pl.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#000';
  c.fillRect(0, 0, N, N);
  c.fillStyle = '#fff';
  c.strokeStyle = '#fff';
  const naKomorke = (tekst, kom, grubosc = 0) => {
    const margin = ROZLEW + 6;
    const x0 = kom[0] * N + margin;
    const y0 = kom[1] * N + margin;
    const w = (kom[2] - kom[0]) * N - margin * 2;
    const h = (kom[3] - kom[1]) * N - margin * 2;
    c.save();
    c.font = '900 300px "Bahnschrift SemiBold Condensed", "Arial Narrow", Arial, sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    const m = c.measureText(tekst);
    const tw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const th = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    c.setTransform(w / tw, 0, 0, h / th, x0 + (m.actualBoundingBoxLeft * w) / tw, y0 + (m.actualBoundingBoxAscent * h) / th);
    if (grubosc) {
      c.lineWidth = grubosc;
      c.lineJoin = 'round';
      c.strokeText(tekst, 0, 0);
    }
    c.fillText(tekst, 0, 0);
    c.restore();
  };
  naKomorke('STOP', KOM.STOP, 6);
  naKomorke('K-7', KOM.K7, 6);
  // Strzałka zjazdu: trzon prosto, ostatnia część odchylona w bok (komórka 256 × 512; z = kierunek jazdy w górę).
  const strzalka = (kom, znak) => {
    const x0 = kom[0] * N;
    const y0 = kom[1] * N;
    const w = (kom[2] - kom[0]) * N;
    const h = (kom[3] - kom[1]) * N;
    const X = (u) => x0 + w * (0.5 + znak * u);
    const Y = (v) => y0 + h * v;
    c.lineWidth = w * 0.16;
    c.lineJoin = 'round';
    c.lineCap = 'butt';
    c.beginPath();
    c.moveTo(X(-0.2), Y(0.94));
    c.lineTo(X(-0.2), Y(0.46));
    c.lineTo(X(0.14), Y(0.24));
    c.stroke();
    c.beginPath();
    c.moveTo(X(0.36), Y(0.07));
    c.lineTo(X(0.27), Y(0.36));
    c.lineTo(X(-0.02), Y(0.15));
    c.closePath();
    c.fill();
  };
  strzalka(KOM.STRZ_P, 1);
  strzalka(KOM.STRZ_L, -1);

  const obraz = c.getImageData(0, 0, N, N).data;
  const maska = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) maska[i] = obraz[i * 4] > 127 ? 1 : 0;
  const odlZew = odleglosci(maska, N, 1);   // do najbliższego wnętrza
  const odlWew = odleglosci(maska, N, 0);   // do najbliższego tła
  const dane = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const sd = Math.sqrt(odlZew[i]) - Math.sqrt(odlWew[i]);     // + na zewnątrz
    const v = 0.5 - sd / (2 * ROZLEW);
    dane[i * 4] = Math.max(0, Math.min(255, Math.round(v * 255)));
    dane[i * 4 + 1] = obraz[i * 4];
    dane[i * 4 + 2] = 0;
    dane[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(dane, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// Stemple: STOP, K-7, strzałki zjazdu i wjazdu. Jedna partia.

const TRYB_STEMPLA = Object.freeze({ STALY: 0, STOP: 1, K7: 2 });

function listaStempli(siec) {
  const out = [];
  const dodaj = (r, kat, cw, a, b, kom, L, tryb, slot, dSt) => {
    const th = kat * DEG;
    const h = th + (cw === 0 ? -1 : 1) * Math.PI * 0.5;
    out.push({ x: r * Math.cos(th), y: r * Math.sin(th), h, a, b, kom, L, tryb, slot, d: dSt });
  };
  complexes().forEach((c, k) => {
    for (const cw of [0, 1]) {
      const zn = cw === 0 ? 1 : -1;    // kąt rośnie pod prąd na wewnętrznej, maleje na zewnętrznej
      const rL2 = cw === 0 ? HW.iL2 : HW.oL2;
      const thStop = c + zn * (NODE.stopX / rL2) / DEG;
      const pasy = [
        [cw === 0 ? HW.edgeIn + Q.L12 : HW.edgeOut - Q.L12, 370, 500],
        [cw === 0 ? HW.iL3 : HW.oL3, 100, 170]
      ];
      for (const [r, a, b] of pasy) {
        const dSt = 190 + b;
        dodaj(r, thStop + zn * (dSt / r) / DEG, cw, a, b, KOM.STOP, 0.5, TRYB_STEMPLA.STOP, k, dSt);
      }
      const rK = cw === 0 ? HW.edgeIn + Q.L12 : HW.edgeOut - Q.L12;
      dodaj(rK, thStop + zn * (D_K7 / rK) / DEG, cw, 340, 720, KOM.K7, 0.065, TRYB_STEMPLA.K7, k, D_K7);
    }
  });
  for (const n of siec.nodes) {
    if (n.kind === 'bay' || n.kind === 'transit') {
      for (const dd of [900, 2300, 3700]) dodaj(HW.iL3, n.gore + (dd / HW.iL3) / DEG, 0, 66, 250, KOM.STRZ_P, 0.14, TRYB_STEMPLA.STALY, 0, -1);
      for (const dd of [800, 2100]) dodaj(HW.iShoulder, n.merge + (dd / HW.iShoulder) / DEG, 0, 66, 250, KOM.STRZ_L, 0.12, TRYB_STEMPLA.STALY, 0, -1);
    } else if (n.kind === 'gateOut') {
      for (const dd of [900, 2300, 3700]) dodaj(HW.oL3, n.gore - (dd / HW.oL3) / DEG, 1, 66, 250, KOM.STRZ_P, 0.14, TRYB_STEMPLA.STALY, 0, -1);
    } else if (n.kind === 'gateIn') {
      for (const dd of [800, 2100]) dodaj(HW.oShoulder, n.merge - (dd / HW.oShoulder) / DEG, 1, 66, 250, KOM.STRZ_L, 0.12, TRYB_STEMPLA.STALY, 0, -1);
    }
  }
  return out;
}

function zbudujStemple(siec) {
  const lista = listaStempli(siec);
  const STRIDE = 16;
  const dane = new Float32Array(lista.length * STRIDE);
  lista.forEach((s, i) => {
    const o = i * STRIDE;
    dane[o] = s.x; dane[o + 1] = s.y; dane[o + 2] = s.h; dane[o + 3] = s.slot;
    dane[o + 4] = s.a; dane[o + 5] = s.b; dane[o + 6] = s.L; dane[o + 7] = s.tryb;
    dane[o + 8] = s.kom[0]; dane[o + 9] = s.kom[1]; dane[o + 10] = s.kom[2]; dane[o + 11] = s.kom[3];
    dane[o + 12] = s.d; dane[o + 13] = 0; dane[o + 14] = 0; dane[o + 15] = 0;
  });
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const bufor = new THREE.InstancedInterleavedBuffer(dane, STRIDE, 1);
  g.setAttribute('iA', new THREE.InterleavedBufferAttribute(bufor, 4, 0));     // x, y, kurs, K-7
  g.setAttribute('iB', new THREE.InterleavedBufferAttribute(bufor, 4, 4));     // pół szer., pół dł., L, tryb
  g.setAttribute('iC', new THREE.InterleavedBufferAttribute(bufor, 4, 8));     // prostokąt atlasu
  g.setAttribute('iD', new THREE.InterleavedBufferAttribute(bufor, 4, 12));    // odległość od linii stopu
  g.instanceCount = lista.length;

  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');
  const iC = attribute('iC', 'vec4');
  const iD = attribute('iD', 'vec4');
  const px = positionGeometry.x;
  const py = positionGeometry.y;
  const ch = cos(iA.z);
  const sh = sin(iA.z);
  const pozycja = vec3(
    iA.x.add(ch.mul(py).mul(iB.y)).add(sh.mul(px).mul(iB.x)),
    iA.y.add(sh.mul(py).mul(iB.y)).sub(ch.mul(px).mul(iB.x)),
    0
  );
  const uvU = iC.x.add(px.mul(0.5).add(0.5).mul(iC.z.sub(iC.x)));
  const uvV = iC.y.add(float(0.5).sub(py.mul(0.5)).mul(iC.w.sub(iC.y)));
  const vUv = varying(vec2(uvU, uvV), 'vMalStUv');
  const vLok = varying(px.mul(iB.x), 'vMalStL');     // w poprzek jazdy [j.]: prążki farby ze światła

  // Stan i fale w wierzchołku (jedna barwa na stempel): STOP uśpiony to ciemnoczerwony duch, przy sygnale pełna barwa ≤ progu; K-7 biała, przemalowuje się z drogą.
  const slot = iA.w.max(0).add(0.5).toInt();
  const fala = uFale.element(slot);
  const tryb = iB.w;
  const jestStop = float(1).sub(step(0.5, abs(tryb.sub(TRYB_STEMPLA.STOP))));
  const jestK7 = float(1).sub(step(0.5, abs(tryb.sub(TRYB_STEMPLA.K7))));
  const syg = jestStop.add(jestK7);
  const dS = iD.x;
  const m = float(260);
  const nad = smoothstep(fala.z, fala.z.add(m), dS);
  const cz = float(1).sub(smoothstep(fala.y.sub(m), fala.y, dS)).mul(nad).mul(syg);
  const zl = float(1).sub(smoothstep(fala.x.sub(m), fala.x, dS)).mul(nad).mul(syg).mul(float(1).sub(cz));
  const zi = float(1).sub(smoothstep(fala.z.sub(m), fala.z, dS)).mul(smoothstep(fala.z.sub(PAS_ZIELENI), fala.z.sub(PAS_ZIELENI * 0.25), dS)).mul(jestK7);
  const reszta = float(1).sub(cz).sub(zl).sub(zi).max(0);
  const duchStop = vec3(1.7, 0.03, 0.012).mul(0.022);
  const spoczynek = mix(v3(BIEL).mul(iB.z), duchStop, jestStop);
  const kolor = spoczynek.mul(reszta).add(v3(CZER).mul(cz).mul(0.05)).add(v3(ZOLC).mul(zl).mul(0.11)).add(v3(ZIEL).mul(zi).mul(0.075));
  const vKol = varying(kolor, 'vMalStK');
  const vZa = varying(widocznosc(pozycja), 'vMalStZ');

  const atlas = zbudujAtlas();
  const fragment = Fn(() => {
    const t = texture(atlas, vUv).toVar();
    const tx = float(0).toVar();
    tx.assign(length(fwidth(vUv.mul(ATLAS_N))));
    const a = float(0).toVar();
    a.assign(max(fwidth(t.r), 1e-3).mul(0.7));
    const ost = smoothstep(float(0.5).sub(a), float(0.5).add(a), t.r);
    const cov = mix(ost, t.g, smoothstep(0.7, 1.6, tx));
    // Napis z prążków światła wzdłuż jazdy (średnia 1): z bliska to nie płaska farba, z daleka sama średnia.
    const fwL = float(0).toVar();
    fwL.assign(clamp(fwidth(vLok), 1e-3, 3000));
    const prazki = przerywana(vLok, 15, 0.58, fwL).div(0.58);
    return vec4(clamp(vKol.mul(cov).mul(prazki).mul(vZa), vec3(0), vec3(6)), 1);
  });
  const mesh = new THREE.Mesh(g, materialAddytywny(fragment(), pozycja, 'malowanie-stemple'));
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = 'MalowanieStemple';
  return mesh;
}

// ---------------------------------------------------------------------------
// Światła mijania na asfalcie (i czerwony rozlew hamowania): miękkie wachlarze pod kadłubami, jedna partia, przepisywana co klatkę

const CAP_REFL = 5200;
const STR_REFL = 8;

function zbudujReflektory() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const bufor = new THREE.InstancedInterleavedBuffer(new Float32Array(CAP_REFL * STR_REFL), STR_REFL, 1);
  bufor.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iA', new THREE.InterleavedBufferAttribute(bufor, 4, 0));     // x, y, kurs, długość (ujemna — za rufą)
  g.setAttribute('iB', new THREE.InterleavedBufferAttribute(bufor, 4, 4));     // pół szer., L, czerwień 0 / 1, —
  g.instanceCount = 0;
  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');
  const u = positionGeometry.x;
  const v = positionGeometry.y;
  const ch = cos(iA.z);
  const sh = sin(iA.z);
  const dl = iA.w.mul(u);
  const sz = iB.x.mul(v);
  const pozycja = vec3(iA.x.add(ch.mul(dl)).sub(sh.mul(sz)), iA.y.add(sh.mul(dl)).add(ch.mul(sz)), 0);
  const slad = sladPikselaW(vec3(iA.x, iA.y, 0));
  const wid = smoothstep(1.5, 4.5, iB.x.div(slad));
  const vU = varying(u, 'vMalRU');
  const vV = varying(v, 'vMalRV');
  const barwaR = mix(vec3(1.22, 0.96, 0.66), vec3(4.43, 0.06, 0.02), iB.z);
  const vK = varying(barwaR.mul(iB.y).mul(wid).mul(widocznosc(pozycja)), 'vMalRK');
  const stozek = vU.mul(0.84).add(0.16);
  const pop = vV.div(stozek);
  const ksztalt = exp(pop.mul(pop).mul(-2.2)).mul(exp(vU.mul(-2.8))).mul(smoothstep(0, 0.05, vU));
  const m = materialAddytywny(vec4(clamp(vK.mul(ksztalt), vec3(0), vec3(1)), 1), pozycja, 'malowanie-reflektory');
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = 'MalowanieReflektory';
  return { mesh, g, bufor };
}

// ---------------------------------------------------------------------------

export function utworzMalowanie(ctx) {
  const material = zbudujMaterialWstegi(ctx);
  const wstega = new THREE.Mesh(ctx.geomWstegi, material);
  wstega.frustumCulled = false;
  wstega.renderOrder = 2;
  wstega.name = 'MalowanieWstega';
  const geomUszu = zbudujUszy();
  const uszy = new THREE.Mesh(geomUszu, material);
  uszy.frustumCulled = false;
  uszy.renderOrder = 2;
  uszy.name = 'MalowanieUszy';
  const podkladUszu = zbudujPodkladUszu(geomUszu);
  const kliny = zbudujKliny();
  const stemple = zbudujStemple(ctx.siec);
  const refl = zbudujReflektory();
  const siatki = [wstega, uszy, podkladUszu, kliny, stemple, refl.mesh];
  for (const m of siatki) ctx.grupa.add(m);

  const dan = refl.bufor.array;
  const czyszczenieK7 = new Float32Array(4).fill(4);   // ostatni czas fazy CZYSZCZENIE: ciągłość frontu przy przejściu do PRZEJAZDU
  const wpisz = (n, x, y, h, dl, sz, L, cz) => {
    if (n >= CAP_REFL) return n;
    const o = n * STR_REFL;
    dan[o] = x; dan[o + 1] = y; dan[o + 2] = h; dan[o + 3] = dl;
    dan[o + 4] = sz; dan[o + 5] = L; dan[o + 6] = cz; dan[o + 7] = 0;
    return n + 1;
  };

  return {
    id: 'malowanie',
    nazwa: 'Malowanie światłem',
    opis: 'droga namalowana światłem: kreski, STOP, klin zjazdu; czerwone przemalowuje ją pod prąd',
    siatki,
    podklad: 0.78,
    podkladRozdzial: 0.28,
    podkladRamp: 0.22,
    tory: 0.7,
    barBazy: 1,
    promienZiemi: resolveRingPlanetWorldRadius(ctx.ziemia),
    aktualizuj(kl) {
      const ruch = ctx.ruch;
      const K7 = ruch.K7;
      const teraz = ruch.czas;
      for (let i = 0; i < 4; i++) {
        const w = K7[i];
        const f = uFale.array[i];
        const t = w.tFazy;
        let fx = WYL;
        let fy = WYL;
        let fz = WYL;
        let box = 0;
        if (w.faza === FAZA.MAIN) {
          // Zwolnienie: zielone czoło pod prąd, przed nim droga dalej czerwona. Start symulacji (MAIN od początku) to nie zwolnienie.
          if (teraz - t > 0.5) {
            const z = V_ZIELONEJ * t;
            if (z < ZASIEG_ZOLTEJ + PAS_ZIELENI) {
              fx = ZASIEG_ZOLTEJ;
              fy = ZASIEG;
              fz = z;
            }
          }
        } else {
          let od = t;
          if (w.faza === FAZA.CLEAR) {
            czyszczenieK7[i] = t;
            od = CZAS_ZOLTEGO + t;
          } else if (w.faza === FAZA.BOX) {
            od = CZAS_ZOLTEGO + czyszczenieK7[i] + t;
            box = Math.min(1, t / 0.8);
          } else if (w.faza === FAZA.CLEAR2) {
            od = 60 + t;
            box = Math.max(0, 1 - t / 1.5);
          }
          fx = Math.min(ZASIEG_ZOLTEJ, V_FALI * od);
          fy = w.faza === FAZA.YELLOW ? WYL : Math.min(ZASIEG, V_FALI * Math.max(0, od - CZAS_ZOLTEGO));
        }
        f.set(fx, fy, fz, box);
      }
      const a = ruch.atlas;
      const wA = K7[a.K];
      const aktywny = a.stan === 'lot' || a.stan === 'odliczanie';
      uAtlas.value.set(Math.cos(wA.a * DEG), Math.sin(wA.a * DEG), R0 + a.z + 900, aktywny ? 1 : 0);

      // Światła mijania: widać je dopiero od zoomu ~0,06 (mniejsze nikną same w shaderze, tu tylko oszczędność).
      let n = 0;
      if (kl.zoom >= 0.05) {
        const lista = ruch.pojazdy;
        for (let i = 0; i < lista.length; i++) {
          const v = lista[i];
          if (v.alfa < 0.05) continue;
          const c = Math.cos(v.h);
          const s = Math.sin(v.h);
          const W = v.k.W;
          const ruszony = Math.min(1, 0.32 + v.vel / 260);
          const dlP = Math.max(70, W * 3.2);
          const nos = v.kod === 0 ? 16 : v.L * 0.5;
          if (v.kod >= 4) {
            // Frachtowce: dwa wachlarze spod burt.
            const ox = -s * W * 0.27;
            const oy = c * W * 0.27;
            n = wpisz(n, v.x + c * nos + ox, v.y + s * nos + oy, v.h, dlP, W * 0.5, 0.03 * v.alfa * ruszony, 0);
            n = wpisz(n, v.x + c * nos - ox, v.y + s * nos - oy, v.h, dlP, W * 0.5, 0.03 * v.alfa * ruszony, 0);
          } else {
            n = wpisz(n, v.x + c * nos, v.y + s * nos, v.h, dlP, Math.max(12, W * 0.8), 0.07 * v.alfa * ruszony, 0);
          }
          if (v.hamuje) {
            const rufa = v.kod === 0 ? 16 + v.n * 35 : v.L * 0.5;
            const dlT = Math.max(46, W * 1.5);
            n = wpisz(n, v.x - c * rufa, v.y - s * rufa, v.h, -dlT, Math.max(10, W * 0.8), 0.016 * v.alfa, 1);
          }
        }
      }
      refl.g.instanceCount = n;
      refl.bufor.needsUpdate = true;
    }
  };
}
