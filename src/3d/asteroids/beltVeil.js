// src/3d/asteroids/beltVeil.js
//
// Zasłona gęstego pola i nocna łuna — z dema dema/asteroidy-webgpu/sky.js (zadanie 21,
// krok 7). Tło gry ma własne niebo (mgławica i gwiazdy — zadanie 05), więc z nieba
// dema wchodzi tylko to, co należy do pola: zasłona pyłu gęstego pola (kłęby, łuna od
// strony słońca), NOC W POLU (łuna ~√T przesiana przez pole, ciemność z głębią) i błyski
// burzy w chmurach (do 4 — pozycje ekranu z storm.js). Pełnoekranowy kwad w passie tła
// Core3D PO mgławicy i gwiazdach gry; mieszanie premultiplied „over”: niebo gry × (1 − a) +
// zasłona × a — jak `mix(space, veilCol, a)` dema, gdzie `space` było niebem dema.
// Prześwity dema (pojedyncze gwiazdy w najrzadszych miejscach zasłony, gasnące w rdzeniu
// pola) = mniejsze krycie w prześwicie: przebijają się gwiazdy gry.
//
// ZASŁONA PO SKAŁACH Z TESTEM GŁĘBI (2026-10-29, pole asteroid przy 5120 × 1440): kwad tuż przed daleką płaszczyzną
// (VEIL_CLIP_Z) z testem głębi, w kolejce PO skałach tła. Dawniej (−0,5, bez testu głębi) zasłona liczyła 5 szumów
// fraktalnych na KAŻDY piksel, a skały tła (bez mieszania) i tak nadpisywały ją tam, gdzie leżą. Teraz próbki pod skałami
// tła i pod znaczkiem głębi skał gry (asteroidBelt.js _createPlayStamp) odpadają w teście głębi; na pozostałych zasłona
// kładzie się na to samo niebo co dawniej (sfera / czworokąt nieba, mgławica i gwiazdy nie piszą głębi) — obraz pola bit
// w bit ten sam. A/B: belt.veil.setDepthCull(false) (dawny kwad — nowy pipeline przy przełączeniu).
// MIEJSCE W KOLEJCE PASSA TŁA (poprawka przeglądu 2026-10-29): OKNO renderOrder (−0,5; 0) należy do pasa — niebo
// i gwiazdy (< −0,5) → skały tła (asteroidBelt.js BELT_RENDER_ORDER: −0,45 … −0,20) → ZASŁONA (VEIL_RENDER_ORDER −0,1,
// jedyna rzecz z tym renderOrder) → każda inna rzecz passa tła (≥ 0). Zasłona jest więc tam, gdzie dawny kwad (−0,5): po
// niebie, PRZED każdą inną przezroczystą rzeczą tła — napisy budowli (5), gaz wybuchów w głębi (10), głębokie płaty
// mgły (10+), przezroczyste części stacji i doków w soczewce skoku (0) rysują się na zasłonie jak dawniej (przy
// renderOrder 5 części tła z renderOrder 0…5 schodziły POD zasłonę, a napisy i atmosfera bitwy w głębi stały w remisie).
// Zasłona to człon NIEBA dema (`mix(space, veilCol, a)`, space = niebo), nie mgiełka nad budowlami: rzecz tła z ZAPISEM
// głębi (budowla, bryła) zasłania ją jak skała — dawny kwad bez testu głębi malował się po wszystkich nieprzezroczystych
// rzeczach passa tła (kolejka nieprzezroczysta idzie przed przezroczystą), czego nikt nie zamierzał: z widoczną zasłoną
// (pole pasa) pass tła dzieli w grze tylko gaz wybuchów w głębi (10 — nad zasłoną jak dawniej) oraz doki i stacje
// w soczewce skoku przy porcie w polu (Ceres, Westa, kryjówki — położenia z ziarna świata i czasu gry) — poza soczewką
// dok jest w passie gry (warstwa 0), stacja w FG (2), więc dawny kwad zaciemniał je dopiero od początku ładowania skoku
// (skok obrazu). Baza piratów (57 AU — za pasem), bitwa w głębi (~65 AU, tła Jowisz / Mars), ringi i hale K-7 leżą poza
// pasem. Przegląd i A/B: docs/AUDYT-wydajnosc-baza-gpu-2026-10-28.md § 9.7.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, uniformArray, screenCoordinate, screenSize,
  mix, smoothstep, clamp, max, exp, sqrt, dot, mx_fractal_noise_float, attribute, length
} from 'three/tsl';

export const VEIL_FLASH_CAP = 4;
// Po skałach tła (asteroidBelt.js BELT_RENDER_ORDER: −0,45 + pasmo · 0,1 + koszyk · 0,01, do −0,20), przed każdą inną
// rzeczą passa tła (≥ 0; głębokie płaty mgły — fog.js 10+). Jedyna rzecz z tym renderOrder (bez remisów).
export const VEIL_RENDER_ORDER = -0.1;
// Dawna kolejka (A/B setDepthCull(false)): po gwiazdach (−1), przed skałami, bez testu głębi.
export const VEIL_RENDER_ORDER_OLD = -0.5;
// Głębia kwadu zasłony: tuż przed daleką płaszczyzną (wyczyszczona głębia 1 przechodzi test LessEqual, każda skała tła
// i znaczek skał gry — nie).
export const VEIL_CLIP_Z = 0.99999;

export class BeltVeil {
  constructor({ parent, layer = 1 }) {
    this.u = {
      offset: uniform(new THREE.Vector2()),      // przesunięcie kłębów [px] (paralaksa)
      veil: uniform(0),                           // 0..1 — ile tła zasłania pył
      sunLevel: uniform(1),                       // słońce przy kamerze (nightKnee(T))
      sunDir: uniform(new THREE.Vector2(1, 0)),   // kierunek do słońca na ekranie (y w górę)
      dark: uniform(new THREE.Vector3(0.0036, 0.0042, 0.0058)),
      lit: uniform(new THREE.Vector3(0.019, 0.02, 0.023)),
      glow: uniform(new THREE.Vector3(0.03, 0.03, 0.031)),
      night: uniform(new THREE.Vector3(0.006, 0.0075, 0.012)),   // łuna przesiana przez pole
      ice: uniform(0),                            // udział lodu (Kuiper: zasłona chłodniejsza)
      // Błyski burzy: xy = piksel ekranu (y w dół), z = promień [px], w = jasność.
      flashes: uniformArray(Array.from({ length: VEIL_FLASH_CAP }, () => new THREE.Vector4(0, 0, 1, 0)), 'vec4'),
      flashColor: uniform(new THREE.Vector3(0.5, 0.42, 1.0)),
      // z kwadu w przestrzeni obcięcia (w = 1): VEIL_CLIP_Z — tuż przed daleką płaszczyzną (test głębi ze skałami; skały
      // tła mają głębię ≤ ~0,999 przy bliskiej płaszczyźnie 100 j.), 0,5 — dawny kwad (A/B)
      clipZ: uniform(VEIL_CLIP_Z)
    };
    const U = this.u;
    const mat = new THREE.NodeMaterial();
    mat.name = 'AsteroidBelt:veil';
    // Zasłona pełnoekranowa (4 wierzchołki) — rulon warpa (src/3d/warp/rulon.js) jej nie zgina.
    mat.rulonBend = false;
    mat.transparent = true;
    // Test głębi (LessEqual): wyczyszczona głębia 1 przechodzi, skała tła i znaczek skał gry (< 1) — nie.
    mat.depthTest = true;
    mat.depthWrite = false;
    mat.lights = false;
    mat.fog = false;
    mat.premultipliedAlpha = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    mat.vertexNode = Fn(() => {
      const p = attribute('position', 'vec3');
      return vec4(p.xy, U.clipZ, 1.0);
    })();
    mat.fragmentNode = Fn(() => {
      const px = screenCoordinate.xy.add(U.offset).toVar();
      // Zasłona pyłu gęstego pola.
      const uvc = screenCoordinate.xy.div(screenSize).sub(0.5).mul(vec2(1.0, -1.0));
      const cloud = smoothstep(0.35, 0.75, mx_fractal_noise_float(vec3(px.div(1400.0), 2.9), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5)).toVar();
      const big = mx_fractal_noise_float(vec3(px.div(3600.0), 7.3), 2, 2.0, 0.5, 1.0).mul(0.5).add(0.5).toVar();
      const coolTint = mix(vec3(1.0), vec3(0.8, 0.95, 1.25), U.ice);
      const veilCol = mix(U.dark, U.lit, cloud.mul(0.8)).mul(U.sunLevel).mul(coolTint).toVar();
      const side = clamp(dot(uvc, U.sunDir).mul(1.4).add(0.5), 0.0, 1.0).toVar();
      const sideS = side.mul(side).mul(float(3.0).sub(side.mul(2.0))).toVar();
      veilCol.addAssign(U.glow.mul(sideS).mul(U.sunLevel).mul(cloud.mul(0.4).add(0.6)).mul(coolTint));
      // Noc: łuna ~√T od strony słońca, kłęby z dużej skali (ciemność ma głębię).
      const nightK = sqrt(max(U.sunLevel, 0.0)).mul(float(1.0).sub(U.sunLevel)).toVar();
      veilCol.addAssign(U.night.mul(coolTint).mul(nightK).mul(sideS.mul(1.6).add(0.25)).mul(cloud.mul(0.7).add(big.mul(0.6)).add(0.15)));
      // Błyski burzy pod płaszczyzną: chmury rozświetlone od środka.
      const flash = vec3(0.0).toVar();
      for (let i = 0; i < VEIL_FLASH_CAP; i++) {
        const f = U.flashes.element(i);
        const dd = length(screenCoordinate.xy.sub(f.xy)).div(max(f.z, 1.0));
        flash.addAssign(U.flashColor.mul(f.w).mul(exp(dd.mul(dd).mul(-2.2))));
      }
      veilCol.addAssign(flash.mul(cloud.mul(0.8).add(big.mul(0.5)).add(0.1)).mul(0.06));
      const a = U.veil.mul(mix(mix(0.9, 0.99, cloud), 1.0, float(1.0).sub(U.sunLevel))).toVar();
      // Prześwity: w najrzadszych miejscach zasłony przebijają się gwiazdy tła —
      // w rdzeniu pola (słońce przy kamerze < 0,1) prawie wcale.
      const gap = smoothstep(0.78, 0.95, float(1.0).sub(cloud).mul(0.6).add(big.mul(-0.4).add(0.4)));
      const deep = smoothstep(0.0, 0.1, U.sunLevel).mul(0.9).add(0.1);
      const aOut = clamp(a.mul(float(1.0).sub(gap.mul(0.12).mul(deep))), 0.0, 1.0).toVar();
      return vec4(max(veilCol, vec3(0.0)).mul(aOut), aOut);
    })();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = VEIL_RENDER_ORDER;
    this.mesh.name = 'AsteroidBelt:veil';
    this.mesh.layers.set(layer);
    this.mesh.visible = false;
    this.material = mat;
    this.depthCull = true;
    parent.add(this.mesh);
  }

  /**
   * A/B (narzędzia): true — kwad na dalekiej płaszczyźnie z testem głębi po skałach tła (domyślnie), false — dawny kwad
   * (−0,5: przed skałami, bez testu głębi). Zmiana stanu głębi = nowy pipeline przy pierwszym rysunku (tylko do pomiarów).
   * Dawny obraz passa tła w całości: razem z dawną kolejką skał (AsteroidBelt.setRockOrder(false)).
   */
  setDepthCull(on = true) {
    const v = on !== false;
    if (v === this.depthCull) return;
    this.depthCull = v;
    this.material.depthTest = v;
    this.material.needsUpdate = true;
    this.mesh.renderOrder = v ? VEIL_RENDER_ORDER : VEIL_RENDER_ORDER_OLD;
    this.u.clipZ.value = v ? VEIL_CLIP_Z : 0.5;
  }

  /** Błyski burzy: lista { sx, sy [px ekranu], r [px], e } (najwyżej VEIL_FLASH_CAP). */
  setFlashes(list, count) {
    const A = this.u.flashes.array;
    for (let i = 0; i < VEIL_FLASH_CAP; i++) {
      const f = i < count ? list[i] : null;
      if (f) A[i].set(f.sx, f.sy, f.r, f.e);
      else A[i].set(0, 0, 1, 0);
    }
  }

  setVisible(v) {
    this.mesh.visible = !!v;
  }
}
