// dema/bronie-webgpu/surfaceLighting.js
//
// Model oświetlenia kadłubów i wieżyczek dema broni — kopia SurfaceLightingModel
// z dema asteroid (dema/asteroidy-webgpu/surfaceLighting.js, commit 9859d07) plus
// ACES gry z jego tslCommon.js. Własna kopia, bo demo asteroid jest rozwijane
// równolegle. Wzór jak w shaderze skał gry: Lambert z zawinięciem zmieszany
// z Lommelem–Seeligerem, Blinn–Phong; światło = barwa × moc, bez 1/π.

import { LightingModel } from 'three/webgpu';
import { Fn, vec3, max, min, dot, normalize, clamp, mix, smoothstep, pow } from 'three/tsl';

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
    // Otoczenie liczy materiał (emisja).
  }
}

/**
 * Tone mapping gry (uberPass w src/3d/core3d.js): dopasowanie ACES Narkowicza
 * bez przeskalowania wejścia — three ma inną krzywą (÷0,6).
 */
export const acesGame = Fn(([c]) => {
  const x = max(c, vec3(0.0));
  return clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0.0, 1.0);
}).setLayout({ name: 'acesGame', type: 'vec3', inputs: [{ name: 'c', type: 'vec3' }] });
