import * as THREE from 'three';
import { Core3D } from './src/3d/core3d.js';

window.Dev = window.Dev || {};
const PLANET_SIZE_MULTIPLIER = 4.5;
const SUN_SIZE_MULTIPLIER = 6.0;
const HALO_DEFAULTS = Object.freeze({
    sizeMul: 0.99,
    coefMul: 1.4,
    coefAdd: 0.0,
    powerMul: 1.0,
    powerAdd: 8.0,
    sunMul: 1.0
});
const SUN_SHADOW_TUNE = Object.freeze({
    color: 0xffeedd,
    intensity: 1.45,
    mapSize: 4096,
    near: 1,
    far: 320000,
    lightHeight: 120000,
    offsetMin: 70000,
    frustumMul: 1.45,
    frustumPad: 560,
    frustumMin: 2800,
    frustumMax: 22000,
    bias: -0.00025,
    normalBias: 0.02
});

// ==========================================
// 0. SHADERS: NEBULA (CLEAN / RAW)
// ==========================================

const NEBULA_VERTEX = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const NEBULA_FRAGMENT = `
    uniform sampler2D map;
    uniform float warpFactor;
    
    varying vec2 vUv;

    void main() {
        vec4 texColor = texture2D(map, vUv);
        vec3 color = texColor.rgb;
        float boost = 1.0 + warpFactor * 0.8;
        gl_FragColor = vec4(color * boost, 1.0);
    }
`;

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
        
        pos.x -= cameraOffset.x;
        pos.y -= cameraOffset.y;
        
        float halfSize = containerSize / 2.0;
        pos.x = mod(pos.x + halfSize, containerSize) - halfSize;
        pos.y = mod(pos.y + halfSize, containerSize) - halfSize;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        
        float stretch = 1.0 + (warpFactor * stretchStrength);
        vStretch = stretch; 
        
        float finalSize = size * baseSizeMul;
        float depth = 1000.0; 
        float distFactor = perspectiveScale / depth;
        float pointSize = (finalSize * stretch) * distFactor;
        
        if(warpFactor > 0.001) {
            float offsetWorld = (finalSize * (stretch - 1.0)) * 0.5;
            mvPosition.xy += moveDir * offsetWorld;
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
        vec3 finalColor = mix(vColor, vec3(0.7, 0.85, 1.0), vWarp * 0.8);
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
    float sunL = max(0.0, NdotL);
    float dayLight = clamp(uAmbient + sunL * uSunIntensity, 0.0, 1.2);

    vec4 dayColor = texture2D(dayTexture, vUv);
    vec4 nightColor = texture2D(nightTexture, vUv);
    float specularMask = texture2D(specularTexture, vUv).r;

    float specular = 0.0;
    if (sunL > 0.0) {
        float NdotH = max(0.0, dot(normal, halfVector));
        float shininess = 10.0; 
        specular = pow(NdotH, shininess) * specularMask * uSpecular * sunL;
    }

    float terminatorEdge = -0.08 - uSunWrap; 
    float mixFactor = smoothstep(terminatorEdge, 0.20, NdotL);
    vec3 finalColor;

    if (hasNightTexture > 0.5) {
        vec3 daySide = dayColor.rgb * uBrightness * dayLight;
        daySide += vec3(0.45, 0.52, 0.65) * specular; 
        float nightMask = 1.0 - mixFactor;
        vec3 nightSide = nightColor.rgb * 0.55 * nightMask;
        finalColor = mix(nightSide, daySide, mixFactor);
    } else {
        float twilight = smoothstep(-0.06 - uSunWrap * 0.5, 0.20, NdotL);
        float minNightLight = max(0.006, uAmbient * 0.35);
        float lit = mix(minNightLight, dayLight, twilight);
        float nightBand = 1.0 - smoothstep(-0.25, 0.02, NdotL);
        vec3 nightTint = vec3(0.02, 0.03, 0.05) * nightBand;
        finalColor = dayColor.rgb * uBrightness * lit + nightTint;
    }

    finalColor = clamp(finalColor, 0.0, 1.0);
    gl_FragColor = vec4(finalColor, 1.0);
}
`;

const CLOUD_VERTEX = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const CLOUD_FRAGMENT = `
uniform sampler2D cloudTexture;
uniform vec3 sunPosition;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
void main() {
    vec4 texel = texture2D(cloudTexture, vUv);
    float mask = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    if (mask < 0.03) discard;

    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(sunPosition - vWorldPosition);
    float lit = smoothstep(-0.02, 0.22, dot(normal, lightDir));
    float alpha = mask * uOpacity * pow(lit, 1.35);
    if (alpha < 0.01) discard;

    vec3 color = vec3(1.0) * (0.08 + 0.92 * lit);
    gl_FragColor = vec4(color, alpha);
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
    float dayFactor = smoothstep(-0.15, 0.25, sunDot);
    float intensity = rim * dayFactor;
    intensity = clamp(intensity, 0.0, 1.0); 
    gl_FragColor = vec4(glowColor, intensity * clamp(uSunIntensity, 0.2, 1.0));
}
`;

// ==========================================
// 2.5 NEBULA SYSTEM
// ==========================================

const NebulaSystem = {
    mesh: null,
    uniforms: null,
    parallaxFactor: 0.98, 
    baseScale: 70000,    
    aspectRatio: 1.6,

    init: function() {
        if (!Core3D.isInitialized) return;
        const loader = new THREE.TextureLoader();
        const tex = loader.load('/assets/nebula.png');
        
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;

        const width = this.baseScale;
        const height = width / this.aspectRatio; 
        const geo = new THREE.PlaneGeometry(width, height);

        this.uniforms = {
            map: { value: tex },
            warpFactor: { value: 0.0 }
        };

        const mat = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: NEBULA_VERTEX,
            fragmentShader: NEBULA_FRAGMENT,
            depthWrite: false,
            depthTest: false 
        });

        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.position.z = -150000; // Głęboko w tle
        this.mesh.renderOrder = -999;
        
        Core3D.scene.add(this.mesh);
    },

    update: function(dt, gameCamera) {
        if (!this.uniforms || !gameCamera || !this.mesh) return;
        
        const cx = typeof gameCamera.x === 'number' ? gameCamera.x : 0;
        const cy = typeof gameCamera.y === 'number' ? gameCamera.y : 0;
        
        const sunX = (window.SUN && window.SUN.x) || 0;
        const sunY = (window.SUN && window.SUN.y) || 0;

        const dx = cx - sunX;
        const dy = (-cy) - (-sunY);

        this.mesh.position.x = sunX + dx * this.parallaxFactor;
        this.mesh.position.y = (-sunY) + dy * this.parallaxFactor;

        if (window.warp) {
            let targetWarp = 0;
            const currentState = window.warp.state;
            if (currentState === 'active') {
                targetWarp = 1.0;
            } else if (currentState === 'charging' && window.warp.chargeTime > 0) {
                targetWarp = Math.min(1, window.warp.charge / window.warp.chargeTime) * 0.3;
            }
            const current = this.uniforms.warpFactor.value;
            this.uniforms.warpFactor.value += (targetWarp - current) * 3.0 * dt;
        }
    }
};

// ==========================================
// 3. SYSTEM GWIAZD
// ==========================================

const StarSystem = {
    mesh: null,
    uniforms: null,
    count: 40000,        
    worldScale: 100000, 
    lastWarpState: 'idle',
    exitTimer: 0,

    init: function() {
        if (!Core3D.isInitialized) return;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(this.count * 3);
        const sizes = new Float32Array(this.count);
        const brights = new Float32Array(this.count);
        const colors = new Float32Array(this.count * 3);
        const tempColor = new THREE.Color();

        for(let i=0; i < this.count; i++) {
            positions[i*3] = (Math.random() - 0.5) * this.worldScale;
            positions[i*3+1] = (Math.random() - 0.5) * this.worldScale;
            positions[i*3+2] = -100000; 

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
        Core3D.scene.add(this.mesh);
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

        if (this.mesh) {
            this.mesh.position.set(cx, -cy, -100000); 
        }

        const starSpeed = 0.9;
        const wrapSize = this.worldScale || 100000;
        const offsetXRaw = cx * starSpeed;
        const offsetYRaw = -cy * starSpeed;
        const offsetX = ((offsetXRaw % wrapSize) + wrapSize) % wrapSize;
        const offsetY = ((offsetYRaw % wrapSize) + wrapSize) % wrapSize;
        this.uniforms.cameraOffset.value.set(offsetX, offsetY);

        let dx = 0, dy = 1;
        const interpShipPose = (typeof window !== 'undefined') ? window.__interpShipPose : null;
        if (ship && ship.vel) {
             const speed = Math.hypot(ship.vel.x, ship.vel.y);
             if (speed > 10) {
                 dx = ship.vel.x / speed;
                 dy = ship.vel.y / speed;
             } else if (interpShipPose && Number.isFinite(interpShipPose.angle)) {
                 dx = Math.sin(interpShipPose.angle);
                 dy = -Math.cos(interpShipPose.angle);
             } else if (typeof ship.angle === 'number') {
                 dx = Math.sin(ship.angle);
                 dy = -Math.cos(ship.angle);
             }
        }
        
        let targetWarp = 0.0;
        if (window.warp) {
            const currentState = window.warp.state;
            if (this.lastWarpState === 'active' && currentState !== 'active') {
                this.exitTimer = 0.8;
            }
            this.lastWarpState = currentState;

            if (currentState === 'active') {
                targetWarp = 1.0;
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

        this.uniforms.moveDir.value.set(dx, -dy); 
        const currentWarp = this.uniforms.warpFactor.value;
        const lerpSpeed = (this.exitTimer > 0) ? 8.0 : 4.0;
        this.uniforms.warpFactor.value += (targetWarp - currentWarp) * lerpSpeed * dt;
    }
};

// ==========================================
// 4. CLASSES: PLANET & SUN
// ==========================================

const textureLoader = new THREE.TextureLoader();
function loadTex(path) {
    const tex = textureLoader.load(path);
    if (Core3D.renderer) {
        tex.anisotropy = Core3D.renderer.capabilities.getMaxAnisotropy();
    }
    return tex;
}

class DirectPlanet {
    constructor(data) {
        this.data = data;
        this.mesh = null;
        this.clouds = null;
        this.cloudUniforms = null;
        this.atmosphere = null;
        this.group = new THREE.Group();
        // Planety lądują pod statkiem, ale nad gwiazdami
        this.group.position.z = -50000;
        
        this.uniforms = {
            dayTexture: { value: null },
            nightTexture: { value: null },
            specularTexture: { value: null },
            normalTexture: { value: null },
            sunPosition: { value: new THREE.Vector3(0, 0, 0) },
            hasNightTexture: { value: 0.0 },
            uBrightness: { value: 1.0 }, 
            uAmbient: { value: 0.008 },   
            uSpecular: { value: 0.22 },   
            uSunWrap: { value: 0.0 },
            uSunIntensity: { value: 1.12 }
        };
        this.init();
    }

    init() {
        if (!Core3D.isInitialized) return;
        const geometry = new THREE.SphereGeometry(1, 128, 128);
        const name = (this.data.name || this.data.id || 'earth').toLowerCase();

        if (name !== 'earth') {
            this.uniforms.uAmbient.value = 0.004;
            this.uniforms.uSpecular.value = 0.0;
            this.uniforms.uSunWrap.value = -0.01;
            this.uniforms.uSunIntensity.value = 1.1;
            this.uniforms.uBrightness.value = 1.0;
        }
        if (name === 'jupiter') {
            this.uniforms.uAmbient.value = 0.0025;
            this.uniforms.uSunIntensity.value = 0.92;
            this.uniforms.uBrightness.value = 0.92;
        } else if (name === 'saturn') {
            this.uniforms.uAmbient.value = 0.003;
            this.uniforms.uSunIntensity.value = 0.95;
            this.uniforms.uBrightness.value = 0.94;
        } else if (name === 'neptune' || name === 'uranus') {
            this.uniforms.uAmbient.value = 0.003;
            this.uniforms.uSunIntensity.value = 1.0;
            this.uniforms.uBrightness.value = 0.96;
        } else if (name === 'mars' || name === 'mercury') {
            this.uniforms.uAmbient.value = 0.0035;
            this.uniforms.uSunIntensity.value = 1.04;
            this.uniforms.uBrightness.value = 0.95;
        } else if (name === 'venus') {
            this.uniforms.uAmbient.value = 0.003;
            this.uniforms.uSunIntensity.value = 0.98;
            this.uniforms.uBrightness.value = 0.93;
        }
        
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
            const cloudTex = loadTex(cloudPath);
            cloudTex.colorSpace = THREE.SRGBColorSpace;
            this.cloudUniforms = {
                cloudTexture: { value: cloudTex },
                sunPosition: { value: new THREE.Vector3(0, 0, 0) },
                uOpacity: { value: 0.62 }
            };
            const cloudMat = new THREE.ShaderMaterial({
                uniforms: this.cloudUniforms,
                vertexShader: CLOUD_VERTEX,
                fragmentShader: CLOUD_FRAGMENT,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.NormalBlending
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

        atmSize *= HALO_DEFAULTS.sizeMul;
        atmCoef = atmCoef * HALO_DEFAULTS.coefMul + HALO_DEFAULTS.coefAdd;
        atmPower = atmPower * HALO_DEFAULTS.powerMul + HALO_DEFAULTS.powerAdd;
        const atmSunIntensity = 1.1 * HALO_DEFAULTS.sunMul;

        const atmGeo = new THREE.SphereGeometry(atmSize, 64, 64);
        const atmMat = new THREE.ShaderMaterial({
            vertexShader: ATMOSPHERE_VERTEX,
            fragmentShader: ATMOSPHERE_FRAGMENT,
            uniforms: {
                coef: { value: atmCoef },  
                power: { value: atmPower }, 
                glowColor: { value: atmColor },
                uSunIntensity: { value: atmSunIntensity },
                sunPosition: { value: new THREE.Vector3(0,0,0) }
            },
            transparent: true,
            side: THREE.BackSide, 
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        this.atmosphere = new THREE.Mesh(atmGeo, atmMat);
        this.group.add(this.atmosphere);
        
        Core3D.scene.add(this.group);
        if (name === 'earth') window.EARTH = this;
    }

    update(dt, cam) {
        if (!this.group || !cam) return;
        
        const x = this.data.x;
        const y = -this.data.y; // Odwrócenie Y dla WebGL
        this.group.position.set(x, y, -50000);
        
        const currentRadius = (this.data.r || 100);
        const scale = currentRadius * PLANET_SIZE_MULTIPLIER;
        this.group.scale.set(scale, scale, scale);
        
        if (window.SUN) {
            this.uniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, 0); 
            if (this.cloudUniforms) {
                this.cloudUniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, 0);
            }
            if (this.atmosphere) {
                this.atmosphere.material.uniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, 0);
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
        this.group.position.z = -60000;
        this.init();
    }
    init() {
        if (!Core3D.isInitialized) return;
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
        
        Core3D.scene.add(this.group);
        
        // Słońce potrzebuje oświetlać inne planety - wpinamy światło do Core3D
        this.sunLight = new THREE.DirectionalLight(SUN_SHADOW_TUNE.color, SUN_SHADOW_TUNE.intensity);
        this.sunLight.castShadow = false;

        this.sunTarget = new THREE.Object3D();
        Core3D.scene.add(this.sunTarget);
        this.sunLight.target = this.sunTarget;

        Core3D.scene.add(this.sunLight);
        Core3D.scene.add(new THREE.AmbientLight(0xffffff, 0.02));
    }

    syncShadowRig(cam, sunX, sunY) {
        if (!this.sunLight || !this.sunTarget || !cam) return;

        const zoom = Math.max(0.0001, Number(cam.zoom) || 1);
        const viewportW = Math.max(1, Number(Core3D.width) || window.innerWidth || 1);
        const viewportH = Math.max(1, Number(Core3D.height) || window.innerHeight || 1);
        const halfW = (viewportW * 0.5) / zoom;
        const halfH = (viewportH * 0.5) / zoom;

        let halfSpan = Math.max(halfW, halfH) * SUN_SHADOW_TUNE.frustumMul + SUN_SHADOW_TUNE.frustumPad;
        halfSpan = Math.max(SUN_SHADOW_TUNE.frustumMin, Math.min(SUN_SHADOW_TUNE.frustumMax, halfSpan));
        halfSpan = Math.round(halfSpan / 8) * 8;

        const mapSize = Math.max(256, this.sunLight.shadow.mapSize.width || SUN_SHADOW_TUNE.mapSize);
        const texelSize = (halfSpan * 2) / mapSize;
        const targetXRaw = Number(cam.x) || sunX;
        const targetYRaw = Number.isFinite(cam.y) ? -cam.y : sunY;
        const targetX = texelSize > 0 ? Math.round(targetXRaw / texelSize) * texelSize : targetXRaw;
        const targetY = texelSize > 0 ? Math.round(targetYRaw / texelSize) * texelSize : targetYRaw;

        const dirX = sunX - targetX;
        const dirY = sunY - targetY;
        const dirLen = Math.hypot(dirX, dirY) || 1;
        const nx = dirX / dirLen;
        const ny = dirY / dirLen;
        const offset = Math.max(SUN_SHADOW_TUNE.offsetMin, halfSpan * 0.58);

        this.sunLight.position.set(
            targetX + nx * offset,
            targetY + ny * offset,
            SUN_SHADOW_TUNE.lightHeight
        );
        this.sunTarget.position.set(targetX, targetY, -50000);
        this.sunTarget.updateMatrixWorld();

        const shadowCam = this.sunLight.shadow.camera;
        shadowCam.left = -halfSpan;
        shadowCam.right = halfSpan;
        shadowCam.top = halfSpan;
        shadowCam.bottom = -halfSpan;
        shadowCam.updateProjectionMatrix();

        this.sunLight.shadow.needsUpdate = true;
        if (Core3D.renderer) {
            Core3D.renderer.shadowMap.needsUpdate = true;
        }
    }

    update(dt, cam) {
        if(!cam) return;
        
        const x = this.data.x;
        const y = -this.data.y;
        
        this.group.position.set(x, y, -60000);
        if (this.sunLight) {
            const targetX = (typeof cam.x === 'number') ? cam.x : x;
            const targetY = (typeof cam.y === 'number') ? -cam.y : y;
            const dirX = x - targetX;
            const dirY = y - targetY;
            const len = Math.hypot(dirX, dirY) || 1;
            const normX = dirX / len;
            const normY = dirY / len;
            const offset = 2600;

            this.sunLight.position.set(
                targetX + normX * offset,
                targetY + normY * offset,
                3000
            );

            if (this.sunTarget) {
                this.sunTarget.position.set(targetX, targetY, 0);
                this.sunTarget.updateMatrixWorld();
            }
        }
        
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
// 5. GLOBAL INTERFACE DLA GRY
// ==========================================

const _entities = [];

window.initPlanets3D = function(planetList, sunData) {
    if (!Core3D.isInitialized) {
        Core3D.init();
    }

    _entities.length = 0;
    
    NebulaSystem.init();
    StarSystem.init();

    if (sunData) _entities.push(new DirectSun(sunData));
    if (Array.isArray(planetList)) {
        planetList.forEach(pData => {
            _entities.push(new DirectPlanet(pData));
        });
    }
    window._entities = _entities;
    return Core3D.scene;
};

// Aktualizacja w pętli fizyki
window.updatePlanets3D = function(dt, cam) { 
    if (!Core3D.isInitialized || !cam) return;
    
    NebulaSystem.update(dt, cam);
    StarSystem.update(dt, cam, window.ship);
    
    if (window._entities) {
        window._entities.forEach(ent => {
            if (ent.update) ent.update(dt, cam);
        });
    }
};

// UWAGA: Ta funkcja jest teraz opcjonalna, bo Core3D renderuje cały ekran naraz 
// w hexShips3D. Zostawiamy ją jako pustą fasadę, żeby index.html się nie zepsuł.
window.drawPlanets3D = function(ctx, cam) { 
    // Nic nie robi - renderowaniem zajmuje się teraz Core3D.render() 
};

window.worldToScreen = function(x, y, cam) {
    if(!cam) return {x:0, y:0};
    const z = cam.zoom;
    const w = window.innerWidth;
    const h = window.innerHeight;
    return { x: (x - cam.x) * z + w / 2, y: (y - cam.y) * z + h / 2 };
};
