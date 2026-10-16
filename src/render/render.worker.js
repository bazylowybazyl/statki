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
  'wydobycie skał (siatki ciał, platforma — RW-41b cz. 2)',
  'tło menu'
]);

const isWorker = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope;

if (isWorker) {
  const st = {
    Core3D: null, mods: null, rm: null, cloak: null, players: null, reader: null, ret: null,
    canvas: null, W: 0, H: 0, dpr: 1, lastMsgK: -1, pendingK: -1,
    descriptors: [], topologies: [], coreDescs: new Map(), stationDescs: [], resources: [],
    dict: { values: [], value(c) { return c >= 0 ? this.values[c] : undefined; } },
    cam: { x: 0, y: 0, zoom: 1 }, cull: { x: 0, y: 0, halfW: 0, halfH: 0, drawHalfW: 0, drawHalfH: 0 },
    sun: { x: 0, y: 0, r: 0 }, frames: 0, errors: 0,
    // strumień rozkazów (RW-40b): czytelnik pierścienia strony, pociski-lustra po slocie (SHOTS)
    cmd: null, cmdBuf: null, evFrame: -1, pageEv: new Float64Array(64).fill(-1), shots: [], shotList: [],
    // wieże 3D (blok TURRETS — rekordy Turret2D tej klatki po stronie gry, RW-26): lustro → rekordy
    turByEnt: new Map(), turPool: [], turrets: null
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
    // adresy zasobów względne do STRONY (assets/…), nie do skryptu workera — fetch i loadery three
    if (m.pageBase && !globalThis.__rwFetch) {
      const base = m.pageBase, f0 = globalThis.fetch.bind(globalThis);
      globalThis.__rwFetch = f0;
      globalThis.fetch = (input, init) => f0(typeof input === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(input) && !input.startsWith('/') ? new URL(input, base).href : input, init);
    }
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
    const [ringWorldMod, ringGameMod, ringBlockMod] = await Promise.all([
      import('../game/haloRingWorld.js'), import('../3d/haloRing/haloRingGame.js'), import('./blocks/ringBlock.js')
    ]);
    st.destruction = (await import('../vfx/destruction3D.js')).Destruction3D;
    globalThis.Destruction3D = st.destruction;   // RenderWorld.destruction3D (prebake brył: stacja piracka)
    const [bridge3d, bridgeFx, cloakLook, reactorFx] = await Promise.all([
      import('../3d/bridge3D.js'), import('../3d/bridgeFx3D.js'), import('../game/cloakLook.js'), import('../3d/reactorBlast/reactorBlastFx.js')
    ]);
    // planety, słońce, księżyce, małe ciała, mgławica i gwiazdy (API globalne: initPlanets3D / updatePlanets3D)
    await import('../3d/planet3d.assets.js');
    st.dust = (await import('../3d/dust/spaceDust3D.js')).SpaceDust3D;
    st.hallDust = (await import('../3d/gasField/hallDust.js')).HallDust;
    // drony naprawcze (blok `repair` + rekordy REPAIR_FX po id rigu)
    st.repairMods = { blk: await import('./blocks/repairBlock.js'), drones: await import('../3d/repair/repairDrones3D.js') };
    st.repairMirror = { rigs: [], out: 0, _rigs: new Map() };
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
    st.repairSync = { swarm: st.repairMirror, dt: 0, zoom: 1, time: 0, poseOf: null, hidden: (e) => !!(e && e.__mirror === true && e.fogHidden) };
    st.mods = { core, hex, models, shields, stations, mirror, layoutMod, tb, retMod: ret, cloak, cmdMod, wfxCmd, dmgCmd, blastCmd, clock, bridge3d, bridgeFx, cloakLook, rktBlock, rktCmd, viewBlock, ringWorldMod, ringGameMod, ringBlockMod, warpMod, warpCmd, warpBlock };
    st.warpMirror = warpBlock.createWarpMirror();
    st.warpObj = { state: undefined, charge: 0, chargeTime: 0, gear: 0, dir: 0, flybyFactor: 1, cruise: 0, speed: 0, exitRamp: null };
    st.warpRamp = { active: false, age: 0, tBrake: 0 };
    st.warpFrame = { dt: 0, cam: null, camShake: null, camFollow: false, ship: null, warp: st.warpObj, trafficTime: 0, lensAllowed: false };
    st.ringMirror = ringBlockMod.createRingMirror();
    st.rockets = rktBlock.createRocketMirror();
    st.weaponDefs = new Map();
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
    ret.retSetFlag(st.ret, ret.RET_FLAG.GPU_READY | ret.RET_FLAG.READY);
    try { hex.prewarmHexShips3D({ canvas: st.canvas }); } catch (e) { report(e, 'prewarmHexShips3D'); }
    // efekty ze strumienia rozkazów: iskry, rakiety (pule dymu — wybuchy), wybuchy WebGPU, efekty broni, mapa ran
    try {
      sparks.SparkSystem3D.init(Core3D.scene);
      const rocketFx = rktFx.createRocketFx(Core3D);
      st.rocketFx = rocketFx;
      if (rocketFx && rocketFx.smoke) st.hallDust.setVaporSmoke(rocketFx.smoke);
      if (rocketFx && typeof rocketFx.attachRockets === 'function') rocketFx.attachRockets(st.rockets.pool);
      wfx.WeaponFx.ensure();
      st.blastFactory = blastFx.createExplosionFactory(Core3D, { rocketFx, weaponFx: wfx.WeaponFx });
      // mostki (model 3D, okna, wyrzut atmosfery) i obraz rdzeni reaktora — na lustrach (RW-11b)
      bridgeFx.BridgeFx3D.attach(Core3D.scene, { weaponFx: wfx.WeaponFx });
      bridge3d.Bridge3D.attach(Core3D.scene);
      st.reactorFx = reactorFx.createReactorBlastFx(Core3D, { rocketFx, weaponFx: wfx.WeaponFx });
      const rc = st.hazMods.core;
      st.reactorModel = st.hazMods.model.createReactor3D({
        scene: Core3D.scene, markLayerActive: () => Core3D.setShieldLayerActive(true),
        colorFor: (core) => core.color || [0.3, 0.7, 1.0], frameOf: rc.reactorCoreFrame, hostReady: (h) => !!rc.reactorHull(h)
      });
      st.reactorModelOpts = { origin: { x: 0, y: 0 } };
      Core3D.warmup.add({ name: 'model reaktora (reactor3D)', layer: 7, phase: 'loading',
        objects: () => Object.values(st.reactorModel?.meshes || {}).flatMap((k) => [k.structure, k.plasma]).filter(Boolean) });
      st.dust.init();
      st.bay = st.bayMod.createScoutBay3D(Core3D, 'atlas');
      Core3D.warmup.add({ name: 'ładownia Atlasa (fregata zwiadu)', objects: () => st.bay.warmupMeshes(), phase: 'loading' });
      st.destruction.init({ scene: Core3D.scene, reactorFactory: st.blastFactory, shockwaveManager: null });
      warpMod.WarpNurt.init();
    } catch (e) { report(e, 'efekty'); }
    if (st.cmdBuf) makeReader(st.cmdBuf);
    try { shields.prewarmShields3D(); } catch (e) { report(e, 'prewarmShields3D'); }
    postMessage({ type: 'ready', ok: true });
    Core3D.warmup.flush().then(() => ret.retSetFlag(st.ret, ret.RET_FLAG.WARM_FLUSHED), (e) => report(e, 'warmup.flush'));
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
    wfxCmd.installWeaponFxCommands(st.cmd);
    dmgCmd.installHullDamageCommands(st.cmd);
    blastCmd.installExplosionCommands(st.cmd, () => st.blastFactory || null);
    st.mods.warpCmd.installWarpTrafficCommands(st.cmd, st.mods.warpMod.WarpNurt, (slot) => st.warpMirror.recordAt(slot));
    st.hazMods.cmd.installReactorCommands(st.cmd, () => st.reactorFx || null, (id) => st.hazards.byId.get(id) || null);
    st.repairMods.drones.installRepairFxCommands(st.cmd, (id) => st.repairMirror._rigs.get(id) || null);
    if (st.rocketFx && st.rocketFx.director) st.mods.rktCmd.installRocketFxCommands(st.cmd, st.rocketFx.director, (i) => st.rockets.pool[i] || null);
  }

  // Dane ciał ze strony: pierwsza wiadomość — initPlanets3D, kolejne — wartości w miejscu (encje czytają obiekty danych).
  function setPlanets(m) {
    if (!st.planets) {
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
      } catch (e) { report(e, 'ringi'); }
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
    try {
      const [{ AsteroidBeltField }, { GiantRock }, { createAsteroidBelt }] = await Promise.all([
        import('../game/asteroidBeltField.js'), import('../game/asteroidGiants.js'), import('../3d/asteroids/asteroidBelt.js')
      ]);
      st.GiantRock = GiantRock;
      const [r1, r2, r3, r4] = await Promise.all([import('../game/asteroidShapeRadius.js'), import('../game/asteroidMining.js'), import('../game/asteroidMiningRig.js'), import('../game/beltPlayZ.js')]);
      const mm = { ShapeRadius: r1.ShapeRadius, AsteroidMining: r2.AsteroidMining, MiningRig: r3.MiningRig, beltPlayZ: r4.beltPlayZ };
      const ops = st.beltOps || (st.beltOps = []);
      const subs = [], occSubs = [];
      const apply = (field, op, arg) => {
        if (op === 'exclusions') field.setExclusions(arg);
        else if (op === 'anchors') field.setSmallBodyAnchors(arg);
        else if (op === 'peaks') field.familyPeaks();
        else if (op === 'wake') field.wakeSpots.push(arg);
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
        // wydobycie w workerze (RW-41b cz. 2): dziś zastępcza fizyka i platforma bez stanu gry (warstwa skał wymaga
        // zbioru taken i ciał) — przejęte skały i ciała wydobycia z gry jeszcze nie przychodzą
        attachShapeRadius(data) {
          if (world.rig || !data || !data.maps) return world.rig;
          const shapes = new mm.ShapeRadius(data);
          world.mining = new mm.AsteroidMining({ radiusAt: shapes.radiusAt, seed: 0x51A7 });
          world.rig = new mm.MiningRig({ mining: world.mining, field: new AsteroidBeltField(m.fieldArgs), playZ: mm.beltPlayZ, sunT: () => 1, timeSource: () => world.time });
          return world.rig;
        }, ackMinedUpload() {}, roofAbove(x, y) { return giants.roofAbove(x, y); } };
      st.beltWorld = world; st.beltSubs = subs; st.beltOccSubs = occSubs;
      for (const g of st.pendingGiants || []) addGiant(g);
      const belt = createAsteroidBelt({ world });
      await belt.initGpu();
      st.belt = belt;
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
    // zegary gry tej strony (efekty niesione nośnikiem, smugi pocisków)
    const SC = st.mods.clock.SimClock;
    SC.sim = h[H.SIM]; SC.render = h[H.SIM_RENDER]; SC.renderSim = h[H.SIM_RENDER_SIM];
    st.curFrame = h[H.FRAME_ID];
    if (v.blocks.view && v.blocks.view.f64) st.mods.viewBlock.applyViewBlock(v.blocks.view, (slot, gen) => { const e = rm.entities[slot]; return e && e.gen === gen ? e : null; }, st.curFrame);
    applyShots(v);
    applyTurrets(v);
    if (v.blocks.rockets && v.blocks.rockets.f64) {
      st.mods.rktBlock.applyRocketBlock(v.blocks.rockets, st.dict, st.rockets,
        (slot, gen) => { const e = rm.entities[slot]; return e && e.gen === gen ? e : null; }, (id) => st.weaponDefs.get(id));
    }
    if (v.blocks.hazards && v.blocks.hazards.f64) {
      st.hazMods.blk.applyHazardBlock(v.blocks.hazards, (slot, gen) => { const e = rm.entities[slot]; return e && e.gen === gen ? e : null; }, st.hazards);
    }
    if (v.blocks.repair && v.blocks.repair.f64) {
      st.repairMods.blk.applyRepairBlock(v.blocks.repair, (slot, gen) => { const e = rm.entities[slot]; return e && e.gen === gen ? e : null; }, st.repairMirror);
    }
    // rozkazy klatek ≤ tej strony (pominięte strony też — efekty się sumują)
    if (st.cmd) { const ev = st.pageEv[k & 63]; st.cmd.drain(ev >= 0 ? ev : st.evFrame); }
    const cam = st.cam;
    cam.x = h[H.CAM_X]; cam.y = h[H.CAM_Y]; cam.zoom = h[H.CAM_ZOOM];
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
    // warp „Nurt” przed planetami (soczewka świata w skoku): stan warpa gracza z WORLD, ruch warpa NPC z bloku `warp`
    if (v.blocks.warp && v.blocks.warp.f64) {
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
      cns.x = h[H.CAMNS_X]; cns.y = h[H.CAMNS_Y]; cns.zoom = h[H.CAMNS_ZOOM];
      const wf = st.warpFrame;
      wf.dt = Number.isFinite(mir.frame.dt) ? mir.frame.dt : dt; wf.cam = cns; wf.camShake = cam; wf.camFollow = mir.frame.camFollow;
      wf.ship = rm.player; wf.trafficTime = mir.frame.trafficTime; wf.lensAllowed = mir.frame.lensAllowed;
      warpMod.WarpNurt.update(wf);
    }
    if (st.planets && globalThis.updatePlanets3D) {
      const cns = st.camNs || (st.camNs = { x: 0, y: 0, zoom: 1 });
      cns.x = h[H.CAMNS_X]; cns.y = h[H.CAMNS_Y]; cns.zoom = h[H.CAMNS_ZOOM];
      if (globalThis.setSkyZone) globalThis.setSkyZone(st.skyZone || null);
      globalThis.updatePlanets3D(h[H.FRAME_DT], cns);
    }
    if (st.haloRings && v.blocks.ring && v.blocks.ring.f64) {
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
    }
    if (st.cometsView) {
      const tr = h[H.SIM_RENDER];
      st.cometField.update(tr);
      st.cometsView.update(tr, cam, null);
    }
    if (st.belt && st.beltFrame) {
      const w = st.beltWorld; w.time = st.beltFrame.time; w.frameDt = st.beltFrame.dt;
      st.belt.prepareFrame(w.time, w.frameDt, rm.player, null, rm.lists[L.NPCS_SEEN]);
    }
    // pył hal K-7: wejście klatki = blok HALL (kopia HALL_DUST_IN strony); krok Core3D.fx czyta tylko tę tablicę
    if (st.hallDust && v.hall) st.hallDust.submit(v.hall);
    if (st.dust) {
      const cns = st.camNs || (st.camNs = { x: h[H.CAMNS_X], y: h[H.CAMNS_Y], zoom: h[H.CAMNS_ZOOM] });
      st.dust.frame(dt, cns, null, st.dustOn !== false);
    }
    stations.updateStations3D(rm.stations);
    {
      let ps = null;
      for (let i = 0; i < rm.stations.length; i++) if (rm.stations[i].world3dPirate) { ps = rm.stations[i]; break; }
      if (ps !== st.w3Station) {
        if (st.w3Station) st.w3.dettachPirateStation3D(null);
        st.w3Station = ps;
        if (ps) { st.w3.initWorld3D(); st.w3.attachPirateStation3D(null, ps); }
      }
      if (ps) st.w3.updateWorld3D(dt, h[H.VFX_TIME]);
    }
    {
      const { bridge3d, bridgeFx, cloakLook } = st.mods;
      const nowSec = h[H.BRIDGE_TIME];
      if (!st.bridgeOpts) {
        st.bridgeOpts = { nowSec: 0, dt: 0, zoom: 1, poseOf: null, cull: c, camera: cam,
          visibility: (e) => (models.shipModel3DIdFor(e) ? 0 : cloakLook.cloakLightGain(e)) };
        st.bridgeFxOpts = { nowSec: 0, dt: 0, zoom: 1, poseOf: null, visibility: cloakLook.cloakLightGain };
      }
      const bo = st.bridgeOpts, fo = st.bridgeFxOpts;
      bo.nowSec = fo.nowSec = nowSec; bo.dt = fo.dt = dt; bo.zoom = fo.zoom = cam.zoom;
      const list = rm.lists[L.SEEN_COLD];
      bridge3d.Bridge3D.update(list, bo);
      bridgeFx.BridgeFx3D.update(list, fo);
    }
    if (st.destruction) st.destruction.update(h[H.VFX_TIME], h[H.FRAME_DT]);
    if (st.pbg && v.blocks.pirateBase && v.blocks.pirateBase.f64) {
      const pm = st.pbMods.blk.applyPirateBaseBlock(v.blocks.pirateBase, st.pbMirror);
      if (pm.present) st.pbg.updatePirateBase3D(pm.dt, pm.state);
    }
    if (st.bay) {
      const pl = rm.player, bm = st.bayMsg, bp = st.bayPose;
      if (pl) { bp.x = pl.pos ? pl.pos.x : pl.x; bp.y = pl.pos ? pl.pos.y : pl.y; bp.angle = pl.angle || 0; }
      st.bay.sync(pl, pl ? bp : null, bm ? bm.door : 0, st.sun, !bm || bm.hidden, h[H.VFX_TIME]);
    }
    hex.updateHexShips3D(cam, rm.lists[L.RENDER], c, rm.lists[L.COLD], st.cloak.frame);
    if (syncWorldBodiesReplica(v, rm, L)) st.wbMods.w3d.syncWorldBodies3D();
    if (!st.turrets) st.turrets = { recordsFor: (e) => { const a = st.turByEnt.get(e); return a && a.length ? a : null; } };
    models.syncShipModels3D({ entities: rm.lists[L.SEEN_COLD], poseOf: null, turrets: st.turrets, inView: null, zoom: cam.zoom, zoomAt: null, dt });
    { const rs = st.repairSync; rs.dt = dt; rs.zoom = cam.zoom; rs.time = h[H.SIM_RENDER]; st.repairMods.drones.syncRepairDrones3D(rs); }
    shields.updateShields3D(dt, rm.lists[L.SEEN], null);
    if (st.reactorFx) {
      const simNow = h[H.SIM];
      const rdt = Math.max(0, Math.min(0.1, simNow - (st.reactorSim || simNow)));
      st.reactorSim = simNow;
      st.reactorFx.advance(rdt);
      st.reactorFx.syncCores(rm.cores, rdt);
      st.reactorFx.syncHazards(rdt);
      if (st.reactorModel) {
        st.reactorModelOpts.origin.x = cam.x; st.reactorModelOpts.origin.y = cam.y;
        st.reactorModel.sync(rm.cores, 0, rdt, st.reactorModelOpts);
      }
    }
    const t1 = performance.now();
    let bmp;
    if ((h[H.FLAGS] & layoutMod.HEAD_FLAG.SKIP_WORLD_3D) !== 0) {
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
    }
    const t2 = performance.now();
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
      else if (m.type === 'cmdRing') setCmdRing(m);
      else if (m.type === 'planets') setPlanets(m);
      else if (m.type === 'comets') setComets(m);
      else if (m.type === 'belt') st.beltChain = setBelt(m);
      else if (m.type === 'beltOp') { (st.beltOps || (st.beltOps = [])).push([m.op, m.arg]); if (st.beltSubs) for (const f of st.beltSubs) f(m.op, m.arg); }
      else if (m.type === 'beltOcc') { st.beltSectors = m.sectors; if (st.beltWorld) { st.beltWorld.sectors = m.sectors; for (const f of st.beltOccSubs) f(m.sectors); } }
      else if (m.type === 'beltGiant') addGiant(m);
      else if (m.type === 'pbase') st.pbChain = (st.pbChain || Promise.resolve()).then(() => pirateBaseEvent(m));
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
