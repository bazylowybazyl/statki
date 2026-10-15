// Wydanie gry: podbija wersję (package.json + package-lock.json), buduje instalator Electrona
// (npm run package → dist-electron/HULLFALL-Setup-<wersja>.exe) albo przenośny exe
// (npm run package:portable → dist-electron/HULLFALL-Portable-<wersja>.exe — jeden plik bez instalacji;
// przy starcie rozpakowuje grę do %TEMP%\HULLFALL-portable, zapis gry jak w instalacji: Dokumenty\HULLFALL)
// i pokazuje wynik w Eksploratorze.
// Nieudany albo przerwany build cofa wersję — numer przepada tylko przy udanym wydaniu.
// Wersję widać też w menu gry (Autorzy → Wersja; vite.config.js wstawia ją do index.html).
//
// Dwuklik: ZBUDUJ-INSTALATOR.bat albo ZBUDUJ-PORTABLE.bat w korzeniu repo. Z konsoli:
//   node scripts/wydanie.mjs                  — pyta o rodzaj podbicia
//   node scripts/wydanie.mjs minor            — 0.1.0 → 0.2.0 (patch → 0.1.1, major → 1.0.0)
//   node scripts/wydanie.mjs 0.5.0            — konkretny numer
//   node scripts/wydanie.mjs same             — bez podbicia (np. portable do wydanej już wersji)
//   … --portable                              — przenośny exe zamiast instalatora
//   … --oba                                   — instalator i przenośny exe w jednym buildzie
//   … --bez-folderu                           — bez otwierania Eksploratora na końcu
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+$/;

const readVersion = () => JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function bump(version, kind) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (kind === 'same') return version;
  return SEMVER.test(kind) ? kind : null;
}

// Jeden napis polecenia (shell: true z tablicą argumentów Node oznacza jako niebezpieczne);
// argumenty są nasze — wersja przeszła przez SEMVER.
function npm(command, quiet = false) {
  const r = spawnSync(`npm ${command}`, { cwd: ROOT, shell: true, stdio: quiet ? 'pipe' : 'inherit' });
  return r.status === 0;
}

const setVersion = (v) => npm(`version ${v} --no-git-tag-version --allow-same-version`, true);

async function askKind(current) {
  console.log(`Obecna wersja: ${current}\n`);
  console.log(`  [Enter]  ${bump(current, 'minor')}   nowa wersja`);
  console.log(`  p        ${bump(current, 'patch')}   poprawka`);
  console.log(`  g        ${bump(current, 'major')}   główna`);
  console.log(`  t        ${current}   ta sama (bez podbicia)`);
  console.log('  albo wpisz numer, np. 0.5.0\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Wybór: ')).trim().toLowerCase();
  rl.close();
  if (answer === '') return 'minor';
  if (answer === 'p') return 'patch';
  if (answer === 'g') return 'major';
  if (answer === 't') return 'same';
  return answer;
}

const args = process.argv.slice(2);
const openFolder = !args.includes('--bez-folderu');
const kindArg = args.find((a) => !a.startsWith('--'));
const both = args.includes('--oba');
const portable = both || args.includes('--portable');
const installer = both || !portable;
const npmScript = both ? 'package:all' : portable ? 'package:portable' : 'package';
const targetLabel = both ? 'instalator + portable' : portable ? 'portable' : 'instalator';

console.log(`HULLFALL — nowe wydanie (${targetLabel})\n`);
const current = readVersion();
if (!SEMVER.test(current)) {
  console.error(`Wersja w package.json ("${current}") nie jest w postaci X.Y.Z — popraw ją ręcznie.`);
  process.exit(1);
}
const kind = kindArg ?? (await askKind(current));
const next = bump(current, kind);
if (!next) {
  console.error(`Nie rozumiem „${kind}” — podaj minor / patch / major / same albo numer X.Y.Z.`);
  process.exit(1);
}

// Ctrl+C w trakcie buildu: proces potomny dostaje sygnał sam, a my po jego końcu cofamy wersję.
process.on('SIGINT', () => {});

console.log(`\nWersja ${current} → ${next}\n`);
if (!setVersion(next)) {
  console.error('Nie udało się zapisać wersji (npm version).');
  process.exit(1);
}

const t0 = Date.now();
const ok = npm(`run ${npmScript}`);
const outputs = [];
if (installer) outputs.push(['Instalator', path.join(ROOT, 'dist-electron', `HULLFALL-Setup-${next}.exe`)]);
if (portable) outputs.push(['Portable', path.join(ROOT, 'dist-electron', `HULLFALL-Portable-${next}.exe`)]);

if (!ok || outputs.some(([, file]) => !existsSync(file))) {
  setVersion(current);
  console.error(`\nBUILD NIEUDANY — wersja cofnięta do ${current}. Błąd jest wyżej w logu.`);
  process.exit(1);
}

const minutes = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`\nGOTOWE: HULLFALL ${next} (${minutes} min)`);
for (const [label, file] of outputs) {
  console.log(`${label}: ${file} (${Math.round(statSync(file).size / 2 ** 20)} MB)`);
}
const shown = outputs[outputs.length - 1][1];
if (openFolder) spawn('explorer.exe', [`/select,${shown}`], { detached: true, stdio: 'ignore' }).unref();
