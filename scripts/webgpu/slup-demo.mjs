// Zrzuty dema planet z ELEKTROWNIĄ „KOREK” w wielkim gryzie Ziemi (dema/planety-webgpu.html?korek=1, dodatek
// dema/planety-slup.js, src/3d/earthBitePlant*.js — korek, obudowa dziury, windy, odbiornik, promień do ringu) i opcjonalnie
// słupem dymu (?slup=1, src/3d/earthBitePlume*.js). Kadry:
//   • gra-* — jak w grze (kamera z daleka w płaszczyźnie równika, oś doby pionowo, słońce w poziomie; `x` = położenie
//     gryzu na tarczy w poziomie, + ku słońcu),
//   • szczegóły (korek-*, obudowa, brzeg, odbiornik, winda, promien, nad-gryzem) — kamera w RAMIE ELEKTROWNI
//     (`__slup.viewPlant`: y — wysokość nad dnem gryzu, R Ziemi; dno 0, płaszczyzna brzegu ~0,354, odbiornik ~0,535),
//   • blisko* — kamera nad gryzem z ukosa.
// Zegar stoi (setTime), błyski dymu z ziarnem (burst) — zrzuty powtarzalne. Grupy: --tylko gra | szczegoly | nazwy,po,przecinku.
//
//   node scripts/webgpu/slup-demo.mjs [--out .tmp/korek/demo] [--tag v1] [--tylko szczegoly] [--port 5413]
//        [--dym 1] [--korek 0] [--wariant parasol|smukly] [--query "x=1"] [--czas 40] [--look '{"beamGain":1.5}']
//        [--bez 1] (bez elektrowni i dymu)
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/korek/demo');
const tag = String(args.tag || 'korek');
const query = args.query !== undefined ? `&${args.query}` : '';
const czas = Number(args.czas ?? 40);
const look = args.look ? JSON.parse(String(args.look)) : null;
const bez = String(args.bez || '') === '1';
const wariant = args.wariant ? `&slupWariant=${args.wariant}` : '';
// --korek 0 — bez elektrowni (domyślnie jest), --dym 1 — ze słupem dymu (domyślnie bez)
const warstwy = `${String(args.dym ?? '0') === '1' ? '&slup=1' : ''}${String(args.korek ?? '1') === '0' ? '' : '&korek=1'}`;
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
  { name: 'blisko-noc', near: { dist: 2.15, tilt: 28, pora: 165, sunEl: 10 }, burst: [5, 4] },
  // szczegóły w ramie elektrowni (at / from — punkty ramy, sun — kierunek słońca w ramie)
  { name: 'nad-gryzem', plant: { at: [0, 0.15, 0], from: [0.3, 0.8, 0.35], fov: 58, sun: [0.35, 0.85, 0.4] } },
  { name: 'korek-gora', plant: { at: [0, 0.05, 0], from: [0.07, 0.36, 0.05], fov: 46, sun: [0.4, 1, 0.2] } },
  { name: 'korek-bok', plant: { at: [0, 0.045, 0], from: [0.21, 0.12, 0.13], fov: 40, sun: [0.3, 1, 0.5] } },
  { name: 'korek-noc', plant: { at: [0, 0.045, 0], from: [0.21, 0.12, 0.13], fov: 40, sun: [0.3, -1, 0.5] } },
  { name: 'korek-wylot', plant: { at: [0, 0.07, 0], from: [0.05, 0.115, 0.035], fov: 40, sun: [0.3, 1, 0.5] } },
  { name: 'obudowa', plant: { at: [0.3, 0.15, 0], from: [-0.12, 0.3, 0.08], fov: 50, sun: [-0.3, 1, 0.2] } },
  { name: 'brzeg', plant: { at: [0.35, 0.34, -0.35], from: [0.2, 0.45, -0.2], fov: 40, sun: [-0.5, 0.8, 0.5] } },
  { name: 'odbiornik', plant: { at: [0, 0.53, 0], from: [0.1, 0.5, 0.12], fov: 40, sun: [0.5, 0.6, 0.5] } },
  { name: 'winda', plant: { at: [0.197, 0.453, -0.197], from: [0.112, 0.47, -0.282], fov: 50, sun: [-0.5, 0.6, 0.5] } },
  { name: 'promien', plant: { at: [0, 0.25, 0], from: [0.26, 0.22, 0.12], fov: 45, sun: [0.3, 1, 0.4] } }
];
const GROUPS = {
  gra: VIEWS.filter((v) => v.name.startsWith('gra-')).map((v) => v.name),
  szczegoly: VIEWS.filter((v) => v.plant).map((v) => v.name)
};
const only = args.tylko ? new Set(String(args.tylko).split(',').flatMap((k) => GROUPS[k] ?? [k])) : null;

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
      if (v.plant) {
        if (!window.__slup.viewPlant(v.plant)) throw new Error('viewPlant: brak elektrowni');
      } else if (v.near) {
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
