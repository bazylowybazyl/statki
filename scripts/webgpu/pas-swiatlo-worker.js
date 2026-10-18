// Rozkład pracy światła objętościowego pasa w workerze renderu (2026-10-18, docs/AUDYT-render-worker-2026-10-17.md
// § 7.5) — kod wyrażenia dla `rytm-bitwy.mjs --wkStart plik:scripts/webgpu/pas-swiatlo-worker.js --wkKoniec
// "JSON.stringify(globalThis.__pasPraca)"` (razem z kolektorem passów: oba wyrażenia w Promise.all w jednym pliku).
// Co ~2 s (czas epoki) lustro CPU kernela na próbce kolumn (co 13.): światła komórki siatki na kolumnę (N), z
// rozpraszaniem ≠ 0 w zasięgu xy (n), plastry ze światłem w zasięgu (trafienia — tyle razy kernel liczy pełne ciało
// światła; osobno światła bez rozpraszania), światła siatki wg rozpraszania (typ: poświata dysz 0, otoczenie 0,06,
// reflektory otoczenia 0,16, lampy 0,2, wybuchy 0,25, efekty broni 0,6, reflektory dalekie 0,8) z zasięgiem.
(async () => {
  const vm = await import('/src/3d/asteroids/volumetrics.js');
  const P = globalThis.__pasPraca = { probki: [] };
  const orig = vm.VolumeLight.prototype.compute;
  let last = 0;
  const KINDS = [[0, 'dysze0'], [0.06, 'otoczenie'], [0.16, 'reflOtocz'], [0.2, 'lampy'], [0.25, 'wybuchy'], [0.6, 'bron'], [0.8, 'reflDal']];
  vm.VolumeLight.prototype.compute = function () {
    const now = Date.now();
    if (now - last > 2000 && this._count > 0) {
      last = now;
      try { P.probki.push(sample(this, now)); } catch (e) { P.blad = String(e && e.message || e); }
      if (P.probki.length > 200) P.probki.shift();
    }
    return orig.call(this);
  };
  function sample(V, now) {
    const G = V.grid, L = G.lights, I = G.index, rect = G.rect.value, inv = G.invCell.value;
    const o = V.medium.U.origin.value, cell = V.U.cell.value.x, nx = V.U.nx.value, count = V._count;
    const zTop = V.medium.U.zTop.value, dz = V.U.dz.value, NZ = V.NZ;
    let cols = 0, sN = 0, sn = 0, sh = 0, sh0 = 0, maxN = 0;
    for (let id = 0; id < count; id += 13) {
      const ix = id % nx, iy = Math.floor(id / nx);
      const x = o.x + (ix + 0.5) * cell, y = o.y + (iy + 0.5) * cell;
      const cx = Math.floor((x - rect.x) * inv.x), cy = Math.floor((y - rect.y) * inv.y);
      cols++;
      if (cx < 0 || cy < 0 || cx >= 64 || cy >= 40) continue;
      const c = cy * 64 + cx, st = I[c * 2], en = st + I[c * 2 + 1];
      sN += en - st;
      if (en - st > maxN) maxN = en - st;
      for (let it = st; it < en; it++) {
        const q = I[it] * 16, R0 = Math.max(L[q + 3], 1), dx = L[q] - x, dy = L[q + 1] - y, d2 = dx * dx + dy * dy;
        if (!(d2 < R0 * R0)) continue;
        let hits = 0;
        for (let k = 0; k < NZ; k++) { const dd = L[q + 2] - (zTop - (k + 0.5) * dz); if (d2 + dd * dd < R0 * R0) hits++; }
        if (L[q + 7] === 0) sh0 += hits; else { sn++; sh += hits; }
      }
    }
    const kinds = {};
    for (let i = 0; i < G.count; i++) {
      const q = i * 16, s = L[q + 7];
      let name = 'inne';
      for (const [v, n] of KINDS) if (Math.abs(s - v) < 1e-4) { name = n; break; }
      const k = kinds[name] || (kinds[name] = { n: 0, zasieg: 0, stozek: 0 });
      k.n++; k.zasieg += L[q + 3]; if (L[q + 11] > -1.5) k.stozek++;
    }
    for (const k of Object.values(kinds)) k.zasieg = Math.round(k.zasieg / k.n);
    return { t: now, kolumny: count, komorkaPx: +(cell).toFixed(1), swiatla: G.stats.lights, maxNaKomorke: G.stats.maxPerCell,
      N: +(sN / cols).toFixed(1), maxN, n: +(sn / cols).toFixed(1), trafienia: +(sh / cols).toFixed(0), trafieniaBezRozpr: +(sh0 / cols).toFixed(0), typy: kinds };
  }
  return 'rozkład pracy światła pasa: co 2 s';
})()
