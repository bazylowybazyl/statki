// HUTA — element 4 (dzielenie): ŻAR BRZEGU CIĘCIA w TSL (węzły wklejane, bez layoutu — pułapki 1 i 35). Wspólne dla
// arkuszy (`arkuszTSL.js`: tył i przód arkusza), czoła pasma (`../formowanie/pasmoTSL.js`, `LM.cut`) i śladu szczeliny
// za ogniskiem ostrza — ten sam wzór, więc w chwili rozdzielenia ślad szczeliny przechodzi w dwa brzegi bez skoku.
//
// Model (PROJEKT-dzielenie § 3.3, `model.js` `edgeExcess` / `edgeWidth`): nadwyżka T̃ brzegu nad arkuszem E maleje jak
// 1 / √(1 + t / τ), pas żaru ma szerokość w = w0 + 2√(α t) j. (przewodzenie z liniowego źródła). Świecenie brzegu to
// RÓŻNICA mocy żaru (`heatPower`) między brzegiem a arkuszem pod nim — dodawana do świecenia lica.
//
// ŚLAD PIKSELA: pas żaru ma 1,5–8 j., a z kamery gry piksel to 2–4 j. — próbkowany wprost pas migałby przy ruchu
// (środek piksela raz trafia w pas, raz nie). Pas węższy niż piksel rozciąga się do szerokości piksela z zachowaniem
// energii (moc × w / w'): jasność całkowita i barwa szczytu z modelu, bez migotania. Wielkość piksela w jednostkach
// świata — z macierzy rzutu i rozmiaru ekranu (bez pochodnych ekranu: można liczyć w gałęziach).
import { cameraProjectionMatrix, exp, float, length, max, mix, screenSize, sqrt } from 'three/tsl';
import { heatPower } from '../wytop/wspolneTSL.js';
import { DZIEL } from './geometria.js';

/**
 * (poprawki rundy 8) Brzeg z WIEKU: `e0` — nadwyżka T̃ w chwili przejścia ogniska, `s` — wiek w jednostkach τ (t · k_metal
 * / τ, `model.js` `edgeAge`; może zmieniać się wzdłuż brzegu — ognisko przeszło przez jego początek wcześniej). Zwraca
 * { E — nadwyżka T̃ = e0 / √(1 + s), w — szerokość pasa w0 (1 + √s) [j.] }.
 */
export const edgeAt = (e0, s) => {
  const sv = max(s, 0.0);
  return { E: e0.div(sqrt(sv.add(1.0))), w: sqrt(sv).add(1.0).mul(DZIEL.edge.w0) };
};

/** Rozmiar piksela [j.] w punkcie P (kamera perspektywiczna: ∝ odległość; prostokątna: stały). `cam` — położenie kamery. */
export const pxWorld = (cam, P) => {
  const p11 = cameraProjectionMatrix.element(1).y;
  const p33 = cameraProjectionMatrix.element(3).w;
  const dist = length(cam.sub(P));
  return mix(dist.mul(2.0), float(2.0), p33).div(max(p11.mul(screenSize.y), 1.0));
};

/**
 * Brzeg cięcia: `Tb` — T̃ lica pod brzegiem, `E` — nadwyżka T̃ na licu cięcia, `w` — szerokość pasa [j.], `d` — odległość
 * od lica cięcia [j.] (≥ 0), `px` — rozmiar piksela [j.]. Zwraca { T — T̃ szczytu (barwa), P — dodatkowa moc żaru (już
 * z zachowaniem energii przy rozciągnięciu do piksela) }.
 */
export const edgeGlow = (Tb, E, w, d, px) => {
  const w0 = max(w, 0.3);
  const wv = max(w0, px.mul(0.85));
  const k = w0.div(wv);
  const Te = Tb.add(E.mul(exp(d.div(wv).negate())));
  const dP = max(heatPower(Te).sub(heatPower(Tb)), 0.0).mul(k);
  return { T: Te, P: dP };
};
