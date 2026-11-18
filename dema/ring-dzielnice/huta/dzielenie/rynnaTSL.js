// HUTA — element 4 (dzielenie): ŚWIATŁO W RYNNIE POD NOŻEM (węzły wklejane, bez layoutu — pułapki 1 i 35). Wspólne dla
// partii arkuszy (`arkuszTSL.js`) i materiału otoczenia (`../formowanie/otoczenieTSL.js` — dno i ściany rynny), więc
// kropla na dnie i dno mają to samo światło. (Runda 9: rynna została tylko pod nożem — x 3480…3610, krople szczeliny i
// iskry; odpad leci prosto w osi do otworu PRZETOP.)
//
// Rynna to koryto 160 j. głębokie i 200 j. szerokie (`DZIEL.kerf`): z dna widać niebo hali tylko przez szczelinę między
// koronami ścian, a słońce tylko wtedy, gdy promień ku niemu wychodzi przez szczelinę — analitycznie, bez map cienia:
//   NIEBO   udział półsfery widocznej przez szczelinę w punkcie na głębokości d pod koroną, w odległości z od osi:
//           powierzchnia pozioma ½ [(w − z) / √((w − z)² + d²) + (w + z) / √((w + z)² + d²)], ściana ½ [1 − d / √(d² + 4w²)];
//   SŁOŃCE  promień ku słońcu przebija płaszczyznę korony w (x', z'): oświetlone, gdy |z'| < w i x' w rynnie (brzeg miękki).
// Poza rynną oba czynniki = 1 (reszta hali bez zmian).
import { abs, clamp, float, max, mix, smoothstep, sqrt, vec2 } from 'three/tsl';
import { DZIEL } from './geometria.js';

const H = DZIEL.kerf;

/** 1 dla x > 0. */
const step01 = (x) => clamp(x.mul(1e6), 0.0, 1.0);

/** Wypełnienie cienia w korycie światłem odbitym od jego nasłonecznionej części (udział nieba). */
const CHUTE_BOUNCE = 0.3;

/**
 * Światło w rynnie w punkcie P (normalna N, kierunek ku słońcu `sunDir`): vec2(słońce 0…1, niebo i odblaski 0…1).
 */
export const chuteShade = (sunDir, P, N) => {
  const w = float(H.hz);
  const inside = step01(P.x.sub(H.x0 - 2)).mul(step01(float(H.x1 + 2).sub(P.x)))
    .mul(step01(w.add(0.5).sub(abs(P.z)))).mul(step01(float(H.yTop + 0.3).sub(P.y))).mul(step01(P.y.sub(H.yFloor - 7)));
  const d = max(float(H.yTop).sub(P.y), 0.0);
  const a = max(w.sub(P.z), 0.0);
  const b = max(w.add(P.z), 0.0);
  const floorF = a.div(sqrt(a.mul(a).add(d.mul(d)).add(1e-3))).add(b.div(sqrt(b.mul(b).add(d.mul(d)).add(1e-3)))).mul(0.5);
  const wallF = float(1.0).sub(d.div(sqrt(d.mul(d).add(w.mul(w).mul(4.0)).add(1e-3)))).mul(0.5);
  const sky = mix(wallF, floorF, clamp(abs(N.y), 0.0, 1.0)).add(CHUTE_BOUNCE);
  const ly = max(sunDir.y, 0.05);
  const xs = P.x.add(sunDir.x.div(ly).mul(d));
  const zs = P.z.add(sunDir.z.div(ly).mul(d));
  const inX = smoothstep(H.x0 - 1.5, H.x0 + 1.5, xs).mul(float(1.0).sub(smoothstep(H.x1 - 1.5, H.x1 + 1.5, xs)));
  const sunIn = float(1.0).sub(smoothstep(w.sub(1.5), w.add(1.5), abs(zs))).mul(inX);
  return vec2(float(1.0).sub(inside).add(sunIn.mul(inside)), float(1.0).sub(inside).add(sky.mul(inside)));
};
