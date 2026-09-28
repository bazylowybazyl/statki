// dema/asteroidy-webgpu/surfaceLighting.js
//
// Model oświetlenia powierzchni dema (skały, kadłuby) jako LightingModel TSL:
// każde światło sceny — słońce (DirectionalLight), światła z siatki świateł
// (lights.js: reflektory, lampy, wybuchy, pociski, świecące skały, flary) —
// przechodzi przez direct(), więc materiał nie zna liczby świateł.
//
// Wzór jak w shaderze skał gry (src/3d/rocks/rockMaterial3D.js): rozproszenie
// Lamberta z zawinięciem zmieszane z Lommelem–Seeligerem (regolit), połysk
// Blinna–Phonga z wykładnikiem i siłą z materiału, iskry ziaren. Jednostki jak
// w grze: światło = barwa × moc, bez 1/π (słońce 1,9 daje te same jasności).

import { LightingModel } from 'three/webgpu';
import { float, max, min, dot, normalize, clamp, mix, smoothstep, pow } from 'three/tsl';

export class SurfaceLightingModel extends LightingModel {
  /**
   * @param {object} s zmienne powierzchni (węzły TSL policzone przed światłem):
   *   N, V (widok), mu, diffAlbedo, lunarK, wrap, gloss, specK, specTint,
   *   sparkBase, sparkCol, sunVis
   */
  constructor(s) {
    super();
    this.s = s;
  }

  direct({ lightDirection, lightColor, reflectedLight, lightNode }) {
    const s = this.s;
    const isSun = !!(lightNode && lightNode.light && lightNode.light.isDirectionalLight === true);
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

export const ZERO = float(0);
