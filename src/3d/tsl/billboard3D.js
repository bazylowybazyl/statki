// ============================================================
// Kwady efektów w kamerach 3D gry (gra 3D, 2026-09-29) — wspólne węzły TSL.
//
// Efekty gry (pociski, smugi, wiązki, cząstki broni i rakiet) budują kwady w płaszczyźnie XY sceny —
// kamera z góry patrzy na nie prostopadle. W kamerze 3D (free3d) płaski kwad widać z boku jako kreskę,
// więc:
//   • kwad okrągły (błysk, iskra, dym) — przesunięcia wierzchołków w płaszczyźnie KADRU: billboardOffset(ox, oy)
//   • kwad wzdłuż kierunku (smuga, pocisk, wiązka) — oś wzdłuż kierunku 3D, szerokość prostopadle do
//     niego i do kierunku patrzenia: streakAcross(dir3, perp2)
// W kamerze klasycznej uBill3D = 0 — węzły dają dokładnie dawny wynik (osie X / Y sceny), obraz bez zmian.
// Uniformy globalne (jeden zestaw na grę), ustawia je Core3D.syncCamera raz na render.
// ============================================================
import { uniform, vec3, normalize, cross, mix, length, select } from 'three/tsl';
import { Vector3 } from 'three/webgpu';

export const billboard3DUniforms = {
  uBill3D: uniform(0).setName('fxBill3D'),
  uCamRight: uniform(new Vector3(1, 0, 0)).setName('fxCamRight'),
  uCamUp: uniform(new Vector3(0, 1, 0)).setName('fxCamUp'),
  uCamFwd: uniform(new Vector3(0, 0, -1)).setName('fxCamFwd')
};

/** Przesunięcie wierzchołka kwadu okrągłego: (ox, oy) w osiach sceny (klasyczna) albo kadru (3D) → vec3. */
export function billboardOffset(ox, oy) {
  const U = billboard3DUniforms;
  const flat = vec3(ox, oy, 0.0);
  const bill = U.uCamRight.mul(ox).add(U.uCamUp.mul(oy));
  return mix(flat, bill, U.uBill3D);
}

/**
 * Oś szerokości smugi: w kamerze klasycznej prostopadła w płaszczyźnie (perp2 = (−d.y, d.x)), w 3D
 * prostopadła do kierunku 3D i kierunku patrzenia (smuga zawsze szeroka w kadrze). dir3 jednostkowy.
 */
export function streakAcross(dir3, perp2) {
  const U = billboard3DUniforms;
  const c = cross(dir3, U.uCamFwd);
  const l = length(c);
  const bill = select(l.greaterThan(1e-4), c.div(l.max(1e-4)), U.uCamRight);
  return mix(vec3(perp2, 0.0), normalize(bill), U.uBill3D);
}

/** CPU: stan kamery (Core3D.syncCamera). free — kamera 3D; right / up / fwd — osie kamery w świecie. */
export function setBillboard3DCamera(free, right, up, fwd) {
  const U = billboard3DUniforms;
  U.uBill3D.value = free ? 1 : 0;
  if (free) {
    U.uCamRight.value.copy(right);
    U.uCamUp.value.copy(up);
    U.uCamFwd.value.copy(fwd);
  } else {
    U.uCamRight.value.set(1, 0, 0);
    U.uCamUp.value.set(0, 1, 0);
    U.uCamFwd.value.set(0, 0, -1);
  }
}
