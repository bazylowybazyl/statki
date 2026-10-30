// src/3d/spaceGas/spaceGasLayer.js
//
// OBRAZ GAZU W PRZESTRZENI w passie ortho Core3D (docs/PLAN-gazy-kosmos.md GK-3). Dwie płaszczyzny na prostokąt mapy
// (spaceGasMaps.js), z testem głębi, bez zapisu:
//   • DOLNA połowa warstwy gazu — pod płaszczyzną kadłubów (z −20): kadłub ją zasłania (okręt w gazie jest ZA częścią
//     gazu, nie pod nim), skały pasa pod płaszczyzną toną w niej; w kolejce przed efektami gry;
//   • GÓRNA połowa — nad kadłubami i efektami (z +200, renderOrder po efektach): przygasza okręty i strzały — dawne `Ttop`
//     złożenia dema (efekty przy z ≈ 0 przygasza tylko górna połowa gazu).
// W kamerze z góry to złożenie dema z głębią: profil pionowy symetryczny, każda połowa niesie pół gęstości kolumny.
// (8 plasterków dema daje inny wynik tylko przy grubych bryłach — kamery 3D z paralaksą w plasterkach: później.)
//
// Światło: słońce z mapy światła (samocień gazu) × maska słońca Core3D (`sunVisibility` — cień kadłubów, mrok pola),
// otoczenie × `sunFill`, światła siatki `Core3D.fx.grid` (dysze, strzały, wybuchy) z kolanem; mieszanie premultiplied
// „over” (ONE, ONE − α), emisji ponad progiem bloomu brak — gaz świeci tylko odbitym światłem.
//
// Geometria w układzie lokalnym (prostokąt mapy wokół środka), położenie w `mesh.position` (double — highPrecision
// three składa modelViewMatrix na CPU): bez `positionWorld` przy 5–10 mln j.

import * as THREE from 'three/webgpu';
import { Fn, If, float, vec2, vec3, vec4, uniform, uv, texture, exp, max, floor, mix } from 'three/tsl';
import { sunVisibility, sunFill } from '../sunShadowMask.js';

/**
 * Odczyt dwusześcienny B-spline mapy W × H z 4 odczytów dwuliniowych (Sigg i Hadwiger — jak `cubicTex` pola w
 * spaceGasMaps.js), uv w [0, 1]. WARSTWA (2026-10-29, „przy zoomie i oddaleniu gazy drżą”): teksel mapy ma przy każdym
 * zoomie stały rozmiar w px bufora (5120 × 1440, Ultra: mapa 768 × 432 — ~9,6 × 4,8 px, w proporcjach kadru — ~6,8 px);
 * odczyt dwuliniowy zależy od położenia siatki tekseli, a ta przeskakuje na stopniu drabiny —
 * przy oddaleniu (treść w skali teksla) każdy stopień przestawiał wzór. B-spline zbija skok na stopniu kilkukrotnie
 * (lustro: scripts/gazZoomSonda.mjs), przy zbliżeniu (treść ≫ teksla) obraz bez widocznej zmiany (≤ 3/255). Filtr
 * przybliżający: przy oddaleniu gaz miękkszy o ~½ teksla — do decyzji użytkownika (SpaceGas.tune.layerCubic).
 */
function bsplineMap(tex, m, W, H) {
  const N = vec2(W, H);
  const st = m.mul(N).sub(0.5).toVar();
  const i = floor(st).toVar();
  const f = st.sub(i).toVar();
  const f2 = f.mul(f), f3 = f2.mul(f);
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

/** Wysokości połówek warstwy w scenie (kadłuby −10,4…−5,3; efekty gry z ≈ 14–15). */
export const SPACE_GAS_Z = Object.freeze({ lower: -20, upper: 200, lights: 30 });
/** Kolejka: dolna po płatach mgły pasa (−58…−59) i dnie ośrodka (−50), przed efektami gry (≥ 0); górna po efektach. */
export const SPACE_GAS_ORDER = Object.freeze({ lower: -45, upper: 900 });

export class SpaceGasLayer {
  /**
   * @param {import('./spaceGasMaps.js').SpaceGasMaps} maps
   * @param {object} o grid (Core3D.fx.grid albo null), layer (warstwa Core3D — 0)
   */
  constructor(maps, { grid = null, layer = 0, name = 'SpaceGas' } = {}) {
    this.maps = maps;
    const L = this.L = {
      on: uniform(1),                               // A/B: gaz wył. (T dema)
      fade: uniform(1),                             // zanik przy oddaleniu
      sun: uniform(new THREE.Color(1, 0.93, 0.85)), // barwa × moc słońca w gazie
      ambient: uniform(new THREE.Color(0.02, 0.02, 0.025)),
      grid: uniform(1),                             // światła siatki
      gridKnee: uniform(0.35),                      // L / (1 + kolano · ΣL) — gaz przy dyszy nie bieleje
      lightZ: uniform(SPACE_GAS_Z.lights),
      cubic: uniform(0)                             // 1 — mapa gazu odczytem B-spline (bsplineMap), 0 — dwuliniowo
    };
    // Prostokąt 1 × 1 skalowany w obiekcie (scale = bok mapy w świecie); uv (0, 0) = lewy dół sceny = róg mapy
    // o największym y gry — wiersz mapy liczony od najmniejszego y gry (v mapy = 1 − uv.y).
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.geometry = geo;
    const make = (upper) => {
      const mat = new THREE.NodeMaterial();
      mat.name = `${name}${upper ? 'Upper' : 'Lower'}`;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.depthTest = true;
      mat.side = THREE.FrontSide;
      mat.lights = false;
      mat.fog = false;
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      mat.blendSrcAlpha = THREE.OneFactor;
      mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      mat.blendEquation = THREE.AddEquation;
      mat.blendEquationAlpha = THREE.AddEquation;
      mat.fragmentNode = Fn(() => {
        const u = uv();
        const m = vec2(u.x, u.y.oneMinus()).toVar();
        const A = vec4(0).toVar();
        If(L.cubic.greaterThan(0.5), () => { A.assign(bsplineMap(maps.gasTex, m, maps.w, maps.h)); })
          .Else(() => { A.assign(texture(maps.gasTex, m).level(0)); });
        const Ls = texture(maps.lightTex, m).level(0).x;
        // pół kolumny gazu na połowę warstwy
        const tau = A.a.mul(0.5).mul(L.on).mul(L.fade).toVar();
        const alb = A.rgb.div(max(A.a, 1e-4));
        const vis = sunVisibility().toVar();
        const light = L.sun.mul(Ls).mul(vis).add(L.ambient.mul(sunFill(vis))).toVar();
        if (grid) {
          const P0 = grid.localPosition('view').toVar();
          const P = vec3(P0.x, P0.y, L.lightZ);
          const g = vec3(0.0).toVar();
          grid.loop(P, ({ att, col, scatter }) => { g.addAssign(col.mul(att).mul(scatter.add(0.5))); });
          const gl = g.mul(L.grid).toVar();
          light.addAssign(gl.div(gl.x.add(gl.y).add(gl.z).mul(L.gridKnee).add(1.0)));
        }
        const a = float(1.0).sub(exp(tau.negate())).toVar();
        return vec4(alb.mul(light).mul(a), a);
      })();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = mat.name;
      mesh.frustumCulled = false;
      mesh.renderOrder = upper ? SPACE_GAS_ORDER.upper : SPACE_GAS_ORDER.lower;
      mesh.layers.set(layer);
      mesh.visible = false;
      return mesh;
    };
    this.lower = make(false);
    this.upper = make(true);
    this.group = new THREE.Group();
    this.group.name = name;
    this.group.add(this.lower, this.upper);
  }

  /**
   * Prostokąt mapy w scenie: środek (świat gry, double — kotwica + środek mapy), bok [j.].
   * Scena: x gry, −y gry.
   */
  place(worldCx, worldCy, w, h) {
    this.lower.position.set(worldCx, -worldCy, SPACE_GAS_Z.lower);
    this.upper.position.set(worldCx, -worldCy, SPACE_GAS_Z.upper);
    this.lower.scale.set(w, h, 1);
    this.upper.scale.set(w, h, 1);
  }

  setVisible(on) {
    this.lower.visible = on;
    this.upper.visible = on;
  }

  warmupMeshes() { return [this.lower, this.upper]; }
}
