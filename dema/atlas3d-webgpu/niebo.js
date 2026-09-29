// ============================================================
// Niebo dema 3D: gwiazdy i mgławica z KIERUNKU patrzenia (tło w każdej kamerze 3D, bez
// paralaksy), tarcza słońca w kierunku światła. Mapa otoczenia (PMREM) z tej samej
// funkcji nieba — metal i szkło odbijają gwiazdy, mgławicę i słońce.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec3, float, floor, fract, dot, normalize, max, pow, exp, mix, smoothstep,
  length, positionWorldDirection, mx_fractal_noise_float, fwidth
} from 'three/tsl';

// Hash 3D → 3D (Hoskins).
const hash33 = Fn(([p3]) => {
  const p = fract(p3.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p.addAssign(dot(p, p.yxz.add(33.33)));
  return fract(p.xxy.add(p.yxx).mul(p.zyx));
});

// Warstwa gwiazd: komórki 3D na sferze o promieniu K, gwiazda w losowym punkcie komórki.
const stars = Fn(([d, K, prob, bright]) => {
  const p = d.mul(K).toVar();
  const cell = floor(p).toVar();
  const h = hash33(cell).toVar();
  const c = cell.add(h.mul(0.8).add(0.1));
  const px = max(fwidth(p.x).add(fwidth(p.y)).add(fwidth(p.z)).mul(0.5), 1e-4).toVar();
  const dist = length(p.sub(c)).div(px);
  const on = smoothstep(prob.oneMinus(), prob.oneMinus().add(0.002), h.z);
  const mag = pow(fract(h.x.mul(13.7).add(h.y)), 3.0);
  const core = exp(dist.mul(dist).negate().div(mix(0.5, 1.4, mag)));
  const tint = mix(vec3(1.0, 0.78, 0.6), vec3(0.7, 0.8, 1.0), h.y);
  return tint.mul(core).mul(on).mul(mix(0.08, 1.0, mag)).mul(bright);
});

/**
 * Funkcja nieba (węzeł TSL koloru z kierunku `dir`).
 * u.sunDir — kierunek DO słońca (świat), u.sunColor, u.stars (mnożnik).
 */
export function skyColor(dir, u, withStars = true) {
  const d = normalize(dir);
  // Mgławica: dwie oktawy szumu, fiolet i morski błękit, pas „drogi mlecznej”.
  const n1 = mx_fractal_noise_float(d.mul(1.6), 4, 2.0, 0.5).mul(0.5).add(0.5);
  const n2 = mx_fractal_noise_float(d.mul(3.3).add(vec3(7.1, -2.3, 4.4)), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const band = exp(dot(d, normalize(vec3(0.25, 0.9, 0.35))).mul(dot(d, normalize(vec3(0.25, 0.9, 0.35)))).mul(-9.0));
  const neb = smoothstep(0.42, 0.95, n1).mul(band.mul(0.8).add(0.35));
  let col = vec3(0.0016, 0.0019, 0.0042)
    .add(vec3(0.020, 0.008, 0.034).mul(neb))
    .add(vec3(0.004, 0.016, 0.022).mul(smoothstep(0.55, 0.9, n2)).mul(band.add(0.2)));
  // Słońce: tarcza + korona. W mapie otoczenia bez tarczy — odblask słońca daje światło kierunkowe,
  // a tarcza × PMREM na połyskliwej stali to lustro (prześwietlone ściany).
  const sd = max(dot(d, u.sunDir), 0.0);
  const disc = withStars ? pow(sd, 1800.0).mul(60.0) : float(0.0);
  col = col.add(u.sunColor.mul(disc.add(pow(sd, 90.0).mul(0.35)).add(pow(sd, 8.0).mul(0.025))));
  if (withStars) {
    col = col.add(stars(d, float(240.0), float(0.022), float(0.55)).mul(u.stars));
    col = col.add(stars(d, float(80.0), float(0.03), float(1.6)).mul(u.stars));
  }
  return col;
}

export function createSky(renderer, scene, o = {}) {
  const u = {
    sunDir: uniform(new THREE.Vector3(-0.55, 0.62, 0.56).normalize()),
    sunColor: uniform(new THREE.Color(1.0, 0.93, 0.82)),
    stars: uniform(1)
  };
  scene.backgroundNode = skyColor(positionWorldDirection, u, true);

  // Mapa otoczenia: sfera z tym samym niebem (bez gwiazd — w PMREM i tak się rozmyją).
  let envRT = null;
  const makeEnv = () => {
    try {
      const envScene = new THREE.Scene();
      const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
      m.colorNode = skyColor(positionWorldDirection, u, false).mul(o.envGain ?? 3.0).add(vec3(0.006, 0.007, 0.011));
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), m));
      const pm = new THREE.PMREMGenerator(renderer);
      envRT?.dispose();
      envRT = pm.fromScene(envScene, 0.02, 0.1, 1000);
      scene.environment = envRT.texture;
      pm.dispose();
      return true;
    } catch (e) {
      console.warn('niebo: PMREM niedostępny —', e?.message || e);
      scene.environment = null;
      return false;
    }
  };
  return { u, makeEnv };
}
