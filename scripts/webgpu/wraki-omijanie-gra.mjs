// Omijanie wraków przez okręty AI w prawdziwej grze (2026-10-08): skrzydło Terra Novy zbiera się przy graczu, przed
// nim w pasie 9–14 km powstaje pole wraków (okręty piratów zniszczone na miejscu), gracz przenosi się 26 km dalej —
// skrzydło leci za nim przez pole. Co 0,25 s: zetknięcia okręt × wrak (środki bliżej niż --styk × suma promieni;
// nowe zetknięcia par i czas w styku), utracony kadłub skrzydła, przepchnięcie wraków, czas AI (PerfHUD), klatka.
//   node scripts/webgpu/wraki-omijanie-gra.mjs [--sklad 4,6,15] [--wraki 4,4,8] [--formacja groups] [--czas 50]
//        [--styk 0.75] [--zrzut 1] [--out katalog] [--port 5294] [--seed 7]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startVite, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';
import { startChrome, screenshotPng } from './wspolne.mjs';

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const [NB, ND, NF] = String(arg('sklad', '4,6,15')).split(',').map(Number);
const [WB, WD, WF] = String(arg('wraki', '4,4,8')).split(',').map(Number);
const FORMACJA = arg('formacja', 'groups');
const CZAS = Number(arg('czas', 50));
const STYK = Number(arg('styk', 0.75));
const ZRZUT = arg('zrzut', '1') === '1';
const PORT = Number(arg('port', 5294));
const SEED = Number(arg('seed', 7));
// --omijanie 0: A/B bez omijania wraków (window.WreckAvoidTune.enabled = false).
const OMIJANIE = arg('omijanie', '1') !== '0';
const OUT = arg('out', join(tmpdir(), 'wraki-omijanie-gra'));
mkdirSync(OUT, { recursive: true });

const { server, base } = await startVite(PORT);
const chrome = await startChrome({ width: 1600, height: 900 });
const { cdp, logs } = chrome;
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); localStorage.setItem('sc_fog_of_war', '0'); } catch {}
  let s = ${SEED >>> 0};
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();` });
const ev = (e) => evaluate(cdp, e);
const wynik = { sklad: [NB, ND, NF], wraki: [WB, WD, WF], formacja: FORMACJA, styk: STYK };

try {
  await navigateAndWait(cdp, `${base}/index.html?dev=1`,
    '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  for (let t0 = Date.now(); Date.now() - t0 < 240000;) {
    await sleep(250);
    try { if (await ev('(window.__frameId || 0) > 30 && !!window.camera')) break; } catch { /* ładuje się */ }
  }
  await ev(`(async () => { const m = await import('/src/ui/perfHud.js'); window.__PH = m.PerfHUD; if (!m.PerfHUD.visible) m.PerfHUD.toggle(); return true; })()`);
  await ev(`(() => {
    const pl = (window.planets || []).map((p) => ({ x: p.x ?? p.pos?.x, y: p.y ?? p.pos?.y, n: p.name || p.id })).filter((p) => Number.isFinite(p.x));
    const st = (window.stations || []).map((s) => ({ x: s.x ?? s.pos?.x, y: s.y ?? s.pos?.y })).filter((p) => Number.isFinite(p.x));
    const sun = window.SUN || { x: 0, y: 0 };
    const rOf = (re) => { const p = pl.find((q) => re.test(String(q.n))); return p ? Math.hypot(p.x - sun.x, p.y - sun.y) : NaN; };
    const R = (rOf(/venus|wenus/i) + rOf(/earth|ziemia/i)) / 2;
    let best = null;
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2, x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
      let dmin = Infinity; for (const p of pl.concat(st)) dmin = Math.min(dmin, Math.hypot(p.x - x, p.y - y));
      if (!best || dmin > best.dmin) best = { x, y, dmin };
    }
    window.DevScene.teleport(best.x, best.y, -Math.PI / 2); window.DevScene.syncCamera();
    window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = 0.04;
    window.CockpitSupport.setFormation('${FORMACJA}');
    if (window.WreckAvoidTune) window.WreckAvoidTune.enabled = ${OMIJANIE};
    return true;
  })()`);
  await sleep(2000);
  // Skrzydło za graczem.
  await ev(`(() => {
    const s = window.ship, a = s.angle, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    let k = 0;
    const put = (key, cnt) => { for (let i = 0; i < cnt; i++, k++) {
      const pos = at(-3500 - (k % 3) * 1400 - Math.floor(k / 9) * 900, ((k * 7) % 9 - 4) * 1000);
      window.spawnCallInShip(key, { mode: 'friendly', spawnPos: pos, pos, spawnAngle: a }); } };
    put('battleship', ${NB}); put('destroyer', ${ND}); put('frigate_laser', ${NF});
    return true;
  })()`);
  await sleep(25000);
  // Pole wraków: okręty piratów w pasie 9–14 km przed graczem, bez mózgów, zniszczone na miejscu.
  await ev(`(() => {
    const s = window.ship, a = s.angle, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    window.__wrakiPiraci = [];
    let k = 0;
    const put = (key, cnt) => { for (let i = 0; i < cnt; i++, k++) {
      const pos = at(9000 + (k % 4) * 1500, ((k * 5) % 9 - 4) * 1100);
      for (const e of [].concat(window.spawnCallInShip(key, { mode: 'pirate', spawnPos: pos, pos, spawnAngle: a + k }) || [])) { e.ai = null; window.__wrakiPiraci.push(e); } } };
    put('pirate_battleship', ${WB}); put('destroyer', ${WD}); put('frigate_pd', ${WF});
    window.__wrakiStart = { x: s.pos.x, y: s.pos.y, a };
    return true;
  })()`);
  await sleep(3000);
  wynik.pole = await ev(`(() => {
    for (const e of window.__wrakiPiraci) if (!e.dead) window.applyDamageToNPC(e, 1e9, 'test');
    return true;
  })()`);
  await sleep(4000);
  wynik.pole = await ev(`(() => {
    const W = (window.wrecks || []).filter((w) => !w.dead && w.isCollidable !== false);
    window.__wrakiPoz = new Map(W.map((w) => [w, { x: w.x, y: w.y }]));
    return { wraki: W.length, duze: W.filter((w) => (w.radius || 0) >= 150).length, rMax: Math.round(Math.max(0, ...W.map((w) => w.radius || 0))) };
  })()`);
  console.log('pole wraków', JSON.stringify(wynik.pole));
  // Gracz przeskakuje 26 km dalej — skrzydło leci przez pole.
  await ev(`(() => { const s = window.ship, a = s.angle;
    window.DevScene.teleport(s.pos.x + Math.cos(a) * 26000, s.pos.y + Math.sin(a) * 26000, a); window.DevScene.syncCamera();
    window.__wrakiStyk = { pary: new Set(), nowe: 0, czas: 0, hp0: 0, kadlub: 0, przyczyny: {}, smierci: [] };
    // Obrażenia skrzydła według przyczyny (applyDamageToNPC); reszta spadku kadłuba = sufit konstrukcji
    // (zgniot węzłów w zderzeniach).
    if (!window.__wrakiDmgHook) {
      window.__wrakiDmgHook = true;
      const orig = window.applyDamageToNPC;
      window.applyDamageToNPC = function (npc, dmg, cause = 'default', opts) {
        if (npc && npc.friendly && window.__wrakiStyk) {
          const P = window.__wrakiStyk.przyczyny;
          P[cause] = (P[cause] || 0) + (Number(dmg) || 0);
        }
        return orig.apply(this, arguments);
      };
    }
    for (const e of window.npcs) if (!e.dead && e.friendly) window.__wrakiStyk.hp0 += (e.hp || 0);
    return true; })()`);
  const PROBKA = `(() => {
    const S = window.__wrakiStyk;
    const L = window.npcs.filter((e) => !e.dead && e.friendly && !e.fighter);
    const W = (window.wrecks || []).filter((w) => !w.dead && w.isCollidable !== false);
    let teraz = 0;
    const nowe = new Set();
    for (const e of L) for (const w of W) {
      const lim = ${STYK} * ((e.radius || 100) + (w.radius || 100));
      const dx = e.x - w.x, dy = e.y - w.y;
      if (dx * dx + dy * dy < lim * lim) { teraz++; nowe.add(e.id + ':' + (w.__wid ??= Math.random())); }
    }
    for (const p of nowe) if (!S.pary.has(p)) S.nowe++;
    // Śmierć okrętu skrzydła: ostatni zapisany stan (kadłub, prędkość, najbliższy wrak).
    S.zywe = S.zywe || new Map();
    for (const e of L) {
      let best = null;
      for (const w of W) { const d = Math.hypot(e.x - w.x, e.y - w.y) - (e.radius || 0) - (w.radius || 0); if (!best || d < best.d) best = { d: Math.round(d), r: Math.round(w.radius), v: Math.round(Math.hypot(w.vx || 0, w.vy || 0)) }; }
      S.zywe.set(e, { typ: e.type, hp: Math.round(e.hp), v: Math.round(Math.hypot(e.vx, e.vy)), wrak: best, t: S.czasT || 0 });
    }
    S.czasT = (S.czasT || 0) + 0.25;
    for (const [e, st] of S.zywe) if (e.dead || !window.npcs.includes(e)) { S.smierci.push(st); S.zywe.delete(e); }
    S.pary = nowe;
    S.czas += teraz * 0.25;
    const d = window.__PH?.display || {};
    return { teraz, nowe: S.nowe, czas: S.czas, ai: d.aiTime, kl: d.frameMs, fiz: d.physicsTime };
  })()`;
  const t0 = Date.now();
  const ai = [];
  const kl = [];
  let ost = null;
  let nr = 0;
  while ((Date.now() - t0) / 1000 < CZAS) {
    await sleep(250);
    ost = await ev(PROBKA);
    if (Number.isFinite(ost.ai)) ai.push(ost.ai);
    if (Number.isFinite(ost.kl)) kl.push(ost.kl);
    if (ZRZUT && ++nr % 40 === 20) await screenshotPng(cdp, join(OUT, `pole-${String(nr).padStart(3, '0')}.png`));
  }
  // Diagnostyka: okręty daleko od gracza (utknęły w polu) — prędkość, najbliższy wrak, ogranicznik, intencja.
  wynik.utknely = await ev(`(() => {
    const s = window.ship;
    const W = (window.wrecks || []).filter((w) => !w.dead && w.isCollidable !== false);
    return window.npcs.filter((e) => !e.dead && e.friendly && !e.fighter && Math.hypot(e.x - s.pos.x, e.y - s.pos.y) > 6000).slice(0, 8).map((e) => {
      let best = null;
      for (const w of W) { const d = Math.hypot(e.x - w.x, e.y - w.y) - (e.radius || 0) - (w.radius || 0); if (!best || d < best.d) best = { d: Math.round(d), r: Math.round(w.radius), v: Math.round(Math.hypot(w.vx || 0, w.vy || 0)) }; }
      const it = e.__flightIntent || {};
      const b = e.__obsBlk || {};
      const sl = window.getBattleSlot(e);
      return { typ: e.type, v: Math.round(Math.hypot(e.vx, e.vy)), odGracza: Math.round(Math.hypot(e.x - s.pos.x, e.y - s.pos.y)), wrak: best,
        cap: Number.isFinite(e.__obsCapVal) ? Math.round(e.__obsCapVal) : 'inf', blk: b.on ? { along: Math.round(b.along), c: Math.round(b.c) } : null,
        cel: Math.round(Math.hypot(it.x - e.x, it.y - e.y)), tryb: it.mode, capInt: Number.isFinite(it.approachCap) ? Math.round(it.approachCap) : 'inf',
        slot: sl ? [sl.kind, Math.round(Math.hypot(sl.cx - e.x, sl.cy - e.y))] : null, hp: Math.round(e.hp), sep: [Math.round(it.sepAx || 0), Math.round(it.sepAy || 0)] };
    });
  })()`);
  console.log('utknęły', JSON.stringify(wynik.utknely, null, 0));
  wynik.omijanie = OMIJANIE;
  wynik.koniec = await ev(`(() => {
    const S = window.__wrakiStyk;
    let hp = 0; let zywe = 0;
    for (const e of window.npcs) if (!e.dead && e.friendly) { hp += (e.hp || 0); zywe++; }
    let ruch = 0; let ruchMax = 0; let n = 0;
    for (const [w, p] of window.__wrakiPoz) { if (w.dead) continue; const d = Math.hypot(w.x - p.x, w.y - p.y); ruch += d; ruchMax = Math.max(ruchMax, d); n++; }
    const s = window.ship, st = window.__wrakiStart;
    const dalej = window.npcs.filter((e) => !e.dead && e.friendly && !e.fighter).map((e) => Math.hypot(e.x - s.pos.x, e.y - s.pos.y));
    dalej.sort((a, b) => a - b);
    const martwe = window.npcs.filter((e) => e.dead && e.friendly).map((e) => e.type);
    return { przyczyny: Object.fromEntries(Object.entries(S.przyczyny).map(([k, v]) => [k, Math.round(v)])), smierci: S.smierci, nowychZetkniec: S.nowe, czasWStyku_s: Math.round(S.czas), utraconyKadlub: Math.round(S.hp0 - hp), zyweSkrzydlo: zywe,
      przesuniecieWrakow_sr: Math.round(n ? ruch / n : 0), przesuniecieWrakow_max: Math.round(ruchMax),
      odGracza_mediana: Math.round(dalej[dalej.length >> 1] || 0), odGracza_max: Math.round(dalej[dalej.length - 1] || 0) };
  })()`);
  const sr = (a) => a.length ? +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(3) : null;
  wynik.perf = { aiMs: sr(ai), klatkaMs: sr(kl) };
  console.log('wynik', JSON.stringify(wynik.koniec), JSON.stringify(wynik.perf));
} finally {
  writeFileSync(join(OUT, 'wynik.json'), JSON.stringify(wynik, null, 1));
  console.log('wyniki:', OUT);
  const errs = logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys/.test(l));
  if (errs.length) console.log('błędy:', errs.slice(0, 10));
  await chrome.close();
  await server.close();
}
