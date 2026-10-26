// ============================================================
// NIEBO GRY W NIESKOŃCZONOŚCI.
//   • SkySphere (niżej, DECYZJE-2 N1–N3, domyślne): sfera nieba obracana z drogi statku — w kamerze z góry czworokąt
//     pełnoekranowy (rzut równoodległy) z pamięcią nieba i kwady jasnych gwiazd, w kamerach 3D sfera Sky3D z tą samą
//     treścią (tekstura equirect z wypiekacza + gwiazdy w przestrzeni kierunków). Materiały: skySphere.tsl.js, obrót:
//     skyScroll.js.
//   • Tryb `?niebo=plaska` (A/B): dawna płaszczyzna mgławicy z paralaksą 0,02 (planet3d.assets.js) i niebo kamer 3D
//     niżej — sfera wokół kamery na warstwie tła (1), kolor z KIERUNKU patrzenia: gwiazdy z komórek 3D (jak niebo dema
//     Atlasa 3D, dema/atlas3d-webgpu/niebo.js) i mgławica gry (assets/nebula.webp) w rzucie stereograficznym z nadiru,
//     dookoła horyzontu i w górze słaba mgławica z szumu. W kamerze klasycznej ta sfera jest schowana.
//
// Graf raz (moduł), jedna siatka. Pozycja = oko kamery (Core3D.syncCamera w free3d), skala = połowa
// `far`, więc sfera zawsze mieści się w bryle widzenia; bez testu i zapisu głębi, renderOrder na samym
// początku passa tła.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec2, vec3, float, floor, fract, dot, normalize, max, abs, pow, exp, mix, smoothstep,
  length, positionLocal, mx_fractal_noise_float, fwidth, texture
} from 'three/tsl';
import {
  SKY_SCROLL, createSkyScroll, createSkyTrack, skyTrackStep, skyScrollMove, stepSkyScroll, stepSkyFineGain, skyFocalPx,
  skyViewMatrix, skyWorldMatrix, mat3AngleBetween
} from './skyScroll.js';
import {
  createSkySphereUniforms, createSkySphereFlatMaterial, createSkySphereMeshMaterial, createSkyStarQuadsMaterial,
  createSkyStarGeometry, buildSkyStarCatalog
} from './skySphere.tsl.js';
import { warpSkyBendCount } from './warp/skyBend.js';
import { cameraRoll } from './viewRoll.js';
import { loadTexture } from './canvas2d.js';
import { resizeRenderTarget } from './renderTargetResize.js';

const hash33 = Fn(([p3]) => {
  const p = fract(p3.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p.addAssign(dot(p, p.yxz.add(33.33)));
  return fract(p.xxy.add(p.yxx).mul(p.zyx));
});

// Warstwa gwiazd: komórki 3D na sferze o promieniu K, gwiazda w losowym punkcie komórki; szerokość
// gwiazdy ~1 px (fwidth), więc nie migocze przy obrocie kamery.
const starLayer = Fn(([d, K, prob, bright]) => {
  const p = d.mul(K).toVar();
  const cell = floor(p).toVar();
  const h = hash33(cell).toVar();
  const c = cell.add(h.mul(0.8).add(0.1));
  const px = max(fwidth(p.x).add(fwidth(p.y)).add(fwidth(p.z)).mul(0.5), 1e-4).toVar();
  const dist = length(p.sub(c)).div(px);
  const on = smoothstep(prob.oneMinus(), prob.oneMinus().add(0.002), h.z);
  const mag = pow(fract(h.x.mul(13.7).add(h.y)), 3.0);
  const core = exp(dist.mul(dist).negate().div(mix(0.5, 1.4, mag)));
  const tint = mix(vec3(1.0, 0.82, 0.66), vec3(0.72, 0.84, 1.0), h.y);
  return tint.mul(core).mul(on).mul(mix(0.08, 1.0, mag)).mul(bright);
});

export const SKY3D_TUNE = Object.freeze({
  nebulaSpan: 1.35,   // zasięg obrazu mgławicy w rzucie stereograficznym (1 = obraz do horyzontu)
  nebulaGain: 1.0,
  starsGain: 1.0
});

let _sky = null;

/** Tworzy (raz) sferę nieba. nebulaTexture — tekstura mgławicy gry (NebulaSystem), może być null. */
export function createSky3D(scene, nebulaTexture = null) {
  if (_sky) return _sky;
  const u = {
    stars: uniform(SKY3D_TUNE.starsGain),
    nebula: uniform(SKY3D_TUNE.nebulaGain),
    span: uniform(SKY3D_TUNE.nebulaSpan)
  };
  // Niebo-sfera (SkySphere niżej, DECYZJE-2 N2): kamery 3D rysują tę samą treść co kamera z góry (equirect + gwiazdy
  // kierunków) w tej samej orientacji — jedno niebo; bez trybu sfery — dawna sfera z mgławicą w rzucie stereograficznym.
  if (SkySphere.active && SkySphere.U) {
    const material = createSkySphereMeshMaterial(SkySphere.U);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
    mesh.name = 'Sky3D';
    mesh.frustumCulled = false;
    mesh.renderOrder = -100000;
    mesh.visible = false;
    mesh.layers.set(1);
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    _sky = { mesh, material, u };
    return _sky;
  }
  const tex = nebulaTexture || new THREE.Texture();
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  material.name = 'Sky3D';
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  material.colorNode = Fn(() => {
    const d = normalize(positionLocal).toVar();
    // Mgławica gry: rzut stereograficzny z nadiru (−Z) i z zenitu (lustro) — ten sam obraz, na
    // horyzoncie ciągły. Świat THREE: +Y = północ (−y gry), jak dawna płaszczyzna mgławicy.
    const k = float(1.0).div(float(1.0).add(abs(d.z)));
    const st = vec2(d.x, d.y).mul(k).div(u.span);
    const uvN = st.mul(vec2(0.5, 0.5 * 1.6)).add(0.5);
    const edge = smoothstep(1.0, 0.72, length(st));
    const neb = texture(tex, uvN).rgb.mul(edge).mul(u.nebula);
    // Słaba mgławica z szumu (fiolet i morski błękit) — żeby horyzont nie był pusty.
    const n1 = mx_fractal_noise_float(d.mul(1.6), 3, 2.0, 0.5).mul(0.5).add(0.5);
    const n2 = mx_fractal_noise_float(d.mul(3.3).add(vec3(7.1, -2.3, 4.4)), 2, 2.0, 0.5).mul(0.5).add(0.5);
    const bandDir = normalize(vec3(0.25, 0.35, 0.9));
    const bd = dot(d, bandDir);
    const band = exp(bd.mul(bd).mul(-7.0));
    const fog = smoothstep(0.45, 0.95, n1).mul(band.mul(0.8).add(0.3));
    const col = vec3(0.0012, 0.0016, 0.0034)
      .add(vec3(0.012, 0.005, 0.02).mul(fog))
      .add(vec3(0.002, 0.009, 0.013).mul(smoothstep(0.55, 0.9, n2)).mul(band.add(0.2)))
      .add(neb);
    const s = starLayer(d, float(260.0), float(0.02), float(0.5))
      .add(starLayer(d, float(90.0), float(0.028), float(1.5)));
    return col.add(s.mul(u.stars));
  })();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
  mesh.name = 'Sky3D';
  mesh.frustumCulled = false;
  mesh.renderOrder = -100000;
  mesh.visible = false;
  mesh.layers.set(1);
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  _sky = { mesh, material, u };
  return _sky;
}

export function getSky3D() { return _sky; }

/** Sfera w oku kamery, promień 0,5 · far (free3d); schowana w kamerze klasycznej. */
export function syncSky3D(active, eye, far) {
  const sky = _sky;
  if (!sky) return;
  const mesh = sky.mesh;
  if (mesh.visible !== !!active) mesh.visible = !!active;
  if (!active) return;
  const r = Math.max(1000, (Number(far) || 1e7) * 0.5);
  mesh.position.set(eye.x, eye.y, eye.z);
  mesh.scale.set(r, r, r);
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);
}

// ============================================================
// NIEBO-SFERA w kamerze z góry (DECYZJE-2 N1–N3, 2026-10-26): sfera nieba w nieskończoności zamiast płaszczyzny mgławicy
// z paralaksą 0,02 i zamiast warstwy deep GameStars, obracana z DROGI STATKU (src/3d/skyScroll.js — prawo warstw:
// ekran = min(v, 14 tys.) · p · zoom, p 0,03). Materiały: src/3d/skySphere.tsl.js. Tryb z adresu strony (działa też w
// workerze renderu — RenderWorld.pageSearch): `?niebo=sfera` / `?niebo=plaska`; domyślny — SKY_SPHERE_DEFAULT_MODE.
// Stan obrotu liczy moduł renderu z RenderWorld (poza statku, prędkość, kamera) — tryb off i worker liczą to samo.
// Droga: okręt PROWADZONY PRZEZ KAMERĘ — statek gracza, a przy sterach fregaty zwiadu fregata (RenderWorld.cameraLead,
// z wagą przejazdu kamery: drogi obu tropicieli mieszane, bez skoku przy przełączeniu). Podzielony ekran: gracz 2 ma
// własny stan (droga RenderWorld.player2Ship, zoom i obrót kadru RenderWorld.camera2) — widok ustawia hak passa tła
// przed każdym renderSingle, pamięć nieba wtedy wyłączona (dwa różne widoki w klatce).
// Obiekty: czworokąt pełnoekranowy (warstwa 1, renderOrder −1000) z pamięcią nieba, kwady jasnych gwiazd (−998),
// sfera kamer 3D (Sky3D — ta sama treść). Rozgrzewka: wpisy „niebo-sfera: …” (faza 'loading').
// ============================================================

/**
 * Tryb nieba bez flagi w adresie: 'sfera' (domyślne od 2026-10-26 — zrzuty z gry: te same strefy jasności, ACES i gwiazdy,
 * koszt GPU nie wyższy; raport w docs/webgpu/WYPIEK-NIEBA.md § „Niebo-sfera”) albo 'plaska' (dawna płaszczyzna — A/B).
 */
export const SKY_SPHERE_DEFAULT_MODE = 'sfera';
/** Plik nieba equirect (wypiekacz w trybie sfery — scripts/webgpu/niebo-sfera.mjs). */
export const SKY_EQUIRECT_URL = 'assets/sky-equirect.webp';

/** Tryb nieba z adresu strony (`?niebo=sfera|plaska`). */
export function skySphereModeFrom(search, fallback = SKY_SPHERE_DEFAULT_MODE) {
  const m = /[?&]niebo=([a-z]+)/i.exec(String(search || ''));
  const v = m ? m[1].toLowerCase() : '';
  if (v === 'sfera' || v === 'plaska') return v;
  return fallback;
}

const _wm = new Float64Array(9);

export const SkySphere = {
  active: false,
  mode: 'plaska',
  core: null,
  U: null,
  flat: null,
  stars: null,
  texture: null,
  cacheTarget: null,
  cacheWriteMaterial: null,
  cacheWriteReady: false,
  cacheValid: false,
  cacheM: new Float64Array(9),
  cacheFine: -1,
  cacheTexVersion: -1,
  // renders / reused — przeliczenia i odczyty pamięci; direct — klatki wprost (w tym fast: niebo płynie ≥ progu pamięci
  // na klatkę, split: podzielony ekran)
  cacheStats: { renders: 0, reused: 0, direct: 0, fast: 0, split: 0 },
  scroll: createSkyScroll(),
  /** Tropiciel drogi okrętu prowadzonego przez kamerę zamiast statku (fregata zwiadu — RenderWorld.cameraLead). */
  leadTrack: createSkyTrack(),
  leadW: 0,
  viewM: new Float64Array(9),
  prevViewM: new Float64Array(9),
  hasPrevView: false,
  /** Kąt obrotu widoku nieba w tej klatce [rad] (droga + obrót kadru) — wybór pamięć / wprost w cacheHook. */
  frameAngle: 0,
  // podzielony ekran: stan i widok gracza 2 (kamera RenderWorld.camera2 — porównanie z Core3D.activeCam1 w haku)
  split: false,
  cam2: null,
  scroll2: createSkyScroll(),
  viewM2: new Float64Array(9),
  _dA: new Float64Array(2),
  _dB: new Float64Array(2),
  _clockHas: false,
  _clockLast: 0,
  /** Tempo obrazu nieba ostatniej klatki [px CSS/s] (narzędzia, raport W0). */
  speedCss: 0,

  /** Raz, przy NebulaSystem.init: tryb z adresu; w trybie sfery — tekstura, materiały, siatki, wpisy rozgrzewki. */
  init(core, search) {
    if (this.core) return this;
    this.core = core;
    this.mode = skySphereModeFrom(search);
    this.active = this.mode === 'sfera';
    if (!this.active) return this;
    // 6144 × 3072 RGBA8 = ~75 MB GPU: wgranie w wolnej chwili z kolejki Core3D (jak tekstury planet), nie przy pierwszym
    // rysunku — gdyby dekodowanie skończyło się po starcie gry, wgranie trafiłoby w klatkę gry.
    const tex = loadTexture(SKY_EQUIRECT_URL, (t) => {
      if (typeof core.queueTextureUpload === 'function') core.queueTextureUpload(t);
    });
    tex.name = 'SkySphere:equirect';
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;                       // wiersz 0 = biegun N (v = 0,5 − φ / π)
    tex.wrapS = THREE.RepeatWrapping;        // szew λ = ±π bez przerwy w filtrze
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;             // odczyt poziomu 0 (pułapka 28)
    this.texture = tex;
    this.cacheTarget = new THREE.RenderTarget(1, 1, {
      format: THREE.RGBAFormat, type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      generateMipmaps: false, depthBuffer: false, stencilBuffer: false, samples: 0
    });
    this.cacheTarget.texture.name = 'SkySphere:pamiecNieba';
    const U = this.U = createSkySphereUniforms(tex, this.cacheTarget.texture);
    const flat = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), createSkySphereFlatMaterial(U));
    flat.name = 'SkySphere';
    flat.frustumCulled = false;
    flat.renderOrder = -1000;
    flat.layers.set(1);
    flat.matrixAutoUpdate = false;
    this.flat = flat;
    this.cacheWriteMaterial = createSkySphereFlatMaterial(U, { cacheWrite: true });
    const stars = new THREE.Mesh(createSkyStarGeometry(buildSkyStarCatalog(1)), createSkyStarQuadsMaterial(U));
    stars.name = 'SkySphere:gwiazdy';
    stars.frustumCulled = false;
    stars.renderOrder = -998;
    stars.layers.set(1);
    stars.matrixAutoUpdate = false;
    this.stars = stars;
    core.scene.add(flat, stars);
    core.addPassHook('bg', (camera) => this.cacheHook(camera));
    core.skySphere = this;                   // narzędzia (liczniki pamięci, tempo, obrót)
    const w = core.warmup;
    if (w) {
      w.add({ name: 'niebo-sfera: kamera z góry', objects: () => (this.flat ? [this.flat] : []), layer: 1, phase: 'loading' });
      w.add({ name: 'niebo-sfera: jasne gwiazdy', objects: () => (this.stars ? [this.stars] : []), layer: 1, phase: 'loading' });
      // pipeline zapisu pamięci (cel HalfFloat bez MSAA i głębi) — pamięć działa dopiero z gotowym (cacheHook: do tego czasu wprost)
      w.add({ name: 'niebo-sfera: pamięć nieba', objects: () => (this.flat ? [this.flat] : []), layer: 1,
        target: () => this.cacheTarget, scene: null, phase: 'loading',
        variant: { apply: (m) => { const prev = m.material; m.material = this.cacheWriteMaterial; return () => { m.material = prev; }; } } })
        .promise.then(() => { this.cacheWriteReady = true; });
    } else {
      this.cacheWriteReady = true;
    }
    return this;
  },

  /**
   * Klatka (NebulaSystem.update, raz na klatkę renderu): obrót z drogi okrętu prowadzonego przez kamerę, macierze,
   * jasność strefy, widoczność (kamera z góry — czworokąt i kwady; kamery 3D rysują Sky3D).
   *   pose — { x, y } statku gracza (RenderWorld.playerPose albo encja), v — jego prędkość [j/s], flat — kamera z góry;
   *   lead — { x, y, v, w } okrętu prowadzonego przez kamerę zamiast statku (RenderWorld.cameraLead: fregata zwiadu przy
   *          sterach, w — waga przejazdu kamery 0…1) albo null;
   *   p2   — { cam, x, y, v } gracza 2 przy podzielonym ekranie albo null;
   *   clock — zegar klatek strony [s] (RenderWorld.frameClock — worker: HEAD.T_FRAME) albo null (off: dt klatki).
   * Czas kroku = przyrost zegara od poprzedniej klatki nieba: worker rysuje NAJNOWSZĄ stronę i pomija strony, a poza
   * gracza przesuwa się wtedy o kilka klatek strony — z dt jednej strony wyglądałoby to na teleport (cięcie) albo
   * sufit 14 tys. j/s przyciąłby obrót (w warpie niebo obracało się w workerze 4× wolniej niż w off).
   */
  update(dt, cam, pose, v, brightness, flat, lead = null, p2 = null, clock = null) {
    if (!this.active || !this.U) return;
    const core = this.core;
    const U = this.U;
    if (Number.isFinite(clock)) {
      if (this._clockHas && clock >= this._clockLast) dt = clock - this._clockLast;
      this._clockLast = clock;
      this._clockHas = true;
    } else this._clockHas = false;
    if (this.flat.visible !== flat) this.flat.visible = flat;
    if (this.stars.visible !== flat) this.stars.visible = flat;
    U.brightness.value = brightness;
    const pxScale = core.pxScale || 1;
    const bufH = Number(core.composerTarget?.height) || ((core._viewCssH ? core._viewCssH() : 1080) * pxScale);
    const f = skyFocalPx(bufH);
    const zoom = core.viewZoom(cam);
    const s = this.scroll;
    // droga: statek gracza i okręt prowadzony przez kamerę (fregata zwiadu) — każdy ze swoim tropicielem i cięciem,
    // zmieszane wagą przejazdu kamery (przejazd nad fregatę nie obraca nieba o drogę kamery między okrętami)
    const a = this._dA, b = this._dB;
    if (pose) skyTrackStep(s.track, pose.x, pose.y, v, dt, a);
    else { s.track.has = false; a[0] = 0; a[1] = 0; }
    let w = 0;
    if (lead && lead.w > 0 && Number.isFinite(lead.x) && Number.isFinite(lead.y)) w = Math.min(1, lead.w);
    if (w > 0) skyTrackStep(this.leadTrack, lead.x, lead.y, lead.v, dt, b);
    else { this.leadTrack.has = false; b[0] = 0; b[1] = 0; }
    this.leadW = w;
    skyScrollMove(s, a[0] * (1 - w) + b[0] * w, a[1] * (1 - w) + b[1] * w, dt, zoom, f, pxScale);
    s.cuts = s.track.cuts + this.leadTrack.cuts;
    stepSkyFineGain(s, dt);
    this.speedCss = s.speedCss;
    U.focal.value = f;
    skyViewMatrix(s, cameraRoll(cam), this.viewM);
    // obrót widoku w tej klatce (droga + obrót kadru): ≥ progu pamięci na brzegu kadru — cacheHook rysuje wprost
    this.frameAngle = this.hasPrevView ? mat3AngleBetween(this.viewM, this.prevViewM) : 0;
    this.prevViewM.set(this.viewM);
    this.hasPrevView = true;
    this._applyView(this.viewM, s.fine);
    const wm = skyWorldMatrix(s, _wm);
    U.worldMat.value.set(wm[0], wm[1], wm[2], wm[3], wm[4], wm[5], wm[6], wm[7], wm[8]);
    // podzielony ekran: gracz 2 — własna droga, zoom i obrót kadru (widok ustawia hak passa tła przed jego renderSingle)
    const s2 = this.scroll2;
    if (p2 && p2.cam && Number.isFinite(p2.x) && Number.isFinite(p2.y)) {
      this.split = true;
      this.cam2 = p2.cam;
      stepSkyScroll(s2, p2.x, p2.y, p2.v, dt, core.viewZoom(p2.cam), f, pxScale);
      stepSkyFineGain(s2, dt);
      skyViewMatrix(s2, cameraRoll(p2.cam), this.viewM2);
    } else {
      this.split = false;
      this.cam2 = null;
      s2.track.has = false;
    }
  },

  /** Widok nieba (macierz widok → niebo, udział drobnych gwiazd) w uniformach — wspólnych dla czworokąta i kwadów. */
  _applyView(m, fine) {
    const U = this.U;
    U.viewMat.value.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    U.skyToView.value.set(m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]);
    U.fineGain.value = fine;
  },

  // Pamięć nieba (jak NebulaSystem.skyCacheHook): niebo z gwiazdami drobnymi liczone do celu w rozmiarze bufora sceny,
  // od nowa, gdy obraz obrócił się o ≥ SKY_SCROLL.cacheTolPx na brzegu kadru (kąt · max(f, pół przekątnej)), zmienił się
  // rozmiar, tekstura albo udział gwiazd drobnych. Wprost (bez pamięci): soczewka bańki warpa (przesunięcia na piksel),
  // podzielony ekran (dwa widoki w klatce) i niebo płynące ≥ progu NA KLATKĘ (warp, hipercruise, obrót kadru) — pamięć
  // przeliczałaby się wtedy w każdej klatce (zapis + odczyt drożej niż rysunek wprost).
  cacheHook(camera) {
    const U = this.U, rt = this.cacheTarget, core = this.core, renderer = core?.renderer;
    if (!U || !rt || !renderer || !this.flat) return;
    const st = this.cacheStats;
    if (this.split) {
      // renderSingle gracza 2 ma kamerę RenderWorld.camera2 jako Core3D.activeCam1 (hexShips3D / render.worker: split)
      const p2 = !!this.cam2 && core.activeCam1 === this.cam2;
      this._applyView(p2 ? this.viewM2 : this.viewM, p2 ? this.scroll2.fine : this.scroll.fine);
      U.cacheMode.value = 0; this.cacheValid = false; st.direct++; st.split++; return;
    }
    if (core.skyCacheEnabled === false || !this.cacheWriteReady || !this.flat.visible || warpSkyBendCount() > 0) {
      U.cacheMode.value = 0; this.cacheValid = false; st.direct++; return;
    }
    const ct = core.composerTarget;
    const W = ct ? ct.width : 0, H = ct ? ct.height : 0;
    if (!(W > 0 && H > 0)) { U.cacheMode.value = 0; st.direct++; return; }
    const reach = Math.max(U.focal.value, 0.5 * Math.sqrt(W * W + H * H));
    if (this.frameAngle * reach >= SKY_SCROLL.cacheTolPx) {
      U.cacheMode.value = 0; this.cacheValid = false; st.direct++; st.fast++; return;
    }
    if (rt.width !== W || rt.height !== H) { resizeRenderTarget(rt, W, H, renderer); this.cacheValid = false; }
    const texVer = this.texture ? this.texture.version : -1;
    const fine = U.fineGain.value;
    let redo = !this.cacheValid || texVer !== this.cacheTexVersion || Math.abs(fine - this.cacheFine) > 0.01;
    if (!redo) redo = mat3AngleBetween(this.viewM, this.cacheM) * reach >= SKY_SCROLL.cacheTolPx;
    if (redo) {
      const prev = renderer.getRenderTarget();
      const mat = this.flat.material;
      this.flat.material = this.cacheWriteMaterial;
      renderer.setRenderTarget(rt);
      renderer.render(this.flat, camera);
      renderer.setRenderTarget(prev);
      this.flat.material = mat;
      this.cacheM.set(this.viewM);
      this.cacheFine = fine;
      this.cacheTexVersion = texVer;
      this.cacheValid = true;
      st.renders++;
    } else st.reused++;
    U.cacheMode.value = 2;
  }
};
