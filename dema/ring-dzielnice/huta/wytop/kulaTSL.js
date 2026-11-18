// HUTA — wytop: MATERIAŁ KULI (TSL). Ciekły metal w nieważkości — wygląd zbudowany od prawdziwego ciekłego metalu,
// nie z efektów żaru gry (uwaga użytkownika 2026-11-15: słońce, lawa i rdzeń reaktora nie są wzorem):
//
//   • MAPA TEMPERATURY. Barwa i jasność każdego miejsca z jego temperatury (ciemna wiśnia → pomarańcz → żółty →
//     żółto-biały w najgorętszych punktach). Temperatura miejsca = temperatura kuli + pasy grzane przez cewki (stoją
//     w klatce: jaśniejsze, żółtawe) + strefa wsadu (chłodna, ciemnowiśniowa — tam wtapia się ruda) + wolne prądy
//     (duże, płynące pola żółto-białe i ciemnopomarańczowe — to one niosą wygląd czystej kuli) + komórki konwekcji
//     (spokojny jasny środek, miękka ciemniejsza granica; punkty komórek płyną, komórki rosną i zlewają się).
//     Baza pod progiem poświaty, ponad próg wychodzą tylko małe pola.
//   • LUSTRO. Powierzchnia jest gładka (żadnego szumu w normalnej) i odbija komorę policzoną analitycznie z geometrii:
//     ciemne niebo otwartej góry (krawędź szeroko rozmyta), segmenty cewek jako miękkie ciemne pasma — tym słabsze
//     i szersze, im dalej cewka od kuli (odsunięta pod ściany prawie nie rysuje się w odbiciu), lampy robocze ścian
//     jako szerokie, ciepłe, nierówne pasma, słońce jako stonowany, miękki odblask. Odbicia wyginają się z falami bryły.
//   • ŻUŻEL (jeden system — tylko wyspy z symulacji, w materiale kuli nie ma żadnych stałych plam): lżejsza, gęsta
//     ciecz pływająca po metalu. Wyspy z symulacji (kierunek, promień rysowany, żar kożucha) składają się w pole
//     „kropli” — suma gładka: dwie wyspy, które się zbliżają, łączy najpierw szyjka, potem zlewają się w jedną plamę.
//     Dziedzina pola jest pofalowana wolnymi prądami w układzie kuli, więc obrys wyspy jest nieregularny i płynie.
//     Wygląd niosą GRUBOŚĆ i TEMPERATURA żużla: cienki i świeży (brzeg wyspy, drobina po wtopieniu, okolica korzenia
//     nitki) żarzy się pomarańczem (ok. 0,45 emisji metalu) i przy brzegu prześwituje metalem; gruby środek czapy
//     stygnie w ciemniejszy KOŻUCH (ok. 0,1–0,15 emisji metalu) — płatami rozdzielonymi pasmami świeższej cieczy,
//     płynącymi z powierzchnią (wolny szum, bez komórek i pęknięć). Połysk szeroki i miękki (gęsta ciecz). Wyspa jest
//     WYPUKŁA: soczewka ma grubość (uniesienie siatki, normalna kopułki), zbocze od strony światła jest jaśniejsze,
//     metal przy brzegu od tej strony jaśnieje (menisk), po przeciwnej leży wąski cień kontaktowy — kropla leży NA
//     kuli, nie jest w niej dziurą. Pod dzwonem ssawy z czapy wyciąga się STOŻEK (korzeń nitki), czapa fałduje się ku niemu.
//
// KSZTAŁT: siatka kuli jednostkowej przemieszczana w wierzchołku — 12 modów drgań (te same harmoniki co symulacja,
// `kula.js`) + 32 zmarszczki od wtopień (pierścień fali biegnący po kuli) + soczewki żużla + stożek pod nitką ssawy.
// Normalna analityczna z gradientu, liczona w układzie komory.
// ZRZUT (cykl v2): w locie bryła jest WYDŁUŻONA w osi spadku (objętość zachowana) z lekkim „ogonem” u góry.
// MASA W LEJU (runda 4, decyzja użytkownika: kula po uderzeniu ma zostać JEDNĄ masą, która się odkształca): od
// zetknięcia z lejem metal rysuje OSOBNA SIATKA na polu grubości z symulacji (`masa.js` — płytka woda z lepkością na
// siatce biegunowej). Siatka to krąg nad całym dnem komory; wysokość wierzchołka = wykładzina stożka + grubość warstwy
// z pola (krzywa B-sklejana 3. stopnia po komórkach — powierzchnia gładka także na czole fałdy). Nad komórką z jeszcze
// niewlanym słupem kuli pole podaje wierzch tego słupa: w chwili zetknięcia siatka ma kształt kuli i od pierwszej
// klatki jest jedną bryłą z tym, co już rozlało się po stożku. Brzeg warstwy ma zaokrągloną wargę (gęsta ciecz),
// sucha wykładzina — siatka schowana pod stożkiem; nad gardzielą pustą komórkę środkową siatka wciąga w rurę (lej
// wiru). Materiał jest TEN SAM co kuli (wspólny fragment): żar z temperatury, lustro komory, komórki konwekcji tej
// samej wielkości co na kuli (odwzorowanie płaskie w jednostkach świata, płynne przejście z półkuli w ok. 0,3 s).
// BRZEG: ciecz rysowana jest tam, gdzie warstwa pola jest grubsza niż próg `MASS_EDGE.h` (piksel z cieńszym filmem
// odpada — mokrą wykładzinę z ciemnym żarem i szwami rysuje materiał leja); na brzegu menisk (normalna odchylona na
// zewnątrz), pas przy brzegu chłodniejszy, gruba masa jaśniejsza. Drobna fala ciężkiej cieczy (`MASS_RIPPLE`) niesie
// w lustrze odbicia ścian, lamp i wyświetlacza.
// ZASYSANIE (efekt, który użytkownik widział i chciał z powrotem — na tej samej powierzchni): przez CAŁY spływ
// gardziel ciągnie metal — obrót cieczy i wgłębienie nad gardzielą wychodzą z pola; materiał dokłada drobny rysunek:
// po lustrze biegną ku środkowi fale (pierścień + dwa skręcone ramiona spirali + trzy o przeciwnym skoku:
// nieregularne, nie idealne okręgi), wzór konwekcji i smugi spływu skręcają się w spiralę (szybciej ku gardzieli).
// `liquidMetal` — żar + lustro komory: wspólne dla kuli i masy w leju.
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Discard, Fn, If, Loop, abs, acos, atan, attribute, cameraProjectionMatrix, clamp, cos, cross, dot, exp, float, floor, fract, int, length, log, max, min, mix,
  mod, modelViewMatrix, normalize, pow, reflect, sin, smoothstep, sqrt, step, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { KOMORA, VORTEX } from './geometria.js';
import { MODE_NORM } from './kula.js';
import { POOL } from './komora.js';
import { MASA, MASS_EDGE } from './masa.js';
import { LUMA, cells3, heatColor, heatPower, noise3, skyLight, sunVis } from './wspolneTSL.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const PIT = KOMORA.pitR;
const NM = MODE_NORM;
const DSPL = KOMORA.display;
/** Promień wgłębienia wiru nad gardzielą [j.] i promień, na którym obrót powierzchni spada do połowy. */
const VR = KOMORA.funnel.throatR * VORTEX.radius;
const VR2 = 120;
/**
 * Fale zasysania na lustrze: amplituda [j.] (rośnie ku środkowi: 1 / √(r / r0 + 0,35)), długości fal trzech składowych
 * [j.] i ich prędkości fazowe [rad na radian skręcenia `U.vor.y`]; `cycle` — okres odświeżania smug spływu [rad skręcenia].
 */
export const SUCK = Object.freeze({
  amp: 7.0, r0: 120, l1: 96, l2: 158, l3: 63, w1: 2.3, w2: 1.5, w3: 2.9, cycle: 5.0,
  // rysunek fal w pikselu (ostrość i połysk grzbietów): `ampN` [j.] — wysokość fali, z której liczone jest nachylenie
  // normalnej, `crest` — wyostrzenie grzbietu (0 = sinus), `heat` — grzbiet jaśniejszy, dolina ciemniejsza [ułamek T]
  ampN: 6.5, crest: 0.2, heat: 0.075
});
/**
 * Masa w leju — rysunek brzegu warstwy: warga gęstej cieczy (`lip` j. ponad grubość z pola, narasta na `lipH` j.
 * grubości), sucha wykładzina `dryE` j. pod stożkiem; `plunge` — o ile pustą komórkę środkową siatka wciąga w rurę
 * gardzieli; `film` — pociemnienie ostygłej cienkiej warstwy (ułamek temperatury).
 */
export const MASS_LOOK = Object.freeze({ lip: 5.0, lipH: 2.6, dryE: 2.6, plunge: 96, film: 0.3 });
export { MASS_EDGE };
/**
 * Drobna fala ciężkiej cieczy na masie w leju (poniżej rozdzielczości pola): pięć fal płaskich [długość j., kierunek
 * rad, prędkość fazowa rad/s]; nachylenie każdej do `slope`. Żywa, gdy masa się kołysze (`U.mass2.z`), w spokoju
 * zostaje `calm` — w lustrze przesuwają się odbicia ścian, lamp i wyświetlacza (połysk jak na kuli).
 */
export const MASS_RIPPLE = Object.freeze({ waves: [[57, 0.4, 2.1], [86, 2.3, -1.6], [124, 4.0, 1.3], [171, 5.3, -1.0], [236, 1.2, 0.8]], slope: 0.07, calm: 0.3 });

/** Odchylenie powierzchni i gradient (R³) z 12 modów w kierunku jednostkowym `n`; `m` — tablica 3 × vec4 amplitud. */
function modeField(n, m) {
  const x = n.x;
  const y = n.y;
  const z = n.z;
  const xx = float(0.0).toVar();
  xx.assign(x.mul(x));
  const yy = float(0.0).toVar();
  yy.assign(y.mul(y));
  const zz = float(0.0).toVar();
  zz.assign(z.mul(z));
  const a = [];
  for (let i = 0; i < 12; i++) {
    const v = m.element(int(i >> 2));
    a.push((i & 3) === 0 ? v.x : (i & 3) === 1 ? v.y : (i & 3) === 2 ? v.z : v.w);
  }
  const t5 = xx.mul(3.0).sub(zz);                 // 3x² − z²
  const t7 = yy.mul(4.0).sub(xx).sub(zz);         // 4y² − x² − z²
  const t8 = yy.mul(2.0).sub(xx.mul(3.0)).sub(zz.mul(3.0));
  const h = float(0.0).toVar();
  h.assign(a[0].mul(NM[0]).mul(x).mul(z)
    .add(a[1].mul(NM[1]).mul(z).mul(y))
    .add(a[2].mul(NM[2]).mul(yy.mul(2.0).sub(xx).sub(zz)))
    .add(a[3].mul(NM[3]).mul(x).mul(y))
    .add(a[4].mul(NM[4]).mul(xx.sub(zz)))
    .add(a[5].mul(NM[5]).mul(z).mul(t5))
    .add(a[6].mul(NM[6]).mul(x).mul(y).mul(z))
    .add(a[7].mul(NM[7]).mul(z).mul(t7))
    .add(a[8].mul(NM[8]).mul(y).mul(t8))
    .add(a[9].mul(NM[9]).mul(x).mul(t7))
    .add(a[10].mul(NM[10]).mul(xx.sub(zz)).mul(y))
    .add(a[11].mul(NM[11]).mul(x).mul(xx.sub(zz.mul(3.0)))));
  const g = vec3(0.0).toVar();
  g.assign(vec3(z, 0.0, x).mul(a[0].mul(NM[0]))
    .add(vec3(0.0, z, y).mul(a[1].mul(NM[1])))
    .add(vec3(x.mul(-2.0), y.mul(4.0), z.mul(-2.0)).mul(a[2].mul(NM[2])))
    .add(vec3(y, x, 0.0).mul(a[3].mul(NM[3])))
    .add(vec3(x.mul(2.0), 0.0, z.mul(-2.0)).mul(a[4].mul(NM[4])))
    .add(vec3(x.mul(z).mul(6.0), 0.0, xx.mul(3.0).sub(zz.mul(3.0))).mul(a[5].mul(NM[5])))
    .add(vec3(y.mul(z), x.mul(z), x.mul(y)).mul(a[6].mul(NM[6])))
    .add(vec3(x.mul(z).mul(-2.0), y.mul(z).mul(8.0), yy.mul(4.0).sub(xx).sub(zz.mul(3.0))).mul(a[7].mul(NM[7])))
    .add(vec3(x.mul(y).mul(-6.0), yy.mul(6.0).sub(xx.mul(3.0)).sub(zz.mul(3.0)), y.mul(z).mul(-6.0)).mul(a[8].mul(NM[8])))
    .add(vec3(yy.mul(4.0).sub(xx.mul(3.0)).sub(zz), x.mul(y).mul(8.0), x.mul(z).mul(-2.0)).mul(a[9].mul(NM[9])))
    .add(vec3(x.mul(y).mul(2.0), xx.sub(zz), y.mul(z).mul(-2.0)).mul(a[10].mul(NM[10])))
    .add(vec3(xx.mul(3.0).sub(zz.mul(3.0)), 0.0, x.mul(z).mul(-6.0)).mul(a[11].mul(NM[11]))));
  return { h, g };
}

/** Segmenty cewek odbijane przez kulę: [wysokość osi, azymuty środków łuków °] — te same co w `wyposazenie.js`. */
export function padTiers() {
  const M = KOMORA.mach;
  return [[M.padY, M.upper], [-M.padY, M.lower]];
}

// zmienne o typie ze stałej, przypisane w miejscu (pułapki 29 i 40: miejsce obliczenia ustalone, bez rekurencji typów)
const F1 = (e) => { const v = float(0.0).toVar(); v.assign(e); return v; };
const V2 = (e) => { const v = vec2(0.0).toVar(); v.assign(e); return v; };
const V3 = (e) => { const v = vec3(0.0).toVar(); v.assign(e); return v; };
const V4 = (e) => { const v = vec4(0.0).toVar(); v.assign(e); return v; };
const sq = (e) => e.mul(e);

/**
 * Pole wysp żużla: każda wyspa to „kropla” exp(−A · (d² / r² − 1)) (d — cięciwa do środka, r — promień rysowany);
 * powierzchnia żużla = suma 1. Sąsiednie wyspy łączy szyjka, gdy odstęp brzegów spada poniżej ok. 0,25 promienia.
 */
const SLAG_A = 2.6;
const SLAG = KOMORA.slag;
/** Pofalowanie dziedziny pola prądami powierzchni [rad]: duże i drobne. */
const WARP1 = 0.11;
const WARP2 = 0.05;
/** Kierunek (w planie) i szerokość strefy wsadu: tam wtapia się większość ziaren (pomiar: `.tmp/huta/wytop/pomiar-wtopien.mjs`). */
const CHARGE_DIR = [0.875, -0.485];

/**
 * Otoczenie widziane w lustrze kuli: promień odbity (P, r) w układzie komory; `mu` — cos kąta patrzenia (odbicia są
 * tym bardziej rozmyte, im bliżej środka tarczy). Zwraca { c, L }:
 *   c — ile żaru komory wraca z tego kierunku (1 = rozgrzana ściana na wysokości kuli, mało = zimna cewka, czarne niebo),
 *   L — jasne źródła (słońce, lampy robocze ścian, obręcz lamp obrzeża) — wszystkie miękkie, bez ostrych kresek.
 */
function environment(U, P, r, sunV, mu) {
  const L = vec3(0.0).toVar();
  const soft = F1(mu.mul(1.1).add(0.5));              // 0,5 przy brzegu tarczy … 1,6 w środku
  const pxz = vec2(P.x, P.z);
  const rxz = vec2(r.x, r.z);
  // ściana: walec o promieniu studni
  const qa = F1(max(dot(rxz, rxz), 1e-5));
  const qb = F1(dot(pxz, rxz));
  const qc = dot(pxz, pxz).sub(PIT * PIT);
  const tW = F1(qb.negate().add(sqrt(max(qb.mul(qb).sub(qa.mul(qc)), 0.0))).div(qa));
  const yW = F1(P.y.add(r.y.mul(tW)));
  const hitW = V2(pxz.add(rxz.mul(tW)));
  const hdir = V2(hitW.div(max(length(hitW), 1.0)));
  const eW = F1(soft.mul(36.0));
  const low = F1(smoothstep(float(KOMORA.floorY).sub(eW), float(KOMORA.floorY).add(eW), yW));
  // (krawędź otworu komory szeroko rozmyta — ostra rysowała w kuli okrąg „kuli w kuli”)
  const up = F1(smoothstep(float(KOMORA.deckY).sub(eW.mul(3.4)), float(KOMORA.deckY).add(eW.mul(2.2)), yW));
  const onWall = F1(low.mul(float(1.0).sub(up)));
  // żar ściany: najjaśniejszy na wysokości kuli (ściana oświetlona przez kulę)
  const wallGlow = exp(sq(yW.div(340.0)).negate()).mul(0.42).add(0.58);
  const c = F1(mix(mix(float(0.72), wallGlow, low), U.t2.x, up));
  // lampy robocze ścian: szerokie, ciepłe pasma — każda lampa inna (długość, wysokość, jasność)
  const lampSum = float(0.0).toVar();
  const wS = F1(soft.mul(0.036));
  const inv = F1(float(2.0).div(wS.mul(wS)));
  for (const s of KOMORA.strips) {
    if (s.gain <= 0) continue;
    const cosd = hdir.x.mul(Math.cos(s.a)).add(hdir.y.mul(Math.sin(s.a)));
    const band = exp(float(1.0).sub(cosd).mul(inv).negate());
    const ends = float(1.0).sub(smoothstep(float(s.half).sub(eW), float(s.half).add(eW), abs(yW.sub(s.y))));
    lampSum.addAssign(band.mul(ends).mul(s.gain));
  }
  L.addAssign(vec3(1.0, 0.7, 0.4).mul(lampSum.mul(onWall).mul(float(0.44).div(soft)).mul(U.t4.z)));
  // pas WYŚWIETLACZA GRAWITACJI na środku wysokości ściany: miękki pierścień w barwie ekranu (poza przerwą zatoki)
  const dB = F1(yW.sub(DSPL.y).div(soft.mul(34.0).add(DSPL.half * 0.5)));
  const gapMid = (DSPL.gap0 + DSPL.gap1) / 2 * DEG;
  const gapCos = Math.cos((DSPL.gap1 - DSPL.gap0) / 2 * DEG);
  const inGap = smoothstep(gapCos - 0.03, gapCos + 0.03, hdir.x.mul(Math.cos(gapMid)).add(hdir.y.mul(Math.sin(gapMid))));
  L.addAssign(U.dcol.mul(exp(sq(dB).negate()).mul(onWall).mul(float(1.0).sub(inGap)).mul(float(0.26).div(soft)).mul(U.t4.z)));
  // otwarta góra: czarne niebo, stonowany odblask słońca, słaba ciągła obręcz lamp obrzeża
  const sd = F1(max(dot(r, U.sunDir), 0.0));
  const glint = pow(sd, 500.0).mul(0.45).add(pow(sd, 60.0).mul(0.14)).add(pow(sd, 9.0).mul(0.035));
  L.addAssign(U.sunColor.mul(glint.mul(up).mul(sunV).mul(U.t2.z)));
  L.addAssign(vec3(0.01, 0.016, 0.03).mul(up));
  const tTop = float(KOMORA.deckY).sub(P.y).div(max(r.y, 0.02));
  const qTop = V2(pxz.add(rxz.mul(tTop)));
  const rimD = length(qTop).sub(PIT - 6).div(soft.mul(34.0));
  L.addAssign(vec3(0.16, 0.5, 0.6).mul(exp(sq(rimD.mul(0.6)).negate()).mul(step(0.02, r.y)).mul(0.06).mul(U.t4.z)));
  // segmenty cewek: łuki w dwóch płaszczyznach poziomych, na promieniu pierścienia i wysokości z symulacji
  // (`U.mach.y`, `U.mach.w` — jadą z maszynerią) — chłodzona miedź: miękkie ciemne pasma
  const ringR = U.mach.y;
  const halfCos = Math.cos(31 * DEG);
  for (const [py, list] of padTiers()) {
    // (wysokość osi segmentów ze stanu: `U.mach.w` nad i pod równikiem, razem ze środkiem klatki)
    const tc = F1(U.mach.w.mul(Math.sign(py)).add(U.cage.y).sub(P.y).div(r.y.add(step(0.0, r.y).mul(2e-3).sub(1e-3))));
    const qh = V2(pxz.add(rxz.mul(tc)));
    const ql = F1(max(length(qh), 1.0));
    const dd = abs(ql.sub(ringR));
    // odbicie cewki słabnie i rozmywa się z jej odległością od kuli: przy grzaniu (cewka kilkadziesiąt jednostek
    // od powierzchni) to wyraźne ciemne pasmo, odsunięta pod ściany albo wysoko nad spadającą kulą — ledwie cień
    // (ostre pasmo dalekiego pierścienia rysowało w czystej kuli okrąg jak druga kula w środku)
    const far = F1(max(tc, 0.0).div(270.0));
    const w = float(KOMORA.coilTube).mul(soft.mul(0.9).add(0.6)).mul(far.mul(0.9).add(1.0)).div(max(abs(r.y), 0.3));
    const m = float(0.0).toVar();
    m.assign(exp(sq(dd.div(w)).negate()).mul(step(0.0, tc)).div(far.mul(far).mul(1.6).add(1.0)));
    const arc = float(0.0).toVar();
    for (const deg of list) {
      const ac = deg * DEG;
      arc.addAssign(smoothstep(halfCos - 0.1, halfCos + 0.1, qh.x.mul(Math.cos(ac)).add(qh.y.mul(Math.sin(ac))).div(ql)));
    }
    m.mulAssign(min(arc, 1.0));
    c.assign(mix(c, float(0.2), m.mul(0.85)));
  }
  return { c, L };
}

/**
 * Kierunek `n` (układ komory) przesunięty po sferze wolnymi prądami powierzchni (wzór w układzie wirującym z kulą:
 * `ca`, `sa` — kosinus i sinus kąta obrotu) — pole wysp czytane w tym kierunku daje nieregularny, płynący obrys.
 * Przy samym biegunie przesunięcia nie ma: korzeń nitki ssawy stoi dokładnie w osi czapy.
 */
function slagDomain(n, ca, sa, time) {
  const q = V3(vec3(n.x.mul(ca).sub(n.z.mul(sa)), n.y, n.x.mul(sa).add(n.z.mul(ca))));
  const t1 = F1(time.mul(0.045));
  const a = V3(vec3(noise3(q.mul(3.1).add(vec3(3.7, t1, 0.0))), noise3(q.mul(3.1).add(vec3(0.0, 9.2, t1))), noise3(q.mul(3.1).add(vec3(t1, 0.0, 17.3)))).sub(0.5));
  const b = V3(vec3(noise3(q.mul(8.3).add(vec3(1.3, 0.0, t1))), noise3(q.mul(8.3).add(vec3(t1, 5.1, 0.0))), noise3(q.mul(8.3).add(vec3(0.0, t1, 11.9)))).sub(0.5));
  const pole = F1(smoothstep(0.02, 0.4, length(n.sub(vec3(0.0, 1.0, 0.0)))));
  const wq = V3(a.mul(WARP1).add(b.mul(WARP2)).mul(pole));
  const w = V3(vec3(wq.x.mul(ca).add(wq.z.mul(sa)), wq.y, wq.z.mul(ca).sub(wq.x.mul(sa))));
  return V3(normalize(n.add(w.sub(n.mul(dot(w, n))))));
}

/**
 * Pole wysp żużla w kierunku `nW`. Zwraca { sd, F, heat, out, rw }: sd — odległość do brzegu żużla [cięciwa; < 0 w
 * wyspie, 1 daleko od wszystkich], heat — żar kożucha (średnia ważona wysp), out — wektor „od środka wyspy”
 * (nieunormowany), rw — promień wyspy, która tu rządzi. `full` = false — sama odległość (wierzchołki).
 */
function slagField(U, nW, name, full) {
  const F = float(0.0).toVar();
  const Rw = float(0.0).toVar();
  const Hw = float(0.0).toVar();
  const Gv = vec3(0.0).toVar();
  Loop({ start: int(0), end: int(U.slag2.x), type: 'int', condition: '<', name }, (o) => {
    const k = o[name];
    const fa = V4(U.floes.element(k.mul(2)));
    const dv = V3(nW.sub(fa.xyz));
    const r2 = F1(fa.w.mul(fa.w).add(1e-9));
    const f = F1(exp(dot(dv, dv).div(r2).sub(1.0).mul(-SLAG_A)).mul(step(1e-4, fa.w)));
    F.addAssign(f);
    Rw.addAssign(f.mul(fa.w));
    if (full) {
      const fb = U.floes.element(k.mul(2).add(1));
      Hw.addAssign(f.mul(fb.x));
      Gv.addAssign(dv.mul(f.div(r2)));
    }
  });
  const Fs = F1(max(F, 1e-6));
  const rw = F1(Rw.div(Fs));
  const sd = F1(mix(log(Fs).mul(rw).mul(-1 / (2 * SLAG_A)), float(1.0), step(F, 1e-6)));
  return { sd, F, heat: Hw.div(Fs), out: Gv, rw };
}

/**
 * CIEKŁY METAL: żar z temperatury miejsca `Tl` (barwa i moc) + lustro komory (odbicie policzone z geometrii). Wspólne
 * dla kuli, jeziora w leju i brył odbitych — ten sam materiał, nie „świecące kulki”. `mu` = cos kąta patrzenia.
 * Zwraca { metal, hc, hp, E, limb }.
 */
export function liquidMetal(U, P, N, V, mu, Tl, sunV, gloss = null) {
  const r = V3(reflect(V.negate(), N));
  const E = environment(U, P, r, sunV, mu);
  const eps = U.t1.y;
  const limb = F1(pow(max(mu, 1e-4), U.t3.x).mul(U.t3.y).add(float(1.0).sub(U.t3.y)));
  const om = F1(float(1.0).sub(mu));
  const fres = F1(om.mul(om).mul(om).mul(om).mul(om).mul(0.5).add(0.5));
  const hc = V3(heatColor(U, Tl));
  const hp = F1(heatPower(Tl).mul(U.t1.x).mul(U.t4.x));
  const metal = V3(hc.mul(hp.mul(eps.add(float(1.0).sub(eps).mul(E.c))).mul(limb)).add(U.limb.xyz.mul(U.limb.w.mul(hp).mul(om.mul(om).mul(om)).mul(0.5)))
    .add(E.L.mul(fres).mul(gloss ? U.t2.y.mul(gloss) : U.t2.y)));
  return { metal, hc, hp, E, limb };
}

/**
 * Materiały ciekłego metalu: `ball` — kula (siatka kuli jednostkowej), `mass` — masa w leju (siatka nad dnem komory
 * na polu grubości z symulacji). Fragment wspólny (ten sam węzeł): masa w leju jest tym samym metalem co kula.
 */
export function createMetalMaterials(U) {
  const vDir = varyingProperty('vec3', 'vWkDir');
  const vNor = varyingProperty('vec3', 'vWkNor');
  const vPos = varyingProperty('vec3', 'vWkPos');
  const vPool = varyingProperty('vec2', 'vWkPool');
  const vFilm = varyingProperty('vec2', 'vWkFilm');
  const vGrad = varyingProperty('vec2', 'vWkGrad');
  const FUN = KOMORA.funnel;
  const FSL = (FUN.rimR - FUN.throatR) / (FUN.rimY - FUN.throatY);

  const vertex = Fn(() => {
    const n = V3(normalize(attribute('position', 'vec3')));
    const F = modeField(n, U.modes);
    const h = float(0.0).toVar();
    h.assign(F.h);
    // gradient styczny modów (wielomian jednorodny: część radialna gradientu odpada)
    const G = vec3(0.0).toVar();
    G.assign(F.g.sub(n.mul(dot(F.g, n))));
    // zmarszczki od wtopień: pierścień fali biegnący po kuli od miejsca uderzenia
    const speed = U.ball2.x;
    const A0 = U.t2.w;
    Loop({ start: 0, end: POOL.ripples, type: 'int', condition: '<', name: 'wr' }, ({ wr }) => {
      const rp = V4(U.ripples.element(wr));
      const amp = F1(length(rp.xyz));
      const d = V3(rp.xyz.div(max(amp, 1e-5)));
      const cth = F1(clamp(dot(n, d), -0.9999, 0.9999));
      const ang = F1(acos(cth));
      const age = rp.w;
      const xw = F1(ang.sub(speed.mul(age)));
      const env = F1(exp(sq(xw.div(0.2)).negate()).mul(exp(age.div(0.55).negate())).mul(smoothstep(0.0, 0.07, age)).mul(amp).mul(A0));
      const ph = xw.mul(15.0);
      h.addAssign(env.mul(cos(ph)));
      const dh = env.mul(xw.mul(-2.0 / (0.2 * 0.2)).mul(cos(ph)).sub(sin(ph).mul(15.0)));
      // jednostkowy wektor styczny „od miejsca uderzenia”
      const away = n.mul(cth).sub(d).div(max(sqrt(float(1.0).sub(cth.mul(cth))), 0.05));
      G.addAssign(away.mul(dh));
    });
    // żużel: soczewka gęstej cieczy leży na metalu (grubsza w głębi wyspy); pod dzwonem ssawy z czapy wyciąga się
    // stożek o ostrym wierzchołku — korzeń nitki
    const fld = slagField(U, slagDomain(n, cos(U.ball.y), sin(U.ball.y), U.ball.w), 'wf', false);
    const lens = F1(float(1.0).sub(exp(max(fld.sd.negate(), 0.0).div(-SLAG.liftDepth))).mul(SLAG.lift));
    const pd = F1(length(n.sub(vec3(0.0, 1.0, 0.0))));
    const cone = F1(U.ball2.z.mul(exp(pd.div(U.ball2.w).negate())));
    const awayP = V3(n.mul(n.y).sub(vec3(0.0, 1.0, 0.0)).div(max(sqrt(max(float(1.0).sub(n.y.mul(n.y)), 0.0)), 0.03)));
    G.addAssign(awayP.mul(cone.div(U.ball2.w).negate()));
    const hh = F1(h.add(lens).add(cone));
    const N0 = V3(normalize(n.mul(hh.add(1.0)).sub(G)));
    const p0 = V3(n.mul(U.ball.x.mul(hh.add(1.0))));
    // ZRZUT. W locie bryła jest wydłużona w osi spadku (`sy` > 1, objętość zachowana) i zwęża się u góry w „ogon”.
    // Od zetknięcia z lejem metal rysuje siatka masy (`massVertex`) — kula znika w tej samej klatce.
    const sy = U.fall.x;
    const sxz = U.fall.y;
    const tl = F1(U.slag2.z.mul(max(n.y, 0.0)).mul(max(n.y, 0.0)));
    const kx = F1(sxz.mul(float(1.0).sub(tl.mul(0.11))));
    const ky = F1(sy.mul(tl.mul(0.05).add(1.0)));
    const ps = V3(vec3(p0.x.mul(kx), p0.y.mul(ky), p0.z.mul(kx)));
    const Ns = V3(normalize(vec3(N0.x.div(kx), N0.y.div(ky), N0.z.div(kx))));
    vDir.assign(n);
    vNor.assign(Ns);
    vPos.assign(ps);
    vPool.assign(vec2(0.0, 0.0));
    vFilm.assign(vec2(1000.0, 0.0));
    vGrad.assign(vec2(0.0, 0.0));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(ps, 1.0)));
  })();

  // --- MASA W LEJU: siatka nad dnem komory na polu grubości --------------------------------------------------------
  const NRM = MASA.nr;
  const NAM = MASA.na;
  const NCM = NRM * NAM;
  const R0M = FUN.throatR;
  const DRM = (PIT - R0M) / NRM;
  const DTM = TAU / NAM;
  /** Wagi krzywej B-sklejanej 3. stopnia dla ułamka `t` (cztery sąsiednie komórki). */
  const bspline = (t) => {
    const t2 = F1(t.mul(t));
    const t3 = F1(t2.mul(t));
    const om = F1(float(1.0).sub(t));
    return [
      F1(om.mul(om).mul(om).div(6.0)),
      F1(t3.mul(3.0).sub(t2.mul(6.0)).add(4.0).div(6.0)),
      F1(t3.mul(-3.0).add(t2.mul(3.0)).add(t.mul(3.0)).add(1.0).div(6.0)),
      F1(t3.div(6.0))
    ];
  };
  /**
   * Pole w punkcie (promień `r`, azymut `fk` w wycinkach): 4 × 4 komórki z wagami B-sklejanymi. Zwraca vec4:
   * x — grubość rysowana, y — ostygnięcie, z — WYSOKOŚĆ LUSTRA (wykładzina komórki + grubość, sklejana osobno: gruba
   * masa ma gładką powierzchnię także nad załamaniem wykładziny przy gardzieli), w — 0. Za ostatnim pierścieniem —
   * ściana studni (ostatni pierścień powtórzony); po obwodzie pole się zamyka. Nad gardzielą (przed pierwszym
   * pierścieniem) pole ma jedną komórkę środkową: wiersze „wirtualne” przechodzą po promieniu od wartości środkowej
   * (w osi) do pierwszego pierścienia na tym samym azymucie — część wspólna dla całego obwodu (średnia pierścienia,
   * `U.mass2.x`) parabolą (w osi płasko: kopuła), reszta liniowo (pochylenie) — bez krążka z rantem i bez ostrza w osi.
   */
  /** Próg grubości, od którego warstwa jest rysowana jako ciecz, na promieniu `r` (niższy przy gardzieli). */
  const edgeH = (r) => mix(float(MASS_EDGE.hThroat), float(MASS_EDGE.h), smoothstep(R0M * 1.15, 300.0, r));
  const RC0 = R0M + 0.5 * DRM;
  const ZB0 = FUN.throatY + 0.5 * DRM / FSL;
  const cellAt = (r, fk) => {
    const fj = F1(r.sub(R0M).div(DRM).sub(0.5));
    const j0 = F1(floor(fj));
    const wj = bspline(F1(fj.sub(j0)));
    const fi = F1(fk.sub(0.5));
    const i0 = F1(floor(fi));
    const wi = bspline(F1(fi.sub(i0)));
    const kfs = [0, 1, 2, 3].map((b) => F1(mod(i0.add(b - 1 + NAM), float(NAM))));
    const centre = V4(U.masa.element(int(NCM)));
    const row0 = vec4(0.0).toVar();
    for (let b = 0; b < 4; b++) row0.addAssign(U.masa.element(int(kfs[b].add(0.5))).mul(wi[b]));
    const mean0 = U.mass2.x;
    const acc = vec4(0.0).toVar();
    for (let a = 0; a < 4; a++) {
      const jf = F1(j0.add(a - 1));
      const inC = F1(step(jf, -0.5));
      const jc = F1(clamp(jf, 0.0, NRM - 1));
      const row = vec4(0.0).toVar();
      for (let b = 0; b < 4; b++) row.addAssign(U.masa.element(int(jc.mul(NAM).add(kfs[b]).add(0.5))).mul(wi[b]));
      // wysokość wykładziny w komórkach tego pierścienia
      const zbRow = jc.add(0.5).mul(DRM / FSL).add(FUN.throatY);
      // wiersz wirtualny nad gardzielą: promień RC0 + jf · DRM (≤ 0 — sama komórka środkowa)
      const u = F1(clamp(jf.mul(DRM).add(RC0).div(RC0), 0.0, 1.0));
      const virt = V4(mix(centre, row0, u));
      const virtE = centre.x.add(FUN.throatY).add(mean0.add(ZB0).sub(centre.x.add(FUN.throatY)).mul(u.mul(u))).add(row0.x.sub(mean0).mul(u));
      const val = V4(mix(row, virt, inC));
      const elev = mix(row.x.add(zbRow), virtE, inC);
      acc.addAssign(vec4(val.x, val.y, elev, 0.0).mul(wj[a]));
    }
    return acc;
  };
  /**
   * Wysokość powierzchni masy [y komory]. Cienka warstwa leży na wykładzinie stożka (grubość `c.x` z wargą na brzegu;
   * sucha wykładzina — siatka pod stożkiem), gruba masa ma powierzchnię ze sklejanej wysokości lustra `c.z` (gładką);
   * do tego fale zasysania biegnące ku gardzieli i wciągnięcie pustego środka w rurę gardzieli.
   */
  const surfaceY = (r, fk, c) => {
    const h = F1(max(c.x, 0.0));
    const bed = float(FUN.throatY).add(max(r.sub(R0M), 0.0).div(FSL));
    const an = F1(fk.mul(DTM));
    const vk = U.vor.x;
    const tw = U.vor.y;
    const rcL = max(U.vor.w, float(R0M));
    const env = F1(vk.mul(SUCK.amp).div(sqrt(r.div(SUCK.r0).add(0.35))).mul(float(1.0).sub(smoothstep(0.74, 0.98, r.div(rcL)))).mul(smoothstep(0.3, 1.0, r.div(VR)))
      .mul(smoothstep(8.0, 30.0, h)));
    const sw = sin(r.mul(TAU / SUCK.l1).add(tw.mul(SUCK.w1))).mul(0.55)
      .add(sin(r.mul(TAU / SUCK.l2).add(an.mul(2.0)).add(tw.mul(SUCK.w2))).mul(0.45))
      .add(sin(r.mul(TAU / SUCK.l3).sub(an.mul(3.0)).add(tw.mul(SUCK.w3))).mul(0.22));
    // (warga wynurza się z wykładziny na progu grubości `edgeH` — cieńszy film to mokra wykładzina, siatka pod nią)
    const eh = F1(h.sub(edgeH(r)));
    const lip = bed.add(max(eh, float(-MASS_LOOK.dryE))).add(float(MASS_LOOK.lip).mul(float(1.0).sub(exp(max(eh, 0.0).div(-MASS_LOOK.lipH)))));
    const thick = F1(smoothstep(14.0, 50.0, h));
    const plunge = float(MASS_LOOK.plunge).mul(float(1.0).sub(smoothstep(R0M * 0.6, R0M * 0.98, r))).mul(exp(h.div(-16.0)));
    return mix(lip, c.z.add(MASS_LOOK.lip - MASS_LOOK.dryE), thick).add(env.mul(sw)).sub(plunge);
  };
  const massVertex = Fn(() => {
    const p0 = attribute('position', 'vec3');
    const rt = attribute('aRT', 'vec2');                      // promień [j.], azymut [wycinki pola]
    const r = F1(rt.x);
    const fk = F1(rt.y);
    const c0 = V4(cellAt(r, fk));
    // normalna z różnic skończonych tej samej powierzchni (po promieniu i po obwodzie)
    const DR = 3.0;
    const DF = 0.2;
    const cR = V4(cellAt(r.add(DR), fk));
    const cT = V4(cellAt(r, fk.add(DF)));
    const y0 = F1(surfaceY(r, fk, c0));
    const yR = F1(surfaceY(r.add(DR), fk, cR));
    const yT = F1(surfaceY(r, fk.add(DF), cT));
    const tr = F1(yR.sub(y0).div(DR));
    const ts = F1(yT.sub(y0).div(max(r, 14.0).mul(DF * DTM)));
    const ca = F1(cos(fk.mul(DTM)));
    const sa = F1(sin(fk.mul(DTM)));
    const N = V3(normalize(vec3(ts.mul(sa).sub(tr.mul(ca)), 1.0, tr.mul(sa).negate().sub(ts.mul(ca)))));
    const pc = V3(vec3(p0.x, y0, p0.z));
    // gradient grubości warstwy w planie (kierunek „w głąb jeziora”) — do menisku na brzegu
    const gr = F1(cR.x.sub(c0.x).div(DR));
    const gs = F1(cT.x.sub(c0.x).div(max(r, 14.0).mul(DF * DTM)));
    vGrad.assign(vec2(gr.mul(ca).sub(gs.mul(sa)), gr.mul(sa).add(gs.mul(ca))));
    // wzór powierzchni (prądy, komórki konwekcji): w chwili zetknięcia odwzorowanie jest półkulą kuli (`U.mass.x` =
    // jej promień) — wzór ciągły z kulą; w ok. 0,3 s przechodzi w odwzorowanie PŁASKIE w jednostkach świata
    // (`U.mass2.y`: 0 → 1; punkt jeziora odległy o promień kuli od osi = 1 radian na kuli) — komórki konwekcji na
    // masie mają tę samą wielkość co na kuli, nie rozciągają się z rozlewającą się masą
    const rel = V2(vec2(p0.x.sub(U.mass.z), p0.z.sub(U.mass.w)));
    const Rm = U.mass.x;
    const kp = U.mass2.y;
    const up = F1(mix(sqrt(max(Rm.mul(Rm).sub(dot(rel, rel)), 0.0)).add(Rm.mul(0.15)), Rm, kp));
    const dv = V3(vec3(rel.x, up, rel.y));
    vDir.assign(dv.div(mix(length(dv), Rm, kp)));
    vNor.assign(N);
    vPos.assign(pc.sub(U.off));
    vPool.assign(vec2(U.mass.y, r.div(max(U.vor.w, 1.0))));
    vFilm.assign(vec2(c0.x, c0.y));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(pc, 1.0)));
  })();

  const fragment = Fn(() => {
    const n0 = V3(normalize(vDir));
    const P = V3(vPos.add(U.off));                 // układ komory (siatka kuli stoi w `U.off`)
    const T = U.ball.z;
    const time = U.ball.w;
    // MASA W LEJU: grubość warstwy pod pikselem; kula ma `vFilm.x` = 1000 (wszystko niżej jej nie dotyczy)
    const hF = F1(vFilm.x);
    const isMass = F1(step(hF, 500.0));
    const rrL = F1(length(vec2(P.x, P.z)));
    const hE = F1(edgeH(rrL));
    // cieńszy film nie jest rysowany jako ciecz (mokrą wykładzinę rysuje materiał leja): jezioro ma BRZEG
    Discard(isMass.greaterThan(0.5).and(hF.lessThan(hE)));
    const N = vec3(0.0).toVar();
    N.assign(normalize(vNor));
    {
      // drobna fala ciężkiej cieczy: suma fal płaskich o fazie pofalowanej wolnym szumem (bez prostych, równych prążków)
      const wph = F1(noise3(vec3(P.x.mul(0.0052), time.mul(0.11), P.z.mul(0.0052))).mul(5.0));
      const g = vec2(0.0).toVar();
      MASS_RIPPLE.waves.forEach(([len, ang, w], i) => {
        const dx = Math.cos(ang);
        const dz = Math.sin(ang);
        const ph = P.x.mul(dx * TAU / len).add(P.z.mul(dz * TAU / len)).add(time.mul(w)).add(wph.mul(i % 2 ? -1.0 : 1.0)).add(i * 1.7);
        g.addAssign(vec2(dx, dz).mul(cos(ph)));
      });
      const amp = F1(isMass.mul(U.mass2.z.mul(1.0 - MASS_RIPPLE.calm).add(MASS_RIPPLE.calm)).mul(MASS_RIPPLE.slope).mul(smoothstep(0.0, 14.0, hF.sub(hE))));
      // FALE ZASYSANIA w pikselu: te same trzy składowe co w wierzchołku (pierścień + dwa skręcone ramiona), grzbiety
      // wyostrzone — nachylenie normalnej wzdłuż promienia daje ostre, lśniące kręgi zbiegające się ku gardzieli
      const anS = F1(atan(P.z, P.x));
      const twS = U.vor.y;
      const envS = F1(float(1.0).div(sqrt(rrL.div(SUCK.r0).add(0.35))).mul(float(1.0).sub(smoothstep(0.74, 0.98, clamp(vPool.y, 0.0, 1.2)))).mul(smoothstep(0.3, 1.0, rrL.div(VR)))
        .mul(smoothstep(4.0, 22.0, hF.sub(hE))));
      const sharp = (ph, k) => cos(ph).mul(sin(ph).mul(4.0 * SUCK.crest).add(1.0)).mul(k);
      const dW = F1(sharp(rrL.mul(TAU / SUCK.l1).add(twS.mul(SUCK.w1)), 0.55 * TAU / SUCK.l1)
        .add(sharp(rrL.mul(TAU / SUCK.l2).add(anS.mul(2.0)).add(twS.mul(SUCK.w2)), 0.45 * TAU / SUCK.l2))
        .add(sharp(rrL.mul(TAU / SUCK.l3).sub(anS.mul(3.0)).add(twS.mul(SUCK.w3)), 0.22 * TAU / SUCK.l3)));
      const slopeS = F1(isMass.mul(U.vor.x).mul(clamp(vPool.x, 0.0, 1.0)).mul(SUCK.ampN).mul(envS).mul(dW));
      const rhat = V2(vec2(P.x, P.z).div(max(rrL, 1.0)));
      g.assign(g.mul(amp).add(rhat.mul(slopeS)));
      // MENISK na brzegu jeziora: normalna odchyla się na zewnątrz (ku cieńszej warstwie)
      const gl = F1(max(length(vGrad), 1e-3));
      const bead = F1(isMass.mul(float(1.0).sub(smoothstep(0.0, MASS_EDGE.bead, hF.sub(hE)))).mul(smoothstep(0.03, 0.25, gl)));
      const outw = V2(vGrad.div(gl).negate());
      N.assign(normalize(N.mul(float(1.0).sub(bead.mul(0.5))).add(vec3(outw.x, 0.0, outw.y).mul(bead.mul(0.95))).sub(vec3(g.x, 0.0, g.y))));
    }
    const V = V3(normalize(U.cam.sub(P)));
    const mu = F1(clamp(dot(N, V), 0.0, 1.0));
    const shore = F1(isMass.mul(float(1.0).sub(smoothstep(0.0, MASS_EDGE.w, hF.sub(hE)))));
    const deep = F1(isMass.mul(smoothstep(12.0, 80.0, hF)));
    const pxAng = U.frame.w;                // kąt jednego piksela na kuli [rad]
    const sunV = F1(sunVis(U, P));
    const coilPower = U.glow.x;
    // lustro metalu w leju (zrzut): płaska tafla — bez pasów grzania kuli, jaśniejszy menisk przy ścianie stożka,
    // środek odbija czarne niebo otwartej góry (tafla nie może się czytać jak wypukła kula)
    const flatK = F1(clamp(vPool.x, 0.0, 1.0));
    const rhoN = F1(clamp(vPool.y, 0.0, 1.2));

    // --- wzory w układzie wirującym z kulą ---------------------------------------
    // ZASYSANIE na lustrze: powierzchnia jeziora obraca się, szybciej ku gardzieli — wzór skręca się w spiralę (do ok.
    // 0,9 obrotu różnicy, potem obraca się dalej jako całość); SMUGI SPŁYWU niesie ten sam wir bez końca: dwie warstwy
    // wzoru odświeżane na zmianę (każda skręca się przez swój okres i gaśnie, zanim skręt ją rozmaże)
    const anL = F1(atan(P.z, P.x));
    const twl = U.vor.y;
    const vkF = F1(U.vor.x.mul(flatK));
    const coreL = F1(float(VR2).div(rrL.add(VR2)));
    const phiL = F1(flatK.mul(twl.mul(0.3).add(min(twl, 6.0).mul(0.95).mul(coreL))));
    const flowLayer = (off) => {
      const ph = F1(fract(twl.div(SUCK.cycle).add(off)));
      const a2 = F1(anL.add(ph.sub(0.5).mul(SUCK.cycle).mul(coreL.mul(1.7).add(0.3))).add(twl.mul(0.3)));
      return noise3(vec3(cos(a2).mul(2.7), sin(a2).mul(2.7), rrL.div(36.0).add(off * 7.3))).mul(float(1.0).sub(abs(ph.mul(2.0).sub(1.0))));
    };
    const flowS = F1(flowLayer(0.0).add(flowLayer(0.5)).sub(0.25).mul(2.0));
    const envF = F1(float(1.0).div(sqrt(rrL.div(SUCK.r0).add(0.35))).mul(float(1.0).sub(smoothstep(0.74, 0.98, rhoN))).mul(smoothstep(0.3, 1.0, rrL.div(VR))));
    // (profil z wyostrzonym grzbietem: sin φ − `crest` · cos 2φ — wąski jasny grzbiet, szeroka ciemniejsza dolina)
    const crestW = (ph) => sin(ph).sub(cos(ph.mul(2.0)).mul(SUCK.crest));
    const waveF = F1(crestW(rrL.mul(TAU / SUCK.l1).add(twl.mul(SUCK.w1))).mul(0.55)
      .add(crestW(rrL.mul(TAU / SUCK.l2).add(anL.mul(2.0)).add(twl.mul(SUCK.w2))).mul(0.45))
      .add(crestW(rrL.mul(TAU / SUCK.l3).sub(anL.mul(3.0)).add(twl.mul(SUCK.w3))).mul(0.22)));
    const eye = F1(exp(sq(rrL.div(VR)).negate()));
    const suckT = F1(vkF.mul(flowS.sub(0.5).mul(0.15).mul(envF.mul(0.6).add(0.4)).add(waveF.mul(envF).mul(SUCK.heat)).sub(eye.mul(0.16))));
    const ca = cos(U.ball.y.add(phiL));
    const sa = sin(U.ball.y.add(phiL));
    // (na masie w leju wzór czytany w odwzorowaniu płaskim — `vDir` nieunormowany; na kuli to kierunek jednostkowy)
    const nq = V3(mix(n0, vDir, isMass));
    const q = V3(vec3(nq.x.mul(ca).sub(nq.z.mul(sa)), nq.y, nq.x.mul(sa).add(nq.z.mul(ca))));
    // wolne prądy: duże pola cieplejsze i chłodniejsze, płynące powoli
    const slow = F1(noise3(q.mul(1.5).add(vec3(0.0, time.mul(0.045), 0.0))));
    const slow2 = F1(noise3(q.mul(2.6).add(vec3(time.mul(0.035), 7.3, 0.0))));
    // komórki konwekcji: dziedzina pofalowana wolnym szumem — komórki różnej wielkości i kształtu, nie siatka
    const warp = V3(vec3(noise3(q.mul(2.7).add(vec3(11.0, time.mul(0.03), 0.0))), noise3(q.mul(2.7).add(vec3(0.0, 23.0, time.mul(0.03)))), noise3(q.mul(2.7).add(vec3(time.mul(0.03), 0.0, 37.0)))).sub(0.5));
    // komórki z punktami płynącymi w czasie: jasny, spokojny środek i CIENKA ciemniejsza granica (miękka — to rynna
    // chłodniejszego metalu, nie kreska); komórki rosną, kurczą się i zlewają
    const cell = V4(cells3(q.mul(U.t1.z).add(warp.mul(1.6)), time.mul(0.36)));
    const lane = F1(float(1.0).sub(smoothstep(0.0, 0.4, cell.y.sub(cell.x))));
    const core = F1(float(1.0).sub(smoothstep(0.0, 0.85, cell.x)));
    // z daleka (komórka kilka pikseli) wzór blednie zamiast migotać; komórki są wszędzie, najżywsze w gorących polach
    const cellPx = float(1.0).div(max(pxAng.mul(U.t1.z), 1e-4));
    const vigor = F1(smoothstep(0.26, 0.7, slow2).mul(0.82).add(0.18).mul(clamp(cellPx.sub(3.0).div(7.0), 0.0, 1.0)).mul(U.t1.w));
    const cellT = F1(vigor.mul(core.mul(0.05).sub(lane.mul(lane).mul(lane).mul(0.05)).add(cell.z.sub(0.5).mul(0.03))));
    // wolne prądy: duże pola żółto-białe i ciemnopomarańczowe (rozpiętość dwa razy większa niż przy plamkach tlenków)
    const tzone = F1(slow.sub(0.5).mul(0.7).add(slow2.sub(0.5).mul(0.26)).mul(mix(float(1.0), float(MASS_EDGE.zones), isMass.mul(flatK))));
    // pasy grzane przez cewki (stoją w klatce): szerokość geograficzna cewek ±35° i czap ±75°
    const ay = abs(n0.y);
    const bandH = F1(exp(sq(ay.sub(0.57).div(0.2)).negate()).add(exp(sq(ay.sub(0.97).div(0.12)).negate()).mul(0.6)));
    const bandStreak = F1(noise3(vec3(q.x.mul(2.2), q.y.mul(5.0), q.z.mul(2.2)).add(vec3(0.0, 0.0, time.mul(0.05)))));
    // strefa wsadu: pas wokół równika po stronie, z której przychodzi struga; smugi ciągnięte obrotem
    const cosd = n0.x.mul(CHARGE_DIR[0]).add(n0.z.mul(CHARGE_DIR[1])).div(max(length(vec2(n0.x, n0.z)), 0.05));
    const zone = exp(sq(n0.y.add(0.07).div(0.36)).negate()).mul(exp(float(1.0).sub(cosd).mul(-1.5)).mul(0.7).add(0.3));
    const chillAmt = F1(U.port.w.mul(zone));

    // --- wtopienia: jasny pierścień rozchodzący się po powierzchni i chwilowa ciemna plama (chłodny wsad) --------
    const ring = float(0.0).toVar();
    const spot = float(0.0).toVar();
    Loop({ start: 0, end: POOL.ripples, type: 'int', condition: '<', name: 'wq' }, ({ wq }) => {
      const rp = V4(U.ripples.element(wq));
      const amp = F1(length(rp.xyz));
      const cth = clamp(dot(n0, rp.xyz.div(max(amp, 1e-5))), -0.9999, 0.9999);
      const ang = F1(acos(cth));
      const age = rp.w;
      const live = amp.mul(smoothstep(0.0, 0.04, age));
      ring.addAssign(exp(sq(ang.sub(U.ball2.x.mul(age)).div(0.028)).negate()).mul(exp(age.div(0.2).negate())).mul(live));
      spot.addAssign(exp(sq(ang.div(0.075)).negate()).mul(float(1.0).sub(smoothstep(0.1, 0.8, age))).mul(live));
    });

    // --- żużel: pole wysp z symulacji (suma gładka), dziedzina pofalowana prądami -----------------------------------
    const nW = slagDomain(n0, ca, sa, time);
    const fld = slagField(U, nW, 'wk', true);
    // obrys: nierówności rosną z wielkością wyspy (drobina jest okrągła, duża wyspa ma zatoki i półwyspy)
    const lump = F1(noise3(q.mul(5.3).add(vec3(0.0, time.mul(0.03), 4.4))));
    const sdC = F1(fld.sd.add(lump.sub(0.5).mul(0.42).mul(min(fld.rw, 0.26)).mul(step(fld.sd, 0.5))));
    const edgeW = F1(max(pxAng.mul(1.6), U.t6.x));
    const slagM = F1(float(1.0).sub(smoothstep(edgeW.negate(), edgeW, sdC)));
    const depth = F1(max(sdC.negate(), 0.0));                              // głębokość w wyspie [cięciwa]
    const nearSlag = F1(step(sdC, 0.3));
    // menisk: metal tuż przy brzegu żużla jest gorętszy i jaśniejszy (żużel izoluje — ciepło ucieka brzegiem)
    const menisk = F1(exp(sq(max(sdC, 0.0).div(max(float(0.022), pxAng.mul(2.2)))).negate()).mul(float(1.0).sub(slagM)).mul(nearSlag));
    // WYPUKŁOŚĆ wyspy na świecącym metalu: kierunek „od środka wyspy” w płaszczyźnie stycznej; światło kluczowe z góry
    // i od patrzącego. Po stronie światła metal przy brzegu jaśnieje (menisk), po przeciwnej leży wąski CIEŃ KONTAKTOWY
    // — wyspa czyta się jako kropla leżąca NA kuli, nie jako dziura w niej.
    const outT = V3(fld.out.sub(N.mul(dot(fld.out, N))));
    const outN = V3(outT.div(max(length(outT), 1e-4)));
    const keyL = V3(normalize(V.add(vec3(0.0, 0.9, 0.0))));
    const keyT = V3(keyL.sub(N.mul(dot(keyL, N))));
    const side = F1(dot(outN, keyT.div(max(length(keyT), 0.2))));            // +1 — brzeg od strony światła
    const lightSide = F1(clamp(side.mul(0.5).add(0.5), 0.0, 1.0));
    const contact = F1(exp(sq(max(sdC, 0.0).div(max(float(0.03), pxAng.mul(3.0)))).negate()).mul(float(1.0).sub(slagM)).mul(nearSlag).mul(float(1.0).sub(lightSide)));

    // --- temperatura miejsca ------------------------------------------------------
    const Tl = float(0.0).toVar();
    Tl.assign(T.mul(float(1.0).add(U.t5.x.mul(tzone.add(cellT))))
      .add(bandH.mul(bandStreak.mul(0.8).add(0.6)).mul(coilPower.mul(0.12).add(0.035)).mul(U.t5.y).mul(float(1.0).sub(flatK)))
      // masa w leju: gruba warstwa cieplejsza (jaśniejsza), pas przy brzegu jeziora chłodniejszy (ciemniejszy)
      .add(T.mul(deep.mul(MASS_EDGE.thick).sub(shore.mul(MASS_EDGE.cool)).sub(isMass.mul(flatK).mul(MASS_EDGE.flat))))
      .add(suckT)
      .sub(chillAmt.mul(0.13))
      .sub(clamp(vFilm.y, 0.0, 1.0).mul(MASS_LOOK.film))
      .add(ring.mul(0.2)).sub(min(spot, 1.5).mul(0.15))
      .add(menisk.mul(U.t6.z).mul(lightSide.mul(0.75).add(0.25)))
      .sub(contact.mul(0.16))
      .sub(float(1.0).sub(mu).mul(float(1.0).sub(mu)).mul(0.36)));

    // --- metal: żar + lustro ----------------------------------------------------
    const LM = liquidMetal(U, P, N, V, mu, Tl, sunV, mix(float(1.0), float(MASS_EDGE.gloss), isMass));
    const metal = LM.metal;
    const hc = LM.hc;
    const hp = LM.hp;
    const E = LM.E;
    const limb = LM.limb;

    // --- żużel: gęsta, żarząca się ciecz z kożuchem ------------------------------------------------------------------
    // Wygląd niesie GRUBOŚĆ i TEMPERATURA żużla. Cienki i świeży (brzeg wyspy, drobina po wtopieniu, okolica korzenia
    // nitki) żarzy się pomarańczem i prześwituje metalem; gruby środek czapy stygnie w ciemniejszy KOŻUCH — plamami
    // i smugami, które płyną razem z powierzchnią (wolny szum w układzie kuli, rozciągnięty wzdłuż obrotu; bez komórek
    // i pęknięć). Emisja: ok. 0,45 emisji metalu na świeżym żużlu, ok. 0,15 pod kożuchem.
    const blot = F1(noise3(q.mul(3.4).add(vec3(7.1, time.mul(0.02), 0.0))));
    const streak = F1(noise3(vec3(q.x.mul(1.3), q.y.mul(10.0), q.z.mul(1.3)).add(vec3(0.0, 2.2, time.mul(0.015)))));
    const smear = F1(noise3(vec3(q.x.mul(2.1), q.y.mul(5.5), q.z.mul(2.1)).add(vec3(0.0, time.mul(0.02), 3.1))).mul(0.6).add(noise3(q.mul(5.1).add(vec3(5.2, 0.0, time.mul(0.03)))).mul(0.4)));
    const thick = F1(float(1.0).sub(exp(depth.div(-0.075))));               // 0 przy brzegu … 1 w głębi wyspy
    const thinK = F1(exp(depth.div(max(float(0.03), pxAng.mul(3.0))).negate()));  // rąbek: kilka pikseli także z góry
    const small = F1(float(1.0).sub(smoothstep(0.05, 0.17, fld.rw)));       // drobina 1 … duża wyspa 0
    const pd = F1(length(n0.sub(vec3(0.0, 1.0, 0.0))));
    const coneK = F1(exp(pd.div(U.ball2.w.mul(1.6)).negate()).mul(U.slag2.y));
    const rootK = F1(exp(pd.div(0.26).negate()).mul(U.slag2.y));           // rozgrzany żużel wokół korzenia nitki
    // kożuch: ile go jest — z grubości i ostygnięcia wyspy; GDZIE leży — z wolnego szumu płynącego z powierzchnią
    // (płaty kożucha rozdzielone pasmami świeższej, żarzącej się cieczy)
    const crustAmt = F1(thick.mul(float(1.42).sub(fld.heat.mul(1.0))).sub(coneK.mul(1.2)).sub(rootK.mul(0.7)).sub(small.mul(0.5)));
    const skin = F1(smoothstep(0.4, 0.64, crustAmt.mul(smear.add(streak.sub(0.5).mul(0.3)))));
    const Ts = F1(T.mul(float(0.8).sub(skin.mul(0.37)).add(thinK.mul(0.11)).add(small.mul(0.05)).add(rootK.mul(0.1)).add(coneK.mul(0.1)).add(smear.sub(0.5).mul(0.06)))
      .sub(float(1.0).sub(mu).mul(float(1.0).sub(mu)).mul(0.1)));
    // normalna soczewki: wypukła kropla — odchylona na zewnątrz wyspy, najmocniej przy brzegu, łagodnie aż do środka
    // (mała wyspa to cała kopułka, duża ma płaski wierzch i zaokrąglony brzeg); w głębi łagodne garby kożucha; przy
    // korzeniu nitki FAŁDY biegnące ku niemu (czapa jest wciągana w stożek)
    const dome = F1(float(1.0).sub(clamp(depth.div(fld.rw.mul(0.5).add(0.004)), 0.0, 1.0)));
    const bevel = F1(exp(depth.div(-0.045)).mul(0.6).add(dome.mul(dome).mul(0.7)));
    const hump = V3(vec3(blot.sub(0.5), streak.sub(0.5), lump.sub(0.5)));
    const azP = atan(n0.z, n0.x);
    const fold = F1(sin(azP.mul(11.0).add(blot.mul(5.0))).mul(exp(pd.div(0.34).negate())).mul(smoothstep(0.03, 0.12, pd)).mul(U.slag2.y));
    const tanP = V3(normalize(cross(vec3(0.0, 1.0, 0.0), n0).add(vec3(1e-4, 0.0, 0.0))));
    const Nc = V3(normalize(N.add(outN.mul(bevel)).add(hump.sub(N.mul(dot(hump, N))).mul(skin.mul(0.2).add(0.08))).add(tanP.mul(fold.mul(0.4)))));
    const rS = V3(reflect(V.negate(), Nc));
    const wet = F1(float(1.0).sub(skin));
    // bryła kropli na świecącej powierzchni: zbocze zwrócone ku światłu kluczowemu jaśniejsze, przeciwne ciemniejsze
    const shade = F1(clamp(dot(Nc, keyL).sub(dot(N, keyL)).mul(1.5).add(1.0), 0.6, 1.4));
    // światło zewnętrzne na kożuchu (ciemna, matowa skóra): niebo z otwartej góry i poblask rozżarzonej komory
    const up = F1(Nc.y.mul(0.5).add(0.5));
    const ndlS = F1(max(dot(Nc, U.sunDir), 0.0));
    const env = V3(U.sunColor.mul(ndlS.mul(sunV).mul(0.1))
      .add(vec3(0.5, 0.47, 0.44).mul(up.mul(up).mul(0.55)))
      .add(U.light.xyz.mul(float(1.0).sub(up).mul(0.1).add(0.07)).mul(min(U.light.w.mul(0.12), 1.0))));
    const slagLit = V3(U.slag.mul(blot.mul(0.45).add(0.6)).mul(env).mul(skin.mul(0.75).add(0.25)));
    // połysk gęstej cieczy: SZEROKI i miękki (nie mat, nie lustro) — odbicie otwartej góry i lamp, ciepłe odbicie
    // rozżarzonej komory pod kątem (Fresnel); kożuch błyszczy słabiej
    const muS = F1(clamp(dot(Nc, V), 0.0, 1.0));
    const omS = F1(float(1.0).sub(muS));
    const fresS = F1(omS.mul(omS).mul(omS).mul(omS).mul(0.9).add(0.1));
    const gloss = F1(mix(float(0.35), float(1.0), wet));
    const sheen = F1(pow(max(rS.y, 0.0), 2.4).mul(0.11).add(pow(max(rS.y, 0.0), 14.0).mul(0.1)));
    const specS = F1(pow(max(dot(rS, U.sunDir), 0.0), mix(float(9.0), float(40.0), wet)).mul(0.12).mul(sunV));
    const hcS = V3(heatColor(U, Ts));
    const emS = F1(heatPower(Ts).mul(U.t1.x).mul(U.t4.x).mul(U.t6.y).mul(shade));
    const slagRaw = V3(slagLit
      .add(hcS.mul(emS.mul(limb)))
      .add(vec3(0.62, 0.56, 0.5).mul(sheen).add(U.sunColor.mul(specS)).mul(gloss.mul(U.t6.w)))
      .add(hc.mul(hp.mul(E.c).mul(fresS).mul(gloss).mul(0.3).mul(U.t6.w)))
      .add(E.L.mul(fresS).mul(gloss.mul(0.55).mul(U.t6.w))));
    // cienki brzeg soczewki prześwituje metalem
    const slagCol = V3(mix(slagRaw, metal, exp(depth.div(-0.014)).mul(0.5)));
    const outc = vec3(0.0).toVar();
    outc.assign(mix(metal, slagCol, slagM));
    // ograniczenie luminancji z zachowaniem barwy (duża jasna powierzchnia zalewa kadr poświatą)
    const lum = dot(outc, LUMA);
    outc.mulAssign(min(float(1.0), float(2.4).div(max(lum, 1e-3))));
    return vec4(max(outc, vec3(0.0)), 1.0);
  })();

  const make = (name, vertexNode) => {
    const m = new NodeMaterial();
    m.name = name;
    m.vertexNode = vertexNode;
    m.fragmentNode = fragment;
    m.side = THREE.FrontSide;
    m.fog = false;
    m.lights = false;
    m.toneMapped = false;
    return m;
  };
  return { ball: make('WytopKula', vertex), mass: make('WytopMasa', massVertex) };
}

/**
 * Siatka masy w leju: krąg nad całym dnem komory (`nr` pierścieni × `na` wycinków, od osi do ściany studni).
 * Atrybut `aRT`: promień [j.], azymut w wycinkach pola (`MASA.na` na pełny obwód). Wysokość liczy materiał.
 */
export function createMassGeometry(nr = 76, na = 192) {
  const R1 = PIT + 1.5;
  const cols = na + 1;
  const pos = new Float32Array((nr + 1) * cols * 3);
  const rt = new Float32Array((nr + 1) * cols * 2);
  const idx = new Uint16Array(nr * na * 6);
  let w = 0;
  let q = 0;
  for (let i = 0; i <= nr; i++) {
    const r = R1 * i / nr;
    for (let k = 0; k <= na; k++) {
      const a = (k / na) * TAU;
      pos[w * 3] = Math.cos(a) * r; pos[w * 3 + 1] = 0; pos[w * 3 + 2] = Math.sin(a) * r;
      rt[w * 2] = r; rt[w * 2 + 1] = k * MASA.na / na;
      w++;
    }
  }
  for (let i = 0; i < nr; i++) {
    for (let k = 0; k < na; k++) {
      const a = i * cols + k;
      const b = a + cols;
      // (zwrot ścian w górę: promień × obwód wskazuje w dół)
      idx[q++] = a; idx[q++] = a + 1; idx[q++] = b; idx[q++] = b; idx[q++] = a + 1; idx[q++] = b + 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRT', new THREE.BufferAttribute(rt, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -500, 0), 800);
  return g;
}

/** Siatka kuli jednostkowej: sześcian rzutowany na sferę, `n` odcinków na krawędź (6 · (n + 1)² wierzchołków). */
export function createBallGeometry(n = 80) {
  const verts = 6 * (n + 1) * (n + 1);
  const pos = new Float32Array(verts * 3);
  const idx = new Uint32Array(6 * n * n * 6);
  let w = 0;
  let q = 0;
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, -1]], [[-1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[0, 1, 0], [0, 0, -1], [1, 0, 0]], [[0, -1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, 0, 1], [0, 1, 0], [1, 0, 0]], [[0, 0, -1], [0, 1, 0], [-1, 0, 0]]
  ];
  for (let f = 0; f < 6; f++) {
    const [ax, ay, az] = faces[f];
    const base = w / 3;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        // odwzorowanie tangensowe: równiejsze pola trójkątów
        const u = Math.tan((i / n * 2 - 1) * Math.PI / 4);
        const v = Math.tan((j / n * 2 - 1) * Math.PI / 4);
        const x = ax[0] + ay[0] * v + az[0] * u;
        const y = ax[1] + ay[1] * v + az[1] * u;
        const z = ax[2] + ay[2] * v + az[2] * u;
        const l = Math.sqrt(x * x + y * y + z * z);
        pos[w++] = x / l; pos[w++] = y / l; pos[w++] = z / l;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c;
      }
    }
  }
  // zwrot ścian na zewnątrz: sprawdzenie pierwszego trójkąta każdej ściany
  for (let f = 0; f < 6; f++) {
    const o = f * n * n * 6;
    const a = idx[o] * 3;
    const b = idx[o + 1] * 3;
    const c = idx[o + 2] * 3;
    const ux = pos[b] - pos[a]; const uy = pos[b + 1] - pos[a + 1]; const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a]; const vy = pos[c + 1] - pos[a + 1]; const vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    if (nx * pos[a] + ny * pos[a + 1] + nz * pos[a + 2] < 0) {
      for (let k = o; k < o + n * n * 6; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 700);
  return g;
}
