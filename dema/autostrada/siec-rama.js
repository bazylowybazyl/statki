// dema/autostrada/siec-rama.js
//
// SIEĆ „RAMA” — piąta propozycja (2026-11-12), inny UKŁAD drogi niż pierścień: hala K-7 ma zostać stocznią, która wystaje daleko
// od ringu, więc okrąg r ≈ 60–64 tys. przecinałby ją w poprzek. Rama to kwadrat o zaokrąglonych narożach:
//   - cztery proste („prospekty”) styczne do dzisiejszej drogi przy tranzytach (oś jezdni D = 61 740 od środka Ziemi),
//   - cztery naroża opływają głowice stoczni (kompleksy 45°, 135°, 225°, 315°) łukiem o promieniu ≥ 16 tys. j. (L1 nie zwalnia).
// Pasy są krzywymi RÓWNOLEGŁYMI (ta sama odległość w poprzek na prostej i na łuku), a ruch liczy je przez `geo` (siec.js).
// Wszystkie zjazdy, wjazdy, zawrotki i wrota leżą na prostych — ich geometria to proste i łuki w hubie boku (kąt tranzytu).
// Czysty JS, bez three i DOM.
import { HW, NODE, SPEED, DEG, R0, Path, hubToWorld, worldToHub, complexes, transits, przygotujSiec, heavyRoadIn, heavyRoadOut, mirrorPath } from './siec.js';

const HPI = Math.PI * 0.5;

/** Nastawy układu. Stocznia: makieta — obrys i zasięg, nie projekt bryły (tę robi użytkownik). */
export const RAMA = Object.freeze({
  zasieg: 29000,          // głowica stoczni: j. od początku huba (R0 = 46 002); brama hali K-7 jest dziś na 7 400
  odstep: 2000,           // wolne między głowicą a krawędzią jezdni wewnętrznej
  rcMin: 16000,           // najmniejszy promień naroża osi drogi (v² / R ≤ 150 przy 1 500 j./s na L1)
  rcMax: 18000,           // największy: proste muszą pomieścić rampy zatok przed narożem
  stoczniaPol: 1500,      // pół szerokości bryły stoczni; pochylnie ±810 w środku
  // Pasy promieniowe węzła stoczni (hub kompleksu): pochylnie ±810 (wylot ze stoczni), ±2 430 wyjazd ciężkich wzdłuż burt,
  // ±4 050 wjazd ciężkich. Wyjazd leży BLIŻEJ osi niż wjazd — drogi przedpola (r 56,4 i 57,4 tys.) się nie przecinają.
  pasy: Object.freeze([-4050, -2430, -810, 810, 2430, 4050]),
  pasWylot: Object.freeze([-2430, -810, 810, 2430]),
  xCiezkiWe: 4050, xCiezkiWy: 2430,
  boxHalf: 5200, stopX: 5700,
  zBramyK7: 7400,
  // Miejsca na prostej [kąt od osi boku, stopnie]: zawrotki jak w pierścieniu (28° i 30,5° od kompleksu), wrota 31°.
  uBay: 17, uT: 14.5, wrota: 31,
  atlasWglab: 2600        // środek Atlasa na pochylni: tyle j. przed głowicą
});

/** Wymiary ramy dla zasięgu stoczni: D — odległość osi drogi od środka na prostej, Rc — promień naroża osi, a = D − Rc. */
export function ukladRamy({ zasieg = RAMA.zasieg, odstep = RAMA.odstep } = {}) {
  const glowica = R0 + zasieg;
  const wymagany = glowica + odstep + (HW.median - HW.edgeIn);   // promień osi drogi na przekątnej (wierzchołek naroża)
  let D = HW.median;
  let Rc = (D * Math.SQRT2 - wymagany) / (Math.SQRT2 - 1);
  if (Rc > RAMA.rcMax) Rc = RAMA.rcMax;
  else if (Rc < RAMA.rcMin) { Rc = RAMA.rcMin; D = (wymagany - Rc) / Math.SQRT2 + Rc; }
  const a = D - Rc;
  return Object.freeze({ zasieg, odstep, glowica, D, Rc, a, dz: D - HW.median, wierzcholek: a * Math.SQRT2 + Rc });
}

/** Geometria pasów ramy (interfejs `geo` z siec.js). Droga `u` liczona CCW od punktu (D, 0); jezdnia 0 jedzie pod prąd tej miary. */
export function geoRamy(u) {
  const { D, Rc, a } = u;
  const RREF = Object.freeze([HW.iL2, HW.oL2]);
  const Rco = [Rc + RREF[0] - HW.median, Rc + RREF[1] - HW.median];
  const Dco = [D + RREF[0] - HW.median, D + RREF[1] - HW.median];
  const luk = [Rco[0] * HPI, Rco[1] * HPI];
  const Q = [2 * a + luk[0], 2 * a + luk[1]];
  const OBWOD = Object.freeze([4 * Q[0], 4 * Q[1]]);
  const _c = { x: 0, y: 0, h: 0, kr: 0, u: 0, n: 0 };

  // Punkt pasa odniesienia jezdni `cw` w drodze CCW `uu`, odsunięty o n na zewnątrz; kurs CCW, krzywizna ≥ 0.
  function ccw(cw, uu, n, out) {
    const ob = OBWOD[cw];
    let w = uu % ob;
    if (w < 0) w += ob;
    let k = Math.floor(w / Q[cw]);
    if (k > 3) k = 3;
    w -= k * Q[cw];
    let x; let y; let h; let kr;
    if (w < a) { x = Dco[cw] + n; y = w; h = HPI; kr = 0; }
    else if (w < a + luk[cw]) {
      const f = (w - a) / Rco[cw];
      const R = Rco[cw] + n;
      x = a + R * Math.cos(f); y = a + R * Math.sin(f); h = f + HPI; kr = 1 / R;
    } else { x = a - (w - a - luk[cw]); y = Dco[cw] + n; h = Math.PI; kr = 0; }
    if (k === 1) { const t = x; x = -y; y = t; } else if (k === 2) { x = -x; y = -y; } else if (k === 3) { const t = x; x = y; y = -t; }
    out.x = x; out.y = y; out.h = h + k * HPI; out.kr = kr;
  }
  // Rzut punktu: droga CCW, odsunięcie od pasa odniesienia (na zewnątrz dodatnie), kurs CCW.
  function rzutCcw(cw, x, y, out) {
    let k; let xl; let yl;
    if (x > 0 && y >= 0) { k = 0; xl = x; yl = y; }
    else if (x <= 0 && y > 0) { k = 1; xl = y; yl = -x; }
    else if (x < 0 && y <= 0) { k = 2; xl = -x; yl = -y; }
    else { k = 3; xl = -y; yl = x; }
    let w; let n; let h;
    if (xl > a && yl > a) {
      const dx = xl - a;
      const dy = yl - a;
      const f = Math.atan2(dy, dx);
      w = a + f * Rco[cw]; n = Math.sqrt(dx * dx + dy * dy) - Rco[cw]; h = f + HPI;
    } else if (yl < xl) { w = yl; n = xl - Dco[cw]; h = HPI; }
    else { w = a + luk[cw] + (a - xl); n = yl - Dco[cw]; h = Math.PI; }
    out.u = k * Q[cw] + w; out.n = n; out.h = h + k * HPI;
  }
  const sZU = (cw, uu) => {
    if (cw === 1) return uu;
    const s = OBWOD[0] - uu;
    return s >= OBWOD[0] ? s - OBWOD[0] : s;
  };
  function poza(cw, s, r, out) {
    ccw(cw, cw === 1 ? s : OBWOD[0] - s, r - RREF[cw], out);
    if (cw === 0) { out.h += Math.PI; out.kr = -out.kr; }
  }
  function rzut(cw, x, y, out) {
    rzutCcw(cw, x, y, _c);
    out.s = sZU(cw, _c.u);
    out.r = RREF[cw] + _c.n;
    out.h = cw === 1 ? _c.h : _c.h + Math.PI;
  }
  const sPunktu = (cw, x, y) => { rzutCcw(cw, x, y, _c); return sZU(cw, _c.u); };
  const rPunktu = (x, y) => { rzutCcw(1, x, y, _c); return RREF[1] + _c.n; };
  // Punkt pasa odniesienia na promieniu pod kątem biegunowym: przecięcie promienia z prostą boku albo łukiem naroża.
  function sKata(cw, katDeg) {
    const t = ((katDeg % 360) + 360) % 360;
    const k = Math.min(3, Math.floor(t / 90));
    const f = (t - k * 90) * DEG;
    const c = Math.cos(f);
    const sn = Math.sin(f);
    let d;
    if (Dco[cw] * sn <= a * c) d = Dco[cw] / c;
    else if (Dco[cw] * c <= a * sn) d = Dco[cw] / sn;
    else {
      const b = a * (c + sn);
      d = b + Math.sqrt(Math.max(0, b * b - 2 * a * a + Rco[cw] * Rco[cw]));
    }
    const g = t * DEG;
    return sPunktu(cw, d * Math.cos(g), d * Math.sin(g));
  }
  const sWzdluz = (cw, katDeg, d) => {
    const s = (sKata(cw, katDeg) + d) % OBWOD[cw];
    return s < 0 ? s + OBWOD[cw] : s;
  };
  const thetaOf = (cw, s) => { poza(cw, s, RREF[cw], _c); return Math.atan2(_c.y, _c.x); };
  /** Polilinia krzywej równoległej o współrzędnej bocznej r, CCW od (D + r − oś, 0): { x, y, s, tx, ty }. */
  function obrys(r, kroki = 2400) {
    const n = kroki + 1;
    const x = new Float64Array(n); const y = new Float64Array(n); const s = new Float64Array(n);
    const tx = new Float64Array(n); const ty = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      poza(1, (i / kroki) * OBWOD[1], r, _c);
      x[i] = _c.x; y[i] = _c.y; tx[i] = Math.cos(_c.h); ty[i] = Math.sin(_c.h);
      if (i) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
    }
    return { x, y, s, tx, ty, n };
  }
  return Object.freeze({ id: 'rama', uklad: u, RREF, OBWOD, sKata, sWzdluz, sPunktu, rPunktu, rzut, poza, thetaOf, obrys });
}

/** Cała sieć ramy: te same rodzaje ścieżek, węzłów i identyfikatory co w pierścieniu (ruch.js nie rozróżnia układów). */
export function buildNetworkRamy(u) {
  const h = HW; const N = NODE; const paths = []; const nodes = []; const signals = [];
  const { a } = u;
  const Z = (r) => r + u.dz - R0;            // z huba boku: prosta pasa o współrzędnej bocznej r
  const zs = Z(h.iShoulder); const z3 = Z(h.iL3);
  const zso = Z(h.oShoulder); const z3o = Z(h.oL3);

  // --- Pasy główne: prosta, łuk naroża, prosta… (jezdnia zewnętrzna CCW, wewnętrzna CW) ---
  const ROGI = [[a, a, 0], [-a, a, 90], [-a, -a, 180], [a, -a, 270]];
  function pasGlowny(id, r, cw, meta) {
    const p = new Path(id, { kind: 'main', r, ...meta });
    const z = Z(r);
    const Rr = u.Rc + r - h.median;
    if (cw === 1) {
      p.hubLine(0, 0, z, a, z);
      for (let k = 0; k < 4; k++) {
        const [cx, cy, a0] = ROGI[k];
        p.circ(cx, cy, Rr, a0, a0 + 90);
        if (k < 3) p.hubLine((k + 1) * 90, -a, z, a, z); else p.hubLine(0, -a, z, 0, z);
      }
    } else {
      p.hubLine(0, 0, z, -a, z);
      for (let k = 3; k >= 0; k--) {
        const [cx, cy, a0] = ROGI[k];
        p.circ(cx, cy, Rr, a0 + 90, a0);
        if (k > 0) p.hubLine(k * 90, a, z, -a, z); else p.hubLine(0, a, z, 0, z);
      }
    }
    return p;
  }
  const main = [
    ['I.L3', h.iL3, 0, 'in', 240, SPEED.L3], ['I.L2', h.iL2, 0, 'in', 400, SPEED.L2], ['I.L1', h.iL1, 0, 'in', 400, SPEED.L1],
    ['O.L1', h.oL1, 1, 'out', 400, SPEED.L1], ['O.L2', h.oL2, 1, 'out', 400, SPEED.L2], ['O.L3', h.oL3, 1, 'out', 240, SPEED.L3]
  ];
  for (const [id, r, cw, carriageway, width, v] of main) paths.push(pasGlowny(id, r, cw, { carriageway, width, vmax: v, beamMax: width - 88 }));

  // --- Rampy jezdni wewnętrznej: prosta boku t ↔ spur promieniowy miejsca `aSpur` (x = X w jego hubie) ---
  // Zaokrąglenie dwóch prostych łukiem turnR; dla spuru prostopadłego (tranzyt) to dokładnie rampa pierścienia na prostej.
  function spurWBoku(t, aSpur, X, zKoniec) {
    const p0 = hubToWorld(aSpur, X, zKoniec);
    const p1 = hubToWorld(aSpur, X, zKoniec + 1000);
    const q0 = worldToHub(t, p0.x, p0.y);
    const q1 = worldToHub(t, p1.x, p1.y);
    const ex = (q1.x - q0.x) / 1000;
    const ez = (q1.z - q0.z) / 1000;
    const lam = (zs - q0.z) / ez;                  // do przecięcia z prostą pobocza
    return { ex, ez, lam, ix: q0.x + ex * lam };
  }
  function zjazd(t, aSpur, X, zKoniec, id, meta = {}) {
    const R = N.turnR;
    const g = spurWBoku(t, aSpur, X, zKoniec);
    const fi = Math.acos(Math.max(-1, Math.min(1, g.ex)));     // skręt z kierunku −x na spur w dół
    const T = R * Math.tan(fi * 0.5);
    const xT = g.ix + T;
    const xD = xT + N.decelLen;
    const xK = xD + N.taperLen;
    const p = new Path(id, { kind: 'rampOff', site: aSpur, bok: t, X, ...meta });
    p.hubS(t, xK, z3, xD, zs).hubLine(t, xD, zs, xT, zs);
    p.hubArc(t, xT, zs - R, R, HPI, HPI + fi);
    p.hubLine(aSpur, X, zKoniec + g.lam - T, X, zKoniec);
    p.xStyku = xT; p.xKlina = xK;
    return p;
  }
  function wjazd(t, aSpur, X, zStart, id, meta = {}) {
    const R = N.turnR;
    const g = spurWBoku(t, aSpur, X, zStart);
    const fi = Math.acos(Math.max(-1, Math.min(1, -g.ex)));    // skręt ze spuru w górę na kierunek −x
    const T = R * Math.tan(fi * 0.5);
    const xT = g.ix - T;
    const xA = xT - N.accelLen;
    const xK = xA - N.taperLen;
    const p = new Path(id, { kind: 'rampOn', site: aSpur, bok: t, X, ...meta });
    p.hubLine(aSpur, X, zStart, X, zStart + g.lam - T);
    p.hubArc(t, xT, zs - R, R, HPI - fi, HPI);
    p.hubLine(t, xT, zs, xA, zs).hubS(t, xA, zs, xK, z3);
    p.xStyku = xT; p.xKlina = xK;
    return p;
  }

  // --- Zawrotka na prostej: kieszeń przy pasie rozdziału, półokrąg wokół osi ---
  function zawrotka(t, xu, kind, id, meta = {}) {
    const sg = kind === 'U1' ? 1 : -1;       // kierunek jazdy przed zawrotką w x (U1: jezdnia zewnętrzna, +x)
    const zL0 = Z(kind === 'U1' ? h.oL1 : h.iL1);
    const zP0 = Z(kind === 'U1' ? h.oPocket : h.iPocket);
    const zP1 = Z(kind === 'U1' ? h.iPocket : h.oPocket);
    const zL1 = Z(kind === 'U1' ? h.iL1 : h.oL1);
    const p = new Path(id, { kind: 'uturn', uKind: kind, bok: t, xu, ...meta });
    p.hubS(t, xu - sg * (N.pocketDecel + N.pocketTaper), zL0, xu - sg * N.pocketDecel, zP0);
    p.hubLine(t, xu - sg * N.pocketDecel, zP0, xu, zP0);
    p.hubArc(t, xu, Z(h.median), h.uturnR, kind === 'U1' ? HPI : -HPI, kind === 'U1' ? -HPI : -3 * HPI);
    p.hubLine(t, xu, zP1, xu - sg * N.pocketAccel, zP1);
    p.hubS(t, xu - sg * N.pocketAccel, zP1, xu - sg * (N.pocketAccel + N.pocketTaper), zL1);
    return p;
  }

  // --- Wrota z kosmosu: aleja prostopadła do boku po stronie zewnętrznej ---
  const zDal = Math.max(N.dLen, zso + 20000);
  function wrotaWe(t, xg, id, meta = {}) {
    const R = N.dTurnR;
    const p = new Path(id, { kind: 'gateIn', bok: t, xg, ...meta });
    p.hubLine(t, xg, zDal, xg, zso + R);
    p.hubArc(t, xg + R, zso + R, R, Math.PI, 3 * HPI);
    p.hubLine(t, xg + R, zso, xg + R + N.accelLen, zso).hubS(t, xg + R + N.accelLen, zso, xg + R + N.accelLen + N.taperLen, z3o);
    return p;
  }
  function wrotaWy(t, xg, id, meta = {}) {
    const R = N.dTurnR;
    const xT = xg - R;
    const xD = xT - N.decelLen;
    const p = new Path(id, { kind: 'gateOut', bok: t, xg, ...meta });
    p.hubS(t, xD - N.taperLen, z3o, xD, zso).hubLine(t, xD, zso, xT, zso);
    p.hubArc(t, xT, zso + R, R, -HPI, 0);
    p.hubLine(t, xg, zso + R, xg, zDal);
    return p;
  }

  const xNaBoku = (katDeg) => u.D * Math.tan(katDeg * DEG);   // miejsce na prostej dla kąta od osi boku (na osi drogi)
  const rDaleko = u.wierzcholek + (h.edgeOut - h.median) + 18000;
  const spurZEnd = 50352 - R0;   // podejście grzebienia zatoki

  complexes().forEach((c, ci) => {
    const tag = `C${ci}`;
    const tPrzed = c - 45;       // bok, którym jezdnia zewnętrzna (CCW) dojeżdża do naroża
    const tZa = c + 45;          // bok za narożem
    // Węzeł stoczni: pasy promieniowe przez naroże; pochylnie od bramy dawnej hali, pasy ciężkich wzdłuż burt.
    const zFar = rDaleko - R0;
    for (const x of RAMA.pasy) {
      const dirOut = RAMA.pasWylot.includes(x);
      const p = new Path(`${tag}.BOX${x}`, { kind: 'box', site: c, x, dir: dirOut ? 'out' : 'in', pochylnia: Math.abs(x) === 810, beamMax: 1100, vmax: SPEED.box });
      if (dirOut) p.hubLine(c, x, RAMA.zBramyK7, x, zFar); else p.hubLine(c, x, zFar, x, RAMA.zBramyK7);
      paths.push(p);
    }
    signals.push({ id: `${tag}.K7`, node: 'K7', a: c, stopX: RAMA.stopX, phases: ['MAIN', 'YELLOW', 'CLEAR', 'BOX', 'CLEAR2'] });
    nodes.push({ id: `${tag}.K7`, kind: 'k7', a: c });

    // Zatoki: spur promieniowy od grzebienia (jak w pierścieniu) do prostej; strona − leży na boku przed narożem, + za nim.
    for (const [side, ab, t] of [[-1, c - N.bay, tPrzed], [+1, c + N.bay, tZa]]) {
      const id = `${tag}.Z${side > 0 ? '+' : '-'}`;
      const off = zjazd(t, ab, +N.spurX, spurZEnd, `${id}.IN`, { beamMax: 500, vmax: SPEED.spur });
      const on = wjazd(t, ab, -N.spurX, spurZEnd, `${id}.OUT`, { beamMax: 500, vmax: SPEED.spur });
      paths.push(off, on);
      nodes.push({ id, kind: 'bay', a: ab, bok: t, xIn: off.xStyku, xOut: on.xStyku });
    }

    // Drogi przedpola ciężkich: geometria przy ringu jak w pierścieniu, pasy przez naroże przesunięte poza stocznię.
    for (const side of [1, -1]) {
      const ab = c + N.bay;
      for (const [lane, xb] of [['i', -N.megaX], ['o', N.megaX]]) {
        paths.push(mirrorPath(heavyRoadIn(c, ab, xb, `${tag}.H${side > 0 ? '+' : '-'}${lane}.IN`, RAMA.xCiezkiWe, rDaleko), c, side));
        paths.push(mirrorPath(heavyRoadOut(c, ab, xb, `${tag}.H${side > 0 ? '+' : '-'}${lane}.OUT`, lane, RAMA.xCiezkiWy, rDaleko), c, side));
      }
    }

    // Wrota: wylot przed narożem (bok tPrzed), wlot za nim (bok tZa) — kolejność na jezdni zewnętrznej jak w pierścieniu.
    const gi = wrotaWe(tZa, -xNaBoku(RAMA.wrota), `${tag}.D_IN`, { beamMax: 400, vmax: SPEED.ramp });
    const go = wrotaWy(tPrzed, xNaBoku(RAMA.wrota), `${tag}.D_OUT`, { beamMax: 400, vmax: SPEED.ramp });
    paths.push(gi, go);
    nodes.push({ id: `${tag}.D_IN`, kind: 'gateIn', a: c + N.dIn, bok: tZa, xg: gi.xg });
    nodes.push({ id: `${tag}.D_OUT`, kind: 'gateOut', a: c + N.dOut, bok: tPrzed, xg: go.xg });

    // Zawrotki: po dwie na bok przy każdym narożu.
    for (const [uk, t, xu, name] of [
      ['U1', tZa, -xNaBoku(RAMA.uBay), 'U1'], ['U2', tPrzed, xNaBoku(RAMA.uBay), 'U2'],
      ['U1', tPrzed, xNaBoku(RAMA.uT), 'U1T'], ['U2', tZa, -xNaBoku(RAMA.uT), 'U2T']
    ]) {
      const z = zawrotka(t, xu, uk, `${tag}.${name}`, { beamMax: 400, vmax: SPEED.uturn });
      paths.push(z);
      nodes.push({ id: `${tag}.${name}`, kind: 'uturn', uKind: uk, a: c, bok: t, xu });
    }
  });

  // Tranzyty: oś boku, spur ±280 prostopadle (droga leży tu tam, gdzie w pierścieniu).
  transits().forEach((t, ti) => {
    const id = `T${ti}`;
    const zEnd = 44252 - R0;
    const off = zjazd(t, t, +N.tSpurX, zEnd, `${id}.IN`, { beamMax: 312, vmax: 260 });
    const on = wjazd(t, t, -N.tSpurX, zEnd, `${id}.OUT`, { beamMax: 312, vmax: 260 });
    paths.push(off, on);
    nodes.push({ id, kind: 'transit', a: t, bok: t, xIn: off.xStyku, xOut: on.xStyku });
  });
  return { paths, nodes, signals };
}

/**
 * Sieć ramy gotowa dla ruchu i obrazu (jak `zbudujSiec`): `geo`, `uklad`, nastawy węzła stoczni i tor Atlasa na pochylni.
 * `zasieg` — jak daleko od początku huba (R0) sięga głowica stoczni.
 */
export function zbudujSiecRamy({ zasieg = RAMA.zasieg, odstep = RAMA.odstep, ...opcje } = {}) {
  const u = ukladRamy({ zasieg, odstep });
  const net = buildNetworkRamy(u);
  net.uklad = 'rama';
  net.rama = u;
  net.geo = geoRamy(u);
  net.wezel = Object.freeze({ stopX: RAMA.stopX, boxHalf: RAMA.boxHalf });
  // Atlas: stoi na pochylni −810 tuż przed głowicą; czerwone gaśnie, gdy rufa minie zewnętrzną krawędź jezdni w narożu.
  const c = complexes()[3];
  let lo = zasieg;
  let hi = zasieg + 40000;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) * 0.5;
    const p = hubToWorld(c, -810, m - 900);
    if (net.geo.rPunktu(p.x, p.y) > HW.edgeOut + 200) hi = m; else lo = m;
  }
  net.atlas = Object.freeze({ z0: zasieg - RAMA.atlasWglab, zZwolnienia: hi, zPoza: hi + 11000 });
  return przygotujSiec(net, opcje);
}
