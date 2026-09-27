// Zgodność liczbowa map ringu WebGL ↔ WebGPU (port WebGPU, zadanie 06, krok 5).
//
// 1) Przebieg (na main = WebGPU, w worktree z tagu webgl-baseline = WebGL — skopiuj
//    tam scripts/webgpu/ring-mapa*.{mjs,html,js}):
//      node scripts/webgpu/ring-mapa.mjs --etykieta webgpu --out .tmp/webgpu/zadania/06/mapa [--port 5342]
//      node scripts/webgpu/ring-mapa.mjs --etykieta webgl  --out <main>/.tmp/webgpu/zadania/06/mapa --port 5345
//    Strona scripts/webgpu/ring-mapa-strona.html buduje mapy jak createHaloRing (bake
//    niskiej → odczyt CPU → budowle i kopuły → setCivic → odczyt), piecze pełną mapę
//    plastrami, tekstury detalu i próbkuje terrainHeightAt ringów-archetypów.
//    Wynik: <out>/<etykieta>/wyniki.json + surowe tablice *.f32.
// 2) Porównanie:
//      node scripts/webgpu/ring-mapa.mjs --porownaj <out>/webgl <out>/webgpu --out <out>
//    → <out>/porownanie.json i porownanie.md (różnice element po elemencie, plany budowli).
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startChrome, attachLogs, waitFor, evaluate, repo, parseArgs } from './wspolne.mjs';

const args = parseArgs();

async function runPage() {
  const label = args.etykieta || 'webgpu';
  const outDir = resolve(repo, args.out || '.tmp/webgpu/zadania/06/mapa', label);
  mkdirSync(outDir, { recursive: true });
  const { createServer } = await import('vite');
  const server = await createServer({
    root: repo, logLevel: 'error',
    server: { port: Number(args.port) || 5342, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } },
    optimizeDeps: { include: ['three', 'three/webgpu', 'three/tsl'] }
  });
  await server.listen();
  const base = `http://localhost:${server.httpServer.address().port}`;
  const chrome = await startChrome({ width: 800, height: 600 });
  const logs = await attachLogs(chrome);
  const q = new URLSearchParams();
  if (args.warianty) q.set('warianty', args.warianty);
  if (args.jakosc) q.set('jakosc', args.jakosc);
  const t0 = Date.now();
  try {
    await chrome.cdp.send('Page.navigate', { url: `${base}/scripts/webgpu/ring-mapa-strona.html?${q}` });
    const ok = await waitFor(chrome.cdp, '!!(window.__mapa && window.__mapa.done)', Number(args.timeout) || 900000, 500);
    if (!ok) throw new Error('strona nie skończyła w czasie');
    const res = await evaluate(chrome.cdp, 'JSON.parse(JSON.stringify({ error: window.__mapa.error, backend: window.__mapa.backend, gpu: window.__mapa.gpu, quality: window.__mapa.quality, results: window.__mapa.results, names: window.__mapa.names() }))');
    if (res.error) throw new Error(res.error);
    for (const { name } of res.names) {
      const data = await evaluate(chrome.cdp, `window.__mapa.get(${JSON.stringify(name)})`, 300000);
      writeFileSync(join(outDir, `${name}.f32`), Buffer.from(data, 'base64'));
    }
    const out = {
      when: new Date().toISOString(), label, backend: res.backend, gpu: res.gpu, quality: res.quality,
      pageMs: Date.now() - t0, results: res.results, arrays: res.names,
      logs: logs.all().filter((l) => !/favicon|DevTools|powerPreference|\[vite\]/.test(l)).slice(0, 60)
    };
    writeFileSync(join(outDir, 'wyniki.json'), JSON.stringify(out, null, 2) + '\n');
    console.log(`${label}: backend ${res.backend} (${res.gpu}), ${res.names.length} tablic → ${outDir}`);
    for (const [k, r] of Object.entries(res.results)) {
      const cpu = r.cpuPost || r.cpuPre || r.grid;
      if (cpu) console.log(`  ${k.padEnd(14)} min ${cpu.min.toFixed(3)} max ${cpu.max.toFixed(3)} śr ${cpu.mean.toFixed(4)} hash ${cpu.hashBits}/${cpu.hash001}`);
      if (r.timings) console.log(`  ${''.padEnd(14)} czasy ${JSON.stringify({ initMs: Math.round(r.timings.initMs), civicMs: Math.round(r.timings.civicMs), fullGpuMs: Math.round(r.timings.fullGpuMs || 0) })}`);
    }
    const errs = out.logs.filter((l) => /error|exception|WGSL|Invalid/i.test(l));
    if (errs.length) console.log('BŁĘDY W KONSOLI:\n' + errs.join('\n'));
  } finally {
    await chrome.close();
    await server.close();
  }
}

// ---------------------------------------------------------------------------
function loadDir(dir) {
  const meta = JSON.parse(readFileSync(join(dir, 'wyniki.json'), 'utf8'));
  const arrays = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.f32')) continue;
    const buf = readFileSync(join(dir, f));
    arrays[f.slice(0, -4)] = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }
  return { meta, arrays };
}

function diffStats(a, b, w = 0) {
  const n = Math.min(a.length, b.length);
  const d = new Float64Array(n);
  let max = 0;
  let at = -1;
  let sum = 0;
  let sum2 = 0;
  let bits = 0;
  const thr = [1e-6, 1e-4, 1e-3, 1e-2, 0.1, 1, 10];
  const over = thr.map(() => 0);
  for (let i = 0; i < n; i++) {
    const x = Math.abs(a[i] - b[i]);
    d[i] = x;
    if (a[i] !== b[i]) bits++;
    if (x > max) { max = x; at = i; }
    sum += x;
    sum2 += x * x;
    for (let k = 0; k < thr.length; k++) if (x > thr[k]) over[k]++;
  }
  const sorted = Array.from(d).sort((p, q) => p - q);
  const pct = (p) => sorted[Math.min(n - 1, Math.floor(n * p))];
  let range = 0;
  for (let i = 0; i < n; i++) range = Math.max(range, Math.abs(a[i]));
  return {
    n, lengthA: a.length, lengthB: b.length, identicalBits: n - bits, differing: bits,
    maxAbs: max, maxAt: at, maxAtXY: w ? [at % w, Math.floor(at / w)] : null, valueAtMax: at >= 0 ? [a[at], b[at]] : null,
    meanAbs: sum / n, rms: Math.sqrt(sum2 / n), p50: pct(0.5), p99: pct(0.99), p999: pct(0.999), p9999: pct(0.9999),
    over: Object.fromEntries(thr.map((t, k) => [`>${t}`, over[k]])), maxAbsValue: range
  };
}

function compareDirs(dirA, dirB, outDir) {
  const A = loadDir(dirA);
  const B = loadDir(dirB);
  const res = { a: { dir: dirA, backend: A.meta.backend, gpu: A.meta.gpu }, b: { dir: dirB, backend: B.meta.backend, gpu: B.meta.gpu }, arrays: {}, plans: {}, stats: {}, timings: {} };
  const widthOf = (name, meta) => {
    const [v, what] = name.split('.');
    const r = meta.results[v] || {};
    if (what.startsWith('cpu')) return r.cpuSize?.w || 2048;
    if (what.startsWith('low')) return r.lowSize?.w || 0;
    if (what.startsWith('full')) return 512;
    if (what === 'grid') return r.gridSize?.w || 2048;
    if (v === 'detail') return 1024;
    return 0;
  };
  for (const name of Object.keys(A.arrays).sort()) {
    if (!B.arrays[name]) { res.arrays[name] = { missing: 'b' }; continue; }
    res.arrays[name] = diffStats(A.arrays[name], B.arrays[name], widthOf(name, A.meta));
  }
  for (const name of Object.keys(B.arrays)) if (!A.arrays[name]) res.arrays[name] = { missing: 'a' };
  for (const [v, ra] of Object.entries(A.meta.results)) {
    const rb = B.meta.results[v] || {};
    if (Array.isArray(ra.landmarks) || Array.isArray(ra.domes)) {
      const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
      const maxDelta = (xs, ys) => {
        let m = 0;
        for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
          m = Math.max(m, Math.abs(xs[i].s - ys[i].s), Math.abs(xs[i].t - ys[i].t), Math.abs(xs[i].h - ys[i].h));
        }
        return m;
      };
      res.plans[v] = {
        landmarks: { a: ra.landmarks?.length || 0, b: rb.landmarks?.length || 0, identical: same(ra.landmarks, rb.landmarks), names: same((ra.landmarks || []).map((o) => o.name), (rb.landmarks || []).map((o) => o.name)), maxDelta: maxDelta(ra.landmarks || [], rb.landmarks || []) },
        domes: { a: ra.domes?.length || 0, b: rb.domes?.length || 0, identical: same(ra.domes, rb.domes), names: same((ra.domes || []).map((o) => o.name), (rb.domes || []).map((o) => o.name)), maxDelta: maxDelta(ra.domes || [], rb.domes || []) }
      };
    }
    const pick = (r) => (r ? { min: r.min, max: r.max, mean: r.mean, std: r.std, hashBits: r.hashBits, hash001: r.hash001, hash01: r.hash01, hash1: r.hash1 } : null);
    res.stats[v] = {
      a: { cpuPre: pick(ra.cpuPre), cpuPost: pick(ra.cpuPost), grid: pick(ra.grid), z0: pick(ra.z0) },
      b: { cpuPre: pick(rb.cpuPre), cpuPost: pick(rb.cpuPost), grid: pick(rb.grid), z0: pick(rb.z0) },
      cpuSize: ra.cpuSize || ra.gridSize || null
    };
    res.timings[v] = { a: ra.timings || (ra.ms != null ? { ms: ra.ms } : null) || (ra.buildMs != null ? { buildMs: ra.buildMs } : null), b: rb.timings || (rb.ms != null ? { ms: rb.ms } : null) || (rb.buildMs != null ? { buildMs: rb.buildMs } : null) };
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'porownanie.json'), JSON.stringify(res, null, 2) + '\n');
  const f = (x, d = 4) => (x == null ? '—' : Math.abs(x) >= 1e4 || (x !== 0 && Math.abs(x) < 1e-3) ? x.toExponential(2) : x.toFixed(d));
  const md = [
    `# Mapy ringu: ${res.a.backend} ↔ ${res.b.backend}`,
    '',
    `A: \`${dirA}\` (${res.a.gpu})  `,
    `B: \`${dirB}\` (${res.b.gpu})`,
    '',
    '| tablica | n | różne bity | maks. |Δ| | średnia |Δ| | p99 | p99,9 | >0,01 | >0,1 | >1 | maks. |wartość| | miejsce maks. |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|'
  ];
  for (const [name, s] of Object.entries(res.arrays)) {
    if (s.missing) { md.push(`| ${name} | brak w ${s.missing} ||||||||||| `); continue; }
    md.push(`| ${name} | ${s.n} | ${s.differing} | ${f(s.maxAbs)} | ${f(s.meanAbs, 6)} | ${f(s.p99)} | ${f(s.p999)} | ${s.over['>0.01']} | ${s.over['>0.1']} | ${s.over['>1']} | ${f(s.maxAbsValue, 1)} | ${s.maxAtXY ? s.maxAtXY.join(',') : s.maxAt} |`);
  }
  md.push('', '## Plany budowli i kopuł (z mapy CPU sprzed placów)', '', '| wariant | megabudowle A/B | identyczne | kopuły A/B | identyczne | maks. Δ s/t/h |', '|---|---|---|---|---|---|');
  for (const [v, p] of Object.entries(res.plans)) {
    md.push(`| ${v} | ${p.landmarks.a}/${p.landmarks.b} | ${p.landmarks.identical ? 'tak' : (p.landmarks.names ? 'nazwy tak, liczby nie' : 'NIE')} | ${p.domes.a}/${p.domes.b} | ${p.domes.identical ? 'tak' : (p.domes.names ? 'nazwy tak, liczby nie' : 'NIE')} | ${f(Math.max(p.landmarks.maxDelta, p.domes.maxDelta), 3)} |`);
  }
  md.push('', '## Statystyki mapy CPU (min / maks / średnia / hasz bitów / hasz 0,01)', '', '| wariant | A | B |', '|---|---|---|');
  for (const [v, s] of Object.entries(res.stats)) {
    const one = (x) => {
      const r = x.cpuPost || x.cpuPre || x.grid;
      return r ? `${f(r.min, 3)} / ${f(r.max, 3)} / ${f(r.mean, 5)} / ${r.hashBits} / ${r.hash001}` : '—';
    };
    md.push(`| ${v} | ${one(s.a)} | ${one(s.b)} |`);
  }
  md.push('', '## Czasy [ms]', '', '```', JSON.stringify(res.timings, null, 1), '```');
  writeFileSync(join(outDir, 'porownanie.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
}

if (args.porownaj) {
  const rest = process.argv.slice(process.argv.indexOf('--porownaj') + 1).filter((a) => !a.startsWith('--'));
  const [dirA, dirB] = rest.length >= 2 ? rest : [args.porownaj, null];
  if (!dirA || !dirB || !existsSync(dirA) || !existsSync(dirB)) throw new Error('--porownaj <katalogA> <katalogB>');
  compareDirs(resolve(repo, dirA), resolve(repo, dirB), resolve(repo, args.out || join(dirB, '..')));
} else {
  await runPage();
}
