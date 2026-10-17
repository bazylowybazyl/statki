// Analiza scripts/fizyka-kroki.mjs (2026-10-17, docs/AUDYT-fizyka-worker-2026-10-17.md): rozkład kosztu kroku fizyki na
// podsystemy w fazach bitwy (s od pojawienia się flot), rodzaje kroków (takt AI, integralność), klatki loop() z krokiem
// i bez, okresy rAF, model vsync (klatka = reszta pracy wątku + kroki; rAF w następnym vsync po końcu pracy).
//   node scripts/fizyka-kroki-analiza.mjs <kroki.json> [--fazy 0-35,35-70,70-999] [--vsync 144,165,240] [--okres 4.17]
//        (--okres: vsync okna w ms do liczenia klatek spóźnionych; domyślnie mediana okresu klatek bez kroku)
//   node scripts/fizyka-kroki-analiza.mjs --profil <plik.cpuprofile> --kroki 300 [--korzen physicsStep] [--glebokosc 2]
//        — drzewo physicsStep z profilu CPU: dzieci (total) i self w poddrzewie, ms na krok.
import { readFileSync } from 'node:fs';

const argOf = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv.includes('--profil')) { profil(argOf('profil')); process.exit(0); }
const file = process.argv[2];
const D = JSON.parse(readFileSync(file, 'utf8'));
const cols = D.cols, NC = cols.length, ci = Object.fromEntries(cols.map((c, i) => [c, i]));
const toRows = (flat) => { const out = []; for (let i = 0; i + NC <= flat.length; i += NC) out.push(flat.slice(i, i + NC)); return out; };
const calmRows = toRows(D.calm.rows), rows = toRows(D.dump.rows);
const spawnT = D.dump.spawnT;
const FAZY = String(argOf('fazy', '0-35,35-70,70-999')).split(',').map((s) => s.split('-').map(Number));
const q = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
const f2 = (v) => Number.isFinite(v) ? v.toFixed(2) : '–';
const f3 = (v) => Number.isFinite(v) ? v.toFixed(3) : '–';
const g = (r, k) => r[ci[k]] || 0;

// Kubełki rozłączne (ms na krok)
function parts(r) {
  const pre = g(r, 'preAiTime'), ai = g(r, 'aiTime'), proj = g(r, 'projectileTime'), dp = g(r, 'destructiblePrepTime'), de = g(r, 'destructorTime');
  const hp = g(r, 'hardpointTime'), hn = g(r, 'hudNavTime'), tot = g(r, 'physicsTime');
  const npcStep = g(r, 'aiNpcStepTime');
  const brains = g(r, 'aiNpcEnemyBrainTime') + g(r, 'aiNpcFriendlyBrainTime');
  return {
    'krok (całość)': tot,
    'świat, strefy, gospodarka': g(r, 'worldZoneTime'),
    'systemy gracza (kierowanie ogniem…)': g(r, 'playerSystemsTime'),
    'skan, radar, czujniki, CIC (1×/kl.)': g(r, 'scanUiTime'),
    'lot gracza, warp': g(r, 'playerFlightTime') - g(r, 'rocketStep'),
    'rakiety (lot)': g(r, 'rocketStep'),
    'odłamki, wraki (zimne, budżet)': g(r, 'wreckPrepTime'),
    'reszta przed AI': pre - g(r, 'worldZoneTime') - g(r, 'playerSystemsTime') - g(r, 'scanUiTime') - g(r, 'playerFlightTime') - g(r, 'wreckPrepTime'),
    'AI: eskadry, skrzydło, misje (20 Hz)': g(r, 'aiSquadsTime') + g(r, 'aiSupportWingTime') + g(r, 'aiPirateMissionTime'),
    'AI: mózgi (bez skanu broni i wyboru celu)': Math.max(0, brains - g(r, 'aiWeaponScanTime') - g(r, 'aiTargetPickTime')),
    'AI: skan broni + wybór celu': g(r, 'aiWeaponScanTime') + g(r, 'aiTargetPickTime'),
    'AI: siatka, separacja': g(r, 'aiNpcGridTime') + g(r, 'aiSeparationTime'),
    'AI: lot NPC i reszta npcStep': g(r, 'aiNpcOtherTime'),
    'AI: reszta': ai - g(r, 'aiSquadsTime') - g(r, 'aiSupportWingTime') - g(r, 'aiPirateMissionTime') - npcStep,
    'PD gracza (ciwsStep)': g(r, 'ciwsTime'),
    'pociski i trafienia': proj - g(r, 'ciwsTime') - g(r, 'npcFireTime'),
    'strzały NPC (npcShootingStep)': g(r, 'npcFireTime'),
    'kolizje: pas, komety, ring, wydobycie, holowanie': tot - pre - ai - proj - dp - de - hp - hn,
    'listy ciał, budzenie wraków': dp,
    'silnik belek (HullBodies.step)': g(r, 'hbStep'),
    '  w tym kolizje belek': g(r, 'collisionTime'),
    'ciała świata (worldBodies.step)': g(r, 'wbStep'),
    'naprawa, baza, rdzenie': de - g(r, 'hbStep') - g(r, 'wbStep'),
    'integralność gniazd (co 3. krok)': hp,
    'HUD nawigacji': hn
  };
}

function phaseRows(lo, hi) { return rows.filter((r) => { const t = (g(r, 't') - spawnT) / 1000; return t >= lo && t < hi; }); }

function table(sets) {
  const names = Object.keys(parts(rows[0] || new Array(NC).fill(0)));
  const head = sets.map((s) => s.label.padStart(16)).join('');
  console.log(`${'ms na krok (średnia)'.padEnd(48)}${head}`);
  for (const n of names) {
    const line = sets.map((s) => f3(mean(s.rows.map((r) => parts(r)[n]))).padStart(16)).join('');
    console.log(`${n.padEnd(48)}${line}`);
  }
  const extra = [
    ['p50 kroku', (rs) => q(rs.map((r) => g(r, 'physicsTime')), 0.5)],
    ['p90 kroku', (rs) => q(rs.map((r) => g(r, 'physicsTime')), 0.9)],
    ['p99 kroku', (rs) => q(rs.map((r) => g(r, 'physicsTime')), 0.99)],
    ['max kroku', (rs) => q(rs.map((r) => g(r, 'physicsTime')), 1)],
    ['kroków', (rs) => rs.length],
    ['NPC (śr.)', (rs) => mean(rs.map((r) => g(r, 'npc')))],
    ['pociski (śr.)', (rs) => mean(rs.map((r) => g(r, 'bullets')))],
    ['wraki (śr.)', (rs) => mean(rs.map((r) => g(r, 'wrecks')))]
  ];
  for (const [n, fn] of extra) console.log(`${n.padEnd(48)}${sets.map((s) => f2(fn(s.rows)).padStart(16)).join('')}`);
}

console.log(`plik ${file} | skład ${D.sklad} zoom ${D.zoom} tryb ${D.tryb} physHz ${D.physHz} | kroków ${rows.length}`);
const sets = [{ label: 'spokój', rows: calmRows }, ...FAZY.map(([lo, hi]) => ({ label: `t ${lo}–${hi > 900 ? 'koniec' : hi} s`, rows: phaseRows(lo, hi) }))];
table(sets);

// Kroki wg rodzaju: z taktem AI / bez, pierwszy w klatce / kolejny, integralność (faza mod 3 o największym hardpointTime)
console.log('\n== rodzaje kroków (walka: t ≥ 35 s)');
const fight = rows.filter((r) => (g(r, 't') - spawnT) / 1000 >= 35);
const idxOf = new Map(rows.map((r, i) => [r, i]));
let integ = 0, best = -1;
for (let m = 0; m < 3; m++) { const v = mean(fight.filter((r) => idxOf.get(r) % 3 === m).map((r) => g(r, 'hardpointTime'))); if (v > best) { best = v; integ = m; } }
const kinds = [
  ['z taktem AI (20 Hz)', fight.filter((r) => g(r, 'aiTick') === 1)],
  ['bez taktu AI', fight.filter((r) => g(r, 'aiTick') === 0)],
  ['pierwszy w klatce', fight.filter((r) => g(r, 'first') === 1)],
  ['kolejny w klatce', fight.filter((r) => g(r, 'first') === 0)],
  ['z integralnością', fight.filter((r) => idxOf.get(r) % 3 === integ)],
  ['bez integralności', fight.filter((r) => idxOf.get(r) % 3 !== integ)]
];
for (const [n, rs] of kinds) {
  const v = rs.map((r) => g(r, 'physicsTime'));
  console.log(`  ${n.padEnd(22)} n ${String(rs.length).padStart(5)}  śr ${f2(mean(v))}  p50 ${f2(q(v, 0.5))}  p95 ${f2(q(v, 0.95))}  max ${f2(q(v, 1))}  | AI ${f2(mean(rs.map((r) => g(r, 'aiTime'))))}  integr. ${f2(mean(rs.map((r) => g(r, 'hardpointTime'))))}`);
}

// Klatki pętli (loop): [ms wywołania loop, kroków, ms fizyki, t]
const loop = D.dump.loop.filter((f) => (f[3] - spawnT) / 1000 >= 35);
const byK = new Map();
for (const f of loop) { const k = Math.min(3, f[1]); if (!byK.has(k)) byK.set(k, []); byK.get(k).push(f); }
console.log(`\n== klatki loop() w walce (t ≥ 35 s): ${loop.length}; ms wywołania loop / bez fizyki`);
for (const [k, fs] of [...byK.entries()].sort((a, b) => a[0] - b[0])) {
  const all = fs.map((f) => f[0]), np = fs.map((f) => f[0] - f[2]);
  console.log(`  kroków ${k}: ${String(fs.length).padStart(6)} (${(100 * fs.length / loop.length).toFixed(1)}%)  loop p50 ${f2(q(all, 0.5))} p95 ${f2(q(all, 0.95))} max ${f2(q(all, 1))}  | bez fizyki p50 ${f2(q(np, 0.5))} p95 ${f2(q(np, 0.95))}`);
}
const nonPhys = loop.map((f) => f[0] - f[2]);
const physPerFrame = mean(loop.map((f) => f[2]));
console.log(`  średnio na klatkę: loop ${f2(mean(loop.map((f) => f[0])))} ms, fizyka ${f2(physPerFrame)} ms, reszta ${f2(mean(nonPhys))} ms`);

// Odstępy rAF (cały wątek: wszystkie wywołania rAF) i CPU klatki
const fw = D.dump.fw.filter((f) => (f[2] - spawnT) / 1000 >= 35);
const per = fw.map((f) => f[0]), cpu = fw.map((f) => f[1]);
console.log(`\n== rAF w walce: klatek ${fw.length}, okres p50 ${f2(q(per, 0.5))} p95 ${f2(q(per, 0.95))} p99 ${f2(q(per, 0.99))} max ${f2(q(per, 1))}; CPU rAF p50 ${f2(q(cpu, 0.5))} p95 ${f2(q(cpu, 0.95))}`);
// Okres rAF klatki z krokiem i bez (dopasowanie po czasie: okres klatki k zapisuje się na początku klatki k+1, po końcu
// jej loop()). W oknie z vsync okres = wielokrotność vsynca — odsetek ≥ 1,5 vsynca to klatki spóźnione. W headless bez
// limitu klatek znaczniki rAF to kolejne BeginFrame (zlecane, zanim skończy się praca klatki) — okresy tam nic nie znaczą.
{
  const withStep = [], noStep = [];
  let j = 0;
  for (const f of loop) {
    while (j < fw.length && fw[j][2] < f[3]) j++;
    if (j >= fw.length) break;
    (f[1] > 0 ? withStep : noStep).push(fw[j][0]);
  }
  const vs = Number(argOf('okres', 0)) || q(noStep, 0.5);
  const late = (a) => a.length ? (100 * a.filter((p) => p > 1.5 * vs).length / a.length).toFixed(1) : '–';
  console.log(`   okres rAF (vsync ~${f2(vs)} ms): klatki z krokiem n ${withStep.length} p50 ${f2(q(withStep, 0.5))} p95 ${f2(q(withStep, 0.95))} — ≥ 1,5 vsynca ${late(withStep)}% | bez kroku n ${noStep.length} p50 ${f2(q(noStep, 0.5))} p95 ${f2(q(noStep, 0.95))} — ${late(noStep)}% | wszystkie ${late(withStep.concat(noStep))}%`);
}
const lt = D.dump.lt.filter((e) => (e[0] - (spawnT - 0)) / 1000 >= 0);
console.log(`   longtask (> 50 ms) w całej bitwie: ${lt.length}, max ${f2(Math.max(0, ...lt.map((e) => e[1])))} ms`);

// Model vsync: wątek gry z vsync R Hz — klatka bez kroku = losowa „reszta” z klatek 0-krokowych, krok fizyki = kolejne
// kroki zmierzone (koszt całego kroku); rAF w następnym vsync po końcu pracy. Wynik: klatki na s, odsetek okresów > 1 vsync.
const VS = String(argOf('vsync', '144,165,240')).split(',').map(Number);
const rest0 = (byK.get(0) || []).map((f) => f[0]);
const stepCosts = fight.map((r) => g(r, 'physicsTime'));
function simulate(R, scaleStep = 1, restCosts = rest0) {
  const T = 1000 / R, PH = 1000 / 60;
  let t = 0, acc = 0, si = 0, frames = 0, long = 0, last = 0, vs = 0;
  let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  const periods = [];
  while (t < 60000) {
    const dtF = Math.min(33, t - last || T); last = t;
    acc += dtF;
    let work = restCosts[Math.floor(rnd() * restCosts.length)] || 2;
    let k = 0;
    while (acc >= PH && k < 10) { work += stepCosts[si++ % stepCosts.length] * scaleStep; acc -= PH; k++; }
    const end = t + work;
    const next = Math.ceil(end / T + 1e-9) * T;
    periods.push(next - t);
    if (next - t > T + 0.01) long++;
    t = next; frames++;
  }
  return { fps: frames / 60, dlugie: long / frames, p95: q(periods, 0.95) };
}
console.log('\n== MODEL vsync (wątek gry; klatka = reszta pracy + kroki fizyki, rAF w następnym vsync)');
for (const R of VS) {
  const a = simulate(R), b = simulate(R, 0);
  console.log(`  ${String(R).padStart(3)} Hz: dziś ${f2(a.fps)} kl/s, okresów > 1 vsync ${(100 * a.dlugie).toFixed(1)}%, p95 ${f2(a.p95)} ms | bez fizyki na wątku ${f2(b.fps)} kl/s, > 1 vsync ${(100 * b.dlugie).toFixed(1)}%`);
}

// --profil: drzewo physicsStep z profilu CPU (Profiler CDP, .cpuprofile z --profile skryptu pomiarowego)
function profil(file) {
  const STEPS = Number(argOf('kroki', 1));
  const ROOT = argOf('korzen', 'physicsStep');
  const DEPTH = Number(argOf('glebokosc', 2));
  const p = JSON.parse(readFileSync(file, 'utf8'));
  const nodes = new Map();
  for (const n of p.nodes) nodes.set(n.id, { ...n, self: 0, total: 0, parent: null });
  for (const n of nodes.values()) for (const c of (n.children || [])) nodes.get(c).parent = n;
  for (let i = 0; i < p.samples.length; i++) nodes.get(p.samples[i]).self += (p.timeDeltas[i + 1] ?? p.timeDeltas[i]) / 1000;
  const totalOf = (n) => { let t = n.self; for (const c of (n.children || [])) t += totalOf(nodes.get(c)); n.total = t; return t; };
  for (const n of nodes.values()) if (!n.parent) totalOf(n);
  const name = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
  const inRoot = (n) => { for (let q = n; q; q = q.parent) if (q.callFrame.functionName === ROOT) return q; return null; };
  // korzenie (nie zagnieżdżone w innym korzeniu)
  const roots = [...nodes.values()].filter((n) => n.callFrame.functionName === ROOT && !(n.parent && inRoot(n.parent)));
  const rootTotal = roots.reduce((s, n) => s + n.total, 0);
  const dur = (p.endTime - p.startTime) / 1e6;
  console.log(`${file.split(/[\\/]/).pop()}: profil ${dur.toFixed(1)} s, ${ROOT} ${rootTotal.toFixed(1)} ms = ${(rootTotal / STEPS).toFixed(3)} ms/krok (kroków ${STEPS})`);
  // dzieci do głębokości DEPTH, scalone po nazwie
  function agg(level, list) {
    const m = new Map();
    for (const n of list) for (const c of (n.children || [])) { const cn = nodes.get(c); const k = name(cn); const e = m.get(k) || { t: 0, nodes: [] }; e.t += cn.total; e.nodes.push(cn); m.set(k, e); }
    return [...m.entries()].sort((a, b) => b[1].t - a[1].t);
  }
  function show(list, depth, indent) {
    const kids = agg(depth, list);
    let shown = 0;
    for (const [k, e] of kids) {
      if (e.t / STEPS < 0.01 || shown > 22) continue; shown++;
      console.log(`${indent}${(e.t / STEPS).toFixed(3).padStart(7)}  ${k}`);
      if (depth < DEPTH) show(e.nodes, depth + 1, indent + '    ');
    }
  }
  show(roots, 1, '  ');
  // self w poddrzewie
  const self = new Map();
  for (const n of nodes.values()) { if (!inRoot(n)) continue; const k = name(n); self.set(k, (self.get(k) || 0) + n.self); }
  console.log(`\n  najwięcej self w ${ROOT} (ms/krok):`);
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${(v / STEPS).toFixed(3).padStart(7)}  ${k}`);
}
