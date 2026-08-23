// Sprawdza, czy kod odwoluje sie do nazw, ktore nigdzie nie istnieja — ani jako
// deklaracja, ani import, ani globalna `window.X`.
//
// Po co: `node --check` lapie tylko skladnie, a `vite build` nie rusza globalnych.
// Symbol wyciety z index.html do modulu i zapomniany w imporcie przechodzi oba,
// a wywala sie dopiero przy starcie gry (ReferenceError w trakcie ewaluacji
// modulu — a wtedy wszystkie pozniejsze `const` zostaja w TDZ i sypie sie lawina
// bledow "Cannot access 'X' before initialization"; szukaj PIERWSZEGO bledu).
//
// Sprawdza glowny <script type="module"> z index.html ORAZ moduly wyciagniete
// z niego do src/ (lista MODULY nizej) — bo blad rownie dobrze moze wyladowac
// po stronie modulu (np. import sprite'a zostal w index.html).
//
//   node scripts/sprawdz-symbole.mjs
//
// Kod wyjscia 1, jesli cos nie istnieje.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Moduly wyciagniete z index.html — te sprawdzamy tak samo ostro jak glowny skrypt.
// Reszta src/ ma wlasna historie i celowo korzysta z globalnych, wiec ja pomijamy.
const MODULY = [
  'src/ui/perfHud.js',
  'src/ui/liveDebug.js',
  'src/ui/targetingReticles.js',
  'src/data/playerHullCatalog.js',
  'src/vfx/warpLensPass.js',
  'src/game/gameState.js'
];

// Znane, wczesniej istniejace dziury — trzymamy jawnie, zeby nie halasowaly.
//   AISPACE_MISSILES / AISPACE_PD — uzywane, nigdzie niezdefiniowane; wybuchna
//     tylko gdy bron ma ustawione aispaceMissileId / aispacePdId.
//   ApplyCheats / drawSunDirection — opcjonalne haki dev, wolane wylacznie
//     za straznikiem `if (window.X)`, wiec brak definicji jest bezpieczny.
const ZNANE_BRAKI = new Set(['AISPACE_MISSILES', 'AISPACE_PD', 'ApplyCheats', 'drawSunDirection']);

const BUILTIN = new Set((
  'const let var function class return if else for while do switch case break continue new typeof instanceof in of ' +
  'delete void yield await async try catch finally throw default export import extends super static get set this ' +
  'arguments true false null undefined NaN Infinity as from $ ' +
  'window document console Math JSON Object Array String Number Boolean Set Map WeakMap WeakSet Promise Symbol Date ' +
  'RegExp Error TypeError RangeError Intl performance navigator location localStorage sessionStorage globalThis ' +
  'requestAnimationFrame cancelAnimationFrame requestIdleCallback setTimeout clearTimeout setInterval clearInterval ' +
  'fetch Image Audio Blob URL URLSearchParams File FileReader Worker BroadcastChannel SharedArrayBuffer ArrayBuffer ' +
  'Float32Array Float64Array Int8Array Int16Array Int32Array Uint8Array Uint8ClampedArray Uint16Array Uint32Array ' +
  'DataView Proxy Reflect BigInt parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent ' +
  'structuredClone CustomEvent Event EventTarget DOMParser XMLHttpRequest AbortController TextEncoder TextDecoder ' +
  'queueMicrotask innerWidth innerHeight devicePixelRatio screen alert confirm prompt getComputedStyle matchMedia ' +
  'ResizeObserver IntersectionObserver MutationObserver PerformanceObserver OffscreenCanvas Path2D ImageData crypto ' +
  'Node HTMLElement HTMLCanvasElement CanvasRenderingContext2D WebGL2RenderingContext WebGLRenderingContext ' +
  'AudioContext webkitAudioContext GainNode scrollX scrollY top parent self'
).split(/\s+/));

// --- globalne ustawiane gdziekolwiek w projekcie ---
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}
let projectText = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const f of walk(path.join(ROOT, 'src'))) projectText += '\n' + fs.readFileSync(f, 'utf8');
for (const extra of ['shieldSystem.js']) {
  const p = path.join(ROOT, extra);
  if (fs.existsSync(p)) projectText += '\n' + fs.readFileSync(p, 'utf8');
}
const GLOBALNE = new Set();
for (const m of projectText.matchAll(/(?:window|globalThis)\.([A-Za-z0-9_$]+)\s*(?:\?\?|\|\||&&)?=/g)) GLOBALNE.add(m[1]);

const blank = (s) => s.replace(/[^\n]/g, ' ');

/** Wycina komentarze, stringi, szablony i literaly regex — numeracja linii zostaje. */
function oczysc(raw) {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    // `(^|...)` z flaga m — inaczej komentarz w pierwszej linii pliku zostaje
    .replace(/(^|[^:\\])\/\/[^\n]*/gm, (m, p) => p + blank(m.slice(p.length)))
    .replace(/'(?:\\.|[^'\\\n])*'/g, (m) => "'" + ' '.repeat(Math.max(0, m.length - 2)) + "'")
    .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => '"' + ' '.repeat(Math.max(0, m.length - 2)) + '"')
    .replace(/`[\s\S]*?`/g, (m) => '`' + blank(m.slice(1, -1)) + '`')
    .replace(/([=(,:[!&|?+{;]\s*)\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuyd]*/g,
      (m, p) => p + blank(m.slice(p.length)));
}

/** Zbiera wszystko, co w danym kodzie jest zadeklarowane lub zaimportowane. */
function zebranyZakres(src) {
  const d = new Set();
  const addAll = (re) => { for (const m of src.matchAll(re)) if (m[1]) d.add(m[1]); };
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g))
    for (const p of m[1].split(',')) for (const n of p.trim().split(/\s+as\s+/)) if (n.trim()) d.add(n.trim());
  addAll(/import\s+([A-Za-z0-9_$]+)\s*(?:,|from)/g);
  addAll(/import\s+\*\s+as\s+([A-Za-z0-9_$]+)/g);
  addAll(/class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g);
  addAll(/(?:async\s+)?function\s*\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)/g);
  addAll(/catch\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/g);
  // pojedyncza nazwa tuz po slowie kluczowym — lapie tez `const` zagniezdzone
  // w jednolinijkowym ciele funkcji, ktore przelknelby wzorzec wielokrotny nizej
  addAll(/(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g);
  // deklaracje wielokrotne: `let a = 0, b = 0, c = 0;`
  for (const m of src.matchAll(/(?:const|let|var)\s+([^;\n]+)/g))
    for (const part of m[1].split(',')) {
      const n = part.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) d.add(n);
    }
  // destrukturyzacje i parametry — celowo nadmiarowo (falszywy "jest" > falszywy alarm)
  for (const re of [/\{([^{}]*)\}/g, /\(([^()]*)\)/g, /\[([^\[\]]*)\]/g])
    for (const m of src.matchAll(re))
      for (const part of m[1].split(',')) {
        const n = part.split('=')[0].split(':').pop().trim().replace(/^\.\.\./, '').replace(/[{}\[\]]/g, '');
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) d.add(n);
      }
  // metody skrocone, `for (const x of ...)`, arrow z jednym parametrem
  // metoda skrocona; lista parametrow moze miec jeden poziom nawiasow,
  // np. `flush(now = performance.now(), force = false) {`
  for (const m of src.matchAll(/(?:^|[\s{,;])(?:async\s+|\*\s*|get\s+|set\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\((?:[^()]|\([^()]*\))*\)\s*\{/g)) d.add(m[1]);
  // parametry takiej metody
  for (const m of src.matchAll(/(?:^|[\s{,;])[A-Za-z_$][A-Za-z0-9_$]*\s*\(((?:[^()]|\([^()]*\))*)\)\s*\{/g))
    for (const part of m[1].split(',')) {
      const n = part.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) d.add(n);
    }
  for (const m of src.matchAll(/for\s*(?:await\s*)?\(\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+(?:of|in)\b/g)) d.add(m[1]);
  for (const m of src.matchAll(/(?:^|[\s(,[=])([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g)) d.add(m[1]);
  return d;
}

/** Zwraca [nazwa, [linie]] dla referencji bez pokrycia. `offset` = numer pierwszej linii. */
function sprawdz(raw, offset) {
  const src = oczysc(raw);
  const defined = zebranyZakres(src);
  const lineOf = [];
  { let n = 1; for (const ch of src) { lineOf.push(n); if (ch === '\n') n++; } }
  const missing = new Map();
  const RE = /(^|[^.\w$])([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let m;
  while ((m = RE.exec(src)) !== null) {
    const name = m[2];
    const at = m.index + m[1].length;
    if (/^\s*:/.test(src.slice(at + name.length))) continue; // klucz obiektu
    if (defined.has(name) || BUILTIN.has(name) || GLOBALNE.has(name) || ZNANE_BRAKI.has(name)) continue;
    if (!missing.has(name)) missing.set(name, []);
    const arr = missing.get(name);
    if (arr.length < 4) arr.push(lineOf[at] + offset - 1);
  }
  return [...missing.entries()].sort((a, b) => a[1][0] - b[1][0]);
}

// --- glowny <script type="module"> z index.html ---
const all = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').split('\n');
const blocks = [];
let open = -1;
for (let i = 0; i < all.length; i++) {
  const t = all[i].trim();
  if (t === '<script type="module">') open = i;
  else if (t === '</script>' && open >= 0) { blocks.push([open + 2, i]); open = -1; }
}
if (!blocks.length) { console.error('nie znalazlem zadnego <script type="module">'); process.exit(1); }
blocks.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
const [A, B] = blocks[0];

const cele = [[`index.html (glowny skrypt, L${A}-${B})`, all.slice(A - 1, B).join('\n'), A]];
for (const rel of MODULY) {
  const p = path.join(ROOT, rel);
  if (fs.existsSync(p)) cele.push([rel, fs.readFileSync(p, 'utf8'), 1]);
  else console.log(`(pominieto, brak pliku: ${rel})`);
}

let bledy = 0;
for (const [nazwa, kod, offset] of cele) {
  const braki = sprawdz(kod, offset);
  if (!braki.length) { console.log('OK   ' + nazwa); continue; }
  bledy += braki.length;
  console.log('BRAK ' + nazwa);
  for (const [n, ls] of braki) console.log('       ' + n.padEnd(32) + ' L' + ls.join(', L'));
}
console.log(bledy
  ? `\nBRAK POKRYCIA: ${bledy} — te nazwy nie maja deklaracji, importu ani globalnej.`
  : '\nOK — kazda uzyta nazwa ma deklaracje, import albo globalna.');
process.exit(bledy ? 1 : 0);
