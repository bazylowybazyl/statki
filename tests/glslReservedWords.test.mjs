import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// three.js kompiluje ShaderMaterial na WebGL2 jako GLSL ES 3.00. Nazwa zmiennej,
// która jest tam słowem zarezerwowanym, wywala CAŁY program shadera — a efekt
// kompiluje się dopiero przy pierwszym użyciu, więc błąd wychodzi w grze, nie
// przy starcie. Tak padła tarcza-obrys na `float patch` (2026-09-23).
const RESERVED = new Set((
  // słowa kluczowe, które łatwo omyłkowo wziąć na nazwę
  'in out inout flat smooth centroid layout invariant precision lowp mediump highp uniform buffer shared ' +
  'switch case default struct discard return true false ' +
  // zarezerwowane na przyszłość (GLSL ES 3.00 §3.7)
  'attribute varying coherent volatile restrict readonly writeonly resource atomic_uint noperspective patch ' +
  'sample subroutine common partition active asm class union enum typedef template this goto inline noinline ' +
  'public static extern external interface long short double half fixed unsigned superp input output ' +
  'hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 sampler3DRect filter sizeof cast namespace using ' +
  // three w trybie GLSL3 robi `#define texture2D texture` — zmienna `texture`
  // przesłania funkcję i psuje każde texture2D() po niej
  'texture'
).split(/\s+/));

const TYPE = '(?:float|int|uint|bool|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234](?:x[234])?|sampler2D|samplerCube|sampler3D|void)';
const DECLARATION = new RegExp('\\b' + TYPE + '\\s+([A-Za-z_]\\w*)', 'g');
// Deklaracje listowe: `float a = 0.0, patch = 1.0;`
const LIST_DECLARATION = new RegExp('\\b' + TYPE + '\\s+[^;(){}]*?,\\s*([A-Za-z_]\\w*)\\s*(?:=|,|;)', 'g');

const repo = fileURLToPath(new URL('..', import.meta.url));

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.m?js$/.test(name)) yield path;
  }
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

test('shadery nie używają słów zarezerwowanych GLSL ES 3.00 jako nazw', () => {
  const files = [...sourceFiles(join(repo, 'src')), join(repo, 'index.html')];
  const problems = [];
  let shaders = 0;

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const templates = /`([^`]*)`/g;
    let match;
    while ((match = templates.exec(text))) {
      const body = match[1];
      if (!/\bvoid\s+main\s*\(|gl_FragColor|gl_Position/.test(body)) continue;
      shaders++;
      const code = stripComments(body);
      for (const pattern of [DECLARATION, LIST_DECLARATION]) {
        pattern.lastIndex = 0;
        let declaration;
        while ((declaration = pattern.exec(code))) {
          if (!RESERVED.has(declaration[1])) continue;
          const line = text.slice(0, match.index).split('\n').length;
          problems.push(`${relative(repo, file)} (szablon od linii ${line}): "${declaration[0].trim()}"`);
        }
      }
    }
  }

  assert.ok(shaders > 50, `skaner ma widzieć shadery gry, znalazł ${shaders}`);
  assert.deepEqual(problems, [], 'zmień nazwy — na WebGL2 te shadery się nie skompilują:\n' + problems.join('\n'));
});
