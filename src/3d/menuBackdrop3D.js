// Tło menu głównego (przed startem gry): Ziemia z ringiem „Halo” w kamerze
// kinowej. Ring jest ringiem GRY (HaloRingGame.showcaseRing — mapy dopiekają
// się już w menu, więc start przy Ziemi ma je gotowe), Ziemia i niebo to
// materiały kamery kinowej z dema ringu (dema/halo_ring_demo_env.js) przeliczone
// na układ lokalny ringu: oświetla je to samo słońce co ring (uSunDir), cień
// ringu na planecie liczy haloRingBlock. Materiały w TSL (menuBackdrop3D.tsl.js,
// port WebGPU — zadanie 11). Render: Core3D.renderBackdrop — ta sama scena,
// renderer, bloom i ACES co gra, tylko warstwa MENU_BACKDROP_LAYER (passy gry
// jej nie widzą). Tekstury Ziemi są pożyczone od planety gry (window.EARTH) —
// tło ich nie zwalnia. Słońce = słońce gry przy ringu (haloRings.gameSunLocal —
// stałe w układzie ringu), więc lot intro z menu nad K-7 nie zmienia oświetlenia;
// w gryzie Ziemi stoi elektrownia KOREK (earthBitePlant.js — własny egzemplarz
// tła, zwalniany w stop()).
//
//   const bd = new MenuBackdrop3D({ haloRings });
//   bd.start();                 // DOMContentLoaded, po initHaloRings
//   bd.setActive(menuVisible);  // pętla rAF tylko przy widocznym menu
//   bd.launch();                // start gry: przejazd kamery ({ dolly: false } — tylko planeta na środek kadru)
//   bd.stop();                  // przed pierwszą klatką gry: ring wraca do gry
import * as THREE from 'three';
import { loadTexture } from './canvas2d.js';
import { requestFrame, cancelFrame } from './harmonogram.js';
import { RenderWorld } from '../render/renderWorld.js';
import { FrameLimiter } from '../render/frameLimiter.js';
import { Core3D, MENU_BACKDROP_LAYER } from './core3d.js';
import { HALO_HDR, HALO_STATION_ANGLE } from './haloRing/haloRingConfig.js';
import { createMenuAtmosphereMaterial, createMenuEarthMaterial, createMenuSkyMaterial } from './menuBackdrop3D.tsl.js';
import { PLANET_MAPS } from './planetMaps.js';
import { earthBiteGeometry } from './earthBite3D.js';
import { earthBiteFrame } from './earthBiteShape.js';
import { EarthBitePlant, createPlantLook } from './earthBitePlant.js';
import { PLANT_LAYOUT } from './earthBitePlantFrame.js';
import { earthSpinQuaternion } from './earthSpin.js';
import { EARTH_BITE } from '../data/earthBite.js';

const DEG = Math.PI / 180;
// Odległość punktu słońca elektrowni od środka Ziemi [j.] — elektrownia liczy kierunek do słońca z sunPosition − świat.
const PLANT_SUN_DIST = 1e8;
// Odbiornik elektrowni w tle [R od środka Ziemi]: gryz leży w płaszczyźnie ringu, więc odbiornik stoi na wprost wewnętrznej
// ściany ringu (1,106 R) — iglice nadajnika (+0,031 R) z zapasem przed czaszą terminala przekaźnika na szynie (−0,019 R);
// w grze 1,075 R (gryz 10° nad ringiem, odbiornik nad wstęgą).
const MENU_PLANT_HUB_R = 1.04;
const _X = new THREE.Vector3(1, 0, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _qa = new THREE.Quaternion();

// Ujęcie w układzie lokalnym ringu: oś Z = oś ringu, środek planety (0, 0, cz).
// Kamera kołysze się („talerz”) pod słońcem gry stałym w układzie ringu, Ziemia
// obraca się wokół osi ringu.
export const MENU_SHOT = Object.freeze({
  distance: 196000,       // kamera od środka planety [j.]
  elevationDeg: 13,       // nad płaszczyzną ringu
  // Azymut: strona Ziemi z halą K-7 portu gracza (fabuła 2026-09-30 — kamera intro leci z tego ujęcia prosto
  // nad K-7, bez przelotu nad / przez planetę). Kamera = azymut hali + przesunięcie, lekko się kołysze.
  hallAzimuthOffsetDeg: 22,
  swayDeg: 7,             // kołysanie „talerza” zamiast pełnego obrotu (K-7 zostaje w kadrze)
  swayPeriodSec: 90,
  // Słońce gry (haloRings.gameSunLocal: azymut z położenia Słońca, wysokość HALO_GAME.sunElevationDeg) — menu, lot
  // intro i gra w tym samym świetle (dawniej słońce „talerza” szło za kamerą, a lot przesuwał je w słońce gry).
  // false albo `?menuSlonce=talerz` — dawne słońce talerza (sunOffsetDeg / sunElevationDeg); bez słońca gry — też ono.
  gameSun: true,
  sunOffsetDeg: 50,       // talerz: azymut słońca względem kamery
  sunElevationDeg: 27,    // talerz: słońce nad płaszczyzną ringu
  fovDeg: 30,
  rollDeg: -12,           // przechył horyzontu ringu
  shiftX: 0.22,           // planeta w prawo od środka kadru (ułamek szerokości)
  shiftY: 0.02,
  focusShiftX: 0.3,       // otwarty panel podmenu: planeta dalej w prawo
  earthSpin: 0.004,       // obrót Ziemi [rad/s] — gryz z elektrownią zostaje na tarczy ~5 min (stop() oddaje kąt grze)
  cloudSpin: 0.0065,
  // Gryz Ziemi z elektrownią KOREK na starcie: azymut względem kamery (dodatni = na prawo od środka tarczy, z dala od hali
  // K-7 — końcówka lotu intro z góry nad halą bez gryzu w kadrze); doba niesie go w prawo, ku brzegowi (dawniej gryz
  // stał 38° w prawo i schodził za brzeg po ~2,5 min menu).
  biteAzimuthOffsetDeg: 15,
  introSeconds: 7.5,      // najazd po gotowości
  introDistanceMul: 1.4,
  introElevationDeg: 5,
  parallaxDeg: 1.3,       // paralaksa za kursorem
  launchSeconds: 2.8,     // przejazd przy starcie gry
  launchDistanceMul: 0.62,
  // mgławica gry na niebie: środek względem kierunku kamera → planeta
  nebulaYawDeg: 22,
  nebulaPitchDeg: 8,
  nebulaRollDeg: -24,
  nebulaHalfWidthDeg: 58,
  nebulaGain: 1.15
});

const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeOutCubic = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);


// Mapy Ziemi jak w grze (planetMaps.js) — gdy planeta gry jeszcze nie istnieje, menu wczytuje je samo.
const TEXTURE_PATHS = PLANET_MAPS.earth;

function textureLoaded(tex) {
  const img = tex?.image;
  if (!img) return false;
  if (img.complete === false) return false;
  return (img.naturalWidth || img.width || 0) > 0;
}

export class MenuBackdrop3D {
  constructor({ haloRings = null, planetKey = 'earth', shot = MENU_SHOT } = {}) {
    this.haloRings = haloRings;
    this.planetKey = planetKey;
    this.shot = { ...shot };
    this.camera = new THREE.PerspectiveCamera(this.shot.fovDeg, 1, 100, 500000);
    this.ring = null;
    this.running = false;
    this.active = false;
    this.ready = false;
    this.readyAt = -1;
    this.time = 0;
    this.orbit = 0;
    this.flight = null;       // lot kamery fabuły (fly)
    this.sunLocal = { az: 0, el: 0 };
    this.focus = 0;
    this.focusTarget = 0;
    this.launchAt = -1;
    this.launchDolly = true;
    this.frozen = false;
    this.stats = { frames: 0, frameMs: 0, mapsReady: false, texturesReady: false, warmupMs: 0, ringBuildMs: 0, compileMs: 0, readyAtMs: 0 };
    this._live = false;
    this._raf = 0;
    this._last = 0;
    this._pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    this._readyCallbacks = [];
    this._textures = null;
    this._ownTextures = [];
    this._warmed = new Set();
    this._objects = null;
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._inv = new THREE.Matrix4();
    this._sw = new THREE.Vector3();
    this._gameSunOut = { az: 0, el: 0 };
    // A/B dawnego słońca talerza: `?menuSlonce=talerz` (adres strony — działa też w workerze renderu)
    this._sunTalerz = /[?&]menuSlonce=talerz(?:[&#]|$)/i.test(String(RenderWorld.pageSearch || ''));
    this._tick = (now) => this._frame(now);
    this._onVisibility = () => this._sync();
    this.onRendered = null;
    this._limiter = null;     // limit klatek (setFrameLimit)
  }

  // Start w tle (menu zostaje responsywne, pod kurtyną .mm-curtain): ring gry
  // (showcase — budowa asynchroniczna: pieczenie map, odczyt CPU, bryły, ich
  // pipeline'y w tle przed podpięciem), równolegle Ziemia i niebo i ich
  // pipeline'y (Core3D.warmup.now) oraz tekstury Ziemi w kolejce wgrywania —
  // pętla renderu rusza dopiero z gotowym ringiem, więc pierwsza klatka menu nie
  // kompiluje niczego. Bez Core3D albo ringu — false (menu zostaje na tle CSS).
  start() {
    if (this.running) return true;
    if (!Core3D.isInitialized || !this.haloRings) return false;
    this.running = true;
    RenderWorld.onVisibilityChange(this._onVisibility);
    this._startAsync().catch((err) => {
      console.error('[MenuBackdrop3D] start nie wyszedł — zostaje tło CSS', err);
      this.stop();
    });
    return true;
  }

  async _startAsync() {
    // Urządzenie WebGPU powstaje w tle po Core3D.init() — pieczenie map ringu,
    // kompilacja i render czekają na nie. Bez WebGPU tła nie ma (menu pokazuje
    // komunikat, index.html), zostaje tło CSS.
    const gpuOk = await Core3D.ready;
    if (!gpuOk || !this.running) {
      if (!gpuOk) this.stop();
      return;
    }
    const t0 = performance.now();
    // 1) ring gry: budowa asynchroniczna (pipeline'y pieczenia na prawdziwych
    //    celach w HaloWorldMaps.init, bryły rozgrzewa hak prewarm HaloRingGame
    //    przed podpięciem — Core3D.warmup)
    const ring = this.haloRings.showcaseRing(this.planetKey);
    if (!ring) throw new Error('brak ringu planety ' + this.planetKey);
    this.ring = ring;
    ring.setLayers({ default: MENU_BACKDROP_LAYER, fg: MENU_BACKDROP_LAYER });
    ring.setCutaway(0, null);
    ring.setCutaway(1, null);
    ring.group.visible = true;
    this._textures = this._resolveTextures();
    this._objects = this._build(ring);
    // 2) w czasie budowy ringu: pipeline'y Ziemi, poświaty i nieba (kamera kinowa,
    //    warstwa tła); tekstury Ziemi wgrywa w wolnych chwilach kolejka Core3D
    //    (pożyczone — planet3d.assets.js po wczytaniu, własne — _resolveTextures)
    const o = this._objects;
    const ownWarm = Core3D.warmup.now([o.earthGroup, o.sky], {
      name: 'tło menu: Ziemia i niebo', camera: this.camera, layer: MENU_BACKDROP_LAYER, alive: () => this.running
    }).then(() => { this.stats.warmupMs = performance.now() - t0; });
    // 3) ring gotowy = bryły zbudowane, rozgrzane i podpięte (pusty ring przy
    //    nieudanej budowie: tło rusza, ale gotowość czeka na mapy jak dawniej)
    await ring.ready;
    this.stats.ringBuildMs = performance.now() - t0;
    await ownWarm;
    this.stats.compileMs = performance.now() - t0;
    if (!this.running) return;
    this._live = true;
    this._last = performance.now();
    this._sync();
  }

  // Menu widoczne → pętla renderu; schowane (edytor, nakładki split-screen)
  // albo karta w tle → stop bez zwalniania czegokolwiek.
  setActive(on) {
    this.active = !!on;
    this._sync();
  }

  // Kursor w [-1, 1] (środek ekranu = 0) — paralaksa kamery.
  setPointer(nx, ny) {
    this._pointer.x = Math.max(-1, Math.min(1, Number(nx) || 0));
    this._pointer.y = Math.max(-1, Math.min(1, Number(ny) || 0));
  }

  // 0 = ekran główny menu, 1 = otwarty panel podmenu (planeta ustępuje w prawo).
  setFocus(k) {
    this.focusTarget = Math.max(0, Math.min(1, Number(k) || 0));
  }

  // Limit klatek z opcji grafiki (src/render/frameLimiter.js): pętla tła rysuje najwyżej `fps` klatek na sekundę
  // (0 — bez limitu); `vsync` — VSync tego uruchomienia (false: limit czasem); `bypass` — () => true: klatka bez limitu
  // (strona w trybie off: harness narzędzi z zegarem wirtualnym, jak pętla gry). Strona: blok „OPCJE GRAFIKI”
  // (tryb worker — przez pełnomocnika, op `frameLimit`, bez `bypass`: rAF i zegar workera są prawdziwe).
  setFrameLimit(fps, vsync = true, bypass = null) {
    if (!this._limiter) {
      if (!(Number(fps) > 0)) return;
      this._limiter = new FrameLimiter();
    }
    this._limiter.setFps(fps);
    this._limiter.setVsync(vsync);
    this._limiter.bypass = typeof bypass === 'function' ? bypass : null;
  }

  // Najbliższa klatka pętli tła bez limitu (strona w trybie off: zmiana rozmiaru okna wyczyściła kanwę Core3D —
  // pominięta klatka zostawiłaby ją pustą do następnej w takcie limitu).
  forceNextFrame() {
    if (this._limiter) this._limiter.forceNext();
  }

  // Start gry: najazd kamery na ring, trwa do stop(). dolly: false — kamera stoi, tylko planeta wraca na środek kadru
  // (kampania: dalej leci jeden tor intro z tej pozy — dojazd tu dawał „do Ziemi, odjazd, drugi najazd na dok”).
  launch({ dolly = true } = {}) {
    if (this.launchAt < 0) {
      this.launchAt = this.time;
      this.launchDolly = dolly !== false;
    }
  }

  /** Przejazd startu gry zakończony (kadr stoi — można zacząć lot fabuły bez skoku). */
  get launchDone() {
    return this.launchAt >= 0 && this.time - this.launchAt >= this.shot.launchSeconds;
  }

  // Ostatnia poza kamery kinowej (świat THREE): oko, cel = środek planety tła, góra (z przechyłem), fov.
  // Fabuła (src/game/story/storyGame.js) zaczyna z niej lot kamery intro — przed stop(), który oddaje ring grze.
  cameraPose() {
    if (!this.ring || this.stats.frames < 1) return null;
    const e = this.camera.position, t = this._t, u = this.camera.up;
    return { eye: { x: e.x, y: e.y, z: e.z }, target: { x: t.x, y: t.y, z: t.z }, up: { x: u.x, y: u.y, z: u.z }, fov: this.camera.fov };
  }

  onReady(fn) {
    if (typeof fn !== 'function') return;
    if (this.ready) fn();
    else this._readyCallbacks.push(fn);
  }

  // Ring wraca do gry (warstwy, słońce, widoczność), obiekty tła zwolnione.
  // Także w trakcie startu w tle — _startAsync kończy się po najbliższym await.
  stop() {
    if (!this.running) return;
    this.running = false;
    this._live = false;
    this.active = false;
    this._sync();
    RenderWorld.offVisibilityChange(this._onVisibility);
    const o = this._objects;
    // ta sama Ziemia: gra przejmuje kąt doby i chmur tła (lądy pod halą K-7 bez skoku przy cięciu menu → gra)
    if (o) {
      const sg = this._gameSpinAtCut(o);
      this._gameEarth?.setSpin?.(sg, sg + o.cloudSpin - o.spin);
    }
    if (o) {
      o.earthGroup.parent?.remove(o.earthGroup);
      o.sky.parent?.remove(o.sky);
      o.plant?.dispose();
      for (const m of o.materials) m.dispose();
      for (const g of o.geometries) g.dispose();
    }
    for (const tex of this._ownTextures) tex.dispose();
    this._ownTextures.length = 0;
    this._objects = null;
    this.haloRings?.releaseShowcase(this.planetKey);
    this.ring = null;
    this._readyCallbacks.length = 0;
  }

  // ---------------------------------------------------------------------
  _sync() {
    const want = this.running && this._live && this.active && !RenderWorld.pageHidden;
    if (want && !this._raf) {
      this._last = performance.now();
      this._raf = requestFrame(this._tick);
    } else if (!want && this._raf) {
      cancelFrame(this._raf);
      this._raf = 0;
    }
  }

  _resolveTextures() {
    const src = typeof window !== 'undefined' ? window.EARTH : null;
    this._gameEarth = src || null;   // Ziemia gry (DirectPlanet) — stop() oddaje jej kąt doby tła
    const u = src?.uniforms;
    const pick = (tex, path, srgb) => {
      if (tex?.isTexture) return tex;
      const own = loadTexture(path, (t) => Core3D.queueTextureUpload(t));
      if (srgb) own.colorSpace = THREE.SRGBColorSpace;
      own.anisotropy = Core3D.getMaxAnisotropy();
      this._ownTextures.push(own);
      return own;
    };
    return {
      day: pick(u?.dayTexture?.value, TEXTURE_PATHS.day, true),
      night: pick(u?.nightTexture?.value, TEXTURE_PATHS.night, true),
      spec: pick(u?.specularTexture?.value, TEXTURE_PATHS.spec, false),
      normal: pick(u?.normalTexture?.value, TEXTURE_PATHS.normal, false),
      clouds: pick(src?.cloudUniforms?.cloudTexture?.value, TEXTURE_PATHS.clouds, true)
    };
  }

  _build(ring) {
    const L = ring.layout;
    const R = L.planetRadius;
    const tex = this._textures;
    const materials = [];
    const geometries = [];

    // Ziemia i poświata limbu: materiały TSL w układzie ringu (menuBackdrop3D.tsl.js)
    const pit = !!PLANET_MAPS.earth.pit;
    const air = PLANET_MAPS.earth.menuAir || null;
    const earthM = createMenuEarthMaterial(ring, tex, { pitMode: pit ? 1 : 0, air });
    const atmM = createMenuAtmosphereMaterial(ring, R + 1250, { bite: pit });
    const sphere = new THREE.SphereGeometry(1, 192, 128);
    const atmSphere = new THREE.SphereGeometry((R + 1250) / R, 128, 96);
    materials.push(earthM.material, atmM.material);
    geometries.push(sphere, atmSphere);

    // Grupa planety w grupie ringu: biegun (oś Y sfery) = oś ringu (Z).
    const earthGroup = new THREE.Group();
    earthGroup.name = 'MenuEarth';
    earthGroup.position.set(0, 0, L.planetCenterZ);
    earthGroup.rotation.x = Math.PI / 2;
    earthGroup.scale.setScalar(R);
    const earth = new THREE.Mesh(sphere, earthM.material);
    let pitMesh = null;
    let plant = null;
    let spin0 = 0;
    // oś obrotu: z gryzem — przechylona tak, że gryz leży w płaszczyźnie ringu (menuEarthAxis); bez gryzu — biegun
    const axis = pit ? menuEarthAxis() : new THREE.Vector3(0, 1, 0);
    const base = menuEarthBase(axis);
    if (pit) {
      // wielki gryz: łata (ściany, dno, kołnierz) na kuli (geometria wspólna z grą — nie zwalniana tutaj)
      const pitM = createMenuEarthMaterial(ring, tex, { pitMode: 2, shared: earthM.uniforms, air });
      materials.push(pitM.material);
      pitMesh = new THREE.Mesh(earthBiteGeometry(), pitM.material);
      pitMesh.name = 'MenuEarthBite';
      earth.add(pitMesh);
      // elektrownia KOREK na dnie gryzu (jak w grze: dziecko kuli, układ obiektu R = 1): słońce tła w sunPosition
      // (renderFrame), bez maski słońca gry; bryły ~0,5 s CPU — start tła idzie w tle, pod kurtyną
      const { C } = earthBiteFrame(EARTH_BITE);
      const t0 = performance.now();
      // liny wind, szyna i przekaźnik z osi ringu tła (ringAxis); odbiornik niżej — stoi na wprost ściany ringu
      const look = createPlantLook({
        ringAxis: axis.toArray(), hubRadius: Math.min(PLANT_LAYOUT.hubRadius, MENU_PLANT_HUB_R)
      });
      plant = new EarthBitePlant({
        sunPosition: { value: new THREE.Vector3() },
        uBite: { value: new THREE.Vector4(C[0], C[1], C[2], EARTH_BITE.radiusR) },
        uSunShadowRecv: { value: 0 }
      }, { look });
      plant.attachRing(axis);
      plant.settleRelay();
      earth.add(plant.group);
      this.stats.plantMs = performance.now() - t0;
      spin0 = menuBiteSpin(this.shot, axis);
    }
    const atmosphere = new THREE.Mesh(atmSphere, atmM.material);
    atmosphere.renderOrder = 6;
    earthGroup.add(earth, atmosphere);

    // Mgławica tła gry (NebulaSystem, planet3d.assets.js) — pożyczona tekstura.
    const nebulaMap = Core3D.scene.getObjectByName('Nebula')?.material?.uniforms?.map?.value || null;
    const skyM = createMenuSkyMaterial({ nebulaMap, sunCore: HALO_HDR.sunDisk });
    const skyGeo = new THREE.SphereGeometry(1, 64, 32);
    materials.push(skyM.material);
    geometries.push(skyGeo);
    if (skyM.placeholder) this._ownTextures.push(skyM.placeholder);
    const sky = new THREE.Mesh(skyGeo, skyM.material);
    sky.name = 'MenuSky';
    sky.frustumCulled = false;
    sky.renderOrder = -1000;

    for (const obj of [earthGroup, sky]) obj.traverse((o) => o.layers.set(MENU_BACKDROP_LAYER));
    ring.group.add(earthGroup, sky);
    return {
      earthGroup, earth, pitMesh, plant, atmosphere, sky, earthUniforms: earthM.uniforms, atmUniforms: atmM.uniforms, skyUniforms: skyM.uniforms,
      hasNebula: !!nebulaMap, materials, geometries, axis, base, spin: spin0, cloudSpin: spin0
    };
  }

  // Tekstury Ziemi wczytane i wgrane (po jednej na klatkę, żeby upload 8K
  // nie trafił w pierwszą klatkę po zdjęciu kurtyny).
  _texturesReady() {
    let ok = true;
    let warmedThisFrame = false;
    for (const tex of Object.values(this._textures)) {
      if (!textureLoaded(tex)) { ok = false; continue; }
      if (this._warmed.has(tex)) continue;
      ok = false;
      if (warmedThisFrame) continue;
      try { Core3D.renderer.initTexture(tex); } catch { /* wgra się przy renderze */ }
      this._warmed.add(tex);
      warmedThisFrame = true;
    }
    return ok;
  }

  // Kąt doby Ziemi gry (doba wokół bieguna geograficznego — earthSpin.js) przy cięciu menu → gra: punkt gruntu tła pod
  // halą K-7 portu gracza (kadr końca lotu intro) trafia w grze pod tę samą halę. Przy osi tła = biegun to dokładnie kąt
  // doby tła; przy przechylonej osi (gryz w płaszczyźnie ringu) długość pod halą zgodna, szerokość różni się o ≤ przechył.
  _gameSpinAtCut(o) {
    const q = this._q.copy(o.earthGroup.quaternion).multiply(o.earth.quaternion).invert();   // siatka ← ring
    const p = this._p.set(Math.cos(HALO_STATION_ANGLE), Math.sin(HALO_STATION_ANGLE), 0).applyQuaternion(q);
    // Ziemia gry w układzie sceny: Rx(π/2) · Ry(kąt); układ ringu = scena obrócona o rotation.z grupy ringu
    return HALO_STATION_ANGLE - Math.atan2(-p.z, p.x) + (this.ring?.group?.rotation?.z || 0);
  }

  // Słońce gry w układzie ringu ({ az, el } — ten sam obiekt co klatkę) albo null (bez słońca gry / talerz).
  _gameSun() {
    if (!this.shot.gameSun || this._sunTalerz) return null;
    const rings = this.haloRings;
    const sun = RenderWorld.sun;
    if (!sun || typeof rings?.gameSunLocal !== 'function') return null;
    const v = rings.gameSunLocal(this.planetKey, sun, this._gameSunOut);
    return v && Number.isFinite(v.az) && Number.isFinite(v.el) ? v : null;
  }

  // Płat mgławicy w układzie nieba (kamera na azymucie 0, patrzy ku −X); tarczę słońca stawia renderFrame (sunLocal).
  _skyFrame(su, s) {
    const yaw = Math.PI + s.nebulaYawDeg * DEG;
    const pitch = (s.nebulaPitchDeg - s.elevationDeg) * DEG;
    const c = su.uNebC.value.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch));
    const r = su.uNebR.value.crossVectors(c, this._up.set(0, 0, 1)).normalize();
    const u = su.uNebU.value.crossVectors(r, c).normalize();
    const roll = s.nebulaRollDeg * DEG;
    r.applyAxisAngle(c, roll);
    u.applyAxisAngle(c, roll);
    const half = s.nebulaHalfWidthDeg * DEG;
    su.uNebHalf.value.set(half, half / 1.6);
    // bez mgławicy gry węzeł ma teksturę zastępczą — płat wyłączony
    su.uNebulaGain.value = this._objects?.hasNebula ? s.nebulaGain : 0;
  }

  _frame(now) {
    this._raf = 0;
    if (!this.running || !this.active) return;
    this._raf = requestFrame(this._tick);
    // limit klatek: klatka poza taktem bez rysunku — dt następnej narysowanej obejmuje pominięte (_last zostaje)
    if (this._limiter && !this._limiter.tick(now)) return;
    const t0 = performance.now();
    const dt = this.frozen ? 0 : Math.min(0.1, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    this.renderFrame(dt);
    // worker renderu (RW-41c): bitmapa klatki do strony w tym samym zadaniu co render
    if (this.onRendered) this.onRendered();
    this.stats.frameMs = this.stats.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  // Jedna klatka tła (pętla rAF albo zrzuty: renderFrame(0) po ustawieniu kadru).
  renderFrame(dt = 0) {
    const ring = this.ring;
    const o = this._objects;
    if (!ring || !o) return;
    const s = this.shot;
    this.time += dt;
    this.orbit = s.swayDeg * Math.sin((this.time * Math.PI * 2) / Math.max(1, s.swayPeriodSec));
    // jakość z opcji menu (jak haloRings.update w grze): zmiana = przebudowa ringu
    this.haloRings.setQuality(RenderWorld.options?.planetQuality || this.haloRings.qualityKey);
    const L = ring.layout;

    if (!this.ready) {
      const texOk = this._texturesReady();
      this.stats.texturesReady = texOk;
      this.stats.mapsReady = !!ring.mapsReady;
      if (texOk && ring.mapsReady && this.stats.frames > 2) {
        this.ready = true;
        this.readyAt = this.time;
        this.stats.readyAtMs = performance.now();
        const cbs = this._readyCallbacks.splice(0);
        for (const fn of cbs) { try { fn(); } catch (err) { console.error('[MenuBackdrop3D] onReady', err); } }
      }
    }

    // płynne dojście paralaksy i kadru panelu
    const kp = 1 - Math.exp(-dt * 2.2);
    const pt = this._pointer;
    pt.sx += (pt.x - pt.sx) * kp;
    pt.sy += (pt.y - pt.sy) * kp;
    this.focus += (this.focusTarget - this.focus) * (1 - Math.exp(-dt * 2.6));

    const intro = this.ready ? easeOutCubic((this.time - this.readyAt) / s.introSeconds) : 0;
    const launch = this.launchAt >= 0 ? smooth01((this.time - this.launchAt) / s.launchSeconds) : 0;

    // słońce idzie z kamerą: stałe oświetlenie kadru
    const az = this.flight ? this.flight.skyAz : menuAzimuth(s, this.orbit) - pt.sx * s.parallaxDeg * DEG;
    const cz = L.planetCenterZ;
    ring.group.updateMatrix();
    const M = ring.group.matrix;
    const cam = this.camera;
    const target = Core3D.composerTarget;
    const vw = Math.max(1, target?.width || RenderWorld.viewWidth);
    const vh = Math.max(1, target?.height || RenderWorld.viewHeight);
    // niebo obrócone o azymut kamery: w jego układzie kamera stoi na azymucie 0
    o.sky.rotation.z = az;
    this._skyFrame(o.skyUniforms, s);
    if (this.flight) {
      this._flightFrame(dt, ring, o, L, M, cz, vw, vh);
    } else {
      // słońce gry (stałe w układzie ringu — kamera kołysze się pod nim) albo dawny talerz: słońce idzie z kamerą
      const gs = this._gameSun();
      this.sunLocal.az = gs ? gs.az : az + s.sunOffsetDeg * DEG;
      this.sunLocal.el = gs ? gs.el : s.sunElevationDeg * DEG;
      ring.setSun(this.sunLocal.az, this.sunLocal.el);

      // kamera w układzie ringu → świat (grupa ringu leży w scenie bez rodzica)
      const dolly = this.launchDolly ? launch : 0;
      const dist = s.distance
        * (1 + (s.introDistanceMul - 1) * (1 - intro))
        * (1 + (s.launchDistanceMul - 1) * dolly);
      const el = (s.elevationDeg + s.introElevationDeg * (1 - intro) + pt.sy * s.parallaxDeg * 0.6) * DEG;
      const cosEl = Math.cos(el);
      const pos = this._p.set(Math.cos(az) * cosEl * dist, Math.sin(az) * cosEl * dist, Math.sin(el) * dist + cz);
      const tgt = this._t.set(0, 0, cz);
      const camLocalX = pos.x;
      const camLocalY = pos.y;
      const camLocalZ = pos.z;
      pos.applyMatrix4(M);
      tgt.applyMatrix4(M);
      cam.position.copy(pos);
      const fwd = this._f.subVectors(tgt, pos).normalize();
      const up = this._up.set(0, 0, 1);
      this._q.setFromAxisAngle(fwd, s.rollDeg * DEG);
      up.applyQuaternion(this._q);
      cam.up.copy(up);
      cam.lookAt(tgt);

      // near z analitycznej odległości do ringu (z halami K-7) i planety
      const r = Math.hypot(camLocalX, camLocalY);
      const dr = Math.max(L.radii.min - r, 0, r - L.radii.max - 9000);
      const dzr = Math.max(L.bounds.zMin - camLocalZ, 0, camLocalZ - L.bounds.zMax);
      const dRing = Math.hypot(dr, dzr);
      const dCenter = Math.hypot(camLocalX, camLocalY, camLocalZ - cz);
      const dPlanet = Math.max(1, dCenter - L.planetRadius);
      cam.fov = s.fovDeg * (1 - 0.12 * dolly);
      cam.aspect = vw / vh;
      cam.near = Math.min(20000, Math.max(1, Math.min(dRing, dPlanet) * 0.35));
      cam.far = Math.max(cam.near * 1000, dCenter + L.radii.max + 90000);
      // start gry: menu zjeżdża w lewo, planeta wraca na środek kadru
      const shiftX = (s.shiftX + (s.focusShiftX - s.shiftX) * smooth01(this.focus)) * (1 - launch);
      cam.setViewOffset(vw, vh, -shiftX * vw, s.shiftY * (1 - launch) * vh, vw, vh);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    }
    // tarcza słońca na niebie tła: kierunek słońca ringu w układzie nieba (obróconego o azymut kamery / lotu)
    const sa = this.sunLocal.az - az;
    const se = this.sunLocal.el;
    o.skyUniforms.uSunDir.value.set(Math.cos(sa) * Math.cos(se), Math.sin(sa) * Math.cos(se), Math.sin(se));

    // Ziemia: obrót i przesunięcie chmur, macierz siatka → ring
    o.spin += dt * s.earthSpin;
    o.cloudSpin += dt * s.cloudSpin;
    earthSpinQuaternion(o.spin, o.axis, o.base, o.earth.quaternion);
    const shift = ((o.cloudSpin - o.spin) / (Math.PI * 2)) % 1;
    o.earthUniforms.uCloudShift.value = shift < 0 ? shift + 1 : shift;
    o.earthGroup.updateMatrix();
    o.earth.updateMatrix();
    o.atmosphere.updateMatrix();
    o.earthUniforms.uLocal.value.multiplyMatrices(o.earthGroup.matrix, o.earth.matrix);
    // słońce w układzie siatki Ziemi (cień ścian gryzu liczy łata); poświata: układ ringu → siatka Ziemi (wcięcie)
    this._inv.copy(o.earthUniforms.uLocal.value).invert();
    o.earthUniforms.uSunObj.value.copy(ring.uniforms.uSunDir.value).transformDirection(this._inv);
    o.atmUniforms.uLocal.value.multiplyMatrices(o.earthGroup.matrix, o.atmosphere.matrix);
    o.atmUniforms.uEarthInv.value.copy(this._inv);
    if (o.plant) {
      // elektrownia: punkt słońca w świecie (środek Ziemi + kierunek słońca ringu × PLANT_SUN_DIST), zegar efektów
      const sw = this._sw.copy(ring.uniforms.uSunDir.value).transformDirection(M).multiplyScalar(PLANT_SUN_DIST);
      o.plant.uniforms.sunPosition.value.set(0, 0, cz).applyMatrix4(M).add(sw);
      o.plant.update(dt);
    }

    // lot fabuły: w końcówce (kamera prawie z góry) ring liczy jak w kamerze gry — wycięcia nad halą i górna ściana
    const fl = this.flight;
    ring.update(dt, { camera: cam, viewportHeight: vh, gameView: !!(fl && fl.gameView && fl.gameView(fl.w)) });
    // lampy hal K-7: noc w cieniu planety
    const sd = ring.uniforms.uSunDir.value;
    for (const hall of ring.k7Halls) {
      if (!hall.root.visible) continue;
      const h = hall.frame.origin;
      const oz = -cz;
      const tt = -(h.x * sd.x + h.y * sd.y + oz * sd.z);
      let daylight = 1;
      if (tt > 0) {
        const d = Math.sqrt(Math.max(0, h.x * h.x + h.y * h.y + oz * oz - tt * tt));
        daylight = smooth01((d - (L.planetRadius - 500)) / 1300);
      }
      hall.update(dt, { daylight });
    }

    Core3D.renderBackdrop(cam);
    this.stats.frames++;
    const f = this.flight;
    if (f) {
      f.onFrame?.(f.w, ring);
      if (f.finished && !f.resolved) {
        f.resolved = true;
        // ostatnia klatka toru — w TYM SAMYM zadaniu co render (kanwa WebGPU po nim bywa pusta): kopia dla przenikania
        try { f.onFinish?.(Core3D.canvas); } catch (err) { console.warn('[MenuBackdrop3D] onFinish', err); }
        f.resolve?.();
      }
    }
  }

  /**
   * Lot kamery fabuły (src/game/story/storyGame.js — planMenuIntro): tor w świecie THREE od bieżącej pozy tła nad halę
   * K-7, słońce ringu i Ziemi tła przechodzi w słońce gry (sun(w) → { az, el } w układzie ringu). flight:
   *   { duration, sample(t, out{eye,target,up,fov}), sun?(w), gameView?(w), onFrame?(w, ring), onFinish?(canvas) }
   *   → Promise (ostatnia klatka toru narysowana; onFinish dostaje kanwę w tym samym zadaniu co jej render).
   * devTime (harness zrzutów) — stała chwila toru.
   */
  fly(flight) {
    if (!flight || !(flight.duration > 0) || typeof flight.sample !== 'function') return Promise.resolve(false);
    const s = this.shot;
    this.flight = {
      ...flight, t: 0, w: 0, devTime: NaN, finished: false, resolved: false, resolve: null,
      skyAz: menuAzimuth(s, this.orbit),
      pose: { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, fov: 30 }
    };
    const f = this.flight;
    return new Promise((resolve) => { f.resolve = () => resolve(true); });
  }

  _flightFrame(dt, ring, o, L, M, cz, vw, vh) {
    const f = this.flight;
    if (!Number.isFinite(f.devTime)) f.t = Math.min(f.duration, f.t + dt);
    const t = Number.isFinite(f.devTime) ? f.devTime : f.t;
    f.w = Math.min(1, Math.max(0, t / f.duration));
    f.sample(t, f.pose);
    const sun = f.sun ? f.sun(f.w) : null;
    if (sun) {
      // słońce menu = słońce gry (MENU_SHOT.gameSun), więc tor zwykle go nie przesuwa; talerz — przejście w słońce gry
      this.sunLocal.az = sun.az;
      this.sunLocal.el = sun.el;
      ring.setSun(sun.az, sun.el);
    }
    const p = f.pose;
    const cam = this.camera;
    cam.position.set(p.eye.x, p.eye.y, p.eye.z);
    cam.up.set(p.up.x, p.up.y, p.up.z);
    cam.lookAt(p.target.x, p.target.y, p.target.z);
    // near / far jak w ujęciu menu: analityczna odległość do ringu i planety w układzie ringu
    const loc = this._p.copy(cam.position).applyMatrix4(this._inv.copy(M).invert());
    const r = Math.hypot(loc.x, loc.y);
    const dr = Math.max(L.radii.min - r, 0, r - L.radii.max - 9000);
    const dzr = Math.max(L.bounds.zMin - loc.z, 0, loc.z - L.bounds.zMax);
    const dRing = Math.hypot(dr, dzr);
    const dCenter = Math.hypot(loc.x, loc.y, loc.z - cz);
    const dPlanet = Math.max(1, dCenter - L.planetRadius);
    cam.fov = p.fov;
    cam.aspect = vw / vh;
    cam.near = Math.min(20000, Math.max(1, Math.min(dRing, dPlanet) * 0.35));
    cam.far = Math.max(cam.near * 1000, dCenter + L.radii.max + 90000);
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    if (t >= f.duration && !Number.isFinite(f.devTime)) f.finished = true;
  }
}

// Azymut kamery menu (układ ringu): hala K-7 portu gracza + przesunięcie + kołysanie.
function menuAzimuth(s, sway) {
  return HALO_STATION_ANGLE + (s.hallAzimuthOffsetDeg + sway) * DEG;
}

/**
 * Oś obrotu Ziemi tła (układ siatki kuli): biegun północny przechylony w płaszczyźnie południka gryzu (o jego szerokość,
 * 10°) tak, że środek gryzu leży na równiku obrotu — w płaszczyźnie ringu. Promień z korka do odbiornika i przekaźnik
 * celują wtedy w środek wstęgi ringu (zgłoszenie 2026-10-31: „środek elektrowni w menu nie celuje w środek ringu” — przy
 * osi gry, biegunie geograficznym, gryz leży 10° nad ringiem i z kamery z boku promień mijał wstęgę). Gra bez zmian.
 */
export function menuEarthAxis(out = new THREE.Vector3()) {
  const { C } = earthBiteFrame(EARTH_BITE);
  const c = new THREE.Vector3(C[0], C[1], C[2]).normalize();
  return out.set(0, 1, 0).addScaledVector(c, -c.y).normalize();
}

/**
 * Baza obrotu siatki Ziemi względem jej grupy (grupa obraca o π/2 wokół X: oś Y siatki → oś ringu Z): oś obrotu → oś
 * ringu. Orientacja siatki = baza · obrót wokół osi o kąt doby (earthSpinQuaternion); przy osi Y — tożsamość (dawne
 * rotation.y = kąt doby).
 */
export function menuEarthBase(axis, out = new THREE.Quaternion()) {
  return out.setFromAxisAngle(_X, -Math.PI / 2).multiply(_qa.setFromUnitVectors(axis, _Z));
}

/**
 * Kąt doby Ziemi tła na starcie [rad]: środek gryzu na azymucie kamery (bez kołysania) + biteAzimuthOffsetDeg. Środek
 * gryzu leży na równiku obrotu, więc w układzie ringu jego azymut = azymut (baza ring ← siatka · C) + kąt doby.
 */
export function menuBiteSpin(shot = MENU_SHOT, axis = menuEarthAxis()) {
  const { C } = earthBiteFrame(EARTH_BITE);
  const c = new THREE.Vector3(C[0], C[1], C[2]).applyQuaternion(_qa.setFromUnitVectors(axis, _Z));
  return menuAzimuth(shot, 0) + shot.biteAzimuthOffsetDeg * DEG - Math.atan2(c.y, c.x);
}
