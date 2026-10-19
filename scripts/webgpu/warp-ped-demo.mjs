// Zrzuty dema warpa „Pęd” (dema/warp-ped.html) w headless Chrome z GPU (CDP), klatki z zegarem ręcznym
// (?test=1 → __warpPed.until / runFrames): dla każdego stylu skoku (rulon, ped, akcent, soczewka) te same fazy —
// ładowanie, skok, lot, przelot obok Marsa, wyjście (zwolnienie, hamowanie), po wyjściu (ślizg z pędem); błędy konsoli.
//
//   node scripts/webgpu/warp-ped-demo.mjs [--out .tmp/warp-ped/demo] [--rozmiar 1600x900] [--style ped,akcent]
//     [--ped 3|0] [--trasa jowisz|mars] [--fazy ladowanie,skok,lot,przelot,wyjscie,hamowanie,po] [--wolny 1]
//     [--kamera up|right|off] (obrót kadru w skoku — domyślnie jak demo: kurs w górę)
// --wolny 1 — na końcu lot swobodny: ciąg, warp z klawisza (CapsLock / 9), wyjście z klawisza, ślizg z pędem.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/warp-ped/demo');
const styles = String(args.style || 'rulon,ped,akcent,soczewka').split(',');
const only = args.fazy ? new Set(String(args.fazy).split(',')) : null;
mkdirSync(out, { recursive: true });

// Fazy: [nazwa, warunek (d = window.__warpPed), opis]. Warunek „albo już po fazie” — żeby nie czekać do limitu.
const PHASES = [
  ['ladowanie', 'd.warp.state === "charging" && d.warp.charge / d.warp.chargeTime >= 0.7', 'ładowanie 70%'],
  ['skok', 'd.warp.state === "active" && d.S.time - d.trip.jumpT >= 0.12', 'skok +0,12 s'],
  ['lot', 'd.warp.state === "active" && d.S.time - d.trip.jumpT >= 1.6', 'lot +1,6 s'],
  ['przelot', '(d.warp.state === "active" && d.warp.flybyFactor < 0.35) || !!(d.warp.exitRamp)', 'przelot obok ciała (zwolnienie)'],
  ['wyjscie', '!!(d.warp.exitRamp && d.warp.exitRamp.active && d.warp.exitRamp.age >= 0.3)', 'wyjście: zwolnienie +0,3 s'],
  ['hamowanie', '!!(d.warp.exitRamp && d.warp.exitRamp.age >= d.warp.exitRamp.tBrake + 0.06)', 'hamowanie +0,06 s'],
  ['po', 'd.trip.phase === "po" && d.trip.t >= 1.2', 'po wyjściu +1,2 s (ślizg z pędem)']
];

const { server, base } = await startVite(Number(args.port || 5433));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);
const report = { zrzuty: {} };

try {
  const q = [`test=1`, args.trasa ? `trasa=${args.trasa}` : '', args.ped != null ? `ped=${args.ped}` : '',
    args.kamera ? `kamera=${args.kamera}` : ''].filter(Boolean).join('&');
  await cdp.send('Page.navigate', { url: `${base}/dema/warp-ped.html?${q}` });
  if (!await waitFor(cdp, '!!(window.__warpPed && (window.__warpPed.ready || window.__warpPed.error))', 300000, 500)) throw new Error('demo nie wstało');
  const err = await ev('window.__warpPed.error || null');
  if (err) throw new Error(`demo: ${err}`);
  // tekstury planet i rozgrzewka — chwila przed pierwszym zrzutem
  await ev('window.__warpPed.runFrames(60, 60)');
  for (const style of styles) {
    await ev(`(() => { window.__warpPed.setStyle(${JSON.stringify(style)}); window.__warpPed.restart(); return true; })()`);
    for (const [name, cond, opis] of PHASES) {
      if (only && !only.has(name)) {
        await ev(`window.__warpPed.until((d) => ${cond}, 4000)`);
        continue;
      }
      const n = await ev(`window.__warpPed.until((d) => ${cond}, 4000)`);
      const file = `${style}-${PHASES.findIndex((p) => p[0] === name)}-${name}`;
      await screenshotPng(cdp, join(out, `${file}.png`));
      report.zrzuty[file] = { opis, klatek: n, ...(await ev('window.__warpPed.stats()')) };
      delete report.zrzuty[file].warmup;
      console.log('zrzut', file.padEnd(26), JSON.stringify({ ...report.zrzuty[file], warpNurt: undefined }));
    }
  }
  if (args.wolny) {
    const snap = async (file, opis) => {
      await screenshotPng(cdp, join(out, `${file}.png`));
      report.zrzuty[file] = { opis, ...(await ev('window.__warpPed.stats()')) };
      delete report.zrzuty[file].warmup;
      console.log('zrzut', file.padEnd(26), JSON.stringify({ ...report.zrzuty[file], warpNurt: undefined }));
    };
    await ev('(() => { const d = window.__warpPed; d.setFree(true); d.keys({ w: true, d: true }); return true; })()');
    await ev('window.__warpPed.runFrames(150, 60)');
    await ev('(() => { const d = window.__warpPed; d.keys({ w: false, d: false }); d.toggleFreeWarp(); return true; })()');
    await ev('window.__warpPed.until((d) => d.warp.state === "active" && d.S.time - d.trip.jumpT >= 2.0, 2000)');
    await snap('wolny-0-skok', 'lot swobodny: warp z klawisza, +2 s');
    await ev('(() => { window.__warpPed.toggleFreeWarp(); return true; })()');
    await ev('window.__warpPed.until((d) => !!(d.warp.exitRamp && !d.warp.exitRamp.active), 2000)');
    await ev('window.__warpPed.runFrames(40, 60)');
    await snap('wolny-1-po', 'lot swobodny: po wyjściu z klawisza (ślizg z pędem)');
    await ev('(() => { window.__warpPed.setFree(false); return true; })()');
  }
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 30);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error(e);
} finally {
  report.bledy = report.bledy || logs.errors().slice(0, 30);
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2));
  if (report.bledy.length) console.log('błędy konsoli:', report.bledy);
  await chrome.close();
  await server.close();
  process.exit(0);
}
