// Dane obrysu okrętów Terra Novy dla gotowych projektów kreatora kadłuba: uruchamia obrys sprite'ów
// (scripts/kreator-obrys-tn.mjs) i zapisuje src/game/hullDesign/hullDesignTNTrace.js — rama (sylwetka, poziom 0),
// pancerz (płyty, poziom 1, z otworami = szczeliny maszynowni) i wnęki (kandydaci na kratki / gniazda). Moduły,
// nadbudówki i naklejki dokłada ręcznie src/game/hullDesign/hullDesignPresets.js.
//
//   node scripts/kreator-presety-tn.mjs [--eps 2]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return acc;
}, []));
const out = join(repo, '.tmp/kreator/obrys');
const SHIPS = {
  custos: { key: 'terran_frigate', opts: ['--eps', args.eps || '2', '--komorka', '2'] },
  hasta: { key: 'terran_destroyer', opts: ['--eps', args.eps || '1.6'] },
  bellator: { key: 'terran_battleship', opts: ['--eps', args.eps || '1.8'] },
  citadella: { key: 'terran_carrier', opts: ['--eps', args.eps || '2'] },
  colossus: { key: 'terran_supercapital', opts: ['--eps', args.eps || '2'] }
};

const flat = (loop, q) => loop.flatMap(([x, y]) => [Math.round(x / q) * q, Math.round(y / q) * q].map((v) => Math.round(v * 100) / 100));
const lines = [];
lines.push('// src/game/hullDesign/hullDesignTNTrace.js');
lines.push('//');
lines.push('// WYGENEROWANE przez scripts/kreator-presety-tn.mjs (obrys sprite\'ów Terra Novy: scripts/kreator-obrys-tn.mjs) —');
lines.push('// nie edytuj ręcznie. Na okręt: detail [j./jd] (długość / 1700), rama (sylwetka, poziom 0: [obrys, …otwory]) i');
lines.push('// pancerz — lista PŁYT ([obrys, …otwory] każda; otwory = szczeliny maszynowni) jako płaskie listy [x0, y0, x1, y1, …]');
lines.push('// w j. świata gry (x ku dziobowi od');
lines.push('// środka pudła kadłuba, y w dół od osi), wnęki [x, y, w, h, wypełnienie pudła] (pół-wymiary; kratki / gniazda — kandydaci na moduły).');
lines.push('');
lines.push('export const HD_TN_TRACE = Object.freeze({');
for (const [name, { key, opts }] of Object.entries(SHIPS)) {
  execFileSync(process.execPath, [join(repo, 'scripts/kreator-obrys-tn.mjs'), '--kadlub', key, '--out', out, ...opts], { stdio: 'inherit' });
  const t = JSON.parse(readFileSync(join(out, `${key}.json`), 'utf8'));
  const q = t.detail < 0.2 ? 0.05 : 0.1;
  const frame = t.wielokaty.find((p) => p.level === 0);
  const plates = t.wielokaty.filter((p) => p.level === 1);
  const loopsOf = (p) => [p.pts, ...p.holes].map((l) => flat(l, q));
  lines.push(`  ${name}: Object.freeze({`);
  lines.push(`    sprite: ${JSON.stringify(t.sprite)}, profile: ${JSON.stringify(key)}, length: ${t.dlugosc}, width: ${t.szerokosc}, detail: ${t.detail},`);
  lines.push(`    frame: ${JSON.stringify(loopsOf(frame))},`);
  lines.push(`    armor: ${JSON.stringify(plates.map(loopsOf))},`);
  lines.push(`    recesses: ${JSON.stringify(t.wneki.map((r) => [r.x, r.y, r.w, r.h, r.fill]))}`);
  lines.push('  }),');
}
lines.push('});');
lines.push('');
lines.push('/** Płaska lista [x0, y0, …] → [[x, y], …]. */');
lines.push('export function tnLoop(flatList) {');
lines.push('  const out = [];');
lines.push('  for (let i = 0; i + 1 < flatList.length; i += 2) out.push([flatList[i], flatList[i + 1]]);');
lines.push('  return out;');
lines.push('}');
lines.push('');
writeFileSync(join(repo, 'src/game/hullDesign/hullDesignTNTrace.js'), lines.join('\n'));
console.log('zapisano src/game/hullDesign/hullDesignTNTrace.js');
