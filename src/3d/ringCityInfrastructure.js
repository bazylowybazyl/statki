// ============================================================
// Ring City Infrastructure — Streets, floor plates, pads
// OPTIMIZED v2: Global cross-cell merge — 4 meshes TOTAL for
// all infrastructure (floor, overlay, path, trace)
// ============================================================
import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { createSectorGeometry, COLORS, RING_INNER, INNER_RING_ROWS, getZoneFamily } from './ringCityZoneGrid.js';
import { getDistrictInfrastructureMaterials, BufferGeometryUtils, synthCityAssets } from './ringCityAssets.js';

// --- Z offsets for infrastructure layers ---
const FLOOR_Z = 0.18;
const OVERLAY_Z = 0.22;
const PATH_Z = 0.26;
const TRACE_Z = 0.34;

// --- Zone overlay material cache ---
const overlayMatCache = {};

// --- Swap matrix: createSectorGeometry XZ plane → ringFloor XY plane ---
const swapYZ = new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1
);

const GRID_COLS = 4;
const GRID_ROWS = 3;
const ROAD_COL_STRIDE = 4;
const ROAD_WIDTH = 30;
const TRACE_WIDTH = 7;

// ============================================================
// collectCellInfraGeometries — gather raw geometries for one cell
// Returns { floor: [...], overlay: [...], path: [...], trace: [...] }
// Does NOT merge or create meshes.
// ============================================================
function collectCellInfraGeometries(cell) {
    const geos = { floor: [], overlay: [], path: [], trace: [] };

    // Floor plate
    geos.floor.push(createSectorGeometry(
        cell.innerRadius, cell.outerRadius,
        cell.angleStart, cell.angleEnd,
        FLOOR_Z
    ));

    // Zone color overlay
    const zoneColor = COLORS[cell.zone];
    if (zoneColor) {
        // Ensure overlay material cached
        if (!overlayMatCache[cell.zone]) {
            overlayMatCache[cell.zone] = new THREE.MeshBasicMaterial({
                color: zoneColor.num,
                transparent: true,
                opacity: 0.16,
                side: THREE.DoubleSide,
                depthWrite: false
            });
        }
        geos.overlay.push(createSectorGeometry(
            cell.innerRadius, cell.outerRadius,
            cell.angleStart, cell.angleEnd,
            OVERLAY_Z
        ));
    }

    // Grid streets
    const startAngle = cell.angleStart;
    const endAngle = cell.angleEnd;
    const innerRadi = cell.innerRadius;
    const outerRadi = cell.outerRadius;
    const angleStep = (endAngle - startAngle) / GRID_COLS;
    const radiusStep = (outerRadi - innerRadi) / GRID_ROWS;

    // Angular arcs
    for (let r = 0; r <= GRID_ROWS; r++) {
        const radius = innerRadi + r * radiusStep;
        const width = (r === 0 || r === GRID_ROWS) ? 14 : 10;
        geos.path.push(createSectorGeometry(radius - width * 0.5, radius + width * 0.5, startAngle, endAngle, PATH_Z));
        geos.trace.push(createSectorGeometry(radius - width * 0.15, radius + width * 0.15, startAngle, endAngle, TRACE_Z));
    }

    // Radial spokes
    for (let c = 0; c <= GRID_COLS; c++) {
        const angle = startAngle + c * angleStep;
        const width = (c === 0 || c === GRID_COLS) ? 14 : 10;
        const midRadius = (innerRadi + outerRadi) * 0.5;
        const angleSpan = width / midRadius;
        geos.path.push(createSectorGeometry(innerRadi, outerRadi, angle - angleSpan * 0.5, angle + angleSpan * 0.5, PATH_Z));
        geos.trace.push(createSectorGeometry(innerRadi, outerRadi, angle - angleSpan * 0.15, angle + angleSpan * 0.15, TRACE_Z));
    }

    return geos;
}

// ============================================================
// mergeAndCreateMesh — merge array of geometries, apply swapYZ, create mesh
// ============================================================
function mergeAndCreateMesh(geos, material) {
    if (!geos || !geos.length || !material) return null;

    let mergedGeo;
    try {
        mergedGeo = BufferGeometryUtils.mergeGeometries(geos, false);
    } catch (e) {
        try { mergedGeo = BufferGeometryUtils.mergeBufferGeometries(geos, false); }
        catch (e2) { return null; }
    }
    if (!mergedGeo) return null;

    mergedGeo.applyMatrix4(swapYZ);
    // Pre-compute bounds so the first frustum-cull check (when camera pans
    // a new section into view) doesn't trigger a lazy O(N-vertices) compute.
    // Without this, large merged ring-floor meshes cause one-time hitches
    // every time the camera reveals a new portion of the ring.
    mergedGeo.computeBoundingSphere();
    mergedGeo.computeBoundingBox();
    return new THREE.Mesh(mergedGeo, material);
}

function addInfraResult(results, ring, mesh, name, renderOrder) {
    if (!mesh || !ring?.ringFloor) return;
    mesh.name = name;
    mesh.renderOrder = renderOrder;
    mesh.userData.fgCategory = 'buildings';
    mesh.userData.isRingInfrastructure = true;
    if (Core3D?.enableForeground3D) Core3D.enableForeground3D(mesh);
    ring.ringFloor.add(mesh);
    results.push({
        mesh,
        isInfrastructure: true,
        isGlobalInfra: true,
        isChunk: true,
        dynamicDecorations: []
    });
}

function pushRadialRoad(geos, cell, angle, width, z) {
    const midRadius = Math.max(1, (cell.innerRadius + cell.outerRadius) * 0.5);
    const halfAngle = (width * 0.5) / midRadius;
    geos.push(createSectorGeometry(cell.innerRadius, cell.outerRadius, angle - halfAngle, angle + halfAngle, z));
}

function pushRingRoad(geos, radius, startAngle, endAngle, width, z) {
    geos.push(createSectorGeometry(radius - width * 0.5, radius + width * 0.5, startAngle, endAngle, z));
}

// ============================================================
// createDistrictInfrastructure — per-cell fallback (for single cell rebuild)
// Used only by rebuildRingCityCell when repainting a single cell.
// ============================================================
export function createDistrictInfrastructure(cell, ring) {
    return null;
}

// ============================================================
// buildAllInfrastructure — GLOBAL MERGE: all cells → 4 meshes total
// Collects geometries from ALL cells, groups by material layer,
// merges each layer into ONE mesh. Result: 4 draw calls total.
// ============================================================
export function buildAllInfrastructure(zoneGrid, ring) {
    if (!zoneGrid || !ring?.ringFloor) return [];

    const sourceCells = zoneGrid.getCellsForRing
        ? zoneGrid.getCellsForRing(RING_INNER)
        : zoneGrid.getPopulatedCells().filter(c => c.ring === RING_INNER);
    const cells = sourceCells.filter(cell => {
        if (!cell?.zone) return false;
        const family = getZoneFamily(cell.zone);
        return family === 'residential' || family === 'commercial';
    });
    if (!cells.length) return [];

    const floorGeos = [];
    const pathGeos = [];
    const traceGeos = [];

    for (const cell of cells) {
        floorGeos.push(createSectorGeometry(cell.innerRadius, cell.outerRadius, cell.angleStart, cell.angleEnd, FLOOR_Z));

        if ((cell.col % ROAD_COL_STRIDE) === 0) {
            pushRadialRoad(pathGeos, cell, cell.angleStart, ROAD_WIDTH, PATH_Z);
            pushRadialRoad(traceGeos, cell, cell.angleStart, TRACE_WIDTH, TRACE_Z);
        }

        pushRingRoad(pathGeos, cell.innerRadius, cell.angleStart, cell.angleEnd, ROAD_WIDTH, PATH_Z);
        pushRingRoad(traceGeos, cell.innerRadius, cell.angleStart, cell.angleEnd, TRACE_WIDTH, TRACE_Z);

        const isLastInnerRow = cell.row === INNER_RING_ROWS - 1;
        if (isLastInnerRow) {
            pushRingRoad(pathGeos, cell.outerRadius, cell.angleStart, cell.angleEnd, ROAD_WIDTH, PATH_Z);
            pushRingRoad(traceGeos, cell.outerRadius, cell.angleStart, cell.angleEnd, TRACE_WIDTH, TRACE_Z);
        }
    }

    const materials = getDistrictInfrastructureMaterials('commercial');
    const floorMat = synthCityAssets.materials.ground || materials.floor;
    const pathMat = materials.path;
    const traceMat = materials.trace;
    const results = [];

    addInfraResult(
        results,
        ring,
        mergeAndCreateMesh(floorGeos, floorMat),
        `RingCityGround:${ring.key || 'ring'}`,
        -3
    );
    addInfraResult(
        results,
        ring,
        mergeAndCreateMesh(pathGeos, pathMat),
        `RingCityRoads:${ring.key || 'ring'}`,
        -2
    );
    addInfraResult(
        results,
        ring,
        mergeAndCreateMesh(traceGeos, traceMat),
        `RingCityRoadTraces:${ring.key || 'ring'}`,
        -1
    );

    return results;
}

// ============================================================
// rebuildAllInfrastructure — full rebuild (removes old, builds new)
// Called after zone painting multiple cells
// ============================================================
export function rebuildAllInfrastructure(zoneGrid, ring) {
    if (!ring) return [];

    // Remove ALL infrastructure meshes
    for (let i = ring.visualMeshes.length - 1; i >= 0; i--) {
        const vm = ring.visualMeshes[i];
        if (vm.isInfrastructure) {
            ring.ringFloor.remove(vm.mesh);
            // Dispose geometries
            vm.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
            });
            ring.visualMeshes.splice(i, 1);
        }
    }

    // Rebuild global merge
    const results = buildAllInfrastructure(zoneGrid, ring);
    ring.visualMeshes.push(...results);
    return results;
}
