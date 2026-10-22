// Elektrownia „KOREK” — materiał PROMIENIA energii (główny: wylot korka → czasza odbiornika, przekaźnikowy: odbiornik →
// ring) i ROZBŁYSKÓW (wylot krateru, uderzenie w czaszę, kula ładowania magazynu, trafienie w ring).
//
// Siatki są tylko OSŁONAMI (walec wokół osi, kula wokół rozbłysku); jasność liczy się analitycznie z odległości promienia
// widzenia od osi odcinka (albo od środka rozbłysku) w przestrzeni widoku (modelViewMatrix — w grze składana w double,
// pozycje świata 5–10 mln j. bez drżenia). Ten sam obraz z boku, z ukosa i od czoła: z góry promień to jasny punkt
// z poświatą i pierścieniem włókien, nie walec widziany od dna. Atrybuty (stałe na siatce, earthBitePlantBeam.js):
//   aBeamA — początek osi (układ lokalny siatki) | środek rozbłysku; w — rodzaj: 0 promień, 1 wylot, 2 uderzenie,
//            3 kula ładowania, 4 trafienie w ring,
//   aBeamB — koniec osi | punkt środek + oś × 1 R (kierunek tarczy rozbłysku); w — 1: przekaźnik (× uPlantState.x),
//   aBeamR — promień: rdzeń, otoczka, osłona, wygaszanie końców [R]; rozbłysk: rdzeń, halo, osłona, tarcza [R],
//   aBeamP — przewężenia otoczki przy pierścieniach zamknięcia: droga pierwszego [R], krok [R], liczba, 1 — włączone.
// Warstwa w `uPlantLayer`: 0 — rdzeń, otoczka, włókna i pakiety (wąska osłona), 1 — szeroka poświata, 2 — oba
// (przekaźnik), 3 — rozbłyski. Mieszanie ONE/ONE (blendAddytywnePremul), bez zapisu głębi, forceSinglePass. Osłony
// wypukłe rysowane obiema stronami, liczy się JEDNA: przednia, a gdy kamera jest w osłonie (zbliżenie w demie) — tylna;
// druga strona wychodzi od razu (bez pracy). Fragment bez pętli; pochodne przed gałęziami.
import * as THREE from 'three/webgpu';
import {
  Fn, If, float, vec3, vec4, attribute, varying, positionView, modelViewMatrix, modelWorldMatrix, cameraProjectionMatrix, frontFacing,
  abs, clamp, cos, cross, dot, exp, floor, fract, fwidth, length, max, min, mix, normalize, select, sin, smoothstep, sqrt
} from 'three/tsl';
import { blendAddytywnePremul } from './tsl/mieszanie.js';
import { perObjectUniforms, sdown, aaLine, hash11 } from './earthBitePlantCommon.tsl.js';

/** Rodzaje (aBeamA.w) i warstwy (uPlantLayer) — wspólne z budową siatek. */
export const BEAM_KIND = Object.freeze({ BEAM: 0, MOUTH: 1, IMPACT: 2, ORB: 3, RELAY_HIT: 4 });
export const BEAM_LAYER = Object.freeze({ INNER: 0, GLOW: 1, RELAY: 2, FLARE: 3 });

// styl (R Ziemi, s): pakiety energii w górę promienia, skręt włókien
const FLOW_SPEED = 0.15;     // pakiety [R/s]
const FLOW_STEP = 0.034;     // odstęp pakietów [R]
const TWIST_STEP = 0.045;    // jeden obrót włókien na tyle długości [R]
const TWIST_RATE = 1.6;      // obrót włókien [rad/s]

const C_CORE = [0.92, 0.97, 1.0];
const C_SHEATH = [0.12, 0.56, 1.0];
const C_STRAND = [0.5, 0.86, 1.0];
const C_GLOW = [0.2, 0.52, 1.0];

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
    const p = vec3(positionView).toVar();
    const ortho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
    // rozmiar piksela: kąt (perspektywa) albo długość (orto) — liniowe w ekranie, niezależne od nachylenia osłony
    const q2 = select(ortho, p.xy, p.xy.div(max(p.z.negate(), 1e-9)));
    const pixA = float(0.0).toVar();
    pixA.assign(length(fwidth(q2)).mul(0.7071));
    const D = select(ortho, vec3(0.0, 0.0, -1.0), normalize(p)).toVar();
    const kind = vK.x;
    const relay = vK.y;
    const invS = vK.z;
    const T = U.uPlantTime;
    const relayOn = U.uPlantState.x;
    const gain = U.uPlantBeam.x.mul(mix(1.0, relayOn, relay)).toVar();
    const layer = U.uPlantLayer;
    const col = vec3(0.0).toVar();
    // kamera w osłonie (tylko perspektywa — początek widoku): odległość od odcinka osi / od środka rozbłysku
    const eA = vB.sub(vA);
    const s0 = clamp(dot(vA.negate(), eA).div(max(dot(eA, eA), 1e-30)), 0.0, 1.0);
    const camD = select(kind.lessThan(0.5), length(vA.add(eA.mul(s0))), length(vA)).mul(invS);
    const inside = ortho.not().and(camD.lessThan(vR.z));
    const keep = select(inside, frontFacing.not(), frontFacing);

    If(keep.and(kind.lessThan(0.5)), () => {
      // ── PROMIEŃ: najbliższe podejście promienia widzenia (p + t·D) do odcinka A → B ──
      const e = vB.sub(vA).toVar();
      const C = max(dot(e, e), 1e-30).toVar();
      const w0 = p.sub(vA);
      const Bd = dot(D, e).toVar();
      const Dd = dot(D, w0);
      const sRaw = dot(e, w0).sub(Dd.mul(Bd)).div(max(C.sub(Bd.mul(Bd)), C.mul(1e-6)));
      const s = clamp(sRaw, 0.0, 1.0).toVar();
      const t = s.mul(Bd).sub(Dd);
      const wv = w0.add(D.mul(t)).sub(e.mul(s)).toVar();
      const d = length(wv).mul(invS).toVar();
      const LR = sqrt(C).mul(invS);
      const sR = s.mul(LR).toVar();
      // sin kąta oś ↔ promień widzenia (0 — od czoła), odległość ze znakiem w poprzek promienia na ekranie
      const sinT = sqrt(max(float(1.0).sub(Bd.mul(Bd).div(C)), 0.0)).toVar();
      const side = cross(e, D);
      const dS = dot(wv, side).div(max(length(side), 1e-30)).mul(invS);
      const zb = max(p.add(D.mul(t)).z.negate(), 1e-9);
      const pix = pixA.mul(select(ortho, float(1.0), zb)).mul(invS).toVar();
      const rc = vR.x, rs = vR.y, rg = vR.z, fadeL = vR.w;
      const ends = smoothstep(0.0, fadeL, sR).mul(smoothstep(0.0, fadeL, LR.sub(sR)));
      // przekaźnik: przy włączaniu promień wybiega z odbiornika, przy gaśnięciu cofa się do niego
      const reach = relayOn.mul(1.12);
      const front = mix(1.0, sdown(reach.sub(0.08), reach, s), relay);
      const amp = gain.mul(ends).mul(front).toVar();
      // pakiety energii płyną w górę (głowa jasna, ogon w dół; jasność pakietu z haszu numeru mod 97 — wejście ograniczone);
      // od czoła i z daleka — średnia
      const u = sR.sub(T.mul(FLOW_SPEED)).div(FLOW_STEP);
      const ph = fract(u);
      const pk = smoothstep(0.2, 0.93, ph).mul(sdown(0.93, 1.0, ph)).mul(float(0.55).add(hash11(fract(floor(u).mul(1.0 / 97.0)).mul(97.0).add(17.0)).mul(0.45)));
      const pkVis = smoothstep(0.12, 0.45, sinT).mul(sdown(FLOW_STEP / 10, FLOW_STEP / 3, pix));
      const packets = mix(0.33, pk, pkVis).toVar();
      // przewężenie przy najbliższym pierścieniu zamknięcia: otoczka i włókna ciaśniej, plazma jaśniejsza
      const kRing = clamp(floor(sR.sub(vP.x).div(max(vP.y, 1e-3)).add(0.5)), 0.0, max(vP.z.sub(1.0), 0.0));
      const dz = sR.sub(vP.x.add(kRing.mul(vP.y))).div(0.011);
      const pinch = exp(dz.mul(dz).negate()).mul(vP.w).toVar();
      const rsP = rs.mul(float(1.0).sub(pinch.mul(0.24)));
      const shimmer = float(0.88).add(sin(sR.mul(113.0).sub(T.mul(9.0))).mul(sin(sR.mul(37.0).add(T.mul(3.7)))).mul(0.12));
      const innerOn = select(layer.lessThan(0.5).or(layer.greaterThan(1.5)), float(1.0), float(0.0));
      const glowOn = select(layer.greaterThan(0.5), float(1.0), float(0.0));
      // ekspozycja wg rozmiaru na ekranie: z daleka (rdzeń ~1 px) jasny ponad próg bloomu, z bliska (dziesiątki px)
      // spokojniejszy — inaczej bloom gry rozlewa zbliżenie w białą belkę
      const nrc = rc.div(max(pix, 1e-9));
      const coreG = mix(4.2, 1.15, smoothstep(1.5, 18.0, nrc));
      const sheathG = mix(1.25, 0.42, smoothstep(3.0, 40.0, rs.div(max(pix, 1e-9))));
      // rdzeń: biały, rozżarzony; cieńszy niż piksel — grubieje do piksela z jasnością × √(r / szerokość)
      const rcE = min(max(rc, pix.mul(0.9)), rg.mul(0.45));
      const xc = d.div(rcE);
      const core = exp(xc.mul(xc).mul(-3.0)).mul(sqrt(rc.div(rcE))).mul(coreG);
      // otoczka: świecąca powłoka (droga przez warstwę 0,4…1 promienia — jaśniejsze brzegi), miękki obrys
      const rsE = min(max(rsP, pix.mul(1.6)), rg.mul(0.85));
      const xs = d.div(rsE);
      const tube = sqrt(max(float(1.0).sub(xs.mul(xs)), 0.0)).sub(sqrt(max(float(0.16).sub(xs.mul(xs)), 0.0)))
        .mul(1.0 / 0.9165).mul(sdown(0.72, 1.0, xs)).mul(rsP.div(rsE));
      // włókna: 3 spirale wokół rdzenia (rzut: sinusoidy w poprzek, przednia jaśniejsza); od czoła — okrąg
      const rf = rsP.mul(0.62);
      const wf = rs.mul(0.085);
      const tw = sR.mul(6.2832 / TWIST_STEP).sub(T.mul(TWIST_RATE)).toVar();
      const strand = (a) => aaLine(abs(dS.sub(rf.mul(cos(tw.add(a))))), wf, pix).mul(float(0.55).add(sin(tw.add(a)).mul(0.45)));
      const helix = strand(0.0).add(strand(2.0944)).add(strand(4.1888));
      const ringS = aaLine(abs(d.sub(rf)), wf, pix).mul(1.4);
      const sideOn = smoothstep(0.1, 0.4, sinT);
      const strands = mix(ringS, helix, sideOn).mul(sdown(rf.mul(0.6), rf.mul(1.6), pix));
      const inner = vec3(...C_CORE).mul(core.mul(float(0.78).add(shimmer.mul(0.1)).add(packets.mul(0.2))))
        .add(vec3(...C_SHEATH).mul(tube.mul(float(0.42).add(packets.mul(1.3))).mul(float(1.0).add(pinch.mul(0.7))).mul(shimmer).mul(sheathG)))
        .add(vec3(...C_STRAND).mul(strands.mul(float(1.0).add(packets.mul(0.8)))));
      // szeroka poświata: niska jasność (pod progiem bloomu), zero na brzegu osłony
      const glow = vec3(...C_GLOW).mul(softFall(d.div(rg)).mul(float(0.2).add(packets.mul(0.12))));
      col.assign(inner.mul(innerOn).add(glow.mul(glowOn)).mul(amp));
    }).ElseIf(keep, () => {
      // ── ROZBŁYSK: najbliższe podejście promienia widzenia do środka; tarcza ⟂ osi (spłaszczona z boku) ──
      const c = vA;
      const ax = vB.sub(vA);
      const axN = ax.div(max(length(ax), 1e-30));
      const tq = dot(c.sub(p), D);
      const qR = p.add(D.mul(tq)).sub(c).mul(invS).toVar();
      const dq = length(qR).toVar();
      const cosT = dot(D, axN).toVar();
      const sinT = sqrt(max(float(1.0).sub(cosT.mul(cosT)), 0.0));
      const qa = dot(qR, axN.sub(D.mul(cosT))).div(max(sinT, 1e-4));
      const ac = max(abs(cosT), 0.08);
      const dd = sqrt(max(dq.mul(dq).sub(qa.mul(qa)), 0.0).add(qa.div(ac).mul(qa.div(ac)))).toVar();
      const zb = max(c.z.negate(), 1e-9);
      const pix = pixA.mul(select(ortho, float(1.0), zb)).mul(invS).toVar();
      const kM = kindIs(kind, 1), kI = kindIs(kind, 2), kO = kindIs(kind, 3), kR = kindIs(kind, 4);
      const charge = U.uPlantState.y;
      // kula ładowania rośnie z naładowaniem magazynu, przy przekazie świeci mocniej (oddaje)
      const orbSize = float(0.35).add(charge.mul(0.65));
      const rc = vR.x.mul(mix(1.0, orbSize, kO));
      const rh = vR.y.mul(mix(1.0, orbSize, kO));
      const rd = vR.w;
      const rcE = max(rc, pix.mul(0.9));
      const xc = dq.div(rcE);
      // jak rdzeń promienia: z bliska spokojniej (bloom), z daleka energia punktu zachowana
      const ball = exp(xc.mul(xc).mul(-2.0)).mul(rc.div(rcE).mul(rc.div(rcE))).mul(mix(1.0, 0.45, smoothstep(4.0, 40.0, rc.div(max(pix, 1e-9)))));
      const halo = softFall(dq.div(rh));
      // tarcza: wypełnienie i dwie fale rozchodzące się od środka; z boku cieńsza i jaśniejsza
      const edge = min(float(1.0).div(ac), 2.2);
      const fill = sdown(0.0, 1.0, dd.div(rd)).mul(sdown(0.0, 1.0, dd.div(rd)));
      const rate = kM.mul(0.55).add(kI.mul(0.9)).add(kR.mul(0.8));
      const f1 = fract(T.mul(rate));
      const f2 = fract(T.mul(rate).add(0.5));
      // fale: piksel w płaszczyźnie tarczy (z boku ściśniętej) — linie nie migoczą przy tarczy widzianej z ukosa
      const wr = rd.mul(0.045);
      const pixD = pix.div(ac);
      const ripple = aaLine(abs(dd.sub(f1.mul(rd))), wr, pixD).mul(float(1.0).sub(f1))
        .add(aaLine(abs(dd.sub(f2.mul(rd))), wr, pixD).mul(float(1.0).sub(f2)));
      const flicker = float(0.92).add(sin(T.mul(13.1)).mul(sin(T.mul(5.3).add(1.0))).mul(0.08));
      const breathe = float(0.85).add(sin(T.mul(1.3)).mul(0.15));
      const ballG = kM.mul(6.0).add(kI.mul(5.0)).add(kO.mul(float(2.0).add(charge.mul(2.5)).mul(float(1.0).add(relayOn.mul(0.6))))).add(kR.mul(5.0));
      const haloG = kM.mul(0.55).add(kI.mul(0.5)).add(kO.mul(charge.mul(0.45).add(0.08))).add(kR.mul(0.5));
      const diskG = kM.mul(0.14).add(kI.mul(0.16)).add(kR.mul(0.3));
      const ripG = kM.mul(1.5).add(kI.mul(0.9)).add(kR.mul(0.9));
      const pulse = mix(1.0, flicker, kM.add(kI)).mul(mix(1.0, breathe, kO));
      // trafienie w ring zapala się dopiero, gdy czoło wybiegającego promienia dojdzie do celu
      const gainF = U.uPlantBeam.x.mul(mix(1.0, smoothstep(0.82, 1.0, relayOn), relay));
      col.assign(vec3(...C_CORE).mul(ball.mul(ballG))
        .add(vec3(...C_SHEATH).mul(halo.mul(haloG)))
        .add(vec3(...C_GLOW).mul(fill.mul(diskG).add(ripple.mul(ripG)).mul(edge)))
        .mul(pulse).mul(gainF));
    });
    const out = min(max(col, vec3(0.0)), vec3(40.0));
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
