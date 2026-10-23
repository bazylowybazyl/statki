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
  'tło menu'
]);

const isWorker = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope;

if (isWorker) {
  const st = {
    Core3D: null, mods: null, rm: null, cloak: null, players: null, reader: null, ret: null,
    canvas: null, W: 0, H: 0, dpr: 1, lastMsgK: -1, pendingK: -1,
    // uzgadnianie strony k z jej wiadomością (RW-45b): `msg` — render od razu po odbiorze wiadomości, odebrana strona
    // czeka na swoją wiadomość (nie jest porzucana na rzecz nowszej); `raf` — dawne zachowanie (render tylko w takcie
    // rAF, takt bierze zawsze najnowszą stronę; A/B: `?rwRender=raf`). Liczniki idą do RET (RET_F64.W_*).
    renderMode: 'msg', ticks: 0, waits: 0, abandoned: 0, rendered: 0, msgRenders: 0, msgLagSum: 0, msgN: 0,
    descriptors: [], topologies: [], coreDescs: new Map(), stationDescs: [], resources: [],
    dict: { values: [], value(c) { return c >= 0 ? this.values[c] : undefined; } },
    cam: { x: 0, y: 0, zoom: 1, roll: 0 }, cull: { x: 0, y: 0, halfW: 0, halfH: 0, drawHalfW: 0, drawHalfH: 0 },
    sun: { x: 0, y: 0, r: 0 }, frames: 0, errors: 0,
    // strumień rozkazów (RW-40b): czytelnik pierścienia strony, pociski-lustra po slocie (SHOTS)
    cmd: null, cmdBuf: null, evFrame: -1, pageEv: new Float64Array(64).fill(-1), shots: [], shotList: [],
    // wieże 3D (blok TURRETS — rekordy Turret2D tej klatki po stronie gry, RW-26): lustro → rekordy
    turByEnt: new Map(), turPool: [], turrets: null,
    // klatka zero: rozgrzewka widocznych obiektów przed pierwszym rysunkiem strony gry (renderPage)
    firstPageWarm: true
  };
  // tło menu gotowe (RW-41c) — reszta init workera (efekty) rusza po nim
  st.menuReadyP = new Promise((r) => { st.menuReadyRes = r; });
  st.liveP = new Promise((r) => { st.liveRes = r; });
  const report = (e, where) => {
    st.errors++;
    if (st.errors <= 20) postMessage({ type: 'error', where, msg: String(e?.stack || e?.message || e).slice(0, 2000) });
  };
  self.addEventListener('error', (e) => report(e.error || e.message, 'onerror'));
  self.addEventListener('unhandledrejection', (e) => report(e.reason, 'promise'));
  // Wyjątek jednego modułu nie zatrzymuje obrazu (audyt 2026-10-17: błąd mostków przy pierwszym wraku przerywał KAŻDĄ
  // klatkę — bez bitmapy obraz stał do końca gry). Moduł z błędem pomijany w tej klatce, reszta i render idą dalej;
  // do strony pierwsze 3 błędy modułu, dalej tylko licznik `st.modErrors` (nazwa → liczba).
  st.modErrors = new Map();
  const frameTimes = globalThis.__rwFrameTimes = { ms: new Float64Array(8192), n: 0 };
  // nowe próbki czasu GPU klatki (Core3D.gpuFrameMs, znaczniki co gpuTimerSampleEvery klatek) — narzędzia (--wkAb)
  const gpuTimes = globalThis.__rwGpuTimes = { ms: new Float64Array(4096), n: 0, seen: -1 };
  const modFail = (name, e) => {
    const n = (st.modErrors.get(name) || 0) + 1;
    st.modErrors.set(name, n);
    if (n <= 3) report(e, `renderPage/${name}`);
  };

  async function init(m) {
    st.t0 = performance.now();
    if (m.menu3d === false) st.menuReadyRes();   // bez tła menu (?menu3d=0) — efekty od razu
    // podkładki (RW-02 § 8; moduły czytają config przy imporcie — RenderWorld przed modułami renderu)
    globalThis.window = globalThis;
    globalThis.innerWidth = m.W;
    globalThis.innerHeight = m.H;
    globalThis.devicePixelRatio = m.dpr || 1;
    if (typeof globalThis.requestIdleCallback !== 'function') {
      // budżet jak w przeglądarce: ~8 ms od wywołania (stałe 8 ms robiło z pętli „póki starcza czasu” jedną długą
      // serię — rozgrzewka w tle kompilowała całą kolejkę naraz i dławiła worker oraz proces GPU w menu, RW-41c); bez
      // czekania do `timeout` (dawne 50 ms między porcjami rozciągało budowę ringu i rozgrzewkę na sekundy)
      globalThis.requestIdleCallback = (fn, opt) => setTimeout(() => { const t0 = performance.now(); fn({ didTimeout: false, timeRemaining: () => Math.max(0, 10 - (performance.now() - t0)) }); }, 1);
      globalThis.cancelIdleCallback = (id) => clearTimeout(id);
    }
    st.W = m.W; st.H = m.H; st.dpr = m.dpr || 1;
    // adresy zasobów względne do STRONY (assets/…), nie do skryptu workera — fetch i loadery three
    if (m.pageBase && !globalThis.__rwFetch) {
      const base = m.pageBase, f0 = globalThis.fetch.bind(globalThis);
      globalThis.__rwFetch = f0;
      globalThis.fetch = (input, init) => f0(typeof input === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(input) && !input.startsWith('/') ? new URL(input, base).href : input, init);
    }
    // tryb uzgadniania strony z wiadomością z adresu strony (A/B: `?rwRender=raf` — dawne zachowanie)
    try {
      const rr = m.pageBase ? new URL(m.pageBase).searchParams.get('rwRender') : null;
      if (rr === 'raf' || rr === 'msg') st.renderMode = rr;
    } catch (_) { /* adres bez składni URL — tryb domyślny */ }
    globalThis.SUN = st.sun;
    const { RenderWorld, createMirrorPlayersSource } = await import('./renderWorld.js');
    st.players = createMirrorPlayersSource();
    // Poza renderu gracza (interpolowana między krokami fizyki — window.__interpShipPose strony) z HEAD.INTERP strony:
    // bez niej kadłub gracza (hexShips3D), dysze, rakiety i warp szły w pozie KROKU fizyki (60 Hz), a kamera i wieże za
    // pozą interpolowaną — przy 240 Hz kadłub skakał między 4 położeniami („kilka statków”, w warpie dwa obok siebie;
    // zgłoszenie użytkownika 2026-10-17). Pole własne źródła tylko w workerze (inline czyta globalną pozę strony).
    Object.defineProperty(st.players, 'playerPose', { value: null, writable: true, enumerable: true });
    st.interpPose = { x: 0, y: 0, angle: 0 };
    // poseOf modułów na lustrach (mostki, modele 3D, drony naprawcze) — jak bridgeRenderPose strony: gracz w pozie
    // interpolowanej, NPC i wraki mają ją już w ENT migawki (renderPoses)
    st.playerPoseOf = (e) => (e === st.players.ship ? st.players.playerPose : null);
    RenderWorld.setSource(st.players);
    const [core, hex, models, shields, stations, mirror, layoutMod, tb, ret, cloak, bridges] = await Promise.all([
      import('../3d/core3d.js'), import('../3d/hexShips3D.js'), import('../3d/ships3d/shipModels3DGame.js'),
      import('../3d/shield3D.js'), import('../3d/stations3D.js'), import('./renderMirror.js'), import('./snapshotLayout.js'),
      import('./tripleBuffer.js'), import('./returnLayout.js'), import('./blocks/cloakBlock.js'),
      import('../game/shipBridgeBeams.js')
    ]);
    const [cmdMod, wfxCmd, dmgCmd, blastCmd, blastFx, rktFx, sparks, clock, wfx] = await Promise.all([
      import('./renderCommands.js'), import('../3d/weapons/weaponFxCommands.js'), import('../3d/hullDamageCommands.js'),
      import('../3d/explosions/explosionCommands.js'), import('../3d/explosions/explosionFx.js'), import('../3d/rockets/rocketFx.js'),
      import('../3d/sparkSystem3D.js'), import('../game/simClock.js'), import('../3d/weapons/weaponFx.js')
    ]);
    const [rktBlock, rktCmd, viewBlock, coldMod] = await Promise.all([import('./blocks/rocketBlock.js'), import('../3d/rockets/rocketFxCommands.js'),
      import('./blocks/viewBlock.js'), import('../game/coldWrecks.js')]);
    const [warpMod, warpCmd, warpBlock] = await Promise.all([
      import('../3d/warp/warpNurt.js'), import('../3d/warp/warpTrafficCommands.js'), import('./blocks/warpBlock.js')
    ]);
    // uderzenia w planetoidę pod bazą piratów (rekord ROCK_IMPACT — cel: obraz planetoidy z pirateBaseGame.js)
    const rockImpactMod = await import('../3d/pirateRockImpactFx.js');
    const [ringWorldMod, ringGameMod, ringBlockMod] = await Promise.all([
      import('../game/haloRingWorld.js'), import('../3d/haloRing/haloRingGame.js'), import('./blocks/ringBlock.js')
    ]);
    // tło menu i lot intro (RW-41c) — wczytane z góry, żeby start tła nie czekał na import w trakcie init efektów
    // moduły pasa — w tle od razu: bank skał rusza zaraz po gotowym tle menu, bez importów w trakcie init efektów
    st.beltModsP = Promise.all([import('../game/asteroidBeltField.js'), import('../game/asteroidGiants.js'), import('../3d/asteroids/asteroidBelt.js'),
      import('../game/asteroidMining.js'), import('./miningSync.js')]);
    [st.menuMod, st.introMod] = await Promise.all([import('../3d/menuBackdrop3D.js'), import('../game/story/introCamera.js')]);
    st.destruction = (await import('../vfx/destruction3D.js')).Destruction3D;
    globalThis.Destruction3D = st.destruction;   // RenderWorld.destruction3D (prebake brył: stacja piracka)
    const [bridge3d, bridgeFx, cloakLook, reactorFx] = await Promise.all([
      import('../3d/bridge3D.js'), import('../3d/bridgeFx3D.js'), import('../game/cloakLook.js'), import('../3d/reactorBlast/reactorBlastFx.js')
    ]);
    // planety, słońce, księżyce, małe ciała, mgławica i gwiazdy (API globalne: initPlanets3D / updatePlanets3D)
    await import('../3d/planet3d.assets.js');
    st.dust = (await import('../3d/dust/spaceDust3D.js')).SpaceDust3D;
    st.hallDust = (await import('../3d/gasField/hallDust.js')).HallDust;
    // gaz w otwartej przestrzeni (pas — docs/PLAN-gazy-kosmos.md): bloki `spaceGas` (wejście) i `gasObst` (kadłuby;
    // ten sam blok podaje przeszkody gazu wybuchów — kopia GAS_OBST_IN strony, RW-11c)
    st.spaceGas = (await import('../3d/spaceGas/spaceGas.js')).SpaceGas;
    st.spaceGasBlk = await import('./blocks/spaceGasBlock.js');
    st.gasObstBlk = await import('./blocks/gasObstBlock.js');
    // drony naprawcze (blok `repair` + rekordy REPAIR_FX po id rigu)
    st.repairMods = { blk: await import('./blocks/repairBlock.js'), drones: await import('../3d/repair/repairDrones3D.js') };
    st.repairMirror = { rigs: [], out: 0, _rigs: new Map() };
    // statki ruchu v2 w bańce (E6): blok `traffic` → proxy kadłubów (ShipProxyBatch3D) i dysze MAIN w liście kadłubów
    st.trafficMods = { blk: await import('./blocks/trafficBlock.js'), proxy: (await import('../3d/shipProxyBatch3D.js')).ShipProxyBatch3D };
    st.trafficList = [];
    // doki portów bez ringu (E14): blok `portDocks` → budowle krzyż / okrąg / koło (import rejestruje rozgrzewkę szablonów)
    st.portDockMods = { blk: await import('./blocks/portDockBlock.js'), mod: await import('../3d/portDocks3D.js') };
    st.portDockList = [];
    st.hexList = [];
    // przeładunek w portach (E12): blok `cargoOps` → ładownie, kontenery, rój dronów, taśmy (import rejestruje rozgrzewkę);
    // `?przeladunek=0` strony (A/B kosztu) — bez importu: bez rozgrzewki, symulacji i kroku efektów
    let cargoOn = true;
    try { cargoOn = !m.pageBase || new URL(m.pageBase).searchParams.get('przeladunek') !== '0'; } catch (_) { /* adres bez składni URL */ }
    st.cargoMods = cargoOn ? { blk: await import('./blocks/cargoOpsBlock.js'), shared: (await import('../3d/cargo/portCargo3D.js')).sharedPortCargo3D } : null;
    st.cargoFrame = {};
    st.wbReplica = { sites: [], sitesByKey: [], focus: [], byRef: new Map(), _ents: [], renderEntities() { return this._ents; } };
    // rdzenie: strugi i kule (blok `hazards`, rekordy RX_*) i model reaktora w wyrwie
    st.hazMods = { blk: await import('./blocks/hazardBlock.js'), cmd: await import('../3d/reactorBlast/reactorCommands.js'),
      model: await import('../3d/reactor3D.js'), core: await import('../game/reactorCore.js') };
    st.hazards = st.hazMods.blk.createHazardMirrorState();
    // luk Atlasa (fregata zwiadu): rig ładowni i dziura w skórze lustra gracza; postęp wrót z wiadomości strony
    st.bayMod = await import('../3d/cargo/scoutBay3D.js');
    // stacja piracka (world3d.js): bryła na lustrze stacji, którą strona podpięła (`world3dPirate` w opisie)
    st.w3 = await import('../3d/world3d.js');
    st.w3.setWorld3DHiddenTest((s) => !!s.fogHidden);
    st.w3Station = null;
    st.bayPose = { x: 0, y: 0, angle: 0 };
    st.repairSync = { swarm: st.repairMirror, dt: 0, zoom: 1, time: 0, poseOf: (e) => st.playerPoseOf(e), hidden: (e) => !!(e && e.__mirror === true && e.fogHidden) };
    st.mods = { core, hex, models, shields, stations, mirror, layoutMod, tb, retMod: ret, cloak, cmdMod, wfxCmd, dmgCmd, blastCmd, clock, bridge3d, bridgeFx, cloakLook, rktBlock, rktCmd, viewBlock, ringWorldMod, ringGameMod, ringBlockMod, warpMod, warpCmd, warpBlock, rockImpactMod };
    st.warpMirror = warpBlock.createWarpMirror();
    st.warpObj = { state: undefined, charge: 0, chargeTime: 0, gear: 0, dir: 0, flybyFactor: 1, cruise: 0, speed: 0, exitRamp: null };
    st.warpRamp = { active: false, age: 0, tBrake: 0 };
    // hipercruise gracza w kształcie warpa (skalary HYPER_* — RenderWorld.hyper, WarpNurt, struga, lakier)
    st.hyperObj = { state: 'idle', charge: 0, chargeTime: 0, speed: 0, vmax: 0, dir: 0 };
    st.warpFrame = { dt: 0, cam: null, camShake: null, camFollow: false, ship: null, warp: st.warpObj, hyper: st.hyperObj, trafficTime: 0, lensAllowed: false };
    st.ringMirror = ringBlockMod.createRingMirror();
    st.rockets = rktBlock.createRocketMirror();
    st.weaponDefs = new Map();
    const Core3D = core.Core3D;
    st.Core3D = Core3D;
    // zbieranie zgłoszeń kolejki GPU (src/3d/zbieraczZgloszen.js): `?gpuSubmit=0` strony — bez instalacji (A/B)
    try { if (m.pageBase && new URL(m.pageBase).searchParams.get('gpuSubmit') === '0') Core3D.submitBatching = false; } catch (_) { /* adres bez składni URL */ }
    if (m.quality) Core3D.configureQuality(m.quality);
    // RW-41c: pierwsze uruchomienie — preset grafiki z adaptera WORKERA (strona nie ma urządzenia), przed jego
    // urządzeniem (MSAA presetu w celach sceny); wynik do strony (`gfxAuto` → opcje, zapis, informacja w menu)
    if (m.autoGfx) {
      const [gq, ga] = await Promise.all([import('../game/graphicsQuality.js'), import('../game/graphicsAutoPreset.js')]);
      const a = m.autoGfx;
      Core3D.onAdapter = (adapter) => {
        const real = ga.describeGpuAdapter(adapter);
        const desc = { ...real, ...(a.fake || {}) };
        const pick = ga.pickGfxPresetAuto(desc, a.env || {});
        const q = gq.gfxWithPreset(a.gfx, pick.preset);
        Core3D.configureQuality({ renderScale: q.renderScale, msaa: q.msaa });
        postMessage({ type: 'gfxAuto', adapter: real, quality: { renderScale: q.renderScale, msaa: q.msaa },
          auto: { ...pick, gpu: { vendor: desc.vendor, architecture: desc.architecture }, force: !!a.force, applied: false } });
      };
    }
    st.ret = ret.createReturnViews(m.retBuffer);
    st.canvas = new OffscreenCanvas(Math.max(1, Math.round(m.W * (m.dpr || 1))), Math.max(1, Math.round(m.H * (m.dpr || 1))));
    hex.initHexShips3D({ canvas: st.canvas });
    // Stałe światła sceny (latarnie stacji pirackiej, intensywność 0) od razu po scenie — jak initWorld3D() strony przy
    // starcie. Zestaw świateł passa jest w kluczu materiałów (pułapka 34): latarnie dodane dopiero przez wpis rozgrzewki
    // „stacja piracka” zmieniały go w środku kolejki — wszystko rozgrzane wcześniej (krok fx wybuchów, wieże, dysze SIDE)
    // budowało się drugi raz, a w klatce zero synchronicznie (2026-10-20, docs/AUDYT-start-sync-worker-2026-10-20.md).
    st.w3.initWorld3D();
    Core3D.resize(m.W, m.H);
    const sid = models.shipModel3DIdFor;
    hex.setBeamSkinSuppressor((e) => !!e.beamHull?.world || !!sid(e));
    hex.setEntityHiddenTest((e) => (e.__mirror === true ? e.fogHidden : false));
    // zimne wraki: ciało do rysowania wybrała gra (blok `view` — numer klatki strony)
    hex.setColdWreckRenderHooks({ drawn: (w) => w._coldDrawFrame === st.curFrame, config: coldMod.COLD_WRECK_CONFIG,
      listedForExtras: (w) => w._coldExtrasFrame === st.curFrame });
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
    st.tGpu = performance.now();
    // RW-41c: planety (ringi) i tło menu PRZED inicjalizacją efektów (kilka s synchronicznie) — pieczenie ringu tła
    // rusza od razu i idzie na GPU równolegle z resztą init; wiadomości, które jeszcze nie przyszły, obsłuży onmessage
    for (let i = 0; i < early.length;) {
      const q = early[i];
      if (q.type === 'planets' || q.type === 'menu' || q.type === 'belt' || q.type === 'beltOp' || q.type === 'beltOcc' || q.type === 'beltGiant') { early.splice(i, 1); handle(q); } else i++;
    }
    await new Promise((r) => setTimeout(r, 0));
    ret.retSetFlag(st.ret, ret.RET_FLAG.GPU_READY | ret.RET_FLAG.READY);
    // dziennik pipeline'ów tworzonych SYNCHRONICZNIE w klatkach workera (przestój GPU — to, czego rozgrzewka nie objęła);
    // pierwsze 60 do konsoli workera (render-worker-gra.mjs zbiera logi workera), liczba w st.pipeSync
    try {
      const pu = Core3D.renderer && Core3D.renderer.backend && Core3D.renderer.backend.pipelineUtils;
      if (pu) {
        const orig = pu.createRenderPipeline;
        st.pipeSync = 0;
        pu.createRenderPipeline = function (ro, promises) {
          if (!promises && st.inFrame) {
            st.pipeSync++;
            if (st.pipeSync <= 60) {
              const m = ro && ro.material, o = ro && ro.object;
              console.log(`[render.worker] pipeline sync #${st.pipeSync} k=${st.frames}: ${(m && m.type) || '?'}${m && m.name ? ':' + m.name : ''} @ ${(o && o.type) || '?'}${o && o.name ? ':' + o.name : (o && o.parent && o.parent.name ? ' w ' + o.parent.name : '')}`);
            }
          }
          return orig.call(this, ro, promises);
        };
      }
    } catch (e) { report(e, 'dziennik pipeline'); }
    // rozgrzewki kadłubów i tarcz — przy „Start” (prepareScene), jak w trybie off: w menu GPU ma tło (RW-41c)
    st.gamePrewarm = () => {
      st.gamePrewarm = null;
      try { hex.prewarmHexShips3D({ canvas: st.canvas }); } catch (e) { report(e, 'prewarmHexShips3D'); }
      try { shields.prewarmShields3D(); } catch (e) { report(e, 'prewarmShields3D'); }
    };
    // efekty (pule GPU, fabryki wybuchów, mostki, rdzenie, pył, luk, rozpad, warp) — RW-41c: PO gotowości tła menu
    // (albo po 15 s), w porcjach z oddaniem wątku: synchroniczne kilka sekund stało przed budową ringu tła
    const yieldTask = () => new Promise((r) => setTimeout(r, 0));
    const initEffects = async () => {
    // efekty ze strumienia rozkazów: iskry, rakiety (pule dymu — wybuchy), wybuchy WebGPU, efekty broni, mapa ran
    try {
      sparks.SparkSystem3D.init(Core3D.scene);
      const rocketFx = rktFx.createRocketFx(Core3D);
      st.rocketFx = rocketFx;
      if (rocketFx && rocketFx.smoke) st.hallDust.setVaporSmoke(rocketFx.smoke);
      if (rocketFx && typeof rocketFx.attachRockets === 'function') rocketFx.attachRockets(st.rockets.pool);
      wfx.WeaponFx.ensure();
      await yieldTask();
      st.blastFactory = blastFx.createExplosionFactory(Core3D, { rocketFx, weaponFx: wfx.WeaponFx });
      // wyrwy bazy piratów (dekompresja, pożary): obraz na stanie klatki z bloku `pirateVents`, gaz reżysera wybuchów
      try {
        const [ventsMod, ventsBlk] = await Promise.all([import('../3d/pirateBaseVents3D.js'), import('./blocks/pirateVentsBlock.js')]);
        st.vents = ventsMod.createPirateBaseVents3D(Core3D, { explosions: () => (st.blastFactory && st.blastFactory.system) || null });
        st.ventsBlk = ventsBlk;
        st.ventsMirror = ventsBlk.createPirateVentsFrame();
      } catch (e) { report(e, 'wyrwy bazy'); }
      // bitwa w głębi sceny „Wojna” (tłum nad i pod płaszczyzną, planeta w głębi, bohaterowie): stan z bloku warBackdrop
      try {
        const [wbMod, wbBlk] = await Promise.all([import('../3d/warBackdrop/warBackdrop3D.js'), import('./blocks/warBackdropBlock.js')]);
        st.warBd = wbMod.createWarBackdrop3D(Core3D);
        st.warBdBlk = wbBlk;
        st.warBdMirror = wbBlk.createWarBackdropFrame();
      } catch (e) { report(e, 'bitwa w głębi'); }
      // mostki (model 3D, okna, wyrzut atmosfery) i obraz rdzeni reaktora — na lustrach (RW-11b)
      bridgeFx.BridgeFx3D.attach(Core3D.scene, { weaponFx: wfx.WeaponFx });
      bridge3d.Bridge3D.attach(Core3D.scene);
      await yieldTask();
      Core3D.warmup.add({ name: 'mostki 3D (bridge3D, szczeliny)', phase: 'loading',
        objects: () => [...bridge3d.Bridge3D.warmupMeshes(), bridgeFx.BridgeFx3D.mesh].filter(Boolean) });
      st.reactorFx = reactorFx.createReactorBlastFx(Core3D, { rocketFx, weaponFx: wfx.WeaponFx });
      const rc = st.hazMods.core;
      // reaktor w obudowie nad kadłubem (pass ortho): poza renderu gracza, maskowanie w środku rdzenia i „Statki 3D”
      // jak strona (reactorModelVisibility w index.html)
      const sid3 = models.shipModel3DIdFor;
      st.reactorModel = st.hazMods.model.createReactor3D({
        scene: Core3D.scene, colorFor: (core) => core.color || [0.3, 0.7, 1.0],
        frameOf: (core, out) => rc.reactorCoreFrame(core, out, st.playerPoseOf(core.host)), hostReady: (h) => !!rc.reactorHull(h),
        visibility: (core, wx, wy) => (sid3(core.host) ? 0 : cloakLook.entityCloakVisAt(core.host, wx, wy))
      });
      st.reactorModelOpts = { origin: { x: 0, y: 0 }, view: st.cull, zoom: 1 };
      Core3D.warmup.add({ name: 'model reaktora (reactor3D)', layer: 0, phase: 'loading',
        objects: () => (st.reactorModel ? st.reactorModel.warmupMeshes() : []) });
      await yieldTask();
      st.dust.init();
      await yieldTask();
      st.bay = st.bayMod.createScoutBay3D(Core3D, 'atlas');
      Core3D.warmup.add({ name: 'ładownia Atlasa (fregata zwiadu)', objects: () => st.bay.warmupMeshes(), phase: 'loading' });
      st.destruction.init({ scene: Core3D.scene, reactorFactory: st.blastFactory, shockwaveManager: null });
      warpMod.WarpNurt.init();
    } catch (e) { report(e, 'efekty'); }
    };
    await Promise.race([st.menuReadyP, new Promise((r) => setTimeout(r, 15000))]);
    await initEffects();
    if (st.cmdBuf) makeReader(st.cmdBuf);
    postMessage({ type: 'ready', ok: true });
    // wpisy rozgrzewki z fazą 'loading' dokańcza przygotowanie sceny przy „Start” (prepareScene → flush), nie start
    // workera: w menu jedno urządzenie GPU rysuje tło — kompilacje tu zatrzymywały proces GPU i klatki strony (RW-41c)
    requestAnimationFrame(frame);
  }

  function makeReader(buffer) {
    const { cmdMod, wfxCmd, dmgCmd, blastCmd } = st.mods;
    const rm = st.rm;
    st.cmd = new cmdMod.RenderCommandReader(buffer, {
      // encja albo stacja (stacje mają sloty w tej samej przestrzeni encji)
      entityAt: (slot, gen) => {
        const e = rm.entities[slot];
        if (e && e.gen === gen) return e;
        const sts = rm.stations;
        for (let i = 0; i < sts.length; i++) if (sts[i].slot === slot && sts[i].gen === gen) return sts[i];
        return null;
      },
      shotAt: (slot, gen) => { const b = st.shots[slot]; return b && b.__gen === gen ? b : null; }
    });
    // błędny rekord (dekoder efektu) pominięty — strumień idzie dalej
    st.cmd.onError = (e, type) => modFail(`rozkaz ${type}`, e);
    wfxCmd.installWeaponFxCommands(st.cmd);
    dmgCmd.installHullDamageCommands(st.cmd);
    blastCmd.installExplosionCommands(st.cmd, () => st.blastFactory || null);
    st.mods.rockImpactMod.installRockImpactCommands(st.cmd, () => (st.blastFactory && st.blastFactory.system) || null);
    st.mods.warpCmd.installWarpTrafficCommands(st.cmd, st.mods.warpMod.WarpNurt, (slot) => st.warpMirror.recordAt(slot));
    st.hazMods.cmd.installReactorCommands(st.cmd, () => st.reactorFx || null, (id) => st.hazards.byId.get(id) || null);
    st.repairMods.drones.installRepairFxCommands(st.cmd, (id) => st.repairMirror._rigs.get(id) || null);
    if (st.rocketFx && st.rocketFx.director) st.mods.rktCmd.installRocketFxCommands(st.cmd, st.rocketFx.director, (i) => st.rockets.pool[i] || null);
  }

  // Dane ciał ze strony: pierwsza wiadomość — initPlanets3D, kolejne — wartości w miejscu (encje czytają obiekty danych).
  function setPlanets(m) {
    if (!st.planets) {
      st.tPlanets0 = performance.now() - st.t0;
      st.planets = m.planets; st.sunData = m.sun; st.small = m.small;
      Object.assign(st.sun, { x: m.sun?.x || 0, y: m.sun?.y || 0, r: m.sun?.r || 0 });
      globalThis.planets = m.planets;
      globalThis.smallBodies = m.small;
      globalThis.initPlanets3D(m.planets, m.sun, { smallBodies: m.small });
      // Ringi „Halo” (RW-40b): świat ringów z tych samych planet — geometria kolidera z układu; stan klatki (zegar,
      // lampki, pozy obsługi, obrys kadłuba gracza w hubie, dach z fabuły) z bloku `ring` migawki
      try {
        const { ringWorldMod, ringGameMod } = st.mods;
        st.haloWorld = new ringWorldMod.HaloRingWorld({ planets: m.planets });
        for (const e of st.haloWorld.entries) {
          const key = e.key;
          e.collider.hubOutline = () => { const r = st.ringMirror.entries[key]; return r ? r.hub : null; };
        }
        st.haloRings = new ringGameMod.HaloRingGame({ world: st.haloWorld, quality: m.quality || 'high' });
        // RW-41c: mapa CPU terenu ringu (Ziemia — po odczycie map) do gry: kolizje płyty bez ringu na stronie
        const hw = st.haloWorld, setT = hw.setRingTerrain.bind(hw);
        hw.setRingTerrain = (key, fn) => {
          setT(key, fn);
          const ent = st.haloRings.entries.find((v) => v.key === key);
          const map = ent && ent.ring && ent.ring.terrainMap;
          if (map && map.heights) postMessage({ type: 'ringTerrain', key, w: map.w, h: map.h, heights: map.heights.slice() });
        };
      } catch (e) { report(e, 'ringi'); }
      st.tPlanets1 = performance.now() - st.t0;
      if (st.menuPending) { const q = st.menuPending; st.menuPending = null; st.menuChain = (st.menuChain || Promise.resolve()).then(() => menuOp(q)).catch((e) => report(e, 'menu')); }
      return;
    }
    const upd = (dst, src) => { if (dst && src) Object.assign(dst, src); };
    upd(st.sunData, m.sun);
    for (let i = 0; i < m.planets.length; i++) upd(st.planets[i], m.planets[i]);
    for (let i = 0; i < m.small.length; i++) upd(st.small[i], m.small[i]);
  }

  async function setComets(m) {
    try {
      const [{ CometField }, { CometsView }, { COMETS }] = await Promise.all([
        import('../game/cometField.js'), import('../3d/comets/comets3D.js'), import('../data/comets.js')
      ]);
      const field = new CometField({ sun: m.sun, au: m.au, defs: [] });
      for (const s of m.sites) {
        const def = COMETS.find((d) => d.id === s.id);
        if (def) field._addPlaced({ def, x: s.x, y: s.y, offset: s.offset, state: s.state, geo: s.geo });
      }
      st.cometsView = new CometsView(st.Core3D, field);
      st.cometField = field;
      field.build();
    } catch (e) { report(e, 'komety'); }
  }

  async function pirateBaseEvent(m) {
    try {
      if (!st.pbg) {
        const [pbg, site, lay, blk] = await Promise.all([import('../3d/pirateBaseGame.js'), import('../game/story/pirateBaseSite.js'),
          import('../3d/portBuildings/pirateBaseLayout.js'), import('./blocks/pirateBaseBlock.js')]);
        st.pbMods = { site, lay, blk };
        st.pbMirror = blk.createPirateBaseMirror();
        st.pbg = pbg;
      }
      if (m.ev === 'attach') {
        const l = st.pbMods.lay.createPirateBaseLayout();
        const ux = Math.cos(m.axis), uy = Math.sin(m.axis), nx = -uy, ny = ux;
        const center = { x: m.origin.x + ux * l.center.x + nx * l.center.z, y: m.origin.y + uy * l.center.x + ny * l.center.z };
        st.pbPlace = st.pbMods.site.placePirateBase(center, m.axis, l);
        st.pbg.pirateBase3DEvent('attach', null, st.pbPlace);
      } else if (m.ev === 'bodies') attachWorldBodies();
      else if (m.ev === 'bodiesDetach') detachWorldBodies();
      else st.pbg.pirateBase3DEvent(m.ev, m.a, m.b, m.c);
    } catch (e) { report(e, 'baza piratów'); }
  }

  // Ciała świata bazy (RW-40b): REPLIKA miejsc z bryły bazy workera (te same kawałki w tej samej kolejności co
  // createPirateBaseSites strony), stan klatki z bloku `worldBodies`, encje kawałków = lustra (lista WORLD_BODIES
  // i odłamy-wraki z `worldRef`); obraz worldBodies3D na replice (setWorldBodiesSource).
  async function attachWorldBodies() {
    const base = st.pbg && st.pbg.pirateBase3D ? st.pbg.pirateBase3D() : null;
    if (!base || !st.pbPlace) return;
    if (!st.wbMods) {
      const [bodies, w3d, blk] = await Promise.all([import('../game/story/pirateBaseBodies.js'), import('../3d/worldBodies3D.js'),
        import('./blocks/worldBodiesBlock.js')]);
      st.wbMods = { bodies, w3d, blk };
    }
    detachWorldBodies();
    const t0 = performance.now();
    // rastry i szablony kratownic (strona: ekran ładowania) — raz, przed pierwszym kawałkiem ciałem
    try { st.wbMods.bodies.prebuildPirateBaseBodies(base.layout, base.scene, base.style?.palette || null); } catch (e) { report(e, 'ciała świata: prebuild'); }
    const sitesObj = st.wbMods.bodies.createPirateBaseSites({}, base, st.pbPlace);
    const keys = Object.keys(base.layout.structures);
    const rep = st.wbReplica;
    rep.sites = Object.values(sitesObj);
    rep.sitesByKey = keys.map((k) => sitesObj[k] || null);
    rep.byRef.clear();
    for (const site of rep.sites) {
      for (const p of site.pieces) {
        p.site = site; p.state = 'static'; p.entity = null; p.touched = false; p.lost = false;
        rep.byRef.set(site.structure + '|' + p.id, p);
      }
      // bryły upadku kawałków płaskich (bęben, szyb habitatu — odłamy 3D z worldRef `<id>~3d`)
      for (const f of site.fallPieces || []) rep.byRef.set(site.structure + '|' + f.id, f);
    }
    st.pbg.pirateBase3DEvent('bodies', sitesObj);
    st.wbMods.w3d.setWorldBodiesSource(rep);
    console.log(`[render.worker] ciała świata bazy: ${rep.byRef.size} kawałków, przygotowanie ${Math.round(performance.now() - t0)} ms`);
  }
  function detachWorldBodies() {
    const rep = st.wbReplica;
    if (rep.sites.length && st.pbg) st.pbg.pirateBase3DEvent('bodiesDetach');
    rep.sites = []; rep.sitesByKey = []; rep.byRef.clear(); rep._ents.length = 0;
  }
  // encje kawałków tej strony → replika: kawałek z `worldRef`, raster / konstrukcja szablonu z repliki (klucz skóry)
  function syncWorldBodiesReplica(v, rm, L) {
    const rep = st.wbReplica;
    if (!st.wbMods || !rep.sites.length) return false;
    if (v.blocks.worldBodies && v.blocks.worldBodies.f64) {
      st.wbMods.blk.applyWorldBodiesBlock(v.blocks.worldBodies, (slot, gen) => { const e = rm.entities[slot]; return e && e.gen === gen ? e : null; }, rep);
    }
    const out = rep._ents;
    out.length = 0;
    const add = (e) => {
      const ref = e && e.worldRef;
      const hull = e && e.beamHull;
      if (!ref || !hull) return;
      const p = rep.byRef.get(ref.s + '|' + ref.p);
      if (!p) return;
      if (hull.world !== p) hull.world = p;
      if (p.solid3D) { if (!hull.structure) hull.structure = p.solidFrame()?.structure || null; }
      else if (!hull.image) hull.image = p.build()?.image || null;
      out.push(e);
    };
    const wl = rm.lists[L.WORLD_BODIES];
    for (let i = 0; i < wl.length; i++) add(wl[i]);
    const wr = rm.lists[L.WRECKS];
    for (let i = 0; i < wr.length; i++) if (wr[i] && wr[i].worldRef) add(wr[i]);
    return true;
  }

  // Pas asteroid (RW-41b): świat pasa w workerze = zastępnik z danymi od strony (pole z tych samych argumentów
  // i operacji, sektory cienia pól, olbrzymy z siatką SDF w SAB, zegar skał z wiadomości klatki); wydobycie — jeszcze nie.
  async function setBelt(m) {
    await st.menuReadyP;   // RW-41c: najpierw tło menu (ring Ziemi), potem bank skał
    try {
      const [{ AsteroidBeltField }, { GiantRock }, { createAsteroidBelt }, r2, sync] = await st.beltModsP;
      st.GiantRock = GiantRock;
      const mm = { RockBody: r2.RockBody, sync };
      st.mineMods = mm;
      const ops = st.beltOps || (st.beltOps = []);
      const subs = [], occSubs = [];
      const apply = (field, op, arg) => {
        if (op === 'exclusions') field.setExclusions(arg);
        else if (op === 'anchors') field.setSmallBodyAnchors(arg);
        else if (op === 'peaks') field.familyPeaks();
        else if (op === 'wake') field.wakeSpots.push(arg);
        else if (op === 'holes') field.setHoles(arg);   // wyrwy po wydobyciu (ruch v2 → beltWorld.setHoles)
      };
      const giants = { entries: [],
        get readyCount() { let n = 0; for (const e of this.entries) if (e.giant && e.giant.ready) n++; return n; },
        roofAbove(x, y, zFrom = 300) {
          for (const e of this.entries) { const g = e.giant; if (g && g.ready && g.containsWorld(x, y, g.band) && g.solidAbove(x, y, zFrom)) return true; }
          return false;
        } };
      const world = { sun: m.sun, au: m.au, fieldArgs: m.fieldArgs, time: 0, frameDt: 0, giants, mining: null, rig: null, sectors: st.beltSectors || null,
        createFieldReplica() { const f = new AsteroidBeltField(m.fieldArgs); for (const [op, arg] of ops) apply(f, op, arg); subs.push((op, arg) => apply(f, op, arg)); return f; },
        onOcclusion(fn) { if (world.sectors) fn(world.sectors); occSubs.push(fn); },
        // wydobycie w workerze (RW-41b cz. 2): repliki fizyki skał i platformy z wiadomości klatki strony
        // (src/render/miningSync.js — ciała `RockBody`, okruchy, drony, piła, ładunki, zdarzenia, `taken`)
        attachShapeRadius(data) {
          if (!world.rig) { st.mineRep = mm.sync.createMiningReplica(); world.mining = st.mineRep.mining; world.rig = st.mineRep.rig; }
          // mapy promienia kształtów banku → strona (fizyka wydobycia gry — beltWorld.attachShapeRadius)
          if (data && data.maps && !st.beltShapeSent) { st.beltShapeSent = true; postMessage({ type: 'beltShape', maps: data.maps, size: data.size }); }
          return world.rig;
        }, ackMinedUpload(body) { if (body) body.dirtyBox = null; }, roofAbove(x, y) { return giants.roofAbove(x, y); } };
      st.beltWorld = world; st.beltSubs = subs; st.beltOccSubs = occSubs;
      for (const g of st.pendingGiants || []) addGiant(g);
      const belt = createAsteroidBelt({ world });
      const tB = performance.now();
      await belt.initGpu();
      console.log(`[render.worker] pas: initGpu ${Math.round(performance.now() - tB)} ms`);
      st.belt = belt;
      postMessage({ type: 'beltReady', t: [tB - st.t0, performance.now() - st.t0] });
    } catch (e) { report(e, 'pas'); }
  }
  function addGiant(m) {
    if (!st.beltWorld || !st.GiantRock) { (st.pendingGiants || (st.pendingGiants = [])).push(m); return; }
    st.beltWorld.giants.entries.push({ id: m.id, giant: new st.GiantRock(m.plan, m.x, m.y, m.grid) });
  }

  function setCmdRing(m) {
    st.cmdBuf = m.buffer;
    if (!st.mods) return;
    if (st.cmd) st.cmd.adopt(m.buffer);
    else makeReader(m.buffer);
  }

  // Pociski-lustra z bloku SHOTS (obiekt na slot + generację — stan efektu `__fx` żyje na nim jak na pocisku gry).
  function applyShots(v) {
    const { layoutMod } = st.mods;
    const SF = layoutMod.SHOT.F64, SI = layoutMod.SHOT.I32, sf = layoutMod.SHOT.stride.f64, si = layoutMod.SHOT.stride.i32;
    const n = v.head[layoutMod.HEAD.N_SHOTS] | 0;
    const f64 = v.shotF64, i32 = v.shotI32, dict = st.dict, rm = st.rm;
    const list = st.shotList;
    list.length = 0;
    for (let i = 0; i < n; i++) {
      const b = i * sf, bi = i * si;
      const s = i32[bi + SI.SLOT];
      if (s < 0) continue;
      const gen = i32[bi + SI.GEN];
      let o = st.shots[s];
      if (!o || o.__gen !== gen) {
        o = { __gen: gen, x: 0, y: 0, vx: 0, vy: 0, vz: 0, z: 0, ivx: 0, ivy: 0, ivz: 0, life: 0, age: 0, bornSim: 0,
          vfxKey: undefined, type: undefined, weaponSize: undefined, forceCanvas: false, clock: undefined, source: null,
          active: true, __fx: null, __renderedByThree: false };
        st.shots[s] = o;
      }
      o.x = f64[b + SF.X]; o.y = f64[b + SF.Y]; o.vx = f64[b + SF.VX]; o.vy = f64[b + SF.VY];
      o.vz = f64[b + SF.VZ]; o.z = f64[b + SF.Z]; o.ivx = f64[b + SF.IVX]; o.ivy = f64[b + SF.IVY]; o.ivz = f64[b + SF.IVZ];
      o.life = f64[b + SF.LIFE]; o.age = f64[b + SF.AGE]; o.bornSim = f64[b + SF.BORN_SIM];
      o.vfxKey = dict.value(i32[bi + SI.VFX_KEY]); o.type = dict.value(i32[bi + SI.TYPE]);
      o.weaponSize = dict.value(i32[bi + SI.WEAPON_SIZE]); o.clock = dict.value(i32[bi + SI.CLOCK]);
      const fl = i32[bi + SI.FLAGS];
      o.forceCanvas = (fl & layoutMod.SHOT_FLAG.FORCE_CANVAS) !== 0;
      o.__renderedByThree = !o.forceCanvas;
      const ss = i32[bi + SI.SOURCE_SLOT];
      const se = ss >= 0 ? rm.entities[ss] : null;
      o.source = se && se.gen === i32[bi + SI.SOURCE_GEN] ? se : null;
      list.push(o);
    }
    globalThis.bullets = list;
  }

  function applyTurrets(v) {
    const { layoutMod } = st.mods;
    const T = layoutMod.TURRET, TF = T.F64, TI = T.I32, sf = T.stride.f64, si = T.stride.i32;
    const n = v.head[layoutMod.HEAD.N_TURRETS] | 0;
    const f64 = v.turF64, i32 = v.turI32, dict = st.dict, rm = st.rm, map = st.turByEnt, pool = st.turPool;
    for (const arr of map.values()) arr.length = 0;
    for (let i = 0; i < n; i++) {
      const b = i * sf, bi = i * si;
      const s = i32[bi + TI.ENT_SLOT];
      const e = s >= 0 ? rm.entities[s] : null;
      if (!e || e.gen !== i32[bi + TI.ENT_GEN]) continue;
      let r = pool[i];
      if (!r) { r = pool[i] = { entity: null, key: undefined, uid: undefined, weaponId: undefined, fxKey: undefined, wx: 0, wy: 0, ang: 0, scale: 1, recoil: 0, shake: 0, spec: { r: 0 }, state: { housing: 0, barrel: 0, flash: 0 } }; }
      r.entity = e;
      r.key = dict.value(i32[bi + TI.KEY]); r.uid = dict.value(i32[bi + TI.UID]);
      r.weaponId = dict.value(i32[bi + TI.WEAPON]); r.fxKey = dict.value(i32[bi + TI.FX_KEY]);
      r.wx = f64[b + TF.WX]; r.wy = f64[b + TF.WY]; r.ang = f64[b + TF.ANG]; r.scale = f64[b + TF.SCALE];
      r.recoil = f64[b + TF.RECOIL]; r.shake = f64[b + TF.SHAKE]; r.spec.r = f64[b + TF.R];
      r.state.housing = f64[b + TF.HOUSING]; r.state.barrel = f64[b + TF.BARREL]; r.state.flash = f64[b + TF.FLASH];
      let arr = map.get(e);
      if (!arr) { arr = []; map.set(e, arr); }
      arr.push(r);
    }
    // lustra zwolnionych slotów: puste wpisy czyszczone hurtem
    if (map.size > 2 * rm.entities.length + 64) map.clear();
  }

  function setLayout(m) {
    const { layoutMod, tb } = st.mods;
    st.reader = new tb.TripleBufferReader(m.buffer, { views: (buf, off) => layoutMod.createSnapshotViews(buf, off, m.layout) });
    st.pendingK = -1;
  }

  function applyFrameMsg(m) {
    // opóźnienie wiadomości (RW-45b): znacznik wysyłki strony w ms epoki (timeOrigin + now, jak WALL_* w RET)
    if (m.tSend > 0) { st.msgLagSum += performance.timeOrigin + performance.now() - m.tSend; st.msgN++; }
    if (m.dev) devOps(m.dev);
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
    if (m.evFrame > st.evFrame) st.evFrame = m.evFrame;
    st.skyZone = m.skyZone;
    st.bayMsg = m.bay || null;
    if (m.belt) st.beltFrame = m.belt;
    if (m.mine && st.mineRep && st.mineMods) st.mineMods.sync.applyMiningFrame(m.mine, st.mineRep, st.mineMods.RockBody);
    if (m.fog) {
      const fw = st.fog || (st.fog = { on: false, time: 0, count: 0, circles: new Float64Array(0), massCount: 0, masses: new Float64Array(0), look: null });
      fw.on = m.fog.on; fw.time = m.fog.time; fw.count = m.fog.count; fw.massCount = m.fog.massCount; fw.look = m.fog.look;
      fw.circles = m.fog.circles; fw.masses = m.fog.masses;
      if (st.Core3D && st.Core3D.fogOfWar !== fw) st.Core3D.setFogOfWar(fw);
    }
    if (m.weaponDefs) for (let i = 0; i < m.weaponDefs.length; i += 2) st.weaponDefs.set(m.weaponDefs[i], m.weaponDefs[i + 1]);
    st.dustOn = m.dust !== false;
    if (m.ringQuality) st.ringQuality = m.ringQuality;
    if (m.k > st.lastMsgK) { st.lastMsgK = m.k; st.pageEv[m.k & 63] = m.evFrame; }
    // RW-45b: wiadomość strony k przyszła — render od razu, bez czekania na takt rAF
    if (st.renderMode === 'msg' && st.Core3D && st.reader) tryRender(true);
  }

  function frame() {
    requestAnimationFrame(frame);
    st.ticks++;
    tryRender(false);
  }

  // Render strony, gdy jest i strona, i jej wiadomość (opisy, zasoby, słownik idą wiadomością PO publikacji).
  // Tryb `msg` (RW-45b, 2026-10-16): woła to także odbiór wiadomości `frame` — worker nie czeka na następny takt rAF,
  // a strona odebrana z potrójnego bufora czeka na swoją wiadomość (nie jest porzucana na rzecz nowszej). Dawniej render
  // szedł tylko w takcie rAF i takt brał zawsze najnowszą stronę: przy stronie szybszej od taktu (harness bez limitu
  // klatek — ~500 kl/s przy zoomie 0,45) wiadomość najnowszej strony prawie zawsze była jeszcze w drodze, więc takt
  // porzucał stronę, na którą czekał, i czekał na kolejną — worker z CPU ~3 ms na klatkę stał bezczynny połowę czasu
  // (RW-45: 85–97 kl/s ↔ off 136; etap 4 na wolnej maszynie: 165–182 ↔ 200–217). Tryb `raf` zostaje do A/B.
  function tryRender(fromMsg) {
    const r = st.reader;
    if (!r) return false;
    const { layoutMod, retMod } = st.mods;
    const H = layoutMod.HEAD;
    if (st.pendingK < 0 || st.renderMode === 'raf') {
      if (r.acquire()) {
        if (st.pendingK >= 0) st.abandoned++;
        st.pendingK = r.page.head[H.K];
        retMod.retNoteConsumed(st.ret, st.pendingK);
      }
    }
    const f = st.ret.f64, R = retMod.RET_F64;
    if (st.pendingK < 0) return false;
    // strona czeka na wiadomość ze swoimi opisami (wiadomość idzie po publikacji)
    if (st.pendingK > st.lastMsgK) {
      if (!fromMsg) st.waits++;
      f[R.W_TICKS] = st.ticks; f[R.W_WAITS] = st.waits;
      return false;
    }
    const k = st.pendingK;
    st.pendingK = -1;
    st.inFrame = true;
    try {
      renderPage(r.page, k);
      st.rendered++;
      if (fromMsg) st.msgRenders++;
    } catch (e) {
      report(e, 'renderPage');
    } finally { st.inFrame = false; }
    f[R.W_TICKS] = st.ticks; f[R.W_WAITS] = st.waits; f[R.W_ABANDONED] = st.abandoned;
    f[R.W_RENDERED] = st.rendered; f[R.W_MSG_RENDERS] = st.msgRenders;
    f[R.W_MSG_LAG_SUM] = st.msgLagSum; f[R.W_MSG_N] = st.msgN;
    return true;
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
    const tPage = performance.now();
    const rm = st.rm;
    try {
      rm.apply(v);
      cloak.applyCloakBlock(v.blocks.cloak, (slot, gen) => { const e = rm.entities[slot]; return e && e.gen === gen ? e : null; },
        rm.lists[L.RENDER], st.dict, st.cloak);
    } catch (e) { modFail('lustra', e); }
    st.players.ship = rm.player;
    st.players.player2Ship = rm.player2;
    {
      const W0 = v.world, ho = st.hyperObj;
      const hs = W0[WD.HYPER_STATE];
      ho.state = hs >= 0 ? st.dict.value(hs) : 'idle';
      ho.charge = W0[WD.HYPER_CHARGE]; ho.chargeTime = W0[WD.HYPER_CHARGE_TIME];
      ho.speed = W0[WD.HYPER_SPEED]; ho.vmax = W0[WD.HYPER_VMAX]; ho.dir = W0[WD.HYPER_DIR];
      st.players.hyper = ho;
    }
    {
      const ix = h[H.INTERP_X], iy = h[H.INTERP_Y], ia = h[H.INTERP_ANGLE];
      if (ix === ix && iy === iy && ia === ia) {
        const ip = st.interpPose;
        ip.x = ix; ip.y = iy; ip.angle = ia;
        st.players.playerPose = ip;
      } else st.players.playerPose = null;
    }
    // zegary gry tej strony (efekty niesione nośnikiem, smugi pocisków)
    const SC = st.mods.clock.SimClock;
    SC.sim = h[H.SIM]; SC.render = h[H.SIM_RENDER]; SC.renderSim = h[H.SIM_RENDER_SIM];
    st.curFrame = h[H.FRAME_ID];
    // zegar efektów Core3D.fx = czas strony tej klatki (strona pod harnessem: czas wirtualny — te same fazy efektów)
    if (Number.isFinite(h[H.WALL])) st.Core3D.fxNowMs = h[H.WALL];
    try {
      if (v.blocks.view && v.blocks.view.f64) st.mods.viewBlock.applyViewBlock(v.blocks.view, (slot, gen) => { const e = rm.entities[slot]; return e && e.gen === gen ? e : null; }, st.curFrame);
    } catch (e) { modFail('widok', e); }
    try { applyShots(v); } catch (e) { modFail('pociski', e); }
    try { applyTurrets(v); } catch (e) { modFail('wieże', e); }
    try {
      if (v.blocks.rockets && v.blocks.rockets.f64) {
        st.mods.rktBlock.applyRocketBlock(v.blocks.rockets, st.dict, st.rockets,
          (slot, gen) => { const e = rm.entities[slot]; return e && e.gen === gen ? e : null; }, (id) => st.weaponDefs.get(id));
      }
    } catch (e) { modFail('rakiety', e); }
    try {
      if (v.blocks.hazards && v.blocks.hazards.f64) {
        st.hazMods.blk.applyHazardBlock(v.blocks.hazards, (slot, gen) => { const e = rm.entities[slot]; return e && e.gen === gen ? e : null; }, st.hazards);
      }
    } catch (e) { modFail('rdzenie', e); }
    try {
      if (v.blocks.repair && v.blocks.repair.f64) {
        st.repairMods.blk.applyRepairBlock(v.blocks.repair, (slot, gen) => { const e = rm.entities[slot]; return e && e.gen === gen ? e : null; }, st.repairMirror);
      }
    } catch (e) { modFail('drony', e); }
    // rozkazy klatek ≤ tej strony (pominięte strony też — efekty się sumują)
    if (st.cmd) { try { const ev = st.pageEv[k & 63]; st.cmd.drain(ev >= 0 ? ev : st.evFrame); } catch (e) { modFail('rozkazy', e); } }
    // przeszkody gazu wybuchów tej strony (hale K-7, budowle misji, kadłuby przy domenach) — krok efektów czyta je
    // w renderSingle; bez tego dym w workerze przenikał kadłuby i hale (strona woła setObstacleInput na swoim reżyserze)
    try { const ex = globalThis.__explosions; if (ex && st.gasObstBlk) ex.setObstacleInput(st.gasObstBlk.gasObstInputOf(v)); } catch (e) { modFail('przeszkody gazu', e); }
    const cam = st.cam;
    cam.x = h[H.CAM_X]; cam.y = h[H.CAM_Y]; cam.zoom = h[H.CAM_ZOOM]; cam.roll = h[H.CAM_ROLL] || 0;   // obrót kadru (hipercruise — viewRoll.js)
    const c = st.cull;
    c.x = h[H.CULL_X]; c.y = h[H.CULL_Y]; c.halfW = h[H.CULL_HALF_W]; c.halfH = h[H.CULL_HALF_H];
    c.drawHalfW = h[H.CULL_DRAW_HALF_W]; c.drawHalfH = h[H.CULL_DRAW_HALF_H];
    const paused = (h[H.FLAGS] & layoutMod.HEAD_FLAG.PAUSED) !== 0;
    // podzielony ekran: kamera gracza 2 z HEAD (RenderWorld.camera2 / splitScreenMode — globale realmu workera)
    const split = (h[H.FLAGS] & layoutMod.HEAD_FLAG.SPLIT) !== 0 && h[H.CAM2_ON] === 1;
    globalThis.splitScreenMode = split;
    if (split) {
      const c2 = st.cam2 || (st.cam2 = { x: 0, y: 0, zoom: 1 });
      c2.x = h[H.CAM2_X]; c2.y = h[H.CAM2_Y]; c2.zoom = h[H.CAM2_ZOOM];
      globalThis.camera2 = c2;
    } else globalThis.camera2 = null;
    const dt = paused ? 0 : h[H.FRAME_DT];
    const t0 = performance.now();
    Core3D.syncCamera(cam);
    // moduły po kolei, każdy osobno osłonięty (modFail — moduł z błędem pominięty w tej klatce, obraz idzie dalej)
    // warp „Nurt” przed planetami (soczewka świata w skoku): stan warpa gracza z WORLD, ruch warpa NPC z bloku `warp`
    try { if (v.blocks.warp && v.blocks.warp.f64) {
      const { warpMod, warpBlock } = st.mods;
      const mir = warpBlock.applyWarpBlock(v.blocks.warp, st.dict, st.warpMirror);
      const W0 = v.world, wo = st.warpObj;
      wo.state = st.dict.value(W0[WD.WARP_STATE]); wo.charge = W0[WD.WARP_CHARGE]; wo.chargeTime = W0[WD.WARP_CHARGE_TIME];
      wo.gear = W0[WD.WARP_GEAR]; wo.dir = W0[WD.WARP_DIR]; wo.flybyFactor = W0[WD.WARP_FLYBY];
      wo.cruise = W0[WD.WARP_CRUISE]; wo.speed = W0[WD.WARP_SPEED];
      const ra = W0[WD.WARP_EXIT_ACTIVE];
      if (ra < 0) wo.exitRamp = null;
      else { const r = st.warpRamp; r.active = ra === 1; r.age = W0[WD.WARP_EXIT_AGE]; r.tBrake = W0[WD.WARP_EXIT_TBRAKE]; wo.exitRamp = r; }
      const cns = st.camNs || (st.camNs = { x: 0, y: 0, zoom: 1 });
      cns.x = h[H.CAMNS_X]; cns.y = h[H.CAMNS_Y]; cns.zoom = h[H.CAMNS_ZOOM]; cns.roll = h[H.CAMNS_ROLL] || 0;
      const wf = st.warpFrame;
      wf.dt = Number.isFinite(mir.frame.dt) ? mir.frame.dt : dt; wf.cam = cns; wf.camShake = cam; wf.camFollow = mir.frame.camFollow;
      wf.ship = rm.player; wf.trafficTime = mir.frame.trafficTime; wf.lensAllowed = mir.frame.lensAllowed;
      warpMod.WarpNurt.update(wf);
    } } catch (e) { modFail('warp', e); }
    try { if (st.planets && globalThis.updatePlanets3D) {
      const cns = st.camNs || (st.camNs = { x: 0, y: 0, zoom: 1 });
      cns.x = h[H.CAMNS_X]; cns.y = h[H.CAMNS_Y]; cns.zoom = h[H.CAMNS_ZOOM]; cns.roll = h[H.CAMNS_ROLL] || 0;
      if (globalThis.setSkyZone) globalThis.setSkyZone(st.skyZone || null);
      globalThis.updatePlanets3D(h[H.FRAME_DT], cns);
    } } catch (e) { modFail('planety', e); }
    try { if (st.haloRings && v.blocks.ring && v.blocks.ring.f64) {
      const mir = st.mods.ringBlockMod.applyRingBlock(v.blocks.ring, st.dict, st.ringMirror);
      const w = st.haloWorld;
      if (Number.isFinite(mir.clock)) w.clock = mir.clock;
      for (const e of w.entries) {
        const r = mir.entries[e.key];
        const halls = e.collider.registry && e.collider.registry.halls;
        if (!r || !halls) continue;
        for (let i = 0; i < halls.length && i < r.halls.length; i++) {
          const dst = halls[i], src = r.halls[i];
          if (Number.isFinite(src.berthVersion)) dst.berthVersion = src.berthVersion;
          if (Number.isFinite(src.lampLevel)) dst.lampLevel = src.lampLevel;
          const db = dst.layout && dst.layout.berths;
          if (db) for (let j = 0; j < db.length && j < src.berths.length; j++) { db[j].occupied = src.berths[j].occupied; db[j].reserved = src.berths[j].reserved; }
          if (src.poses) dst.poses = src.poses;
        }
      }
      st.haloRings.hallRoofOverride = mir.roof;
      const frozen = (h[H.FLAGS] & layoutMod.HEAD_FLAG.WORLD_FROZEN) !== 0;
      st.haloRings.update(h[H.FRAME_DT], cam, { sun: st.sun, ship: rm.player, gameDt: frozen ? 0 : dt, quality: st.ringQuality || 'high', splitScreen: false });
    } } catch (e) { modFail('ringi', e); }
    try { if (st.cometsView) {
      const tr = h[H.SIM_RENDER];
      st.cometField.update(tr);
      st.cometsView.update(tr, cam, null);
    } } catch (e) { modFail('komety', e); }
    try { if (st.belt && st.beltFrame) {
      const w = st.beltWorld; w.time = st.beltFrame.time; w.frameDt = st.beltFrame.dt;
      st.belt.prepareFrame(w.time, w.frameDt, rm.player, null, rm.lists[L.NPCS_SEEN]);
    } } catch (e) { modFail('pas', e); }
    // pył hal K-7: wejście klatki = blok HALL (kopia HALL_DUST_IN strony); krok Core3D.fx czyta tylko tę tablicę
    try { if (st.hallDust && v.hall) st.hallDust.submit(v.hall); } catch (e) { modFail('pył hal', e); }
    // gaz przestrzeni: wejście = blok `spaceGas` (kopia SPACE_GAS_IN strony), kadłuby z bloku `gasObst`
    try { if (st.spaceGas) {
      const sg = st.spaceGasBlk.spaceGasInputOf(v);
      if (sg) { st.spaceGas.setObstacleInput(st.gasObstBlk.gasObstInputOf(v)); st.spaceGas.submit(sg); }
    } } catch (e) { modFail('gaz przestrzeni', e); }
    try { if (st.dust) {
      const cns = st.camNs || (st.camNs = { x: h[H.CAMNS_X], y: h[H.CAMNS_Y], zoom: h[H.CAMNS_ZOOM], roll: h[H.CAMNS_ROLL] || 0 });
      st.dust.frame(dt, cns, null, st.dustOn !== false);
    } } catch (e) { modFail('pył', e); }
    try { stations.updateStations3D(rm.stations); } catch (e) { modFail('stacje', e); }
    try {
      let ps = null;
      for (let i = 0; i < rm.stations.length; i++) if (rm.stations[i].world3dPirate) { ps = rm.stations[i]; break; }
      if (ps !== st.w3Station) {
        if (st.w3Station) st.w3.dettachPirateStation3D(null);
        st.w3Station = ps;
        if (ps) { st.w3.initWorld3D(); st.w3.attachPirateStation3D(null, ps); }
      }
      if (ps) st.w3.updateWorld3D(dt, h[H.VFX_TIME]);
    } catch (e) { modFail('stacja piracka', e); }
    try {
      const { bridge3d, bridgeFx, cloakLook } = st.mods;
      const nowSec = h[H.BRIDGE_TIME];
      if (!st.bridgeOpts) {
        // poza renderu gracza (st.playerPoseOf) — bez niej mostek gracza drżał na kadłubie w ruchu (2026-10-17)
        const poseOf = st.playerPoseOf;
        st.bridgeOpts = { nowSec: 0, dt: 0, zoom: 1, poseOf, cull: c, camera: cam,
          visibility: (e) => (models.shipModel3DIdFor(e) ? 0 : cloakLook.cloakLightGain(e)) };
        st.bridgeFxOpts = { nowSec: 0, dt: 0, zoom: 1, poseOf, visibility: cloakLook.cloakLightGain };
      }
      const bo = st.bridgeOpts, fo = st.bridgeFxOpts;
      bo.nowSec = fo.nowSec = nowSec; bo.dt = fo.dt = dt; bo.zoom = fo.zoom = cam.zoom;
      const list = rm.lists[L.SEEN_COLD];
      try { bridge3d.Bridge3D.update(list, bo); } catch (e) { modFail('mostki 3D', e); }
      bridgeFx.BridgeFx3D.update(list, fo);
    } catch (e) { modFail('okna mostków', e); }
    try { if (st.destruction) st.destruction.update(h[H.VFX_TIME], h[H.FRAME_DT]); } catch (e) { modFail('rozpad stacji', e); }
    try { if (st.pbg && v.blocks.pirateBase && v.blocks.pirateBase.f64) {
      const pm = st.pbMods.blk.applyPirateBaseBlock(v.blocks.pirateBase, st.pbMirror);
      if (pm.present) st.pbg.updatePirateBase3D(pm.dt, pm.state);
    } } catch (e) { modFail('baza piratów', e); }
    try { if (st.bay) {
      const pl = rm.player, bm = st.bayMsg, bp = st.bayPose;
      if (pl) { bp.x = pl.pos ? pl.pos.x : pl.x; bp.y = pl.pos ? pl.pos.y : pl.y; bp.angle = pl.angle || 0; }
      st.bay.sync(pl, pl ? bp : null, bm ? bm.door : 0, st.sun, !bm || bm.hidden, h[H.VFX_TIME]);
    } } catch (e) { modFail('luk', e); }
    // doki portów bez ringu (E14): budowle w zasięgu kadru (słońce z RenderWorld.sun)
    try {
      const pd = st.portDockMods;
      if (pd && v.blocks.portDocks) {
        const list = pd.blk.applyPortDockBlock(v.blocks.portDocks, st.portDockList);
        pd.mod.updatePortDocks3D(list, list.length, dt);
      }
    } catch (e) { modFail('doki portów', e); }
    // przeładunek (E12): po luku Atlasa (rekord 0 tablicy ładowni), przed proxy — dziury w lukach otwartych ładowni
    try {
      const cblk = v.blocks.cargoOps;
      if (cblk && cblk.f64 && st.cargoMods) {
        const fr = st.cargoMods.blk.applyCargoOpsBlock(cblk, st.cargoFrame);
        if (!st.portCargo && (fr.yardCount || fr.opCount || fr.player)) st.portCargo = st.cargoMods.shared();
        if (st.portCargo) st.portCargo.update(fr, cam, st.sun, h[H.VFX_TIME], st.Core3D.width || 1920, st.Core3D.height || 1080);
      }
    } catch (e) { modFail('przeładunek', e); }
    // statki ruchu v2 (E6): proxy przed kadłubami — dysze proxy wchodzą do listy kadłubów (EngineVfxSystem)
    let hexList = rm.lists[L.RENDER];
    try {
      const tm = st.trafficMods, blk = v.blocks.traffic;
      const list = tm.blk.applyTrafficBlock(blk, st.trafficList);
      tm.proxy.drawList(cam, list, list.length, null);
      const engines = tm.proxy.engineEntities;
      if (engines.length) {
        const out = st.hexList;
        out.length = 0;
        for (let i = 0; i < hexList.length; i++) out.push(hexList[i]);
        for (let i = 0; i < engines.length; i++) out.push(engines[i]);
        hexList = out;
      }
    } catch (e) { modFail('statki ruchu', e); }
    try { hex.updateHexShips3D(cam, hexList, c, rm.lists[L.COLD], st.cloak.frame); } catch (e) { modFail('kadłuby', e); }
    // wyrwy bazy piratów (po kadłubach — bank Fx3D ma początek układu tej klatki)
    try { if (st.vents && v.blocks.pirateVents && v.blocks.pirateVents.f64) {
      const vm = st.ventsBlk.applyPirateVentsBlock(v.blocks.pirateVents, st.ventsMirror);
      st.vents.update(vm, vm.has ? vm.dt : 0);
    } } catch (e) { modFail('wyrwy bazy', e); }
    try { if (st.warBd && v.blocks.warBackdrop && v.blocks.warBackdrop.f64) {
      st.warBd.update(st.warBdBlk.applyWarBackdropBlock(v.blocks.warBackdrop, st.warBdMirror), cam);
    } } catch (e) { modFail('bitwa w głębi', e); }
    try { if (syncWorldBodiesReplica(v, rm, L)) st.wbMods.w3d.syncWorldBodies3D(); } catch (e) { modFail('ciała świata', e); }
    if (!st.turrets) st.turrets = { recordsFor: (e) => { const a = st.turByEnt.get(e); return a && a.length ? a : null; } };
    try { models.syncShipModels3D({ entities: rm.lists[L.SEEN_COLD], poseOf: st.playerPoseOf, turrets: st.turrets, inView: null, zoom: cam.zoom, zoomAt: null, dt }); } catch (e) { modFail('modele 3D', e); }
    try { const rs = st.repairSync; rs.dt = dt; rs.zoom = cam.zoom; rs.time = h[H.SIM_RENDER]; st.repairMods.drones.syncRepairDrones3D(rs); } catch (e) { modFail('drony 3D', e); }
    // poza renderu gracza (jak strona: window.__interpShipPose) — bez niej tarcza gracza drżała w ruchu
    try { shields.updateShields3D(dt, rm.lists[L.SEEN], st.players.playerPose); } catch (e) { modFail('tarcze', e); }
    try { if (st.reactorFx) {
      const simNow = h[H.SIM];
      const rdt = Math.max(0, Math.min(0.1, simNow - (st.reactorSim || simNow)));
      st.reactorSim = simNow;
      st.reactorFx.advance(rdt);
      st.reactorFx.syncCores(rm.cores, rdt);
      st.reactorFx.syncHazards(rdt);
      if (st.reactorModel) {
        st.reactorModelOpts.origin.x = cam.x; st.reactorModelOpts.origin.y = cam.y;
        st.reactorModelOpts.zoom = cam.zoom;
        st.reactorModel.sync(rm.cores, 0, rdt, st.reactorModelOpts);
      }
    } } catch (e) { modFail('reaktory', e); }
    // Klatka zero (pierwsza strona gry, pod kurtyną ładowania): to, co po aktualizacji modułów WIDAĆ w passach, kompiluje
    // się w tle przed rysunkiem (Core3D.prewarmVisibleNow) — rysunki z pipeline'em w budowie Core3D pomija. Kolejka
    // rozgrzewki nie musi zdążyć przed tą klatką (strona czeka na `prepare` z limitem, flush ma limit 4 s).
    if (st.firstPageWarm) {
      st.firstPageWarm = false;
      try { Core3D.prewarmVisibleNow(); } catch (e) { modFail('rozgrzewka klatki zero', e); }
    }
    const t1 = performance.now();
    let bmp = null;
    try { if ((h[H.FLAGS] & layoutMod.HEAD_FLAG.SKIP_WORLD_3D) !== 0) {
      // CIC zakrywa ekran — bez renderu świata (pusta klatka dla pary z nakładkami)
      const e = st.empty || (st.empty = new OffscreenCanvas(1, 1));
      e.getContext('2d');
      bmp = e.transferToImageBitmap();
      Core3D.beginHeatHazeFrame();
    } else if (split) {
      // dwa widoki i środkowe połowy kadrów (jak drawHexShips3D na stronie)
      const src = st.canvas;
      const comp = st.comp || (st.comp = new OffscreenCanvas(src.width, src.height));
      if (comp.width !== src.width || comp.height !== src.height) { comp.width = src.width; comp.height = src.height; }
      const cx = st.compCtx || (st.compCtx = comp.getContext('2d'));
      const sw = src.width, sh = src.height, half = Math.floor(sw / 2), cropX = Math.floor(sw / 4), cropW = Math.floor(sw / 2);
      cx.clearRect(0, 0, sw, sh);
      Core3D.renderSingle(Core3D.activeCam1);
      cx.drawImage(src, cropX, 0, cropW, sh, 0, 0, half, sh);
      Core3D.renderSingle(Core3D.activeCam2);
      cx.drawImage(src, cropX, 0, cropW, sh, half, 0, sw - half, sh);
      bmp = comp.transferToImageBitmap();
    } else {
      Core3D.renderSingle(cam);
      bmp = st.canvas.transferToImageBitmap();
    } } catch (e) { modFail('render', e); }
    // bez bitmapy (wyjątek renderu) — to, co jest na kanwie: strona dostaje parę do nakładek tej klatki i idzie dalej
    if (!bmp) { try { bmp = st.canvas.transferToImageBitmap(); } catch (_) { const e1 = st.empty || (st.empty = new OffscreenCanvas(1, 1)); e1.getContext('2d'); bmp = e1.transferToImageBitmap(); } }
    const t2 = performance.now();
    // prostokąty domen gazu wybuchów (strona pakuje z nich przeszkody kadłubów — packGasObstacles, RW-41b)
    const ex = globalThis.__explosions;
    const dr = st.domRects || (st.domRects = new Float64Array(4 * 16));
    const nd = ex && typeof ex.domainRects === 'function' ? ex.domainRects(dr) : 0;
    st.drawnK = k;
    postMessage({ type: 'frame', k, bmp, nd, dr: nd ? dr.slice(0, nd * 4) : null }, [bmp]);
    retMod.retNoteRendered(st.ret, k);
    const f = st.ret.f64, R = retMod.RET_F64;
    f[R.CPU_UPDATE_MS] = t1 - t0;
    f[R.CPU_RENDER_MS] = t2 - t1;
    f[R.CPU_FRAME_MS] = performance.now() - t0;
    if (Number.isFinite(Core3D.gpuFrameMs)) f[R.GPU_FRAME_MS] = Core3D.gpuFrameMs;
    // pierścień czasów CAŁEJ klatki workera (lustra → bitmapa) dla narzędzi (A/B w bitwie — profil-bitwy-flot --wkAb)
    const ft = frameTimes;
    ft.ms[ft.n & 8191] = t2 - tPage; ft.n++;
    const gs = Core3D.gpuFrameSamples;
    if (gs !== gpuTimes.seen) { gpuTimes.seen = gs; if (Core3D.gpuFrameMs > 0) { gpuTimes.ms[gpuTimes.n & 4095] = Core3D.gpuFrameMs; gpuTimes.n++; } }
    st.frames++;
  }

  // Operacje narzędzi (RW-44, harness strony): ziarno generatora efektów, reset pul broni, kod w workerze (dev).
  function devOps(ops) {
    for (const op of ops) {
      try {
        if (op.seed !== undefined) {
          const fx = globalThis.fxRandom;
          if (fx && typeof fx.seed === 'function') fx.seed(op.seed >>> 0);
          if (globalThis.Fx3D && typeof globalThis.Fx3D.time === 'number') globalThis.Fx3D.time = 0;
        }
        if (op.wfxReset) globalThis.WeaponFx?.reset?.();
        if (op.eval) {
          st.devChain = (st.devChain || Promise.resolve()).then(async () => {
            const THREE = await import('three/webgpu');
            await new Function('Core3D', 'THREE', 'st', `return (async () => { ${op.eval} })();`)(st.Core3D, THREE, st);
          }).catch((e) => report(e, 'dev eval'));
        }
      } catch (e) { report(e, 'dev'); }
    }
  }

  // Ekran ładowania strony (RW-41): ringi przy punkcie startu zbudowane (wypiek map, bryły rozgrzane — hak prewarm)
  // i kolejka rozgrzewki workera dokończona, zanim strona zdejmie kurtynę — inaczej pierwsze sekundy gry worker
  // budował ring i kompilował pipeline'y w klatkach (200–400 ms na klatkę).
  // Tło menu (RW-41c): MenuBackdrop3D w workerze — ring Ziemi piecze się RAZ (menu, potem gra), jedno urządzenie GPU.
  // Pętla rAF tła rysuje sama (bez stron migawki) i oddaje bitmapę każdej klatki (`menuFrame`: poza kamery, słońce
  // tła, launchDone; `final` — ostatnia klatka lotu intro, strona robi z niej obraz przenikania). Sterowanie ze strony:
  // start / active / pointer / focus / launch / fly (plan lotu jako dane — introCamera.menuIntroFlight) / stop.
  async function menuOp(m) {
    const op = m.op;
    if (op === 'start') {
      if (st.tMenuMsg === undefined) st.tMenuMsg = performance.now() - st.t0;
      if (st.menu) return;
      if (!st.haloRings) { st.menuPending = m; return; }
      const mod = st.menuMod || (st.menuMod = await import('../3d/menuBackdrop3D.js'));
      const bd = new mod.MenuBackdrop3D({ haloRings: st.haloRings });
      st.menu = bd;
      bd.onRendered = () => {
        if (st.menu !== bd) return;
        const bmp = st.canvas.transferToImageBitmap();
        const fin = !!st.menuFinal;
        st.menuFinal = false;
        const s = bd.sunLocal;
        postMessage({ type: 'menuFrame', bmp, final: fin, launchDone: bd.launchDone, pose: bd.cameraPose(), sun: { az: s.az, el: s.el } }, [bmp]);
      };
      const tMenu = performance.now();
      bd.onReady(() => {
        st.menuReadyRes();
        let ring = null;
        try { ring = JSON.parse(JSON.stringify(bd.ring && bd.ring.stats || null)); } catch (_) { ring = null; }
        postMessage({ type: 'menuReady', stats: { ...bd.stats, startMs: tMenu - st.t0, readyMs: performance.now() - st.t0, gpuMs: st.tGpu - st.t0, planets: [st.tPlanets0, st.tPlanets1], menuMsg: st.tMenuMsg, ring } });
      });
      if (!bd.start()) { st.menu = null; st.menuReadyRes(); postMessage({ type: 'menuReady', failed: true }); return; }
      bd.setFocus(m.focus || 0);
      bd.setActive(!!m.active);
      return;
    }
    if (op === 'stop') { st.menuPending = null; st.menuReadyRes(); }
    else if (st.menuPending && op === 'active') st.menuPending.active = !!m.on;
    const bd = st.menu;
    if (!bd) return;
    if (op === 'active') bd.setActive(!!m.on);
    else if (op === 'pointer') bd.setPointer(m.x, m.y);
    else if (op === 'focus') bd.setFocus(m.k);
    else if (op === 'launch') bd.launch({ dolly: m.dolly !== false });
    else if (op === 'flightSet') { const f = bd.flight; if (f) { if ('devTime' in m) f.devTime = m.devTime; if ('t' in m) f.t = m.t; } }
    else if (op === 'fly') {
      const intro = st.introMod || (st.introMod = await import('../game/story/introCamera.js'));
      const plan = intro.menuIntroFlight(m.data);
      const rings = st.haloRings;
      bd.fly({
        duration: plan.duration, sample: plan.sample, sun: plan.sun, gameView: plan.gameView,
        onFrame: (w) => rings && rings.showcaseHallCut && rings.showcaseHallCut('earth', 0, plan.cut(w)),
        onFinish: () => { st.menuFinal = true; }
      }).then((ok) => postMessage({ type: 'menuFlown', id: m.id, ok }));
    } else if (op === 'stop') {
      st.menu = null;
      st.menuReadyRes();
      bd.stop();
    }
  }

  // Przygotowania po kolei (jedno na raz). `idle` (strona przy starcie, RW-41c): dopiero gdy worker skończy init (efekty)
  // i bank pasa — w menu, w wolnym czasie; „Start” w trakcie ustawia się za nim i dostaje gotową scenę.
  function runPrepare(m) {
    const run = async () => {
      if (m.idle) await st.liveP;
      return prepareScene(m);
    };
    const p = (st.prepChain || Promise.resolve()).then(run, run);
    st.prepChain = p.catch(() => {});
    return p;
  }

  async function prepareScene(m) {
    const t0 = performance.now();
    if (st.gamePrewarm) st.gamePrewarm();
    const waits = [];
    if (st.haloRings) {
      st.haloRings.syncEntries?.();
      for (const e of st.haloRings.entries || []) {
        const p = e.planet;
        if (!p || Math.hypot((p.x || 0) - m.x, (p.y || 0) - m.y) > 420000) continue;
        const ring = e.ring || st.haloRings.showcaseRing(e.key);
        // ringi-archetypy budują się krokami w klatkach (pumpBuild w update) — tu krokami między zadaniami
        if (ring && ring.pumpBuild) waits.push((async () => { while (ring.pumpBuild()) await new Promise((r) => setTimeout(r, 4)); })());
        if (ring && ring.ready) waits.push(Promise.resolve(ring.ready));
      }
    }
    const limit = (ms) => new Promise((r) => setTimeout(() => r(false), ms));
    if (waits.length) await Promise.race([Promise.all(waits), limit(m.ringMs || 20000)]);
    const tRing = performance.now();
    if (m.afterFrame) {
      // klatka zero strony (pod kurtyną ładowania): lustra kadłubów i obiekty gry są w scenie — passy Core3D jeszcze raz
      // z tym, co w niej jest (jak flush strony w trybie off: wpisy „start gry” ruszyły przy starcie workera, przed grą)
      // strona k (klatka zero) narysowana — worker rysuje stronę zaraz po jej wiadomości (RW-45b), więc zwykle już jest
      // (dawne „następna klatka po wiadomości” czekało na stronę, której strona nie wyśle — ~5 s limitu pętli, RW-41c)
      const f0 = st.frames;
      for (let i = 0; i < 300 && (m.k >= 0 ? !((st.drawnK ?? -1) >= m.k) : st.frames <= f0); i++) await new Promise((r) => setTimeout(r, 16));
      st.tFrame0 = performance.now() - t0;
      const C = st.Core3D, scene = C.scene, w = C.warmup, jobs = [];
      for (const layer of [0, 7, 2, 1, 3, 5, 6]) jobs.push(w.now(scene, { layer, visible: false }));
      for (const layer of [0, 7, 2]) jobs.push(w.now(scene, { layer, visible: false, ortho: false }));
      await Promise.race([Promise.all(jobs), limit(6000)]);
      st.tPasses = performance.now() - t0;
      // szablony modeli stacji (lustra stacji już są): wczytanie, wypiek rozpadu, pass FG i cień — pod kurtyną; bryły
      // stacji powstają leniwie w updateStations3D (strona w trybie worker nie woła prepareStations3D)
      try { await st.mods.stations.warmStationTemplates3D(st.rm.stations, { timeoutMs: 8000 }); } catch (e) { console.warn('[render.worker] stacje:', e); }
      st.tStations = performance.now() - t0;
    }
    const tF = performance.now();
    await Promise.race([st.Core3D.warmup.flush({ timeoutMs: 4000 }), limit(6000)]);
    console.log(`[render.worker] przygotowanie (afterFrame ${!!m.afterFrame}): od init ${Math.round(t0 - st.t0)} ms, klatka 0 po ${Math.round(st.tFrame0 || 0)} ms, passy do ${Math.round(st.tPasses || 0)} ms, stacje do ${Math.round(st.tStations || 0)} ms, flush ${Math.round(performance.now() - tF)} ms`);
    st.ret && st.mods && st.mods.retMod.retSetFlag(st.ret, st.mods.retMod.RET_FLAG.WARM_FLUSHED);
    console.log(`[render.worker] przygotowanie sceny: ringi ${waits.length} ${Math.round(tRing - t0)} ms, rozgrzewka ${Math.round(performance.now() - tRing)} ms`);
    return true;
  }

  // wiadomości przed końcem init (moduły ładują się asynchronicznie) — w kolejce, w kolejności
  const early = [];
  const handle = (m) => {
    try {
      if (m.type === 'layout') setLayout(m);
      else if (m.type === 'frame') applyFrameMsg(m);
      else if (m.type === 'cmdRing') setCmdRing(m);
      else if (m.type === 'planets') setPlanets(m);
      else if (m.type === 'comets') setComets(m);
      else if (m.type === 'belt') st.beltChain = setBelt(m);
      else if (m.type === 'beltOp') { (st.beltOps || (st.beltOps = [])).push([m.op, m.arg]); if (st.beltSubs) for (const f of st.beltSubs) f(m.op, m.arg); }
      else if (m.type === 'beltOcc') { st.beltSectors = m.sectors; if (st.beltWorld) { st.beltWorld.sectors = m.sectors; for (const f of st.beltOccSubs) f(m.sectors); } }
      else if (m.type === 'beltGiant') addGiant(m);
      else if (m.type === 'pbase') st.pbChain = (st.pbChain || Promise.resolve()).then(() => pirateBaseEvent(m));
      else if (m.type === 'menu') st.menuChain = (st.menuChain || Promise.resolve()).then(() => menuOp(m)).catch((err) => report(err, 'menu'));
      else if (m.type === 'prepare') runPrepare(m).then((ok) => postMessage({ type: 'prepared', id: m.id, ok }), (err) => { report(err, 'prepare'); postMessage({ type: 'prepared', id: m.id, ok: false }); });
    } catch (err) {
      report(err, m && m.type);
    }
  };
  self.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'init') {
      init(m).then(() => { for (const q of early) handle(q); early.length = 0; st.live = true; st.liveRes(); },
        (err) => { report(err, 'init'); postMessage({ type: 'ready', ok: false, why: String(err?.message || err) }); });
      return;
    }
    // planety (ringi) i tło menu od razu, gdy moduły są już wczytane — menu nie czeka na resztę init (RW-41c)
    if (!st.live && st.mods && (m.type === 'planets' || m.type === 'menu')) { handle(m); return; }
    // pas (bank skał) i przygotowanie sceny przy „Start” — po gotowym GPU, nie po całym init (efekty idą w porcjach
    // po gotowości tła menu; kliknięcie w trakcie nie czeka na nie z pieczeniem pasa)
    if (!st.live && st.tGpu && (m.type === 'belt' || m.type === 'beltOp' || m.type === 'beltOcc' || m.type === 'beltGiant' ||
      (m.type === 'prepare' && !m.afterFrame))) { handle(m); return; }
    if (!st.live) { early.push(m); return; }
    handle(m);
  };
}
