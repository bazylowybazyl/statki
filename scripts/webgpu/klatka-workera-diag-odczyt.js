// Odczyt diagnostyki składu klatki workera (klatka-workera-diag.js): średnie na klatkę od instalacji, rysunki po
// nazwie (najczęstsze 48), wywołania render / compute, histogram całej klatki, najwolniejsze klatki ze składem,
// obiekty sceny. Wynik idzie na stdout narzędzia (linia „wk zdarzenie”). Nie zeruje liczników (odczyt wielokrotny).
(() => {
  const D = globalThis.__skwd; if (!D) return null;
  const n = Math.max(1, D.frames);
  const r2 = (v) => Math.round(v * 100) / 100;
  const avg = {}; for (const k in D.sum) avg[k] = r2(D.sum[k] / n);
  const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, c]) => [name, r2(c / n)]);
  const slow = D.slow.slice().sort((a, b) => b.ms - a.ms).slice(0, 24);
  const gpu = {}; if (D.gpu) for (const k in D.gpu) gpu[k] = r2(D.gpu[k] / n);
  gpu.writeBy = D.writeBy ? [...D.writeBy.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 40).map(([k, e]) => [k, r2(e.n / n), r2(e.kb / n)]) : [];
  return {
    frames: D.frames, avg, gpuNaKlatke: gpu, rysunki: top(D.draws, 48), rendery: top(D.renders, 16),
    computeNaKlatke: r2(D.computes / n), kerneliNaKlatke: r2(D.computeKernels / n), computeWg: D.computeBy ? top(D.computeBy, 24) : [],
    histCala: Array.from(D.hist), wolne: D.slow.length, najwolniejsze: slow, scena: D.scene
  };
})()
