// Odczyt kolektora gpu-passy-worker.js (`rytm-bitwy.mjs --wkKoniec plik:scripts/webgpu/gpu-passy-wynik.js`; czas
// początku bitwy z globalThis.__rytmBattleEpoch): okna 10 s na wariant (render śr. / p95, compute, 5 najdroższych
// passów), rzeź (≥ 40 s) i lekka faza (< 30 s) — passy uśrednione na klatkę ze znacznikami, compute gazu i światła pasa,
// kosze mln próbek marszu gazu. Wynik — napis JSON (raport `wkKoniec`).
(() => {
  const G = globalThis.__gpc; if (!G) return 'brak kolektora';
  const T0 = globalThis.__rytmBattleEpoch || 0;
  const q = (a, x) => { if (!a.length) return null; const s = [...a].sort((p, r) => p - r); return +s[Math.min(s.length - 1, Math.floor(x * s.length))].toFixed(2); };
  const avg = (a) => a.length ? +(a.reduce((p, r) => p + r, 0) / a.length).toFixed(3) : null;
  const merge = (bs) => {
    const m = { nR: 0, nC: 0, sum: new Map(), tots: [], totC: [] };
    for (const b of bs) { m.nR += b.nR; m.nC += b.nC; for (const [k, v] of b.sum) m.sum.set(k, (m.sum.get(k) || 0) + v); m.tots.push(...b.tots); m.totC.push(...b.totC); }
    const rows = [...m.sum].map(([k, v]) => [k, v / Math.max(1, k.startsWith('C ') ? m.nC : m.nR)]).sort((a, b) => b[1] - a[1]);
    return { nR: m.nR, nC: m.nC, render: avg(m.tots), rP50: q(m.tots, 0.5), rP95: q(m.tots, 0.95), compute: avg(m.totC), cP95: q(m.totC, 0.95), passy: rows.slice(0, 24).map(([k, v]) => `${v.toFixed(3)} ${k}`) };
  };
  const bs = [...G.buckets.values()].map((b) => ({ ...b, rel: (b.t0 - T0) / 1000 }));
  const vs = [...new Set(bs.map((b) => b.v))].sort((a, b) => a - b);
  const out = { okna: [], rzez: {}, lekka: {}, kosze: {}, compute: {} };
  const win = 10;
  for (const r of [...new Set(bs.map((b) => Math.floor(b.rel / win) * win))].sort((a, b) => a - b)) {
    const o = { t: r };
    for (const v of vs) { const sel = bs.filter((b) => b.v === v && Math.floor(b.rel / win) * win === r); if (sel.length) { const m = merge(sel); o['v' + v] = { nR: m.nR, render: m.render, rP95: m.rP95, compute: m.compute, top: m.passy.slice(0, 5) }; } }
    out.okna.push(o);
  }
  for (const v of vs) {
    out.rzez['v' + v] = merge(bs.filter((b) => b.v === v && b.rel >= 40));
    out.lekka['v' + v] = merge(bs.filter((b) => b.v === v && b.rel >= 0 && b.rel < 30));
    for (const [lab, lo, hi] of [['rzez', 40, 1e9], ['lekka', 0, 30]]) {
      const c = G.cframes.filter((f) => f[1] === v && (f[0] - T0) / 1000 >= lo && (f[0] - T0) / 1000 < hi);
      if (c.length) out.compute[lab + '_v' + v] = { n: c.length, gas: avg(c.map((f) => f[3])), gasP95: q(c.map((f) => f[3]), 0.95), belt: avg(c.map((f) => f[4])), tot: avg(c.map((f) => f[5])), dom: avg(c.map((f) => f[2])) };
    }
    const fr = G.frames.filter((f) => f[1] === v && f[0] >= T0);
    out.kosze['v' + v] = [[0, 0.001], [0.001, 2], [2, 5], [5, 10], [10, 20], [20, 40], [40, 1e9]].map(([a, b]) => {
      const s = fr.filter((f) => f[5] >= a && f[5] < b);
      return s.length ? { smp: `${a}-${b}`, n: s.length, dom: avg(s.map((f) => f[2])), fine: avg(s.map((f) => f[3])), ortho: avg(s.map((f) => f[7])), fg: avg(s.map((f) => f[8])), tot: avg(s.map((f) => f[9])), totP95: q(s.map((f) => f[9]), 0.95), lpc: avg(s.map((f) => f[10])), lit: avg(s.map((f) => f[11])) } : null;
    }).filter(Boolean);
  }
  return JSON.stringify(out);
})()
