import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// AGENTS.md ładuje się w KAŻDEJ sesji i w każdym podagencie. Do 2026-10-19 urósł do 442 tys. znaków
// (~147 tys. tokenów na starcie każdej sesji) — wiedza o obszarach jest teraz w .claude/rules/<obszar>.md,
// które Claude Code wczytuje dopiero przy pracy na plikach z `paths:`. Zepsuty YAML nagłówka reguły
// = reguła ładuje się ZAWSZE (po cichu), więc nagłówek ma ścisły format: ---, paths:, `  - "glob"`, ---.

const root = process.cwd();
const rulesDir = join(root, '.claude', 'rules');
const CORE_MAX_CHARS = 40000;
const RULE_MAX_CHARS = 50000;

const chars = (text) => [...text].length;

function readRules() {
  return readdirSync(rulesDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => ({ file, name: file.slice(0, -3), text: readFileSync(join(rulesDir, file), 'utf8') }));
}

function parseFrontmatter(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return { error: 'pierwsza linia to nie „---”' };
  if (lines[1] !== 'paths:') return { error: 'druga linia to nie „paths:” (Claude Code czyta z reguły tylko `paths`)' };
  const globs = [];
  let i = 2;
  for (; i < lines.length && lines[i] !== '---'; i++) {
    const m = /^ {2}- "([^"\\]+)"$/.exec(lines[i]);
    if (!m) return { error: `linia ${i + 1} to nie „  - "glob"”: ${lines[i]}` };
    globs.push(m[1]);
  }
  if (i >= lines.length) return { error: 'brak zamykającego „---”' };
  return { globs, body: lines.slice(i + 1).join('\n') };
}

// Podzbiór składni globów (`*`, `**`, `?`) — test odrzuca resztę, żeby sprawdzał to samo, co dopasuje Claude Code.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const segStart = i === 0 || glob[i - 1] === '/';
        if (segStart && glob[i + 2] === '/') { re += '(?:[^/]*/)*'; i += 2; continue; }
        if (segStart && i + 2 === glob.length) { re += '.*'; i += 1; continue; }
        re += '[^/]*'; i += 1; continue;
      }
      re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

test('AGENTS.md: rdzeń mieści się w limicie', () => {
  const n = chars(readFileSync(join(root, 'AGENTS.md'), 'utf8'));
  assert.ok(n <= CORE_MAX_CHARS,
    `AGENTS.md ma ${n} znaków (limit ${CORE_MAX_CHARS}) — opis obszaru przenieś do jego reguły w .claude/rules/`);
});

test('reguły obszarów: ścisły nagłówek paths, tytuł, rozsądny rozmiar', () => {
  const rules = readRules();
  assert.ok(rules.length > 0, 'brak reguł w .claude/rules/');
  for (const r of rules) {
    assert.match(r.name, /^[a-z0-9-]+$/, `${r.file}: nazwa pliku tylko z małych liter, cyfr i „-”`);
    const fm = parseFrontmatter(r.text);
    assert.ok(!fm.error, `${r.file}: ${fm.error}`);
    assert.ok(fm.globs.length > 0, `${r.file}: pusta lista paths — reguła ładowałaby się zawsze`);
    for (const g of fm.globs) {
      assert.ok(!/^[./]/.test(g) && !g.includes('\\') && !g.includes('..'),
        `${r.file}: glob „${g}” — ścieżka względna od korzenia repo, z „/”`);
      assert.ok(!/[{}[\],]/.test(g), `${r.file}: glob „${g}” — bez nawiasów i przecinków (osobna linia na wariant)`);
    }
    assert.match(fm.body, /^# \S/m, `${r.file}: brak tytułu „# …”`);
    assert.ok(chars(r.text) <= RULE_MAX_CHARS, `${r.file}: ${chars(r.text)} znaków (limit ${RULE_MAX_CHARS}) — podziel regułę`);
  }
});

test('indeks w AGENTS.md = pliki reguł', () => {
  const core = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  const at = core.indexOf('## Indeks reguł');
  assert.ok(at >= 0, 'AGENTS.md bez sekcji „## Indeks reguł”');
  const listed = new Set([...core.slice(at).matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]));
  const files = new Set(readRules().map((r) => r.name));
  for (const f of files) assert.ok(listed.has(f), `reguła ${f}.md bez wiersza w indeksie AGENTS.md`);
  for (const l of listed) assert.ok(files.has(l), `indeks AGENTS.md wskazuje brakującą regułę ${l}.md`);
});

test('każdy glob reguły trafia w śledzony plik', (t) => {
  const tracked = trackedFiles();
  if (!tracked) { t.skip('brak gita'); return; }
  for (const r of readRules()) {
    for (const g of parseFrontmatter(r.text).globs || []) {
      const re = globToRegExp(g);
      assert.ok(tracked.some((f) => re.test(f)), `${r.file}: glob „${g}” nie trafia w żaden śledzony plik`);
    }
  }
});

test('git śledzi AGENTS.md wielkimi literami (Linux, sesje w chmurze)', (t) => {
  const tracked = trackedFiles();
  if (!tracked) { t.skip('brak gita'); return; }
  assert.ok(tracked.includes('AGENTS.md'), 'w gicie brak AGENTS.md');
  assert.ok(!tracked.includes('agents.md'),
    'w gicie jest agents.md — na systemie z rozróżnianiem wielkości liter Claude Code szuka AGENTS.md i go nie znajdzie');
});
