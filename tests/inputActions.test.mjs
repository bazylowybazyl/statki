import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Katalog akcji i układy (src/input/inputActions.js) oraz klej w index.html (blok „WEJŚCIE / PAD”, GameActions) —
// docs/PLAN-pad.md § 4, etap 1.
const {
  INPUT_ACTIONS, ACTION_BY_ID, KEYBOARD_LAYOUT, MOUSE_LAYOUT, PAD_LAYOUT, PAD_LAYOUT_P2, KEYDOWN_ORDER, KEY_AXES,
  buildKeydownMap, keyLabel, padButtonLabel, padBindingLabel, actionLabels, padBindings
} = await import('../src/input/inputActions.js');
const { PB, PAD_FAMILY } = await import('../src/input/padDevice.js');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const FAMILIES = [PAD_FAMILY.XBOX, PAD_FAMILY.PLAYSTATION, PAD_FAMILY.NINTENDO, PAD_FAMILY.GENERIC];

test('katalog: każda akcja ma id, nazwę, rodzaj i konteksty; układy znają każdą akcję', () => {
  const ids = new Set();
  for (const a of INPUT_ACTIONS) {
    assert.ok(/^[a-z]+\.[a-zA-Z0-9]+$/.test(a.id), a.id);
    assert.ok(!ids.has(a.id), `powtórzone id ${a.id}`);
    ids.add(a.id);
    assert.ok(a.name && a.name.length > 3, `${a.id}: nazwa`);
    assert.ok(['edge', 'hold', 'axis'].includes(a.kind), `${a.id}: rodzaj`);
    assert.ok(Array.isArray(a.ctx) && a.ctx.length > 0, `${a.id}: konteksty`);
    // jawne wiązanie albo jawny brak (null) — akcja nie może zniknąć z układu przez zapomnienie
    assert.ok(a.id in KEYBOARD_LAYOUT, `${a.id}: brak wpisu klawiatury`);
    assert.ok(a.id in PAD_LAYOUT, `${a.id}: brak wpisu pada`);
    if (a.shares) assert.ok(ACTION_BY_ID[a.shares], `${a.id}: shares → ${a.shares}`);
  }
  for (const id of [...Object.keys(KEYBOARD_LAYOUT), ...Object.keys(PAD_LAYOUT), ...Object.keys(MOUSE_LAYOUT)]) {
    assert.ok(ACTION_BY_ID[id], `układ zna nieistniejącą akcję ${id}`);
  }
});

test('etykiety: każde wiązanie ma etykietę klawiatury / myszy i pada (każda rodzina); akcja ma jakieś wiązanie', () => {
  for (const a of INPUT_ACTIONS) {
    const kb = actionLabels(a.id);
    const hasKey = !!(KEYBOARD_LAYOUT[a.id] && KEYBOARD_LAYOUT[a.id].length);
    const hasPad = padBindings(PAD_LAYOUT, a.id).length > 0;
    assert.ok(hasKey || MOUSE_LAYOUT[a.id] || hasPad, `${a.id}: żadnego wiązania`);
    if (hasKey) assert.ok(kb.keys.length > 0, `${a.id}: etykieta klawiatury`);
    for (const fam of FAMILIES) {
      const l = actionLabels(a.id, fam);
      if (hasPad) assert.ok(l.pad.length > 0 && !l.pad.includes('#'), `${a.id}: etykieta pada (${fam}) = „${l.pad}”`);
    }
    // akcje pada bez klawiatury i myszy to tylko dawne ścieżki pada (do usunięcia w układzie „Dowódca”)
    if (!hasKey && !MOUSE_LAYOUT[a.id]) assert.ok(a.legacy, `${a.id}: tylko pad — oznacz legacy albo dodaj klawisz`);
  }
  assert.equal(keyLabel('KeyW'), 'W');
  assert.equal(keyLabel('Digit9'), '9');
  assert.equal(keyLabel('Numpad7'), 'Num 7');
  assert.equal(keyLabel('CapsLock'), 'Caps Lock');
  assert.equal(keyLabel('Space'), 'Spacja');
  assert.equal(padButtonLabel(PB.A, PAD_FAMILY.XBOX), 'A');
  assert.equal(padButtonLabel(PB.A, PAD_FAMILY.PLAYSTATION), '✕');
  assert.equal(padButtonLabel(PB.LB, PAD_FAMILY.PLAYSTATION), 'L1');
  assert.equal(padBindingLabel({ axis: 1, dir: -1 }), 'LS ↑');
  assert.equal(padBindingLabel({ axis: 0, curve: 1.6 }), 'LS ↔');
  assert.equal(padBindingLabel({ button: PB.B, holdMs: 600 }), 'B (przytrzymaj)');
  assert.equal(actionLabels('nav.warp').keys, 'Caps Lock / 9 / Num 9');
  assert.equal(actionLabels('nav.warp', PAD_FAMILY.XBOX).pad, 'Y');
  assert.equal(actionLabels('wpn.fire').mouse, 'LPM');
});

// Wejścia akcji w kontekście: klucze „k:Kod” / „p:b7” / „a:1+” (połowa osi) / „a:1” (oś) / „s:right”.
function inputsOf(id, layoutPad) {
  const out = [];
  for (const c of KEYBOARD_LAYOUT[id] || []) out.push(`k:${c}`);
  for (const b of padBindings(layoutPad, id)) {
    if (typeof b.button === 'number') out.push(`p:${b.button}${b.holdMs ? 'h' : ''}`);
    else if (b.stick) out.push(`s:${b.stick}`);
    else if (b.dir) out.push(`a:${b.axis}${b.dir > 0 ? '+' : '-'}`);
    else out.push(`a:${b.axis}`);
  }
  return out;
}

test('brak kolizji w kontekście (poza jawnym `shares` i parą oś / połówki osi tego samego lotu)', () => {
  // Wejścia rozstrzygane przez dawny łańcuch keydown albo przez inny słuchacz DOM (menu, fabuła, stacja) — te
  // same klawisze w innym kontekście nie są kolizją; w tym samym — tylko z `shares` (bramki rozłączne).
  const AXIS_PARTS = { 'fly.thrust': ['fly.forward', 'fly.back'], 'fly.turn': ['fly.left', 'fly.right'] };
  const partOf = (id) => Object.keys(AXIS_PARTS).find((ax) => AXIS_PARTS[ax].includes(id)) || null;
  const ctxs = new Set(INPUT_ACTIONS.flatMap((a) => a.ctx));
  for (const ctx of ctxs) {
    const seen = new Map();
    for (const a of INPUT_ACTIONS.filter((x) => x.ctx.includes(ctx))) {
      for (const inp of inputsOf(a.id, PAD_LAYOUT)) {
        const prev = seen.get(inp);
        if (prev) {
          const ok = a.shares === prev || ACTION_BY_ID[prev].shares === a.id
            || partOf(a.id) === prev || partOf(prev) === a.id
            || (ACTION_BY_ID[prev].shares && ACTION_BY_ID[prev].shares === a.shares)
            || (inp.startsWith('k:') && (a.id === 'ui.menu' || prev === 'ui.menu'));
          assert.ok(ok, `kontekst ${ctx}: ${inp} w ${prev} i ${a.id}`);
        } else {
          seen.set(inp, a.id);
        }
      }
    }
  }
});

test('pad, etap 1: dzisiejszy zakres akcji gracza 1 w grze (lot, RT, dopalacz, warp, zoom, kursor, CIC, menu)', () => {
  const inGame = INPUT_ACTIONS.filter((a) => a.ctx.includes('game') && padBindings(PAD_LAYOUT, a.id).length).map((a) => a.id).sort();
  assert.deepEqual(inGame, [
    'aim.cursor', 'cam.zoomIn', 'cam.zoomOut', 'fly.back', 'fly.boost', 'fly.forward', 'fly.left', 'fly.right',
    'fly.thrust', 'fly.turn', 'nav.warp', 'story.action', 'ui.cic', 'ui.menu', 'wpn.fire', 'wpn.rocket', 'wpn.specialFire'
  ]);
  assert.deepEqual(PAD_LAYOUT['nav.warp'], { button: PB.Y }, 'Y — zbocze (B1)');
  assert.deepEqual(PAD_LAYOUT['wpn.fire'], { button: PB.RT });
  assert.equal(PAD_LAYOUT['ship.ram'], null, 'szarża na B — układ „Dowódca” (etap 4), nie etap 1');
  // gracz 2 jak dziś: A albo RT — główna broń
  assert.deepEqual(padBindings(PAD_LAYOUT_P2, 'wpn.fire').map((b) => b.button).sort(), [PB.A, PB.RT].sort());
  // B11: A bez martwej salwy (w grze tylko przycisk panelu fabuły), RS bez ship.input.aimX / aimY
  assert.equal(padBindings(PAD_LAYOUT, 'story.action')[0].button, PB.A);
});

test('kolejność głównego keydown = dawny łańcuch (tryby wydobycia i torped pierwsze, CIC przed szarżą)', () => {
  assert.equal(new Set(KEYDOWN_ORDER).size, KEYDOWN_ORDER.length);
  for (const id of KEYDOWN_ORDER) {
    assert.ok(ACTION_BY_ID[id], id);
    assert.ok((KEYBOARD_LAYOUT[id] || []).length > 0, `${id}: bez klawisza w keydown`);
  }
  const map = buildKeydownMap();
  assert.deepEqual(map.get('KeyF'), ['mining.detonate', 'ship.ram', 'wpn.rocketKey']);
  assert.deepEqual(map.get('KeyT'), ['mining.tractor', 'tgt.priority']);
  assert.deepEqual(map.get('KeyL'), ['mining.charge', 'ship.lights']);
  assert.deepEqual(map.get('KeyV'), ['cic.systemView', 'fly.driveMode']);
  assert.deepEqual(map.get('KeyW'), ['cic.pan']);
  assert.deepEqual(map.get('Digit8'), ['mode.torpedo']);
  assert.deepEqual(map.get('CapsLock'), ['nav.warp']);
  assert.deepEqual(map.get('ShiftLeft'), ['fly.boost']);
  assert.equal(map.get('Escape'), undefined, 'Esc ma własny słuchacz (ui.menu)');
  assert.deepEqual(KEY_AXES['fly.thrust'], ['fly.back', 'fly.forward']);
});

test('index.html: każda akcja keydown i pada ma wpis w GameActions', () => {
  const start = html.indexOf('const GameActions = new Map(Object.entries({');
  assert.ok(start > 0, 'rejestr GameActions');
  const end = html.indexOf('window.GameActions = GameActions;', start);
  const block = html.slice(start, end);
  const used = new Set([...KEYDOWN_ORDER, 'ui.menu', 'story.confirm', 'story.action', 'story.skip', 'station.close', 'nav.warp', 'ui.cic']);
  for (const id of used) assert.ok(block.includes(`'${id}': {`), `GameActions bez '${id}'`);
});

test('index.html: urządzenia czytane w jednym miejscu, logika gry bez keys[...] (warstwa wejścia)', () => {
  const reads = html.match(/navigator\.getGamepads\s*\(/g) || [];
  assert.equal(reads.length, 1, 'jeden odczyt pada (createInput → pumpInput)');
  assert.match(html, /const Input = createInput\(\{ read: \(\) => \(navigator\.getGamepads \? navigator\.getGamepads\(\) : null\) \}\);/);
  assert.doesNotMatch(html, /\bkeys\[['"]/, 'odczyty keys[...] w logice gry — przez Input.keyHeld / axis / manualFlight');
  assert.doesNotMatch(html, /function applyGamepad\(|function menuGamepadLoop\(|function getP1GamepadForwardInput\(|function isGamepadActiveForP1\(|function controllerSelectLoop\(|function shipSelectGamepadLoop\(/);
  assert.doesNotMatch(html, /triggerRailVolley/, 'martwa salwa pada (B11)');
  // pętla gry: pumpInput przed gałęzią pauzy (strażnik znacznika rAF w Input.update)
  const loop = html.slice(html.indexOf('function loop(now) {'), html.indexOf('if (PAUSED || StoryGame.worldFrozen) {', html.indexOf('function loop(now) {')));
  assert.match(loop, /pumpInput\(now\);/);
  assert.match(html, /function inputFrameLoop\(now\) \{\n\s+pumpInput\(now\);\n\s+requestAnimationFrame\(inputFrameLoop\);/);
  // utrata fokusu (B12)
  assert.match(html, /window\.addEventListener\('blur', releaseAllInput\);/);
  assert.match(html, /visibilitychange', \(\) => \{ if \(document\.hidden\) releaseAllInput\(\); \}\);/);
});
