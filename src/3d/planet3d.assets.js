import * as THREE from 'three';
import { Core3D } from './core3d.js';

window.Dev = window.Dev || {};
const PLANET_SIZE_MULTIPLIER = 4.5;
const SUN_SIZE_MULTIPLIER = 6.0;
const HALO_DEFAULTS = Object.freeze({ sizeMul: 1.1, coefMul: 1.414, coefAdd: 1.78, powerMul: 0.93, powerAdd: 7.44, sunMul: 1.0 });
const SUN_SHADOW_TUNE = Object.freeze({ color: 0xffeedd, intensity: 1.45, mapSize: 4096, near: 1, far: 10000, lightHeight: 120000, offsetMin: 70000, frustumMul: 1.45, frustumPad: 560, frustumMin: 2800, frustumMax: 22000, bias: -0.0003, normalBias: 0.08 });
const MOON_TUNE = Object.freeze({
    orbitRadiusMul: 3.0,
    orbitRadiusMin: 30000,
    orbitPeriodSec: 220,
    sizeRatioToParent: 0.24,
    z: -50020,
    colorTex: '/assets/planety/images/moonmap.jpg',
    bumpTex: '/assets/planety/images/moonbump.jpg',
    bumpScale: 0.07
});
const JUPITER_MOONS_TUNE = Object.freeze([
    Object.freeze({ id: 'io', orbitRadius: 20000, orbitPeriodSec: 82, sizeRatioToParent: 0.072, phase: 0.0, colorTex: '/assets/planety/images/jupiterIo.jpg' }),
    Object.freeze({ id: 'europa', orbitRadius: 28000, orbitPeriodSec: 110, sizeRatioToParent: 0.061, phase: 1.4, colorTex: '/assets/planety/images/jupiterEuropa.jpg' }),
    Object.freeze({ id: 'ganymede', orbitRadius: 37000, orbitPeriodSec: 150, sizeRatioToParent: 0.086, phase: 2.2, colorTex: '/assets/planety/images/jupiterGanymede.jpg' }),
    Object.freeze({ id: 'callisto', orbitRadius: 48000, orbitPeriodSec: 195, sizeRatioToParent: 0.080, phase: 3.1, colorTex: '/assets/planety/images/jupiterCallisto.jpg' })
]);
const SATURN_VISUAL_RING = Object.freeze({
    innerRadius: 1.22,
    outerRadius: 1.77,
    thickness: 0.01,
    tiltDeg: -60,
    opacity: 1.0,
    wallOpacity: 0.46,
    faceEmissiveIntensity: 0.45,
    wallEmissiveIntensity: 0.24,
    uvRepeatX: 1.0,
    uvOffsetX: 0.0,
    uvRotate: 0.0,
    texture: '/assets/planety/solar/saturn/rings_alpha.png'
});
const STAR_PLANET_MASK_CAP = 12;

const NEBULA_VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const NEBULA_FRAGMENT = `uniform sampler2D map; uniform float warpFactor; varying vec2 vUv; void main() { vec4 texColor = texture2D(map, vUv); vec3 color = texColor.rgb; float boost = 1.0 + warpFactor * 0.8; gl_FragColor = vec4(color * boost, 1.0); }`;
const STARS_VERTEX = `uniform vec2 cameraOffset; uniform float containerSize; uniform float perspectiveScale; uniform float warpFactor; uniform float stretchStrength; uniform float baseSizeMul; uniform vec2 moveDir; uniform vec4 planetMasks[${STAR_PLANET_MASK_CAP}]; attribute float size; attribute float brightness; attribute vec3 color; varying float vBrightness; varying float vWarp; varying vec3 vColor; varying float vStretch; varying float vScreenSize; varying float vPlanetMask; void main() { vBrightness = brightness; vWarp = warpFactor; vColor = color; vec3 pos = position; pos.x -= cameraOffset.x; pos.y -= cameraOffset.y; float halfSize = containerSize / 2.0; pos.x = mod(pos.x + halfSize, containerSize) - halfSize; pos.y = mod(pos.y + halfSize, containerSize) - halfSize; vec4 worldPos = modelMatrix * vec4(pos, 1.0); vPlanetMask = 1.0; for (int i = 0; i < ${STAR_PLANET_MASK_CAP}; i++) { vec4 pm = planetMasks[i]; if (pm.z <= 0.0) continue; float distToPlanet = distance(worldPos.xy, pm.xy); vPlanetMask *= step(pm.z, distToPlanet); } vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0); float stretch = 1.0 + (warpFactor * stretchStrength); vStretch = stretch; float finalSize = size * baseSizeMul; float depth = 1000.0; float distFactor = perspectiveScale / depth; float pointSize = (finalSize * stretch) * distFactor; if(warpFactor > 0.001) { float offsetWorld = (finalSize * (stretch - 1.0)) * 0.5; mvPosition.xy += moveDir * offsetWorld; } gl_PointSize = pointSize; gl_Position = projectionMatrix * mvPosition; vScreenSize = pointSize; }`;
const STARS_FRAGMENT = `uniform sampler2D pointTexture; uniform float time; uniform float globalBrightness; uniform vec2 moveDir; uniform float thinningStrength; varying float vBrightness; varying float vWarp; varying vec3 vColor; varying float vStretch; varying float vScreenSize; varying float vPlanetMask; void main() { vec2 rawUV = gl_PointCoord - 0.5; float distFromCenter = length(rawUV); float mask = 1.0 - smoothstep(0.4, 0.5, distFromCenter); if (mask < 0.01) discard; if (vPlanetMask < 0.5) discard; vec2 uv = rawUV; if (vWarp > 0.01) { float angle = atan(moveDir.y, moveDir.x); float c = cos(angle); float s = sin(angle); mat2 rot = mat2(c, s, -s, c); uv = rot * uv; uv.x *= (1.0 / vStretch); float maxSafeThin = max(1.0, vScreenSize * 0.4); float actualThin = min(thinningStrength, maxSafeThin); uv.y *= (1.0 + vWarp * actualThin); } vec2 texUV = uv + 0.5; if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) discard; vec4 tex = texture2D(pointTexture, texUV); if (tex.a < 0.05) discard; float twinkle = 0.8 + 0.2 * sin(time * 3.0 + vBrightness * 10.0); vec3 finalColor = mix(vColor, vec3(0.7, 0.85, 1.0), vWarp * 0.8); gl_FragColor = vec4(finalColor * twinkle, tex.a * vBrightness * globalBrightness * mask); }`;

function enablePlanetLayer(object3d) {
    if (!object3d) return;
    if (typeof Core3D.enablePlanet3D === 'function') Core3D.enablePlanet3D(object3d);
    else Core3D.enableBackground3D(object3d);
}

function enablePlanetHaloLayer(object3d) {
    if (!object3d) return;
    if (typeof Core3D.enablePlanetHalo3D === 'function') Core3D.enablePlanetHalo3D(object3d);
    else enablePlanetLayer(object3d);
}

function enablePlanetOcclusion(object3d) {
    if (!object3d) return;
    if (typeof Core3D.enablePlanetOccluder3D === 'function') Core3D.enablePlanetOccluder3D(object3d);
}

function remapRingPolarUV(geometry, innerRadius, outerRadius) {
    if (!geometry?.attributes?.position || !geometry?.attributes?.uv) return;
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const radialSpan = Math.max(0.0001, outerRadius - innerRadius);

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const radius = Math.sqrt(x * x + y * y);
        const angle = Math.atan2(y, x);

        // POPRAWKA: 'u' to promień (dystans od środka, lewo-prawo tekstury),
        // a 'v' to kąt wokół pierścienia (góra-dół tekstury)
        const u = THREE.MathUtils.clamp((radius - innerRadius) / radialSpan, 0.0, 1.0);
        const v = (angle + Math.PI) / (Math.PI * 2.0);

        uv.setXY(i, u, v);
    }

    uv.needsUpdate = true;
}

const SUN_VERTEX = `varying vec2 vUv; varying vec3 vNormal; varying vec3 vLocalPos; void main() { vUv = uv; vNormal = normalize(normalMatrix * normal); vLocalPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SUN_FRAGMENT = `
uniform float uTime;
uniform int uIsOcclusion; // <--- DODANA FLAGA DLA GOD RAYS

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vLocalPos;

vec3 hash(vec3 p) { p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return -1.0 + 2.0 * fract(sin(p) * 43758.5453123); }
float noise(vec3 p) { vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f); return mix(mix(mix(dot(hash(i + vec3(0.0,0.0,0.0)), f - vec3(0.0,0.0,0.0)), dot(hash(i + vec3(1.0,0.0,0.0)), f - vec3(1.0,0.0,0.0)), u.x), mix(dot(hash(i + vec3(0.0,1.0,0.0)), f - vec3(0.0,1.0,0.0)), dot(hash(i + vec3(1.0,1.0,0.0)), f - vec3(1.0,1.0,0.0)), u.x), u.y), mix(mix(dot(hash(i + vec3(0.0,0.0,1.0)), f - vec3(0.0,0.0,1.0)), dot(hash(i + vec3(1.0,0.0,1.0)), f - vec3(1.0,0.0,1.0)), u.x), mix(dot(hash(i + vec3(0.0,1.0,1.0)), f - vec3(0.0,1.0,1.0)), dot(hash(i + vec3(1.0,1.0,1.0)), f - vec3(1.0,1.0,1.0)), u.x), u.y), u.z); }
float fbm(vec3 p) { float f = 0.0; float amp = 0.5; for(int i = 0; i < 4; i++) { f += amp * noise(p); p *= 2.02; amp *= 0.5; } return f; }

void main() {
    // --- MAGIA MASKI OKLUZJI ---
    if (uIsOcclusion == 1) {
        gl_FragColor = vec4(1.0); // Słońce w masce okluzji jest PURE WHITE
        return;
    }

    vec3 p = normalize(vLocalPos) * 4.0;
    float t = uTime * 0.15;
    vec3 q = vec3(fbm(p + vec3(t)), fbm(p + vec3(-t, t, 0.0)), fbm(p + vec3(0.0, -t, t)));
    float n = fbm(p + q * 2.0 + t);
    n = clamp((n + 0.5) * 1.2, 0.0, 1.0);
    vec3 colorDark = vec3(0.4, 0.05, 0.0); vec3 colorMid = vec3(1.5, 0.5, 0.1); vec3 colorHot = vec3(4.0, 2.5, 0.5);
    vec3 finalColor = mix(colorDark, colorMid, smoothstep(0.0, 0.6, n));
    finalColor = mix(finalColor, colorHot, smoothstep(0.5, 1.0, n));
    float viewDot = dot(normalize(vNormal), vec3(0.0, 0.0, 1.0));
    float fresnel = pow(1.0 - max(viewDot, 0.0), 3.0);
    finalColor += vec3(1.5, 0.75, 0.25) * fresnel;
    gl_FragColor = vec4(finalColor, 1.0);
}
`;

const EARTH_VERTEX = `precision highp float; varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorldPosition; varying vec3 vViewPosition; void main() { vUv = uv; vNormal = normalize(normalMatrix * normal); vec4 worldPosition = modelMatrix * vec4(position, 1.0); vWorldPosition = worldPosition.xyz; vec4 mvPosition = viewMatrix * worldPosition; vViewPosition = -mvPosition.xyz; gl_Position = projectionMatrix * viewMatrix * worldPosition; }`;
const EARTH_FRAGMENT = `precision highp float; uniform float uPlanetBloom; uniform sampler2D dayTexture; uniform sampler2D nightTexture; uniform sampler2D specularTexture; uniform sampler2D normalTexture; uniform vec3 sunPosition; uniform vec3 sunsetTint; uniform float hasNightTexture; uniform float uBrightness; uniform float uAmbient; uniform float uSpecular; uniform float uSunWrap; uniform float uSunIntensity; varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorldPosition; varying vec3 vViewPosition; float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); } void main() { vec3 viewDir = normalize(vViewPosition); vec3 sunViewPosition = (viewMatrix * vec4(sunPosition, 1.0)).xyz; vec3 lightDir = normalize(sunViewPosition + vViewPosition); vec3 halfVector = normalize(lightDir + viewDir); vec3 normal = normalize(vNormal); if (hasNightTexture > 0.5) { vec3 mapN = texture2D(normalTexture, vUv).xyz * 2.0 - 1.0; mapN.xy *= 0.8; vec3 q0 = dFdx(-vViewPosition.xyz); vec3 q1 = dFdy(-vViewPosition.xyz); vec2 st0 = dFdx(vUv.st); vec2 st1 = dFdy(vUv.st); vec3 S = normalize(q0 * st1.t - q1 * st0.t); vec3 T = normalize(-q0 * st1.s + q1 * st0.s); vec3 N = normalize(vNormal); mat3 tsn = mat3(S, T, N); normal = normalize(tsn * mapN); } float NdotL = dot(normal, lightDir); float sunL = max(0.0, NdotL); float dayLight = clamp(uAmbient + sunL * uSunIntensity, 0.0, 1.2); vec4 dayColor = texture2D(dayTexture, vUv); vec4 nightColor = texture2D(nightTexture, vUv); float specularMask = texture2D(specularTexture, vUv).r; float specular = 0.0; if (sunL > 0.0) { float waterMask = smoothstep(0.08, 0.82, specularMask); float NdotH = max(0.0, dot(normal, halfVector)); float shininess = mix(16.0, 42.0, waterMask); specular = pow(NdotH, shininess) * waterMask * uSpecular * sunL; } float terminatorCenter = -0.02 - uSunWrap * 0.45; float terminatorSoft = 0.26 + abs(uSunWrap) * 0.35; float mixFactor = smoothstep(terminatorCenter - terminatorSoft, terminatorCenter + terminatorSoft, NdotL); vec3 finalColor; if (hasNightTexture > 0.5) { vec3 daySide = dayColor.rgb * uBrightness * dayLight; daySide += vec3(0.55, 0.62, 0.78) * specular; float nightMask = 1.0 - mixFactor; vec3 nightBase = nightColor.rgb; float cityBrightness = dot(nightBase, vec3(0.299, 0.587, 0.114)); vec3 cityGlow = nightBase * pow(cityBrightness, 2.0) * 5.0; vec3 nightSide = (nightBase * 0.55 + cityGlow) * nightMask; finalColor = mix(nightSide, daySide, mixFactor); } else { float twilight = smoothstep(terminatorCenter - (terminatorSoft + 0.06), terminatorCenter + terminatorSoft, NdotL); float minNightLight = max(0.006, uAmbient * 0.35); float lit = mix(minNightLight, dayLight, twilight); float nightBand = 1.0 - smoothstep(-0.35, 0.08, NdotL); vec3 nightTint = vec3(0.02, 0.03, 0.05) * nightBand; finalColor = dayColor.rgb * uBrightness * lit + nightTint; } float sunsetBand = smoothstep(-0.30, -0.02, NdotL) * (1.0 - smoothstep(-0.02, 0.20, NdotL)); finalColor = mix(finalColor, finalColor * sunsetTint, sunsetBand * 0.45); float dither = (hash12(gl_FragCoord.xy) - 0.5) / 1024.0; float ditherMask = mixFactor * (1.0 - mixFactor) * 4.0; finalColor += dither * ditherMask; finalColor = max(finalColor, vec3(0.0)); float luminance = dot(finalColor, vec3(0.299, 0.587, 0.114)); float bloomPush = smoothstep(0.85, 1.0, luminance) * uPlanetBloom; finalColor += finalColor * bloomPush; gl_FragColor = vec4(finalColor, 1.0); }`;
const CLOUD_VERTEX = `varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorldPosition; void main() { vUv = uv; vec4 worldPosition = modelMatrix * vec4(position, 1.0); vNormal = normalize(mat3(modelMatrix) * normal); vWorldPosition = worldPosition.xyz; gl_Position = projectionMatrix * viewMatrix * worldPosition; }`;
const CLOUD_FRAGMENT = `precision highp float; uniform sampler2D cloudTexture; uniform vec3 sunPosition; uniform float uOpacity; varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorldPosition; void main() { vec4 texel = texture2D(cloudTexture, vUv); float mask = dot(texel.rgb, vec3(0.299, 0.587, 0.114)); if (mask < 0.03) discard; vec3 normal = normalize(vNormal); vec3 lightDir = normalize(sunPosition - vWorldPosition); float lit = smoothstep(-0.02, 0.22, dot(normal, lightDir)); float alpha = mask * uOpacity * pow(lit, 1.35); if (alpha < 0.01) discard; vec3 color = vec3(1.0) * (0.08 + 0.92 * lit); gl_FragColor = vec4(color, alpha); }`;
const ATMOSPHERE_VERTEX = `varying vec3 vNormalWorld; varying vec3 vWorldPosition; varying float vRimMask; void main() { vNormalWorld = normalize(mat3(modelMatrix) * normal); vec4 worldPos = modelMatrix * vec4(position, 1.0); vWorldPosition = worldPos.xyz; vec3 viewDir = normalize(cameraPosition - worldPos.xyz); float facing = dot(vNormalWorld, viewDir); vRimMask = clamp(-facing - 0.05, 0.0, 1.0); vec4 viewPos = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewPos; }`;
const ATMOSPHERE_FRAGMENT = `precision highp float; varying vec3 vNormalWorld; varying vec3 vWorldPosition; varying float vRimMask; uniform vec3 glowColor; uniform vec3 sunsetTint; uniform vec3 sunPosition; uniform float coef; uniform float power; uniform float uSunIntensity; float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); } void main() { vec3 normalW = normalize(vNormalWorld); float radialFade = pow(vRimMask, max(0.35, power * 0.18)); radialFade = smoothstep(0.0, 1.0, radialFade); float rim = radialFade * clamp(coef, 0.0, 2.0); vec3 lightDir = normalize(sunPosition - vWorldPosition); float sunDot = dot(normalW, lightDir); float dayFactor = smoothstep(-0.45, 0.25, sunDot); float sunsetFactor = smoothstep(-0.35, -0.05, sunDot) * (1.0 - smoothstep(-0.05, 0.25, sunDot)); vec3 baseColor = mix(glowColor, sunsetTint * 1.5, sunsetFactor * 0.8); float intensity = rim * (dayFactor + sunsetFactor * 0.3); intensity += (hash12(gl_FragCoord.xy) - 0.5) / 255.0; intensity = clamp(intensity, 0.0, 1.0); gl_FragColor = vec4(baseColor, intensity * clamp(uSunIntensity, 0.2, 1.0)); }`;

const NebulaSystem = {
    mesh: null, uniforms: null, parallaxFactor: 0.98, baseScale: 800000, aspectRatio: 1.6,
    init: function () {
        if (!Core3D.isInitialized) return;
        const tex = new THREE.TextureLoader().load('/assets/nebula.png');
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
        this.uniforms = { map: { value: tex }, warpFactor: { value: 0.0 } };
        const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: NEBULA_VERTEX, fragmentShader: NEBULA_FRAGMENT, depthWrite: false, depthTest: false });
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.baseScale, this.baseScale / this.aspectRatio), mat);
        this.mesh.position.z = -150000; this.mesh.renderOrder = -999;
        
        this.mesh.name = 'Nebula'; // <--- WAŻNE DLA UKRYWANIA MASKI OKLUZJI

        Core3D.scene.add(this.mesh);
        Core3D.enableBackground3D(this.mesh);
    },
    update: function (dt, gameCamera) {
        if (!this.uniforms || !gameCamera || !this.mesh) return;
        const cx = typeof gameCamera.x === 'number' ? gameCamera.x : 0;
        const cy = typeof gameCamera.y === 'number' ? gameCamera.y : 0;
        const sunX = (window.SUN && window.SUN.x) || 0;
        const sunY = (window.SUN && window.SUN.y) || 0;
        this.mesh.position.x = sunX + (cx - sunX) * this.parallaxFactor;
        this.mesh.position.y = (-sunY) + ((-cy) - (-sunY)) * this.parallaxFactor;
        if (window.warp) {
            let targetWarp = window.warp.state === 'active' ? 1.0 : (window.warp.state === 'charging' && window.warp.chargeTime > 0 ? Math.min(1, window.warp.charge / window.warp.chargeTime) * 0.3 : 0);
            this.uniforms.warpFactor.value += (targetWarp - this.uniforms.warpFactor.value) * 3.0 * dt;
        }
    }
};

const StarSystem = {
    mesh: null, uniforms: null, count: 26000, worldScale: 220000, starSpeed: 0.9, layerZ: -250, lastWarpState: 'idle', exitTimer: 0,
    init: function () {
        if (!Core3D.isInitialized) return;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(this.count * 3); const sizes = new Float32Array(this.count);
        const brights = new Float32Array(this.count); const colors = new Float32Array(this.count * 3);
        const tempColor = new THREE.Color();
        for (let i = 0; i < this.count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * this.worldScale; positions[i * 3 + 1] = (Math.random() - 0.5) * this.worldScale; positions[i * 3 + 2] = 0;
            sizes[i] = 1.0 + Math.pow(Math.random(), 3.0) * 4.0; brights[i] = 0.4 + Math.random() * 0.6;
            const r = Math.random();
            if (r > 0.85) tempColor.setHex(0x9bb0ff); else if (r > 0.55) tempColor.setHex(0xfff4e8); else if (r > 0.25) tempColor.setHex(0xffd2a1); else tempColor.setHex(0xffcc6f);
            colors[i * 3] = tempColor.r; colors[i * 3 + 1] = tempColor.g; colors[i * 3 + 2] = tempColor.b;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geo.setAttribute('brightness', new THREE.BufferAttribute(brights, 1)); geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this.uniforms = {
            pointTexture: { value: this.createStarTexture() }, time: { value: 0 }, cameraOffset: { value: new THREE.Vector2(0, 0) },
            containerSize: { value: this.worldScale }, perspectiveScale: { value: 800.0 }, globalBrightness: { value: 1.0 },
            warpFactor: { value: 0.0 }, moveDir: { value: new THREE.Vector2(0, 1) }, stretchStrength: { value: 25.0 },
            thinningStrength: { value: 45.0 }, baseSizeMul: { value: 1.8 },
            planetMasks: { value: Array.from({ length: STAR_PLANET_MASK_CAP }, () => new THREE.Vector4(0, 0, 0, 0)) }
        };
        const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: STARS_VERTEX, fragmentShader: STARS_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        this.mesh = new THREE.Points(geo, mat); this.mesh.renderOrder = -1; this.mesh.frustumCulled = false;
        Core3D.scene.add(this.mesh); Core3D.enableBackground3D(this.mesh);
    },
    createStarTexture: function () {
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); grad.addColorStop(0, 'rgba(255, 255, 255, 1)'); grad.addColorStop(0.3, 'rgba(200, 230, 255, 0.7)'); grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(canvas);
    },
    update: function (dt, gameCamera, ship) {
        if (!this.uniforms || !gameCamera) return;
        const cx = typeof gameCamera.x === 'number' ? gameCamera.x : 0; const cy = typeof gameCamera.y === 'number' ? gameCamera.y : 0;
        this.uniforms.time.value += dt;
        if (this.mesh) this.mesh.position.set(cx, -cy, this.layerZ);
        const starSpeed = this.starSpeed || 0.9; const wrapSize = this.worldScale || 100000;
        this.uniforms.cameraOffset.value.set(((cx * starSpeed % wrapSize) + wrapSize) % wrapSize, ((-cy * starSpeed % wrapSize) + wrapSize) % wrapSize);
        const planetMasks = this.uniforms.planetMasks?.value;
        if (Array.isArray(planetMasks) && planetMasks.length && window.planets) {
            for (let i = 0; i < STAR_PLANET_MASK_CAP; i++) if (planetMasks[i]) planetMasks[i].set(0, 0, 0, 0);
            let writeIdx = 0;
            for (let i = 0; i < window.planets.length && writeIdx < STAR_PLANET_MASK_CAP; i++) {
                const planet = window.planets[i];
                if (planet?.x && planet?.y && planet?.r > 0) {
                    planetMasks[writeIdx++].set(planet.x, -planet.y, planet.r * PLANET_SIZE_MULTIPLIER * 1.06, 0);
                }
            }
        }
        let dx = 0, dy = 1;
        const interpShipPose = (typeof window !== 'undefined') ? window.__interpShipPose : null;
        if (ship && ship.vel) {
            const speed = Math.hypot(ship.vel.x, ship.vel.y);
            if (speed > 10) { dx = ship.vel.x / speed; dy = ship.vel.y / speed; }
            else if (interpShipPose && Number.isFinite(interpShipPose.angle)) { dx = Math.sin(interpShipPose.angle); dy = -Math.cos(interpShipPose.angle); }
            else if (typeof ship.angle === 'number') { dx = Math.sin(ship.angle); dy = -Math.cos(ship.angle); }
        }
        let targetWarp = 0.0;
        if (window.warp) {
            const currentState = window.warp.state;
            if (this.lastWarpState === 'active' && currentState !== 'active') this.exitTimer = 0.8;
            this.lastWarpState = currentState;
            if (currentState === 'active') { targetWarp = 1.0; if (window.warp.dir) { dx = window.warp.dir.x; dy = window.warp.dir.y; } }
            else if (currentState === 'charging' && window.warp.chargeTime > 0) targetWarp = Math.pow(Math.min(1, window.warp.charge / window.warp.chargeTime), 3.0) * 0.3;
        }
        if (this.exitTimer > 0) { this.exitTimer -= dt; targetWarp = Math.max(targetWarp, Math.pow(Math.max(0, this.exitTimer / 0.8), 2.0) * 1.5); }
        this.uniforms.moveDir.value.set(dx, -dy);
        const lerpSpeed = (this.exitTimer > 0) ? 8.0 : 4.0;
        this.uniforms.warpFactor.value += (targetWarp - this.uniforms.warpFactor.value) * lerpSpeed * dt;
        let targetStarBrightness = 1.0;
        if (window.warp && window.warp.state === 'active') targetStarBrightness = 0.4;
        else if (window.warp && window.warp.state === 'charging' && window.warp.chargeTime > 0) targetStarBrightness = 1.0 - (Math.min(1, window.warp.charge / window.warp.chargeTime) * 0.6);
        if (this.exitTimer > 0) targetStarBrightness = 1.0;
        this.uniforms.globalBrightness.value += (targetStarBrightness - this.uniforms.globalBrightness.value) * (lerpSpeed * 1.5) * dt;
    }
};

const textureLoader = new THREE.TextureLoader();
const _planetCullCenter = new THREE.Vector3();
const _planetCullEdgeX = new THREE.Vector3();
const _planetCullEdgeY = new THREE.Vector3();
function loadTex(path) { const tex = textureLoader.load(path); if (Core3D.renderer) tex.anisotropy = Core3D.renderer.capabilities.getMaxAnisotropy(); return tex; }

class DirectPlanet {
    constructor(data) {
        this.data = data; this.name = (data?.name || data?.id || 'earth').toLowerCase();
        this.mesh = null; this.clouds = null; this.cloudUniforms = null; this.atmosphere = null; this.saturnRing = null;
        this.group = new THREE.Group(); this.group.position.z = -50000; this.basePlanetBloom = 0.0; this.visibleRadiusMul = 1.0;
        this.uniforms = {
            uPlanetBloom: { value: 0.0 }, dayTexture: { value: null }, nightTexture: { value: null }, specularTexture: { value: null },
            normalTexture: { value: null }, sunPosition: { value: new THREE.Vector3(0, 0, -50000) }, hasNightTexture: { value: 0.0 },
            uBrightness: { value: 1.2 }, uAmbient: { value: 0.05 }, uSpecular: { value: 1.2 }, uSunWrap: { value: 0.5 },
            uSunIntensity: { value: 1.0 }, sunsetTint: { value: new THREE.Vector3(1.4, 0.1, 0.1) }
        };
        this.init();
    }
    init() {
        if (!Core3D.isInitialized) return;
        const geometry = new THREE.SphereGeometry(1, 128, 128); const name = this.name;
        if (name !== 'earth') { this.uniforms.uAmbient.value = 0.004; this.uniforms.uSpecular.value = 0.0; this.uniforms.uSunWrap.value = -0.01; this.uniforms.uSunIntensity.value = 1.1; this.uniforms.uBrightness.value = 1.0; }
        if (name === 'jupiter') { this.uniforms.uAmbient.value = 0.0025; this.uniforms.uSunIntensity.value = 0.92; this.uniforms.uBrightness.value = 0.92; this.uniforms.sunsetTint.value.set(1.0, 0.6, 0.3); }
        else if (name === 'saturn') { this.uniforms.uAmbient.value = 0.003; this.uniforms.uSunIntensity.value = 0.95; this.uniforms.uBrightness.value = 0.94; this.uniforms.sunsetTint.value.set(1.0, 0.5, 0.2); }
        else if (name === 'neptune') { this.uniforms.uAmbient.value = 0.003; this.uniforms.uSunIntensity.value = 1.0; this.uniforms.uBrightness.value = 0.96; this.uniforms.sunsetTint.value.set(0.7, 0.2, 1.2); }
        else if (name === 'uranus') { this.uniforms.uAmbient.value = 0.003; this.uniforms.uSunIntensity.value = 1.0; this.uniforms.uBrightness.value = 0.96; this.uniforms.sunsetTint.value.set(0.8, 0.8, 1.0); }
        else if (name === 'mars') { this.uniforms.uAmbient.value = 0.0035; this.uniforms.uSunIntensity.value = 1.04; this.uniforms.uBrightness.value = 0.95; this.uniforms.sunsetTint.value.set(0.2, 0.5, 1.5); }
        else if (name === 'mercury') { this.uniforms.uAmbient.value = 0.0035; this.uniforms.uSunIntensity.value = 1.04; this.uniforms.uBrightness.value = 0.95; this.uniforms.sunsetTint.value.set(0.8, 0.7, 0.6); }
        else if (name === 'venus') { this.uniforms.uAmbient.value = 0.003; this.uniforms.uSunIntensity.value = 0.98; this.uniforms.uBrightness.value = 0.93; this.uniforms.sunsetTint.value.set(1.2, 0.5, 0.1); }

        if (name === 'earth') this.basePlanetBloom = 0.78; else if (name === 'mars') this.basePlanetBloom = 0.4; else if (name === 'jupiter') this.basePlanetBloom = 0.05; else this.basePlanetBloom = 0.2;

        const dayTex = loadTex(`/assets/planety/solar/${name}/${name}_color.jpg`); dayTex.colorSpace = THREE.SRGBColorSpace; this.uniforms.dayTexture.value = dayTex;
        if (name === 'earth') {
            const nightTex = loadTex(`/assets/planety/images/earth_nightmap.jpg`); nightTex.colorSpace = THREE.SRGBColorSpace; this.uniforms.nightTexture.value = nightTex;
            this.uniforms.specularTexture.value = loadTex(`/assets/planety/images/earth_specularmap.jpg`);
            this.uniforms.normalTexture.value = loadTex(`/assets/planety/solar/earth/earth_normal.jpg`);
            this.uniforms.hasNightTexture.value = 1.0;
        } else {
            const empty = new THREE.Texture(); this.uniforms.specularTexture.value = empty; this.uniforms.normalTexture.value = empty; this.uniforms.hasNightTexture.value = 0.0;
        }

        const material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: EARTH_VERTEX, fragmentShader: EARTH_FRAGMENT, extensions: { derivatives: true } });
        this.mesh = new THREE.Mesh(geometry, material); this.group.add(this.mesh);
        if (name === 'saturn') {
            const tilt = THREE.MathUtils.degToRad(SATURN_VISUAL_RING.tiltDeg);
            const ringTex = loadTex(SATURN_VISUAL_RING.texture);
            ringTex.colorSpace = THREE.SRGBColorSpace;

            // POPRAWKA: Zamiana wrapowania pod nowe UV
            ringTex.wrapS = THREE.ClampToEdgeWrapping; // Oś U (promień) nie może się zapętlać
            ringTex.wrapT = THREE.RepeatWrapping; // Oś V (obwód) zapętla się dookoła

            ringTex.center.set(0.5, 0.5);
            ringTex.repeat.set(1.0, 1.0); // Reset powtórzeń, niepotrzebne przy nowym mapowaniu
            ringTex.offset.x = 0.0;
            ringTex.rotation = 0.0;

            const maxAnisotropy = Number(Core3D?.renderer?.capabilities?.getMaxAnisotropy?.()) || 1;
            ringTex.anisotropy = Math.min(16, Math.max(1, maxAnisotropy));

            // POPRAWKA: Zwiększenie segmentów promieniowych na 64 (zapobiega rozciąganiu kanciastych UV)
            const ringFaceGeometry = new THREE.RingGeometry(SATURN_VISUAL_RING.innerRadius, SATURN_VISUAL_RING.outerRadius, 128, 64);
            remapRingPolarUV(ringFaceGeometry, SATURN_VISUAL_RING.innerRadius, SATURN_VISUAL_RING.outerRadius);

            const ringFaceMaterial = new THREE.MeshStandardMaterial({
                map: ringTex,

                color: 0xffffff, // Czysty biały zachowuje oryginalne kolory png
                emissive: 0x000000, // Pierścienie nie świecą w cieniu
                roughness: 0.9,
                metalness: 0.0,
                transparent: true,
                opacity: SATURN_VISUAL_RING.opacity,
                side: THREE.DoubleSide, // Widać z obu stron
                depthWrite: false,
                alphaTest: 0.01 // Pomaga ukryć totalnie niewidzialne piksele
            });

            const ringGroup = new THREE.Group();

            // POPRAWKA: Rysujemy tylko jedną płaszczyznę! Z DoubleSide i depthWrite: false
            // rysowanie grubości to gwarantowane glitche graficzne (Z-Fighting).
            const topFace = new THREE.Mesh(ringFaceGeometry, ringFaceMaterial);
            ringGroup.add(topFace);

            ringGroup.rotation.x = tilt;
            this.saturnRing = ringGroup;
            this.group.add(this.saturnRing);
        }

        if (name === 'earth') {
            const cloudTex = loadTex(`/assets/planety/solar/earth/earth_clouds.jpg`); cloudTex.colorSpace = THREE.SRGBColorSpace;
            this.cloudUniforms = { cloudTexture: { value: cloudTex }, sunPosition: { value: new THREE.Vector3(0, 0, -50000) }, uOpacity: { value: 0.62 } };
            const cloudMat = new THREE.ShaderMaterial({ uniforms: this.cloudUniforms, vertexShader: CLOUD_VERTEX, fragmentShader: CLOUD_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending });
            this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.005, 128, 128), cloudMat); this.group.add(this.clouds);
        }

        let atmColor = new THREE.Vector3(0.3, 0.6, 1.0); let sunsetTint = new THREE.Vector3(1.2, 0.4, 0.1); let atmPower = 8.0; let atmCoef = 0.470; let atmSize = 1.10;
        if (name === 'mercury') { atmColor.set(0.6, 0.6, 0.6); sunsetTint.set(0.8, 0.7, 0.6); atmPower = 10.0; }
        if (name === 'venus') { atmColor.set(0.9, 0.7, 0.2); sunsetTint.set(1.2, 0.5, 0.1); atmPower = 6.0; }
        if (name === 'mars') { atmColor.set(0.8, 0.4, 0.2); sunsetTint.set(0.2, 0.5, 1.5); atmPower = 9.0; }
        if (name === 'jupiter') { atmColor.set(0.65, 0.6, 0.5); sunsetTint.set(1.0, 0.6, 0.3); atmPower = 5.0; }
        if (name === 'saturn') { atmColor.set(0.8, 0.7, 0.5); sunsetTint.set(1.0, 0.5, 0.2); atmPower = 5.0; }
        if (name === 'uranus') { atmColor.set(0.4, 0.7, 0.8); sunsetTint.set(0.8, 0.8, 1.0); atmPower = 4.0; }
        if (name === 'neptune') { atmColor.set(0.2, 0.3, 0.9); sunsetTint.set(0.7, 0.2, 1.2); atmPower = 4.0; }

        atmSize *= HALO_DEFAULTS.sizeMul; atmCoef = atmCoef * HALO_DEFAULTS.coefMul + HALO_DEFAULTS.coefAdd; atmPower = atmPower * HALO_DEFAULTS.powerMul + HALO_DEFAULTS.powerAdd;
        const atmMat = new THREE.ShaderMaterial({ vertexShader: ATMOSPHERE_VERTEX, fragmentShader: ATMOSPHERE_FRAGMENT, uniforms: { coef: { value: atmCoef }, power: { value: atmPower }, glowColor: { value: atmColor }, sunsetTint: { value: sunsetTint }, uSunIntensity: { value: 1.1 * HALO_DEFAULTS.sunMul }, sunPosition: { value: new THREE.Vector3(0, 0, -50000) } }, transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending });
        this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(atmSize, 64, 64), atmMat); this.group.add(this.atmosphere);
        this.visibleRadiusMul = Math.max(1.0, atmSize, name === 'saturn' ? SATURN_VISUAL_RING.outerRadius : 1.0);

        Core3D.scene.add(this.group); enablePlanetLayer(this.group); enablePlanetHaloLayer(this.atmosphere); enablePlanetOcclusion(this.mesh);
        if (name === 'earth') window.EARTH = this;
    }
    update(dt, cam) {
        if (!this.group || !cam) return;

        // Off-screen skip: if planet center is far outside camera viewport,
        // hide the entire group and skip uniform/position/rotation updates.
        // Saves dozens of draw calls + uniform uploads × ~8 planets × every frame.
        this.group.position.set(this.data.x, -this.data.y, -50000);
        const scale = (this.data.r || 100) * PLANET_SIZE_MULTIPLIER;
        this.group.scale.set(scale, scale, scale);
        let offScreen = false;
        const perspCam = Core3D.cameraPersp;
        if (perspCam) {
            const worldCullRadius = scale * Math.max(1.0, this.visibleRadiusMul || 1.0);
            _planetCullCenter.set(this.group.position.x, this.group.position.y, this.group.position.z).project(perspCam);
            _planetCullEdgeX.set(this.group.position.x + worldCullRadius, this.group.position.y, this.group.position.z).project(perspCam);
            _planetCullEdgeY.set(this.group.position.x, this.group.position.y + worldCullRadius, this.group.position.z).project(perspCam);
            const ndcRadiusX = Math.max(0.001, Math.abs(_planetCullEdgeX.x - _planetCullCenter.x));
            const ndcRadiusY = Math.max(0.001, Math.abs(_planetCullEdgeY.y - _planetCullCenter.y));
            const ndcPad = 0.04;
            offScreen =
                _planetCullCenter.x < (-1 - ndcRadiusX - ndcPad) ||
                _planetCullCenter.x > (1 + ndcRadiusX + ndcPad) ||
                _planetCullCenter.y < (-1 - ndcRadiusY - ndcPad) ||
                _planetCullCenter.y > (1 + ndcRadiusY + ndcPad);
        } else {
            const camZoom = cam.zoom || 1;
            const planetRadius = scale * Math.max(1.0, this.visibleRadiusMul || 1.0);
            const halfVpX = (window.innerWidth || 1920) * 0.5 / camZoom + planetRadius;
            const halfVpY = (window.innerHeight || 1080) * 0.5 / camZoom + planetRadius;
            const dx = this.data.x - (cam.x || 0);
            const dy = this.data.y - (cam.y || 0);
            offScreen = Math.abs(dx) > halfVpX || Math.abs(dy) > halfVpY;
        }
        if (offScreen) {
            if (this.group.visible) this.group.visible = false;
            return;
        }
        if (!this.group.visible) this.group.visible = true;

        this.uniforms.uPlanetBloom.value = this.basePlanetBloom * ((window.DevVFX && window.DevVFX.planetBloomMultiplier !== undefined) ? window.DevVFX.planetBloomMultiplier : 1.0);
        if (window.SUN) {
            const sunZ = this.group.position.z;
            this.uniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, sunZ);
            if (this.cloudUniforms) this.cloudUniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, sunZ);
            if (this.atmosphere) this.atmosphere.material.uniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, sunZ);
        }
        if (this.mesh) this.mesh.rotation.y += 0.02 * dt;
        if (this.clouds) this.clouds.rotation.y += 0.027 * dt;
        if (this.saturnRing) this.saturnRing.rotation.z += 0.00035 * dt;
    }
    dispose() { if (this.group && this.group.parent) this.group.parent.remove(this.group); }
}

class DirectMoon {
    constructor(parentData, tune = MOON_TUNE) {
        this.parentData = parentData || null;
        this.tune = tune || MOON_TUNE;
        this.group = new THREE.Group();
        this.group.position.z = Number(this.tune?.z ?? MOON_TUNE.z) || MOON_TUNE.z;
        this.mesh = null;
        this.orbitAngle = Number(this.tune?.phase);
        if (!Number.isFinite(this.orbitAngle)) this.orbitAngle = Math.random() * Math.PI * 2;
        this.init();
    }
    init() {
        if (!Core3D.isInitialized) return;
        const geometry = new THREE.SphereGeometry(1, 96, 96);
        const colorTexPath = this.tune?.colorTex || MOON_TUNE.colorTex;
        const bumpTexPath = this.tune?.bumpTex || null;
        const colorTex = colorTexPath ? loadTex(colorTexPath) : null;
        const bumpTex = bumpTexPath ? loadTex(bumpTexPath) : null;
        if (colorTex) colorTex.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshStandardMaterial({
            map: colorTex || null,
            bumpMap: bumpTex || null,
            bumpScale: Number(this.tune?.bumpScale ?? MOON_TUNE.bumpScale) || MOON_TUNE.bumpScale,
            roughness: 0.98,
            metalness: 0.0,
            color: 0xffffff
        });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.group.add(this.mesh);
        Core3D.scene.add(this.group);
        enablePlanetLayer(this.group);
        enablePlanetOcclusion(this.mesh);
    }
    update(dt, cam) {
        if (!this.group || !this.parentData) return;
        const parentX = Number(this.parentData.x);
        const parentY = Number(this.parentData.y);
        if (!Number.isFinite(parentX) || !Number.isFinite(parentY)) return;

        const parentR = Math.max(100, Number(this.parentData.r) || 2800);
        const orbitRadiusMin = Math.max(0, Number(this.tune?.orbitRadiusMin) || 0);
        const orbitRadiusAbs = Math.max(0, Number(this.tune?.orbitRadius) || 0);
        const orbitRadiusMul = Math.max(0, Number(this.tune?.orbitRadiusMul) || 0);
        const orbitRadius = Math.max(orbitRadiusAbs, orbitRadiusMin, parentR * orbitRadiusMul);
        const orbitPeriodSec = Math.max(1, Number(this.tune?.orbitPeriodSec) || MOON_TUNE.orbitPeriodSec);
        const orbitSpeed = (Math.PI * 2) / orbitPeriodSec;
        this.orbitAngle = (this.orbitAngle + orbitSpeed * Math.max(0, Number(dt) || 0)) % (Math.PI * 2);

        const mx = parentX + Math.cos(this.orbitAngle) * orbitRadius;
        const my = parentY + Math.sin(this.orbitAngle) * orbitRadius;
        const z = Number(this.tune?.z ?? MOON_TUNE.z) || MOON_TUNE.z;
        this.group.position.set(mx, -my, z);

        if (this.mesh) {
            const sizeRatio = Math.max(0.01, Number(this.tune?.sizeRatioToParent) || MOON_TUNE.sizeRatioToParent);
            const moonR = parentR * sizeRatio;
            const scale = Math.max(900, moonR * PLANET_SIZE_MULTIPLIER);
            this.mesh.scale.set(scale, scale, scale);
            this.mesh.rotation.y += 0.01 * Math.max(0, Number(dt) || 0);
        }
    }
    dispose() {
        if (this.group && this.group.parent) this.group.parent.remove(this.group);
    }
}

class DirectSun {
    constructor(data) {
        this.data = data; this.group = new THREE.Group(); this.group.position.z = -60000;
        this.ambientLight = null; this.uniforms = { uTime: { value: 0.0 }, uIsOcclusion: { value: 0 } };
        this.init();
    }
    init() {
        if (!Core3D.isInitialized) return;
        const material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SUN_VERTEX, fragmentShader: SUN_FRAGMENT });
        this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), material);
        this.mesh.name = 'SunMesh'; // <---

        const spriteMat = new THREE.SpriteMaterial({ map: loadTex('/assets/effects/glow.png'), color: 0xffaa00, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
        this.glow = new THREE.Sprite(spriteMat);
        
        this.group.add(this.mesh); this.group.add(this.glow);
        Core3D.scene.add(this.group); enablePlanetLayer(this.group);

        this.sunLight = new THREE.DirectionalLight(SUN_SHADOW_TUNE.color, SUN_SHADOW_TUNE.intensity);
        this.sunLight.castShadow = true; this.sunLight.shadow.camera.layers.enableAll(); this.sunLight.layers.enableAll();
        this.sunLight.shadow.mapSize.width = SUN_SHADOW_TUNE.mapSize; this.sunLight.shadow.mapSize.height = SUN_SHADOW_TUNE.mapSize;
        this.sunLight.shadow.bias = SUN_SHADOW_TUNE.bias; this.sunLight.shadow.normalBias = SUN_SHADOW_TUNE.normalBias;
        this.sunLight.shadow.camera.near = SUN_SHADOW_TUNE.near; this.sunLight.shadow.camera.far = SUN_SHADOW_TUNE.far;
        this.sunTarget = new THREE.Object3D(); Core3D.scene.add(this.sunTarget); this.sunLight.target = this.sunTarget;
        Core3D.scene.add(this.sunLight);
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.02); this.ambientLight.layers.enableAll(); Core3D.scene.add(this.ambientLight);
    }
    update(dt, cam) {
        if (!cam) return;
        if (this.uniforms) this.uniforms.uTime.value += dt;
        const x = this.data.x; const y = -this.data.y;
        this.group.position.set(x, y, -60000);
        if (this.sunLight) {
            const targetX = (typeof cam.x === 'number') ? cam.x : x; const targetY = (typeof cam.y === 'number') ? -cam.y : y;
            const dirX = x - targetX; const dirY = y - targetY; const len = Math.hypot(dirX, dirY) || 1;
            this.sunLight.position.set(targetX + (dirX / len) * 2600, targetY + (dirY / len) * 2600, 3000);
            if (this.sunTarget) { this.sunTarget.position.set(targetX, targetY, 0); this.sunTarget.updateMatrixWorld(); }
        }
        const scale = (this.data.r3D || this.data.r || 200) * SUN_SIZE_MULTIPLIER;
        this.mesh.scale.set(scale, scale, scale);
        if (this.glow) { this.glow.scale.set(scale * 2.6, scale * 2.6, 1); this.glow.material.opacity = 0.6 + Math.sin(this.uniforms.uTime.value * 2.0) * 0.1; }
        
        // Zamiast pushGodRayWorld używamy uIsOcclusion, pushGodRayWorld wywoływane w core3d.js
        this.mesh.rotation.z -= 0.002 * dt;

        if (this.sunLight && this.sunLight.castShadow) {
            const zoom = Math.max(0.0001, Number(cam.zoom) || 1);
            let halfSpan = Math.max((window.innerWidth * 0.5) / zoom, (window.innerHeight * 0.5) / zoom) * SUN_SHADOW_TUNE.frustumMul + SUN_SHADOW_TUNE.frustumPad;
            halfSpan = Math.round(Math.max(SUN_SHADOW_TUNE.frustumMin, Math.min(SUN_SHADOW_TUNE.frustumMax, halfSpan)) / 8) * 8;
            const texelSize = (halfSpan * 2) / this.sunLight.shadow.mapSize.width;
            if (texelSize > 0) {
                const snappedTargetX = Math.round(this.sunTarget.position.x / texelSize) * texelSize;
                const snappedTargetY = Math.round(this.sunTarget.position.y / texelSize) * texelSize;
                this.sunLight.position.x += snappedTargetX - this.sunTarget.position.x;
                this.sunLight.position.y += snappedTargetY - this.sunTarget.position.y;
                this.sunTarget.position.x = snappedTargetX; this.sunTarget.position.y = snappedTargetY;
                this.sunTarget.updateMatrixWorld();
            }
            const shadowCam = this.sunLight.shadow.camera;
            shadowCam.left = -halfSpan; shadowCam.right = halfSpan; shadowCam.top = halfSpan; shadowCam.bottom = -halfSpan;
            shadowCam.updateProjectionMatrix(); this.sunLight.shadow.needsUpdate = true;
        }
    }
    dispose() {
        if (this.group && this.group.parent) this.group.parent.remove(this.group);
        if (this.sunLight && this.sunLight.parent) this.sunLight.parent.remove(this.sunLight);
        if (this.sunTarget && this.sunTarget.parent) this.sunTarget.parent.remove(this.sunTarget);
        if (this.ambientLight && this.ambientLight.parent) this.ambientLight.parent.remove(this.ambientLight);
    }
}

const _entities = [];

window.initPlanets3D = function (planetList, sunData) {
    if (!Core3D.isInitialized) Core3D.init();
    for (const ent of _entities) if (ent && typeof ent.dispose === 'function') ent.dispose();
    _entities.length = 0;
    NebulaSystem.init(); StarSystem.init();
    if (sunData) _entities.push(new DirectSun(sunData));
    let earthData = null;
    let jupiterData = null;
    if (Array.isArray(planetList)) {
        planetList.forEach(pData => {
            _entities.push(new DirectPlanet(pData));
            const id = String(pData?.id || pData?.name || '').toLowerCase();
            if (id === 'earth') earthData = pData;
            if (id === 'jupiter') jupiterData = pData;
        });
    }
    if (earthData) _entities.push(new DirectMoon(earthData));
    if (jupiterData) {
        for (let i = 0; i < JUPITER_MOONS_TUNE.length; i++) {
            _entities.push(new DirectMoon(jupiterData, JUPITER_MOONS_TUNE[i]));
        }
    }
    window._entities = _entities;
    return Core3D.scene;
};

window.updatePlanets3D = function (dt, cam) {
    if (!Core3D.isInitialized || !cam) return;
    NebulaSystem.update(dt, cam); StarSystem.update(dt, cam, window.ship);
    if (window._entities) window._entities.forEach(ent => { if (ent.update) ent.update(dt, cam); });
};
window.drawPlanets3D = function (ctx, cam) { };
window.worldToScreen = function (x, y, cam) {
    if (!cam) return { x: 0, y: 0 };
    return { x: (x - cam.x) * cam.zoom + window.innerWidth / 2, y: (y - cam.y) * cam.zoom + window.innerHeight / 2 };
};
