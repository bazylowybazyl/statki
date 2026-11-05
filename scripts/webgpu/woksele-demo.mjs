// Harness dema wiązanych wokseli w headless Chrome (docs/SPEC-woksele-zawalenia.md § 8), w tle, bez okna, na własnym Vite.
// Pakiet P1: solver bez obrazu. Testy zgodności GPU z migawkami Node, W1, pipeline'y, punkt G1.
//
//   node scripts/webgpu/woksele-demo.mjs [--testy podkrok,mutacje,zrodla,vmax,wzorzec,w1,pipeline,g1] [--migawki S1_t3.50,...] [--powtorz 3] [--out .tmp/woksele-demo/P1] [--port 5420] [--chrome=--flaga,--flaga2]
//
// Karta: maszyna ma RTX 5080 i zintegrowany Radeon. Harness czyta device.adapterInfo strony, zapisuje przy każdym wyniku i ODMAWIA (kod 4), gdy liczy AMD albo rasteryzator programowy.
// Gra w toku: czeka co 30 s, najwyżej 30 min, potem kod 3. Sprawdza przed każdą sceną. Klient League sam nie blokuje, a Gothic 1 Remake tak (gryUzytkownika z sondy widzi to odwrotnie).
// Kody wyjścia: 0 wszystko zaliczone, 1 coś nie przeszło, 3 gra nie skończyła się w limicie, 4 zła karta.
import os from 'node:os';
os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo } from './wspolne.mjs';
import { obceProcesy } from './sondaGpuWorkera.mjs';

const args = parseArgs();
const TESTY = String(args.testy || 'podkrok,mutacje,zrodla,vmax,wzorzec,w1,pipeline,g1').split(',').filter(Boolean);
const MIGAWKI = String(args.migawki || 'S1_t3.50,S1_t5.00,S2_t3.00,S3_t0.43,S3_t0.80,S3_t2.95,S4_t3.00').split(',').filter(Boolean);
const wyDir = resolve(repo, args.out || '.tmp/woksele-demo/P1');
const plikG1 = resolve(repo, args.g1 || '.tmp/woksele-demo/G1.txt');
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const PROG_G1_MS = 8; // warunek porażki 1, § 12
mkdirSync(wyDir, { recursive: true });

const raport = { start: new Date().toISOString(), adapter: null, testy: {}, porazki: [], obce: [] };
const porazka = (t) => { raport.porazki.push(t); console.log('PORAŻKA', t); };

// ── Gra w toku ── Własny test, nie gryUzytkownika(): tamten łapie sam klient League i nie łapie Gothic 1 Remake.
const GRY = /^(League of Legends|RuneScape.*|.*Dragonwilds.*|RSDragon.*|osclient.*|G1R-Win64-Shipping)$/i;
const powershell = (cmd) => new Promise((ok) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd],
  { maxBuffer: 16 << 20, windowsHide: true, timeout: 30000 }, (err, stdout) => ok(String(stdout || ''))));
async function graWToku() {
  const out = await powershell("Get-Process | ForEach-Object { $_.ProcessName } | Sort-Object -Unique");
  return out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && GRY.test(s));
}
async function czekajNaCisze(gdzie) {
  const t0 = Date.now();
  for (;;) {
    const gry = await graWToku();
    if (!gry.length) return;
    const min = (Date.now() - t0) / 60000;
    if (min >= 30) {
      raport.koniec = `gra użytkownika działa ponad 30 min (${gry.join(', ')}), przed: ${gdzie}`;
      zapiszRaport();
      console.error(`PRZERWANE: ${raport.koniec}. Nic nie zmierzone po tym miejscu, uruchom ponownie po grze.`);
      process.exit(3);
    }
    console.log(`gra w toku (${gry.join(', ')}), czekam przed: ${gdzie} (${min.toFixed(1)} min)`);
    await sleep(30000);
  }
}

function zapiszRaport() {
  raport.zapis = new Date().toISOString();
  writeFileSync(join(wyDir, 'raport.json'), JSON.stringify(raport, null, 1) + '\n');
}

/** Odmowa pomiaru: AMD, rasteryzator programowy albo cokolwiek innego niż NVIDIA. */
function czemuZlaKarta(a) {
  const opis = `${a?.vendor ?? ''} ${a?.architecture ?? ''} ${a?.description ?? ''} ${a?.device ?? ''}`.toLowerCase();
  if (!a || !opis.trim()) return 'brak adapter.info';
  if (a.isFallbackAdapter === true || a.type === 'CPU' || /swiftshader|llvmpipe|warp|microsoft basic|software/.test(opis)) return `rasteryzator programowy: ${opis}`;
  if (/amd|radeon|\bati\b/.test(opis)) return `karta zintegrowana AMD: ${opis}`;
  if (!/nvidia/.test(opis)) return `karta inna niż NVIDIA: ${opis}`;
  return null;
}

const f = (x, d = 3) => (x === null || x === undefined || !Number.isFinite(x) ? 'b.d.' : x.toFixed(d));

await czekajNaCisze('start');
raport.obce = await obceProcesy().catch(() => []);
const { server, base } = await startVite(Number(args.port || 5420));
// --enable-webgpu-developer-features: bez niej znaczniki czasu są kwantowane do 100 µs (§ 8, pkt 3). Flaga tylko tu, nie w wspolne.mjs.
const chrome = await startChrome({ width: 640, height: 360, extraArgs: ['--enable-webgpu-developer-features', ...String(args.chrome || '').split(',').filter(Boolean)] });
const logi = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 1800000) => evaluate(cdp, e, t);

let kod = 0;
async function otworz(zapytanie) {
  await cdp.send('Page.navigate', { url: `${base}/dema/woksele-zawalenia.html?${zapytanie}` });
  // Zegar harnessu od razu prawdziwy: demo ma własny zegar ręczny, a tryb „frozen” wstrzymałby performance.now.
  await waitFor(cdp, '!!(window.__harness && ((window.__harness.clock.mode = "real") === "real"))', 60000, 20);
  if (!await waitFor(cdp, '!!(window.__wok && (window.__wok.adapter || window.__wok.blad))', 120000, 100)) throw new Error('strona nie wstała (limit 120 s)');
  const adapter = await ev('window.__wok.adapter');
  if (adapter) {
    raport.adapter = adapter;
    const zla = czemuZlaKarta(adapter);
    if (zla) {
      raport.odmowa = zla;
      console.error(`ODMOWA: ${zla}. Czasy i wynik z tej karty nic nie znaczą.`);
      kod = 4;
      throw new Error('zła karta');
    }
  }
  if (!await waitFor(cdp, '!!(window.__wok && (window.__wok.gotowe || window.__wok.blad))', 300000, 100)) throw new Error('strona nie wstała (limit 300 s)');
  const blad = await ev('window.__wok.blad');
  if (blad) throw new Error(`strona: ${blad}`);
  return adapter;
}

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  const adapter = await otworz('test=1');
  console.log('adapter', JSON.stringify(adapter));

  // (d) Dziennik pipeline'ów po rozgrzewce: niepusty, a od tej chwili nic nowego.
  const pipeStart = await ev('window.__harness.pipes.list.length');
  const dziennik = await ev(`window.__harness.pipes.list.slice(0, ${pipeStart}).map((p) => ({ nazwa: p.nazwa, compute: !!p.compute, budowa: !!p.budowa }))`);
  raport.dziennikPoRozgrzewce = { ile: pipeStart, compute: dziennik.filter((p) => p.compute).map((p) => p.nazwa), budowy: dziennik.filter((p) => p.budowa).length };
  console.log(`pipeline'y po rozgrzewce: ${pipeStart} wpisów, compute: ${raport.dziennikPoRozgrzewce.compute.join(', ')}`);

  if (TESTY.includes('podkrok')) {
    const wy = {};
    const POWT = Number(args.powtorz || 3); // kWstaw to wyścig na atomiku, więc kilka przebiegów tej samej migawki
    const wiersz = (r) => `maski ${r.maski}  S ${r.s} (maks ${f(r.sMax, 5)})  A ${r.a}  L ${r.l}  D ${r.d}  F0 ${r.f0}  etyk ${r.etyk}  |Δa| maks ${f(r.daMax)} p99 ${f(r.daP99)} ponad5 ${r.ponadA}  NaN ${r.nan}`;
    const linie = [`adapter ${JSON.stringify(adapter)}`, `jeden przebieg kLista + kF z migawek Node, § 8, ${POWT} × każda migawka. Progi: maski 0, S, A, L, D do 1e-3, |Δa| do 5, NaN 0.`];
    let lF64 = 0, lF32 = 0, lLacznie = 0, lWyjasnione = 0;
    for (const nazwa of MIGAWKI) {
      await czekajNaCisze(`podkrok ${nazwa}`);
      for (let p = 0; p < POWT; p++) {
        const r = await ev(`window.__wok.test.podkrok(${JSON.stringify(nazwa)}, { diag: true })`);
        if (p === 0) wy[nazwa] = r;
        lLacznie++;
        const L = r.listaRozne;
        const f32Ok = r.wzgledemF32.zaliczony;
        const f32TezNie = !r.f32WzgledemF64.zaliczony;
        const flipyF32 = r.flipy.length > 0 && r.flipy.every((q) => q.f32JakGpu);
        const stan = r.zaliczony ? 'OK ' : (f32Ok && f32TezNie && flipyF32 ? 'F32' : 'ŹLE');
        if (r.zaliczony) lF64++;
        if (f32Ok) lF32++;
        if (stan === 'F32') lWyjasnione++;
        const l = [
          `${stan} ${nazwa} #${p + 1}${r.liczEtyk ? '' : ' (etykieta poza zaliczeniem: scena bez kotwic, § 1.6)'}`,
          `    GPU − Node f64: ${wiersz(r)}  asym ${r.asymetrie}  NaN stanu ${r.nanStan}  lista: węzły ${L.wezlow} (+${L.tylkoGpu} −${L.tylkoNode}), przepełnione ${r.przepelnioneKomorki}`,
          `    GPU − Node f32: ${wiersz(r.wzgledemF32)}`,
          `    Node f32 − f64: ${wiersz(r.f32WzgledemF64)}`,
        ];
        if (r.flipy.length) l.push(`    wiązania z inną gałęzią niż f64: ${JSON.stringify(r.flipy)}`);
        console.log(l.join('\n'));
        linie.push(...l);
        if (stan === 'ŹLE') porazka(`podkrok ${nazwa} #${p + 1}`);
        if (r.asymetrie) porazka(`podkrok ${nazwa} #${p + 1}: ${r.asymetrie} niesymetrycznych bitów maski`);
      }
    }
    linie.push(`Razem ${lLacznie} przebiegów: ${lF64} zalicza względem Node f64 wprost, ${lWyjasnione} nie zalicza wyłącznie przez wiązanie, które Node w f32 liczy tak samo jak GPU; względem Node f32 zalicza ${lF32}.`);
    console.log(linie.at(-1));
    raport.testy.podkrok = { przebiegi: lLacznie, zaliczoneF64: lF64, wyjasnioneF32: lWyjasnione, zaliczoneF32: lF32, wy };
    writeFileSync(join(wyDir, 'podkrok.txt'), linie.join('\n') + '\n');
    writeFileSync(join(wyDir, 'podkrok.json'), JSON.stringify({ adapter, wy }, null, 1) + '\n');
    zapiszRaport();
  }

  if (TESTY.includes('mutacje')) {
    await czekajNaCisze('mutacje');
    const lista = args.mutacje ? String(args.mutacje).split('|') : await ev('window.__wok.test.MUTACJE');
    const wy = await ev(`window.__wok.test.mutacje(${JSON.stringify(MIGAWKI)}, ${JSON.stringify(lista)})`);
    let niewykryte = 0, nadmiar = 0;
    const wiersze = [];
    for (const [mut, po] of Object.entries(wy)) {
      const wiersz = [];
      for (const [mig, r] of Object.entries(po)) {
        if (r.wykrytaNode && !r.wykrytaGpu) { niewykryte++; porazka(`mutacja „${mut}” przy ${mig}: Node ją widzi, GPU nie`); }
        if (r.wykrytaGpu && r.wykrytaNode === false) nadmiar++;
        wiersz.push(`${mig}: ${r.wykrytaGpu ? 'wyk.' : '—'} m ${r.gpu.maski}/${r.node?.maski} S ${r.gpu.s}/${r.node?.s} A ${r.gpu.a}/${r.node?.a} L ${r.gpu.l}/${r.node?.l} p99 ${f(r.gpu.daP99, 1)}/${f(r.node?.daP99, 1)}`);
      }
      wiersze.push(`${mut}\n  ${wiersz.join('\n  ')}`);
    }
    console.log(wiersze.join('\n'));
    console.log(`mutacje: ${Object.keys(wy).length} na GPU, niewykryte tam, gdzie Node je widzi: ${niewykryte}; wykryte tylko na GPU: ${nadmiar}`);
    raport.testy.mutacje = { niewykryte, nadmiar, wy };
    writeFileSync(join(wyDir, 'mutacje.txt'), `adapter ${JSON.stringify(adapter)}\nformat: GPU/Node\n${wiersze.join('\n')}\nniewykryte ${niewykryte}, wykryte tylko na GPU ${nadmiar}\n`);
    zapiszRaport();
  }

  if (TESTY.includes('zrodla')) {
    await czekajNaCisze('źródła grawitacji');
    const r = await ev('window.__wok.test.zrodla()');
    for (const [nazwa, q] of Object.entries(r)) {
      console.log(`${q.zaliczony ? 'OK ' : 'ŹLE'} źródło ${nazwa}: maski ${q.maski}  S ${q.s}  A ${q.a}  L ${q.l}  D ${q.d}  etyk ${q.etyk}  |Δa| maks ${f(q.daMax)} p99 ${f(q.daP99)} ponad5 ${q.ponadA}  NaN ${q.nan}  śr. |a| ${f(q.sredniaAbsA, 1)}, skG ${q.skG}, sFr ${f(q.sFr, 4)}`);
      if (!q.zaliczony) porazka(`źródło ${nazwa}`);
    }
    raport.testy.zrodla = r;
    zapiszRaport();
  }

  if (TESTY.includes('vmax')) {
    await czekajNaCisze('vmax');
    const r = await ev('window.__wok.test.vmax()');
    console.log(`vMax kI: |v| ${f(r.vPo, 2)} (oczekiwane 4000), dx ${f(r.dxPo)} (${f(r.dxOczekiwane)}), kotwica stoi ${r.kotwicaStoi}, martwy stoi ${r.martwyStoi}`);
    if (!r.zaliczony) porazka('vMax w kI');
    raport.testy.vmax = r;
    zapiszRaport();
  }

  if (TESTY.includes('wzorzec')) {
    const wy = {};
    for (const nazwa of MIGAWKI) {
      await czekajNaCisze(`krok ze wzorcem ${nazwa}`);
      const r = await ev(`window.__wok.test.krokZWzorcem(${JSON.stringify(nazwa)}, 1)`);
      wy[nazwa] = r;
      console.log(`krok GPU kontra Node (bez progu) ${nazwa}: maski ${r.maski}, dx ${f(r.dxMax, 4)}, dv ${f(r.dvMax, 3)}, dS ${f(r.dSMax, 4)}, asym ${r.asymetrie}/${r.asymetrieNode}, NaN ${r.nan}`);
    }
    raport.testy.wzorzec = wy;
    zapiszRaport();
  }

  if (TESTY.includes('w1')) {
    await czekajNaCisze('W1');
    const r = await ev(`window.__wok.test.w1(${Number(args.w1 || 60)}, 10)`);
    for (const p of r.probki) console.log(`W1 t=${p.t}: przemieszczenie ${f(p.maxPrzem, 4)} j., vMax ${f(p.vMax, 4)}, zerwane bity ${p.zerwaneBity}, inne maski ${p.wezlyZInnaMaska}, asym ${p.asymetrie}, NaN ${p.nan}, maks D ${f(p.maxD, 5)}, maks S ${f(p.maxS, 5)}`);
    console.log(`W1 ${r.zaliczony ? 'ZALICZONE' : 'NIE'}, ${r.sekund} s liczone ${(r.msSciany / 1000).toFixed(1)} s ściany`);
    if (!r.zaliczony) porazka('W1');
    raport.testy.w1 = r;
    writeFileSync(join(wyDir, 'W1.json'), JSON.stringify({ adapter, ...r }, null, 1) + '\n');
    zapiszRaport();
  }

  if (TESTY.includes('pipeline')) {
    // Po wszystkich powyższych przebiegach na tej samej stronie: żadnego nowego pipeline'u ani budowy NodeBuildera.
    const nowe = await ev(`window.__harness.pipes.list.slice(${pipeStart}).map((p) => ({ nazwa: p.nazwa, sync: !!p.sync, compute: !!p.compute, budowa: !!p.budowa }))`);
    const r = { poRozgrzewce: pipeStart, computeRozgrzane: raport.dziennikPoRozgrzewce.compute, nowe: nowe.length, syncNowe: nowe.filter((p) => p.sync).length, nazwy: nowe.map((p) => p.nazwa) };
    console.log(`pipeline'y: dziennik po rozgrzewce ${r.poRozgrzewce}, nowe po rozgrzewce ${r.nowe}, w tym synchroniczne ${r.syncNowe}`);
    if (pipeStart === 0 || raport.dziennikPoRozgrzewce.compute.length < 5) porazka('dziennik pipeline\'ów pusty albo niepełny: „0 synchronicznych” nic by nie znaczyło');
    if (nowe.length) porazka(`${nowe.length} pipeline'ów po rozgrzewce: ${[...new Set(r.nazwy)].join(', ')}`);
    raport.testy.pipeline = r;
    zapiszRaport();
  }

  if (TESTY.includes('g1')) {
    const stany = [
      { etykieta: 'S3 cały (t = 0)', scena: 'S3' },
      { etykieta: 'S3 t = 0,8', migawka: 'S3_t0.80' },
      { etykieta: 'S3 t = 2,95', migawka: 'S3_t2.95' },
      { etykieta: 'S1 cały (t = 0)', scena: 'S1' },
      { etykieta: 'S1 t = 3,5', migawka: 'S1_t3.50' },
      { etykieta: 'S1 t = 5', migawka: 'S1_t5.00' },
    ];
    const dwie = await ev('window.__wok.test.dwieListy()');
    console.log(`dwie listy (łata uid): kF ${f(dwie.kF1)} ms, 4 × kF ${f(dwie.kF4)} ms, stosunek ${f(dwie.stosunek, 2)} (pass ma własny narzut, więc mniej niż 4)`);
    if (!dwie.zaliczony) porazka('dwie listy o znanym stosunku pracy nie dały dwóch niezerowych, rosnących czasów');
    const wynik = { lista: [], profil: [], dwie };
    for (const s of stany) {
      await czekajNaCisze(`G1 lista, ${s.etykieta}`);
      const r = await ev(`window.__wok.test.g1(${JSON.stringify({ scena: s.scena ?? null, migawka: s.migawka ?? null })})`);
      wynik.lista.push({ etykieta: s.etykieta, ...r });
      console.log(`G1 lista ${s.etykieta}: fizyka śr ${f(r.fizyka?.sr)} p50 ${f(r.fizyka?.p50)} maks ${f(r.fizyka?.maks)} ms/krok; sama siatka+lista ${f(r.listaSama?.p50)} ms, kontakty ${r.kontakty}, żywe ${r.zywe}`);
    }
    // Nic nowego także po krokach mierzonych tej strony, a strona ?profil=1 ma własny dziennik.
    const poListach = await ev(`window.__harness.pipes.list.slice(${pipeStart}).length`);
    if (poListach) porazka(`G1, lista: ${poListach} pipeline'ów po rozgrzewce`);
    await otworz('test=1&profil=1');
    const pipeProfil = await ev('window.__harness.pipes.list.length');
    if (pipeProfil === 0) porazka("G1, profil: pusty dziennik pipeline'ów");
    for (const s of stany) {
      await czekajNaCisze(`G1 profil, ${s.etykieta}`);
      const r = await ev(`window.__wok.test.g1(${JSON.stringify({ scena: s.scena ?? null, migawka: s.migawka ?? null })})`);
      wynik.profil.push({ etykieta: s.etykieta, ...r });
      const suma = (r.kF?.sr ?? 0) + (r.kI?.sr ?? 0) + (r.kLista?.sr ?? 0) + (r.kWstaw?.sr ?? 0) + (r.kZerujPo?.sr ?? 0);
      console.log(`G1 profil ${s.etykieta}: kF ${f(r.kF?.sr)} kI ${f(r.kI?.sr)} kLista ${f(r.kLista?.sr)} kWstaw ${f(r.kWstaw?.sr)} kZerujPo ${f(r.kZerujPo?.sr)} suma ${f(suma)} ms/krok`);
    }
    const poProfilu = await ev(`window.__harness.pipes.list.slice(${pipeProfil}).length`);
    if (poProfilu) porazka(`G1, profil: ${poProfilu} pipeline'ów po rozgrzewce`);
    const obcePo = await obceProcesy().catch(() => []);
    raport.testy.g1 = { ...wynik, obcePrzed: raport.obce, obcePo };
    const rozdzielone = (w) => {
      const wiz = 8 * w.wiazanBity;
      return `ns na wizytę wiązania (kF ÷ 8 × bity): ${f((1e6 * (w.kF?.sr ?? NaN)) / wiz, 2)}`;
    };
    const linie = [
      'G1: pierwszy pomiar kF, kI, kLista na GPU, ms na krok fizyki (8 podkroków, lista co 4), znaczniki czasu z łatką uid list, --enable-webgpu-developer-features.',
      `Data ${new Date().toISOString()}. Narzędzie scripts/webgpu/woksele-demo.mjs. Kroki bez zdarzeń (P1), stan po wgraniu migawki idzie dalej swobodnie.`,
      `adapter.info ${JSON.stringify(adapter)}`,
      `procesy obce przed: ${JSON.stringify(raport.obce)}`,
      `procesy obce po: ${JSON.stringify(obcePo)}`,
      `łata uid, dwie listy: kF ${f(dwie.kF1)} ms, 4 × kF ${f(dwie.kF4)} ms, stosunek ${f(dwie.stosunek, 2)}`,
      raport.testy.w1 ? `kontrola ścianą: W1 ${raport.testy.w1.sekund * 60} kroków w ${f(raport.testy.w1.msSciany / 1000, 2)} s, razem z czekaniem na kolejkę i odczytami, ${f(raport.testy.w1.msSciany / (raport.testy.w1.sekund * 60))} ms/krok, więc znaczniki nie są zaniżone o rząd` : 'kontrola ścianą: W1 nie liczone w tym przebiegu',
      '',
      'A. Lista kroku, jeden compute pass, 22 dispatche: to, co pójdzie w demie.',
      'stan | fizyka śr / p50 / maks ms/krok | sama siatka + lista (kWstaw, kLista, kZerujPo) p50 ms na 1 przebudowę | żywe węzły | kontakty',
      ...wynik.lista.map((w) => `${w.etykieta} | ${f(w.fizyka?.sr)} / ${f(w.fizyka?.p50)} / ${f(w.fizyka?.maks)} | ${f(w.listaSama?.p50)} | ${w.zywe} | ${w.kontakty}`),
      '',
      'B. ?profil=1: każdy dispatch we własnym passie, tylko do proporcji (§ 8, pkt 4; drobne kernele zawyżone).',
      'stan | kF | kI | kLista | kWstaw | kZerujPo | suma ms/krok (średnie) | koszt jednostkowy',
      ...wynik.profil.map((w) => {
        const suma = (w.kF?.sr ?? 0) + (w.kI?.sr ?? 0) + (w.kLista?.sr ?? 0) + (w.kWstaw?.sr ?? 0) + (w.kZerujPo?.sr ?? 0);
        return `${w.etykieta} | ${f(w.kF?.sr)} | ${f(w.kI?.sr)} | ${f(w.kLista?.sr)} | ${f(w.kWstaw?.sr)} | ${f(w.kZerujPo?.sr)} | ${f(suma)} | ${rozdzielone(w)}`;
      }),
      '',
    ];
    const s3 = wynik.lista.filter((w) => w.etykieta.startsWith('S3'));
    const maksS3 = Math.max(...s3.map((w) => w.fizyka?.sr ?? Infinity));
    const werdykt = maksS3 > PROG_G1_MS
      ? `WARUNEK PORAŻKI 1 Z § 12: kF + kI + kLista dla S3 ${f(maksS3)} ms/krok, powyżej ${PROG_G1_MS} ms.`
      : `Warunek porażki 1 z § 12 niespełniony: kF + kI + kLista dla S3 najwyżej ${f(maksS3)} ms/krok, próg ${PROG_G1_MS} ms.`;
    linie.push(werdykt);
    console.log(werdykt);
    writeFileSync(plikG1, linie.join('\n') + '\n');
    raport.testy.g1.werdykt = werdykt;
    zapiszRaport();
  }
} catch (e) {
  if (kod !== 4) { raport.blad = String(e?.stack || e); porazka(`harness: ${raport.blad}`); }
} finally {
  raport.bledyStrony = logi.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 40);
  if (raport.bledyStrony.length) porazka(`błędy strony: ${raport.bledyStrony.length}`);
  zapiszRaport();
  await chrome.close();
  await server.close();
}
console.log(`raport ${join(wyDir, 'raport.json')}, porażki ${raport.porazki.length}`);
for (const b of (raport.bledyStrony || []).slice(0, 8)) console.log('  ', b.slice(0, 400));
process.exit(kod || (raport.porazki.length ? 1 : 0));
