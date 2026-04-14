import * as THREE from "three";

const noiseChunk = `
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

export class Shockwave3DManager {
    constructor(scene, maxWaves, renderTarget) {
        this.waves = [];
        this.renderTarget = renderTarget;
        
        const geo = new THREE.SphereGeometry(1, 32, 32);
        
        for(let i = 0; i < maxWaves; i++) {
            const mat = new THREE.ShaderMaterial({
                uniforms: { 
                    tDiffuse: { value: renderTarget.texture }, 
                    progress: { value: 0.0 },
                    tintColor: { value: new THREE.Color(0x55aaff) }
                },
                vertexShader: `
                    varying vec4 vScreenPos; 
                    varying vec3 vNormal; 
                    varying vec3 vViewPosition;
                    void main() {
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_Position = projectionMatrix * mvPosition;
                        vScreenPos = gl_Position;
                        vNormal = normalize(normalMatrix * normal);
                        vViewPosition = -mvPosition.xyz;
                    }
                `,
                fragmentShader: `
                    uniform sampler2D tDiffuse; 
                    uniform float progress;
                    uniform vec3 tintColor;
                    
                    varying vec4 vScreenPos; 
                    varying vec3 vNormal; 
                    varying vec3 vViewPosition;
                    
                    ${noiseChunk}

                    void main() {
                        vec2 uv = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;
                        vec3 normal = normalize(vNormal);
                        vec3 viewDir = normalize(vViewPosition);

                        float fresnel = 1.0 - abs(dot(normal, viewDir));
                        float ring = pow(fresnel, 5.0);
                        float noise = (hash(uv * 20.0) - 0.5) * 0.1;
                        
                        // Siła zniekształcenia maleje z czasem
                        float strength = (1.0 - progress) * 0.3;

                        vec2 distortion = normal.xy * (ring + noise) * strength;
                        vec4 bgColor = texture2D(tDiffuse, uv - distortion);
                        
                        vec3 tint = tintColor * ring * (1.0 - progress) * 0.25;

                        gl_FragColor = vec4(bgColor.rgb + tint, 1.0);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.NormalBlending
            });
            
            const mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            // Rysujemy po statkach, ale przed postprocesem
            mesh.renderOrder = 900; 
            scene.add(mesh);
            
            this.waves.push({ mesh, active: false, age: 0, maxLife: 1.5, targetScale: 1000 });
        }
    }
    
    spawn(x, y, z, maxScale, life, colorHex = 0x55aaff) {
        const wave = this.waves.find(w => !w.active);
        if (!wave) return;
        
        wave.active = true;
        wave.age = 0;
        wave.maxLife = life;
        wave.targetScale = maxScale;
        
        wave.mesh.position.set(x, y, z);
        wave.mesh.scale.set(1, 1, 1);
        wave.mesh.material.uniforms.progress.value = 0;
        wave.mesh.material.uniforms.tintColor.value.setHex(colorHex);
        wave.mesh.visible = true;
    }
    
    update(dt) {
        for (let wave of this.waves) {
            if (!wave.active) continue;
            
            wave.age += dt;
            if (wave.age >= wave.maxLife) {
                wave.active = false;
                wave.mesh.visible = false;
                continue;
            }
            
            const progress = wave.age / wave.maxLife;
            // Bardzo szybki, agresywny rozrost na początku
            const easeOut = 1.0 - Math.pow(1.0 - progress, 4.0);
            const scale = easeOut * wave.targetScale;
            
            wave.mesh.scale.set(scale, scale, scale);
            wave.mesh.material.uniforms.progress.value = progress;
        }
    }
    
    hasActive() {
        return this.waves.some(w => w.active);
    }
    
    hideAll() {
        for (let wave of this.waves) if (wave.active) wave.mesh.visible = false;
    }
    
    showAll() {
        for (let wave of this.waves) if (wave.active) wave.mesh.visible = true;
    }
}