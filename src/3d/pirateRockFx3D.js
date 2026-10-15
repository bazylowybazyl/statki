// Wybuchy i kurz na powierzchni planetoidy pod bazą piratów (misja 1; src/3d/portBuildings/pirateRockSite3D.js).
//
// Osada leży ~8 km pod płaszczyzną gry i rysuje się w passie TŁA (warstwa 1, kamera perspektywy — paralaksa głębi).
// Pule efektów gry (WeaponFx, rakiety, gaz wybuchów) rysują się kamerą ORTHO w płaszczyźnie gry, więc wybuch z nich
// wisiałby nad osadą w złym miejscu (w perspektywie głęboki punkt zbiega się ku środkowi kadru). Tu: dwie małe
// partie kwadów w tym samym passie co skała — KULE OGNIA (addytywnie, premultiplied: alfa = max(rgb), HDR do ~9
// w rdzeniu i błysku — bloom) i KŁĘBY DYMU / KURZU (zwykłe mieszanie). Faktura z szumu wartości gry (fxNoise.tile2D).
// Kwady w płaszczyźnie sceny (kamera z góry patrzy prostopadle), w kamerach 3D w płaszczyźnie kadru (billboard3D.js).
//
// Graf raz na rodzaj, JEDEN rysunek na rodzaj; instancja = przepleciony rekord (środek względem początku siatki,
// narodziny, rozmiar, życie, ziarno), pierścień `PIRATE_ROCK_FX_CAP`. Zegar = zegar osady (czas gry — pauza stoi).
// Wysyłka bufora tylko po emisji (cały rekord pierścienia: 96 × 8 liczb).
import * as THREE from 'three/webgpu';
import { Discard, Fn, If, attribute, clamp, float, length, max, mix, positionGeometry, smoothstep, texture, uniform, varying, vec2, vec3, vec4 } from 'three/tsl';
import { billboardOffset } from './tsl/billboard3D.js';
import { blendAddytywnePremul } from './tsl/mieszanie.js';
import { fxNoise } from './fx/noise.js';

export const PIRATE_ROCK_FX_CAP = 96;
const STRIDE = 8; // środek xyz, narodziny | rozmiar, życie, (wolne), ziarno

export const PIRATE_ROCK_FX_TUNE = {
  fireGain: 1.0,
  smokeAlpha: 0.62
};

function buildGraph(kind, U) {
  const center = attribute('aCenter', 'vec3');
  const t0 = attribute('aT0', 'float');
  const misc = attribute('aMisc', 'vec4');
  const age = clamp(U.uTime.sub(t0).div(max(misc.y, 1e-3)), 0.0, 1.0);
  const alive = U.uTime.greaterThanEqual(t0).and(U.uTime.lessThan(t0.add(misc.y)));
  const inv = float(1.0).sub(age);
  // ogień: szybki wzrost (1 − (1 − a)³), dym: rośnie przez całe życie
  const grow = kind === 'fire'
    ? float(0.28).add(float(0.72).mul(float(1.0).sub(inv.mul(inv).mul(inv))))
    : float(0.45).add(age.mul(1.2)).sub(age.mul(age).mul(0.35));
  const size = alive.select(misc.x.mul(grow), float(0.0));
  const local = positionGeometry.xy;
  const vLocal = varying(local, `vRockFxLocal_${kind}`);
  const vAge = varying(age, `vRockFxAge_${kind}`);
  const vSeed = varying(misc.w, `vRockFxSeed_${kind}`);
  const positionNode = center.add(billboardOffset(local.x.mul(size), local.y.mul(size)));
  const noiseTex = fxNoise.tile2D();
  const fragmentNode = Fn(() => {
    const r = length(vLocal).toVar();
    If(r.greaterThanEqual(1.0), () => { Discard(); });
    const a = vAge;
    const ia = float(1.0).sub(a);
    const n = texture(noiseTex, vLocal.mul(0.42).add(vec2(vSeed, vSeed.mul(1.7))).add(a.mul(0.12))).toVar();
    if (kind === 'fire') {
      const edge = float(1.0).sub(smoothstep(n.r.mul(0.45).add(0.4), 1.0, r));
      const heat = ia.mul(ia);
      const t = clamp(heat.mul(float(1.25).sub(r.mul(0.8))).add(n.g.sub(0.5).mul(0.35)), 0.0, 1.0);
      const cool = vec3(0.9, 0.22, 0.06);
      const mid = vec3(3.2, 1.3, 0.35);
      const hot = vec3(9.0, 7.0, 4.0);
      const ramp = mix(mix(cool, mid, clamp(t.mul(2.0), 0.0, 1.0)), hot, clamp(t.mul(2.0).sub(1.0), 0.0, 1.0));
      const flash = float(1.0).sub(smoothstep(0.0, 0.09, a)).mul(float(1.0).sub(r)).mul(6.0);
      const col = ramp.mul(edge).mul(heat.mul(0.9).add(0.12)).add(flash).mul(U.uGain).toVar();
      return vec4(col, max(col.r, max(col.g, col.b)));
    }
    const edge = float(1.0).sub(smoothstep(n.r.mul(0.5).add(0.25), 1.0, r));
    const fadeIn = smoothstep(0.0, 0.06, a);
    const alpha = edge.mul(fadeIn).mul(ia).mul(float(1.0).sub(a.mul(0.25))).mul(n.b.mul(0.5).add(0.6)).mul(U.uAlpha);
    const ember = ia.mul(ia).mul(ia).mul(ia).mul(float(1.0).sub(r));
    const col = mix(vec3(0.052, 0.045, 0.039), vec3(0.42, 0.15, 0.05), ember);
    return vec4(col, clamp(alpha, 0.0, 1.0));
  })();
  return { positionNode, fragmentNode };
}

function makeMesh(kind, U, layer) {
  const base = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  const arr = new Float32Array(PIRATE_ROCK_FX_CAP * STRIDE);
  // martwe rekordy: narodziny daleko w przyszłości
  for (let i = 0; i < PIRATE_ROCK_FX_CAP; i++) arr[i * STRIDE + 3] = 1e9;
  const buf = new THREE.InstancedInterleavedBuffer(arr, STRIDE);
  geo.setAttribute('aCenter', new THREE.InterleavedBufferAttribute(buf, 3, 0));
  geo.setAttribute('aT0', new THREE.InterleavedBufferAttribute(buf, 1, 3));
  geo.setAttribute('aMisc', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.instanceCount = PIRATE_ROCK_FX_CAP;
  const mat = new THREE.NodeMaterial();
  mat.name = kind === 'fire' ? 'PirateRockFire' : 'PirateRockSmoke';
  mat.lights = false;
  mat.fog = false;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.side = THREE.DoubleSide;
  mat.forceSinglePass = true;
  if (kind === 'fire') blendAddytywnePremul(mat);
  const g = buildGraph(kind, U);
  mat.positionNode = g.positionNode;
  mat.fragmentNode = g.fragmentNode;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = mat.name;
  mesh.frustumCulled = false;
  mesh.renderOrder = kind === 'fire' ? 12 : 11;
  mesh.layers.set(layer);
  return { mesh, arr, buf, head: 0 };
}

export class PirateRockFx3D {
  constructor(layer = 1) {
    this.U = { uTime: uniform(0), uGain: uniform(PIRATE_ROCK_FX_TUNE.fireGain), uAlpha: uniform(PIRATE_ROCK_FX_TUNE.smokeAlpha) };
    this.root = new THREE.Group();
    this.root.name = 'PirateRockFx';
    this.fire = makeMesh('fire', this.U, layer);
    this.smoke = makeMesh('smoke', this.U, layer);
    this.root.add(this.smoke.mesh, this.fire.mesh);
    this.time = 0;
    this.origin = new THREE.Vector3();
    this._seed = 1;
  }

  /** Początek siatek w scenie (double — modelViewMatrix na CPU); środki emisji są względem niego. */
  setOrigin(x, y, z) {
    this.origin.set(x, y, z);
    this.root.position.copy(this.origin);
    this.root.updateMatrixWorld(true);
  }

  _rnd() {
    this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0;
    return this._seed / 4294967296;
  }

  _emit(pool, x, y, z, size, life, delay = 0) {
    const i = pool.head;
    pool.head = (pool.head + 1) % PIRATE_ROCK_FX_CAP;
    const o = i * STRIDE;
    const a = pool.arr;
    a[o] = x - this.origin.x;
    a[o + 1] = y - this.origin.y;
    a[o + 2] = z - this.origin.z;
    a[o + 3] = this.time + delay;
    a[o + 4] = size;
    a[o + 5] = life;
    a[o + 6] = 0;
    a[o + 7] = this._rnd() * 7.3;
    pool.buf.needsUpdate = true;
  }

  /** Wybuch w punkcie sceny (x, y, z) o rozmiarze `size` [j.]; nx, ny, nz — normalna powierzchni (kłęby idą w górę). */
  blast(x, y, z, size, nx = 0, ny = 0, nz = 1) {
    this._emit(this.fire, x + nx * size * 0.2, y + ny * size * 0.2, z + nz * size * 0.2, size, 1.5 + 0.4 * this._rnd());
    this._emit(this.fire, x + nx * size * 0.45, y + ny * size * 0.45, z + nz * size * 0.45, size * 0.62, 1.1, 0.18);
    for (let k = 0; k < 3; k++) {
      const a = this._rnd() * Math.PI * 2;
      const d = size * 0.35 * this._rnd();
      const h = size * (0.35 + 0.5 * k);
      this._emit(this.smoke, x + Math.cos(a) * d + nx * h, y + Math.sin(a) * d + ny * h, z + nz * h, size * (1.2 + 0.35 * k), 6.5 + 3 * this._rnd(), 0.25 + 0.3 * k);
    }
  }

  /** Kurz (lina, kabina o ziemię): sam dym, jaśniejszy i krótszy. */
  dust(x, y, z, size, nx = 0, ny = 0, nz = 1) {
    this._emit(this.smoke, x + nx * size * 0.3, y + ny * size * 0.3, z + nz * size * 0.3, size, 3.5 + 1.5 * this._rnd());
  }

  update(dt) {
    this.time += Math.max(0, Number(dt) || 0);
    this.U.uTime.value = this.time;
    this.U.uGain.value = PIRATE_ROCK_FX_TUNE.fireGain;
    this.U.uAlpha.value = PIRATE_ROCK_FX_TUNE.smokeAlpha;
  }

  /** Wszystko gaśnie (nowa gra). */
  reset() {
    for (const p of [this.fire, this.smoke]) {
      for (let i = 0; i < PIRATE_ROCK_FX_CAP; i++) p.arr[i * STRIDE + 3] = 1e9;
      p.head = 0;
      p.buf.needsUpdate = true;
    }
  }

  /** Siatki do rozgrzewki (Core3D.warmup). */
  warmupMeshes() { return [this.smoke.mesh, this.fire.mesh]; }
}
