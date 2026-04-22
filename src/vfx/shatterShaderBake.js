/**
 * shatterShaderBake.js
 *
 * Converts a THREE.BufferGeometry into a non-indexed geometry with
 * per-triangle vertex attributes needed by the shatter shader:
 *
 *   aCentroid (vec3) — centroid of each triangle in model space
 *   aRandom3  (vec3) — normalised random drift/spin direction per triangle
 *
 * Result is cached on the source geometry as .__shatterBaked so the
 * (moderately expensive) bake step is done at most once per geometry.
 *
 * Usage:
 *   import { bakeShatterGeometry, bakeShatterMesh } from './shatterShaderBake.js';
 *
 *   // single geometry
 *   const bakedGeo = bakeShatterGeometry(mesh.geometry);
 *
 *   // whole hierarchy (GLB scene group)
 *   bakeShatterMesh(rootObject3D);  // caches on every child geometry
 */

import * as THREE from 'three';

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _centroid = new THREE.Vector3();
const _rand = new THREE.Vector3();
const _edge1 = new THREE.Vector3();
const _edge2 = new THREE.Vector3();
const _normal = new THREE.Vector3();

function clampInt(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function buildShardSpawnData(nonIndexed, triCount) {
    if (triCount <= 0) {
        return {
            count: 0,
            panelCount: 0,
            blockCount: 0,
            centroids: new Float32Array(0),
            normals: new Float32Array(0),
            seeds: new Float32Array(0),
            areaWeights: new Float32Array(0),
            kind: new Uint8Array(0),
        };
    }

    const pos = nonIndexed.attributes.position;
    const triCentroids = new Float32Array(triCount * 3);
    const triNormals = new Float32Array(triCount * 3);
    const triAreas = new Float32Array(triCount);
    const cdf = new Float32Array(triCount);
    let totalArea = 0;

    for (let i = 0; i < triCount; i++) {
        const base = i * 3;

        _v0.fromBufferAttribute(pos, base);
        _v1.fromBufferAttribute(pos, base + 1);
        _v2.fromBufferAttribute(pos, base + 2);

        _centroid.copy(_v0).add(_v1).add(_v2).divideScalar(3);
        _edge1.subVectors(_v1, _v0);
        _edge2.subVectors(_v2, _v0);
        _normal.crossVectors(_edge1, _edge2);
        const area = Math.max(0.0001, _normal.length() * 0.5);
        _normal.normalize();

        const out = i * 3;
        triCentroids[out] = _centroid.x;
        triCentroids[out + 1] = _centroid.y;
        triCentroids[out + 2] = _centroid.z;
        triNormals[out] = _normal.x;
        triNormals[out + 1] = _normal.y;
        triNormals[out + 2] = _normal.z;
        triAreas[i] = area;
        totalArea += area;
        cdf[i] = totalArea;
    }

    const avgArea = totalArea / Math.max(1, triCount);
    const panelCount = clampInt(Math.round(Math.sqrt(triCount) * 2.35), 18, 104);
    const blockCount = clampInt(Math.round(panelCount * 0.12), 1, 8);
    const count = panelCount + blockCount;
    const centroids = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    const areaWeights = new Float32Array(count);
    const kind = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
        const pick = Math.random() * totalArea;
        let triIndex = 0;
        while (triIndex < triCount - 1 && cdf[triIndex] < pick) triIndex++;

        const triBase = triIndex * 3;
        const out = i * 3;
        centroids[out] = triCentroids[triBase];
        centroids[out + 1] = triCentroids[triBase + 1];
        centroids[out + 2] = triCentroids[triBase + 2];
        normals[out] = triNormals[triBase];
        normals[out + 1] = triNormals[triBase + 1];
        normals[out + 2] = triNormals[triBase + 2];
        seeds[out] = Math.random();
        seeds[out + 1] = Math.random();
        seeds[out + 2] = Math.random();
        areaWeights[i] = clampInt(Math.round(Math.sqrt(triAreas[triIndex] / Math.max(0.0001, avgArea)) * 100), 55, 165) / 100;
        kind[i] = (i < panelCount) ? 0 : 1;
    }

    return { count, panelCount, blockCount, centroids, normals, seeds, areaWeights, kind };
}

/**
 * Bake a single geometry.  Returns the non-indexed baked geometry (cached).
 * @param {THREE.BufferGeometry} geo
 * @returns {THREE.BufferGeometry}
 */
export function bakeShatterGeometry(geo) {
    if (geo.__shatterBaked) return geo.__shatterBaked;

    // Three.js toNonIndexed() handles indexed geometries cleanly.
    const nonIndexed = geo.index ? geo.toNonIndexed() : geo.clone();

    const pos = nonIndexed.attributes.position;
    const vertexCount = pos.count;
    const triCount = Math.floor(vertexCount / 3);

    const centroids = new Float32Array(vertexCount * 3);
    const randoms   = new Float32Array(vertexCount * 3);

    for (let i = 0; i < triCount; i++) {
        const base = i * 3;

        _v0.fromBufferAttribute(pos, base);
        _v1.fromBufferAttribute(pos, base + 1);
        _v2.fromBufferAttribute(pos, base + 2);

        _centroid.copy(_v0).add(_v1).add(_v2).divideScalar(3);

        // Per-triangle random direction (drift + spin axis seed)
        _rand.set(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        );
        if (_rand.lengthSq() < 1e-6) _rand.set(1, 0, 0);
        _rand.normalize();

        for (let j = 0; j < 3; j++) {
            const vi = (base + j) * 3;
            centroids[vi]     = _centroid.x;
            centroids[vi + 1] = _centroid.y;
            centroids[vi + 2] = _centroid.z;
            randoms[vi]     = _rand.x;
            randoms[vi + 1] = _rand.y;
            randoms[vi + 2] = _rand.z;
        }
    }

    nonIndexed.setAttribute('aCentroid', new THREE.BufferAttribute(centroids, 3));
    nonIndexed.setAttribute('aRandom3',  new THREE.BufferAttribute(randoms,   3));

    const shardSpawnData = buildShardSpawnData(nonIndexed, triCount);
    nonIndexed.__shardSpawnData = shardSpawnData;
    geo.__shardSpawnData = shardSpawnData;

    geo.__shatterBaked = nonIndexed;
    return nonIndexed;
}

/**
 * Bake all Mesh descendants of rootObject3D (in-place cache on each geometry).
 * Call this when loading a GLB model to amortise bake cost.
 * @param {THREE.Object3D} rootObject3D
 */
export function bakeShatterMesh(rootObject3D) {
    rootObject3D.traverse(child => {
        if (child.isMesh && child.geometry) {
            bakeShatterGeometry(child.geometry);
        }
    });
}
