import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createPirateStation } from '../space/pirateStation/pirateStationFactory.js';

const RENDER_SIZE = 1024;

const canvas2d = typeof document !== 'undefined' ? document.createElement('canvas') : null;
if (canvas2d) {
  canvas2d.width = RENDER_SIZE;
  canvas2d.height = RENDER_SIZE;
}
const ctx2d = canvas2d ? canvas2d.getContext('2d') : null;

let scene = null;
let camera = null;
let composer = null;
let bloomPass = null;
let renderPass = null;
let finalPass = null;
let rendererSize = { w: 0, h: 0 };

let ambientLight = null;
let hemiLight = null;
let dirLight = null;
let lightsAdded = false;

let pirateStation3D = null;
let pirateStation2D = null;
let lastRenderInfo = null;

function ensureScene() {
  if (!scene) {
    scene = new THREE.Scene();
    scene.background = null;
  }
  if (!lightsAdded && scene) {
    ambientLight = new THREE.AmbientLight(0x1a2535, 0.45);
    hemiLight = new THREE.HemisphereLight(0x6c8aff, 0x0a0e16, 0.82);
    dirLight = new THREE.DirectionalLight(0xffffff, 1.05);
    dirLight.position.set(80, 140, 60);
    scene.add(ambientLight);
    scene.add(hemiLight);
    scene.add(dirLight);
    if (dirLight.target) scene.add(dirLight.target);
    lightsAdded = true;
  }
}

function ensureCamera() {
  if (!camera) {
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000);
    camera.position.set(60, 28, 60);
    camera.lookAt(0, 0, 0);
  }
}

function getRenderer() {
  if (typeof window === 'undefined' || typeof window.getSharedRenderer !== 'function') {
    return null;
  }
  const r = window.getSharedRenderer(RENDER_SIZE, RENDER_SIZE);
  if (!r) return null;
  if (rendererSize.w !== RENDER_SIZE || rendererSize.h !== RENDER_SIZE) {
    r.setSize(RENDER_SIZE, RENDER_SIZE, false);
    rendererSize = { w: RENDER_SIZE, h: RENDER_SIZE };
  }
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.25;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0x000000, 0);
  return r;
}

function ensureComposer(renderer) {
  if (!renderer) {
    composer = null;
    return;
  }
  if (!composer) {
    composer = new EffectComposer(renderer);
    composer.setSize(RENDER_SIZE, RENDER_SIZE);
    renderPass = new RenderPass(scene, camera);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(RENDER_SIZE, RENDER_SIZE), 0.95, 0.45, 0.2);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    if (OutputPass) {
      finalPass = new OutputPass();
      composer.addPass(finalPass);
    }
  } else {
    composer.setSize(RENDER_SIZE, RENDER_SIZE);
    if (bloomPass) bloomPass.setSize(RENDER_SIZE, RENDER_SIZE);
  }
}

function updateCameraTarget() {
  if (!camera || !pirateStation3D) return;
  const target = pirateStation3D.object3d.position;
  const dist = Math.max(60, pirateStation3D.radius * 2.4);
  camera.position.set(target.x + dist, target.y + dist * 0.62, target.z + dist);
  camera.lookAt(target);
  if (dirLight) {
    dirLight.position.set(target.x + dist * 0.8, target.y + dist * 1.4, target.z - dist * 0.8);
    dirLight.target.position.set(target.x, target.y, target.z);
    dirLight.target.updateMatrixWorld();
  }
}

function renderScene(dt, t) {
  if (!scene || !camera || !pirateStation3D || !canvas2d || !ctx2d) return;
  const renderer = getRenderer();
  if (!renderer) return;
  ensureComposer(renderer);
  updateCameraTarget();
  if (pirateStation3D.update) pirateStation3D.update(t ?? 0, dt ?? 0);
  renderer.autoClear = true;
  if (composer) {
    renderer.autoClear = false;
    composer.render();
    renderer.autoClear = true;
  } else {
    renderer.render(scene, camera);
  }
  ctx2d.clearRect(0, 0, canvas2d.width, canvas2d.height);
  ctx2d.drawImage(renderer.domElement, 0, 0, canvas2d.width, canvas2d.height);
  lastRenderInfo = {
    canvas: canvas2d,
    radius: pirateStation3D.radius,
    world: pirateStation2D ? { x: pirateStation2D.x, y: pirateStation2D.y } : { x: 0, y: 0 }
  };
}

export function initWorld3D({ scene: externalScene } = {}) {
  if (externalScene) {
    scene = externalScene;
    lightsAdded = false;
  }
  ensureScene();
  ensureCamera();
  ensureScene();
  return { scene, camera, canvas: canvas2d };
}

export function attachPirateStation3D(sceneOverride, station2D) {
  if (pirateStation3D) return;
  if (sceneOverride) {
    scene = sceneOverride;
    lightsAdded = false;
    ensureScene();
  }
  ensureScene();
  ensureCamera();
  pirateStation3D = createPirateStation({ scale: 1.0 });
  pirateStation2D = station2D || null;
  pirateStation3D.object3d.position.set(station2D?.x || 0, 0, station2D?.y || 0);
  scene.add(pirateStation3D.object3d);
  updateCameraTarget();
}

export function dettachPirateStation3D(sceneOverride) {
  if (!pirateStation3D) return;
  const parentScene = sceneOverride || scene;
  if (parentScene && pirateStation3D.object3d.parent === parentScene) {
    parentScene.remove(pirateStation3D.object3d);
  }
  pirateStation3D.dispose();
  pirateStation3D = null;
  pirateStation2D = null;
  lastRenderInfo = null;
}

export function updateWorld3D(dt, t) {
  if (!pirateStation3D) return;
  renderScene(dt, t);
}

export function drawWorld3D(ctx, cam, worldToScreen) {
  if (!lastRenderInfo || !pirateStation2D || typeof worldToScreen !== 'function') return;
  if (!lastRenderInfo.canvas) return;
  const screen = worldToScreen(lastRenderInfo.world.x, lastRenderInfo.world.y, cam);
  const sizeWorld = lastRenderInfo.radius * 2;
  const sizePx = sizeWorld * (cam?.zoom ?? 1);
  const offsetY = sizePx * 0.55;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(lastRenderInfo.canvas, screen.x - sizePx / 2, screen.y - offsetY, sizePx, sizePx);
  ctx.restore();
}

export function getPirateStationSprite() {
  return lastRenderInfo;
}
