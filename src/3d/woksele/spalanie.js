// Spalanie odłamków bazy w atmosferze planety (demo wokseli, ?planeta=ziemia|mars; prośba użytkownika 2026-11-09). Wzory i stałe: atmosfera.js (wzorzec CPU, test).
// Gra tego nie ma: moduł tworzy tylko strona dema z planetą z atmosferą, a bez niego obraz i solver mają WGSL bez zmian.
//
// kSpal (węzły solvera, po kroku): wysokość nad krzywą powierzchnią, ρ(h), odsłonięcie czoła (żywe wiązania osiowe przed węzłem w kierunku lotu),
//   q = ½Λρv³ na czoło, temperatura z bezwładnością, ablacja czoła (ubytek komórki), opór na czole (bryła hamuje przez wiązania, przy dużym ciśnieniu
//   czoło się odrywa), korekta grawitacji planety (Mars), śmierć węzła po wypaleniu albo na gruncie. Stan żaru dla obrazu idzie przez bufor wZar
//   solvera jako liczba UJEMNA (temperatura i ubytek): shadery brył i kawałków czytają ten bufor już dziś, więc nie dochodzi nowy bufor storage (limit 8).
// kSpalG (drobiny gruzu obrazu, wokCzastki): to samo dla małych kawałków, które kurczą się z każdej strony (koziołkują), aż wyparują.
// Smugi: pula odcinków (pierścień) pisana z kerneli: plazma za czołem (krótka, addytywna), dym (długi, rozszerza się), błysk i pył uderzenia w grunt.
// Głowice: kwad na każdy rozgrzany węzeł i drobinę, wydłużony wzdłuż ruchu na ekranie (poświata plazmy przed czołem). Rozmiar na ekranie najwyżej
// do 1,4 px w dół, z zachowaniem energii: odłamek 100 km niżej to punkt światła, nie znika.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, instanceIndex, storage, instancedArray, uniform, uint, float, vec2, vec3, vec4, floatBitsToUint, sqrt, max, min, dot, length, cross, normalize,
  clamp, smoothstep, exp, log2, pow, step, mix, abs, floor, atomicAdd, positionGeometry, varyingProperty, cameraViewMatrix, cameraProjectionMatrix,
} from 'three/tsl';
import { MATERIAL_SPALANIA as M, SIGMA } from './atmosfera.js';
import { STRONA } from './budowa.js';

export const CAP_SMUG = 131072;
const T_DEKOD = 16384; // wZar < 0: −(ubytek · 63 · T_DEKOD + T / 2)
const T_WIDAC = 950; // [K] od tej temperatury odłamek świeci

/** Stan żaru z wZar (TSL, wklejane): x = temperatura [K], y = ubytek komórki 0…1. Dodatnie wZar (trafienie solvera) i zero → zimny. */
export const dekodujZar = (zf) => {
  const a = float(0).toVar();
  a.assign(max(zf.negate(), 0));
  const q = float(0).toVar();
  q.assign(floor(a.div(T_DEKOD)));
  return vec2(a.sub(q.mul(T_DEKOD)).mul(2), q.div(63));
};

/** Barwa żaru ciała o temperaturze T (przybliżenie ciała doskonale czarnego, już z jasnością), HDR. Wklejane. */
const barwaZaru = (T) => {
  const k = float(0).toVar();
  k.assign(clamp(T.sub(T_WIDAC).div(500), 0, 1));
  const g = clamp(T.sub(900).div(2600), 0, 1);
  const b = clamp(T.sub(2300).div(5200), 0, 1);
  const jas = min(T.div(1700).mul(T.div(1700)), 18);
  return vec3(1, g.mul(g.mul(-0.2).add(1.12)).mul(0.92), b.mul(0.95)).mul(jas.mul(k).mul(k));
};

function hasz(x) {
  const h = uint(0).toVar();
  h.assign(x.mul(uint(0x9E3779B1)));
  h.assign(h.bitXor(h.shiftRight(uint(15))).mul(uint(0x85EBCA77)));
  h.assign(h.bitXor(h.shiftRight(uint(13))).mul(uint(0xC2B2AE3D)));
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  return h;
}

/**
 * Część pierwsza (przed obrazem): hak obrazu. Część druga (`polacz`, po utworzeniu obrazu): kernele, pule, siatki w scenie obrazu przed rozgrzewką.
 * planeta: wpis PLANETY_ATM z atmosferą.
 */
export function createSpalanie({ solver, planeta }) {
  const atm = planeta.atmosfera;
  if (!atm) throw new Error('spalanie: planeta bez atmosfery');
  const MAX = solver.maxNodes;
  const A = solver.atrybuty;
  const { uN } = solver.uniformy;

  // ── Uniformy modelu ──
  const uPowZ = uniform(-planeta.wysBazy).setName('uSpPowZ'); // z powierzchni pod x = y = 0
  const uInv2R = uniform(1 / (2 * planeta.R)).setName('uSpInv2R');
  const uRho0 = uniform(atm.rho0).setName('uSpRho0');
  const uInvH = uniform(1 / atm.H).setName('uSpInvH');
  const uDx = uniform(40).setName('uSpDx');
  const uKlatka = uniform(0).setName('uSpKlatka');
  const uDg = uniform(0).setName('uSpDg'); // korekta grawitacji planety [j./s²] dla tego, co już spada (Mars: + 0,62 · 400)
  const uZKor = uniform(-1e30).setName('uSpZKor'); // poniżej tej wysokości węzeł i drobina już spadają
  const uMoc = uniform(1).setName('uSpMoc');
  const uTau = uniform(0).setName('uSpTau');
  const uPxSkala = uniform(500).setName('uSpPxSkala'); // px na j. w odległości 1: ½ · wysokość kadru · P[1][1]
  const uTauZen = uniform(new THREE.Vector3(...atm.tauZenit)).setName('uSpTauZen');
  const uMgla = uniform(new THREE.Vector3(...atm.mgla)).setName('uSpMgla');
  const uPlazma = uniform(new THREE.Vector3(...atm.plazma)).setName('uSpPlazma');
  const uPlazmaBrzeg = uniform(new THREE.Vector3(...atm.plazmaBrzeg)).setName('uSpPlazmaBrzeg');
  const uPlazmaOgon = uniform(new THREE.Vector3(...atm.plazmaOgon)).setName('uSpPlazmaOgon');
  const uDym = uniform(new THREE.Vector3(...atm.dym)).setName('uSpDym');
  const uSlonce = uniform(new THREE.Vector3(0.55, -0.45, 0.7).normalize()).setName('uSpSlonce');
  const DT = 1 / 60;

  // ── Bufory ── Stan węzła: T, ubytek. Drobina: T, rozmiar początkowy, rozmiar zapisany ostatnio (inny = nowa drobina w slocie). Smugi: 3 × vec4.
  const wSpal = instancedArray(MAX, 'vec2').setName('wokSpal');
  const wSpalR = storage(wSpal.value, 'vec2', MAX).setName('wokSpal').toReadOnly();
  const aSmugi = new THREE.StorageInstancedBufferAttribute(new Float32Array(4 * 3 * CAP_SMUG), 4);
  const wSmugi = storage(aSmugi, 'vec4', 3 * CAP_SMUG).setName('wokSmugi');
  const wSmugiR = storage(aSmugi, 'vec4', 3 * CAP_SMUG).setName('wokSmugi').toReadOnly();
  const aLicz = new THREE.StorageInstancedBufferAttribute(new Uint32Array(1), 1);
  const wLicz = storage(aLicz, 'uint', 1).setName('wokSmugiLicz').toAtomic();
  const wWez = storage(A.wez, 'vec4', 3 * MAX).setName('wokWez');
  const wWezR = storage(A.wez, 'vec4', 3 * MAX).setName('wokWez').toReadOnly();
  const wMaska = storage(A.maska, 'uint', 2 * MAX).setName('wokMaska');
  const wWiazR = storage(A.wiaz, 'vec4', STRONA * 2 * MAX).setName('wokWiaz').toReadOnly();
  const wZar = storage(A.zar, 'float', MAX).setName('wokZar');

  const fv = (e) => { const v = float(0).toVar(); v.assign(e); return v; };
  const uv_ = (e) => { const v = uint(0).toVar(); v.assign(e); return v; };
  const v3 = (e) => { const v = vec3(0).toVar(); v.assign(e); return v; };
  const v4 = (e) => { const v = vec4(0).toVar(); v.assign(e); return v; };

  /** Wysokość nad kulą planety (przybliżenie paraboliczne: przy 1500 km od osi błąd < 1 m). */
  const wysokosc = (x) => x.z.sub(uPowZ).add(dot(x.xy, x.xy).mul(uInv2R));
  const gestoscW = (h) => uRho0.mul(exp(max(h, 0).mul(uInvH).negate()));
  /** Przepuszczalność powietrza nad punktem na wysokości h (kamera nad atmosferą, patrzy z góry). */
  const przepuszczalnosc = (h) => exp(uTauZen.mul(exp(max(h, 0).mul(uInvH).negate())).negate());

  /** Odcinek smugi do pierścienia. typ 1 plazma, 2 dym, 3 błysk, 4 pył uderzenia. */
  const emituj = (a, b, typ, rozm, moc, T, ziarno) => {
    const k = uv_(atomicAdd(wLicz.element(uint(0)), uint(1)).mod(uint(CAP_SMUG)));
    const k3 = uv_(uint(3).mul(k));
    wSmugi.element(k3).assign(vec4(a, uKlatka));
    wSmugi.element(k3.add(uint(1))).assign(vec4(b, rozm));
    wSmugi.element(k3.add(uint(2))).assign(vec4(float(typ), moc, T, float(ziarno.bitAnd(uint(1023)))));
  };

  /** Krok cieplny wspólny dla węzła i drobiny: nowa temperatura z bezwładnością. */
  const nowaTemp = (T, q) => {
    const Teq = fv(max(float(M.tOtoczenia), pow(q.div(M.eps * SIGMA), 0.25)));
    const tau = fv(mix(float(M.tauStygniecie), float(M.tauGrzanie), step(T, Teq)));
    return T.add(Teq.sub(T).mul(float(1).sub(exp(float(-DT).div(tau)))));
  };
  /** Moc plazmy 0…1 z logarytmu strumienia ciepła (10⁵ … 10⁹ W/m²). */
  const mocPlazmy = (q) => clamp(log2(max(q, 1)).sub(16.6).div(13.3), 0, 1);

  // ── kSpal ── raz na krok solvera, po nim.
  const kSpal = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const i3 = uv_(uint(3).mul(i));
    const p = v4(wWez.element(i3));
    If(p.w.lessThan(0), () => { Return(); });
    const x = v3(p.xyz);
    const v = v3(wWez.element(i3.add(uint(1))).xyz);
    const s = fv(length(v));
    const vh = v3(v.div(max(s, 1)));
    const h = fv(wysokosc(x));
    const st = vec2(0).toVar();
    st.assign(wSpal.element(i));
    const T = fv(st.x);
    const ub = fv(st.y);
    const hz = uv_(hasz(i.add(uint(7777))));
    // Grunt: węzeł ginie, co szósty zostawia błysk, co dwunasty kłąb pyłu.
    If(h.lessThanEqual(0), () => {
      If(hz.bitAnd(uint(7)).equal(uint(0)), () => {
        const sila = fv(clamp(s.div(4000), 0.2, 2));
        emituj(x, x, 3, uDx.mul(sila).mul(4), sila, T, hz);
      });
      If(hz.shiftRight(uint(3)).bitAnd(uint(15)).equal(uint(0)), () => { emituj(x, x, 4, uDx.mul(5), clamp(s.div(4000), 0.2, 2), T, hz); });
      wWez.element(i3).assign(vec4(x, -1));
      wWez.element(i3.add(uint(1))).assign(vec4(0));
      wMaska.element(i).assign(uint(0));
      wMaska.element(uN.add(i)).assign(uint(0));
      wZar.element(i).assign(0);
      Return();
    });
    // Odsłonięcie czoła: żywy sąsiad osiowy przed węzłem w kierunku lotu zasłania go.
    const mI = uv_(wMaska.element(i));
    const zasl = fv(0);
    for (let d = 0; d < 6; d++) {
      If(mI.shiftRight(uint(d)).bitAnd(uint(1)).equal(uint(1)), () => {
        const j = uv_(floatBitsToUint(wWiazR.element(uint(36).mul(i).add(uint(2 * d + 1))).z).bitAnd(uint(0xffffff)));
        const e = v3(wWez.element(uint(3).mul(j)).xyz.sub(x)); // ten sam węzeł bufora co zapis (dwa wiązania jednej nazwy w kernelu to błąd WGSL)
        zasl.assign(max(zasl, dot(e, vh).div(max(length(e), 1e-3))));
      });
    }
    const odsl = fv(float(1).sub(smoothstep(0.35, 0.85, zasl)));
    const rho = fv(gestoscW(h));
    const q = fv(rho.mul(s).mul(s).mul(s).mul(0.5 * M.lambda).mul(odsl));
    T.assign(nowaTemp(T, q));
    const dUb = fv(q.mul(DT / (M.rhoM * M.Q)).div(uDx));
    ub.assign(ub.add(dUb));
    // Opór na czole: ½ Cd ρ v² / (ρm · dx), najwyżej połowa prędkości na krok.
    const a = fv(rho.mul(s).mul(s).mul(odsl).mul((0.5 * M.cd) / M.rhoM).div(uDx));
    const dv = fv(min(a.mul(DT), s.mul(0.5)));
    v.subAssign(vh.mul(dv));
    If(x.z.lessThan(uZKor), () => { v.z.addAssign(uDg.mul(DT)); });
    wWez.element(i3.add(uint(1))).assign(vec4(v, 0));
    // Wypalony: węzeł ginie, co trzeci rozbłyska.
    If(ub.greaterThanEqual(1 - M.ulamekZgonu), () => {
      If(hz.bitAnd(uint(3)).equal(uint(0)), () => { emituj(x, x, 3, uDx.mul(1.6), fv(0.35), T, hz); });
      wWez.element(i3).assign(vec4(x, -1));
      wWez.element(i3.add(uint(1))).assign(vec4(0));
      wMaska.element(i).assign(uint(0));
      wMaska.element(uN.add(i)).assign(uint(0));
      wZar.element(i).assign(0);
      wSpal.element(i).assign(vec2(T, ub));
      Return();
    });
    wSpal.element(i).assign(vec2(T, ub));
    // Smugi: plazma co 3 kroki z co czwartego węzła czoła, dym co 12 kroków z co ósmego (odcinek od miejsca sprzed n kroków, więc smuga ciągła).
    const faza = uv_(uint(uKlatka).add(hz));
    const moc = fv(mocPlazmy(q));
    If(T.greaterThan(1300).and(odsl.greaterThan(0.4)), () => {
      If(faza.mod(uint(3)).equal(uint(0)).and(hz.shiftRight(uint(8)).bitAnd(uint(3)).equal(uint(0))), () => {
        emituj(x.sub(v.mul(3 * DT)), x, 1, uDx.mul(0.55), moc, T, hz);
      });
      If(faza.mod(uint(12)).equal(uint(0)).and(hz.shiftRight(uint(12)).bitAnd(uint(7)).equal(uint(0))).and(dUb.greaterThan(1e-5)), () => {
        emituj(x.sub(v.mul(12 * DT)), x, 2, uDx.mul(0.7), moc, T, hz);
      });
    });
    // Żar dla obrazu: wZar < 0. Trafienie solvera (wZar > 0, żar 1 s) ma pierwszeństwo, póki świeci.
    const zf = fv(wZar.element(i));
    If(zf.lessThanEqual(0).or(uKlatka.sub(zf).greaterThan(60)), () => {
      const kod = fv(floor(clamp(ub, 0, 1).mul(63).add(0.5)).mul(T_DEKOD).add(min(T.mul(0.5), T_DEKOD - 1)));
      wZar.element(i).assign(select01(T.greaterThan(400).or(ub.greaterThan(0)), kod.negate()));
    });
  })().compute(MAX).setName('wokSpal');

  /** 0 albo wartość (bez select poza Fn: pułapka 39). */
  function select01(warunek, w) { return w.mul(float(warunek)); }

  // ── kSpalG ── drobiny gruzu obrazu: kurczą się całe, giną przy 15 % rozmiaru albo na gruncie. Obraz rysuje je z a.w, więc kurczenie widać od razu.
  let kSpalG = null;
  let wSpalG = null, wSpalGR = null, wCzastki = null, wCzastkiR = null, capG = 0;
  function kernelGruzu(obraz) {
    capG = obraz.atrybuty.czastki.count / 2;
    wSpalG = instancedArray(capG, 'vec4').setName('wokSpalG');
    wSpalGR = storage(wSpalG.value, 'vec4', capG).setName('wokSpalG').toReadOnly();
    wCzastki = storage(obraz.atrybuty.czastki, 'vec4', 2 * capG).setName('wokCzastki');
    wCzastkiR = storage(obraz.atrybuty.czastki, 'vec4', 2 * capG).setName('wokCzastki').toReadOnly();
    kSpalG = Fn(() => {
      const q2 = uv_(uint(2).mul(instanceIndex));
      const a = v4(wCzastki.element(q2));
      If(a.w.lessThanEqual(0), () => { Return(); });
      const b = v4(wCzastki.element(q2.add(uint(1))));
      const st = v4(wSpalG.element(instanceIndex));
      If(abs(st.z.sub(a.w)).greaterThan(1e-4), () => { st.assign(vec4(M.tOtoczenia, a.w, a.w, 0)); }); // nowa drobina w slocie
      const x = v3(a.xyz);
      const v = v3(b.xyz);
      const s = fv(length(v));
      const vh = v3(v.div(max(s, 1)));
      const h = fv(wysokosc(x));
      const hz = uv_(hasz(instanceIndex.add(uint(31337))));
      If(h.lessThanEqual(0), () => {
        If(hz.bitAnd(uint(31)).equal(uint(0)), () => { emituj(x, x, 3, a.w.mul(10), fv(0.3), st.x, hz); });
        wCzastki.element(q2).assign(vec4(x, 0));
        wSpalG.element(instanceIndex).assign(vec4(0));
        Return();
      });
      const rho = fv(gestoscW(h));
      const q = fv(rho.mul(s).mul(s).mul(s).mul(0.5 * M.lambda));
      const T = fv(nowaTemp(st.x, q));
      // Bok drobiny 2 · a.w maleje o q / (3 ρm Q*) · dt (koziołkuje, grzeje się z każdej strony).
      const w = fv(a.w.sub(q.mul(DT / (6 * M.rhoM * M.Q))));
      const ac = fv(rho.mul(s).mul(s).mul((0.5 * M.cd) / M.rhoM).div(max(w.mul(2), 0.5)));
      v.subAssign(vh.mul(min(ac.mul(DT), s.mul(0.5))));
      If(x.z.lessThan(uZKor), () => { v.z.addAssign(uDg.mul(DT)); });
      If(w.lessThanEqual(st.y.mul(M.ulamekZgonu)), () => {
        If(hz.bitAnd(uint(7)).equal(uint(0)), () => { emituj(x, x, 3, st.y.mul(6), fv(0.25), T, hz); });
        wCzastki.element(q2).assign(vec4(x, 0));
        wSpalG.element(instanceIndex).assign(vec4(0));
        Return();
      });
      wCzastki.element(q2).assign(vec4(x, w));
      wCzastki.element(q2.add(uint(1))).assign(vec4(v, b.w));
      wSpalG.element(instanceIndex).assign(vec4(T, st.y, w, 0));
      const faza = uv_(uint(uKlatka).add(hz));
      const moc = fv(mocPlazmy(q));
      If(T.greaterThan(1300), () => {
        If(faza.mod(uint(4)).equal(uint(0)).and(hz.shiftRight(uint(8)).bitAnd(uint(3)).equal(uint(0))), () => {
          emituj(x.sub(v.mul(4 * DT)), x, 1, max(w.mul(1.5), 2), moc, T, hz);
        });
        If(faza.mod(uint(12)).equal(uint(0)).and(hz.shiftRight(uint(12)).bitAnd(uint(7)).equal(uint(0))), () => {
          emituj(x.sub(v.mul(12 * DT)), x, 2, max(w.mul(2.5), 4), moc, T, hz);
        });
      });
    })().compute(capG).setName('wokSpalG');
  }

  // ── Hak obrazu ── Wierzchołki brył i kawałków: kurczenie wokół środka węzła, żar w emisji. Bez nowego bufora: czytają wZar, które już mają.
  const hak = {
    /** P: wierzchołek, srodek: środek węzła w tej chwili, zf: wZar węzła. */
    pozycja(P, srodek, zf) {
      const d = dekodujZar(zf);
      const sk = fv(clamp(float(1).sub(d.y.mul(0.9)), 0.12, 1));
      return srodek.add(P.sub(srodek).mul(sk));
    },
    emisja(zf) {
      return barwaZaru(dekodujZar(zf).x).mul(uMoc).mul(0.8);
    },
  };

  // ── Głowice: poświata plazmy przed czołem, wydłużona wzdłuż ruchu na ekranie ──
  const MIN_PX = 1.4;
  const vL = varyingProperty('vec2', 'vSpL');
  const vKol = varyingProperty('vec3', 'vSpKol');
  const vKolB = varyingProperty('vec3', 'vSpKolB');
  const geoKwad = () => {
    const pl = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = pl.index;
    g.setAttribute('position', pl.attributes.position);
    return g;
  };
  const geoGlowy = geoKwad();
  const ukryj = vec4(2, 2, 2, 1);
  const matGlowy = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true });
  matGlowy.name = 'WokSpalGlowa';
  matGlowy.map = null;
  blendAddytywne(matGlowy);
  let wezelGlowy = null;
  function budujGlowy() {
    matGlowy.vertexNode = Fn(() => {
      const id = instanceIndex;
      const c = vec2(positionGeometry.x, positionGeometry.y).toVar();
      const x = vec3(0).toVar();
      const v = vec3(0).toVar();
      const T = fv(0);
      const r = fv(0);
      const zywy = fv(0);
      If(id.lessThan(uint(MAX)), () => {
        If(id.lessThan(uN), () => {
          const p = v4(wWezR.element(uint(3).mul(id)));
          If(p.w.greaterThanEqual(0), () => {
            v.assign(wWezR.element(uint(3).mul(id).add(uint(1))).xyz);
            x.assign(p.xyz.add(v.mul(uTau)));
            const st = vec2(0).toVar();
            st.assign(wSpalR.element(id));
            T.assign(st.x);
            r.assign(uDx.mul(0.5).mul(clamp(float(1).sub(st.y.mul(0.9)), 0.12, 1)));
            zywy.assign(1);
          });
        });
      }).Else(() => {
        const q = uv_(id.sub(uint(MAX)));
        const a = v4(wCzastkiR.element(uint(2).mul(q)));
        If(a.w.greaterThan(0), () => {
          v.assign(wCzastkiR.element(uint(2).mul(q).add(uint(1))).xyz);
          x.assign(a.xyz.add(v.mul(uTau)));
          T.assign(wSpalGR.element(q).x);
          r.assign(a.w);
          zywy.assign(1);
        });
      });
      const wy = v4(ukryj);
      If(zywy.greaterThan(0.5).and(T.greaterThan(T_WIDAC)), () => {
        const g = fv(clamp(T.sub(T_WIDAC).div(2600), 0, 1));
        const vV = v3(cameraViewMatrix.mul(vec4(x, 1)).xyz);
        const vd = v3(cameraViewMatrix.mul(vec4(v, 0)).xyz);
        const dist = fv(max(vV.z.negate(), 1));
        // Kierunek ruchu na ekranie (pochodna rzutu x / z): spadek prosto od kamery daje kropkę, z boku smugę.
        const sd = vec2(0).toVar();
        sd.assign(vd.xy.sub(vV.xy.mul(vd.z.div(vV.z))));
        const ls = fv(length(sd));
        const e1 = vec2(1, 0).toVar();
        If(ls.greaterThan(1e-3), () => { e1.assign(sd.div(ls)); });
        const e2 = vec2(e1.y.negate(), e1.x);
        const R = fv(r.mul(float(1.7).add(g.mul(2.6))));
        const ogon = fv(float(1).add(g.mul(3).mul(clamp(ls.mul(0.12).div(R), 0, 1))));
        const px = fv(R.mul(uPxSkala).div(dist));
        const f = fv(max(float(1), float(MIN_PX).div(px)));
        R.mulAssign(f);
        const h = fv(wysokosc(x));
        const tr = v3(przepuszczalnosc(h));
        const jas = fv(uMoc.div(f.mul(f)));
        vKol.assign(barwaZaru(T).mul(tr).mul(jas));
        vKolB.assign(mix(uPlazmaBrzeg, uPlazma, 0.35).mul(g.mul(g).mul(min(T.div(1700).mul(T.div(1700)), 18)).mul(0.6)).mul(tr).mul(jas));
        const dl = fv(mix(R.mul(ogon), R, step(0, c.x)));
        const P = v3(vec3(vV.xy.add(e1.mul(r.mul(0.6))).add(e1.mul(c.x.mul(dl))).add(e2.mul(c.y.mul(R))), vV.z));
        wy.assign(cameraProjectionMatrix.mul(vec4(P, 1)));
      });
      vL.assign(c);
      return wy;
    })();
    matGlowy.fragmentNode = Fn(() => {
      const r2 = fv(dot(vL, vL));
      const rdz = fv(exp(r2.mul(-7)));
      const otoczka = fv(max(float(1).sub(r2), 0).mul(exp(r2.mul(-2))));
      return vec4(vKol.mul(rdz.mul(1.6)).add(vKolB.mul(otoczka)), 1);
    })();
    wezelGlowy = matGlowy.vertexNode;
  }
  const meshGlowy = new THREE.Mesh(geoGlowy, matGlowy);
  meshGlowy.name = 'WokSpalGlowy';
  meshGlowy.frustumCulled = false;
  meshGlowy.renderOrder = 12;

  // ── Smugi: dym (mieszanie zwykłe, premultiplied) i plazma z błyskami (addytywne) z jednej puli ──
  const vSm = varyingProperty('vec4', 'vSpSm'); // c.x, c.y, wzdłuż w szerokościach, długość w szerokościach
  const vSmK = varyingProperty('vec4', 'vSpSmK'); // barwa (premul.) + alfa
  const ZYCIE = [0, 0.6, 14, 0.75, 24];
  function budujSmugi(mat, typy) {
    mat.vertexNode = Fn(() => {
      const k3 = uv_(uint(3).mul(instanceIndex));
      const s0 = v4(wSmugiR.element(k3));
      const s1 = v4(wSmugiR.element(k3.add(uint(1))));
      const s2 = v4(wSmugiR.element(k3.add(uint(2))));
      const typ = fv(s2.x);
      const c = vec2(positionGeometry.x, positionGeometry.y).toVar();
      const wy = v4(ukryj);
      const nasz = fv(0);
      for (const t of typy) nasz.addAssign(step(abs(typ.sub(t)), 0.5));
      const wiek = fv(uKlatka.add(uTau.mul(60)).sub(s0.w).div(60));
      // Życie z typu (mnożenie przez maski: bez zagnieżdżonych select, pułapka 39).
      const zycie = fv(0);
      for (let t = 1; t <= 4; t++) zycie.addAssign(step(abs(typ.sub(t)), 0.5).mul(t === 1 ? s2.y.mul(0.5).add(0.35) : ZYCIE[t]));
      If(nasz.greaterThan(0.5).and(wiek.greaterThanEqual(0)).and(wiek.lessThan(zycie)), () => {
        const u = fv(wiek.div(zycie));
        const jeden = (t) => step(abs(typ.sub(t)), 0.5);
        // Szerokość: plazma × (1 + u), dym rośnie z √wieku do ~7×, błysk szybko, pył uderzenia wolno.
        const sz = fv(s1.w.mul(
          jeden(1).mul(u.add(1))
            .add(jeden(2).mul(sqrt(wiek).mul(1.6).add(1)))
            .add(jeden(3).mul(sqrt(u).mul(2.2).add(0.3)))
            .add(jeden(4).mul(sqrt(wiek).mul(1.4).add(1)))));
        const unies = fv(jeden(4).mul(wiek).mul(35)); // pył uderzenia wznosi się powoli
        const aV = v3(cameraViewMatrix.mul(vec4(s0.xyz.add(vec3(0, 0, unies)), 1)).xyz);
        const bV = v3(cameraViewMatrix.mul(vec4(s1.xyz.add(vec3(0, 0, unies)), 1)).xyz);
        const srodek = v3(aV.add(bV).mul(0.5));
        const dist = fv(max(srodek.z.negate(), 1));
        const os = v3(bV.sub(aV));
        const L = fv(length(os));
        const e = vec3(1, 0, 0).toVar();
        const w = vec3(0, 1, 0).toVar();
        If(L.greaterThan(sz.mul(0.05)), () => {
          e.assign(os.div(L));
          const ww = v3(cross(e, normalize(srodek)));
          If(length(ww).greaterThan(1e-3), () => { w.assign(normalize(ww)); });
        });
        const px = fv(sz.mul(uPxSkala).div(dist));
        const f = fv(max(float(1), float(1.2).div(px)));
        sz.mulAssign(f);
        const kon = fv(step(0, c.x));
        const P = v3(mix(aV.sub(e.mul(sz.mul(0.4))), bV.add(e.mul(sz.mul(0.4))), kon).add(w.mul(c.y.mul(sz))));
        wy.assign(cameraProjectionMatrix.mul(vec4(P, 1)));
        const Ls = fv(L.div(sz));
        vSm.assign(vec4(c.x, c.y, mix(float(-0.4), Ls.add(0.4), kon), Ls));
        // Barwa i alfa z typu. Przepuszczalność powietrza nad punktem: nisko smuga ginie w mgiełce.
        const h = fv(wysokosc(s1.xyz));
        const tr = v3(przepuszczalnosc(h));
        const moc = fv(s2.y);
        const T = fv(s2.z);
        const zan = fv(float(1).sub(u));
        const jasF = fv(float(1).div(f));
        // 1 plazma: młoda w barwie żaru i białej plazmy, starsza w barwie ogona (powietrze świeci jeszcze chwilę za czołem).
        const kPl = v3(mix(barwaZaru(T).mul(0.5).add(uPlazma.mul(moc.mul(3))), uPlazmaOgon.mul(moc.mul(2.2).add(0.3)), smoothstep(0, 0.45, u)).mul(zan.mul(zan)).mul(uMoc));
        // 3 błysk: biały, w pomarańcz.
        const kBl = v3(mix(vec3(6, 5.2, 4.2), uPlazmaOgon.mul(3), smoothstep(0, 0.5, u)).mul(moc).mul(zan.mul(zan).mul(zan)).mul(uMoc));
        // 2 dym, 4 pył: światło słońca i otoczenia, przy czole podświetlony żarem.
        const swiatlo = fv(dot(uSlonce, vec3(0, 0, 1)).mul(0.55).add(0.35));
        const alfaD = fv(zan.mul(zan).mul(0.5).div(wiek.mul(0.25).add(1)).mul(jasF));
        const kD = v3(uDym.mul(swiatlo).add(uPlazmaOgon.mul(moc.mul(1.5)).mul(exp(wiek.mul(-2.5)))));
        const alfaP = fv(zan.mul(0.55).div(wiek.mul(0.06).add(1)).mul(jasF));
        const kP = v3(uDym.mul(vec3(1.05, 0.95, 0.85)).mul(swiatlo));
        const dodaj = v3(kPl.mul(jeden(1)).add(kBl.mul(jeden(3))).mul(tr).mul(jasF));
        const alfa = fv(alfaD.mul(jeden(2)).add(alfaP.mul(jeden(4))));
        const kolDym = v3(kD.mul(jeden(2)).add(kP.mul(jeden(4))).mul(tr).add(uMgla.mul(0.12).mul(float(1).sub(tr.y))));
        vSmK.assign(vec4(dodaj.add(kolDym.mul(alfa)), alfa));
      });
      return wy;
    })();
    mat.fragmentNode = Fn(() => {
      const da = fv(max(vSm.z.negate(), 0).add(max(vSm.z.sub(vSm.w), 0)));
      const r2 = fv(da.mul(da).div(0.16).add(vSm.y.mul(vSm.y)));
      const k = fv(max(float(1).sub(r2), 0));
      return vec4(vSmK.rgb.mul(k), vSmK.a.mul(k));
    })();
  }
  const geoSmug = geoKwad();
  geoSmug.instanceCount = CAP_SMUG;
  const matDym = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true });
  matDym.name = 'WokSpalDym';
  matDym.map = null;
  blendPremul(matDym);
  budujSmugi(matDym, [2, 4]);
  const matPlazma = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true });
  matPlazma.name = 'WokSpalPlazma';
  matPlazma.map = null;
  blendAddytywne(matPlazma);
  budujSmugi(matPlazma, [1, 3]);
  const meshDym = new THREE.Mesh(geoSmug, matDym);
  meshDym.name = 'WokSpalDym';
  meshDym.frustumCulled = false;
  meshDym.renderOrder = 10;
  const meshPlazma = new THREE.Mesh(geoSmug, matPlazma);
  meshPlazma.name = 'WokSpalPlazma';
  meshPlazma.frustumCulled = false;
  meshPlazma.renderOrder = 11;

  let obrazP = null;
  /** Po utworzeniu obrazu, przed jego rozgrzewką: kernel gruzu, głowice, siatki w scenie obrazu. */
  function polacz(obraz) {
    obrazP = obraz;
    kernelGruzu(obraz);
    budujGlowy();
    geoGlowy.instanceCount = MAX + capG;
    obraz.scene.add(meshDym, meshPlazma, meshGlowy);
    uTau.value = 0;
  }

  /** Scena wczytana: stan od zera, grunt sceny wyłączony (spada się na planetę), powierzchnia pod bazą. */
  function wczytaj(w) {
    uDx.value = w.dx;
    uKlatka.value = 0;
    solver.uniformy.uGruntZ.value = -1e30;
    if (obrazP) { obrazP.grunt.visible = false; }
    // Najniższy węzeł wypieku: niżej wszystko już spada (korekta grawitacji planety).
    let zMin = Infinity;
    for (let i = 0; i < w.n; i++) zMin = Math.min(zMin, w.pos[3 * i + 2]);
    uZKor.value = zMin - 300;
    const g = Math.abs(w.g?.[2] ?? w.g ?? 400) || 400;
    uDg.value = (1 - (planeta.gMnoz ?? 1)) * g;
    zerujBufory();
  }
  let doZerowania = false;
  function zerujBufory() {
    aSmugi.array.fill(0);
    aSmugi.needsUpdate = true;
    aLicz.array[0] = 0;
    aLicz.needsUpdate = true;
    doZerowania = true;
  }

  /** Po kroku solvera, przed obrazem. Pierwszy krok po wczytaniu zeruje stan kernelem (bufory instancedArray nie mają tablicy CPU do wysłania). */
  function krok(renderer) {
    uKlatka.value = solver.fKlatka;
    if (doZerowania) { renderer.compute(kZeruj); if (kZerujG) renderer.compute(kZerujG); doZerowania = false; }
    renderer.compute(kSpal);
    if (kSpalG) renderer.compute(kSpalG);
  }
  const kZeruj = Fn(() => { wSpal.element(instanceIndex).assign(vec2(M.tOtoczenia, 0)); })().compute(MAX).setName('wokSpalZeruj');
  let kZerujG = null;

  /** Przed rysunkiem: chwila między krokami, skala px dla minimalnego rozmiaru, kierunek słońca. */
  function klatka(camera, tau, wysokoscKadru) {
    uTau.value = tau;
    uKlatka.value = solver.fKlatka;
    uPxSkala.value = 0.5 * wysokoscKadru * camera.projectionMatrix.elements[5];
    if (obrazP) uSlonce.value.copy(obrazP.sun.position).normalize();
  }

  async function rozgrzej(renderer) {
    if (!kZerujG && wSpalG) kZerujG = Fn(() => { wSpalG.element(instanceIndex).assign(vec4(0)); })().compute(capG).setName('wokSpalZerujG');
    for (const k of [kSpal, kSpalG, kZeruj, kZerujG]) if (k) await renderer.computeAsync(k, [0, 1, 1]);
  }

  return {
    hak, polacz, wczytaj, krok, klatka, rozgrzej, planeta,
    get kernele() { return { kSpal, kSpalG }; },
    siatki: () => [meshDym, meshPlazma, meshGlowy],
    uniformy: { uPowZ, uMoc, uDg, uZKor, uSlonce },
    atrybuty: { smugi: aSmugi, licz: aLicz },
    get wezelGlowy() { return wezelGlowy; },
  };
}

/** (ONE, ONE), wyjście bez premultiplyAlpha (pułapki 13, 43). */
function blendAddytywne(m) {
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.premultipliedAlpha = false;
  m.forceSinglePass = true;
}
/** Kolor już pomnożony przez alfę: (ONE, ONE − alfa). */
function blendPremul(m) {
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.premultipliedAlpha = false;
  m.forceSinglePass = true;
}
