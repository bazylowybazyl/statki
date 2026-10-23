// Płynność edycji kreatora kadłubów (dema/kreator-kadluba-webgpu.html, interfejs Stocznia) w headless Chrome z GPU (CDP):
// typowe edycje na żywej pętli dema (bez ?test=1 — klatki z requestAnimationFrame) i ich koszt — czas od puszczenia do
// gotowego obrazu, długie zadania wątku strony (PerformanceObserver 'longtask', > 50 ms), największa przerwa między
// klatkami, liczba obrazów w trakcie przeciągania, czasy etapów budowy (S.timing). Edycje: przeciąganie klocka (1 s),
// dodanie i usunięcie klocka, przeciąganie gniazda broni (1 s), suwak detalu (1 s), zmiana palety, cofnij. Zrzuty
// pełnego wypieku po każdym okręcie (porównanie przed / po: `--porownaj <katalog przed>` liczy różnicę pikseli).
//
//   node scripts/webgpu/kreator-plynnosc.mjs [--out .tmp/kreator-plynnosc/<tag>] [--tylko custos,bellator,colossus]
//        [--edycje przesun,dodaj,usun,modul,suwak,paleta,cofnij] [--porownaj <katalog>] [--hz 60] [--profil suwak,usun] (profil CPU
//        strony w trakcie edycji: najdroższe funkcje, plik .cpuprofile)
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/kreator-plynnosc/pomiar');
const ships = String(args.tylko || 'custos,bellator,colossus').split(',');
const edits = String(args.edycje || 'przesun,dodaj,usun,modul,suwak,paleta,cofnij').split(',');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5433));
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);

// Strona: licznik długich zadań i przerw między klatkami, edycje jako funkcje strony.
const HZ = Number(args.hz ?? 60);
const PAGE = String.raw`
(() => {
  if (window.__plyn) return true;
  // headless bez limitu klatek: pętla dema rysuje setki klatek na sekundę i zapycha kolejkę GPU (odczyt wypieku czeka
  // za nimi) — rytm jak u gracza (--hz 60; 0 — bez limitu): wywołania rAF tej samej klatki przechodzą razem
  const HZ = ${HZ};
  if (HZ > 0) {
    const raf0 = window.requestAnimationFrame.bind(window);
    let gate = 0, cur = -1;
    window.requestAnimationFrame = (cb) => raf0(function step(t) {
      if (t !== cur && t < gate) { raf0(step); return; }
      if (t !== cur) { cur = t; gate = t + 1000 / HZ - 1; }
      cb(t);
    });
  }
  const K = window.__kreator, S = K.S;
  const P = window.__plyn = { long: [], gaps: [], on: false, builds: 0 };
  try { new PerformanceObserver((l) => { if (P.on) for (const e of l.getEntries()) P.long.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); } catch (e) { P.noLong = String(e); }
  let last = 0;
  const tick = (t) => { if (P.on && last) P.gaps.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  let rev = S.builtRev;
  setInterval(() => { if (S.builtRev !== rev) { rev = S.builtRev; if (P.on) P.builds++; } }, 4);
  const raf = () => new Promise((ok) => requestAnimationFrame(ok));
  const req = (fast) => (K.requestBuild ? K.requestBuild(fast) : K.edit(() => {}));
  P.frames = async (n) => { for (let i = 0; i < n; i++) await raf(); };
  /** Edycja: fn() → czas puszczenia (performance.now()); potem czekanie na obraz. */
  P.measure = async (name, fn) => {
    await K.built();
    await P.frames(8);
    P.long.length = 0; P.gaps.length = 0; P.builds = 0; P.on = true;
    const prev0 = S.previews || 0;
    const t0 = performance.now();
    const tRel = await fn();
    await K.built();
    if (K.bodyReady) await K.bodyReady();
    const t1 = performance.now();
    await P.frames(3);
    P.on = false;
    const long = P.long.slice();
    const gaps = P.gaps.slice().sort((a, b) => b - a);
    return {
      edycja: name, poPuszczeniuMs: Math.round(t1 - tRel), calośćMs: Math.round(t1 - t0), obrazyWTrakcie: P.builds + (S.previews || 0) - prev0,
      dlugie: { n: long.length, max: long.length ? Math.max(...long) : 0, suma: long.reduce((a, b) => a + b, 0) },
      przerwaKlatekMax: Math.round(gaps[0] || 0), przerwy50: gaps.filter((g) => g > 50).length, klatki: gaps.length,
      etapy: S.timing ? JSON.parse(JSON.stringify(S.timing)) : null
    };
  };
  /** Przeciąganie: co klatkę pozycja z czasu (jak mysz o stałej prędkości), requestBuild(true) przy zmianie; puszczenie. */
  P.drag = async (obj, dx, dy, ms, step) => {
    const x0 = obj.x, y0 = obj.y;
    S.drag = { kind: 'stocznia' };
    const t0 = performance.now();
    let lastK = -1;
    for (;;) {
      const t = Math.min(1, (performance.now() - t0) / ms);
      const k = Math.round(t * Math.max(Math.abs(dx), Math.abs(dy)) / step);
      if (k !== lastK) {
        lastK = k;
        const f = k * step / Math.max(Math.abs(dx), Math.abs(dy));
        obj.x = x0 + Math.round(dx * f / step) * step; obj.y = y0 + Math.round(dy * f / step) * step;
        req(true);
      }
      if (t >= 1) break;
      await raf();
    }
    S.drag = null;
    const tRel = performance.now();
    req(false);
    return tRel;
  };
  P.blockToMove = () => {
    const im = S.field.image;
    const bl = S.design.shapes.filter((s) => s.kind === 'block' && (s.level ?? 1) >= 1 && s.op !== 'sub');
    bl.sort((a, b) => Math.hypot(a.x - im.cx, a.y - (im.minY + im.h * 0.3)) - Math.hypot(b.x - im.cx, b.y - (im.minY + im.h * 0.3)));
    return bl[0];
  };
  P.moduleToMove = () => S.design.modules.find((m) => !m.lock && (m.type === 'mount' || m.type.startsWith('turret'))) || S.design.modules.find((m) => !m.lock);
  return true;
})()`;

const EDITS = {
  przesun: `__plyn.measure('przesuń klocek (1 s)', () => { const b = __plyn.blockToMove(); const g = __kreator.S.design.grid || 1; return __plyn.drag(b, g * 10, 0, 1000, g); })`,
  dodaj: `__plyn.measure('dodaj klocek', async () => { const b = __plyn.blockToMove(); const c = JSON.parse(JSON.stringify(b)); c.y += (__kreator.S.design.grid || 1) * 4; __kreator.S.design.shapes.push(c); const t = performance.now(); __kreator.requestBuild ? __kreator.requestBuild(false) : __kreator.edit(() => {}); return t; })`,
  usun: `__plyn.measure('usuń klocek', async () => { const s = __kreator.S.design.shapes; s.splice(s.length - 1, 1); const t = performance.now(); __kreator.requestBuild ? __kreator.requestBuild(false) : __kreator.edit(() => {}); return t; })`,
  modul: `__plyn.measure('przesuń gniazdo broni (1 s)', () => { const m = __plyn.moduleToMove(); return m ? __plyn.drag(m, 12, 0, 1000, 0.5) : performance.now(); })`,
  suwak: `__plyn.measure('suwak detalu (1 s)', async () => { const S = __kreator.S, d = S.design, D0 = d.detail; S.drag = { kind: 'stocznia-suwak' }; const t0 = performance.now(); let last = -1; for (;;) { const t = Math.min(1, (performance.now() - t0) / 1000); const v = Math.round((D0 * (1 + 0.15 * t)) * 200) / 200; if (v !== last) { last = v; d.detail = v; __kreator.requestBuild ? __kreator.requestBuild(true) : __kreator.edit(() => {}); } if (t >= 1) break; await new Promise((ok) => requestAnimationFrame(ok)); } S.drag = null; const tr = performance.now(); __kreator.requestBuild ? __kreator.requestBuild(false) : __kreator.edit(() => {}); return tr; })`,
  paleta: `__plyn.measure('paleta: piraci', async () => { const d = __kreator.S.design; d.palette = d.palette === 'pirate' ? 'terra' : 'pirate'; const t = performance.now(); __kreator.requestBuild ? __kreator.requestBuild(false) : __kreator.edit(() => {}); return t; })`,
  cofnij: `__plyn.measure('cofnij', async () => { const t = performance.now(); document.getElementById('yard-undo').click(); return t; })`
};

/** Najdroższe funkcje profilu (czas własny, ms) — skąd długie zadania. */
function topSelf(p, n) {
  const byId = new Map(p.nodes.map((q) => [q.id, q]));
  const self = new Map();
  for (let i = 0; i < p.samples.length; i++) {
    const q = byId.get(p.samples[i]);
    const cf = q.callFrame;
    if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue;
    const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + (p.timeDeltas[i] || 0));
  }
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => [Math.round(us / 100) / 10, k]);
}

const report = { ships: {}, logs: null };
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/kreator-kadluba-webgpu.html?ui=stocznia&preset=custos` });
  if (!await waitFor(cdp, '!!(window.__kreator && (window.__kreator.ready || window.__kreator.error))', 240000, 400)) throw new Error('demo nie wstało');
  const err = await ev('window.__kreator.error || null');
  if (err) throw new Error(`demo: ${err}`);
  await ev(PAGE);
  for (const key of ships) {
    await ev(`window.__kreator.preset(${JSON.stringify(key)})`);
    await ev('window.__kreator.stocznia?.thumbsDone?.(120000)');
    await ev('window.__kreator.built()');
    const rows = [];
    for (const e of edits) {
      if (!EDITS[e]) continue;
      const prof = args.profil && String(args.profil).split(',').includes(e);
      if (prof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
      const r = await ev(EDITS[e]);
      if (prof) {
        const { profile } = await cdp.send('Profiler.stop');
        writeFileSync(join(out, `${key}-${e}.cpuprofile`), JSON.stringify(profile));
        r.profil = topSelf(profile, r.dlugie.max > 0 ? 25 : 12);
        for (const [ms, fn] of r.profil) console.log('   ', String(ms).padStart(6), fn);
      }
      if (e === 'paleta' || e === 'suwak') await ev('window.__kreator.stocznia?.thumbsDone?.(120000)');
      rows.push(r);
      console.log(key.padEnd(10), r.edycja.padEnd(28), `po puszczeniu ${String(r.poPuszczeniuMs).padStart(5)} ms`,
        `| długie: ${r.dlugie.n} (max ${r.dlugie.max}, suma ${r.dlugie.suma})`, `| przerwa klatek max ${r.przerwaKlatekMax} ms (>50: ${r.przerwy50}/${r.klatki})`,
        `| obrazy w trakcie ${r.obrazyWTrakcie}`, r.etapy ? JSON.stringify(Object.fromEntries(Object.entries(r.etapy).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v]))) : '');
    }
    // zrzut pełnego wypieku (ten sam projekt przed / po: cofnij przywraca preset)
    await ev(`(async () => { const K = window.__kreator; await K.preset(${JSON.stringify(key)}); await K.built(); if (K.bodyReady) await K.bodyReady(); document.body.classList.add('clean'); K.fit(); return true; })()`);
    await ev('new Promise((ok) => { let n = 0; const f = () => (++n > 30 ? ok(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })');
    await screenshotPng(cdp, join(out, `${key}.png`));
    const albedo = await ev(`(async () => { const b = window.__kreator.S.bake; if (!b) return null; let h = 0; const a = b.albedo; for (let i = 0; i < a.length; i += 7) h = (h * 31 + a[i]) >>> 0; return { w: b.width, h: b.height, hash: h }; })()`);
    await ev(`document.body.classList.remove('clean')`);
    report.ships[key] = { edycje: rows, albedo };
    console.log(key, 'albedo', JSON.stringify(albedo));
  }
  report.logs = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 40);
} catch (e) {
  console.error(e);
  report.error = String(e.stack || e);
} finally {
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 1));
  if (args.porownaj && existsSync(join(resolve(repo, args.porownaj), 'raport.json'))) {
    const prev = JSON.parse(readFileSync(join(resolve(repo, args.porownaj), 'raport.json'), 'utf8'));
    for (const k of Object.keys(report.ships)) {
      const a = prev.ships?.[k]?.albedo, b = report.ships[k].albedo;
      console.log('porównanie albedo', k, a && b && a.hash === b.hash && a.w === b.w ? 'TO SAMO' : `RÓŻNE ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    }
  }
  await chrome.close();
  await server.close();
  process.exit(report.error ? 1 : 0);
}
