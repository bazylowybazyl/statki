// Inwentarz portu WebGPU: co w kodzie zależy od GLSL / WebGL i ile tego jest.
// Bez zależności; uruchamiany wielokrotnie mierzy postęp portu.
//
//   node scripts/webgpu/inwentarz.mjs [--md docs/webgpu/INWENTARZ.md] [--json .tmp/webgpu/inwentarz.json] [--cicho]
//
// Metoda:
//  - pliki: src/**/*.js|mjs, pliki .js w katalogu głównym (planet3d.proc.js, Engineeffects.js…),
//    skrypty modułowe z index.html; dla dem i narzędzi — strony HTML w dema/, scripts/ i w katalogu głównym;
//  - lekser JS (komentarze, napisy, szablony z zagnieżdżonym ${…}, wyrażenia regularne) oddziela kod od napisów;
//  - napis = GLSL, gdy ma ≥ 2 znaczniki (void main, gl_*, uniform/varying, vecN(, precision, #include…);
//    „linie GLSL” = linie takich napisów (szablon liczony w całości, z ${…});
//  - liczniki API liczone w samym kodzie (bez komentarzy i napisów);
//  - zasięg: graf importów (statyczne, dynamiczne import('…'), new URL('…', import.meta.url)) od index.html
//    = „gra”; od stron dem / narzędzi = „dema”; reszta = „nieużywany”;
//  - status TSL: plik bez GLSL, który importuje three/tsl albo three/webgpu (albo ma sąsiada *.tsl.js).
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '1') : d; };
const OUT_MD = arg('md', 'docs/webgpu/INWENTARZ.md');
const OUT_JSON = arg('json', '.tmp/webgpu/inwentarz.json');
const QUIET = !!arg('cicho');

// ── Zakres portu (decyzje użytkownika, docs/webgpu/POSTEP.md) ─────────────────
// Kolejność ma znaczenie: pierwsze trafienie wygrywa.
const SCOPE_RULES = [
  { re: /^src\/3d\/(warpLens3D|warpFx3D|warpWorldLens)\.js$|^src\/vfx\/warpLensPass\.js$/, tag: 'warp', label: 'poza portem — warp (nowy warp wejdzie w TSL)' },
  // Asteroidy: stare pole, tło pasa i klej WebGL usunięte w zadaniu 21 — pas z dema WebGPU jest w porcie (src/3d/asteroids/).
  { re: /^planet3d\.proc\.js$/, tag: 'legacy', label: 'legacy — nieużywany (do usunięcia)' }
];

// Uwagi ręczne do tabel (to, czego skan nie wyczyta).
const NOTES = {
  'src/3d/core3d.js': 'serce portu: WebGPURenderer, passy sceny (zadanie 01), post w TSL — bloom i uber z gorącym powietrzem w src/3d/tsl/postGry.js (zadanie 02); pass maski słońca w TSL (zadanie 03); fala z refrakcją i jej snapshot usunięte (zadanie 19 — zniekształcenia efektów); soczewka i fale warpa usunięte',
  'src/3d/hexShips3D.js': 'kadłuby = gałąź beam (BEAM_SKIN + HEX_FRAGMENT); gałąź heksów (HEX/ARMOR/DEBRIS, pula szczątków GPU) w grze rysuje tylko wyłączone asteroidy, ale stoją na niej mostki-demo, rdzen-demo i pomiar drżenia → port w zadaniu 04',
  'src/effects3d/overlay.js': 'DRUGI WebGLRenderer (overlay3D eksplozji, własny composer i bloom; rakiety i iskry od zadania 19 w Core3D) — zostaje w porcie, usuwa go zadanie 20',
  // Zastąpione efektami z dem WebGPU (decyzja użytkownika 2026-09-27, PLAN §1 p. 6) — nie przenosimy 1:1.
  'src/3d/slugTrail3D.js': 'zastąpi TrailSystem z dema broni (zadanie 17)',
  'src/3d/muzzleFx3D.js': 'zastąpią receptury dema broni (zadanie 17)',
  'src/3d/railgunFx3D.js': 'zastąpią receptury dema broni (zadanie 17)',
  'src/3d/sparkSystem3D.js': 'API iskier gry na puli z dema rakiet (src/3d/rockets/sparks.js) w scenie Core3D — zadanie 19',
  'src/effects3d/yamato.js': 'scena overlay; zastąpią receptury dema broni (zadanie 17)',
  'src/effects3d/railgunExplosion.js': 'scena overlay; zastąpią receptury dema broni (zadanie 17)',
  'src/effects3d/armataImpact.js': 'scena overlay; zastąpią receptury dema broni (zadanie 17)',
  'src/effects3d/autocannonImpact.js': 'scena overlay; zastąpią receptury dema broni (zadanie 17)',
  'src/effects3d/rocketSystem3D.js': 'lot i trafienia rakiet (rozgrywka); wygląd — reżyser efektów z dema rakiet w Core3D (src/3d/rockets/, zadanie 19)',
  'src/effects3d/reactorblow.js': 'scena overlay; port do Core3D w zadaniu 20',
  'src/3d/fxParticles3D.js': 'Fx3D: port 1:1 w zadaniu 12 (dysze MAIN, mostki, rdzenie)',
  'Engineeffects.js': 'tylko tekstury poświaty dysz SIDE (make*Texture); martwe getEngineVFX z własnym WebGLRenderer i shader usunięte (zadanie 13)',
  'src/3d/sunShadowMask.js': 'biblioteka maski słońca w TSL (screenUV) + hak wbudowanych materiałów (setupLightingModel / outputNode) — zadanie 03',
  'src/3d/sunShadowMaskGLSL.js': 'LEGACY: GLSL maski dla nieprzeniesionych ShaderMaterial (planety 05, mostek 15, Z4/Z5/Z7; asteroidy — 21 zrobione) — znika z ostatnim z nich (24)',
  'src/3d/hullShadowSdf.js': 'biblioteka SDF kadłubów; marsz w TSL (hullSdfShadow, zadanie 03); lustro CPU traceHullShadowCpu (test)',
  'src/3d/haloRing/haloRingWorldGen.js': 'pieczenie map + odczyt CPU (WebGPU: asynchronicznie, bez odwracania osi — zadanie 06)',
  'src/3d/menuBackdrop3D.js': 'rozgrzewka po kluczu programu WebGL — do przeprojektowania',
  'src/vfx/destruction3D.js': 'zniszczenie stacji',
  'src/vfx/shatterMaterial.js': 'zniszczenie stacji',
  'src/3d/coldWreckImpostors.js': 'uśpione (wymaga hexGrid)',
  'src/3d/asteroids/asteroidBelt.js': 'pas asteroid z dema WebGPU (zadanie 21): klej klatki jako krok Core3D.fx, warstwy passów gry i tła',
  'src/3d/asteroids/beltMedium.js': 'ośrodek objętościowy pasa (zadanie 21) — czytają go skały, minerały, olbrzymy i kadłuby (hak hullVolume)'
};

// ── Pliki ─────────────────────────────────────────────────────────────────────
function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}
const rel = (p) => relative(repo, p).split('\\').join('/');
const isJs = (p) => /\.(m?js)$/.test(p);

const srcFiles = walk(join(repo, 'src'), isJs);
const rootJs = readdirSync(repo).filter((n) => /\.m?js$/.test(n) && !/^vite\.config/.test(n)).map((n) => join(repo, n));
const pages = [
  ...walk(join(repo, 'dema'), (p) => /\.html$/.test(p)),
  ...walk(join(repo, 'scripts'), (p) => /\.html$/.test(p)),
  ...readdirSync(repo).filter((n) => /\.html$/.test(n) && n !== 'index.html').map((n) => join(repo, n))
];
const toolJs = [
  ...walk(join(repo, 'dema'), isJs),
  ...walk(join(repo, 'scripts'), isJs)
];

// ── Lekser ────────────────────────────────────────────────────────────────────
const REGEX_BEFORE_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);

function lex(src) {
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

const GLSL_MARKERS = [
  /\bvoid\s+main\s*\(/, /\bgl_(FragColor|Position|FragCoord|PointSize|PointCoord|FrontFacing|VertexID|InstanceID)\b/,
  /\buniform\s+(float|int|vec[234]|mat[234]|sampler\w*|bool|ivec\w*)\s+\w+/, /\bvarying\s+\w+\s+\w+/,
  /\bvec[234]\s*\(/, /\bprecision\s+(high|medium|low)p\b/, /#include\s*</, /\btexture2D\s*\(/, /#define\s+\w+/,
  /\b(float|vec[234]|mat[234])\s+\w+\s*\([^)]*\)\s*\{/, /\battribute\s+\w+\s+\w+/, /\bfract\s*\(|\bsmoothstep\s*\(/,
  /\bin\s+(float|vec[234])\s+\w+\s*;/, /\bout\s+(float|vec[234])\s+\w+\s*;/, /#ifdef\s+\w+|#endif\b/, /\btextureLod\s*\(/
];

function glslScore(text) {
  let s = 0;
  for (const re of GLSL_MARKERS) if (re.test(text)) s++;
  return s;
}

function lineOf(src, pos) {
  let l = 1;
  for (let i = 0; i < pos && i < src.length; i++) if (src.charCodeAt(i) === 10) l++;
  return l;
}

// Nazwa napisu: const NAZWA = `…`, NAZWA: `…`, vertexShader: `…`
function nameOfString(noCom, start) {
  const before = noCom.slice(Math.max(0, start - 160), start).replace(/\/\*\s*glsl\s*\*\/\s*$/, '');
  let m = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
  if (m) return m[1];
  m = before.match(/([A-Za-z_$][\w$]*)\s*:\s*$/);
  if (m) return m[1] + ':';
  m = before.match(/([A-Za-z_$][\w$.]*)\s*(\+?=)\s*$/);
  if (m) return m[1] + m[2];
  return '';
}

// ── Pliki źródłowe → treść kodu (index.html: skrypty) ────────────────────────
function scriptBlocks(html) {
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

function loadSource(file) {
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
function importsOf(file, noCom, raw) {
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

function resolveSpec(fromFile, spec) {
  if (!/^[./]/.test(spec)) return null; // gołe (three, three/webgpu…)
  let base = spec.startsWith('/') ? join(repo, spec) : join(dirname(fromFile), spec);
  base = base.split('?')[0];
  const candidates = [base, `${base}.js`, `${base}.mjs`, join(base, 'index.js')];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

// ── Analiza pliku ─────────────────────────────────────────────────────────────
const RX = {
  shaderMaterial: /\bnew\s+(?:THREE\.)?ShaderMaterial\s*\(/g,
  rawShaderMaterial: /\bnew\s+(?:THREE\.)?RawShaderMaterial\s*\(/g,
  shaderPass: /\bnew\s+ShaderPass\s*\(/g,
  onBeforeCompile: /\bonBeforeCompile\b/g,
  customProgramCacheKey: /\bcustomProgramCacheKey\b/g,
  renderTargets: /\bnew\s+(?:THREE\.)?(WebGLRenderTarget|WebGL3DRenderTarget|WebGLArrayRenderTarget|WebGLCubeRenderTarget|RenderTarget3D|RenderTargetArray|RenderTarget)\s*\(/g,
  pixelReads: /\b(readRenderTargetPixels(?:Async)?|readPixels)\s*\(/g,
  compile: /\.(compile|compileAsync)\s*\(/g,
  // getContext tylko z WebGL (kanwy 2D się nie liczą) albo renderer.getContext() — patrz WEBGL_CTX.
  webglApi: /\b(getExtension)\s*\(|\.capabilities\b|\.properties\.get\s*\(|\brenderer\.state\b|\bWebGLRenderer\b|\bisWebGL2\b|\binitRenderTarget\s*\(|\binitTexture\s*\(|\bgl\.(\w+)\s*\(/g,
  webglCtx: /\.getContext\(\s*['"](webgl2?|experimental-webgl)['"]|\b(?:renderer|R|gl|this\.renderer|core\.renderer)\.getContext\(\s*\)/g,
  postprocessing: /\b(EffectComposer|RenderPass|UnrealBloomPass|FullScreenQuad|ShaderPass|OutputPass)\b|\bextends\s+Pass\b/g,
  builtinMaterials: /\bnew\s+(?:THREE\.)?(MeshBasicMaterial|MeshStandardMaterial|MeshPhysicalMaterial|MeshLambertMaterial|MeshPhongMaterial|ShadowMaterial|PointsMaterial|SpriteMaterial|LineBasicMaterial|LineDashedMaterial|MeshDepthMaterial|MeshDistanceMaterial|MeshNormalMaterial|MeshToonMaterial|MeshMatcapMaterial)\s*\(/g,
  instanced: /\b(InstancedMesh|InstancedBufferAttribute|InstancedInterleavedBuffer|InstancedBufferGeometry)\b/g,
  matClone: /\b\w*[Mm]at(?:erial)?s?\b(?:\[[^\]]*\])?\.clone\s*\(\s*\)/g,
  matNeedsUpdate: /\b\w*[Mm]at(?:erial)?\w*\s*\.needsUpdate\s*=\s*true/g,
  defines: /\bdefines\b/g,
  tsl: /from\s+['"]three\/(?:tsl|webgpu)['"]|\bNodeMaterial\b/g
};

function countRx(re, text) { re.lastIndex = 0; let c = 0; while (re.exec(text)) c++; return c; }
function sitesRx(re, text, file) {
  re.lastIndex = 0;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push(`${rel(file)}:${lineOf(text, m.index)}`);
  return out;
}

const files = new Map(); // rel → analiza
function analyze(file) {
  const r = rel(file);
  if (files.has(r)) return files.get(r);
  const { raw, js } = loadSource(file);
  const { noCom, codeOnly, strings } = lex(js);
  const glsl = [];
  for (const s of strings) {
    const text = js.slice(s.start, s.end);
    const score = glslScore(text);
    if (score >= 2) {
      const lines = (text.match(/\n/g) || []).length + 1;
      glsl.push({ name: nameOfString(noCom, s.start), line: lineOf(js, s.start), lines, start: s.start, end: s.end, score });
    }
  }
  const glslLines = glsl.reduce((a, g) => a + g.lines, 0);
  // Eksporty-biblioteki GLSL: export const X = `glsl` / export function f() { … `glsl` … }
  const libExports = [];
  const reExp = /\bexport\s+(const|function)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  const expPos = [];
  while ((m = reExp.exec(noCom))) expPos.push({ kind: m[1], name: m[2], pos: m.index });
  // Koniec ciała funkcji: dopasowanie nawiasów klamrowych w samym kodzie (napisy wyczyszczone).
  const bodyEnd = (from) => {
    const open = codeOnly.indexOf('{', from);
    if (open < 0) return from;
    let depth = 0;
    for (let q = open; q < codeOnly.length; q++) {
      const ch = codeOnly[q];
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return q;
    }
    return codeOnly.length;
  };
  for (const e of expPos) {
    const endPos = e.kind === 'function' ? bodyEnd(e.pos) : e.pos + 160;
    const hit = glsl.find((g) => g.start > e.pos && g.start < endPos);
    if (hit) libExports.push(e.name);
  }
  const a = {
    file: r,
    glslBlocks: glsl.map(({ name, line, lines }) => ({ name, line, lines })),
    glslLines,
    shaderMaterial: countRx(RX.shaderMaterial, codeOnly),
    rawShaderMaterial: countRx(RX.rawShaderMaterial, codeOnly),
    shaderPass: countRx(RX.shaderPass, codeOnly),
    onBeforeCompile: countRx(RX.onBeforeCompile, codeOnly),
    customProgramCacheKey: countRx(RX.customProgramCacheKey, codeOnly),
    renderTargets: [...codeOnly.matchAll(RX.renderTargets)].map((x) => x[1]),
    pixelReads: sitesRx(RX.pixelReads, codeOnly, file),
    compile: sitesRx(RX.compile, codeOnly, file),
    webglApi: [...new Set([
      ...[...noCom.matchAll(RX.webglCtx)].map(() => 'getContext(webgl)'),
      ...[...codeOnly.matchAll(RX.webglApi)].map((x) => (x[1] || x[0]).replace(/\s*\($/, '').trim())
    ])],
    postprocessing: [...new Set([...codeOnly.matchAll(RX.postprocessing)].map((x) => x[1] || 'extends Pass'))],
    builtinMaterials: [...codeOnly.matchAll(RX.builtinMaterials)].map((x) => x[1]),
    instanced: countRx(RX.instanced, codeOnly),
    matClone: sitesRx(RX.matClone, codeOnly, file),
    matNeedsUpdate: sitesRx(RX.matNeedsUpdate, codeOnly, file),
    defines: countRx(RX.defines, codeOnly),
    usesTsl: countRx(RX.tsl, noCom) > 0 || (/\.m?js$/.test(file) && existsSync(file.replace(/\.m?js$/, '.tsl.js'))),
    libExports,
    imports: importsOf(file, noCom, raw).map((x) => ({ ...x, resolved: resolveSpec(file, x.spec) ? rel(resolveSpec(file, x.spec)) : null }))
  };
  a.materials = a.shaderMaterial + a.rawShaderMaterial + a.shaderPass;
  a.status = a.glslLines > 0 || a.materials > 0 || a.onBeforeCompile > 0
    ? (a.usesTsl ? 'mieszany' : 'GLSL')
    : (a.usesTsl ? 'TSL' : '—');
  files.set(r, a);
  return a;
}

const indexHtml = join(repo, 'index.html');
for (const f of [...srcFiles, ...rootJs, indexHtml]) analyze(f);
for (const f of [...pages, ...toolJs]) analyze(f);

// ── Zasięg: graf importów ────────────────────────────────────────────────────
function reach(startRel) {
  const seen = new Set();
  const q = [startRel];
  while (q.length) {
    const r = q.pop();
    if (seen.has(r)) continue;
    seen.add(r);
    const a = files.get(r) || analyze(join(repo, r));
    for (const imp of a.imports) if (imp.resolved) q.push(imp.resolved);
  }
  return seen;
}
const gameSet = reach('index.html');
const pageReach = new Map();
for (const p of pages) pageReach.set(rel(p), reach(rel(p)));
const toolReach = new Map();
for (const t of toolJs) toolReach.set(rel(t), reach(rel(t)));

function scopeOf(r) {
  for (const rule of SCOPE_RULES) if (rule.re.test(r)) return rule;
  return null;
}
function usageOf(r) {
  if (gameSet.has(r)) return 'gra';
  const byPages = [...pageReach.entries()].filter(([, s]) => s.has(r)).map(([p]) => p);
  const byTools = [...toolReach.entries()].filter(([t, s]) => s.has(r) && t !== r).map(([t]) => t);
  if (byPages.length) return 'dema';
  if (byTools.length) return 'narzędzia';
  return 'nieużywany';
}

const scanned = [...srcFiles, ...rootJs, indexHtml].map((f) => rel(f));
const rows = scanned.map((r) => {
  const a = files.get(r);
  const scope = scopeOf(r);
  const usage = usageOf(r);
  let zakres;
  if (scope) zakres = scope.tag;
  else if (usage === 'gra') zakres = 'port';
  else zakres = `poza grą (${usage})`;
  return { ...a, usage, zakres, scopeLabel: scope?.label || '' };
});

// Użytkownicy bibliotek GLSL: import nazwy wyeksportowanej jako GLSL.
const libUsers = new Map();
for (const r of rows) {
  for (const imp of r.imports) {
    if (!imp.resolved || !imp.names) continue;
    const target = files.get(imp.resolved);
    if (!target || !target.libExports.length) continue;
    for (const nm of imp.names) {
      if (!target.libExports.includes(nm.orig)) continue;
      const key = `${imp.resolved}#${nm.orig}`;
      if (!libUsers.has(key)) libUsers.set(key, new Set());
      libUsers.get(key).add(r.file);
    }
  }
}

// Strony dem używające shaderów gry.
const glslGameFiles = new Set(rows.filter((r) => r.glslLines > 0 || r.materials > 0).map((r) => r.file));
const demoRows = pages.map((p) => {
  const pr = rel(p);
  const set = pageReach.get(pr);
  const a = files.get(pr);
  const html = readFileSync(p, 'utf8');
  const usesCore = set.has('src/3d/core3d.js');
  const allJs = [...set].map((x) => files.get(x)).filter(Boolean);
  // Własny renderer: tylko pliki strony (dema/, scripts/, sama strona), nie moduły gry.
  const own = allJs.filter((x) => /^(dema|scripts)\//.test(x.file) || x.file === pr);
  const ownWebGL = own.some((x) => x.webglApi.includes('WebGLRenderer')) || /new\s+THREE\.WebGLRenderer\s*\(/.test(html);
  const webgpu = own.some((x) => x.usesTsl) || /WebGPURenderer/.test(html);
  const shaders = [...set].filter((x) => glslGameFiles.has(x) && (x.startsWith('src/') || !x.includes('/')));
  // „index.html” jest za ogólne — wtedy szukamy z katalogiem (proxy-batch/index.html).
  const segs = pr.split('/');
  const pageName = segs[segs.length - 1] === 'index.html' && segs.length > 1 ? segs.slice(-2).join('/') : segs[segs.length - 1];
  const usedBy = [...toolReach.keys()].filter((t) => {
    if (t === pr) return false;
    try { return readFileSync(join(repo, t), 'utf8').includes(pageName); } catch { return false; }
  });
  return { page: pr, core3d: usesCore, ownWebGL, webgpu, shaders, usedBy, glslLocal: a.glslLines };
}).filter((d) => d.shaders.length || d.core3d);

// Testy dotykające GLSL / WebGL / struktury Core3D.
const testFiles = walk(join(repo, 'tests'), (p) => /\.test\.mjs$/.test(p));
const TEST_RX = /fragmentShader|vertexShader|_SHADER\b|_FRAGMENT\b|_VERTEX\b|_GLSL\b|glsl|gl_FragColor|gl_Position|onBeforeCompile|ShaderMaterial|\.uniforms\.\w+\.value|\.uniforms\[|WebGLRenderTarget|WebGLRenderer|EffectComposer|RenderPass|UnrealBloomPass|FullScreenBlendPass|layers\.set\(|_scenePasses|_postPasses|compileAsync|renderer\.compile/;
const testRows = [];
const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const probeFiles = [...glslGameFiles, 'src/3d/core3d.js'];
for (const t of testFiles) {
  const src = readFileSync(t, 'utf8');
  // Moduł = jego nazwa pliku w napisie (import, new URL, readFileSync, path.join(…, 'x.js')).
  const touched = probeFiles.filter((f) => new RegExp(`[\\\\/'"\`]${escRx(f.split('/').pop())}['"\`]`).test(src));
  const readsShader = TEST_RX.test(src);
  if (touched.length && readsShader) testRows.push({ test: rel(t), modules: [...new Set(touched)] });
}

// ── Sumy ──────────────────────────────────────────────────────────────────────
function sums(list) {
  return {
    pliki: list.filter((r) => r.glslLines > 0 || r.materials > 0).length,
    materialy: list.reduce((a, r) => a + r.materials, 0),
    shaderMaterial: list.reduce((a, r) => a + r.shaderMaterial, 0),
    rawShaderMaterial: list.reduce((a, r) => a + r.rawShaderMaterial, 0),
    shaderPass: list.reduce((a, r) => a + r.shaderPass, 0),
    linieGlsl: list.reduce((a, r) => a + r.glslLines, 0),
    onBeforeCompile: list.reduce((a, r) => a + r.onBeforeCompile, 0),
    odczyty: list.reduce((a, r) => a + r.pixelReads.length, 0),
    compile: list.reduce((a, r) => a + r.compile.length, 0),
    wbudowane: list.reduce((a, r) => a + r.builtinMaterials.length, 0),
    clone: list.reduce((a, r) => a + r.matClone.length, 0),
    needsUpdate: list.reduce((a, r) => a + r.matNeedsUpdate.length, 0),
    defines: list.reduce((a, r) => a + r.defines, 0),
    tsl: list.filter((r) => r.status === 'TSL').length,
    mieszane: list.filter((r) => r.status === 'mieszany').length
  };
}
const groups = {
  port: rows.filter((r) => r.zakres === 'port'),
  warp: rows.filter((r) => r.zakres === 'warp'),
  legacy: rows.filter((r) => r.zakres === 'legacy'),
  'poza grą': rows.filter((r) => r.zakres.startsWith('poza grą'))
};
const total = sums(rows);
const groupSums = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, sums(v)]));

// ── Wyjście ───────────────────────────────────────────────────────────────────
const commit = (() => { try { return readFileSync(join(repo, '.git', 'HEAD'), 'utf8').trim(); } catch { return '?'; } })();
const json = { when: new Date().toISOString(), commit, total, groupSums, rows, libUsers: Object.fromEntries([...libUsers].map(([k, v]) => [k, [...v]])), demoRows, testRows };
mkdirSync(dirname(resolve(repo, OUT_JSON)), { recursive: true });
writeFileSync(resolve(repo, OUT_JSON), JSON.stringify(json, null, 2) + '\n');

const fmtList = (xs, max = 6) => (xs.length > max ? `${xs.slice(0, max).join(', ')} …(+${xs.length - max})` : xs.join(', '));
const shortRt = (xs) => { const c = {}; for (const x of xs) c[x] = (c[x] || 0) + 1; return Object.entries(c).map(([k, v]) => (v > 1 ? `${k}×${v}` : k)).join(', '); };

function fileTable(list) {
  const out = ['| plik | mat. | linie GLSL | oBC | cele renderu | odczyty | compile | inne WebGL / post | wbudowane mat. | przebudowy (clone / needsUpdate / defines) | status | uwagi |',
    '|---|---:|---:|---:|---|---:|---:|---|---:|---|---|---|'];
  let shown = 0;
  for (const r of [...list].sort((a, b) => b.glslLines - a.glslLines || b.materials - a.materials || a.file.localeCompare(b.file))) {
    if (!(r.glslLines || r.materials || r.onBeforeCompile || r.renderTargets.length || r.pixelReads.length || r.compile.length || r.webglApi.length || r.postprocessing.length || NOTES[r.file])) continue;
    shown++;
    out.push(`| \`${r.file}\` | ${r.materials || ''} | ${r.glslLines || ''} | ${r.onBeforeCompile || ''} | ${shortRt(r.renderTargets)} | ${r.pixelReads.length || ''} | ${r.compile.length || ''} | ${fmtList([...r.webglApi, ...r.postprocessing])} | ${r.builtinMaterials.length || ''} | ${[r.matClone.length, r.matNeedsUpdate.length, r.defines].map((v) => v || '·').join(' / ')} | ${r.status} | ${NOTES[r.file] || ''} |`);
  }
  return shown ? out.join('\n') : '(brak)';
}

const sumRow = (k, s) => `| ${k} | ${s.pliki} | ${s.materialy} (${s.shaderMaterial} SM, ${s.rawShaderMaterial} Raw, ${s.shaderPass} ShaderPass) | ${s.linieGlsl} | ${s.onBeforeCompile} | ${s.odczyty} | ${s.compile} | ${s.wbudowane} | ${s.clone} / ${s.needsUpdate} / ${s.defines} | ${s.tsl} / ${s.mieszane} |`;

const libLines = [];
const libByFile = new Map();
for (const [key, users] of libUsers) {
  const [file, name] = key.split('#');
  if (!libByFile.has(file)) libByFile.set(file, []);
  libByFile.get(file).push({ name, users: [...users] });
}
for (const [file, list] of [...libByFile].sort()) {
  libLines.push(`- \`${file}\` (${files.get(file).glslLines} linii GLSL)`);
  for (const { name, users } of list.sort((a, b) => a.name.localeCompare(b.name))) libLines.push(`  - \`${name}\` → ${users.map((u) => `\`${u}\``).join(', ')}`);
}

const biggest = rows.flatMap((r) => r.glslBlocks.map((b) => ({ ...b, file: r.file, zakres: r.zakres })))
  .sort((a, b) => b.lines - a.lines).slice(0, 40);

const rebuildSites = groups.port.flatMap((r) => [
  ...r.matClone.map((s) => `clone — ${s}`),
  ...r.matNeedsUpdate.map((s) => `needsUpdate — ${s}`)
]);
const definesFiles = groups.port.filter((r) => r.defines > 0).map((r) => `\`${r.file}\` (${r.defines})`);

const md = `# Inwentarz portu WebGPU

> Wygenerowane przez \`node scripts/webgpu/inwentarz.mjs\` — **nie edytować ręcznie**, uruchomić ponownie.
> Stan: ${json.when.slice(0, 10)}, HEAD \`${commit.replace(/^ref: /, '')}\`. Surowe dane: \`${OUT_JSON}\`.
> Zakres portu i decyzje: \`docs/webgpu/PLAN.md\`, \`docs/webgpu/POSTEP.md\`.

## Jak czytać

- **mat.** — miejsca tworzenia \`ShaderMaterial\` / \`RawShaderMaterial\` / \`ShaderPass\` (nie liczba instancji).
- **linie GLSL** — linie napisów rozpoznanych jako GLSL (≥ 2 znaczniki: \`void main\`, \`gl_*\`, \`uniform\`/\`varying\`, \`vecN(\`,
  \`precision\`, \`#include\`, \`#define\`…); szablon liczony w całości razem z \`\${…}\`. Heurystyka — jak w \`USTALENIA.md\`.
- **oBC** — \`onBeforeCompile\` (w WebGPU nie istnieje). **cele renderu** — konstruktory celów. **odczyty** — \`readRenderTargetPixels*\` / \`readPixels\`.
- **inne WebGL / post** — \`getContext\`, \`getExtension\`, \`capabilities\`, \`properties.get\`, \`gl.*\`, \`EffectComposer\`, \`RenderPass\`, \`ShaderPass\`…
- **wbudowane mat.** — \`MeshBasicMaterial\`, \`MeshStandardMaterial\`, \`ShadowMaterial\`… WebGPURenderer zamienia je sam na wersje węzłowe
  (\`StandardNodeLibrary\`); do przeniesienia są tylko te z \`onBeforeCompile\` / \`customProgramCacheKey\`.
- **przebudowy** — \`material.clone()\` / \`material.needsUpdate = true\` / \`defines\`: w WebGPU każda nowa kombinacja = nowy pipeline.
- **status** — \`GLSL\` (do przeniesienia), \`mieszany\` (w trakcie), \`TSL\` (przeniesiony), \`—\` (bez shaderów).
- **zakres** — \`port\` = plik ładowany przez grę (graf importów od \`index.html\`) i nie wyłączony decyzją użytkownika;
  \`warp\` = poza portem (decyzja 2026-09-27); \`poza grą\` = tylko dema / narzędzia / nieużywany.

## Sumy

| zakres | pliki z GLSL | materiały | linie GLSL | oBC | odczyty | compile | wbudowane | clone / needsUpdate / defines | TSL / mieszane |
|---|---:|---|---:|---:|---:|---:|---:|---|---|
${sumRow('**razem**', total)}
${Object.entries(groupSums).map(([k, s]) => sumRow(k, s)).join('\n')}

### Porównanie z \`USTALENIA.md\` (~105 materiałów w 53 plikach, ~12,7 tys. linii GLSL w 59 plikach)

Tu: **${total.materialy} miejsc tworzenia materiałów** (w tym ${total.shaderPass} \`ShaderPass\`) w ${rows.filter((r) => r.materials > 0).length} plikach,
**${total.linieGlsl} linii GLSL** w ${rows.filter((r) => r.glslLines > 0).length} plikach. Różnice: (1) ten lekser liczy szablony w całości
(z \`\${…}\`) i także krótkie jednolinijkowe shadery w zwykłych napisach; (2) liczy \`ShaderPass\` jako materiał; (3) pliki dodane od
\`2c2ef18\` (ringi-archetypy Z6 \`haloRing/arch/*\`, budowle portowe Z7, burze pasa). Do planu liczy się wiersz **port**.

## Pliki w porcie (ładuje je gra)

${fileTable(groups.port)}

## Poza portem — decyzje użytkownika

### Warp
${fileTable(groups.warp)}

Asteroidy: stare pole (sprite'y + ciała heksowe), tło pasa i klej WebGL (\`asteroidBelt3D\`, \`rocks/*\`, \`beltDust3D\`,
\`beltStorm3D\`, \`fieldLights3D\`) usunięte w zadaniu 21 — pas z dema WebGPU (\`src/3d/asteroids/\`) jest w porcie.
Uwaga: **ścieżka heksów w \`hexShips3D.js\`** (HEX/ARMOR/DEBRIS, pula szczątków GPU, \`createEntityMesh\`/\`updateEntityMesh\`) po zadaniu 21
nie ma w grze użytkownika (rysowała tylko ciała heksowe starych asteroid); stoją na niej warsztaty \`mostki-demo\`, \`rdzen-demo\`
i pomiar drżenia (PLAN.md §1 p. 7). \`coldWreckImpostors.js\` / \`coldWrecks.js\` są uśpione (wymagają \`hexGrid\`).

### Legacy
${fileTable(groups.legacy)}

## Poza grą (dema, narzędzia, nieużywane)

${fileTable(groups['poza grą'])}

## Biblioteki GLSL i ich użytkownicy

${libLines.join('\n') || '(brak)'}

## Największe bloki GLSL

| plik:linia | nazwa | linie | zakres |
|---|---|---:|---|
${biggest.map((b) => `| \`${b.file}:${b.line}\` | \`${b.name || '—'}\` | ${b.lines} | ${b.zakres} |`).join('\n')}

## Przebudowy materiałów w locie (zakres: port)

\`clone()\` / \`needsUpdate = true\` (heurystyka: zmienna z „mat” w nazwie):

${rebuildSites.map((s) => `- ${s}`).join('\n') || '(brak)'}

\`defines\` w plikach: ${definesFiles.join(', ') || '(brak)'}.

## Strony dem i narzędzi korzystające z shaderów gry

| strona | Core3D | własny WebGLRenderer | WebGPU | moduły gry z GLSL | używana przez |
|---|---|---|---|---|---|
${demoRows.map((d) => `| \`${d.page}\` | ${d.core3d ? 'tak' : ''} | ${d.ownWebGL ? 'tak' : ''} | ${d.webgpu ? 'tak' : ''} | ${d.shaders.length} (${fmtList(d.shaders.map((s) => s.split('/').pop()), 5)}) | ${d.usedBy.map((u) => `\`${u}\``).join(', ')} |`).join('\n')}

## Testy czytające shadery / strukturę Core3D (kandydaci do przepisania)

| test | moduły z GLSL / core3d |
|---|---|
${testRows.map((t) => `| \`${t.test}\` | ${fmtList(t.modules.map((m) => `\`${m}\``), 5)} |`).join('\n')}
`;

mkdirSync(dirname(resolve(repo, OUT_MD)), { recursive: true });
writeFileSync(resolve(repo, OUT_MD), md);
if (!QUIET) {
  console.log('razem:', JSON.stringify(total));
  for (const [k, s] of Object.entries(groupSums)) console.log(k.padEnd(16), JSON.stringify(s));
  console.log(`md: ${OUT_MD}, json: ${OUT_JSON}`);
}
