// dema/asteroidy-webgpu/dust.js
//
// FIZYCZNY PYŁ: setki tysięcy – miliony drobin liczonych na GPU (compute).
//
// Stan w buforach storage (pozycja + ziarno, prędkość, barwa po oświetleniu),
// pojemność 2²¹ drobin przydzielona raz; aktywna liczba to zakres dispatchu.
// Obszar: pudło wokół kamery (XY ~1,2× kadru przy najmniejszym zoomie, warstwa
// w Z od −600 do +400 wokół płaszczyzny gry). Drobina, która wyjdzie z pudła,
// wraca po drugiej stronie z prędkością tła (dryf) — pole wydaje się
// nieskończone, a zaburzenia się nie teleportują.
//
// Krok stały 1/120 s (do 4 kroków na klatkę), siły:
//   • dryf: pole bezdywergencyjne z funkcji prądu (rotacja 2D), słabe
//     tłumienie ciągnie drobiny do prędkości tła — pole uspokaja się po
//     zaburzeniu;
//   • dysze: stożek za każdą dyszą MAIN, drobiny dociągane do prędkości strugi
//     (prędkość statku + wylot) proporcjonalnie do ciągu;
//   • kadłuby: pole odległości sylwetki (ship.js) — wypchnięcie na powierzchnię,
//     odbicie składowej normalnej względem ruchu kadłuba, poślizg wzdłuż burty;
//   • skały: kule skał gry z siatki komórek (CPU → bufor co klatkę), odbicie
//     z tłumieniem i tarciem;
//   • wybuchy: fala uderzeniowa ze skończoną prędkością, impuls na froncie;
//   • pociski: ślad — drobiny odpychane od odcinka lotu w danym kroku.
//
// Oświetlenie: osobny przebieg compute raz na klatkę — słońce (transmitancja
// pola z mapy wokół pudła), otoczenie i WSZYSTKIE światła siatki (lights.js),
// z funkcją fazy Henyeya–Greensteina (jaśniej patrząc pod światło). Drobiny
// poza kadrem dostają zero i nie rysują się (zerowy rozmiar).
//
// Render: instancjonowane kwady w passie gry. Pod płaszczyzną rzut jak skały
// gry (ortho — pył opływa skały dokładnie tam, gdzie je widać), NAD
// płaszczyzną paralaksa kamery perspektywicznej tła (drobiny bliżej kamery
// przesuwają się szybciej i rosną), z zanikiem tuż przy kamerze.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, instancedArray, attributeArray,
  instanceIndex, texture, positionGeometry, uv, varyingProperty, hash, Loop, If, Return,
  select, mix, smoothstep, clamp, floor, abs, exp, sin, cos, pow, min, max, dot, length
} from 'three/tsl';

export const DUST_CAP = 1 << 21;
export const NOZZLE_CAP = 16;
export const HULL_CAP = 2;
export const EXPLOSION_CAP = 8;
export const SHOT_CAP = 16;
const ROCK_CAP = 8192;
const RG_NX = 48;
const RG_NY = 32;
const ROCK_ITEM_CAP = 1 << 16;

export const DUST_DEFAULTS = Object.freeze({
  zLo: -600,
  zHi: 400,
  step: 1 / 120,
  maxSteps: 4,
  damping: 0.55,          // [1/s] ciągnięcie do prędkości tła
  driftSpeed: 14,         // [j./s] prędkość tła
  jetSpeed: 3200,         // [j./s] prędkość strugi względem dyszy
  jetLength: 2600,        // [j.] zasięg strugi przy pełnym ciągu
  hullHalfZ: 110,         // [j.] grubość kadłuba dla pyłu
  blast: 42000,           // przyspieszenie na froncie fali (× moc)
  blastSpeed: 2600,       // [j./s] prędkość frontu
  shotRadius: 70,
  restitution: 0.35,
  friction: 0.25,
  albedo: 0.55,
  phaseG: 0.35,
  speckGain: 1.0,
  puffGain: 0.1,
  puffShare: 0.12
});

// Fale funkcji prądu dryfu: [kx, ky, ω, amplituda (× driftSpeed)].
const DRIFT_WAVES = [
  [1 / 3100, 1 / 4700, 0.07, 1.0],
  [-1 / 2300, 1 / 1900, 0.11, 0.6],
  [1 / 1500, -1 / 2600, 0.17, 0.35]
];

function hg(g) {
  // Henyey–Greenstein znormalizowany do 1 dla rozpraszania izotropowego.
  return (cosT) => {
    const g2 = g * g;
    return (1 - g2) / Math.pow(1 + g2 - 2 * g * cosT, 1.5);
  };
}

export class PhysicalDust {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {THREE.Scene} o.scene pass gry (kamera ortho)
   * @param {import('./lights.js').LightGrid} o.grid siatka świateł
   * @param {THREE.Texture[]} o.sdfTextures pola odległości kadłubów (HULL_CAP)
   */
  constructor({ renderer, scene, grid, sdfTextures, sunMap }) {
    this.renderer = renderer;
    this.grid = grid;
    this.cfg = { ...DUST_DEFAULTS };
    this.count = 0;
    this.enabled = true;
    this._acc = 0;
    this.stats = { steps: 0, rocks: 0, rockItems: 0 };

    this.pos = instancedArray(DUST_CAP, 'vec4').setName('dustPos');
    this.vel = instancedArray(DUST_CAP, 'vec4').setName('dustVel');
    this.col = instancedArray(DUST_CAP, 'vec4').setName('dustCol');

    // Siatka skał (kule) dla kolizji: dane co klatkę z warstwy skał gry.
    this.rockNode = attributeArray(ROCK_CAP, 'vec4').setName('dustRocks');
    this.rockCellNode = attributeArray(RG_NX * RG_NY, 'uvec2').setName('dustRockCells');
    this.rockItemNode = attributeArray(ROCK_ITEM_CAP, 'uint').setName('dustRockItems');
    this._rockCounts = new Uint32Array(RG_NX * RG_NY);
    this._rockBox = new Int16Array(ROCK_CAP * 4);

    // Mapa transmitancji słońca nad kadrem (sunMap.js, wspólna z mgłą).
    this.sunMap = sunMap;

    const v4 = (n) => uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4');
    this.U = {
      count: uniform(0, 'uint'),
      initStart: uniform(0, 'uint'),
      initCount: uniform(0, 'uint'),
      seedBase: uniform(0, 'uint'),
      dt: uniform(1 / 120),
      dampK: uniform(0),
      time: uniform(0),
      boxCenter: uniform(new THREE.Vector2()),
      boxHalf: uniform(new THREE.Vector2(3000, 2000)),
      zLo: uniform(this.cfg.zLo),
      zHi: uniform(this.cfg.zHi),
      driftSpeed: uniform(this.cfg.driftSpeed),
      driftPhase: uniform(new THREE.Vector3()),
      shift: uniform(new THREE.Vector2()),
      nozCount: uniform(0, 'int'),
      nozA: v4(NOZZLE_CAP),       // xyz dysza (scena), w promień wylotu
      nozB: v4(NOZZLE_CAP),       // xy oś strugi, z prędkość strugi, w długość
      nozC: v4(NOZZLE_CAP),       // xy prędkość statku (scena), z moc 0..1+
      hullA: v4(HULL_CAP),        // xy środek, z cos, w sin (obrót sceny)
      hullB: v4(HULL_CAP),        // xy wymiar pola SDF [j.], z pół-grubość, w aktywny
      hullC: v4(HULL_CAP),        // xy prędkość (scena), z prędkość kątowa (scena)
      expA: v4(EXPLOSION_CAP),    // xyz środek, w wiek [s]
      expB: v4(EXPLOSION_CAP),    // x moc, y prędkość frontu, z szerokość, w aktywny
      shotA: v4(SHOT_CAP),        // xyz początek odcinka, w promień
      shotB: v4(SHOT_CAP),        // xyz koniec odcinka, w siła (0 = pusty)
      blast: uniform(this.cfg.blast),
      restitution: uniform(this.cfg.restitution),
      friction: uniform(this.cfg.friction),
      hullHalfZ: uniform(this.cfg.hullHalfZ),
      rockOrigin: uniform(new THREE.Vector2()),
      rockInvCell: uniform(new THREE.Vector2(1, 1)),
      // Oświetlenie i rzut.
      camXY: uniform(new THREE.Vector2()),
      camZ: uniform(1700),
      zoom: uniform(1),
      viewHalf: uniform(new THREE.Vector2(960, 540)),
      sunCol: uniform(new THREE.Vector3(1.9, 1.8, 1.67)),
      sunPhase: uniform(1),
      sunOcc: uniform(1),
      ambient: uniform(new THREE.Vector3(0.02, 0.022, 0.028)),
      albedo: uniform(this.cfg.albedo),
      brightness: uniform(1),
      phaseG: uniform(this.cfg.phaseG),
      speckGain: uniform(this.cfg.speckGain),
      puffGain: uniform(this.cfg.puffGain),
      puffShare: uniform(this.cfg.puffShare),
      pxMin: uniform(1.3),
      lightOn: uniform(1)
    };
    this._sdf = sdfTextures;
    this._buildCompute();
    this._buildRender(scene);
  }

  // --- TSL -----------------------------------------------------------------

  /** Prędkość tła: rotacja funkcji prądu (bez źródeł) + słabe falowanie w z. */
  _drift(p) {
    const U = this.U;
    const v = vec3(0).toVar();
    DRIFT_WAVES.forEach((w, k) => {
      const [kx, ky, om, amp] = w;
      const ph = k === 0 ? U.driftPhase.x : (k === 1 ? U.driftPhase.y : U.driftPhase.z);
      const arg = p.x.mul(kx).add(p.y.mul(ky)).add(U.time.mul(om)).add(ph);
      // ψ = a sin(arg): v = (∂ψ/∂y, −∂ψ/∂x) = a cos(arg) (ky, −kx), znormalizowane skalą fali.
      const c = cos(arg).mul(amp);
      const kl = Math.hypot(kx, ky);
      v.addAssign(vec3(c.mul(ky / kl), c.mul(-kx / kl), sin(arg.mul(0.7).add(1.3)).mul(amp * 0.25)));
    });
    return v.mul(U.driftSpeed);
  }

  /** Paralaksa nad płaszczyzną (kamera tła), 1 pod płaszczyzną. */
  _parallax(z) {
    const U = this.U;
    return select(z.greaterThan(0.0), U.camZ.div(max(U.camZ.sub(z), U.camZ.mul(0.25))), float(1.0));
  }

  _kindOf(seed) {
    return select(seed.lessThan(this.U.puffShare), float(1.0), float(0.0));
  }

  _sizeOf(seed, kind) {
    const f = seed.mul(13.7).fract();
    const speck = f.mul(f).mul(2.6).add(1.7);
    const puff = seed.mul(5.3).fract().mul(34.0).add(16.0);
    return mix(speck, puff, kind);
  }

  _buildCompute() {
    const U = this.U;
    const pos = this.pos;
    const vel = this.vel;
    const col = this.col;
    const cfg = this.cfg;

    // Inicjalizacja zakresu [initStart, initStart + initCount).
    this.initNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.initCount), () => { Return(); });
      const i = instanceIndex.add(U.initStart).toVar();
      const s = i.add(U.seedBase.mul(uint(0x9E3779B1))).toVar();
      const h1 = hash(s);
      const h2 = hash(s.bitXor(uint(0x68E31DA4)));
      const h3 = hash(s.bitXor(uint(0xB5297A4D)));
      const h4 = hash(s.bitXor(uint(0x1B56C4E9)));
      const p = vec3(
        U.boxCenter.x.add(h1.sub(0.5).mul(2.0).mul(U.boxHalf.x)),
        U.boxCenter.y.add(h2.sub(0.5).mul(2.0).mul(U.boxHalf.y)),
        mix(U.zLo, U.zHi, h3)
      ).toVar();
      pos.element(i).assign(vec4(p, h4));
      vel.element(i).assign(vec4(this._drift(p), 0.0));
      col.element(i).assign(vec4(0.0));
    })().compute(DUST_CAP).setName('dustInit');

    // Przesunięcie żywych danych przy zmianie lokalnego początku sceny.
    this.shiftNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const e = pos.element(instanceIndex);
      e.assign(vec4(e.xy.add(U.shift), e.z, e.w));
    })().compute(DUST_CAP).setName('dustShift');

    // Krok symulacji.
    const sdf0 = this._sdf[0];
    const sdf1 = this._sdf[1] || this._sdf[0];
    this.stepNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const P = pos.element(instanceIndex).toVar();
      const V = vel.element(instanceIndex).toVar();
      const p = P.xyz.toVar();
      const v = V.xyz.toVar();
      const seed = P.w.toVar();

      // Dryf i tłumienie: pole wraca do prędkości tła.
      const vd = this._drift(p).toVar();
      v.addAssign(vd.sub(v).mul(U.dampK));

      // Dysze: stożek za dyszą, dociąganie do prędkości strugi.
      Loop(U.nozCount, ({ i }) => {
        const A = U.nozA.element(i).toVar();
        const B = U.nozB.element(i).toVar();
        const C = U.nozC.element(i).toVar();
        const axis = vec3(B.x, B.y, 0.0);
        const rel = p.sub(A.xyz).toVar();
        const along = dot(rel, axis).toVar();
        If(along.greaterThan(0.0).and(along.lessThan(B.w)), () => {
          const radialV = rel.sub(axis.mul(along)).toVar();
          const radial = length(radialV).toVar();
          const coneR = A.w.mul(1.4).add(along.mul(0.2)).toVar();
          If(radial.lessThan(coneR), () => {
            const t = float(1.0).sub(radial.div(coneR));
            const fall = t.mul(t).mul(exp(along.div(B.w).mul(-2.4))).toVar();
            const vJet = vec3(C.x, C.y, 0.0).add(axis.mul(B.z)).add(radialV.div(max(radial, 1.0)).mul(B.z.mul(0.12)));
            const k = min(fall.mul(C.z).mul(U.dt).mul(16.0), 1.0);
            v.addAssign(vJet.sub(v).mul(k));
          });
        });
      });

      // Wybuchy: fala uderzeniowa, impuls na froncie (maleje z promieniem).
      Loop(EXPLOSION_CAP, ({ i }) => {
        const A = U.expA.element(i).toVar();
        const B = U.expB.element(i).toVar();
        If(B.w.greaterThan(0.5), () => {
          const d = p.sub(A.xyz).toVar();
          const dist = length(d).toVar();
          const front = B.y.mul(A.w).toVar();
          const x = dist.sub(front).div(B.z);
          const shell = exp(x.mul(x).negate());
          const a = U.blast.mul(B.x).mul(shell).div(front.div(650.0).add(1.0));
          v.addAssign(d.div(max(dist, 1.0)).mul(a).mul(U.dt));
        });
      });

      // Pociski: odpychanie od odcinka lotu w tym kroku (ślad w pyle).
      Loop(SHOT_CAP, ({ i }) => {
        const A = U.shotA.element(i).toVar();
        const B = U.shotB.element(i).toVar();
        If(B.w.greaterThan(0.0), () => {
          const ab = B.xyz.sub(A.xyz).toVar();
          const t = clamp(dot(p.sub(A.xyz), ab).div(max(dot(ab, ab), 1e-3)), 0.0, 1.0);
          const q = p.sub(A.xyz.add(ab.mul(t))).toVar();
          const dist = length(q).toVar();
          If(dist.lessThan(A.w), () => {
            const f = float(1.0).sub(dist.div(A.w));
            const push = q.div(max(dist, 1.0)).mul(f.mul(f).mul(B.w).mul(450.0));
            const drag = ab.div(max(length(ab), 1e-3)).mul(f.mul(B.w).mul(150.0));
            v.addAssign(push.add(drag));
          });
        });
      });

      p.addAssign(v.mul(U.dt));

      // Skały: kule z siatki komórek.
      const c = floor(p.xy.sub(U.rockOrigin).mul(U.rockInvCell)).toVar();
      If(c.x.greaterThanEqual(0.0).and(c.y.greaterThanEqual(0.0)).and(c.x.lessThan(RG_NX)).and(c.y.lessThan(RG_NY)), () => {
        const range = this.rockCellNode.element(int(c.y).mul(RG_NX).add(int(c.x))).toVar();
        Loop({ start: range.x, end: range.x.add(range.y), type: 'uint', condition: '<' }, ({ i }) => {
          const R = this.rockNode.element(this.rockItemNode.element(i)).toVar();
          const d = p.sub(R.xyz).toVar();
          const dist = length(d).toVar();
          If(dist.lessThan(R.w), () => {
            const n = d.div(max(dist, 1e-3)).toVar();
            p.assign(R.xyz.add(n.mul(R.w.add(0.5))));
            const vn = dot(v, n).toVar();
            If(vn.lessThan(0.0), () => {
              const vt = v.sub(n.mul(vn));
              v.assign(vt.mul(float(1.0).sub(U.friction)).sub(n.mul(vn.mul(U.restitution))));
            });
          });
        });
      });

      // Kadłuby: pole odległości sylwetki.
      [sdf0, sdf1].forEach((sdfTex, h) => {
        const A = U.hullA.element(h);
        const B = U.hullB.element(h);
        const C = U.hullC.element(h);
        If(B.w.greaterThan(0.5).and(abs(p.z).lessThan(B.z)), () => {
          const dx = p.x.sub(A.x);
          const dy = p.y.sub(A.y);
          // Lokalny układ kadłuba (x = dziób, y = w górę tekstury).
          const lx = dx.mul(A.z).add(dy.mul(A.w));
          const ly = dx.mul(A.w).negate().add(dy.mul(A.z));
          const u = lx.div(B.x).add(0.5);
          const w = ly.div(B.y).add(0.5);
          If(u.greaterThan(0.0).and(u.lessThan(1.0)).and(w.greaterThan(0.0)).and(w.lessThan(1.0)), () => {
            const s = texture(sdfTex, vec2(u, w)).level(0).toVar();
            const margin = float(6.0);
            If(s.x.lessThan(margin), () => {
              const gl = vec2(s.y, s.z);
              const gLen = max(length(gl), 1e-4);
              const nl = gl.div(gLen);
              // Normalna do sceny (obrót kadłuba).
              const n = vec3(nl.x.mul(A.z).sub(nl.y.mul(A.w)), nl.x.mul(A.w).add(nl.y.mul(A.z)), 0.0).toVar();
              p.addAssign(n.mul(margin.sub(s.x)));
              // Ruch kadłuba w punkcie: v_c + ω × r.
              const vh = vec3(C.x.sub(C.z.mul(dy)), C.y.add(C.z.mul(dx)), 0.0).toVar();
              const vr = v.sub(vh).toVar();
              const vn = dot(vr, n).toVar();
              If(vn.lessThan(0.0), () => {
                const vt = vr.sub(n.mul(vn));
                v.assign(vh.add(vt.mul(0.92)).sub(n.mul(vn.mul(0.3))));
              });
            });
          });
        });
      });

      // Zawinięcie pudła: drobina wraca po drugiej stronie z prędkością tła.
      const rel = p.xy.sub(U.boxCenter).toVar();
      const out = abs(rel.x).greaterThan(U.boxHalf.x).or(abs(rel.y).greaterThan(U.boxHalf.y)).or(p.z.lessThan(U.zLo)).or(p.z.greaterThan(U.zHi));
      If(out, () => {
        const span = U.boxHalf.mul(2.0);
        const wrapped = rel.sub(span.mul(floor(rel.add(U.boxHalf).div(span))));
        const zs = U.zHi.sub(U.zLo);
        const zr = p.z.sub(U.zLo);
        p.assign(vec3(U.boxCenter.add(wrapped), U.zLo.add(zr.sub(zs.mul(floor(zr.div(zs)))))));
        v.assign(this._drift(p));
      });

      pos.element(instanceIndex).assign(vec4(p, seed));
      vel.element(instanceIndex).assign(vec4(v, V.w));
    })().compute(DUST_CAP).setName('dustStep');

    // Oświetlenie drobin (raz na klatkę).
    const grid = this.grid;
    this.lightNode = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const P = pos.element(instanceIndex).toVar();
      const p = P.xyz.toVar();
      const seed = P.w.toVar();
      const kind = this._kindOf(seed).toVar();
      const k = this._parallax(p.z).toVar();
      const sp = p.xy.sub(U.camXY).mul(k).toVar();
      const size = this._sizeOf(seed, kind).mul(k);
      const inView = abs(sp.x).lessThan(U.viewHalf.x.add(size)).and(abs(sp.y).lessThan(U.viewHalf.y.add(size)));
      // Zanik tuż przy kamerze (nad płaszczyzną) i przy dnie warstwy.
      const near = float(1.0).sub(smoothstep(U.camZ.mul(0.55), U.camZ.mul(0.72), p.z));
      const bottom = smoothstep(U.zLo, U.zLo.add(120.0), p.z);
      const top = float(1.0).sub(smoothstep(U.zHi.sub(120.0), U.zHi, p.z));
      const fade = near.mul(bottom).mul(top).toVar();
      If(inView.not().or(fade.lessThan(0.002)).or(U.lightOn.lessThan(0.5)), () => {
        col.element(instanceIndex).assign(vec4(0.0));
        Return();
      });
      // Słońce: transmitancja pola z mapy nad pudłem.
      const muv = clamp(p.xy.sub(this.sunMap.origin).mul(this.sunMap.invSize), 0.0, 1.0);
      const T = mix(float(1.0), texture(this.sunMap.texture, muv).level(0).r, U.sunOcc).toVar();
      const fill = mix(float(0.22), float(1.0), T).mul(float(1.0).sub(float(1.0).sub(T).mul(0.92)));
      const acc = U.sunCol.mul(T).mul(U.sunPhase).add(U.ambient.mul(fill)).toVar();
      // Światła siatki: funkcja fazy HG (widok z góry: kierunek do kamery +z).
      const g = U.phaseG;
      const g2 = g.mul(g);
      grid.loop(p, ({ toL, att, col: lc, scatter }) => {
        const cosT = toL.z.negate();
        const ph = float(1.0).sub(g2).div(pow(max(g2.add(1.0).sub(g.mul(2.0).mul(cosT)), 1e-4), 1.5));
        acc.addAssign(lc.mul(att).mul(scatter).mul(ph));
      });
      const gain = mix(U.speckGain, U.puffGain, kind);
      const c = acc.mul(U.albedo).mul(U.brightness).mul(gain).mul(fade);
      col.element(instanceIndex).assign(vec4(min(c, vec3(64.0)), fade));
    })().compute(DUST_CAP).setName('dustLight');
  }

  _buildRender(scene) {
    const U = this.U;
    const pos = this.pos;
    const col = this.col;
    const vCol = varyingProperty('vec3', 'vDustCol');
    const vKind = varyingProperty('float', 'vDustKind');
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = Fn(() => {
      const P = pos.element(instanceIndex).toVar();
      const C = col.element(instanceIndex).toVar();
      const p = P.xyz;
      const seed = P.w;
      const kind = this._kindOf(seed).toVar();
      const k = this._parallax(p.z).toVar();
      const center = vec3(U.camXY.add(p.xy.sub(U.camXY).mul(k)), p.z);
      const px = this._sizeOf(seed, kind).mul(U.zoom).mul(k).toVar();
      const maxPx = mix(float(9.0), float(140.0), kind);
      const pxC = clamp(px, U.pxMin, maxPx).toVar();
      // Drobina mniejsza od piksela: stały rozmiar, jasność ~ powierzchnia.
      const energy = min(px.div(pxC), 1.0);
      vCol.assign(C.rgb.mul(energy.mul(energy)));
      vKind.assign(kind);
      const on = select(C.a.greaterThan(0.0005), float(1.0), float(0.0));
      return center.add(vec3(positionGeometry.xy.mul(pxC.div(U.zoom).mul(on)), 0.0));
    })();
    mat.fragmentNode = Fn(() => {
      const q = uv().sub(0.5).mul(2.0);
      const r2 = dot(q, q);
      const speck = exp(r2.mul(-4.2));
      const puff = exp(r2.mul(-2.4)).mul(float(1.0).sub(smoothstep(0.55, 1.0, r2)));
      const prof = mix(speck, puff, vKind);
      return vec4(vCol.mul(prof), 0.0);
    })();
    this.material = mat;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.name = 'dust';
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  // --- CPU -----------------------------------------------------------------

  /** Aktywna liczba drobin; nowe dostają świeży stan w pudle. */
  setCount(n) {
    const target = Math.max(0, Math.min(DUST_CAP, Math.floor(n)));
    if (target > this.count) this._init(this.count, target - this.count);
    this.count = target;
    this.U.count.value = target;
    this.mesh.count = target;
  }

  reset() {
    const n = this.count;
    this._seed = (this._seed || 0) + 1;
    this._init(0, n);
  }

  _init(start, n) {
    if (n <= 0) return;
    const U = this.U;
    U.initStart.value = start;
    U.initCount.value = n;
    U.seedBase.value = this._seed || 0;
    this.renderer.compute(this.initNode, n);
  }

  /** Nowy lokalny początek: przesunięcie w scenie o (sx, sy). */
  shift(sx, sy) {
    if (!this.count) return;
    this.U.shift.value.set(sx, sy);
    this.renderer.compute(this.shiftNode, this.count);
  }

  /** Faza dryfu z początku sceny (double na CPU — sin(k · 6 mln) we float32 się rozpada). */
  setOriginPhase(ox, oy) {
    const two = Math.PI * 2;
    const ph = DRIFT_WAVES.map(([kx, ky]) => {
      const a = kx * ox + ky * (-oy);
      return a - Math.floor(a / two) * two;
    });
    this.U.driftPhase.value.set(ph[0], ph[1], ph[2]);
  }

  /**
   * Pudło, mapa słońca i rzut. camScene = kamera (scena), viewHalfWorld =
   * pół kadru przy zoomie 1 [px], camZ = wysokość kamery persp. tła.
   */
  setView({ camX, camY, zoom, viewW, viewH, camZ, boxHalfX, boxHalfY }) {
    const U = this.U;
    U.boxCenter.value.set(camX, camY);
    U.boxHalf.value.set(boxHalfX, boxHalfY);
    U.camXY.value.set(camX, camY);
    U.camZ.value = camZ;
    U.zoom.value = zoom;
    U.viewHalf.value.set(viewW * 0.5 / zoom, viewH * 0.5 / zoom);
  }

  /** Oświetlenie: słońce (kierunek w scenie), otoczenie. */
  setSun(sunDir, sunColor, occ) {
    const U = this.U;
    U.sunCol.value.copy(sunColor);
    U.sunOcc.value = occ ? 1 : 0;
    // Faza słońca: światło biegnie od słońca (−sunDir), widok w +z.
    U.sunPhase.value = hg(this.cfg.phaseG)(-sunDir.z);
  }

  /** Dysze kadłuba → uniformy (współrzędne sceny). */
  setNozzles(list) {
    const U = this.U;
    const n = Math.min(NOZZLE_CAP, list.length);
    for (let i = 0; i < n; i++) {
      const z = list[i];
      U.nozA.array[i].set(z.x, z.y, 0, z.radius);
      U.nozB.array[i].set(z.ax, z.ay, z.jetSpeed, z.length);
      U.nozC.array[i].set(z.vx, z.vy, z.power, 0);
    }
    U.nozCount.value = n;
  }

  /** Kadłuby → uniformy (scena). */
  setHulls(list) {
    const U = this.U;
    for (let h = 0; h < HULL_CAP; h++) {
      const e = list[h];
      if (!e) { U.hullB.array[h].set(1, 1, 0, 0); continue; }
      U.hullA.array[h].set(e.x, e.y, Math.cos(e.rot), Math.sin(e.rot));
      U.hullB.array[h].set(e.sdfW, e.sdfH, this.cfg.hullHalfZ, 1);
      U.hullC.array[h].set(e.vx, e.vy, e.angVel, 0);
    }
  }

  /** Skały gry → kule w siatce komórek pudła (dane warstwy są już w scenie). */
  setRocks(layer) {
    const U = this.U;
    const cx = U.boxCenter.value.x;
    const cy = U.boxCenter.value.y;
    const hx = U.boxHalf.value.x;
    const hy = U.boxHalf.value.y;
    const zLo = this.cfg.zLo;
    const zHi = this.cfg.zHi;
    const R = this.rockNode.value.array;
    let n = 0;
    if (layer && layer.enabled) {
      layer.forEachLoaded((rock, d, b) => {
        if (n >= ROCK_CAP) return;
        const x = d[b];
        const y = d[b + 1];
        const z = d[b + 2];
        const r = d[b + 3] * (d[b + 16] + d[b + 17] + d[b + 18]) / 3;
        if (Math.abs(x - cx) > hx + r || Math.abs(y - cy) > hy + r) return;
        if (z + r < zLo || z - r > zHi) return;
        const o = n * 4;
        R[o] = x; R[o + 1] = y; R[o + 2] = z; R[o + 3] = r;
        n++;
      });
    }
    const x0 = cx - hx;
    const y0 = cy - hy;
    const cw = (hx * 2) / RG_NX;
    const ch = (hy * 2) / RG_NY;
    U.rockOrigin.value.set(x0, y0);
    U.rockInvCell.value.set(1 / cw, 1 / ch);
    const counts = this._rockCounts;
    counts.fill(0);
    const box = this._rockBox;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      // Kula w płaszczyźnie: promień przekroju na wysokości warstwy.
      const rr = R[o + 3];
      const ax0 = Math.max(0, Math.floor((R[o] - rr - x0) / cw));
      const ax1 = Math.min(RG_NX - 1, Math.floor((R[o] + rr - x0) / cw));
      const ay0 = Math.max(0, Math.floor((R[o + 1] - rr - y0) / ch));
      const ay1 = Math.min(RG_NY - 1, Math.floor((R[o + 1] + rr - y0) / ch));
      box[o] = ax0; box[o + 1] = ax1; box[o + 2] = ay0; box[o + 3] = ay1;
      for (let y = ay0; y <= ay1; y++) for (let x = ax0; x <= ax1; x++) counts[y * RG_NX + x]++;
    }
    const C = this.rockCellNode.value.array;
    let total = 0;
    for (let c = 0; c < RG_NX * RG_NY; c++) {
      C[c * 2] = total;
      C[c * 2 + 1] = 0;
      total += Math.min(counts[c], Math.max(0, ROCK_ITEM_CAP - total));
    }
    const items = this.rockItemNode.value.array;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      for (let y = box[o + 2]; y <= box[o + 3]; y++) {
        for (let x = box[o]; x <= box[o + 1]; x++) {
          const c = y * RG_NX + x;
          const at = C[c * 2] + C[c * 2 + 1];
          if (at >= ROCK_ITEM_CAP || C[c * 2 + 1] >= counts[c]) continue;
          items[at] = i;
          C[c * 2 + 1]++;
        }
      }
    }
    const ra = this.rockNode.value;
    ra.clearUpdateRanges();
    ra.addUpdateRange(0, Math.max(1, n) * 4);
    ra.needsUpdate = true;
    this.rockCellNode.value.needsUpdate = true;
    const ia = this.rockItemNode.value;
    ia.clearUpdateRanges();
    ia.addUpdateRange(0, Math.max(1, total));
    ia.needsUpdate = true;
    this.stats.rocks = n;
    this.stats.rockItems = total;
  }

  /**
   * Symulacja: stały krok, do maxSteps kroków na klatkę. onStep(t, h) ustawia
   * przed każdym krokiem uniformy zależne od czasu (wybuchy, pociski).
   */
  simulate(dt, time, onStep) {
    const U = this.U;
    const cfg = this.cfg;
    if (!this.enabled || !this.count) { this.stats.steps = 0; return; }
    this._acc = Math.min(this._acc + dt, cfg.step * cfg.maxSteps);
    let steps = 0;
    const h = cfg.step;
    while (this._acc >= h && steps < cfg.maxSteps) {
      this._acc -= h;
      const t = time - this._acc;
      U.dt.value = h;
      U.time.value = t;
      U.dampK.value = 1 - Math.exp(-cfg.damping * h);
      if (onStep) onStep(t, h);
      this.renderer.compute(this.stepNode, this.count);
      steps++;
    }
    this.stats.steps = steps;
  }

  /** Oświetlenie drobin (po zbudowaniu siatki świateł tej klatki). */
  light() {
    if (!this.enabled || !this.count) return;
    this.renderer.compute(this.lightNode, this.count);
  }

  setVisible(v) {
    this.enabled = !!v;
    this.mesh.visible = this.enabled;
  }
}

