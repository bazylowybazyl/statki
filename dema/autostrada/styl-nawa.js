// dema/autostrada/styl-nawa.js
//
// STYL „NAWA” (wersja ograniczona) — droga jako wnętrze ze ścian światła. Linia nośna leży w płaszczyźnie gry (warstwa 0), a od niej w dół (warstwa 1, kamera
// perspektywy) schodzą kurtyny: pod kamerą ściana jest kreską, ku brzegom kadru otwiera się ku środkowi obrazu. Kadłuby (pass ortho) przykrywają dół, górne
// połówki obręczy (warstwa 2) kreślą po nich cienką linię: statek jest dosłownie w środku.
//
// Ograniczenia z oceny panelu: paleta bazy (biel, bursztyn), bez górnych kurtyn w kamerze gry, obręcze tylko główne co 9° obwodu, dolna ściana ~4000 j. ze spadkiem ~1200 j.
// (pełna wysokość tylko w kamerze kinowej). W pełnej skali zostaje czerwona ściana stopu: tafle w poprzek jezdni, które przewracają się jak strony księgi.
//
// Kurtyna przykrywa niebo (mieszanie jeden / jeden − alfa): rgb to światło, alfa to mrok, więc gwiazdy za ścianą przygasają. Niebo gry jest jasne i sama addytywna tafla
// by na nim nie istniała. Podkład bazy (warstwa 0) ma tu siłę 0, bo przyciemniałby też ściany: własny leży w warstwie 1, pod ścianami.
//
// AGENT: stan sekwencji jest czystą funkcją (faza, czas fazy) K-7, liczony co klatkę, więc przełączenie stylu w środku sekwencji nic nie psuje. Rodzaje w jednym grafie są
// wybierane maskami (step), bez gałęzi i select poza Fn (pułapki 15, 29, 39); okresy wzdłuż to całkowite dzielniki obwodu (bez szwu na s = 0).
// AGENT: warstwy przełącza `ustawWarstwy`: kamera kinowa rysuje wszystko w warstwie 0 (warstwa 1 idzie przed planetami, więc bliska część drogi znikałaby za Ziemią).
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, uniformArray, float, vec2, vec3, vec4, max, min, abs, mix, exp, clamp, smoothstep, step, floor, length, sin, cos, cross, normalize,
  positionGeometry, positionLocal, modelViewMatrix, cameraViewMatrix, varying, varyingProperty, fwidth, texture
} from 'three/tsl';
import { U, materialAddytywny, linia, przerywana, gaussCalka, zaKula } from './wspolne.tsl.js';
import { HW, NODE, DEG, R0, complexes, bays, transits, hubToWorld } from './siec.js';
import { FAZA } from './ruch.js';
import { resolveRingPlanetWorldRadius } from '../../src/3d/ringScale.js';

const TAU = Math.PI * 2;

// Wzdłuż drogi liczymy s na promieniu odniesienia: okresy to całkowite dzielniki obwodu, wzór domyka się na obu jezdniach.
const R_REF = 62000;
const L0 = TAU * R_REF;
const D_STOP_W = (NODE.stopX / HW.iL2) * R_REF;
const D_STOP_Z = (NODE.stopX / HW.oL2) * R_REF;
const STOPIEN = DEG * R_REF;
const R_LEWA_W = HW.iL1 + HW.widths.L1 * 0.5;
const R_LEWA_Z = HW.oL1 - HW.widths.L1 * 0.5;
const POL_PUDLA = NODE.boxHalf;

// Przekrój jezdni w układzie q: 0 — prawa krawędź, 1440 — krawędź mediany (jak w Malowaniu).
const Q = Object.freeze({
  L3_SR: HW.iL3 - HW.edgeIn,
  L23: HW.iL2 - HW.widths.L2 * 0.5 - HW.edgeIn,
  L2_SR: HW.iL2 - HW.edgeIn,
  L12: HW.iL1 - HW.widths.L1 * 0.5 - HW.edgeIn,
  L1_SR: HW.iL1 - HW.edgeIn,
  LEWA: HW.iL1 + HW.widths.L1 * 0.5 - HW.edgeIn
});

// Barwy o luminancji 1 (Rec. 709: próg bloomu liczy luminancję, więc L z kodu to wprost szczyt).
const CIEPLA = Object.freeze([2.11, 0.76, 0.116]);
const ZIMNA = Object.freeze([0.847, 1.022, 1.241]);
const CIEPLA_G = Object.freeze([0.62, 0.17, 0.02]);    // głąb kurtyny wewnętrznej: ciemny bursztyn, L ≈ 0,25
const ZIMNA_G = Object.freeze([0.17, 0.25, 0.46]);     // głąb kurtyny zewnętrznej: ciemna stal, L ≈ 0,25
const STOP = Object.freeze([4.43, 0.078, 0.031]);
const STOP_G = Object.freeze([1.25, 0.012, 0.012]);     // głąb czerwonej kurtyny: ciemny rubin
const ZOLC = Object.freeze([1.67, 0.90, 0.017]);
const ZIEL = Object.freeze([0.033, 1.33, 0.577]);
const KORYTARZ = Object.freeze([1.06, 0.975, 0.83]);
const v3 = (c) => vec3(c[0], c[1], c[2]);

// Okresy (dzielniki obwodu): fałdy kurtyny, obręcze co 9° (40 na obwód, K-7 między nimi), strumienie pasów.
const N_FALD_A = 160;
const N_FALD_B = 67;
const N_DROB = 751;
const N_NIT_A = 2017;
const N_NIT_B = 4973;
const P_FALD_A = L0 / N_FALD_A;
const P_FALD_B = L0 / N_FALD_B;
const P_DROB = L0 / N_DROB;
const P_NIT_A = L0 / N_NIT_A;
const P_NIT_B = L0 / N_NIT_B;
const V_DRYF = 420;
const LAM_L3 = L0 / 150;
const LAM_L2 = L0 / 110;
const LAM_L1 = L0 / 80;
const P_KRESEK = L0 / 608;
const P_FALI = L0 / 20;
const N_OBREC = 40;

// Tafle stopu: trzy strony księgi za linią stopu.
const TAFLE = Object.freeze([[0, 1], [420, 0.58], [880, 0.34]]);

// Rodzaje ścian i tabela wysokości [j.]: dół, góra, spadek w dół, spadek w górę. Kamera gry: bez górnych kurtyn, poza stopem płytko.
const SCIANA = Object.freeze({ GLOWNA: 0, RAMPA: 1, TAFLA: 2, KORYTARZ: 3 });
const Z_GRA = [[4000, 0, 1200, 1], [2200, 0, 720, 1], [9000, 0, 2200, 1], [4000, 0, 1400, 1]];
const Z_KINO = [[9000, 5000, 2200, 2200], [5000, 2000, 1500, 900], [9000, 5000, 2200, 2200], [9000, 3000, 2200, 1500]];

// Rodzaje partii obręczy.
const OBR = Object.freeze({ GLOWNA: 0, KORYTARZ: 1, LEJEK: 2, SLUP: 3 });

// ---------------------------------------------------------------------------
// Uniformy stylu

const v4 = () => new THREE.Vector4();
const uKA = uniformArray([v4(), v4(), v4(), v4()], 'vec4').setName('uNwKA');   // x czoło bursztynu, y czoło czerwieni, z otwarcie ścian 0…1, w czoło zieleni (−1: brak)
const uKB = uniformArray([v4(), v4(), v4(), v4()], 'vec4').setName('uNwKB');   // x zapora 0…1, y czoło korytarza [z huba], z jasność korytarza, w siła bursztynu
const uZ = uniformArray(Z_GRA.map((t) => new THREE.Vector4(t[0], t[1], t[2], t[3])), 'vec4').setName('uNwZ');
const uFaz = uniform(new THREE.Vector4()).setName('uNwFaz');         // fazy dryfu fałd: a, b, drobne, wolna
const uStr = uniform(new THREE.Vector4()).setName('uNwStr');         // przesunięcia strumieni L3, L2, L1 [j.], faza fali obręczy
const uAtlas = uniform(new THREE.Vector4(3, 0, 0, 0)).setName('uNwAtlas');  // K-7, z dziobu [hub], aktywny, —
const uJ = uniform(1e-3).setName('uNwJ');                            // j./px na jednostkę odległości od kamery (perspektywa)

const widocznosc = (poz) => mix(float(1), zaKula(modelViewMatrix.mul(vec4(poz, 1)).xyz, modelViewMatrix.mul(vec4(0, 0, 0, 1)).xyz, max(U.rZiemi, 1)), step(1, U.rZiemi));

/** Stan sygnału dla punktu jezdni: odległość od osi K-7 `dOs` [j. odn.], kierunek `kier`, jezdnia `mZ` (1 — zewnętrzna), wiersze stanu A i B. */
function sygnal(dOs, kier, mZ, A, B) {
  const dAxis = kier.negate().mul(dOs).toVar();
  const d = dAxis.sub(mix(float(D_STOP_W), float(D_STOP_Z), mZ)).toVar();    // pod prąd od linii stopu
  const przed = step(0, d).toVar();
  const gr = A.w;
  const poZieleni = mix(float(1), smoothstep(gr, gr.add(300), d), step(0, gr)).toVar();
  const red = przed.mul(float(1).sub(smoothstep(A.y.sub(400), A.y, d))).mul(float(1).sub(smoothstep(6000, 9000, d))).mul(poZieleni).toVar();
  const amber = przed.mul(float(1).sub(smoothstep(A.x.sub(500), A.x, d))).mul(float(1).sub(smoothstep(18000, 24000, d))).mul(B.w).mul(float(1).sub(red)).toVar();
  const uZiel = d.sub(gr).div(700);
  const green = exp(uZiel.mul(uZiel).negate()).mul(step(0, gr)).mul(przed).toVar();
  // Ściany rozstępują się w pudle; za zaporą jezdnia pusta, przygaszona.
  const szer = A.z.mul(POL_PUDLA);
  const gap = mix(float(1), smoothstep(szer.sub(60), szer.add(180), abs(dOs)), step(1e-3, A.z)).toVar();
  const zaLinia = d.negate();
  const pusto = B.x.mul(step(0, zaLinia)).mul(float(1).sub(smoothstep(9000, 20000, zaLinia))).mul(0.45).toVar();
  return { d, red, amber, green, gap, pusto };
}

/** Wyloty ramp w prawej krawędzi: zatoki i tranzyty na wewnętrznej, wrota na zewnętrznej. */
function ustaRamp(dOs, mZ) {
  const kat = abs(dOs).div(STOPIEN).toVar();
  const zatoka = float(1).sub(smoothstep(1.3, 1.5, abs(kat.sub(NODE.bay))));
  const tranzyt = smoothstep(45 - 1.15, 45 - 1.0, kat);
  const wrota = float(1).sub(smoothstep(0.55, 0.7, abs(kat.sub(NODE.dIn + 0.55))));
  return clamp(mix(zatoka.add(tranzyt), wrota, mZ), 0, 1);
}

// ---------------------------------------------------------------------------
// Geometria ścian: pozycja (x, y, flaga z), s, rodzaj, kierunek, parametr; jezdnia, K-7, dwa parametry

function zbudujSciany(siec) {
  const pos = [];
  const aS = [];
  const aT = [];
  const idx = [];
  /** Pasek: stacja = 3 wierzchołki (góra z = 0, dół, wierzch). Dwa rzędy czworokątów: w dół i w górę (w kamerze gry wierzch ma wysokość 0, więc nic nie rysuje). */
  const pasek = (stacje, rodzaj, kier, cw, k7) => {
    const start = pos.length / 3;
    for (const st of stacje) {
      for (const fl of [0, -1, 1]) {
        pos.push(st.x, st.y, fl);
        aS.push(st.s, rodzaj, kier, st.p ?? 0);
        aT.push(cw, k7, st.a ?? 0, st.b ?? 0);
      }
    }
    for (let i = 0; i < stacje.length - 1; i++) {
      const a = start + i * 3;
      idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
      idx.push(a, a + 3, a + 2, a + 2, a + 3, a + 5);
    }
  };
  // Cztery ściany główne: 1440 stacji na obwód (271 j., strzałka 0,15 j.).
  const NST = 1440;
  for (const [r, cw, prawa] of [[HW.edgeIn, 0, 1], [R_LEWA_W, 0, 0], [R_LEWA_Z, 1, 0], [HW.edgeOut, 1, 1]]) {
    const st = [];
    for (let i = 0; i <= NST; i++) {
      const th = (i / NST) * TAU;
      st.push({ x: r * Math.cos(th), y: r * Math.sin(th), s: th * R_REF, p: prawa });
    }
    pasek(st, SCIANA.GLOWNA, cw === 0 ? -1 : 1, cw, 0);
  }
  // Tafle stopu: w poprzek jezdni po stronie napływu; u = 0 przy medianie, 1 przy prawej krawędzi (zapora zasuwa się od mediany).
  complexes().forEach((c, k) => {
    for (const cw of [0, 1]) {
      const r0 = cw === 0 ? R_LEWA_W : R_LEWA_Z;
      const r1 = cw === 0 ? HW.edgeIn : HW.edgeOut;
      const rSr = (r0 + r1) * 0.5;
      for (const [dd, jas] of TAFLE) {
        const d = NODE.stopX + 40 + dd;
        const kat = cw === 0 ? c + (d / rSr) / DEG : c - (d / rSr) / DEG;
        const st = [];
        for (let i = 0; i <= 12; i++) {
          const u = i / 12;
          const r = r0 + (r1 - r0) * u;
          st.push({ x: r * Math.cos(kat * DEG), y: r * Math.sin(kat * DEG), s: r, p: u, a: jas });
        }
        pasek(st, SCIANA.TAFLA, cw === 0 ? -1 : 1, cw, k);
      }
    }
    // Korytarz K-7: dwie białe ściany na brzegach pudła, od płyty do r ≈ 68 tys.
    for (const x of [-POL_PUDLA, POL_PUDLA]) {
      const st = [];
      for (let z = 8700; z <= 22000; z += 220) {
        const p = hubToWorld(c, x, z);
        st.push({ x: p.x, y: p.y, s: z, a: Math.min(1, (z - 8700) / 1200, (22000 - z) / 3000) });
      }
      pasek(st, SCIANA.KORYTARZ, 1, 2, k);
    }
  });
  // Rampy: płytkie ścianki po obu brzegach, tylko poza jezdnią (zjazdy do r ≈ 51 tys., tranzyt do ringu, wrota do r ≈ 74 tys.).
  for (const p of siec.paths) {
    const wew = p.kind === 'rampOff' || p.kind === 'rampOn';
    const wrota = p.kind === 'gateIn' || p.kind === 'gateOut';
    if (!wew && !wrota) continue;
    const q = p.probki;
    const pol = wrota ? 200 : 170;
    const rMin = p.id.startsWith('T') ? 45200 : 51200;
    for (const bok of [-1, 1]) {
      let st = [];
      const koniec = () => {
        if (st.length > 1) pasek(st, SCIANA.RAMPA, 1, wew ? 0 : 1, 0);
        st = [];
      };
      for (let i = 0; i < q.n; i += 3) {
        const r = Math.hypot(q.x[i], q.y[i]);
        const poza = wew ? r < HW.edgeIn - 30 && r > rMin : r > HW.edgeOut + 30 && r < 74000;
        if (!poza) { koniec(); continue; }
        const tx = Math.cos(q.h[i]);
        const ty = Math.sin(q.h[i]);
        const zanik = wew ? Math.min(1, (r - rMin) / 2500) : Math.min(1, (74000 - r) / 5000);
        st.push({ x: q.x[i] - ty * pol * bok, y: q.y[i] + tx * pol * bok, s: q.s[i], a: zanik });
      }
      koniec();
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('nwS', new THREE.BufferAttribute(new Float32Array(aS), 4));
  g.setAttribute('nwT', new THREE.BufferAttribute(new Float32Array(aT), 4));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  return g;
}

// ---------------------------------------------------------------------------
// Materiał ścian

function zbudujMaterialScian(ctx) {
  const pole = ctx.pole.tekstura;
  const aS = attribute('nwS', 'vec4');
  const aT = attribute('nwT', 'vec4');
  const vH = varyingProperty('float', 'vNwH');
  const vR = varyingProperty('vec4', 'vNwR');   // s, rodzaj, kierunek, parametr
  const vT = varyingProperty('vec4', 'vNwT');   // jezdnia, K-7, a, b
  const vZZ = varyingProperty('vec4', 'vNwZZ'); // dół, góra, spadek w dół, spadek w górę
  const vZa = varyingProperty('float', 'vNwZa');

  const pozycja = Fn(() => {
    const Z = vec4(0).toVar();
    Z.assign(uZ.element(aS.y.toInt()));
    const fl = positionGeometry.z;
    const z = float(0).toVar();
    z.assign(max(fl, 0).mul(Z.y).sub(max(fl.negate(), 0).mul(Z.x)));
    const poz = vec3(0).toVar();
    poz.assign(vec3(positionGeometry.x, positionGeometry.y, z));
    vH.assign(z);
    vR.assign(aS);
    vT.assign(aT);
    vZZ.assign(Z);
    vZa.assign(clamp(widocznosc(poz), 0, 1));
    return poz;
  })();

  const fragment = Fn(() => {
    // Pochodne przed wszystkim (pułapki 15, 29); rodzaje to maski.
    const S = vR.x;
    const fwH = float(0).toVar();
    fwH.assign(clamp(fwidth(vH), 1e-2, 1e5));
    const fwS = float(0).toVar();
    fwS.assign(clamp(fwidth(S), 1e-3, 1e5));
    const rod = vR.y;
    const jest = (x) => float(1).sub(step(0.5, abs(rod.sub(x))));
    const mSc = jest(SCIANA.GLOWNA).toVar();
    const mRp = jest(SCIANA.RAMPA).toVar();
    const mSt = jest(SCIANA.TAFLA).toVar();
    const mKo = jest(SCIANA.KORYTARZ).toVar();
    const kier = vR.z;
    const par = vR.w;
    const cw = vT.x;
    const h = abs(vH).toVar();
    const gor = step(0.5, vH).toVar();
    const H = mix(vZZ.z, vZZ.w, gor).toVar();
    const Zk = mix(vZZ.x, vZZ.y, gor).toVar();

    // Nieregularność wzdłuż: spadek każdego miejsca inny, więc dół kurtyny jest postrzępiony, a nie równy.
    const u = S.mul(TAU / L0).toVar();
    const nA = sin(u.mul(61).add(1.3)).toVar();
    const nB = sin(u.mul(157).add(0.7).add(uFaz.w.mul(TAU))).toVar();
    const Hv = max(H.mul(float(1).add(mSc.mul(nA.mul(0.28).add(nB.mul(0.16))))), 1).toVar();
    const fall = exp(h.div(Hv).negate()).toVar();
    const konc = float(1).sub(smoothstep(0.72, 1, h.div(max(Zk, 1)))).toVar();
    // Tafla węższa niż ~1,5 px na spadek gaśnie (trójkąty pod kamerą są cieńsze od piksela): zostaje linia nośna.
    const edge = smoothstep(1.5, 5, Hv.div(fwH)).toVar();

    // Fałdy: szerokie, nierówne, dryfują z ruchem; drobne gasną ze śladem (średnia 1, jasność nie skacze).
    const fm = sin(u.mul(23).add(0.7)).mul(2.6).add(sin(u.mul(59).add(2.2)).mul(1.5)).toVar();
    const fa = sin(u.mul(N_FALD_A).add(fm).sub(kier.mul(uFaz.x).mul(TAU))).mul(0.5).add(0.5).toVar();
    const fb = sin(u.mul(N_FALD_B).sub(fm.mul(0.7)).add(kier.mul(uFaz.y).mul(TAU))).mul(0.5).add(0.5).toVar();
    const dr = sin(u.mul(N_DROB).add(fm.mul(3.1)).sub(kier.mul(uFaz.z).mul(TAU))).mul(0.5).add(0.5).toVar();
    const ribA = float(1).sub(smoothstep(0.25, 0.7, fwS.div(P_DROB))).toVar();
    const nitA = sin(u.mul(N_NIT_A).add(fm.mul(5)).sub(kier.mul(uFaz.z).mul(TAU))).mul(float(1).sub(smoothstep(0.25, 0.7, fwS.div(P_NIT_A)))).toVar();
    const nitB = sin(u.mul(N_NIT_B).sub(fm.mul(7)).add(uFaz.w.mul(TAU))).mul(float(1).sub(smoothstep(0.25, 0.7, fwS.div(P_NIT_B)))).toVar();
    const rib = float(1).add(fa.mul(fb).mul(4).sub(1).mul(0.42)).mul(float(1).add(dr.mul(2).sub(1).mul(ribA).mul(0.32))).mul(float(1).add(nitA.mul(0.26)).add(nitB.mul(0.2))).toVar();

    // Stan K-7: dla ściany głównej ćwiartka z s; tafle i korytarz mają K-7 w atrybucie.
    const kf = floor(S.div(L0 / 4)).toVar();
    const kK = mix(clamp(kf, 0, 3), vT.y, step(1.5, rod)).add(0.5).toVar();
    const A = vec4(0).toVar();
    A.assign(uKA.element(kK.toInt()));
    const B = vec4(0).toVar();
    B.assign(uKB.element(kK.toInt()));
    const dOs = S.sub(kf.add(0.5).mul(L0 / 4)).toVar();
    const sy = sygnal(dOs, kier, cw, A, B);
    const usta = ustaRamp(dOs, cw).mul(par).toVar();

    // Ruch podnosi ścianę przy sobie: pakiet światła jedzie wzdłuż kurtyny.
    const wiersz = cw.mul(3).add(par.mul(2)).add(0.5).div(6);
    const pr = vec4(0).toVar();
    pr.assign(texture(pole, vec2(S.div(L0), wiersz)).level(0));
    const luz = float(0.68).add(clamp(pr.r.mul(5), 0, 2.2).mul(0.62)).toVar();

    // Ściana główna.
    const glab = float(1).sub(exp(h.div(mix(float(800), float(1500), cw)).negate())).toVar();
    const cT = mix(v3(CIEPLA), v3(ZIMNA), cw).toVar();
    const cG = mix(v3(CIEPLA_G), v3(ZIMNA_G), cw).toVar();
    const baza = mix(cT, cG, glab).toVar();
    const przyLinii = exp(h.div(900).negate()).toVar();
    const barwaSc = mix(mix(baza, v3(ZOLC).mul(0.9), sy.amber.mul(przyLinii)), mix(v3(STOP), v3(STOP_G), glab), sy.red).add(v3(ZIEL).mul(sy.green).mul(exp(h.div(1800).negate())).mul(0.7)).toVar();
    // Bursztyn przy tej samej luminancji wygląda dużo mocniej niż stal (czerwień po ACES): wewnętrzna ma połowę, żeby nie robiła pomarańczowej taśmy.
    const Lsc = mix(mix(float(0.046), float(0.092), cw).add(sy.amber.mul(przyLinii).mul(0.08)), float(0.064), sy.red).toVar();
    const maskaSc = sy.gap.mul(float(1).sub(usta)).mul(float(1).sub(sy.pusto)).toVar();
    // W górę (tylko kino) słabiej: to obraz, nie rozgrywka.
    const goraM = mix(float(1), float(0.72), gor);
    const blizej = mix(float(1), float(0.55), smoothstep(0.35, 1.4, U.zoom).mul(float(1).sub(U.persp))).toVar();
    const emSc = barwaSc.mul(min(Lsc.mul(fall).mul(rib).mul(mix(luz, float(1), sy.red)), 0.26)).mul(blizej).mul(konc).mul(edge).mul(maskaSc).mul(goraM);
    const aSc = exp(h.div(H.mul(1.7)).negate()).mul(0.58).mul(konc).mul(edge).mul(maskaSc);

    // Rampa: płytka ścianka, barwa jezdni.
    const emRp = baza.mul(mix(float(0.028), float(0.06), cw)).mul(fall).mul(konc).mul(edge).mul(vT.z);
    const aRp = exp(h.div(H.mul(1.5)).negate()).mul(0.24).mul(konc).mul(edge).mul(vT.z);

    // Tafla stopu: promienie z lamp baru (rozstaw ok. 88 j., z daleka średnia), zasuwana od mediany, szersze fałdy, postrzępiony dół.
    const rPr = S;
    const fwR = float(0).toVar();
    fwR.assign(fwS);
    const b = B.x;
    const naTafli = step(1e-3, b).mul(float(1).sub(smoothstep(b.sub(0.03), b, par))).toVar();
    const lampki = float(1).add(sin(rPr.mul(TAU / 88).add(uFaz.w.mul(TAU))).mul(0.3).mul(float(1).sub(smoothstep(8, 22, fwR)))).toVar();
    const faldT = float(1).add(sin(rPr.mul(TAU / 613).add(uFaz.y.mul(TAU))).mul(0.26)).add(sin(rPr.mul(TAU / 271).sub(uFaz.x.mul(TAU))).mul(0.14)).toVar();
    const HTafli = max(H.mul(float(1).add(sin(rPr.mul(TAU / 389).add(1.1)).mul(0.22))), 1).toVar();
    const fallT = exp(h.div(HTafli).negate()).toVar();
    const edgeT = smoothstep(1, 3.5, HTafli.div(fwH)).toVar();
    const barwaT = mix(v3(STOP), v3(STOP_G), glab);
    const emSt = barwaT.mul(0.165).mul(vT.z).mul(fallT).mul(konc).mul(lampki).mul(faldT).mul(naTafli).mul(edgeT);
    const aSt = exp(h.div(H.mul(1.5)).negate()).mul(0.62).mul(vT.z).mul(konc).mul(naTafli).mul(edgeT);

    // Korytarz: ciepła biel; zapala się od bramy na zewnątrz (domino).
    // Fałdy jak na ścianie głównej (s = z huba), końce wygasają, żeby to nie były deski o ciętych brzegach.
    const dom = float(1).sub(smoothstep(B.y.sub(1400), B.y, S)).mul(vT.z).toVar();
    const faK = sin(S.mul(TAU / 1900).sub(uFaz.x.mul(TAU))).mul(0.5).add(0.5).toVar();
    const fbK = sin(S.mul(TAU / 730).add(uFaz.y.mul(TAU))).mul(0.5).add(0.5).toVar();
    const fcK = sin(S.mul(TAU / 263).sub(uFaz.z.mul(TAU))).mul(0.5).add(0.5).toVar();
    const ribK = float(0.5).add(faK.mul(fbK).mul(1.8)).mul(float(0.8).add(fcK.mul(0.4).mul(ribA))).toVar();
    const emKo = v3(KORYTARZ).mul(0.036).mul(fall).mul(ribK).mul(konc).mul(edge).mul(B.z).mul(dom).add(v3(KORYTARZ).mul(exp(h.div(90).negate()).mul(0.07)).mul(edge).mul(B.z).mul(dom));
    const aKo = exp(h.div(H.mul(1.1)).negate()).mul(0.3).mul(konc).mul(edge).mul(B.z).mul(dom);

    const em = emSc.mul(mSc).add(emRp.mul(mRp)).add(emSt.mul(mSt)).add(emKo.mul(mKo)).mul(vZa);
    const al = aSc.mul(mSc).add(aRp.mul(mRp)).add(aSt.mul(mSt)).add(aKo.mul(mKo)).mul(vZa);
    return vec4(clamp(em, vec3(0), vec3(3)), clamp(al, 0, 1));
  })();

  const m = new THREE.NodeMaterial();
  m.name = 'nawa-sciany';
  m.lights = false;
  m.fog = false;
  m.transparent = false;
  m.depthWrite = false;
  m.depthTest = false;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.positionNode = pozycja;
  m.fragmentNode = fragment;
  return m;
}

// ---------------------------------------------------------------------------
// Podkład w warstwie 1: przyciemnia niebo pod jezdnią, ale nie ściany (te idą po nim)

function zbudujPodklad(geom) {
  const aSV = attribute('aSV', 'vec2');
  const aMeta = attribute('aMeta', 'vec4');
  const rid = aMeta.x;
  const jestV = (x) => float(1).sub(step(0.5, abs(rid.sub(x))));
  const skalaS = jestV(0).mul(R_REF / R_WEWN).add(jestV(1).mul(R_REF / R_ZEWN)).add(jestV(2).mul(R_REF / HW.median)).add(step(2.5, rid));
  const vS = varying(aSV.x.mul(skalaS), 'vNwPS');
  const vV = varying(aSV.y, 'vNwPV');
  const vM = varying(aMeta, 'vNwPM');
  const vZa = varying(clamp(widocznosc(positionLocal), 0, 1), 'vNwPZ');
  const alfa = Fn(() => {
    const rod = vM.x;
    const pol = vM.y;
    const brzeg = max(pol.mul(0.4), 110);
    const zanik = float(1).sub(smoothstep(pol, pol.add(brzeg), abs(vV)));
    const jezdnia = float(1).sub(step(1.5, rod));
    const rozdz = float(1).sub(step(0.5, abs(rod.sub(2))));
    const rampa = step(2.5, rod).mul(float(1).sub(step(7.5, rod)));
    // Otwarte pudło: droga nie leży ciemnym pasem w poprzek korytarza.
    const kf = floor(vS.div(L0 / 4)).toVar();
    const A = vec4(0).toVar();
    A.assign(uKA.element(clamp(kf, 0, 3).add(0.5).toInt()));
    const szer = A.z.mul(POL_PUDLA);
    const dOs = abs(vS.sub(kf.add(0.5).mul(L0 / 4))).toVar();
    const wPudle = float(1).sub(smoothstep(szer.sub(60), szer.add(180), dOs)).mul(step(1e-3, A.z)).mul(float(1).sub(step(2.5, rod)));
    return zanik.mul(jezdnia.mul(0.78).add(rozdz.mul(0.34)).add(rampa.mul(0.3))).mul(float(1).sub(wPudle.mul(0.72))).mul(vZa);
  })();
  const m = new THREE.NodeMaterial();
  m.name = 'nawa-podklad';
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
  mesh.name = 'NawaPodklad';
  return mesh;
}

// ---------------------------------------------------------------------------
// Podłoga: linie nośne, kreski pasów, strumienie, mgiełka; w płaszczyźnie gry (warstwa 0, dokładna pozycja gry)

const RZ = Object.freeze({ WEWN: 0, ZEWN: 1, ROZDZIAL: 2, ZJAZD: 3, WJAZD: 4, ZAWROTKA: 5, WROTA_WE: 6, WROTA_WY: 7, PUDLO: 8, CIEZKI: 9 });
const R_WEWN = (HW.edgeIn + R_LEWA_W) * 0.5;
const R_ZEWN = (HW.edgeOut + R_LEWA_Z) * 0.5;
const kresa = (x, hw, fw) => linia(x, float(hw), fw).mul(min(float(1), float(2 * hw).div(fw)));

function zbudujPodloge(ctx) {
  const pole = ctx.pole.tekstura;
  const aSV = attribute('aSV', 'vec2');
  const aMeta = attribute('aMeta', 'vec4');
  const rid = aMeta.x;
  const jestV = (x) => float(1).sub(step(0.5, abs(rid.sub(x))));
  const skalaS = jestV(RZ.WEWN).mul(R_REF / R_WEWN).add(jestV(RZ.ZEWN).mul(R_REF / R_ZEWN)).add(jestV(RZ.ROZDZIAL).mul(R_REF / HW.median)).add(step(2.5, rid));
  const vS = varying(aSV.x.mul(skalaS), 'vNwFS');
  const vV = varying(aSV.y, 'vNwFV');
  const vM = varying(aMeta, 'vNwFM');
  const vP = varying(positionLocal.xy, 'vNwFP');
  const vZa = varying(clamp(widocznosc(positionLocal), 0, 1), 'vNwFZ');

  const fragment = Fn(() => {
    const fwV = float(0).toVar();
    fwV.assign(clamp(fwidth(vV), 1e-3, 3000));
    const fwS = float(0).toVar();
    fwS.assign(clamp(fwidth(vS), 1e-3, 3000));
    const rr = length(vP).toVar();
    const rod = vM.x;
    const pol = vM.y;
    const kier = vM.z;
    const jest = (x) => float(1).sub(step(0.5, abs(rod.sub(x))));
    const mW = jest(RZ.WEWN).toVar();
    const mZ = jest(RZ.ZEWN).toVar();
        const mJ = mW.add(mZ).toVar();
    const q = pol.add(kier.mul(vV)).toVar();

    const kf = floor(vS.div(L0 / 4)).toVar();
    const kI = clamp(kf, 0, 3).add(0.5).toVar();
    const A = vec4(0).toVar();
    A.assign(uKA.element(kI.toInt()));
    const B = vec4(0).toVar();
    B.assign(uKB.element(kI.toInt()));
    const dOs = vS.sub(kf.add(0.5).mul(L0 / 4)).toVar();
    const sy = sygnal(dOs, kier, mZ, A, B);
    const usta = ustaRamp(dOs, mZ).toVar();

    const cT = mix(v3(CIEPLA), v3(ZIMNA), mZ).toVar();
    const barwaLinii = mix(mix(cT, v3(ZIMNA), 0.25), v3(ZOLC).mul(0.72), sy.amber).toVar();
    const naLinii = mix(mix(barwaLinii, v3(STOP).mul(0.6), sy.red), v3(ZIEL).mul(0.8), sy.green).toVar();

    // Linie nośne: z daleka mocniej (2 px na ciemnym), zawsze pod progiem bloomu; w kinie słabiej (cały pierścień w kadrze nie może być białą obręczą).
    const dal = float(1).add(smoothstep(8, 28, fwV).mul(0.5)).mul(mix(float(1), float(0.55), U.persp)).toVar();
    const lP = linia(q, float(4), fwV).mul(0.52).mul(dal).add(gaussCalka(q, float(26), fwV).mul(0.08));
    const lL = linia(q.sub(Q.LEWA), float(3), fwV).mul(0.36).mul(dal).add(gaussCalka(q.sub(Q.LEWA), float(20), fwV).mul(0.06));
    const nosne = min(lP.mul(float(1).sub(usta)), 0.84).add(min(lL, 0.84)).mul(sy.gap);
    let em = naLinii.mul(nosne).mul(mJ);

    // Kreski granic pasów (nieruchome), gasną z całką.
    const wzK = przerywana(vS, P_KRESEK, 0.4, fwS);
    const kreski = kresa(q.sub(Q.L12), 2.5, fwV).add(kresa(q.sub(Q.L23), 2.5, fwV)).mul(wzK).mul(0.17).mul(sy.gap).mul(mJ);
    em = em.add(naLinii.mul(kreski));

    // Strumienie na osiach pasów: gasną, gdy pas stoi albo jest pusty (bez ruchu zastępczego), a nie zwalniają.
    const przep = (wiersz) => {
      const p = texture(pole, vec2(vS.div(L0), mZ.mul(3).add(wiersz).add(0.5).div(6))).level(0);
      return smoothstep(0.02, 0.22, p.r.mul(5)).mul(smoothstep(0.08, 0.4, p.g));
    };
    // Kometa: głowa z przodu w kierunku ruchu, ogon gaśnie kwadratowo; z daleka (ślad ≳ długość komety) średnia, bez mrugania.
    const strumien = (qc, sig, lam, faza, wiersz) => {
      const s = kier.mul(vS).sub(faza);
      const x = s.div(lam);
      const fx = x.sub(floor(x));
      const t = clamp(fx.div(0.24), 0, 1);
      const kom = t.mul(t).mul(float(1).sub(smoothstep(0.235, 0.24, fx)));
      const sred = float(0.08);
      const wz = mix(kom, sred, smoothstep(0.25, 1, fwS.div(lam * 0.24)));
      return gaussCalka(q.sub(qc), float(sig), fwV).mul(wz).mul(przep(wiersz));
    };
    const str = strumien(Q.L3_SR, 9, LAM_L3, uStr.x, 2).add(strumien(Q.L2_SR, 7, LAM_L2, uStr.y, 1)).add(strumien(Q.L1_SR, 6, LAM_L1, uStr.z, 0)).toVar();
    em = em.add(mix(cT, v3(ZIMNA), 0.45).mul(min(str.mul(0.34), 0.8)).mul(sy.gap).mul(mJ).mul(float(1).sub(sy.pusto)));

    // Mgiełka: jaśniej przy ścianach, wolny szum wzdłuż.
    const uu = vS.mul(TAU / L0).toVar();
    const szum = float(1).add(sin(uu.mul(37).add(q.div(900))).mul(0.2)).add(sin(uu.mul(97).add(1.4).sub(q.div(500))).mul(0.12)).toVar();
    const p = abs(q.sub(Q.LEWA * 0.5)).div(Q.LEWA * 0.5).toVar();
    const naJezdni = smoothstep(0, 60, q).mul(float(1).sub(smoothstep(Q.LEWA - 60, Q.LEWA, q))).toVar();
    const mgla = mix(float(0.42), float(1.6), p.mul(p)).mul(szum).mul(mix(float(0.0035), float(0.007), mZ)).mul(naJezdni).mul(sy.gap).mul(mJ).mul(float(1).sub(sy.pusto));
    em = em.add(mix(mix(cT, v3(ZOLC), sy.amber), v3(STOP), sy.red.mul(0.8)).mul(mgla));

    // Rampy, wrota, zawrotki: same krawędzie, tylko poza jezdnią.
    const mRW = jest(RZ.ZJAZD).add(jest(RZ.WJAZD));
    const mRZ = jest(RZ.WROTA_WE).add(jest(RZ.WROTA_WY));
    const mU = jest(RZ.ZAWROTKA);
    const poza = mRW.mul(float(1).sub(step(HW.edgeIn, rr))).add(mRZ.mul(step(HW.edgeOut, rr))).add(mU.mul(step(R_LEWA_W, rr)).mul(float(1).sub(step(R_LEWA_Z, rr)))).toVar();
    const zanikWrot = mix(float(1), float(1).sub(smoothstep(74000, 84000, rr)), mRZ);
    const xR = abs(vV).toVar();
    const lRampy = linia(xR.sub(pol), float(3), fwV).mul(mix(float(0.15), float(0.26), mRZ)).mul(poza).mul(zanikWrot);
    const barwaR = mix(mix(v3(ZIMNA), v3(CIEPLA), mRW), v3(CIEPLA), mU.mul(0.5));
    em = em.add(barwaR.mul(lRampy));

    // Pasy K-7: w fazie przejazdu krawędzie torów; pas Atlasa jaśniejszy.
    const mP = jest(RZ.PUDLO);
    const kP = vM.w.max(0).add(0.5).toInt();
    const on = uKB.element(kP).z.toVar();
    const zasieg = float(1).sub(smoothstep(66000, 70000, rr)).mul(smoothstep(54000, 54600, rr));
    const lPud = kresa(xR.sub(pol), 4, fwV).mul(0.035).mul(on).mul(zasieg).mul(mP);
    em = em.add(v3(KORYTARZ).mul(lPud));

    // Drogi ciężkich: ledwie duch.
    const lCi = linia(xR.sub(pol), float(3), fwV).mul(0.022).mul(float(1).sub(step(HW.edgeIn, rr))).mul(jest(RZ.CIEZKI));
    em = em.add(v3(ZIMNA).mul(lCi));

    return vec4(clamp(em.mul(vZa), vec3(0), vec3(4)), 1);
  })();
  const mesh = new THREE.Mesh(ctx.geomWstegi, materialAddytywny(fragment, null, 'nawa-podloga'));
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'NawaPodloga';
  return mesh;
}

// ---------------------------------------------------------------------------
// Partia obręczy i słupów: pół pętli, wstążka w przestrzeni widoku. Jeden graf, dwie siatki (góra FG, dół BG), wspólny bufor instancji.

function listaObreczy() {
  const out = [];
  const obr = (x, y, ax, ay, w, zu, zd, rodz, k, s, kier, d) => out.push(x, y, ax, ay, w, zu, zd, rodz, k, s, kier, d);
  // Obręcze główne co 9°, z K-7 pośrodku odstępu: tuż za linią stopu po obu stronach.
  for (const [rc, cw] of [[R_WEWN, 0], [R_ZEWN, 1]]) {
    for (let i = 0; i < N_OBREC; i++) {
      const th = ((i + 0.5) / N_OBREC) * TAU;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const sOdn = th * R_REF;
      const k = Math.min(3, Math.floor(sOdn / (L0 / 4)));
      const kier = cw === 0 ? -1 : 1;
      const dOs = sOdn - (k + 0.5) * (L0 / 4);
      const d = -kier * dOs - (cw === 0 ? D_STOP_W : D_STOP_Z);
      obr(rc * c, rc * s, c, s, 720, 800, 1600, OBR.GLOWNA, k, sOdn, kier, d);
    }
  }
  complexes().forEach((c, k) => {
    const ax = -Math.sin(c * DEG);
    const ay = Math.cos(c * DEG);
    // Korytarz K-7: od bramy co 2400 j.
    for (let z = 9600; z <= 21600; z += 2400) {
      const p = hubToWorld(c, 0, z);
      obr(p.x, p.y, ax, ay, POL_PUDLA, 1000, 1800, OBR.KORYTARZ, k, z, 0, -1);
    }
    // Lejki na wrotach: obręcze zwężające się ku jezdni.
    for (const a of [c + NODE.dIn, c + NODE.dOut]) {
      const bx = -Math.sin(a * DEG);
      const by = Math.cos(a * DEG);
      const LEJ = [[2600, 430, 420, 880], [5600, 900, 520, 1100], [10000, 1650, 640, 1350], [16500, 2700, 800, 1650], [25000, 4100, 1000, 2100]];
      for (const [dr, w, zu, zd] of LEJ) {
        const p = hubToWorld(a, 0, HW.edgeOut + dr - R0);
        obr(p.x, p.y, bx, by, w, zu, zd, OBR.LEJEK, k, dr, 0, -1);
      }
    }
    // Słupy w narożach pudła: po stronie napływu czerwone (d > 0), z góry widać czerwone Z.
    const NAROZA = [[POL_PUDLA, HW.edgeIn - 80, 1, -1], [-POL_PUDLA, HW.edgeIn - 80, -1, -1], [-POL_PUDLA, HW.edgeOut + 80, 1, 1], [POL_PUDLA, HW.edgeOut + 80, -1, 1]];
    for (const [x, r, d, kier] of NAROZA) {
      const p = hubToWorld(c, x, r - R0);
      obr(p.x, p.y, ax, ay, 0, 900, 12000, OBR.SLUP, k, 1, kier, d);
    }
  });
  // Słupy pozostałych węzłów: słabsze, krótsze.
  for (const a of [...bays(), ...transits()]) {
    for (const bok of [-1, 1]) {
      const dx = bok * 1500;
      const p = hubToWorld(a, dx, HW.edgeIn - 120 - R0);
      const ax = -Math.sin(a * DEG);
      const ay = Math.cos(a * DEG);
      const k = Math.min(3, Math.floor((((a + 360) % 360) * DEG * R_REF) / (L0 / 4)));
      obr(p.x, p.y, ax, ay, 0, 500, 7000, OBR.SLUP, k, 0.42, 0, -1);
    }
  }
  return new Float32Array(out);
}

function geomPolPetli(znak, bufor, ile, seg = 28) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI;
    pos.push(a, 1, znak, a, -1, znak);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.setAttribute('nhA', new THREE.InterleavedBufferAttribute(bufor, 4, 0));   // x, y, oś szerokości
  g.setAttribute('nhB', new THREE.InterleavedBufferAttribute(bufor, 4, 4));   // półszerokość, góra, dół, rodzaj
  g.setAttribute('nhC', new THREE.InterleavedBufferAttribute(bufor, 4, 8));   // K-7, s (lub z huba), kierunek, odległość pod prąd od stopu
  g.instanceCount = ile;
  return g;
}

function zbudujMaterialObreczy() {
  const hA = attribute('nhA', 'vec4');
  const hB = attribute('nhB', 'vec4');
  const hC = attribute('nhC', 'vec4');
  const vBok = varyingProperty('float', 'vNhBok');
  const vKol = varyingProperty('vec3', 'vNhKol');
  const vSl = varyingProperty('float', 'vNhSl');
  const vRdz = varyingProperty('float', 'vNhRdz');

  const pozycja = Fn(() => {
    const F = (e) => { const v = float(0).toVar(); v.assign(e); return v; };
    const V3 = (e) => { const v = vec3(0).toVar(); v.assign(e); return v; };
    const V4 = (e) => { const v = vec4(0).toVar(); v.assign(e); return v; };
    const a = positionGeometry.x;
    const bok = positionGeometry.y;
    const zn = positionGeometry.z;
    const jedna = float(1);
    const rodz = hB.w;
    const jest = (x) => F(jedna.sub(step(0.5, abs(rodz.sub(x)))));
    const mGl = jest(OBR.GLOWNA);
    const mKo = jest(OBR.KORYTARZ);
    const mLe = jest(OBR.LEJEK);
    const mSl = jest(OBR.SLUP);
    const persp = U.persp;

    // Wysokość: góra ściśnięta do 0,45 wysokości kamery (nie zderza się z kamerą), kino większe; słup w górę tylko w kinie.
    const D = F(modelViewMatrix.element(3).z.negate());
    const skala = F(mix(jedna, mix(float(2.2), jedna, mSl), persp));
    const zu = F(mix(min(hB.y, D.mul(0.45)).mul(jedna.sub(mSl)), hB.y.mul(skala), persp));
    const zd = F(hB.z.mul(skala));
    const gorna = F(step(0, zn));
    const Z = F(mix(zd, zu, gorna));
    const ca = F(cos(a));
    const sa = F(sin(a));
    const t01 = F(a.div(Math.PI));
    const x = F(hB.x.mul(ca));
    const z = F(zn.mul(Z).mul(mix(sa, t01, mSl)));
    const P = V3(vec3(hA.x.add(hA.z.mul(x)), hA.y.add(hA.w.mul(x)), z));
    const dx = F(hB.x.mul(sa).negate());
    const TL = V3(vec3(hA.z.mul(dx), hA.w.mul(dx), zn.mul(Z).mul(ca)));
    const T = V3(mix(TL, vec3(0, 0, 1), mSl));

    // Wstążka: normalna do stycznej i promienia widoku; osłona NaN, gdy styczna celuje w kamerę.
    const lv = V4(modelViewMatrix.mul(vec4(P, 1)));
    const tv = V4(modelViewMatrix.mul(vec4(T, 0)));
    const c = V3(cross(tv.xyz, lv.xyz.div(max(length(lv.xyz), 1))));
    const n = V3(c.div(max(length(c), 1e-4)));
    const dist = F(max(lv.z.negate(), 1));
    const jPx = F(uJ.mul(dist));
    // Żebro: grubsze przy podstawie (z ≈ 0), cieńsze ku szczytowi; wstążka ma zapas na miękką poświatę (rdzeń zajmuje ok. 1/3 szerokości).
    const baza0 = F(jedna.add(exp(abs(z).div(240).negate()).mul(1.1)));
    const hw0 = F(mix(float(7).mul(baza0), float(46), mSl));
    const hw = F(clamp(hw0, jPx.mul(mix(float(1.0), float(2), mSl)), jPx.mul(mix(float(2.2).mul(baza0), float(6), mSl))));
    const gain = F(max(min(jedna, hw0.div(hw)), mix(float(0.55), float(0.72), mSl)));
    const szerW = F(mix(max(hw.mul(3), float(52)), hw, mSl));

    // Stan K-7.
    const kI = hC.x.add(0.5).toInt();
    const A = V4(uKA.element(kI));
    const B = V4(uKB.element(kI));
    const d = hC.w;
    const przed = F(step(0, d));
    const poZ = F(mix(jedna, smoothstep(A.w, A.w.add(300), d), step(0, A.w)));
    const red = F(przed.mul(jedna.sub(smoothstep(A.y.sub(400), A.y, d))).mul(jedna.sub(smoothstep(6000, 9000, d))).mul(poZ));
    const amb = F(przed.mul(jedna.sub(smoothstep(A.x.sub(500), A.x, d))).mul(jedna.sub(smoothstep(18000, 24000, d))).mul(B.w).mul(jedna.sub(red)));
    const uZi = F(d.sub(A.w).div(800));
    const zie = F(exp(uZi.mul(uZi).negate()).mul(step(0, A.w)).mul(przed));

    // Fala z ruchem: obręcze zapalają się kolejno, wolno; zanik z głębokością, żeby to była półobręcz schodząca w ciemność, a nie równa elipsa.
    const fr = hC.y.div(P_FALI).sub(hC.z.mul(uStr.w));
    const fal = F(fr.sub(fr.floor()));
    const fala = F(jedna.add(exp(fal.mul(-7)).mul(0.5)));
    const hzObr = F(mix(mix(float(1000), float(620), gorna), mix(float(2600), float(1500), gorna), persp));
    const hz = F(mix(mix(hzObr, mix(float(2400), float(1500), gorna), mKo), float(1900), mSl));
    const zanik = F(exp(abs(z).div(hz).negate()).mul(mix(jedna, jedna.sub(smoothstep(0.75, 1, t01)), mSl)));
    const goraM = F(mix(jedna, float(0.62), gorna).mul(mix(mix(float(0.3), jedna, smoothstep(0, 170, abs(z))), jedna, mSl)));

    // Główna: barwa jezdni z domieszką bieli, sygnał przejmuje całą obręcz.
    const cw = F(step(0, hC.z));
    const baza = V3(mix(mix(v3(CIEPLA), v3(ZIMNA), cw), v3(ZIMNA), 0.3));
    const kGl = V3(mix(mix(baza, v3(ZOLC), amb), v3(STOP).mul(0.78), red).add(v3(ZIEL).mul(zie)));
    const LGl = F(min(float(0.42).mul(fala).add(amb.mul(0.2)), 0.82).mul(mix(jedna, float(0.3), persp)));
    // Korytarz: domino od bramy, błysk mija razem z dziobem.
    const naK = F(jedna.sub(step(0.5, abs(hC.x.sub(uAtlas.x)))).mul(uAtlas.z));
    const dDz = F(hC.y.sub(uAtlas.y).div(900));
    const blysk = F(exp(dDz.mul(dDz).negate()).mul(naK));
    const LKo = F(min(float(0.1).add(blysk.mul(0.7)), 0.84).mul(mix(jedna, float(0.5), persp)).mul(B.z).mul(jedna.sub(smoothstep(B.y.sub(500), B.y, hC.y))));
    // Lejek: chłodna biel, dalsze słabiej; stały znak dolotu.
    const LLe = F(float(0.34).mul(mix(jedna, float(0.7), smoothstep(5000, 25000, hC.y))).mul(mix(jedna, float(0.2), persp)));
    // Słup: stale ledwie widoczny i tylko z daleka (z bliska prosta smuga czyta się jak strzał); czerwony po stronie napływu, biały w przejeździe; kolor i siła z sygnału.
    const naK7 = F(step(0.9, hC.y));
    const dalekoS = F(smoothstep(9, 22, uJ.mul(D)));
    const spoczynek = F(hC.y.mul(0.24).mul(dalekoS));
    const czynny = F(max(red.mul(0.32), B.z.mul(0.3)).mul(naK7).mul(smoothstep(7, 17, uJ.mul(D))));
    const LSl = F(max(spoczynek, czynny));
    const kSl = V3(mix(v3(KORYTARZ), v3(STOP).mul(0.8), red));
    const kolor = V3(kGl.mul(LGl).mul(mGl)
      .add(v3(KORYTARZ).mul(LKo).mul(mKo))
      .add(v3(ZIMNA).mul(LLe).mul(mLe))
      .add(kSl.mul(LSl).mul(mSl)));

    const Vm = cameraViewMatrix;
    const cx = V3(vec3(Vm.element(0).x, Vm.element(1).x, Vm.element(2).x));
    const cy = V3(vec3(Vm.element(0).y, Vm.element(1).y, Vm.element(2).y));
    const cz = V3(vec3(Vm.element(0).z, Vm.element(1).z, Vm.element(2).z));

    vBok.assign(bok);
    vSl.assign(mSl);
    vRdz.assign(clamp(hw.div(szerW), 0.01, 1));
    vKol.assign(clamp(kolor.mul(zanik).mul(goraM).mul(gain).mul(clamp(widocznosc(P), 0, 1)), vec3(0), vec3(4)));
    const offs = cx.mul(n.x).add(cy.mul(n.y)).add(cz.mul(n.z)).mul(szerW).mul(bok);
    return P.add(offs);
  })();

  const fragment = Fn(() => {
    const x = abs(vBok);
    // Obręcz: rdzeń w środkowej 1/3 i miękka poświata do brzegu wstążki; słup: sam Gauss.
    const rdzen = float(1).sub(smoothstep(vRdz.mul(0.25), vRdz, x));
    const pos = exp(x.mul(x).mul(-5)).mul(float(1).sub(smoothstep(0.7, 1, x))).mul(0.13);
    const profS = exp(x.mul(x).mul(-3.2)).mul(float(1).sub(smoothstep(0.75, 1, x)));
    return vec4(clamp(vKol.mul(mix(rdzen.add(pos), profS, vSl)), vec3(0), vec3(4)), 1);
  })();
  return materialAddytywny(fragment, pozycja, 'nawa-obrecze');
}

// ---------------------------------------------------------------------------

export function utworzNawe(ctx) {
  const podklad = zbudujPodklad(ctx.geomWstegi);
  const podloga = zbudujPodloge(ctx);
  const sciany = new THREE.Mesh(zbudujSciany(ctx.siec), zbudujMaterialScian(ctx));
  sciany.frustumCulled = false;
  sciany.renderOrder = 2;
  sciany.name = 'NawaSciany';

  const dane = listaObreczy();
  const STRIDE = 12;
  const ile = dane.length / STRIDE;
  const bufor = new THREE.InstancedInterleavedBuffer(dane, STRIDE, 1);
  const matObr = zbudujMaterialObreczy();
  const dol = new THREE.Mesh(geomPolPetli(-1, bufor, ile), matObr);
  dol.frustumCulled = false;
  dol.renderOrder = 3;
  dol.name = 'NawaObreczeDol';
  const gora = new THREE.Mesh(geomPolPetli(1, bufor, ile), matObr);
  gora.frustumCulled = false;
  gora.renderOrder = 8;
  gora.name = 'NawaObreczeGora';

  // Rzeczy z perspektywą: z = 0 sceny to płaszczyzna gry (grupa stoi na z = −30), inaczej linia i szczyt ściany rozjeżdżają się przy zbliżeniu.
  for (const m of [podklad, sciany, dol, gora]) m.position.z = 30;
  const siatki = [podklad, sciany, dol, gora, podloga];
  for (const m of siatki) ctx.grupa.add(m);

  let wGrze = null;
  function ustawWarstwy(gra) {
    if (wGrze === gra) return;
    wGrze = gra;
    podklad.layers.set(gra ? 1 : 0);
    sciany.layers.set(gra ? 1 : 0);
    dol.layers.set(gra ? 1 : 0);
    gora.layers.set(gra ? 2 : 0);
    const tab = gra ? Z_GRA : Z_KINO;
    const a = uZ.array;
    for (let i = 0; i < 4; i++) a[i].set(tab[i][0], tab[i][1], tab[i][2], tab[i][3]);
  }
  ustawWarstwy(true);

  const fr = (x) => x - Math.floor(x);
  return {
    id: 'nawa',
    nazwa: 'Nawa (ograniczona)',
    opis: 'droga jako wnętrze ze ścian światła: kurtyny w dół, obręcze nad i pod statkiem, czerwone ściany stopu',
    siatki,
    podklad: 0,
    podkladRamp: 0,
    tory: 0.7,
    barBazy: 1,
    promienZiemi: resolveRingPlanetWorldRadius(ctx.ziemia),
    aktualizuj(kl) {
      ustawWarstwy(kl.gra);
      const ruch = ctx.ruch;
      const K7 = ruch.K7;
      const teraz = ruch.czas;
      for (let i = 0; i < 4; i++) {
        const w = K7[i];
        const t = w.tFazy;
        let am = -1;
        let re = -1;
        let op = 0;
        let gr = -1;
        let bar = 0;
        let kf = -1;
        let ka = 0;
        let aa = 0;
        switch (w.faza) {
          case FAZA.YELLOW:
            am = 6000 * t; aa = 1;
            break;
          case FAZA.CLEAR:
            am = 18000 + 6000 * t; aa = 1;
            re = Math.min(12000, 6000 * t);
            bar = Math.min(1, t / 1.5);
            break;
          case FAZA.BOX:
            am = 30000; aa = 1;
            re = 12000; bar = 1;
            op = Math.min(1, t);
            kf = 8700 + 4000 * t;
            ka = Math.min(1, t / 0.4);
            break;
          case FAZA.CLEAR2:
            am = 30000; aa = 1;
            re = 12000; bar = 1;
            op = Math.max(0, 1 - t);
            kf = 30000;
            ka = Math.max(0, 1 - t / 1.5);
            break;
          default:
            // Zwolnienie: zapora rozsuwa się od krawędzi ku medianie, zielone czoło biegnie pod prąd. Start symulacji (MAIN od początku) to nie zwolnienie.
            if (teraz - t > 0.5 && t < 16) {
              bar = Math.max(0, 1 - t / 1.5);
              re = 12000;
              gr = 1500 * t;
              am = 30000;
              aa = Math.max(0, 1 - t / 8);
            }
            break;
        }
        uKA.array[i].set(am, re, op, gr);
        uKB.array[i].set(bar, kf, ka, aa);
      }
      const a = ruch.atlas;
      uAtlas.value.set(a.K, a.z + 900, a.stan === 'lot' ? 1 : 0, 0);

      // Fazy z czasu ruchu, w double po stronie CPU (shader dostaje ułamek).
      const c = U.czas.value;
      uFaz.value.set(fr(c * V_DRYF / P_FALD_A), fr(c * V_DRYF * 0.6 / P_FALD_B), fr(c * V_DRYF / P_DROB), fr(c * 0.04));
      uStr.value.set(fr(c * 800 / LAM_L3) * LAM_L3, fr(c * 1200 / LAM_L2) * LAM_L2, fr(c * 1500 / LAM_L1) * LAM_L1, fr(c / 2.4));
      const h = ctx.Core3D.height || kl.H;
      const px = ctx.Core3D.pxScale || 1;
      uJ.value = 2 * Math.tan((kl.gra ? 35 : (kl.kam.fov || 40)) * 0.5 * DEG) / (h * px);
    }
  };
}
