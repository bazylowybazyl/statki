// src/game/barrage.js
//
// SALWA ROZSTAWIONA (broń z polem `barrage` — Supernova Barrage, 2026-10-05): rakiety
// jednej salwy rozchodzą się na GRUPĘ wroga zamiast lecieć wszystkie w ten sam punkt.
// Czysta logika (bez three / DOM) — gra podaje kandydatów i pozycje, wynik idzie do
// rocketSystem3D.planNextSalvo (cel per rakieta).
//
// Reguły:
//   1. Pierwsza rakieta — cel salwy (namiar gracza) albo punkt (kursor).
//   2. Kolejne — wrogowie w promieniu `radius` od środka salwy, wybierani zachłannie
//      NAJDALEJ od już wybranych punktów wybuchu; wróg bliżej niż `spacing` od wybranego
//      punktu i tak stoi w jego fali — pomijany (bez nakładania wybuchów).
//   3. Wrogów za mało — reszta rakiet w wybranych wrogów o największej potrzebie
//      (tarcza + kadłub), po kolei; bez żadnego wroga (salwa w punkt) — punkty na
//      okręgu `spacing` wokół punktu celu.

/**
 * @param {object} o
 * @param {number} o.count            rakiet w salwie
 * @param {object|null} o.primary     cel salwy (encja) — null, gdy salwa w punkt
 * @param {number} o.cx, o.cy         środek salwy (pozycja celu albo punktu)
 * @param {Array} o.candidates        encje wroga (już przefiltrowane przez grę)
 * @param {number} o.radius           promień szukania grupy [j.]
 * @param {number} o.spacing          najmniejszy odstęp punktów wybuchu [j.]
 * @param {(e) => number} o.getX, o.getY
 * @param {(e) => number} [o.need]    „ile trzeba zadać” (domyślnie tarcza + kadłub)
 * @param {object|null} [o.point]     cel-punkt salwy (gdy brak `primary`)
 * @returns {Array} cele per rakieta (długość = count)
 */
export function planBarrageTargets(o) {
  const count = Math.max(1, Math.round(Number(o.count) || 1));
  const out = new Array(count).fill(null);
  const getX = o.getX;
  const getY = o.getY;
  const need = o.need || defaultNeed;
  const radius = Math.max(0, Number(o.radius) || 0);
  const spacing = Math.max(0, Number(o.spacing) || 0);
  const cx = Number(o.cx) || 0;
  const cy = Number(o.cy) || 0;
  const primary = o.primary || null;

  // Punkty wybuchu już wybrane (x, y) i encje (do dobierania reszty).
  const px = [];
  const py = [];
  const picked = [];
  if (primary) {
    out[0] = primary;
    px.push(getX(primary)); py.push(getY(primary)); picked.push(primary);
  } else {
    out[0] = o.point || null;
    px.push(cx); py.push(cy);
  }
  if (count === 1) return out;

  // Kandydaci w promieniu grupy.
  const pool = [];
  const r2 = radius * radius;
  const list = o.candidates || [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || e === primary) continue;
    const dx = getX(e) - cx;
    const dy = getY(e) - cy;
    if (dx * dx + dy * dy <= r2) pool.push(e);
  }

  const sp2 = spacing * spacing;
  let k = 1;
  while (k < count && pool.length) {
    // Zachłannie: kandydat najdalej od najbliższego wybranego punktu.
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < pool.length; i++) {
      const ex = getX(pool[i]);
      const ey = getY(pool[i]);
      let dmin = Infinity;
      for (let j = 0; j < px.length; j++) {
        const dx = ex - px[j];
        const dy = ey - py[j];
        const d = dx * dx + dy * dy;
        if (d < dmin) dmin = d;
      }
      if (dmin > bestD) { bestD = dmin; best = i; }
    }
    if (best < 0 || bestD < sp2) break;      // reszta grupy już w zasięgu wybranych wybuchów
    const e = pool[best];
    pool[best] = pool[pool.length - 1];
    pool.pop();
    out[k++] = e;
    px.push(getX(e)); py.push(getY(e)); picked.push(e);
  }
  if (k >= count) return out;

  if (picked.length) {
    // Dobieranie: najwięcej do zadania pierwsze (cel salwy przy remisie — pierwszy na liście).
    const order = picked.slice().sort((a, b) => need(b) - need(a));
    for (let i = 0; k < count; i++) out[k++] = order[i % order.length];
    return out;
  }
  // Salwa w punkt bez wroga w pobliżu: okrąg wokół punktu (rozkład równy, obrót losowy salwy z punktu).
  const n = count - k;
  const a0 = Math.atan2(cy, cx) * 7.3;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    out[k++] = { x: cx + Math.cos(a) * spacing, y: cy + Math.sin(a) * spacing, dead: false, _isPositionTarget: true };
  }
  return out;
}

function defaultNeed(e) {
  return (Number(e?.shield?.val) || 0) + (Number(e?.hp) || 0);
}
