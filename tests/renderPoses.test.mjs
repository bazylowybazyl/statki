// Pozy renderu bytów między krokami fizyki (src/game/renderPoses.js, audyt renderu 2026-10-17): kadłuby NPC i wraki
// nie stoją 3–4 klatki przy fizyce 60 Hz i monitorze 240 Hz.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderPoses } from '../src/game/renderPoses.js';

const DT = 1 / 60;

// pętla jak w index.html: acc += klatka; kroki po DT; α = acc / DT; render
function run({ hz = 240, frames = 60, v = 600, w = 0.4, extraStep = null } = {}) {
  const rp = new RenderPoses();
  const e = { x: 0, y: 0, angle: 0 };
  let acc = 0, tick = 0;
  const out = [];
  for (let f = 0; f < frames; f++) {
    acc += 1 / hz;
    while (acc >= DT - 1e-12) { e.x += v * DT; e.angle += w * DT; tick++; acc -= DT; }
    if (extraStep && extraStep(f, e)) { /* ruch spoza kroku */ }
    const alpha = acc / DT;
    rp.frame([e], tick, alpha);
    out.push({ tick, alpha, pose: { ...rp.poseOf(e) }, x: e.x });
  }
  return out;
}

test('ruch jednostajny: 60 Hz fizyki, 240 Hz obrazu — poza renderu w czasie renderu, równe przyrosty', () => {
  const v = 600, out = run({ v });
  const first = out.findIndex((o) => o.tick >= 1);
  for (let i = first + 1; i < out.length; i++) {
    const { tick, alpha, pose } = out[i];
    const expected = v * DT * (tick - 1 + alpha);
    assert.ok(Math.abs(pose.x - expected) < 1e-9, `klatka ${i}: ${pose.x} ≠ ${expected}`);
    const step = pose.x - out[i - 1].pose.x;
    assert.ok(Math.abs(step - v / 240) < 1e-9, `klatka ${i}: przyrost ${step}`);
  }
  // bez interpolacji (poza z kroku) przyrosty to 0, 0, 0, 10 — tu każdy 2,5 j.
});

test('kilka kroków między klatkami (klatka 30 Hz): lerp przez całą drogę, ta sama poza co z jednym krokiem', () => {
  const v = 900, out = run({ hz: 30, frames: 20, v });
  for (let i = 1; i < out.length; i++) {
    const { tick, alpha, pose } = out[i];
    assert.ok(Math.abs(pose.x - v * DT * (tick - 1 + alpha)) < 1e-9);
  }
});

test('kąt najkrótszym łukiem przez ±π', () => {
  const rp = new RenderPoses();
  const e = { x: 0, y: 0, angle: Math.PI - 0.05 };
  rp.frame([e], 1, 0.5);
  e.angle = -Math.PI + 0.05;   // obrót o 0,1 rad przez ±π
  rp.frame([e], 2, 0.5);
  const a = rp.poseOf(e).angle;
  assert.ok(Math.abs(Math.abs(a) - Math.PI) < 0.051 + 1e-9, `kąt ${a} — nie przez zero`);
});

test('ruch bez kroku fizyki (czas klatki), teleport, byt bez historii — poza bieżąca', () => {
  const rp = new RenderPoses();
  const e = { x: 0, y: 0, angle: 0 };
  rp.frame([e], 1, 0.25);
  e.x = 100;                    // ten sam krok — przesunięty w czasie klatki (np. tunel warpa)
  rp.frame([e], 1, 0.5);
  assert.equal(rp.poseOf(e).x, 100);
  e.x = 100000;                 // teleport w kroku
  rp.frame([e], 2, 0.1);
  assert.equal(rp.poseOf(e).x, 100000);
  // byt nierysowany w poprzedniej klatce: bez interpolacji od starej pozy
  const g = { x: 0, y: 0, angle: 0 };
  rp.frame([g], 3, 0.5);
  rp.frame([], 4, 0.5);
  g.x = 50;
  rp.frame([g], 5, 0.5);
  assert.equal(rp.poseOf(g).x, 50);
  assert.equal(rp.poseOf(e), null, 'byt spoza listy tej klatki — brak pozy');
});

test('pauza (α = 1) — poza bieżąca; pos ma pierwszeństwo przed x/y', () => {
  const rp = new RenderPoses();
  const e = { x: 1, y: 2, angle: 0, pos: { x: 10, y: 20 } };
  rp.frame([e], 1, 0.5);
  e.pos.x = 40;
  rp.frame([e], 2, 1);
  assert.equal(rp.poseOf(e).x, 40);
  assert.equal(rp.poseOf(e).y, 20);
});

// Kamera przy sterach fregaty zwiadu (index.html) liczy się przed renderPoses.frame — predict() musi dać tę samą pozę,
// którą frame() zaraz policzy (inaczej fregata drży w kadrze; zgłoszenie użytkownika 2026-10-17).
test('predict() = poza z następnego frame() — kroki, ruch w czasie klatki, teleport, byt bez historii, pauza', () => {
  const rp = new RenderPoses();
  const e = { x: 0, y: 0, angle: 0 };
  const g = { pos: { x: 5, y: 5 }, angle: 1 };
  const out = { x: 0, y: 0, angle: 0 };
  let acc = 0, tick = 0;
  for (let f = 0; f < 400; f++) {
    acc += 1 / 240 + (f % 7 === 0 ? 0.004 : 0);
    while (acc >= DT) { acc -= DT; tick++; e.x += 600 * DT; e.angle += 0.4 * DT; g.pos.y += 300 * DT; }
    if (f === 120) e.x += 50;                     // ruch w czasie klatki (bez kroku)
    if (f === 200) e.x += 100000;                 // teleport
    const alpha = f > 300 && f < 320 ? 1 : acc / DT; // pauza
    const list = f % 50 < 3 ? [e] : [e, g];        // g czasem poza listą (bez historii)
    const pe = { ...rp.predict(e, tick, alpha, out) };
    const pg = { ...rp.predict(g, tick, alpha, out) };
    rp.frame(list, tick, alpha);
    const re = rp.poseOf(e);
    assert.ok(Math.abs(re.x - pe.x) < 1e-9 && Math.abs(re.y - pe.y) < 1e-9 && Math.abs(re.angle - pe.angle) < 1e-12, `klatka ${f}: e`);
    if (list.length > 1) {
      const rg = rp.poseOf(g);
      assert.ok(Math.abs(rg.x - pg.x) < 1e-9 && Math.abs(rg.y - pg.y) < 1e-9 && Math.abs(rg.angle - pg.angle) < 1e-12, `klatka ${f}: g`);
    }
  }
});
