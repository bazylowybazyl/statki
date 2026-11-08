// Sonda klatki workera renderu (pomiar „dual worker”, 2026-11-02, docs/AUDYT-klatka-workera-2026-11-02.md) — kod dla
// `profil-bitwy-flot.mjs --wkZdarzenia '0@plik:scripts/webgpu/klatka-workera-sonda.js|92@plik:scripts/webgpu/klatka-workera-odczyt.js'`
// (odczyt przed końcem --trwanie, z zapasem na takt próbek --co). Na każdą klatkę (Core3D.renderSingle):
// czas całej klatki workera (globalThis.__rwFrameTimes: lustra → bitmapa), renderSingle, renderer.render /
// renderer.compute three (czas i liczba wywołań najwyższego poziomu), rysunki (_renderObjectDirect); osobno to samo
// POZA renderSingle (wypieki i rozgrzewki modułów w fazie aktualizacji). Same liczniki i performance.now() na
// wywołanie render / compute (kilkanaście na klatkę) — rysunków nie mierzy czasem (to daje profil CPU).
(async () => {
  if (globalThis.__skw) return 'sonda już działa';
  const { Core3D } = await import('/src/3d/core3d.js');
  const R = Core3D.renderer;
  if (!R || typeof Core3D.renderSingle !== 'function') return 'brak renderera';
  const N = 1 << 16, M = N - 1;
  const S = globalThis.__skw = {
    tBattle0: Date.now(), N,
    t: new Float64Array(N), whole: new Float32Array(N).fill(NaN), rs: new Float32Array(N),
    rr: new Float32Array(N), rrN: new Uint16Array(N), rc: new Float32Array(N), rcN: new Uint16Array(N), dr: new Uint32Array(N),
    pr: new Float32Array(N), prN: new Uint16Array(N), pc: new Float32Array(N), pcN: new Uint16Array(N), pd: new Uint32Array(N),
    n: 0, lastF: -1, inRS: false,
    // liczniki bieżącej fazy (render) i fazy przed renderem (od końca poprzedniego renderSingle)
    cRr: 0, cRrN: 0, cRc: 0, cRcN: 0, cDr: 0, pRr: 0, pRrN: 0, pRc: 0, pRcN: 0, pDr: 0,
    preset: (() => { try { return Core3D.renderScale + ' / ' + (Core3D.width || 0) + 'x' + (Core3D.height || 0); } catch { return '?'; } })()
  };
  const F = globalThis.__rwFrameTimes;
  const now = () => performance.now();
  const oRS = Core3D.renderSingle;
  Core3D.renderSingle = function () {
    const i = S.n;
    // cała klatka poprzedniej strony jest już w pierścieniu __rwFrameTimes (zapis po bitmapie)
    if (i > 0 && F && F.n !== S.lastF) { S.whole[(i - 1) & M] = F.ms[(F.n - 1) & 8191]; S.lastF = F.n; }
    const j = i & M;
    S.pr[j] = S.pRr; S.prN[j] = S.pRrN; S.pc[j] = S.pRc; S.pcN[j] = S.pRcN; S.pd[j] = S.pDr;
    S.pRr = 0; S.pRrN = 0; S.pRc = 0; S.pRcN = 0; S.pDr = 0;
    S.cRr = 0; S.cRrN = 0; S.cRc = 0; S.cRcN = 0; S.cDr = 0;
    S.inRS = true;
    const t0 = now();
    try { return oRS.apply(this, arguments); } finally {
      S.t[j] = performance.timeOrigin + t0; S.rs[j] = now() - t0;
      S.rr[j] = S.cRr; S.rrN[j] = S.cRrN; S.rc[j] = S.cRc; S.rcN[j] = S.cRcN; S.dr[j] = S.cDr;
      S.n = i + 1; S.inRS = false;
    }
  };
  let depth = 0;
  const wrapTimed = (name, isRender) => {
    const orig = R[name];
    R[name] = function () {
      if (depth++ > 0) { try { return orig.apply(this, arguments); } finally { depth--; } }
      const t0 = now();
      try { return orig.apply(this, arguments); } finally {
        depth--; const d = now() - t0;
        if (S.inRS) { if (isRender) { S.cRr += d; S.cRrN++; } else { S.cRc += d; S.cRcN++; } }
        else if (isRender) { S.pRr += d; S.pRrN++; } else { S.pRc += d; S.pRcN++; }
      }
    };
  };
  wrapTimed('render', true);
  wrapTimed('compute', false);
  const oDraw = R._renderObjectDirect;
  R._renderObjectDirect = function () { if (S.inRS) S.cDr++; else S.pDr++; return oDraw.apply(this, arguments); };
  return { ok: true, preset: S.preset, tBattle0: S.tBattle0 };
})()
