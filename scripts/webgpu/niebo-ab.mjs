// A/B rozdzielczości tła (dema/niebo-webgpu.html, widok „a/b 1:1”): Vite + headless Chrome na GPU.
//
//   node scripts/webgpu/niebo-ab.mjs [--styl mglawica|galaktyka] [--preset gra] [--seed 1] [--set kat=30]
//        [--lupy 1,2] [--pan 400,-110 | auto] [--zoom 0.45] [--okt 0] [--w 1920 --h 1080] [--out .tmp/niebo/ab] [--nazwa ab]
//
// Ten sam kadr gry trzema drogami: (1) tekstura 5120 × 3200 powiększona jak w grze, (2) KAFEL wypieczony w
// gęstości ekranu (piksel kafla = piksel ekranu), (3) kafel + dodatkowe oktawy detalu (--okt, 0 = auto z gęstości).
// Lupa 1 = gra w 1080p (kanwa 1920 × 1080), lupa 2 = gra na ekranie 4K pokazana w 1080 (każdy piksel 4K jako
// piksel zrzutu). Wypiek bez pola gwiazd (gwiazdy=0 — gra rysuje własne w rozdzielczości ekranu), chyba że --set.
// Wyniki: .tmp/niebo/ab/ (poza repo) — pełne kadry i arkusz wycinków 960 × 540 bez skalowania.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, writeJson, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/niebo/ab');
mkdirSync(out, { recursive: true });
const styl = String(args.styl || 'mglawica');
const preset = String(args.preset || 'gra');
const seed = Number(args.seed || 1);
const name = String(args.nazwa || `ab-${styl}-${preset}-${seed}`);
const W = Number(args.w || 1920);
const H = Number(args.h || 1080);
const zoom = Number(args.zoom || 0.45);
const okt = Number(args.okt || 0);
const lupy = String(args.lupy || '1,2').split(',').map(Number).filter((v) => v > 0);
const values = { gwiazdy: 0 };
for (const kv of String(args.set || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  values[k] = v.includes('/') ? v.split('/').map(Number) : Number(v);
}

const { server, base } = await startVite(Number(args.port || 5421));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const saveDataUrl = (url, file) => { writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')); return file; };
const report = { styl, preset, seed, values, zoom, W, H, lupy: [], bledy: [] };
let failed = false;

try {
  await cdp.send('Page.navigate', { url: `${base}/dema/niebo-webgpu.html?test=1&res=1&dpr=1&styl=${encodeURIComponent(styl)}` });
  if (!await waitFor(cdp, 'window.__demo && (window.__demo.ready === true || window.__demo.error)', 240000, 300)) throw new Error('demo nie wstało (timeout)');
  const err0 = await ev('window.__demo.error || ""');
  if (err0) throw new Error(`demo: ${err0}`);
  await ev(`window.__demo.configure(${JSON.stringify({ styl, preset, seed, values })})`);
  const baseMs = await ev('window.__demo.bake()');
  console.log(`tekstura 5120 × 3200: wypiek ${baseMs.toFixed(0)} ms`);
  // Przegląd całej tekstury (1600 × 1000: 1 px = 3,2 teksela) — do wyboru kadru (--pan od środka, w tekselach).
  saveDataUrl(await ev(`window.__demo.snapshot('calosc', 1600, 1000)`), join(out, `${name}-calosc.png`));

  // Kadr: --pan x,y w tekselach tekstury od środka; auto — mgławica: 70% drogi do masy głównej (brzegi kłębów).
  let pan = { x: 0, y: 0 };
  if (args.pan && args.pan !== 'auto') {
    const [x, y] = String(args.pan).split(',').map(Number);
    pan = { x, y };
  } else if (styl === 'mglawica') {
    const P = await ev(`(() => { const s = window.__demo.style; return { ...s.defaults, ...(s.presets[${JSON.stringify(preset)}] || {}), ...${JSON.stringify(values)} }; })()`);
    pan = { x: Math.round(P.srodekX * 3200 * 0.7), y: Math.round(P.srodekY * 3200 * 0.7) };
  }
  report.pan = pan;

  const rows = [];
  for (const lupa of lupy) {
    const r = await ev(`window.__demo.abShots(${JSON.stringify({ w: W, h: H, lupa, pan, zoom, okt, modes: [1, 2, 3] })})`);
    const files = {};
    for (const m of [1, 2, 3]) files[m] = saveDataUrl(r.shots[m], join(out, `${name}-lupa${lupa}-${['tekstura', '1do1', 'detal'][m - 1]}.png`));
    const t = r.tile;
    const ekran = Math.round(t.k * t.rows);
    rows.push({ lupa, shots: r.shots, t, ekran });
    report.lupy.push({ lupa, k: t.k, ekranWierszy: ekran, okt: t.okt, kafelMs: t.ms.map(Math.round), passMs: t.passMs, files });
    console.log(`lupa ×${lupa}: gęstość ${t.k.toFixed(2)}× (jak ekran ${ekran} wierszy) · kafel 1:1 ${t.ms[0].toFixed(0)} ms · +${t.okt} okt. ${t.ms[1].toFixed(0)} ms`);
  }

  // Arkusz: wiersz na lupę = trzy wycinki 960 × 540 ze środka kadru, piksel w piksel (bez skalowania).
  const CW = 960;
  const CH = 540;
  const crop = [Math.round((W - CW) / 2), Math.round((H - CH) / 2), CW, CH];
  const items = [];
  rows.forEach((r, i) => {
    const y = 10 + i * (CH + 10);
    const lbl = [
      `TEKSTURA 5120×3200 powiększona (lupa ×${r.lupa}, jak ekran ${r.ekran} wierszy)`,
      `KAFEL 1:1 (gęstość ${r.t.k.toFixed(2)}×)`,
      `KAFEL 1:1 + ${r.t.okt} okt. detalu`
    ];
    for (let m = 1; m <= 3; m++) items.push({ src: r.shots[m], x: 10 + (m - 1) * (CW + 10), y, w: CW, h: CH, crop, label: lbl[m - 1] });
  });
  const sheet = await ev(`window.__demo.composeSheet(${JSON.stringify({ width: 10 + 3 * (CW + 10), height: 10 + rows.length * (CH + 10), items })})`);
  console.log('arkusz:', saveDataUrl(sheet, join(out, `${name}.png`)));
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
