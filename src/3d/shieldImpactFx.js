// ============================================================
// Shield Impact FX — wstęgowe cząsteczki trafień w tarczę.
//
// Port prototypu `shieldhitgpu.html` (GPGPU Niagara Ribbons) na warunki gry:
// tam był JEDEN wybuch pod myszką i stała siatka 64×2048 liczona co klatkę,
// tu w bitwie flotowej leci kilkadziesiąt trafień naraz w różne statki, więc
// symulacja feedbackowa (ping-pong render targety + curl noise) zamieniona
// jest na **analityczny tor lotu**: pozycja cząstki w chwili t wynika wprost
// z (origin, v0, drag, wobble), bez żadnego stanu na GPU.
//
// Konsekwencje tej zamiany — wszystkie na plus w tym silniku:
//  • zero passów compute i zero render targetów (pipeline i tak jest związany
//    submisją, patrz ortho-drawcalls),
//  • ogon = ten sam wzór dla t-s, więc wstęga jest dokładna i nie migocze,
//  • instanceCount schodzi do 0, gdy nic nie leci — efekt kosztuje wtedy nic,
//  • LOD: liczba cząstek z rozmiaru tarczy na ekranie, długość ogona z zoomu.
//
// Rysowanie: jedna siatka instancjonowana (1 draw call) na warstwie tarcz.
// Jedna instancja = jedna wstęga (RIBBON_SEGMENTS quadów), billboard w płaszczyźnie
// XY świata 3D — tej samej, w której leżą kopuły tarcz (y3d = -yGry).
// ============================================================
import * as THREE from 'three';
import { Core3D } from './core3d.js';

// Wstęga: 16 quadów = 17 przekrojów = 34 wierzchołki, 96 indeksów.
// Indeksy idą segment po segmencie, więc drawRange ucina ogon od tyłu (LOD).
const RIBBON_SEGMENTS = 16;
const MAX_PARTICLES = 3000;

// Klasy trafień — punkt 1:1 z suwakami prototypu (PARTICLES PER HIT /
// PARTICLE LIFETIME / TRAIL LENGTH), przeliczone na cztery przypadki gry.
// `speed`, `width` i `wobble` są w jednostkach promienia tarczy (R), więc
// myśliwiec dostaje mikro-pryśnięcie, a capital pełny wachlarz.
const PRESETS = {
    // 2) Broń BD (ciws / flak / laser PD): mało, krótko żyjące, krótkie.
    pd: {
        count: [5, 9],
        life: [0.10, 0.22],
        speed: [1.05, 2.10],
        trailFactor: 0.34,
        width: 0.020,
        spread: 1.05,
        wobble: 0.05,
        mix: [0.0, 0.72, 1.0],   // progi kumulacyjne: wstęga | iskra | łuk
        tangential: false,
        // Bańka: mały rozbłysk w miejscu trafienia, w promieniach tarczy (R).
        flashRadius: 0.15, flashLife: 0.11, flashPower: 0.85, haze: 0
    },
    // 3) Broń główna: średnio cząstek, średnio życia, średnie.
    main: {
        count: [22, 34],
        life: [0.26, 0.52],
        speed: [1.15, 2.45],
        trailFactor: 0.50,
        width: 0.040,
        spread: 1.15,
        wobble: 0.10,
        mix: [0.45, 0.80, 1.0],
        tangential: false,
        flashRadius: 0.30, flashLife: 0.20, flashPower: 1.0, haze: 0
    },
    // 4) Broń special: dużo, długo żyjące, długie.
    special: {
        count: [80, 140],
        life: [0.65, 1.35],
        speed: [1.30, 3.00],
        trailFactor: 0.62,
        width: 0.055,
        spread: 1.30,
        wobble: 0.16,
        mix: [0.56, 0.80, 1.0],
        tangential: false,
        // Haze > 0 tylko dla ciężkich klas: budżet zrodel jest globalny (24)
        // i dzielony z eksplozjami — PD nie ma prawa go zjadać.
        flashRadius: 0.52, flashLife: 0.34, flashPower: 1.35, haze: 1.0
    },
    // 1) Tarcza o tarczę: wyrzut na boki, długie wstęgi.
    shield: {
        count: [55, 105],
        life: [0.50, 1.05],
        speed: [1.55, 3.20],
        trailFactor: 0.70,
        width: 0.050,
        spread: 0.48,            // wąski wachlarz — plazma tryska stycznie
        wobble: 0.20,
        mix: [0.66, 0.86, 1.0],
        tangential: true,
        flashRadius: 0.42, flashLife: 0.28, flashPower: 1.15, haze: 0.75
    }
};

const DEFAULT_COLOR = new THREE.Color('#5992f7');

const VERTEX_SHADER = /* glsl */`
uniform float uTime;
uniform float uTrailScale;    // LOD: rozciągnięcie kroku, gdy rysujemy mniej segmentów
uniform float uMinHalfWidth;  // podłoga grubości w jednostkach świata (~2 px)

attribute vec3  iOrigin;
attribute vec3  iVel;
attribute float iBirth;
attribute float iLife;
attribute vec4  iShape;   // x=typ, y=półgrubość, z=rozpiętość ogona [s], w=seed
attribute vec2  iWobble;  // x=amplituda, y=częstotliwość
attribute vec3  iColor;

varying vec3  vColor;
varying float vAlpha;
varying float vSide;

// Opór ośrodka per typ: wstęga leci daleko, iskra hamuje szybko,
// łuk praktycznie stoi przy powierzchni tarczy.
float dragFor(float t) {
    return t < 0.5 ? 2.6 : (t < 1.5 ? 5.2 : 8.5);
}

float hash11(float p) {
    return fract(sin(p * 127.1) * 43758.5453);
}

// Analityczny tor: całka z v0*exp(-k*t) + poprzeczne falowanie.
vec3 samplePos(float t, float k, vec2 rightDir, float seed) {
    t = max(t, 0.0);
    vec3 p = iOrigin + iVel * ((1.0 - exp(-k * t)) / k);
    float phase = seed * 6.2831853;
    // Falowanie narasta od zera — wstęga wychodzi z tarczy prosto, dopiero
    // potem zaczyna wić się jak w prototypie (curl noise).
    float env = 1.0 - exp(-t * 6.0);
    float w = sin(iWobble.y * t + phase) * 0.68
            + sin(iWobble.y * 0.43 * t + phase * 2.7) * 0.32;
    p.xy += rightDir * (w * iWobble.x * env);
    return p;
}

void main() {
    float seg  = position.x;   // 0 = głowa, 1 = koniec ogona
    float side = position.y;   // -1 / +1

    vColor = vec3(0.0);
    vAlpha = 0.0;
    vSide  = side;

    float life  = max(iLife, 1e-3);
    float tHead = uTime - iBirth;
    if (tHead < 0.0 || tHead > life) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }

    float typeId = iShape.x;
    float seed   = iShape.w;
    float k      = dragFor(typeId);

    float speed2 = length(iVel.xy);
    vec2 fwd  = speed2 > 1e-4 ? iVel.xy / speed2 : vec2(1.0, 0.0);
    vec2 rightDir = vec2(-fwd.y, fwd.x);

    // uTrailScale = RIBBON_SEGMENTS / rysowane segmenty. Przy LOD drawRange
    // ucina indeksy od końca wstęgi, a to przeskalowanie rozciąga pozostałe
    // przekroje na całą długość ogona: kształt efektu nie zmienia się wraz
    // z oddaleniem, spada wyłącznie koszt wierzchołków.
    float u = clamp(seg * uTrailScale, 0.0, 1.0);   // 0 = głowa, 1 = koniec ogona
    float span = iShape.z;
    float dtSeg = span * uTrailScale / ${RIBBON_SEGMENTS}.0;
    vec3 pA = samplePos(tHead - u * span, k, rightDir, seed);
    vec3 pB = samplePos(tHead - u * span - dtSeg, k, rightDir, seed);

    vec2 tang = pA.xy - pB.xy;
    float tl = length(tang);
    vec2 dir = tl > 1e-5 ? tang / tl : fwd;
    vec2 nrm = vec2(-dir.y, dir.x);

    float ageHead = tHead / life;
    float taper   = pow(max(0.0, 1.0 - u), 0.6);
    float nose    = 0.65 + 0.35 * smoothstep(0.0, 0.07, u);
    float lifeFade = pow(max(0.0, 1.0 - ageHead), 1.25);
    // Podłoga grubości wchodzi PRZED zwężeniami: przy dalekim zoomie wstęga
    // schodzi poniżej piksela i zaczyna stroboskopować, ale ogon nadal ma się
    // zwężać do zera, a nie zamieniać w równy pasek.
    float halfW = max(iShape.y, uMinHalfWidth) * taper * nose * lifeFade;

    vAlpha = pow(max(0.0, 1.0 - ageHead), 1.8)
           * smoothstep(0.0, 0.04, tHead)
           * mix(1.0, 0.35, u);

    vec3 white = vec3(1.0);
    if (typeId < 0.5) {
        // MACKI — grube wstęgi, głowa rozbielona, ogon w kolorze tarczy.
        vColor = mix(mix(iColor, white, 0.70) * 3.0, iColor * 1.25, clamp(u * 1.15, 0.0, 1.0));
    } else if (typeId < 1.5) {
        // ISKRY — cienkie, prawie białe, gasnące w barwę tarczy.
        vColor = mix(mix(iColor, white, 0.88) * 4.6, iColor * 0.85, clamp(u * 1.6, 0.0, 1.0));
        vAlpha *= 0.85;
    } else {
        // WYŁADOWANIA — migotanie i poszarpana grubość wzdłuż ogona.
        vColor = mix(iColor, white, 0.82) * 6.0;
        vAlpha *= step(0.14, fract(tHead * 32.0 + seed * 91.0)) * 1.6;
        halfW  *= 0.35 + 0.65 * hash11(u * 43.0 + seed * 77.0);
    }

    // pA jest w układzie LOKALNYM siatki (patrz frameOrigin w JS) — duża
    // translacja świata siedzi w modelViewMatrix, policzona na CPU w float64.
    vec3 local = vec3(pA.xy + nrm * (halfW * side), pA.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */`
varying vec3  vColor;
varying float vAlpha;
varying float vSide;

void main() {
    if (vAlpha <= 0.002) discard;
    float e = 1.0 - vSide * vSide;
    if (e <= 0.0) discard;
    gl_FragColor = vec4(vColor, pow(e, 1.3) * vAlpha);
}
`;

// ── Bańka: rozbłysk w miejscu trafienia ─────────────────────────────────────
// „Mały wybuch" w kolorze tarczy: gorące jądro + rozchodząca się powłoka.
// Kamera jest ortho z góry, więc quad leży płasko w XY — żadnego billboardowania.
const FLASH_VERTEX = /* glsl */`
uniform float uTime;

attribute vec3  fOrigin;
attribute vec4  fParams;   // x=birth, y=life, z=promień, w=moc
attribute vec3  fColor;

varying vec2  vP;
varying vec3  vFlashColor;
varying float vAge;
varying float vPower;

void main() {
    float life = max(fParams.y, 1e-3);
    float age = (uTime - fParams.x) / life;

    vP = position.xy * 2.0;
    vFlashColor = fColor;
    vAge = age;
    vPower = fParams.w;

    if (age < 0.0 || age > 1.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }

    // Bańka wyskakuje i zwalnia — sqrt daje mocne pierwsze klatki.
    float r = fParams.z * (0.42 + 0.58 * sqrt(age));
    vec3 local = fOrigin + vec3(position.xy * (r * 2.0), 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
}
`;

const FLASH_FRAGMENT = /* glsl */`
varying vec2  vP;
varying vec3  vFlashColor;
varying float vAge;
varying float vPower;

void main() {
    if (vAge < 0.0 || vAge > 1.0) discard;
    float d = length(vP);
    if (d > 1.0) discard;

    // Jądro gaśnie szybciej niż powłoka — po rozbłysku zostaje sam pierścień.
    float core = exp(-d * d * 7.0) * pow(1.0 - vAge, 3.0);

    float shellPos = mix(0.12, 0.90, sqrt(vAge));
    float shellW   = mix(0.40, 0.10, vAge);
    float shellD   = (d - shellPos) / shellW;
    float shell    = exp(-shellD * shellD) * pow(1.0 - vAge, 1.5) * 0.75;

    // Jądro rozbielone, powłoka czysto w barwie tarczy.
    vec3 col = mix(vFlashColor, vec3(1.0), 0.62) * (core * 5.0)
             + vFlashColor * (shell * 2.6);

    float a = clamp((core + shell) * vPower, 0.0, 1.0);
    if (a <= 0.002) discard;
    gl_FragColor = vec4(col, a);
}
`;

const FLASH_MAX = 192;
const HAZE_MAX = 4;

const RIBBON_ATTRS = ['iOrigin', 'iVel', 'iBirth', 'iLife', 'iShape', 'iWobble', 'iColor'];
const FLASH_ATTRS = ['fOrigin', 'fParams', 'fColor'];

let root = null;
let mesh = null;
let geometry = null;
let material = null;
let flashMesh = null;
let flashGeometry = null;
let flashMaterial = null;

let iOrigin, iVel, iBirth, iLife, iShape, iWobble, iColor;
let fOrigin, fParams, fColor;
let deathTimes;
let flashDeath;

let idx = 0;
let highWater = 0;
let liveUntil = -Infinity;
let dirtyLo = -1;
let dirtyHi = -1;
let isDirty = false;

let flashIdx = 0;
let flashHighWater = 0;
let flashLiveUntil = -Infinity;
let flashDirtyLo = -1;
let flashDirtyHi = -1;
let flashDirty = false;

// Zaburzenia powietrza dla ciężkich klas. Budżet źródeł w Core3D jest globalny
// (24) i dzielony z eksplozjami, więc tarcze biorą najwyżej HAZE_MAX naraz.
const hazePulses = [];

// Układ lokalny siatki. Świat ma 12 mln jednostek (patrz world-scale), a
// atrybuty są float32 — trzymanie tam współrzędnych świata dałoby ulp ~1 j.
// i widoczne drganie wstęg przy bliskim zoomie. Cząstki zapisujemy więc
// względem frameOrigin, a wielką translację niesie mesh.position, którą
// three przelicza do modelViewMatrix na CPU (float64).
let frameOx = 0;
let frameOy = 0;
const REBASE_DISTANCE = 200000;

function buildBaseGeometry() {
    const crossSections = RIBBON_SEGMENTS + 1;
    const positions = new Float32Array(crossSections * 2 * 3);
    for (let i = 0; i < crossSections; i++) {
        const seg = i / RIBBON_SEGMENTS;
        positions[(i * 2) * 3] = seg;
        positions[(i * 2) * 3 + 1] = -1;
        positions[(i * 2 + 1) * 3] = seg;
        positions[(i * 2 + 1) * 3 + 1] = 1;
    }
    // Indeksy segment po segmencie — drawRange ucina ogon, a nie losowe quady.
    const indices = new Uint16Array(RIBBON_SEGMENTS * 6);
    for (let s = 0; s < RIBBON_SEGMENTS; s++) {
        const a = s * 2, b = a + 1, c = a + 2, d = a + 3;
        indices.set([a, b, c, b, d, c], s * 6);
    }
    return { positions, indices };
}

function markDirty(slot) {
    if (dirtyLo < 0 || slot < dirtyLo) dirtyLo = slot;
    if (slot > dirtyHi) dirtyHi = slot;
    isDirty = true;
}

function markFlashDirty(slot) {
    if (flashDirtyLo < 0 || slot < flashDirtyLo) flashDirtyLo = slot;
    if (slot > flashDirtyHi) flashDirtyHi = slot;
    flashDirty = true;
}

// Wgrywa tylko dotknięty wycinek bufora (ta sama zasada co w sparkSystem3D:
// zakresy z klatek bez uploadu kumulują się, po progu wracamy do całości).
function flushAttributes(geo, names, lo, hi) {
    const count = hi - lo + 1;
    for (const name of names) {
        const attr = geo.attributes[name];
        if (!attr) continue;
        const items = attr.itemSize || 1;
        if (attr.updateRanges && attr.updateRanges.length >= 8) attr.clearUpdateRanges();
        else if (attr.addUpdateRange) attr.addUpdateRange(lo * items, count * items);
        attr.needsUpdate = true;
    }
}

function randRange(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
}

// Przesunięcie układu lokalnego pod nowe ognisko walki. Puli pustej nie ma co
// przeliczać; przy pełnej (długa bitwa + skok gracza przez pół układu)
// przesuwamy żywe cząstki o deltę, żeby nie odleciały razem z siatką.
function rebaseFrame(x, y, hasLive) {
    const dx = x - frameOx;
    const dy = y - frameOy;
    if (hasLive) {
        // Oś 3D ma y odwrócone względem świata gry.
        for (let i = 0; i < highWater; i++) {
            iOrigin[i * 3] -= dx;
            iOrigin[i * 3 + 1] += dy;
        }
        if (highWater > 0) { markDirty(0); markDirty(highWater - 1); }
        for (let i = 0; i < flashHighWater; i++) {
            fOrigin[i * 3] -= dx;
            fOrigin[i * 3 + 1] += dy;
        }
        if (flashHighWater > 0) { markFlashDirty(0); markFlashDirty(flashHighWater - 1); }
    }
    frameOx = x;
    frameOy = y;
    if (root) root.position.set(frameOx, -frameOy, 0);
}

export const ShieldImpactFX = {
    isInitialized: false,
    // Globalny mnożnik jakości (dev / przyszłe ustawienia grafiki).
    qualityScale: 1.0,
    // Przełączniki warstw efektu: bańka i zaburzenie powietrza.
    flash: true,
    heatHaze: true,
    _hazeTime: 0,
    // Diagnostyka dla konsoli / strojenia.
    stats: { live: 0, emitted: 0 },

    init(scene) {
        if (!scene) return;
        if (this.isInitialized) {
            // Zabezpieczenie na wypadek przebudowy sceny 3D.
            if (root && root.parent !== scene) scene.add(root);
            return;
        }

        const base = buildBaseGeometry();
        geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(base.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(base.indices, 1));
        geometry.instanceCount = 0;

        iOrigin = new Float32Array(MAX_PARTICLES * 3);
        iVel = new Float32Array(MAX_PARTICLES * 3);
        iBirth = new Float32Array(MAX_PARTICLES).fill(-9999);
        iLife = new Float32Array(MAX_PARTICLES);
        iShape = new Float32Array(MAX_PARTICLES * 4);
        iWobble = new Float32Array(MAX_PARTICLES * 2);
        iColor = new Float32Array(MAX_PARTICLES * 3);
        deathTimes = new Float32Array(MAX_PARTICLES).fill(-9999);

        geometry.setAttribute('iOrigin', new THREE.InstancedBufferAttribute(iOrigin, 3));
        geometry.setAttribute('iVel', new THREE.InstancedBufferAttribute(iVel, 3));
        geometry.setAttribute('iBirth', new THREE.InstancedBufferAttribute(iBirth, 1));
        geometry.setAttribute('iLife', new THREE.InstancedBufferAttribute(iLife, 1));
        geometry.setAttribute('iShape', new THREE.InstancedBufferAttribute(iShape, 4));
        geometry.setAttribute('iWobble', new THREE.InstancedBufferAttribute(iWobble, 2));
        geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(iColor, 3));

        material = new THREE.ShaderMaterial({
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            uniforms: {
                uTime: { value: 0 },
                uTrailScale: { value: 1 },
                uMinHalfWidth: { value: 0.5 }
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide
        });

        mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.visible = false;
        // Nad kopułą tarczy (renderOrder 10) — wstęgi mają leżeć na wierzchu.
        mesh.renderOrder = 12;

        this._initFlash();

        // Obie siatki wiszą w jednej grupie, bo dzielą układ lokalny: wielka
        // translacja świata siedzi w transformacie grupy (CPU, float64).
        root = new THREE.Group();
        root.position.set(frameOx, -frameOy, 0);
        root.add(mesh);
        root.add(flashMesh);
        // Ta sama warstwa co kopuły tarcz: pass PO shadowShafts, więc cień
        // planety nie przygasza wyładowań.
        Core3D.enableShield3D(root);
        scene.add(root);

        this.isInitialized = true;
    },

    _initFlash() {
        const quad = new Float32Array([
            -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0,
            -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0
        ]);
        flashGeometry = new THREE.InstancedBufferGeometry();
        flashGeometry.setAttribute('position', new THREE.BufferAttribute(quad, 3));
        flashGeometry.instanceCount = 0;

        fOrigin = new Float32Array(FLASH_MAX * 3);
        fParams = new Float32Array(FLASH_MAX * 4);
        fColor = new Float32Array(FLASH_MAX * 3);
        flashDeath = new Float32Array(FLASH_MAX).fill(-9999);
        for (let i = 0; i < FLASH_MAX; i++) fParams[i * 4] = -9999;   // birth

        flashGeometry.setAttribute('fOrigin', new THREE.InstancedBufferAttribute(fOrigin, 3));
        flashGeometry.setAttribute('fParams', new THREE.InstancedBufferAttribute(fParams, 4));
        flashGeometry.setAttribute('fColor', new THREE.InstancedBufferAttribute(fColor, 3));

        flashMaterial = new THREE.ShaderMaterial({
            vertexShader: FLASH_VERTEX,
            fragmentShader: FLASH_FRAGMENT,
            uniforms: { uTime: { value: 0 } },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide
        });

        flashMesh = new THREE.Mesh(flashGeometry, flashMaterial);
        flashMesh.frustumCulled = false;
        flashMesh.visible = false;
        // Pod wstęgami: bańka jest tłem rozbłysku, iskry lecą po niej.
        flashMesh.renderOrder = 11;
    },

    dispose() {
        if (!this.isInitialized) return;
        if (root?.parent) root.parent.remove(root);
        geometry?.dispose();
        material?.dispose();
        flashGeometry?.dispose();
        flashMaterial?.dispose();
        root = null;
        mesh = null;
        geometry = null;
        material = null;
        flashMesh = null;
        flashGeometry = null;
        flashMaterial = null;
        idx = 0;
        highWater = 0;
        liveUntil = -Infinity;
        dirtyLo = -1;
        dirtyHi = -1;
        isDirty = false;
        flashIdx = 0;
        flashHighWater = 0;
        flashLiveUntil = -Infinity;
        flashDirtyLo = -1;
        flashDirtyHi = -1;
        flashDirty = false;
        hazePulses.length = 0;
        this.isInitialized = false;
    },

    /**
     * Ile cząstek trafienie w ogóle dostanie — z rozmiaru tarczy NA EKRANIE.
     * Jedna liczba załatwia oba wymagania: oddalona kamera i mały statek
     * dostają mniej, bo w obu przypadkach efektu i tak nie widać.
     * Zwraca 0, gdy tarcza jest mniejsza niż kilka pikseli.
     */
    lodScaleFor(shieldRadius, zoom) {
        const px = Math.max(0, shieldRadius) * Math.max(0.0001, zoom || 1);
        if (px < 9) return 0;
        const t = Math.min(1, (px - 9) / (190 - 9));
        return (0.18 + 0.82 * t * t) * this.qualityScale;
    },

    /**
     * Wyrzut cząstek z punktu na tarczy.
     * Wszystkie współrzędne w układzie GRY (y w dół) — konwersja na scenę 3D
     * (y3d = -yGry) siedzi tutaj, żeby wołający nie musiał o niej pamiętać.
     *
     * @param {object} o
     *   x, y        — punkt trafienia na powierzchni tarczy (świat gry)
     *   nx, ny      — normalna powierzchni na zewnątrz (znormalizowana)
     *   radius      — promień tarczy w tym miejscu (skala efektu)
     *   preset      — 'pd' | 'main' | 'special' | 'shield'
     *   color       — THREE.Color aktualnej barwy tarczy
     *   power       — mnożnik siły trafienia (z damage), ~0.2..2.0
     *   vx, vy      — prędkość statku (dziedziczona częściowo przez cząstki)
     *   lod         — mnożnik LOD z lodScaleFor()
     */
    emit(o) {
        if (!this.isInitialized) return 0;
        const preset = PRESETS[o?.preset] || PRESETS.main;
        const lod = o?.lod !== undefined ? o.lod : 1;
        if (lod <= 0) return 0;

        const R = Math.max(6, Number(o.radius) || 40);
        const power = Math.max(0.15, Math.min(2.2, Number(o.power) || 1));
        const now = Number(o.time) || 0;

        // Pusta pula = darmowy moment na przeniesienie układu lokalnego pod
        // bieżące ognisko walki. Poza tym rebase tylko po przekroczeniu progu.
        const hasLive = now < liveUntil || now < flashLiveUntil;
        if (!hasLive) {
            rebaseFrame(o.x, o.y, false);
        } else if (Math.abs(o.x - frameOx) > REBASE_DISTANCE || Math.abs(o.y - frameOy) > REBASE_DISTANCE) {
            rebaseFrame(o.x, o.y, true);
        }

        let count = Math.round(randRange(preset.count) * lod * (0.62 + 0.38 * power));
        if (count <= 0) return 0;

        // Bufor nie może wysycić się jedną salwą — im pełniej, tym ostrzej tniemy.
        const headroom = 1 - (this.stats.live / MAX_PARTICLES);
        if (headroom < 0.35) count = Math.round(count * Math.max(0.12, headroom / 0.35));
        if (count <= 0) return 0;

        const nx = Number(o.nx) || 0;
        const ny = Number(o.ny) || 0;
        const nLen = Math.hypot(nx, ny) || 1;
        const outX = nx / nLen;
        const outY = ny / nLen;
        // Styczna do powierzchni tarczy — oś wyrzutu dla zderzenia tarcza-tarcza.
        const tanX = -outY;
        const tanY = outX;

        const inhX = (Number(o.vx) || 0) * 0.55;
        const inhY = (Number(o.vy) || 0) * 0.55;

        const col = o.color || DEFAULT_COLOR;
        const cr = col.r, cg = col.g, cb = col.b;

        const widthBase = Math.max(1.1, preset.width * R * (0.75 + 0.25 * power));
        const wobbleAmp = preset.wobble * R;

        for (let n = 0; n < count; n++) {
            const slot = idx;
            idx = (idx + 1) % MAX_PARTICLES;

            const r = Math.random();
            const typeId = r < preset.mix[0] ? 0 : (r < preset.mix[1] ? 1 : 2);

            // Kierunek wyrzutu.
            let axX, axY, spread;
            if (preset.tangential && typeId !== 2) {
                // Tarcza o tarczę: plazma tryska w bok, lekko odchylona od kadłuba.
                const side = Math.random() < 0.5 ? -1 : 1;
                axX = tanX * side + outX * 0.30;
                axY = tanY * side + outY * 0.30;
                spread = preset.spread;
            } else if (typeId === 2) {
                // Wyładowania pełzają po całej tarczy — pełne 360°.
                axX = outX; axY = outY;
                spread = Math.PI;
            } else {
                axX = outX; axY = outY;
                spread = preset.spread;
            }
            const axLen = Math.hypot(axX, axY) || 1;
            const axAngle = Math.atan2(axY / axLen, axX / axLen);
            const angle = axAngle + (Math.random() - 0.5) * 2 * spread;

            // Iskry są szybsze i krótsze, łuki wolne i przyklejone do tarczy.
            const typeSpeed = typeId === 1 ? 1.35 : (typeId === 2 ? 0.85 : 1.0);
            const typeLife = typeId === 1 ? 0.55 : (typeId === 2 ? 0.32 : 1.0);
            const typeWidth = typeId === 1 ? 0.30 : (typeId === 2 ? 0.42 : 1.0);

            const speed = randRange(preset.speed) * R * typeSpeed * (0.7 + 0.3 * power);
            const life = randRange(preset.life) * typeLife;

            const s3 = slot * 3;
            iOrigin[s3] = o.x - frameOx;
            iOrigin[s3 + 1] = frameOy - o.y;
            // Delikatne rozwarstwienie w z, żeby wstęgi nie leżały w jednej płaszczyźnie.
            iOrigin[s3 + 2] = 1.4 + Math.random() * 0.4;

            iVel[s3] = Math.cos(angle) * speed + inhX;
            iVel[s3 + 1] = -(Math.sin(angle) * speed + inhY);
            iVel[s3 + 2] = 0;

            iBirth[slot] = now;
            iLife[slot] = life;

            const s4 = slot * 4;
            iShape[s4] = typeId;
            iShape[s4 + 1] = widthBase * typeWidth * (0.7 + Math.random() * 0.6);
            // Rozpiętość ogona w sekundach + losowe skrócenie części wstęg
            // (prototyp robił to samo przez randomLengthFactor w shaderze).
            iShape[s4 + 2] = life * preset.trailFactor * (0.45 + Math.random() * 0.55);
            iShape[s4 + 3] = Math.random();

            const s2 = slot * 2;
            iWobble[s2] = wobbleAmp * (typeId === 2 ? 1.8 : 1.0) * (0.4 + Math.random() * 1.2);
            iWobble[s2 + 1] = (typeId === 2 ? 26 : 7) * (0.6 + Math.random() * 0.9);

            iColor[s3] = cr;
            iColor[s3 + 1] = cg;
            iColor[s3 + 2] = cb;

            const diesAt = now + life;
            deathTimes[slot] = diesAt;
            if (diesAt > liveUntil) liveUntil = diesAt;
            if (slot + 1 > highWater) highWater = slot + 1;
            markDirty(slot);
        }

        this.emitFlash(preset, o, R, power, now, lod, cr, cg, cb);

        this.stats.emitted += count;
        return count;
    },

    // Bańka: jeden rozbłysk na trafienie. Nie skaluje się liczbą — skaluje
    // rozmiarem, więc PD daje małą, główna średnią, special największą.
    emitFlash(preset, o, R, power, now, lod, cr, cg, cb) {
        if (this.flash === false) return;
        const radius = Math.max(5, (preset.flashRadius || 0.3) * R * (0.8 + 0.2 * power));
        const slot = flashIdx;
        flashIdx = (flashIdx + 1) % FLASH_MAX;

        const s3 = slot * 3;
        fOrigin[s3] = o.x - frameOx;
        fOrigin[s3 + 1] = frameOy - o.y;
        fOrigin[s3 + 2] = 1.2;

        const life = (preset.flashLife || 0.2) * (0.85 + Math.random() * 0.3);
        const s4 = slot * 4;
        fParams[s4] = now;
        fParams[s4 + 1] = life;
        fParams[s4 + 2] = radius;
        // Przy dalekim zoomie bańka i tak zlewa się w punkt — LOD ściąga jasność
        // zamiast zostawiać na ekranie twarde kropki.
        fParams[s4 + 3] = (preset.flashPower || 1) * (0.55 + 0.45 * Math.min(1, lod)) * (0.75 + 0.25 * power);

        fColor[s3] = cr;
        fColor[s3 + 1] = cg;
        fColor[s3 + 2] = cb;

        const diesAt = now + life;
        flashDeath[slot] = diesAt;
        if (diesAt > flashLiveUntil) flashLiveUntil = diesAt;
        if (slot + 1 > flashHighWater) flashHighWater = slot + 1;
        markFlashDirty(slot);

        // Zaburzenie powietrza tylko dla ciężkich klas i tylko z bliska —
        // z daleka refrakcja subpikselowa to sam szum.
        const haze = Number(preset.haze) || 0;
        if (haze > 0 && this.heatHaze !== false && lod > 0.45 && hazePulses.length < HAZE_MAX) {
            hazePulses.push({
                x: o.x, y: o.y, age: 0,
                life: life * 2.2,
                r0: radius * 0.7,
                r1: radius * 3.4,
                strength: haze * 2.6 * Math.min(1.4, power)
            });
        }
    },

    /**
     * @param {number} time  — zegar w sekundach (ten sam co uTime tarcz)
     * @param {number} zoom  — zoom kamery gry (LOD długości ogona i grubości)
     */
    update(time, zoom = 1) {
        if (!this.isInitialized) return;

        material.uniforms.uTime.value = time;

        const z = Math.max(0.0001, zoom || 1);
        // Ogon kosztuje wierzchołkami — przy oddaleniu rysujemy mniej segmentów
        // (drawRange ucina indeksy od końca wstęgi), a uTrailScale rozciąga krok
        // czasowy tak, żeby wstęga zachowała długość.
        const segLod = z > 0.55 ? 1.0 : (z > 0.22 ? 0.62 : 0.38);
        const segCount = Math.max(3, Math.round(RIBBON_SEGMENTS * segLod));
        geometry.setDrawRange(0, segCount * 6);
        material.uniforms.uTrailScale.value = RIBBON_SEGMENTS / segCount;
        material.uniforms.uMinHalfWidth.value = 0.9 / z;

        if (isDirty) {
            flushAttributes(geometry, RIBBON_ATTRS, dirtyLo, dirtyHi);
            dirtyLo = -1;
            dirtyHi = -1;
            isDirty = false;
        }
        if (flashDirty) {
            flushAttributes(flashGeometry, FLASH_ATTRS, flashDirtyLo, flashDirtyHi);
            flashDirtyLo = -1;
            flashDirtyHi = -1;
            flashDirty = false;
        }

        // ── Wstęgi ──────────────────────────────────────────────────────────
        const live = time < liveUntil;
        if (mesh.visible !== live) mesh.visible = live;
        if (!live) {
            if (highWater !== 0) {
                highWater = 0;
                idx = 0;
                geometry.instanceCount = 0;
            }
            this.stats.live = 0;
        } else {
            // Zjazd high-watera po wygasłych slotach od góry: po serii strzałów
            // instanceCount opada sam, zamiast wisieć na maksimum do końca bitwy.
            while (highWater > 0 && deathTimes[highWater - 1] <= time) highWater--;
            if (geometry.instanceCount !== highWater) geometry.instanceCount = highWater;

            let liveCount = 0;
            for (let i = 0; i < highWater; i++) if (deathTimes[i] > time) liveCount++;
            this.stats.live = liveCount;
        }

        // ── Bańki ───────────────────────────────────────────────────────────
        flashMaterial.uniforms.uTime.value = time;
        const flashLive = time < flashLiveUntil;
        if (flashMesh.visible !== flashLive) flashMesh.visible = flashLive;
        if (!flashLive) {
            if (flashHighWater !== 0) {
                flashHighWater = 0;
                flashIdx = 0;
                flashGeometry.instanceCount = 0;
            }
        } else {
            while (flashHighWater > 0 && flashDeath[flashHighWater - 1] <= time) flashHighWater--;
            if (flashGeometry.instanceCount !== flashHighWater) flashGeometry.instanceCount = flashHighWater;
        }

        this.updateHaze(time);
    },

    // Haze musi być dopychany CO KLATKĘ — Core3D czyści licznik źródeł przy
    // każdym renderze, więc trzymamy własną listę impulsów i zgłaszamy je
    // dopóki żyją. Współrzędne idą w układzie SCENY (y3d = -yGry).
    updateHaze(time) {
        if (!hazePulses.length) return;
        const dt = Math.max(0, Math.min(0.1, time - (this._hazeTime || time)));
        this._hazeTime = time;
        if (!Core3D.pushHeatHazeWorld) { hazePulses.length = 0; return; }

        for (let i = hazePulses.length - 1; i >= 0; i--) {
            const h = hazePulses[i];
            h.age += dt;
            if (h.age >= h.life) { hazePulses.splice(i, 1); continue; }
            const t = h.age / h.life;
            const easeOut = 1 - Math.pow(1 - t, 3);
            const radius = h.r0 + (h.r1 - h.r0) * easeOut;
            const amp = h.strength * Math.pow(1 - t, 1.5);
            if (amp > 0.001) Core3D.pushHeatHazeWorld(h.x, -h.y, -4, radius, amp);
        }
    }
};

export { PRESETS as SHIELD_IMPACT_PRESETS, MAX_PARTICLES as SHIELD_IMPACT_MAX_PARTICLES };
