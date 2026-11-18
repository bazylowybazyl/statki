// HUTA — formowanie: MATERIAŁ OTOCZENIA (naczynie z zewnątrz, nośna, pomost, hala, zbiorniki tlenu, dok żużla, zawór
// dyszy). Osobny graf — materiały wnętrza komory (`../wytop/`) nietknięte. Światło w układzie komory: słońce gry
// z ANALITYCZNYM cieniem naczynia i pomostu (`vesselShadow` — hala nie ma maski studni), niebo przestrzeni (hala jest
// otwarta do góry pod niewidoczną błoną pola), ciepły odblask nasłonecznionego pokładu na powierzchniach zwróconych
// w dół, światło linii (`lineLight` — w etapie „Złożenie” zgaszone), żar dyszy z metalu w gardzieli. Wzory powierzchni
// bez pochodnych ekranu (szew ma stałą szerokość w jednostkach). Wygląd to jawna MAKIETA do tury materiałów.
//
// W wierzchołkach: klapy zaworu wylewki obracają się wokół zawiasu (`OU.valve.x` — kąt; rama zaworu `ZAWOR`), granulat
// w doku żużla rośnie z wypełnienia (`OU.dock.x` — wysokość warstwy [j.]). BRAMKI ZACISKU POLA (etap „Wyciskanie”,
// kanał `zacisk`) świecą tam, gdzie jest zacisk: jasność z x fragmentu względem zacisku (`OU.line.y` — x, `.z` — siła,
// `.w` — brzuch z metalem przed zaciskiem 0…1). Żar wylewki i rury spustowej — `OU.valve.y` (struga w wylewce 0…1),
// `OU.valve.z` (metal w rurze 0…1).
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, abs, atan, attribute, cameraProjectionMatrix, clamp, cos, cross, dot, exp, float, floor, fract, int, length, max, min, mix,
  modelViewMatrix, normalize, pow, reflect, sign, sin, smoothstep, sqrt, uniform, uniformArray, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { LUMA, hash21, heatColor, heatPower, noise3 } from '../wytop/wspolneTSL.js';
import { BLONA, HALA, PATH, SPUST, ZACISK, ZAWOR } from './geometria.js';
import { OTO } from './otoczenie.js';
import { WALC } from './walcownia.js';
import { ARM_MARK, OSLONA, armPivot } from './walcowniaBryly.js';
import { lineLight, vesselShadow } from './swiatloLinii.js';
import { CHILL_SHIFT, POLE_K } from './polePasma.js';
import { CHLODNICE } from './stacje.js';
import { DZ_KANAL, DZ_MARK } from '../dzielenie/bryly.js';
import { CHWYT } from '../dzielenie/geometria.js';
import { chuteShade } from '../dzielenie/rynnaTSL.js';

const TAU = Math.PI * 2;

/** Uniformy otoczenia (od zer — pułapka 46). */
export function createOutsideUniforms() {
  return {
    valve: uniform(new THREE.Vector4(0, 0, 0, 0)),     // kąt klap zaworu wylewki [rad], żar strugi w wylewce, metal w rurze, 0
    dock: uniform(new THREE.Vector4(0, 0, 0, 0)),      // wysokość warstwy granulatu w doku [j.], świeżość 0…1, 0, 0
    line: uniform(new THREE.Vector4(0, 0, 0, 0)),      // dosunięcie paneli C1 0…1 (miedź), x zacisku pola [j.], siła zacisku, brzuch przed zaciskiem 0…1
    mill: uniform(new THREE.Vector4(0, 0, 0, 0)),      // kąty walców F1, F2, F3 [rad] (obrót wzoru), żar chwytu 0…1
    // (runda 7) obrót ramion pętlowników F1–F2, F2–F3 względem spoczynku [rad], lampy bramy „DO ZWIJARKI” (obramówka wlotu)
    // 0…1, światło robocze tunelu 0…1
    loop: uniform(new THREE.Vector4(0, 0, 0, 0)),
    // (runda 7) żar lica taśmy przy klatkach F1, F2, F3 (T̃ — odbicie w polerowanej beczce walca), 0
    millT: uniform(new THREE.Vector4(0, 0, 0, 0)),
    // siła emiterów pola linii: 16 kanałów linii (`POLE_KANAL`) + 4 walcowni (pętlowniki 16, 17) + 12 przedziałów ciepła
    // paneli chłodnic (20–31, runda 7) + 16 dzielenia (32–47, runda 8 — `DZ_KANAL`) w 12 × vec4 (stała nazwa — pułapka 25)
    pole: uniformArray(Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4').setName('FormowaniePole'),
    // (runda 8) DZIELENIE — grupy ruchome: przesunięcie wózków noża w x względem spoczynku krzywki, 0, 0, 0
    dz: uniform(new THREE.Vector4(0, 0, 0, 0)),
    // (runda 9) GRUPY RUCHU dzielenia (`DZ_MARK.ruch0` + k): przesunięcie (x, y, z) względem miejsca budowy i jasność
    // emiterów grupy (pole slotów kasety); 0…5 kasety, 6…15 — etap 2 (wózki kręgów, sanie, głowice); stała nazwa (pułapka 25)
    ruch: uniformArray(Array.from({ length: DZ_MARK.ruchN }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4').setName('FormowanieRuch')
  };
}

/** Półdługość beczki walca [j.] (`KLATKA.barrel` — szyjki i sprzęgło dalej). */
const KLATKA_BARREL = 135;
// klatki walcownicze: środki walców (x, półgrubość szczeliny) — wzór walca obraca się kątem z symulacji
const ROLL_X = WALC.stands.map((s) => s.x - PATH.xOff);
const ROLL_B = WALC.stands.map((s) => s.bOut);

export function createOutsideMaterial(U, OU, LU) {
  const vP = varyingProperty('vec3', 'vOtP');
  const vN = varyingProperty('vec3', 'vOtN');
  const vC = varyingProperty('vec3', 'vOtC');
  const vK = varyingProperty('vec2', 'vOtK');
  const vR = varyingProperty('float', 'vOtR');
  const F1 = (e) => { const v = float(0.0).toVar(); v.assign(e); return v; };
  const V3 = (e) => { const v = vec3(0.0).toVar(); v.assign(e); return v; };
  const K = SPUST.klapy;
  const Z = ZAWOR;
  const cZ = vec3(...Z.c);
  const e1 = vec3(...Z.e1);
  const e2 = vec3(...Z.e2);
  const vertex = Fn(() => {
    const p0 = attribute('position', 'vec3');
    const n0 = attribute('aN', 'vec3');
    const aK = attribute('aK', 'vec2');
    const aM = attribute('aM', 'vec3');
    const kind = F1(floor(aK.x.add(0.5)));
    const isFlap = F1(float(1.0).sub(min(abs(kind.sub(OTO.klapa)), 1.0)));
    const isGran = F1(float(1.0).sub(min(abs(kind.sub(OTO.granulat)), 1.0)));
    const isChill = F1(float(1.0).sub(min(abs(kind.sub(OTO.chlodnica)), 1.0)));
    // klapa: obrót wokół zawiasu (bok sześciokąta przy wardze wylewki, rama `ZAWOR`), wzór Rodriguesa jak `flapRotate`
    const a = F1(aK.y.mul(TAU / K.n));
    const H = V3(cZ.add(e1.mul(cos(a).mul(K.apo))).add(e2.mul(sin(a).mul(K.apo))));
    const T = V3(e1.mul(sin(a).negate()).add(e2.mul(cos(a))));
    const th = F1(OU.valve.x.mul(isFlap));
    const c = cos(th);
    const s = sin(th);
    const d = V3(p0.sub(H));
    const pf = V3(H.add(d.mul(c)).add(cross(T, d).mul(s)).add(T.mul(dot(T, d)).mul(float(1.0).sub(c))));
    const nf = V3(n0.mul(c).add(cross(T, n0).mul(s)).add(T.mul(dot(T, n0)).mul(float(1.0).sub(c))));
    // granulat: warstwa o wysokości z wypełnienia, lekko usypana w środku skrzyni (kopczyk pod wylotem rury)
    const uv = aM.xy;
    const mound = F1(float(1.0).sub(uv.x.mul(uv.x)).mul(float(1.0).sub(uv.y.mul(uv.y))));
    const lift = F1(OU.dock.x.mul(mound.mul(0.3).add(0.85)).mul(isGran));
    // panel chłodnicy C1: dosuwa się do pasma przy miedzi (kierunek w `aM`: x, z, y)
    const shift = V3(vec3(aM.x, aM.z, aM.y).mul(OU.line.x.mul(CHILL_SHIFT).mul(isChill)));
    // (runda 7) RAMIĘ PĘTLOWNIKA: wierzchołki ze znacznikiem `ARM_MARK + j` w aM.z obracają się wokół osi wahań przęsła j
    // (oś z) kątem z symulacji (`OU.loop.x / y` — względem spoczynku); reszta siatki: kąt 0
    const armJ = F1(aM.z.sub(ARM_MARK));
    const isArm = F1(step01(armJ.add(0.5)).mul(step01(float(1.5).sub(armJ))));
    const arm1 = F1(step01(armJ.sub(0.5)));
    const aTh = F1(mix(OU.loop.x, OU.loop.y, arm1).mul(isArm));
    const PV0 = armPivot(0);
    const PV1 = armPivot(1);
    const piv = V3(vec3(mix(float(PV0[0]), float(PV1[0]), arm1), float(PV0[1]), 0.0));
    const ca = F1(cos(aTh));
    const sa = F1(sin(aTh));
    const pr0 = V3(p0.sub(piv));
    const pa = V3(piv.add(vec3(pr0.x.mul(ca).sub(pr0.y.mul(sa)), pr0.x.mul(sa).add(pr0.y.mul(ca)), pr0.z)));
    const na = V3(vec3(n0.x.mul(ca).sub(n0.y.mul(sa)), n0.x.mul(sa).add(n0.y.mul(ca)), n0.z));
    // (runda 8) DZIELENIE: wózki noża (znacznik `DZ_MARK.car`) jadą w x krzywką
    const dzg = F1(aM.z.sub(DZ_MARK.car));
    const isCar = F1(float(1.0).sub(min(abs(dzg), 1.0)));
    const dzOff = V3(vec3(OU.dz.x.mul(isCar), 0.0, 0.0));
    // (runda 9) GRUPY RUCHU (kasety): przesunięcie z `OU.ruch[k]`, jasność emiterów grupy do fragmentu (−1 — nie grupa)
    const rI = F1(aM.z.sub(DZ_MARK.ruch0));
    const isR = F1(step01(rI.add(0.5)).mul(step01(float(DZ_MARK.ruchN - 0.5).sub(rI))));
    const rv = OU.ruch.element(int(clamp(floor(rI.add(0.5)), 0.0, DZ_MARK.ruchN - 1)));
    const rOff = V3(rv.xyz.mul(isR));
    vR.assign(mix(float(-1.0), rv.w, isR));
    const p = V3(mix(mix(p0, pf, isFlap), pa, isArm).add(vec3(0.0, lift, 0.0)).add(shift).add(dzOff).add(rOff));
    vP.assign(p);
    vN.assign(mix(mix(n0, nf, isFlap), na, isArm));
    vC.assign(attribute('aC', 'vec3'));
    vK.assign(aK);
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(p, 1.0)));
  })();
  const fragment = Fn(() => {
    const P = V3(vP);
    const V = V3(normalize(U.cam.sub(P)));
    const N0 = V3(normalize(vN));
    const N = V3(N0.mul(sign(dot(N0, V).add(1e-5))));
    const kind = F1(floor(vK.x.add(0.5)));
    const par = vK.y;
    const time = U.ball.w;
    const is = (k) => F1(float(1.0).sub(min(abs(kind.sub(k)), 1.0)));
    const isLamp = is(OTO.lampa);
    const isSteel = is(OTO.stal);
    const isShell = is(OTO.naczynie);
    const isDeck = is(OTO.poklad);
    const isEmit = is(OTO.emiter);
    const isFlap = is(OTO.klapa);
    const isGran = is(OTO.granulat);
    const isBore = is(OTO.dysza);
    const isPit = is(OTO.dol);
    const isStripe = is(OTO.pasy);
    const isGrate = is(OTO.krata);
    const isPole = is(OTO.pole);
    const isChill = is(OTO.chlodnica);
    const isSpout = is(OTO.wylewka);
    const isPipe = is(OTO.rura);
    // --- wzory powierzchni (makieta) ------------------------------------------------------------------------------
    const phi = F1(atan(P.z, P.x));
    const rho = F1(length(P.xz));
    // płaszcz: 32 płyty po obwodzie, pasy co 89 j. w pionie (na stożku i kołnierzu — po promieniu); kołnierz z góry:
    // promieniste szwy i szew obwodowy
    const panU = F1(phi.mul(32.0 / TAU));
    const top = F1(step01(par.sub(0.5)));
    const panV = F1(mix(P.y.div(89.25).add(rho.div(140.0).mul(step01(float(-360.0).sub(P.y)))), rho.sub(520.0).div(60.0), top));
    const fu = fract(panU);
    const fv = fract(panV);
    const seamU = F1(min(fu, float(1.0).sub(fu)).mul(rho.mul(TAU / 32.0)));
    const seamV = F1(min(fv, float(1.0).sub(fv)).mul(mix(float(89.25), float(60.0), top)));
    const shellSeam = F1(float(1.0).sub(smoothstep(0.8, 2.4, min(seamU, seamV))));
    const shellTint = F1(hash21(vec2(floor(panU), floor(panV)).add(5.0)).mul(0.22).add(0.89));
    // osmalenie ku gardzieli: przebarwienie cieplne i zacieki w dół na stożku
    const throatK = F1(float(1.0).sub(smoothstep(-760.0, -420.0, P.y)));
    const streak = F1(hash21(vec2(floor(phi.mul(90.0)), 3.0)).mul(0.5).add(0.5));
    const shellAlb = V3(vC.mul(shellTint).mul(float(1.0).sub(shellSeam.mul(0.45))).mul(float(1.0).sub(throatK.mul(streak).mul(0.45)))
      .add(vec3(0.016, 0.007, 0.003).mul(throatK.mul(throatK))));
    // pokład hali: płyty `plate` × `plate`, szwy, odcień płyty, drobne przetarcia
    const PL = HALA.deck.plate;
    const gx = P.x.div(PL);
    const gz = P.z.div(PL);
    const fx = fract(gx);
    const fz = fract(gz);
    const dSeam = F1(min(min(fx, float(1.0).sub(fx)), min(fz, float(1.0).sub(fz))).mul(PL));
    const deckSeam = F1(float(1.0).sub(smoothstep(1.2, 3.4, dSeam)));
    const plateH = F1(hash21(vec2(floor(gx), floor(gz)).add(11.0)));
    const wear = F1(hash21(vec2(floor(P.x.div(9.0)), floor(P.z.div(9.0)))).mul(0.12).add(0.94));
    const deckAlb = V3(vC.mul(plateH.mul(0.26).add(0.84)).mul(wear).mul(float(1.0).sub(deckSeam.mul(0.5))));
    // pasy ostrzegawcze (ukośne, żółto-czarne), krata kanału, wykładzina dołu
    const diag = fract(P.x.add(P.z).div(18.0));
    const stripeAlb = V3(mix(vec3(0.012, 0.012, 0.014), vC, step01(diag.sub(0.5))));
    const gr = vec2(fract(P.x.div(4.0)), fract(P.z.div(4.0)));
    const grate = F1(min(step01(abs(gr.x.sub(0.5)).sub(0.32)).add(step01(abs(gr.y.sub(0.5)).sub(0.32))), 1.0));
    const grateAlb = V3(mix(vec3(0.006, 0.006, 0.007), vC.mul(1.6), grate));
    const pitAlb = V3(vC.mul(hash21(vec2(floor(P.x.div(30.0)), floor(P.y.div(20.0).add(P.z.div(30.0))))).mul(0.3).add(0.75)));
    // granulat: ciemne, chłodne ziarna (ostygły w korycie odbieralnika) — szum wartości w skali grudek, niski kontrast
    const gn = hash21(vec2(floor(P.x.div(7.0)), floor(P.z.div(7.0))));
    const granAlb = V3(vC.mul(gn.mul(0.35).add(0.8)));
    // walec klatki: szlifowana stal; wzór związany z walcem (obraca się kątem z symulacji — górny w jedną stronę, dolny
    // w drugą: powierzchnie przy taśmie idą z taśmą): plamy po obwodzie (64 sektory, płynnie), trzy ciemne smugi
    // osiowe, drobne pierścienie szlifu wzdłuż osi; pas styku z taśmą (|z| < 100) ciemniejszy — nalot tlenków
    const isRoll = is(OTO.walec);
    const rk = F1(floor(par.mul(0.5).add(0.01)));
    const rUp = F1(par.sub(rk.mul(2.0)));
    const selK = (a, b, c) => mix(mix(float(a), float(b), step01(rk.sub(0.5))), float(c), step01(rk.sub(1.5)));
    const rxc = F1(selK(...ROLL_X));
    const rbo = F1(selK(...ROLL_B));
    const rSg = F1(rUp.mul(2.0).sub(1.0));
    const ryc = F1(float(HALA.passY).add(rbo.add(WALC.R).mul(rSg)));
    const rPhi = F1(mix(mix(OU.mill.x, OU.mill.y, step01(rk.sub(0.5))), OU.mill.z, step01(rk.sub(1.5))));
    const rTh = F1(atan(P.y.sub(ryc), P.x.sub(rxc)).sub(rPhi.mul(rSg)));
    const ru = F1(fract(rTh.div(TAU)).mul(64.0));
    // plamy po obwodzie: gładkie fale kąta (całkowite krotności — ciągłe przez szew ±π), lekko skręcone wzdłuż osi
    const rn = F1(sin(rTh.mul(3.0).add(P.z.mul(0.004)).add(1.3)).mul(0.25)
      .add(sin(rTh.mul(7.0).sub(P.z.mul(0.011)).add(4.1)).mul(0.15)).add(sin(rTh.mul(13.0).add(2.0)).mul(0.1)).add(0.5));
    const rStreak = F1(max(max(
      float(1.0).sub(smoothstep(0.0, 0.6, abs(ru.sub(5.0)))),
      float(1.0).sub(smoothstep(0.0, 0.45, abs(ru.sub(26.0))))),
      float(1.0).sub(smoothstep(0.0, 0.8, abs(ru.sub(47.0))))));
    const rGrind = F1(hash21(vec2(floor(P.z.mul(0.9)), 3.0)).mul(0.08).add(0.96));
    const rBand = F1(float(1.0).sub(smoothstep(96.0, 104.0, abs(P.z))));
    // czoła beczki i szyjek (normalna wzdłuż osi): gładkie, z jednym znacznikiem kątowym (wpust) — obrót widać z boku
    const rFace = F1(smoothstep(0.6, 0.9, abs(N0.z)));
    const rKey = F1(float(1.0).sub(smoothstep(0.3, 0.9, min(ru, float(64.0).sub(ru)))));
    // (runda 7) OBRÓT WIDOCZNY Z GÓRY: w pasie styku z taśmą (|z| < 100) nalot tlenków na beczce rwie się w plamy — ciemne
    // wyspy na jaśniejszym, wyszlifowanym metalu, związane z walcem (szum na obwodzie: ciągły przez szew ±π); po bokach
    // pasa czysty szlif z drobnymi rysami. Plamy idą po wierzchu walca z prędkością obwodową = prędkością taśmy (z góry
    // wierzch górnego walca jedzie pod prąd taśmy). Szyjki i sprzęgło (|z| > beczka): dwa żółte znaczniki osiowe
    // (malowane pasy kontrolne) — z góry mrugają w rytmie obrotu.
    const rR = F1(length(vec2(P.x.sub(rxc), P.y.sub(ryc))));
    // nalot w pasie styku: ciemny film tlenku (cały pas), z rzadkimi jaśniejszymi łatami odpryśniętego nalotu (ok. 10 %
    // obwodu — małe, nieregularne, związane z walcem) i trzema ciemniejszymi smugami osiowymi
    const rBand2 = F1(float(1.0).sub(smoothstep(92.0, 112.0, abs(P.z))));
    // (koszt: szum nalotu tylko na beczce walca — gałąź)
    const rPeel = F1(0.0);
    If(isRoll.mul(rBand2).greaterThan(0.0), () => {
      const rq = V3(vec3(cos(rTh).mul(4.2), sin(rTh).mul(4.2), P.z.div(16.0)));
      const rOx = F1(noise3(rq.add(vec3(rk.mul(7.0).add(rUp.mul(3.0)), 0.0, 0.0))).mul(0.7).add(noise3(rq.mul(2.7).add(5.0)).mul(0.3)));
      rPeel.assign(smoothstep(0.64, 0.69, rOx).mul(rBand2));
    });
    const isNeck = F1(smoothstep(KLATKA_BARREL + 0.5, KLATKA_BARREL + 2.0, abs(P.z)));
    // znaczniki kontrolne na szyjkach i sprzęgle (poprawki rundy 7): OSIEM wąskich żółtych prążków osiowych co 1/8 obrotu
    // (po 0,02 obrotu) — z góry prążki przesuwają się po wierzchu szyjki z prędkością obwodową (przy F3 i Q_nom ok. 0,12
    // odstępu na klatkę 60 Hz — bez aliasingu, który dawały dwa znaczniki co pół obrotu), tylko na płaszczu
    const mkF = F1(fract(rTh.div(TAU).mul(8.0)));
    const rMark = F1(float(1.0).sub(smoothstep(0.065, 0.1, abs(mkF.sub(0.5)))).mul(isNeck).mul(step01(rR.sub(20.0))).mul(float(1.0).sub(rFace)));
    const rollSide = V3(vC.mul(rn.mul(0.22).add(0.86)).mul(rGrind).mul(float(1.0).sub(rStreak.mul(0.55)))
      .mul(mix(float(1.15), float(0.55), rBand2)).mul(float(1.0).add(rPeel.mul(0.55))).add(vec3(0.012, 0.006, 0.003).mul(rBand.mul(float(1.0).sub(rPeel)))));
    const rollFace = V3(vC.mul(float(0.9).add(rKey.mul(1.6))));
    const rollAlb = V3(mix(mix(rollSide, rollFace, rFace), vec3(0.5, 0.33, 0.04), rMark));
    // (runda 7) emitery bram G1–G4 (kanały 9–12): świeci tylko LICO — ściana zwrócona ku osi pasma; reszta kostki to
    // obudowa (ciemna stal, oświetlona jak osprzęt)
    const chE = F1(floor(par.add(0.5)));
    const isGateE = F1(isPole.mul(step01(chE.sub(POLE_K.G1 - 0.5))).mul(step01(float(POLE_K.G4 + 0.5).sub(chE))));
    const toAx = V3(normalize(vec3(0.0, float(HALA.passY).sub(P.y), P.z.negate()).add(vec3(0.0, 1e-3, 0.0))));
    const lico = F1(smoothstep(0.35, 0.6, dot(N0, toAx)));
    const gateHousing = F1(isGateE.mul(float(1.0).sub(lico)));
    const albedo = V3(vC
      .add(shellAlb.sub(vC).mul(isShell)).add(deckAlb.sub(vC).mul(isDeck)).add(stripeAlb.sub(vC).mul(isStripe))
      .add(grateAlb.sub(vC).mul(isGrate)).add(pitAlb.sub(vC).mul(isPit)).add(granAlb.sub(vC).mul(isGran)).add(rollAlb.sub(vC).mul(isRoll))
      .add(vec3(0.075, 0.08, 0.09).sub(vC).mul(gateHousing)));
    // --- światło -----------------------------------------------------------------------------------------------------
    const sv = F1(vesselShadow(U, P.add(N0.mul(sign(dot(N0, U.sunDir).add(1e-5))).mul(6.0))));
    const ndl = max(dot(N, U.sunDir), 0.0);
    // (hala jest głęboko pod naczyniem i pomostem: wypełnienie mocniejsze niż samo niebo, żeby spód naczynia i nogi
    // czytały się z kamer z boku — makieta światła hali do tury materiałów)
    const sky = U.ambient.mul(N.y.mul(0.3).add(0.7));
    // odblask nasłonecznionego pokładu hali na powierzchniach zwróconych w dół (spód naczynia, pomostu, zbiorników)
    const deckGlow = F1(clamp(N.y.negate(), 0.0, 1.0).mul(smoothstep(float(HALA.deckY), float(HALA.deckY + 900), P.y).mul(-0.6).add(1.0)));
    const bounce = U.sunColor.mul(U.sunDir.y.mul(0.14)).mul(deckGlow).add(vec3(0.05, 0.044, 0.038).mul(N.y.mul(-0.3).add(0.7)));
    const line = V3(lineLight(U, LU, P, N));
    // żar metalu w wylewce oświetla wargę, klapy i kołnierz pola (struga w wylewce `OU.valve.y`)
    const tw = U.fun.w;
    const sw = OU.valve.y;
    const Pt = V3(cZ.add(vec3(...Z.d).mul(20.0)).sub(P));
    const dt2 = F1(max(dot(Pt, Pt), 1.0));
    const nozzleL = V3(U.light.xyz.mul(sw.mul(sw)).mul(float(70 * 70).div(dt2.add(70 * 70))).mul(clamp(dot(N, Pt.div(sqrt(dt2))).add(0.3), 0.0, 1.0)).mul(0.6));
    // (runda 7) ŚWIATŁO ROBOCZE TUNELU bramy „DO ZWIJARKI”: oprawy pod dachem osłony świecą w dół na wnętrze (ściany,
    // spód i pokład pod osłoną) i na obramówkę wlotu od środka — analityczne (bez świateł sceny), jasność `OU.loop.w`
    const tunL = V3(tunnelLight(P, N).mul(OU.loop.w));
    // (poprawki rundy 8) RYNNA ODPADU: dno i ściany koryta widzą niebo i słońce tylko przez szczelinę między koronami
    // (`rynnaTSL.js` — ten sam wzór co kawałki odpadu na dnie); poza rynną 1
    const chS = vec2(0.0).toVar();
    chS.assign(chuteShade(U.sunDir, P, N));
    const lightv = V3(U.sunColor.mul(ndl.mul(sv).mul(chS.x)).add(sky.add(bounce).mul(chS.y)).add(line).add(nozzleL).add(tunL));
    const r = reflect(V.negate(), N);
    const specS = pow(max(dot(r, U.sunDir), 0.0), 40.0).mul(sv).mul(0.5).mul(chS.x);
    const gloss = isSteel.mul(0.75).add(isShell.mul(0.35)).add(isFlap.mul(0.5)).add(isChill.mul(0.25)).add(isPipe.mul(0.3)).add(isRoll.mul(0.9)).add(0.08);
    const lit = V3(albedo.mul(lightv).mul(float(1.0).sub(max(max(isLamp, isEmit), isPole.sub(gateHousing)))).add(U.sunColor.mul(specS.mul(gloss))));
    const lum = dot(lit, LUMA);
    lit.mulAssign(float(1.0).div(lum.mul(1.5).add(1.0)));
    // --- żar własny i lampy ------------------------------------------------------------------------------------------
    // (runda 7: lampa z parametrem < 0 — obramówka wlotu bramy i oprawy w tunelu: jasność z symulacji `OU.loop.z`)
    const lampE = vC.mul(mix(par, OU.loop.z.mul(1.6), step01(par.negate()))).mul(U.t4.z);
    // szczelina generatora pola 0 g: świeci, gdy generator pracuje (stoi razem z szewronami wyświetlacza)
    const emitE = vC.mul(par.mul(U.grav.y.mul(0.9).add(0.12)));
    // warga dyszy od środka: żar metalu w gardzieli (wyżej jaśniej), klapy: ciemna wiśnia od spodu przy spływie
    const flow = hash21(vec2(floor(phi.mul(9.0)), floor(P.y.div(10.0).add(time.mul(9.0))))).mul(0.4).add(0.6);
    const throatCol = mix(vec3(1.0, 0.04, 0.004), U.light.xyz, smoothstep(0.5, 0.92, tw));
    const boreE = throatCol.mul(tw.mul(tw).mul(tw).mul(flow).mul(smoothstep(-792.0, -770.0, P.y).mul(1.4).add(0.3)));
    const flapE = vec3(1.0, 0.05, 0.005).mul(sw.mul(sw).mul(0.05));
    // wnętrze wargi wylewki: żar płynącego metalu (głębiej jaśniej), płaszcz rury: ledwie ciepły, gdy płynie metal
    const spoutCol = mix(vec3(1.0, 0.04, 0.004), U.light.xyz, smoothstep(0.3, 0.9, sw));
    const spoutE = spoutCol.mul(sw.mul(sw).mul(flow).mul(1.3)).add(vec3(0.05, 0.004, 0.0).mul(OU.valve.z));
    const pipeE = vec3(0.022, 0.003, 0.0).mul(OU.valve.z.mul(OU.valve.z));
    // emiter pola linii: kanał siły z symulacji (czuwanie — przygaszony); lekkie drganie pola przy pracy
    const ch = int(floor(par.add(0.5))).toVar();
    const pv = OU.pole.element(ch.div(4));
    const cm = ch.sub(ch.div(4).mul(4));
    const pw = F1(mix(mix(pv.x, pv.y, step01(float(cm).sub(0.5))), mix(pv.z, pv.w, step01(float(cm).sub(2.5))), step01(float(cm).sub(1.5))));
    // BRAMKI ZACISKU (kanał `zacisk`): bramka przy zacisku świeci siłą zacisku (Gauss w x — zapalają się po kolei, gdy
    // zacisk jedzie), przed zaciskiem bramki trzymają brzuch (słabo), za nim — ledwie (zapadnięty rękaw)
    const isZac = F1(float(1.0).sub(min(abs(float(ch).sub(POLE_K.zacisk)), 1.0)));
    const dzx = F1(P.x.sub(OU.line.y).sub(BLONA.wp * 0.2).div(ZACISK.glowW));
    const gate = F1(exp(dzx.mul(dzx).negate()).mul(OU.line.z).mul(2.2));
    const ahead = F1(smoothstep(0.4, 2.0, dzx).mul(OU.line.w).mul(0.12));
    const pwZ = F1(gate.add(ahead).add(0.02));
    const hum = hash21(vec2(floor(P.x.div(6.0).add(P.z.div(6.0))), floor(time.mul(24.0)))).mul(0.12).add(0.94);
    // (runda 7: lico emitera bramy G1–G4 poniżej progu poświaty — bez cyjanowej mgły bloomu; siła z nacisku bramy)
    // (runda 9) LISTWY dzielenia (kanał 34 — przechyłu, 33 — wyrzutu; odcinek i w części ułamkowej parametru): odcinek
    // świeci siłą pola na swoim kawałku krawędzi ciała — udział długości odcinka pod arkuszem × siła chwytu (i połowa siły
    // wyrzutu — dwie listwy po połowie); dwa ciała na listwie w kanałach 36–39 i 40–43 (x tyłu, długość, F chwytu, F
    // wyrzutu [/ F_REF]). Zapalony kawałek JEDZIE z arkuszem (wędrujące pole), czuwanie — przygaszone
    const chF = F1(floor(par.add(0.5)));
    const isRail = F1(float(1.0).sub(min(abs(chF.sub(DZ_KANAL.listwa)), 1.0)));
    const isKick = F1(float(1.0).sub(min(abs(chF.sub(DZ_KANAL.wyrzut)), 1.0)));
    const segI = F1(floor(fract(par).mul(64.0)));
    const sx0 = F1(mix(float(CHWYT.kickRail.x0), float(CHWYT.rail.x0), isRail).add(segI.mul(CHWYT.rail.seg)));
    const SA = OU.pole.element(int(DZ_KANAL.slotA >> 2));
    const SB = OU.pole.element(int(DZ_KANAL.slotB >> 2));
    const ovA = F1(clamp(min(sx0.add(CHWYT.rail.seg), SA.x.add(SA.y)).sub(max(sx0, SA.x)), 0.0, CHWYT.rail.seg).div(CHWYT.rail.seg));
    const ovB = F1(clamp(min(sx0.add(CHWYT.rail.seg), SB.x.add(SB.y)).sub(max(sx0, SB.x)), 0.0, CHWYT.rail.seg).div(CHWYT.rail.seg));
    const grip = F1(ovA.mul(SA.z).add(ovB.mul(SB.z)));
    const kick = F1(ovA.mul(SA.w).add(ovB.mul(SB.w)));
    const pwRail = F1(grip.mul(isRail).add(kick.mul(0.5)).mul(1.1).add(0.035));
    // (runda 9) emitery KASETY: jasność pola slotów z grupy ruchu (szyny pomostu — kanał 46)
    const isKas = F1(float(1.0).sub(min(abs(chF.sub(DZ_KANAL.kaseta)), 1.0)));
    const pwKas = F1(mix(pw, vR, step01(vR.add(0.5))));
    const pwX = F1(mix(mix(pw, pwRail, max(isRail, isKick)), pwKas, isKas));
    const poleE = vC.mul(mix(pwX, pwZ, isZac).mul(mix(float(1.25), float(0.9), isGateE)).mul(hum).add(mix(float(0.05), float(0.04), isGateE))).mul(mix(float(1.0), lico, isGateE));
    // CHŁODNICE (runda 7): lico panelu żarzy się od ciepła odebranego z pasma — przedziały x (kanały 20–31: strumień z
    // modelu ciepła linii z bezwładnością cieplną, `obrazLinii.js`); temperatura lica T⁴ = T_chł⁴ + κ · strumień · bliskość
    // (strumień 1 przy brzegu panelu najbliżej pasma — stal przy 1800 K pod C1 → ok. 930 K, 2 → ok. 1050 K); bliskość ~
    // (75 / odległość od obrysu pasma)^1,4 — brzeg przy pasmie żarzy się, dalsza część panelu ledwie; lico i tył płyty
    // goręcej niż żebra
    const CH = CHLODNICE;
    const chDx = (CH.x1 - CH.x0) / CH.n;
    const cxf = F1(clamp(P.x.sub(CH.x0).div(chDx).sub(0.5), 0.0, CH.n - 1.001));
    const ci = int(floor(cxf)).toVar();
    const chanF = (cc) => {
      const v = OU.pole.element(cc.div(4));
      const m = F1(float(cc.sub(cc.div(4).mul(4))));
      return mix(mix(v.x, v.y, step01(m.sub(0.5))), mix(v.z, v.w, step01(m.sub(2.5))), step01(m.sub(1.5)));
    };
    const cq0 = F1(chanF(ci.add(CH.kanal)));
    const cq1 = F1(chanF(min(ci.add(1), int(CH.n - 1)).add(CH.kanal)));
    const cq = F1(max(mix(cq0, cq1, fract(cxf)), 0.0));
    const dzS = F1(max(abs(P.z).sub(100.0), 0.0));
    const dyS = F1(max(abs(P.y.sub(HALA.passY)).sub(15.0), 0.0));
    // (poprawki rundy 7: współczynnik widzenia pasma przez lico panelu maleje łagodniej — panel naprzeciw taśmy żarzy się
    // całym licem, najmocniej przy brzegu bliżej pasma; wcześniej tylko wąski brzeg)
    const nearS = F1(min(pow(float(120.0).div(max(sqrt(dzS.mul(dzS).add(dyS.mul(dyS))), 40.0)), 0.85), 1.35));
    const faceS = F1(mix(float(0.4), float(1.0), smoothstep(0.2, 0.5, abs(dot(N0, toAx)))));
    // (chłodzenie panelu rośnie z jego temperaturą — strumień przyjęty ściska się łagodnie: P / (1 + P / 4))
    const cqE = F1(cq.mul(nearS).mul(faceS).div(cq.mul(nearS).mul(faceS).mul(0.25).add(1.0)));
    const Tpan = F1(pow(cqE.mul(0.9).add(0.041), 0.25));
    const Gp = F1(clamp(Tpan.sub(0.8).div(0.34), 0.0, 1.0));
    const chillE = V3(mix(vec3(0.5, 0.025, 0.003), vec3(1.0, 0.1, 0.012), Gp).mul(Gp.mul(Gp).mul(Gp).mul(0.75)));
    // (runda 7) ODBICIE ŻARU TAŚMY W BECZCE: polerowany walec jak lustro — na bokach beczki (normalna w poziomie) promień
    // odbity od kamery z góry idzie w dół i trafia w lico taśmy pod walcem: z kamery gry wzdłuż krawędzi walca jasny pas
    // żaru taśmy (przed walcem — wejście, za nim — wyjście). Barwa i moc: żar lica przy klatce (`OU.millT`), odbicie
    // metalu (Fresnel od 0,55), tylko w obrębie beczki nad taśmą
    const rRef = V3(reflect(V.negate(), N));
    const tHit = F1(float(HALA.passY).sub(P.y).div(min(rRef.y, -1e-3)));
    const Qz = F1(P.z.add(rRef.z.mul(tHit)));
    const onStrip = F1(float(1.0).sub(smoothstep(94.0, 104.0, abs(Qz))).mul(float(1.0).sub(smoothstep(-0.25, -0.08, rRef.y))).mul(float(1.0).sub(isNeck)).mul(isRoll));
    const rTk = F1(mix(mix(OU.millT.x, OU.millT.y, step01(rk.sub(0.5))), OU.millT.z, step01(rk.sub(1.5))));
    // (poprawki rundy 7: walec pracujący na gorąco to nie lustro — film tlenku i chłodziwo: odbicie słabe, rośnie dopiero
    // przy kącie ślizgowym; z kamery gry bez poświaty żaru na beczce — taśma wchodzi pod walec ostrą krawędzią)
    const fresR = F1(pow(float(1.0).sub(clamp(dot(N, V), 0.0, 1.0)), 5.0).mul(0.4).add(0.05));
    const rollRefl = V3(heatColor(U, rTk).mul(heatPower(rTk).mul(U.t1.x).mul(0.6).mul(fresR).mul(onStrip)));
    const outc = vec3(0.0).toVar();
    outc.assign(lit.add(rollRefl).add(lampE.mul(isLamp)).add(emitE.mul(isEmit)).add(boreE.mul(isBore)).add(flapE.mul(isFlap)).add(poleE.mul(isPole))
      .add(spoutE.mul(isSpout)).add(pipeE.mul(isPipe)).add(chillE.mul(isChill)));
    return vec4(max(outc, vec3(0.0)), 1.0);
  })();
  const mat = new NodeMaterial();
  mat.name = 'FormowanieOtoczenie';
  mat.vertexNode = vertex;
  mat.fragmentNode = fragment;
  mat.side = THREE.DoubleSide;
  mat.fog = false;
  mat.lights = false;
  mat.toneMapped = false;
  return mat;
}

/** 1 dla x > 0 (bez odwróconych stałych smoothstep). */
const step01 = (x) => clamp(x.mul(1e6), 0.0, 1.0);

/**
 * Światło robocze tunelu bramy (runda 7; wspólne z metalem taśmy — `pasmoTSL.js`): pasmo opraw pod dachem osłony
 * (x od wlotu do czoła), barwa ciepłobiała; natężenie maleje z odległością od dachu, poza osłoną gaśnie w ~40 j. od
 * wlotu (rozlewa się trochę przez otwór). Wynik × jasność z symulacji robi wołający.
 */
export function tunnelLight(P, N) {
  const O = OSLONA;
  const yT = LINIA_PY + O.top - 5;
  const inX = smoothstep(O.x0 - 45, O.x0 + 10, P.x).mul(float(1.0).sub(smoothstep(O.x1 - 10, O.x1 + 4, P.x)));
  const inZ = float(1.0).sub(smoothstep(O.hz - 4, O.hz + 6, abs(P.z)));
  const dy = max(float(yT).sub(P.y), 1.0);
  const fall = float(1.0).div(dy.div(70.0).add(1.0).mul(dy.div(70.0).add(1.0)));
  const facing = clamp(N.y.mul(0.8).add(0.35), 0.0, 1.0).add(clamp(N.x.negate(), 0.0, 1.0).mul(0.25));
  return vec3(1.0, 0.86, 0.66).mul(inX.mul(inZ).mul(fall).mul(facing).mul(1.6));
}
const LINIA_PY = HALA.passY;
