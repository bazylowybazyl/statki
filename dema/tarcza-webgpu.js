// ============================================================
// Demo WebGPU: tarcza nowej generacji na kadłubie Atlasa.
// Strona: dema/tarcza-webgpu.html (Vite, `npm run dev`).
//
// Klatka: wejście → kamera → broń i pociski (gameplay 2D jak w grze) →
// stany tarcz (updateShieldFx z shieldSystem.js) → zdarzenia pola → światła →
// compute (pole, iskry, odłamki) → render (pass → bloom → tone mapping).
// Współrzędne API (__demo) i encji: układ gry, y w dół; scena 3D: y = −y gry.
// ============================================================
import * as THREE from 'three/webgpu';
import { pass, float, vec3, length, abs, fwidth, max, mix, smoothstep } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { updateShieldFx, setEntityShieldForcedOff } from '../shieldSystem.js';
import { uTime, uDt, lights, uLightsOn, uLightGain, BLOOM_GAME, clamp } from './tarcza-webgpu/wspolne.js';
import { createSky } from './tarcza-webgpu/tlo.js';
import { loadAtlasSprite, createAtlasHullMesh } from './tarcza-webgpu/kadlub.js';
import { buildShip, placeShip, aimTurret, shipPoint, footprintShards } from './tarcza-webgpu/wrogowie.js';
import { Tarcza, FIELD_PARAMS } from './tarcza-webgpu/tarcza.js';
import { sstepDown } from './tarcza-webgpu/czasza.js';
import { createWeapons, WEAPONS } from './tarcza-webgpu/bronie.js';
import { createClash } from './tarcza-webgpu/zderzenie.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const DEBUG_FIELD = params.get('debug') === 'pole';
const GRID_CELLS = clamp(Number(params.get('siatka')) || 512, 128, 1024);

// ---------------------------------------------------------------------------
// Błędy: na ekran i do konsoli (skrypt sprawdzający zbiera konsolę).

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
  window.__demo = { ready: false, error: 'webgpu', detail };
}

async function main() {
  if (!('gpu' in navigator)) { noWebGPU('navigator.gpu nie istnieje.'); return; }
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) { noWebGPU('Brak adaptera WebGPU (requestAdapter zwrócił null).'); return; }

  // -------------------------------------------------------------------------
  // Renderer

  const renderer = new THREE.WebGPURenderer({ antialias: false, trackTimestamp: true, powerPreference: 'high-performance' });
  const DPR = Number(params.get('dpr')) || Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(DPR);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (renderer.backend.isWebGPUBackend !== true) {
    noWebGPU('WebGPURenderer przełączył się na WebGL2 — demo wymaga compute i tekstur storage.');
    return;
  }
  const device = renderer.backend.device;
  // Błędy walidacji WebGPU / WGSL jako błędy konsoli (skrypt sprawdzający je liczy).
  device.addEventListener('uncapturederror', (e) => showError(`WebGPU: ${e.error?.message || e.error}`));
  const timestamps = renderer.backend.trackTimestamp === true;

  // -------------------------------------------------------------------------
  // Scena i kamera z góry (jak w grze: perspektywa, fov 35°, prosto w dół)

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 10, 30000);
  const TAN_H = Math.tan(THREE.MathUtils.degToRad(35 / 2));
  const cam = { x: 0, y: 300, z: 5200, tz: 5200, anchor: { on: false, wx: 0, wy: 0, nx: 0, ny: 0 } };
  const ZOOM_MIN = 420, ZOOM_MAX = 24000;
  function syncCamera() {
    camera.position.set(cam.x, cam.y, cam.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(cam.x, cam.y, 0);
    camera.near = Math.max(5, cam.z * 0.05);
    camera.far = cam.z + 6000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  syncCamera();

  // Słabe światło stałe: ciemny kosmos, resztę niosą trafienia.
  const sun = new THREE.DirectionalLight(0xc8d8ff, 1.7);
  sun.position.set(-0.6, 0.75, 1.0);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0x2c3a66, 0x06080e, 0.5);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);

  const sky = createSky(renderer, scene);

  // -------------------------------------------------------------------------
  // Atlas (środek sceny, nieruchomy) — encja w konwencji gry: y w dół.

  const sprite = await loadAtlasSprite();
  const SHIELD_MAX = 6000;
  const atlas = {
    x: 0, y: 0, angle: Number(params.get('kat')) || 0, type: 'atlas',
    visual: { spriteScale: sprite.scale },
    hexGrid: { shards: sprite.shards, srcWidth: sprite.W, srcHeight: sprite.H },
    shield: { val: SHIELD_MAX, max: SHIELD_MAX }
  };
  // Grupa w klatce lokalnej 3D: pozycja (x, −y), obrót −kąt (jak Core3D).
  const atlasGroup = new THREE.Group();
  atlasGroup.position.set(atlas.x, -atlas.y, 0);
  atlasGroup.rotation.z = -atlas.angle;
  scene.add(atlasGroup);

  // Znacznik widoku kontrolnego: górny kieł dziobu, piksel sprite'a (3180, 690)
  // → klatka lokalna 3D (x, −y_grid). Poza osiami, więc łapie odbicie x i y.
  const MARKER_R = 28;
  const markerLocal = new THREE.Vector4(
    (3180 - sprite.W / 2) * sprite.scale, -(690 - sprite.H / 2) * sprite.scale, MARKER_R, DEBUG_FIELD ? 1.0 : 0.0);

  const shield = new Tarcza({
    renderer, entity: atlas, group: atlasGroup, gridCells: GRID_CELLS, name: 'Atlas',
    debugMarker: DEBUG_FIELD ? markerLocal : null
  });

  // Kadłub czyta stan pola w swojej pozycji lokalnej (ta sama klatka co siatka pola):
  // emisja ∝ E + |fala| w barwie tarczy — pancerz pod rozgrzaną łatą błękitnieje, fala
  // przebiega po nim jak odbicie. W widoku kontrolnym dochodzi pierścień znacznika.
  const hullExtra = (local, albedo) => {
    const P = shield.P, U = shield.U, G = shield.G;
    const f = P.texNode.sample(local.sub(P.uOrigin).div(P.uSize));
    const eN = max(f.y, 0.0).div(max(P.uThr, 0.05));
    const glow = eN.mul(0.8).add(max(f.w, 0.0).mul(0.45)).add(abs(f.x).mul(0.012));
    const lColor = mix(vec3(1.0, 0.08, 0.04), U.color, U.life);
    const heat = mix(mix(lColor, vec3(1.25, 1.3, 1.4), smoothstep(0.42, 0.9, eN)), vec3(1.9, 0.62, 0.16), smoothstep(0.95, 1.45, eN));
    let e = heat.mul(glow).mul(albedo.mul(1.6).add(0.035)).mul(G.hullGlow);
    if (DEBUG_FIELD) {
      const d = length(local.sub(P.uMarker.xy));
      const ring = sstepDown(2.2, 0.0, abs(d.sub(float(MARKER_R * 1.45))).div(max(fwidth(d), 1e-4)));
      e = e.add(vec3(5.0, 0.8, 4.4).mul(ring));
    }
    return e;
  };
  const atlasHull = createAtlasHullMesh(sprite, hullExtra);
  atlasGroup.add(atlasHull.mesh);
  atlasGroup.updateMatrixWorld(true);

  const profile = shield.profile;
  console.log(`Tarcza Atlasa: maxR ${profile.maxR.toFixed(1)} j., minR ${profile.minR.toFixed(1)} j., odstęp ${profile.pad.toFixed(1)} j., ` +
    `kadłub ${sprite.shards.length} komórek, siatka pola ${shield.describeGrid()}`);

  // -------------------------------------------------------------------------
  // Wrogowie: 3 mniejsze okręty na łuku 4–6 tys. j. od Atlasa, wieże w Atlasa.
  // Środkowy ma własną tarczę-obrys (profil z sylwetki brył, ta sama droga co u Atlasa).

  const ENEMY_DEFS = [
    { a: 32, d: 4700, scale: 0.55, seed: 29, base: 0x7d4b3b, dark: 0x3e2a25, line: 0x1d1210, engine: [7.0, 2.2, 0.6], laser: [1.0, 0.16, 0.1] },
    { a: 93, d: 5300, scale: 0.6, seed: 41, base: 0x5d7760, dark: 0x2f3a31, line: 0x141a15, engine: [1.2, 6.5, 2.4], laser: [0.25, 1.0, 0.32], shield: true },
    { a: 151, d: 4300, scale: 0.5, seed: 57, base: 0x6b6f86, dark: 0x33364a, line: 0x15161f, engine: [4.8, 1.4, 6.2], laser: [0.8, 0.3, 1.0] }
  ];
  const enemies = ENEMY_DEFS.map((def) => {
    const ship = buildShip(def);
    const ang = THREE.MathUtils.degToRad(def.a);
    const x = Math.cos(ang) * def.d, y = Math.sin(ang) * def.d;
    // Okręt bokiem do Atlasa, dziób lekko ku niemu.
    const face = Math.atan2(-y, -x) + 1.05;
    placeShip(ship, x, y, face);
    aimTurret(ship, atlas.x, -atlas.y);
    scene.add(ship.group);
    return { def, ship, home: { x, y, angle: face } };
  });

  const eIdx = ENEMY_DEFS.findIndex((d) => d.shield);
  const eShip = enemies[eIdx].ship;
  const eEnt = {
    x: eShip.x, y: -eShip.y, angle: -eShip.angle, type: 'destroyer',
    visual: { spriteScale: ENEMY_DEFS[eIdx].scale },
    hexGrid: { shards: footprintShards(eShip.footprint, 12) },
    shield: { val: 3000, max: 3000 }
  };
  const eGroup = new THREE.Group();
  scene.add(eGroup);
  const eShield = new Tarcza({ renderer, entity: eEnt, group: eGroup, gridCells: 192, name: 'wróg', sparkPool: 16384, shardMax: 1500 });
  const clash = createClash({ atlas, atlasShield: shield, enemy: enemies[eIdx], eEnt, eShield, eGroup });
  clash.syncEnemy();

  const weapons = createWeapons({ scene, atlas, shield, sprite, enemies });

  // -------------------------------------------------------------------------
  // Render: pass sceny (MSAA 4) → bloom → tone mapping (RenderPipeline).

  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera, { samples: 4 });
  const sceneColor = scenePass.getTextureNode('output');
  const bloomNode = bloom(sceneColor, BLOOM_GAME.strength, BLOOM_GAME.radius, BLOOM_GAME.threshold);
  pipeline.outputNode = sceneColor.add(bloomNode);

  // -------------------------------------------------------------------------
  // Stan dema i wejście

  const S = {
    time: 0, frames: 0, fps: 60, cpuMs: 0, gpuMs: 0, gpuComputeMs: 0, pxPerUnit: 1,
    keys: new Set(), mouse: { x: innerWidth / 2, y: innerHeight / 2, left: false, right: false },
    aim: new THREE.Vector3(), aimLock: false,
    newFx: true, regen: 0.04, bloom: true, bloomStrength: BLOOM_GAME.strength,
    lightsOn: true, glowOn: true, refrOn: true
  };
  const input = { fire: false, beam: false, x: 0, y: 0 };

  // Punkt płaszczyzny z = planeZ pod pikselem ekranu (kamera patrzy prosto w dół).
  function screenToWorld(px, py, planeZ, out) {
    const nx = (px / innerWidth) * 2 - 1, ny = -(py / innerHeight) * 2 + 1;
    const h = cam.z - planeZ;
    out.set(cam.x + nx * h * TAN_H * camera.aspect, cam.y + ny * h * TAN_H, planeZ);
    return out;
  }
  function updateAim() {
    if (!S.aimLock) screenToWorld(S.mouse.x, S.mouse.y, 0, S.aim);
  }

  const _wv = new THREE.Vector3();
  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => { S.mouse.x = e.clientX; S.mouse.y = e.clientY; S.aimLock = false; });
  canvas.addEventListener('pointerdown', (e) => {
    S.mouse.x = e.clientX; S.mouse.y = e.clientY; S.aimLock = false;
    if (e.button === 0) { S.mouse.left = true; weapons.W.fireCd = 0; }
    if (e.button === 2) S.mouse.right = true;
  });
  addEventListener('pointerup', (e) => {
    if (e.button === 0) S.mouse.left = false;
    if (e.button === 2) S.mouse.right = false;
  });
  // Zoom do kursora: punkt świata pod kursorem zostaje pod kursorem.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.tz = clamp(cam.tz * Math.exp(e.deltaY * 0.0012), ZOOM_MIN, ZOOM_MAX);
    const p = screenToWorld(e.clientX, e.clientY, 0, _wv);
    const a = cam.anchor;
    a.on = true; a.wx = p.x; a.wy = p.y;
    a.nx = (e.clientX / innerWidth) * 2 - 1; a.ny = -(e.clientY / innerHeight) * 2 + 1;
  }, { passive: false });

  // A/B: bez nowych efektów zostaje sama czasza z łatami (jak dziś w grze) — bez fal,
  // energii, świateł, poświaty, załamania i iskier.
  function applyFxToggles() {
    const on = S.newFx;
    uLightsOn.value = on && S.lightsOn ? 1 : 0;
    for (const sh of [shield, eShield]) {
      sh.G.hullGlow.value = on && S.glowOn ? 1 : 0;
      sh.G.refrOn.value = on && S.refrOn ? 1 : 0;
    }
  }
  function setNewFx(on) {
    S.newFx = on;
    const ab = $('ab');
    ab.className = on ? 'on' : 'off';
    ab.textContent = on ? 'T · Nowe efekty: WŁĄCZONE' : 'T · Jak dziś w grze (łaty trafień)';
    if (!DEBUG_FIELD) shield.setMode(on ? 'new' : 'ref');
    eShield.setMode(on ? 'new' : 'ref');
    applyFxToggles();
  }
  $('ab').addEventListener('click', () => setNewFx(!S.newFx));

  function setWeapon(n) {
    if (!WEAPONS[n]) return;
    weapons.W.weapon = n;
    for (const b of document.querySelectorAll('#weapons button')) b.classList.toggle('on', Number(b.dataset.w) === n);
  }
  for (const b of document.querySelectorAll('#weapons button')) b.addEventListener('click', () => setWeapon(Number(b.dataset.w)));

  function toggleShield() {
    setEntityShieldForcedOff(atlas, !atlas._shieldForcedOff);
    return !atlas._shieldForcedOff;
  }
  function breakShield() { atlas.shield.val = 0; }
  function fullCharge() { atlas.shield.val = atlas.shield.max; }
  function aimGame(out) { return out.set(S.aim.x, -S.aim.y); }
  const _aim2 = new THREE.Vector2();
  function salvoAtAim() { aimGame(_aim2); weapons.salvo(_aim2.x, _aim2.y); }

  function toggleCheck(id) { const el = $(id); el.checked = !el.checked; el.dispatchEvent(new Event('change')); }
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    S.keys.add(k);
    if (k === 'h') $('panel').classList.toggle('hidden');
    if (k === 't') setNewFx(!S.newFx);
    if (k === 'o') toggleShield();
    if (k === 'b') breakShield();
    if (k === 'r') fullCharge();
    if (k === 'k') clash.toggle();
    if (k === 'p') toggleCheck('c-sparks');
    if (k === 'e') toggleCheck('c-enemy');
    if (k >= '1' && k <= '4') setWeapon(Number(k));
    if (k === ' ') { e.preventDefault(); salvoAtAim(); }
  });
  addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // Panel: przełączniki i suwaki.
  function bindCheck(id, fn) { const el = $(id); el.addEventListener('change', () => fn(el.checked)); fn(el.checked); }
  // onChange: przebudowa (siatka pola) dopiero po puszczeniu suwaka, nie co krok.
  function bindRange(id, fn, fmt = (v) => v.toFixed(2), onChange = false) {
    const el = $(id), out = $(id.replace('s-', 'o-'));
    const show = () => { if (out) out.textContent = fmt(Number(el.value)); };
    const upd = () => { show(); fn(Number(el.value)); };
    el.addEventListener('input', onChange ? show : upd);
    if (onChange) el.addEventListener('change', upd);
    upd();
  }
  if (TEST) $('c-enemy').checked = false;   // test: bez losowego ognia
  bindCheck('c-field', (v) => { shield.showField = v; eShield.showField = v; });
  bindCheck('c-lights', (v) => { S.lightsOn = v; applyFxToggles(); });
  bindCheck('c-glow', (v) => { S.glowOn = v; applyFxToggles(); });
  bindCheck('c-refr', (v) => { S.refrOn = v; applyFxToggles(); });
  bindCheck('c-sparks', (v) => { FIELD_PARAMS.sparksOn = v; });
  bindCheck('c-bloom', (v) => { S.bloom = v; bloomNode.strength.value = v ? S.bloomStrength : 0; });
  bindCheck('c-enemy', (v) => { weapons.W.enemyFire = v; });
  bindCheck('c-waves', (v) => { FIELD_PARAMS.wavesOn = v; });
  bindCheck('c-energy', (v) => { FIELD_PARAMS.energyOn = v; });
  bindRange('s-refr', (v) => { shield.G.refr.value = v; eShield.G.refr.value = v; });
  bindRange('s-light', (v) => { uLightGain.value = v; });
  bindRange('s-sparks', (v) => { FIELD_PARAMS.sparkMult = v; });
  bindRange('s-bloom', (v) => { S.bloomStrength = v; if (S.bloom) bloomNode.strength.value = v; });
  bindRange('s-wave', (v) => { FIELD_PARAMS.waveSpeed = v; }, (v) => v.toFixed(0));
  bindRange('s-damp', (v) => { FIELD_PARAMS.damping = v; }, (v) => v.toFixed(1));
  bindRange('s-cool', (v) => { FIELD_PARAMS.coolTime = v; }, (v) => v.toFixed(1));
  bindRange('s-thr', (v) => { FIELD_PARAMS.threshold = v; });
  bindRange('s-regen', (v) => { S.regen = v / 100; }, (v) => v.toFixed(1));
  $('s-grid').value = String(GRID_CELLS);
  bindRange('s-grid', (v) => { shield.setGridCells(v); }, (v) => v.toFixed(0), true);
  const TONE = { neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping };
  $('sel-tone').addEventListener('change', (e) => {
    renderer.toneMapping = TONE[e.target.value] || THREE.NeutralToneMapping;
    pipeline.needsUpdate = true;
  });
  setWeapon(2);

  function updateCamera(dt) {
    const pan = 1300 * dt * (cam.z / 3600);
    let moved = false;
    if (S.keys.has('w') || S.keys.has('arrowup')) { cam.y += pan; moved = true; }
    if (S.keys.has('s') || S.keys.has('arrowdown')) { cam.y -= pan; moved = true; }
    if (S.keys.has('a') || S.keys.has('arrowleft')) { cam.x -= pan; moved = true; }
    if (S.keys.has('d') || S.keys.has('arrowright')) { cam.x += pan; moved = true; }
    if (moved) cam.anchor.on = false;
    cam.z += (cam.tz - cam.z) * Math.min(1, dt * 8);
    const a = cam.anchor;
    if (a.on) {
      cam.x = a.wx - a.nx * cam.z * TAN_H * camera.aspect;
      cam.y = a.wy - a.ny * cam.z * TAN_H;
      if (Math.abs(cam.tz - cam.z) < 0.5) a.on = false;
    }
    syncCamera();
    // Skala „zoom” gry: piksele ekranu na jednostkę w płaszczyźnie kadłuba.
    S.pxPerUnit = (innerHeight * 0.5) / (cam.z * TAN_H);
  }

  // -------------------------------------------------------------------------
  // Tarcze: HP (regeneracja po stronie dema, jak wołający w grze) i stany.
  // Kolejność jak w grze: najpierw stan (val = 0 → breaking), potem ładowanie —
  // regeneracja przed updateShieldFx podniosłaby HP z zera i pęknięcie by nie ruszyło.
  function updateShieldState(ent, dt) {
    const sh = ent.shield;
    updateShieldFx(ent, dt);
    if (sh.state !== 'breaking' && sh.val < sh.max) sh.val = Math.min(sh.max, sh.val + sh.max * S.regen * dt);
  }

  // Trafienie w punkt gry (x, y): tarcza blokuje → registerShieldImpact + HP.
  function hitAt(x, y, dmg = 100, cls = 'main') {
    if (!shield.isBlocking()) return false;
    return shield.registerHit(x, y, dmg, cls);
  }

  // -------------------------------------------------------------------------
  // Klatka

  const _v = new THREE.Vector3();
  const SHIELD_PAIRS = [[atlas, shield], [eEnt, eShield]];
  function frame(dt) {
    const t0 = performance.now();
    S.time += dt;
    S.frames++;
    uTime.value = S.time;
    uDt.value = dt;

    updateCamera(dt);
    updateAim();
    lights.reset();

    // Wrogowie: wieże w Atlasa, dysze świecą na kadłub za rufą.
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      aimTurret(e.ship, atlas.x, -atlas.y);
      const p = shipPoint(e.ship, -700, 0, 10, _v);
      const g = e.ship.engine, s = e.ship.scale;
      lights.push(p.x, p.y, p.z, 900 * s, 220 * s, g[0] * 0.28, g[1] * 0.28, g[2] * 0.28);
    }

    // Broń: LPM wybrana broń z najbliższego wroga w kursor, PPM wiązka.
    input.fire = S.mouse.left;
    input.beam = S.mouse.right;
    input.x = S.aim.x; input.y = -S.aim.y;
    weapons.update(dt, S.time, input);
    clash.update(dt);

    for (let i = 0; i < SHIELD_PAIRS.length; i++) {
      const ent = SHIELD_PAIRS[i][0], sh = SHIELD_PAIRS[i][1];
      updateShieldState(ent, dt);
      sh.update(dt, S.time, S.pxPerUnit);
      // Załamanie: pochylenie normalnej → uv ekranu (ośrodek ~90 j. „grubości”).
      sh.G.refrK.value = 90 * S.pxPerUnit / Math.max(1, innerHeight);
      sh.G.aspect.value = camera.aspect;
      if (S.newFx) sh.emitLights(dt);
    }
    weapons.emit(dt, S.time);

    lights.commit();
    shield.computeStep(dt);
    eShield.computeStep(dt);
    sky.fit(camera);
    pipeline.render();

    S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    if (timestamps && (S.frames % 8) === 0) {
      renderer.resolveTimestampsAsync('render').then(onGpuRender);
      renderer.resolveTimestampsAsync('compute').then(onGpuCompute);
    }
  }
  // Czasy GPU ostatniej klatki (znaczniki czasu) — funkcje tworzone raz.
  function onGpuRender(ms) { if (Number.isFinite(ms)) S.gpuMs = ms; }
  function onGpuCompute(ms) { if (Number.isFinite(ms)) S.gpuComputeMs = ms; }

  // Panel: HP i statystyki (4 razy na sekundę — tekst to jedyna alokacja poza startem).
  const hpFill = $('hpfill'), hpText = $('hptext'), statsEl = $('stats');
  let statsAt = 0, fpsFrames = 0, fpsT = performance.now();
  function updatePanel(now) {
    fpsFrames++;
    if (now - statsAt < 250) return;
    S.fps = fpsFrames * 1000 / Math.max(1, now - fpsT);
    fpsFrames = 0; fpsT = now; statsAt = now;
    const sh = atlas.shield;
    const life = sh.val / sh.max;
    hpFill.style.width = `${(life * 100).toFixed(1)}%`;
    hpFill.style.background = life < 0.35 ? 'linear-gradient(90deg, #b8322a, #ff7a55)' : 'linear-gradient(90deg, #3b6fd8, #7fb0ff)';
    hpText.textContent = `tarcza: ${sh.state}${atlas._shieldForcedOff ? ' (wyłączona)' : ''} · HP ${Math.round(sh.val)} / ${sh.max} (${(life * 100).toFixed(0)}%)` +
      (clash.C.phase !== 'idle' ? ` · K: ${clash.C.phase}` : '');
    const W = renderer.domElement.width, H = renderer.domElement.height;
    statsEl.textContent =
      `FPS              ${S.fps.toFixed(0)}   (${W}×${H})\n` +
      `ms CPU (klatka)  ${S.cpuMs.toFixed(2)}\n` +
      `ms GPU           ${timestamps ? (S.gpuMs + S.gpuComputeMs).toFixed(2) + `  (compute ${S.gpuComputeMs.toFixed(2)})` : '— (brak timestamp-query)'}\n` +
      `siatka pola      ${shield.describeGrid()}\n` +
      `krok fali        1/${Math.round(1 / shield.stepSize)} s × ${shield.substeps}\n` +
      `zdarzenia/klatkę ${shield.eventsLastFrame + eShield.eventsLastFrame}\n` +
      `żywe iskry (≈)   ${(shield.sparks.live + eShield.sparks.live).toLocaleString('pl-PL')} / ${shield.sparks.pool.toLocaleString('pl-PL')}\n` +
      `światła          ${lights.count} / 256\n` +
      `pociski          ${weapons.W.stats.bolts}   przez przebicie: ${weapons.W.stats.passed}`;
  }

  // -------------------------------------------------------------------------
  // Pętla. Pod ?test=1 pętla rAF three nadal chodzi (liczy klatki węzłów, bez
  // tego pass i bloom nie odświeżają się), ale klatka dema idzie TYLKO z step(n).

  let pendingSteps = 0;
  let stepDone = null;
  let last = performance.now();
  let frameErrors = 0;
  // Wyjątek w klatce: na ekran i do konsoli, ale bez zawieszenia step() i bez
  // zalewu komunikatów (po 30 błędach z rzędu pętla staje).
  function safeFrame(dt) {
    try {
      frame(dt);
      frameErrors = 0;
    } catch (e) {
      showError(`Klatka: ${e?.stack || e}`);
      if (++frameErrors > 30) { renderer.setAnimationLoop(null); showError('Pętla zatrzymana po powtarzających się błędach.'); }
    }
  }
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

  // Widok kontrolny: kamera prosto nad znacznikiem (bez paralaksy czaszy).
  if (DEBUG_FIELD) {
    const wp = shield.localToWorld(markerLocal.x, markerLocal.y, new THREE.Vector2());
    cam.x = wp.x; cam.y = -wp.y; cam.z = cam.tz = 1500;
    syncCamera();
  }
  setNewFx(!DEBUG_FIELD);
  $('backend').textContent = `WebGPU · ${timestamps ? 'pomiar czasu GPU włączony' : 'bez pomiaru czasu GPU (brak timestamp-query)'}`;

  // ---------------------------------------------------------------------------
  // Sterowanie z konsoli (x, y w układzie gry, y w dół).
  window.__demo = {
    ready: true,
    S, cam, atlas, enemies, shield, eShield, weapons, clash, renderer, scene, camera,
    step(n = 1) {
      return new Promise((resolve) => {
        pendingSteps = Math.max(1, n | 0);
        stepDone = resolve;
      });
    },
    hit: (x, y, dmg = 100, cls = 'main') => hitAt(x, y, dmg, cls),
    // Salwa wszystkich wrogów w punkt (domyślnie kursor / aim).
    salvo(x, y) {
      if (Number.isFinite(x) && Number.isFinite(y)) weapons.salvo(x, y);
      else salvoAtAim();
    },
    beam(x, y, on = true) { weapons.setBeam(on, x, y); return on; },
    aim(x, y) { S.aimLock = true; S.aim.set(x, -y, 0); },
    fire(weapon = weapons.W.weapon, x, y) {
      aimGame(_aim2);
      const tx = Number.isFinite(x) ? x : _aim2.x, ty = Number.isFinite(y) ? y : _aim2.y;
      const n = typeof weapon === 'string' ? ({ pd: 1, main: 2, special: 3 }[weapon] || 2) : weapon;
      return weapons.fire(weapons.nearestEnemy(tx, ty), tx, ty, n);
    },
    setWeapon,
    enemyFire(on) { const el = $('c-enemy'); el.checked = !!on; el.dispatchEvent(new Event('change')); },
    shieldClash(on, fast = false) { return clash.toggle(on, fast); },
    setHP(u) { atlas.shield.val = clamp(u, 0, 1) * atlas.shield.max; return atlas.shield.val; },
    breakShield,
    toggleShield,
    fullCharge,
    setNewFx,
    lookAt(x, y, zoom) {
      cam.x = x; cam.y = -y; cam.anchor.on = false;
      if (zoom) cam.tz = cam.z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
      syncCamera();
    },
    stats() {
      const sh = atlas.shield;
      return {
        fps: S.fps, cpuMs: S.cpuMs, gpuMs: S.gpuMs, gpuComputeMs: S.gpuComputeMs, lights: lights.count,
        state: sh.state, hp: sh.val, hpMax: sh.max, grid: shield.describeGrid(), domeVisible: shield.visible,
        substeps: shield.substeps, events: shield.eventsLastFrame + eShield.eventsLastFrame, mode: shield.mode,
        sparks: shield.sparks.live + eShield.sparks.live, shards: shield.shards.count, shardsActive: shield.shards.active(S.time),
        bolts: weapons.W.stats.bolts, shieldHits: weapons.W.stats.shieldHits, hullHits: weapons.W.stats.hullHits,
        passedBreach: weapons.W.stats.passed, breach: shield.field.breachAny,
        clash: clash.C.phase, clashContacts: clash.C.contacts, enemyShield: eEnt.shield.state, enemyHp: eEnt.shield.val,
        maxR: profile.maxR, minR: profile.minR, pad: profile.pad
      };
    }
  };
}

main().catch((e) => {
  showError(`Start: ${e?.stack || e}`);
  window.__demo = { ready: false, error: 'start', detail: String(e?.message || e) };
});
