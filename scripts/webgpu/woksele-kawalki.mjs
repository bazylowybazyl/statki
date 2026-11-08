// Harness demo A/B obrazu kawałków (docs/RAPORT-kawalki-zawalen.md) w headless Chrome, na własnym Vite, priorytet BelowNormal.
// Kadry: każda scena, chwile, kamery (ukos, z góry, zbliżenie) i tryby obrazu. Woksele i kawałki z tego samego stanu fizyki (przełączenie w biegu),
// kawałki ze zbrojeniem z osobnego przebiegu (inna fizyka). Koszt GPU (compute + rysunek) na tej samej chwili: strona bez ?kawalki (dzisiejszy obraz)
// i strona z ?kawalki w trybach 1 i 2. Pipeline'y synchroniczne po rozgrzewce: mają być 0. Na końcu arkusz kadrów (arkusz.png) i raport.json.
//
//   node scripts/webgpu/woksele-kawalki.mjs [--sceny S1,S5] [--plan "S1:3,5,7;S5:2,4,7"] [--kamery ukos,gora,blisko] [--tryby 0,1,2] [--koszt 1] [--rozmiar 1280x720]
//        [--out .tmp/woksele-demo/KAW/a] [--kawOp '{"drganie":0.3}'] [--zbrojenie '{"gestosc":0.4}'] [--port 5431]
// Gra użytkownika w toku (League, RuneScape, Gothic): czeka co 30 s, najwyżej 30 min. Karta inna niż NVIDIA: odmowa (kod 4).
import os from 'node:os';
os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, screenshotPng } from './wspolne.mjs';

const args = parseArgs();
const SCENY = String(args.sceny || 'S1,S5').split(',');
const PLAN = new Map(String(args.plan || 'S1:3,4.5,6,8;S5:1.5,3,5,8').split(';').map((w) => { const [s, c] = w.split(':'); return [s, c.split(',').map(Number)]; }));
const KAMERY = String(args.kamery || "ukos,gora,blisko,druty").split(',');
const TRYBY = String(args.tryby || '0,1,2').split(',').map(Number);
const KOSZT = args.koszt !== '0';
const wyDir = resolve(repo, args.out || '.tmp/woksele-demo/KAW/a');
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
mkdirSync(wyDir, { recursive: true });
const NAZWA_TRYBU = ['woksele', 'kawalki', 'zbrojenie'];

// Kamery sceny: az, el, cel, odl (jak ustawKamere w pokaz.js). „gora” jak w misji 1 (prawie pionowo z góry), „blisko” na zbrojenie przy przełomie.
const KAM = {
  S1: { ukos: { az: 32, el: 8, cel: [0, 0, 620], odl: 3300 }, gora: { az: 20, el: 82, cel: [60, 0, 200], odl: 2600 }, blisko: { az: 58, el: 10, cel: [120, -40, 260], odl: 1100 }, druty: { az: 58, el: 14, cel: [100, -60, 190], odl: 520 } },
  S5: { ukos: { az: 32, el: 15, cel: [0, 0, -650], odl: 7200 }, gora: { az: 10, el: 84, cel: [0, 0, -700], odl: 6200 }, blisko: { az: 40, el: 18, cel: [150, 250, -250], odl: 2300 }, druty: { az: 40, el: 22, cel: [80, 120, -120], odl: 900 } },
};

const raport = { start: new Date().toISOString(), adapter: null, sceny: {}, koszt: {}, pipeline: {}, bledy: [] };
const zapisz = () => writeFileSync(join(wyDir, 'raport.json'), JSON.stringify(raport, null, 1) + '\n');

const GRY = /^(League of Legends|LeagueClient|RuneScape.*|.*Dragonwilds.*|RSDragon.*|osclient.*|G1R-Win64-Shipping)$/i;
const powershell = (cmd) => new Promise((ok) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { maxBuffer: 16 << 20, windowsHide: true, timeout: 60000 }, (err, out) => ok(err ? null : String(out || ''))));
async function czekajNaCisze(gdzie) {
  const t0 = Date.now();
  for (;;) {
    const out = await powershell('Get-Process | ForEach-Object { $_.ProcessName } | Sort-Object -Unique');
    const gry = out === null ? ['odpytanie listy procesów nieudane'] : out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && GRY.test(s));
    if (!gry.length) return;
    if (Date.now() - t0 > 30 * 60000) { console.error(`PRZERWANE: gra ${gry.join(', ')} ponad 30 min, przed ${gdzie}`); process.exit(3); }
    console.log(`gra w toku (${gry.join(', ')}), czekam przed: ${gdzie}`);
    await sleep(30000);
  }
}
function zlaKarta(a) {
  const opis = `${a?.vendor ?? ''} ${a?.architecture ?? ''} ${a?.description ?? ''}`.toLowerCase();
  if (!a || !opis.trim()) return 'brak adapter.info';
  if (/swiftshader|llvmpipe|microsoft basic|software/.test(opis) || a.isFallbackAdapter) return `rasteryzator programowy: ${opis}`;
  if (!/nvidia/.test(opis)) return `karta inna niż NVIDIA: ${opis}`;
  return null;
}
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'b.d.');

await czekajNaCisze('start');
const { server, base } = await startVite(Number(args.port || 5431));
const [W, H] = String(args.rozmiar || '1280x720').split('x').map(Number);
const chrome = await startChrome({ width: W, height: H, takt: args.noc === '1', extraArgs: ['--enable-webgpu-developer-features'] }); // --noc 1: takt monitora, bez flag zdejmujących limit klatek
const logi = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 1800000) => evaluate(cdp, e, t);
let kod = 0;

async function otworz(zapytanie) {
  await cdp.send('Page.navigate', { url: `${base}/dema/woksele-zawalenia.html?${zapytanie}` });
  await waitFor(cdp, '!!(window.__harness && ((window.__harness.clock.mode = "real") === "real"))', 60000, 20);
  if (!await waitFor(cdp, '!!(window.__wok && (window.__wok.adapter || window.__wok.blad))', 120000, 100)) throw new Error('strona nie wstała');
  const adapter = await ev('window.__wok.adapter');
  raport.adapter = adapter;
  const zla = zlaKarta(adapter);
  if (zla) { kod = 4; throw new Error(`ODMOWA: ${zla}`); }
  if (!await waitFor(cdp, '!!(window.__wok && (window.__wok.gotowe || window.__wok.blad))', 300000, 100)) throw new Error('strona nie wstała (300 s)');
  const blad = await ev('window.__wok.blad');
  if (blad) throw new Error(`strona: ${blad}`);
  await ev('window.__wok.pokaz.panel(false); true');
  return { pipeStart: await ev('window.__harness.pipes.list.length'), syncStart: await ev('window.__harness.pipes.list.filter((p) => p.sync).length') };
}
const pipeline = async (etykieta, start) => {
  const nowe = await ev(`window.__harness.pipes.list.slice(${start.pipeStart}).map((p) => ({ nazwa: p.nazwa, sync: !!p.sync }))`);
  const sync = nowe.filter((p) => p.sync);
  raport.pipeline[etykieta] = { poRozgrzewce: nowe.length, synchroniczne: sync.length, syncNazwy: sync.map((p) => p.nazwa).slice(0, 20), syncWRozgrzewce: start.syncStart };
  console.log(`pipeline'y ${etykieta}: nowe po rozgrzewce ${nowe.length}, synchroniczne ${sync.length}${sync.length ? ' ' + JSON.stringify(sync.map((p) => p.nazwa).slice(0, 6)) : ''}`);
  if (sync.length) kod = 1;
};
const kadr = async (plik) => { await ev('window.__wok.pokaz.przerysuj()'); await screenshotPng(cdp, join(wyDir, plik)); return plik; };

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  const zap = new URLSearchParams({ kawalki: '1', scena: SCENY[0], maksKl: '60', tryb: '1' });
  if (args.kawOp) zap.set('kawOp', String(args.kawOp));
  if (args.zbrojenie) zap.set('zbrojenie', String(args.zbrojenie));
  if (args.kruchosc) zap.set('kruchosc', String(args.kruchosc)); // przełącznik kruchości betonu (kawalki.js, KRUCHOSC)
  if (args.sztywnosc) zap.set('sztywnosc', String(args.sztywnosc)); // sztywność betonu (budowa.js, par.sztywnosc)
  const start = await otworz(zap.toString());
  console.log('adapter', JSON.stringify(raport.adapter));
  for (const sc of SCENY) {
    await czekajNaCisze(`scena ${sc}`);
    const r = raport.sceny[sc] = { kadry: [], kawalki: {} };
    await ev(`window.__wok.pokaz.wejdz(${JSON.stringify(sc)}, { pomin: false }).then(() => null)`);
    // Woksele i kawałki z jednego przebiegu: ta sama fizyka, przełączenie obrazu w zatrzymanej chwili.
    const tryby01 = TRYBY.filter((t) => t < 2);
    for (const przebieg of [tryby01, TRYBY.includes(2) ? [2] : []]) {
      if (!przebieg.length) continue;
      await ev(`window.__wok.pokaz.tryb(${przebieg[przebieg.length - 1]}); true`);
      await ev(`window.__wok.pokaz.ustawScene(${JSON.stringify(sc)}, { kamera: false, pomin: false }); true`);
      for (const t of PLAN.get(sc)) {
        await ev(`window.__wok.pokaz.doChwili(${t})`);
        for (const tr of przebieg) {
          if (przebieg.length > 1) await ev(`window.__wok.pokaz.tryb(${tr}); true`);
          for (const kam of KAMERY) {
            await ev(`window.__wok.pokaz.kamera(${JSON.stringify(KAM[sc][kam])}); true`);
            const plik = await kadr(`${sc}_t${t.toFixed(1)}_${kam}_${NAZWA_TRYBU[tr]}.png`);
            r.kadry.push({ t, kam, tryb: tr, plik });
          }
        }
        const st = await ev('window.__wok.pokaz.statKawalki()');
        if (st) {
          (r.kawalki[NAZWA_TRYBU[przebieg[przebieg.length - 1]]] ??= []).push({ t, peklo: st.peklo, przyczyny: st.przyczyny, wezly: st.wezly, K0: st.K0, K1: st.K1, prety: st.prety });
          r.stat = st.stat;
          console.log(`${sc} t = ${t} ${przebieg.map((x) => NAZWA_TRYBU[x]).join('+')}: pękło L0 ${st.peklo[0]}/${st.K0} (węzeł/wiązanie/odkształcenie ${st.przyczyny[0].join('/')}), L1 ${st.peklo[1]}/${st.K1} (${st.przyczyny[1].join('/')}), węzły na poziomach ${st.wezly.join(' / ')}, prętów ${st.prety}`);
        }
        zapisz();
      }
    }
    if (KOSZT) {
      // Koszt na chwili w środku zawalenia, przy kamerze z ukosa. Kolejno: woksele i kawałki (ta sama fizyka), kawałki ze zbrojeniem.
      const tK = PLAN.get(sc)[Math.min(2, PLAN.get(sc).length - 1)];
      const k = raport.koszt[sc] = { t: tK };
      for (const tr of [1, 2]) {
        await ev(`window.__wok.pokaz.tryb(${tr}); true`);
        await ev(`window.__wok.pokaz.ustawScene(${JSON.stringify(sc)}, { kamera: false, pomin: false }); true`);
        await ev(`window.__wok.pokaz.doChwili(${tK})`);
        await ev(`window.__wok.pokaz.kamera(${JSON.stringify(KAM[sc].ukos)}); true`);
        const trybyPom = tr === 1 ? [0, 1] : [2];
        for (const tp of trybyPom) {
          await ev(`window.__wok.pokaz.tryb(${tp}); true`);
          await ev(`window.__wok.pokaz.doChwili(${tK})`);
          const wyn = await ev('window.__wok.pokaz.kosztKlatki(16, 15)');
          // Rysunek z passem cienia (kosztLod czeka na klatkę rAF, więc mapa cienia się odświeża) i kernele obrazu (z kawałkami).
          const lod = await ev('(async () => { const l = window.__wok.obraz.lod; return window.__wok.pokaz.kosztLod([[l.sloty, l.cien]], 11); })()');
          wyn.passy = lod.wy[0];
          wyn.kerneleObrazuMs = lod.kerneleObrazuMs;
          k[`${NAZWA_TRYBU[tp]}_strona_kawalki`] = wyn;
          console.log(`koszt ${sc} t = ${tK} ${NAZWA_TRYBU[tp]} (strona ?kawalki): krok + kernele ${f(wyn.computeGpuMs)} ms (same kernele obrazu ${f(lod.kerneleObrazuMs)}), rysunek z cieniem ${f(lod.wy[0].razem)} ms = scena ${f(lod.wy[0].hdr)} + cień ${f(lod.wy[0].cien)} + głębia ${f(lod.wy[0].gleb)} + reszta, ściana ${f(wyn.scianaMs)} ms`);
        }
      }
      zapisz();
    }
  }
  await pipeline('kawalki', start);
  if (KOSZT) {
    // Dzisiejszy obraz bez infrastruktury kawałków: strona bez ?kawalki, te same chwile.
    const startB = await otworz(new URLSearchParams({ scena: SCENY[0], maksKl: '60' }).toString());
    for (const sc of SCENY) {
      await czekajNaCisze(`koszt bazy ${sc}`);
      const tK = raport.koszt[sc].t;
      await ev(`window.__wok.pokaz.wejdz(${JSON.stringify(sc)}, { pomin: false }).then(() => null)`);
      await ev(`window.__wok.pokaz.doChwili(${tK})`);
      await ev(`window.__wok.pokaz.kamera(${JSON.stringify(KAM[sc].ukos)}); true`);
      // Kadr przed pomiarem: kosztKlatki robi kroki, więc po nim scena jest około 0,5 s dalej.
      await kadr(`${sc}_t${tK.toFixed(1)}_ukos_dzisiaj.png`);
      const wyn = await ev('window.__wok.pokaz.kosztKlatki(16, 15)');
      const lod = await ev('(async () => { const l = window.__wok.obraz.lod; return window.__wok.pokaz.kosztLod([[l.sloty, l.cien]], 11); })()');
      wyn.passy = lod.wy[0];
      wyn.kerneleObrazuMs = lod.kerneleObrazuMs;
      raport.koszt[sc].woksele_strona_dzisiejsza = wyn;
      console.log(`koszt ${sc} t = ${tK} dzisiejszy obraz (strona bez ?kawalki): krok + kernele ${f(wyn.computeGpuMs)} ms (same kernele obrazu ${f(lod.kerneleObrazuMs)}), rysunek z cieniem ${f(lod.wy[0].razem)} ms = scena ${f(lod.wy[0].hdr)} + cień ${f(lod.wy[0].cien)} + głębia ${f(lod.wy[0].gleb)} + reszta, ściana ${f(wyn.scianaMs)} ms`);
    }
    await pipeline('dzisiejsza', startB);
  }
  // Arkusze: jeden na scenę i kamerę (wiersz: chwila, kolumny: tryby obrazu).
  const rel = relative(repo, wyDir).replace(/\\/g, '/');
  const SZ = Math.round(W * 0.42);
  for (const sc of SCENY) for (const kam of KAMERY) {
    const wiersze = PLAN.get(sc).map((t) => ({ et: `t = ${t} s`, kom: TRYBY.map((tr) => raport.sceny[sc].kadry.find((x) => x.t === t && x.kam === kam && x.tryb === tr)?.plik ?? null) }));
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0b0d10;color:#c9d1d9;font:15px system-ui}table{border-collapse:collapse}td,th{padding:3px}img{width:${SZ}px;display:block}th{font-weight:600;text-align:left}</style>
<table><tr><th>${sc}, ${kam}</th>${TRYBY.map((t) => `<th>${['Woksele (dziś)', 'Kawałki', 'Kawałki + zbrojenie'][t]}</th>`).join('')}</tr>
${wiersze.map((w) => `<tr><th>${w.et}</th>${w.kom.map((p) => `<td>${p ? `<img src="/${rel}/${p}">` : ''}</td>`).join('')}</tr>`).join('\n')}</table>`;
    const nazwa = `arkusz_${sc}_${kam}`;
    writeFileSync(join(wyDir, `${nazwa}.html`), html);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: SZ * TRYBY.length + 110, height: Math.round(wiersze.length * (H * 0.42 + 6) + 34), deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${base}/${rel}/${nazwa}.html` });
    await sleep(1500);
    await screenshotPng(cdp, join(wyDir, `${nazwa}.png`));
  }
} catch (e) {
  raport.bledy.push(String(e?.stack || e));
  console.error(e);
  if (!kod) kod = 1;
} finally {
  raport.koniec = new Date().toISOString();
  raport.logi = logi.errors().slice(0, 50);
  zapisz();
  await chrome.close().catch(() => {});
  await server.close().catch(() => {});
}
console.log(`raport: ${join(wyDir, 'raport.json')}`);
process.exit(kod);
