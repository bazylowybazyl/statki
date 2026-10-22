// src/3d/spaceGas/spaceGasMaps.js
//
// MAPY GAZU W PRZESTRZENI (docs/PLAN-gazy-kosmos.md GK-3): compute do tekstur storage o STAŁYM rozmiarze (z presetu —
// bez zmiany rozmiaru przy zmianie okna, omija pułapkę resize celów), raz na klatkę w kroku Core3D.fx:
//   • MAPA GAZU (kadr z zapasem): gęstość kolumny × albedo gazów sceny (rgb) i gęstość całkowita (a) — z pola
//     (dwie tekstury kroków, przenikanie wg ułamka kroku, każda z własnym rogiem okna; próbka dwusześcienna — siatka 64 j.
//     w próbce dwuliniowej dawała schodki na brzegach ławic), kolumna nad bryłą z gazu otoczenia (okręt nie „wybija”
//     mgły nad sobą), poza oknem i przy jego brzegu — pole dalekie; × faktura detalu na pozycjach spoczynkowych
//     (jedzie z gazem), wygaszana, gdy teksel mapy przerasta jej skalę;
//   • MAPA ŚWIATŁA: przepuszczalność ku Słońcu — marsz po mapie gazu odcinkami (każdy odcinek uśredniony dwiema
//     próbkami — bez schodków cienia), samocień: gaz od strony Słońca jasny, w głębi ciemny.
// Mapy czyta warstwa (spaceGasLayer.js) — w kamerze z góry jedna próbka na teksel.

import * as THREE from 'three/webgpu';
import { Fn, If, Return, float, int, ivec2, vec2, vec4, uniform, instanceIndex, textureStore, texture, mix, smoothstep, min, max, floor, exp } from 'three/tsl';

/** Odcinki marszu ku Słońcu [j.] (dema: SHADOW_STEPS). */
const SHADOW_STEPS = [60, 140, 250, 400, 600, 860, 1200, 1650, 2200];
/** Grubość warstwy gazu [j.] (dema: SLAB — z ∈ [−SLAB, SLAB]). */
export const SPACE_GAS_SLAB = 420;

function mapTexture(w, h, name) {
  const t = new THREE.StorageTexture(w, h);
  t.type = THREE.HalfFloatType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.name = name;
  return t;
}

// Próbka dwusześcienna (B-spline) tekstury N × N z 4 odczytów z filtrem liniowym (Sigg i Hadwiger) — dema: cubicTex.
function cubicTex(tex, uv, N) {
  const st = uv.mul(N).sub(0.5).toVar();
  const i = floor(st).toVar();
  const f = st.sub(i).toVar();
  const f2 = f.mul(f);
  const f3 = f2.mul(f);
  const w0 = f3.negate().add(f2.mul(3.0)).sub(f.mul(3.0)).add(1.0).div(6.0).toVar();
  const w1 = f3.mul(3.0).sub(f2.mul(6.0)).add(4.0).div(6.0).toVar();
  const w2 = f3.mul(-3.0).add(f2.mul(3.0)).add(f.mul(3.0)).add(1.0).div(6.0).toVar();
  const w3 = f3.div(6.0).toVar();
  const g0 = w0.add(w1).toVar();
  const g1 = w2.add(w3).toVar();
  const h0 = i.sub(0.5).add(w1.div(g0)).div(N).toVar();
  const h1 = i.add(1.5).add(w3.div(g1)).div(N).toVar();
  const a = texture(tex, vec2(h0.x, h0.y)).level(0);
  const b = texture(tex, vec2(h1.x, h0.y)).level(0);
  const c = texture(tex, vec2(h0.x, h1.y)).level(0);
  const d = texture(tex, vec2(h1.x, h1.y)).level(0);
  return mix(mix(a, b, g1.x), mix(c, d, g1.x), g1.y);
}

export class SpaceGasMaps {
  /**
   * @param {import('./spaceGasSim.js').SpaceGasSim} sim
   * @param {object} scene scena (farEnv, detail, U)
   * @param {object} o w, h — rozmiar map [teksle]
   */
  constructor(sim, scene, { w = 768, h = 432, name = 'spaceGasMap' } = {}) {
    this.sim = sim;
    this.scene = scene;
    this.w = w;
    this.h = h;
    this.gasTex = mapTexture(w, h, `${name}Gas`);
    this.lightTex = mapTexture(w, h, `${name}Light`);
    this.U = {
      live: uniform(1),
      min: uniform(new THREE.Vector2()),       // róg mapy [j., względem kotwicy]
      texel: uniform(new THREE.Vector2(1, 1)), // bok teksla [j.]
      imgO0: uniform(new THREE.Vector2()),     // róg okna tekstury kroku 0 / 1
      imgO1: uniform(new THREE.Vector2()),
      w1: uniform(0),                          // waga tekstury 1 w przenikaniu
      simOn: uniform(1),                       // 0 — samo pole dalekie (A/B: ruch gazu wył.)
      amount: uniform(1),                      // gęstość gazu (strojenie)
      sunDir: uniform(new THREE.Vector2(1, 0)),// ku Słońcu (świat gry)
      lodLo: uniform(60),                      // teksel mapy [j.], od którego faktura gaśnie …
      lodHi: uniform(260),                     // … do zera
      alb1: uniform(new THREE.Vector3(1, 1, 1)),
      alb2: uniform(new THREE.Vector3(1, 1, 1)),
      alb3: uniform(new THREE.Vector3(1, 1, 1)),
      ejecta: uniform(new THREE.Vector3(0.5, 0.45, 0.4))
    };
    this._build();
  }

  _build() {
    const sim = this.sim, scene = this.scene, U = this.U, W = this.w, H = this.h;
    const N = sim.N, C = sim.cell, SW = N * C;
    const SU = sim.U;
    const sum4 = (v) => v.x.add(v.y).add(v.z).add(v.w);
    const texel = () => {
      If(U.live.lessThan(0.5), () => { Return(); });
      const id = int(instanceIndex).toVar();
      const i = id.mod(int(W)).toVar();
      const j = id.div(int(W)).toVar();
      const p = U.min.add(vec2(float(i).add(0.5), float(j).add(0.5)).mul(U.texel)).toVar();
      return { i, j, p };
    };
    // pole w punkcie p z tekstury kroku k: gęstość (dwusześciennie), faktura / stała, waga okna (brzeg łagodnie)
    const fieldAt = (k, p) => {
      const suv = p.sub(k ? U.imgO1 : U.imgO0).div(SW).toVar();
      const edge = min(min(suv.x, suv.y), min(suv.x.oneMinus(), suv.y.oneMinus()));
      const kw = smoothstep(0.0, 0.04, edge).toVar();
      const rt = texture(sim.restTex[k], suv).level(0).toVar();
      const dn = cubicTex(sim.denTex[k], suv, N).toVar();
      // kolumna nad bryłą: gaz otoczenia (średnia 8 próbek na promieniu 5 komórek, tylko z komórek gazu)
      If(rt.z.greaterThan(0.02), () => {
        const s = vec4(0).toVar();
        const ws = float(0).toVar();
        for (let a = 0; a < 8; a++) {
          const o = vec2(Math.cos(a * Math.PI / 4), Math.sin(a * Math.PI / 4)).mul(5 / N);
          const w = float(1.0).sub(texture(sim.restTex[k], suv.add(o)).level(0).z);
          s.addAssign(texture(sim.denTex[k], suv.add(o)).level(0).mul(w));
          ws.addAssign(w);
        }
        dn.assign(mix(dn, s.div(max(ws, 1e-3)), rt.z.min(1.0)));
      });
      return { dn, off: rt.xy, kw };
    };

    this.kGas = Fn(() => {
      const t = texel();
      const p = t.p;
      const A = fieldAt(0, p);
      const B = fieldAt(1, p);
      const kw = mix(A.kw, B.kw, U.w1).mul(U.simOn).toVar();
      const den = mix(A.dn, B.dn, U.w1).mul(kw).toVar();
      const off = mix(A.off, B.off, U.w1).mul(kw).mul(C).toVar();
      If(kw.lessThan(0.999), () => { den.addAssign(scene.farEnv(p, SU).mul(kw.oneMinus())); });
      const lod = smoothstep(U.lodLo, U.lodHi, max(U.texel.x, U.texel.y));
      const s = den.mul(scene.detail(p.add(off).sub(SU.windOff), lod)).mul(U.amount).toVar();
      const rgb = U.alb1.mul(s.x).add(U.alb2.mul(s.y)).add(U.alb3.mul(s.z)).add(U.ejecta.mul(s.w));
      textureStore(this.gasTex, ivec2(t.i, t.j), vec4(rgb, sum4(s)));
    })().compute(W * H).setName('spaceGasMapGas');

    this.kLight = Fn(() => {
      const t = texel();
      const inv = vec2(1.0).div(U.texel.mul(vec2(W, H)));
      const uvOf = (q) => q.sub(U.min).mul(inv);
      const tau = float(0).toVar();
      let prev = 0;
      for (const s of SHADOW_STEPS) {
        const ds = s - prev;
        const a = prev + ds * 0.25, b = prev + ds * 0.75;
        prev = s;
        const ga = texture(this.gasTex, uvOf(t.p.add(U.sunDir.mul(a)))).level(0).a;
        const gb = texture(this.gasTex, uvOf(t.p.add(U.sunDir.mul(b)))).level(0).a;
        tau.addAssign(ga.add(gb).mul(ds * 0.5 / (2 * SPACE_GAS_SLAB)));
      }
      const tsun = exp(tau.mul(-0.32)).mul(0.85).add(0.15);
      textureStore(this.lightTex, ivec2(t.i, t.j), vec4(tsun, tau, 0.0, 1.0));
    })().compute(W * H).setName('spaceGasMapLight');
  }

  kernels() { return [this.kGas, this.kLight]; }

  warm(renderer) {
    if (!renderer) return;
    const live = this.U.live.value;
    this.U.live.value = 0;
    try { renderer.compute(this.kernels()); } finally { this.U.live.value = live; }
  }

  /** Wygląd sceny → uniformy (albedo gazów, wyrzut). */
  syncLook(look) {
    const a = look.albedo, U = this.U;
    U.alb1.value.set(a[0][0], a[0][1], a[0][2]);
    U.alb2.value.set(a[1][0], a[1][1], a[1][2]);
    U.alb3.value.set(a[2][0], a[2][1], a[2][2]);
    U.ejecta.value.set(look.ejecta[0], look.ejecta[1], look.ejecta[2]);
  }

  /**
   * Prostokąt mapy wokół kamery (względem kotwicy): pół kadru × zapas, środek na siatce tekseli (wzór nie „pływa”
   * przy ruchu kamery). Zwraca środek mapy i jej bok w świecie przez `out` (cx, cy, w, h).
   */
  place(camX, camY, halfW, halfH, out) {
    const hw = halfW * 1.08, hh = halfH * 1.08;
    const tx = hw * 2 / this.w, ty = hh * 2 / this.h;
    const mx = Math.round(camX / tx) * tx, my = Math.round(camY / ty) * ty;
    this.U.min.value.set(mx - hw, my - hh);
    this.U.texel.value.set(tx, ty);
    const img = this.sim.image;
    this.U.imgO0.value.copy(img.origin[0]);
    this.U.imgO1.value.copy(img.origin[1]);
    this.U.w1.value = img.w1;
    out.cx = mx; out.cy = my; out.w = hw * 2; out.h = hh * 2;
    return out;
  }
}
