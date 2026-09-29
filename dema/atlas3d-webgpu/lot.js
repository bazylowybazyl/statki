// ============================================================
// Lot i kamery dema 3D.
// LOT: płaszczyzna gry (kurs = obrót wokół Z) jak w grze + opcjonalny ruch w pionie;
// liczby z SHIP_FLIGHT_SPECS.atlas (maxSpeed, accel, decel, strafe, reverse, turnRate,
// turnAccel). Przechył przy skręcie tylko wizualny (gra nie ma przechyłu).
// KAMERY: 'gra' (z góry, północ w górę — jak kamera gry), 'taktyczna' (3/4, pochylenie),
// 'poscig' (za rufą), 'orbita' (swobodna wokół statku), 'kinowa' (samoczynny przelot).
// ============================================================
import * as THREE from 'three/webgpu';
import { SHIP_FLIGHT_SPECS } from '../../src/data/shipFlightSpecs.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, t, s) => (v < t ? Math.min(t, v + s) : Math.max(t, v - s));

export class Flight {
  constructor() {
    const s = SHIP_FLIGHT_SPECS.atlas;
    this.spec = { ...s, lift: s.strafeAccel, maxLift: 160 };
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;      // rad, 0 = +X
    this.yawVel = 0;       // rad/s
    this.bank = 0;         // rad (wizualny)
    this.speedMul = 1;     // „szybki lot” (test)
    this.throttle = 0;     // 0..1.6 (struga)
  }

  get forward() { return new THREE.Vector3(Math.cos(this.heading), Math.sin(this.heading), 0); }

  /**
   * input: { thrust (−1..1), turn (−1..1; + = w lewo), strafe (−1..1; + = w lewo), lift (−1..1), boost }
   */
  step(dt, input) {
    const s = this.spec;
    const k = this.speedMul;
    // Obrót: prędkość kątowa goni zadaną z przyspieszeniem kątowym.
    const wantYaw = clamp(input.turn || 0, -1, 1) * s.turnRate * DEG * Math.sqrt(k);
    this.yawVel = approach(this.yawVel, wantYaw, s.turnAccel * DEG * Math.sqrt(k) * dt);
    this.heading += this.yawVel * dt;
    // Ruch w układzie statku (przód, lewo, góra).
    const c = Math.cos(this.heading); const sn = Math.sin(this.heading);
    let vf = this.vel.x * c + this.vel.y * sn;
    let vl = -this.vel.x * sn + this.vel.y * c;
    let vz = this.vel.z;
    const boost = input.boost ? 1.6 : 1;
    const maxF = s.maxSpeed * k * boost;
    const th = clamp(input.thrust || 0, -1, 1);
    if (th > 0) vf = Math.min(maxF, vf + s.accel * k * boost * th * dt);
    else if (th < 0) vf = Math.max(-maxF * 0.35, vf + s.reverseAccel * k * th * dt);
    else vf = approach(vf, 0, s.decel * k * 0.25 * dt);
    if (vf > maxF) vf = approach(vf, maxF, s.decel * k * dt);
    const st = clamp(input.strafe || 0, -1, 1);
    vl = st ? clamp(vl + s.strafeAccel * k * st * dt, -maxF * 0.3, maxF * 0.3) : approach(vl, 0, s.strafeAccel * k * dt);
    const lf = clamp(input.lift || 0, -1, 1);
    vz = lf ? clamp(vz + s.lift * k * lf * dt, -s.maxLift * k, s.maxLift * k) : approach(vz, 0, s.lift * k * dt);
    this.vel.set(vf * c - vl * sn, vf * sn + vl * c, vz);
    this.pos.addScaledVector(this.vel, dt);
    this.throttle = approach(this.throttle, th > 0 ? th * boost : Math.min(0.25, Math.abs(vf) / maxF), dt * 1.5);
    // Przechył: w stronę skrętu, proporcjonalnie do prędkości kątowej i prędkości.
    const wantBank = -(this.yawVel / (s.turnRate * DEG)) * 7 * DEG * clamp(Math.abs(vf) / 200, 0.3, 1);
    this.bank += (wantBank - this.bank) * Math.min(1, dt * 1.6);
  }

  /** Poza na obiekt (Object3D): pozycja, kurs, przechył (opcja). */
  apply(obj, banking = true) {
    obj.position.copy(this.pos);
    obj.rotation.set(banking ? this.bank : 0, 0, this.heading, 'ZYX');
  }
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'taktyczna';
    this.dist = 3200;       // odległość (zoom)
    this.tilt = 52;         // ° pochylenia kamery taktycznej
    this.az = 0;            // ° azymut (orbita / taktyczna)
    this.el = 28;           // ° wzniesienie orbity
    this.followHeading = false;
    this.target = new THREE.Vector3();
    this.pan = new THREE.Vector3();
    this.pos = new THREE.Vector3(0, -3000, 2400);
    this.look = new THREE.Vector3();
    this.cine = 0;
    this._first = true;
  }

  zoom(f) { this.dist = clamp(this.dist * f, 220, 30000); }

  update(dt, flight) {
    const cam = this.camera;
    const tgt = this.target.copy(flight.pos).add(this.pan);
    const wantPos = new THREE.Vector3();
    const wantLook = tgt.clone();
    const up = new THREE.Vector3(0, 0, 1);
    let snap = false;
    switch (this.mode) {
      case 'gra': {
        // Z góry, północ w górę: prawie prostopadle (0,5° odchyłki — stabilny lookAt).
        wantPos.set(tgt.x, tgt.y - this.dist * 0.008, tgt.z + this.dist);
        up.set(0, 1, 0);
        snap = true;
        break;
      }
      case 'taktyczna': {
        const az = (this.followHeading ? flight.heading / DEG - 90 : 0) + this.az;
        const t = this.tilt * DEG; const a = az * DEG;
        wantPos.set(tgt.x + Math.sin(a) * Math.sin(t) * this.dist, tgt.y - Math.cos(a) * Math.sin(t) * this.dist, tgt.z + Math.cos(t) * this.dist);
        break;
      }
      case 'poscig': {
        const f = flight.forward;
        const d = this.dist * 0.55;
        const el = 16 * DEG;
        wantPos.copy(tgt).addScaledVector(f, -d * Math.cos(el)).add(new THREE.Vector3(0, 0, d * Math.sin(el) + 120));
        wantLook.copy(tgt).addScaledVector(f, d * 0.35).add(new THREE.Vector3(0, 0, 60));
        break;
      }
      case 'kinowa': {
        this.cine += dt;
        const a = this.cine * 0.07 + 0.6;
        const e = (18 + Math.sin(this.cine * 0.13) * 12) * DEG;
        const d = this.dist * (0.8 + 0.15 * Math.sin(this.cine * 0.05));
        wantPos.set(tgt.x + Math.cos(a) * Math.cos(e) * d, tgt.y + Math.sin(a) * Math.cos(e) * d, tgt.z + Math.sin(e) * d);
        break;
      }
      default: { // orbita
        const a = this.az * DEG; const e = this.el * DEG;
        wantPos.set(tgt.x + Math.cos(a) * Math.cos(e) * this.dist, tgt.y + Math.sin(a) * Math.cos(e) * this.dist, tgt.z + Math.sin(e) * this.dist);
        snap = true;
      }
    }
    // Sprężyna kamery (pościg i przejścia); z góry i orbita — sztywno.
    const k = snap || this._first ? 1 : 1 - Math.exp(-dt * (this.mode === 'poscig' ? 3.2 : 5));
    this.pos.lerp(wantPos, k);
    this.look.lerp(wantLook, snap || this._first ? 1 : 1 - Math.exp(-dt * 8));
    this._first = false;
    cam.position.copy(this.pos);
    cam.up.copy(up);
    cam.lookAt(this.look);
    const d = cam.position.distanceTo(this.look);
    cam.near = Math.max(2, d * 0.02);
    cam.far = d * 8 + 60000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  setMode(m) {
    if (this.mode === m) return;
    this.mode = m;
    if (m === 'gra' || m === 'orbita') this._first = true;
  }
}
