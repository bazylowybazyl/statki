// Dodatek dema planet (dema/planety-webgpu.html?korek=1 / ?slup=1): elektrownia geotermalna „KOREK” w wielkim gryzie
// Ziemi (src/3d/earthBitePlant*.js — korek na dnie, promień energii do odbiornika pod ringiem, windy kosmiczne), ring
// orbitalny Ziemi z gry (createHaloRing — ta sama budowa co w grze) z promieniem przekaźnikowym odbiornik → ring, i słup
// dymu (src/3d/earthBitePlume*.js) — doklejone do Ziemi dema przez window.__planety, bez zmian w dema/planety-webgpu.js.
// Elektrownia i dym są dziećmi siatki kuli (obracają się z gruntem) i dzielą z nią uniformy słońca, gryzu i mgiełki.
// Ring jak w grze (decyzja użytkownika 2026-10-22, src/3d/earthSpin.js): Ziemia obraca się wokół OSI RINGU, więc ring
// jest równikowy (płaszczyzna ⟂ osi doby — w demie oś Y świata) i stoi względem gruntu; windy i promień przekaźnikowy
// elektrowni łączą się z jego wewnętrzną krawędzią na stałe (`plant.attachRing`). Kamera gry patrzy znad bieguna.
//   ?korek=1 — elektrownia (z ringiem; ?ring=0 — bez ringu, ?ringJakosc=low|medium|high), ?slup=1 — dym,
//   ?slupWariant=parasol|smukly, ?slupZegar=0 — zegar stoi (zrzuty), ?slupPioruny=0 — bez piorunów.
//   Panel RING (lewy dolny róg): „jak w grze” (równikowy, domyślnie) albo swobodnie — suwaki obrotu i pochylenia,
//   Shift + przeciąganie (liny i przekaźnik zostają przy ringu gry).
//   Klawisze: K — elektrownia, L — dym, R — ring, G — ring jak w grze / swobodnie, [ ] — obrót ringu, − = — pochylenie.
//   Konsola / harness: window.__slup.
import * as THREE from 'three/webgpu';
import { EarthBitePlume } from '../src/3d/earthBitePlume3D.js';
import { EarthBitePlant, createPlantLook, plantFrameMatrix } from '../src/3d/earthBitePlant.js';
import { earthSpinAxis } from '../src/3d/earthSpin.js';
import { createPlumeLook } from '../src/3d/earthBitePlumeShape.js';
import { fxRandom } from '../src/3d/fx/fxRandom.js';
import { createHaloRing } from '../src/3d/haloRing/index.js';
import { HALO_RING_PLANETS } from '../src/game/haloRingPlanets.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';

const params = new URLSearchParams(location.search);
const on = (k) => params.get(k) !== null && params.get(k) !== '0';
if (on('slup') || on('korek')) start();

const R_EARTH = RING_PLANET_WORLD_RADII.earth;
const SUN_ELEVATION = 49 * Math.PI / 180;   // jak w grze (HALO_GAME.sunElevationDeg)

async function start() {
  while (!(window.__planety && window.__planety.ready && window.__planety.ready())) await new Promise((r) => setTimeout(r, 120));
  const P = window.__planety;
  const look = createPlumeLook({}, params.get('slupWariant') || 'parasol');
  if (params.get('slupPioruny') === '0') look.flashRate = 0;
  const plantLook = createPlantLook();
  const S = { on: on('slup'), plantOn: on('korek'), ringOn: on('korek') && params.get('ring') !== '0', frozen: params.get('slupZegar') === '0' };
  let plume = null;
  let plant = null;
  let lightsCheck = 0;
  let last = performance.now();

  // ── ring orbitalny Ziemi z gry (jednostki świata gry; grupa przeskalowana do promieni Ziemi dema) ──
  let ring = null;
  const ringHolder = new THREE.Group();
  ringHolder.name = 'DemoHaloRing';
  ringHolder.scale.setScalar(1 / R_EARTH);
  const mirrorCam = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
  // ustawienie ringu: `follow` — jak w grze (równikowy: płaszczyzna ⟂ osi doby Ziemi), inaczej swobodnie: obrót wokół
  // osi Y świata (yaw) i pochylenie płaszczyzny (tilt), w radianach
  const RG = { follow: true, yaw: null, tilt: 0 };
  const DEG = Math.PI / 180;
  function ensureRing(scene) {
    if (ring || !S.ringOn) return ring;
    const spec = HALO_RING_PLANETS.earth;
    ring = createHaloRing({ planetRadius: R_EARTH, seed: spec.seed, profile: spec.profile, quality: params.get('ringJakosc') || 'low', renderer: P.renderer });
    // kamera dema widzi tylko warstwę 0
    ring.setLayers({ default: 0, fg: 0 });
    ring.group.position.z = -ring.layout.planetCenterZ;
    ringHolder.add(ring.group);
    scene.add(ringHolder);
    return ring;
  }

  function attach() {
    const body = P.S.current;
    if (!body || body.id !== 'earth' || !body.pit) return null;
    if (!plume) plume = new EarthBitePlume(body.uniforms, { look });
    if (plume.mesh.parent !== body.mesh) body.mesh.add(plume.mesh);
    if (!plant) {
      plant = new EarthBitePlant(body.uniforms, { look: plantLook });
      // ring gry w układzie Ziemi: równikowy, przekaźnik odbiornik → krawędź ringu stały (siatki w grupie elektrowni)
      plant.attachRing(earthSpinAxis(), plantLook.ringInnerR);
    }
    if (plant.group.parent !== body.mesh) body.mesh.add(plant.group);
    const scene = body.group.parent;
    if (scene) ensureRing(scene);
    return body;
  }

  // kamera dema odtworzona z jej stanu (planety-webgpu.js: orbita az / el / dist wokół S.look) — ring liczy RTE i LOD
  function syncMirrorCam() {
    const s = P.S;
    const ce = Math.cos(s.el);
    mirrorCam.position.set(ce * Math.sin(s.az), Math.sin(s.el), ce * Math.cos(s.az)).multiplyScalar(s.dist);
    mirrorCam.up.copy(P.camera.up);
    mirrorCam.lookAt(s.look);
    mirrorCam.fov = s.fov;
    mirrorCam.aspect = innerWidth / Math.max(1, innerHeight);
    mirrorCam.near = Math.max(0.0005, (s.dist - 1.1) * 0.5);
    mirrorCam.far = 200;
    mirrorCam.updateProjectionMatrix();
    mirrorCam.updateMatrixWorld(true);
  }

  const _axis = new THREE.Vector3();
  const _Z = new THREE.Vector3(0, 0, 1);
  const _sun = new THREE.Vector3();
  const _inv = new THREE.Quaternion();
  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const body = attach();
    if (plume) {
      const vis = !!body && P.S.pitOn !== false;
      plume.mesh.visible = vis && S.on;
      plant.group.visible = vis && S.plantOn;
      plume.update(S.frozen ? 0 : dt);
      plant.update(S.frozen ? 0 : dt);
    }
    if (ring && body) {
      ringHolder.visible = S.ringOn;
      // światła pozycyjne ringu (HaloMegaLights) dokładają w przestrzeni widoku fizyczny rozmiar w jednostkach ringu bez
      // skali modelu — w grze skala 1, w demie (1 : R Ziemi) każde światło miałoby dziesiątki promieni Ziemi; z tej
      // odległości i tak są poniżej piksela — chowamy je (sprawdzane co ~1 s: ring podmienia zestaw brył po budowie)
      if ((++lightsCheck % 60) === 1) {
        ring.group.traverse((o) => { if (o.material?.name === 'HaloMegaLights') o.visible = false; });
      }
      // jak w grze: oś ringu (lokalne Z, ku kamerze gry) = oś doby Ziemi (earthSpin.js) — ring równikowy; swobodnie — stoi
      if (RG.yaw === null) RG.yaw = 0;
      if (RG.follow) {
        body.mesh.updateMatrixWorld(true);
        earthSpinAxis(undefined, _axis).transformDirection(body.mesh.matrixWorld);
        ringHolder.quaternion.setFromUnitVectors(_Z, _axis);
      } else ringHolder.rotation.set(-RG.tilt, RG.yaw, 0, 'YXZ');
      ringHolder.updateMatrixWorld(true);
      syncMirrorCam();
      ring.update(S.frozen ? 0 : dt, { camera: mirrorCam, viewportHeight: innerHeight * (window.devicePixelRatio || 1), gameView: true });
      // słońce dema w układzie ringu (azymut w płaszczyźnie ringu; wysokość jak w grze)
      _sun.copy(body.uniforms.sunPosition.value).normalize().applyQuaternion(_inv.copy(ringHolder.quaternion).invert());
      ring.setSun(Math.atan2(_sun.y, _sun.x), SUN_ELEVATION);
      // promień przekaźnikowy i liny wind są w grupie elektrowni (ring gry stoi względem gruntu) — tylko przy ringu
      if (plant.relay) plant.relay.group.visible = S.ringOn;
    } else if (plant?.relay) {
      plant.relay.group.visible = false;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  const body0 = () => P.S.current;
  function nudge(dYaw, dTilt) {
    if (RG.follow) { RG.follow = false; RG.yaw = 0; RG.tilt = -Math.PI / 2; }
    if (RG.yaw === null) RG.yaw = 0;
    RG.yaw = Math.atan2(Math.sin(RG.yaw + dYaw), Math.cos(RG.yaw + dYaw));
    RG.tilt = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, RG.tilt + dTilt));
    syncPanel();
  }
  addEventListener('keydown', (e) => {
    if (e.repeat || e.target?.tagName === 'INPUT') return;
    if (e.code === 'KeyL') S.on = !S.on;
    if (e.code === 'KeyK') S.plantOn = !S.plantOn;
    if (e.code === 'KeyR') { S.ringOn = !S.ringOn; if (S.ringOn && body0()) ensureRing(body0().group.parent); }
    if (e.code === 'KeyG') { RG.follow = !RG.follow; if (!RG.follow) { RG.yaw = 0; RG.tilt = -Math.PI / 2; } syncPanel(); }
    if (e.code === 'BracketLeft') nudge(-5 * DEG, 0);
    if (e.code === 'BracketRight') nudge(5 * DEG, 0);
    if (e.code === 'Minus') nudge(0, -5 * DEG);
    if (e.code === 'Equal') nudge(0, 5 * DEG);
  });
  // Shift + przeciąganie: obrót ringu (przechwycone w fazie przechwytywania — kamera dema go nie dostaje)
  let drag = null;
  addEventListener('pointerdown', (e) => {
    if (!e.shiftKey || e.button !== 0 || e.target?.id !== 'gpu') return;
    drag = { x: e.clientX, y: e.clientY };
    e.stopPropagation();
    e.preventDefault();
  }, true);
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    nudge((e.clientX - drag.x) * 0.006, (e.clientY - drag.y) * 0.006);
    drag.x = e.clientX;
    drag.y = e.clientY;
    e.stopPropagation();
  }, true);
  addEventListener('pointerup', (e) => {
    if (!drag) return;
    drag = null;
    e.stopPropagation();
  }, true);
  // panel RING (bez paneli w trybie zrzutów)
  let syncPanel = () => {};
  if (params.get('test') !== '1' && on('korek')) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:10px;bottom:10px;width:300px;padding:8px 10px;background:#070b10e8;'
      + 'border:1px solid #5fc8ff2e;border-radius:6px;font:12px/1.45 "Segoe UI",system-ui,sans-serif;color:#dfe6ee;z-index:4';
    box.innerHTML = '<div style="font-weight:600;letter-spacing:.06em;margin-bottom:4px">RING</div>'
      + '<label style="display:block;margin:2px 0"><input type="checkbox" id="rg-follow"> jak w grze (równikowy — liny i przekaz do ringu)</label>'
      + '<div style="display:grid;grid-template-columns:70px 1fr 42px;gap:6px;align-items:center;margin:3px 0">'
      + '<span>Obrót</span><input id="rg-yaw" type="range" min="-180" max="180" step="1"><output id="rg-yaw-o"></output>'
      + '<span>Pochylenie</span><input id="rg-tilt" type="range" min="-90" max="90" step="1"><output id="rg-tilt-o"></output></div>'
      + '<div style="display:flex;gap:4px;flex-wrap:wrap"><button id="rg-game">jak w grze (G)</button></div>'
      + '<div style="color:#8592a3;margin-top:4px;font-size:11px">Shift + przeciąganie — obrót ringu, [ ] obrót, − = pochylenie</div>';
    document.body.appendChild(box);
    const $ = (id) => box.querySelector('#' + id);
    for (const b of box.querySelectorAll('button')) {
      b.style.cssText = 'background:#0d141c;color:#dfe6ee;border:1px solid #263445;border-radius:4px;padding:4px 7px;font:inherit;cursor:pointer';
    }
    syncPanel = () => {
      $('rg-follow').checked = RG.follow;
      const yaw = Math.round((RG.yaw ?? 0) / DEG);
      const tilt = Math.round(RG.tilt / DEG);
      $('rg-yaw').value = yaw;
      $('rg-yaw-o').textContent = yaw + '°';
      $('rg-tilt').value = tilt;
      $('rg-tilt-o').textContent = tilt + '°';
    };
    $('rg-follow').onchange = (e) => { RG.follow = e.target.checked; if (!RG.follow) { RG.yaw = 0; RG.tilt = -Math.PI / 2; } syncPanel(); };
    $('rg-yaw').oninput = (e) => { RG.follow = false; RG.yaw = Number(e.target.value) * DEG; syncPanel(); };
    $('rg-tilt').oninput = (e) => { RG.follow = false; if (RG.yaw === null) RG.yaw = 0; RG.tilt = Number(e.target.value) * DEG; syncPanel(); };
    $('rg-game').onclick = () => { RG.follow = true; syncPanel(); };
    syncPanel();
  }


  window.__slup = {
    look,
    plantLook,
    get plume() { return plume; },
    get plant() { return plant; },
    get ring() { return ring; },
    ringPose: RG,
    ready: () => !!plume,
    ringReady: () => (ring ? ring.isReady : true),
    /**
     * Kadr szczegółu elektrowni w RAMIE ELEKTROWNI (earthBitePlantFrame.js: y — wysokość nad dnem gryzu, x — wschód,
     * z — południe; R Ziemi): kamera w `from`, patrzy na `at`, `fov` [°], słońce z kierunku `sun` (rama, nie musi być
     * jednostkowy), `up` — góra kadru w ramie (domyślnie oś gryzu). Ustawia stan kamery dema (az / el / dist / look,
     * pora, wysokość słońca) i jej `up`.
     */
    viewPlant({ at, from, fov = 40, sun = [0.6, 0.8, 0.3], up = [0, 1, 0] }) {
      const body = body0();
      if (!body?.mesh || !plant) return false;
      body.mesh.updateMatrixWorld(true);
      const M = plantFrameMatrix(plant.biteRadius).premultiply(body.mesh.matrixWorld);
      const A = new THREE.Vector3(...at).applyMatrix4(M);
      const F = new THREE.Vector3(...from).applyMatrix4(M);
      const d = new THREE.Vector3(...sun).transformDirection(M);
      P.camera.up.copy(new THREE.Vector3(...up).transformDirection(M));
      const s = P.S;
      s.target = null;
      s.dist = F.length();
      s.az = Math.atan2(F.x, F.z);
      s.el = Math.asin(Math.max(-1, Math.min(1, F.y / s.dist)));
      s.look.copy(A);
      s.fov = fov;
      s.sunEl = Math.asin(Math.max(-1, Math.min(1, d.y))) / DEG;
      s.pora = Math.round(((Math.atan2(d.x, d.z) - s.az) / DEG + 540) % 360 - 180);
      return true;
    },
    /**
     * Kadr jak w grze: kamera znad bieguna obrotu (oś Y świata dema = oś ringu), gryz pod kątem `angle` [°] na tarczy
     * (0 — w prawo, 90 — w górę), słońce w płaszczyźnie ringu z fazą `phase` [°] względem południka gryzu (0 — południe,
     * 90 — terminator, 180 — północ), `half` — pół wysokości kadru [R], `center` — 'planet' | 'bite' | 'hub'.
     */
    viewGame({ angle = 0, phase = 30, half = 1.25, center = 'planet', dist = 14 }) {
      const body = body0();
      if (!body?.mesh || !plant) return false;
      body.mesh.updateMatrixWorld(true);
      const M = plantFrameMatrix(plant.biteRadius).premultiply(body.mesh.matrixWorld);
      const hub = new THREE.Vector3(0, plant.look.hubRadius - (1 - plant.biteRadius), 0).applyMatrix4(M);
      const site = new THREE.Vector3(0, 0, 0).applyMatrix4(M);
      const sAz = Math.atan2(hub.x, hub.z);
      const s = P.S;
      s.target = null;
      s.az = 0;
      s.el = Math.PI / 2;
      s.dist = dist;
      // góra kadru (poziomo): gryz pod kątem `angle` na ekranie (prawo = góra × oś do kamery)
      const al = sAz + (90 - angle) * DEG;
      P.camera.up.set(Math.sin(al), 0, Math.cos(al));
      if (center === 'planet') s.look.set(0, 0, 0);
      else if (center === 'hub') s.look.copy(hub);
      else s.look.set(site.x, 0, site.z).normalize().multiplyScalar(Math.hypot(hub.x, hub.z) * 0.92);
      s.fov = 2 * Math.atan(half / (dist - s.look.y)) / DEG;
      s.sunEl = 0;
      s.pora = Math.round((((sAz + phase * DEG) - s.az) / DEG + 540) % 360 - 180);
      return true;
    },
    /** Po zmianie pól `look`. */
    apply() { plume?.applyLook(); plant?.applyLook(); },
    setTime(t) {
      if (plume) { plume.time = Number(t) || 0; plume.lightning.time = plume.time; plume.update(0); }
      if (plant) { plant.time = Number(t) || 0; plant.settleRelay(); }
    },
    freeze(v = true) { S.frozen = !!v; },
    toggle(v) { S.on = v === undefined ? !S.on : !!v; },
    togglePlant(v) { S.plantOn = v === undefined ? !S.plantOn : !!v; },
    /** n błysków naraz w szczycie (ziarno fxRandom — powtarzalne zrzuty). */
    burst(seed = 1, n = 3) {
      if (!plume) return 0;
      fxRandom.seed(seed);
      for (const s of plume.lightning.slots) s.live = false;
      for (let i = 0; i < n; i++) plume.lightning.spawn(look, plume.frame, plume.lightning.time);
      plume.update(0);
      return n;
    }
  };
}
