window.Dev = window.Dev || {};
const PLANET_SIZE_MULTIPLIER = 4.5;
const SUN_SIZE_MULTIPLIER = 6.0;

// --- SHADERS ---

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

// Parametry
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

    // Normal Mapping
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

// --- ATMOSPHERE SHADERS (Z REAKCJĄ NA DZIEŃ/NOC) ---

const ATMOSPHERE_VERTEX = `
varying vec3 vNormal;
varying vec3 vWorldPosition; // Potrzebne do obliczenia gdzie jest słońce

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
uniform vec3 sunPosition; // Pozycja słońca
uniform float coef;
uniform float power;
uniform float uSunIntensity;

void main() {
    // 1. Halo (Krawędź)
    // Używamy prostego wektora kamery (0,0,1) dla OrthographicCamera
    float rim = pow(coef - dot(vNormal, vec3(0.0, 0.0, 1.0)), power);
    
    // 2. Maska Dnia (Gdzie pada światło?)
    vec3 lightDir = normalize(sunPosition - vWorldPosition);
    float sunDot = dot(vNormal, lightDir);
    
    // Smoothstep sprawia, że halo znika płynnie w cieniu.
    // +0.1 daje minimalną poświatę w nocy (żeby nie znikało totalnie)
    float dayFactor = smoothstep(-0.2, 0.2, sunDot) + 0.1;
    
    // 3. Łączymy: Halo * Dzień
    float intensity = rim * dayFactor;
    intensity = clamp(intensity, 0.0, 1.0); 
    
    gl_FragColor = vec4(glowColor, intensity * clamp(uSunIntensity, 0.5, 1.5));
}
`;

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
        if (!this.renderer) return;
        const zoom = gameCamera.zoom;
        const w = this.width / zoom;
        const h = this.height / zoom;
        this.camera.left = -w / 2;
        this.camera.right = w / 2;
        this.camera.top = h / 2;
        this.camera.bottom = -h / 2;
        this.camera.updateProjectionMatrix();
        this.camera.position.x = gameCamera.x;
        this.camera.position.y = -gameCamera.y;
        
        if (window.SUN) {
            const sunX = window.SUN.x;
            const sunY = -window.SUN.y;
            this.sunLight.position.set(sunX, sunY, 100000);
            this.sunLight.target.position.set(sunX, sunY, 0); 
            this.sunLight.target.updateMatrixWorld();
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

        // --- CHMURY (TYLKO ZIEMIA) ---
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

        // --- ATMOSFERA (DLA WSZYSTKICH) ---
        let atmColor = new THREE.Vector3(0.3, 0.6, 1.0); 
        let atmPower = 8.0;   
        let atmCoef = 0.470;  
        let atmSize = 1.10; // SZTYWNE 1.10

        // Kolory
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
                sunPosition: { value: new THREE.Vector3(0,0,0) } // Placeholder
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

    update(dt) {
        if (!this.group) return;
        this.group.position.set(this.data.x, -this.data.y, 0);
        const currentRadius = (this.data.r || 100);
        const scale = currentRadius * PLANET_SIZE_MULTIPLIER;
        this.group.scale.set(scale, scale, scale);
        
        if (window.SUN) {
            // Aktualizujemy słońce dla planety
            this.uniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, 0); 
            
            // AKTUALIZUJEMY SŁOŃCE DLA ATMOSFERY (ŻEBY WIEDZIAŁA GDZIE JEST NOC)
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
        if (PlanetRenderer.scene) PlanetRenderer.scene.add(this.group);
    }
    update(dt) {
        this.group.position.set(this.data.x, -this.data.y, -500);
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

const _entities = [];
window.initPlanets3D = function(planetList, sunData) {
    _entities.length = 0;
    if (!PlanetRenderer.renderer) {
        PlanetRenderer.init();
    } else {
        while(PlanetRenderer.scene.children.length > 0){ 
            PlanetRenderer.scene.remove(PlanetRenderer.scene.children[0]); 
        }
        PlanetRenderer.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        PlanetRenderer.scene.add(PlanetRenderer.ambientLight);
        PlanetRenderer.scene.add(PlanetRenderer.sunLight);
    }
    if (sunData) _entities.push(new DirectSun(sunData));
    if (Array.isArray(planetList)) {
        planetList.forEach(pData => {
            _entities.push(new DirectPlanet(pData));
        });
    }
    window._entities = _entities;
};
window.updatePlanets3D = function(dt) { _entities.forEach(e => e.update(dt)); };
window.drawPlanets3D = function(ctx, cam) { PlanetRenderer.render(cam); };
window.worldToScreen = function(x, y, cam) {
    const z = cam.zoom;
    const w = window.innerWidth;
    const h = window.innerHeight;
    return { x: (x - cam.x) * z + w / 2, y: (y - cam.y) * z + h / 2 };
};