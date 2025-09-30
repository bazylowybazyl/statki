// planet3d.assets.js
(function () {
  // ======= WSPÓŁDZIELONY RENDERER (kopiuj z proc, drobna adaptacja) =======
  let sharedRenderer = null;
  let rendererWidth = 0, rendererHeight = 0;
  function getSharedRenderer(width = 256, height = 256) {
    if (typeof THREE === "undefined") return null;
    if (!sharedRenderer) {
      sharedRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      sharedRenderer.setClearColor(0x000000, 0);
      sharedRenderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    if (rendererWidth !== width || rendererHeight !== height) {
      sharedRenderer.setSize(width, height, false);
      rendererWidth = width; rendererHeight = height;
    }
    return sharedRenderer;
  }

  // ======= MAPOWANIE TEKSTUR (tylko ścieżki tekstowe – zero binarek w PR) =======
  const TEX = {
    mercury: { color: 'assets/planety/solar/mercury/mercury_color.jpg', normal: 'assets/planety/solar/mercury/mercury_normal.jpg' },
    venus:   { color: 'assets/planety/solar/venus/venus_color.jpg',   bump:   'assets/planety/images/venusbump.jpg',
               atmo:  'assets/planety/images/venus_atmosphere.jpg' },
    earth:   { color: 'assets/planety/solar/earth/earth_color.jpg',   normal: 'assets/planety/solar/earth/earth_normal.jpg',
               spec:  'assets/planety/images/earth_specularmap.jpg',   night:  'assets/planety/images/earth_nightmap.jpg',
               clouds:'assets/planety/solar/earth/earth_clouds.jpg' },
    mars:    { color: 'assets/planety/solar/mars/mars_color.jpg',     bump:   'assets/planety/images/marsbump.jpg' },
    jupiter: { color: 'assets/planety/solar/jupiter/jupiter_color.jpg' },
    saturn:  { color: 'assets/planety/solar/saturn/saturn_color.jpg', ring:   'assets/planety/solar/saturn/rings_alpha.png' },
    uranus:  { color: 'assets/planety/solar/uranus/uranus_color.jpg', ring:   'assets/planety/images/uranus_ring.png' },
    neptune: { color: 'assets/planety/solar/neptune/neptune_color.jpg' },
    pluto:   { color: 'assets/planety/images/plutomap.jpg',           bump:   'assets/planety/images/plutobump2k.jpg' }
  };

  const _planets = [];
  let sun = null;
  let asteroidBelt = null;
  const TAU = Math.PI * 2;

  // ======= PLANETA Z TEKSTUR =======
  class AssetPlanet3D {
    constructor(worldX, worldY, pixelSize, opts = {}) {
      this.x = worldX; this.y = worldY;
      this.size = pixelSize || 64;

      this.canvas = document.createElement("canvas");
      this.canvas.width = 256; this.canvas.height = 256;
      this.ctx2d = this.canvas.getContext("2d");

      if (typeof THREE === "undefined") return;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      this.camera.position.z = 3;

      const geom = new THREE.SphereGeometry(1, 96, 64);
      const loader = new THREE.TextureLoader();
      const name = (opts.name || opts.id || "").toLowerCase();
      const tex = TEX[name] || {};

      const tryTex = (p) => (p ? loader.load(p) : null);

      const matParams = {};
      if (tex.color)   matParams.map        = tryTex(tex.color);
      if (tex.normal)  matParams.normalMap  = tryTex(tex.normal);
      if (tex.bump)   { matParams.bumpMap   = tryTex(tex.bump);   matParams.bumpScale = 0.6; }
      if (tex.spec)    matParams.specularMap= tryTex(tex.spec);

      // Phong bo ładnie działa z mapami
      this.material = new THREE.MeshPhongMaterial(matParams);
      const light = new THREE.DirectionalLight(0xffffff, 1.0);
      light.position.set(2, 1, 2);
      this.scene.add(light);

      this.mesh = new THREE.Mesh(geom, this.material);
      this.scene.add(this.mesh);

      // Chmury Ziemi (jeśli dostępne)
      if (name === 'earth' && tex.clouds) {
        const clouds = new THREE.Mesh(
          new THREE.SphereGeometry(1.008, 64, 48),
          new THREE.MeshPhongMaterial({ map: tryTex(tex.clouds), transparent: true, depthWrite: false })
        );
        this.scene.add(clouds);
        this.clouds = clouds;
      }

      // Pierścienie Saturn/Uran
      if (tex.ring) {
        const ringTex = tryTex(tex.ring);
        const ringGeo = new THREE.RingGeometry(1.35, 2.4, 256, 1);
        const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        this.scene.add(ring);
        this.ring = ring;
      }

      // delikatny obrót
      this.spin = 0.04 + Math.random() * 0.06;
    }

    render(dt) {
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

      if (typeof THREE === "undefined") return;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      this.camera.position.z = 3;

      const loader = new THREE.TextureLoader();
      const tex = loader.load('assets/planety/solar/sun/sun_color.jpg');
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.0, 128, 96), mat);
      this.scene.add(mesh);
      this.mesh = mesh;
    }
    render(dt){
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

      if (typeof THREE === 'undefined') return;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
      this.camera.position.set(0, 0.6, 4.2);
      this.camera.lookAt(0, 0, 0);

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
              const r = innerRadius + Math.random() * (outerRadius - innerRadius);
              const z = (Math.random() - 0.5) * 0.12 * outerRadius;
              const x = Math.cos(a) * r;
              const y = Math.sin(a) * r;
              const s = 0.018 + Math.random() * 0.045;
              m.makeTranslation(x, y, z);
              euler.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
              rotM.makeRotationFromEuler(euler);
              scaleM.makeScale(s, s, s);
              m.multiply(rotM); m.multiply(scaleM);
              imesh.setMatrixAt(i, m);
            }
            imesh.instanceMatrix.needsUpdate = true;
            this.scene.add(imesh);
          }
        );
      };
      tryLoadGLTF();

      const light = new THREE.DirectionalLight(0xffffff, 1.0);
      light.position.set(2, 2, 3);
      this.scene.add(light);
    }

    render(dt) {
      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r || !this.scene || !this.camera) return;
      r.setClearColor(0x000000, 0);
      r.render(this.scene, this.camera);
      this.ctx2d.clearRect(0,0,this.canvas.width,this.canvas.height);
      this.ctx2d.drawImage(r.domElement, 0, 0, this.canvas.width, this.canvas.height);
    }

    draw(ctx, cam) {
      const s = worldToScreen(sun?.x || 0, sun?.y || 0, cam);
      const size = this.size * cam.zoom;
      ctx.drawImage(this.canvas, s.x - size/2, s.y - size/2, size, size);
    }
  }

  // ======= API zgodne z proceduralnym rendererem =======
  window.initPlanets3D = function initPlanets3D(list, sunObj) {
    _planets.length = 0;
    for (const s of list) {
      const size = (s.r || 30) * 2.0;
      const planet = new AssetPlanet3D(s.x, s.y, size, { name: s.name || s.id || null });
      _planets.push(planet);
    }

    if (sunObj) {
      sun = new Sun3D((sunObj.r || 200) * 2.5);
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

  window.getSharedRenderer = getSharedRenderer;
})();
