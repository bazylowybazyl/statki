window.Dev = window.Dev || {};
const PLANET_SIZE_MULTIPLIER = 4.5;
const SUN_SIZE_MULTIPLIER = 6.0;

// --- KONFIGURACJA TŁA (USTAWIONE TWOJE WARTOŚCI) ---
const BG_CONFIG = {
    starCount: 6000,
    worldScale: 10000,
    starBaseSize: 7.0,          // TWOJA WARTOŚĆ
    warpStretchStrength: 16.0,  // TWOJA WARTOŚĆ
    warpThinning: 45.0,         // TWOJA WARTOŚĆ
    parallaxSpeed: 0.05,
    nebulaColor1: new THREE.Color('#050810'),
    nebulaColor2: new THREE.Color('#1a2030'),
    chargeDuration: 1.3,        // TWOJA WARTOŚĆ
    brakeDuration: 0.5          // TWOJA WARTOŚĆ
};

// --- SHADERS DLA GWIAZD (DIRECTIONAL STRETCH) ---

const STARS_VERTEX = `
uniform vec2 cameraOffset;
uniform float containerSize;
uniform float perspectiveScale;
uniform float warpFactor;
uniform float stretchStrength;
uniform float baseSizeMul;
uniform vec2 moveDir; 

attribute float size;
attribute float brightness;
attribute vec3 color;

varying float vBrightness;
varying float vWarp;
varying vec3 vColor;
varying float vStretch;
varying float vScreenSize;

void main() {
    vBrightness = brightness;
    vWarp = warpFactor;
    vColor = color;
    vec3 pos = position;
    
    pos.x -= cameraOffset.x;
    pos.y -= cameraOffset.y;
    float halfSize = containerSize / 2.0;
    pos.x = mod(pos.x + halfSize, containerSize) - halfSize;
    pos.y = mod(pos.y + halfSize, containerSize) - halfSize;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    
    float stretch = 1.0 + (warpFactor * stretchStrength);
    vStretch = stretch; 
    
    float finalSize = size * baseSizeMul;
    float depth = -mvPosition.z;
    float distFactor = perspectiveScale / max(depth, 10.0);
    float pointSize = (finalSize * stretch) * distFactor;
    
    // Przesunięcie czoła gwiazdy w tył przy rozciąganiu (kierunkowe)
    if(warpFactor > 0.0) {
        float offsetWorld = (finalSize * (stretch - 1.0)) * 0.5;
        mvPosition.xy -= moveDir * offsetWorld;
    }

    gl_PointSize = pointSize;
    gl_Position = projectionMatrix * mvPosition;
    vScreenSize = pointSize;
}
`;

const STARS_FRAGMENT = `
uniform sampler2D pointTexture;
uniform float time;
uniform float globalBrightness;
uniform vec2 moveDir;
uniform float thinningStrength;

varying float vBrightness;
varying float vWarp;
varying vec3 vColor;
varying float vStretch; 
varying float vScreenSize;

void main() {
    vec2 rawUV = gl_PointCoord - 0.5;
    
    // Maska usuwająca prostokątne zniekształcenia
    float distFromCenter = length(rawUV);
    float mask = 1.0 - smoothstep(0.4, 0.5, distFromCenter);
    if (mask < 0.01) discard;

    vec2 uv = rawUV;
    
    if (vWarp > 0.01) {
        float angle = atan(moveDir.y, moveDir.x);
        float c = cos(angle); float s = sin(angle);
        mat2 rot = mat2(c, s, -s, c);
        uv = rot * uv;
        uv.x *= (1.0 / vStretch); 
        
        float maxSafeThin = max(1.0, vScreenSize * 0.4);
        float actualThin = min(thinningStrength, maxSafeThin);
        uv.y *= (1.0 + vWarp * actualThin); 
    }

    vec2 texUV = uv + 0.5;
    if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) discard;

    vec4 tex = texture2D(pointTexture, texUV);
    if (tex.a < 0.05) discard;

    float twinkle = 0.8 + 0.2 * sin(time * 3.0 + vBrightness * 10.0);
    vec3 finalColor = mix(vColor, vec3(0.6, 0.8, 1.0), vWarp * 0.8);
    gl_FragColor = vec4(finalColor * twinkle, tex.a * vBrightness * globalBrightness * mask);
}
`;

// --- TWOJE SHADERY PLANET (BEZ ZMIAN) ---

const EARTH_VERTEX = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vec4 mvPosition = viewMatrix * worldPosition;
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const EARTH_FRAGMENT = `
uniform sampler2D dayTexture;
uniform sampler2D nightTexture;
uniform sampler2D specularTexture; 
uniform sampler2D normalTexture;   
uniform vec3 sunPosition;
uniform float hasNightTexture; 
uniform float uBrightness;  
uniform float uAmbient;     
uniform float uSpecular;    
uniform float uSunWrap;     
uniform float uSunIntensity;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 lightDir = normalize(sunPosition - vWorldPosition);
    vec3 halfVector = normalize(lightDir + viewDir);
    vec3 normal = normalize(vNormal);
    if (hasNightTexture > 0.5) {
        vec3 mapN = texture2D(normalTexture, vUv).xyz * 2.0 - 1.0;
        mapN.xy *= 0.8; 
        vec3 q0 = dFdx(vWorldPosition.xyz); vec3 q1 = dFdy(vWorldPosition.xyz);
        vec2 st0 = dFdx(vUv.st); vec2 st1 = dFdy(vUv.st);
        vec3 S = normalize(q0 * st1.t - q1 * st0.t);
        vec3 T = normalize(-q0 * st1.s + q1 * st0.s);
        mat3 tsn = mat3(S, T, normalize(vNormal));
        normal = normalize(tsn * mapN);
    }
    float NdotL = dot(normal, lightDir);
    float intensity = max(uAmbient, max(0.0, NdotL) * uSunIntensity);
    vec4 dayColor = texture2D(dayTexture, vUv);
    vec4 nightColor = texture2D(nightTexture, vUv);
    float specular = (NdotL > 0.0) ? pow(max(0.0, dot(normal, halfVector)), 10.0) * texture2D(specularTexture, vUv).r * uSpecular * uSunIntensity : 0.0;
    float mixFactor = smoothstep(-0.15 - uSunWrap, 0.15, NdotL);
    vec3 finalColor = (hasNightTexture > 0.5) ? mix(nightColor.rgb * 3.0, dayColor.rgb * uBrightness * intensity + vec3(0.7, 0.8, 1.0) * specular, mixFactor) : dayColor.rgb * clamp(NdotL, uAmbient, 1.0) * uBrightness * uSunIntensity;
    gl_FragColor = vec4(finalColor, 1.0);
}
`;

const ATMOSPHERE_VERTEX = `
varying vec3 vNormal;
varying vec3 vWorldPosition;
void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const ATMOSPHERE_FRAGMENT = `
varying vec3 vNormal;
varying vec3 vWorldPosition;
uniform vec3 glowColor;
uniform vec3 sunPosition;
uniform float coef;
uniform float power;
uniform float uSunIntensity;
void main() {
    float rim = pow(coef - dot(vNormal, vec3(0.0, 0.0, 1.0)), power);
    float dayFactor = smoothstep(-0.2, 0.2, dot(vNormal, normalize(sunPosition - vWorldPosition))) + 0.1;
    gl_FragColor = vec4(glowColor, rim * dayFactor * clamp(uSunIntensity, 0.5, 1.5));
}
`;

// --- RENDERER ---

const PlanetRenderer = {
    renderer: null,
    scene: null, camera: null, sunLight: null,
    bgScene: null, bgCamera: null, bgUniforms: null,
    width: 0, height: 0, time: 0,

    init: function() {
        const canvas = document.getElementById('webgl-layer');
        if (!canvas || !window.THREE) return;

        this.renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.autoClear = false;

        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300000);
        this.camera.position.z = 150000;

        this.sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.3));
        this.scene.add(this.sunLight);

        this.initBackground();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    },

    initBackground: function() {
        this.bgScene = new THREE.Scene();
        this.bgCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 20000);
        this.bgCamera.position.z = 1000;

        const starGeo = new THREE.BufferGeometry();
        const count = BG_CONFIG.starCount;
        const posArr = new Float32Array(count * 3);
        const sizeArr = new Float32Array(count);
        const brightArr = new Float32Array(count);
        const colArr = new Float32Array(count * 3);

        for(let i=0; i<count; i++) {
            posArr[i*3] = (Math.random() - 0.5) * BG_CONFIG.worldScale;
            posArr[i*3+1] = (Math.random() - 0.5) * BG_CONFIG.worldScale;
            posArr[i*3+2] = (Math.random() - 0.5) * 5000;
            sizeArr[i] = 1.0 + Math.pow(Math.random(), 3.0) * 4.0;
            brightArr[i] = 0.5 + Math.random() * 0.5;
            const c = new THREE.Color().setHSL(Math.random() * 0.1 + 0.6, 0.5, 0.8);
            colArr[i*3] = c.r; colArr[i*3+1] = c.g; colArr[i*3+2] = c.b;
        }

        starGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        starGeo.setAttribute('size', new THREE.BufferAttribute(sizeArr, 1));
        starGeo.setAttribute('brightness', new THREE.BufferAttribute(brightArr, 1));
        starGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

        this.bgUniforms = {
            pointTexture: { value: this.createStarTexture() },
            time: { value: 0 },
            cameraOffset: { value: new THREE.Vector2(0, 0) },
            containerSize: { value: BG_CONFIG.worldScale },
            perspectiveScale: { value: 600.0 },
            globalBrightness: { value: 1.2 },
            warpFactor: { value: 0.0 },
            moveDir: { value: new THREE.Vector2(0, 1) },
            stretchStrength: { value: BG_CONFIG.warpStretchStrength },
            thinningStrength: { value: BG_CONFIG.warpThinning },
            baseSizeMul: { value: BG_CONFIG.starBaseSize }
        };

        const starPoints = new THREE.Points(starGeo, new THREE.ShaderMaterial({
            uniforms: this.bgUniforms, vertexShader: STARS_VERTEX, fragmentShader: STARS_FRAGMENT,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        }));
        this.bgScene.add(starPoints);
    },

    createStarTexture: function() {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.3, 'rgba(200, 230, 255, 0.6)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    },

    resize: function() {
        if (!this.renderer) return;
        this.width = window.innerWidth; this.height = window.innerHeight;
        this.renderer.setSize(this.width, this.height, false);
        if(this.bgCamera) { this.bgCamera.aspect = this.width / this.height; this.bgCamera.updateProjectionMatrix(); }
    },

    render: function(gameCamera) {
        if (!this.renderer) return;
        this.time += 0.016;

        // 1. Render Tła
        this.renderer.clear();
        if(this.bgUniforms) {
            const px = gameCamera.x * BG_CONFIG.parallaxSpeed;
            const py = -gameCamera.y * BG_CONFIG.parallaxSpeed;
            this.bgUniforms.cameraOffset.value.set(px, py);
            this.bgUniforms.time.value = this.time;
            
            // Logika Warp (Pobierana z gameCamera)
            this.bgUniforms.warpFactor.value = gameCamera.warpFactor || 0;
            if(gameCamera.moveDir) this.bgUniforms.moveDir.value.copy(gameCamera.moveDir);
        }
        this.renderer.render(this.bgScene, this.bgCamera);

        // 2. Render Planet
        const zoom = gameCamera.zoom;
        const w = this.width / zoom; const h = this.height / zoom;
        this.camera.left = -w / 2; this.camera.right = w / 2; this.camera.top = h / 2; this.camera.bottom = -h / 2;
        this.camera.updateProjectionMatrix();
        this.camera.position.x = gameCamera.x; this.camera.position.y = -gameCamera.y;
        
        if (window.SUN) {
            const sunX = window.SUN.x; const sunY = -window.SUN.y;
            this.sunLight.position.set(sunX, sunY, 100000);
            this.sunLight.target.position.set(sunX, sunY, 0); 
            this.sunLight.target.updateMatrixWorld();
        }
        this.renderer.render(this.scene, this.camera);
    }
};

window.PlanetRenderer = PlanetRenderer;

// --- RESZTA LOGIKI (DirectPlanet, DirectSun, initPlanets3D) ---
// (Pozostaje zgodna z Twoim wgranym plikiem, ale używa PlanetRenderer)

const textureLoader = new THREE.TextureLoader();
function loadTex(path) {
    const tex = textureLoader.load(path);
    if (PlanetRenderer.renderer) { tex.anisotropy = PlanetRenderer.renderer.capabilities.getMaxAnisotropy(); }
    return tex;
}

class DirectPlanet {
    constructor(data) {
        this.data = data; this.group = new THREE.Group();
        this.uniforms = {
            dayTexture: { value: null }, nightTexture: { value: null }, specularTexture: { value: null }, normalTexture: { value: null },
            sunPosition: { value: new THREE.Vector3(0, 0, 0) }, hasNightTexture: { value: 0.0 },
            uBrightness: { value: 1.5 }, uAmbient: { value: 0.02 }, uSpecular: { value: 0.3 }, uSunWrap: { value: 0.0 }, uSunIntensity: { value: 2.2 }
        };
        this.init();
    }
    init() {
        const name = (this.data.name || this.data.id || 'earth').toLowerCase();
        const dayTex = loadTex(`/assets/planety/solar/${name}/${name}_color.jpg`);
        dayTex.colorSpace = THREE.SRGBColorSpace; this.uniforms.dayTexture.value = dayTex;
        
        if (name === 'earth') {
            this.uniforms.nightTexture.value = loadTex(`/assets/planety/images/earth_nightmap.jpg`);
            this.uniforms.specularTexture.value = loadTex(`/assets/planety/images/earth_specularmap.jpg`);
            this.uniforms.normalTexture.value = loadTex(`/assets/planety/solar/earth/earth_normal.jpg`);
            this.uniforms.hasNightTexture.value = 1.0;
        }

        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: EARTH_VERTEX, fragmentShader: EARTH_FRAGMENT, extensions: { derivatives: true } }));
        this.group.add(mesh);

        // Atmosfera
        let atmColor = new THREE.Vector3(0.3, 0.6, 1.0);
        if (name === 'venus') atmColor.set(0.9, 0.7, 0.2);
        if (name === 'mars') atmColor.set(0.8, 0.4, 0.2);

        this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.1, 64, 64), new THREE.ShaderMaterial({
            vertexShader: ATMOSPHERE_VERTEX, fragmentShader: ATMOSPHERE_FRAGMENT,
            uniforms: { coef: { value: 0.47 }, power: { value: 8.0 }, glowColor: { value: atmColor }, uSunIntensity: { value: 2.2 }, sunPosition: { value: new THREE.Vector3(0,0,0) } },
            transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending
        }));
        this.group.add(this.atmosphere);
        PlanetRenderer.scene.add(this.group);
    }
    update(dt) {
        this.group.position.set(this.data.x, -this.data.y, 0);
        const scale = (this.data.r || 100) * PLANET_SIZE_MULTIPLIER;
        this.group.scale.set(scale, scale, scale);
        if (window.SUN) {
            const sPos = new THREE.Vector3(window.SUN.x, -window.SUN.y, 0);
            this.uniforms.sunPosition.value.copy(sPos);
            if (this.atmosphere) this.atmosphere.material.uniforms.sunPosition.value.copy(sPos);
        }
    }
}

class DirectSun {
    constructor(data) { this.data = data; this.group = new THREE.Group(); this.init(); }
    init() {
        this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), new THREE.MeshBasicMaterial({ map: loadTex('/assets/planety/solar/sun/sun_color.jpg') }));
        this.group.add(this.mesh);
        PlanetRenderer.scene.add(this.group);
    }
    update(dt) {
        this.group.position.set(this.data.x, -this.data.y, -500);
        const scale = (this.data.r3D || this.data.r || 200) * SUN_SIZE_MULTIPLIER;
        this.mesh.scale.set(scale, scale, scale);
    }
}

const _entities = [];
window.initPlanets3D = function(planetList, sunData) {
    _entities.length = 0;
    if (!PlanetRenderer.renderer) PlanetRenderer.init();
    else { while(PlanetRenderer.scene.children.length > 0) PlanetRenderer.scene.remove(PlanetRenderer.scene.children[0]);
           PlanetRenderer.scene.add(new THREE.AmbientLight(0xffffff, 0.3)); PlanetRenderer.scene.add(PlanetRenderer.sunLight); }
    if (sunData) _entities.push(new DirectSun(sunData));
    if (Array.isArray(planetList)) planetList.forEach(p => _entities.push(new DirectPlanet(p)));
};
window.updatePlanets3D = function(dt) { _entities.forEach(e => e.update(dt)); };
window.drawPlanets3D = function(ctx, cam) { PlanetRenderer.render(cam); };