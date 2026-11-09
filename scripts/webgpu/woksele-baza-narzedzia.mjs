// Sprawdzenie dema bazy piratów z narzędziami (dema/baza-piratow-kawalki.html, scena B1R, ?kawalki=1) w headless Chrome, priorytet BelowNormal.
// Ten sam scenariusz w trybie Woksele i Kawałki (ta sama fizyka, przełączenie w zatrzymanej chwili): działo w wieżowce i habitat, ciężkie działo w W-2, taran przez habitat,
// upadek jak przy HP 0. Kadry z góry jak w misji 1 i z bliska, stan kawałków, pipeline'y synchroniczne po rozgrzewce (ma być 0), błędy konsoli.
//
//   node scripts/webgpu/woksele-baza-narzedzia.mjs [--out .tmp/woksele-demo/KAW/baza] [--rozmiar 1280x720] [--port 5432] [--zbrojenie 1]
//        [--kruchosc 0|1|2] [--baza '{"giecieSzyi":8}'] [--scenariusz szyja]
// --scenariusz szyja: dwa kratery z boku u podstawy szyi (z ≈ 300), głowa przechyla się. Kadry z boku: czy szyja gnie się jak guma, czy pęka (zgłoszenie 2026-11-08).
// --scenariusz klin: klin kraterami od +y u podstawy szyi, przesunięcie środka głowy w bok i w dół (czy wieża przewraca się jak wieżowiec, 2026-11-09).
import os from 'node:os';
os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, screenshotPng } from './wspolne.mjs';

const args = parseArgs();
const wyDir = resolve(repo, args.out || '.tmp/woksele-demo/KAW/baza');
mkdirSync(wyDir, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const raport = { start: new Date().toISOString(), kadry: [], stan: [], bledy: [] };
const zapisz = () => writeFileSync(join(wyDir, 'raport.json'), JSON.stringify(raport, null, 1) + '\n');

const GRY = /^(League of Legends|LeagueClient|RuneScape.*|.*Dragonwilds.*|RSDragon.*|osclient.*|G1R-Win64-Shipping)$/i;
const ps = () => new Promise((ok) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process | ForEach-Object { $_.ProcessName } | Sort-Object -Unique'], { windowsHide: true, timeout: 60000 }, (e, o) => ok(e ? null : String(o))));
for (let t0 = Date.now(); ;) {
  const out = await ps();
  const gry = out === null ? ['?'] : out.split(/\r?\n/).filter((s) => GRY.test(s.trim()));
  if (!gry.length) break;
  if (Date.now() - t0 > 30 * 60000) { console.error('PRZERWANE: gra użytkownika ponad 30 min'); process.exit(3); }
  console.log(`gra w toku (${gry.join(', ')}), czekam`);
  await sleep(30000);
}

const { server, base } = await startVite(Number(args.port || 5432));
const [W, H] = String(args.rozmiar || '1280x720').split('x').map(Number);
const chrome = await startChrome({ width: W, height: H, takt: args.noc === '1', extraArgs: ['--enable-webgpu-developer-features'] }); // --noc 1: takt monitora, bez flag zdejmujących limit klatek
const logi = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 1800000) => evaluate(cdp, e, t);
let kod = 0;

// Kamery bazy: z góry jak w misji 1 (pokaz.js, bGra) i z ukosa przy habitacie.
const UKOS = { az: 25, el: 28, cel: [0, 0, 200], odl: 5200 };
const Z_GORY = { az: 0, el: 88, cel: [1200, 200, 0], odl: 9800 };

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  const zap = `kawalki=1&scena=B1R&maxWez=90000&nKom=131072&maksKl=60&tryb=${args.zbrojenie ? 2 : 1}${args.kruchosc !== undefined ? `&kruchosc=${args.kruchosc}` : ''}${args.sztywnosc ? `&sztywnosc=${args.sztywnosc}` : ''}${args.baza ? `&baza=${encodeURIComponent(String(args.baza))}` : ''}${args.zap ? `&${args.zap}` : ''}`; // --zap 'limityF0=0&jakWGrze=0': dodatkowe pola adresu do A/B
  await cdp.send('Page.navigate', { url: `${base}/dema/woksele-zawalenia.html?${zap}` });
  await waitFor(cdp, '!!(window.__harness && ((window.__harness.clock.mode = "real") === "real"))', 60000, 20);
  if (!await waitFor(cdp, '!!(window.__wok && (window.__wok.gotowe || window.__wok.blad))', 600000, 200)) throw new Error('strona nie wstała');
  const blad = await ev('window.__wok.blad');
  if (blad) throw new Error(blad);
  const adapter = await ev('window.__wok.adapter');
  if (!/nvidia/i.test(`${adapter?.vendor} ${adapter?.description}`)) { kod = 4; throw new Error(`karta: ${JSON.stringify(adapter)}`); }
  raport.adapter = adapter;
  const pipeStart = await ev('window.__harness.pipes.list.length');
  await ev('window.__wok.pokaz.panel(false); true');
  const kadr = async (nazwa, t) => {
    for (const [kam, k] of [['gora', Z_GORY], ['ukos', UKOS]]) {
      await ev(`window.__wok.pokaz.kamera(${JSON.stringify(k)}); true`);
      for (const tr of args.zbrojenie ? [2] : [0, 1]) {
        if (!args.zbrojenie) await ev(`window.__wok.pokaz.tryb(${tr}); true`);
        await ev('window.__wok.pokaz.przerysuj()');
        const plik = `${nazwa}_t${t.toFixed(1)}_${kam}_${['woksele', 'kawalki', 'zbrojenie'][tr]}.png`;
        await screenshotPng(cdp, join(wyDir, plik));
        raport.kadry.push(plik);
      }
    }
    const st = await ev('window.__wok.pokaz.statKawalki()');
    raport.stan.push({ nazwa, t, ...st, stat: undefined });
    console.log(`${nazwa} t = ${t}: pękło L0 ${st?.peklo?.[0]}/${st?.K0}, L1 ${st?.peklo?.[1]}/${st?.K1}, węzły na poziomach ${st?.wezly?.join(' / ')}`);
    zapisz();
  };
  const N = 'window.__wok.pokaz.narzedzia';
  if (args.scenariusz === 'stoi') {
    // Baza bez strzałów: ile wiązań puszcza samo (stabilność przy innej sztywności, kruchości).
    const ZERW = `(async () => { const s = window.__wok.pokaz.solver, w = s.wypiek, r = await window.__wok.odczyt(); let z = 0, zyw = 0, nan = 0; for (let i = 0; i < w.n; i++) { const a = r.poz[3 * i]; if (a !== a) nan++; const m0 = w.maska[i], m = r.maskaW[i]; for (let d = 0; d < 18; d++) if ((m0 >>> d) & 1) { if ((m >>> d) & 1) zyw++; else z++; } } return { zerwanych: z, zywych: zyw, nan }; })()`;
    for (const t of [1, 3, 6]) {
      await ev(`window.__wok.pokaz.doChwili(${t})`);
      const a = await ev(ZERW);
      const st = await ev('window.__wok.pokaz.statKawalki()');
      console.log(`stoi t = ${t}: zerwanych wiązań ${a.zerwanych} z ${a.zerwanych + a.zywych}, NaN ${a.nan}, pękło L0 ${st.peklo[0]}/${st.K0}`);
      await kadr('stoi', t);
    }
  } else if (args.scenariusz === 'szyja') {
    // Kamera po skosie (+x, −y): wieżowce W-1 i W-2 stoją na osi x, więc z boku zasłaniały szyję.
    const BOK = { az: 45, el: 8, cel: [0, 0, 900], odl: 4800 };
    const kadrBok = async (nazwa, t) => {
      await ev(`window.__wok.pokaz.kamera(${JSON.stringify(BOK)}); true`);
      await ev('window.__wok.pokaz.przerysuj()');
      const plik = `${nazwa}_t${t.toFixed(1)}_bok.png`;
      await screenshotPng(cdp, join(wyDir, plik));
      raport.kadry.push(plik);
      const st = await ev('window.__wok.pokaz.statKawalki()');
      console.log(`${nazwa} t = ${t}: pękło L0 ${st?.peklo?.[0]}/${st?.K0}, węzły na poziomach ${st?.wezly?.join(' / ')}`);
    };
    await ev('window.__wok.pokaz.doChwili(0.5)');
    await kadrBok('s0', 0.5);
    // Kratery z boku (+y) u podstawy szyi, dwa na różnych wysokościach. Od +x stoi W-2 i promień trafiał w niego.
    for (const [z, x] of [[330, 40], [450, -40]]) {
      await ev(`${N}.stan.rKratera = 130; ${N}.uzyj('krater', { o: [${x}, 4000, ${z}], dir: [0, -1, 0] }); true`);
      await ev(`window.__wok.pokaz.doChwili(window.__wok.pokaz.stan.krok / 60 + 2 / 60)`);
    }
    // Analiza wiązań szyi z GPU: rozciągnięcie żywych wiązań względem długości z wypieku (R0), sprężenie (F0), uszkodzenie (D), wydłużenie plastyczne (L − R0).
    const ANALIZA = `(async () => {
      const s = window.__wok.pokaz.solver, w = s.wypiek, r = await window.__wok.odczyt();
      const cz = window.__wok.pokaz.stan.miasto.budynki.find((b) => b.nazwa === 'H-C + H-T');
      const wy = { wezlow: 0, zywych: 0, zerwanych: 0, kosze: [0, 0, 0, 0, 0], ponad50: 0, ponad50Spr: 0, sciskPonad55: 0, maks: 0, maksPlast: 0, maksD: 0, przyklady: [] };
      for (let i = cz.start; i < cz.start + cz.n; i++) {
        const x = w.pos[3 * i], y = w.pos[3 * i + 1], z = w.pos[3 * i + 2];
        if (x * x + y * y > 170 * 170 || z < 230 || z > 1400) continue;
        wy.wezlow++;
        for (let d = 0; d < 18; d++) {
          const q = 18 * i + d, j = w.nbr[q];
          if (j < 0 || !((w.maska[i] >>> d) & 1)) continue;
          if (!((r.maskaW[i] >>> d) & 1)) { wy.zerwanych++; continue; }
          wy.zywych++;
          const ex = r.poz[3 * j] - r.poz[3 * i], ey = r.poz[3 * j + 1] - r.poz[3 * i + 1], ez = r.poz[3 * j + 2] - r.poz[3 * i + 2];
          const e = Math.sqrt(ex * ex + ey * ey + ez * ez) / w.R0[q] - 1;
          wy.kosze[e < 0.1 ? 0 : e < 0.2 ? 1 : e < 0.3 ? 2 : e < 0.5 ? 3 : 4]++;
          if (e > 0.5) { wy.ponad50++; if (r.F0[q] !== 0) wy.ponad50Spr++; if (wy.przyklady.length < 6) wy.przyklady.push({ i, d, e: +e.toFixed(3), F0: r.F0[q], D: +r.D[q].toFixed(3), L: +(r.L[q] / w.R0[q]).toFixed(3), klasa: w.klasaW[q], Ft: w.Ft[q] }); }
          if (e < -0.55) wy.sciskPonad55++;
          wy.maks = Math.max(wy.maks, e);
          wy.maksPlast = Math.max(wy.maksPlast, r.L[q] / w.R0[q] - 1);
          wy.maksD = Math.max(wy.maksD, r.D[q]);
        }
      }
      return wy;
    })()`;
    for (const t of [2, 4, 6, 9]) {
      await ev(`window.__wok.pokaz.doChwili(${t})`);
      await kadrBok('s', t);
      if (args.analiza) {
        const a = await ev(ANALIZA);
        (raport.analiza ??= []).push({ t, ...a });
        console.log(`  wiązania szyi t = ${t}: węzłów ${a.wezlow}, żywych ${a.zywych}, zerwanych ${a.zerwanych}, rozciągnięcie <10 / 10–20 / 20–30 / 30–50 / >50 %: ${a.kosze.join(' / ')}, maks ${(100 * a.maks).toFixed(0)} %, >50 % ze sprężeniem ${a.ponad50Spr}, ściśnięte >55 % ${a.sciskPonad55}, maks plast. ${(100 * a.maksPlast).toFixed(1)} %, maks D ${a.maksD.toFixed(3)}`);
        if (a.przyklady.length) console.log('  przykłady >50 %:', JSON.stringify(a.przyklady));
      }
    }
    // Koszt kroku (solver z podkrokami tej sztywności + obraz) na tej chwili.
    const k = await ev('window.__wok.pokaz.kosztKlatki(8, 9)');
    raport.koszt = k;
    console.log(`  koszt: krok + kernele ${k.computeGpuMs.toFixed(2)} ms GPU, rysunek ${k.renderGpuMs.toFixed(2)} ms, podkroki ${await ev('window.__wok.pokaz.solver.wypiek.podkrokiEf')}`);
  } else if (args.scenariusz === 'klin') {
    // Klin u podstawy szyi od strony +y narzędziem Krater, jak klika użytkownik (pytanie 2026-11-09: wieżowiec podcięty klinem pada w bok, wieża zawsze
    // siada w dół). Głowa = węzły wieży dalej niż 300 j. od osi: przesunięcie jej środka w poziomie (przewrót) i w pionie (siadanie). Kadry z boku (+x).
    const BOKX = { az: Number(args.klinAz ?? 90), el: 6, cel: [0, 0, 900], odl: 5600 }; // az 90: kamera na osi x, upadek ku +y idzie w poprzek kadru
    const GLOWA = `(async () => {
      const s = window.__wok.pokaz.solver, w = s.wypiek, r = await window.__wok.odczyt();
      const cz = window.__wok.pokaz.stan.miasto.budynki.find((b) => b.nazwa === 'H-C + H-T');
      let n = 0, x0 = 0, y0 = 0, z0 = 0, x1 = 0, y1 = 0, z1 = 0;
      for (let i = cz.start; i < cz.start + cz.n; i++) {
        const x = w.pos[3 * i], y = w.pos[3 * i + 1];
        if (x * x + y * y < 300 * 300 || !r.aktywny[i]) continue;
        n++; x0 += x; y0 += y; z0 += w.pos[3 * i + 2]; x1 += r.poz[3 * i]; y1 += r.poz[3 * i + 1]; z1 += r.poz[3 * i + 2];
      }
      return { n, dx: (x1 - x0) / n, dy: (y1 - y0) / n, dz: (z1 - z0) / n };
    })()`;
    const kadrBok = async (nazwa, t) => {
      await ev(`window.__wok.pokaz.kamera(${JSON.stringify(BOKX)}); true`);
      await ev('window.__wok.pokaz.przerysuj()');
      const plik = `${nazwa}_t${t.toFixed(1)}_bok.png`;
      await screenshotPng(cdp, join(wyDir, plik));
      raport.kadry.push(plik);
      const g = await ev(GLOWA);
      (raport.glowa ??= []).push({ t, ...g });
      console.log(`${nazwa} t = ${t}: głowa w bok ${Math.hypot(g.dx, g.dy).toFixed(0)} j. (ku +y ${g.dy.toFixed(0)}), w dół ${(-g.dz).toFixed(0)} j., węzłów ${g.n}`);
    };
    await ev('window.__wok.pokaz.doChwili(0.5)');
    await kadrBok('k0', 0.5);
    await ev(`${N}.stan.rKratera = 130; true`);
    for (const z of [300, 380]) for (const x of [-160, -80, 0, 80, 160]) {
      await ev(`${N}.uzyj('krater', { o: [${x}, 4000, ${z}], dir: [0, -1, 0] }); true`);
      await ev(`window.__wok.pokaz.doChwili(window.__wok.pokaz.stan.krok / 60 + 2 / 60)`);
    }
    for (const t of String(args.klinT || '1.5,2.5,3.5,5,7,10').split(',').map(Number)) { // --klinT '2,5,10,15,20': chwile kadrów
      await ev(`window.__wok.pokaz.doChwili(${t})`);
      await kadrBok('k', t);
    }
  } else {
  await ev('window.__wok.pokaz.doChwili(1)');
  await kadr('01-przed', 1);
  // Działo: seria w W-1 i habitat, jak gracz w misji 1.
  for (const [x, y] of [[-2777, 0], [-2700, 120], [-2850, -100], [-2600, -60], [-150, 200], [120, -180], [0, 350]]) await ev(`${N}.uzyj('dzialo', { x: ${x}, y: ${y} })`);
  await ev('window.__wok.pokaz.doChwili(3)');
  await kadr('02-dzialo', 3);
  for (const [x, y] of [[2663, 0], [2560, 120], [2760, -110]]) await ev(`${N}.uzyj('ciezkie', { x: ${x}, y: ${y} })`);
  await ev('window.__wok.pokaz.doChwili(5)');
  await kadr('03-ciezkie', 5);
  await ev(`window.__wok.pokaz.kamera(${JSON.stringify(Z_GORY)}); true`);
  await ev(`${N}.uzyj('taran', { x: 0, y: 0 })`);
  await ev('window.__wok.pokaz.doChwili(6)');
  await kadr('04-taran', 6);
  await ev('window.__wok.pokaz.doChwili(9)');
  await kadr('05-po-taranie', 9);
  await ev(`${N}.uzyj('upadek')`);
  await ev('window.__wok.pokaz.doChwili(14)');
  await kadr('06-upadek', 14);
  await ev('window.__wok.pokaz.doChwili(22)');
  await kadr('07-ruiny', 22);
  }
  const nowe = await ev(`window.__harness.pipes.list.slice(${pipeStart}).map((p) => ({ nazwa: p.nazwa, sync: !!p.sync }))`);
  raport.pipeline = { poRozgrzewce: nowe.length, synchroniczne: nowe.filter((p) => p.sync).length, nazwy: nowe.filter((p) => p.sync).map((p) => p.nazwa).slice(0, 20) };
  console.log(`pipeline'y po rozgrzewce: ${nowe.length}, synchroniczne ${raport.pipeline.synchroniczne}`);
  if (raport.pipeline.synchroniczne) kod = 1;
} catch (e) {
  raport.bledy.push(String(e?.stack || e));
  console.error(e);
  if (!kod) kod = 1;
} finally {
  raport.logi = logi.errors().filter((l) => !/favicon/.test(l)).slice(0, 40);
  if (raport.logi.length) { console.log('błędy konsoli:', raport.logi.slice(0, 5)); if (!kod) kod = 1; }
  zapisz();
  await chrome.close().catch(() => {});
  await server.close().catch(() => {});
}
console.log(`raport: ${join(wyDir, 'raport.json')}`);
process.exit(kod);
