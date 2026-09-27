// Parzystość biblioteki ringu GLSL (haloRingGLSL.js) ↔ TSL (haloRingTSL.js) na GPU
// (port WebGPU, zadanie 06). Strona scripts/webgpu/ring-tsl-parzystosc-strona.html
// liczy te same funkcje na tych samych wejściach i uniformach w WebGL2 (GLSL) i WebGPU
// (TSL) i porównuje wyniki element po elemencie.
//   node scripts/webgpu/ring-tsl-parzystosc.mjs [--out .tmp/webgpu/zadania/06/parzystosc] [--port 5342] [--planet earth]
// Wynik: <out>/parzystosc.json i parzystosc.md. Narzędzie dla zadań 07–10 (materiały
// ringu na tej bibliotece); znika razem z haloRingGLSL.js.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startChrome, attachLogs, waitFor, evaluate, repo, parseArgs } from './wspolne.mjs';

const args = parseArgs();
const outDir = resolve(repo, args.out || '.tmp/webgpu/zadania/06/parzystosc');
mkdirSync(outDir, { recursive: true });
const { createServer } = await import('vite');
const server = await createServer({
  root: repo, logLevel: 'error',
  server: { port: Number(args.port) || 5342, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } },
  optimizeDeps: { include: ['three', 'three/webgpu', 'three/tsl'] }
});
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 400, height: 300 });
const logs = await attachLogs(chrome);
try {
  const q = new URLSearchParams({ planet: args.planet || 'earth' });
  await chrome.cdp.send('Page.navigate', { url: `${base}/scripts/webgpu/ring-tsl-parzystosc-strona.html?${q}` });
  if (!await waitFor(chrome.cdp, '!!(window.__parz && window.__parz.done)', 600000, 500)) throw new Error('strona nie skończyła');
  const res = await evaluate(chrome.cdp, 'JSON.parse(JSON.stringify(window.__parz))');
  if (res.error) throw new Error(res.error);
  const out = { when: new Date().toISOString(), planet: args.planet || 'earth', ...res, logs: logs.all().filter((l) => !/favicon|DevTools|powerPreference|\[vite\]/.test(l)).slice(0, 40) };
  writeFileSync(join(outDir, 'parzystosc.json'), JSON.stringify(out, null, 2) + '\n');
  const f = (x) => (x === 0 ? '0' : Math.abs(x) < 1e-3 || Math.abs(x) >= 1e4 ? x.toExponential(2) : x.toFixed(5));
  const md = [
    `# Parzystość biblioteki ringu GLSL ↔ TSL (${out.planet})`, '',
    `GLSL: ${res.meta.glsl}  `, `TSL: ${res.meta.tsl}; błędy walidacji WebGPU: ${res.meta.tslErrors?.length || 0}`, '',
    '| funkcja | próbek | identyczne bity | maks. |Δ| | średnia |Δ| | maks. Δ wzgl. | NaN GLSL / TSL |', '|---|---:|---:|---:|---:|---:|---|'
  ];
  for (const [name, r] of Object.entries(res.results)) {
    md.push(`| ${name} | ${r.n} | ${r.identicalPct}% | ${f(r.maxAbs)} | ${f(r.meanAbs)} | ${f(r.maxRel)} | ${r.nanGLSL} / ${r.nanTSL} |`);
  }
  // zadanie 07: zestaw przemysłowy TSL (GPU, float32) ↔ bliźniak JS indKitPart (float64)
  if (res.mirror) {
    const m = res.mirror;
    md.push('', '## Zestaw przemysłowy: TSL na GPU ↔ bliźniak JS (indKitPart)', '',
      `Części: ${m.parts}, rozbieżne decyzje (istnienie, materiał, kształt): **${m.decisionMismatch}**. ` +
      `Wartości: ${m.values}, identyczne po zaokrągleniu JS do float32: ${m.identicalPct}%, maks. ${m.maxUlp} ULP ` +
      `(0: ${m.ulpHist[0]}, 1: ${m.ulpHist[1]}, 2: ${m.ulpHist[2]}, >2: ${m.ulpHist['>2']}), maks. |Δ| ${f(m.maxAbs)}.`);
  }
  writeFileSync(join(outDir, 'parzystosc.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
  const errs = out.logs.filter((l) => /error|exception|WGSL|Invalid/i.test(l));
  if (errs.length) console.log('BŁĘDY:\n' + errs.join('\n'));
} finally {
  await chrome.close();
  await server.close();
}
