// Zrzuty dema marek silników (dema/silniki-marki.html): każda marka w każdym trybie, fazy przejść, porównanie, błędy konsoli.
//
//   node scripts/webgpu/silniki-marki-demo.mjs [--out .tmp/silniki-marki/1] [--rozmiar 1920x1080]
//        [--marki helios,ares,krios,wulkan,kowal,szakal] [--tryby jalowy,normalny,boost,hiper,warp]
//        [--fazy 1] (rozruch hipercruise'u, ładowanie warpa, skok, wyjście) [--galeria 1] (porównanie wszystkich marek)
//        [--kamera3d 1] (kamera pochylona) [--zoom 1.5] (mnożnik zoomu) [--panele 1] (z panelami) [--port 5463]
//        [--gimbal 1] (dysze wychylone: 1 albo -1) [--warstwy haze=0,bloom=0] (wyłączone warstwy — A/B)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/silniki-marki/zrzuty');
mkdirSync(out, { recursive: true });
const MARKI = (args.marki || 'helios,ares,krios,wulkan,kowal,szakal').split(',').filter(Boolean);
const TRYBY = (args.tryby || 'normalny,boost,hiper,warp').split(',').filter(Boolean);
// Czas dojścia do stanu ustalonego trybu [s] (hipercruise: rozruch 1,3 s; warp: ładowanie 2,6 s).
const USTAL = { jalowy: 1.5, normalny: 2, boost: 2, hiper: 4, warp: 5 };

const { server, base } = await startVite(Number(args.port || 5463));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const raport = { zrzuty: {} };

async function zrzut(nazwa) {
  await sleep(150);
  await screenshotPng(cdp, join(out, `${nazwa}.png`));
  raport.zrzuty[nazwa] = await ev('window.__silniki.stan()');
  const s = raport.zrzuty[nazwa];
  console.log('zrzut', nazwa.padEnd(30), JSON.stringify({ faza: s.faza, strugi: s.strugi, blaski: s.blaski, zrodla: s.zrodla, cpu: s.cpuMs }));
}
const ustaw = (o) => ev(`window.__silniki.ustaw(${JSON.stringify(o)})`);
const przewin = (s) => ev(`window.__silniki.przewin(${s})`);

try {
  await cdp.send('Page.navigate', { url: `${base}/dema/silniki-marki.html?test=1&petla=0${args.panele === '1' ? '' : '&shot=1'}` });
  if (!await waitFor(cdp, '!!(window.__silniki && (window.__silniki.gotowe || window.__silniki.blad))', 180000, 400)) throw new Error('demo nie wstało');
  const blad = await ev('window.__silniki.blad || ""');
  if (blad) throw new Error(`demo zgłosiło błąd: ${blad}`);
  if (args.kamera3d === '1') await ustaw({ kamera3d: true });
  if (args.zoom) await ustaw({ zoom: Number(args.zoom) });
  if (args.gimbal) await ustaw({ gimbal: Number(args.gimbal) });
  for (const w of (args.warstwy || '').split(',').filter(Boolean)) {
    const [k, v] = w.split('=');
    await ev(`window.__silniki.S.warstwy[${JSON.stringify(k)}] = ${v !== '0'}`);
  }
  if (args.galeria === '1') {
    await ustaw({ widok: 'galeria', tryb: 'jalowy' });
    await przewin(1.5);
    for (const t of TRYBY) {
      await ustaw({ tryb: t });
      await przewin(USTAL[t] ?? 2);
      await zrzut(`galeria-${t}`);
    }
  } else {
    for (const m of MARKI) {
      await ustaw({ marka: m, widok: 'zblizenie', tryb: 'jalowy' });
      await przewin(2.5);
      for (const t of TRYBY) {
        if (args.fazy === '1' && t === 'hiper') {
          await ustaw({ tryb: 'hiper' });
          await przewin(1.0);
          await zrzut(`${m}-hiper-0-rozruch`);
          await przewin(0.4);
          await zrzut(`${m}-hiper-1-zaplon`);
          await przewin(3);
          await zrzut(`${m}-hiper`);
          await ustaw({ tryb: 'normalny' });
          await przewin(0.5);
          await zrzut(`${m}-hiper-2-wyjscie`);
          await przewin(2);
        } else if (args.fazy === '1' && t === 'warp') {
          await ustaw({ tryb: 'warp' });
          await przewin(1.2);
          await zrzut(`${m}-warp-0-ladowanie`);
          await przewin(1.3);
          await zrzut(`${m}-warp-1-ladowanie-koniec`);
          await przewin(0.15);
          await zrzut(`${m}-warp-2-skok`);
          await przewin(3.5);
          await zrzut(`${m}-warp`);
          await ustaw({ tryb: 'normalny' });
          await przewin(0.45);
          await zrzut(`${m}-warp-3-wyjscie`);
          await przewin(2.5);
        } else {
          await ustaw({ tryb: t });
          await przewin(USTAL[t] ?? 2);
          await zrzut(`${m}-${t}`);
          if (t === 'hiper' || t === 'warp') { await ustaw({ tryb: 'jalowy' }); await przewin(3); }
        }
      }
    }
  }
  const bledy = logs.errors();
  raport.bledy = bledy;
  writeFileSync(join(out, 'wyniki.json'), JSON.stringify(raport, null, 1));
  console.log('błędy konsoli:', bledy.length);
  for (const b of bledy.slice(0, 20)) console.log('  ', String(b).slice(0, 600));
  const blok = await ev('document.getElementById("errors").textContent');
  if (blok) console.log('PANEL BŁĘDÓW:', blok.slice(0, 2000));
} catch (err) {
  console.log('BŁĄD:', err.message);
  for (const b of logs.all().slice(-30)) console.log('  ', String(b).slice(0, 800));
  process.exitCode = 1;
} finally {
  await chrome.close();
  await server.close();
}
