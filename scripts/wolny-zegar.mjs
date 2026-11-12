// Preload „zagłodzony wątek” dla testów Node: każdy odczyt performance.now() / Date.now() przesuwa czas o
// WOLNY_ZEGAR_MS (domyślnie 5 ms) — jakby wątek był wywłaszczany między odczytami zegara. Pokazuje testy i kod, które
// zależą od czasu ściany (progi „< 3 ms”, okna „900 ms”, budżet sprawdzany przed pierwszym krokiem), bez obciążania
// CPU — na tej maszynie użytkownik gra, a sesje mierzą wydajność.
//   WOLNY_ZEGAR_MS=5 node --import ./scripts/wolny-zegar.mjs --test --test-concurrency=2 "tests/*.test.mjs"
// Test powinien przechodzić przy 0 / 2 / 5 / 10 ms na odczyt. Timerów (setTimeout, Atomics.wait) preload nie
// dotyka — czas rzeczywisty płynie normalnie. Pomiary 2026-10-29: docs/AUDYT-testy-czas-sciany-2026-10-29.md.
const step = Number(process.env.WOLNY_ZEGAR_MS ?? 5);
if (step > 0) {
  let off = 0;
  const perf = globalThis.performance;
  const perfNow = perf.now.bind(perf);
  const dateNow = Date.now;
  perf.now = () => { off += step; return perfNow() + off; };
  Date.now = () => { off += step; return dateNow() + Math.floor(off); };
}
