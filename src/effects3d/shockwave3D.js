/**
 * shockwave3D.js — Refrakcyjna fala uderzeniowa 3D
 *
 * Implementacja wzorowana na nova.html DistortionManager.
 * Używa SphereGeometry z fresnel shaderem, który próbkuje
 * scenę z refractionTarget (tekstura przechwycona przed renderem bańki).
 *
 * Każda bańka:
 *  - Rozszerza się cubic ease-out przez `life` sekund
 *  - Jest spłaszczona na Y (kształt dysku uderzeniowego)
 *  - Ma magenta/cyan tint na krawędziach (efekt fresnel)
 *  - Może mieć indywidualny kolor (colorHex)
 */

import * as THREE from "three";

export class Shockwave3DManager {
    constructor(scene, maxWaves, refractionTarget) {
        this.scene = scene;
        this.waves = [];

        const geo = new THREE.SphereGeometry(1, 28, 28);

        for (let i = 0; i < maxWaves; i++) {
            const mat = new THREE.ShaderMaterial({
                uniforms: {
                    tDiffuse: { value: refractionTarget.texture },
                    progress:  { value: 0.0 },
                    uColor:    { value: new THREE.Color(0x55ffff) }
                },
                vertexShader: `
                    varying vec4 vScreenPos;
                    varying vec3 vNormal;
                    varying vec3 vViewPosition;

                    void main() {
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_Position     = projectionMatrix * mvPosition;
                        vScreenPos      = gl_Position;
                        vNormal         = normalize(normalMatrix * normal);
                        vViewPosition   = -mvPosition.xyz;
                    }
                `,
                fragmentShader: `
                    uniform sampler2D tDiffuse;
                    uniform float     progress;
                    uniform vec3      uColor;

                    varying vec4 vScreenPos;
                    varying vec3 vNormal;
                    varying vec3 vViewPosition;

                    float hash(vec2 p) {
                        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
                    }

                    void main() {
                        vec2 uv = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;

                        vec3 normal  = normalize(vNormal);
                        vec3 viewDir = normalize(vViewPosition);

                        // Efekt Fresnela — krawędź bańki silniej zniekształca
                        float fresnel  = 1.0 - abs(dot(normal, viewDir));
                        float ring     = pow(fresnel, 4.5);
                        float noise    = (hash(uv * 22.0) - 0.5) * 0.08;

                        // Zniekształcenie maleje w miarę jak bańka się rozszerza
                        float strength = (1.0 - progress) * 0.28;
                        vec2 distortion = normal.xy * (ring + noise) * strength;

                        vec4 bgColor = texture2D(tDiffuse, uv - distortion);

                        // Kolorowy tint na krawędzi bańki
                        float tintStrength = ring * (1.0 - progress) * 0.55;
                        vec3  tint = uColor * tintStrength;

                        gl_FragColor = vec4(bgColor.rgb + tint, 1.0);
                    }
                `,
                transparent: true,
                depthWrite:  false,
                depthTest:   false,
                side:        THREE.FrontSide
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            // Layer 2 = FG pass w Core3D (renderPassFg widzi layer 2)
            mesh.layers.set(2);
            mesh.renderOrder = 900;
            mesh.frustumCulled = false;
            scene.add(mesh);

            this.waves.push({
                mesh,
                active:      false,
                age:         0,
                maxLife:     1.8,
                targetScale: 10000,
                axisScale:   new THREE.Vector3(1, 1, 1)
            });
        }
    }

    /**
     * @param {number} x        World X
     * @param {number} y        World Y (height, zwykle ~0-10)
     * @param {number} z        World Z
     * @param {number} scale    Docelowy promień bańki w jednostkach świata
     * @param {number} life     Czas życia w sekundach
     * @param {number} colorHex Kolor tinta (np. 0x55ffff)
     */
    spawn(x, y, z, scale, life = 1.8, colorHex = 0x55ffff, opts = null) {
        const wave = this.waves.find(w => !w.active);
        if (!wave) return; // wszystkie sloty zajęte

        wave.active      = true;
        wave.age         = 0;
        wave.maxLife     = life;
        wave.targetScale = scale;
        wave.axisScale.set(
            Math.max(0.001, Number(opts?.axisScale?.x) || 1),
            Math.max(0.001, Number(opts?.axisScale?.y) || 1),
            Math.max(0.001, Number(opts?.axisScale?.z) || 1)
        );
        wave.mesh.position.set(x, y, z);
        wave.mesh.scale.set(1, 1, 1);
        wave.mesh.material.uniforms.progress.value = 0;
        wave.mesh.material.uniforms.uColor.value.setHex(colorHex);
        wave.mesh.visible = true;
    }

    update(dt) {
        for (const wave of this.waves) {
            if (!wave.active) continue;

            wave.age += dt;

            if (wave.age >= wave.maxLife) {
                wave.active       = false;
                wave.mesh.visible = false;
                continue;
            }

            const progress = wave.age / wave.maxLife;
            wave.mesh.material.uniforms.progress.value = progress;

            // Cubic ease-out — szybki start, powolne dobieganie do docelowej skali
            const easeOut = 1.0 - Math.pow(1.0 - progress, 3.0);
            const scale   = easeOut * wave.targetScale;

            // Spłaszczenie na Y → kształt dysku tnącego przestrzeń (jak nova.html)
            wave.mesh.scale.set(
                scale * wave.axisScale.x,
                scale * wave.axisScale.y,
                scale * wave.axisScale.z
            );
        }
    }

    hasActive() {
        return this.waves.some(w => w.active);
    }

    hideAll() {
        for (const wave of this.waves) {
            if (wave.active) wave.mesh.visible = false;
        }
    }

    showAll() {
        for (const wave of this.waves) {
            if (wave.active) wave.mesh.visible = true;
        }
    }

    dispose() {
        for (const wave of this.waves) {
            if (wave.mesh.parent) wave.mesh.parent.remove(wave.mesh);
            wave.mesh.geometry.dispose();
            wave.mesh.material.dispose();
        }
        this.waves.length = 0;
    }
}
