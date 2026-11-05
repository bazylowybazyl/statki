// Test GPU z Node na stronie dema, ?test=1 (docs/SPEC-woksele-zawalenia.md § 8): jeden podkrok z migawek P0, mutacje, W1, vMax, punkt G1.
// Wzorcem jest zawsze migawka z Node albo WzorzecCpu liczony tutaj: nigdy GPU z GPU. Moduł bez DOM, migawki przez fetch z własnego Vite.
import { rozpakujMigawke, sprawdzBudowe, WzorzecCpu } from './wzorzec-cpu.js';
import { porownajPodkrok, ObserwatorSceny, analizaPolowek, pietraStropow, taca } from './metryki.js';
import { popcnt, zbuduj, PARAMETRY } from './budowa.js';
import { WzorzecF32 } from './wzorzecF32.js';
import { S1, S2, S3, S4, krater, planGpu } from './scena.js';

const KATALOG = '/.tmp/woksele-demo/migawki/';

/** Mutacje z § 8, te same co w scripts/woksele-sym.mjs: przez uniformy i dane, więc ten sam kernel, bez nowego pipeline'u. Kolejność jak w nagłówkach migawek. */
const MUTACJE = {
  'bez fali (A nie rośnie)': { u: (U) => { U.uFalaTempoH.value = 0; } },
  'bez falaPeka (fala nie łamie granic)': { u: (U) => { U.uPekaProg.value = 1e30; U.uPekaZakres.value = 0; } },
  'bez zakleszczenia pary': { u: (U) => { U.uGruzP.value = 0; } },
  'bez lepkości': { u: (U) => { U.uLepL.value = 0; } },
  'zginanie bez plastyczności (zlomB 0)': { u: (U) => { U.uZlomB2.value = 0; } },
  'wypiek po 90° zamiast 12°': { u: (U) => { U.uCosWyp.value = 0; } },
  'bez szkody od kontaktu': { d: (A, n) => { const s = A.stan.array; for (let i = 0; i < n; i++) s[4 * (2 * n + 2 * i) + 4] = 0; A.stan.needsUpdate = true; } },
  'bez szoku': { d: (A, n) => { const s = A.stan.array; for (let i = 0; i < n; i++) s[4 * (2 * n + 2 * i) + 2] = 0; A.stan.needsUpdate = true; } },
  'bez rozlewu': { d: (A, n) => { const s = A.stan.array; for (let i = 0; i < n; i++) s[4 * (2 * n + 2 * i) + 1] = 0; A.stan.needsUpdate = true; } },
  'bez kruszenia': { d: (A) => { const t = A.tab.array; for (let k = 0; k < 12; k++) t[4 * (18 + k) + 2] = 0; A.tab.needsUpdate = true; } },
};

const pamMigawek = new Map();
async function wczytajMigawke(nazwa) {
  let m = pamMigawek.get(nazwa);
  if (m) return m;
  const [rj, rb] = await Promise.all([fetch(`${KATALOG}${nazwa}.json`), fetch(`${KATALOG}${nazwa}.bin`)]);
  if (!rj.ok || !rb.ok) throw new Error(`Brak migawki ${nazwa}: ${rj.status}, ${rb.status}. Migawki robi: node scripts/woksele-sym.mjs`);
  const naglowek = await rj.json();
  const ab = await rb.arrayBuffer();
  if (ab.byteLength !== naglowek.rozmiar) throw new Error(`Migawka ${nazwa}: ${ab.byteLength} B, a nagłówek mówi ${naglowek.rozmiar}. Vite podał inny plik?`);
  m = rozpakujMigawke(naglowek, ab);
  pamMigawek.set(nazwa, m);
  return m;
}

const stanMigawki = (m) => ({ ...m.przed, skG: m.skG, sFr: m.sFr, kotwiceWiezy: m.kotwiceWiezy, budowa: m.budowa });

/** Niesymetryczne bity maski: i ma wiązanie do j, a j go nie ma do i (§ 2.5, R5). */
function asymetrieMasek(w, maska) {
  const { n, nbr } = w;
  let ile = 0;
  for (let i = 0; i < n; i++) {
    let m = maska[i];
    while (m) {
      const bit = m & -m;
      m ^= bit;
      const d = 31 - Math.clz32(bit);
      const j = nbr[18 * i + d];
      if (j < 0 || !((maska[j] >>> (d ^ 1)) & 1)) ile++;
    }
  }
  return ile;
}

function liczNaN(t) {
  let c = 0;
  for (let i = 0; i < t.length; i++) if (t[i] !== t[i]) c++;
  return c;
}

/** Różnice zbiorów kontaktów GPU i Node. Kolejność w liście jest dowolna (kWstaw to wyścig na atomiku, § 2.7), więc tylko zbiory. */
function roznicaList(wzor, gpu, n, M) {
  const a = new Set(), b = new Set();
  let wezlow = 0, tylkoNode = 0, tylkoGpu = 0;
  const przyklady = [];
  for (let i = 0; i < n; i++) {
    a.clear(); b.clear();
    for (let c = 0; c < wzor.lLicz[i]; c++) a.add(wzor.lista[M * i + c]);
    for (let c = 0; c < gpu.lLicz[i]; c++) b.add(gpu.lista[M * i + c]);
    let roz = false;
    for (const x of a) if (!b.has(x)) { tylkoNode++; roz = true; }
    for (const x of b) if (!a.has(x)) { tylkoGpu++; roz = true; }
    if (roz) { wezlow++; if (przyklady.length < 8) przyklady.push({ i, node: [...a], gpu: [...b] }); }
  }
  return { wezlow, tylkoNode, tylkoGpu, przyklady };
}

/** Przepełnione komórki siatki z pozycji migawki, tak samo jak w `WzorzecCpu._przebudujListe`: tu jedyna dopuszczalna przyczyna innej listy. */
function przepelnioneKomorki(w, pos, aktywny) {
  const mk = w.nKom - 1;
  const licz = new Int32Array(w.nKom);
  let odrzucone = 0;
  for (let i = 0; i < w.n; i++) {
    if (!aktywny[i]) continue;
    const a = Math.floor(pos[3 * i] * w.iKom), b = Math.floor(pos[3 * i + 1] * w.iKom), c = Math.floor(pos[3 * i + 2] * w.iKom);
    const h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & mk;
    if (licz[h]++ >= w.S) odrzucone++;
  }
  return odrzucone;
}

/** Wiązania, na których f64 i GPU poszły inną gałęzią, a co na nich mówi wzorzec f32: f32 = GPU to zaokrąglenie przy progu, f32 = f64 to błąd kernela. F0 tą samą regułą co L i D, próg 1 jak w porownajPodkrok. */
function flipy(w, f64, f32, gpu) {
  const wy = [];
  for (let q = 0; q < 18 * w.n; q++) {
    const dg = Math.abs(f64.L[q] - gpu.L[q]);
    if (!(dg > 1e-3) && !(Math.abs(f64.D[q] - gpu.D[q]) > 1e-3) && !(Math.abs(f64.F0[q] - gpu.F0[q]) > 1)) continue;
    wy.push({ i: q / 18 | 0, d: q % 18, Lf64: f64.L[q], Lf32: f32.L[q], Lgpu: gpu.L[q], F0f64: f64.F0[q], F0f32: f32.F0[q], F0gpu: gpu.F0[q], f32JakGpu: Math.abs(f32.L[q] - gpu.L[q]) <= 1e-3 && Math.abs(f32.D[q] - gpu.D[q]) <= 1e-3 && Math.abs(f32.F0[q] - gpu.F0[q]) <= 1 });
  }
  return wy;
}

const stanS = (st, n, i) => st[4 * (n + i)];

/** Sceny pełne, § 12 P2. Stan startowy z budowy, plan przez solver.ustawPlan, bez CPU po węzłach w kroku. */
const PLANY_PELNE = {
  S1: () => S1(),
  S2: () => S2(),
  S3: () => S3(),
  S4: () => S4(),
  S4g: () => S4({ g: 400, grunt: true, kotwice: true, T: 9 }), // § 5.2 scena 6
  S4sw: () => S4({ g: 400, T: 6 }),
  rampa: () => S4({ g: 400, grunt: true, kotwice: true, bezCiecia: true, J: 0, skalaG: [1, 2, 1, 0], T: 6 }),
  krater60p: () => krater({ c: [190, 0, 650], r: 60, J: 300, rP: 160, proznia: true, T: 10 }),
  krater90p: () => krater({ c: [190, 0, 650], r: 90, J: 600, rP: 240, proznia: true, T: 10 }),
  krater60g: () => krater({ c: [190, 0, 650], r: 60, J: 300, rP: 160, T: 10 }),
};

/** Najgorsze węzły różnicy przyspieszenia i pierwsze różne maski: wejście do szukania gałęzi § 2.11. */
function diagnoza(w, wzor, wynik, przed) {
  const n = w.n;
  const zle = [];
  for (let i = 0; i < n; i++) {
    if (!przed.aktywny[i] || przed.nieruchomy[i]) continue;
    const ax = wzor.acc[3 * i] - wynik.acc[3 * i], ay = wzor.acc[3 * i + 1] - wynik.acc[3 * i + 1], az = wzor.acc[3 * i + 2] - wynik.acc[3 * i + 2];
    const q = Math.sqrt(ax * ax + ay * ay + az * az);
    if (q > 5 || q !== q) zle.push([q, i]);
  }
  zle.sort((p, q) => q[0] - p[0]);
  const opis = (i) => ({
    i, kind: w.kind[i], ijk: [w.ijk[3 * i], w.ijk[3 * i + 1], w.ijk[3 * i + 2]], bezG: w.bezG[i], S: przed.szkoda[i], A: przed.A[i], etyk: przed.etyk[i],
    maska: przed.maskaW[i], kontNode: wzor.lLicz[i], kontGpu: wynik.lLicz[i],
    aNode: [wzor.acc[3 * i], wzor.acc[3 * i + 1], wzor.acc[3 * i + 2]], aGpu: [wynik.acc[3 * i], wynik.acc[3 * i + 1], wynik.acc[3 * i + 2]],
  });
  const maski = [];
  for (let i = 0; i < n && maski.length < 12; i++) {
    if (przed.aktywny[i] && wzor.maskaW[i] !== wynik.maskaW[i]) maski.push({ ...opis(i), mNode: wzor.maskaW[i], mGpu: wynik.maskaW[i], xor: (wzor.maskaW[i] ^ wynik.maskaW[i]) >>> 0 });
  }
  const pola = [];
  for (const [nazwa, tab, prog] of [['L', 'L', 1e-3], ['D', 'D', 1e-3]]) {
    for (let q = 0, c = 0; q < 18 * n && c < 6; q++) {
      const roz = Math.abs(wzor[tab][q] - wynik[tab][q]);
      if (roz > prog || roz !== roz) { pola.push({ pole: nazwa, i: q / 18 | 0, d: q % 18, node: wzor[tab][q], gpu: wynik[tab][q], kl: w.klasaW[q] }); c++; }
    }
  }
  const stany = [];
  for (const nazwa of ['szkoda', 'A']) {
    for (let i = 0, c = 0; i < n && c < 6; i++) {
      if (!przed.aktywny[i]) continue;
      const roz = Math.abs(wzor[nazwa][i] - wynik[nazwa][i]);
      if (roz > 1e-3 || roz !== roz) { stany.push({ pole: nazwa, i, node: wzor[nazwa][i], gpu: wynik[nazwa][i], kind: w.kind[i], przedS: przed.szkoda[i], przedA: przed.A[i] }); c++; }
    }
  }
  const et = [];
  for (let i = 0, c = 0; i < n && c < 6; i++) {
    if (przed.aktywny[i] && wzor.etyk[i] !== wynik.etyk[i]) { et.push({ i, node: wzor.etyk[i], gpu: wynik.etyk[i], stoi: przed.nieruchomy[i], bezG: w.bezG[i] }); c++; }
  }
  return { ponadA: zle.length, najgorsze: zle.slice(0, 10).map(([q, i]) => ({ da: q, ...opis(i) })), maski, pola, stany, etykiety: et };
}

export function createTestGpu({ renderer, solver, wypiekSceny, wok }) {
  /** Jeden przebieg kLista + kF z migawki Node. opcje.mutacja: nazwa z MUTACJE; opcje.diag: lista węzłów i zbiory kontaktów. */
  async function podkrok(nazwa, { mutacja = null, diag = false } = {}) {
    const m = await wczytajMigawke(nazwa);
    const w = wypiekSceny(m.scena);
    sprawdzBudowe(m.budowa, w);
    solver.wczytaj(w);
    const mut = mutacja ? MUTACJE[mutacja] : null;
    if (mutacja && !mut) throw new Error(`Nieznana mutacja ${mutacja}`);
    mut?.d?.(solver.atrybuty, w.n);
    solver.wgraj(stanMigawki(m));
    mut?.u?.(solver.uniformy);
    solver.podkrokPorownania(renderer);
    const o = await solver.odczyt(renderer);
    const wynik = { maskaW: o.maskaW, szkoda: o.szkoda, A: o.A, etyk: o.etyk, L: o.L, D: o.D, F0: o.F0, acc: o.acc, lLicz: o.lLicz, lista: o.lista };
    // Etykieta liczona tylko w scenach z kotwicami: § 1.6, bez kotwic Node jej nie liczy, a wzór GPU daje 0.
    const liczEtyk = !mutacja && w.capEtyk > 0;
    // AGENT: wzorzec „po” liczony tutaj, nie z pliku: migawki P0 policzono przy S = 16, a solver ma S = 24 (§ 2.7). Stan „przed” z pliku jest dobry, to tylko punkt na trajektorii.
    const c64 = new WzorzecCpu(w);
    c64.wgraj(stanMigawki(m));
    c64.podkrokPorownania();
    const po = c64.stanPoPodkroku();
    const wy = porownajPodkrok(po, wynik, m.przed.aktywny, m.przed.nieruchomy, { liczEtyk });
    wy.liczEtyk = liczEtyk;
    wy.nanStan = liczNaN(o.poz) + liczNaN(o.vel) + liczNaN(o.acc) + liczNaN(o.szkoda) + liczNaN(o.A) + liczNaN(o.L) + liczNaN(o.D) + liczNaN(o.F0);
    wy.asymetrie = asymetrieMasek(w, o.maskaW);
    wy.listaRozne = roznicaList(po, wynik, w.n, w.M);
    wy.przepelnioneKomorki = przepelnioneKomorki(w, m.przed.pos, m.przed.aktywny);
    wy.listaOk = wy.listaRozne.wezlow === 0 || wy.przepelnioneKomorki > 0;
    if (mutacja) wy.mutacjaNode = m.mutacje?.[mutacja] ?? null;
    else {
      // Ten sam podkrok w Node w arytmetyce f32 (§ 8): te same progi, inny wzorzec. Odróżnia zaokrąglenie przy progu od błędu kernela.
      const c32 = new WzorzecF32(w);
      c32.wgraj(stanMigawki(m));
      c32.podkrokPorownania();
      const w32 = c32.stanPoPodkroku();
      wy.wzgledemF32 = porownajPodkrok(w32, wynik, m.przed.aktywny, m.przed.nieruchomy, { liczEtyk });
      wy.f32WzgledemF64 = porownajPodkrok(po, w32, m.przed.aktywny, m.przed.nieruchomy, { liczEtyk });
      wy.flipy = flipy(w, po, w32, wynik);
    }
    if (diag) wy.diagnoza = diagnoza(w, po, wynik, m.przed);
    delete wy.listaRozne.przyklady;
    if (diag) wy.listaPrzyklady = roznicaList(po, wynik, w.n, w.M).przyklady;
    wy.bledyGpu = wok.bledy().length;
    return wy;
  }

  /** Mutacje § 8 na GPU: każda ma być wykryta tam, gdzie wykrył ją Node. */
  async function mutacje(nazwy, lista = Object.keys(MUTACJE)) {
    const wy = {};
    for (const mut of lista) {
      wy[mut] = {};
      for (const nazwa of nazwy) {
        const r = await podkrok(nazwa, { mutacja: mut });
        const nd = r.mutacjaNode;
        wy[mut][nazwa] = {
          wykrytaGpu: !r.zaliczony, wykrytaNode: nd ? !nd.zaliczony : null,
          gpu: { maski: r.maski, s: r.s, a: r.a, l: r.l, d: r.d, f0: r.f0, daP99: r.daP99 },
          node: nd ? { maski: nd.maski, s: nd.s, a: nd.a, l: nd.l, d: nd.d, f0: nd.f0, daP99: nd.daP99 } : null,
        };
      }
    }
    return wy;
  }

  /** Gałęzie [G] § 10.4, których migawki P0 nie ruszają: obrót, punkt, rampa skali. Stan z WzorzecCpu liczonego tutaj, potem ten sam jeden podkrok z tymi samymi progami. */
  async function zrodla() {
    const wy = {};
    for (const [nazwa, id, skala] of [['obrót', 'S4obrot', 1], ['punkt', 'S4punkt', 1], ['grunt, kotwice, rampa skali 0,5', 'S4grunt', 0.5]]) {
      const w = wypiekSceny(id);
      const cpu = new WzorzecCpu(w);
      for (let k = 0; k < 30; k++) cpu.krok();
      if (skala !== 1) { cpu.skalaG(skala); for (let k = 0; k < 6; k++) cpu.krok(); }
      const m = cpu.migawka();
      solver.wczytaj(w);
      solver.wgraj(m);
      solver.podkrokPorownania(renderer);
      const o = await solver.odczyt(renderer);
      cpu.podkrokPorownania();
      const wynik = { maskaW: o.maskaW, szkoda: o.szkoda, A: o.A, etyk: o.etyk, L: o.L, D: o.D, F0: o.F0, acc: o.acc };
      const r = porownajPodkrok(cpu.stanPoPodkroku(), wynik, m.aktywny, m.nieruchomy, { liczEtyk: w.capEtyk > 0 });
      let aSr = 0;
      for (let i = 0; i < 3 * w.n; i++) aSr += Math.abs(o.acc[i]);
      wy[nazwa] = { ...r, sredniaAbsA: aSr / (3 * w.n), skG: m.skG, sFr: m.sFr };
    }
    return wy;
  }

  /**
   * Ten sam krok GPU i WzorzecCpu z tej samej migawki (§ 8, sprawdzian P1): po `krokow` krokach 0 różnych masek względem Node f64, licząc też Node f32 jako drugi wzorzec,
   * bo zaokrąglenie przy progu daje różnicę z f64 bez błędu kernela (§ 1.7). Lista różna tylko przy przepełnionej komórce, a w P2 komórek pełnych nie ma (S = 24).
   */
  async function krokZWzorcem(nazwa, krokow = 8) {
    const m = await wczytajMigawke(nazwa);
    const w = wypiekSceny(m.scena);
    solver.wczytaj(w);
    solver.wgraj(stanMigawki(m));
    const cpu = new WzorzecCpu(w);
    cpu.wgraj(stanMigawki(m));
    const c32 = new WzorzecF32(w);
    c32.wgraj(stanMigawki(m));
    await wok.krok(krokow);
    for (let k = 0; k < krokow; k++) { cpu.krok(); c32.krok(); }
    const o = await solver.odczyt(renderer);
    let maski = 0, maskiF32 = 0, maskiF32F64 = 0, dxMax = 0, dvMax = 0, dSMax = 0;
    for (let i = 0; i < w.n; i++) {
      if (!cpu.aktywny[i]) continue;
      if (cpu.maskaW[i] !== o.maskaW[i]) maski++;
      if (c32.maskaW[i] !== o.maskaW[i]) maskiF32++;
      if (c32.maskaW[i] !== cpu.maskaW[i]) maskiF32F64++;
      for (let c = 0; c < 3; c++) {
        dxMax = Math.max(dxMax, Math.abs(cpu.pos[3 * i + c] - o.poz[3 * i + c]));
        dvMax = Math.max(dvMax, Math.abs(cpu.vel[3 * i + c] - o.vel[3 * i + c]));
      }
      dSMax = Math.max(dSMax, Math.abs(cpu.szkoda[i] - o.szkoda[i]));
    }
    const stanCpu = { lLicz: cpu.lLicz, lista: cpu.lista };
    const lista = roznicaList(stanCpu, { lLicz: o.lLicz, lista: o.lista }, w.n, w.M);
    delete lista.przyklady;
    const przepelnione = przepelnioneKomorki(w, cpu.pos, cpu.aktywny);
    // Po kilku krokach pozycje f32 i f64 różnią się o dxMax, więc para na granicy zasięgu listy może wejść tylko po jednej stronie. To nie błąd kernela: zaliczenie liczy pary dalej od granicy niż to przesunięcie.
    let listaPozaGranica = 0;
    const zapas = 2 * dxMax + 1;
    const a = new Set();
    for (let i = 0; i < w.n; i++) {
      a.clear();
      for (let c = 0; c < cpu.lLicz[i]; c++) a.add(cpu.lista[w.M * i + c]);
      let wspolne = 0;
      for (let c = 0; c < o.lLicz[i]; c++) {
        const j = o.lista[w.M * i + c];
        if (a.has(j)) { wspolne++; continue; }
        const d = Math.sqrt((o.poz[3 * i] - o.poz[3 * j]) ** 2 + (o.poz[3 * i + 1] - o.poz[3 * j + 1]) ** 2 + (o.poz[3 * i + 2] - o.poz[3 * j + 2]) ** 2);
        if (Math.abs(d - w.zasieg) > zapas) listaPozaGranica++;
      }
      if (wspolne < a.size) {
        const bG = new Set();
        for (let c = 0; c < o.lLicz[i]; c++) bG.add(o.lista[w.M * i + c]);
        for (const j of a) {
          if (bG.has(j)) continue;
          const d = Math.sqrt((cpu.pos[3 * i] - cpu.pos[3 * j]) ** 2 + (cpu.pos[3 * i + 1] - cpu.pos[3 * j + 1]) ** 2 + (cpu.pos[3 * i + 2] - cpu.pos[3 * j + 2]) ** 2);
          if (Math.abs(d - w.zasieg) > zapas) listaPozaGranica++;
        }
      }
    }
    return {
      krokow, maski, maskiF32, maskiF32F64, dxMax, dvMax, dSMax, lista, listaPozaGranica, przepelnione, maxKomorka: cpu.maxKomorka, odrzuconeNode: cpu.przepelnieniaKomorek,
      asymetrie: asymetrieMasek(w, o.maskaW), asymetrieNode: asymetrieMasek(w, cpu.maskaW), nan: liczNaN(o.poz) + liczNaN(o.vel),
      zaliczony: maski === 0 && (listaPozaGranica === 0 || przepelnione > 0),
    };
  }

  /**
   * Scena od początku biegu na GPU, § 12 P2: stan z budowy, plan zdarzeń w solverze, metryki z tych samych funkcji co w Node (scripts/woksele-sym.mjs).
   * Odczyt co 15 klatek i klatkę wcześniej (prędkość średnia), S3 co klatkę (śledzenie przebicia). Sama lekka część bufora: reszta stanu tylko na końcu.
   */
  const pamiecStatykiP2 = new Map();
  const wypiekiP2 = new Map();
  const zrzutyP2 = new Map();
  function wypiekPelny(id) {
    const f = PLANY_PELNE[id];
    if (!f) throw new Error(`Nieznana scena pełna ${id}`);
    const plan = f();
    let w = wypiekiP2.get(id);
    if (!w) { w = zbuduj(plan.scena, PARAMETRY, { pamiecStatyki: pamiecStatykiP2 }); wypiekiP2.set(id, w); }
    return { plan, w };
  }

  async function scenaPelna(id, { T = null, tace = [] } = {}) {
    const { plan, w } = wypiekPelny(id);
    if (T) plan.T = T;
    solver.wczytaj(w);
    solver.ustawPlan(planGpu(plan));
    const n = w.n;
    const N = Math.round(plan.T * 60);
    const ob = new ObserwatorSceny(plan);
    const pp = tace.length ? pietraStropow(plan.scena) : null;
    const mapaTac = new Map(tace.map((t) => [Math.round(t * 60), t]));
    const stan = { n, pos: null, vel: null, aktywny: null, maskaW: null, wa: w.wa, wb: w.wb, wd: w.wd, mW: w.mW, nbr: w.nbr, iN0: w.iN0, zerwanych: 0 };
    const pos0 = plan.scena.pos;
    const jestPolowa = plan.zc !== undefined;
    const czyscOd = jestPolowa ? plan.tS : Infinity;
    const zo = plan.zdarzeniaOd;
    const fW1 = Number.isFinite(zo) ? Math.max(0, Math.ceil(zo * 60) - 1) : -1;
    const o4 = plan.opcje ?? {};
    const chwile = {};
    const tacePo = {};
    let maxDryf = 0, msKroki = 0, odczytow = 0, wpisyAsym = 0, nanLicz = 0, fG = 0, maxOdrzucone = 0, sumaOdrzucone = 0;
    const czyCzytac = (f) => f === N || f % 15 === 0 || (f + 1) % 15 === 0 || f === fW1 || f === fW1 - 1 || mapaTac.has(f) || plan.s3;
    for (let f = 0; f <= N; f++) {
      if (!czyCzytac(f)) continue;
      if (f > fG) {
        const t0 = performance.now();
        await wok.krok(f - fG);
        msKroki += performance.now() - t0;
        fG = f;
      }
      // AGENT: przed pierwszym compute bufor GPU ma jeszcze poprzednią scenę: needsUpdate wysyła dopiero compute, więc f = 0 ze stanu budowy.
      const o = f === 0
        ? { pos: w.pos, vel: w.vel0 ?? new Float32Array(3 * n), aktywny: new Uint8Array(n).fill(1), maskaW: w.maska }
        : await solver.odczytLekki(renderer);
      odczytow++;
      stan.pos = o.pos; stan.vel = o.vel; stan.aktywny = o.aktywny; stan.maskaW = o.maskaW;
      ob.klatka(f, stan);
      const t = f / 60;
      if (mapaTac.has(f)) tacePo[mapaTac.get(f)] = taca(stan, pp);
      if (f % 15 === 0) {
        nanLicz += liczNaN(o.pos) + liczNaN(o.vel);
        wpisyAsym += asymetrieMasek(w, o.maskaW);
        const odrz = przepelnioneKomorki(w, o.pos, o.aktywny);
        sumaOdrzucone += odrz;
        if (odrz > maxOdrzucone) maxOdrzucone = odrz;
      }
      if (jestPolowa) {
        if (t < czyscOd - 1e-9) {
          const dzS = o4.grunt || o4.kotwice ? 0 : 0.5 * (o4.g ?? 0) * t * t;
          let q = 0;
          for (let i = 0; i < n; i++) {
            const dX = o.pos[3 * i] - pos0[3 * i], dY = o.pos[3 * i + 1] - pos0[3 * i + 1], dZ = o.pos[3 * i + 2] - pos0[3 * i + 2] + dzS;
            const r = dX * dX + dY * dY + dZ * dZ;
            if (r > q) q = r;
          }
          if (q > maxDryf) maxDryf = q;
        }
        if (f % 30 === 0 && (t >= plan.tS - 0.01 || f === 0)) {
          const a = analizaPolowek(stan, pos0, plan.zc, 120);
          chwile[t] = { P: a.P, L: a.L, N: a.N, kosze: a.kosze, gora: { v: a.gora.v, w: a.gora.w, kat: a.gora.kat, ulamek: a.gora.ulamek, ulOderwPoza: a.gora.ulOderwPoza, lWlasny: a.gora.lWlasny }, dol: { v: a.dol.v, w: a.dol.w, kat: a.dol.kat, ulamek: a.dol.ulamek, ulOderwPoza: a.dol.ulOderwPoza, lWlasny: a.dol.lWlasny } };
        }
      }
      if (f === 360) zrzutyP2.set(id, o.pos);
    }
    const p = ob.koniec(stan);
    const pelny = await solver.odczyt(renderer);
    let sPonad = 0, vMaxKoniec = 0;
    for (let i = 0; i < n; i++) {
      if (!pelny.aktywny[i]) continue;
      if (stanS(pelny.stan, 0, i) > 1.001) sPonad++;
      const v2 = pelny.vel[3 * i] ** 2 + pelny.vel[3 * i + 1] ** 2 + pelny.vel[3 * i + 2] ** 2;
      if (v2 > vMaxKoniec) vMaxKoniec = v2;
    }
    const dach = {}, przechylT = {};
    for (const e of ob.wpisy) { dach[e.t] = e.wieza.dach; przechylT[e.t] = e.wieza.przechyl.sztywnyStopnie; }
    let calosc = null;
    if (plan.id === 'krater') {
      const a = analizaPolowek(stan, pos0, -1e9, 0);
      calosc = { ulamek: a.gora.ulamek, oderwane: a.gora.n - a.gora.najw, v: a.gora.v, w: a.gora.w, P: Math.sqrt(a.P[0] ** 2 + a.P[1] ** 2 + a.P[2] ** 2) / a.N, usuniete: n - a.N, planowo: plan.usuniete };
    }
    return {
      id, n, N, msKroki, msNaKrok: msKroki / N, odczytow, dach, przechylT, tace: tacePo, chwile, calosc, dryf: Math.sqrt(maxDryf), sPonad, vmaxKoniec: Math.sqrt(vMaxKoniec),
      nan: nanLicz + liczNaN(pelny.poz) + liczNaN(pelny.vel) + liczNaN(pelny.acc) + liczNaN(pelny.szkoda) + liczNaN(pelny.A) + liczNaN(pelny.L) + liczNaN(pelny.D) + liczNaN(pelny.F0),
      asymetrie: asymetrieMasek(w, pelny.maskaW) + wpisyAsym, odrzucone: { suma: sumaOdrzucone, maks: maxOdrzucone }, liczniki: { ...solver.liczniki }, bledyGpu: wok.bledy().length,
      podsumowanie: { historia: p.historia, W1: p.W1, S3: p.S3, koniec: { wieza: { dach: p.koniec.wieza.dach, wyspy: p.koniec.wieza.wyspy, ruch: p.koniec.wieza.ruch, przechyl: p.koniec.wieza.przechyl }, dysk: p.koniec.dysk ? { otworDoPrzekroju: p.koniec.dysk.otworDoPrzekroju, udzialRuszonych: p.koniec.dysk.udzialRuszonych, wyspy: p.koniec.dysk.wyspy } : null, aktywnych: p.koniec.aktywnych } },
    };
  }

  /** Jedna liczba ściany: cała scena bez odczytów, razem z czekaniem na kolejkę. To nie pomiar kroku (P6), tylko kontrola, że zdarzenia niczego nie popsuły. */
  async function sciana(id = 'S3') {
    const { plan, w } = wypiekPelny(id);
    solver.wczytaj(w);
    solver.ustawPlan(planGpu(plan));
    const N = Math.round(plan.T * 60);
    const t0 = performance.now();
    await wok.krok(N);
    const ms = performance.now() - t0;
    return { id, N, ms, msNaKrok: ms / N };
  }

  /** Równoważność § 8: S4 przy g = 400 bez gruntu i kotwic względem próżni, po odjęciu spadku (Euler półjawny). Wymaga wcześniejszych scenaPelna('S4') i scenaPelna('S4sw'). */
  function rownowaznosc() {
    const a = zrzutyP2.get('S4'), b = zrzutyP2.get('S4sw');
    if (!a || !b) return null;
    const t = 6, h = 1 / 480, dz = -400 * (0.5 * t * t + 0.5 * t * h);
    const n = a.length / 3, d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const ex = b[3 * i] - a[3 * i], ey = b[3 * i + 1] - a[3 * i + 1], ez = b[3 * i + 2] - dz - a[3 * i + 2];
      d[i] = Math.sqrt(ex * ex + ey * ey + ez * ez);
    }
    d.sort();
    return { mediana: d[Math.floor(0.5 * n)], p99: d[Math.floor(0.99 * n)] };
  }

  /** Strzał w próżni (§ 12 P2): ruch zaczyna się przy trafionym, pudło nic nie rusza, a strzał w czasie planu pchnięć daje kop. Wieża bez cięcia i bez pchnięć albo S4 w trakcie planu. */
  async function strzal() {
    const wy = {};
    const pomiar = async (solverW, o, c) => {
      const s = await solver.odczytLekki(renderer);
      let zywe = 0, Px = 0, Py = 0, Pz = 0, blisko = 0, nb = 0, daleko = 0, nd = 0;
      for (let i = 0; i < solverW.n; i++) {
        if (!s.aktywny[i]) continue;
        zywe++;
        const vx = s.vel[3 * i], vy = s.vel[3 * i + 1], vz = s.vel[3 * i + 2];
        Px += vx; Py += vy; Pz += vz;
        const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (c) {
          const d = Math.sqrt((s.pos[3 * i] - c[0]) ** 2 + (s.pos[3 * i + 1] - c[1]) ** 2 + (s.pos[3 * i + 2] - c[2]) ** 2);
          if (d < 160) { if (v > blisko) blisko = v; nb++; } else if (d > 500) { if (v > daleko) daleko = v; nd++; }
        }
      }
      return { zywe, P: Math.sqrt(Px * Px + Py * Py + Pz * Pz) / zywe, vBlisko: blisko, nBlisko: nb, vDaleko: daleko, nDaleko: nd };
    };
    {
      const plan = S4({ bezCiecia: true, J: 0, T: 4 });
      const w = zbuduj(plan.scena, PARAMETRY, { pamiecStatyki: pamiecStatykiP2 });
      solver.wczytaj(w);
      solver.ustawPlan(planGpu(plan));
      await wok.krok(30);
      const c = [190, 0, 650];
      wy.przed = await pomiar(w, null, c);
      // Pudło: promień obok wieży. Nic się nie zmienia, slot zgaszony.
      solver.strzel({ o: [1000, 2000, 650], dir: [-1, 0, 0], r: 60, J: 300, tau: 0.3, rP: 160 });
      await wok.krok(2);
      wy.pudlo = await pomiar(w, null, c);
      solver.strzel({ o: [1000, 0, 650], dir: [-1, 0, 0], r: 60, J: 300, tau: 0.3, rP: 160 });
      await wok.krok(1);
      wy.klatka1 = await pomiar(w, null, c);
      await wok.krok(30);
      wy.klatka31 = await pomiar(w, null, c);
      await wok.krok(240);
      wy.koniec = await pomiar(w, null, c);
      const a = analizaPolowek({ n: w.n, ...await solver.odczytLekki(renderer), nbr: w.nbr, iN0: w.iN0, zerwanych: 0 }, plan.scena.pos, -1e9, 0);
      wy.kawalek = a.gora.ulamek;
      wy.vKawalka = a.gora.v;
      wy.obrotKawalka = a.gora.w;
    }
    {
      // Strzał w czasie planu pchnięć: ten sam S4 z pchnięciami planu i bez strzału daje mniejszą prędkość przy miejscu trafienia. Ta sama klatka, po kolei.
      const c = [190, 0, 1100];
      const bieg = async (zeStrzalem) => {
        const plan = S4({ T: 4 });
        const w = wypiekPelny('S4').w;
        solver.wczytaj(w);
        solver.ustawPlan(planGpu(plan));
        await wok.krok(150);
        if (zeStrzalem) solver.strzel({ o: [1000, 0, 1100], dir: [-1, 0, 0], r: 60, J: 300, tau: 0.3, rP: 160 });
        await wok.krok(6);
        return { ...(await pomiar(w, null, c)), fK: solver.fKlatka };
      };
      wy.planBez = await bieg(false);
      wy.planZeStrzalem = await bieg(true);
    }
    wy.bledyGpu = wok.bledy().length;
    return wy;
  }

  /** kI: limit vMax 4000 (§ 1.6: w krótkich biegach nie działa, więc osobno) i zapis pozycji. Stany: kotwica stoi, martwy się nie rusza, kopia stanu w [i]. */
  async function vmax(nazwa = 'S1_t3.50') {
    const m = await wczytajMigawke(nazwa);
    const w = wypiekSceny(m.scena);
    solver.wczytaj(w);
    const st = stanMigawki(m);
    const kopia = { ...st, vel: st.vel.slice(), acc: st.acc.slice(), pos: st.pos.slice() };
    let wolny = -1, kotwica = -1, martwy = -1;
    for (let i = 0; i < w.n; i++) {
      if (m.przed.aktywny[i] && !m.przed.nieruchomy[i] && wolny < 0) wolny = i;
      if (m.przed.nieruchomy[i] && kotwica < 0) kotwica = i;
      if (!m.przed.aktywny[i] && martwy < 0) martwy = i;
    }
    kopia.vel[3 * wolny] = 3000; kopia.vel[3 * wolny + 1] = 4000; kopia.vel[3 * wolny + 2] = 0; // |v| = 5000
    kopia.acc[3 * wolny] = 0; kopia.acc[3 * wolny + 1] = 0; kopia.acc[3 * wolny + 2] = 0;
    if (kotwica >= 0) { kopia.vel[3 * kotwica] = 100; kopia.acc[3 * kotwica] = 1000; }
    solver.wgraj(kopia);
    solver.calkuj(renderer);
    const o = await solver.odczyt(renderer);
    const vx = o.vel[3 * wolny], vy = o.vel[3 * wolny + 1], vz = o.vel[3 * wolny + 2];
    const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const dx = o.poz[3 * wolny] - kopia.pos[3 * wolny];
    return {
      wolny, vPo: v, vxPo: vx, vyPo: vy, dxPo: dx, dxOczekiwane: 2400 * w.h,
      kotwicaStoi: kotwica < 0 ? null : o.poz[3 * kotwica] === kopia.pos[3 * kotwica] && o.vel[3 * kotwica] === 100,
      martwyStoi: martwy < 0 ? null : o.poz[3 * martwy] === kopia.pos[3 * martwy],
      zaliczony: Math.abs(v - 4000) < 0.01 && Math.abs(dx - 2400 * w.h) < 0.05,
    };
  }

  /** W1 (§ 8): sekund stania na GPU, bez czekania na czas rzeczywisty. Próg: przemieszczenie przy końcu ≤ 0,5 j., 0 zerwań, 0 NaN. */
  async function w1(sekund = 60, co = 10) {
    const w = wypiekSceny('W1');
    solver.wczytaj(w);
    const pos0 = w.pos, n = w.n;
    let bity0 = 0;
    for (let i = 0; i < n; i++) bity0 += popcnt(w.maska[i]);
    const probki = [];
    const tP = performance.now();
    for (let s = co; s <= sekund; s += co) {
      await wok.krok(60 * co);
      const o = await solver.odczyt(renderer);
      let mx = 0, vm = 0, bity = 0, zmask = 0;
      for (let i = 0; i < n; i++) {
        const a = o.poz[3 * i] - pos0[3 * i], b = o.poz[3 * i + 1] - pos0[3 * i + 1], c = o.poz[3 * i + 2] - pos0[3 * i + 2];
        const q = a * a + b * b + c * c;
        if (q > mx) mx = q;
        const v2 = o.vel[3 * i] ** 2 + o.vel[3 * i + 1] ** 2 + o.vel[3 * i + 2] ** 2;
        if (v2 > vm) vm = v2;
        bity += popcnt(o.maskaW[i]);
        if (o.maskaW[i] !== w.maska[i]) zmask++;
      }
      probki.push({
        t: s, maxPrzem: Math.sqrt(mx), vMax: Math.sqrt(vm), zerwaneBity: bity0 - bity, wezlyZInnaMaska: zmask, asymetrie: asymetrieMasek(w, o.maskaW),
        nan: liczNaN(o.poz) + liczNaN(o.vel) + liczNaN(o.acc) + liczNaN(o.szkoda) + liczNaN(o.A) + liczNaN(o.L) + liczNaN(o.D) + liczNaN(o.F0),
        maxD: o.D.reduce((p, q) => (q > p ? q : p), 0), maxS: o.szkoda.reduce((p, q) => (q > p ? q : p), 0),
      });
    }
    const k = probki.at(-1);
    return { sekund, msSciany: performance.now() - tP, n, bity0, probki, zaliczony: k.maxPrzem <= 0.5 && k.zerwaneBity === 0 && k.nan === 0 && k.asymetrie === 0 };
  }

  /**
   * Punkt G1: ms na krok na stanie sceny. Wejście: id sceny albo nazwa migawki („po wgraniu migawki”, w trakcie walenia). Kroki idą dalej bez zdarzeń (P1 ich nie ma).
   * Bez ?profil=1: czas całej listy kroku (fizyka). W ?profil=1: kF, kI, kWstaw, kLista, kZerujPo osobno, tylko do proporcji (§ 8, pkt 4).
   */
  async function g1({ scena = null, migawka = null, rozbieg = 4, krokow = 60 }) {
    let w;
    if (migawka) {
      const m = await wczytajMigawke(migawka);
      w = wypiekSceny(m.scena);
      sprawdzBudowe(m.budowa, w);
      solver.wczytaj(w);
      solver.wgraj(stanMigawki(m));
    } else {
      w = wypiekSceny(scena);
      solver.wczytaj(w);
    }
    await wok.krok(rozbieg);
    wok.wyczyscCzasy();
    await wok.krok(krokow, { mierz: true });
    const t = wok.czasy();
    const o = await solver.odczyt(renderer);
    let bity = 0, kontakty = 0, zywe = 0;
    for (let i = 0; i < w.n; i++) { bity += popcnt(o.maskaW[i]); kontakty += o.lLicz[i]; zywe += o.aktywny[i]; }
    const wy = { scena: scena ?? migawka, n: w.n, zywe, wiazanBity: bity, kontakty, krokow };
    const stat = (x) => {
      if (!x.length) return null;
      const a = x.slice().sort((p, q) => p - q);
      return { sr: a.reduce((s, v) => s + v, 0) / a.length, p50: a[a.length >> 1], maks: a.at(-1), min: a[0], ile: a.length };
    };
    for (const k of Object.keys(t)) { const s = stat(t[k]); if (s) wy[k] = s; }
    if (!wok.profil) {
      // Sama lista na stanie po przebiegu. Odświeża listę kontaktów poza rytmem, więc mierzona po wszystkich krokach.
      const czasyL = [];
      for (let k = 0; k < 20; k++) czasyL.push(await wok.listaMierzona());
      wy.listaSama = stat(czasyL);
    }
    return wy;
  }

  /** § 8, pkt 8: dwie listy o znanym stosunku pracy dają dwa niezerowe czasy. Bez łaty uid zostałaby jedna. */
  async function dwieListy() {
    const w = wypiekSceny('S1');
    solver.wczytaj(w);
    const { kF } = solver.kernele;
    const l1 = [kF], l4 = [kF, kF, kF, kF];
    const a = [], b = [];
    for (let k = 0; k < 12; k++) { a.push(await wok.zmierzListe(l1)); b.push(await wok.zmierzListe(l4)); }
    const med = (x) => x.slice().sort((p, q) => p - q)[x.length >> 1];
    const m1 = med(a), m4 = med(b);
    // § 8 wymaga dwóch niezerowych czasów. Stosunek poniżej 4, bo pass ma własny narzut (zm. około 15 µs): dolna granica pilnuje tylko, że to nie ten sam odczyt dwa razy.
    return { kF1: m1, kF4: m4, stosunek: m4 / m1, zaliczony: m1 > 0 && m4 > 0 && m4 / m1 > 1.5 };
  }

  return { podkrok, mutacje, zrodla, krokZWzorcem, vmax, w1, g1, dwieListy, scenaPelna, sciana, rownowaznosc, strzal, MUTACJE: Object.keys(MUTACJE) };
}
