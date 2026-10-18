// Mapa CIC w PRAWDZIWEJ grze (src/ui/cicDisplay.js, warstwa pasów src/ui/cicBeltLayer.js): zrzuty przy kilku
// zoomach w scenach Ziemia / pas / Kuiper, czas rysowania CIC na klatkę (mediana, p95, maks.), stan pamięci kafli pasów.
// Vite + headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/cic-gra.mjs [--out .tmp/cic/gra] [--rozmiar 1600x900] [--sceny ziemia,pas,kuiper]
//        [--zoomy 0.08,0.01,0.002,0.0004,uklad] [--klatki 90] [--ruch 1]
//
// --ruch 1 — dodatkowo płynne oddalanie od taktycznego do układu (koszt wypieku kafli w trakcie ruchu);
// --ruchAb 1 — ruch z warstwą pasów i bez (na przemian); --profil 1 — profil CPU ruchu (.cpuprofile);
// --ab 0.0004,uklad — A/B warstw na tej samej klatce (kl/s rAF, czas rysowania CIC); --okno 1 — okno z VSync.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/cic/gra');
mkdirSync(out, { recursive: true });
const sceny = (args.sceny || 'ziemia,pas,kuiper').split(',');
const zoomy = (args.zoomy || '0.08,0.01,0.002,0.0004,uklad').split(',');
const klatki = Number(args.klatki || 90);

const report = { rozmiar: `${W}x${H}`, sceny: {}, bledy: [] };

const { server, base } = await startVite(Number(args.port || 5386));
// --okno 1 — zwykłe okno z VSync (jak u gracza); headless biegnie bez limitu klatek i dławi proces GPU
const chrome = await startChrome({ width: W, height: H, headless: args.okno === '1' ? false : undefined,
  extraArgs: args.okno === '1' ? ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'] : [] });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'));
  console.log('zrzut', name);
};

// czasy rysowania CIC: opakowanie CICDisplay.draw (index.html woła je przez obiekt modułu)
const timing = `(() => {
  const C = window.CICDisplay;
  if (!C.__timed) {
    const orig = C.draw;
    window.__cicMs = [];
    C.draw = function (...a) { const t = performance.now(); const r = orig.apply(this, a); window.__cicMs.push(performance.now() - t); return r; };
    C.__timed = true;
  }
  return true;
})()`;
const stats = `(() => {
  const a = (window.__cicMs || []).slice().sort((x, y) => x - y);
  window.__cicMs = [];
  const q = (p) => a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(3) : null;
  const belt = window.CICDisplay.beltStats?.() || null;
  return { n: a.length, med: q(0.5), p95: q(0.95), max: a.length ? +a[a.length - 1].toFixed(3) : null, belt };
})()`;

async function view(zoom) {
  if (zoom === 'uklad') {
    // widok układu: dopasowanie do najdalszej orbity, środek w Słońcu
    await ev(`(() => {
      const s = window.ship, S = window.SUN; let m = 1e5;
      for (const p of window.planets || []) if (p && p.orbitRadius > m) m = p.orbitRadius;
      const z = Math.min(innerWidth, innerHeight) * 0.42 / (m * 1.2);
      window.CICDisplay.setView({ zoom: z, panX: S.x - s.pos.x, panY: S.y - s.pos.y });
      return z;
    })()`);
  } else {
    await ev(`window.CICDisplay.setView({ zoom: ${Number(zoom)}, panX: 0, panY: 0 })`);
  }
}

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('sc_story_campaign','0'); localStorage.setItem('sc_story_tutorial','0'); } catch (e) {}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(2500);
  await ev(timing);

  for (const scene of sceny) {
    if (scene === 'pas') {
      const at = await ev(`(() => {
        const belt = window.__asteroidBelt; const g = belt?.giants?.entries?.[0];
        if (!g) return null;
        const c = g.site.core;
        const x = c.x + (g.x - c.x) * 0.45, y = c.y + (g.y - c.y) * 0.45;
        window.DevScene.teleport(x, y, 0);
        return { x: Math.round(x), y: Math.round(y) };
      })()`);
      console.log('teleport pas', at);
      await sleep(3000);
    } else if (scene === 'kuiper') {
      const at = await ev(`(() => {
        const S = window.SUN, au = window.__beltWorld?.field?.auToWorld || 42253.52;
        const a = 0.7, r = 133 * au;
        const x = S.x + Math.cos(a) * r, y = S.y + Math.sin(a) * r;
        window.DevScene.teleport(x, y, 0);
        return { x: Math.round(x), y: Math.round(y) };
      })()`);
      console.log('teleport kuiper', at);
      await sleep(3000);
    }
    await ev(`(() => { window.CICDisplay.open(); return true; })()`);
    await sleep(300);
    report.sceny[scene] = {};
    for (const z of zoomy) {
      await view(z);
      // pierwsze klatki: wypiek kafli; potem pomiar w spoczynku
      await sleep(1500);
      await ev(stats);
      await sleep(Math.round(klatki * 1000 / 60));
      const st = await ev(stats);
      report.sceny[scene][z] = st;
      console.log(scene, z, JSON.stringify(st));
      await shot(`${scene}-${z}`);
    }
    if (args.ab) {
      // A/B na tej samej klatce: klatki rAF / s i czas rysowania CIC z warstwami pasów wł. / wył. (ABAB)
      const warianty = { pelna: {}, bez: { on: false }, bezPamieci: { cache: false }, bezKonturow: { contours: false }, bezKafli: { fill: false }, bezPodpisow: { labels: false, families: false, giants: false }, bezLuk: { lanes: false } };
      for (const z of String(args.ab).split(',')) {
        await view(z);
        await sleep(2500);
        report.sceny[scene]['ab-' + z] = {};
        for (let rep = 0; rep < 2; rep++) {
          for (const [name, over] of Object.entries(warianty)) {
            await ev(`(() => { const T = window.CicBeltTune; Object.assign(T, { on: true, cache: true, fill: true, contours: true, labels: true, families: true, giants: true, lanes: true }, ${JSON.stringify(over)}); return true; })()`);
            await sleep(400);
            await ev(stats);
            const fps = await ev(`new Promise((ok) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else ok(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })`, 10000);
            const st = await ev(stats);
            const r = report.sceny[scene]['ab-' + z];
            (r[name] ||= []).push({ fps: Math.round(fps), med: st.med, p95: st.p95 });
            console.log(scene, 'ab', z, name, Math.round(fps), 'kl/s', 'CIC med', st.med);
          }
        }
      }
      await ev(`(() => { Object.assign(window.CicBeltTune, { on: true, cache: true, fill: true, contours: true, labels: true, families: true, giants: true, lanes: true }); return true; })()`);
    }
    for (const ruchCache of (args.ruch === '1' ? (args.ruchAb === '1' ? [true, 'off', true] : [true]) : [])) {
      // płynne oddalanie: zoom × 0,97 na klatkę od 0,08 do widoku układu (jak kółko myszy); 'off' — bez warstwy pasów
      await ev(`(() => { const T = window.CicBeltTune; T.cache = ${ruchCache !== false}; T.on = ${ruchCache !== 'off'};
        T.fill = true; T.contours = true; T.lanes = true; T.labels = true; T.families = true; T.giants = true;
        ${ruchCache === 'labels' ? 'T.labels = false; T.families = false; T.giants = false;' : typeof ruchCache === 'string' && ruchCache !== 'off' ? `T.${ruchCache} = false;` : ''} return true; })()`);
      await view(0.08);
      await sleep(600);
      await ev(stats);
      if (args.profil === '1') {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
        await cdp.send('Profiler.start');
      }
      await ev(`(() => {
        let z = 0.08; const C = window.CICDisplay; let n = 0; const t0 = performance.now(); let tl = t0; const dts = [];
        window.__ruch = null;
        const lt = [];
        const obs = typeof PerformanceObserver !== 'undefined' ? new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push(Math.round(e.duration)); }) : null;
        try { obs?.observe({ type: 'longtask' }); } catch (e) {}
        const step = () => {
          const t = performance.now(); if (n > 0) dts.push(t - tl);
          const hp = performance.memory ? performance.memory.usedJSHeapSize : 0;
          if (n > 0 && t - tl > 40) (window.__ruchSkoki ||= []).push({ ms: Math.round(t - tl), sterta: Math.round((hp - (window.__hpPrev || hp)) / 1e6) });
          window.__hpPrev = hp;
          tl = t; n++;
          z *= 0.97; C.setView({ zoom: z, instant: false });
          if (z > 0.00007) requestAnimationFrame(step);
          else {
            dts.sort((a, b) => a - b);
            const q = (p) => +dts[Math.min(dts.length - 1, Math.floor(dts.length * p))].toFixed(2);
            obs?.disconnect();
            window.__ruch = { klatki: n, med: q(0.5), p90: q(0.9), p99: q(0.99), najgorsza: +dts[dts.length - 1].toFixed(1), longtask: lt, gc: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null };
          }
        };
        requestAnimationFrame(step);
        return true;
      })()`);
      await sleep(4500);
      if (args.profil === '1') {
        const { profile } = await cdp.send('Profiler.stop');
        const tag = ruchCache === 'off' ? 'bez' : 'pamiec';
        writeFileSync(join(out, `ruch-${scene}-${tag}-${Date.now() % 100000}.cpuprofile`), JSON.stringify(profile));
      }
      const st = await ev(stats);
      st.ruch = await ev('window.__ruch');
      st.skoki = await ev('(() => { const s = window.__ruchSkoki || []; window.__ruchSkoki = []; return s; })()');
      (report.sceny[scene].ruch ||= []).push({ cache: ruchCache, ...st });
      console.log(scene, 'ruch', ruchCache === 'off' ? 'bez-pasow' : typeof ruchCache === 'string' ? 'bez-' + ruchCache : ruchCache ? 'pamiec' : 'wprost', JSON.stringify(st));
    }
    await ev(`(() => { Object.assign(window.CicBeltTune, { cache: true, on: true, fill: true, contours: true, lanes: true }); return true; })()`);
    await ev(`(() => { window.CICDisplay.close(); return true; })()`);
    await sleep(300);
  }
} catch (e) {
  report.bledy.push(String(e?.stack || e));
  console.error(e);
} finally {
  report.konsola = logs.errors().slice(0, 40);
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  server?.close?.();
  process.exit(0);
}
