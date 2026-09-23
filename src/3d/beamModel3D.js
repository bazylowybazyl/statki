import * as THREE from 'three';
import { voxelizeTriangles, extractTrianglesFromObject3D, extractSkinParts } from '../game/voxelBody3D.js';
import { buildBeamStructure } from '../game/beamBody3D.js';

// Ten sam importer dla obu ról. Kopia hierarchii zachowuje transformacje GLB;
// obrót, centrowanie i skala nie modyfikują źródła przy kolejnej przebudowie.
export function buildModelBeamStructure(root, options) {
  const { targetSize, cellSize, shellLayers = 2, frameStride = 2, bulkheadEvery = 8, forwardAxis = null } = options;
  const model = new THREE.Group();
  model.add(root.clone(true));
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  if (box.isEmpty() || !Number.isFinite(span) || span <= 1e-9) throw new Error('Model nie zawiera poprawnej geometrii');
  if (forwardAxis) {
    const axis = forwardAxis === 'auto' ? (size.x >= size.y && size.x >= size.z ? '+x' : size.y >= size.z ? '+y' : '+z') : forwardAxis;
    const directions = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
    if (!directions[axis]) throw new Error('Nieznany kierunek dziobu');
    model.quaternion.setFromUnitVectors(new THREE.Vector3(...directions[axis]), new THREE.Vector3(1, 0, 0));
  }
  model.scale.setScalar(targetSize / span);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  model.position.copy(box.getCenter(new THREE.Vector3())).negate();
  model.updateMatrixWorld(true);
  const triangles = extractTrianglesFromObject3D(model);
  if (!triangles.positions.length || !triangles.positions.every(Number.isFinite)) throw new Error('Model nie zawiera poprawnych trójkątów');
  return buildBeamStructure(voxelizeTriangles(triangles.positions, triangles.colors,
    { cellSize, shellLayers, interiorMode: 'shell' }),
  { skinParts: extractSkinParts(model), frameStride, bulkheadEvery });
}

export function disposeModelResources(root) {
  if (!root) return;
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  root.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) materials.add(m);
  });
  for (const m of materials) {
    for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    m.dispose();
  }
  for (const t of textures) { if (t.image) images.add(t.image); t.dispose(); }
  for (const img of images) img.close?.();
  for (const g of geometries) g.dispose();
}
