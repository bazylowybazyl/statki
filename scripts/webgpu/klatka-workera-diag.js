// Diagnostyka składu klatki workera renderu (2026-11-02, klatka workera pod 240 Hz) — kod dla
// `profil-bitwy-flot.mjs --wkZdarzenia '30@plik:scripts/webgpu/klatka-workera-diag.js|90@plik:scripts/webgpu/klatka-workera-diag-odczyt.js'`.
// Od chwili instalacji liczy na klatkę (Core3D.renderSingle): rysunki three po nazwie obiektu / materiału, wywołania
// renderer.render po masce warstw i celu, renderer.compute (wywołania, kernele w listach), pieczenia cienia SDF
// (liczba, ms), czworokąty skór skopiowane do partii, encje pudła rozgrzania / rysowania (lodFrameStats), LOD dysz
// MAIN, dysze klatki (EngineFrame), światła siatki, lampy pozycyjne, strugi MAIN, dysze SIDE; co 120 klatek —
// obiekty sceny (wszystkie / widoczne / z matrixAutoUpdate). Klatki > 4 ms (cała klatka workera z __rwFrameTimes)
// zapisane z tym składem (szukanie przyczyn p95). Same liczniki — bez pomiaru czasu rysunków.
(async () => {
  if (globalThis.__skwd) return 'diag już działa';
  const [{ Core3D }, evs, ef, sdf, sl, hsb, me, sj] = await Promise.all([
    import('/src/3d/core3d.js'), import('/src/3d/engineVfxSystem.js'), import('/src/3d/engineFrame.js'),
    import('/src/3d/hullShadowSdf.js'), import('/src/3d/shipLights3D.js'), import('/src/3d/hullSkinBatch.js'),
    import('/src/3d/mainExhaust3D.js'), import('/src/3d/sideJets3D.js')
  ]);
  const R = Core3D.renderer;
  if (!R || typeof Core3D.renderSingle !== 'function') return 'brak renderera';
  const D = globalThis.__skwd = {
    frames: 0, draws: new Map(), renders: new Map(), computes: 0, computeKernels: 0,
    // sumy na klatkę (średnie w odczycie)
    sum: { bakes: 0, bakeMs: 0, quads: 0, entitiesIn: 0, culled: 0, warmOnly: 0, fullBodies: 0, impostors: 0, shaftHulls: 0,
      lensDots: 0, nozzles: 0, offBox: 0, cut: 0, engineShips: 0, engineNozzles: 0, gridLights: 0, gridItems: 0, gridCulled: 0,
      navSprites: 0, jetSlots: 0, sideJets: 0, sideLights: 0, drawsFrame: 0, fxCpuMs: 0 },
    hist: new Int32Array(8),   // cała klatka: ≤2, 2–3, 3–4, 4–5, 5–6, 6–8, 8–12, >12 ms
    slow: [], scene: null, lastF: -1, lastSample: null, drawsThisFrame: 0, quadsThisFrame: 0
  };
  const oDraw = R._renderObjectDirect;
  R._renderObjectDirect = function (object, material) {
    const k = (object && (object.name || object.type) || '?') + ' / ' + (material && (material.name || material.type) || '?');
    D.draws.set(k, (D.draws.get(k) || 0) + 1);
    D.drawsThisFrame++;
    return oDraw.apply(this, arguments);
  };
  const oRender = R.render;
  R.render = function (scene, camera) {
    const t = typeof R.getRenderTarget === 'function' ? R.getRenderTarget() : null;
    const k = 'L' + (camera && camera.layers ? camera.layers.mask : '?') + '@' + (t ? (t.texture && t.texture.name || t.name || 'cel') : 'kanwa');
    D.renders.set(k, (D.renders.get(k) || 0) + 1);
    return oRender.apply(this, arguments);
  };
  const oCompute = R.compute;
  D.computeBy = new Map();
  const cname = (n) => (n && (n.name || (n.computeNode && n.computeNode.name) || (n.jsFunc && n.jsFunc.name))) || '?';
  R.compute = function (nodes) {
    D.computes++;
    const list = Array.isArray(nodes) ? nodes : [nodes];
    D.computeKernels += list.length;
    const k = list.length + ':' + list.slice(0, 3).map(cname).join('+') + (list.length > 3 ? '+…' : '');
    D.computeBy.set(k, (D.computeBy.get(k) || 0) + 1);
    return oCompute.apply(this, arguments);
  };
  const oWQ = hsb.HullSkinBatch.prototype.writeQuads;
  hsb.HullSkinBatch.prototype.writeQuads = function (e, p, s, h, qMin, qMax) { if (e && e.alive && qMax >= qMin) D.quadsThisFrame += qMax - qMin + 1; return oWQ.apply(this, arguments); };
  // API GPU na klatkę (jak --diag 1 strony): zapisy kolejki, nowe zasoby i grupy wiązań — przebudowa grupy wiązań
  // co klatkę (np. tekstura z needsUpdate) kosztuje dziesiątki µs
  const dev = R.backend && R.backend.device;
  D.gpu = { writeBuffer: 0, writeBufferKB: 0, writeTexture: 0, writeTextureKB: 0, submit: 0, createBindGroup: 0, createBuffer: 0, createTexture: 0 };
  D.writeBy = new Map();   // writeBuffer po etykiecie bufora (three: nazwa atrybutu / bufora) — wywołania i KB
  if (dev) {
    const q = dev.queue;
    const wq = (name, bytes) => { const o = q[name].bind(q); q[name] = (...a) => { D.gpu[name]++; if (bytes) D.gpu[name + 'KB'] += bytes(a) / 1024; return o(...a); }; };
    const oWB = q.writeBuffer.bind(q);
    q.writeBuffer = (...a) => {
      const d = a[2], bpe = d && d.BYTES_PER_ELEMENT || 1;
      const bytes = a[4] != null ? a[4] * bpe : ((d && d.byteLength) || 0) - (a[3] || 0) * bpe;
      const label = (a[0] && a[0].label) || '?';
      let e = D.writeBy.get(label);
      if (!e) D.writeBy.set(label, e = { n: 0, kb: 0 });
      e.n++; e.kb += bytes / 1024;
      return oWB(...a);
    };
    wq('writeTexture', (a) => (a[1] && a[1].byteLength) || 0);
    wq('submit');
    for (const name of ['createBindGroup', 'createBuffer', 'createTexture']) { const o = dev[name].bind(dev); dev[name] = (...a) => { D.gpu[name]++; return o(...a); }; }
  }
  const F = globalThis.__rwFrameTimes;
  const oRS = Core3D.renderSingle;
  Core3D.renderSingle = function () {
    // cała klatka poprzedniej strony (zapis po bitmapie) + jej skład z poprzedniej próbki
    if (F && F.n !== D.lastF && D.lastSample) {
      const ms = F.ms[(F.n - 1) & 8191];
      D.lastF = F.n;
      D.hist[ms <= 2 ? 0 : ms <= 3 ? 1 : ms <= 4 ? 2 : ms <= 5 ? 3 : ms <= 6 ? 4 : ms <= 8 ? 5 : ms <= 12 ? 6 : 7]++;
      if (ms > 4 && D.slow.length < 400) D.slow.push({ ms: Math.round(ms * 100) / 100, ...D.lastSample });
    }
    // czworokąty skór kopiowane PRZED renderem tej strony (updateHexShips3D idzie przed renderSingle)
    const quadsBefore = D.quadsThisFrame;
    D.drawsThisFrame = 0;
    D.quadsThisFrame = 0;
    try { return oRS.apply(this, arguments); } finally {
      D.frames++;
      const S = D.sum, L = globalThis.__hexLodStats || {}, M = evs.MainLodStats, G = Core3D.fx && Core3D.fx.grid ? Core3D.fx.grid.stats : null;
      const st = sdf.HullShadowSdf.stats, sjs = sj.SideJets3D.getStats();
      const sample = {
        bakes: st.bakes, bakeMs: Math.round(st.bakeMs * 100) / 100, quads: quadsBefore, draws: D.drawsThisFrame,
        entitiesIn: L.entitiesIn | 0, culled: L.culled | 0, warmOnly: L.warmOnly | 0, fullBodies: L.fullBodies | 0, impostors: (L.impostorBodies | 0) + (L.coldImpostors | 0),
        shaftHulls: L.shaftHulls | 0, lensDots: L.lensDots | 0,
        nozzles: M.nozzles, offBox: M.offBox, cut: M.cut, engineShips: ef.EngineFrame.count, engineNozzles: ef.EngineFrame.nzN,
        gridLights: G ? G.lights : 0, gridItems: G ? G.items : 0, gridCulled: G ? G.culled : 0,
        navSprites: sl.ShipLights3D.mesh ? sl.ShipLights3D.mesh.count : 0, jetSlots: me.MainExhaust3D.slotCount, sideJets: sjs.jets, sideLights: sjs.lights,
        fxCpuMs: Core3D.fxStats ? Math.round((Core3D.fxStats.cpuMs || 0) * 100) / 100 : 0
      };
      D.lastSample = sample;
      S.bakes += sample.bakes; S.bakeMs += sample.bakeMs; S.quads += sample.quads; S.drawsFrame += sample.draws;
      S.entitiesIn += sample.entitiesIn; S.culled += sample.culled; S.warmOnly += sample.warmOnly; S.fullBodies += sample.fullBodies; S.impostors += sample.impostors;
      S.shaftHulls += sample.shaftHulls; S.lensDots += sample.lensDots; S.nozzles += sample.nozzles; S.offBox += sample.offBox; S.cut += sample.cut;
      S.engineShips += sample.engineShips; S.engineNozzles += sample.engineNozzles; S.gridLights += sample.gridLights; S.gridItems += sample.gridItems; S.gridCulled += sample.gridCulled;
      S.navSprites += sample.navSprites; S.jetSlots += sample.jetSlots; S.sideJets += sample.sideJets; S.sideLights += sample.sideLights; S.fxCpuMs += sample.fxCpuMs;
      if ((D.frames % 120) === 1 && Core3D.scene) {
        let n = 0, vis = 0, auto = 0, meshes = 0;
        Core3D.scene.traverse((o) => { n++; if (o.visible) vis++; if (o.matrixAutoUpdate) auto++; if (o.isMesh) meshes++; });
        // dzieci sceny z liczbą potomków (kandydaci na matrixAutoUpdate = false — _syncSceneMatrices)
        const kids = [];
        for (const ch of Core3D.scene.children) { let k = 0; ch.traverse(() => k++); kids.push([ch.name || ch.type, k, ch.visible ? 1 : 0, ch.matrixAutoUpdate ? 1 : 0]); }
        kids.sort((a, b) => b[1] - a[1]);
        D.scene = { objects: n, visible: vis, matrixAutoUpdate: auto, meshes, dzieci: kids.slice(0, 40) };
      }
    }
  };
  return { ok: true, t: Date.now() };
})()
