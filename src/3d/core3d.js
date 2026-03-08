import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const PreserveAlphaOutputShader = {
  name: 'PreserveAlphaOutputShader',
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `precision highp float; uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 texColor = texture2D(tDiffuse, vUv); gl_FragColor = vec4(texColor.rgb * texColor.a, texColor.a); }`
};

const MAX_HEAT_HAZE_SOURCES = 24;
const PLANET_RENDER_LAYER = 3;
const OCCLUSION_RENDER_LAYER = 4;

// --- SHADER: Płaskie Cienie (Overscan Shadow Shafts) ---
function createShadowShaftsShader() {
  return {
    name: 'ShadowShaftsCompositeShader',
    uniforms: {
      tDiffuse: { value: null },
      uOcclusionMap: { value: null },
      uTime: { value: 0 },
      uSunDirection: { value: new THREE.Vector2(1.0, 0.0) }, // Kierunek słońca (płaski rzut 2D)
      uShadowLength: { value: 1.0 },
      uShadowDarkness: { value: 1.8 },
      uLengthMul: { value: 1.2 },
      uShadowDecay: { value: 0.935 },
      uShadowJitter: { value: 0.4 },
      uAspectRatio: { value: 1.0 },
      uOverscan: { value: 3.0 }
    },
    vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform sampler2D uOcclusionMap;
      uniform float uTime;
      uniform vec2 uSunDirection;
      uniform float uShadowLength;
      uniform float uShadowDarkness;
      uniform float uLengthMul;
      uniform float uShadowDecay;
      uniform float uShadowJitter;
      uniform float uAspectRatio;
      uniform float uOverscan;
      varying vec2 vUv;

      const int NUM_SAMPLES = 50; 

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      void main() {
        vec4 sceneColor = texture2D(tDiffuse, vUv);
        
        if(length(uSunDirection) < 0.001) {
            gl_FragColor = sceneColor;
            return;
        }

        // Płaski wektor kierunku słońca
        vec2 dir = normalize(vec2(uSunDirection.x, uSunDirection.y * uAspectRatio));

        // Magia Overscanu: Mapujemy nasz mniejszy ekranik na środek wielkiej maski
        vec2 occUv = (vUv - 0.5) / uOverscan + 0.5;
        vec2 stepVec = dir * (((uShadowLength * uLengthMul) / uOverscan) / float(NUM_SAMPLES));
        
        // Szum zapobiegający "schodkowaniu"
        float jitter = (hash12(vUv * vec2(191.13, 137.71) + uTime) - 0.5) * uShadowJitter;
        vec2 sampleUv = occUv + stepVec * (jitter - 0.35);

        float shadowAccum = 0.0;
        float currentWeight = 1.0;
        float totalWeight = 0.0;

        for(int i = 0; i < NUM_SAMPLES; i++) {
            if(sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) break;
            
            // 1.0 to przeszkoda, 0.0 to pusty kosmos
            float occluder = texture2D(uOcclusionMap, sampleUv).r;
            shadowAccum += occluder * currentWeight;
            totalWeight += currentWeight;
            currentWeight *= uShadowDecay;
            sampleUv += stepVec;
        }

        // Siła cienia – min(totalWeight, 4.0) zapobiega rozcieńczeniu dla cienkich przeszkód (daleki zoom)
        float rawShadow = totalWeight > 0.0 ? clamp((shadowAccum / min(totalWeight, 6.0)) * uShadowDarkness, 0.0, 1.0) : 0.0;
        // Self-mask wyłączony: dawał artefakt "dziury" na planecie przy ruchu kamery/blurze maski.
        float shadowFactor = rawShadow;
        
        // Kinowy, chłodny, mroczny kolor cienia
        vec3 shadowColor = vec3(0.06, 0.10, 0.16); 
        vec3 finalColor = mix(sceneColor.rgb, sceneColor.rgb * shadowColor, shadowFactor);
        
        gl_FragColor = vec4(finalColor, sceneColor.a);
      }
    `
  };
}

function createHeatHazeShader(maxSources = MAX_HEAT_HAZE_SOURCES) {
  return {
    name: 'EngineHeatHazeShader',
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uSourceCount: { value: 0 }, uGlobalStrength: { value: 1.0 }, uHeatSources: { value: Array.from({ length: maxSources }, () => new THREE.Vector4(2, 2, 0, 0)) } },
    vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; uniform sampler2D tDiffuse; uniform float uTime; uniform int uSourceCount; uniform float uGlobalStrength; uniform vec4 uHeatSources[${maxSources}]; varying vec2 vUv; float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); } float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); float a = hash12(i); float b = hash12(i + vec2(1.0, 0.0)); float c = hash12(i + vec2(0.0, 1.0)); float d = hash12(i + vec2(1.0, 1.0)); vec2 u = f * f * (3.0 - 2.0 * f); return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y; } void main() { vec2 uv = vUv; vec2 distortion = vec2(0.0); for (int i = 0; i < ${maxSources}; i++) { if (i >= uSourceCount) break; vec4 src = uHeatSources[i]; vec2 toUv = uv - src.xy; float dist = length(toUv); float radius = max(0.0001, src.z); if (dist >= radius) continue; float t = clamp(dist / radius, 0.0, 1.0); float rim = smoothstep(1.0, 0.15, t); float centerSuppress = smoothstep(0.03, 0.22, t); float amp = src.w * rim * centerSuppress * uGlobalStrength; vec2 dir = (dist > 0.00001) ? (toUv / dist) : vec2(0.0, 1.0); vec2 perp = vec2(-dir.y, dir.x); float n = noise(vec2(uv.x * 220.0 + float(i) * 17.0 + uTime * 6.0, uv.y * 180.0 - float(i) * 9.0 - uTime * 4.2)); float wave = sin((t * 18.0) - (uTime * 10.0) + float(i) * 1.31); vec2 local = dir * ((n - 0.5) * 0.0018) + perp * (wave * 0.0012); distortion += local * amp; } distortion = clamp(distortion, vec2(-0.008), vec2(0.008)); gl_FragColor = texture2D(tDiffuse, uv + distortion); }`
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
    vertexShader: `
      precision highp float;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform vec2 uDirection;
      uniform float uRadius;

      void main() {
        vec2 off = (uDirection * uRadius) / max(vec2(1.0), uResolution);
        vec4 sum = vec4(0.0);
        sum += texture2D(tDiffuse, vUv - off * 4.0) * 0.05;
        sum += texture2D(tDiffuse, vUv - off * 3.0) * 0.09;
        sum += texture2D(tDiffuse, vUv - off * 2.0) * 0.12;
        sum += texture2D(tDiffuse, vUv - off * 1.0) * 0.15;
        sum += texture2D(tDiffuse, vUv) * 0.18;
        sum += texture2D(tDiffuse, vUv + off * 1.0) * 0.15;
        sum += texture2D(tDiffuse, vUv + off * 2.0) * 0.12;
        sum += texture2D(tDiffuse, vUv + off * 3.0) * 0.09;
        sum += texture2D(tDiffuse, vUv + off * 4.0) * 0.05;
        gl_FragColor = sum;
      }
    `,
    blending: THREE.NoBlending,
    transparent: false,
    depthTest: false,
    depthWrite: false
  });
}

export const Core3D = {
  canvas: null, renderer: null, scene: null, cameraOrtho: null, cameraPersp: null,
  shadowCatcher: null, shadowCatcherFg: null, shadowCatchersDebug: false,
  composer: null, composerTarget: null,

  occlusionTarget: null, occlusionWhiteMaterial: null,
  occlusionBlurTargetA: null, occlusionBlurTargetB: null,
  occlusionBlurScene: null, occlusionBlurCamera: null, occlusionBlurQuad: null,
  occlusionBlurMatH: null, occlusionBlurMatV: null,

  renderPassBg: null, renderPassPlanets: null, renderPassOrtho: null, renderPassFg: null,
  heatHazePass: null, heatHazeSources: null, heatHazeCount: 0, heatHazeMaxSources: MAX_HEAT_HAZE_SOURCES, _heatHazeWorldScratch: new THREE.Vector3(),
  shadowShaftsPass: null,
  bloomPass: null, outputPass: null, bloomResolutionScale: 0.75, bloomBaseStrength: 0.35, bloomBaseThreshold: 0.95,
  msaaSamples: 0,
  perfToggles: { bloom: true, heatHaze: true, shadowShafts: true, bgPass: true, planetPass: true, orthoPass: true, fgPass: true },
  pixelRatio: 1, width: 0, height: 0, isInitialized: false,
  _clearColorScratch: new THREE.Color(),

  init(canvasElement) {
    if (this.isInitialized) return this;

    this.canvas = canvasElement || document.getElementById('webgl-layer');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: 'high-performance', premultipliedAlpha: true, logarithmicDepthBuffer: false });

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
      Math.max(1, Math.floor(window.innerWidth / 2)),
      Math.max(1, Math.floor(window.innerHeight / 2)),
      {
        format: THREE.RGBAFormat,
        type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
        depthBuffer: true
      }
    );
    this.occlusionWhiteMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendEquationAlpha: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor
    });
    const blurRtOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false
    };
    const blurW = Math.max(1, Math.floor(window.innerWidth / 2));
    const blurH = Math.max(1, Math.floor(window.innerHeight / 2));
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
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.pixelRatio);

    // WAZNE: Rejestracja passów do głównego obrazu
    const renderPassBg = new RenderPass(this.scene, this.cameraPersp);
    this.renderPassBg = renderPassBg; renderPassBg.clearColor = new THREE.Color(0x000000); renderPassBg.clearAlpha = 0;
    const origBgRender = renderPassBg.render.bind(renderPassBg);
    renderPassBg.render = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
      this.camera.layers.set(1); origBgRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    };

    const renderPassPlanets = new RenderPass(this.scene, this.cameraPersp);
    this.renderPassPlanets = renderPassPlanets; renderPassPlanets.clear = false;
    const origPlanetsRender = renderPassPlanets.render.bind(renderPassPlanets);
    renderPassPlanets.render = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
      renderer.clearDepth(); this.camera.layers.set(PLANET_RENDER_LAYER); origPlanetsRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    };

    const renderPassOrtho = new RenderPass(this.scene, this.cameraOrtho);
    this.renderPassOrtho = renderPassOrtho; renderPassOrtho.clear = false;
    const origOrthoRender = renderPassOrtho.render.bind(renderPassOrtho);
    renderPassOrtho.render = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
      renderer.clearDepth(); this.camera.layers.set(0); origOrthoRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    };

    const renderPassFg = new RenderPass(this.scene, this.cameraPersp);
    this.renderPassFg = renderPassFg; renderPassFg.clear = false;
    const origFgRender = renderPassFg.render.bind(renderPassFg);
    renderPassFg.render = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
      renderer.clearDepth(); this.camera.layers.set(2); origFgRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    };

    // 1. Tło, planety, statek, budynki (Całość sceny 3D)
    this.composer.addPass(renderPassBg);
    this.composer.addPass(renderPassPlanets);
    this.composer.addPass(renderPassOrtho);
    this.composer.addPass(renderPassFg);

    // 2. Efekty Post-Process (W tym nasza okluzja) NA SAMYM KOŃCU
    this.heatHazeSources = new Float32Array(this.heatHazeMaxSources * 4);
    this.heatHazePass = new ShaderPass(createHeatHazeShader(this.heatHazeMaxSources));
    this.composer.addPass(this.heatHazePass);

    this.shadowShaftsPass = new ShaderPass(createShadowShaftsShader());
    this.composer.addPass(this.shadowShaftsPass); // <-- TERAZ OBLEWA CZYSTYM CIENIEM WSZYSTKIE 4 WARSTWY

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

    // Kolejność passów:
    // bg -> planets -> shadowShafts -> ortho -> fg -> heatHaze -> bloom -> alpha -> output
    // Dzięki temu cień planet nie wpływa na statek/ring/budynki (warstwy ortho/fg).
    const movePassBefore = (passToMove, beforePass) => {
      if (!passToMove || !beforePass || !this.composer?.passes) return;
      const passes = this.composer.passes;
      const from = passes.indexOf(passToMove);
      const to = passes.indexOf(beforePass);
      if (from < 0 || to < 0 || from === to) return;
      const [entry] = passes.splice(from, 1);
      const target = passes.indexOf(beforePass);
      if (target >= 0) passes.splice(target, 0, entry);
      else passes.push(entry);
    };
    movePassBefore(this.shadowShaftsPass, this.renderPassOrtho);
    movePassBefore(this.heatHazePass, this.bloomPass);

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
    if (this.renderPassOrtho) this.renderPassOrtho.enabled = t.orthoPass !== false;
    if (this.renderPassFg) this.renderPassFg.enabled = t.fgPass !== false;
    if (this.bloomPass) this.bloomPass.enabled = t.bloom !== false;
    if (this.heatHazePass) this.heatHazePass.enabled = t.heatHaze !== false;
    if (this.shadowShaftsPass) this.shadowShaftsPass.enabled = t.shadowShafts !== false;
  },

  setPerfToggles(next = {}) {
    if (!next || typeof next !== 'object') return this.getPerfStatus();
    const t = this.perfToggles || (this.perfToggles = {});
    if ('godRays' in next) t.shadowShafts = !!next.godRays;
    Object.assign(t, next);
    this._applyPassToggles();
    return this.getPerfStatus();
  },

  setMsaaEnabled(enabled = true, samples = 4) { return this.getPerfStatus(); },
  getPerfStatus() { return { isInitialized: !!this.isInitialized }; },
  enableBackground3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(1); }); },
  enablePlanet3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(PLANET_RENDER_LAYER); }); },
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
      this.occlusionTarget.setSize(
        Math.max(1, Math.floor(width / 2)),
        Math.max(1, Math.floor(height / 2))
      );
    }
    if (this.occlusionBlurTargetA && this.occlusionBlurTargetB) {
      const blurW = Math.max(1, Math.floor(width / 2));
      const blurH = Math.max(1, Math.floor(height / 2));
      this.occlusionBlurTargetA.setSize(blurW, blurH);
      this.occlusionBlurTargetB.setSize(blurW, blurH);
      if (this.occlusionBlurMatH?.uniforms?.uResolution) this.occlusionBlurMatH.uniforms.uResolution.value.set(blurW, blurH);
      if (this.occlusionBlurMatV?.uniforms?.uResolution) this.occlusionBlurMatV.uniforms.uResolution.value.set(blurW, blurH);
    }

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
    const camX = gameCamera.x + (Number(shake?.x) || 0);
    const camY = -(gameCamera.y + (Number(shake?.y) || 0));
    this.cameraOrtho.position.set(camX, camY, 150000);
    this.cameraPersp.position.set(camX, camY, targetZ);
    this.cameraPersp.lookAt(camX, camY, 0);
    if (this.shadowCatcher) this.shadowCatcher.position.set(camX, camY, -2);
    if (this.shadowCatcherFg) this.shadowCatcherFg.position.set(camX, camY, -100);
  },

  render() {
    if (!this.isInitialized) return;

    this._applyPassToggles();

    const raysEnabled = this.perfToggles?.shadowShafts !== false;

    if (raysEnabled && this.shadowShaftsPass) {

      const prevAutoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;

      const prevTarget = this.renderer.getRenderTarget();
      const prevClearAlpha = this.renderer.getClearAlpha();
      const prevClearColor = this._clearColorScratch;
      this.renderer.getClearColor(prevClearColor);
      const prevLayerMask = this.cameraPersp.layers.mask;
      const prevOverrideMaterial = this.scene.overrideMaterial;

      const OVERSCAN = 3.0;

      const origLeft = this.cameraOrtho.left;
      const origRight = this.cameraOrtho.right;
      const origTop = this.cameraOrtho.top;
      const origBottom = this.cameraOrtho.bottom;

      const origPerspZoom = this.cameraPersp.zoom;

      this.cameraOrtho.left *= OVERSCAN;
      this.cameraOrtho.right *= OVERSCAN;
      this.cameraOrtho.top *= OVERSCAN;
      this.cameraOrtho.bottom *= OVERSCAN;
      this.cameraOrtho.updateProjectionMatrix();

      this.cameraPersp.zoom /= OVERSCAN;
      this.cameraPersp.updateProjectionMatrix();

      this.renderer.setRenderTarget(this.occlusionTarget);
      this.renderer.setClearColor(0x000000, 0.0);
      this.renderer.clear();

      this.scene.overrideMaterial = this.occlusionWhiteMaterial;
      if (false) {

      // Maska blokerów światła
      this.scene.traverse((child) => {
        if (!child.isMesh && !child.isPoints && !child.isSprite && !child.isLine) return;

        originalStates.set(child, {
          material: child.material,
          visible: child.visible,
          blendState: null
        });

        const isPlanetLayerObject = (child.layers.mask & planetLayerMask) !== 0;
        if (!isPlanetLayerObject) {
          child.visible = false;
          return;
        }

        if (child.name === 'SunMesh' || child.name === 'Nebula' || child.isPoints || child.isSprite) {
          child.visible = false;
          return;
        }

        if (child.material && child.material.uniforms && child.material.uniforms.uIsOcclusion !== undefined) {
          const mat = child.material;
          const state = originalStates.get(child);
          if (state) {
            state.blendState = {
              transparent: mat.transparent,
              depthWrite: mat.depthWrite,
              blending: mat.blending,
              blendEquation: mat.blendEquation,
              blendEquationAlpha: mat.blendEquationAlpha,
              blendSrc: mat.blendSrc,
              blendDst: mat.blendDst,
              blendSrcAlpha: mat.blendSrcAlpha,
              blendDstAlpha: mat.blendDstAlpha
            };
          }
          child.visible = true;
          mat.uniforms.uIsOcclusion.value = 1;
          mat.transparent = true;
          mat.depthWrite = false;
          mat.blending = THREE.CustomBlending;
          mat.blendEquation = THREE.MaxEquation;
          mat.blendEquationAlpha = THREE.MaxEquation;
          mat.blendSrc = THREE.OneFactor;
          mat.blendDst = THREE.OneFactor;
          mat.blendSrcAlpha = THREE.OneFactor;
          mat.blendDstAlpha = THREE.OneFactor;
          return;
        }

        if (child.material) {
          const mat = child.material;
          if (mat.blending === THREE.AdditiveBlending) {
            child.visible = false;
            return;
          }
          if (mat.uniforms && mat.uniforms.cloudTexture) {
            child.visible = false;
            return;
          }
          if (mat.transparent === true) {
            child.visible = false;
            return;
          }
        }

        child.material = this.occlusionWhiteMaterial;
      });

      this.cameraPersp.layers.set(3);
      this.renderer.render(this.scene, this.cameraPersp);

      // Restore oryginalnych materiałów
      this.scene.traverse((child) => {
        const state = originalStates.get(child);
        if (state) {
          child.visible = state.visible;
          if (state.blendState && child.material === state.material) {
            child.material.transparent = state.blendState.transparent;
            child.material.depthWrite = state.blendState.depthWrite;
            child.material.blending = state.blendState.blending;
            child.material.blendEquation = state.blendState.blendEquation;
            child.material.blendEquationAlpha = state.blendState.blendEquationAlpha;
            child.material.blendSrc = state.blendState.blendSrc;
            child.material.blendDst = state.blendState.blendDst;
            child.material.blendSrcAlpha = state.blendState.blendSrcAlpha;
            child.material.blendDstAlpha = state.blendState.blendDstAlpha;
          }
          child.material = state.material;
          if (child.material && child.material.uniforms && child.material.uniforms.uIsOcclusion !== undefined) {
            child.material.uniforms.uIsOcclusion.value = 0;
          }
        }
      });
      }

      this.cameraPersp.layers.set(OCCLUSION_RENDER_LAYER);
      this.renderer.render(this.scene, this.cameraPersp);
      this.scene.overrideMaterial = prevOverrideMaterial;
      this.cameraPersp.layers.mask = prevLayerMask;

      this.cameraOrtho.left = origLeft;
      this.cameraOrtho.right = origRight;
      this.cameraOrtho.top = origTop;
      this.cameraOrtho.bottom = origBottom;
      this.cameraOrtho.updateProjectionMatrix();

      this.cameraPersp.zoom = origPerspZoom;
      this.cameraPersp.updateProjectionMatrix();

      let occlusionTexture = this.occlusionTarget.texture;
      if (
        this.occlusionBlurTargetA &&
        this.occlusionBlurTargetB &&
        this.occlusionBlurScene &&
        this.occlusionBlurCamera &&
        this.occlusionBlurQuad &&
        this.occlusionBlurMatH &&
        this.occlusionBlurMatV
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

      this.shadowShaftsPass.material.uniforms.uOcclusionMap.value = occlusionTexture;

      // PRZYWRÓCONA: Matematyka płaskich cieni kierunkowych z symulacji 
      const sun = typeof window !== 'undefined' ? window.SUN : null;
      let dirX = 0.0;
      let dirY = 1.0;

      if (sun) {
        // Szukamy wektora od kamery 2D w stronę słońca. (Canvas Y jest odwrócony względem Three.js Y)
        dirX = sun.x - this.cameraOrtho.position.x;
        dirY = (-sun.y) - this.cameraOrtho.position.y;
      }

      this.shadowShaftsPass.material.uniforms.uSunDirection.value.set(dirX, dirY);
      this.shadowShaftsPass.material.uniforms.uAspectRatio.value = this.width / this.height;
      this.shadowShaftsPass.material.uniforms.uOverscan.value = OVERSCAN;

      const worldHeight = Math.abs(origTop - origBottom);
      const desiredWorldShadowLength = 20000.0;
      const minUvLength = 0.15;
      const uvLength = worldHeight > 0 ? (desiredWorldShadowLength / worldHeight) : 0.5;

      this.shadowShaftsPass.material.uniforms.uShadowLength.value = Math.max(minUvLength, Math.min(uvLength, 0.8));
      this.shadowShaftsPass.material.uniforms.uTime.value = performance.now() * 0.001;
    }

    if (this.bloomPass && this.perfToggles?.bloom !== false) {
      this.bloomPass.strength = this.bloomBaseStrength * 1.5;
    }

    if (this.heatHazePass?.material?.uniforms) {
      const heatEnabled = this.perfToggles?.heatHaze !== false;
      const heatCount = Math.max(0, Math.min(this.heatHazeCount | 0, this.heatHazeMaxSources | 0));
      this.heatHazePass.enabled = heatEnabled && heatCount > 0;
      if (heatEnabled) {
        const uniforms = this.heatHazePass.material.uniforms;
        uniforms.uTime.value = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
        uniforms.uSourceCount.value = heatCount;
        uniforms.uGlobalStrength.value = 1.0;
        const dst = uniforms.uHeatSources.value;
        const src = this.heatHazeSources;
        for (let i = 0; i < heatCount; i++) {
          const base = i * 4;
          dst[i].set(src[base + 0], src[base + 1], src[base + 2], src[base + 3]);
        }
      }
    }

    this.composer.render();
  },

  beginHeatHazeFrame() { this.heatHazeCount = 0; },
  beginGodRaysFrame() { },
  pushHeatHazeWorld(worldX, worldY, worldZ = -4, radiusWorld = 80, strength = 1.0) {
    if (!this.isInitialized || !this.heatHazeSources || !this.cameraOrtho) return false;
    if ((this.perfToggles?.heatHaze) === false) return false;
    const maxSources = this.heatHazeMaxSources | 0;
    if (this.heatHazeCount >= maxSources) return false;

    const x = Number(worldX);
    const y = Number(worldY);
    const z = Number(worldZ);
    const radius = Math.max(1e-4, Number(radiusWorld) || 0);
    const amp = Math.max(0.0, Math.min(4.0, Number(strength) || 0));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(radius) || !Number.isFinite(amp)) return false;
    if (amp <= 0.0001) return false;

    const cam = this.cameraOrtho;
    const left = cam.position.x + cam.left;
    const right = cam.position.x + cam.right;
    const bottom = cam.position.y + cam.bottom;
    const top = cam.position.y + cam.top;
    const worldW = Math.max(1e-4, right - left);
    const worldH = Math.max(1e-4, top - bottom);

    const u = (x - left) / worldW;
    const v = (y - bottom) / worldH;
    const rUv = radius / Math.min(worldW, worldH);
    const zoomNow = Math.max(0.0001, this.width / worldW);
    const ampZoomScale = Math.max(0.22, Math.min(1.0, zoomNow));
    const ampScaled = amp * ampZoomScale;

    if (u < -rUv || u > 1.0 + rUv || v < -rUv || v > 1.0 + rUv) return false;

    const outBase = this.heatHazeCount * 4;
    this.heatHazeSources[outBase + 0] = u;
    this.heatHazeSources[outBase + 1] = v;
    this.heatHazeSources[outBase + 2] = rUv;
    this.heatHazeSources[outBase + 3] = ampScaled;
    this.heatHazeCount++;
    return true;
  },
  pushGodRayWorld() { },

  setShadowCatchersDebug(enabled = true) { },
  toggleShadowCatchersDebug() { }
};
