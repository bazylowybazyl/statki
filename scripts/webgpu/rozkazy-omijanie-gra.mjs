// Rozkazy RTS omijają przeszkody w prawdziwej grze (2026-10-08, src/ai/npcCommandPilot.js) — na wzór
// scripts/webgpu/wraki-omijanie-gra.mjs, ale z ROZKAZEM RUCHU zamiast szyku: skrzydło Terra Novy zbiera
// się za graczem, przed nim w pasie 9–14 km powstaje pole wraków (okręty piratów zniszczone na miejscu),
// skrzydło dostaje rozkaz ruchu 26 km naprzód (ustawienie jak w grze: --szyk ciasny = PPM bez
// przeciągania, formationTargets; luzny = z przeciągnięciem kursu, computeFormationTargets) — leci obok
// gracza i przez pole. Co 0,25 s: zetknięcia okręt × wrak (środki bliżej niż --styk × suma promieni),
// styki kadłubów (HullBodies.hasContact) okręt × wrak, okręt × okręt i okręt × gracz, utracony kadłub,
// zgony, przepchnięcie wraków, ile rozkazów dobiegło końca, czas AI. A/B: --omijanie 0 = dawny pilot
// rozkazów (window.CommandAvoidTune.enabled = false).
//   node scripts/webgpu/rozkazy-omijanie-gra.mjs [--sklad 4,6,15] [--wraki 4,4,8] [--szyk ciasny|luzny]
//        [--czas 70] [--styk 0.75] [--omijanie 1] [--zrzut 1] [--out katalog] [--port 5295] [--seed 7]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startVite, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';
import { startChrome, screenshotPng } from './wspolne.mjs';

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const [NB, ND, NF] = String(arg('sklad', '4,6,15')).split(',').map(Number);
const [WB, WD, WF] = String(arg('wraki', '4,4,8')).split(',').map(Number);
const SZYK = arg('szyk', 'ciasny');
const CZAS = Number(arg('czas', 70));
const STYK = Number(arg('styk', 0.75));
const ZRZUT = arg('zrzut', '1') === '1';
const PORT = Number(arg('port', 5295));
const SEED = Number(arg('seed', 7));
const OMIJANIE = arg('omijanie', '1') !== '0';
const OUT = arg('out', join(tmpdir(), 'rozkazy-omijanie-gra'));
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
const wynik = { sklad: [NB, ND, NF], wraki: [WB, WD, WF], szyk: SZYK, styk: STYK, omijanie: OMIJANIE };

try {
  await navigateAndWait(cdp, `${base}/index.html?dev=1`,
    '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  for (let t0 = Date.now(); Date.now() - t0 < 240000;) {
    await sleep(250);
    try { if (await ev('(window.__frameId || 0) > 30 && !!window.camera')) break; } catch { /* ładuje się */ }
  }
  await ev(`(async () => { const m = await import('/src/ui/perfHud.js'); window.__PH = m.PerfHUD; if (!m.PerfHUD.visible) m.PerfHUD.toggle(); return true; })()`);
  // Pusta przestrzeń między orbitami Wenus i Ziemi (jak wraki-omijanie-gra.mjs).
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
    window.CockpitSupport.setFormation('groups');
    if (window.CommandAvoidTune) window.CommandAvoidTune.enabled = ${OMIJANIE};
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
  await sleep(20000);
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
    return true;
  })()`);
  await sleep(3000);
  await ev(`(() => { for (const e of window.__wrakiPiraci) if (!e.dead) window.applyDamageToNPC(e, 1e9, 'test'); return true; })()`);
  await sleep(4000);
  wynik.pole = await ev(`(() => {
    const W = (window.wrecks || []).filter((w) => !w.dead && w.isCollidable !== false);
    window.__wrakiPoz = new Map(W.map((w) => [w, { x: w.x, y: w.y }]));
    return { wraki: W.length, duze: W.filter((w) => (w.radius || 0) >= 150).length, rMax: Math.round(Math.max(0, ...W.map((w) => w.radius || 0))) };
  })()`);
  console.log('pole wraków', JSON.stringify(wynik.pole));
  // Rozkaz ruchu RTS 26 km naprzód — skrzydło mija gracza i leci przez pole.
  wynik.rozkaz = await ev(`(async () => {
    const s = window.ship, a = s.angle;
    const P = { x: s.pos.x + Math.cos(a) * 26000, y: s.pos.y + Math.sin(a) * 26000 };
    const units = window.npcs.filter((e) => !e.dead && e.friendly && !e.fighter);
    const targets = new Map();
    if ('${SZYK}' === 'luzny') {
      const m = await import('/src/game/worldCommandMenu.js');
      for (const [u, t] of m.computeFormationTargets(units, P, a)) targets.set(u, t);
    } else {
      // formationTargets z index.html (PPM bez przeciągania): rzędy wg klasy, odstępy 150 / 200 / 230 j.
      const right = { x: -Math.sin(a), y: Math.cos(a) }, fwd = { x: Math.cos(a), y: Math.sin(a) };
      const cat = (u) => /battleship|carrier/.test(u.type) ? 'b' : (/destroyer/.test(u.type) ? 'd' : 'f');
      let depth = 0;
      for (const [k, sp] of [['f', 150], ['d', 200], ['b', 230]]) {
        const L = units.filter((u) => cat(u) === k).sort((p, q) => String(p.id || '').localeCompare(String(q.id || '')));
        if (!L.length) continue;
        const w = (L.length - 1) * sp;
        L.forEach((u, i) => targets.set(u, { x: P.x + fwd.x * depth - right.x * w / 2 + right.x * i * sp, y: P.y + fwd.y * depth - right.y * w / 2 + right.y * i * sp }));
        depth += sp * 0.9;
      }
    }
    window.__rozkazy = new Map();
    for (const u of units) {
      const t = targets.get(u) || P;
      const cmd = { type: 'move', target: { x: t.x, y: t.y }, arrival: (u.radius || u.w || 30) + 25 };
      if (Number.isFinite(t.faceAngle)) cmd.faceAngle = t.faceAngle;
      u.command = cmd;
      u.forceTarget = null;
      window.__rozkazy.set(u, cmd.target);
    }
    window.__rStyk = { pary: new Set(), nowe: 0, czas: 0, hp0: 0, kontaktWrak: new Set(), kontaktOkret: new Set(), kontaktGracz: new Set(), czasKadlub: 0, smierci: [] };
    for (const e of units) window.__rStyk.hp0 += (e.hp || 0);
    return { okrety: units.length, cel: { x: Math.round(P.x), y: Math.round(P.y) } };
  })()`);
  const PROBKA = `(() => {
    const S = window.__rStyk, HB = window.HullBodies, ship = window.ship;
    const L = window.npcs.filter((e) => !e.dead && e.friendly && !e.fighter);
    const W = (window.wrecks || []).filter((w) => !w.dead && w.isCollidable !== false);
    const touch = (a, b) => HB.hasContact(a, b) || HB.hasContact(b, a);
    let teraz = 0; let kadlub = 0;
    const nowe = new Set();
    for (const e of L) for (const w of W) {
      const lim = ${STYK} * ((e.radius || 100) + (w.radius || 100));
      const dx = e.x - w.x, dy = e.y - w.y;
      if (dx * dx + dy * dy < lim * lim) { teraz++; nowe.add(e.id + ':' + (w.__wid ??= Math.random())); }
      if (touch(e, w)) { S.kontaktWrak.add(e.id + ':' + (w.__wid ??= Math.random())); kadlub++; }
    }
    for (let i = 0; i < L.length; i++) {
      for (let j = i + 1; j < L.length; j++) if (touch(L[i], L[j])) { S.kontaktOkret.add(L[i].id + ':' + L[j].id); kadlub++; }
      if (ship && touch(L[i], ship)) { S.kontaktGracz.add(L[i].id); kadlub++; }
    }
    for (const p of nowe) if (!S.pary.has(p)) S.nowe++;
    S.pary = nowe;
    S.czas += teraz * 0.25;
    S.czasKadlub += kadlub * 0.25;
    S.zywe = S.zywe || new Map();
    for (const e of L) S.zywe.set(e, { typ: e.type, hp: Math.round(e.hp) });
    for (const [e, st] of S.zywe) if (e.dead || !window.npcs.includes(e)) { S.smierci.push(st); S.zywe.delete(e); }
    let hold = 0;
    for (const e of L) if (e.command && e.command.type === 'hold') hold++;
    const d = window.__PH?.display || {};
    return { teraz, nowe: S.nowe, hold, ai: d.aiTime, kl: d.frameMs };
  })()`;
  const t0 = Date.now();
  const ai = [];
  const kl = [];
  let nr = 0;
  while ((Date.now() - t0) / 1000 < CZAS) {
    await sleep(250);
    const o = await ev(PROBKA);
    if (Number.isFinite(o.ai)) ai.push(o.ai);
    if (Number.isFinite(o.kl)) kl.push(o.kl);
    if (ZRZUT && ++nr % 40 === 20) await screenshotPng(cdp, join(OUT, `rts-${OMIJANIE ? 'omij' : 'bez'}-${String(nr).padStart(3, '0')}.png`));
  }
  wynik.koniec = await ev(`(() => {
    const S = window.__rStyk;
    let hp = 0; let zywe = 0;
    const L = window.npcs.filter((e) => !e.dead && e.friendly && !e.fighter);
    for (const e of L) { hp += (e.hp || 0); zywe++; }
    let ruch = 0; let ruchMax = 0; let n = 0;
    for (const [w, p] of window.__wrakiPoz) { if (w.dead) continue; const d = Math.hypot(w.x - p.x, w.y - p.y); ruch += d; ruchMax = Math.max(ruchMax, d); n++; }
    // Okręty, które nie dobiegły: odległość od punktu rozkazu, rodzaj rozkazu.
    const dal = [];
    let hold = 0;
    for (const e of L) {
      const t = window.__rozkazy.get(e);
      if (e.command?.type === 'hold') hold++;
      else if (t) {
        // Co go trzyma: stan omijania (npcCommandPilot.js), najbliższy okręt i wrak.
        const st = e.__cmdSteer || {};
        let ok = null;
        for (const o of window.npcs) { if (o === e || o.dead || o.fighter) continue; const d = Math.hypot(o.x - e.x, o.y - e.y); if (!ok || d < ok.d) ok = { d: Math.round(d), typ: o.type, cmd: o.command?.type || null, v: Math.round(Math.hypot(o.vx, o.vy)) }; }
        let wr = null;
        for (const w of (window.wrecks || [])) { if (w.dead) continue; const d = Math.hypot(w.x - e.x, w.y - e.y) - (w.radius || 0); if (!wr || d < wr.d) wr = { d: Math.round(d), r: Math.round(w.radius) }; }
        dal.push({ typ: e.type, cmd: e.command?.type || null, doCelu: Math.round(Math.hypot(e.x - t.x, e.y - t.y)), v: Math.round(Math.hypot(e.vx, e.vy)),
          omijanie: { objazd: st.detour, blok: st.blocked, blokT: +(st.blockedT || 0).toFixed(2), cap: Number.isFinite(st.approachCap) ? Math.round(st.approachCap) : 'inf' }, okret: ok, wrak: wr });
      }
    }
    return { zetknieciaWrak_srodki: S.nowe, czasWStyku_s: Math.round(S.czas), stykiKadlubow: { wrak: S.kontaktWrak.size, okret: S.kontaktOkret.size, gracz: S.kontaktGracz.size, czas_s: Math.round(S.czasKadlub) },
      utraconyKadlub: Math.round(S.hp0 - hp), zyweSkrzydlo: zywe, smierci: S.smierci, rozkazWykonany: hold + '/' + zywe,
      przesuniecieWrakow_sr: Math.round(n ? ruch / n : 0), przesuniecieWrakow_max: Math.round(ruchMax), wDrodze: dal.slice(0, 8) };
  })()`);
  const sr = (a) => a.length ? +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(3) : null;
  wynik.perf = { aiMs: sr(ai), klatkaMs: sr(kl) };
  console.log('wynik', JSON.stringify(wynik.koniec), JSON.stringify(wynik.perf));
} finally {
  writeFileSync(join(OUT, `wynik-${OMIJANIE ? 'omij' : 'bez'}-${SZYK}-${SEED}.json`), JSON.stringify(wynik, null, 1));
  console.log('wyniki:', OUT);
  const errs = logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys/.test(l));
  if (errs.length) console.log('błędy:', errs.slice(0, 10));
  await chrome.close();
  await server.close();
}
