// ============================================================
// Iskry na powierzchni tarczy (compute). Pula pierścieniowa, narodziny zgłaszane
// z CPU (wzorzec iskier z dema/laser-webgpu.html). Większość iskier ŚLIZGA SIĘ
// po czaszy: prędkość styczna w płaszczyźnie kadłuba, wysokość co krok z profilu
// czaszy (r(θ) Catmull-Rom jak sampleShieldProfileRadius, z = h·(1 − t²)^0,62),
// tarcie i zsuwanie się po zboczu ku krawędzi; na krawędzi iskra odrywa się
// i leci dalej. Mniejszość od razu odlatuje w przestrzeń wzdłuż normalnej.
// Rysowane jako smugi wzdłuż prędkości (addytywnie, HDR, barwa tarczy → biel
// w rdzeniu). Klatka lokalna 3D grupy tarczy.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, float, int, vec2, vec3, vec4, instancedArray, instanceIndex, hash,
  Loop, If, select, uv, atan, cos, sin, sqrt, length, normalize, mix, smoothstep, saturate, exp,
  max, min, abs, pow, floor, fract, dot
} from 'three/tsl';
import { uDt, uTime } from './wspolne.js';

export const MAX_SPAWNS = 32;
const TWO_PI = Math.PI * 2;

// Klasy trafień gry (PRESETS z src/3d/shieldImpactFx.js) przeliczone na iskry:
// liczba ×6 (punkt zamiast wstęgi), prędkość w promieniach tarczy R jak w grze,
// dla ślizgu ×0,35 (po czaszy, nie w próżnię), życie dłuższe (iskra musi zdążyć zjechać).
export const SPARK_CLASS = {
  pd: { count: [5, 9], life: [0.10, 0.22], speed: [1.05, 2.10], fly: 0.35, heat: 0.8 },
  main: { count: [22, 34], life: [0.26, 0.52], speed: [1.15, 2.45], fly: 0.25, heat: 1.0 },
  special: { count: [80, 140], life: [0.65, 1.35], speed: [1.30, 3.00], fly: 0.2, heat: 1.35 },
  shield: { count: [55, 105], life: [0.50, 1.05], speed: [1.55, 3.20], fly: 0.15, heat: 1.15 }
};
export const SPARK_COUNT_SCALE = 6;

export function createSparks({ renderer, group, profile, domeHeight, U, pool = 65536, name = 's' }) {
  const N = pool;
  const pos = instancedArray(N, 'vec4');   // xyz, wiek
  const vel = instancedArray(N, 'vec4');   // prędkość, życie (> 0 ślizg, < 0 lot)
  const info = instancedArray(N, 'vec4');  // żar, grubość, ziarno, —
  const bins = instancedArray(new Float32Array(profile.bins), 'float');
  const NB = profile.binCount;

  const spA = Array.from({ length: MAX_SPAWNS }, () => new THREE.Vector4()); // x, y, z, liczba
  const spB = Array.from({ length: MAX_SPAWNS }, () => new THREE.Vector4()); // normalna xyz, start w puli
  const spC = Array.from({ length: MAX_SPAWNS }, () => new THREE.Vector4()); // v min, v max, życie min, max
  const spD = Array.from({ length: MAX_SPAWNS }, () => new THREE.Vector4()); // udział lotu, żar, grubość, rozrzut
  const uSpA = uniformArray(spA, 'vec4');
  const uSpB = uniformArray(spB, 'vec4');
  const uSpC = uniformArray(spC, 'vec4');
  const uSpD = uniformArray(spD, 'vec4');
  const uSpCount = uniform(0, 'int');
  const uSeed = uniform(0);
  const uDomeH = uniform(domeHeight);
  const uFric = uniform(2.0);       // tarcie ślizgu [1/s]
  const uSlope = uniform(1400);     // zsuwanie po zboczu [j./s²]
  const uDrag = uniform(2.4);       // opór lotu [1/s]
  const uGain = uniform(1);
  const uMinW = uniform(1);         // minimalna grubość smugi [j.] (~1 px)
  const uGroupRot = uniform(0);     // obrót grupy w świecie (kąt smugi na ekranie)

  // r(θ) — Catmull-Rom po binach profilu (jak sampleShieldProfileRadius).
  const profileR = Fn(([th]) => {
    const f = fract(th.div(TWO_PI)).mul(NB).toVar();
    const fi = floor(f);
    const u = f.sub(fi).toVar();
    const i1 = int(fi).mod(int(NB)).toVar();
    const p0 = bins.element(i1.add(int(NB - 1)).mod(int(NB)));
    const p1 = bins.element(i1);
    const p2 = bins.element(i1.add(int(1)).mod(int(NB)));
    const p3 = bins.element(i1.add(int(2)).mod(int(NB)));
    const u2 = u.mul(u), u3 = u2.mul(u);
    return p1.mul(2.0).add(p2.sub(p0).mul(u))
      .add(p0.mul(2.0).sub(p1.mul(5.0)).add(p2.mul(4.0)).sub(p3).mul(u2))
      .add(p0.negate().add(p1.mul(3.0)).sub(p2.mul(3.0)).add(p3).mul(u3)).mul(0.5);
  }).setLayout({ name: `profileR_${name}`, type: 'float', inputs: [{ name: 'th', type: 'float' }] });

  const step = Fn(() => {
    const idx = instanceIndex;
    const fi = float(idx).toVar();
    const p = pos.element(idx).toVar();
    const v = vel.element(idx).toVar();
    const inf = info.element(idx).toVar();

    // Narodziny: iskra w przedziale [start, start + liczba) któregoś zgłoszenia.
    Loop({ start: 0, end: uSpCount, type: 'int', condition: '<', name: 'sp' }, ({ sp }) => {
      const a = uSpA.element(sp);
      const b = uSpB.element(sp);
      const c = uSpC.element(sp);
      const d = uSpD.element(sp);
      const rel = fi.sub(b.w).add(N).mod(N);
      If(rel.lessThan(a.w), () => {
        const s = fi.add(uSeed);
        const h1 = hash(s.mul(3.0).add(1.0));
        const h2 = hash(s.mul(5.0).add(2.0));
        const h3 = hash(s.mul(7.0).add(3.0));
        const h4 = hash(s.mul(11.0).add(4.0));
        const h5 = hash(s.mul(13.0).add(5.0));
        const h6 = hash(s.mul(17.0).add(6.0));
        const speed = mix(c.x, c.y, h3.mul(h3));
        const life = mix(c.z, c.w, h4);
        const fly = h1.lessThan(d.x);
        // Lot: wzdłuż normalnej z rozrzutem.
        const rd = vec3(h2.mul(2.0).sub(1.0), h5.mul(2.0).sub(1.0), h6.mul(2.0).sub(1.0));
        const dirF = normalize(b.xyz.add(rd.mul(d.w)).add(vec3(0.0, 0.0, 0.25)));
        // Ślizg: styczna w płaszczyźnie — wachlarz w głąb czaszy i wzdłuż krawędzi.
        const ang = h2.mul(TWO_PI);
        const inward = normalize(a.xy.negate().add(vec2(0.0001, 0.0)));
        const dirS = normalize(vec2(cos(ang), sin(ang)).add(inward.mul(0.55)));
        const vFly = dirF.mul(speed.mul(1.25));
        const vSlide = vec3(dirS.mul(speed.mul(0.35)), 0.0);
        p.assign(vec4(a.xyz, 0.0));
        v.assign(vec4(select(fly, vFly, vSlide), select(fly, life.mul(0.7).negate(), life)));
        inf.assign(vec4(d.y, d.z.mul(h5.mul(0.6).add(0.7)), h6, 0.0));
      });
    });

    const lifeAbs = abs(v.w).toVar();
    If(p.w.lessThan(lifeAbs), () => {
      If(v.w.greaterThan(0.0), () => {
        // Ślizg po czaszy.
        const xy = p.xy.add(v.xy.mul(uDt)).toVar();
        const r = length(xy).toVar();
        const R = profileR(atan(xy.y.negate(), xy.x)).toVar();
        const t = r.div(max(R, 1.0)).toVar();
        If(t.greaterThanEqual(0.995), () => {
          // Krawędź: iskra odrywa się i leci dalej na zewnątrz.
          const out = xy.div(max(r, 0.001));
          v.assign(vec4(v.x.add(out.x.mul(160.0)), v.y.add(out.y.mul(160.0)), 90.0, lifeAbs.negate()));
          p.assign(vec4(xy, 1.0, p.w.add(uDt)));
        }).Else(() => {
          const q = max(float(1.0).sub(t.mul(t)), 0.0).toVar();
          const z = uDomeH.mul(pow(q, 0.62));
          // dz/dr ≈ −1,24·h·t·(1 − t²)^−0,38 / R — zbocze ciągnie iskrę ku krawędzi.
          const dzdr = uDomeH.mul(-1.24).mul(t).mul(pow(max(q, 0.02), -0.38)).div(max(R, 1.0));
          const g = xy.div(max(r, 0.001)).mul(dzdr);
          const acc = g.mul(uSlope.negate()).div(dot(g, g).add(1.0));
          const nv = v.xy.add(acc.mul(uDt)).mul(exp(uFric.negate().mul(uDt)));
          v.assign(vec4(nv, 0.0, v.w));
          p.assign(vec4(xy, z.add(1.5), p.w.add(uDt)));
        });
      }).Else(() => {
        // Lot w przestrzeni: opór, bez grawitacji.
        const nv = v.xyz.mul(exp(uDrag.negate().mul(uDt)));
        p.assign(vec4(p.xyz.add(nv.mul(uDt)), p.w.add(uDt)));
        v.assign(vec4(nv, v.w));
      });
    });
    pos.element(idx).assign(p);
    vel.element(idx).assign(v);
    info.element(idx).assign(inf);
  })().compute(N);

  // Render: smugi wzdłuż prędkości (sprite obrócony w płaszczyźnie ekranu = płaszczyźnie gry).
  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const a = pos.toAttribute();
  const b = vel.toAttribute();
  const c = info.toAttribute();
  const lifeT = abs(b.w);
  const life = saturate(a.w.div(max(lifeT, 0.001)));
  const alive = select(a.w.lessThan(lifeT), float(1.0), float(0.0));
  const speed = length(b.xyz);
  mat.positionNode = a.xyz;
  mat.rotationNode = atan(b.y, b.x).add(uGroupRot);
  const lenW = max(speed.mul(0.024), 5.0);
  const width = max(c.y.mul(mix(float(1.0), float(0.45), life)), uMinW);
  mat.scaleNode = vec2(lenW.add(uMinW.mul(2.0)), width).mul(alive);
  const fade = life.oneMinus();
  const lColor = mix(vec3(1.0, 0.08, 0.04), U.color, U.life);
  const q = uv().sub(0.5).mul(2.0);
  const core = exp(q.y.mul(q.y).mul(-26.0));
  const heatCol = mix(vec3(3.9, 4.1, 4.4), lColor.mul(2.3), smoothstep(0.0, 0.55, life));
  const col = mix(heatCol, vec3(4.4), core.mul(0.5)).mul(fade.mul(fade)).mul(c.x);
  const mask = exp(q.x.mul(q.x).mul(-2.2).add(q.y.mul(q.y).mul(-7.0)));
  mat.colorNode = col.mul(mask).mul(uGain);
  const sprite = new THREE.Sprite(mat);
  sprite.count = N;
  sprite.frustumCulled = false;
  sprite.renderOrder = 12;
  sprite.visible = false;
  group.add(sprite);

  // CPU: kursor puli, zgłoszenia tej klatki, szacunek żywych iskier (rekordy narodzin).
  const REC = 512;
  const recCount = new Int32Array(REC);
  const recEnd = new Float32Array(REC).fill(-1);
  let recIdx = 0;
  let cursor = 0;
  let spawnCount = 0;
  let liveUntil = -1;
  let pending = false;

  const api = {
    sprite, uGain, uMinW, uGroupRot, uFric, uSlope,
    pool: N,
    live: 0,
    // Zgłoszenie narodzin: punkt (lokalnie 3D), normalna na zewnątrz, liczba,
    // prędkość [j./s], życie [s], udział lotu, żar (jasność), grubość [j.], rozrzut.
    spawn(x, y, z, nx, ny, nz, count, vmin, vmax, lmin, lmax, flyFrac, heat, width, spread, time) {
      if (spawnCount >= MAX_SPAWNS) return 0;
      const n = Math.min(Math.floor(count), N >> 2);
      if (n <= 0) return 0;
      const i = spawnCount++;
      spA[i].set(x, y, z, n);
      spB[i].set(nx, ny, nz, cursor);
      spC[i].set(vmin, vmax, lmin, lmax);
      spD[i].set(flyFrac, heat, width, spread);
      cursor = (cursor + n) % N;
      recCount[recIdx] = n;
      recEnd[recIdx] = time + lmax;
      recIdx = (recIdx + 1) % REC;
      if (time + lmax + 0.1 > liveUntil) liveUntil = time + lmax + 0.1;
      pending = true;
      return n;
    },
    // Iskry klasy trafienia gry w punkt obrysu (lx, ly — lokalnie 3D, z — wysokość na czaszy).
    spawnClass(cls, lx, ly, z, R, power, mult, time) {
      const k = SPARK_CLASS[cls] || SPARK_CLASS.main;
      const count = (k.count[0] + Math.random() * (k.count[1] - k.count[0])) * SPARK_COUNT_SCALE * mult * (0.62 + 0.38 * power);
      const r = Math.hypot(lx, ly) || 1;
      const nx = lx / r, ny = ly / r;
      return this.spawn(lx, ly, z, nx, ny, 0.35, count,
        k.speed[0] * R * (0.7 + 0.3 * power), k.speed[1] * R * (0.7 + 0.3 * power),
        k.life[0] * 1.6, k.life[1] * 1.8, k.fly, k.heat, 2.4 + 1.6 * power, 0.9, time);
    },
    update(time) {
      let live = 0;
      for (let i = 0; i < REC; i++) if (recEnd[i] > time) live += recCount[i];
      this.live = Math.min(N, live);
      sprite.visible = time < liveUntil;
    },
    compute(time) {
      if (time >= liveUntil && !pending) { spawnCount = 0; return; }
      uSpCount.value = spawnCount;
      uSeed.value = Math.floor(Math.random() * 1e6);
      renderer.compute(step);
      spawnCount = 0;
      pending = false;
    },
    clear() { liveUntil = -1; recEnd.fill(-1); this.live = 0; sprite.visible = false; }
  };
  return api;
}
