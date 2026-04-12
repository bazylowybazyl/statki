import * as THREE from "three";

// --- BAZOWY SZUM GLSL ---
const noiseChunk = `
    float hash(float n) { return fract(sin(n) * 43758.5453123); }
    float noise(vec3 x) {
        vec3 p = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        float n = p.x + p.y * 57.0 + 113.0 * p.z;
        return mix(mix(mix(hash(n + 0.0), hash(n + 1.0), f.x),
                       mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
                   mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                       mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
        float f = 0.0;
        f += 0.5000 * noise(p); p *= 2.02;
        f += 0.2500 * noise(p); p *= 2.03;
        f += 0.1250 * noise(p); p *= 2.01;
        return f;
    }
`;

// --- ADDITIVE PARTICLE MANAGER (Światło, Iskry, Ring, Kolce) ---
class GPUInstancedParticleManager {
    constructor(scene, maxParticles, blendingType) {
        this.maxParticles = maxParticles;
        this.activeIndex = 0; 
        
        const baseGeo = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = baseGeo.index;
        geo.setAttribute('position', baseGeo.attributes.position);
        geo.setAttribute('uv', baseGeo.attributes.uv);

        this.startPos = new Float32Array(maxParticles * 3);
        this.startVel = new Float32Array(maxParticles * 3);
        this.dataInfo = new Float32Array(maxParticles * 4); 
        
        geo.setAttribute('aStartPos', new THREE.InstancedBufferAttribute(this.startPos, 3));
        geo.setAttribute('aStartVel', new THREE.InstancedBufferAttribute(this.startVel, 3));
        geo.setAttribute('aData', new THREE.InstancedBufferAttribute(this.dataInfo, 4));
        geo.instanceCount = maxParticles;

        this.material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                attribute vec3 aStartPos;
                attribute vec3 aStartVel;
                attribute vec4 aData; 
                
                uniform float uTime;
                
                varying vec3 vColor;
                varying float vAlpha;
                varying vec2 vUv;
                varying float vType;
                varying float vAgeNorm;

                float hash(float n) { return fract(sin(n) * 43758.5453123); }

                void main() {
                    vUv = uv;
                    vType = aData.w; 
                    float startTime = aData.x;
                    float maxLife = aData.y;
                    float age = uTime - startTime;

                    if (age < 0.0 || age > maxLife) {
                        gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
                        return;
                    }

                    float ratio = 1.0 - (age / maxLife); 
                    vAgeNorm = age / maxLife; 
                    
                    vec3 pos = aStartPos + aStartVel * age;
                    float currentSize = aData.z; 
                    float stretchFactor = 1.0;
                    vec4 mvPosition;

                    if (vType < 4.5) { // 4: KOLCE (SPIKES) & ISKRY
                        float drag = 3.5 + hash(aData.x) * 2.0; 
                        pos = aStartPos + aStartVel * ((1.0 - exp(-age * drag)) / drag);
                        
                        vec3 currentVel = aStartVel * exp(-age * drag);
                        float speed = length(currentVel);
                        
                        // Oślepiająca biel z lodowym błękitem na końcu
                        vec3 hot = vec3(1.0, 1.0, 1.0) * 5.0;
                        vec3 cold = vec3(0.0, 0.4, 1.0) * 2.0; 
                        vColor = mix(hot, cold, pow(vAgeNorm, 0.5)); 
                        
                        vAlpha = pow(ratio, 0.5) * 1.5; 
                        
                        mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        
                        vec3 viewVel = (modelViewMatrix * vec4(currentVel, 0.0)).xyz;
                        vec2 dir = normalize(viewVel.xy);
                        if (length(viewVel.xy) < 0.1) dir = vec2(0.0, 1.0);

                        float width = aData.z;
                        float stretch = aData.z * speed * 0.003; // Rozciągnięcie
                        
                        float tailFactor = 0.5 - position.y; 
                        
                        vec2 scaledOffset;
                        scaledOffset.x = position.x * width;
                        scaledOffset.y = -tailFactor * stretch; 
                        
                        vec2 rotatedOffset;
                        rotatedOffset.x = scaledOffset.x * dir.y + scaledOffset.y * dir.x;
                        rotatedOffset.y = -scaledOffset.x * dir.x + scaledOffset.y * dir.y;
                        
                        mvPosition.xy += rotatedOffset;
                    }
                    else if (vType < 5.5) { // 5: ANAMORPHIC CORE (Rdzeń i Błysk)
                        currentSize = aData.z * (0.5 + vAgeNorm * 0.5);
                        vColor = vec3(0.2, 0.8, 1.0) * 10.0; // Cyjanowy Overdrive
                        vAlpha = pow(ratio, 3.0); 
                        
                        mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        mvPosition.xy += position.xy * currentSize;
                    }
                    else { // 6: FRACTAL ENERGY RING (Pierścień uderzeniowy płasko na ziemi)
                        float waveCurve = pow(vAgeNorm, 0.4); 
                        currentSize = aData.z * waveCurve;
                        vColor = vec3(0.0, 0.8, 1.0) * 4.0; // Cyjan
                        vAlpha = pow(1.0 - vAgeNorm, 1.5); 
                        
                        vec3 flatPos = pos;
                        flatPos.x += position.x * currentSize;
                        // Orientacja pozioma (Zamiana Y na Z by leżało na płaszczyźnie XZ)
                        flatPos.z += position.y * currentSize; 
                        mvPosition = modelViewMatrix * vec4(flatPos, 1.0);
                    }

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                varying vec2 vUv;
                varying float vType; 
                varying float vAgeNorm;
                uniform float uTime;
                
                ${noiseChunk}

                void main() {
                    vec2 uv = vUv - vec2(0.5);
                    float dist = length(uv) * 2.0; 

                    if (vType < 4.5) { // ISKRY & KOLCE
                        vec2 pt = vUv - vec2(0.5);
                        float glowX = pow(max(0.0, 0.5 - abs(pt.x)) * 2.0, 3.0);
                        
                        // Zaokrąglone końce
                        float fadeY = smoothstep(1.0, 0.8, vUv.y) * smoothstep(0.0, 0.2, vUv.y); 
                        float baseAlpha = glowX * fadeY;
                        
                        // Efekt brokatu / iskrzenia
                        float twinkle = pow(sin(uTime * 30.0 + vColor.g * 100.0 + pt.x * 10.0), 2.0);
                        float twinkleBlend = smoothstep(0.05, 0.15, vAgeNorm); 
                        baseAlpha *= mix(1.0, twinkle, twinkleBlend);
                        
                        gl_FragColor = vec4(vColor, baseAlpha * vAlpha);
                    }
                    else if (vType < 5.5) { // ANAMORPHIC CORE
                        float core = max(0.0, 1.0 - smoothstep(0.0, 0.3, dist));
                        float flareY = max(0.0, 1.0 - smoothstep(0.0, 0.02, abs(uv.y)));
                        float flareX = max(0.0, 1.0 - smoothstep(0.0, 0.5, abs(uv.x)));
                        float flare = flareY * flareX * 2.0;
                        float aura = max(0.0, 1.0 - dist);
                        
                        float finalIntensity = max(0.0, core + flare + aura * 0.3);
                        gl_FragColor = vec4(vColor * finalIntensity, finalIntensity * vAlpha);
                    }
                    else { // FRACTAL ENERGY RING
                        if(dist > 1.0) discard;
                        float ringShape = max(0.0, 1.0 - smoothstep(0.0, 0.15, abs(dist - 0.7))); 
                        float angle = atan(uv.y, uv.x);
                        float n = fbm(vec3(angle * 10.0, dist * 5.0 - uTime * 2.0, uTime));
                        float finalRing = ringShape * (n * 2.5);
                        float innerGlow = max(0.0, smoothstep(0.0, 0.8, dist)) * 0.2;
                        
                        gl_FragColor = vec4(vColor, (finalRing + innerGlow) * vAlpha);
                    }
                }
            `,
            blending: blendingType,
            depthWrite: false, 
            depthTest: false, 
            transparent: true
        });

        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.frustumCulled = false; 
        this.mesh.renderOrder = 1000; 
        scene.add(this.mesh);
    }

    spawn(x, y, z, vx, vy, vz, size, life, type, globalTime) {
        let i = this.activeIndex;
        this.activeIndex = (this.activeIndex + 1) % this.maxParticles;
        let i3 = i * 3, i4 = i * 4;
        
        this.startPos[i3]=x; this.startPos[i3+1]=y; this.startPos[i3+2]=z;
        this.startVel[i3]=vx; this.startVel[i3+1]=vy; this.startVel[i3+2]=vz;
        
        this.dataInfo[i4] = globalTime;     
        this.dataInfo[i4+1] = life;         
        this.dataInfo[i4+2] = size;         
        this.dataInfo[i4+3] = type;         
        
        const geo = this.mesh.geometry;
        geo.attributes.aStartPos.needsUpdate = true;
        geo.attributes.aStartVel.needsUpdate = true;
        geo.attributes.aData.needsUpdate = true;
    }
}

// --- NORMAL BLENDING PARTICLE MANAGER (Mroczna Fala Uderzeniowa na ziemi) ---
class GPUParticleManager {
    constructor(scene, maxParticles, blendingType) {
        this.maxParticles = maxParticles;
        this.activeIndex = 0; 
        
        const baseGeo = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = baseGeo.index;
        geo.setAttribute('position', baseGeo.attributes.position);
        geo.setAttribute('uv', baseGeo.attributes.uv);

        this.startPos = new Float32Array(maxParticles * 3);
        this.startVel = new Float32Array(maxParticles * 3);
        this.dataInfo = new Float32Array(maxParticles * 4); 
        
        geo.setAttribute('aStartPos', new THREE.InstancedBufferAttribute(this.startPos, 3));
        geo.setAttribute('aStartVel', new THREE.InstancedBufferAttribute(this.startVel, 3));
        geo.setAttribute('aData', new THREE.InstancedBufferAttribute(this.dataInfo, 4));
        geo.instanceCount = maxParticles;

        this.material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                attribute vec3 aStartPos;
                attribute vec3 aStartVel;
                attribute vec4 aData; 
                uniform float uTime;

                varying vec3 vColor;
                varying float vAlpha;
                varying vec2 vUv;
                varying float vAgeNorm;

                void main() {
                    vUv = uv;
                    float startTime = aData.x;
                    float maxLife = aData.y;
                    float age = uTime - startTime;

                    if (age < 0.0 || age > maxLife) {
                        gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
                        return;
                    }

                    vAgeNorm = age / maxLife; 
                    float waveCurve = pow(vAgeNorm, 0.4); 
                    float currentSize = aData.z * waveCurve;
                    
                    vColor = vec3(0.02, 0.05, 0.1); // Mroczny granat reaktora
                    vAlpha = pow(1.0 - vAgeNorm, 2.0) * 0.9; 
                    
                    vec3 flatPos = aStartPos;
                    flatPos.x += position.x * currentSize;
                    // Orientacja pozioma na płaszczyźnie XZ
                    flatPos.z += position.y * currentSize; 
                    vec4 mvPosition = modelViewMatrix * vec4(flatPos, 1.0);

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                varying vec2 vUv;
                varying float vAgeNorm;
                uniform float uTime;
                
                ${noiseChunk}

                void main() {
                    vec2 uv = vUv - vec2(0.5);
                    float dist = length(uv) * 2.0; 
                    if(dist > 1.0) discard;
                    
                    // SHOCKWAVE RING 
                    float ringShape = max(0.0, 1.0 - smoothstep(0.0, 0.4, abs(dist - 0.7))); 
                    float angle = atan(uv.y, uv.x);
                    float n = fbm(vec3(angle * 12.0, dist * 3.0 - uTime, uTime * 0.5));
                    
                    float finalAlpha = ringShape * n * vAlpha;
                    gl_FragColor = vec4(vColor, finalAlpha);
                }
            `,
            blending: blendingType,
            depthWrite: false, 
            depthTest: false, 
            transparent: true
        });

        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.frustumCulled = false; 
        this.mesh.renderOrder = 999; 
        scene.add(this.mesh);
    }

    spawn(x, y, z, vx, vy, vz, size, life, type, globalTime) {
        let i = this.activeIndex;
        this.activeIndex = (this.activeIndex + 1) % this.maxParticles;
        let i3 = i * 3, i4 = i * 4;
        
        this.startPos[i3]=x; this.startPos[i3+1]=y; this.startPos[i3+2]=z;
        this.startVel[i3]=vx; this.startVel[i3+1]=vy; this.startVel[i3+2]=vz;
        
        this.dataInfo[i4] = globalTime;     
        this.dataInfo[i4+1] = life;         
        this.dataInfo[i4+2] = size;         
        this.dataInfo[i4+3] = type;         
        
        const geo = this.mesh.geometry;
        geo.attributes.aStartPos.needsUpdate = true;
        geo.attributes.aStartVel.needsUpdate = true;
        geo.attributes.aData.needsUpdate = true;
    }
}

// ============================================================================
// GŁÓWNA FABRYKA EKSPLOZJI REAKTORA (Z OPTYCZNĄ FALĄ UDERZENIOWĄ)
// ============================================================================
export function createReactorBlowFactory(scene) {
    const fireParticleSystem = new GPUInstancedParticleManager(scene, 100000, THREE.AdditiveBlending);
    const smokeParticleSystem = new GPUParticleManager(scene, 15000, THREE.NormalBlending);

    return function spawn({ x = 0, y = 0, size = 100, profile = "capital" } = {}) {
        const group = new THREE.Group();
        group.position.set(x, 0, y);
        scene.add(group);

        const isFighter = profile === "fighter";

        const lightDist = isFighter ? size * 4 : size * 20;
        const light = new THREE.PointLight(0x00ffff, 0, lightDist);
        light.position.set(x, size * 0.5, y);
        scene.add(light);

        // Czasy 1:1 z plikiem HTML dla capitali
        const CHARGE_TIME = isFighter ? 0.05 : 0.8;
        const EXPLOSION_DURATION = isFighter ? 0.2 : 3.0; 

        const expX = x;
        const expY = 5;
        const expZ = y; // W przestrzeni 3D gry Y to Z

        const initTime = performance.now() / 1000;
        let phase = 'CHARGE';
        let disposed = false;

        // Faza ładowania
        const chargeSize = isFighter ? size * 1.5 : size * 3.5;
        fireParticleSystem.spawn(expX, expY, expZ, 0, 0, 0, chargeSize, CHARGE_TIME + 0.1, 5, initTime);

        function update(dt) {
            if (disposed) return;

            const gt = performance.now() / 1000;
            const time = gt - initTime; 

            fireParticleSystem.material.uniforms.uTime.value = gt;
            smokeParticleSystem.material.uniforms.uTime.value = gt;

            if (phase === 'CHARGE') {
                light.intensity = (time / CHARGE_TIME) * (isFighter ? 1.0 : 4.0);
            } else {
                const expTime = time - CHARGE_TIME;
                const dropOff = isFighter ? 0.15 : 1.5;
                light.intensity = Math.max(0, (isFighter ? 2.0 : 15.0) * (1.0 - expTime / dropOff));

                // --- OPTYCZNA FALA UDERZENIOWA (Załamanie światła przez Core3D) ---
                if (!isFighter && expTime < 2.0 && typeof window !== 'undefined' && window.Core3D) {
                    // Resetujemy bufor fal uderzeniowych co klatkę (zabezpieczenie)
                    if (window.Core3D._lastHeatHazeFrame !== gt) {
                        window.Core3D._lastHeatHazeFrame = gt;
                        if (window.Core3D.beginHeatHazeFrame) window.Core3D.beginHeatHazeFrame();
                    }

                    // Promień rośnie wraz z upływem czasu
                    const currentRadius = size * 2 + (expTime * size * 25);
                    // Siła załamania płynnie zanika
                    const distortionStrength = Math.max(0, 1.0 - (expTime / 2.0)) * 6.0;

                    // Pchamy fale do głównego potoku post-processingu gry
                    window.Core3D.pushHeatHazeWorld(expX, expZ, -4, currentRadius, distortionStrength);
                }
            }

            if (phase === 'CHARGE' && time >= CHARGE_TIME) {
                phase = 'EXPLODE';

                if (!isFighter) {
                    // WYBUCH CAPITALA (Proporcje i ilości z pliku HTML)
                    
                    // 1. Anamorphic Flash (Błysk)
                    fireParticleSystem.spawn(expX, expY, expZ, 0, 0, 0, size * 12, 1.2, 5, gt);

                    // 2. Fractal Energy Ring (Pierścień)
                    fireParticleSystem.spawn(expX, expY, expZ, 0, 0, 0, size * 17, 1.5, 6, gt);

                    // 3. Dark Outer Shockwave (Mroczna fala dymu)
                    smokeParticleSystem.spawn(expX, expY, expZ, 0, 0, 0, size * 19, 1.6, 1, gt);

                    // 4. Spikes (Dokładnie 60 potężnych kolców jak w HTML)
                    for (let i = 0; i < 60; i++) {
                        const speed = size * (12 + Math.random() * 12);
                        const angle = Math.random() * Math.PI * 2;
                        const vx = Math.cos(angle) * speed;
                        const vy = (Math.random() - 0.5) * speed * 0.15;
                        const vz = Math.sin(angle) * speed;

                        fireParticleSystem.spawn(expX, expY, expZ, 
                            vx, vy, vz, 
                            size * (0.4 + Math.random() * 0.4), // Grubości
                            0.3 + Math.random() * 0.2, // Krótki czas
                            4, gt);
                    }
                } else {
                    fireParticleSystem.spawn(expX, expY, expZ, 0, 0, 0, size * 4, 0.15, 5, gt);
                }
            }

            // Opóźnienie wybuchu iskier jak w HTML
            const sparkDelay = isFighter ? 0.02 : 0.1;
            if (phase === 'EXPLODE' && time >= CHARGE_TIME + sparkDelay) {
                phase = 'SPARKS';

                // Dokładnie 4000 iskier jak w Twoim pliku HTML!
                const sparkCount = isFighter ? 20 : 4000;
                for (let i = 0; i < sparkCount; i++) {
                    const speed = size * (isFighter ? (2 + Math.random() * 4) : (4 + Math.random() * 10));
                    
                    const angle = Math.random() * Math.PI * 2;
                    const phi = Math.acos(2 * Math.random() - 1);
                    
                    const vx = Math.sin(phi) * Math.cos(angle) * speed;
                    const vy = Math.cos(phi) * speed;
                    const vz = Math.sin(phi) * Math.sin(angle) * speed;

                    fireParticleSystem.spawn(expX, expY, expZ,
                        vx, vy, vz,
                        size * (isFighter ? 0.08 : (0.06 + Math.random() * 0.1)), 
                        isFighter ? (0.1 + Math.random() * 0.1) : (1.5 + Math.random() * 2.5), 
                        4, gt); 
                }
            }

            if (time > CHARGE_TIME + EXPLOSION_DURATION) {
                dispose();
            }
        }

        function dispose() {
            if (disposed) return;
            disposed = true;
            if (group.parent) group.parent.remove(group);
            if (light.parent) light.parent.remove(light);
        }

        // DODANO: important: true
        return { group, update, dispose, important: true };
    };
}