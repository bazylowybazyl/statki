// Strażnik portu WebGPU (zadanie 24): gra nie ładuje GLSL ani API WebGL.
//
// „Gra” = pliki osiągalne z index.html w grafie importów (statyczne, dynamiczne import('…'), re-eksporty,
// workery new URL('…', import.meta.url), skrypty modułowe strony) — ten sam kod grafu i rozpoznawania GLSL
// co inwentarz portu (scripts/webgpu/grafGry.mjs), bez ręcznej listy plików; dema i narzędzia spoza gry
// nie wchodzą (graf, nie glob). Wyjątki: POZA_PORTEM w grafGry.mjs — moduły poza portem wg decyzji
// użytkownika (PLAN §12 p. 1), każdy z powodem; wpis, który przestał być potrzebny, też jest błędem.
// Magentowy zamiennik (src/3d/tsl/zamiennik.js) zostaje jako bezpiecznik w biegu (ShaderMaterial spoza
// repo, np. z dodatków three) — ten test pilnuje kodu repo przed uruchomieniem.
//
// Dawny strażnik słów zarezerwowanych GLSL ES 3.00 (tests/glslReservedWords.test.mjs) jest niżej —
// dla GLSL, który został POZA grą (dema destruktora na własnym WebGLRenderer, moduły Z4/Z5/Z7 na tagu).
// node --test tests/graBezGlsl.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  POZA_PORTEM, blokiGlsl, grafImportow, importsOf, lex, trafieniaWebgl
} from '../scripts/webgpu/grafGry.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const graf = grafImportow('index.html', repo, { skan: true });
const wyjatki = new Map(POZA_PORTEM.map((w) => [w.plik, w.powod]));

test('gra (graf importów od index.html) bez GLSL i API WebGL', () => {
  // Graf naprawdę obejmuje grę: rdzeń renderu, post, efekty, ring, pas asteroid, workery.
  assert.ok(graf.size > 250, `graf gry: tylko ${graf.size} plików`);
  for (const f of ['src/3d/core3d.js', 'src/3d/tsl/postGry.js', 'src/3d/weapons/weaponFx.js',
    'src/3d/haloRing/haloRingTSL.js', 'src/3d/asteroids/asteroidBelt.js', 'src/game/asteroidGiantWorker.js']) {
    assert.ok(graf.has(f), `graf gry nie sięga ${f}`);
  }
  assert.deepEqual([...graf.keys()].filter((f) => /^(dema|scripts|tests)\//.test(f)), [], 'graf gry sięga dem / narzędzi');

  const problemy = [];
  for (const [plik, e] of graf) {
    if (wyjatki.has(plik)) continue;
    for (const g of e.glsl) problemy.push(`${plik}:${g.linia} GLSL ${g.nazwa || 'napis'} (${g.linie} linii)`);
    for (const w of e.webgl) problemy.push(`${plik}:${w.linia} ${w.co}: ${w.tekst}`);
  }
  assert.deepEqual(problemy, [],
    'gra na WebGPU: nowy kod renderu tylko w TSL (agents.md § Render: WebGPU + TSL) — bez GLSL, ShaderMaterial, ' +
    'onBeforeCompile, WebGLRenderer / celów WebGL, EffectComposer i kontekstu WebGL:\n' + problemy.join('\n'));
});

test('POZA_PORTEM: każdy wyjątek ma powód, jest osiągalny z gry i nadal potrzebny', () => {
  for (const { plik, powod } of POZA_PORTEM) {
    assert.ok(typeof powod === 'string' && powod.length > 20, `${plik}: brak powodu wyjątku`);
    const e = graf.get(plik);
    assert.ok(e, `${plik}: gra już go nie ładuje — usuń wpis z POZA_PORTEM (scripts/webgpu/grafGry.mjs)`);
    assert.ok(e.glsl.length || e.webgl.length, `${plik}: bez GLSL i API WebGL — usuń wpis z POZA_PORTEM`);
  }
});

// Detektor na atrapie: to, co ma łapać, i to, czego nie może (komentarze, napisy, TSL, API wspólne z WebGPU).
test('wykrywanie: GLSL, ShaderMaterial, WebGLRenderer, EffectComposer, kontekst WebGL; nie komentarze ani TSL', () => {
  const zle = [
    'const frag = `void main() { gl_FragColor = vec4(1.0); }`;',
    'const m = new THREE.ShaderMaterial({ fragmentShader: frag });',
    'const r = new THREE.WebGLRenderer({ canvas });',
    'const rt = new THREE.WebGLRenderTarget(4, 4);',
    'const c = new EffectComposer(r);',
    "const gl = canvas.getContext('webgl2');",
    'mat.onBeforeCompile = (s) => s;',
    "import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';"
  ].join('\n');
  const a = lex(zle);
  assert.equal(blokiGlsl(zle, a.noCom, a.strings).length, 1, 'szablon GLSL');
  const co = trafieniaWebgl(a.noCom, a.codeOnly, importsOf('atrapa.js', a.noCom, zle)).map((t) => t.co).sort();
  assert.deepEqual(co, ['ShaderMaterial', 'WebGLRenderer', 'cel renderu WebGL', 'import postprocessingu WebGL',
    'kontekst WebGL', 'onBeforeCompile', 'postprocessing WebGL', 'postprocessing WebGL'].sort());

  const dobre = [
    "import * as THREE from 'three/webgpu';",
    "import { Fn, float, vec3, fract, length, select, smoothstep, wgslFn } from 'three/tsl';",
    '// dawny WebGLRenderer, EffectComposer i new THREE.ShaderMaterial( — tylko w komentarzu',
    "const nazwa = 'WebGLRenderer'; // napis, nie kod",
    'const gl = length(vec3(1, 2, 3)); const n = select(gl.greaterThan(1e-5), vec3(0), vec3(1));',
    'renderer.initTexture(tex); renderer.initRenderTarget(rt); renderer.compileAsync(scena, kamera);',
    'const k = smoothstep(0.2, 0.8, fract(float(1.5)));',
    'const fma = wgslFn(`fn haloFma(a: f32, b: f32, c: f32) -> f32 { return fma(a, b, c); }`);'
  ].join('\n');
  const b = lex(dobre);
  assert.deepEqual(blokiGlsl(dobre, b.noCom, b.strings), [], 'TSL i WGSL to nie GLSL');
  assert.deepEqual(trafieniaWebgl(b.noCom, b.codeOnly, importsOf('atrapa.js', b.noCom, dobre)), []);
});

// ── GLSL poza grą: słowa zarezerwowane GLSL ES 3.00 ──────────────────────────────────────────────
// three kompiluje ShaderMaterial na WebGL2 jako GLSL ES 3.00. Nazwa zmiennej, która jest tam słowem
// zarezerwowanym, wywala CAŁY program shadera — a efekt kompiluje się dopiero przy pierwszym użyciu,
// więc błąd wychodzi w demie, nie przy starcie. Tak padła tarcza-obrys na `float patch` (2026-09-23).
// Po porcie GLSL ma tylko kod poza grą (moduły Z4/Z5/Z7 i dema destruktora na WebGL).
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

test('GLSL poza grą (dema na WebGL, moduły poza portem): bez słów zarezerwowanych GLSL ES 3.00 jako nazw', () => {
  const files = [...sourceFiles(join(repo, 'src')), join(repo, 'index.html')];
  const problems = [];
  let shaders = 0;

  for (const file of files) {
    const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
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

  assert.ok(shaders >= 0, `skaner: ${shaders} szablonów GLSL`);
  assert.deepEqual(problems, [], 'zmień nazwy — na WebGL2 te shadery się nie skompilują:\n' + problems.join('\n'));
});
