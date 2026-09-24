import * as THREE from 'three';

// Small +X-forward fighter, passed through the same skin/lattice importer as GLBs.
export function createBeamFighterModel() {
  const root = new THREE.Group();
  const hull = new THREE.MeshBasicMaterial({ color: 0x91a6b8 });
  const trim = new THREE.MeshBasicMaterial({ color: 0xcf563d });
  const glass = new THREE.MeshBasicMaterial({ color: 0x204863 });
  const engine = new THREE.MeshBasicMaterial({ color: 0x62d7ff });
  function wedge(points, thickness, material, y = 0) {
    const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, y - thickness / 2, 0);
    root.add(new THREE.Mesh(geo, material));
  }
  function box(x, y, z, px, py, pz, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), material);
    mesh.position.set(px, py, pz); root.add(mesh);
  }
  wedge([[7, 0], [1, -1.2], [-5, -1], [-5, 1], [1, 1.2]], 1.5, hull);
  wedge([[2, -0.6], [-3, -5.6], [-5, -5.6], [-4, -0.6]], 0.5, hull);
  wedge([[2, 0.6], [-4, 0.6], [-5, 5.6], [-3, 5.6]], 0.5, hull);
  wedge([[3, 0], [0.2, -0.75], [-2, -0.65], [-2, 0.65], [0.2, 0.75]], 0.8, glass, 1.1);
  for (const side of [-1, 1]) {
    box(4, 0.8, 0.9, -3.2, 0, side * 1.65, trim);
    box(0.3, 0.6, 0.65, -5.3, 0, side * 1.65, engine);
    box(3.2, 0.25, 0.28, -2, 0.45, side * 4.25, trim);
  }
  return root;
}
