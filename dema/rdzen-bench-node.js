// Benchmark rdzenia w node (bez renderu, deterministyczny).
//   node dema/rdzen-bench-node.js                      → pełna macierz (3 kadłuby × broń × 4 kierunki)
//   node dema/rdzen-bench-node.js --hull battleship --weapons railgun_mk2,beam_continuous --dirs side
//   node dema/rdzen-bench-node.js --sens               → czułość na r / armorMul (burta)
//   node dema/rdzen-bench-node.js --kill probe         → tryb sondy punktu zamiast progu osłony
//   node dema/rdzen-bench-node.js --legacy             → A/B: okna sond sprzed poprawki heksów-duchów
//   (--fix = dawne przybliżenie poprawki; na destruktorze z probeDriftCap nic nie zmienia)
//   node dema/rdzen-bench-node.js --seeds 6 --hull battleship --weapons special_valkyrie_railgun --dirs side
//                                                      → rozrzut: ten sam przypadek na N ziarnach (Math.random i celowanie)
// Wyniki: .tmp/rdzen/bench-<nazwa>.json i .md
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng } from './rdzen-combat.js';
import { buildNodeHull } from './rdzen-node-hulls.js';
import {
  runCoreBenchmarkCase,
  formatBenchRow,
  BENCH_TABLE_HEADER,
  BENCH_WEAPONS,
  BENCH_DIRECTIONS
} from './rdzen-bench.js';
import { HULLS, HULL_IDS } from './rdzen-hulls-data.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(repo, '.tmp/rdzen');
mkdirSync(outDir, { recursive: true });

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return (v && !v.startsWith('--')) ? v : '1';
};

// Math.random destruktora (spin odłamków) i losowania rozpadu — ziarno stałe.
const seededRandom = makeRng(20260924);
Math.random = seededRandom;

const hulls = arg('hull') && arg('hull') !== 'all' ? arg('hull').split(',') : HULL_IDS;
const weapons = arg('weapons') ? arg('weapons').split(',') : BENCH_WEAPONS;
const dirs = arg('dirs') ? arg('dirs').split(',') : Object.keys(BENCH_DIRECTIONS);
const killMode = arg('kill', 'containment');
const maxTime = Number(arg('maxTime', 300));
const aimMode = arg('aim', 'chamber');
const driftAwareProbes = arg('fix') === '1';
const legacyProbes = arg('legacy') === '1';
const softBody = arg('soft', 'cpu');
const seeds = Number(arg('seeds', 0)) | 0;
const name = arg('name', `${arg('sens') ? 'sens' : (seeds ? 'seeds' : 'matrix')}-${killMode}${driftAwareProbes ? '-fix' : ''}${legacyProbes ? '-legacy' : ''}${softBody !== 'cpu' ? '-' + softBody : ''}${aimMode !== 'chamber' ? '-' + aimMode : ''}`);

const rows = [];
const results = [];
const t0 = Date.now();

function run(opts) {
  const r = runCoreBenchmarkCase({ buildHull: buildNodeHull, killMode, maxTime, driftAwareProbes, legacyProbes, softBody, aimMode, ...opts });
  results.push(r);
  rows.push(formatBenchRow(r));
  const c = r.core ? `${r.core.hits}tr ${r.core.time.toFixed(1)}s` : '—';
  const a = r.attrition ? `${r.attrition.hits}tr ${r.attrition.time.toFixed(1)}s` : '—';
  console.log(`${(HULLS[r.hullId]?.label || r.hullId).padEnd(10)} ${r.weaponId.padEnd(26)} ${String(r.direction).padEnd(8)} r=${(r.chamberR || 0).toFixed(0)} ×${r.armorMul}  rdzeń ${c.padEnd(16)} wyn. ${a.padEnd(16)} ${r.first}  (${r.wallMs} ms)`);
  return r;
}

if (arg('sens')) {
  // Czułość: r (px siatki) × armorMul, broń reprezentatywna, ogień z burty.
  const sensWeapons = arg('weapons') ? weapons : ['railgun_mk2', 'heavy_autocannon', 'beam_continuous', 'special_valkyrie_railgun'];
  const radii = (arg('radii') || '18,26,36').split(',').map(Number);
  const armors = (arg('armors') || '1,2,3,4').split(',').map(Number);
  for (const hullId of hulls) {
    const def = HULLS[hullId];
    const base = def.cores[0];
    const uni = 0.5 * (def.pngWidth ? 1 : 1);
    void uni;
    for (const weaponId of sensWeapons) {
      for (const rGrid of radii) {
        for (const armorMul of armors) {
          // r w markerze jest w px PNG: przeliczamy przez skalę układu kadłuba
          const scale = hullId === 'atlas' ? 0.4805 : (hullId === 'battleship' ? 0.539 : 0.6218);
          run({ hullId, weaponId, direction: arg('dirs') ? dirs[0] : 'side', markers: [{ ...base, r: rGrid / scale, armorMul }] });
        }
      }
    }
  }
} else if (seeds > 0) {
  // Rozrzut: każde ziarno od nowa (Math.random destruktora i celowanie), żeby
  // przypadki były niezależne i powtarzalne. Macierz jedzie na jednym strumieniu.
  const spread = [];
  for (const hullId of hulls) {
    for (const weaponId of weapons) {
      for (const direction of dirs) {
        const got = [];
        for (let k = 1; k <= seeds; k++) {
          Math.random = makeRng(1000 + k);
          got.push(run({ hullId, weaponId, direction, seed: 1337 + k * 7919 }));
        }
        const hits = got.map((r) => r.core ? r.core.hits : null);
        const ok = hits.filter((h) => h != null).sort((a, b) => a - b);
        spread.push({ hullId, weaponId, direction, hits, reached: ok.length, min: ok[0] ?? null, med: ok.length ? ok[(ok.length - 1) >> 1] : null, max: ok[ok.length - 1] ?? null });
      }
    }
  }
  rows.push('', '| kadłub | broń | kierunek | STOPIENIE osiągnięte | trafień min / mediana / max | wszystkie |', '|---|---|---|---:|---|---|');
  for (const x of spread) rows.push(`| ${HULLS[x.hullId]?.label || x.hullId} | ${x.weaponId} | ${x.direction} | ${x.reached}/${seeds} | ${x.min ?? '—'} / ${x.med ?? '—'} / ${x.max ?? '—'} | ${x.hits.map((h) => h ?? '—').join(', ')} |`);
  console.log(rows.slice(-spread.length - 2).join('\n'));
} else {
  for (const hullId of hulls) {
    for (const weaponId of weapons) {
      for (const direction of dirs) run({ hullId, weaponId, direction });
    }
  }
}

const md = [
  `# Benchmark rdzenia — ${name}`,
  '',
  `Tryb killa: **${killMode}** · solver sprężyn: **${softBody}** · okna sond: **${results[0]?.probeMode === 'legacy' ? 'sprzed poprawki heksów-duchów (A/B)' : (results[0]?.probeMode === 'game' ? 'jak gra (z poprawką heksów-duchów)' : (results[0]?.probeMode === 'wide' ? 'przybliżenie poprawki na starym destruktorze' : 'jak gra (stary destruktor)'))}** · dystans ${results[0]?.distance ?? '—'} j. (≤ 80% zasięgu broni) · limit ${maxTime} s · tarcza zbita · ziarno 20260924`,
  `Celowanie: **${aimMode === 'chamber' ? 'lock na rdzeń = losowy punkt komory' : 'punkt rdzenia'}**. Komórki: trafień w kadłub / obrażeń w pulę HP / czas symulacji do progu; „~” = próg wyniszczenia ekstrapolowany (stałe DPS od chwili killa rdzeniem).`,
  '',
  ...BENCH_TABLE_HEADER,
  ...rows,
  '',
  `Czas liczenia: ${((Date.now() - t0) / 1000).toFixed(1)} s`
].join('\n');
writeFileSync(resolve(outDir, `bench-${name}.json`), JSON.stringify(results, null, 2));
writeFileSync(resolve(outDir, `bench-${name}.md`), md + '\n');
console.log(`\nZapisano .tmp/rdzen/bench-${name}.md (${results.length} przypadków, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
