// src/ui/czujkaView.js — widok obrazu czujników po stronie gry: CZUJKA na PPM (struna w stronę myszki + błona 360°),
// GRANICE WYKRYCIA (tafla dwóch poziomów, obustronnie) i KONTAKTY (obłok szarych X-ów). Port `step` z dema
// `dema/kontakty-czujnikow/namiarDemo.js` (reguła `kontakt-czujnikow`, plan `docs/PLAN-kontakt-czujnikow.md` § 7–7b).
//
// Dane: obraz czujników gry (`src/game/sensorPicture.js` — grupy zagrożeń `threats`, niewidziani obserwatorzy `watchers`,
// wiedza `knowList`), ciała niebieskie układu, mój okręt (poza renderu), PPM i kierunek myszki. Obraz przebudowuje się
// co 0,2 s — widok goni go wykładniczo (miejsca, promienie), stan animacji (struna, przejścia granic, objawienie) liczy
// tu, na CPU, czasem klatki. Wynik: Float64Array `CZUJNIKI_IN` (src/3d/czujniki/czujnikiLayout.js) w świecie — render
// (`src/3d/czujniki/czujniki3D.js`, tryb off albo worker przez blok migawki) rzutuje go kamerą.
// Czysty moduł (bez three, DOM, `window` i losowania gry — ziarna z haszy id); rozgrywki nie zmienia.
import { CZUJNIKI_IN, CZUJNIKI_MAX, GRANICA_REC, KONTAKT_REC } from '../3d/czujniki/czujnikiLayout.js';
import { contactSizeClass } from '../game/sensorDetection.js';

const I = CZUJNIKI_IN;
const G = GRANICA_REC;
const K = KONTAKT_REC;
const OFF = 99;
const KM = 1000;

/** Strojenie widoku (wartości z dema). */
export const CZUJKA_TUNE = {
  strHalf: 0.52,          // pół kąta struny [rad]
  beamSigma: 0.36,        // szerokość „wiązki” czujki [rad]
  aimTau: 0.09,           // struna goni myszkę [s], najwyżej aimMax rad/s
  aimMax: 5.5,
  posTau: 0.45,           // miejsce kontaktu goni obraz [s] (przebudowa co 0,2 s)
  posTauIdent: 0.08,      // miejsce okrętu identyfikowanego (poza renderu) — prawie od razu
  radTau: 0.25,           // promienie granic (ślad zmienia się skokiem)
  idSec: 0.55,            // objawienie (obłok X-ów zwija się w kadłub)
  fadeIn: 1.2,            // nowy kontakt narasta [s]
  contactFade: 0.6,       // kontakt zgubiony / duch gaśnie [s]
  winNear: 3000,          // okno granicy przy okręcie [j.] (przesunięcie szarej poza nie)
  grayMerge: 900,         // szara pod czerwoną zlewa się z nią na tylu j.
  sizeR: [380, 600, 900, 1350],       // „ciało” kontaktu z klasy rozmiaru
  sizeMinPx: [6, 8, 10, 13],
  sizeMass: [0.8, 1.0, 1.25, 1.6],
  bodyNearKm: 8,          // ciało w odległości 8 km — pełne wybrzuszenie błony; 10^2,4 dalej — zero
  bodyLogSpan: 2.4
};

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrap = (a) => a - Math.floor((a + Math.PI) / (2 * Math.PI)) * 2 * Math.PI;
const approach = (v, target, dt, tauUp, tauDown = tauUp) => {
  if (!(dt > 0)) return v;
  return v + (target - v) * (1 - Math.exp(-dt / (target > v ? tauUp : tauDown)));
};
const follow = (v, target, dt, tau) => (dt > 0 ? v + (target - v) * (1 - Math.exp(-dt / tau)) : target);
// widoczność granicy: narasta 0,25 s, gaśnie 0,6 s; świeża grupa — od razu
const fadeTo = (cur, on, fresh, dt) => (fresh ? (on ? 1 : 0) : approach(cur, on ? 1 : 0, dt, 0.25, 0.6));

function hash01(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function makeGroup(id) {
  return {
    id, seed: hash01(id, 31, 7), used: -1, fresh: true,
    x: 0, y: 0, d: 1, bearing: 0, est: 0, nBig: 0, nSmall: 0, strOK: false,
    R: 0, Rv: 0, Rprev: NaN, rate: 0,
    me: 0, meR: 0, da: 0, m: 0, reveal: 0, det: 0, flashAge: OFF, lvlTrue: 0,
    lvl: -1, cC: { age: OFF, dir: 1, ang: 0, R: 0 }, cV: { age: OFF, dir: 1, ang: 0, R: 0 }, gvis: 1,
    myLvl: 0, redA: 0, grayA: 0, knownA: 0, knownV: 0, alive: 0
  };
}

function makeContact(id) {
  return { id, seed: hash01(id, 17, 5), used: -1, x: 0, y: 0, err: 0, cls: 1, born: 0, alpha: 0, idP: 0, lvl: 0, live: 0 };
}

/** Wejście klatki obrazu czujników (Float64Array układu CZUJNIKI_IN) — pakuje je `packCzujkaView`. */
export function createCzujnikiInput() {
  const f = new Float64Array(I.size);
  f[I.serial] = -1;
  return f;
}

/** Stan widoku (jeden na grę). */
export function createCzujkaView(tune = CZUJKA_TUNE) {
  return {
    tune, time: 0, frame: 0, serial: 0,
    on: false, onAge: OFF, usedSec: 0, vis: 0, phi: NaN, aimTarget: 0, amp: 0, pluck: 0, tau: 7.3, harm: 0, det: 0,
    groups: new Map(), contacts: new Map(), bodies: new Map(),
    _glist: [], _clist: [], _blist: [],
    _pose: { x: 0, y: 0, angle: 0 },
    stats: { groups: 0, contacts: 0, bodies: 0, inBeam: 0 }
  };
}

/** Wybór grup / kontaktów / ciał do pakowania (bez alokacji: listy w stanie). */
function groupOf(V, id) {
  let g = V.groups.get(id);
  if (!g) { g = makeGroup(id); V.groups.set(id, g); }
  return g;
}

/**
 * Krok widoku. `inp`:
 *  time — czas widoku [s] (klatki renderu), on — PPM trzymany, aim — kierunek myszki od okrętu [rad, osie gry],
 *  px, py — mój okręt (poza renderu), shipLen [j.], sig — mój ślad względem bazowego (ciąg > 1, cisza < 1),
 *  picture — obraz czujników (sensorPicture) albo null, poseOf(e, out) → bool — poza renderu bytu (identyfikowany
 *  wróg i obserwator: środek koła granicy bez opóźnienia przebudowy), bodies — [{ id, x, y, R, kind }] ciała układu,
 *  alpha — mnożnik widoczności całości (soczewka HUD w skoku), show — false: wszystko gaśnie.
 */
export function stepCzujkaView(V, dt, inp) {
  const T = V.tune;
  dt = Math.max(0, Math.min(0.1, Number(dt) || 0));
  V.time = Number(inp.time) || 0;
  V.frame++;
  const show = inp.show !== false;
  const px = inp.px, py = inp.py;
  // PPM: nadyma / gaśnie
  const on = show && !!inp.on;
  if (on && !V.on) V.onAge = 0;
  V.on = on;
  V.onAge = Math.min(OFF, V.onAge + dt);
  if (on) V.usedSec += dt;
  V.vis = approach(V.vis, on ? 1 : 0, dt, 0.14, 0.32);
  const aimT = Number.isFinite(inp.aim) ? inp.aim : (Number.isFinite(V.phi) ? V.phi : 0);
  V.aimTarget = aimT;
  if (!Number.isFinite(V.phi) || V.vis < 0.002) V.phi = aimT;   // zgaszona struna staje od razu w kierunku myszki
  const dphi = wrap(aimT - V.phi);
  const stepA = Math.max(-T.aimMax * dt, Math.min(T.aimMax * dt, dphi * (1 - Math.exp(-dt / T.aimTau))));
  V.phi = wrap(V.phi + stepA);

  // ---------------------------------------------------------------- grupy (jedno koło i jedna gromada zębów na skupisko)
  // Obraz czujników łączy znanych wrogów i niewidzianych obserwatorów w grupy po miejscu (`P.borders`, 2026-11-12 —
  // „grupa myśliwców jedno koło, cała baza z jednostkami jedno koło”). Grupa bez znanych członków = sama granica (nie
  // wykrywam ich), zęby czujki tylko ze znanych członków.
  const P = inp.picture && inp.picture.ready ? inp.picture : null;
  const glist = V._glist;
  glist.length = 0;
  const pose = V._pose;
  const fr = V.frame;
  const Bd = P && show ? P.borders : null;
  for (let i = 0; Bd && i < Bd.n; i++) {
    const lead = Bd.lead[i];
    if (!lead) continue;
    const g = groupOf(V, lead.id);
    g.used = fr;
    // środek: identyfikowany lider albo obserwator (prawdziwe miejsce) — poza renderu, bez opóźnienia przebudowy;
    // kontakt — miejsce przybliżone, gonione wolniej
    let tx = Bd.x[i], ty = Bd.y[i], tau = T.posTau;
    const posed = (lead.ident || lead.level === 0) && lead.e && inp.poseOf && inp.poseOf(lead.e, pose);
    if (posed) { tx = pose.x; ty = pose.y; tau = T.posTauIdent; }
    if (g.fresh) { g.x = tx; g.y = ty; } else { g.x = follow(g.x, tx, dt, tau); g.y = follow(g.y, ty, dt, tau); }
    const Rt = Math.max(0, Bd.R[i]), Rv = Math.max(0, Bd.Rv[i]);
    g.R = g.fresh ? Rt : follow(g.R, Rt, dt, T.radTau);
    g.Rv = g.fresh ? Rv : follow(g.Rv, Rv, dt, T.radTau);
    g.est = Bd.est[i];
    g.nBig = Math.min(4, Bd.nSt[i]);
    g.nSmall = Math.min(12, Math.max(0, Bd.count[i] - Bd.nSt[i]));
    g.lvlTrue = Bd.lvl[i];
    g.myLvl = Bd.myLvl[i];
    g.strOK = g.myLvl >= 1 && Bd.count[i] > 0;
    g.meR = Bd.meR[i];
    glist.push(g);
  }
  // grupy, których obraz już nie ma: gasną (widoczności → 0), potem wypadają
  for (const g of V.groups.values()) {
    if (g.used === fr) continue;
    // obraz już jej nie ma (zniszczona, poza wiedzą): granice gasną bez przejścia (nie „wyszedłem z ich zasięgu”)
    g.lvlTrue = 0; g.lvl = 0; g.myLvl = 0; g.strOK = false; g.meR = 0;
    if (g.redA + g.grayA + g.reveal + g.det < 0.004 && g.cC.age > 2.8 && g.cV.age > 2.8) { V.groups.delete(g.id); continue; }
    glist.push(g);
  }
  let signal = 0, detBeam = 0, inBeamN = 0;
  for (let j = 0; j < glist.length; j++) {
    const g = glist[j];
    const dx = g.x - px, dy = g.y - py;
    g.d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    g.bearing = Math.atan2(dy, dx);
    g.me = g.meR > 0 ? g.meR / g.d : 0;
    const da = wrap(g.bearing - V.phi);
    g.da = da;
    g.m = Math.exp(-(da / T.beamSigma) * (da / T.beamSigma));
    const inBeam = V.on && g.strOK && Math.abs(da) < T.strHalf * 0.95 && g.m > 0.3;
    if (inBeam) inBeamN++;
    const prev = g.reveal;
    g.reveal = approach(g.reveal, inBeam ? 1 : 0, dt, 0.32, 0.22);
    if (prev < 0.06 && g.reveal >= 0.06) V.pluck = Math.min(1.4, V.pluck + 0.9);   // szarpnięcie przy wejściu w namiar
    const detOn = g.lvlTrue >= 1;
    const detPrev = g.det;
    g.det = approach(g.det, detOn && g.reveal > 0.05 ? 1 : 0, dt, 0.18, 0.3);
    if (detPrev < 0.1 && g.det >= 0.1) g.flashAge = 0;
    g.flashAge = Math.min(OFF, g.flashAge + dt);
    // granica: tempo zmiany promienia kontaktu (ciąg / cisza)
    if (dt > 0 && Number.isFinite(g.Rprev)) g.rate = approach(g.rate, (g.R - g.Rprev) / dt, dt, 0.08);
    g.Rprev = g.R;
    // dwa poziomy (prawda gry): przejście = zmiana poziomu; koło wzroku, gdy poziom 2 po którejś stronie
    const lvl = g.lvlTrue | 0;
    if (g.lvl < 0) g.lvl = lvl;
    else if (lvl !== g.lvl) {
      const ev = lvl === 2 || g.lvl === 2 ? g.cV : g.cC;
      ev.age = 0;
      ev.dir = lvl > g.lvl ? 1 : -1;
      ev.ang = Math.atan2(py - g.y, px - g.x);
      ev.R = ev === g.cV ? g.Rv : g.R;
      g.lvl = lvl;
    }
    g.cC.age = Math.min(OFF, g.cC.age + dt);
    g.cV.age = Math.min(OFF, g.cV.age + dt);
    g.gvis = Math.max(0, Math.min(1, (g.R - g.Rv) / T.grayMerge));
    // obustronnie: szara — gdy wykrywam ich albo oni mnie, czerwona — gdy identyfikuję ich albo oni mnie
    const seeRed = g.myLvl === 2 || g.lvl === 2;
    const seeGray = g.myLvl >= 1 || g.lvl >= 1;
    g.redA = fadeTo(g.redA, seeRed, g.fresh, dt);
    g.grayA = fadeTo(g.grayA, seeGray, g.fresh, dt);
    g.knownA = fadeTo(g.knownA, g.myLvl >= 1, g.fresh, dt);
    g.knownV = fadeTo(g.knownV, g.myLvl === 2, g.fresh, dt);
    g.fresh = false;
    if (V.on && g.strOK) signal += Math.min(1.4, g.me) * g.m;
    detBeam = Math.max(detBeam, g.det * g.reveal);
  }
  const sg = Math.min(1, signal);
  const ampT = 0.35 + 5.2 * sg * Math.sqrt(sg);
  V.amp = approach(V.amp, ampT, dt, 0.35, 0.5);
  V.pluck *= Math.exp(-dt / 0.38);
  V.harm = approach(V.harm, sg, dt, 0.4);
  V.tau += dt * (1 + 0.6 * V.harm * V.harm);
  if (V.tau > 6000) V.tau -= 6000;
  V.det = detBeam;
  V.stats.groups = glist.length;
  V.stats.inBeam = inBeamN;

  // ---------------------------------------------------------------- kontakty (obłok X-ów) i objawienie
  const clist = V._clist;
  clist.length = 0;
  if (P && show) {
    const list = P.knowList;
    for (let j = 0; j < list.length; j++) {
      const k = list[j];
      if (k.disc || !(k.level > 0)) continue;
      let c = V.contacts.get(k.id);
      if (!c) {
        c = makeContact(k.id);
        c.x = k.x; c.y = k.y; c.born = V.time; c.lvl = k.level; c.idP = k.level >= 2 ? 1 : 0;
        if (k.level >= 2) c.born = -1e9;   // pierwszy raz od razu identyfikowany — bez obłoku
        V.contacts.set(k.id, c);
      }
      c.used = fr;
      c.live = 1;
      c.lvl = k.level;
      c.err = Math.max(0, Number(k.err) || 0);
      c.cls = Math.max(0, Math.min(3, contactSizeClass(k.sigSeen)));
      const tau = c.idP > 0 && c.idP < 1 ? 0.12 : T.posTau;
      c.x = follow(c.x, k.x, dt, tau);
      c.y = follow(c.y, k.y, dt, tau);
    }
  }
  for (const c of V.contacts.values()) {
    if (c.used !== fr) { c.live = 0; c.lvl = 0; }
    // objawienie: w moim wzroku obłok zwija się w kadłub (mgła wojny go odsłania), utrata wzroku — odwrotnie
    if (c.live) c.idP = Math.max(0, Math.min(1, c.idP + (c.lvl >= 2 ? 1 : -1) * dt / T.idSec));
    const bornA = Math.max(0, Math.min(1, (V.time - c.born) / T.fadeIn));
    const target = c.live ? bornA * (1 - ss(0.3, 0.85, c.idP)) : 0;
    c.alpha = c.live ? target : approach(c.alpha, 0, dt, T.contactFade);
    if (!c.live && c.alpha < 0.004) { V.contacts.delete(c.id); continue; }
    if (c.alpha > 0.002) clist.push(c);
  }
  V.stats.contacts = clist.length;

  // ---------------------------------------------------------------- ciała niebieskie (błona)
  const blist = V._blist;
  blist.length = 0;
  const bodies = inp.bodies;
  if (bodies && show) {
    for (let j = 0; j < bodies.length; j++) {
      const b = bodies[j];
      if (!b || !(b.R > 0)) continue;
      let s = V.bodies.get(b.id);
      if (!s) {
        s = { id: b.id, seed: hash01(j + 1, 17, 3), kind: 0, bearing: 0, d: 1, c: 0, sigma: 0.3, rev: 0, revV: 0, used: -1 };
        V.bodies.set(b.id, s);
      }
      s.used = fr;
      s.kind = b.kind | 0;
      const dx = b.x - px, dy = b.y - py;
      s.d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      s.bearing = Math.atan2(dy, dx);
      s.c = Math.max(0, Math.min(1, 1 - Math.log10(s.d / (T.bodyNearKm * KM)) / T.bodyLogSpan));
      s.sigma = Math.max(0.13, Math.min(0.7, 0.13 + 1.8 * b.R / s.d));
      const delay = 0.12 + 0.1 * Math.log2(1 + s.d / (10 * KM));
      const tgt = V.on && V.onAge > delay ? 1 : 0;
      if (dt > 0) {
        s.revV += ((tgt - s.rev) * 70 - s.revV * 9) * dt;
        s.rev = Math.max(0, s.rev + s.revV * dt);
      } else if (!V.on) { s.rev = 0; s.revV = 0; }
      blist.push(s);
    }
    // najbliższe (największe c) pierwsze — do limitu bloku
    if (blist.length > CZUJNIKI_MAX.blona) {
      blist.sort((a, b) => b.c - a.c);
      blist.length = CZUJNIKI_MAX.blona;
    }
  }
  V.stats.bodies = blist.length;
  return V;
}

/** Pakowanie widoku do `out` (Float64Array, układ CZUJNIKI_IN). `inp` jak w kroku (px, py, shipLen, sig, alpha). */
export function packCzujkaView(V, out, inp) {
  const T = V.tune;
  const alpha = Math.max(0, Math.min(1, inp.alpha == null ? 1 : Number(inp.alpha) || 0));
  out[I.serial] = ++V.serial;
  out[I.time] = V.time;
  out[I.px] = inp.px; out[I.py] = inp.py;
  out[I.shipLen] = Math.max(1, Number(inp.shipLen) || 3000);
  out[I.sig] = Math.max(0.2, Math.min(2.5, Number(inp.sig) || 1));
  // czujka
  const vis = V.vis * alpha;
  const strOn = vis > 0.001;
  out[I.vis] = vis;
  out[I.phi] = V.phi;
  out[I.amp] = V.amp + 7 * V.pluck;
  out[I.tau] = V.tau;
  out[I.det] = V.det;
  out[I.harm] = Math.min(1, V.harm + 0.5 * V.pluck);
  out[I.onAge] = V.on ? V.onAge : -1;
  out[I.strunaOn] = strOn ? 1 : 0;
  let nS = 0;
  if (strOn) {
    const gl = V._glist;
    for (let j = 0; j < gl.length && nS < CZUJNIKI_MAX.struna; j++) {
      const g = gl[j];
      if (g.reveal < 0.002) continue;
      const o = I.strBase + I.strStride * nS;
      out[o] = g.da; out[o + 1] = g.nBig; out[o + 2] = Math.max(g.nBig ? 0 : 1, g.nSmall); out[o + 3] = g.reveal;
      out[o + 4] = g.det; out[o + 5] = g.est; out[o + 6] = g.seed; out[o + 7] = Math.max(0, 1 - g.flashAge / 0.6);
      nS++;
    }
  }
  out[I.nStr] = nS;
  let nB = 0;
  if (strOn) {
    const bl = V._blist;
    for (let j = 0; j < bl.length && nB < CZUJNIKI_MAX.blona; j++) {
      const b = bl[j];
      const o = I.blnBase + I.blnStride * nB;
      out[o] = b.bearing; out[o + 1] = b.c; out[o + 2] = b.sigma; out[o + 3] = b.rev; out[o + 4] = b.kind; out[o + 5] = b.seed;
      nB++;
    }
  }
  out[I.nBln] = nB;
  // granice (najbliższe granice najpierw — do limitu bloku)
  let nG = 0;
  const gl = V._glist;
  for (let j = 0; j < gl.length && nG < CZUJNIKI_MAX.granica; j++) {
    const g = gl[j];
    if (g.redA + g.grayA < 0.004 && g.cC.age >= 2.8 && g.cV.age >= 2.8) continue;
    const o = I.grnBase + I.grnStride * nG;
    out[o + G.cx] = g.x; out[o + G.cy] = g.y;
    out[o + G.R] = g.R; out[o + G.redA] = g.redA * alpha;
    out[o + G.ageC] = g.cC.age < 2.8 ? g.cC.age : -1; out[o + G.dirC] = g.cC.dir; out[o + G.angC] = g.cC.ang; out[o + G.RcX] = g.cC.R;
    out[o + G.est] = Math.max(g.est, 1 - g.knownV); out[o + G.rate] = g.rate;
    out[o + G.nearAng] = Math.atan2(inp.py - g.y, inp.px - g.x); out[o + G.Rv] = g.Rv;
    out[o + G.ageV] = g.cV.age < 2.8 ? g.cV.age : -1; out[o + G.dirV] = g.cV.dir; out[o + G.angV] = g.cV.ang;
    out[o + G.gray] = g.gvis * g.grayA * alpha;
    out[o + G.knownA] = g.knownA; out[o + G.knownV] = g.knownV; out[o + G.grayA] = g.grayA * alpha;
    out[o + G.winShift] = g.lvl >= 1 ? Math.max(0, Math.abs(g.d - g.R) - T.winNear) : 0;
    nG++;
  }
  out[I.nGrn] = nG;
  out[I.granicaOn] = nG > 0 && alpha > 0.002 ? 1 : 0;
  // kontakty
  let nK = 0;
  const cl = V._clist;
  for (let j = 0; j < cl.length && nK < CZUJNIKI_MAX.kontakty; j++) {
    const c = cl[j];
    const a = c.alpha * alpha;
    if (a < 0.002) continue;
    const o = I.konBase + I.konStride * nK;
    out[o + K.x] = c.x; out[o + K.y] = c.y;
    out[o + K.R] = T.sizeR[c.cls]; out[o + K.minPx] = T.sizeMinPx[c.cls];
    out[o + K.Rk] = 1 - 0.6 * ss(0, 0.75, c.idP);
    out[o + K.err] = c.err + 60;
    out[o + K.cls] = c.cls; out[o + K.mass] = T.sizeMass[c.cls]; out[o + K.seed] = c.seed; out[o + K.alpha] = a;
    nK++;
  }
  out[I.nKon] = nK;
  out[I.active] = (strOn || out[I.granicaOn] > 0.5 || nK > 0) ? 1 : 0;
  return out;
}

/** Rodzaj ciała dla błony z typu planety gry: 0 skalista, 1 gazowa, 2 lodowa / wodna, 3 gwiazda. */
export function czujkaBodyKind(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'star' || t === 'sun') return 3;
  if (t.includes('gas') || t.includes('giant')) return 1;
  if (t.includes('ice') || t.includes('ocean') || t.includes('water') || t === 'terran') return 2;
  return 0;
}
