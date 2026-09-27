// Uruchamia warsztat dema/webgpu-spike.html w headless Chrome (prawdziwe GPU) pod
// Vite i/lub ze statycznego serwera z import map; zbiera wiersze, błędy konsoli
// i walidacji WebGPU. Wynik: JSON + tabela na stdout.
//
//   node scripts/webgpu/spike.mjs [--tryb vite|statyczny|oba] [--out .tmp/webgpu/spike] [--port 5320]
//        [--q "ciezkie=1"] [--chrome "--enable-dawn-features=use_dxc"] [--etykieta dxc]
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, startStaticServer, attachLogs, waitFor, evaluate, writeJson, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const mode = args.tryb || 'oba';
const outDir = resolve(repo, args.out || '.tmp/webgpu/spike');
const port = Number(args.port || 5320);
const query = args.q ? `?${args.q}` : '';
const extraArgs = args.chrome ? args.chrome.split(/\s+/).filter(Boolean) : [];
const tag = args.etykieta ? `-${args.etykieta}` : '';

async function runOnce(label, base) {
  const chrome = await startChrome({ width: 1600, height: 1000, extraArgs });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  try {
    await cdp.send('Page.navigate', { url: `${base}/dema/webgpu-spike.html${query}` });
    const done = await waitFor(cdp, '!!(window.__spike && window.__spike.done)', 900000, 500);
    const res = await evaluate(cdp, 'JSON.parse(JSON.stringify(window.__spike || null))', 30000);
    await screenshotPng(cdp, join(outDir, `spike-${label}${tag}.png`));
    return { label, done, query, extraArgs, ...res, logs: logs.all() };
  } finally {
    await chrome.close();
  }
}

const runs = [];
if (mode === 'vite' || mode === 'oba') {
  const { server, base } = await startVite(port);
  try { runs.push(await runOnce('vite', base)); } finally { await server.close(); }
}
if (mode === 'statyczny' || mode === 'oba') {
  const st = await startStaticServer(port + 1);
  try { runs.push(await runOnce('statyczny', st.base)); } finally { await st.close(); }
}

const file = writeJson(join(outDir, `wyniki${tag}.json`), { when: new Date().toISOString(), runs });
for (const r of runs) {
  console.log(`\n=== ${r.label} (${r.mode}) — ${r.done ? 'koniec' : 'NIE SKOŃCZYŁ'} ===`);
  for (const row of r.results || []) {
    const ok = row.ok === true ? 'OK ' : row.ok === false ? 'NIE' : String(row.ok).toUpperCase();
    console.log(`${String(row.id).padEnd(4)} ${ok.padEnd(6)} ${row.punkt}`);
    if (row.uwagi) console.log(`            ${String(row.uwagi).replace(/<br>/g, ' ')}`);
    if (row.pomiar) console.log(`            pomiar: ${String(row.pomiar).replace(/<br>/g, ' ')}`);
  }
  if (r.errors?.length) console.log('błędy strony:', r.errors);
  const noisy = (r.logs || []).filter((l) => !/^\[log\] \[spike\]/.test(l));
  if (noisy.length) console.log('logi (bez [spike]):\n  ' + noisy.slice(0, 60).join('\n  '));
}
console.log(`\nwyniki: ${file}`);
process.exit(0);
