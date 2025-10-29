import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
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
let preserveAlphaPass = null;
let localRenderer = null;
let maskRT = null;

const maskMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 1.0,
  depthWrite: true
});

let ambientLight = null;
let hemiLight = null;
let dirLight = null;
let lightsAdded = false;

let pirateStation3D = null;
let pirateStation2D = null;
let lastRenderInfo = null;
let initialRadius = null;
const fallbackCameraTarget = new THREE.Vector3();
const lastCameraState = { x: 0, y: 0, zoom: 1 };
let hasCameraState = false;

function isWorldOverlayEnabled() {
  if (typeof window === 'undefined') return true;
  // Domyślnie ON; aby wyłączyć globalnie:
  // window.USE_WORLD3D_OVERLAY = false
  return window.USE_WORLD3D_OVERLAY !== false;
}

function resetRendererState2D(ctx){
  if (!ctx) return;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function resetRendererState(renderer, width, height) {
  if (!renderer) return;
  if (typeof renderer.setRenderTarget === 'function') renderer.setRenderTarget(null);
  if (typeof renderer.setPixelRatio === 'function') renderer.setPixelRatio(1);
  if (typeof renderer.setSize === 'function') renderer.setSize(width, height, false);
  if (typeof renderer.setViewport === 'function') renderer.setViewport(0, 0, width, height);
  if (renderer.state && typeof renderer.state.reset === 'function') renderer.state.reset();
  if (typeof renderer.setScissorTest === 'function') renderer.setScissorTest(false);
  if (typeof renderer.setClearColor === 'function') renderer.setClearColor(0x000000, 0);
  if (typeof renderer.clear === 'function') renderer.clear(true, true, false);
}

function rendererHasAlpha(r) {
  try {
    const gl = r.getContext && r.getContext();
    const attrs = gl && gl.getContextAttributes && gl.getContextAttributes();
    return !!(attrs && attrs.alpha);
  } catch {
    return false;
  }
}

function updateSunLightForPlanet(dirLightInstance, planet, sun){
  if (!dirLightInstance || !planet || !sun) return;
  const dx = (sun.x ?? 0) - (planet.x ?? 0);
  const dy = (sun.y ?? 0) - (planet.y ?? 0);
  const L = Math.hypot(dx, dy) || 1;
  dirLightInstance.position.set(dx / L, -dy / L, 0.001);
}

const PreserveAlphaOutputShader = {
  name: 'PreserveAlphaOutputShader',
  uniforms: {
    tDiffuse: { value: null },
    tMask: { value: null }
  },
  vertexShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse; // kolor po bloomie (linear)
    uniform sampler2D tMask;    // maska alfa sceny bez post FX
    varying vec2 vUv;

    // --- lokalny enkoder sRGB (unikalne nazwy, zero kolizji) ---
    vec3 _srgbEncode3( in vec3 linearRGB ) {
      vec3 cutoff = step( vec3(0.0031308), linearRGB );
      vec3 lower  = 12.92 * linearRGB;
      vec3 higher = 1.055 * pow( linearRGB, vec3(1.0/2.4) ) - 0.055;
      return mix( lower, higher, cutoff );
    }
    vec4 _srgbEncode4( in vec4 linearRGBA ) {
      return vec4( _srgbEncode3( linearRGBA.rgb ), linearRGBA.a );
    }

    void main() {
      vec3  colorPost = texture2D( tDiffuse, vUv ).rgb; // linear RGB po bloomie
      float a         = texture2D( tMask,    vUv ).r;   // alfa z maski

      // premultiply w przestrzeni liniowej
      vec4 outLinear = vec4( colorPost * a, a );

      // enkodowanie do sRGB DOPIERO po premultiply
      #ifdef SRGB_COLOR_SPACE
        outLinear = _srgbEncode4( outLinear );
      #endif

      gl_FragColor = outLinear; // premultiplied RGBA
    }
  `
};

function createPreserveAlphaOutputPass() {
  const p = new ShaderPass(PreserveAlphaOutputShader);
  if (p.material) {
    p.material.toneMapped = false;
    p.material.transparent = false;           // bez domyślnego alpha-blend
    p.material.blending    = THREE.NoBlending; // nadpisanie 1:1
    p.material.depthTest   = false;
    p.material.depthWrite  = false;
  }
  return p;
}

function updatePreserveAlphaOutputPass(renderer) {
  if (!preserveAlphaPass || !renderer) return;

  const material = preserveAlphaPass.material;
  const defines = material.defines || (material.defines = {});
  let needsUpdate = false;

  if (preserveAlphaPass._outputColorSpace !== renderer.outputColorSpace) {
    preserveAlphaPass._outputColorSpace = renderer.outputColorSpace;
    if (renderer.outputColorSpace === THREE.SRGBColorSpace) {
      defines.SRGB_COLOR_SPACE = '';
    } else {
      delete defines.SRGB_COLOR_SPACE;
    }
    needsUpdate = true;
  }

  if (needsUpdate) {
    material.needsUpdate = true;
  }
}

function ensureMaskRT(renderer) {
  if (!renderer) return;
  if (!maskRT) {
    maskRT = new THREE.WebGLRenderTarget(RENDER_SIZE, RENDER_SIZE, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false
    });
    maskRT.texture.name = 'world3d.alphaMask';
    maskRT.texture.generateMipmaps = false;
  }
}

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
    if (dirLight.target) {
      dirLight.target.position.set(0, 0, 0);
      scene.add(dirLight.target);
    }
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
  const r = (typeof window !== 'undefined' && typeof window.getSharedRenderer === 'function')
    ? window.getSharedRenderer(RENDER_SIZE, RENDER_SIZE)
    : null;

  if (r && rendererHasAlpha(r)) {
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.25;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setClearColor(0x000000, 0);
    return r;
  }

  if (!localRenderer) {
    localRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    });
    localRenderer.setPixelRatio(1);
    localRenderer.setSize(RENDER_SIZE, RENDER_SIZE, false);
    localRenderer.outputColorSpace = THREE.SRGBColorSpace;
    localRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    localRenderer.toneMappingExposure = 1.25;
    localRenderer.setClearColor(0x000000, 0);
  }
  return localRenderer;
}

function ensureComposer(renderer) {
  if (!renderer) {
    composer = null;
    if (maskRT) {
      maskRT.dispose();
      maskRT = null;
    }
    if (preserveAlphaPass) {
      preserveAlphaPass.uniforms.tMask.value = null;
    }
    return;
  }
  if (!composer) {
    const rt = new THREE.WebGLRenderTarget(RENDER_SIZE, RENDER_SIZE, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false
    });
    composer = new EffectComposer(renderer, rt);
    composer.setSize(RENDER_SIZE, RENDER_SIZE);
    renderPass = new RenderPass(scene, camera);
    renderPass.clear = true;
    renderPass.clearAlpha = 0;
    bloomPass = new UnrealBloomPass(new THREE.Vector2(RENDER_SIZE, RENDER_SIZE), 0.95, 0.45, 0.2);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    preserveAlphaPass = createPreserveAlphaOutputPass();
    preserveAlphaPass.renderToScreen = true;
    composer.addPass(preserveAlphaPass);
    updatePreserveAlphaOutputPass(renderer);
  } else {
    composer.setSize(RENDER_SIZE, RENDER_SIZE);
    if (bloomPass) bloomPass.setSize(RENDER_SIZE, RENDER_SIZE);
    if (preserveAlphaPass?.setSize) preserveAlphaPass.setSize(RENDER_SIZE, RENDER_SIZE);
  }
}

function updateCameraTarget() {
  if (!camera) return;
  if (pirateStation3D) {
    const target = pirateStation3D.object3d.position;
    const dist = Math.max(60, pirateStation3D.radius * 2.4);
    camera.position.set(target.x + dist, target.y + dist * 0.62, target.z + dist);
    camera.lookAt(target);
    return;
  }
  if (!hasCameraState) return;
  const target = fallbackCameraTarget;
  target.set(lastCameraState.x || 0, 0, lastCameraState.y || 0);
  const zoom = Math.max(0.0001, lastCameraState.zoom || 1);
  const baseRadius = initialRadius || 120;
  const dist = Math.max(60, baseRadius * 2.0 / zoom);
  camera.position.set(target.x + dist, target.y + dist * 0.62, target.z + dist);
  camera.lookAt(target);
}

function renderScene(dt, t, rendererOverride) {
  if (!scene || !camera || !canvas2d || !ctx2d) return;
  const renderer = rendererOverride || getRenderer();
  if (!renderer) {
    ensureComposer(null);
    return;
  }
  resetRendererState(renderer, RENDER_SIZE, RENDER_SIZE);
  ensureComposer(renderer);
  ensureMaskRT(renderer);
  updatePreserveAlphaOutputPass(renderer);
  updateCameraTarget();
  if (dirLight) {
    const sun = (typeof window !== 'undefined' ? window.SUN : null) || null;
    if (sun) {
      // planetRef = piracka stacja albo punkt kamery w widoku planetarnym
      const planetRef = pirateStation2D || { x: lastCameraState.x || 0, y: lastCameraState.y || 0 };
      updateSunLightForPlanet(dirLight, planetRef, sun);
      if (dirLight.target) dirLight.target.updateMatrixWorld();
    }
  }
  if (pirateStation3D?.update) pirateStation3D.update(t ?? 0, dt ?? 0);
  renderer.setClearColor(0x000000, 0);
  if (renderer.setClearAlpha) renderer.setClearAlpha(0);
  if (composer) {
    const prevAutoClear = renderer.autoClear;
    const prevTarget = renderer.getRenderTarget ? renderer.getRenderTarget() : null;
    const prevOverride = scene.overrideMaterial;
    renderer.autoClear = true;
    scene.overrideMaterial = maskMaterial;
    renderer.setRenderTarget(maskRT);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(prevTarget || null);
    if (preserveAlphaPass?.uniforms?.tMask) {
      preserveAlphaPass.uniforms.tMask.value = maskRT ? maskRT.texture : null;
    }
    renderer.autoClear = false;
    composer.render();
    renderer.autoClear = prevAutoClear;
  } else {
    renderer.render(scene, camera);
  }
  ctx2d.clearRect(0, 0, canvas2d.width, canvas2d.height);
  ctx2d.drawImage(renderer.domElement, 0, 0, canvas2d.width, canvas2d.height);
  if (canvas2d) {
    if (pirateStation3D && pirateStation2D) {
      lastRenderInfo = {
        canvas: canvas2d,
        radius: pirateStation3D.radius,
        world: { x: pirateStation2D.x, y: pirateStation2D.y }
      };
    } else {
      // Tryb ogólny (bez pirackiej) – kotwiczymy na pozycji kamery
      const baseRadius = initialRadius || 120;
      lastRenderInfo = {
        canvas: canvas2d,
        radius: baseRadius,
        world: { x: lastCameraState.x || 0, y: lastCameraState.y || 0 }
      };
    }
  }
}

export function initWorld3D({ scene: externalScene } = {}) {
  if (externalScene) {
    scene = externalScene;
    lightsAdded = false;
  }
  ensureScene();
  ensureCamera();
  const renderer = getRenderer();
  if (renderer) {
    ensureComposer(renderer);
    ensureMaskRT(renderer);
    updatePreserveAlphaOutputPass(renderer);
  } else {
    ensureComposer(null);
  }
  return { scene, camera, composer, renderer, canvas: canvas2d };
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
  pirateStation3D = createPirateStation({ worldRadius: 120 });
  pirateStation2D = station2D || null;
  pirateStation3D.object3d.position.set(station2D?.x || 0, 0, station2D?.y || 0);
  scene.add(pirateStation3D.object3d);
  initialRadius = pirateStation3D.radius;
  // Domyślna skala ×6 przed ustawieniem kamery:
  setPirateStationScale(6);
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
  initialRadius = null;
}

export function updateWorld3D(dt, t) {
  const resources = initWorld3D();
  renderScene(dt, t, resources?.renderer || null);
}

export function drawWorld3D(ctx, cam, worldToScreen) {
  initWorld3D();
  if (!isWorldOverlayEnabled()) return;
  if (cam) {
    let updated = false;
    if (Number.isFinite(cam.x) && Number.isFinite(cam.y)) {
      lastCameraState.x = cam.x;
      lastCameraState.y = cam.y;
      updated = true;
    }
    if (Number.isFinite(cam.zoom)) {
      lastCameraState.zoom = cam.zoom;
      updated = true;
    }
    if (updated) hasCameraState = true;
  }
  if (camera) {
    const zoom = Math.max(0.0001, Number.isFinite(lastCameraState.zoom) ? lastCameraState.zoom : 1);
    if (camera.zoom !== zoom) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
  }
  updateCameraTarget();
  if (!lastRenderInfo || typeof worldToScreen !== 'function') return;
  if (!lastRenderInfo.canvas) return;
  const center = worldToScreen(lastRenderInfo.world.x, lastRenderInfo.world.y, cam);
  const sizePx = Math.max(ctx.canvas.width, ctx.canvas.height);
  const x = center.x - sizePx / 2;
  const y = center.y - sizePx / 2;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(lastRenderInfo.canvas, x, y, sizePx, sizePx);
  resetRendererState2D(ctx);
}

export function getPirateStationSprite() {
  return lastRenderInfo;
}

export function setPirateStationScale(s) {
  if (!pirateStation3D || !initialRadius) return;
  const k = Number(s);
  if (!Number.isFinite(k) || k <= 0) return;
  pirateStation3D.object3d.scale.setScalar(k);
  pirateStation3D.radius = initialRadius * k;
  updateCameraTarget();
}

export function setPirateStationWorldRadius(r) {
  if (!pirateStation3D || !initialRadius) return;
  const R = Number(r);
  if (!Number.isFinite(R) || R <= 0) return;
  const k = R / initialRadius;
  setPirateStationScale(k);
}

if (typeof window !== 'undefined') {
  window.__setStation3DScale = setPirateStationScale;
  window.__setStation3DWorldRadius = setPirateStationWorldRadius;
}
