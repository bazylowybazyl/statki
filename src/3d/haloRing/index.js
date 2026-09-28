// Ring „Halo” — punkt wejścia modułu. W grze od portu 2026-09-25: klej
// haloRingGame.js (Ziemia i Mars, kolizje, stacja-port) — docs/PORT-halo-ring.md.
//
//   const ring = createHaloRing({ planetRadius, seed, quality, renderer });
//   scene.add(ring.group);
//   ring.setLayers({ default: 1 });            // host decyduje o passach
//   ring.setSun(azimuth, elevation);           // radiany, w układzie XY sceny
//   ring.update(dt, { camera, gameView });     // raz na klatkę, przed renderem
//   ring.setCutaway(0, { x, y, angle, a, b, strength }); // wycięcie dachu nad graczem
//   await ring.ready;                          // budowa asynchroniczna (niżej)
//
// Port WebGPU (zadanie 06): budowa jest ASYNCHRONICZNA — kompilacja pipeline'ów
// bake'u (compileAsync), bake mapy niskiej, odczyt CPU (readRenderTargetPixelsAsync),
// plan budowli i kopuł z tej mapy, setCivic (ponowny bake i odczyt), tekstury
// detalu, dopiero potem bryły. Do tego czasu `ring.group` jest pusta, update() nic
// nie rysuje, `mapsReady` = false, terrainHeightAt = 0 (host podpina kolizje z
// terenem dopiero po `ring.ready`). setQuality() buduje nowy zestaw w tle i
// podmienia go gotowy (stary rysuje się do końca), rebuild() zaczyna od pustego.
// Zadanie 11: options.prewarm(obiekty, opcje) → Promise — host kompiluje pipeline'y
// nowych brył w tle (Core3D.warmup), ZANIM trafią do `group` (bez niego pierwsza
// klatka z ringiem budowała ~15 materiałów i czekała na ich synchroniczne
// pipeline'y: 4–6 s przestoju); `ready` obejmuje tę rozgrzewkę.
//
// Płaszczyzna gry na środku wstęgi (flightLevel 0,5, domyślnie od 2026-09-23):
// górna ściana z dachem leży NAD statkami → siatki `layers.fg` (jak suwnice
// K-7); reszta w `layers.default` (BG). W kamerze gry (view.gameView) dach
// znika przy dużym powiększeniu i ma wycięcia nad graczem (setCutaway).
//
// Moduł nie tworzy renderera ani canvasu (AGENTS.md): renderer dostaje od
// hosta wyłącznie do upieczenia map (render-to-texture).
import * as THREE from 'three';
import { HALO_DEFAULT_LAYER, HALO_FG, HALO_QUALITY, haloPortComplexAngles, haloQualityLod, resolveHaloQuality } from './haloRingConfig.js';
import { createHaloRingLayout } from './haloRingLayout.js';
import { applyLayoutToUniforms, applyRoofPlanUniforms, createHaloUniforms } from './haloRingUniforms.js';
import { HaloWorldMaps } from './haloRingWorldGen.js';
import { HaloDetailTextures } from './haloRingDetail.js';
import { HaloTerrain } from './haloRingTerrain.js';
import { HaloStructure } from './haloRingStructure.js';
import { HaloAirShell, HaloClouds } from './haloRingAtmosphere.js';
import { buildHaloRoofPlan } from './haloRingRoofPlan.js';
import { buildHaloLandmarkPlan, haloCivicContext } from './haloRingLandmarks.js';
import { buildHaloDomePlan } from './haloRingDomes.js';
import { HaloMegastructure } from './haloRingMegastructure.js';
import { HaloCity } from './haloRingCity.js';
import { HaloPortK7 } from './haloPortK7.js';
import { createK7Layout, k7Frame } from './haloPortK7Layout.js';
import { haloBayLayouts } from './haloPortBays.js';

export { createHaloRingLayout, computeHaloRingLayout } from './haloRingLayout.js';
export { HALO_QUALITY } from './haloRingConfig.js';

const _inv = new THREE.Matrix4();
const _camWorld = new THREE.Vector3();
const _proj = new THREE.Matrix4();
const _floorTmp = {};

export function createHaloRing(options = {}) {
  const renderer = options.renderer;
  if (!renderer) throw new Error('createHaloRing: wymagany renderer hosta (bake map)');
  const state = {
    options: { ...options },
    qualityKey: resolveHaloQuality(options.quality),
    layers: { default: HALO_DEFAULT_LAYER },
    sun: { azimuth: 0, elevation: 49 * Math.PI / 180 },
    visible: {}
  };
  const group = new THREE.Group();
  group.name = 'HaloRing';
  const frustum = new THREE.Frustum();
  const camLocal = new THREE.Vector3();
  let parts = null;       // zbudowane części (w grupie)
  let layout = null;
  let sigmaOut = true;
  let uniforms = null;
  let detail = null;      // tekstury detalu (przeżywają przebudowy)
  let buildGen = 0;       // numer bieżącej budowy (porzucone kończą się bez skutku)
  let building = null;    // { gen, maps, promise } — budowa w toku
  let lastError = null;

  // Budowa: układ i uniformy od razu (host czyta layout/uniforms), reszta asynchronicznie.
  function startBuild({ keepOld = false } = {}) {
    const gen = ++buildGen;
    layout = createHaloRingLayout(state.options);
    sigmaOut = layout.sigma > 0;
    const quality = HALO_QUALITY[state.qualityKey];
    if (!uniforms) uniforms = createHaloUniforms(layout);
    else applyLayoutToUniforms(uniforms, layout);
    // skala detalu z LOD jakości (ultra: okna i wzory wygaszane dalej)
    uniforms.uDetailScale.value = haloQualityLod(quality).detailScale;
    applySun();
    if (!keepOld) disposeParts();
    const buildLayout = layout;
    const maps = new HaloWorldMaps(renderer, buildLayout, quality);
    const job = { gen, maps, promise: null };
    building = job;
    job.promise = (async () => {
      let done = false;
      try {
        await maps.init();
        if (gen !== buildGen) return false;
        // Megabudowle z ECUMENE (landmarki miast, 2026-09-24) i kopuły-biosfery
        // (2026-09-25): miejsca z mapy wysokości sprzed placów (wspólny kontekst —
        // parki się nie nakładają), potem w mapach plac, park, staw i wnętrze
        // kopuły, a bryły i szkło w megastrukturze (punkty orientacyjne, BG).
        // Mapa CPU jest już odczytana (maps.init czeka na odczyt) — rozstawienie
        // jak w bazie WebGL.
        const Wf = buildLayout.floor.length;
        const civicCtx = haloCivicContext(buildLayout, {
          heightAt: maps.cpu ? (theta, t) => maps.heightAtUV(theta / (Math.PI * 2), t / Wf) : null
        });
        const landmarks = state.options.landmarks === false ? [] : buildHaloLandmarkPlan(buildLayout, { ctx: civicCtx });
        const domes = state.options.domes === false ? [] : buildHaloDomePlan(buildLayout, { ctx: civicCtx });
        await maps.setCivic({ landmarks, domes });
        if (gen !== buildGen) return false;
        if (!detail) detail = new HaloDetailTextures(renderer);
        await detail.init();
        if (gen !== buildGen) return false;
        const next = assemble(buildLayout, quality, maps, landmarks, domes);
        // Pipeline'y brył w tle przed podpięciem (stare bryły przy setQuality rysują się dalej).
        if (typeof state.options.prewarm === 'function') {
          await prewarmParts(next, () => gen === buildGen);
          if (gen !== buildGen) {
            disposeSet(next, false);
            return false;
          }
        }
        disposeParts();
        parts = next;
        attachParts();
        done = true;
        lastError = null;
        return true;
      } catch (err) {
        lastError = err;
        console.error('[HaloRing] budowa ringu nie wyszła', err);
        return false;
      } finally {
        if (building === job) building = null;
        if (!done) maps.dispose();
      }
    })();
    return job.promise;
  }

  // Bryły ringu z gotowych map (synchronicznie, po odczycie CPU i placach).
  function assemble(layout, quality, maps, landmarks, domes) {
    const terrain = new HaloTerrain({ layout, uniforms, maps, detail, quality });
    const domain = {
      Ns: terrain.Ns,
      ds: terrain.ds,
      segCount: terrain.rootCount * 8,
      segCells: terrain.rootCells / 8
    };
    // górna ściana osobno, gdy leży nad płaszczyzną gry (FG)
    const topSplit = layout.flightLevel !== 'roof';
    const structure = new HaloStructure({ layout, uniforms, surfaceUniforms: terrain.surfaceUniforms, domain, part: topSplit ? 'rest' : 'all' });
    const structureTop = topSplit ? new HaloStructure({ layout, uniforms, surfaceUniforms: terrain.surfaceUniforms, domain, part: 'top' }) : null;
    const clouds = new HaloClouds({ layout, uniforms, surfaceUniforms: terrain.surfaceUniforms, domain, quality });
    const shell = new HaloAirShell({ layout, uniforms, surfaceUniforms: terrain.surfaceUniforms, domain, quality });
    // M3: dach, kratownice, kolej, port — plan w czystym JS, render instancjami
    const plan = buildHaloRoofPlan(layout, domain, { landmarks, domes });
    applyRoofPlanUniforms(uniforms, plan);
    const mega = new HaloMegastructure({ layout, uniforms, surfaceUniforms: terrain.surfaceUniforms, domain, plan, quality });
    // M4: budynki i drzewa na podłodze — z tych samych reguł co mapa miasta w terenie
    // (kopuły-miasta profilu Marsa: kawałki zabudowy także pod szkłem)
    const city = new HaloCity({ layout, uniforms, surfaceUniforms: terrain.surfaceUniforms, quality, domes });
    // Ruchu statków ring nie udaje (decyzja użytkownika 2026-09-24: statki i ruch
    // wdrażane osobno) — port wystawia stanowiska (k7Halls, bays) i adapter
    // do ruchu v2 (haloPortTraffic.js), statki rysuje system ruchu.
    // Port Ziemi: 4 kompleksy co 90° — hala K-7 i jej 2 otwarte zatoki
    // (stanowiska w standardzie K-7; bryła zatok w megastrukturze). Układy
    // stanowisk (stan zajętości) przeżywają przebudowę ringu: hala 0 i zatoki
    // trzyma `state`. Kompleks obcinany w całości, gdy poza kadrem.
    const k7Halls = [];
    if (layout.sigma > 0 && layout.flightLevel !== 'roof' && state.options.k7 !== false) {
      if (!state.bayLayouts) state.bayLayouts = haloBayLayouts(layout);
      else for (const bay of state.bayLayouts) bay.frame = k7Frame(layout, bay.theta);
      if (!state.hallLayouts) {
        state.hallLayouts = haloPortComplexAngles().map((angle, i) => {
          const l = i === 0 ? (state.k7Layout || (state.k7Layout = createK7Layout())) : createK7Layout();
          if (i > 0) {
            const c01 = l.berths[0];
            c01.occupied = null;
            c01.reserved = null;
          }
          return l;
        });
      }
      haloPortComplexAngles().forEach((angle, i) => {
        const hallLayout = state.hallLayouts[i];
        const bays = state.bayLayouts.filter((b) => b.complex === i);
        // styl doków z profilu planety (dach, ściany, paleta, światła, napisy)
        const hall = new HaloPortK7({ ringLayout: layout, uniforms, layout: hallLayout, angle, index: i, bays, style: layout.planetProfile.port });
        hall.update(0, {});
        hall.setBerthLamps();
        k7Halls.push(hall);
      });
    }
    const k7 = k7Halls[0] || null;
    return { maps, terrain, structure, structureTop, clouds, shell, mega, city, k7, k7Halls, plan, domain, quality, landmarks, domes };
  }

  function attachParts() {
    if (!parts) return;
    group.add(parts.terrain.mesh, parts.structure.mesh, parts.clouds.mesh, parts.shell.mesh, parts.mega.group, parts.city.group);
    if (parts.structureTop) group.add(parts.structureTop.mesh);
    for (const hall of parts.k7Halls) group.add(hall.root);
    applyLayers();
    applySun();
    for (const [part, visible] of Object.entries(state.visible)) applyVisible(part, visible);
  }

  function disposeParts() {
    if (!parts) return;
    disposeSet(parts, true);
    parts = null;
  }

  // Zwolnienie zestawu brył (podpiętego albo porzuconego przed podpięciem); mapy
  // porzuconego zestawu zwalnia finally budowy.
  function disposeSet(set, withMaps) {
    for (const key of ['terrain', 'structure', 'structureTop', 'clouds', 'shell']) {
      const part = set[key];
      if (!part) continue;
      group.remove(part.mesh);
      part.dispose();
    }
    group.remove(set.mega.group);
    set.mega.dispose();
    group.remove(set.city.group);
    set.city.dispose();
    for (const hall of set.k7Halls || []) {
      group.remove(hall.root);
      hall.dispose();
    }
    if (withMaps) set.maps.dispose();
  }

  // Rozgrzewka zestawu brył przed podpięciem (zadanie 11, hak hosta options.prewarm):
  // wszystkie bryły i dach hal K-7 w drugim stanie (statek w hali — przezroczysty).
  function prewarmParts(set, alive) {
    const prewarm = state.options.prewarm;
    const objects = [set.terrain.mesh, set.structure.mesh, set.structureTop?.mesh, set.clouds.mesh, set.shell.mesh, set.mega.group, set.city.group];
    for (const hall of set.k7Halls) objects.push(hall.root);
    const jobs = [prewarm(objects.filter(Boolean), { name: `ring ${layout?.planetProfile?.key || 'halo'}: bryły`, alive })];
    for (const hall of set.k7Halls) {
      const v = hall.roofWarmVariant();
      if (v.meshes.length) jobs.push(prewarm(v.meshes, { name: 'ring: dach K-7 przezroczysty', variant: v, alive }));
    }
    return Promise.all(jobs).catch((err) => {
      console.warn('[HaloRing] rozgrzewka brył nie wyszła — pipeline’y powstaną przy pierwszym rysunku', err);
    });
  }

  function applyVisible(part, visible) {
    const p = parts?.[part];
    if (p?.mesh) p.mesh.visible = !!visible;
    else if (p?.group) p.group.visible = !!visible;
  }

  // Gotowość: czeka na bieżącą budowę (także gdy w międzyczasie ruszyła następna).
  async function whenReady() {
    while (building) {
      const job = building;
      await job.promise;
      if (building === job) break;
    }
    return !!parts;
  }

  function applyLayers() {
    if (!parts) return;
    const map = state.layers;
    const pick = (name) => (Number.isFinite(map[name]) ? map[name] : map.default ?? HALO_DEFAULT_LAYER);
    // nad płaszczyzną gry (górna ściana, dach) → FG hosta, o ile go podał
    const fgOr = (name) => (layout.flightLevel !== 'roof' && Number.isFinite(map.fg) ? map.fg : pick(name));
    parts.terrain.mesh.layers.set(pick('terrain'));
    parts.structure.mesh.layers.set(pick('structure'));
    parts.structureTop?.mesh.layers.set(fgOr('structure'));
    parts.clouds.mesh.layers.set(pick('clouds'));
    parts.shell.mesh.layers.set(pick('shell'));
    for (const m of parts.mega.bgMeshes) m.layers.set(pick('mega'));
    for (const m of parts.mega.fgMeshes) m.layers.set(fgOr('mega'));
    for (const m of parts.city.meshes) m.layers.set(pick('city'));
    // K-7: pokład i ściany pod statkami (BG), suwnice, węże i dach nad nimi (FG)
    for (const hall of parts.k7Halls || []) hall.setLayers(pick('k7'), Number.isFinite(map.fg) ? map.fg : pick('k7'));
  }

  // Kompleksy portu (hala K-7 + zatoki) poza zasięgiem wzroku bez draw calli:
  // za horyzontem wypukłej podłogi (kamera przy wstędze), za planetą albo
  // mniejsze niż ~3 px. Obwiednia kompleksu: hall.bounds (układ ringu).
  const _hallC = new THREE.Vector3();
  const _hallS = new THREE.Sphere();
  function cullHalls(pixelAngle) {
    const halls = parts?.k7Halls;
    if (!halls?.length) return;
    const Rf = layout.radii.floorMid;
    const Rc = Math.hypot(camLocal.x, camLocal.y);
    const nearBand = Math.abs(camLocal.z - layout.z.floorMid) < layout.width;
    const horizon = Math.acos(Math.min(1, Rf / Math.max(Rc, Rf + 1))) + Math.acos(Rf / (Rf + 9000)) + 0.05;
    const camTh = Math.atan2(camLocal.y, camLocal.x);
    const pc = uniforms.uPlanet.value;
    const minPx = haloQualityLod(parts.quality).k7Pixels;
    for (const hall of halls) {
      const B = hall.bounds;
      _hallC.set(B.x, B.y, B.z);
      let vis = true;
      if (sigmaOut && nearBand) {
        let d = Math.atan2(B.y, B.x) - camTh;
        d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
        if (Math.abs(d) > horizon + B.r / Rf) vis = false;
      }
      const dist = _hallC.distanceTo(camLocal);
      if (vis && pixelAngle > 0 && 2 * B.r / Math.max(dist, 1) / pixelAngle < minPx) vis = false;
      if (vis) {
        // odcinek kamera → hala przecina planetę?
        const dx = _hallC.x - camLocal.x;
        const dy = _hallC.y - camLocal.y;
        const dz = _hallC.z - camLocal.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        const ox = pc.x - camLocal.x;
        const oy = pc.y - camLocal.y;
        const oz = pc.z - camLocal.z;
        const t = (ox * dx + oy * dy + oz * dz) / len;
        if (t > 0 && t < len - B.r) {
          const d2 = ox * ox + oy * oy + oz * oz - t * t;
          if (d2 < (pc.w - 500) * (pc.w - 500)) vis = false;
        }
      }
      if (vis) {
        _hallS.center.copy(_hallC);
        _hallS.radius = B.r;
        vis = frustum.intersectsSphere(_hallS);
      }
      hall.root.visible = vis;
    }
  }

  function applySun() {
    if (!uniforms) return;
    const { azimuth, elevation } = state.sun;
    const ce = Math.cos(elevation);
    uniforms.uSunDir.value.set(ce * Math.cos(azimuth), ce * Math.sin(azimuth), Math.sin(elevation)).normalize();
  }

  startBuild();

  const api = {
    group,
    get layout() { return layout; },
    get uniforms() { return uniforms; },
    get quality() { return state.qualityKey; },
    // Obietnica gotowości (true = bryły i mapa CPU gotowe, false = budowa nie wyszła).
    get ready() { return whenReady(); },
    get isReady() { return !!parts && !building; },
    get error() { return lastError; },

    // Kamera → układ lokalny ringu, punkt odniesienia RTE, wybór węzłów.
    update(dt, view) {
      const camera = view.camera;
      uniforms.uTime.value += Math.max(0, Number(dt) || 0);
      if (!parts) return;
      group.updateMatrixWorld();
      _inv.copy(group.matrixWorld).invert();
      camera.getWorldPosition(_camWorld);
      camLocal.copy(_camWorld).applyMatrix4(_inv);
      const { terrain, domain } = parts;
      const floorMid = layout.radii.floorMid;
      let theta = Math.atan2(camLocal.y, camLocal.x);
      if (theta < 0) theta += Math.PI * 2;
      const refS = ((Math.round(theta * floorMid / domain.ds) % domain.Ns) + domain.Ns) % domain.Ns;
      const thetaRef = refS * domain.ds / floorMid;
      const refX = floorMid * Math.cos(thetaRef);
      const refY = floorMid * Math.sin(thetaRef);
      uniforms.uCamLocal.value.copy(camLocal);
      uniforms.uRefRel.value.set(refX - camLocal.x, refY - camLocal.y, -camLocal.z);
      uniforms.uRefBasis.value.set(Math.cos(thetaRef), Math.sin(thetaRef), thetaRef, refS * domain.ds);
      terrain.setReference(refS * domain.ds);
      _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(group.matrixWorld);
      frustum.setFromProjectionMatrix(_proj);
      // mapy: dopiekanie pełnej rozdzielczości w tle
      if (!parts.maps.ready) parts.maps.step();
      terrain.update({ camLocal, refS, camera, ringMatrixWorld: group.matrixWorld });
      parts.structure.update(frustum, refS);
      parts.structureTop?.update(frustum, refS);
      // górna ściana nad płaszczyzną gry (HALO_FG): w kamerze gry dach nad
      // wąwozem habitatu zdjęty przy zoomie rozgrywki, cały dach znika, gdy
      // kamera zejdzie nisko nad nim; wycięcia tylko w kamerze gry (rzut na z = 0)
      const fg = uniforms.uFgFade.value;
      if (view.gameView && layout.flightLevel !== 'roof') {
        const top = layout.z.top;
        const m = camLocal.z > top + 1 ? camLocal.z / (camLocal.z - top) : Infinity;
        const fade = (range) => {
          const k = Math.min(1, Math.max(0, (m - range[0]) / (range[1] - range[0])));
          return 1 - k * k * (3 - 2 * k);
        };
        // krawędź dachu nad wąwozem: od krawędzi ścian (zamknięty) do podłogi (schowany)
        const edge = fade(HALO_FG.troughMag) * (layout.wallHeight + 200);
        fg.set(fade(HALO_FG.fadeMag), 1, edge, layout.radii.floorTop);
      } else {
        fg.set(1, 0, 1e6, layout.radii.floorTop);
      }
      parts.clouds.update(frustum, refS);
      parts.shell.update(frustum, refS, layout.isInsideAir(camLocal.x, camLocal.y, camLocal.z));
      // rozmiar piksela: minimum świateł pozycyjnych, próg budynków i drzew
      const pe = camera.projectionMatrix.elements[5];
      const vh = Number(view.viewportHeight) || 1080;
      const pixelAngle = camera.isPerspectiveCamera && pe > 0 ? 2 / (pe * vh) : 0;
      if (parts.mega.group.visible) {
        if (pixelAngle > 0) parts.mega.setPixelAngle(pixelAngle);
        parts.mega.update(frustum, camLocal);
      }
      if (parts.city.group.visible) parts.city.update(camLocal, pixelAngle, frustum);
      cullHalls(pixelAngle);
    },

    setSun(azimuth, elevation) {
      state.sun.azimuth = Number(azimuth) || 0;
      state.sun.elevation = Number(elevation) || 0;
      applySun();
    },

    // Nowa jakość: nowy zestaw map i brył w tle, podmiana gotowego (stary rysuje
    // się do końca — mapa CPU i kolizje bez przerwy; układ się nie zmienia).
    setQuality(q) {
      const key = resolveHaloQuality(q);
      if (key === state.qualityKey) return;
      state.qualityKey = key;
      startBuild({ keepOld: true });
    },

    // Przebudowa geometrii (W, ściany, floorTilt, sektory, seed) — od pustego ringu.
    rebuild(nextOptions = {}) {
      Object.assign(state.options, nextOptions);
      startBuild({ keepOld: false });
    },

    // Wycięcie górnej ściany (0 lub 1) w kamerze gry: prostokąt o zaokrąglonych
    // końcach w płaszczyźnie gry (układ lokalny ringu), oś pod kątem `angle`,
    // pół-wymiary a (wzdłuż osi) × b; a = b = promień → koło. null = brak.
    setCutaway(index, cut) {
      const A = uniforms.uCutA.value[index];
      const B = uniforms.uCutB.value[index];
      if (!A) return;
      if (!cut || !(cut.strength > 0)) { B.w = 0; return; }
      const a = Math.max(0, Number(cut.a) || 0);
      A.set(Number(cut.x) || 0, Number(cut.y) || 0, Math.cos(cut.angle || 0), Math.sin(cut.angle || 0));
      B.set(a, Math.max(0, Number(cut.b ?? a) || 0), cut.soft ?? HALO_FG.cutSoft, Math.min(1, cut.strength));
    },

    setLayers(map = {}) {
      state.layers = { ...state.layers, ...map };
      applyLayers();
    },

    // Widoczność części (także przed zbudowaniem — nakłada się przy podpięciu).
    setVisible(part, visible) {
      state.visible[part] = !!visible;
      applyVisible(part, visible);
    },

    // Wysokość terenu (CPU, niska rozdzielczość) — kolizje płyty, dynamiczny near
    // kamery. Przed pierwszym odczytem mapy 0 (host czeka na `ready`).
    terrainHeightAt(x, y, z) {
      const maps = parts?.maps;
      if (!maps?.cpu) return 0;
      const f = layout.worldToFloor(x, y, z, _floorTmp);
      return maps.heightAtUV(f.u, f.v);
    },

    get stats() {
      const p = parts;
      if (!p) {
        return {
          activeTiles: 0, segments: 0, mapProgress: 0, mapsReady: false, textureBytes: 0,
          terrainTriangles: 0, megaInstances: 0, megaLights: 0, shellActive: false, building: !!building
        };
      }
      return {
        activeTiles: p.terrain.activeNodes,
        segments: p.structure.segments.count + (p.structureTop?.segments.count || 0),
        mapProgress: p.maps.progress,
        mapsReady: api.mapsReady,
        textureBytes: p.maps.textureBytes + (detail?.textureBytes || 0),
        terrainTriangles: p.terrain.triangleEstimate,
        megaInstances: p.mega.visibleInstances,
        megaLights: p.mega.lights.count,
        shellActive: p.shell.active,
        building: !!building,
        bake: p.maps.timings
      };
    },

    // Gotowość dla gry: bryły zbudowane, mapa CPU odczytana, pełna mapa dopieczona,
    // żadna przebudowa w toku.
    get mapsReady() { return !!parts && !building && parts.maps.ready && !!parts.maps.cpu; },

    // Port K-7 (dok gameplayowy): render + układ hali (dane dla rozgrywki hosta).
    // k7 = hala gracza (kompleks 0), k7Halls = wszystkie 4 (każda z zatokami
    // swojego kompleksu: hall.bays), bays = 8 otwartych zatok (układy
    // stanowisk z ramkami, kolejność jak plan.docks).
    get k7() { return parts?.k7 || null; },
    get k7Halls() { return parts?.k7Halls || []; },
    get k7Layout() { return state.k7Layout || null; },
    get bays() { return state.bayLayouts || []; },
    get plan() { return parts?.plan || null; },
    // Megabudowle (haloRingLandmarks.js): nazwa, sektor, kąt, t podłogi, plac, park.
    get landmarks() { return parts?.plan?.landmarks || []; },
    // Kopuły-biosfery (haloRingDomes.js): typ wnętrza, sektor, kąt, t, promień.
    get domes() { return parts?.plan?.domes || []; },

    dispose() {
      buildGen++;
      building = null;
      disposeParts();
      detail?.dispose();
      detail = null;
    }
  };
  return api;
}
