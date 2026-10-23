// Malowanie barwami nacji w kreatorze kadłubów (dema/kreator-kadluba-webgpu.html, Stocznia) — headless Chrome z GPU
// (CDP): ten sam okręt w barwach każdej nacji (karta „Barwy nacji”: paleta + emblemat), czas zmiany barw (od kliknięcia
// do obrazu na GPU: ścieżka barw — same passy barw kompozytora, bez workera i ciała gry), długie zadania strony, pędzel
// prawdziwą myszą (pociągnięcie po klockach w slocie Akcent, własna barwa na kasztelu, gumka, cofnij), zrzuty, zgodność
// obrazu ścieżki barw z pełną przebudową (`zgodnosc.rozneBajty` — ma być 0).
//
//   node scripts/webgpu/kreator-barwy.mjs [--out .tmp/kreator/barwy] [--tylko bellator,colossus] [--palety terra,pirate,…]
//        [--profil 1] (profil CPU strony w trakcie pociągnięcia pędzlem) [--hz 60] (0 — bez limitu klatek)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/kreator/barwy');
const ships = String(args.tylko || 'bellator,colossus').split(',');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5441));
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);
const mouse = (type, x, y, buttons = 1) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: 1 });
const frames = (n = 8) => ev(`new Promise((ok) => { let k = 0; const f = () => (++k >= ${n} ? ok(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);

// strona: długie zadania i czas zmiany barw do końca pracy GPU (kolejka urządzenia)
const HZ = Number(args.hz ?? 60);
const PAGE = `(() => {
  if (window.__barwy) return true;
  // rytm 60 Hz jak u gracza (headless bez limitu klatek zapycha kolejkę GPU i czas „do GPU” mierzy klatki dema)
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
  const B = window.__barwy = { long: [], on: false };
  try { new PerformanceObserver((l) => { if (B.on) for (const e of l.getEntries()) B.long.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); } catch { /* */ }
  B.change = async (fn) => {
    const K = window.__kreator, S = K.S;
    await K.built();
    B.long.length = 0; B.on = true;
    const n0 = S.colorChanges || 0;
    const t0 = performance.now();
    fn();
    await K.built();
    await window.Core3D.renderer.backend.device.queue.onSubmittedWorkDone();
    const t1 = performance.now();
    await new Promise((ok) => setTimeout(ok, 120));
    B.on = false;
    const T = S.timing || {};
    return { doGpuMs: T.gpu != null ? Math.round(T.gpu * 10) / 10 : null, barwyCpu: T.barwy != null ? Math.round(T.barwy * 10) / 10 : null, sciezkaBarw: (S.colorChanges || 0) > n0, zMiniaturamiMs: Math.round((t1 - t0) * 10) / 10, dlugie: B.long.slice() };
  };
  return true;
})()`;

const report = { ships: {} };
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/kreator-kadluba-webgpu.html?ui=stocznia&preset=${ships[0]}` });
  if (!await waitFor(cdp, '!!(window.__kreator && (window.__kreator.ready || window.__kreator.error))', 240000, 400)) throw new Error('demo nie wstało');
  await ev(PAGE);
  const palettes = String(args.palety || await ev('Object.keys((window.__kreator.stocznia.items().filter((k) => k.startsWith("pal:")).reduce((o, k) => (o[k.slice(4)] = 1, o), {})))')).split(',');
  for (const key of ships) {
    const R = report.ships[key] = { palety: {}, pedzel: {} };
    await ev(`window.__kreator.preset(${JSON.stringify(key)})`);
    await ev('window.__kreator.stocznia.thumbsDone(120000)');
    await ev('window.__kreator.stocznia.cat("farba")');
    await ev('document.body.classList.add("clean"); window.__kreator.fit()');
    for (const p of palettes) {
      const r = await ev(`window.__barwy.change(() => window.__kreator.stocznia.arm(${JSON.stringify(`pal:${p}`)}))`);
      await frames(6);
      await screenshotPng(cdp, join(out, `${key}-nacja-${p}.png`));
      R.palety[p] = r;
      console.log(key.padEnd(9), `nacja ${p.padEnd(7)}`, JSON.stringify(r));
    }
    // miniatury kart w nowych barwach pieką się w tle — długie zadania strony do końca miniatur; potem zmiana barw
    // z celami kompozytora zajętymi przez miniatury
    R.miniatury = await ev(`(async () => { const B = window.__barwy; B.long.length = 0; B.on = true; const t0 = performance.now();
      const n = await window.__kreator.stocznia.thumbsDone(120000); B.on = false; return { ms: Math.round(performance.now() - t0), n, dlugie: B.long.slice() }; })()`);
    console.log(key.padEnd(9), 'miniatury po zmianie palety', JSON.stringify(R.miniatury));
    R.poMiniaturach = await ev('window.__barwy.change(() => window.__kreator.stocznia.arm("pal:terra"))');
    console.log(key.padEnd(9), 'po miniaturach (pełny render z pakietów)', JSON.stringify(R.poMiniaturach));
    // PĘDZEL: Akcent, pociągnięcie myszą po kilku klockach pancerza w poprzek kadłuba
    await ev('document.body.classList.remove("clean"); window.__kreator.fit()');
    const wpts = await ev(`(() => { const K = window.__kreator, S = K.S;
      const bl = S.design.shapes.filter((s) => s.kind === 'block' && s.level >= 1 && s.op !== 'cut' && s.y < -2);
      bl.sort((a, b) => a.x - b.x);
      const pick = bl.filter((_, i) => i % Math.max(1, Math.floor(bl.length / 6)) === 0).slice(0, 6);
      return pick.map((b) => ({ x: b.x, y: b.y })); })()`);
    const scr = () => Promise.all(wpts.map((q) => ev(`window.__kreator.toScreen(${q.x}, ${q.y})`)));
    let pts = await scr();
    await ev('window.__kreator.stocznia.arm("brush:accent")');
    if (args.profil) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
    R.pedzel.akcent = await (async () => {
      await ev('window.__barwy.long.length = 0; window.__barwy.on = true; window.__barwy.t0 = performance.now()');
      await mouse('mouseMoved', pts[0].x, pts[0].y, 0);
      await mouse('mousePressed', pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        for (let k = 1; k <= 6; k++) await mouse('mouseMoved', pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k / 6, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k / 6);
      }
      await mouse('mouseReleased', pts[pts.length - 1].x, pts[pts.length - 1].y);
      return ev(`(async () => { await window.__kreator.built(); await window.Core3D.renderer.backend.device.queue.onSubmittedWorkDone(); const B = window.__barwy; B.on = false;
        const S = window.__kreator.S; return { ms: Math.round(performance.now() - B.t0), pomalowane: S.design.shapes.filter((s) => s.paint === 'accent').length, hist: window.__kreator.stocznia.state().sel.length, dlugie: B.long.slice(), barwyCpu: S.timing?.barwy }; })()`);
    })();
    console.log(key.padEnd(9), 'pędzel akcent', JSON.stringify(R.pedzel.akcent));
    if (args.profil) {
      const { profile: p } = await cdp.send('Profiler.stop');
      const byId = new Map(p.nodes.map((q) => [q.id, q])), self = new Map();
      for (let i = 0; i < p.samples.length; i++) {
        const cf = byId.get(p.samples[i]).callFrame;
        if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue;
        const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`;
        self.set(k, (self.get(k) || 0) + (p.timeDeltas[i] || 0));
      }
      for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log('   ', String(Math.round(us / 100) / 10).padStart(7), k);
    }
    // własna barwa (kolor naklejek) na kasztelu
    const castle = await ev(`(() => { const K = window.__kreator, c = K.S.design.castles.find((q) => q.y < -2) || K.S.design.castles[0]; return c ? K.toScreen(c.x, c.y) : null; })()`);
    if (castle) {
      await ev('window.__kreator.S.color = "#6b7a3a"; window.__kreator.stocznia.arm("brush:own")');
      await mouse('mouseMoved', castle.x, castle.y, 0);
      await mouse('mousePressed', castle.x, castle.y);
      await mouse('mouseReleased', castle.x, castle.y);
      await ev('window.__kreator.built()');
      R.pedzel.kasztel = await ev('window.__kreator.S.design.castles.filter((c) => c.paint).map((c) => c.paint)');
    }
    await frames(6);
    await screenshotPng(cdp, join(out, `${key}-stocznia-malowanie.png`));
    await ev('window.__kreator.stocznia.disarm(); document.body.classList.add("clean"); window.__kreator.fit()');
    await frames(8);
    await screenshotPng(cdp, join(out, `${key}-pedzel.png`));
    // gumka na pierwszym klocku pociągnięcia, potem cofnij (gumka wraca)
    await ev('document.body.classList.remove("clean"); window.__kreator.fit(); window.__kreator.stocznia.arm("brush:erase")');
    pts = await scr();
    await mouse('mouseMoved', pts[0].x, pts[0].y, 0);
    await mouse('mousePressed', pts[0].x, pts[0].y);
    await mouse('mouseReleased', pts[0].x, pts[0].y);
    await ev('window.__kreator.built()');
    R.pedzel.poGumce = await ev('window.__kreator.S.design.shapes.filter((s) => s.paint === "accent").length');
    await ev('window.__kreator.stocznia.disarm()');
    R.pedzel.cofnij = await ev('window.__barwy.change(() => document.getElementById("yard-undo").click())');
    R.pedzel.poCofnieciu = await ev('window.__kreator.S.design.shapes.filter((s) => s.paint === "accent").length');
    console.log(key.padEnd(9), 'gumka / cofnij', R.pedzel.poGumce, R.pedzel.poCofnieciu, JSON.stringify(R.pedzel.cofnij));
    await ev('document.body.classList.add("clean")');
    await frames(8);
    await screenshotPng(cdp, join(out, `${key}-pedzel-cofnij.png`));
    await ev('document.body.classList.remove("clean")');
    // zgodność: obraz ścieżki barw = pełna przebudowa tego samego projektu (paleta, pędzel, pas)
    R.zgodnosc = await ev(`(async () => {
      const K = window.__kreator, S = K.S, d = S.design;
      d.palette = 'mars';
      d.decals.push({ kind: 'stripe', x0: -60, y0: 6, x1: 60, y1: 6, w: 3, color: '#b8342a', opacity: 0.9 });
      const c0 = S.colorChanges || 0;
      K.requestBuild(false); await K.built();
      const viaColors = (S.colorChanges || 0) > c0;
      const a = await window.__composer.readAlbedo();
      S.shownShapeKey = null; K.requestBuild(false); await K.built();
      const b = S.bake.albedo;
      let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
      return { sciezkaBarw: viaColors, rozneBajty: a.length === b.length ? diff : -1 };
    })()`);
    console.log(key.padEnd(9), 'zgodność ścieżki barw z pełną przebudową', JSON.stringify(R.zgodnosc));
  }
  report.syncPipes = await ev('({ n: window.__kreator.S.syncPipes, names: window.__kreator.S.syncNames })');
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 20);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.log('BŁĄD', report.blad);
} finally {
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('pipeline’y synchroniczne:', JSON.stringify(report.syncPipes), '· błędy strony:', (report.bledy || []).length, (report.bledy || []).slice(0, 4).join(' | '));
  await chrome.close();
  await server.close();
  process.exit(report.blad ? 1 : 0);
}
