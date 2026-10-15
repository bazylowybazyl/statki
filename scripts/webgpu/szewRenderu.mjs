// Szew gra ↔ warstwa renderu — inwentarz i liczniki strażnika (RW-01, docs/PLAN-render-worker.md § 2, § 6).
//
//   node scripts/webgpu/szewRenderu.mjs              → podsumowanie (liczniki per rodzina)
//   node scripts/webgpu/szewRenderu.mjs --json plik  → pełny wynik (liczniki + szczegóły z miejscami)
//   node scripts/webgpu/szewRenderu.mjs --sufity     → obiekt sufitów do wklejenia w tests/szewRenderu.test.mjs
//
// Graf plików gry = `grafImportow('index.html')` z grafGry.mjs (ten sam co tests/graBezGlsl.test.mjs: importy statyczne,
// dynamiczne, re-eksporty, workery `new URL`). Kod czyta parser rollupa (`rollup/parseAst`, ESTree) — tylko pliki
// warstwy renderu i główny skrypt index.html.
//
// Warstwa renderu = src/3d, src/vfx, src/effects3d; symulacja = src/game, src/ai. Moduły renderu, które zostają na
// wątku głównym (kanwa 2D i szyna zderzeń), są w ZOSTAJE_NA_WATKU_GLOWNYM — liczą się osobno (`okno-kanwa:`), DOM
// w nich się nie liczy.
//
// Liczniki (klucz → liczba; strażnik: liczba ≤ sufit, klucz bez sufitu = 0):
//   index:<grupa>        odwołania głównego skryptu index.html do symboli renderu (importy, globale `window`
//                        wystawione przez render, uchwyty z fabryk renderu) per grupa: aktualizacja, zdarzenie,
//                        konfiguracja, zapytanie, dane (§ 2.1);
//   import:<moduł>       instrukcje importu z modułów renderu do modułu src/game / src/ai — lista dozwolona,
//                        każdy moduł z klasą A–E (KLASY_IMPORTOW, § 2.2);
//   okno:<nazwa>         odczyty zmiennej gry (`window.X`, `globalThis.X`, `self.X` albo wolny identyfikator X), którą
//                        pisze gra (index.html, src poza renderem) albo nikt (haki dev), w modułach przenoszonych
//                        do workera (§ 2.4); `okno-kanwa:<nazwa>` — to samo w modułach kanwy 2D;
//   gamestate:<plik>     odczyty `GameState.*` w module renderu (§ 2.4, RW-12);
//   dom:<plik>           DOM i okno przeglądarki w module przenoszonym (§ 2.9): document, localStorage,
//                        requestIdleCallback, requestAnimationFrame, innerWidth / innerHeight / devicePixelRatio /
//                        screen, Image / HTMLImageElement / HTMLCanvasElement, createElement, nasłuchy na oknie,
//                        TextureLoader / ImageLoader / CubeTextureLoader (kanwa 2D na OffscreenCanvas się nie liczy);
//   gpu:<plik>           odczyty GPU → CPU (getArrayBufferAsync, readRenderTargetPixels(Async), mapAsync,
//                        copyTextureToBuffer, readPixels) w module renderu (§ 2.6);
//   random:<plik>        `Math.random` w module renderu (§ 3.9 — determinizm; wizualia losują z fxRandom).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAst } from 'rollup/parseAst';
import { grafImportow, repo, scriptBlocks, resolveSpec, rel, lex, importsOf } from './grafGry.mjs';

export const WARSTWA_RENDERU = Object.freeze(['src/3d/', 'src/vfx/', 'src/effects3d/']);
export const WARSTWA_SYMULACJI = Object.freeze(['src/game/', 'src/ai/']);
export const isRender = (f) => WARSTWA_RENDERU.some((d) => f.startsWith(d));
export const isSim = (f) => WARSTWA_SYMULACJI.some((d) => f.startsWith(d));

// Moduły renderu, które zostają na wątku głównym (kanwa 2D gry, sprite'y wieżyczek kanwy, szyna zderzeń) — § 2.1 uwagi,
// § 2.4 („tylko moduły kanwy 2D”). Nie liczą się do „przenoszonych”.
export const ZOSTAJE_NA_WATKU_GLOWNYM = Object.freeze(new Set([
  'src/vfx/canvasParticleSystem.js',
  'src/vfx/collisionFx.js',
  'src/vfx/collisionSparks.js',
  'src/vfx/fighterSprite.js',
  'src/vfx/fighterBombSprite.js',
  'src/vfx/turret2D.js',
  'src/vfx/ciwsSprite2D.js',
  'src/vfx/launcherSprite2D.js',
  'src/vfx/mainWeaponSprite2D.js',
  'src/vfx/pdWeaponSprite2D.js',
  'src/vfx/specialWeaponSprite2D.js',
  'src/vfx/tempestSprite2D.js',
  'src/vfx/yamatoSprite2D.js'
]));
export const isPrzenoszony = (f) => isRender(f) && !ZOSTAJE_NA_WATKU_GLOWNYM.has(f);

// Klasy modułów symulacji importowanych przez render (§ 2.2): A — czyste dane i matematyka, B — zegary i kontenery
// klatki, C — stan rozgrywki czytany przez render, D — rozgrywka tworzona albo krokowana przez moduły 3D (do wyjęcia:
// RW-24, RW-25, RW-27), E — szyna zdarzeń. Nowy import z renderu do src/game / src/ai = wpis tutaj (z klasą) i sufit
// w tests/szewRenderu.test.mjs z powodem.
export const KLASY_IMPORTOW = Object.freeze({
  'src/game/asteroidBeltField.js': 'A',
  'src/game/asteroidFieldLight.js': 'A',
  'src/game/asteroidGiants.js': 'A',
  'src/game/asteroidRockKinds.js': 'A',
  'src/game/asteroidRotation.js': 'A',
  'src/game/asteroidStorms.js': 'A',
  'src/game/beamBand3D.js': 'A',
  'src/game/cargoPortOps.js': 'A',
  'src/game/cloakLook.js': 'A',
  'src/game/coldWrecks.js': 'A',
  'src/game/cometNucleus.js': 'A',
  'src/game/comets.js': 'A',
  'src/game/coreModel.js': 'A',
  'src/game/destructorConfig.js': 'A',
  'src/game/engineIgnition.js': 'A',
  'src/game/friendlyFire.js': 'A',
  'src/game/haloRingPlanets.js': 'A',
  'src/game/hexGridSpace.js': 'A',
  'src/game/hullCraters.js': 'A',
  'src/game/hullMounts.js': 'A',
  'src/game/reactorCore.js': 'A',
  'src/game/repairRig.js': 'A',
  'src/game/shipBridge.js': 'A',
  'src/game/shipBridgeBeams.js': 'A',
  'src/game/shipBridgeRuntime.js': 'A',
  'src/game/shipLightRuntime.js': 'A',
  'src/game/skyRegion.js': 'A',
  'src/game/traffic/dockLayout.js': 'A',
  'src/game/traffic/shipyards.js': 'A',
  'src/game/warpDrive.js': 'A',
  'src/game/weaponAim.js': 'A',
  'src/game/weaponFeel.js': 'A',
  'src/game/carrierVelocity.js': 'B',
  'src/game/gameState.js': 'B',
  'src/game/simClock.js': 'B',
  'src/game/view3D.js': 'B',
  'src/game/hexBodyHooks.js': 'C',
  'src/game/hullBodies.js': 'C',
  'src/game/repairSwarm.js': 'C',
  'src/game/worldBodies.js': 'C',
  'src/game/asteroidBeltGiants.js': 'D',
  'src/game/asteroidGiantBuilder.js': 'D',
  'src/game/asteroidMining.js': 'D',
  'src/game/asteroidMiningRig.js': 'D',
  'src/game/haloRingCollision.js': 'D',
  'src/game/k7BerthService.js': 'D',
  'src/game/story/pirateBaseBodies.js': 'D',
  'src/game/weaponShotBus.js': 'E'
});

export const GRUPY_INDEX = Object.freeze(['aktualizacja', 'zdarzenie', 'konfiguracja', 'zapytanie', 'dane']);

// Nazwy okna przeglądarki czytane jako `window.X` — nie są zmiennymi gry (DOM liczy się osobno).
const PRZEGLADARKA = new Set(['devicePixelRatio', 'innerWidth', 'innerHeight', 'addEventListener', 'removeEventListener',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'location', 'navigator',
  'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'matchMedia', 'getComputedStyle',
  'localStorage', 'sessionStorage', 'document', 'crypto', 'screen', 'Worker', 'OffscreenCanvas', 'isSecureContext',
  'crossOriginIsolated', 'dispatchEvent', 'console', 'structuredClone', 'fetch', 'Image', 'HTMLCanvasElement',
  'ImageBitmap', 'createImageBitmap', 'queueMicrotask', 'URL', 'Blob', 'AudioContext', 'open', 'scrollX', 'scrollY',
  'top', 'parent', 'self', 'window', 'globalThis', 'gc', 'chrome', 'MessageChannel', 'WebGPU', 'GPUBufferUsage',
  'GPUShaderStage', 'GPUTextureUsage', 'GPUMapMode', 'postMessage', 'onmessage', 'close', 'importScripts']);
// Globale JS i przeglądarki — wolny identyfikator z tej listy nie jest zmienną gry.
const ZNANE_GLOBALE = new Set([...Object.getOwnPropertyNames(globalThis), ...PRZEGLADARKA, 'undefined', 'NaN', 'Infinity',
  'arguments', 'HTMLImageElement', 'HTMLElement', 'HTMLVideoElement', 'ImageData', 'Path2D', 'CanvasRenderingContext2D',
  'OffscreenCanvasRenderingContext2D', 'DOMMatrix', 'GPUDevice', 'GPUAdapter', 'navigator', 'alert', 'outerWidth',
  'outerHeight', 'requestIdleCallback', 'cancelIdleCallback', 'importScripts', 'postMessage', 'onmessage', 'close',
  'name', 'status', 'event', 'origin', 'length', 'external']);

// DOM w module przenoszonym: wolne identyfikatory (albo `window.X`) i wywołania.
const DOM_GLOBALE = new Set(['document', 'localStorage', 'sessionStorage', 'requestIdleCallback', 'cancelIdleCallback',
  'requestAnimationFrame', 'cancelAnimationFrame', 'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
  'devicePixelRatio', 'screen', 'matchMedia', 'getComputedStyle', 'Image', 'HTMLImageElement', 'HTMLCanvasElement',
  'HTMLElement', 'HTMLVideoElement', 'alert', 'TextureLoader', 'ImageLoader', 'CubeTextureLoader']);
const OKNO = new Set(['window', 'globalThis', 'self']);
const GPU_ODCZYT = new Set(['getArrayBufferAsync', 'readRenderTargetPixelsAsync', 'readRenderTargetPixels', 'mapAsync',
  'copyTextureToBuffer', 'readPixels']);

// ── AST ───────────────────────────────────────────────────────────────────────
function walk(node, visit, parents = []) {
  if (!node || typeof node.type !== 'string') return;
  if (visit(node, parents) === false) return;
  parents.push(node);
  for (const key in node) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, visit, parents); }
    else if (v && typeof v.type === 'string') walk(v, visit, parents);
  }
  parents.pop();
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= off) lo = m; else hi = m - 1; }
    return lo + 1;
  };
}

const isFn = (n) => n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';

function isReference(n, parents) {
  const p = parents[parents.length - 1];
  if (!p) return true;
  if (p.type === 'MemberExpression' && p.property === n && !p.computed) return false;
  if ((p.type === 'Property' || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && p.key === n && !p.computed && !p.shorthand) return false;
  if (p.type === 'Property' && p.shorthand && p.key === n && p.value !== n) return false;
  if (p.type === 'LabeledStatement' || p.type === 'BreakStatement' || p.type === 'ContinueStatement') return false;
  if (p.type === 'ImportSpecifier' || p.type === 'ImportDefaultSpecifier' || p.type === 'ImportNamespaceSpecifier') return false;
  if (p.type === 'ExportSpecifier') return false;
  if ((p.type === 'FunctionDeclaration' || p.type === 'FunctionExpression' || p.type === 'ClassDeclaration' || p.type === 'ClassExpression') && p.id === n) return false;
  if (p.type === 'VariableDeclarator' && p.id === n) return false;
  if (p.type === 'MetaProperty') return false;
  return true;
}

function collectPattern(id, out) {
  if (!id) return;
  if (id.type === 'Identifier') out.add(id.name);
  else if (id.type === 'ObjectPattern') for (const p of id.properties) collectPattern(p.value || p.argument, out);
  else if (id.type === 'ArrayPattern') for (const e of id.elements) collectPattern(e, out);
  else if (id.type === 'AssignmentPattern') collectPattern(id.left, out);
  else if (id.type === 'RestElement') collectPattern(id.argument, out);
}

// Nazwy deklarowane gdziekolwiek w pliku (przybliżenie zasięgów — jak inwentarz 2026-10-07).
function declaredNames(ast) {
  const out = new Set();
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator') collectPattern(n.id, out);
    else if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration' || n.type === 'FunctionExpression' || n.type === 'ClassExpression') && n.id) out.add(n.id.name);
    if (isFn(n)) for (const p of n.params) collectPattern(p, out);
    if (n.type === 'ImportSpecifier' || n.type === 'ImportDefaultSpecifier' || n.type === 'ImportNamespaceSpecifier') out.add(n.local.name);
    if (n.type === 'CatchClause' && n.param) collectPattern(n.param, out);
  });
  return out;
}

// Łańcuch składowych od węzła w górę: window.Core3D.fx → ['fx', …] i najwyższy węzeł łańcucha.
function memberChainUp(node, parents) {
  const chain = [];
  let cur = node, i = parents.length - 1;
  while (i >= 0) {
    const p = parents[i];
    if (p.type === 'MemberExpression' && p.object === cur) {
      if (!p.computed && p.property.type === 'Identifier') chain.push(p.property.name);
      else if (p.computed && p.property.type === 'Literal') chain.push(String(p.property.value));
      else chain.push('[]');
      cur = p; i--; continue;
    }
    if (p.type === 'ChainExpression' && p.expression === cur) { cur = p; i--; continue; }
    break;
  }
  return { chain, top: cur, topIndex: i };
}

// Rodzaj użycia: call (wynik odrzucony), call-value, read, write, arg, new, typeof.
function usageOf(top, parents, topIndex) {
  const p = parents[topIndex];
  if (!p) return 'read';
  if (p.type === 'CallExpression' && p.callee === top) {
    let cur = p, j = topIndex - 1;
    while (j >= 0 && (parents[j].type === 'ChainExpression' || parents[j].type === 'AwaitExpression')) { cur = parents[j]; j--; }
    const q = parents[j];
    if (!q || q.type === 'ExpressionStatement') return 'call';
    if (q.type === 'UnaryExpression' && q.operator === 'void') return 'call';
    if (q.type === 'SequenceExpression' && q.expressions[q.expressions.length - 1] !== cur) return 'call';
    if (q.type === 'ArrowFunctionExpression' && q.body === cur) return 'call';
    if (q.type === 'LogicalExpression' && q.right === cur && parents[j - 1]?.type === 'ExpressionStatement') return 'call';
    return 'call-value';
  }
  if (p.type === 'AssignmentExpression' && p.left === top) return 'write';
  if (p.type === 'UpdateExpression') return 'write';
  if ((p.type === 'CallExpression' || p.type === 'NewExpression') && p.arguments.includes(top)) return 'arg';
  if (p.type === 'NewExpression' && p.callee === top) return 'new';
  if (p.type === 'UnaryExpression' && p.operator === 'typeof') return 'typeof';
  return 'read';
}

// Zapisy `window.X = …` / `Object.assign(window, {…})` w drzewie.
function windowWrites(ast) {
  const out = [];
  walk(ast, (n) => {
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression') {
      const l = n.left;
      if (l.object.type === 'Identifier' && OKNO.has(l.object.name)) {
        const name = !l.computed && l.property.type === 'Identifier' ? l.property.name : (l.property.type === 'Literal' ? String(l.property.value) : null);
        if (name) out.push({ name, start: n.start });
      }
    }
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'Object'
      && n.callee.property.name === 'assign' && n.arguments[0]?.type === 'Identifier' && OKNO.has(n.arguments[0].name)
      && n.arguments[1]?.type === 'ObjectExpression') {
      for (const p of n.arguments[1].properties) if (p.key) out.push({ name: p.key.name || p.key.value, start: n.start });
    }
  });
  return out;
}

const pliki = new Map(); // plik → { text, ast, lineOf }
let NADPISZ = null; // { plik: treść } — przebieg na zmienionej kopii (test strażnika)
function parsed(root, f) {
  if (NADPISZ && Object.hasOwn(NADPISZ, f)) { const text = NADPISZ[f]; return { text, ast: parseAst(text), lineOf: lineIndex(text) }; }
  const key = `${root}|${f}`;
  let P = pliki.get(key);
  if (!P) {
    const text = readFileSync(join(root, f), 'utf8');
    P = { text, ast: parseAst(text), lineOf: lineIndex(text) };
    pliki.set(key, P);
  }
  return P;
}

// ── Główny skrypt index.html ───────────────────────────────────────────────────
function skryptyIndex(root) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const lineOfHtml = lineIndex(html);
  const blocks = scriptBlocks(html).filter((b) => !b.src && /module/.test(b.type));
  let main = blocks[0];
  for (const b of blocks) if (b.body.length > main.body.length) main = b;
  return { html, lineOfHtml, main, small: blocks.filter((b) => b !== main) };
}

// Symbole z modułów renderu bez stanu (bez three i bez zapisów `window`) liczą się jako „dane” wspólne — jak
// `computeHaloRingLayout`, `dryDockChunkAt` (§ 2.1). Dodatkowo jawnie (moduły ze stanem, ale symbol czysty):
const DANE_JAWNE = new Set(['fxRandom', 'SHIP3D_MODELS', 'WEAPON3D_FAMILY', 'stampFamilyFor']);
// Składowe zwracające wynik do gry / UI (§ 2.1 „zapytania zwrotne”).
const ZAPYTANIA = [
  /^isShieldBreachedAt$/, /^getShieldPoolStats$/, /^probeShieldSlot$/,
  /^asteroidBelt\.(pointBlocked|field|giants|rig|stats|mining)/, /^asteroidBelt$/,
  /^haloRings\.(constrainShip|pointInSlab|entries|clock|stats|qualityKey|gameSunLocal|showcaseHallCut)/,
  /^WarpNurt\.(time|arrivals)/, /^isColdFreezeVisuallySafe$/, /^rocketSystem3D\.(rockets|hasSalvoPlan)/, /^rocketSystem3D$/,
  /^turretMuzzleZ$/, /^shipModel3DIdFor$/, /^__hexShips3DLastDrawPerf$/, /^__weapon3dCameraShake$/,
  /^Core3D\.(gpuUnsupported|ready|isInitialized)/, /^HullLighting\.isPbr/, /^WeaponFx\.available/, /^initPlanets3D$/,
  /^initWorld3D$/, /^planetScene3D$/, /^mainScene3D$/, /^drawFighterSprite$/, /^haloRings$/
];
// Jednostki wołane spoza grafu wywołań (window.*, rozkazy UI, fabuła) — źródła zdarzeń.
const JEDNOSTKI_ZDARZEN = new Set(['resolveBeamWorldHit', 'planBarrageSalvo', 'callInSupport', 'finishLineSpawnDrag',
  'triggerReactorBlow3D', 'startMercenaryMission', 'spawnStoryPirateStation', 'supportCallIns', 'supportReturn',
  'storyWarpOut', 'pickPirateCallInOrigin', 'ReactorGame', 'getMiningRig', 'stepShipAsteroidCollisions',
  'stepShipRingCollisions', 'fcMissileIncoming', 'fcFireMissileSalvo', 'stepPlayerFireControl', 'releaseNpcHexBody',
  'applyPlayerHullProfile', 'coldWreckSystem', 'setupPlayer2', 'Dev', 'fireWeaponCore']);
const JEDNOSTKI_KLATKI = new Set(['render', 'loop', 'drawNPCPretty', 'drawPlanetLabels', 'syncShotVisualHeights',
  'bridgeModelVisibility', 'refreshRadarFeed', 'runStoryMenuFlight']);
const JEDNOSTKI_KONFIGURACJI = new Set(['startGame', 'waitForPlanetsReady', 'initHaloRings', 'startMenuBackdrop',
  'ensurePlanetStationsInit', 'detachPlanetStationsIfNeeded', 'model3DIdOf', 'applyVisualMode', 'applyShaftQuality',
  'applyLacquer', 'updateHullLightUI', 'placeShipAtHaloRing', 'buildHudRadarWorldFeatures', 'planetOrbitRadii',
  'warpBodyRadius']);
const MOST_RENDERU = ['Core3D', 'initStations3D', 'updateStations3D', 'detachPlanetStations3D', 'drawStations3D', 'Destruction3D', 'THREE'];

function odwolaniaIndex(root, graf, renderWrites) {
  const S = skryptyIndex(root);
  const text = S.main.body;
  const ast = parseAst(text);
  const lineOf0 = lineIndex(text);
  const firstLine = S.lineOfHtml(S.main.bodyStart);
  const linia = (off) => lineOf0(off) + firstLine - 1;
  const indexAbs = join(root, 'index.html');

  // globale renderu: zapisy `window.X` w modułach renderu gry + most (małe skrypty index.html)
  const RENDER_GLOBALS = new Map();
  for (const w of renderWrites) if (!RENDER_GLOBALS.has(w.name)) RENDER_GLOBALS.set(w.name, w.at);
  for (const b of S.small) {
    let a; try { a = parseAst(b.body); } catch { continue; }
    for (const w of windowWrites(a)) if (MOST_RENDERU.includes(w.name) || /^Core3D/.test(w.name)) RENDER_GLOBALS.set(w.name, 'index.html#most');
  }

  // importy renderu w głównym skrypcie
  const RENDER_LOCAL = new Map(); // nazwa lokalna → moduł
  for (const st of ast.body) {
    if (st.type !== 'ImportDeclaration') continue;
    const spec = st.source.value;
    const res = resolveSpec(indexAbs, spec, root);
    const target = res ? rel(res, root) : spec;
    if (!(isRender(target) || target === 'three' || target.startsWith('three/'))) continue;
    for (const s of st.specifiers) RENDER_LOCAL.set(s.local.name, target);
  }

  // jednostki najwyższego poziomu i graf odwołań między nimi
  const units = [];
  for (const st of ast.body) {
    if (st.type === 'ImportDeclaration') continue;
    let name;
    if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') name = st.id.name;
    else if (st.type === 'VariableDeclaration') name = st.declarations.map((d) => d.id.name || '{…}').join(',');
    else name = `<top>`;
    const declNames = st.type === 'VariableDeclaration' ? st.declarations.map((d) => d.id.name).filter(Boolean) : (st.id ? [st.id.name] : []);
    units.push({ name, start: st.start, end: st.end, declNames, node: st });
  }
  const unitByDecl = new Map();
  for (const u of units) for (const n of u.declNames) unitByDecl.set(n, u);
  const unitAt = (off) => {
    let lo = 0, hi = units.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; const u = units[m]; if (off < u.start) hi = m - 1; else if (off >= u.end) lo = m + 1; else return u; }
    return null;
  };
  const declared = declaredNames(ast);
  const edges = new Map(units.map((u) => [u, new Set()]));
  walk(ast, (n, parents) => {
    if (n.type !== 'Identifier' || !isReference(n, parents)) return;
    const target = unitByDecl.get(n.name);
    if (!target) return;
    const from = unitAt(n.start);
    if (from && from !== target) edges.get(from).add(target);
  });
  const reach = (rootName) => {
    const r = unitByDecl.get(rootName);
    const seen = new Set();
    const st = r ? [r] : [];
    while (st.length) { const u = st.pop(); if (seen.has(u)) continue; seen.add(u); for (const v of edges.get(u)) st.push(v); }
    return seen;
  };
  const R_RENDER = reach('render'), R_PHYS = reach('physicsStep'), R_LOOP = reach('loop');
  const catOf = (u) => {
    if (!u) return 'top';
    const r = R_RENDER.has(u), p = R_PHYS.has(u);
    if (r && p) return 'oba';
    if (r) return 'render';
    if (p) return 'fizyka';
    if (R_LOOP.has(u)) return 'pętla';
    return 'inne';
  };

  // uchwyty: zmienne najwyższego poziomu przypisane z fabryki / klasy renderu
  const HANDLES = new Map();
  const topLets = new Set();
  for (const st of ast.body) if (st.type === 'VariableDeclaration') for (const d of st.declarations) if (d.id.type === 'Identifier') topLets.add(d.id.name);
  const rootIdent = (e) => {
    while (e && (e.type === 'MemberExpression' || e.type === 'CallExpression' || e.type === 'NewExpression' || e.type === 'AwaitExpression' || e.type === 'ChainExpression')) {
      e = e.type === 'MemberExpression' ? e.object : e.type === 'AwaitExpression' ? e.argument : e.type === 'ChainExpression' ? e.expression : e.callee;
    }
    return e && e.type === 'Identifier' ? e.name : null;
  };
  walk(ast, (n) => {
    let lhs = null, rhs = null;
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') { lhs = n.id.name; rhs = n.init; }
    else if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier') { lhs = n.left.name; rhs = n.right; }
    if (!lhs || !rhs || !topLets.has(lhs)) return;
    let e = rhs; if (e.type === 'AwaitExpression') e = e.argument;
    if (e.type !== 'CallExpression' && e.type !== 'NewExpression') return;
    const r = rootIdent(e.callee);
    if (r && (RENDER_LOCAL.has(r) || (RENDER_GLOBALS.has(r) && !declared.has(r)))) HANDLES.set(lhs, r);
  });
  for (const extra of ['mainScene3D', 'planetScene3D']) if (topLets.has(extra) && !HANDLES.has(extra)) HANDLES.set(extra, 'initWorld3D/initPlanets3D');

  // moduły renderu bez stanu: przechodnio bez three, bez zapisów window, bez let / var / kolekcji najwyższego
  // poziomu, poza modułami kanwy 2D — symbole „dane”
  const czystyModul = new Map();
  const czysty = (m) => {
    if (!m || !isRender(m) || ZOSTAJE_NA_WATKU_GLOWNYM.has(m)) return false;
    if (czystyModul.has(m)) return czystyModul.get(m);
    czystyModul.set(m, false); // cykle
    const e = graf.get(m);
    let ok = !!e && !e.imports.some((im) => /^three(\/|$)/.test(im.spec));
    if (ok) {
      const P = parsed(root, m);
      ok = windowWrites(P.ast).length === 0 && !P.ast.body.some((st) => {
        const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
        if (!d || d.type !== 'VariableDeclaration') return false;
        if (d.kind !== 'const') return true;
        return d.declarations.some((x) => x.init && x.init.type === 'NewExpression');
      });
    }
    if (ok) for (const im of e.imports) if (im.resolved && isRender(im.resolved) && !czysty(im.resolved)) { ok = false; break; }
    czystyModul.set(m, ok);
    return ok;
  };

  const refs = [];
  walk(ast, (n, parents) => {
    let sym = null, via = null, node = n, ps = parents;
    if (n.type === 'Identifier' && isReference(n, parents)) {
      if (RENDER_LOCAL.has(n.name)) { sym = n.name; via = 'import'; }
      else if (HANDLES.has(n.name)) { sym = n.name; via = 'uchwyt'; }
      else if (RENDER_GLOBALS.has(n.name) && !declared.has(n.name) && !OKNO.has(n.name)) { sym = n.name; via = 'global'; }
      else if (OKNO.has(n.name)) {
        const p = parents[parents.length - 1];
        if (p && p.type === 'MemberExpression' && p.object === n && !p.computed && RENDER_GLOBALS.has(p.property.name)) {
          sym = p.property.name; via = 'window'; node = p; ps = parents.slice(0, -1);
        }
      }
    } else if (n.type === 'ImportExpression' && n.source.type === 'Literal') {
      const res = resolveSpec(indexAbs, String(n.source.value), root);
      if (res && isRender(rel(res, root))) { sym = `import(${n.source.value})`; via = 'dynamic'; }
    }
    if (!sym) return;
    const { chain, top, topIndex } = memberChainUp(node, ps);
    const usage = via === 'dynamic' ? 'call-value' : usageOf(top, ps, topIndex);
    const u = unitAt(n.start);
    // wystawienie na okno: window.X = <symbol renderu>
    const parentOfTop = ps[topIndex];
    const exposure = parentOfTop && parentOfTop.type === 'AssignmentExpression' && parentOfTop.right === top
      && parentOfTop.left.type === 'MemberExpression' && parentOfTop.left.object.type === 'Identifier' && OKNO.has(parentOfTop.left.object.name);
    refs.push({ sym, via, member: [sym, ...chain.slice(0, 2)].join('.'), linia: linia(n.start), usage,
      unit: u ? u.name : '<?>', cat: catOf(u), module: RENDER_LOCAL.get(sym) || null, exposure });
  });

  for (const r of refs) {
    const unit = r.unit;
    const isQuery = ZAPYTANIA.some((re) => re.test(r.member) || re.test(r.sym));
    const valueUse = r.usage === 'call-value' || r.usage === 'read' || r.usage === 'typeof';
    const bare = r.member === r.sym && (r.usage === 'read' || r.usage === 'typeof');
    let g;
    if (DANE_JAWNE.has(r.sym) || (r.via === 'import' && czysty(r.module))) g = 'dane';
    else if (r.exposure) g = 'konfiguracja';
    else if (bare && (JEDNOSTKI_KLATKI.has(unit) || r.cat === 'render')) g = 'aktualizacja';
    else if (bare && (JEDNOSTKI_KONFIGURACJI.has(unit) || unit === '<top>')) g = 'konfiguracja';
    else if (isQuery && (valueUse || /^(isShieldBreachedAt|haloRings\.constrainShip|asteroidBelt\.pointBlocked)/.test(r.member))) g = 'zapytanie';
    else if (JEDNOSTKI_KLATKI.has(unit) || r.cat === 'render') g = 'aktualizacja';
    else if (JEDNOSTKI_KONFIGURACJI.has(unit) || (unit === '<top>' && !JEDNOSTKI_ZDARZEN.has(unit))) g = 'konfiguracja';
    else if (JEDNOSTKI_ZDARZEN.has(unit) || r.cat === 'fizyka' || r.cat === 'oba') g = 'zdarzenie';
    else if (r.cat === 'pętla') g = 'aktualizacja';
    else g = 'konfiguracja';
    r.grupa = g;
  }
  return { refs, handles: [...HANDLES].map(([name, from]) => ({ name, from })), renderGlobals: RENDER_GLOBALS.size,
    renderLocals: RENDER_LOCAL.size, units: units.length };
}

// ── Całość ────────────────────────────────────────────────────────────────────
/**
 * Inwentarz szwu na drzewie `root`. Zwraca { liczniki: { klucz: n }, szczegoly }.
 * `liczniki` zawiera tylko klucze z wartością > 0. Opcje: `graf` — gotowy graf gry (`grafGry()`), `nadpisz` —
 * { plik: treść } zamiast plików z dysku (sprawdzenie strażnika na zmienionej kopii).
 */
export function szewRenderu(root = repo, { graf: grafGotowy = null, nadpisz = null } = {}) {
  NADPISZ = nadpisz;
  try { return szewRenderuWlasciwy(root, grafGotowy, nadpisz); } finally { NADPISZ = null; }
}

// Graf gry z plikami podmienionymi treścią `nadpisz` (importy podmienionych plików liczone od nowa).
function grafZNadpisaniem(root, graf, nadpisz) {
  const out = new Map(graf);
  for (const [f, text] of Object.entries(nadpisz)) {
    if (!out.has(f)) continue;
    const abs = join(root, f);
    const imports = importsOf(abs, lex(text).noCom, text).map((x) => {
      const res = resolveSpec(abs, x.spec, root);
      return { ...x, resolved: res ? rel(res, root) : null };
    });
    out.set(f, { ...out.get(f), imports });
    for (const im of imports) {
      if (!im.resolved || out.has(im.resolved)) continue;
      for (const [k, v] of grafImportow(im.resolved, root)) if (!out.has(k)) out.set(k, v);
    }
  }
  return out;
}

/** Graf gry (do ponownego użycia w `szewRenderu(root, { graf })`). */
export const grafGry = (root = repo) => grafImportow('index.html', root);

function szewRenderuWlasciwy(root, grafGotowy, nadpisz) {
  let graf = grafGotowy || grafImportow('index.html', root);
  if (nadpisz) graf = grafZNadpisaniem(root, graf, nadpisz);
  const gameFiles = [...graf.keys()].filter((f) => /\.m?js$/.test(f));
  const renderFiles = gameFiles.filter(isRender).sort();
  const liczniki = {};
  const add = (k, n = 1) => { liczniki[k] = (liczniki[k] || 0) + n; };
  const miejsca = {}; // klucz → [plik:linia]
  const gdzie = (k, at) => { (miejsca[k] ||= []).push(at); };

  // zapisy window: render vs gra (index.html i moduły gry spoza renderu)
  const renderWrites = [];
  const writtenByGame = new Set();
  for (const f of gameFiles) {
    let P; try { P = parsed(root, f); } catch { continue; }
    for (const w of windowWrites(P.ast)) {
      if (isRender(f)) renderWrites.push({ name: w.name, at: `${f}:${P.lineOf(w.start)}` });
      else writtenByGame.add(w.name);
    }
  }
  {
    const S = skryptyIndex(root);
    for (const b of [S.main, ...S.small]) {
      let a; try { a = parseAst(b.body); } catch { continue; }
      for (const w of windowWrites(a)) writtenByGame.add(w.name);
    }
  }
  const writtenByRender = new Set(renderWrites.map((w) => w.name));
  const zmiennaGry = (name) => !PRZEGLADARKA.has(name) && (writtenByGame.has(name) || !writtenByRender.has(name));

  // (1) index.html → render
  const idx = odwolaniaIndex(root, graf, renderWrites);
  for (const r of idx.refs) { add(`index:${r.grupa}`); gdzie(`index:${r.grupa}`, `index.html:${r.linia} ${r.member}`); }

  // (2) importy render → symulacja (i odwrotnie — tylko w szczegółach)
  const symDoRenderu = [];
  for (const f of gameFiles) {
    for (const im of graf.get(f).imports) {
      if (!im.resolved) continue;
      if (isRender(f) && isSim(im.resolved)) { add(`import:${im.resolved}`); gdzie(`import:${im.resolved}`, f); }
      if (isSim(f) && isRender(im.resolved)) symDoRenderu.push(`${f} → ${im.resolved}`);
    }
  }

  // (3)–(6) moduły renderu
  for (const f of renderFiles) {
    const P = parsed(root, f);
    const declared = declaredNames(P.ast);
    const przenoszony = isPrzenoszony(f);
    const at = (n) => `${f}:${P.lineOf(n.start)}`;
    walk(P.ast, (n, parents) => {
      const p = parents[parents.length - 1];
      // window.X / globalThis.X / self.X
      if (n.type === 'MemberExpression' && n.object.type === 'Identifier' && OKNO.has(n.object.name) && !declared.has(n.object.name)) {
        const name = !n.computed && n.property.type === 'Identifier' ? n.property.name : (n.computed && n.property.type === 'Literal' ? String(n.property.value) : null);
        if (!name) return;
        const zapis = p && ((p.type === 'AssignmentExpression' && p.left === n) || (p.type === 'UpdateExpression'));
        if (!zapis && zmiennaGry(name)) {
          const k = `${przenoszony ? 'okno' : 'okno-kanwa'}:${name}`;
          add(k); gdzie(k, at(n));
        }
        if (przenoszony && DOM_GLOBALE.has(name) && !(p && p.type === 'UnaryExpression' && p.operator === 'typeof')) { add(`dom:${f}`); gdzie(`dom:${f}`, `${at(n)} window.${name}`); }
        if (przenoszony && (name === 'addEventListener' || name === 'removeEventListener')) { add(`dom:${f}`); gdzie(`dom:${f}`, `${at(n)} window.${name}`); }
        return;
      }
      if (n.type === 'Identifier' && n.name === 'GameState' && p && p.type === 'MemberExpression' && p.object === n) { add(`gamestate:${f}`); gdzie(`gamestate:${f}`, at(n)); }
      if (n.type === 'Identifier' && isReference(n, parents) && !declared.has(n.name)) {
        const typeofOnly = p && p.type === 'UnaryExpression' && p.operator === 'typeof';
        if (!ZNANE_GLOBALE.has(n.name) && zmiennaGry(n.name) && writtenByGame.has(n.name) && !typeofOnly) {
          const k = `${przenoszony ? 'okno' : 'okno-kanwa'}:${n.name}`;
          add(k); gdzie(k, at(n));
        }
        if (przenoszony && DOM_GLOBALE.has(n.name) && !typeofOnly) { add(`dom:${f}`); gdzie(`dom:${f}`, `${at(n)} ${n.name}`); }
        return;
      }
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.property.type === 'Identifier') {
        const m = n.callee.property.name;
        const obj = n.callee.object;
        if (m === 'random' && obj.type === 'Identifier' && obj.name === 'Math') { add(`random:${f}`); gdzie(`random:${f}`, at(n)); }
        if (GPU_ODCZYT.has(m)) { add(`gpu:${f}`); gdzie(`gpu:${f}`, `${at(n)} ${m}`); }
        if (przenoszony) {
          if (m === 'createElement' || m === 'createElementNS') { add(`dom:${f}`); gdzie(`dom:${f}`, `${at(n)} ${m}`); }
        }
      }
      if (przenoszony && n.type === 'CallExpression' && n.callee.type === 'Identifier' && (n.callee.name === 'addEventListener' || n.callee.name === 'removeEventListener') && !declared.has(n.callee.name)) {
        add(`dom:${f}`); gdzie(`dom:${f}`, `${at(n)} ${n.callee.name}`);
      }
    });
  }

  return {
    liczniki,
    szczegoly: {
      plikiGry: gameFiles.length,
      plikiRenderu: renderFiles.length,
      plikiPrzenoszone: renderFiles.filter(isPrzenoszony).length,
      linieRenderu: renderFiles.reduce((s, f) => s + parsed(root, f).text.split('\n').length, 0),
      index: { symbole: new Set(idx.refs.map((r) => r.sym)).size, odwolania: idx.refs.length, uchwyty: idx.handles,
        importyNazw: idx.renderLocals, globaleRenderu: idx.renderGlobals, jednostki: idx.units },
      symulacjaDoRenderu: symDoRenderu,
      miejsca
    }
  };
}

// Sumy per rodzina kluczy (prefiks przed „:”, `index:` per grupa).
export function podsumowanie(liczniki) {
  const out = {};
  for (const [k, v] of Object.entries(liczniki)) {
    const fam = k.startsWith('index:') ? k : k.slice(0, k.indexOf(':'));
    const s = (out[fam] ||= { klucze: 0, suma: 0 });
    s.klucze++; s.suma += v;
  }
  return out;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && /szewRenderu\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const t0 = performance.now();
  const wynik = szewRenderu();
  const ms = performance.now() - t0;
  const args = process.argv.slice(2);
  if (args.includes('--sufity')) {
    const keys = Object.keys(wynik.liczniki).sort();
    console.log('const SUFITY = {');
    for (const k of keys) console.log(`  '${k}': ${wynik.liczniki[k]},`);
    console.log('};');
  } else {
    const S = wynik.szczegoly;
    console.log(`szew renderu (${ms.toFixed(0)} ms): pliki gry ${S.plikiGry}, renderu ${S.plikiRenderu} (${S.linieRenderu} linii), przenoszone ${S.plikiPrzenoszone}`);
    console.log(`index.html: ${S.index.odwolania} odwołań do ${S.index.symbole} symboli renderu (uchwyty: ${S.index.uchwyty.map((h) => h.name).join(', ')})`);
    console.log(`symulacja → render: ${S.symulacjaDoRenderu.length} importów`);
    for (const [fam, s] of Object.entries(podsumowanie(wynik.liczniki))) console.log(`  ${fam.padEnd(22)} kluczy ${String(s.klucze).padStart(3)}  suma ${s.suma}`);
  }
  const j = args.indexOf('--json');
  if (j >= 0 && args[j + 1]) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(args[j + 1], JSON.stringify(wynik, null, 1));
  }
}
