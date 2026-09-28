// src/3d/zakresyWysylki.js
//
// Wysyłka zmienionego wycinka atrybutu na GPU — bez DynamicDrawUsage i bez gubienia zakresów
// (port WebGPU, zadanie 23).
//
// three r183: atrybut z DynamicDrawUsage idzie `writeBuffer`-em w CAŁOŚCI przy każdym renderze,
// który rysuje siatkę (`Attributes.update` pomija wtedy porównanie wersji), a lista zakresów
// jest czyszczona po pierwszej wysyłce — kod, który liczył zakresy zmian (skóra kadłubów
// belkowych, odłamki kadłubów), i tak wysyłał całe bufory: w bitwie 48 okrętów ~1,9 MB na
// klatkę, przy Ziemi bryły dachu ringu ~2,2 MB (PLAN §3, pułapka z zadania 15).
// Bez DynamicDrawUsage wysyłka idzie tylko po `needsUpdate` — ale siatka nierysowana w klatce
// zmiany (poza kadrem, pass pominięty, podzielony ekran) wysyła dopiero przy najbliższym
// rysunku, a nadpisanie zakresu w następnej klatce zgubiłoby poprzednią zmianę. Tu zakres
// ZBIERA zmiany (suma przedziałów) do wysyłki, bez alokacji na klatkę.
//
// Bufor z przeplotem (InterleavedBuffer: iPos, iSize, iQuat… brył dachu ringu): three pilnuje
// wersji osobno dla KAŻDEGO atrybutu bufora i dla każdego woła wysyłkę, a po niej
// `clearUpdateRanges` — przy pustej liście drugi i kolejne atrybuty wysłałyby CAŁY bufor.
// Dlatego po wysyłce zakres zostaje na liście (kolejne atrybuty tego bufora wysyłają ten sam
// wycinek), a zbieranie od nowa zaczyna dopiero następna zmiana. Zapis do atrybutu tylko przez
// zbierzZakres / zbierzCaly — samo `needsUpdate` wysłałoby ostatni zakres, nie cały bufor.

// three po wysyłce zakresów woła clearUpdateRanges: znacznik „wysłane”, lista i obiekt zakresu zostają.
function sent() {
  this.__zakres.pending = false;
}

function stan(attr) {
  let s = attr.__zakres;
  if (s) return s;
  s = attr.__zakres = { range: { start: 0, count: 0 }, pending: false };
  attr.updateRanges.length = 0;
  attr.clearUpdateRanges = sent;
  return s;
}

/**
 * Dopisuje do wysyłki liczby [start, start + count) atrybutu (albo bufora z przeplotem) i ustawia
 * `needsUpdate`. Kolejne zmiany przed wysyłką rozszerzają zakres (bez gubienia poprzednich).
 * count ≤ 0 — nic.
 */
export function zbierzZakres(attr, start, count) {
  if (!(count > 0)) return;
  const s = stan(attr);
  const r = s.range;
  const end = start + count;
  if (!s.pending) {
    r.start = start;
    r.count = count;
    s.pending = true;
    attr.updateRanges.length = 0;
    attr.updateRanges.push(r);
  } else {
    const e = Math.max(r.start + r.count, end);
    r.start = Math.min(r.start, start);
    r.count = e - r.start;
  }
  attr.needsUpdate = true;
}

/** Cały atrybut do wysłania (zakres = cała tablica). */
export function zbierzCaly(attr) {
  zbierzZakres(attr, 0, attr.array.length);
}

// ── Wiele zakresów na wysyłkę (partie kadłubów, hullSkinBatch.js) ──────────────────────────────────────
// Zmienione wycinki WIELU kadłubów w jednym buforze partii: jeden zakres od najniższego do najwyższego
// wysyłałby dziury między nimi (całą partię). Tu lista rozłącznych zakresów — three wysyła każdy osobno
// (WebGPUAttributeUtils.updateAttribute), po wysyłce lista pusta (atrybut bez przeplotu: jedna wysyłka na
// wersję). Zapis stykający się z OSTATNIM zakresem go rozszerza (kolejne czworokąty tego samego kadłuba),
// obiekty zakresów z puli atrybutu — bez alokacji na klatkę.

function sentMulti() {
  this.updateRanges.length = 0;
  this.__zakresy.used = 0;
}

function stanMulti(attr) {
  let s = attr.__zakresy;
  if (s) return s;
  s = attr.__zakresy = { pool: [], used: 0 };
  attr.updateRanges.length = 0;
  attr.clearUpdateRanges = sentMulti;
  return s;
}

/** Dopisuje zakres [start, start + count) do listy wysyłki atrybutu (osobny zakres, gdy się nie styka). */
export function zbierzZakresy(attr, start, count) {
  if (!(count > 0)) return;
  const s = stanMulti(attr);
  const list = attr.updateRanges;
  const end = start + count;
  const last = list.length ? list[list.length - 1] : null;
  if (last && start <= last.start + last.count && end >= last.start) {
    const e = Math.max(last.start + last.count, end);
    last.start = Math.min(last.start, start);
    last.count = e - last.start;
  } else {
    const r = s.pool[s.used] || (s.pool[s.used] = { start: 0, count: 0 });
    s.used++;
    r.start = start;
    r.count = count;
    list.push(r);
  }
  attr.needsUpdate = true;
}

/** Cały atrybut do wysłania (lista zakresów zastąpiona jednym). */
export function zbierzZakresyCaly(attr) {
  const s = stanMulti(attr);
  attr.updateRanges.length = 0;
  s.used = 0;
  zbierzZakresy(attr, 0, attr.array.length);
}
