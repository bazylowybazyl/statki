// Elektrownia „KOREK” — materiał PROMIENIA energii (główny: wylot korka → czasza odbiornika, przekaźnikowy: odbiornik →
// ring), POLA pierścieni zamknięcia i ROZBŁYSKÓW (wylot krateru, uderzenie w czaszę, kula ładowania magazynu, trafienie
// w ring).
//
// Siatki są tylko OSŁONAMI (walec wokół osi, kula / półkula wokół rozbłysku); jasność liczy się analitycznie z odległości
// promienia widzenia od osi odcinka (albo od środka rozbłysku) w przestrzeni widoku (modelViewMatrix — w grze składana
// w double, pozycje świata 5–10 mln j. bez drżenia). Ten sam obraz z boku, z ukosa i od czoła: z góry promień to jasny
// punkt z poświatą i okręgiem włókien, nie walec widziany od dna. Atrybuty (stałe na siatce, earthBitePlantBeam.js):
//   aBeamA — początek osi (układ lokalny siatki) | środek rozbłysku; w — rodzaj: 0 promień, 1 wylot, 2 uderzenie,
//            3 kula ładowania, 4 trafienie w ring, 5 pole pierścienia (oś odcinka, jak promień),
//   aBeamB — koniec osi | punkt środek + oś × 1 R (kierunek tarczy rozbłysku); w — > 0: przekaźnik, mnożnik jasności
//            (× uPlantState.x),
//   aBeamR — promień: rdzeń, otoczka, osłona, wygaszanie końców [R]; rozbłysk: rdzeń, halo, osłona, tarcza [R];
//            pole: promień styku linii z pierścieniem, otoczka promienia, osłona, pół wysokości pola [R],
//   aBeamP — promień: przewężenia otoczki przy pierścieniach zamknięcia — droga pierwszego [R], krok [R], liczba,
//            1 — włączone; rozbłysk: x — promień, od którego biegną fale tarczy [R] (wylot: krawędź gardzieli).
// Warstwa w `uPlantLayer`: 0 — rdzeń, otoczka, włókna i pakiety (wąska osłona), 1 — szeroka poświata, 2 — oba
// (przekaźnik), 3 — rozbłyski i pole pierścieni (rodzaj z atrybutu). Mieszanie ONE/ONE (blendAddytywnePremul), bez zapisu
// głębi, forceSinglePass. Osłony wypukłe rysowane obiema stronami, liczy się JEDNA: przednia, a gdy kamera jest w osłonie
// (zbliżenie w demie, przelot w przerywniku) — tylna, z przygaszoną jasnością (inaczej biały ekran); druga strona wychodzi
// od razu (bez pracy). Fragment bez pętli; pochodne przed gałęziami.
//
// Ekspozycja zależy od rozmiaru na ekranie: z daleka (rdzeń ~1 px) promień jest jasny ponad próg bloomu, z bliska rdzeń
// schodzi do ~1 (biała nić ≤ 1/3 szerokości), a widoczna szerokość to nasycona cyjanowa otoczka z kontrastowymi
// impulsami — bez tego bloom gry rozlewa zbliżenie w białą świetlówkę.
import * as THREE from 'three/webgpu';
import {
  Fn, If, float, vec3, vec4, attribute, varying, positionView, modelViewMatrix, modelWorldMatrix, cameraProjectionMatrix, frontFacing,
  abs, clamp, cos, cross, dot, exp, floor, fract, fwidth, length, max, min, mix, normalize, select, sin, smoothstep, sqrt
} from 'three/tsl';
import { blendAddytywnePremul } from './tsl/mieszanie.js';
import { perObjectUniforms, sdown, aaLine, hash11, plantVar } from './earthBitePlantCommon.tsl.js';

/** Rodzaje (aBeamA.w) i warstwy (uPlantLayer) — wspólne z budową siatek. */
export const BEAM_KIND = Object.freeze({ BEAM: 0, MOUTH: 1, IMPACT: 2, ORB: 3, RELAY_HIT: 4, FIELD: 5 });
export const BEAM_LAYER = Object.freeze({ INNER: 0, GLOW: 1, RELAY: 2, FLARE: 3 });

// styl (R Ziemi, s)
const FLOW_SPEED = 0.15;     // pakiety energii w górę promienia [R/s]
const FLOW_STEP = 0.0235;    // odstęp pakietów [R] — ~2,5 impulsu na odstęp pierścieni zamknięcia (0,058 R)
const PK_AVG = 0.125;        // średnia jasność pakietu (z daleka i od czoła — zamiast impulsów)
const FIL_FLOW = 0.42;       // smugi na włóknach płyną w górę [R/s]
const FIL_STEP = 0.011;      // długość smugi włókna [R]
const FIL_RATE = 0.3;        // wolny obrót włókien wokół osi [rad/s]
const FIELD_RATE = 0.22;     // obrót linii pola pierścieni [rad/s]

const C_CORE = [0.92, 0.97, 1.0];
const C_CORE_EDGE = [0.42, 0.84, 1.0];
const C_SHEATH = [0.03, 0.55, 1.0];
const C_STRAND = [0.3, 0.82, 1.0];
const C_GLOW = [0.06, 0.42, 1.0];
const C_FIELD = [0.16, 0.7, 1.0];

const kindIs = (k, v) => select(abs(k.sub(v)).lessThan(0.5), float(1.0), float(0.0));
/** Miękki spadek do zera na x = 1: (1 − x)³ z ostrzejszym środkiem. */
function softFall(x) {
  const u = float(1.0).sub(clamp(x, 0.0, 1.0));
  return u.mul(u).mul(u).mul(float(0.25).add(exp(x.mul(-6.0)).mul(0.75)));
}

function buildBeamGraph() {
  const U = perObjectUniforms();
  const aA = attribute('aBeamA', 'vec4');
  const aB = attribute('aBeamB', 'vec4');
  const aR = attribute('aBeamR', 'vec4');
  const aP = attribute('aBeamP', 'vec4');
  // końce osi / środek rozbłysku w przestrzeni widoku; skala: R na jednostkę świata (lokalne x siatki = R)
  const vA = varying(modelViewMatrix.mul(vec4(aA.xyz, 1.0)).xyz, 'vBeamA');
  const vB = varying(modelViewMatrix.mul(vec4(aB.xyz, 1.0)).xyz, 'vBeamB');
  const vR = varying(aR, 'vBeamR');
  const vP = varying(aP, 'vBeamP');
  const vK = varying(vec4(aA.w, aB.w, float(1.0).div(max(length(modelWorldMatrix.element(0).xyz), 1e-9)), 0.0), 'vBeamK');
  const fragmentNode = Fn(() => {
    const p = plantVar(vec3(positionView), 'vec3');
    const ortho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
    // rozmiar piksela: kąt (perspektywa) albo długość (orto) — liniowe w ekranie, niezależne od nachylenia osłony
    const q2 = select(ortho, p.xy, p.xy.div(max(p.z.negate(), 1e-9)));
    const pixA = plantVar(float(0.0), 'float');
    pixA.assign(length(fwidth(q2)).mul(0.7071));
    const D = plantVar(select(ortho, vec3(0.0, 0.0, -1.0), normalize(p)), 'vec3');
    const kind = vK.x;
    const relayK = vK.y;
    const relay = plantVar(select(relayK.greaterThan(0.0), float(1.0), float(0.0)), 'float');
    const invS = vK.z;
    const T = U.uPlantTime;
    const relayOn = U.uPlantState.x;
    // przekaźnik: jasność × przekaz × własny mnożnik (słabszy od głównego — hierarchia: główny > przekaźnik)
    const gain = plantVar(U.uPlantBeam.x.mul(mix(1.0, relayOn.mul(relayK), relay)), 'float');
    const layer = U.uPlantLayer;
    const col = vec3(0.0).toVar();
    // rodzaje z osią odcinka: promień (0) i pole pierścienia (5); reszta — rozbłyski wokół środka
    const axial = kind.lessThan(0.5).or(kind.greaterThan(4.5));
    // kamera w osłonie (tylko perspektywa — początek widoku): odległość od odcinka osi / od środka rozbłysku
    const eA = vB.sub(vA);
    const s0 = clamp(dot(vA.negate(), eA).div(max(dot(eA, eA), 1e-30)), 0.0, 1.0);
    const camD = select(axial, length(vA.add(eA.mul(s0))), length(vA)).mul(invS);
    const inside = ortho.not().and(camD.lessThan(vR.z));
    const keep = select(inside, frontFacing.not(), frontFacing);
    // w osłonie jasność gaśnie ku środkowi (przelot przez kulę wylotu nie wybiela kadru)
    const nearK = select(inside, mix(0.12, 1.0, smoothstep(0.1, 1.0, camD.div(max(vR.z, 1e-9)))), float(1.0));

    If(keep.and(axial), () => {
      // ── najbliższe podejście promienia widzenia (p + t·D) do odcinka A → B ──
      const e = plantVar(vB.sub(vA), 'vec3');
      const C = plantVar(max(dot(e, e), 1e-30), 'float');
      const w0 = p.sub(vA);
      const Bd = plantVar(dot(D, e), 'float');
      const Dd = dot(D, w0);
      const sRaw = dot(e, w0).sub(Dd.mul(Bd)).div(max(C.sub(Bd.mul(Bd)), C.mul(1e-6)));
      const s = plantVar(clamp(sRaw, 0.0, 1.0), 'float');
      const t = s.mul(Bd).sub(Dd);
      const wv = plantVar(w0.add(D.mul(t)).sub(e.mul(s)), 'vec3');
      const d = plantVar(length(wv).mul(invS), 'float');
      const LR = plantVar(sqrt(C).mul(invS), 'float');
      const sR = plantVar(s.mul(LR), 'float');
      // sin kąta oś ↔ promień widzenia (0 — od czoła), odległość ze znakiem w poprzek osi na ekranie
      const sinT = plantVar(sqrt(max(float(1.0).sub(Bd.mul(Bd).div(C)), 0.0)), 'float');
      const side = cross(e, D);
      const dS = plantVar(dot(wv, side).div(max(length(side), 1e-30)).mul(invS), 'float');
      const zb = max(p.add(D.mul(t)).z.negate(), 1e-9);
      const pix = plantVar(pixA.mul(select(ortho, float(1.0), zb)).mul(invS), 'float');
      // piksel wzdłuż osi (skrót przy patrzeniu wzdłuż promienia): wzory biegnące wzdłuż osi gasną, zanim zaczną migotać
      const pixAx = plantVar(pix.div(max(sinT, 0.05)), 'float');
      const sideOn = plantVar(smoothstep(0.1, 0.4, sinT), 'float');

      If(kind.greaterThan(4.5), () => {
        // ── POLE PIERŚCIENIA ZAMKNIĘCIA: linie strumienia od otoczki promienia do wewnętrznej wargi pierścienia ──
        // południki powierzchni obrotowej ρ(z) = otoczka + (styk − otoczka)·(1 − z²)², z ∈ −1…1 (0 — pierścień): z boku
        // „latarnia” wokół przewężenia; po liniach płyną słabe impulsy od pierścienia ku promieniowi
        const rT = vR.x, rS = vR.y, wH = vR.w;
        const tz = plantVar(clamp(sR.div(max(wH, 1e-6)).sub(1.0), -1.0, 1.0), 'float');
        const b1 = float(1.0).sub(tz.mul(tz));
        const bump = plantVar(b1.mul(b1), 'float');
        const rho = plantVar(rS.add(rT.sub(rS).mul(bump)), 'float');
        const ang = plantVar(T.mul(FIELD_RATE), 'float');
        const wl = float(0.00016);
        const fieldLine = (a) => {
          const c = ang.add(a);
          return aaLine(abs(dS.sub(rho.mul(cos(c)))), wl, pix).mul(float(0.45).add(sin(c).mul(0.55)));
        };
        const lines = fieldLine(0.0).add(fieldLine(1.0472)).add(fieldLine(2.0944))
          .add(fieldLine(3.1416)).add(fieldLine(4.1888)).add(fieldLine(5.236));
        const fl = fract(abs(tz).mul(2.2).sub(T.mul(0.7)));
        const dash = mix(0.6, float(0.35).add(smoothstep(0.55, 0.92, fl).mul(sdown(0.92, 1.0, fl)).mul(1.1)),
          sdown(wH.mul(0.06), wH.mul(0.18), pixAx));
        // linie wchodzą stycznie w otoczkę (gasną przy końcach), najjaśniejsze przy pierścieniu; drobne z daleka — średnia
        const taper = sdown(0.72, 1.0, abs(tz)).mul(mix(0.55, 1.0, bump));
        const vis = smoothstep(3.0, 10.0, rT.div(max(pix, 1e-9)));
        // z ukosa (oś blisko kierunku patrzenia) rzut południków przestaje być krzywą ρ(z) — linie gasną
        const sideL = smoothstep(0.35, 0.75, sinT);
        // bańka pola: miękka poświata bryły obrotowej ρ(z) (1 − q², brzeg łagodny); z daleka, gdy linie są cieńsze od
        // piksela, zostaje miękkim węzłem wokół każdego przecięcia promienia z pierścieniem (rytm w kadrze gry)
        const q = abs(dS).div(max(rho, 1e-6));
        const lens = max(float(1.0).sub(q.mul(q)), 0.0).mul(sdown(0.55, 1.0, abs(tz)));
        const lensG = mix(0.015, 0.075, smoothstep(0.00025, 0.0009, pix));
        const sideF = vec3(...C_FIELD).mul(lines.mul(dash).mul(taper).mul(vis).mul(0.6).mul(sideL).add(lens.mul(lensG).mul(sideOn)));
        // od czoła: słaby pierścień poświaty między otoczką a wargą
        const frontF = vec3(...C_FIELD).mul(smoothstep(rS, rS.mul(2.5), d).mul(sdown(rT.mul(0.55), rT, d))
          .mul(float(1.0).sub(sideOn)).mul(0.06));
        col.assign(sideF.add(frontF).mul(gain));
      }).Else(() => {
        // ── PROMIEŃ ──
        const rc = vR.x, rs = vR.y, rg = vR.z, fadeL = vR.w;
        const ends = smoothstep(0.0, fadeL, sR).mul(smoothstep(0.0, fadeL, LR.sub(sR)));
        // przekaźnik: przy włączaniu promień wybiega z odbiornika, przy gaśnięciu cofa się do niego
        const reach = relayOn.mul(1.12);
        const front = mix(1.0, sdown(reach.sub(0.08), reach, s), relay);
        const amp = plantVar(gain.mul(ends).mul(front), 'float');
        const nrc = rc.div(max(pix, 1e-9));
        const nrs = plantVar(rs.div(max(pix, 1e-9)), 'float');
        // pakiety energii płyną w górę: krótka jasna głowa, ogon w dół, ciemne przerwy (jasność pakietu z haszu numeru
        // mod 97 — wejście ograniczone); drobne na ekranie i od czoła — średnia
        const u = sR.sub(T.mul(FLOW_SPEED)).div(FLOW_STEP);
        const ph = fract(u);
        const head = smoothstep(0.55, 0.9, ph).mul(sdown(0.9, 0.97, ph));
        const pk = head.mul(head).mul(float(0.6).add(hash11(fract(floor(u).mul(1.0 / 97.0)).mul(97.0).add(17.0)).mul(0.4)));
        const pkVis = sdown(FLOW_STEP / 8, FLOW_STEP / 2.5, pixAx).mul(smoothstep(0.08, 0.3, sinT));
        const packets = plantVar(mix(PK_AVG, pk, pkVis), 'float');
        // przewężenie przy najbliższym pierścieniu zamknięcia: otoczka ciaśniej, plazma jaśniejsza — z daleka (promień
        // kilka px) mocniej, żeby każde przecięcie z pierścieniem czytało się jako węzeł
        const kRing = clamp(floor(sR.sub(vP.x).div(max(vP.y, 1e-3)).add(0.5)), 0.0, max(vP.z.sub(1.0), 0.0));
        const dz = sR.sub(vP.x.add(kRing.mul(vP.y))).div(0.011);
        const pinch = plantVar(exp(dz.mul(dz).negate()).mul(vP.w), 'float');
        const pinchB = plantVar(mix(0.7, 1.5, sdown(3.0, 14.0, nrs)), 'float');
        const rsP = plantVar(rs.mul(float(1.0).sub(pinch.mul(0.24))).mul(float(1.0).add(packets.mul(0.1))), 'float');
        const shimmer = float(0.88).add(sin(sR.mul(113.0).sub(T.mul(9.0))).mul(sin(sR.mul(37.0).add(T.mul(3.7)))).mul(0.12));
        const innerOn = select(layer.lessThan(0.5).or(layer.greaterThan(1.5)), float(1.0), float(0.0));
        const glowOn = select(layer.greaterThan(0.5), float(1.0), float(0.0));
        // rdzeń: biała nić; ekspozycja wg rozmiaru — ~4,2 przy 1,5 px, ~1,5 przy 6 px, → 1 z bliska; cieńszy niż piksel —
        // grubieje do piksela z jasnością × √(r / szerokość); brzeg rdzenia przechodzi w cyjan
        const cx = max(nrc.sub(1.5), 0.0).mul(0.5);
        const coreG = float(1.0).add(float(3.2).div(cx.mul(cx).add(1.0)));
        const rcE = min(max(rc, pix.mul(0.9)), rg.mul(0.45));
        const xc = plantVar(d.div(rcE), 'float');
        const core = exp(xc.mul(xc).mul(-3.0)).mul(sqrt(rc.div(rcE))).mul(coreG)
          .mul(float(0.45).add(packets.mul(1.1))).mul(float(1.0).add(pinch.mul(pinchB).mul(0.6)));
        const coreC = mix(vec3(...C_CORE_EDGE), vec3(...C_CORE), exp(xc.mul(xc).mul(-6.0)));
        // otoczka: świecąca powłoka (droga przez warstwę 0,4…1 promienia — jaśniejsze brzegi), nasycony cyjan; z bliska
        // nie schodzi poniżej ~0,6 (widoczna szerokość promienia to otoczka, nie rdzeń)
        const sheathG = mix(1.25, 0.62, smoothstep(3.0, 40.0, nrs));
        const rsE = min(max(rsP, pix.mul(1.6)), rg.mul(0.85));
        const xs = d.div(rsE);
        const tube = sqrt(max(float(1.0).sub(xs.mul(xs)), 0.0)).sub(sqrt(max(float(0.16).sub(xs.mul(xs)), 0.0)))
          .mul(1.0 / 0.9165).mul(sdown(0.72, 1.0, xs)).mul(rsP.div(rsE));
        // włókna: 5 cienkich podłużnych prążków plazmy wolno obracających się wokół osi, po nich smugi płynące w górę
        // (rzut: linie równoległe do osi, przednie jaśniejsze); od czoła — okrąg; drobne na ekranie — gasną
        const rf = rsP.mul(0.68);
        const wf = rs.mul(0.035);
        const fa = plantVar(T.mul(FIL_RATE), 'float');
        const flowF = plantVar(sR.sub(T.mul(FIL_FLOW)).div(FIL_STEP), 'float');
        const dashVis = plantVar(sdown(FIL_STEP / 6, FIL_STEP / 2, pixAx).mul(smoothstep(0.1, 0.35, sinT)), 'float');
        const filament = (a, o) => {
          const c = fa.add(a);
          const f = fract(flowF.add(o));
          const streak = mix(0.42, f.mul(f).mul(sdown(0.88, 1.0, f)).mul(2.2), dashVis);
          return aaLine(abs(dS.sub(rf.mul(cos(c)))), wf, pix).mul(float(0.4).add(sin(c).mul(0.6))).mul(streak);
        };
        const fils = filament(0.0, 0.0).add(filament(1.2566, 0.37)).add(filament(2.5133, 0.71))
          .add(filament(3.7699, 0.13)).add(filament(5.0265, 0.53));
        const ringS = aaLine(abs(d.sub(rf)), wf, pix).mul(0.8);
        const strands = mix(ringS, fils, sideOn).mul(sdown(rf.mul(0.15), rf.mul(0.5), pix));
        const inner = coreC.mul(core)
          .add(vec3(...C_SHEATH).mul(tube.mul(float(0.35).add(packets.mul(1.5))).mul(float(1.0).add(pinch.mul(pinchB)))
            .mul(shimmer).mul(sheathG)))
          .add(vec3(...C_STRAND).mul(strands.mul(float(0.5).add(packets.mul(0.5)))));
        // szeroka poświata: niska jasność (pod progiem bloomu), zero na brzegu osłony; jaśniejsza w węzłach pierścieni
        const glow = vec3(...C_GLOW).mul(softFall(d.div(rg)).mul(float(0.16).add(packets.mul(0.22)))
          .mul(float(1.0).add(pinch.mul(pinchB).mul(1.6))));
        col.assign(inner.mul(innerOn).add(glow.mul(glowOn)).mul(amp));
      });
    }).ElseIf(keep, () => {
      // ── ROZBŁYSK: najbliższe podejście promienia widzenia do środka; tarcza ⟂ osi (spłaszczona z boku) ──
      const c = vA;
      const ax = vB.sub(vA);
      const axN = ax.div(max(length(ax), 1e-30));
      const tq = dot(c.sub(p), D);
      const qR = plantVar(p.add(D.mul(tq)).sub(c).mul(invS), 'vec3');
      const dq = plantVar(length(qR), 'float');
      const cosT = plantVar(dot(D, axN), 'float');
      const sinT = sqrt(max(float(1.0).sub(cosT.mul(cosT)), 0.0));
      const qa = dot(qR, axN.sub(D.mul(cosT))).div(max(sinT, 1e-4));
      const ac = max(abs(cosT), 0.08);
      const dd = plantVar(sqrt(max(dq.mul(dq).sub(qa.mul(qa)), 0.0).add(qa.div(ac).mul(qa.div(ac)))), 'float');
      const zb = max(c.z.negate(), 1e-9);
      const pix = plantVar(pixA.mul(select(ortho, float(1.0), zb)).mul(invS), 'float');
      const kM = kindIs(kind, 1), kI = kindIs(kind, 2), kO = kindIs(kind, 3), kR = kindIs(kind, 4);
      const charge = U.uPlantState.y;
      // kula ładowania rośnie z naładowaniem magazynu, przy przekazie świeci mocniej (oddaje)
      const orbSize = float(0.35).add(charge.mul(0.65));
      const rc = vR.x.mul(mix(1.0, orbSize, kO));
      const rh = vR.y.mul(mix(1.0, orbSize, kO));
      const rd = vR.w;
      const r0 = min(vP.x, rd.mul(0.8));
      const rcE = max(rc, pix.mul(0.9));
      const xc = dq.div(rcE);
      // jak rdzeń promienia: z bliska spokojniej (bloom), z daleka energia punktu zachowana
      const ball = exp(xc.mul(xc).mul(-2.0)).mul(rc.div(rcE).mul(rc.div(rcE))).mul(mix(1.0, 0.3, smoothstep(4.0, 40.0, rc.div(max(pix, 1e-9)))));
      const halo = softFall(dq.div(rh));
      // tarcza: słabe wypełnienie i dwie fale rozchodzące się od r0 (wylot — od krawędzi gardzieli po wargę krateru);
      // z boku cieńsza i jaśniejsza
      const edge = min(float(1.0).div(ac), 2.2);
      const fill = sdown(0.0, 1.0, dd.div(rd)).mul(sdown(0.0, 1.0, dd.div(rd)));
      const rate = kM.mul(0.55).add(kI.mul(0.9)).add(kR.mul(0.8));
      const f1 = fract(T.mul(rate));
      const f2 = fract(T.mul(rate).add(0.5));
      // fale: piksel w płaszczyźnie tarczy (z boku ściśniętej) — linie nie migoczą przy tarczy widzianej z ukosa
      const wr = rd.mul(0.02);
      const pixD = pix.div(ac);
      const span = rd.sub(r0);
      // fala rodzi się łagodnie na krawędzi (nie startuje pełną jasnością), gaśnie z kwadratem drogi
      const g1 = float(1.0).sub(f1).mul(smoothstep(0.0, 0.12, f1)), g2 = float(1.0).sub(f2).mul(smoothstep(0.0, 0.12, f2));
      const ripple = aaLine(abs(dd.sub(r0.add(f1.mul(span)))), wr, pixD).mul(g1.mul(g1))
        .add(aaLine(abs(dd.sub(r0.add(f2.mul(span)))), wr, pixD).mul(g2.mul(g2)));
      const flicker = float(0.92).add(sin(T.mul(13.1)).mul(sin(T.mul(5.3).add(1.0))).mul(0.08));
      const breathe = float(0.85).add(sin(T.mul(1.3)).mul(0.15));
      const ballG = kM.mul(5.0).add(kI.mul(4.0)).add(kO.mul(float(1.0).add(charge.mul(1.4)).mul(float(1.0).add(relayOn.mul(0.4))))).add(kR.mul(4.0));
      const haloG = kM.mul(0.45).add(kI.mul(0.35)).add(kO.mul(charge.mul(0.25).add(0.05))).add(kR.mul(0.4));
      const diskG = kM.mul(0.035).add(kI.mul(0.12)).add(kR.mul(0.25));
      const ripG = kM.mul(0.7).add(kI.mul(0.9)).add(kR.mul(0.9));
      const pulse = mix(1.0, flicker, kM.add(kI)).mul(mix(1.0, breathe, kO));
      // trafienie w ring zapala się dopiero, gdy czoło wybiegającego promienia dojdzie do celu
      const gainF = U.uPlantBeam.x.mul(mix(1.0, smoothstep(0.82, 1.0, relayOn).mul(relayK), relay));
      col.assign(vec3(...C_CORE).mul(ball.mul(ballG))
        .add(vec3(...C_SHEATH).mul(halo.mul(haloG)))
        .add(vec3(...C_GLOW).mul(fill.mul(diskG).add(ripple.mul(ripG)).mul(edge)))
        .mul(pulse).mul(gainF));
    });
    const out = min(max(col.mul(nearK), vec3(0.0)), vec3(40.0));
    return vec4(out, max(out.r, max(out.g, out.b)));
  })();
  return { fragmentNode };
}

let GRAPH = null;

/** Promień / rozbłyski (warstwa w `uniforms.uPlantLayer`): addytywnie, bez zapisu głębi, obie strony (liczy się jedna). */
export function createPlantBeamMaterial(uniforms) {
  GRAPH ??= buildBeamGraph();
  const m = new THREE.NodeMaterial();
  m.name = 'EarthBitePlantBeam';
  m.uniforms = uniforms;
  m.fragmentNode = GRAPH.fragmentNode;
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  blendAddytywnePremul(m);
  return m;
}
