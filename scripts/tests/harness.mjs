/**
 * Minimalny harness do testów logiki gry.
 *
 * Bez zależności zewnętrznych: te testy sprawdzają czyste moduły danych
 * (resources, salvage, factions), które nie dotykają DOM-u ani Three.js,
 * więc uruchamiają się w gołym node.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function createSuite(name) {
  const results = { name, passed: 0, failed: 0, failures: [] };

  return {
    results,

    section(title) {
      console.log(`\n${BOLD}${title}${RESET}`);
    },

    /** Zapisuje wiersz kontekstu — dane, nie asercja. */
    note(text) {
      console.log(`  ${DIM}${text}${RESET}`);
    },

    check(label, condition, detail = '') {
      if (condition) {
        results.passed++;
        console.log(`  ${GREEN}OK${RESET}   ${label}`);
      } else {
        results.failed++;
        results.failures.push(`${name}: ${label}${detail ? ` ${detail}` : ''}`);
        console.log(`  ${RED}FAIL${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`);
      }
    },

    equal(label, actual, expected) {
      this.check(label, Object.is(actual, expected), `(oczekiwano ${expected}, jest ${actual})`);
    },

    /** Porównanie liczb z tolerancją — do wartości zmiennoprzecinkowych. */
    close(label, actual, expected, epsilon = 1e-6) {
      this.check(
        label,
        Math.abs(Number(actual) - Number(expected)) <= epsilon,
        `(oczekiwano ~${expected}, jest ${actual})`
      );
    }
  };
}

/** Sumuje wartości worka { klucz: ilość } — powtarza się w kilku testach. */
export function sumBag(bag) {
  return Object.values(bag || {}).reduce((total, value) => total + (Number(value) || 0), 0);
}

/**
 * Uruchamia plik testowy bezpośrednio (`node scripts/tests/x.test.mjs`),
 * gdy nie został zaimportowany przez runner.
 *
 * Porównujemy PEŁNE ścieżki, nie końcówki nazw: `resources.test.mjs` kończy się
 * na „test.mjs", więc dopasowanie po basename uznawało go za skrypt uruchomiony
 * wprost i ubijało runner procesem exit po pierwszej suicie.
 */
export function runIfMain(importMetaUrl, runner) {
  if (!process.argv[1]) return;
  const self = fileURLToPath(importMetaUrl);
  const invoked = resolve(process.argv[1]);
  if (self !== invoked) return;
  const results = runner();
  console.log('');
  process.exit(results.failed ? 1 : 0);
}
