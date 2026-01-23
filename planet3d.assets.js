window.Dev = window.Dev || {};
const PLANET_SIZE_MULTIPLIER = 4.5;
const SUN_SIZE_MULTIPLIER = 6.0;

// --- SHADERS (GLSL) ---

const VERTEX_SHADER = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;

void main() {
    vUv = uv;
    // Normalna w przestrzeni świata (do obliczeń światła)
    vNormal = normalize(modelMatrix * vec4(normal, 0.0)).xyz;
    // Pozycja w przestrzeni świata
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const FRAGMENT_SHADER = `
uniform sampler2D dayTexture;
uniform sampler2D nightTexture;
uniform vec3 sunPosition;
uniform float hasNightTexture; 

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;

void main() {
    // 1. Oblicz wektor światła (od powierzchni do słońca)
    vec3 lightDir = normalize(sunPosition - vWorldPosition);
    
    // 2. Oblicz natężenie światła (Dot Product: 1 = słońce w zenicie, 0 = horyzont, <0 = noc)
    float intensity = dot(vNormal, lightDir);
    
    // 3. Pobierz kolory z tekstur
    vec4 dayColor = texture2D(dayTexture, vUv);
    vec4 nightColor = texture2D(nightTexture, vUv);
    
    // 4. Mieszanie Dzień/Noc (Smoothstep dla miękkiego przejścia/terminatora)
    // Przejście od -0.2 (pełna noc) do 0.2 (pełny dzień)
    float mixFactor = smoothstep(-0.2, 0.2, intensity);
    
    // 5. Logika koloru finalnego
    vec3 finalColor;
    
    if (hasNightTexture > 0.5) {
        // Dla Ziemi: Mieszamy Dzień (oświetlony) z Nocą (miasta świecące w ciemności)
        // Miasta są jasne (nightColor), ale tylko tam gdzie jest ciemno (1.0 - mixFactor)
        // Dodatkowo w nocy nie chcemy, żeby oceany świeciły, tekstura nightmapy to załatwia (jest czarna na oceanach)
        
        // Kolor dzienny + Ambient (0.05)
        vec3 daySide = dayColor.rgb * (mixFactor + 0.05);
        
        // Kolor nocny (tylko tam gdzie cień)
        // Im mniej słońca (mixFactor mały), tym więcej świateł miast
        vec3 nightSide = nightColor.rgb * (1.0 - mixFactor) * 1.5; // *1.5 dla jasności miast
        
        finalColor = daySide + nightSide;
    } else {
        // Dla innych planet: Po prostu cień
        // Ambient 0.02 (bardzo ciemna noc) + Diffuse
        float light = clamp(intensity, 0.0, 1.0);
        finalColor = dayColor.rgb * (light + 0.02);
    }

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// --- RENDERER SYSTEM ---

const PlanetRenderer = {
    renderer: null,
    scene: null,
    camera: null,
    sunLight: null,
    width: 0,
    height: 0,
    
    init: function() {
        const canvas = document.getElementById('webgl-layer');
        if (!canvas || !window.THREE) return;

        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            alpha: true,
            antialias: true,
            powerPreference: "high-performance"
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.shadowMap.enabled = false; // Shadery obsługują to same

        this.scene = new THREE.Scene();

        // Kamera
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300000);
        this.camera.position.z = 150000;
        this.camera.lookAt(0, 0, 0);

        // Ambient dla pewności (choć shader używa własnego)
        const ambient = new THREE.AmbientLight(0x111111);
        this.scene.add(ambient);

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

        this.renderer.render(this.scene, this.camera);
    }
};

const textureLoader = new THREE.TextureLoader();
function loadTex(path) {
    const tex = textureLoader.load(path);
    // Ustawienie maksymalnej ostrości pod kątem (dla Twojego RTX to 16x)
    if (PlanetRenderer.renderer) {
        tex.anisotropy = PlanetRenderer.renderer.capabilities.getMaxAnisotropy();
    }
    return tex;
}

// --- KLASY OBIEKTÓW ---

class DirectPlanet {
    constructor(data) {
        this.data = data;
        this.mesh = null;
        this.clouds = null;
        this.group = new THREE.Group();
        // Uniformy przechowujemy w referencji, by łatwo je aktualizować
        this.uniforms = {
            dayTexture: { value: null },
            nightTexture: { value: null },
            sunPosition: { value: new THREE.Vector3(0, 0, 0) },
            hasNightTexture: { value: 0.0 }
        };
        this.init();
    }

    init() {
        const geometry = new THREE.SphereGeometry(1, 128, 128);
        const name = (this.data.name || this.data.id || 'earth').toLowerCase();
        
        // 1. Tekstura Dnia
        const texPath = `/assets/planety/solar/${name}/${name}_color.jpg`; 
        const dayTex = loadTex(texPath);
        dayTex.colorSpace = THREE.SRGBColorSpace;
        this.uniforms.dayTexture.value = dayTex;

        // 2. Tekstura Nocy (tylko dla Ziemi)
        let hasNight = false;
        if (name === 'earth') {
            // Zakładam, że masz tę teksturę. Jeśli nie, Ziemia w nocy będzie czarna.
            // Standardowa nazwa w paczkach solarnych to często earth_nightmap.jpg lub podobne.
            const nightPath = `/assets/planety/images/earth_nightmap.jpg`; 
            const nightTex = loadTex(nightPath);
            nightTex.colorSpace = THREE.SRGBColorSpace;
            this.uniforms.nightTexture.value = nightTex;
            hasNight = true;
        }
        this.uniforms.hasNightTexture.value = hasNight ? 1.0 : 0.0;

        // 3. Materiał Shaderowy
        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.rotation.x = 0; // Oś obrotu pionowa
        this.group.add(this.mesh);

        // 4. Chmury (Ziemia/Wenus)
        if (name === 'earth' || name === 'venus') {
            const cloudPath = (name === 'venus') 
                ? `/assets/planety/images/venus_atmosphere.jpg`
                : `/assets/planety/solar/earth/earth_clouds.jpg`;

            const cloudGeo = new THREE.SphereGeometry(1.01, 128, 128);
            const cloudMat = new THREE.MeshLambertMaterial({
                map: loadTex(cloudPath),
                transparent: true,
                opacity: (name === 'venus' ? 0.9 : 0.4), // Wenus gęstsza, Ziemia lżejsza
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide
            });
            
            this.clouds = new THREE.Mesh(cloudGeo, cloudMat);
            this.clouds.rotation.x = 0;
            this.group.add(this.clouds);
        }
        
        if (PlanetRenderer.scene) {
            PlanetRenderer.scene.add(this.group);
        }
        
        if (name === 'earth') window.EARTH = this;
    }

    update(dt) {
        if (!this.group) return;
        
        // Pozycja (Y odwrócony)
        this.group.position.set(this.data.x, -this.data.y, 0);
        
        // Skala
        const currentRadius = (this.data.r || 100);
        const scale = currentRadius * PLANET_SIZE_MULTIPLIER;
        this.group.scale.set(scale, scale, scale);

        // Aktualizacja pozycji słońca dla Shadera
        if (window.SUN) {
            // Słońce też ma odwrócone Y w tym systemie renderowania
            this.uniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, 0); 
            // Z=0 bo w 2D słońce jest na tej samej płaszczyźnie, 
            // shader policzy wektor w przestrzeni 3D poprawnie.
        }

        // Rotacja planety (dzień/noc się przesuwa, bo planeta się kręci, a słońce stoi)
        if (this.mesh) {
            this.mesh.rotation.y += 0.02 * dt;
        }
        if (this.clouds) {
            this.clouds.rotation.y += 0.025 * dt;
        }
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
        this.mesh.rotation.x = 0;
        
        // Glow sprite
        const spriteMat = new THREE.SpriteMaterial({ 
            map: loadTex('/assets/effects/glow.png'),
            color: 0xffaa00, 
            transparent: true, 
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });
        this.glow = new THREE.Sprite(spriteMat);
        
        this.group.add(this.mesh);
        // this.group.add(this.glow); // Odkomentuj jeśli masz asset glow

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
        // Przy custom shaderze światła sceny są mniej ważne dla planet, 
        // ale mogą się przydać dla innych obiektów (np. stacji).
        const ambient = new THREE.AmbientLight(0x333333);
        PlanetRenderer.scene.add(ambient);
    }

    if (sunData) {
        _entities.push(new DirectSun(sunData));
    }

    if (Array.isArray(planetList)) {
        planetList.forEach(pData => {
            _entities.push(new DirectPlanet(pData));
        });
    }
};

window.updatePlanets3D = function(dt) {
    _entities.forEach(e => e.update(dt));
};

window.drawPlanets3D = function(ctx, cam) {
    PlanetRenderer.render(cam);
};

window.worldToScreen = function(x, y, cam) {
    const z = cam.zoom;
    const w = window.innerWidth;
    const h = window.innerHeight;
    return {
        x: (x - cam.x) * z + w / 2,
        y: (y - cam.y) * z + h / 2
    };
};