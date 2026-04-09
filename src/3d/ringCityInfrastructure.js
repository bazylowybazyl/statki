// ============================================================
// Ring City Infrastructure — Streets, floor plates, pads
// OPTIMIZED v2: Global cross-cell merge — 4 meshes TOTAL for
// all infrastructure (floor, overlay, path, trace)
// ============================================================
import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { createSectorGeometry, COLORS } from './ringCityZoneGrid.js';
import { getDistrictInfrastructureMaterials, BufferGeometryUtils } from './ringCityAssets.js';

// --- Z offsets for infrastructure layers ---
const FLOOR_Z = 0.5;
const OVERLAY_Z = 0.7;
const PATH_Z = 1.0;
const TRACE_Z = 1.5;

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

// ============================================================
// createDistrictInfrastructure — per-cell fallback (for single cell rebuild)
// Used only by rebuildRingCityCell when repainting a single cell.
// ============================================================
export function createDistrictInfrastructure(cell, ring) {
    if (!cell || !cell.zone) return null;

    const mats = getDistrictInfrastructureMaterials(cell.zone);
    const infraGroup = new THREE.Group();
    const cellGeos = collectCellInfraGeometries(cell);

    const matMap = {
        floor: mats.floor,
        overlay: overlayMatCache[cell.zone],
        path: mats.path,
        trace: mats.trace
    };

    for (const key in cellGeos) {
        const mesh = mergeAndCreateMesh(cellGeos[key], matMap[key]);
        if (mesh) infraGroup.add(mesh);
    }

    const cellCenterAngle = (cell.angleStart + cell.angleEnd) * 0.5;
    const cellCenterRadius = (cell.innerRadius + cell.outerRadius) * 0.5;
    const segmentIndex = Math.round(cellCenterAngle / ring.angleStep) % ring.segmentData.length;
    const radialOffset = cellCenterRadius - ring.ringRadius;

    if (Core3D?.enableForeground3D) Core3D.enableForeground3D(infraGroup);

    return {
        infraGroup,
        segmentIndex: Math.max(0, segmentIndex),
        baseAngle: cellCenterAngle,
        radius: cellCenterRadius,
        radialOffset,
        cellKey: cell.key
    };
}

// ============================================================
// buildAllInfrastructure — GLOBAL MERGE: all cells → 4 meshes total
// Collects geometries from ALL cells, groups by material layer,
// merges each layer into ONE mesh. Result: 4 draw calls total.
// ============================================================
export function buildAllInfrastructure(zoneGrid, ring) {
    if (!zoneGrid || !ring) return [];

    const cells = zoneGrid.getPopulatedCells();
    if (!cells.length) return [];

    // Global geometry buckets — one per material layer, per zone (for overlay colors)
    const globalGeos = {
        floor: [],
        path: [],
        trace: []
    };
    // Overlay needs per-zone separation (different colors)
    const overlayByZone = {};

    // Collect geometries from ALL cells
    for (const cell of cells) {
        if (!cell.zone) continue;
        // Ensure materials exist for this zone
        getDistrictInfrastructureMaterials(cell.zone);

        const cellGeos = collectCellInfraGeometries(cell);

        globalGeos.floor.push(...cellGeos.floor);
        globalGeos.path.push(...cellGeos.path);
        globalGeos.trace.push(...cellGeos.trace);

        if (cellGeos.overlay.length > 0) {
            if (!overlayByZone[cell.zone]) overlayByZone[cell.zone] = [];
            overlayByZone[cell.zone].push(...cellGeos.overlay);
        }
    }

    // Get any zone's materials for floor/path/trace (they're shared across zones)
    const anyZone = cells[0].zone;
    const mats = getDistrictInfrastructureMaterials(anyZone);

    const results = [];
    const infraGroup = new THREE.Group();

    // Merge floor — 1 mesh
    const floorMesh = mergeAndCreateMesh(globalGeos.floor, mats.floor);
    if (floorMesh) infraGroup.add(floorMesh);

    // Merge path — 1 mesh
    const pathMesh = mergeAndCreateMesh(globalGeos.path, mats.path);
    if (pathMesh) infraGroup.add(pathMesh);

    // Merge trace — 1 mesh
    const traceMesh = mergeAndCreateMesh(globalGeos.trace, mats.trace);
    if (traceMesh) infraGroup.add(traceMesh);

    // Merge overlays — 1 mesh per zone color
    for (const zone in overlayByZone) {
        const overlayMat = overlayMatCache[zone];
        if (!overlayMat) continue;
        const overlayMesh = mergeAndCreateMesh(overlayByZone[zone], overlayMat);
        if (overlayMesh) infraGroup.add(overlayMesh);
    }

    if (Core3D?.enableForeground3D) Core3D.enableForeground3D(infraGroup);
    ring.ringFloor.add(infraGroup);

    // Single entry for ALL infrastructure — no per-cell culling needed
    // (infrastructure is flat on the ring, GPU frustum culling handles visibility)
    results.push({
        mesh: infraGroup,
        segmentIndex: 0,
        baseAngle: 0,
        radius: ring.ringRadius,
        radialOffset: 0,
        isInfrastructure: true,
        isGlobalInfra: true,  // marker: don't angle-cull this
        cellKey: '__global_infra__'
    });

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
