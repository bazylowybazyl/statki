// ============================================================
// Eksport GLB modelu 3D Atlasa z uzbrojeniem (Blender i inne narzędzia). Te same geometrie,
// ale materiały standardowe (glTF nie zna grafów TSL): trójkąty pogrupowane po `aMat`,
// każda grupa dostaje barwę, szorstkość, metaliczność i emisję z palety, pokład — teksturę
// sprite'a. Oś Z modelu → Y glTF (Blender przelicza z powrotem na Z w górę).
// ============================================================
import * as THREE from 'three/webgpu';
import { SHIP3D_PALETTE } from '../../src/3d/ships3d/shipMaterials3D.tsl.js';
import { SHIP3D_MAT } from '../../src/3d/ships3d/meshBuilder3D.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const NAMES = Object.fromEntries(Object.entries(SHIP3D_MAT).map(([k, v]) => [v, k.toLowerCase()]));

function makeMaterials(deckTexture) {
  return SHIP3D_PALETTE.map((p, id) => {
    const m = new THREE.MeshStandardMaterial({
      name: `atlas_${NAMES[id] || id}`,
      color: new THREE.Color(p.color),
      roughness: p.rough,
      metalness: p.metal
    });
    if (p.power > 0) {
      m.emissive = new THREE.Color(p.emissive);
      m.emissiveIntensity = p.power;
    }
    if (id === SHIP3D_MAT.DECK && deckTexture) {
      m.color.set(0xffffff);
      m.map = deckTexture;
    }
    return m;
  });
}

// Geometria z atrybutem aMat → ta sama geometria z grupami (indeks posortowany po materiale).
function grouped(geo) {
  const aMat = geo.attributes.aMat;
  const index = geo.index;
  const tris = index.count / 3;
  const buckets = new Map();
  for (let t = 0; t < tris; t++) {
    const m = Math.round(aMat.getX(index.getX(t * 3)));
    if (!buckets.has(m)) buckets.set(m, []);
    buckets.get(m).push(index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2));
  }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) out.setAttribute(name, geo.attributes[name].clone());
  const idx = [];
  for (const [m, list] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    out.addGroup(idx.length, list.length, m);
    for (const i of list) idx.push(i);
  }
  out.setIndex(idx);
  return out;
}

/** Blob GLB: kadłub + wieże w bieżącej pozie (ustawienie luf jak na ekranie). */
export async function exportAtlasGLB(ship, image) {
  const deck = new THREE.Texture(image);
  deck.colorSpace = THREE.SRGBColorSpace;
  deck.needsUpdate = true;
  const mats = makeMaterials(deck);
  const cache = new Map();
  const conv = (geo) => {
    if (!cache.has(geo)) cache.set(geo, grouped(geo));
    return cache.get(geo);
  };

  const root = new THREE.Group();
  root.name = 'Atlas_3D';
  root.rotation.x = -Math.PI / 2; // Z w górę → Y w górę (glTF)
  const hull = new THREE.Mesh(conv(ship.hullGeometry), mats);
  hull.name = 'kadlub';
  root.add(hull);

  const turrets = new THREE.Group();
  turrets.name = 'uzbrojenie';
  root.add(turrets);
  for (const t of ship.turrets) {
    const copy = t.root.clone(true);
    copy.name = `${t.weaponId}__${t.mount.id}`;
    copy.traverse((o) => { if (o.isMesh) { o.geometry = conv(o.geometry); o.material = mats; } });
    turrets.add(copy);
  }

  const scene = new THREE.Scene();
  scene.add(root);
  scene.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(scene, { binary: true, onlyVisible: false });
  return new Blob([glb], { type: 'model/gltf-binary' });
}
