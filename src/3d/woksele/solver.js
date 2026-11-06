// Solver GPU dema wiązanych wokseli (docs/SPEC-woksele-zawalenia.md § 2): bufory § 2.2, kernele kF, kI, kWstaw, kLista, kZerujPo oraz zdarzenia i pęd § 2.8 (P2).
// Bez obrazu (P3). Moduł bez window i DOM, bez celów renderu: renderer przychodzi z parametru.
// Wzorzec: wzorzec-cpu.js. Test jednego podkroku (§ 8) porównuje wynik kLista + kF z migawką z Node węzeł po węźle, więc kolejność sprawdzeń przy wiązaniu nie może się zmienić.
//
// Czyta wyłącznie stan sprzed przebiegu, pisze tylko swoje kopie: symetria zerwań wynika z tego, że oba końce liczą to samo z tych samych danych.
// Układ danych § 2.2. Wszystko w lokalnym układzie budowli, rozmiary po `uN`, nie po MAX (kernele mają `setCount(n)` liczbą, § 2.2).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Continue, Return, instanceIndex, instancedArray, storage, uniform, uniformArray, uint, int, float, vec3, vec4,
  countOneBits, floatBitsToUint, sqrt, max, min, clamp, floor, round, dot, length, cross, select, atomicAdd, atomicMin, atomicMax, atomicLoad,
} from 'three/tsl';
import { ND, STRONA, N0X, N0Y, N0Z, KLASA_NAZWY, PARAMETRY } from './budowa.js';

/** Słowo sąsiada w polu z rekordu wiązania: bity 0–23 numer, 24–31 klasa + 1. Klasa + 1, żeby słowo nigdy nie było denormalem f32 (§ 2.2). */
export const slowoSasiada = (j, klasa) => (((klasa + 1) << 24) | j) >>> 0;
export const sasiadZeSlowa = (s) => s & 0xffffff;
export const klasaZeSlowa = (s) => (s >>> 24) - 1;

/** Upakowanie ijk i grupy węzła do jednego u32: i 10 bitów, j 10, k 10, grupa 2 (§ 2.2). */
export const slowoIjk = (i, j, k, grupa) => ((i & 1023) | ((j & 1023) << 10) | ((k & 1023) << 20) | ((grupa & 3) << 30)) >>> 0;

const REK_KLASA = 18, REK_LUT = 30, ILE_TAB = 57;

// Zdarzenia § 2.8. wLicz: [0, 1] głowice pierścieni (P4), [2] cel strzału, [3..5] suma kopów, [6] liczba trafionych, [7..9] suma pozycji, [10..12] moment, [13..18] tensor, [19] największe |q|.
const LICZ_N = 20, L_CEL = 2, L_P = 3, L_M = 6, L_S = 7, L_L = 10, L_I = 13, L_QMAX = 19;
export const BLAST_N = 24;    // rzędów pchnięcia na klatkę. Scena pochylonej wieży: główne kule po tau 0,3 s, reszta jedna klatka
export const KRATER_N = 4;    // kraterów na klatkę, reszta czeka do następnej
export const SLOTY_K = 32;    // środki kraterów policzone na GPU (nosiciel, strzał), pierścień
export const BLYSKI = 64;     // pierścień rekordów błysku (§ 4.8), obraz: pyl.js
// Moc, obcięcie promienia ognia i liczba cząstek kłębu wg rodzaju eksplozji (propozycja S5 § 4). Krater bez rodzaju i strzał jak kula główna.
const BLYSK_RODZ = { glowna: { moc: 3.2, rMax: 1e9, klab: 40 }, wieza: { moc: 3.2, rMax: 110, klab: 40 }, wspornik: { moc: 2.4, rMax: 70, klab: 0 }, mala: { moc: 1.8, rMax: 1e9, klab: 10 } };
/** Bit flagi węzła: rozerwanie z kCzas zostawia wiązania wewnątrz ziarna (S = 3 zamiast 2). */
export const BIT_ZOSTAW = 1 << 16;
/** Bit flagi węzła: reszta kuli krateru rozrywa go przez S = 3. Bez bitu węzeł poza rS zostaje nietknięty (scena z szwami). */
export const BIT_PAS = 1 << 17;
const POMIJANY_CEL = 0xffffffff;
export const GINIE_BOK = 64;  // kubełki węzłów, które doleciały do skały w grze: siatka GINIE_BOK² w rzucie XY

export function createWokseleSolver({ maxNodes = 26000, par = PARAMETRY } = {}) {
  const MAX = maxNodes;
  const N_KOM = par.nKom;
  const M = par.slotyListy;
  const S = par.slotyKomorki;
  const REK = M + 1;
  const PODKROKI = par.podkroki;
  const RYTM = par.rytmListy;

  // ── Bufory § 2.2 ── Każdy bufor czytany bez zapisu idzie przez osobny węzeł z toReadOnly: bez tego WGSL dostaje read_write.
  const wWez = instancedArray(3 * MAX, 'vec4').setName('wokWez');
  const wStan = instancedArray(4 * MAX, 'vec4').setName('wokStan');
  const wMaska = instancedArray(2 * MAX, 'uint').setName('wokMaska');
  const wWiaz = instancedArray(36 * MAX, 'vec4').setName('wokWiaz');
  const wLista = instancedArray(REK * MAX, 'uint').setName('wokLista');
  const wKomSloty = instancedArray(S * N_KOM, 'uint').setName('wokKomSloty');
  const aIjk = new THREE.StorageInstancedBufferAttribute(new Uint32Array(MAX), 1);
  const aTab = new THREE.StorageInstancedBufferAttribute(new Float32Array(4 * ILE_TAB), 4);
  const aKomLicz = new THREE.StorageInstancedBufferAttribute(new Uint32Array(N_KOM), 1);
  const wWezR = storage(wWez.value, 'vec4', 3 * MAX).setName('wokWez').toReadOnly();
  const wMaskaR = storage(wMaska.value, 'uint', 2 * MAX).setName('wokMaska').toReadOnly();
  const wListaR = storage(wLista.value, 'uint', REK * MAX).setName('wokLista').toReadOnly();
  const wKomSlotyR = storage(wKomSloty.value, 'uint', S * N_KOM).setName('wokKomSloty').toReadOnly();
  const wIjkR = storage(aIjk, 'uint', MAX).setName('wokIjk').toReadOnly();
  const wTabR = storage(aTab, 'vec4', ILE_TAB).setName('wokTab').toReadOnly();
  // Trzy węzły na jednym atrybucie licznika komórek: atomowy w kWstaw, czytany w kLista, zwykły zapis w kZerujPo (§ 2.2).
  const wKomLiczA = storage(aKomLicz, 'uint', N_KOM).setName('wokKomLicz').toAtomic();
  const wKomLiczR = storage(aKomLicz, 'uint', N_KOM).setName('wokKomLicz').toReadOnly();
  const wKomLiczW = storage(aKomLicz, 'uint', N_KOM).setName('wokKomLicz');
  // Zdarzenia § 2.8: czas zdarzenia węzła, liczniki sum (trzy węzły na jednym atrybucie, jak licznik komórek), środki kraterów z GPU.
  const wCzasU = instancedArray(MAX, 'float').setName('wokCzasU');
  const aLicz = new THREE.StorageInstancedBufferAttribute(new Uint32Array(LICZ_N), 1);
  const wLiczA = storage(aLicz, 'uint', LICZ_N).setName('wokLicz').toAtomic();
  const wLiczR = storage(aLicz, 'uint', LICZ_N).setName('wokLicz').toReadOnly();
  const wLiczW = storage(aLicz, 'uint', LICZ_N).setName('wokLicz');
  const wBlastK = instancedArray(SLOTY_K, 'vec4').setName('wokBlastK');
  const wBlastKR = storage(wBlastK.value, 'vec4', SLOTY_K).setName('wokBlastK').toReadOnly();
  // Przyczyna w obrazie (§ 4.8, pakiet P4): rekordy błysku z kKraterCel, chwila żaru węzła z kKrater. Fizyka ich nie czyta. Reszta w pyl.js i obraz.js.
  const wBlysk = instancedArray(3 * BLYSKI, 'vec4').setName('wokBlysk');
  const wZar = instancedArray(MAX, 'float').setName('wokZar');
  const wStanR = storage(wStan.value, 'vec4', 4 * MAX).setName('wokStan').toReadOnly();
  const wWiazR = storage(wWiaz.value, 'vec4', 36 * MAX).setName('wokWiaz').toReadOnly();

  // ── Uniformy § 10.4 i § 2.1 ── Zmiana sceny to zmiana wartości, bez nowych pipeline'ów (zasada 4).
  const uN = uniform(0, 'uint').setName('uN');
  const uH = uniform(1 / 480).setName('uH');
  const uK = uniform(30000).setName('uK');
  const uCB = uniform(0).setName('uCB');
  const uKB = uniform(0).setName('uKB');
  const uKC = uniform(0).setName('uKC');
  const uCC = uniform(0).setName('uCC');
  const uCT = uniform(0).setName('uCT');
  const uCosWyp = uniform(0).setName('uCosWyp');
  const uGStala = uniform(new THREE.Vector3()).setName('uGStala');
  // AGENT: bez uniformów vec4. three r183 UniformsGroup.updateVector4 porównuje a[offset + 4] zamiast a[offset + 3]: zmiana samego w przepada, gdy następne pole równa się nowemu w
  // (domyślne new Vector4() ma w = 1, set(0, 0, 0, 0) nie dochodziło do bufora i każdy węzeł dostawał odśrodkową ω = 1, § 10.4).
  const uGPunktC = uniform(new THREE.Vector3()).setName('uGPunktC');
  const uGPunktG = uniform(0).setName('uGPunktG');
  const uGPunktR0 = uniform(0).setName('uGPunktR0');
  const uGMiesz = uniform(new THREE.Vector2()).setName('uGMiesz'); // gra: pod z = x pole stałe przechodzi w punkt na drodze 1 / y. y = 0: suma obu, jak w scenach dema
  const uGObrotP = uniform(new THREE.Vector3()).setName('uGObrotP');
  const uGObrotOm = uniform(0).setName('uGObrotOm');
  const uGOs = uniform(new THREE.Vector3(0, 0, 1)).setName('uGOs');
  const uSkG = uniform(1).setName('uSkG');
  const uSkF0 = uniform(1).setName('uSkF0');
  const uKotwice = uniform(1, 'uint').setName('uKotwice');
  const uGruntZ = uniform(-1e30).setName('uGruntZ');
  const uGinieC = uniform(new THREE.Vector3()).setName('uGinieC');
  const uGinieR2 = uniform(0).setName('uGinieR2');
  const uKulaR = uniform(0).setName('uKulaR');
  const uLiczR2 = uniform(0).setName('uLiczR2');
  const uGinieMin = uniform(new THREE.Vector2()).setName('uGinieMin');
  const uGinieKom = uniform(1000).setName('uGinieKom');
  const aGinie = new THREE.StorageInstancedBufferAttribute(new Uint32Array(GINIE_BOK * GINIE_BOK), 1);
  const wGinieW = storage(aGinie, 'uint', GINIE_BOK * GINIE_BOK).setName('wokGinie');
  const wGinieA = storage(aGinie, 'uint', GINIE_BOK * GINIE_BOK).setName('wokGinie').toAtomic();
  const uDxP = uniform(10).setName('uDxP');
  const uCap = uniform(0).setName('uCap');
  const uLepL = uniform(0).setName('uLepL');
  const uLepV2 = uniform(0).setName('uLepV2');
  const uGruzP = uniform(0).setName('uGruzP');
  const uGruzV2 = uniform(0).setName('uGruzV2');
  const uFalaV2 = uniform(1e30).setName('uFalaV2');
  const uFalaTempoH = uniform(0).setName('uFalaTempoH');
  const uSzokProg = uniform(30).setName('uSzokProg');
  const uKontaktV = uniform(120).setName('uKontaktV');
  const uIKom = uniform(0).setName('uIKom');
  const uZasieg2 = uniform(0).setName('uZasieg2');
  // Parametry końcowe jako uniformy tylko po to, żeby mutacje § 8 szły przez ten sam kernel, a nie przez drugi pipeline.
  const uPekaProg = uniform(par.falaPeka.prog).setName('uPekaProg');
  const uPekaZakres = uniform(par.falaPeka.zakres).setName('uPekaZakres');
  const uZlomB2 = uniform(par.zlomB * par.zlomB).setName('uZlomB2');
  // Zdarzenia § 2.8. Czas w KLATKACH, nie w sekundach: w f32 przy t = 14 s sekundy gubią przydział do klatki, a Node liczy klatkami.
  const uT = uniform(0).setName('uT');
  const uBrakCzasu = uniform(1e30).setName('uBrakCzasu'); // literał 1e30 daje w WGSL 1e+30.0
  const uCelO = uniform(new THREE.Vector3()).setName('uCelO');
  const uCelDir = uniform(new THREE.Vector3(1, 0, 0)).setName('uCelDir');
  const uCelProg2 = uniform(0).setName('uCelProg2');
  const uKraterN = uniform(0, 'uint').setName('uKraterN');
  const uBlastN = uniform(0, 'uint').setName('uBlastN');
  const uZerujL = uniform(1, 'uint').setName('uZerujL');
  // AGENT: tablice uniformów vec4 nie mają błędu z § 1.7 (idą przez Float32Array, nie przez updateVector4). Rzędy pisze CPU raz na klatkę, kernele czytają pierwsze uKraterN / uBlastN.
  // uKrater, 3 × rząd: c.xyz + r²; rdzeń², rS², slot wBlastK, nosiciel (≥ 0 węzeł, −1 punkt z rzędu, −2 strzał); usuwa stojące, 0, 0, 0.
  const daneKrater = Array.from({ length: 3 * KRATER_N }, () => new THREE.Vector4());
  const uKrater = uniformArray(daneKrater, 'vec4').setName('uKrater');
  // uBlast, 2 × rząd: c.xyz + rP; Jk, slot wBlastK (−1: środek z rzędu), dz do środka ze slotu, 0.
  const daneBlast = Array.from({ length: 2 * BLAST_N }, () => new THREE.Vector4());
  const uBlast = uniformArray(daneBlast, 'vec4').setName('uBlast');

  // Zmienna o typie ze stałej, przypisana w miejscu (pułapka 40): budowa grafu bez wykładniczego pytania o typ.
  const fv = (e) => { const v = float(0).toVar(); v.assign(e); return v; };
  const uv = (e) => { const v = uint(0).toVar(); v.assign(e); return v; };
  const iv = (e) => { const v = int(0).toVar(); v.assign(e); return v; };
  const v3 = (e) => { const v = vec3(0).toVar(); v.assign(e); return v; };
  const v4 = (e) => { const v = vec4(0).toVar(); v.assign(e); return v; };

  const haszKomorki = (a, b, c) => uint(a.mul(int(73856093)).bitXor(b.mul(int(19349663))).bitXor(c.mul(int(83492791)))).bitAnd(uint(N_KOM - 1));
  const komorkaOsi = (x) => iv(floor(x.mul(uIKom)));

  /** Pole grawitacji w węźle (§ 10.4): stały wektor + punkt + obrót, bez gałęzi po scenie. Wklejane, woła się tylko w Fn. */
  const gNaWezle = (x, v) => {
    const g = v3(uGStala);
    If(uGPunktG.greaterThan(0), () => {
      const e = v3(uGPunktC.sub(x));
      const r2 = fv(dot(e, e).add(1e-6));
      const a = fv(select(uGPunktR0.greaterThan(0), uGPunktG.mul(uGPunktR0).mul(uGPunktR0).div(r2), uGPunktG));
      const t = fv(clamp(uGMiesz.x.sub(x.z).mul(uGMiesz.y), 0, 1));
      const w = fv(select(uGMiesz.y.greaterThan(0), t, float(1)));
      g.assign(g.mul(float(1).sub(t)).add(e.mul(a.mul(w).div(sqrt(r2)))));
    });
    If(uGObrotOm.notEqual(0), () => {
      const e = v3(x.sub(uGObrotP));
      const c = fv(dot(e, uGOs));
      g.addAssign(e.sub(uGOs.mul(c)).mul(uGObrotOm.mul(uGObrotOm)));
      g.addAssign(cross(uGOs, v).mul(uGObrotOm.mul(-2)));
    });
    return g.mul(uSkG);
  };

  // ── Kernel F, § 2.5 ── Lista kontrolna gałęzi § 2.11: martwy, fala łamie, krusz, sprężenie i wypiek, rozciąganie, ściskanie, tłumienie,
  // zginanie (dwie gałęzie plastyczne), maska, szkoda i szok, fala, stoi, kontakty z parą, impakt, etykieta, grawitacja i waga, grunt, lepkość.
  const kF = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const ni = uv(uN.add(i));
    const i3 = uv(uint(3).mul(i));
    const pi = v4(wWez.element(i3));
    const xi = v3(pi.xyz);
    const ri = fv(pi.w);
    If(ri.lessThan(0), () => {
      wMaska.element(ni).assign(uint(0));
      wStan.element(ni).x.assign(1);
      Return();
    });
    const vi = v3(wWez.element(i3.add(uint(1))).xyz);
    const bazaSt = uv(uN.mul(uint(2)).add(uint(2).mul(i)));
    const st0 = v4(wStan.element(bazaSt)); // bMax², rozlewW, szokW, iN0
    const st1 = v4(wStan.element(bazaSt.add(uint(1)))); // kUd, aLos, jasność, flagi
    const flagi = uv(uint(st1.w));
    const stoi = uv(flagi.bitAnd(uint(1)).mul(uKotwice));
    const nosny = uv(flagi.shiftRight(uint(1)).bitAnd(uint(1)));
    const si = v4(wStan.element(i)); // S, A, etykieta
    const szI = fv(si.x);
    const aI = fv(si.y);
    const eI = fv(si.z);
    const mI = uv(wMaska.element(i));
    const mNowa = uv(mI);
    const eMin = fv(65535);
    const szSas = fv(0);
    const aSas = fv(0);
    const sv = v3(vec3(0));
    const sn = fv(0);
    const a = v3(vec3(0));
    const baza = uv(uint(36).mul(i));

    Loop({ start: uint(0), end: uint(ND), type: 'uint', condition: '<', name: 'd' }, ({ d }) => {
      const bit = uv(uint(1).shiftLeft(d));
      If(mI.bitAnd(bit).equal(uint(0)), () => { Continue(); });
      const ox = uv(baza.add(uint(2).mul(d)));
      const w1 = v4(wWiaz.element(ox)); // L, D, F0, R0
      const w2 = v4(wWiaz.element(ox.add(uint(1)))); // Ft, Fc, sąsiad jako bity f32
      const nb = uv(floatBitsToUint(w2.z));
      const j = uv(nb.bitAnd(uint(0xffffff)));
      const kl = uv(nb.shiftRight(uint(24)).sub(uint(1)));
      const j3 = uv(uint(3).mul(j));
      const dX = v3(wWez.element(j3).xyz.sub(xi));
      const r = fv(max(length(dX), 1e-4));
      const n = v3(dX.div(r));
      const Lb = fv(w1.x);
      const f = fv(uK.mul(r.sub(Lb)));
      const dmg = fv(w1.y);
      const kap = fv(float(1).sub(dmg));
      const f0z = fv(w1.z);
      const f0b = fv(f0z.mul(uSkF0));
      const R0 = fv(w1.w);
      const sj = v4(wStan.element(j));
      const szJ = fv(sj.x);
      const aJ = fv(sj.y);
      const eJ = fv(sj.z);
      szSas.assign(max(szSas, szJ));
      aSas.assign(max(aSas, aJ));
      // Fala łamie granicę ziaren: próg z hasha PARY, A obu końców sprzed przebiegu, więc zerwanie symetryczne.
      If(kl.lessThan(uint(4)), () => {
        const aB = fv(max(aI, aJ));
        If(aB.greaterThan(uPekaProg), () => {
          const lo = uv(min(i, j));
          const hi = uv(max(i, j));
          const h0 = uv(lo.mul(uint(73856093)).bitXor(hi.mul(uint(19349663))));
          const h1 = uv(h0.bitXor(h0.shiftRight(uint(13))).mul(uint(0x5bd1e995)));
          const h2 = uv(h1.bitXor(h1.shiftRight(uint(15))));
          If(aB.greaterThan(uPekaProg.add(uPekaZakres.mul(float(h2.bitAnd(uint(1023)))).div(1023))), () => {
            mNowa.assign(mNowa.bitAnd(bit.bitNot()));
            Continue();
          });
        });
      });
      const tk = v4(wTabR.element(uint(REK_KLASA).add(kl))); // iT, iC, krusz
      If(tk.z.greaterThan(0), () => {
        kap.mulAssign(max(float(1).sub(tk.z.mul(max(szI, szJ))), 0.03));
      });
      // Sprężenie martwe: siła wzdłuż kierunku projektowego. Wypiek przy uplastycznieniu, obrocie wiązania albo oderwaniu od kotwicy.
      If(f0b.notEqual(0), () => {
        const n0 = v3(wTabR.element(d).xyz);
        const ft = fv(f.add(f0b));
        const limS = fv(select(ft.greaterThan(0), w2.x, w2.y).mul(kap));
        const oderw = uCap.greaterThan(0).and(max(eI, eJ).greaterThanEqual(uCap));
        If(dot(n, n0).lessThan(uCosWyp).or(ft.abs().greaterThan(limS)).or(oderw), () => {
          Lb.subAssign(f0b.div(uK));
          f0z.assign(0);
          wWiaz.element(ox).assign(vec4(Lb, dmg, 0, R0));
          f.assign(uK.mul(r.sub(Lb)));
        }).Else(() => {
          const w = v3(wWez.element(j3.add(uint(1))).xyz.sub(vi));
          sv.addAssign(w);
          sn.addAssign(1);
          const Fb = fv(f.add(uCB.mul(dot(w, n))));
          a.addAssign(n.mul(Fb).add(n0.mul(f0b)));
          eMin.assign(min(eMin, eJ));
          Continue();
        });
      });
      If(f.greaterThan(0), () => {
        const lim = fv(w2.x.mul(kap));
        If(f.greaterThan(lim), () => {
          const nad = fv(f.sub(lim).div(uK));
          Lb.addAssign(nad);
          const dN = fv(dmg.add(nad.mul(tk.x)));
          wWiaz.element(ox).assign(vec4(Lb, dN, f0z, R0));
          f.assign(lim);
          If(dN.greaterThanEqual(1), () => { mNowa.assign(mNowa.bitAnd(bit.bitNot())); Continue(); });
        });
        If(r.greaterThan(R0.mul(1 + par.rozcHard)), () => { mNowa.assign(mNowa.bitAnd(bit.bitNot())); Continue(); });
      }).Else(() => {
        const lim = fv(w2.y.mul(kap));
        If(f.negate().greaterThan(lim), () => {
          const nad = fv(f.negate().sub(lim).div(uK));
          Lb.subAssign(nad);
          const dN = fv(dmg.add(nad.mul(tk.y)));
          wWiaz.element(ox).assign(vec4(Lb, dN, f0z, R0));
          f.assign(lim.negate());
          If(dN.greaterThanEqual(1), () => { mNowa.assign(mNowa.bitAnd(bit.bitNot())); Continue(); });
        });
        If(r.lessThan(R0.mul(par.sciskHard)), () => { mNowa.assign(mNowa.bitAnd(bit.bitNot())); Continue(); });
      });
      const w = v3(wWez.element(j3.add(uint(1))).xyz.sub(vi));
      sv.addAssign(w);
      sn.addAssign(1);
      const Fb = fv(f.add(uCB.mul(dot(w, n))));
      a.addAssign(n.mul(Fb));
      eMin.assign(min(eMin, eJ));
    });

    // Zginanie, linie osiowe. Energia zależy tylko od |b|, pięciopunktowo, więc pęd zachowany.
    const bMi = fv(st0.x);
    const kB2 = fv(uKB.mul(2));
    Loop({ start: uint(0), end: uint(6), type: 'uint', condition: '<', name: 'dg' }, ({ dg }) => {
      const bit = uv(uint(1).shiftLeft(dg));
      If(mI.bitAnd(bit).equal(uint(0)), () => { Continue(); });
      const j = uv(floatBitsToUint(wWiaz.element(baza.add(uint(2).mul(dg)).add(uint(1))).z).bitAnd(uint(0xffffff)));
      const xj = v3(wWez.element(uint(3).mul(j)).xyz);
      const mJ = uv(wMaska.element(j));
      const dp = uv(dg.bitXor(uint(1)));
      // Bit sąsiada jest już pod ręką: wiązanie osiowe żyje tylko przy obu bitach (§ 2.5, zabezpieczenie symetrii; w Node nigdy nie działa).
      If(mJ.bitAnd(uint(1).shiftLeft(dp)).equal(uint(0)), () => { mNowa.assign(mNowa.bitAnd(bit.bitNot())); });
      // i jest końcem, środek w j, drugi koniec jj.
      If(mJ.bitAnd(bit).notEqual(uint(0)), () => {
        const jj = uv(floatBitsToUint(wWiaz.element(uint(36).mul(j).add(uint(2).mul(dg)).add(uint(1))).z).bitAnd(uint(0xffffff)));
        const b = v3(xi.add(wWez.element(uint(3).mul(jj)).xyz).sub(xj.mul(2)));
        const b2 = fv(dot(b, b));
        const bMj = fv(wStan.element(uN.mul(uint(2)).add(uint(2).mul(j))).x);
        If(b2.greaterThan(bMj).and(b2.lessThanEqual(bMj.mul(uZlomB2))), () => {
          a.subAssign(b.mul(uKB.mul(sqrt(bMj.div(b2)))));
        }).ElseIf(b2.greaterThan(bMj), () => {
          mNowa.assign(mNowa.bitAnd(bit.bitNot()));
        }).Else(() => {
          a.subAssign(b.mul(uKB));
        });
      });
      // i jest środkiem: raz na oś (d parzyste), drugi koniec w d ^ 1.
      If(dg.bitAnd(uint(1)).equal(uint(0)).and(mI.bitAnd(uint(1).shiftLeft(dp)).notEqual(uint(0))), () => {
        const k = uv(floatBitsToUint(wWiaz.element(baza.add(uint(2).mul(dp)).add(uint(1))).z).bitAnd(uint(0xffffff)));
        const b = v3(xj.add(wWez.element(uint(3).mul(k)).xyz).sub(xi.mul(2)));
        const b2 = fv(dot(b, b));
        If(b2.greaterThan(bMi).and(b2.lessThanEqual(bMi.mul(uZlomB2))), () => {
          a.addAssign(b.mul(kB2.mul(sqrt(bMi.div(b2)))));
        }).ElseIf(b2.greaterThan(bMi), () => {
          mNowa.assign(mNowa.bitAnd(bit.bitNot()).bitAnd(uint(1).shiftLeft(dp).bitNot()));
        }).Else(() => {
          a.addAssign(b.mul(kB2));
        });
      });
    });

    wMaska.element(ni).assign(mNowa);

    // Szkoda i szok (prędkości WZGLĘDNE, w próżni bez zmian).
    const sN = fv(max(max(float(1).sub(float(countOneBits(mI)).mul(st0.w)), st0.y.mul(szSas)), szI));
    If(st0.z.greaterThan(0).and(sn.greaterThan(0)), () => {
      const dv = fv(length(sv).div(sn).div(uSzokProg));
      If(dv.greaterThan(1), () => { sN.assign(max(sN, min(st0.z.mul(dv.sub(1)), 0.95))); });
    });
    // Fala, bez dysku. Próg z ramy: 1e30 bez ramy (§ 10.3).
    const aN = fv(aI);
    If(nosny.equal(uint(0)), () => {
      If(dot(vi, vi).greaterThan(uFalaV2), () => {
        const cel = fv(select(szI.greaterThan(par.fala.prog), float(1), aSas.mul(par.fala.oslab)));
        If(cel.greaterThan(aN), () => { aN.addAssign(cel.sub(aN).mul(uFalaTempoH)); });
      });
      sN.assign(max(sN, aN.mul(st1.y).mul(par.fala.aMax)));
    });
    If(stoi.notEqual(uint(0)), () => {
      wStan.element(ni).assign(vec4(sN, aN, 0, 0)); // kotwica i fundament: tylko własne kopie stanu
      Return();
    });

    // Kontakty. Zakleszczenie PARY: względem partnera, pęd zachowany.
    const lb = uv(uint(REK).mul(i));
    const ile = uv(wListaR.element(lb));
    const udar = fv(0);
    Loop({ start: uint(0), end: ile, type: 'uint', condition: '<', name: 'ck' }, ({ ck }) => {
      const j3 = uv(uint(3).mul(wListaR.element(lb.add(uint(1)).add(ck))));
      const pj = v4(wWez.element(j3));
      If(pj.w.lessThan(0), () => { Continue(); });
      const dX = v3(pj.xyz.sub(xi));
      const sm = fv(ri.add(pj.w));
      const r2 = fv(dot(dX, dX));
      If(r2.greaterThanEqual(sm.mul(sm)).or(r2.lessThan(1e-8)), () => { Continue(); });
      const r = fv(sqrt(r2));
      const n = v3(dX.div(r));
      const w = v3(wWez.element(j3.add(uint(1))).xyz.sub(vi));
      const vn = fv(dot(w, n));
      const Fn_ = fv(uKC.mul(sm.sub(r)).sub(uCC.mul(vn)));
      If(Fn_.lessThanEqual(0), () => { Continue(); });
      udar.assign(max(udar, vn.negate()));
      a.subAssign(n.mul(Fn_));
      If(dot(w, w).lessThan(uGruzV2), () => { a.addAssign(w.mul(uGruzP)); });
      const t = v3(w.sub(n.mul(vn)));
      const vt = fv(length(t));
      If(vt.greaterThan(1e-3), () => {
        a.addAssign(t.mul(min(Fn_.mul(par.mu), uCT.mul(vt)).div(vt)));
      });
    });
    If(st1.x.greaterThan(0).and(udar.greaterThan(uKontaktV)), () => {
      sN.assign(max(sN, min(st1.x.mul(udar.div(uKontaktV).sub(1)), 0.95)));
    });

    // Etykieta dla wszystkich węzłów. Przy uCap = 0 wychodzi 0 i nic jej nie czyta (§ 1.6).
    const e = fv(select(eMin.equal(65535), uCap, min(eMin.add(1), uCap)));
    wStan.element(ni).assign(vec4(sN, aN, e, 0));

    // Grawitacja [G] i waga dysku od szkody.
    const gi = v3(gNaWezle(xi, vi));
    If(nosny.notEqual(uint(0)), () => {
      If(e.greaterThanEqual(uCap), () => {
        a.addAssign(gi);
      }).ElseIf(szI.greaterThan(par.wagaProg), () => {
        a.addAssign(gi.mul(min(szI.sub(par.wagaProg).mul(par.wagaS), 1)));
      });
    }).Else(() => {
      a.addAssign(gi);
    });

    // Grunt [G]: bez gruntu uGruntZ = −1e30.
    const zG = fv(uGruntZ.add(uDxP));
    If(xi.z.lessThan(zG), () => {
      const Fg = fv(uKC.mul(zG.sub(xi.z)).sub(uCC.mul(vi.z)));
      If(Fg.greaterThan(0), () => {
        a.addAssign(vec3(0, 0, Fg));
        If(dot(vi, vi).lessThan(uGruzV2), () => { a.subAssign(vi.mul(uGruzP)); });
        const vt = fv(length(vi.xy));
        If(vt.greaterThan(1e-3), () => {
          const sk = fv(min(Fg.mul(par.muGrunt), uCT.mul(vt)).div(vt));
          a.subAssign(vec3(vi.x.mul(sk), vi.y.mul(sk), 0));
        });
      });
    });

    // Gra: skała pod bazą jak grunt, tylko kula: siła wzdłuż normalnej, tłumienie, tarcie styczne. Demo: uKulaR = 0, warunek odpada.
    If(uKulaR.greaterThan(0), () => {
      const eK = v3(xi.sub(uGinieC));
      const dK = fv(length(eK));
      const penK = fv(uKulaR.add(uDxP).sub(dK));
      If(penK.greaterThan(0), () => {
        const nK = v3(eK.div(max(dK, 1)));
        const vnK = fv(dot(vi, nK));
        // Uderzenie prawie nieelastyczne: składowa ku skale gaśnie w kilka podkroków. Sama sprężyna z tłumieniem przy 4000 j./s odbijała węzły na pół planety (GRA/t6).
        If(vnK.lessThan(0), () => { a.subAssign(nK.mul(vnK).mul(float(0.7).div(uH))); });
        const FgK = fv(uKC.mul(penK).sub(uCC.mul(vnK)));
        If(FgK.greaterThan(0), () => {
          a.addAssign(nK.mul(FgK));
          If(dot(vi, vi).lessThan(uGruzV2), () => { a.subAssign(vi.mul(uGruzP)); });
          const vtK = v3(vi.sub(nK.mul(vnK)));
          const vtlK = fv(length(vtK));
          If(vtlK.greaterThan(1e-3), () => {
            a.subAssign(vtK.mul(min(FgK.mul(par.muGrunt), uCT.mul(vtlK)).div(vtlK)));
          });
        });
      });
    });

    // Lepkość spoczynkowa [G]: tylko z żywą drogą do kotwicy, etykieta sprzed przebiegu.
    If(eI.lessThan(uCap).and(dot(vi, vi).lessThan(uLepV2)), () => { a.subAssign(vi.mul(uLepL)); });

    wWez.element(i3.add(uint(2))).assign(vec4(a, 0));
  })().compute(MAX).setName('wokF');

  // ── Kernel I, § 2.6 ── Półjawny Euler. Martwy i stojący: tylko kopia stanu.
  const vMax2 = par.vMax * par.vMax;
  const kI = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const ni = uv(uN.add(i));
    wStan.element(i).assign(wStan.element(ni));
    wMaska.element(i).assign(wMaska.element(ni));
    const i3 = uv(uint(3).mul(i));
    const p = v4(wWez.element(i3));
    const fl = uv(uint(wStan.element(uN.mul(uint(2)).add(uint(2).mul(i)).add(uint(1))).w));
    If(p.w.lessThan(0).or(fl.bitAnd(uint(1)).mul(uKotwice).notEqual(uint(0))), () => { Return(); });
    const v = v3(wWez.element(i3.add(uint(1))).xyz.add(wWez.element(i3.add(uint(2))).xyz.mul(uH)));
    const v2 = fv(dot(v, v));
    If(v2.greaterThan(vMax2), () => { v.mulAssign(sqrt(float(vMax2).div(v2))); });
    const xN = v3(p.xyz.add(v.mul(uH)));
    // Gra: bezpiecznik kontaktu ze skałą (kF, uKulaR): węzeł wbity głęboko pod powierzchnię ginie, zamiast wracać z ogromną siłą. Demo: R² = 0, warunek nigdy nie zachodzi.
    const doSkaly = v3(xN.sub(uGinieC));
    If(dot(doSkaly, doSkaly).lessThan(uGinieR2), () => {
      wWez.element(i3).assign(vec4(xN, -1));
      wWez.element(i3.add(uint(1))).assign(vec4(0));
      wMaska.element(i).assign(uint(0));
      wMaska.element(ni).assign(uint(0));
      Return();
    });
    wWez.element(i3.add(uint(1))).assign(vec4(v, 0));
    wWez.element(i3).assign(vec4(xN, p.w));
  })().compute(MAX).setName('wokI');

  // ── Lista kontaktów, § 2.7 ──
  const kZerujPo = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const p = v4(wWezR.element(uint(3).mul(i)));
    If(p.w.lessThan(0), () => { Return(); });
    const h = uv(haszKomorki(komorkaOsi(p.x), komorkaOsi(p.y), komorkaOsi(p.z)));
    wKomLiczW.element(h).assign(uint(0));
  })().compute(MAX).setName('wokZerujPo');

  const kWstaw = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const p = v4(wWezR.element(uint(3).mul(i)));
    If(p.w.lessThan(0), () => { Return(); });
    const h = uv(haszKomorki(komorkaOsi(p.x), komorkaOsi(p.y), komorkaOsi(p.z)));
    const q = atomicAdd(wKomLiczA.element(h), uint(1)).toVar();
    If(q.lessThan(uint(S)), () => { wKomSloty.element(h.mul(uint(S)).add(q)).assign(i); });
  })().compute(MAX).setName('wokWstaw');

  const kLista = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const lb = uv(uint(REK).mul(i));
    const p = v4(wWezR.element(uint(3).mul(i)));
    If(p.w.lessThan(0), () => { wLista.element(lb).assign(uint(0)); Return(); });
    const xi = v3(p.xyz);
    const a0 = komorkaOsi(p.x);
    const b0 = komorkaOsi(p.y);
    const c0 = komorkaOsi(p.z);
    const ijk = uv(wIjkR.element(i));
    const mI = uv(wMaskaR.element(i));
    const l = uv(uint(0));
    Loop({ start: int(-1), end: int(2), type: 'int', condition: '<', name: 'dc' }, ({ dc }) => {
      Loop({ start: int(-1), end: int(2), type: 'int', condition: '<', name: 'db' }, ({ db }) => {
        Loop({ start: int(-1), end: int(2), type: 'int', condition: '<', name: 'da' }, ({ da }) => {
          const ca = iv(a0.add(da));
          const cb = iv(b0.add(db));
          const cc = iv(c0.add(dc));
          const h = uv(haszKomorki(ca, cb, cc));
          const ile = uv(min(wKomLiczR.element(h), uint(S)));
          Loop({ start: uint(0), end: ile, type: 'uint', condition: '<', name: 'q' }, ({ q }) => {
            const j = uv(wKomSlotyR.element(h.mul(uint(S)).add(q)));
            If(j.equal(i), () => { Continue(); });
            const pj = v3(wWezR.element(uint(3).mul(j)).xyz);
            const dX = v3(pj.sub(xi));
            // Najpierw zasięg: odrzuca około 80% kandydatów przed trzema floor (§ 2.7).
            If(dot(dX, dX).greaterThanEqual(uZasieg2), () => { Continue(); });
            If(komorkaOsi(pj.x).notEqual(ca).or(komorkaOsi(pj.y).notEqual(cb)).or(komorkaOsi(pj.z).notEqual(cc)), () => { Continue(); });
            const ij2 = uv(wIjkR.element(j));
            // Ta sama grupa i sąsiednia komórka siatki budynku: żywe wiązanie wyłącza kontakt.
            If(ij2.shiftRight(uint(30)).equal(ijk.shiftRight(uint(30))), () => {
              const di = iv(int(ij2.bitAnd(uint(1023))).sub(int(ijk.bitAnd(uint(1023)))));
              const dj = iv(int(ij2.shiftRight(uint(10)).bitAnd(uint(1023))).sub(int(ijk.shiftRight(uint(10)).bitAnd(uint(1023)))));
              const dk = iv(int(ij2.shiftRight(uint(20)).bitAnd(uint(1023))).sub(int(ijk.shiftRight(uint(20)).bitAnd(uint(1023)))));
              If(di.greaterThanEqual(int(-1)).and(di.lessThanEqual(int(1))).and(dj.greaterThanEqual(int(-1))).and(dj.lessThanEqual(int(1))).and(dk.greaterThanEqual(int(-1))).and(dk.lessThanEqual(int(1))), () => {
                const lut = fv(wTabR.element(uint(int(REK_LUT).add(dk.add(int(1)).mul(int(9))).add(dj.add(int(1)).mul(int(3))).add(di).add(int(1)))).x);
                If(lut.greaterThanEqual(0), () => {
                  If(mI.bitAnd(uint(1).shiftLeft(uint(lut))).notEqual(uint(0)), () => { Continue(); });
                });
              });
            });
            If(l.lessThan(uint(M)), () => {
              wLista.element(lb.add(uint(1)).add(l)).assign(j);
              l.addAssign(uint(1));
            });
          });
        });
      });
    });
    wLista.element(lb).assign(l);
  })().compute(MAX).setName('wokLista');

  // ── Zdarzenia, § 2.8 ── Cudzych zapisów nie ma: kCzas i kKrater oznaczają w S, kCzysc czyści własne bity każdego węzła, kCzyscS sprowadza S do ≤ 1.
  const flagiWezla = (wS, i) => uv(uint(wS.element(uN.mul(uint(2)).add(uint(2).mul(i)).add(uint(1))).w));

  /** Usunięcie: węzeł martwy, prędkość 0, S = 1, własne maski 0 (§ 2.8, jak `usun`). */
  const usunWezel = (i, i3, p) => {
    wWez.element(i3).assign(vec4(p.xyz, -1));
    wWez.element(i3.add(uint(1))).assign(vec4(0));
    wMaska.element(i).assign(uint(0));
    wMaska.element(uN.add(i)).assign(uint(0));
    wStan.element(i).x.assign(1);
  };

  const kCzas = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const t = fv(wCzasU.element(i));
    If(t.abs().greaterThan(uT), () => { Return(); }); // brak zdarzenia: 1e30
    wCzasU.element(i).assign(uBrakCzasu);
    const i3 = uv(uint(3).mul(i));
    const p = v4(wWez.element(i3));
    If(p.w.lessThan(0), () => { Return(); });
    If(t.greaterThan(0), () => {
      usunWezel(i, i3, p);
    }).Else(() => {
      const zostaw = uv(flagiWezla(wStan, i).bitAnd(uint(BIT_ZOSTAW)));
      const znak = fv(2);
      If(zostaw.notEqual(uint(0)), () => { znak.assign(3); });
      wStan.element(i).x.assign(znak);
    });
  })().compute(MAX).setName('wokCzas');

  const kCzysc = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const ni = uv(uN.add(i));
    const wI = fv(wWezR.element(uint(3).mul(i)).w);
    If(wI.lessThan(0), () => { wMaska.element(ni).assign(uint(0)); Return(); });
    const mI = uv(wMaska.element(i));
    const mN = uv(mI);
    const sI = fv(wStanR.element(i).x);
    const baza = uv(uint(36).mul(i));
    Loop({ start: uint(0), end: uint(ND), type: 'uint', condition: '<', name: 'd' }, ({ d }) => {
      const bit = uv(uint(1).shiftLeft(d));
      If(mI.bitAnd(bit).equal(uint(0)), () => { Continue(); });
      const nb = uv(floatBitsToUint(wWiazR.element(baza.add(uint(2).mul(d)).add(uint(1))).z));
      const j = uv(nb.bitAnd(uint(0xffffff)));
      const kl = uv(nb.shiftRight(uint(24)).sub(uint(1)));
      const sJ = fv(wStanR.element(j).x);
      const wJ = fv(wWezR.element(uint(3).mul(j)).w);
      const miedzyZiarnami = uv(uint(0));
      If(kl.lessThan(uint(6)), () => { miedzyZiarnami.assign(uint(1)); });
      If(wJ.lessThan(0).or(sJ.equal(2)).or(sI.equal(2)).or(miedzyZiarnami.notEqual(uint(0)).and(sJ.equal(3).or(sI.equal(3)))), () => {
        mN.assign(mN.bitAnd(bit.bitNot()));
      });
    });
    wMaska.element(ni).assign(mN);
    // Żar (§ 4.8): numer klatki + 1, tylko obraz. Jak w Node: węzeł, któremu eksplozja naprawdę zabrała wiązanie, stąd tu, nie w kKrater. S = 3 w strefie pasa nie tnie wnętrza ziarna, a luźny gruz nie ma czego tracić:
    // zapis przy samym znaku S dawał równą żółtą łatę na całą kulę zamiast kratki po granicach ziaren (.tmp/woksele-demo/P4/c/S5v_t3.00.png kontra film/klatki/S5v_cala/k00180.jpg). Klatka kCzas bez krateru nie żarzy.
    If(uKraterN.greaterThan(uint(0)).and(sI.greaterThan(1)).and(mN.notEqual(mI)), () => { wZar.element(i).assign(uT); });
  })().compute(MAX).setName('wokCzysc');

  const kCzyscS = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    wMaska.element(i).assign(wMaska.element(uN.add(i)));
    const s = fv(wStan.element(i).x);
    If(s.greaterThan(1), () => { wStan.element(i).x.assign(1); });
  })().compute(MAX).setName('wokCzyscS');

  // ── Strzał i kratery ── kZerujCel, kCel: promień do najbliższego żywego węzła. kKraterCel: środek każdego rzędu do wBlastK, z flagą w .w, PRZED kKrater:
  // nosiciel leży w swojej kuli i ginie w kKrater, więc jego w < 0 nie może być czytane w tym samym przebiegu.
  const kZerujCel = Fn(() => {
    If(instanceIndex.greaterThanEqual(uint(1)), () => { Return(); });
    wLiczW.element(uint(L_CEL)).assign(uint(POMIJANY_CEL));
  })().compute(1).setName('wokZerujCel');

  const kCel = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const p = v4(wWezR.element(uint(3).mul(i)));
    If(p.w.lessThan(0), () => { Return(); });
    const e = v3(p.xyz.sub(uCelO));
    const t = fv(dot(e, uCelDir));
    If(t.lessThanEqual(0), () => { Return(); });
    If(dot(e, e).sub(t.mul(t)).lessThan(uCelProg2), () => {
      atomicMin(wLiczA.element(uint(L_CEL)), uint(t.mul(8)));
    });
  })().compute(MAX).setName('wokCel');

  const kKraterCel = Fn(() => {
    const r = instanceIndex;
    If(r.greaterThanEqual(uKraterN), () => { Return(); });
    const b = uv(uint(3).mul(r));
    const w0 = v4(uKrater.element(b));
    const w1 = v4(uKrater.element(b.add(uint(1))));
    const c = v3(w0.xyz);
    const vn = v3(vec3(0));
    const wazny = fv(1);
    If(w1.w.greaterThanEqual(0), () => {
      const pn = v4(wWezR.element(uint(3).mul(uint(w1.w))));
      c.assign(pn.xyz);
      vn.assign(wWezR.element(uint(3).mul(uint(w1.w)).add(uint(1))).xyz);
      If(pn.w.lessThan(0), () => { wazny.assign(0); }); // martwy nosiciel: pominięcie
    }).ElseIf(w1.w.lessThan(-1.5), () => {
      const T = uv(wLiczR.element(uint(L_CEL)));
      If(T.equal(uint(POMIJANY_CEL)), () => { wazny.assign(0); });
      c.assign(uCelO.add(uCelDir.mul(float(T).div(8))));
    });
    wBlastK.element(uint(w1.z)).assign(vec4(c, wazny));
    // Rekord błysku (§ 4.8): w2 = (usuwa stojące, slot + BLYSKI · liczba cząstek kłębu, moc, r ognia). Pudło i martwy nosiciel: moc 0.
    const w2 = v4(uKrater.element(b.add(uint(2))));
    const sl = uv(uint(w2.y));
    const s3 = uv(uint(3).mul(sl.mod(uint(BLYSKI))));
    wBlysk.element(s3).assign(vec4(c, uT));
    wBlysk.element(s3.add(uint(1))).assign(vec4(vn, w2.z.mul(wazny)));
    wBlysk.element(s3.add(uint(2))).assign(vec4(w2.w, uT.mul(7).add(float(sl.mod(uint(BLYSKI)))), float(sl.div(uint(BLYSKI))), 1));
  })().compute(KRATER_N).setName('wokKraterCel');

  const kKrater = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const i3 = uv(uint(3).mul(i));
    const p = v4(wWez.element(i3));
    If(p.w.lessThan(0), () => { Return(); });
    const fl = uv(flagiWezla(wStan, i));
    const stoi = uv(fl.bitAnd(uint(1)).mul(uKotwice));
    const pas = uv(fl.bitAnd(uint(BIT_PAS)));
    const usun = uv(uint(0));
    const znak = fv(0);
    Loop({ start: uint(0), end: uKraterN, type: 'uint', condition: '<', name: 'kr' }, ({ kr }) => {
      const b = uv(uint(3).mul(kr));
      const w0 = v4(uKrater.element(b));
      const w1 = v4(uKrater.element(b.add(uint(1))));
      const w2 = v4(uKrater.element(b.add(uint(2))));
      const ck = v4(wBlastKR.element(uint(w1.z)));
      If(ck.w.lessThanEqual(0), () => { Continue(); });
      const e = v3(p.xyz.sub(ck.xyz));
      const q2 = fv(dot(e, e));
      If(q2.greaterThanEqual(w0.w), () => { Continue(); });
      If(q2.lessThan(w1.x), () => {
        usun.assign(uint(1));
      }).ElseIf(stoi.notEqual(uint(0)).and(w2.x.greaterThan(0)), () => {
        usun.assign(uint(1));
      }).ElseIf(q2.lessThan(w1.y), () => {
        znak.assign(2);
      }).ElseIf(pas.notEqual(uint(0)).and(znak.lessThan(2)), () => {
        znak.assign(3);
      });
    });
    If(usun.notEqual(uint(0)), () => {
      usunWezel(i, i3, p);
    }).ElseIf(znak.greaterThan(0), () => {
      wStan.element(i).x.assign(znak);
    });
  })().compute(MAX).setName('wokKrater');

  // ── Pchnięcie, § 2.8 ── Stały przecinek z zaokrągleniem: suma atomowa, odjęta średnia zbioru, ten sam q we wszystkich trzech przebiegach.
  // AGENT: q leży między przebiegami w wWez[3i+2] (w = 1: trafiony). kF i tak nadpisze to pole przed kI, a kolejny kernel nie liczy dv drugi raz, więc sterownik nie może dać innego zaokrąglenia.
  const sumaA = (k) => float(int(uv(atomicLoad(wLiczA.element(uint(k))))));
  const sumaR = (k) => float(int(uv(wLiczR.element(uint(k)))));

  const kZerujWybuch = Fn(() => {
    const k = instanceIndex;
    If(k.greaterThanEqual(uint(LICZ_N)), () => { Return(); });
    If(k.lessThan(uint(L_P)), () => { Return(); }); // głowice i cel zostają: dlatego kernel, nie zapis z CPU
    wLiczW.element(k).assign(uint(0));
  })().compute(LICZ_N).setName('wokZerujWybuch');

  const kWybuchSuma = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const i3 = uv(uint(3).mul(i));
    const p = v4(wWez.element(i3));
    If(p.w.lessThan(0), () => { Return(); });
    If(flagiWezla(wStanR, i).bitAnd(uint(1)).mul(uKotwice).notEqual(uint(0)), () => { Return(); });
    const dv = v3(vec3(0));
    const traf = uv(uint(0));
    Loop({ start: uint(0), end: uBlastN, type: 'uint', condition: '<', name: 'bl' }, ({ bl }) => {
      const r0 = v4(uBlast.element(uint(2).mul(bl)));
      const r1 = v4(uBlast.element(uint(2).mul(bl).add(uint(1))));
      const c = v3(r0.xyz);
      If(r1.y.greaterThanEqual(0), () => {
        const ck = v4(wBlastKR.element(uint(r1.y)));
        If(ck.w.lessThanEqual(0), () => { Continue(); });
        c.assign(ck.xyz.add(vec3(0, 0, r1.z)));
      });
      const e = v3(p.xyz.sub(c));
      const r2 = fv(dot(e, e));
      If(r2.greaterThanEqual(r0.w.mul(r0.w)), () => { Continue(); });
      const r = fv(sqrt(r2).add(1e-6));
      dv.addAssign(e.mul(r1.x.mul(float(1).sub(r.div(r0.w))).div(r)));
      traf.assign(uint(1));
    });
    If(traf.equal(uint(0)), () => { Return(); });
    const qx = iv(int(round(dv.x.mul(64))));
    const qy = iv(int(round(dv.y.mul(64))));
    const qz = iv(int(round(dv.z.mul(64))));
    atomicAdd(wLiczA.element(uint(L_P)), uint(qx));
    atomicAdd(wLiczA.element(uint(L_P + 1)), uint(qy));
    atomicAdd(wLiczA.element(uint(L_P + 2)), uint(qz));
    atomicAdd(wLiczA.element(uint(L_M)), uint(1));
    atomicAdd(wLiczA.element(uint(L_S)), uint(int(round(p.x))));
    atomicAdd(wLiczA.element(uint(L_S + 1)), uint(int(round(p.y))));
    atomicAdd(wLiczA.element(uint(L_S + 2)), uint(int(round(p.z))));
    atomicMax(wLiczA.element(uint(L_QMAX)), uint(round(length(dv).mul(64))));
    wWez.element(i3.add(uint(2))).assign(vec4(float(qx), float(qy), float(qz), 1));
  })().compute(MAX).setName('wokWybuchSuma');

  const kWybuchMoment = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const i3 = uv(uint(3).mul(i));
    const p = v4(wWezR.element(i3));
    If(p.w.lessThan(0), () => { Return(); });
    const q4 = v4(wWezR.element(i3.add(uint(2))));
    If(q4.w.lessThanEqual(0), () => { Return(); });
    const iM = fv(float(1).div(sumaA(L_M)));
    const e = v3(p.xyz.sub(vec3(sumaA(L_S), sumaA(L_S + 1), sumaA(L_S + 2)).mul(iM)));
    const dv = v3(q4.xyz.div(64).sub(vec3(sumaA(L_P), sumaA(L_P + 1), sumaA(L_P + 2)).mul(iM).div(64)));
    const L = v3(cross(e, dv).mul(16));
    atomicAdd(wLiczA.element(uint(L_L)), uint(int(round(L.x))));
    atomicAdd(wLiczA.element(uint(L_L + 1)), uint(int(round(L.y))));
    atomicAdd(wLiczA.element(uint(L_L + 2)), uint(int(round(L.z))));
    const xx = fv(e.x.mul(e.x)), yy = fv(e.y.mul(e.y)), zz = fv(e.z.mul(e.z));
    atomicAdd(wLiczA.element(uint(L_I)), uint(int(round(yy.add(zz).div(16)))));
    atomicAdd(wLiczA.element(uint(L_I + 1)), uint(int(round(xx.add(zz).div(16)))));
    atomicAdd(wLiczA.element(uint(L_I + 2)), uint(int(round(xx.add(yy).div(16)))));
    atomicAdd(wLiczA.element(uint(L_I + 3)), uint(int(round(e.x.mul(e.y).negate().div(16)))));
    atomicAdd(wLiczA.element(uint(L_I + 4)), uint(int(round(e.x.mul(e.z).negate().div(16)))));
    atomicAdd(wLiczA.element(uint(L_I + 5)), uint(int(round(e.y.mul(e.z).negate().div(16)))));
  })().compute(MAX).setName('wokWybuchMoment');

  const kWybuch = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const i3 = uv(uint(3).mul(i));
    const p = v4(wWez.element(i3));
    If(p.w.lessThan(0), () => { Return(); });
    const q4 = v4(wWez.element(i3.add(uint(2))));
    If(q4.w.lessThanEqual(0), () => { Return(); });
    const m = fv(sumaR(L_M));
    const iM = fv(float(1).div(m));
    const dv = v3(q4.xyz.div(64).sub(vec3(sumaR(L_P), sumaR(L_P + 1), sumaR(L_P + 2)).mul(iM).div(64)));
    If(uZerujL.notEqual(uint(0)).and(m.greaterThanEqual(64)), () => {
      const e = v3(p.xyz.sub(vec3(sumaR(L_S), sumaR(L_S + 1), sumaR(L_S + 2)).mul(iM)));
      // Tensor w jednostkach 1/16, moment w 16: ω = I⁻¹·L, razem dzielnik 256.
      const Ixx = fv(sumaR(L_I)), Iyy = fv(sumaR(L_I + 1)), Izz = fv(sumaR(L_I + 2)), Ixy = fv(sumaR(L_I + 3)), Ixz = fv(sumaR(L_I + 4)), Iyz = fv(sumaR(L_I + 5));
      const A = fv(Iyy.mul(Izz).sub(Iyz.mul(Iyz)));
      const B = fv(Ixz.mul(Iyz).sub(Ixy.mul(Izz)));
      const C = fv(Ixy.mul(Iyz).sub(Ixz.mul(Iyy)));
      const det = fv(Ixx.mul(A).add(Ixy.mul(B)).add(Ixz.mul(C)));
      const sl = fv(Ixx.add(Iyy).add(Izz).div(3));
      If(det.abs().greaterThan(sl.mul(sl).mul(sl).mul(1e-3)), () => {
        const Lx = fv(sumaR(L_L)), Ly = fv(sumaR(L_L + 1)), Lz = fv(sumaR(L_L + 2));
        const E = fv(Ixx.mul(Izz).sub(Ixz.mul(Ixz)));
        const F = fv(Ixy.mul(Ixz).sub(Ixx.mul(Iyz)));
        const H = fv(Ixx.mul(Iyy).sub(Ixy.mul(Ixy)));
        const w = v3(vec3(A.mul(Lx).add(B.mul(Ly)).add(C.mul(Lz)), B.mul(Lx).add(E.mul(Ly)).add(F.mul(Lz)), C.mul(Lx).add(F.mul(Ly)).add(H.mul(Lz))).div(det).div(256));
        const u = v3(cross(w, e));
        // Bez obcięcia pięć węzłów w linii dostaje 10 303 j./s (§ 2.8).
        const uMax = fv(float(wLiczR.element(uint(L_QMAX))).div(64));
        const ul = fv(length(u));
        If(ul.greaterThan(uMax), () => { u.mulAssign(uMax.div(ul)); });
        dv.subAssign(u);
      });
    });
    wWez.element(i3.add(uint(1))).assign(vec4(wWez.element(i3.add(uint(1))).xyz.add(dv), 0));
  })().compute(MAX).setName('wokWybuch');

  // Gra: węzły przy powierzchni skały (leżące i martwe w niej), po kubełkach rzutu XY. Liczone od zera przy każdym odczycie (co 0,25 s, tylko po HP 0), poza krokiem: bez atomika i bufora w kF. Węzły z kraterów giną daleko od kuli, więc się nie liczą.
  const kGinieZeruj = Fn(() => {
    If(instanceIndex.greaterThanEqual(uint(GINIE_BOK * GINIE_BOK)), () => { Return(); });
    wGinieW.element(instanceIndex).assign(uint(0));
  })().compute(GINIE_BOK * GINIE_BOK).setName('wokGinieZeruj');
  const kGinieLicz = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const p = v4(wWezR.element(uint(3).mul(i)));
    const e = v3(p.xyz.sub(uGinieC));
    If(dot(e, e).greaterThanEqual(uLiczR2), () => { Return(); });
    // Poza siatką nie liczy się wcale: przycięcie do brzegu robiło z węzłów, które tam zabłądziły, proste rzędy kraterów.
    const fx = fv(floor(p.x.sub(uGinieMin.x).div(uGinieKom)));
    const fy = fv(floor(p.y.sub(uGinieMin.y).div(uGinieKom)));
    If(fx.lessThan(0).or(fy.lessThan(0)).or(fx.greaterThanEqual(float(GINIE_BOK))).or(fy.greaterThanEqual(float(GINIE_BOK))), () => { Return(); });
    const kx = uv(uint(fx));
    const ky = uv(uint(fy));
    atomicAdd(wGinieA.element(ky.mul(uint(GINIE_BOK)).add(kx)), uint(1));
  })().compute(MAX).setName('wokGinieLicz');
  const listaGinie = [kGinieZeruj, kGinieLicz];

  // Gra: kotwice puszczają falą od punktu (upadek bazy): węzeł w kole traci bit kotwicy. Baza uderza wtedy w skałę po kolei, od środka na zewnątrz, a nie całym obrysem naraz.
  const uPuscC = uniform(new THREE.Vector2()).setName('uPuscC');
  const uPuscR2 = uniform(0).setName('uPuscR2');
  const kPusc = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const fl = uv(flagiWezla(wStan, i));
    If(fl.bitAnd(uint(1)).equal(uint(0)), () => { Return(); });
    const p = v4(wWezR.element(uint(3).mul(i)));
    const dx = fv(p.x.sub(uPuscC.x));
    const dy = fv(p.y.sub(uPuscC.y));
    If(dx.mul(dx).add(dy.mul(dy)).greaterThanEqual(uPuscR2), () => { Return(); });
    wStan.element(uN.mul(uint(2)).add(uint(2).mul(i)).add(uint(1))).w.assign(float(fl.sub(uint(1))));
  })().compute(MAX).setName('wokPusc');

  const kernele = { kF, kI, kWstaw, kLista, kZerujPo, kCzas, kCzysc, kCzyscS, kZerujCel, kCel, kKraterCel, kKrater, kZerujWybuch, kWybuchSuma, kWybuchMoment, kWybuch, kGinieZeruj, kGinieLicz, kPusc };
  // Kernele o stałej liczbie wywołań: nie po węzłach, więc wczytanie sceny nie zmienia im liczby.
  const STALA_LICZBA = new Set([kZerujCel, kKraterCel, kZerujWybuch, kGinieZeruj]);

  // ── Listy § 2.4, zbudowane raz ── Na krok: lista kontaktów co RYTM podkroków, reszta F + I.
  // AGENT: lista zależy tylko od podkroków i rytmu sceny (dx, materiał), a kernele są te same: nowa kombinacja to tablica w JS, bez nowego pipeline'u. Wczytanie sceny wybiera listę.
  const listyKroku = new Map();
  const listaNa = (podkroki, rytm) => {
    const klucz = podkroki * 1024 + rytm;
    let l = listyKroku.get(klucz);
    if (!l) {
      const sek = [];
      for (let s = 0; s < podkroki; s++) {
        if (s % rytm === 0) sek.push(['kWstaw', kWstaw], ['kLista', kLista], ['kZerujPo', kZerujPo]);
        sek.push(['kF', kF], ['kI', kI]);
      }
      l = { sekwencja: sek, lista: sek.map((e) => e[1]) };
      listyKroku.set(klucz, l);
    }
    return l;
  };
  let { sekwencja, lista: listaKroku } = listaNa(PODKROKI, RYTM);
  const listaSiatki = [kWstaw, kLista, kZerujPo];
  const listaPodkroku = [kWstaw, kLista, kZerujPo, kF];
  const listaCalkowania = [kI];
  const listaZd = [kCzas, kCzysc, kCzyscS];
  const listaZdKrater = [kCzas, kKraterCel, kKrater, kCzysc, kCzyscS];
  const listaZdStrzal = [kCzas, kZerujCel, kCel, kKraterCel, kKrater, kCzysc, kCzyscS];
  const listaWb = [kZerujWybuch, kWybuchSuma, kWybuchMoment, kWybuch];
  const listaWbBezL = [kZerujWybuch, kWybuchSuma, kWybuch];

  const atrybuty = {
    wez: wWez.value, stan: wStan.value, maska: wMaska.value, wiaz: wWiaz.value, lista: wLista.value, ijk: aIjk, tab: aTab, komLicz: aKomLicz, komSloty: wKomSloty.value,
    czasU: wCzasU.value, licz: aLicz, blastK: wBlastK.value, blysk: wBlysk.value, zar: wZar.value,
  };
  const wiazF = atrybuty.wiaz.array;
  const wiazU = new Uint32Array(wiazF.buffer, wiazF.byteOffset, wiazF.length);
  let wypiek = null;

  const uniformy = {
    uN, uH, uK, uCB, uKB, uKC, uCC, uCT, uCosWyp, uGStala, uGPunktC, uGPunktG, uGPunktR0, uGObrotP, uGObrotOm, uGOs, uSkG, uSkF0, uKotwice, uGruntZ, uGinieC, uGinieR2, uKulaR, uDxP, uCap, uLepL, uLepV2,
    uGruzP, uGruzV2, uFalaV2, uFalaTempoH, uSzokProg, uKontaktV, uIKom, uZasieg2, uPekaProg, uPekaZakres, uZlomB2,
    uT, uBrakCzasu, uCelO, uCelDir, uCelProg2, uKraterN, uBlastN, uZerujL,
  };

  // ── Plan zdarzeń ── Bez pętli po węzłach w kroku: kCzas czyta czasy z bufora, tu tylko numer klatki i rzędy uniformów (najwyżej BLAST_N + KRATER_N zapisów).
  let plan = null;
  let fKlatka = 0;
  let qKrater = 0;
  let slotNast = 0;
  let blyskNast = 0;
  let koniecBlyskow = -1;
  const blyskiCpu = new Float32Array(4 * BLYSKI); // klatka + 1, moc, tau zaniku, r: światło na bryłach w obraz.js, pozycja zostaje na GPU
  let ileK = 0;
  let strzalCzeka = null;
  const pchK = Array.from({ length: BLAST_N }, () => ({ rP: 0, J: 0, tau: 0, t0: 0, slot: 0, dz: 0 }));
  const liczniki = { pominietePchniecia: 0, pominieteKratery: 0, wykonaneKratery: 0, pchnieteKlatki: 0 };
  const DT = 1 / 60;

  function resetPlanu() {
    plan = null; fKlatka = 0; qKrater = 0; slotNast = 0; blyskNast = 0; ileK = 0; strzalCzeka = null;
    blyskiCpu.fill(0); koniecBlyskow = -1;
    liczniki.pominietePchniecia = 0; liczniki.pominieteKratery = 0; liczniki.wykonaneKratery = 0; liczniki.pchnieteKlatki = 0;
    uBlastN.value = 0; uKraterN.value = 0; uT.value = 0;
  }

  /**
   * Plan zdarzeń sceny (§ 2.8, wynik planGpu z scena.js): czasy węzłów do wCzasU, pchnięcia znane z budowy, kratery o własnych czasach, środkach, promieniach i pchnięciach.
   * Klatka zdarzenia węzła jak w Node: f z (f/60 − 1e−9, (f + 1)/60 − 1e−9]. W buforze ±(f + 0,5): znak to rodzaj, połowa odsuwa od progu w f32.
   */
  function ustawPlan(pg) {
    if (!wypiek) throw new Error('ustawPlan przed wczytaj');
    resetPlanu();
    const n = wypiek.n;
    const czasU = atrybuty.czasU.array, stan = atrybuty.stan.array;
    czasU.fill(1e30);
    const c = pg.czasy;
    let maxF = 0;
    const fz = c ? new Int32Array(c.indeksy.length) : null;
    if (c) for (let q = 0; q < c.indeksy.length; q++) { fz[q] = Math.max(0, Math.ceil((c.t[q] + 1e-9) * 60) - 1); if (fz[q] > maxF) maxF = fz[q]; }
    const klatki = new Uint8Array(maxF + 1);
    if (c) {
      for (let q = 0; q < c.indeksy.length; q++) {
        const i = c.indeksy[q];
        czasU[i] = (c.rozerwij[q] ? -1 : 1) * (fz[q] + 0.5);
        klatki[fz[q]] = 1;
        if (c.rozerwij[q] && c.zostawZiarna) stan[4 * (2 * n + 2 * i) + 7] = (wypiek.flagi[i] | BIT_ZOSTAW) >>> 0;
      }
      atrybuty.stan.needsUpdate = true;
    }
    // Węzły, które reszta kuli krateru rozrywa przez S = 3 (scena z szwami). Dane budowy sceny, bez nowego bufora.
    if (pg.bitPas) {
      for (let i = 0; i < n; i++) if (pg.bitPas[i]) { const q = 4 * (2 * n + 2 * i) + 7; stan[q] = (stan[q] | BIT_PAS) >>> 0; }
      atrybuty.stan.needsUpdate = true;
    }
    atrybuty.czasU.needsUpdate = true;
    plan = { klatki, pchniecia: pg.pchniecia ?? [], kratery: pg.kratery ?? [], zerujL: pg.zerujL !== false, swobodnyG: pg.swobodnyG ?? 0, skalaG: pg.skalaG ?? null, puscKotwiceF: pg.puscKotwiceF ?? -1 };
    return plan;
  }

  /** Strzał myszą (§ 2.8, § 5.3): wykona się przed krokiem następnej klatki. Pudło: kKraterCel gasi slot, więc pchnięcie go pomija. */
  function strzel({ o, dir, r = 60, J = 300, tau = 0.3, rP = 160, rdzen = 0.4, rodz = undefined }) {
    const d = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    uCelO.value.set(o[0], o[1], o[2]);
    uCelDir.value.set(dir[0] / d, dir[1] / d, dir[2] / d);
    const dx = wypiek.dx;
    uCelProg2.value = 0.49 * dx * dx;
    strzalCzeka = { nos: -2, x: 0, y: 0, z: 0, r, rdzen, rS: 1, J, tau, rP, dz: 0, usunStojace: false, rodz };
  }

  /**
   * Kratery zlecone w biegu (gra: rozpad kawałka bazy, szyja, upadek). `e.f` względem bieżącej klatki. Plan musi być ustawiony; alokacje tylko tu, na zdarzenie, nie w kroku.
   * AGENT: zdarzeniaKlatki czyta p.kratery rosnąco po f od qKrater, więc wstawienie przycina zużyte i sortuje resztę.
   */
  function dodajKratery(lista) {
    if (!plan) throw new Error('dodajKratery bez planu');
    const reszta = plan.kratery.slice(qKrater);
    for (const e of lista) reszta.push({ ...e, f: fKlatka + (e.f | 0) });
    reszta.sort((a, b) => a.f - b.f);
    plan.kratery = reszta;
    qKrater = 0;
  }

  /** Kotwice w kole (x, y, R) puszczają od tej chwili (upadek w grze, fala od habitatu). Woła się raz na klatkę w czasie fali. */
  function puscKolo(renderer, x, y, R) {
    uPuscC.value.set(x, y);
    uPuscR2.value = R * R;
    renderer.compute(kPusc);
  }

  /**
   * Gra: skała pod bazą. c, R: kula kontaktu, x0, y0, kom: siatka kubełków liczących węzły przy powierzchni (róg, bok kubełka). Bezpiecznik: węzeł 250 j. pod powierzchnią ginie.
   * Pod zPola grawitacja przechodzi ze stałej w ku środkowi skały na drodze zakresPola. Stała −z na kuli zsuwała gruz z każdego zbocza powyżej kąta tarcia (35°), a nad zPola budowla stoi w polu, w którym ją wypieczono.
   * AGENT: odczyt rzadko i bez czekania klatki (odczytGinie): sam obraz uderzeń, gra o tym nie wie.
   */
  function ustawGinie({ c, R, x0, y0, kom, zPola = 0, zakresPola = 0 }) {
    uGinieC.value.set(c[0], c[1], c[2]);
    uGPunktC.value.set(c[0], c[1], c[2]);
    uGPunktG.value = zakresPola > 0 ? uGStala.value.length() : 0;
    uGPunktR0.value = 0;
    uGMiesz.value.set(zPola, zakresPola > 0 ? 1 / zakresPola : 0);
    uKulaR.value = R;
    const Rg = Math.max(0, R - 250), Rl = R + 60;
    uGinieR2.value = Rg * Rg;
    uLiczR2.value = Rl * Rl;
    uGinieMin.value.set(x0, y0);
    uGinieKom.value = kom;
  }

  /** Liczniki kubełków z GPU: Uint32Array GINIE_BOK², węzły na skale od wczytaj. Przelicza i czyta bez czekania klatki. */
  async function odczytGinie(renderer) {
    renderer.compute(listaGinie);
    return new Uint32Array(await renderer.getArrayBufferAsync(aGinie));
  }

  function wpiszKrater(k, e, f) {
    const b = 3 * k;
    const slot = slotNast;
    slotNast = (slotNast + 1) % SLOTY_K;
    const r2 = e.r * e.r;
    daneKrater[b].set(e.x ?? 0, e.y ?? 0, e.z ?? 0, r2);
    daneKrater[b + 1].set(e.rdzen * e.rdzen * r2, (e.rS ?? 1) * (e.rS ?? 1) * r2, slot, e.nos ?? -1);
    const bl = BLYSK_RODZ[e.rodz] ?? BLYSK_RODZ.glowna;
    const rB = Math.min(e.r, bl.rMax);
    daneKrater[b + 2].set(e.usunStojace ? 1 : 0, blyskNast + BLYSKI * bl.klab, bl.moc, rB);
    const qb = 4 * blyskNast;
    blyskiCpu[qb] = f + 1; blyskiCpu[qb + 1] = bl.moc; blyskiCpu[qb + 2] = bl.klab >= 20 ? 0.075 : 0.05; blyskiCpu[qb + 3] = rB;
    koniecBlyskow = f + 16;
    blyskNast = (blyskNast + 1) % BLYSKI;
    liczniki.wykonaneKratery++;
    if (e.J > 0) {
      if (ileK < BLAST_N) {
        const w = pchK[ileK++];
        w.rP = e.rP; w.J = e.J; w.tau = Math.max(e.tau, DT); w.t0 = f * DT; w.slot = slot; w.dz = e.dz ?? 0;
      } else liczniki.pominietePchniecia++;
    }
  }

  /** Listy LZd i LWb klatki (§ 2.4). Bez planu i strzału nic nie robi: krok jak w P1. Woła ją krok(); w ?profil=1 trzeba ją wołać ręcznie przed kernelami. */
  function zdarzeniaKlatki(renderer) {
    const f = fKlatka;
    const p = plan;
    const strzal = strzalCzeka;
    if (!p && !strzal && ileK === 0) return;
    if (p?.skalaG) {
      const [a, b, s0, s1] = p.skalaG;
      const u = Math.min(1, Math.max(0, (f * DT - a) / (b - a)));
      const s = s0 + (s1 - s0) * u;
      ustawUniformy(wypiek, s, Math.sqrt((wypiek.zr.gMod * s) / 400));
    }
    let nK = 0;
    if (p) {
      while (qKrater < p.kratery.length && p.kratery[qKrater].f <= f && nK < KRATER_N) wpiszKrater(nK++, p.kratery[qKrater++], f);
    }
    if (strzal) {
      if (nK === KRATER_N) nK--; // strzał gracza ważniejszy niż rząd planu, ten przepada
      wpiszKrater(nK++, strzal, f);
      strzalCzeka = null;
    }
    const czas = p !== null && f < p.klatki.length && p.klatki[f] === 1;
    if (czas || nK > 0) {
      uT.value = f + 1;
      uKraterN.value = nK;
      renderer.compute(strzal ? listaZdStrzal : nK > 0 ? listaZdKrater : listaZd);
    }
    let nb = 0;
    const t0 = f * DT, t1 = t0 + DT;
    if (p && p.pchniecia.length) {
      const h = wypiek.h;
      const dzSw = p.swobodnyG ? -p.swobodnyG * (0.5 * t0 * t0 + 0.5 * t0 * h) : 0;
      for (let q = 0; q < p.pchniecia.length; q++) {
        const e = p.pchniecia[q];
        const a = Math.max(t0, e.t0), c = Math.min(t1, e.t0 + e.tau);
        if (c <= a) continue;
        if (nb === BLAST_N) { liczniki.pominietePchniecia++; continue; }
        daneBlast[2 * nb].set(e.x, e.y, e.z + dzSw, e.rP);
        daneBlast[2 * nb + 1].set((e.J * (c - a)) / e.tau, -1, 0, 0);
        nb++;
      }
    }
    for (let q = ileK - 1; q >= 0; q--) {
      const e = pchK[q];
      const c = Math.min(t1, e.t0 + e.tau);
      if (c <= t0 + 1e-9) {
        const ost = pchK[--ileK];
        pchK[ileK] = e;
        pchK[q] = ost;
        continue;
      }
      if (nb === BLAST_N) { liczniki.pominietePchniecia++; continue; }
      daneBlast[2 * nb].set(0, 0, 0, e.rP);
      daneBlast[2 * nb + 1].set((e.J * (c - t0)) / e.tau, e.slot, e.dz, 0);
      nb++;
    }
    if (nb > 0) {
      const zerujL = p ? p.zerujL : true;
      uBlastN.value = nb;
      uZerujL.value = zerujL ? 1 : 0;
      liczniki.pchnieteKlatki++;
      renderer.compute(zerujL ? listaWb : listaWbBezL);
    }
    // Kotwice puszczają po zdarzeniach tej klatki (S5 planeta, jak m.odkotwicz w scena5): F0 tej sceny jest zerem z budowy, więc zostaje samo uKotwice. Wraca przy wczytaj.
    if (p && f === p.puscKotwiceF) uKotwice.value = 0;
  }

  /** Uniformy sceny (§ 10.4). skG i sFr z migawki albo z budowy. Te same liczby, które WzorzecCpu liczy na początku przebiegu F. */
  function ustawUniformy(w, skG = 1, sFr = w.sFr) {
    const sM = w.sM;
    // Budynek w skali s (par.skalaBud, plan LOD): prędkości progowe z √s, tempa z 1/√s. Przy s = 1 oba są jedynką.
    const pV = Math.sqrt(w.skalaBud ?? 1), pR = 1 / pV;
    uN.value = w.n;
    uH.value = w.h;
    uK.value = w.K;
    uCB.value = w.cB;
    uKB.value = w.kB;
    uKC.value = w.kC;
    uCC.value = w.cC;
    uCT.value = w.cT;
    uCosWyp.value = w.cosWypieku;
    uGStala.value.set(w.zr.gx, w.zr.gy, w.zr.gz);
    const pkt = w.zr.punkt, obr = w.zr.obrot;
    uGPunktC.value.set(pkt ? pkt.cx : 0, pkt ? pkt.cy : 0, pkt ? pkt.cz : 0);
    uGPunktG.value = pkt ? pkt.g : 0;
    uGPunktR0.value = pkt ? pkt.r0 : 0;
    uGMiesz.value.set(0, 0);
    uGObrotP.value.set(obr ? obr.px : 0, obr ? obr.py : 0, obr ? obr.pz : 0);
    uGObrotOm.value = obr ? obr.om : 0;
    uGOs.value.set(obr ? obr.ox : 0, obr ? obr.oy : 0, obr ? obr.oz : 1);
    uSkG.value = skG;
    uSkF0.value = skG; // F0 = 0 w scenie bez kotwic już z budowy (§ 2.3, krok 4)
    uKotwice.value = w.nieruchomy.indexOf(1) >= 0 ? 1 : 0;
    uGruntZ.value = w.gruntZ;
    uDxP.value = 0.5 * w.dx;
    uCap.value = w.capEtyk;
    uLepL.value = par.lepL * sFr * pR;
    uLepV2.value = (par.lepV * sFr * pV) * (par.lepV * sFr * pV);
    uGruzP.value = par.gruzPara * sFr * pR;
    uGruzV2.value = (par.gruzV * sFr * pV) * (par.gruzV * sFr * pV);
    uFalaV2.value = w.rama ? par.fala.v * par.fala.v * sFr * sFr * pV * pV : 1e30;
    uFalaTempoH.value = Math.min(1, par.fala.tempo * pR * (w.par?.falaZaDx ? w.skala : 1) * w.h) * sFr; // AGENT: h po skali (§ 2.1). Czoło fali biegnie więc tempo · dx j./s. Próba z tempo · skala (stałe 180 j./s) pogorszyła dach przy dx = 40 i 80, plan LOD § 5.
    uSzokProg.value = par.szokTempo * w.dx * Math.sqrt(sM) * pR;
    uKontaktV.value = par.kontaktSzokV * Math.sqrt(sM) * pV;
    uIKom.value = w.iKom;
    uZasieg2.value = w.zasieg * w.zasieg;
    uPekaProg.value = par.falaPeka.prog;
    uPekaZakres.value = par.falaPeka.zakres;
    uZlomB2.value = par.zlomB * par.zlomB;
  }

  /** Wczytanie budowy (§ 2.2): cały stan początkowy, tablice stałe i uniformy. Reset sceny: to samo jeszcze raz, bez nowych pipeline'ów. */
  function wczytaj(w) {
    const n = w.n;
    if (n > MAX) throw new Error(`Scena ma ${n} węzłów, a solver ${MAX}`);
    ({ sekwencja, lista: listaKroku } = listaNa(w.podkrokiEf, w.rytmEf ?? RYTM));
    wypiek = w;
    const wez = atrybuty.wez.array, stan = atrybuty.stan.array, maska = atrybuty.maska.array;
    const vel0 = w.vel0;
    for (let i = 0; i < n; i++) {
      const b = 12 * i;
      wez[b] = w.pos[3 * i]; wez[b + 1] = w.pos[3 * i + 1]; wez[b + 2] = w.pos[3 * i + 2]; wez[b + 3] = w.rk[i];
      wez[b + 4] = vel0 ? vel0[3 * i] : 0; wez[b + 5] = vel0 ? vel0[3 * i + 1] : 0; wez[b + 6] = vel0 ? vel0[3 * i + 2] : 0; wez[b + 7] = 0;
      wez[b + 8] = 0; wez[b + 9] = 0; wez[b + 10] = 0; wez[b + 11] = 0;
      const s = 4 * i, sN = 4 * (n + i), st0 = 4 * (2 * n + 2 * i), st1 = st0 + 4;
      stan[s] = 0; stan[s + 1] = 0; stan[s + 2] = w.etyk[i]; stan[s + 3] = 0;
      stan[sN] = 0; stan[sN + 1] = 0; stan[sN + 2] = w.etyk[i]; stan[sN + 3] = 0;
      stan[st0] = w.bMax2W[i]; stan[st0 + 1] = w.rozlewW[i]; stan[st0 + 2] = w.szokW[i]; stan[st0 + 3] = w.iN0[i];
      stan[st1] = w.kUd[i]; stan[st1 + 1] = w.aLos[i]; stan[st1 + 2] = 0; stan[st1 + 3] = w.flagi[i];
      maska[i] = w.maska[i];
      maska[n + i] = w.maska[i];
      atrybuty.ijk.array[i] = slowoIjk(w.ijk[3 * i], w.ijk[3 * i + 1], w.ijk[3 * i + 2], w.grupa[i]);
    }
    for (let q = 0; q < STRONA * n; q++) {
      const b = 8 * q;
      wiazF[b] = w.L[q]; wiazF[b + 1] = 0; wiazF[b + 2] = w.F0[q]; wiazF[b + 3] = w.R0[q];
      wiazF[b + 4] = w.Ft[q]; wiazF[b + 5] = w.Fc[q];
      wiazU[b + 6] = w.nbr[q] >= 0 ? slowoSasiada(w.nbr[q], w.klasaW[q]) : slowoSasiada(0, 0);
      wiazF[b + 7] = 0;
    }
    const tab = atrybuty.tab.array;
    for (let d = 0; d < ND; d++) { tab[4 * d] = N0X[d]; tab[4 * d + 1] = N0Y[d]; tab[4 * d + 2] = N0Z[d]; tab[4 * d + 3] = 0; }
    for (let k = 0; k < 12; k++) {
      const c = par.klasy[KLASA_NAZWY[k % 6]];
      const b = 4 * (REK_KLASA + k);
      tab[b] = 1 / (c.dT * w.dx * w.skala);
      tab[b + 1] = 1 / (c.dC * w.dx * w.skala);
      tab[b + 2] = w.kruszTab[k];
      tab[b + 3] = 0;
    }
    for (let q = 0; q < 27; q++) { const b = 4 * (REK_LUT + q); tab[b] = w.lutKier[q]; tab[b + 1] = 0; tab[b + 2] = 0; tab[b + 3] = 0; }
    atrybuty.lista.array.fill(0);
    atrybuty.komLicz.array.fill(0);
    atrybuty.czasU.array.fill(1e30);
    atrybuty.licz.array.fill(0);
    atrybuty.blastK.array.fill(0);
    atrybuty.blysk.array.fill(0);
    atrybuty.zar.array.fill(0);
    aGinie.array.fill(0);
    aGinie.needsUpdate = true;
    for (const k of Object.values(atrybuty)) k.needsUpdate = true;
    for (const k of Object.values(kernele)) if (!STALA_LICZBA.has(k)) k.setCount(n);
    resetPlanu();
    ustawUniformy(w);
  }

  /** Migawka Node na GPU (§ 8): stan z pól POLA_MIGAWKI, liczniki siatki od zera. Tablice stałe zostają z `wczytaj`. */
  function wgraj(m) {
    const w = wypiek;
    if (!w) throw new Error('wgraj przed wczytaj');
    const n = w.n;
    const wez = atrybuty.wez.array, stan = atrybuty.stan.array, maska = atrybuty.maska.array;
    for (let i = 0; i < n; i++) {
      const b = 12 * i;
      wez[b] = m.pos[3 * i]; wez[b + 1] = m.pos[3 * i + 1]; wez[b + 2] = m.pos[3 * i + 2]; wez[b + 3] = m.aktywny[i] ? w.rk[i] : -1;
      wez[b + 4] = m.vel[3 * i]; wez[b + 5] = m.vel[3 * i + 1]; wez[b + 6] = m.vel[3 * i + 2];
      wez[b + 8] = m.acc[3 * i]; wez[b + 9] = m.acc[3 * i + 1]; wez[b + 10] = m.acc[3 * i + 2];
      const s = 4 * i, sN = 4 * (n + i), st1 = 4 * (2 * n + 2 * i) + 4;
      stan[s] = m.szkoda[i]; stan[s + 1] = m.A[i]; stan[s + 2] = m.etyk[i];
      stan[sN] = m.szkoda[i]; stan[sN + 1] = m.A[i]; stan[sN + 2] = m.etyk[i];
      stan[st1 + 3] = (w.flagi[i] & ~1) | (m.nieruchomy[i] ? 1 : 0);
      maska[i] = m.maskaW[i];
      maska[n + i] = m.maskaW[i];
    }
    for (let q = 0; q < STRONA * n; q++) {
      const b = 8 * q;
      wiazF[b] = m.L[q]; wiazF[b + 1] = m.D[q]; wiazF[b + 2] = m.F0[q];
    }
    atrybuty.lista.array.fill(0);
    atrybuty.komLicz.array.fill(0);
    atrybuty.wez.needsUpdate = true;
    atrybuty.stan.needsUpdate = true;
    atrybuty.maska.needsUpdate = true;
    atrybuty.wiaz.needsUpdate = true;
    atrybuty.lista.needsUpdate = true;
    atrybuty.komLicz.needsUpdate = true;
    resetPlanu();
    ustawUniformy(w, m.skG ?? 1, m.sFr ?? w.sFr);
  }

  /**
   * Jeden krok fizyki 1/60 s: zdarzenia klatki, potem 22 dispatche w jednym compute passie (§ 2.4). Bez alokacji po stronie dema.
   * AGENT: ?profil=1 w glowny.js woła kernele z `sekwencja` wprost, z pominięciem tej funkcji: tam nie ma zdarzeń ani licznika klatek. Pomiar P6 ze zdarzeniami: zdarzeniaKlatki + nastawKlatke.
   */
  function krok(renderer) {
    zdarzeniaKlatki(renderer);
    renderer.compute(listaKroku);
    fKlatka++;
  }

  /** Jeden przebieg kLista + kF bez całkowania: to, co porównuje test § 8. Wynik: odczyt(renderer). */
  function podkrokPorownania(renderer) { renderer.compute(listaPodkroku); }

  /** Sam kI: kopia stanu i całkowanie (test vMax, § 1.6). */
  function calkuj(renderer) { renderer.compute(listaCalkowania); }

  /** Rozgrzewka: puste dispatche każdego kernela (zasada 5). Pipeline compute three r183 powstaje synchronicznie, więc tylko przed pierwszą klatką. */
  async function rozgrzej(renderer) {
    for (const k of Object.values(kernele)) await renderer.computeAsync(k, [0, 1, 1]);
  }

  /**
   * Odczyt stanu (§ 8), tylko w teście. Maski i stan z części „nowej” [n + i]: po kF to wynik przebiegu, po kI to samo co część bieżąca.
   */
  async function odczyt(renderer) {
    const w = wypiek;
    const n = w.n;
    const [bWez, bStan, bMaska, bWiaz, bLista] = await Promise.all([
      renderer.getArrayBufferAsync(atrybuty.wez), renderer.getArrayBufferAsync(atrybuty.stan), renderer.getArrayBufferAsync(atrybuty.maska),
      renderer.getArrayBufferAsync(atrybuty.wiaz), renderer.getArrayBufferAsync(atrybuty.lista),
    ]);
    const wez = new Float32Array(bWez), stan = new Float32Array(bStan), maska = new Uint32Array(bMaska), wiaz = new Float32Array(bWiaz), lista = new Uint32Array(bLista);
    const poz = new Float32Array(3 * n), vel = new Float32Array(3 * n), acc = new Float32Array(3 * n), aktywny = new Uint8Array(n);
    const szkoda = new Float32Array(n), A = new Float32Array(n), etyk = new Float32Array(n);
    const L = new Float32Array(STRONA * n), D = new Float32Array(STRONA * n), F0 = new Float32Array(STRONA * n);
    const lLicz = new Uint8Array(n);
    const listaW = new Int32Array(M * n);
    for (let i = 0; i < n; i++) {
      const b = 12 * i;
      poz[3 * i] = wez[b]; poz[3 * i + 1] = wez[b + 1]; poz[3 * i + 2] = wez[b + 2];
      aktywny[i] = wez[b + 3] < 0 ? 0 : 1;
      vel[3 * i] = wez[b + 4]; vel[3 * i + 1] = wez[b + 5]; vel[3 * i + 2] = wez[b + 6];
      acc[3 * i] = wez[b + 8]; acc[3 * i + 1] = wez[b + 9]; acc[3 * i + 2] = wez[b + 10];
      const s = 4 * (n + i);
      szkoda[i] = stan[s]; A[i] = stan[s + 1]; etyk[i] = stan[s + 2];
      const l = lista[REK * i];
      lLicz[i] = l;
      for (let c = 0; c < l && c < M; c++) listaW[M * i + c] = lista[REK * i + 1 + c];
    }
    for (let q = 0; q < STRONA * n; q++) { const b = 8 * q; L[q] = wiaz[b]; D[q] = wiaz[b + 1]; F0[q] = wiaz[b + 2]; }
    return {
      n, poz, vel, acc, aktywny, szkoda, A, etyk, L, D, F0, lLicz, lista: listaW,
      maskaW: maska.slice(n, 2 * n), mask: maska.slice(n, 2 * n), maskaBiezaca: maska.slice(0, n),
      stan: stan.slice(4 * n, 8 * n),
    };
  }

  /** Odczyt do metryk sceny, w teście (§ 8): tylko pozycje, prędkości i maski. Wiązania zostają na GPU, więc odczyt co klatkę nie wstrzymuje biegu. */
  async function odczytLekki(renderer) {
    const n = wypiek.n;
    const [bWez, bMaska] = await Promise.all([renderer.getArrayBufferAsync(atrybuty.wez), renderer.getArrayBufferAsync(atrybuty.maska)]);
    const wez = new Float32Array(bWez), maska = new Uint32Array(bMaska);
    const pos = new Float32Array(3 * n), vel = new Float32Array(3 * n), aktywny = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const b = 12 * i;
      pos[3 * i] = wez[b]; pos[3 * i + 1] = wez[b + 1]; pos[3 * i + 2] = wez[b + 2];
      aktywny[i] = wez[b + 3] < 0 ? 0 : 1;
      vel[3 * i] = wez[b + 4]; vel[3 * i + 1] = wez[b + 5]; vel[3 * i + 2] = wez[b + 6];
    }
    return { n, pos, vel, aktywny, maskaW: maska.slice(0, n) };
  }

  return {
    maxNodes: MAX, blyski: BLYSKI, blyskiCpu, blyskiCzynne: () => fKlatka <= koniecBlyskow, kernele, get sekwencja() { return sekwencja; }, get listaKroku() { return listaKroku; }, listaSiatki, listaPodkroku, atrybuty, uniformy, liczniki,
    wczytaj, wgraj, ustawUniformy, ustawPlan, strzel, dodajKratery, puscKolo, ustawGinie, odczytGinie, zdarzeniaKlatki, krok, podkrokPorownania, calkuj, rozgrzej, odczyt, odczytLekki,
    get wypiek() { return wypiek; },
    get strzalCzeka() { return strzalCzeka !== null; },
    get fKlatka() { return fKlatka; },
    /** Numer klatki, gdy kroki idą poza krok(): zegar sceny, ?profil=1. */
    nastawKlatke(f) { fKlatka = f; },
  };
}
