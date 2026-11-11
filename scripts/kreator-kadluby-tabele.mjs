// TABELE KADŁUBÓW GRY ze statków roboczych kreatora (src/game/hullDesign/workships/): z mocowań projektu
// (hullDesignMounts — dysze MAIN i SIDE, rdzeń, zbiornik paliwa, lampy), gniazda mostka i osprzętu roboczego
// (hullDesignWorkRig) liczy wpisy w PIKSELACH sprite'a wypieczonego przez scripts/webgpu/kreator-kadluby-gry.mjs
// (assets/ships/work/<klucz>.png; (0,0) = środek płótna, +x dziób, +y prawa burta — jak markery edytora gniazd)
// i zapisuje src/data/workHulls.js. Bez przeglądarki; rozmiar płótna czyta z nagłówka PNG.
//
//   node scripts/kreator-kadluby-tabele.mjs            — porównanie z plikiem (kod 1, gdy różny)
//   node scripts/kreator-kadluby-tabele.mjs --zapisz   — zapis src/data/workHulls.js

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkHullTables, workHullsModuleText } from '../src/game/hullDesign/hullDesignGameHull.js';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pngSize = (key) => {
  const file = resolve(repo, `assets/ships/work/${key}.png`);
  if (!existsSync(file)) throw new Error(`brak ${file} — najpierw node scripts/webgpu/kreator-kadluby-gry.mjs`);
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
const text = workHullsModuleText(buildWorkHullTables(pngSize));
const file = resolve(repo, 'src/data/workHulls.js');
if (process.argv.includes('--zapisz')) {
  writeFileSync(file, text);
  console.log('zapisano src/data/workHulls.js');
} else {
  const cur = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== text) { console.error('src/data/workHulls.js różni się od presetów — node scripts/kreator-kadluby-tabele.mjs --zapisz'); process.exit(1); }
  console.log('src/data/workHulls.js zgodny z presetami');
}
