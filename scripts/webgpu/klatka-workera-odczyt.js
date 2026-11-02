// Odczyt sondy klatki workera (klatka-workera-sonda.js): kubełki 5 s od startu bitwy (tBattle0), w każdym średnie
// i p50 / p95 na klatkę. Kompaktowo — wynik idzie na stdout narzędzia (linia „wk zdarzenie”, czyta ją
// klatka-workera-analiza.mjs).
(() => {
  const S = globalThis.__skw; if (!S) return null;
  const N = S.N, M = N - 1, n = S.n, from = Math.max(0, n - N);
  const B = new Map();
  for (let i = from; i < n - 1; i++) {
    const j = i & M;
    const b = Math.floor((S.t[j] - S.tBattle0) / 5000);
    let o = B.get(b);
    if (!o) B.set(b, o = { b, whole: [], rs: [], rr: 0, rrN: 0, rc: 0, rcN: 0, dr: [], pr: 0, prN: 0, pc: 0, pcN: 0, pd: 0, k: 0 });
    o.k++;
    if (S.whole[j] === S.whole[j]) o.whole.push(S.whole[j]);
    o.rs.push(S.rs[j]); o.dr.push(S.dr[j]);
    o.rr += S.rr[j]; o.rrN += S.rrN[j]; o.rc += S.rc[j]; o.rcN += S.rcN[j];
    o.pr += S.pr[j]; o.prN += S.prN[j]; o.pc += S.pc[j]; o.pcN += S.pcN[j]; o.pd += S.pd[j];
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const st = (a) => { if (!a.length) return [0, 0, 0]; const s = Float64Array.from(a).sort(); const q = (x) => s[Math.min(s.length - 1, Math.floor(x * s.length))];
    let sum = 0; for (const v of s) sum += v; return [r3(sum / s.length), r3(q(0.5)), r3(q(0.95))]; };
  // kolumny: t[s], klatek, cała [śr,p50,p95], renderSingle [śr,p50,p95], render() ms/kl, render() wywołań/kl,
  // compute() ms/kl, compute() wywołań/kl, rysunki/kl [śr,p50,p95], poza renderSingle: render() ms/kl, compute() ms/kl, rysunki/kl
  const rows = [...B.values()].sort((a, b) => a.b - b.b).map((o) => [o.b * 5, o.k, st(o.whole), st(o.rs), r3(o.rr / o.k), r3(o.rrN / o.k),
    r3(o.rc / o.k), r3(o.rcN / o.k), st(o.dr), r3(o.pr / o.k), r3(o.pc / o.k), r3(o.pd / o.k)]);
  return { tBattle0: S.tBattle0, preset: S.preset, frames: n, rows };
})()
