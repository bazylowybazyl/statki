import * as THREE from 'three';
import { LASER } from '../game/beamWeapons3D.js';

// Reuses the demo scene/renderer. All projectiles and explosions are instanced.
export class BeamWeaponsVisual3D {
  constructor(scene, weapons) {
    this.weapons = weapons;
    this.transform = new THREE.Object3D(); this.direction = new THREE.Vector3();
    this.axis = new THREE.Vector3(0, 1, 0); this.color = new THREE.Color();
    const make = (geo, color, count, additive = false) => {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: additive, opacity: additive ? 0.75 : 1,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !additive, toneMapped: false });
      if (additive) mat.color.multiplyScalar(2);
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0;
      scene.add(mesh); return mesh;
    };
    this.lasers = make(new THREE.CylinderGeometry(0.10, 0.10, 1, 5), 0x62efff, weapons.projectiles.length, true);
    this.rockets = make(new THREE.ConeGeometry(0.23, 1.8, 6), 0xd7e2ee, weapons.projectiles.length);
    this.trails = make(new THREE.CylinderGeometry(0.12, 0.03, 1, 5), 0xff8d36, weapons.projectiles.length, true);
    this.flashes = make(new THREE.IcosahedronGeometry(1, 1), 0xffffff, weapons.effects.length, true);
    this.flashes.setColorAt(0, this.color.set(0xffffff));
    this.meshes = [this.lasers, this.rockets, this.trails, this.flashes];
  }
  sync() {
    for (const mesh of this.meshes) mesh.count = 0;
    const o = this.transform, d = this.direction;
    for (const p of this.weapons.projectiles) {
      if (!p.active) continue;
      d.set(p.vx, p.vy, p.vz).normalize(); o.quaternion.setFromUnitVectors(this.axis, d);
      if (p.kind === LASER) {
        const length = Math.min(5, Math.max(0.5, p.age * 620));
        o.position.set(p.x, p.y, p.z).addScaledVector(d, -length / 2); o.scale.set(1, length, 1); o.updateMatrix();
        this.lasers.setMatrixAt(this.lasers.count++, o.matrix);
      } else {
        o.position.set(p.x, p.y, p.z); o.scale.setScalar(1); o.updateMatrix();
        this.rockets.setMatrixAt(this.rockets.count++, o.matrix);
        o.position.addScaledVector(d, -2.6); o.scale.set(1, 4, 1); o.updateMatrix();
        this.trails.setMatrixAt(this.trails.count++, o.matrix);
      }
    }
    o.quaternion.identity();
    for (const e of this.weapons.effects) {
      if (!e.active) continue;
      const t = e.age / e.life;
      o.position.set(e.x, e.y, e.z); o.scale.setScalar(e.radius * (0.2 + 0.8 * t)); o.updateMatrix();
      const i = this.flashes.count++;
      this.flashes.setMatrixAt(i, o.matrix);
      this.color.setRGB(1, e.kind === LASER ? 0.8 : 0.45, e.kind === LASER ? 1 : 0.08).multiplyScalar((1 - t) * 1.8);
      this.flashes.setColorAt(i, this.color);
    }
    for (const mesh of this.meshes) {
      mesh.visible = mesh.count > 0;
      if (mesh.count) mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.flashes.count) this.flashes.instanceColor.needsUpdate = true;
  }
  dispose(scene) { for (const m of this.meshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); m.dispose(); } }
}
