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
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, screenshotPng } from './wspolne.mjs';
import { obceProcesy } from './sondaGpuWorkera.mjs';

const args = parseArgs();
const TESTY = String(args.testy || 'podkrok,mutacje,zrodla,vmax,wzorzec,sceny,strzal,kratery,w1,pipeline,g1').split(',').filter(Boolean);
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
// AGENT: nieudane odpytanie to „gra jest”, nie „gry nie ma”. Pod obciążeniem PowerShell na BelowNormal potrafi przekroczyć 30 s: 2026-11-05 pusty wynik po limicie puścił przebiegi GPU w czasie meczu użytkownika.
const powershell = (cmd) => new Promise((ok) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd],
  { maxBuffer: 16 << 20, windowsHide: true, timeout: 60000 }, (err, stdout) => ok(err ? null : String(stdout || ''))));
async function graWToku() {
  const out = await powershell("Get-Process | ForEach-Object { $_.ProcessName } | Sort-Object -Unique");
  if (out === null) return ['odpytanie listy procesów nieudane, traktuję jak grę'];
  return out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && GRY.test(s));
}
// AGENT: podczas czekania na koniec gry strona nie rysuje. Pętla rAF pokaz.js przy --disable-frame-rate-limit daje około 600 kl/s na RTX 5080 także w bezruchu: 2026-11-05 szło tak 3,5 min w czasie meczu użytkownika.
let uspijStrone = null;
let zamknijPrzyPrzerwaniu = null;
async function czekajNaCisze(gdzie) {
  const t0 = Date.now();
  let obudz = null;
  for (;;) {
    const gry = await graWToku();
    if (!gry.length) {
      if (obudz) await obudz();
      return;
    }
    if (!obudz && uspijStrone) obudz = await uspijStrone();
    const min = (Date.now() - t0) / 60000;
    if (min >= 30) {
      raport.koniec = `gra użytkownika działa ponad 30 min (${gry.join(', ')}), przed: ${gdzie}`;
      zapiszRaport();
      console.error(`PRZERWANE: ${raport.koniec}. Nic nie zmierzone po tym miejscu, uruchom ponownie po grze.`);
      if (zamknijPrzyPrzerwaniu) await zamknijPrzyPrzerwaniu();
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
const wierszLod = (r) => `  sloty ${r.sloty}, cień ${r.cienSloty}: razem ${f(r.razem, 2)} ms GPU = rysunek ${f(r.hdr, 2)} + cień ${f(r.cien, 2)} + głębia ${f(r.gleb, 2)} + okluzja ${f(r.ssao, 2)} + pył ${f(r.pyl, 2)} + wyjście ${f(r.wyj, 2)}; wierzchołków ${f(r.wierzcholkiMln, 1)} mln na klatkę`;

await czekajNaCisze('start');
raport.obce = await obceProcesy().catch(() => []);
// --base: cudzy serwer (test komendy dla użytkownika), bez własnego Vite.
const { server, base } = args.base ? { server: { close: async () => {} }, base: String(args.base) } : await startVite(Number(args.port || 5420));
// --enable-webgpu-developer-features: bez niej znaczniki czasu są kwantowane do 100 µs (§ 8, pkt 3). Flaga tylko tu, nie w wspolne.mjs.
const [szerOkna, wysOkna] = String(args.rozmiar || (args.zrzut ? '960x720' : '640x360')).split('x').map(Number);
const chrome = await startChrome({ width: szerOkna, height: wysOkna, extraArgs: ['--enable-webgpu-developer-features', ...String(args.chrome || '').split(',').filter(Boolean)] });
const logi = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 1800000) => evaluate(cdp, e, t);
zamknijPrzyPrzerwaniu = async () => { await chrome.close().catch(() => {}); await server.close().catch(() => {}); };
uspijStrone = async () => {
  const stary = await ev(`(() => { const s = window.__wok?.pokaz?.stan; if (!s) return null; const o = { rysowac: s.rysowac !== false, kroczyc: s.kroczyc !== false }; s.rysowac = false; s.kroczyc = false; return o; })()`).catch(() => null);
  return async () => { if (stary) await ev(`Object.assign(window.__wok.pokaz.stan, ${JSON.stringify(stary)}); true`).catch(() => {}); };
};

let kod = 0;
async function otworz(zapytanie) {
  // --strona: inna kopia strony (np. HEAD wypakowany do .tmp, do porównania „bit w bit” bez ruszania drzewa).
  await cdp.send('Page.navigate', { url: `${base}${args.strona || '/dema/woksele-zawalenia.html'}?${zapytanie}` });
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
  if (args.zrzut) {
    // P3: zrzuty strony na żywo. --zrzut S1 --chwile 0,3,5,6 [--migawka S1_t3.50] [--kam az,el,cx,cy,cz,odl] [--etykieta nazwa]. Bez testów P1.
    const PNG = resolve(repo, args.out || '.tmp/woksele-demo/P3');
    mkdirSync(PNG, { recursive: true });
    // --plan "S1:0,3,5,6;S2:3,5": każda scena z własnymi chwilami (wtedy --zrzut 1 i bez --chwile).
    const plan = args.plan ? new Map(String(args.plan).split(';').map((w) => { const [s, c] = w.split(':'); return [s, c.split(',').map(Number)]; })) : null;
    const sceny = plan ? [...plan.keys()] : String(args.zrzut === true ? 'S1' : args.zrzut).split(',');
    const zapytanie = new URLSearchParams();
    zapytanie.set('scena', sceny[0]);
    if (args.ao) zapytanie.set('ao', String(args.ao));
    if (args.migawka) zapytanie.set('migawka', String(args.migawka).split(',')[0]);
    if (args.ziarno) zapytanie.set('ziarno', String(args.ziarno));
    // Próba LOD: --lodS1 '{"dx":40,"mat":"staly"}' to opcje S1Lod dla sceny S1 na stronie.
    if (args.lodS1) zapytanie.set('lodS1', String(args.lodS1));
    if (args.pyl) zapytanie.set('pyl', String(args.pyl));
    if (args.maxWez) zapytanie.set('maxWez', String(args.maxWez));
    if (args.sloty) zapytanie.set('sloty', String(args.sloty));
    if (args.cienSloty !== undefined) zapytanie.set('cienSloty', String(args.cienSloty));
    if (!args.pomiar) zapytanie.set('maksKl', '60');
    const adapter = await otworz(zapytanie.toString());
    console.log('adapter', JSON.stringify(adapter));
    const pipeStart = await ev('window.__harness.pipes.list.length');
    const syncStart = await ev(`window.__harness.pipes.list.filter((p) => p.sync).map((p) => p.nazwa)`);
    console.log(`pipeline'y po rozgrzewce: ${pipeStart}, synchroniczne w rozgrzewce: ${syncStart.length}, w tym rysunków: ${JSON.stringify(syncStart.filter((n) => !String(n).startsWith('compute:')))}`);
    if (!args.panel) await ev('window.__wok.pokaz.panel(false)');
    if (args.bezPylu) await ev('window.__wok.obraz.pyl.wlacz(false); true');
    if (args.kam) await ev(`window.__wok.pokaz.kamera(${JSON.stringify((() => { const k = String(args.kam).split(',').map(Number); return { az: k[0], el: k[1], cel: [k[2], k[3], k[4]], odl: k[5] }; })())})`);
    const chwile = String(args.chwile || '0,3,5,6').split(',').map(Number);
    const et = args.etykieta ? `${args.etykieta}_` : '';
    const pomiary = {};
    for (const scena of sceny) {
      await czekajNaCisze(`zrzut ${scena}`);
      await ev(`window.__wok.pokaz.wejdz(${JSON.stringify(scena)}, { pomin: false, kamera: ${args.kam ? 'false' : 'true'} }).then(() => null)`);
      // AGENT: wejdz() resetuje scenę, więc migawkę z adresu trzeba wgrać po nim. Klatka z migawki bez kroków to jedyny zrzut powtarzalny co do piksela (kWstaw to wyścig na atomiku): tak sprawdza się „bit w bit”.
      if (args.evPrzed) await ev(String(args.evPrzed)); // --evPrzed "js": dowolne ustawienie po wejściu w scenę, np. kamera cienia do próby
      const migawkaSceny = args.migawka ? String(args.migawka).split(',').find((m) => m.startsWith(`${scena}_`)) : null;
      if (migawkaSceny) {
        // Zegar stoi od razu: inaczej pętla rAF zdąży zrobić krok i doChwili zresetuje scenę, a zrzut idzie z fizyki, nie z migawki.
        await ev('window.__wok.pokaz.bezZegara(true); true');
        await ev(`window.__wok.pokaz.wgrajMigawke(${JSON.stringify(migawkaSceny)}).then(() => null)`);
      }
      for (const t of plan ? plan.get(scena) : chwile) {
        await ev(`window.__wok.pokaz.doChwili(${t})`);
        const plik = join(PNG, `${et}${scena}_t${t.toFixed(2)}.png`);
        await screenshotPng(cdp, plik);
        console.log('zrzut', plik);
        if (args.kosztLod) {
          // LOD obrazu (plan LOD, metoda G): ten sam stan przy 7, 2 i 1 slocie, potem koszt wariantów na zamrożonej klatce. --kosztLod szczyt: dodatkowo każdy węzeł uszkodzony, górna granica.
          for (const k of [7, 2, 1]) {
            await ev(`window.__wok.obraz.ustawLod({ sloty: ${k}, cien: ${k} }); true`);
            await ev(`window.__wok.pokaz.doChwili(${t})`);
            await screenshotPng(cdp, join(PNG, `${et}${scena}_sl${k}_t${t.toFixed(2)}.png`));
          }
          const wyn = await ev('window.__wok.pokaz.kosztLod()');
          console.log(`koszt LOD ${scena} t = ${t}, ${wyn.n} węzłów, ${wyn.w} × ${wyn.h}, krok ${wyn.krok}, kernele obrazu ${f(wyn.kerneleObrazuMs, 2)} ms`);
          for (const r of wyn.wy) console.log(wierszLod(r));
          (pomiary[scena] ??= {}).kosztLod = [...(pomiary[scena].kosztLod ?? []), { t, ...wyn }];
        }
      }
      if (args.kosztLod === 'szczyt') {
        await ev('window.__wok.pokaz.uszkodzWszystko(); true');
        const wyn = await ev('window.__wok.pokaz.kosztLod()');
        console.log(`koszt LOD ${scena}, każdy węzeł uszkodzony, ${wyn.n} węzłów, ${wyn.w} × ${wyn.h}`);
        for (const r of wyn.wy) console.log(wierszLod(r));
        (pomiary[scena] ??= {}).kosztLodSzczyt = wyn;
      }
      if (args.koszt) {
        // Jedna liczba kosztu klatki: po każdej chwili z --chwile n klatek od tego miejsca, Number(--koszt) przebiegów od nowa.
        const k = [];
        for (let q = 0; q < Number(args.koszt); q++) {
          await ev(`window.__wok.pokaz.doChwili(${(plan ? plan.get(scena) : chwile)[0]})`);
          k.push(await ev('window.__wok.pokaz.kosztKlatki(32, 15)'));
          console.log('koszt klatki', scena, JSON.stringify(k.at(-1)));
        }
        pomiary[scena] = { ...pomiary[scena], koszt: k };
      }
      if (args.kosztStany) {
        // Cała klatka z krokiem, pył włączony i wyłączony, od tej samej chwili (pierwsza z --chwile albo --plan): 60 klatek ściany i 60 ze znacznikami, czyli około 2 s czasu sceny na stan. Wyłączenie zdejmuje rysunek i skład, kernele pyłu liczą dalej. Orientacja, nie tabela: 5120 × 1440 to pomiar dzienny.
        const t = (plan ? plan.get(scena) : chwile)[0];
        const stany = {};
        for (const [klucz, wl] of [['zPylem', true], ['bezPylu', false]]) {
          await ev(`window.__wok.obraz.pyl.wlacz(${wl}); true`);
          await ev(`window.__wok.pokaz.doChwili(${t})`);
          stany[klucz] = await ev('window.__wok.pokaz.kosztKlatki(60, 60)');
          console.log('koszt stanu', scena, `t = ${t}`, klucz, JSON.stringify(stany[klucz]));
        }
        await ev('window.__wok.obraz.pyl.wlacz(true); true');
        pomiary[scena] = { ...pomiary[scena], kosztStany: { t, ...stany } };
      }
      if (args.kosztPylu) {
        // P4: pył włączony i wyłączony na tej samej zamrożonej klatce: chwila ostatnia z --chwile, kamera z --kam, 5120 × 1440 z --rozmiar.
        pomiary[scena] = { ...pomiary[scena], kosztPylu: await ev('window.__wok.pokaz.kosztPylu()') };
        console.log('koszt pyłu', scena, JSON.stringify(pomiary[scena].kosztPylu));
      }
      if (args.pomiar) {
        pomiary[scena] = await ev('window.__wok.pokaz.zmierzKlatki(60, true)');
        console.log('klatka z krokiem', scena, JSON.stringify(pomiary[scena]));
        console.log('  diag', JSON.stringify(await ev('window.__wok.pokaz.diag()')));
        await ev('window.__wok.pokaz.bezZegara(false)');
        const k0 = await ev('({ k: window.__wok.pokaz.stan.klatek, f: window.__wok.pokaz.stan.krok, t: performance.now() })');
        await sleep(3000);
        const k1 = await ev('({ k: window.__wok.pokaz.stan.klatek, f: window.__wok.pokaz.stan.krok, t: performance.now() })');
        console.log(`  pętla na żywo: ${((k1.k - k0.k) * 1000 / (k1.t - k0.t)).toFixed(1)} kl/s rAF, ${((k1.f - k0.f) * 1000 / (k1.t - k0.t)).toFixed(1)} kroków/s`);
      }
    }
    if (args.przyciski) {
      // Każdy przycisk sceny w panelu, potem Reset: scena wchodzi, kroki idą, zdarzenia działają, dziennik pipeline'ów nie rośnie.
      await ev('window.__wok.pokaz.panel(true)');
      await ev('window.__wok.pokaz.bezZegara(false)');
      const ile = await ev('document.querySelectorAll("#panelSceny button").length');
      const wyn = [];
      // --przyciskiOd n: przejście od n-tego przycisku. Nocą seria GPU ma najwyżej 60 s, a cały panel to około 2 min.
      for (let q = Number(args.przyciskiOd || 0); q < ile; q++) {
        // AGENT: sprawdzenie gry przed każdym przyciskiem, a nie tylko przed sceną. 2026-11-05 bieg zaczął się między meczami i przejście przycisków z żywą pętlą rAF szło 3 min w czasie startu następnego meczu.
        await czekajNaCisze(`przycisk ${q + 1} z ${ile}`);
        const nazwa = await ev(`document.querySelectorAll("#panelSceny button")[${q}].textContent`);
        const wylaczony = await ev(`document.querySelectorAll("#panelSceny button")[${q}].disabled`);
        const pipePrzed = await ev('window.__harness.pipes.list.length');
        await ev(`document.querySelectorAll("#panelSceny button")[${q}].click()`);
        const weszla = await waitFor(cdp, `document.querySelectorAll("#panelSceny button")[${q}].classList.contains("wl")`, 60000, 50);
        await sleep(1500);
        const k0 = await ev('window.__wok.pokaz.stan.krok');
        await ev('[...document.querySelectorAll("#panelSter button")][0].click()');
        await sleep(600);
        const k1 = await ev('window.__wok.pokaz.stan.krok');
        // Żywa pętla rAF po resecie: scena biegnie sama, zrzut z panelem. Sprawdza, że obraz idzie ze zdarzeniami także bez kroków harnessu.
        await sleep(4000);
        const id = await ev('window.__wok.pokaz.stan.scena');
        await screenshotPng(cdp, join(PNG, `zywo_${id}.png`));
        const k2 = await ev('window.__wok.pokaz.stan.krok');
        const pipePo = await ev('window.__harness.pipes.list.length');
        wyn.push({ nazwa, id, wylaczony, weszla: !!weszla, krokPrzedResetem: k0, krokPoResecie: k1, krokZrzutu: k2, nowePipeline: pipePo - pipePrzed });
      }
      console.log('przyciski', JSON.stringify(wyn));
      raport.testy.przyciski = wyn;
      if (wyn.some((w) => w.wylaczony || !w.weszla || w.krokPoResecie >= w.krokPrzedResetem + 60 || w.nowePipeline)) porazka(`przyciski scen: ${JSON.stringify(wyn)}`);
    }
    if (args.interakcje) {
      await czekajNaCisze('interakcje');
      // Mysz i klawisze przez CDP, jak u użytkownika: orbita, przybliżenie, przesuw, spacja, R, P, przyciski panelu, zmiana rozmiaru okna.
      const poz = () => ev('window.__wok.camera.position.toArray()');
      const stanS = () => ev('(() => { const s = window.__wok.pokaz.stan; return { krok: s.krok, pauza: s.pauza, tempo: s.tempo, scena: s.scena }; })()');
      const mysz = async (type, x, y, button = 'left', o = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button, buttons: button === 'left' ? 1 : button === 'right' ? 2 : 0, clickCount: 1, ...o });
      const klawisz = async (code, key) => {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: key === ' ' ? 32 : key.toUpperCase().charCodeAt(0) });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: key === ' ' ? 32 : key.toUpperCase().charCodeAt(0) });
      };
      const wyn = {};
      await ev('window.__wok.pokaz.panel(true)');
      await ev('window.__wok.pokaz.bezZegara(false)');
      const p0 = await poz();
      await mysz('mouseMoved', 300, 300, 'none');
      await mysz('mousePressed', 300, 300);
      for (let q = 1; q <= 10; q++) { await mysz('mouseMoved', 300 + 12 * q, 300, 'left'); await sleep(20); }
      await mysz('mouseReleased', 420, 300);
      await sleep(400);
      const p1 = await poz();
      wyn.orbita = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 300, deltaX: 0, deltaY: -300 });
      await sleep(400);
      const p2 = await poz();
      wyn.przyblizenie = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
      await mysz('mousePressed', 300, 300, 'right');
      for (let q = 1; q <= 10; q++) { await mysz('mouseMoved', 300, 300 + 8 * q, 'right'); await sleep(20); }
      await mysz('mouseReleased', 300, 380, 'right');
      await sleep(400);
      const p3 = await poz();
      wyn.przesuw = Math.hypot(p3[0] - p2[0], p3[1] - p2[1], p3[2] - p2[2]);
      const s0 = await stanS();
      await klawisz('Space', ' ');
      await sleep(100);
      const s1 = await stanS();
      await sleep(300);
      const s2 = await stanS();
      wyn.pauza = s1.pauza === true && s2.krok === s1.krok;
      await klawisz('Space', ' ');
      await klawisz('KeyR', 'r');
      await sleep(100);
      const s3 = await stanS();
      wyn.reset = s3.krok < s0.krok + 90;
      await klawisz('KeyP', 'p');
      await sleep(600);
      wyn.licznik = await ev('document.getElementById("licznik").textContent');
      await klawisz('KeyP', 'p');
      await ev('[...document.querySelectorAll("#panelTempo button")][2].click()');
      wyn.tempo = (await stanS()).tempo;
      await ev('[...document.querySelectorAll("#panelSceny button")].find((b) => b.textContent.startsWith("S2")).click()');
      await sleep(4000);
      wyn.scena = (await stanS()).scena;
      await ev('[...document.querySelectorAll("#panelTempo button")][0].click()');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 600, deviceScaleFactor: 1, mobile: false });
      await sleep(800);
      await screenshotPng(cdp, join(PNG, `${et}po_zmianie_rozmiaru.png`));
      wyn.kanwa = await ev('[document.getElementById("kanwa").width, document.getElementById("kanwa").height]');
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      console.log('interakcje', JSON.stringify(wyn));
      raport.testy.interakcje = wyn;
      if (!(wyn.orbita > 1 && wyn.przyblizenie > 1 && wyn.przesuw > 1 && wyn.pauza && wyn.reset && wyn.tempo === 0.25 && wyn.scena === 'S2' && wyn.kanwa[0] === 1280)) porazka(`interakcje: ${JSON.stringify(wyn)}`);
    }
    const nowe = await ev(`window.__harness.pipes.list.slice(${pipeStart}).map((p) => ({ nazwa: p.nazwa, sync: !!p.sync, budowa: !!p.budowa }))`);
    console.log(`po rozgrzewce nowe wpisy dziennika: ${nowe.length}, synchroniczne: ${nowe.filter((p) => p.sync).length} ${JSON.stringify(nowe.map((p) => p.nazwa).slice(0, 16))}`);
    raport.testy.zrzut = { sceny, chwile, pomiary, syncRozgrzewka: syncStart.length, nowe: nowe.length, syncNowe: nowe.filter((p) => p.sync).length };
    if (nowe.some((p) => p.sync)) porazka(`pipeline'y synchroniczne po rozgrzewce: ${nowe.filter((p) => p.sync).length}`);
    throw Object.assign(new Error('koniec zrzutów'), { zrzutyKoniec: true });
  }
  const adapter = await otworz(`test=1${args.maxWez ? `&maxWez=${args.maxWez}` : ''}`);
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
        if (!r.listaOk) porazka(`podkrok ${nazwa} #${p + 1}: lista różna w ${L.wezlow} węzłach bez przepełnionej komórki`);
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
    // Próg 8 kroków, 0 masek na migawkach bez wiązania przy samym progu f32. S2 t = 3 ma takie wiązanie (§ 1.7), więc idzie bez progu.
    const Z_PROGIEM = new Set(['S1_t3.50', 'S3_t2.95', 'S4_t3.00']);
    for (const nazwa of MIGAWKI) {
      await czekajNaCisze(`krok ze wzorcem ${nazwa}`);
      const r = await ev(`window.__wok.test.krokZWzorcem(${JSON.stringify(nazwa)}, ${Number(args.krokiWzorca || 8)})`);
      wy[nazwa] = r;
      const prog = Z_PROGIEM.has(nazwa);
      console.log(`${prog ? (r.zaliczony ? 'OK ' : 'ŹLE') : 'bez progu'} krok GPU kontra Node ${nazwa}, ${r.krokow} kroków: maski ${r.maski} (f32 ${r.maskiF32}, f32−f64 ${r.maskiF32F64}), dx ${f(r.dxMax, 4)}, dv ${f(r.dvMax, 3)}, dS ${f(r.dSMax, 4)}, lista: węzły ${r.lista.wezlow} (+${r.lista.tylkoGpu} −${r.lista.tylkoNode}), poza granicą zasięgu ${r.listaPozaGranica}, przepełnione ${r.przepelnione}, maks. w komórce ${r.maxKomorka}, asym ${r.asymetrie}/${r.asymetrieNode}, NaN ${r.nan}`);
      if (prog && !r.zaliczony) porazka(`krok ze wzorcem ${nazwa}: ${r.maski} różnych masek, lista poza granicą ${r.listaPozaGranica}, po ${r.krokow} krokach`);
    }
    raport.testy.wzorzec = wy;
    zapiszRaport();
  }

  if (TESTY.includes('sceny')) {
    // P2: sceny od początku biegu z planem zdarzeń w solverze. Tabela § 8 z wartościami z Node obok. Warunek porażki 2 z § 12 na końcu.
    const lista = String(args.sceny || 'S1,S2,S3,S4,S4g,S4sw,rampa,krater60p,krater90p,krater60g').split(',').filter(Boolean);
    const wy = {};
    for (const id of lista) {
      await czekajNaCisze(`scena ${id}`);
      const t0 = Date.now();
      const op = id === 'S1' || id === 'S2' ? { tace: [4.5, 5] } : {};
      const r = await ev(`window.__wok.test.scenaPelna(${JSON.stringify(id)}, ${JSON.stringify(op)})`);
      wy[id] = r;
      const rz = Object.keys(r.dach).map(Number).sort((a, b) => a - b).filter((t) => t >= 2 && Number.isInteger(t)).map((t) => `${t}:${r.dach[t].toFixed(0)}`).join(' ');
      console.log(`scena ${id}: ${r.N} kroków, ${f(r.msNaKrok, 3)} ms/krok ściany z odczytami, ${((Date.now() - t0) / 1000).toFixed(1)} s razem, NaN ${r.nan}, asym ${r.asymetrie}, S>1 ${r.sPonad}, odrzucone wstawienia suma ${r.odrzucone.suma} maks ${r.odrzucone.maks}, kratery ${r.liczniki.wykonaneKratery}, klatki pchnięć ${r.liczniki.pchnieteKlatki}, błędy GPU ${r.bledyGpu} | dach ${rz}`);
      writeFileSync(join(wyDir, `scena-${id}.json`), JSON.stringify({ adapter, ...r }, null, 1) + '\n');
      zapiszRaport();
    }
    const row = [];
    const wiersz = (nazwa, node, gpu, prog, ok) => { row.push({ nazwa, node, gpu, prog, ok: ok === null ? 'b.d.' : ok ? 'tak' : 'NIE' }); };
    const dachy = (x, ts) => ts.map((t) => (x.dach[t] ?? NaN).toFixed(0)).join(', ');
    const { S1, S2, S3, S4, S4g, S4sw, rampa } = wy;
    let przechylS1 = null, otwor = null, pP = null;
    if (S1) {
      przechylS1 = S1.podsumowanie.historia.maxPrzechylSpojny;
      wiersz('Dach S1, t = 3…7', '1295, 1047, 582, 217, 174', dachy(S1, [3, 4, 5, 6, 7]), '± 80', [[3, 1295], [4, 1047], [5, 582], [6, 217], [7, 174]].every(([t, d]) => Math.abs(S1.dach[t] - d) <= 80));
      wiersz('Przechył spójny S1', '4,2°', `${przechylS1.toFixed(1)}°`, '≤ 8°', przechylS1 <= 8);
      const t5 = S1.tace[5], t45 = S1.tace[4.5];
      if (t5) wiersz('Płyty S1, t = 5: największy kawałek dachu', '8%', `${t5.at(-1)}%`, '≤ 50%', t5.at(-1) <= 50);
      if (t45) { const nad = t45.slice(-5, -1), ile = nad.filter((q) => q < 80).length; wiersz('Płyty S1, t = 4,5: płyty nad frontem < 80%', '4 z 4', `${ile} z 4`, '≥ 2 z 4', ile >= 2); }
      const m = S1.podsumowanie.koniec.wieza.wyspy.masa, N = S1.n;
      wiersz('Masa w kawałkach 8–63, S1', '58%', `${(100 * m[2] / N).toFixed(1)}%`, '≥ 45%', m[2] / N >= 0.45);
      wiersz('Masa w pojedynczych, S1', '12%', `${(100 * m[0] / N).toFixed(1)}%`, '≤ 20%', m[0] / N <= 0.2);
    }
    if (S2) {
      const wz = [[3, 1216, 80], [4, 1029, 80], [5, 545, 130], [6, 234, 130]];
      wiersz('Dach S2 z frontem, t = 3…6', '1216, 1029, 545, 234', dachy(S2, [3, 4, 5, 6]), '± 80, ± 130', wz.every(([t, d, p]) => Math.abs(S2.dach[t] - d) <= p));
      const pr = S2.podsumowanie.historia.maxPrzechylSpojny;
      wiersz('Przechył spójny S2', '2,8°', `${pr.toFixed(1)}°`, '≤ 8°', pr <= 8);
    }
    if (S3) {
      const v = S3.podsumowanie.S3.stosunekV;
      otwor = S3.podsumowanie.koniec.dysk.otworDoPrzekroju;
      wiersz('S3 v / swobodna', '0,87', v.toFixed(2), '≥ 0,8', v >= 0.8);
      wiersz('S3 otwór / przekrój', '2,62', otwor.toFixed(2), '1,2–4', otwor >= 1.2 && otwor <= 4);
      wiersz('S3 masa dysku 1 / 2–7 / 8–63 / 64–511 / 512+', '616 / 173 / 88 / 0 / 16 505', S3.podsumowanie.koniec.dysk.wyspy.masa.join(' / '), 'odniesienie', null);
    }
    if (S4) {
      const k = S4.chwile[14];
      const lWl = Math.max(k.gora.lWlasny, k.dol.lWlasny);
      const L = Math.hypot(...k.L);
      pP = Math.hypot(...k.P) / k.N;
      wiersz('S4: dryf przed cięciem', '0,0000 j.', `${S4.dryf.toFixed(4)} j.`, '≤ 0,01 j.', S4.dryf <= 0.01);
      wiersz('S4: prędkość góry, dołu wzdłuż z', '+37,5, −34,1', `${k.gora.v[2].toFixed(1)}, ${k.dol.v[2].toFixed(1)}`, 'góra +28…+45, dół −25…−42', k.gora.v[2] >= 28 && k.gora.v[2] <= 45 && k.dol.v[2] <= -25 && k.dol.v[2] >= -42);
      wiersz('S4: obrót góry, dołu', '4,8, 3,3°/s', `${k.gora.w.toFixed(1)}, ${k.dol.w.toFixed(1)}°/s`, '2–7°/s', k.gora.w >= 2 && k.gora.w <= 7 && k.dol.w >= 2 && k.dol.w <= 7);
      wiersz('S4: |P|/N po cięciu', '0,0000 j./s', `${pP.toFixed(4)} j./s`, '≤ 0,05 j./s', pP <= 0.05);
      wiersz('S4: |L| do momentu połowy', '0,2%', `${(100 * L / lWl).toFixed(2)}%`, '≤ 2%', L / lWl <= 0.02);
      wiersz('S4: największy kawałek połowy', '92,6%, 99,5%', `${(k.gora.ulamek * 100).toFixed(1)}%, ${(k.dol.ulamek * 100).toFixed(1)}%`, '≥ 85%', k.gora.ulamek >= 0.85 && k.dol.ulamek >= 0.85);
      wiersz('S4: węzły z S > 1,001 po czyszczeniu', '0', `${S4.sPonad}`, '0', S4.sPonad === 0);
      wiersz('S4: oderwane poza strefą ±120', '≤ 0,23%', `${(k.gora.ulOderwPoza * 100).toFixed(2)}%, ${(k.dol.ulOderwPoza * 100).toFixed(2)}%`, '≤ 2%', k.gora.ulOderwPoza <= 0.02 && k.dol.ulOderwPoza <= 0.02);
    }
    if (S4g) {
      const k = S4g.chwile[9], p = S4g.chwile[5.5], N = k.kosze.reduce((a, b) => a + b, 0);
      wiersz('S4 przy g = 400: masa w 8–63 przy t = 9', '53,6%', `${(100 * k.kosze[2] / N).toFixed(1)}%`, '≥ 40%', k.kosze[2] / N >= 0.4);
      wiersz('S4 przy g = 400: największy kawałek połowy, t = 9', '1%, 16%', `${(k.gora.ulamek * 100).toFixed(1)}%, ${(k.dol.ulamek * 100).toFixed(1)}%`, '≤ 30%', k.gora.ulamek <= 0.3 && k.dol.ulamek <= 0.3);
      wiersz('S4 przy g = 400: przechył góry, t = 5,5', '10,6°', `${p.gora.kat.toFixed(1)}°`, '≤ 14°', p.gora.kat <= 14);
    }
    if (S4 && S4sw) {
      const r = await ev('window.__wok.test.rownowaznosc()');
      if (r) wiersz('Równoważność: swobodny spadek względem próżni, t = 6, mediana / p99', '0,25 j.', `${r.mediana.toFixed(2)} / ${r.p99.toFixed(1)} j.`, '≤ 2 j.', r.mediana <= 2);
    }
    for (const [id, nod] of [['S2', 142], ['S4', 778]]) {
      // Node liczy na każdej przebudowie przy S = 16, tu stan co 15 klatek przy S = 24 (licznika w wLicz nie ma): wiersz z § 8 widzi tylko rząd wielkości.
      if (wy[id]) wiersz(`Odrzucone wstawienia ${id}, próbka co 15 klatek`, `${nod} (S = 16)`, `${wy[id].odrzucone.suma}`, '≤ 3 × Node', wy[id].odrzucone.suma <= 3 * nod);
    }
    if (rampa) wiersz('Rampa g 400 → 0, stojąca wieża, koniec v_max', '0,07 j./s', `${rampa.vmaxKoniec.toFixed(2)} j./s`, '≤ 1 j./s', rampa.vmaxKoniec <= 1);
    for (const [id, nod] of [['krater60p', 'kawałek 99,7–99,9%, v ≤ 0,01, 0°/s, |P|/N 0,000'], ['krater90p', 'kawałek 98,5–99,7%, v ≤ 0,40, ≤ 0,08°/s, |P|/N ≤ 0,005']]) {
      const c = wy[id]?.calosc;
      if (c) wiersz(`Krater w próżni ${id}`, nod, `kawałek ${(c.ulamek * 100).toFixed(1)}%, oderwane ${c.oderwane}, usunięte ${c.usuniete} (plan ${c.planowo}), v ${Math.hypot(...c.v).toFixed(3)}, ${c.w.toFixed(2)}°/s, |P|/N ${c.P.toFixed(4)}`, 'kawałek ≥ 98%, |P|/N ≤ 0,05', c.ulamek >= 0.98 && c.P <= 0.05);
    }
    const stojace = ['krater60g', 'k60a', 'k60b', 'k60c', 'k60d', 'k60e'].filter((id) => wy[id]);
    if (stojace.length) {
      const dachyK = stojace.map((id) => wy[id].dach[10]);
      wiersz(`Krater r = 60 przy g = 400, ${stojace.length} miejsc: dach przy t = 10`, 'stoi', dachyK.map((q) => q.toFixed(0)).join(', '), '≥ 1290', dachyK.every((q) => q >= 1290));
    }
    for (const [id, nazwa] of [['kolumna1', 'Kolumna'], ['naroznik', 'Narożnik']]) {
      if (wy[id]) wiersz(`${nazwa}: dach przy t = 14`, '1309–1310', wy[id].dach[14].toFixed(0), '≥ 1290', wy[id].dach[14] >= 1290);
    }
    if (wy.odpornosc) wiersz('Odporność: kolumna + 2 kratery, dach przy t = 14', '1308, 0,5°', `${wy.odpornosc.dach[14].toFixed(0)}, ${wy.odpornosc.podsumowanie.historia.maxPrzechyl.toFixed(1)}°`, '≥ 1290', wy.odpornosc.dach[14] >= 1290);
    for (const [id, vN, oN] of [['S3poza', 'b.d.', '2,77'], ['S3osm', 'b.d.', '2,05']]) {
      if (wy[id]) { const o = wy[id].podsumowanie.koniec.dysk.otworDoPrzekroju; wiersz(`${id}: v / swobodna, otwór`, `${vN}, ${oN}`, `${wy[id].podsumowanie.S3.stosunekV.toFixed(2)}, ${o.toFixed(2)}`, '1,2–4', o >= 1.2 && o <= 4); }
    }
    for (const [id, r] of Object.entries(wy)) if (r.nan || r.asymetrie) wiersz(`NaN, asymetrie ${id}`, '0, 0', `${r.nan}, ${r.asymetrie}`, '0, 0', false);
    const szer = Math.max(...row.map((w) => w.nazwa.length));
    const linie = [`adapter ${JSON.stringify(adapter)}`, `format: zaliczone | wielkość | Node | GPU | próg`, ...row.map((w) => `${w.ok.padEnd(5)} ${w.nazwa.padEnd(szer)} | ${w.node} | ${w.gpu} | ${w.prog}`)];
    const porazka2 = [];
    if (przechylS1 !== null && przechylS1 > 15) porazka2.push(`przechył S1 ${przechylS1.toFixed(1)}° > 15°`);
    if (pP !== null && pP > 0.5) porazka2.push(`|P|/N ${pP.toFixed(3)} > 0,5`);
    if (otwor !== null && otwor > 6) porazka2.push(`otwór ${otwor.toFixed(2)} > 6`);
    linie.push(porazka2.length ? `WARUNEK PORAŻKI 2 Z § 12: ${porazka2.join('; ')}` : 'Warunek porażki 2 z § 12 niespełniony (dotyczy zmierzonych tu scen).');
    for (const l of linie) console.log(l);
    writeFileSync(join(wyDir, 'tabela-P2.txt'), linie.join('\n') + '\n');
    if (wy.S3) {
      const sc = await ev('window.__wok.test.sciana("S3")');
      linie.push(`Ściana S3 bez odczytów: ${sc.N} kroków w ${f(sc.ms, 0)} ms, ${f(sc.msNaKrok, 3)} ms/krok razem z kolejką (P1, W1: 0,446).`);
      console.log(linie.at(-1));
      writeFileSync(join(wyDir, 'tabela-P2.txt'), linie.join('\n') + '\n');
    }
    raport.testy.sceny = { tabela: row, porazka2 };
    for (const w of row) if (w.ok === 'NIE') porazka(`tabela § 8: ${w.nazwa}: ${w.gpu} (próg ${w.prog})`);
    zapiszRaport();
  }

  if (TESTY.includes('strzal')) {
    await czekajNaCisze('strzał');
    const r = await ev('window.__wok.test.strzal()');
    const op = (x) => `żywe ${x.zywe}, |P|/N ${f(x.P, 4)}, v przy trafieniu ${f(x.vBlisko, 2)} (${x.nBlisko}), v daleko ${f(x.vDaleko, 3)} (${x.nDaleko})`;
    for (const k of ['przed', 'pudlo', 'klatka1', 'klatka31', 'koniec', 'planBez', 'planZeStrzalem']) console.log(`strzał ${k}: ${op(r[k])}`);
    console.log(`strzał: największy kawałek ${f(r.kawalek * 100, 1)}%, v ${r.vKawalka.map((q) => f(q, 3)).join(', ')}, obrót ${f(r.obrotKawalka, 3)}°/s, błędy GPU ${r.bledyGpu}`);
    const ok = r.pudlo.zywe === r.przed.zywe && r.klatka1.zywe < r.pudlo.zywe && r.klatka1.vBlisko > 1 && r.klatka1.vDaleko < 0.5 && r.koniec.P <= 0.05 && r.planZeStrzalem.vBlisko > r.planBez.vBlisko && r.planZeStrzalem.fK === r.planBez.fK;
    console.log(`strzał ${ok ? 'ZALICZONY' : 'NIE'}: pudło nic nie rusza, ruch zaczyna się przy trafionym, |P|/N ≤ 0,05, kop w czasie planu pchnięć`);
    if (!ok) porazka('strzał w próżni');
    raport.testy.strzal = r;
    writeFileSync(join(wyDir, 'strzal.json'), JSON.stringify({ adapter, ...r }, null, 1) + '\n');
    zapiszRaport();
  }

  if (TESTY.includes('kratery')) {
    await czekajNaCisze('wiele kraterów');
    const r = await ev('window.__wok.test.wieleKraterow()');
    for (const id of ['S4', 'S4g']) {
      const q = r[id];
      console.log(`${q.zaliczony ? 'OK ' : 'ŹLE'} wiele kraterów ${id}, ${q.klatek} klatek, wykonane rzędy ${q.wykonane}: usunięte GPU ${q.usunieteGpu}, różne żywe ${q.aktRozne}, różne maski ${q.maski} z ${q.zywe}, |Δv| p99 ${f(q.dvP99, 3)} maks ${f(q.dvMax, 2)}, dx maks ${f(q.dxMax, 3)}, vMax ${f(q.vMax, 1)}, |P|/N GPU ${f(q.P, 4)} Node ${f(q.PNode, 4)}, NaN ${q.nan}, asym ${q.asym}`);
      if (!q.zaliczony) porazka(`wiele kraterów ${id}`);
    }
    raport.testy.kratery = r;
    zapiszRaport();
  }

  if (TESTY.includes('lod')) {
    // Próba 1 planu LOD: --testy lod --lody dx:materiał[:budynek],… [--lodW1 60] [--lodNakladka '{"…":…}'] [--plikLod nazwa.txt]. Budynek z tabeli niżej, bez niego wieża S1.
    // Odniesienie dx = 20 z pomiaru przy tej samej stronie, bez zmian w scenach. Strona testu nie ma pętli rAF, a kroki małych scen są krótkie, więc GPU pracuje ułamek czasu ściany.
    const UKL = { gruboscStropu: 2, pietroCo: 5, kolumny: { co: 6, dol: 4, gora: 2 }, fasada: { co: 3, grubosc: 1 }, rdzen: { grubosc: 1 } }; // układ wieży przy dx = 20 w komórkach
    const BUDYNKI = {
      pol: { w: 190, d: 210, h: 670, ...UKL },
      cwierc: { w: 95, d: 105, h: 335, ...UKL },
      osma: { w: 47.5, d: 52.5, h: 167.5, ...UKL },
      // Te same komórki co wieża, s = skala budynku: Froude ma dać ten sam przebieg √s razy szybciej.
      polF: { w: 190, d: 210, h: 670, s: 0.5, ...UKL },
      osmaF: { w: 47.5, d: 52.5, h: 167.5, s: 0.125, ...UKL },
      // Budynki miasta (haloRingCity.js, miasto.js): kostka i wydmuszka, s z wysokości.
      k37: { kostka: true, w: 33.6, d: 42.5, h: 37, s: 37 / 1340 },
      k154: { kostka: true, w: 33.6, d: 42.5, h: 154, s: 154 / 1340 },
      k290: { kostka: true, w: 33.6, d: 42.5, h: 290, s: 290 / 1340 },
      w154: { kostka: true, wydmuszka: true, w: 33.6, d: 42.5, h: 154, s: 154 / 1340 },
      w290: { kostka: true, wydmuszka: true, w: 33.6, d: 42.5, h: 290, s: 290 / 1340 },
      w37: { kostka: true, wydmuszka: true, w: 33.6, d: 42.5, h: 37, s: 37 / 1340 },
      w70: { kostka: true, wydmuszka: true, w: 33.6, d: 42.5, h: 70, s: 70 / 1340 },
      // Te same kostki bez skali budynku: ziarna i długości jak w wieży.
      k154b: { kostka: true, w: 33.6, d: 42.5, h: 154 },
      ...(args.lodBudynki ? JSON.parse(String(args.lodBudynki)) : {}),
    };
    const nakladka = args.lodNakladka ? JSON.parse(String(args.lodNakladka)) : null;
    const lista = String(args.lody || '20:staly,40:staly,40:dx,80:staly,80:dx').split(',').filter(Boolean);
    const linie = [`adapter ${JSON.stringify(adapter)}`, `nakładka ${JSON.stringify(nakladka)}`, 'dx mat budynek | n, nx×ny×nz, c, K, podkroki, rytm, h√(12K) | dach t = 3…7 | przechył spójny, maks | masa % 1 / 2–7 / 8–63 / 64–511 / 512+ | bok kawałka j. | przed cięciem | NaN, asym | ms na krok stoi, wali | ns na węzeł i krok'];
    const wy = [];
    const pisz = (l) => { linie.push(l); console.log(l); };
    for (const pozycja of lista) {
      const [dxS, mat, bud] = pozycja.split(':');
      const dx = Number(dxS);
      await czekajNaCisze(`LOD ${pozycja}`);
      // r<h>: budynek miasta w układzie ukladMiasta (scena.js), s z wysokości albo jedno na scenę z --lodS.
      if (bud?.startsWith('r')) {
        const hb = Number(bud.slice(1));
        BUDYNKI[bud] = { miasto: true, w: 33.6, d: 42.5, h: hb, s: (args.lodS ? Number(args.lodS) : hb / 1340) };
      }
      if (bud && !BUDYNKI[bud]) throw new Error(`Nieznany budynek ${bud}: bez tego poszłaby pełna wieża przy tym dx`);
      const bd = bud ? BUDYNKI[bud] : null;
      const nak = { ...(nakladka ?? {}), ...(bd?.s ? { skalaBud: bd.s } : {}) };
      const op = { dx, mat, ...(bd ? { wieza: bd } : {}), ...(Object.keys(nak).length ? { nakladka: nak } : {}) };
      const r = await ev(`window.__wok.test.lod.s1(${JSON.stringify(op)})`);
      r.pozycja = pozycja;
      wy.push(r);
      if (r.poza) { pisz(`${pozycja}: poza zakresem, ${r.poza}`); continue; }
      const d = (t) => (r.dach[t] ?? NaN).toFixed(0);
      const q = (x, c = 1) => (x === null || x === undefined ? 'b.d.' : Number(x).toFixed(c));
      pisz(`${pozycja} | ${r.n}, ${r.meta.nx}×${r.meta.ny}×${r.meta.nz} (${q(r.meta.w, 0)}×${q(r.meta.d, 0)}×${q(r.meta.h, 0)}), c ${q(r.c, 0)}, K ${q(r.K, 0)}, pk ${r.podkroki}, rytm ${r.rytm}, stab ${q(r.stabilnosc, 2)} | ${[0, 3, 4, 5, 6, 7, 9].map(d).join(' ')} | d/h t* .5,1,2,3,4,5: ${r.dachNorm.map((v) => q(v, 2)).join(' ')} | prz30 ${q(r.przechylStaly)}°@${q(r.tStaly, 2)}, 1,5dx ${q(r.przechylSpojny)}°, maks ${q(r.przechylMax)}° | ${r.masa.map((v) => q(v, 0)).join('/')} (najw. ${r.najwiekszy}, wysp ${r.wysp}) | ${q(r.bokKawalka, 0)} j. | przem ${q(r.W1przed.przem, 3)}, opad ${q(r.W1przed.opad, 3)}, bity ${r.W1przed.zerwaneBity} | NaN ${r.nan}, asym ${r.asym}, GPU ${r.bledyGpu} | ${q(r.msStoi, 3)}, ${q(r.msWali, 3)} | ${q(r.nsNaWezelKrok, 0)} | budowa ${q(r.msBudowy / 1000, 1)} s, CG ${r.kalibracja.iter}, uMax ${q(r.kalibracja.maxU, 2)}, odk ${q(r.kalibracja.odk, 3)}`);
      writeFileSync(join(wyDir, `lod-${pozycja.replaceAll(':', '_')}${args.plikLod ? `-${args.plikLod}` : ''}.json`), JSON.stringify({ adapter, ...r }, null, 1) + '\n');
      if (args.lodW1) {
        const s = await ev(`window.__wok.test.lod.w1(${JSON.stringify({ ...op, sekund: Number(args.lodW1) })})`);
        s.pozycja = pozycja;
        r.W1 = s;
        pisz(`   W1 ${s.zaliczony ? 'stoi' : 'NIE'}, ${s.sekund} s: przemieszczenie ${q(s.maxPrzem, 4)} j., vMax ${q(s.vMax, 4)}, zerwane bity ${s.zerwaneBity}, inne maski ${s.wezlyZInnaMaska}, S maks ${q(s.sMax, 4)}, NaN ${s.nan}, ${q(s.msSciany / 1000, 1)} s ściany`);
      }
    }
    writeFileSync(join(wyDir, `lod-liczby${args.plikLod ? `-${args.plikLod}` : ''}.txt`), linie.join('\n') + '\n');
    raport.testy.lod = wy;
    zapiszRaport();
  }

  if (TESTY.includes('s5')) {
    // S5 na GPU (§ 5.5): --testy s5 [--ziarna 21,7] [--miejsca g,proznia,planeta] [--opcje '{"J":250}']: liczby K1–K6 z tabeli § 8 propozycji, progi wprost. Bieg jest krótki, 840 kroków poniżej sekundy.
    const ziarna = String(args.ziarna || '21,7').split(',').map(Number);
    const miejsca = String(args.miejsca || 'g,proznia,planeta').split(',');
    const opcje = args.opcje ? JSON.parse(String(args.opcje)) : {};
    const wy = [];
    const linie = [`adapter ${JSON.stringify(adapter)}`, `opcje ${JSON.stringify(opcje)}`];
    const pisz = (l) => { linie.push(l); console.log(l); };
    for (const ziarno of ziarna) for (const miejsce of miejsca) {
      await czekajNaCisze(`S5 ${miejsce} ziarno ${ziarno}`);
      const t0 = Date.now();
      const r = await ev(`window.__wok.test.s5(${JSON.stringify({ miejsce, ziarno, opcje })})`);
      wy.push(r);
      const { K1: k1, K2: k2, K3: k3, K4: k4, K5: k5, K6: k6, K7: k7 } = r;
      const ot = k1.otwor ?? {};
      const zapas = [];
      const ok1 = k1.thStyk >= 20 && (ot.stosunek ?? 0) >= 1.5;
      pisz(`== S5 ${miejsce} ziarno ${ziarno}: ${r.n} węzłów, t = ${r.t}, ${f(r.msNaKrok, 3)} ms/krok z kolejką, ${r.odczytow} odczytów, ${((Date.now() - t0) / 1000).toFixed(1)} s razem`);
      pisz(`K1 ${ok1 ? 'OK ' : 'NIE'} kąt ${k1.th0}° → ${k1.thStyk}° przy styku t = ${k1.tStyk}; otwór przy przejściu szczytu t = ${f(ot.t, 2)}: oś ${f(ot.stosunek, 2)}, dł ${f(ot.dl, 0)}, szer ${f(ot.szer, 0)}; przed 1. eksplozją ${f(k1.otworPrzed?.stosunek, 2)}; t = 3,6: ${f(k1.otwor36?.stosunek, 2)}`);
      if (!ok1) zapas.push('K1');
      if (miejsce !== 'proznia') {
        const ok2 = k2.najw <= 0.2 && k2.b64 >= 0.4 && k2.b1_7 <= 0.35 && k2.kotwice <= 0.03;
        pisz(`K2 ${ok2 ? 'OK ' : 'NIE'} t = ${r.t}: największy ${k2.najw}, 64+ ${k2.b64} (${k2.ile64} szt.), 8–63 ${k2.b8_63}, 1–7 ${k2.b1_7}, usunięte ${k2.usuniete}, kotwice ${k2.kotwice}; czystość ${k2.czystosc}`);
        if (!ok2) zapas.push('K2');
        const ok3 = k3.pod500 >= 0.9 && k3.przyGruncie >= 0.8 && k3.tWiezaGrunt > 0 && (k3.tDuzyGrunt < 0 || k3.tWiezaGrunt <= k3.tDuzyGrunt);
        pisz(`K3 ${ok3 ? 'OK ' : 'NIE'} pod 500 ${k3.pod500}, przy gruncie ${k3.przyGruncie}, wieża przy gruncie ${k3.wiezaPrzyGruncie}; wieża t = ${k3.tWiezaGrunt}, 1. węzeł dysku t = ${k3.tDyskGrunt}, 64+ t = ${k3.tDuzyGrunt} (${k3.rozDuzy}), 512+ t = ${k3.tDuzy512} (${k3.roz512}), wieża wtedy na gruncie ${k3.wiezaPrzy512}`);
        if (!ok3) zapas.push('K3');
      } else {
        const ok4 = k4.maxDPnaN <= 0.5 && k4.medKawalekMasa >= 5 && k4.medKawalekMasa <= 80 && k4.maxKawalek8 <= 400 && k2.najw <= 0.35;
        pisz(`K4 ${ok4 ? 'OK ' : 'NIE'} t ≥ 10: ΔP/N maks ${k4.maxDPnaN} (koniec ${k4.dPnaN}), środek masy ${k4.maxOdchCom}, mediana po masie ${k4.medKawalekMasa}, bez wag ${k4.medKawalekBezwag}, po węzłach ${k4.medWezel}, maks 8+ ${k4.maxKawalek8}, największy ${k2.najw}, 64+ ${k2.b64} (${k2.ile64} szt.), 1–7 ${k2.b1_7}; czystość ${k2.czystosc}, odcinek wieży ${f(k7.drabina.rozpietosc, 2)}`);
        if (!ok4) zapas.push('K4');
      }
      const ok5 = k5.nan === 0 && k5.bledyGpu === 0;
      pisz(`K5 ${ok5 ? 'OK ' : 'NIE'} NaN ${k5.nan}, asymetrie ${k5.asym}, błędy GPU ${k5.bledyGpu}`);
      if (!ok5) zapas.push('K5');
      const ok6 = k6.eksplozjePlan <= 40 && k6.maxNaKlatke <= 4 && k6.pominietePchniecia === 0;
      pisz(`K6 ${ok6 ? 'OK ' : 'NIE'} plan ${k6.eksplozjePlan}, wykonane ${k6.wykonane}, na klatkę ${k6.maxNaKlatke}, pchnięć równocześnie ${k6.maxRownoczesnie}, pominięte pchnięcia ${k6.pominietePchniecia}, t ${k6.tPierwsza}..${k6.tOstatnia}${k6.puscKotwiceF >= 0 ? `, kotwice puszczają f = ${k6.puscKotwiceF}` : ''}`);
      if (!ok6) zapas.push('K6');
      pisz(`przebieg: ${r.hist.map((h) => `t=${h.t}: ${h.najw}/${h.b64}/${h.b1_7}/${h.ile64}/${h.pod500}/${h.medMasa}`).join('  ')} (największy/64+/1–7/ile 64+/pod 500/mediana prędkości po masie)`);
      if (zapas.length && !args.bezProgow) porazka(`S5 ${miejsce} ziarno ${ziarno}: ${zapas.join(', ')}`);
    }
    const plikS5 = resolve(repo, String(args.plikS5 || join(wyDir, 'S5-liczby.txt')));
    writeFileSync(plikS5, linie.join('\n') + '\n');
    raport.testy.s5 = wy;
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
  if (kod !== 4 && !e?.zrzutyKoniec) { raport.blad = String(e?.stack || e); porazka(`harness: ${raport.blad}`); }
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
