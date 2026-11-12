// Krótkie biegi wzorca CPU do tests/wokseleBudowa.test.mjs: stan po biegu (skróty SHA-256), kCzysc przez przebiegi i migawka.
// Każdy bieg liczy się w wątku roboczym, najwyżej 3 naraz, żeby test został w kilkunastu sekundach. Koniec wątku wynika z liczby biegów, nie z zegara.
// BIEGI to dane: `.tmp/woksele-demo/skroty-biegi-spec4.mjs` czyta z nich te same okna i liczy skróty w proby4/model-spec4.mjs, a nie w porcie.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { S1, S2, S3, S4 } from '../../src/3d/woksele/scena.js';
import { zbuduj, popcnt, parametry } from '../../src/3d/woksele/budowa.js';
import { WzorzecCpu, pakujMigawke, rozpakujMigawke } from '../../dema/woksele-zawalenia/wzorzec-cpu.js';
import { porownajPodkrok } from '../../dema/woksele-zawalenia/metryki.js';

// Skróty wzorca policzył model-spec4 przy S = 16, a demo ma S = 24 (§ 2.7): liczba slotów komórki przechodzi do wzorca jawnie, reszta parametrów bez zmian.
const PARAMETRY_SPEC4 = parametry({ slotyKomorki: 16 });

const ZR_OBROT = Object.freeze({ obrot: { p: [0, 0, -3000], os: [1, 0.2, 0], om: 0.3 } });
const ZR_PUNKT = Object.freeze({ punkt: { c: [300, 0, -6000], g: 300, r0: 2000 } });

/**
 * Stan początkowy to świeża budowa, a pierwsza klatka to `od`: bez dwóch sekund spokoju przed zdarzeniami.
 * czysc: tyle pierwszych klatek idzie równolegle przez przebiegi kCzas + kCzysc. odkotwicz: argument odkotwicz() przed pierwszym krokiem.
 * Kolejność to kolejka wątków: trzy pierwsze liczą statykę (S3 swoją, wieża w dwóch), reszta korzysta już z pamięci wątku.
 */
export const BIEGI = Object.freeze({
  S3: { scena: 'S3', opcje: {}, od: 0, klatki: 60 },
  S1: { scena: 'S1', opcje: {}, od: 120, klatki: 60 },
  S4: { scena: 'S4', opcje: {}, od: 120, klatki: 60, czysc: 24 },
  S2: { scena: 'S2', opcje: {}, od: 120, klatki: 40, czysc: 24 },
  S4obrot: { scena: 'S4', opcje: { zrodlo: ZR_OBROT, gRef: 300 }, od: 120, klatki: 12 },
  S4punkt: { scena: 'S4', opcje: { zrodlo: ZR_PUNKT, gRef: 300 }, od: 120, klatki: 12 },
  S4rampa: { scena: 'S4', opcje: { g: 400, grunt: true, kotwice: true, skalaG: [1, 3, 1, 0.1] }, od: 120, klatki: 12 },
  S4grunt: { scena: 'S4', opcje: { g: 400, grunt: true }, od: 120, klatki: 12 },
  S1odkotwicz: { scena: 'S1', opcje: {}, od: 120, klatki: 12, odkotwicz: true },
  S1odkotwiczBezGruntu: { scena: 'S1', opcje: {}, od: 120, klatki: 12, odkotwicz: false },
});

/** Pola stanu w skrócie i liczniki: te same nazwy w WzorzecCpu i w ModelSpec. */
export const POLA_STANU = Object.freeze(['pos', 'vel', 'acc', 'maskaW', 'szkoda', 'A', 'etyk', 'aktywny', 'nieruchomy', 'L', 'D', 'F0']);
export const LICZNIKI = Object.freeze(['zerwanych', 'zerwanychZginaniem', 'plast', 'przepelnienia', 'maxKontaktow', 'maxKomorka', 'przepelnieniaKomorek', 'kontaktowOst', 'nPrzebudow', 'kroki']);

const bajty = (t) => Buffer.from(t.buffer, t.byteOffset, t.byteLength);
export const skrot = (t) => createHash('sha256').update(bajty(t)).digest('hex').slice(0, 24);

export function skrotyStanu(m) {
  const pola = {};
  for (const k of POLA_STANU) pola[k] = skrot(m[k]);
  const liczniki = {};
  for (const k of LICZNIKI) liczniki[k] = m[k];
  return { liczniki, pola };
}

/** Skróty wypieku: 29 tablic i liczby sceny. Porównanie ze stałymi z model-spec4 robi test. */
function skrotyBudowy(w) {
  const pola = {
    pos: w.pos, kind: w.kind, ijk: w.ijk, grupa: w.grupa, vel0: w.vel0 ?? new Float32Array(3 * w.n), nbr: w.nbr, R0: w.R0, L: w.L, F0: w.F0, f0: w.f0,
    Ft: w.Ft, Fc: w.Fc, iT: w.iT, iC: w.iC, klasaW: w.klasaW, maska: w.maska, iN0: w.iN0, aLos: w.aLos, rozlewW: w.rozlewW, szokW: w.szokW, kUd: w.kUd,
    bMax2W: w.bMax2W, rk: w.rk, etyk: w.etyk, bezG: w.bezG, nieruchomy: w.nieruchomy, ziarnoW: w.ziarnoW, flagi: w.flagi, kruszTab: w.kruszTab,
  };
  const skroty = {};
  for (const k of Object.keys(pola)) skroty[k] = skrot(pola[k]);
  const liczby = { iter: w.info.grupy.wieza.iter, maxF0: w.info.grupy.wieza.maxF0 };
  for (const k of ['n', 'capEtyk', 'K', 'h', 'cB', 'kB', 'kC', 'cC', 'cT', 'sFr', 'sM', 'rama', 'zasieg', 'iKom', 'nKom']) liczby[k] = w[k];
  return { liczby, pola: skroty };
}

// Zdarzenia przez przebiegi jak na GPU (§ 2.8): kCzas oznacza S = 2 / 3 i martwe, kCzysc czyści własne bity, kCzyscS sprowadza S do 1.
class PrzezPrzebieg extends WzorzecCpu {
  usun(l) { this.oznaczUsun(l); this.czeka = true; }
  rozerwij(l, z) { this.oznaczRozerwij(l, z); this.czeka = true; }
  krok() {
    if (this.czeka) { this.czeka = false; this.przebiegCzysc(); }
    super.krok();
  }
}

/** Pierwsza różnica stanu po klatce albo null. Szkoda tylko na żywych: martwe S przez kCzysc zostają przy znaczniku. */
function roznicaCzysc(a, b, f) {
  for (const k of ['pos', 'vel', 'maskaW', 'L', 'D', 'F0', 'aktywny']) if (!bajty(a[k]).equals(bajty(b[k]))) return `klatka ${f}: pole ${k}`;
  for (let i = 0; i < a.n; i++) {
    if (a.aktywny[i] && a.szkoda[i] !== b.szkoda[i]) return `klatka ${f}: S węzła ${i}: ${a.szkoda[i]} kontra ${b.szkoda[i]}`;
  }
  return null;
}

/**
 * Migawka kontra dalszy bieg prawdziwego modelu: klon po wgraj + kLista + kF ma dać to samo, co ten sam przebieg na oryginale.
 * Bajtowo pola, które przebieg pisze i dla martwych; A i etykieta tylko na żywych, bo martwy węzeł zostaje przy wartości z bufora, który akurat jest z przodu.
 */
function sprawdzMigawke(m, w, nazwa, f) {
  // Czytane z modelu, nie z migawki: brak pola na liście ma wyjść jako różnica wyników, a nie jako błąd odczytu.
  const aktywny = m.aktywny.slice(), nieruchomy = m.nieruchomy.slice();
  // Czy ta migawka w ogóle coś niesie: bez fali, plastyczności i wypieku porównanie klonu niczego by nie mówiło.
  let aDodatnie = 0, lRozne = 0, f0Rozne = 0;
  for (let i = 0; i < w.n; i++) if (aktywny[i] && m.A[i] > 0) aDodatnie++;
  for (let q = 0; q < m.L.length; q++) {
    if (m.L[q] !== w.L[q]) lRozne++;
    if (m.F0[q] !== w.F0[q]) f0Rozne++;
  }
  const przed = m.migawka();
  const klon = new WzorzecCpu(w, m.par);
  klon.wgraj(przed);
  klon.podkrokPorownania();
  const poKlon = klon.stanPoPodkroku();
  m.podkrokPorownania();
  const poOryg = m.stanPoPodkroku();
  const rozne = [];
  for (const k of ['maskaW', 'szkoda', 'L', 'D', 'F0', 'acc', 'lLicz']) if (!bajty(poKlon[k]).equals(bajty(poOryg[k]))) rozne.push(k);
  let rozneA = 0, rozneEtyk = 0, rozneLista = 0;
  for (let i = 0; i < w.n; i++) {
    if (aktywny[i] && poKlon.A[i] !== poOryg.A[i]) rozneA++;
    if (aktywny[i] && poKlon.etyk[i] !== poOryg.etyk[i]) rozneEtyk++;
    for (let c = 0; c < poOryg.lLicz[i]; c++) if (poKlon.lista[i * w.M + c] !== poOryg.lista[i * w.M + c]) rozneLista++;
  }
  if (rozneA) rozne.push(`A w ${rozneA} węzłach`);
  if (rozneEtyk) rozne.push(`etyk w ${rozneEtyk} węzłach`);
  if (rozneLista) rozne.push(`lista w ${rozneLista} wpisach`);
  // To samo przez plik: pakowanie, nagłówek po JSON, odczyt.
  const { naglowek, bajty: plik } = pakujMigawke({ scena: nazwa, f, skG: przed.skG, sFr: przed.sFr, kotwiceWiezy: przed.kotwiceWiezy, budowa: przed.budowa }, { przed, po: poOryg });
  const wcz = rozpakujMigawke(JSON.parse(JSON.stringify(naglowek)), plik.buffer);
  const zPliku = new WzorzecCpu(w, m.par);
  zPliku.wgraj({ ...wcz.przed, skG: wcz.skG, sFr: wcz.sFr, kotwiceWiezy: wcz.kotwiceWiezy, budowa: wcz.budowa });
  zPliku.podkrokPorownania();
  const plikR = porownajPodkrok(wcz.po, zPliku.stanPoPodkroku(), aktywny, nieruchomy, { prog: 0, progA: 0, liczEtyk: w.capEtyk > 0 });
  return { rozne, plik: plikR.zaliczony, aDodatnie, lRozne, f0Rozne };
}

const SCENY = { S1, S2, S3, S4 };
const pamiecStatyki = new Map();

function liczBieg(nazwa) {
  const d = BIEGI[nazwa];
  const plan = SCENY[d.scena](d.opcje);
  const w = zbuduj(plan.scena, PARAMETRY_SPEC4, { pamiecStatyki });
  const a = new WzorzecCpu(w);
  const budowa = skrotyBudowy(w);
  const b = d.czysc ? new PrzezPrzebieg(w) : null;
  let czysc = null;
  for (let q = 0; q < d.klatki; q++) {
    const f = d.od + q;
    plan.zdarzenia(f, a);
    if (q === 0 && d.odkotwicz !== undefined) a.odkotwicz(d.odkotwicz);
    a.krok();
    if (b && q < d.czysc) {
      plan.zdarzenia(f, b);
      b.krok();
      if (!czysc?.rozne) czysc = { rozne: roznicaCzysc(a, b, f) };
      if (q === d.czysc - 1) {
        let rozerwane = 0, martwe = 0;
        for (let i = 0; i < a.n; i++) {
          if (popcnt(a.maskaW[i]) !== popcnt(w.maska[i])) rozerwane++;
          if (!a.aktywny[i]) martwe++;
        }
        Object.assign(czysc, { zerwanych: a.zerwanych, zerwanychPrzebiegi: b.zerwanych, rozerwane, martwe });
      }
    }
  }
  return { budowa, ...skrotyStanu(a), czysc, migawka: sprawdzMigawke(a, w, nazwa, d.od + d.klatki) };
}

if (!isMainThread) {
  parentPort.on('message', (nazwa) => {
    if (nazwa === null) { parentPort.close(); return; }
    parentPort.postMessage({ nazwa, wynik: liczBieg(nazwa) });
  });
}

/** Rusza wszystkie BIEGI w `ile` wątkach od razu; zwraca funkcję nazwa → obietnica wyniku. Błąd wątku odrzuca to, co na nim czekało. */
export function uruchomBiegi(ile = 3) {
  const obietnice = new Map();
  for (const nazwa of Object.keys(BIEGI)) {
    let ok, zle;
    const p = new Promise((a, b) => { ok = a; zle = b; });
    p.catch(() => {}); // odrzucenie odczytuje test, który na nie czeka
    obietnice.set(nazwa, { p, ok, zle });
  }
  const kolej = [...obietnice.keys()];
  for (let q = 0; q < ile; q++) {
    const wk = new Worker(new URL(import.meta.url));
    let wToku = null;
    const dalej = () => {
      wToku = kolej.shift() ?? null;
      wk.postMessage(wToku);
    };
    wk.on('message', ({ nazwa, wynik }) => {
      obietnice.get(nazwa).ok(wynik);
      dalej();
    });
    const pad = (e) => {
      const blad = e instanceof Error ? e : new Error(`wątek biegu ${wToku} zakończył się kodem ${e}`);
      if (wToku) obietnice.get(wToku).zle(blad);
      for (const nazwa of kolej.splice(0)) obietnice.get(nazwa).zle(blad);
    };
    wk.on('error', pad);
    wk.on('exit', (kod) => { if (kod !== 0) pad(kod); });
    dalej();
  }
  return (nazwa) => obietnice.get(nazwa).p;
}
