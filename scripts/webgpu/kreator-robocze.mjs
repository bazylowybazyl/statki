// Zrzuty STATKÓW ROBOCZYCH kreatora kadłubów (złomowanie — src/game/hullDesign/workships/) w headless Chrome z GPU
// (CDP, demo dema/kreator-kadluba-webgpu.html, klatki z zegarem ręcznym ?test=1): każdy statek w czystym kadrze,
// zbliżenia jego gniazd pod ruchome części (obrotnice, paszcza, gardziel młyna, rampa, dampery, kosz) i PLANSZA
// wszystkich statków w jednej skali z podpisami (klasa, wymiary) oraz tabelą osprzętu dla gry (hullDesignWorkRig).
// Jeden przebieg, bez pomiarów wydajności.
//
//   node scripts/webgpu/kreator-robocze.mjs [--out .tmp/kreator/robocze] [--tylko zlomiarz,dzwig] [--rozmiar 1600x900]
//        [--bez-zblizen] [--bez-stoczni] [--zaladunek 0.8]
//
// Wynik: NN-<klucz>-okret.png, NN-<klucz>-<gniazdo>.png, NN-stocznia.png (preset i karty osprzętu w Stoczni), plansza.png, osprzet.json (tabele osprzętu), raport.json
// (klasa, wymiary, ostrzeżenia receptury, pipeline'y synchroniczne w klatkach, błędy strony).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';
import { hullDesignPreset } from '../../src/game/hullDesign/hullDesignPresets.js';
import { HD_WORKSHIP_KEYS } from '../../src/game/hullDesign/workships/index.js';
import { buildHullField } from '../../src/game/hullDesign/hullDesignGeometry.js';
import { hullDesignWorkRig } from '../../src/game/hullDesign/hullDesignWorkRig.js';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/kreator/robocze');
mkdirSync(out, { recursive: true });
const keys = (args.tylko ? String(args.tylko).split(',') : HD_WORKSHIP_KEYS).filter((k) => HD_WORKSHIP_KEYS.includes(k));
if (!keys.length) { console.error('brak statków roboczych do zrzutu:', HD_WORKSHIP_KEYS.join(', ')); process.exit(1); }

// tabele osprzętu (czyste moduły — bez przeglądarki)
const rigs = {};
for (const k of keys) rigs[k] = hullDesignWorkRig(buildHullField(hullDesignPreset(k), { pipes: false }));
writeFileSync(join(out, 'osprzet.json'), JSON.stringify(rigs, null, 2) + '\n');

/** Zbliżenia gniazd statku: [nazwa, typ modułu, warunek] — największy moduł typu (po polu). */
const CLOSEUPS = [
  ['paszcza', (m) => m.type === 'maw'], ['mlyn', (m) => m.type === 'mill'], ['rampa', (m) => m.type === 'ramp'],
  ['dzwig', (m) => m.type === 'rig' && m.v === 1], ['wysiegnik', (m) => m.type === 'rig' && (m.v || 0) === 0],
  ['damper', (m) => m.type === 'damper'], ['kosz', (m) => m.type === 'cargo' && m.v === 4]
];

const { server, base } = await startVite(Number(args.port || 5433));
const chrome = await startChrome({ width: W, height: H, takt: true });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { zrzuty: {}, statki: {} };
let nr = 0;

async function shot(name, opis, frames = 4) {
  await ev('window.__kreator.built()');
  await ev(`window.__kreator.runFrames(${frames}, 60)`);
  for (let k = 0; k < 30 && !(await ev('window.__kreator.stats().surfaceReady')); k++) await ev('window.__kreator.runFrames(4, 60)');
  const file = `${String(nr++).padStart(2, '0')}-${name}`;
  await screenshotPng(cdp, join(out, `${file}.png`));
  const st = await ev('window.__kreator.stats()');
  report.zrzuty[file] = { opis, sync: st.syncPipes };
  console.log('zrzut', file.padEnd(34), JSON.stringify({ img: st.image, sync: st.syncPipes }));
  return `${file}.png`;
}

const board = [];
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/kreator-kadluba-webgpu.html?test=1&ui=warsztat` });
  if (!await waitFor(cdp, '!!(window.__kreator && (window.__kreator.ready || window.__kreator.error))', 240000, 400)) throw new Error('demo nie wstało');
  const err = await ev('window.__kreator.error || null');
  if (err) throw new Error(`demo: ${err}`);
  // wspólna skala planszy: najdłuższy statek wypełnia 92% szerokości kadru
  const maxL = Math.max(...keys.map((k) => rigs[k].L));
  const maxW = Math.max(...keys.map((k) => rigs[k].L * rigs[k].W));
  const zoomAll = Math.min(W * 0.92 / maxL, H * 0.92 / maxW);
  for (const k of keys) {
    await ev(`window.__kreator.preset(${JSON.stringify(k)})`);
    if (args.zaladunek !== undefined) await ev(`window.__kreator.edit((d) => { d.cargoLoad = ${Number(args.zaladunek)}; })`);
    await ev('document.body.classList.add("clean"); window.__kreator.setAb(false); window.__kreator.fit()');
    const info = await ev(`(() => {
      const S = window.__kreator.S, f = S.field, r = S.recipe, c = S.cls;
      return {
        name: f.expanded.design.name, role: f.expanded.design.role, palette: f.expanded.design.palette,
        length: Math.round(f.bounds.maxX - f.bounds.minX), width: Math.round(f.bounds.maxY - f.bounds.minY), area: Math.round(f.area),
        cx: (f.bounds.minX + f.bounds.maxX) / 2, cy: (f.bounds.minY + f.bounds.maxY) / 2,
        klasa: c ? { mostek: c.levels.bridge, rdzen: c.levels.core, nazwa: c.label, issues: c.check.issues.map((i) => i.code), gniazda: c.mounts.length, zapas: Math.round(c.power.spareFrac * 100) } : null,
        ladunek: r ? r.cargo : null, ostrzezenia: r ? r.warnings.map((w) => w.text) : null,
        mods: f.expanded.modules.map((m) => ({ type: m.type, v: m.v || 0, x: m.x, y: m.y, w: m.w || m.r, h: m.h || m.r }))
      };
    })()`);
    const mods = info.mods; delete info.mods;
    report.statki[k] = info;
    console.log(k, JSON.stringify(info));
    const opis = `${info.name}: ${info.length} × ${info.width} j., klasa ${info.klasa?.mostek} ${info.klasa?.nazwa || ''}`;
    await shot(`${k}-okret`, opis);
    // kadr planszy: wspólna skala wszystkich statków
    await ev(`window.__kreator.setCamera(${info.cx}, ${info.cy}, ${zoomAll})`);
    board.push({ key: k, file: await shot(`${k}-skala`, `${opis} (wspólna skala planszy)`), info });
    if (!args['bez-zblizen']) {
      for (const [name, pred] of CLOSEUPS) {
        const big = mods.filter(pred).sort((a, b) => b.w * b.h - a.w * a.h)[0];
        if (!big) continue;
        const z = Math.min(14, Math.min(W * 0.42 / (2 * big.w), H * 0.5 / (2 * big.h)));
        await ev(`window.__kreator.setCamera(${big.x}, ${big.y}, ${z})`);
        await shot(`${k}-${name}`, `${info.name}: gniazdo „${name}” (${big.type} v ${big.v}), zoom ${z.toFixed(2)}`);
      }
    }
  }
  // STOCZNIA (przyjazny edytor): grupa „Statki robocze” na liście presetów, preset wczytany z listy, karty osprzętu
  // roboczego w zakładce Systemy (miniatury z kompozytora)
  if (!args['bez-stoczni']) {
    await ev('document.body.classList.remove("clean"); window.__kreator.setUi("stocznia")');
    const yard = await ev(`(() => {
      const sel = document.getElementById('yard-preset');
      const groups = [...sel.querySelectorAll('optgroup')].map((g) => ({ label: g.label, keys: [...g.querySelectorAll('option')].map((o) => o.value) }));
      sel.value = ${JSON.stringify(keys[keys.length - 1])}; sel.dispatchEvent(new Event('change'));
      return groups;
    })()`);
    await ev('window.__kreator.stocznia.cat("systemy")');
    await ev('window.__kreator.built()');
    await ev('window.__kreator.runFrames(6, 60)');
    const thumbs = await ev('window.__kreator.stocznia.thumbsDone()');
    const cards = await ev(`[...document.querySelectorAll('.ycard')].map((c) => c.dataset.key).filter((k) => /^mod:(rig|maw|mill|ramp|damper):/.test(k))`);
    report.stocznia = { grupa: yard.find((g) => keys.every((k) => g.keys.includes(k)))?.label || null, grupy: yard.map((g) => `${g.label} (${g.keys.length})`), kartyOsprzetu: cards, miniatury: thumbs };
    console.log('stocznia', JSON.stringify(report.stocznia));
    await shot('stocznia', 'Stocznia: preset z grupy „Statki robocze”, zakładka Systemy z kartami osprzętu roboczego', 6);
    if (!report.stocznia.grupa || cards.length < 6) throw new Error('Stocznia: brak grupy presetów albo kart osprzętu roboczego');
  }
  // PLANSZA: strona z kadrami w jednej skali i podpisami (plik obok zrzutów — obrazy względne)
  const rzym = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
  const fmt = (v) => (Array.isArray(v) ? `[${v.map(fmt).join('; ')}]` : (typeof v === 'number' ? String(v).replace('.', ',') : String(v)));
  const cards = board.map(({ key, file, info }) => {
    const rig = rigs[key];
    const rows = Object.entries(rig).filter(([f]) => f !== 'L' && f !== 'W').map(([f, v]) => `<b>${f}</b> ${fmt(v)}`).join(' · ');
    return `<figure><img src="${file}"><figcaption><h2>${info.name}</h2><p>klasa ${rzym[info.klasa.mostek]} (${info.klasa.nazwa}) · ${info.length} × ${info.width} j. · ${info.area.toLocaleString('pl-PL')} j² · gniazd broni ${info.klasa.gniazda} · ładownia ${info.ladunek.tonnes} t</p><p class="rig">${rows}</p></figcaption></figure>`;
  }).join('');
  const html = `<!doctype html><meta charset="utf-8"><title>Statki robocze</title><style>
    body{margin:0;background:#0a0c0f;color:#d9dde2;font:15px/1.35 system-ui,Segoe UI,sans-serif}
    h1{margin:14px 22px 2px;font-size:24px;font-weight:600;color:#ecb21e} .sub{margin:0 22px 8px;color:#8e959c}
    main{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:0 14px 14px}
    figure{margin:0;background:#101317;border:1px solid #23282e;border-radius:6px;overflow:hidden}
    img{display:block;width:100%} figcaption{padding:6px 12px 9px} h2{margin:0;font-size:19px;font-weight:600}
    p{margin:2px 0 0;color:#aab0b6} .rig{font:12px/1.4 ui-monospace,Consolas,monospace;color:#868d94} .rig b{color:#c9a13a;font-weight:600}
  </style><h1>Statki robocze złomowania — kreator kadłubów</h1>
  <p class="sub">Wspólna skala (${(1 / zoomAll).toFixed(2)} j. na piksel kadru). Osprzęt w ułamkach długości kadłuba: x — dziób, y — prawa burta, początek w środku kadłuba.</p>
  <main>${cards}</main>`;
  writeFileSync(join(out, 'plansza.html'), html);
  const cols = 2, cardW = 1100;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: cols * cardW, height: 1200, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: pathToFileURL(join(out, 'plansza.html')).href });
  await waitFor(cdp, 'document.readyState === "complete" && [...document.images].every((i) => i.complete && i.naturalWidth > 0)', 60000, 200);
  const hh = await ev('Math.ceil(document.documentElement.scrollHeight)');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: cols * cardW, height: hh, deviceScaleFactor: 1, mobile: false });
  await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  await screenshotPng(cdp, join(out, 'plansza.png'));
  console.log('plansza', join(out, 'plansza.png'), `${cols * cardW} × ${hh}`);
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 20);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.log('BŁĄD', report.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
const sync = Object.values(report.zrzuty).reduce((m, z) => Math.max(m, z.sync || 0), 0);
console.log('pipeline’y synchroniczne w klatkach (maks.):', sync);
console.log('błędy strony:', (report.bledy || []).length, (report.bledy || []).slice(0, 5).join(' | '));
process.exit(report.blad ? 1 : 0);
