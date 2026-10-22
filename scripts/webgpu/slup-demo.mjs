// Zrzuty dema planet z ELEKTROWNIĄ „KOREK” w wielkim gryzie Ziemi (dema/planety-webgpu.html?korek=1, dodatek
// dema/planety-slup.js, src/3d/earthBitePlant*.js — korek, obudowa dziury, windy, odbiornik, promień do ringu) i opcjonalnie
// słupem dymu (?slup=1, src/3d/earthBitePlume*.js). Kadry:
//   • gra-* — jak w grze (`__slup.viewGame`): Ziemia obraca się wokół osi ringu (src/3d/earthSpin.js), kamera z daleka
//     znad bieguna, ring równikowy, słońce w płaszczyźnie ringu; `angle` — gryz na tarczy [°], `phase` — pora w gryzie
//     (0 południe, 90 terminator, 180 północ), `half` — pół wysokości kadru [R],
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

// near — kamera nad gryzem z ukosa (odległość, odchylenie od pionu, pora, słońce); burst — błyski dymu (ziarno, liczba).
const VIEWS = [
  // jak w grze: kamera znad bieguna obrotu (oś ringu), gryz przy krawędzi tarczy
  { name: 'gra-cala', game: { angle: 20, phase: 35, half: 1.25, center: 'planet' } },
  { name: 'gra-noc-cala', game: { angle: 20, phase: 165, half: 1.25, center: 'planet' } },
  { name: 'gra-dzien', game: { angle: 20, phase: 25, half: 0.45, center: 'bite' } },
  { name: 'gra-terminator', game: { angle: 20, phase: 88, half: 0.45, center: 'bite' } },
  { name: 'gra-noc', game: { angle: 20, phase: 160, half: 0.45, center: 'bite' } },
  { name: 'gra-blisko', game: { angle: 20, phase: 30, half: 0.16, center: 'hub' } },
  { name: 'gra-blisko-noc', game: { angle: 20, phase: 165, half: 0.16, center: 'hub' } },
  { name: 'blisko', near: { dist: 2.15, tilt: 28, pora: 55, sunEl: 25 } },
  { name: 'blisko-noc', near: { dist: 2.15, tilt: 28, pora: 165, sunEl: 10 }, burst: [5, 4] },
  // szczegóły w ramie elektrowni (at / from — punkty ramy, sun — kierunek słońca w ramie; góra kadru = oś gryzu)
  { name: 'nad-gryzem', plant: { at: [0, 0.43, 0.06], from: [0.02, 0.9, -0.62], fov: 58, sun: [0.35, 0.85, 0.4] } },
  { name: 'korek-gora', plant: { at: [0, 0.05, 0], from: [0.07, 0.36, 0.05], fov: 46, sun: [0.4, 1, 0.2] } },
  { name: 'korek-bok', plant: { at: [0, 0.045, 0], from: [0.21, 0.12, 0.13], fov: 40, sun: [0.3, 1, 0.5] } },
  { name: 'korek-noc', plant: { at: [0, 0.045, 0], from: [0.21, 0.12, 0.13], fov: 40, sun: [0.3, -1, 0.5] } },
  { name: 'korek-wylot', plant: { at: [0, 0.07, 0], from: [0.05, 0.115, 0.035], fov: 40, sun: [0.3, 1, 0.5] } },
  { name: 'obudowa', plant: { at: [0.3, 0.15, 0], from: [-0.12, 0.3, 0.08], fov: 50, sun: [-0.3, 1, 0.2] } },
  { name: 'brzeg', plant: { at: [0.35, 0.34, -0.35], from: [0.2, 0.45, -0.2], fov: 40, sun: [-0.5, 0.8, 0.5] } },
  { name: 'odbiornik', plant: { at: [0, 0.53, 0], from: [0.1, 0.5, 0.12], fov: 40, sun: [0.5, 0.6, 0.5] } },
  { name: 'winda', plant: { at: [0.25827, 0.43829, -0.13791], from: [0.25023, 0.45363, -0.15443], fov: 40, sun: [-0.29013, 0.83107, 0.07172], up: [0.2462, 0.94631, -0.20948] } },
  { name: 'promien', plant: { at: [0, 0.25, 0], from: [0.26, 0.22, 0.12], fov: 45, sun: [0.3, 1, 0.4] } },
  // kadry ról z rundy 3
  { name: 'winda-kotwica', role: 'elev', plant: { at: [0.21301, 0.38568, 0.36894], from: [0.20184, 0.36089, 0.42959], fov: 45, sun: [-0.06408, 0.58169, 0.78901], up: [0.20814, 0.90923, 0.36052] } },
  { name: 'winda-wieza', role: 'elev', plant: { at: [0.21098, 0.38643, 0.36543], from: [0.16789, 0.41187, 0.3428], fov: 45, sun: [-0.38231, 0.87309, 0.23782], up: [0.20814, 0.90923, 0.36052] } },
  { name: 'winda-hala', role: 'elev', plant: { at: [0.20507, 0.37864, 0.3552], from: [0.17696, 0.39793, 0.35051], fov: 45, sun: [-0.40288, 0.85227, 0.30219], up: [0.20814, 0.90923, 0.36052] } },
  { name: 'winda-dok', role: 'elev', plant: { at: [0.21543, 0.40106, 0.37313], from: [0.19778, 0.41333, 0.37457], fov: 45, sun: [-0.13011, 0.6025, 0.77464], up: [0.20814, 0.90923, 0.36052] } },
  { name: 'winda-kabina', role: 'elev', plant: { at: [-0.26669, 0.43473, -0.13927], from: [-0.26166, 0.43974, -0.14528], fov: 45, sun: [-0.71364, 0.55462, 0.11451], up: [-0.29098, 0.93217, -0.21536] } },
  { name: 'winda-szyna', role: 'elev', plant: { at: [0.23709, 0.51614, 0.18623], from: [0.19423, 0.50018, 0.17123], fov: 45, sun: [0.55229, 0.30572, -0.65689], up: [0, 0.17365, -0.98481] } },
  { name: 'winda-wozek', role: 'elev', plant: { at: [0.23276, 0.5154, 0.18406], from: [0.24521, 0.50005, 0.16714], fov: 42, sun: [-0.42491, 0.5148, -0.62002], up: [0, 0.17365, -0.98481] } },
  { name: 'winda-terminal', role: 'elev', plant: { at: [0, 0.54463, 0.17864], from: [0.022, 0.53407, 0.14705], fov: 45, sun: [0.4, -0.34642, -0.75024], up: [0, 0.17365, -0.98481] } },
  { name: 'winda-terminal-gora', role: 'elev', plant: { at: [0, 0.54764, 0.17307], from: [0, 0.54624, 0.1119], fov: 40, sun: [0.4, -0.4867, -0.69507], up: [0, 0.98481, 0.17365] } },
  { name: 'lining-pas-przypory', role: 'lining', plant: { at: [0.24, 0.15, -0.24], from: [0.12, 0.17, -0.12], fov: 45, sun: [0.3, 1, 0.4] } },
  { name: 'lining-kanal', role: 'lining', plant: { at: [0.215, 0.33, 0.372], from: [0.1, 0.36, 0.17], fov: 40, sun: [0.3, 0.8, -0.5] } },
  { name: 'lining-korek-strefa', role: 'lining', plant: { at: [0.047, 0.035, 0.129], from: [0.02, 0.09, 0.05], fov: 50, sun: [0.3, 1, 0.4] } },
  { name: 'pierscien-gora-sciecie', role: 'beam', plant: { at: [0, 0.3445, 0], from: [0.05, 0.37, 0.035], fov: 45, sun: [0.3, 1, 0.4] } },
  { name: 'cork-maszynownia', role: 'cork', plant: { at: [-0.1137, 0.055, 0.04138], from: [-0.13205, 0.062, 0.02807], fov: 45, sun: [0.3, 1, 0.5] } },
  { name: 'cork-most300-gora', role: 'cork', plant: { at: [0.07285, 0.04, 0.12618], from: [0.04121, 0.08, 0.10736], fov: 50, sun: [0.3, 1, 0.5] } },
  { name: 'cork-most300-bok', role: 'cork', plant: { at: [0.0695, 0.04, 0.12038], from: [0.10999, 0.062, 0.09903], fov: 50, sun: [0.3, 1, 0.5] } },
  { name: 'cork-most60-gora', role: 'cork', plant: { at: [0.081, 0.04, -0.1403], from: [0.07237, 0.08, -0.08937], fov: 50, sun: [0.3, 1, 0.5] } },
  { name: 'cork-most120-gora', role: 'cork', plant: { at: [-0.081, 0.04, -0.1403], from: [-0.04121, 0.08, -0.10736], fov: 50, sun: [0.3, 1, 0.5] } },
  // kadry ról z rundy 2 (dokończenie) — po obrocie wind na 0, 60, …, 300
  { name: 'mat-fasada-gra', plant: { at: [0, 0.3, 0.44], from: [0, 0.404, -0.151], fov: 30, sun: [0.3, 0.6, -0.7] } },
  { name: 'mat-fasada-gra-blisko', plant: { at: [0, 0.3, 0.44], from: [0, 0.3435, 0.194], fov: 30, sun: [0.3, 0.6, -0.7] } },
  { name: 'lining-brama', plant: { at: [0, 0.36, 0.43], from: [0, 0.568, -0.752], fov: 9, sun: [0.3, 0.8, -0.5] } },
  { name: 'lining-brama-noc', role: 'lining', plant: { at: [0, 0.36, 0.43], from: [0, 0.568, -0.752], fov: 9, sun: [0.3, -1, 0.5] } },
  { name: 'lining-brama-wieza', role: 'lining', plant: { at: [-0.028, 0.37, 0.43], from: [0.03, 0.4, 0.33], fov: 40, sun: [0.3, 0.8, -0.5] } },
  { name: 'lining-brama-front', role: 'lining', plant: { at: [0, 0.3, 0.43], from: [0.05, 0.36, 0.1], fov: 50, sun: [0.3, 0.8, -0.5] } },
  { name: 'lining-plac', role: 'lining', plant: { at: [0.2099, 0.371, -0.3635], from: [0.2245, 0.4104, -0.3288], fov: 45, sun: [0.3, 1, 0.4] } },
  { name: 'lining-podstacja', role: 'lining', plant: { at: [0.3196, 0.186, -0.1845], from: [0.2338, 0.19, -0.135], fov: 40, sun: [-0.4, 1, 0.3] } },
  { name: 'promien-wnetrze-wylotu', role: 'beam', plant: { at: [0, 0.07, 0], from: [0.004, 0.078, 0.003], fov: 70, sun: [0.3, 1, 0.4] } },
  { name: 'promien-wzdluz', role: 'beam', plant: { at: [0, 0.22, 0], from: [0.008, 0.3, 0.006], fov: 50, sun: [0.3, 1, 0.4] } },
  { name: 'cork-stopa60', role: 'cork', plant: { at: [0.0875, 0.044, -0.15155], from: [0.03882, 0.068, -0.14489], fov: 46, sun: [0.3, 1, 0.5] } },
  { name: 'cork-stopa300', role: 'cork', plant: { at: [0.0715, 0.044, 0.12384], from: [0.02807, 0.06, 0.13205], fov: 46, sun: [0.3, 1, 0.5] } },
  { name: 'cork-most240', role: 'cork', plant: { at: [-0.089, 0.034, 0.15415], from: [-0.03005, 0.069, 0.20204], fov: 46, sun: [0.3, 1, 0.5] } },
  { name: 'cork-pas90', role: 'cork', plant: { at: [-0.00707, 0.038, -0.13481], from: [0.02414, 0.046, -0.13689], fov: 50, sun: [0.3, 1, 0.5] } },
  { name: 'cork-wlot270', role: 'cork', plant: { at: [0, 0.035, 0.15], from: [-0.03882, 0.05, 0.14489], fov: 50, sun: [0.3, 1, 0.5] } },
  { name: 'gra-brama', game: { angle: 20, phase: 30, half: 0.07, center: 'hub' } },
  { name: 'gra-brama-noc', game: { angle: 20, phase: 165, half: 0.07, center: 'hub' } },
  { name: 'gra-wezly', role: 'beam', game: { angle: 20, phase: 40, half: 0.08, center: 'hub' } },
  // kadry ról z rundy 2 — grupy: --tylko elev | orbit
  { name: 'gra-wachlarz', role: 'elev', game: { angle: 20, phase: 40, half: 0.3, center: 'hub' } },
  { name: 'gra-szyna', role: 'elev', game: { angle: 20, phase: 30, half: 0.06, center: 'hub' } },
  { name: 'o-gra-profil', role: 'orbit', game: { angle: 20, phase: 30, half: 0.06, center: 'hub' } },
  { name: 'o-gra-profil-noc', role: 'orbit', game: { angle: 20, phase: 165, half: 0.06, center: 'hub' } },
  { name: 'o-gra-sredni', role: 'orbit', game: { angle: 20, phase: 30, half: 0.12, center: 'hub' } },
  { name: 'o-brama', role: 'orbit', plant: { at: [0, 0.538, 0.05], from: [0.03, 0.548, -0.005], fov: 40, sun: [0.5, 0.6, 0.5] } },
  { name: 'o-dzwon', role: 'orbit', plant: { at: [0, 0.52, 0], from: [0.075, 0.51, -0.06], fov: 45, sun: [0.5, 0.6, 0.5] } },
  { name: 'o-lopata', role: 'orbit', plant: { at: [0.072, 0.535, 0], from: [0.085, 0.545, -0.035], fov: 45, sun: [0.5, 0.6, -0.5] } },
  { name: 'o-front', role: 'orbit', plant: { at: [0, 0.535, -0.05], from: [0.012, 0.545, -0.085], fov: 40, sun: [0.3, 0.6, -0.7] } },
  // kadry zgłoszone przez role (runda 1) — grupy: --tylko mat | cork | lining | orbit | beam
  { name: 'mat-poklad', role: 'mat', plant: {at: [0.11, 0.054, 0], from: [0.132, 0.068, 0.028], fov: 40, sun: [0.3, 1, 0.5]} },
  { name: 'mat-poklad-noc', role: 'mat', plant: {at: [0.11, 0.054, 0], from: [0.132, 0.068, 0.028], fov: 40, sun: [0.3, -1, 0.5]} },
  { name: 'mat-wieza', role: 'mat', plant: {at: [0.073, 0.075, 0], from: [0.105, 0.088, 0.032], fov: 40, sun: [0.3, 1, 0.5]} },
  { name: 'mat-odbiornik-blisko', role: 'mat', plant: {at: [0.05, 0.535, 0], from: [0.085, 0.55, 0.045], fov: 40, sun: [0.5, 0.6, 0.5]} },
  { name: 'cork-akcelerator', role: 'cork', plant: {at: [0, 0.079, 0], from: [0.004, 0.097, 0.062], fov: 50, sun: [0.3, 1, 0.5]} },
  { name: 'cork-taras', role: 'cork', plant: {at: [0, 0.058, 0.08], from: [0.012, 0.096, 0.19], fov: 50, sun: [0.4, 1, 0.2]} },
  { name: 'cork-wylot-lawy', role: 'cork', plant: {at: [-0.076, 0.022, 0.1316], from: [-0.084, 0.058, 0.2], fov: 46, sun: [0.3, 1, 0.5]} },
  { name: 'cork-gora-noc', role: 'cork', plant: {at: [0, 0.05, 0], from: [0, 0.3, 0.11], fov: 50, sun: [0.4, -1, 0.2]} },
  { name: 'lining-stopa', role: 'lining', plant: {at: [0.2304, 0.0484, -0.133], from: [0.1697, 0.0652, -0.098], fov: 50, sun: [0.3, 1, 0.4]} },
  { name: 'lining-maszt', role: 'lining', plant: {at: [0.4862, 0.3377, -0.0967], from: [0.4518, 0.3585, -0.1127], fov: 35, sun: [-0.3, 1, 0.3]} },
  { name: 'lining-galeria', role: 'lining', plant: {at: [0.352, 0.1836, 0.1281], from: [0.2815, 0.1842, 0.1025], fov: 45, sun: [-0.4, 1, 0.3]} },
  { name: 'lining-zab', role: 'lining', plant: {at: [-0.4171, 0.365, -0.1228], from: [-0.3838, 0.4308, -0.113], fov: 40, sun: [-0.5, 1, 0.2]} },
  { name: 'lining-fasada', role: 'lining', plant: {at: [-0.4444, 0.3366, 0.1617], from: [-0.3985, 0.3877, 0.145], fov: 40, sun: [-0.8, 0.9, -0.3]} },
  { name: 'odbiornik-gora', role: 'orbit', plant: {at: [0, 0.535, 0], from: [0.05, 0.695, 0.04], fov: 42, sun: [0.5, 0.6, 0.5]} },
  { name: 'odbiornik-spod', role: 'orbit', plant: {at: [0, 0.535, 0], from: [0.07, 0.445, 0.055], fov: 45, sun: [0.5, 0.6, 0.5]} },
  { name: 'odbiornik-czasza', role: 'orbit', plant: {at: [0, 0.527, 0], from: [0.035, 0.485, 0.03], fov: 50, sun: [0.5, 0.6, 0.5]} },
  { name: 'odbiornik-modul', role: 'orbit', plant: {at: [0.05, 0.535, 0], from: [0.085, 0.547, 0.03], fov: 40, sun: [0.6, 0.5, 0.4]} },
  { name: 'odbiornik-nadajnik', role: 'orbit', plant: {at: [0, 0.535, 0], from: [0.03, 0.539, 0.022], fov: 40, sun: [0.5, 0.6, 0.5]} },
  { name: 'pierscien-zamkniecia', role: 'beam', plant: {at: [0, 0.34, 0], from: [0.05, 0.37, 0.035], fov: 45, sun: [0.3, 1, 0.4]} },
  { name: 'promien-uderzenie', role: 'beam', plant: {at: [0, 0.5, 0], from: [0.07, 0.47, 0.05], fov: 45, sun: [0.3, 1, 0.4]} },
  { name: 'promien-czolo', role: 'beam', plant: {at: [0, 0.1, 0], from: [0.012, 0.47, 0.006], fov: 30, sun: [0.3, 1, 0.4]} },
  { name: 'promien-bok', role: 'beam', plant: {at: [0, 0.3, 0], from: [0.16, 0.33, 0.09], fov: 40, sun: [0.3, 1, 0.4]} },
  { name: 'promien-wylot', role: 'beam', plant: {at: [0, 0.08, 0], from: [0.07, 0.13, 0.05], fov: 45, sun: [0.3, 1, 0.4]} }
];
const GROUPS = {
  gra: VIEWS.filter((v) => v.game).map((v) => v.name),
  szczegoly: VIEWS.filter((v) => v.plant && !v.role).map((v) => v.name)
};
for (const v of VIEWS) if (v.role) (GROUPS[v.role] ??= []).push(v.name);
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
      if (v.game) {
        if (!window.__slup.viewGame(v.game)) throw new Error('viewGame: brak elektrowni');
      } else if (v.plant) {
        if (!window.__slup.viewPlant(v.plant)) throw new Error('viewPlant: brak elektrowni');
      } else if (v.near) {
        P.camera.up.set(0, 1, 0);
        const latC = lat * D - v.near.tilt * D;
        S.az = siteAz; S.el = latC; S.dist = 1 + (v.near.dist - 1) * skala / 0.3;
        S.look.set(d[0], d[1], d[2]);
        S.fov = 42; S.pora = v.near.pora; S.sunEl = v.near.sunEl;
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
