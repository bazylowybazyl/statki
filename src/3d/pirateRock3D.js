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
import {
  Fn, If, Loop, float, int, vec3, vec4, uniform, uniformArray, materialColor, positionLocal, normalize, dot, cross,
  clamp, smoothstep, mix, max, abs, select, acos, atan, sin, fract, floor, pow
} from 'three/tsl';
import { loadTexture } from './canvas2d.js';
import { Core3D } from './core3d.js';
import { createMoonSurfaceMaterial, setMoonSunDirection, setMoonSunLight } from './moonSurface.tsl.js';
import { SMALL_BODY_MAPS } from './planetMaps.js';
import { SMALL_BODY_SEGMENTS, displaceSmallBodyGeometry, loadSmallBodyShape } from './smallBodyShape.js';
import { portHubMatrixElements } from './portBuildings/portModuleTraffic.js';

const _inv = new THREE.Matrix4();
const _v = new THREE.Vector3();

/**
 * Barwa skały ze śladami uderzeń (colorNode materiału skały): barwa mapy (materialColor) przyciemniona na wałach wyrzutu,
 * zmieszana z barwą lodu na dnie kraterów i w promieniach (lustro CPU: pirateRockScarCpu). Pętla po śladach z progiem
 * cos zasięgu (B.w) — poza zasięgiem tylko iloczyn skalarny.
 */
function scarColorNode(A, B, N) {
  return Fn(() => {
    const base = vec4(materialColor).toVar();
    const d = normalize(positionLocal).toVar();
    const ice = float(0.0).toVar();
    const dark = float(0.0).toVar();
    Loop({ start: int(0), end: N, type: 'int', condition: '<', name: 'scar' }, ({ scar }) => {
      const S = A.element(scar).toVar();
      const SB = B.element(scar).toVar();
      const c = dot(d, S.xyz).toVar();
      If(c.greaterThan(SB.w), () => {
        const rad = max(S.w, 1e-5);
        const ang = acos(clamp(c, -1.0, 1.0)).div(rad).toVar();
        // azymut wokół środka śladu (baza styczna), promienie wyrzutu: komórki azymutu z haszu (część pusta), profil w komórce
        const ref = select(abs(S.z).greaterThan(0.9), vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0));
        const t1 = normalize(cross(S.xyz, ref));
        const t2 = cross(S.xyz, t1);
        const az = atan(dot(d, t2), dot(d, t1)).div(6.2831853).add(0.5).mul(SB.z);
        const cell = floor(az);
        const h = fract(sin(cell.mul(12.9898).add(SB.y)).mul(43758.5453));
        const h2 = fract(sin(cell.mul(78.233).add(SB.y.mul(1.7))).mul(24634.6345));
        const prof = float(1.0).sub(abs(fract(az).mul(2.0).sub(1.0)));
        const ray = select(h.greaterThan(0.35), smoothstep(0.25, 0.95, prof).mul(h.mul(0.6).add(0.4)), float(0.0));
        const len = float(1.4).add(h2.mul(1.2));
        const k = SB.x;
        // plamy dna (szum wartości z kierunku — bez tekstury): lód odsłonięty nierówno
        const m = fract(sin(dot(d.mul(SB.z.mul(9.0).add(120.0)), vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
        const floorIce = float(1.0).sub(smoothstep(0.5, 0.95, ang)).mul(m.mul(0.35).add(0.65));
        const rim = smoothstep(0.6, 0.95, ang).mul(float(1.0).sub(smoothstep(0.95, 1.8, ang)));
        const rays = smoothstep(0.85, 1.1, ang).mul(float(1.0).sub(smoothstep(len.sub(1.0), len, ang))).mul(ray);
        ice.assign(max(ice, clamp(floorIce.mul(0.75).add(rays.mul(0.45)).mul(k), 0.0, 1.0)));
        dark.assign(max(dark, clamp(rim.mul(0.35).mul(k), 0.0, 0.45)));
      });
    });
    const iceCol = vec3(0.5, 0.53, 0.58);
    return vec4(mix(base.rgb.mul(float(1.0).sub(dark)), iceCol, ice), base.a);
  })();
}

function loadTex(path, srgb) {
  const tex = loadTexture(path, (t) => {
    const img = t?.image;
    const decoding = img && typeof img.decode === 'function' ? img.decode() : null;
    if (decoding) decoding.catch(() => {}).then(() => Core3D.queueTextureUpload?.(t));
    else Core3D.queueTextureUpload?.(t);
  });
  tex.anisotropy = Core3D.getMaxAnisotropy?.() || 1;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Najwięcej śladów uderzeń na skale (uniformy materiału skały). */
export const PIRATE_ROCK_SCAR_CAP = 24;

/**
 * Ślad uderzenia w materiale skały (lustro CPU graficznej reguły z `scarNode` — testy): ang — odległość kątowa od środka
 * śladu w promieniach krateru, ray — wartość promienia wyrzutu (0..1, z azymutu), k — siła. Zwraca { ice, dark }: udział
 * odsłoniętego lodu (jasne dno i promienie) i przyciemnienie wału wyrzutu.
 */
export function pirateRockScarCpu(ang, ray, k) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const floorIce = 1 - ss(0.5, 0.95, ang);
  const rim = ss(0.6, 0.95, ang) * (1 - ss(0.95, 1.8, ang));
  const rays = ss(0.85, 1.1, ang) * (1 - ss(1.6, 2.6, ang)) * ray;
  return { ice: Math.min(1, (floorIce * 0.75 + rays * 0.45) * k), dark: Math.min(0.45, rim * 0.35 * k) };
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
    // Ślady uderzeń (upadek bazy — pirateRockImpactFx.js → addScar; prośba użytkownika 2026-10-19): jasny lód na dnie krateru
    // i w promieniach wyrzutu (centaur — ciemny regolit nad lodem), ciemniejszy wał; zostają do nowej gry. Kierunek śladu
    // w układzie siatki kuli (positionLocal), promień kątowy, siła, ziarno, liczba promieni, cos zasięgu (próg pętli).
    // Graf tylko tego materiału (colorNode — inne księżyce bez zmian).
    this._scarA = uniformArray(Array.from({ length: PIRATE_ROCK_SCAR_CAP }, () => new THREE.Vector4(0, 0, 1, 0)), 'vec4').setName('pirateRockScarA');
    this._scarB = uniformArray(Array.from({ length: PIRATE_ROCK_SCAR_CAP }, () => new THREE.Vector4(0, 0, 8, 2)), 'vec4').setName('pirateRockScarB');
    this._scarN = uniform(0, 'int');
    this._scarCount = 0;
    material.colorNode = scarColorNode(this._scarA, this._scarB, this._scarN);
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

  /**
   * Ślad uderzenia w punkcie sceny (x, y, z): r — promień krateru [j.], k — siła (0..1,5: lód i wał). Ślad bliski istniejącemu
   * (< 0,6 promienia) go powiększa; pełna lista — zastępuje najsłabszy. Trwały do nowej gry (clearScars).
   */
  addScar(x, y, z, r, k = 1) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !(r > 0)) return false;
    this.mesh.updateWorldMatrix(true, false);
    _inv.copy(this.mesh.matrixWorld).invert();
    _v.set(x, y, z).applyMatrix4(_inv);
    if (!(_v.lengthSq() > 1e-12)) return false;
    _v.normalize();
    const rad = Math.min(0.35, r / this.layout.R);
    const A = this._scarA.array, B = this._scarB.array;
    let n = this._scarCount;
    // scalenie z bliskim śladem
    for (let i = 0; i < n; i++) {
      const a = A[i];
      const c = a.x * _v.x + a.y * _v.y + a.z * _v.z;
      if (Math.acos(Math.min(1, Math.max(-1, c))) < 0.6 * Math.max(a.w, rad)) {
        a.w = Math.min(0.35, Math.max(a.w, rad) * 1.08);
        B[i].x = Math.min(1.5, Math.max(B[i].x, k) + 0.15 * k);
        B[i].w = Math.cos(Math.min(Math.PI, a.w * 2.7));
        return true;
      }
    }
    let slot = n;
    if (n >= PIRATE_ROCK_SCAR_CAP) {
      slot = 0;
      for (let i = 1; i < n; i++) if (A[i].w * B[i].x < A[slot].w * B[slot].x) slot = i;
    } else n++;
    A[slot].set(_v.x, _v.y, _v.z, rad);
    B[slot].set(Math.min(1.5, k), (Math.abs(_v.x * 91.7 + _v.y * 37.3 + _v.z * 11.1) % 1) * 61.3, 7 + Math.floor(((_v.x + 1.3) * 977) % 7), Math.cos(Math.min(Math.PI, rad * 2.7)));
    this._scarCount = n;
    this._scarN.value = n;
    return true;
  }

  /** Bez śladów (nowa gra / nowa baza). */
  clearScars() {
    this._scarCount = 0;
    this._scarN.value = 0;
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
