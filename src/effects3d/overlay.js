import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// Shader naprawiający alfę, ale z podbiciem intensywności ("punch")
const RestoreAlphaShader = {
  uniforms: {
    'tDiffuse': { value: null }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D( tDiffuse, vUv );
      
      // Obliczamy jasność piksela
      float brightness = max(tex.r, max(tex.g, tex.b));
      
      // FIX: Podbijamy alfę (mnożnik 1.5), żeby słabsze poświaty (glow) 
      // nie były zbyt przezroczyste i nie znikały na tle gry.
      float alpha = min(1.0, brightness * 1.5);
      
      gl_FragColor = vec4( tex.rgb, alpha );
    }
  `
};

export function initOverlay({ host, getView }) {
  if (!host) {
    throw new Error("initOverlay: host element is required");
  }

  // 1. Renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true, 
    premultipliedAlpha: false,
    powerPreference: "high-performance"
  });
  
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.setClearColor(0x000000, 0);
  
  // Ważne: Tone Mapping musi być taki sam jak w źródle, żeby kolory nie były wyprane
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0; // Wartość 1.0 jest bardziej naturalna dla neonów

  const dom = renderer.domElement;
  dom.classList.add("overlay3d");
  dom.style.pointerEvents = "none";
  dom.style.position = "absolute";
  dom.style.inset = "0";
  dom.style.zIndex = "20"; 
  dom.style.background = "transparent";
  
  // --- KLUCZOWA ZMIANA WIZUALNA ---
  // Tryb mieszania 'screen' sprawia, że overlay zachowuje się jak światło.
  // Czarne tło staje się niewidoczne, a kolory dodają się do tła gry.
  dom.style.mixBlendMode = "screen"; 

  host.appendChild(dom);

  const scene = new THREE.Scene();
  scene.background = null; 

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 120, 0);
  camera.lookAt(0, 0, 0);

  // 2. RenderTarget (RGBA + Float dla lepszego HDR)
  const renderTarget = new THREE.WebGLRenderTarget(
    host.clientWidth * renderer.getPixelRatio(),
    host.clientHeight * renderer.getPixelRatio(),
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      stencilBuffer: false,
      depthBuffer: true
    }
  );

  const composer = new EffectComposer(renderer, renderTarget);
  
  // Pass 1: Scena
  const renderPass = new RenderPass(scene, camera);
  renderPass.clearColor = new THREE.Color(0, 0, 0);
  renderPass.clearAlpha = 0; 
  composer.addPass(renderPass);

  // Pass 2: Bloom (Parametry ze źródła reactorblow.js)
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(host.clientWidth, host.clientHeight), 
    2.5,  // Strength: Wysoka wartość dla efektu neonu
    0.5,  // Radius: 0.5 (jak w oryginale) - daje szerszą poświatę
    0.1   // Threshold: 0.1 (jak w oryginale) - pozwala świecić ciemniejszym elementom
  );
  composer.addPass(bloomPass);

  // Pass 3: Naprawa Alfy (żeby tło zniknęło, a glow został)
  const alphaPass = new ShaderPass(RestoreAlphaShader);
  composer.addPass(alphaPass);

  const effects = [];
  let lastSizeW = host.clientWidth;
  let lastSizeH = host.clientHeight;

  function syncCamera() {
    if (!getView) return;
    const view = getView();
    if (!view) return;

    const viewport = view.viewport || {};
    const w = viewport.w ?? host.clientWidth;
    const h = viewport.h ?? host.clientHeight;
    const zoom = view.zoom ?? 1;
    const scale = zoom || 1;
    const halfW = w / (2 * scale);
    const halfH = h / (2 * scale);

    if (camera.left !== -halfW || camera.right !== halfW || camera.top !== halfH || camera.bottom !== -halfH) {
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.updateProjectionMatrix();
    }

    const center = view.center || {};
    const cx = center.x ?? 0;
    const cz = center.y ?? 0;

    if (camera.position.x !== cx || camera.position.z !== cz) {
      camera.position.set(cx, camera.position.y, cz);
      camera.lookAt(cx, 0, cz);
    }

    if (lastSizeW !== w || lastSizeH !== h) {
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      lastSizeW = w;
      lastSizeH = h;
    }
  }

  function tick(dt) {
    syncCamera();

    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i];
      if (fx.update) {
        fx.update(dt);
      }
      if (!fx.group || !fx.group.parent) {
        effects.splice(i, 1);
      }
    }

    // Czyścimy renderer do zera przed rysowaniem composera
    renderer.clear();
    composer.render();
  }

  function spawn(effect) {
    if (!effect) return;
    if (effect.group) {
        scene.add(effect.group);
        effects.push(effect);
    }
  }

  function resize() {
    syncCamera();
  }

  function dispose() {
    effects.length = 0;
    if (dom.parentElement === host) {
      host.removeChild(dom);
    }
    composer.dispose();
    renderer.dispose();
    renderTarget.dispose();
  }

  return { scene, camera, renderer, composer, tick, spawn, resize, dispose };
}