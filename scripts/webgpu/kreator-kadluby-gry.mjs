// WYPIEK SPRITE'ÓW statków roboczych z kreatora kadłubów do gry (headless Chrome z GPU, demo
// dema/kreator-kadluba-webgpu.html): albedo z kompozytora każdego presetu `src/game/hullDesign/workships/` →
// assets/ships/work/<klucz>.png (dłuższy bok `--bok` px, alfa prosta), a potem tabele kadłubów gry z mocowań projektu
// (dysze, rdzeń, zbiornik, mostek, lampy, osprzęt złomiarski) → src/data/workHulls.js (scripts/kreator-kadluby-tabele.mjs).
// Uruchom po zmianie presetu statku roboczego albo wyglądu kompozytora; sam rachunek tabel (bez przeglądarki):
// node scripts/kreator-kadluby-tabele.mjs --zapisz.
//
//   node scripts/webgpu/kreator-kadluby-gry.mjs [--tylko zlomiarz,dzwig] [--bok 1774] [--bez-tabel]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, repo } from './wspolne.mjs';
import { HD_WORKSHIP_KEYS } from '../../src/game/hullDesign/workships/index.js';

const args = parseArgs();
const side = Number(args.bok || 1774);
const out = resolve(repo, 'assets/ships/work');
mkdirSync(out, { recursive: true });
const keys = (args.tylko ? String(args.tylko).split(',') : HD_WORKSHIP_KEYS).filter((k) => HD_WORKSHIP_KEYS.includes(k));

const { server, base } = await startVite(Number(args.port || 5434));
const chrome = await startChrome({ width: 1280, height: 720, takt: true });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
let fail = null;
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/kreator-kadluba-webgpu.html?test=1&ui=warsztat` });
  if (!await waitFor(cdp, '!!(window.__kreator && (window.__kreator.ready || window.__kreator.error))', 240000, 400)) throw new Error('demo nie wstało');
  const err = await ev('window.__kreator.error || null');
  if (err) throw new Error(`demo: ${err}`);
  for (const k of keys) {
    await ev(`window.__kreator.preset(${JSON.stringify(k)})`);
    await ev('window.__kreator.built()');
    await ev('window.__kreator.runFrames(4, 60)');
    // albedo ostatniego pełnego wypieku (RGBA8 sRGB, alfa prosta, wiersz 0 = góra) → kanwa → PNG w skali `side`
    const r = await ev(`(async () => {
      const b = window.__kreator.S.bake, im = window.__kreator.S.field.image;
      const src = new OffscreenCanvas(b.width, b.height);
      src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(b.albedo), b.width, b.height), 0, 0);
      const k = ${side} / Math.max(b.width, b.height);
      const w = Math.round(b.width * k), h = Math.round(b.height * k);
      const dst = new OffscreenCanvas(w, h);
      const c = dst.getContext('2d');
      c.imageSmoothingQuality = 'high';
      c.drawImage(src, 0, 0, w, h);
      const buf = new Uint8Array(await (await dst.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
      return { w, h, imW: im.w, imH: im.h, png: btoa(s) };
    })()`);
    writeFileSync(join(out, `${k}.png`), Buffer.from(r.png, 'base64'));
    console.log(`${k}: ${r.w} × ${r.h} px (obraz projektu ${r.imW} × ${r.imH} j.) → assets/ships/work/${k}.png`);
  }
  const errs = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l));
  if (errs.length) console.log('błędy strony:', errs.slice(0, 5).join(' | '));
} catch (e) {
  fail = String(e?.stack || e);
  console.log('BŁĄD', fail);
} finally {
  await chrome.close();
  await server.close();
}
if (!fail && !args['bez-tabel']) {
  const r = spawnSync(process.execPath, [join(repo, 'scripts/kreator-kadluby-tabele.mjs'), '--zapisz'], { stdio: 'inherit' });
  if (r.status) fail = 'tabele';
}
process.exit(fail ? 1 : 0);
