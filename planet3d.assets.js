window.Dev = window.Dev || {};
const PLANET_SIZE_MULTIPLIER = 4.5;
const SUN_SIZE_MULTIPLIER = 6.0;

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
        this.renderer.toneMappingExposure = 1.2;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();

        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10000);
        this.camera.position.z = 1000;
        this.camera.lookAt(0, 0, 0);

        const ambient = new THREE.AmbientLight(0x333333);
        this.scene.add(ambient);

        this.sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 2048;
        this.sunLight.shadow.mapSize.height = 2048;
        this.sunLight.shadow.camera.near = 0.5;
        this.sunLight.shadow.camera.far = 5000;
        const d = 4000;
        this.sunLight.shadow.camera.left = -d;
        this.sunLight.shadow.camera.right = d;
        this.sunLight.shadow.camera.top = d;
        this.sunLight.shadow.camera.bottom = -d;
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
        this.camera.position.y = gameCamera.y;

        if (window.SUN) {
            const sunX = window.SUN.x;
            const sunY = window.SUN.y;
            this.sunLight.position.set(sunX, sunY, 1000);
            this.sunLight.target.position.set(sunX, sunY, 0);
            this.sunLight.target.updateMatrixWorld();
        }

        this.renderer.render(this.scene, this.camera);
    }
};

const textureLoader = new THREE.TextureLoader();
function loadTex(path) {
    return textureLoader.load(path);
}

class DirectPlanet {
    constructor(data) {
        this.data = data;
        this.mesh = null;
        this.group = new THREE.Group();
        this.init();
    }

    init() {
        const radius = (this.data.r || 100) * PLANET_SIZE_MULTIPLIER;
        const geometry = new THREE.SphereGeometry(radius, 128, 128);
        
        const name = (this.data.name || this.data.id || 'earth').toLowerCase();
        const texPath = `/assets/planety/solar/${name}/${name}_color.jpg`; 
        
        const material = new THREE.MeshStandardMaterial({
            map: loadTex(texPath),
            roughness: 0.8,
            metalness: 0.1
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.rotation.x = Math.PI / 2; 
        
        this.group.add(this.mesh);
        
        if (PlanetRenderer.scene) {
            PlanetRenderer.scene.add(this.group);
        }
    }

    update(dt) {
        if (!this.group) return;
        this.group.position.set(this.data.x, this.data.y, 0);
        
        if (this.mesh) {
            this.mesh.rotation.y += 0.05 * dt;
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
        const rawRadius = this.data.r3D || this.data.r || 200;
        const radius = rawRadius * SUN_SIZE_MULTIPLIER;
        
        const geometry = new THREE.SphereGeometry(radius, 64, 64);
        const material = new THREE.MeshBasicMaterial({
            map: loadTex('/assets/planety/solar/sun/sun_color.jpg'),
            color: 0xffffff
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.rotation.x = Math.PI / 2;
        
        const spriteMat = new THREE.SpriteMaterial({ 
            map: loadTex('/assets/effects/glow.png'),
            color: 0xffaa00, 
            transparent: true, 
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });
        const glow = new THREE.Sprite(spriteMat);
        glow.scale.set(radius * 3, radius * 3, 1);
        
        this.group.add(this.mesh);
        // this.group.add(glow);

        if (PlanetRenderer.scene) PlanetRenderer.scene.add(this.group);
    }

    update(dt) {
        this.group.position.set(this.data.x, this.data.y, -50);
        this.mesh.rotation.y += 0.02 * dt;
    }
}

const _entities = [];

window.initPlanets3D = function(planetList, sunData) {
    PlanetRenderer.init();

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