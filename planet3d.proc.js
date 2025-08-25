
const NOISE_FUNCTIONS = `const float PI = 3.14159265;

    //	Simplex 3D Noise 
    //	by Ian McEwan, Ashima Arts
    //
    vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
    vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

    // 
    float simplex3(vec3 v) { 
      const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
      const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

      // First corner
      vec3 i  = floor(v + dot(v, C.yyy) );
      vec3 x0 =   v - i + dot(i, C.xxx) ;

      // Other corners
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min( g.xyz, l.zxy );
      vec3 i2 = max( g.xyz, l.zxy );

      //  x0 = x0 - 0. + 0.0 * C 
      vec3 x1 = x0 - i1 + 1.0 * C.xxx;
      vec3 x2 = x0 - i2 + 2.0 * C.xxx;
      vec3 x3 = x0 - 1. + 3.0 * C.xxx;

      // Permutations
      i = mod(i, 289.0 ); 
      vec4 p = permute( permute( permute( 
                i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
              + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

      // Gradients
      // ( N*N points uniformly over a square, mapped onto an octahedron.)
      float n_ = 1.0/7.0; // N=7
      vec3  ns = n_ * D.wyz - D.xzx;

      vec4 j = p - 49.0 * floor(p * ns.z *ns.z);  //  mod(p,N*N)

      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

      vec4 x = x_ *ns.x + ns.yyyy;
      vec4 y = y_ *ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);

      vec4 b0 = vec4( x.xy, y.xy );
      vec4 b1 = vec4( x.zw, y.zw );

      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));

      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

      vec3 p0 = vec3(a0.xy,h.x);
      vec3 p1 = vec3(a0.zw,h.y);
      vec3 p2 = vec3(a1.xy,h.z);
      vec3 p3 = vec3(a1.zw,h.w);

      //Normalise gradients
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;

      // Mix final noise value
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                    dot(p2,x2), dot(p3,x3) ) );
    }

    float fractal3(      
      vec3 v,
      float sharpness,
      float period,
      float persistence,
      float lacunarity,
      int octaves
    ) {
      float n = 0.0;
      float a = 1.0; // Amplitude for current octave
      float max_amp = 0.0; // Accumulate max amplitude so we can normalize after
      float P = period;  // Period for current octave

      for(int i = 0; i < octaves; i++) {
          n += a * simplex3(v / P);
          a *= persistence;
          max_amp += a;
          P /= lacunarity;
      }

      // Normalize noise between [0.0, amplitude]
      return n / max_amp;
    }

    float terrainHeight(
      int type,
      vec3 v,
      float amplitude,
      float sharpness,
      float offset,
      float period,
      float persistence,
      float lacunarity,
      int octaves
    ) {
      float h = 0.0;

      if (type == 1) {
        h = amplitude * simplex3(v / period);
      } else if (type == 2) {
        h = amplitude * fractal3(
          v,
          sharpness,
          period, 
          persistence, 
          lacunarity, 
          octaves);
        h = amplitude * pow(max(0.0, (h + 1.0) / 2.0), sharpness);
      } else if (type == 3) {
        h = fractal3(
          v,
          sharpness,
          period, 
          persistence, 
          lacunarity, 
          octaves);
        h = amplitude * pow(max(0.0, 1.0 - abs(h)), sharpness);
      }

      // Multiply by amplitude and adjust offset
      return max(0.0, h + offset);
    }`;
const PLANET_VERT = `attribute vec3 tangent;

    // Terrain generation parameters
    uniform int type;
    uniform float radius;
    uniform float amplitude;
    uniform float sharpness;
    uniform float offset;
    uniform float period;
    uniform float persistence;
    uniform float lacunarity;
    uniform int octaves;

    // Bump mapping
    uniform float bumpStrength;
    uniform float bumpOffset;

    varying vec3 fragPosition;
    varying vec3 fragNormal;
    varying vec3 fragTangent;
    varying vec3 fragBitangent;

    void main() {
      // Calculate terrain height
      float h = terrainHeight(
        type,
        position,
        amplitude, 
        sharpness,
        offset,
        period, 
        persistence, 
        lacunarity, 
        octaves);

      vec3 pos = position * (radius + h);

      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      fragPosition = position;
      fragNormal = normal;
      fragTangent = tangent;
      fragBitangent = cross(normal, tangent);
    }`;
const PLANET_FRAG = `// Terrain generation parameters
    uniform int type;
    uniform float radius;
    uniform float amplitude;
    uniform float sharpness;
    uniform float offset;
    uniform float period;
    uniform float persistence;
    uniform float lacunarity;
    uniform int octaves;

    // Layer colors
    uniform vec3 color1;
    uniform vec3 color2;
    uniform vec3 color3;
    uniform vec3 color4;
    uniform vec3 color5;
    
    // Transition points for each layer
    uniform float transition2;
    uniform float transition3;
    uniform float transition4;
    uniform float transition5;

    // Amount of blending between each layer
    uniform float blend12;
    uniform float blend23;
    uniform float blend34;
    uniform float blend45;

    // Bump mapping parameters
    uniform float bumpStrength;
    uniform float bumpOffset;

    // Lighting parameters
    uniform float ambientIntensity;
    uniform float diffuseIntensity;
    uniform float specularIntensity;
    uniform float shininess;
    uniform vec3 lightDirection;
    uniform vec3 lightColor;

    varying vec3 fragPosition;
    varying vec3 fragNormal;
    varying vec3 fragTangent;
    varying vec3 fragBitangent;

    void main() {
      // Calculate terrain height
      float h = terrainHeight(
        type,
        fragPosition,
        amplitude, 
        sharpness,
        offset,
        period, 
        persistence, 
        lacunarity, 
        octaves);

      vec3 dx = bumpOffset * fragTangent;
      float h_dx = terrainHeight(
        type,
        fragPosition + dx,
        amplitude, 
        sharpness,
        offset,
        period, 
        persistence, 
        lacunarity, 
        octaves);

      vec3 dy = bumpOffset * fragBitangent;
      float h_dy = terrainHeight(
        type,
        fragPosition + dy,
        amplitude, 
        sharpness,
        offset,
        period, 
        persistence, 
        lacunarity, 
        octaves);

      vec3 pos = fragPosition * (radius + h);
      vec3 pos_dx = (fragPosition + dx) * (radius + h_dx);
      vec3 pos_dy = (fragPosition + dy) * (radius + h_dy);

      // Recalculate surface normal post-bump mapping
      vec3 bumpNormal = normalize(cross(pos_dx - pos, pos_dy - pos));
      // Mix original normal and bumped normal to control bump strength
      vec3 N = normalize(mix(fragNormal, bumpNormal, bumpStrength));
    
      // Normalized light direction (points in direction that light travels)
      vec3 L = normalize(-lightDirection);
      // View vector from camera to fragment
      vec3 V = normalize(cameraPosition - pos);
      // Reflected light vector
      vec3 R = normalize(reflect(L, N));

      float diffuse = diffuseIntensity * max(0.0, dot(N, -L));

      // https://ogldev.org/www/tutorial19/tutorial19.html
      float specularFalloff = clamp((transition3 - h) / transition3, 0.0, 1.0);
      float specular = max(0.0, specularFalloff * specularIntensity * pow(dot(V, R), shininess));

      float light = ambientIntensity + diffuse + specular;

      // Blender colors layer by layer
      vec3 color12 = mix(
        color1, 
        color2, 
        smoothstep(transition2 - blend12, transition2 + blend12, h));

      vec3 color123 = mix(
        color12, 
        color3, 
        smoothstep(transition3 - blend23, transition3 + blend23, h));

      vec3 color1234 = mix(
        color123, 
        color4, 
        smoothstep(transition4 - blend34, transition4 + blend34, h));

      vec3 finalColor = mix(
        color1234, 
        color5, 
        smoothstep(transition5 - blend45, transition5 + blend45, h));
      
      gl_FragColor = vec4(light * finalColor * lightColor, 1.0);
    }`;


(function(){
  const planets = [];
  let sun = null;
  // Default sun position in sector/world space (center)
  let SUN_POS = { x: 0, y: 0, z: 0 };

  // === Shared WebGL renderer (one context) ===
  let sharedRenderer = null;
  function getSharedRenderer(width, height) {
    if (typeof THREE === "undefined") return null;
    if (!sharedRenderer) {
      sharedRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      sharedRenderer.setClearColor(0x000000, 0);
    }
    sharedRenderer.setSize(width, height, false);
    return sharedRenderer;
  }

  // === Shader-based planet material (from procedural generator) ===
  function buildPlanetMaterial() {
    // Default uniforms (you can tweak later).
    const uniforms = {
      type: { value: 2 },
      radius: { value: 1.0 },
      amplitude: { value: 0.6 },
      sharpness: { value: 2.6 },
      offset: { value: -0.016 },
      period: { value: 0.6 },
      persistence: { value: 0.484 },
      lacunarity: { value: 1.8 },
      octaves: { value: 8 },
      undulation: { value: 0.0 },

      // Lighting
      ambientIntensity: { value: 0.05 },
      diffuseIntensity: { value: 1.0 },
      specularIntensity: { value: 1.5 },
      shininess: { value: 10.0 },
      lightDirection: { value: new THREE.Vector3(1,1,1) }, // will be updated each frame
      lightColor: { value: new THREE.Color(0xffffff) },

      // Bump
      bumpStrength: { value: 1.0 },
      bumpOffset: { value: 0.001 },

      // Layer colors/transitions (can be tuned)
      color1: { value: new THREE.Color(0.014, 0.117, 0.279) },
      color2: { value: new THREE.Color(0.080, 0.527, 0.351) },
      color3: { value: new THREE.Color(0.620, 0.516, 0.372) },
      color4: { value: new THREE.Color(0.149, 0.254, 0.084) },
      color5: { value: new THREE.Color(0.150, 0.150, 0.150) },
      transition2: { value: 0.071 },
      transition3: { value: 0.215 },
      transition4: { value: 0.372 },
      transition5: { value: 1.2 },
      blend12: { value: 0.152 },
      blend23: { value: 0.152 },
      blend34: { value: 0.104 },
      blend45: { value: 0.168 }
    };

    const vertexShader = (NOISE_FUNCTIONS + "\n" + PLANET_VERT).replace("void main()", "void main()");
    const fragmentShader = (NOISE_FUNCTIONS + "\n" + PLANET_FRAG).replace("void main()", "void main()");

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader
    });
    // Important so cameraPosition uniform is set
    mat.needsUpdate = true;
    return mat;
  }

  class ProcPlanet {
    constructor(worldX, worldY, pixelSize) {
      this.x = worldX; 
      this.y = worldY;
      // target size on screen in world units (used only when drawing to 2D)
      this.size = pixelSize || 64;

      // own 2D canvas to blit the rendered planet
      this.canvas = document.createElement("canvas");
      this.canvas.width = 256;
      this.canvas.height = 256;
      this.ctx2d = this.canvas.getContext("2d");

      // build scene
      if (typeof THREE === "undefined") return;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      this.camera.position.z = 3;

      const geom = new THREE.SphereGeometry(1, 128, 128);
      geom.computeTangents?.();

      this.material = buildPlanetMaterial();
      this.mesh = new THREE.Mesh(geom, this.material);
      this.scene.add(this.mesh);

      // Rotate once every 24 in‑game minutes (24 real seconds)
      this.spin = (2 * Math.PI) / (24 * 60); // rad per game second
    }

    // Update lightDir uniform from sector sun (0,0,0) toward this planet
    updateLightDirection() {
      if (!this.material) return;
      const dx = SUN_POS.x - this.x;
      const dy = SUN_POS.y - this.y;
      const dz = SUN_POS.z - 0.0;
      const len = Math.hypot(dx, dy, dz) || 1.0;
      const lx = dx / len, ly = dy / len, lz = dz / len;
      this.material.uniforms.lightDirection.value.set(lx, ly, lz);
    }

    render(dt) {
      if (!this.scene || !this.camera) return;
      this.updateLightDirection();

      const ts = typeof TIME_SCALE !== 'undefined' ? TIME_SCALE : 60;
      this.mesh.rotation.y += this.spin * dt * ts;

      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r) return;
      r.render(this.scene, this.camera);

      this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx2d.drawImage(r.domElement, 0, 0);
    }
  }

  class Sun3D {
    constructor(size) {
      this.size = size || 256;
      this.canvas = document.createElement("canvas");
      this.canvas.width = 256;
      this.canvas.height = 256;
      this.ctx2d = this.canvas.getContext("2d");

      if (typeof THREE === "undefined") return;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      this.camera.position.z = 3;

      const uniforms = { time: { value: 0 } };

      const vertexShader = `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }`;

      const fragmentShader = `
        uniform float time;
        varying vec2 vUv;

        float rand(vec2 co){
          return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
        }
        float noise(vec2 uv){
          vec2 i = floor(uv);
          vec2 f = fract(uv);
          float a = rand(i);
          float b = rand(i + vec2(1.0,0.0));
          float c = rand(i + vec2(0.0,1.0));
          float d = rand(i + vec2(1.0,1.0));
          vec2 u = f*f*(3.0-2.0*f);
          return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
        }

        void main(){
          vec2 uv = vUv*4.0;
          float n = noise(uv + time*0.5);
          float r = distance(vUv, vec2(0.5));
          float brightness = smoothstep(0.5, 0.0, r);
          vec3 col = mix(vec3(1.0,0.8,0.2), vec3(1.0,0.5,0.0), n);
          gl_FragColor = vec4(col * brightness, brightness);
        }`;

      const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        blending: THREE.AdditiveBlending,
        transparent: true
      });

      const geom = new THREE.SphereGeometry(1, 64, 32);
      this.mesh = new THREE.Mesh(geom, mat);
      this.scene.add(this.mesh);

      const glowTex = new THREE.CanvasTexture(makeGlowTexture());
      const glowMat = new THREE.SpriteMaterial({
        map: glowTex,
        blending: THREE.AdditiveBlending,
        transparent: true
      });
      this.glow = new THREE.Sprite(glowMat);
      this.glow.scale.set(2.5, 2.5, 1);
      this.scene.add(this.glow);
    }

    render(dt) {
      if (!this.scene || !this.camera) return;
      if (this.mesh.material.uniforms) {
        this.mesh.material.uniforms.time.value += dt;
      }
      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r) return;
      r.render(this.scene, this.camera);
      this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx2d.drawImage(r.domElement, 0, 0);
    }
  }

  function makeGlowTexture() {
    const size = 256;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return c;
  }

  // === Public API (keeps your game's calls intact) ===
  let _planets = [];
  function initPlanets3D(list, sunObj) {
    _planets.length = 0;
    for (const s of list) {
      const size = (s.r || 30) * 2.0;
      const p = new ProcPlanet(s.x, s.y, size);
      _planets.push(p);
    }
    if (sunObj) {
      SUN_POS = { x: sunObj.x || 0, y: sunObj.y || 0, z: 0 };
      sun = new Sun3D((sunObj.r || 200) * 2.5);
      sun.x = sunObj.x;
      sun.y = sunObj.y;
    }
  }
  function updatePlanets3D(dt) {
    if (sun) sun.render(dt);
    for (const p of _planets) p.render(dt);
  }
  function drawPlanets3D(ctx, cam) {
      for (const p of _planets) {
        const s = worldToScreen(p.x, p.y, cam);
        const size = p.size * camera.zoom;
        ctx.drawImage(p.canvas, s.x - size/2, s.y - size/2, size, size);
      }
      if (sun) {
        const ss = worldToScreen(sun.x, sun.y, cam);
        const sizeS = sun.size * camera.zoom;
        ctx.drawImage(sun.canvas, ss.x - sizeS/2, ss.y - sizeS/2, sizeS, sizeS);
      }
    }

  function setPlanetsSunPos(x,y,z){
    SUN_POS = {x:x||0,y:y||0,z:z||0};
    if (sun) { sun.x = SUN_POS.x; sun.y = SUN_POS.y; }
  }
  window.initPlanets3D = initPlanets3D;
  window.setPlanetsSunPos = setPlanetsSunPos;
  window.updatePlanets3D = updatePlanets3D;
  window.drawPlanets3D = drawPlanets3D;
})();
