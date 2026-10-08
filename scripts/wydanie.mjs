// Wydanie gry: podbija wersję (package.json + package-lock.json), buduje instalator Electrona
// (npm run package → dist-electron/HULLFALL-Setup-<wersja>.exe) i pokazuje go w Eksploratorze.
// Nieudany albo przerwany build cofa wersję — numer przepada tylko przy udanym wydaniu.
// Wersję widać też w menu gry (Autorzy → Wersja; vite.config.js wstawia ją do index.html).
//
// Dwuklik: ZBUDUJ-INSTALATOR.bat w korzeniu repo. Z konsoli:
//   node scripts/wydanie.mjs                  — pyta o rodzaj podbicia
//   node scripts/wydanie.mjs minor            — 0.1.0 → 0.2.0 (patch → 0.1.1, major → 1.0.0)
//   node scripts/wydanie.mjs 0.5.0            — konkretny numer
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
  console.log('  albo wpisz numer, np. 0.5.0\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Wybór: ')).trim().toLowerCase();
  rl.close();
  if (answer === '') return 'minor';
  if (answer === 'p') return 'patch';
  if (answer === 'g') return 'major';
  return answer;
}

const args = process.argv.slice(2);
const openFolder = !args.includes('--bez-folderu');
const kindArg = args.find((a) => !a.startsWith('--'));

console.log('HULLFALL — nowe wydanie\n');
const current = readVersion();
if (!SEMVER.test(current)) {
  console.error(`Wersja w package.json ("${current}") nie jest w postaci X.Y.Z — popraw ją ręcznie.`);
  process.exit(1);
}
const kind = kindArg ?? (await askKind(current));
const next = bump(current, kind);
if (!next) {
  console.error(`Nie rozumiem „${kind}” — podaj minor / patch / major albo numer X.Y.Z.`);
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
const ok = npm('run package');
const installer = path.join(ROOT, 'dist-electron', `HULLFALL-Setup-${next}.exe`);

if (!ok || !existsSync(installer)) {
  setVersion(current);
  console.error(`\nBUILD NIEUDANY — wersja cofnięta do ${current}. Błąd jest wyżej w logu.`);
  process.exit(1);
}

const minutes = ((Date.now() - t0) / 60000).toFixed(1);
const mb = Math.round(statSync(installer).size / 2 ** 20);
console.log(`\nGOTOWE: HULLFALL ${next} (${minutes} min)`);
console.log(`Instalator: ${installer} (${mb} MB)`);
if (openFolder) spawn('explorer.exe', [`/select,${installer}`], { detached: true, stdio: 'ignore' }).unref();
