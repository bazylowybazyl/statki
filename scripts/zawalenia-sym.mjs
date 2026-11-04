// ZAWALENIA BUDOWLI w Node — sceny dema D20 (dema/zawalenia-budowli/scenariusze.js) na gospodarzu
// src/game/structureCollapse.js i prawdziwym HullBodies, bez przeglądarki (docs/PLAN-zawalenia-budowli-3d.md, synteza dema
// § 7 (2)). Liczby = to, co pokazuje demo (ten sam kod sceny: dema/zawalenia-budowli/symulacja.js). Narzędzie zostaje na E5.
//
//   node scripts/zawalenia-sym.mjs [--scena 1,2,3] [--g 400,80] [--hz 60,120] [--strona +x|-x|+y|-y] [--kappa 0.2]
//     [--tlumienie 0|1] [--czas 25] [--json] [--zakleszczenie 8] [--pomost -y@4] [--set klucz=wartość,…] [--log 1]
//
//   --g          g WIEŻY OSTATNIEJ w scenie (scena 1: prawa; lewa zostaje 400); lista → osobne przebiegi
//   --tlumienie  0 — klastry bez tłumienia obrotu, 1 — tłumienie silnika 0,2/s (A/B tempa D12); domyślnie 1
//   --zakleszczenie N — kontrola przechyłu: N ziaren salwy × 4 strony (scena 1, tylko wieża ostatnia): czy przegub pęka
//                  (kąt / zastój), przechył najwyższy, dach na ziemi
//   --pomost s@t — D13: w chwili t [s] pomost puszcza od strony s
//   --set        nadpisania COLLAPSE_TUNE gospodarza (np. impactDv=30,stallTime=1.5)
//   --log 1      zdarzenia osi czasu na bieżąco
// Wynik: oś czasu każdej wieży (oderwanie, zawias, przechył w czasie, pęknięcie przegubu, poziomy frontu, dach na ziemi),
// kawałki i klastry, gruz, kolejka wysp, najgłębsze wejście pod podłoże, koszt kroku p50 / p95 / max: fizyka
// (HullBodies.step), gospodarz (collapseStep: graf + uzgadnianie + wyspy), razem. Czasy względem startu symulacji i pokazu
// (przewinięcie sceny pod kurtyną dema).
globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { createScenaSym } = await import('../dema/zawalenia-budowli/symulacja.js');
const { collapseTimeline, collapseStats, collapseProbe } = await import('../src/game/structureCollapse.js');
HullBodies.init();
HullBodies.warmUpClusters();

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : f; };
const list = (n, f) => String(arg(n, f)).split(',').filter(Boolean);
const JSON_OUT = process.argv.includes('--json');
const LOG = arg('log', '0') === '1';
const SCENY = list('scena', '1').map(Number);
const GS = arg('g', null) ? list('g').map(Number) : [null];
const HZ = list('hz', '60').map(Number);
const CZAS = arg('czas', null) !== null ? Number(arg('czas')) : null;
const STRONA = arg('strona', null);
const KAPPA = arg('kappa', null) !== null ? list('kappa').map(Number) : [null];
const TLUM = list('tlumienie', '1').map(Number);
const ZAKL = Number(arg('zakleszczenie', 0)) | 0;
const POMOST = arg('pomost', null);
// --kontakt 0 — A/B: tłumienie styku klastrów wyłączone (D.rigidConfig.restDamp, rollDamp, teren restAngDamp) — ile tempa
// przechyłu i przewrócenia zjada tłumienie spoczynku / toczenia silnika (E2), a ile tłumienie obrotu ciała (--tlumienie)
const KONTAKT = arg('kontakt', '1') !== '0';
if (!KONTAKT) { HullBodies.engine.rigidConfig.restDamp = 0; HullBodies.engine.rigidConfig.rollDamp = 0; }
const tune = {};
for (const kv of list('set', '')) { const [k, v] = kv.split('='); tune[k] = Number(v); }
const r2 = (v) => (v === null || v === undefined || v < 0 || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const out = (o) => console.log(JSON.stringify(o));
const pct = (a, p) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const now = () => performance.now();

function run(nr, o) {
  const sym = createScenaSym(HullBodies, nr, { hz: o.hz, g: o.g ?? undefined, strona: o.strona || undefined, kappa: o.kappa ?? undefined,
    tlumienie: o.tlumienie, tune, ziarno: o.ziarno });
  if (!KONTAKT) sym.terrain.restAngDamp = 0;
  const czas = o.czas ?? (CZAS ?? sym.cfg.czas);
  const pom = POMOST ? POMOST.split('@') : null;
  const tPhys = [], tHost = [], tAll = [];
  let maxDepth = 0, maxClusters = 0, maxAwake = 0, rest = -1;
  const seen = sym.hosts.map(() => ({ detach: false, hinge: false, joint: false, nf: 0, roof: false, fe: false }));
  const probe = { depth: 0, clusters: 0 };
  const steps = Math.round(czas * sym.hz);
  for (let s = 0; s < steps; s++) {
    if (pom && Math.abs(sym.t - Number(pom[1])) < sym.dt / 2) sym.pomost(pom[0]);
    const t0 = now();
    sym.drive(); sym.pre();
    const t1 = now();
    sym.physics();
    const t2 = now();
    sym.post();
    const t3 = now();
    tPhys.push(t2 - t1); tHost.push(t3 - t2 + (t1 - t0)); tAll.push(t3 - t0);
    if (s % 6 === 0) {
      let cl = 0, aw = 0;
      for (const h of sym.hosts) { collapseProbe(h, probe); if (probe.depth > maxDepth) maxDepth = probe.depth; const st = collapseStats(h); cl += st.clusters; aw += st.awake; }
      if (cl > maxClusters) maxClusters = cl;
      if (aw > maxAwake) maxAwake = aw;
      if (aw === 0 && rest < 0 && sym.hosts.every((h) => collapseTimeline(h).detach >= 0)) rest = sym.t;
      if (aw > 0) rest = -1;
    }
    if (LOG) {
      sym.hosts.forEach((h, i) => {
        const tl = collapseTimeline(h), z = seen[i], nm = h.name;
        if (!z.detach && tl.detach >= 0) { z.detach = true; console.log(`${tl.detach.toFixed(2)} s  [${nm}] oderwanie`); }
        if (!z.hinge && tl.hinge >= 0) { z.hinge = true; console.log(`${tl.hinge.toFixed(2)} s  [${nm}] zawias`); }
        if (!z.joint && tl.jointBroken >= 0) { z.joint = true; console.log(`${tl.jointBroken.toFixed(2)} s  [${nm}] przegub pęka (${tl.breakMode}) przy ${tl.jointTilt.toFixed(1)}°`); }
        while (z.nf < tl.frontLevels.length) { const f = tl.frontLevels[z.nf++]; console.log(`${f.t.toFixed(2)} s  [${nm}] FRONT poziom ${f.level}`); }
        if (!z.fe && tl.frontEnd >= 0) { z.fe = true; console.log(`${tl.frontEnd.toFixed(2)} s  [${nm}] koniec frontu (${tl.frontEndKind})`); }
        if (!z.roof && tl.roofGround >= 0) { z.roof = true; console.log(`${tl.roofGround.toFixed(2)} s  [${nm}] dach na ziemi`); }
      });
      if (s % sym.hz === 0) console.log(`${sym.t.toFixed(1)} s  ` + sym.hosts.map((h) => { const st = collapseStats(h), tl = collapseTimeline(h); const tt = tl.tilt.length ? tl.tilt[tl.tilt.length - 1][1] : 0; return `[${h.name}] klastry ${st.clusters} (ruch ${st.awake}) przechył ${tt.toFixed(1)}° kolejka ${st.queue}`; }).join('  '));
    }
  }
  const przewin = sym.cfg.przewin || 0;
  const wieze = sym.hosts.map((h, i) => {
    const tl = collapseTimeline(h), st = collapseStats(h);
    const tiltAt = (t) => { let v = 0; for (const [a, b] of tl.tilt) { if (a > t) break; v = b; } return Math.round(v * 10) / 10; };
    const tilt = {};
    for (const t of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15]) if (t <= czas) tilt[t] = tiltAt(t);
    return {
      wieza: h.name, g: h.A.g,
      oderwanie: r2(tl.detach), zawias: r2(tl.hinge), przegub: r2(tl.jointBroken), przegubKat: tl.jointTilt >= 0 ? Math.round(tl.jointTilt * 10) / 10 : null,
      przegubTryb: tl.breakMode || null, przechyl40: r2(tl.tilt40), przechylMax: Math.round(tl.maxTilt * 10) / 10,
      frontStart: r2(tl.frontStart), frontPoziomy: tl.frontLevels.map((f) => f.level), frontKoniec: r2(tl.frontEnd), frontKoniecTyp: tl.frontEndKind || null,
      dach: r2(tl.roofGround), dachOdOderwania: tl.roofGround >= 0 && tl.detach >= 0 ? r2(tl.roofGround - tl.detach) : null,
      dachOdPokazu: tl.roofGround >= 0 ? r2(tl.roofGround - przewin) : null, oderwanieOdPokazu: tl.detach >= 0 ? r2(tl.detach - przewin) : null,
      przechylWCzasie: tilt,
      klastry: st.clusters, spiace: st.sleeping, zamrozone: st.frozen, ruch: st.awake, narodziny: st.births, gruz: st.debris, kopniecia: st.kicks,
      wyspyRozw: st.solves, wyspyOk: st.solveOk, wyspyPorzucone: st.solveDropped, kolejka: st.queued, przeguby: st.joints, zastoje: st.stalls,
      fronty: st.fronts, czekanie: st.pendingSteps, sufit: st.clusterCap, przepelnienie: st.overflow, rekordy: st.records
    };
  });
  const res = {
    scena: nr, hz: sym.hz, tlumienie: o.tlumienie, strona: sym.cfg.bateria ? sym.cfg.bateria.strona : null, kappa: sym.cfg.kappa,
    czas, strzaly: sym.strzaly(), spoczynek: r2(rest), wieze,
    klastryMax: maxClusters, ruchMax: maxAwake, glebiaPodPodlozem: Math.round(maxDepth * 100) / 100,
    kosztMs: {
      fizyka: { p50: +pct(tPhys, 0.5).toFixed(3), p95: +pct(tPhys, 0.95).toFixed(3), max: +Math.max(...tPhys).toFixed(2) },
      gospodarz: { p50: +pct(tHost, 0.5).toFixed(3), p95: +pct(tHost, 0.95).toFixed(3), max: +Math.max(...tHost).toFixed(2) },
      razem: { p50: +pct(tAll, 0.5).toFixed(3), p95: +pct(tAll, 0.95).toFixed(3), max: +Math.max(...tAll).toFixed(2), srednio: +(tAll.reduce((a, b) => a + b, 0) / tAll.length).toFixed(3) }
    }
  };
  sym.dispose();
  return res;
}

function show(r) {
  if (JSON_OUT) { out(r); return; }
  console.log(`\n## scena ${r.scena}, ${r.hz} Hz, tłumienie ${r.tlumienie ? 'silnika' : '0'}, strona ${r.strona}, κ ${r.kappa ?? '—'} — ${r.strzaly} strzałów, spoczynek ${r.spoczynek ?? '—'} s`);
  for (const w of r.wieze) {
    console.log(`  [${w.wieza} g ${w.g}] oderwanie ${w.oderwanie ?? '—'} s (pokaz ${w.oderwanieOdPokazu ?? '—'}), zawias ${w.zawias ?? '—'}, przegub ${w.przegub ?? '—'} s (${w.przegubTryb ?? '—'}, ${w.przegubKat ?? '—'}°), 40° ${w.przechyl40 ?? '—'}, max ${w.przechylMax}°`);
    console.log(`     front ${w.frontStart ?? '—'} s → [${w.frontPoziomy.join(' ')}] → ${w.frontKoniec ?? '—'} s (${w.frontKoniecTyp ?? '—'}); DACH NA ZIEMI ${w.dach ?? '—'} s (od oderwania ${w.dachOdOderwania ?? '—'}, pokaz ${w.dachOdPokazu ?? '—'})`);
    console.log(`     przechył: ${Object.entries(w.przechylWCzasie).map(([t, v]) => `${t}s ${v}°`).join(', ')}`);
    console.log(`     klastry ${w.klastry} (śpi ${w.spiace}, zamr. ${w.zamrozone}, ruch ${w.ruch}), narodziny ${w.narodziny}, gruz ${w.gruz}, kopnięcia ${w.kopniecia}, wyspy ${w.wyspyOk}/${w.wyspyRozw} (porz. ${w.wyspyPorzucone}), zastoje ${w.zastoje}, czekanie ${w.czekanie}, sufit ${w.sufit}`);
  }
  const k = r.kosztMs;
  console.log(`  klastry max ${r.klastryMax}, w ruchu max ${r.ruchMax}, głębia pod podłożem ${r.glebiaPodPodlozem} r; koszt ms: fizyka ${k.fizyka.p50}/${k.fizyka.p95}/${k.fizyka.max}, gospodarz ${k.gospodarz.p50}/${k.gospodarz.p95}/${k.gospodarz.max}, razem ${k.razem.p50}/${k.razem.p95}/${k.razem.max} (śr. ${k.razem.srednio})`);
}

if (ZAKL > 0) {
  // kontrola zakleszczenia: N ziaren salwy × 4 strony, scena 1 (raport z wieży ostatniej — g z --g)
  const rows = [];
  for (const strona of ['+x', '-x', '+y', '-y']) {
    for (let z = 1; z <= ZAKL; z++) {
      for (const g of GS) for (const hz of HZ) for (const tl of TLUM) {
        const r = run(1, { hz, g, strona, tlumienie: tl, czas: CZAS ?? 16, ziarno: 100 + z });
        const w = r.wieze[r.wieze.length - 1];
        rows.push({ strona, ziarno: 100 + z, g: w.g, hz, oderwanie: w.oderwanie, przegub: w.przegubTryb, kat: w.przegubKat, max: w.przechylMax, dach: w.dach, front: w.frontPoziomy.length, glebia: r.glebiaPodPodlozem });
        if (JSON_OUT) out(rows[rows.length - 1]); else console.log(JSON.stringify(rows[rows.length - 1]));
      }
    }
  }
  const tally = { kat: 0, zastoj: 0, brak: 0, bezDachu: 0 };
  for (const r of rows) { if (r.przegub === 'kat') tally.kat++; else if (r.przegub === 'zastoj') tally.zastoj++; else tally.brak++; if (r.dach === null) tally.bezDachu++; }
  out({ zakleszczenie: tally, przebiegi: rows.length });
} else {
  for (const nr of SCENY) for (const g of GS) for (const hz of HZ) for (const tl of TLUM) for (const kappa of KAPPA) {
    show(run(nr, { hz, g, strona: STRONA, kappa, tlumienie: tl }));
  }
}
