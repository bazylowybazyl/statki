// Solver GPU dema wiązanych wokseli (docs/SPEC-woksele-zawalenia.md § 2): bufory § 2.2 i kernele kF, kI, kWstaw, kLista, kZerujPo.
// Pakiet P1: bez obrazu i bez zdarzeń (kCzas, kCzysc, kWybuch* dochodzą w P2). Moduł bez window i DOM, bez celów renderu: renderer przychodzi z parametru.
// Wzorzec: wzorzec-cpu.js. Test jednego podkroku (§ 8) porównuje wynik kLista + kF z migawką z Node węzeł po węźle, więc kolejność sprawdzeń przy wiązaniu nie może się zmienić.
//
// Czyta wyłącznie stan sprzed przebiegu, pisze tylko swoje kopie: symetria zerwań wynika z tego, że oba końce liczą to samo z tych samych danych.
// Układ danych § 2.2. Wszystko w lokalnym układzie budowli, rozmiary po `uN`, nie po MAX (kernele mają `setCount(n)` liczbą, § 2.2).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Continue, Return, instanceIndex, instancedArray, storage, uniform, uint, int, float, vec3, vec4,
  countOneBits, floatBitsToUint, sqrt, max, min, floor, dot, length, cross, select, atomicAdd,
} from 'three/tsl';
import { ND, STRONA, N0X, N0Y, N0Z, KLASA_NAZWY, PARAMETRY } from './budowa.js';

/** Słowo sąsiada w polu z rekordu wiązania: bity 0–23 numer, 24–31 klasa + 1. Klasa + 1, żeby słowo nigdy nie było denormalem f32 (§ 2.2). */
export const slowoSasiada = (j, klasa) => (((klasa + 1) << 24) | j) >>> 0;
export const sasiadZeSlowa = (s) => s & 0xffffff;
export const klasaZeSlowa = (s) => (s >>> 24) - 1;

/** Upakowanie ijk i grupy węzła do jednego u32: i 10 bitów, j 10, k 10, grupa 2 (§ 2.2). */
export const slowoIjk = (i, j, k, grupa) => ((i & 1023) | ((j & 1023) << 10) | ((k & 1023) << 20) | ((grupa & 3) << 30)) >>> 0;

const REK_KLASA = 18, REK_LUT = 30, ILE_TAB = 57;

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
  const uGObrotP = uniform(new THREE.Vector3()).setName('uGObrotP');
  const uGObrotOm = uniform(0).setName('uGObrotOm');
  const uGOs = uniform(new THREE.Vector3(0, 0, 1)).setName('uGOs');
  const uSkG = uniform(1).setName('uSkG');
  const uSkF0 = uniform(1).setName('uSkF0');
  const uKotwice = uniform(1, 'uint').setName('uKotwice');
  const uGruntZ = uniform(-1e30).setName('uGruntZ');
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
      g.addAssign(e.mul(a.div(sqrt(r2))));
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
    wWez.element(i3.add(uint(1))).assign(vec4(v, 0));
    wWez.element(i3).assign(vec4(p.xyz.add(v.mul(uH)), p.w));
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

  const kernele = { kF, kI, kWstaw, kLista, kZerujPo };

  // ── Listy § 2.4, zbudowane raz ── Na krok: lista kontaktów co RYTM podkroków, reszta F + I.
  const sekwencja = [];
  for (let s = 0; s < PODKROKI; s++) {
    if (s % RYTM === 0) sekwencja.push(['kWstaw', kWstaw], ['kLista', kLista], ['kZerujPo', kZerujPo]);
    sekwencja.push(['kF', kF], ['kI', kI]);
  }
  const listaKroku = sekwencja.map((e) => e[1]);
  const listaSiatki = [kWstaw, kLista, kZerujPo];
  const listaPodkroku = [kWstaw, kLista, kZerujPo, kF];
  const listaCalkowania = [kI];

  const atrybuty = { wez: wWez.value, stan: wStan.value, maska: wMaska.value, wiaz: wWiaz.value, lista: wLista.value, ijk: aIjk, tab: aTab, komLicz: aKomLicz, komSloty: wKomSloty.value };
  const wiazF = atrybuty.wiaz.array;
  const wiazU = new Uint32Array(wiazF.buffer, wiazF.byteOffset, wiazF.length);
  let wypiek = null;

  const uniformy = {
    uN, uH, uK, uCB, uKB, uKC, uCC, uCT, uCosWyp, uGStala, uGPunktC, uGPunktG, uGPunktR0, uGObrotP, uGObrotOm, uGOs, uSkG, uSkF0, uKotwice, uGruntZ, uDxP, uCap, uLepL, uLepV2,
    uGruzP, uGruzV2, uFalaV2, uFalaTempoH, uSzokProg, uKontaktV, uIKom, uZasieg2, uPekaProg, uPekaZakres, uZlomB2,
  };

  /** Uniformy sceny (§ 10.4). skG i sFr z migawki albo z budowy. Te same liczby, które WzorzecCpu liczy na początku przebiegu F. */
  function ustawUniformy(w, skG = 1, sFr = w.sFr) {
    const sM = w.sM;
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
    uGObrotP.value.set(obr ? obr.px : 0, obr ? obr.py : 0, obr ? obr.pz : 0);
    uGObrotOm.value = obr ? obr.om : 0;
    uGOs.value.set(obr ? obr.ox : 0, obr ? obr.oy : 0, obr ? obr.oz : 1);
    uSkG.value = skG;
    uSkF0.value = skG; // F0 = 0 w scenie bez kotwic już z budowy (§ 2.3, krok 4)
    uKotwice.value = w.nieruchomy.indexOf(1) >= 0 ? 1 : 0;
    uGruntZ.value = w.gruntZ;
    uDxP.value = 0.5 * w.dx;
    uCap.value = w.capEtyk;
    uLepL.value = par.lepL * sFr;
    uLepV2.value = (par.lepV * sFr) * (par.lepV * sFr);
    uGruzP.value = par.gruzPara * sFr;
    uGruzV2.value = (par.gruzV * sFr) * (par.gruzV * sFr);
    uFalaV2.value = w.rama ? par.fala.v * par.fala.v * sFr * sFr : 1e30;
    uFalaTempoH.value = Math.min(1, par.fala.tempo * w.h) * sFr;
    uSzokProg.value = par.szokTempo * w.dx * Math.sqrt(sM);
    uKontaktV.value = par.kontaktSzokV * Math.sqrt(sM);
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
    if (w.podkrokiEf !== PODKROKI) throw new Error(`Scena ma ${w.podkrokiEf} podkroków, a lista kroku ${PODKROKI}: lista jest budowana raz na solver`);
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
    for (const k of Object.values(atrybuty)) k.needsUpdate = true;
    for (const k of Object.values(kernele)) k.setCount(n);
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
    ustawUniformy(w, m.skG ?? 1, m.sFr ?? w.sFr);
  }

  /** Jeden krok fizyki 1/60 s: 22 dispatche w jednym compute passie (§ 2.4). Bez alokacji po stronie dema. */
  function krok(renderer) { renderer.compute(listaKroku); }

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

  return {
    maxNodes: MAX, kernele, sekwencja, listaKroku, listaSiatki, listaPodkroku, atrybuty, uniformy,
    wczytaj, wgraj, ustawUniformy, krok, podkrokPorownania, calkuj, rozgrzej, odczyt,
    get wypiek() { return wypiek; },
  };
}
