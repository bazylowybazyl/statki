// src/game/rockets/rocketMath.js — matematyka lotu rakiet bez three (RW-23, docs/PLAN-render-worker.md § 4).
//
// Symulacja rakiet żyje po stronie gry (src/game/rockets/rocketSim.js), a w trybie worker wątek gry nie ładuje
// renderu. Tu tylko to, czego lot używał z three r183 (Vector3: set / copy / length / normalize / multiplyScalar /
// addScaledVector / dot, Quaternion.setFromUnitVectors, MathUtils.clamp / lerp / degToRad) — TE SAME WZORY
// i kolejność działań co w node_modules/three/src/math (wynik bit w bit; pilnuje tests/rocketMath.test.mjs).
// Pola publiczne x, y, z (, w) — reżyser efektów i testy czytają je jak dawniej z obiektów three.

const DEG2RAD = Math.PI / 180;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(x, y, t) {
  return (1 - t) * x + t * y;
}

export function degToRad(degrees) {
  return degrees * DEG2RAD;
}

export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    if (z === undefined) z = this.z;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  multiplyScalar(scalar) {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    return this;
  }

  divideScalar(scalar) {
    return this.multiplyScalar(1 / scalar);
  }

  addScaledVector(v, s) {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  normalize() {
    return this.divideScalar(this.length() || 1);
  }
}

export class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
  }

  normalize() {
    let l = this.length();
    if (l === 0) {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      this.w = 1;
    } else {
      l = 1 / l;
      this.x = this.x * l;
      this.y = this.y * l;
      this.z = this.z * l;
      this.w = this.w * l;
    }
    return this;
  }

  /** Obrót z kierunku vFrom do vTo (oba jednostkowe) — jak THREE.Quaternion.setFromUnitVectors (r183). */
  setFromUnitVectors(vFrom, vTo) {
    let r = vFrom.dot(vTo) + 1;
    if (r < 1e-8) {
      r = 0;
      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
        this.x = -vFrom.y;
        this.y = vFrom.x;
        this.z = 0;
        this.w = r;
      } else {
        this.x = 0;
        this.y = -vFrom.z;
        this.z = vFrom.y;
        this.w = r;
      }
    } else {
      this.x = vFrom.y * vTo.z - vFrom.z * vTo.y;
      this.y = vFrom.z * vTo.x - vFrom.x * vTo.z;
      this.z = vFrom.x * vTo.y - vFrom.y * vTo.x;
      this.w = r;
    }
    return this.normalize();
  }
}
