// ============================================================
// Demo WebGPU: okręty 3D (Atlas, flota Terra Nova i piratów) i modele 3D broni
// (strona dema/atlas3d-webgpu.html, Vite).
//
// Modele: src/3d/ships3d/ (ships3D — rejestr, atlasHull3D / fleetHull3D — kadłuby ze sprite'ów
// gry, weapons3D — 23 rodziny broni, shipMaterials3D.tsl — materiały TSL). Tu: scena, światło
// i cienie, post jak w grze (pass MSAA 4 → siatka HDR → bloom gry → ACES gry → sRGB), tryby
// (flota, oględziny, lot, galeria), wybór okrętu, kamery, sterowanie, ogień, cele i eksport GLB.
// Układ jak Core3D: X ku dziobowi, Y = −y gry, Z w górę.
// ============================================================
import * as THREE from 'three/webgpu';
import { max, nodeObject, pass, uniform, vec3, vec4 } from 'three/tsl';
import { BloomGry, hdrBezpieczny } from '../src/3d/tsl/postGry.js';
import { acesGry, linearDoSrgb } from '../src/3d/tsl/kolorGry.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { WEAPON3D_FAMILY } from '../src/3d/ships3d/weapons/weapons3D.js';
import { SHIP3D_MODELS, SHIP3D_IDS } from '../src/3d/ships3d/ships/ships3D.js';
import { createShipMaterial } from '../src/3d/ships3d/shipMaterials3D.tsl.js';
import { FLEET3D_WEAPON_PALETTES } from '../src/3d/ships3d/ships/fleetHulls3D.js';
import { Ship3D, defaultLoadout, fullLoadout } from './atlas3d-webgpu/statek.js';
import { createSky } from './atlas3d-webgpu/niebo.js';
import { Effects } from './atlas3d-webgpu/efekty.js';
import { Targets } from './atlas3d-webgpu/cele.js';
import { Flight, CameraRig } from './atlas3d-webgpu/lot.js';
import { WeaponGallery } from './atlas3d-webgpu/galeria.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const errEl = $('err');
function showError(text) {
  errEl.style.display = 'block';
  errEl.textContent += `${text}\n`;
  console.error(text);
}
window.addEventListener('error', (e) => showError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => showError(`Promise: ${e.reason?.stack || e.reason}`));

function noWebGPU(detail) {
  $('nogpu').style.display = 'flex';
  $('nogpu-detail').textContent = detail || '';
  $('backend').textContent = 'WebGPU niedostępne';
  $('loading').style.display = 'none';
  window.__demo = { ready: false, error: 'webgpu', detail };
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`nie wczytano ${url}`));
    img.src = url;
  });
}

const GROUP_LABEL = { main: 'główne', special: 'specjalne', aux: 'aux / PD', missile: 'rakietowe', special_missile: 'Supernova' };

// Sprite okrętu: ścieżka z rejestru (serwer Vite podaje katalog repo).
const spriteUrl = (id) => `/${SHIP3D_MODELS[id].sprite}`;

// Tryb „Flota” i przyciski: Atlas + Terra Nova + piraci. Reszta kadłubów (lotniskowce,
// superkapitały, myśliwiec, megafrachtowiec, ruch v2 — modele z automatu) w liście rozwijanej,
// budowana dopiero przy wyborze.
const FLEET_IDS = ['atlas', 'terran_battleship', 'terran_destroyer', 'terran_frigate', 'pirate_battleship', 'pirate_destroyer', 'pirate_frigate'];
const MORE_GROUPS = [
  ['okręty bojowe', ['terran_carrier', 'terran_supercapital', 'supercapital', 'capital_carrier', 'corvus', 'fighter']],
  ['megafrachtowiec', ['megafreighter_front', 'megafreighter_wagon', 'megafreighter_back', 'megafreighter']],
  ['ruch v2', null]
];

// Tryb „Flota”: Atlas w środku, Terra Nova po jednej stronie, piraci po drugiej (x, y świata).
const FLEET_POS = {
  atlas: [0, 0],
  terran_battleship: [620, 780], terran_destroyer: [-40, 780], terran_frigate: [-500, 780],
  pirate_battleship: [620, -780], pirate_destroyer: [-40, -780], pirate_frigate: [-500, -780]
};
const FLEET_CENTER = new THREE.Vector3(60, 0, 0);

async function main() {
  if (!('gpu' in navigator)) { noWebGPU('navigator.gpu nie istnieje.'); return; }
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) { noWebGPU('Brak adaptera WebGPU (requestAdapter zwrócił null).'); return; }

  // ---------------------------------------------------------------------------
  // Renderer, scena, światło

  const renderer = new THREE.WebGPURenderer({ antialias: false, trackTimestamp: true, powerPreference: 'high-performance' });
  const DPR = Number(params.get('dpr')) || Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(DPR);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (renderer.backend.isWebGPUBackend !== true) {
    noWebGPU('WebGPURenderer przełączył się na WebGL2 — demo wymaga WebGPU.');
    return;
  }
  const device = renderer.backend.device;
  device.addEventListener('uncapturederror', (e) => showError(`WebGPU: ${e.error?.message || e.error}`));
  const timestamps = renderer.backend.trackTimestamp === true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 5, 80000);
  camera.up.set(0, 0, 1);
  const sky = createSky(renderer, scene);

  const SH = Number(params.get('cienie')) || (TEST ? 2048 : 4096);
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SH, SH);
  const sc = sun.shadow.camera;
  sc.left = -1150; sc.right = 1150; sc.top = 1150; sc.bottom = -1150; sc.near = 50; sc.far = 8000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.8;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x5b6d92, 0x0b0c11, 0.7);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);
  // Światło wypełniające od spodu i z boku (odbicie planety / mgławicy) — bez cienia; czytelny kil z profilu.
  const fill = new THREE.DirectionalLight(0x7088b8, 0.9);
  scene.add(fill, fill.target);

  // ---------------------------------------------------------------------------
  // Atlas, cele, efekty, galeria

  $('loading').textContent = 'wczytywanie sprite\'ów okrętów…';
  const startId = SHIP3D_MODELS[params.get('statek')] ? params.get('statek') : 'atlas';
  const images = {};
  await Promise.all([...new Set([...FLEET_IDS, startId])].map(async (id) => { images[id] = await loadImage(spriteUrl(id)); }));
  $('loading').textContent = 'budowa modeli 3D…';
  const weaponMat = createShipMaterial({ panelW: 7, panelH: 3.5, name: 'okręty 3D — broń' });
  const weaponMatPirate = createShipMaterial({ panelW: 7, panelH: 3.5, palette: FLEET3D_WEAPON_PALETTES.pirate, name: 'okręty 3D — broń piratów' });
  const ships = {};
  let uiReady = false;
  function createShip(id) {
    const wm = SHIP3D_MODELS[id].faction === 'pirate' ? weaponMatPirate : weaponMat;
    const s = new Ship3D({ id, image: images[id], scene, anisotropy: 8, weaponMat: wm });
    s.root.visible = false;
    ships[id] = s;
    if (uiReady) {
      applyShipToggles(s);
      s.setLoadout(S.loadoutName === 'pelny' ? fullLoadout(s.hull.mounts, s.faction) : defaultLoadout(s.hull.mounts, s.faction, s.id));
    }
    return s;
  }
  /** Okręt z rejestru — model budowany przy pierwszym wyborze (sprite wczytywany w tle). */
  async function ensureShip(id) {
    if (ships[id]) return ships[id];
    $('loading').style.display = 'block';
    $('loading').textContent = `budowa modelu: ${SHIP3D_MODELS[id].label}…`;
    try {
      if (!images[id]) images[id] = await loadImage(spriteUrl(id));
      return ships[id] || createShip(id);
    } finally {
      $('loading').style.display = 'none';
    }
  }
  for (const id of Object.keys(images)) createShip(id);
  let ship = ships[startId];
  const fx = new Effects(scene);
  const targets = new Targets(scene, { seed: 11 });
  targets.spawnDrones(8, weaponMat);
  const gallery = new WeaponGallery(scene, ship, weaponMat, { y: -9000 });
  const flight = new Flight(ship.id);
  const rig = new CameraRig(camera);

  // Post: pass (MSAA 4, HalfFloat) → siatka HDR → bloom gry → ACES gry → sRGB (jak Core3D i dema).
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera, { samples: 4 });
  const sceneColor = hdrBezpieczny(scenePass.getTextureNode('output'));
  const bloomGry = new BloomGry(sceneColor, BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold);
  const bloomNode = nodeObject(bloomGry);
  const uBloomOn = uniform(1);
  const uExposure = uniform(1);
  const lin = sceneColor.rgb.add(bloomNode.rgb.mul(uBloomOn));
  pipeline.outputNode = vec4(linearDoSrgb(acesGry(max(lin, vec3(0.0)).mul(uExposure))), 1.0);
  pipeline.outputColorTransform = false;

  // ---------------------------------------------------------------------------
  // Stan

  const S = {
    mode: '', paused: false, speed: 1, frames: 0, fps: 60, cpuMs: 0, gpuMs: 0,
    keys: new Set(), mouse: { nx: 0, ny: 0, px: innerWidth / 2, py: innerHeight / 2, lmb: false, rmb: false, drag: null, over: false },
    lock: null, aim: new THREE.Vector3(1000, 0, 0), kills: 0, hits: 0,
    banking: true, pd: true, drones: true, fast: false,
    hexCd: 0, hexBurst: 0, hexT: 0,
    loadoutName: 'gra'
  };
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const _sphere = new THREE.Sphere();

  // ---------------------------------------------------------------------------
  // Uzbrojenie (panel grup: jedna broń na grupę gniazd; fity: gra / pełny)

  const groupsEl = $('groups');
  const selects = {};
  function buildGroups() {
  groupsEl.textContent = '';
  for (const k of Object.keys(selects)) delete selects[k];
  const mountTypes = [...new Set(ship.hull.mounts.map((m) => m.type))].filter((t) => GROUP_LABEL[t]);
  for (const type of mountTypes) {
    const row = document.createElement('div');
    row.className = 'sel';
    const n = ship.hull.mounts.filter((m) => m.type === type).length;
    row.innerHTML = `<span>${GROUP_LABEL[type]} ×${n}</span>`;
    const sel = document.createElement('select');
    const opts = Object.values(MASTER_WEAPONS).filter((w) => w.mountType === type && WEAPON3D_FAMILY[w.id]);
    sel.innerHTML = '<option value="">— bez zmian (fit) —</option><option value="-">— puste —</option>' +
      opts.map((w) => `<option value="${w.id}">${w.name} (${w.size})</option>`).join('');
    sel.addEventListener('change', () => {
      const map = { ...ship.loadout };
      for (const m of ship.hull.mounts) {
        if (m.type !== type || !sel.value) continue;
        if (sel.value === '-') delete map[m.id];
        else map[m.id] = sel.value;
      }
      ship.setLoadout(map);
      updateLoadoutInfo();
    });
    row.appendChild(sel);
    groupsEl.appendChild(row);
    selects[type] = sel;
  }
  }
  function setLoadoutPreset(name) {
    S.loadoutName = name;
    const list = S.mode === 'flota' ? FLEET_IDS.map((id) => ships[id]) : [ship];
    for (const s of list) s.setLoadout(name === 'pelny' ? fullLoadout(s.hull.mounts, s.faction) : defaultLoadout(s.hull.mounts, s.faction, s.id));
    for (const s of Object.values(selects)) s.value = '';
    $('fit-gra').classList.toggle('on', name !== 'pelny');
    $('fit-pelny').classList.toggle('on', name === 'pelny');
    updateLoadoutInfo();
  }
  let loadoutInfo = '';
  function updateLoadoutInfo() {
    const count = {};
    for (const t of ship.turrets) count[t.weaponId] = (count[t.weaponId] || 0) + 1;
    loadoutInfo = Object.entries(count).map(([id, n]) => `${n}× ${MASTER_WEAPONS[id]?.name || id}`).join('\n');
  }
  $('fit-gra').addEventListener('click', () => setLoadoutPreset('gra'));
  $('fit-pelny').addEventListener('click', () => setLoadoutPreset('pelny'));
  buildGroups();
  S.loadoutName = params.get('fit') === 'pelny' ? 'pelny' : 'gra';
  for (const s of Object.values(ships)) s.setLoadout(S.loadoutName === 'pelny' ? fullLoadout(s.hull.mounts, s.faction) : defaultLoadout(s.hull.mounts, s.faction, s.id));
  setLoadoutPreset(S.loadoutName);

  // ---------------------------------------------------------------------------
  // Wybór okrętu (przyciski na górze panelu, [ / ] — poprzedni / następny)

  const shipBtns = {};
  for (const id of FLEET_IDS) {
    const b = document.createElement('button');
    b.textContent = SHIP3D_MODELS[id].short;
    b.title = SHIP3D_MODELS[id].label;
    b.className = `f-${SHIP3D_MODELS[id].faction}`;
    b.addEventListener('click', () => selectShip(id));
    $('shipsel').appendChild(b);
    shipBtns[id] = b;
  }
  // Pozostałe kadłuby: lista rozwijana w grupach (ruch v2 — wszystko, czego nie ma wyżej).
  const moreSel = $('shipsel-more');
  {
    const listed = new Set([...FLEET_IDS, ...MORE_GROUPS.flatMap(([, ids]) => ids || [])]);
    let html = '<option value="">— inne kadłuby (model z automatu) —</option>';
    for (const [label, ids] of MORE_GROUPS) {
      const list = (ids || SHIP3D_IDS.filter((id) => !listed.has(id))).filter((id) => SHIP3D_MODELS[id]);
      html += `<optgroup label="${label}">${list.map((id) => `<option value="${id}">${SHIP3D_MODELS[id].label}</option>`).join('')}</optgroup>`;
    }
    moreSel.innerHTML = html;
    moreSel.addEventListener('change', () => { if (moreSel.value) selectShip(moreSel.value); });
  }
  async function selectShip(id, keepMode = false) {
    if (!SHIP3D_MODELS[id]) return;
    const s = await ensureShip(id);
    ship = s;
    flight.setSpec(id);
    buildGroups();
    updateLoadoutInfo();
    for (const [k, b] of Object.entries(shipBtns)) b.classList.toggle('on', k === id);
    moreSel.value = shipBtns[id] ? '' : id;
    $('ship-name').textContent = ship.label;
    if (!keepMode) setMode(S.mode === 'flota' || S.mode === 'galeria' || !S.mode ? 'ogledziny' : S.mode);
  }
  function cycleShip(d) {
    const i = SHIP3D_IDS.indexOf(ship.id);
    selectShip(SHIP3D_IDS[(i + d + SHIP3D_IDS.length) % SHIP3D_IDS.length]);
  }

  // ---------------------------------------------------------------------------
  // Tryby i kamery

  function setMode(m) {
    if (!['flota', 'ogledziny', 'lot', 'galeria'].includes(m)) m = 'flota';
    S.mode = m;
    for (const b of document.querySelectorAll('#modes button')) b.classList.toggle('on', b.dataset.m === m);
    const gal = m === 'galeria';
    const fleet = m === 'flota';
    gallery.visible = gal;
    for (const s of Object.values(ships)) {
      const inFleet = !!FLEET_POS[s.id];
      s.root.visible = fleet ? inFleet : (!gal && s === ship);
      if (fleet && inFleet) { const [x, y] = FLEET_POS[s.id]; s.root.position.set(x, y, 0); s.root.rotation.set(0, 0, 0); s.root.updateMatrixWorld(true); }
    }
    targets.group.visible = !gal && !fleet;
    for (const d of targets.drones) d.mesh.visible = !fleet && S.drones && d.alive;
    $('labels').style.display = gal || fleet ? 'block' : 'none';
    for (const el of labelEls) el.style.display = gal ? 'block' : 'none';
    for (const el of Object.values(fleetLabelEls)) el.style.display = fleet ? 'block' : 'none';
    fx.clear();
    flight.pos.set(0, 0, 0); flight.vel.set(0, 0, 0); flight.heading = 0; flight.yawVel = 0; flight.bank = 0;
    const L = ship.length;
    if (m === 'ogledziny') {
      setCamera('orbita'); rig.az = -128; rig.el = 24; rig.dist = L * 1.45 + 60; rig.pan.set(0, 0, 0);
    } else if (m === 'lot') {
      setCamera(params.get('kamera') || 'taktyczna'); rig.dist = L * 2 + 150; rig.az = 0; rig.pan.set(0, 0, 0);
    } else if (fleet) {
      setCamera('orbita'); rig.az = -118; rig.el = 34; rig.dist = 3300; rig.pan.copy(FLEET_CENTER);
    } else {
      setCamera('orbita'); rig.az = -62; rig.el = 34; rig.dist = 1700; rig.pan.set(0, 0, 0);
    }
    updateShadowCamera();
  }
  // Kamera cienia słońca: cały kadr floty albo okręt z zapasem.
  function updateShadowCamera() {
    const e = S.mode === 'flota' ? 1550 : S.mode === 'galeria' ? 1150 : Math.max(220, ship.length * 0.64);
    sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e;
    sc.updateProjectionMatrix();
  }
  function setCamera(c) {
    rig.setMode(c);
    for (const b of document.querySelectorAll('#cams button')) b.classList.toggle('on', b.dataset.c === c);
  }
  for (const b of document.querySelectorAll('#modes button')) b.addEventListener('click', () => setMode(b.dataset.m));
  for (const b of document.querySelectorAll('#cams button')) b.addEventListener('click', () => setCamera(b.dataset.c));

  // ---------------------------------------------------------------------------
  // Panel: przełączniki i suwaki

  const W = weaponMat.userData.uniforms;
  const bind = (id, fn) => { const el = $(id); el.addEventListener('change', () => fn(el.checked)); fn(el.checked); };
  const allShips = (fn) => { for (const s of Object.values(ships)) fn(s); };
  const hullU = (fn) => allShips((s) => fn(s.hullMat.userData.uniforms));
  // Okręt zbudowany później dostaje bieżący stan przełączników panelu.
  function applyShipToggles(s) {
    const U = s.hullMat.userData.uniforms;
    U.deck.value = $('c-deck').checked ? 1 : 0;
    U.bump.value = $('c-bump').checked ? 0.55 : 0;
    U.seams.value = $('c-seams').checked ? 1 : 0;
    s.setTurretsVisible($('c-turrets').checked);
    s.markers.visible = $('c-markers').checked;
    s.setSpriteMode($('c-sprite').checked);
    s.setTurretScale(Number($('s-tscale').value) || 1);
  }
  bind('c-deck', (on) => { hullU((U) => { U.deck.value = on ? 1 : 0; }); });
  bind('c-bump', (on) => { hullU((U) => { U.bump.value = on ? 0.55 : 0; }); });
  bind('c-seams', (on) => { hullU((U) => { U.seams.value = on ? 1 : 0; }); W.seams.value = on ? 1 : 0; weaponMatPirate.userData.uniforms.seams.value = on ? 1 : 0; });
  bind('c-turrets', (on) => { allShips((s) => s.setTurretsVisible(on)); });
  bind('c-markers', (on) => { allShips((s) => { s.markers.visible = on; }); });
  bind('c-shadows', (on) => { sun.castShadow = on; });
  bind('c-bloom', (on) => { uBloomOn.value = on ? 1 : 0; });
  bind('c-bank', (on) => { S.banking = on; });
  bind('c-follow', (on) => { rig.followHeading = on; });
  bind('c-fast', (on) => { flight.speedMul = on ? 3 : 1; S.fast = on; });
  bind('c-pd', (on) => { S.pd = on; });
  bind('c-drones', (on) => { S.drones = on; for (const d of targets.drones) { d.mesh.visible = on && d.alive; } });
  bind('c-gscale', (on) => { gallery.setGameScale(on); });
  bind('c-sprite', (on) => { allShips((s) => s.setSpriteMode(on)); });
  const sOpts = { plumes: true, lights: true };
  bind('c-plumes', (on) => { sOpts.plumes = on; });
  bind('c-lights', (on) => { sOpts.lights = on; });
  const slider = (id, out, fn, fmt = (v) => v) => {
    const el = $(id); const o = $(out);
    const f = () => { const v = Number(el.value); o.textContent = fmt(v); fn(v); };
    el.addEventListener('input', f); f();
  };
  let sunAz = 131; let sunEl = 34;
  let envDirty = true;
  const sunDir = new THREE.Vector3();
  const updateSun = () => {
    sunDir.set(Math.cos(sunAz * DEG) * Math.cos(sunEl * DEG), Math.sin(sunAz * DEG) * Math.cos(sunEl * DEG), Math.sin(sunEl * DEG));
    sky.u.sunDir.value.copy(sunDir);
  };
  slider('s-tilt', 'o-tilt', (v) => { rig.tilt = v; });
  slider('s-tscale', 'o-tscale', (v) => { allShips((s) => s.setTurretScale(v)); }, (v) => `×${v.toFixed(2)}`);
  slider('s-sun', 'o-sun', (v) => { sunAz = v; updateSun(); envDirty = true; });
  slider('s-elev', 'o-elev', (v) => { sunEl = v; updateSun(); envDirty = true; });
  slider('s-exp', 'o-exp', (v) => { uExposure.value = v; }, (v) => v.toFixed(2));
  uiReady = true;
  $('b-pause').addEventListener('click', () => { S.paused = !S.paused; });
  $('b-glb').addEventListener('click', () => exportGLB().catch((e) => showError(`GLB: ${e?.stack || e}`)));

  // ---------------------------------------------------------------------------
  // Wejście

  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => {
    const m = S.mouse;
    m.px = e.clientX; m.py = e.clientY;
    m.nx = (e.clientX / innerWidth) * 2 - 1;
    m.ny = -(e.clientY / innerHeight) * 2 + 1;
    m.over = true;
    if (m.drag) {
      const dx = e.clientX - m.drag.x; const dy = e.clientY - m.drag.y;
      m.drag.x = e.clientX; m.drag.y = e.clientY;
      if (m.drag.pan) {
        // Przesuw w płaszczyźnie XY względem azymutu orbity: prawo ekranu = (−sin a, cos a),
        // góra ekranu (w głąb) = (−cos a, −sin a).
        const k = (rig.dist / innerHeight) * 1.1;
        const a = rig.az * DEG;
        rig.pan.x += (Math.sin(a) * dx - Math.cos(a) * dy) * k;
        rig.pan.y += (-Math.cos(a) * dx - Math.sin(a) * dy) * k;
      } else if (rig.mode === 'taktyczna') {
        rig.az -= dx * 0.25; rig.tilt = clamp(rig.tilt + dy * 0.2, 0, 85);
        $('s-tilt').value = Math.round(rig.tilt); $('o-tilt').textContent = Math.round(rig.tilt);
      } else {
        rig.az -= dx * 0.3; rig.el = clamp(rig.el + dy * 0.25, -80, 85);
        if (rig.mode !== 'orbita' && rig.mode !== 'taktyczna') setCamera('orbita');
      }
    }
  });
  canvas.addEventListener('pointerleave', () => { S.mouse.over = false; });
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const m = S.mouse;
    m.down = { x: e.clientX, y: e.clientY };
    const flying = S.mode === 'lot';
    const orbitDrag = !flying || e.altKey || e.button === 1;
    if (e.button === 0 && orbitDrag) m.drag = { x: e.clientX, y: e.clientY, pan: false };
    else if (e.button === 2 && !flying) m.drag = { x: e.clientX, y: e.clientY, pan: true };
    else if (e.button === 1) m.drag = { x: e.clientX, y: e.clientY, pan: false };
    else if (e.button === 0) m.lmb = true;
    else if (e.button === 2) m.rmb = true;
  });
  canvas.addEventListener('pointerup', (e) => {
    const m = S.mouse;
    // Klik (bez przeciągania) w trybie floty: wybór okrętu pod kursorem → oględziny.
    if (e.button === 0 && S.mode === 'flota' && m.down && Math.hypot(e.clientX - m.down.x, e.clientY - m.down.y) < 5) {
      const id = pickFleetShip(e.clientX, e.clientY);
      if (id) selectShip(id);
    }
    if (e.button === 0) m.lmb = false;
    if (e.button === 2) m.rmb = false;
    m.drag = null;
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); rig.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
    const k = e.key.toLowerCase();
    S.keys.add(k);
    if (k === 'h') { $('panel').classList.toggle('hidden'); $('hud').classList.toggle('hidden'); }
    else if (k === 'p') S.paused = !S.paused;
    else if (k === 'o') setMode('ogledziny');
    else if (k === 'v') setMode('flota');
    else if (k === '[') cycleShip(-1);
    else if (k === ']') cycleShip(1);
    else if (k === 'l') setMode('lot');
    else if (k === 'g') setMode('galeria');
    else if (k === 't') { const el = $('c-pd'); el.checked = !el.checked; el.dispatchEvent(new Event('change')); }
    else if (k === 'x') fireHexlance();
    else if (['1', '2', '3', '4', '5'].includes(k)) setCamera(['gra', 'taktyczna', 'poscig', 'orbita', 'kinowa'][Number(k) - 1]);
    if (k === ' ') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => { S.keys.clear(); S.mouse.lmb = S.mouse.rmb = false; });
  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  // ---------------------------------------------------------------------------
  // Celowanie i ogień

  function aimAt(out) {
    raycaster.setFromCamera({ x: S.mouse.nx, y: S.mouse.ny }, camera);
    const ray = raycaster.ray;
    S.lock = null;
    let best = Infinity;
    for (const t of targets.all) {
      if (!t.alive || !t.mesh.visible) continue;
      _sphere.set(t.pos, t.r * 1.3);
      if (!ray.intersectSphere(_sphere, _v2)) continue;
      const d = _v2.distanceTo(ray.origin);
      if (d < best) { best = d; S.lock = t; }
    }
    if (S.lock) return out.copy(S.lock.pos);
    plane.constant = -flight.pos.z;
    const hit = ray.intersectPlane(plane, out);
    if (hit && hit.distanceTo(camera.position) < 40000 && ray.direction.dot(_v2.copy(hit).sub(ray.origin)) > 0) return hit;
    return out.copy(ray.direction).multiplyScalar(6000).add(ray.origin);
  }

  const boltStyle = (def, turret) => {
    const cat = String(def?.category || '');
    const big = def?.size === 'Capital';
    return {
      color: def?.vfxColor || '#9fe8ff',
      speed: clamp(Number(def?.baseSpeed) || 3000, 1500, 9000),
      len: cat === 'ciws' ? 26 : cat === 'flak' ? 46 : big ? 150 : 90,
      width: cat === 'ciws' ? 2.2 : cat === 'flak' ? 7 : big ? 11 : 5,
      glow: cat === 'ciws' ? 4 : 6,
      life: clamp((Number(def?.baseRange) || 6000) / Math.max(1500, Number(def?.baseSpeed) || 3000), 0.3, 2.2),
      damage: Number(def?.baseDamage) || 5
    };
  };

  function shipVelocity() { return flight.vel; }

  function spawnFromTurret(pos, dir, turret) {
    const def = turret.def;
    if (turret.model.launcher) {
      const cat = String(def?.category);
      fx.flash(pos, '#ffcf9a', 14 * turret.scale, 0.18, 5);
      fx.shoot({
        pos, dir, speed: clamp(Number(def?.baseSpeed) || 1800, 900, 4000), color: def?.vfxColor || '#ffbb77',
        len: def?.id === 'supernova_missile' ? 60 : 30, width: def?.id === 'supernova_missile' ? 14 : 7,
        life: 7, damage: Number(def?.baseDamage) / 10 || 50, kind: 'missile', target: S.lock || targets.nearestDrone(S.aim, 3000),
        turn: cat === 'torpedo' ? 0.9 : 2.2, glow: 7, inherit: shipVelocity()
      });
      return;
    }
    const st = boltStyle(def, turret);
    fx.flash(pos, st.color, st.width * 1.8, 0.07, 7);
    fx.shoot({ pos, dir, speed: st.speed, color: st.color, len: st.len, width: st.width, life: st.life, damage: st.damage, kind: 'bolt', glow: st.glow, inherit: shipVelocity() });
  }

  function fireHexlance() {
    if (S.hexCd > 0 || S.mode === 'galeria' || S.mode === 'flota' || !ship.hull.hexlanceMuzzle) return false;
    S.hexCd = 6; S.hexBurst = 4; S.hexT = 0;
    return true;
  }

  function stepHexlance(dt) {
    S.hexCd = Math.max(0, S.hexCd - dt);
    if (S.hexBurst <= 0) return;
    S.hexT -= dt;
    if (S.hexT > 0) return;
    S.hexT = 0.25;
    S.hexBurst--;
    const p = ship.hexlanceMuzzle(_v);
    if (!p) { S.hexBurst = 0; return; }
    const dir = _v2.set(1, 0, 0).applyQuaternion(ship.root.quaternion);
    fx.flash(p, '#d0eaff', 60, 0.25, 9);
    fx.shoot({ pos: p, dir, speed: 12000, color: '#d0eaff', len: 900, width: 26, life: 1.6, damage: 2000, kind: 'lance', glow: 8, inherit: shipVelocity() });
  }

  // Trafienia: cele (kule, test odcinka prev → pos); ogień dronów w kadłub Atlasa.
  const _seg = new THREE.Line3();
  const _cp = new THREE.Vector3();
  const _inv = new THREE.Matrix4();
  function hitTest(b) {
    if (b.kind === 'enemy') {
      if (!ship.root.visible) return null;
      _v.copy(b.pos).applyMatrix4(_inv);
      if (Math.abs(_v.x) > ship.length * 0.6 || Math.abs(_v.y) > ship.width * 0.6) return null;
      if (!ship.hull.contains(_v.x, _v.y)) return null;
      const top = ship.hull.heightAt(_v.x, _v.y);
      if (_v.z > top + 2 || _v.z < ship.hull.bottomAt(_v.x, _v.y) - 2) return null;
      return ship;
    }
    _seg.set(b.prev, b.pos);
    for (const t of targets.all) {
      if (!t.alive || !t.mesh.visible) continue;
      _seg.closestPointToPoint(t.pos, true, _cp);
      if (_cp.distanceToSquared(t.pos) < (t.r + b.width) ** 2) {
        b.pos.copy(_cp);
        S.hits++;
        if (targets.damage(t, b.damage, fx)) S.kills++;
        return t;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Klatka

  function frame(dtRaw) {
    const t0 = performance.now();
    const dt = S.paused ? 0 : Math.min(dtRaw, 0.05) * S.speed;
    const K = S.keys;
    const flying = S.mode === 'lot';

    // Lot (tylko w trybie lotu; oględziny — statek w miejscu).
    if (flying) {
      flight.step(dt, {
        thrust: (K.has('w') ? 1 : 0) - (K.has('s') ? 1 : 0),
        turn: (K.has('a') ? 1 : 0) - (K.has('d') ? 1 : 0),
        strafe: (K.has('q') ? 1 : 0) - (K.has('e') ? 1 : 0),
        lift: (K.has('r') ? 1 : 0) - (K.has('f') ? 1 : 0),
        boost: K.has('shift')
      });
    } else if (dt > 0) {
      flight.throttle += (0.18 - flight.throttle) * Math.min(1, dt);
    }
    const fleetMode = S.mode === 'flota';
    if (!fleetMode) flight.apply(ship.root, S.banking);
    ship.root.updateMatrixWorld(true);
    _inv.copy(ship.root.matrixWorld).invert();

    // Flota: wszystkie okręty celują w punkt pod kursorem, Spacja — salwa wież głównych.
    if (fleetMode) {
      const aim = S.mouse.over || TEST ? aimAt(S.aim) : null;
      for (const id of FLEET_IDS) {
        const s = ships[id];
        s.aim({ main: aim, special: aim, missile: aim, aux: aim }, dt);
        if (dt > 0 && aim && K.has(' ')) { s.fire('main', spawnFromTurret); s.fire('special', spawnFromTurret, 0.35); }
        s.throttle = 0.2;
        s.update(dt, sOpts);
      }
    }
    // Celowanie: główne / specjalne / rakiety w kursor (cel pod kursorem), aux — najbliższy dron.
    if (S.mode !== 'galeria' && !fleetMode) {
      const aim = S.mouse.over || TEST ? aimAt(S.aim) : null;
      const pdT = S.pd && S.drones ? targets.nearestDrone(flight.pos, 2800) : null;
      let pdPoint = null;
      if (pdT) {
        // Wyprzedzenie celu (prędkość pocisku CIWS ~2000 j/s).
        const tt = pdT.pos.distanceTo(flight.pos) / 2000;
        pdPoint = _v2.copy(pdT.vel).multiplyScalar(tt).add(pdT.pos);
      }
      ship.aim({ main: aim, special: aim, missile: aim, aux: pdPoint }, dt);
      if (dt > 0) {
        const fireMain = flying ? S.mouse.lmb : K.has(' ');
        const fireMis = flying ? (S.mouse.rmb || K.has(' ')) : K.has('m');
        if (fireMain && aim) { ship.fire('main', spawnFromTurret); ship.fire('special', spawnFromTurret, 0.35); }
        if (fireMis) ship.fire('missile', spawnFromTurret, 10);
        if (pdT) ship.fire('aux', spawnFromTurret, 0.3);
        stepHexlance(dt);
      }
    }
    if (!fleetMode) {
      ship.throttle = flight.throttle;
      ship.update(dt, sOpts);
    }

    if (fleetMode) {
      // bez celów — czysty kadr floty
    } else if (S.mode !== 'galeria') {
      if (dt > 0) targets.update(dt, flight, S.drones ? fx : null, S.drones);
    } else {
      gallery.update(dt, fx, !S.paused);
    }
    if (dt > 0) fx.update(dt, hitTest);

    // Kamera: w galerii środek siatki, we flocie środek szyku (pan), inaczej statek.
    if (S.mode === 'galeria') {
      const g = gallery.frame();
      rig.update(dt || 1 / 60, { pos: g.center, heading: 0, forward: new THREE.Vector3(1, 0, 0) });
    } else {
      rig.update(dt || 1 / 60, flight);
    }

    // Słońce i cień za kadrem (środek = statek, szyk floty albo galeria).
    const focus = S.mode === 'galeria' ? gallery.frame().center : fleetMode ? FLEET_CENTER : flight.pos;
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunDir, 4000);
    sun.target.updateMatrixWorld();
    fill.target.position.copy(focus);
    fill.position.copy(focus).add(_v.set(-sunDir.x * 0.6, -sunDir.y * 0.6, -1).normalize().multiplyScalar(4000));
    fill.target.updateMatrixWorld();
    if (envDirty) { envDirty = false; sky.makeEnv(); }

    renderer.info.reset?.();
    pipeline.render();
    S.draw = renderer.info.render.drawCalls;
    S.tris = renderer.info.render.triangles;
    S.cpuMs = performance.now() - t0;
    if (timestamps && (S.frames % 8) === 0) renderer.resolveTimestampsAsync('render').then((ms) => { if (Number.isFinite(ms)) S.gpuMs = ms; }).catch(() => {});
    S.frames++;
    updateOverlay();
  }

  // ---------------------------------------------------------------------------
  // HUD, etykiety galerii, statystyki

  const labelsEl = $('labels');
  const labelEls = gallery.items.map((it) => {
    const d = document.createElement('div');
    d.textContent = it.label;
    labelsEl.appendChild(d);
    return d;
  });
  const fleetLabelEls = {};
  for (const id of FLEET_IDS) {
    const d = document.createElement('div');
    d.textContent = SHIP3D_MODELS[id].short;
    d.className = `fleet-label f-${SHIP3D_MODELS[id].faction}`;
    d.style.display = 'none';
    labelsEl.appendChild(d);
    fleetLabelEls[id] = d;
  }
  const _box = new THREE.Box3();
  function pickFleetShip(px, py) {
    raycaster.setFromCamera({ x: (px / innerWidth) * 2 - 1, y: -(py / innerHeight) * 2 + 1 }, camera);
    let best = null; let bd = Infinity;
    for (const id of FLEET_IDS) {
      const s = ships[id];
      _box.copy(s.hullGeometry.boundingBox).applyMatrix4(s.root.matrixWorld);
      const hit = raycaster.ray.intersectBox(_box, _v2);
      if (!hit) continue;
      const d = hit.distanceTo(raycaster.ray.origin);
      if (d < bd) { bd = d; best = s.id; }
    }
    return best;
  }
  const cross = $('crosshair');
  function updateOverlay() {
    if (S.mode === 'flota') {
      for (const id of FLEET_IDS) {
        const s = ships[id];
        const bb = s.hullGeometry.boundingBox;
        _v.set(s.center.x, s.center.y, bb.max.z + 30).applyMatrix4(s.root.matrixWorld).project(camera);
        const el = fleetLabelEls[s.id];
        if (_v.z > 1) { el.style.display = 'none'; continue; }
        el.style.display = 'block';
        el.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
        el.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
      }
    }
    if (S.mode === 'galeria') {
      gallery.items.forEach((it, i) => {
        _v.copy(it.pos).add(gallery.group.position).add(_v2.set(0, 0, 70)).project(camera);
        const el = labelEls[i];
        if (_v.z > 1) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
        el.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
      });
    }
    const showCross = (S.mode === 'lot' || S.mode === 'flota') && S.mouse.over;
    cross.style.display = showCross ? 'block' : 'none';
    if (showCross) {
      cross.style.left = `${S.mouse.px}px`;
      cross.style.top = `${S.mouse.py}px`;
      cross.style.borderColor = S.lock ? 'rgba(255, 120, 90, .9)' : 'rgba(140, 220, 255, .75)';
    }
  }

  let lastPanel = 0;
  let frameCount = 0;
  let lastFpsT = performance.now();
  function updatePanel(now) {
    frameCount++;
    if (now - lastFpsT > 500) { S.fps = (frameCount * 1000) / (now - lastFpsT); frameCount = 0; lastFpsT = now; }
    if (now - lastPanel < 250) return;
    lastPanel = now;
    const st = ship.stats();
    $('stats').textContent =
      `${ship.label}\n` +
      `FPS ${S.fps.toFixed(0)}  CPU ${S.cpuMs.toFixed(1)} ms${timestamps ? `  GPU ${Number(S.gpuMs || 0).toFixed(2)} ms` : ''}\n` +
      `draw calls ${S.draw ?? '?'}  trójkąty ${(S.tris ?? 0).toLocaleString('pl-PL')}\n` +
      `kadłub ${st.hullTris.toLocaleString('pl-PL')} tr. · wieże ${st.turrets} (${st.turretTris.toLocaleString('pl-PL')} tr.)\n` +
      `budowa modelu ${st.buildMs} ms · pociski ${fx.bolts.length}\n` +
      loadoutInfo;
    const sp = Math.hypot(flight.vel.x, flight.vel.y, flight.vel.z);
    const hd = ((flight.heading / DEG) % 360 + 360) % 360;
    $('hud').textContent =
      `TRYB      ${S.mode.toUpperCase()} · kamera ${rig.mode}\n` +
      `PRĘDKOŚĆ  ${sp.toFixed(0).padStart(4)} j/s   KURS ${hd.toFixed(0).padStart(3)}°\n` +
      `CIĄG      ${(flight.throttle * 100).toFixed(0).padStart(3)}%    WYS. ${flight.pos.z.toFixed(0)} j\n` +
      `CEL       ${S.lock ? (S.lock.kind === 'drone' ? 'dron' : 'skała') + ` · ${S.lock.pos.distanceTo(flight.pos).toFixed(0)} j` : '—'}\n` +
      `TRAFIENIA ${S.hits}   ZESTRZELENIA ${S.kills}\n` +
      `HEXLANCE  ${!ship.hull.hexlanceMuzzle ? '—' : S.hexCd > 0 ? `${S.hexCd.toFixed(1)} s` : 'gotowy (X)'}${S.pd ? '   PD auto' : ''}${S.paused ? '   PAUZA' : ''}`;
  }

  // ---------------------------------------------------------------------------
  // Eksport GLB: te same geometrie, materiały standardowe (paleta → grupy), pokład ze sprite'em.

  async function exportGLB() {
    const { exportShipGLB } = await import('./atlas3d-webgpu/eksport.js');
    const blob = await exportShipGLB(ship, images[ship.id]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${ship.id}3d.glb`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return blob.size;
  }

  // ---------------------------------------------------------------------------
  // Pętla (pod ?test=1 klatki tylko z __demo.step; rAF liczy klatki węzłów)

  let pendingSteps = 0;
  let stepDone = null;
  let last = performance.now();
  let frameErrors = 0;
  function safeFrame(dt) {
    try {
      frame(dt);
      frameErrors = 0;
    } catch (e) {
      showError(`Klatka: ${e?.stack || e}`);
      if (++frameErrors > 30) { renderer.setAnimationLoop(null); showError('Pętla zatrzymana po powtarzających się błędach.'); }
    }
  }

  selectShip(ship.id, true);
  setMode(params.get('tryb') || (params.get('statek') ? 'ogledziny' : 'flota'));
  if (params.get('kamera')) setCamera(params.get('kamera'));
  updateSun();
  $('loading').style.display = 'none';
  $('backend').textContent = `WebGPU · three r${THREE.REVISION}${timestamps ? ' · pomiar czasu GPU' : ''} · cienie ${SH}²`;
  if (TEST) { const el = $('c-drones'); if (el) { el.checked = true; } }

  renderer.setAnimationLoop((now) => {
    if (pendingSteps > 0) {
      pendingSteps--;
      safeFrame(1 / 60);
      if (pendingSteps === 0 && stepDone) {
        const done = stepDone;
        stepDone = null;
        device.queue.onSubmittedWorkDone().then(done);
      }
      last = now;
      updatePanel(now);
      return;
    }
    if (TEST) return;
    const dt = clamp((now - last) / 1000, 0.001, 0.05);
    last = now;
    safeFrame(dt);
    updatePanel(now);
  });

  window.__demo = {
    ready: true,
    S, renderer, scene, camera, ships, flight, rig, fx, targets, gallery, sun,
    get ship() { return ship; },
    /** Wybór okrętu (id z SHIP3D_MODELS, model budowany przy pierwszym wyborze); Promise → stats(). */
    async ship3d(id, mode) { await selectShip(id, !!mode); if (mode) setMode(mode); return ship.stats(); },
    ids: SHIP3D_IDS,
    fleet() { setMode('flota'); },
    step(n = 1) {
      return new Promise((resolve) => { pendingSteps = Math.max(1, n | 0); stepDone = resolve; });
    },
    mode: setMode,
    camera: setCamera,
    loadout: setLoadoutPreset,
    keys(list = []) { S.keys = new Set(list); },
    mouse(nx, ny, o = {}) {
      Object.assign(S.mouse, { nx, ny, px: (nx * 0.5 + 0.5) * innerWidth, py: (0.5 - ny * 0.5) * innerHeight, over: true, lmb: !!o.lmb, rmb: !!o.rmb });
    },
    view(o = {}) {
      if (o.dist) rig.dist = o.dist;
      if (o.az != null) rig.az = o.az;
      if (o.el != null) rig.el = o.el;
      if (o.tilt != null) rig.tilt = o.tilt;
      if (o.pan) rig.pan.set(o.pan[0] || 0, o.pan[1] || 0, o.pan[2] || 0);
    },
    fire(group = 'main') {
      if (group === 'hexlance') return fireHexlance();
      aimAt(S.aim);
      return ship.fire(group, spawnFromTurret, 10);
    },
    exportGLB,
    galleryScale: (on) => { const el = $('c-gscale'); el.checked = !!on; el.dispatchEvent(new Event('change')); },
    stats() {
      const st = ship.stats();
      return {
        ...st, id: ship.id, mode: S.mode, camera: rig.mode, bolts: fx.bolts.length, flashes: fx.flashes.length,
        hits: S.hits, kills: S.kills, drawCalls: S.draw, triangles: S.tris,
        mounts: ship.hull.mounts.length, nozzles: ship.hull.nozzles.length, lights: ship.hull.lights.length,
        loadout: Object.values(ship.loadout).length, pos: flight.pos.toArray().map((v) => Math.round(v)), heading: Math.round(flight.heading / DEG)
      };
    }
  };
}

main().catch((e) => showError(`Start: ${e?.stack || e}`));
