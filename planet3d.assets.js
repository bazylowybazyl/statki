window.Dev = window.Dev || {};
const PLANET_SIZE_MULTIPLIER = 4.5;
const SUN_SIZE_MULTIPLIER = 6.0;

// ==========================================
// 1. SHADERS: STARS (SYSTEM GWIAZD)
// ==========================================

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
        
        // Nieskończony świat (Modulo)
        // Odejmujemy offset kamery, aby symulować ruch wewnątrz statycznego mesha
        pos.x -= cameraOffset.x;
        pos.y -= cameraOffset.y;
        
        float halfSize = containerSize / 2.0;
        pos.x = mod(pos.x + halfSize, containerSize) - halfSize;
        pos.y = mod(pos.y + halfSize, containerSize) - halfSize;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        
        // Skala rozciągnięcia (zależna od warpFactor)
        float stretch = 1.0 + (warpFactor * stretchStrength);
        vStretch = stretch; 
        
        float finalSize = size * baseSizeMul;
        
        // Stała głębia dla kamery Ortho
        float depth = 1000.0; 
        float distFactor = perspectiveScale / depth;
        float pointSize = (finalSize * stretch) * distFactor;
        
        // Rozciąganie kierunkowe: 
        if(warpFactor > 0.001) {
            float offsetWorld = (finalSize * (stretch - 1.0)) * 0.05;
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
        
        // Miękka maska kołowa
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
        vec3 finalColor = mix(vColor, vec3(0.7, 0.85, 1.0), vWarp * 0.7);
        float boost = 1.0 + vWarp * 2.5; 

        gl_FragColor = vec4(finalColor * twinkle, tex.a * vBrightness * globalBrightness * boost * mask);
    }
`;

// ==========================================
// 2. SHADERS: PLANETS
// ==========================================

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
        vec3 q0 = dFdx(vWorldPosition.xyz);
        vec3 q1 = dFdy(vWorldPosition.xyz);
        vec2 st0 = dFdx(vUv.st);
        vec2 st1 = dFdy(vUv.st);
        vec3 S = normalize(q0 * st1.t - q1 * st0.t);
        vec3 T = normalize(-q0 * st1.s + q1 * st0.s);
        vec3 N = normalize(vNormal);
        mat3 tsn = mat3(S, T, N);
        normal = normalize(tsn * mapN);
    }

    float NdotL = dot(normal, lightDir);
    float directLight = max(0.0, NdotL) * uSunIntensity;
    float intensity = max(uAmbient, directLight);

    vec4 dayColor = texture2D(dayTexture, vUv);
    vec4 nightColor = texture2D(nightTexture, vUv);
    float specularMask = texture2D(specularTexture, vUv).r;

    float specular = 0.0;
    if (NdotL > 0.0) {
        float NdotH = max(0.0, dot(normal, halfVector));
        float shininess = 10.0; 
        specular = pow(NdotH, shininess) * specularMask * uSpecular * uSunIntensity;
    }

    float terminatorEdge = -0.15 - uSunWrap; 
    float mixFactor = smoothstep(terminatorEdge, 0.15, NdotL);
    vec3 finalColor;

    if (hasNightTexture > 0.5) {
        vec3 daySide = dayColor.rgb * uBrightness;
        daySide *= intensity;
        daySide += vec3(0.7, 0.8, 1.0) * specular; 
        vec3 nightSide = nightColor.rgb * 3.0;
        finalColor = mix(nightSide, daySide, mixFactor);
    } else {
        float light = clamp(NdotL, uAmbient, 1.0);
        finalColor = dayColor.rgb * light * uBrightness * uSunIntensity;
    }
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
    vec3 lightDir = normalize(sunPosition - vWorldPosition);
    float sunDot = dot(vNormal, lightDir);
    float dayFactor = smoothstep(-0.2, 0.2, sunDot) + 0.1;
    float intensity = rim * dayFactor;
    intensity = clamp(intensity, 0.0, 1.0); 
    gl_FragColor = vec4(glowColor, intensity * clamp(uSunIntensity, 0.5, 1.5));
}
`;

// ==========================================
// 3. SYSTEM GWIAZD (POPRAWIONY: ULTRAWIDE + PARALAKSA)
// ==========================================

const StarSystem = {
    mesh: null,
    uniforms: null,
    count: 40000,        // Zwiększona ilość dla gęstości
    worldScale: 100000,  // Ogromny obszar dla monitorów Ultrawide
    lastWarpState: 'idle',
    exitTimer: 0,

    init: function(scene) {
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(this.count * 3);
        const sizes = new Float32Array(this.count);
        const brights = new Float32Array(this.count);
        const colors = new Float32Array(this.count * 3);
        const tempColor = new THREE.Color();

        for(let i=0; i < this.count; i++) {
            positions[i*3] = (Math.random() - 0.5) * this.worldScale;
            positions[i*3+1] = (Math.random() - 0.5) * this.worldScale;
            positions[i*3+2] = -5000; 

            sizes[i] = 1.0 + Math.pow(Math.random(), 3.0) * 4.0; 
            brights[i] = 0.4 + Math.random() * 0.6;
            
            const r = Math.random();
            if(r > 0.85) tempColor.setHex(0x9bb0ff); 
            else if(r > 0.55) tempColor.setHex(0xfff4e8); 
            else if(r > 0.25) tempColor.setHex(0xffd2a1); 
            else tempColor.setHex(0xffcc6f); 
            
            colors[i*3] = tempColor.r; 
            colors[i*3+1] = tempColor.g; 
            colors[i*3+2] = tempColor.b;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geo.setAttribute('brightness', new THREE.BufferAttribute(brights, 1));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        this.uniforms = {
            pointTexture: { value: this.createStarTexture() },
            time: { value: 0 },
            cameraOffset: { value: new THREE.Vector2(0, 0) },
            containerSize: { value: this.worldScale },
            perspectiveScale: { value: 800.0 },
            globalBrightness: { value: 1.2 },
            warpFactor: { value: 0.0 },
            moveDir: { value: new THREE.Vector2(0, 1) },
            stretchStrength: { value: 25.0 },
            thinningStrength: { value: 45.0 },
            baseSizeMul: { value: 1.0 }
        };

        const mat = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: STARS_VERTEX,
            fragmentShader: STARS_FRAGMENT,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.mesh = new THREE.Points(geo, mat);
        this.mesh.renderOrder = -1;
        this.mesh.frustumCulled = false; 
        scene.add(this.mesh);
    },

    createStarTexture: function() {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.3, 'rgba(200, 230, 255, 0.7)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    },

    update: function(dt, gameCamera, ship) {
        if (!this.uniforms || !gameCamera) return;
        const cx = typeof gameCamera.x === 'number' ? gameCamera.x : 0;
        const cy = typeof gameCamera.y === 'number' ? gameCamera.y : 0;

        this.uniforms.time.value += dt;

        // 1. FIX ULTRAWIDE: Gwiazdy podążają za kamerą
        if (this.mesh) {
            this.mesh.position.set(cx, -cy, -10000); 
        }

        // 2. FIX PARALAKSA: Zwiększono mnożnik z 0.05 na 0.25
        this.uniforms.cameraOffset.value.set(cx * 0.25, -cy * 0.25);

        // Kierunek rozciągania
        let dx = 0, dy = 1;
        if (ship && ship.vel) {
             const speed = Math.hypot(ship.vel.x, ship.vel.y);
             if (speed > 10) {
                 dx = ship.vel.x / speed;
                 dy = ship.vel.y / speed;
             } else if (typeof ship.angle === 'number') {
                 dx = Math.sin(ship.angle);
                 dy = -Math.cos(ship.angle);
             }
        }
        
        // Logika Warpa (bez zmian logicznych, tylko podpięcie)
        let targetWarp = 0.0;
        if (window.warp) {
            const currentState = window.warp.state;
            if (this.lastWarpState === 'active' && currentState !== 'active') {
                this.exitTimer = 0.8;
            }
            this.lastWarpState = currentState;

            if (currentState === 'active') {
                targetWarp = 1.0;
                // W warpie gwiazdy lecą zgodnie z kierunkiem warpa
                if (window.warp.dir) {
                    dx = window.warp.dir.x;
                    dy = window.warp.dir.y;
                }
            } else if (currentState === 'charging' && window.warp.chargeTime > 0) {
                const progress = Math.min(1, window.warp.charge / window.warp.chargeTime);
                targetWarp = Math.pow(progress, 3.0) * 0.3;
            }
        }

        if (this.exitTimer > 0) {
            this.exitTimer -= dt;
            const progress = Math.max(0, this.exitTimer / 0.8);
            targetWarp = Math.max(targetWarp, Math.pow(progress, 2.0) * 1.5);
        }

        // Aplikacja do shadera (-dy bo Three.js ma odwrócony Y)
        this.uniforms.moveDir.value.set(dx, -dy); 

        const currentWarp = this.uniforms.warpFactor.value;
        const lerpSpeed = (this.exitTimer > 0) ? 8.0 : 4.0;
        this.uniforms.warpFactor.value += (targetWarp - currentWarp) * lerpSpeed * dt;
    }
};
// ==========================================
// 4. PLANET RENDERER
// ==========================================

const PlanetRenderer = {
    renderer: null,
    scene: null,
    camera: null,
    sunLight: null,
    ambientLight: null,
    width: 0,
    height: 0,
    
    init: function() {
        const canvas = document.getElementById('webgl-layer');
        if (!canvas || !window.THREE) return;

        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            alpha: true,
            antialias: true,
            powerPreference: "high-performance",
            logarithmicDepthBuffer: true 
        });
        
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.shadowMap.enabled = false; 

        this.scene = new THREE.Scene();

        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300000);
        this.camera.position.z = 150000;
        this.camera.lookAt(0, 0, 0);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        this.scene.add(this.ambientLight);

        this.sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
        this.sunLight.position.set(0, 0, 100000);
        this.scene.add(this.sunLight);

        StarSystem.init(this.scene);

        this.resize();
        window.addEventListener('resize', () => this.resize());
    },

    resize: function() {
        if (!this.renderer) return;
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.renderer.setSize(this.width, this.height, false);
    },

    render: function(gameCamera) {
        if (!this.renderer || !gameCamera) return;

        const dt = 1/60; 

        // 1. Aktualizacja Gwiazd
        StarSystem.update(dt, gameCamera, window.ship);

        // 2. Synchronizacja Kamery Three.js z Kamerą Gry
        const zoom = gameCamera.zoom || 1;
        const w = this.width / zoom;
        const h = this.height / zoom;
        
        this.camera.left = -w / 2;
        this.camera.right = w / 2;
        this.camera.top = h / 2;
        this.camera.bottom = -h / 2;
        this.camera.updateProjectionMatrix();
        
        this.camera.position.x = gameCamera.x;
        this.camera.position.y = -gameCamera.y;
        
        // 3. Pozycja Światła Słońca (absolutna)
        if (window.SUN) {
            const sunX = window.SUN.x;
            const sunY = -window.SUN.y; 
            this.sunLight.position.set(sunX, sunY, 100000);
            this.sunLight.target.position.set(sunX, sunY, 0); 
            this.sunLight.target.updateMatrixWorld();
        }

        // 4. Aktualizacja Planet (Pozycjonowanie absolutne)
        if (window._entities) {
            window._entities.forEach(ent => {
                if (ent.update) ent.update(dt, gameCamera);
            });
        }

        this.renderer.render(this.scene, this.camera);
    }
};

window.PlanetRenderer = PlanetRenderer;

const textureLoader = new THREE.TextureLoader();
function loadTex(path) {
    const tex = textureLoader.load(path);
    if (PlanetRenderer.renderer) {
        tex.anisotropy = PlanetRenderer.renderer.capabilities.getMaxAnisotropy();
    }
    return tex;
}

// ==========================================
// 5. CLASSES: PLANET & SUN
// ==========================================

class DirectPlanet {
    constructor(data) {
        this.data = data;
        this.mesh = null;
        this.clouds = null;
        this.atmosphere = null;
        this.group = new THREE.Group();
        
        this.uniforms = {
            dayTexture: { value: null },
            nightTexture: { value: null },
            specularTexture: { value: null },
            normalTexture: { value: null },
            sunPosition: { value: new THREE.Vector3(0, 0, 0) },
            hasNightTexture: { value: 0.0 },
            uBrightness: { value: 1.5 }, 
            uAmbient: { value: 0.02 },   
            uSpecular: { value: 0.3 },   
            uSunWrap: { value: 0.0 },
            uSunIntensity: { value: 2.2 }
        };
        this.init();
    }

    init() {
        const geometry = new THREE.SphereGeometry(1, 128, 128);
        const name = (this.data.name || this.data.id || 'earth').toLowerCase();
        
        const texPath = `/assets/planety/solar/${name}/${name}_color.jpg`; 
        const dayTex = loadTex(texPath);
        dayTex.colorSpace = THREE.SRGBColorSpace;
        this.uniforms.dayTexture.value = dayTex;

        let hasNight = false;
        if (name === 'earth') {
            const nightTex = loadTex(`/assets/planety/images/earth_nightmap.jpg`);
            nightTex.colorSpace = THREE.SRGBColorSpace;
            this.uniforms.nightTexture.value = nightTex;
            const specTex = loadTex(`/assets/planety/images/earth_specularmap.jpg`);
            this.uniforms.specularTexture.value = specTex;
            const normTex = loadTex(`/assets/planety/solar/earth/earth_normal.jpg`);
            this.uniforms.normalTexture.value = normTex;
            hasNight = true;
        } else {
            const empty = new THREE.Texture();
            this.uniforms.specularTexture.value = empty;
            this.uniforms.normalTexture.value = empty;
        }
        
        this.uniforms.hasNightTexture.value = hasNight ? 1.0 : 0.0;

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: EARTH_VERTEX,
            fragmentShader: EARTH_FRAGMENT,
            extensions: { derivatives: true }
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.group.add(this.mesh);

        if (name === 'earth') {
            const cloudPath = `/assets/planety/solar/earth/earth_clouds.jpg`;
            const cloudGeo = new THREE.SphereGeometry(1.005, 128, 128); 
            const cloudMat = new THREE.MeshPhongMaterial({
                map: loadTex(cloudPath),
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending, 
                side: THREE.DoubleSide,
                shininess: 0
            });
            this.clouds = new THREE.Mesh(cloudGeo, cloudMat);
            this.group.add(this.clouds);
        }

        let atmColor = new THREE.Vector3(0.3, 0.6, 1.0); 
        let atmPower = 8.0;   
        let atmCoef = 0.470;  
        let atmSize = 1.10; 

        if (name === 'mercury') { atmColor.set(0.6, 0.6, 0.6); atmPower = 10.0; }
        if (name === 'venus')   { atmColor.set(0.9, 0.7, 0.2); atmPower = 6.0; }
        if (name === 'mars')    { atmColor.set(0.8, 0.4, 0.2); atmPower = 9.0; }
        if (name === 'jupiter') { atmColor.set(0.65, 0.6, 0.5); atmPower = 5.0; }
        if (name === 'saturn')  { atmColor.set(0.8, 0.7, 0.5);  atmPower = 5.0; }
        if (name === 'uranus')  { atmColor.set(0.4, 0.7, 0.8);  atmPower = 4.0; }
        if (name === 'neptune') { atmColor.set(0.2, 0.3, 0.9);  atmPower = 4.0; }

        const atmGeo = new THREE.SphereGeometry(atmSize, 64, 64);
        const atmMat = new THREE.ShaderMaterial({
            vertexShader: ATMOSPHERE_VERTEX,
            fragmentShader: ATMOSPHERE_FRAGMENT,
            uniforms: {
                coef: { value: atmCoef },  
                power: { value: atmPower }, 
                glowColor: { value: atmColor },
                uSunIntensity: { value: 2.2 },
                sunPosition: { value: new THREE.Vector3(0,0,0) }
            },
            transparent: true,
            side: THREE.BackSide, 
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        this.atmosphere = new THREE.Mesh(atmGeo, atmMat);
        this.group.add(this.atmosphere);
        
        if (PlanetRenderer.scene) PlanetRenderer.scene.add(this.group);
        if (name === 'earth') window.EARTH = this;
    }

    update(dt, cam) {
        if (!this.group || !cam) return;
        
        // --- FIX: Pozycja absolutna ---
        const x = this.data.x;
        const y = -this.data.y;
        this.group.position.set(x, y, 0);
        
        const currentRadius = (this.data.r || 100);
        const scale = currentRadius * PLANET_SIZE_MULTIPLIER;
        this.group.scale.set(scale, scale, scale);
        
        if (window.SUN) {
            this.uniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, 0); 
            if (this.atmosphere) {
                this.atmosphere.material.uniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, 0);
            }
        }

        if (PlanetRenderer.sunLight) {
            const currentIntensity = PlanetRenderer.sunLight.intensity;
            this.uniforms.uSunIntensity.value = currentIntensity;
            if (this.atmosphere) {
                this.atmosphere.material.uniforms.uSunIntensity.value = currentIntensity;
            }
        }

        if (this.mesh) this.mesh.rotation.y += 0.02 * dt;
        if (this.clouds) this.clouds.rotation.y += 0.027 * dt;
    }
}

class DirectSun {
    constructor(data) {
        this.data = data;
        this.group = new THREE.Group();
        this.init();
    }
    init() {
        const geometry = new THREE.SphereGeometry(1, 64, 64);
        const material = new THREE.MeshBasicMaterial({
            map: loadTex('/assets/planety/solar/sun/sun_color.jpg'),
            color: 0xffffff
        });
        this.mesh = new THREE.Mesh(geometry, material);
        
        const spriteMat = new THREE.SpriteMaterial({ 
            map: loadTex('/assets/effects/glow.png'),
            color: 0xffaa00, 
            transparent: true, 
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });
        this.glow = new THREE.Sprite(spriteMat);
        
        this.group.add(this.mesh);
        this.group.add(this.glow); 
        
        if (PlanetRenderer.scene) PlanetRenderer.scene.add(this.group);
    }
    update(dt, cam) {
        if(!cam) return;
        
        // --- FIX: Pozycja absolutna ---
        const x = this.data.x;
        const y = -this.data.y;
        
        this.group.position.set(x, y, -500);
        
        const rawRadius = this.data.r3D || this.data.r || 200;
        const scale = rawRadius * SUN_SIZE_MULTIPLIER;
        this.mesh.scale.set(scale, scale, scale);
        
        if (this.glow) {
            const glowScale = scale * 3.0;
            this.glow.scale.set(glowScale, glowScale, 1);
        }
        this.mesh.rotation.y += 0.005 * dt;
    }
}

// ==========================================
// 6. GLOBAL INTERFACE
// ==========================================

const _entities = [];
window.initPlanets3D = function(planetList, sunData) {
    _entities.length = 0;
    
    if (!PlanetRenderer.renderer) {
        PlanetRenderer.init();
    } else {
        const stars = StarSystem.mesh;
        const ambient = PlanetRenderer.ambientLight;
        const sun = PlanetRenderer.sunLight;
        
        const toRemove = PlanetRenderer.scene.children.filter(c => 
            c !== stars && c !== ambient && c !== sun
        );
        toRemove.forEach(c => PlanetRenderer.scene.remove(c));
    }
    
    if (sunData) _entities.push(new DirectSun(sunData));
    if (Array.isArray(planetList)) {
        planetList.forEach(pData => {
            _entities.push(new DirectPlanet(pData));
        });
    }
    window._entities = _entities;
};

window.updatePlanets3D = function(dt, cam) { 
    PlanetRenderer.render(cam);
};

window.drawPlanets3D = function(ctx, cam) { 
    PlanetRenderer.render(cam); 
};

window.worldToScreen = function(x, y, cam) {
    if(!cam) return {x:0, y:0};
    const z = cam.zoom;
    const w = window.innerWidth;
    const h = window.innerHeight;
    return { x: (x - cam.x) * z + w / 2, y: (y - cam.y) * z + h / 2 };
};