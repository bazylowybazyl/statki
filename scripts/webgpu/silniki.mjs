// Porównanie SAMYCH dysz (zadanie 13): te same sceny co zrzuty.mjs, ale w passach Core3D
// widać tylko siatki silników (MAIN — struga, WARP — plazma, SIDE — płomień i poświaty),
// a zrzut to bufor sceny HDR (composerTarget, PRZED postem) tonowany ACES gry + sRGB na kanwie
// strony. Porównanie nie zależy od bloomu, gorącego powietrza, zamienników innych warstw ani
// od składania z kanwą 2D — porównuje same materiały silników. Na tagu (WebGL) bloom,
// gorące powietrze i shafty wyłączone (setPerfToggles), żeby przebieg szedł tą samą drogą.
//
//   node scripts/webgpu/silniki.mjs [--out katalog] [--port 5345] [--baza katalog] [--sceny a,b] [--uuid osobne]
//   node scripts/webgpu/silniki.mjs --skok [gracz,flota] [--out katalog]   (pierwszy skok: klatki i budowy programów)
//
// Baza: ten sam skrypt w worktree z tagu webgl-baseline (skopiuj scripts/webgpu/ z main):
//   node scripts/webgpu/silniki.mjs --out <…>/.tmp/webgpu/zadania/13/silniki-webgl --port 5346
// Wynik: <out>/<scena>.png (HDR tonowany), <out>/<scena>__strona.png (zrzut strony),
// <out>/wyniki.json (statystyki HDR: energia RGB, alfa, piksele ponad progiem 0,9, maks.,
// NaN, błędy konsoli, renderer). Z --baza: porównanie PNG (porownaj.mjs) → <out>/porownanie/.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';
import { compareDirs } from './porownaj.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const port = Number(args.port || 5345);
const outDir = resolve(repo, args.out || '.tmp/webgpu/silniki');
const seed = Number(args.seed || 0x5eed1234);
const onlyScenes = args.sceny ? new Set(args.sceny.split(',')) : null;
const uuidMode = args.uuid || 'osobne';
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

// Pomocniki strony: izolacja siatek silników i odczyt bufora sceny.
const SILNIKI_STRONA = `(() => {
  const isEngine = (o) => {
    for (let p = o; p; p = p.parent) if (p.name === 'MainExhaustJets' || p.name === 'WarpPlumeFX') return true;
    const a = o.geometry && o.geometry.attributes;
    return !!(a && (a.aFlame || (a.aOpacity && a.aSize)));
  };
  const aces = (x) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
  const srgb = (x) => (x <= 0.0031308 ? x * 12.92 : Math.pow(Math.max(x, 0), 0.41666) * 1.055 - 0.055);
  const halfToFloat = (h) => {
    const s = (h & 0x8000) ? -1 : 1; const e = (h >> 10) & 0x1f; const f = h & 0x3ff;
    if (e === 0) return s * 5.960464477539063e-8 * f;
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  };
  window.__silniki = {
    // Tylko siatki silników w passach Core3D (reszta niewidoczna na czas render()).
    isolate(on = true) {
      const C = window.Core3D; const r = C && C.renderer;
      if (!r) return false;
      if (!r.__silnikiRender) r.__silnikiRender = r.render;
      const orig = r.__silnikiRender;
      if (!on) { r.render = orig; delete r.__silnikiRender; return true; }
      r.render = function (sceneArg, cam, ...rest) {
        if (sceneArg !== C.scene) return orig.call(this, sceneArg, cam, ...rest);
        const hidden = [];
        sceneArg.traverse((o) => {
          if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible && !isEngine(o)) { o.visible = false; hidden.push(o); }
        });
        try { return orig.call(this, sceneArg, cam, ...rest); } finally { for (const o of hidden) o.visible = true; }
      };
      try { C.setPerfToggles && C.setPerfToggles({ bloom: false, heatHaze: false, shadowShafts: false }); } catch (e) { /* */ }
      return true;
    },
    // Bufor sceny (HDR) → ACES gry + sRGB (jak post bez bloomu), PNG; statystyki.
    async capture() {
      const C = window.Core3D; const r = C.renderer; const rt = C.composerTarget;
      const w = rt.width; const h = rt.height;
      let data; let rowElems = w * 4; let topDown = false;
      if (typeof r.readRenderTargetPixelsAsync === 'function' && r.isWebGPURenderer) {
        data = await r.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
        rowElems = Math.ceil((w * 4 * data.BYTES_PER_ELEMENT) / 256) * 256 / data.BYTES_PER_ELEMENT;
        topDown = true;
      } else {
        data = rt.texture.type === 1016 ? new Uint16Array(w * h * 4) : new Float32Array(w * h * 4);
        r.readRenderTargetPixels(rt, 0, 0, w, h, data);
      }
      const isHalf = data instanceof Uint16Array;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d'); const img = ctx.createImageData(w, h);
      const st = { w, h, sumR: 0, sumG: 0, sumB: 0, sumA: 0, over09: 0, max: 0, nan: 0, lit: 0, negative: 0 };
      for (let y = 0; y < h; y++) {
        const srcRow = topDown ? y : (h - 1 - y);
        for (let x = 0; x < w; x++) {
          const i = srcRow * rowElems + x * 4;
          let R = isHalf ? halfToFloat(data[i]) : data[i];
          let G = isHalf ? halfToFloat(data[i + 1]) : data[i + 1];
          let B = isHalf ? halfToFloat(data[i + 2]) : data[i + 2];
          const A = isHalf ? halfToFloat(data[i + 3]) : data[i + 3];
          if (!Number.isFinite(R) || !Number.isFinite(G) || !Number.isFinite(B)) { st.nan++; R = G = B = 0; }
          if (R < 0 || G < 0 || B < 0) st.negative++;
          st.sumR += R; st.sumG += G; st.sumB += B; st.sumA += Number.isFinite(A) ? A : 0;
          const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          if (l > 0.9) st.over09++;
          if (l > 0.002) st.lit++;
          if (l > st.max) st.max = l;
          const o = (y * w + x) * 4;
          img.data[o] = Math.round(255 * srgb(aces(R)));
          img.data[o + 1] = Math.round(255 * srgb(aces(G)));
          img.data[o + 2] = Math.round(255 * srgb(aces(B)));
          img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      for (const k of ['sumR', 'sumG', 'sumB', 'sumA', 'max']) st[k] = +st[k].toFixed(4);
      return { png: cv.toDataURL('image/png').split(',')[1], stats: st };
    }
  };
})();`;

const SCENES = {
  'silniki-bitwa': {
    opis: 'Bitwa jak w zrzuty.mjs (3 piratów vs 2 Terra Nova, 180 klatek), zoom 0,3: struga MAIN i płomień SIDE floty',
    js: `DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
         const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
         spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, -900), spawnAngle: Math.PI });
         spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, 900), spawnAngle: Math.PI });
         spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(4000, 0), spawnAngle: Math.PI });
         spawnCallInShip('destroyer', { mode: 'friendly', spawnPos: at(600, -1200), spawnAngle: 0 });
         spawnCallInShip('battleship', { mode: 'friendly', spawnPos: at(-300, 1100), spawnAngle: 0 });
         S.cam(s.pos.x + 1800, s.pos.y, 0.3);
         for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
         H.reseed(0xb17a);
         await H.step(180);
         S.cam(s.pos.x + 1800, s.pos.y, 0.3);`
  },
  'silniki-bitwa-blisko': {
    opis: 'Największy pirat z bliska (zoom 1): dysze MAIN i SIDE jednego okrętu',
    js: `const e = npcs.filter((n) => !n.dead && !n.friendly).sort((a, b) => (b.radius || 0) - (a.radius || 0))[0];
         if (e) S.cam(e.x, e.y, 1.0);`
  },
  'silniki-gracz': {
    opis: 'Statek gracza z bliska (zoom 0,9): wszystkie dysze MAIN na pełnym ciągu z dopalaczem, dysze SIDE odpalone',
    js: `const v = ship.visual || {};
         for (const t of (v.mainThrusters || [])) t.__throttle = 1;
         for (const t of (v.torqueThrusters || [])) t.__throttle = 1;
         ship.__editorBoost = true;
         H.reseed(0x51a1);
         await H.step(40);
         S.cam(ship.pos.x, ship.pos.y, 0.9);`
  },
  'silniki-gracz-spoczynek': {
    opis: 'Ten sam statek bez wymuszeń po 60 klatkach: dysze MAIN na jałowym, SIDE w spoczynku (pilot pod progiem bloomu)',
    js: `const v = ship.visual || {};
         for (const t of (v.mainThrusters || [])) delete t.__throttle;
         for (const t of (v.torqueThrusters || [])) delete t.__throttle;
         ship.__editorBoost = false;
         H.reseed(0x51a2);
         await H.step(60);
         S.cam(ship.pos.x, ship.pos.y, 0.9);`
  },
  'silniki-warp': {
    opis: 'Ładowanie skoku (75 klatek): plazma WARP z dysz MAIN, zoom 0,6',
    js: `H.reseed(0x3a2d); DevFlags.unlimitedWarp = true; warp.state = 'charging'; warp.charge = 0; await H.step(75); S.cam(ship.pos.x, ship.pos.y, 0.6);`
  },
  'silniki-warp-blisko': {
    opis: 'Plazma WARP z bliska (zoom 1,6) — raymarch, poświaty, cząstki',
    js: `H.reseed(0x3a2e); await H.step(20); S.cam(ship.pos.x - 420, ship.pos.y, 1.6);`
  }
};

// Tryb --skok: w czasie rzeczywistym (bez hold) czasy klatek (odstęp wywołań Core3D.render
// i ich CPU) oraz budowy programów w backendzie (NodeBuilder, moduły WGSL, pipeline'y) —
// przed skokiem i po nim. Warianty: 'gracz' — pierwszy skok gracza (ładowanie + wejście),
// 'flota' — 8 okrętów pirackich naraz w trybie skoku (__warpPreview): pula plazmy rośnie
// do WARP_PLUME_CAP instancji. Instancje mają wspólny graf, więc po rozgrzewce na ekranie
// ładowania nie powinno być ani jednej budowy materiałów plazmy.
const SKOK_STRONA = `(() => {
  window.__skok = {
    events: [], frames: [],
    hook() {
      const C = window.Core3D; const r = C.renderer; const be = r.backend; const now = window.__harness.realNow;
      const evs = this.events;
      const nameOf = (m, o) => (m && (m.name || m.type)) || (o && o.material && (o.material.name || o.material.type)) || '?';
      // Rozbicie CPU klatki na etapy renderera (WebGPU): ms na klatkę w każdym etapie.
      const acc = this.acc = {};
      const wrap = (obj, fn, label) => {
        if (!obj || typeof obj[fn] !== 'function' || obj['__skok_' + fn]) return;
        const orig = obj[fn].bind(obj);
        obj[fn] = (...a) => { const t0 = now(); try { return orig(...a); } finally { acc[label] = (acc[label] || 0) + (now() - t0); } };
        obj['__skok_' + fn] = true;
      };
      if (!be) {
        // WebGL (tag): tylko liczba programów
        this.programsAtHook = r.info.programs ? r.info.programs.length : 0;
        const fr = this.frames; const origRender = C.render; let last = now();
        C.render = function (...a) { const t0 = now(); const res = origRender.apply(this, a); fr.push({ t: t0, odstep: +(t0 - last).toFixed(2), cpu: +(now() - t0).toFixed(2), programy: r.info.programs ? r.info.programs.length : 0 }); last = t0; return res; };
        return true;
      }
      wrap(r._objects, 'get', 'renderObjects');
      wrap(r._nodes, 'getForRender', 'nodes.getForRender');
      wrap(r._nodes, 'updateForRender', 'nodes.update');
      wrap(r._bindings, 'getForRender', 'bindings.get');
      wrap(r._bindings, 'updateForRender', 'bindings.update');
      wrap(r._geometries, 'updateForRender', 'geometries');
      // wolne pojedyncze wywołania (> 2 ms): co to za obiekt
      const slow = this.slow = [];
      for (const [obj, fn, label] of [[r._geometries, 'updateForRender', 'geometria'], [r._bindings, 'updateForRender', 'wiązania']]) {
        const inner = obj[fn];
        obj[fn] = (ro, ...a) => { const t0 = now(); try { return inner(ro, ...a); } finally { const ms = now() - t0; if (ms > 2) slow.push({ co: label, ms: +ms.toFixed(2), obiekt: (ro.object && (ro.object.name || ro.object.type)) || '?', materiał: nameOf(ro.material, ro.object), t: now() }); } };
      }
      wrap(r._pipelines, 'getForRender', 'pipelines');
      wrap(be, 'draw', 'backend.draw');
      if (!be.__skokNB) {
        const orig = be.createNodeBuilder.bind(be);
        be.createNodeBuilder = (obj, rr) => {
          const b = orig(obj, rr); const ob = b.build.bind(b);
          b.build = (...a) => { const t0 = now(); try { return ob(...a); } finally { evs.push({ co: 'NodeBuilder', nazwa: nameOf(b.material, obj), ms: +(now() - t0).toFixed(2), t: now() }); } };
          return b;
        };
        be.__skokNB = true;
      }
      if (!be.__skokRP) {
        const orig = be.createRenderPipeline.bind(be);
        be.createRenderPipeline = (ro, promises) => { const t0 = now(); try { return orig(ro, promises); } finally { evs.push({ co: promises ? 'pipeline (async)' : 'pipeline', nazwa: nameOf(ro.material, ro.object), ms: +(now() - t0).toFixed(2), t: now() }); } };
        be.__skokRP = true;
      }
      if (!be.__skokPR) {
        const orig = be.createProgram.bind(be);
        be.createProgram = (prog) => { const t0 = now(); try { return orig(prog); } finally { evs.push({ co: 'program ' + prog.stage, nazwa: prog.name || '?', ms: +(now() - t0).toFixed(2), t: now() }); } };
        be.__skokPR = true;
      }
      const fr = this.frames; const origRender = C.render; let last = now();
      C.render = function (...a) {
        for (const k in acc) acc[k] = 0;
        const t0 = now(); const res = origRender.apply(this, a);
        const etapy = {}; for (const k in acc) if (acc[k] > 0.05) etapy[k] = +acc[k].toFixed(2);
        fr.push({ t: t0, odstep: +(t0 - last).toFixed(2), cpu: +(now() - t0).toFixed(2), etapy }); last = t0; return res;
      };
      return true;
    },
    mark(label) { this.events.push({ co: 'znacznik', nazwa: label, t: window.__harness.realNow() }); return window.__harness.realNow(); }
  };
})();`;

const IGNORE = [/favicon\.ico/, /AudioSys/, /Unable to decode audio data/, /powerPreference option is currently ignored/, /\[vite\]/, /DevTools/, /GPU stall due to ReadPixels/];

async function startGame(ev, cdp, base, extra) {
  const uuidStat = uuidMode === 'osobne' ? await osobneLosowanieUuid(cdp) : null;
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${seed};\n${INJECT}\n${extra}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  if (uuidStat && uuidStat.podmienione < 1) throw new Error('--uuid osobne: nie podmieniono generateUUID');
  const kind = await ev('(() => { const r = window.Core3D.renderer; return r?.isWebGPURenderer ? (r.backend?.isWebGPUBackend ? "webgpu" : "webgpu-webgl2") : "webgl"; })()');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('nie wczytano sprite’ów');
  return kind;
}

const quantile = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

async function runSkok(wariant) {
  const { server, base } = await startVite(port);
  mkdirSync(outDir, { recursive: true });
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 180000) => evaluate(cdp, e, t);
  let res = null;
  try {
    const kind = await startGame(ev, cdp, base, SKOK_STRONA);
    // czas rzeczywisty; kamera RTS nad statkiem (flota: szeroki kadr na 8 okrętów)
    await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; S.hideHud(true);
      ${wariant === 'flota' ? `DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
      const s = ship; const put = (k, x, y) => spawnCallInShip(k, { mode: 'pirate', spawnPos: { x: s.pos.x + x, y: s.pos.y + y }, spawnAngle: Math.PI });
      for (let i = 0; i < 5; i++) put('destroyer', 2500 + (i % 2) * 900, -2800 + i * 1400);
      for (let i = 0; i < 3; i++) put('pirate_battleship', 4200, -2200 + i * 2200);
      S.cam(s.pos.x + 2000, s.pos.y, 0.14);
      for (let i = 0; i < 400 && !S.hullsReady(); i++) await H.frames(2);` : 'S.cam(ship.pos.x, ship.pos.y, 0.6);'}
      H.clock.mode = 'real'; return true; })()`, 300000);
    await sleep(4000);
    await ev('window.__skok.hook()');
    await sleep(2500);
    const tMark = await ev(wariant === 'flota'
      ? `(() => { const t = window.__skok.mark('flota w trybie skoku'); for (const n of window.npcs) if (!n.dead) n.__warpPreview = true; ship.__warpPreview = true; return t; })()`
      : `(() => { const t = window.__skok.mark('pierwszy skok gracza'); DevFlags.unlimitedWarp = true; warp.state = 'charging'; warp.charge = 0; return t; })()`);
    await sleep(4000);
    const data = await ev(`(async () => { const m = await import('/src/3d/warpPlume3D.js'); const r = window.Core3D.renderer; return { slow: window.__skok.slow || [], events: window.__skok.events, frames: window.__skok.frames, plazma: m.WarpPlume3D.activeCount, programy: r.backend ? null : { przy: window.__skok.programsAtHook, teraz: r.info.programs ? r.info.programs.length : 0 } }; })()`);
    const przed = data.frames.filter((f) => f.t < tMark);
    const po = data.frames.filter((f) => f.t >= tMark && f.t < tMark + 1500);
    const stat = (fs) => ({ klatki: fs.length, odstepMediana: +quantile(fs.map((f) => f.odstep), 0.5).toFixed(2),
      odstepP99: +quantile(fs.map((f) => f.odstep), 0.99).toFixed(2), odstepMaks: +Math.max(0, ...fs.map((f) => f.odstep)).toFixed(2),
      cpuMediana: +quantile(fs.map((f) => f.cpu), 0.5).toFixed(2), cpuMaks: +Math.max(0, ...fs.map((f) => f.cpu)).toFixed(2) });
    const budowy = data.events.filter((e) => e.co !== 'znacznik' && e.t >= tMark);
    // najwolniejsze klatki po znaczniku (z rozbiciem na etapy renderera)
    const najwolniejsze = [...po].sort((a, b) => b.cpu - a.cpu).slice(0, 3).map((f) => ({ ms: f.cpu, odstep: f.odstep, poZnaczniku: +(f.t - tMark).toFixed(0), etapy: f.etapy, programy: f.programy }));
    const errors = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l)));
    res = { wariant, renderer: kind, instancjePlazmy: data.plazma, przedSkokiem: stat(przed), poSkoku1500ms: stat(po), najwolniejsze, programyWebGL: data.programy ?? null, budowyPoSkoku: budowy, budowyPrzed: data.events.filter((e) => e.t < tMark).length, bledy: errors.slice(0, 20) };
    console.log(`  skok (${wariant}, ${kind}, instancje plazmy ${data.plazma}): przed ${JSON.stringify(res.przedSkokiem)}`);
    console.log(`  po znaczniku (1,5 s): ${JSON.stringify(res.poSkoku1500ms)}`);
    console.log(`  budowy po znaczniku: ${budowy.length ? budowy.map((e) => `${e.co} ${e.nazwa} ${e.ms} ms`).join(' ; ') : 'żadnych'}${res.programyWebGL ? ` | programy WebGL ${JSON.stringify(res.programyWebGL)}` : ''}`);
    console.log(`  najwolniejsze klatki: ${JSON.stringify(najwolniejsze)}`);
    const wolne = (data.slow || []).map((e) => ({ ...e, t: +(e.t - tMark).toFixed(0) }));
    res.wolneWywolania = wolne;
    if (wolne.length) console.log(`  wolne wywołania (> 2 ms): ${JSON.stringify(wolne.slice(0, 12))}`);
    if (errors.length) console.log(`  BŁĘDY: ${errors.slice(0, 3).join(' ; ')}`);
    writeJson(join(outDir, `skok-${wariant}.json`), res);
  } finally {
    await chrome.close();
    await server.close();
  }
  return res;
}

async function run() {
  const { server, base } = await startVite(port);
  mkdirSync(outDir, { recursive: true });
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 180000) => evaluate(cdp, e, t);
  const rows = [];
  let rendererKind = '?';
  let startErrors = [];
  try {
    rendererKind = await startGame(ev, cdp, base, SILNIKI_STRONA);
    await ev('window.__harness.hold(true)');
    // Błędy od startu gry (pierwsze budowy pipeline'ów dysz — Dawn potem ucisza powtórki).
    startErrors = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l)));
    console.log(`  start gry: ${startErrors.length ? 'BŁĘDY ' + startErrors.slice(0, 3).join(' ; ') : 'bez błędów'}`);
    for (const [id, sc] of Object.entries(SCENES)) {
      logs.clear();
      let error = null;
      try {
        const sceneSeed = [...id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
        await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(${sceneSeed}); S.hideHud(true);\n${sc.js}\n return true; })()`, 300000);
        await ev('window.__harness.frames(20)');
        await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
      } catch (err) {
        error = String(err?.message || err).slice(0, 500);
      }
      // sceny spoza --sceny idą (stan świata jak w pełnym przebiegu), bez zrzutu
      if (onlyScenes && !onlyScenes.has(id)) { console.log(`  ${id.padEnd(24)} (bez zrzutu)`); continue; }
      await ev('window.__silniki.isolate(true)');
      await ev('window.__harness.frames(3)');
      const cap = await ev('window.__silniki.capture()', 120000);
      writeFileSync(join(outDir, `${id}.png`), Buffer.from(cap.png, 'base64'));
      await screenshotPng(cdp, join(outDir, `${id}__strona.png`));
      await ev('window.__silniki.isolate(false)');
      await ev('window.__harness.frames(3)');
      const errors = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l)));
      rows.push({ scena: id, opis: sc.opis, renderer: rendererKind, blad: error, hdr: cap.stats, bledy: errors.slice(0, 20) });
      const s = cap.stats;
      console.log(`  ${id.padEnd(24)} ${error || errors.length ? 'BŁĄD' : 'ok  '} ${rendererKind} | RGB ${s.sumR.toFixed(0)}/${s.sumG.toFixed(0)}/${s.sumB.toFixed(0)} A ${s.sumA.toFixed(0)} | >0,9 ${s.over09} | maks ${s.max.toFixed(2)} | NaN ${s.nan} | ujemne ${s.negative}${error ? ' | ' + error : ''}${errors.length ? ' | ' + errors.slice(0, 2).join(' ; ') : ''}`);
    }
  } finally {
    await chrome.close();
    await server.close();
  }
  writeJson(join(outDir, 'wyniki.json'), { when: new Date().toISOString(), renderer: rendererKind, rozmiar: `${W}x${H}`, seed, losowanieUuid: uuidMode, bledyStartu: startErrors.slice(0, 40), sceny: rows });
  if (args.baza) {
    const bazaDir = resolve(repo, args.baza);
    if (existsSync(bazaDir)) {
      const rep = compareDirs(bazaDir, outDir, join(outDir, 'porownanie'));
      console.log(`porównanie z bazą: ${rep.md}`);
    }
  }
  console.log('gotowe:', outDir);
}

if (args.skok) {
  for (const w of (args.skok === '1' ? 'gracz,flota' : args.skok).split(',')) await runSkok(w);
} else {
  await run();
}
process.exit(0);
