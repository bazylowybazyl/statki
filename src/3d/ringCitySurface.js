import * as THREE from 'three';

export const SYNTHCITY_BLOCK_SIZE = 128;
export const SYNTHCITY_ROAD_WIDTH = 24;
export const SYNTHCITY_PITCH = SYNTHCITY_BLOCK_SIZE + SYNTHCITY_ROAD_WIDTH;
export const SYNTHCITY_RIBBON_ROWS = 8;
export const SYNTHCITY_RIBBON_WIDTH = SYNTHCITY_PITCH * SYNTHCITY_RIBBON_ROWS;
export const OUTWARD_DOME_EDGE_HEIGHT = 160;

const TAU = Math.PI * 2;

export function resolveOutwardCitySurface(layout) {
    if (!layout?.inner) return null;
    const innerR = Number(layout.inner.innerR) || 0;
    const fallbackOuter = Number(layout.inner.outerR) || innerR + SYNTHCITY_RIBBON_WIDTH;
    const outerR = Number(layout.industrial?.outerR) || fallbackOuter;
    return {
        // Hinge the rotated city on its OUTER edge.  That edge shares the
        // exact circle used by the flat parking/logistics deck, so the two
        // surfaces meet instead of leaving a 1216-unit radial void between
        // them.  The ribbon then unfolds along +Z toward its former inner edge.
        baseRadius: outerR,
        sourceInnerRadius: innerR,
        sourceOuterRadius: outerR,
        width: Math.max(1, outerR - innerR),
        circumference: TAU * Math.max(1, outerR)
    };
}

export function computeOutwardDomeBulge(layout) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return 0;
    return Math.max(720, Math.min(980, surface.width * 0.72));
}

export function getOutwardDomeClearance(sourceRadius, layout, bulge = computeOutwardDomeBulge(layout)) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return 0;
    const span = Math.max(1, surface.sourceOuterRadius - surface.sourceInnerRadius);
    const across = THREE.MathUtils.clamp(
        ((Number(sourceRadius) || surface.sourceInnerRadius) - surface.sourceInnerRadius) / span,
        0,
        1
    );
    return OUTWARD_DOME_EDGE_HEIGHT + Math.sin(across * Math.PI) * Math.max(0, Number(bulge) || 0);
}

/**
 * Maps the existing ring-city local frame (X radial row, Y tangent, Z height)
 * onto an outward-facing cylindrical ribbon:
 *   local X -> -world Z, local Y -> tangent, local Z -> radial outward.
 * The former radial rows therefore become a true rectangular strip in Z.
 */
export function composeOutwardCityMatrix(angle, cellCenterRadius, layout, target = new THREE.Matrix4()) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return target.identity();
    const a = Number(angle) || 0;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const centerRadius = Number(cellCenterRadius) || surface.sourceInnerRadius;
    return target.set(
        0, -sinA, cosA, cosA * surface.baseRadius,
        0,  cosA, sinA, sinA * surface.baseRadius,
       -1,     0,    0, surface.sourceOuterRadius - centerRadius,
        0,     0,    0, 1
    );
}

/**
 * Maps SynthCity onto the planet-facing side of the structural ribbon:
 *   local X -> +world Z (across the rectangular deck)
 *   local Y -> tangent
 *   local Z -> radial inward, toward the planet
 *
 * The basis remains right-handed. The opposite side of the same ribbon can
 * therefore use composeOutwardCityMatrix as a space-facing logistics deck.
 */
export function composeInwardCityMatrix(angle, cellCenterRadius, layout, target = new THREE.Matrix4()) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return target.identity();
    const a = Number(angle) || 0;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const centerRadius = Number(cellCenterRadius) || surface.sourceInnerRadius;
    return target.set(
        0, -sinA, -cosA, cosA * surface.baseRadius,
        0,  cosA, -sinA, sinA * surface.baseRadius,
        1,     0,     0, centerRadius - surface.sourceInnerRadius,
        0,     0,     0, 1
    );
}

export function mapOutwardCityPoint(angle, sourceRadius, height, layout, target = new THREE.Vector3()) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return target.set(0, 0, 0);
    const a = Number(angle) || 0;
    const radius = surface.baseRadius + (Number(height) || 0);
    target.set(
        Math.cos(a) * radius,
        Math.sin(a) * radius,
        surface.sourceOuterRadius - (Number(sourceRadius) || surface.sourceInnerRadius)
    );
    return target;
}

export function mapInwardCityPoint(angle, sourceRadius, height, layout, target = new THREE.Vector3()) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return target.set(0, 0, 0);
    const a = Number(angle) || 0;
    const radius = surface.baseRadius - (Number(height) || 0);
    target.set(
        Math.cos(a) * radius,
        Math.sin(a) * radius,
        (Number(sourceRadius) || surface.sourceInnerRadius) - surface.sourceInnerRadius
    );
    return target;
}

export function createOutwardRibbonGeometry(layout, radialOffset = 0, angularSteps = 1024) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return null;
    const count = Math.max(64, Math.floor(Number(angularSteps) || 1024));
    const radius = surface.baseRadius + (Number(radialOffset) || 0);
    const positions = new Float32Array(count * 6 * 3);
    const uvs = new Float32Array(count * 6 * 2);
    // Close the repeating ground texture exactly at the seam.  The real
    // circumference is represented by the nearest whole number of 152-unit
    // SynthCity pitches (the sub-percent pitch correction is imperceptible).
    const tilesAround = Math.max(1, Math.round(surface.circumference / SYNTHCITY_PITCH));
    const tilesAcross = surface.width / SYNTHCITY_PITCH;
    let p = 0;
    let uv = 0;

    for (let i = 0; i < count; i++) {
        const f0 = i / count;
        const f1 = (i + 1) / count;
        const a0 = f0 * TAU;
        const a1 = f1 * TAU;
        const x0 = Math.cos(a0) * radius;
        const y0 = Math.sin(a0) * radius;
        const x1 = Math.cos(a1) * radius;
        const y1 = Math.sin(a1) * radius;
        const z0 = 0;
        const z1 = surface.width;

        // Counter-clockwise from open space: keep the ribbon's generated
        // normals radial-outward, matching the buildings and canopy.
        positions.set([
            x0, y0, z0, x1, y1, z1, x0, y0, z1,
            x0, y0, z0, x1, y1, z0, x1, y1, z1
        ], p);
        p += 18;
        // SynthCity's 152-unit ground tile is centred at blockStart + 64,
        // so its texture starts 12 units before the logical block origin.
        // Preserve that phase and flip V because the outward ribbon maps the
        // former radial axis in the opposite direction (outer edge -> z=0).
        const phase = SYNTHCITY_ROAD_WIDTH * 0.5 / SYNTHCITY_PITCH;
        const u0 = f0 * tilesAround + phase;
        const u1 = f1 * tilesAround + phase;
        const vOuter = tilesAcross + phase;
        const vInner = phase;
        uvs.set([
            u0, vOuter, u1, vInner, u0, vInner,
            u0, vOuter, u1, vOuter, u1, vInner
        ], uv);
        uv += 12;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
}

export function createInwardRibbonGeometry(layout, radialOffset = 0, angularSteps = 1024) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return null;
    const count = Math.max(64, Math.floor(Number(angularSteps) || 1024));
    const radius = surface.baseRadius - (Number(radialOffset) || 0);
    const positions = new Float32Array(count * 6 * 3);
    const uvs = new Float32Array(count * 6 * 2);
    const tilesAround = Math.max(1, Math.round(surface.circumference / SYNTHCITY_PITCH));
    const tilesAcross = surface.width / SYNTHCITY_PITCH;
    const phase = SYNTHCITY_ROAD_WIDTH * 0.5 / SYNTHCITY_PITCH;
    let p = 0;
    let uv = 0;

    for (let i = 0; i < count; i++) {
        const f0 = i / count;
        const f1 = (i + 1) / count;
        const a0 = f0 * TAU;
        const a1 = f1 * TAU;
        const x0 = Math.cos(a0) * radius;
        const y0 = Math.sin(a0) * radius;
        const x1 = Math.cos(a1) * radius;
        const y1 = Math.sin(a1) * radius;
        const z0 = 0;
        const z1 = surface.width;

        // Reversed winding: the city-facing side points radially inward.
        positions.set([
            x0, y0, z0, x0, y0, z1, x1, y1, z1,
            x0, y0, z0, x1, y1, z1, x1, y1, z0
        ], p);
        p += 18;
        const u0 = f0 * tilesAround + phase;
        const u1 = f1 * tilesAround + phase;
        const vInner = phase;
        const vOuter = tilesAcross + phase;
        uvs.set([
            u0, vInner, u0, vOuter, u1, vOuter,
            u0, vInner, u1, vOuter, u1, vInner
        ], uv);
        uv += 12;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
}

export function createOutwardDomeGeometry(
    layout,
    bulge = computeOutwardDomeBulge(layout),
    angularSteps = 1024,
    widthSteps = 12,
    edgeHeight = OUTWARD_DOME_EDGE_HEIGHT
) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return null;
    const around = Math.max(64, Math.floor(Number(angularSteps) || 1024));
    const across = Math.max(4, Math.floor(Number(widthSteps) || 12));
    // Indexed grid: vertices are shared across neighbouring cells, producing
    // smooth normals and cutting the canopy vertex count by roughly 5x.
    const vertexCount = (around + 1) * (across + 1);
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(around * across * 6);
    const domeBulge = Math.max(20, Number(bulge) || 420);

    let positionOffset = 0;
    let uvOffset = 0;
    for (let i = 0; i <= around; i++) {
        const u = i / around;
        const angle = u * TAU;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        for (let j = 0; j <= across; j++) {
            const v = j / across;
            const radius = surface.baseRadius + edgeHeight + Math.sin(v * Math.PI) * domeBulge;
            positions[positionOffset++] = cosA * radius;
            positions[positionOffset++] = sinA * radius;
            positions[positionOffset++] = v * surface.width;
            uvs[uvOffset++] = u;
            uvs[uvOffset++] = v;
        }
    }

    let indexOffset = 0;
    const rowSize = across + 1;
    for (let i = 0; i < around; i++) {
        for (let j = 0; j < across; j++) {
            const p00 = i * rowSize + j;
            const p01 = p00 + 1;
            const p10 = (i + 1) * rowSize + j;
            const p11 = p10 + 1;
            // Reversed relative to the former implementation: normals face
            // radially outward, so FrontSide is visible from open space.
            indices[indexOffset++] = p00;
            indices[indexOffset++] = p11;
            indices[indexOffset++] = p01;
            indices[indexOffset++] = p00;
            indices[indexOffset++] = p10;
            indices[indexOffset++] = p11;
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
}

export function createInwardDomeGeometry(
    layout,
    bulge = computeOutwardDomeBulge(layout),
    angularSteps = 1024,
    widthSteps = 12,
    edgeHeight = OUTWARD_DOME_EDGE_HEIGHT
) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return null;
    const around = Math.max(64, Math.floor(Number(angularSteps) || 1024));
    const across = Math.max(4, Math.floor(Number(widthSteps) || 12));
    const vertexCount = (around + 1) * (across + 1);
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(around * across * 6);
    const domeBulge = Math.max(20, Number(bulge) || 420);

    let positionOffset = 0;
    let uvOffset = 0;
    for (let i = 0; i <= around; i++) {
        const u = i / around;
        const angle = u * TAU;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        for (let j = 0; j <= across; j++) {
            const v = j / across;
            const radius = surface.baseRadius - edgeHeight - Math.sin(v * Math.PI) * domeBulge;
            positions[positionOffset++] = cosA * radius;
            positions[positionOffset++] = sinA * radius;
            positions[positionOffset++] = v * surface.width;
            uvs[uvOffset++] = u;
            uvs[uvOffset++] = v;
        }
    }

    let indexOffset = 0;
    const rowSize = across + 1;
    for (let i = 0; i < around; i++) {
        for (let j = 0; j < across; j++) {
            const p00 = i * rowSize + j;
            const p01 = p00 + 1;
            const p10 = (i + 1) * rowSize + j;
            const p11 = p10 + 1;
            indices[indexOffset++] = p00;
            indices[indexOffset++] = p01;
            indices[indexOffset++] = p11;
            indices[indexOffset++] = p00;
            indices[indexOffset++] = p11;
            indices[indexOffset++] = p10;
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
}

export function createOutwardDomeRibsGeometry(
    layout,
    bulge = computeOutwardDomeBulge(layout),
    ribCount = 128,
    widthSteps = 16,
    edgeHeight = OUTWARD_DOME_EDGE_HEIGHT
) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return null;
    const ribs = Math.max(16, Math.floor(Number(ribCount) || 128));
    const across = Math.max(4, Math.floor(Number(widthSteps) || 16));
    const domeBulge = Math.max(20, Number(bulge) || 420);
    const positions = [];
    for (let i = 0; i < ribs; i++) {
        const angle = (i / ribs) * TAU;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        for (let j = 0; j < across; j++) {
            const v0 = j / across;
            const v1 = (j + 1) / across;
            const r0 = surface.baseRadius + edgeHeight + Math.sin(v0 * Math.PI) * domeBulge + 2;
            const r1 = surface.baseRadius + edgeHeight + Math.sin(v1 * Math.PI) * domeBulge + 2;
            positions.push(
                cosA * r0, sinA * r0, v0 * surface.width,
                cosA * r1, sinA * r1, v1 * surface.width
            );
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
}

export function createInwardDomeRibsGeometry(
    layout,
    bulge = computeOutwardDomeBulge(layout),
    ribCount = 128,
    widthSteps = 16,
    edgeHeight = OUTWARD_DOME_EDGE_HEIGHT
) {
    const surface = resolveOutwardCitySurface(layout);
    if (!surface) return null;
    const ribs = Math.max(16, Math.floor(Number(ribCount) || 128));
    const across = Math.max(4, Math.floor(Number(widthSteps) || 16));
    const domeBulge = Math.max(20, Number(bulge) || 420);
    const positions = [];
    for (let i = 0; i < ribs; i++) {
        const angle = (i / ribs) * TAU;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        for (let j = 0; j < across; j++) {
            const v0 = j / across;
            const v1 = (j + 1) / across;
            const r0 = surface.baseRadius - edgeHeight - Math.sin(v0 * Math.PI) * domeBulge - 2;
            const r1 = surface.baseRadius - edgeHeight - Math.sin(v1 * Math.PI) * domeBulge - 2;
            positions.push(
                cosA * r0, sinA * r0, v0 * surface.width,
                cosA * r1, sinA * r1, v1 * surface.width
            );
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
}
