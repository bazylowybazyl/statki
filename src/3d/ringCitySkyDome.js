import * as THREE from 'three';
import { Core3D } from './core3d.js';

const SKY_VERTEX = `
varying vec3 vSkyDirection;

void main() {
  vSkyDirection = normalize(position);
  mat4 viewRotation = mat4(mat3(viewMatrix));
  vec4 clip = projectionMatrix * viewRotation * vec4(position, 1.0);
  gl_Position = clip.xyww;
}
`;

const SKY_FRAGMENT = `
precision highp float;
varying vec3 vSkyDirection;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float starLayer(vec3 direction, float scale, float threshold) {
  vec3 cellPoint = direction * scale;
  vec3 cell = floor(cellPoint);
  vec3 local = fract(cellPoint) - 0.5;
  float seed = hash31(cell);
  float radius = mix(0.038, 0.105, seed);
  float core = 1.0 - smoothstep(radius * 0.28, radius, length(local));
  return core * step(threshold, seed);
}

void main() {
  vec3 d = normalize(vSkyDirection);
  vec3 bandNormal = normalize(vec3(0.24, 0.91, -0.34));
  float latitude = abs(dot(d, bandNormal));
  float milkyBand = pow(max(0.0, 1.0 - latitude), 9.0);

  float filamentA = 0.5 + 0.5 * sin(dot(d, vec3(17.0, -29.0, 23.0)) + sin(dot(d, vec3(-41.0, 19.0, 31.0))) * 1.7);
  float filamentB = 0.5 + 0.5 * sin(dot(d, vec3(-53.0, 37.0, 11.0)) * 0.72 + filamentA * 3.1);
  float cloud = smoothstep(0.42, 0.88, filamentA * 0.58 + filamentB * 0.42);
  float nebula = milkyBand * (0.18 + cloud * 0.82);

  vec3 color = vec3(0.0015, 0.0032, 0.0085);
  color += vec3(0.018, 0.052, 0.10) * nebula;
  color += vec3(0.055, 0.018, 0.085) * nebula * smoothstep(0.54, 0.92, filamentB);

  float stars = starLayer(d, 96.0, 0.9925);
  float fineStars = starLayer(d.yzx + vec3(7.1, 3.7, 5.3), 205.0, 0.9965);
  float brightStars = starLayer(d.zxy + vec3(1.9, 8.2, 4.4), 48.0, 0.9978);
  color += vec3(0.56, 0.72, 1.0) * stars * 0.88;
  color += vec3(0.82, 0.90, 1.0) * fineStars * 0.52;
  color += vec3(1.0, 0.78, 0.58) * brightStars * 1.45;

  gl_FragColor = vec4(color, 1.0);
}
`;

export class RingCitySkyDome {
  constructor() {
    this.mesh = null;
    this.hiddenBackgrounds = [];
    this.hiddenBackgroundVisibility = [];
  }

  ensure() {
    if (this.mesh || !Core3D.isInitialized || !Core3D.scene) return this.mesh;
    const geometry = new THREE.SphereGeometry(1, 48, 32);
    const material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'RingCityFlightSkyDome';
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = -10000;
    mesh.userData.ringCityFlightSkyDome = true;
    Core3D.scene.add(mesh);
    Core3D.enableBackground3D(mesh);
    this.mesh = mesh;
    return mesh;
  }

  activate() {
    const mesh = this.ensure();
    if (!mesh || mesh.visible) return false;
    this.hiddenBackgrounds.length = 0;
    this.hiddenBackgroundVisibility.length = 0;
    const backgroundMask = 1 << 1;
    for (const child of Core3D.scene.children) {
      if (child === mesh || (child.layers.mask & backgroundMask) === 0) continue;
      this.hiddenBackgrounds.push(child);
      this.hiddenBackgroundVisibility.push(child.visible);
      child.visible = false;
    }
    mesh.visible = true;
    return true;
  }

  deactivate() {
    if (this.mesh) this.mesh.visible = false;
    for (let i = 0; i < this.hiddenBackgrounds.length; i++) {
      const object = this.hiddenBackgrounds[i];
      if (object) object.visible = this.hiddenBackgroundVisibility[i];
    }
    this.hiddenBackgrounds.length = 0;
    this.hiddenBackgroundVisibility.length = 0;
  }

  dispose() {
    this.deactivate();
    if (!this.mesh) return;
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry?.dispose?.();
    this.mesh.material?.dispose?.();
    this.mesh = null;
  }
}
