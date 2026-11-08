// src/3d/warp/sparks.js
//
// DROBINY PRZYLOTU I ODLOTU NPC (WarpSparks) — jedna siatka w passie gry (warstwa 0, kamera ortho Core3D), JEDEN rysunek,
// bez compute i bez stanu na GPU. Receptury rekordów i opis: sparkRecipes.js (decyzja użytkownika 2026-11-08: drobiny
// „niewrażliwe” — tor każdej drobiny ze wzoru, nic jej nie popycha; więcej drobin; każdy okręt ma swoje).
//
//   instancja i → rekord i / K, drobina j = i mod K (K — drobin na rekord z opcji grafiki: sparksPerRecord);
//   rekordy pakowane co klatkę od zera (uniformArray, 9 vec4 na rekord) — liczba instancji = rekordy × K;
//   drobina → kwad-smuga od położenia w chwili (wiek − migawka) do położenia w chwili wiek (oba ze wzoru), szerokość
//   w świecie, nie mniej niż minPx na ekranie (widać ją też przy oddalonej kamerze), długość ≤ maxLenPx, energia
//   rozłożona na długość jak w ośrodku (1 / √(1 + L / normPx)).
// Pozycje względem kamery gry (mesh.position = kamera — modelViewMatrix w double, highPrecision), y w górę (scena).
// POD KADŁUBAMI (jak dawny ośrodek w passie warstwy 8): z = SPARK_Z pod płaszczyzną kadłubów z testem głębi — okręt, który
// po hamowaniu wjeżdża z pędem w swój snop, przykrywa drobiny (bez zapisu głębi, mieszanie One / One, alfa celu bez zmian).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, uniform, uniformArray, instanceIndex, hash, positionGeometry, varyingProperty,
  exp, sqrt, pow, max, min, clamp, mix, smoothstep, fract, step, sin, cos, length, abs, vec4
} from 'three/tsl';

/** Najwięcej rekordów emisji na klatkę (scena „Wojna”: ~45 okrętów, po 1–3 rekordy). */
export const SPARK_CAP = 128;
/** vec4 na rekord (układ — pack niżej). */
export const SPARK_STRIDE = 9;
/** Kolejność w liście przezroczystych passa ortho: przed błyskami warpa (sprites.js: GLOW_RENDER_ORDER 20). */
export const SPARK_RENDER_ORDER = 19;
/** Wysokość drobin: pod płaszczyzną kadłubów (skóry piszą głębię od z ≈ 0 w górę) — test głębi chowa je pod okrętem. */
export const SPARK_Z = -4;
/** K odniesienia — jasność drobiny × √(K_REF / K): więcej drobin = gęściej, niewiele jaśniej. */
export const SPARK_K_REF = 2048;

export const SPARK_VIEW = Object.freeze({
  shutter: 0.03,     // [s] migawka smugi
  minPx: 1.1,        // pół-szerokość smugi na ekranie — najmniej [px bufora]
  maxLenPx: 160,     // najdłuższa smuga [px]
  normPx: 26         // długość, od której smuga ciemnieje (energia rozłożona)
});

/**
 * Drobin na rekord z liczby drobin ośrodka w presecie grafiki (`warpParticles`: 400 tys. / 700 tys. / 1 mln — niski /
 * średni / wysoki i ultra): n / 256 w krokach 64, 1024…4096.
 */
export function sparksPerRecord(mediumCount) {
  const n = Number(mediumCount);
  const k = Number.isFinite(n) && n > 0 ? Math.round(n / 256 / 64) * 64 : 3904;
  return Math.max(1024, Math.min(4096, k));
}

export class WarpSparks {
  constructor(capacity = SPARK_CAP) {
    this.capacity = capacity;
    this.count = 0;
    this.K = sparksPerRecord(NaN);
    this.slots = uniformArray(Array.from({ length: capacity * SPARK_STRIDE }, () => new THREE.Vector4()), 'vec4')
      .setName('warpSparkSlots');
    this.U = {
      K: uniform(this.K, 'uint'),
      Kf: uniform(this.K),
      kGain: uniform(Math.sqrt(SPARK_K_REF / this.K)),
      zoom: uniform(0.1),
      shutter: uniform(SPARK_VIEW.shutter),
      minPx: uniform(SPARK_VIEW.minPx),
      maxLenPx: uniform(SPARK_VIEW.maxLenPx),
      normPx: uniform(SPARK_VIEW.normPx)
    };
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;
    this.material = buildSparkMaterial(this.slots, this.U);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = SPARK_RENDER_ORDER;
    this.mesh.name = 'warp:drobiny';
    this.mesh.visible = false;
    this.mesh.layers.set(0);
  }

  /** Drobin na rekord (opcje grafiki) — bez stanu, zmiana od następnej klatki. */
  setPerRecord(k) {
    const K = Math.max(64, Math.min(8192, Math.floor(Number(k) || this.K)));
    this.K = K;
    this.U.K.value = K;
    this.U.Kf.value = K;
    this.U.kGain.value = Math.sqrt(SPARK_K_REF / K);
  }

  /**
   * Rekordy klatki (frame.sparks — pozycje względem kamery, świat y w dół) → uniformy. Rekord dalej niż jego zasięg
   * od pudła kadru (hw, hh — pół-wymiary osi świata wokół kamery [j.], ≤ 0 — bez odcinania) nie zajmuje miejsca.
   */
  commit(frame, camX, camY, zoom, hw = 0, hh = 0) {
    const pool = frame.sparks;
    const A = this.slots.array;
    const cull = hw > 0 && hh > 0;
    let n = 0;
    for (let i = 0; i < pool.count && n < this.capacity; i++) {
      const r = pool.items[i];
      if (!(r.gain > 0.002)) continue;
      if (cull && (Math.abs(r.x) - r.reach > hw || Math.abs(r.y) - r.reach > hh)) continue;
      const o = n * SPARK_STRIDE;
      A[o].set(r.x, -r.y, r.dirX, -r.dirY);
      A[o + 1].set(r.mode, r.age, r.dist, r.cap);
      A[o + 2].set(r.T, r.p, r.back, r.W);
      A[o + 3].set(r.v0, r.v1, r.drag, r.carry);
      A[o + 4].set(r.ang, r.cone, r.ring, r.jit);
      A[o + 5].set(r.life0, r.life1, r.frac, r.seed);
      A[o + 6].set(r.c0[0], r.c0[1], r.c0[2], r.gain);
      A[o + 7].set(r.c1[0], r.c1[1], r.c1[2], r.size);
      A[o + 8].set(r.shape, r.R, r.swirl, 0);
      n++;
    }
    this.count = n;
    // liczba instancji ≥ K ≥ 64 albo siatka ukryta (przejście 1 ↔ > 1 przebudowuje potok)
    this.geo.instanceCount = n * this.K;
    this.mesh.visible = n > 0;
    if (!n) return;
    this.mesh.position.set(camX, -camY, 0);
    this.U.zoom.value = Math.max(1e-5, zoom);
  }

  warmupMeshes() {
    return [this.mesh];
  }
}

/** Materiał drobin: graf RAZ na moduł (wartości w uniformach i bloku rekordów). */
function buildSparkMaterial(S, U) {
  const mat = new THREE.NodeMaterial();
  mat.name = 'warp:drobiny';
  mat.transparent = true;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.lights = false;
  mat.fog = false;
  mat.forceSinglePass = true;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  mat.blendEquation = THREE.AddEquation;
  mat.blendEquationAlpha = THREE.AddEquation;

  const vCol = varyingProperty('vec3', 'vSparkCol');
  const vAlong = varyingProperty('float', 'vSparkAlong');
  const vSide = varyingProperty('float', 'vSparkSide');
  const vLen = varyingProperty('float', 'vSparkLen');
  const vW = varyingProperty('float', 'vSparkW');
  const TAU = 6.283185307;

  // Wierzchołki bez rozgałęzień (pułapka 39): oba tryby liczone, wybór maską 0 / 1, zmienne przypisane w miejscu.
  mat.positionNode = Fn(() => {
    const corner = positionGeometry.xy;                       // PlaneGeometry(1, 1): −0,5..0,5
    const rec = instanceIndex.div(U.K).toVar();
    const j = instanceIndex.sub(rec.mul(U.K)).toVar();
    const b = int(rec).mul(SPARK_STRIDE).toVar();
    const s0 = S.element(b).toVar();
    const s1 = S.element(b.add(1)).toVar();
    const s2 = S.element(b.add(2)).toVar();
    const s3 = S.element(b.add(3)).toVar();
    const s4 = S.element(b.add(4)).toVar();
    const s5 = S.element(b.add(5)).toVar();
    const s6 = S.element(b.add(6)).toVar();
    const s7 = S.element(b.add(7)).toVar();
    const s8 = S.element(b.add(8)).toVar();
    const seed = uint(s5.w).toVar();
    const hb = j.mul(uint(8)).bitXor(seed.mul(uint(0x9E3779B1))).toVar();
    const h0 = hash(hb).toVar();
    const h1 = hash(hb.add(uint(1))).toVar();
    const h2 = hash(hb.add(uint(2))).toVar();
    const h3 = hash(hb.add(uint(3))).toVar();
    const h4 = hash(hb.add(uint(4))).toVar();
    const h5 = hash(hb.add(uint(5))).toVar();
    const h6 = hash(hb.add(uint(6))).toVar();
    const h7 = hash(hb.add(uint(7))).toVar();
    const use = step(float(j).add(0.5), U.Kf.mul(s5.z)).toVar();

    const P = s0.xy.toVar();
    const dir = s0.zw.toVar();
    const perp = vec2(dir.y.negate(), dir.x).toVar();
    const age = s1.y.toVar();
    const dist = s1.z.toVar();
    const W = s2.w.toVar();
    const sh = U.shutter;

    // ── SHED: narodziny wzdłuż odcinka, lot z oporem ──
    const along = dist.mul(pow(h0, max(s8.x, 0.05))).toVar();
    const fracAl = along.div(max(dist, 1.0e-3)).toVar();
    const tb = s2.x.mul(pow(fracAl, max(s2.y, 0.05))).add(h1.mul(s4.w)).toVar();
    const aS = age.sub(tb).toVar();
    const life = mix(s5.x, s5.y, h2).toVar();
    const capOk = step(along, s1.w.add(1.0e-3));
    const aliveS = step(0.0, aS).mul(float(1.0).sub(step(life, aS))).mul(capOk).toVar();
    const inRing = float(1.0).sub(step(s4.z, h4)).toVar();
    const coneAbs = abs(s4.y).toVar();
    const both = float(1.0).sub(step(0.0, s4.y));
    const side = float(1.0).sub(both.mul(float(1.0).sub(step(0.5, h6))).mul(2.0)).toVar();
    const th = mix(s4.x.mul(side).add(h5.mul(2.0).sub(1.0).mul(coneAbs)), h5.mul(TAU), inRing).toVar();
    const ringK = mix(float(1.0), s8.y, inRing.mul(step(1.0e-4, s8.y)));
    const spd = mix(s3.x, s3.y, h7.mul(h7)).mul(ringK).toVar();
    const carryV = s3.w.mul(dist.div(max(s2.x, 1.0e-3))).toVar();
    const cth = cos(th);
    const sth = sin(th);
    const vel = vec2(dir.x.mul(cth).sub(dir.y.mul(sth)), dir.x.mul(sth).add(dir.y.mul(cth))).mul(spd).add(dir.mul(carryV)).toVar();
    const birth = P.add(dir.mul(along.sub(s2.z))).add(perp.mul(h3.sub(0.5).mul(2.0).mul(W))).toVar();
    const drag = max(s3.z, 0.01).toVar();
    const kH = drag.mul(float(1.0).sub(exp(max(aS, 0.0).div(drag).negate())));
    const kT = drag.mul(float(1.0).sub(exp(max(aS.sub(sh), 0.0).div(drag).negate())));
    const headS = birth.add(vel.mul(kH)).toVar();
    const tailS = birth.add(vel.mul(kT)).toVar();
    const q = clamp(aS.div(max(life, 1.0e-3)), 0.0, 1.0).toVar();
    const iS = aliveS.mul(smoothstep(0.0, 0.04, max(aS, 0.0))).mul(float(1.0).sub(q)).mul(float(1.0).sub(q)).toVar();

    // ── INFLOW: pętla spływu do punktu (z odcinka za nim albo z koła), z zawirowaniem ──
    const period = max(mix(s5.x, s5.y, h2), 0.05).toVar();
    const u = fract(age.div(period).add(h0)).toVar();
    const uT = max(u.sub(sh.div(period)), 0.0).toVar();
    const rr = s8.y.mul(h3.mul(0.4).add(0.6));
    const th2 = h5.mul(TAU);
    const sRing = vec2(cos(th2), sin(th2)).mul(rr);
    const sLine = dir.mul(dist.mul(h1).negate()).add(perp.mul(h3.sub(0.5).mul(2.0).mul(W)));
    const sRel = mix(sLine, sRing, inRing).toVar();
    const inflowAt = (uu) => {
      const ang = s8.z.mul(uu).mul(TAU).mul(inRing);   // zawirowanie tylko koła — nić płynie prosto
      const c = cos(ang);
      const s = sin(ang);
      return P.add(vec2(sRel.x.mul(c).sub(sRel.y.mul(s)), sRel.x.mul(s).add(sRel.y.mul(c))).mul(float(1.0).sub(uu)));
    };
    const headI = inflowAt(u).toVar();
    const tailI = inflowAt(uT).toVar();
    const iI = smoothstep(0.0, 0.15, u).mul(float(1.0).sub(smoothstep(0.85, 1.0, u))).mul(u.mul(0.65).add(0.35)).toVar();

    // ── wybór trybu, jasność, barwa ──
    const m = step(0.5, s1.x).toVar();
    const head = mix(headS, headI, m).toVar();
    const tail = mix(tailS, tailI, m).toVar();
    const I = mix(iS, iI, m).mul(use).mul(s6.w).mul(U.kGain).toVar();
    const col = mix(mix(s6.xyz, s7.xyz, q), mix(s7.xyz, s6.xyz, u), m).toVar();

    // ── kwad-smuga ──
    const d = head.sub(tail).toVar();
    const Lw = length(d).toVar();
    const has = step(1.0e-3, Lw).toVar();
    const dirS = d.div(max(Lw, 1.0e-3)).mul(has).add(dir.mul(float(1.0).sub(has))).toVar();
    const perpS = vec2(dirS.y.negate(), dirS.x);
    const zoom = max(U.zoom, 1.0e-5).toVar();
    const Lc = min(Lw, U.maxLenPx.div(zoom)).toVar();
    const wW = max(s7.w, U.minPx.div(zoom)).toVar();
    const alongQ = mix(wW.negate(), Lc.add(wW), corner.x.add(0.5)).toVar();
    const sideQ = corner.y.mul(2.0).mul(wW).toVar();
    const on = step(1.0e-4, I).toVar();
    const quad = head.sub(dirS.mul(Lc)).add(dirS.mul(alongQ)).add(perpS.mul(sideQ));
    const pos = head.add(quad.sub(head).mul(on));
    const norm = float(1.0).div(sqrt(float(1.0).add(Lc.mul(zoom).div(U.normPx))));
    vCol.assign(col.mul(I.mul(norm)));
    vAlong.assign(alongQ);
    vSide.assign(sideQ);
    vLen.assign(Lc);
    vW.assign(wW);
    return vec3(pos, SPARK_Z);
  })();

  mat.fragmentNode = Fn(() => {
    const da = max(max(vAlong.negate(), vAlong.sub(vLen)), 0.0);
    const d2 = da.mul(da).add(vSide.mul(vSide)).div(max(vW.mul(vW), 1.0e-6));
    const prof = exp(d2.mul(-2.3));
    const taper = mix(float(0.16), float(1.0), clamp(vAlong.div(max(vLen, 1.0e-3)), 0.0, 1.0));
    return vec4(vCol.mul(prof).mul(taper), 0.0);
  })();
  return mat;
}
