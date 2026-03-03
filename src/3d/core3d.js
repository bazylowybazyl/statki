import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// --- SHADER DO ZACHOWANIA PRZEZROCZYSTOSCI ---
const PreserveAlphaOutputShader = {
  name: 'PreserveAlphaOutputShader',
  uniforms: {
    tDiffuse: { value: null }
  },
  vertexShader: `
    precision highp float;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    void main() {
      vec4 texColor = texture2D(tDiffuse, vUv);
      float a = texColor.a;
      gl_FragColor = vec4(texColor.rgb * a, a);
    }
  `
};

const MAX_HEAT_HAZE_SOURCES = 24;

function createHeatHazeShader(maxSources = MAX_HEAT_HAZE_SOURCES) {
  return {
    name: 'EngineHeatHazeShader',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uSourceCount: { value: 0 },
      uGlobalStrength: { value: 1.0 },
      uHeatSources: { value: Array.from({ length: maxSources }, () => new THREE.Vector4(2, 2, 0, 0)) }
    },
    vertexShader: `
      precision highp float;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform int uSourceCount;
      uniform float uGlobalStrength;
      uniform vec4 uHeatSources[${maxSources}];
      varying vec2 vUv;

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash12(i);
        float b = hash12(i + vec2(1.0, 0.0));
        float c = hash12(i + vec2(0.0, 1.0));
        float d = hash12(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      void main() {
        vec2 uv = vUv;
        vec2 distortion = vec2(0.0);

        for (int i = 0; i < ${maxSources}; i++) {
          if (i >= uSourceCount) break;
          vec4 src = uHeatSources[i];
          vec2 toUv = uv - src.xy;
          float dist = length(toUv);
          float radius = max(0.0001, src.z);
          if (dist >= radius) continue;

          float t = clamp(dist / radius, 0.0, 1.0);
          float rim = smoothstep(1.0, 0.15, t);
          float centerSuppress = smoothstep(0.03, 0.22, t);
          float amp = src.w * rim * centerSuppress * uGlobalStrength;

          vec2 dir = (dist > 0.00001) ? (toUv / dist) : vec2(0.0, 1.0);
          vec2 perp = vec2(-dir.y, dir.x);

          float n = noise(vec2(
            uv.x * 220.0 + float(i) * 17.0 + uTime * 6.0,
            uv.y * 180.0 - float(i) * 9.0 - uTime * 4.2
          ));
          float wave = sin((t * 18.0) - (uTime * 10.0) + float(i) * 1.31);

          vec2 local = dir * ((n - 0.5) * 0.0018) + perp * (wave * 0.0012);
          distortion += local * amp;
        }

        distortion = clamp(distortion, vec2(-0.008), vec2(0.008));
        gl_FragColor = texture2D(tDiffuse, uv + distortion);
      }
    `
  };
}

export const Core3D = {
  canvas: null,
  renderer: null,
  scene: null,
  cameraOrtho: null, 
  cameraPersp: null, 
  shadowCatcher: null,
  shadowCatcherFg: null,
  shadowCatchersDebug: false,
  composer: null,
  composerTarget: null,
  renderPassBg: null,
  renderPassOrtho: null,
  renderPassFg: null,
  heatHazePass: null,
  heatHazeSources: null,
  heatHazeCount: 0,
  heatHazeMaxSources: MAX_HEAT_HAZE_SOURCES,
  _heatHazeWorldScratch: new THREE.Vector3(),
  bloomPass: null,
  outputPass: null,
  bloomResolutionScale: 1,
  bloomBaseStrength: 0.35,
  bloomBaseThreshold: 0.95,
  msaaSamples: 0,
  perfToggles: {
    bloom: true,
    heatHaze: true,
    bgPass: true,
    orthoPass: true,
    fgPass: true
  },
  pixelRatio: 1,
  width: 0,
  height: 0,
  isInitialized: false,

  init(canvasElement) {
    if (this.isInitialized) return this;

    this.canvas = canvasElement || document.getElementById('webgl-layer');
    if (!this.canvas) {
      console.error("Core3D: Nie znaleziono canvasu 'webgl-layer'!");
      return null;
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
      premultipliedAlpha: true,
      logarithmicDepthBuffer: false
    });

    const dpr = (typeof window !== 'undefined' ? Number(window.devicePixelRatio) : 1) || 1;
    this.pixelRatio = Math.min(1.5, Math.max(1, dpr));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.background = null;

    // --- SYSTEM KAMER ---
    this.cameraOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400000);
    const fov = 35; 
    this.cameraPersp = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 100, 500000);

    const shadowGeo = new THREE.PlaneGeometry(500000, 500000);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.38, color: 0x050a14, transparent: true, depthWrite: false, depthTest: false });
    this.shadowCatcher = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadowCatcher.position.set(0, 0, -2);
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.renderOrder = 5;
    this.shadowCatcher.frustumCulled = false;
    this.shadowCatcher.layers.set(0); 
    this.scene.add(this.shadowCatcher);

    const shadowMatFg = new THREE.ShadowMaterial({ opacity: 0.34, color: 0x050a14, transparent: true, depthWrite: false, depthTest: false });
    this.shadowCatcherFg = new THREE.Mesh(shadowGeo, shadowMatFg);
    this.shadowCatcherFg.position.set(0, 0, -100);
    this.shadowCatcherFg.receiveShadow = true;
    this.shadowCatcherFg.renderOrder = 5;
    this.shadowCatcherFg.frustumCulled = false;
    this.shadowCatcherFg.layers.set(2);
    this.scene.add(this.shadowCatcherFg);

    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      format: THREE.RGBAFormat,
      type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      samples: this.renderer.capabilities.isWebGL2 ? 4 : 0
    });
    this.composerTarget = rt;
    this.msaaSamples = Number(rt.samples) || 0;
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.pixelRatio);

    // --- MAGIA: SYSTEM 3 WARSTW ---
    
    // PASS 1: TŁO 3D (Planety, Gwiazdy) - Warstwa 1
    const renderPassBg = new RenderPass(this.scene, this.cameraPersp);
    this.renderPassBg = renderPassBg;
    renderPassBg.clearColor = new THREE.Color(0x000000);
    renderPassBg.clearAlpha = 0;
    const origBgRender = renderPassBg.render.bind(renderPassBg);
    renderPassBg.render = function(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
        this.camera.layers.set(1);
        origBgRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    };
    
    // PASS 2: GAMEPLAY 2D (Ring, Statki, Lasery) - Warstwa 0
    const renderPassOrtho = new RenderPass(this.scene, this.cameraOrtho);
    this.renderPassOrtho = renderPassOrtho;
    renderPassOrtho.clear = false; // Nie czyść kolorów tła!
    const origOrthoRender = renderPassOrtho.render.bind(renderPassOrtho);
    renderPassOrtho.render = function(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
        renderer.clearDepth(); // Czyść głębię, żeby być NAD planetami
        this.camera.layers.set(0);
        origOrthoRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    };

    // PASS 3: ZABUDOWA 3D (Budynki na ringu) - Warstwa 2
    const renderPassFg = new RenderPass(this.scene, this.cameraPersp);
    this.renderPassFg = renderPassFg;
    renderPassFg.clear = false; // Nie czyść kolorów!
    const origFgRender = renderPassFg.render.bind(renderPassFg);
    renderPassFg.render = function(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
        renderer.clearDepth(); // Czyść głębię, żeby być NAD płaskim ringiem
        this.camera.layers.set(2);
        origFgRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    };

    this.composer.addPass(renderPassBg);
    this.composer.addPass(renderPassOrtho);
    this.composer.addPass(renderPassFg);

    this.heatHazeSources = new Float32Array(this.heatHazeMaxSources * 4);
    this.heatHazeCount = 0;
    this.heatHazePass = new ShaderPass(createHeatHazeShader(this.heatHazeMaxSources));
    this.composer.addPass(this.heatHazePass);

    const bloomScale = Math.max(0.1, Math.min(1, Number(this.bloomResolutionScale) || 1));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.floor(window.innerWidth * bloomScale), Math.floor(window.innerHeight * bloomScale)),
      this.bloomBaseStrength, 0.18, this.bloomBaseThreshold
    );
    this.composer.addPass(this.bloomPass);

    const alphaPass = new ShaderPass(PreserveAlphaOutputShader);
    alphaPass.material.toneMapped = false;
    this.composer.addPass(alphaPass);

    this.outputPass = new OutputPass();
    this.outputPass.renderToScreen = true;
    this.composer.addPass(this.outputPass);
    this._applyPassToggles();

    this.isInitialized = true;
    this.resize(window.innerWidth, window.innerHeight);

    console.log('Core3D initialized (Triple Layer System).');
    return this;
  },

  _disposeComposerChain() {
    try {
      if (this.composer?.passes) {
        for (const pass of this.composer.passes) {
          try { pass?.dispose?.(); } catch {}
        }
      }
      try { this.composer?.dispose?.(); } catch {}
      try { this.composer?.renderTarget1?.dispose?.(); } catch {}
      try { this.composer?.renderTarget2?.dispose?.(); } catch {}
      try { this.composerTarget?.dispose?.(); } catch {}
    } catch {}

    this.composer = null;
    this.composerTarget = null;
    this.renderPassBg = null;
    this.renderPassOrtho = null;
    this.renderPassFg = null;
    this.heatHazePass = null;
    this.bloomPass = null;
    this.outputPass = null;
  },

  _buildComposerChain(width, height, samples = 0) {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    const useSamples = this.renderer?.capabilities?.isWebGL2 ? Math.max(0, samples | 0) : 0;

    const rt = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      samples: useSamples
    });
    this.composerTarget = rt;
    this.msaaSamples = Number(rt.samples) || 0;

    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.pixelRatio);

    const renderPassBg = new RenderPass(this.scene, this.cameraPersp);
    renderPassBg.clearColor = new THREE.Color(0x000000);
    renderPassBg.clearAlpha = 0;
    const origBgRender = renderPassBg.render.bind(renderPassBg);
    renderPassBg.render = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
      this.camera.layers.set(1);
      origBgRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    };
    this.renderPassBg = renderPassBg;

    const renderPassOrtho = new RenderPass(this.scene, this.cameraOrtho);
    renderPassOrtho.clear = false;
    const origOrthoRender = renderPassOrtho.render.bind(renderPassOrtho);
    renderPassOrtho.render = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
      renderer.clearDepth();
      this.camera.layers.set(0);
      origOrthoRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    };
    this.renderPassOrtho = renderPassOrtho;

    const renderPassFg = new RenderPass(this.scene, this.cameraPersp);
    renderPassFg.clear = false;
    const origFgRender = renderPassFg.render.bind(renderPassFg);
    renderPassFg.render = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
      renderer.clearDepth();
      this.camera.layers.set(2);
      origFgRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    };
    this.renderPassFg = renderPassFg;

    this.composer.addPass(renderPassBg);
    this.composer.addPass(renderPassOrtho);
    this.composer.addPass(renderPassFg);

    this.heatHazeSources = new Float32Array(this.heatHazeMaxSources * 4);
    this.heatHazeCount = 0;
    this.heatHazePass = new ShaderPass(createHeatHazeShader(this.heatHazeMaxSources));
    this.composer.addPass(this.heatHazePass);

    const bloomScale = Math.max(0.1, Math.min(1, Number(this.bloomResolutionScale) || 1));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.floor(w * bloomScale), Math.floor(h * bloomScale)),
      this.bloomBaseStrength,
      0.18,
      this.bloomBaseThreshold
    );
    this.composer.addPass(this.bloomPass);

    const alphaPass = new ShaderPass(PreserveAlphaOutputShader);
    alphaPass.material.toneMapped = false;
    this.composer.addPass(alphaPass);

    this.outputPass = new OutputPass();
    this.outputPass.renderToScreen = true;
    this.composer.addPass(this.outputPass);
    this._applyPassToggles();
  },

  _applyPassToggles() {
    const t = this.perfToggles || {};
    if (this.renderPassBg) this.renderPassBg.enabled = t.bgPass !== false;
    if (this.renderPassOrtho) this.renderPassOrtho.enabled = t.orthoPass !== false;
    if (this.renderPassFg) this.renderPassFg.enabled = t.fgPass !== false;
    if (this.bloomPass) this.bloomPass.enabled = t.bloom !== false;
    if (this.heatHazePass && t.heatHaze === false) this.heatHazePass.enabled = false;
  },

  setPerfToggles(next = {}) {
    if (!next || typeof next !== 'object') return this.getPerfStatus();
    const t = this.perfToggles || (this.perfToggles = {});
    if ('bloom' in next) t.bloom = !!next.bloom;
    if ('heatHaze' in next) t.heatHaze = !!next.heatHaze;
    if ('bgPass' in next) t.bgPass = !!next.bgPass;
    if ('orthoPass' in next) t.orthoPass = !!next.orthoPass;
    if ('fgPass' in next) t.fgPass = !!next.fgPass;
    this._applyPassToggles();
    return this.getPerfStatus();
  },

  setMsaaEnabled(enabled = true, samples = 4) {
    if (!this.isInitialized || !this.renderer) return this.getPerfStatus();
    if (!this.renderer.capabilities.isWebGL2) {
      this.msaaSamples = 0;
      return this.getPerfStatus();
    }
    const targetSamples = enabled ? Math.max(0, samples | 0) : 0;
    if (targetSamples === this.msaaSamples) return this.getPerfStatus();

    const width = Math.max(1, this.width || (typeof window !== 'undefined' ? window.innerWidth : 1));
    const height = Math.max(1, this.height || (typeof window !== 'undefined' ? window.innerHeight : 1));
    this._disposeComposerChain();
    this._buildComposerChain(width, height, targetSamples);
    this.resize(width, height);
    return this.getPerfStatus();
  },

  getPerfStatus() {
    const t = this.perfToggles || {};
    return {
      isInitialized: !!this.isInitialized,
      msaaSamples: this.msaaSamples | 0,
      bloom: t.bloom !== false,
      heatHaze: t.heatHaze !== false,
      bgPass: t.bgPass !== false,
      orthoPass: t.orthoPass !== false,
      fgPass: t.fgPass !== false
    };
  },

  enableBackground3D(object3d) {
    if (!object3d) return;
    object3d.traverse((child) => { child.layers.set(1); });
  },

  enableForeground3D(object3d) {
    if (!object3d) return;
    object3d.traverse((child) => { child.layers.set(2); });
  },

  resize(w, h) {
    if (!this.isInitialized) return;
    const width = Math.max(1, w | 0);
    const height = Math.max(1, h | 0);
    const nextPixelRatio = Math.min(1.5, Math.max(1, (typeof window !== 'undefined' ? Number(window.devicePixelRatio) : 1) || 1));
    if (Math.abs(nextPixelRatio - this.pixelRatio) > 0.001) {
      this.pixelRatio = nextPixelRatio;
      this.renderer.setPixelRatio(this.pixelRatio);
      this.composer.setPixelRatio(this.pixelRatio);
    }
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    if (this.bloomPass && typeof this.bloomPass.setSize === 'function') {
      const bScale = Math.max(0.1, Math.min(1, Number(this.bloomResolutionScale) || 1));
      this.bloomPass.setSize(Math.floor(width * this.pixelRatio * bScale), Math.floor(height * this.pixelRatio * bScale));
    }
    this.cameraPersp.aspect = width / height;
    this.cameraPersp.updateProjectionMatrix();
  },

  syncCamera(gameCamera) {
    if (!this.isInitialized || !gameCamera) return;
    const zoom = Math.max(0.0001, gameCamera.zoom || 1);
    const halfW = (this.width / 2) / zoom;
    const halfH = (this.height / 2) / zoom;

    this.cameraOrtho.left = -halfW;
    this.cameraOrtho.right = halfW;
    this.cameraOrtho.top = halfH;
    this.cameraOrtho.bottom = -halfH;
    this.cameraOrtho.updateProjectionMatrix();

    const fovRad = THREE.MathUtils.degToRad(this.cameraPersp.fov * 0.5);
    const targetZ = (this.height / 2) / Math.tan(fovRad) / zoom;

    const shake = (typeof window !== 'undefined') ? window.__weapon3dCameraShake : null;
    const shakeX = Number(shake?.x) || 0;
    const shakeY = Number(shake?.y) || 0;

    const camX = gameCamera.x + shakeX;
    const camY = -(gameCamera.y + shakeY);

    this.cameraOrtho.position.set(camX, camY, 150000);
    this.cameraPersp.position.set(camX, camY, targetZ);
    this.cameraPersp.lookAt(camX, camY, 0);

    if (this.shadowCatcher) this.shadowCatcher.position.set(camX, camY, -2);
    if (this.shadowCatcherFg) this.shadowCatcherFg.position.set(camX, camY, -100);
  },

  render() {
    if (!this.isInitialized) return;
    this._applyPassToggles();
    const dbgRecord = (typeof window !== 'undefined' && typeof window.__renderDbgRecord === 'function')
      ? window.__renderDbgRecord
      : null;
    const tRender0 = dbgRecord ? performance.now() : 0;
    let tSection0 = tRender0;

    const bloomEnabled = this.perfToggles?.bloom !== false;
    if (this.bloomPass) this.bloomPass.enabled = bloomEnabled;
    if (this.bloomPass && bloomEnabled && typeof window !== 'undefined') {
      const bloomCfg = window?.DevVFX?.bloom;
      const manualStrength = Number(bloomCfg?.strength);
      const manualRadius = Number(bloomCfg?.radius);
      const manualThreshold = Number(bloomCfg?.threshold);
      if (Number.isFinite(manualStrength) || Number.isFinite(manualRadius) || Number.isFinite(manualThreshold)) {
        if (Number.isFinite(manualStrength)) this.bloomPass.strength = Math.max(0, Math.min(5, manualStrength));
        if (Number.isFinite(manualRadius)) this.bloomPass.radius = Math.max(0, Math.min(2, manualRadius));
        if (Number.isFinite(manualThreshold)) this.bloomPass.threshold = Math.max(0, Math.min(2, manualThreshold));
      } else {
        const gain = Math.min(4.0, Math.max(0.2, Number(window?.OPTIONS?.vfx?.bloomGain) || 1.0));
        this.bloomPass.strength = this.bloomBaseStrength * gain;
        this.bloomPass.threshold = Math.max(0, Math.min(2, this.bloomBaseThreshold - (gain - 1.0) * 0.2));
      }
    }
    if (dbgRecord) {
      dbgRecord('coreBloomConfig', performance.now() - tSection0);
      tSection0 = performance.now();
    }

    if (this.heatHazePass?.material?.uniforms) {
      const uniforms = this.heatHazePass.material.uniforms;
      const devCfg = (typeof window !== 'undefined') ? window?.DevVFX?.heatHaze : null;
      const enabled = devCfg?.enabled !== false;
      const globalStrength = Number.isFinite(Number(devCfg?.strength))
        ? Math.max(0, Math.min(4, Number(devCfg.strength)))
        : 1.0;
      uniforms.uTime.value = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
      uniforms.uSourceCount.value = enabled ? this.heatHazeCount : 0;
      uniforms.uGlobalStrength.value = enabled ? globalStrength : 0;
      this.heatHazePass.enabled = (this.perfToggles?.heatHaze !== false) && enabled && this.heatHazeCount > 0;
      const src = this.heatHazeSources;
      const dst = uniforms.uHeatSources.value;
      const count = Math.min(this.heatHazeCount, this.heatHazeMaxSources);
      for (let i = 0; i < this.heatHazeMaxSources; i++) {
        if (i < count) {
          const base = i * 4;
          dst[i].set(src[base], src[base + 1], src[base + 2], src[base + 3]);
        } else {
          dst[i].set(2, 2, 0, 0);
        }
      }
    }
    if (dbgRecord) {
      dbgRecord('coreHeatHazeSetup', performance.now() - tSection0);
      tSection0 = performance.now();
    }

    this.composer.render();
    if (dbgRecord) {
      const tNow = performance.now();
      dbgRecord('coreComposerRender', tNow - tSection0);
      dbgRecord('core3dRenderTotal', tNow - tRender0);
    }
  },

  beginHeatHazeFrame() {
    this.heatHazeCount = 0;
  },

  pushHeatHazeWorld(worldX, worldY, worldZ = 0, worldRadius = 100, strength = 1.0, usePersp = false) {
    if (!this.isInitialized || !this.heatHazeSources) return;
    if (this.heatHazeCount >= this.heatHazeMaxSources) return;

    const camera = usePersp ? this.cameraPersp : this.cameraOrtho;
    if (!camera) return;

    const scratch = this._heatHazeWorldScratch;
    scratch.set(worldX, worldY, worldZ).project(camera);
    if (!Number.isFinite(scratch.x) || !Number.isFinite(scratch.y)) return;

    const u = scratch.x * 0.5 + 0.5;
    const v = scratch.y * 0.5 + 0.5;
    if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) return;

    let radiusUv = 0.02;
    if (!usePersp) {
      const worldHeight = Math.max(1, Math.abs((camera.top || 0) - (camera.bottom || 0)));
      radiusUv = Math.max(0.004, Math.min(0.28, Math.max(1, worldRadius) / worldHeight));
    } else {
      const dy = this._heatHazeWorldScratch;
      dy.set(worldX, worldY + Math.max(1, worldRadius), worldZ).project(camera);
      if (Number.isFinite(dy.y)) {
        radiusUv = Math.max(0.004, Math.min(0.28, Math.abs((dy.y - scratch.y) * 0.5)));
      }
    }

    const idx = this.heatHazeCount * 4;
    this.heatHazeSources[idx + 0] = u;
    this.heatHazeSources[idx + 1] = v;
    this.heatHazeSources[idx + 2] = radiusUv;
    this.heatHazeSources[idx + 3] = Math.max(0, Math.min(2.5, Number(strength) || 0));
    this.heatHazeCount++;
  },

  setShadowCatchersDebug(enabled = true) {
    const next = !!enabled;
    this.shadowCatchersDebug = next;

    const applyDebug = (mesh, color) => {
      if (!mesh) return;
      if (!mesh.userData.shadowMaterialRef) {
        mesh.userData.shadowMaterialRef = mesh.material;
      }
      if (next) {
        if (!mesh.userData.debugMaterialRef) {
          mesh.userData.debugMaterialRef = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide
          });
        }
        mesh.material = mesh.userData.debugMaterialRef;
      } else if (mesh.userData.shadowMaterialRef) {
        mesh.material = mesh.userData.shadowMaterialRef;
      }
      mesh.visible = true;
    };

    applyDebug(this.shadowCatcher, 0xff4060);
    applyDebug(this.shadowCatcherFg, 0x22dd88);
  },

  toggleShadowCatchersDebug() {
    this.setShadowCatchersDebug(!this.shadowCatchersDebug);
  }
};
