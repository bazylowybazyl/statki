// Zrzuty dema planet (dema/planety-webgpu.html) dla wielkiego GRYZU Ziemi (src/data/earthBite.js) — i dawnej kopalni
// (ten sam skrypt na kodzie sprzed gryzu): kadry jak w grze (kamera z daleka w płaszczyźnie równika, oś doby pionowo,
// słońce w poziomie od planety — terminator pionowy; `x` = położenie celu na tarczy w poziomie, + ku słońcu)
// i z bliska (kamera nad gryzem, ukośnie). Cel = miejsce 0 Ziemi w demie (środek gryzu / kopalni).
//
//   node scripts/webgpu/gryz-demo.mjs [--out .tmp/gryz/demo] [--tag gryz30] [--query gryz=0.30] [--tylko gra-cala,blisko]
//                                     [--skala 0.3]   (promień kątowy otworu [rad] do kadrów z bliska; domyślnie z dema)
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/gryz/demo');
const tag = String(args.tag || 'gryz');
const query = args.query ? `&${args.query}` : '';
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;
mkdirSync(out, { recursive: true });

// x — położenie celu na tarczy (ułamek promienia, + ku słońcu); half — pół wysokości kadru w promieniach Ziemi
// (kadr wokół celu; bez — cała tarcza wokół środka); near — kadr z bliska: kamera nad celem (dist promieni od środka,
// tilt — odchylenie kamery od pionu nad celem [°], pora i wysokość słońca jak w demie).
const VIEWS = [
  { name: 'gra-cala', x: 0.35, half: 2.4, whole: true },
  { name: 'gra-noc', x: -0.4, half: 2.4, whole: true },
  { name: 'gra-dzien', x: 0.3, half: 0.62 },
  { name: 'gra-brzeg', x: 0.93, half: 0.55 },
  { name: 'gra-krawedz', x: 0.997, half: 0.5 },
  { name: 'gra-krawedz-noc', x: -0.997, half: 0.5 },
  { name: 'gra-terminator', x: 0.06, half: 0.55 },
  { name: 'blisko', near: { dist: 2.15, tilt: 28, pora: 55, sunEl: 25 } },
  { name: 'blisko-noc', near: { dist: 2.15, tilt: 28, pora: 165, sunEl: 10 } },
  { name: 'blisko-dno', near: { dist: 1.45, tilt: 12, pora: 40, sunEl: 35, look: -0.75 } }
];

const { server, base } = await startVite(Number(args.port || 5411));
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { tag, zrzuty: [] };
const settle = (ms = 1400) => new Promise((r) => setTimeout(r, ms));
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/planety-webgpu.html?test=1&cialo=earth${query}` });
  if (!await waitFor(cdp, '!!(window.__planety && window.__planety.ready())', 240000, 400)) throw new Error('demo nie wstało');
  await settle(2500);
  const skala = args.skala ? Number(args.skala) : await ev('window.__planety.biteScale ? window.__planety.biteScale() : 0.16');
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
        // kamera nad celem odchylona ku południowi o tilt, w odległości dist (kadr: gryz z brzegiem)
        const latC = lat * D - v.near.tilt * D;
        S.az = siteAz; S.el = latC; S.dist = 1 + (v.near.dist - 1) * skala / 0.3;
        const lk = (v.near.look ?? 0) * skala;
        S.look.set(d[0] * (1 + lk), d[1] * (1 + lk), d[2] * (1 + lk));
        S.fov = 42; S.pora = v.near.pora; S.sunEl = v.near.sunEl;
      } else {
        const dl = Math.asin(Math.max(-1, Math.min(1, v.x)));
        S.az = siteAz - dl; S.el = 0; S.pora = 90; S.sunEl = 0; S.dist = 14;
        if (v.whole) S.look.set(0, 0, 0); else S.look.set(d[0], d[1], d[2]);
        S.fov = 2 * Math.atan(v.half / (S.dist - (v.whole ? 0 : 1))) / D;
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
