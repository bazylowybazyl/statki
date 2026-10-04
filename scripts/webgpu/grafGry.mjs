// Graf importów gry i rozpoznawanie GLSL / API WebGL — jedna definicja dla inwentarza portu
// (scripts/webgpu/inwentarz.mjs) i strażnika „gra bez GLSL i API WebGL” (tests/graBezGlsl.test.mjs).
//
//  - lekser JS (komentarze, napisy, szablony z zagnieżdżonym ${…}, wyrażenia regularne) oddziela kod od napisów;
//  - napis = GLSL, gdy ma ≥ 2 znaczniki (void main, gl_*, uniform/varying, vecN(, precision, #include…);
//  - graf: importy statyczne, dynamiczne import('…'), re-eksporty, new URL('…', import.meta.url) (workery),
//    skrypty modułowe strony HTML; od index.html = pliki ładowane przez grę (dema i narzędzia go nie dotykają);
//  - API WebGL liczone w samym kodzie (bez komentarzy i napisów), kontekst WebGL także w napisach.
// Bez zależności (Node ≥ 22).
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const rel = (p, root = repo) => relative(root, p).split('\\').join('/');

// ── Moduły poza portem osiągalne z grafu gry (decyzja użytkownika, PLAN §12 p. 1) ──────────────
// Jedyna dozwolona droga GLSL do grafu importów gry. Strażnik wymaga, żeby każdy wpis był nadal
// potrzebny (osiągalny z index.html i z GLSL / API WebGL) — zbędny wpis to błąd testu.
export const POZA_PORTEM = Object.freeze([]);

// ── Lekser ────────────────────────────────────────────────────────────────────
const REGEX_BEFORE_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);

export function lex(src) {
  const n = src.length;
  const noCom = src.split('');
  const codeOnly = src.split('');
  const strings = [];
  const stack = [{ type: 'code', depth: 0, inTpl: false }];
  let i = 0;
  let prevSig = '';
  let prevWord = '';
  const blank = (arr, a, b) => { for (let k = a; k < b; k++) if (arr[k] !== '\n' && arr[k] !== '\r') arr[k] = ' '; };
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];
    if (top.type === 'template') {
      if (c === '\\') { blank(codeOnly, i, i + 2); i += 2; continue; }
      if (c === '`') { top.tpl.end = i + 1; strings.push(top.tpl); stack.pop(); i++; prevSig = '`'; prevWord = ''; continue; }
      if (c === '$' && src[i + 1] === '{') { top.tpl.hasExpr = true; stack.push({ type: 'code', depth: 0, inTpl: true }); i += 2; continue; }
      if (c !== '\n' && c !== '\r') codeOnly[i] = ' ';
      i++;
      continue;
    }
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? n : e;
      blank(noCom, i, end); blank(codeOnly, i, end);
      i = end;
      continue;
    }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      const text = src.slice(i, end);
      // /* glsl */ przed szablonem zostaje w noCom jako znacznik
      if (!/^\/\*\s*glsl\s*\*\/$/.test(text)) { blank(noCom, i, end); }
      blank(codeOnly, i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      strings.push({ kind: c, start: i, end: j + 1 });
      blank(codeOnly, i + 1, j);
      i = j + 1;
      prevSig = c; prevWord = '';
      continue;
    }
    if (c === '`') { stack.push({ type: 'template', tpl: { kind: '`', start: i, end: -1, hasExpr: false } }); i++; continue; }
    if (c === '/') {
      const wordCtx = /[A-Za-z0-9_$]/.test(prevSig);
      const isRegex = prevSig === '' || (!wordCtx && '(,=:[!&|?{};+-*%<>~^'.includes(prevSig)) || (wordCtx && REGEX_BEFORE_WORD.has(prevWord));
      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const ch = src[j];
          if (ch === '\\') { j += 2; continue; }
          if (ch === '\n') break;
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) break;
          j++;
        }
        j++;
        while (j < n && /[a-z]/i.test(src[j])) j++;
        blank(codeOnly, i + 1, j - 1);
        i = j;
        prevSig = '/'; prevWord = '';
        continue;
      }
    }
    if (c === '{') top.depth++;
    if (c === '}') {
      if (top.inTpl && top.depth === 0) { stack.pop(); i++; continue; }
      top.depth--;
    }
    if (!/\s/.test(c)) {
      if (/[A-Za-z0-9_$]/.test(c)) {
        if (!/[A-Za-z0-9_$]/.test(prevSig)) prevWord = '';
        prevWord += c;
      } else prevWord = '';
      prevSig = c;
    }
    i++;
  }
  return { noCom: noCom.join(''), codeOnly: codeOnly.join(''), strings };
}

export const GLSL_MARKERS = [
  /\bvoid\s+main\s*\(/, /\bgl_(FragColor|Position|FragCoord|PointSize|PointCoord|FrontFacing|VertexID|InstanceID)\b/,
  /\buniform\s+(float|int|vec[234]|mat[234]|sampler\w*|bool|ivec\w*)\s+\w+/, /\bvarying\s+\w+\s+\w+/,
  /\bvec[234]\s*\(/, /\bprecision\s+(high|medium|low)p\b/, /#include\s*</, /\btexture2D\s*\(/, /#define\s+\w+/,
  /\b(float|vec[234]|mat[234])\s+\w+\s*\([^)]*\)\s*\{/, /\battribute\s+\w+\s+\w+/, /\bfract\s*\(|\bsmoothstep\s*\(/,
  /\bin\s+(float|vec[234])\s+\w+\s*;/, /\bout\s+(float|vec[234])\s+\w+\s*;/, /#ifdef\s+\w+|#endif\b/, /\btextureLod\s*\(/
];

export function glslScore(text) {
  let s = 0;
  for (const re of GLSL_MARKERS) if (re.test(text)) s++;
  return s;
}

export function lineOf(src, pos) {
  let l = 1;
  for (let i = 0; i < pos && i < src.length; i++) if (src.charCodeAt(i) === 10) l++;
  return l;
}

// Nazwa napisu: const NAZWA = `…`, NAZWA: `…`, vertexShader: `…`
export function nameOfString(noCom, start) {
  const before = noCom.slice(Math.max(0, start - 160), start).replace(/\/\*\s*glsl\s*\*\/\s*$/, '');
  let m = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
  if (m) return m[1];
  m = before.match(/([A-Za-z_$][\w$]*)\s*:\s*$/);
  if (m) return m[1] + ':';
  m = before.match(/([A-Za-z_$][\w$.]*)\s*(\+?=)\s*$/);
  if (m) return m[1] + m[2];
  return '';
}

// ── Pliki źródłowe → treść kodu (strony HTML: skrypty) ──────────────────────
export function scriptBlocks(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const body = m[2];
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/);
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/);
    out.push({ src: src ? src[1] : null, type: type ? type[1] : 'text/javascript', body, bodyStart });
  }
  return out;
}

export function loadSource(file) {
  const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (extname(file) !== '.html') return { raw, js: raw, offsets: null };
  // Kod skryptów wklejony w miejscu (reszta HTML zastąpiona spacjami, linie zachowane).
  const js = raw.replace(/[^\n]/g, ' ').split('');
  for (const b of scriptBlocks(raw)) {
    if (b.src || /importmap|json/.test(b.type)) continue;
    for (let k = 0; k < b.body.length; k++) js[b.bodyStart + k] = b.body[k];
  }
  return { raw, js: js.join(''), offsets: null };
}

// ── Importy ───────────────────────────────────────────────────────────────────
export function importsOf(file, noCom, raw) {
  const out = [];
  const add = (spec, kind, names = null) => out.push({ spec, kind, names });
  let m;
  const reStatic = /\bimport\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = reStatic.exec(noCom))) {
    const clause = m[1];
    const names = [];
    const braces = clause.match(/\{([\s\S]*?)\}/);
    if (braces) for (const part of braces[1].split(',')) { const t = part.trim(); if (!t) continue; const [orig, alias] = t.split(/\s+as\s+/); names.push({ orig: orig.trim(), local: (alias || orig).trim() }); }
    add(m[2], 'static', names);
  }
  const reSide = /\bimport\s+['"]([^'"]+)['"]/g;
  while ((m = reSide.exec(noCom))) add(m[1], 'side');
  const reDyn = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = reDyn.exec(noCom))) add(m[1], 'dynamic');
  const reRe = /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = reRe.exec(noCom))) add(m[1], 'reexport');
  const reUrl = /new\s+URL\(\s*['"]([^'"]+\.m?js)['"]\s*,\s*import\.meta\.url\s*\)/g;
  while ((m = reUrl.exec(noCom))) add(m[1], 'worker');
  if (extname(file) === '.html') {
    for (const b of scriptBlocks(raw)) {
      if (!b.src || !/module/.test(b.type) || /^[a-z]+:/i.test(b.src)) continue;
      add(/^[./]/.test(b.src) ? b.src : `./${b.src}`, 'script');
    }
  }
  return out;
}

export function resolveSpec(fromFile, spec, root = repo) {
  if (!/^[./]/.test(spec)) return null; // gołe (three, three/webgpu…)
  let base = spec.startsWith('/') ? join(root, spec) : join(dirname(fromFile), spec);
  base = base.split('?')[0];
  const candidates = [base, `${base}.js`, `${base}.mjs`, join(base, 'index.js')];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

// ── Graf importów ─────────────────────────────────────────────────────────────
// Pliki osiągalne z `wejscie` (ścieżka względem repo): Map rel → { imports } — z `skan: true` także
// { glsl, webgl } każdego pliku (jeden przebieg leksera na plik).
export function grafImportow(wejscie = 'index.html', root = repo, { skan = false } = {}) {
  const out = new Map();
  const q = [wejscie];
  while (q.length) {
    const r = q.pop();
    if (out.has(r)) continue;
    const abs = join(root, r);
    const { raw, js } = loadSource(abs);
    const { noCom, codeOnly, strings } = lex(js);
    const rawImports = importsOf(abs, noCom, raw);
    const imports = rawImports.map((x) => {
      const res = resolveSpec(abs, x.spec, root);
      return { ...x, resolved: res ? rel(res, root) : null };
    });
    const entry = { imports };
    if (skan) {
      entry.glsl = blokiGlsl(js, noCom, strings);
      entry.webgl = trafieniaWebgl(noCom, codeOnly, rawImports);
    }
    out.set(r, entry);
    for (const imp of imports) if (imp.resolved) q.push(imp.resolved);
  }
  return out;
}

// ── GLSL i API WebGL (strażnik) ────────────────────────────────────────────────
// Wzorce API WebGL / postprocessingu WebGL w KODZIE (komentarze i napisy wyczyszczone). Metody wspólne
// z WebGPURenderer (initTexture, initRenderTarget, compileAsync, customProgramCacheKey węzłów) się nie liczą.
export const WEBGL_API = Object.freeze([
  { co: 'WebGLRenderer', re: /\bWebGL1?Renderer\b/g },
  { co: 'cel renderu WebGL', re: /\bWebGL(?:3D|Array|Cube|Multiple)?RenderTargets?\b/g },
  { co: 'ShaderMaterial', re: /\bnew\s+(?:THREE\.)?(?:Raw)?ShaderMaterial\s*\(/g },
  { co: 'onBeforeCompile', re: /\bonBeforeCompile\b/g },
  { co: 'postprocessing WebGL', re: /\b(?:EffectComposer|UnrealBloomPass|ShaderPass|OutputPass|RenderPass|FullScreenQuad)\b/g },
  { co: 'rozszerzenie WebGL', re: /\bgetExtension\s*\(/g },
  { co: 'wywołanie kontekstu WebGL', re: /\bgl\.(?:getParameter|getExtension|createShader|shaderSource|compileShader|createProgram|linkProgram|useProgram|bindBuffer|bufferData|bindFramebuffer|bindTexture|texImage2D|drawArrays|drawElements|readPixels|getShaderInfoLog)\s*\(/g },
  { co: 'stan WebGLRenderer', re: /\brenderer\.(?:state|properties|capabilities|extensions)\b/g }
]);
// Kontekst WebGL: nazwa kontekstu jest napisem — szukane w kodzie z napisami (bez komentarzy).
const WEBGL_CONTEXT = /\.getContext\(\s*['"](?:webgl2?|experimental-webgl)['"]/g;
// Import postprocessingu / shaderów GLSL z przykładów three.
const WEBGL_IMPORT = /^three\/(?:addons|examples\/jsm)\/(?:postprocessing|shaders)\//;

/**
 * Trafienia API WebGL w już zleksowanym pliku: `noCom` (bez komentarzy), `codeOnly` (bez komentarzy
 * i napisów), `imports` (importsOf). Zwraca [{ linia, co, tekst }] — `co` to nazwa wzorca z WEBGL_API
 * (albo „kontekst WebGL” / „import postprocessingu WebGL”).
 */
export function trafieniaWebgl(noCom, codeOnly, imports = []) {
  const out = [];
  for (const { co, re } of WEBGL_API) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(codeOnly))) out.push({ linia: lineOf(codeOnly, m.index), co, tekst: m[0].trim() });
  }
  WEBGL_CONTEXT.lastIndex = 0;
  let m;
  while ((m = WEBGL_CONTEXT.exec(noCom))) out.push({ linia: lineOf(noCom, m.index), co: 'kontekst WebGL', tekst: m[0] });
  for (const imp of imports) {
    if (WEBGL_IMPORT.test(imp.spec)) out.push({ linia: 0, co: 'import postprocessingu WebGL', tekst: imp.spec });
  }
  return out;
}

/** Bloki GLSL (napisy z ≥ 2 znacznikami) w zleksowanym pliku: [{ linia, linie, nazwa, start, end }]. */
export function blokiGlsl(js, noCom, strings) {
  const out = [];
  for (const s of strings) {
    const text = js.slice(s.start, s.end);
    if (glslScore(text) >= 2) {
      out.push({ linia: lineOf(js, s.start), linie: (text.match(/\n/g) || []).length + 1, nazwa: nameOfString(noCom, s.start), start: s.start, end: s.end });
    }
  }
  return out;
}

/**
 * GLSL i API WebGL w jednym pliku (ścieżka względem repo).
 * @returns {{ glsl: {linia, linie, nazwa}[], webgl: {linia, co, tekst}[] }}
 */
export function skanujGlslWebgl(plik, root = repo) {
  const abs = join(root, plik);
  const { raw, js } = loadSource(abs);
  const { noCom, codeOnly, strings } = lex(js);
  return { glsl: blokiGlsl(js, noCom, strings), webgl: trafieniaWebgl(noCom, codeOnly, importsOf(abs, noCom, raw)) };
}
