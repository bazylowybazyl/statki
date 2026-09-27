// Składa docs/webgpu/baseline.json z przebiegu bazowego WebGL (scripts/webgpu/zrzuty.mjs --powtorz 2
// --wydajnosc), sondy środowiska (srodowisko.mjs) i pomiaru drżenia (dema/precyzja-drzenie.js).
//
//   node scripts/webgpu/baza.mjs [--baza .tmp/webgpu/baseline] [--srodowisko .tmp/webgpu/srodowisko.json]
//        [--drzenie .tmp/webgpu/baseline/drzenie/drzenie.json] [--out docs/webgpu/baseline.json]
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, writeJson, repo } from './wspolne.mjs';

const args = parseArgs();
const baza = resolve(repo, args.baza || '.tmp/webgpu/baseline');
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const p1 = read(join(baza, 'webgl', 'p1', 'wyniki.json'));
const szum = read(join(baza, 'webgl', 'szum-p1-p2', 'porownanie.json'));
const wyd = read(join(baza, 'webgl', 'wydajnosc.json'));
const env = read(resolve(repo, args.srodowisko || '.tmp/webgpu/srodowisko.json'));
const drz = read(resolve(repo, args.drzenie || join(baza, 'drzenie', 'drzenie.json')));
if (!p1 || !szum) { console.log('brak wyników bazy (p1/wyniki.json, szum-p1-p2/porownanie.json)'); process.exit(2); }

const git = (...a) => { try { return execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; } };
const noise = Object.fromEntries(szum.sceny.map((s) => [s.scena, { roznePct2: s.roznePct2, roznePct8: s.roznePct8, roznePct32: s.roznePct32, srednia: s.srednia, maks: s.maks }]));

const sceny = {};
for (const r of p1.sceny) {
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

const adapter = env?.page?.adapters?.['high-performance'];
const drzenie = drz ? Object.fromEntries(drz.results.map((x) => [x.id, x.jitterRmsPx === undefined ? { uwaga: x.note || 'brak' } : { rms: x.jitterRmsPx, maks: x.jitterMaxPx }])) : null;

const out = {
  opis: 'Baza odniesienia portu WebGPU: gra na starym WebGLRenderer (tag webgl-baseline), 1920×1080, harness scripts/webgpu/zrzuty.mjs. PNG w .tmp/webgpu/baseline/webgl/p1 (nie w repo) — odtwarzalne z tagu.',
  utworzono: new Date().toISOString(),
  tag: 'webgl-baseline',
  commitPrzebiegu: p1.commit,
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
  // Tolerancja WebGPU względem tej bazy — WSTĘPNA. Kalibruje ją zadanie 02 (post: bloom, uber, ACES)
  // na scenach bez zamienników (spis.zamienniki = 0) i zapisuje tu z uzasadnieniem.
  tolerancjaPortu: { roznePct8: 2.0, srednia: 1.0, stan: 'wstępna — do kalibracji w zadaniu 02' },
  sceny,
  wydajnosc: wyd ? { scenariusz: `bitwa w czasie rzeczywistym, ${wyd.spawned} okrętów (zrzuty.mjs --wydajnosc, --bok 24), zoom 0,12, headless bez vsync`, mediana: wyd.mediana } : null,
  drzenie: drzenie ? { narzedzie: 'node dema/precyzja-drzenie.js --variant po', px: drzenie } : null
};
const file = writeJson(args.out || 'docs/webgpu/baseline.json', out);
console.log('zapisano', file, '— scen:', Object.keys(sceny).length);
