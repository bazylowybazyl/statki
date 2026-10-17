// SZEW SYMULACJI (2026-10-17, audyt „fizyka w workerze” — docs/AUDYT-fizyka-worker-2026-10-17.md § 5): co osiąga
// physicsStep w głównym skrypcie index.html (funkcje lokalne przechodnio, po identyfikatorach — przybliżenie z góry),
// czego dotyka (DOM, UI, dźwięk, render, window, wejście), z jakich modułów korzysta; RDZEŃ = osiągalność bez schodzenia
// w funkcje UI (DOM wprost, budowniczy paneli, komunikaty, dźwięk — „granice”, które w workerze stają się zdarzeniami);
// oraz kto poza krokiem (render(), loop(), obsługa wejścia, UI) czyta stan symulacji (lustra po stronie wątku gry).
//   node scripts/szew-symulacji.mjs [--json plik]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseAst } from 'rollup/parseAst';
import { repo, scriptBlocks } from './webgpu/grafGry.mjs';

const html = readFileSync(join(repo, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const blocks = scriptBlocks(html).filter((b) => !b.src && /module/.test(b.type));
blocks.sort((a, b) => b.body.length - a.body.length);
const main = blocks[0];
const src = main.body;
const lineBase = html.slice(0, main.bodyStart).split('\n').length - 1;
const lineOf = (pos) => lineBase + src.slice(0, pos).split('\n').length;
const ast = parseAst(src, { allowReturnOutsideFunction: true });

// --- importy: binding → moduł
const importOf = new Map();
for (const n of ast.body) {
  if (n.type !== 'ImportDeclaration') continue;
  const mod = n.source.value;
  for (const s of n.specifiers) importOf.set(s.local.name, mod.replace(/^\.\//, ''));
}

// --- funkcje lokalne (deklaracje i const/let x = function / arrow) w całym skrypcie
const fns = new Map(); // nazwa → [węzły]
const addFn = (name, node, body) => { if (!fns.has(name)) fns.set(name, []); fns.get(name).push({ node, body }); };
function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const k in node) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, visit, node); }
    else if (v && typeof v.type === 'string') walk(v, visit, node);
  }
}
walk(ast, (n) => {
  if (n.type === 'FunctionDeclaration' && n.id) addFn(n.id.name, n, n.body);
  if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init && /FunctionExpression|ArrowFunctionExpression/.test(n.init.type)) addFn(n.id.name, n, n.init.body);
  // window.X = function / arrow
  if (n.type === 'AssignmentExpression' && n.left?.type === 'MemberExpression' && n.left.object?.name === 'window' && n.left.property?.name
    && n.right && /FunctionExpression|ArrowFunctionExpression/.test(n.right.type)) addFn('window.' + n.left.property.name, n, n.right.body);
});

// identyfikatory użyte w ciele (bez nazw właściwości i kluczy)
function idsIn(body) {
  const out = new Set();
  walk(body, (n, p) => {
    if (n.type !== 'Identifier') return;
    if (p && p.type === 'MemberExpression' && p.property === n && !p.computed) return;
    if (p && p.type === 'Property' && p.key === n && !p.computed && !p.shorthand) return;
    out.add(n.name);
  });
  return out;
}

function reach(roots, stop = null) {
  const seen = new Set(), queue = [...roots];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name) || !fns.has(name)) continue;
    seen.add(name);
    if (stop && stop.has(name)) continue;   // punkt wejścia UI: sam się liczy, dalej nie schodzimy
    for (const { body } of fns.get(name)) for (const id of idsIn(body)) if (fns.has(id) && !seen.has(id)) queue.push(id);
  }
  return seen;
}

const PAT = {
  dom: /\bdocument\b|getElementById|querySelector|\.classList\b|\.innerHTML\b|\.textContent\b|\.style\.|addEventListener|createElement|getBoundingClientRect|\.innerText\b/g,
  storage: /\blocalStorage\b|sessionStorage/g,
  audio: /\bAudioSys\b|playSound|playSfx|\bSfx\b|\.engineSound\b|AudioContext|createBufferSource|\bsound[A-Z]\w*\(/g,
  ui: /\bhudSystem\b|\bCockpitUI\b|\bstationUI\b|\bInfrastructureUI\b|\bscannerOverviewUI\b|\bradarTargetingUI\b|\bCICDisplay\b|\bpushZoneMessage\b|\bpushAlert\b|\bzoomIndicator\b|\bmissionCompleteBanner\b|\bFleetUI\b|\bopenStationUI\b|\bupdateStationUIState\b|\bhudUpdateNav\b|showToast|\bshowMessage\b/g,
  render: /\bCore3D\b|\bWeaponFx\b|\bRenderCommands\b|\bCanvasVFX\b|\bspawnParticle\b|\bFx3D\b|\bSparkSystem3D\b|\bBridge3D\b|\bHullDamageMap\b|\bHullDamageEvents\b|\bGameBlasts\b|\bmakeReactorBlow\b|\bWarpNurt\b|\bCollisionFX\b|\bspawnShockwave\b|\bTurret2D\b/g,
  windowRead: /\bwindow\.[A-Za-z_$][\w$]*/g,
  input: /\bInput\.(keyHeld|padHeld|padPressed|padAxis|axis|manualFlight)|\bmouse\.(x|y|overCanvas)|\bkeys\[/g,
  random: /Math\.random/g,
  perfNow: /performance\.now/g
};

function scan(names) {
  const tot = {}, byFn = {}, uniq = {};
  for (const k in PAT) { tot[k] = 0; uniq[k] = new Map(); }
  for (const name of names) {
    for (const { body } of fns.get(name)) {
      const text = src.slice(body.start, body.end);
      for (const k in PAT) {
        const m = text.match(PAT[k]) || [];
        tot[k] += m.length;
        if (m.length) { byFn[name] ||= {}; byFn[name][k] = (byFn[name][k] || 0) + m.length; }
        for (const s of m) uniq[k].set(s, (uniq[k].get(s) || 0) + 1);
      }
    }
  }
  const top = (k, n = 25) => [...uniq[k].entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([s, c]) => `${s}×${c}`);
  return { tot, byFn, top };
}

function modulesOf(names) {
  const mods = new Map();
  for (const name of names) for (const { body } of fns.get(name)) for (const id of idsIn(body)) {
    const m = importOf.get(id); if (!m) continue;
    if (!mods.has(m)) mods.set(m, new Set()); mods.get(m).add(id);
  }
  return mods;
}
const layer = (m) => /src\/(game|ai)\//.test(m) ? 'sym' : /src\/ui\//.test(m) ? 'ui' : /src\/(3d|vfx|effects3d|render)\//.test(m) ? 'render' : /src\/input\//.test(m) ? 'wejście' : /src\/data\//.test(m) ? 'dane' : 'inne';

const linesOf = (names) => { let L = 0; for (const n of names) for (const { node } of fns.get(n)) L += src.slice(node.start, node.end).split('\n').length; return L; };

const physR = reach(['physicsStep']);
const renderR = reach(['render']);
const loopR = reach(['loop']);
const physOnly = [...physR];
const renderOnly = [...renderR].filter((n) => !physR.has(n));

const phys = scan(physOnly);
const physMods = modulesOf(physOnly);
const modsByLayer = {};
for (const [m, ids] of physMods) { const l = layer(m); (modsByLayer[l] ||= []).push(`${m} (${[...ids].slice(0, 6).join(', ')}${ids.size > 6 ? '…' : ''})`); }

// Kto poza krokiem czyta stan symulacji: odwołania do głównych zmiennych świata w funkcjach osiągalnych z render()
// (bez tych z kroku) i we wszystkich pozostałych funkcjach (wejście, UI, stacja…).
const SIM_STATE = /\b(ship|npcs|bullets|wrecks|coldWrecks|stations|player2Ship|HullBodies|worldBodies|SensorSystem|fireControl|warp|driveState|PLAYER|StoryGame|ScoutBay|RepairSwarm|ReactorGame|rocketSystem3D)\b/g;
const countSim = (names) => { let c = 0, f = 0; for (const n of names) { let k = 0; for (const { body } of fns.get(n)) k += (src.slice(body.start, body.end).match(SIM_STATE) || []).length; if (k) { c += k; f++; } } return { odwolan: c, funkcji: f }; };
const allFns = [...fns.keys()];
const other = allFns.filter((n) => !physR.has(n) && !renderR.has(n) && !loopR.has(n));

// funkcje osiągalne z kroku, które piszą do DOM / UI (lista z liniami)
const domFns = Object.entries(phys.byFn).filter(([, v]) => v.dom || v.ui || v.audio || v.storage)
  .map(([n, v]) => ({ fn: n, linia: lineOf(fns.get(n)[0].node.start), ...v }))
  .sort((a, b) => (b.dom || 0) + (b.ui || 0) + (b.audio || 0) - (a.dom || 0) - (a.ui || 0) - (a.audio || 0));

// Rdzeń symulacji: osiągalność z physicsStep, ale bez schodzenia w funkcje UI (DOM wprost albo budowniczy paneli) —
// takie funkcje to „granice” (zdarzenie / rozkaz do strony), liczone osobno.
const DOM_DIRECT = /\bdocument\b|createElement|\.textContent\b|\.classList\b|querySelector|\.innerHTML\b|\.style\.|getElementById|getBoundingClientRect/;
const UI_NAMES = /^(build|create)\w*(Panel|Card|Row|Icon|Section|Tab)s?$|^(open|close|render|show|hide|toggle)Station|^updateHoverInfo$|^hideHoverInfo$|^toast$|^pushZoneMessage$|^pushSpecialChargeMessage$|^playDynamicSound$|^updateStationHeader$/;
const uiLeaf = new Set();
for (const [name, list] of fns) {
  if (name === 'physicsStep') continue;
  if (UI_NAMES.test(name) || list.some(({ body }) => DOM_DIRECT.test(src.slice(body.start, body.end)))) uiLeaf.add(name);
}
const coreR = reach(['physicsStep'], uiLeaf);
const core = [...coreR].filter((n) => !uiLeaf.has(n));
const borders = [...coreR].filter((n) => uiLeaf.has(n));
const coreScan = scan(core);
const result0 = {
  rdzen: { funkcji: core.length, linii: linesOf(core), wzorce: coreScan.tot, granicUI: borders.length,
    granice: borders.map((n) => `${n}:${lineOf(fns.get(n)[0].node.start)}`), ui: coreScan.top('ui'), audio: coreScan.top('audio'), input: coreScan.top('input'), dom: coreScan.top('dom') }
};
const result = {
  ...result0,
  skrypt: { linie: src.split('\n').length, funkcjiLokalnych: fns.size, importow: importOf.size },
  krok: { funkcji: physR.size, linii: linesOf(physOnly), wzorce: phys.tot, top: { window: phys.top('windowRead', 40), ui: phys.top('ui'), audio: phys.top('audio'), dom: phys.top('dom'), render: phys.top('render'), input: phys.top('input') } },
  modulyKroku: modsByLayer,
  funkcjeKrokuZDomUiDzwiekiem: domFns.slice(0, 60),
  render: { funkcjiTylkoRender: renderOnly.length, linii: linesOf(renderOnly), stanSymulacji: countSim(renderOnly) },
  pozostale: { funkcji: other.length, linii: linesOf(other), stanSymulacji: countSim(other) }
};
const json = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
if (json) writeFileSync(resolve(json), JSON.stringify(result, null, 1));
console.log(JSON.stringify({ ...result, funkcjeKrokuZDomUiDzwiekiem: result.funkcjeKrokuZDomUiDzwiekiem.slice(0, 40) }, null, 1));
