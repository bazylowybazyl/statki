// src/3d/cloak/cloakView.js
//
// Maskowanie w „uber” (src/3d/tsl/postGry.js), przed ACES, gałęzie za warunkami (wyłączone = obraz bez zmian):
//
//  • WIZJER (2026-10-04, jak w Crysis): kadr GRACZA w ukryciu — chłodna winieta z siatką heksów przy brzegach
//    ekranu, lekkie odbarwienie, przy zerwaniu krótki magentowy błysk brzegów, przy końcówce energii winieta
//    migocze. Wartość uniformu odświeża się co render z ostatniego zgłoszenia (`setCloakView` — hullCloak.js,
//    wygląd gracza); zgłoszenie starsze niż 0,3 s = wyłączone (menu, koniec gry, gra zatrzymana bez renderu
//    kadłubów). Dawny pierścień heksów przelatujący przez ekran przy włączaniu usunięty (decyzja użytkownika
//    2026-10-05).
//  • HEKSY-EKRANY (2026-10-05): piksele, w których warstwa DIST ma maskę ekranu (B) albo śnieg (A) — komórka
//    ukrytego kadłuba pokazuje inny wycinek kadru (cloakTSL.js) — dostają wygląd „telewizorka”: chłodny
//    luminofor, podbitą czerń, linie, przesuwający się jaśniejszy pas i śnieg.
import { Vector4 } from 'three/webgpu';
import {
  If, abs, clamp, cos, dot, float, floor, fract, length, max, mix, smoothstep, uint, uniform, vec2, vec3
} from 'three/tsl';
import { cloakHash, cloakHexCell } from './cloakTSL.js';

/** Strojenie wizjera — `strength` 0 wyłącza go całkiem. */
export const CLOAK_VIEW = {
  strength: 1,
  cellsPerHeight: 30,   // gęstość siatki heksów na wysokość ekranu
  vignette: [0.55, 1.15],       // winieta: od / do (odległość od środka, wysokość ekranu = 1) — środek kadru czysty
  desaturate: 0.15,     // odbarwienie (brzegi; środek × 0,4)
  tint: [0.003, 0.012, 0.025],  // chłodne podbicie brzegów (liniowo, przed ACES — na ciemnym tle sRGB je podbija)
  line: [0.004, 0.022, 0.05],   // linie siatki przy brzegach
  glitch: [0.05, 0.006, 0.06]   // zerwanie: magenta na liniach przy brzegach
};

/** Strojenie heksów-ekranów w „uber” (wartości liniowe przed ACES). */
export const CLOAK_SCREEN = Object.freeze({
  gain: 0.6,                    // jaśniejszy obraz na ekranie
  phosphor: [0.8, 1.0, 1.2],    // chłodny luminofor (mnożnik barwy)
  lift: [0.004, 0.014, 0.028],  // „włączony” ekran: podbita czerń (sRGB ją podbija — widać na czarnym tle)
  scan: 0.42,                   // głębokość linii
  scanPx: 3.0,                  // okres linii [px bufora]
  rollSpeed: 0.3,               // przesuwający się jaśniejszy pas [ekranów / s]
  snow: [0.05, 0.07, 0.095],    // śnieg (× szum)
  snowPx: 1.5,                  // ziarno śniegu [px bufora]
  splitPx: 1.2                  // rozszczepienie R / B na ekranie [px bufora] (postGry.js)
});

const _view = new Vector4(0, 0, 0, 0);
let _at = -1e9;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Stan wizjera tej klatki: amount 0..1 (ukrycie), glitch 0..1 (zakłócenie po zerwaniu). */
export function setCloakView(amount, glitch) {
  const s = Math.max(0, Number(CLOAK_VIEW.strength) || 0);
  _view.set(Math.min(1, amount * s), Math.min(1, glitch * s), 0, 0);
  _at = now();
}

function viewValue() {
  if (now() - _at > 300) _view.set(0, 0, 0, 0);
  return _view;
}

/** Węzeł uniformu wizjera do `createPostUniforms` (odświeżany co render). */
export function cloakViewUniform() {
  return uniform(new Vector4(0, 0, 0, 0)).onRenderUpdate(viewValue);
}

/**
 * TSL (gałąź „uber”): wizjer na `sceneColor` (vec4, liniowe HDR, przed ACES). u — węzeł uniformu (cloakViewUniform:
 * x — ukrycie, y — zakłócenie), uvTex — UV kwadu (v = 0 u góry), aspect — szerokość / wysokość ekranu.
 */
export function applyCloakView(u, sceneColor, uvTex, aspect) {
  const V = CLOAK_VIEW;
  If(u.x.add(u.y).greaterThan(0.002), () => {
    const k = u.x;
    const p = uvTex.sub(0.5).mul(vec2(aspect, 1.0)).toVar();
    const r = length(p).toVar();
    const vig = smoothstep(V.vignette[0], V.vignette[1], r).toVar();
    const hc = cloakHexCell(p.mul(V.cellsPerHeight)).toVar();
    const q = abs(hc.xy);
    const edge = float(0.5).sub(max(dot(q, vec2(0.5, 0.8660254)), q.x));
    const line = float(1.0).sub(smoothstep(0.0, 0.06, edge)).toVar();
    const lum = dot(sceneColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    const cool = vec3(lum).mul(vec3(0.84, 0.98, 1.12));
    sceneColor.rgb.assign(mix(sceneColor.rgb, cool, k.mul(V.desaturate).mul(vig.mul(0.6).add(0.4))));
    sceneColor.rgb.addAssign(vec3(...V.tint).mul(vig.mul(k)));
    sceneColor.rgb.addAssign(vec3(...V.line).mul(line).mul(vig.mul(vig).mul(k)));
    // zerwanie: magenta na liniach siatki przy brzegach kadru
    sceneColor.rgb.addAssign(vec3(...V.glitch).mul(u.y).mul(vig).mul(line));
  });
}

/**
 * TSL (gałąź „uber”, piksele heksów-ekranów): tv = (maska ekranu z winietą 0..1, śnieg 0..1) z B / A warstwy DIST,
 * size — rozmiar bufora [px], uTime — zegar postu [s]. Obraz kanału jest już spróbkowany (sceneColor).
 */
export function applyCloakScreens(sceneColor, tv, uvTex, size, uTime) {
  const S = CLOAK_SCREEN;
  const m = tv.x;
  const s = tv.y;
  const px = uvTex.mul(size).toVar();
  const scan = cos(px.y.mul((2 * Math.PI) / S.scanPx)).mul(0.5).add(0.5);
  const roll = smoothstep(0.82, 1.0, fract(uvTex.y.mul(1.6).sub(uTime.mul(S.rollSpeed))));
  const c = sceneColor.rgb.mul(vec3(...S.phosphor).sub(1.0).mul(m).add(1.0)).mul(m.mul(S.gain).add(1.0)).toVar();
  c.mulAssign(float(1.0).sub(scan.mul(S.scan).mul(m)));
  c.addAssign(vec3(...S.lift).mul(m).mul(roll.mul(0.9).add(1.0)));
  const grain = floor(px.div(S.snowPx));
  const n = cloakHash(uint(grain.x), uint(grain.y), uint(floor(uTime.mul(48.0))));
  c.assign(mix(c, vec3(...S.snow).mul(n.mul(1.7).add(0.15)), clamp(s, 0.0, 1.0)));
  sceneColor.rgb.assign(c);
}
