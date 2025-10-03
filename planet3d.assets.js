// planet3d.assets.js
(function () {
  // ======= WSPÓŁDZIELONY RENDERER (kopiuj z proc, drobna adaptacja) =======
  let sharedRenderer = null;
  let rendererWidth = 0, rendererHeight = 0;
  function getSharedRenderer(width = 256, height = 256) {
    if (typeof THREE === "undefined") return null;
    if (!sharedRenderer) {
      sharedRenderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false
      });
      sharedRenderer.outputColorSpace = THREE.SRGBColorSpace;
      sharedRenderer.autoClear = true;
      sharedRenderer.setClearColor(0x000000, 0);
      // cienie
      sharedRenderer.shadowMap.enabled = true;
      sharedRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    if (rendererWidth !== width || rendererHeight !== height) {
      sharedRenderer.setSize(width, height, false);
      rendererWidth = width; rendererHeight = height;
    }
    return sharedRenderer;
  }

  // === Tekstury dla realnego układu (same ścieżki, bez binarek w PR) ===
  const TEX = {
    mercury: { color: 'assets/planety/solar/mercury/mercury_color.jpg',
               normal:'assets/planety/solar/mercury/mercury_normal.jpg' },
    venus:   { color: 'assets/planety/solar/venus/venus_color.jpg',
               bump:  'assets/planety/images/venusbump.jpg',
               atmo:  'assets/planety/images/venus_atmosphere.jpg' },
    earth:   { color: 'assets/planety/solar/earth/earth_color.jpg',
               normal:'assets/planety/solar/earth/earth_normal.jpg',
               spec:  'assets/planety/images/earth_specularmap.jpg',
               night: 'assets/planety/images/earth_nightmap.jpg',
               clouds:'assets/planety/solar/earth/earth_clouds.jpg' },
    mars:    { color: 'assets/planety/solar/mars/mars_color.jpg',
               bump:  'assets/planety/images/marsbump.jpg' },
    jupiter: { color: 'assets/planety/solar/jupiter/jupiter_color.jpg' },
    saturn:  { color: 'assets/planety/solar/saturn/saturn_color.jpg',
               ring:  'assets/planety/solar/saturn/rings_alpha.png' },
    uranus:  { color: 'assets/planety/solar/uranus/uranus_color.jpg',
               ring:  'assets/planety/images/uranus_ring.png' },
    neptune: { color: 'assets/planety/solar/neptune/neptune_color.jpg' },
    // pluto opcjonalnie:
    // pluto: { color:'assets/planety/images/plutomap.jpg', bump:'assets/planety/images/plutobump2k.jpg' }
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
    // delikatne nachylenie w Z, żeby cienie były widoczne
    return { x: sx / L, y: sy / L, z: 0.35 };
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
      this.spin = 0.04 + Math.random() * 0.06;
    }

    render(dt) {
      // Lazy init: zainicjuj scenę dopiero kiedy THREE jest dostępne
      if (this._needsInit && typeof THREE !== "undefined") {
        this._needsInit = false;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
        this.camera.position.z = 3;

        const geom = new THREE.SphereGeometry(1, 96, 64);
        const loader = new THREE.TextureLoader();
        const tryTex = (p, srgb = false) => {
          if (!p) return null;
          const t = loader.load(p, undefined, undefined, (e)=>console.warn('Texture load failed:', p, e));
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          return t;
        };
        const tex = TEX[this._name] || {};

        const matParams = {
          color: 0xffffff,
          shininess: 10
        };
        // mapy kolorów w sRGB:
        if (tex.color)   matParams.map         = tryTex(tex.color,  true);
        // linear:
        if (tex.normal)  matParams.normalMap   = tryTex(tex.normal, false);
        if (tex.bump)   { matParams.bumpMap    = tryTex(tex.bump,   false); matParams.bumpScale = 0.45; }
        if (tex.spec)    matParams.specularMap = tryTex(tex.spec,   false);

        this.material = new THREE.MeshPhongMaterial(matParams);

        // światła ogólne, żeby nie było pełnej czerni
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));
        const hemi = new THREE.HemisphereLight(0xbfdfff, 0x0b0f1a, 0.18);
        hemi.position.set(0, 1, 0);
        this.scene.add(hemi);

        // „Słońce” jako DirectionalLight z cieniami
        const d = sunDirFor(this.x, this.y);
        const sunDL = new THREE.DirectionalLight(0xffffff, 1.15);
        sunDL.castShadow = true;
        sunDL.position.set(d.x * 10, d.y * 10, d.z * 10);
        sunDL.target.position.set(0, 0, 0);
        this.scene.add(sunDL.target);
        // budżet shadowmap per planeta
        sunDL.shadow.mapSize.set(1024, 1024);
        sunDL.shadow.camera.near = 0.1;
        sunDL.shadow.camera.far = 30;
        const S = 4;
        sunDL.shadow.camera.left = -S;
        sunDL.shadow.camera.right = S;
        sunDL.shadow.camera.top = S;
        sunDL.shadow.camera.bottom = -S;
        this.scene.add(sunDL);

        this.mesh = new THREE.Mesh(geom, this.material);
        this.scene.add(this.mesh);
        this.mesh.receiveShadow = true;    // planeta przyjmuje cienie (np. od chmur)

        if (this._name === 'earth') {
          // nocne światła – świecą niezależnie od światła kierunkowego
          if (tex.night) {
            this.material.emissive = new THREE.Color(0x111111);
            this.material.emissiveMap = tryTex(tex.night, true); // sRGB
            this.material.emissiveIntensity = 1.0;
          }
          // półprzezroczyste chmury
          if (tex.clouds) {
            const clouds = new THREE.Mesh(
              new THREE.SphereGeometry(1.008, 64, 48),
              new THREE.MeshPhongMaterial({
                map: tryTex(tex.clouds, true),
                transparent: true,
                depthWrite: false,
                opacity: 0.9
              })
            );
            this.scene.add(clouds);
            this.clouds = clouds;
            this.clouds.castShadow = true;   // chmury rzucają cień na planetę
          }
        }
        if (tex.ring) {
          const ringTex = tryTex(tex.ring, true);
          if (ringTex) ringTex.anisotropy = 4;
          const ringGeo = new THREE.RingGeometry(1.35, 2.4, 256, 1);
          const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, side: THREE.DoubleSide });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.rotation.x = Math.PI / 2;
          this.scene.add(ring);
          this.ring = ring;
        }
      }
      if (!this.scene || !this.camera) return;
      this.mesh.rotation.y += this.spin * dt;
      if (this.clouds) this.clouds.rotation.y += this.spin * dt * 1.3;

      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r) return;
      r.setClearColor(0x000000, 0);
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
    }
    render(dt){
      if (this._needsInit && typeof THREE !== "undefined") {
        this._needsInit = false;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        this.camera.position.z = 3;
        const loader = new THREE.TextureLoader();
        const tex = loader.load('assets/planety/solar/sun/sun_color.jpg');
        const mat = new THREE.MeshBasicMaterial({ map: tex });
        this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1.0, 128, 96), mat);
        this.scene.add(this.mesh);
      }
      if (!this.scene || !this.camera) return;
      this.mesh.rotation.y += 0.02*dt;

      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if(!r) return;
      r.setClearColor(0x000000, 0);
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
      this.spin = 0.02;
      this.rotSpeed = 0.05;

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
          'assets/planety/asteroids/asteroidPack.glb',
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
            this.spin = 0.04; // bardzo wolna rotacja
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
    }

    render(dt) {
      if (this.root) this.root.rotation.z += this.spin * dt;
      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r || !this.scene || !this.camera) return;
      if (this.imesh) this.imesh.rotation.z += (this.spin * dt);
      r.setClearColor(0x000000, 0);
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
      this._ready = true;
    }

    render(dt){
      this._lazyInit();
      if(!this.scene || !this.camera) return;

      if (this.root) this.root.rotation.z += this.spin * dt;
      this.scene.background = null;

      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if(!r) return;
      r.setClearColor(0x000000, 0);
      r.clear(true, true, true);
      r.render(this.scene, this.camera);

      this.ctx2d.clearRect(0,0,this.canvas.width,this.canvas.height);
      this.ctx2d.drawImage(r.domElement, 0, 0, this.canvas.width, this.canvas.height);
    }

    draw(ctx, cam){
      if (!this._ready || !this.ref) return;
      const s = worldToScreen(this.ref.x, this.ref.y, cam);
      const rawScale = Number(window.DevTuning?.pirateStationScale ?? 1);
      const scale = Number.isFinite(rawScale) ? rawScale : 1;
      const radius = this.ref.baseR ?? this.ref.r ?? (this.baseSize / 2);
      const pxSize = radius * 2 * scale * cam.zoom;
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

  window.initStations3D = function initStations3D(list){
    _stations3D.length = 0;
    if (!Array.isArray(list)) return;
    for (const st of list){
      const s3d = new PirateStation3D(st, {});
      _stations3D.push(s3d);
    }
  };

  window.updateStations3D = function updateStations3D(dt){
    for (const s of _stations3D) s.render(dt);
  };

  window.drawStations3D = function drawStations3D(ctx, cam){
    for (const s of _stations3D) s.draw(ctx, cam);
  };

  window.__setStation3DScale = function(k){
    const value = Number(k);
    const v = Number.isFinite(value) ? value : 1;
    if (!window.DevTuning) window.DevTuning = {};
    window.DevTuning.pirateStationScale = v;
    if (window.Dev) window.Dev.station3DScale = v;
  };

  window.getSharedRenderer = getSharedRenderer;
})();
