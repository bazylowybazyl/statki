// SONDA fizyki gazu wybuchów (src/3d/gas/gasGrid.js — GasGrid.probe) na demie dema/wybuchy-webgpu.html: liczby zamiast
// zrzutów przy zmianach kerneli (adwekcja, siły, ciśnienie). Czas wirtualny harnessu (klatka = 1/60 s), te same ziarna.
//
//   node scripts/webgpu/wybuchy-sonda.mjs [--przypadki capital,final,chain] [--klatki 0.1,0.25,…] [--out .tmp/wybuchy-sonda]
//        [--gaz k=v,…] (fizyka gazu: grid.tune) [--tune k=v,…] (EXPLOSION_TUNE) [--port 5297] [--przeszkody 0]
//        [--warianty 'nazwa@k=v,k=v|nazwa2@…'] (każdy wariant: te same przypadki od nowa; klucze grid.tune, `rez.k` —
//        strojenie reżysera gazu GasExplosions.tune; wariant startuje ze strojenia sprzed wariantów + --gaz)
//
// Na każdą chwilę: suma po aktywnych domenach — energia Σ|v|² i w dymie Σs|v|² [kom.²/s²], masa dymu Σs, Σ T, maks.
// prędkość, maks. |ω| i średnie |ω| w dymie, niedobieżność rzutu |div v − cel| (średnia we wnętrzu i maks.), NaN.
// Stabilność: energia nie może rosnąć po wygaśnięciu źródeł, NaN = 0, maks. prędkość ≤ sufit (maxSpeed).
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const cases = String(args.przypadki || 'capital,final,chain').split(',');
const times = String(args.klatki || '0.1,0.25,0.5,0.75,1,1.5,2,2.5,3,4,5').split(',').map(Number);
const chainTimes = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9];
const outDir = resolve(repo, args.out || '.tmp/wybuchy-sonda');
mkdirSync(outDir, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const SIZES = { escort: 160, cruiser: 220, capital: 300, final: 320 };
const kv = (str) => Object.fromEntries(String(str || '').split(',').filter(Boolean).map((p) => {
  const [k, v] = p.split('=');
  return [k, v === 'true' ? true : v === 'false' ? false : Number(v)];
}));

const { server, base } = await startVite(Number(args.port || 5297));
const chrome = await startChrome({ width: 1280, height: 720 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { gaz: kv(args.gaz), tune: kv(args.tune), cases: [] };

// Suma sond po aktywnych domenach (GPU → CPU).
const probeAll = () => ev(`(async () => {
  const g = window.__demo.fx.grid, r = window.Core3D.renderer;
  const t = { domeny: 0, sMax: 0, TMax: 0, ke: 0, keS: 0, mass: 0, vol: 0, rG: 0, r2m: 0, heat: 0, speed: 0, wMax: 0, wS: 0, divRes: 0, divResMax: 0, nan: 0 };
  // Wielkości bez jednostek komórek (etap D: skala komórki domeny k — GasSlot.k): masa / k³, energia w dymie / k⁵,
  // objętość / k³, promień obłoku / k, prędkość / k — porównanie siatek o różnej rozdzielczości (domainScale, „fine”).
  // Brzeg: dym w zewnętrznych 10% profili przez środek domeny (xy) i w pionie (z) / maks. profilu — kula mieści się w domenie.
  t.massN = 0; t.keSN = 0; t.volN = 0; t.r2mN = 0; t.speedN = 0; t.brzeg = 0; t.brzegZ = 0;
  for (const s of g.slots) {
    if (!s.active) continue;
    const p = await g.probe(r, s.gid ?? s.index);
    const k = s.k || 1, k3 = k * k * k;
    t.massN += p.sum.mass / k3; t.keSN += p.sum.keS / (k3 * k * k); t.volN += p.sum.vol / k3;
    t.r2mN += (p.sum.rG / k) * (p.sum.rG / k) * (p.sum.mass / k3); t.speedN = Math.max(t.speedN, p.max.speed / k);
    for (const ax of ['x', 'y', 'z']) {
      const A = p.axes[ax], n = A.length, m = Math.max(1e-6, ...A.map((q) => q.smoke));
      let e = 0;
      for (let j = 0; j < n; j++) if (j < n * 0.1 || j >= n * 0.9) e = Math.max(e, A[j].smoke);
      if (ax === 'z') t.brzegZ = Math.max(t.brzegZ, e / m); else t.brzeg = Math.max(t.brzeg, e / m);
    }
    t.domeny++; t.nan += p.nan;
    t.ke += p.sum.ke; t.keS += p.sum.keS; t.mass += p.sum.mass; t.heat += p.sum.heat; t.vol += p.sum.vol; t.r2m += p.sum.rG * p.sum.rG * p.sum.mass;
    t.speed = Math.max(t.speed, p.max.speed); t.sMax = Math.max(t.sMax, p.max.smoke); t.TMax = Math.max(t.TMax, p.max.T); t.wMax = Math.max(t.wMax, p.sum.wMax);
    t.wS += p.sum.wSmoke * p.sum.mass; t.divRes += p.sum.divRes; t.divResMax = Math.max(t.divResMax, p.sum.divResMax);
  }
  t.wSmoke = t.mass > 1e-6 ? t.wS / t.mass : 0;
  t.rG = t.mass > 1e-6 ? Math.sqrt(t.r2m / t.mass) : 0;
  t.rGN = t.massN > 1e-6 ? Math.sqrt(t.r2mN / t.massN) : 0;
  delete t.r2m; delete t.r2mN;
  t.divRes = t.domeny ? t.divRes / t.domeny : 0;
  delete t.wS;
  for (const k of Object.keys(t)) t[k] = +Number(t[k]).toPrecision(4);
  return t;
})()`);

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  // --siatka k=v,… — nadpisanie EXPLOSION_GRID w demie (A/B: alias=0 — dawne 12 atlasów; fineSlots=0 — bez atlasu „fine”)
  await cdp.send('Page.navigate', { url: `${base}/dema/wybuchy-webgpu.html?shot=1${args.siatka ? `&siatka=${encodeURIComponent(String(args.siatka))}` : ''}` });
  if (!await waitFor(cdp, '!!(window.__demo && window.__demo.ready && window.__harness)', 240000, 400)) throw new Error('demo nie wstało');
  await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
  await waitFor(cdp, 'window.__demo.proxiesReady()', 120000, 300);
  await sleep(2000);
  await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
  // --przeszkody 0: demo bez przeszkód gazu (ścieżka kerneli bez masek — porównanie bit w bit z przebiegami sprzed etapu C)
  if (String(args.przeszkody) === '0') await ev('(() => { window.__demo.obst.on = false; window.__demo.obst.ships = false; return true; })()');
  await ev(`(() => { Object.assign(window.__demo.tune, ${JSON.stringify(kv(args.tune))}); Object.assign(window.__demo.fx.grid.tune, ${JSON.stringify(kv(args.gaz))});
    window.__sondaBase = { gaz: { ...window.__demo.fx.grid.tune }, rez: { ...window.__demo.fx.director.tune } }; return true; })()`);
  const variants = String(args.warianty || 'bazowy@').split('|').map((w) => {
    const [name, rest = ''] = w.split('@');
    const all = kv(rest);
    const gaz = {}, rez = {};
    for (const [k, v] of Object.entries(all)) { if (k.startsWith('rez.')) rez[k.slice(4)] = v; else gaz[k] = v; }
    return { name, gaz, rez };
  });
  report.warianty = [];
  for (const W of variants) {
  await ev(`(() => { const b = window.__sondaBase, x = window.__demo.fx;
    Object.assign(x.grid.tune, b.gaz, ${JSON.stringify(W.gaz)}); Object.assign(x.director.tune, b.rez, ${JSON.stringify(W.rez)}); return true; })()`);
  console.log('--- wariant', W.name, JSON.stringify(W));
  report.cases = [];
  for (const kind of cases) {
    await ev(`(async () => {
      const d = window.__demo, h = window.__harness;
      d.clear(); h.reseed(0x5eed1234); await h.step(30);
      if ('${kind}' === 'chain') d.scene('chain');
      else { d.cam(d.gallery.x, d.gallery.y, 0.3); d.boomAt('${kind}', 0, 0, ${SIZES[kind] || 300}); }
      return true;
    })()`);
    const rows = [];
    let tNow = 0;
    for (const at of (kind === 'chain' ? chainTimes : times)) {
      await ev(`window.__harness.step(${Math.max(1, Math.round((at - tNow) * 60))})`);
      tNow = at;
      const p = await probeAll();
      const st = await ev('(() => { const s = window.__demo.stats(); return { spawned: s.spawned, gas: s.gas, particles: s.particles, merged: s.merged, inh: s.inherited, noSlot: s.noSlot }; })()');
      rows.push({ t: at, ...p, ...(kind === 'chain' ? st : {}) });
      console.log(`${W.name}:${kind}`.padEnd(18), JSON.stringify(rows.at(-1)));
    }
    report.cases.push({ kind, rows });
  }
  report.warianty.push({ ...W, cases: report.cases });
  }
  // Kontrola WGSL kerneli gazu zbudowanych w przeglądarce: three r183 potrafił w kernelu budowanym późno podstawić
  // w miejsce stałej `f32(instanceIndex)` (2026-10-08, sonda — niedeterministycznie). W kernelach gazu nie ma
  // prawa się pojawić.
  report.wgsl = await ev(`(() => {
    const r = window.Core3D.renderer, g = window.__demo.fx.grid;
    const names = ['curlNode', 'advectNode', 'reactNode', 'divNode', 'jacAB', 'jacBA', 'projectNode', 'clearNode', 'lightNode', '_probeLineNode', '_probeMaxNode', '_probeSumNode'];
    const out = {};
    for (const n of names) {
      const node = g[n];
      if (!node) continue;
      let code = '';
      try { code = r._nodes.getForCompute(node).computeShader || ''; } catch (e) { out[n] = 'błąd: ' + e.message; continue; }
      out[n] = (code.match(/f32\\( instanceIndex \\)/g) || []).length;
    }
    return out;
  })()`);
  const bad = Object.entries(report.wgsl).filter(([, v]) => v !== 0);
  console.log('WGSL kerneli gazu', bad.length ? `SKAŻONE: ${JSON.stringify(bad)}` : 'czyste', JSON.stringify(report.wgsl));
} catch (e) {
  report.wyjatek = String(e.stack || e);
  console.log('BŁĄD', e.stack || e.message);
} finally {
  report.errors = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference/.test(l)).slice(0, 40);
  if (report.errors.length) console.log('błędy konsoli', JSON.stringify(report.errors.slice(0, 12), null, 1));
  writeJson(join(outDir, 'raport.json'), report);
  console.log('wyniki', outDir);
  await chrome.close();
  await server.close();
  process.exit(0);
}
