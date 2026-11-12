// dema/autostrada/wspolne.tsl.js
//
// Wspólne klocki obrazu autostrady: uniformy klatki (czas, ślad piksela, stany K-7), filtr cienkiej linii jak `roofLine`
// ringu (linia węższa niż pół śladu rośnie do ~2 px z zachowaną całką), fala przerywana z całką na śladzie i materiał
// addytywny POD kadłubami (transparent: false + AdditiveBlending — pułapka 41: lista nieprzezroczystych, przed proxy).
//
// Zasada progu bloomu (próg bierze CAŁY teksel, smoothstep 0,9–0,91 — pomiar panelu): rzecz cieńsza niż ~3 px trzyma szczyt
// ≤ 0,85 albo jest wyraźnie ponad progiem z rozmyciem σ ≥ 1,6 px. Nad progiem świeci tylko sygnał: stop, czerwona lampa wieży.
import * as THREE from 'three/webgpu';
import { uniform, uniformArray, float, vec2, vec3, vec4, max, min, abs, smoothstep, exp, modelViewMatrix, mix, fract, floor, length, dot, step } from 'three/tsl';

/** Uniformy wspólne wszystkich stylów (jedna grupa — jeden zapis na klatkę). */
export const U = {
  czas: uniform(0).setName('uAsCzas'),                 // czas ruchu [s] (pauza stoi)
  jPxNaW: uniform(1).setName('uAsJPx'),                // j./px: ortho = ta wartość, perspektywa = -z widoku × ta wartość
  persp: uniform(0).setName('uAsPersp'),               // 0 — kamera gry (ortho), 1 — kamera kinowa
  zoom: uniform(0.1).setName('uAsZoom'),               // px/j. kamery gry; w kinie przybliżenie z odległości do drogi
  slonce: uniform(new THREE.Vector3(1, 0, 0.3)).setName('uAsSlonce'),   // kierunek do Słońca w układzie sceny drogi
  podklad: uniform(0.55).setName('uAsPodklad'),        // siła przyciemnienia nieba pod drogą (per styl)
  podkladRamp: uniform(0.75).setName('uAsPodkladRamp'), // waga podkładu na rampach i alejach (per styl, domyślnie jak było)
  podkladRozdzial: uniform(1).setName('uAsPodkladRozdz'), // waga podkładu na pasie rozdziału (per styl, domyślnie jak było)
  tory: uniform(1).setName('uAsTory'),                 // jasność torów K-7 z bazy w fazie przejazdu (per styl, domyślnie pełna)
  barBazy: uniform(1).setName('uAsBarBazy'),           // jasność baru stopu z bazy (per styl, domyślnie pełna; styl z własnym barem gasi)
  rZiemi: uniform(0).setName('uAsRZiemi'),             // promień tarczy Ziemi: kamera kinowa chowa za nią podkład (per styl; 0 — bez przesłony, jak było)
  sygnaly: uniformArray([new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()], 'vec4').setName('uAsSygnaly')
};

/**
 * Widoczność punktu względem kuli w układzie widoku: 1 — widać, 0 — za kulą. `lv` punkt, `cv` środek kuli, `R` promień (> 0). Działa tylko w kamerze kinowej
 * (pass płaszczyzny gry nie ma głębi planet, a w kamerze gry nic nie leży „za” tarczą).
 */
export const zaKula = (lv, cv, R) => {
  const dl = max(length(lv), 1);
  const tca = dot(cv, lv).div(dl);
  const d2 = dot(cv, cv).sub(tca.mul(tca));
  const R2 = R.mul(R);
  return float(1).sub(float(1).sub(smoothstep(R2.mul(0.97), R2, d2)).mul(step(tca, dl)).mul(U.persp));
};

/** Ślad piksela w jednostkach świata w etapie wierzchołków (`pos` — vec3 lokalny). */
export function sladPikselaW(pos) {
  const z = modelViewMatrix.mul(vec4(pos, 1)).z;
  return mix(float(1), z.negate(), U.persp).mul(U.jPxNaW);
}

/** Cienka linia: `x` odległość od osi, `hw` pół szerokości, `fw` ślad piksela [j.]. Całka w poprzek zachowana. */
export const linia = (x, hw, fw) => {
  const w = max(fw.mul(0.5), hw).toVar();
  return float(1).sub(smoothstep(w, w.add(fw), abs(x))).mul(fw.mul(0.5).add(hw).div(w.add(fw.mul(0.5))));
};

/** Gauss w poprzek z zachowaną całką: `sigma0` właściwa szerokość [j.], `fw` ślad. Zwraca jasność 0…1 × (sigma0/sigma). */
export const gaussCalka = (x, sigma0, fw) => {
  const s = max(sigma0, fw.mul(0.9)).toVar();
  const u = x.div(s);
  return exp(u.mul(u).mul(-0.5)).mul(sigma0.div(s));
};

/**
 * Fala prostokątna przerywana wzdłuż `s`: okres `p`, wypełnienie `d` (0…1), `fw` ślad wzdłuż. Całka na śladzie — z daleka
 * średnia wypełnienia zamiast mrugania (jak haloSquareWave).
 */
export const przerywana = (s, p, d, fw) => {
  const w = max(fw, 1e-3);
  const h = (x) => floor(x.div(p)).mul(d).add(min(fract(x.div(p)), d));   // całka fali na jeden okres
  const a = s.sub(w.mul(0.5));
  const b = s.add(w.mul(0.5));
  return h(b).sub(h(a)).mul(p).div(w).clamp(0, 1);
};

/** Materiał addytywny pod kadłubami: bez zapisu głębi, jedna strona, rysunek przed proxy (renderOrder < 10). */
export function materialAddytywny(fragmentNode, positionNode = null, nazwa = 'autostrada') {
  const m = new THREE.NodeMaterial();
  m.name = nazwa;
  m.lights = false;
  m.fog = false;
  m.transparent = false;
  m.blending = THREE.AdditiveBlending;
  m.depthWrite = false;
  m.depthTest = false;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  m.fragmentNode = fragmentNode;
  if (positionNode) m.positionNode = positionNode;
  return m;
}

/** Zapis stanów K-7 do uniformu (co klatkę): x — stan jezdni wewn., y — zewn. (0 ziel., 1 żółte, 2 czerw.), z — czas fazy, w — faza. */
export function zapiszSygnaly(k7) {
  const a = U.sygnaly.array;
  for (let i = 0; i < 4; i++) {
    const w = k7[i];
    a[i].set(w.stan, w.stan, w.tFazy, w.faza);
  }
}

/** Kolory wspólnego kodu barw (liniowe, HDR): czerwień tylko stop, bursztyn rzeki inny niż ostrzeżenie. */
export const BARWY = Object.freeze({
  zimna: Object.freeze([0.58, 0.70, 0.85]),
  ciepla: Object.freeze([1.0, 0.36, 0.055]),
  stop: Object.freeze([6.0, 0.07, 0.02]),
  zolta: Object.freeze([3.2, 1.45, 0.10]),
  zwolnienie: Object.freeze([0.10, 1.2, 0.5]),
  korytarz: Object.freeze([1.0, 0.92, 0.78]),
  blekit: Object.freeze([0.25, 0.55, 1.5]),
  policja: Object.freeze([0.5, 0.9, 3.0])
});
export const kolor = (c) => vec3(c[0], c[1], c[2]);
export const vec2z = vec2;
