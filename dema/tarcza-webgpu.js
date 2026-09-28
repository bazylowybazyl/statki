// ============================================================
// Demo WebGPU: tarcza nowej generacji na kadłubie Atlasa.
// Strona: dema/tarcza-webgpu.html (Vite, `npm run dev`).
//
// Klatka: wejście → kamera → broń i pociski (gameplay 2D jak w grze) →
// stany tarcz (updateShieldFx z shieldSystem.js) → zdarzenia pola → światła →
// compute (pole, iskry, odłamki) → render (pass → bloom → tone mapping).
// ============================================================
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { uTime, uDt, lights, BLOOM_GAME, clamp } from './tarcza-webgpu/wspolne.js';
import { createSky } from './tarcza-webgpu/tlo.js';
import { loadAtlasSprite, createAtlasHullMesh } from './tarcza-webgpu/kadlub.js';
import { buildShip, placeShip, aimTurret, shipPoint } from './tarcza-webgpu/wrogowie.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const DEBUG = params.get('debug') || '';

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
  const cam = { x: 0, y: 300, z: 5200, tz: 5200, anchor: null };
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
  const atlas = {
    x: 0, y: 0, angle: Number(params.get('kat')) || 0, type: 'atlas',
    visual: { spriteScale: sprite.scale },
    hexGrid: { shards: sprite.shards, srcWidth: sprite.W, srcHeight: sprite.H }
  };
  // Grupa w klatce lokalnej 3D: pozycja (x, −y), obrót −kąt (jak Core3D).
  const atlasGroup = new THREE.Group();
  atlasGroup.position.set(atlas.x, -atlas.y, 0);
  atlasGroup.rotation.z = -atlas.angle;
  scene.add(atlasGroup);
  const atlasHull = createAtlasHullMesh(sprite);
  atlasGroup.add(atlasHull.mesh);
  atlasGroup.updateMatrixWorld(true);

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
    time: 0, frames: 0, fps: 60, cpuMs: 0, gpuMs: 0, gpuComputeMs: 0,
    keys: new Set(), mouse: { x: innerWidth / 2, y: innerHeight / 2, inside: false },
    aim: new THREE.Vector3(), bloom: true, bloomStrength: BLOOM_GAME.strength
  };

  const _ndc = new THREE.Vector2();
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

  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => { S.mouse.x = e.clientX; S.mouse.y = e.clientY; S.aimLock = false; });
  // Zoom do kursora: punkt świata pod kursorem zostaje pod kursorem.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.tz = clamp(cam.tz * Math.exp(e.deltaY * 0.0012), ZOOM_MIN, ZOOM_MAX);
    const p = screenToWorld(e.clientX, e.clientY, 0, new THREE.Vector3());
    cam.anchor = { wx: p.x, wy: p.y, nx: (e.clientX / innerWidth) * 2 - 1, ny: -(e.clientY / innerHeight) * 2 + 1 };
  }, { passive: false });
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    S.keys.add(k);
    if (k === 'h') $('panel').classList.toggle('hidden');
  });
  addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  function updateCamera(dt) {
    const pan = 1300 * dt * (cam.z / 3600);
    let moved = false;
    if (S.keys.has('w') || S.keys.has('arrowup')) { cam.y += pan; moved = true; }
    if (S.keys.has('s') || S.keys.has('arrowdown')) { cam.y -= pan; moved = true; }
    if (S.keys.has('a') || S.keys.has('arrowleft')) { cam.x -= pan; moved = true; }
    if (S.keys.has('d') || S.keys.has('arrowright')) { cam.x += pan; moved = true; }
    if (moved) cam.anchor = null;
    cam.z += (cam.tz - cam.z) * Math.min(1, dt * 8);
    if (cam.anchor) {
      const a = cam.anchor;
      cam.x = a.wx - a.nx * cam.z * TAN_H * camera.aspect;
      cam.y = a.wy - a.ny * cam.z * TAN_H;
      if (Math.abs(cam.tz - cam.z) < 0.5) cam.anchor = null;
    }
    syncCamera();
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

    lights.commit();
    sky.fit(camera);
    pipeline.render();

    S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    if (timestamps && (S.frames % 8) === 0) {
      renderer.resolveTimestampsAsync('render').then((ms) => { if (Number.isFinite(ms)) S.gpuMs = ms; });
      renderer.resolveTimestampsAsync('compute').then((ms) => { if (Number.isFinite(ms)) S.gpuComputeMs = ms; });
    }
  }

  // Statystyki (4 razy na sekundę — tekst panelu to jedyna alokacja poza startem).
  let statsAt = 0, fpsFrames = 0, fpsT = performance.now();
  function updateStats(now) {
    fpsFrames++;
    if (now - statsAt < 250) return;
    S.fps = fpsFrames * 1000 / Math.max(1, now - fpsT);
    fpsFrames = 0; fpsT = now; statsAt = now;
    $('stats').textContent =
      `FPS              ${S.fps.toFixed(0)}\n` +
      `ms CPU (klatka)  ${S.cpuMs.toFixed(2)}\n` +
      `ms GPU           ${timestamps ? (S.gpuMs + S.gpuComputeMs).toFixed(2) + `  (compute ${S.gpuComputeMs.toFixed(2)})` : '—'}\n` +
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
      return;
    }
    if (TEST) return;
    const dt = clamp((now - last) / 1000, 0.001, 0.05);
    last = now;
    frame(dt);
    updateStats(now);
  });

  window.__demo = {
    ready: true,
    S, cam, atlas, enemies, renderer, scene, camera,
    step(n = 1) {
      return new Promise((resolve) => {
        pendingSteps = Math.max(1, n | 0);
        stepDone = resolve;
      });
    },
    lookAt(x, y, zoom) {
      cam.x = x; cam.y = -y; cam.anchor = null;
      if (zoom) cam.tz = cam.z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
      syncCamera();
    },
    stats() {
      return { fps: S.fps, cpuMs: S.cpuMs, gpuMs: S.gpuMs, gpuComputeMs: S.gpuComputeMs, lights: lights.count };
    }
  };
}

main().catch((e) => showError(`Start: ${e?.stack || e}`));
