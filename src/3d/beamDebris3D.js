import * as THREE from 'three';

export const METAL_DEBRIS_CAPACITY = 6144;
export const METAL_DEBRIS_LIFE = 8;

// Built once. Closed meshes have a painted face, a darker back and exposed
// metal on the fracture; flat normals retain the folds even at close range.
export function createMetalDebrisGeometry(kind) {
  const positions = [], faces = [];
  const triangle = (a, b, c, face) => { positions.push(...a, ...b, ...c); faces.push(face, face, face); };
  const quad = (a, b, c, d, face) => { triangle(a, b, c, face); triangle(a, c, d, face); };
  if (kind === 'plate') {
    // Uneven boundary and an offset crease: no rectangular silhouette.
    const grid = [
      [-0.49, -0.08, -0.37], [-0.06, 0.14, -0.51], [0.42, -0.04, -0.32],
      [-0.62, -0.06, 0.02], [-0.04, 0.19, 0.02], [0.58, -0.12, -0.03],
      [-0.35, -0.03, 0.44], [0.08, 0.13, 0.35], [0.39, -0.19, 0.46]
    ];
    const back = grid.map(p => [p[0], p[1] - 0.032, p[2]]);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
      const a = row * 3 + col, b = a + 1, c = a + 4, d = a + 3;
      quad(grid[a], grid[d], grid[c], grid[b], 0);
      quad(back[a], back[b], back[c], back[d], 0.55);
    }
    const rim = [0, 1, 2, 5, 8, 7, 6, 3];
    for (let i = 0; i < rim.length; i++) {
      const a = rim[i], b = rim[(i + 1) % rim.length];
      quad(grid[a], grid[b], back[b], back[a], 1);
    }
  } else if (kind === 'strut') {
    // Open C cross-section, not a solid stick; both torn ends are capped.
    const profile = [[-0.13, -0.13], [0.13, -0.13], [0.13, 0.13],
      [0.075, 0.13], [0.075, -0.07], [-0.075, -0.07], [-0.075, 0.13], [-0.13, 0.13]];
    const rings = [-0.78, 0, 0.71].map((x, ring) => profile.map(([y, z], i) =>
      [x + (ring === 1 ? 0 : Math.sin(i * 7.1) * 0.07), y + (ring === 1 ? 0.1 : 0), z]));
    for (let r = 0; r < 2; r++) for (let i = 0; i < profile.length; i++) {
      const j = (i + 1) % profile.length;
      quad(rings[r][i], rings[r][j], rings[r + 1][j], rings[r + 1][i], i >= 3 && i <= 5 ? 0.55 : 0);
    }
    const caps = THREE.ShapeUtils.triangulateShape(profile.map(p => new THREE.Vector2(...p)), []);
    for (const [a, b, c] of caps) {
      triangle(rings[0][c], rings[0][b], rings[0][a], 1);
      triangle(rings[2][a], rings[2][b], rings[2][c], 1);
    }
  } else throw new Error(`Unknown metal debris kind: ${kind}`);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFace', new THREE.Float32BufferAttribute(faces, 1));
  geometry.computeVertexNormals();
  geometry.instanceCount = 0;
  return geometry;
}

const VERTEX = `
attribute float aFace;
attribute vec3 aStart;
attribute vec3 aVel;
attribute vec4 aRot;
attribute vec3 aInfo;
attribute vec3 aColor;
attribute vec4 aShape;
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec3 vLocal;
varying float vFace;
void main() {
  float age = uTime - aInfo.x;
  float life = aInfo.z;
  vColor = aColor; vFace = aFace; vLocal = position;
  vNormal = vec3(0.0, 0.0, 1.0); vViewPosition = vec3(0.0, 0.0, -1.0);
  vAlpha = 0.0;
  if (age < 0.0 || age >= life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 center = aStart + aVel * ((1.0 - exp(-0.6 * age)) / 0.6);
  float angle = aShape.w + aRot.w * age;
  vec3 axis = normalize(aRot.xyz + vec3(1e-6, 0.0, 0.0));
  float c = cos(angle), s = sin(angle);
  vec3 p = position * aShape.xyz * aInfo.y;
  vec3 n = normalize(normal / aShape.xyz);
  vec3 rotated = p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
  vec3 rn = n * c + cross(axis, n) * s + axis * dot(axis, n) * (1.0 - c);
  vec4 view = modelViewMatrix * vec4(center + rotated, 1.0);
  vViewPosition = view.xyz;
  vNormal = normalize(normalMatrix * rn);
  vAlpha = 1.0 - smoothstep(life * 0.8, life, age);
  gl_Position = projectionMatrix * view;
}
`;

const FRAGMENT = `
uniform vec3 uLightDirView;
uniform float uAmbient;
uniform float uDiffuse;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec3 vLocal;
varying float vFace;
void main() {
  // Opaque depth-tested fragments, with a short dithered fade at end of life.
  // Transparent instanced debris cannot be sorted per fragment.
  float noise = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  if (vAlpha <= 0.0 || noise > vAlpha) discard;
  vec3 n = normalize(vNormal);
  vec3 view = normalize(-vViewPosition);
  float bare = smoothstep(0.7, 0.95, vFace);
  vec3 paint = vColor * mix(1.0, 0.62, min(1.0, vFace * 1.8));
  vec3 color = mix(paint, vec3(0.43, 0.47, 0.50), bare);
  float scratch = pow(0.5 + 0.5 * sin(vLocal.x * 119.0 + vLocal.z * 19.0), 12.0);
  color *= 1.0 - scratch * 0.12;
  float diffuse = max(0.0, dot(n, uLightDirView));
  float specular = pow(max(0.0, dot(n, normalize(uLightDirView + view))), 28.0);
  gl_FragColor = vec4(color * (uAmbient + diffuse * uDiffuse) + specular * mix(0.12, 0.45, bare), 1.0);
}
`;

const ATTRIBUTES = { aStart: 3, aVel: 3, aRot: 4, aInfo: 3, aColor: 3, aShape: 4 };

function createBatch(scene, kind, capacity, material) {
  const geometry = createMetalDebrisGeometry(kind);
  const arrays = {};
  for (const [name, width] of Object.entries(ATTRIBUTES)) {
    arrays[name] = new Float32Array(capacity * width);
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(arrays[name], width).setUsage(THREE.DynamicDrawUsage));
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `Metal debris: ${kind}`;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return { kind, capacity, geometry, mesh, arrays, cursor: 0, first: 0, alive: 0, dirtyMin: capacity, dirtyMax: -1 };
}

export class MetalDebrisPool {
  constructor(scene, capacity = METAL_DEBRIS_CAPACITY) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLightDirView: { value: new THREE.Vector3(0, 0, 1) },
        uAmbient: { value: 0.35 }, uDiffuse: { value: 0.9 } },
      vertexShader: VERTEX, fragmentShader: FRAGMENT
    });
    const plates = Math.max(1, Math.floor(capacity * 2 / 3));
    this.batches = [createBatch(scene, 'plate', plates, this.material),
      createBatch(scene, 'strut', Math.max(1, capacity - plates), this.material)];
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, scale, nowSec, structural = false) {
    const batch = this.batches[structural ? 1 : 0];
    const i = batch.cursor, i3 = i * 3, i4 = i * 4;
    const a = batch.arrays;
    a.aStart[i3] = x; a.aStart[i3 + 1] = y; a.aStart[i3 + 2] = z;
    a.aVel[i3] = vx; a.aVel[i3 + 1] = vy; a.aVel[i3 + 2] = vz;
    a.aRot[i4] = Math.random() * 2 - 1; a.aRot[i4 + 1] = Math.random() * 2 - 1; a.aRot[i4 + 2] = Math.random() * 2 - 1;
    a.aRot[i4 + 3] = (Math.random() - 0.5) * 7;
    a.aInfo[i3] = nowSec; a.aInfo[i3 + 1] = scale; a.aInfo[i3 + 2] = METAL_DEBRIS_LIFE;
    a.aColor[i3] = r; a.aColor[i3 + 1] = g; a.aColor[i3 + 2] = b;
    a.aShape[i4] = 0.65 + Math.random() * 0.8;
    a.aShape[i4 + 1] = 0.5 + Math.random() * 0.9;
    a.aShape[i4 + 2] = 0.55 + Math.random() * 0.8;
    a.aShape[i4 + 3] = Math.random() * Math.PI * 2;
    if (!batch.alive) batch.first = i;
    if (batch.alive === batch.capacity) batch.first = (batch.first + 1) % batch.capacity;
    else batch.alive++;
    batch.cursor = (i + 1) % batch.capacity;
    batch.geometry.instanceCount = Math.max(batch.geometry.instanceCount, i + 1);
    batch.dirtyMin = Math.min(batch.dirtyMin, i);
    batch.dirtyMax = Math.max(batch.dirtyMax, i);
  }

  commit(nowSec) {
    this.material.uniforms.uTime.value = nowSec;
    for (const batch of this.batches) {
      // Births are ordered and all lifetimes equal: only visit expired slots.
      while (batch.alive && nowSec >= batch.arrays.aInfo[batch.first * 3] + METAL_DEBRIS_LIFE) {
        batch.first = (batch.first + 1) % batch.capacity;
        batch.alive--;
      }
      batch.mesh.visible = batch.alive > 0;
      if (!batch.alive) { batch.geometry.instanceCount = 0; batch.cursor = 0; }
      if (batch.dirtyMax < batch.dirtyMin) continue;
      for (const name in ATTRIBUTES) {
        const attr = batch.geometry.getAttribute(name), width = ATTRIBUTES[name];
        attr.clearUpdateRanges();
        attr.addUpdateRange(batch.dirtyMin * width, (batch.dirtyMax - batch.dirtyMin + 1) * width);
        attr.needsUpdate = true;
      }
      batch.dirtyMin = batch.capacity; batch.dirtyMax = -1;
    }
  }

  reset() {
    for (const batch of this.batches) {
      batch.cursor = batch.first = batch.alive = batch.geometry.instanceCount = 0;
      batch.dirtyMin = batch.capacity; batch.dirtyMax = -1;
      batch.mesh.visible = false;
    }
  }

  dispose(scene) {
    for (const batch of this.batches) { scene?.remove(batch.mesh); batch.geometry.dispose(); }
    this.material.dispose();
  }
}
