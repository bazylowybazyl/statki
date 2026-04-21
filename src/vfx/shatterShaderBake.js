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
