// Parzystość tarcz GLSL (tag webgl-baseline) ↔ TSL (gra) na GPU + test `uniformArray` per
// obiekt (port WebGPU, zadanie 14). Strona scripts/webgpu/tarcze-parzystosc-strona.html rysuje
// te same kopuły (obrys kadłuba, sfera), wstęgi i bańki trafień — te same geometrie i wartości
// uniformów — w WebGL2 (GLSL z tagu) i w WebGPU (TSL z gry) do celów RGBA32F i porównuje piksele.
//   node scripts/webgpu/tarcze-parzystosc.mjs [--out .tmp/webgpu/zadania/14/parzystosc] [--port 5347]
// GLSL: `git show webgl-baseline:…` → moduły tagu zapisane w .tmp (importy podmienione) i
// zaimportowane w Node; do strony trafiają same napisy shaderów (w repo nie ma kopii GLSL).
// Wynik: <out>/parzystosc.json, parzystosc.md, <scena>.png (GLSL | TSL | różnica × 8 po ACES gry).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { startChrome, attachLogs, waitFor, evaluate, repo, parseArgs } from './wspolne.mjs';

const args = parseArgs();
const outDir = resolve(repo, args.out || '.tmp/webgpu/zadania/14/parzystosc');
mkdirSync(outDir, { recursive: true });

// ── GLSL z tagu ───────────────────────────────────────────────────────────────
const TAG = 'webgl-baseline';
const tagDir = resolve(repo, '.tmp/webgpu/tarcze-glsl');
mkdirSync(tagDir, { recursive: true });
const show = (p) => execFileSync('git', ['show', `${TAG}:${p}`], { cwd: repo, encoding: 'utf8', maxBuffer: 16 << 20 }).replace(/\r\n/g, '\n');
const fileUrl = (p) => pathToFileURL(resolve(repo, p)).href;

function tagModule(src, name, stubs, exportsList) {
  let s = src;
  for (const [from, to] of stubs) {
    if (!s.includes(from)) throw new Error(`${name}: nie znaleziono „${from}” w źródle tagu`);
    s = s.replace(from, to);
  }
  s += `\nexport { ${exportsList.join(', ')} };\n`;
  const file = join(tagDir, name);
  writeFileSync(file, s);
  return file;
}
const shieldFile = tagModule(show('src/3d/shield3D.js'), 'shield3D.tag.mjs', [
  ["import { Core3D } from './core3d.js';", 'const Core3D = {};'],
  ["import { ShieldImpactFX } from './shieldImpactFx.js';", 'const ShieldImpactFX = {};'],
  ["from '../../shieldSystem.js';", `from '${fileUrl('shieldSystem.js')}';`]
], ['SHIELD_VERTEX', 'SHIELD_FRAGMENT', 'HULL_SHIELD_VERTEX', 'HULL_SHIELD_FRAGMENT']);
const fxFile = tagModule(show('src/3d/shieldImpactFx.js'), 'shieldImpactFx.tag.mjs', [
  ["import { Core3D } from './core3d.js';", 'const Core3D = {};']
], ['VERTEX_SHADER', 'FRAGMENT_SHADER', 'FLASH_VERTEX', 'FLASH_FRAGMENT']);
const tagShield = await import(pathToFileURL(shieldFile).href);
const tagFx = await import(pathToFileURL(fxFile).href);
const glsl = {
  SHIELD_VERTEX: tagShield.SHIELD_VERTEX, SHIELD_FRAGMENT: tagShield.SHIELD_FRAGMENT,
  HULL_SHIELD_VERTEX: tagShield.HULL_SHIELD_VERTEX, HULL_SHIELD_FRAGMENT: tagShield.HULL_SHIELD_FRAGMENT,
  FX_VERTEX: tagFx.VERTEX_SHADER, FX_FRAGMENT: tagFx.FRAGMENT_SHADER,
  FLASH_VERTEX: tagFx.FLASH_VERTEX, FLASH_FRAGMENT: tagFx.FLASH_FRAGMENT
};
for (const [k, v] of Object.entries(glsl)) if (typeof v !== 'string' || v.length < 50) throw new Error(`GLSL tagu: brak ${k}`);

// ── Strona ────────────────────────────────────────────────────────────────────
const { createServer } = await import('vite');
const server = await createServer({
  root: repo, logLevel: 'error',
  server: { port: Number(args.port) || 5347, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } },
  optimizeDeps: { include: ['three', 'three/webgpu', 'three/tsl'] }
});
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 600, height: 400 });
const logs = await attachLogs(chrome);
try {
  await chrome.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__tarczeGlsl = ${JSON.stringify(glsl)};` });
  await chrome.cdp.send('Page.navigate', { url: `${base}/scripts/webgpu/tarcze-parzystosc-strona.html` });
  if (!await waitFor(chrome.cdp, '!!(window.__parz && window.__parz.done)', 600000, 500)) throw new Error('strona nie skończyła');
  const res = await evaluate(chrome.cdp, 'JSON.parse(JSON.stringify(window.__parz))');
  if (res.error) throw new Error(res.error);
  for (const [name, url] of Object.entries(res.images || {})) {
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  delete res.images;
  const out = {
    when: new Date().toISOString(), tag: TAG, ...res,
    logs: logs.all().filter((l) => !/favicon|DevTools|powerPreference|\[vite\]/.test(l)).slice(0, 60)
  };
  writeFileSync(join(outDir, 'parzystosc.json'), JSON.stringify(out, null, 2) + '\n');
  const f = (x) => (x === 0 ? '0' : Math.abs(x) < 1e-3 || Math.abs(x) >= 1e4 ? x.toExponential(2) : x.toFixed(4));
  const md = [
    '# Parzystość tarcz GLSL (tag) ↔ TSL (gra)', '',
    `GLSL: ${res.meta.glsl}  `, `TSL: ${res.meta.tsl}; WebGPU: ${res.meta.webgpu}; cel ${res.meta.rozmiar} RGBA32F bez MSAA`, '',
    '| scena | max |Δ| (HDR) | średnia |Δ| | p99,9 | px świecące | > 2/255 (% świecących) | > 8/255 (% świecących) | energia TSL/GLSL − 1 | NaN GLSL / TSL |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---|'
  ];
  for (const [name, r] of Object.entries(res.results)) {
    md.push(`| ${name} | ${f(r.maxAbs)} | ${f(r.meanAbs)} | ${f(r.p999)} | ${r.litPx} | ${r.over2PctLit.toFixed(3)} | ${r.over8PctLit.toFixed(3)} | ${(r.energyRel * 100).toFixed(4)}% | ${r.nanGL} / ${r.nanGPU} |`);
  }
  md.push('', '## uniformArray per obiekt (wspólny węzeł tablicy w dwóch materiałach jednego grafu)', '',
    '| pakowanie | lewy quad (oczek. 1,0,0) | prawy quad (oczek. 0,1,0) | ten sam klucz programu |', '|---|---|---|---|');
  for (const t of res.uniformArrayTest || []) {
    md.push(`| ${t.perObject ? 'onObjectUpdate (per obiekt)' : 'domyślne (RENDER)'} | ${t.left.join(', ')} | ${t.right.join(', ')} | ${t.sameProgramKey} |`);
  }
  writeFileSync(join(outDir, 'parzystosc.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
  const errs = out.logs.filter((l) => /error|exception|WGSL|Invalid/i.test(l));
  if (errs.length) console.log('BŁĘDY:\n' + errs.join('\n'));
} finally {
  await chrome.close();
  await server.close();
}
