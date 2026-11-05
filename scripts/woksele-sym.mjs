// Fizyka dema wiązanych wokseli w Node (docs/SPEC-woksele-zawalenia.md § 8, § 12 P0): wzorzec CPU na tych samych budowach i metrykach co solver GPU.
// Wyniki i migawki tylko do .tmp/woksele-demo/migawki/.
//
//   node scripts/woksele-sym.mjs                      wszystkie sceny i próby § 8, najwyżej 3 procesy naraz, na końcu tabela
//   node scripts/woksele-sym.mjs --zadania S1,S4      wybrane zadania (S1 S2 S3 S3poza S3osm S3z21 S3R7 S3pozaR7 S3osmR7 S4 S4g S4sw W1 kolumna1 naroznik odpornosc rampa krater60)
//   node scripts/woksele-sym.mjs --zadanie S1         jedno zadanie w tym procesie
//   node scripts/woksele-sym.mjs --tabela             tabela § 8 z zapisanych metryk (tabela-8.txt)
//   node scripts/woksele-sym.mjs --zgodnosc           porównanie z logami prototypu z .tmp/woksele-proto (zgodnosc-P0.txt)
//   node scripts/woksele-sym.mjs --mapa proznia --r 60 --J 300 --rP 160 [--od 0 --do 32] [--procesy 3]   mapa kraterów § 1.2
//   node scripts/woksele-sym.mjs --koszt-pylu S2      wypełnienie pyłem przy regule kontaktowej § 4.6, 5120 × 1440, kamery § 4.7
//
// Migawka (§ 8): <scena>_t<chwila>.json (nagłówek) + .bin; wczytanie: rozpakujMigawke z dema/woksele-zawalenia/wzorzec-cpu.js.
// „przed” to stan przed zdarzeniami klatki, „po” to wynik jednego przebiegu kLista + kF z tego stanu, bez całkowania.
import os from 'node:os';
os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { S1, S2, S3, S4, kolumna1, naroznik, stanie, odpornosc, krater, czyGrunt, MIEJSCA_KRATEROW } from '../dema/woksele-zawalenia/scena.js';
import { zbuduj, parametry, PARAMETRY } from '../dema/woksele-zawalenia/budowa.js';
import { WzorzecCpu, pakujMigawke, rozpakujMigawke } from '../dema/woksele-zawalenia/wzorzec-cpu.js';
import { ObserwatorSceny, analizaPolowek, pietraStropow, taca, porownajPodkrok, zastapLiczby } from '../dema/woksele-zawalenia/metryki.js';

const TU = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(TU, '..');
const WY = path.join(REPO, '.tmp', 'woksele-demo');
const MIG = path.join(WY, 'migawki');
const PROTO = path.join(REPO, '.tmp', 'woksele-proto');
fs.mkdirSync(MIG, { recursive: true });

const pamiecStatyki = new Map();
const bud = (plan, par = PARAMETRY) => zbuduj(plan.scena, par, { pamiecStatyki });
const MIEJSCA_60 = [[190, 0, 300], [190, 0, 650], [-190, 0, 650], [190, 210, 150], [0, -210, 1000], [-190, -210, 300]];

const ZADANIA = {
  S1: { rodzaj: 'proba', plan: () => S1(), et: 'R7', naz: 'S1', migawki: [3.5, 5], taca: [3.5, 4, 4.5, 5, 5.5, 6, 7] },
  S2: { rodzaj: 'proba', plan: () => S2(), et: 'R7', naz: 'S2f', migawki: [3], taca: [4.5, 5] },
  // Demo: gProj = 400 (§ 10.3, kadry fin11). Wiersze S3 w proby4/log-R7.txt policzono przy gProj = g = 260 i nKom = 131 072: zadania *R7, tylko do zgodności (§ 1.2).
  S3: { rodzaj: 'proba', plan: () => S3(), et: 'P0', naz: 'S3rot30', migawki: [0.8] },
  S3poza: { rodzaj: 'proba', plan: () => S3({ wariant: 'poza' }), et: 'P0', naz: 'S3poza' },
  S3osm: { rodzaj: 'proba', plan: () => S3({ wariant: 'osm' }), et: 'P0', naz: 'S3osm' },
  S3z21: { rodzaj: 'proba', plan: () => S3(), par: parametry({ ziarno: 21 }), et: 'P0z21', naz: 'S3rot30' },
  S3R7: { rodzaj: 'proba', plan: () => S3({ gProj: null }), par: parametry({ nKom: 131072 }), et: 'R7', naz: 'S3rot30' },
  S3pozaR7: { rodzaj: 'proba', plan: () => S3({ wariant: 'poza', gProj: null }), par: parametry({ nKom: 131072 }), et: 'R7', naz: 'S3poza' },
  S3osmR7: { rodzaj: 'proba', plan: () => S3({ wariant: 'osm', gProj: null }), par: parametry({ nKom: 131072 }), et: 'R7', naz: 'S3osm' },
  W1: { rodzaj: 'proba', plan: () => stanie(), et: 'Rst', naz: 'stoj60' },
  kolumna1: { rodzaj: 'proba', plan: () => kolumna1(), et: 'Qo', naz: 'kolumna1' },
  naroznik: { rodzaj: 'proba', plan: () => naroznik(), et: 'Qo', naz: 'naroznik' },
  odpornosc: { rodzaj: 'proba', plan: () => odpornosc(), et: 'Qo', naz: 'odpornosc' },
  S4: { rodzaj: 'g', plan: () => S4(), et: 'G4Z5', migawki: [3], zrzut: [6], czysc: true },
  S4g: { rodzaj: 'g', plan: () => S4({ g: 400, grunt: true, kotwice: true, T: 9 }), et: 'G4g' },
  S4sw: { rodzaj: 'g', plan: () => S4({ g: 400, T: 6 }), et: 'G4sw', zrzut: [6] },
  rampa: { rodzaj: 'g', plan: () => S4({ g: 400, grunt: true, kotwice: true, bezCiecia: true, J: 0, skalaG: [1, 2, 1, 0], T: 6 }), et: 'R1' },
  krater60: { rodzaj: 'kratery', et: 'K60', r: 60, J: 300, rP: 160, miejsca: MIEJSCA_60 },
};

const zapiszJson = (plik, o) => fs.writeFileSync(plik, JSON.stringify(o, zastapLiczby, 1));

// Mutacje z § 8: każda gałąź musi być widoczna w teście jednego podkroku (R19). Klon ze zmienionym parametrem albo tablicą.
const MUTACJE = {
  'bez fali (A nie rośnie)': (w, par) => new WzorzecCpu(w, { ...par, fala: { ...par.fala, tempo: 0 } }),
  'bez falaPeka (fala nie łamie granic)': (w, par) => new WzorzecCpu(w, { ...par, falaPeka: { prog: 1e30, zakres: 0 } }),
  'bez zakleszczenia pary': (w, par) => new WzorzecCpu(w, { ...par, gruzPara: 0 }),
  'bez lepkości': (w, par) => new WzorzecCpu(w, { ...par, lepL: 0 }),
  'zginanie bez plastyczności (zlomB 0)': (w, par) => new WzorzecCpu(w, { ...par, zlomB: 0 }),
  'wypiek po 90° zamiast 12°': (w, par) => { const m = new WzorzecCpu(w, par); m.cosWypieku = 0; return m; },
  'bez szkody od kontaktu': (w, par) => { const m = new WzorzecCpu(w, par); m.kUd = new Float32Array(w.n); return m; },
  'bez szoku': (w, par) => { const m = new WzorzecCpu(w, par); m.szokW = new Float32Array(w.n); return m; },
  'bez rozlewu': (w, par) => { const m = new WzorzecCpu(w, par); m.rozlewW = new Float32Array(w.n); return m; },
  'bez kruszenia': (w, par) => { const m = new WzorzecCpu(w, par); m.kruszTab = new Float32Array(12); return m; },
};

function zapiszMigawke(id, t, f, m, wypiek) {
  const przed = m.migawka();
  const jeden = (klon) => {
    klon.wgraj(przed);
    klon.podkrokPorownania();
    return klon.stanPoPodkroku();
  };
  const po = jeden(new WzorzecCpu(wypiek, m.par));
  const nazwa = `${id}_t${t.toFixed(2)}`;
  const meta = {
    scena: id, t, f, n: m.n, ziarno: m.par.ziarno,
    skG: przed.skG, sFr: przed.sFr, kotwiceWiezy: przed.kotwiceWiezy,
    opis: 'przed: stan przed zdarzeniami klatki f; po: jeden przebieg kLista + kF z tego stanu (bez całkowania)',
  };
  const { naglowek, bajty } = pakujMigawke(meta, { przed, po });
  fs.writeFileSync(path.join(MIG, `${nazwa}.bin`), bajty);
  // Kontrola pliku: wczytanie, ten sam podkrok, ma wyjść bit w bit.
  const buf = fs.readFileSync(path.join(MIG, `${nazwa}.bin`));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const wczyt = rozpakujMigawke(JSON.parse(JSON.stringify(naglowek)), ab);
  const klon = new WzorzecCpu(wypiek, m.par);
  klon.wgraj({ ...wczyt.przed, skG: wczyt.skG, sFr: wczyt.sFr, kotwiceWiezy: wczyt.kotwiceWiezy });
  klon.podkrokPorownania();
  const wynik = klon.stanPoPodkroku();
  const sprawdz = porownajPodkrok(wczyt.po, wynik, przed.aktywny, przed.nieruchomy, { prog: 0, progA: 0 });
  let rozneBity = 0;
  for (const k of ['maskaW', 'szkoda', 'A', 'etyk', 'L', 'D', 'F0', 'acc', 'lLicz', 'lista']) if (Buffer.compare(Buffer.from(wczyt.po[k].buffer, wczyt.po[k].byteOffset, wczyt.po[k].byteLength), Buffer.from(wynik[k].buffer, wynik[k].byteOffset, wynik[k].byteLength)) !== 0) rozneBity++;
  naglowek.kontrolaPliku = { poleRozne: rozneBity, ...sprawdz };
  // Mutacje: co test jednego podkroku widzi przy tej migawce.
  naglowek.mutacje = {};
  for (const [opis, fab] of Object.entries(MUTACJE)) {
    naglowek.mutacje[opis] = porownajPodkrok(po, jeden(fab(wypiek, m.par)), przed.aktywny, przed.nieruchomy);
  }
  fs.writeFileSync(path.join(MIG, `${nazwa}.json`), JSON.stringify(naglowek, null, 1));
  return nazwa;
}

function zapiszZrzut(id, t, m) {
  fs.writeFileSync(path.join(MIG, `zrzut-${id}-t${t}.bin`), Buffer.from(m.pos.buffer, m.pos.byteOffset, m.pos.byteLength));
}

function przebiegProby(id, z) {
  const plan = z.plan();
  const t0 = Date.now();
  const wypiek = bud(plan, z.par);
  const m = new WzorzecCpu(wypiek);
  const ob = new ObserwatorSceny(plan);
  const msInit = Date.now() - t0;
  const pp = z.taca ? pietraStropow(plan.scena) : null;
  const naChwile = (lista) => new Map((lista ?? []).map((t) => [Math.round(t * 60), t]));
  const mapaMig = naChwile(z.migawki), mapaTaca = naChwile(z.taca);
  const tace = {};
  const tF = Date.now();
  for (let f = 0; f <= ob.N; f++) {
    ob.klatka(f, m);
    if (mapaMig.has(f)) zapiszMigawke(id, mapaMig.get(f), f, m, wypiek);
    if (mapaTaca.has(f)) tace[mapaTaca.get(f)] = taca(m, pp);
    if (f === ob.N) break;
    ob.dodajUsuniete(plan.zdarzenia(f, m));
    m.krok();
  }
  const msKl = (Date.now() - tF) / Math.max(1, ob.N);
  const p = ob.koniec(m);
  const k = p.koniec;
  const w = ob.dziennik();
  const rz = w.filter((e) => e.t >= 2 && Math.abs(e.t - Math.round(e.t)) < 0.01).map((e) => `${e.t.toFixed(0)}:${e.wieza.dach.toFixed(0)}/${e.wieza.przechyl.sztywnyStopnie.toFixed(1)}`).join(' ');
  const vm = w.filter((e) => e.t >= 2 && Math.abs(e.t / 2 - Math.round(e.t / 2)) < 0.01 && e.model).map((e) => `${e.t.toFixed(0)}:${e.model.vmax}`).join(' ');
  let l = `${z.et} ${z.naz} n=${p.n} ms/kl ${msKl.toFixed(0)} W1 ${p.W1?.maxPrzem?.toFixed(3)} spojny ${p.historia?.maxPrzechylSpojny?.toFixed(1)}@${p.historia?.tMaxPrzechylSpojny} | ${rz} | masa ${JSON.stringify(k.wieza.wyspy.masa)}`;
  if (k.dysk) l += ` | S3 v ${p.S3?.stosunekV?.toFixed?.(2)} otwor ${k.dysk.otworDoPrzekroju?.toFixed?.(2)} rusz ${k.dysk.udzialRuszonych?.toFixed?.(3)} dyskmasa ${JSON.stringify(k.dysk.wyspy?.masa)}`;
  if (z.naz.startsWith('kolumna') || z.naz === 'stoj60') l += ` | vmax ${vm}`;
  const sym = m.sprawdzSymetrie();
  l += ` sym ${JSON.stringify(sym)} zerw ${m.zerwanych} prz ${m.przepelnienia}`;
  console.log(l);
  const dach = {};
  const przechylT = {};
  for (const e of w) { dach[e.t] = e.wieza.dach; przechylT[e.t] = e.wieza.przechyl.sztywnyStopnie; }
  zapiszJson(path.join(MIG, `metryki-${id}.json`), {
    id, linia: l, msInit, msNaKlatke: msKl, dach, przechylT, tace, podsumowanie: p, sym, zerwanych: m.zerwanych, plast: m.plast,
    przepelnienia: m.przepelnienia, przepelnieniaKomorek: m.przepelnieniaKomorek, maxKontaktow: m.maxKontaktow, maxKomorka: m.maxKomorka, nan: k.nan,
    sPonad: liczSPonad(m), vmax: vmaxWezla(m),
  });
  fs.writeFileSync(path.join(MIG, `linie-${id}.txt`), l + '\n');
}

function liczSPonad(m) {
  let c = 0;
  for (let i = 0; i < m.n; i++) if (m.aktywny[i] && m.szkoda[i] > 1.001) c++;
  return c;
}

function vmaxWezla(m) {
  let vm = 0;
  for (let i = 0; i < m.n; i++) {
    const q = m.vel[3 * i] ** 2 + m.vel[3 * i + 1] ** 2 + m.vel[3 * i + 2] ** 2;
    if (q > vm) vm = q;
  }
  return Math.sqrt(vm);
}

const fm = (x, d = 1) => (x === undefined || x === null ? 'b.d.' : Number.isFinite(x) ? x.toFixed(d) : String(x));
const wek = (a, d = 1) => '[' + a.map((q) => fm(q, d)).join(' ') + ']';

function przebiegG(id, z) {
  const plan = z.plan();
  const t0 = Date.now();
  const wypiek = bud(plan);
  const m = new WzorzecCpu(wypiek);
  const msInit = Date.now() - t0;
  const pos0 = plan.scena.pos.slice();
  const et = z.et;
  const linie = [];
  const naStronie = (t) => {
    const a = analizaPolowek(m, pos0, plan.zc, 120);
    const g = a.gora, d = a.dol;
    linie.push(`${et} t=${t.toFixed(2)} P ${wek(a.P, 0)} L ${wek(a.L, 0)} Ek ${fm(a.Ek / a.N, 0)} | gora v ${wek(g.v)} w ${fm(g.w)}°/s kat ${fm(g.kat)}° najw ${fm(g.ulamek * 100, 1)}% oderw-poza ${fm(g.ulOderwPoza * 100, 2)}% strat-poza ${fm(g.ulStratPoza * 100, 1)}% res ${fm(g.res)} | dol v ${wek(d.v)} w ${fm(d.w)}°/s kat ${fm(d.kat)}° najw ${fm(d.ulamek * 100, 1)}% oderw-poza ${fm(d.ulOderwPoza * 100, 2)}% strat-poza ${fm(d.ulStratPoza * 100, 1)}% res ${fm(d.res)} | kosze ${JSON.stringify(a.kosze)} zerw ${a.zerw}`);
    return a;
  };
  const o = plan.opcje;
  const N = Math.round(plan.T * 60);
  const mapaMig = new Map((z.migawki ?? []).map((t) => [Math.round(t * 60), t]));
  const mapaZrz = new Map((z.zrzut ?? []).map((t) => [Math.round(t * 60), t]));
  const chwile = {};
  let maxDryf = 0, ost = null;
  for (let f = 0; f <= N; f++) {
    const t = f / 60;
    if (t < plan.tS - 1e-9) {
      const P = m.pos;
      let q = 0;
      for (let i = 0; i < m.n; i++) {
        const dX = P[3 * i] - pos0[3 * i], dY = P[3 * i + 1] - pos0[3 * i + 1], dZ = P[3 * i + 2] - pos0[3 * i + 2] + (o.grunt || o.kotwice ? 0 : 0.5 * (o.g ?? 0) * t * t);
        const r = dX * dX + dY * dY + dZ * dZ;
        if (r > q) q = r;
      }
      if (q > maxDryf) maxDryf = q;
    }
    if (f % 30 === 0 && (t >= plan.tS - 0.01 || f === 0)) {
      ost = naStronie(t);
      chwile[t] = { P: ost.P, L: ost.L, N: ost.N, kosze: ost.kosze, gora: { v: ost.gora.v, w: ost.gora.w, kat: ost.gora.kat, ulamek: ost.gora.ulamek, ulOderwPoza: ost.gora.ulOderwPoza, lWlasny: ost.gora.lWlasny }, dol: { v: ost.dol.v, w: ost.dol.w, kat: ost.dol.kat, ulamek: ost.dol.ulamek, ulOderwPoza: ost.dol.ulOderwPoza, lWlasny: ost.dol.lWlasny } };
    }
    if (mapaMig.has(f)) zapiszMigawke(id, mapaMig.get(f), f, m, wypiek);
    if (mapaZrz.has(f)) zapiszZrzut(id, mapaZrz.get(f), m);
    if (f === N) break;
    plan.zdarzenia(f, m);
    m.krok();
  }
  const vm = vmaxWezla(m);
  linie.push(`${et} vmax koniec ${vm.toFixed(2)}`);
  const sym = m.sprawdzSymetrie();
  linie.push(`${et} KONIEC n=${m.n} init ${msInit} ms, dryf przed cięciem ${fm(Math.sqrt(maxDryf), 4)} j., maxF0 ${fm(m.info?.grupy?.wieza?.maxF0, 0)}, iter ${m.info?.grupy?.wieza?.iter}, gMod ${m.zr?.gMod}, gProj ${m.gProj}, rama ${m.rama}, cap ${m.capEtyk}, sym ${JSON.stringify(sym)}, prz ${m.przepelnienia}, maxKontaktow ${m.maxKontaktow}, maxKomorka ${m.maxKomorka}, przKom ${m.przepelnieniaKomorek}, ściana ${((Date.now() - t0) / 1000) | 0} s`);
  for (const l of linie) console.log(l);
  fs.writeFileSync(path.join(MIG, `linie-${id}.txt`), linie.join('\n') + '\n');
  let nan = 0;
  for (let i = 0; i < 3 * m.n; i++) if (m.pos[i] !== m.pos[i]) nan++;
  zapiszJson(path.join(MIG, `metryki-${id}.json`), {
    id, dryf: Math.sqrt(maxDryf), chwile, vmaxKoniec: vm, sym, zerwanych: m.zerwanych, plast: m.plast, nan,
    przepelnienia: m.przepelnienia, przepelnieniaKomorek: m.przepelnieniaKomorek, maxKontaktow: m.maxKontaktow, maxKomorka: m.maxKomorka, sPonad: liczSPonad(m),
  });
}

/** Jeden krater wg mapa5.mjs (§ 1.2). W próżni zamiast opadu: całość jako jeden kawałek, jego prędkość i obrót. */
function jedenKrater(et, o) {
  const plan = krater({ T: 10, ...o });
  const sc = plan.scena;
  const m = new WzorzecCpu(bud(plan));
  const pos0 = sc.pos.slice();
  const dach = () => {
    let s = 0, c = 0;
    for (let i = 0; i < m.n; i++) if (sc.ijk[3 * i + 2] >= sc.meta.nz - 2 && m.aktywny[i]) { s += m.pos[3 * i + 2]; c++; }
    return s / c;
  };
  let d0 = 0, kol = -1;
  const N = Math.round(plan.T * 60);
  for (let f = 0; f < N; f++) {
    plan.zdarzenia(f, m);
    if (f === 0) d0 = dach();
    m.krok();
    if (f % 30 === 29 && kol < 0 && dach() < d0 - 60) kol = (f + 1) / 60;
  }
  const [cx, cy, cz] = plan.c;
  const a = analizaPolowek(m, pos0, cz, 200);
  const P2 = Math.sqrt(a.P[0] ** 2 + a.P[1] ** 2 + a.P[2] ** 2);
  const podst = `${et} r=${o.r} J=${o.J} (${cx},${cy},${cz}) usun ${plan.usuniete} rozerw ${plan.rozerwane} zerw ${m.zerwanych} kosze ${JSON.stringify(a.kosze)} |P|/N ${(P2 / a.N).toFixed(3)}`;
  if (!o.proznia) return { linia: `${podst} -> ${kol < 0 ? 'STOI opad ' + (d0 - dach()).toFixed(1) : 'WALI SIE po ' + kol.toFixed(1) + ' s'}`, stoi: kol < 0, opad: d0 - dach() };
  // Próżnia: cała wieża jako „górna połowa” względem z = −∞.
  const c = analizaPolowek(m, pos0, -1e9, 0).gora;
  const v = Math.sqrt(c.v[0] ** 2 + c.v[1] ** 2 + c.v[2] ** 2);
  return {
    linia: `${podst} -> PROZNIA najw ${(c.ulamek * 100).toFixed(1)}% oderwane ${c.oderwPoza} v glownego ${v.toFixed(2)} j./s obrot ${c.w.toFixed(2)}°/s vmax ${vmaxWezla(m).toFixed(0)} L/N ${(Math.sqrt(a.L[0] ** 2 + a.L[1] ** 2 + a.L[2] ** 2) / a.N).toFixed(0)} strat ${(c.ulStratPoza * 100).toFixed(1)}%`,
    najw: c.ulamek, oderwane: c.oderwPoza, v, w: c.w, vmax: vmaxWezla(m), P: P2 / a.N, strat: c.ulStratPoza, zerw: m.zerwanych,
  };
}

function przebiegKratery(id, z) {
  const linie = [];
  const wyniki = [];
  for (const c of z.miejsca) {
    const w = jedenKrater(z.et, { c, r: z.r, J: z.J, rP: z.rP });
    console.log(w.linia);
    linie.push(w.linia);
    wyniki.push({ c, ...w });
  }
  fs.writeFileSync(path.join(MIG, `linie-${id}.txt`), linie.join('\n') + '\n');
  zapiszJson(path.join(MIG, `metryki-${id}.json`), { id, wyniki });
}

function uruchomZadanie(id) {
  const z = ZADANIA[id];
  if (!z) throw new Error(`nieznane zadanie: ${id}`);
  if (z.rodzaj === 'proba') przebiegProby(id, z);
  else if (z.rodzaj === 'g') przebiegG(id, z);
  else przebiegKratery(id, z);
}

/** Najwyżej `ile` procesów naraz; każdy dziecko ustawia sobie niski priorytet. */
async function rownolegle(zadania, ile = 3) {
  const kolej = zadania.slice();
  const wynik = [];
  const pracownik = async () => {
    while (kolej.length) {
      const { argumenty, log } = kolej.shift();
      const kod = await new Promise((res) => {
        const ds = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', fileURLToPath(import.meta.url), ...argumenty], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        const pl = log ? fs.createWriteStream(log) : null;
        ds.stdout.on('data', (d) => (pl ? pl.write(d) : process.stdout.write(d)));
        ds.stderr.on('data', (d) => process.stderr.write(d));
        ds.on('close', (c) => { pl?.end(); res(c); });
      });
      wynik.push({ argumenty, kod });
      if (kod !== 0) console.error('Zadanie padło:', argumenty.join(' '), 'kod', kod);
    }
  };
  await Promise.all(Array.from({ length: ile }, pracownik));
  return wynik;
}

// ---------------------------------------------------------------- tabela § 8

function tabela8() {
  const cz = (id) => { try { return JSON.parse(fs.readFileSync(path.join(MIG, `metryki-${id}.json`), 'utf8')); } catch { return null; } };
  const wiersze = [];
  const wiersz = (nazwa, wartosc, prog, ok) => wiersze.push({ nazwa, wartosc, prog, ok: ok === null ? 'b.d.' : ok ? 'tak' : 'NIE' });
  const s1 = cz('S1'), s2 = cz('S2'), s3 = cz('S3'), s4 = cz('S4'), s4g = cz('S4g'), s4sw = cz('S4sw'), w1 = cz('W1'), kol = cz('kolumna1'), nar = cz('naroznik'), ram = cz('rampa'), k60 = cz('krater60');
  if (w1) {
    const r = w1.podsumowanie.koniec.wieza.ruch.max;
    wiersz('W1: przemieszczenie przy końcu 60 s, zerwania', `${r.toFixed(4)} j., ${w1.zerwanych}`, '≤ 0,5 j., 0 zerwań', r <= 0.5 && w1.zerwanych === 0);
  }
  const dachy = (x, ts) => ts.map((t) => (x.dach[t] ?? NaN).toFixed(0)).join(', ');
  if (s1) {
    wiersz('Dach S1, t = 3, 4, 5, 6, 7', dachy(s1, [3, 4, 5, 6, 7]), '1295, 1047, 582, 217, 174 ± 80 j.', [[3, 1295], [4, 1047], [5, 582], [6, 217], [7, 174]].every(([t, d]) => Math.abs(s1.dach[t] - d) <= 80));
    wiersz('Przechył spójny S1', `${s1.podsumowanie.historia.maxPrzechylSpojny.toFixed(1)}°`, '≤ 8°', s1.podsumowanie.historia.maxPrzechylSpojny <= 8);
    const t5 = s1.tace[5], t45 = s1.tace[4.5];
    if (t5) wiersz('Płyty S1, t = 5: największy kawałek dachu', `${t5[t5.length - 1]}%`, '≤ 50%', t5[t5.length - 1] <= 50);
    if (t45) {
      const nad = t45.slice(-5, -1);
      const ile = nad.filter((q) => q < 80).length;
      wiersz('Płyty S1, t = 4,5: płyty nad frontem < 80%', `${ile} z 4 [${nad.join(' ')}], dach ${t45[t45.length - 1]}%`, '≥ 2 z 4', ile >= 2);
    }
    const m = s1.podsumowanie.koniec.wieza.wyspy.masa;
    const N = s1.podsumowanie.n; // jak w § 8: udział w całej wieży, razem z usuniętymi
    wiersz('Masa w kawałkach 8–63, S1', `${(100 * m[2] / N).toFixed(1)}%`, '≥ 45%', m[2] / N >= 0.45);
    wiersz('Masa w pojedynczych, S1', `${(100 * m[0] / N).toFixed(1)}%`, '≤ 20%', m[0] / N <= 0.2);
    wiersz('S1: NaN, symetria masek', `${s1.nan}, ${s1.sym.bledyMaski}`, '0, 0', s1.nan === 0 && s1.sym.bledyMaski === 0);
  }
  if (s2) {
    const wz = [[3, 1216, 80], [4, 1029, 80], [5, 545, 130], [6, 234, 130]];
    wiersz('Dach S2 z frontem, t = 3, 4, 5, 6', dachy(s2, [3, 4, 5, 6]), '1216, 1029 ± 80; 545, 234 ± 130', wz.every(([t, d, p]) => Math.abs(s2.dach[t] - d) <= p));
    wiersz('Przechył spójny S2', `${s2.podsumowanie.historia.maxPrzechylSpojny.toFixed(1)}°`, '≤ 8°', s2.podsumowanie.historia.maxPrzechylSpojny <= 8);
    wiersz('Odrzucone wstawienia do komórki, S2', `${s2.przepelnieniaKomorek}`, 'wzór dla GPU: ≤ 3 × ta liczba', null);
  }
  if (s3) {
    const v = s3.podsumowanie.S3.stosunekV, o = s3.podsumowanie.koniec.dysk.otworDoPrzekroju;
    wiersz('S3 v / swobodna', v.toFixed(2), '≥ 0,8', v >= 0.8);
    wiersz('S3 otwór / przekrój', o.toFixed(2), '1,2–4', o >= 1.2 && o <= 4);
    wiersz('S3 masa dysku 1 / 2–7 / 8–63 / 64–511 / 512+', s3.podsumowanie.koniec.dysk.wyspy.masa.join(' / '), 'odniesienie § 1.2', null);
  }
  for (const [nazwa, x] of [['Kolumna', kol], ['Narożnik', nar]]) {
    if (x) wiersz(`${nazwa}: dach przy t = 14`, x.dach[14].toFixed(0), '≥ 1290', x.dach[14] >= 1290);
  }
  if (k60) {
    const stoi = k60.wyniki.filter((q) => q.stoi).length;
    wiersz('Krater r = 60, rdzeń i rozerwanie, 6 miejsc', `${stoi} z ${k60.wyniki.length} stoi`, 'stoi', stoi === k60.wyniki.length);
  }
  if (s4) {
    const k = s4.chwile[14];
    const lWl = Math.max(k.gora.lWlasny, k.dol.lWlasny);
    const L = Math.sqrt(k.L[0] ** 2 + k.L[1] ** 2 + k.L[2] ** 2);
    const P = Math.sqrt(k.P[0] ** 2 + k.P[1] ** 2 + k.P[2] ** 2) / k.N;
    wiersz('S4: dryf przed cięciem', `${s4.dryf.toFixed(4)} j.`, '≤ 0,01 j.', s4.dryf <= 0.01);
    wiersz('S4: prędkość góry, dołu wzdłuż z', `${k.gora.v[2].toFixed(1)}, ${k.dol.v[2].toFixed(1)}`, 'góra +28…+45, dół −25…−42', k.gora.v[2] >= 28 && k.gora.v[2] <= 45 && k.dol.v[2] <= -25 && k.dol.v[2] >= -42);
    wiersz('S4: obrót góry, dołu', `${k.gora.w.toFixed(1)}, ${k.dol.w.toFixed(1)}°/s`, '2–7°/s, obie > 0', k.gora.w >= 2 && k.gora.w <= 7 && k.dol.w >= 2 && k.dol.w <= 7);
    wiersz('S4: suma pędu |P|/N po cięciu', `${P.toFixed(4)} j./s`, '≤ 0,05 j./s', P <= 0.05);
    wiersz('S4: suma momentu pędu do momentu jednej połowy', `${(100 * L / lWl).toFixed(2)}%`, '≤ 2%', L / lWl <= 0.02);
    wiersz('S4: największy kawałek połowy', `${(k.gora.ulamek * 100).toFixed(1)}%, ${(k.dol.ulamek * 100).toFixed(1)}%`, '≥ 85%', k.gora.ulamek >= 0.85 && k.dol.ulamek >= 0.85);
    wiersz('S4: węzły z S > 1,001 po przebiegu czyszczenia', `${s4.sPonad}`, '0', s4.sPonad === 0);
    wiersz('S4: oderwane poza strefą cięcia (±120 j.)', `${(k.gora.ulOderwPoza * 100).toFixed(2)}%, ${(k.dol.ulOderwPoza * 100).toFixed(2)}%`, '≤ 2%', k.gora.ulOderwPoza <= 0.02 && k.dol.ulOderwPoza <= 0.02);
    wiersz('Odrzucone wstawienia do komórki, S4', `${s4.przepelnieniaKomorek}`, 'wzór dla GPU: ≤ 3 × ta liczba', null);
    wiersz('S4: NaN, symetria masek', `${s4.nan}, ${s4.sym.bledyMaski}`, '0, 0', s4.nan === 0 && s4.sym.bledyMaski === 0);
  }
  if (s4g) {
    const k = s4g.chwile[9], p = s4g.chwile[5.5];
    const N = k.kosze.reduce((a, b) => a + b, 0);
    wiersz('S4 przy g = 400: masa w 8–63 przy t = 9', `${(100 * k.kosze[2] / N).toFixed(1)}%`, '≥ 40%', k.kosze[2] / N >= 0.4);
    wiersz('S4 przy g = 400: największy kawałek połowy przy t = 9', `${(k.gora.ulamek * 100).toFixed(1)}%, ${(k.dol.ulamek * 100).toFixed(1)}%`, '≤ 30%', k.gora.ulamek <= 0.3 && k.dol.ulamek <= 0.3);
    wiersz('S4 przy g = 400: przechył góry przy t = 5,5', `${p.gora.kat.toFixed(1)}°`, '≤ 14°', p.gora.kat <= 14);
  }
  if (s4 && s4sw) {
    // Równoważność: swobodny spadek względem próżni, po odjęciu spadku (Euler półjawny: −g·(t² + t·h)/2).
    const a = new Float32Array(fs.readFileSync(path.join(MIG, 'zrzut-S4-t6.bin')).buffer.slice(0)), b = new Float32Array(fs.readFileSync(path.join(MIG, 'zrzut-S4sw-t6.bin')).buffer.slice(0));
    const t = 6, h = 1 / 480, dz = -400 * (0.5 * t * t + 0.5 * t * h);
    const n = a.length / 3, d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const ex = b[3 * i] - a[3 * i], ey = b[3 * i + 1] - a[3 * i + 1], ez = b[3 * i + 2] - dz - a[3 * i + 2];
      d[i] = Math.sqrt(ex * ex + ey * ey + ez * ez);
    }
    d.sort();
    const q = (x) => d[Math.floor(x * n)];
    const r = s4.chwile[6], w = s4sw.chwile[6];
    wiersz('Równoważność: swobodny spadek względem próżni, t = 6: mediana odchyłki węzła, p99', `${q(0.5).toFixed(2)} j., ${q(0.99).toFixed(1)} j.`, '≤ 2 j. (mediana)', q(0.5) <= 2);
    wiersz('Równoważność: prędkości góry, dołu po odjęciu spadku', `${(w.gora.v[2] + 2400).toFixed(1)} (próżnia ${r.gora.v[2].toFixed(1)}), ${(w.dol.v[2] + 2400).toFixed(1)} (próżnia ${r.dol.v[2].toFixed(1)})`, 'co do 0,1 j./s w Node', Math.abs(w.gora.v[2] + 2400 - r.gora.v[2]) <= 0.5 && Math.abs(w.dol.v[2] + 2400 - r.dol.v[2]) <= 0.5);
  }
  if (ram) wiersz('Rampa g 400 → 0, stojąca wieża, koniec v_max', `${ram.vmaxKoniec.toFixed(2)} j./s`, '≤ 1 j./s', ram.vmaxKoniec <= 1);
  const szer = Math.max(...wiersze.map((w) => w.nazwa.length));
  const tekst = wiersze.map((w) => `${w.ok.padEnd(5)} ${w.nazwa.padEnd(szer)}  ${w.wartosc}   [próg: ${w.prog}]`).join('\n');
  fs.writeFileSync(path.join(MIG, 'tabela-8.txt'), tekst + '\n');
  zapiszJson(path.join(MIG, 'tabela-8.json'), wiersze);
  console.log(tekst);
}

// ---------------------------------------------------------------- zgodność z logami prototypu

function zgodnosc() {
  if (!fs.existsSync(PROTO)) {
    console.error(`Brak logów prototypu w ${PROTO}: porównanie działa tylko tam, gdzie leży .tmp/woksele-proto.`);
    return false;
  }
  const wy = [];
  const norm = (l) => l
    .replace(/ ms\/kl \d+/, ' ms/kl #')
    .replace(/init \d+ ms/, 'init # ms')
    .replace(/ściana \d+ s/, 'ściana # s');
  let wszystkie = 0, zgodne = 0;
  const porownaj = (plikLogu, wybor, plikNaszy) => {
    const logi = fs.readFileSync(path.join(PROTO, plikLogu), 'utf8').split(/\r?\n/).filter((l) => l && wybor(l));
    const nasze = fs.readFileSync(path.join(MIG, plikNaszy), 'utf8').split(/\r?\n/).filter(Boolean);
    for (const nl of nasze) {
      const klucz = nl.split(' ').slice(0, 2).join(' ');
      const szukane = plikLogu.includes('mapa') ? nl.split(' -> ')[0].split(' zerw')[0] : klucz;
      const wz = logi.find((l) => l.startsWith(szukane + ' ') || l === szukane);
      wszystkie++;
      if (wz && norm(wz) === norm(nl)) { zgodne++; wy.push(`OK      ${plikLogu}: ${norm(nl).slice(0, 180)}`); }
      else wy.push(`RÓŻNE   ${plikLogu}:\n  wzór : ${wz ? norm(wz) : '(brak linii)'}\n  port : ${norm(nl)}`);
    }
  };
  const logiR7 = [['S1', 'S1'], ['S2', 'S2f'], ['S3R7', 'S3rot30'], ['S3pozaR7', 'S3poza'], ['S3osmR7', 'S3osm']];
  for (const [id, naz] of logiR7) porownaj('proby4/log-R7.txt', (l) => l.startsWith(`R7 ${naz} `), `linie-${id}.txt`);
  for (const [id, plik] of [['S4', 'proby4/logG4-Z5.txt'], ['S4g', 'proby4/logG4-g.txt'], ['S4sw', 'proby4/logG4-sw.txt']]) {
    const logi = fs.readFileSync(path.join(PROTO, plik), 'utf8').split(/\r?\n/).filter(Boolean);
    const nasze = fs.readFileSync(path.join(MIG, `linie-${id}.txt`), 'utf8').split(/\r?\n/).filter(Boolean);
    wszystkie += logi.length;
    let ok = 0;
    for (let q = 0; q < logi.length; q++) {
      if (nasze[q] !== undefined && norm(nasze[q]) === norm(logi[q])) ok++;
      else wy.push(`RÓŻNE   ${plik} linia ${q + 1}:\n  wzór : ${norm(logi[q])}\n  port : ${nasze[q] ? norm(nasze[q]) : '(brak)'}`);
    }
    zgodne += ok;
    wy.push(`${ok === logi.length ? 'OK    ' : 'RÓŻNE '}  ${plik}: ${ok} z ${logi.length} linii identycznych`);
  }
  for (const id of ['kolumna1', 'naroznik', 'odpornosc']) porownaj('proby4/log-Qo.txt', () => true, `linie-${id}.txt`);
  porownaj('proby4/log-Rst.txt', () => true, 'linie-W1.txt');
  porownaj('proby4/wyniki-mapa5.txt', (l) => l.startsWith('K60 '), 'linie-krater60.txt');
  // Scena S3 dema (gProj = 400) kontra kawałki z kadrów fin11: to jedyny log prototypu liczony przy gProj = 400.
  const f11 = fs.readFileSync(path.join(PROTO, 'proby4/log-f11c.txt'), 'utf8').match(/masa kawałków \S+ (\[[^\]]+\]) zerw (\d+)/);
  const lS3 = fs.readFileSync(path.join(MIG, 'linie-S3.txt'), 'utf8');
  const mW = JSON.parse(lS3.match(/masa (\[[^\]]+\])/)[1]), mD = JSON.parse(lS3.match(/dyskmasa (\[[^\]]+\])/)[1]);
  const suma = JSON.stringify(mW.map((x, q) => x + mD[q]));
  const zS3 = lS3.match(/zerw (\d+)/)[1];
  const okS3 = f11 && f11[1] === suma && f11[2] === zS3;
  wszystkie++;
  if (okS3) zgodne++;
  wy.push(`${okS3 ? 'OK    ' : 'RÓŻNE '}  proby4/log-f11c.txt (S3 przy gProj = 400): kawałki ${suma}, zerw ${zS3}; wzór ${f11?.[1]}, zerw ${f11?.[2]}`);
  const nagl = [
    'Zgodność wzorca CPU (dema/woksele-zawalenia/wzorzec-cpu.js) z model-spec4, 2026-11-05. Maszyna: Node ' + process.version + '.',
    `Linie logów prototypu: ${zgodne} z ${wszystkie} identycznych po wycięciu pól czasu ściany (ms/kl, init, ściana).`,
    '',
    'Uwaga o S3. Wiersze S3 w proby4/log-R7.txt policzono przy gProj = g = 260 (K = 19 500) i nKom = 131 072: tak liczą je zadania S3R7, S3pozaR7, S3osmR7.',
    'Scena S3 dema to gProj = 400 (§ 10.3, kadry fin11) i nKom = 65 536: migawki, tabela § 8 i kawałki z log-f11c. Spec § 1.2 twierdziła, że log-R7 jest przy 400: błąd, poprawiony w § 1.2 i § 1.6.',
    'Etykieta P0 w linie-S3*.txt to wyniki dema przy gProj = 400, bez odpowiednika w log-R7.',
    '',
    'Porównanie linii:',
  ];
  const kat = path.join(WY, 'zgodnosc-bit');
  const bit = fs.existsSync(kat) ? fs.readdirSync(kat).map((f) => fs.readFileSync(path.join(kat, f), 'utf8').trim()) : [];
  const tekst = [...nagl, ...wy, '', 'Bit w bit z model-spec4 (ten sam proces, bajty stanu po każdej klatce, .tmp/woksele-demo/zgodnosc-bit.mjs):', ...bit, ''].join('\n');
  fs.writeFileSync(path.join(WY, 'zgodnosc-P0.txt'), tekst);
  console.log(tekst);
  return zgodne === wszystkie;
}

// ---------------------------------------------------------------- mapa kraterów

function mapaKraterow(a) {
  const proznia = a.mapa === 'proznia';
  const r = Number(a.r), J = Number(a.J), rP = Number(a.rP), od = Number(a.od ?? 0), dokad = Number(a.do ?? MIEJSCA_KRATEROW.length);
  const plik = path.join(WY, 'mapa', `${a.mapa}-r${r}.txt`);
  fs.mkdirSync(path.dirname(plik), { recursive: true });
  for (let q = od; q < dokad; q++) {
    const w = jedenKrater(`K${proznia ? 'P' : ''}${r}`, { c: MIEJSCA_KRATEROW[q], r, J, rP, proznia });
    console.log(w.linia);
    fs.appendFileSync(plik, w.linia + '\n');
  }
}

// ---------------------------------------------------------------- koszt pyłu

function hasz(a) { let h = Math.imul(a ^ 0x9E3779B1, 0x85EBCA77); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE3D); h ^= h >>> 16; return h >>> 0; }
const u1 = (h, s) => (((h >>> s) & 1023) / 511.5 - 1);
const popc18 = (x) => { x &= 0x3ffff; let c = 0; while (x) { x &= x - 1; c++; } return c; };

/** Wypełnienie pyłem wg reguł § 4.6 (obraz4.mjs z opcjami bieg-fin11.sh), 5120 × 1440, bez LOD i sufitu; miara: Mpx po wczesnym teście głębi z bufora 1/8. */
function kosztPylu(nazwa) {
  const FAB = { S1: () => S1({ T: 10 }), S2: () => S2({ T: 10 }), S3: () => S3({ T: 10 }) };
  const plan = FAB[nazwa]();
  const sc = plan.scena, n = sc.n;
  const m = new WzorzecCpu(bud(plan));
  const OPISY = nazwa === 'S3'
    ? { kino: { az: 35, el: 22, cel: [0, 0, -250], odl: 3400 }, blisko: { az: 30, el: 32, cel: [0, 0, -20], odl: 2200 }, zblizenie: { az: 22, el: 18, cel: [40, -60, -40], odl: 950 } }
    : { kino: { az: 32, el: 8, cel: [0, 0, 620], odl: 3300 }, blisko: { az: 35, el: 12, cel: [0, 0, 300], odl: 1800 }, zblizenie: { az: 28, el: 16, cel: [60, -80, 110], odl: 900 } };
  const W = 5120, H = 1440, FOV = (32 * Math.PI) / 180;
  const kamera = (o) => {
    const a = (o.az * Math.PI) / 180, e = (o.el * Math.PI) / 180;
    const dir = [Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e)];
    const oko = [o.cel[0] + dir[0] * o.odl, o.cel[1] + dir[1] * o.odl, o.cel[2] + dir[2] * o.odl];
    const f = [-dir[0], -dir[1], -dir[2]];
    let r = [f[1], -f[0], 0];
    const lr = Math.sqrt(r[0] * r[0] + r[1] * r[1]) || 1;
    r = [r[0] / lr, r[1] / lr, 0];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    return { oko, f, r, u, sk: H / (2 * Math.tan(FOV / 2)) };
  };
  const KAM = Object.fromEntries(Object.entries(OPISY).map(([k, o]) => [k, kamera(o)]));
  const PULA = 16000, POW = czyGrunt(sc.gruntZ) ? 1 : 0, GZ = sc.gruntZ;
  const px = new Float32Array(PULA * 3), pv = new Float32Array(PULA * 3), pw = new Float32Array(PULA), prz = new Float32Array(PULA);
  let pn = 0;
  const pylZgl = new Uint8Array(n);
  const DS = 8, WD = (W / DS) | 0, HD = (H / DS) | 0;
  const glebia = new Float32Array(WD * HD);
  const wypelnienie = (kam) => {
    const { oko, f, r, u, sk } = kam;
    glebia.fill(1e30);
    const P = m.pos, AK = m.aktywny;
    for (let i = 0; i < n; i++) {
      if (!AK[i]) continue;
      const dx = P[3 * i] - oko[0], dy = P[3 * i + 1] - oko[1], dz = P[3 * i + 2] - oko[2];
      const d = dx * f[0] + dy * f[1] + dz * f[2];
      if (d < 5) continue;
      const s = sk / d, x = (dx * r[0] + dy * r[1] + dz * r[2]) * s + W / 2, y = (dx * u[0] + dy * u[1] + dz * u[2]) * s + H / 2;
      const h = 10 * s;
      const x0 = Math.max(0, ((x - h) / DS) | 0), x1 = Math.min(WD - 1, ((x + h) / DS) | 0), y0 = Math.max(0, ((y - h) / DS) | 0), y1 = Math.min(HD - 1, ((y + h) / DS) | 0);
      for (let b = y0; b <= y1; b++) for (let a = x0; a <= x1; a++) if (d < glebia[b * WD + a]) glebia[b * WD + a] = d;
    }
    let suma = 0, przedGl = 0, maxQ = 0, wKadrze = 0;
    const pm = Math.min(pn, PULA);
    for (let q = 0; q < pm; q++) {
      const age = pw[q];
      const al = 0.7 * 0.075 * Math.min(1, age * 4) * Math.max(0, 1 - age / 6);
      if (al <= 0.002) continue;
      const rr = prz[q] * (POW ? 1 : 0.5) + (POW ? 38 : 9) * Math.sqrt(age);
      const dx = px[3 * q] - oko[0], dy = px[3 * q + 1] - oko[1], dz = px[3 * q + 2] - oko[2];
      const d = dx * f[0] + dy * f[1] + dz * f[2];
      if (d < 5) continue;
      const s = sk / d, x = (dx * r[0] + dy * r[1] + dz * r[2]) * s + W / 2, y = (dx * u[0] + dy * u[1] + dz * u[2]) * s + H / 2;
      const h = rr * s;
      const x0 = Math.max(0, x - h), x1 = Math.min(W, x + h), y0 = Math.max(0, y - h), y1 = Math.min(H, y + h);
      if (x1 <= x0 || y1 <= y0) continue;
      const pole = (x1 - x0) * (y1 - y0);
      wKadrze++;
      suma += pole;
      if (pole > maxQ) maxQ = pole;
      let wid = 0, wsz = 0;
      for (let b = (y0 / DS) | 0; b < Math.min(HD, Math.ceil(y1 / DS)); b++) {
        for (let a = (x0 / DS) | 0; a < Math.min(WD, Math.ceil(x1 / DS)); a++) {
          wsz++;
          if (d < glebia[b * WD + a]) wid++;
        }
      }
      if (wsz) przedGl += (pole * wid) / wsz;
    }
    const ekran = W * H;
    return { wKadrze, mpx: +(suma / 1e6).toFixed(1), przerys: +(suma / ekran).toFixed(1), mpxZaGlebia: +(przedGl / 1e6).toFixed(1), przerysZaGlebia: +(przedGl / ekran).toFixed(1), maxQuadKpx: +(maxQ / 1e3).toFixed(0) };
  };
  const dt = 1 / 60;
  const N = 600;
  const seria = [];
  for (let f = 0; f <= N; f++) {
    const P = m.pos, V = m.vel, MK = m.maskaW, AK = m.aktywny, iN = m.iN0;
    for (let i = 0; i < n; i++) {
      if (!AK[i] || pylZgl[i]) continue;
      const lost = 1 - popc18(MK[i]) * iN[i];
      if (lost <= 0.5 || m.lLicz[i] < 5) continue;
      if (sc.kind[i] === 4 && (hasz(i + 9) & 1023) / 1023 > 0.25) continue;
      pylZgl[i] = 1;
      const h = hasz(i + 31337);
      if ((h >>> 3) % 3 !== 0) continue;
      const q = pn++ % PULA;
      const hq = hasz(h);
      px[3 * q] = P[3 * i] + 10 * u1(hq, 0); px[3 * q + 1] = P[3 * i + 1] + 10 * u1(hq, 10); px[3 * q + 2] = P[3 * i + 2] + 10 * u1(hq, 20);
      const dzP = POW ? 0.6 : 1;
      pv[3 * q] = dzP * V[3 * i] + 30 * u1(hq, 3); pv[3 * q + 1] = dzP * V[3 * i + 1] + 30 * u1(hq, 13); pv[3 * q + 2] = dzP * V[3 * i + 2] + (POW ? 18 * (1 + u1(hq, 23)) : 30 * u1(hq, 23));
      const rr = Math.sqrt(P[3 * i] ** 2 + P[3 * i + 1] ** 2) + 1, uu = 0.5 + 0.5 * ((hq >>> 9) & 255) / 255;
      pv[3 * q] += 90 * uu * P[3 * i] / rr; pv[3 * q + 1] += 90 * uu * P[3 * i + 1] / rr; pv[3 * q + 2] = 6 * u1(hq, 23);
      pw[q] = 0; prz[q] = 16 + 18 * ((hq >>> 7) & 255) / 255;
    }
    const pm = Math.min(pn, PULA);
    for (let q = 0; q < pm; q++) {
      const dr = POW ? 0.985 : 1;
      pv[3 * q] *= dr; pv[3 * q + 1] *= dr; pv[3 * q + 2] = pv[3 * q + 2] * dr + (POW ? 3.5 : 0) * dt;
      if (POW && px[3 * q + 2] < GZ + 170) {
        const rr = Math.sqrt(px[3 * q] ** 2 + px[3 * q + 1] ** 2) + 30;
        const ak = 70 * dt * Math.max(0, 1 - pw[q] / 7);
        pv[3 * q] += (ak * px[3 * q]) / rr; pv[3 * q + 1] += (ak * px[3 * q + 1]) / rr;
        if (pv[3 * q + 2] > 3) pv[3 * q + 2] = 3;
        prz[q] += 16 * dt;
      }
      px[3 * q] += pv[3 * q] * dt; px[3 * q + 1] += pv[3 * q + 1] * dt; px[3 * q + 2] += pv[3 * q + 2] * dt;
      if (POW && px[3 * q + 2] < GZ + 8) { px[3 * q + 2] = GZ + 8; pv[3 * q + 2] = 8; pv[3 * q] *= 1.002; pv[3 * q + 1] *= 1.002; }
      pw[q] += dt;
    }
    if (f % 30 === 0) {
      let zywe = 0;
      for (let q = 0; q < pm; q++) if (pw[q] < 6) zywe++;
      const w = { t: f / 60, emisja: pn, pulaZywe: zywe };
      for (const k of Object.keys(KAM)) w[k] = wypelnienie(KAM[k]);
      seria.push(w);
    }
    if (f === N) break;
    plan.zdarzenia(f, m);
    m.krok();
  }
  const szczyt = {};
  for (const k of Object.keys(KAM)) {
    let best = seria[0];
    for (const s of seria) if (s[k].mpxZaGlebia > best[k].mpxZaGlebia) best = s;
    szczyt[k] = { t: best.t, mpxZaGlebia: best[k].mpxZaGlebia, mpx: best[k].mpx, przerysZaGlebia: best[k].przerysZaGlebia, maxQuadKpx: best[k].maxQuadKpx, wKadrze: best[k].wKadrze };
  }
  const wynik = { nazwa, n, emisjaRazem: pn, szczyt, seria };
  fs.writeFileSync(path.join(WY, `koszt-pylu-${nazwa}.json`), JSON.stringify(wynik, null, 1));
  console.log(nazwa, 'emisja', pn, JSON.stringify(szczyt));
}

// ---------------------------------------------------------------- wejście

function argumenty(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    out[k] = i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

const a = argumenty(process.argv.slice(2));
if (a.zadanie) {
  uruchomZadanie(a.zadanie);
} else if (a.tabela) {
  tabela8();
} else if (a.zgodnosc) {
  process.exitCode = zgodnosc() ? 0 : 1;
} else if (a.mapa) {
  if (a.procesy) {
    const ile = Number(a.procesy), od = Number(a.od ?? 0), dokad = Number(a.do ?? MIEJSCA_KRATEROW.length);
    const plik = path.join(WY, 'mapa', `${a.mapa}-r${a.r}.txt`);
    fs.mkdirSync(path.dirname(plik), { recursive: true });
    fs.rmSync(plik, { force: true });
    const zad = [];
    for (let q = od; q < dokad; q += 2) zad.push({ argumenty: ['--mapa', a.mapa, '--r', a.r, '--J', a.J, '--rP', a.rP, '--od', String(q), '--do', String(Math.min(dokad, q + 2))] });
    await rownolegle(zad, Math.min(3, ile));
  } else {
    mapaKraterow(a);
  }
} else if (a['koszt-pylu']) {
  kosztPylu(a['koszt-pylu']);
} else {
  const lista = a.zadania ? a.zadania.split(',') : Object.keys(ZADANIA);
  const wyniki = await rownolegle(lista.map((id) => ({ argumenty: ['--zadanie', id], log: path.join(MIG, `log-${id}.txt`) })), 3);
  if (wyniki.some((w) => w.kod !== 0)) process.exitCode = 1;
  tabela8();
}
