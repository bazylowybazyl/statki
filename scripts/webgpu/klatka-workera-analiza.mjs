// Rozbicie klatki workera renderu (pomiar „dual worker”, 2026-11-02, docs/AUDYT-klatka-workera-2026-11-02.md): profil
// CPU workera (worker.cpuprofile z profil-bitwy-flot.mjs --workerProf 1) + sonda klatki (klatka-workera-sonda.js /
// klatka-workera-odczyt.js — linia „wk zdarzenie” z wynikiem w logu narzędzia). Okna w s od startu bitwy; na okno: liczby
// sondy na klatkę i profil rozbity na moduły renderPage, podfazy renderSingle, kategorie liścia (kod modułów, maszyneria
// Core3D, three, API GPU, wbudowane, GC) i pliki kodu modułów liczące na CPU (kandydaci dla pomocnika bez GPU).
//   node scripts/webgpu/klatka-workera-analiza.mjs --profil <kat>/worker.cpuprofile --log <kat>/przebieg.log
//        [--okna 5:25,35:70] [--szczyt 30] [--top 12] [--funkcje 20] [--json wynik.json]
// --szczyt N — dokłada okno N s z najwyższą średnią całej klatki; --funkcje N — najdroższe funkcje (czas własny)
// przed renderem i w klatce efektów. Profil próbkuje co 500 µs; okna < 10 s dają szum.
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const profile = JSON.parse(readFileSync(opt('profil'), 'utf8'));
const TOP = Number(opt('top', 12));
const FUNKCJE = Number(opt('funkcje', 0));

// --- sonda: wiersze kubełków 5 s
let sonda = null;
for (const line of readFileSync(opt('log'), 'utf8').split(/\r?\n/)) {
  if (!line.startsWith('wk zdarzenie')) continue;
  try { const o = JSON.parse(line.slice(12).trim()); if (o?.wynik?.rows) sonda = o.wynik; } catch { /* inna linia */ }
}
if (!sonda) { console.log('brak wyniku sondy w logu'); process.exit(2); }
// wiersz: [t, k, whole[3], rs[3], rr, rrN, rc, rcN, dr[3], pr, pc, pd]
const rows = sonda.rows.map((r) => ({ t: r[0], k: r[1], whole: r[2], rs: r[3], rr: r[4], rrN: r[5], rc: r[6], rcN: r[7], dr: r[8], pr: r[9], pc: r[10], pd: r[11] }));

// --- profil: węzły, rodzice, czasy próbek
const nodes = new Map();
for (const n of profile.nodes) nodes.set(n.id, { ...n, parent: null });
for (const n of nodes.values()) for (const c of (n.children || [])) nodes.get(c).parent = n;
const fname = (n) => n.callFrame.functionName || '(anon)';
const file = (n) => (n.callFrame.url || '').split('/').pop().split('?')[0];
const label = (n) => `${fname(n)} ${file(n)}`.trim();
const GPU_API = new Set(['writeBuffer', 'writeTexture', 'setBindGroup', 'setPipeline', 'setVertexBuffer', 'setIndexBuffer', 'draw',
  'drawIndexed', 'drawIndirect', 'drawIndexedIndirect', 'dispatchWorkgroups', 'dispatchWorkgroupsIndirect', 'beginRenderPass',
  'beginComputePass', 'end', 'finish', 'submit', 'createBindGroup', 'createBuffer', 'createTexture', 'createView', 'createSampler',
  'copyBufferToBuffer', 'copyTextureToTexture', 'copyBufferToTexture', 'copyTextureToBuffer', 'setViewport', 'setScissorRect',
  'setBlendConstant', 'setStencilReference', 'transferToImageBitmap', 'getCurrentTexture', 'executeBundles', 'resolveQuerySet',
  'writeTimestamp', 'mapAsync', 'getMappedRange', 'unmap', 'onSubmittedWorkDone', 'pushDebugGroup', 'popDebugGroup',
  'createCommandEncoder', 'clearBuffer', 'createQuerySet', 'destroy', 'configure', 'createBindGroupLayout', 'createPipelineLayout']);
// maszyneria renderu w src/ (łaty three, orkiestracja passów, osłony API GPU) — zostaje przy urządzeniu
const MACHINERY = /\/src\/3d\/(core3d|zbieraczZgloszen|rozgrzewka|renderTargetResize)\.js|\/src\/3d\/tsl\/(kluczSwiatel|uuidWezlow|zamiennik)\.js/;
const leafCat = (n) => {
  const url = n.callFrame.url || '', f = fname(n);
  if (f === '(garbage collector)') return 'GC';
  if (f === '(program)') return 'program';
  if (f === '(idle)') return 'idle';
  if (!url) return GPU_API.has(f) ? 'API GPU' : 'wbudowane';
  if (/vite-deps|node_modules/.test(url)) return 'three';
  if (MACHINERY.test(url)) return 'Core3D';
  if (/\/src\//.test(url)) return 'kod modułów';
  return 'inne';
};
const srcFile = (n) => (n.callFrame.url || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/^\/src\//, '');
// stała ścieżka próbki (raz na węzeł): moduł renderPage, podfaza renderSingle, rysunek / compute three
const pathInfo = new Map();
const infoOf = (leaf) => {
  let info = pathInfo.get(leaf.id);
  if (info) return info;
  const chain = []; for (let p = leaf; p; p = p.parent) chain.push(p); // liść → korzeń
  const iRP = chain.findIndex((p) => fname(p) === 'renderPage');
  info = { cat: leafCat(leaf), file: srcFile(leaf), inPage: iRP >= 0, mod: null, sub: null, draw: false, comp: false };
  if (iRP > 0) {
    const mod = chain[iRP - 1]; info.mod = label(mod);
    // owijka sondy (Core3D.renderSingle) stoi między renderPage a oryginałem
    if (/renderSingle$/.test(fname(mod))) {
      info.mod = 'renderSingle (Core3D)';
      const iR = chain.findIndex((p, k) => k < iRP - 1 && fname(p) === 'render' && /core3d/.test(file(p)) && /renderSingle$/.test(fname(chain[k + 1])));
      info.sub = iR > 0 ? fname(chain[iR - 1]) : (iR === 0 ? 'render (własny)' : '(inne)');
    }
    for (let k = 0; k < iRP; k++) {
      const f = fname(chain[k]);
      if (f === '_renderObjectDirect') info.draw = true;
      if (f === 'compute' && /vite-deps|node_modules/.test(chain[k].callFrame.url || '')) info.comp = true;
    }
  } else if (iRP === 0) info.mod = 'renderPage (własny)';
  pathInfo.set(leaf.id, info);
  return info;
};
const { samples, timeDeltas } = profile;
const ts = new Float64Array(samples.length); // s od startu profilu
{ let t = 0; for (let i = 0; i < samples.length; i++) { t += timeDeltas[i]; ts[i] = t / 1e6; } }
const durMs = (i) => (timeDeltas[i + 1] ?? timeDeltas[i]) / 1000;

const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
const add2 = (m, k1, k2, v) => { let s = m.get(k1); if (!s) m.set(k1, s = new Map()); add(s, k2, v); };
const analyze = (a, b) => {
  const R = rows.filter((r) => r.t >= a && r.t + 5 <= b);
  const K = R.reduce((s, r) => s + r.k, 0);
  if (!K) return null;
  const w = (f) => R.reduce((s, r) => s + f(r) * r.k, 0) / K;
  const s = {
    klatek: K, klPerS: +(K / (b - a)).toFixed(1),
    cala: +w((r) => r.whole[0]).toFixed(3), calaP95: +Math.max(...R.map((r) => r.whole[2])).toFixed(3),
    renderSingle: +w((r) => r.rs[0]).toFixed(3), threeRender: +w((r) => r.rr).toFixed(3), threeRenderN: +w((r) => r.rrN).toFixed(1),
    threeCompute: +w((r) => r.rc).toFixed(3), threeComputeN: +w((r) => r.rcN).toFixed(1), rysunki: +w((r) => r.dr[0]).toFixed(1),
    rysunkiP95: Math.max(...R.map((r) => r.dr[2])), pozaRS: { render: +w((r) => r.pr).toFixed(3), compute: +w((r) => r.pc).toFixed(3), rysunki: +w((r) => r.pd).toFixed(1) }
  };
  const mods = new Map(), subs = new Map(), catMods = new Map(), catRS = new Map(), outside = new Map();
  const modCat = new Map(), modFiles = new Map(), fxFiles = new Map(), subCat = new Map();
  const fnPre = new Map(), fnFx = new Map();
  let page = 0, draws = 0, comps = 0, rsT = 0;
  for (let i = 0; i < samples.length; i++) {
    if (ts[i] < a || ts[i] >= b) continue;
    const leaf = nodes.get(samples[i]), info = infoOf(leaf), d = durMs(i);
    if (!info.inPage) { add(outside, ['idle', 'GC', 'program'].includes(info.cat) ? info.cat : 'JS poza renderPage', d); continue; }
    if (FUNKCJE > 0 && (!info.sub || info.sub === '_runFxFrame')) add(info.sub ? fnFx : fnPre, `${fname(leaf)} ${file(leaf)}:${leaf.callFrame.lineNumber + 1}`, d);
    page += d; add(mods, info.mod, d); add2(modCat, info.mod, info.cat, d);
    if (info.sub) {
      rsT += d; add(subs, info.sub, d); add(catRS, info.cat, d); add2(subCat, info.sub, info.cat, d);
      if (info.draw) draws += d; if (info.comp) comps += d;
      if (info.sub === '_runFxFrame' && info.cat === 'kod modułów') add(fxFiles, info.file, d);
    } else {
      add(catMods, info.cat, d);
      if (info.cat === 'kod modułów') add(modFiles, info.file, d);
    }
  }
  const pk = (ms) => +(ms / K).toFixed(3);
  const sorted = (m, n) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => [k, pk(v)]);
  const sum = (m) => [...m.values()].reduce((x, y) => x + y, 0);
  return { okno: `${a}–${b} s`, sonda: s, profil: { renderPage: pk(page), renderSingle: pk(rsT), rysunkiThree: pk(draws), computeThree: pk(comps),
    moduly: sorted(mods, TOP), podfazyRenderSingle: sorted(subs, 10), kategorieModulow: sorted(catMods, 8), kategorieRenderSingle: sorted(catRS, 8),
    pozaRenderPage: sorted(outside, 6),
    modulyKategorie: sorted(mods, 8).filter(([k]) => k !== 'renderSingle (Core3D)').map(([k]) => [k, sorted(modCat.get(k), 5)]),
    podfazyKategorie: sorted(subs, 4).map(([k]) => [k, sorted(subCat.get(k), 5)]),
    plikiModulow: sorted(modFiles, TOP), plikiEfektow: sorted(fxFiles, 8),
    kodModulowRazem: pk(sum(modFiles)), kodEfektowRazem: pk(sum(fxFiles)),
    funkcjePrzed: sorted(fnPre, FUNKCJE), funkcjeEfekty: sorted(fnFx, Math.ceil(FUNKCJE / 2)) } };
};

const windows = String(opt('okna', '')).split(',').filter(Boolean).map((v) => v.split(':').map(Number));
const SZ = Number(opt('szczyt', 0));
if (SZ > 0) {
  // okno SZ s z najwyższą średnią całej klatki (kubełki sondy)
  let best = null;
  for (const r0 of rows) { const a = r0.t, b = a + SZ; const R = rows.filter((r) => r.t >= a && r.t + 5 <= b); if (R.length * 5 < SZ) continue;
    const K = R.reduce((s, r) => s + r.k, 0); const m = R.reduce((s, r) => s + r.whole[0] * r.k, 0) / K; if (!best || m > best.m) best = { a, b, m }; }
  if (best) windows.push([best.a, best.b]);
}
console.log(`sonda: ${sonda.preset}, klatek ${sonda.frames}`);
console.log('kubełki 5 s (t: klatek, cała / renderSingle ms, rysunki):');
console.log('  ' + rows.map((r) => `${r.t}s: ${r.k} ${r.whole[0]}/${r.rs[0]} ${Math.round(r.dr[0])}r`).join(' | '));
const line = (pairs) => pairs.map(([k, v]) => `${k} ${v}`).join(' · ');
const out = [];
for (const [a, b] of windows) {
  const r = analyze(a, b);
  if (!r) { console.log(`\n== ${a}–${b} s: brak klatek`); continue; }
  out.push(r);
  const s = r.sonda, p = r.profil;
  console.log(`\n== okno ${r.okno}: ${s.klatek} klatek (${s.klPerS}/s)`);
  console.log(`sonda [ms/kl]: cała ${s.cala} (p95 kubełków do ${s.calaP95}), renderSingle ${s.renderSingle}, przed renderem ${(s.cala - s.renderSingle).toFixed(3)}`);
  console.log(`  three render() ${s.threeRender} (${s.threeRenderN} wywołań), compute() ${s.threeCompute} (${s.threeComputeN}), rysunki ${s.rysunki}/kl (p95 do ${s.rysunkiP95}); poza renderSingle: render ${s.pozaRS.render}, compute ${s.pozaRS.compute}, rysunki ${s.pozaRS.rysunki}`);
  console.log(`profil [ms/kl]: renderPage ${p.renderPage}, w tym renderSingle ${p.renderSingle} (pod _renderObjectDirect ${p.rysunkiThree}, pod compute three ${p.computeThree})`);
  console.log(`  moduły: ${line(p.moduly)}`);
  console.log(`  podfazy renderSingle: ${line(p.podfazyRenderSingle)}`);
  console.log(`  liść — moduły (bez renderSingle): ${line(p.kategorieModulow)}`);
  console.log(`  liść — renderSingle: ${line(p.kategorieRenderSingle)}`);
  for (const [m, c] of p.modulyKategorie) console.log(`    ${m}: ${line(c)}`);
  for (const [m, c] of p.podfazyKategorie) console.log(`    RS/${m}: ${line(c)}`);
  console.log(`  kod modułów poza renderSingle ${p.kodModulowRazem}: ${line(p.plikiModulow)}`);
  console.log(`  kod modułów w klatce efektów ${p.kodEfektowRazem}: ${line(p.plikiEfektow)}`);
  console.log(`  poza renderPage: ${line(p.pozaRenderPage)}`);
  if (FUNKCJE > 0) {
    const us = (pairs) => pairs.map(([k, v]) => `${String(Math.round(v * 1000)).padStart(6)} µs  ${k}`).join('\n');
    console.log(`  najdroższe funkcje przed renderem (czas własny na klatkę):\n${us(p.funkcjePrzed)}`);
    console.log(`  najdroższe funkcje klatki efektów:\n${us(p.funkcjeEfekty)}`);
  }
}
if (opt('json', null)) (await import('node:fs')).writeFileSync(opt('json'), JSON.stringify({ sonda: { preset: sonda.preset, frames: sonda.frames, rows }, okna: out }, null, 1));
