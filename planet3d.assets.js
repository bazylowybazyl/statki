// planet3d.assets.js

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
  // ======= WSPÓŁDZIELONY RENDERER (kopiuj z proc, drobna adaptacja) =======
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
    // (x,z) = (dx, dy), niewielkie podbicie w osi Y (up), by cienie były widoczne
    const v = new THREE.Vector3(dx, 0.6, dy);
    if (v.lengthSq() === 0) return;
    v.normalize().multiplyScalar(600);
    light.position.copy(v);
    if (light.target) {
      light.target.position.set(0, 0, 0);
      light.target.updateMatrixWorld();
    }
  }

  const assetUrl = (path) => new URL(`./src/assets/${path}`, import.meta.url).href;

  let _sharedTextureLoader = null;
  function getTextureLoader() {
    if (typeof THREE === 'undefined') return null;
    if (!_sharedTextureLoader) {
      _sharedTextureLoader = new THREE.TextureLoader();
    }
    return _sharedTextureLoader;
  }

  function loadTextureSafe(url, { srgb = false } = {}) {
    return new Promise((resolve) => {
      if (!url) { resolve(null); return; }
      const loader = getTextureLoader();
      if (!loader) { resolve(null); return; }
      loader.load(
        url,
        (tex) => {
          if (tex && srgb) tex.colorSpace = THREE.SRGBColorSpace;
          resolve(tex || null);
        },
        undefined,
        () => {
          console.warn('Texture missing:', url);
          resolve(null);
        }
      );
    });
  }

  const SUN_COLOR = assetUrl('planety/solar/sun/sun_color.jpg');
  const ASTEROIDS_GLB = assetUrl('planety/asteroids/asteroidPack.glb');

  // === Tekstury dla realnego układu (same ścieżki, bez binarek w PR) ===
  const TEX = {
    mercury: { color: assetUrl('planety/solar/mercury/mercury_color.jpg'),
               normal:assetUrl('planety/solar/mercury/mercury_normal.jpg') },
    venus:   { color: assetUrl('planety/solar/venus/venus_color.jpg'),
               bump:  assetUrl('planety/images/venusbump.jpg'),
               atmo:  assetUrl('planety/images/venus_atmosphere.jpg') },
    earth:   { color: assetUrl('planety/solar/earth/earth_color.jpg'),
               normal:assetUrl('planety/solar/earth/earth_normal.jpg'),
               spec:  assetUrl('planety/images/earth_specularmap.jpg'),
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
    // pluto opcjonalnie:
    // pluto: { color:assetUrl('planety/images/plutomap.jpg'), bump:assetUrl('planety/images/plutobump2k.jpg') }
  };

  const _planets = [];
  let sun = null;
  let asteroidBelt = null;
  const TAU = Math.PI * 2;
  const PLANET_SIZE_MULTIPLIER = 4.5;
  const SUN_SIZE_MULTIPLIER = 6.0;
  const ASTEROID_SCALE_MIN = 0.01;
  const ASTEROID_SCALE_MAX = 0.035;

  // ======= PLANETA Z TEKSTUR =======
  function sunDirFor(worldX, worldY) {
    const sx = (window.SUN?.x ?? 0) - worldX;
    const sy = (window.SUN?.y ?? 0) - worldY;
    const L = Math.hypot(sx, sy) || 1;
    // Spójnie z world3d: mapujemy światowe Y na Three.js Z, a Y (up) lekko > 0 dla cieni
    return { x: sx / L, y: 0.6, z: sy / L };
  }

  class AssetPlanet3D {
    constructor(worldX, worldY, pixelSize, opts = {}) {
      this.x = worldX; this.y = worldY;
      this.size = pixelSize || 64;

      this.canvas = document.createElement("canvas");
      this.canvas.width = 256; this.canvas.height = 256;
      this.ctx2d = this.canvas.getContext("2d");
      this._name = String((opts && (opts.name ?? opts.id)) ?? "").toLowerCase();
      if (!this._name || !TEX[this._name]) this._name = 'earth';
      this._needsInit = true;
      this._initPromise = null;
      this.spin = 0.04 + Math.random() * 0.06;
    }

    async _initThree() {
      if (typeof THREE === "undefined") return;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      this.camera.position.z = 3;

      const geom = new THREE.SphereGeometry(1, 96, 64);
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

      const matParams = {
        color: 0xffffff,
        shininess: 10
      };

      if (colorMap) matParams.map = colorMap;
      if (normalMap) matParams.normalMap = normalMap;
      if (bumpMap) {
        matParams.bumpMap = bumpMap;
        matParams.bumpScale = 0.45;
      }
      if (specMap) matParams.specularMap = specMap;

      this.material = new THREE.MeshPhongMaterial(matParams);

      if (nightMap) {
        this.material.emissive = new THREE.Color(0x111111);
        this.material.emissiveMap = nightMap;
        this.material.emissiveIntensity = 1.0;
      }

      this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));
      const hemi = new THREE.HemisphereLight(0xbfdfff, 0x0b0f1a, 0.18);
      hemi.position.set(0, 1, 0);
      this.scene.add(hemi);

      const d = sunDirFor(this.x, this.y);
      const sunDL = new THREE.DirectionalLight(0xffffff, 1.15);
      sunDL.castShadow = true;
      sunDL.position.set(d.x * 10, d.y * 10, d.z * 10);
      sunDL.target.position.set(0, 0, 0);
      this.scene.add(sunDL.target);
      sunDL.shadow.mapSize.set(1024, 1024);
      sunDL.shadow.camera.near = 0.1;
      sunDL.shadow.camera.far = 30;
      const S = 4;
      sunDL.shadow.camera.left = -S;
      sunDL.shadow.camera.right = S;
      sunDL.shadow.camera.top = S;
      sunDL.shadow.camera.bottom = -S;
      this.scene.add(sunDL);
      this.sunLight = sunDL;

      this.mesh = new THREE.Mesh(geom, this.material);
      this.mesh.receiveShadow = true;
      this.scene.add(this.mesh);

      if (cloudsMap) {
        const clouds = new THREE.Mesh(
          new THREE.SphereGeometry(1.008, 64, 48),
          new THREE.MeshPhongMaterial({
            map: cloudsMap,
            transparent: true,
            depthWrite: false,
            opacity: 0.9
          })
        );
        clouds.castShadow = true;
        this.scene.add(clouds);
        this.clouds = clouds;
      }

      if (ringMap) {
        ringMap.anisotropy = 4;
        const ringGeo = new THREE.RingGeometry(1.35, 2.4, 256, 1);
        const ringMat = new THREE.MeshBasicMaterial({ map: ringMap, transparent: true, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        this.scene.add(ring);
        this.ring = ring;
      }

      this._initPromise = null;
    }

    render(dt) {
      // Lazy init: zainicjuj scenę dopiero kiedy THREE jest dostępne
      if (this._needsInit && typeof THREE !== "undefined") {
        this._needsInit = false;
        this._initPromise = this._initThree();
        if (this._initPromise && typeof this._initPromise.catch === 'function') {
          this._initPromise.catch((err) => console.error('AssetPlanet3D init failed', err));
        }
      }
      if (!this.scene || !this.camera || !this.mesh) return;
      this.mesh.rotation.y += this.spin * dt;
      if (this.clouds) this.clouds.rotation.y += this.spin * dt * 1.3;

      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r) return;
      resetRendererState(r, this.canvas.width, this.canvas.height);
      if (this.sunLight) updateSunLightForPlanet(this.sunLight, this.x, this.y);
      r.render(this.scene, this.camera);

      // skopiuj piksele do prywatnego canvasa 2D
      this.ctx2d.clearRect(0,0,this.canvas.width,this.canvas.height);
      this.ctx2d.drawImage(r.domElement, 0, 0, this.canvas.width, this.canvas.height);
    }

    draw(ctx, cam) {
      const s = worldToScreen(this.x, this.y, cam);
      const size = this.size * cam.zoom;
      ctx.drawImage(this.canvas, s.x - size/2, s.y - size/2, size, size);
    }
  }

  // ======= Słońce (zachowujemy prosty shaderowy wygląd z proc lub teksturę) =======
  class Sun3D {
    constructor(pixelSize) {
      this.x = 0; this.y = 0; this.size = pixelSize || 512;
      this.canvas = document.createElement('canvas');
      this.canvas.width = 256; this.canvas.height = 256;
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
      const matParams = tex ? { map: tex } : { color: 0xffffff };
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
      const s = worldToScreen(this.x, this.y, cam);
      const size = this.size * cam.zoom;
      ctx.drawImage(this.canvas, s.x - size/2, s.y - size/2, size, size);
    }
  }

  // ======= Pas asteroid – kopiuj 1:1 z proceduralnego pliku (geometria instancjonowana) =======
  // UPROSZCZENIE: użyjemy istniejącego loadera GLTF i rysunku jak w proc.
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

      if (typeof THREE === 'undefined') return;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
      this.camera.position.set(0, 0.6, 4.2);
      this.root = new THREE.Group();
      this.scene.add(this.root);
      this.camera.lookAt(0, 0, 0);
      // Normalizacja geometrii do przestrzeni offscreen (0..~2), a nie tysięcy jednostek:
      const _norm = 1 / outerRadius;

      // Ładowanie paczki asteroid z assets (już w repo)
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
            const imesh = new THREE.InstancedMesh(geos[0], mat, count);
            const m = new THREE.Matrix4();
            const rotM = new THREE.Matrix4();
            const scaleM = new THREE.Matrix4();
            const euler = new THREE.Euler();
            for (let i = 0; i < count; i++) {
              // losowa pozycja w torusie
              const a = Math.random() * TAU;
              const rWorld = innerRadius + Math.random() * (outerRadius - innerRadius);
              const r = rWorld * _norm;               // 0..~2 w scenie offscreen
              const z = (Math.random() - 0.5) * 0.12; // grubość pasa w jednostkach sceny
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
            this.root.add(imesh);
            this.imesh = imesh;
            this.spin = 0.008; // bardzo wolna rotacja
          }
        );
      };
      tryLoadGLTF();

      const sunWorldX = (window.SUN?.x ?? 0);
      const sunWorldY = (window.SUN?.y ?? 0);
      const beltMidRadius = (innerRadius + outerRadius) * 0.5;
      const sampleX = sunWorldX + beltMidRadius;
      const sampleY = sunWorldY;
      const d = sunDirFor(sampleX, sampleY);
      const beltDL = new THREE.DirectionalLight(0xffffff, 1.1);
      beltDL.castShadow = true;
      beltDL.position.set(d.x * 50, d.y * 50, d.z * 50);
      beltDL.target.position.set(0, 0, 0);
      this.scene.add(beltDL.target);
      // większa projekcja — pas jest duży
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
      this.canvas.width = 512; this.canvas.height = 512;
      this.ctx2d = this.canvas.getContext('2d', { alpha: true });
      this.canvas.style.background = 'transparent';
      this._needsInit = true;
      this._ready = false;
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
      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r || !this.scene || !this.camera) return;

      // 1) pełna przezroczystość tła
      resetRendererState(r, this.canvas.width, this.canvas.height);
      if (r.setClearAlpha) r.setClearAlpha(0);
      this.scene.background = null;

      // 2) animacje/obroty (jeśli masz jakikolwiek spin)
      if (this.mesh) this.mesh.rotation.y += 0.02 * dt;

      // 3) render + deterministyczne czyszczenie
      r.render(this.scene, this.camera);

      // 4) kopiowanie z zachowaniem kanału alfa
      const ctx2d = this.ctx2d;
      ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx2d.globalCompositeOperation = 'copy';
      ctx2d.drawImage(r.domElement, 0, 0, this.canvas.width, this.canvas.height);
      ctx2d.globalCompositeOperation = 'source-over';
    }

    draw(ctx, cam) {
      // Używamy aktualnych współrzędnych stacji z referencji (bez cache!).
      if (!this.ref) return;
      const s = worldToScreen(this.ref.x, this.ref.y, cam);

      // Skala: z Dev lub DevTuning; fallback = 1.0
      const rawScale =
        Number(window.Dev?.station3DScale ?? window.DevTuning?.pirateStationScale ?? 1);
      const scale = Number.isFinite(rawScale) ? rawScale : 1;

      // Promień bazowy: preferuj baseR jeżeli istnieje, w innym wypadku r
      const baseRadius = this.ref.baseR ?? this.ref.r ?? (this.size ? this.size/2 : 128);
      const pxSize = baseRadius * 2 * scale * cam.zoom;

      // Rysujemy offscreen’owy canvas z WebGL (ma już alfę)
      ctx.drawImage(this.canvas, s.x - pxSize/2, s.y - pxSize/2, pxSize, pxSize);
    }
  }

  // ======= API zgodne z proceduralnym rendererem =======
  window.initPlanets3D = function initPlanets3D(list, sunObj) {
    _planets.length = 0;
    for (const s of list) {
      const size = (s.r || 30) * PLANET_SIZE_MULTIPLIER;
      const planet = new AssetPlanet3D(s.x, s.y, size, { name: s.name || s.id || null, type: s.type });
      _planets.push(planet);
    }

    if (sunObj) {
      sun = new Sun3D((sunObj.r || 200) * SUN_SIZE_MULTIPLIER);
      sun.x = sunObj.x; sun.y = sunObj.y;
    }

    // Pas asteroid między Marsem a Jowiszem (skalowany z istniejących orbit)
    if (list && list.length >= 5 && list[2].orbitRadius && list[3].orbitRadius) {
      const r1 = list[2].orbitRadius, r2 = list[3].orbitRadius;
      const inner = r1 + 0.25*(r2 - r1);
      const outer = r1 + 0.55*(r2 - r1);
      asteroidBelt = new AsteroidBelt3D(inner, outer, 2200);
    } else {
      asteroidBelt = null;
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
    const v = Number.isFinite(value) ? value : 1;
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
