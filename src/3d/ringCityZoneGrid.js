// ============================================================
// Ring City Zone Grid — 192×4 polar zone grid system
// Ported from ringprocedural.html prototype
// ============================================================
import * as THREE from 'three';

// --- Constants ---
export const ZONE_COLS = 192;
export const ZONE_ROWS = 4;
export const ZONE_CELL_ARC = (Math.PI * 2) / ZONE_COLS;

let HOLE_ANGLES = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]; // updated by ring at init
const GATE_CLEARANCE = 0.14;

export const ZONE_PAD_ANGLE = ZONE_CELL_ARC * 0.14;
export const ZONE_PAD_RADIUS = 70;

export const AUTOSTRADA_WIDTH = 180;
export const AUTOSTRADA_LANE_OFFSET = 34;

export const ZONE_TYPES = ['residential', 'residential_mega', 'commercial', 'commercial_mega', 'industrial', 'military'];
const FILL_ZONE_KEYS = ['residential', 'industrial', 'military'];

export const COLORS = {
    residential:      { num: 0x00f3ff, css: '#00f3ff' },
    residential_mega: { num: 0x37a8ff, css: '#37a8ff' },
    industrial:       { num: 0xfcee0a, css: '#fcee0a' },
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
    if (zone === 'residential_mega') return 3 + Math.floor(rnd() * 2);
    if (zone === 'commercial_mega') return 3 + Math.floor(rnd() * 3);
    if (zone === 'residential') return 8 + Math.floor(rnd() * 4);
    if (zone === 'commercial') return 7 + Math.floor(rnd() * 4);
    if (zone === 'industrial') return 5 + Math.floor(rnd() * 3);
    if (zone === 'military') return 4 + Math.floor(rnd() * 3);
    return 6;
}

export function pickArrayEntry(rand, items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    return items[Math.floor(rand() * items.length)] || items[0] || null;
}

// --- Zone Grid Class ---
export class RingCityZoneGrid {
    constructor(ringRadius, ringHeight) {
        this.ringRadius = ringRadius;
        this.ringHeight = ringHeight;

        const streetWidth = 55;
        this.paintInner = ringRadius - ringHeight * 0.5 + streetWidth + 180;
        this.paintOuter = ringRadius + ringHeight * 0.5 - streetWidth - 180;

        // Autostrada dzieli ring na dwie połówki:
        // - Wewnętrzna (rows 0-1): paintInner → ringRadius - AUTOSTRADA_WIDTH/2
        // - Zewnętrzna (rows 2-3): ringRadius + AUTOSTRADA_WIDTH/2 → paintOuter
        const halfAuto = AUTOSTRADA_WIDTH * 0.5 + 30; // +30 margines bezpieczeństwa
        this.innerBandOuter = ringRadius - halfAuto;  // górna krawędź wewnętrznego pasma
        this.outerBandInner = ringRadius + halfAuto;   // dolna krawędź zewnętrznego pasma

        const ROWS_PER_BAND = ZONE_ROWS / 2; // 2 rzędy na każdą stronę
        this.innerLaneDepth = (this.innerBandOuter - this.paintInner) / ROWS_PER_BAND;
        this.outerLaneDepth = (this.paintOuter - this.outerBandInner) / ROWS_PER_BAND;

        this.cells = [];
        this.cellMeshes = new Map(); // key -> visual data

        this.reset();
    }

    reset() {
        this.cells = [];
        const ROWS_PER_BAND = ZONE_ROWS / 2;
        for (let row = 0; row < ZONE_ROWS; row++) {
            for (let col = 0; col < ZONE_COLS; col++) {
                const angleStart = col * ZONE_CELL_ARC;
                const angleEnd = angleStart + ZONE_CELL_ARC;

                let innerRadius, outerRadius;
                if (row < ROWS_PER_BAND) {
                    // Wewnętrzne pasmo (bliżej planety)
                    innerRadius = this.paintInner + row * this.innerLaneDepth;
                    outerRadius = innerRadius + this.innerLaneDepth;
                } else {
                    // Zewnętrzne pasmo (dalej od planety)
                    const outerRow = row - ROWS_PER_BAND;
                    innerRadius = this.outerBandInner + outerRow * this.outerLaneDepth;
                    outerRadius = innerRadius + this.outerLaneDepth;
                }

                this.cells.push({
                    col, row,
                    key: `${col}:${row}`,
                    zone: null,
                    angleStart, angleEnd,
                    innerRadius, outerRadius
                });
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

    // Weighted fill algorithm with neighbor clustering
    fillWithZones(weights = { residential: 50, industrial: 30, military: 20 }) {
        const seed = (((Date.now() >>> 0) ^ ((weights.residential * 31 + weights.industrial * 17 + weights.military * 13) >>> 0))) >>> 0;
        const rand = createSeededRandom(seed || 1);
        const assignments = new Array(this.cells.length).fill(null);

        // Clear existing
        for (const cell of this.cells) {
            cell.zone = null;
        }

        for (let row = 0; row < ZONE_ROWS; row++) {
            for (let col = 0; col < ZONE_COLS; col++) {
                const cell = this.getCell(col, row);
                if (!cell) continue;
                const centerAngle = cell.angleStart + ZONE_CELL_ARC * 0.5;
                if (isGateAngle(centerAngle)) {
                    assignments[this.cellIndex(col, row)] = null;
                    continue;
                }
                const zone = this._chooseFillZone(rand, col, row, weights, assignments);
                assignments[this.cellIndex(col, row)] = zone;
                cell.zone = zone;
            }
        }

        return this.cells.filter(c => c.zone !== null);
    }

    _chooseFillZone(rand, col, row, weights, assignments) {
        const weighted = {};
        let baseTotal = 0;
        for (const zone of FILL_ZONE_KEYS) {
            const base = Math.max(0, Number(weights[zone]) || 0);
            weighted[zone] = base;
            baseTotal += base;
        }
        if (baseTotal <= 0) {
            for (const zone of FILL_ZONE_KEYS) weighted[zone] = 1;
        }

        // Neighbor clustering bias
        const left = col > 0 ? assignments[this.cellIndex(col - 1, row)] : null;
        const left2 = col > 1 ? assignments[this.cellIndex(col - 2, row)] : null;
        const inner = row > 0 ? assignments[this.cellIndex(col, row - 1)] : null;

        if (left && weighted[left] !== undefined) weighted[left] += Math.max(6, weighted[left] * 0.65);
        if (left2 && left2 === left && weighted[left2] !== undefined) weighted[left2] += Math.max(4, weighted[left2] * 0.35);
        if (inner && weighted[inner] !== undefined) weighted[inner] += Math.max(5, weighted[inner] * 0.45);

        let total = 0;
        for (const zone of FILL_ZONE_KEYS) total += weighted[zone];
        if (total <= 0) return 'residential';

        let pick = rand() * total;
        for (const zone of FILL_ZONE_KEYS) {
            pick -= weighted[zone];
            if (pick <= 0) return zone;
        }
        return FILL_ZONE_KEYS[FILL_ZONE_KEYS.length - 1];
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
    const steps = Math.max(2, Math.ceil(span / (Math.PI / 48)));
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
