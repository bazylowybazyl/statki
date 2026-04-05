// src/3d/core3d.js
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const MAX_HEAT_HAZE_SOURCES = 24;
const PLANET_RENDER_LAYER = 3;
const OCCLUSION_RENDER_LAYER = 4;
const PLANET_HALO_RENDER_LAYER = 5;

function createShadowShaftsShader() {
  return {
    name: 'ShadowShaftsCompositeShader',
    uniforms: {
      tDiffuse: { value: null },
      uOcclusionMap: { value: null },
      uTime: { value: 0 },
      uSplitScreen: { value: 0 },
      uSunDirection: { value: new THREE.Vector2(1.0, 0.0) },
      uSunDirection2: { value: new THREE.Vector2(1.0, 0.0) },
      uShadowLength: { value: 1.0 },
      uShadowDarkness: { value: 1.8 },
      uLengthMul: { value: 1.2 },
      uShadowDecay: { value: 0.935 },
      uShadowJitter: { value: 0.4 },
      uAspectRatio: { value: 1.0 },
      uOverscan: { value: 1.2 }
    },
    vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform sampler2D uOcclusionMap;
      uniform float uTime;
      uniform int uSplitScreen;
      uniform vec2 uSunDirection;
      uniform vec2 uSunDirection2;
      uniform float uShadowLength;
      uniform float uShadowDarkness;
      uniform float uLengthMul;
      uniform float uShadowDecay;
      uniform float uShadowJitter;
      uniform float uAspectRatio;
      uniform float uOverscan;
      varying vec2 vUv;

      const int NUM_SAMPLES = 10;

      float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

      void main() {
        vec4 sceneColor = texture2D(tDiffuse, vUv);

        vec2 dirVec = (uSplitScreen == 1 && vUv.x > 0.5) ? uSunDirection2 : uSunDirection;
        if(length(dirVec) < 0.001) {
          gl_FragColor = sceneColor;
          return;
        }

        vec2 dir = normalize(vec2(dirVec.x, dirVec.y * uAspectRatio));
        vec2 occUv;
        if (uSplitScreen == 1) {
          if (vUv.x < 0.5) {
            vec2 localOcc = (vec2(vUv.x * 2.0, vUv.y) - 0.5) / uOverscan + 0.5;
            occUv = vec2(localOcc.x * 0.5, localOcc.y);
          } else {
            vec2 localOcc = (vec2((vUv.x - 0.5) * 2.0, vUv.y) - 0.5) / uOverscan + 0.5;
            occUv = vec2(localOcc.x * 0.5 + 0.5, localOcc.y);
          }
        } else {
          occUv = (vUv - 0.5) / uOverscan + 0.5;
        }

        vec2 stepVec = dir * (((uShadowLength * uLengthMul) / uOverscan) / float(NUM_SAMPLES));
        float jitter = (hash12(vUv * vec2(191.13, 137.71) + uTime) - 0.5) * uShadowJitter;
        vec2 sampleUv = occUv + stepVec * (jitter - 0.35);

        float shadowAccum = 0.0;
        float currentWeight = 1.0;
        float totalWeight = 0.0;

        for(int i = 0; i < NUM_SAMPLES; i++) {
          if(sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) break;
          shadowAccum += texture2D(uOcclusionMap, sampleUv).r * currentWeight;
          totalWeight += currentWeight;
          currentWeight *= uShadowDecay;
          sampleUv += stepVec;
        }

        float rawShadow = totalWeight > 0.0 ? clamp((shadowAccum / min(totalWeight, 4.0)) * uShadowDarkness, 0.0, 1.0) : 0.0;
        vec3 finalColor = mix(sceneColor.rgb, sceneColor.rgb * vec3(0.06, 0.10, 0.16), rawShadow);
        gl_FragColor = vec4(finalColor, sceneColor.a);
      }
    `
  };
}

function createPlanetHaloCompositeShader() {
  return {
    name: 'PlanetHaloCompositeShader',
    uniforms: {
      tDiffuse: { value: null },
      tPlanetHalo: { value: null }
    },
    vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform sampler2D tPlanetHalo;
      varying vec2 vUv;
      void main() {
        vec4 sceneColor = texture2D(tDiffuse, vUv);
        vec4 haloColor = texture2D(tPlanetHalo, vUv);
        gl_FragColor = vec4(sceneColor.rgb + haloColor.rgb, max(sceneColor.a, haloColor.a));
      }
    `
  };
}

const UberPostShader = {
  name: 'UberPostShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSourceCount: { value: 0 },
    uGlobalStrength: { value: 1.0 },
    uHeatSources: { value: Array.from({ length: MAX_HEAT_HAZE_SOURCES }, () => new THREE.Vector4(2, 2, 0, 0)) }
  },
  vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    vec3 ACESFilmicToneMapping(vec3 color) {
      return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
    }
    vec4 LinearTosRGB(in vec4 value) {
      return vec4(mix(pow(value.rgb, vec3(0.41666)) * 1.055 - vec3(0.055), value.rgb * 12.92, vec3(lessThanEqual(value.rgb, vec3(0.0031308)))), value.a);
    }

    #ifdef HEAT_HAZE
    uniform float uTime;
    uniform int uSourceCount;
    uniform float uGlobalStrength;
    uniform vec4 uHeatSources[${MAX_HEAT_HAZE_SOURCES}];
    
    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); float a = hash12(i); float b = hash12(i + vec2(1.0, 0.0)); float c = hash12(i + vec2(0.0, 1.0)); float d = hash12(i + vec2(1.0, 1.0)); vec2 u = f * f * (3.0 - 2.0 * f); return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y; }
    #endif

    void main() {
      vec2 uv = vUv;
      vec2 distortion = vec2(0.0);
      
      #ifdef HEAT_HAZE
      float globalNoise = noise(vec2(uv.x * 150.0 + uTime * 4.0, uv.y * 120.0 - uTime * 3.0));

      for (int i = 0; i < ${MAX_HEAT_HAZE_SOURCES}; i++) {
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
        
        float n = fract(globalNoise + float(i) * 0.618);
        float wave = sin((t * 18.0) - (uTime * 10.0) + float(i) * 1.31);
        
        vec2 local = dir * ((n - 0.5) * 0.0018) + perp * (wave * 0.0012);
        distortion += local * amp;
      }
      distortion = clamp(distortion, vec2(-0.008), vec2(0.008));
      #endif
      
      vec4 sceneColor = texture2D(tDiffuse, uv + distortion);
      gl_FragColor = LinearTosRGB(vec4(ACESFilmicToneMapping(sceneColor.rgb), sceneColor.a));
    }
  `
};

function recordRenderDbg(name, ms) {
  const fn = (typeof globalThis !== 'undefined') ? globalThis.__renderDbgRecord : null;
  if (typeof fn !== 'function') return;
  if (!Number.isFinite(ms) || ms < 0) return;
  fn(name, ms);
}

function makeSplitScreenRenderPass(pass, layerId, isOrtho, doClearColor) {
  pass.clear = false;

  pass.render = function(renderer, writeBuffer, readBuffer) {
      const oldAutoClear = renderer.autoClear;
      renderer.autoClear = false; 

      const target = this.renderToScreen ? null : readBuffer;
      renderer.setRenderTarget(target);

      const tw = target ? target.width : renderer.domElement.width;
      const th = target ? target.height : renderer.domElement.height;
      const isSplit = typeof window !== 'undefined' && window.splitScreenMode && Core3D.activeCam2;

      const oldCol = renderer.getClearColor(new THREE.Color());
      const oldAlpha = renderer.getClearAlpha();

      if (isSplit) {
          const halfW = Math.floor(tw / 2);
          renderer.setScissorTest(true);

          // GRACZ 1 (Lewa poĹ‚Ăłwka)
          renderer.setViewport(0, 0, halfW, th);
          renderer.setScissor(0, 0, halfW, th);
          if (doClearColor) {
              renderer.setClearColor(0x000000, 0.0);
              renderer.clear(true, true, true);
          } else {
              renderer.clear(false, true, false);
          }

          // KLUCZ: Przekazujemy halfW, aby aspekt kamery wynosiĹ‚ (halfW / th)
          Core3D.syncCamera(Core3D.activeCam1, halfW, th, 0);
          this.camera = isOrtho ? Core3D.cameraOrtho : Core3D.cameraPersp;
          this.camera.layers.set(layerId);
          renderer.render(this.scene, this.camera);

          // GRACZ 2 (Prawa poĹ‚Ăłwka)
          renderer.setViewport(halfW, 0, tw - halfW, th);
          renderer.setScissor(halfW, 0, tw - halfW, th);
          if (doClearColor) {
              renderer.setClearColor(0x000000, 0.0);
              renderer.clear(true, true, true);
          } else {
              renderer.clear(false, true, false);
          }

          Core3D.syncCamera(Core3D.activeCam2, halfW, th, halfW);
          this.camera = isOrtho ? Core3D.cameraOrtho : Core3D.cameraPersp;
          this.camera.layers.set(layerId);
          renderer.render(this.scene, this.camera);

          renderer.setScissorTest(false);
          renderer.setViewport(0, 0, tw, th);
      } else {
          // Tryb Single Player - bez zmian
          renderer.setViewport(0, 0, tw, th);
          renderer.setScissorTest(false);
          if (doClearColor) {
              renderer.setClearColor(0x000000, 0.0);
              renderer.clear(true, true, true);
          } else {
              renderer.clear(false, true, false);
          }
          Core3D.syncCamera(Core3D.activeCam1, tw, th, 0);
          this.camera = isOrtho ? Core3D.cameraOrtho : Core3D.cameraPersp;
          this.camera.layers.set(layerId);
          renderer.render(this.scene, this.camera);
      }
      renderer.setClearColor(oldCol, oldAlpha);
      renderer.autoClear = oldAutoClear;
  };
}

function createSeparableBlurMaterial(direction = new THREE.Vector2(1, 0)) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uDirection: { value: direction.clone() },
      uRadius: { value: 4.0 }
    },
    vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uResolution; uniform vec2 uDirection; uniform float uRadius; void main() { vec2 off = (uDirection * uRadius) / max(vec2(1.0), uResolution); vec4 sum = vec4(0.0); sum += texture2D(tDiffuse, vUv - off * 4.0) * 0.05; sum += texture2D(tDiffuse, vUv - off * 3.0) * 0.09; sum += texture2D(tDiffuse, vUv - off * 2.0) * 0.12; sum += texture2D(tDiffuse, vUv - off * 1.0) * 0.15; sum += texture2D(tDiffuse, vUv) * 0.18; sum += texture2D(tDiffuse, vUv + off * 1.0) * 0.15; sum += texture2D(tDiffuse, vUv + off * 2.0) * 0.12; sum += texture2D(tDiffuse, vUv + off * 3.0) * 0.09; sum += texture2D(tDiffuse, vUv + off * 4.0) * 0.05; gl_FragColor = sum; }`,
    blending: THREE.NoBlending, transparent: false, depthTest: false, depthWrite: false
  });
}

export const Core3D = {
  activeCam1: { x: 0, y: 0, zoom: 1 },
  activeCam2: null,

  canvas: null, renderer: null, scene: null, cameraOrtho: null, cameraPersp: null,
  shadowCatcher: null, shadowCatcherFg: null, shadowCatchersDebug: false,
  composer: null, composerTarget: null,
  planetHaloTarget: null, haloDepthMaskMaterial: null,

  occlusionTarget: null, occlusionWhiteMaterial: null,
  occlusionBlurTargetA: null, occlusionBlurTargetB: null,
  occlusionBlurScene: null, occlusionBlurCamera: null, occlusionBlurQuad: null,
  occlusionBlurMatH: null, occlusionBlurMatV: null,

  renderPassBg: null, renderPassPlanets: null, planetHaloPass: null, renderPassOrtho: null, renderPassFg: null,
  heatHazeSources: null, heatHazeCount: 0, heatHazeMaxSources: MAX_HEAT_HAZE_SOURCES, _heatHazeWorldScratch: new THREE.Vector3(),
  shadowShaftsPass: null,
  uberPass: null,
  bloomPass: null, bloomResolutionScale: 0.75, bloomBaseStrength: 1.0, bloomBaseThreshold: 0.0,
  msaaSamples: 0,
  perfToggles: { bloom: true, heatHaze: true, shadowShafts: true, threeShadows: true, bgPass: true, planetPass: true, orthoPass: true, fgPass: true, fgBuildings: true, fgStations: true, fgWeapons: true, fgShadows: true },
  pixelRatio: 1, width: 0, height: 0, isInitialized: false,
  _clearColorScratch: new THREE.Color(),

  _getBloomConfig() {
    const bloom = (typeof window !== 'undefined' && window.DevVFX?.bloom) ? window.DevVFX.bloom : null;
    const strength = Number.isFinite(Number(bloom?.strength)) ? Number(bloom.strength) : this.bloomBaseStrength;
    const radius = Number.isFinite(Number(bloom?.radius)) ? Number(bloom.radius) : 0.18;
    const threshold = Number.isFinite(Number(bloom?.threshold)) ? Number(bloom.threshold) : this.bloomBaseThreshold;
    const resolutionScale = Number.isFinite(Number(bloom?.resolutionScale))
      ? Number(bloom.resolutionScale)
      : this.bloomResolutionScale;
    return {
      strength: Math.max(0, strength),
      radius: Math.max(0, radius),
      threshold: Math.max(0, threshold),
      resolutionScale: Math.max(0.1, Math.min(1, resolutionScale))
    };
  },

  _applyBloomPassConfig() {
    if (!this.bloomPass) return;
    const cfg = this._getBloomConfig();
    this.bloomPass.strength = cfg.strength;
    this.bloomPass.radius = cfg.radius;
    this.bloomPass.threshold = cfg.threshold;
  },

  init(canvasElement) {
    if (this.isInitialized) return this;

    this.canvas = canvasElement || document.getElementById('webgl-layer');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false, powerPreference: 'high-performance', premultipliedAlpha: true, logarithmicDepthBuffer: false });

    const dpr = (typeof window !== 'undefined' ? Number(window.devicePixelRatio) : 1) || 1;
    this.pixelRatio = Math.min(1.0, Math.max(1, dpr));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.background = null;

    const sun = new THREE.DirectionalLight(0x8b79ff, 0.1);
    sun.position.set(30000, 20000, 45000);
    sun.layers.enableAll();
    this.scene.add(sun);
    const ambient = new THREE.AmbientLight(0x1b2c80, 0.5);
    ambient.layers.enableAll();
    this.scene.add(ambient);
    const coreLight = new THREE.PointLight(0x3366aa, 0.4, 120000);
    coreLight.position.set(0, 0, -2000);
    coreLight.layers.enableAll();
    this.scene.add(coreLight);

    this.cameraOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400000);
    this.cameraPersp = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 100, 500000);

    const shadowGeo = new THREE.PlaneGeometry(500000, 500000);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.6, color: 0x000000, transparent: true, depthWrite: false, depthTest: false });
    this.shadowCatcher = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadowCatcher.position.set(0, 0, -2);
    this.shadowCatcher.receiveShadow = true; this.shadowCatcher.renderOrder = 5; this.shadowCatcher.frustumCulled = false; this.shadowCatcher.layers.set(0);
    this.scene.add(this.shadowCatcher);

    const shadowMatFg = new THREE.ShadowMaterial({ opacity: 0.6, color: 0x000000, transparent: true, depthWrite: false, depthTest: false });
    this.shadowCatcherFg = new THREE.Mesh(shadowGeo, shadowMatFg);
    this.shadowCatcherFg.position.set(0, 0, -100);
    this.shadowCatcherFg.receiveShadow = true; this.shadowCatcherFg.renderOrder = 5; this.shadowCatcherFg.frustumCulled = false; this.shadowCatcherFg.layers.set(2);
    this.scene.add(this.shadowCatcherFg);

    this.occlusionTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(window.innerWidth / 8)),
      Math.max(1, Math.floor(window.innerHeight / 8)),
      {
        format: THREE.RGBAFormat,
        type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
        depthBuffer: true
      }
    );
    this.occlusionWhiteMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation, blendEquationAlpha: THREE.MaxEquation, blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor
    });
    const blurRtOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false };
    const blurW = Math.max(1, Math.floor(window.innerWidth / 8));
    const blurH = Math.max(1, Math.floor(window.innerHeight / 8));
    this.occlusionBlurTargetA = new THREE.WebGLRenderTarget(blurW, blurH, blurRtOptions);
    this.occlusionBlurTargetB = new THREE.WebGLRenderTarget(blurW, blurH, blurRtOptions);
    this.occlusionBlurScene = new THREE.Scene();
    this.occlusionBlurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.occlusionBlurMatH = createSeparableBlurMaterial(new THREE.Vector2(1, 0));
    this.occlusionBlurMatV = createSeparableBlurMaterial(new THREE.Vector2(0, 1));
    this.occlusionBlurMatH.uniforms.uResolution.value.set(blurW, blurH);
    this.occlusionBlurMatV.uniforms.uResolution.value.set(blurW, blurH);
    this.occlusionBlurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.occlusionBlurMatH);
    this.occlusionBlurScene.add(this.occlusionBlurQuad);

    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      format: THREE.RGBAFormat, type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true, samples: this.renderer.capabilities.isWebGL2 ? 4 : 0
    });
    this.composerTarget = rt;
    this.msaaSamples = Number(rt.samples) || 0;
    this.planetHaloTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      format: THREE.RGBAFormat,
      type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0
    });
    this.haloDepthMaskMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.haloDepthMaskMaterial.colorWrite = false;
    this.haloDepthMaskMaterial.depthWrite = true;
    this.haloDepthMaskMaterial.depthTest = true;
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.pixelRatio);

    this.renderPassBg = new RenderPass(this.scene, this.cameraPersp);
    makeSplitScreenRenderPass(this.renderPassBg, 1, false, true);
    this.renderPassPlanets = new RenderPass(this.scene, this.cameraPersp);
    makeSplitScreenRenderPass(this.renderPassPlanets, PLANET_RENDER_LAYER, false, false);
    this.planetHaloPass = new ShaderPass(createPlanetHaloCompositeShader());
    this.renderPassOrtho = new RenderPass(this.scene, this.cameraOrtho);
    makeSplitScreenRenderPass(this.renderPassOrtho, 0, true, false);
    this.renderPassFg = new RenderPass(this.scene, this.cameraPersp);
    makeSplitScreenRenderPass(this.renderPassFg, 2, false, false);

    this.heatHazeSources = new Float32Array(this.heatHazeMaxSources * 4);
    this.composer.addPass(this.renderPassBg);
    this.composer.addPass(this.renderPassPlanets);
    this.composer.addPass(this.planetHaloPass);

    this.shadowShaftsPass = new ShaderPass(createShadowShaftsShader());
    this.composer.addPass(this.shadowShaftsPass);

    this.composer.addPass(this.renderPassOrtho);
    this.composer.addPass(this.renderPassFg);

    const bloomCfg = this._getBloomConfig();
    this.bloomResolutionScale = bloomCfg.resolutionScale;
    const bloomScale = Math.max(0.1, Math.min(1, Number(this.bloomResolutionScale) || 1));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.floor(window.innerWidth * bloomScale), Math.floor(window.innerHeight * bloomScale)),
      bloomCfg.strength,
      bloomCfg.radius,
      bloomCfg.threshold
    );
    this.composer.addPass(this.bloomPass);

    this.uberPass = new ShaderPass(UberPostShader);
    this.uberPass.material.defines = { HEAT_HAZE: 1 };
    this.uberPass.material.needsUpdate = true;
    this.uberPass.renderToScreen = true;
    this.composer.addPass(this.uberPass);
    if (this.planetHaloPass?.uniforms) {
      this.planetHaloPass.uniforms.tPlanetHalo.value = this.planetHaloTarget.texture;
    }

    this._applyPassToggles();
    this.isInitialized = true;
    this.resize(window.innerWidth, window.innerHeight);

    return this;
  },

  _disposeComposerChain() {
    try {
      if (this.composer?.passes) for (const pass of this.composer.passes) try { pass?.dispose?.(); } catch { }
      try { this.composer?.dispose?.(); } catch { }
      try { this.composerTarget?.dispose?.(); } catch { }
      try { this.planetHaloTarget?.dispose?.(); } catch { }
      try { this.haloDepthMaskMaterial?.dispose?.(); } catch { }
      try { this.occlusionTarget?.dispose?.(); } catch { }
      try { this.occlusionBlurTargetA?.dispose?.(); } catch { }
      try { this.occlusionBlurTargetB?.dispose?.(); } catch { }
      try { this.occlusionBlurQuad?.geometry?.dispose?.(); } catch { }
      try { this.occlusionBlurMatH?.dispose?.(); } catch { }
      try { this.occlusionBlurMatV?.dispose?.(); } catch { }
    } catch { }
    this.isInitialized = false;
  },

  _applyPassToggles() {
    const t = this.perfToggles || {};
    if (this.renderPassBg) this.renderPassBg.enabled = t.bgPass !== false;
    if (this.renderPassPlanets) this.renderPassPlanets.enabled = t.planetPass !== false;
    if (this.planetHaloPass) this.planetHaloPass.enabled = t.planetPass !== false;
    if (this.renderPassOrtho) this.renderPassOrtho.enabled = t.orthoPass !== false;
    if (this.renderPassFg) this.renderPassFg.enabled = t.fgPass !== false;
    if (this.bloomPass) this.bloomPass.enabled = t.bloom !== false;
    if (this.shadowShaftsPass) this.shadowShaftsPass.enabled = t.shadowShafts !== false;
    if (this.uberPass) this.uberPass.enabled = true; // zawsze wlaczony — ACES + sRGB
    if (this.renderer?.shadowMap) {
      this.renderer.shadowMap.enabled = t.threeShadows !== false;
      this.renderer.shadowMap.needsUpdate = t.threeShadows !== false;
    }
    if (this.shadowCatcher) this.shadowCatcher.visible = t.threeShadows !== false;
    if (this.shadowCatcherFg) this.shadowCatcherFg.visible = (t.fgShadows !== false) && (t.threeShadows !== false);
    // FG sub-toggles: kontroluj visible per kategoria obiektów
    if (this.scene) {
      const fgB = t.fgBuildings !== false;
      const fgS = t.fgStations !== false;
      const fgW = t.fgWeapons !== false;
      for (const child of this.scene.children) {
        const cat = child.userData?.fgCategory;
        if (cat === 'buildings') child.visible = fgB;
        else if (cat === 'stations') child.visible = fgS;
        else if (cat === 'weapons') child.visible = fgW;
      }
    }
  },

  setPerfToggles(next = {}) {
    if (!next || typeof next !== 'object') return this.getPerfStatus();
    const t = this.perfToggles || (this.perfToggles = {});
    if ('godRays' in next) t.shadowShafts = !!next.godRays;
    if ('shadows' in next) t.threeShadows = !!next.shadows;
    Object.assign(t, next);
    if (this.uberPass) {
      const hasHeatHaze = t.heatHaze !== false;
      const defines = { ...(this.uberPass.material.defines || {}) };
      if (hasHeatHaze && !defines.HEAT_HAZE) {
        defines.HEAT_HAZE = 1;
        this.uberPass.material.defines = defines;
        this.uberPass.material.needsUpdate = true;
      } else if (!hasHeatHaze && defines.HEAT_HAZE) {
        delete defines.HEAT_HAZE;
        this.uberPass.material.defines = defines;
        this.uberPass.material.needsUpdate = true;
      }
    }
    this._applyPassToggles();
    return this.getPerfStatus();
  },

  setMsaaEnabled(enabled = true, samples = 4) {
    const targetSamples = enabled ? Math.max(0, Number(samples) || 4) : 0;
    if (this.msaaSamples === targetSamples) return this.getPerfStatus();

    this.msaaSamples = targetSamples;

    const applySamples = (rt) => {
      if (rt && rt.samples !== targetSamples) {
        rt.samples = targetSamples;
        rt.dispose();
      }
    };

    applySamples(this.composerTarget);
    if (this.composer) {
      applySamples(this.composer.renderTarget1);
      applySamples(this.composer.renderTarget2);
    }

    return this.getPerfStatus();
  },
  getPerfStatus() {
    const t = this.perfToggles || {};
    return {
      isInitialized: !!this.isInitialized,
      bloom: t.bloom !== false,
      heatHaze: t.heatHaze !== false,
      shadowShafts: t.shadowShafts !== false,
      godRays: t.shadowShafts !== false,
      threeShadows: t.threeShadows !== false,
      bgPass: t.bgPass !== false,
      planetPass: t.planetPass !== false,
      orthoPass: t.orthoPass !== false,
      fgPass: t.fgPass !== false,
      fgBuildings: t.fgBuildings !== false,
      fgStations: t.fgStations !== false,
      fgWeapons: t.fgWeapons !== false,
      fgShadows: t.fgShadows !== false,
      msaaSamples: Number(this.msaaSamples) || 0
    };
  },
  enableBackground3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(1); }); },
  enablePlanet3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(PLANET_RENDER_LAYER); }); },
  enablePlanetHalo3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(PLANET_HALO_RENDER_LAYER); }); },
  enablePlanetOccluder3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.enable(OCCLUSION_RENDER_LAYER); }); },
  enableForeground3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(2); }); },

  resize(w, h) {
    if (!this.isInitialized) return;
    const width = Math.max(1, w | 0);
    const height = Math.max(1, h | 0);
    this.pixelRatio = Math.min(1.5, Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1)));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.composer.setPixelRatio(this.pixelRatio);
    this.width = width; this.height = height;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);

    if (this.occlusionTarget) {
      this.occlusionTarget.setSize(Math.max(1, Math.floor(width / 8)), Math.max(1, Math.floor(height / 8)));
    }
    if (this.planetHaloTarget) {
      this.planetHaloTarget.setSize(width, height);
    }
    if (this.occlusionBlurTargetA && this.occlusionBlurTargetB) {
      const blurW = Math.max(1, Math.floor(width / 8));
      const blurH = Math.max(1, Math.floor(height / 8));
      this.occlusionBlurTargetA.setSize(blurW, blurH);
      this.occlusionBlurTargetB.setSize(blurW, blurH);
      if (this.occlusionBlurMatH?.uniforms?.uResolution) this.occlusionBlurMatH.uniforms.uResolution.value.set(blurW, blurH);
      if (this.occlusionBlurMatV?.uniforms?.uResolution) this.occlusionBlurMatV.uniforms.uResolution.value.set(blurW, blurH);
    }
    if (this.bloomPass && typeof this.bloomPass.setSize === 'function') {
      const bScale = Math.max(0.1, Math.min(1, Number(this.bloomResolutionScale) || 1));
      this.bloomPass.setSize(Math.floor(width * this.pixelRatio * bScale), Math.floor(height * this.pixelRatio * bScale));
    }
  },

  syncCamera(gameCamera, viewWidth, viewHeight, viewOffsetX = 0) {
    if (!this.isInitialized || !gameCamera) return;
    
    if (viewWidth === undefined) {
       this.activeCam1 = gameCamera;
       if (typeof window !== 'undefined' && window.camera2) {
           this.activeCam2 = window.camera2;
       } else {
           this.activeCam2 = gameCamera;
       }
    }

    const w = viewWidth || this.width;
    const h = viewHeight || this.height;
    const zoom = Math.max(0.0001, gameCamera.zoom || 1);
    
    const halfW = (w / 2) / zoom;
    const halfH = (h / 2) / zoom;
    this.cameraOrtho.left = -halfW;
    this.cameraOrtho.right = halfW;
    this.cameraOrtho.top = halfH;
    this.cameraOrtho.bottom = -halfH;
    this.cameraOrtho.updateProjectionMatrix();

    this.cameraPersp.aspect = w / h;
    const fovRad = THREE.MathUtils.degToRad(this.cameraPersp.fov * 0.5);
    const targetZ = (h / 2) / Math.tan(fovRad) / zoom;
    this.cameraPersp.updateProjectionMatrix();

    const shake = (typeof window !== 'undefined') ? window.__weapon3dCameraShake : null;
    const camX = gameCamera.x + (Number(shake?.x) || 0);
    const camY = -(gameCamera.y + (Number(shake?.y) || 0));

    this.cameraOrtho.position.set(camX, camY, 150000);
    this.cameraPersp.position.set(camX, camY, targetZ);
    this.cameraPersp.lookAt(camX, camY, 0);

    if (viewOffsetX === 0) {
      if (this.shadowCatcher) this.shadowCatcher.position.set(camX, camY, -2);
      if (this.shadowCatcherFg) this.shadowCatcherFg.position.set(camX, camY, -100);
    }
  },

  render() {
    if (!this.isInitialized) return;
    const dbgEnabled = typeof globalThis !== 'undefined' && typeof globalThis.__renderDbgRecord === 'function';
    const tRenderTotal0 = dbgEnabled ? performance.now() : 0;

    this._applyPassToggles();

    const t = this.perfToggles || {};
    const bloomOn = t.bloom !== false;
    const raysEnabled = t.shadowShafts !== false;
    const heatEnabled = t.heatHaze !== false;
    let occlusionTexture = this.occlusionTarget?.texture || null;
    const OVERSCAN = 1.2;
    let isSplit = false;
    let origTop = this.cameraOrtho.top;
    let origBottom = this.cameraOrtho.bottom;

    if (this.planetHaloTarget && this.planetHaloPass && this.haloDepthMaskMaterial) {
      const prevAutoClear = this.renderer.autoClear;
      const prevTarget = this.renderer.getRenderTarget();
      const prevClearAlpha = this.renderer.getClearAlpha();
      const prevClearColor = this._clearColorScratch;
      this.renderer.getClearColor(prevClearColor);
      const prevOverrideMaterial = this.scene.overrideMaterial;
      const prevPerspLayerMask = this.cameraPersp.layers.mask;

      const renderPlanetHaloViewport = (camData, vpX, vpY, vpW, vpH) => {
        this.renderer.setViewport(vpX, vpY, vpW, vpH);
        this.renderer.setScissor(vpX, vpY, vpW, vpH);
        this.renderer.setScissorTest(true);
        this.renderer.clear(true, true, true);

        this.syncCamera(camData, vpW, vpH, vpX);

        this.scene.overrideMaterial = this.haloDepthMaskMaterial;
        this.cameraPersp.layers.set(PLANET_RENDER_LAYER);
        this.renderer.render(this.scene, this.cameraPersp);

        this.scene.overrideMaterial = prevOverrideMaterial;
        this.cameraPersp.layers.set(PLANET_HALO_RENDER_LAYER);
        this.renderer.render(this.scene, this.cameraPersp);
      };

      this.renderer.autoClear = false;
      this.renderer.setRenderTarget(this.planetHaloTarget);
      this.renderer.setClearColor(0x000000, 0.0);

      isSplit = typeof window !== 'undefined' && window.splitScreenMode && this.activeCam2;
      const haloW = this.planetHaloTarget.width;
      const haloH = this.planetHaloTarget.height;
      if (isSplit) {
        const halfW = Math.floor(haloW / 2);
        renderPlanetHaloViewport(this.activeCam1, 0, 0, halfW, haloH);
        renderPlanetHaloViewport(this.activeCam2, halfW, 0, haloW - halfW, haloH);
      } else {
        renderPlanetHaloViewport(this.activeCam1, 0, 0, haloW, haloH);
      }

      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, haloW, haloH);
      this.scene.overrideMaterial = prevOverrideMaterial;
      this.cameraPersp.layers.mask = prevPerspLayerMask;
      this.renderer.setRenderTarget(prevTarget);
      this.renderer.setClearColor(prevClearColor, prevClearAlpha);
      this.renderer.autoClear = prevAutoClear;
      this.planetHaloPass.uniforms.tPlanetHalo.value = this.planetHaloTarget.texture;
    }

    // UberPost zawsze wlaczony — ACES tonemapping + linear→sRGB
    // Composer dziala nawet gdy bloom/heatHaze/shadowShafts sa off (passes disabled).
    this.renderer.toneMapping = THREE.NoToneMapping;

    if (raysEnabled && this.shadowShaftsPass) {
      const prevAutoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;

      const prevTarget = this.renderer.getRenderTarget();
      const prevClearAlpha = this.renderer.getClearAlpha();
      const prevClearColor = this._clearColorScratch;
      this.renderer.getClearColor(prevClearColor);
      const prevLayerMask = this.cameraPersp.layers.mask;
      const prevOverrideMaterial = this.scene.overrideMaterial;

      const origLeft = this.cameraOrtho.left;
      const origRight = this.cameraOrtho.right;
      origTop = this.cameraOrtho.top;
      origBottom = this.cameraOrtho.bottom;
      const origPerspZoom = this.cameraPersp.zoom;

      this.renderer.setRenderTarget(this.occlusionTarget);
      this.scene.overrideMaterial = this.occlusionWhiteMaterial;

      isSplit = typeof window !== 'undefined' && window.splitScreenMode && this.activeCam2;

      if (isSplit) {
          const tw = this.occlusionTarget.width;
          const th = this.occlusionTarget.height;
          const halfW = Math.floor(tw / 2);

          this.renderer.setScissorTest(true);
          
          // --- Lewa Okluzja ---
          this.renderer.setViewport(0, 0, halfW, th);
          this.renderer.setScissor(0, 0, halfW, th);
          this.renderer.setClearColor(0x000000, 0.0);
          this.renderer.clear(true, true, true);
          
          this.syncCamera(this.activeCam1, this.width / 2, this.height, 0);
          this.cameraOrtho.left *= OVERSCAN; this.cameraOrtho.right *= OVERSCAN;
          this.cameraOrtho.top *= OVERSCAN; this.cameraOrtho.bottom *= OVERSCAN;
          this.cameraOrtho.updateProjectionMatrix();
          this.cameraPersp.zoom /= OVERSCAN; this.cameraPersp.updateProjectionMatrix();
          this.cameraPersp.layers.set(OCCLUSION_RENDER_LAYER);
          
          this.renderer.render(this.scene, this.cameraPersp);

          // --- Prawa Okluzja ---
          this.renderer.setViewport(halfW, 0, tw - halfW, th);
          this.renderer.setScissor(halfW, 0, tw - halfW, th);
          this.renderer.setClearColor(0x000000, 0.0);
          this.renderer.clear(true, true, true);
          
          this.syncCamera(this.activeCam2, this.width / 2, this.height, this.width / 2); 
          this.cameraOrtho.left *= OVERSCAN; this.cameraOrtho.right *= OVERSCAN;
          this.cameraOrtho.top *= OVERSCAN; this.cameraOrtho.bottom *= OVERSCAN;
          this.cameraOrtho.updateProjectionMatrix();
          this.cameraPersp.zoom /= OVERSCAN; this.cameraPersp.updateProjectionMatrix();
          this.cameraPersp.layers.set(OCCLUSION_RENDER_LAYER);
          
          this.renderer.render(this.scene, this.cameraPersp);

          this.renderer.setScissorTest(false);
      } else {
          const tw = this.occlusionTarget.width;
          const th = this.occlusionTarget.height;
          this.renderer.setViewport(0, 0, tw, th);
          this.renderer.setScissorTest(false);
          this.renderer.setClearColor(0x000000, 0.0);
          this.renderer.clear(true, true, true);
          
          this.syncCamera(this.activeCam1, this.width, this.height, 0);
          this.cameraOrtho.left *= OVERSCAN; this.cameraOrtho.right *= OVERSCAN;
          this.cameraOrtho.top *= OVERSCAN; this.cameraOrtho.bottom *= OVERSCAN;
          this.cameraOrtho.updateProjectionMatrix();
          this.cameraPersp.zoom /= OVERSCAN; this.cameraPersp.updateProjectionMatrix();
          this.cameraPersp.layers.set(OCCLUSION_RENDER_LAYER);
          
          this.renderer.render(this.scene, this.cameraPersp);
      }

      this.scene.overrideMaterial = prevOverrideMaterial;
      this.cameraPersp.layers.mask = prevLayerMask;

      this.cameraOrtho.left = origLeft;
      this.cameraOrtho.right = origRight;
      this.cameraOrtho.top = origTop;
      this.cameraOrtho.bottom = origBottom;
      this.cameraOrtho.updateProjectionMatrix();

      this.cameraPersp.zoom = origPerspZoom;
      this.cameraPersp.updateProjectionMatrix();

      occlusionTexture = this.occlusionTarget.texture;
      if (
        this.occlusionBlurTargetA && this.occlusionBlurTargetB &&
        this.occlusionBlurScene && this.occlusionBlurCamera &&
        this.occlusionBlurQuad && this.occlusionBlurMatH && this.occlusionBlurMatV
      ) {
        this.occlusionBlurMatH.uniforms.tDiffuse.value = this.occlusionTarget.texture;
        this.occlusionBlurQuad.material = this.occlusionBlurMatH;
        this.renderer.setRenderTarget(this.occlusionBlurTargetA);
        this.renderer.clear();
        this.renderer.render(this.occlusionBlurScene, this.occlusionBlurCamera);

        this.occlusionBlurMatV.uniforms.tDiffuse.value = this.occlusionBlurTargetA.texture;
        this.occlusionBlurQuad.material = this.occlusionBlurMatV;
        this.renderer.setRenderTarget(this.occlusionBlurTargetB);
        this.renderer.clear();
        this.renderer.render(this.occlusionBlurScene, this.occlusionBlurCamera);
        occlusionTexture = this.occlusionBlurTargetB.texture;
      }

      this.renderer.setRenderTarget(prevTarget);
      this.renderer.setClearColor(prevClearColor, prevClearAlpha);
      this.renderer.autoClear = prevAutoClear;

    }

    const tBloom0 = dbgEnabled ? performance.now() : 0;
    if (this.bloomPass && bloomOn) this._applyBloomPassConfig();
    if (dbgEnabled) recordRenderDbg('coreBloomConfig', performance.now() - tBloom0);

    const tPost0 = dbgEnabled ? performance.now() : 0;
    const nowSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
    const sun = typeof window !== 'undefined' ? window.SUN : null;

    if (this.shadowShaftsPass) {
      const uShafts = this.shadowShaftsPass.material.uniforms;
      if (raysEnabled) {
        uShafts.uOcclusionMap.value = occlusionTexture;
        uShafts.uAspectRatio.value = this.width / this.height;
        uShafts.uOverscan.value = OVERSCAN;

        const worldHeight = Math.abs(origTop - origBottom);
        uShafts.uShadowLength.value = worldHeight > 0 ? Math.max(0.15, Math.min(20000.0 / worldHeight, 0.8)) : 0.0;
        uShafts.uTime.value = nowSec;

        if (sun) {
          const cam1 = this.activeCam1 || { x: 0, y: 0 };
          const cam2 = this.activeCam2 || cam1;
          if (isSplit) {
            uShafts.uSplitScreen.value = 1;
            uShafts.uSunDirection.value.set(sun.x - cam1.x, (-sun.y) - (-cam1.y));
            uShafts.uSunDirection2.value.set(sun.x - cam2.x, (-sun.y) - (-cam2.y));
          } else {
            uShafts.uSplitScreen.value = 0;
            uShafts.uSunDirection.value.set(sun.x - cam1.x, (-sun.y) - (-cam1.y));
            uShafts.uSunDirection2.value.set(0, 0);
          }
        } else {
          uShafts.uSplitScreen.value = 0;
          uShafts.uSunDirection.value.set(0, 0);
          uShafts.uSunDirection2.value.set(0, 0);
        }
      } else {
        uShafts.uSplitScreen.value = 0;
        uShafts.uSunDirection.value.set(0, 0);
        uShafts.uSunDirection2.value.set(0, 0);
        uShafts.uShadowLength.value = 0.0;
      }
    }

    if (this.uberPass) {
      const uPost = this.uberPass.material.uniforms;
      const heatCount = heatEnabled ? Math.max(0, Math.min(this.heatHazeCount | 0, this.heatHazeMaxSources | 0)) : 0;
      uPost.uSourceCount.value = heatCount;
      uPost.uGlobalStrength.value = 1.0;
      uPost.uTime.value = nowSec;

      if (heatCount > 0) {
        const dst = uPost.uHeatSources.value;
        const src = this.heatHazeSources;
        for (let i = 0; i < heatCount; i++) {
          const base = i * 4;
          dst[i].set(src[base], src[base + 1], src[base + 2], src[base + 3]);
        }
      }
    }
    if (dbgEnabled) recordRenderDbg('coreUberSetup', performance.now() - tPost0);

    const tComposer0 = dbgEnabled ? performance.now() : 0;
    this.composer.render();
    if (dbgEnabled) {
      recordRenderDbg('coreComposerRender', performance.now() - tComposer0);
      recordRenderDbg('core3dRenderTotal', performance.now() - tRenderTotal0);
    }
  },

  _renderDirect(dbgEnabled, tRenderTotal0) {
    const renderer = this.renderer;
    const isSplit = typeof window !== 'undefined' && window.splitScreenMode && this.activeCam2;

    // ShaderMaterial outputuje wartosci sRGB bezposrednio - nie zmieniamy colorSpace.
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0.0);
    renderer.clear(true, true, true);

    const t = this.perfToggles || {};
    const layers = [];
    if (t.bgPass !== false) layers.push({ layer: 1, ortho: false });
    if (t.planetPass !== false) layers.push({ layer: PLANET_RENDER_LAYER, ortho: false });
    layers.push({ layer: 0, ortho: true }); // ortho always
    if (t.fgPass !== false) layers.push({ layer: 2, ortho: false });

    const renderLayers = (camData, vpX, vpY, vpW, vpH) => {
      renderer.setViewport(vpX, vpY, vpW, vpH);
      renderer.setScissor(vpX, vpY, vpW, vpH);
      renderer.setScissorTest(true);

      this.syncCamera(camData, vpW, vpH, vpX);

      for (const { layer, ortho } of layers) {
        const cam = ortho ? this.cameraOrtho : this.cameraPersp;
        cam.layers.set(layer);
        renderer.render(this.scene, cam);
      }
    };

    const w = renderer.domElement.width;
    const h = renderer.domElement.height;

    if (isSplit) {
      const halfW = Math.floor(w / 2);
      renderLayers(this.activeCam1, 0, 0, halfW, h);
      renderer.clear(false, true, false);
      renderLayers(this.activeCam2, halfW, 0, w - halfW, h);
    } else {
      renderLayers(this.activeCam1, 0, 0, w, h);
    }

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.autoClear = true;

    if (dbgEnabled) {
      recordRenderDbg('coreComposerRender', 0);
      recordRenderDbg('core3dRenderTotal', performance.now() - tRenderTotal0);
    }
  },

  renderSingle(gameCamera = null) {
    if (!this.isInitialized) return;
    const dbgEnabled = typeof globalThis !== 'undefined' && typeof globalThis.__renderDbgRecord === 'function';
    const tCall0 = dbgEnabled ? performance.now() : 0;
    const prevCam1 = this.activeCam1;
    const prevCam2 = this.activeCam2;
    if (gameCamera) this.activeCam1 = gameCamera;
    this.activeCam2 = null;
    this.render();
    this.activeCam1 = prevCam1;
    this.activeCam2 = prevCam2;
    if (dbgEnabled) recordRenderDbg('coreRenderCall', performance.now() - tCall0);
  },

  renderSplitScreen(cam1 = null, cam2 = null) {
    if (!this.isInitialized) return;
    const dbgEnabled = typeof globalThis !== 'undefined' && typeof globalThis.__renderDbgRecord === 'function';
    const tCall0 = dbgEnabled ? performance.now() : 0;
    const prevCam1 = this.activeCam1;
    const prevCam2 = this.activeCam2;
    if (cam1) this.activeCam1 = cam1;
    if (cam2) this.activeCam2 = cam2;
    this.render();
    this.activeCam1 = prevCam1;
    this.activeCam2 = prevCam2;
    if (dbgEnabled) recordRenderDbg('coreRenderCall', performance.now() - tCall0);
  },

  beginHeatHazeFrame() { this.heatHazeCount = 0; },
  
  pushHeatHazeWorld(worldX, worldY, worldZ = -4, radiusWorld = 80, strength = 1.0) {
    if (!this.isInitialized || !this.heatHazeSources || !this.cameraOrtho) return false;
    if ((this.perfToggles?.heatHaze) === false) return false;

    const doPush = (u, v, rUv, amp) => {
        if (u < -rUv || u > 1.0 + rUv || v < -rUv || v > 1.0 + rUv) return;
        const maxSources = this.heatHazeMaxSources | 0;
        if (this.heatHazeCount >= maxSources) return;
        const outBase = this.heatHazeCount * 4;
        this.heatHazeSources[outBase + 0] = u;
        this.heatHazeSources[outBase + 1] = v;
        this.heatHazeSources[outBase + 2] = rUv;
        this.heatHazeSources[outBase + 3] = amp;
        this.heatHazeCount++;
    };

    const mapToCamera = (camData, isSplit, isRightSide) => {
        const zoom = Math.max(0.0001, camData.zoom || 1);
        const camW = isSplit ? this.width / 2 : this.width;
        const camH = this.height;
        const halfW = camW / 2 / zoom;
        const halfH = camH / 2 / zoom;
        
        const left = camData.x - halfW;
        const bottom = -(camData.y) - halfH;
        
        const worldW = halfW * 2;
        const worldH = halfH * 2;
        
        let u = (worldX - left) / worldW;
        const v = (worldY - bottom) / worldH;
        const rUv = radiusWorld / Math.min(worldW, worldH);
        
        const zoomNow = Math.max(0.0001, camW / worldW);
        const ampZoomScale = Math.max(0.22, Math.min(1.0, zoomNow));
        const ampScaled = strength * ampZoomScale;
        
        if (isSplit) {
            u = isRightSide ? (u * 0.5 + 0.5) : (u * 0.5);
            doPush(u, v, rUv * 0.5, ampScaled); 
        } else {
            doPush(u, v, rUv, ampScaled);
        }
    };

    const isSplit = typeof window !== 'undefined' && window.splitScreenMode && this.activeCam2;
    if (isSplit) {
        mapToCamera(this.activeCam1, true, false);
        mapToCamera(this.activeCam2, true, true);
    } else {
        mapToCamera(this.activeCam1, false, false);
    }
    
    return true;
  },

  pushGodRayWorld() { },
  setShadowCatchersDebug(enabled = true) { },
  toggleShadowCatchersDebug() { }
};
