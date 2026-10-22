// Zrzuty dema planet ze SŁUPEM KONWEKCYJNYM nad wielkim gryzem Ziemi (dema/planety-webgpu.html?slup=1, dodatek
// dema/planety-slup.js, src/3d/earthBitePlume*.js). Kadry jak w grze (kamera z daleka w płaszczyźnie równika, oś doby
// pionowo, słońce w poziomie — terminator pionowy; `x` = położenie gryzu na tarczy w poziomie, + ku słońcu) i z bliska.
// Zegar słupa stoi (setTime), błyski z ziarnem (burst) — zrzuty powtarzalne.
//
//   node scripts/webgpu/slup-demo.mjs [--out .tmp/slup/demo] [--tag v1] [--tylko gra-dzien,gra-krawedz]
//        [--korek 1] [--dym 0] [--wariant parasol|smukly] [--query "mapyGryz=.tmp/planety-gryz/046"] [--czas 40] [--look '{"sigmaAnvil":30}']
//        [--bez 1] (bez słupa)
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/slup/demo');
const tag = String(args.tag || 'slup');
const query = args.query !== undefined ? `&${args.query}` : '&mapyGryz=.tmp/planety-gryz/046';
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
const czas = Number(args.czas ?? 40);
const look = args.look ? JSON.parse(String(args.look)) : null;
const bez = String(args.bez || '') === '1';
const wariant = args.wariant ? `&slupWariant=${args.wariant}` : '';
// --korek 1 — elektrownia „KOREK” (promień, odbiornik, windy), --dym 0 — bez słupa dymu
const warstwy = `${String(args.dym ?? '1') === '0' ? '' : '&slup=1'}${String(args.korek || '') === '1' ? '&korek=1' : ''}`;
mkdirSync(out, { recursive: true });

// x — położenie gryzu na tarczy (ułamek promienia, + ku słońcu); half — pół wysokości kadru [R] (whole — cała tarcza);
// burst — błyski piorunów (ziarno, liczba); near — kamera nad gryzem (odległość, odchylenie od pionu, pora, słońce).
const VIEWS = [
  { name: 'gra-cala', x: 0.35, half: 1.25, whole: true },
  { name: 'gra-przekaz', x: 0.62, half: 1.25, whole: true },
  { name: 'gra-przekaz-blisko', x: 0.8, half: 0.42 },
  { name: 'gra-dzien', x: 0.3, half: 0.62 },
  { name: 'gra-noc', x: -0.4, half: 0.62, burst: [7, 3] },
  { name: 'gra-terminator', x: 0.06, half: 0.62, burst: [3, 2] },
  { name: 'gra-brzeg', x: 0.9, half: 0.55 },
  { name: 'gra-krawedz', x: 0.997, half: 0.5 },
  { name: 'gra-krawedz-noc', x: -0.997, half: 0.5, burst: [11, 3] },
  { name: 'blisko', near: { dist: 2.15, tilt: 28, pora: 55, sunEl: 25 } },
  { name: 'blisko-noc', near: { dist: 2.15, tilt: 28, pora: 165, sunEl: 10 }, burst: [5, 4] }
];

const { server, base } = await startVite(Number(args.port || 5413));
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { tag, zrzuty: [] };
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/planety-webgpu.html?test=1&cialo=earth${bez ? '' : `${warstwy}&slupZegar=0${wariant}`}${query}` });
  if (!await waitFor(cdp, '!!(window.__planety && window.__planety.ready())', 240000, 400)) throw new Error('demo nie wstało');
  if (!bez && !await waitFor(cdp, '!!(window.__slup && window.__slup.ready())', 60000, 300)) throw new Error('słup nie wstał');
  // ring z gry buduje się asynchronicznie (mapy, miasto, hale K-7)
  if (!bez && !await waitFor(cdp, '!!(window.__slup && window.__slup.ringReady())', 120000, 500)) throw new Error('ring nie wstał');
  if (look) await ev(`(() => { Object.assign(window.__slup.look, ${JSON.stringify(look)}); window.__slup.apply(); return true; })()`);
  await settle(2500);
  const skala = await ev('window.__planety.biteScale ? window.__planety.biteScale() : 0.16');
  for (const v of VIEWS) {
    if (only && !only.has(v.name)) continue;
    await ev(`(() => {
      const P = window.__planety, S = P.S, v = ${JSON.stringify(v)}, skala = ${skala};
      const [lat, lon] = P.BODIES.find((b) => b.id === 'earth').sites[0];
      const D = Math.PI / 180;
      S.spin = 0; S.doba = false; S.target = null; S.labels = false;
      const phi = (lon + 180) * D, c = Math.cos(lat * D);
      const d = [-Math.cos(phi) * c, Math.sin(lat * D), Math.sin(phi) * c];
      const siteAz = Math.atan2(d[0], d[2]);
      if (v.near) {
        const latC = lat * D - v.near.tilt * D;
        S.az = siteAz; S.el = latC; S.dist = 1 + (v.near.dist - 1) * skala / 0.3;
        S.look.set(d[0], d[1], d[2]);
        S.fov = 42; S.pora = v.near.pora; S.sunEl = v.near.sunEl;
      } else {
        const dl = Math.asin(Math.max(-1, Math.min(1, v.x)));
        S.az = siteAz - dl; S.el = 0; S.pora = 90; S.sunEl = 0; S.dist = 14;
        if (v.whole) S.look.set(0, 0, 0); else S.look.set(d[0], d[1], d[2]);
        S.fov = 2 * Math.atan(v.half / (S.dist - (v.whole ? 0 : 1))) / D;
      }
      const L = window.__slup;
      if (L) {
        L.setTime(${czas});
        if (v.burst) L.burst(v.burst[0], v.burst[1]); else L.burst(1, 0);
      }
      return true;
    })()`);
    await settle();
    await screenshotPng(cdp, join(out, `${v.name}__${tag}.png`));
    report.zrzuty.push(v.name);
  }
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 20);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.log('BŁĄD', report.blad);
} finally {
  await chrome.close();
  await server.close();
}
console.log('wynik →', out, JSON.stringify(report));
process.exit(report.blad ? 1 : 0);
