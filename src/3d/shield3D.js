import * as THREE from 'three';
import { Core3D } from './core3d.js';

const SHIELD_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Shield SDF + ripple deformation logic.
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

    // Shield activation animation
    if (uActivation < 1.0 && uIsBreaking == 0) {
        deform -= sin(angle * 5.0 + uTime * 20.0) * (1.0 - uActivation) * 0.15;
    }

    float impactHitSum = 0.0;
    float spread = 0.5;

    // Apply up to 8 projectile impacts
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

    // Effective shield radius with deformation margin
    float boundary = 0.75 - deform;
    float dist = boundary - r;

    if (dist < 0.0) discard; // Outside shield

    // Edge and glow
    float edgeGlow = smoothstep(0.0, 0.05, dist) - smoothstep(0.01, 0.15, dist);
    float innerGlow = 1.0 - smoothstep(0.0, 0.4, dist);
    
    // Hex texture (scrolling)
    vec2 hexUv = p * clamp(3.0 + uActivation * 2.0, 3.0, 5.0); 
    hexUv.x -= uTime * 0.4;
    hexUv.y -= uTime * 0.2;
    vec4 hexTex = texture2D(uHexTex, fract(hexUv));
    
    // Hex visibility only where effects are active
    float hexVisibility = clamp(impactHitSum + uEnergyShot + (1.0 - uActivation) + float(uIsBreaking), 0.0, 1.0);
    
    vec3 color = uBaseColor;
    
    // Additive hit flash
    color = mix(color, uHitColor, clamp(impactHitSum * 1.5, 0.0, 1.0));
    if (uIsBreaking == 1) color = mix(color, vec3(1.0), 0.5); // White blink on break
    
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

    // Activation animation
    if (uActivation < 1.0 && uIsBreaking == 0) {
        deform -= sin(angle * 5.0 + uTime * 20.0) * (1.0 - uActivation) * 0.15;
    }

    float impactHitSum = 0.0;
    float spread = 0.5;
    vec2 uvDistortion = vec2(0.0); // Distorts hex UVs
    float surfaceEnergy = 0.0;     // Energy propagating over shield surface

    for(int i = 0; i < 8; i++) {
        if(i >= uImpactCount) break;
        vec4 imp = uImpacts[i];
        
        // 1. Edge response
        float diff = abs(angle - imp.x);
        if(diff > PI) diff = 2.0 * PI - diff;
        
        if(diff < spread) {
            float wave = (cos(diff / spread * PI) + 1.0) * 0.5;
            // deform += (imp.w * 0.012) * imp.z * wave * imp.y;
            impactHitSum += imp.z * wave * imp.y;
        }

        // 2. Surface ripple propagation
        // Compute impact point on boundary
        vec2 impactPoint = vec2(cos(imp.x), sin(imp.x)) * 0.75; 
        float distToImpact = length(p - impactPoint);
        
        // Energy wave traveling from impact point toward center (imp.z = impact life)
        float expandingWave = sin(distToImpact * 15.0 - (1.0 - imp.z) * 20.0);
        // Dampen wave so it does not propagate forever
        float waveMask = exp(-distToImpact * 4.0) * imp.z * imp.y; 
        
        surfaceEnergy += max(0.0, expandingWave) * waveMask;
        
        // Distort UVs (hex grid) in impact direction
        uvDistortion += normalize(p - impactPoint) * expandingWave * waveMask * 0.05;
    }

    if (uIsBreaking == 1) {
        // Efekt Glitch przy niszczeniu
        deform += fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 10.0) * 43758.5453) * 0.06;
    }

    float boundary = 0.75 - deform;
    float dist = boundary - r;

    if (dist < 0.0) discard;

    // Soft Fresnel for pseudo-3D bubble look
    // Center (r=0) -> fresnel=0, edge (r=boundary) -> fresnel=1
    float fresnel = pow(clamp(r / boundary, 0.0, 1.0), 2.5);

    // Edge
    float edgeGlow = smoothstep(0.0, 0.03, dist) - smoothstep(0.01, 0.12, dist);
    
    // Tekstura heksagonalna (skalowana, przewijana i zakrzywiana przez uderzenia!)
    vec2 hexUv = (p + uvDistortion) * clamp(3.0 + uActivation * 2.0, 3.0, 5.0); 
    hexUv.x -= uTime * 0.2;
    hexUv.y -= uTime * 0.1;
    vec4 hexTex = texture2D(uHexTex, fract(hexUv));
    
    // Hexes are visible on edges (fresnel) and strongly lit by traveling impact energy
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
    
    // Final alpha mix: edge + bubble + hexes
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

// Generate in-memory hex base texture and upload to GPU
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
    
    // Garbage collect destroyed ship shields
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
        
        // Expand PlaneGeometry to fit full deformation envelope
        const scaleX = w * 1.5 * 1.35; 
        const scaleY = h * 1.5 * 1.35;
        mesh.scale.set(scaleX, scaleY, 1);

        // --- Position and angle ---
        let pos = { x: entity.x || entity.pos?.x, y: entity.y || entity.pos?.y };
        let visualAngle = entity.angle || 0;

        // If player entity, use interpolation for smoothness
        if (interpPoseOverride && entity.isPlayer) {
            pos.x = interpPoseOverride.x;
            pos.y = interpPoseOverride.y;
            visualAngle = interpPoseOverride.angle;
        }

        const profile = entity.capitalProfile;
        if (profile) {
            if (Number.isFinite(profile.spriteRotation)) {
                visualAngle += profile.spriteRotation;
            }
            if (Number.isFinite(profile.shieldRotation)) {
                visualAngle += profile.shieldRotation;
            }
        }

        mesh.position.set(pos.x, -pos.y, 1); // Z=1 nad statkiem
        mesh.rotation.z = -visualAngle;

        // --- Upload data to shader ---
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
                // Add visualAngle to compensate mesh rotation in WebGL.
                // This maps impact angle to correct local shield UV coordinates.
                const correctedAngle = imp.localAngle + visualAngle; 
                
                mat.uniforms.uImpacts.value[i].set(correctedAngle, imp.intensity, imp.life, imp.deformation || 3.0);
            } else {
                mat.uniforms.uImpacts.value[i].set(0,0,0,0);
            }
        }
    }

    // Cleanup dead shields (ship destroyed)
    for (const [entity, mesh] of state.meshes) {
        if (!activeEntities.has(entity)) {
            Core3D.scene.remove(mesh);
            state.meshes.delete(entity);
            // Material is usually GCed by Three.js; dispose explicitly anyway
            mesh.material.dispose();
        }
    }
}
