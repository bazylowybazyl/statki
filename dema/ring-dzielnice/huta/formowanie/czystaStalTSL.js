// HUTA — runda 9, etap „Czysta stal”: LICO CZYSTEGO METALU (TSL, funkcje wklejane — bez `setLayout`, pułapki 1 i 35) —
// wspólne dla taśmy za stacją odzgorzania (`pasmoTSL.js`) i arkuszy (`../dzielenie/arkuszTSL.js`).
//
// Czysty metal (bez tlenku) to nie matowa łuska: jednolita, gładka powierzchnia ze smugami walcowania (szlif walców
// odbity w licu — wzdłuż taśmy), metal o wysokim albedo (stal jasnoszara, srebrzysta; miedź — czysta barwa miedzi),
// z połyskiem: odbija słońce (szeroki płat walcowanej powierzchni + ostry odblask), emitery pola i halę. Żar (paleta
// bez zmian) liczy materiał wołający — ta funkcja daje tylko światło ODBITE. Udział odbicia rośnie, gdy metal stygnie:
// przy końcu walcowania (T̃ ≈ 0,36) oko widzi żar, a odbicie jest tłem (`hot` — jak dotychczasowe przygaszanie
// rozproszenia na gorącej taśmie), po ostygnięciu — pełne.
import { abs, clamp, dot, float, max, mix, pow, reflect, smoothstep, vec3 } from 'three/tsl';

/**
 * Strojenie: albedo stali i miedzi (liniowe), odbicie na gorącym licu (udział przy T̃ ≥ `hotT1`, pełne przy T̃ ≤ `hotT0`),
 * płaty odblasku słońca (szeroki: wykładnik / moc, ostry), odbicie emiterów, smugi walcowania, ziarno, próg ξ „czyste”.
 */
export const CZYSTA = Object.freeze({
  steel: Object.freeze([0.28, 0.29, 0.31]), copper: Object.freeze([0.45, 0.2, 0.12]),
  hot: 0.12, hotT0: 0.06, hotT1: 0.34,
  wideExp: 18, wideK: 0.22, sharpExp: 220, sharpK: 0.9, envK: 0.8, streakK: 0.12, grainK: 0.08,
  xi0: 0.008, xi1: 0.04
});

const C = CZYSTA;

/**
 * Udział plam jasności lica (plamy cieplne z krzepnięcia — `pasmoTSL.js`) na czystym licu: na licu z wyspami tlenku plamy
 * jasności to w dużej części różnice emisyjności łuski; czysty metal ma emisyjność jednolitą, zostaje różnica temperatury
 * (ok. ±30 K zamiast ok. ±80 K w obrazie łuski).
 */
export const MOTT_CLEAN = 0.35;

/** Waga czystego lica z grubości tlenku ξ (1 — czysto, 0 — łuska): przejście `xi0`…`xi1`. */
export function cleanWeight(xi) {
  return float(1.0).sub(smoothstep(C.xi0, C.xi1, max(xi, 0.0)));
}

/**
 * Światło odbite od czystego lica: `N` — normalna (ku kamerze), `V` — kierunek do kamery, `P` — punkt, `T` — T̃ lica,
 * `xcu` — udział miedzi, `strk` — smugi walcowania (−0,5…0,5), `grain` — ziarno 0…1, `shadow` — cień naczynia, `envL` —
 * jasne źródła odbite (emitery pola, słońce — z materiału wołającego), `fres` — Fresnel. → { diffuse, spec } (vec3).
 */
export function cleanMetal(U, N, V, P, T, xcu, strk, grain, shadow, envL, fres) {
  void P;
  const tint = mix(vec3(...C.steel), vec3(...C.copper), clamp(xcu, 0.0, 1.0));
  // udział odbicia: na żarzącym się licu tło dla żaru, po ostygnięciu pełne
  const wv = mix(float(C.hot), float(1.0), float(1.0).sub(smoothstep(C.hotT0, C.hotT1, T)));
  const albedo = tint.mul(strk.mul(C.streakK).add(1.0)).mul(grain.mul(C.grainK).add(1.0 - C.grainK * 0.5));
  const ndl = max(dot(N, U.sunDir), 0.0);
  const light = U.sunColor.mul(ndl.mul(shadow)).add(U.ambient.mul(N.y.mul(0.3).add(0.7))).add(vec3(0.05, 0.045, 0.04));
  const diffuse = albedo.mul(light).mul(wv);
  // połysk: walcowana powierzchnia — szeroki płat (smugi go rozciągają) i ostry odblask; barwa metalu w odbiciu (miedź)
  const rS = reflect(V.negate(), N);
  const sd = max(dot(rS, U.sunDir), 0.0);
  const lobe = pow(sd, C.wideExp).mul(C.wideK).mul(abs(strk).mul(0.8).add(0.6)).add(pow(sd, C.sharpExp).mul(C.sharpK));
  const metalTint = mix(vec3(1.0), tint.div(max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 1e-3)).mul(0.85), clamp(xcu, 0.0, 1.0));
  const spec = U.sunColor.mul(lobe).mul(shadow).mul(metalTint).add(envL.mul(fres.mul(0.65).add(0.35)).mul(C.envK).mul(metalTint)).mul(wv);
  return { diffuse, spec };
}
