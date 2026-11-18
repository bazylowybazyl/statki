// HUTA — wytop: WSPÓLNE WĘZŁY TSL (uniformy elementu, szumy, światło komory). Funkcje wklejane (bez layoutu).
//
// Wszystkie materiały wytopu (kula, wyposażenie komory, ziarna, nitka i granulki żużla, iskry) czytają JEDEN zestaw uniformów
// (`createWytopUniforms`) i liczą światło w UKŁADZIE KOMORY (początek = środek kuli, y w górę; liczby małe — bez
// kłopotów z precyzją świata 7 mln j.): słońce z cieniem obrzeża studni i cieniem kuli, niebo z otwartej góry,
// światło kuli (barwa metalu × moc z temperatury × (R / d)²).
import * as THREE from 'three';
import {
  If, Loop, abs, clamp, dot, exp, float, floor, fract, int, length, max, min, mix, mod, pow, sin, smoothstep,
  sqrt, step, uniform, uniformArray, vec2, vec3, vec4
} from 'three/tsl';
import { KOMORA } from './geometria.js';
import { MODES } from './kula.js';
import { POOL } from './komora.js';
import { MASA_CELLS } from './masa.js';
import { GAZ_PROCES } from './gaz.js';

export const LUMA = vec3(0.2126, 0.7152, 0.0722);
const v4 = () => new THREE.Vector4(0, 0, 0, 0);
const v3 = () => new THREE.Vector3(0, 0, 0);

/** Uniformy elementu (jeden zestaw na stronę). Wektory od zer (pułapka 46), tablice ze stałą nazwą (pułapka 25). */
export function createWytopUniforms() {
  return {
    ball: uniform(v4()),            // promień (≥ 0,5 także bez kuli), kąt obrotu, temperatura, czas symulacji
    ball2: uniform(v4()),           // prędkość zmarszczek [rad/s], tempo wtopień 0…1, stożek czapy pod nitką: wysokość [ułamek R], szerokość [rad]
    off: uniform(v3()),             // środek kupy / kuli (kołysanie w polu; przy zrzucie — spadek do leja)
    port: uniform(v4()),            // 0, 0, żużel w rurociągu i dzwonie ssawy 0…1, chłód strefy wsadu 0…1
    slag2: uniform(v4()),           // liczba wysp żużla w tablicy, stożek pod nitką 0…1, „ogon” spadającej kuli 0…1, 0
    thr0: uniform(v4()),            // nitka żużla: korzeń xyz (komora), początek narysowanego odcinka 0…1
    thr1: uniform(v4()),            // … wylot dzwonu xyz, koniec narysowanego odcinka 0…1
    thr2: uniform(v4()),            // … punkt kontrolny łuku xyz, grubość z przepływu 0…1
    mach: uniform(v4()),            // maszyneria: dosunięcie segmentów cewek ku osi [j.], promień pierścienia segmentów, zjazd segmentów prowadnicą ku równikowi [j.], wysokość osi segmentów [j.]
    cage: uniform(v3()),            // środek klatki cewek (idzie za kołysaniem bryły w polu)
    grav: uniform(v4()),            // pierścień bramy 0 g: faza świateł [obroty], obieg 0…1 (generator pracuje), grawitacja 0…1 (szewrony w dół), brama otwarta
    disp: uniform(v4()),            // WYŚWIETLACZ GRAWITACJI: faza obiegu szewronów [komórki, ułamek], obrót 0…1, faza spływu w dół [ułamek], jasność
    dcol: uniform(v3()),            // barwa × jasność wyświetlacza = światło robocze komory
    vor: uniform(v4()),             // ZASYSANIE: siła wiru 0…1, kąt skręcenia [rad], wgłębienie nad gardzielą [j.], promień lustra w spoczynku [j.]
    fun: uniform(v4()),             // lej: poziom metalu [y], najwyższy poziom [y], żar ścian 0…1, żar gardzieli 0…1
    fall: uniform(v4()),            // zrzut: wydłużenie bryły w pionie, zwężenie w poziomie, wlanie kuli w masę 0…1, czas od zetknięcia [s] (−1 — przed)
    mass: uniform(v4()),            // masa w leju: promień odwzorowania wzoru powierzchni [j.], płaskość 0…1 (kula → jezioro), oś kuli w chwili zetknięcia x, z
    mass2: uniform(v4()),           // masa w leju: średnia grubość rysowana w pierwszym pierścieniu pola (przy gardzieli), odwzorowanie wzoru płaskie 0…1, kołysanie masy 0…1, jezioro ustalone 0…1
    heap: uniform(v4()),            // kupa: promień obrysu, średni żar 0…1, promień źródła światła, promień cienia
    limb: uniform(v4()),            // domieszka barwy przy brzegu tarczy (miedź: zielonkawa poświata), siła
    cam: uniform(v3()),             // kamera w układzie komory
    frame: uniform(v4()),           // postęp kroku 0…1, px na jednostkę × odległość, najmniejszy rozmiar ziarna [px], kąt piksela na kuli
    sunDir: uniform(v3()),          // kierunek ku słońcu (komora)
    sunColor: uniform(v3()),
    ambient: uniform(v3()),         // niebo z otwartej góry
    light: uniform(v4()),           // barwa światła kuli (rgb), moc
    glow: uniform(v4()),            // żar cewek, radiatorów, wylotu odbieralnika, kula czysta 0…1
    work: uniform(v4()),            // światło robocze komory (chłodne, gaśnie z żarem bryły) 0…1; żar nitki żużla przy dzwonie 0…1; 0; 0
    ramp0: uniform(v3()), ramp1: uniform(v3()), ramp2: uniform(v3()), ramp3: uniform(v3()),
    slag: uniform(v3()), slagHot: uniform(v3()), spark: uniform(v3()),
    shade0: uniform(v3()), shade1: uniform(v3()), shade2: uniform(v3()), vein: uniform(v3()),
    grain: uniform(v4()),           // promień bryłki, połysk żyłek, jasność rudy, przepływ przez granicę 0 g (0…1)
    // ODCIĄG I TLEN (`odciag.js`): faza impulsów w rurze [przedziały], napełniany zbiornik, przepływ odciągu 0…1,
    // otwarcie żaluzji okapów | napełnienie zbiorników 0…2, opróżniany (numer + postęp; −1 — żaden) | długość drogi
    // do napełnianego zbiornika [j.], z jego odgałęzienia, okapy ssą 0…1 (wentylacja 0 g), dopływ do zbiorników 0…1
    oxy: uniform(v4()), oxy2: uniform(v4()), oxy3: uniform(v4()),
    // strojenie wyglądu (demo: `__wytop.tune`)
    t1: uniform(new THREE.Vector4(0.5, 0.32, 5.5, 1.0)),      // jasność żaru, emisyjność (reszta = odbicie komory), gęstość komórek, kontrast komórek
    t2: uniform(new THREE.Vector4(0.55, 1.0, 1.0, 0.0042)),    // żar odbitego nieba (0 = czerń), moc odbić jasnych, moc słońca, amplituda zmarszczek
    t3: uniform(new THREE.Vector4(0.9, 0.62, 0.6, 1.0)),      // pociemnienie brzegu: wykładnik, głębokość; moc światła kuli na komorze (kula 2,5 × większa powierzchnią: 0,6 trzyma komorę w jasności sprzed rundy 4); żar ziaren
    t4: uniform(new THREE.Vector4(1.0, 1.0, 1.0, 1.0)),       // mnożnik pokrycia kadru, jasność cewek, jasność lamp, jasność iskier
    t5: uniform(new THREE.Vector4(1.0, 1.0, 1.0, 1.0)),       // kontrast mapy temperatury, pasy grzania cewek, żar nitki żużla, żar granulek
    t6: uniform(new THREE.Vector4(0.008, 1.0, 0.13, 1.0)),    // żużel: miękkość brzegu [rad], żar, menisk metalu przy brzegu, połysk
    modes: uniformArray(Array.from({ length: MODES / 4 }, v4), 'vec4').setName('WytopMody'),
    ripples: uniformArray(Array.from({ length: POOL.ripples }, v4), 'vec4').setName('WytopZmarszczki'),
    floes: uniformArray(Array.from({ length: POOL.floes * 2 }, v4), 'vec4').setName('WytopKry'),
    // MASA W LEJU: komórki pola grubości (`masa.js`) — grubość rysowana [j.], ostygnięcie 0…1, 0, 0
    masa: uniformArray(Array.from({ length: MASA_CELLS }, v4), 'vec4').setName('WytopMasa'),
    // gaz w przedziałach rury zbiorczej [t] (`view.gazRura`, po cztery w wektorze; wlot → separator)
    duct: uniformArray(Array.from({ length: GAZ_PROCES.ductBuckets / 4 }, v4), 'vec4').setName('WytopRura')
  };
}

// ---------------------------------------------------------------------------
// Szumy

/** Hasz 3 → 3 bez funkcji trygonometrycznych (Hoskins). */
export const hash33 = (p) => {
  const q = vec3(0.0).toVar();
  q.assign(fract(p.mul(vec3(0.1031, 0.1030, 0.0973))));
  q.addAssign(dot(q, q.yxz.add(33.33)));
  return fract(q.xxy.add(q.yxx).mul(q.zyx));
};
export const hash21 = (p) => {
  const q = vec3(0.0).toVar();
  q.assign(fract(vec3(p.x, p.y, p.x).mul(0.1031)));
  q.addAssign(dot(q, q.yzx.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
};
export const hash22 = (p) => {
  const q = vec3(0.0).toVar();
  q.assign(fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.1030, 0.0973))));
  q.addAssign(dot(q, q.yzx.add(33.33)));
  return fract(q.xx.add(q.yz).mul(q.zy));
};

/** Gładki szum wartości 3D (0…1). */
export const noise3 = (p) => {
  const i = vec3(0.0).toVar();
  i.assign(floor(p));
  const f = vec3(0.0).toVar();
  f.assign(fract(p));
  const u = vec3(0.0).toVar();
  u.assign(f.mul(f).mul(vec3(3.0).sub(f.mul(2.0))));
  const h = (ox, oy, oz) => hash33(i.add(vec3(ox, oy, oz))).x;
  const x00 = mix(h(0, 0, 0), h(1, 0, 0), u.x);
  const x10 = mix(h(0, 1, 0), h(1, 1, 0), u.x);
  const x01 = mix(h(0, 0, 1), h(1, 0, 1), u.x);
  const x11 = mix(h(0, 1, 1), h(1, 1, 1), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
};

/**
 * Komórki 3D z punktami płynącymi w czasie: zwraca vec4(F1, F2, hasz komórki, 0). Punkty krążą wokół swoich miejsc
 * (różne fazy i tempa), więc komórki rosną, kurczą się i zlewają bez przeskoków wzoru.
 */
export const cells3 = (p, time) => {
  const ip = vec3(0.0).toVar();
  ip.assign(floor(p));
  const fp = vec3(0.0).toVar();
  fp.assign(fract(p));
  const f1 = float(8.0).toVar();
  const f2 = float(8.0).toVar();
  const id = float(0.0).toVar();
  Loop({ start: 0, end: 27, type: 'int', condition: '<', name: 'wc' }, ({ wc }) => {
    const n = float(0.0).toVar();
    n.assign(float(wc));
    const o = vec3(0.0).toVar();
    o.assign(vec3(mod(n, 3.0), mod(floor(n.div(3.0)), 3.0), floor(n.div(9.0))).sub(1.0));
    const h = vec3(0.0).toVar();
    h.assign(hash33(ip.add(o)));
    const pt = vec3(0.0).toVar();
    pt.assign(o.add(0.5).add(sin(h.mul(6.2831853).add(time.mul(h.zxy.mul(0.7).add(0.45)))).mul(0.36)));
    const r = vec3(0.0).toVar();
    r.assign(pt.sub(fp));
    const d = float(0.0).toVar();
    d.assign(dot(r, r));
    If(d.lessThan(f1), () => {
      f2.assign(f1);
      f1.assign(d);
      id.assign(h.x);
    }).ElseIf(d.lessThan(f2), () => {
      f2.assign(d);
    });
  });
  return vec4(sqrt(f1), sqrt(f2), id, 0.0);
};

/**
 * Granulki 3D: suma miękkich plam wokół punktów płynących w czasie (każdy punkt ma własną siłę 0,35…1). Plamy
 * sąsiednich punktów zlewają się gładko, gdy punkty się zbliżają, i rozdzielają, gdy się oddalają — bez krawędzi
 * komórek. Zwraca sumę (0 … ok. 1,6).
 */
export const blobs3 = (p, time) => {
  const ip = vec3(0.0).toVar();
  ip.assign(floor(p));
  const fp = vec3(0.0).toVar();
  fp.assign(fract(p));
  const sum = float(0.0).toVar();
  Loop({ start: 0, end: 27, type: 'int', condition: '<', name: 'wg' }, ({ wg }) => {
    const n = float(0.0).toVar();
    n.assign(float(wg));
    const o = vec3(0.0).toVar();
    o.assign(vec3(mod(n, 3.0), mod(floor(n.div(3.0)), 3.0), floor(n.div(9.0))).sub(1.0));
    const h = vec3(0.0).toVar();
    h.assign(hash33(ip.add(o)));
    const pt = vec3(0.0).toVar();
    pt.assign(o.add(0.5).add(sin(h.mul(6.2831853).add(time.mul(h.zxy.mul(0.7).add(0.45)))).mul(0.42)));
    const r = vec3(0.0).toVar();
    r.assign(pt.sub(fp));
    sum.addAssign(exp(dot(r, r).mul(-5.5)).mul(h.y.mul(0.65).add(0.35)));
  });
  return sum;
};

/** Komórki 2D nieruchome: vec3(F1, F2, hasz). */
export const cells2 = (p) => {
  const ip = vec2(0.0).toVar();
  ip.assign(floor(p));
  const fp = vec2(0.0).toVar();
  fp.assign(fract(p));
  const f1 = float(8.0).toVar();
  const f2 = float(8.0).toVar();
  const id = float(0.0).toVar();
  Loop({ start: 0, end: 9, type: 'int', condition: '<', name: 'wk' }, ({ wk }) => {
    const n = float(0.0).toVar();
    n.assign(float(wk));
    const o = vec2(0.0).toVar();
    o.assign(vec2(mod(n, 3.0), floor(n.div(3.0))).sub(1.0));
    const h = vec2(0.0).toVar();
    h.assign(hash22(ip.add(o)));
    const r = vec2(0.0).toVar();
    r.assign(o.add(h.mul(0.8).add(0.1)).sub(fp));
    const d = float(0.0).toVar();
    d.assign(dot(r, r));
    If(d.lessThan(f1), () => {
      f2.assign(f1);
      f1.assign(d);
      id.assign(h.x);
    }).ElseIf(d.lessThan(f2), () => {
      f2.assign(d);
    });
  });
  return vec3(sqrt(f1), sqrt(f2), id);
};

// ---------------------------------------------------------------------------
// Żar

/**
 * Barwa żaru z temperatury (1 = spust), unormowana do luminancji 1: ciemna wiśnia (0,35) → czerwony pomarańcz (0,62)
 * → pomarańcz (0,95) → żółty (1,3 — najgorętsze miejsca: środki komórek, pasy cewek, menisk).
 */
export const heatColor = (U, T) => {
  const a = clamp(T.sub(0.35).div(0.27), 0.0, 1.0);
  const b = clamp(T.sub(0.62).div(0.33), 0.0, 1.0);
  const c = clamp(T.sub(0.95).div(0.35), 0.0, 1.0);
  const col = vec3(0.0).toVar();
  col.assign(mix(mix(mix(U.ramp0, U.ramp1, a), U.ramp2, b), U.ramp3, c));
  return col.div(max(dot(col, LUMA), 1e-3));
};
/** Luminancja żaru z temperatury (stroma: stygnięcie mocno przyciemnia). */
export const heatPower = (T) => {
  const t = clamp(T, 0.0, 1.5);
  return pow(t, 3.5).mul(0.97).add(0.03).mul(smoothstep(0.12, 0.36, t));
};

// ---------------------------------------------------------------------------
// Światło komory

const PIT = KOMORA.pitR;
const DECK = KOMORA.deckY;
const BAY = KOMORA.bay;

/**
 * Widoczność słońca w punkcie komory `P`: nad pokładem pełna; w studni — promień ku słońcu musi wyjść przez otwór
 * (studnia albo zatoka taśmy) i nie przeciąć kuli. Brzeg cienia miękki.
 */
export const sunVis = (U, P) => {
  const L = U.sunDir;
  const t = float(0.0).toVar();
  t.assign(max(float(DECK).sub(P.y), 0.0).div(max(L.y, 0.05)));
  const q = vec2(0.0).toVar();
  q.assign(vec2(P.x, P.z).add(vec2(L.x, L.z).mul(t)));
  const soft = t.mul(0.03).add(6.0);
  const inPit = float(1.0).sub(smoothstep(float(PIT - 4).sub(soft), float(PIT - 4).add(soft), length(q)));
  const inBay = smoothstep(float(BAY.z0).sub(soft), float(BAY.z0).add(soft), q.y)
    .mul(float(1.0).sub(smoothstep(float(BAY.z1).sub(soft), float(BAY.z1).add(soft), q.y)))
    .mul(float(1.0).sub(smoothstep(float(BAY.xb).sub(soft), float(BAY.xb).add(soft), q.x)));
  const open = max(max(inPit, inBay), step(float(DECK - 0.5), P.y));
  // cień bryły w środku (kupa albo kula): odległość jej środka od promienia ku słońcu
  const Pb = vec3(0.0).toVar();
  Pb.assign(P.sub(U.off));
  const b = float(0.0).toVar();
  b.assign(dot(Pb, L).negate());
  const d2 = max(dot(Pb, Pb).sub(b.mul(b)), 0.0);
  const R = U.heap.w;
  const ballShadow = mix(float(1.0), smoothstep(R.sub(8.0), R.add(22.0), sqrt(d2)), step(0.0, b).mul(step(1.0, R)));
  return open.mul(ballShadow);
};

/**
 * Światło kuli w punkcie `P` na powierzchnię o normalnej `N` (kula to duże źródło: miękkie owinięcie), z lekkim
 * półcieniem pierścieni klatki na dnie. Zwraca vec3 natężenia (barwa × moc).
 */
export const ballLight = (U, P, N) => {
  // źródło: kula w `U.off` (przy zrzucie spada i leży w leju), rozżarzona kupa albo metal w leju; promień źródła
  // `U.heap.z` (bez źródła moc `U.light.w` = 0)
  const Pb = vec3(0.0).toVar();
  Pb.assign(P.sub(U.off));
  const d2 = float(0.0).toVar();
  d2.assign(dot(Pb, Pb));
  const d = float(0.0).toVar();
  d.assign(sqrt(max(d2, 1.0)));
  const R = max(U.heap.z, 1.0);
  const geo = R.mul(R).div(max(d2, R.mul(R).mul(1.15)));
  const wrap = clamp(dot(N, Pb.div(d).negate()).add(0.32).div(1.32), 0.0, 1.0);
  return U.light.xyz.mul(U.light.w).mul(geo).mul(wrap).mul(U.t3.z);
};

/** Niebo z otwartej góry: słabsze w głębi studni, mocniejsze na ścianach zwróconych w górę. */
export const skyLight = (U, P, N) => {
  const open = smoothstep(float(KOMORA.floorY - 60), float(DECK + 40), P.y);
  return U.ambient.mul(N.y.mul(0.5).add(0.5).mul(0.7).add(0.3)).mul(open.mul(open).mul(0.72).add(0.28));
};

