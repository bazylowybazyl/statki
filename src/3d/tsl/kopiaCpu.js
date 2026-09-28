// src/3d/tsl/kopiaCpu.js
//
// Kopie CPU buforów storage liczonych WYŁĄCZNIE na GPU (port WebGPU, zadanie 23).
//
// `instancedArray(n, typ)` trzyma tablicę CPU tej samej wielkości co bufor GPU — three wysyła ją raz, przy
// utworzeniu bufora (mappedAtCreation), i nigdy więcej nie czyta (odczyt `getArrayBufferAsync` bierze rozmiar
// z bufora GPU, wiązania — z węzła). Bufory, które pisze tylko kernel, a czyta materiał (dym i mgławica rakiet,
// ośrodek warpa, pule efektów broni, iskry pasa), trzymały tak ~140 MB martwych tablic w pamięci strony. Tu
// tablica wraca do atrapy (ten sam typ, jeden element), gdy bufor GPU już istnieje — wzór:
// HullDamageMap._dropCpuCopy (zadanie 18-C).
//
// Warunek: CPU nie pisze do takiego bufora (żadnego `needsUpdate`) — wysyłka atrapy nadpisałaby początek
// bufora GPU. `attr.count` (liczba elementów z konstrukcji) zostaje, więc węzły storage budowane później
// (nowy wariant materiału) dostają ten sam rozmiar tablicy w WGSL.

/**
 * Oddaje kopie CPU buforów z listy (węzły `instancedArray` / storage albo same atrybuty), których bufor GPU
 * już istnieje. Zwraca liczbę buforów, które NADAL trzymają kopię (bufor GPU jeszcze nie powstał — wołaj
 * ponownie po pierwszym dispatchu / rysunku); bajty oddane w sumie — `stanKopiiCpu.oddaneBajty`.
 */
export function oddajKopieCpu(renderer, lista) {
  const backend = renderer?.backend;
  if (!backend || typeof backend.get !== 'function') return lista.length;
  let zostalo = 0;
  for (const el of lista) {
    const attr = el?.isBufferAttribute || el?.isInterleavedBuffer ? el : el?.value;
    if (!attr || !attr.array || attr.__kopiaCpuOddana === true) continue;
    let buffer = null;
    try { buffer = backend.get(attr)?.buffer || null; } catch { buffer = null; }
    if (!buffer) { zostalo++; continue; }
    const arr = attr.array;
    stanKopiiCpu.oddaneBajty += arr.byteLength;
    stanKopiiCpu.bufory++;
    attr.array = new arr.constructor(Math.max(1, attr.itemSize | 0));
    attr.__kopiaCpuOddana = true;
  }
  return zostalo;
}

/** Licznik (narzędzia pamięci, zadanie 23): ile bajtów kopii CPU oddano od startu strony. */
export const stanKopiiCpu = { oddaneBajty: 0, bufory: 0 };
