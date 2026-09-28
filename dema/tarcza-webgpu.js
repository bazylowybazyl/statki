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
import { pass, float, vec3, length, abs, fwidth, max } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { updateShieldFx, setEntityShieldForcedOff } from '../shieldSystem.js';
import { uTime, uDt, lights, BLOOM_GAME, clamp } from './tarcza-webgpu/wspolne.js';
import { createSky } from './tarcza-webgpu/tlo.js';
import { loadAtlasSprite, createAtlasHullMesh } from './tarcza-webgpu/kadlub.js';
import { buildShip, placeShip, aimTurret, shipPoint } from './tarcza-webgpu/wrogowie.js';
import { Tarcza } from './tarcza-webgpu/tarcza.js';
import { sstepDown } from './tarcza-webgpu/czasza.js';

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
  $('backend').textContent = `WebGPU · ${timestamps ? 'pomiar GPU włączony' : 'bez pomiaru GPU (brak timestamp-query)'}`;

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

  // Kadłub: w widoku kontrolnym pierścień znacznika liczony z pozycji lokalnej kwadu.
  const hullExtra = DEBUG_FIELD ? (local) => {
    const d = length(local.sub(shield.F.uMarker.xy));
    const ring = sstepDown(2.2, 0.0, abs(d.sub(float(MARKER_R * 1.45))).div(max(fwidth(d), 1e-4)));
    return vec3(5.0, 0.8, 4.4).mul(ring);
  } : null;
  const atlasHull = createAtlasHullMesh(sprite, hullExtra);
  atlasGroup.add(atlasHull.mesh);
  atlasGroup.updateMatrixWorld(true);

  const profile = shield.profile;
  console.log(`Tarcza Atlasa: maxR ${profile.maxR.toFixed(1)} j., minR ${profile.minR.toFixed(1)} j., odstęp ${profile.pad.toFixed(1)} j., ` +
    `kadłub ${sprite.shards.length} komórek, siatka pola ${shield.describeGrid()}`);

  // -------------------------------------------------------------------------
  // Wrogowie: 3 mniejsze okręty na łuku 4–6 tys. j. od Atlasa, wieże w Atlasa.

  const ENEMY_DEFS = [
    { a: 32, d: 4700, scale: 0.55, seed: 29, base: 0x7d4b3b, dark: 0x3e2a25, line: 0x1d1210, engine: [7.0, 2.2, 0.6] },
    { a: 93, d: 5300, scale: 0.6, seed: 41, base: 0x5d7760, dark: 0x2f3a31, line: 0x141a15, engine: [1.2, 6.5, 2.4], shield: true },
    { a: 151, d: 4300, scale: 0.5, seed: 57, base: 0x6b6f86, dark: 0x33364a, line: 0x15161f, engine: [4.8, 1.4, 6.2] }
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
    keys: new Set(), mouse: { x: innerWidth / 2, y: innerHeight / 2 },
    aim: new THREE.Vector3(), aimLock: false,
    newFx: true, regen: 0.04, bloom: true, bloomStrength: BLOOM_GAME.strength
  };

  // Punkt płaszczyzny z = planeZ pod pikselem ekranu (kamera patrzy prosto w dół).
  function screenToWorld(px, py, planeZ, out) {
    const nx = (px / innerWidth) * 2 - 1, ny = -(py / innerHeight) * 2 + 1;
    const h = cam.z - planeZ;
    out.set(cam.x + nx * h * TAN_H * camera.aspect, cam.y + ny * h * TAN_H, planeZ);
    return out;
  }
  function updateAim() {
    if (S.aimLock) return;
    screenToWorld(S.mouse.x, S.mouse.y, 0, S.aim);
  }

  const _wv = new THREE.Vector3();
  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => { S.mouse.x = e.clientX; S.mouse.y = e.clientY; S.aimLock = false; });
  // Zoom do kursora: punkt świata pod kursorem zostaje pod kursorem.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.tz = clamp(cam.tz * Math.exp(e.deltaY * 0.0012), ZOOM_MIN, ZOOM_MAX);
    const p = screenToWorld(e.clientX, e.clientY, 0, _wv);
    const a = cam.anchor;
    a.on = true; a.wx = p.x; a.wy = p.y;
    a.nx = (e.clientX / innerWidth) * 2 - 1; a.ny = -(e.clientY / innerHeight) * 2 + 1;
  }, { passive: false });

  function setNewFx(on) {
    S.newFx = on;
    const ab = $('ab');
    ab.className = on ? 'on' : 'off';
    ab.textContent = on ? 'T · Nowe efekty: WŁĄCZONE' : 'T · Jak dziś w grze (łaty trafień)';
    if (!DEBUG_FIELD) shield.setMode(on ? 'new' : 'ref');
  }
  $('ab').addEventListener('click', () => setNewFx(!S.newFx));

  function toggleShield() {
    setEntityShieldForcedOff(atlas, !atlas._shieldForcedOff);
    return !atlas._shieldForcedOff;
  }
  function breakShield() {
    atlas.shield.val = 0;
  }
  function fullCharge() {
    atlas.shield.val = atlas.shield.max;
  }

  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    S.keys.add(k);
    if (k === 'h') $('panel').classList.toggle('hidden');
    if (k === 't') setNewFx(!S.newFx);
    if (k === 'o') toggleShield();
    if (k === 'b') breakShield();
    if (k === 'r') fullCharge();
  });
  addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  const fieldToggle = $('c-field');
  fieldToggle.addEventListener('change', () => { shield.showField = fieldToggle.checked; });

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
  // Tarcza: HP (regeneracja po stronie dema, jak wołający w grze) i stany.

  // Kolejność jak w grze: najpierw stan (val = 0 → breaking), potem ładowanie —
  // regeneracja przed updateShieldFx podniosłaby HP z zera i pęknięcie by nie ruszyło.
  function updateShieldState(dt) {
    const sh = atlas.shield;
    updateShieldFx(atlas, dt);
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
    for (const e of enemies) {
      aimTurret(e.ship, atlas.x, -atlas.y);
      const p = shipPoint(e.ship, -700, 0, 10, _v);
      const g = e.ship.engine, s = e.ship.scale;
      lights.push(p.x, p.y, p.z, 900 * s, 220 * s, g[0] * 0.28, g[1] * 0.28, g[2] * 0.28);
    }

    updateShieldState(dt);
    shield.update(dt, S.time, S.pxPerUnit);

    lights.commit();
    shield.computeStep(dt);
    sky.fit(camera);
    pipeline.render();

    S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    if (timestamps && (S.frames % 8) === 0) {
      renderer.resolveTimestampsAsync('render').then((ms) => { if (Number.isFinite(ms)) S.gpuMs = ms; });
      renderer.resolveTimestampsAsync('compute').then((ms) => { if (Number.isFinite(ms)) S.gpuComputeMs = ms; });
    }
  }

  // Panel: HP i statystyki (4 razy na sekundę — tekst to jedyna alokacja poza startem).
  const hpFill = $('hpfill'), hpText = $('hptext');
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
    hpText.textContent = `tarcza: ${sh.state}${atlas._shieldForcedOff ? ' (wyłączona)' : ''} · HP ${Math.round(sh.val)} / ${sh.max} (${(life * 100).toFixed(0)}%)`;
    $('stats').textContent =
      `FPS              ${S.fps.toFixed(0)}\n` +
      `ms CPU (klatka)  ${S.cpuMs.toFixed(2)}\n` +
      `ms GPU           ${timestamps ? (S.gpuMs + S.gpuComputeMs).toFixed(2) + `  (compute ${S.gpuComputeMs.toFixed(2)})` : '—'}\n` +
      `siatka pola      ${shield.describeGrid()}\n` +
      `światła          ${lights.count} / 256`;
  }

  // -------------------------------------------------------------------------
  // Pętla. Pod ?test=1 pętla rAF three nadal chodzi (liczy klatki węzłów, bez
  // tego pass i bloom nie odświeżają się), ale klatka dema idzie TYLKO z step(n).

  let pendingSteps = 0;
  let stepDone = null;
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    if (pendingSteps > 0) {
      frame(1 / 60);
      pendingSteps--;
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
    frame(dt);
    updatePanel(now);
  });

  // Widok kontrolny: kamera prosto nad znacznikiem (bez paralaksy czaszy).
  if (DEBUG_FIELD) {
    const wp = shield.localToWorld(markerLocal.x, markerLocal.y, new THREE.Vector2());
    cam.x = wp.x; cam.y = -wp.y; cam.z = cam.tz = 1500;
    syncCamera();
  }
  setNewFx(!DEBUG_FIELD);
  if (!DEBUG_FIELD) shield.setMode('ref');

  window.__demo = {
    ready: true,
    S, cam, atlas, enemies, shield, renderer, scene, camera,
    step(n = 1) {
      return new Promise((resolve) => {
        pendingSteps = Math.max(1, n | 0);
        stepDone = resolve;
      });
    },
    hit: (x, y, dmg = 100, cls = 'main') => hitAt(x, y, dmg, cls),
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
        maxR: profile.maxR, minR: profile.minR, pad: profile.pad
      };
    }
  };
}

main().catch((e) => showError(`Start: ${e?.stack || e}`));
