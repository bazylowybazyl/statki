// Koszt czujników w PRAWDZIWEJ grze (2026-11-12, zgłoszenie: „strasznie muli … spadek z 240 na 100–140”): misja 1 (skok dev
// ?story=X), ta sama scena, warianty po kolei — wszystko, bez czujników, bez refrakcji (DIST), bez granic, bez kontaktów.
// Zegar GPU klatki (Core3D.gpuFrameMs — tryb off, Core3D strony), liczby obrazu (grupy, obserwatorzy, granice, kontakty),
// CPU: przebudowa obrazu czujników i krok widoku (prawdziwy zegar). Headless Chrome — nie przy grze użytkownika.
//
//   node scripts/webgpu/czujniki-koszt-gra.mjs [--faza defences] [--rozmiar 5120x1440] [--out .tmp/czujniki/koszt] [--sek 3]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '5120x1440').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/czujniki/koszt');
const faza = args.faza || 'defences';
const SEK = Number(args.sek || 3);
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5481));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { faza, rozmiar: `${W}x${H}`, warianty: {}, bledy: [] };

const WARIANTY = {
  wszystko: { enabled: true, granice: true, kontakty: true, dist: true },
  bez_czujnikow: { enabled: false, granice: true, kontakty: true, dist: true },
  bez_refrakcji: { enabled: true, granice: true, kontakty: true, dist: false },
  bez_granic: { enabled: true, granice: false, kontakty: true, dist: true },
  bez_kontaktow: { enabled: true, granice: true, kontakty: false, dist: true }
};

// Zamrożony zegar harnessu (scena stoi), klatki lecą bez przerwy (GPU nie zwalnia zegara), warianty naprzemiennie w rundach,
// znaczniki GPU z ~0,2–0,5 s opóźnieniem — po przełączeniu czekanie, potem próbki do mediany.
async function gpuOkno(ms) {
  return ev(`(async () => {
    const C = window.Core3D, now = window.__harness.realNow; const out = []; let last = C.gpuFrameSamples;
    const t0 = now();
    while (now() - t0 < ${ms}) {
      await new Promise((r) => setTimeout(r, 20));
      if (C.gpuFrameSamples !== last) { last = C.gpuFrameSamples; out.push(C.gpuFrameMs); }
    }
    return out;
  })()`, ms + 60000);
}
// Okno pomiaru przy biegnącej grze: CPU strony (dziennik klatek harnessu), okres klatki strony, CPU i GPU klatki workera
// (kanał zwrotny RET_F64: GPU_FRAME_MS 0, GPU_FRAME_SAMPLES 2, CPU_FRAME_MS 6) albo GPU Core3D strony (tryb off).
async function oknoCalosc(ms) {
  return ev(`(async () => {
    const h = window.__harness, L = h.frameLog, now = h.realNow, W = window.RenderWorkerHost, C = window.Core3D;
    const b = L.n; const wk = []; const gpu = []; let lastG = W ? W.stats[2] : C.gpuFrameSamples;
    const t0 = now();
    while (now() - t0 < ${ms}) {
      await new Promise((r) => setTimeout(r, 20));
      if (W) { wk.push(W.stats[6]); if (W.stats[2] !== lastG) { lastG = W.stats[2]; gpu.push(W.stats[0]); } }
      else if (C.gpuFrameSamples !== lastG) { lastG = C.gpuFrameSamples; gpu.push(C.gpuFrameMs); }
    }
    const e = L.n; let cpu = 0, n = 0;
    for (let k = Math.max(b, e - 900); k < e; k++) { cpu += L.cpu[k % L.cpu.length]; n++; }
    const okres = n > 1 ? (L.start[(e - 1) % L.start.length] - L.start[Math.max(b, e - 900) % L.start.length]) / (n - 1) : 0;
    return { cpuStrony: n ? cpu / n : 0, okresStrony: okres, klatki: n, cpuWorkera: wk, gpu };
  })()`, ms + 60000);
}
const avg = (v) => v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) : null;
const med = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? +s[s.length >> 1].toFixed(3) : null; };

try {
  await osobneLosowanieUuid(cdp);
  const jednostki = args.scena === 'jednostki';
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('sc_story_campaign', '${jednostki ? 0 : 1}'); localStorage.setItem('sc_story_tutorial', '${jednostki ? 0 : 1}'); } catch (e) {}
`
      + `window.__HARNESS_SEED__ = ${0x5eed4c22};
${INJECT}
window.__harness.clock.mode = 'real';
`
  });
  // --scena jednostki: gra swobodna, prototyp ?radarZasiegi, RadarZasiegi.scenaJednostek() — każdy rodzaj jednostki
  // jako uśpiony wróg na pierścieniach 4–60 km (wiele rozproszonych grup i obserwatorów)
  const url = jednostki ? `${base}/index.html?dev=1&radarZasiegi=1` : `${base}/index.html?dev=1&story=${faza}`;
  await cdp.send('Page.navigate', { url: `${url}${args.query ? '&' + args.query : ''}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame && window.Czujka)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="${jednostki ? 0 : 1}"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (jednostki) {
    if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
    report.scena = await ev('(() => { const r = window.RadarZasiegi.scenaJednostek({}); return r ? { n: r.n ?? r.length ?? null } : null; })()');
    await ev('(() => { const c = window.camera; if (c.mode === "rts" && c.exitRtsMode) c.exitRtsMode(); return true; })()');
  } else if (!await waitFor(cdp, `window.StoryGame.active && window.StoryGame.phase === '${faza}' && document.getElementById('loading')?.classList.contains('hidden')`, 300000, 400)) throw new Error(`faza ${faza} nie ruszyła`);
  await sleep(5000);
  if (args.zoom) await ev(`(() => { const c = window.camera; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${Number(args.zoom)}; return true; })()`);
  await ev(`(() => { window.Core3D.gpuTimerSampleEvery = 1; ${args.calosc ? '' : "window.__harness.clock.mode = 'frozen';"} window.__harness.hold(false); return true; })()`);
  report.obraz = await ev(`(() => { const C = window.Czujka, P = C.picture, V = C.view, I = C.wejscie;
    return { wiedza: P.knowList.length, rekordy: P.n, grupy: P.threats.n, obserwatorzy: P.watchers.n, kolaGrup: P.borders.n,
      granice: I[16], kontakty: I[17], kontaktyWidoku: V.stats.contacts, grupyWidoku: V.stats.groups,
      typyObserwatorow: (() => { const m = {}; for (let i = 0; i < P.watchers.n; i++) { const t = P.watchers.k[i]?.e?.type || '?'; m[t] = (m[t] || 0) + 1; } return m; })() }; })()`);
  console.log('obraz:', JSON.stringify(report.obraz));
  // CPU: przebudowa obrazu (co 0,2 s w grze) i krok + pakowanie widoku (co klatkę) — prawdziwy zegar
  report.cpu = await ev(`(() => { const C = window.Czujka, now = window.__harness?.realNow || performance.now.bind(performance);
    let t0 = now(); for (let i = 0; i < 40; i++) C.przebuduj(); const przebudowa = (now() - t0) / 40;
    return { przebudowaMs: +przebudowa.toFixed(3), krokRenderuMs: +(C.render.stats.cpuMs || 0).toFixed(3) }; })()`);
  console.log('cpu:', JSON.stringify(report.cpu));
  report.kroki = await ev(`window.Czujka.zmierz(200, window.__harness.realNow)`);
  console.log('kroki strony [ms/wywołanie]:', JSON.stringify(report.kroki));
  if (args.calosc) {
    // czujniki wł. / wył. (główny wyłącznik strony — obraz, widok, wejście renderu), gra biegnie, naprzemiennie
    const acc = { wl: { cpu: [], okres: [], wk: [], gpu: [] }, wyl: { cpu: [], okres: [], wk: [], gpu: [] } };
    for (let r = 0; r < Number(args.rundy || 6); r++) {
      for (const k of ['wl', 'wyl']) {
        await ev(`(() => { window.Czujka.input.off = ${k === 'wyl'}; return true; })()`);
        await sleep(900);
        const o = await oknoCalosc(SEK * 1000 / Number(args.rundy || 6));
        acc[k].cpu.push(o.cpuStrony); acc[k].okres.push(o.okresStrony); acc[k].wk.push(...o.cpuWorkera); acc[k].gpu.push(...o.gpu);
      }
    }
    for (const k of ['wl', 'wyl']) {
      const a = acc[k];
      report.warianty[k] = { cpuStronyMs: avg(a.cpu), okresStronyMs: avg(a.okres), cpuWorkeraMs: avg(a.wk), gpuMs: med(a.gpu), gpuN: a.gpu.length };
      console.log((k === 'wl' ? 'czujniki WŁ.' : 'czujniki WYŁ.').padEnd(16), JSON.stringify(report.warianty[k]));
    }
    await ev(`(() => { window.Czujka.input.off = false; return true; })()`);
  }
  const probki = {};
  const RUNDY = args.calosc ? 0 : Number(args.rundy || 4);
  for (let r = 0; r < RUNDY; r++) {
    for (const [nazwa, w] of Object.entries(WARIANTY)) {
      await ev(`(() => { Object.assign(window.Czujka.render.tune, ${JSON.stringify(w)}); return true; })()`);
      await gpuOkno(700);
      (probki[nazwa] ||= []).push(...await gpuOkno(SEK * 1000 / RUNDY));
    }
  }
  for (const [nazwa, v] of Object.entries(probki)) {
    report.warianty[nazwa] = { med: med(v), n: v.length };
    console.log(nazwa.padEnd(16), JSON.stringify(report.warianty[nazwa]));
  }
  await ev(`(() => { Object.assign(window.Czujka.render.tune, ${JSON.stringify(WARIANTY.wszystko)}); return true; })()`);
  await sleep(800);
  await screenshotPng(cdp, join(out, `${args.scena || faza}.png`));
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error('BŁĄD', report.blad);
} finally {
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 30);
  writeFileSync(join(out, `wyniki-${args.scena || faza}.json`), JSON.stringify(report, null, 1) + '\n');
  await chrome.close();
  await server.close();
}
