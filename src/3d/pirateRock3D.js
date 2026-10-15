// Planetoida pod bazą piratów (misja 1) — bryła skały (src/3d/portBuildings/pirateRockLayout.js: geometria, decyzje
// użytkownika z 2026-10-15). Ten sam materiał co małe ciała (moonSurface.tsl.js, wariant tła perspektywy — bez maski
// słońca: maska jest liczona w płaszczyźnie gry, a skała leży 8–40 km pod nią), mapy z generatora
// (scripts/planety/male_ciala.py: hidalgo — SMALL_BODY_MAPS w planetMaps.js), kształt bryły z mapy promienia
// (wyrównany taras osady na szczycie: d = 0).
//
// Pass TŁA (warstwa 1, kamera perspektywy) — jak dysk mieszkalny habitatu: skała i dysk przesłaniają się testem
// głębi w jednym passie (pass ring-planet małych ciał rysuje się PO tle i przykryłby dysk). Bez cienia (warstwa 1 nie
// wchodzi do mapy cienia słońca) i bez tarczy w masce słońca: skała leży w całości pod płaszczyzną gry, a słońce gry
// świeci z płaszczyzny — nie zasłania niczego w płaszczyźnie.
//
// Bryła siedzi w grupie z MACIERZĄ RAMKI BAZY (portHubMatrixElements — układ (x, h, z) bazy → scena, obrót bez
// odbicia): położenie = środek skały w układzie bazy, obrót = meshQuat (stopa windy = lon 0, lat 0 mapy). Skała nie
// obraca się (winda trzyma bazę nad tarasem).
import * as THREE from 'three/webgpu';
import { Core3D } from './core3d.js';
import { createMoonSurfaceMaterial, setMoonSunDirection, setMoonSunLight } from './moonSurface.tsl.js';
import { SMALL_BODY_MAPS } from './planetMaps.js';
import { SMALL_BODY_SEGMENTS, displaceSmallBodyGeometry, loadSmallBodyShape } from './smallBodyShape.js';
import { portHubMatrixElements } from './portBuildings/portModuleTraffic.js';

const loader = new THREE.TextureLoader();
function loadTex(path, srgb) {
  const tex = loader.load(path, (t) => {
    const img = t?.image;
    const decoding = img && typeof img.decode === 'function' ? img.decode() : null;
    if (decoding) decoding.catch(() => {}).then(() => Core3D.queueTextureUpload?.(t));
    else Core3D.queueTextureUpload?.(t);
  });
  tex.anisotropy = Core3D.getMaxAnisotropy?.() || 1;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class PirateRock3D {
  /** layout — createPirateRockLayout(); layer — warstwa passa tła (1). */
  constructor(layout, layer = 1) {
    this.layout = layout;
    this.root = new THREE.Group();
    this.root.name = 'PirateRock';
    this.root.matrixAutoUpdate = false;
    const id = layout.spec.id;
    const maps = SMALL_BODY_MAPS[id] || SMALL_BODY_MAPS.hygiea;
    const material = createMoonSurfaceMaterial({
      map: loadTex(maps.day, true), nightMap: loadTex(maps.night, true), normalMap: maps.normal ? loadTex(maps.normal, false) : null,
      normalScale: Number(maps.normalScale) || 1, sunMask: false, roughness: Number(maps.roughness) || 0.98
    });
    material.name = `${material.name}:${id}`;
    this.material = material;
    const geometry = new THREE.SphereGeometry(1, SMALL_BODY_SEGMENTS.w, SMALL_BODY_SEGMENTS.h);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = `PirateRock:${id}`;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    const c = layout.center;
    this.mesh.position.set(c[0], c[1], c[2]);
    const q = layout.meshQuat;
    this.mesh.quaternion.set(q[0], q[1], q[2], q[3]);
    this.mesh.scale.setScalar(layout.R);
    this.mesh.layers.set(layer);
    this.root.add(this.mesh);
    this.root.layers.set(layer);
    this.shapeReady = !(maps.shape && maps.shapeRange);
    if (!this.shapeReady) {
      loadSmallBodyShape(maps.shape, maps.shapeRange).then((shape) => {
        displaceSmallBodyGeometry(this.mesh.geometry, shape);
        this.shape = shape;
        this.shapeReady = true;
      }).catch((err) => console.warn(`[planetoida piratów] ${id}: mapa kształtu`, err));
    }
    this.center = { x: 0, y: 0 };
  }

  /** Ramka bazy (portModuleFrame) i środek skały w GRZE (y w dół) — kierunek słońca liczy się z niego. */
  setFrame(frame, centerGame) {
    this.root.matrix.fromArray(portHubMatrixElements(frame));
    this.root.matrixWorldNeedsUpdate = true;
    this.center.x = centerGame.x;
    this.center.y = centerGame.y;
  }

  /** Klatka: kierunek do Słońca (punkt Słońca w grze) — słońce z płaszczyzny gry jak na małych ciałach. */
  update(sun) {
    setMoonSunLight(Core3D._sunShadowLight);
    if (sun) setMoonSunDirection(this.material, Number(sun.x) - this.center.x, -(Number(sun.y) - this.center.y), 0);
  }

  dispose() {
    this.root.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
