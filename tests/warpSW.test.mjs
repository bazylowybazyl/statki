// Prototyp przylotu i wylotu warpa „jak w Gwiezdnych Wojnach” za przełącznikiem `?warpSW=1` (src/3d/warp/warpSW.js,
// 2026-10-30): przełącznik z adresu, czyste obwiednie smug i kadłuba ze światła (przylot NPC, odlot NPC, gracz — kop,
// hamowanie, szczyt smug gwiazd), pula smug w klatce z odcinaniem do kadru (tylko kamera z góry jednego gracza), wpięcie
// w arrivals.js / player.js / warpNurt.js (smuga kształtem GLOW_STREAK duszków, kadłub ze światła przez szew `hullWarp`),
// domyślny wygląd bez zmian. Mgła wojny i maskowanie w KAŻDYM wyglądzie przylotu / odlotu NPC (v.swVis): ukryta encja bez
// przegródek ośrodka, błysków, blasku, fal i smug, częściowo widoczna — × widoczność.
// node --test tests/warpSW.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  WARP_SW, parseWarpSW, warpSWOn, setWarpSW, newWarpSWState, warpSWArrival, warpSWDeparture, warpSWKick, warpSWBrake,
  warpSWStarGain, warpSWWidth
} from '../src/3d/warp/warpSW.js';
import {
  planWarpArrivalFx, planWarpDepartureFx, warpArrivalFxState, warpDepartureFxState, arrivalFxPose, departFxPose
} from '../src/3d/warp/arrivals.js';
import { WarpFrame, WARP_FRAME_CAPS, newWarpSlot } from '../src/3d/warp/frame.js';
import { WarpPlayerFx, warpStarStretch } from '../src/3d/warp/player.js';
import { setHyperLegacyLook } from '../src/3d/warp/hyperLook.js';
import { GLOW_STREAK } from '../src/3d/warp/sprites.js';
import { sampleWarpRush, sampleWarpDeparture } from '../src/game/warpDrive.js';
import { planWarpArrivalAxis, arrivalAxisPose, planWarpDepartureAxis, departAxisPose } from '../src/game/warpTraffic.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
// równość względna (sumy jasności i amplitud)
const nearRel = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

// Liczby i sumy klatki efektu: błyski (Σ k), blask (Σ k), fale (Σ amplitud), przegródki ośrodka, smugi.
function frameSums(f) {
  let flashK = 0;
  let glareK = 0;
  let waveAmp = 0;
  for (let i = 0; i < f.flashes.count; i++) flashK += f.flashes.items[i].k;
  for (let i = 0; i < f.glares.count; i++) glareK += f.glares.items[i].k;
  for (let i = 0; i < f.waves.count; i++) waveAmp += f.waves.items[i].amp;
  return {
    flashes: f.flashes.count, glares: f.glares.count, waves: f.waves.count, bubbles: f.bubbles.length,
    streaks: f.streaks.count, flashK, glareK, waveAmp
  };
}

// Rekord kadłuba (odsłanianie, szew, żar) jako napis — porównanie „bez zmian”.
const hullKey = (h) => [h.on, h.revealMode, h.revealLine, h.seamLine, h.seam, h.seamW, h.heat, h.rimW, ...h.seamRGB,
  ...h.heatRGB].join('|');

// ── przełącznik ────────────────────────────────────────────────────────────────────────────────────────────────────

test('przełącznik ?warpSW=1 (adres strony — RenderWorld.pageSearch, także w workerze), wymuszenie testów', () => {
  assert.equal(parseWarpSW(''), false);
  assert.equal(parseWarpSW('?dev=1'), false);
  assert.equal(parseWarpSW('?warpSW=1'), true);
  assert.equal(parseWarpSW('?dev=1&warpSW=1&ziarno=7'), true);
  assert.equal(parseWarpSW('?warpSW=0'), false);
  assert.equal(parseWarpSW('?warpSW=10'), false);
  assert.equal(parseWarpSW(null), false);
  assert.equal(warpSWOn('?warpSW=1'), true);
  assert.equal(warpSWOn(''), false);
  setWarpSW(true);
  assert.equal(warpSWOn(''), true);
  setWarpSW(false);
  assert.equal(warpSWOn('?warpSW=1'), false);
  setWarpSW(null);
  assert.equal(warpSWOn('?warpSW=1'), true);
  assert.equal(warpSWOn('?x=1'), false);
});

// ── obwiednie ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('przylot NPC: smuga za rufą w wlocie (≤ 7 L, ≤ droga od pojawienia się), zatrzask przy hamowaniu ≤ 0,2 s, kadłub ze światła gaśnie 0,25 s po hamowaniu', () => {
  const a = planWarpArrivalFx({ x: 0, y: 0, angle: 0.4, hullLength: 1200, hullWidth: 500, appearTime: 1 });
  const L = a.hullLength;
  const out = newWarpSWState();
  const rs = {};
  const at = (t) => warpSWArrival(a, t, sampleWarpRush(a, t, rs).along, out);
  assert.equal(at(a.tAppear - 0.01).light, 0, 'przed pojawieniem się nic');
  assert.equal(out.len, 0);
  // wlot: smuga rośnie z drogą, nie dłuższa niż 7 L; kadłub ze światła
  let prevLen = -1;
  for (let t = a.tAppear; t < a.tBrake; t += 0.01) {
    const along = sampleWarpRush(a, t, rs).along;
    const e = at(t);
    assert.equal(e.light, 1);
    assert.ok(near(e.len, Math.min(WARP_SW.arriveLen * L, along), 1e-6), `wlot ${t}`);
    assert.ok(e.len >= prevLen - 1e-9);
    prevLen = e.len;
  }
  assert.ok(prevLen > L, 'pod koniec wlotu smuga dłuższa niż kadłub');
  // hamowanie: ogon dojeżdża do kadłuba monotonicznie, do zera w min(0,2 s, hamowanie)
  const snap = Math.min(WARP_SW.arriveSnapMax, a.brake);
  assert.ok(snap <= 0.2 + 1e-12);
  let prev = Infinity;
  for (let tb = 0; tb <= snap + 0.02; tb += 0.005) {
    const e = at(a.tBrake + tb);
    assert.ok(e.len <= prev + 1e-6, `zatrzask ${tb}`);
    prev = e.len;
  }
  assert.equal(at(a.tBrake + snap + 1e-6).len, 0, 'ogon w kadłubie');
  // kadłub ze światła: do końca hamowania 1, potem gaśnie do 0 w 0,25 s
  assert.equal(at(a.tStop - 1e-6).light, 1);
  assert.equal(at(a.tStop + WARP_SW.arriveLightFade + 1e-6).light, 0);
  let pl = 2;
  for (let ts = 0; ts <= 0.3; ts += 0.01) {
    const l = at(a.tStop + ts).light;
    assert.ok(l <= pl + 1e-12);
    pl = l;
  }
  // warp-in prowadzony przez grę (hamowanie nieznane — tBrake = ∞): wlot trwa
  const m = { ...a, tBrake: Infinity, tStop: Infinity };
  assert.equal(warpSWArrival(m, a.tAppear + 5, 1e6, out).light, 1);
  assert.ok(near(out.len, WARP_SW.arriveLen * L, 1e-9));
});

test('odlot NPC: od nurkowania kadłub ze światła (0,1 s) i ślad rosnący z prędkością (≤ droga); w punkcie skoku smuga wystrzeliwuje na 8 L i gaśnie w 0,35 s', () => {
  const d = planWarpDepartureFx({ x: 0, y: 0, angle: 0, hullLength: 1200, hullWidth: 500, startTime: 1 });
  const L = d.hullLength;
  const out = newWarpSWState();
  const smp = {};
  const at = (t) => warpSWDeparture(d, t, sampleWarpDeparture(d, t, smp), out);
  assert.equal(at(d.tDive - 0.01).light, 0, 'ładowanie bez zmian');
  assert.equal(out.len, 0);
  assert.ok(near(at(d.tDive + WARP_SW.departRise).light, 1, 1e-9));
  let prev = -1;
  for (let t = d.tDive; t < d.tIn; t += 0.01) {
    const s = sampleWarpDeparture(d, t, smp);
    const e = warpSWDeparture(d, t, s, out);
    assert.equal(e.gone, false);
    assert.ok(e.len <= s.dist + 1e-9, 'ślad nie dłuższy niż przebyta droga');
    assert.ok(e.len >= prev - 1e-9, 'ślad rośnie z prędkością');
    prev = e.len;
  }
  assert.ok(prev > 0);
  assert.equal(at(d.tIn).gone, true, 'od punktu skoku smuga wystrzelona, bez światła kadłuba');
  assert.equal(out.light, 0);
  let headPrev = -1;
  for (let ti = 0; ti < WARP_SW.departShootTime; ti += 0.01) {
    const e = at(d.tIn + ti);
    assert.ok(e.gone && e.head >= headPrev - 1e-9 && e.head <= WARP_SW.departShootLen * L + 1e-6, `smuga ${ti}`);
    assert.ok(e.len >= e.head - 1e-9);
    headPrev = e.head;
  }
  assert.ok(near(at(d.tIn + WARP_SW.departShootRise).head, WARP_SW.departShootLen * L, 1e-6));
  assert.ok(at(d.tIn + 0.3).k < 0.03, 'gaśnie');
  assert.equal(at(d.tIn + WARP_SW.departShootTime + 1e-6).len, 0, 'po 0,35 s nic');
});

test('gracz: smuga przy kopie (~6 L, 0,35 s), zatrzask przy hamowaniu ≤ 0,2 s, szczyt smug gwiazd 1,4 → 2,2', () => {
  const o = newWarpSWState();
  assert.equal(warpSWKick(-0.01, o).len, 0);
  assert.ok(near(warpSWKick(WARP_SW.kickRise, o).len, WARP_SW.kickLen, 1e-9));
  assert.equal(warpSWKick(WARP_SW.kickTime, o).len, 0);
  let pk = 2;
  for (let a = 0; a < WARP_SW.kickTime; a += 0.01) {
    const k = warpSWKick(a, o).k;
    assert.ok(k <= pk + 1e-12);
    pk = k;
  }
  assert.equal(warpSWBrake(-0.01, 0.18, o).len, 0);
  assert.ok(near(warpSWBrake(0, 0.18, o).len, WARP_SW.brakeLen, 1e-12));
  assert.equal(warpSWBrake(0.18, 0.18, o).len, 0);
  assert.equal(warpSWBrake(0.2, 0.5, o).len, 0, 'zatrzask najwyżej 0,2 s');
  // smugi gwiazd: × 1 poza przestrzałem, na szczycie 1,4 → 2,2
  assert.equal(warpSWStarGain(-0.1), 1);
  assert.equal(warpSWStarGain(0.6), 1);
  assert.ok(near(warpStarStretch(1.12, 1, Infinity, 1, 1) * warpSWStarGain(0.12), WARP_SW.starPeak, 1e-6));
  let maxG = 0;
  for (let k = 0; k <= 0.6; k += 0.005) maxG = Math.max(maxG, warpSWStarGain(k));
  assert.ok(near(maxG, WARP_SW.starPeak / 1.4, 1e-6));
  // szerokość smugi z kadłuba, w granicach
  assert.ok(near(warpSWWidth(1000, 500), 500 * WARP_SW.widthK, 1e-9));
  assert.ok(near(warpSWWidth(1000, 5000), WARP_SW.widthMaxL * 1000, 1e-9));
  assert.ok(near(warpSWWidth(1000, 10), WARP_SW.widthMinL * 1000, 1e-9));
});

// ── pula smug ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('klatka: pula smug ≥ 48 (scena „Wojna”), odcinanie do kadru przy zgłoszeniu — smuga poza kadrem nie zajmuje miejsca', () => {
  assert.ok(WARP_FRAME_CAPS.streaks >= 48);
  const f = new WarpFrame();
  f.setStreakView(1000, 600);
  assert.equal(f.addStreak(5000, 0, 1, 0, 2000, 50, 1, 1, 1), false, 'cała smuga za prawą krawędzią');
  assert.equal(f.addStreak(0, 5000, 0, 1, 2000, 50, 1, 1, 1), false, 'cała smuga pod kadrem');
  assert.equal(f.addStreak(1900, 0, 1, 0, 2000, 50, 1, 1, 1), true, 'ogon w kadrze');
  assert.equal(f.addStreak(0, 0, 0, 0, 100, 10, 1, 1, 1), false, 'bez kierunku');
  assert.equal(f.addStreak(0, 0, 1, 0, 0, 10, 1, 1, 1), false, 'bez długości');
  assert.equal(f.addStreak(0, 0, 1, 0, 100, 10, 0, 0, 0), false, 'bez barwy');
  assert.equal(f.streaks.count, 1);
  const s = f.streaks.items[0];
  assert.ok(near(s.dirX, 1) && near(s.dirY, 0) && s.len === 2000 && s.width === 50);
  for (let i = 0; i < 200; i++) f.addStreak(0, i, 3, 4, 100, 10, 1, 1, 1);
  assert.equal(f.streaks.count, WARP_FRAME_CAPS.streaks, 'pula pełna — reszta pominięta');
  assert.ok(near(f.streaks.items[1].dirX, 0.6) && near(f.streaks.items[1].dirY, 0.8), 'kierunek jednostkowy');
  f.reset();
  assert.equal(f.streaks.count, 0);
  assert.equal(f.streakView.on, false);
  assert.equal(f.addStreak(5000, 0, 1, 0, 100, 10, 1, 1, 1), true, 'bez kadru — bez odcinania');
});

// ── wpięcie: przyloty i odloty NPC ─────────────────────────────────────────────────────────────────────────────────

test('przylot NPC z ?warpSW=1: smuga za rufą wzdłuż kursu, kadłub ze światła (tryb −1, szew HDR szerszy niż kadłub); bez przełącznika — jak dawniej; encja ukryta — bez smugi i światła', () => {
  const mk = () => planWarpArrivalFx({ x: 0, y: 0, angle: 0.4, hullLength: 1200, hullWidth: 500, appearTime: 1 });
  const run = (a, t, sw, vis = 1) => {
    const frame = new WarpFrame();
    const pose = arrivalFxPose(a, t, { x: 0, y: 0, vx: 0, vy: 0 });
    pose.angle = a.angle;
    pose.visible = true;
    a.swVis = vis;
    warpArrivalFxState(a, t, frame, 0, 0, pose, a, sw ? WARP_SW : null);
    return { frame, pose };
  };
  const a = mk();
  const L = a.hullLength;
  const tIn = a.tAppear + (a.tBrake - a.tAppear) * 0.7;
  const { frame, pose } = run(a, tIn, true);
  assert.equal(frame.streaks.count, 1);
  const s = frame.streaks.items[0];
  assert.ok(near(s.x, pose.x - Math.cos(a.angle) * L * 0.5, 1e-6) && near(s.y, pose.y - Math.sin(a.angle) * L * 0.5, 1e-6), 'głowa przy rufie');
  assert.ok(near(s.dirX, Math.cos(a.angle)) && near(s.dirY, Math.sin(a.angle)), 'wzdłuż kursu');
  assert.ok(s.len > 0 && s.len <= WARP_SW.arriveLen * L + 1e-6);
  assert.ok(s.r > 1 && s.b > s.r, 'biało-błękitna HDR');
  assert.equal(a.hull.on, true);
  assert.equal(a.hull.revealMode, -1);
  assert.ok(a.hull.revealLine > L && a.hull.seamW > 20 * L && a.hull.seam > 0.99, 'cały kadłub, szew szerszy niż kadłub');
  assert.ok(a.hull.seamRGB[2] > 1, 'szew HDR (powyżej progu bloomu)');
  // bez przełącznika — dawny wygląd (bez smug, bez szwu)
  const b = mk();
  const r0 = run(b, tIn, false);
  assert.equal(r0.frame.streaks.count, 0);
  assert.equal(b.hull.seam, 0);
  assert.notEqual(b.hull.revealMode, -1);
  // encja ukryta (mgła wojny, maskowanie — v.swVis = 0)
  const c = mk();
  const r1 = run(c, tIn, true, 0);
  assert.equal(r1.frame.streaks.count, 0);
  assert.equal(c.hull.seam, 0);
  // hamowanie: po zatrzasku bez smugi; po zgaszeniu kadłub zwykły (żar hamowania jak dawniej)
  const d = mk();
  assert.equal(run(d, d.tBrake + Math.min(WARP_SW.arriveSnapMax, d.brake) + 0.01, true).frame.streaks.count, 0);
  run(d, d.tStop + 0.3, true);
  assert.equal(d.hull.seam, 0);
});

test('odlot NPC z ?warpSW=1: kadłub ze światła i ślad w nurkowaniu; w punkcie skoku smuga wystrzelona do przodu i błysk 1 L, kadłub znika od dziobu domyślnym odsłanianiem; encja ukryta — bez smug i światła', () => {
  const d = planWarpDepartureFx({ x: 0, y: 0, angle: 0, hullLength: 1200, hullWidth: 500, startTime: 1 });
  const L = d.hullLength;
  const run = (t, sw, vis = 1) => {
    const frame = new WarpFrame();
    const pose = departFxPose(d, t, { x: 0, y: 0, vx: 0, vy: 0 });
    pose.angle = d.angle;
    pose.visible = true;
    d.swVis = vis;
    warpDepartureFxState(d, t, frame, 0, 0, pose, d, sw ? WARP_SW : null);
    return { frame, pose };
  };
  const mid = d.tDive + (d.tIn - d.tDive) * 0.8;
  const r = run(mid, true);
  assert.equal(r.frame.streaks.count, 1, 'ślad za rufą');
  assert.ok(near(r.frame.streaks.items[0].x, r.pose.x - L * 0.5, 1e-6));
  assert.equal(d.hull.revealMode, -1);
  assert.ok(d.hull.seam > 0.99 && d.hull.revealLine > L, 'kadłub ze światła');
  // w oknie [tIn, tGone] kadłub wchodzi w smugę i znika od dziobu jak domyślnie (linia punktu skoku przez kadłub) —
  // nie schowany cały: wieże, lampy i plazma dysz zostają do zniknięcia encji w tGone
  const tMouth = (d.tIn + d.tGone) * 0.5;
  const rm = run(tMouth, true);
  assert.equal(rm.frame.streaks.count, 1, 'smuga wystrzelona');
  assert.equal(d.hull.revealMode, -1);
  assert.ok(d.hull.revealLine > -0.6 * L && d.hull.revealLine < 0.5 * L, `linia punktu skoku na kadłubie: ${d.hull.revealLine / L} L`);
  const mouthHull = hullKey(d.hull);
  run(tMouth, false);
  assert.equal(mouthHull, hullKey(d.hull), 'od punktu skoku kadłub jak w domyślnym wyglądzie');
  // po tGone
  const tAfter = d.tIn + 0.1;
  assert.ok(tAfter > d.tGone);
  const r2 = run(tAfter, true);
  assert.equal(r2.frame.streaks.count, 1);
  const shoot = r2.frame.streaks.items[0];
  assert.ok(near(shoot.x, d.cx + WARP_SW.departShootLen * L, 1e-6) && near(shoot.y, d.cy, 1e-6), 'głowa 8 L przed punktem skoku');
  assert.ok(d.hull.revealLine < -0.6 * L, 'rufa za punktem skoku');
  let flash = false;
  for (let i = 0; i < r2.frame.flashes.count; i++) {
    const f = r2.frame.flashes.items[i];
    if (near(f.x, d.cx, 1e-6) && near(f.size, L * WARP_SW.departFlashL, 1e-6)) flash = true;
  }
  assert.ok(flash, 'błysk 1 L w punkcie skoku');
  // encja ukryta (mgła wojny, maskowanie — v.swVis = 0): bez śladu, smugi wystrzelonej i kadłuba ze światła
  const h1 = run(mid, true, 0);
  assert.equal(h1.frame.streaks.count, 0, 'ukryta — bez śladu');
  assert.equal(d.hull.seam, 0, 'ukryta — bez kadłuba ze światła');
  assert.equal(run(tMouth, true, 0).frame.streaks.count, 0, 'ukryta — bez smugi w punkcie skoku');
  const h2 = run(tAfter, true, 0);
  assert.equal(h2.frame.streaks.count, 0, 'ukryta — bez smugi po zniknięciu');
  assert.equal(d.hull.seam, 0);
  // bez przełącznika — dawny wygląd
  const r3 = run(mid, false);
  assert.equal(r3.frame.streaks.count, 0);
  assert.equal(d.hull.seam, 0);
  const r4 = run(tAfter, false);
  assert.equal(r4.frame.streaks.count, 0);
});

// ── mgła wojny i maskowanie w KAŻDYM wyglądzie (v.swVis — pisze sterownik dla żywej encji) ──────────────────────────

test('mgła wojny także w domyślnym wyglądzie: przylot ukrytej encji (v.swVis = 0) bez przegródek ośrodka, błysków, blasku i fal; częściowo widocznej — × widoczność; kadłub i plazma bez zmian', () => {
  for (const heraldStyle of ['thread', 'ripple']) {
    const mk = () => planWarpArrivalFx({ x: 0, y: 0, angle: 0.4, hullLength: 1200, hullWidth: 500, appearTime: 10, heraldStyle });
    const a0 = mk();
    const phases = [
      ['zwiastun', (a0.t0 + a0.tAppear) * 0.5],
      ['wlot', a0.tAppear + (a0.tBrake - a0.tAppear) * 0.7],
      ['hamowanie', a0.tBrake + 0.05]
    ];
    for (const [name, t] of phases) {
      const run = (vis) => {
        const a = mk();
        a.swVis = vis;
        const frame = new WarpFrame();
        const pose = arrivalFxPose(a, t, { x: 0, y: 0, vx: 0, vy: 0 });
        pose.angle = a.angle;
        pose.visible = true;
        warpArrivalFxState(a, t, frame, 0, 0, pose, a, null);
        return { s: frameSums(frame), hull: hullKey(a.hull), plasma: a.plasmaMode };
      };
      const full = run(1);
      const tag = `${heraldStyle} / ${name}`;
      assert.ok(full.s.flashes + full.s.waves + full.s.bubbles > 0, `${tag}: widoczna — efekty są`);
      if (name === 'hamowanie') {
        assert.ok(full.s.flashes >= 1 && full.s.glares >= 1 && full.s.waves >= 1 && full.s.bubbles >= 2, `${tag}: błysk, blask, fala, bańka i iskry`);
      }
      const hidden = run(0);
      assert.deepEqual([hidden.s.flashes, hidden.s.glares, hidden.s.waves, hidden.s.bubbles, hidden.s.streaks], [0, 0, 0, 0, 0],
        `${tag}: ukryta — nic w klatce`);
      const half = run(0.5);
      assert.deepEqual([half.s.flashes, half.s.glares, half.s.waves, half.s.bubbles], [full.s.flashes, full.s.glares, full.s.waves, full.s.bubbles]);
      assert.ok(nearRel(half.s.flashK, 0.5 * full.s.flashK) && nearRel(half.s.glareK, 0.5 * full.s.glareK)
        && nearRel(half.s.waveAmp, 0.5 * full.s.waveAmp), `${tag}: × widoczność`);
      // bez widoczności (dema, warsztat) — jak widoczna
      assert.deepEqual(run(undefined).s, full.s);
      // kadłub i plazma bez zmian (skórę ukrytej encji chowa hexShips3D)
      assert.equal(hidden.hull, full.hull, `${tag}: kadłub`);
      assert.equal(half.hull, full.hull);
      assert.equal(hidden.plasma, full.plasma);
    }
  }
});

test('mgła wojny także w domyślnym wyglądzie: odlot ukrytej encji bez zbierania ośrodka, błysków i fal (ładowanie, kop, punkt skoku, po zniknięciu); częściowo widocznej — × widoczność; kadłub i plazma bez zmian', () => {
  const mk = () => planWarpDepartureFx({ x: 0, y: 0, angle: 0, hullLength: 1200, hullWidth: 500, startTime: 1 });
  const d0 = mk();
  const phases = [
    ['ładowanie', d0.t0 + d0.charge * 0.5],
    ['kop', d0.tDive + 0.1],
    ['punkt skoku', (d0.tIn + d0.tGone) * 0.5],
    ['po zniknięciu', d0.tGone + 0.05]
  ];
  for (const [name, t] of phases) {
    const run = (vis) => {
      const d = mk();
      d.swVis = vis;
      const frame = new WarpFrame();
      let pose = null;
      if (t < d.tGone) {
        pose = departFxPose(d, t, { x: 0, y: 0, vx: 0, vy: 0 });
        pose.angle = d.angle;
        pose.visible = true;
      }
      warpDepartureFxState(d, t, frame, 0, 0, pose, d, null);
      return { s: frameSums(frame), hull: hullKey(d.hull), plasma: d.plasmaMode };
    };
    const full = run(1);
    assert.ok(full.s.flashes + full.s.waves + full.s.bubbles > 0, `${name}: widoczna — efekty są`);
    const hidden = run(0);
    assert.deepEqual([hidden.s.flashes, hidden.s.glares, hidden.s.waves, hidden.s.bubbles, hidden.s.streaks], [0, 0, 0, 0, 0],
      `${name}: ukryta — nic w klatce`);
    const half = run(0.5);
    assert.deepEqual([half.s.flashes, half.s.waves, half.s.bubbles], [full.s.flashes, full.s.waves, full.s.bubbles]);
    assert.ok(nearRel(half.s.flashK, 0.5 * full.s.flashK) && nearRel(half.s.waveAmp, 0.5 * full.s.waveAmp), `${name}: × widoczność`);
    assert.deepEqual(run(undefined).s, full.s);
    assert.equal(hidden.hull, full.hull, `${name}: kadłub`);
    assert.equal(hidden.plasma, full.plasma);
  }
});

// ── wpięcie: gracz ─────────────────────────────────────────────────────────────────────────────────────────────────

// Skok gracza na prawdziwym WarpPlayerFx; przełącznik wymuszany przed każdą klatką (kilka skoków na zmianę w jednym teście).
function playerJump(sw, opts = {}) {
  const fx = new WarpPlayerFx();
  fx.bubble = newWarpSlot();
  fx.push = newWarpSlot();
  const frame = new WarpFrame();
  const game = {
    state: 'idle', charge: 0, chargeTime: 0.8, speed: 0, angle: 0.3, x: 1000, y: 2000, length: 1800, width: 800,
    palette: 'magenta', vRelX: 0, vRelY: 0, exitRamp: null, hyper: false, topDown: true, ...opts
  };
  const map = { camX: 900, camY: 1900 };
  const med = { camMX: 0, camMY: 0, flow: 0, flowX: 0, flowY: 0 };
  let t = 0;
  const step = (dt = 1 / 60) => {
    setWarpSW(sw);
    frame.reset();
    fx.advance(t, dt, game, map, med);
    const v = fx.visibleFlow(t);
    med.flow = v === null ? 0 : v;
    fx.fill(t, game, frame, map, med);
    t += dt;
  };
  game.state = 'charging';
  for (let i = 0; i < 48; i++) { game.charge = Math.min(1, (i + 1) / 48); step(); }
  game.state = 'active';
  const kickT = t;
  step();
  return { fx, frame, game, step, kickT, now: () => t };
}

test('gracz z ?warpSW=1: smuga za rufą przy kopie i przy hamowaniu przylotu, szczyt smug gwiazd ×2,2/1,4 — tylko warp i kamera z góry', () => {
  try {
    // kop: smuga za rufą (głowa przy rufie, wzdłuż kursu), gwiazdy mocniej
    const on = playerJump(true);
    while (on.now() < on.kickT + 0.1) on.step();
    assert.ok(on.frame.streaks.count >= 1, 'smuga przy kopie');
    const s = on.frame.streaks.items[0];
    assert.ok(near(s.dirX, Math.cos(0.3)) && near(s.dirY, Math.sin(0.3)));
    assert.ok(near(s.x, 100 - Math.cos(0.3) * 900, 1e-6) && near(s.y, 100 - Math.sin(0.3) * 900, 1e-6), 'głowa przy rufie');
    const off = playerJump(false);
    while (off.now() < off.kickT + 0.1) off.step();
    assert.equal(off.frame.streaks.count, 0, 'bez przełącznika — bez smugi');
    // szczyt smug gwiazd (ta sama klatka po kopie)
    const a = playerJump(true);
    const b = playerJump(false);
    while (a.now() < a.kickT + 0.12) { a.step(); b.step(); }
    const ratio = a.frame.stars.stretch / b.frame.stars.stretch;
    assert.ok(ratio > 1.3 && ratio <= WARP_SW.starPeak / 1.4 + 1e-6, `przestrzał × ${ratio}`);
    // hipercruise i kamera bez soczewki — bez smugi i bez wzmocnienia: smugi gwiazd jak w przebiegu bez przełącznika
    // w tej samej klatce szczytu przestrzału. `kick` — blok kopu się wykonuje (błysk za rufą), więc smugę blokuje sam
    // warunek swOn, nie pominięty blok.
    const sameAsOff = (opts, label, kick) => {
      const on1 = playerJump(true, opts);
      const off1 = playerJump(false, opts);
      while (on1.now() < on1.kickT + 0.12) { on1.step(); off1.step(); }
      assert.equal(on1.frame.streaks.count, 0, `${label}: bez smugi`);
      assert.ok(off1.frame.stars.stretch > 0, `${label}: smugi gwiazd są`);
      assert.ok(nearRel(on1.frame.stars.stretch, off1.frame.stars.stretch, 1e-12), `${label}: smugi gwiazd bez wzmocnienia`);
      if (kick) assert.ok(on1.frame.flashes.count >= 1, `${label}: blok kopu się wykonał`);
    };
    // hipercruise v2 (spokojny — bez bloku kopu) i dawny wygląd `?hcStary=1` (blok kopu idzie)
    sameAsOff({ hyper: true }, 'hipercruise', false);
    setHyperLegacyLook(true);
    sameAsOff({ hyper: true }, 'hipercruise ?hcStary=1', true);
    setHyperLegacyLook(null);
    // podzielony ekran / kamera 3D (sterownik: o.lensAllowed false → game.topDown false)
    sameAsOff({ topDown: false }, 'podzielony ekran / kamera 3D', true);
    // hamowanie przylotu: smuga zatrzaskuje się w kadłub w chwili hamowania (z błyskiem)
    while (on.now() < on.kickT + 1) on.step();
    on.game.state = 'idle';
    on.game.exitRamp = { active: true, age: 0, slow: 0.7, coast: 0.45, brake: 0.2, vArr: 16000, v0: 16000, tBrake: 1.15, tHalt: 1.35 };
    const exitT = on.now();
    on.step();
    while (on.now() < exitT + 1.15 + 0.04) on.step();
    assert.ok(on.frame.streaks.count >= 1, 'smuga przy hamowaniu');
    assert.ok(on.frame.flashes.count >= 1, 'w tej samej klatce błysk hamowania');
    while (on.now() < exitT + 1.15 + 0.25) on.step();
    assert.equal(on.frame.streaks.count, 0, 'po zatrzasku nic');
  } finally {
    setWarpSW(null);
    setHyperLegacyLook(null);
  }
});

// ── wpięcie: sterownik (Core3D zaślepiony, bez GPU) ─────────────────────────────────────────────────────────────────

// Sterownik „Nurtu” na zaślepionym Core3D (bez urządzenia GPU): duszki w buforze `WarpNurt.glow`, klatka `WarpNurt.frame`.
async function nurtDriver() {
  const { Core3D } = await import('../src/3d/core3d.js');
  const { WarpNurt } = await import('../src/3d/warp/warpNurt.js');
  const { setEntityHiddenTest } = await import('../src/3d/hexShips3D.js');
  Core3D.isInitialized = true;
  Core3D.scene = Core3D.scene || new THREE.Scene();
  Core3D.width = 1600;
  Core3D.height = 900;
  Core3D.addFxStep = () => {};
  Core3D.setDistortLayerActive = () => {};
  if (!WarpNurt.initialized) WarpNurt.init({ count: 4096 });
  const streaks = () => {
    const B = WarpNurt.glow.b.array;
    let n = 0;
    for (let i = 0; i < WarpNurt.glow.count; i++) if (B[i * 4 + 3] === GLOW_STREAK) n++;
    return n;
  };
  // wszystko, co zdradza okręt w klatce: błyski, blask, fale, przegródki ośrodka, smugi, duszki
  const tell = () => {
    const f = WarpNurt.frame;
    return f.flashes.count + f.glares.count + f.waves.count + f.bubbles.length + f.streaks.count + WarpNurt.glow.count;
  };
  return { WarpNurt, setEntityHiddenTest, streaks, tell };
}

test('sterownik: smuga przylotu NPC w duszkach (kształt GLOW_STREAK — ten sam rysunek), kadłub ze światła w uniformach kadłuba; mgła wojny i maskowanie chowają smugę i — w każdym wyglądzie — zwiastun, ośrodek i błyski po attach', async () => {
  const { WarpNurt, setEntityHiddenTest, streaks, tell } = await nurtDriver();
  const a = planWarpArrivalAxis({ x: 50000, y: 30000, angle: 0, hullLength: 1200, hullWidth: 500, appearTime: 10 });
  const t = a.tAppear + 0.4;
  const pose = arrivalAxisPose(a, t, {});
  const npc = { x: pose.x, y: pose.y, angle: 0, vx: pose.vx, vy: pose.vy, beamHull: { scale: 1 } };
  const cam = { x: pose.x - 2000, y: pose.y, zoom: 0.12 };
  const o = { dt: 1 / 60, cam, camShake: cam, camFollow: false, ship: null, warp: null, trafficTime: t, lensAllowed: true };
  WarpNurt.warpBegin(901, 'arrival', a, npc);
  try {
    setWarpSW(true);
    WarpNurt.update(o);
    assert.equal(streaks(), 1, 'smuga w duszkach');
    assert.ok(npc.__warpHullU && npc.__warpHullU.b.z > 1, 'kadłub ze światła — szew HDR w uniformie');
    assert.equal(npc.__warpHullU.a.y, -1, 'tryb −1');
    // mgła wojny (ten sam predykat co skóra kadłuba)
    setEntityHiddenTest((e) => e === npc);
    WarpNurt.update(o);
    assert.equal(streaks(), 0, 'encja ukryta mgłą — bez smugi');
    assert.equal(tell(), 0, 'encja ukryta mgłą — nic w klatce');
    setEntityHiddenTest(null);
    // maskowanie
    npc.__cloakLook = { active: true, vis: 0 };
    WarpNurt.update(o);
    assert.equal(streaks(), 0, 'maskowanie — bez smugi');
    assert.equal(tell(), 0, 'maskowanie — nic w klatce');
    npc.__cloakLook = { active: true, vis: 0.4 };
    WarpNurt.update(o);
    assert.ok(near(WarpNurt._visual(901).dress.swVis, 0.4, 1e-12), 'częściowe maskowanie — widoczność 0,4');
    npc.__cloakLook = undefined;
    // domyślny wygląd: widoczna — zwiastun (punkt zbierania) i bańka okrętu; ukryta / zamaskowana — nic
    setWarpSW(false);
    WarpNurt.update(o);
    assert.equal(streaks(), 0, 'bez przełącznika — bez smug');
    assert.ok(WarpNurt.frame.flashes.count >= 1 && WarpNurt.frame.bubbles.length >= 1, 'domyślny wygląd — błysk zwiastuna i bańka');
    assert.equal(WarpNurt._visual(901).dress.swVis, 1);
    setEntityHiddenTest((e) => e === npc);
    WarpNurt.update(o);
    assert.equal(tell(), 0, 'domyślny wygląd, mgła wojny — nic w klatce');
    setEntityHiddenTest(null);
    npc.__cloakLook = { active: true, vis: 0 };
    WarpNurt.update(o);
    assert.equal(tell(), 0, 'domyślny wygląd, maskowanie — nic w klatce');
    npc.__cloakLook = undefined;
    // zwiastun zaplanowanego przylotu PRZED attach (bez encji) zostaje jak był
    const b = planWarpArrivalAxis({ x: 51000, y: 31000, angle: 0, hullLength: 1200, hullWidth: 500, appearTime: 12 });
    WarpNurt.warpBegin(903, 'arrival', b, null);
    setEntityHiddenTest(() => true);
    WarpNurt.update({ ...o, trafficTime: (b.t0 + b.tAppear) * 0.5 });
    assert.ok(WarpNurt.frame.flashes.count >= 1 && WarpNurt.frame.bubbles.length >= 1, 'zwiastun planu przed attach');
  } finally {
    setWarpSW(null);
    setEntityHiddenTest(null);
    WarpNurt.warpEnd(901);
    WarpNurt.warpEnd(903);
  }
});

test('sterownik: smugi odcinane do kadru tylko w kamerze z góry jednego gracza (o.lensAllowed) — w podzielonym ekranie i kamerach 3D duszki rysuje każdy widok', async () => {
  const { WarpNurt, streaks } = await nurtDriver();
  const a = planWarpArrivalAxis({ x: 50000, y: 30000, angle: 0, hullLength: 1200, hullWidth: 500, appearTime: 10 });
  const t = a.tAppear + 0.4;
  const pose = arrivalAxisPose(a, t, {});
  const npc = { x: pose.x, y: pose.y, angle: 0, vx: pose.vx, vy: pose.vy, beamHull: { scale: 1 } };
  // przylot daleko poza pudłem kadru tej kamery (200 tys. j.)
  const cam = { x: pose.x - 200000, y: pose.y + 50000, zoom: 0.12 };
  const o = { dt: 1 / 60, cam, camShake: cam, camFollow: false, ship: null, warp: null, trafficTime: t, lensAllowed: true };
  WarpNurt.warpBegin(904, 'arrival', a, npc);
  try {
    setWarpSW(true);
    WarpNurt.update(o);
    assert.equal(streaks(), 0, 'kamera z góry — smuga poza kadrem odcięta');
    WarpNurt.update({ ...o, lensAllowed: false });
    assert.equal(streaks(), 1, 'podzielony ekran / kamera 3D — bez odcinania');
    WarpNurt.update(o);
    assert.equal(streaks(), 0);
  } finally {
    setWarpSW(null);
    WarpNurt.warpEnd(904);
  }
});

test('sterownik: odlot NPC (oś z rejestru gry, okręt prowadzony departAxisPose) — mgła wojny i maskowanie chowają ślad, smugę wystrzeloną, kadłub ze światła oraz w każdym wyglądzie zbieranie, błyski i fale; po zniknięciu encji widoczność zostaje ostatnia', async () => {
  const { WarpNurt, setEntityHiddenTest, streaks, tell } = await nurtDriver();
  const d = planWarpDepartureAxis({ x: 60000, y: 40000, angle: 0, hullLength: 1200, hullWidth: 500, startTime: 10, drive: true });
  const L = d.hullLength;
  const npc = { x: d.x, y: d.y, angle: 0, vx: 0, vy: 0, beamHull: { scale: 1 } };
  const pose = {};
  // kamera między startem a punktem skoku — cała droga w kadrze
  const cam = { x: d.x + (d.cx - d.x) * 0.5, y: d.y, zoom: 0.12 };
  const o = { dt: 1 / 60, cam, camShake: cam, camFollow: false, ship: null, warp: null, trafficTime: 0, lensAllowed: true };
  const at = (t) => {
    departAxisPose(d, t, pose);
    npc.x = pose.x;
    npc.y = pose.y;
    npc.vx = pose.vx;
    npc.vy = pose.vy;
    o.trafficTime = t;
    WarpNurt.update(o);
  };
  const tTrail = d.tIn - 0.1;                 // późne nurkowanie: ślad za rufą, kadłub ze światła
  const tMouth = (d.tIn + d.tGone) * 0.5;     // punkt skoku: smuga wystrzelona, błysk 1 L
  WarpNurt.warpBegin(902, 'departure', d, npc);
  try {
    setWarpSW(true);
    at(tTrail);
    assert.equal(streaks(), 1, 'ślad za rufą');
    assert.ok(npc.__warpHullU && npc.__warpHullU.b.z > 1, 'kadłub ze światła');
    at(tMouth);
    assert.equal(streaks(), 1, 'smuga wystrzelona');
    // skala kadłuba 1 — uniform w j. świata
    assert.ok(npc.__warpHullU.a.x > -0.6 * L && npc.__warpHullU.a.x < 0.5 * L && npc.__warpHullU.a.y === -1,
      'kadłub znika od dziobu (linia punktu skoku na kadłubie, tryb −1)');
    // mgła wojny
    setEntityHiddenTest((e) => e === npc);
    at(tTrail);
    assert.equal(tell(), 0, 'mgła wojny — nic w klatce (nurkowanie)');
    assert.ok(!(npc.__warpHullU.b.z > 1), 'mgła wojny — bez kadłuba ze światła');
    at(tMouth);
    assert.equal(tell(), 0, 'mgła wojny — nic w klatce (punkt skoku)');
    setEntityHiddenTest(null);
    // maskowanie
    npc.__cloakLook = { active: true, vis: 0 };
    at(tTrail);
    assert.equal(tell(), 0, 'maskowanie — nic w klatce (nurkowanie)');
    at(tMouth);
    assert.equal(tell(), 0, 'maskowanie — nic w klatce (punkt skoku)');
    npc.__cloakLook = undefined;
    // domyślny wygląd: widoczny — zbieranie ośrodka, błyski i fale; ukryty — nic
    setWarpSW(false);
    at(tMouth);
    assert.equal(streaks(), 0);
    assert.ok(WarpNurt.frame.flashes.count >= 1 && WarpNurt.frame.waves.count >= 1, 'domyślny wygląd — błysk i fala w punkcie skoku');
    setEntityHiddenTest((e) => e === npc);
    at(tTrail);
    assert.equal(tell(), 0, 'domyślny wygląd, mgła wojny — nic w klatce (nurkowanie)');
    at(tMouth);
    assert.equal(tell(), 0, 'domyślny wygląd, mgła wojny — nic w klatce (punkt skoku)');
    // encja zniknęła (gra usunęła okręt): widoczność zostaje ostatnia — fala w punkcie skoku dalej schowana
    setEntityHiddenTest(null);
    npc.dead = true;
    at(d.tGone + 0.05);
    assert.equal(WarpNurt._visual(902).dress.swVis, 0, 'ostatnia widoczność');
    assert.equal(tell(), 0, 'po zniknięciu ukrytej encji — nic w klatce');
  } finally {
    setWarpSW(null);
    setEntityHiddenTest(null);
    WarpNurt.warpEnd(902);
  }
});

// ── strażnicy ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('moduł: bez Math.random, window, DOM i three (czysty), przełącznik przez RenderWorld.pageSearch; bez nowego materiału i pól migawki', () => {
  const sw = code('src/3d/warp/warpSW.js');
  assert.doesNotMatch(sw, /Math\.random|\bwindow\b|\bdocument\b|\blocation\b|from 'three/);
  assert.match(sw, /RenderWorld\.pageSearch/);
  assert.doesNotMatch(sw + code('src/3d/warp/frame.js'), /NodeMaterial|new THREE\./);
  const nurt = code('src/3d/warp/warpNurt.js');
  assert.match(nurt, /GLOW_STREAK/);
  assert.match(nurt, /isEntityHiddenForRender\(e\)/);
  // smuga i kadłub ze światła nie wiążą nowych faz z plazmą (`__warpNurtMode`): każdy blok `if (sw…) {` przylotu i odlotu
  // (do klamry na tym samym wcięciu) i każdy blok `if (swOn) {` gracza — bloków nie mniej niż dziś (strażnik nie przejdzie
  // pusto po zmianie zapisu)
  const arr = code('src/3d/warp/arrivals.js');
  const swBlocks = [...arr.matchAll(/^( *)if \(swE?\b[^\n]*\{[ \t]*\n[\s\S]*?\n\1\}/gm)];
  assert.ok(swBlocks.length >= 3, `bloki SW w arrivals.js: ${swBlocks.length}`);
  for (const m of swBlocks) assert.doesNotMatch(m[0], /plasmaMode|__warpNurtMode/);
  const pl = code('src/3d/warp/player.js');
  const swOnBlocks = [...pl.matchAll(/^( *)if \(swOn\b[^\n]*\{[ \t]*\n[\s\S]*?\n\1\}/gm)];
  assert.ok(swOnBlocks.length >= 2, `bloki SW w player.js: ${swOnBlocks.length}`);
  for (const m of swOnBlocks) assert.doesNotMatch(m[0], /plasmaMode|__warpNurtMode/);
  // blok migawki warpa bez nowych pól (oś z rejestru gry wystarcza)
  const block = read('src/render/blocks/warpBlock.js');
  assert.doesNotMatch(block, /warpSW|swVis/);
});
