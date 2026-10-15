// PRZESTOJE KLATEK i koszt klatki W GRZE (2026-10-15, sesja optymalizacji wydajności): rejestr KAŻDEJ klatki
// (odstęp rAF, CPU wywołań rAF, próbki zegara GPU, czasy podsystemów), długie zadania (longtask), pipeline'y
// synchroniczne — w oknach scen; A/B wersji kodu w tym samym drzewie (vite.config.js: HULLFALL_AB_DIR).
//
//   node scripts/webgpu/przestoje-gra.mjs [--sceny final,szyja,bitwa] [--ab <katalog oryginałów>] [--przebiegi 1]
//        [--profil 1] [--diag 1] [--kadry 1] [--out .tmp/przestoje] [--rozmiar 1600x900] [--seed 7] [--sklad 30,12,6,2]
//        [--bitwaS 50]
//
// Sceny (misja 1 — skok dev ?story=shipyard, Atlas nieśmiertelny, wieże na auto wstrzymane):
//   final  — Atlas 4,5 km na południe od habitatu; okno „spokoj”; „progi”: punkty habitatu do 36% w jednym ciosie
//            (progi → storyBaseBreak → breakPiece: kawałki pękają, skóry odłamów); bez czekania na wypiek w tle — jak
//            gracz, który dobija budowlę; „rozpad”: śmierć habitatu (_chainExplosion: implozja, reakcja w rurach);
//            „po”: 4 s później.
//   szyja  — szarża F + W w szyb habitatu z prawej (scenariusz szyi, src/game/story/pirateBaseNeck.js): okna wg fazy
//            szyi (szyja:attached / toppling / falling / landed), potem OSTRZAŁ leżącej wieży (Yamato, Mjolnir —
//            okna „yamato”, „mjolnir”) i Supernowa nad dyskiem (okno „supernowa”).
//   bitwa  — gra swobodna, flota piratów i Terra Nova (--sklad f,d,b,s na stronę) w pustce między Wenus a Ziemią;
//            okna „bitwa-start” (0–15 s) i „bitwa” (15 s – --bitwaS).
// --ab <katalog>: przebiegi na przemian A (pliki z katalogu zamiast drzewa — np. oryginały przed optymalizacją)
//   i B (drzewo robocze), w kolejności ABBA…; wynik: tabela A/B (mediany przebiegów).
// --profil 1: profil CPU każdego okna (Profiler CDP, próbkowanie 200 µs; start ~1,5 s przed oknem — sam start
//   zatrzymuje stronę ~1 s): najdłuższe klatki rozbite na funkcje (ciągi próbek z `loop`), self-time okna; przerwy
//   w próbkowaniu > 15 ms wypisane osobno (wątek nie był próbkowany — nie praca funkcji z ostatniej próbki).
// --diag 1: metody Bridge3D w klatkach, w których update trwa > 4 ms (raport: mostkiSkoki).
// --kadry 1: kadry rozpadu habitatu 0,3 / 1 / 2,5 s po śmierci (A/B obrazu).
// Raport: <out>/raport.json (każdy przebieg: okna, statystyki, najgorsze klatki), konsola: tabela.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, screenshotPng } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/przestoje');
mkdirSync(out, { recursive: true });
const SCENY = String(args.sceny || 'final,szyja,bitwa').split(',').map((s) => s.trim()).filter(Boolean);
const AB = args.ab ? resolve(repo, args.ab) : null;
const PRZEBIEGI = Math.max(1, Number(args.przebiegi || 1));
const PROFIL = args.profil === '1';
const SEED = args.seed !== undefined ? Number(args.seed) >>> 0 : 7;
const SKLAD = String(args.sklad || '30,12,6,2').split(',').map((v) => Math.max(0, Number(v) || 0));
const BITWA_S = Number(args.bitwaS || 50);
const KADRY = args.kadry === '1';   // kadry rozpadu habitatu (scena final) — A/B obrazu

// Rejestr klatek (przed skryptami strony): odstęp rAF klatki (start następnej − start tej), CPU wszystkich wywołań
// rAF tej klatki, nowa próbka zegara GPU (Core3D.gpuFrameMs — wynik przychodzi z opóźnieniem kilku klatek), czasy
// opakowanych podsystemów w klatce, najdłuższy krok wypieku skór ciał świata (WORLD_SKIN_STATS.bakePeakMs, zerowany
// co klatkę), liczba wypieków w klatce (syncBakes). Okno = etykieta R.win (ustawia narzędzie).
const INJECT = `(() => {
  ${args.diag === '1' ? 'window.__pzDiag = true;' : ''}
  ${SEED ? `let s = ${SEED};
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };` : ''}
  const R = window.__pz = { on: false, win: '', frames: [], lt: [], pipes: [] };
  const acc = { phys: 0, wb: 0, br: 0, core: 0 };
  const raf = window.requestAnimationFrame.bind(window);
  let curTs = -1, cpu = 0, gpuSeen = 0, syncSeen = 0;
  const endFrame = (nextTs) => {
    const C = window.Core3D, S = window.__worldSkinStats;
    let gpu = -1;
    if (C && C.gpuFrameSamples !== gpuSeen) { gpuSeen = C.gpuFrameSamples; gpu = C.gpuFrameMs; }
    const bake = S ? S.bakePeakMs : 0;
    if (S) S.bakePeakMs = 0;
    const sync = S ? S.syncBakes - syncSeen : 0;
    if (S) syncSeen = S.syncBakes;
    if (!R.on) return;
    const f = (x) => Math.round(x * 100) / 100;
    R.frames.push([f(nextTs - curTs), f(cpu), gpu > 0 ? f(gpu) : -1, f(acc.phys), f(acc.wb), f(acc.br), f(acc.core), f(bake), sync, R.win, f(performance.now())]);
  };
  window.requestAnimationFrame = function (cb) {
    return raf((ts) => {
      if (ts !== curTs) {
        if (curTs >= 0) endFrame(ts);
        curTs = ts; cpu = 0; acc.phys = 0; acc.wb = 0; acc.br = 0; acc.core = 0;
      }
      const t0 = performance.now();
      try { cb(ts); } finally { cpu += performance.now() - t0; }
    });
  };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (R.on) R.lt.push([Math.round(e.startTime), Math.round(e.duration), R.win]); })
      .observe({ entryTypes: ['longtask'] });
  } catch (e) { /* bez longtask */ }
  const hook = setInterval(() => {
    const HB = window.HullBodies, WB = window.WorldBodies, BR = window.Bridge3D, C = window.Core3D;
    if (!HB || !WB || !BR || !C || !C.renderer || !C.renderer.backend || !C.renderer.backend.pipelineUtils) return;
    clearInterval(hook);
    const wrap = (obj, name, key) => {
      const fn = obj[name];
      if (typeof fn !== 'function' || fn.__pz) return;
      const g = function (...a) { const t = performance.now(); try { return fn.apply(this, a); } finally { acc[key] += performance.now() - t; } };
      g.__pz = true;
      obj[name] = g;
    };
    wrap(HB, 'step', 'phys'); wrap(WB, 'step', 'wb'); wrap(BR, 'update', 'br'); wrap(C, 'renderSingle', 'core');
    // --diag 1: metody Bridge3D w klatce (najdroższe klatki mostków — R.brSpikes)
    if (window.__pzDiag) {
      const parts = R.brParts = {};
      for (const name of ['_adopt', '_createRecord', '_retire', '_findHost', '_anyAlive', '_findMoved', '_refreshFor', '_reacquireRow', '_frameRecord', '_emit', '_hostOwns', '_hostChanged']) {
        const fn = BR[name];
        if (typeof fn !== 'function') continue;
        BR[name] = function (...a) { const t = performance.now(); try { return fn.apply(this, a); } finally { const p = parts[name] || (parts[name] = [0, 0]); p[0] += performance.now() - t; p[1]++; } };
      }
      R.brSpikes = [];
      const upd = BR.update;
      BR.update = function (...a) {
        for (const k in parts) { parts[k][0] = 0; parts[k][1] = 0; }
        const t = performance.now();
        try { return upd.apply(this, a); } finally {
          const ms = performance.now() - t;
          if (ms > 4 && R.on && R.brSpikes.length < 50) {
            const o = { ms: Math.round(ms * 10) / 10, win: R.win, ents: (a[0] || []).length, rec: this.records.length };
            for (const k in parts) if (parts[k][1]) o[k] = [Math.round(parts[k][0] * 10) / 10, parts[k][1]];
            R.brSpikes.push(o);
          }
        }
      };
    }
    const pu = C.renderer.backend.pipelineUtils, cr = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (!promises && R.on) R.pipes.push(((ro && ro.material && (ro.material.name || ro.material.type)) || '?') + ' @ ' + ((ro && ro.object && (ro.object.name || ro.object.type)) || '?') + ' [' + R.win + ']');
      return cr.call(this, ro, promises);
    };
  }, 20);
})();`;

// --- statystyki okna -------------------------------------------------------------------------------------
const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
function windowStats(frames, lts) {
  const dt = frames.map((f) => f[0]).sort((a, b) => a - b);
  const cpu = frames.map((f) => f[1]).sort((a, b) => a - b);
  const gpu = frames.map((f) => f[2]).filter((g) => g > 0).sort((a, b) => a - b);
  const col = (k) => frames.map((f) => f[k]).sort((a, b) => a - b);
  const phys = col(3), wb = col(4), br = col(5), core = col(6), bake = col(7);
  const r1 = (x) => Math.round(x * 10) / 10;
  const worst = frames.slice().sort((a, b) => b[0] - a[0]).slice(0, 6)
    .map((f) => ({ dt: f[0], cpu: f[1], gpu: f[2], fiz: f[3], wb: f[4], most: f[5], core: f[6], wypiek: f[7], wypiekow: f[8] }));
  return {
    klatek: frames.length,
    dt: { p50: r1(q(dt, 0.5)), p95: r1(q(dt, 0.95)), p99: r1(q(dt, 0.99)), max: r1(q(dt, 1)) },
    ponad: { '33': dt.filter((x) => x > 33).length, '50': dt.filter((x) => x > 50).length, '100': dt.filter((x) => x > 100).length },
    cpu: { p50: r1(q(cpu, 0.5)), p95: r1(q(cpu, 0.95)), max: r1(q(cpu, 1)), ponad33: cpu.filter((x) => x > 33).length },
    gpu: { probek: gpu.length, p50: r1(q(gpu, 0.5)), p95: r1(q(gpu, 0.95)), max: r1(q(gpu, 1)) },
    fizyka: { p50: r1(q(phys, 0.5)), p95: r1(q(phys, 0.95)), max: r1(q(phys, 1)) },
    swiat: { p95: r1(q(wb, 0.95)), max: r1(q(wb, 1)) },
    mostki: { p95: r1(q(br, 0.95)), max: r1(q(br, 1)) },
    core: { p50: r1(q(core, 0.5)), p95: r1(q(core, 0.95)), max: r1(q(core, 1)) },
    wypiek: { max: r1(q(bake, 1)), klatekPonad8: bake.filter((x) => x > 8).length, wKlatce: frames.reduce((s, f) => s + (f[8] || 0), 0) },
    longtask: { n: lts.length, max: lts.reduce((m, l) => Math.max(m, l[1]), 0), suma: lts.reduce((s, l) => s + l[1], 0) },
    najgorsze: worst
  };
}

// --- najdłuższe klatki profilu (ciągi próbek z `loop` — pętla rAF gry) -----------------------------------
function analyzeProfile(profile, topN = 3) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
  const name = (id) => { const cf = nodes.get(id).callFrame; return `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`; };
  const inLoop = new Map();
  const hasLoop = (id) => {
    if (inLoop.has(id)) return inLoop.get(id);
    let r = false;
    for (let x = id; x !== undefined; x = parent.get(x)) if (nodes.get(x).callFrame.functionName === 'loop') { r = true; break; }
    inLoop.set(id, r);
    return r;
  };
  const t = [];
  let acc = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) { acc += profile.timeDeltas[i]; t.push(acc); }
  // przerwy w próbkowaniu (> 15 ms) — wątek nie był próbkowany (np. wywłaszczenie procesu): nie mylić z pracą funkcji
  const gaps = [];
  for (let i = 1; i < profile.samples.length; i++) if (profile.timeDeltas[i] > 15000) gaps.push(Math.round(profile.timeDeltas[i] / 1000));
  const runs = [];
  let s0 = -1;
  for (let i = 0; i < profile.samples.length; i++) {
    const r = hasLoop(profile.samples[i]);
    if (r && s0 < 0) s0 = i;
    if ((!r || i === profile.samples.length - 1) && s0 >= 0) { runs.push([s0, i]); s0 = -1; }
  }
  runs.sort((a, b) => (t[b[1]] - t[b[0]]) - (t[a[1]] - t[a[0]]));
  const top = [];
  for (const [a, b] of runs.slice(0, topN)) {
    const ms = (t[b] - t[a]) / 1000;
    const total = new Map(), self = new Map();
    for (let i = a; i < b; i++) {
      const d = (t[i + 1] - t[i]) / 1000, id = profile.samples[i];
      self.set(name(id), (self.get(name(id)) || 0) + d);
      const seen = new Set();
      for (let x = id; x !== undefined; x = parent.get(x)) { const nm = name(x); if (seen.has(nm)) continue; seen.add(nm); total.set(nm, (total.get(nm) || 0) + d); }
    }
    const r1 = (v) => Math.round(v * 10) / 10;
    top.push({ ms: r1(ms),
      lacznie: [...total].sort((x, y) => y[1] - x[1]).slice(0, 28).map(([k, v]) => `${r1(v)} ${k}`),
      wlasny: [...self].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `${r1(v)} ${k}`) });
  }
  return { klatekLoop: runs.length, przerwyPonad15ms: gaps.slice(0, 10), najdluzsze: top };
}

// --- przebieg ---------------------------------------------------------------------------------------------
async function runVariant(label, abDir, port) {
  if (abDir) process.env.HULLFALL_AB_DIR = abDir; else delete process.env.HULLFALL_AB_DIR;
  const { server, base } = await startVite(port);
  delete process.env.HULLFALL_AB_DIR;
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, tmo = 120000) => evaluate(cdp, e, tmo);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
  const res = { wariant: label, okna: {}, profile: {}, bledy: [] };
  let profiling = false;

  // okno pomiaru: etykieta, opcjonalny profil CPU (start przed oknem — przestój startu profilera poza oknem)
  const beginWindow = async (win) => {
    if (PROFIL) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
      profiling = true;
      await sleep(1500);
    }
    await ev(`(() => { const R = window.__pz; R.frames.length = 0; R.lt.length = 0; R.win = ${JSON.stringify(win)}; R.on = true; if (window.Core3D) window.Core3D.gpuTimerSampleEvery = 1; return true; })()`);
  };
  const endWindow = async () => {
    const data = await ev(`(() => { const R = window.__pz; R.on = false; const f = R.frames.slice(), l = R.lt.slice(); R.frames.length = 0; R.lt.length = 0;
      const S = window.__worldSkinStats; return { f, l, skora: S ? JSON.parse(JSON.stringify(S)) : null }; })()`);
    let prof = null;
    if (profiling) {
      const { profile } = await cdp.send('Profiler.stop');
      profiling = false;
      prof = profile;
    }
    // podział wg etykiet (scena szyi zmienia etykietę w trakcie okna)
    const by = new Map();
    for (const fr of data.f) { const k = fr[9]; if (!by.has(k)) by.set(k, []); by.get(k).push(fr); }
    for (const [k, frs] of by) {
      const lts = data.l.filter((x) => x[2] === k);
      res.okna[k] = windowStats(frs, lts);
      res.okna[k].skora = data.skora;
      const s = res.okna[k];
      console.log(`  [${label}] ${k.padEnd(18)} kl ${String(s.klatek).padStart(5)} | dt p50 ${s.dt.p50} p95 ${s.dt.p95} p99 ${s.dt.p99} max ${s.dt.max} | >33 ${s.ponad['33']} >50 ${s.ponad['50']} >100 ${s.ponad['100']} | cpu p95 ${s.cpu.p95} max ${s.cpu.max} | gpu p50 ${s.gpu.p50} max ${s.gpu.max} | fiz max ${s.fizyka.max} | most max ${s.mostki.max} | wypiek max ${s.wypiek.max} (${s.wypiek.wKlatce}) | lt ${s.longtask.n}/${s.longtask.max}`);
    }
    if (prof) {
      const key = [...by.keys()].join('+') || 'okno';
      const file = join(out, `${label}-${key.replace(/[^a-z0-9+_-]/gi, '_')}.cpuprofile`);
      writeFileSync(file, JSON.stringify(prof));
      res.profile[key] = { plik: file, ...analyzeProfile(prof) };
      for (const t of res.profile[key].najdluzsze.slice(0, 2)) console.log(`    profil ${t.ms} ms: ${t.lacznie.slice(3, 12).join(' | ')}`);
    }
  };

  const GUARD = `(() => {
    if (window.__guard) return true;
    window.__guard = setInterval(() => {
      const s = window.ship;
      if (!s) return;
      if (s.hull) s.hull.val = s.hull.max;
      if (s.shield) s.shield.val = s.shield.max;
      if (window.fireControl) window.fireControl.posture = 'hold';
    }, 100);
    return true;
  })()`;

  async function startStory(phase) {
    for (let i = 0; ; i++) {
      try {
        await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=${phase}` });
        if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
        await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
        await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
        await sleep(1200);
        await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
        await sleep(700);
        await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
        if (!await waitFor(cdp, `window.StoryGame.active && window.StoryGame.phase === '${phase}' && !!window.StoryGame.site?.station`, 90000, 400)) throw new Error(`faza ${phase} nie ruszyła`);
        return;
      } catch (err) {
        if (i >= 2) throw err;
        console.log(`start fazy ${phase} — ponowienie (${err.message})`);
      }
    }
  }
  const placeHub = (x, z, heading, speed = 0) => ev(`(() => {
    const S = window.StoryGame, d = S.site.dock, ship = window.ship;
    const p = d.toGame(${x}, ${z}), a = d.headingToGame(${heading});
    S.deps.placePlayer(p.x, p.y, a);
    ship.vel.x = Math.cos(a) * ${speed}; ship.vel.y = Math.sin(a) * ${speed};
    return true;
  })()`);
  const camHub = (x, z, zoom) => ev(`(() => {
    const site = window.StoryGame.site, c = window.camera, p = site.dock.toGame(${x}, ${z});
    if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
    c.x = c.targetX = p.x; c.y = c.targetY = p.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
    document.getElementById('cockpit-ui-host')?.classList.add('hidden');
    for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
    return true;
  })()`);
  const camShip = (zoom) => ev(`(() => {
    const c = window.camera;
    if (c.mode === 'rts' && typeof c.exitRtsMode === 'function') c.exitRtsMode();
    c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
    return true;
  })()`);
  const key = (code, k, vk) => ({ key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  const KEY_W = key('KeyW', 'w', 87), KEY_F = key('KeyF', 'f', 70);

  async function sceneFinal() {
    await startStory('shipyard');
    await sleep(2000);
    await ev(GUARD);
    await placeHub(0, 4500, -Math.PI / 2, 0);
    await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 0', 30000, 200);
    await sleep(1500);
    await camHub(0, 0, 0.12);
    await sleep(2500);
    await beginWindow('final:spokoj');
    await sleep(3000);
    await endWindow();
    await beginWindow('final:progi');
    const L = await ev(`(() => { const l = window.StoryGame.site.dock.layout; return { drumR: l.habitat.drumR }; })()`);
    await ev(`(() => {
      const S = window.StoryGame, st = S.site.structures.habitat, d = S.site.dock;
      const p = d.toGame(0, ${L.drumR} * 0.85);
      st.lastHitX = p.x; st.lastHitY = p.y;
      window.applyDamageToStation(st, st.hp - st.maxHp * 0.36);
      return true;
    })()`);
    await sleep(6000);
    await endWindow();
    await beginWindow('final:rozpad');
    await ev(`(() => { const st = window.StoryGame.site.structures.habitat; window.applyDamageToStation(st, st.hp + 10); return true; })()`);
    if (KADRY) {
      // kadry rozpadu (A/B obrazu: statyka trzymana do skóry odłamów, odłamy bez znikania)
      let t = 0;
      for (const at of [300, 1000, 2500]) { await sleep(at - t); t = at; await screenshotPng(cdp, join(out, `${label}-rozpad-${at}ms.png`)); }
      await sleep(10000 - t);
    } else await sleep(10000);
    await endWindow();
    await beginWindow('final:po');
    await sleep(4000);
    await endWindow();
  }

  async function sceneSzyja() {
    await startStory('shipyard');
    await sleep(2000);
    await ev(GUARD);
    // okno (i start profilera, ~1,5 s) PRZED ustawieniem Atlasa z rozpędem — inaczej doleciałby do bębna przed szarżą
    await beginWindow('szyja:attached');
    await ev(`(() => {
      const S = window.StoryGame, d = S.site.dock, hc = d.habitat, H = d.layout.habitat;
      S.deps.placePlayer(hc.x + H.drumR + 2400, hc.y + 40, Math.PI);
      window.ship.vel.x = -1500; window.ship.vel.y = 0;
      window.setFogOfWar?.(false);
      for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
      return true;
    })()`);
    await camShip(0.2);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_W });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_F });
    await sleep(80);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_F });
    let landedAt = -1;
    for (let i = 0; i < 160; i++) {
      await sleep(250);
      const ph = await ev(`(() => { const hs = window.WorldBodies.sites.find((q) => q.structure === 'habitat'); const n = hs && hs.neck; const ph = n ? n.phase : '-'; window.__pz.win = 'szyja:' + ph; return ph; })()`);
      if (ph === 'landed' && landedAt < 0) landedAt = i;
      if (landedAt >= 0 && i - landedAt >= 16) break;
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_W });
    await endWindow();
    // ostrzał leżącej wieży: cele w przekroju z pasem broni, Atlas w wolnym miejscu (jak baza-zniszczenie-gra.mjs)
    const cele = await ev(`(() => {
      const HB = window.HullBodies, hs = window.WorldBodies.sites.find((q) => q.structure === 'habitat');
      const tw = hs && hs.neck && hs.neck.tower, hull = tw && tw.beamHull, b = hull && hull.entity === tw ? hull.body : null;
      if (!b) return null;
      const s = b.nodeStore, lim = HB.config.weaponBand + 0.5 * b.cellSize, w = { x: 0, y: 0, z: 0 }, P = [];
      for (let i = 0; i < s.count; i++) { if (!s.active[i]) continue; HB.nodeWorld(hull, i, w); if (Math.abs(w.z) <= lim) P.push([w.x, w.y]); }
      if (P.length < 10) return null;
      let mx = 0, my = 0; for (const p of P) { mx += p[0]; my += p[1]; } mx /= P.length; my /= P.length;
      let sxx = 0, syy = 0, sxy = 0; for (const p of P) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const a = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(a), uy = Math.sin(a);
      const T = P.map((p) => (p[0] - mx) * ux + (p[1] - my) * uy), ts = T.slice().sort((x, y) => x - y);
      const t0 = ts[Math.floor(ts.length * 0.04)], t1 = ts[Math.floor(ts.length * 0.96)], pts = [];
      for (let k = 0; k < 7; k++) {
        const tk = t0 + (t1 - t0) * (k + 0.5) / 7;
        let best = null, bd = Infinity;
        for (let i = 0; i < P.length; i++) { const d = Math.abs(T[i] - tk); if (d < bd) { bd = d; best = P[i]; } }
        pts.push(best);
      }
      const d = window.StoryGame.site.dock, hc = d.habitat, H = d.layout.habitat;
      return { pts, ux, uy, nx: -uy, ny: ux, mx, my, hab: [hc.x, hc.y], drumR: H.drumR, discR: H.discR };
    })()`);
    if (!cele) { console.log('  ostrzał: brak wieży w pasie'); return; }
    const miejsce = await ev(`(() => {
      const S = window.StoryGame, d = S.site.dock, l = d.layout, C = ${JSON.stringify(cele)}, boxes = [];
      for (const c of l.chunkById.values()) {
        if (!c.box) continue;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [x, z] of [[c.box.x0, c.box.z0], [c.box.x1, c.box.z0], [c.box.x0, c.box.z1], [c.box.x1, c.box.z1]]) {
          const g = d.toGame(x, z); x0 = Math.min(x0, g.x); x1 = Math.max(x1, g.x); y0 = Math.min(y0, g.y); y1 = Math.max(y1, g.y);
        }
        boxes.push([x0, x1, y0, y1]);
      }
      const ents = (window.npcs || []).filter((n) => n && !n.dead).map((n) => [n.pos ? n.pos.x : n.x, n.pos ? n.pos.y : n.y, n.radius || 300]);
      let best = null;
      for (const D of [3000, 3800, 4600, 5400, 6200]) for (const side of [1, -1]) for (const sh of [0, -0.35, 0.35]) {
        const x = C.mx + C.nx * side * D + C.ux * sh * D, y = C.my + C.ny * side * D + C.uy * sh * D;
        let dmin = Infinity;
        for (const b of boxes) { const dx = Math.max(b[0] - x, 0, x - b[1]), dy = Math.max(b[2] - y, 0, y - b[3]); dmin = Math.min(dmin, Math.hypot(dx, dy)); }
        for (const e of ents) dmin = Math.min(dmin, Math.hypot(e[0] - x, e[1] - y) - e[2]);
        if (!best || dmin > best.wolne) best = { x, y, wolne: Math.round(dmin) };
        if (dmin >= 1400) return best;
      }
      return best;
    })()`);
    await ev(`(() => {
      const p = ${JSON.stringify(miejsce)}, C = ${JSON.stringify(cele)};
      window.StoryGame.deps.placePlayer(p.x, p.y, Math.atan2(C.my - p.y, C.mx - p.x));
      window.ship.vel.x = 0; window.ship.vel.y = 0;
      const c = window.camera;
      if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
      c.x = c.targetX = C.mx; c.y = c.targetY = C.my; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = 0.2;
      return true;
    })()`);
    await sleep(3000);
    for (const [bron, win] of [['special_yamato_cannon', 'yamato'], ['siege_railgun', 'mjolnir']]) {
      await beginWindow(win);
      await ev(`new Promise((res) => {
        const C = ${JSON.stringify(cele)};
        let k = 0;
        const tick = () => {
          const p = C.pts[k % C.pts.length], side = (k & 1) ? 1 : -1;
          const mx = p[0] + C.nx * side * 1800, my = p[1] + C.ny * side * 1800, dx = p[0] - mx, dy = p[1] - my, len = Math.hypot(dx, dy) || 1;
          try { window.fireWeaponCore(window.ship, null, ${JSON.stringify(bron)}, { pos: { x: mx, y: my }, dir: { x: dx / len, y: dy / len }, baseVel: { x: 0, y: 0 } }); } catch (e) { console.error('[przestoje] strzał', e); }
          if (++k >= 24) { clearInterval(h); res(k); }
        };
        const h = setInterval(tick, 120);
        tick();
      })`, 60000);
      await sleep(2500);
      await endWindow();
    }
    await beginWindow('supernowa');
    await ev(`(() => {
      const C = ${JSON.stringify(cele)};
      const r = (C.drumR + C.discR) / 2, a = Math.atan2(C.my - C.hab[1], C.mx - C.hab[0]) + Math.PI * 0.75;
      const tx = C.hab[0] + Math.cos(a) * r, ty = C.hab[1] + Math.sin(a) * r;
      const mx = tx + Math.cos(a + 1.3) * 3000, my = ty + Math.sin(a + 1.3) * 3000, dx = tx - mx, dy = ty - my, len = Math.hypot(dx, dy) || 1;
      try { window.fireWeaponCore(window.ship, { x: tx, y: ty, dead: false, _isPositionTarget: true }, 'supernova_missile', { pos: { x: mx, y: my }, dir: { x: dx / len, y: dy / len }, baseVel: { x: 0, y: 0 } }); } catch (e) { console.error('[przestoje] supernowa', e); }
      return true;
    })()`);
    await sleep(8000);
    await endWindow();
  }

  async function sceneBitwa() {
    // gra swobodna bez samouczka (opcje z localStorage czyta strona przy starcie — wpis i ponowne wczytanie)
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 240000, 400)) throw new Error('gra nie wstała');
    await ev(`(() => { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 240000, 400)) throw new Error('gra nie wstała');
    await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, '(window.__frameId || 0) > 30 && !!window.camera', 240000, 400)) throw new Error('gra swobodna nie ruszyła');
    await sleep(2000);
    await ev(`(() => {
      const pl = (window.planets || []).map((p) => ({ x: p.x ?? p.pos?.x, y: p.y ?? p.pos?.y, n: p.name || p.id })).filter((p) => Number.isFinite(p.x));
      const st = (window.stations || []).map((s) => ({ x: s.x ?? s.pos?.x, y: s.y ?? s.pos?.y })).filter((p) => Number.isFinite(p.x));
      const sun = window.SUN || { x: 0, y: 0 };
      const rOf = (re) => { const p = pl.find((q) => re.test(String(q.n))); return p ? Math.hypot(p.x - sun.x, p.y - sun.y) : NaN; };
      const R = (rOf(/venus|wenus/i) + rOf(/earth|ziemia/i)) / 2;
      let best = null;
      for (let k = 0; k < 96; k++) {
        const a = (k / 96) * Math.PI * 2, x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
        let dmin = Infinity; for (const p of pl.concat(st)) dmin = Math.min(dmin, Math.hypot(p.x - x, p.y - y));
        if (!best || dmin > best.dmin) best = { x, y, dmin };
      }
      window.DevScene.teleport(best.x, best.y, 0); window.DevScene.syncCamera();
      const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = 0.1;
      window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return; if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
      return true;
    })()`);
    await sleep(4000);
    await beginWindow('bitwa:spokoj');
    await sleep(4000);
    await endWindow();
    const [NF, ND, NB, NS] = SKLAD;
    await ev(`(() => {
      const s = window.ship, a = 0, c = Math.cos(a), n = Math.sin(a);
      const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
      const put = (key, mode, pos, ang) => window.spawnCallInShip(key, { mode, spawnPos: pos, pos, spawnAngle: ang });
      const block = (key, mode, k, fwd0, rowGap, spacing, perRow, dir, ang) => {
        for (let i = 0; i < k; i++) { const row = Math.floor(i / perRow), inRow = Math.min(perRow, k - row * perRow), j = i - row * perRow;
          put(key, mode, at(fwd0 + dir * row * rowGap, (j - (inRow - 1) / 2) * spacing), ang); } };
      block('frigate_pd', 'pirate', ${NF}, 7000, 700, 650, 25, 1, a + Math.PI);
      block('destroyer', 'pirate', ${ND}, 8600, 900, 900, 20, 1, a + Math.PI);
      block('pirate_battleship', 'pirate', ${NB}, 10600, 1500, 1500, 10, 1, a + Math.PI);
      block('pirate_supercapital', 'pirate', ${NS}, 13500, 3500, 4000, 5, 1, a + Math.PI);
      block('frigate_laser', 'friendly', ${NF}, -1500, 700, 650, 25, -1, a);
      block('destroyer', 'friendly', ${ND}, -3100, 900, 900, 20, -1, a);
      block('battleship', 'friendly', ${NB}, -5100, 1500, 1500, 10, -1, a);
      block('supercapital', 'friendly', ${NS}, -8000, 3500, 4000, 5, -1, a);
      const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = 0.1;
      return true;
    })()`);
    await beginWindow('bitwa:start');
    await sleep(15000);
    await endWindow();
    await beginWindow('bitwa');
    await sleep(Math.max(5, BITWA_S - 15) * 1000);
    await endWindow();
  }

  try {
    for (const sc of SCENY) {
      const t0 = Date.now();
      if (sc === 'final') await sceneFinal();
      else if (sc === 'szyja') await sceneSzyja();
      else if (sc === 'bitwa') await sceneBitwa();
      console.log(`  [${label}] scena ${sc}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    res.pipeline = await ev('(() => window.__pz.pipes.slice(0, 40))()');
    if (args.diag === '1') {
      res.mostkiSkoki = await ev('(() => (window.__pz.brSpikes || []).slice(0, 50))()');
      for (const s of res.mostkiSkoki.slice(0, 12)) console.log(`  [${label}] Bridge3D ${JSON.stringify(s)}`);
    }
    res.bledy = logs.errors().slice(0, 30);
    if (res.pipeline.length) console.log(`  [${label}] pipeline'y synchroniczne w oknach: ${res.pipeline.length}`, res.pipeline.slice(0, 6));
    if (res.bledy.length) console.log(`  [${label}] BŁĘDY:\n    ` + res.bledy.slice(0, 8).join('\n    '));
  } catch (err) {
    res.wyjatek = String(err?.stack || err);
    console.error(err);
    console.log(logs.all().slice(-30).join('\n'));
  } finally {
    await chrome.close();
    await server.close();
  }
  return res;
}

// --- przebiegi i tabela A/B --------------------------------------------------------------------------------
const order = [];
for (let i = 0; i < PRZEBIEGI; i++) {
  if (AB) order.push(...(i % 2 === 0 ? ['A', 'B'] : ['B', 'A']));
  else order.push('B');
}
const runs = [];
let port = Number(args.port || 5391);
for (const v of order) {
  console.log(`== przebieg ${runs.length + 1}/${order.length}: ${v === 'A' ? 'A (oryginały: ' + AB + ')' : 'B (drzewo robocze)'}`);
  const r = await runVariant(v, v === 'A' ? AB : null, port++);
  runs.push(r);
  writeFileSync(join(out, 'raport.json'), JSON.stringify({ sceny: SCENY, ab: AB, seed: SEED, sklad: SKLAD, runs }, null, 1));
}
// mediany po przebiegach wariantu
const med = (arr) => { const a = arr.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : NaN; };
const wins = [...new Set(runs.flatMap((r) => Object.keys(r.okna)))];
console.log('\n== TABELA (mediana przebiegów wariantu): okno | dt p50 / p95 / p99 / max | >33 / >50 / >100 | cpu p95 / max | gpu p50 / max | fizyka max | wypiek max');
for (const w of wins) {
  for (const v of AB ? ['A', 'B'] : ['B']) {
    const rs = runs.filter((r) => r.wariant === v && r.okna[w]).map((r) => r.okna[w]);
    if (!rs.length) continue;
    const m = (f) => med(rs.map(f));
    console.log(`${w.padEnd(18)} ${v} | ${m((s) => s.dt.p50)} / ${m((s) => s.dt.p95)} / ${m((s) => s.dt.p99)} / ${m((s) => s.dt.max)} | ${m((s) => s.ponad['33'])} / ${m((s) => s.ponad['50'])} / ${m((s) => s.ponad['100'])} | ${m((s) => s.cpu.p95)} / ${m((s) => s.cpu.max)} | ${m((s) => s.gpu.p50)} / ${m((s) => s.gpu.max)} | ${m((s) => s.fizyka.max)} | ${m((s) => s.wypiek.max)}  (n=${rs.length})`);
  }
}
console.log(`\nraport: ${join(out, 'raport.json')}`);
process.exit(0);
