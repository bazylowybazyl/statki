// src/render/render.worker.js — worker renderu (docs/PLAN-render-worker.md § 3.1, RW-40a).
//
// Core3D na OffscreenCanvas spoza DOM, lustra encji z migawki klatki (SharedArrayBuffer, potrójny bufor) i moduły
// renderu, które w trybie `inline` już działają na lustrach: kadłuby, dysze, lampy, cień SDF, smugi
// (updateHexShips3D), modele 3D (bez wież), tarcze, stacje. Klatka 3D wraca do strony jako ImageBitmap
// (kompozycja B2cr — src/render/overlayRing.js po stronie strony). Reszta modułów w trybie `worker` jest wyłączona
// (lista: RW_WORKER_DISABLED — strona wypisuje ją raz w konsoli).
//
// Wiadomości strony: `init` (wymiary, DPR, bufor RET), `layout` (zestaw stron migawki: bufor + układ), `frame`
// (po publikacji strony k: nowe opisy encji, topologie, rdzenie, stacje, słownik, zasoby — ImageBitmap), `stop`.
// Worker → strona: `ready`, `frame` { k, bmp }, `error`.

export const RW_WORKER_DISABLED = Object.freeze([
  'planety i słońce', 'ring „Halo” i hale K-7', 'świat 3D (stacja piracka)', 'baza piratów i ciała świata',
  'pas asteroid i wydobycie', 'komety', 'warp „Nurt”', 'pył kosmiczny', 'pył hal K-7', 'rozpad stacji (Destruction3D)',
  'mostki 3D i okna', 'drony naprawcze', 'rdzenie reaktorów', 'wieże 3D', 'zimne wraki',
  'efekty broni, rakiet, ran, wybuchów (strumień rozkazów)', 'tło menu', 'podzielony ekran'
]);

const isWorker = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope;

if (isWorker) {
  const st = {
    Core3D: null, mods: null, rm: null, cloak: null, players: null, reader: null, ret: null,
    canvas: null, W: 0, H: 0, dpr: 1, lastMsgK: -1, pendingK: -1,
    descriptors: [], topologies: [], coreDescs: new Map(), stationDescs: [], resources: [],
    dict: { values: [], value(c) { return c >= 0 ? this.values[c] : undefined; } },
    cam: { x: 0, y: 0, zoom: 1 }, cull: { x: 0, y: 0, halfW: 0, halfH: 0, drawHalfW: 0, drawHalfH: 0 },
    sun: { x: 0, y: 0, r: 0 }, frames: 0, errors: 0
  };
  const report = (e, where) => {
    st.errors++;
    if (st.errors <= 20) postMessage({ type: 'error', where, msg: String(e?.stack || e?.message || e).slice(0, 2000) });
  };
  self.addEventListener('error', (e) => report(e.error || e.message, 'onerror'));
  self.addEventListener('unhandledrejection', (e) => report(e.reason, 'promise'));

  async function init(m) {
    // podkładki (RW-02 § 8; moduły czytają config przy imporcie — RenderWorld przed modułami renderu)
    globalThis.window = globalThis;
    globalThis.innerWidth = m.W;
    globalThis.innerHeight = m.H;
    globalThis.devicePixelRatio = m.dpr || 1;
    if (typeof globalThis.requestIdleCallback !== 'function') {
      globalThis.requestIdleCallback = (fn, opt) => setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 8 }), Math.min(50, opt?.timeout ?? 1));
      globalThis.cancelIdleCallback = (id) => clearTimeout(id);
    }
    st.W = m.W; st.H = m.H; st.dpr = m.dpr || 1;
    globalThis.SUN = st.sun;
    const { RenderWorld, createMirrorPlayersSource } = await import('./renderWorld.js');
    st.players = createMirrorPlayersSource();
    RenderWorld.setSource(st.players);
    const [core, hex, models, shields, stations, mirror, layoutMod, tb, ret, cloak, bridges] = await Promise.all([
      import('../3d/core3d.js'), import('../3d/hexShips3D.js'), import('../3d/ships3d/shipModels3DGame.js'),
      import('../3d/shield3D.js'), import('../3d/stations3D.js'), import('./renderMirror.js'), import('./snapshotLayout.js'),
      import('./tripleBuffer.js'), import('./returnLayout.js'), import('./blocks/cloakBlock.js'),
      import('../game/shipBridgeBeams.js')
    ]);
    st.mods = { core, hex, models, shields, stations, mirror, layoutMod, tb, retMod: ret, cloak };
    const Core3D = core.Core3D;
    st.Core3D = Core3D;
    if (m.quality) Core3D.configureQuality(m.quality);
    st.ret = ret.createReturnViews(m.retBuffer);
    st.canvas = new OffscreenCanvas(Math.max(1, Math.round(m.W * (m.dpr || 1))), Math.max(1, Math.round(m.H * (m.dpr || 1))));
    hex.initHexShips3D({ canvas: st.canvas });
    Core3D.resize(m.W, m.H);
    const sid = models.shipModel3DIdFor;
    hex.setBeamSkinSuppressor((e) => !!e.beamHull?.world || !!sid(e));
    hex.setEntityHiddenTest((e) => (e.__mirror === true ? e.fogHidden : false));
    st.rm = new mirror.RenderMirror({
      dict: st.dict,
      describe: (s, gen) => { const d = st.descriptors[s]; return d && d.gen === gen ? d.desc : null; },
      topologyOf: (bs, gen, storeVer) => {
        const t = st.topologies[bs];
        return t && t.gen === gen && t.storeVer === storeVer ? t.topo : null;
      },
      resourceOf: (slot) => st.resources[slot] || null,
      bridgeBackends: { beam: bridges.BEAM_BRIDGE_BACKEND }
    });
    st.rm.coreOf = (uid) => st.coreDescs.get(uid) || null;
    st.rm.stationOf = (s, gen) => { const d = st.stationDescs[s]; return d && d.gen === gen ? d.desc : null; };
    st.cloak = cloak.createCloakMirrorState();
    const ok = await Promise.race([Core3D.ready, new Promise((r) => setTimeout(() => r('timeout'), 30000))]);
    if (ok !== true) {
      ret.retSetFlag(st.ret, ret.RET_FLAG.GPU_UNSUPPORTED);
      postMessage({ type: 'ready', ok: false, why: String(Core3D.gpuError || ok) });
      return;
    }
    ret.retSetFlag(st.ret, ret.RET_FLAG.GPU_READY | ret.RET_FLAG.READY);
    try { hex.prewarmHexShips3D({ canvas: st.canvas }); } catch (e) { report(e, 'prewarmHexShips3D'); }
    try { shields.prewarmShields3D(); } catch (e) { report(e, 'prewarmShields3D'); }
    postMessage({ type: 'ready', ok: true });
    Core3D.warmup.flush().then(() => ret.retSetFlag(st.ret, ret.RET_FLAG.WARM_FLUSHED), (e) => report(e, 'warmup.flush'));
    requestAnimationFrame(frame);
  }

  function setLayout(m) {
    const { layoutMod, tb } = st.mods;
    st.reader = new tb.TripleBufferReader(m.buffer, { views: (buf, off) => layoutMod.createSnapshotViews(buf, off, m.layout) });
    st.pendingK = -1;
  }

  function applyFrameMsg(m) {
    for (let i = 0; i < m.desc.length; i += 2) st.descriptors[m.desc[i]] = m.desc[i + 1];
    for (let i = 0; i < m.topo.length; i += 2) st.topologies[m.topo[i]] = m.topo[i + 1];
    for (let i = 0; i < m.cores.length; i += 2) st.coreDescs.set(m.cores[i], m.cores[i + 1]);
    for (let i = 0; i < m.stations.length; i += 2) st.stationDescs[m.stations[i]] = m.stations[i + 1];
    for (let i = 0; i < m.res.length; i += 2) {
      const old = st.resources[m.res[i]];
      if (old && old !== m.res[i + 1] && typeof old.close === 'function') old.close();
      st.resources[m.res[i]] = m.res[i + 1];
    }
    const dv = st.dict.values;
    for (let i = 0; i < m.dict.length; i++) dv[m.dictFrom + i] = m.dict[i];
    if (m.k > st.lastMsgK) st.lastMsgK = m.k;
  }

  function frame() {
    requestAnimationFrame(frame);
    const r = st.reader;
    if (!r) return;
    const { layoutMod, retMod } = st.mods;
    const H = layoutMod.HEAD;
    if (r.acquire()) {
      st.pendingK = r.page.head[H.K];
      retMod.retNoteConsumed(st.ret, st.pendingK);
    }
    // strona czeka na wiadomość ze swoimi opisami (wiadomość idzie po publikacji)
    if (st.pendingK < 0 || st.pendingK > st.lastMsgK) return;
    const k = st.pendingK;
    st.pendingK = -1;
    try {
      renderPage(r.page, k);
    } catch (e) {
      report(e, 'renderPage');
    }
  }

  function renderPage(v, k) {
    const { layoutMod, hex, models, shields, stations, cloak, retMod } = st.mods;
    const Core3D = st.Core3D;
    const H = layoutMod.HEAD, L = layoutMod.LIST, WD = layoutMod.WORLD;
    const h = v.head;
    const W = h[H.W], Hh = h[H.H];
    if (W !== st.W || Hh !== st.H) {
      st.W = W; st.H = Hh;
      globalThis.innerWidth = W; globalThis.innerHeight = Hh;
      Core3D.resize(W, Hh);
    }
    const sun = st.sun;
    sun.x = v.world[WD.SUN_X]; sun.y = v.world[WD.SUN_Y]; sun.r = v.world[WD.SUN_R];
    const rm = st.rm;
    rm.apply(v);
    cloak.applyCloakBlock(v.blocks.cloak, (slot, gen) => { const e = rm.entities[slot]; return e && e.gen === gen ? e : null; },
      rm.lists[L.RENDER], st.dict, st.cloak);
    st.players.ship = rm.player;
    st.players.player2Ship = rm.player2;
    const cam = st.cam;
    cam.x = h[H.CAM_X]; cam.y = h[H.CAM_Y]; cam.zoom = h[H.CAM_ZOOM];
    const c = st.cull;
    c.x = h[H.CULL_X]; c.y = h[H.CULL_Y]; c.halfW = h[H.CULL_HALF_W]; c.halfH = h[H.CULL_HALF_H];
    c.drawHalfW = h[H.CULL_DRAW_HALF_W]; c.drawHalfH = h[H.CULL_DRAW_HALF_H];
    const paused = (h[H.FLAGS] & layoutMod.HEAD_FLAG.PAUSED) !== 0;
    const dt = paused ? 0 : h[H.FRAME_DT];
    const t0 = performance.now();
    Core3D.syncCamera(cam);
    stations.updateStations3D(rm.stations);
    hex.updateHexShips3D(cam, rm.lists[L.RENDER], c, null, st.cloak.frame);
    models.syncShipModels3D({ entities: rm.lists[L.SEEN_COLD], poseOf: null, turrets: null, inView: null, zoom: cam.zoom, zoomAt: null, dt });
    shields.updateShields3D(dt, rm.lists[L.SEEN], null);
    const t1 = performance.now();
    Core3D.renderSingle(cam);
    const t2 = performance.now();
    const bmp = st.canvas.transferToImageBitmap();
    postMessage({ type: 'frame', k, bmp }, [bmp]);
    retMod.retNoteRendered(st.ret, k);
    const f = st.ret.f64, R = retMod.RET_F64;
    f[R.CPU_UPDATE_MS] = t1 - t0;
    f[R.CPU_RENDER_MS] = t2 - t1;
    f[R.CPU_FRAME_MS] = performance.now() - t0;
    if (Number.isFinite(Core3D.gpuFrameMs)) f[R.GPU_FRAME_MS] = Core3D.gpuFrameMs;
    st.frames++;
  }

  // wiadomości przed końcem init (moduły ładują się asynchronicznie) — w kolejce, w kolejności
  const early = [];
  const handle = (m) => {
    try {
      if (m.type === 'layout') setLayout(m);
      else if (m.type === 'frame') applyFrameMsg(m);
    } catch (err) {
      report(err, m && m.type);
    }
  };
  self.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'init') {
      init(m).then(() => { for (const q of early) handle(q); early.length = 0; st.live = true; },
        (err) => { report(err, 'init'); postMessage({ type: 'ready', ok: false, why: String(err?.message || err) }); });
      return;
    }
    if (!st.live) { early.push(m); return; }
    handle(m);
  };
}
