// Engineeffects.js
// Ulepszony VFX: Shader-based Ion Drive v18 (Final)
// Czysta termiczna plazma + Heat Glow + Anamorficzna Flara + Dynamiczne Światło.

import * as THREE from "three";

// ================== SHADERS ==================

const vertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
uniform float uTime;
uniform float uThrottle; 
uniform float uBoost;    
uniform vec3 uColorCore;
uniform vec3 uColorEdge;
uniform float uNoiseScale;
uniform float uSpeed;

varying vec2 vUv;

float random (in vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float noise (in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
    vec2 uv = vUv;
    float x = (uv.x - 0.5) * 2.0; 
    float y = 1.0 - uv.y; 

    // --- 1. DYNAMICZNA DŁUGOŚĆ ---
    // Skrócone widoczne pasmo, by uniknąć efektu "niekończącego się ogona"
    float visibleLength = 0.2 + 0.78 * (uThrottle + uBoost);
    float lengthMask = 1.0 - smoothstep(visibleLength * 0.7, visibleLength, y);

    // --- 2. KSZTAŁT ---
    // Szeroka podstawa, szybkie zwężenie (parabola)
    float width = (1.0 - pow(y, 1.8)) * 0.95; 
    width *= (1.0 + uBoost * 0.4); 
    
    float shape = 1.0 - smoothstep(width * 0.4, width, abs(x));
    shape *= smoothstep(0.0, 0.1, y);
    shape *= (1.0 - smoothstep(0.4, 0.95, y)); // Clean fade out

    // --- 3. DETALE ---
    // Turbulencje widoczne przy ciągu
    float turbulenceMix = smoothstep(0.0, 0.3, uThrottle + uBoost);
    float flowSpeed = uTime * uSpeed * (1.0 + uThrottle * 2.5);
    float n = noise(vec2(x * 2.5, y * 6.0 - flowSpeed));
    float finalShape = mix(shape, shape * (0.7 + 0.4 * n), turbulenceMix);

    // --- 4. EFEKTY SPECJALNE ---
    // Shock Diamonds
    float diamonds = sin(y * 22.0 - uTime * 4.0) * sin(y * 14.0 + uTime * 9.0);
    float diamondPattern = smoothstep(0.3, 0.9, diamonds);
    diamondPattern *= (1.0 - abs(x) * 1.5); 
    float diamondStr = smoothstep(0.2, 1.0, uThrottle) * (1.0 - uBoost); 

    // Glow Idle (stabilna poświata w spoczynku)
    float coreGlowDist = length(vec2(x * 0.7, y * 4.0));
    float coreGlow = pow((1.0 - smoothstep(0.0, 0.6, coreGlowDist)), 2.0);
    float idlePulse = 0.9 + 0.1 * sin(uTime * 4.0);

    // --- 5. KOLORY ---
    float coreIntensity = pow(clamp(1.0 - abs(x) / (width * 1.2), 0.0, 1.0), 3.0);
    vec3 color = mix(uColorEdge, uColorCore, coreIntensity);
    
    color += uColorCore * diamondPattern * diamondStr * 0.9;

    float streamAlpha = finalShape * lengthMask * (0.5 + 0.5 * uThrottle);
    float glowAlpha = coreGlow * idlePulse * (1.0 - uThrottle * 0.3);
    
    float finalAlpha = max(streamAlpha, glowAlpha);
    
    // Jasność rośnie z ciągiem
    color *= (1.0 + (uThrottle + uBoost) * 1.5);

    gl_FragColor = vec4(color, finalAlpha);
}
`;

// --- TEKSTURY POMOCNICZE ---

function makeFlareTexture() {
    // Anamorficzna flara - ostra pozioma linia
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 32; 
    const ctx = canvas.getContext('2d');
    
    // Gradient poziomy (zanika na końcach)
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0.0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.2, 'rgba(100, 200, 255, 0.1)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 1.0)'); 
    grad.addColorStop(0.8, 'rgba(100, 200, 255, 0.1)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0)');
    
    ctx.fillStyle = grad;
    ctx.beginPath();
    // Wysokość tylko 2px dla ostrości
    ctx.ellipse(128, 16, 128, 2, 0, 0, Math.PI*2);
    ctx.fill();
    
    // Hotspot w centrum
    const coreGrad = ctx.createRadialGradient(128,16,0, 128,16,16);
    coreGrad.addColorStop(0, 'rgba(255,255,255,0.8)');
    coreGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(128, 16, 8, 0, Math.PI*2);
    ctx.fill();

    return new THREE.CanvasTexture(canvas);
}

function makeGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32,32,0,32,32,32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.2, 'rgba(255, 120, 50, 0.8)'); 
    grad.addColorStop(0.5, 'rgba(255, 60, 0, 0.3)'); 
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,64,64);
    return new THREE.CanvasTexture(canvas);
}

function makeRingTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 200, 100, 1)';
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(255, 50, 0, 1)';
    ctx.beginPath();
    ctx.arc(32, 32, 20, 0, Math.PI * 2);
    ctx.stroke();
    return new THREE.CanvasTexture(canvas);
}

// ================== GŁÓWNA FUNKCJA ==================

export function createShortNeedleExhaust(opts = {}) {
    const group = new THREE.Group();
    group.name = "ExhaustGroup";

    const colorCore = new THREE.Color(0xffffff);
    const colorEdge = new THREE.Color(0x4aaeff);

    // 1. PLAZMA (MESH)
    const uniforms = {
        uTime: { value: 0 },
        uThrottle: { value: 0 },
        uBoost: { value: 0 },
        uColorCore: { value: colorCore },
        uColorEdge: { value: colorEdge },
        uNoiseScale: { value: 1.0 },
        uSpeed: { value: 8.0 }
    };

    const material = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        uniforms: uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    const geometry = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -0.5;
    // Baza szeroka (48), startowa długość krótka (20)
    mesh.scale.set(48, 20, 1); 
    group.add(mesh);

    // 2. DYNAMICZNE ŚWIATŁO
    const light = new THREE.PointLight(0x4aaeff, 2.0, 150);
    // Pozycja światła względem silnika (lekko w górę/stronę statku i w Z)
    light.position.set(0, 10, 20);
    group.add(light);

    // 3. LENS FLARE (Anamorficzna)
    const flareMat = new THREE.SpriteMaterial({
        map: makeFlareTexture(),
        color: 0x88ccff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0 // Startowo niewidoczna
    });
    const flare = new THREE.Sprite(flareMat);
    flare.scale.set(100, 10, 1); 
    flare.position.set(0, 0, 1.5); // U nasady dyszy, na wierzchu
    group.add(flare);

    // 4. HEAT GLOW (Poświata dyszy)
    const heatMat = new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: 0xff4400,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0
    });
    const heatGlow = new THREE.Sprite(heatMat);
    heatGlow.scale.set(70, 70, 1);
    heatGlow.position.set(0, 2, 0.1);
    group.add(heatGlow);

    // 5. HEAT RING (Metal dyszy)
    const ringMat = new THREE.SpriteMaterial({
        map: makeRingTexture(),
        color: 0xffaa00,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0
    });
    const heatRing = new THREE.Sprite(ringMat);
    heatRing.scale.set(50, 30, 1);
    heatRing.position.set(0, 0, 0.2);
    group.add(heatRing);

    // --- STATE ---
    let throttleTarget = 0;
    let currentThrottle = 0;
    let warpBoostTarget = 0;
    let currentWarpBoost = 0;
    let bloomGain = opts.bloomGain || 1.0;
    let baseColorTemp = opts.colorTempK || 8000;
    let heatAccumulator = 0; 

    const warpBlue = new THREE.Color(0x0066ff);
    const heatColorCold = new THREE.Color(0x440000); // Ciemna czerwień
    const heatColorHot = new THREE.Color(0xff8800);  // Jasny pomarańcz

    function setThrottle(t) { throttleTarget = THREE.MathUtils.clamp(t, 0, 1); }
    function setWarpBoost(t) { warpBoostTarget = THREE.MathUtils.clamp(t, 0, 1); }
    function setBloomGain(g) { bloomGain = g; }
    
    // Funkcja temperatury barwowej (Kelvin -> RGB)
    function kelvinToRGB(k) {
        k = k / 100;
        let r, g, b;
        if (k <= 66) { r = 255; g = 99.47 * Math.log(k) - 161.12; }
        else { r = 329.7 * Math.pow(k - 60, -0.133); g = 288.1 * Math.pow(k - 60, -0.0755); }
        if (k >= 66) { b = 255; }
        else if (k <= 19) { b = 0; }
        else { b = 138.5 * Math.log(k - 10) - 305.0; }
        return new THREE.Color(
            Math.max(0, Math.min(1, r / 255)),
            Math.max(0, Math.min(1, g / 255)),
            Math.max(0, Math.min(1, b / 255))
        );
    }

    function setColorTemp(k) { baseColorTemp = k; }

    function update(dt = 0.016) {
        // Fizyka wartości (płynne przejścia)
        currentThrottle = THREE.MathUtils.lerp(currentThrottle, throttleTarget, 0.1);
        currentWarpBoost = THREE.MathUtils.lerp(currentWarpBoost, warpBoostTarget, 0.05);

        // --- PLAZMA SHADER ---
        uniforms.uTime.value += dt;
        uniforms.uThrottle.value = currentThrottle;
        uniforms.uBoost.value = currentWarpBoost;

        const baseLen = 20; 
        const extraLen = 50 * currentThrottle; 
        const warpLen = 60 * currentWarpBoost; // Max długość przy warpie
        const totalLen = baseLen + extraLen + warpLen;
        
        const pulse = 1.0 + 0.05 * Math.sin(uniforms.uTime.value * 20.0);
        
        // MESH: Szerokość rośnie z Warpem
        const totalWidth = 48 * (1.0 + currentWarpBoost * 0.3) * pulse;
        mesh.scale.set(totalWidth, totalLen, 1);
        mesh.position.y = -totalLen / 2; 

        // --- KOLORY ---
        // Temperatura rośnie z gazem (termicznie), a przy Warpie przechodzi w niebieski
        const activeTemp = baseColorTemp + (currentThrottle * 4000);
        const thermalCol = kelvinToRGB(activeTemp);
        const finalCol = thermalCol.clone().lerp(warpBlue, currentWarpBoost);

        uniforms.uColorCore.value.setHex(0xffffff);
        uniforms.uColorEdge.value.copy(finalCol).multiplyScalar(bloomGain);

        // --- 1. AKTUALIZACJA ŚWIATŁA ---
        light.color.copy(finalCol);
        // Intensywność: Idle=2, Thrust=8, Warp=20
        const targetLight = 2.0 + (currentThrottle * 6.0) + (currentWarpBoost * 18.0);
        light.intensity = THREE.MathUtils.lerp(light.intensity, targetLight, 0.2);
        
        // Zasięg: Idle=150, Thrust=300, Warp=800
        const targetDistance = 150 + (currentThrottle * 150) + (currentWarpBoost * 650);
        light.distance = THREE.MathUtils.lerp(light.distance, targetDistance, 0.1);

        // --- 2. AKTUALIZACJA FLARY ---
        // Flara widoczna przy gazie i bardzo przy warpie
        const flareOp = (currentThrottle * 0.5 + currentWarpBoost * 1.5) * bloomGain;
        flare.material.opacity = THREE.MathUtils.lerp(flare.material.opacity, flareOp, 0.1);
        flare.material.color.copy(finalCol); 
        
        // Flara skaluje się głównie na szerokość
        const flareWidth = 100 + currentWarpBoost * 150; 
        const flareHeight = 6 + currentWarpBoost * 4;
        flare.scale.set(flareWidth, flareHeight, 1);

        // --- 3. HEAT GLOW ---
        // Symulacja bezwładności termicznej
        if (currentThrottle > 0.1 || currentWarpBoost > 0.1) {
            heatAccumulator = Math.min(1.0, heatAccumulator + dt * 0.8);
        } else {
            heatAccumulator = Math.max(0.0, heatAccumulator - dt * 0.3);
        }
        
        const heatCol = heatColorCold.clone().lerp(heatColorHot, heatAccumulator);
        // Warp ochładza wizualnie (zmienia na niebieski), mimo że jest gorący
        heatCol.lerp(warpBlue, currentWarpBoost * 0.8);
        
        heatGlow.material.color.copy(heatCol);
        heatGlow.material.opacity = heatAccumulator;
        
        // Skalowanie Glowa po szerokości przy Warpie (musi pasować do płomienia)
        const glowWidth = 70 * (1.0 + currentWarpBoost * 0.4); 
        heatGlow.scale.set(glowWidth, 70, 1);

        // Ring widoczny gdy gorąco
        heatRing.material.opacity = heatAccumulator;
        const ringWidth = 50 * (1.0 + currentWarpBoost * 0.3);
        heatRing.scale.set(ringWidth, 30, 1);
    }

    return { group, setThrottle, setWarpBoost, setColorTemp, setBloomGain, update };
}

export function createWarpExhaustBlue(opts = {}) {
    // Warp wariant używa tego samego shadera, bo jest elastyczny
    return createShortNeedleExhaust(opts);
}
