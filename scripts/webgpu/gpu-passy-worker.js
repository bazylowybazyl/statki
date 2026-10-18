// Kolektor czasów GPU PASSÓW w workerze renderu (2026-10-18, docs/AUDYT-render-worker-2026-10-17.md § 7.4) — kod
// wyrażenia dla `rytm-bitwy.mjs --wkStart plik:scripts/webgpu/gpu-passy-worker.js` (odczyt: --wkKoniec
// plik:scripts/webgpu/gpu-passy-wynik.js). Skala renderu 1, znaczniki czasu co klatkę (globalThis.__gpcEvery — inne N),
// etykieta passa z haków inspektora three (scena, kamera, warstwy, cel; lista compute — nazwy pierwszych węzłów),
// czasy z puli znaczników przed wyczyszczeniem przez Core3D._handleGpuTimestamp; kubełki 5 s czasu epoki × wariant
// (globalThis.__gpcVariant — ustawia go kod wariantu --wkAb). Klatki renderu: rekordy [t, wariant, domeny gazu, fine,
// coarse, mln próbek marszu, krok marszu, ortho, FG, suma, maks. świateł w komórce, światła]; compute: [t, wariant,
// domeny, gaz, światło pasa, suma]. Znaczniki co klatkę kosztują ~5 µs CPU workera na pass — oba warianty tak samo.
(async () => {
  const { Core3D } = await import('/src/3d/core3d.js');
  Core3D.setRenderScale(1);
  Core3D.gpuTimerSampleEvery = globalThis.__gpcEvery || 1;
  const R = Core3D.renderer, insp = R.inspector;
  const labels = new Map();
  const tName = (rt) => !rt ? 'kanwa' : (rt.texture?.name || rt.name || '') + '[' + rt.width + 'x' + rt.height + (rt.samples ? ' s' + rt.samples : '') + ']';
  // uid three: r|c:<nr wywołania w klatce>:<id kontekstu>:f<klatka>; compute (także listy — Core3D nadaje im własne id)
  // po pełnym uid, passy renderu po uid bez klatki
  const stable = (uid) => (uid.charCodeAt(0) === 99 ? uid : uid.replace(/:f\d+$/, ''));
  const snaps = new Array(1024).fill(null);
  let lastFrame = -1;
  const snap = (fr) => {
    if (fr === lastFrame) return; lastFrame = fr;
    const s = globalThis.__explosions?.stats || {};
    const g = Core3D.fx?.grid?.stats || {};
    snaps[fr & 1023] = { fr, t: Date.now(), v: globalThis.__gpcVariant | 0, dom: s.domains | 0, fine: s.fineDomains | 0, coarse: s.coarseDomains | 0,
      smp: (s.marchSamples || 0) / 1e6, step: s.marchStep || 1, lpc: g.maxPerCell | 0, lit: g.lights | 0 };
  };
  const frOf = (uid) => { const m = /:f(\d+)$/.exec(uid); return m ? +m[1] : -1; };
  const oBR = insp.beginRender, oBC = insp.beginCompute;
  insp.beginRender = function (uid, scene, camera, rt) {
    const k = stable(uid);
    if (!labels.has(k)) labels.set(k, 'R ' + (scene?.name || scene?.type || '?') + ' | ' + (camera?.isOrthographicCamera ? 'ortho' : camera?.isPerspectiveCamera ? 'persp' : '?') + ' L' + (camera?.layers?.mask >>> 0).toString(2) + ' | ' + tName(rt));
    snap(frOf(uid));
    return oBR.apply(this, arguments);
  };
  insp.beginCompute = function (uid, nodes) {
    const k = stable(uid);
    if (!labels.has(k)) { const a = Array.isArray(nodes) ? nodes : [nodes]; labels.set(k, 'C ' + a.slice(0, 2).map((n) => n?.name || n?.computeNode?.name || n?.type || '?').join(',') + (a.length > 2 ? ` +${a.length - 2}` : '')); }
    if (labels.size > 6000) { let i = 0; for (const key of labels.keys()) { if (key.charCodeAt(0) === 99) labels.delete(key); if (++i > 2000) break; } }
    snap(frOf(uid));
    return oBC.apply(this, arguments);
  };
  const G = globalThis.__gpc = { buckets: new Map(), frames: [], cframes: [], labels };
  const bucketOf = (t, v) => { const key = Math.floor(t / 5000) * 10 + v; let b = G.buckets.get(key); if (!b) { b = { t0: Math.floor(t / 5000) * 5000, v, nR: 0, nC: 0, sum: new Map(), tots: [], totC: [] }; G.buckets.set(key, b); } return b; };
  const orig = Core3D._handleGpuTimestamp;
  const perFrame = new Map();
  const ORTHO = 'R Scene | ortho L1 | ', FG = 'R Scene | persp L100 | ';
  Core3D._handleGpuTimestamp = function (type, ms) {
    const pool = this.renderer?.backend?.timestampQueryPool?.[type];
    if (pool?.timestamps) {
      perFrame.clear();
      for (const [uid, val] of pool.timestamps) {
        const fr = frOf(uid); let f = perFrame.get(fr); if (!f) { f = new Map(); perFrame.set(fr, f); }
        const lab = labels.get(stable(uid)) || ('? ' + stable(uid));
        f.set(lab, (f.get(lab) || 0) + val);
      }
      for (const [fr, f] of perFrame) {
        const s = snaps[fr & 1023]; if (!s || s.fr !== fr) continue;
        const b = bucketOf(s.t, s.v);
        let tot = 0, ortho = 0, fg = 0, gas = 0, belt = 0;
        for (const [lab, val] of f) {
          b.sum.set(lab, (b.sum.get(lab) || 0) + val); tot += val;
          if (lab.startsWith(ORTHO)) ortho += val; else if (lab.startsWith(FG)) fg += val;
          else if (lab.startsWith('C gas')) gas += val; else if (lab.startsWith('C beltVolumeLight')) belt += val;
        }
        if (type === 'render') {
          b.nR++; b.tots.push(tot);
          if (G.frames.length < 30000) G.frames.push([s.t, s.v, s.dom, s.fine, s.coarse, +s.smp.toFixed(2), +s.step.toFixed(2), +ortho.toFixed(3), +fg.toFixed(3), +tot.toFixed(3), s.lpc, s.lit]);
        } else {
          b.nC++; b.totC.push(tot);
          if (G.cframes.length < 30000) G.cframes.push([s.t, s.v, s.dom, +gas.toFixed(3), +belt.toFixed(3), +tot.toFixed(3)]);
        }
      }
    }
    return orig.call(this, type, ms);
  };
  return 'skala 1 — bufor ' + Core3D.composerTarget.width + '×' + Core3D.composerTarget.height + ', kolektor GPU passów (znaczniki co ' + Core3D.gpuTimerSampleEvery + ' kl.)';
})()
