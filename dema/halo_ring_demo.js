// Demo ringu „Halo” — host modułów src/3d/haloRing (brief: docs/BRIEF-ring-halo.md).
// Dwie kamery: replika kamery gry (Core3D: BG persp → planeta ortho → świat
// ortho) i kamera kinowa. Serwowanie: `npm run dev`, potem
// /dema/halo_ring_demo.html?preset=1&quality=high&seed=1337&shot=1
import * as THREE from 'three';
import { createHaloRing } from '../src/3d/haloRing/index.js';
import { HALO_QUALITY, HALO_GEOMETRY_DEFAULTS, HALO_STATION_ANGLE, haloTransitAngles } from '../src/3d/haloRing/haloRingConfig.js';
import { computeGameCameraHeight } from '../src/3d/haloRing/haloRingLayout.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';
import { K7FlightDemo } from './halo_ring_k7_flight.js';
import {
  DEMO_LAYERS,
  createAtlasSprite,
  createEarth,
  createGameBackground,
  createPost,
  createSky,
  loadShipTexture
} from './halo_ring_demo_env.js';

const DEG = Math.PI / 180;
const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
if (shotMode) document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);
const errorsEl = $('errors');
const shaderErrors = [];
function reportError(text) {
  shaderErrors.push(text);
  errorsEl.style.display = 'block';
  errorsEl.textContent = shaderErrors.join('\n\n');
  console.error(text);
}
window.addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));

// ---------------------------------------------------------------------------
// Renderer (demo jest hostem — moduły ringu go nie tworzą)
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
  logarithmicDepthBuffer: false,
  preserveDrawingBuffer: shotMode
});
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;
renderer.info.autoReset = false;
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = [
    gl.getProgramInfoLog(program),
    gl.getShaderInfoLog(vs),
    gl.getShaderInfoLog(fs)
  ].filter(Boolean).join('\n');
  reportError(`SHADER: ${log}`);
};

const state = {
  mode: 'cine',
  quality: HALO_QUALITY[params.get('quality')] ? params.get('quality') : 'high',
  seed: Number(params.get('seed')) || 1337,
  geometry: {
    width: Number(params.get('w')) || HALO_GEOMETRY_DEFAULTS.width,
    wallHeight: Number(params.get('wall')) || HALO_GEOMETRY_DEFAULTS.wallHeight,
    floorTiltDeg: Number(params.get('tilt')) || 0,
    sectorCount: Number(params.get('sectors')) || 16,
    habitatFacing: params.get('facing') === 'in' ? 'inward' : 'outward',
    // płaszczyzna gry na środku wstęgi (domyślnie); ?plane=roof = układ M1–M5
    ...(params.has('plane') ? { flightLevel: params.get('plane') === 'roof' ? 'roof' : Number(params.get('plane')) } : {})
  },
  sun: { azimuth: 30, elevation: 49, animate: false, speed: 2 },
  exposure: Number(params.get('exposure')) || 1.0,
  layers: { clouds: true, atmosphere: true, cityLights: true, ships: true, city: true, mega: true, bloom: true },
  presetIndex: 0,
  presetName: ''
};

// ---------------------------------------------------------------------------
// Scena
const scene = new THREE.Scene();
scene.matrixWorldAutoUpdate = true;
const planetRadius = RING_PLANET_WORLD_RADII.earth;
const ring = createHaloRing({
  planetRadius,
  seed: state.seed,
  quality: state.quality,
  renderer,
  ...state.geometry
});
ring.setLayers({ default: DEMO_LAYERS.bg, fg: DEMO_LAYERS.fg });
scene.add(ring.group);

const earth = createEarth(renderer, ring.uniforms, planetRadius);
scene.add(earth.game, earth.cine);
const sky = createSky();
scene.add(sky.mesh);
const gameBg = createGameBackground(renderer, { starsZ: -(state.geometry.width + 3000) });
scene.add(gameBg.group);
const atlas = createAtlasSprite(renderer);
scene.add(atlas);
// Statek gracza w porcie Ziemi (tryb „Lot”; poza nim zadokowany): Atlas albo
// frachtowiec jak NPC (klawisz V, ?hull=container_ship) — sprite podmienia tryb lotu
const playerAtlas = createAtlasSprite(renderer);
scene.add(playerAtlas);
let k7Flight = null;
function ensureK7Flight() {
  if (!ring.k7) { k7Flight = null; playerAtlas.visible = false; return null; }
  if (!k7Flight) {
    k7Flight = new K7FlightDemo({
      ring, scene, atlas: playerAtlas, layers: DEMO_LAYERS, $: (id) => document.getElementById(id),
      loadTexture: (path) => loadShipTexture(path, renderer),
      daylightAt: (x, y) => sunVisAt(x, y, 0)
    });
    k7Flight.active = false;
  }
  playerAtlas.visible = true;
  return k7Flight;
}
// Widoczność słońca w punkcie (cień planety, CPU) — lampy hali K-7 w nocy.
function sunVisAt(x, y, z) {
  const c = ring.layout.planetCenterZ;
  const R = ring.layout.planetRadius;
  const ox = x;
  const oy = y;
  const oz = z - c;
  const t = -(ox * sunDir.x + oy * sunDir.y + oz * sunDir.z);
  if (t <= 0) return 1;
  const d = Math.sqrt(Math.max(0, ox * ox + oy * oy + oz * oz - t * t));
  return THREE.MathUtils.smoothstep(d, R - 500, R + 800);
}

const post = createPost(renderer);

// Kamery
const gameCam = { x: 0, y: -30000, zoom: 0.035 };
const camPersp = new THREE.PerspectiveCamera(35, 1, 100, 500000);
const camOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400000);
const cineCam = new THREE.PerspectiveCamera(55, 1, 2, 160000);
cineCam.up.set(0, 0, 1);
const cine = {
  pos: new THREE.Vector3(0, -150000, 60000),
  fwd: new THREE.Vector3(0, 1, -0.3).normalize(),
  up: new THREE.Vector3(0, 0, 1),
  fov: 55,
  focus: 60000
};

// ---------------------------------------------------------------------------
// Rozmiar i jakość
let viewW = 1;
let viewH = 1;
function applyQuality() {
  const q = HALO_QUALITY[state.quality];
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * q.pixelRatio;
  renderer.setPixelRatio(dpr);
  post.configure({ msaa: q.msaa, bloomResolution: q.bloomScale });
  onResize();
}
function onResize() {
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  renderer.setSize(viewW, viewH, false);
  const pr = renderer.getPixelRatio();
  post.resize(Math.max(1, Math.floor(viewW * pr)), Math.max(1, Math.floor(viewH * pr)));
}
window.addEventListener('resize', onResize);
applyQuality();

// ---------------------------------------------------------------------------
// Słońce: azymut w płaszczyźnie XY sceny + wysokość (ring), planeta w grze
// oświetlona w płaszczyźnie (brief §6).
const sunDir = new THREE.Vector3();
function applySun() {
  const az = state.sun.azimuth * DEG;
  const el = state.sun.elevation * DEG;
  ring.setSun(az, el);
  sunDir.copy(ring.uniforms.uSunDir.value);
  sky.uniforms.uSunDirW.value.copy(sunDir);
}
applySun();

// ---------------------------------------------------------------------------
// Replika kamery gry (Core3D.syncCamera): ortho halfW = (viewW/2)/zoom na
// z = 150 000; persp FOV 35°, wysokość (viewH/2)/tan(17,5°)/zoom, lookAt(x,y,0).
function syncGameCameras() {
  const zoom = THREE.MathUtils.clamp(gameCam.zoom, 0.035, 3.2);
  gameCam.zoom = zoom;
  const halfW = (viewW / 2) / zoom;
  const halfH = (viewH / 2) / zoom;
  camOrtho.left = -halfW; camOrtho.right = halfW; camOrtho.top = halfH; camOrtho.bottom = -halfH;
  camOrtho.updateProjectionMatrix();
  const camX = gameCam.x;
  const camY = -gameCam.y;
  camOrtho.position.set(camX, camY, 150000);
  camOrtho.lookAt(camX, camY, 0);
  camOrtho.updateMatrixWorld();
  camPersp.fov = 35;
  camPersp.aspect = viewW / viewH;
  camPersp.near = 100;
  camPersp.far = 500000;
  camPersp.updateProjectionMatrix();
  const h = computeGameCameraHeight(zoom, viewH);
  camPersp.position.set(camX, camY, h);
  camPersp.up.set(0, 1, 0);
  camPersp.lookAt(camX, camY, 0);
  camPersp.updateMatrixWorld();
  atlas.visible = state.mode === 'game';
  atlas.position.set(camX, camY, 0);
  atlas.updateMatrixWorld();
  gameBg.update(camX, camY);
  return h;
}

// ---------------------------------------------------------------------------
// Kamera kinowa: dynamiczny near z analitycznej odległości do ringu i planety
// (renderer gry nie ma logarithmicDepthBuffer — nie opieramy się na nim).
const _v = new THREE.Vector3();
function ringDistance(p) {
  const L = ring.layout;
  const r = Math.hypot(p.x, p.y);
  const inAir = L.isInsideAir(p.x, p.y, p.z);
  if (inAir) {
    const f = L.worldToFloor(p.x, p.y, p.z);
    const ground = Math.max(0, ring.terrainHeightAt(p.x, p.y, p.z));
    const altGround = f.alt - ground;
    const clouds = Math.abs(f.alt - ring.uniforms.uCloudParams.value.x);
    const walls = Math.min(p.z - L.z.botIn, L.z.topIn - p.z);
    return Math.max(1, Math.min(altGround, walls, clouds + 50));
  }
  const dr = Math.max(L.radii.min - r, 0, r - L.radii.max);
  const dz = Math.max(L.bounds.zMin - p.z, 0, p.z - L.bounds.zMax);
  return Math.max(1, Math.hypot(dr, dz));
}
function localUp(p) {
  const r = Math.hypot(p.x, p.y);
  const L = ring.layout;
  const sg = L.sigma;
  const habitatUp = _v.set(sg * p.x / Math.max(r, 1), sg * p.y / Math.max(r, 1), 0);
  // blisko wstęgi „góra” = σ·r̂ (jak dla mieszkańców), daleko = +Z
  const dBand = Math.hypot(Math.max(0, Math.abs(r - L.radii.floorMid) - 2500), Math.max(0, L.bounds.zMin - p.z, p.z - L.bounds.zMax));
  const w = THREE.MathUtils.smoothstep(dBand, 3000, 16000);
  return habitatUp.multiplyScalar(1 - w).add(new THREE.Vector3(0, 0, w)).normalize();
}
// Odległość do brył hal K-7 (prostopadłościany w układach hubów) — hale
// wychodzą poza obwiednię ringu, więc bez tego near przycinał ich dachy.
function k7Distance(p) {
  let best = Infinity;
  for (const hall of ring.k7Halls) {
    const f = hall.frame;
    const dx = p.x - f.origin.x;
    const dy = p.y - f.origin.y;
    const hx = dx * f.tx + dy * f.ty;
    const hz = dx * f.rx + dy * f.ry;
    const ox = Math.max(Math.abs(hx) - (hall.layout.halfWidth + 700), 0);
    const oz = Math.max(f.floorZ - 150 - hz, 0, hz - 8700);
    const oy = Math.max(-1300 - p.z, 0, p.z - 420);
    best = Math.min(best, Math.max(1, Math.hypot(ox, oy, oz)));
  }
  return best;
}
function syncCineCamera() {
  const p = cine.pos;
  cineCam.position.copy(p);
  cineCam.up.copy(cine.up);
  cineCam.lookAt(_v.copy(p).add(cine.fwd));
  const dRing = ringDistance(p);
  const dPlanet = Math.max(1, p.distanceTo(new THREE.Vector3(0, 0, ring.layout.planetCenterZ)) - planetRadius);
  const near = THREE.MathUtils.clamp(Math.min(dRing, dPlanet, k7Distance(p)) * 0.35, 0.5, 20000);
  const far = Math.max(near * 1000, p.length() + ring.layout.radii.max + 90000);
  cineCam.near = near;
  cineCam.far = far;
  cineCam.fov = cine.fov;
  cineCam.aspect = viewW / viewH;
  cineCam.updateProjectionMatrix();
  cineCam.updateMatrixWorld();
  sky.mesh.position.copy(p);
  sky.mesh.updateMatrixWorld();
}

// ---------------------------------------------------------------------------
// Presety (każdy z własnym słońcem). Współrzędne: lokalny układ ringu.
function sectorCenter(index) {
  const L = ring.layout;
  const s = L.sectors[index % L.sectors.length];
  return s.centerAngle;
}
function floorPoint(theta, v, lift) {
  const L = ring.layout;
  const t = v * L.floor.length;
  const s = theta * L.radii.floorMid;
  const p = L.floorPoint(s, t, 0, {});
  const h = Math.max(0, ring.terrainHeightAt(p.x, p.y, p.z));
  const q = L.floorPoint(s, t, h + lift, {});
  return new THREE.Vector3(q.x, q.y, q.z);
}
// Baza lokalna na kącie θ: along = θ̂, up = σ·r̂ (góra mieszkańców), out = r̂.
function frameAt(theta) {
  const sg = ring.layout.sigma;
  return {
    along: new THREE.Vector3(-Math.sin(theta), Math.cos(theta), 0),
    up: new THREE.Vector3(sg * Math.cos(theta), sg * Math.sin(theta), 0),
    out: new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0),
    z: new THREE.Vector3(0, 0, 1)
  };
}
function dirAt(theta, alongSign, pitchDeg, sideZDeg = 0) {
  const f = frameAt(theta);
  const yaw = sideZDeg * DEG;
  const pitch = pitchDeg * DEG;
  const horiz = f.along.clone().multiplyScalar(Math.cos(yaw) * Math.sign(alongSign || 1)).add(f.z.clone().multiplyScalar(Math.sin(yaw)));
  return horiz.multiplyScalar(Math.cos(pitch)).add(f.up.clone().multiplyScalar(Math.sin(pitch))).normalize();
}
function habitatUp(theta) {
  return frameAt(theta).up;
}
// Kamera poza ringiem na kącie θ, patrząca na środek otwartego habitatu
// o lookDeg dalej po łuku (wariant „na zewnątrz”).
function outsideLook(theta, rOff, z, lookDeg, lookZ) {
  const L = ring.layout;
  const pos = new THREE.Vector3(Math.cos(theta) * (L.radii.rim + rOff), Math.sin(theta) * (L.radii.rim + rOff), z);
  const tl = theta + lookDeg * DEG;
  const rt = (L.radii.floorMid + L.radii.rim) / 2;
  const fwd = new THREE.Vector3(Math.cos(tl) * rt, Math.sin(tl) * rt, lookZ).sub(pos).normalize();
  return { pos, fwd };
}
// Szczyt w pobliżu (preset z góry): przeszukanie mapy CPU
function findPeak(theta0, spanDeg, vMin, vMax) {
  let best = { theta: theta0, v: (vMin + vMax) / 2, h: -1e9 };
  const L = ring.layout;
  for (let i = 0; i <= 60; i++) {
    const th = theta0 + (i / 60 - 0.5) * spanDeg * DEG;
    for (let j = 0; j <= 16; j++) {
      const v = vMin + (vMax - vMin) * j / 16;
      const s = th * L.radii.floorMid;
      const p = L.floorPoint(s, v * L.floor.length, 0, {});
      const h = ring.terrainHeightAt(p.x, p.y, p.z);
      if (h > best.h) best = { theta: th, v, h };
    }
  }
  return best;
}

// Presety wariantu Halo (habitat do planety) — z M2, bez zmian.
const PRESETS_INWARD = [
  {
    key: '1', name: 'Łuk w niebo (z podłogi, ref. 2)',
    build() {
      const th0 = sectorCenter(3);
      // wzgórze u stóp gór (szczyt ~900 j. to już górna granica powietrza — niebo tam czarne)
      const peak = findPeak(th0, 10, 0.22, 0.45);
      const pos = floorPoint(peak.theta, peak.v + 0.06, 60);
      return { mode: 'cine', pos, fwd: dirAt(peak.theta, 1, 11, 8), up: habitatUp(peak.theta), fov: 62,
        // Słońce 58° nad płaszczyzną: cień planety ~±24°, czerwony półcień do
        // ~±35° (kamera leży pod równikiem planety, więc promień mija limb nisko).
        // Kamera 42° od punktu przeciwsłonecznego = pełny dzień; łuk przed nią
        // w pasie dnia do 90°; górna ściana ocienia górną część podłogi.
        sun: { azimuth: peak.theta / DEG + 138, elevation: 58 } };
    }
  },
  {
    key: '2', name: 'Wnętrze przez mgłę (z zewnątrz, ref. 1)',
    build() {
      // Planeta wypełnia otwór wstęgi (37,8 z 41,8 tys. j.), więc wnętrze widać
      // z zewnątrz tylko pod kątem: z wąwozu między atmosferą planety a ringiem,
      // ponad płaszczyzną dachu, wzdłuż łuku.
      const th = sectorCenter(2) - 8 * DEG;
      const L = ring.layout;
      const r = L.radii.rim - 1650;
      const pos = new THREE.Vector3(Math.cos(th) * r, Math.sin(th) * r, 1500);
      const along = new THREE.Vector3(-Math.sin(th), Math.cos(th), 0);
      const out = new THREE.Vector3(Math.cos(th), Math.sin(th), 0);
      const fwd = along.multiplyScalar(0.9).add(out.multiplyScalar(0.3)).add(new THREE.Vector3(0, 0, -0.22)).normalize();
      return { mode: 'cine', pos, fwd, up: new THREE.Vector3(0, 0, 1), fov: 58,
        sun: { azimuth: th / DEG + 16 + 116, elevation: 30 } };
    }
  },
  {
    key: '3', name: 'Dach z góry (ref. 3)',
    build() {
      const th = sectorCenter(7);
      const L = ring.layout;
      const r = (L.radii.rim + L.radii.hull) * 0.5 + 900;
      const pos = new THREE.Vector3(Math.cos(th) * r, Math.sin(th) * r, 2600);
      const fwd = dirAt(th, 1, 0).multiplyScalar(0.75).add(new THREE.Vector3(0, 0, -1)).normalize();
      return { mode: 'cine', pos, fwd, up: new THREE.Vector3(Math.cos(th), Math.sin(th), 0), fov: 50,
        sun: { azimuth: th / DEG + 60, elevation: 49 } };
    }
  },
  {
    key: '4', name: 'Nocne miasto nad Ziemią (ref. 4)',
    build() {
      const th = sectorCenter(8) - 6 * DEG;
      const L = ring.layout;
      const r = L.radii.rim - 1400;
      const pos = new THREE.Vector3(Math.cos(th) * r, Math.sin(th) * r, 900);
      const fwd = dirAt(th, 1, 0).multiplyScalar(0.96).add(new THREE.Vector3(Math.cos(th), Math.sin(th), 0).multiplyScalar(0.12)).add(new THREE.Vector3(0, 0, -0.22)).normalize();
      return { mode: 'cine', pos, fwd, up: new THREE.Vector3(-Math.cos(th), -Math.sin(th), 0.4).normalize(), fov: 55,
        sun: { azimuth: th / DEG + 5, elevation: 40 } };
    }
  },
  {
    key: '5', name: 'Szklane tarasy (ref. 5)',
    build() {
      const th = sectorCenter(4);
      const pos = floorPoint(th, 0.22, 380);
      const fwd = dirAt(th, 1, -4, -38);
      return { mode: 'cine', pos, fwd, up: habitatUp(th), fov: 58, sun: { azimuth: th / DEG + 138, elevation: 58 } };
    }
  },
  {
    key: '6', name: 'Miasto-ogród (nisko, ref. 6)',
    build() {
      const th = sectorCenter(5) - 2 * DEG;
      // bliżej dolnej ściany: górna ściana ocienia ~40% pasa przy tym słońcu
      const pos = floorPoint(th, 0.3, 300);
      return { mode: 'cine', pos, fwd: dirAt(th, 1, -5, 4), up: habitatUp(th), fov: 60,
        sun: { azimuth: th / DEG + 138, elevation: 58 } };
    }
  },
  {
    key: '7', name: 'Kamera gry (zoom 0,035)',
    build() {
      // stacja Ziemi: kąt 45° w układzie gry (y w dół), ring 41,8–43,75 tys. j.
      const a = 45 * DEG;
      return { mode: 'game', game: { x: Math.cos(a) * 30500, y: Math.sin(a) * 30500, zoom: 0.035 },
        // słońce tak, żeby ten odcinek był w pasie dnia (~65° od punktu przeciwsłonecznego)
        sun: { azimuth: 70, elevation: 49 } };
    }
  },
  {
    key: '8', name: 'Planeta z ringiem (szeroki plan)',
    build() {
      const az = 205 * DEG;
      const el = 21 * DEG;
      const d = 205000;
      const L = ring.layout;
      const c = new THREE.Vector3(0, 0, L.planetCenterZ);
      const pos = new THREE.Vector3(Math.cos(az) * Math.cos(el) * d, Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d + L.planetCenterZ);
      const fwd = c.clone().sub(pos).normalize();
      return { mode: 'cine', pos, fwd, up: new THREE.Vector3(0, 0, 1), fov: 32, sun: { azimuth: 205 + 72, elevation: 24 } };
    }
  }
];

// Presety wariantu „na zewnątrz” (habitat w stronę kosmosu, domyślny od
// 2026-09-23). Dzień habitatu = strona zwrócona do Słońca, jak dzień planety
// pod nim; słońce nad płaszczyzną każe górnej ścianie ocieniać pas przy niej.
const PRESETS_OUTWARD = [
  {
    key: '1', name: 'Dolina alpejska (z podłogi)',
    build() {
      // wstęga jest wypukła: horyzont blisko, ściany zbiegają się nad nim
      const th = sectorCenter(3) - 4 * DEG;
      const pos = floorPoint(th, 0.3, 400);
      return { mode: 'cine', pos, fwd: dirAt(th, 1, -3, -15), up: habitatUp(th), fov: 60,
        sun: { azimuth: th / DEG - 35, elevation: 20 } };
    }
  },
  {
    key: '2', name: 'Habitat nad Ziemią (z zewnątrz, ref. 1 i 6)',
    build() {
      // z boku ringu na wysokości habitatu, wzdłuż łuku: morze, wyspy, lodowiec
      // na końcu kadru i Ziemia za wstęgą
      const th = sectorCenter(2) - 6 * DEG;
      const zc = ring.layout.z.floorMid;
      const { pos, fwd } = outsideLook(th, 7000, zc, 14, zc);
      return { mode: 'cine', pos, fwd, up: new THREE.Vector3(0, 0, 1), fov: 50,
        sun: { azimuth: th / DEG - 10, elevation: 30 } };
    }
  },
  {
    key: '3', name: 'Dach i otwarty habitat (ref. 3)',
    build() {
      const th = sectorCenter(7);
      const L = ring.layout;
      const f = frameAt(th);
      const pos = f.out.clone().multiplyScalar(L.radii.rim + 1600).add(new THREE.Vector3(0, 0, 2600 + L.zShift));
      const fwd = f.along.clone().multiplyScalar(0.7).add(f.out.clone().multiplyScalar(-0.45)).add(new THREE.Vector3(0, 0, -0.55)).normalize();
      return { mode: 'cine', pos, fwd, up: new THREE.Vector3(0, 0, 1), fov: 55,
        sun: { azimuth: th / DEG + 25, elevation: 40 } };
    }
  },
  {
    key: '4', name: 'Nocne miasto o świcie (ref. 4)',
    build() {
      // Słońce 105° od kierunku habitatu: odcinek przy kamerze w nocy (światła
      // miast), dalej po łuku terminator i świt; za wstęgą dzienny brzeg Ziemi
      const th = sectorCenter(8);
      const zc = ring.layout.z.floorMid;
      const { pos, fwd } = outsideLook(th, 7000, zc, 14, zc);
      return { mode: 'cine', pos, fwd, up: new THREE.Vector3(0, 0, 1), fov: 50,
        sun: { azimuth: th / DEG + 105, elevation: 10 } };
    }
  },
  {
    key: '5', name: 'Szklane tarasy (ref. 5)',
    build() {
      const th = sectorCenter(4);
      const pos = floorPoint(th, 0.78, 380);
      return { mode: 'cine', pos, fwd: dirAt(th, 1, -3, -55), up: habitatUp(th), fov: 58,
        sun: { azimuth: th / DEG - 30, elevation: 30 } };
    }
  },
  {
    key: '6', name: 'Miasto-ogród (nisko, ref. 6)',
    build() {
      const th = sectorCenter(5) - 2 * DEG;
      const pos = floorPoint(th, 0.35, 300);
      return { mode: 'cine', pos, fwd: dirAt(th, 1, -6, 4), up: habitatUp(th), fov: 60,
        sun: { azimuth: th / DEG - 35, elevation: 30 } };
    }
  },
  {
    key: '7', name: 'Kamera gry (zoom 0,035)',
    build() {
      // poza ringiem przy stacji Ziemi (45° w układzie gry, y w dół);
      // Słońce po tej stronie: dzień habitatu = dzień planety obok
      const a = 45 * DEG;
      return { mode: 'game', game: { x: Math.cos(a) * 52000, y: Math.sin(a) * 52000, zoom: 0.035 },
        sun: { azimuth: -25, elevation: 49 } };
    }
  },
  {
    key: '8', name: 'Planeta z ringiem (szeroki plan)',
    build() {
      const az = 205 * DEG;
      const el = 21 * DEG;
      const d = 205000;
      const L = ring.layout;
      const c = new THREE.Vector3(0, 0, L.planetCenterZ);
      const pos = new THREE.Vector3(Math.cos(az) * Math.cos(el) * d, Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d + L.planetCenterZ);
      const fwd = c.clone().sub(pos).normalize();
      return { mode: 'cine', pos, fwd, up: new THREE.Vector3(0, 0, 1), fov: 32, sun: { azimuth: 232, elevation: 28 } };
    }
  }
];
PRESETS_OUTWARD.push({
  key: '9', name: 'Port Kepler: K-7 i doki transportowe',
  build() {
    // K-7 (dok gameplayowy z ECUMENE) wpięty w podłogę habitatu na środku
    // wstęgi, po bokach doki transportowe — widok z kosmosu jak na zrzucie
    // użytkownika (Ziemia za ringiem, płaszczyzna gry przecina ring w połowie)
    const f = ring.k7?.frame;
    const L = ring.layout;
    if (!f) {
      const th = HALO_STATION_ANGLE;
      const pos = new THREE.Vector3(Math.cos(th) * (L.radii.rim + 16000), Math.sin(th) * (L.radii.rim + 16000), L.z.floorMid + 7000);
      return { mode: 'cine', pos, fwd: new THREE.Vector3(-Math.cos(th), -Math.sin(th), -0.4).normalize(), up: new THREE.Vector3(0, 0, 1), fov: 45, sun: { azimuth: th / DEG - 35, elevation: 32 } };
    }
    const pos = new THREE.Vector3(f.origin.x + f.rx * 21000 + f.tx * -3500, f.origin.y + f.ry * 21000 + f.ty * -3500, 7600);
    const tgt = new THREE.Vector3(f.origin.x + f.rx * 1500 + f.tx * 1200, f.origin.y + f.ry * 1500 + f.ty * 1200, -600);
    return { mode: 'cine', pos, fwd: tgt.sub(pos).normalize(), up: new THREE.Vector3(0, 0, 1), fov: 42,
      sun: { azimuth: Math.atan2(f.ry, f.rx) / DEG - 30, elevation: 40 } };
  }
});
const HALO_TRANSIT_ANGLES = haloTransitAngles();
PRESETS_OUTWARD.push({
  key: 'T', name: 'Tranzyt T-01 przez ring (wyspa portowa)',
  build() {
    // tunel w płycie podłogi (jak w K-7 z ECUMENE, 4 osie co 90°): portal na
    // płycie w morzu PELAGIC, wokół pas techniczny; statki przelatują na
    // stronę planety
    const L = ring.layout;
    const th = HALO_TRANSIT_ANGLES[0];
    const f = frameAt(th);
    const pos = f.out.clone().multiplyScalar(L.radii.floorMid + 4200).add(f.along.clone().multiplyScalar(-2300)).add(new THREE.Vector3(0, 0, 1100));
    const tgt = f.out.clone().multiplyScalar(L.radii.floorMid).add(f.along.clone().multiplyScalar(150));
    return { mode: 'cine', pos, fwd: tgt.sub(pos).normalize(), up: new THREE.Vector3(0, 0, 1), fov: 50,
      sun: { azimuth: th / DEG - 30, elevation: 35 } };
  }
});
const presetList = () => (ring.layout.sigma > 0 ? PRESETS_OUTWARD : PRESETS_INWARD);

// Megabudowle z ECUMENE (M, Shift+M wstecz): kolejna budowla — w kamerze
// kinowej ujęcie od frontu (od strony górnej ściany, skąd patrzy kamera gry),
// w kamerze gry nad budowlą (fasada +z patrzy w kamerę); noc = słońce po
// drugiej stronie ringu.
let landmarkIndex = -1;
function landmarkView(index, { mode = 'cine', night = false, zoom = 0.45 } = {}) {
  const list = ring.landmarks || [];
  if (!list.length) return null;
  const lm = list[((index % list.length) + list.length) % list.length];
  const L = ring.layout;
  const th = lm.theta;
  const f = frameAt(th);
  const sun = night ? { azimuth: th / DEG + 150, elevation: 25 } : { azimuth: th / DEG - 30, elevation: 38 };
  const name = `M. ${lm.name} (${lm.sectorName})`;
  if (mode === 'game') {
    const r = L.floorRadiusAtT(lm.t) + L.sigma * (lm.plazaH + lm.h * 0.45);
    return { mode: 'game', game: { x: Math.cos(th) * r, y: -Math.sin(th) * r, zoom }, sun, name, lm };
  }
  const base = L.floorPoint(lm.s, lm.t, lm.plazaH, {});
  const p0 = new THREE.Vector3(base.x, base.y, base.z);
  const H = lm.h + 60;
  const tgt = p0.clone().addScaledVector(f.up, H * 0.42);
  const dist = H * 1.2 + lm.d * 0.5 + 300;
  // nad dachami otoczenia (szklane wieże sięgają ~300 j.)
  const pos = p0.clone().addScaledVector(f.z, dist).addScaledVector(f.up, H * 0.3 + 120).addScaledVector(f.along, dist * 0.35);
  pos.z = Math.min(pos.z, L.z.topIn - 200);
  return { mode: 'cine', pos, fwd: tgt.sub(pos).normalize(), up: f.up.clone(), fov: 55, sun, name, lm };
}
// Kopuły-biosfery (K, Shift+K wstecz): ujęcie z ukosa znad parku (szkło,
// wnętrze wg typu, wejścia), w kamerze gry nad kopułą.
let domeIndex = -1;
function domeView(index, { mode = 'cine', night = false, zoom = 0.45 } = {}) {
  const list = ring.domes || [];
  if (!list.length) return null;
  const dm = list[((index % list.length) + list.length) % list.length];
  const L = ring.layout;
  const th = dm.theta;
  const f = frameAt(th);
  const sun = night ? { azimuth: th / DEG + 150, elevation: 25 } : { azimuth: th / DEG - 30, elevation: 38 };
  const name = `K. ${dm.name}`;
  if (mode === 'game') {
    const r = L.floorRadiusAtT(dm.t) + L.sigma * (dm.floorH + dm.h * 0.5);
    return { mode: 'game', game: { x: Math.cos(th) * r, y: -Math.sin(th) * r, zoom }, sun, name, dome: dm };
  }
  const base = L.floorPoint(dm.s, dm.t, dm.floorH, {});
  const p0 = new THREE.Vector3(base.x, base.y, base.z);
  const tgt = p0.clone().addScaledVector(f.up, dm.h * 0.25);
  const dist = dm.r * 2.2 + 350;
  const pos = p0.clone().addScaledVector(f.z, dist * 0.8).addScaledVector(f.up, dm.h * 0.9 + 260).addScaledVector(f.along, dist * 0.55);
  pos.z = Math.min(pos.z, L.z.topIn - 200);
  return { mode: 'cine', pos, fwd: tgt.sub(pos).normalize(), up: f.up.clone(), fov: 55, sun, name, dome: dm };
}
function applyDome(index, opts) {
  const cfg = domeView(index, opts);
  if (!applyCivicView(cfg)) return null;
  const dm = cfg.dome;
  return { name: dm.name, type: dm.type, sector: dm.sectorName, theta: dm.theta, t: dm.t, z: dm.z, floorH: dm.floorH, r: dm.r, h: dm.h };
}
function applyLandmark(index, opts) {
  const cfg = landmarkView(index, opts);
  if (!applyCivicView(cfg)) return null;
  const lm = cfg.lm;
  return { name: lm.name, sector: lm.sectorName, theta: lm.theta, t: lm.t, z: lm.z, plazaH: lm.plazaH, h: lm.h };
}
function applyCivicView(cfg) {
  if (!cfg) return false;
  tour.active = false;
  state.sun.azimuth = ((cfg.sun.azimuth + 540) % 360) - 180;
  state.sun.elevation = cfg.sun.elevation;
  applySun();
  if (cfg.mode === 'game') {
    setMode('game');
    Object.assign(gameCam, cfg.game);
  } else {
    setMode('cine');
    cine.pos.copy(cfg.pos);
    cine.fwd.copy(cfg.fwd).normalize();
    cine.up.copy(cfg.up).normalize();
    cine.fov = cfg.fov;
  }
  state.presetName = cfg.name;
  syncUi();
  return true;
}

function applyPreset(index, { instant = true } = {}) {
  const preset = presetList()[index];
  if (!preset) return;
  const cfg = preset.build();
  state.presetIndex = index;
  state.presetName = `${preset.key}. ${preset.name}`;
  if (cfg.sun) {
    state.sun.azimuth = ((cfg.sun.azimuth + 540) % 360) - 180;
    state.sun.elevation = cfg.sun.elevation;
    applySun();
  }
  if (cfg.mode === 'game') {
    setMode('game');
    Object.assign(gameCam, cfg.game);
  } else {
    setMode('cine');
    if (instant) {
      cine.pos.copy(cfg.pos);
      cine.fwd.copy(cfg.fwd).normalize();
      cine.up.copy(cfg.up).normalize();
      cine.fov = cfg.fov;
    }
  }
  syncUi();
  return cfg;
}

// ---------------------------------------------------------------------------
// Wycieczka (C): płynne przejazdy między presetami kinowymi
const tour = { active: false, t: 0, from: null, to: null, index: 0, hold: 0 };
function startTour() {
  tour.active = true;
  tour.index = 0;
  tour.t = 0;
  tour.hold = 0;
  setMode('cine');
  tour.from = { pos: cine.pos.clone(), fwd: cine.fwd.clone(), up: cine.up.clone(), fov: cine.fov, sun: { ...state.sun } };
  nextTourLeg();
}
function nextTourLeg() {
  const list = presetList();
  const cineIdx = list.map((p, i) => i).filter((i) => i !== 6);
  const idx = cineIdx[tour.index % cineIdx.length];
  const cfg = list[idx].build();
  state.presetName = `wycieczka → ${list[idx].key}. ${list[idx].name}`;
  tour.to = { pos: cfg.pos, fwd: cfg.fwd, up: cfg.up, fov: cfg.fov, sun: cfg.sun };
  tour.t = 0;
  tour.hold = 0;
}
function updateTour(dt) {
  if (!tour.active) return;
  if (tour.t >= 1) {
    tour.hold += dt;
    if (tour.hold > 4) {
      tour.from = { pos: cine.pos.clone(), fwd: cine.fwd.clone(), up: cine.up.clone(), fov: cine.fov, sun: { ...state.sun } };
      tour.index++;
      nextTourLeg();
    }
    return;
  }
  tour.t = Math.min(1, tour.t + dt / 9);
  const k = tour.t * tour.t * (3 - 2 * tour.t);
  const a = tour.from;
  const b = tour.to;
  // przejazd łukiem nad pierścieniem: środek odsunięty na zewnątrz i w górę
  const mid = a.pos.clone().add(b.pos).multiplyScalar(0.5);
  const lift = Math.max(20000, a.pos.distanceTo(b.pos) * 0.35);
  mid.add(new THREE.Vector3(mid.x, mid.y, 0).normalize().multiplyScalar(lift * 0.5)).add(new THREE.Vector3(0, 0, lift));
  const p1 = a.pos.clone().lerp(mid, k);
  const p2 = mid.clone().lerp(b.pos, k);
  cine.pos.copy(p1.lerp(p2, k));
  cine.fwd.copy(a.fwd).lerp(b.fwd, k).normalize();
  cine.up.copy(a.up).lerp(b.up, k).normalize();
  cine.fov = a.fov + (b.fov - a.fov) * k;
  const dAz = ((b.sun.azimuth - a.sun.azimuth + 540) % 360) - 180;
  state.sun.azimuth = a.sun.azimuth + dAz * k;
  state.sun.elevation = a.sun.elevation + (b.sun.elevation - a.sun.elevation) * k;
  applySun();
}

// ---------------------------------------------------------------------------
// Sterowanie
const keys = new Set();
let dragging = 0;
let lastX = 0;
let lastY = 0;
function setMode(mode) {
  if (mode === 'flight' && !ensureK7Flight()) mode = 'game';
  state.mode = mode;
  $('cam-game').classList.toggle('on', mode === 'game');
  $('cam-cine').classList.toggle('on', mode === 'cine');
  $('cam-flight').classList.toggle('on', mode === 'flight');
  k7Flight?.setActive(mode === 'flight');
  if (mode === 'flight') gameCam.zoom = Math.max(gameCam.zoom, 0.5);
}
const isGameView = () => state.mode === 'game' || state.mode === 'flight';
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  dragging = e.button === 2 ? 2 : 1;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  tour.active = false;
});
canvas.addEventListener('pointerup', () => { dragging = 0; });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  if (state.mode === 'game') {
    gameCam.x -= dx / gameCam.zoom;
    gameCam.y -= dy / gameCam.zoom;
    return;
  }
  if (state.mode === 'flight') return;
  const right = new THREE.Vector3().crossVectors(cine.fwd, cine.up).normalize();
  if (dragging === 1) {
    const q = new THREE.Quaternion().setFromAxisAngle(cine.up, -dx * 0.0035);
    cine.fwd.applyQuaternion(q);
    const q2 = new THREE.Quaternion().setFromAxisAngle(right, -dy * 0.0035);
    const f2 = cine.fwd.clone().applyQuaternion(q2);
    if (Math.abs(f2.dot(cine.up)) < 0.985) cine.fwd.copy(f2);
    cine.fwd.normalize();
  } else {
    const pivot = cine.pos.clone().add(cine.fwd.clone().multiplyScalar(cine.focus));
    const q = new THREE.Quaternion().setFromAxisAngle(cine.up, -dx * 0.004);
    const q2 = new THREE.Quaternion().setFromAxisAngle(right, -dy * 0.004);
    const off = cine.pos.clone().sub(pivot).applyQuaternion(q).applyQuaternion(q2);
    cine.pos.copy(pivot).add(off);
    cine.fwd.copy(pivot).sub(cine.pos).normalize();
  }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (isGameView()) {
    gameCam.zoom = THREE.MathUtils.clamp(gameCam.zoom * Math.exp(-e.deltaY * 0.0012), 0.035, 3.2);
  } else {
    cine.fov = THREE.MathUtils.clamp(cine.fov * Math.exp(e.deltaY * 0.0008), 12, 100);
  }
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  keys.add(e.code);
  if (/^Digit[1-9]$/.test(e.code) && Number(e.code.slice(5)) <= presetList().length) { tour.active = false; applyPreset(Number(e.code.slice(5)) - 1); }
  if (e.code === 'KeyC' && state.mode !== 'flight') startTour();
  if (e.code === 'Digit0' && state.mode === 'game') Object.assign(gameCam, { x: 0, y: -30000, zoom: 0.035 });
  if (e.code === 'Digit0' && state.mode === 'flight') gameCam.zoom = 1;
  if (e.code === 'KeyL' && !e.repeat) setMode(state.mode === 'flight' ? 'game' : 'flight');
  if (e.code === 'KeyE' && !e.repeat && state.mode === 'flight') k7Flight?.action();
  if (e.code === 'KeyV' && !e.repeat && state.mode === 'flight') k7Flight?.cycleHull();
  if (e.code === 'KeyT' && !e.repeat && state.mode === 'flight') k7Flight?.jumpToTransit();
  if (e.code === 'KeyT' && !e.repeat && state.mode !== 'flight') {
    const i = presetList().findIndex((p) => p.key === 'T');
    if (i >= 0) { tour.active = false; applyPreset(i); }
  }
  if (e.code === 'KeyM' && !e.repeat && state.mode !== 'flight') {
    landmarkIndex += e.shiftKey ? -1 : 1;
    applyLandmark(landmarkIndex, { mode: state.mode === 'game' ? 'game' : 'cine' });
  }
  if (e.code === 'KeyK' && !e.repeat && state.mode !== 'flight') {
    domeIndex += e.shiftKey ? -1 : 1;
    applyDome(domeIndex, { mode: state.mode === 'game' ? 'game' : 'cine' });
  }
  if (state.mode === 'flight' && ['Space', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function updateControls(dt) {
  const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 5 : 1;
  if (state.mode === 'flight') return;
  if (state.mode === 'game') {
    const sp = 900 / gameCam.zoom * dt * fast;
    if (keys.has('KeyW')) gameCam.y -= sp;
    if (keys.has('KeyS')) gameCam.y += sp;
    if (keys.has('KeyA')) gameCam.x -= sp;
    if (keys.has('KeyD')) gameCam.x += sp;
    return;
  }
  const dist = ringDistance(cine.pos);
  const sp = THREE.MathUtils.clamp(dist * 0.6, 25, 30000) * dt * fast;
  const right = new THREE.Vector3().crossVectors(cine.fwd, cine.up).normalize();
  const move = new THREE.Vector3();
  if (keys.has('KeyW')) move.add(cine.fwd);
  if (keys.has('KeyS')) move.sub(cine.fwd);
  if (keys.has('KeyD')) move.add(right);
  if (keys.has('KeyA')) move.sub(right);
  if (keys.has('KeyE')) move.add(cine.up);
  if (keys.has('KeyQ')) move.sub(cine.up);
  if (move.lengthSq() > 0) {
    tour.active = false;
    cine.pos.addScaledVector(move.normalize(), sp);
    // „góra” podąża za położeniem (blisko wstęgi = ku osi ringu)
    cine.up.lerp(localUp(cine.pos), Math.min(1, dt * 1.5)).normalize();
  }
}

// ---------------------------------------------------------------------------
// Render
let lastFrameTime = performance.now();
let frameMs = 16;
let fps = 60;
let gpuMs = 0;
const gl = renderer.getContext();
const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const gpuQueries = [];
let gpuActive = null;
function gpuBegin() {
  if (!timerExt || gpuActive || gpuQueries.length > 4) return;
  gpuActive = gl.createQuery();
  gl.beginQuery(timerExt.TIME_ELAPSED_EXT, gpuActive);
}
function gpuEnd() {
  if (!gpuActive) return;
  gl.endQuery(timerExt.TIME_ELAPSED_EXT);
  gpuQueries.push(gpuActive);
  gpuActive = null;
}
function gpuPoll() {
  if (!timerExt) return;
  if (gl.getParameter(timerExt.GPU_DISJOINT_EXT)) { gpuQueries.length = 0; return; }
  while (gpuQueries.length && gl.getQueryParameter(gpuQueries[0], gl.QUERY_RESULT_AVAILABLE)) {
    const q = gpuQueries.shift();
    gpuMs = gpuMs * 0.85 + (gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6) * 0.15;
    gl.deleteQuery(q);
  }
}

let lastCameraHeight = 0;
function renderScene(target) {
  if (target) {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
  } else {
    post.begin();
  }
  if (isGameView()) {
    // BG persp (layer 1: ring + tło gry)
    camPersp.layers.set(DEMO_LAYERS.gameSky);
    camPersp.layers.enable(DEMO_LAYERS.bg);
    renderer.render(scene, camPersp);
    // Ziemia w ortho: czyszczenie głębi, planeta rysuje się PO ringu (§5.6)
    renderer.clearDepth();
    camOrtho.layers.set(DEMO_LAYERS.ringPlanet);
    renderer.render(scene, camOrtho);
    // świat ortho (layer 0): sprite Atlasa dla skali
    renderer.clearDepth();
    camOrtho.layers.set(DEMO_LAYERS.world);
    if (state.layers.ships && params.get('ships') !== '0') renderer.render(scene, camOrtho);
    // FG persp (layer 2, jak w grze po świecie ortho): suwnice, węże i dach K-7
    // nad statkami — celowo, statek w hali jest POD mostem suwnicy
    renderer.clearDepth();
    camPersp.layers.set(DEMO_LAYERS.fg);
    renderer.render(scene, camPersp);
  } else {
    cineCam.layers.set(DEMO_LAYERS.cineSky);
    cineCam.layers.enable(DEMO_LAYERS.cinePlanet);
    cineCam.layers.enable(DEMO_LAYERS.bg);
    cineCam.layers.enable(DEMO_LAYERS.fg);
    // Atlas gracza (sprite + kadłub) w porcie K-7
    if (k7Flight && state.layers.ships) cineCam.layers.enable(DEMO_LAYERS.world);
    renderer.render(scene, cineCam);
  }
}

function prepareFrame(dt) {
  if (state.sun.animate) {
    state.sun.azimuth = ((state.sun.azimuth + dt * state.sun.speed + 540) % 360) - 180;
    applySun();
  }
  updateTour(dt);
  updateControls(dt);
  // hale bez trybu lotu: światła hal, dzień/noc (z trybem lotu hale
  // aktualizuje on — suwnice, dachy, lampki stanowisk hal i zatok)
  if (!k7Flight) {
    for (const hall of ring.k7Halls) hall.update(dt, { daylight: sunVisAt(hall.frame.origin.x, hall.frame.origin.y, 0) });
  }
  if (k7Flight) {
    k7Flight.update(dt, state.mode === 'flight' ? keys : null);
    if (state.mode === 'flight') k7Flight.followCamera(gameCam, dt);
  }
  let camera;
  if (isGameView()) {
    lastCameraHeight = syncGameCameras();
    camera = camPersp;
  } else {
    syncCineCamera();
    camera = cineCam;
  }
  ring.update(dt, { camera, viewportHeight: renderer.domElement.height, gameView: isGameView() });
  earth.update(dt, {
    planetCenterZ: ring.layout.planetCenterZ,
    sunAzimuth: state.sun.azimuth * DEG,
    sunDir,
    ringShadow: { strength: 0.55, radius: (ring.layout.envelope.innerRadius + ring.layout.envelope.outerRadius) * 0.5, reach: (ring.layout.envelope.innerRadius + ring.layout.envelope.outerRadius) * 0.5 * 1.15 }
  });
}

function frame() {
  const now = performance.now();
  const dt = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  const t0 = performance.now();
  gpuPoll();
  gpuBegin();
  renderer.info.reset();
  prepareFrame(dt);
  renderScene(null);
  const calls = renderer.info.render.calls;
  const tris = renderer.info.render.triangles;
  post.finish(dt);
  gpuEnd();
  frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
  fps = fps * 0.92 + (1 / Math.max(dt, 1e-3)) * 0.08;
  lastStats.calls = calls;
  lastStats.triangles = tris;
  updateHud();
  k7Flight?.hud();
  if (!shotMode) requestAnimationFrame(frame);
}
const lastStats = { calls: 0, triangles: 0 };

// ---------------------------------------------------------------------------
// HUD
function fmtBytes(b) { return `${(b / 1048576).toFixed(0)} MB`; }
let hudTimer = 0;
function updateHud() {
  const now = performance.now();
  if (now - hudTimer < 250) return;
  hudTimer = now;
  const st = ring.stats;
  const lines = [
    `<b>FPS</b> ${fps.toFixed(0).padStart(4)}   <b>ms</b> ${frameMs.toFixed(1)}${timerExt ? `  <b>GPU</b> ${gpuMs.toFixed(1)}` : ''}`,
    `<b>draw calle</b> ${lastStats.calls}   <b>trójkąty</b> ${(lastStats.triangles / 1000).toFixed(0)} tys.`,
    `<b>kafle</b> ${st.activeTiles}   <b>segmenty</b> ${st.segments}`,
    `<b>tekstury ringu</b> ${fmtBytes(st.textureBytes)}   <b>mapy</b> ${(st.mapProgress * 100).toFixed(0)}%`,
    isGameView()
      ? `<b>${state.mode === 'flight' ? 'lot K-7' : 'kamera gry'}</b> zoom ${gameCam.zoom.toFixed(3)}  h ${lastCameraHeight.toFixed(0)} j.`
      : `<b>kino</b> near ${cineCam.near.toFixed(1)}  far ${(cineCam.far / 1000).toFixed(0)} tys.  FOV ${cine.fov.toFixed(0)}°`,
    `<b>słońce</b> az ${state.sun.azimuth.toFixed(1)}°  wys ${state.sun.elevation.toFixed(1)}°  ${st.shellActive ? '· w powietrzu' : ''}`
  ];
  $('hud').innerHTML = lines.join('\n');
  $('loading').style.display = st.mapsReady ? 'none' : 'block';
  $('loading').textContent = `Pieczenie map habitatu… ${(st.mapProgress * 100).toFixed(0)}%`;
}

// ---------------------------------------------------------------------------
// UI
function bindRange(id, get, set, fmt) {
  const el = $(id);
  const out = $(`${id}-o`);
  el.value = get();
  if (out) out.textContent = fmt(get());
  el.addEventListener('input', () => {
    set(Number(el.value));
    if (out) out.textContent = fmt(Number(el.value));
  });
  return () => { el.value = get(); if (out) out.textContent = fmt(get()); };
}
const uiSync = [];
function syncUi() {
  for (const f of uiSync) f();
  $('preset-name').textContent = state.presetName;
  $('quality').value = state.quality;
  $('cam-hint').textContent = state.mode === 'game' ? 'Replika Core3D: BG persp (ring) → Ziemia ortho → świat ortho → FG (K-7)'
    : state.mode === 'flight' ? 'Port Ziemi (K-7 i zatoki) · W/S/A/D, Spacja, Shift, E dokowanie, V kadłub, L wyjście' : 'Jedno słońce dla planety i ringu';
}
uiSync.push(bindRange('sun-az', () => state.sun.azimuth, (v) => { state.sun.azimuth = v; applySun(); }, (v) => `${v.toFixed(1)}°`));
uiSync.push(bindRange('sun-el', () => state.sun.elevation, (v) => { state.sun.elevation = v; applySun(); }, (v) => `${v.toFixed(1)}°`));
uiSync.push(bindRange('sun-speed', () => state.sun.speed, (v) => { state.sun.speed = v; }, (v) => `${v.toFixed(1)}°/s`));
$('sun-anim').addEventListener('change', (e) => { state.sun.animate = e.target.checked; });
uiSync.push(bindRange('g-w', () => state.geometry.width, (v) => { state.geometry.width = v; }, (v) => `${v.toFixed(0)}`));
uiSync.push(bindRange('g-wall', () => state.geometry.wallHeight, (v) => { state.geometry.wallHeight = v; }, (v) => `${v.toFixed(0)}`));
uiSync.push(bindRange('g-tilt', () => state.geometry.floorTiltDeg, (v) => { state.geometry.floorTiltDeg = v; }, (v) => `${v.toFixed(1)}°`));
uiSync.push(bindRange('g-sec', () => state.geometry.sectorCount, (v) => { state.geometry.sectorCount = v; }, (v) => `${v.toFixed(0)}`));
uiSync.push(bindRange('exposure', () => state.exposure, (v) => { state.exposure = v; post.state.exposure = v; }, (v) => v.toFixed(2)));
post.state.exposure = state.exposure;
$('g-seed').value = state.seed;
$('g-facing').value = state.geometry.habitatFacing;
$('rebuild').addEventListener('click', () => {
  state.seed = Number($('g-seed').value) || 1337;
  const facingChanged = $('g-facing').value !== state.geometry.habitatFacing;
  state.geometry.habitatFacing = $('g-facing').value;
  ring.rebuild({ seed: state.seed, ...state.geometry });
  applySun();
  if (facingChanged) {
    buildPresetButtons();
    applyPreset(state.presetIndex);
  }
});
$('quality').addEventListener('change', (e) => {
  state.quality = e.target.value;
  ring.setQuality(state.quality);
  applyQuality();
});
$('cam-game').addEventListener('click', () => { tour.active = false; setMode('game'); syncUi(); });
$('cam-cine').addEventListener('click', () => { setMode('cine'); syncUi(); });
$('cam-flight').addEventListener('click', () => { tour.active = false; if (k7Flight) k7Flight.camInit = false; setMode('flight'); syncUi(); });
function buildPresetButtons() {
  const box = $('presets');
  box.textContent = '';
  presetList().forEach((p, i) => {
    const b = document.createElement('button');
    b.textContent = p.key;
    b.title = p.name;
    b.addEventListener('click', () => { tour.active = false; applyPreset(i); });
    box.appendChild(b);
  });
  const tourBtn = document.createElement('button');
  tourBtn.textContent = 'C · wycieczka';
  tourBtn.addEventListener('click', startTour);
  box.appendChild(tourBtn);
}
buildPresetButtons();

const LAYER_DEFS = [
  ['clouds', 'chmury', true], ['atmosphere', 'atmosfera', true], ['cityLights', 'światła miast', true],
  ['ships', 'statki', true], ['city', 'budynki i drzewa', true],
  ['mega', 'megastruktura', true], ['bloom', 'bloom', true]
];
for (const [key, label, enabled] of LAYER_DEFS) {
  const l = document.createElement('label');
  if (!enabled) l.classList.add('off');
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = state.layers[key];
  c.disabled = !enabled;
  c.addEventListener('change', () => { state.layers[key] = c.checked; applyLayers(); });
  l.append(c, label);
  $('layers').appendChild(l);
}
function applyLayers() {
  const u = ring.uniforms;
  u.uLayers.value.x = state.layers.clouds ? 1 : 0;
  u.uLayers.value.y = state.layers.cityLights ? 1 : 0;
  u.uAirOn.value = state.layers.atmosphere ? 1 : 0;
  ring.setVisible('clouds', state.layers.clouds);
  ring.setVisible('shell', state.layers.atmosphere);
  ring.setVisible('mega', state.layers.mega);
  ring.setVisible('city', state.layers.city);
  post.state.bloomOn = state.layers.bloom;
}
applyLayers();

// ---------------------------------------------------------------------------
// Pomiar HDR (brief §9): scena do RT Float, histogram luminancji, NaN/Inf.
function measureHDR(width = 640) {
  const height = Math.max(1, Math.round(width * viewH / viewW));
  const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, depthBuffer: true });
  const prevW = viewW;
  const prevH = viewH;
  renderScene(rt);
  const px = new Float32Array(width * height * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, width, height, px);
  rt.dispose();
  renderer.setRenderTarget(null);
  void prevW; void prevH;
  const lum = [];
  let nan = 0;
  let over = 0;
  let max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]; const g = px[i + 1]; const b = px[i + 2];
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) { nan++; continue; }
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum.push(l);
    if (l > 0.9) over++;
    if (l > max) max = l;
  }
  lum.sort((a, b) => a - b);
  const pct = (p) => lum[Math.min(lum.length - 1, Math.floor(lum.length * p))] || 0;
  const bins = [0.05, 0.2, 0.5, 0.85, 0.9, 1.3, 2, 5, 12, Infinity];
  const hist = bins.map(() => 0);
  for (const l of lum) { for (let k = 0; k < bins.length; k++) if (l <= bins[k]) { hist[k]++; break; } }
  return {
    pixels: lum.length, nanOrInf: nan, overBloomThreshold: over, overFraction: over / Math.max(1, lum.length),
    p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), p999: pct(0.999), max,
    histogram: Object.fromEntries(bins.map((b, k) => [`<=${b}`, hist[k]]))
  };
}

// ---------------------------------------------------------------------------
// API do automatycznych zrzutów (scripts/halo-ring-shots.mjs)
window.__halo = {
  ring,
  get state() { return state; },
  applyPreset(n) { return applyPreset(n - 1); },
  setGame(x, y, zoom) { setMode('game'); Object.assign(gameCam, { x, y, zoom }); },
  setSun(az, el) { state.sun.azimuth = az; state.sun.elevation = el; applySun(); },
  renderFrames(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) {
      renderer.info.reset();
      prepareFrame(dt);
      renderScene(null);
      lastStats.calls = renderer.info.render.calls;
      lastStats.triangles = renderer.info.render.triangles;
      post.finish(dt);
    }
    return { ...lastStats };
  },
  bench(n = 30) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      prepareFrame(1 / 60);
      renderScene(null);
      post.finish(1 / 60);
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return (performance.now() - t0) / n;
  },
  measureHDR,
  // dowolne ujęcie kinowe (skrypty zrzutów i strojenie presetów)
  setCine(cfg) {
    setMode('cine');
    if (cfg.sun) { state.sun.azimuth = cfg.sun.azimuth; state.sun.elevation = cfg.sun.elevation; applySun(); }
    cine.pos.copy(cfg.pos);
    cine.fwd.copy(cfg.fwd).normalize();
    cine.up.copy(cfg.up).normalize();
    if (cfg.fov) cine.fov = cfg.fov;
    syncUi();
  },
  helpers: { frameAt, floorPoint, dirAt, habitatUp, sectorCenter, findPeak, v3: (x, y, z) => new THREE.Vector3(x, y, z), DEG },
  // megabudowla i (opts: mode 'cine' | 'game', night, zoom) → opis i ujęcie
  landmark(i = 0, opts = {}) {
    landmarkIndex = i;
    return applyLandmark(i, opts);
  },
  get landmarks() {
    return (ring.landmarks || []).map((lm) => ({ name: lm.name, sector: lm.sectorName, kind: lm.kind, theta: lm.theta, t: lm.t, z: lm.z, plazaH: lm.plazaH, h: lm.h, pond: !!lm.pond }));
  },
  // kopuła i (opts jak landmark) → opis i ujęcie
  dome(i = 0, opts = {}) {
    domeIndex = i;
    return applyDome(i, opts);
  },
  get domes() {
    return (ring.domes || []).map((dm) => ({ name: dm.name, type: dm.type, sector: dm.sectorName, theta: dm.theta, s: dm.s, t: dm.t, z: dm.z, floorH: dm.floorH, r: dm.r, h: dm.h }));
  },
  // Lot K-7 do zrzutów i testów: stan startowy, sekwencje, pozycja statku
  flight: {
    get game() { return k7Flight; },
    start(mode = 'docked', zoom = 1) {
      ensureK7Flight();
      k7Flight.reset(mode);
      setMode('flight');
      gameCam.zoom = zoom;
      syncUi();
      return k7Flight.docking.state;
    },
    setPose(x, z, angle) {
      const p = k7Flight.player;
      p.x = x; p.z = z; p.angle = angle; p.vx = p.vz = p.angVel = 0;
      k7Flight.camInit = false;
    },
    action() { return k7Flight.action(); },
    transit() { return k7Flight.jumpToTransit(); },
    // kadłub gracza ('atlas', 'megafreighter', 'heavy_freighter', 'long_haul_freighter',
    // 'container_ship', 'inter_station_shuttle'), stan startowy 'docked' | 'free'
    hull(id, mode = 'docked') { const r = k7Flight.setHull(id, mode); k7Flight.camInit = false; return r; },
    // przed stanowisko (etykieta: 'Z02-M02', 'C-03', 'K7-2 C-01') / na pole STOP
    berth(label) { return k7Flight.jumpToBerth(label); },
    place(label) { return k7Flight.placeOnBerth(label); },
    get berthState() {
      const d = k7Flight.docking;
      return { state: d.state, berth: d.entry?.label ?? null, detail: d.detail, candidate: d.state === 'FREE' ? d.candidate()?.entry.label ?? null : null };
    },
    // symulacja t sekund (stały krok) bez renderu
    simulate(seconds, input = null) {
      const n = Math.round(seconds * 120);
      const keysSim = new Set(input || []);
      for (let i = 0; i < n; i++) k7Flight.update(1 / 120, keysSim);
      k7Flight.camInit = false;
      return { state: k7Flight.docking.state, x: k7Flight.player.x, z: k7Flight.player.z, locked: k7Flight.player.locked, roof: k7Flight.roof.fade, hits: k7Flight.collision.hits };
    }
  },
  stats() {
    return { ...lastStats, ...ring.stats, near: cineCam.near, far: cineCam.far, mode: state.mode, preset: state.presetName, errors: shaderErrors.slice() };
  },
  get errors() { return shaderErrors.slice(); },
  waitMaps() {
    return new Promise((resolve) => {
      const tick = () => {
        if (ring.mapsReady) resolve(true);
        else { ring.update(1 / 60, { camera: state.mode === 'game' ? camPersp : cineCam }); setTimeout(tick, 0); }
      };
      tick();
    });
  }
};

// ---------------------------------------------------------------------------
// Start
ensureK7Flight();
const startPreset = Math.max(1, Math.min(presetList().length, Number(params.get('preset')) || 8));
applyPreset(startPreset - 1);
if (params.get('cam') === 'flight' && k7Flight) {
  if (params.has('hull')) k7Flight.hullId = params.get('hull') in { atlas: 1, megafreighter: 1, heavy_freighter: 1, long_haul_freighter: 1, container_ship: 1, inter_station_shuttle: 1 } ? params.get('hull') : 'atlas';
  k7Flight.reset(params.get('k7') === 'free' || params.get('k7') === 'transit' ? 'free' : 'docked');
  if (params.has('berth')) k7Flight.jumpToBerth(params.get('berth'));
  if (params.get('k7') === 'transit') k7Flight.jumpToTransit();
  setMode('flight');
  if (params.has('zoom')) gameCam.zoom = Number(params.get('zoom'));
}
if (params.get('cam') === 'game') {
  setMode('game');
  if (params.has('zoom')) gameCam.zoom = Number(params.get('zoom'));
  if (params.has('x')) gameCam.x = Number(params.get('x'));
  if (params.has('y')) gameCam.y = Number(params.get('y'));
}
// ?landmark=i (&cam=game&zoom=…, &night=1): megabudowla do zrzutów
if (params.has('landmark')) {
  landmarkIndex = Number(params.get('landmark')) || 0;
  applyLandmark(landmarkIndex, {
    mode: params.get('cam') === 'game' ? 'game' : 'cine',
    night: params.get('night') === '1',
    zoom: params.has('zoom') ? Number(params.get('zoom')) : 0.45
  });
}
// ?dome=i (&cam=game&zoom=…, &night=1): kopuła do zrzutów
if (params.has('dome')) {
  domeIndex = Number(params.get('dome')) || 0;
  applyDome(domeIndex, {
    mode: params.get('cam') === 'game' ? 'game' : 'cine',
    night: params.get('night') === '1',
    zoom: params.has('zoom') ? Number(params.get('zoom')) : 0.45
  });
}
if (params.has('az')) state.sun.azimuth = Number(params.get('az'));
if (params.has('el')) state.sun.elevation = Number(params.get('el'));
applySun();
syncUi();
if (shotMode) {
  window.__halo.ready = false;
  window.__halo.waitMaps().then(() => {
    window.__halo.renderFrames(3);
    window.__halo.ready = true;
  });
} else {
  requestAnimationFrame(frame);
}
