import test from 'node:test';
import assert from 'node:assert/strict';

// Warstwa urządzeń pada (src/input/padDevice.js, docs/PLAN-pad.md § 4, etap 1): martwe strefy promieniowe,
// krzywe, spusty z histerezą, zbocza, stuknięcie / przytrzymanie / podwójne, rodzina, podłączenie, aktywny pad.
const {
  PB, PAD_FAMILY, PAD_TUNE, PAD_BUTTONS, padFamilyFromId, radialDeadzone, axisCurve, createPadDevice
} = await import('../src/input/padDevice.js');

// Atrapa getGamepads: sloty z { id, mapping, buttons: number[17], axes: number[4] } (wartości przycisków 0..1).
function fakePads() {
  const slots = [null, null, null, null];
  const api = {
    slots,
    connect(i, o = {}) {
      slots[i] = {
        id: o.id ?? 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', mapping: o.mapping ?? 'standard', index: i, connected: true,
        values: new Array(17).fill(0), axes: [0, 0, 0, 0], pressedOverride: null
      };
      return api;
    },
    disconnect(i) { slots[i] = null; return api; },
    set(i, b, v) { slots[i].values[b] = v; return api; },
    axis(i, a, v) { slots[i].axes[a] = v; return api; },
    // migawka jak w Chrome: obiekty { pressed, value }
    read() {
      return slots.map((p) => p && {
        id: p.id, mapping: p.mapping, index: p.index, connected: true, axes: p.axes.slice(),
        buttons: p.values.map((v, b) => ({ pressed: p.pressedOverride?.[b] ?? v >= 0.5, value: v }))
      });
    }
  };
  return api;
}

const idx = (slot, b) => slot * PAD_BUTTONS + b;

test('martwa strefa promieniowa: zero w środku, ciągłość na brzegu, pełne wychylenie przy strefie zewnętrznej', () => {
  const out = [0, 0];
  assert.equal(radialDeadzone(0.1, 0, 0.12, 0.95, 1, out), 0);
  assert.deepEqual(out, [0, 0]);
  // przy brzegu strefy wewnętrznej wartość rośnie od zera (bez skoku do 0,12 jak przy strefie bez przeskalowania)
  const m1 = radialDeadzone(0.125, 0, 0.12, 0.95, 1, out);
  assert.ok(m1 > 0 && m1 < 0.01, `tuż za strefą ≈ 0, jest ${m1}`);
  assert.equal(radialDeadzone(0.95, 0, 0.12, 0.95, 1, out), 1);
  assert.equal(radialDeadzone(1, 0, 0.12, 0.95, 1, out), 1);
  // kierunek bez zmian, moduł po przeskalowaniu
  const m = radialDeadzone(0.5, -0.5, 0.12, 0.95, 1, out);
  assert.ok(Math.abs(out[0] + out[1]) < 1e-12, 'przekątna zostaje przekątną');
  assert.ok(Math.abs(Math.hypot(out[0], out[1]) - m) < 1e-12);
  // krzywa działa na module
  const lin = radialDeadzone(0.6, 0, 0.12, 0.95, 1, out);
  const cur = radialDeadzone(0.6, 0, 0.12, 0.95, 2, out);
  assert.ok(Math.abs(cur - lin * lin) < 1e-12);
  // strefa promieniowa, nie na osiach: przekątna (0,1; 0,1) mieści się w 0,12 → zero
  assert.equal(radialDeadzone(0.08, 0.08, 0.12, 0.95, 1, out), 0);
});

test('krzywa osi zachowuje znak i daje precyzję przy małym wychyleniu', () => {
  assert.equal(axisCurve(0, 1.6), 0);
  assert.equal(axisCurve(1, 1.6), 1);
  assert.equal(axisCurve(-1, 1.6), -1);
  assert.ok(axisCurve(0.3, 1.6) < 0.3 && axisCurve(0.3, 1.6) > 0);
  assert.equal(axisCurve(-0.5, 1), -0.5);
  assert.ok(Math.abs(axisCurve(-0.5, 2) + 0.25) < 1e-12);
});

test('rodzina pada z id (Chrome / Edge na Windows)', () => {
  assert.equal(padFamilyFromId('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), PAD_FAMILY.XBOX);
  assert.equal(padFamilyFromId('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), PAD_FAMILY.XBOX);
  assert.equal(padFamilyFromId('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), PAD_FAMILY.PLAYSTATION);
  assert.equal(padFamilyFromId('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)'), PAD_FAMILY.PLAYSTATION);
  assert.equal(padFamilyFromId('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'), PAD_FAMILY.NINTENDO);
  assert.equal(padFamilyFromId('Generic USB Joystick (Vendor: 0079 Product: 0006)'), PAD_FAMILY.GENERIC);
  assert.equal(padFamilyFromId(''), PAD_FAMILY.GENERIC);
});

test('podłączenie i odłączenie: zbocza, rodzina, mapowanie; pierwszy pad aktywny', () => {
  const pads = fakePads();
  const dev = createPadDevice({ read: () => pads.read() });
  dev.update(0);
  assert.equal(dev.active, -1);
  pads.connect(2, { id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)' });
  dev.update(16);
  assert.equal(dev.connectedNow[2], 1);
  assert.equal(dev.connected[2], 1);
  assert.equal(dev.family[2], PAD_FAMILY.PLAYSTATION);
  assert.equal(dev.standard[2], 1);
  assert.equal(dev.active, 2, 'pad pod indeksem 2 działa (B10 — nie pads[0])');
  dev.update(32);
  assert.equal(dev.connectedNow[2], 0, 'zbocze tylko w klatce podłączenia');
  pads.connect(0, { id: 'Some HID pad', mapping: '' });
  dev.update(48);
  assert.equal(dev.standard[0], 0, 'bez mapowania standard — flaga dla komunikatu');
  pads.disconnect(2);
  dev.update(64);
  assert.equal(dev.disconnectedNow[2], 1);
  assert.equal(dev.connected[2], 0);
  assert.equal(dev.active, 0, 'po odłączeniu aktywnego — inny podłączony');
});

test('zbocza: jedno wciśnięcie = jedno zbocze, trzymanie bez powtórzeń, puszczenie raz', () => {
  const pads = fakePads().connect(0);
  const dev = createPadDevice({ read: () => pads.read() });
  dev.update(0);
  pads.set(0, PB.Y, 1);
  dev.update(16);
  assert.equal(dev.pressed[idx(0, PB.Y)], 1);
  assert.ok(dev.isDown(0, PB.Y));
  let edges = 0;
  for (let t = 32; t <= 1000; t += 16) { dev.update(t); edges += dev.pressed[idx(0, PB.Y)]; }
  assert.equal(edges, 0, 'trzymany Y nie daje kolejnych zboczy (B1)');
  pads.set(0, PB.Y, 0);
  dev.update(1016);
  assert.equal(dev.released[idx(0, PB.Y)], 1);
  dev.update(1032);
  assert.equal(dev.released[idx(0, PB.Y)], 0);
});

test('spusty z histerezą (wartość, nie `pressed` przeglądarki)', () => {
  const pads = fakePads().connect(0);
  const dev = createPadDevice({ read: () => pads.read() });
  dev.update(0);
  const rt = idx(0, PB.RT);
  pads.slots[0].pressedOverride = { [PB.RT]: true };   // przeglądarka mówi „wciśnięty” już przy małej wartości
  pads.set(0, PB.RT, 0.2);
  dev.update(16);
  assert.equal(dev.down[rt], 0, '0,2 < próg wciśnięcia');
  pads.set(0, PB.RT, PAD_TUNE.triggerOn + 0.05);
  dev.update(32);
  assert.equal(dev.down[rt], 1);
  assert.equal(dev.pressed[rt], 1);
  pads.set(0, PB.RT, 0.3);   // między progami — zostaje wciśnięty
  dev.update(48);
  assert.equal(dev.down[rt], 1);
  assert.equal(dev.released[rt], 0);
  pads.set(0, PB.RT, PAD_TUNE.triggerOff - 0.05);
  dev.update(64);
  assert.equal(dev.down[rt], 0);
  assert.equal(dev.released[rt], 1);
  pads.set(0, PB.RT, 0.3);   // między progami z dołu — nie wciska
  dev.update(80);
  assert.equal(dev.down[rt], 0);
});

test('stuknięcie, przytrzymanie, podwójne i własny próg przytrzymania (czas rzeczywisty)', () => {
  const pads = fakePads().connect(0);
  const dev = createPadDevice({ read: () => pads.read() });
  const a = idx(0, PB.A);
  dev.update(0);
  // stuknięcie
  pads.set(0, PB.A, 1); dev.update(100);
  pads.set(0, PB.A, 0); dev.update(200);
  assert.equal(dev.tapped[a], 1);
  assert.equal(dev.doubled[a], 0);
  // drugie stuknięcie w 300 ms od pierwszego — podwójne
  pads.set(0, PB.A, 1); dev.update(380);
  pads.set(0, PB.A, 0); dev.update(450);
  assert.equal(dev.tapped[a], 1);
  assert.equal(dev.doubled[a], 1);
  // przytrzymanie: początek dokładnie raz, po przekroczeniu tapMs; puszczenie bez stuknięcia
  pads.set(0, PB.A, 1); dev.update(1000);
  let holds = 0;
  for (let t = 1016; t <= 1600; t += 16) { dev.update(t); holds += dev.holdStart[a]; }
  assert.equal(holds, 1);
  assert.ok(dev.holdTime(0, PB.A) >= 590);
  pads.set(0, PB.A, 0); dev.update(1616);
  assert.equal(dev.tapped[a], 0, 'długie trzymanie to nie stuknięcie');
  // własny próg (B trzymane 0,6 s — pomiń scenę): crossed raz, w klatce przekroczenia
  pads.set(0, PB.B, 1); dev.update(2000);
  const hits = [];
  for (let t = 2016; t <= 2800; t += 16) { dev.update(t); if (dev.crossed(0, PB.B, 600)) hits.push(t); }
  assert.deepEqual(hits, [2608]);
});

test('przycisk trzymany przy podłączeniu (ten, który „pokazał” pad) nie daje zbocza, stuknięcia ani przytrzymania', () => {
  const pads = fakePads();
  const dev = createPadDevice({ read: () => pads.read() });
  dev.update(0);
  pads.connect(0).set(0, PB.A, 1);
  dev.update(16);
  assert.equal(dev.pressed[idx(0, PB.A)], 0);
  assert.ok(dev.isDown(0, PB.A));
  let holds = 0;
  for (let t = 32; t <= 1000; t += 16) { dev.update(t); holds += dev.holdStart[idx(0, PB.A)] + (dev.crossed(0, PB.A, 600) ? 1 : 0); }
  assert.equal(holds, 0);
  pads.set(0, PB.A, 0);
  dev.update(1016);
  assert.equal(dev.released[idx(0, PB.A)], 1);
  assert.equal(dev.tapped[idx(0, PB.A)], 0);
});

test('aktywny pad: przejmuje go aktywność (zbocza), nie stałe wychylenie urządzenia-widma', () => {
  const pads = fakePads();
  const dev = createPadDevice({ read: () => pads.read() });
  pads.connect(0);
  dev.update(0);
  assert.equal(dev.active, 0);
  // widmo pod indeksem 1 ze stałą osią 1,0 od podłączenia
  pads.connect(1, { id: 'Headset HID (Vendor: 1234 Product: 0001)', mapping: '' }).axis(1, 0, 1).axis(1, 1, 1);
  for (let t = 16; t < 400; t += 16) dev.update(t);
  assert.equal(dev.active, 0, 'widmo nie przejmuje');
  // przycisk na padzie 1 — przejmuje
  pads.set(1, PB.X, 1);
  dev.update(400);
  assert.equal(dev.active, 1);
  // wychylenie gałki padu 0 przez próg aktywności — wraca
  pads.axis(0, 1, -0.9);
  dev.update(416);
  assert.equal(dev.active, 0);
});

test('gałki: lewa i prawa po strefie; czas wychylenia lewej (przejęcie od autopilota)', () => {
  const pads = fakePads().connect(0);
  const dev = createPadDevice({ read: () => pads.read() });
  dev.update(0);
  pads.axis(0, 0, 0.05).axis(0, 1, -0.05);   // dryf w strefie
  dev.update(16);
  assert.equal(dev.axis(0, 0), 0);
  assert.equal(dev.stickActiveMs(0), 0);
  pads.axis(0, 1, -1);
  dev.update(32);
  assert.ok(dev.axis(0, 1) < -0.99);
  dev.update(132);
  assert.equal(dev.stickActiveMs(0), 100);
  pads.axis(0, 2, 0.5).axis(0, 3, 0);
  dev.update(148);
  assert.ok(dev.axis(0, 2) > 0.4 && dev.axis(0, 2) < 0.5, 'prawa gałka po strefie 0,10 i przeskalowaniu');
  // przejście surowej osi przez próg (menu: LS ↕ jako strzałki)
  pads.axis(0, 1, 0.6);
  dev.update(164);
  assert.equal(dev.rawCrossed(0, 1, 0.5), true);
  dev.update(180);
  assert.equal(dev.rawCrossed(0, 1, 0.5), false);
});

test('clear (utrata fokusu): stan od zera, bez zboczy', () => {
  const pads = fakePads().connect(0);
  const dev = createPadDevice({ read: () => pads.read() });
  dev.update(0);
  pads.set(0, PB.RT, 1).axis(0, 0, 1);
  dev.update(16);
  dev.clear();
  assert.equal(dev.isDown(0, PB.RT), false);
  assert.equal(dev.axis(0, 0), 0);
  assert.equal(dev.pressed.reduce((s, v) => s + v, 0), 0);
});

test('tabela padów bez mapowania standard: przyciski i osie z mapy', () => {
  const pads = fakePads().connect(0, { id: 'Weird Pad (Vendor: dead Product: beef)', mapping: '' });
  const remaps = [{ test: /dead/, buttons: [1, 0], axes: [1, 0, 2, 3] }];
  const dev = createPadDevice({ read: () => pads.read(), remaps });
  dev.update(0);
  pads.set(0, 1, 1).axis(0, 0, 0.9);
  dev.update(16);
  assert.ok(dev.isDown(0, PB.A), 'fizyczny przycisk 1 = A');
  assert.ok(dev.axis(0, 1) > 0.8, 'fizyczna oś 0 = LS ↕');
});

test('bez alokacji w update: te same tablice, odczyt wstrzyknięty', () => {
  const pads = fakePads().connect(0);
  const snap = pads.read();
  let reads = 0;
  const dev = createPadDevice({ read: () => { reads++; return snap; } });
  const refs = [dev.down, dev.pressed, dev.stick, dev.heldMs, dev.raw];
  for (let t = 0; t < 2000; t += 16) dev.update(t);
  assert.equal(reads, 125, 'jeden odczyt na update');
  assert.deepEqual([dev.down, dev.pressed, dev.stick, dev.heldMs, dev.raw], refs);
});
