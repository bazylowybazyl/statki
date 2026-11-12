// A/B STANU ROJU (zmiana kerneli swarmSim.js bez zmiany wyniku): demo dema/roj-webgpu.html w trybie testu, te same
// sceny i liczba klatek, zrzut buforów GPU (drony, kontenery, kolumny) i statystyk symulacji, porównanie dwóch zrzutów.
//
//   node scripts/webgpu/roj-stan-ab.mjs --out .tmp/webgpu/roj-stan/a [--sceny wymiana,port,roj] [--klatki 600] [--tempo 4]
//   node scripts/webgpu/roj-stan-ab.mjs --a .tmp/webgpu/roj-stan/a --b .tmp/webgpu/roj-stan/b
//
// Szum między przebiegami TEGO SAMEGO kodu: wieża (CPU) dostaje stan z odczytu asynchronicznego (1–3 klatki),
// kolejność dronów w komórce siatki zależy od atomików — przebieg sceny rozjeżdża się już w A/A. Dlatego tryb
// JEDNEGO KROKU (deterministyczny test kerneli): `--krok zapis` — scena do klatki K, zapis stanu buforów S, jeden krok
// symulacji z S (bez wieży) → wynik, drugi krok z tego samego S → wynik A/A; `--krok wczytaj --stan <katalog zapisu>`
// (nowe kernele) — S z pliku, jeden krok → wynik; `--kroki N` — N kroków w jednym renderer.compute (jak klatka gry). Porównanie: `--a <zapis> --b <wczytanie> --krok 1`.
import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, repo } from './wspolne.mjs';

const args = parseArgs();

if (args.a && args.b) {
  if (args.krok) compareStep(resolve(repo, args.a), resolve(repo, args.b));
  else compare(resolve(repo, args.a), resolve(repo, args.b));
  process.exit(0);
}

const out = resolve(repo, args.out || '.tmp/webgpu/roj-stan/a');
const scenes = String(args.sceny || 'wymiana,port,roj').split(',');
const frames = Number(args.klatki || 600);
const tempo = Number(args.tempo || 4);
// Kroki symulacji w jednym renderer.compute w trybie --krok (gra: zegar ×4 → 4 kroki na klatkę).
const nSteps = Math.max(1, Number(args.kroki || 1) | 0);
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5412));
const chrome = await startChrome({ width: 1280, height: 720 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
let failed = false;
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/roj-webgpu.html?test=1&dpr=1` });
  if (!await waitFor(cdp, 'window.__demo && (window.__demo.ready === true || window.__demo.error)', 120000)) throw new Error('demo nie wstało');
  await evaluate(cdp, '(async () => { window.__demo.scene("galeria"); await window.__demo.step(8); return true; })()', 600000);
  const BUFS = ['drones', 'tasks', 'units', 'cols'];
  const helpers = `
      const b64 = (ab) => { const u = new Uint8Array(ab); let t = ''; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(t); };
      const unb64 = (t) => { const bin = atob(t); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
      const dump = async (r, s) => { const o = {}; for (const k of ${JSON.stringify(BUFS)}) o[k] = b64(await r.getArrayBufferAsync(s[k].value)); return o; };
      const load = (s, st) => { for (const k of ${JSON.stringify(BUFS)}) { const a = s[k].value; const src = new Uint8Array(unb64(st[k])); new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength).set(src.subarray(0, a.array.byteLength)); a.clearUpdateRanges(); a.needsUpdate = true; } s._tasksFull = false; s._taskDirty.length = 0; s.time = st.time; s.acc = 0; };
      const oneStep = (d) => { d.sim.acc = 0; return d.sim.step(d.renderer, d.sim.tune.dt * ${nSteps}, 1, ${nSteps}); };`;
  for (const sc of (args.krok ? scenes : [])) {
    const stanDir = args.stan ? resolve(repo, args.stan) : null;
    const st = args.krok === 'wczytaj' ? readFileSync(join(stanDir, `${sc}.stan.json`), 'utf8') : 'null';
    const js = `(async () => {
      ${helpers}
      const d = window.__demo;
      d.scene(${JSON.stringify(sc)}); d.speed(${tempo});
      const S0 = ${st};
      if (!S0) for (let k = 0; k < ${frames}; k += 60) await d.step(Math.min(60, ${frames} - k));
      d.pause(true);
      await d.step(2);
      const r = d.renderer, s = d.sim;
      const S = S0 || Object.assign(await dump(r, s), { time: s.time });
      load(s, S);
      oneStep(d);
      const R1 = await dump(r, s);
      let R2 = null;
      if (!S0) { load(s, S); oneStep(d); R2 = await dump(r, s); }
      return JSON.stringify({ count: s.count, S: S0 ? null : S, R1, R2 });
    })()`;
    const j = JSON.parse(await evaluate(cdp, js, 900000));
    if (j.S) writeFileSync(join(out, `${sc}.stan.json`), JSON.stringify(j.S));
    writeFileSync(join(out, `${sc}.krok.json`), JSON.stringify({ count: j.count, R1: j.R1, R2: j.R2 }));
    console.log(`${sc.padEnd(9)} drony ${j.count} · krok zapisany${j.R2 ? ' (z A/A)' : ''}`);
  }
  for (const sc of (args.krok ? [] : scenes)) {
    const js = `(async () => {
      const d = window.__demo;
      d.scene(${JSON.stringify(sc)}); d.speed(${tempo});
      for (let k = 0; k < ${frames}; k += 60) await d.step(Math.min(60, ${frames} - k));
      const r = d.renderer, s = d.sim;
      const b64 = (ab) => { const u = new Uint8Array(ab); let t = ''; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(t); };
      const drones = await r.getArrayBufferAsync(s.drones.value);
      const units = await r.getArrayBufferAsync(s.units.value);
      const cols = await r.getArrayBufferAsync(s.cols.value);
      const st = d.stats();
      return JSON.stringify({ count: s.count, time: s.time, steps: s.steps, done: st.done, total: st.total,
        stats: Array.from(s.stats), drones: b64(drones), units: b64(units), cols: b64(cols) });
    })()`;
    const raw = await evaluate(cdp, js, 900000);
    writeFileSync(join(out, `${sc}.json`), raw);
    const j = JSON.parse(raw);
    console.log(`${sc.padEnd(9)} drony ${j.count} · czas ${j.time.toFixed(1)} s · kroki ${j.steps} · ${j.done ?? '-'} / ${j.total ?? '-'}`);
  }
  const err = await evaluate(cdp, 'document.getElementById("err")?.textContent || ""');
  if (err) { console.log('BŁĄD dema:', err.slice(0, 2000)); failed = true; }
  const errs = logs.errors().filter((l) => !/TimestampQueryPool/.test(l));
  if (errs.length) { console.log('błędy konsoli:', errs.slice(0, 5)); failed = true; }
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  try { await chrome.close(); } catch { /* */ }
  try { await server.close(); } catch { /* */ }
}
process.exit(failed ? 1 : 0);

function compareStep(dirA, dirB) {
  for (const sc of String(args.sceny || 'wymiana,port,roj').split(',')) {
    let A, B;
    try { A = JSON.parse(readFileSync(join(dirA, `${sc}.krok.json`), 'utf8')); B = JSON.parse(readFileSync(join(dirB, `${sc}.krok.json`), 'utf8')); } catch { continue; }
    const cmp = (X, Y) => ['drones', 'tasks', 'units', 'cols'].map((key) => {
      const a = f32(X[key]);
      const b = f32(Y[key]);
      const n = Math.min(a.length, b.length);
      let diff = 0;
      let maxAbs = 0;
      for (let i = 0; i < n; i++) {
        if (Object.is(a[i], b[i]) || a[i] === b[i]) continue;
        diff++;
        const d = Math.abs(a[i] - b[i]);
        if (Number.isFinite(d)) maxAbs = Math.max(maxAbs, d);
      }
      return `${key} ${diff ? `${diff} różnych liczb (max ${maxAbs.toExponential(2)})` : 'bit w bit'}`;
    }).join(' · ');
    console.log(`${sc.padEnd(9)} A/A (ten sam kod, ten sam stan): ${A.R2 ? cmp(A.R1, A.R2) : '—'}`);
    console.log(`${' '.repeat(9)} A/B (kernele A i B, ten sam stan): ${cmp(A.R1, B.R1)}`);
  }
}

function f32(b64) {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function compare(dirA, dirB) {
  for (const sc of String(args.sceny || 'wymiana,port,roj').split(',')) {
    let A, B;
    try { A = JSON.parse(readFileSync(join(dirA, `${sc}.json`), 'utf8')); B = JSON.parse(readFileSync(join(dirB, `${sc}.json`), 'utf8')); } catch { continue; }
    const row = [`${sc.padEnd(9)} kroki ${A.steps}/${B.steps} · zrobione ${A.done ?? '-'}/${B.done ?? '-'} z ${A.total ?? '-'}`];
    for (const key of ['drones', 'units', 'cols']) {
      const a = f32(A[key]);
      const b = f32(B[key]);
      const n = Math.min(a.length, b.length);
      let same = 0;
      for (let i = 0; i < n; i++) if (Object.is(a[i], b[i]) || a[i] === b[i]) same++;
      row.push(`${key} ${(100 * same / Math.max(1, n)).toFixed(2)}% bit w bit`);
    }
    // Pozycje dronów (rekord 11 × vec4, POSE = wektor 0): największa i średnia różnica [j.].
    const da = f32(A.drones);
    const db = f32(B.drones);
    let maxD = 0;
    let sumD = 0;
    const nd = Math.min(A.count, B.count);
    for (let i = 0; i < nd; i++) {
      const o = i * 44;
      const d = Math.hypot(da[o] - db[o], da[o + 1] - db[o + 1], da[o + 2] - db[o + 2]);
      maxD = Math.max(maxD, d);
      sumD += d;
    }
    row.push(`pozycje: max ${maxD.toFixed(3)} j., średnio ${(sumD / Math.max(1, nd)).toFixed(4)} j.`);
    console.log(row.join(' · '));
  }
}
