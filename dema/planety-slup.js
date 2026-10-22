// Dodatek dema planet (dema/planety-webgpu.html?korek=1 / ?slup=1): elektrownia geotermalna „KOREK” w wielkim gryzie
// Ziemi (src/3d/earthBitePlant*.js — korek na dnie, promień energii do odbiornika pod ringiem, windy kosmiczne), ring
// orbitalny Ziemi z gry (createHaloRing — ta sama budowa co w grze) z promieniem przekaźnikowym odbiornik → ring, i słup
// dymu (src/3d/earthBitePlume*.js) — doklejone do Ziemi dema przez window.__planety, bez zmian w dema/planety-webgpu.js.
// Elektrownia i dym są dziećmi siatki kuli (obracają się z gruntem) i dzielą z nią uniformy słońca, gryzu i mgiełki.
// Ring stoi jak w grze: płaszczyzna ringu prostopadła do kamery gry, oś doby Ziemi leży w płaszczyźnie ringu — w demie
// kamera krąży wokół Ziemi, więc ring obraca się razem z azymutem kamery (w grze stoi ring i kamera, kręci się Ziemia).
//   ?korek=1 — elektrownia (z ringiem; ?ring=0 — bez ringu, ?ringJakosc=low|medium|high), ?slup=1 — dym,
//   ?slupWariant=parasol|smukly, ?slupZegar=0 — zegar stoi (zrzuty), ?slupPioruny=0 — bez piorunów.
//   Klawisze: K — elektrownia wł. / wył., L — dym wł. / wył., R — ring wł. / wył. Konsola / harness: window.__slup.
import * as THREE from 'three/webgpu';
import { EarthBitePlume } from '../src/3d/earthBitePlume3D.js';
import { EarthBitePlant, createPlantLook } from '../src/3d/earthBitePlant.js';
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
  let relay = null;
  let lightsCheck = 0;
  let last = performance.now();

  // ── ring orbitalny Ziemi z gry (jednostki świata gry; grupa przeskalowana do promieni Ziemi dema) ──
  let ring = null;
  const ringHolder = new THREE.Group();
  ringHolder.name = 'DemoHaloRing';
  ringHolder.scale.setScalar(1 / R_EARTH);
  const mirrorCam = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
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
      relay = plant.createRelay();
    }
    if (plant.group.parent !== body.mesh) body.mesh.add(plant.group);
    const scene = body.group.parent;
    if (scene && relay.group.parent !== scene) scene.add(relay.group);
    if (scene) ensureRing(scene);
    return body;
  }

  // kamera dema odtworzona z jej stanu (planety-webgpu.js: orbita az / el / dist wokół S.look) — ring liczy RTE i LOD
  function syncMirrorCam() {
    const s = P.S;
    const ce = Math.cos(s.el);
    mirrorCam.position.set(ce * Math.sin(s.az), Math.sin(s.el), ce * Math.cos(s.az)).multiplyScalar(s.dist);
    mirrorCam.lookAt(s.look);
    mirrorCam.fov = s.fov;
    mirrorCam.aspect = innerWidth / Math.max(1, innerHeight);
    mirrorCam.near = Math.max(0.0005, (s.dist - 1.1) * 0.5);
    mirrorCam.far = 200;
    mirrorCam.updateProjectionMatrix();
    mirrorCam.updateMatrixWorld(true);
  }

  const _hub = new THREE.Vector3();
  const _axis = new THREE.Vector3();
  const _T = new THREE.Vector3();
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
      // klamry gryzu (decyzja użytkownika 2026-10-22: „wywal te 4 paski”) — w demie schowane razem z elektrownią; demo co
      // klatkę ustawia im `visible`, więc chowamy je warstwą (kamera dema widzi tylko warstwę 0)
      if (body?.ribs) body.ribs.layers.set(vis && S.plantOn ? 31 : 0);
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
      // oś ringu (lokalne Z) ku kamerze w poziomie: płaszczyzna ringu zawiera oś doby (Y), jak w grze
      ringHolder.rotation.set(0, P.S.az, 0);
      ringHolder.updateMatrixWorld(true);
      syncMirrorCam();
      ring.update(S.frozen ? 0 : dt, { camera: mirrorCam, viewportHeight: innerHeight * (window.devicePixelRatio || 1), gameView: true });
      // słońce dema w układzie ringu (azymut w płaszczyźnie ringu; wysokość jak w grze)
      _sun.copy(body.uniforms.sunPosition.value).normalize().applyQuaternion(_inv.copy(ringHolder.quaternion).invert());
      ring.setSun(Math.atan2(_sun.y, _sun.x), SUN_ELEVATION);
      // promień przekaźnikowy: odbiornik → najbliższy punkt wewnętrznej krawędzi ringu (w płaszczyźnie ringu)
      body.mesh.updateMatrixWorld(true);
      plant.hubCenterObject(_hub).applyMatrix4(body.mesh.matrixWorld);
      _axis.set(Math.sin(P.S.az), 0, Math.cos(P.S.az));
      _T.copy(_hub).addScaledVector(_axis, -_hub.dot(_axis));
      if (_T.lengthSq() < 1e-8) _T.set(0, 1, 0);
      const rIn = ring.layout.radii.min / R_EARTH;
      _T.normalize().multiplyScalar(rIn);
      // zasłonięty przez Ziemię: odcinek przechodzi bliżej środka niż 1 R
      const d = _T.clone().sub(_hub);
      const tt = Math.max(0, Math.min(1, -_hub.dot(d) / Math.max(d.lengthSq(), 1e-9)));
      const closest = _hub.clone().addScaledVector(d, tt).length();
      plant.placeRelay(_hub, _T, S.plantOn && S.ringOn && closest > 1.002);
    } else if (relay) {
      relay.group.visible = false;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyL') S.on = !S.on;
    if (e.code === 'KeyK') S.plantOn = !S.plantOn;
    if (e.code === 'KeyR') { S.ringOn = !S.ringOn; if (S.ringOn && body0()) ensureRing(body0().group.parent); }
  });
  const body0 = () => P.S.current;

  window.__slup = {
    look,
    plantLook,
    get plume() { return plume; },
    get plant() { return plant; },
    get ring() { return ring; },
    ready: () => !!plume,
    ringReady: () => (ring ? ring.isReady : true),
    /** Po zmianie pól `look`. */
    apply() { plume?.applyLook(); plant?.applyLook(); },
    setTime(t) {
      if (plume) { plume.time = Number(t) || 0; plume.lightning.time = plume.time; plume.update(0); }
      if (plant) { plant.time = Number(t) || 0; plant.update(0); }
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
