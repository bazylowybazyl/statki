// Wstrzykiwane do strony gry PRZED jej skryptami (CDP Page.addScriptToEvaluateOnNewDocument)
// przez scripts/webgpu/zrzuty.mjs. Gry nie zmienia — podmienia tylko źródła czasu i losowości,
// żeby klatka była powtarzalna:
//  - zegar wirtualny: performance.now(), Date.now() i znacznik rAF. Tryby:
//      'frozen' — czas stoi (gra: dt = 0, fizyka nie kroczy, efekty stoją; render trwa),
//      'step'   — każda klatka rAF przesuwa czas o stepMs, przez stepsLeft klatek, potem 'frozen',
//      'real'   — przepuszcza prawdziwy czas;
//    start w 'frozen' (tło menu i świat gry stoją na t = 0, niezależnie od długości ładowania);
//  - Math.random z ziarnem (mulberry32) — ten sam świat i te same decyzje przy tych samych krokach;
//  - dyspozytor rAF: wywołania rAF strony (pętla gry, tło menu, pętla three) idą przez ticker;
//    w trybie „hold” tylko w klatkach zamówionych przez harness (frames/step) — między komendami
//    CDP strona stoi, więc liczba klatek (i efekty liczone na klatkę: iskry, obrót stacji) jest
//    powtarzalna. Bez „hold” (ładowanie) każda prawdziwa klatka jest dozwolona;
//  - CSS bez animacji i przejść (menu, HUD) — inaczej zrzut łapie je w połowie.
//  - dziennik klatek (prawdziwy czas: start, CPU wywołań rAF, __frameId), chwile startu (urządzenie,
//    tło menu, ring Ziemi, pierwsza klatka gry) i dziennik pipeline'ów (synchroniczne = przestój) —
//    przestoje kompilacji w scenach (zadanie 11).
// window.__harness: clock, step(n), frames(n), hold(on), reseed(v), freeze(), realNow(), scene,
//   frameLog, marks, pipes, frameStats(od, do, próg).
(() => {
  if (window.__harness) return;
  const SEED = Number(window.__HARNESS_SEED__ || 0x5eed1234) >>> 0;
  const realNow = performance.now.bind(performance);
  const realDateNow = Date.now.bind(Date);
  const realRaf = window.requestAnimationFrame.bind(window);
  // Stała baza czasu (nie realNow()): porównania typu now − lastShot ≥ cooldown na liczbach
  // zmiennoprzecinkowych zależą od bezwzględnej wartości — z bazą z chwili wczytania strzał
  // wypadał o klatkę wcześniej/później w zależności od przebiegu (rozjazd pocisków w bitwie).
  const T0 = 10000;
  void realDateNow;
  const clock = {
    mode: 'frozen',
    t: T0,
    dateBase: Date.UTC(2026, 0, 1) - T0,
    stepMs: 1000 / 60,
    stepsLeft: 0,
    frames: 0,        // prawdziwe klatki (ticker)
    gameFrames: 0,    // klatki, w których strona dostała rAF
    steppedFrames: 0,
    hold: false,
    budget: 0
  };
  const virtualNow = () => (clock.mode === 'real' ? realNow() : clock.t);
  performance.now = virtualNow;
  Date.now = () => Math.round(clock.dateBase + virtualNow());

  // Wywołania rAF strony czekają tu na klatkę dozwoloną przez ticker.
  const pending = new Map();
  let rafSeq = 0;
  window.requestAnimationFrame = (cb) => { const id = ++rafSeq; pending.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { pending.delete(id); };

  // Dziennik klatek strony (zadanie 11 — przestoje kompilacji): prawdziwy start klatki, CPU jej
  // wywołań rAF i __frameId gry. Seria = klatki bez przerwy harnessu (w trybie hold przerwa między
  // komendami CDP zaczyna nową serię — jej długość to nie czas klatki). Okres klatki = start następnej
  // w tej samej serii − start tej (obejmuje przestój kolejki GPU), ostatnia w serii: samo CPU.
  const LOG = 32768;
  const frameLog = { start: new Float64Array(LOG), cpu: new Float32Array(LOG), game: new Int32Array(LOG), seria: new Int32Array(LOG), n: 0, _seria: 0, _przerwa: true };
  let inTick = false; // w wywołaniach rAF strony (dziennik pipeline'ów)
  const logFrame = (t0, cpu) => {
    const i = frameLog.n % LOG;
    if (frameLog._przerwa) { frameLog._seria++; frameLog._przerwa = false; }
    frameLog.start[i] = t0; frameLog.cpu[i] = cpu; frameLog.game[i] = window.__frameId | 0; frameLog.seria[i] = frameLog._seria;
    frameLog.n++;
  };
  // Chwile startu (prawdziwy czas od nawigacji, pierwsza obserwacja co ~10 ms): urządzenie WebGPU, tło
  // menu (pierwsza klatka, gotowe), ring Ziemi (mapy), pierwsza klatka gry.
  const marks = {};
  const markPoll = setInterval(() => {
    try {
      const m = (k, ok) => { if (marks[k] === undefined && ok) marks[k] = +realNow().toFixed(1); };
      m('gpuReady', window.Core3D?.gpuReady === true);
      m('menuPierwszaKlatka', (window.__menuBackdrop?.stats?.frames || 0) > 0);
      m('menuGotowe', window.__menuBackdrop?.ready === true);
      m('ringZiemi', !!window.__haloRings?.entries?.find((e) => e.key === 'earth')?.ring?.mapsReady);
      m('graPierwszaKlatka', (window.__frameId | 0) >= 1);
      if (marks.graPierwszaKlatka !== undefined && marks.ringZiemi !== undefined) clearInterval(markPoll);
    } catch { /* strona się ładuje */ }
  }, 10);
  // Pipeline'y three (zadanie 11): każde utworzenie z numerem klatki dziennika — render synchronicznie
  // w zwykłym renderze (sync: proces GPU kompiluje shader, strona staje przy najbliższym zapisie do
  // kolejki) albo w tle z compileAsync; compute zawsze synchronicznie. Nazwa = typ:nazwa materiału @
  // obiekt — co kompilowało się w przestoju (frameStats → `pipeline`, `lista[].pipeline`). Hak na
  // backend.pipelineUtils po powstaniu urządzenia (na tagu WebGL pola nie ma — dziennik pusty).
  const PIPE_MAX = 16384;
  const pipes = { list: [], n: 0 };
  const pipeName = (m, o) => `${m?.type || '?'}${m?.name ? ':' + m.name : ''} @ ${o?.type || '?'}${o?.name ? ':' + o.name : (o?.parent?.name ? ' w ' + o.parent.name : '')}`;
  const pipeHook = setInterval(() => {
    if (window.Core3D?.renderer?.isWebGLRenderer) clearInterval(pipeHook); // tag WebGL: bez dziennika
    const pu = window.Core3D?.renderer?.backend?.pipelineUtils;
    if (!pu || pu.__harnessHook) return;
    clearInterval(pipeHook);
    pu.__harnessHook = true;
    const render = pu.createRenderPipeline;
    const compute = pu.createComputePipeline;
    const push = (e) => { pipes.n++; if (pipes.list.length < PIPE_MAX) pipes.list.push(e); };
    // k = klatka dziennika w toku; poza wywołaniami rAF — następna (poza: true, leży w okresie poprzedniej)
    pu.createRenderPipeline = function (ro, promises) {
      push({ k: frameLog.n, poza: !inTick, sync: !promises, nazwa: pipeName(ro?.material, ro?.object) });
      return render.call(this, ro, promises);
    };
    pu.createComputePipeline = function (p, b) {
      push({ k: frameLog.n, poza: !inTick, sync: true, compute: true, nazwa: `compute${p?.computeProgram?.name ? ':' + p.computeProgram.name : ''}` });
      return compute.call(this, p, b);
    };
    // Budowy NodeBuilder (graf TSL → WGSL, CPU): w klatce (render na zimno) albo poza nią (rozgrzewka w tle).
    const be = window.Core3D.renderer.backend;
    const createNB = be.createNodeBuilder;
    be.createNodeBuilder = function (obj, rr) {
      const b = createNB.call(this, obj, rr);
      const build = b.build;
      b.build = function (...a) {
        const t0 = realNow();
        try { return build.apply(this, a); } finally {
          push({ k: frameLog.n, poza: !inTick, budowa: true, ms: +(realNow() - t0).toFixed(2), nazwa: pipeName(b.material, obj) });
        }
      };
      return b;
    };
  }, 10);
  // Pipeline'y i budowy NodeBuilder w klatkach [beg, end) (i po ostatniej, przed następną): render sync / w tle,
  // compute; budowy w klatkach (render na zimno) i poza nimi (rozgrzewka w tle); nazwy synchronicznych i budów w klatce.
  const pipeStats = (beg, end) => {
    let sync = 0; let async = 0; let compute = 0; let budowy = 0; let budowyMs = 0; let budowyPoza = 0;
    const by = new Map();
    const nb = new Map();
    for (const p of pipes.list) {
      if (p.k < beg || p.k > end || (p.k === end && !p.poza)) continue;
      if (p.budowa) {
        if (p.poza) { budowyPoza++; continue; }
        budowy++;
        budowyMs += p.ms;
        nb.set(p.nazwa, (nb.get(p.nazwa) || 0) + 1);
        continue;
      }
      if (p.compute) compute++;
      else if (p.sync) sync++;
      else async++;
      if (p.sync) by.set(p.nazwa, (by.get(p.nazwa) || 0) + 1);
    }
    const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
    return { sync, async, compute, syncLista: top(by), budowy, budowyMs: +budowyMs.toFixed(1), budowyPoza, budowyLista: top(nb) };
  };

  const waiters = [];
  const tick = () => {
    realRaf(tick);
    clock.frames++;
    if (clock.hold && clock.budget <= 0) { frameLog._przerwa = true; return; }
    if (clock.hold) clock.budget--;
    if (clock.mode === 'step') {
      if (clock.stepsLeft > 0) {
        clock.t += clock.stepMs;
        clock.stepsLeft--;
        clock.steppedFrames++;
      }
      if (clock.stepsLeft <= 0) clock.mode = 'frozen';
    }
    clock.gameFrames++;
    const ts = clock.mode === 'real' ? realNow() : clock.t;
    const cbs = [...pending.values()];
    pending.clear();
    const tFrame0 = realNow();
    inTick = true;
    for (const cb of cbs) {
      try { cb(ts); } catch (err) { setTimeout(() => { throw err; }); }
    }
    inTick = false;
    logFrame(tFrame0, realNow() - tFrame0);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (clock.gameFrames >= w.frame) { waiters.splice(i, 1); w.resolve(clock.gameFrames); }
    }
  };
  realRaf(tick);

  let s = SEED;
  // Licznik wywołań Math.random gry wg miejsca wywołania (zadanie 23, `zrzuty.mjs --losowania`): kto zużywa
  // losowania gry w scenie — wizualia mają losować z fxRandom (warstwa efektów), inaczej przebieg bitwy
  // zależy od obrazu (kadru, zoomu, zajętości pul). Stos tylko przy włączonym liczniku; ciąg liczb bez zmian.
  let randTally = null;
  const tallyCaller = () => {
    const lim = Error.stackTraceLimit;
    Error.stackTraceLimit = 4;
    const st = String(new Error().stack || '').split('\n');
    Error.stackTraceLimit = lim;
    // [0] „Error”, [1] ta funkcja, [2] Math.random (harness), [3] wołający
    const line = st[3] || st[st.length - 1] || '?';
    const m = line.match(/at (?:(\S+) )?\(?(?:https?:\/\/[^/]+)?\/?([^?:)]+)(?:\?[^:)]*)?:(\d+):\d+\)?/);
    const key = m ? `${m[2]}:${m[3]}${m[1] ? ' ' + m[1] : ''}` : line.trim().slice(0, 120);
    randTally.set(key, (randTally.get(key) || 0) + 1);
  };
  Math.random = () => {
    if (randTally) tallyCaller();
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Osobny strumień na UUID three (generateUUID: 4 losowania na każdy Object3D, materiał,
  // teksturę, geometrię i — w WebGPURenderer — węzeł TSL). zrzuty.mjs w trybie
  // „--uuid osobne” podmienia w odpowiedzi serwera generateUUID na ten strumień
  // (osobneLosowanieUuid w wspolne.mjs), więc liczba obiektów three nie przesuwa losowań
  // gry — WebGL i WebGPU generują ten sam świat. Bez reseed: UUID mają być unikalne.
  let su = (SEED ^ 0x9e3779b9) >>> 0;
  window.__harnessUuidRandom = () => {
    su = (su + 0x6D2B79F5) | 0;
    let t = Math.imul(su ^ (su >>> 15), 1 | su);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const css = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';
  const addCss = () => {
    const st = document.createElement('style');
    st.id = 'harness-css';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addCss, { once: true });
  else addCss();

  const halfToFloat = (h) => {
    const s = (h & 0x8000) ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const f = h & 0x3ff;
    if (e === 0) return s * 5.960464477539063e-8 * f;
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  };

  // Pomocniki scen (wołane z zrzuty.mjs po starcie gry — sięgają po window.* w chwili wywołania).
  const scene = {
    // HUD DOM: ukryj wszystko poza kanwami #game-root (3D, 2D i overlay efektów).
    hideHud(on = true) {
      let st = document.getElementById('harness-hud');
      if (!st) {
        st = document.createElement('style');
        st.id = 'harness-hud';
        document.head.appendChild(st);
      }
      // opacity, nie samo visibility: panele kokpitu ustawiają sobie visibility: visible
      // i przebijały się przez ukryty kontener (podzielony ekran).
      st.textContent = on
        ? 'body > *:not(#game-root), #game-root > :not(canvas) { visibility: hidden !important; opacity: 0 !important; }'
        : '';
      return true;
    },
    // Kamera RTS w punkcie świata i stały zoom (rig kamery statku nie działa w RTS).
    // RTS rysuje się z interpolacji prevCameraState → camera (zapis w krokach fizyki), a zmiana
    // trybu zaczyna przejście z czasem — przy stojącym czasie DevScene.syncCamera ustawia oba.
    cam(x, y, zoom) {
      const c = window.camera;
      if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
      c.x = c.targetX = x;
      c.y = c.targetY = y;
      c.manualZoom = true;
      c.zoom = c.targetZoom = zoom;
      window.DevScene?.syncCamera?.();
      return true;
    },
    // Kamera statku (tryb gry) wprost na statku, bez przejścia.
    shipCam(zoom = 1) {
      const c = window.camera;
      c.mode = 'ship';
      c.focusStation = null;
      c.x = c.targetX = window.ship.pos.x;
      c.y = c.targetY = window.ship.pos.y;
      c.manualZoom = true;
      c.zoom = c.targetZoom = zoom;
      window.DevScene?.syncCamera?.();
      return true;
    },
    // Kop kamery przy warpie (zadanie 22-B): stan kamery statku i riga (zoom gracza, mnożnik kopu,
    // offset riga, cofnięcie, wiek impulsów) — sceny zapisują go do wyniki.json (stan.diag).
    kop() {
      const c = window.camera;
      const r = window.CameraRig?.rig;
      const base = Number(c.zoomBase) > 0 && c.zoom === c._zoomSpringOut ? c.zoomBase : c.zoom;
      const f = (v, d = 3) => (Number.isFinite(v) ? +v.toFixed(d) : null);
      return {
        warp: window.warp?.state ?? null,
        zoom: f(c.zoom, 5), zoomGracza: f(base, 5), cel: f(c.targetZoom, 5), mnoznik: f(c.zoom / base, 4),
        offsetRiga: r ? [Math.round(r.offsetX), Math.round(r.offsetY)] : null,
        cofniecie: r ? f(r.warpLagPx, 1) : null,
        wiekSkoku: r ? f(r.warpKickAge) : null,
        wiekWyjscia: r ? f(r.warpExitAge) : null,
        trzymanie: r ? f(r.warpHold, 4) : null,
        drzenie: r ? f(r.warpShakePx, 2) : null
      };
    },
    uploadsIdle() { return !(window.Core3D?._textureUploadQueue?.length); },
    ringReady(key = 'earth') {
      const e = window.__haloRings?.entries?.find((x) => x.key === key);
      return !!(e && e.ring && e.ring.mapsReady);
    },
    // Kadłuby belkowe powstają po wczytaniu sprite'a (asynchronicznie) — przed krokami czekamy na wszystkie.
    hullsReady() {
      const list = [window.ship, window.player2Ship, ...(window.npcs || [])].filter((e) => e && !e.dead && !e.fighter);
      return list.every((e) => !!e.beamHull);
    },
    // Czas CPU Core3D.render (prawdziwym zegarem) i odstęp klatek — n klatek przy stojącym czasie.
    async perf(n = 60) {
      const C = window.Core3D;
      const orig = C.render;
      const cpu = [];
      const fxMs = [];
      // Klatka efektów GPU (Core3D.fxStats, zadanie 12-B): CPU kroku compute / siatki świateł.
      C.render = function (...a) { const t0 = realNow(); const r = orig.apply(this, a); cpu.push(realNow() - t0); if (C.fxStats) fxMs.push(C.fxStats.cpuMs); return r; };
      // Odstęp między kolejnymi klatkami strony (w trybie hold: n zamówionych klatek pod rząd).
      const frameMs = [];
      let last = realNow();
      await new Promise((resolve) => {
        let k = 0;
        const f = () => { const now = realNow(); frameMs.push(now - last); last = now; if (++k >= n) resolve(); else window.requestAnimationFrame(f); };
        window.requestAnimationFrame(f);
        if (clock.hold) clock.budget += n;
      });
      C.render = orig;
      const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
      const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0; };
      const info = window.__rendererInfo || {};
      return {
        coreRenderMs: +med(cpu).toFixed(3), coreRenderP95: +p95(cpu).toFixed(3),
        frameMs: +med(frameMs.slice(1)).toFixed(3),
        gpuMs: Number.isFinite(C.gpuFrameMs) ? +C.gpuFrameMs.toFixed(3) : null,
        drawCalls: info.calls ?? null, triangles: info.triangles ?? null,
        passes: info.passes ? Object.fromEntries(Object.entries(info.passes).map(([k, v]) => [k, v.calls])) : null,
        fx: C.fxStats ? { cpuMs: +med(fxMs).toFixed(4), dispatches: C.fxStats.dispatches, swiatla: C.fxStats.lights, wpisySiatki: C.fxStats.gridItems, zrodla: C.fxStats.distortSources, dist: C.fxStats.distortLayer } : null,
        gpuComputeMs: Number.isFinite(C.gpuComputeMs) ? +C.gpuComputeMs.toFixed(3) : null
      };
    },
    // Izolacja warstw: renderer.render dla kamer passów Core3D (cameraOrtho / cameraPersp) rysuje
    // tylko wybrane warstwy (numery z Core3D: 0 ortho, 1 tło, 2 FG, 3 planety, 5 halo, 6 ring-planety,
    // 7 tarcze). Pass tła dalej czyści cel, więc nie zostaje stara klatka (setPerfToggles z bgPass:
    // false jej nie czyści). null = wszystko. Post (bloom, uber) idzie jak zwykle.
    isolate(layers = null) {
      const C = window.Core3D;
      const r = C?.renderer;
      if (!r) return false;
      if (!r.__harnessRender) r.__harnessRender = r.render;
      if (!layers) { r.render = r.__harnessRender; delete r.__harnessRender; return true; }
      let mask = 0;
      for (const l of layers) mask |= (1 << l);
      const orig = r.__harnessRender;
      r.render = function (sceneArg, cam, ...rest) {
        if ((cam === C.cameraOrtho || cam === C.cameraPersp) && !(cam.layers.mask & mask)) return undefined;
        return orig.call(this, sceneArg, cam, ...rest);
      };
      return true;
    },
    // Tylko obiekty sceny Core3D o podanych nazwach (z przodkami) — reszta siatek ukryta na czas
    // zrzutu; null przywraca. Zadanie 07: sam teren ringu (`HaloTerrain`) w grze, porównanie z bazą
    // z tagu, póki reszta ringu i tło to zamienniki (05, 08–10).
    onlyNamed(names = null) {
      const C = window.Core3D;
      if (!C?.scene) return false;
      if (!names) {
        for (const e of this.__hiddenByName || []) {
          delete e.o.visible;
          e.o.visible = e.v;
        }
        this.__hiddenByName = null;
        return true;
      }
      const want = new Set(names);
      const keep = new Set();
      C.scene.traverse((o) => { if (want.has(o.name)) for (let p = o; p; p = p.parent) keep.add(p); });
      const hidden = [];
      C.scene.traverse((o) => {
        if (keep.has(o) || !(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
        // gra przestawia visible co klatkę (np. zanik dachu K-7) — na czas zrzutu zapis zapamiętany, odczyt false
        const e = { o, v: o.visible };
        Object.defineProperty(o, 'visible', { configurable: true, get: () => false, set: (x) => { e.v = x; } });
        hidden.push(e);
      });
      this.__hiddenByName = hidden;
      return keep.size;
    },
    // Odwrotność onlyNamed: ukrywa obiekty sceny Core3D o podanych nazwach (z potomkami), reszta
    // zostaje; null przywraca. Zadanie 20: warianty „bez wybuchu reaktora” (`__3d`, `__fg-3d`) —
    // wybuch był na kanwie overlaya, od zadania 20 jest w scenie Core3D.
    hideNamed(names = null) {
      const C = window.Core3D;
      if (!C?.scene) return false;
      if (!names) {
        for (const e of this.__hiddenNamed || []) {
          delete e.o.visible;
          e.o.visible = e.v;
        }
        this.__hiddenNamed = null;
        return true;
      }
      const want = new Set(names);
      const hidden = [];
      C.scene.traverse((o) => {
        if (!want.has(o.name)) return;
        const e = { o, v: o.visible };
        Object.defineProperty(o, 'visible', { configurable: true, get: () => false, set: (x) => { e.v = x; } });
        hidden.push(e);
      });
      this.__hiddenNamed = hidden;
      return hidden.length;
    },
    // Spis widocznych obiektów sceny Core3D: warstwa → „typ materiału:nazwa” → obiekty / instancje.
    // Na WebGL mówi, które materiały składają scenę; na WebGPU liczy zamienniki: każdy ShaderMaterial /
    // RawShaderMaterial rysuje się tam zamiennikiem (src/3d/tsl/zamiennik.js — także zanim pierwszy raz
    // wszedł w kadr), a zbudowany oryginał dostaje isPlaceholder.
    census() {
      const C = window.Core3D;
      const LAYER = { 0: 'ortho', 1: 'tlo', 2: 'fg', 3: 'planety', 5: 'halo', 6: 'ring-planety', 7: 'tarcze', 8: 'gwiazdy-warp', 9: 'menu' };
      const webgpu = !!C?.renderer?.isWebGPURenderer;
      const isPlaceholder = (m) => !!m.isPlaceholder || (webgpu && (m.isShaderMaterial === true || m.isRawShaderMaterial === true));
      const out = {};
      let placeholders = 0;
      const visit = (o, parentVisible) => {
        const vis = parentVisible && o.visible !== false;
        if (!vis) return;
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null;
        if (mats && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) {
          let bit = 0;
          while (bit < 32 && !((o.layers.mask >>> bit) & 1)) bit++;
          const layer = LAYER[bit] ?? `w${bit}`;
          for (const m of mats) {
            if (!m) continue;
            const sig = m.name || (m.uniforms ? Object.keys(m.uniforms).slice(0, 3).join('+') : '') || '?';
            const ph = isPlaceholder(m);
            const key = `${ph ? 'ZAMIENNIK ' : ''}${m.type}:${sig}`;
            const bucket = out[layer] || (out[layer] = {});
            const e = bucket[key] || (bucket[key] = { obiekty: 0, instancje: 0 });
            e.obiekty++;
            e.instancje += o.isInstancedMesh ? (o.count | 0) : 1;
            if (ph) placeholders++;
          }
        }
        for (const ch of o.children) visit(ch, vis);
      };
      if (C?.scene) visit(C.scene, true);
      return { zamienniki: placeholders, warstwy: out };
    },
    // Histogram HDR bufora sceny (przed bloomem i ACES): luminancja co `step`-ty piksel.
    async hdr(step = 3) {
      const C = window.Core3D;
      const r = C.renderer;
      const rt = C.composerTarget;
      if (!r || !rt) return null;
      const w = rt.width; const h = rt.height;
      const half = rt.texture.type === 1016;
      let data; let rowElems = w * 4;
      try {
        if (typeof r.readRenderTargetPixelsAsync === 'function' && r.isWebGPURenderer) {
          data = await r.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
          rowElems = Math.ceil((w * 4 * data.BYTES_PER_ELEMENT) / 256) * 256 / data.BYTES_PER_ELEMENT;
        } else {
          data = half ? new Uint16Array(w * h * 4) : new Float32Array(w * h * 4);
          r.readRenderTargetPixels(rt, 0, 0, w, h, data);
        }
      } catch (err) {
        return { error: String(err?.message || err) };
      }
      const isHalf = data instanceof Uint16Array;
      const lum = [];
      let nan = 0; let over = 0; let max = 0;
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = y * rowElems + x * 4;
          const R = isHalf ? halfToFloat(data[i]) : data[i];
          const G = isHalf ? halfToFloat(data[i + 1]) : data[i + 1];
          const B = isHalf ? halfToFloat(data[i + 2]) : data[i + 2];
          if (!Number.isFinite(R) || !Number.isFinite(G) || !Number.isFinite(B)) { nan++; continue; }
          const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          lum.push(l);
          if (l > 0.9) over++;
          if (l > max) max = l;
        }
      }
      lum.sort((a, b) => a - b);
      const pct = (p) => +(lum[Math.min(lum.length - 1, Math.floor(lum.length * p))] || 0).toFixed(4);
      return { pixels: lum.length, nanOrInf: nan, overFraction: +(over / Math.max(1, lum.length)).toFixed(5), p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), p999: pct(0.999), max: +max.toFixed(3) };
    }
  };

  // Przestoje w klatkach dziennika [from, to) (numery z frameLog.n): klatka dłuższa niż `thr` ms (okres albo
  // CPU). Wynik: liczba klatek, przestojów, najdłuższy okres i CPU, suma nadwyżek ponad 1/60 s w przestojach,
  // do 8 najdłuższych ({ k: numer w oknie, ms, cpu, gra: __frameId }).
  const frameStats = (from = 0, to = null, thr = 50) => {
    const end = Math.min(to ?? frameLog.n, frameLog.n);
    const beg = Math.max(0, from, end - LOG);
    const list = [];
    let maxMs = 0; let maxCpu = 0; let over = 0;
    for (let k = beg; k < end; k++) {
      const i = k % LOG;
      const j = (k + 1) % LOG;
      const cpu = frameLog.cpu[i];
      const ms = (k + 1 < end && frameLog.seria[j] === frameLog.seria[i]) ? frameLog.start[j] - frameLog.start[i] : cpu;
      if (ms > maxMs) maxMs = ms;
      if (cpu > maxCpu) maxCpu = cpu;
      if (ms > thr) { list.push({ k: k - beg, ms: +ms.toFixed(1), cpu: +cpu.toFixed(1), gra: frameLog.game[i] }); over += ms - 1000 / 60; }
    }
    list.sort((a, b) => b.ms - a.ms);
    const top = list.slice(0, 8);
    // synchroniczne pipeline'y z okresu klatki przestoju (zwykle jego przyczyna): w jej wywołaniach rAF
    // albo po nich, przed następną klatką
    for (const e of top) {
      const i = beg + e.k;
      const inPeriod = pipes.list.filter((p) => (p.poza ? p.k === i + 1 : p.k === i));
      const names = inPeriod.filter((p) => p.sync).map((p) => p.nazwa);
      if (names.length) e.pipeline = names.length > 6 ? [...names.slice(0, 6), `… +${names.length - 6}`] : names;
      // w tle (compileAsync: budowa NodeBuilder synchronicznie na CPU, pipeline w tle GPU)
      const nAsync = inPeriod.filter((p) => !p.sync && !p.budowa).length;
      if (nAsync) e.pipelineWTle = nAsync;
      // budowy NodeBuilder w tym okresie (CPU): liczba i czas
      const builds = inPeriod.filter((p) => p.budowa);
      if (builds.length) e.budowy = `${builds.length} (${builds.reduce((s, p) => s + p.ms, 0).toFixed(0)} ms)`;
    }
    return { klatki: end - beg, przestoje: list.length, maksMs: +maxMs.toFixed(1), maksCpu: +maxCpu.toFixed(1), sumaMs: +over.toFixed(0), lista: top, pipeline: pipeStats(beg, end) };
  };

  window.__harness = {
    clock,
    realNow,
    frameLog,
    marks,
    frameStats,
    pipes,
    scene,
    // n klatek po stepMs; Promise kończy się, gdy czas znów stoi
    step(n = 1, stepMs = 1000 / 60) {
      clock.stepMs = stepMs;
      clock.stepsLeft = Math.max(0, n | 0);
      clock.mode = clock.stepsLeft > 0 ? 'step' : 'frozen';
      if (clock.hold) clock.budget += clock.stepsLeft;
      return new Promise((resolve) => {
        const poll = () => (clock.mode === 'step' ? realRaf(poll) : resolve(clock.steppedFrames));
        realRaf(poll);
      });
    },
    // Wstrzymanie: strona dostaje klatki tylko przez step()/frames().
    hold(on = true) { clock.hold = !!on; clock.budget = 0; return clock.hold; },
    freeze() { clock.mode = 'frozen'; clock.stepsLeft = 0; },
    // Nowe ziarno tuż przed krokami symulacji: asynchroniczne rzeczy przed nimi (kolejność
    // wczytania sprite'ów i budowy kadłubów) zużywają losowania w różnej kolejności.
    // Generator efektów (`window.fxRandom`, src/3d/fx/fxRandom.js — efekty nie zużywają Math.random gry) dostaje
    // to samo ziarno (przesunięte stałą), gdy już istnieje — powtarzalne efekty w scenach.
    reseed(v = SEED) {
      s = v >>> 0;
      try { if (window.fxRandom && typeof window.fxRandom.seed === 'function') window.fxRandom.seed((v ^ 0x5eed5eed) >>> 0); } catch { /* bez efektów */ }
      return true;
    },
    // Licznik wywołań Math.random gry (zadanie 23): start() zeruje i włącza, stop() → { „plik:linia funkcja”: liczba }.
    losowania: {
      start() { randTally = new Map(); return true; },
      stop() {
        if (!randTally) return null;
        const out = Object.fromEntries([...randTally].sort((a, b) => b[1] - a[1]));
        randTally = null;
        return out;
      }
    },
    // czeka n prawdziwych klatek (czas wirtualny bez zmian w trybie 'frozen')
    frames(n = 1) {
      const k = Math.max(1, n | 0);
      if (clock.hold) clock.budget += k;
      return new Promise((resolve) => waiters.push({ frame: clock.gameFrames + k, resolve }));
    },
    seed: SEED
  };
})();
