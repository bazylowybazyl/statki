// ============================================================
// Ring City Buildings — Procedural building generation per zone cell
// OPTIMIZED v2: Chunk-based cross-cell merge
// Buildings merged into ~16 angular chunks × ~10 materials = ~160 meshes
// Down from 600 cells × 8 materials = ~4800 meshes
// ============================================================
import * as THREE from 'three';
import { Core3D } from './core3d.js';
import {
    ZONE_COLS, ZONE_PAD_ANGLE, ZONE_PAD_RADIUS,
    AUTOSTRADA_WIDTH,
    RING_INNER, RING_INDUSTRIAL, RING_MILITARY,
    COLORS, createSeededRandom, hashZoneSeed,
    getZoneFamily, isMegaZone, getZoneTargetBuildingCount,
    pickArrayEntry
} from './ringCityZoneGrid.js';
import {
    BufferGeometryUtils,
    synthCityAssets,
    cloneSynthCityGeometry,
    pickSynthBuildingMaterialKey,
    pickSynthAdMaterialKey,
    getZoneMaterials,
    extractFacesFromNonIndexed
} from './ringCityAssets.js';

// --- Constants ---
const WINDOW_SCALE = 500;
const NUM_CHUNKS = 16;
const CHUNK_ARC = (Math.PI * 2) / NUM_CHUNKS;

// LOD levels per material — controls visibility at different camera distances
const LOD_LEVEL_BY_MAT = {
    wall: 'CORE',
    roof: 'CORE',
    neonSign: 'MEDIUM',
    chimney: 'MEDIUM',
    roofDetail: 'DETAIL',
    antennaRed: 'DETAIL',
    antennaGreen: 'DETAIL',
    padSign: 'DETAIL',
    dish: 'DETAIL',
};

// --- Material dict cache per zone ---
const matDictCache = {};

// ============================================================
// DYNAMICZNE HOLOGRAMY I REKLAMY
// ============================================================
export class RingDynamicAdvert {
    constructor({ x, y, z, scaleX = 1, scaleZ = 1, rotationZ = 0, modelId, materialKeys, zoneCellKey }) {
        const geo = cloneSynthCityGeometry(modelId);
        if (!geo) return;

        const materialKey = Array.isArray(materialKeys) ? materialKeys[0] : materialKeys;
        const material = synthCityAssets.materials[materialKey];
        if (!material) { geo.dispose?.(); return; }

        this.mesh = new THREE.Mesh(geo, material);
        this.mesh.rotation.x = Math.PI / 2;
        this.mesh.rotation.z = rotationZ;
        this.mesh.position.set(x, y, z);
        this.mesh.scale.set(scaleX, scaleX, scaleZ);

        this.materialKeys = Array.isArray(materialKeys) ? materialKeys.slice() : [materialKeys];
        this.zoneCellKey = zoneCellKey || '';
        this.switchTimer = 200 + Math.random() * 800;
        this.switchElapsed = Math.random() * this.switchTimer;
        this.switches = Math.random() < 0.5;
    }

    update(dt) {
        if (!this.mesh || !this.switches || this.materialKeys.length <= 1) return;
        this.switchElapsed += dt * 60;
        if (this.switchElapsed < this.switchTimer) return;
        this.switchElapsed = 0;
        const nextKey = this.materialKeys[Math.floor(Math.random() * this.materialKeys.length)];
        const nextMaterial = synthCityAssets.materials[nextKey];
        if (nextMaterial) this.mesh.material = nextMaterial;
    }
}

export class RingDynamicTopper {
    constructor({ x, y, z, scale = 1, rotationZ = 0, modelId, materialKey, zoneCellKey }) {
        const geo = cloneSynthCityGeometry(modelId);
        const material = synthCityAssets.materials[materialKey];
        if (!geo || !material) { geo?.dispose?.(); return; }

        this.mesh = new THREE.Mesh(geo, material);
        this.mesh.rotation.x = Math.PI / 2;
        this.mesh.rotation.z = rotationZ;
        this.mesh.position.set(x, y, z);
        this.mesh.scale.set(scale, scale, scale);

        this.rotationSpeed = Math.random() <= 0.5 ? Math.random() * 0.01 : -Math.random() * 0.01;
        this.zoneCellKey = zoneCellKey || '';
    }

    update(dt) {
        if (!this.mesh) return;
        this.mesh.rotation.y += this.rotationSpeed * dt * 60;
    }
}

function getMatDict(zone) {
    if (matDictCache[zone]) return matDictCache[zone];
    const mats = getZoneMaterials(zone);
    const neonColor = COLORS[zone]?.num || 0x00f3ff;
    matDictCache[zone] = {
        mats: mats.mats,
        wall: mats.wall,
        roof: mats.roof,
        neonSign: new THREE.MeshBasicMaterial({ color: neonColor, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
        roofDetail: new THREE.MeshStandardMaterial({ color: 0x1a1e28, roughness: 0.8 }),
        chimney: new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.8 }),
        antennaRed: new THREE.MeshBasicMaterial({ color: 0xff0000 }),
        antennaGreen: new THREE.MeshBasicMaterial({ color: 0x00ff88 }),
        padSign: new THREE.MeshBasicMaterial({ color: 0x228866, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
        dish: new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.3, metalness: 0.7, side: THREE.DoubleSide }),
        neonEdges: new THREE.LineBasicMaterial({ color: neonColor, transparent: true, opacity: 0.15 })
    };
    return matDictCache[zone];
}

// ============================================================
// addBox — Z-up box with wall/roof UV separation
// ============================================================
function addBox(geoMap, w, d, h, baseZ, matName, offsetX, offsetY) {
    const geo = new THREE.BoxGeometry(w, d, h);
    const nonIndexedGeo = geo.toNonIndexed();

    const pos = nonIndexedGeo.attributes.position;
    const uv = nonIndexedGeo.attributes.uv;
    const nor = nonIndexedGeo.attributes.normal;

    const wallIndices = [];
    const roofIndices = [];

    for (let i = 0; i < uv.count; i++) {
        const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);

        if (Math.abs(nz) > 0.5) {
            uv.setXY(i, px / WINDOW_SCALE, (nz > 0 ? -py : py) / WINDOW_SCALE);
            roofIndices.push(i);
        } else {
            if (Math.abs(nx) > 0.5) uv.setXY(i, (nx > 0 ? -py : py) / WINDOW_SCALE, pz / WINDOW_SCALE);
            else if (Math.abs(ny) > 0.5) uv.setXY(i, (ny > 0 ? px : -px) / WINDOW_SCALE, pz / WINDOW_SCALE);
            wallIndices.push(i);
        }
    }

    nonIndexedGeo.translate(offsetX || 0, offsetY || 0, baseZ + h / 2);

    if (matName === 'mats') {
        const wallGeo = extractFacesFromNonIndexed(nonIndexedGeo, wallIndices);
        const roofGeo = extractFacesFromNonIndexed(nonIndexedGeo, roofIndices);
        geoMap['wall'] = geoMap['wall'] || [];
        geoMap['wall'].push(wallGeo);
        geoMap['roof'] = geoMap['roof'] || [];
        geoMap['roof'].push(roofGeo);
    } else {
        geoMap[matName] = geoMap[matName] || [];
        geoMap[matName].push(nonIndexedGeo);
    }
    return nonIndexedGeo;
}

// ============================================================
// addRoofDetails — AC units, antennas, landing pads (Z-up)
// ============================================================
function addRoofDetails(geoMap, topZ, zone, rnd) {
    const nAC = Math.floor(rnd() * 4);
    for (let i = 0; i < nAC; i++) {
        const acW = 14 + rnd() * 16;
        const acH = 8 + rnd() * 10;
        const acGeo = new THREE.BoxGeometry(acW, acW, acH);
        acGeo.translate((rnd() - 0.5) * 60, (rnd() - 0.5) * 60, topZ + acH / 2);
        geoMap['roofDetail'] = geoMap['roofDetail'] || [];
        geoMap['roofDetail'].push(acGeo);
    }
    if (rnd() > 0.5) {
        const antH = 20 + rnd() * 40;
        const antGeo = new THREE.CylinderGeometry(1.5, 1.5, antH, 4);
        antGeo.rotateX(Math.PI / 2);
        const antX = (rnd() - 0.5) * 40;
        const antY = (rnd() - 0.5) * 40;
        antGeo.translate(antX, antY, topZ + antH / 2);
        geoMap['roofDetail'] = geoMap['roofDetail'] || [];
        geoMap['roofDetail'].push(antGeo);

        const tipGeo = new THREE.SphereGeometry(3, 6, 6);
        tipGeo.translate(antX, antY, topZ + antH);
        const colorKey = zone === 'military' ? 'antennaRed' : 'antennaGreen';
        geoMap[colorKey] = geoMap[colorKey] || [];
        geoMap[colorKey].push(tipGeo);
    }
    if (rnd() > 0.7) {
        const padR = 18 + rnd() * 12;
        const padGeo = new THREE.RingGeometry(padR * 0.7, padR, 16);
        padGeo.translate(0, 0, topZ + 1);
        geoMap['padSign'] = geoMap['padSign'] || [];
        geoMap['padSign'].push(padGeo);
    }
}

// ============================================================
// addNeonEdges
// ============================================================
function addNeonEdges(geoMap, sourceGeo) {
    if (!sourceGeo) return;
    const edges = new THREE.EdgesGeometry(sourceGeo);
    geoMap['neonEdges'] = geoMap['neonEdges'] || [];
    geoMap['neonEdges'].push(edges);
}

// ============================================================
// createBuilding — single building generation in Z-up local space
// ============================================================
function createBuilding(zone, geoMap, rnd, skipDetails = false) {
    let totalH = 0;
    let footprintRadius = 80;
    let useTopper = false;
    let adsType = null;
    let modelId = null;
    let rotateZ = 0;
    let scaleXY = 1;
    let scaleZ = 1;
    const zoneFamily = getZoneFamily(zone);
    const megaZone = isMegaZone(zone);

    if (zoneFamily === 'residential' || zoneFamily === 'commercial') {
        const typeNoise = rnd();
        const subtypeNoise = rnd();
        const rotateNoise = rnd();
        rotateZ = (Math.floor(rotateNoise * 4) * 90) * Math.PI / 180;
        let rareMaterial = false;

        if (zoneFamily === 'residential') {
            if (megaZone) {
                if (typeNoise < 0.7) {
                    modelId = pickArrayEntry(rnd, ['s_04_01', 's_04_02', 's_04_03']);
                    adsType = pickArrayEntry(rnd, ['ads_s_04_01', 'ads_s_04_02', 'ads_s_04_03', 'ads_s_04_04']);
                    rareMaterial = subtypeNoise > 0.45;
                } else {
                    modelId = pickArrayEntry(rnd, ['s_05_01', 's_05_02', 's_05_03']);
                    adsType = pickArrayEntry(rnd, ['ads_s_05_01', 'ads_s_05_02', 'ads_s_05_03', 'ads_s_05_04']);
                    rareMaterial = true;
                    useTopper = rnd() > 0.45;
                }
            } else if (typeNoise < 0.267) {
                modelId = pickArrayEntry(rnd, ['s_01_01', 's_01_02', 's_01_03']);
                adsType = rnd() > 0.5 ? 'ads_s_01_01' : 'ads_s_01_02';
            } else if (typeNoise < 0.534) {
                modelId = pickArrayEntry(rnd, ['s_02_01', 's_02_02', 's_02_03']);
                adsType = rnd() > 0.5 ? 'ads_s_02_01' : 'ads_s_02_02';
            } else if (typeNoise < 0.8) {
                modelId = pickArrayEntry(rnd, ['s_03_01', 's_03_02', 's_03_03']);
                adsType = rnd() > 0.5 ? 'ads_s_03_01' : 'ads_s_03_02';
                useTopper = rnd() > 0.965;
            } else if (typeNoise < 0.975) {
                modelId = pickArrayEntry(rnd, ['s_04_01', 's_04_02', 's_04_03']);
                adsType = pickArrayEntry(rnd, ['ads_s_04_01', 'ads_s_04_02', 'ads_s_04_03', 'ads_s_04_04']);
                rareMaterial = subtypeNoise > 0.88;
            } else {
                modelId = pickArrayEntry(rnd, ['s_05_01', 's_05_02', 's_05_03']);
                adsType = pickArrayEntry(rnd, ['ads_s_05_01', 'ads_s_05_02', 'ads_s_05_03', 'ads_s_05_04']);
                rareMaterial = true;
                useTopper = rnd() > 0.78;
            }
        } else { // commercial
            if (megaZone) {
                if (typeNoise < 0.35) {
                    modelId = pickArrayEntry(rnd, ['s_04_01', 's_04_02', 's_04_03']);
                    adsType = pickArrayEntry(rnd, ['ads_s_04_01', 'ads_s_04_02', 'ads_s_04_03', 'ads_s_04_04']);
                    rareMaterial = true;
                    useTopper = rnd() > 0.5;
                } else {
                    modelId = pickArrayEntry(rnd, ['s_05_01', 's_05_02', 's_05_03']);
                    adsType = pickArrayEntry(rnd, ['ads_s_05_01', 'ads_s_05_02', 'ads_s_05_03', 'ads_s_05_04']);
                    rareMaterial = true;
                }
                    useTopper = rnd() > 0.3;
            } else if (typeNoise < 0.30) {
                modelId = pickArrayEntry(rnd, ['s_02_01', 's_02_02', 's_02_03']);
                adsType = rnd() > 0.5 ? 'ads_s_02_01' : 'ads_s_02_02';
            } else if (typeNoise < 0.62) {
                modelId = pickArrayEntry(rnd, ['s_03_01', 's_03_02', 's_03_03']);
                adsType = rnd() > 0.5 ? 'ads_s_03_01' : 'ads_s_03_02';
                useTopper = rnd() > 0.94;
            } else if (typeNoise < 0.90) {
                modelId = pickArrayEntry(rnd, ['s_04_01', 's_04_02', 's_04_03']);
                adsType = pickArrayEntry(rnd, ['ads_s_04_01', 'ads_s_04_02', 'ads_s_04_03', 'ads_s_04_04']);
                rareMaterial = rnd() > 0.6;
            } else {
                modelId = pickArrayEntry(rnd, ['s_05_01', 's_05_02', 's_05_03']);
                adsType = pickArrayEntry(rnd, ['ads_s_05_01', 'ads_s_05_02', 'ads_s_05_03', 'ads_s_05_04']);
                rareMaterial = true;
                useTopper = rnd() > 0.55;
            }
        }

        const geo = cloneSynthCityGeometry(modelId);
        if (geo) {
            const GLOBAL_SCALE = 3.0;
            scaleXY = GLOBAL_SCALE;
            scaleZ = GLOBAL_SCALE * (0.75 + rnd() * 0.45);
            const isBig = modelId.startsWith('s_04') || modelId.startsWith('s_05');
            if (isBig) {
                const uniformScale = (1.0 + rotateNoise * 0.5) * GLOBAL_SCALE;
                scaleXY = uniformScale;
                scaleZ = uniformScale;
            }

            geo.rotateX(Math.PI / 2);
            geo.scale(scaleXY, scaleXY, scaleZ);
            geo.rotateZ(rotateZ);

            const matKey = pickSynthBuildingMaterialKey(rnd, rareMaterial);
            geoMap[matKey] = geoMap[matKey] || [];
            geoMap[matKey].push(geo);

            totalH = modelId.startsWith('s_05')
                ? 240 * scaleZ
                : modelId.startsWith('s_04')
                    ? 210 * scaleZ
                    : 190 * scaleZ;
            footprintRadius = Math.max(footprintRadius, 85 * scaleXY);
        } else {
            const podiumH = 14 + rnd() * 16;
            const towerW = 50 + rnd() * 40;
            const towerD = 50 + rnd() * 50;
            const towerH = 140 + rnd() * 120;

            addBox(geoMap, towerW * 1.12, towerD * 1.12, podiumH, 0, 'mats');
            addBox(geoMap, towerW, towerD, towerH, podiumH, 'mats');

            totalH = podiumH + towerH;
            footprintRadius = Math.max(footprintRadius, Math.max(towerW, towerD) * 0.6);
        }
    } else if (zone === 'industrial') {
        const baseW = 200 + rnd() * 250, baseD = 200 + rnd() * 200, baseH = 40 + rnd() * 60;
        footprintRadius = Math.max(footprintRadius, Math.max(baseW, baseD) * 0.54);
        addBox(geoMap, baseW, baseD, baseH, 0, 'mats');
        totalH = baseH;

        const nSilos = 1 + Math.floor(rnd() * 3);
        for (let i = 0; i < nSilos; i++) {
            const siloR = 18 + rnd() * 25;
            const siloH = 50 + rnd() * 80;
            const siloGeo = new THREE.CylinderGeometry(siloR, siloR, siloH, 12);
            siloGeo.rotateX(Math.PI / 2);
            siloGeo.translate(
                (rnd() - 0.5) * baseW * 0.5,
                (rnd() - 0.5) * baseD * 0.4,
                siloH / 2 + baseH
            );
            geoMap['wall'] = geoMap['wall'] || [];
            geoMap['wall'].push(siloGeo);
            totalH = Math.max(totalH, baseH + siloH);
        }

        if (rnd() > 0.4) {
            const chR = 8, chH = totalH + 40 + rnd() * 60;
            const chGeo = new THREE.CylinderGeometry(chR, chR * 1.3, chH, 8);
            chGeo.rotateX(Math.PI / 2);
            const chX = (rnd() - 0.5) * baseW * 0.3;
            const chY = (rnd() - 0.5) * baseD * 0.3;
            chGeo.translate(chX, chY, chH / 2);
            geoMap['chimney'] = geoMap['chimney'] || [];
            geoMap['chimney'].push(chGeo);

            const tipGeo = new THREE.SphereGeometry(5, 6, 6);
            tipGeo.translate(chX, chY, chH);
            geoMap['antennaRed'] = geoMap['antennaRed'] || [];
            geoMap['antennaRed'].push(tipGeo);
            totalH = chH;
        }
    } else if (zone === 'military') {
        const baseW = 280 + rnd() * 350, baseD = 250 + rnd() * 300, baseH = 25 + rnd() * 35;
        footprintRadius = Math.max(footprintRadius, Math.max(baseW, baseD) * 0.55);
        addBox(geoMap, baseW, baseD, baseH, 0, 'mats');
        totalH = baseH;

        if (rnd() > 0.4) {
            const dishR = 25 + rnd() * 20;
            const poleH = 30 + rnd() * 20;
            const poleGeo = new THREE.CylinderGeometry(3, 3, poleH, 4);
            poleGeo.rotateX(Math.PI / 2);
            poleGeo.translate(0, 0, baseH + poleH / 2);
            geoMap['roof'] = geoMap['roof'] || [];
            geoMap['roof'].push(poleGeo);

            const dishGeo = new THREE.CircleGeometry(dishR, 12);
            dishGeo.rotateX(0.4);
            dishGeo.translate(0, 0, baseH + poleH + 2);
            geoMap['dish'] = geoMap['dish'] || [];
            geoMap['dish'].push(dishGeo);

            totalH = baseH + poleH + dishR;
        }
    }

    if (!skipDetails) {
        addRoofDetails(geoMap, totalH, zone, rnd);
    } else {
        rnd(); rnd(); rnd(); rnd(); rnd(); rnd(); rnd(); rnd();
    }

    if (!skipDetails && zoneFamily === 'residential' && rnd() > (megaZone ? 0.35 : 0.6)) {
        const lastIdx = geoMap['mats'] ? geoMap['mats'].length - 1 : -1;
        if (lastIdx >= 0) addNeonEdges(geoMap, geoMap['mats'][lastIdx]);
    } else {
        rnd();
    }

    if (!skipDetails && (zoneFamily === 'residential' || zoneFamily === 'commercial') && totalH > 30) {
        const signChance = megaZone ? 0.65 : 0.3;
        if (rnd() < signChance) {
            const signW = 35 + rnd() * 50;
            const signH = 20 + rnd() * 30;
            const signZ = totalH * (0.4 + rnd() * 0.4);
            const side = rnd() > 0.5 ? 1 : -1;
            const offset = footprintRadius * 0.3 + 5;

            const signGeo = new THREE.PlaneGeometry(signW, signH);
            signGeo.rotateY(side > 0 ? 0 : Math.PI);
            signGeo.translate(side * offset, 0, signZ);
            geoMap['neonSign'] = geoMap['neonSign'] || [];
            geoMap['neonSign'].push(signGeo);
        }
        if (rnd() < signChance * 0.5) {
            const signW = 25 + rnd() * 40;
            const signH = 15 + rnd() * 25;
            const signZ = totalH * (0.3 + rnd() * 0.5);
            const side = rnd() > 0.5 ? 1 : -1;
            const offset = footprintRadius * 0.25 + 5;

            const signGeo = new THREE.PlaneGeometry(signW, signH);
            signGeo.rotateY(Math.PI / 2);
            signGeo.translate(0, side * offset, signZ);
            geoMap['neonSign'] = geoMap['neonSign'] || [];
            geoMap['neonSign'].push(signGeo);
        }
    }

    return { footprintRadius, totalH, useTopper, adsType, modelId, rotateZ, scaleXY, scaleZ };
}

// ============================================================
// getChunkIndex — which angular chunk does this angle belong to?
// ============================================================
function getChunkIndex(angle) {
    // Normalize to [0, 2PI)
    let a = angle % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return Math.floor(a / CHUNK_ARC) % NUM_CHUNKS;
}

// ============================================================
// buildCellToWorldMatrix — transform from cell-local to ringFloor coords
// cell-local: X = radial outward, Y = tangential, Z = height
// ringFloor:  XY = ring plane, Z = height
// Transform: Translate(cos(a)*R, sin(a)*R, 0) × RotateZ(a)
// ============================================================
function buildCellToWorldMatrix(cellCenterAngle, cellCenterRadius) {
    const cosA = Math.cos(cellCenterAngle);
    const sinA = Math.sin(cellCenterAngle);
    // Combined: RotateZ(a) then Translate to cell center
    return new THREE.Matrix4().set(
        cosA, -sinA, 0, cosA * cellCenterRadius,
        sinA,  cosA, 0, sinA * cellCenterRadius,
        0,     0,    1, 0,
        0,     0,    0, 1
    );
}

// ============================================================
// generateCellBuildingData — generate geometries + decoration data for one cell
// Returns { geoMap, dynamicDecorationData, cellCenterAngle, cellCenterRadius }
// Geometries are in cell-local coords (NOT yet transformed to world).
// ============================================================
function generateCellBuildingData(cell, ring) {
    const zone = cell.zone;
    const rand = createSeededRandom(hashZoneSeed(cell, zone));
    const buildCount = getZoneTargetBuildingCount(zone, rand);

    const cellCenterAngle = (cell.angleStart + cell.angleEnd) * 0.5;
    const cellCenterRadius = (cell.innerRadius + cell.outerRadius) * 0.5;

    const gridCols = 4;
    const gridRows = 3;
    const buildStartAngle = cell.angleStart + ZONE_PAD_ANGLE;
    const buildEndAngle = cell.angleEnd - ZONE_PAD_ANGLE;
    const buildInnerRadi = cell.innerRadius + ZONE_PAD_RADIUS;
    const buildOuterRadi = cell.outerRadius - ZONE_PAD_RADIUS;

    const angleStep = (buildEndAngle - buildStartAngle) / gridCols;
    const radiusStep = (buildOuterRadi - buildInnerRadi) / gridRows;

    const buildSlots = [];
    for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
            const centerAngle = buildStartAngle + (c + 0.5) * angleStep;
            const centerRadius = buildInnerRadi + (r + 0.5) * radiusStep;
            buildSlots.push({
                angle: centerAngle + (rand() - 0.5) * angleStep * 0.4,
                radius: centerRadius + (rand() - 0.5) * radiusStep * 0.4
            });
        }
    }

    for (let i = buildSlots.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = buildSlots[i];
        buildSlots[i] = buildSlots[j];
        buildSlots[j] = tmp;
    }

    const cellGeoMap = {};
    const dynamicDecorationData = [];

    for (let si = 0; si < Math.min(buildCount, buildSlots.length); si++) {
        const slot = buildSlots[si];
        const localGeoMap = {};

        const buildResult = createBuilding(zone, localGeoMap, rand);

        const localX = slot.radius - cellCenterRadius;
        const localY = (slot.angle - cellCenterAngle) * cellCenterRadius;
        const translationMatrix = new THREE.Matrix4().makeTranslation(localX, localY, 0);

        if (buildResult.adsType) {
            const isBig = buildResult.modelId && (buildResult.modelId.startsWith('s_04') || buildResult.modelId.startsWith('s_05'));
            const materialKeys = isBig
                ? ['ads_large_01', 'ads_large_02', 'ads_large_03', 'ads_large_04', 'ads_large_05']
                : ['ads_01', 'ads_02', 'ads_03', 'ads_04', 'ads_05'];

            dynamicDecorationData.push({
                type: 'advert',
                localX, localY,
                height: 0,
                scaleX: buildResult.scaleXY || 1,
                scaleZ: buildResult.scaleZ || 1,
                rotationZ: buildResult.rotateZ || 0,
                modelId: buildResult.adsType,
                materialKeys: materialKeys
            });
        }

        if (buildResult.useTopper && buildResult.adsType) {
            const topperIndex = 1 + Math.floor(rand() * 12);
            dynamicDecorationData.push({
                type: 'topper',
                localX, localY,
                height: buildResult.totalH,
                scale: (0.8 + rand()) * (buildResult.scaleXY || 3.0),
                modelId: `topper_${String(topperIndex).padStart(2, '0')}`,
                materialKey: pickSynthAdMaterialKey(rand, true)
            });
        }

        for (const matKey in localGeoMap) {
            for (let geo of localGeoMap[matKey]) {
                if (geo.getIndex && geo.getIndex() !== null) {
                    geo = geo.toNonIndexed();
                }

                const posCount = geo.attributes.position.count;
                if (!geo.hasAttribute('normal')) {
                    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(posCount * 3), 3));
                }
                if (!geo.hasAttribute('uv')) {
                    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(posCount * 2), 2));
                }
                geo.groups = [];

                geo.applyMatrix4(translationMatrix);
                cellGeoMap[matKey] = cellGeoMap[matKey] || [];
                cellGeoMap[matKey].push(geo);
            }
        }
    }

    return {
        cellGeoMap,
        dynamicDecorationData,
        cellCenterAngle,
        cellCenterRadius,
        zone,
        cellKey: cell.key,
        rand // pass through for decoration creation
    };
}

// ============================================================
// resolveMaterial — find the THREE.Material for a given matKey + zone
// ============================================================
function resolveMaterial(matKey, zone) {
    const matDict = getMatDict(zone);
    let material = matDict[matKey];
    if (!material && matKey.startsWith('building_')) {
        material = synthCityAssets.materials[matKey];
    }
    if (!material) {
        const mats = getZoneMaterials(zone);
        material = mats.wall;
    }
    if (Array.isArray(material)) material = material[0];
    return material;
}

// ============================================================
// createDistrictForCell — per-cell fallback (for single cell rebuild)
// Used by rebuildDistrictForCell when repainting a single cell.
// ============================================================
export function createDistrictForCell(cell, ring) {
    if (!cell || !cell.zone) return null;

    const data = generateCellBuildingData(cell, ring);
    const { cellGeoMap, dynamicDecorationData, cellCenterAngle, cellCenterRadius, zone } = data;

    const matDict = getMatDict(zone);
    const mats = getZoneMaterials(zone);
    const cellGroup = new THREE.Group();

    for (const matKey in cellGeoMap) {
        if (cellGeoMap[matKey].length === 0) continue;

        let mergedGeo;
        try {
            mergedGeo = BufferGeometryUtils.mergeGeometries(cellGeoMap[matKey], false);
        } catch (e) {
            try {
                mergedGeo = BufferGeometryUtils.mergeBufferGeometries(cellGeoMap[matKey], false);
            } catch (e2) {
                continue;
            }
        }
        if (!mergedGeo) continue;

        const material = resolveMaterial(matKey, zone);
        if (matKey === 'neonEdges') {
            cellGroup.add(new THREE.LineSegments(mergedGeo, material));
        } else {
            cellGroup.add(new THREE.Mesh(mergedGeo, material));
        }
    }

    cellGroup.userData = { zoneCellKey: cell.key, zone };

    // Create dynamic decoration meshes
    const rand = data.rand;
    const dynamicDecorations = [];
    for (const dd of dynamicDecorationData) {
        if (dd.type === 'topper') {
            const geo = cloneSynthCityGeometry(dd.modelId);
            const material = synthCityAssets.materials[dd.materialKey];
            if (geo && material) {
                geo.rotateX(Math.PI / 2);
                geo.scale(dd.scale, dd.scale, dd.scale);
                const mesh = new THREE.Mesh(geo, material);
                mesh.position.set(dd.localX, dd.localY, dd.height);
                mesh.rotation.z = rand() * Math.PI * 2;
                cellGroup.add(mesh);
                dynamicDecorations.push({
                    mesh,
                    rotationSpeed: (rand() - 0.5) * 0.02
                });
            }
        } else if (dd.type === 'advert') {
            const geo = cloneSynthCityGeometry(dd.modelId);
            const matKey = Array.isArray(dd.materialKeys) ? dd.materialKeys[0] : dd.materialKeys;
            const material = synthCityAssets.materials[matKey];
            if (geo && material) {
                geo.rotateX(Math.PI / 2);
                geo.scale(dd.scaleX, dd.scaleX, dd.scaleZ);
                const mesh = new THREE.Mesh(geo, material);
                mesh.position.set(dd.localX, dd.localY, dd.height);
                mesh.rotation.z = dd.rotationZ;
                cellGroup.add(mesh);
                dynamicDecorations.push({
                    mesh,
                    switches: Math.random() < 0.5,
                    switchTimer: 200 + Math.random() * 800,
                    switchElapsed: Math.random() * 800,
                    materialKeys: dd.materialKeys,
                    update(dt) {
                        if (!this.switches) return;
                        this.switchElapsed += dt * 60;
                        if (this.switchElapsed < this.switchTimer) return;
                        this.switchElapsed = 0;
                        const nextKey = this.materialKeys[Math.floor(Math.random() * this.materialKeys.length)];
                        const nextMaterial = synthCityAssets.materials[nextKey];
                        if (nextMaterial) this.mesh.material = nextMaterial;
                    }
                });
            }
        }
    }

    cellGroup.rotation.z = cellCenterAngle;

    const tiltWrapper = new THREE.Group();
    tiltWrapper.position.set(
        Math.cos(cellCenterAngle) * cellCenterRadius,
        Math.sin(cellCenterAngle) * cellCenterRadius,
        0
    );
    tiltWrapper.add(cellGroup);

    if (Core3D?.enableForeground3D) Core3D.enableForeground3D(tiltWrapper);

    const segmentIndex = Math.round(cellCenterAngle / ring.angleStep) % ring.segmentData.length;
    const radialOffset = cellCenterRadius - ring.ringRadius;

    return {
        tiltWrapper,
        group: cellGroup,
        segmentIndex: Math.max(0, segmentIndex),
        baseAngle: cellCenterAngle,
        radius: cellCenterRadius,
        radialOffset,
        cellKey: cell.key,
        zone,
        dynamicDecorations
    };
}

// ============================================================
// buildAllDistricts — CHUNK-BASED CROSS-CELL MERGE
// Divides ring into 16 angular chunks. Within each chunk, merges
// all building geometries by material into shared meshes.
// Dynamic decorations stay individual for animation.
// ============================================================
export function buildAllDistricts(zoneGrid, ring) {
    if (!zoneGrid || !ring) return [];

    // Process each ring separately so chunks carry a ringId and zone types
    // never bleed across rings.
    const results = [];
    for (const ringId of [RING_INNER, RING_INDUSTRIAL, RING_MILITARY]) {
        const ringCells = zoneGrid.getCellsForRing
            ? zoneGrid.getCellsForRing(ringId).filter(c => c.zone)
            : zoneGrid.getPopulatedCells().filter(c => c.ring === ringId);
        if (!ringCells.length) continue;
        const ringResults = buildChunksForRing(ringCells, ringId, ring);
        results.push(...ringResults);
    }
    return results;
}

// Build merged chunk meshes for a specific ring's populated cells.
function buildChunksForRing(cells, ringId, ring) {
    if (!cells.length) return [];

    // Initialize chunk buckets
    const chunks = [];
    for (let i = 0; i < NUM_CHUNKS; i++) {
        chunks.push({
            geoByMat: {},
            neonEdgeGeos: [],
            decorationData: [],
            zones: new Set(),
            cellKeys: [],
            hasNeonEdges: false
        });
    }

    // Generate all cells, transform to world coords, bucket into chunks
    for (const cell of cells) {
        if (!cell.zone) continue;

        const data = generateCellBuildingData(cell, ring);
        const { cellGeoMap, dynamicDecorationData, cellCenterAngle, cellCenterRadius, zone } = data;

        const chunkIdx = getChunkIndex(cellCenterAngle);
        const chunk = chunks[chunkIdx];
        chunk.zones.add(zone);
        chunk.cellKeys.push(cell.key);

        // Build cell-to-world matrix
        const cellToWorld = buildCellToWorldMatrix(cellCenterAngle, cellCenterRadius);

        // Transform all geometries to world coords and bucket by material
        for (const matKey in cellGeoMap) {
            for (const geo of cellGeoMap[matKey]) {
                geo.applyMatrix4(cellToWorld);

                if (matKey === 'neonEdges') {
                    chunk.neonEdgeGeos.push(geo);
                    chunk.hasNeonEdges = true;
                } else {
                    if (!chunk.geoByMat[matKey]) chunk.geoByMat[matKey] = [];
                    chunk.geoByMat[matKey].push(geo);
                }
            }
        }

        // Transform decoration positions to world coords
        for (const dd of dynamicDecorationData) {
            const localPos = new THREE.Vector3(dd.localX, dd.localY, dd.height);
            localPos.applyMatrix4(cellToWorld);
            chunk.decorationData.push({
                ...dd,
                worldX: localPos.x,
                worldY: localPos.y,
                worldZ: localPos.z,
                cellAngle: cellCenterAngle,
                zone
            });
        }
    }

    // Build merged meshes per chunk
    const results = [];

    for (let ci = 0; ci < NUM_CHUNKS; ci++) {
        const chunk = chunks[ci];
        const hasGeo = Object.keys(chunk.geoByMat).length > 0 || chunk.hasNeonEdges;
        if (!hasGeo && chunk.decorationData.length === 0) continue;

        const chunkGroup = new THREE.Group();
        const chunkCenterAngle = (ci + 0.5) * CHUNK_ARC;

        // Pick a representative zone for material lookup
        const primaryZone = chunk.zones.values().next().value || 'residential';

        // Merge by material
        for (const matKey in chunk.geoByMat) {
            const geos = chunk.geoByMat[matKey];
            if (!geos.length) continue;

            let mergedGeo;
            try {
                mergedGeo = BufferGeometryUtils.mergeGeometries(geos, false);
            } catch (e) {
                try {
                    mergedGeo = BufferGeometryUtils.mergeBufferGeometries(geos, false);
                } catch (e2) { continue; }
            }
            if (!mergedGeo) continue;

            // Find correct material — check each zone's matDict and synthCity mats
            let material = null;
            for (const zone of chunk.zones) {
                material = resolveMaterial(matKey, zone);
                if (material) break;
            }
            if (!material) continue;

            const mesh = new THREE.Mesh(mergedGeo, material);
            mesh.userData.lodLevel = LOD_LEVEL_BY_MAT[matKey] || 'MEDIUM';
            chunkGroup.add(mesh);
        }

        // Merge neon edges
        if (chunk.neonEdgeGeos.length > 0) {
            let mergedEdges;
            try {
                mergedEdges = BufferGeometryUtils.mergeGeometries(chunk.neonEdgeGeos, false);
            } catch (e) {
                try { mergedEdges = BufferGeometryUtils.mergeBufferGeometries(chunk.neonEdgeGeos, false); }
                catch (e2) { mergedEdges = null; }
            }
            if (mergedEdges) {
                const edgeMat = getMatDict(primaryZone).neonEdges;
                if (edgeMat) {
                    const edgeMesh = new THREE.LineSegments(mergedEdges, edgeMat);
                    edgeMesh.userData.lodLevel = 'DETAIL';
                    chunkGroup.add(edgeMesh);
                }
            }
        }

        // Create dynamic decorations (individual meshes for animation)
        const dynamicDecorations = [];
        for (const dd of chunk.decorationData) {
            if (dd.type === 'topper') {
                const geo = cloneSynthCityGeometry(dd.modelId);
                const material = synthCityAssets.materials[dd.materialKey];
                if (geo && material) {
                    geo.rotateX(Math.PI / 2);
                    geo.scale(dd.scale, dd.scale, dd.scale);
                    const mesh = new THREE.Mesh(geo, material);
                    mesh.position.set(dd.worldX, dd.worldY, dd.worldZ);
                    mesh.rotation.z = Math.random() * Math.PI * 2;
                    chunkGroup.add(mesh);
                    dynamicDecorations.push({
                        mesh,
                        rotationSpeed: (Math.random() - 0.5) * 0.02
                    });
                }
            } else if (dd.type === 'advert') {
                const geo = cloneSynthCityGeometry(dd.modelId);
                const matKey = Array.isArray(dd.materialKeys) ? dd.materialKeys[0] : dd.materialKeys;
                const material = synthCityAssets.materials[matKey];
                if (geo && material) {
                    geo.rotateX(Math.PI / 2);
                    geo.scale(dd.scaleX, dd.scaleX, dd.scaleZ);
                    const mesh = new THREE.Mesh(geo, material);
                    mesh.position.set(dd.worldX, dd.worldY, dd.worldZ);
                    mesh.rotation.z = dd.rotationZ + dd.cellAngle;
                    chunkGroup.add(mesh);
                    dynamicDecorations.push({
                        mesh,
                        switches: Math.random() < 0.5,
                        switchTimer: 200 + Math.random() * 800,
                        switchElapsed: Math.random() * 800,
                        materialKeys: dd.materialKeys,
                        update(dt) {
                            if (!this.switches) return;
                            this.switchElapsed += dt * 60;
                            if (this.switchElapsed < this.switchTimer) return;
                            this.switchElapsed = 0;
                            const nextKey = this.materialKeys[Math.floor(Math.random() * this.materialKeys.length)];
                            const nextMaterial = synthCityAssets.materials[nextKey];
                            if (nextMaterial) this.mesh.material = nextMaterial;
                        }
                    });
                }
            }
        }

        if (Core3D?.enableForeground3D) Core3D.enableForeground3D(chunkGroup);
        ring.ringFloor.add(chunkGroup);

        // Pick a representative radius for this ring (from its layout band)
        const ringBand = ring.layout?.[ringId];
        const ringRadius = ringBand
            ? (ringBand.innerR + ringBand.outerR) * 0.5
            : ring.ringRadius;

        chunkGroup.userData.ringId = ringId;

        results.push({
            mesh: chunkGroup,
            segmentIndex: 0,
            baseAngle: chunkCenterAngle,
            radius: ringRadius,
            ringId,
            radialOffset: 0,
            tiltX: 0,
            tiltY: 0,
            isDistrict: true,
            isChunk: true,
            chunkIndex: ci,
            cellKeys: chunk.cellKeys.slice(),
            dynamicDecorations
        });
    }

    return results;
}

// ============================================================
// rebuildDistrictForCell — rebuild a single cell (for zone painting)
// Finds the chunk containing this cell and rebuilds the entire chunk.
// ============================================================
export function rebuildDistrictForCell(cell, ring) {
    if (!ring) return;

    const cellCenterAngle = (cell.angleStart + cell.angleEnd) * 0.5;
    const chunkIdx = getChunkIndex(cellCenterAngle);
    const targetRingId = cell.ring || null;

    // Remove existing chunk mesh for this chunk index (only within the same ring)
    for (let i = ring.visualMeshes.length - 1; i >= 0; i--) {
        const vm = ring.visualMeshes[i];
        if (vm.isDistrict && vm.isChunk && vm.chunkIndex === chunkIdx && vm.ringId === targetRingId) {
            ring.ringFloor.remove(vm.mesh);
            // Dispose geometries to free GPU memory
            vm.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
            });
            ring.visualMeshes.splice(i, 1);
        }
        // Also remove old-style per-cell entries for this cell
        if (vm.isDistrict && !vm.isChunk && vm.cellKey === cell.key) {
            ring.ringFloor.remove(vm.mesh);
            vm.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
            });
            ring.visualMeshes.splice(i, 1);
        }
    }

    // Get all cells in this chunk from the zone grid (restricted to the same ring)
    const zoneGrid = ring.zoneGrid;
    if (!zoneGrid) return;

    const allCells = zoneGrid.getPopulatedCells();
    const chunkCells = allCells.filter(c => {
        if (!c.zone) return false;
        if (targetRingId && c.ring !== targetRingId) return false;
        const a = (c.angleStart + c.angleEnd) * 0.5;
        return getChunkIndex(a) === chunkIdx;
    });

    if (!chunkCells.length) return;

    // Build this chunk using the same logic as buildAllDistricts
    const chunk = {
        geoByMat: {},
        neonEdgeGeos: [],
        decorationData: [],
        zones: new Set(),
        cellKeys: [],
        hasNeonEdges: false
    };

    for (const c of chunkCells) {
        const data = generateCellBuildingData(c, ring);
        const { cellGeoMap, dynamicDecorationData, cellCenterAngle: ccAngle, cellCenterRadius, zone } = data;

        chunk.zones.add(zone);
        chunk.cellKeys.push(c.key);

        const cellToWorld = buildCellToWorldMatrix(ccAngle, cellCenterRadius);

        for (const matKey in cellGeoMap) {
            for (const geo of cellGeoMap[matKey]) {
                geo.applyMatrix4(cellToWorld);
                if (matKey === 'neonEdges') {
                    chunk.neonEdgeGeos.push(geo);
                    chunk.hasNeonEdges = true;
                } else {
                    if (!chunk.geoByMat[matKey]) chunk.geoByMat[matKey] = [];
                    chunk.geoByMat[matKey].push(geo);
                }
            }
        }

        for (const dd of dynamicDecorationData) {
            const localPos = new THREE.Vector3(dd.localX, dd.localY, dd.height);
            localPos.applyMatrix4(cellToWorld);
            chunk.decorationData.push({
                ...dd,
                worldX: localPos.x,
                worldY: localPos.y,
                worldZ: localPos.z,
                cellAngle: ccAngle,
                zone
            });
        }
    }

    const chunkGroup = new THREE.Group();
    const chunkCenterAngle = (chunkIdx + 0.5) * CHUNK_ARC;
    const primaryZone = chunk.zones.values().next().value || 'residential';

    for (const matKey in chunk.geoByMat) {
        const geos = chunk.geoByMat[matKey];
        if (!geos.length) continue;
        let mergedGeo;
        try {
            mergedGeo = BufferGeometryUtils.mergeGeometries(geos, false);
        } catch (e) {
            try { mergedGeo = BufferGeometryUtils.mergeBufferGeometries(geos, false); }
            catch (e2) { continue; }
        }
        if (!mergedGeo) continue;

        let material = null;
        for (const zone of chunk.zones) {
            material = resolveMaterial(matKey, zone);
            if (material) break;
        }
        if (!material) continue;
        const mesh = new THREE.Mesh(mergedGeo, material);
        mesh.userData.lodLevel = LOD_LEVEL_BY_MAT[matKey] || 'MEDIUM';
        chunkGroup.add(mesh);
    }

    if (chunk.neonEdgeGeos.length > 0) {
        let mergedEdges;
        try { mergedEdges = BufferGeometryUtils.mergeGeometries(chunk.neonEdgeGeos, false); }
        catch (e) {
            try { mergedEdges = BufferGeometryUtils.mergeBufferGeometries(chunk.neonEdgeGeos, false); }
            catch (e2) { mergedEdges = null; }
        }
        if (mergedEdges) {
            const edgeMat = getMatDict(primaryZone).neonEdges;
            if (edgeMat) {
                const edgeMesh = new THREE.LineSegments(mergedEdges, edgeMat);
                edgeMesh.userData.lodLevel = 'DETAIL';
                chunkGroup.add(edgeMesh);
            }
        }
    }

    const dynamicDecorations = [];
    for (const dd of chunk.decorationData) {
        if (dd.type === 'topper') {
            const geo = cloneSynthCityGeometry(dd.modelId);
            const material = synthCityAssets.materials[dd.materialKey];
            if (geo && material) {
                geo.rotateX(Math.PI / 2);
                geo.scale(dd.scale, dd.scale, dd.scale);
                const mesh = new THREE.Mesh(geo, material);
                mesh.position.set(dd.worldX, dd.worldY, dd.worldZ);
                mesh.rotation.z = Math.random() * Math.PI * 2;
                chunkGroup.add(mesh);
                dynamicDecorations.push({ mesh, rotationSpeed: (Math.random() - 0.5) * 0.02 });
            }
        } else if (dd.type === 'advert') {
            const geo = cloneSynthCityGeometry(dd.modelId);
            const matKey = Array.isArray(dd.materialKeys) ? dd.materialKeys[0] : dd.materialKeys;
            const material = synthCityAssets.materials[matKey];
            if (geo && material) {
                geo.rotateX(Math.PI / 2);
                geo.scale(dd.scaleX, dd.scaleX, dd.scaleZ);
                const mesh = new THREE.Mesh(geo, material);
                mesh.position.set(dd.worldX, dd.worldY, dd.worldZ);
                mesh.rotation.z = dd.rotationZ + dd.cellAngle;
                chunkGroup.add(mesh);
                dynamicDecorations.push({
                    mesh,
                    switches: Math.random() < 0.5,
                    switchTimer: 200 + Math.random() * 800,
                    switchElapsed: Math.random() * 800,
                    materialKeys: dd.materialKeys,
                    update(dt) {
                        if (!this.switches) return;
                        this.switchElapsed += dt * 60;
                        if (this.switchElapsed < this.switchTimer) return;
                        this.switchElapsed = 0;
                        const nextKey = this.materialKeys[Math.floor(Math.random() * this.materialKeys.length)];
                        const nextMaterial = synthCityAssets.materials[nextKey];
                        if (nextMaterial) this.mesh.material = nextMaterial;
                    }
                });
            }
        }
    }

    if (Core3D?.enableForeground3D) Core3D.enableForeground3D(chunkGroup);
    ring.ringFloor.add(chunkGroup);

    // Use the cell's own ring band for radius (not the outer ringRadius)
    const ringBand = targetRingId ? ring.layout?.[targetRingId] : null;
    const ringRadius = ringBand
        ? (ringBand.innerR + ringBand.outerR) * 0.5
        : ring.ringRadius;

    chunkGroup.userData.ringId = targetRingId;

    ring.visualMeshes.push({
        mesh: chunkGroup,
        segmentIndex: 0,
        baseAngle: chunkCenterAngle,
        radius: ringRadius,
        ringId: targetRingId,
        radialOffset: 0,
        tiltX: 0,
        tiltY: 0,
        isDistrict: true,
        isChunk: true,
        chunkIndex: chunkIdx,
        cellKeys: chunk.cellKeys.slice(),
        dynamicDecorations
    });
}
