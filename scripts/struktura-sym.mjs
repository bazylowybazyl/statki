// Gruby graf nośny budowli w Node (docs/PLAN-zawalenia-budowli-3d.md, etap E1; src/game/structureGraph.js) — oś
// czasu zdarzeń i koszt kroku bez przeglądarki. Bez Math.random (punkty trafień z PRNG ziarna), wynik bit w bit.
//
//   node scripts/struktura-sym.mjs [--tryb podciecie,zawias,wspornik,kondygnacja,front,fala,ciezkie,dysk-szyja,dysk-upadek,prog,koszt]
//     [--dt 120,60] [--strona 1|-1] [--poziom 15] [--kappa 0.1,0.2,0.3,1] [--v0 900,1300,1700] [--omega 0.55,0.7,0.85]
//     [--sigma 4,6,8,…] (prog: siatka σ) [--hold h] [--gruz 0.2,0.3] [--ziarno 5] [--set klucz=wartość,…] (STRUCT_TUNE w locie)
//
//   podciecie   — kratery co 0,2 s w pasie broni po stronie --strona (x = ±190): narastanie stosunków, zerwania,
//                 wyspa i ZAWIAS (kierunek przechyłu — ma wyjść ku stronie podciętej, punkt — na krawędzi przeciwnej),
//                 błąd równowagi przy ocenach
//   zawias      — statystyka D11: W-1 i W-2, strony ±x / ±y, 8 ziaren × 3 warianty (kratery / z falą / mocne): przechył
//                 ku stronie podciętej, spadek pionowy, kąt i ramię zawiasu
//   wspornik    — moment u nasady z grafu wobec Σ m·g·x i siły osiowe w każdym przekroju wobec M(x) (4 / 8 / 12
//                 przęseł) dla shearK 1e-4 / 1e-5 / domyślnego i laplasjanu benchmarku (shearK 1)
//   kondygnacja — kondygnacja --poziom osłabiana co 0,25 s (sym — cała, ecc — strona +x): spadek / zawias, front, plastry
//   front       — front Bažanta dla κ z --kappa × gruz z --gruz (zgniot od kondygnacji --poziom): poziomy, prędkość, do ziemi / stop
//   ciezkie     — losowe uszkodzenia wiązań (0,5–1,5 co 6 kroków przez 20 s): błąd przy ocenach (≤ solveTol), serie
//                 niezbieżnych przebiegów, tryb miękki, zawalenia mechanizmów, tryby zerwań; wyspa swobodna (−1 / zbieżna)
//   fala        — trafienia J 2000 w pas co 0,25 s z falą i bez: najwyższe zerwanie, zerwania ponad z 420 przed oderwaniem
//   dysk-szyja  — leżąca wieża H-T uderza bokiem (korona bębna + dysk), utrzymanie --hold (domyślnie 1)
//   dysk-upadek — stojąca wieża przechodzi przez dysk z --v0, utrzymanie --hold (domyślnie z zegara D8 w chwili dojścia):
//                 otwór, IoU, stan grafu (podpory przed / po styku)
//   prog        — siatka σ (jeden próg dla obu scenariuszy): czy upadek przechodzi, czy szyja trzyma — luka między nimi
//   koszt       — koszt kroku (p50 / p95 / p99 / max, średnio) wieżowca pod ostrzałem, dysku pod obciążeniem ciągłym
//                 i wszystkich grafów misji naraz (W-1, W-2, dysk) z przesunięciem faz
import * as SG from '../src/game/structureGraph.js';

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const list = (n, f) => String(arg(n, f)).split(',').filter(Boolean);
const nums = (n, f) => list(n, f).map(Number);
const modes = list('tryb', 'podciecie,zawias,wspornik,kondygnacja,front,fala,ciezkie,dysk-szyja,dysk-upadek,prog,koszt');
const hzs = nums('dt', '120');
const seed = Number(arg('ziarno', 5));
const tune = {};
for (const kv of list('set', '')) { const [k, v] = kv.split('='); tune[k] = Number(v); }
const T = Object.keys(tune).length ? tune : null;
const r3 = (v) => Math.round(v * 1000) / 1000;
const names = Object.fromEntries(Object.entries(SG.STRUCT_EV).map(([k, v]) => [v, k]));
const W = SG.STRUCT_EV_STRIDE;
const evs = (S) => { const out = []; for (let j = 0; j < S.evCount; j++) out.push(S.ev.subarray(j * W, (j + 1) * W)); return out; };
const line = (o) => console.log(JSON.stringify(o));
const fmtEv = (e) => {
  const t = names[e[0]];
  const p = `(${e[4].toFixed(0)}, ${e[5].toFixed(0)}, ${e[6].toFixed(0)})`;
  if (t === 'ISLAND') return `${e[1].toFixed(3)} s  WYSPA ${e[2]}: ${e[3]} bl., masa ${e[13].toFixed(0)}, środek ${p}${e[14] >= 0 ? `, rodzic ${e[14]}` : ''}${e[15] ? ', spadek pionowy' : ''}`;
  if (t === 'HINGE') return `${e[1].toFixed(3)} s  ZAWIAS wyspy ${e[2]}: punkt ${p}, przechył (${e[7].toFixed(2)}, ${e[8].toFixed(2)}), oś (${e[10].toFixed(2)}, ${e[11].toFixed(2)}), ramię ${e[13].toFixed(0)}, pęka przy ${e[14]}°`;
  if (t === 'SPLIT') return `${e[1].toFixed(3)} s  PLASTER wyspy ${e[2]} (${e[13]} poziomów) → ${e[3]} paczek`;
  if (t === 'FRONT') return `${e[1].toFixed(3)} s  FRONT poziom ${e[2]}: v ${e[13].toFixed(0)} j/s, gruz ${e[14].toFixed(0)}, w ruchu ${e[15].toFixed(0)}`;
  if (t === 'FRONT_GROUND') return `${e[1].toFixed(3)} s  FRONT u ziemi: v ${e[13].toFixed(0)} j/s, masa ${e[15].toFixed(0)}`;
  if (t === 'FRONT_STOP') return `${e[1].toFixed(3)} s  FRONT STAJE na poziomie ${e[2]}`;
  if (t === 'SUPPORT_FAIL') return `${e[1].toFixed(3)} s  PODPORA ${e[2]} puszcza: reakcja ${e[13].toFixed(0)} > ${e[14].toFixed(0)}`;
  if (t === 'BREAKS') return `${e[1].toFixed(3)} s  ZERWANIA zbiorczo: ${e[3]} (średnio ${p})`;
  if (t === 'OVERFLOW') return `${e[1].toFixed(3)} s  PRZEPEŁNIENIE: ${e[3]} rekordów`;
  return null;
};

const HR = SG.buildHighriseArchetype({ seed, tune: T });
console.log(`# wieżowiec: ${HR.n} bloków (${HR.nLevels} poziomów), ${HR.e} wiązań, masa ${HR.totalMass.toFixed(0)}, kalibracja ${HR.calib.err.toExponential(1)}`);

function undercut(sign, hz) {
  const S = SG.createStructure(HR, { id: 2 });
  const rnd = SG.structureRng(11), dt = 1 / hz, every = Math.round(0.2 * hz);
  console.log(`\n## podcięcie ${sign > 0 ? '+x' : '−x'}, ${hz} Hz`);
  let stop = Infinity, breaksByLevel = new Int32Array(HR.nLevels + 1), firstBreak = -1, island = null, hinge = null, maxR = 0;
  for (let s = 0; s < 40 * hz && s < stop; s++) {
    if (s % every === 0) { const y = (rnd() * 2 - 1) * 200, z = (rnd() * 2 - 1) * 70; SG.structureDamageSphere(S, sign * 190, y, z, 110, 0.18); }
    SG.stepStructure(S, dt, s);
    for (let k = 0; k < HR.e; k++) if (S.alive[k] && S.ratio[k] > maxR) maxR = S.ratio[k];
    if (s % hz === 0) console.log(`${(s / hz).toFixed(0).padStart(3)} s  maks. stosunek ${maxR.toFixed(2)}, zerwane ${S.stats.breaks}, błąd ostatniej oceny ${S.stats.lastEvalErr.toFixed(4)}`);
    for (const e of evs(S)) {
      if (e[0] === SG.STRUCT_EV.BREAK) { if (firstBreak < 0) firstBreak = e[1]; const l = Math.max(HR.level[HR.ba[e[2]]], HR.level[HR.bb[e[2]]], 0); breaksByLevel[l]++; continue; }
      const f = fmtEv(e); if (f) console.log(f);
      if (e[0] === SG.STRUCT_EV.ISLAND && !island && e[13] > 0.3 * HR.totalMass) { island = { t: r3(e[1]), mass: r3(e[13]), blocks: e[3] }; stop = s + Math.round(0.5 * hz); }
      if (e[0] === SG.STRUCT_EV.HINGE && !hinge) hinge = { t: r3(e[1]), dir: [r3(e[7]), r3(e[8])], arm: r3(e[13]) };
    }
  }
  line({ tryb: 'podciecie', hz, strona: sign, pierwszeZerwanie: r3(firstBreak), wyspa: island, zawias: hinge, zerwania: S.stats.breaks,
    zerwaniaWgPoziomu: Array.from(breaksByLevel.subarray(0, HR.nLevels)), oceny: S.stats.evals, przebiegi: S.stats.passes,
    maksBladOceny: r3(S.stats.maxEvalErr), maksSeriaNiezbieznych: S.stats.maxPending, blokiMiekkie: S.stats.softMarks });
}

function cantilever() {
  console.log('\n## wspornik: moment u nasady (graf / Σ m·g·x) i moment osiowy przekrojów (Σ N·n_x·z / M(x))');
  for (const shear of [1e-4, 1e-5, null, 1]) for (const segments of [4, 8, 12]) {
    const A = SG.buildCantileverArchetype({ segments, tune: shear ? { shearK: shear } : null });
    const S = SG.createStructure(A, { id: 0 });
    for (let t = 0; t < 8; t++) SG.stepStructure(S, 1 / 120, t);
    let Ma = 0, Mb = 0;
    for (let i = 0; i < A.n; i++) if (!A.anchor[i]) Ma += A.x[i] * A.mass[i] * A.g;
    for (let k = 0; k < A.e; k++) {
      const a = A.ba[k], b = A.bb[k];
      if (!A.anchor[a] || A.anchor[b]) continue;
      const dx = S.ux[b], dy = S.uy[b], dz = S.uz[b], ex = A.nx[k], ey = A.ny[k], ez = A.nz[k];
      const c = (S.ka[k] - S.kS[k]) * (ex * dx + ey * dy + ez * dz);
      Mb += A.z[b] * -(S.kS[k] * dx + c * ex) - A.x[b] * -(S.kS[k] * dz + c * ez);
    }
    const sec = [];
    for (let sg = 1; sg <= segments; sg++) {
      const xc = (sg - 0.5) * 100;
      let M = 0, Mn = 0;
      for (let i = 0; i < A.n; i++) if (!A.anchor[i] && A.x[i] > xc) M += (A.x[i] - xc) * A.mass[i] * A.g;
      for (let k = 0; k < A.e; k++) if (Math.abs(A.cx[k] - xc) < 1) Mn += S.nAx[k] * A.nx[k] * A.cz[k];
      sec.push(r3(Mn / M));
    }
    line({ tryb: 'wspornik', model: shear === 1 ? 'laplasjan (shearK 1)' : `osiowy (shearK ${A.tune.shearK})`, przesla: segments, dlugosc: segments * 100,
      momentAnalityka: Math.round(Ma), momentGraf: Math.round(-Mb), blad: r3(Math.abs(-Mb - Ma) / Ma), osiowoWPrzekrojach: sec });
  }
}

function storey(variant, L, hz, kappa, quiet = false, debrisFrac = undefined) {
  const S = SG.createStructure(HR, { id: 1 });
  const dt = 1 / hz, every = Math.round(0.25 * hz);
  if (!quiet) console.log(`\n## kondygnacja ${L} (${variant}), ${hz} Hz, κ ${kappa}`);
  const res = { tryb: 'kondygnacja', wariant: variant, poziom: L, hz, kappa, gruz: debrisFrac ?? HR.tune.debrisFrac, wyspy: [], zawias: null, startFrontu: null, poziomyFrontu: 0, ziemia: null, stop: null };
  for (let s = 0; s < 20 * hz; s++) {
    if (s % every === 0 && s < 4 * hz) for (let j = HR.storeyStart[L]; j < HR.storeyStart[L + 1]; j++) { const k = HR.storeyBonds[j]; if (variant === 'sym' || HR.cx[k] > 60) SG.structureDamageBond(S, k, 0.12); }
    SG.stepStructure(S, dt, s);
    for (const e of evs(S)) {
      if (e[0] === SG.STRUCT_EV.BREAK) continue;
      if (!quiet) { const f = fmtEv(e); if (f) console.log(f); }
      if (e[0] === SG.STRUCT_EV.ISLAND) {
        res.wyspy.push({ t: r3(e[1]), bloki: e[3], masa: r3(e[13]), spadek: e[15] });
        if (e[15] === 1 && e[3] > 3 && res.startFrontu === null && SG.structureStartFront(S, e[2], 0, { kappa, debrisFrac })) res.startFrontu = r3(e[1]);
      }
      if (e[0] === SG.STRUCT_EV.HINGE && !res.zawias) res.zawias = { t: r3(e[1]), dir: [r3(e[7]), r3(e[8])] };
      if (e[0] === SG.STRUCT_EV.FRONT) res.poziomyFrontu++;
      if (e[0] === SG.STRUCT_EV.FRONT_GROUND) res.ziemia = { t: r3(e[1]), v: r3(e[13]) };
      if (e[0] === SG.STRUCT_EV.FRONT_STOP) res.stop = { t: r3(e[1]), poziom: e[2] };
    }
  }
  res.wyspy = res.wyspy.filter((w) => w.bloki > 1).slice(0, 6);
  res.maksBladOceny = r3(S.stats.maxEvalErr); res.maksSeriaNiezbieznych = S.stats.maxPending; res.blokiMiekkie = S.stats.softMarks;
  line(res);
  return res;
}

function wave() {
  console.log('\n## fala w konstrukcji (trafienia J 2000 co 0,25 s w x = 190, z = 0)');
  for (const withWave of [true, false]) {
    const S = SG.createStructure(HR, { id: 4 });
    let maxZ = -1e9, high = 0, island = null, firstHigh = null;
    for (let s = 0; s < 30 * 120 && !island; s++) {
      if (s % 30 === 0) { const y = ((s / 30) % 5 - 2) * 80; SG.structureDamageSphere(S, 190, y, 0, 60, 0.08); if (withWave) SG.structureHit(S, 190, y, 0, 2000, -1, 0, 0); }
      SG.stepStructure(S, 1 / 120, s);
      for (const e of evs(S)) {
        if (e[0] === SG.STRUCT_EV.BREAK) { if (e[6] > maxZ) maxZ = e[6]; if (e[6] > 420) { high++; if (firstHigh === null) firstHigh = r3(e[1]); } }
        if (e[0] === SG.STRUCT_EV.ISLAND && e[13] > 0.3 * HR.totalMass) island = r3(e[1]);
      }
    }
    line({ tryb: 'fala', fala: withWave, najwyzszeZerwanie: Math.round(maxZ), zerwaniaPonad420: high, pierwszePonad420: firstHigh, oderwanie: island, zerwania: S.stats.breaks });
  }
}

function hingeStats(hz) {
  console.log(`\n## zawias (D11): W-1 i W-2, strony ±x / ±y, 8 ziaren × 3 warianty, ${hz} Hz`);
  const res = { ku: 0, inny: 0, spadek: 0, brak: 0 }, arms = [], angles = [], pts = [];
  for (const A of [HR, SG.buildHighriseArchetype({ seed: seed + 1, tune: T })]) for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const half = sx ? 190 : 210;
    for (let sd = 1; sd <= 8; sd++) for (const [amt, wv] of [[0.18, 0], [0.12, 1500], [0.3, 0]]) {
      const S = SG.createStructure(A, { id: sd }), rnd = SG.structureRng(sd * 31 + 7);
      let out = null;
      for (let s = 0; s < 40 * hz && !out; s++) {
        if (s % Math.round(0.2 * hz) === 0) {
          const t = rnd() * 2 - 1, z = (rnd() * 2 - 1) * 70, x = sx ? sx * 190 : t * 180, y = sy ? sy * 200 : t * 190;
          SG.structureDamageSphere(S, x, y, z, 110, amt);
          if (wv) SG.structureHit(S, x, y, z, wv, -sx, -sy, 0);
        }
        SG.stepStructure(S, 1 / hz, s);
        for (const e of evs(S)) {
          if (e[0] === SG.STRUCT_EV.ISLAND && e[13] > 0.3 * A.totalMass && e[14] === -1 && e[15] === 1) out = { drop: true };
          if (e[0] === SG.STRUCT_EV.HINGE && e[15] > 0.3 * A.totalMass) out = { d: e[7] * sx + e[8] * sy, arm: e[13], p: -(e[4] * sx + e[5] * sy) / half };
        }
      }
      if (!out) res.brak++;
      else if (out.drop) res.spadek++;
      else { if (out.d > 0.7) res.ku++; else res.inny++; arms.push(out.arm); angles.push(Math.acos(Math.min(1, out.d)) * 180 / Math.PI); pts.push(out.p); }
    }
  }
  const mm = (a) => { const s = a.slice().sort((x, y) => x - y); return [r3(s[0]), r3(s[s.length >> 1]), r3(s[s.length - 1])]; };
  line({ tryb: 'zawias', hz, ...res, katOdNormalnej: mm(angles), ramie: mm(arms), punktZawiasuPoPrzeciwnej: mm(pts) });
}

function heavy(hz) {
  console.log(`\n## ciężkie losowe uszkodzenia, ${hz} Hz`);
  const modeNames = Object.fromEntries(Object.entries(SG.STRUCT_MODE).map(([k, v]) => [v, k]));
  for (const sd of [4, 6, 7, 8, 9, 10, 11, 12]) {
    const S = SG.createStructure(HR, { id: 1 }), rnd = SG.structureRng(sd), modes = {};
    for (let s = 0; s < 20 * hz; s++) {
      if (s % Math.round(0.05 * hz) === 0) SG.structureDamageBond(S, (rnd() * HR.e) | 0, 0.5 + rnd());
      SG.stepStructure(S, 1 / hz, s);
      for (const e of evs(S)) if (e[0] === SG.STRUCT_EV.BREAK) modes[modeNames[e[3]]] = (modes[modeNames[e[3]]] || 0) + 1;
    }
    const c = SG.structureCounts(S);
    line({ tryb: 'ciezkie', hz, ziarno: sd, oceny: S.stats.evals, przebiegi: S.stats.passes, maksBladOceny: r3(S.stats.maxEvalErr), maksSeriaNiezbieznych: S.stats.maxPending,
      blokiMiekkie: S.stats.softMarks, ciecieMechanizmow: S.stats.mechCuts, zerwania: S.stats.breaks, rekordyWgTrybu: modes, zakotwiczone: c.anchored, wolne: c.free });
  }
}

function plate(kind, hz) {
  const cloud = SG.towerPointCloud();
  const disc = SG.buildDiscArchetype({ seed: 7, tune: T });
  if (kind === 'szyja') {
    for (const omega0 of nums('omega', '0.55,0.7,0.85')) {
      const t0 = performance.now();
      const r = SG.plateImpactScenario('szyja', { hz, omega0, hold: Number(arg('hold', 1)), cloud, disc });
      line({ tryb: 'dysk-szyja', hz, omega0, predkoscKrawedzi: Math.round(r.rimSpeed), sigma: r.sigma, katKoncowy: r3(r.endDeg), pierwszyStyk: r3(r.tFirst),
        dysk: { rowKomorek: r.disc.trench, otwory: r.disc.holes, komorek: r.disc.cells, maksUbytek: r3(r.disc.maxLoss), sredniUbytek: r3(r.disc.meanLossTouched) },
        korona: { row: r.crown.trench, otwory: r.crown.holes }, energiaDysk: Number(r.energyDisc.toExponential(3)), energiaKorona: Number(r.energyCrown.toExponential(3)),
        graf: r.graph, ms: Math.round(performance.now() - t0) });
    }
  } else {
    for (const v0 of nums('v0', '900,1300,1700')) {
      const t0 = performance.now();
      const h = arg('hold', null);
      const r = SG.plateImpactScenario('upadek', { hz, v0, hold: h === null ? undefined : Number(h), cloud, disc });
      line({ tryb: 'dysk-upadek', hz, v0, dojscieD8: r3(r.tArrive), utrzymanie: r3(r.hold), sigma: r.sigma, przeszla: r.passed, predkoscZa: r.vPass ? Math.round(r.vPass) : null, otwory: r.disc.holes, row: r.disc.trench,
        iou: r3(r.iou), energia: Number(r.energyDisc.toExponential(3)), masaKorka: Math.round(r.accreted), graf: r.graph, ms: Math.round(performance.now() - t0) });
    }
  }
}

function threshold(hz) {
  console.log('\n## próg: jeden σ dla szyi i upadku (graf wyłączony)');
  const cloud = SG.towerPointCloud();
  const sig = nums('sigma', '2,4,6,8,10,14,20,40,60,80,100,120,160,200,300');
  const rows = [];
  for (const s of sig) {
    const row = { sigma: s };
    for (const v0 of nums('v0', '900,1300,1700')) row[`upadek${v0}`] = SG.plateImpactScenario('upadek', { hz, sigmaHeld: s, sigmaFree: s, v0, cloud, graph: false }).passed;
    for (const w of nums('omega', '0.55,0.7,0.85')) { const r = SG.plateImpactScenario('szyja', { hz, sigmaHeld: s, sigmaFree: s, omega0: w, cloud, graph: false }); row[`szyja${w}`] = `${r.disc.holes ? 'OTWÓR ' + r.disc.holes : 'trzyma'} (rów ${r.disc.trench}, ${r.endDeg.toFixed(0)}°)`; }
    rows.push(row); line(row);
  }
  const passMax = Math.max(...rows.filter((r) => r.upadek900).map((r) => r.sigma), -Infinity);
  const holdMin = Math.min(...rows.filter((r) => Object.keys(r).filter((k) => k.startsWith('szyja')).every((k) => r[k].startsWith('trzyma'))).map((r) => r.sigma), Infinity);
  line({ tryb: 'prog', upadek900PrzechodziDoSigma: passMax, szyjaTrzymaOdSigma: holdMin, jedenProgRozdziela: passMax >= holdMin,
    wniosek: passMax >= holdMin ? 'jeden próg wystarcza' : `luka ×${(holdMin / passMax).toFixed(0)} — próg od utrzymania (D8): sigmaHeld ${SG.PLATE_TUNE.sigmaHeld}, sigmaFree ${SG.PLATE_TUNE.sigmaFree}` });
}

function cost() {
  console.log('\n## koszt kroku (Node, 120 Hz, po rozgrzewce JIT)');
  const W2 = SG.buildHighriseArchetype({ seed: seed + 1, tune: T }), D = SG.buildDiscArchetype({ seed: 7, tune: T });
  const stats = (arr) => { const s = Float64Array.from(arr).sort(); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; let m = 0; for (const v of arr) m += v; return { srednio: r3(m / arr.length), p50: r3(q(0.5)), p95: r3(q(0.95)), p99: r3(q(0.99)), max: r3(s[s.length - 1]) }; };
  const scenario = (graphs, secs, hit) => {
    const S = graphs.map((A, i) => SG.createStructure(A, { id: i }));
    const times = [];
    for (let s = 0; s < secs * 120; s++) {
      for (let i = 0; i < S.length; i++) hit(S[i], s, i);
      const t0 = performance.now();
      for (let i = 0; i < S.length; i++) SG.stepStructure(S[i], 1 / 120, s);
      times.push(performance.now() - t0);
    }
    return { times, S };
  };
  const hitHr = (S, s) => { if (s % 30 === 0) { const y = ((s / 30) % 5 - 2) * 80; SG.structureDamageSphere(S, 190, y, 0, 60, 0.05); SG.structureHit(S, 190, y, 0, 1500, -1, 0, 0); } };
  const hitDisc = (S, s) => { if (s % 8 === 0) { const a = s * 0.01; const b = SG.structureNearestBlock(S, 1400 * Math.cos(a), 1400 * Math.sin(a), -880); if (b >= 0) SG.structureAddImpulse(S, b, 0, 0, -2e5 / 120); } };
  const hitAny = (S, s, i) => (S.arch.name === 'dysk' ? hitDisc(S, s) : hitHr(S, s));
  const rndH = SG.structureRng(4);
  const hitHeavy = (S, s) => { if (s % 6 === 0) SG.structureDamageBond(S, (rndH() * HR.e) | 0, 0.5 + rndH()); };
  for (let rep = 0; rep < 2; rep++) {
    const a = scenario([HR], 20, hitHr), b = scenario([D], 10, hitDisc), c = scenario([HR, W2, D], 10, hitAny), h = scenario([HR], 20, hitHeavy);
    if (!rep) continue;   // pierwszy przebieg — rozgrzewka
    line({ tryb: 'koszt', graf: 'wieżowiec pod ostrzałem', bloki: HR.n, wiazania: HR.e, ...stats(a.times), przebiegi: a.S[0].stats.passes, iteracjeNaPrzebieg: r3(a.S[0].stats.iters / a.S[0].stats.passes) });
    line({ tryb: 'koszt', graf: 'dysk pod obciążeniem ciągłym', bloki: D.n, wiazania: D.e, ...stats(b.times), przebiegi: b.S[0].stats.passes, iteracjeNaPrzebieg: r3(b.S[0].stats.iters / b.S[0].stats.passes) });
    line({ tryb: 'koszt', graf: 'W-1 + W-2 + dysk (fazy (id + tick) mod 4)', ...stats(c.times) });
    line({ tryb: 'koszt', graf: 'wieżowiec — ciężkie losowe uszkodzenia', ...stats(h.times), przebiegi: h.S[0].stats.passes, maksSeriaNiezbieznych: h.S[0].stats.maxPending });
  }
}

for (const mode of modes) {
  for (const hz of hzs) {
    if (mode === 'podciecie') { const st = arg('strona', null); for (const sign of st ? [Number(st)] : [1, -1]) undercut(sign, hz); }
    else if (mode === 'zawias') hingeStats(hz);
    else if (mode === 'ciezkie') heavy(hz);
    else if (mode === 'kondygnacja') { const L = Number(arg('poziom', 15)); storey('sym', L, hz, SG.STRUCT_TUNE.kappa); storey('ecc', L, hz, SG.STRUCT_TUNE.kappa); }
    else if (mode === 'front') { const L = Number(arg('poziom', 15)); console.log(`\n## front (kondygnacja ${L}, ${hz} Hz)`); for (const d of nums('gruz', '0.2,0.3')) for (const k of nums('kappa', '0.1,0.2,0.3,1')) storey('sym', L, hz, k, true, d); }
    else if (mode === 'dysk-szyja') plate('szyja', hz);
    else if (mode === 'dysk-upadek') plate('upadek', hz);
    else if (mode === 'prog') threshold(hz);
    else if (hz === hzs[0]) {
      if (mode === 'wspornik') cantilever();
      else if (mode === 'fala') wave();
      else if (mode === 'koszt') cost();
    }
  }
}
