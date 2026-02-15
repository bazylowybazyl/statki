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
      logarithmicDepthBuffer: true
    });

    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400000);
    this.camera.position.set(0, 0, 150000);
    this.camera.lookAt(0, 0, 0);

    const shadowPlaneGeo = new THREE.PlaneGeometry(240000, 240000);
    const shadowPlaneMat = new THREE.ShadowMaterial({
      opacity: 0.55,
      depthWrite: false
    });
    this.shadowCatcher = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.frustumCulled = false;
    this.shadowCatcher.renderOrder = -0.5;
    this.shadowCatcher.position.set(0, 0, -90000);
    this.scene.add(this.shadowCatcher);

    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true
    });
    this.composer = new EffectComposer(this.renderer, rt);

    const renderPass = new RenderPass(this.scene, this.camera);
    renderPass.clearColor = new THREE.Color(0x000000);
    renderPass.clearAlpha = 0;
    this.composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.95,
      0.45,
      0.2
    );
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

    this.width = width;
    this.height = height;

    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);

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
    if (this.shadowCatcher) {
      this.shadowCatcher.position.x = gameCamera.x;
      this.shadowCatcher.position.y = -gameCamera.y;
    }
  },

  render() {
    if (!this.isInitialized) return;
    this.composer.render();
  }
};
