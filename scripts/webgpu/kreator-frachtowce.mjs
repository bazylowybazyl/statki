// Zrzuty frachtowców kreatora kadłubów (statki cywilne, `role: 'civil'`) w headless Chrome z GPU (CDP, demo
// dema/kreator-kadluba-webgpu.html, klatki z zegarem ręcznym ?test=1): cały okręt w czystym kadrze, zbliżenie
// największego modułu ładunku (stelaż kontenerów, zasobniki, zbiornik), ten sam kadr przy załadunku 0,5 i 0 (pusty
// pokład — `cargoLoad`, ścieżka wyglądu bez workera). Raport: klasa, ładowność z receptury, pipeline'y synchroniczne.
//
//   node scripts/webgpu/kreator-frachtowce.mjs [--out .tmp/kreator/frachtowce] [--tylko klucz1,klucz2] [--projekt plik.json]
//        [--rozmiar 1600x900] [--bez-zaladunku] [--kadry "x,y,zoom;x,y,zoom…"]
//
// Bez --tylko i --projekt: wszystkie presety cywilne (hullDesignPreset(k).role === 'civil'). Plik --projekt: jeden
// projekt JSON albo tablica projektów (każdy projekt, także wojskowy). --kadry: dodatkowe zbliżenia każdego okrętu
// (środek kadru w j. projektu, zoom = px ekranu na j.), np. rufa z mostkiem i rdzeniem.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';
import { HD_PRESET_KEYS, hullDesignPreset } from '../../src/game/hullDesign/hullDesignPresets.js';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/kreator/frachtowce');
mkdirSync(out, { recursive: true });

const targets = [];
if (args.projekt) {
  const raw = JSON.parse(readFileSync(resolve(repo, String(args.projekt)), 'utf8'));
  (Array.isArray(raw) ? raw : [raw]).forEach((d, i) => targets.push({ key: `projekt${i}`, design: d }));
}
const only = args.tylko ? String(args.tylko).split(',') : null;
for (const k of only || (args.projekt ? [] : HD_PRESET_KEYS.filter((q) => hullDesignPreset(q).role === 'civil'))) {
  if (!HD_PRESET_KEYS.includes(k)) { console.warn('nieznany preset', k); continue; }
  targets.push({ key: k });
}
if (!targets.length) { console.error('brak frachtowców do zrzutu'); process.exit(1); }

const { server, base } = await startVite(Number(args.port || 5432));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { zrzuty: {}, frachtowce: {} };
let nr = 0;

async function shot(name, opis, frames = 4) {
  await ev('window.__kreator.built()');
  await ev(`window.__kreator.runFrames(${frames}, 60)`);
  for (let k = 0; k < 30 && !(await ev('window.__kreator.stats().surfaceReady')); k++) await ev('window.__kreator.runFrames(4, 60)');
  const file = `${String(nr++).padStart(2, '0')}-${name}`;
  await screenshotPng(cdp, join(out, `${file}.png`));
  const st = await ev('window.__kreator.stats()');
  report.zrzuty[file] = { opis, sync: st.syncPipes, t: st.timing && Math.round(st.timing.total) };
  console.log('zrzut', file.padEnd(36), JSON.stringify({ img: st.image, sync: st.syncPipes }));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/dema/kreator-kadluba-webgpu.html?test=1&ui=warsztat` });
  if (!await waitFor(cdp, '!!(window.__kreator && (window.__kreator.ready || window.__kreator.error))', 240000, 400)) throw new Error('demo nie wstało');
  const err = await ev('window.__kreator.error || null');
  if (err) throw new Error(`demo: ${err}`);
  for (const t of targets) {
    if (t.design) await ev(`window.__kreator.load(${JSON.stringify(t.design)})`);
    else await ev(`window.__kreator.preset(${JSON.stringify(t.key)})`);
    await ev('document.body.classList.add("clean"); window.__kreator.setAb(false); window.__kreator.fit()');
    const info = await ev(`(() => {
      const S = window.__kreator.S, f = S.field, r = S.recipe, c = S.cls;
      const mods = f.expanded.modules.filter((m) => m.type === 'cargo' || m.type === 'cargo_tank');
      const big = mods.sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;
      return {
        name: f.expanded.design.name, role: f.expanded.design.role, palette: f.expanded.design.palette,
        length: Math.round(f.bounds.maxX - f.bounds.minX), width: Math.round(f.bounds.maxY - f.bounds.minY), area: Math.round(f.area),
        klasa: c ? { mostek: c.levels.bridge, rdzen: c.levels.core, nazwa: c.label, issues: c.check.issues.map((i) => i.code) } : null,
        ladunek: r ? r.cargo : null, ostrzezenia: r ? r.warnings.map((w) => w.text) : null,
        big: big ? { type: big.type, v: big.v || 0, x: big.x, y: big.y, w: big.w, h: big.h } : null
      };
    })()`);
    report.frachtowce[t.key] = info;
    console.log(t.key, JSON.stringify(info));
    await shot(`${t.key}-okret`, `${info.name}: cały okręt (${info.length} × ${info.width} j., klasa ${info.klasa?.mostek} ${info.klasa?.nazwa || ''})`);
    const kadry = args.kadry ? String(args.kadry).split(';').map((s) => s.split(',').map(Number)) : [];
    for (const [i, [x, y, z]] of kadry.entries()) {
      await ev(`window.__kreator.setCamera(${x}, ${y}, ${z})`);
      await shot(`${t.key}-kadr${i + 1}`, `${info.name}: kadr ${x}, ${y}, zoom ${z}`);
    }
    if (info.big) {
      const z = Math.min(16, W * 0.5 / (2 * Math.max(info.big.w, info.big.h * 1.8)));
      await ev(`window.__kreator.setCamera(${info.big.x}, ${info.big.y}, ${z})`);
      await shot(`${t.key}-ladunek`, `${info.name}: zbliżenie ładunku (${info.big.type} v ${info.big.v}), zoom ${z.toFixed(2)}`);
      if (!args['bez-zaladunku'] && info.big.type === 'cargo' && info.big.v >= 2) {
        for (const load of [0.5, 0]) {
          await ev(`window.__kreator.edit((d) => { d.cargoLoad = ${load}; })`);
          await ev(`window.__kreator.setCamera(${info.big.x}, ${info.big.y}, ${z})`);
          await shot(`${t.key}-zaladunek-${String(load).replace('.', '')}`, `${info.name}: załadunek ${load}`);
        }
        await ev('window.__kreator.edit((d) => { d.cargoLoad = 1; })');
      }
    }
  }
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
