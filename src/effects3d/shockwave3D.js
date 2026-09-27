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
 *
 * Port WebGPU (zadanie 03): materiał w TSL, 1:1 z dawnym GLSL. Graf budowany RAZ na
 * menedżera, każda fala ma lekki materiał z tymi samymi węzłami (ten sam klucz programu —
 * jeden NodeBuilder i jeden pipeline na wszystkie fale); wartości per fala (`progress`,
 * `uColor`) zostają w `material.uniforms` i trafiają do grafu per obiekt (onObjectUpdate),
 * więc kod aktualizacji niżej się nie zmienia. Odczyt tła po screenUV (v od góry — jak
 * wiersze celu refrakcji w WebGPU); szum i kierunek przesunięcia liczone w UV z osią v
 * od dołu, jak dawne (vScreenPos.xy / w) · 0,5 + 0,5.
 * Zadanie 19 zastąpi falę refrakcją z dema rakiet (zniekształcenia z zadania 12).
 */

import * as THREE from "three/webgpu";
import {
    Fn, abs, clamp, dot, float, fract, max, normalViewGeometry, positionViewDirection, pow, screenUV, sin,
    texture, uniform, vec2, vec4
} from "three/tsl";

// Wartość per fala: węzeł wspólny dla wszystkich materiałów menedżera, wartość
// z material.uniforms[klucz].value rysowanego obiektu.
function perWave(key, init, type) {
    return uniform(init, type).onObjectUpdate(({ material }) => material.uniforms[key].value);
}

const hash = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

function createShockwaveFragment(refractionTexture) {
    const progress = perWave("progress", 0, "float");
    const uColor = perWave("uColor", new THREE.Color(0x55ffff), "color");
    // Węzeł bazowy celu refrakcji z uv-atrapą (bez niej odczyt mnożyłby uv przez
    // macierz tekstury — osobny uniform mat3 na obiekt).
    const refraction = texture(refractionTexture, vec2(0.5));

    return Fn(() => {
        const uvGl = vec2(screenUV.x, float(1.0).sub(screenUV.y)).toVar();

        // Tylko przód (FrontSide) — normalna bez odwracania dla tylnych ścian, jak GLSL.
        const normal = normalViewGeometry;
        const viewDir = positionViewDirection;

        // Efekt Fresnela — krawędź bańki silniej zniekształca. Podstawa potęgi ≥ 0
        // (pow z ujemną podstawą to NaN w WGSL, a |dot| bywa o ULP większy od 1).
        const fresnel = max(float(1.0).sub(abs(dot(normal, viewDir))), 0.0);
        const ring = pow(fresnel, 4.5).toVar();
        const noise = hash(uvGl.mul(22.0)).sub(0.5).mul(0.08);

        // Zniekształcenie maleje w miarę jak bańka się rozszerza
        const strength = float(1.0).sub(progress).mul(0.28);
        const distortion = normal.xy.mul(ring.add(noise)).mul(strength).toVar();

        // GLSL: uv − distortion z osią v od dołu = (x − dx, y + dy) w UV celu (v od góry).
        // Poziom 0 jawnie — cel refrakcji nie ma mipmap.
        const bgColor = texture(refraction, screenUV.add(vec2(distortion.x.negate(), distortion.y)), float(0));

        // Kolorowy tint na krawędzi bańki
        const tintStrength = ring.mul(float(1.0).sub(progress)).mul(0.55);
        const tint = uColor.mul(tintStrength);

        // Cel refrakcji ma format bufora sceny (HalfFloat, core3d.js — wspólny kontekst
        // renderu); na WebGL był RGBA8, więc odczyt obcinamy do [0, 1] jak tamten cel:
        // emitery w fali bez nadmiaru HDR, jak w bazie.
        return vec4(clamp(bgColor.rgb, 0.0, 1.0).add(tint), 1.0);
    })();
}

export class Shockwave3DManager {
    constructor(scene, maxWaves, refractionTarget) {
        this.scene = scene;
        this.waves = [];

        const geo = new THREE.SphereGeometry(1, 28, 28);
        const fragmentNode = createShockwaveFragment(refractionTarget.texture);

        for (let i = 0; i < maxWaves; i++) {
            const mat = new THREE.NodeMaterial();
            mat.name = "shockwave3D";
            // Te same klucze i obiekty `{ value }` co dawny ShaderMaterial.
            mat.uniforms = {
                tDiffuse: { value: refractionTarget.texture },
                progress:  { value: 0.0 },
                uColor:    { value: new THREE.Color(0x55ffff) }
            };
            mat.fragmentNode = fragmentNode;
            mat.transparent = true;
            mat.depthWrite = false;
            mat.depthTest = false;
            mat.side = THREE.FrontSide;
            mat.lights = false;
            mat.fog = false;

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
        // Core3D trzyma scene.matrixWorldAutoUpdate = false i przechodzi graf
        // raz na klatke, na gorze render(). Fale ruszaja sie PO tym momencie
        // (update() leci w srodku render()), wiec odswiezaja swoj wezel same.
        wave.mesh.updateMatrixWorld();
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
            // Patrz spawn(): reczny sync macierzy, bo update() chodzi juz po
            // jedynym obchodzie grafu w Core3D.render().
            wave.mesh.updateMatrixWorld();
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
