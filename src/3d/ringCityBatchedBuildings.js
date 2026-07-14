import * as THREE from 'three';
import { Core3D } from './core3d.js';
import {
    RING_INNER,
    ZONE_COLS,
    getZoneFamily
} from './ringCityZoneGrid.js';
import {
    cloneSynthCityGeometry,
    synthCityAssets
} from './ringCityAssets.js';
import {
    composeInwardCityMatrix,
    getOutwardDomeClearance,
    resolveOutwardCitySurface,
    SYNTHCITY_BLOCK_SIZE,
    SYNTHCITY_PITCH,
    SYNTHCITY_RIBBON_ROWS
} from './ringCitySurface.js';

const TAU = Math.PI * 2;

const SMALL_MODELS = Object.freeze([
    's_01_01', 's_01_02', 's_01_03',
    's_02_01', 's_02_02', 's_02_03',
    's_03_01', 's_03_02', 's_03_03'
]);
const BIG_MODELS = Object.freeze([
    's_04_01', 's_04_02', 's_04_03',
    's_05_01', 's_05_02', 's_05_03'
]);
const MEGA_MODELS = Object.freeze([
    'mega_01', 'mega_02', 'mega_03',
    'mega_04', 'mega_05', 'mega_06'
]);
const CITY_MODELS = Object.freeze([...SMALL_MODELS, ...BIG_MODELS]);
const ALL_MODELS = Object.freeze([...CITY_MODELS, ...MEGA_MODELS]);
const MODEL_INDEX = new Map(ALL_MODELS.map((id, index) => [id, index]));

const BUILDING_MATERIAL_KEYS = Object.freeze([
    'building_01', 'building_02', 'building_03', 'building_04', 'building_05',
    'building_06', 'building_07', 'building_08', 'building_09', 'building_10'
]);
const NORMAL_MATERIALS = Object.freeze([0, 1, 2, 3, 4, 6]);
const RARE_MATERIALS = Object.freeze([5, 7, 8, 9]);

const FAR_PROXY_MATERIAL = 10;
const MEGA_MATERIAL = 11;
const STOREFRONT_MATERIAL = 12;
const MATERIAL_BUCKETS = 13;

export const OUTWARD_CITY_BATCH_DRAWS = MATERIAL_BUCKETS;
export const OUTWARD_CITY_SECTOR_COUNT = 32;

function hash32(seed, col, row, salt) {
    let value = (Number(seed) >>> 0) ^ Math.imul((col + 1) | 0, 0x9e3779b1);
    value ^= Math.imul((row + 1) | 0, 0x85ebca77);
    value ^= Math.imul((salt + 1) | 0, 0xc2b2ae3d);
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return value >>> 0;
}

function random01(seed, col, row, salt) {
    return hash32(seed, col, row, salt) / 4294967296;
}

function wrapAngle(angle) {
    let value = angle % TAU;
    if (value < 0) value += TAU;
    return value;
}

function stringSeed(value) {
    const text = String(value || 'ring');
    let seed = 2166136261;
    for (let i = 0; i < text.length; i++) {
        seed ^= text.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
    }
    return seed >>> 0;
}

export function computeOutwardCityGrid(layout) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return null;
    const columns = Math.max(64, Math.round(surface.circumference / SYNTHCITY_PITCH));
    return {
        surface,
        columns,
        rows: SYNTHCITY_RIBBON_ROWS,
        pitchAround: surface.circumference / columns,
        pitchAcross: surface.width / SYNTHCITY_RIBBON_ROWS
    };
}

export function getSynthCityBlockCenters(pitch = SYNTHCITY_PITCH) {
    const scale = Math.max(0.0001, Number(pitch) || SYNTHCITY_PITCH) / SYNTHCITY_PITCH;
    return [32 * scale, 96 * scale];
}

function getCellZone(zoneGrid, col, row, columns, seed) {
    const zoneCol = Math.min(
        ZONE_COLS - 1,
        Math.max(0, Math.floor((col / Math.max(1, columns)) * ZONE_COLS))
    );
    const zone = zoneGrid?.getCell?.(zoneCol, row)?.zone;
    if (zone) return zone;
    return random01(seed, col, row, 91) < 0.6 ? 'residential' : 'commercial';
}

function pickSmallModel(seed, col, row, slot, zone) {
    const family = getZoneFamily(zone);
    const familyOffset = family === 'commercial' ? 3 : 0;
    const index = (familyOffset + Math.floor(random01(seed, col, row, 10 + slot) * SMALL_MODELS.length)) % SMALL_MODELS.length;
    return SMALL_MODELS[index];
}

function pickBigModel(seed, col, row, zone) {
    const family = getZoneFamily(zone);
    const offset = family === 'commercial' ? 3 : 0;
    return BIG_MODELS[(offset + Math.floor(random01(seed, col, row, 31) * BIG_MODELS.length)) % BIG_MODELS.length];
}

function pickBuildingMaterial(seed, col, row, slot, zone, isBig) {
    const family = getZoneFamily(zone);
    const rareChance = isBig ? 0.72 : family === 'commercial' ? 0.22 : 0.1;
    const rare = random01(seed, col, row, 50 + slot) < rareChance;
    const pool = rare ? RARE_MATERIALS : NORMAL_MATERIALS;
    return pool[Math.min(pool.length - 1, Math.floor(random01(seed, col, row, 70 + slot) * pool.length))];
}

/**
 * Visits the exact SynthCity 128+24 layout without allocating placement
 * objects.  Small blocks retain the original 2x2 centers at 32/96; the final
 * 24 units of every pitch remain a clear road.
 */
function visitCityLayout(grid, zoneGrid, seed, handlers = {}) {
    const aroundScale = grid.pitchAround / SYNTHCITY_PITCH;
    const acrossScale = grid.pitchAcross / SYNTHCITY_PITCH;
    const smallCentersAround = getSynthCityBlockCenters(grid.pitchAround);
    const smallCentersAcross = getSynthCityBlockCenters(grid.pitchAcross);
    const blockCenterAround = (SYNTHCITY_BLOCK_SIZE * 0.5) * aroundScale;
    const blockCenterAcross = (SYNTHCITY_BLOCK_SIZE * 0.5) * acrossScale;

    for (let col = 0; col < grid.columns; col++) {
        const blockArcStart = col * grid.pitchAround;
        for (let row = 0; row < grid.rows; row++) {
            const zone = getCellZone(zoneGrid, col, row, grid.columns, seed);
            const density = random01(seed, col, row, 0);
            if (density < 0.1) continue;

            const blockSourceStart = grid.surface.sourceInnerRadius + row * grid.pitchAcross;
            handlers.block?.(
                col,
                row,
                wrapAngle((blockArcStart + blockCenterAround) / grid.surface.baseRadius),
                blockSourceStart + blockCenterAcross,
                zone,
                density
            );

            const mega = (col % 6) === 0 && (row === 2 || row === 5) &&
                random01(seed, col, row, 1) < 0.08;
            if (mega) {
                const modelId = MEGA_MODELS[Math.floor(random01(seed, col, row, 2) * MEGA_MODELS.length)];
                handlers.building?.(
                    MEGA_MATERIAL,
                    MODEL_INDEX.get(modelId),
                    wrapAngle((blockArcStart + blockCenterAround) / grid.surface.baseRadius),
                    blockSourceStart + blockCenterAcross,
                    Math.floor(random01(seed, col, row, 3) * 4) * Math.PI * 0.5,
                    110,
                    0.55 + random01(seed, col, row, 4) * 0.24,
                    col
                );
                continue;
            }

            if (density < 0.8) {
                for (let across = 0; across < 2; across++) {
                    for (let along = 0; along < 2; along++) {
                        const slot = across * 2 + along;
                        const modelId = pickSmallModel(seed, col, row, slot, zone);
                        handlers.building?.(
                            pickBuildingMaterial(seed, col, row, slot, zone, false),
                            MODEL_INDEX.get(modelId),
                            wrapAngle((blockArcStart + smallCentersAround[along]) / grid.surface.baseRadius),
                            blockSourceStart + smallCentersAcross[across],
                            Math.floor(random01(seed, col, row, 20 + slot) * 4) * Math.PI * 0.5,
                            29,
                            0.75 + random01(seed, col, row, 40 + slot) * 0.45,
                            col
                        );
                    }
                }
            } else {
                const modelId = pickBigModel(seed, col, row, zone);
                handlers.building?.(
                    pickBuildingMaterial(seed, col, row, 0, zone, true),
                    MODEL_INDEX.get(modelId),
                    wrapAngle((blockArcStart + blockCenterAround) / grid.surface.baseRadius),
                    blockSourceStart + blockCenterAcross,
                    Math.floor(random01(seed, col, row, 32) * 4) * Math.PI * 0.5,
                    57,
                    1 + random01(seed, col, row, 33) * 0.42,
                    col
                );
            }
        }
    }
}

function prepareGeometry(modelId) {
    const geometry = cloneSynthCityGeometry(modelId);
    if (!geometry?.hasAttribute('position')) {
        geometry?.dispose?.();
        return null;
    }
    if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
    if (!geometry.hasAttribute('uv')) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(geometry.attributes.position.count * 2, 2));
    }
    geometry.computeBoundingBox();
    const sourceBounds = geometry.boundingBox;
    geometry.translate(
        -(sourceBounds.min.x + sourceBounds.max.x) * 0.5,
        -sourceBounds.min.y,
        -(sourceBounds.min.z + sourceBounds.max.z) * 0.5
    );
    geometry.rotateX(Math.PI / 2);
    geometry.groups = [];
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const bounds = geometry.boundingBox;
    return {
        id: modelId,
        geometry,
        footprint: Math.max(
            1,
            (bounds.max.x - bounds.min.x) * 0.5,
            (bounds.max.y - bounds.min.y) * 0.5
        ),
        height: Math.max(1, bounds.max.z - bounds.min.z)
    };
}

function createBatch(maxInstances, metas, material, name, lodLevel) {
    if (!(maxInstances > 0) || !material || !metas.length) return null;
    let maxVertices = 0;
    let maxIndices = 0;
    for (const meta of metas) {
        maxVertices += meta.geometry.attributes.position.count;
        maxIndices += meta.geometry.index?.count || 0;
    }
    const mesh = new THREE.BatchedMesh(
        maxInstances,
        Math.max(1, maxVertices),
        Math.max(1, maxIndices),
        material
    );
    mesh.name = name;
    // The complete 360-degree city stays generated, but BatchedMesh only sends
    // instances intersecting the current camera frustum to the GPU. Keeping
    // this disabled submitted several million off-screen triangles in Ultra.
    mesh.perObjectFrustumCulled = true;
    mesh.sortObjects = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.lodLevel = lodLevel;
    mesh.userData.fgCategory = 'buildings';
    const geometryIds = new Int32Array(ALL_MODELS.length);
    geometryIds.fill(-1);
    const geometryIdsByName = new Map();
    for (const meta of metas) {
        const geometryId = mesh.addGeometry(meta.geometry);
        geometryIdsByName.set(meta.id, geometryId);
        const modelIndex = MODEL_INDEX.get(meta.id);
        if (modelIndex !== undefined) geometryIds[modelIndex] = geometryId;
    }
    return {
        mesh,
        geometryIds,
        geometryIdsByName
    };
}

function writeBuildingMatrix(layout, meta, angle, sourceRadius, yaw, targetHalf, heightScale, scratch) {
    const fit = Math.min(1, Math.max(0.05, targetHalf / meta.footprint));
    const maxHeight = Math.max(20, getOutwardDomeClearance(sourceRadius, layout) - 34);
    const safeHeightScale = Math.min(heightScale, maxHeight / meta.height);
    composeInwardCityMatrix(angle, sourceRadius, layout, scratch.frame);
    scratch.local.makeRotationZ(yaw);
    scratch.scale.set(fit, fit, Math.max(0.08, safeHeightScale));
    scratch.local.scale(scratch.scale);
    return scratch.frame.multiply(scratch.local);
}

function finalizeBatch(mesh) {
    if (!mesh) return;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
}

function disposeBatchedGroup(group, ownedMaterials) {
    if (!group || group.userData.disposed) return;
    group.userData.disposed = true;
    if (group.parent) group.parent.remove(group);
    group.traverse((object) => {
        if (object.isBatchedMesh) object.dispose();
    });
    for (const material of ownedMaterials) material.dispose?.();
    group.clear();
}

export function buildOutwardBatchedCity(zoneGrid, ring) {
    if (!zoneGrid || !ring?.ringFloor || ring.citySurfaceMode !== 'inward') return [];
    const grid = computeOutwardCityGrid(ring.layout);
    if (!grid) return [];

    const seed = (stringSeed(ring.key) ^ Math.imul(Math.round(ring.layout?.planetR || 1), 2654435761)) >>> 0;
    const counts = new Int32Array(MATERIAL_BUCKETS);
    visitCityLayout(grid, zoneGrid, seed, {
        building(materialIndex) { counts[materialIndex]++; },
        block() { counts[FAR_PROXY_MATERIAL]++; }
    });
    counts[STOREFRONT_MATERIAL] = Math.ceil(grid.columns / 2) * Math.ceil(grid.rows / 2);

    const metas = ALL_MODELS.map(prepareGeometry);
    const cityMetas = metas.slice(0, CITY_MODELS.length).filter(Boolean);
    const megaMetas = metas.slice(CITY_MODELS.length).filter(Boolean);
    const metaByIndex = metas;
    const group = new THREE.Group();
    group.name = `RingSynthCityBatched:${ring.key || 'ring'}`;
    group.userData.fgCategory = 'buildings';
    const batches = new Array(MATERIAL_BUCKETS).fill(null);
    const ownedMaterials = [];

    for (let materialIndex = 0; materialIndex < BUILDING_MATERIAL_KEYS.length; materialIndex++) {
        const material = synthCityAssets.materials[BUILDING_MATERIAL_KEYS[materialIndex]];
        const batch = createBatch(
            counts[materialIndex],
            cityMetas,
            material,
            `RingCityBuildings:${ring.key}:${BUILDING_MATERIAL_KEYS[materialIndex]}`,
            'BUILDING'
        );
        batches[materialIndex] = batch;
        if (batch) group.add(batch.mesh);
    }

    const megaBatch = createBatch(
        counts[MEGA_MATERIAL],
        megaMetas,
        synthCityAssets.materials.mega_building_01,
        `RingCityMegas:${ring.key}`,
        'BUILDING'
    );
    batches[MEGA_MATERIAL] = megaBatch;
    if (megaBatch) group.add(megaBatch.mesh);

    const storefrontMeta = prepareGeometry('storefronts');
    const storefrontBatch = storefrontMeta ? createBatch(
        counts[STOREFRONT_MATERIAL],
        [storefrontMeta],
        synthCityAssets.materials.storefronts,
        `RingCityStorefronts:${ring.key}`,
        'MEDIUM'
    ) : null;
    batches[STOREFRONT_MATERIAL] = storefrontBatch;
    if (storefrontBatch) group.add(storefrontBatch.mesh);

    const farMaterial = new THREE.MeshBasicMaterial({ color: 0x2a4052, fog: true });
    farMaterial.userData.shared = false;
    ownedMaterials.push(farMaterial);
    const farMeta = {
        id: '__far_proxy__',
        geometry: new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5),
        footprint: 0.5,
        height: 1
    };
    const farBatchMesh = new THREE.BatchedMesh(
        Math.max(1, counts[FAR_PROXY_MATERIAL]),
        farMeta.geometry.attributes.position.count,
        farMeta.geometry.index?.count || 1,
        farMaterial
    );
    const farGeometryId = farBatchMesh.addGeometry(farMeta.geometry);
    farBatchMesh.name = `RingCityFarProxy:${ring.key}`;
    farBatchMesh.perObjectFrustumCulled = true;
    farBatchMesh.sortObjects = false;
    farBatchMesh.castShadow = false;
    farBatchMesh.receiveShadow = false;
    farBatchMesh.visible = false;
    farBatchMesh.userData.lodLevel = 'FAR_PROXY';
    farBatchMesh.userData.fgCategory = 'buildings';
    group.add(farBatchMesh);
    const farBatch = {
        mesh: farBatchMesh,
        geometryIds: null,
        geometryIdsByName: null
    };
    batches[FAR_PROXY_MATERIAL] = farBatch;

    const scratch = {
        frame: new THREE.Matrix4(),
        local: new THREE.Matrix4(),
        scale: new THREE.Vector3()
    };
    let placedBuildings = 0;
    let placedProxies = 0;
    visitCityLayout(grid, zoneGrid, seed, {
        building(materialIndex, modelIndex, angle, sourceRadius, yaw, targetHalf, heightScale) {
            const batch = batches[materialIndex];
            const meta = metaByIndex[modelIndex];
            if (!batch || !meta) return;
            const geometryId = batch.geometryIds[modelIndex];
            if (geometryId < 0) return;
            const instanceId = batch.mesh.addInstance(geometryId);
            batch.mesh.setMatrixAt(
                instanceId,
                writeBuildingMatrix(ring.layout, meta, angle, sourceRadius, yaw, targetHalf, heightScale, scratch)
            );
            placedBuildings++;
        },
        block(col, row, angle, sourceRadius, zone, density) {
            const instanceId = farBatchMesh.addInstance(farGeometryId);
            const clearance = getOutwardDomeClearance(sourceRadius, ring.layout);
            const height = Math.max(70, Math.min(clearance - 32, 115 + density * 260));
            composeInwardCityMatrix(angle, sourceRadius, ring.layout, scratch.frame);
            scratch.local.identity();
            scratch.scale.set(SYNTHCITY_BLOCK_SIZE * 0.86, SYNTHCITY_BLOCK_SIZE * 0.86, height);
            scratch.local.scale(scratch.scale);
            farBatchMesh.setMatrixAt(instanceId, scratch.frame.multiply(scratch.local));
            placedProxies++;
        }
    });

    if (storefrontBatch && storefrontMeta) {
        const directGeometryId = storefrontBatch.geometryIdsByName.get('storefronts');
        if (directGeometryId >= 0) {
            const aroundScale = grid.pitchAround / SYNTHCITY_PITCH;
            const acrossScale = grid.pitchAcross / SYNTHCITY_PITCH;
            for (let col = 0; col < grid.columns; col += 2) {
                for (let row = 0; row < grid.rows; row += 2) {
                    const arc = col * grid.pitchAround + 140 * aroundScale;
                    const sourceRadius = grid.surface.sourceInnerRadius + row * grid.pitchAcross + 140 * acrossScale;
                    const instanceId = storefrontBatch.mesh.addInstance(directGeometryId);
                    composeInwardCityMatrix(wrapAngle(arc / grid.surface.baseRadius), sourceRadius, ring.layout, scratch.frame);
                    scratch.local.identity();
                    scratch.scale.set(aroundScale, acrossScale, 1);
                    scratch.local.scale(scratch.scale);
                    storefrontBatch.mesh.setMatrixAt(instanceId, scratch.frame.multiply(scratch.local));
                }
            }
        }
    }

    for (const batch of batches) finalizeBatch(batch?.mesh);
    for (const meta of metas) meta?.geometry?.dispose?.();
    storefrontMeta?.geometry?.dispose?.();
    farMeta.geometry.dispose?.();

    if (Core3D?.enableForeground3D) Core3D.enableForeground3D(group);
    ring.ringFloor.add(group);
    group.userData.cityStats = {
        blocks: placedProxies,
        buildings: placedBuildings,
        storefronts: counts[STOREFRONT_MATERIAL],
        batchedDraws: group.children.length,
        columns: grid.columns,
        rows: grid.rows,
        visibleSectors: OUTWARD_CITY_SECTOR_COUNT
    };

    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        disposeBatchedGroup(group, ownedMaterials);
    };
    return [{
        mesh: group,
        ringId: RING_INNER,
        isDistrict: true,
        isChunk: true,
        isOutwardBatchedCity: true,
        chunkIndex: -1,
        dynamicDecorations: [],
        dispose,
        stats: group.userData.cityStats
    }];
}
