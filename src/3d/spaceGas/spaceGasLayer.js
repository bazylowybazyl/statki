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
import { Fn, float, vec2, vec3, vec4, uniform, uv, texture, exp, max } from 'three/tsl';
import { sunVisibility, sunFill } from '../sunShadowMask.js';

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
      lightZ: uniform(SPACE_GAS_Z.lights)
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
        const A = texture(maps.gasTex, m).level(0).toVar();
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
