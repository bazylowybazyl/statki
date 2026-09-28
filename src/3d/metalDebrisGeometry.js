// Geometria odłamków metalu z dema belek: pogięta płyta poszycia ('plate') i kształtownik
// o otwartym przekroju C ('strut'). Bez materiału i bez shadera — dzielą ją pula odłamków
// kadłubów gry (hullDebris3D.js, TSL) i pula dem destruktora (beamDebris3D.js, GLSL na
// własnym WebGLRenderer destruktor2d/3d.html). Wydzielona z beamDebris3D.js w zadaniu 24 portu
// WebGPU, żeby gra nie ładowała GLSL puli dem.
import * as THREE from 'three';

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
