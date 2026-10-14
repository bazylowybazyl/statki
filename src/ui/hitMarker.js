// src/ui/hitMarker.js
//
// ZNACZNIK TRAFIENIA na celowniku gracza (2026-10-13, prośba użytkownika — „feel strzelania”; wzór FPS /
// World of Warships). Przy dalekich strzałach (6–7 km) trafienie bywa poza kadrem albo malutkie — cztery
// krótkie skośne kreski wokół krzyża celownika potwierdzają, że ogień gracza doszedł:
//   • TARCZA — błękitne, na zewnątrz (pole przyjęło trafienie),
//   • KADŁUB — ciepła biel (obrażenia w pancerz),
//   • ZNISZCZENIE — czerwone, dłuższe, rozchodzą się i gasną wolniej.
// Siła rośnie z obrażeniami i serią trafień (grubość, długość), gaśnie w ~0,25 s (zniszczenie ~0,6 s).
// Czysty canvas 2D: stan to mały obiekt, rysowanie bez alokacji. Zegar podaje wołający (sekundy).

export const HIT_MARK = Object.freeze({ SHIELD: 0, HULL: 1, KILL: 2 });

export const HIT_MARKER_TUNE = {
  life: [0.24, 0.26, 0.6],          // [s] czas gaśnięcia: tarcza, kadłub, zniszczenie
  color: ['#7fd8ff', '#ffe6c2', '#ff4d5e'],
  r0: [9, 6, 7],                    // [px przy skali 1] początek kreski od środka krzyża
  len: [5, 6, 10],                  // [px] długość kreski przy sile 1
  pop: [3, 3, 7],                   // [px] wysunięcie na starcie (kreski dojeżdżają do r0)
  width: [1.6, 2.0, 2.4],           // [px] grubość przy sile 1
  dmgRef: 300,                      // obrażenia trafienia dające siłę 1 (mniejsze — od minStrength)
  minStrength: 0.45,
  maxStrength: 1.6                  // seria trafień sumuje się do tego sufitu
};

export function createHitMarker() {
  return { t: [-1e9, -1e9, -1e9], amt: [0, 0, 0] };
}

/** Siła pojedynczego trafienia z obrażeń. */
export function hitStrength(damage) {
  const T = HIT_MARKER_TUNE;
  const s = (Number(damage) || 0) / T.dmgRef;
  return Math.max(T.minStrength, Math.min(1, s));
}

/** Zapisuje trafienie rodzaju `kind` (HIT_MARK) w chwili `now` [s] z siłą `strength`. */
export function noteHitMarker(m, kind, now, strength = 1) {
  const T = HIT_MARKER_TUNE;
  const life = T.life[kind];
  const left = Math.max(0, 1 - (now - m.t[kind]) / life);
  m.amt[kind] = Math.min(T.maxStrength, m.amt[kind] * left + strength);
  m.t[kind] = now;
}

/** Czy cokolwiek jeszcze świeci (wołający może pominąć rysowanie). */
export function hitMarkerActive(m, now) {
  const T = HIT_MARKER_TUNE;
  for (let k = 0; k < 3; k++) if (now - m.t[k] < T.life[k]) return true;
  return false;
}

/** Cztery skośne kreski wokół (x, y). Zwraca liczbę narysowanych rodzajów. */
export function drawHitMarker(ctx, x, y, m, now, scale = 1) {
  const T = HIT_MARKER_TUNE;
  let drawn = 0;
  for (let k = 0; k < 3; k++) {
    const age = now - m.t[k];
    const life = T.life[k];
    if (!(age >= 0 && age < life)) continue;
    const u = age / life;                       // 0 → 1
    const a = (1 - u) * (1 - u);                // szybki zanik
    const amt = Math.max(T.minStrength, m.amt[k]);
    const grow = Math.sqrt(amt);
    // trafienie: kreski dojeżdżają z zewnątrz do r0; zniszczenie: rozchodzą się od r0
    const pop = k === HIT_MARK.KILL ? T.pop[k] * u : T.pop[k] * (1 - u) * (1 - u);
    const r0 = (T.r0[k] + pop) * scale;
    const r1 = r0 + T.len[k] * grow * scale;
    if (!drawn) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 3;
    }
    drawn++;
    ctx.globalAlpha = Math.min(1, a * (0.55 + 0.45 * grow));
    ctx.strokeStyle = T.color[k];
    ctx.lineWidth = T.width[k] * Math.min(1.5, grow) * scale;
    ctx.beginPath();
    for (let q = 0; q < 4; q++) {
      const dx = (q & 1) ? 0.7071 : -0.7071;
      const dy = (q & 2) ? 0.7071 : -0.7071;
      ctx.moveTo(x + dx * r0, y + dy * r0);
      ctx.lineTo(x + dx * r1, y + dy * r1);
    }
    ctx.stroke();
  }
  if (drawn) ctx.restore();
  return drawn;
}
