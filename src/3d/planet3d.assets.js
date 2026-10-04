// Planety, słońce, mgławica i gwiazdy (warstwy 1 / 3 / 5 / 6). Materiały w TSL:
// planet3d.assets.tsl.js (port WebGPU, zadanie 05) — tu tylko obiekty, strojenie i aktualizacja.
import * as THREE from 'three/webgpu';
import { texture, uniform, uniformArray, uv, vec2 } from 'three/tsl';
import { Core3D } from './core3d.js';
import {
    STAR_PARALLAX_LAYERS,
    computeStarParallaxFactor,
    pickStarParallaxLayer,
    starZoomCompensation,
    advanceStarCamera
} from './starParallax.js';
import { resolveRingPlanetWorldRadius } from './ringScale.js';
import { computeHaloRingLayout } from './haloRing/haloRingLayout.js';
import { applySunShadowToBuiltinMaterial } from './sunShadowMask.js';
import { uniformsAdapter } from './tsl/uniformy.js';
import { WARP_STAR_CAMERA } from './warp/stars.js';
import { createSky3D, getSky3D } from './sky3D.js';
import {
    STAR_PLANET_MASK_CAP,
    createStarGeometry,
    createStarMaterial,
    createNebulaMaterial,
    createPlanetSurfaceMaterial,
    createPlanetCloudMaterial,
    createPlanetAtmosphereMaterial,
    createRingAtmosphereMaterial,
    createSunMaterial
} from './planet3d.assets.tsl.js';

window.Dev = window.Dev || {};
const PLANET_SIZE_MULTIPLIER = 4.5;

// Kamery 3D (src/game/game3D.js — sam widok, 2026-09-30): planety zostają na swoich miejscach (tło z paralaksą
// pod płaszczyzną, planety ringów w płaszczyźnie), a kadr liczy się kulą w stożku kamery perspektywy —
// kamera pościgowa patrzy do horyzontu, prostokąt widoku z góry chowałby widoczne planety. Płaska mgławica
// i gwiazdy tła w kamerze 3D ustępują sferze nieba (sky3D.js).
const _bodyFrustum = new THREE.Frustum();
const _bodyFrustumMatrix = new THREE.Matrix4();
const _bodySphere = new THREE.Sphere();
let _bodyFrustumFrame = -1;

function isSphereInFreeCamera(x, y, z, r) {
    const cam = Core3D.cameraPersp;
    if (!cam) return true;
    const frame = Core3D.renderer?.info?.frame ?? 0;
    if (frame !== _bodyFrustumFrame) {
        _bodyFrustumFrame = frame;
        cam.updateMatrixWorld(true);
        _bodyFrustumMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        _bodyFrustum.setFromProjectionMatrix(_bodyFrustumMatrix);
    }
    _bodySphere.center.set(x, y, z);
    _bodySphere.radius = r;
    return _bodyFrustum.intersectsSphere(_bodySphere);
}
// Planety z ringiem „Halo” (src/game/haloRingPlanets.js): rysowane w passie
// ortho przy ringu, w promieniu świata z ringScale.js. Jowisz od Z6 (2026-09-26).
const RING_PLANET_NAMES = new Set(['earth', 'mars', 'jupiter']);
const RING_PLANET_VISUAL_Z = 0;
const SUN_SIZE_MULTIPLIER = 6.0;
// The old tuning expanded the atmosphere shell to 121% of the planet radius.
// At ring scale its transparent sphere edge became a visible dotted arc.
const HALO_DEFAULTS = Object.freeze({ sizeMul: 0.985, coefMul: 1.08, coefAdd: 0.12, powerMul: 1.0, powerAdd: 1.5, sunMul: 1.0 });
const MOON_HALO_DEFAULTS = Object.freeze({ size: 1.075, coef: 0.52, power: 9.5, sunMul: 0.62 });
const SUN_SHADOW_TUNE = Object.freeze({ color: 0xffeedd, intensity: 1.45, mapSize: 4096, near: 1, far: 10000, lightHeight: 120000, offsetMin: 70000, frustumMul: 1.45, frustumPad: 560, frustumMin: 2800, frustumMax: 22000, bias: -0.0003, normalBias: 0.08 });
const MOON_TUNE = Object.freeze({
    orbitRadiusMul: 3.0,
    orbitRadiusMin: 30000,
    orbitPeriodSec: 220,
    spinPeriodSec: 72,
    sizeRatioToParent: 0.24,
    z: -50020,
    colorTex: 'assets/planety/images/moonmap.jpg',
    bumpTex: 'assets/planety/images/moonbump.jpg',
    bumpScale: 0.07
});
// Dekoracyjne księżyce Jowisza. Od Z6 (2026-09-26) Jowisz ma ring „Halo”
// (promień 48 000, ring do ~54 750, port z redą do ~70 tys.): dawne orbity
// 20–48 tys. leżały w planecie i ringu. Orbity = promienie księżyców mapy
// (systemMap.js: Io 60 tys. — pod ringiem, więc 86 tys.; Europa 105,
// Ganimedes 165, Kallisto 250 tys.), okresy wydłużone proporcjonalnie
// (prędkość liniowa jak dawniej). Rozmiar: ułamek promienia planety przy ringu.
const JUPITER_MOONS_TUNE = Object.freeze([
    Object.freeze({ id: 'io', orbitRadius: 86000, orbitPeriodSec: 352, spinPeriodSec: 48, sizeRatioToParent: 0.05, phase: 0.0, colorTex: 'assets/planety/images/jupiterIo.jpg', haloColor: 0xffb16f }),
    Object.freeze({ id: 'europa', orbitRadius: 105000, orbitPeriodSec: 412, spinPeriodSec: 58, sizeRatioToParent: 0.042, phase: 1.4, colorTex: 'assets/planety/images/jupiterEuropa.jpg', haloColor: 0x9fc8ff }),
    Object.freeze({ id: 'ganymede', orbitRadius: 165000, orbitPeriodSec: 669, spinPeriodSec: 74, sizeRatioToParent: 0.06, phase: 2.2, colorTex: 'assets/planety/images/jupiterGanymede.jpg', haloColor: 0xb6c3d6 }),
    Object.freeze({ id: 'callisto', orbitRadius: 250000, orbitPeriodSec: 1016, spinPeriodSec: 92, sizeRatioToParent: 0.055, phase: 3.1, colorTex: 'assets/planety/images/jupiterCallisto.jpg', haloColor: 0x91a7c4 })
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
    texture: 'assets/planety/solar/saturn/rings_alpha.png'
});
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

function enableRingPlanetLayer(object3d) {
    if (!object3d) return;
    if (typeof Core3D.enableRingPlanet3D === 'function') Core3D.enableRingPlanet3D(object3d);
    else enablePlanetLayer(object3d);
}

// Planety/księżyce NIE trafiają do maski okluzji shaftów — screen-space maska
// nie obejmuje okluderów poza kadrem (cień planety znikał przy przybliżeniu,
// a piksel na tarczy samplował własny dysk = przyciemniona dzienna strona).
// Zamiast tego każde ciało zgłasza się co klatkę jako analityczny dysk:
// Core3D.pushShaftDiscWorld(x, y, r) w update().

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

// sunShadowRecv: poświata gaśnie w cieniu z maski Core3D — tylko ciała przy
// ringu (pass ortho, piksel = punkt świata), patrz uSunShadowRecv planety.
// Materiał: graf TSL wspólny dla wszystkich poświat (planet3d.assets.tsl.js),
// wartości per ciało w material.uniforms (obiekty { value }).
function createAtmosphereMaterial(glowColor, sunsetTint, coef, power, sunMul = 1, sunShadowRecv = false) {
    return createPlanetAtmosphereMaterial({
        coef: { value: coef },
        power: { value: power },
        glowColor: { value: glowColor },
        sunsetTint: { value: sunsetTint },
        uSunIntensity: { value: 1.1 * sunMul },
        sunPosition: { value: new THREE.Vector3(0, 0, -50000) },
        uSunShadowRecv: { value: sunShadowRecv ? 1.0 : 0.0 }
    });
}

// Poświata limbu planet przy ringu (Ziemia, Mars) — model atmosfery z tła menu
// (menuBackdrop3D.js: głębokość optyczna wzdłuż promienia przez powłokę
// o wysokości H, gęstość e^(−h/Hs)), przeliczony na kamerę gry: pass ortho
// patrzy pionowo w dół, więc promienie są równoległe, a o poświacie decyduje
// tylko odległość od środka tarczy ρ. Płaski dysk w środku planety (z = 0):
// wewnątrz tarczy przegrywa test głębi z kulą planety, zostaje pierścień za
// limbem, który sam gaśnie do zera na brzegu powłoki (bez twardej krawędzi,
// na której stara powłoka 1,21 R dawała kropkowany łuk). Dawna powłoka
// 1,034 R z maską Fresnela dawała tu ~1% jasności — poświaty nie było widać.
// Shader: buildRingAtmosphereGraph w planet3d.assets.tsl.js.
const RING_ATMOSPHERE_TUNE = Object.freeze({
    earth: Object.freeze({ height: 1250, day: [0.26, 0.5, 1.0], sunset: [1.0, 0.38, 0.12], gain: 0.95 }),
    mars: Object.freeze({ height: 700, day: [0.85, 0.5, 0.3], sunset: [0.35, 0.55, 1.0], gain: 0.55 }),
    // Jowisz: gruba, jasna atmosfera (beż z bursztynem, zachód pomarańczowy)
    jupiter: Object.freeze({ height: 2400, day: [0.72, 0.64, 0.52], sunset: [1.0, 0.55, 0.25], gain: 0.75 })
});

// key: 'earth' | 'mars', planetRadius: promień planety w świecie gry.
// Siatka w jednostkach promienia planety (grupa ma skalę R): dysk o promieniu
// uRa = 1 + H/R. Blend ONE/ONE z alfą = max(rgb) (kanwa premultiplied).
function createRingAtmosphere(key, planetRadius) {
    const tune = RING_ATMOSPHERE_TUNE[key] || RING_ATMOSPHERE_TUNE.earth;
    const R = Math.max(1, Number(planetRadius) || 1);
    const ra = 1 + tune.height / R;
    const material = createRingAtmosphereMaterial({
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uRa: { value: ra },
        uHs: { value: tune.height * 0.22 / R },
        uDayColor: { value: new THREE.Vector3(...tune.day) },
        uSunsetColor: { value: new THREE.Vector3(...tune.sunset) },
        uGain: { value: new THREE.Vector3(1.02, 0.985, 0.933).multiplyScalar(tune.gain) },
        uSunShadowRecv: { value: 1.0 }
    });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(ra, 256), material);
    mesh.name = 'RingPlanetAtmosphere';
    return { mesh, radiusMul: ra };
}

const NebulaSystem = {
    mesh: null, uniforms: null, parallaxFactor: 0.98, baseScale: 800000, aspectRatio: 1.6,
    init: function () {
        if (!Core3D.isInitialized) return;
        const tex = new THREE.TextureLoader().load('assets/nebula.png');
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
        // Węzły za adapterem: uniforms.map.value = tekstura (tło menu ją pożycza),
        // uniforms.warpFactor.value jak dawniej. Tło dostaje smugę cienia (sunShaftBackdrop).
        this.uniforms = uniformsAdapter({ map: texture(tex, uv()), warpFactor: uniform(0.0) });
        const mat = createNebulaMaterial(this.uniforms);
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.baseScale, this.baseScale / this.aspectRatio), mat);
        this.mesh.position.z = -150000; this.mesh.renderOrder = -999;
        
        this.mesh.name = 'Nebula'; // <--- WAŻNE DLA UKRYWANIA MASKI OKLUZJI

        Core3D.scene.add(this.mesh);
        Core3D.enableBackground3D(this.mesh);
    },
    update: function (dt, gameCamera) {
        if (!this.uniforms || !gameCamera || !this.mesh) return;
        const flat = !Core3D.isFreePerspectiveCamera(gameCamera);
        if (this.mesh.visible !== flat) this.mesh.visible = flat;
        if (!flat) return;
        const cx = typeof gameCamera.x === 'number' ? gameCamera.x : 0;
        const cy = typeof gameCamera.y === 'number' ? gameCamera.y : 0;
        const sunX = (window.SUN && window.SUN.x) || 0;
        const sunY = (window.SUN && window.SUN.y) || 0;
        this.mesh.position.x = sunX + (cx - sunX) * this.parallaxFactor;
        this.mesh.position.y = (-sunY) + ((-cy) - (-sunY)) * this.parallaxFactor;
        // Warp (zadanie 22): mgławica bez dawnego rozjaśniania w skoku (uniform warpFactor = 0) —
        // w warpie „Nurt” zgina ją soczewka bańki i szczelin (src/3d/warp/skyBend.js).
    }
};

const StarSystem = {
    mesh: null, uniforms: null, count: 26000, worldScale: 220000, layerZ: -250,
    starCam: { x: 0, y: 0, lx: NaN, ly: NaN },
    init: function () {
        if (!Core3D.isInitialized) return;
        const positions = new Float32Array(this.count * 3); const sizes = new Float32Array(this.count);
        const brights = new Float32Array(this.count); const colors = new Float32Array(this.count * 3);
        const parallaxFactors = new Float32Array(this.count); const layerSizeMuls = new Float32Array(this.count);
        const layerBrightnessMuls = new Float32Array(this.count); const layerStretchMuls = new Float32Array(this.count);
        const tempColor = new THREE.Color();
        for (let i = 0; i < this.count; i++) {
            const layer = pickStarParallaxLayer(Math.random());
            positions[i * 3] = (Math.random() - 0.5) * this.worldScale; positions[i * 3 + 1] = (Math.random() - 0.5) * this.worldScale; positions[i * 3 + 2] = 0;
            sizes[i] = 0.75 + Math.pow(Math.random(), 3.0) * 3.2; brights[i] = 0.34 + Math.random() * 0.56;
            parallaxFactors[i] = computeStarParallaxFactor(layer, Math.random());
            layerSizeMuls[i] = layer.sizeMul;
            layerBrightnessMuls[i] = layer.brightnessMul;
            layerStretchMuls[i] = layer.stretchMul;
            const r = Math.random();
            if (r > 0.82) tempColor.setHex(0x8fb7ff); else if (r > 0.58) tempColor.setHex(0xdbe8ff); else if (r > 0.22) tempColor.setHex(0xffffff); else tempColor.setHex(0xb8d4ff);
            colors[i * 3] = tempColor.r; colors[i * 3 + 1] = tempColor.g; colors[i * 3 + 2] = tempColor.b;
        }
        // WebGPU rysuje punkty po 1 px: gwiazda = kwadrat instancjonowany (kwadrat punktu z GL),
        // atrybuty gwiazd przeplecione w jednym buforze instancji (createStarGeometry).
        const geo = createStarGeometry({
            starPos: positions, size: sizes, brightness: brights, color: colors, parallaxFactor: parallaxFactors,
            layerSizeMul: layerSizeMuls, layerBrightnessMul: layerBrightnessMuls, layerStretchMul: layerStretchMuls
        }, this.count);
        // Węzły za adapterem (src/3d/tsl/uniformy.js): update() pisze .value jak dawniej,
        // planetMasks.value = tablica Vector4 (set w miejscu, pakowana co render).
        this.uniforms = uniformsAdapter({
            pointTexture: texture(this.createStarTexture(), vec2(0.0)), time: uniform(0), cameraOffset: uniform(new THREE.Vector2(0, 0)),
            containerSize: uniform(this.worldScale), perspectiveScale: uniform(800.0), globalBrightness: uniform(1.0),
            warpFactor: uniform(0.0), moveDir: uniform(new THREE.Vector2(0, 1)), stretchStrength: uniform(20.0),
            zoomComp: uniform(1.0),
            exitWhipFactor: uniform(0.0), exitWhipStrength: uniform(1.75),
            viewportSize: uniform(new THREE.Vector2(window.innerWidth || 1, window.innerHeight || 1)),
            thinningStrength: uniform(38.0), baseSizeMul: uniform(1.65),
            planetMasks: uniformArray(Array.from({ length: STAR_PLANET_MASK_CAP }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4')
        });
        const mat = createStarMaterial(this.uniforms);
        this.mesh = new THREE.Mesh(geo, mat); this.mesh.name = 'GameStars'; this.mesh.renderOrder = -1; this.mesh.frustumCulled = false;
        Core3D.scene.add(this.mesh); Core3D.enableBackground3D(this.mesh);
    },
    createStarTexture: function () {
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); grad.addColorStop(0, 'rgba(255, 255, 255, 1)'); grad.addColorStop(0.3, 'rgba(200, 230, 255, 0.7)'); grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(canvas);
    },
    update: function (dt, gameCamera, ship) {
        if (!this.uniforms || !gameCamera) return;
        const flat = !Core3D.isFreePerspectiveCamera(gameCamera);
        if (this.mesh && this.mesh.visible !== flat) this.mesh.visible = flat;
        if (!flat) return;
        const cx = typeof gameCamera.x === 'number' ? gameCamera.x : 0; const cy = typeof gameCamera.y === 'number' ? gameCamera.y : 0;
        this.uniforms.time.value += dt;
        if (this.mesh) this.mesh.position.set(cx, -cy, this.layerZ);
        // Kamera gwiazd: ruch kamery gry podzielony przez kompensację zoomu (przy
        // oddaleniu wzór rośnie z kadrem zamiast gęstnieć). Warp „Nurt” (warpNurt.js)
        // zgłasza w tej klatce limit prędkości wzoru (WARP_STAR_CAMERA.speedCap) — przy
        // prędkości warpa paralaksa to szum.
        const zoomComp = starZoomCompensation(gameCamera.zoom);
        this.uniforms.zoomComp.value = zoomComp;
        const speedCap = Number(WARP_STAR_CAMERA.speedCap) || 0;
        advanceStarCamera(this.starCam, cx, cy, zoomComp, speedCap > 0 ? speedCap * Math.max(0, dt) : 0);
        this.uniforms.cameraOffset.value.set(this.starCam.x, -this.starCam.y);
        this.uniforms.viewportSize.value.set(Core3D.width || window.innerWidth || 1, Core3D.height || window.innerHeight || 1);
        const planetMasks = this.uniforms.planetMasks?.value;
        if (Array.isArray(planetMasks) && planetMasks.length && window.planets) {
            for (let i = 0; i < STAR_PLANET_MASK_CAP; i++) if (planetMasks[i]) planetMasks[i].set(0, 0, 0, 0);
            let writeIdx = 0;
            for (let i = 0; i < window.planets.length && writeIdx < STAR_PLANET_MASK_CAP; i++) {
                const planet = window.planets[i];
                if (planet?.x && planet?.y && planet?.r > 0) {
                    const key = String(planet.id || planet.name || '').toLowerCase();
                    const visualRadius = RING_PLANET_NAMES.has(key)
                        ? resolveRingPlanetWorldRadius(planet)
                        : planet.r * PLANET_SIZE_MULTIPLIER;
                    planetMasks[writeIdx++].set(planet.x, -planet.y, visualRadius * 1.06, 0);
                }
            }
        }
        // Warp (zadanie 22): smugi i front wyjścia liczy warp „Nurt” (src/3d/warp/stars.js —
        // WARP_STARS, pisze je warpNurt.js). Dawne rozciąganie z WebGL (warpFactor, moveDir,
        // bicz przy wyjściu, przygaszanie gwiazd w skoku) usunięte — uniformy zostają w
        // adapterze (narzędzia je znajdują), materiał ich nie czyta.
    }
};

const textureLoader = new THREE.TextureLoader();
const _planetCullCenter = new THREE.Vector3();
const _planetCullEdgeX = new THREE.Vector3();
const _planetCullEdgeY = new THREE.Vector3();
function isCircleVisibleInGameCamera(x, y, radius, cam, viewportWidth, viewportHeight) {
    if (!cam) return false;
    const zoom = Math.max(0.0001, Number(cam.zoom) || 1);
    const halfVpX = Math.max(1, Number(viewportWidth) || 1) * 0.5 / zoom + radius;
    const halfVpY = Math.max(1, Number(viewportHeight) || 1) * 0.5 / zoom + radius;
    return Math.abs(x - (Number(cam.x) || 0)) <= halfVpX &&
        Math.abs(y - (Number(cam.y) || 0)) <= halfVpY;
}
// Czy kula (księżyc, słońce) MOŻE być w kadrze — wyłącznie dla flag warstw
// w Core3D (pomijanie pustych passów planet i halo), niczego nie chowa.
// Zachowawczo: szeroki margines, a w split-screenie zawsze true (kamera persp
// po syncCamera to kamera P2, patrz culling planet niżej).
const BODY_ACTIVITY_NDC_PAD = 0.25;
function isBodyLikelyOnScreen(gameX, gameY, visualZ, worldRadius, anchoredToRing, cam) {
    if (!cam) return true;
    if (Core3D.isFreePerspectiveCamera(cam)) return isSphereInFreeCamera(gameX, -gameY, visualZ, Math.max(1, Number(worldRadius) || 1) * 1.25);
    if (window.splitScreenMode && Core3D.activeCam2) return true;
    const r = Math.max(1, Number(worldRadius) || 1);
    if (anchoredToRing) {
        const zoom = Math.max(0.0001, Number(cam.zoom) || 1);
        return isCircleVisibleInGameCamera(gameX, gameY, r * 1.25 + 160 / zoom, cam,
            window.innerWidth || 1920, window.innerHeight || 1080);
    }
    const camera = Core3D.cameraPersp;
    if (!camera) return true;
    _planetCullCenter.set(gameX, -gameY, visualZ).project(camera);
    _planetCullEdgeX.set(gameX + r, -gameY, visualZ).project(camera);
    _planetCullEdgeY.set(gameX, -gameY + r, visualZ).project(camera);
    const ndcRadiusX = Math.max(0.001, Math.abs(_planetCullEdgeX.x - _planetCullCenter.x));
    const ndcRadiusY = Math.max(0.001, Math.abs(_planetCullEdgeY.y - _planetCullCenter.y));
    const pad = BODY_ACTIVITY_NDC_PAD;
    return !(
        _planetCullCenter.x < (-1 - ndcRadiusX - pad) ||
        _planetCullCenter.x > (1 + ndcRadiusX + pad) ||
        _planetCullCenter.y < (-1 - ndcRadiusY - pad) ||
        _planetCullCenter.y > (1 + ndcRadiusY + pad)
    );
}

// Osiem tekstur planet ma 8192×4096. Wgrywały się przy pierwszym pojawieniu
// planety w kadrze: synchroniczne dekodowanie JPEG + upload + mipmapy w jednej
// klatce (Ziemia: pięć naraz). Teraz dekodowanie idzie poza wątkiem gry
// (img.decode()) zaraz po pobraniu, a upload — w wolnej chwili z kolejki Core3D.
function prewarmLoadedTexture(texture) {
    const img = texture?.image;
    const decoding = (img && typeof img.decode === 'function') ? img.decode() : null;
    if (decoding) decoding.catch(() => {}).then(() => Core3D.queueTextureUpload(texture));
    else Core3D.queueTextureUpload(texture);
}
function loadTex(path) { const tex = textureLoader.load(path, prewarmLoadedTexture); tex.anisotropy = Core3D.getMaxAnisotropy(); return tex; }

class DirectPlanet {
    constructor(data) {
        this.data = data; this.name = (data?.name || data?.id || 'earth').toLowerCase();
        this.isRingAnchored = RING_PLANET_NAMES.has(this.name);
        this._visibilityCulled = false;
        this.mesh = null; this.clouds = null; this.cloudUniforms = null; this.atmosphere = null; this.saturnRing = null;
        this.group = new THREE.Group(); this.group.position.z = -50000; this.basePlanetBloom = 0.0; this.visibleRadiusMul = 1.0;
        this.uniforms = {
            uPlanetBloom: { value: 0.0 }, dayTexture: { value: null }, nightTexture: { value: null }, specularTexture: { value: null },
            normalTexture: { value: null }, sunPosition: { value: new THREE.Vector3(0, 0, -50000) }, hasNightTexture: { value: 0.0 },
            uBrightness: { value: 1.2 }, uAmbient: { value: 0.05 }, uSpecular: { value: 1.2 }, uSunWrap: { value: 0.5 },
            uSunIntensity: { value: 1.0 }, sunsetTint: { value: new THREE.Vector3(1.4, 0.1, 0.1) },
            uHazeStrength: { value: 0.0 }, uHazeColor: { value: new THREE.Vector3(0.55, 0.72, 1.0) }, uHazeBeta: { value: new THREE.Vector3(0.05, 0.10, 0.22) },
            uRingShadowStrength: { value: 0.0 }, uRingShadowRadius: { value: 0.0 }, uRingShadowReach: { value: 1.0 }, uRingShadowCenter: { value: new THREE.Vector2(0, 0) },
            // Maska cieni (sunShadowMask.js) tylko dla ciał przy ringu: leżą w
            // płaszczyźnie gry (pass ortho), więc piksel = ich punkt świata.
            // Planety tła siedzą na z = −50 000 w perspektywie — maska liczona
            // w płaszczyźnie gry trafiałaby w nie obok (własna smuga na tarczy).
            uSunShadowRecv: { value: this.isRingAnchored ? 1.0 : 0.0 }
        };
        // Analityczny cień ringu na tarczy planety (dzienny łuk od nawietrznej,
        // czyli słonecznej, strony) — parametry ustawia init() dla ciał na ringu.
        this._ringShadowRadius = 0;
        this._ringShadowReach = 1;
        this._ringShadowStrength = 0.55;
        this.init();
    }
    // Pozwala ręcznie dostroić pas cienia ringu (promień/zasięg w jednostkach
    // świata, strength 0..1). Wołane też z devtoolsów przy tuningu.
    setRingShadowParams(radius, reach, strength) {
        if (Number.isFinite(Number(radius))) this._ringShadowRadius = Math.max(0, Number(radius));
        if (Number.isFinite(Number(reach))) this._ringShadowReach = Math.max(1, Number(reach));
        if (Number.isFinite(Number(strength))) this._ringShadowStrength = Math.max(0, Math.min(1, Number(strength)));
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

        const dayTex = loadTex(`assets/planety/solar/${name}/${name}_color.jpg`); dayTex.colorSpace = THREE.SRGBColorSpace; this.uniforms.dayTexture.value = dayTex;
        if (name === 'earth') {
            const nightTex = loadTex(`assets/planety/images/earth_nightmap.jpg`); nightTex.colorSpace = THREE.SRGBColorSpace; this.uniforms.nightTexture.value = nightTex;
            this.uniforms.specularTexture.value = loadTex(`assets/planety/images/earth_specularmap.jpg`);
            this.uniforms.normalTexture.value = loadTex(`assets/planety/solar/earth/earth_normal.jpg`);
            this.uniforms.hasNightTexture.value = 1.0;
        } else {
            const empty = new THREE.Texture(); this.uniforms.specularTexture.value = empty; this.uniforms.normalTexture.value = empty; this.uniforms.hasNightTexture.value = 0.0;
        }

        // Graf TSL wspólny dla wszystkich planet (planet3d.assets.tsl.js), wartości i tekstury
        // per planeta w this.uniforms — window.EARTH.uniforms (tło menu, devTools) bez zmian.
        const material = createPlanetSurfaceMaterial(this.uniforms);
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

            const maxAnisotropy = Number(Core3D.getMaxAnisotropy?.()) || 1;
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
            const cloudTex = loadTex(`assets/planety/solar/earth/earth_clouds.jpg`); cloudTex.colorSpace = THREE.SRGBColorSpace;
            this.cloudUniforms = { cloudTexture: { value: cloudTex }, sunPosition: { value: new THREE.Vector3(0, 0, -50000) }, uOpacity: { value: 0.62 }, uHazeStrength: this.uniforms.uHazeStrength, uHazeColor: this.uniforms.uHazeColor, uHazeBeta: this.uniforms.uHazeBeta, uRingShadowStrength: this.uniforms.uRingShadowStrength, uRingShadowRadius: this.uniforms.uRingShadowRadius, uRingShadowReach: this.uniforms.uRingShadowReach, uRingShadowCenter: this.uniforms.uRingShadowCenter, uSunShadowRecv: this.uniforms.uSunShadowRecv };
            // Przezroczyste DoubleSide w jednym rysunku (jak ShaderMaterial), blend normalny.
            const cloudMat = createPlanetCloudMaterial(this.cloudUniforms);
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
        if (name === 'earth') { atmSize = 1.05; atmPower = 9.0; }

        let hazeStrength = 0.0; const hazeColor = new THREE.Vector3(0.55, 0.72, 1.0); const hazeBeta = new THREE.Vector3(0.05, 0.10, 0.22);
        if (name === 'earth') hazeStrength = 1.0;
        if (name === 'venus') { hazeStrength = 0.85; hazeColor.set(1.0, 0.82, 0.5); hazeBeta.set(0.07, 0.11, 0.16); }
        if (name === 'mars') { hazeStrength = 0.32; hazeColor.set(0.9, 0.62, 0.42); hazeBeta.set(0.14, 0.10, 0.07); }
        this.uniforms.uHazeStrength.value = hazeStrength;
        this.uniforms.uHazeColor.value.copy(hazeColor);
        this.uniforms.uHazeBeta.value.copy(hazeBeta);

        atmSize *= HALO_DEFAULTS.sizeMul; atmCoef = atmCoef * HALO_DEFAULTS.coefMul + HALO_DEFAULTS.coefAdd; atmPower = atmPower * HALO_DEFAULTS.powerMul + HALO_DEFAULTS.powerAdd;
        if (this.isRingAnchored) {
            // Ziemia i Mars (pass ortho): poświata limbu z modelu atmosfery, jak w tle menu.
            const ringAtm = createRingAtmosphere(name, resolveRingPlanetWorldRadius(this.data));
            this.atmosphere = ringAtm.mesh;
            atmSize = ringAtm.radiusMul;
        } else {
            const atmMat = createAtmosphereMaterial(atmColor, sunsetTint, atmCoef, atmPower, HALO_DEFAULTS.sunMul, this.isRingAnchored);
            this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(atmSize, 64, 64), atmMat);
        }
        this.group.add(this.atmosphere);
        this.visibleRadiusMul = Math.max(1.0, atmSize, name === 'saturn' ? SATURN_VISUAL_RING.outerRadius : 1.0);

        Core3D.scene.add(this.group);
        if (this.isRingAnchored) {
            // The atmosphere stays with the body in the same orthographic pass.
            // This avoids a perspective halo drifting away from the anchored ring.
            enableRingPlanetLayer(this.group);
            // Pas cienia ringu: środek obwiedni ringu „Halo” (ta sama co
            // dawnego ringu, 41 202–43 752 dla Ziemi) — analityczny pas w
            // shaderze działa zawsze, także przy ringu poza kadrem.
            const ringLayout = computeHaloRingLayout(this.data);
            this._ringShadowRadius = (ringLayout.innerRadius + ringLayout.outerRadius) * 0.5;
            this._ringShadowReach = this._ringShadowRadius * 1.15;
        } else {
            enablePlanetLayer(this.group);
            enablePlanetHaloLayer(this.atmosphere);
        }
        if (name === 'earth') window.EARTH = this;
    }
    update(dt, cam) {
        if (!this.group || !cam) return;

        // Off-screen skip: if planet center is far outside camera viewport,
        // hide the entire group and skip uniform/position/rotation updates.
        // Saves dozens of draw calls + uniform uploads × ~8 planets × every frame.
        const anchoredToRing = this.isRingAnchored;
        const visualZ = anchoredToRing ? RING_PLANET_VISUAL_Z : -50000;
        this.group.position.set(this.data.x, -this.data.y, visualZ);
        const scale = anchoredToRing
            ? resolveRingPlanetWorldRadius(this.data)
            : (this.data.r || 100) * PLANET_SIZE_MULTIPLIER;
        this.group.scale.set(scale, scale, scale);
        // Zgłoszenie tarczy PRZED cullingiem — analityczny cień w shaderze
        // shaftów musi działać także, gdy planeta jest poza kadrem.
        if (typeof Core3D.pushShaftDiscWorld === 'function') Core3D.pushShaftDiscWorld(this.data.x, this.data.y, scale);
        let offScreen = false;
        const renderCamera = anchoredToRing ? Core3D.cameraOrtho : Core3D.cameraPersp;
        if (Core3D.isFreePerspectiveCamera(cam)) {
            offScreen = !isSphereInFreeCamera(this.group.position.x, this.group.position.y, this.group.position.z,
                scale * Math.max(1.0, this.visibleRadiusMul || 1.0) * 1.05);
        } else if (anchoredToRing) {
            // Culling uses the same world-space circle as the orthographic pass.
            // Test both viewports in split-screen; Core3D's shared camera ends a
            // frame on player two, so projecting against it alone can hide a
            // planet that is still visible to player one.
            const worldCullRadius = scale * Math.max(1.0, this.visibleRadiusMul || 1.0);
            const splitScreen = !!(window.splitScreenMode && Core3D.activeCam2);
            const viewportWidth = (window.innerWidth || 1920) / (splitScreen ? 2 : 1);
            const viewportHeight = window.innerHeight || 1080;
            // A visible planet gets a larger keep-alive margin than a hidden
            // one needs to re-enter. This hysteresis absorbs camera shake and
            // prevents Earth from alternating visible/hidden at screen edges.
            const cullMarginPx = this._visibilityCulled ? 24 : 72;
            const primaryCullRadius = worldCullRadius + cullMarginPx /
                Math.max(0.0001, Number(cam.zoom) || 1);
            const visiblePrimary = isCircleVisibleInGameCamera(
                Number(this.data.x) || 0,
                Number(this.data.y) || 0,
                primaryCullRadius,
                cam,
                viewportWidth,
                viewportHeight
            );
            let visibleSecondary = false;
            if (splitScreen) {
                const secondaryCullRadius = worldCullRadius + cullMarginPx /
                    Math.max(0.0001, Number(Core3D.activeCam2.zoom) || 1);
                visibleSecondary = isCircleVisibleInGameCamera(
                    Number(this.data.x) || 0,
                    Number(this.data.y) || 0,
                    secondaryCullRadius,
                    Core3D.activeCam2,
                    viewportWidth,
                    viewportHeight
                );
            }
            offScreen = !visiblePrimary && !visibleSecondary;
        } else if (renderCamera) {
            const worldCullRadius = scale * Math.max(1.0, this.visibleRadiusMul || 1.0);
            _planetCullCenter.set(this.group.position.x, this.group.position.y, this.group.position.z).project(renderCamera);
            _planetCullEdgeX.set(this.group.position.x + worldCullRadius, this.group.position.y, this.group.position.z).project(renderCamera);
            _planetCullEdgeY.set(this.group.position.x, this.group.position.y + worldCullRadius, this.group.position.z).project(renderCamera);
            const ndcRadiusX = Math.max(0.001, Math.abs(_planetCullEdgeX.x - _planetCullCenter.x));
            const ndcRadiusY = Math.max(0.001, Math.abs(_planetCullEdgeY.y - _planetCullCenter.y));
            const ndcPad = this._visibilityCulled ? 0.025 : 0.08;
            offScreen =
                _planetCullCenter.x < (-1 - ndcRadiusX - ndcPad) ||
                _planetCullCenter.x > (1 + ndcRadiusX + ndcPad) ||
                _planetCullCenter.y < (-1 - ndcRadiusY - ndcPad) ||
                _planetCullCenter.y > (1 + ndcRadiusY + ndcPad);
        } else {
            const camZoom = cam.zoom || 1;
            const cullMarginPx = this._visibilityCulled ? 24 : 72;
            const planetRadius = scale * Math.max(1.0, this.visibleRadiusMul || 1.0) +
                cullMarginPx / Math.max(0.0001, Number(camZoom) || 1);
            const halfVpX = (window.innerWidth || 1920) * 0.5 / camZoom + planetRadius;
            const halfVpY = (window.innerHeight || 1080) * 0.5 / camZoom + planetRadius;
            const dx = this.data.x - (cam.x || 0);
            const dy = this.data.y - (cam.y || 0);
            offScreen = Math.abs(dx) > halfVpX || Math.abs(dy) > halfVpY;
        }
        this._visibilityCulled = offScreen;
        if (offScreen) {
            if (this.group.visible) this.group.visible = false;
            return;
        }
        if (!this.group.visible) this.group.visible = true;
        // Ta sama decyzja co chowanie grupy: planeta w kadrze = jej passy mają pracę.
        if (typeof Core3D.markPlanetLayersActive === 'function') Core3D.markPlanetLayersActive(anchoredToRing, true);

        this.uniforms.uPlanetBloom.value = this.basePlanetBloom * ((window.DevVFX && window.DevVFX.planetBloomMultiplier !== undefined) ? window.DevVFX.planetBloomMultiplier : 1.0);
        if (window.SUN) {
            const sunZ = this.group.position.z;
            this.uniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, sunZ);
            if (this.cloudUniforms) this.cloudUniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, sunZ);
            const atmU = this.atmosphere?.material?.uniforms;
            if (atmU?.uSunDir) {
                // poświata limbu (createRingAtmosphere): kierunek planeta → Słońce, w płaszczyźnie
                const dx = window.SUN.x - this.data.x;
                const dy = -(window.SUN.y - this.data.y);
                const len = Math.hypot(dx, dy) || 1;
                atmU.uSunDir.value.set(dx / len, dy / len, 0);
            } else if (atmU?.sunPosition) {
                atmU.sunPosition.value.set(window.SUN.x, -window.SUN.y, sunZ);
            }
        }
        if (this.isRingAnchored && this._ringShadowRadius > 0) {
            // Cień ringu gaśnie razem z wyłączeniem shadow shafts (opcja Off).
            const shaftsOn = !!(Core3D?.perfToggles && Core3D.perfToggles.shadowShafts !== false);
            this.uniforms.uRingShadowStrength.value = shaftsOn ? this._ringShadowStrength : 0.0;
            this.uniforms.uRingShadowRadius.value = this._ringShadowRadius;
            this.uniforms.uRingShadowReach.value = this._ringShadowReach;
            this.uniforms.uRingShadowCenter.value.set(Number(this.data.x) || 0, -(Number(this.data.y) || 0));
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
        const parentKey = String(parentData?.id || parentData?.name || '').toLowerCase();
        this.isRingAnchored = RING_PLANET_NAMES.has(parentKey);
        this.group = new THREE.Group();
        this.group.position.z = this.isRingAnchored
            ? RING_PLANET_VISUAL_Z
            : (Number(this.tune?.z ?? MOON_TUNE.z) || MOON_TUNE.z);
        this.mesh = null;
        this.halo = null;
        const spinPeriodSec = Math.max(1, Number(this.tune?.spinPeriodSec) || MOON_TUNE.spinPeriodSec);
        this.spinSpeed = (Math.PI * 2) / spinPeriodSec;
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
        // Księżyc przy ringu wchodzi co orbitę w cień planety — maska Core3D
        // gasi mu światło bezpośrednie (zaćmienie), otoczenie zostaje.
        if (this.isRingAnchored) applySunShadowToBuiltinMaterial(material, 'direct');
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.group.add(this.mesh);

        const haloColor = new THREE.Color(Number(this.tune?.haloColor) || 0x9ebbe0);
        const glowColor = new THREE.Vector3(haloColor.r, haloColor.g, haloColor.b);
        const sunsetTint = glowColor.clone().multiplyScalar(0.72);
        const haloMaterial = createAtmosphereMaterial(
            glowColor,
            sunsetTint,
            MOON_HALO_DEFAULTS.coef,
            MOON_HALO_DEFAULTS.power,
            MOON_HALO_DEFAULTS.sunMul,
            this.isRingAnchored
        );
        this.halo = new THREE.Mesh(
            new THREE.SphereGeometry(MOON_HALO_DEFAULTS.size, 48, 48),
            haloMaterial
        );
        this.halo.name = `MoonHalo:${String(this.tune?.id || 'moon')}`;
        this.group.add(this.halo);

        Core3D.scene.add(this.group);
        if (this.isRingAnchored) enableRingPlanetLayer(this.group);
        else {
            enablePlanetLayer(this.group);
            enablePlanetHaloLayer(this.halo);
        }
    }
    update(dt, cam) {
        if (!this.group || !this.parentData) return;
        const parentX = Number(this.parentData.x);
        const parentY = Number(this.parentData.y);
        if (!Number.isFinite(parentX) || !Number.isFinite(parentY)) {
            // Bez pozycji nie wiemy, gdzie jest — zachowawczo pass zostaje.
            if (typeof Core3D.markPlanetLayersActive === 'function') Core3D.markPlanetLayersActive(this.isRingAnchored, true);
            return;
        }

        const parentR = this.isRingAnchored
            ? resolveRingPlanetWorldRadius(this.parentData)
            : Math.max(100, Number(this.parentData.r) || 2800);
        const orbitRadiusMin = Math.max(0, Number(this.tune?.orbitRadiusMin) || 0);
        const orbitRadiusAbs = Math.max(0, Number(this.tune?.orbitRadius) || 0);
        const orbitRadiusMul = Math.max(0, Number(this.tune?.orbitRadiusMul) || 0);
        const orbitRadius = Math.max(orbitRadiusAbs, orbitRadiusMin, parentR * orbitRadiusMul);
        const orbitPeriodSec = Math.max(1, Number(this.tune?.orbitPeriodSec) || MOON_TUNE.orbitPeriodSec);
        const orbitSpeed = (Math.PI * 2) / orbitPeriodSec;
        this.orbitAngle = (this.orbitAngle + orbitSpeed * Math.max(0, Number(dt) || 0)) % (Math.PI * 2);

        const mx = parentX + Math.cos(this.orbitAngle) * orbitRadius;
        const my = parentY + Math.sin(this.orbitAngle) * orbitRadius;
        const z = this.isRingAnchored
            ? RING_PLANET_VISUAL_Z
            : (Number(this.tune?.z ?? MOON_TUNE.z) || MOON_TUNE.z);
        this.group.position.set(mx, -my, z);

        if (this.mesh) {
            const sizeRatio = Math.max(0.01, Number(this.tune?.sizeRatioToParent) || MOON_TUNE.sizeRatioToParent);
            const moonR = parentR * sizeRatio;
            const scale = Math.max(900, moonR * (this.isRingAnchored ? 1 : PLANET_SIZE_MULTIPLIER));
            this.mesh.scale.set(scale, scale, scale);
            if (typeof Core3D.pushShaftDiscWorld === 'function') Core3D.pushShaftDiscWorld(mx, my, scale);
            this.mesh.rotation.y = (this.mesh.rotation.y + this.spinSpeed * Math.max(0, Number(dt) || 0)) % (Math.PI * 2);
            if (this.halo) {
                this.halo.scale.set(scale, scale, scale);
                if (window.SUN) {
                    this.halo.material.uniforms.sunPosition.value.set(window.SUN.x, -window.SUN.y, z);
                }
            }
            // Księżyc nie ma własnego cullingu (frustum robi three), więc flagę
            // warstw liczymy osobno — z promieniem poświaty i szerokim marginesem.
            if (typeof Core3D.markPlanetLayersActive === 'function'
                && isBodyLikelyOnScreen(mx, my, z, scale * MOON_HALO_DEFAULTS.size, this.isRingAnchored, cam)) {
                Core3D.markPlanetLayersActive(this.isRingAnchored, true);
            }
        } else if (typeof Core3D.markPlanetLayersActive === 'function') {
            Core3D.markPlanetLayersActive(this.isRingAnchored, true);
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
        // Kula z szumem fbm (HDR do 4,0 — bloom), graf w planet3d.assets.tsl.js.
        const material = createSunMaterial(this.uniforms);
        this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), material);
        this.mesh.name = 'SunMesh'; // <---

        // Dawny sprite blasku (assets/effects/glow.png — pliku nigdy nie było, 404: addytywny sprite
        // bez tekstury nic nie dokładał) usunięty w zadaniu 24 portu; blask słońca = bloom kuli HDR.
        this.group.add(this.mesh);
        Core3D.scene.add(this.group); enablePlanetLayer(this.group);

        this.sunLight = new THREE.DirectionalLight(SUN_SHADOW_TUNE.color, SUN_SHADOW_TUNE.intensity);
        this.sunLight.castShadow = true; this.sunLight.shadow.camera.layers.enableAll(); this.sunLight.layers.enableAll();
        this.sunLight.shadow.mapSize.width = SUN_SHADOW_TUNE.mapSize; this.sunLight.shadow.mapSize.height = SUN_SHADOW_TUNE.mapSize;
        this.sunLight.shadow.bias = SUN_SHADOW_TUNE.bias; this.sunLight.shadow.normalBias = SUN_SHADOW_TUNE.normalBias;
        this.sunLight.shadow.camera.near = SUN_SHADOW_TUNE.near; this.sunLight.shadow.camera.far = SUN_SHADOW_TUNE.far;
        this.sunTarget = new THREE.Object3D(); Core3D.scene.add(this.sunTarget); this.sunLight.target = this.sunTarget;
        Core3D.scene.add(this.sunLight);
        // Mapa cienia per światło (WebGPU): Core3D odświeża ją raz na klatkę.
        Core3D.setSunShadowLight?.(this.sunLight);
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
        // Słońce nie ma cullingu w grze; flaga warstwy planet z promieniem poświaty bloomu
        // (1,3× promienia — margines dawnego sprite'a blasku 2,6× skali), bez halo.
        if (typeof Core3D.markPlanetLayersActive === 'function'
            && isBodyLikelyOnScreen(this.data.x, this.data.y, -60000, scale * 1.3, false, cam)) {
            Core3D.markPlanetLayersActive(false, false);
        }
        
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
        if (this.sunLight && Core3D._sunShadowLight === this.sunLight) Core3D.setSunShadowLight?.(null);
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
    createSky3D(Core3D.scene, NebulaSystem.uniforms?.map?.value || null);
    if (!Core3D.__sky3DWarm) {
      Core3D.__sky3DWarm = true;
      Core3D.warmup?.add({ name: 'kamery 3D: niebo', objects: () => getSky3D()?.mesh || null, layer: 1, phase: 'loading' });
    }
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
    if (typeof Core3D.beginShaftDiscFrame === 'function') Core3D.beginShaftDiscFrame();
    // Flagi warstw planet/halo/ring-planet: każde ciało w kadrze zapala swoje
    // (Core3D pomija potem puste passy — patrz layerActivity).
    if (typeof Core3D.beginPlanetLayerFrame === 'function') Core3D.beginPlanetLayerFrame();
    NebulaSystem.update(dt, cam); StarSystem.update(dt, cam, window.ship);
    if (window._entities) window._entities.forEach(ent => { if (ent.update) ent.update(dt, cam); });
};
window.drawPlanets3D = function (ctx, cam) { };
window.worldToScreen = function (x, y, cam) {
    if (!cam) return { x: 0, y: 0 };
    return { x: (x - cam.x) * cam.zoom + window.innerWidth / 2, y: (y - cam.y) * cam.zoom + window.innerHeight / 2 };
};
