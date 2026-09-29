// dema/asteroidy-webgpu/fragments.js
//
// Okruchy skał w wydobyciu (src/game/asteroidMining.js: pebbles) jako prawdziwe
// ODŁAMKI, nie mniejsze asteroidy (prośba użytkownika 2026-09-28: „usuń
// spawnowanie asteroid z asteroidy”; wcześniej okruch rysował się kształtem
// z banku skał i powierzchnią pola — z wybuchu wylatywały małe, zwietrzałe
// „ziemniaki” z malachitem):
//   • SKORUPA — ostre, kanciaste odłamki (otoczka wypukła losowych punktów,
//     płaskie ściany przełomu), świeży przełom jaśniejszy niż zwietrzały
//     wierzch, drobinki minerału rudy (malachit, chondry…) — ~10% rudy;
//   • RDZEŃ (okruch z flagą `core`) — materiałem rdzenia (coreLook.js):
//     bryłki metalu (miedź, żelazo, tytan: gładkie garby, połysk metalu,
//     patyna w zagłębieniach), kiście zbitych kryształów (graniastosłupy ze
//     szpicami, świecą), bryłki czystego lodu, bryły smółki uranowej (żyłki
//     świecą), kanciaste kryształy krzemu.
// Żwir ze strefy zmiażdżenia i kawałki rdzenia chwilę się żarzą po wybuchu (gasną
// w 2–3 s) — w mroku pola widać, co wyleciało.
//
// Rodziny kształtów to osobne siatki instancji na JEDNYM materiale (graf TSL
// raz). Światło jak wnętrze skał (minedRocks.js): słońce z przesłanianiem pola,
// otoczenie gasnące w mroku, światła siatki, pył ośrodka do stropu warstwy skał.
// Pozycje względem lokalnego początku sceny (x − ox, Y + oy, z).

import * as THREE from 'three/webgpu';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Fn, float, int, vec3, vec4, attribute, varyingProperty, positionGeometry, normalGeometry, texture3D,
  mix, smoothstep, clamp, max, pow, dot, normalize, select, abs
} from 'three/tsl';
import { mulberry32, hash32 } from '../../src/game/asteroidBeltField.js';
import { ROCK_TYPE_INDEX } from '../../src/game/asteroidRockKinds.js';
import { CORE_MATERIAL } from '../../src/game/asteroidMaterials.js';
import { quatRotate } from './tslCommon.js';
import { createCoreLookArray, coreSurface } from './coreLook.js';

export const FRAGMENT_FAMILY = Object.freeze({ SHARD: 0, NUGGET: 1, CRYSTAL: 2, BLOCK: 3 });
const VARIANTS = Object.freeze([6, 4, 4, 3]);
// Rdzenie, które żarzą się po wybuchu (metal, smółka); lodowy żwir też nie.
const HOT_CORE = new Set(['metal', 'mineral']);
const ICE_TYPE = ROCK_TYPE_INDEX.ice;
// fA = (x, y, z, r) scena, fB = kwaternion, fC = (typ, rdzeń 0/1, ziarno, sunT), fD = (żar, —, —, —)
const FLOATS = 16;

// ---------------------------------------------------------------------------
// Kształty (deterministyczne, raz przy starcie)

function hash01(a, b, c) {
  return hash32(a, b, c, 0x0F4A) / 4294967296;
}

function vnoise(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (dx, dy, dz) => hash01(seed, (ix + dx + 512) * 1024 + (iy + dy + 512), iz + dz + 512);
  const a = h(0, 0, 0) + (h(1, 0, 0) - h(0, 0, 0)) * ux;
  const b = h(0, 1, 0) + (h(1, 1, 0) - h(0, 1, 0)) * ux;
  const c = h(0, 0, 1) + (h(1, 0, 1) - h(0, 0, 1)) * ux;
  const d = h(0, 1, 1) + (h(1, 1, 1) - h(0, 1, 1)) * ux;
  const e = a + (b - a) * uy;
  const f = c + (d - c) * uy;
  return e + (f - e) * uz;
}

// Objętość siatki zamkniętej (dywergencja) → skala do objętości kuli o promieniu 1:
// promień okruchu z fizyki (objętość) = wielkość na ekranie.
function toUnitVolume(geo) {
  geo.center();
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.getAttribute('position').array;
  let v = 0;
  for (let i = 0; i + 8 < p.length; i += 9) {
    v += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7])
      - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6])
      + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
  }
  v = Math.abs(v) / 6;
  const k = Math.cbrt((4 / 3) * Math.PI / Math.max(1e-6, v));
  geo.scale(k, k, k);
  geo.computeBoundingSphere();
  return geo;
}

// Odłamek skały: otoczka wypukła punktów na spłaszczonej, wydłużonej elipsoidzie —
// ostre krawędzie i płaskie ściany przełomu.
function shardGeometry(seed, chunky = false) {
  const rng = mulberry32(seed);
  const ax = chunky ? [1, 0.75 + rng() * 0.2, 0.6 + rng() * 0.25] : [1, 0.5 + rng() * 0.4, 0.3 + rng() * 0.35];
  const pts = [];
  // Kilka dużych ścian przełomu (punkty ścięte do płaszczyzn) i drobniejsze odpryski.
  const planes = [];
  for (let p = 0; p < 3; p++) {
    const u = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    planes.push([Math.cos(a) * s, Math.sin(a) * s, u, 0.45 + rng() * 0.3]);
  }
  const n = 14 + Math.floor(rng() * 8);
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const r = 0.72 + rng() * 0.32;
    let x = Math.cos(a) * s * r, y = Math.sin(a) * s * r, z = u * r;
    for (const [px, py, pz, d] of planes) {
      const t = x * px + y * py + z * pz - d;
      if (t > 0) { x -= px * t; y -= py * t; z -= pz * t; }
    }
    pts.push(new THREE.Vector3(x * ax[0], y * ax[1], z * ax[2]));
  }
  return toUnitVolume(new ConvexGeometry(pts));
}

// Bryłka metalu / smółki: bryła z guzami (trzy oktawy szumu, mocne niskie — nie jajko),
// gładkie normalne.
function nuggetGeometry(seed) {
  const rng = mulberry32(seed);
  // Podział (d + 1)² trójkątów na ścianę: 10 → 2420 trójkątów (4 → 500 robiło płaskie płaty na garbach).
  const g0 = new THREE.IcosahedronGeometry(1, 10);
  g0.deleteAttribute('normal');
  g0.deleteAttribute('uv');
  const g = mergeVertices(g0);
  const pos = g.getAttribute('position');
  const k = [0.92 + rng() * 0.16, 0.8 + rng() * 0.18, 0.72 + rng() * 0.2];
  const o = [rng() * 17, rng() * 17, rng() * 17];
  const ns = hash32(seed, 0x6E6, 1, 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const lobes = vnoise(x * 1.6 + o[0], y * 1.6 + o[1], z * 1.6 + o[2], ns) - 0.5;
    const knobs = vnoise(x * 2.7 + o[1], y * 2.7 + o[2], z * 2.7 + o[0], ns ^ 0x55) - 0.5;
    const grit = vnoise(x * 7.5 + o[2], y * 7.5 + o[0], z * 7.5 + o[1], ns ^ 0xAA) - 0.5;
    // Guzy na płatach: bryłka metalu, nie jajko (gładko — max() robił ostre „zagięcia”).
    const bump = knobs + 0.12;
    const d = 1 + 0.65 * lobes + 0.9 * bump * bump * Math.sign(bump) + 0.06 * grit;
    pos.setXYZ(i, x * d * k[0], y * d * k[1], z * d * k[2]);
  }
  g.computeVertexNormals();
  return toUnitVolume(g);
}

// Kiść zbitych kryształów: graniastosłupy sześciokątne ze szpicami z jednej podstawy.
function crystalGeometry(seed) {
  const rng = mulberry32(seed);
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const n = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const len = 0.8 + rng() * 1.4;
    const rad = 0.12 + rng() * 0.13;
    const tipH = rad * (1.5 + rng() * 1.2);
    const prism = new THREE.CylinderGeometry(rad, rad * 1.08, len, 6, 1, false).toNonIndexed();
    const tip = new THREE.ConeGeometry(rad, tipH, 6, 1, true).toNonIndexed();
    tip.translate(0, len * 0.5 + tipH * 0.5, 0);
    const c = mergeGeometries([prism, tip]);
    c.translate(0, len * 0.5, 0);
    c.rotateY(rng() * Math.PI);
    // Kierunek w stożku wokół +Y (kiść), trochę na boki.
    const tilt = (0.15 + rng() * 0.85) * 1.05;
    const az = rng() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    c.translate((rng() - 0.5) * 0.3, -0.35, (rng() - 0.5) * 0.3);
    parts.push(c);
  }
  // Podstawa: mały odłamek, z którego wyrastają.
  const base = shardGeometry(seed ^ 0xBA5E, true);
  base.scale(0.42, 0.3, 0.42);
  base.translate(0, -0.4, 0);
  base.deleteAttribute('uv');
  for (const p of parts) p.deleteAttribute('uv');
  const g = mergeGeometries([...parts, base.index ? base.toNonIndexed() : base]);
  g.computeVertexNormals();
  return toUnitVolume(g);
}

// Kryształ krzemu: ośmiościan ścięty sześcianem, z odchyleniem — kanciasty blok.
function blockGeometry(seed) {
  const rng = mulberry32(seed);
  const pts = [];
  const k = [1, 0.75 + rng() * 0.3, 0.6 + rng() * 0.3];
  const push = (x, y, z) => pts.push(new THREE.Vector3((x + (rng() - 0.5) * 0.12) * k[0], (y + (rng() - 0.5) * 0.12) * k[1], (z + (rng() - 0.5) * 0.12) * k[2]));
  for (const s of [-1, 1]) { push(s, 0, 0); push(0, s, 0); push(0, 0, s); }
  const c = 0.55 + rng() * 0.12;
  for (const x of [-c, c]) for (const y of [-c, c]) for (const z of [-c, c]) push(x, y, z);
  return toUnitVolume(new ConvexGeometry(pts));
}

// ---------------------------------------------------------------------------

export class FragmentSet {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene pass gry
   * @param {object} o.shared uniformy skał (createRockShared; noise, volume, typeRow)
   * @param {import('./lights.js').LightGrid} o.grid
   */
  constructor({ scene, shared, grid, capacity = 512, renderOrder = 1 }) {
    this.S = shared;
    this.grid = grid;
    this.capacity = capacity;
    this.look = createCoreLookArray();
    this.material = this._buildMaterial();
    const builders = [
      (s) => shardGeometry(s),
      (s) => nuggetGeometry(s),
      (s) => crystalGeometry(s),
      (s) => blockGeometry(s)
    ];
    this.families = VARIANTS.map((n, f) => Array.from({ length: n }, (_, v) => {
      const base = builders[f](hash32(0xF4A6, f, v, 7));
      const data = new Float32Array(capacity * FLOATS);
      const buffer = new THREE.InstancedInterleavedBuffer(data, FLOATS, 1);
      buffer.setUsage(THREE.DynamicDrawUsage);
      const geo = new THREE.InstancedBufferGeometry();
      if (base.index) geo.setIndex(base.index);
      geo.setAttribute('position', base.getAttribute('position'));
      geo.setAttribute('normal', base.getAttribute('normal'));
      ['fA', 'fB', 'fC', 'fD'].forEach((name, k) => geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4)));
      geo.instanceCount = 0;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      mesh.visible = false;
      mesh.name = `fragments_${f}_${v}`;
      scene.add(mesh);
      return { data, buffer, geo, mesh, count: 0 };
    }));
    this.stats = { drawn: 0, core: 0, families: [0, 0, 0, 0] };
  }

  _buildMaterial() {
    const S = this.S;
    const grid = this.grid;
    const look = this.look;
    const mat = new THREE.NodeMaterial();
    mat.lights = false;
    mat.fog = false;
    mat.side = THREE.FrontSide;
    mat.transparent = false;
    mat.depthWrite = true;
    mat.depthTest = true;
    const vN = varyingProperty('vec3', 'vFragN');
    const vL = varyingProperty('vec3', 'vFragL');
    const vP = varyingProperty('vec3', 'vFragP');
    const vQ = varyingProperty('vec4', 'vFragQ');
    const vC = varyingProperty('vec4', 'vFragC');
    const vD = varyingProperty('vec4', 'vFragD');
    mat.positionNode = Fn(() => {
      const A = attribute('fA', 'vec4');
      const Q = attribute('fB', 'vec4');
      const L = positionGeometry.mul(A.w).toVar();
      const P = A.xyz.add(quatRotate(Q, L)).toVar();
      vN.assign(quatRotate(Q, normalGeometry));
      // Punkt w układzie odłamka w jednostkach świata: ziarno skały ma stałą wielkość
      // (odłamek 20 j. i 200 j. — ten sam przełom), jedzie z odłamkiem.
      vL.assign(L);
      vQ.assign(Q);
      vP.assign(P);
      vC.assign(attribute('fC', 'vec4'));
      vD.assign(attribute('fD', 'vec4'));
      return P;
    })();
    mat.fragmentNode = Fn(() => {
      const type = int(vC.x.add(0.5)).toVar();
      const isCore = vC.y.greaterThan(0.5);
      const seed = vC.z;
      const N0 = normalize(vN).toVar();
      const P = vP;
      // Szum w układzie odłamka: ziarno ~150 j., drobne ~45 j.
      const q1 = vL.div(150.0).add(vec3(seed.mul(3.1), seed.mul(1.7), 0.31)).toVar();
      const q2 = vL.div(45.0).add(vec3(0.21, seed.mul(5.3), 0.77)).toVar();
      const n1 = texture3D(S.noise, q1).level(0).toVar();
      const n2 = texture3D(S.noise, q2).level(0).toVar();
      // Relief przełomu: gradient drobnego szumu (fbm + komórki) w układzie odłamka → świat.
      const e = 1 / 64;
      const h0 = n2.r.add(n2.b.mul(0.5));
      const hx = texture3D(S.noise, q2.add(vec3(e, 0, 0))).level(0);
      const hy = texture3D(S.noise, q2.add(vec3(0, e, 0))).level(0);
      const hz = texture3D(S.noise, q2.add(vec3(0, 0, e))).level(0);
      const grad = quatRotate(vQ, vec3(hx.r.add(hx.b.mul(0.5)).sub(h0), hy.r.add(hy.b.mul(0.5)).sub(h0), hz.r.add(hz.b.mul(0.5)).sub(h0))).toVar();
      // Skorupa: świeży przełom (barwy typu jaśniej niż zwietrzały wierzch, jak wnętrze
      // skał), drobinki minerału rudy (~10%: wiersz a materiału skał).
      const grain = n1.r.mul(0.6).add(n2.r.mul(0.4));
      const crust = mix(S.typeRow(type, 1).rgb, S.typeRow(type, 0).rgb, smoothstep(0.3, 0.7, grain)).mul(n2.b.mul(0.3).add(0.85)).mul(1.45).toVar();
      const speck = smoothstep(0.8, 0.87, n2.g.mul(0.8).add(n1.a.mul(0.2))).toVar();
      const mineral = S.typeRow(type, 2).rgb.mul(1.2);
      const albedo = mix(crust, mineral, speck.mul(0.85)).toVar();
      const metal = speck.mul(S.typeRow(type, 7).z).mul(0.6).toVar();
      const gloss = mix(float(16.0), float(60.0), speck).toVar();
      const emit = mineral.mul(S.typeRow(type, 4).w).mul(speck).mul(0.35).toVar();
      const specK = float(0.05).toVar();
      const N = normalize(N0.sub(grad.mul(3.2))).toVar();
      // Rdzeń: materiałem rdzenia (coreLook.js) — relief słabszy (metal gładszy niż przełom skały).
      const cs = coreSurface(look, type, n1, n2, normalize(N0.sub(grad.mul(0.9))), n1.a);
      albedo.assign(select(isCore, cs.albedo, albedo));
      metal.assign(select(isCore, cs.metal, metal));
      gloss.assign(select(isCore, cs.gloss, gloss));
      emit.assign(select(isCore, cs.emit, emit));
      specK.assign(select(isCore, cs.specK, specK));
      N.assign(select(isCore, cs.N, N));
      // Światło: słońce (przesłanianie pola), otoczenie gasnące w mroku, światła siatki.
      const sunT = mix(float(1.0), vC.w, S.sunOcc).toVar();
      const fillK = mix(float(0.22), float(1.0), sunT).mul(float(1.0).sub(float(1.0).sub(sunT).mul(0.96))).toVar();
      const Vw = vec3(0.0, 0.0, 1.0);
      const ndl = dot(N, S.sunDir).toVar();
      const diff = S.sunColor.mul(sunT).mul(clamp(ndl.add(0.12).div(1.12), 0.0, 1.0)).toVar();
      const sk = metal.mul(0.8).add(0.05).add(specK).toVar();
      const spec = S.sunColor.mul(sunT).mul(pow(max(dot(N, normalize(S.sunDir.add(Vw))), 0.0), gloss)).mul(select(ndl.greaterThan(0.0), float(1.0), float(0.0))).mul(sk).toVar();
      const amb = S.ambientTop.mul(N.z.mul(0.25).add(0.75)).mul(fillK).toVar();
      grid.loop(P, ({ toL, att, col }) => {
        const c = col.mul(att).toVar();
        const nl = dot(N, toL);
        diff.addAssign(c.mul(clamp(nl.add(0.1).div(1.1), 0.0, 1.0)));
        spec.addAssign(c.mul(pow(max(dot(N, normalize(toL.add(Vw))), 0.0), gloss)).mul(select(nl.greaterThan(0.0), float(1.0), float(0.0))).mul(metal.mul(1.2).add(0.06).add(specK)));
      });
      const kd = float(1.0).sub(metal.mul(0.8));
      const col = albedo.mul(diff.add(amb)).mul(kd).add(spec.mul(mix(vec3(1.0), albedo, metal))).toVar();
      // Metal odbija otoczenie: słabe tło i blask słońca.
      const Rv = Vw.negate().add(N.mul(N.z.mul(2.0)));
      const glare = pow(max(dot(Rv, S.sunDir), 0.0), 6.0);
      col.addAssign(albedo.mul(S.ambientTop.mul(0.5).mul(fillK).add(S.sunColor.mul(0.35).mul(glare).mul(sunT))).mul(metal));
      col.addAssign(emit);
      // Żar po wybuchu (gaśnie): świecą brzegi i szczeliny, środek pokazuje materiał —
      // równa poświata całej bryły wyglądała jak płaska pomarańczowa plama.
      const heat = vD.x.toVar();
      const rim = pow(float(1.0).sub(abs(N0.z)), 1.5).mul(0.85).add(smoothstep(0.55, 0.8, n2.b).mul(0.3));
      col.addAssign(mix(vec3(1.4, 0.28, 0.04), vec3(3.0, 1.4, 0.45), heat.mul(heat)).mul(heat).mul(rim));
      // Pył ośrodka jak nad skałą (do stropu warstwy skał); świecący pył oświetla odłamek z góry.
      if (S.volume) {
        const v = S.volume.sample(vec3(P.xy, max(P.z, S.rockLayerTop))).toVar();
        const lit = albedo.mul(v.rgb).mul(S.fogLit).mul(clamp(N.z.mul(0.6).add(0.4), 0.0, 1.0));
        col.assign(col.add(lit).mul(v.a).add(v.rgb));
      }
      return vec4(max(col.mul(S.exposure), vec3(0.0)), 1.0);
    })();
    return mat;
  }

  /** Rodzina kształtu okrucha: skorupa — odłamek; rdzeń — wg materiału rdzenia. */
  static familyOf(p) {
    if (!p.core) return FRAGMENT_FAMILY.SHARD;
    const cm = CORE_MATERIAL[p.coreType];
    const kind = cm ? cm.kind : 'mineral';
    if (kind === 'metal' || kind === 'mineral') return FRAGMENT_FAMILY.NUGGET;
    if (kind === 'crystal') return p.coreType === 'silicon' ? FRAGMENT_FAMILY.BLOCK : FRAGMENT_FAMILY.CRYSTAL;
    return FRAGMENT_FAMILY.SHARD;
  }

  /**
   * @param {Array} pebbles okruchy fizyki (p, q, r, type, core, coreType, seed, gravel, age)
   * @param {object} f { originX, originY, zoom, sunT?(x, y) }
   */
  update(pebbles, f) {
    const ox = f.originX, oy = f.originY;
    const minR = 0.35 / Math.max(1e-6, f.zoom);
    for (const fam of this.families) for (const v of fam) v.count = 0;
    const st = this.stats;
    st.drawn = 0; st.core = 0;
    st.families[0] = st.families[1] = st.families[2] = st.families[3] = 0;
    for (let i = 0; i < pebbles.length; i++) {
      const p = pebbles[i];
      if (!p.alive || p.r < minR) continue;
      const fam = FragmentSet.familyOf(p);
      const list = this.families[fam];
      const V = list[(p.id >>> 0) % list.length];
      if (V.count >= this.capacity) continue;
      const d = V.data;
      const b = V.count++ * FLOATS;
      d[b] = p.p[0] - ox; d[b + 1] = p.p[1] + oy; d[b + 2] = p.p[2]; d[b + 3] = p.r;
      d[b + 4] = p.q[0]; d[b + 5] = p.q[1]; d[b + 6] = p.q[2]; d[b + 7] = p.q[3];
      const lookType = p.core ? (ROCK_TYPE_INDEX[p.coreType] ?? p.type) : p.type;
      d[b + 8] = lookType; d[b + 9] = p.core ? 1 : 0; d[b + 10] = p.seed || 0;
      d[b + 11] = f.sunT ? f.sunT(p.p[0], -p.p[1]) : 1;
      // Żar: żwir ze zmiażdżenia i kawałki rdzenia metalu / smółki rozgrzane wybuchem (widać je
      // w mroku, gasną). Lód paruje, a kryształ świeci sam — bez żaru.
      const age = p.age || 0;
      const hot = p.core ? HOT_CORE.has(CORE_MATERIAL[p.coreType]?.kind) : p.type !== ICE_TYPE;
      d[b + 12] = p.display || !hot ? 0 : p.gravel ? Math.max(0, 1 - age / 2.2) : p.core ? 0.8 * Math.max(0, 1 - age / 3) : 0;
      d[b + 13] = 0; d[b + 14] = 0; d[b + 15] = 0;
      st.drawn++;
      if (p.core) st.core++;
      st.families[fam]++;
    }
    for (const fam of this.families) {
      for (const V of fam) {
        V.geo.instanceCount = V.count;
        V.mesh.visible = V.count > 0;
        if (!V.count) continue;
        V.buffer.clearUpdateRanges();
        V.buffer.addUpdateRange(0, V.count * FLOATS);
        V.buffer.needsUpdate = true;
      }
    }
  }

  /** Wszystkie siatki (rozgrzewka / zrzuty). */
  meshes() {
    const out = [];
    for (const fam of this.families) for (const V of fam) out.push(V.mesh);
    return out;
  }
}
