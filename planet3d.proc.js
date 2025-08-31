
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
const PLANET_VERT = `
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

      // Sfera: normalna ~ znormalizowana pozycja
      vec3 N = normalize(position);
      fragNormal = N;

      // Zbuduj bazę TBN w shaderze (bez atrybutu tangent z geometrii)
      vec3 up = (abs(N.y) > 0.99) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
      vec3 T = normalize(cross(up, N));
      vec3 B = normalize(cross(N, T));
      fragTangent = T;
      fragBitangent = B;
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
  let asteroidBelt = null;
  const TAU = Math.PI * 2;
  // Default sun position in sector/world space (center)
  let SUN_POS = { x: 0, y: 0, z: 0 };

  // === Shared WebGL renderer (one context) ===
  let sharedRenderer = null;
  let rendererWidth = 0;
  let rendererHeight = 0;
  function getSharedRenderer(width, height) {
    if (typeof THREE === "undefined") return null;
    if (!sharedRenderer) {
      sharedRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      sharedRenderer.setClearColor(0x000000, 0);
    }
    if (width !== rendererWidth || height !== rendererHeight) {
      sharedRenderer.setSize(width, height, false);
      rendererWidth = width;
      rendererHeight = height;
    }
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

  // ---- Presety wyglądu planet ---------------------------------------------
  function applyPlanetPreset(uniforms, name) {
    if (!uniforms) return;
    switch ((name||'').toLowerCase()) {
      case 'terran':
      case 'terrania':
      case 'terran': {
        // Szum/teren – duże „kontynenty”, sporo poziomów
        uniforms.type.value         = 2;     // fractal
        uniforms.amplitude.value    = 1.02;
        uniforms.sharpness.value    = 1.56;
        uniforms.offset.value       = -0.088; // lekko w dół => woda
        uniforms.period.value       = 0.526;  // rozmiar plam/mas lądowych
        uniforms.persistence.value  = 0.58;
        uniforms.lacunarity.value   = 1.95;
        uniforms.octaves.value      = 10;

        // Kolory warstw (od najniższego „h” do najwyższego)
        // 1-2: woda (głęboka -> płytka), 3: plaża, 4: zieleń/góry, 5: śnieg
        uniforms.color1.value.set('#0a366f'); // deep water
        uniforms.color2.value.set('#2aaed6'); // shallow / laguny
        uniforms.color3.value.set('#e8d6b3'); // piasek / plaża
        uniforms.color4.value.set('#4a9a40'); // trawa/las / niskie góry
        uniforms.color5.value.set('#e6f2ff'); // śnieg

        // Progi przejść między warstwami (skalowane do „h” z shaderów)
        uniforms.transition2.value  = 0.035;  // deep->shallow
        uniforms.transition3.value  = 0.058;  // shallow->beach
        uniforms.transition4.value  = 0.110;  // beach->green
        uniforms.transition5.value  = 0.200;  // green->snow
        uniforms.blend12.value      = 0.010;
        uniforms.blend23.value      = 0.012;
        uniforms.blend34.value      = 0.030;
        uniforms.blend45.value      = 0.060;

        // Światło / połysk / bump
        uniforms.ambientIntensity.value  = 0.08;
        uniforms.diffuseIntensity.value  = 1.10;
        uniforms.specularIntensity.value = 0.20;
        uniforms.shininess.value         = 10.0;
        uniforms.bumpStrength.value      = 1.0;
        uniforms.bumpOffset.value        = 0.001;
        uniforms.lightColor.value.set('#ffffff');
        break;
      }
      default:
        // Zostaw domyślne – zawsze można dodać kolejne presety (volcanic/frozen itp.)
        break;
    }
  }

  class ProcPlanet {
    constructor(worldX, worldY, pixelSize, opts={}) {
      this.x = worldX; 
      this.y = worldY;
      // target size on screen in world units (used only when drawing to 2D)
      this.size = pixelSize || 64;
      this.style = opts.style || null;

      // own 2D canvas to blit the rendered planet
      this.canvas = document.createElement("canvas");
      this.canvas.width = 256;
      this.canvas.height = 256;
      this.ctx2d = this.canvas.getContext("2d");
      // mały offscreen do „halo” atmosfery
      this.atmo = document.createElement('canvas');
      this.atmo.width = this.atmo.height = 256;
      const ag = this.atmo.getContext('2d');
      const rg = ag.createRadialGradient(128,128,110, 128,128,128);
      rg.addColorStop(0.75, 'rgba(160,200,255,0.10)');
      rg.addColorStop(1.00, 'rgba(160,200,255,0.00)');
      ag.fillStyle = rg; ag.beginPath(); ag.arc(128,128,128,0,Math.PI*2); ag.fill();

      // build scene
      if (typeof THREE === "undefined") return;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      this.camera.position.z = 3;

      const geom = new THREE.SphereGeometry(1, 128, 128);
      geom.computeTangents?.();

      this.material = buildPlanetMaterial();
      // zastosuj preset (jeśli jest)
      applyPlanetPreset(this.material.uniforms, this.style);
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
      // delikatna atmosfera na wierzchu
      this.ctx2d.globalCompositeOperation = 'lighter';
      this.ctx2d.drawImage(this.atmo, 0, 0);
      this.ctx2d.globalCompositeOperation = 'source-over';
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
      const hasPP = (typeof EffectComposer !== 'undefined') &&
               (typeof RenderPass !== 'undefined') &&
               (typeof UnrealBloomPass !== 'undefined');
if (hasPP && (!this.composer || this._renderer !== r)) {
  this._renderer = r;
  this.composer = new EffectComposer(r);
  this.composer.setSize(this.canvas.width, this.canvas.height);
  const rp = new RenderPass(this.scene, this.camera);
  this.bloom = new UnrealBloomPass(new THREE.Vector2(this.canvas.width, this.canvas.height), 1.14, 1.04, 0.0);
  this.composer.addPass(rp);
  this.composer.addPass(this.bloom);
}
if (this.composer) {
  this.composer.render();
} else {
  r.render(this.scene, this.camera);
}
this.ctx2d.clearRect(0,0,this.canvas.width,this.canvas.height);
      const zoom = 1.3;
      const srcW = this.canvas.width / zoom;
      const srcH = this.canvas.height / zoom;
      const srcX = (this.canvas.width - srcW) / 2;
      const srcY = (this.canvas.height - srcH) / 2;
      this.ctx2d.drawImage(r.domElement, srcX, srcY, srcW, srcH, 0, 0, this.canvas.width, this.canvas.height);
      this.ctx2d.globalCompositeOperation = "destination-in";
      this.ctx2d.beginPath();
      this.ctx2d.arc(this.canvas.width/2, this.canvas.height/2, this.canvas.width/2, 0, Math.PI*2);
      this.ctx2d.fill();
      this.ctx2d.globalCompositeOperation = "source-over";
    }
  }

  class AsteroidBelt3D {
    constructor(innerRadius, outerRadius, count = 200) {
      this.size = outerRadius * 2;
      this.canvas = document.createElement("canvas");
      // wyższa rozdzielczość, żeby nie było "mgły" po skalowaniu
      this.canvas.width = 1024;
      this.canvas.height = 1024;
      this.ctx2d = this.canvas.getContext("2d");
      if (typeof THREE === "undefined") return;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      this.camera.position.z = 5;

      // subtelne tło + kierunkowe "od słońca"
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
      const sunDir = new THREE.DirectionalLight(0xffffff, 1.35);
      // kierunek lekko z góry i z boku (ładne kontrasty bez przepaleń)
      sunDir.position.set(1, 1, 2).normalize();
      this.scene.add(sunDir);

      const geom = new THREE.IcosahedronGeometry(1, 1);
      const pos = geom.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const rand = 0.8 + Math.random() * 0.4;
        pos.setXYZ(i, pos.getX(i) * rand, pos.getY(i) * rand, pos.getZ(i) * rand);
      }
      geom.computeVertexNormals();
      // kamienna, matowa powierzchnia; kolor łatwo zmienisz .color.set(...)
      const mat = new THREE.MeshStandardMaterial({
        color: 0xD9D9D9,        // jasnoszary (możesz podmienić na #ffffff dla "białych")
        roughness: 0.92,
        metalness: 0.0,
        flatShading: true
      });
      this.mesh = new THREE.InstancedMesh(geom, mat, count);
      const m = new THREE.Matrix4();
      const rotM = new THREE.Matrix4();
      const scaleM = new THREE.Matrix4();
      const euler = new THREE.Euler();
      const inner = innerRadius / outerRadius;
      for (let i = 0; i < count; i++) {
        const radius = inner + Math.random() * (1 - inner);
        const angle = Math.random() * TAU;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const z = (Math.random() - 0.5) * 0.1;
        const scale = 0.02 + Math.random() * 0.04;
        m.makeTranslation(x, y, z);
        euler.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
        rotM.makeRotationFromEuler(euler);
        scaleM.makeScale(scale, scale, scale);
        m.multiply(rotM);
        m.multiply(scaleM);
        this.mesh.setMatrixAt(i, m);
      }
      this.mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(this.mesh);
      this.rotationSpeed = 0.02;
      this.rotation = 0;

      // Losowe asteroidy w jednostkach świata do rysowania bezpośrednio na canvasie 2D
      this.asteroids = [];
      for (let i = 0; i < 2000; i++) {
        this.asteroids.push({
          angle: Math.random() * TAU,
          radius: innerRadius + Math.random() * (outerRadius - innerRadius),
          size: 20 + Math.random() * 40,
        });
      }
    }

    render(dt) {
      if (!this.scene || !this.camera) return;
      this.mesh.rotation.z += this.rotationSpeed * dt;
      this.rotation += this.rotationSpeed * dt;
      const r = getSharedRenderer(this.canvas.width, this.canvas.height);
      if (!r) return;
      r.render(this.scene, this.camera);
      this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx2d.drawImage(r.domElement, 0, 0);
    }

    // Rysuje pojedyncze asteroidy jako małe kropki na głównym canvasie
    draw(ctx, cam) {
      if (!this.asteroids) return;
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      ctx.fillStyle = "#bbb";
      for (const a of this.asteroids) {
        const ang = a.angle + this.rotation;
        const x = SUN_POS.x + Math.cos(ang) * a.radius;
        const y = SUN_POS.y + Math.sin(ang) * a.radius;
        const s = worldToScreen(x, y, cam);
        const size = a.size * camera.zoom;
        if (s.x < -size || s.y < -size || s.x > w + size || s.y > h + size) continue;
        ctx.beginPath();
        ctx.arc(s.x, s.y, size / 2, 0, TAU);
        ctx.fill();
      }
    }
  }

  // === Public API (keeps your game's calls intact) ===
  let _planets = [];
  function initPlanets3D(list, sunObj) {
    _planets.length = 0;
    for (const s of list) {
      const size = (s.r || 30) * 2.0;
      const p = new ProcPlanet(s.x, s.y, size, { style: s.type || null });
      _planets.push(p);
    }
    if (sunObj) {
      SUN_POS = { x: sunObj.x || 0, y: sunObj.y || 0, z: 0 };
      sun = new Sun3D((sunObj.r || 200) * 2.5);
      sun.x = sunObj.x;
      sun.y = sunObj.y;
    }
    asteroidBelt = null;
    if (list[3] && list[4]) {
      const r1 = list[3].orbitRadius;
      const r2 = list[4].orbitRadius;
      const mid = (r1 + r2) / 2;
      const width = (r2 - r1) * 0.2;
      const inner = mid - width / 2;
      const outer = mid + width / 2;
      asteroidBelt = new AsteroidBelt3D(inner, outer);
    }
  }
  function updatePlanets3D(dt) {
    if (sun) sun.render(dt);
    if (asteroidBelt) asteroidBelt.render(dt);
    for (const p of _planets) p.render(dt);
  }
  function drawPlanets3D(ctx, cam) {
      if (asteroidBelt && sun) {
        const ss = worldToScreen(sun.x, sun.y, cam);
        const sizeB = asteroidBelt.size * camera.zoom;
        ctx.drawImage(asteroidBelt.canvas, ss.x - sizeB/2, ss.y - sizeB/2, sizeB, sizeB);
        asteroidBelt.draw(ctx, cam);
      }
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
  window.getSharedRenderer = getSharedRenderer;
})();
