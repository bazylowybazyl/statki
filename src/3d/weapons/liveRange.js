// src/3d/weapons/liveRange.js
//
// Zakresy wysyłki atrybutów bez alokacji na klatkę (PLAN §3, pułapka z zadania 12):
// three czyści `updateRanges` po każdej wysyłce (`clearUpdateRanges` → length = 0), a
// ponowne `addUpdateRange` alokuje obiekt zakresu (~150 B na atrybut na klatkę). Tu atrybut
// dostaje NA STAŁE listę dwóch obiektów zakresu (drugi — pierścień zawinięty w tej klatce)
// i wyłączone czyszczenie; klatka przestawia tylko liczby. Nieużywany drugi zakres to 4
// pierwsze liczby tablicy (16 B powtórzonej wysyłki — tablica CPU jest źródłem prawdy),
// bez zmiany długości listy (żadnej realokacji tablicy zakresów).

function keepUpdateRanges() {}

/** Przygotowuje atrybut (raz). Zwraca go. */
export function liveRangeAttribute(attr) {
  if (attr.__wfxRanges) return attr;
  const a = { start: 0, count: 4 };
  const b = { start: 0, count: 4 };
  attr.updateRanges.length = 0;
  attr.updateRanges.push(a, b);
  attr.clearUpdateRanges = keepUpdateRanges;
  attr.__wfxRanges = [a, b];
  return attr;
}

/**
 * Wysyłka [start, start + count) liczb (floatów) i opcjonalnie drugiego zakresu (pierścień
 * zawinięty). count ≤ 0 — nic (bez needsUpdate). Bez alokacji.
 */
export function markRange(attr, start, count, start2 = 0, count2 = 0) {
  const R = (attr.__wfxRanges || liveRangeAttribute(attr).__wfxRanges);
  if (!(count > 0) && !(count2 > 0)) return;
  if (count > 0) {
    R[0].start = start;
    R[0].count = count;
  } else {
    R[0].start = start2;
    R[0].count = count2;
    count2 = 0;
  }
  if (count2 > 0) {
    R[1].start = start2;
    R[1].count = count2;
  } else {
    R[1].start = 0;
    R[1].count = Math.min(4, attr.array.length);
  }
  attr.needsUpdate = true;
}
