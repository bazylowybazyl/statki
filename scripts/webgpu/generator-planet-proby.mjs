// Próby A/B wyglądu planety generatora na JEDNYM kadrze (dema/generator-planet.html przez CDP): zbliżenie planety,
// potem warianty — fragmenty JS wykonywane na ciele (`B` = S.close.body, `U` = B.uniforms, `G` = window.__gen),
// zrzut po każdym (tekst z `window.__zrzut` → plik .txt obok). Warianty z pliku JSON { nazwa: "kod" } albo `--wariant nazwa=kod` (wiele razy przez ;;).
//
//   node scripts/webgpu/generator-planet-proby.mjs --planeta rocky:3 [--roz 2048] [--kadr 3.2,0.6,0.15] [--pora 90]
//        [--warianty plik.json | --wariant "bez-cienia=U.uGsShade.value.y=0;;bez-normalnych=U.uGsShade.value.x=0"]
//        [--out .tmp/generator-planet/proby] [--szer 1600 --wys 900]
// Każdy wariant startuje od stanu po poprzednim (kod może cofać: `U.uGsShade.value.set(...)`).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/generator-planet/proby');
mkdirSync(out, { recursive: true });
const [type, seed] = String(args.planeta || 'rocky:3').split(':');
const roz = Number(args.roz || 2048);
const pora = Number(args.pora ?? 90);
const kadr = args.kadr ? String(args.kadr).split(',').map(Number) : [3.2, 0.6, 0.15];
let variants = [['bazowy', '']];
if (args.warianty) variants.push(...Object.entries(JSON.parse(readFileSync(resolve(repo, args.warianty), 'utf8'))));
if (args.wariant) for (const part of String(args.wariant).split(';;')) { const i = part.indexOf('='); variants.push([part.slice(0, i), part.slice(i + 1)]); }

const { server, base } = await startVite(Number(args.port || 5433));
const chrome = await startChrome({ width: Number(args.szer || 1600), height: Number(args.wys || 900) });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { planeta: `${type}:${seed}`, warianty: [] };
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/generator-planet.html?test=1&planeta=${type}:${seed}&pora=${pora}&roz=${roz}&doba=0` });
  if (!await waitFor(cdp, '!!(window.__gen && window.__gen.ready())', 600000, 300)) throw new Error('demo nie wstało');
  await ev(`(() => { const G = window.__gen; G.S.dist = ${kadr[0]}; G.S.az = ${kadr[1]}; G.S.el = ${kadr[2]}; return 1; })()`);
  for (const [name, codeStr] of variants) {
    const r = await ev(`(async () => { const G = window.__gen; const B = G.S.close.body; const U = B.uniforms; ${codeStr}; await new Promise((ok) => setTimeout(ok, 700)); return 1; })()`);
    const f = await screenshotPng(cdp, join(out, `${type}-${seed}-${name}.png`));
    // wariant może zostawić tekst do zapisu (np. WGSL z renderer.debug.getShaderAsync) w window.__zrzut
    const dump = await ev('(() => { const d = window.__zrzut; window.__zrzut = null; return typeof d === "string" ? d : null; })()');
    if (dump) writeFileSync(join(out, `${type}-${seed}-${name}.txt`), dump);
    report.warianty.push({ name, kod: codeStr, plik: f, r });
    console.log(name, '→', f);
  }
  report.bledy = logs.errors().slice(0, 40);
} finally {
  writeJson(join(out, 'proby.json'), report);
  await chrome.close();
  await server.close();
}
if (report.bledy?.length) console.log('Błędy:', report.bledy.join('\n'));
process.exit(0);
