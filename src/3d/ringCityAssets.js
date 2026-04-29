// ============================================================
// Ring City Assets — SynthCity model/texture loading & materials
// Ported from ringprocedural.html prototype
// ============================================================
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, pickArrayEntry } from './ringCityZoneGrid.js';

export { BufferGeometryUtils };

// --- Global asset store ---
export const synthCityAssets = {
    models: {},
    textures: {},
    materials: {},
    loaded: false,
    loading: false
};

// --- Material cache for procedural textures ---
const matCache = {};

// --- Asset loading ---
export function loadSynthCityAssets() {
    return new Promise((resolve, reject) => {
        if (synthCityAssets.loaded) { resolve(synthCityAssets); return; }
        if (synthCityAssets.loading) {
            // Czekamy grzecznie, aż pierwszy proces ładowania zakończy pracę
            const wait = setInterval(() => {
                if (synthCityAssets.loaded) {
                    clearInterval(wait);
                    resolve(synthCityAssets);
                }
            }, 100);
            return;
        }
        synthCityAssets.loading = true;

        const manager = new THREE.LoadingManager();
        const texLoader = new THREE.TextureLoader(manager);
        const objLoader = new OBJLoader(manager);

        manager.onLoad = () => {
            // Przywracamy MeshPhongMaterial dla budynków - gwarantuje piękne kolory i ostre światła z prototypu!
            for (let i = 1; i <= 10; i++) {
                const id = String(i).padStart(2, '0');
                synthCityAssets.materials['building_' + id] = new THREE.MeshPhongMaterial({
                    map: synthCityAssets.textures['building_' + id],
                    specular: 0xffffff,
                    specularMap: synthCityAssets.textures['building_' + id + '_spec'] || synthCityAssets.textures['building_' + id + '_rough'],
                    emissiveMap: synthCityAssets.textures['building_' + id + '_em'],
                    emissive: new THREE.Color().setHSL(Math.random(), 1.0, 0.95),
                    emissiveIntensity: 1.5,
                    bumpMap: synthCityAssets.textures['building_' + id],
                    bumpScale: 5
                });
                synthCityAssets.materials['building_' + id].userData.shared = true;
            }

            // Przywracamy materiały reklam z prototypu
            for (let i = 1; i <= 5; i++) {
                const id = '0' + i;
                synthCityAssets.materials['ads_' + id] = new THREE.MeshPhongMaterial({
                    emissive: 0xffffff,
                    emissiveMap: synthCityAssets.textures['ads_' + id],
                    emissiveIntensity: 0.1,
                    blending: THREE.AdditiveBlending,
                    fog: false,
                    side: THREE.DoubleSide
                });
                synthCityAssets.materials['ads_' + id].userData.shared = true;

                synthCityAssets.materials['ads_large_' + id] = new THREE.MeshPhongMaterial({
                    emissive: 0xffffff,
                    emissiveMap: synthCityAssets.textures['ads_large_' + id],
                    emissiveIntensity: 0.12,
                    blending: THREE.AdditiveBlending,
                    fog: false,
                    side: THREE.DoubleSide
                });
                synthCityAssets.materials['ads_large_' + id].userData.shared = true;
            }

            synthCityAssets.materials.ground = new THREE.MeshPhongMaterial({
                map: synthCityAssets.textures.ground,
                emissive: 0x0090ff,
                emissiveMap: synthCityAssets.textures.ground_em,
                emissiveIntensity: 0.2,
                shininess: 0,
                side: THREE.DoubleSide
            });
            synthCityAssets.materials.ground.userData.shared = true;

            synthCityAssets.materials.storefronts = new THREE.MeshPhongMaterial({
                map: synthCityAssets.textures.storefronts,
                emissive: 0xffffff,
                emissiveMap: synthCityAssets.textures.storefronts_em,
                emissiveIntensity: 1.5,
                shininess: 0,
                side: THREE.DoubleSide
            });
            synthCityAssets.materials.storefronts.userData.shared = true;

            synthCityAssets.loaded = true;
            synthCityAssets.loading = false;
            resolve(synthCityAssets);
        };

        manager.onError = (url) => {
            console.warn('[RingCityAssets] Failed to load:', url);
        };

        const basePath = 'assets/synthcity/';

        // Building textures
        for (let i = 1; i <= 10; i++) {
            const id = String(i).padStart(2, '0');
            synthCityAssets.textures['building_' + id] = texLoader.load(basePath + 'textures/building_' + id + '.jpg', t => {
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
                t.colorSpace = THREE.SRGBColorSpace;
            });
            synthCityAssets.textures['building_' + id + '_em'] = texLoader.load(basePath + 'textures/building_' + id + '_em.jpg', t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
            texLoader.load(basePath + 'textures/building_' + id + '_spec.jpg',
                t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; synthCityAssets.textures['building_' + id + '_spec'] = t; },
                undefined,
                () => texLoader.load(basePath + 'textures/building_' + id + '_rough.jpg',
                    t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; synthCityAssets.textures['building_' + id + '_rough'] = t; },
                    undefined, () => {}
                )
            );
        }

        // Ad textures
        for (let i = 1; i <= 5; i++) {
            const id = String(i).padStart(2, '0');
            synthCityAssets.textures['ads_' + id] = texLoader.load(basePath + 'textures/ads_' + id + '.jpg', t => { t.colorSpace = THREE.SRGBColorSpace; });
            synthCityAssets.textures['ads_large_' + id] = texLoader.load(basePath + 'textures/ads_large_' + id + '.jpg', t => { t.colorSpace = THREE.SRGBColorSpace; });
        }

        // Ground/storefront textures from SynthCity.
        synthCityAssets.textures.ground = texLoader.load(basePath + 'textures/ground.jpg', t => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = 8;
            t.colorSpace = THREE.SRGBColorSpace;
        });
        synthCityAssets.textures.ground_em = texLoader.load(basePath + 'textures/ground_em.jpg', t => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = 8;
        });
        synthCityAssets.textures.storefronts = texLoader.load(basePath + 'textures/storefronts_01.jpg', t => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = 8;
            t.colorSpace = THREE.SRGBColorSpace;
        });
        synthCityAssets.textures.storefronts_em = texLoader.load(basePath + 'textures/storefronts_01_em.jpg', t => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = 8;
        });

        // Building models
        const buildingModels = [
            's_01_01', 's_01_02', 's_01_03',
            's_02_01', 's_02_02', 's_02_03',
            's_03_01', 's_03_02', 's_03_03',
            's_04_01', 's_04_02', 's_04_03',
            's_05_01', 's_05_02', 's_05_03'
        ];
        for (const modelId of buildingModels) {
            objLoader.load(basePath + 'models/' + modelId + '.obj',
                obj => { synthCityAssets.models[modelId] = obj.children[0]?.geometry || null; },
                undefined,
                () => console.warn('[RingCityAssets] Missing model:', modelId)
            );
        }

        // Ad structure models
        const adModels = [
            'ads_s_01_01', 'ads_s_01_02',
            'ads_s_02_01', 'ads_s_02_02',
            'ads_s_03_01', 'ads_s_03_02',
            'ads_s_04_01', 'ads_s_04_02', 'ads_s_04_03', 'ads_s_04_04',
            'ads_s_05_01', 'ads_s_05_02', 'ads_s_05_03', 'ads_s_05_04'
        ];
        for (const modelId of adModels) {
            objLoader.load(basePath + 'models/' + modelId + '.obj',
                obj => { synthCityAssets.models[modelId] = obj.children[0]?.geometry || null; },
                undefined,
                () => {} // Ads are optional
            );
        }

        // Topper/hologram models
        for (let i = 1; i <= 12; i++) {
            const id = i < 10 ? '0' + i : i.toString();
            objLoader.load(basePath + 'models/topper_' + id + '.obj',
                obj => { synthCityAssets.models['topper_' + id] = obj.children[0]?.geometry || null; },
                undefined,
                () => {} // Toppers are optional
            );
        }

        // Storefronts model — intersection connector with bridges/pipes at multiple heights
        objLoader.load(basePath + 'models/storefronts.obj',
            obj => {
                // storefronts.obj may have multiple children — merge them into one geometry
                const geos = [];
                obj.traverse(child => {
                    if (child.isMesh && child.geometry) geos.push(child.geometry);
                });
                if (geos.length === 1) {
                    synthCityAssets.models['storefronts'] = geos[0];
                } else if (geos.length > 1) {
                    try {
                        synthCityAssets.models['storefronts'] = BufferGeometryUtils.mergeGeometries(geos, false);
                    } catch (e) {
                        synthCityAssets.models['storefronts'] = geos[0]; // fallback
                    }
                }
            },
            undefined,
            () => console.warn('[RingCityAssets] Missing model: storefronts')
        );
    });
}

// --- Geometry helpers ---
export function cloneSynthCityGeometry(modelId) {
    const original = synthCityAssets.models[modelId];
    if (!original) return null;
    const cloned = original.clone();
    for (const key in original.attributes) {
        cloned.setAttribute(key, original.attributes[key].clone());
    }
    if (original.index) cloned.setIndex(original.index.clone());
    return cloned.index ? cloned.toNonIndexed() : cloned;
}

export function pickSynthBuildingMaterialKey(rand, rare = false) {
    const normalKeys = ['building_01', 'building_02', 'building_03', 'building_04', 'building_05', 'building_07'];
    const rareKeys = ['building_06', 'building_08', 'building_09', 'building_10'];
    return rare ? pickArrayEntry(rand, rareKeys) : pickArrayEntry(rand, normalKeys);
}

export function pickSynthAdMaterialKey(rand, large = false) {
    const pool = large
        ? ['ads_large_01', 'ads_large_02', 'ads_large_03', 'ads_large_04', 'ads_large_05']
        : ['ads_01', 'ads_02', 'ads_03', 'ads_04', 'ads_05'];
    return pickArrayEntry(rand, pool);
}

// --- Procedural canvas textures ---
export function generateWallTexture(zoneColor) {
    const size = 512;
    const cMap = document.createElement('canvas');
    cMap.width = cMap.height = size;
    const ctx = cMap.getContext('2d');
    const cEm = document.createElement('canvas');
    cEm.width = cEm.height = size;
    const ctxE = cEm.getContext('2d');

    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, size, size);
    ctxE.fillStyle = '#000';
    ctxE.fillRect(0, 0, size, size);

    const floorH = 48;
    const windowH = 18;
    for (let floor = 0; floor < Math.ceil(size / floorH); floor++) {
        const y = floor * floorH;
        ctx.fillStyle = '#0d1018';
        ctx.fillRect(0, y, size, 3);

        let wx = 4;
        while (wx < size - 4) {
            const ww = 30 + Math.random() * 80;
            const wy = y + 8 + Math.random() * 6;
            const wh = windowH - 4 + Math.random() * 6;
            const isLit = Math.random() > 0.35;
            if (isLit) {
                const brightness = 0.4 + Math.random() * 0.6;
                ctx.fillStyle = `rgba(255,255,255,${brightness * 0.6})`;
                ctx.fillRect(wx, wy, ww, wh);
                ctxE.fillStyle = `rgba(255,255,255,${brightness})`;
                ctxE.fillRect(wx, wy, ww, wh);
            } else {
                const g = 12 + Math.random() * 18;
                ctx.fillStyle = `rgb(${g},${g + 2},${g + 5})`;
                ctx.fillRect(wx, wy, ww, wh);
            }
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.lineWidth = 2;
            ctx.strokeRect(wx, wy, ww, wh);
            wx += ww + 6 + Math.random() * 12;
        }
    }

    for (let i = 0; i < 3; i++) {
        const y = Math.floor(Math.random() * (size / floorH)) * floorH + 6;
        const h = 4 + Math.random() * 4;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(0, y, size, h);
        ctxE.fillStyle = 'rgba(255,255,255,0.7)';
        ctxE.fillRect(0, y, size, h);
    }

    const mapTex = new THREE.CanvasTexture(cMap);
    mapTex.wrapS = mapTex.wrapT = THREE.RepeatWrapping;
    mapTex.anisotropy = 4;
    mapTex.colorSpace = THREE.SRGBColorSpace;
    const emTex = new THREE.CanvasTexture(cEm);
    emTex.wrapS = emTex.wrapT = THREE.RepeatWrapping;
    emTex.anisotropy = 4;
    return { map: mapTex, emissiveMap: emTex };
}

export function generateRoofTexture() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#08090e';
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 32) {
        for (let y = 0; y < size; y += 32) {
            const g = 8 + Math.random() * 10;
            ctx.fillStyle = `rgb(${g},${g},${g + 2})`;
            ctx.fillRect(x + 1, y + 1, 30, 30);
        }
    }
    for (let i = 0; i < 15; i++) {
        ctx.fillStyle = `rgba(${20 + Math.random() * 20},${25 + Math.random() * 20},${35 + Math.random() * 20},0.8)`;
        const w = 8 + Math.random() * 40;
        ctx.fillRect(Math.random() * size, Math.random() * size, w, w);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

export function generateCircuitFloorTexture(zoneColorCss) {
    const w = 768, h = 768;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#0a1017');
    grad.addColorStop(1, '#071019');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(110,150,190,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i < w; i += 64) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
    }

    ctx.strokeStyle = zoneColorCss;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 6;
    for (let i = 0; i < 18; i++) {
        const sx = 40 + Math.random() * (w - 80);
        const sy = 40 + Math.random() * (h - 80);
        const mx = 40 + Math.random() * (w - 80);
        const ey = 40 + Math.random() * (h - 80);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(mx, sy);
        ctx.lineTo(mx, ey);
        ctx.stroke();
    }

    ctx.globalAlpha = 0.22;
    for (let i = 0; i < 36; i++) {
        const x = 30 + Math.random() * (w - 60);
        const y = 30 + Math.random() * (h - 60);
        ctx.fillStyle = zoneColorCss;
        ctx.beginPath();
        ctx.arc(x, y, 6 + Math.random() * 10, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#d8ecff';
    for (let i = 0; i < 28; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.fillRect(x, y, 32 + Math.random() * 90, 2);
    }
    ctx.globalAlpha = 1.0;

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.9, 1.9);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// --- Material factories ---
export function getZoneMaterials(zone) {
    if (matCache[zone]) return matCache[zone];
    const colorData = COLORS[zone] || COLORS.residential;
    const wallTex = generateWallTexture(colorData.css);
    const roofTex = generateRoofTexture();
    const wallMat = new THREE.MeshStandardMaterial({
        map: wallTex.map,
        emissiveMap: wallTex.emissiveMap,
        emissive: colorData.num,
        emissiveIntensity: 1.6,
        color: 0x445566,
        roughness: 0.65,
        metalness: 0.2
    });
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, color: 0x0a0e16, roughness: 0.95 });
    wallMat.userData.shared = true;
    roofMat.userData.shared = true;
    matCache[zone] = { wall: wallMat, roof: roofMat, mats: [wallMat, wallMat, roofMat, roofMat, wallMat, wallMat] };
    return matCache[zone];
}

export function getDistrictInfrastructureMaterials(zone) {
    const key = `${zone}_infrastructure`;
    if (matCache[key]) return matCache[key];
    const colorData = COLORS[zone] || COLORS.residential;
    const floorTex = generateCircuitFloorTexture(colorData.css);
    const floorMat = new THREE.MeshStandardMaterial({
        map: floorTex,
        color: 0x0b121a,
        emissive: colorData.num,
        emissiveIntensity: 0.12,
        roughness: 0.92,
        metalness: 0.32,
        side: THREE.DoubleSide
    });
    const pathMat = new THREE.MeshStandardMaterial({
        color: 0x121c27,
        emissive: 0x0a131d,
        emissiveIntensity: 0.18,
        roughness: 0.85,
        metalness: 0.48,
        side: THREE.DoubleSide
    });
    const traceMat = new THREE.MeshBasicMaterial({
        color: colorData.num,
        transparent: true,
        opacity: 0.52,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const padMat = new THREE.MeshStandardMaterial({
        color: 0x101a24,
        emissive: colorData.num,
        emissiveIntensity: 0.26,
        roughness: 0.58,
        metalness: 0.42
    });
    const domeMat = new THREE.MeshStandardMaterial({
        color: 0x1a2734,
        emissive: colorData.num,
        emissiveIntensity: 0.10,
        roughness: 0.22,
        metalness: 0.08,
        transparent: true,
        opacity: 0.42
    });
    const domeFrameMat = new THREE.MeshBasicMaterial({
        color: colorData.num,
        transparent: true,
        opacity: 0.26
    });
    floorMat.userData.shared = true;
    pathMat.userData.shared = true;
    traceMat.userData.shared = true;
    padMat.userData.shared = true;
    domeMat.userData.shared = true;
    domeFrameMat.userData.shared = true;
    matCache[key] = { floor: floorMat, path: pathMat, trace: traceMat, pad: padMat, dome: domeMat, domeFrame: domeFrameMat };
    return matCache[key];
}

// --- Geometry face extraction helper ---
export function extractFacesFromNonIndexed(sourceGeo, validIndices) {
    const count = validIndices.length;
    const geo = new THREE.BufferGeometry();
    for (const attrName in sourceGeo.attributes) {
        const sourceAttr = sourceGeo.attributes[attrName];
        const itemSize = sourceAttr.itemSize;
        const arr = new Float32Array(count * itemSize);
        for (let i = 0; i < count; i++) {
            const srcIdx = validIndices[i];
            for (let c = 0; c < itemSize; c++) {
                arr[i * itemSize + c] = sourceAttr.array[srcIdx * itemSize + c];
            }
        }
        geo.setAttribute(attrName, new THREE.BufferAttribute(arr, itemSize));
    }
    return geo;
}
