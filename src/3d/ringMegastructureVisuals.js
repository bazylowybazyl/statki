import * as THREE from 'three';
import { Core3D } from './core3d.js';
import {
    computeOutwardDomeBulge,
    createInwardDomeGeometry,
    createInwardDomeRibsGeometry,
    createOutwardRibbonGeometry,
    OUTWARD_DOME_EDGE_HEIGHT,
    resolveOutwardCitySurface
} from './ringCitySurface.js';

const TAU = Math.PI * 2;

function arcSteps(innerRadius, outerRadius, startAngle, endAngle, targetWorldStep = 180) {
    const span = Math.max(0, Number(endAngle) - Number(startAngle));
    const radius = Math.max(1, (Math.abs(innerRadius) + Math.abs(outerRadius)) * 0.5);
    return Math.max(1, Math.min(512, Math.ceil((span * radius) / targetWorldStep)));
}

function pushQuad(positions, uvs, a, b, c, d, uv = [0, 0, 1, 0, 1, 1, 0, 1]) {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    uvs.push(
        uv[0], uv[1], uv[2], uv[3], uv[4], uv[5],
        uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]
    );
}

function finishGeometry(positions, uvs) {
    if (!positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
}

function pointAt(radius, angle, z) {
    return [Math.cos(angle) * radius, Math.sin(angle) * radius, z];
}

export function createAnnularBandRangesGeometry(innerRadius, outerRadius, ranges, z = 0) {
    const positions = [];
    const uvs = [];
    const inner = Math.max(1, Math.min(innerRadius, outerRadius));
    const outer = Math.max(inner + 1, Math.max(innerRadius, outerRadius));

    for (const range of ranges || []) {
        const start = Number(range?.start);
        const end = Number(range?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        const steps = arcSteps(inner, outer, start, end);
        for (let i = 0; i < steps; i++) {
            const a0 = start + ((end - start) * i) / steps;
            const a1 = start + ((end - start) * (i + 1)) / steps;
            const u0 = (a0 - start) / Math.max(0.0001, end - start);
            const u1 = (a1 - start) / Math.max(0.0001, end - start);
            pushQuad(
                positions,
                uvs,
                pointAt(inner, a0, z),
                pointAt(outer, a0, z),
                pointAt(outer, a1, z),
                pointAt(inner, a1, z),
                [u0, 0, u0, 1, u1, 1, u1, 0]
            );
        }
    }
    return finishGeometry(positions, uvs);
}

export function createAnnularBoxRangesGeometry(innerRadius, outerRadius, height, z, ranges) {
    const positions = [];
    const uvs = [];
    const inner = Math.max(1, Math.min(innerRadius, outerRadius));
    const outer = Math.max(inner + 1, Math.max(innerRadius, outerRadius));
    const z0 = Number(z) || 0;
    const z1 = z0 + Math.max(1, Number(height) || 1);

    for (const range of ranges || []) {
        const start = Number(range?.start);
        const end = Number(range?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        const steps = arcSteps(inner, outer, start, end);
        for (let i = 0; i < steps; i++) {
            const a0 = start + ((end - start) * i) / steps;
            const a1 = start + ((end - start) * (i + 1)) / steps;
            const u0 = i / steps;
            const u1 = (i + 1) / steps;
            pushQuad(positions, uvs, pointAt(outer, a0, z0), pointAt(outer, a1, z0), pointAt(outer, a1, z1), pointAt(outer, a0, z1), [u0, 0, u1, 0, u1, 1, u0, 1]);
            pushQuad(positions, uvs, pointAt(inner, a1, z0), pointAt(inner, a0, z0), pointAt(inner, a0, z1), pointAt(inner, a1, z1), [u1, 0, u0, 0, u0, 1, u1, 1]);
            pushQuad(positions, uvs, pointAt(inner, a0, z1), pointAt(outer, a0, z1), pointAt(outer, a1, z1), pointAt(inner, a1, z1), [u0, 0, u0, 1, u1, 1, u1, 0]);
        }

        if ((end - start) < TAU - 0.001) {
            pushQuad(positions, uvs, pointAt(inner, start, z0), pointAt(inner, start, z1), pointAt(outer, start, z1), pointAt(outer, start, z0));
            pushQuad(positions, uvs, pointAt(outer, end, z0), pointAt(outer, end, z1), pointAt(inner, end, z1), pointAt(inner, end, z0));
        }
    }
    return finishGeometry(positions, uvs);
}

export function createDomeShellGeometry(innerRadius, outerRadius, ranges, zBase = 8, radialSegments = 14) {
    const positions = [];
    const uvs = [];
    const inner = Math.max(1, Math.min(innerRadius, outerRadius));
    const outer = Math.max(inner + 1, Math.max(innerRadius, outerRadius));
    const majorRadius = (inner + outer) * 0.5;
    const domeRadius = (outer - inner) * 0.5;
    const radialSteps = Math.max(6, Math.floor(radialSegments));

    for (const range of ranges || []) {
        const start = Number(range?.start);
        const end = Number(range?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        const steps = arcSteps(majorRadius, majorRadius, start, end, 150);
        for (let i = 0; i < steps; i++) {
            const a0 = start + ((end - start) * i) / steps;
            const a1 = start + ((end - start) * (i + 1)) / steps;
            const u0 = (a0 % TAU) / TAU;
            const u1 = (a1 % TAU) / TAU;
            for (let j = 0; j < radialSteps; j++) {
                const v0 = j / radialSteps;
                const v1 = (j + 1) / radialSteps;
                const phi0 = Math.PI * (1 - v0);
                const phi1 = Math.PI * (1 - v1);
                const r0 = majorRadius + Math.cos(phi0) * domeRadius;
                const r1 = majorRadius + Math.cos(phi1) * domeRadius;
                const h0 = zBase + Math.sin(phi0) * domeRadius;
                const h1 = zBase + Math.sin(phi1) * domeRadius;
                pushQuad(
                    positions,
                    uvs,
                    pointAt(r0, a0, h0),
                    pointAt(r1, a0, h1),
                    pointAt(r1, a1, h1),
                    pointAt(r0, a1, h0),
                    [u0, v0, u0, v1, u1, v1, u1, v0]
                );
            }
        }
    }
    return finishGeometry(positions, uvs);
}

function createDomeRibGeometry(innerRadius, outerRadius, ranges, zBase, spacingWorld = 720, radialSteps = 18) {
    const points = [];
    const inner = Math.max(1, Math.min(innerRadius, outerRadius));
    const outer = Math.max(inner + 1, Math.max(innerRadius, outerRadius));
    const major = (inner + outer) * 0.5;
    const tube = (outer - inner) * 0.5;

    for (const range of ranges || []) {
        const span = Math.max(0, Number(range?.end) - Number(range?.start));
        if (!(span > 0)) continue;
        const count = Math.max(2, Math.ceil((span * major) / spacingWorld));
        for (let i = 0; i <= count; i++) {
            const angle = Number(range.start) + (span * i) / count;
            for (let j = 0; j < radialSteps; j++) {
                const phi0 = Math.PI * (1 - j / radialSteps);
                const phi1 = Math.PI * (1 - (j + 1) / radialSteps);
                points.push(
                    ...pointAt(major + Math.cos(phi0) * tube, angle, zBase + Math.sin(phi0) * tube + 2),
                    ...pointAt(major + Math.cos(phi1) * tube, angle, zBase + Math.sin(phi1) * tube + 2)
                );
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.computeBoundingSphere();
    return geometry;
}

function setRingLayer(object) {
    object.userData.fgCategory = 'buildings';
    if (Core3D?.enableForeground3D) Core3D.enableForeground3D(object);
    return object;
}

function addMesh(group, geometry, material, name, renderOrder = 0) {
    if (!geometry) return null;
    const mesh = setRingLayer(new THREE.Mesh(geometry, material));
    mesh.name = name;
    mesh.renderOrder = renderOrder;
    group.add(mesh);
    return mesh;
}


export class RingMegastructureVisuals {
    constructor(layout, key = 'ring', options = {}) {
        this.layout = layout;
        this.key = key;
        this.citySurfaceMode = options.citySurfaceMode || 'flat';
        this.group = setRingLayer(new THREE.Group());
        this.group.name = `RingMegastructure:${key}`;
        this.meshes = [];
        this.materials = null;
    }

    build({ defenseArcRanges = [{ start: 0, end: TAU }], gateDescriptors = [] } = {}) {
        const layout = this.layout;
        if (!layout?.inner || !layout?.industrial || !layout?.military) return this.group;

        const fullRing = [{ start: 0, end: TAU }];
        const domeChunks = Array.from({ length: 4 }, (_, index) => ({
            start: index * Math.PI * 0.5,
            end: (index + 1) * Math.PI * 0.5
        }));
        const cityInner = layout.inner.innerR;
        const cityOuter = layout.industrial.outerR;
        const materials = this.materials = {
            cityWall: new THREE.MeshStandardMaterial({ color: 0x101b28, emissive: 0x052638, emissiveIntensity: 0.25, roughness: 0.72, metalness: 0.48, side: THREE.DoubleSide }),
            parkingDeck: new THREE.MeshStandardMaterial({ color: 0x071019, emissive: 0x021923, emissiveIntensity: 0.22, roughness: 0.72, metalness: 0.68, side: THREE.DoubleSide }),
            dome: new THREE.MeshStandardMaterial({ color: 0x438caf, emissive: 0x061821, emissiveIntensity: 0.12, roughness: 0.28, metalness: 0.03, transparent: true, opacity: 0.075, depthWrite: false, depthTest: true, side: THREE.FrontSide, blending: THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
            domeFrame: new THREE.LineBasicMaterial({ color: 0x62c5ec, transparent: true, opacity: 0.34, depthWrite: false, depthTest: true })
        };

        if (this.citySurfaceMode === 'inward') {
            const surface = resolveOutwardCitySurface(layout);
            const domeBulge = computeOutwardDomeBulge(layout);
            this.meshes.push(addMesh(
                this.group,
                createInwardDomeGeometry(layout, domeBulge, 1536, 14),
                materials.dome,
                `RingCityDomeInward:${this.key}`,
                8
            ));
            const ribGeometry = createInwardDomeRibsGeometry(layout, domeBulge, 128, 18);
            if (ribGeometry) {
                const ribs = setRingLayer(new THREE.LineSegments(ribGeometry, materials.domeFrame));
                ribs.name = `RingCityDomeRibsInward:${this.key}`;
                ribs.renderOrder = 9;
                this.group.add(ribs);
                this.meshes.push(ribs);
            }
            // The city and the new space-facing logistics deck share one
            // structural ribbon. A small radial separation gives it visible
            // thickness while keeping both sides aligned 1:1.
            this.meshes.push(addMesh(
                this.group,
                createOutwardRibbonGeometry(layout, 18, 1536),
                materials.parkingDeck,
                `RingOuterLogisticsDeck:${this.key}`,
                0
            ));

            // Opaque end walls close the planet-facing canopy and the outer
            // hull. The city now occupies radii below the structural surface.
            for (const z of [0, surface.width]) {
                const wall = new THREE.RingGeometry(
                    surface.baseRadius - OUTWARD_DOME_EDGE_HEIGHT,
                    surface.baseRadius + 18,
                    768
                );
                const wallMesh = addMesh(this.group, wall, materials.cityWall, `RingCityRibbonWall:${this.key}:${z}`, 1);
                if (wallMesh) wallMesh.position.z = z;
                this.meshes.push(wallMesh);

                const edge = new THREE.TorusGeometry(
                    surface.baseRadius - OUTWARD_DOME_EDGE_HEIGHT,
                    14,
                    6,
                    768
                );
                const mesh = addMesh(this.group, edge, materials.cityWall, `RingCityRibbonEdge:${this.key}:${z}`, 1);
                if (mesh) mesh.position.z = z;
                this.meshes.push(mesh);
            }
        } else {
            const domeBaseZ = 10;
            domeChunks.forEach((range, index) => {
                this.meshes.push(addMesh(
                    this.group,
                    createDomeShellGeometry(cityInner, cityOuter, [range], domeBaseZ),
                    materials.dome,
                    `RingCityDome:${this.key}:${index}`,
                    8
                ));
            });
            const ribs = setRingLayer(new THREE.LineSegments(createDomeRibGeometry(cityInner, cityOuter, fullRing, domeBaseZ), materials.domeFrame));
            ribs.name = `RingCityDomeRibs:${this.key}`;
            ribs.renderOrder = 9;
            this.group.add(ribs);
            this.meshes.push(ribs);

            const cityWallThickness = Math.max(24, Math.min(48, (cityOuter - cityInner) * 0.035));
            this.meshes.push(addMesh(this.group, createAnnularBoxRangesGeometry(cityInner, cityInner + cityWallThickness, 105, 2, fullRing), materials.cityWall, `RingCityInnerWall:${this.key}`, 1));
            this.meshes.push(addMesh(this.group, createAnnularBoxRangesGeometry(cityOuter - cityWallThickness, cityOuter, 125, 2, fullRing), materials.cityWall, `RingCityOuterWall:${this.key}`, 1));
        }

        return this.group;
    }

    dispose() {
        const geometries = new Set();
        const materials = new Set();
        this.group.traverse((object) => {
            if (object.geometry) geometries.add(object.geometry);
            const list = Array.isArray(object.material) ? object.material : (object.material ? [object.material] : []);
            for (const material of list) materials.add(material);
        });
        for (const geometry of geometries) geometry.dispose?.();
        for (const material of materials) material.dispose?.();
        if (this.group.parent) this.group.parent.remove(this.group);
        this.meshes.length = 0;
        this.materials = null;
    }
}
