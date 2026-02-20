import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- SHADER DO ZACHOWANIA PRZEZROCZYSTOSCI ---
const PreserveAlphaOutputShader = {
  name: 'PreserveAlphaOutputShader',
  uniforms: {
    tDiffuse: { value: null },
    tMask: { value: null }
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
    uniform sampler2D tMask;
    varying vec2 vUv;

    vec3 _srgbEncode3(in vec3 linearRGB) {
      vec3 cutoff = step(vec3(0.0031308), linearRGB);
      vec3 lower = 12.92 * linearRGB;
      vec3 higher = 1.055 * pow(linearRGB, vec3(1.0/2.4)) - 0.055;
      return mix(lower, higher, cutoff);
    }
    vec4 _srgbEncode4(in vec4 linearRGBA) {
      return vec4(_srgbEncode3(linearRGBA.rgb), linearRGBA.a);
    }

    void main() {
      vec4 texColor = texture2D(tDiffuse, vUv);
      float a = texColor.a;

      vec4 outLinear = vec4(texColor.rgb * a, a);
      #ifdef SRGB_COLOR_SPACE
        outLinear = _srgbEncode4(outLinear);
      #endif
      gl_FragColor = outLinear;
    }
  `
};

export const Core3D = {
  canvas: null,
  renderer: null,
  scene: null,
  camera: null,
  shadowCatcher: null,
  composer: null,
  bloomPass: null,
  bloomResolutionScale: Math.SQRT1_2,
  bloomBaseStrength: 0.31,
  bloomBaseThreshold: 0.2,
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
    this.renderer.shadowMap.enabled = false;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400000);
    this.camera.position.set(0, 0, 150000);
    this.camera.lookAt(0, 0, 0);

    this.shadowCatcher = null;

    const canUseHalfFloatRt =
      this.renderer.capabilities.isWebGL2 ||
      !!this.renderer.extensions.get('EXT_color_buffer_half_float') ||
      !!this.renderer.extensions.get('EXT_color_buffer_float');

    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      format: THREE.RGBAFormat,
      type: canUseHalfFloatRt ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      samples: this.renderer.capabilities.isWebGL2 ? 4 : 0
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.pixelRatio);

    const renderPass = new RenderPass(this.scene, this.camera);
    renderPass.clearColor = new THREE.Color(0x000000);
    renderPass.clearAlpha = 0;
    this.composer.addPass(renderPass);

    const bloomScale = Math.max(0.1, Math.min(1, Number(this.bloomResolutionScale) || Math.SQRT1_2));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(
        Math.max(1, Math.floor(window.innerWidth * bloomScale)),
        Math.max(1, Math.floor(window.innerHeight * bloomScale))
      ),
      this.bloomBaseStrength,
      0.18,
      this.bloomBaseThreshold
    );
    this.bloomPass = bloomPass;
    this.composer.addPass(bloomPass);

    const alphaPass = new ShaderPass(PreserveAlphaOutputShader);
    alphaPass.renderToScreen = true;
    if (this.renderer.outputColorSpace === THREE.SRGBColorSpace) {
      alphaPass.material.defines = { SRGB_COLOR_SPACE: '' };
    }
    this.composer.addPass(alphaPass);

    this.isInitialized = true;
    this.resize(window.innerWidth, window.innerHeight);

    console.log('Core3D initialized.');
    return this;
  },

  resize(w, h) {
    if (!this.isInitialized) return;

    const width = Math.max(1, w | 0);
    const height = Math.max(1, h | 0);
    const dpr = (typeof window !== 'undefined' ? Number(window.devicePixelRatio) : 1) || 1;
    const nextPixelRatio = Math.min(1.5, Math.max(1, dpr));
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
      const bloomScale = Math.max(0.1, Math.min(1, Number(this.bloomResolutionScale) || Math.SQRT1_2));
      const bloomW = Math.max(1, Math.floor(width * this.pixelRatio * bloomScale));
      const bloomH = Math.max(1, Math.floor(height * this.pixelRatio * bloomScale));
      this.bloomPass.setSize(bloomW, bloomH);
    }

    const halfW = width * 0.5;
    const halfH = height * 0.5;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  },

  syncCamera(gameCamera) {
    if (!this.isInitialized || !gameCamera) return;
    const zoom = Math.max(0.0001, gameCamera.zoom || 1);
    const halfW = (this.width / 2) / zoom;
    const halfH = (this.height / 2) / zoom;

    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();

    this.camera.position.set(gameCamera.x, -gameCamera.y, 150000);
  },

  render() {
    if (!this.isInitialized) return;

    if (this.bloomPass && typeof window !== 'undefined') {
      const bloomCfg = window?.DevVFX?.bloom;
      const manualStrength = Number(bloomCfg?.strength);
      const manualRadius = Number(bloomCfg?.radius);
      const manualThreshold = Number(bloomCfg?.threshold);
      const hasManualBloom =
        Number.isFinite(manualStrength) ||
        Number.isFinite(manualRadius) ||
        Number.isFinite(manualThreshold);

      if (hasManualBloom) {
        if (Number.isFinite(manualStrength)) this.bloomPass.strength = Math.max(0, Math.min(5, manualStrength));
        if (Number.isFinite(manualRadius)) this.bloomPass.radius = Math.max(0, Math.min(2, manualRadius));
        if (Number.isFinite(manualThreshold)) this.bloomPass.threshold = Math.max(0, Math.min(2, manualThreshold));
      } else {
        const gainRaw = Number(window?.OPTIONS?.vfx?.bloomGain);
        if (Number.isFinite(gainRaw)) {
          const gain = Math.min(4.0, Math.max(0.2, gainRaw));
          this.bloomPass.strength = this.bloomBaseStrength * gain;
          this.bloomPass.threshold = Math.max(0, Math.min(2, this.bloomBaseThreshold - (gain - 1.0) * 0.2));
        }
      }
    }

    this.composer.render();
  }
};
