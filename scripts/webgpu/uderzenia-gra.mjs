// Uderzenia w planetoidę pod bazą piratów (upadek bazy, 2026-10-19) w PRAWDZIWEJ grze: Vite + headless Chrome z WebGPU
// (CDP). Zdarzenia sztuczne z kontraktu fizyki (window.PirateRockImpacts — test / testScrape / demo), obraz:
// src/3d/pirateRockImpactFx.js (cząstki w passie tła) i głębokie domeny gazu wybuchów (ExplosionFx.deepDomain).
//
//   node scripts/webgpu/uderzenia-gra.mjs [--out .tmp/uderzenia-gra] [--rozmiar 1600x900]
//        [--tryb duze,srednie,male,szorowanie,upadek,3d,koszt] [--query renderWorker=1] [--zoomy 0.2,0.08]
//
// Skok dev ?story=ram (baza postawiona), kamera RTS bez HUD-u nad punktem uderzenia (głęboki punkt — kamera nad nim,
// rzut perspektywy passa tła zbiega ku środkowi kadru):
//   duze        uderzenie wieży (size 900, 1,9 km/s, poślizg) — kadry 0,15 / 0,6 / 1,5 / 3 / 6 s przy każdym zoomie
//   srednie     kawałek bębna (size 300, 0,9 km/s), 3 naraz obok siebie
//   male        odłamy (size 40–160) — seria 12
//   szorowanie  ciało szoruje po powierzchni 3 s (zdarzenia co 0,25 s)
//   upadek      scenariusz demo (wieża, 8 sektorów dysku, bęben, odłamy, szorowanie, osiadanie) — kadry do 9 s
//   3d          kamera taktyczna (K) nad strefą uderzenia — demo upadku w perspektywie
//   koszt       mediana Core3D.gpuFrameMs: bez uderzeń / z demo upadku (A/B tej samej klatki: przełącznik
//               ROCK_IMPACT_FX_TUNE.enabled przez nowe zdarzenia — kolejne demo przy wyłączonym obrazie)
// Raport <out>/raport.json: statystyki kontraktu, obrazu i gazu, pipeline'y synchroniczne w klatkach gry (ma być 0),
// błędy konsoli (też workera).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/uderzenia-gra');
const tryby = new Set(String(args.tryb || 'duze,srednie,male,szorowanie,upadek,3d').split(','));
const zoomy = String(args.zoomy || '0.2,0.08').split(',').map(Number);
const query = args.query ? `&${args.query}` : '';
const worker = /renderWorker=1/.test(query);
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5391));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { tryb: worker ? 'worker' : 'off', kadry: [], bledy: [] };

const PIPE_REC = `(() => {
  const R = { pipes: [] };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, frame: window.__frameId | 0, nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
  }, 10);
  window.__pipeRec = R;
})();`;
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PIPE_REC });

// kamera RTS nad punktem gry (x, y) z zoomem, bez HUD-u
const camAt = (x, y, zoom) => ev(`(() => {
  const c = window.camera;
  window.Game3D?.setCamera?.('classic');
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = ${x}; c.y = c.targetY = ${y}; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
  return true;
})()`);
const state = () => ev(`(() => {
  const P = window.PirateRockImpacts;
  const r = window.PirateRock?.state?.();
  const imp = r?.impact;
  const X = window.__explosions;
  return {
    kontrakt: P ? { ...P.stats } : null,
    obraz: imp ? { ...imp.stats, pyl: imp.alpha.used, swiecace: imp.add.used, czas: +imp.time.toFixed(2) } : null,
    gaz: X ? { glebokie: X.stats.deepDomains, nowe: X.stats.deepNew, maleNaEkranie: X.stats.deepSmall, pozaKadrem: X.stats.deepOff, bezDomeny: X.stats.deepNoSlot,
      domeny: X.stats.domains, krok: +(X.stats.marchStep || 1).toFixed(2) } : null,
    gpuMs: +(window.Core3D?.gpuFrameMs || 0).toFixed(3)
  };
})()`);
async function shot(name, wait = 600) {
  await sleep(wait);
  const st = await state();
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.kadry.push({ name, ...st });
  console.log(name.padEnd(30), JSON.stringify(st));
}
// punkt powierzchni (e, n) → gra
const at = (e, n) => ev(`(() => { const q = window.PirateRockImpacts.eventAt({ e: ${e}, n: ${n} }); return q ? { x: q.x, y: q.y, z: q.z } : null; })()`);

// seria kadrów po zdarzeniu (czasy od chwili zdarzenia, rzeczywiste)
async function series(prefix, fire, times) {
  await fire();
  const t0 = Date.now();
  for (const t of times) {
    const wait = Math.max(0, t * 1000 - (Date.now() - t0));
    await shot(`${prefix}-${String(t).replace('.', '_')}s`, wait);
  }
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=ram${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  if (!worker) await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  else await sleep(6000);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); localStorage.setItem('sc_fog_of_war', '0'); return true; })()`);
  await sleep(1200);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "window.StoryGame.active && window.StoryGame.phase === 'ram' && !!window.StoryGame.site?.station", 300000, 400)) throw new Error('faza ram nie ruszyła');
  await sleep(2500);
  // gracz z dala od kadrów (bez alarmu)
  await ev(`(() => { const S = window.StoryGame, d = S.site.dock; const p = d.toGame(-16000, -6000); S.deps.placePlayer(p.x, p.y, d.axis); window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
  const P0 = await at(-3600, 0);
  report.punkt = P0;
  if (!P0) throw new Error('brak bazy (PirateRockImpacts.eventAt)');
  // gaz uderzeń wł. / wył. (--gaz 0 — same cząstki)
  if (String(args.gaz ?? '1') === '0') await ev('(() => { const t = window.PirateRock?.state?.()?.impact?.tune; if (t) t.gas = false; return !!t; })()');
  // punkt OŚWIETLONY (słońce z płaszczyzny gry): siatka (e, n) — największe n · słońce poza obrysem bazy
  const LIT = await ev(`(() => {
    const sun = window.SUN, c = window.PirateRockImpacts.center(), base = window.StoryGame.site.dock;
    if (!sun || !c) return null;
    let sx = sun.x - c.x, sy = sun.y - c.y; const l = Math.hypot(sx, sy) || 1; sx /= l; sy /= l;
    let best = null;
    for (let e = -9000; e <= 9000; e += 750) for (let n = -9000; n <= 9000; n += 750) {
      const q = window.PirateRockImpacts.eventAt({ e, n });
      if (!q || base.distance(q.x, q.y) < 2500) continue;
      const lit = q.nx * sx + q.ny * sy;   // gra: y w dół w obu wektorach
      const score = lit - Math.hypot(e, n) / 60000;
      if (lit > 0.18 && (!best || score > best.score)) best = { e, n, lit: +lit.toFixed(3), score, x: q.x, y: q.y };
    }
    return best;
  })()`);
  report.jasny = LIT;
  console.log('punkt oświetlony:', JSON.stringify(LIT));
  if (tryby.has('jasne') && LIT) {
    for (let zi = 0; zi < zoomy.length; zi++) {
      const z = zoomy[zi];
      const e0 = LIT.e + zi * 1500, n0 = LIT.n - zi * 1500;
      const p = await at(e0, n0);
      await camAt(p.x, p.y, z);
      await sleep(900);
      await series(`00-jasne-z${z}`, () => ev(`window.PirateRockImpacts.test({ e: ${e0}, n: ${n0}, kind: 'tower', size: 900, speed: 1900, slide: 260, dirE: 1, dirN: 0.3 }) && true`),
        [0.1, 0.35, 0.8, 1.6, 3, 6]);
    }
  }
  if (tryby.has('duze')) {
    for (let zi = 0; zi < zoomy.length; zi++) {
      const z = zoomy[zi];
      const e0 = -3600 + zi * 2600, n0 = zi * 1800;
      const p = await at(e0, n0);
      await camAt(p.x, p.y, z);
      await sleep(900);
      await series(`01-duze-z${z}`, () => ev(`window.PirateRockImpacts.test({ e: ${e0}, n: ${n0}, kind: 'tower', size: 900, speed: 1900, slide: 260, dirE: 1, dirN: 0.3 }) && true`),
        [0.15, 0.6, 1.5, 3, 6]);
    }
  }
  if (tryby.has('srednie')) {
    const p = await at(-1200, -2600);
    await camAt(p.x, p.y, zoomy[0]);
    await sleep(900);
    await series('02-srednie', () => ev(`(() => { for (let i = 0; i < 3; i++) window.PirateRockImpacts.test({ e: -1200 + (i - 1) * 900, n: -2600 + i * 300, kind: 'drum', size: 300, speed: 900, slide: 120, dirE: 0.5, dirN: 1 }); return true; })()`),
      [0.2, 1.0, 2.5, 5]);
  }
  if (tryby.has('male')) {
    const p = await at(1500, 2200);
    await camAt(p.x, p.y, zoomy[0]);
    await sleep(900);
    await series('03-male', () => ev(`(() => { for (let i = 0; i < 12; i++) window.PirateRockImpacts.schedule(i * 0.15, 0, { e: 1500 + Math.cos(i * 1.7) * 900, n: 2200 + Math.sin(i * 1.7) * 900, kind: 'debris', size: 40 + (i % 4) * 40, speed: 400 + (i % 3) * 400, slide: 80 }); return true; })()`),
      [0.4, 1.2, 2.5]);
  }
  if (tryby.has('szorowanie')) {
    const p = await at(-5200, 2600);
    await camAt(p.x, p.y, zoomy[0]);
    await sleep(900);
    await series('04-szorowanie', () => ev(`(() => { for (let i = 0; i < 12; i++) window.PirateRockImpacts.schedule(i * 0.25, 1, { e: -5200 + i * 120, n: 2600, kind: 'disc', size: 600, speed: 0, slide: 450 - i * 25, dirE: 1, dirN: 0, id: 'tool-scrape' }); return true; })()`),
      [0.8, 2.0, 3.5, 5]);
  }
  if (tryby.has('upadek')) {
    const p = await at(-3600, 0);
    await camAt(p.x, p.y, 0.12);
    await sleep(1500);
    await series('05-upadek', () => ev(`window.PirateRockImpacts.demo('upadek', { e: -3600, n: 0 })`), [0.3, 1.0, 2.0, 3.5, 5.5, 9]);
  }
  if (tryby.has('3d')) {
    // kamera taktyczna nad strefą: gracz nad punktem uderzenia (płaszczyzna gry), kamera patrzy w dół na skałę
    await ev(`(() => { const S = window.StoryGame, q = window.PirateRockImpacts.eventAt({ e: -3000, n: 1400 }); S.deps.placePlayer(q.x, q.y, S.site.dock.axis + 0.9); window.ship.vel.x = 0; window.ship.vel.y = 0; const c = window.camera; if (c.mode === 'rts' && c.exitRtsMode) c.exitRtsMode(); window.Game3D?.setCamera('tactical'); return window.Game3D?.mode; })()`);
    await sleep(2500);
    await series('06-3d-upadek', () => ev(`window.PirateRockImpacts.demo('upadek', { e: -3600, n: 0 })`), [0.4, 1.5, 3, 5.5, 9]);
    await ev(`(() => { window.Game3D?.setCamera('classic'); return true; })()`);
  }
  if (tryby.has('koszt')) {
    // mediana gpuFrameMs (off: Core3D strony) — bez uderzeń, potem z demo upadku (0,5–6 s po starcie)
    const p = await at(-3600, 0);
    await camAt(p.x, p.y, 0.12);
    await sleep(8000);
    const sample = async (sec) => {
      const v = [];
      const t0 = Date.now();
      while (Date.now() - t0 < sec * 1000) { v.push(await ev('window.Core3D?.gpuFrameMs || 0')); await sleep(50); }
      v.sort((a, b) => a - b);
      return { p50: +v[Math.floor(v.length * 0.5)].toFixed(3), p95: +v[Math.floor(v.length * 0.95)].toFixed(3), n: v.length };
    };
    report.koszt = { bez: await sample(4) };
    await ev(`window.PirateRockImpacts.demo('upadek', { e: -3600, n: 0 })`);
    await sleep(500);
    report.koszt.upadek = await sample(5.5);
    await sleep(6000);
    report.koszt.poUpadku = await sample(3);
    console.log('koszt:', JSON.stringify(report.koszt));
  }
  report.koniec = await state();
  report.pipeline = await ev(`(() => {
    const p = (window.__pipeRec?.pipes || []).filter((x) => x.frame > 0);
    const sync = p.filter((x) => x.sync);
    const moje = sync.filter((x) => /RockImpact|WybuchGłęboki|Wybuch/.test(x.nazwa));
    return { wGrze: p.length, sync: sync.length, syncUderzenia: moje.length, lista: sync.slice(0, 40).map((x) => x.nazwa), klatki: sync.slice(0, 40).map((x) => x.frame) };
  })()`);
  report.pipelineWorker = logs.all().filter((l) => /pipeline sync #/.test(l)).slice(0, 60);
  console.log('pipeline:', JSON.stringify(report.pipeline), 'worker:', report.pipelineWorker.length);
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-80);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
