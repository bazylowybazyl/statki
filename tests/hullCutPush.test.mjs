// Rzaz z pędem (HullBodies.cutSegment z opts.push — Hexlance, 2026-09-29): dawniej węzły rzazu ginęły
// w miejscu, więc odłamki i odcięte części „wisiały” przy kadłubie. Teraz odłamki (prędkość węzła →
// onNodeDebris) lecą wzdłuż toru, a kadłub dostaje impuls w środku masy rzazu (ruch i obrót ENCJI —
// gra całkuje ruch encji); odcięte części dziedziczą go przy rozpadzie. Bez opts.push — jak dawniej.
// node --test tests/hullCutPush.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies, HULL_BODY_CONFIG } = await import('../src/game/hullBodies.js');

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}
const npcAt = (x, y) => ({ x, y, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 5000, dead: false, isWreck: false });
const debris = [];
window.spawnHullDebris = (x, y, vx, vy) => { debris.push({ x, y, vx, vy }); };
const release = (list) => { for (const e of list) HullBodies.release(e); for (const w of window.wrecks) HullBodies.release(w); window.wrecks.length = 0; };

test('rzaz z pędem: odłamki wzdłuż toru, kadłub dostaje ruch wzdłuż toru i obrót od rzazu poza środkiem', () => {
  const e = npcAt(0, 0);
  HullBodies.createHull(e, plate(600, 300));
  try {
    debris.length = 0;
    // Tor w dół ekranu (+y gry) przez prawą część płyty.
    const killed = HullBodies.cutSegment(e, 150, -400, 150, 400, 35, { push: true });
    assert.ok(killed > 20, `rzaz: ${killed} węzłów`);
    assert.equal(debris.length, killed, 'odłamek na zniszczony węzeł');
    const along = debris.filter((d) => d.vy > 0.5 * Math.abs(d.vx));
    assert.ok(along.length === debris.length, `wszystkie odłamki lecą wzdłuż toru (${along.length}/${debris.length})`);
    const vy = debris.reduce((a, d) => a + d.vy, 0) / debris.length;
    const S = HULL_BODY_CONFIG.cutDebrisSpeed;
    assert.ok(vy > 0.4 * S && vy < 1.4 * S, `średnia prędkość odłamków wzdłuż toru ${vy.toFixed(0)} j/s`);
    // Rozrzut na boki od linii cięcia: z lewej strony w lewo, z prawej w prawo.
    for (const d of debris) if (Math.abs(d.x - 150) > 8) assert.ok(Math.sign(d.vx) === Math.sign(d.x - 150), 'bok od linii cięcia');
    // Kadłub: ruch wzdłuż toru, bez bocznego, obrót zgodnie z momentem (rzaz na prawo od środka, pchnięcie w +y).
    assert.ok(e.vy > 5, `prędkość kadłuba wzdłuż toru: ${e.vy}`);
    assert.ok(Math.abs(e.vx) < 0.05 * e.vy, `bez bocznej: ${e.vx}`);
    assert.ok(e.angVel > 0.01, `obrót od rzazu poza środkiem: ${e.angVel}`);
    assert.ok(e.vy <= HULL_BODY_CONFIG.cutPushMaxDv + 1e-9 && e.angVel <= HULL_BODY_CONFIG.cutPushMaxDw + 1e-9, 'sufity');
  } finally { release([e]); }
});

test('rzaz przez środek masy: bez obrotu; rzaz z lewej — obrót w drugą stronę', () => {
  const a = npcAt(0, 0);
  const b = npcAt(0, 0);
  HullBodies.createHull(a, plate(600, 300));
  HullBodies.createHull(b, plate(600, 300));
  try {
    HullBodies.cutSegment(a, 0, -400, 0, 400, 35, { push: true });
    assert.ok(Math.abs(a.angVel) < 0.02 * Math.max(1e-6, a.vy), `przez środek: ω = ${a.angVel}`);
    HullBodies.cutSegment(b, -150, -400, -150, 400, 35, { push: true });
    assert.ok(b.angVel < -0.01, `z lewej: ω = ${b.angVel}`);
  } finally { release([a, b]); }
});

test('odcięta część odlatuje wzdłuż toru (rozpad po rzazie), zamiast wisieć w miejscu', () => {
  const e = npcAt(0, 0);
  HullBodies.createHull(e, plate(600, 300));
  const spawned = [];
  const prev = HullBodies.onWreckSpawned;
  HullBodies.onWreckSpawned = (w) => { spawned.push(w); window.wrecks.push(w); };
  try {
    // Rzaz przez całą wysokość płyty blisko prawej krawędzi — odcina pas ~100 j.
    HullBodies.cutSegment(e, 180, -400, 180, 400, 35, { push: true });
    const hullVy = e.vy;
    // Rozpad sprawdza silnik co splitCheckInterval (10) kroków.
    for (let k = 0; k < 30 && spawned.length === 0; k++) HullBodies.step(1 / 120, [e, ...window.wrecks]);
    assert.ok(spawned.length >= 1, 'rozpad: odcięta część jest wrakiem');
    for (const w of spawned) {
      const vy = w.vel ? w.vel.y : w.vy;
      const vx = w.vel ? w.vel.x : w.vx;
      // Brzeg rzazu (applyCutEdgeImpulse): lekki pas przy linii cięcia leci szybciej niż cały kadłub,
      // wzdłuż toru i na zewnątrz od linii cięcia (pas leży na prawo od niej).
      assert.ok(vy > hullVy + 40, `część leci wzdłuż toru: vy = ${vy.toFixed(1)} (kadłub ${hullVy.toFixed(1)})`);
      assert.ok(vx > 0, `i od linii cięcia: vx = ${vx.toFixed(1)}`);
      assert.ok(vy < HULL_BODY_CONFIG.cutEdgeSpeed + HULL_BODY_CONFIG.cutPushMaxDv, 'bez przestrzelenia');
    }
  } finally {
    HullBodies.onWreckSpawned = prev;
    release([e]);
  }
});

test('bez opts.push — jak dawniej: węzły giną w miejscu, kadłub bez impulsu; rzaz z pędem bez Math.random', () => {
  const e = npcAt(0, 0);
  const f = npcAt(0, 0);
  HullBodies.createHull(e, plate(600, 300));
  HullBodies.createHull(f, plate(600, 300));
  try {
    debris.length = 0;
    const k0 = HullBodies.cutSegment(e, 150, -400, 150, 400, 35);
    assert.ok(k0 > 20);
    assert.equal(e.vx, 0); assert.equal(e.vy, 0); assert.equal(e.angVel, 0);
    assert.ok(debris.every((d) => Math.abs(d.vx) < 1e-9 && Math.abs(d.vy) < 1e-9), 'odłamki z prędkością kadłuba (0)');
    const random = Math.random;
    Math.random = () => { throw new Error('Math.random w rzazie z pędem'); };
    try {
      assert.equal(HullBodies.cutSegment(f, 150, -400, 150, 400, 35, { push: true }), k0, 'te same węzły co bez pędu');
    } finally { Math.random = random; }
  } finally { release([e, f]); }
});
