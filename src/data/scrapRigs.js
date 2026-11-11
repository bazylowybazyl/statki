// src/data/scrapRigs.js — osprzęt złomiarski kadłubów (reguła `zlomowanie`): gdzie stoją wysięgniki z laserami tnącymi,
// gdzie jest paszcza (punkt mielenia sekcji) i zaczepy wiązek trzymających wrak. Wymiary to UŁAMKI DŁUGOŚCI kadłuba
// (oś x — dziób, y — prawa burta w układzie statku: świat = środek + obrót o kurs), więc ten sam zestaw pasuje do
// kadłuba innej wielkości. Czysty moduł danych z kinematyką ramienia — czyta go gra (`src/game/scrapProcess.js`)
// i obraz (`src/3d/trafficWork3D.js`), jak `swarmArmPose` w `swarmDrones.js`.

/**
 * Zestaw domyślny (sprite złomiarza `salvage_hauler`: paszcza z zębami na dziobie, ładownia na śródokręciu).
 *   maw      — punkt mielenia: tu sekcja znika w kadłubie; `mawR` — zasięg zębów wokół niego,
 *   front    — dziób: przed nim (o `gap`) staje bliski koniec wraku,
 *   mounts   — podstawy dwóch wysięgników (lewy y < 0, prawy y > 0),
 *   stow     — głowice w spoczynku: tuż przy podstawie, lekko na zewnątrz — ramię składa się wtedy łokciem
 *              DO TYŁU, wzdłuż burty (scyzoryk), nie sterczy w bok,
 *   grapples — emitery wiązek trzymających wrak,
 *   section  — długość odcinanej sekcji,
 *   segMin / segMax — długość członu wysięgnika (dwa człony; wysuwany — dobierany do szerokości wraku).
 */
export const SCRAP_RIG_DEFAULT = Object.freeze({
  maw: Object.freeze([0.455, 0]),
  mawR: 0.065,
  front: 0.5,
  gap: 0.085,
  mounts: Object.freeze([Object.freeze([0.33, -0.105]), Object.freeze([0.33, 0.105])]),
  stow: Object.freeze([Object.freeze([0.345, -0.165]), Object.freeze([0.345, 0.165])]),
  grapples: Object.freeze([Object.freeze([0.44, -0.07]), Object.freeze([0.44, 0.07])]),
  section: 0.3,
  segMin: 0.22,
  segMax: 0.62
});

/** Zestawy kadłubów (id kadłuba ruchu → zestaw); kadłub spoza tabeli — domyślny. */
export const SCRAP_RIGS = Object.freeze({
  salvage_hauler: SCRAP_RIG_DEFAULT
});

export function scrapRigFor(hullId) {
  return SCRAP_RIGS[String(hullId || '')] || SCRAP_RIG_DEFAULT;
}

/**
 * Łokieć ramienia z dwóch równych członów `seg` między podstawą (mx, my) a głowicą (hx, hy) — układ statku.
 * `side` (±1) — strona zgięcia: łokieć odchodzi od osi statku (lewy wysięgnik w lewo, prawy w prawo), a przy głowicy
 * dokładnie w bok od podstawy — do tyłu (złożone ramię leży wzdłuż burty; przejście między pozami jest ciągłe).
 * Głowica dalej niż 2 · seg — ramię proste (łokieć w połowie). Wynik w `out` { x, y }.
 */
export function scrapArmElbow(mx, my, hx, hy, seg, side, out) {
  const dx = hx - mx;
  const dy = hy - my;
  const d = Math.sqrt(dx * dx + dy * dy);
  const cx = (mx + hx) * 0.5;
  const cy = (my + hy) * 0.5;
  if (!(d > 1e-6) || !(seg > 0)) { out.x = cx; out.y = cy; return out; }
  const h2 = seg * seg - d * d * 0.25;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  // Prostopadła do osi podstawa → głowica; zwrot: składowa y po stronie `side`.
  let px = -dy / d;
  let py = dx / d;
  if (py * side < 0 || (py === 0 && px > 0)) { px = -px; py = -py; }
  out.x = cx + px * h;
  out.y = cy + py * h;
  return out;
}

/** Długość członu wysięgnika [j.] dla zasięgu `reach` [j.] i kadłuba długości `length` [j.]. */
export function scrapArmSegment(rig, length, reach) {
  const lo = rig.segMin * length;
  const hi = rig.segMax * length;
  const want = reach * 0.56;
  return want < lo ? lo : want > hi ? hi : want;
}
