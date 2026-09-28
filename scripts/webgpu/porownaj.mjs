// Porównanie dwóch zestawów zrzutów (scripts/webgpu/zrzuty.mjs): dla każdej sceny obecnej w obu —
// odsetek różniących się pikseli (progi 2 / 8 / 32 na 255), średnia i maksymalna różnica, mapa różnic
// PNG i zestawienie obok siebie (A | B | różnica, połowa rozdzielczości). Raport JSON + Markdown.
//
//   node scripts/webgpu/porownaj.mjs --a <katalog A> --b <katalog B> [--out <katalog>] [--progi docs/webgpu/baseline.json]
//
// Z --progi: werdykt „w progu” względem progu szumu bazy (WebGL ×2) i tolerancji portu z baseline.json.
import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, writePng } from './png.mjs';

function diffImages(a, b) {
  const n = a.width * a.height;
  let d2 = 0; let d8 = 0; let d32 = 0; let sum = 0; let max = 0;
  const map = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dr = Math.abs(a.data[o] - b.data[o]);
    const dg = Math.abs(a.data[o + 1] - b.data[o + 1]);
    const db = Math.abs(a.data[o + 2] - b.data[o + 2]);
    const m = Math.max(dr, dg, db);
    sum += (dr + dg + db) / 3;
    if (m > max) max = m;
    if (m > 2) d2++;
    if (m > 8) d8++;
    if (m > 32) d32++;
    // mapa: szarość ×4, czerwień powyżej 32
    const g = Math.min(255, m * 4);
    map[o] = m > 32 ? 255 : g;
    map[o + 1] = m > 32 ? 40 : g;
    map[o + 2] = m > 32 ? 40 : g;
    map[o + 3] = 255;
  }
  const pct = (k) => +(100 * k / n).toFixed(4);
  return { roznePct2: pct(d2), roznePct8: pct(d8), roznePct32: pct(d32), srednia: +(sum / n).toFixed(4), maks: max, map };
}

// A | B | mapa, każde zmniejszone 2× (średnia 2×2).
function sideBySide(a, b, mapData) {
  const w = a.width >> 1; const h = a.height >> 1;
  const out = new Uint8Array(w * 3 * h * 4);
  const put = (src, col) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) {
          const s = (((2 * y) * a.width + 2 * x) * 4) + c;
          const v = (src[s] + src[s + 4] + src[s + a.width * 4] + src[s + a.width * 4 + 4]) >> 2;
          out[((y * w * 3) + col * w + x) * 4 + c] = c === 3 ? 255 : v;
        }
      }
    }
  };
  put(a.data, 0); put(b.data, 1); put(mapData, 2);
  return { width: w * 3, height: h, data: out };
}

export function compareDirs(dirA, dirB, outDir, opts = {}) {
  mkdirSync(outDir, { recursive: true });
  const pngs = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.png')) : []);
  const names = pngs(dirA).filter((f) => pngs(dirB).includes(f)).sort();
  const progi = opts.progi && existsSync(opts.progi) ? JSON.parse(readFileSync(opts.progi, 'utf8')) : null;
  const rows = [];
  for (const f of names) {
    const scena = basename(f, '.png');
    const a = readPng(join(dirA, f));
    const b = readPng(join(dirB, f));
    if (a.width !== b.width || a.height !== b.height) { rows.push({ scena, blad: `rozmiar ${a.width}×${a.height} vs ${b.width}×${b.height}` }); continue; }
    const r = diffImages(a, b);
    writePng(join(outDir, `${scena}-roznica.png`), { width: a.width, height: a.height, data: r.map });
    writePng(join(outDir, `${scena}-obok.png`), sideBySide(a, b, r.map));
    delete r.map;
    const row = { scena, ...r };
    const szum = progi?.sceny?.[scena]?.szum;
    const tol = progi?.tolerancjaPortu;
    if (szum) {
      // w progu szumu: nie gorzej niż 1,5× szum bazy (+ mały zapas na kwantyzację)
      row.wProguSzumu = r.roznePct8 <= szum.roznePct8 * 1.5 + 0.05 && r.srednia <= szum.srednia * 1.5 + 0.1;
      if (tol) row.wTolerancjiPortu = r.roznePct8 <= Math.max(tol.roznePct8, szum.roznePct8 * 1.5) && r.srednia <= Math.max(tol.srednia, szum.srednia * 1.5);
    }
    rows.push(row);
  }
  const brakA = pngs(dirB).filter((f) => !names.includes(f));
  const brakB = pngs(dirA).filter((f) => !names.includes(f));
  const report = { a: dirA, b: dirB, when: new Date().toISOString(), sceny: rows, tylkoWB: brakA, tylkoWA: brakB };
  writeFileSync(join(outDir, 'porownanie.json'), JSON.stringify(report, null, 2) + '\n');
  const yes = (v) => (v === undefined ? '' : v ? 'tak' : '**NIE**');
  const md = [`# Porównanie zrzutów`, '', `A: \`${dirA}\``, `B: \`${dirB}\``, '',
    '| scena | różne >2 | różne >8 | różne >32 | średnia | maks | w progu szumu | w tolerancji portu | obok siebie |',
    '|---|---:|---:|---:|---:|---:|---|---|---|',
    ...rows.map((r) => r.blad ? `| ${r.scena} | ${r.blad} ||||||||`
      : `| ${r.scena} | ${r.roznePct2}% | ${r.roznePct8}% | ${r.roznePct32}% | ${r.srednia} | ${r.maks} | ${yes(r.wProguSzumu)} | ${yes(r.wTolerancjiPortu)} | [obok](${r.scena}-obok.png) · [mapa](${r.scena}-roznica.png) |`),
    '', brakA.length ? `Tylko w B: ${brakA.join(', ')}` : '', brakB.length ? `Tylko w A: ${brakB.join(', ')}` : '',
    '', 'Mapa różnic: szarość = największa różnica kanału ×4, czerwień = różnica > 32/255. Obok siebie: A | B | mapa (połowa rozdzielczości).'].join('\n');
  writeFileSync(join(outDir, 'porownanie.md'), md + '\n');
  return { json: join(outDir, 'porownanie.json'), md: join(outDir, 'porownanie.md'), rows };
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const a = arg('a'); const b = arg('b');
  if (!a || !b) { console.log('użycie: node scripts/webgpu/porownaj.mjs --a <katalog> --b <katalog> [--out <katalog>] [--progi docs/webgpu/baseline.json]'); process.exit(2); }
  const out = arg('out', join(b, 'porownanie'));
  const r = compareDirs(resolve(a), resolve(b), resolve(out), { progi: arg('progi') ? resolve(arg('progi')) : null });
  for (const row of r.rows) console.log(row.scena.padEnd(14), row.blad || `>8: ${row.roznePct8}%  śr ${row.srednia}  maks ${row.maks}${row.wProguSzumu === undefined ? '' : `  szum: ${row.wProguSzumu ? 'OK' : 'NIE'}`}`);
  console.log('raport:', r.md);
}
