// ============================================================
// Głębia modeli 3D w passie ortho gry 2D (opcje „Statki 3D” / „Bronie 3D”, 2026-09-30).
//
// Kamera statków patrzy prosto w dół (ortho), więc wysokość bryły nie zmienia obrazu — zmienia tylko
// kolejność głębi. Model ma prawdziwą bryłę (światło, cienie, odblaski), ale GŁĘBIĘ zapisuje w cienkiej
// warstwie z: z_mapped = mix(lo, hi, (z − zb) / (zt − zb)) — kolejność wewnątrz bryły zostaje (odwzorowanie
// monotoniczne), a względem reszty sceny model leży tam, gdzie w 2D leżała skóra sprite'a:
//   • kadłub [−10,4; −5,3] — pod strugą i poświatą dysz MAIN (z = −5; w 2D wystają spod sprite'a przy
//     rufie), skórami sprite'ów (z = 0), poświatą na poszyciu (z = 2), pociskami i efektami (z = 14–15);
//     nad skałami pasa (szczyt skały PLAY ≤ −0,45 r, r ≥ 40 → z ≤ ~−11) i płatami mgły (z ≤ −200);
//   • wieże na modelu [−4,6; −0,4] — zawsze nad pokładem swojego kadłuba;
//   • wieże na sprite'ach [0,05; 1,8] — nad skórą sprite'a, pod efektami.
// Warstwa per obiekt: userData.slab = Vector4(zb, zt, lo, hi) (z świata; uniform().onObjectUpdate).
// Precyzja: depth24plus przy near 1 / far 400 000 = ~0,024 j. na stopień — ~210 stopni na kadłub.
// ============================================================
import * as THREE from 'three/webgpu';
import { Fn, uniform, positionWorld, positionView, cameraProjectionMatrix, vec4, clamp, mix, max, select } from 'three/tsl';

export const SLAB_HULL = Object.freeze({ lo: -10.4, hi: -5.3 });
export const SLAB_TURRET_ON_MODEL = Object.freeze({ lo: -4.6, hi: -0.4 });
export const SLAB_TURRET_ON_SPRITE = Object.freeze({ lo: 0.05, hi: 1.8 });

const _default = new THREE.Vector4(-1, 1, SLAB_HULL.lo, SLAB_HULL.hi);

// Kamery 3D (perspektywa, src/game/game3D.js): warstwa wyłączona — model pisze prawdziwą głębię.
const uSlabOn = uniform(1);
export function setModelSlabDepthOn(on) {
  uSlabOn.value = on ? 1 : 0;
}

/** Materiał zapisuje głębię w warstwie obiektu (userData.slab). */
export function applyModelSlabDepth(mat) {
  const uSlab = uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object?.userData?.slab || _default);
  mat.depthNode = Fn(() => {
    const zw = positionWorld.z;
    const t = clamp(zw.sub(uSlab.x).div(max(uSlab.y.sub(uSlab.x), 1e-3)), 0, 1);
    const zm = mix(uSlab.z, uSlab.w, t);
    // kamera ortho patrzy wzdłuż −z świata: przesunięcie z świata = przesunięcie z widoku
    const zv = select(uSlabOn.greaterThan(0.5), positionView.z.add(zm.sub(zw)), positionView.z);
    const clip = cameraProjectionMatrix.mul(vec4(positionView.x, positionView.y, zv, 1));
    return clip.z.div(clip.w);
  })();
  return mat;
}

/** Warstwa z dla obiektu: zb, zt — zakres z świata bryły; slab — SLAB_*. */
export function setSlab(v, zb, zt, slab) {
  v.set(zb, Math.max(zt, zb + 1e-3), slab.lo, slab.hi);
  return v;
}
