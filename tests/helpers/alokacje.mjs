// Pomiar alokacji w testach „bez alokacji na klatkę” (przyrost young generation V8).
//
// Kompilator optymalizujący V8 pracuje w osobnym wątku: pod obciążeniem (równoległe sesje, harnessy, gra użytkownika)
// kod zoptymalizowany wchodzi później, a do tego czasu interpreter i Sparkplug pakują liczby double — pomiar zaraz po
// rozgrzewce pokazuje alokacje, których w stanie ustalonym nie ma (test padał w pełnym zestawie). `untilSteady` mierzy
// w rundach przedzielonych przerwą, aż pomiar przejdzie próg testu albo skończą się rundy — prawdziwa alokacja oblewa
// każdą rundę. Symulacja zagłodzonego kompilatora bez obciążania CPU:
//   node --concurrent-recompilation-delay=200 --test tests/<plik>.test.mjs
import v8 from 'node:v8';

export const newSpaceUsed = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;

/** Przyrost young generation [B] na `n` wywołań `fn(i)`; ujemny (GC w trakcie) — próba od nowa. */
export function allocatedBytes(fn, n) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const before = newSpaceUsed();
    for (let i = 0; i < n; i++) fn(i);
    const delta = newSpaceUsed() - before;
    if (delta >= 0) return delta;
  }
  return Infinity;
}

/**
 * Najmniejszy wynik `measure()` [B] z rund: koniec, gdy `ok(najmniejszy)` albo po `rounds` rundach. Przed każdą
 * kolejną rundą `warm()` (dalsza rozgrzewka) i przerwa `pauseMs` — wątek kompilatora kończy pracę, kod wchodzi przy
 * następnym wywołaniu.
 */
export async function untilSteady(measure, ok, { warm = null, rounds = 40, pauseMs = 100 } = {}) {
  let best = Infinity;
  for (let round = 0; round < rounds; round++) {
    if (round > 0) {
      if (warm) warm();
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
    best = Math.min(best, measure());
    if (ok(best)) break;
  }
  return best;
}
