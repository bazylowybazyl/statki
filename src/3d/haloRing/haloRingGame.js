// Ring „Halo” w grze (port do gry 2026-09-25): klej między grą (świat 2D,
// Core3D) a modułem ringu (createHaloRing). Opis: docs/PORT-halo-ring.md.
//
//  - ringi Ziemi (Halo), Marsa (ECUMENE) i Jowisza (Fable) — archetyp,
//    promień planety i ziarno z profilu i src/game/haloRingPlanets.js; Mars
//    i Jowisz to inne ringi (src/3d/haloRing/arch/, decyzja użytkownika
//    2026-09-27) z tym samym API; grupa w środku planety, obrócona tak, żeby
//    port leżał pod kątem dawnej stacji; tworzony leniwie, gdy kadr się zbliży;
//  - BG (warstwa 1, pod statkami), górna ściana z dachem i ramiona paliwowe K-7
//    w FG (warstwa 2) — kolejność passów Core3D;
//  - kamera: replika kamery perspektywicznej passów Core3D (syncCamera) na TĘ
//    klatkę i z tym samym rozmiarem bufora — ring liczy pozycje względem kamery
//    (RTE), więc kamera z poprzedniej klatki przesuwałaby go względem sceny;
//  - słońce: azymut do Słońca gry + wysokość 49° (jak DirectionalLight gry);
//  - wycięcie górnej ściany nad graczem i zanik dachów hal K-7 (jak w demie
//    lotu, dema/halo_ring_k7_flight.js);
//  - okluder smug cieni (Core3D.setShaftRingOccluder) i jakość z ustawień gry
//    (OPTIONS.planetQuality: low / medium / high / ultra);
//  - ROZGRYWKA ringów jest po stronie gry (RW-27): src/game/haloRingWorld.js — kolidery (płyta, teren,
//    ściany portu), automat obsługi stanowisk K-7, zajętość i lampki stanowisk, zegar migania świateł hal,
//    poziom lamp hali; tu tylko obraz z tych danych (wpisy obrazu niosą odwołania do wpisów świata:
//    key, planet, collider, place, service — jak dawniej) i jedno zdarzenie do gry: teren Ziemi z mapy CPU
//    ringu po zbudowaniu (world.setRingTerrain; archetypy Marsa i Jowisza gra liczy z planów sama).
// Zero alokacji na klatkę (bufory i obiekty wycięć wielokrotnego użytku).
import * as THREE from 'three';
import { Core3D } from '../core3d.js';
import { createHaloRing } from './index.js';
import { createArchRing } from './arch/archRing.js';
import { resolveHaloProfile } from './haloRingProfiles.js';
import { resolveHaloQuality } from './haloRingConfig.js';
import { K7RoofFade, k7HubToWorld } from './haloPortK7Layout.js';
import { haloXfPoint } from './haloPortBays.js';
import { resolveRingPlanetWorldRadius } from '../ringScale.js';
import { HALO_RING_PLANETS, haloGameToLocal } from '../../game/haloRingPlanets.js';
import { WARP_RING_LENS } from '../warp/worldLens.js';
import { cameraRoll, rolledHalfExtents } from '../viewRoll.js';

const _zAxis = new THREE.Vector3(0, 0, 1);
const _qRot = new THREE.Quaternion();

export const HALO_GAME = Object.freeze({
  layers: Object.freeze({ default: 1, fg: 2 }),
  // Ring w soczewce warpa (obraz planety pod płaszczyzną gry): części nad płaszczyzną (górna ściana, moduły, dach hal)
  // też na warstwie tła — pass FG rysuje się PO kadłubach (zgłoszenie 2026-10-23: „planeta przebija się przez statek”).
  lensLayers: Object.freeze({ default: 1, fg: 1 }),
  // Ring w soczewce rysuje się dopiero od takiego promienia na ekranie [px bufora]: mijana planeta jest w kadrze od
  // początku skoku (przelot z daleka, worldLens.js), a ring kosztuje ~3 ms CPU aktualizacji i ~50 rysunków także jako
  // kreska wokół kilkupikselowej tarczy (demo „Pęd”, 2026-10-23).
  lensMinPx: 30,
  sunElevationDeg: 49,
  activateDistance: 420000,   // ring powstaje, gdy środek kadru jest bliżej planety
  hallReach: 9000,            // hale K-7 wystają za krawędź ścian (płyta przed G-01)
  viewMargin: 14000,          // zapas kadru: perspektywa górnej ściany nad płaszczyzną gry
  cutRadiusMin: 1350,         // wycięcie górnej ściany nad statkiem
  occluderReachMul: 1.15,     // zasięg cienia ringu w smugach (jak dawny ring)
  fadeHallRange: 16000,       // zanik dachów tylko przy halach / zatokach w pobliżu statku
  fadeBayRange: 9000
});

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function footprintHub(owner) {
  const q = {};
  return owner.layout.footprint.map(([x, z]) => {
    haloXfPoint(owner.xf, x, z, q);
    return { x: q.x, z: q.z };
  });
}

export class HaloRingGame {
  /**
   * @param {object} o
   * @param {import('../../game/haloRingWorld.js').HaloRingWorld} o.world świat ringów gry (kolidery, rejestr hal, automat)
   */
  constructor({ world, quality = 'high', renderer = null, scene = null } = {}) {
    this.world = world;
    // Renderer Core3D powstaje asynchronicznie (urządzenie WebGPU) — bierzemy go
    // w chwili budowy ringu, nie przy konstrukcji (kolidery działają od razu).
    this._renderer = renderer;
    this.scene = scene || Core3D.scene;
    this.qualityKey = resolveHaloQuality(quality);
    this.camera = new THREE.PerspectiveCamera(35, 1, 100, 500000);
    this.camera.up.set(0, 1, 0);
    this.entries = [];
    this._local = { x: 0, y: 0 };
    this._hubC = { x: 0, y: 0 };
    this._cut0 = { x: 0, y: 0, angle: 0, a: 0, b: 0, strength: 0 };
    this._cut1 = { x: 0, y: 0, angle: 0, a: 0, b: 0, strength: 0 };
    this._hallOpts = { poses: null, roofFade: 0, daylight: 1, clock: 0, gameDt: 0, hull: null };
    // obrys kadłuba gracza w hubie rysowanej hali (przewody paliwowe kładą się na kadłubie) — bufor bez alokacji
    this._hallHull = [];
    // Fabuła: { key: 'earth', hall: 0, roofFade: 0..1 (1 = dachu nie ma), cut: 0..1 } albo null (dach z kadłuba gracza).
    this.hallRoofOverride = null;
    this.stats = { rings: 0, visible: 0, updateMs: 0 };
    this._rollHalf = { hw: 0, hh: 0 };
    this.syncEntries();
  }

  /** Zegar migania świateł hal K-7 (świat ringów gry — ten sam dostaje wejście pyłu hal). */
  get clock() {
    return this.world.clock;
  }

  // Wpisy obrazu dla ringów świata (nowe planety z ringiem) — render leniwie.
  syncEntries() {
    for (const w of this.world.entries) {
      if (this.entries.some((e) => e.key === w.key)) continue;
      const reg = w.collider.registry;
      this.entries.push({
        key: w.key,
        planet: w.planet,
        collider: w.collider,
        place: w.place,
        service: w.service,
        world: w,
        ring: null,
        visible: false,
        sunAz: NaN,
        // wersja zajętości stanowisk z rejestru świata, przeniesiona na lampki hal (na halę)
        berthVersions: reg.halls.map(() => -1),
        hallFades: reg.halls.map((o) => new K7RoofFade(footprintHub(o))),
        bayFades: reg.bays.map((o) => new K7RoofFade(footprintHub(o))),
        hallFade: 0,
        hallIndex: -1,
        bayFade: 0,
        bayIndex: -1,
        occluderKey: `halo:${w.key}`,
        // ring rzuca cień w smugach (i pas na tarczy planety) dopiero od podpięcia brył (ring.ready)
        shadowReady: false
      });
    }
  }

  ringOf(key) {
    return this.entries.find((e) => e.key === key)?.ring || null;
  }

  get renderer() {
    return this._renderer || Core3D.renderer;
  }

  set renderer(value) {
    this._renderer = value || null;
  }

  _ensureRing(e) {
    if (e.ring) return e.ring;
    // Pieczenie map potrzebuje gotowego urządzenia — bez niego ring poczeka
    // (update() spróbuje w następnej klatce).
    if (!this.renderer) return null;
    const spec = HALO_RING_PLANETS[e.key];
    // Mars = ECUMENE, Jowisz = ring Fable (arch/): inne ringi niż Ziemia,
    // to samo API, geometria przekroju z profilu (jak kolizje i ruch v2)
    const archetype = resolveHaloProfile(spec.profile).archetype || 'halo';
    const ring = (archetype === 'halo' ? createHaloRing : createArchRing)({
      planetRadius: resolveRingPlanetWorldRadius(e.planet),
      seed: spec.seed,
      profile: spec.profile,
      quality: this.qualityKey,
      renderer: this.renderer,
      // Pipeline'y brył w tle przed ich podpięciem (zadanie 11, src/3d/rozgrzewka.js): bryły jeszcze
      // poza passem (warstwy nadane później) — kamera ze wszystkimi warstwami, cel i światła passów gry.
      // Bez urządzenia Core3D (renderer spoza Core3D, testy) — bez rozgrzewki, podpięcie od razu.
      prewarm: (objects, opts = {}) => (Core3D.gpuReady && Core3D.warmup
        ? Core3D.warmup.now(objects, { ...opts, layer: 'all' })
        : Promise.resolve(false)),
      // Ringi-archetypy (Mars, Jowisz) budują się krokami w klatkach (pumpBuild niżej) — dawniej 0,4–0,7 s
      // CPU w jednej klatce pierwszego zbliżenia (zadanie 23). Ring Ziemi ma własną budowę asynchroniczną.
      buildInBackground: true
    });
    ring.setLayers(HALO_GAME.layers);
    e.lensLayers = false;
    ring.group.rotation.z = e.place.rot;
    ring.group.position.set(e.place.x, -e.place.y, 0);
    ring.group.visible = false;
    this.scene.add(ring.group);
    e.ring = ring;
    e.sunAz = NaN;
    // Ring Ziemi buduje się asynchronicznie (port WebGPU: mapa CPU z odczytu
    // asynchronicznego, hale K-7 po nim) — stanowiska i teren w kolizjach dopiero
    // po zbudowaniu; do tego czasu kolider zna samą płytę (jak przed powstaniem
    // ringu), nigdy pustej mapy (wysokość 0 zamiast rzeźby).
    Promise.resolve(ring.ready).then((ok) => {
      if (!ok || e.ring !== ring) return;
      e.shadowReady = true;
      // stanowiska z rejestru świata (wolne: statków ruchu jeszcze nie ma — ring nie udaje życia; zajęte przez
      // fabułę / automat obsługi stanowisk), pasy wolne
      const reg = e.collider.registry;
      for (let i = 0; i < ring.k7Halls.length; i++) {
        const hall = ring.k7Halls[i];
        for (const lane of hall.layout.lanes || []) lane.reserved = null;
        this._syncBerthLamps(e, i, hall, reg.halls[i], true);
      }
      // teren Ziemi w kolizjach z mapy CPU ringu (zdarzenie do gry; ringi-archetypy — plan po stronie gry)
      if (!e.world.terrainReady) this.world.setRingTerrain(e.key, (lx, ly) => ring.terrainHeightAt(lx, ly, 0));
    });
    this.stats.rings = this.entries.filter((v) => v.ring).length;
    return ring;
  }

  // Tło menu głównego (menuBackdrop3D.js) przed startem gry: ring planety od
  // razu (mapy dopiekają się w menu, więc start przy Ziemi ma je gotowe), na
  // czas menu warstwy i słońce ustawia tło. releaseShowcase oddaje ring grze:
  // warstwy HALO_GAME, bez wycięć, schowany do pierwszego update(), słońce gry.
  showcaseRing(key) {
    const e = this.entries.find((v) => v.key === key);
    return e ? this._ensureRing(e) : null;
  }

  // Fabuła (lot kamery intro w tle menu, src/game/story/): wycięcie górnej ściany nad halą K-7 — to samo, które gra
  // stawia, gdy dach hali znika (_portVisuals), żeby kadr z góry na końcu lotu = kadr gry.
  showcaseHallCut(key, hallIndex = 0, strength = 1) {
    const e = this.entries.find((v) => v.key === key);
    const o = e?.collider?.registry?.halls?.[hallIndex];
    if (!e?.ring || !o) return;
    if (!(strength > 0)) { e.ring.setCutaway(0, null); return; }
    this._setHallCut(e.ring, o, strength, true);
  }

  // Słońce gry w układzie ringu (jak _applySun): { az, el } [rad].
  gameSunLocal(key, sun) {
    const e = this.entries.find((v) => v.key === key);
    if (!e) return null;
    const sx = Number(sun?.x);
    const sy = Number(sun?.y);
    const world = Number.isFinite(sx) && Number.isFinite(sy) ? Math.atan2(-(sy - e.place.y), sx - e.place.x) : 0;
    return { az: world - e.place.rot, el: HALO_GAME.sunElevationDeg * Math.PI / 180 };
  }

  _setHallCut(ring, o, strength, inHall) {
    const f = o.frame;
    const l = o.layout;
    // wycięcie tylko tam, gdzie dok wchodzi pod górną ścianę (od 2026-10-05
    // doki stoją za krawędzią ścian — wtedy hala nie ma czego wycinać)
    const z0 = Math.max(f.floorZ, l.backZ) - 100;
    const z1 = Math.min(inHall ? f.rimZ + 800 : l.openZ + 200, f.rimZ + 800);
    if (!(z1 > z0 + 1)) { ring.setCutaway(0, null); return; }
    const c = k7HubToWorld(f, 0, (z0 + z1) * 0.5, this._hubC);
    const cut = this._cut0;
    cut.x = c.x;
    cut.y = c.y;
    cut.angle = Math.atan2(f.ty, f.tx);
    cut.a = (inHall ? l.halfWidth : l.halfWidth + 400) + 600;
    cut.b = (z1 - z0) * 0.5;
    cut.strength = strength;
    ring.setCutaway(0, cut);
  }

  releaseShowcase(key) {
    const e = this.entries.find((v) => v.key === key);
    if (!e?.ring) return;
    e.ring.setLayers(HALO_GAME.layers);
    e.lensLayers = false;
    e.ring.setCutaway(0, null);
    e.ring.setCutaway(1, null);
    e.ring.group.visible = false;
    e.visible = false;
    e.sunAz = NaN;
  }

  setQuality(q) {
    const key = resolveHaloQuality(q);
    if (key === this.qualityKey) return;
    this.qualityKey = key;
    for (const e of this.entries) {
      if (!e.ring) continue;
      e.ring.setQuality(key);
      e.sunAz = NaN;
    }
  }

  // Kamera persp passów Core3D (syncCamera): FOV 35°, wysokość z rozmiaru
  // bufora sceny i zoomu, patrzy pionowo w dół na (x, −y, 0). Obrót kadru (cam.roll — viewRoll.js) jak Core3D:
  // `up` = (sin roll, cos roll, 0) — bryła widzenia ringu (LOD, odcinanie części) obraca się z kadrem.
  _syncCamera(x, y, zoom, vw, vh, roll = 0) {
    const cam = this.camera;
    const src = Core3D.cameraPersp;
    cam.fov = src?.fov || 35;
    cam.near = src?.near || 100;
    cam.far = src?.far || 500000;
    cam.aspect = vw / Math.max(1, vh);
    cam.updateProjectionMatrix();
    const h = (vh * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)) / zoom;
    cam.position.set(x, -y, h);
    cam.up.set(Math.sin(roll), Math.cos(roll), 0);
    cam.lookAt(x, -y, 0);
    cam.updateMatrixWorld(true);
  }

  // Kamera ringu = kamera perspektywy Core3D w trybie free3d (poza, FOV, near / far).
  _copyFreeCamera(vw, vh) {
    const cam = this.camera;
    const src = Core3D.cameraPersp;
    if (!src) return;
    cam.fov = src.fov;
    cam.near = src.near;
    cam.far = src.far;
    cam.aspect = vw / Math.max(1, vh);
    cam.updateProjectionMatrix();
    cam.position.copy(src.position);
    cam.quaternion.copy(src.quaternion);
    cam.updateMatrixWorld(true);
  }

  // Raz na klatkę renderu, przed Core3D.render. cam — kamera gry tej klatki
  // (x, y, zoom, z wstrząsem — ta sama, którą dostają passy), opts: sun
  // (Słońce gry), ship (gracz: wycięcia, dachy hal, automat obsługi stanowisk), gameDt (czas gry klatki — 0 w pauzie
  // i scenach fabuły; automat obsługi stanowisk), quality, splitScreen.
  update(dt, cam, opts = {}) {
    const t0 = performance.now();
    const gameDt = Number.isFinite(opts.gameDt) ? Math.max(0, opts.gameDt) : dt;
    if (opts.quality) this.setQuality(opts.quality);
    const target = Core3D.composerTarget;
    const vw = target?.width || this.renderer?.domElement?.width || 1920;
    const vh = target?.height || this.renderer?.domElement?.height || 1080;
    // px bufora (vw × vh) na j. świata — skala renderu z opcji grafiki (Core3D.viewZoom): kamera ringu i kadr
    // z bufora / zoom muszą pokryć ten sam wycinek świata co kamera gry (kanwa CSS / zoom gry).
    const zoom = Core3D.viewZoom(cam);
    const cx = Number(cam?.x) || 0;
    const cy = Number(cam?.y) || 0;
    // Kamery 3D gry (tryb free3d): kamera ringu = kamera perspektywy Core3D (render() woła
    // Core3D.syncCamera przed ringiem); bez wycięć i zaniku dachu z kamery gry (gameView).
    const free3d = Core3D.isFreePerspectiveCamera(cam);
    const roll = free3d ? 0 : cameraRoll(cam);
    if (free3d) this._copyFreeCamera(vw, vh);
    else this._syncCamera(cx, cy, zoom, vw, vh, roll);
    // Kadr w osiach świata: pudło obejmujące obrócony kadr (viewRoll.js; bez obrotu — dokładnie dawne pół kadru).
    const rh = rolledHalfExtents((vw * 0.5) / zoom, (vh * 0.5) / zoom, roll, this._rollHalf);
    const halfW = rh.hw;
    const halfH = rh.hh;
    const eye = this.camera.position;
    let visible = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const L = e.collider.layout;
      // Ring w soczewce warpa razem z planetą (worldLens.js: WARP_RING_LENS — pisze planet3d.assets.js): grupa
      // w środku obrazu planety, skala obrazu do prawdziwej, obrót przelotu; poza soczewką — prawdziwe miejsce.
      const lens = WARP_RING_LENS[e.key];
      const lensOn = !!(lens && lens.on);
      const ox = lensOn ? lens.x : e.place.x;
      const oy = lensOn ? lens.y : e.place.y;
      const ks = lensOn ? Math.max(1e-6, lens.k) : 1;
      const dx = ox - cx;
      const dy = oy - cy;
      // cień ringu w smugach — analityczny okrąg, także gdy ring poza kadrem, ale dopiero od podpięcia brył:
      // ring-archetyp buduje się w tle (Mars ~2–3 s po przylocie) i do tego czasu kadr miał sam cień ringu —
      // ciemny pierścień wokół planety i szerszą smugę bez ringu (pas na tarczy planety idzie za nim). W soczewce
      // gaśnie z udziałem prawdziwego widoku (jak tarcza planety: pushShaftDiscWorld × (1 − β)), na prawdziwym miejscu.
      const ringMid = (L.radii.min + L.radii.max) * 0.5;
      const shadowK = lensOn ? Math.max(0, Math.min(1, Number(lens.real) || 0)) : 1;
      if (e.shadowReady && shadowK > 0.001) {
        Core3D.setShaftRingOccluder?.(e.occluderKey, e.place.x, e.place.y, ringMid, ringMid * HALO_GAME.occluderReachMul, shadowK);
      } else Core3D.removeShaftRingOccluder?.(e.occluderKey);
      // budowa: kadr blisko planety albo jej obraz w soczewce w kadrze (przelot, cel przy krawędzi)
      if (!e.ring && (Math.hypot(e.place.x - cx, e.place.y - cy) < HALO_GAME.activateDistance || (lensOn && lens.vis))) this._ensureRing(e);
      const ring = e.ring;
      if (!ring) continue;
      // budowa ringu-archetypu w tle: kroki co klatkę, także poza kadrem (archRing.js, ARCH_BUILD_BUDGET)
      if (ring.pumpBuild) ring.pumpBuild();
      // podzielony ekran: ring liczy RTE dla jednej kamery — drugi kadr by go przesunął
      const reach = (L.radii.max + HALO_GAME.hallReach + HALO_GAME.viewMargin) * ks;
      // free3d: ring widać z daleka (patrzymy wzdłuż płaszczyzny) — próg z odległości oka od
      // środka ringu; resztę (bryła widzenia, LOD) liczy ring sam z kamery.
      const inView = !opts.splitScreen && (free3d
        ? Math.hypot(eye.x - ox, eye.y + oy, eye.z) < reach + HALO_GAME.activateDistance
        : Math.abs(dx) < halfW + reach && Math.abs(dy) < halfH + reach)
        && (!lensOn || L.radii.max * ks * zoom >= HALO_GAME.lensMinPx);
      ring.group.visible = inView;
      e.visible = inView;
      if (!inView) continue;
      visible++;
      // W soczewce ring jest tłem jak jego planeta: części FG na warstwie tła (kadłub zawsze nad nim), po soczewce —
      // zwykłe warstwy (pass FG nad statkiem w hali); przełączenie tylko przy zmianie (ta sama kamera perspektywy —
      // pipeline'y bez zmian).
      if (!!e.lensLayers !== lensOn) {
        e.lensLayers = lensOn;
        ring.setLayers(lensOn ? HALO_GAME.lensLayers : HALO_GAME.layers);
      }
      ring.group.position.set(ox, -oy, 0);
      ring.group.scale.setScalar(ks);
      // obrót: port pod kątem stacji (place.rot), w soczewce poprzedzony obrotem przelotu bryły planety
      _qRot.setFromAxisAngle(_zAxis, e.place.rot);
      if (lensOn && lens.turned && lens.q) ring.group.quaternion.copy(lens.q).multiply(_qRot);
      else ring.group.quaternion.copy(_qRot);
      ring.update(dt, { camera: this.camera, viewportHeight: vh, gameView: !free3d });
      this._applySun(e, opts.sun);
      this._portVisuals(e, dt, opts.ship || null, gameDt);
    }
    this.stats.visible = visible;
    this.stats.updateMs = performance.now() - t0;
  }

  _applySun(e, sun) {
    const sx = Number(sun?.x);
    const sy = Number(sun?.y);
    const world = Number.isFinite(sx) && Number.isFinite(sy) ? Math.atan2(-(sy - e.place.y), sx - e.place.x) : 0;
    const local = world - e.place.rot;
    if (Math.abs(local - e.sunAz) < 1e-6) return;
    e.ring.setSun(local, HALO_GAME.sunElevationDeg * Math.PI / 180);
    e.sunAz = local;
  }

  // Światło dnia w punkcie ringu (cień planety) — lampy hal K-7 nocą.
  _daylight(e, x, y) {
    const ring = e.ring;
    const L = ring.layout;
    const s = ring.uniforms.uSunDir.value;
    const oz = -L.planetCenterZ;
    const t = -(x * s.x + y * s.y + oz * s.z);
    if (t <= 0) return 1;
    const d = Math.sqrt(Math.max(0, x * x + y * y + oz * oz - t * t));
    const R = L.planetRadius;
    const k = clamp01((d - (R - 500)) / 1300);
    return k * k * (3 - 2 * k);
  }

  // Lampki stanowisk hali z rejestru świata (zajętość pisze automat obsługi stanowisk i fabuła) — przy zmianie wersji.
  _syncBerthLamps(e, i, hall, owner, force = false) {
    if (!owner || !hall?.layout?.berths) return;
    if (!force && e.berthVersions[i] === owner.berthVersion) return;
    e.berthVersions[i] = owner.berthVersion;
    const src = owner.layout.berths;
    const dst = hall.layout.berths;
    for (let j = 0; j < dst.length; j++) {
      const b = dst[j];
      let g = src[j];
      if (!g || g.id !== b.id) g = src.find((x) => x.id === b.id) || null;
      b.occupied = g ? g.occupied : null;
      b.reserved = g ? g.reserved : null;
    }
    hall.setBerthLamps?.();
  }

  // Zanik dachów hal K-7 (statek w hali), wycięcia górnej ściany, lampy hal (automat obsługi stanowisk
  // i lampki — świat ringów gry; pozy z tej klatki).
  _portVisuals(e, dt, ship, gameDt = dt) {
    const ring = e.ring;
    const reg = e.collider.registry;
    const alive = ship && !ship.dead && ship.pos;
    const hull = alive ? e.collider.hubOutline(ship) : null;
    let hx = 0;
    let hz = 0;
    if (hull) {
      for (let i = 0; i < hull.length; i++) { hx += hull[i].x; hz += hull[i].z; }
      hx /= hull.length;
      hz /= hull.length;
    }
    e.hallFade = 0;
    e.hallIndex = -1;
    e.bayFade = 0;
    e.bayIndex = -1;
    for (let i = 0; i < e.hallFades.length; i++) {
      const f = e.hallFades[i];
      const c0 = f.footprint[0];
      if (!hull || (Math.hypot(hx - c0.x, hz - c0.z) > HALO_GAME.fadeHallRange && f.fade < 0.001)) { f.fade = 0; continue; }
      f.update(hull, dt);
      if (f.fade > e.hallFade) { e.hallFade = f.fade; e.hallIndex = i; }
    }
    for (let i = 0; i < e.bayFades.length; i++) {
      const f = e.bayFades[i];
      const c0 = f.footprint[0];
      if (!hull || (Math.hypot(hx - c0.x, hz - c0.z) > HALO_GAME.fadeBayRange && f.fade < 0.001)) { f.fade = 0; continue; }
      f.update(hull, dt);
      if (f.fade > e.bayFade) { e.bayFade = f.fade; e.bayIndex = i; }
    }
    // Fabuła (src/game/story/): intro nad K-7 — dach zamknięty mimo Atlasa w środku, potem płynne otwarcie;
    // wycięcie górnej ściany nad halą przez cały czas nadpisania (dach widać z góry).
    const ov = this.hallRoofOverride;
    const ovOn = !!ov && ov.key === e.key;
    if (ovOn) { e.hallIndex = ov.hall | 0; e.hallFade = Number.isFinite(ov.cut) ? ov.cut : 1; e.bayIndex = -1; e.bayFade = 0; }
    const halls = ring.k7Halls;
    for (let i = 0; i < halls.length; i++) {
      const hall = halls[i];
      if (!hall.root.visible) continue;
      const o = hall.frame.origin;
      const opts = this._hallOpts;
      opts.roofFade = (ovOn && i === (ov.hall | 0)) ? clamp01(Number(ov.roofFade) || 0) : (e.hallFades[i]?.fade || 0);
      opts.daylight = this._daylight(e, o.x, o.y);
      opts.clock = this.clock;
      // pozy obsługi stanowisk (zamki pola, ramiona i przewody paliwowe) — stan gry w rejestrze kolidera (fabuła,
      // automat obsługi stanowisk); ta sama mapa idzie do wejścia pyłu hal (źródła gazu z przewodów); lampki
      // stanowisk obsługiwanych przez automat — z niego
      const owner = reg.halls[i];
      opts.poses = owner?.poses || null;
      // ramiona i przewody w czasie gry (pauza i sceny fabuły — stoją), obrys kadłuba gracza w hubie TEJ hali
      opts.gameDt = gameDt;
      opts.hull = hull && owner?.inv ? this._hullInHall(hull, owner.inv) : null;
      this._syncBerthLamps(e, i, hall, owner);
      hall.update(dt, opts);
      // poziom lamp hali (dzień / noc) dla świateł hali w siatce gry liczy świat ringów gry (owner.lampLevel)
    }
    if (!alive) {
      ring.setCutaway(0, null);
      ring.setCutaway(1, null);
      return;
    }
    // wycięcie nad halą (gdy jej dach znika) albo nad zatoką, w której jest statek
    const inHall = e.hallFade >= e.bayFade && e.hallIndex >= 0;
    if (inHall || e.bayIndex >= 0) {
      const o = inHall ? reg.halls[e.hallIndex] : reg.bays[e.bayIndex];
      this._setHallCut(ring, o, inHall ? e.hallFade : e.bayFade, inHall);
    } else {
      ring.setCutaway(0, null);
    }
    // koło nad statkiem pod górną ścianą: wąwóz habitatu, tunel tranzytu, pas za kadłubem
    const L = ring.layout;
    const s = haloGameToLocal(e.place, ship.pos.x, ship.pos.y, this._local);
    const r = Math.hypot(s.x, s.y);
    const under = clamp01((L.radii.rim + 1300 - r) / 700) * clamp01((r - (L.radii.back - 1500)) / 700);
    const rad = Math.max(HALO_GAME.cutRadiusMin, (Number(ship.w) || 0) * 0.75);
    const cut = this._cut1;
    cut.x = s.x;
    cut.y = s.y;
    cut.angle = 0;
    cut.a = rad;
    cut.b = rad;
    cut.strength = under;
    ring.setCutaway(1, cut);
  }

  // Obrys kadłuba z huba hali gracza (rejestr kolidera) do huba hali `inv` (przejście ramek) — bufor wielokrotnego użytku.
  _hullInHall(hull, inv) {
    const out = this._hallHull;
    while (out.length < hull.length) out.push({ x: 0, z: 0 });
    out.length = hull.length;
    for (let i = 0; i < hull.length; i++) haloXfPoint(inv, hull[i].x, hull[i].z, out[i]);
    return out;
  }

  dispose() {
    for (const e of this.entries) {
      Core3D.removeShaftRingOccluder?.(e.occluderKey);
      e.shadowReady = false;
      if (!e.ring) continue;
      this.scene.remove(e.ring.group);
      e.ring.dispose();
      e.ring = null;
    }
    this.stats.rings = 0;
  }
}
