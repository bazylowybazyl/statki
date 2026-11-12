// Zrzuty dema autostrady wokół Ziemi (dema/autostrada.html): style, kadry galerii, sekwencja Atlasa, błędy konsoli.
//
//   node scripts/webgpu/autostrada-demo.mjs [--out .tmp/autostrada/1] [--rozmiar 1920x1080] [--style klisza,...] [--kadry wezel,zatoka,...]
//        [--atlas 1] (sekwencja: przed, żółte, czerwone, przejazd, zielone) [--ring 0] (bez ringu — szybkie strojenie) [--klatki 30] [--port 5461]
//   Kadr własny: --kadr 45000,-45000,0.1 (scena x, y, zoom kamery gry)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/autostrada/zrzuty');
mkdirSync(out, { recursive: true });
const kadry = (args.kadry || 'wezel,kolejka,zatoka,wrota,zawrotka,tranzyt,luk,calosc,kino').split(',').filter(Boolean);
const NAKLADKA = args.nakladki === '1' ? '' : '&clean=1';

const { server, base } = await startVite(Number(args.port || 5461));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const raport = { zrzuty: {} };

async function zrzut(nazwa) {
  await ev('window.__autostrada.klatki(' + Number(args.klatki || 12) + ')');
  await sleep(120);
  await screenshotPng(cdp, join(out, `${nazwa}.png`));
  raport.zrzuty[nazwa] = await ev('window.__autostrada.stan()');
  console.log('zrzut', nazwa.padEnd(34), JSON.stringify({ n: raport.zrzuty[nazwa].n, faza: raport.zrzuty[nazwa].faza, cpu: raport.zrzuty[nazwa].cpu, gpu: raport.zrzuty[nazwa].gpu }));
}

try {
  const ring = args.ring === '0' ? '&ring=0' : '';
  await cdp.send('Page.navigate', { url: `${base}/dema/autostrada.html?test=1${NAKLADKA}${ring}&atlas=0` });
  if (!await waitFor(cdp, '!!(window.__autostrada && window.__autostrada.gotowe) || !!(window.__autostrada && window.__autostrada.blad)', 240000, 500)) throw new Error('demo nie wstało');
  const lista = await ev('[...document.querySelectorAll("#style button")].map((b) => b.dataset.id)');
  const style = args.style ? args.style.split(',') : lista;
  raport.style = lista;
  await ev('window.__autostrada.klatki(60)');
  if (!args.bezRingu && args.ring !== '0') await sleep(Number(args.czekajRing || 15000));   // ring dojdzie po pieczeniu
  await ev('window.__autostrada.klatki(30)');
  for (const st of style) {
    await ev(`window.__autostrada.ustawStyl(${JSON.stringify(st)})`);
    if (args.kadr) {
      const [x, y, z] = args.kadr.split(',').map(Number);
      await ev(`window.__autostrada.patrz(${x}, ${y}, ${z})`);
      await zrzut(`${st}-kadr`);
    } else {
      for (const k of kadry) {
        await ev(`window.__autostrada.galeria(${JSON.stringify(k)})`);
        await zrzut(`${st}-${k}`);
      }
    }
    if (args.atlas === '1') {
      await ev('window.__autostrada.galeria("wezel")');
      // Poprzednia sekwencja mogła jeszcze trwać: Atlas wraca do hali po wylocie za drogę.
      for (let i = 0; i < 40 && (await ev('window.__autostrada.ruch.atlas.stan')) !== 'dok'; i++) await ev('window.__autostrada.przewin(5)');
      await ev('window.__autostrada.atlas({})');
      await zrzut(`${st}-atlas-0-zolte`);
      await ev('window.__autostrada.przewin(6)');
      await zrzut(`${st}-atlas-1-czerwone`);
      await ev('window.__autostrada.przewin(14)');
      await zrzut(`${st}-atlas-2-przejazd`);
      await ev('window.__autostrada.przewin(14)');
      await zrzut(`${st}-atlas-3-za-droga`);
      await ev('window.__autostrada.przewin(6)');
      await zrzut(`${st}-atlas-4-zielone`);
      await ev('window.__autostrada.przewin(18)');
      await zrzut(`${st}-atlas-5-rozladowanie`);
    }
  }
  raport.bledy = logs.errors?.() ?? logs;
  writeFileSync(join(out, 'wyniki.json'), JSON.stringify(raport, null, 1));
  const bledy = typeof logs.errors === 'function' ? logs.errors() : [];
  console.log('błędy konsoli:', bledy.length);
  for (const b of bledy.slice(0, 20)) console.log('  ', String(b).slice(0, 400));
  const blok = await ev('document.getElementById("errors").textContent');
  if (blok) console.log('PANEL BŁĘDÓW:', blok.slice(0, 1500));
} finally {
  await chrome.close();
  await server.close();
}
