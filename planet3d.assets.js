// planet3d.assets.js

// Bridge/shim dla worldToScreen w module:
function worldToScreen(x, y, cam){
  const fn = (typeof window !== 'undefined') ? window.worldToScreen : null;
  if (typeof fn === 'function') return fn(x, y, cam);
  const z  = cam?.zoom ?? 1;
  const cx = cam?.x ?? 0;
  const cy = cam?.y ?? 0;
  const W  = (typeof window !== 'undefined' && typeof window.innerWidth  === 'number') ? window.innerWidth  : 0;
  const H  = (typeof window !== 'undefined' && typeof window.innerHeight === 'number') ? window.innerHeight : 0;
  return { x: (x - cx) * z + W/2, y: (y - cy) * z + H/2 };
}

function clamp01(v){ return Math.min(1, Math.max(0, v)); }
function smoothstep01(t){ const x = clamp01(t); return x * x * (3 - 2 * x); }
function lerp(a, b, t){ return a + (b - a) * t; }

function computeZoneScale(body){
  const ship = (typeof window !== 'undefined') ? window.ship : null;
  const pos = ship?.pos;
  if (!pos || !body) return 1;

  const bx = Number.isFinite(body.x) ? body.x : 0;
  const by = Number.isFinite(body.y) ? body.y : 0;
  const approachRange = (typeof window !== 'undefined' && typeof window.ZONE_APPROACH_DISTANCE === 'number')
    ? window.ZONE_APPROACH_DISTANCE
    : 0;
  const baseRadiusRaw =
    Number.isFinite(body.baseR) ? body.baseR
      : Number.isFinite(body.r) ? body.r
      : Number.isFinite(body.radius) ? body.radius
      : (Number.isFinite(body.size) ? body.size * 0.5 : 0);
  const baseOrbitRadius = Math.max(10, baseRadiusRaw * 2);
  const outerOrbitExtra = Math.max(1600, approachRange * 0.6);
  const orbitRadius = baseOrbitRadius + outerOrbitExtra;
  const dx = pos.x - bx;
  const dy = pos.y - by;
  const dist = Math.hypot(dx, dy);
  const edgeDist = dist - orbitRadius;
  const transitionRange = Math.max(10, approachRange);

  const shrinkMin = 0.4;
  const growMax = 1.12;

  if (edgeDist <= 0) {
    return growMax;
  }

  const t = smoothstep01(1 - edgeDist / transitionRange);
  return lerp(shrinkMin, growMax, t);
}

if (typeof window !== 'undefined' && !window.getSharedRenderer) {
  window.getSharedRenderer = (w = 512, h = 512) => {
    const THREE_NS = window.THREE;
    if (!THREE_NS) return null;
    let renderer = window.__sharedRenderer;
    if (!renderer) {
      renderer = new THREE_NS.WebGLRenderer({
        antialias: true,
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true
      });
      renderer.outputColorSpace = THREE_NS.SRGBColorSpace;
      renderer.toneMapping = THREE_NS.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.5;
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE_NS.PCFSoftShadowMap;
      window.__sharedRenderer = renderer;
    }
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (typeof renderer.setPixelRatio === 'function') renderer.setPixelRatio(pixelRatio);
    if (typeof renderer.setSize === 'function') renderer.setSize(w, h, false);
    return renderer;
  };
}

(function () {
  // ======= WSPÓŁDZIELONY RENDERER =======
  function getSharedRenderer(width = 256, height = 256) {
    if (typeof window !== 'undefined' && typeof window.getSharedRenderer === 'function') {
      return window.getSharedRenderer(width, height);
    }
    if (typeof THREE === "undefined") return null;
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (typeof window !== 'undefined') {
      window.__sharedRenderer = renderer;
      window.getSharedRenderer = (w = width, h = height) => {
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        if (typeof renderer.setPixelRatio === 'function') renderer.setPixelRatio(pixelRatio);
        if (typeof renderer.setSize === 'function') renderer.setSize(w, h, false);
        return renderer;
      };
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      if (typeof renderer.setPixelRatio === 'function') renderer.setPixelRatio(pixelRatio);
      if (typeof renderer.setSize === 'function') renderer.setSize(width, height, false);
    }
    return renderer;
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

  function updateSunLightForPlanet(light, planetWorldX, planetWorldY) {
    if (!light || typeof THREE === 'undefined') return;
    const sunObj = (typeof window !== 'undefined' ? window.SUN : null) || { x: 0, y: 0 };
    const dx = (sunObj.x ?? 0) - planetWorldX;
    const dy = (sunObj.y ?? 0) - planetWorldY;
    const L = Math.hypot(dx, dy) || 1;
    const v = new THREE.Vector3(dx / L, -dy / L, 0.001);
    if (v.lengthSq() === 0) return;
    v.normalize().multiplyScalar(600);
    light.position.copy(v);
    if (light.target) {
      light.target.position.set(0, 0, 0);
      light.target.updateMatrixWorld();
    }
  }

  // --- ZMIANA: NOWA ŚCIEŻKA (do folderu public) ---
  const assetUrl = (path) => {
    // Zabezpieczenie przed błędami
    if (!path || path.includes('undefined')) return '';
    // Ścieżka absolutna do folderu public/assets
    return `/assets/${path}`;
  };

  let _sharedTextureLoader = null;
  function getTextureLoader() {
    if (typeof THREE === 'undefined') return null;
    if (!_sharedTextureLoader) {
      _sharedTextureLoader = new THREE.TextureLoader();
    }
    return _sharedTextureLoader;
  }

  // --- ZABEZPIECZENIE: FALLBACK TEXTURE (Szary kwadrat) ---
  // Jeśli tekstury nie ma, użyjemy tego, zamiast wywalić grę.
  let _fallbackTexture = null;
  function getFallbackTexture() {
    if (_fallbackTexture) return _fallbackTexture;
    if (typeof THREE === 'undefined') return null;
    const cvs = document.createElement('canvas');
    cvs.width = 2; cvs.height = 2;
    const ctx = cvs.getContext('2d');
    ctx.fillStyle = '#888888'; // Szary
    ctx.fillRect(0,0,2,2);
    _fallbackTexture = new THREE.CanvasTexture(cvs);
    _fallbackTexture.colorSpace = THREE.SRGBColorSpace;
    return _fallbackTexture;
  }

  function loadTextureSafe(url, { srgb = false } = {}) {
    return new Promise((resolve) => {
      if (!url) { resolve(getFallbackTexture()); return; }
      const loader = getTextureLoader();
      if (!loader) { resolve(null); return; }
      
      loader.load(
        url,
        (tex) => {
          if (tex && srgb) tex.colorSpace = THREE.SRGBColorSpace;
          resolve(tex);
        },
        undefined,
        (err) => {
          // Błąd ładowania (np. 404) - zwracamy fallback
          console.warn('Texture missing (using fallback):', url);
          resolve(getFallbackTexture());
        }
      );
    });
  }

  const SUN_COLOR = assetUrl('planety/solar/sun/sun_color.jpg');
  const ASTEROIDS_GLB = assetUrl('planety/asteroids/asteroidPack.glb');

  const EARTH_NORMAL_EXT = 'jpg';
  const EARTH_SPEC_EXT = 'jpg';
  const TEX = {
    mercury: { color: assetUrl('planety/solar/mercury/mercury_color.jpg'),
               normal:assetUrl('planety/solar/mercury/mercury_normal.jpg') },
    venus:   { color: assetUrl('planety/solar/venus/venus_color.jpg'),
               bump:  assetUrl('planety/images/venusbump.jpg'),
               atmo:  assetUrl('planety/images/venus_atmosphere.jpg') },
    earth:   { color: assetUrl('planety/solar/earth/earth_color.jpg'),
               normal:assetUrl(`planety/solar/earth/earth_normal.${EARTH_NORMAL_EXT}`),
               spec:  assetUrl(`planety/images/earth_specularmap.${EARTH_SPEC_EXT}`),
               night: assetUrl('planety/images/earth_nightmap.jpg'),
               clouds:assetUrl('planety/solar/earth/earth_clouds.jpg') },
    mars:    { color: assetUrl('planety/solar/mars/mars_color.jpg'),
               bump:  assetUrl('planety/images/marsbump.jpg') },
    jupiter: { color: assetUrl('planety/solar/jupiter/jupiter_color.jpg') },
    saturn:  { color: assetUrl('planety/solar/saturn/saturn_color.jpg'),
               ring:  assetUrl('planety/solar/saturn/rings_alpha.png') },
    uranus:  { color: assetUrl('planety/solar/uranus/uranus_color.jpg'),
               ring:  assetUrl('planety/images/uranus_ring.png') },
    neptune: { color: assetUrl('planety/solar/neptune/neptune_color.jpg') },
  };

  const _planets = [];
  let sun = null;
  let asteroidBelt = null;
  const TAU = Math.PI * 2;
  const PLANET_SIZE_MULTIPLIER = 4.5;
  const SUN_SIZE_MULTIPLIER = 6.0;
  const ASTEROID_SCALE_MIN = 0.01;
  const ASTEROID_SCALE_MAX = 0.035;

  function sunDirFor(worldX, worldY) {
    const sx = (window.SUN?.x ?? 0) - worldX;
    const sy = (window.SUN?.y ?? 0) - worldY;
    const L = Math.hypot(sx, sy) || 1;
    return { x: sx / L, y: -sy / L, z: 0 };
  }

  class AssetPlanet3D {
    constructor(worldX, worldY, pixelSize, opts = {}) {
      this.x = worldX; this.y = worldY;
      this.size = pixelSize || 64;
      this.ref = opts.ref || null;

      this.canvas = document.createElement("canvas");
      this.canvas.width = 1536; this.canvas.height = 1536;
      this.ctx2d = this.canvas.getContext("2d");
      this._name = String((opts && (opts.name ?? opts.id)) ?? "").toLowerCase();
      if (!this._name || !TEX[this._name]) this._name = 'earth';
      this._needsInit = true;
      this._initPromise = null;
      this.spin = 0.01 + Math.random() * 0.02; 
    }

    async _initThree() {
      if (typeof THREE === "undefined") return;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      this.camera.position.z = 3;

      const geom = new THREE.SphereGeometry(1, 192, 128);
      const tex = TEX[this._name] || {};

      const [
        colorMap,
        normalMap,
        bumpMap,
        specMap,
        nightMap,
        cloudsMap,
        ringMap
      ] = await Promise.all([
        loadTextureSafe(tex.color,  { srgb: true }),
        loadTextureSafe(tex.normal, { srgb: false }),
        loadTextureSafe(tex.bump,   { srgb: false }),
        loadTextureSafe(tex.spec,   { srgb: false }),
        loadTextureSafe(tex.night,  { srgb: true }),
        loadTextureSafe(tex.clouds, { srgb: true }),
        loadTextureSafe(tex.ring,   { srgb: true })
      ]);
      const renderer = getSharedRenderer();
      const maxAnisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
      [colorMap, normalMap, bumpMap, specMap, nightMap, cloudsMap, ringMap].forEach(map => {
        if (map && map !== getFallbackTexture()) {
          map.anisotropy = maxAnisotropy;
          map.needsUpdate = true;
        }
      });

      const vert = `
        varying vec2 vUv; varying vec3 vN;
        void main() {
          vUv = uv;
          vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }`;

      const fragDN = `
        uniform sampler2D dayTexture;
        uniform sampler2D nightTexture;
        uniform vec3 uLightDir;
        uniform float minAmbient;
        uniform float uIntensity;
        varying vec2 vUv; varying vec3 vN;
        void main(){
          float ndl = max(dot(normalize(vN), normalize(uLightDir)), 0.0);
          vec4 dayC   = texture2D(dayTexture,   vUv);
          vec4 nightC = texture2D(nightTexture, vUv) * 1.0;
          float k = clamp(minAmbient + (1.0 - minAmbient) * ndl, 0.0, 1.0);
          vec4 mixedColor = mix(nightC, dayC, k);
          gl_FragColor = vec4(mixedColor.rgb * uIntensity, mixedColor.a);
        }`;

      const fragDay = `
        uniform sampler2D dayTexture;
        uniform vec3 uLightDir;
        uniform float minAmbient;
        uniform float uIntensity;
        varying vec2 vUv; varying vec3 vN;
        void main(){
          float ndl = max(dot(normalize(vN), normalize(uLightDir)), 0.0);
          vec4 dayC = texture2D(dayTexture, vUv);
          float k = clamp(minAmbient + (1.0 - minAmbient) * ndl, 0.0, 1.0);
          gl_FragColor = vec4(dayC.rgb * k * uIntensity, dayC.a);
        }`;

      // Jeśli tekstura nocna to fallback, nie używamy shadera nocnego
      const realNightMap = (tex.night && nightMap !== getFallbackTexture()) ? nightMap : null;
      const useNight = !!realNightMap;

      const uniforms = {
        dayTexture:   { value: colorMap || getFallbackTexture() },
        nightTexture: { value: realNightMap || null },
        uLightDir:    { value: new THREE.Vector3(1, 0, 0) },
        minAmbient:   { value: 0.08 },
        uIntensity:   { value: 1.5 }
      };

      this.material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: vert,
        fragmentShader: useNight ? fragDN : fragDay,
        toneMapped: true
      });

      this.scene.add(new THREE.AmbientLight(0xffffff, 0.08));
      const hemi = new THREE.HemisphereLight(0xbfdfff, 0x0b0f1a, 0.12);
      hemi.position.set(0, 1, 0);
      this.scene.add(hemi);

      const d = sunDirFor(this.x, this.y);
      const sunDL = new THREE.DirectionalLight(0xffffff, 1.15);
      sunDL.castShadow = false;
      sunDL.position.set(d.x * 10, d.y * 10, 0.01);
      sunDL.target.position.set(0, 0, 0);
      this.scene.add(sunDL.target);
      this.scene.add(sunDL);
      this.sunLight = sunDL;

      this.mesh = new THREE.Mesh(geom, this.material);
      this.mesh.receiveShadow = false;
      this.scene.add(this.mesh);

      if (cloudsMap && cloudsMap !== getFallbackTexture()) {
        const clouds = new THREE.Mesh(
          new THREE.SphereGeometry(1.008, 64, 48),
          new THREE.MeshBasicMaterial({
            map: cloudsMap,
            transparent: true,
            depthWrite: false,
            opacity: 0.6,
            blending: THREE.AdditiveBlending 
          })
        );
        clouds.castShadow = false;
        this.scene.add(clouds);
        this.clouds = clouds;
      }

      if (ringMap && ringMap !== getFallbackTexture()) {
        ringMap.anisotropy = 4;
        const ringGeo = new THREE.RingGeometry(1.35, 2.4, 256, 1);
        const ringMat = new THREE.MeshBasicMaterial({ map: ringMap, transparent: true, side: THREE.DoubleSide, opacity: 0.7 });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        this.scene.add(ring);
        this.ring = ring;
      }

      this._initPromise = null;
    }

    render(dt) {
      // Inicjalizacja Three.js, jeśli jeszcze nie nastąpiła
      if (this._needsInit && typeof THREE !== "undefined") {
        this._needsInit = false;
        this._initPromise = this._initThree();
        if (this._initPromise && typeof this._initPromise.catch === 'function') {
          this._initPromise.catch((err) => console.error('AssetPlanet3D init failed', err));
        }
      }
      
      // Jeśli scena nie jest gotowa, przerywamy
      if (!this.scene || !this.camera || !this.mesh) return;

      // Obrót planety i chmur
      this.mesh.rotation.y += this.spin * dt;
      if (this.clouds) this.clouds.rotation.y += this.spin * dt * 1.3;

      // Logika LOD (Level of Detail) - zmiana rozdzielczości w zależności od odległości
      const ship = (typeof window !== 'undefined') ? window.ship : null;
      const pos = ship?.pos;
      
      const RES_LOW = 1024; 
      const RES_HIGH = 2048; 
      
      if (typeof this.isHighRes === 'undefined') this.isHighRes = false;

      if (pos) {
        const dx = pos.x - this.x;
        const dy = pos.y - this.y;
        const dist = Math.hypot(dx, dy);
        const r = this.ref?.r || this.ref?.baseR || (this.size / 2) || 500;

        const ENTER_HIGH_RES = r + 1800; 
        const EXIT_HIGH_RES  = r + 2200; 

        if (!this.isHighRes && dist < ENTER_HIGH_RES) this.isHighRes = true;
        else if (this.isHighRes && dist > EXIT_HIGH_RES) this.isHighRes = false;
      }

      const targetRes = this.isHighRes ? RES_HIGH : RES_LOW;

      if (this.canvas.width !== targetRes) {
        this.canvas.width = targetRes;
        this.canvas.height = targetRes;
        this.frameTimer = 100; 
      }

      const UPDATE_INTERVAL = this.isHighRes ? 0.03 : 0.06;

      this.frameTimer = (this.frameTimer || 0) + dt;

      if (this.frameTimer < UPDATE_INTERVAL) {
        return;
      }

      this.frameTimer %= UPDATE_INTERVAL;
      if (this.frameTimer > 0.1) this.frameTimer = 0; 
      
      // Pobranie renderera
      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r) return;
      resetRendererState(r, this.canvas.width, this.canvas.height);
      
      // Aktualizacja oświetlenia (kierunek słońca)
      if (this.material?.uniforms?.uLightDir && typeof THREE !== 'undefined') {
        if (!this._lightDirView) this._lightDirView = new THREE.Vector3();
        if (!this._viewMatrix3) this._viewMatrix3 = new THREE.Matrix3();
        const d = sunDirFor(this.x, this.y);
        this._lightDirView.set(d.x, d.y, 0);
        this._viewMatrix3.setFromMatrix4(this.camera.matrixWorldInverse);
        this._lightDirView.applyMatrix3(this._viewMatrix3).normalize();
        this.material.uniforms.uLightDir.value.copy(this._lightDirView);
      }
      if (this.sunLight) updateSunLightForPlanet(this.sunLight, this.x, this.y);
      
      // 1. RENDER 3D DO WEWNĘTRZNEGO BUFORA
      r.render(this.scene, this.camera);

      // 2. PRZENIESIENIE NA CANVAS 2D + EFEKT HALO
      const ctx2d = this.ctx2d;
      const w = this.canvas.width;
      const h = this.canvas.height;

      // Czyścimy
      ctx2d.clearRect(0, 0, w, h);

      // Kopiujemy planetę (tryb copy jest szybki i zastępuje piksele)
      ctx2d.globalCompositeOperation = 'copy';
      ctx2d.drawImage(r.domElement, 0, 0, w, h);

      // --- EFEKT HALO (ATMOSFERA) ---
      // Konfiguracja kolorów dla różnych typów planet
      const haloColors = {
        earth:   '#4ca1ff', // Błękitna
        mars:    '#ff6a4d', // Czerwona
        venus:   '#ffcc33', // Żółta/Pomarańczowa
        jupiter: '#e3dccb', // Beżowa
        neptune: '#5b8aff', // Głęboki błękit
        uranus:  '#8bf0ff', // Jasny cyjan
        mercury: '#a8a8a8', // Szara
        saturn:  '#e8dcb5', // Żółtawa
        default: '#88aaff'
      };

      // Wybór koloru na podstawie nazwy planety
      const planetKey = (this._name || '').toLowerCase();
      let colorHex = haloColors.default;
      for (const key in haloColors) {
        if (planetKey.includes(key)) {
          colorHex = haloColors[key];
          break;
        }
      }

      // Ustawienia geometrii
      const cx = w * 0.5;
      const cy = h * 0.5;
      
      const rInner = w * 0.36; // Start na krawędzi
      const rOuter = w * 0.52; // Koniec

      // Tryb 'screen' sprawia, że poświata "świeci" i nie zasłania planety
      ctx2d.globalCompositeOperation = 'screen'; 

      const grad = ctx2d.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
      
      // Tworzenie gradientu
      grad.addColorStop(0.0, colorHex);       
      grad.addColorStop(0.3, colorHex + '55'); 
      grad.addColorStop(1.0, '#00000000');    

      ctx2d.fillStyle = grad;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, rOuter, 0, Math.PI * 2);
      ctx2d.fill();

      // Reset trybu mieszania
      ctx2d.globalCompositeOperation = 'source-over';
    }
    draw(ctx, cam) {
      const ref = this.ref || {};
      const cx = Number.isFinite(ref.x) ? ref.x : this.x;
      const cy = Number.isFinite(ref.y) ? ref.y : this.y;
      const s = worldToScreen(cx, cy, cam);
      const size = this.size * cam.zoom;

      // Skalowanie orbitalne (interplanetary orbit)
      const baseRadius = ref.baseR ?? ref.r ?? (this.size ? this.size/2 : 128);
      const zoneScale = computeZoneScale(ref.baseR || ref.r ? ref : { x: cx, y: cy, r: baseRadius });

      ctx.drawImage(this.canvas, s.x - size * zoneScale/2, s.y - size * zoneScale/2, size * zoneScale, size * zoneScale);
    }
  } 
  class Sun3D {
    constructor(pixelSize) {
      this.x = 0; this.y = 0; this.size = pixelSize || 512;
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1024; this.canvas.height = 1024;
      this.ctx2d = this.canvas.getContext('2d');
      this._needsInit = true;
      this._initPromise = null;
    }
    async _initThree(){
      if (typeof THREE === "undefined") return;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      this.camera.position.z = 3;
      const tex = await loadTextureSafe(SUN_COLOR, { srgb: true });
      const matParams = (tex && tex !== getFallbackTexture()) ? { map: tex } : { color: 0xffcc00 };
      const mat = new THREE.MeshBasicMaterial(matParams);
      this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1.0, 128, 96), mat);
      this.scene.add(this.mesh);
      this._initPromise = null;
    }
    render(dt){
      if (this._needsInit && typeof THREE !== "undefined") {
        this._needsInit = false;
        this._initPromise = this._initThree();
        if (this._initPromise && typeof this._initPromise.catch === 'function') {
          this._initPromise.catch((err) => console.error('Sun3D init failed', err));
        }
      }
      if (!this.scene || !this.camera || !this.mesh) return;
      this.mesh.rotation.y += 0.02*dt;

      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if(!r) return;
      resetRendererState(r, this.canvas.width, this.canvas.height);
      r.render(this.scene, this.camera);

      this.ctx2d.clearRect(0,0,this.canvas.width,this.canvas.height);
      this.ctx2d.drawImage(r.domElement, 0, 0, this.canvas.width, this.canvas.height);
    }
    draw(ctx, cam){
      const sunRef = (typeof window !== 'undefined' && window.SUN) ? window.SUN : { x: this.x, y: this.y, r: this.size * 0.5 };
      const cx = Number.isFinite(sunRef.x) ? sunRef.x : this.x;
      const cy = Number.isFinite(sunRef.y) ? sunRef.y : this.y;
      const s = worldToScreen(cx, cy, cam);
      const zoneScale = computeZoneScale(sunRef);
      const size = this.size * zoneScale * cam.zoom;
      ctx.drawImage(this.canvas, s.x - size/2, s.y - size/2, size, size);
    }
  }

  // ======= Pas asteroid (InstancedMesh) =======
  class AsteroidBelt3D {
    constructor(innerRadius, outerRadius, count = 2500) {
      this.size = outerRadius * 2;
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1024; this.canvas.height = 1024;
      this.ctx2d = this.canvas.getContext('2d');
      this.spin = 0.004;
      this.rotSpeed = 0.01;
      this.innerRadius = innerRadius;
      this.outerRadius = outerRadius;
      this.count = count;

      if (typeof THREE === 'undefined') return;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
      this.camera.position.set(0, 0.6, 4.2);
      this.root = new THREE.Group();
      this.scene.add(this.root);
      this.camera.lookAt(0, 0, 0);
      
      this._initGeometry();
    }

    _initGeometry() {
      const _norm = 1 / this.outerRadius;
      
      const tryLoadGLTF = () => {
        const Loader = (typeof window !== 'undefined') && window.GLTFLoader;
        if (!Loader) { requestAnimationFrame(tryLoadGLTF); return; }
        const loader = new Loader();
        
        loader.load(
          ASTEROIDS_GLB,
          (gltf) => {
            const geos = [];
            gltf.scene.traverse((o) => {
              if (o.isMesh && o.geometry) {
                geos.push(o.geometry.clone());
              }
            });
            if (!geos.length) return;
            const mat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, roughness: 1.0, metalness: 0.0 });
            const imesh = new THREE.InstancedMesh(geos[0], mat, this.count);
            this._fillInstancedMesh(imesh, this.count, _norm);
            this.root.add(imesh);
            this.imesh = imesh;
            this.spin = 0.008;
          },
          undefined,
          (err) => {
            console.warn("Using fallback asteroids (dots)", err);
            this._createFallbackAsteroids(_norm);
          }
        );
      };
      
      if (!ASTEROIDS_GLB) {
        this._createFallbackAsteroids(_norm);
      } else {
        try {
          tryLoadGLTF();
        } catch(e) {
          console.warn("Asteroid load exception", e);
          this._createFallbackAsteroids(_norm);
        }
      }

      const sunWorldX = (window.SUN?.x ?? 0);
      const sunWorldY = (window.SUN?.y ?? 0);
      const beltMidRadius = (this.innerRadius + this.outerRadius) * 0.5;
      const sampleX = sunWorldX + beltMidRadius;
      const sampleY = sunWorldY;
      const d = sunDirFor(sampleX, sampleY);
      const beltDL = new THREE.DirectionalLight(0xffffff, 1.1);
      beltDL.castShadow = true;
      beltDL.position.set(d.x * 50, d.y * 50, d.z * 50);
      beltDL.target.position.set(0, 0, 0);
      this.scene.add(beltDL.target);
      beltDL.shadow.mapSize.set(1024, 1024);
      beltDL.shadow.camera.near = 1;
      beltDL.shadow.camera.far = 200;
      const R = 20;
      beltDL.shadow.camera.left = -R;
      beltDL.shadow.camera.right = R;
      beltDL.shadow.camera.top = R;
      beltDL.shadow.camera.bottom = -R;
      this.scene.add(beltDL);
      this.sunLight = beltDL;
    }

    _createFallbackAsteroids(_norm) {
      const geom = new THREE.BufferGeometry();
      const posArray = new Float32Array(this.count * 3);
      for(let i=0; i<this.count; i++) {
        const a = Math.random() * TAU;
        const rWorld = this.innerRadius + Math.random() * (this.outerRadius - this.innerRadius);
        const r = rWorld * _norm;
        const z = (Math.random() - 0.5) * 0.12;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        posArray[i*3+0] = x;
        posArray[i*3+1] = y;
        posArray[i*3+2] = z;
      }
      geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      const mat = new THREE.PointsMaterial({ color: 0x888888, size: 2, sizeAttenuation: false });
      const points = new THREE.Points(geom, mat);
      this.root.add(points);
    }

    _fillInstancedMesh(imesh, count, _norm) {
      const m = new THREE.Matrix4();
      const rotM = new THREE.Matrix4();
      const scaleM = new THREE.Matrix4();
      const euler = new THREE.Euler();
      for (let i = 0; i < count; i++) {
        const a = Math.random() * TAU;
        const rWorld = this.innerRadius + Math.random() * (this.outerRadius - this.innerRadius);
        const r = rWorld * _norm;               
        const z = (Math.random() - 0.5) * 0.12; 
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        const s = ASTEROID_SCALE_MIN + Math.random() * (ASTEROID_SCALE_MAX - ASTEROID_SCALE_MIN);
        m.makeTranslation(x, y, z);
        euler.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
        rotM.makeRotationFromEuler(euler);
        scaleM.makeScale(s, s, s);
        m.multiply(rotM); m.multiply(scaleM);
        imesh.setMatrixAt(i, m);
      }
      imesh.instanceMatrix.needsUpdate = true;
      imesh.castShadow = true;
      imesh.receiveShadow = true;
    }

    render(dt) {
      if (this.root) this.root.rotation.z += this.spin * dt;
      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r || !this.scene || !this.camera) return;
      if (this.imesh) this.imesh.rotation.z += (this.spin * dt);
      resetRendererState(r, this.canvas.width, this.canvas.height);
      if (this.sunLight) {
        const sunObj = (typeof window !== 'undefined' ? window.SUN : null) || { x: 0, y: 0 };
        const mid = ((this.innerRadius || 0) + (this.outerRadius || 0)) * 0.5;
        const sampleX = (sunObj.x ?? 0) + mid;
        const sampleY = sunObj.y ?? 0;
        updateSunLightForPlanet(this.sunLight, sampleX, sampleY);
      }
      r.render(this.scene, this.camera);
      this.scene.rotation.z += this.rotSpeed * dt;
      this.ctx2d.clearRect(0,0,this.canvas.width,this.canvas.height);
      this.ctx2d.drawImage(r.domElement, 0, 0, this.canvas.width, this.canvas.height);
    }

    draw(ctx, cam) {
      const s = worldToScreen(sun?.x || 0, sun?.y || 0, cam);
      const size = this.size * cam.zoom;
      ctx.drawImage(this.canvas, s.x - size/2, s.y - size/2, size, size);
    }
  }

  const _stations3D = [];

  class PirateStation3D {
    constructor(stationRef, opts = {}) {
      this.ref = stationRef;
      this.spin = 0.08;
      this.baseSize = (opts && opts.size) || 256;
      this.size = this.baseSize;
      
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1024; 
      this.canvas.height = 1024;
      this.ctx2d = this.canvas.getContext('2d', { alpha: true });
      
      this.canvas.style.background = 'transparent';
      this._needsInit = true;
      this._ready = false;
      this._hiResActive = false;
      this.frameTimer = 0;
    }

    _lazyInit() {
      if (!this._needsInit || typeof THREE === 'undefined') return;
      this._needsInit = false;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      this.camera.position.z = 4.2;

      this.scene.add(new THREE.AmbientLight(0x334455, 0.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.1);
      key.position.set(2.5, 3.5, 5.0);
      this.scene.add(key);

      const ringMat    = new THREE.MeshStandardMaterial({ color: 0x7fb2ff, metalness: 0.2, roughness: 0.35, emissive: 0x0a1e3a, emissiveIntensity: 0.7 });
      const innerMat   = new THREE.MeshStandardMaterial({ color: 0x2a3a5a, metalness: 0.1, roughness: 0.8 });
      const hubMat     = new THREE.MeshStandardMaterial({ color: 0x9fd3ff, emissive: 0x164b8c, emissiveIntensity: 1.1, metalness: 0.0, roughness: 0.9 });
      const spokeMat   = new THREE.MeshStandardMaterial({ color: 0x6da8ff, metalness: 0.3, roughness: 0.6 });

      const outerRing = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.07, 20, 128), ringMat);
      outerRing.rotation.x = Math.PI/2;
      this.scene.add(outerRing);

      const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.06, 16, 96), ringMat);
      innerRing.rotation.x = Math.PI/2;
      this.scene.add(innerRing);

      const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 72), innerMat);
      disk.rotation.x = Math.PI/2;
      this.scene.add(disk);

      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.28, 48, 32), hubMat);
      this.scene.add(hub);

      const spokes = 8;
      for (let i=0;i<spokes;i++){
        const a = i*(Math.PI*2/spokes);
        const r = 1.12;
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, r, 12), spokeMat);
        cyl.position.set(Math.cos(a)*r/2, Math.sin(a)*r/2, 0);
        cyl.rotation.z = a + Math.PI/2;
        this.scene.add(cyl);
        const pod = new THREE.Mesh(new THREE.SphereGeometry(0.18, 36, 24), hubMat);
        pod.position.set(Math.cos(a)*r, Math.sin(a)*r, 0);
        this.scene.add(pod);
      }

      this.root = new THREE.Group();
      this.root.add(outerRing, innerRing, disk, hub);
      this.scene.add(this.root);
      this.mesh = this.root;
      this._ready = true;
    }

    render(dt) {
      this._lazyInit();
      if (!this.scene || !this.camera || !this.mesh) return;

      this.mesh.rotation.y += 0.02 * dt;

      const ship = (typeof window !== 'undefined') ? window.ship : null;
      const camZoom = (typeof window !== 'undefined' && window.camera) ? window.camera.zoom : 1;
      const pos = ship?.pos;

      let targetRes = 512;
      let isHighResMode = false;

      if (pos && this.ref) {
        const baseR = this.ref.baseR ?? this.ref.r ?? 128;
        const rawScale = Number(window.Dev?.station3DScale ?? window.DevTuning?.pirateStationScale ?? NaN);
        const scale = (Number.isFinite(rawScale) && rawScale > 0) ? rawScale : 2.70;
        const visiblePixelSize = (baseR * 2 * scale) * camZoom;

        const ENTER_HI = 400; 
        const EXIT_HI  = 300; 

        if (!this._hiResActive && visiblePixelSize > ENTER_HI) this._hiResActive = true;
        else if (this._hiResActive && visiblePixelSize < EXIT_HI) this._hiResActive = false;

        if (this._hiResActive) {
          isHighResMode = true;
          const screenMax = Math.max(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1);
          const optimalRes = Math.min(visiblePixelSize * 1.5, screenMax * 1.5);
          targetRes = Math.min(2048, Math.ceil(optimalRes / 256) * 256);
          targetRes = Math.max(512, targetRes);
        } else {
          targetRes = 512;
        }
      }

      if (this.canvas.width !== targetRes) {
        this.canvas.width = targetRes;
        this.canvas.height = targetRes;
        this.frameTimer = 100; 
      }

      const UPDATE_INTERVAL = isHighResMode ? 0.033 : 0.050;

      this.frameTimer = (this.frameTimer || 0) + dt;
      if (this.frameTimer < UPDATE_INTERVAL) {
        return;
      }
      this.frameTimer %= UPDATE_INTERVAL;
      if (this.frameTimer > 0.1) this.frameTimer = 0;

      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r) return;

      resetRendererState(r, this.canvas.width, this.canvas.height);
      if (r.setClearAlpha) r.setClearAlpha(0);
      this.scene.background = null;

      r.render(this.scene, this.camera);

      const ctx2d = this.ctx2d;
      ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx2d.globalCompositeOperation = 'copy';
      ctx2d.drawImage(r.domElement, 0, 0, this.canvas.width, this.canvas.height);
      ctx2d.globalCompositeOperation = 'source-over';
    }

    draw(ctx, cam) {
      if (!this.ref) return;
      const s = worldToScreen(this.ref.x, this.ref.y, cam);

      const rawScale = Number(window.Dev?.station3DScale ?? window.DevTuning?.pirateStationScale ?? NaN);
      const fallbackScale = (typeof window !== 'undefined' && typeof window.DEFAULT_STATION_3D_SCALE === 'number' && window.DEFAULT_STATION_3D_SCALE > 0)
        ? window.DEFAULT_STATION_3D_SCALE
        : 2.70;
      const scale = (Number.isFinite(rawScale) && rawScale > 0) ? rawScale : fallbackScale;

      const baseRadius = this.ref.baseR ?? this.ref.r ?? (this.size ? this.size/2 : 128);
      const pxSize = baseRadius * 2 * scale * cam.zoom;

      ctx.drawImage(this.canvas, s.x - pxSize/2, s.y - pxSize/2, pxSize, pxSize);
    }
  }

  window.initPlanets3D = function initPlanets3D(list, sunObj) {
    _planets.length = 0;
    for (const s of list) {
      const size = (s.r || 30) * PLANET_SIZE_MULTIPLIER;
      const planet = new AssetPlanet3D(s.x, s.y, size, { name: s.name || s.id || null, type: s.type, ref: s });
      _planets.push(planet);
    }

    if (sunObj) {
      const rawRadius = Number.isFinite(sunObj.r3D) ? sunObj.r3D : (sunObj.r || 200);
      const safeRadius = Number.isFinite(rawRadius) ? rawRadius : 200;
      sun = new Sun3D(safeRadius * SUN_SIZE_MULTIPLIER);
      sun.x = sunObj.x; sun.y = sunObj.y;
    }

    const AU_UNIT = (typeof window !== 'undefined' && window.BASE_ORBIT) ? window.BASE_ORBIT : 3000;
    const beltFromGlobal = (typeof window !== 'undefined' && window.ASTEROID_BELT) ? window.ASTEROID_BELT : null;

    if (beltFromGlobal && Number.isFinite(beltFromGlobal.inner) && Number.isFinite(beltFromGlobal.outer)) {
      asteroidBelt = new AsteroidBelt3D(beltFromGlobal.inner, beltFromGlobal.outer, 3500);
    } 
    else {
      const lastPlanet = list.find(p => (p.name === 'neptune' || p.id === 'neptune')) || list[list.length - 1];
      if (lastPlanet && lastPlanet.orbitRadius) {
        const offsetFromPlanet = 3 * AU_UNIT;
        const width = 2 * AU_UNIT;            
        const startDistance = lastPlanet.orbitRadius + offsetFromPlanet;
        const inner = startDistance;
        const outer = startDistance + width;
        asteroidBelt = new AsteroidBelt3D(inner, outer, 3500);
      } else {
        asteroidBelt = null;
      }
    }
  };
 
  window.updatePlanets3D = function updatePlanets3D(dt) {
    if (sun) sun.render(dt);
    if (asteroidBelt) asteroidBelt.render(dt);
    for (const p of _planets) p.render(dt);
  };

  window.drawPlanets3D = function drawPlanets3D(ctx, cam) {
    if (asteroidBelt) asteroidBelt.draw(ctx, cam);
    for (const p of _planets) p.draw(ctx, cam);
    if (sun) sun.draw(ctx, cam);
  };

  if (!window.initStations3D) {
    window.initStations3D = function initStations3D(list){
      _stations3D.length = 0;
      if (!Array.isArray(list)) return;
      for (const st of list){
        const s3d = new PirateStation3D(st, {});
        _stations3D.push(s3d);
      }
    };
  }

  if (!window.updateStations3D) {
    window.updateStations3D = function updateStations3D(dt){
      for (const s of _stations3D) s.render(dt);
    };
  }

  if (!window.drawStations3D) {
    window.drawStations3D = function drawStations3D(ctx, cam){
      for (const s of _stations3D) s.draw(ctx, cam);
    };
  }

  window.__setStation3DScale = function(k){
    const value = Number(k);
    const fallback = (typeof window !== 'undefined' && typeof window.DEFAULT_STATION_3D_SCALE === 'number'
      && window.DEFAULT_STATION_3D_SCALE > 0)
      ? window.DEFAULT_STATION_3D_SCALE
      : 2.70;
    const v = (Number.isFinite(value) && value > 0) ? value : fallback;
    window.Dev = window.Dev || {};
    window.DevTuning = window.DevTuning || {};
    window.Dev.station3DScale = v;
    window.DevTuning.pirateStationScale = v;
    const cfg = window.DevConfig;
    if (cfg && typeof cfg === 'object') cfg.station3DScale = v;
    try { localStorage.setItem('station3DScale', String(v)); } catch {}
  };

  if (typeof window !== 'undefined' && typeof window.getSharedRenderer !== 'function') {
    window.getSharedRenderer = getSharedRenderer;
  }
})();
