// HUTA — formowanie, runda 8 „Struga — jasność”: WZÓR PÓL CIEPLEJSZYCH I CHŁODNIEJSZYCH NA STRUDZE (czysty JS, bez three).
//
// Materiał metalu (`pasmoTSL.js`) rysuje na cieczy wolne pola temperatury: dwa szumy wartości wzdłuż współrzędnej wzoru
// (v3.x stacji — na strudze z zegara wargi, `linia.js`: metal niesie wzór z prędkością metalu) i w przekroju. Ten moduł
// trzyma ich stałe (shader bierze je stąd — jedno źródło) i daje KOPIĘ wzoru na CPU (szum jak `noise3` / `hash33`
// z `wytop/wspolneTSL.js`, w float64 — statystycznie ten sam, nie bit w bit), żeby test i pomiar mogły policzyć, ile pól
// mieści się na widocznej strudze i jak zmienia się jej średnia jasność klatka po klatce. Funkcje pomiaru alokują
// (domknięcia) — tylko test i narzędzia, nie pętla klatki.
//
// PRZYCZYNA MIGANIA (zmierzona, runda 8): współrzędna wzoru płynie z zegara wargi 690 jedn./s, a struga za kołnierzem pola
// leci ~1 500–1 900 j./s; cały widoczny odcinek strugi (~440 j. drogi) to ~200 jedn. wzoru, a komórka szumu pól
// (34 / 0,24 = 142 jedn.) — 1,3 komórki: jedno pole zajmowało całą strugę i mijało wargę co ~0,2–0,3 s — cała struga
// ciemniała i jaśniała (średnia jasność 0,46…2,05 × średniej w pełnym spływie). Samo zagęszczenie nie wystarcza: przy
// N polach na strudze średnia waha się jak 1 / √N (×6 gęściej — wciąż ±20 %).
// POPRAWKA (dwie części, wzór ten sam — te same szumy, amplitudy i tempa w czasie):
//   1. `zoneK` — pola wzdłuż strugi gęstsze 4×: długość pola ~ średnica strugi (wiry termiczne strumienia mają rozmiar jego
//      średnicy), na widocznym odcinku 4–5 pól naraz; współrzędna bez zmian, więc pola płyną z prędkością metalu;
//   2. BILANS CIEPŁA ODCINKA — pola tylko PRZENOSZĄ ciepło wewnątrz widocznej strugi: od szumu pola w punkcie odejmujemy
//      jego średnią po WIDOCZNEJ powierzchni strugi (stacje od wargi do wejścia w błonę `sTop`, waga = rzut z góry
//      a · |t_x| · Δs) w tym samym miejscu przekroju. Średnia temperatura strugi = temperatura metalu z modelu linii, więc
//      jasność strugi jako całości idzie tylko za wypływem (przekrój) i temperaturą. Shader liczy tę średnią w etapie
//      wierzchołków (pętla po co `meanEvery`-tej stacji strugi z bufora stacji) — te same szumy co we fragmencie.
//   Reszta wahań (±5 % na klatkę 1/30 s, było ±23 %) to wypukłość mocy żaru (T^3,5): pola zimniejsze ściemniają mniej,
//   niż cieplejsze rozjaśniają, a ich rozrzut na odcinku się zmienia.
// POPRAWKI RUNDY 8 (krytyk: na PIKSELACH średnia jasność strugi skakała o 6 % na klatkę 1/30 s, ciemne pole długości 1/3
// strugi co ~0,2 s): pola strugi ×6 zamiast ×4 (krótsze, 6–7 na widocznym odcinku) i kontrast pól na strudze × 2/3
// (`jetA`) — z polami krótszymi niż struga pełna amplituda dawała łaty o kontraście mocy żaru ~7×; wynik na pikselach
// z góry: 2,7–2,9 % na klatkę na całej strudze (było 3,5), 4,2 % w wycinku krytyka (było 6). A/B `?strugaWzor=2`.
// Komórki konwekcji, zmarszczki, połysk oraz wzór błony i pasma — bez zmian.

/** Stałe wolnych pól temperatury cieczy (wspólne z `pasmoTSL.js`). */
export const STRUGA_WZOR = Object.freeze({
  /** gęstość komórek wzoru [1/j.] (`look.y` materiału) */
  look: 1 / 34,
  /** pole wolne 1 i 2: skala współrzędnych, amplituda w T̃, tempo dryfu w czasie (oś y / x szumu) */
  slowF: 0.24, slowA: 0.7, slowT: 0.045,
  slow2F: 0.5, slow2A: 0.26, slow2T: 0.035,
  /** STRUGA: zagęszczenie pól wzdłuż strugi (tylko struga; błona i pasmo bez zmian). Poprawki rundy 8: 4 → 6 (pola
   *  krótsze — 6–7 na widocznym odcinku); `zoneK8` — wartość etapu „Struga — jasność” (A/B `?strugaWzor=2`) */
  zoneK: 6, zoneK8: 4,
  /** STRUGA (poprawki rundy 8): kontrast pól na strudze × 2/3 — z gęstszymi polami i bilansem ciepła odcinka pełna
   *  amplituda dawała ciemne łaty o kontraście mocy żaru ~7× (T^3,5), które na pikselach zmieniały średnią jasność strugi
   *  o ~6 % na klatkę 1/30 s; błona i pasmo bez zmian (A/B `?strugaWzor=2` — pełna amplituda) */
  jetA: 2 / 3,
  /** STRUGA: średnia pól po widocznym odcinku — co która stacja strugi (stacje co 3 j. drogi → próbka co 9 j.) */
  meanEvery: 3
});

const fract = (x) => x - Math.floor(x);
// hash33(p).x jak w `wspolneTSL.js`
function hash33x(px, py, pz) {
  let qx = fract(px * 0.1031);
  let qy = fract(py * 0.1030);
  let qz = fract(pz * 0.0973);
  const d = qx * (qy + 33.33) + qy * (qx + 33.33) + qz * (qz + 33.33);
  qx += d; qy += d; qz += d;
  return fract((qx + qy) * qz);
}
/** Gładki szum wartości 3D (0…1) — kopia `noise3` z `wspolneTSL.js`. */
export function noise3(x, y, z) {
  const ix = Math.floor(x); const iy = Math.floor(y); const iz = Math.floor(z);
  const fx = x - ix; const fy = y - iy; const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx); const uy = fy * fy * (3 - 2 * fy); const uz = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => hash33x(ix + a, iy + b, iz + c);
  const l = (a, b, t) => a + (b - a) * t;
  const x00 = l(h(0, 0, 0), h(1, 0, 0), ux);
  const x10 = l(h(0, 1, 0), h(1, 1, 0), ux);
  const x01 = l(h(0, 0, 1), h(1, 0, 1), ux);
  const x11 = l(h(0, 1, 1), h(1, 1, 1), ux);
  return l(l(x00, x10, uy), l(x01, x11, uy), uz);
}
/**
 * Szumy pól w punkcie: `pc` — współrzędna wzoru (v3.x stacji), `lat`, `up` — punkt przekroju względem osi [j.], `twist` —
 * skręt strugi [rad], `time` — czas linii [s], `k` — zagęszczenie wzdłuż. Zwraca do `o`: [0] szum 1, [1] szum 2 (0…1).
 */
export function jetZoneNoise(pc, lat, up, twist, time, k, o) {
  const W = STRUGA_WZOR;
  const ang = Math.atan2(up, lat) + twist;
  const rad = Math.sqrt(lat * lat + up * up);
  const qx = pc * W.look * k;
  const qy = Math.cos(ang) * rad * W.look;
  const qz = Math.sin(ang) * rad * W.look;
  o[0] = noise3(qx * W.slowF, qy * W.slowF + time * W.slowT, qz * W.slowF + 5);
  o[1] = noise3(qx * W.slow2F + time * W.slow2T, qy * W.slow2F + 7.3, qz * W.slow2F);
  return o;
}
const NZ = new Float64Array(2);
/**
 * Odchyłka T̃ cieczy strugi od pól wolnych (człon `tzone` materiału dla strugi). `mean` — [śr. 1, śr. 2] z `jetAreaMean`
 * (bilans ciepła odcinka) albo null — szum względem 0,5 (stary wzór).
 */
const NZ2 = new Float64Array(2);
export function jetZoneT(pc, lat, up, twist, time, k = STRUGA_WZOR.zoneK, mean = null, amp = mean ? STRUGA_WZOR.jetA : 1) {
  const W = STRUGA_WZOR;
  jetZoneNoise(pc, lat, up, twist, time, k, NZ2);
  const m1 = mean ? mean[0] : 0.5;
  const m2 = mean ? mean[1] : 0.5;
  return ((NZ2[0] - m1) * W.slowA + (NZ2[1] - m2) * W.slow2A) * amp;
}
/**
 * Średnia szumów pól po WIDOCZNEJ powierzchni strugi (waga stacji = rzut z góry a · Δs · |t_x|, co `every` stacji) w tym samym
 * miejscu przekroju (`lat`, `up`; skręt stacji). Zwraca do `o`.
 */
export function jetAreaMean(out, i0, n, stride, sTop, lat, up, time, k, o, every = STRUGA_WZOR.meanEvery) {
  let sw = 0; let s1 = 0; let s2 = 0;
  for (let q = i0; q < i0 + n; q += every) {
    const r = q * stride;
    if (!(out[r + 4] > 0.05) || out[r + 3] > sTop) continue;
    const w = out[r + 4] * Math.max(0.05, Math.abs(out[r + 16]));
    jetZoneNoise(out[r + 12], lat, up, out[r + 15], time, k, NZ);
    sw += w; s1 += w * NZ[0]; s2 += w * NZ[1];
  }
  o[0] = sw > 0 ? s1 / sw : 0.5;
  o[1] = sw > 0 ? s2 / sw : 0.5;
  return o;
}
/** Moc żaru `heatPower` z `wspolneTSL.js`. */
export function heatPowerCpu(T) {
  const t = T < 0 ? 0 : T > 1.5 ? 1.5 : T;
  const e = Math.min(1, Math.max(0, (t - 0.12) / 0.24));
  return (Math.pow(t, 3.5) * 0.97 + 0.03) * e * e * (3 - 2 * e);
}

/** Kąty próbek górnej połowy przekroju (widok z góry): punkt (a · cos φ, b · sin φ). */
const PHI = [Math.PI / 6, Math.PI / 3, Math.PI / 2, 2 * Math.PI / 3, 5 * Math.PI / 6];
const PHC = PHI.map(Math.cos);
const PHS = PHI.map(Math.sin);
/**
 * Jasność WIDOCZNEGO odcinka strugi z góry (pomiar i test): stacje strugi z rekordu (`stride` float na
 * stację, od `i0`, `n` stacji) z metalem nad wejściem w błonę (`sTop` — s wejścia), waga = rzut na poziom (a · Δs · |t_x|),
 * jasność = moc żaru `heatPower(T̃ · (1 + pola))` uśredniona po górnej połowie przekroju. Zwraca do `res`:
 * [0] średnia jasność, [1] liczba pól wzdłuż osi (zmiany znaku odchyłki na grzbiecie strugi + 1, co 1 j. drogi),
 * [2] długość widocznego odcinka [j. drogi], [3] liczba komórek szumu pola 1 na odcinku. `balance` — z bilansem ciepła
 * odcinka (średnia pól po widocznym odcinku odjęta, jak shader); false — stary wzór (szum względem 0,5).
 */
export function jetVisibleStats(out, i0, n, stride, sTop, time, k, res, balance = true, amp = balance ? STRUGA_WZOR.jetA : 1) {
  const W = STRUGA_WZOR;
  let sw = 0; let sb = 0; let sMin = 1e9; let sMax = -1e9; let pMin = 1e9; let pMax = -1e9;
  const MN = [0.5, 0.5];
  for (let q = i0; q < i0 + n; q++) {
    const r = q * stride;
    const a = out[r + 4];
    const s = out[r + 3];
    if (!(a > 0.05) || s > sTop) continue;
    const b = out[r + 5];
    const pc = out[r + 12];
    const tw = out[r + 15];
    const T = out[r + 9];
    let hb = 0;
    for (let j = 0; j < PHI.length; j++) {
      const lat = a * PHC[j];
      const up = b * PHS[j];
      if (balance) jetAreaMean(out, i0, n, stride, sTop, lat, up, time, k, MN);
      hb += heatPowerCpu(T * (1 + jetZoneT(pc, lat, up, tw, time, k, balance ? MN : null, amp)));
    }
    const w = a * 3 * Math.max(0.05, Math.abs(out[r + 16]));
    sw += w; sb += w * hb / PHI.length;
    if (s < sMin) sMin = s;
    if (s > sMax) sMax = s;
    if (pc < pMin) pMin = pc;
    if (pc > pMax) pMax = pc;
  }
  res[0] = sw > 0 ? sb / sw : 0;
  res[2] = sMax > sMin ? sMax - sMin : 0;
  res[3] = pMax > pMin ? (pMax - pMin) * W.look * k * W.slowF : 0;
  // pola wzdłuż grzbietu (punkt φ = 90°): liniowo między stacjami
  let fields = 0; let prev = 0;
  let qPrev = -1;
  for (let q = i0; q < i0 + n; q++) {
    const r = q * stride;
    if (!(out[r + 4] > 0.05) || out[r + 3] > sTop) continue;
    if (qPrev >= 0) {
      const r0 = qPrev * stride;
      if (balance) jetAreaMean(out, i0, n, stride, sTop, 0, 0.5 * (out[r0 + 5] + out[r + 5]), time, k, MN);
      const steps = Math.max(1, Math.round(out[r + 3] - out[r0 + 3]));
      for (let m = 1; m <= steps; m++) {
        const f = m / steps;
        const pc = out[r0 + 12] + (out[r + 12] - out[r0 + 12]) * f;
        const bb = out[r0 + 5] + (out[r + 5] - out[r0 + 5]) * f;
        const tw = out[r0 + 15] + (out[r + 15] - out[r0 + 15]) * f;
        const z = jetZoneT(pc, 0, bb, tw, time, k, balance ? MN : null, amp);
        if (z !== 0 && prev !== 0 && (z > 0) !== (prev > 0)) fields++;
        if (z !== 0) prev = z;
      }
    } else {
      if (balance) jetAreaMean(out, i0, n, stride, sTop, 0, out[r + 5], time, k, MN);
      prev = jetZoneT(out[r + 12], 0, out[r + 5], out[r + 15], time, k, balance ? MN : null, amp);
    }
    qPrev = q;
  }
  res[1] = qPrev >= 0 ? fields + 1 : 0;
  return res;
}
