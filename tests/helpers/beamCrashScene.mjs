import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { extractTrianglesFromObject3D, voxelizeTriangles } from '../../src/game/voxelBody3D.js';
import { buildBeamStructure } from '../../src/game/beamBody3D.js';
import { buildRamShipTriangles, CRASH_TARGET_SIZE } from '../../src/game/beamCrashScene3D.js';

export async function loadStationModel(name = 'earth-station.glb') {
  return loadGlbModel(new URL(`../../src/stations/${name}`, import.meta.url));
}

export async function loadGlbModel(url) {
  const buffer = await fs.readFile(url);
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
  const binStart = 20 + jsonLength + 8;
  // Physics needs the actual asset's geometry/transforms; skip browser image decoding.
  gltf.buffers[0].uri = `data:application/octet-stream;base64,${buffer.subarray(binStart).toString('base64')}`;
  delete gltf.images;
  delete gltf.textures;
  delete gltf.materials;
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const oldProgressEvent = globalThis.ProgressEvent;
  globalThis.ProgressEvent ??= class extends Event {
    constructor(type, data) { super(type); Object.assign(this, data); }
  };
  let model;
  try {
    model = (await new GLTFLoader().parseAsync(JSON.stringify(gltf), '')).scene;
  } finally {
    if (oldProgressEvent === undefined) delete globalThis.ProgressEvent;
    else globalThis.ProgressEvent = oldProgressEvent;
  }
  return model;
}

export async function loadStationTriangles() {
  const model = await loadStationModel();
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const scale = CRASH_TARGET_SIZE / Math.max(size.x, size.y, size.z);
  model.position.copy(center).multiplyScalar(-scale);
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);
  return extractTrianglesFromObject3D(model);
}

export function buildCrashStructures(stationTriangles, resolution = 44) {
  const cellSize = CRASH_TARGET_SIZE / resolution;
  const build = (triangles, cs) => buildBeamStructure(voxelizeTriangles(triangles.positions, triangles.colors,
    { cellSize: cs, shellLayers: 2, interiorMode: 'shell' }), { frameStride: 2, bulkheadEvery: 8 });
  return { cellSize, station: build(stationTriangles, cellSize), ship: build(buildRamShipTriangles(), cellSize * 0.9) };
}
