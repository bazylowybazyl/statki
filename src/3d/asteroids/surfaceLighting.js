// src/3d/asteroids/surfaceLighting.js
//
// Model oświetlenia powierzchni skał jako LightingModel TSL — port
// dema/asteroidy-webgpu/surfaceLighting.js (zadanie 21). Wzór jak w demie (i dawnym
// shaderze skał WebGL): rozproszenie Lamberta z zawinięciem zmieszane
// z Lommelem–Seeligerem (regolit), połysk Blinna–Phonga z wykładnikiem i siłą
// z materiału, iskry ziaren. Jednostki jak w grze: światło = barwa × moc, bez 1/π.
//
// Różnica względem dema: w demie słońcem był DirectionalLight sceny passa (barwa
// i moc z ROCK_LIGHT_DEFAULTS). Scena Core3D ma własne światła (wypełniające,
// słońce planet z mapą cienia, ambient) strojone pod kadłuby — skały pola ich NIE
// czytają (obraz jak w demie, niezależny od świateł sceny): `direct()` pomija
// światła sceny (węzeł z `.light`), a słońce pola dokłada `start()` jawnie
// (`s.sunDirView`, `s.sunColor` — wspólne uniformy skał). Światła siatki (reflektory,
// lampy, pioruny, świecące skały) przychodzą z GridLightsNode (src/3d/fx/lightGrid.js,
// tryb „optIn”: materiał z `gridLights = true`) — węzeł bez `.light`.

import { LightingModel } from 'three/webgpu';
import { max, min, dot, normalize, clamp, mix, smoothstep, pow } from 'three/tsl';

/** Znacznik słońca pola w `lightNode` (odróżnia je od świateł siatki). */
export const BELT_SUN_LIGHT = Object.freeze({ isBeltSun: true });

export class SurfaceLightingModel extends LightingModel {
  /**
   * @param {object} s zmienne powierzchni (węzły TSL policzone przed światłem):
   *   N, V (widok), mu, diffAlbedo, lunarK, wrap, gloss, specK, specTint,
   *   sparkBase, sparkCol, sunVis, sunDirView (kierunek do słońca w widoku), sunColor
   */
  constructor(s) {
    super();
    this.s = s;
  }

  start(builder) {
    // Światła sceny (pomijane w direct) + siatka świateł, potem słońce pola.
    super.start(builder);
    if (this.s.sunDirView && this.s.sunColor) {
      this.direct({
        lightDirection: this.s.sunDirView,
        lightColor: this.s.sunColor,
        reflectedLight: builder.context.reflectedLight,
        lightNode: BELT_SUN_LIGHT
      }, builder);
    }
  }

  direct({ lightDirection, lightColor, reflectedLight, lightNode }) {
    // Światła sceny Core3D (DirectionalLight / PointLight / słońce planet) — nie.
    if (lightNode && lightNode.light) return;
    const s = this.s;
    const isSun = lightNode === BELT_SUN_LIGHT;
    const L = lightDirection;
    const NdotL = dot(s.N, L).toVar();
    const mu0 = max(NdotL, 0.0).toVar();
    const lambert = clamp(NdotL.add(s.wrap).div(s.wrap.add(1.0)), 0.0, 1.0);
    // Lommel–Seeliger przycięty (brzeg pod kątem nie świeci jaśniej niż środek).
    const lommel = min(1.15, mu0.mul(2.0).div(mu0.add(s.mu))).mul(smoothstep(s.wrap.negate(), s.wrap.add(0.05), NdotL));
    const diffuse = mix(lambert, lommel, s.lunarK);
    const c = (isSun ? lightColor.mul(s.sunVis) : lightColor).toVar();
    reflectedLight.directDiffuse.addAssign(s.diffAlbedo.mul(c).mul(diffuse));
    const ndh = max(dot(s.N, normalize(L.add(s.V))), 0.0).toVar();
    const spec = pow(ndh, s.gloss).mul(isSun ? s.specK : s.specK.add(0.03));
    const sparkle = s.sparkBase.mul(pow(ndh, 10.0));
    reflectedLight.directSpecular.addAssign(c.mul(s.specTint.mul(spec).add(s.sparkCol.mul(sparkle))).mul(mu0));
  }

  indirect() {
    // Otoczenie liczy materiał (emisja): zależy od kierunku słońca i mroku pola.
  }
}
