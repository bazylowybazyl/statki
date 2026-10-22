import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Koło trybów okrętu pod ŚPM — rysunek i animacje (src/ui/shipModeWheel.js, 2026-10-12).
const {
  MODE_WHEEL_TIME, MODE_WHEEL_ICONS, SHIP_MODE_COLORS, createModeWheelFx, stepModeWheelFx, noteModeWheelClose,
  modeWheelVisible, drawModeWheel, buildShipModeWheelItems, shipModeHint, stripModePrefix, modeWheelExtent,
  modeWheelScale, drawModeWheelIcon
} = await import('../src/ui/shipModeWheel.js');
const { SHIP_MODE_IDS, SHIP_STANCE_TUNE } = await import('../src/game/shipModes.js');

const N = SHIP_MODE_IDS.length;
const STEP = (Math.PI * 2) / N;
const sectorAngle = (i) => -Math.PI / 2 + i * STEP;

// Atrapa kontekstu 2D: przyjmuje każde wywołanie, zapisuje napisy, liczby niebędące liczbami i liczbę
// wywołań każdej metody (ops).
function fakeCtx() {
  const log = { text: [], nan: [], calls: 0, alphaNaN: 0, ops: {} };
  const state = {
    log, globalAlpha: 1, globalCompositeOperation: 'source-over', font: '', lineWidth: 1, strokeStyle: '', fillStyle: '',
    shadowBlur: 0, shadowColor: '', textAlign: '', textBaseline: '', lineCap: '', lineJoin: '', letterSpacing: '0px',
    measureText: (t) => ({ width: String(t).length * 7 }),
    createRadialGradient: (...a) => {
      if (a.some((v) => !Number.isFinite(v))) log.nan.push('createRadialGradient');
      return { addColorStop() {} };
    },
    fillText: (t, x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) log.nan.push(`fillText ${t}`);
      log.text.push(String(t));
    }
  };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => {
        log.calls++;
        log.ops[k] = (log.ops[k] || 0) + 1;
        if (args.some((v) => typeof v === 'number' && !Number.isFinite(v))) log.nan.push(String(k));
      };
    },
    set(t, k, v) {
      if (k === 'globalAlpha' && !Number.isFinite(v)) log.alphaNaN++;
      t[k] = v;
      return true;
    }
  });
}

function view(items, current, px = 0, py = 0) {
  return { x: 800, y: 400, scale: 1, W: 1600, H: 900, items, current, px, py, deadzone: 34 };
}

// Przebieg: kroki 1/120 s od `from` do `to`, stały stan wejścia.
function run(fx, open, hover, current, from, to) {
  for (let t = from; t <= to + 1e-9; t += 1 / 120) stepModeWheelFx(fx, open, hover, current, t);
}

test('koło: pozycje dla każdego trybu — ikona, barwa, opis; tryby z klawiszem mają [klawisz]', () => {
  const items = buildShipModeWheelItems();
  assert.deepEqual(items.map((it) => it.id), [...SHIP_MODE_IDS]);
  for (const it of items) {
    assert.equal(typeof MODE_WHEEL_ICONS[it.icon], 'function', `ikona ${it.id}`);
    assert.match(SHIP_MODE_COLORS[it.id], /^#[0-9a-f]{6}$/i, `barwa ${it.id}`);
    assert.ok(it.gain.length > 0, `opis ${it.id}`);
    assert.equal(it.avail, true);
  }
  assert.equal(items.find((it) => it.id === 'cloak').key, '[I]');
  assert.equal(items.find((it) => it.id === 'combat').key, '');
});

test('opisy postaw idą za nastawami (TARCZE), HIPERCRUISE z tabeli napędów', () => {
  const sh = shipModeHint('shield');
  const t = SHIP_STANCE_TUNE.shield;
  const fmt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
  assert.ok(sh.gain.includes(`×${fmt(t.shieldRegen)}`) && sh.gain.includes(`×${fmt(t.shieldTaken)}`), sh.gain);
  assert.ok(sh.cost.includes(`×${fmt(t.speed)}`) && sh.cost.includes(`×${fmt(t.turnRate)}`), sh.cost);
  assert.equal(sh.costKind, 'cost');
  const hc = shipModeHint('hypercruise');
  assert.ok(hc.cost.includes('Broń zimna'), hc.cost);
  assert.ok(hc.gain.includes('20 tys.'), hc.gain);
  assert.equal(shipModeHint('torpedo').costKind, 'keys');
});

test('powód odmowy bez nazwy trybu (nazwa jest w piaście)', () => {
  assert.equal(stripModePrefix('TORPEDY: brak wyrzutni torped', 'TORPEDY'), 'Brak wyrzutni torped');
  assert.equal(stripModePrefix('MASKOWANIE: PRZEŁADOWANIE', 'MASKOWANIE'), 'PRZEŁADOWANIE');
  assert.equal(stripModePrefix('RTS MODE niedostepny w split-screen', 'FLOTA'), 'RTS MODE niedostepny w split-screen');
  assert.equal(stripModePrefix('', 'FLOTA'), '');
});

test('otwarcie i wskazanie: sektor wysuwa się, podświetlenie dojeżdża do sektora, piasta pokazuje wskazany tryb', () => {
  const fx = createModeWheelFx(N);
  assert.equal(modeWheelVisible(fx, 0), false);
  run(fx, true, -1, 0, 0, 0.4);
  assert.equal(modeWheelVisible(fx, 0.4), true);
  assert.equal(fx.hubIdx, 0, 'bez wskazania piasta pokazuje aktywny tryb');
  assert.equal(fx.hubHover, false);
  run(fx, true, 2, 0, 0.41, 0.9);
  assert.ok(fx.h[2] > 0.99, `wysunięcie ${fx.h[2]}`);
  assert.ok(fx.h[0] < 0.01);
  assert.ok(Math.abs(fx.hl - sectorAngle(2)) < 1e-3, `kąt podświetlenia ${fx.hl}`);
  assert.ok(fx.hlA > 0.99);
  assert.equal(fx.hubIdx, 2);
  assert.equal(fx.hubHover, true);
});

test('podświetlenie jedzie najkrótszą drogą przez górę koła (sektor ostatni → pierwszy)', () => {
  const fx = createModeWheelFx(N);
  run(fx, true, N - 1, 0, 0, 0.5);
  const start = fx.hl;
  let min = Infinity, max = -Infinity;
  for (let t = 0.5 + 1 / 120; t <= 1.2; t += 1 / 120) {
    stepModeWheelFx(fx, true, 0, 0, t);
    min = Math.min(min, fx.hl);
    max = Math.max(max, fx.hl);
  }
  // Ostatni sektor leży o jeden krok PRZED górą (zgodnie z zegarem), więc kąt rośnie o jeden krok,
  // a nie cofa się przez sześć sektorów.
  assert.ok(Math.abs(fx.hl - (start + STEP)) < 1e-3, `koniec ${fx.hl} vs ${start + STEP}`);
  assert.ok(min >= start - 1e-6 && max <= start + STEP * 1.15, `zakres ${min}…${max}`);
});

test('wybór: zamykanie z błyskiem, potem echo; po wszystkim nic nie rysuje', () => {
  const fx = createModeWheelFx(N);
  run(fx, true, 1, 0, 0, 0.5);
  noteModeWheelClose(fx, 'select', 1, 0.5);
  assert.equal(fx.open, false);
  assert.equal(fx.closeKind, 'select');
  assert.equal(fx.echoIdx, 1);
  run(fx, false, -1, 1, 0.5, 0.6);
  assert.equal(fx.closeKind, 'select', 'zamknięcie zgłoszone — krok nie zamienia go na anulowanie');
  assert.equal(modeWheelVisible(fx, 0.6), true);
  assert.equal(modeWheelVisible(fx, 0.5 + MODE_WHEEL_TIME.echo + 0.01), false);
});

test('stuknięcie: echo poprzedniego trybu, także gdy koła nie było jeszcze w żadnej klatce', () => {
  const fx = createModeWheelFx(N);
  run(fx, true, -1, 2, 0, 0.1);
  noteModeWheelClose(fx, 'tap', 0, 0.1);
  assert.equal(fx.closeKind, 'tap');
  assert.equal(fx.echoIdx, 0);
  const fx2 = createModeWheelFx(N);
  noteModeWheelClose(fx2, 'tap', 3, 5);
  assert.equal(fx2.closeKind, '', 'bez koła nie ma czego zwijać');
  assert.equal(fx2.echoIdx, 3);
  assert.equal(modeWheelVisible(fx2, 5.2), true);
});

test('odmowa i anulowanie bez echa; zamknięcie bez zgłoszenia (utrata fokusu) = anulowanie', () => {
  const fx = createModeWheelFx(N);
  run(fx, true, 4, 0, 0, 0.5);
  noteModeWheelClose(fx, 'deny', 4, 0.5);
  assert.equal(fx.closeKind, 'deny');
  assert.equal(fx.echoIdx, -1);
  assert.equal(modeWheelVisible(fx, 0.5 + MODE_WHEEL_TIME.deny + 0.01), false);

  const fx2 = createModeWheelFx(N);
  run(fx2, true, -1, 0, 0, 0.5);
  run(fx2, false, -1, 0, 0.51, 0.55);
  assert.equal(fx2.closeKind, 'cancel');
  assert.equal(fx2.echoIdx, -1);
});

test('ponowne otwarcie w trakcie echa zaczyna od nowa', () => {
  const fx = createModeWheelFx(N);
  run(fx, true, 1, 0, 0, 0.5);
  noteModeWheelClose(fx, 'select', 1, 0.5);
  run(fx, false, -1, 1, 0.5, 0.6);
  run(fx, true, -1, 1, 0.61, 0.62);
  assert.equal(fx.open, true);
  assert.equal(fx.closeKind, '');
  assert.equal(fx.echoIdx, -1);
  assert.equal(fx.h[1], 0, 'wysunięcia od zera');
});

test('rysunek: każda faza bez NaN, napisy sektorów, opis wskazanego trybu, powód odmowy i echo', () => {
  const items = buildShipModeWheelItems();
  const torp = items.find((it) => it.id === 'torpedo');
  torp.avail = false;
  torp.reason = 'TORPEDY: brak wyrzutni torped — zamontuj je u mechanika';
  const fx = createModeWheelFx(N);
  assert.equal(drawModeWheel(fakeCtx(), fx, view(items, 0), 0), false, 'zamknięte koło nic nie rysuje');

  const frames = [];
  const ptr = (i) => [Math.cos(sectorAngle(i)) * 90, Math.sin(sectorAngle(i)) * 90];
  const shot = (t, px = 0, py = 0) => {
    const ctx = fakeCtx();
    const drew = drawModeWheel(ctx, fx, view(items, 0, px, py), t);
    frames.push({ t, drew, log: ctx.log });
    return ctx.log;
  };
  for (let t = 0; t <= 0.3; t += 1 / 60) { stepModeWheelFx(fx, true, -1, 0, t); shot(t); }
  run(fx, true, 1, 0, 0.31, 0.8);
  const hover = shot(0.8, ...ptr(1));
  for (const it of items) assert.ok(hover.text.includes(it.label), `napis ${it.label}`);
  assert.ok(hover.text.includes('[I]'));
  assert.ok(hover.text.includes(items[1].gain), 'opis TARCZ pod kołem');
  assert.ok(hover.text.includes(items[1].cost));

  run(fx, true, 4, 0, 0.81, 1.2);
  const off = shot(1.2, ...ptr(4));
  assert.ok(off.text.some((s) => s.startsWith('Brak wyrzutni torped')), off.text.join('|'));
  assert.ok(!off.text.some((s) => s.startsWith('TORPEDY:')), 'bez powtórzonej nazwy trybu');

  noteModeWheelClose(fx, 'deny', 4, 1.2);
  for (let t = 1.2; t <= 1.2 + MODE_WHEEL_TIME.deny; t += 1 / 60) { stepModeWheelFx(fx, false, -1, 0, t); shot(t); }
  run(fx, true, 2, 0, 2, 2.5);
  noteModeWheelClose(fx, 'select', 2, 2.5);
  let echoSeen = false;
  for (let t = 2.5; t <= 2.5 + MODE_WHEEL_TIME.echo + 0.05; t += 1 / 60) {
    stepModeWheelFx(fx, false, -1, 2, t);
    const log = shot(t);
    if (log.text.includes(items[2].label)) echoSeen = true;
  }
  assert.ok(echoSeen, 'echo z nazwą wybranego trybu');
  assert.equal(frames[frames.length - 1].drew, false, 'po echu koniec');
  for (const f of frames) {
    assert.deepEqual(f.log.nan, [], `NaN w t=${f.t.toFixed(3)}`);
    assert.equal(f.log.alphaNaN, 0, `globalAlpha NaN w t=${f.t.toFixed(3)}`);
  }
});

test('koło w spoczynku z pamięci obrazów: wypiek raz, potem drawImage; zmiana dostępności = nowy wypiek', () => {
  const canvases = [];
  globalThis.document = {
    createElement: () => {
      const c = { width: 0, height: 0, ctx: fakeCtx() };
      c.getContext = () => c.ctx;
      canvases.push(c);
      return c;
    }
  };
  try {
    const items = buildShipModeWheelItems();
    const fx = createModeWheelFx(N);
    run(fx, true, -1, 0, 0, 1);
    const live = fakeCtx();
    // Przed rozłożeniem: na żywo (koło nie stoi).
    const fx2 = createModeWheelFx(N);
    run(fx2, true, -1, 0, 0, 0.1);
    drawModeWheel(live, fx2, view(items, 0), 0.1);
    assert.ok(!live.log.ops.drawImage, 'w trakcie otwierania bez obrazów z pamięci');

    const a = fakeCtx();
    drawModeWheel(a, fx, view(items, 0), 1);
    const built = canvases.length;
    assert.ok(built >= N + 1, `tarcza + ${N} sektorów: ${built}`);
    assert.ok(fx.spr.ok);
    assert.ok(a.log.ops.drawImage >= N + 1, `drawImage: ${a.log.ops.drawImage}`);
    assert.ok(!a.log.ops.fillText || a.log.ops.fillText <= 2, 'napisy sektorów w obrazach, na żywo tylko piasta / opis');
    for (const c of canvases) assert.deepEqual(c.ctx.log.nan, [], 'wypiek bez NaN');
    const sectorLabels = canvases.flatMap((c) => c.ctx.log.text);
    for (const it of items) assert.ok(sectorLabels.includes(it.label), `napis ${it.label} w obrazie sektora`);

    const b = fakeCtx();
    drawModeWheel(b, fx, view(items, 0), 1.01);
    assert.equal(canvases.length, built, 'druga klatka bez nowych płócien');
    assert.ok(b.log.calls < live.log.calls, `klatka z pamięci tańsza: ${b.log.calls} vs ${live.log.calls}`);

    // Wskazany sektor rysuje się na żywo, reszta dalej z pamięci.
    run(fx, true, 2, 0, 1.02, 1.4);
    const c = fakeCtx();
    drawModeWheel(c, fx, view(items, 0, 90 * Math.cos(sectorAngle(2)), 90 * Math.sin(sectorAngle(2))), 1.4);
    assert.ok(c.log.ops.drawImage >= N, 'sektory bez wskazania i tarcza z pamięci');
    assert.ok(c.log.text.includes(items[2].label), 'wskazany sektor na żywo');

    // Tryb przestaje być dostępny — wypiek od nowa.
    const mask0 = fx.spr.mask;
    items[4].avail = false;
    items[4].reason = 'TORPEDY: brak wyrzutni';
    drawModeWheel(fakeCtx(), fx, view(items, 0), 1.41);
    assert.notEqual(fx.spr.mask, mask0);
    assert.equal(fx.spr.mask & (1 << 4), 1 << 4);
  } finally {
    delete globalThis.document;
  }
});

test('ikony: każda rysuje się w spoczynku i ożywiona bez NaN', () => {
  for (const id of Object.keys(MODE_WHEEL_ICONS)) {
    for (const [a, t] of [[0, 0], [1, 0.37], [0.5, 12.3]]) {
      const ctx = fakeCtx();
      drawModeWheelIcon(ctx, id, 50, 50, 32, '#ffffff', a, t);
      assert.deepEqual(ctx.log.nan, [], `${id} a=${a}`);
      assert.ok(ctx.log.calls > 3, id);
    }
  }
});

test('rozmiar: skala jak kokpit (1080p = 1), koło z opisem mieści się w 720p', () => {
  assert.equal(modeWheelScale(1920, 1080), 1);
  assert.ok(modeWheelScale(1280, 720) < 1 && modeWheelScale(1280, 720) >= 0.72);
  assert.ok(modeWheelScale(3840, 2160) <= 1.4);
  const s = modeWheelScale(1280, 720);
  const ext = modeWheelExtent(s);
  assert.ok(ext.up + ext.down + 16 <= 720, `${ext.up} + ${ext.down}`);
});

test('index.html: koło rysuje moduł, puszczenie ŚPM zgłasza animacji wynik', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(html, /from "\.\/src\/ui\/shipModeWheel\.js"/);
  assert.match(html, /stepModeWheelFx\(shipModeWheelFx, w\.open, w\.hover, current, now\)/);
  assert.match(html, /drawModeWheel\(ctx, shipModeWheelFx, v, now\)/);
  assert.match(html, /noteModeWheelClose\(shipModeWheelFx, kind, SHIP_MODE_IDS\.indexOf\(id\), now\)/);
  assert.match(html, /'deny' : pointed >= 0 \? 'select' : 'tap'/);
  assert.doesNotMatch(html, /SHIP_MODE_WHEEL_R/, 'dawny rysunek koła usunięty');
});
