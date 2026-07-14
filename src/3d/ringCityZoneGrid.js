// ============================================================
// Ring City Zone Grid — 192×4 polar zone grid system
// Ported from ringprocedural.html prototype
// ============================================================
import * as THREE from 'three';
import { SYNTHCITY_RIBBON_ROWS } from './ringCitySurface.js';

// --- Constants ---
export const ZONE_COLS = 192;

// The retired factory band is now part of one 8-row SynthCity rectangle.
export const INNER_RING_ROWS = SYNTHCITY_RIBBON_ROWS;
export const INDUSTRIAL_RING_ROWS = 0;
export const MILITARY_RING_ROWS = 2;
export const ZONE_ROWS = INNER_RING_ROWS + INDUSTRIAL_RING_ROWS + MILITARY_RING_ROWS; // 7

// Ring identifiers
export const RING_INNER = 'inner';
export const RING_INDUSTRIAL = 'industrial';
export const RING_MILITARY = 'military';

// Row → ring mapping (used for reverse lookup)
export function getRingForRow(row) {
    if (row < INNER_RING_ROWS) return RING_INNER;
    if (row < INNER_RING_ROWS + INDUSTRIAL_RING_ROWS) return RING_INDUSTRIAL;
    return RING_MILITARY;
}

// Which zone types are allowed per ring
export const RING_ZONE_POOLS = {
    [RING_INNER]: ['residential', 'commercial'],
    // Factory districts were retired. This legacy band is rendered as part of
    // the continuous baked city and must not receive procedural zones.
    [RING_INDUSTRIAL]: [],
    // The outer band is intentionally not a zoned district. Cranes, trains,
    // gates and future infrastructure are built by dedicated systems.
    [RING_MILITARY]: []
};

export const ZONE_CELL_ARC = (Math.PI * 2) / ZONE_COLS;

let HOLE_ANGLES = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]; // legacy fallback
const GATE_CLEARANCE = 0.14;

export const ZONE_PAD_ANGLE = 0;
export const ZONE_PAD_RADIUS = 0;

// Legacy (kept for decorative lane markers on pedestals)
export const AUTOSTRADA_WIDTH = 180;
export const AUTOSTRADA_LANE_OFFSET = 34;

export const ZONE_TYPES = ['residential', 'residential_mega', 'commercial', 'commercial_mega'];

export const COLORS = {
    residential:      { num: 0x00f3ff, css: '#00f3ff' },
    residential_mega: { num: 0x37a8ff, css: '#37a8ff' },
    military:         { num: 0xff003c, css: '#ff003c' },
    commercial:       { num: 0xb800ff, css: '#b800ff' },
    commercial_mega:  { num: 0xff4cf4, css: '#ff4cf4' },
};

// --- Helpers ---
export function wrapZoneCol(col) {
    let next = col % ZONE_COLS;
    if (next < 0) next += ZONE_COLS;
    return next;
}

function normalizeAngle(angle) {
    let a = angle % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a;
}

function angleDistance(a, b) {
    let diff = Math.abs(a - b);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    return diff;
}

export function isGateAngle(angle) {
    const normalized = normalizeAngle(angle);
    for (const holeAngle of HOLE_ANGLES) {
        if (angleDistance(normalized, holeAngle) < GATE_CLEARANCE) return true;
    }
    return false;
}

export function isAngleInsideGateDescriptors(angle, gateDescriptors, margin = 0) {
    if (!Array.isArray(gateDescriptors) || gateDescriptors.length === 0) return false;
    const normalized = normalizeAngle(angle);
    const safeMargin = Math.max(0, Number(margin) || 0);
    for (const gate of gateDescriptors) {
        const center = normalizeAngle(Number(gate?.centerAngle) || 0);
        const halfAngle = Math.max(0, Number(gate?.halfAngle) || 0) + safeMargin;
        if (halfAngle > 0 && angleDistance(normalized, center) <= halfAngle) return true;
    }
    return false;
}

export function setHoleAngles(angles) {
    if (Array.isArray(angles) && angles.length > 0) {
        HOLE_ANGLES = angles;
    }
}

export function createSeededRandom(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

export function hashZoneSeed(cell, zone) {
    let hash = ((cell.col + 1) * 73856093) ^ ((cell.row + 1) * 19349663);
    for (let i = 0; i < zone.length; i++) {
        hash = ((hash << 5) - hash + zone.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
}

export function getZoneFamily(zone) {
    if (zone === 'residential_mega') return 'residential';
    if (zone === 'commercial_mega') return 'commercial';
    return zone;
}

export function isMegaZone(zone) {
    return zone === 'residential_mega' || zone === 'commercial_mega';
}

export function getZoneTargetBuildingCount(zone, rnd = Math.random) {
    if (zone === 'residential_mega') return 1 + Math.floor(rnd() * 2);
    if (zone === 'commercial_mega') return 1 + Math.floor(rnd() * 3);
    if (zone === 'residential') return 1 + Math.floor(rnd() * 4);
    if (zone === 'commercial') return 1 + Math.floor(rnd() * 4);
    if (zone === 'military') return 1 + Math.floor(rnd() * 3);
    return 6;
}

export function pickArrayEntry(rand, items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    return items[Math.floor(rand() * items.length)] || items[0] || null;
}

// --- Zone Grid Class ---
export class RingCityZoneGrid {
    constructor(layout, options = {}) {
        // layout = { inner: {innerR, outerR}, industrial: {innerR, outerR}, military: {innerR, outerR}, outerRadius, innerRadius }
        this.layout = layout;
        // Backwards-compat references (some callsites still read these)
        this.ringRadius = layout?.outerRadius || 0;
        this.ringHeight = (layout?.military?.outerR || 0) - (layout?.inner?.innerR || 0);

        this.cells = [];
        this.cellMeshes = new Map(); // key -> visual data
        this.gateDescriptors = Array.isArray(options.gateDescriptors) ? options.gateDescriptors : [];

        this.reset();
    }

    setGateDescriptors(gateDescriptors) {
        this.gateDescriptors = Array.isArray(gateDescriptors) ? gateDescriptors : [];
        return this;
    }

    isDefenseGateAngle(angle, margin = 0) {
        return isAngleInsideGateDescriptors(angle, this.gateDescriptors, margin);
    }

    reset() {
        this.cells = [];
        const L = this.layout;
        if (!L) return;

        const rings = [
            {
                id: RING_INNER,
                rows: INNER_RING_ROWS,
                band: {
                    innerR: L.inner?.innerR,
                    outerR: L.industrial?.outerR ?? L.inner?.outerR
                },
                rowOffset: 0
            },
            { id: RING_MILITARY,   rows: MILITARY_RING_ROWS,   band: L.military,   rowOffset: INNER_RING_ROWS + INDUSTRIAL_RING_ROWS }
        ];

        for (const ring of rings) {
            if (!ring.band || ring.rows <= 0) continue;
            const laneDepth = (ring.band.outerR - ring.band.innerR) / ring.rows;
            for (let r = 0; r < ring.rows; r++) {
                const row = ring.rowOffset + r;
                const cellInner = ring.band.innerR + r * laneDepth;
                const cellOuter = cellInner + laneDepth;
                for (let col = 0; col < ZONE_COLS; col++) {
                    const angleStart = col * ZONE_CELL_ARC;
                    const angleEnd = angleStart + ZONE_CELL_ARC;
                    this.cells.push({
                        col, row,
                        ring: ring.id,
                        key: `${col}:${row}`,
                        zone: null,
                        angleStart, angleEnd,
                        innerRadius: cellInner,
                        outerRadius: cellOuter
                    });
                }
            }
        }
    }

    cellIndex(col, row) {
        return row * ZONE_COLS + wrapZoneCol(col);
    }

    cellKey(col, row) {
        return `${wrapZoneCol(col)}:${row}`;
    }

    getCell(col, row) {
        if (row < 0 || row >= ZONE_ROWS) return null;
        return this.cells[this.cellIndex(col, row)] || null;
    }

    setCell(col, row, zone) {
        const cell = this.getCell(col, row);
        if ((cell?.ring === RING_INDUSTRIAL || cell?.ring === RING_MILITARY) && zone !== null) return false;
        if (zone !== null && !ZONE_TYPES.includes(zone)) return false;
        if (!cell || cell.zone === zone) return false;
        cell.zone = zone;
        return true;
    }

    getCellHubPosition(cell) {
        const hubAngle = (cell.angleStart + cell.angleEnd) * 0.5;
        const hubRadius = (cell.innerRadius + cell.outerRadius) * 0.5;
        return {
            angle: hubAngle,
            radius: hubRadius,
            x: Math.cos(hubAngle) * hubRadius,
            y: Math.sin(hubAngle) * hubRadius
        };
    }

    // Weighted fill — each ring is filled independently from its own zone pool.
    fillWithZones(weights = { residential: 60, commercial: 40 }) {
        const wSum = ((weights.residential || 0) * 31 +
                      (weights.commercial || 0) * 23) >>> 0;
        const seed = ((Date.now() >>> 0) ^ wSum) >>> 0;
        const rand = createSeededRandom(seed || 1);
        const assignments = new Array(this.cells.length).fill(null);

        // Clear existing
        for (const cell of this.cells) cell.zone = null;

        // Per-ring fill — pool limited to that ring's allowed types
        for (const ringId of [RING_INNER]) {
            const pool = RING_ZONE_POOLS[ringId];
            if (!pool || pool.length === 0) continue;

            for (let row = 0; row < ZONE_ROWS; row++) {
                if (getRingForRow(row) !== ringId) continue;
                for (let col = 0; col < ZONE_COLS; col++) {
                    const cell = this.getCell(col, row);
                    if (!cell) continue;
                    const centerAngle = cell.angleStart + ZONE_CELL_ARC * 0.5;
                    const zone = this._chooseFillZoneForRing(rand, col, row, pool, weights, assignments);
                    assignments[this.cellIndex(col, row)] = zone;
                    cell.zone = zone;
                }
            }
        }

        return this.cells.filter(c => c.zone !== null);
    }

    _chooseFillZoneForRing(rand, col, row, pool, weights, assignments) {
        // If a ring ever exposes one zone type, return it directly.
        if (pool.length === 1) return pool[0];

        const weighted = {};
        let baseTotal = 0;
        for (const zone of pool) {
            const base = Math.max(0, Number(weights[zone]) || 0);
            weighted[zone] = base;
            baseTotal += base;
        }
        if (baseTotal <= 0) {
            for (const zone of pool) weighted[zone] = 1;
        }

        // Neighbor clustering bias — but only consider neighbors in the same ring
        const currentRingId = getRingForRow(row);
        const inSameRing = (r) => r >= 0 && r < ZONE_ROWS && getRingForRow(r) === currentRingId;

        const left  = col > 0 ? assignments[this.cellIndex(col - 1, row)] : null;
        const left2 = col > 1 ? assignments[this.cellIndex(col - 2, row)] : null;
        const inner = inSameRing(row - 1) ? assignments[this.cellIndex(col, row - 1)] : null;

        if (left && weighted[left] !== undefined) weighted[left] += Math.max(6, weighted[left] * 0.65);
        if (left2 && left2 === left && weighted[left2] !== undefined) weighted[left2] += Math.max(4, weighted[left2] * 0.35);
        if (inner && weighted[inner] !== undefined) weighted[inner] += Math.max(5, weighted[inner] * 0.45);

        let total = 0;
        for (const zone of pool) total += weighted[zone];
        if (total <= 0) return pool[0];

        let pick = rand() * total;
        for (const zone of pool) {
            pick -= weighted[zone];
            if (pick <= 0) return zone;
        }
        return pool[pool.length - 1];
    }

    // Return cells belonging to a specific ring (used by buildings/infrastructure)
    getCellsForRing(ringId) {
        return this.cells.filter(c => c.ring === ringId);
    }

    // Map zone cell to overlapping ring segment indices
    mapCellToSegments(angleStep, segmentCount) {
        const result = {};
        for (const cell of this.cells) {
            if (!cell.zone) continue;
            const startIdx = Math.floor(cell.angleStart / angleStep);
            const endIdx = Math.ceil(cell.angleEnd / angleStep);
            const segments = [];
            for (let i = startIdx; i < endIdx && i < segmentCount; i++) {
                segments.push(i >= 0 ? i : i + segmentCount);
            }
            result[cell.key] = segments;
        }
        return result;
    }

    getPopulatedCells() {
        return this.cells.filter(c => c.zone !== null);
    }
}

// --- Polar sector geometry (used for infrastructure floors/streets) ---
export function createSectorGeometry(innerRadius, outerRadius, startAngle, endAngle, y = 0) {
    const span = Math.max(0.0001, endAngle - startAngle);
    const steps = Math.max(
        2,
        Math.ceil(span / (Math.PI / 48)),
        Math.ceil((span * Math.max(innerRadius, outerRadius)) / 360)
    );
    const positions = [];
    const uvs = [];
    const uvScale = 320;
    for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const a0 = startAngle + span * t0;
        const a1 = startAngle + span * t1;
        const x00 = Math.cos(a0) * innerRadius;
        const z00 = Math.sin(a0) * innerRadius;
        const x01 = Math.cos(a1) * innerRadius;
        const z01 = Math.sin(a1) * innerRadius;
        const x10 = Math.cos(a0) * outerRadius;
        const z10 = Math.sin(a0) * outerRadius;
        const x11 = Math.cos(a1) * outerRadius;
        const z11 = Math.sin(a1) * outerRadius;
        positions.push(
            x00, y, z00,
            x10, y, z10,
            x11, y, z11,
            x00, y, z00,
            x11, y, z11,
            x01, y, z01
        );
        uvs.push(
            x00 / uvScale, z00 / uvScale,
            x10 / uvScale, z10 / uvScale,
            x11 / uvScale, z11 / uvScale,
            x00 / uvScale, z00 / uvScale,
            x11 / uvScale, z11 / uvScale,
            x01 / uvScale, z01 / uvScale
        );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
}
