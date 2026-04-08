// ============================================================
// Ring Ship Parking — static docked ships in the ring parking gap
// Placeholder box meshes for future interactive docking system.
// ============================================================
import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { isGateAngle, createSeededRandom } from './ringCityZoneGrid.js';

// Placeholder ship dimensions (length along radial axis, width tangential, height vertical)
export const SHIP_DIMS = {
    battleship: { length: 1040, width: 440, height: 180, color: 0x3a4a66 },
    cruiser:    { length: 720,  width: 300, height: 140, color: 0x4a5575 },
    destroyer:  { length: 480,  width: 200, height: 100, color: 0x556070 },
    frigate:    { length: 320,  width: 140, height: 80,  color: 0x606a7a }
};

// Weighted pool for random ship type selection
const SHIP_POOL = [
    ['battleship', 0.20],
    ['cruiser',    0.30],
    ['destroyer',  0.30],
    ['frigate',    0.20]
];

function pickWeighted(rand, pool) {
    let total = 0;
    for (const [, w] of pool) total += w;
    let pick = rand() * total;
    for (const [key, w] of pool) {
        pick -= w;
        if (pick <= 0) return key;
    }
    return pool[pool.length - 1][0];
}

export class RingShipParking {
    constructor(layout) {
        this.layout = layout;
        this.parkingBand = layout?.parking || null;
        this.parkingCenter = this.parkingBand
            ? (this.parkingBand.innerR + this.parkingBand.outerR) * 0.5
            : 0;
        this.slots = [];
        this.group = new THREE.Group();
        this.group.name = 'RingShipParking';
        this.group.userData.fgCategory = 'buildings';
    }

    generate({ seed = 1, numSlots = 48 } = {}) {
        if (!this.parkingBand) return;
        const rand = createSeededRandom(seed >>> 0 || 1);
        const arcPerSlot = (Math.PI * 2) / numSlots;

        for (let i = 0; i < numSlots; i++) {
            const angle = i * arcPerSlot;
            // Skip slots near gate angles — gates must remain clear for ships to pass through
            if (isGateAngle(angle)) continue;

            const shipType = pickWeighted(rand, SHIP_POOL);
            const slot = {
                slotIndex: i,
                shipType,
                angle,
                radius: this.parkingCenter,
                occupied: true,
                shipId: null,
                mesh: null
            };
            slot.mesh = this._buildDockedShipMesh(shipType, angle, this.parkingCenter);
            if (slot.mesh) this.group.add(slot.mesh);
            this.slots.push(slot);
        }
    }

    _buildDockedShipMesh(shipType, angle, radius) {
        const dims = SHIP_DIMS[shipType] || SHIP_DIMS.frigate;

        // Radial docking: ship's long axis aligned with the radial direction (nose points outward).
        // BoxGeometry default: X=width, Y=length, Z=height.
        const geo = new THREE.BoxGeometry(dims.width, dims.length, dims.height);
        const mat = new THREE.MeshStandardMaterial({
            color: dims.color,
            roughness: 0.7,
            metalness: 0.4,
            emissive: 0x0a0f1a,
            emissiveIntensity: 0.3
        });
        const mesh = new THREE.Mesh(geo, mat);

        // Position: place ship at (cos(angle)*R, sin(angle)*R, mid-height above ring floor)
        mesh.position.set(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
            dims.height * 0.5 + 20
        );
        // Orient: rotate so that Y-axis (length) points radially outward from ring center
        mesh.rotation.z = angle - Math.PI / 2;

        mesh.userData.fgCategory = 'buildings';
        mesh.userData.lodLevel = 'CORE'; // always visible when ring buildings are visible
        mesh.userData.isDockedShip = true;
        mesh.userData.shipType = shipType;

        mesh.castShadow = false;
        mesh.receiveShadow = false;

        return mesh;
    }

    dispose() {
        for (const slot of this.slots) {
            if (slot.mesh) {
                slot.mesh.geometry?.dispose();
                if (slot.mesh.material?.dispose) slot.mesh.material.dispose();
            }
        }
        this.slots.length = 0;
        if (this.group.parent) this.group.parent.remove(this.group);
    }
}
