import { Quaternion, Vector3 } from 'three';

// Kamera nie zależy od prędkości ani aktualnego promienia wraku.
export class BeamFlightCamera3D {
  constructor(camera) {
    this.camera = camera;
    this.rotation = new Quaternion();
    this.bodyRotation = new Quaternion();
    this.offset = new Vector3();
    this.target = new Vector3();
    this.zoom = 1;
    this.aimDistance = 0;
    this.needsSnap = true;
  }

  reset() { this.needsSnap = true; }

  dolly(delta) { this.zoom = Math.max(0.55, Math.min(3, this.zoom * Math.exp(delta * 0.001))); }

  update(body, radius, dt) {
    if (!body || body.dead) return;
    this.bodyRotation.copy(body.quat);
    if (this.needsSnap) this.rotation.copy(this.bodyRotation);
    else this.rotation.slerp(this.bodyRotation, 1 - Math.exp(-7 * dt));
    this.needsSnap = false;
    const size = Math.max(10, radius);
    this.offset.set(-size * 3.8 * this.zoom, size * (this.aimDistance ? 0.75 : 1.25) * this.zoom, 0).applyQuaternion(this.rotation);
    this.camera.position.copy(body.pos).add(this.offset);
    this.camera.up.set(0, 1, 0).applyQuaternion(this.rotation);
    this.target.set(this.aimDistance || size * 1.5, 0, 0).applyQuaternion(this.rotation).add(body.pos);
    this.camera.lookAt(this.target);
  }
}
