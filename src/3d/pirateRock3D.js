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
  Fn, If, float, vec2, vec3, vec4, uniform, materialColor, positionLocal, normalize, dot, texture, clamp, step, mix
} from 'three/tsl';
import { loadTexture } from './canvas2d.js';
import { Core3D } from './core3d.js';
import { createMoonSurfaceMaterial, setMoonSunDirection, setMoonSunLight } from './moonSurface.tsl.js';
import { SMALL_BODY_MAPS } from './planetMaps.js';
import { SMALL_BODY_SEGMENTS, displaceSmallBodyGeometry, loadSmallBodyShape, smallBodyShapeAtDir } from './smallBodyShape.js';
import { portHubMatrixElements } from './portBuildings/portModuleTraffic.js';

const _inv = new THREE.Matrix4();
const _v = new THREE.Vector3();

/** Barwa skały (colorNode materiału skały): barwa mapy (materialColor) z mapą kraterów upadku. */
function rockColorNode(K) {
  return Fn(() => {
    const base = vec4(materialColor).toVar();
    const d = normalize(positionLocal).toVar();
    const kol = vec3(base.rgb).toVar();
    // Mapa kraterów upadku wiązanych wokseli (addCrater): łata styczna do skały pod bazą. R: wysokość [j.], G: spalenizna, B: wyrzut. Rzeźba z prawdziwego spadku terenu wobec słońca (K.sk: 1 / dwa teksele w j.), bez ruszania normalnych mapy, więc duży krater jest cieniowany jak mały.
    If(K.on.greaterThan(0.5), () => {
      const u = vec2(0).toVar();
      u.assign(vec2(dot(d, K.t1), dot(d, K.t2)).mul(K.s).add(0.5));
      const wew = step(0.0, u.x).mul(step(u.x, 1.0)).mul(step(0.0, u.y)).mul(step(u.y, 1.0)).mul(step(0.0, dot(d, K.k0))).toVar();
      const c0 = vec4(K.tex.sample(u).level(0)).toVar();
      const e = K.texel;
      const hx = K.tex.sample(u.add(vec2(e, 0.0))).level(0).r.sub(K.tex.sample(u.sub(vec2(e, 0.0))).level(0).r).toVar();
      const hy = K.tex.sample(u.add(vec2(0.0, e))).level(0).r.sub(K.tex.sample(u.sub(vec2(0.0, e))).level(0).r).toVar();
      const rzezba = clamp(float(1.0).sub(hx.mul(K.sun.x).add(hy.mul(K.sun.y)).mul(K.sk)), 0.45, 1.6).toVar();
      const wyrzut = vec3(0.34, 0.25, 0.2);
      const w = vec3(mix(kol.mul(float(1.0).sub(c0.g.mul(0.72))), wyrzut, c0.b.mul(0.6))).mul(rzezba).toVar();
      kol.assign(mix(kol, w, wew));
    });
    return vec4(kol, base.a);
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

/** Bok mapy kraterów upadku w tekselach. */
export const PIRATE_ROCK_KRATERY_BOK = 512;
const KRATER_RZEZBA = 1.6; // ile razy spadek terenu wobec słońca zmienia jasność

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
    // Mapa kraterów upadku (wiązane woksele, src/3d/woksele/wGrze.js): łata na skale pod bazą, pisana na CPU rzadko (co 0,25 s, tylko w upadku). Bez łaty (on = 0) graf robi jedno porównanie.
    const KB = PIRATE_ROCK_KRATERY_BOK;
    this._krDane = new Uint16Array(4 * KB * KB);
    this._krF = new Float32Array(3 * KB * KB); // wysokość [j.], spalenizna, wyrzut: stemple czytają stan, a połówkowy zapis gubi dokładność
    this._krTex = new THREE.DataTexture(this._krDane, KB, KB, THREE.RGBAFormat, THREE.HalfFloatType);
    this._krTex.minFilter = THREE.LinearFilter;
    this._krTex.magFilter = THREE.LinearFilter;
    this._krTex.generateMipmaps = false;
    this._krCzysc();
    this._kr = {
      on: uniform(0), s: uniform(1), texel: uniform(1 / KB), sk: uniform(1),
      k0: uniform(new THREE.Vector3(0, 1, 0)), t1: uniform(new THREE.Vector3(1, 0, 0)), t2: uniform(new THREE.Vector3(0, 0, 1)),
      sun: uniform(new THREE.Vector2(0, 0)), tex: texture(this._krTex, vec2(0)),
    };
    material.colorNode = rockColorNode(this._kr);   // graf tylko tego materiału (inne księżyce bez zmian)
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
    this._naKule = new THREE.Matrix4(); // scena → układ kuli, z ramki bazy: bez soczewki skoku, którą pirateBaseGame.js mnoży do root.matrix
  }

  /** Ramka bazy (portModuleFrame) i środek skały w GRZE (y w dół) — kierunek słońca liczy się z niego. */
  setFrame(frame, centerGame) {
    this.root.matrix.fromArray(portHubMatrixElements(frame));
    this.root.matrixWorldNeedsUpdate = true;
    this.mesh.updateMatrix();
    this._naKule.multiplyMatrices(this.root.matrix, this.mesh.matrix).invert();
    this.center.x = centerGame.x;
    this.center.y = centerGame.y;
  }

  /** Bez kraterów (nowa gra / nowa baza). */
  clearScars() {
    this._krCzysc();
    this._kr.on.value = 0;
  }

  _krCzysc() {
    this._krF.fill(0);
    const D = this._krDane;
    D.fill(0);
    const jeden = THREE.DataUtils.toHalfFloat(1);
    for (let i = 3; i < D.length; i += 4) D[i] = jeden;
    this._krTex.needsUpdate = true;
  }

  /** Łata kraterów: punkt sceny (x, y, z) na skale, połowa boku [j.]. Układ styczny w układzie siatki kuli. */
  setCraterPatch(x, y, z, half) {
    const K = this._kr;
    const k0 = K.k0.value.set(x, y, z).applyMatrix4(this._naKule).normalize();
    const ref = Math.abs(k0.z) > 0.9 ? _v.set(1, 0, 0) : _v.set(0, 0, 1);
    K.t1.value.crossVectors(k0, ref).normalize();
    K.t2.value.crossVectors(k0, K.t1.value);
    K.s.value = this.layout.R / (2 * half);
    K.sk.value = (KRATER_RZEZBA * PIRATE_ROCK_KRATERY_BOK) / (4 * half);
    K.on.value = 1;
  }

  /**
   * Krater w punkcie sceny: r [j.], k (0..1): siła spalenizny i wyrzutu. Misa z wałem o głębokości proporcjonalnej do promienia, wokół wyrzut w promieniach. Nowa misa wybija to, co było w jej środku, a dalej stary teren zostaje, więc większy krater przykrywa mniejsze.
   * Bez alokacji i bez wysyłki: wysyłkę zamawia wołający raz na paczkę (flushCraters).
   */
  addCrater(x, y, z, r, k = 1) {
    const K = this._kr;
    if (K.on.value < 0.5 || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !(r > 0)) return false;
    _v.set(x, y, z).applyMatrix4(this._naKule).normalize();
    const KB = PIRATE_ROCK_KRATERY_BOK;
    const s = K.s.value;
    const cu = (_v.dot(K.t1.value) * s + 0.5) * KB, cv = (_v.dot(K.t2.value) * s + 0.5) * KB;
    const rt = (r / this.layout.R) * s * KB;
    const zas = Math.ceil(rt * 3.2);
    const u0 = Math.max(0, Math.floor(cu - zas)), u1 = Math.min(KB - 1, Math.ceil(cu + zas));
    const v0 = Math.max(0, Math.floor(cv - zas)), v1 = Math.min(KB - 1, Math.ceil(cv + zas));
    const ziarno = (Math.abs(cu * 12.9898 + cv * 78.233) * 43.7) % 1;
    const F = this._krF, D = this._krDane, h16 = THREE.DataUtils.toHalfFloat;
    const glebia = 0.28 * r, wysWalu = 0.05 * r;
    for (let j = v0; j <= v1; j++) for (let i = u0; i <= u1; i++) {
      const dx = i + 0.5 - cu, dy = j + 0.5 - cv;
      const rho = Math.sqrt(dx * dx + dy * dy) / Math.max(rt, 0.5);
      if (rho > 3.2) continue;
      const q = 4 * (j * KB + i), f = 3 * (j * KB + i);
      // Wysokość: misa i wał. Spalenizna w misie. Wyrzut za wałem w promieniach z kąta i ziarna krateru.
      const misa = rho < 1 ? -glebia * (1 - rho * rho) : 0;
      const wal = wysWalu * Math.exp(-((rho - 1) * (rho - 1)) / 0.03);
      const t = Math.max(0, Math.min(1, (rho - 0.7) / 0.3));
      const zostaje = t * t * (3 - 2 * t);
      F[f] = F[f] * zostaje + misa + wal;
      D[q] = h16(F[f]);
      if (rho < 1.25) {
        const e = Math.max(0, Math.min(1, (rho - 0.7) / 0.55));
        const sp = Math.min(1, k * 0.7) * (1 - e * e * (3 - 2 * e));
        if (sp > F[f + 1]) { F[f + 1] = sp; D[q + 1] = h16(sp); }
      }
      if (rho > 0.85) {
        const az = Math.atan2(dy, dx);
        const rays = 0.55 + 0.45 * Math.sin(az * 7 + ziarno * 40) * Math.sin(az * 13 + ziarno * 91);
        const zanik = Math.max(0, 1 - (rho - 0.85) / 2.35);
        const wy = Math.min(1, k) * rays * zanik * zanik;
        if (wy > F[f + 2]) { F[f + 2] = wy; D[q + 2] = h16(wy); }
      } else if (F[f + 2] > 0) {
        F[f + 2] *= zostaje;
        D[q + 2] = h16(F[f + 2]);
      }
    }
    this._krBrud = true;
    return true;
  }

  /** Wysyłka mapy kraterów na GPU, gdy coś się zmieniło (raz na paczkę stempli). */
  flushCraters() {
    if (!this._krBrud) return;
    this._krBrud = false;
    this._krTex.needsUpdate = true;
  }

  /** Klatka: kierunek do Słońca (punkt Słońca w grze) — słońce z płaszczyzny gry jak na małych ciałach. */
  update(sun) {
    setMoonSunLight(Core3D._sunShadowLight);
    if (sun) setMoonSunDirection(this.material, Number(sun.x) - this.center.x, -(Number(sun.y) - this.center.y), 0);
    if (sun && this._kr.on.value > 0.5) {
      this.mesh.updateWorldMatrix(true, false);
      _inv.copy(this.mesh.matrixWorld).invert();
      _v.set(Number(sun.x) - this.center.x, -(Number(sun.y) - this.center.y), 0).transformDirection(_inv);
      this._kr.sun.value.set(_v.dot(this._kr.t1.value), _v.dot(this._kr.t2.value));
    }
  }

  /** Promień skały [j.] w kierunku punktu sceny, z tej samej mapy co siatka. Bez mapy R. */
  surfaceRadiusAt(x, y, z) {
    if (!this.shape) return this.layout.R;
    _v.set(x, y, z).applyMatrix4(this._naKule).normalize();
    return this.layout.R * (1 + smallBodyShapeAtDir(this.shape, _v.x, _v.y, _v.z));
  }

  /** Promień skały pod punktem bazy [j.]: średnia z wierzchołków siatki kuli w stożku, po wczytaniu mapy kształtu. Bez niej R. */
  surfaceRadiusNear(x, y, z, half) {
    if (!this.shapeReady) return this.layout.R;
    const k0 = _v.set(x, y, z).applyMatrix4(this._naKule).normalize().clone();
    const cosMax = Math.cos(Math.min(0.9, half / this.layout.R));
    const p = this.mesh.geometry.attributes.position;
    let suma = 0, ile = 0;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const l = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (l > 1e-6 && (vx * k0.x + vy * k0.y + vz * k0.z) / l > cosMax) { suma += l; ile++; }
    }
    return ile ? (suma / ile) * this.layout.R : this.layout.R;
  }

  dispose() {
    this.root.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
