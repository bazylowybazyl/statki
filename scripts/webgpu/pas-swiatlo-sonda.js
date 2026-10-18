// Sonda światła objętościowego pasa (moduł strony dla scripts/webgpu/pas-swiatlo-gra.mjs — import przez serwer gry,
// żeby three / TSL były tą samą instancją co w grze): kopia tekstury ośrodka do bufora (odczyt z GPU) i porównanie
// obu kerneli w tej samej klatce, lustro CPU pracy listy kolumny.
import { Fn, instanceIndex, instancedArray, texture3D, vec3, float, uint } from 'three/tsl';
import { VOLUME_LIGHT_TUNE } from '/src/3d/asteroids/volumetrics.js';

export function installVolumeProbe(B, Core3D) {
  const V = B.volume, R = Core3D.renderer;
  const NX = V.NX, NY = V.NY, NZ = V.NZ, N = NX * NY * NZ;
  const buf = instancedArray(N, 'vec4').setName('beltVolProbe');
  // Próbka w środku teksela, poziom 0 — wartość teksela (f16 → f32 bez straty).
  const copy = Fn(() => {
    const i = instanceIndex;
    const x = i.mod(uint(NX)), y = i.div(uint(NX)).mod(uint(NY)), z = i.div(uint(NX * NY));
    const uvw = vec3(float(x).add(0.5).div(NX), float(y).add(0.5).div(NY), float(z).add(0.5).div(NZ));
    buf.element(i).assign(texture3D(V.texture, uvw).level(0));
  })().compute(N).setName('beltVolProbeCopy');
  const read = async () => new Uint32Array((await R.getArrayBufferAsync(buf.value)).slice(0));
  return {
    V, NX, NY, NZ, tune: VOLUME_LIGHT_TUNE,
    /** Dawny kernel (wątek na kolumnę) i kernel `plastry` na tych samych wejściach, odczyt całej tekstury, porównanie słów. */
    async compare() {
      const T = VOLUME_LIGHT_TUNE, keep = T.slices, count = V._count;
      if (!count) return { count: 0 };
      const keepCols = T.cols, keepPer = T.per;
      const run = async (slices, cols = keepCols, per = keepPer) => { T.slices = slices; T.cols = cols; T.per = per; V.compute(); R.compute(copy); return read(); };
      const a = await run(false);
      const b = await run(true);
      const a2 = await run(false);
      // inne układy grup (kolumny × plastry na wątek) — też bit w bit z dawnym
      const uklady = {};
      for (const [cols, per] of this.uklady || []) {
        const c = await run(true, cols, per);
        let d = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) d++;
        uklady[cols + 'x' + per] = d;
      }
      T.slices = keep; T.cols = keepCols; T.per = keepPer;
      let kontrola = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== a2[i]) kontrola++;
      let diff = 0, nonzero = 0, first = -1, maxRel = 0;
      const fa = new Float32Array(a.buffer), fb = new Float32Array(b.buffer);
      const kan = [0, 0, 0, 0], plastry = new Uint32Array(NZ), probki = [];
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          diff++; if (first < 0) first = i;
          const t = i >> 2, ch = i & 3, x = t % NX, y = Math.floor(t / NX) % NY, z = Math.floor(t / (NX * NY));
          kan[ch]++; plastry[z]++;
          const rel = Math.abs(fa[i] - fb[i]) / Math.max(1e-30, Math.abs(fa[i]));
          if (rel > maxRel) maxRel = rel;
          if (probki.length < 8) probki.push({ x, y, z, ch, a: fa[i], b: fb[i] });
        }
        if ((i & 3) !== 3 && fa[i] !== 0) nonzero++;
      }
      return { count, slow: a.length, diff, kontrola, uklady, nonzero, first, maxRel, kanaly: kan, pierwszyPlaster: plastry.findIndex((v) => v > 0), probki };
    },
    /**
     * Lustro CPU pracy na kolumnę (próbka co „step” kolumn): światła komórki siatki (N), w zasięgu xy z rozpraszaniem ≠ 0
     * (n), plastry ze światłem w zasięgu (trafienia — tyle razy kernel liczy pełne ciało światła).
     */
    work(step = 7) {
      const G = V.grid, L = G.lights, I = G.index, rect = G.rect.value, inv = G.invCell.value;
      const o = V.medium.U.origin.value, cell = V.U.cell.value.x, nx = V.U.nx.value, count = V._count;
      const zTop = V.medium.U.zTop.value, dz = V.U.dz.value;
      let cols = 0, sN = 0, sn = 0, sh = 0, maxN = 0, zeroScatter = 0;
      for (let id = 0; id < count; id += step) {
        const ix = id % nx, iy = Math.floor(id / nx);
        const x = o.x + (ix + 0.5) * cell, y = o.y + (iy + 0.5) * cell;
        const cx = Math.floor((x - rect.x) * inv.x), cy = Math.floor((y - rect.y) * inv.y);
        cols++;
        if (cx < 0 || cy < 0 || cx >= 64 || cy >= 40) continue;
        const c = cy * 64 + cx, st = I[c * 2], en = st + I[c * 2 + 1];
        for (let it = st; it < en; it++) {
          const q = I[it] * 16, R0 = Math.max(L[q + 3], 1), dx = L[q] - x, dy = L[q + 1] - y, d2 = dx * dx + dy * dy;
          if (!(d2 < R0 * R0)) continue;
          if (L[q + 7] === 0) { zeroScatter++; continue; }
          sn++;
          for (let k = 0; k < NZ; k++) { const dd = L[q + 2] - (zTop - (k + 0.5) * dz); if (d2 + dd * dd < R0 * R0) sh++; }
        }
        sN += en - st;
        if (en - st > maxN) maxN = en - st;
      }
      const s = G.stats;
      return {
        kolumny: count, probka: cols, swiatla: s.lights, maxNaKomorke: s.maxPerCell, srN: +(sN / cols).toFixed(1), maxN,
        srn: +(sn / cols).toFixed(1), plastryWZasiegu: +(sh / cols).toFixed(1), pracaDawna: +(NZ * sN / cols).toFixed(0),
        bezRozpraszaniaNaKolumne: +(zeroScatter / cols).toFixed(1)
      };
    }
  };
}
