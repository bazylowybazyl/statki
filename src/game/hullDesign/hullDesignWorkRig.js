// src/game/hullDesign/hullDesignWorkRig.js
//
// KREATOR KADŁUBÓW — OSPRZĘT STATKU ROBOCZEGO DLA GRY (kontrakt złomowania; czysty: bez three i DOM; testy
// tests/hullDesignWorkships.test.mjs). Gra opisuje osprzęt kadłuba w UŁAMKACH DŁUGOŚCI kadłuba L: początek w środku
// kadłuba (środek pudła sylwetki), x — dziób, y — prawa burta (w kreatorze y > 0). Ten sam układ ma zestaw złomiarza
// NPC w grze (paszcza `maw` [0,455; 0], `mawR` 0,065, dziób `front` 0,5, podstawy wysięgników `mounts` [0,33; ∓0,105]).
//
// Tabela liczy się z POZYCJI MODUŁÓW projektu (rozwiniętych — kopie lustra osobno), nie z ręcznych liczb — przesunięcie
// gniazda w edytorze zmienia kontrakt. Pola (tylko te, które statek ma):
//
//   L          długość kadłuba [j.] (do przeliczenia ułamków), `W` — szerokość w ułamku L
//   front      dziób: x najdalszego punktu sylwetki (zawsze 0,5 — początek jest w środku długości)
//   maw, mawR  paszcza (`maw`): środek [x, y] i zasięg szczęk (pół-szerokość w poprzek osi modułu); `mawLen` — długość
//   mounts     obrotnice WYSIĘGNIKÓW z laserami (`rig` v 0): [[x, y], …], `mountR` — promień największej podstawy
//   cranes     obrotnice DŹWIGÓW (`rig` v 1): [[x, y], …], `craneR`
//   hold       ładownia główna (największy moduł `cargo`): środek [x, y]; `holdSize` [wzdłuż, w poprzek]; `holdTop` —
//              true, gdy ładuje się ją OD GÓRY (kosz v 4 albo stelaż / zasobniki), false — wrota / klapa (wnętrze:
//              paszczą albo rampą); `holds` — wszystkie ładownie [[x, y, wzdłuż, w poprzek], …], gdy jest ich więcej
//   ramp       rampa (`ramp`): środek klapy [x, y]; `rampSize` [wzdłuż, w poprzek], `rampDir` — kierunek opadania
//              (wektor jednostkowy: rampa rufowa [−1, 0])
//   mill       gardziel młyna (`mill`): środek [x, y]; `millSize` [wzdłuż, w poprzek], `millRolls` — walców
//   dampers    gniazda damperów (`damper`): [[x, y], …]; `damperDir` — kierunki wysuwu [[dx, dy], …]
//   ports      złącza przeładunku (pierścienie `well` v 0): [[x, y], …]
//
// Listy są posortowane: od dziobu, przy tym samym x — lewa burta (y < 0) pierwsza.

import { sampleHullField } from './hullDesignGeometry.js';

const r4 = (v) => { const q = Math.round(v * 1e4) / 1e4; return q === 0 ? 0 : q; };   // bez −0
const byBowThenPort = (a, b) => (b[0] - a[0]) || (a[1] - b[1]);

/** Pełne wymiary modułu prostokątnego w osiach OKRĘTU [j.] (obrót co 90° zamienia boki; inne obroty — pudło). */
function alongAcross(m) {
  const c = Math.abs(Math.cos(m.rot || 0)), s = Math.abs(Math.sin(m.rot || 0));
  return [2 * (m.w * c + m.h * s), 2 * (m.w * s + m.h * c)];
}

/**
 * Pudło SYLWETKI kadłuba [j.] dokładniej niż `field.bounds` (to pudło komórek siatki pola z zapasem teksela): przejście
 * pola ramy przez zero szukane bisekcją w pasie przy każdej krawędzi pudła siatki. Zwraca { minX, maxX, minY, maxY }.
 */
export function hullSilhouetteBox(field, samples = 240) {
  const b = field.bounds, inv = 1 / field.grid.res;
  const d = (x, y) => sampleHullField(field, 0, x, y);
  // skrajny punkt wzdłuż osi `ax` ('x' | 'y') w kierunku `dir` (±1)
  const edge = (ax, dir) => {
    const far = ax === 'x' ? (dir > 0 ? b.maxX : b.minX) : (dir > 0 ? b.maxY : b.minY);
    const t0 = ax === 'x' ? b.minY : b.minX, t1 = ax === 'x' ? b.maxY : b.maxX;
    const at = (v, t) => (ax === 'x' ? d(v, t) : d(t, v));
    let best = far - dir * 3 * inv;
    for (let k = 0; k <= samples; k++) {
      const t = t0 + (t1 - t0) * k / samples;
      let lo = far - dir * 3 * inv, hi = far + dir * inv;        // lo — wewnątrz, hi — na zewnątrz
      if (at(lo, t) > 0 || at(hi, t) <= 0) continue;
      for (let i = 0; i < 14; i++) { const mid = (lo + hi) * 0.5; if (at(mid, t) <= 0) lo = mid; else hi = mid; }
      if ((lo - best) * dir > 0) best = lo;
    }
    return best;
  };
  return { minX: edge('x', -1), maxX: edge('x', 1), minY: edge('y', -1), maxY: edge('y', 1) };
}

/**
 * Osprzęt roboczy projektu. `field` — buildHullField(projekt) (sylwetka `bounds`, moduły rozwinięte). Zwraca obiekt
 * z polami opisanymi w nagłówku (ułamki L, 4 miejsca po przecinku) albo sam { L, W, front }, gdy projekt nie ma
 * żadnego osprzętu roboczego. `hasWorkRig(rig)` — czy ma.
 */
export function hullDesignWorkRig(field) {
  const b = hullSilhouetteBox(field);
  // oś okrętu z lustrem to y = 0 projektu (pudło sylwetki z siatki pola bywa o ułamek teksela niesymetryczne)
  const L = b.maxX - b.minX, cx = (b.minX + b.maxX) * 0.5, cy = field.expanded.design.mirror ? 0 : (b.minY + b.maxY) * 0.5;
  const fx = (x) => r4((x - cx) / L), fy = (y) => r4((y - cy) / L), fl = (v) => r4(v / L);
  const pt = (m) => [fx(m.x), fy(m.y)];
  const dir = (m) => [r4(Math.cos(m.rot || 0)), r4(Math.sin(m.rot || 0))];
  const mods = field.expanded.modules;
  const of = (type, pred = null) => mods.filter((m) => m.type === type && (!pred || pred(m)));
  const out = { L: Math.round(L * 100) / 100, W: fl(b.maxY - b.minY), front: fx(b.maxX) };

  const maws = of('maw');
  if (maws.length) {
    // paszcza główna: największa (zwykle jedna, na osi)
    const m = maws.reduce((a, q) => (q.w * q.h > a.w * a.h ? q : a));
    const [len, wid] = alongAcross(m);
    out.maw = pt(m); out.mawR = fl(wid / 2); out.mawLen = fl(len);
  }
  const booms = of('rig', (m) => (m.v || 0) === 0), cranes = of('rig', (m) => m.v === 1);
  if (booms.length) { out.mounts = booms.map(pt).sort(byBowThenPort); out.mountR = fl(Math.max(...booms.map((m) => m.r))); }
  if (cranes.length) { out.cranes = cranes.map(pt).sort(byBowThenPort); out.craneR = fl(Math.max(...cranes.map((m) => m.r))); }

  const holds = of('cargo');
  if (holds.length) {
    const m = holds.reduce((a, q) => (q.w * q.h > a.w * a.h ? q : a));
    out.hold = pt(m); out.holdSize = alongAcross(m).map(fl); out.holdTop = (m.v || 0) >= 2;
    if (holds.length > 1) out.holds = holds.map((q) => [...pt(q), ...alongAcross(q).map(fl)]).sort(byBowThenPort);
  }
  const ramps = of('ramp');
  if (ramps.length) {
    const m = ramps.reduce((a, q) => (q.w * q.h > a.w * a.h ? q : a));
    out.ramp = pt(m); out.rampSize = alongAcross(m).map(fl); out.rampDir = dir(m);
  }
  const mills = of('mill');
  if (mills.length) {
    const m = mills.reduce((a, q) => (q.w * q.h > a.w * a.h ? q : a));
    out.mill = pt(m); out.millSize = alongAcross(m).map(fl); out.millRolls = m.n || 2;
  }
  const dampers = of('damper');
  if (dampers.length) {
    const list = dampers.map((m) => ({ p: pt(m), d: dir(m) })).sort((a, q) => byBowThenPort(a.p, q.p));
    out.dampers = list.map((q) => q.p); out.damperDir = list.map((q) => q.d);
  }
  const ports = of('well', (m) => (m.v || 0) === 0);
  if (ports.length) out.ports = ports.map(pt).sort(byBowThenPort);
  return out;
}

/** Pola osprzętu roboczego (bez wymiarów kadłuba) — kolejność w tabelach dokumentacji i testów. */
export const HD_WORK_RIG_FIELDS = Object.freeze(['maw', 'mounts', 'cranes', 'hold', 'ramp', 'mill', 'dampers', 'ports']);
/** Czy tabela ma osprzęt roboczy (cokolwiek poza wymiarami kadłuba). */
export const hasWorkRig = (rig) => ['maw', 'mounts', 'cranes', 'ramp', 'mill', 'dampers'].some((k) => rig?.[k]);
