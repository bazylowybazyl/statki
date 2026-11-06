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
  Fn, If, Loop, float, int, vec2, vec3, vec4, uniform, uniformArray, materialColor, positionLocal, normalize, dot, cross, texture,
  clamp, smoothstep, step, mix, max, abs, select, acos, atan, sin, fract, floor, pow
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
function scarColorNode(A, B, N, K) {
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
    const kol = vec3(mix(base.rgb.mul(float(1.0).sub(dark)), iceCol, ice)).toVar();
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

/** Najwięcej śladów uderzeń na skale (uniformy materiału skały). */
export const PIRATE_ROCK_SCAR_CAP = 24;
/** Bok mapy kraterów upadku w tekselach. */
export const PIRATE_ROCK_KRATERY_BOK = 512;
const KRATER_RZEZBA = 1.6; // ile razy spadek terenu wobec słońca zmienia jasność

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
    material.colorNode = scarColorNode(this._scarA, this._scarB, this._scarN, this._kr);
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
