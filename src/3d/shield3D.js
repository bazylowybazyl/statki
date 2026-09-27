// ============================================================
// Shield 3D — dwa warianty tarczy:
//  1) "hull" — tarcza-obrys dopasowana do sylwetki kadłuba (statki z hexGrid):
//     płaska kopuła zbudowana na radialnym profilu z shieldSystem, świecąca
//     obramówka (fresnel + pas krawędziowy), ripple trafień po powierzchni.
//  2) "sphere" — klasyczna kolista bańka (droideka, port z flow-shield-effect):
//     stacje, budowle, myśliwce i przyszłe generatory osłon obszarowych.
// Materiały: TSL w shield3D.tsl.js (port WebGPU, zadanie 14) — graf budowany RAZ
// na wariant, każda tarcza ma lekki materiał z wartościami w `material.uniforms`
// (obiekty { value } jak dawniej), więc spawn floty nie buduje shaderów per okręt.
// ============================================================
import * as THREE from 'three/webgpu';
import { Core3D } from './core3d.js';
import { ShieldImpactFX } from './shieldImpactFx.js';
import { SHIELD_MAX_HITS, SHIELD_TSL_STATS, createShieldNodeMaterial } from './shield3D.tsl.js';
import {
    getEntityShieldBaseRadius,
    getEntityShieldProfile,
    getShieldHullAngle,
    isShieldSuppressed,
    sampleShieldProfileRadius
} from '../../shieldSystem.js';

const MAX_HITS = SHIELD_MAX_HITS;

function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
}

// ── Shared state ─────────────────────────────────────────────────────────────
const HIT_DURATION = 1.5; // seconds — must match uHitDuration default

const state = {
    meshes: new Map(),
    geometry: null,
    // Cache geometrii tarcz-obrysów: klucz = hash binów profilu.
    // Statki tej samej klasy współdzielą geometrię.
    hullGeoCache: new Map(), // key → { geometry, refs }
    // Per-entity ring buffer for 3D hits — survives longer than shieldSystem impacts
    hitBuffers: new Map()  // entity → { hits: [{gridAngle, localAngle, startTime}], seen: Map }
};

// Shared sphere geometry — one instance for all shields
function getSharedGeometry() {
    if (!state.geometry) {
        state.geometry = new THREE.SphereGeometry(1.8, 32, 32);
    }
    return state.geometry;
}

// ── Geometria tarczy-obrysu: polarna kopuła na profilu r(θ) ─────────────────
// Rozdzielczość czaszy: 192 segmenty kątowe × 8 pierścieni — obrys ma być
// gładką krzywą (jasny rim bezlitośnie podkreśla każdą fasetkę). Geometria
// jest współdzielona per klasa kadłuba, więc koszt jest jednorazowy.
const HULL_ANGULAR_STEPS = 192;
const HULL_RADIAL_T = [0.30, 0.52, 0.70, 0.83, 0.90, 0.945, 0.975, 1.0];

function buildHullShieldGeometry(profile) {
    const N = HULL_ANGULAR_STEPS;
    const rings = HULL_RADIAL_T;
    const h = clamp(profile.minR * 0.85, 8, 140);

    const positions = [0, 0, h];
    const edges = [0];

    for (let j = 0; j < rings.length; j++) {
        const t = rings[j];
        // Spłaszczona czasza (jak ściśnięta sfera): normalne pochylają się już
        // od środka, więc fresnel daje gradient poświaty na CAŁEJ górze tarczy,
        // nie tylko na obrysie. Rim ląduje na z=0.
        const z = h * Math.pow(Math.max(0, 1 - t * t), 0.62);
        for (let i = 0; i < N; i++) {
            const theta = (i / N) * Math.PI * 2;
            const r = sampleShieldProfileRadius(profile, theta) * t;
            // Klatka grid-local (y w dół) -> geometria 3D (y w górę): y = -y_grid.
            positions.push(Math.cos(theta) * r, -Math.sin(theta) * r, z);
            edges.push(t);
        }
    }

    const indices = [];
    for (let i = 0; i < N; i++) {
        indices.push(0, 1 + ((i + 1) % N), 1 + i);
    }
    for (let j = 0; j < rings.length - 1; j++) {
        const base0 = 1 + j * N;
        const base1 = 1 + (j + 1) * N;
        for (let i = 0; i < N; i++) {
            const i1 = (i + 1) % N;
            const a = base0 + i, b = base0 + i1;
            const c = base1 + i, d = base1 + i1;
            indices.push(a, d, c);
            indices.push(a, b, d);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edges, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Gwarancja normalnych w górę (+z na czubku kopuły) — winding zależy od
    // lustrzanego odbicia y, więc weryfikujemy i ewentualnie odwracamy.
    const normals = geometry.getAttribute('normal');
    if (normals.getZ(0) < 0) {
        const idx = geometry.getIndex();
        for (let i = 0; i < idx.count; i += 3) {
            const tmp = idx.getX(i + 1);
            idx.setX(i + 1, idx.getX(i + 2));
            idx.setX(i + 2, tmp);
        }
        idx.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    return geometry;
}

function profileGeoKey(profile) {
    const bins = profile.bins;
    let hash = 0;
    for (let i = 0; i < bins.length; i++) {
        hash = ((hash * 31) + ((bins[i] * 4 + 0.5) | 0)) | 0;
    }
    return bins.length + '|' + hash;
}

function acquireHullGeometry(profile) {
    const key = profileGeoKey(profile);
    let entry = state.hullGeoCache.get(key);
    if (!entry) {
        entry = { geometry: buildHullShieldGeometry(profile), refs: 0 };
        state.hullGeoCache.set(key, entry);
    }
    entry.refs++;
    return { key, geometry: entry.geometry };
}

function releaseHullGeometry(key) {
    const entry = state.hullGeoCache.get(key);
    if (entry) entry.refs = Math.max(0, entry.refs - 1);
    // Ewikcja nieużywanych geometrii dopiero przy przepełnieniu cache.
    if (state.hullGeoCache.size > 48) {
        for (const [k, e] of state.hullGeoCache) {
            if (e.refs <= 0) {
                e.geometry.dispose();
                state.hullGeoCache.delete(k);
            }
        }
    }
}

function makeHitUniformArrays(y) {
    const hitPositions = [];
    const hitTimes = [];
    for (let i = 0; i < MAX_HITS; i++) {
        hitPositions.push(new THREE.Vector3(0, y, 0));
        hitTimes.push(-999);
    }
    return { hitPositions, hitTimes };
}

// ── Create shield material with droideka preset defaults ─────────────────────
// Materiał = graf wariantu 'sphere' (wspólny) + wartości tej tarczy.
function createShieldMaterial() {
    const { hitPositions, hitTimes } = makeHitUniformArrays(1.8);

    return createShieldNodeMaterial('sphere', {
        uTime:                { value: 0 },
        uColor:               { value: new THREE.Color('#5992f7') },
        uLife:                { value: 1.0 },
        uReveal:              { value: 1.0 },     // 1 = hidden, 0 = fully visible
        // Hex grid (showHex=0 for droideka — pure energy look)
        uHexScale:            { value: 3.0 },
        uHexOpacity:          { value: 0.27 },
        uShowHex:             { value: 0.0 },
        uEdgeWidth:           { value: 0.2 },
        // Fresnel
        uFresnelPower:        { value: 1.8 },
        uFresnelStrength:     { value: 1.75 },
        uOpacity:             { value: 0.29 },
        uFadeStart:           { value: 1.0 },
        // Flash
        uFlashSpeed:          { value: 0.6 },
        uFlashIntensity:      { value: 0.11 },
        // Noise edge (reveal/dissolve)
        uNoiseScale:          { value: 1.0 },
        uNoiseEdgeColor:      { value: new THREE.Color('#7faaf5') },
        uNoiseEdgeWidth:      { value: 0.1 },
        uNoiseEdgeIntensity:  { value: 0.6 },
        uNoiseEdgeSmoothness: { value: 0.5 },
        // Flow noise
        uFlowScale:           { value: 6.2 },
        uFlowSpeed:           { value: 1.08 },
        uFlowIntensity:       { value: 4.0 },
        // Hit ring buffer
        uHitPos:              { value: hitPositions },
        uHitTime:             { value: hitTimes },
        uHitRingSpeed:        { value: 0.8 },
        uHitRingWidth:        { value: 0.12 },
        uHitMaxRadius:        { value: 2.1 },
        uHitDuration:         { value: 1.5 },
        uHitIntensity:        { value: 1.0 },
        uHitImpactRadius:     { value: 0.3 },
        // Game-specific
        uIsBreaking:          { value: 0.0 },
        uEnergyShot:          { value: 0.0 },
    });
}

// ── Materiał tarczy-obrysu: parametry przeskalowane do rozmiaru kadłuba ──────
// Graf wariantu 'hull' (wspólny dla wszystkich kadłubów) + wartości tej tarczy.
function createHullShieldMaterial(profile) {
    const maxR = Math.max(1, profile.maxR);
    const { hitPositions, hitTimes } = makeHitUniformArrays(0);
    const hexCell = clamp(maxR * 0.16, 10, 40);

    return createShieldNodeMaterial('hull', {
        uTime:                { value: 0 },
        uColor:               { value: new THREE.Color('#5992f7') },
        uLife:                { value: 1.0 },
        uReveal:              { value: 1.0 },
        // Hex grid (domyślnie wyłączony — czysty energetyczny obrys)
        uHexScale:            { value: 1 / hexCell },
        uHexOpacity:          { value: 0.27 },
        uShowHex:             { value: 0.0 },
        uEdgeWidth:           { value: 0.2 },
        // Fresnel — ciaśniejszy niż na sferze, robi obramówkę
        uFresnelPower:        { value: 2.2 },
        uFresnelStrength:     { value: 2.2 },
        uOpacity:             { value: 0.30 },
        // Flash
        uFlashSpeed:          { value: 0.6 },
        uFlashIntensity:      { value: 0.11 },
        // Noise edge (reveal/dissolve) — skala w jednostkach świata
        uNoiseScale:          { value: 2.2 / maxR },
        uNoiseEdgeColor:      { value: new THREE.Color('#7faaf5') },
        uNoiseEdgeWidth:      { value: 0.1 },
        uNoiseEdgeIntensity:  { value: 0.6 },
        uNoiseEdgeSmoothness: { value: 0.5 },
        // Flow noise — intensywność jak na sferze, film niesie ją na górze
        uFlowScale:           { value: 5.5 / maxR },
        uFlowSpeed:           { value: 1.08 },
        uFlowIntensity:       { value: 4.0 },
        // Hit ring buffer — dystanse w jednostkach świata
        uHitPos:              { value: hitPositions },
        uHitTime:             { value: hitTimes },
        uHitRingSpeed:        { value: maxR * 0.55 },
        uHitRingWidth:        { value: clamp(maxR * 0.045, 4, 18) },
        uHitMaxRadius:        { value: maxR * 0.52 },
        uHitDuration:         { value: 1.5 },
        uHitIntensity:        { value: 1.0 },
        uHitImpactRadius:     { value: maxR * 0.26 },
        // Obramówka + film wnętrza
        uRimStart:            { value: 0.84 },
        uRimIntensity:        { value: 1.8 },
        uFilmStrength:        { value: 0.20 },
        // Game-specific
        uIsBreaking:          { value: 0.0 },
        uEnergyShot:          { value: 0.0 },
        // Sterowanie widocznością (model "niewidzialne pole")
        uFieldVisibility:     { value: 0.0 },
        uSweep:               { value: -1.0 },
        uSweepWidth:          { value: 0.17 },
        uLowPower:            { value: 0.0 },
        uHitOpacity:          { value: 0.90 },
        uHitGrow:             { value: 0.10 },
        uHitDecay:            { value: 3.4 },
        uHitCoreLife:         { value: 0.16 },
    });
}

// ── Barwa cząsteczek = barwa tarczy ─────────────────────────────────────────
// Ta sama funkcja co lifeColor() w shaderze: pełne HP -> uColor, puste -> czerwień.
// Efekty NIE mają własnej palety, żeby przyszłe kolory tarcz (frakcje, typy
// generatorów) zadziałały bez dotykania tego pliku.
const SHIELD_EMPTY_COLOR = new THREE.Color(1.0, 0.08, 0.04);
const SHIELD_BREAK_COLOR = new THREE.Color(1.0, 0.35, 0.22);
const _fxColor = new THREE.Color();

function resolveShieldFxColor(u, shield) {
    if (shield.state === 'breaking') return _fxColor.copy(SHIELD_BREAK_COLOR);
    const life = clamp(Number(u.uLife.value) || 0, 0, 1);
    return _fxColor.copy(SHIELD_EMPTY_COLOR).lerp(u.uColor.value, life);
}

function fxPowerFromHit(hit) {
    const intensity = Number(hit?.intensity);
    return Number.isFinite(intensity) ? intensity : 1.0;
}

// ── Emisja cząsteczek: tarcza-obrys ─────────────────────────────────────────
// Punkt trafienia i normalna liczone w klatce profilu (r(θ) nie jest okręgiem,
// więc normalna to gradient krzywej, nie kierunek promienia), potem obrót
// o kąt kadłuba do współrzędnych świata gry.
const FX_NORMAL_DELTA = 0.05;

function emitHullImpactFx(entity, shield, profile, hullAngle, pose, scaleProgress, fresh, mesh, time, zoom) {
    const color = resolveShieldFxColor(mesh.material.uniforms, shield);
    const c = Math.cos(hullAngle);
    const sn = Math.sin(hullAngle);
    const meanR = (profile.maxR + profile.minR) * 0.5;
    const vx = Number(entity.vx) || 0;
    const vy = Number(entity.vy) || 0;

    for (let i = 0; i < fresh.length; i++) {
        const hit = fresh[i];
        const a = hit.gridAngle !== null ? hit.gridAngle : (-(hit.localAngle || 0) - hullAngle);
        const r = sampleShieldProfileRadius(profile, a) * scaleProgress;

        // Skala efektu: promień w miejscu trafienia zmieszany ze średnią statku,
        // żeby burta długiego kadłuba nie pryskała jak dziób.
        const fxRadius = r * 0.7 + meanR * scaleProgress * 0.3;
        const lod = ShieldImpactFX.lodScaleFor(fxRadius, zoom);
        if (lod <= 0) continue;

        const gx = Math.cos(a) * r;
        const gy = Math.sin(a) * r;

        const rm = sampleShieldProfileRadius(profile, a - FX_NORMAL_DELTA) * scaleProgress;
        const rp = sampleShieldProfileRadius(profile, a + FX_NORMAL_DELTA) * scaleProgress;
        let tx = Math.cos(a + FX_NORMAL_DELTA) * rp - Math.cos(a - FX_NORMAL_DELTA) * rm;
        let ty = Math.sin(a + FX_NORMAL_DELTA) * rp - Math.sin(a - FX_NORMAL_DELTA) * rm;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        let ngx = ty;
        let ngy = -tx;
        if (ngx * gx + ngy * gy < 0) { ngx = -ngx; ngy = -ngy; }

        ShieldImpactFX.emit({
            x: pose.x + (gx * c - gy * sn),
            y: pose.y + (gx * sn + gy * c),
            nx: ngx * c - ngy * sn,
            ny: ngx * sn + ngy * c,
            radius: fxRadius,
            preset: hit.fxClass,
            color,
            power: fxPowerFromHit(hit),
            vx, vy,
            lod,
            time
        });
    }
}

// ── Emisja cząsteczek: kolista bańka ────────────────────────────────────────
function emitSphereImpactFx(entity, shield, radius, pose, fresh, mesh, time, zoom) {
    const lod = ShieldImpactFX.lodScaleFor(radius, zoom);
    if (lod <= 0) return;
    const color = resolveShieldFxColor(mesh.material.uniforms, shield);
    const vx = Number(entity.vx) || 0;
    const vy = Number(entity.vy) || 0;

    for (let i = 0; i < fresh.length; i++) {
        const hit = fresh[i];
        // localAngle jest kątem w klatce y-w-górę; świat gry ma y w dół.
        const nx = Math.cos(hit.localAngle || 0);
        const ny = -Math.sin(hit.localAngle || 0);
        ShieldImpactFX.emit({
            x: pose.x + nx * radius,
            y: pose.y + ny * radius,
            nx, ny,
            radius,
            preset: hit.fxClass,
            color,
            power: fxPowerFromHit(hit),
            vx, vy,
            lod,
            time
        });
    }
}

function pickHitSlot(hits, timeNow) {
    for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        if (!hit || (timeNow - (Number(hit.startTime) || 0)) >= HIT_DURATION) return i;
    }

    let oldestIdx = 0;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (let i = 0; i < hits.length; i++) {
        const hitTime = Number(hits[i]?.startTime) || 0;
        if (hitTime < oldestTime) {
            oldestTime = hitTime;
            oldestIdx = i;
        }
    }
    return oldestIdx;
}

// ── Create shield mesh for entity ────────────────────────────────────────────
function createShieldMesh(entity) {
    const material = createShieldMaterial();
    const mesh = new THREE.Mesh(getSharedGeometry(), material);
    mesh.renderOrder = 10;
    mesh.userData.kind = 'sphere';
    // Warstwa tarcz = pass PO shadowShafts: cień statku/planety nie mnoży
    // poświaty tarczy (patrz enableShield3D w core3d).
    Core3D.enableShield3D(mesh);
    Core3D.scene.add(mesh);
    state.meshes.set(entity, mesh);
    return mesh;
}

function createHullShieldMesh(entity, profile) {
    const material = createHullShieldMaterial(profile);
    const { key, geometry } = acquireHullGeometry(profile);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 10;
    mesh.userData.kind = 'hull';
    mesh.userData.geoKey = key;
    mesh.userData.profileRef = profile;
    // Baza dla mnożnika ShieldFieldTuning.hitRadiusScale (zależy od rozmiaru kadłuba).
    mesh.userData.baseHitRadius = material.uniforms.uHitImpactRadius.value;
    Core3D.enableShield3D(mesh);
    Core3D.scene.add(mesh);
    state.meshes.set(entity, mesh);
    return mesh;
}

function removeShieldMesh(entity, mesh) {
    Core3D.scene.remove(mesh);
    state.meshes.delete(entity);
    state.hitBuffers.delete(entity);
    mesh.material.dispose();
    if (mesh.userData.kind === 'hull' && mesh.userData.geoKey) {
        releaseHullGeometry(mesh.userData.geoKey);
    }
}

// ── Wspólne uniformy stanu tarczy (aktywacja/breaking/energia/HP) ────────────
function applyShieldStateUniforms(u, shield, time) {
    u.uTime.value = time;

    // Life = shield HP ratio
    u.uLife.value = Math.max(0, Math.min(1, (shield.val || 0) / (shield.max || 1)));

    // Reveal mapping from state machine
    // During activating: shield grows from center (scale handles it), fully visible
    // During breaking: dissolve out via reveal
    if (shield.state === 'breaking') {
        const breakProgress = Math.max(0, Math.min(1, shield.activationProgress || 0));
        u.uReveal.value = 1.0 - breakProgress; // dissolve out
    } else {
        u.uReveal.value = 0.0;
    }

    u.uIsBreaking.value = shield.state === 'breaking' ? 1.0 : 0.0;

    if (shield.energyShotTimer > 0) {
        u.uEnergyShot.value = shield.energyShotTimer / (shield.energyShotDuration || 1);
    } else {
        u.uEnergyShot.value = 0.0;
    }
}

// ── Ring buffer trafień 3D (dłuższy niż impacts w shieldSystem) ──────────────
function syncHitBuffer(entity, shield, time) {
    if (!state.hitBuffers.has(entity)) {
        // prevState/bootAt: faza widoczności pola (rozruch -> dopalenie -> ciemność).
        state.hitBuffers.set(entity, {
            hits: new Array(MAX_HITS).fill(null), seen: new Map(), fresh: [],
            prevState: null, bootAt: -999
        });
    }
    const hb = state.hitBuffers.get(entity);
    // `fresh` to trafienia zarejestrowane w TEJ klatce — tylko one wyrzucają
    // cząsteczki (ring buffer żyje 1.5 s i odpaliłby je raz na klatkę).
    hb.fresh.length = 0;

    // Detect new impacts by stable impact id; startTime alone can collide under multi-hit same-frame fire.
    const impacts = shield.impacts || [];
    for (const imp of impacts) {
        const key = Number.isFinite(imp?.id) ? `id:${imp.id}` : `t:${imp.startTime}`;
        const hitStartTime = Number(imp?.startTime) || time;
        if (key && !hb.seen.has(key)) {
            hb.seen.set(key, hitStartTime);
            const slot = pickHitSlot(hb.hits, time);
            const record = {
                localAngle: imp.localAngle || 0,
                gridAngle: Number.isFinite(imp.gridAngle) ? imp.gridAngle : null,
                startTime: hitStartTime,
                fxClass: imp.fxClass || 'main',
                intensity: Number(imp.intensity) || 1
            };
            hb.hits[slot] = record;
            hb.fresh.push(record);
        }
    }

    // Clean up old seen keys (prevent memory leak)
    if (hb.seen.size > 96) {
        const cutoff = time - HIT_DURATION * 2;
        for (const [key, seenAt] of hb.seen) {
            if ((Number(seenAt) || 0) < cutoff) hb.seen.delete(key);
        }
    }

    return hb;
}

function resolveEntityPose(entity, interpPoseOverride) {
    let x = Number.isFinite(entity.x) ? entity.x : entity.pos?.x;
    let y = Number.isFinite(entity.y) ? entity.y : entity.pos?.y;
    let interpAngle = null;

    if (interpPoseOverride && entity.isPlayer && entity === (typeof window !== 'undefined' ? window.ship : null)) {
        x = interpPoseOverride.x;
        y = interpPoseOverride.y;
        interpAngle = interpPoseOverride.angle;
    }
    return { x: x || 0, y: y || 0, interpAngle };
}

// ── Faza widoczności pola ────────────────────────────────────────────────────
// Model "niewidzialne pole": tarcza zdradza się tylko wtedy, gdy zmienia stan
// (rozruch, gaszenie, pęknięcie) albo dogorywa. W normalnej pracy jedynym
// światłem są łaty trafień, a mesh w ogóle wypada z renderu.
// Strojenie na żywo z konsoli — odpowiednik ShieldFXPresets, tyle że dla samego
// pola. Zwykły obiekt, więc ShieldFieldTuning.hitOpacity = 1.4 działa od razu.
export const SHIELD_FIELD_TUNING = {
    hitOpacity: 0.90,     // jak mocno świeci łata trafienia
    hitDecay: 3.4,        // szybkość gaśnięcia łaty (większe = krócej)
    hitRadiusScale: 1.0,  // mnożnik zasięgu łaty względem rozmiaru kadłuba
    fieldOpacity: 0.30,   // siła pola przy rozruchu / gaszeniu / pęknięciu
    lowPowerGain: 1.0     // 0 = brak ostrzegawczego pulsu przy niskim HP
};

const LOW_POWER_THRESHOLD = 0.35; // poniżej tego HP obrys zaczyna pulsować
const BOOT_AFTERGLOW = 0.42;      // s — dopalenie po domknięciu rozruchu
const SWEEP_END = 1.2;            // pozycja czoła fali przy pełnym rozruchu
const HIT_FX_LIFE = 1.1;          // s — po tylu sekundach łata już nic nie rysuje
// LOD kopuły: promień tarczy NA EKRANIE poniżej tego progu = zero draw calla.
// Ten sam próg i ta sama miara (promień × zoom) co ShieldImpactFX.lodScaleFor,
// który poniżej 9 px nie emituje już cząstek. Tylko warunek widoczności —
// syncHitBuffer/resolveHullFieldPhase muszą chodzić dalej co klatkę, inaczej
// po przybliżeniu stare impakty wyszłyby jako „fresh”, a stary prevState
// odpaliłby fałszywe dopalenie rozruchu.
const SHIELD_DOME_MIN_PX = 9;

function resolveHullFieldPhase(hb, shield, time) {
    const st = shield.state;
    const ap = clamp(Number(shield.activationProgress) || 0, 0, 1);

    if (hb.prevState !== st) {
        // Rozruch domknięty: pole dopala się jeszcze chwilę, a czoło fali
        // wyjeżdża poza obrys — inaczej tarcza gasłaby skokiem w tej klatce.
        if (st === 'active' && hb.prevState === 'activating') hb.bootAt = time;
        hb.prevState = st;
    }

    // Rozruch: ap rośnie 0->1, czoło biegnie od środka na zewnątrz.
    // Gaszenie: ap maleje 1->0, czoło wraca do środka i pole zapada się w sobie.
    if (st === 'activating' || st === 'deactivating') return { field: 1, sweep: ap * SWEEP_END };
    if (st === 'breaking') return { field: 1, sweep: -1 };

    const since = time - (Number(hb.bootAt) || -999);
    if (since >= 0 && since < BOOT_AFTERGLOW) {
        const k = 1 - since / BOOT_AFTERGLOW;
        return { field: k * k, sweep: SWEEP_END + (1 - k) * 0.5 };
    }
    return { field: 0, sweep: -1 };
}

// ── Update: tarcza-obrys kadłuba ─────────────────────────────────────────────
function updateHullShieldMesh(entity, mesh, shield, profile, time, interpPoseOverride, zoom) {
    const pose = resolveEntityPose(entity, interpPoseOverride);
    // Gracz z interpolacją: spriteRotation gracza = 0, więc kąt interpolowany
    // można podstawić wprost.
    const hullAngle = pose.interpAngle !== null ? pose.interpAngle : getShieldHullAngle(entity);

    // Pole ma docelowy rozmiar od pierwszej klatki — rozruch pokazuje fala po
    // powierzchni, nie rosnący mesh (ten dublowałby się z falą).
    mesh.scale.set(1, 1, 1);
    mesh.position.set(pose.x, -pose.y, 1);
    mesh.rotation.set(0, 0, -hullAngle);

    const u = mesh.material.uniforms;
    applyShieldStateUniforms(u, shield, time);

    const hb = syncHitBuffer(entity, shield, time);
    let liveHits = 0;
    for (let i = 0; i < MAX_HITS; i++) {
        const hit = hb.hits[i];
        if (hit && (time - hit.startTime) < HIT_DURATION) {
            // Kąt w klatce profilu: zapisany przy rejestracji impaktu (gridAngle),
            // fallback z localAngle (kąt świata, y-up) dla starych impaktów.
            const a = hit.gridAngle !== null ? hit.gridAngle : (-(hit.localAngle || 0) - hullAngle);
            const r = sampleShieldProfileRadius(profile, a);
            u.uHitPos.value[i].set(Math.cos(a) * r, -Math.sin(a) * r, 0);
            u.uHitTime.value[i] = hit.startTime;
            if ((time - hit.startTime) < HIT_FX_LIFE) liveHits++;
        } else {
            u.uHitTime.value[i] = -999;
        }
    }

    const phase = resolveHullFieldPhase(hb, shield, time);
    u.uFieldVisibility.value = phase.field;
    u.uSweep.value = phase.sweep;

    // Agonia: poniżej progu HP obrys zaczyna pulsować, żeby dało się na oko
    // odróżnić statek z osłoną od statku, któremu zaraz pęknie.
    const life = clamp(Number(u.uLife.value) || 0, 0, 1);
    const lowPower = (shield.state === 'active' || shield.state === 'activating')
        ? clamp((LOW_POWER_THRESHOLD - life) / LOW_POWER_THRESHOLD, 0, 1)
        : 0;
    const tune = SHIELD_FIELD_TUNING;
    u.uLowPower.value = lowPower * (Number(tune.lowPowerGain) || 0);
    u.uHitOpacity.value = Number(tune.hitOpacity) || 0;
    u.uHitDecay.value = Number(tune.hitDecay) || 0.001;
    u.uOpacity.value = Number(tune.fieldOpacity) || 0;
    u.uHitImpactRadius.value = (Number(mesh.userData.baseHitRadius) || u.uHitImpactRadius.value)
                             * (Number(tune.hitRadiusScale) || 1);

    // Nic się nie dzieje -> mesh wypada z renderu. Pipeline jest związany
    // submisją, więc niewidzialna tarcza ma kosztować zero draw calli.
    // Tarcza mniejsza niż SHIELD_DOME_MIN_PX na ekranie też wypada (daleki zoom,
    // mała jednostka) — puls lowPower trzymał dotąd widoczną każdą słabą tarczę.
    const domeScreenPx = Math.max(1, profile.maxR) * zoom;
    mesh.visible = domeScreenPx >= SHIELD_DOME_MIN_PX && (
                   phase.field > 0.002
                || u.uLowPower.value > 0.004
                || liveHits > 0
                || (Number(shield.energyShotTimer) || 0) > 0);

    if (hb.fresh.length) {
        emitHullImpactFx(entity, shield, profile, hullAngle, pose, 1, hb.fresh, mesh, time, zoom);
    }
}

// ── Update: kolista bańka (oryginalna ścieżka) ───────────────────────────────
function updateSphereShieldMesh(entity, mesh, shield, time, interpPoseOverride, zoom) {
    // Uniform scale: sphere radius=1.8, shield covers the shared gameplay radius.
    const s = getEntityShieldBaseRadius(entity) / 1.8;
    // During activation, shield grows from center; during breaking, stays full size
    const ap = Math.max(0, Math.min(1, shield.activationProgress || 0));
    const scaleProgress = shield.state === 'breaking' ? 1 : Math.max(0.02, ap);
    mesh.scale.set(s * scaleProgress, s * scaleProgress, s * scaleProgress);

    const pose = resolveEntityPose(entity, interpPoseOverride);
    let visualAngle = pose.interpAngle !== null ? pose.interpAngle : (entity.angle || 0);

    const profile = entity.capitalProfile;
    if (profile) {
        if (Number.isFinite(profile.spriteRotation)) visualAngle += profile.spriteRotation;
        if (Number.isFinite(profile.shieldRotation)) visualAngle += profile.shieldRotation;
    }

    mesh.position.set(pose.x, -pose.y, 1);
    mesh.rotation.set(Math.PI / 2, -visualAngle, 0);

    const u = mesh.material.uniforms;
    applyShieldStateUniforms(u, shield, time);

    const hb = syncHitBuffer(entity, shield, time);
    for (let i = 0; i < MAX_HITS; i++) {
        const hit = hb.hits[i];
        if (hit && (time - hit.startTime) < HIT_DURATION) {
            // Object-space angle: localAngle + visualAngle (compensate mesh rotation.z = -visualAngle)
            const a = hit.localAngle + visualAngle;
            u.uHitPos.value[i].set(Math.cos(a) * 1.8, 0, -Math.sin(a) * 1.8);
            u.uHitTime.value[i] = hit.startTime;
        } else {
            u.uHitTime.value[i] = -999;
        }
    }

    // Bańka nie ma ukrywania w bezczynności (świeci stale), więc tu próg
    // ekranowy to jedyne, co zdejmuje ją z renderu przy dalekim zoomie.
    mesh.visible = s * 1.8 * scaleProgress * zoom >= SHIELD_DOME_MIN_PX;

    if (hb.fresh.length) {
        emitSphereImpactFx(entity, shield, s * 1.8 * scaleProgress, pose, hb.fresh, mesh, time, zoom);
    }
}

// ── Per-frame update ─────────────────────────────────────────────────────────
const _activeShieldEntities = new Set();

// Rozgrzewka programów tarcz (ekran ładowania). Tarcza-obrys ma jeden program na wszystkie
// kadłuby, ale kompilował się przy pierwszej tarczy w sesji (~200 ms w klatce pojawienia się
// pierwszego wroga), a gdy znikała ostatnia tarcza, dispose materiału niszczył program three
// i następny wróg kompilował go od nowa. Materiały-trzymacze (bez dispose) trzymają programy
// obu wariantów przez całą sesję: WebGPU usuwa stan budowy materiału (NodeBuilderState) i
// pipeline, gdy ostatni obiekt renderu przestaje ich używać — obiekty renderu próbek zostają.
// Cząstki trafień (ShieldImpactFX) to stałe pule — wystarczy je skompilować.
// Pass tarcz = Core3D.prewarmPass: cel composerTarget (HalfFloat, MSAA), kamera ortho z
// warstwą 7, bez cullingu; compileAsync nie blokuje. Klucz stanu budowy i układ
// wierzchołków pipeline'u zależą od ZESTAWU ATRYBUTÓW geometrii, więc próbka obrysu ma
// geometrię obrysu (position, aEdge, normal, indeks) — sfera jej nie zastąpi.
let _programKeepers = null;
const PREWARM_PROFILE = { bins: new Float32Array(16).fill(150), binCount: 16, maxR: 150, minR: 150, pad: 0 };

export function prewarmShields3D() {
    if (_programKeepers) return true;
    if (!Core3D.isInitialized || !Core3D.renderer || !Core3D.cameraOrtho) return false;
    ShieldImpactFX.init(Core3D.scene);
    const hull = new THREE.Mesh(buildHullShieldGeometry(PREWARM_PROFILE), createHullShieldMaterial(PREWARM_PROFILE));
    const sphere = new THREE.Mesh(getSharedGeometry(), createShieldMaterial());
    const probe = new THREE.Group();
    probe.add(hull, sphere);
    Core3D.enableShield3D(probe);
    Core3D.scene.add(probe);
    try {
        // WebGPU: compileAsync bez blokowania, pass tarcz (warstwa 7, kamera ortho,
        // cel composerTarget) — Core3D.prewarmPass; projekcja synchronicznie.
        Core3D.prewarmPass(probe, 7);
    } finally {
        Core3D.scene.remove(probe);
    }
    // Wstęgi i bańki trafień: ukryte do pierwszego trafienia (compileAsync pomija
    // niewidoczne) — pule odsłaniają się tylko na czas projekcji.
    ShieldImpactFX.prewarm();
    _programKeepers = [hull.material, sphere.material];
    return true;
}

/** Liczniki materiałów tarcz: lekkie materiały per tarcza i budowy NodeBuildera (spawn floty). */
export function getShieldMaterialStats() {
    return {
        materials: { ...SHIELD_TSL_STATS.materials },
        builds: { ...SHIELD_TSL_STATS.builds }
    };
}

// Fabryki dla testów i narzędzi (scripts/webgpu/tarcze-parzystosc.mjs — parzystość
// z GLSL tagu webgl-baseline na tych samych wartościach i geometrii).
export {
    createShieldMaterial as createSphereShieldMaterialForTools,
    createHullShieldMaterial as createHullShieldMaterialForTools,
    buildHullShieldGeometry as buildHullShieldGeometryForTools
};

export function updateShields3D(dt, entities, interpPoseOverride = null) {
    if (!Core3D.isInitialized) return;
    const time = performance.now() / 1000;

    ShieldImpactFX.init(Core3D.scene);
    const zoom = Math.max(0.0001, Number(Core3D.activeCam1?.zoom) || 1);

    // Wspólny Set zamiast nowego co klatkę (funkcja nie jest re-entrant).
    const activeEntities = _activeShieldEntities;
    activeEntities.clear();
    let anyDomeVisible = false;

    for (const entity of entities) {
        const shield = entity?.shield;
        if (!shield || !shield.max || shield.state === 'off') continue;
        // 'deactivating' jest już suppressed (nie blokuje pocisków), ale pole
        // ma jeszcze opaść falą — dopiero potem mesh znika.
        if (isShieldSuppressed(entity) && shield.state !== 'deactivating') continue;

        // Statki z hexGrid: tarcza-obrys; reszta (stacje, budowle, myśliwce,
        // przyszłe generatory osłon obszarowych): kolista bańka.
        const profile = getEntityShieldProfile(entity);
        const kind = profile ? 'hull' : 'sphere';

        let mesh = state.meshes.get(entity);
        if (mesh && (mesh.userData.kind !== kind || (kind === 'hull' && mesh.userData.profileRef !== profile))) {
            removeShieldMesh(entity, mesh);
            mesh = null;
        }
        if (!mesh) {
            mesh = kind === 'hull' ? createHullShieldMesh(entity, profile) : createShieldMesh(entity);
        }
        activeEntities.add(entity);

        if (kind === 'hull') {
            updateHullShieldMesh(entity, mesh, shield, profile, time, interpPoseOverride, zoom);
        } else {
            updateSphereShieldMesh(entity, mesh, shield, time, interpPoseOverride, zoom);
        }
        if (mesh.visible) anyDomeVisible = true;
    }

    // Cleanup dead shields
    for (const [entity, mesh] of state.meshes) {
        if (!activeEntities.has(entity)) {
            removeShieldMesh(entity, mesh);
        }
    }

    // Cząsteczki żyją własnym życiem — także wtedy, gdy statek już zniknął
    // z listy renderowanych (wstęga po ostatnim trafieniu ma dopalić).
    ShieldImpactFX.update(time, zoom);

    // Pass tarcz w Core3D (obchód grafu + resolve MSAA) ma sens tylko wtedy,
    // gdy cokolwiek na tej warstwie jest widoczne — w spoczynku kopuły znikają.
    if (typeof Core3D.setShieldLayerActive === 'function') {
        Core3D.setShieldLayerActive(anyDomeVisible || ShieldImpactFX.hasVisibleContent());
    }
}
