import * as THREE from 'three';
import { Core3D } from './core3d.js';

const SHIELD_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Magia dzieje się tutaj - SDF wycina falującą elipsę, a uderzenia wginają ten kształt
const SHIELD_FRAGMENT_SHADER_LEGACY = `
uniform float uTime;
uniform vec3 uBaseColor;
uniform vec3 uHitColor;
uniform float uAlpha;
uniform float uEnergyShot;
uniform float uActivation;
uniform int uIsBreaking;
uniform sampler2D uHexTex;

uniform int uImpactCount;
uniform vec4 uImpacts[8]; // x: angle, y: intensity, z: life, w: deformPower

varying vec2 vUv;
#define PI 3.14159265359

void main() {
    // UV od -1.0 do 1.0
    vec2 p = (vUv - 0.5) * 2.0; 
    float r = length(p);
    float angle = atan(p.y, p.x);

    // Falowanie bazowe (wobble)
    float deform = -(sin(angle * 6.0 + uTime * 3.0) * 0.03 + cos(angle * 4.0 - uTime * 2.0) * 0.03);

    // Animacja włączania tarczy
    if (uActivation < 1.0 && uIsBreaking == 0) {
        deform -= sin(angle * 5.0 + uTime * 20.0) * (1.0 - uActivation) * 0.15;
    }

    float impactHitSum = 0.0;
    float spread = 0.5;

    // Aplikowanie do 8 uderzeń pocisków naraz
    for(int i = 0; i < 8; i++) {
        if(i >= uImpactCount) break;
        vec4 imp = uImpacts[i];
        
        float diff = abs(angle - imp.x);
        if(diff > PI) diff = 2.0 * PI - diff;
        
        if(diff < spread) {
            float wave = (cos(diff / spread * PI) + 1.0) * 0.5;
            // imp.w = deformPower, imp.z = life, imp.y = intensity
            deform += (imp.w * 0.015) * imp.z * wave * imp.y;
            impactHitSum += imp.z * wave * imp.y;
        }
    }

    // Drgania przy niszczeniu tarczy
    if (uIsBreaking == 1) {
        deform += fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453) * 0.04;
    }

    // Promień tarczy z uwzględnieniem deformacji (0.75 daje bufor na wybrzuszenia)
    float boundary = 0.75 - deform;
    float dist = boundary - r;

    if (dist < 0.0) discard; // Jesteśmy poza tarczą

    // Krawędź i poświata
    float edgeGlow = smoothstep(0.0, 0.05, dist) - smoothstep(0.01, 0.15, dist);
    float innerGlow = 1.0 - smoothstep(0.0, 0.4, dist);
    
    // Tekstura heksagonalna (scrolująca się)
    vec2 hexUv = p * clamp(3.0 + uActivation * 2.0, 3.0, 5.0); 
    hexUv.x -= uTime * 0.4;
    hexUv.y -= uTime * 0.2;
    vec4 hexTex = texture2D(uHexTex, fract(hexUv));
    
    // Widoczność heksów tylko tam, gdzie coś się dzieje
    float hexVisibility = clamp(impactHitSum + uEnergyShot + (1.0 - uActivation) + float(uIsBreaking), 0.0, 1.0);
    
    vec3 color = uBaseColor;
    
    // Błysk od trafienia (Additive)
    color = mix(color, uHitColor, clamp(impactHitSum * 1.5, 0.0, 1.0));
    if (uIsBreaking == 1) color = mix(color, vec3(1.0), 0.5); // Biała, mrugająca przy śmierci
    
    float finalAlpha = (edgeGlow * 2.0 + innerGlow * 0.3) * uAlpha;
    finalAlpha += hexTex.r * hexVisibility * 0.6 * uAlpha;

    gl_FragColor = vec4(color, clamp(finalAlpha, 0.0, 1.0));
}
`;

const SHIELD_FRAGMENT_SHADER = `
uniform float uTime;
uniform vec3 uBaseColor;
uniform vec3 uHitColor;
uniform float uAlpha;
uniform float uEnergyShot;
uniform float uActivation;
uniform int uIsBreaking;
uniform sampler2D uHexTex;

uniform int uImpactCount;
uniform vec4 uImpacts[8]; // x: angle, y: intensity, z: life, w: deformPower

varying vec2 vUv;
#define PI 3.14159265359

void main() {
    vec2 p = (vUv - 0.5) * 2.0; 
    float r = length(p);
    float angle = atan(p.y, p.x);

    // Bazowe, bardzo powolne falowanie przestrzeni
    float deform = -(sin(angle * 4.0 + uTime * 2.0) * 0.015 + cos(angle * 3.0 - uTime * 1.5) * 0.015);

    // Animacja włączania
    if (uActivation < 1.0 && uIsBreaking == 0) {
        deform -= sin(angle * 5.0 + uTime * 20.0) * (1.0 - uActivation) * 0.15;
    }

    float impactHitSum = 0.0;
    float spread = 0.5;
    vec2 uvDistortion = vec2(0.0); // Będzie marszczyć heksy!
    float surfaceEnergy = 0.0;     // Energia rozlewająca się po tarczy

    for(int i = 0; i < 8; i++) {
        if(i >= uImpactCount) break;
        vec4 imp = uImpacts[i];
        
        // 1. Reakcja Krawędzi
        float diff = abs(angle - imp.x);
        if(diff > PI) diff = 2.0 * PI - diff;
        
        if(diff < spread) {
            float wave = (cos(diff / spread * PI) + 1.0) * 0.5;
            // deform += (imp.w * 0.012) * imp.z * wave * imp.y;
            impactHitSum += imp.z * wave * imp.y;
        }

        // 2. NOWOŚĆ: Propagacja fal po powierzchni (Ripples)
        // Obliczamy punkt uderzenia na krawędzi
        vec2 impactPoint = vec2(cos(imp.x), sin(imp.x)) * 0.75; 
        float distToImpact = length(p - impactPoint);
        
        // Fala energii, która wędruje od uderzenia w kierunku środka (imp.z to czas życia uderzenia)
        float expandingWave = sin(distToImpact * 15.0 - (1.0 - imp.z) * 20.0);
        // Tłumimy falę, żeby nie szła w nieskończoność
        float waveMask = exp(-distToImpact * 4.0) * imp.z * imp.y; 
        
        surfaceEnergy += max(0.0, expandingWave) * waveMask;
        
        // Zakrzywiamy UV (siatkę heksów) w kierunku uderzenia
        uvDistortion += normalize(p - impactPoint) * expandingWave * waveMask * 0.05;
    }

    if (uIsBreaking == 1) {
        // Efekt Glitch przy niszczeniu
        deform += fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 10.0) * 43758.5453) * 0.06;
    }

    float boundary = 0.75 - deform;
    float dist = boundary - r;

    if (dist < 0.0) discard;

    // NOWOŚĆ: Miękki Fresnel (Złudzenie bańki 3D)
    // Na środku (r=0) fresnel=0, na krawędzi (r=boundary) fresnel=1
    float fresnel = pow(clamp(r / boundary, 0.0, 1.0), 2.5);

    // Krawędź
    float edgeGlow = smoothstep(0.0, 0.03, dist) - smoothstep(0.01, 0.12, dist);
    
    // Tekstura heksagonalna (skalowana, przewijana i zakrzywiana przez uderzenia!)
    vec2 hexUv = (p + uvDistortion) * clamp(3.0 + uActivation * 2.0, 3.0, 5.0); 
    hexUv.x -= uTime * 0.2;
    hexUv.y -= uTime * 0.1;
    vec4 hexTex = texture2D(uHexTex, fract(hexUv));
    
    // Heksy są widoczne na krawędziach (fresnel) ORAZ mocno świecą tam gdzie rozchodzi się energia uderzenia
    float hexVisibility = clamp(fresnel * 0.5 + surfaceEnergy * 2.0 + uEnergyShot + (1.0 - uActivation) + float(uIsBreaking), 0.0, 1.0);
    
    vec3 color = uBaseColor;

    float hitIntensity = clamp(surfaceEnergy * 3.0 + impactHitSum, 0.0, 1.0);
    vec3 hdrHitColor = uHitColor * (2.0 + hitIntensity * 3.0);
    color = mix(color, hdrHitColor, hitIntensity);

    float aberrationStr = (edgeGlow + float(uIsBreaking)) * 0.5;
    vec3 finalColor = color;
    if (aberrationStr > 0.01) {
        finalColor.r *= 1.0 + aberrationStr * 0.5;
        finalColor.b *= 1.0 - aberrationStr * 0.2;
    }

    if (uIsBreaking == 1) {
        finalColor = mix(vec3(4.0, 0.2, 0.2), vec3(3.0), fract(uTime * 30.0));
    }
    
    // Miksujemy alfę: krawędź + bańka + heksy
    float finalAlpha = (edgeGlow * 1.5 + fresnel * 0.2) * uAlpha;
    finalAlpha += hexTex.r * hexVisibility * 0.8 * uAlpha;

    gl_FragColor = vec4(finalColor * 1.2, clamp(finalAlpha, 0.0, 1.0));
}
`;

const state = {
    meshes: new Map(),
    geometry: null,
    hexTexture: null
};

// Generuje podkład heksagonalny w pamięci, by wysłać go do karty graficznej
function generateHexTexture() {
    const scale = 30;
    const tileW = 3 * scale;
    const tileH = Math.round(Math.sqrt(3) * scale); 
    const cvs = document.createElement('canvas');
    cvs.width = Math.ceil(tileW * 2);
    cvs.height = Math.ceil(tileH * 2);
    const c = cvs.getContext('2d');
    c.strokeStyle = '#ffffff';
    c.lineWidth = Math.max(1, scale * 0.15);
    c.beginPath();
    for (let col = -1; col <= 3; col++) {
        for (let row = -1; row <= 3; row++) {
            const xOffset = col * 1.5 * scale;
            const yOffset = row * tileH + (col % 2 === 0 ? 0 : tileH / 2);
            for (let i = 0; i < 6; i++) {
                const angle = 2 * Math.PI / 6 * i;
                const x = xOffset + scale * Math.cos(angle);
                const y = yOffset + (tileH / Math.sqrt(3)) * Math.sin(angle);
                if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
            }
            c.closePath();
        }
    }
    c.stroke();
    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

function hexToRgbVec3(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? new THREE.Vector3(
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255
    ) : new THREE.Vector3(0, 0.66, 1.0);
}

function createShieldMesh(entity) {
    if (!state.geometry) state.geometry = new THREE.PlaneGeometry(1, 1);
    if (!state.hexTexture) state.hexTexture = generateHexTexture();

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uBaseColor: { value: hexToRgbVec3('#00aaff') },
            uHitColor: { value: hexToRgbVec3('#00e5ff') },
            uAlpha: { value: 0.0 },
            uEnergyShot: { value: 0.0 },
            uActivation: { value: 1.0 },
            uIsBreaking: { value: 0 },
            uHexTex: { value: state.hexTexture },
            uImpactCount: { value: 0 },
            uImpacts: { value: Array(8).fill(new THREE.Vector4(0,0,0,0)) }
        },
        vertexShader: SHIELD_VERTEX_SHADER,
        fragmentShader: SHIELD_FRAGMENT_SHADER,
        transparent: true,
        blending: THREE.AdditiveBlending, // Najlepszy efekt dla tarcz
        depthWrite: false
    });

    const mesh = new THREE.Mesh(state.geometry, material);
    mesh.renderOrder = 10; // Rysuj nad statkami
    Core3D.scene.add(mesh);
    state.meshes.set(entity, mesh);
    return mesh;
}

export function updateShields3D(dt, entities, interpPoseOverride = null) {
    if (!Core3D.isInitialized) return;
    const time = performance.now() / 1000;
    
    // Garbage collection dla zniszczonych statków
    const activeEntities = new Set();

    for (const entity of entities) {
        const shield = entity?.shield;
        if (!shield || !shield.max || shield.state === 'off') continue;
        
        let mesh = state.meshes.get(entity);
        if (!mesh) mesh = createShieldMesh(entity);
        activeEntities.add(entity);

        // --- Rozmiar tarczy ---
        let w = entity.w || (entity.radius * 2) || 40;
        let h = entity.h || (entity.radius * 2) || 40;
        if (entity.capitalProfile) {
            const baseR = entity.radius || 20;
            w = Math.max(w, baseR * (entity.capitalProfile.lengthScale || 3.2));
            h = Math.max(h, baseR * (entity.capitalProfile.widthScale || 1.2));
        } else if (entity.fighter || entity.type === 'fighter') {
            w = Math.max(w, h); h = w;
        }
        
        // Powiększamy PlaneGeometry, aby zmieścił całą deformację
        const scaleX = w * 1.5 * 1.35; 
        const scaleY = h * 1.5 * 1.35;
        mesh.scale.set(scaleX, scaleY, 1);

        // --- Pozycja i kąt ---
        let pos = { x: entity.x || entity.pos?.x, y: entity.y || entity.pos?.y };
        let visualAngle = entity.angle || 0;

        // Jeżeli to gracz, używamy interpolacji dla płynności!
        if (interpPoseOverride && entity.isPlayer) {
            pos.x = interpPoseOverride.x;
            pos.y = interpPoseOverride.y;
            visualAngle = interpPoseOverride.angle;
        }

        if (entity.capitalProfile && Number.isFinite(entity.capitalProfile.spriteRotation)) {
            visualAngle += entity.capitalProfile.spriteRotation;
        }

        mesh.position.set(pos.x, -pos.y, 1); // Z=1 nad statkiem
        mesh.rotation.z = -visualAngle;

        // --- Przesyłanie danych do Shadera ---
        const mat = mesh.material;
        mat.uniforms.uTime.value = time;
        
        // Alpha i status
        let baseAlpha = 0.35 + Math.sin(time * 2) * 0.03;
        mat.uniforms.uActivation.value = Math.max(0, Math.min(1, shield.activationProgress || 0));
        mat.uniforms.uAlpha.value = baseAlpha * (shield.currentAlpha || 1);
        mat.uniforms.uIsBreaking.value = shield.state === 'breaking' ? 1 : 0;
        
        if (shield.energyShotTimer > 0) {
            mat.uniforms.uEnergyShot.value = shield.energyShotTimer / (shield.energyShotDuration || 1);
            mat.uniforms.uAlpha.value += mat.uniforms.uEnergyShot.value * 0.4;
        } else {
            mat.uniforms.uEnergyShot.value = 0;
        }

        // Uderzenia (Max 8 dla shadera)
        const impacts = shield.impacts || [];
        const impactCount = Math.min(impacts.length, 8);
        mat.uniforms.uImpactCount.value = impactCount;
        
        for (let i = 0; i < 8; i++) {
            if (i < impactCount) {
                const imp = impacts[i];
                // Wektor: x = angle, y = intensity, z = life, w = deformPower
                const correctedAngle = imp.localAngle - (visualAngle - (entity.angle || 0));
                mat.uniforms.uImpacts.value[i].set(correctedAngle, imp.intensity, imp.life, imp.deformation || 3.0);
            } else {
                mat.uniforms.uImpacts.value[i].set(0,0,0,0);
            }
        }
    }

    // Sprzątanie martwych tarcz (Gdy wybuchnie statek)
    for (const [entity, mesh] of state.meshes) {
        if (!activeEntities.has(entity)) {
            Core3D.scene.remove(mesh);
            state.meshes.delete(entity);
            // Materiał zostaje, bo ThreeJS robi GC, ale możemy wymusić
            mesh.material.dispose();
        }
    }
}
