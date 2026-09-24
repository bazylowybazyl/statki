// Zwięzłe tabele z wyników benchmarku rdzenia (JSON z rdzen-bench-node.js)
// do docs/PORT-rdzen.md. Bez symulacji — tylko czyta .tmp/rdzen/bench-*.json.
//   node dema/rdzen-bench-tables.js                 → macierz (containment) + warianty, jeśli są
//   node dema/rdzen-bench-tables.js --out .tmp/rdzen/bench-tabele.md
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { HULLS } from './rdzen-hulls-data.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(repo, '.tmp/rdzen');
const argv = process.argv.slice(2);
const outArg = argv.indexOf('--out');
const outPath = outArg >= 0 ? resolve(repo, argv[outArg + 1]) : resolve(dir, 'bench-tabele.md');

const DIRS = ['bow', 'oblique', 'side', 'stern'];
const DIR_PL = { bow: 'dziób', oblique: 'skos', side: 'burta', stern: 'rufa' };
const HULL_ORDER = ['battleship', 'pirate_battleship', 'atlas'];

function load(name) {
  const p = resolve(dir, `bench-${name}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

const hullLabel = (id) => HULLS[id]?.label || id;
const wName = (id) => MASTER_WEAPONS[id]?.name || id;

// Wyniszczenie, gdy nie padło w limicie: pula HP ÷ obrażenia trafienia, czas z
// kadencji i luf (bez rozrzutu — dolna granica; heksowy sufit niższy tylko przy
// dużych stratach heksów, których te bronie w limicie nie robią).
function analyticAttrition(r) {
  const w = MASTER_WEAPONS[r.weaponId];
  if (!w) return null;
  const dmg = Number(w.baseDamage) || 0;
  if (!(dmg > 0)) return null;
  const hits = Math.ceil((r.hp0 || 12000) / dmg);
  const barrels = w.category === 'beam' ? 1 : Math.max(1, Number(w.barrelsPerShot) || 1) * Math.max(1, Number(w.burstCount) || 1);
  const perSec = barrels / Math.max(0.02, Number(w.cooldown) || 1);
  return { hits, time: hits / perSec, analytic: true };
}

const cellCore = (r) => {
  if (!r || r.error) return 'błąd';
  if (r.core) return `**${r.core.hits}**${r.core.host === 'fragment' ? '†' : ''}`;
  if (r.exposed) return `— (odsł. ${r.exposed.hits})`;
  return '—';
};

function attritionCell(rows) {
  const a = rows.find((r) => r?.attrition && !r.attrition.estimated)?.attrition;
  if (a) return `${a.hits} tr. / ${a.time.toFixed(0)} s`;
  const est = rows.find((r) => r?.attrition)?.attrition;
  if (est) return `~${est.hits} tr. / ~${est.time.toFixed(0)} s`;
  const any = rows.find(Boolean);
  const an = analyticAttrition(any);
  if (!an) return '—';
  // Symulacja przeszła cały limit bez zbicia puli, choć przy trafieniu co spust
  // pula padłaby wcześniej: broń trafia rzadziej, niż strzela (heksy-duchy).
  if (any?.timedOut && an.time < (any.simTime || 300)) {
    const hitRate = any.final && any.projectiles ? Math.round(100 * any.final.hits / any.projectiles) : null;
    return `> ${Math.round(any.simTime || 300)} s (trafia ${hitRate != null ? hitRate + '% spustów' : 'rzadziej niż strzela'})`;
  }
  return `~${an.hits} tr. / ~${an.time.toFixed(0)} s (analit.)`;
}

function matrixTable(results, title) {
  if (!results) return [];
  const by = new Map();
  for (const r of results) {
    const k = `${r.hullId}|${r.weaponId}`;
    if (!by.has(k)) by.set(k, {});
    by.get(k)[r.direction] = r;
  }
  const weapons = [...new Set(results.map((r) => r.weaponId))];
  const lines = [
    `### ${title}`,
    '',
    '| kadłub | broń | ' + DIRS.map((d) => DIR_PL[d]).join(' | ') + ' | wyniszczenie (pula 12 000 HP) |',
    '|---|---|' + DIRS.map(() => '---:').join('|') + '|---|'
  ];
  for (const hullId of HULL_ORDER) {
    for (const weaponId of weapons) {
      const row = by.get(`${hullId}|${weaponId}`);
      if (!row) continue;
      const cells = DIRS.map((d) => cellCore(row[d]));
      lines.push(`| ${hullLabel(hullId)} | ${wName(weaponId)} | ${cells.join(' | ')} | ${attritionCell(DIRS.map((d) => row[d]))} |`);
    }
  }
  lines.push('', 'Komórka = trafień w kadłub do STOPIENIA (punkt bez powrotu); „— (odsł. N)” = w limicie 300 s tylko ODSŁONIĘTY po N trafieniach; „—” = komora nietknięta; † = rdzeń odcięty z fragmentem.', '');
  return lines;
}

function sensTable(results) {
  if (!results) return [];
  const lines = ['### Czułość na r i armorMul (ogień z burty)', ''];
  const groups = new Map();
  for (const r of results) {
    const k = `${r.hullId}|${r.weaponId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const armors = [...new Set(results.map((r) => r.armorMul))].sort((a, b) => a - b);
  lines.push('| kadłub | broń | r (px siatki) | ' + armors.map((a) => `×${a}`).join(' | ') + ' |');
  lines.push('|---|---|---:|' + armors.map(() => '---:').join('|') + '|');
  for (const hullId of HULL_ORDER) {
    for (const [k, rows] of groups) {
      if (!k.startsWith(`${hullId}|`)) continue;
      const radii = [...new Set(rows.map((r) => Math.round(r.chamberR)))].sort((a, b) => a - b);
      for (const rad of radii) {
        const cells = armors.map((a) => {
          const r = rows.find((x) => Math.round(x.chamberR) === rad && x.armorMul === a);
          return r ? cellCore(r) : '';
        });
        const n = rows.find((x) => Math.round(x.chamberR) === rad)?.chamberHexes;
        lines.push(`| ${hullLabel(hullId)} | ${wName(rows[0].weaponId)} | ${rad} (${n} heksów) | ${cells.join(' | ')} |`);
      }
    }
  }
  lines.push('', 'Komórka = trafień do STOPIENIA (pojedynczy przebieg, ±25%); pula HP (wyniszczenie) jak w macierzy: Valkyrie 24, Yamato 15, laser pulsacyjny 267.', '');
  return lines;
}

// Rozrzut: ten sam przypadek na N ziarnach (bench-seeds-*.json).
function seedsTable(results) {
  if (!results) return [];
  const groups = new Map();
  for (const r of results) {
    const k = `${r.hullId}|${r.weaponId}|${r.direction}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const lines = [
    '### Rozrzut między przebiegami (niezależne ziarna)',
    '',
    '| kadłub | broń | kierunek | STOPIENIE osiągnięte | trafień min / mediana / max | wszystkie |',
    '|---|---|---|---:|---|---|'
  ];
  for (const hullId of HULL_ORDER) {
    for (const [k, rows] of groups) {
      if (!k.startsWith(`${hullId}|`)) continue;
      const hits = rows.map((r) => (r.core ? r.core.hits : null));
      const ok = hits.filter((h) => h != null).sort((a, b) => a - b);
      const med = ok.length ? ok[(ok.length - 1) >> 1] : null;
      lines.push(`| ${hullLabel(hullId)} | ${wName(rows[0].weaponId)} | ${DIR_PL[rows[0].direction] || rows[0].direction} | ${ok.length}/${rows.length} | ${ok[0] ?? '—'} / ${med ?? '—'} / ${ok[ok.length - 1] ?? '—'} | ${hits.map((h) => h ?? '—').join(', ')} |`);
    }
  }
  lines.push('');
  return lines;
}

// Przed / po poprawce heksów-duchów: trafienia do STOPIENIA (albo odsłonięcia).
function beforeAfterTable(before, after, weapons) {
  if (!before || !after) return [];
  const key = (r) => `${r.hullId}|${r.weaponId}|${r.direction}`;
  const b = new Map(before.map((r) => [key(r), r]));
  const lines = [
    '### Przed i po poprawce heksów-duchów (ta sama metoda, trafień do STOPIENIA)',
    '',
    '| kadłub | broń | ' + DIRS.map((d) => DIR_PL[d]).join(' | ') + ' |',
    '|---|---|' + DIRS.map(() => '---').join('|') + '|'
  ];
  for (const hullId of HULL_ORDER) {
    for (const weaponId of weapons) {
      const cells = DIRS.map((d) => {
        const a = after.find((r) => key(r) === `${hullId}|${weaponId}|${d}`);
        const p = b.get(`${hullId}|${weaponId}|${d}`);
        if (!a && !p) return '';
        return `${p ? cellCore(p) : '?'} → ${a ? cellCore(a) : '?'}`;
      });
      if (cells.every((c) => !c)) continue;
      lines.push(`| ${hullLabel(hullId)} | ${wName(weaponId)} | ${cells.join(' | ')} |`);
    }
  }
  lines.push('', 'Przed: stary destruktor (okna sond bez dryfu, solver co klatkę) i synchroniczne lustro solvera. Po: bieżący kod gry i lustro z opóźnieniem wyniku jak na GPU.', '');
  return lines;
}

const out = [];
const containment = load('matrix-containment');
out.push(...matrixTable(containment, 'Macierz: próg osłony komory (30%), lock = losowy punkt komory, bieżący kod gry'));
out.push(...seedsTable(load('seeds-containment')));
const probe = load('matrix-probe');
out.push(...matrixTable(probe, 'Wariant: sonda punktu (dzisiejszy warunek gry: 5 punktów, 2 kontrole bez heksa)'));
out.push(...beforeAfterTable(load('matrix-containment-przed-poprawka'), containment,
  ['special_valkyrie_railgun', 'special_yamato_cannon', 'beam_pulse', 'beam_continuous']));
out.push(...sensTable(load('sens-containment')));
writeFileSync(outPath, out.join('\n') + '\n');
console.log(out.join('\n'));
console.log(`\nZapisano ${outPath}`);
