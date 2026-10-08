import test from 'node:test';
import assert from 'node:assert/strict';

// Konteksty wejścia (src/input/inputContext.js) i warstwa wejścia (src/input/input.js) — docs/PLAN-pad.md
// § 3.1 p. 4, etap 1: kto dostaje przyciski pada, zjadanie wciśnięcia przy zmianie kontekstu, koniec przecieku
// pada pod menu, pauzą i scenami (B6).
const { INPUT_CTX, INPUT_CTX_ORDER, resolveInputContext, createInputContext } = await import('../src/input/inputContext.js');
const { createPadDevice, PB } = await import('../src/input/padDevice.js');
const { createInput, PAD_MANUAL_FLIGHT_MS } = await import('../src/input/input.js');

function fakePad() {
  const st = { values: new Array(17).fill(0), axes: [0, 0, 0, 0], on: true };
  return {
    st,
    read: () => [st.on ? {
      id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', mapping: 'standard', index: 0, connected: true,
      axes: st.axes.slice(), buttons: st.values.map((v) => ({ pressed: v >= 0.5, value: v }))
    } : null, null, null, null],
    press(b) { st.values[b] = 1; },
    release(b) { st.values[b] = 0; },
    axis(a, v) { st.axes[a] = v; }
  };
}

const GAME = { started: true };

test('stos kontekstów: menu > podzielony ekran > fabuła > pauza > stacja > CIC > gra', () => {
  assert.deepEqual([...INPUT_CTX_ORDER], ['menu', 'split', 'story', 'pause', 'station', 'cic', 'game']);
  const all = { menu: true, split: true, started: true, story: true, paused: true, station: true, cic: true };
  const order = [];
  const f = { ...all };
  for (const k of ['menu', 'split', 'story', 'paused', 'station', 'cic']) {
    order.push(resolveInputContext(f));
    f[k] = false;
  }
  order.push(resolveInputContext(f));
  assert.deepEqual(order, ['menu', 'split', 'story', 'pause', 'station', 'cic', 'game']);
  assert.equal(resolveInputContext({}), INPUT_CTX.NONE, 'przed startem gry bez menu (ładowanie, intro) — nic');
  assert.equal(resolveInputContext({ menu: true }), INPUT_CTX.MENU, 'menu przed startem gry');
  assert.equal(resolveInputContext(null), INPUT_CTX.NONE);
});

test('zjadanie: przycisk trzymany przy zmianie kontekstu jest zjedzony do puszczenia', () => {
  const pad = fakePad();
  const dev = createPadDevice({ read: pad.read });
  const ctx = createInputContext();
  dev.update(0); ctx.update({ menu: true }, dev);
  pad.press(PB.B);
  dev.update(16); ctx.update({ menu: true }, dev);
  assert.equal(ctx.isEaten(0, PB.B), false, 'w menu B działa');
  // B zamknęło menu — następna klatka to gra, B dalej trzymane
  dev.update(32); assert.equal(ctx.update(GAME, dev), 'game');
  assert.equal(ctx.changed, true);
  assert.equal(ctx.isEaten(0, PB.B), true);
  dev.update(48); ctx.update(GAME, dev);
  assert.equal(ctx.isEaten(0, PB.B), true, 'dalej zjedzony, dopóki trzymany');
  pad.release(PB.B);
  dev.update(64); ctx.update(GAME, dev);
  assert.equal(ctx.isEaten(0, PB.B), false, 'puszczony — zwolniony');
});

test('B zamykające menu nie odpala w grze rakiety (dawnej ścieżki pada), dopóki nie zostanie wciśnięte znowu', () => {
  const pad = fakePad();
  const input = createInput({ read: pad.read });
  let t = 0;
  const frame = (flags) => { t += 16; input.update(t, flags); input.setPlayerPads(input.device.active, -1); };
  frame({ menu: true });
  pad.press(PB.B);
  frame({ menu: true });
  assert.equal(input.ctx, 'menu');
  assert.equal(input.padPressed('ui.back'), true);
  assert.equal(input.padHeld('wpn.rocket'), false, 'rakieta nie w menu (B6)');
  frame(GAME);
  assert.equal(input.ctx, 'game');
  assert.equal(input.padHeld('wpn.rocket'), false, 'B zjedzone');
  pad.release(PB.B); frame(GAME);
  pad.press(PB.B); frame(GAME);
  assert.equal(input.padHeld('wpn.rocket'), true, 'nowe wciśnięcie działa');
});

test('pad pod menu, pauzą i sceną nie strzela, nie skacze i nie leci (B6)', () => {
  const pad = fakePad();
  const input = createInput({ read: pad.read });
  let t = 0;
  const frame = (flags) => { t += 16; input.update(t, flags); input.setPlayerPads(input.device.active, -1); };
  frame(GAME);
  for (const flags of [{ started: true, menu: true }, { started: true, paused: true }, { started: true, story: true }]) {
    pad.release(PB.Y); pad.release(PB.RT); pad.axis(1, 0);
    frame(flags);
    pad.press(PB.Y); pad.press(PB.RT); pad.axis(1, -1);
    frame(flags);
    assert.equal(input.padPressed('nav.warp'), false, `${input.ctx}: Y`);
    assert.equal(input.padHeld('wpn.fire'), false, `${input.ctx}: RT`);
    assert.equal(input.padAxis('fly.thrust'), 0, `${input.ctx}: lot`);
    assert.equal(input.padFlightActive(0), false, `${input.ctx}: lot`);
  }
  // Menu działa w pauzie i w scenie (otwiera menu jak Esc)
  pad.release(PB.MENU); frame({ started: true, paused: true });
  pad.press(PB.MENU); frame({ started: true, paused: true });
  assert.equal(input.padPressed('ui.menu'), true);
});

test('gałki nie są zjadane; nad CIC gałka nie leci (jak W / A / S / D — przesuw mapy, etap 4b)', () => {
  const pad = fakePad();
  const input = createInput({ read: pad.read });
  let t = 0;
  const frame = (flags) => { t += 16; input.update(t, flags); input.setPlayerPads(input.device.active, -1); };
  frame(GAME);
  pad.axis(1, -1);
  frame(GAME);
  assert.ok(input.padAxis('fly.thrust') > 0.99);
  frame({ started: true, cic: true });
  assert.equal(input.ctx, 'cic');
  assert.equal(input.padAxis('fly.thrust'), 0);
  assert.equal(input.padHeld('wpn.fire'), false);
  frame(GAME);
  assert.ok(input.padAxis('fly.thrust') > 0.99, 'po zamknięciu CIC lot od razu — gałka nie jest zjadana');
});

test('fabuła na padzie: A (dalej / ODDOKUJ) w scenie i w grze, B przytrzymanie 0,6 s — pomiń (B7)', () => {
  const pad = fakePad();
  const input = createInput({ read: pad.read });
  let t = 0;
  const frame = (flags) => { t += 16; input.update(t, flags); input.setPlayerPads(input.device.active, -1); };
  const STORY = { started: true, story: true };
  frame(STORY);
  pad.press(PB.A); frame(STORY);
  assert.equal(input.padPressed('story.confirm'), true);
  pad.release(PB.A); frame(STORY);
  pad.press(PB.B);
  let skips = 0;
  let pressedSkip = 0;
  for (let i = 0; i < 60; i++) {
    frame(STORY);
    if (input.padHoldCrossed('story.skip')) skips++;
    if (input.padPressed('story.skip')) pressedSkip++;
  }
  assert.equal(skips, 1, 'pominięcie raz, po 0,6 s');
  assert.equal(pressedSkip, 0, 'stuknięcie B nie pomija');
  // panel ODDOKUJ bez blokady fabuły — nakładka w grze: A działa w kontekście gry
  pad.release(PB.B); frame(GAME);
  pad.press(PB.A); frame(GAME);
  assert.equal(input.padPressed('story.action'), true);
  assert.equal(input.padPressed('story.confirm'), false, 'dalej w scenie — tylko w kontekście fabuły');
});

test('strażnik klatki: drugie update z tym samym znacznikiem rAF nic nie robi', () => {
  const pad = fakePad();
  let reads = 0;
  const input = createInput({ read: () => { reads++; return pad.read(); } });
  assert.equal(input.update(100, GAME), true);
  assert.equal(input.update(100, GAME), false);
  assert.equal(input.update(116, GAME), true);
  assert.equal(reads, 2, 'urządzenia czytane raz na klatkę');
  assert.equal(input.dtMs, 16);
});

test('klawiatura: osie jak dawne W/S i A/D, scalanie z gałką — większy moduł', () => {
  const pad = fakePad();
  const input = createInput({ read: pad.read });
  input.update(0, GAME); input.setPlayerPads(input.device.active, -1);
  assert.equal(input.keyAxis('fly.thrust'), 0);
  input.keyDown('KeyW');
  assert.equal(input.keyAxis('fly.thrust'), 1);
  input.keyDown('KeyS');
  assert.equal(input.keyAxis('fly.thrust'), 0, 'W + S = 0 (jak dawniej)');
  input.keyUp('KeyW');
  assert.equal(input.keyAxis('fly.thrust'), -1);
  input.keyDown('KeyA'); input.keyDown('KeyD');
  assert.equal(input.keyAxis('fly.turn'), 0);
  input.keyUp('KeyA');
  assert.equal(input.keyAxis('fly.turn'), 1);
  input.keyUp('KeyS'); input.keyUp('KeyD');
  pad.axis(1, -0.6);
  input.update(16, GAME); input.setPlayerPads(input.device.active, -1);
  const p = input.axis('fly.thrust');
  assert.ok(p > 0 && p < 0.6, 'sama gałka — analogowo (krzywa ciągu)');
  input.keyDown('KeyS');
  assert.equal(input.axis('fly.thrust'), -1, 'S wygrywa z częściowym wychyleniem (większy moduł)');
  assert.equal(input.axis('fly.thrust', 0, false), p, 'klawiatura nie należy do gracza — sama gałka');
});

test('przejęcie sterów od autopilota: klawisze od razu, gałka po 0,1 s poza strefą (B4)', () => {
  const pad = fakePad();
  const input = createInput({ read: pad.read });
  let t = 0;
  const frame = () => { t += 16; input.update(t, GAME); input.setPlayerPads(input.device.active, -1); };
  frame();
  assert.equal(input.manualFlight(), false);
  input.keyDown('KeyQ');
  assert.equal(input.manualFlight(), true);
  assert.equal(input.manualFlight(false), false, 'klawiatura innego gracza się nie liczy');
  input.keyUp('KeyQ');
  pad.axis(0, 0.08);   // dryf w strefie
  for (let i = 0; i < 20; i++) frame();
  assert.equal(input.manualFlight(), false, 'dryf gałki nie zdejmuje rozkazu');
  pad.axis(0, 0.7);
  frame();
  assert.equal(input.manualFlight(), false);
  const start = t;
  while (t - start < PAD_MANUAL_FLIGHT_MS) frame();
  assert.equal(input.manualFlight(), true);
});

test('utrata fokusu: klawisze puszczone, trzymane przyciski pada zjedzone (B12)', () => {
  const pad = fakePad();
  const input = createInput({ read: pad.read });
  input.update(0, GAME); input.setPlayerPads(input.device.active, -1);
  pad.press(PB.RT);
  input.update(16, GAME);
  input.keyDown('KeyW');
  assert.equal(input.padHeld('wpn.fire'), true);
  assert.deepEqual(input.heldKeys(), ['KeyW']);
  input.clear();
  assert.deepEqual(input.heldKeys(), []);
  input.update(32, GAME);
  assert.equal(input.padHeld('wpn.fire'), false, 'RT trzymany przy Alt+Tab nie strzela po powrocie');
  pad.release(PB.RT); input.update(48, GAME);
  pad.press(PB.RT); input.update(64, GAME);
  assert.equal(input.padHeld('wpn.fire'), true);
});
