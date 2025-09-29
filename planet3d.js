(function () {
  // ======= USTAWIENIA / NARZĘDZIA =======
  const USE_PP = false; // tymczasowo
  const planets = [];
  let sun = null;
  let asteroidBelt = null;
  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

  // PRNG + value noise
  function makePRNG(seed = 1337) {
    let s = seed >>> 0;
    return () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeValueNoise(rand, w, h) {
    const g = [];
    for (let y = 0; y <= h; y++) { g[y] = []; for (let x = 0; x <= w; x++) g[y][x] = rand(); }
    return (u, v) => {
      u = (u % 1 + 1) % 1; v = clamp(v, 0, 1);
      const X = Math.floor(u * w), Y = Math.floor(v * h);
      const xf = u * w - X, yf = v * h - Y;
      const x1 = (X + 1) % (w + 1); const y1 = Math.min(Y + 1, h);
      const a = g[Y][X], b = g[Y][x1], c = g[y1][X], d = g[y1][x1];
      const s = xf * xf * (3 - 2 * xf), t = yf * yf * (3 - 2 * yf);
      return a * (1 - s) * (1 - t) + b * s * (1 - t) + c * (1 - s) * t + d * s * t;
    };
  }
  const bump = (u, v, uc, vc, sx, sy) => {
    let du = Math.min(Math.abs(u - uc), 1 - Math.abs(u - uc));
    let dv = v - vc;
    return Math.exp(-((du * du) / (sx * sx) + (dv * dv) / (sy * sy)));
  };

  // ======= GENERATOR TEKSTUR DZIEN/NOC =======
  function generateEarthTextures(sizeX = 1024, sizeY = 512) {
    const rand = makePRNG(1337421);
    const baseNoise = makeValueNoise(rand, 256, 128);
    const roughNoise = makeValueNoise(rand, 512, 256);

    const day = document.createElement("canvas"); day.width = sizeX; day.height = sizeY;
    const night = document.createElement("canvas"); night.width = sizeX; night.height = sizeY;
    const dctx = day.getContext("2d");
    const nctx = night.getContext("2d");
    const dimg = dctx.createImageData(sizeX, sizeY);
    const nimg = nctx.createImageData(sizeX, sizeY);

    function isLand(u, v) {
      const latAbs = Math.abs(v - 0.5) * 2;
      const guide =
        1.35 * bump(u, v, 0.18, 0.42, 0.10, 0.12) +
        1.15 * bump(u, v, 0.23, 0.64, 0.07, 0.10) +
        1.55 * bump(u, v, 0.52, 0.42, 0.22, 0.12) +
        1.25 * bump(u, v, 0.53, 0.58, 0.12, 0.14) +
        0.90 * bump(u, v, 0.74, 0.62, 0.06, 0.06);
      const base = baseNoise(u * 3.2, v * 2.0);
      const detail = roughNoise(u * 6.0, v * 3.0);
      let landMask = base * 0.6 + detail * 0.25 + guide * 0.35;
      landMask -= 0.52 + (latAbs - 0.5) * 0.05;
      return landMask > 0;
    }

    for (let y = 0; y < sizeY; y++) {
      const v = y / (sizeY - 1);
      const latAbs = Math.abs(v - 0.5) * 2;
      for (let x = 0; x < sizeX; x++) {
        const u = x / (sizeX - 1);
        const guide =
          1.35 * bump(u, v, 0.18, 0.42, 0.10, 0.12) +
          1.15 * bump(u, v, 0.23, 0.64, 0.07, 0.10) +
          1.55 * bump(u, v, 0.52, 0.42, 0.22, 0.12) +
          1.25 * bump(u, v, 0.53, 0.58, 0.12, 0.14) +
          0.90 * bump(u, v, 0.74, 0.62, 0.06, 0.06);
        const base = baseNoise(u * 3.2, v * 2.0);
        const detail = roughNoise(u * 6.0, v * 3.0);
        let landMask = base * 0.6 + detail * 0.25 + guide * 0.35;
        landMask -= 0.52 + (latAbs - 0.5) * 0.05;

        // Dzień
        let rD, gD, bD;
        const land = landMask > 0;
        if (land) {
          const green = 0.45 + 0.30 * (detail - 0.5);
          rD = 0.20 + 0.12 * (detail - 0.5);
          gD = 0.45 + 0.35 * (detail - 0.5) + green * 0.2;
          bD = 0.18 + 0.10 * (detail - 0.5);
        } else {
          const ocean = 0.55 + 0.18 * (roughNoise(u * 0.5, v * 0.5) - 0.5);
          rD = 0.10 * ocean; gD = 0.30 * ocean; bD = 0.65 * ocean;
        }
        const di = (y * sizeX + x) * 4;
        dimg.data[di] = (clamp(rD) * 255) | 0;
        dimg.data[di + 1] = (clamp(gD) * 255) | 0;
        dimg.data[di + 2] = (clamp(bD) * 255) | 0;
        dimg.data[di + 3] = 255;

        // Noc – miasta
        let city = 0;
        if (land && latAbs < 0.85) {
          const urban = roughNoise(u * 8, v * 8);
          if (urban > 0.72 && Math.random() > 0.6) city = Math.pow(clamp(urban), 4);
        }
        const ni = (y * sizeX + x) * 4;
        nimg.data[ni] = 255 * city;
        nimg.data[ni + 1] = 220 * city;
        nimg.data[ni + 2] = 180 * city;
        nimg.data[ni + 3] = 255;
      }
    }
    dctx.putImageData(dimg, 0, 0);
    nctx.putImageData(nimg, 0, 0);
    return { day, night, isLand };
  }

  function addZones(dctx, sizeX, sizeY, isLand) {
    const placements = [
      { count: 50, color: "#bbbbbb", rMin: 2, rMax: 3 },
      { count: 25, color: "#5ac1ff", rMin: 4, rMax: 8 },
      { count: 25, color: "#caa15a", rMin: 4, rMax: 8 }
    ];
    for (const p of placements) {
      for (let i = 0; i < p.count; i++) {
        let u, v; do { u = Math.random(); v = Math.random(); } while (!isLand(u, v));
        const x = u * sizeX, y = v * sizeY, r = p.rMin + Math.random() * (p.rMax - p.rMin);
        dctx.beginPath(); dctx.fillStyle = p.color; dctx.globalAlpha = 0.8;
        dctx.arc(x, y, r, 0, TAU); dctx.fill();
      }
    }
    dctx.globalAlpha = 1;
  }

  // Tekstury (raz)
  const tex = generateEarthTextures(1024, 512);
  addZones(tex.day.getContext("2d"), tex.day.width, tex.day.height, tex.isLand);

  // ======= WSPÓLNY RENDERER WEBGL (1 kontekst) =======
  let sharedRenderer = null;
  let rendererWidth = 0;
  let rendererHeight = 0;
  function getSharedRenderer(width, height) {
    if (typeof THREE === "undefined") return null;
    if (!sharedRenderer) {
      sharedRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      sharedRenderer.setClearColor(0x000000, 0);
    }
    if (typeof window !== "undefined") {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sharedRenderer.setPixelRatio(dpr);
    }
    if (width !== rendererWidth || height !== rendererHeight) {
      sharedRenderer.setSize(width, height, false);
      rendererWidth = width;
      rendererHeight = height;
    }
    sharedRenderer.autoClear = true;
    return sharedRenderer;
  }

  // ======= PLANETA =======
  class Planet3D {
    constructor(size, type) {
      this.size = size;
      this.type = type;
      // prywatny canvas 2D; będziemy wklejać bitmapę z sharedRenderer
      this.canvas = document.createElement("canvas");
      this.canvas.width = 256;
      this.canvas.height = 256;
      this.ctx2d = this.canvas.getContext("2d");

      this.scene = null;
      this.camera = null;
      this.mesh = null;
      // Rotate once every 24 in‑game minutes (24 real seconds)
      this.spin = (2 * Math.PI) / (24 * 60); // rad per game second

      if (typeof THREE === "undefined") return;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      this.camera.position.z = 3;

      let mat;
      if (type === 'terran') {
        const dayTex = new THREE.CanvasTexture(tex.day); dayTex.wrapS = THREE.RepeatWrapping;
        const nightTex = new THREE.CanvasTexture(tex.night); nightTex.wrapS = THREE.RepeatWrapping;
        mat = new THREE.MeshStandardMaterial({
          map: dayTex,
          emissive: new THREE.Color(0xffffff),
          emissiveMap: nightTex,
          emissiveIntensity: 0.8,
          roughness: 1.0, metalness: 0.0,
        });
      } else {
        const colors = {
          volcanic: 0xaa5533,
          frozen: 0x88ccff,
          gas: 0xffd27f,
          barren: 0x888888,
        };
        const color = colors[type] || 0x888888;
        mat = new THREE.MeshStandardMaterial({ color });
      }

      const geom = new THREE.SphereGeometry(1, 48, 32);
      this.mesh = new THREE.Mesh(geom, mat);
      this.scene.add(this.mesh);

      const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(2, 1, 2);
      const fill = new THREE.AmbientLight(0x404040, 0.6);
      this.scene.add(key, fill);
    }

    render(dt) {
      if (!this.scene || !this.camera) return;
      const ts = typeof TIME_SCALE !== 'undefined' ? TIME_SCALE : 60;
      this.mesh.rotation.y += this.spin * dt * ts;

      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r) return;

      r.render(this.scene, this.camera);

      // kopiuj wynik z jedynego renderera do prywatnego canvasa 2D
      this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx2d.drawImage(r.domElement, 0, 0);
    }
  }

  class Sun3D {
    constructor(size) {
      this.size = size;
      this.canvas = document.createElement("canvas");
      this.canvas.width = 256;
      this.canvas.height = 256;
      this.ctx2d = this.canvas.getContext("2d");

      this.scene = null;
      this.camera = null;
      this.sun = null;
      this.corona = null;
      this.protubGroup = null;
      this.time = 0;
      this.composer = null;

      if (typeof THREE === "undefined") return;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      this.camera.position.z = 3;

      // --- Fotosfera ---
      const photosphereVertex = `
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        varying vec3 vNormalO;
        void main(){
          vNormalO = normal;
          vec4 wp = modelMatrix * vec4(position,1.0);
          vWorldPos = wp.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `;
      const simplexNoise3D = `
        vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
        vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
        vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
        vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
        float snoise(vec3 v){const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+1.0*C.xxx;vec3 x2=x0-i2+2.0*C.xxx;vec3 x3=x0-1.0+3.0*C.xxx;i=mod289(i);vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
        float fbm(vec3 p){float f=0.0;float a=0.5;for(int i=0;i<6;i++){f+=a*snoise(p);p*=2.04;a*=0.5;}return f;}
      `;
      const photosphereFragment = `
        uniform float uTime;
        uniform float uGranulationScale;
        uniform float uGranulationSpeed;
        uniform float uSpotStrength;
        uniform float uSpotThreshold;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        varying vec3 vNormalO;
        ${simplexNoise3D}
        void main(){
          vec3 p = normalize(vNormalO) * uGranulationScale;
          float t = uTime * uGranulationSpeed;
          float g1 = fbm(p + vec3(0.0,0.0,t*0.75));
          float g2 = fbm(p*1.8 + vec3(t*0.25,-t*0.2,t*0.15));
          float gran = clamp(0.6*g1 + 0.4*g2,0.0,1.0);
          float spotsBase = fbm(p*0.55 + vec3(-t*0.08,t*0.05,0.0));
          float spotsMask = smoothstep(uSpotThreshold+0.05,uSpotThreshold-0.12,spotsBase);
          vec3 color = mix(uColorA,uColorB,smoothstep(0.25,0.85,gran));
          float spotDarken = mix(1.0,0.25,spotsMask*uSpotStrength);
          color *= spotDarken;
          float filaments = fbm(p*3.5 + vec3(t*0.6,t*0.4,-t*0.3));
          color += 0.07 * smoothstep(0.6,1.0,filaments);
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float ndv = clamp(dot(normalize(vNormalW), viewDir), 0.0, 1.0);
          float limb = pow(ndv, 0.55);
          color *= mix(0.78,1.0,limb);
          gl_FragColor = vec4(color,1.0);
        }
      `;
      this.uniforms = {
        uTime: { value: 0 },
        uGranulationScale: { value: 4.02 },
        uGranulationSpeed: { value: 0.99 },
        uSpotStrength: { value: 0.67 },
        uSpotThreshold: { value: 0.485 },
        uColorA: { value: new THREE.Color("#ff6a00") },
        uColorB: { value: new THREE.Color("#fff6c4") },
      };
      const sunMat = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: photosphereVertex,
        fragmentShader: photosphereFragment,
      });
      this.sun = new THREE.Mesh(new THREE.SphereGeometry(1.0, 192, 128), sunMat);
      this.scene.add(this.sun);

      // --- Korona ---
      const coronaVertex = `
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main(){vec4 wp=modelMatrix*vec4(position,1.0);vWorldPos=wp.xyz;vNormalW=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*wp;}
      `;
      const coronaFragment = `
        uniform float uIntensity;
        uniform float uPower;
        uniform vec3 uColorInner;
        uniform vec3 uColorOuter;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main(){vec3 V=normalize(cameraPosition - vWorldPos);float fres=pow(1.0-clamp(dot(normalize(vNormalW),V),0.0,1.0),uPower);vec3 col=mix(uColorInner,uColorOuter,smoothstep(0.0,1.0,fres));float alpha=clamp(fres*uIntensity,0.0,1.0);gl_FragColor=vec4(col,alpha);}
      `;
      this.coronaUniforms = {
        uIntensity: { value: 1.83 },
        uPower: { value: 2.19 },
        uColorInner: { value: new THREE.Color("#ffae34") },
        uColorOuter: { value: new THREE.Color("#fffbe6") },
      };
      const coronaMat = new THREE.ShaderMaterial({
        uniforms: this.coronaUniforms,
        vertexShader: coronaVertex,
        fragmentShader: coronaFragment,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      });
      this.corona = new THREE.Mesh(new THREE.SphereGeometry(1.18, 128, 96), coronaMat);
      this.scene.add(this.corona);

      // --- Protuberancje ---
      this.protubGroup = new THREE.Group();
      const makeProtuberance = (angle, lat, scale) => {
        const tor = new THREE.TorusGeometry(0.18*scale, 0.035*scale, 16, 64);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff6f2e, transparent:true, opacity:0.9, blending:THREE.AdditiveBlending, depthWrite:false });
        const m = new THREE.Mesh(tor, mat);
        const r = 1.02;
        const x = r*Math.cos(lat)*Math.cos(angle);
        const y = r*Math.sin(lat);
        const z = r*Math.cos(lat)*Math.sin(angle);
        m.position.set(x,y,z);
        m.lookAt(new THREE.Vector3(x,y,z).multiplyScalar(1.35));
        this.protubGroup.add(m);
      };
      for(let i=0;i<10;i++){ makeProtuberance(Math.random()*Math.PI*2,(Math.random()*0.9-0.45)*Math.PI,0.8+Math.random()*0.6); }
      this.scene.add(this.protubGroup);
    }

    render(dt) {
      dt = Number.isFinite(dt) ? dt : 0;
      if (!this.scene || !this.camera) return;
      this.time += dt;
      this.uniforms.uTime.value = this.time;
      this.sun.rotation.y += 0.004 * dt;
      this.corona.rotation.y = this.sun.rotation.y;
      this.protubGroup.rotation.y = this.sun.rotation.y * 0.9;
      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r) return;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.1;
      r.outputColorSpace = THREE.SRGBColorSpace;

      const hasPP =
        USE_PP &&
        typeof EffectComposer !== "undefined" &&
        typeof RenderPass !== "undefined" &&
        typeof UnrealBloomPass !== "undefined";

      if (!hasPP) {
        this.composer = null;
        this._renderer = null;
        this.bloom = null;
      }

      if (hasPP && (!this.composer || this._renderer !== r)) {
        this._renderer = r;
        this.composer = new EffectComposer(r);
        this.composer.setSize(this.canvas.width, this.canvas.height);
        const rp = new RenderPass(this.scene, this.camera);
        this.bloom = new UnrealBloomPass(
          new THREE.Vector2(this.canvas.width, this.canvas.height),
          1.14,
          1.04,
          0.0
        );
        this.composer.addPass(rp);
        this.composer.addPass(this.bloom);

        let finalPass = null;
        if (typeof OutputPass !== "undefined") {
          finalPass = new OutputPass();
        } else if (
          typeof ShaderPass !== "undefined" &&
          typeof THREE !== "undefined" &&
          THREE &&
          THREE.CopyShader
        ) {
          finalPass = new ShaderPass(THREE.CopyShader);
          if (finalPass.renderToScreen !== undefined) finalPass.renderToScreen = true;
        }

        if (finalPass) {
          this.composer.addPass(finalPass);
        } else if (this.bloom && this.bloom.renderToScreen !== undefined) {
          this.bloom.renderToScreen = true;
        }
      }

      if (this.composer) {
        r.autoClear = false;
        this.composer.render();
        r.autoClear = true;
      } else {
        r.autoClear = true;
        r.render(this.scene, this.camera);
      }
      r.autoClear = true;
      this.ctx2d.clearRect(0,0,this.canvas.width,this.canvas.height);
      // powiększ obraz, aby słońce wypełniało większą część canvasa
      const zoom = 1.3;
      const srcW = this.canvas.width / zoom;
      const srcH = this.canvas.height / zoom;
      const srcX = (this.canvas.width - srcW) / 2;
      const srcY = (this.canvas.height - srcH) / 2;
      this.ctx2d.drawImage(r.domElement, srcX, srcY, srcW, srcH, 0, 0, this.canvas.width, this.canvas.height);
      // przytnij kwadratowe brzegi, pozostawiając okrągłą teksturę
      this.ctx2d.globalCompositeOperation = "destination-in";
      this.ctx2d.beginPath();
      this.ctx2d.arc(this.canvas.width/2, this.canvas.height/2, this.canvas.width/2, 0, Math.PI*2);
      this.ctx2d.fill();
      this.ctx2d.globalCompositeOperation = "source-over";
    }
  }

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

      this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
      const sunDir = new THREE.DirectionalLight(0xffffff, 1.25);
      sunDir.position.set(1, 1, 2).normalize();
      this.scene.add(sunDir);

      this.mesh = new THREE.Group();
      this.scene.add(this.mesh);

      this._instanced = [];
      this.rotationSpeed = 0.03;
      this.rotation = 0;

      const inner = innerRadius / outerRadius;
      const COUNT = count;

      const makeTransforms = (imesh, startIdx, endIdx) => {
        const m = new THREE.Matrix4();
        const rotM = new THREE.Matrix4();
        const scaleM = new THREE.Matrix4();
        const euler = new THREE.Euler();

        for (let i = startIdx; i < endIdx; i++) {
          const radius = inner + Math.random() * (1 - inner);
          const angle = Math.random() * TAU;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const z = (Math.random() - 0.5) * 0.22;
          const s = 0.018 + Math.random() * 0.045;

          m.makeTranslation(x, y, z);
          euler.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
          rotM.makeRotationFromEuler(euler);
          scaleM.makeScale(s, s, s);
          m.multiply(rotM); m.multiply(scaleM);
          imesh.setMatrixAt(i - startIdx, m);
        }
        imesh.instanceMatrix.needsUpdate = true;
      };

      const buildFromGeos = (geos) => {
        if (!geos.length) return;
        const per = Math.max(1, Math.floor(COUNT / geos.length));
        let placed = 0;
        for (let gi = 0; gi < geos.length; gi++) {
          const left = COUNT - placed;
          const n = gi === geos.length - 1 ? left : Math.min(per, left);
          if (n <= 0) break;

          const mat = new THREE.MeshStandardMaterial({
            color: 0xbfc4c9, roughness: 0.93, metalness: 0.02, flatShading: true
          });
          const imesh = new THREE.InstancedMesh(geos[gi], mat, n);
          makeTransforms(imesh, placed, placed + n);
          this.mesh.add(imesh);
          this._instanced.push(imesh);
          placed += n;
        }
      };

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
                const g = o.geometry.clone();
                g.computeVertexNormals();
                geos.push(g);
              }
            });
            if (!geos.length) return buildFromGeos([new THREE.IcosahedronGeometry(1, 1)]);
            buildFromGeos(geos);
          },
          undefined,
          () => buildFromGeos([new THREE.IcosahedronGeometry(1, 1)])
        );
      };

      tryLoadGLTF();

      this._renderer = null;
      this.composer = null;
      this.bloom = null;
      this._composerWidth = 0;
      this._composerHeight = 0;
    }

    render(dt) {
      if (!this.scene || !this.camera) return;
      this.mesh.rotation.z += this.rotationSpeed * dt;
      this.rotation += this.rotationSpeed * dt;

      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r) return;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.0;
      r.outputColorSpace = THREE.SRGBColorSpace;

      const hasPP = USE_PP &&
                    (typeof EffectComposer !== 'undefined') &&
                    (typeof RenderPass !== 'undefined') &&
                    (typeof UnrealBloomPass !== 'undefined');

      if (hasPP && (!this.composer || this._renderer !== r)) {
        this._renderer = r;
        this.composer = new EffectComposer(r);
        this.composer.setSize(this.canvas.width, this.canvas.height);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(this.canvas.width, this.canvas.height), 0.35, 0.9, 0.0);
        this.composer.addPass(this.bloom);
        let finalPass = null;
        if (typeof OutputPass !== 'undefined') {
          finalPass = new OutputPass();
        } else if (typeof ShaderPass !== 'undefined' && typeof THREE !== 'undefined' && THREE && THREE.CopyShader) {
          finalPass = new ShaderPass(THREE.CopyShader);
          if (finalPass.renderToScreen !== undefined) finalPass.renderToScreen = true;
        }
        if (finalPass) {
          console.debug('Final pass:', finalPass?.constructor?.name);
          this.composer.addPass(finalPass);
        }
        this._composerWidth = this.canvas.width;
        this._composerHeight = this.canvas.height;
      }
      if (this.composer && this._renderer === r) {
        if (this._composerWidth !== this.canvas.width || this._composerHeight !== this.canvas.height) {
          this.composer.setSize(this.canvas.width, this.canvas.height);
          if (this.bloom && typeof this.bloom.setSize === 'function') {
            this.bloom.setSize(this.canvas.width, this.canvas.height);
          }
          this._composerWidth = this.canvas.width;
          this._composerHeight = this.canvas.height;
        }
      }

      if (this.composer) {
        r.autoClear = false;
        this.composer.render();
        r.autoClear = true;
      } else {
        r.autoClear = true;
        r.render(this.scene, this.camera);
      }
      r.autoClear = true;

      const ctx = this.ctx2d;
      ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
      const zoom = 1.18;
      const srcW = this.canvas.width / zoom, srcH = this.canvas.height / zoom;
      const srcX = (this.canvas.width - srcW)/2, srcY = (this.canvas.height - srcH)/2;
      ctx.drawImage(r.domElement, srcX, srcY, srcW, srcH, 0, 0, this.canvas.width, this.canvas.height);

      ctx.globalCompositeOperation = 'destination-in';
      const grd = ctx.createRadialGradient(this.canvas.width/2, this.canvas.height/2, this.canvas.width*0.47,
                                           this.canvas.width/2, this.canvas.height/2, this.canvas.width*0.50);
      grd.addColorStop(0.0, 'rgba(255,255,255,1)');
      grd.addColorStop(1.0, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.fillStyle = grd;
      ctx.arc(this.canvas.width/2, this.canvas.height/2, this.canvas.width/2, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    draw(ctx, cam) {
      const sunX = sun ? sun.x : 0;
      const sunY = sun ? sun.y : 0;
      const s = worldToScreen(sunX, sunY, cam);
      const size = this.size * cam.zoom;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(1.0, 0.72);
      ctx.drawImage(this.canvas, -size/2, -size/2, size, size);
      ctx.restore();
    }
  }

  // ======= API =======
  function initPlanets3D(planetList, sunPos) {
    planets.length = 0;
    for (const pl of planetList) {
      const p = new Planet3D(pl.r * 2.0, pl.type); // mniejsze niż wcześniej, ale wyraźne "halo"
      p.body = pl;
      planets.push(p);
    }
    sun = new Sun3D(sunPos.r * 2.5);
    sun.x = sunPos.x;
    sun.y = sunPos.y;
    asteroidBelt = null;
    const baseSunRadius = (sunPos && sunPos.r) ? sunPos.r : 200;
    let inner = baseSunRadius * 4.0;
    let outer = inner * 1.18;
    if (planetList && planetList.length >= 5 && planetList[3].orbitRadius && planetList[4].orbitRadius) {
      const r1 = planetList[3].orbitRadius, r2 = planetList[4].orbitRadius;
      const mid = (r1 + r2) * 0.5;
      const width = (r2 - r1) * 0.22;
      inner = Math.max(50, mid - width * 0.5);
      outer = inner + width;
    }
    asteroidBelt = new AsteroidBelt3D(inner, outer, 2800);
    if (typeof THREE === "undefined") console.warn("3D planets disabled: THREE not found.");
  }

  function updatePlanets3D(dt) {
    if (sun) sun.render(dt);
    if (asteroidBelt) asteroidBelt.render(dt);
    for (const p of planets) p.render(dt);
  }

  function drawPlanets3D(ctx, cam) {
    if (asteroidBelt) asteroidBelt.draw(ctx, cam);
    for (const p of planets) {
      const s = worldToScreen(p.body.x, p.body.y, cam);
      const size = p.size * cam.zoom;
      ctx.drawImage(p.canvas, s.x - size / 2, s.y - size / 2, size, size);
    }
    if (sun) {
      const sSun = worldToScreen(sun.x, sun.y, cam);
      const sizeSun = sun.size * cam.zoom;
      ctx.drawImage(sun.canvas, sSun.x - sizeSun / 2, sSun.y - sizeSun / 2, sizeSun, sizeSun);
    }
  }

  window.setPlanetsSunPos = function (x, y) {
    if (sun) {
      sun.x = x || 0;
      sun.y = y || 0;
    }
  };

  window.initPlanets3D = initPlanets3D;
  window.updatePlanets3D = updatePlanets3D;
  window.drawPlanets3D = drawPlanets3D;
  window.getSharedRenderer = getSharedRenderer;
})();
