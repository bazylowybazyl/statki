// Pętla oceny wypieku nieba (dema/niebo-webgpu.html, src/3d/skybake/): Vite + headless Chrome na GPU.
//
//   node scripts/webgpu/niebo-arkusz.mjs [--styl galaktyka|mglawica] [--warianty gra:1,gra:7,nasycona:3]
//        [--set kat=30,pyl=3.5] [--res 1] [--zoom 0.45] [--ref .tmp/niebo/ref] [--refy 1,2,3,8] [--out .tmp/niebo]
//        [--nazwa arkusz] [--eksport gra:1] [--pola]
//
// Każdy wariant (nastawa:ziarno; styl z --styl albo w wariancie: mglawica/rozeta:3) → wypiek → widoki postem
// gry: GRA (kadr gry przy zoomie, 1920 × 1080), zbliżenie 1:1 środka kadru, MENU (płat mgławicy w tle
// menu), CAŁOŚĆ. Arkusz: wiersz na wariant + wiersz referencji użytkownika (pliki z --ref, poza repo —
// cudze obrazy; domyślnie 1, 2, 3, 8 dla galaktyki i 4, 6, 7, 9 dla mgławicy). Pojedyncze widoki obok
// arkusza. --eksport nastawa:ziarno — tekstura 5120 × 3200 (PNG gotowy w miejsce public/assets/nebula.png).
// Wyniki: .tmp/niebo/ (poza repo).
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, writeJson, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/niebo');
mkdirSync(out, { recursive: true });
const name = args.nazwa || 'arkusz';
const res = Number(args.res || 1);
const zoom = Number(args.zoom || 0.45);
const values = {};
for (const kv of String(args.set || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  values[k] = v.includes('/') ? v.split('/').map(Number) : Number(v);
}
const styl0 = String(args.styl || 'galaktyka');
const parseVariant = (s) => {
  const [head, seed] = s.split(':');
  const [styl, preset] = head.includes('/') ? head.split('/') : [styl0, head];
  return { styl, preset, seed: Number(seed || 1) };
};
const variants = String(args.warianty || 'gra:1').split(',').map(parseVariant);

const MIME = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const refDir = resolve(repo, args.ref || '.tmp/niebo/ref');
const REFS_BY_STYLE = { galaktyka: '1,2,3,8', mglawica: '4,6,7,9' };
const refWanted = String(args.refy || REFS_BY_STYLE[variants[0].styl] || '1,2,3,8').split(',').filter(Boolean);
const refs = [];
if (existsSync(refDir)) {
  const files = readdirSync(refDir);
  for (const id of refWanted) {
    const f = files.find((n) => n.replace(extname(n), '') === id);
    if (f) refs.push({ id, src: `data:${MIME[extname(f).toLowerCase()] || 'image/png'};base64,${readFileSync(join(refDir, f)).toString('base64')}` });
  }
}

const { server, base } = await startVite(Number(args.port || 5420));
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const saveDataUrl = (url, file) => { writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')); return file; };
const report = { res, zoom, values, variants: [], bledy: [] };
let failed = false;

try {
  await cdp.send('Page.navigate', { url: `${base}/dema/niebo-webgpu.html?test=1&res=${res}&styl=${encodeURIComponent(variants[0].styl)}` });
  if (!await waitFor(cdp, 'window.__demo && (window.__demo.ready === true || window.__demo.error)', 240000, 300)) throw new Error('demo nie wstało (timeout)');
  const err0 = await ev('window.__demo.error || ""');
  if (err0) throw new Error(`demo: ${err0}`);
  await ev(`window.__demo.setRes(${res})`);

  const rows = [];
  for (const v of variants) {
    await ev(`window.__demo.configure(${JSON.stringify({ styl: v.styl, preset: v.preset, seed: v.seed, values })})`);
    const ms = await ev('window.__demo.bake()');
    const passMs = await ev('window.__demo.passMs()');
    const tag = `${v.styl === styl0 ? '' : `${v.styl}-`}${v.preset}-${v.seed}`;
    const gra = await ev(`window.__demo.snapshot('gra', 1920, 1080, { zoom: ${zoom}, viewH: 1080 })`);
    const menu = await ev(`window.__demo.snapshot('menu', 1920, 1080)`);
    const calosc = await ev(`window.__demo.snapshot('calosc', 1600, 1000)`);
    saveDataUrl(gra, join(out, `${name}-${tag}-gra.png`));
    saveDataUrl(menu, join(out, `${name}-${tag}-menu.png`));
    saveDataUrl(calosc, join(out, `${name}-${tag}-calosc.png`));
    // --pola: pola wypieku (R = poświata, G = pył τ, B = gęstość gwiazd) — debug kompozycji.
    if (args.pola) saveDataUrl(await ev(`window.__demo.snapshot('pola', 1600, 1000)`), join(out, `${name}-${tag}-pola.png`));
    rows.push({ tag, gra, menu, calosc });
    report.variants.push({ ...v, bakeMs: Math.round(ms), passMs });
    const passy = Object.entries(passMs || {}).map(([k, t]) => `${k} ${Math.round(t)}`).join(', ');
    console.log(`${tag.padEnd(20)} wypiek ${ms.toFixed(0)} ms${passy ? ` (${passy})` : ''}`);
  }

  // Arkusz: wiersz wariantu = GRA 960 × 540 | zbliżenie 1:1 + MENU | CAŁOŚĆ.
  const RH = 560;
  const items = [];
  const texts = [];
  rows.forEach((r, i) => {
    const y = i * RH + 10;
    items.push({ src: r.gra, x: 10, y, w: 960, h: 540, label: `${r.tag} · GRA (zoom ${zoom}, 1080p)` });
    items.push({ src: r.gra, x: 980, y, w: 480, h: 265, crop: [720, 405, 480, 270], label: 'zbliżenie 1:1' });
    items.push({ src: r.menu, x: 980, y: y + 275, w: 480, h: 265, label: 'MENU' });
    items.push({ src: r.calosc, x: 1470, y, w: 864, h: 540, fit: true, label: 'CAŁOŚĆ (kamery 3D)' });
  });
  const refY = rows.length * RH + 10;
  const refH = 420;
  if (refs.length) {
    const cw = Math.floor((2344 - 10 * (refs.length - 1)) / refs.length);
    refs.forEach((r, i) => items.push({ src: r.src, x: 10 + i * (cw + 10), y: refY, w: cw, h: refH, fit: true, label: `referencja ${r.id}` }));
  }
  const sheet = await ev(`window.__demo.composeSheet(${JSON.stringify({ width: 2344, height: refY + (refs.length ? refH + 10 : 0), items, texts })})`);
  const sheetFile = saveDataUrl(sheet, join(out, `${name}.png`));
  console.log('arkusz:', sheetFile);

  if (args.eksport) {
    const { styl, preset, seed } = parseVariant(String(args.eksport));
    await ev(`window.__demo.setRes(1)`);
    await ev(`window.__demo.configure(${JSON.stringify({ styl, preset, seed, values })})`);
    const ms = await ev('window.__demo.bake()');
    // --format png | webp | jpg, --jakosc 0.92 (stratne): ziarno gwiazd w PNG to ~35 MB.
    const fmt = String(args.format || 'png');
    const mime = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' }[fmt] || 'image/png';
    const info = await ev(`window.__demo.exportPrepare(${seed}, ${JSON.stringify(mime)}, ${Number(args.jakosc || 0.92)})`);
    const parts = [];
    for (let i = 0; i < info.chunks; i++) parts.push(await ev(`window.__demo.exportChunk(${i})`));
    const file = join(out, `nebula-${styl === 'galaktyka' ? '' : `${styl}-`}${preset}-${seed}.${fmt}`);
    writeFileSync(file, Buffer.from(parts.join(''), 'base64'));
    report.eksport = { file, ...info, bakeMs: Math.round(ms) };
    console.log(`eksport ${info.width} × ${info.height}: ${file} (${(info.bytes / 1048576).toFixed(1)} MB, wypiek ${ms.toFixed(0)} ms)`);
  }
} catch (err) {
  console.log(String(err?.stack || err));
  failed = true;
} finally {
  report.bledy = logs.errors().filter((l) => !/TimestampQueryPool/.test(l));
  if (report.bledy.length) {
    console.log(`błędy konsoli / WebGPU: ${report.bledy.length}`);
    for (const e of report.bledy.slice(0, 20)) console.log('  ', e.slice(0, 1500));
  }
  writeJson(join(out, `${name}.json`), report);
  await chrome.close();
  await server.close();
}
process.exit(failed || report.bledy.length ? 1 : 0);
