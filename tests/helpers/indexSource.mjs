// Wycinanie funkcji z index.html do testów w node.
//
// Gra żyje w jednym wielkim <script type="module"> — nie da się go zaimportować.
// Test wycina tekst funkcji po nagłówku i buduje ją z jawnym zakresem: nazwy,
// których funkcja używa, a które w grze są zmiennymi modułu (ship, PLAYER,
// bullets, …), podajemy w obiekcie `scope`. Reszta (Math, Number, …) idzie
// z globali node.

import { readFileSync } from 'node:fs';

export function readIndexHtml() {
  return readFileSync(new URL('../../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

export function sliceFunction(source, header) {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`brak: ${header}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`niedomknięta funkcja: ${header}`);
}

// `with` działa, bo ciało `new Function` nie jest w trybie ścisłym. Zakres jest
// żywy: test może podmieniać pola `scope` między wywołaniami.
export function loadIndexFunction(source, header, name, scope = {}) {
  const text = sliceFunction(source, header);
  return new Function('__scope', `with (__scope) {\n${text}\nreturn ${name};\n}`)(scope);
}
