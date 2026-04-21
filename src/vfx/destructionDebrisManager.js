/**
 * destructionDebrisManager.js
 *
 * Tracks all active debris meshes spawned by destruction3D.js and disposes
 * them after their debrisLifetime expires — preventing memory leaks when
 * many explosions occur over a long play session.
 *
 * Usage (managed internally by destruction3D.js — no need to call directly):
 *
 *   const dm = new DebrisManager();
 *   dm.register(mesh, scene, expiryWorldTime);
 *   dm.update(worldTime);    // call once per frame
 *   dm.dispose();            // call on game shutdown
 */

export class DebrisManager {
    constructor() {
        /** @type {Array<{mesh: THREE.Mesh, scene: THREE.Scene, expiry: number}>} */
        this._entries = [];
    }

    /**
     * Register a mesh for automatic cleanup.
     * @param {THREE.Object3D} mesh      The object to track (may be Group or Mesh)
     * @param {THREE.Scene}    scene     Scene it belongs to
     * @param {number}         expiry    World time (seconds) when it should be removed
     */
    register(mesh, scene, expiry) {
        this._entries.push({ mesh, scene, expiry });
    }

    /**
     * Call once per render frame.  Removes + disposes entries past their expiry.
     * @param {number} worldTime  Current game world time in seconds
     */
    update(worldTime) {
        const surviving = [];
        for (const entry of this._entries) {
            if (worldTime >= entry.expiry) {
                this._remove(entry);
            } else {
                surviving.push(entry);
            }
        }
        this._entries = surviving;
    }

    /** Number of tracked debris objects. */
    get count() { return this._entries.length; }

    /** Hard-remove all tracked objects immediately (e.g. on scene change). */
    disposeAll() {
        for (const entry of this._entries) this._remove(entry);
        this._entries = [];
    }

    // -----------------------------------------------------------------------
    _remove({ mesh, scene }) {
        scene.remove(mesh);
        mesh.traverse(child => {
            if (child.geometry)  child.geometry.dispose();
            if (child.material) {
                const mats = Array.isArray(child.material)
                    ? child.material
                    : [child.material];
                for (const m of mats) m.dispose();
            }
        });
    }
}
