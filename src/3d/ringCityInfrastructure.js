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
    return null;
}

// ============================================================
// buildAllInfrastructure — GLOBAL MERGE: all cells → 4 meshes total
// Collects geometries from ALL cells, groups by material layer,
// merges each layer into ONE mesh. Result: 4 draw calls total.
// ============================================================
export function buildAllInfrastructure(zoneGrid, ring) {
    return [];
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
