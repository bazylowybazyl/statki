// Składa docs/webgpu/baseline.json z przebiegu bazowego WebGL (scripts/webgpu/zrzuty.mjs --powtorz 2
// --wydajnosc), sondy środowiska (srodowisko.mjs) i pomiaru drżenia (dema/precyzja-drzenie.js).
//
//   node scripts/webgpu/baza.mjs [--baza .tmp/webgpu/baseline] [--srodowisko .tmp/webgpu/srodowisko.json]
//        [--drzenie .tmp/webgpu/baseline/drzenie/drzenie.json] [--out docs/webgpu/baseline.json]
//        [--nowa-tolerancja]
//
// Tolerancja portu skalibrowana w zadaniu 02 zostaje przy przebudowie (bierze ją z istniejącego pliku);
// --nowa-tolerancja wraca do wartości wstępnej.
//
// Nowa scena bazy (zadania 16–18 i późniejsze) — bez przebudowy całości:
//   node scripts/webgpu/baza.mjs --dopisz <katalog przebiegu>
// <katalog przebiegu> = --out przebiegu `zrzuty.mjs --backend webgl --powtorz 2 --sceny …` zrobionego w worktree
// z tagu webgl-baseline (docs/webgpu/README.md). Dopisuje sceny do baseline.json, kopiuje ich PNG do
// <baza>/webgl/p1 i p2 oraz dokleja wiersze do <baza>/webgl/p1/wyniki.json i szum-p1-p2/porownanie.json
// (pełna przebudowa później ich nie zgubi).
import { readFileSync, existsSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, writeJson, repo } from './wspolne.mjs';

const args = parseArgs();
const baza = resolve(repo, args.baza || '.tmp/webgpu/baseline');
const outFile = args.out || 'docs/webgpu/baseline.json';
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const git = (...a) => { try { return execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; } };
const TOLERANCJA_WSTEPNA = { roznePct8: 2.0, srednia: 1.0, stan: 'wstępna — do kalibracji w zadaniu 02' };

const noiseOf = (szum) => Object.fromEntries(szum.sceny.map((s) => [s.scena, { roznePct2: s.roznePct2, roznePct8: s.roznePct8, roznePct32: s.roznePct32, srednia: s.srednia, maks: s.maks }]));

// Wpisy scen (i ich wariantów „jedna warstwa”) z wierszy wyniki.json przebiegu.
function sceneEntries(rows, noise) {
  const sceny = {};
  for (const r of rows) {
    if (!r.scena) continue;
    sceny[r.scena] = {
      opis: r.opis,
      sesja: r.sesja,
      szum: noise[r.scena] || null,
      drawCalls: r.perf?.drawCalls ?? null,
      trojkaty: r.perf?.triangles ?? null,
      passy: r.perf?.passes ?? null,
      coreRenderMs: r.perf?.coreRenderMs ?? null,
      gpuMs: r.perf?.gpuMs ?? null,
      hdr: r.hdr,
      stan: r.stan ? { kroki: r.stan.kroki, npc: r.stan.npc, wraki: r.stan.wraki, pociski: r.stan.pociski, kamera: r.stan.kamera, suma: r.stan.suma } : null,
      spis: r.spis
    };
    // warianty „jedna warstwa” (scena__wariant.png) — sam szum
    for (const [name, n] of Object.entries(noise)) if (name.startsWith(`${r.scena}__`)) sceny[name] = { wariantSceny: r.scena, szum: n };
  }
  return sceny;
}

if (args.dopisz) {
  const dir = resolve(repo, args.dopisz);
  const run = read(join(dir, 'webgl', 'p1', 'wyniki.json'));
  const runSzum = read(join(dir, 'webgl', 'szum-p1-p2', 'porownanie.json'));
  const existing = read(resolve(repo, outFile));
  if (!run || !runSzum) { console.log(`brak ${join(dir, 'webgl', 'p1', 'wyniki.json')} albo szum-p1-p2 (przebieg musi mieć --powtorz 2)`); process.exit(2); }
  if (!existing) { console.log(`brak ${outFile} — najpierw pełna baza`); process.exit(2); }
  if (run.sceny.some((r) => r.renderer && r.renderer !== 'webgl')) { console.log('przebieg nie jest na WebGL (pole renderer) — baza tylko z tagu webgl-baseline'); process.exit(2); }
  const nowe = sceneEntries(run.sceny, noiseOf(runSzum));
  const nazwy = Object.keys(nowe);
  if (!nazwy.length) { console.log('przebieg nie ma scen'); process.exit(2); }
  for (const n of nazwy) if (existing.sceny[n]) console.log(`nadpisuję scenę ${n}`);
  Object.assign(existing.sceny, nowe);
  existing.dopisane = [...(existing.dopisane || []), { kiedy: new Date().toISOString(), commitPrzebiegu: run.commit, sceny: nazwy, polecenie: `node scripts/webgpu/baza.mjs --dopisz ${args.dopisz}` }];

  // PNG i wiersze do katalogów bazy (porównanie --baza i pełna przebudowa widzą nowe sceny).
  const glowne = run.sceny.filter((r) => r.scena).map((r) => r.scena);
  const nalezy = (f) => glowne.some((s) => f === `${s}.png` || f.startsWith(`${s}__`));
  for (const p of ['p1', 'p2']) {
    const src = join(dir, 'webgl', p);
    const dst = join(baza, 'webgl', p);
    mkdirSync(dst, { recursive: true });
    for (const f of readdirSync(src).filter((x) => x.endsWith('.png') && nalezy(x))) copyFileSync(join(src, f), join(dst, f));
  }
  const bazaWyniki = read(join(baza, 'webgl', 'p1', 'wyniki.json'));
  if (bazaWyniki) {
    bazaWyniki.sceny = [...bazaWyniki.sceny.filter((r) => !glowne.includes(r.scena)), ...run.sceny.filter((r) => r.scena)];
    writeJson(join(baza, 'webgl', 'p1', 'wyniki.json'), bazaWyniki);
  }
  const bazaSzum = read(join(baza, 'webgl', 'szum-p1-p2', 'porownanie.json'));
  if (bazaSzum) {
    bazaSzum.sceny = [...bazaSzum.sceny.filter((s) => !nazwy.includes(s.scena)), ...runSzum.sceny.filter((s) => nazwy.includes(s.scena))];
    writeJson(join(baza, 'webgl', 'szum-p1-p2', 'porownanie.json'), bazaSzum);
  }
  const file = writeJson(outFile, existing);
  console.log('dopisano do', file, '—', nazwy.join(', '));
  process.exit(0);
}

const p1 = read(join(baza, 'webgl', 'p1', 'wyniki.json'));
const szum = read(join(baza, 'webgl', 'szum-p1-p2', 'porownanie.json'));
const wyd = read(join(baza, 'webgl', 'wydajnosc.json'));
const env = read(resolve(repo, args.srodowisko || '.tmp/webgpu/srodowisko.json'));
const drz = read(resolve(repo, args.drzenie || join(baza, 'drzenie', 'drzenie.json')));
const poprzedni = read(resolve(repo, outFile));
if (!p1 || !szum) { console.log('brak wyników bazy (p1/wyniki.json, szum-p1-p2/porownanie.json)'); process.exit(2); }

const sceny = sceneEntries(p1.sceny, noiseOf(szum));

const adapter = env?.page?.adapters?.['high-performance'];
const drzenie = drz ? Object.fromEntries(drz.results.map((x) => [x.id, x.jitterRmsPx === undefined ? { uwaga: x.note || 'brak' } : { rms: x.jitterRmsPx, maks: x.jitterMaxPx }])) : null;

const out = {
  opis: 'Baza odniesienia portu WebGPU: gra na starym WebGLRenderer (tag webgl-baseline), 1920×1080, harness scripts/webgpu/zrzuty.mjs. PNG w .tmp/webgpu/baseline/webgl/p1 (nie w repo) — odtwarzalne z tagu.',
  utworzono: new Date().toISOString(),
  tag: 'webgl-baseline',
  commitPrzebiegu: p1.commit,
  // Kod gry bazy (tag) i tryb losowania UUID three w harnessie: „osobne” = własny strumień UUID (od zadania 01 —
  // węzły TSL zużywały Math.random gry i przesuwały świat), „wspolne” = pierwsza baza z Fazy 0.
  kodGry: args['kod-gry'] || poprzedni?.kodGry || 'tag webgl-baseline (kod gry d57cbdd)',
  losowanieUuid: p1.losowanieUuid || 'wspolne',
  commitZapisu: git('rev-parse', '--short', 'HEAD'),
  polecenie: 'node scripts/webgpu/zrzuty.mjs --backend webgl --powtorz 2 --wydajnosc --out .tmp/webgpu/baseline',
  katalogPng: '.tmp/webgpu/baseline/webgl/p1',
  rozdzielczosc: p1.rozmiar,
  seed: p1.seed,
  srodowisko: env ? {
    system: env.os, cpu: env.cpu, ramGB: env.ramGB, node: env.node, chrome: env.chrome, three: env.three,
    gpu: env.gpus, webgl2: env.page?.webgl2?.renderer,
    adapterWebGPU: adapter ? `${adapter.vendor} ${adapter.architecture}` : null
  } : null,
  // Tolerancja WebGPU względem tej bazy — WSTĘPNA, dopóki zadanie 02 jej nie skalibruje (na scenach bez
  // zamienników, spis.zamienniki = 0) i nie zapisze tu z uzasadnieniem. Skalibrowana przeżywa przebudowę.
  tolerancjaPortu: (!args['nowa-tolerancja'] && poprzedni?.tolerancjaPortu) || TOLERANCJA_WSTEPNA,
  sceny,
  ...(poprzedni?.dopisane ? { dopisane: poprzedni.dopisane } : {}),
  wydajnosc: wyd ? { scenariusz: `bitwa w czasie rzeczywistym, ${wyd.spawned} okrętów (zrzuty.mjs --wydajnosc, --bok 24), zoom 0,12, headless bez vsync`, mediana: wyd.mediana } : null,
  drzenie: drzenie ? { narzedzie: 'node dema/precyzja-drzenie.js --variant po', px: drzenie } : null
};
const file = writeJson(outFile, out);
console.log('zapisano', file, '— scen:', Object.keys(sceny).length);
