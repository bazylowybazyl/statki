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

  function getOverlayBloomConfig() {
    const bloom = (typeof window !== 'undefined' && window.DevVFX?.bloom) ? window.DevVFX.bloom : null;
    return {
      strength: Math.max(0, Number.isFinite(Number(bloom?.overlayStrength)) ? Number(bloom.overlayStrength) : 2.5),
      radius: Math.max(0, Number.isFinite(Number(bloom?.overlayRadius)) ? Number(bloom.overlayRadius) : 0.5),
      threshold: Math.max(0, Number.isFinite(Number(bloom?.overlayThreshold)) ? Number(bloom.overlayThreshold) : 0.1)
    };
  }

  function applyOverlayBloomConfig() {
    const cfg = getOverlayBloomConfig();
    bloomPass.strength = cfg.strength;
    bloomPass.radius = cfg.radius;
    bloomPass.threshold = cfg.threshold;
    return cfg;
  }

  // 1. Renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true, 
    premultipliedAlpha: false,
    powerPreference: "high-performance"
  });
  
  renderer.setPixelRatio(Math.min(1.2, window.devicePixelRatio || 1));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.setClearColor(0x000000, 0);
  
  // Overlay uzywa CSS mix-blend-mode: screen — nie stosujemy tonemappingu
  // (kompresowałby jasnosc efektow addytywnych). Kolory w linear space.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

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
  let renderScale = 0.8;
  const initialBloom = getOverlayBloomConfig();
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(
      Math.max(1, Math.floor(host.clientWidth * renderScale)),
      Math.max(1, Math.floor(host.clientHeight * renderScale))
    ),
    initialBloom.strength,
    initialBloom.radius,
    initialBloom.threshold
  );
  composer.addPass(bloomPass);

  // Pass 3: Naprawa Alfy (żeby tło zniknęło, a glow został)
  const alphaPass = new ShaderPass(RestoreAlphaShader);
  composer.addPass(alphaPass);

  const effects = [];
  const stats = {
    activeEffects: 0,
    droppedEffects: 0,
    lastRenderMs: 0,
    maxEffects: 72,
    renderScale,
    bloomEnabled: true,
    frameSkip: 1,
    updateSkip: 1,
    skippedFrames: 0
  };
  const perf = {
    frameSkip: 1,
    skipCursor: 0,
    updateSkip: 1,
    updateCursor: 0,
    accumDt: 0
  };
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
      composer.setSize(
        Math.max(1, Math.floor(w * renderScale)),
        Math.max(1, Math.floor(h * renderScale))
      );
      lastSizeW = w;
      lastSizeH = h;
    }
  }

  function applyAdaptiveQuality() {
    const active = effects.length;
    const prevRenderMs = Number(stats.lastRenderMs) || 0;
    const pressure = Math.max(active / 70, prevRenderMs / 6.5);

    let targetScale = 0.84;
    let targetFrameSkip = 1;
    let targetUpdateSkip = 1;
    let targetBloom = true;
    let targetMaxEffects = 96;

    if (pressure > 2.6) {
      targetScale = 0.34;
      targetFrameSkip = 4;
      targetUpdateSkip = 4;
      targetBloom = false;
      targetMaxEffects = 40;
    } else if (pressure > 1.9) {
      targetScale = 0.42;
      targetFrameSkip = 3;
      targetUpdateSkip = 3;
      targetBloom = false;
      targetMaxEffects = 52;
    } else if (pressure > 1.4) {
      targetScale = 0.5;
      targetFrameSkip = 2;
      targetUpdateSkip = 2;
      targetBloom = false;
      targetMaxEffects = 62;
    } else if (pressure > 1.0) {
      targetScale = 0.58;
      targetFrameSkip = 2;
      targetUpdateSkip = 2;
      targetBloom = false;
      targetMaxEffects = 72;
    } else if (pressure > 0.72) {
      targetScale = 0.68;
      targetFrameSkip = 2;
      targetUpdateSkip = 1;
      targetBloom = false;
      targetMaxEffects = 82;
    } else if (pressure > 0.45) {
      targetScale = 0.76;
      targetFrameSkip = 1;
      targetUpdateSkip = 1;
      targetBloom = true;
      targetMaxEffects = 92;
    }

    if (effects.length > targetMaxEffects) {
      const overflow = effects.length - targetMaxEffects;
      for (let i = 0; i < overflow; i++) {
        const fx = effects.pop();
        if (!fx) break;
        if (fx.group?.parent) fx.group.parent.remove(fx.group);
        if (typeof fx.dispose === "function") fx.dispose();
      }
      stats.droppedEffects += overflow;
    }

    if (Math.abs(targetScale - renderScale) > 0.01) {
      renderScale = targetScale;
      composer.setSize(
        Math.max(1, Math.floor(lastSizeW * renderScale)),
        Math.max(1, Math.floor(lastSizeH * renderScale))
      );
    }
    perf.frameSkip = targetFrameSkip;
    perf.updateSkip = targetUpdateSkip;
    stats.maxEffects = targetMaxEffects;
    if (bloomPass.enabled !== targetBloom) bloomPass.enabled = targetBloom;
    stats.renderScale = renderScale;
    stats.bloomEnabled = bloomPass.enabled;
    stats.frameSkip = perf.frameSkip;
    stats.updateSkip = perf.updateSkip;
  }

  function tick(dt) {
    syncCamera();
    applyAdaptiveQuality();
    applyOverlayBloomConfig();

    // GPU spark system — always update time, even when effects are skipped
    if (typeof window !== 'undefined' && window.SparkSystem3D?.isInitialized) {
      window.SparkSystem3D.update(dt);
    }

    let updateNow = true;
    let stepDt = dt;
    if (perf.updateSkip > 1) {
      perf.accumDt += dt;
      perf.updateCursor = (perf.updateCursor + 1) % perf.updateSkip;
      updateNow = perf.updateCursor === 0;
      if (updateNow) {
        stepDt = perf.accumDt;
        perf.accumDt = 0;
      }
    }

    if (updateNow) {
      for (let i = effects.length - 1; i >= 0; i--) {
        const fx = effects[i];
        if (fx.update) {
          fx.update(stepDt);
        }
        if (!fx.group || !fx.group.parent) {
          effects.splice(i, 1);
        }
      }
    }

    // Czyścimy renderer do zera przed rysowaniem composera
    stats.activeEffects = effects.length;
    const hasPersistentSceneContent = scene.children.length > 0;
    if (effects.length === 0 && !hasPersistentSceneContent) {
      renderer.clear();
      stats.lastRenderMs = 0;
      perf.accumDt = 0;
      return;
    }
    perf.skipCursor = (perf.skipCursor + 1) % perf.frameSkip;
    if (perf.skipCursor !== 0) {
      stats.skippedFrames += 1;
      return;
    }

    renderer.clear();
    const t0 = (typeof performance !== "undefined") ? performance.now() : 0;
    composer.render();
    stats.lastRenderMs = (t0 > 0) ? (performance.now() - t0) : 0;
  }

  function spawn(effect) {
    if (!effect) return;
    if (effects.length >= stats.maxEffects) {
      stats.droppedEffects += 1;
      if (typeof effect.dispose === "function") effect.dispose();
      return;
    }
    if (effect.group) {
        scene.add(effect.group);
        effects.push(effect);
        stats.activeEffects = effects.length;
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

  function getStats() {
    return { ...stats };
  }

  return {
    scene, camera, renderer, composer, tick, spawn, resize, dispose, getStats,
    getBloomConfig: () => ({ ...getOverlayBloomConfig() }),
    setBloomConfig: (next = {}) => {
      const devVfx = (window.DevVFX = window.DevVFX || {});
      const bloom = (devVfx.bloom = Object.assign({}, devVfx.bloom || {}));
      if (next && typeof next === "object") {
        if (next.strength != null) bloom.overlayStrength = Number(next.strength);
        if (next.radius != null) bloom.overlayRadius = Number(next.radius);
        if (next.threshold != null) bloom.overlayThreshold = Number(next.threshold);
      }
      return applyOverlayBloomConfig();
    }
  };
}
