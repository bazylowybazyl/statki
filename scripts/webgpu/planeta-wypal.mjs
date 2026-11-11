// Wypalenie planety do PLIKÓW MAP (planety przygotowane — src/3d/planetGen/planetGenFiles.js): demo planety piecze
// planetę w zadanej rozdzielczości, zapisuje mapy do plików, a skrypt ściąga je na dysk.
//   node scripts/webgpu/planeta-wypal.mjs --nazwa terran-21 [--styl terran --ziarno 21 --mapa 8192 --rzeki 4096
//        --out .tmp/planety/<nazwa> --q "chmury=0.33"]
// Podgląd: dema/planeta-zblizenie.html?plik=<nazwa>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, repo } from './wspolne.mjs';

const args = parseArgs();
const nazwa = String(args.nazwa || `${args.styl || 'terran'}-${args.ziarno || 'bohater'}`);
const out = resolve(repo, args.out || `.tmp/planety/${nazwa}`);
mkdirSync(out, { recursive: true });
const { server, base } = await startVite(Number(args.port || 5467));
const chrome = await startChrome({ width: 1280, height: 720 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 900000) => evaluate(cdp, e, t);
const CHUNK = 3 * 1024 * 1024;
try {
  const q = new URLSearchParams({
    test: '1', erupcja: '0', pogoda: 'off', wycinki: '0', wycinek: '2048', ultra: '0',
    styl: String(args.styl || 'terran'), mapa: String(args.mapa || 8192), rzeki: String(args.rzeki || 4096)
  });
  if (args.ziarno != null) q.set('ziarno', String(args.ziarno));
  if (args.q) for (const [k, v] of new URLSearchParams(String(args.q))) q.set(k, v);
  await cdp.send('Page.navigate', { url: `${base}/dema/planeta-zblizenie.html?${q}` });
  if (!await waitFor(cdp, '!!(window.__zbl && window.__zbl.ready())', 900000, 500)) throw new Error('demo nie wstało');
  const bake = JSON.parse(await ev('(() => { const b = window.__zbl.S.baked; return JSON.stringify({ mapa: b.size, rzeki: b.drainage && b.drainage.width, ms: b.ms, rodzaj: b.spec.type, ziarno: b.spec.seed }); })()'));
  console.log('wypiek:', JSON.stringify(bake));
  const res = await ev(`window.__zbl.exportPlanet(${JSON.stringify(nazwa)})`);
  let total = 0;
  for (const f of res.files) {
    const parts = [];
    for (let off = 0; off < f.size; off += CHUNK) {
      parts.push(Buffer.from(await ev(`window.__zbl.exportChunk(${JSON.stringify(f.name)}, ${off}, ${CHUNK})`), 'base64'));
    }
    const buf = Buffer.concat(parts);
    if (buf.length !== f.size) throw new Error(`${f.name}: ${buf.length} B zamiast ${f.size}`);
    writeFileSync(join(out, f.name), buf);
    total += buf.length;
    console.log(`  ${f.name.padEnd(18)} ${(buf.length / 1048576).toFixed(2).padStart(8)} MB`);
  }
  console.log(`razem ${(total / 1048576).toFixed(1)} MB w ${out} · zapis w przeglądarce ${res.meta.exportMs} ms`);
  const errs = logs.errors().filter((l) => !/favicon|TimestampQueryPool/.test(l));
  if (errs.length) console.log('Dziennik:\n' + errs.slice(0, 10).join('\n'));
} finally { await chrome.close(); await server.close(); }
process.exit(0);
