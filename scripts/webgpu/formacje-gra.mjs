// Formacje skrzydła w prawdziwej grze (2026-10-08): skrzydło Terra Novy przy graczu, po kolei każda formacja
// (CockpitSupport.setFormation) przez --czas s — zrzut z góry i pomiar, ile okrętów stoi na swoim miejscu; potem panel
// Skrzydło na Alt (przyciski formacji) i walka: piraci ~13 km przed graczem, LINIA w ESKORCIE i w ATAKU.
//   node scripts/webgpu/formacje-gra.mjs [--sklad 4,6,15] [--formacje groups,line,wedge,column,crescent,ring]
//        [--czas 30] [--zoom 0.045] [--walka 1] [--out katalog] [--port 5294] [--seed 7]
// Wynik: zrzuty <out>/NN-formacja.png, panel-alt.png, walka-*.png i wyniki.json (odległość okrętów od miejsc).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startVite, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';
import { startChrome, screenshotPng } from './wspolne.mjs';

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const [NB, ND, NF] = String(arg('sklad', '4,6,15')).split(',').map(Number);
const FORMACJE = String(arg('formacje', 'groups,line,wedge,column,crescent,ring')).split(',').filter(Boolean);
const CZAS = Number(arg('czas', 30));
const ZOOM = Number(arg('zoom', 0.045));
const WALKA = arg('walka', '1') === '1';
const PORT = Number(arg('port', 5294));
const SEED = Number(arg('seed', 7));
const OUT = arg('out', join(tmpdir(), 'formacje-gra'));
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
const wyniki = { sklad: [NB, ND, NF], formacje: [], walka: [] };

// Odległość okrętów skrzydła od ich miejsc w szyku (getBattleSlot — położenie „teraz”).
const POMIAR = `(() => {
  const L = (window.npcs || []).filter((e) => !e.dead && e.friendly === true && !e.fighter);
  const d = [];
  let brak = 0;
  for (const e of L) { const s = window.getBattleSlot(e); if (!s || s.kind === 'flank') { brak++; continue; } d.push(Math.hypot(e.x - s.cx, e.y - s.cy)); }
  d.sort((a, b) => a - b);
  const q = (p) => d.length ? Math.round(d[Math.min(d.length - 1, Math.floor(p * d.length))]) : null;
  const st = window.getFleetPhase('friendly');
  return { n: L.length, bezMiejsca: brak, mediana: q(0.5), p90: q(0.9), max: q(1), naMiejscu: d.filter((x) => x < 600).length,
    faza: st?.phase, formacja: st?.shape };
})()`;

try {
  await navigateAndWait(cdp, `${base}/index.html?dev=1`,
    '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  for (let t0 = Date.now(); Date.now() - t0 < 240000;) {
    await sleep(250);
    try { if (await ev('(window.__frameId || 0) > 30 && !!window.camera')) break; } catch { /* ładuje się */ }
  }
  // Pusta przestrzeń między Wenus a Ziemią, gracz nieśmiertelny, kamera z góry z dużym oddaleniem.
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
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = ${ZOOM};
    return true;
  })()`);
  await sleep(2000);
  // Skrzydło rozrzucone za graczem (dziób gracza w górę ekranu).
  wyniki.spawn = await ev(`(() => {
    const s = window.ship, a = s.angle, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    let k = 0;
    const put = (key, cnt) => { for (let i = 0; i < cnt; i++, k++) {
      const pos = at(-4000 - (k % 3) * 1500 - Math.floor(k / 9) * 900, ((k * 7) % 9 - 4) * 1100);
      window.spawnCallInShip(key, { mode: 'friendly', spawnPos: pos, pos, spawnAngle: a }); } };
    put('battleship', ${NB}); put('destroyer', ${ND}); put('frigate_laser', ${NF});
    return (window.npcs || []).filter((e) => !e.dead && e.friendly).length;
  })()`);
  console.log('skrzydło', wyniki.spawn);

  let nr = 0;
  for (const id of FORMACJE) {
    await ev(`window.CockpitSupport.setFormation('${id}')`);
    await sleep(CZAS * 1000);
    const m = await ev(POMIAR);
    const plik = join(OUT, `${String(++nr).padStart(2, '0')}-${id}.png`);
    await ev(`(() => { const cam = window.camera; cam.zoom = cam.targetZoom = ${ZOOM}; return true; })()`);
    await sleep(400);
    await screenshotPng(cdp, plik);
    wyniki.formacje.push({ id, ...m, plik });
    console.log(id.padEnd(9), JSON.stringify(m));
  }

  // Panel Skrzydło na Alt: przyciski formacji.
  await ev(`window.CockpitSupport.setFormation('line')`);
  await ev(`window.CockpitUI.setPointerMode(true)`);
  await sleep(800);
  await screenshotPng(cdp, join(OUT, 'panel-alt.png'));
  wyniki.panel = await ev(`(() => { const r = window.CockpitUI.shadow.getElementById('wingFormations'); const b = r?.getBoundingClientRect();
    const btn = [...(r?.querySelectorAll('[data-formation]') || [])].map((x) => ({ id: x.dataset.formation, active: x.classList.contains('active'), w: Math.round(x.getBoundingClientRect().width) }));
    return { rect: b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : null, btn,
      naglowek: window.CockpitUI.shadow.getElementById('wingOrder')?.textContent }; })()`);
  console.log('panel', JSON.stringify(wyniki.panel));
  await ev(`window.CockpitUI.setPointerMode(false)`);

  if (WALKA) {
    await sleep(CZAS * 1000);
    // Piraci ~13 km przed graczem i w bok — stoją (bez mózgów), żeby było widać sam szyk.
    await ev(`(() => {
      const s = window.ship, a = s.angle, c = Math.cos(a), n = Math.sin(a);
      const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
      for (let i = 0; i < 3; i++) for (const r of [].concat(window.spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(13000, -3000 + i * 1800), pos: at(13000, -3000 + i * 1800), spawnAngle: a + Math.PI }) || [])) { r.ai = null; r.__staticForTest = true; }
      return true;
    })()`);
    for (const order of ['guard', 'engage']) {
      await ev(`window.CockpitSupport.setOrder('${order}')`);
      await sleep(14000);
      const m = await ev(POMIAR);
      await screenshotPng(cdp, join(OUT, `walka-${order}.png`));
      wyniki.walka.push({ order, ...m });
      console.log('walka', order, JSON.stringify(m));
    }
  }
} finally {
  writeFileSync(join(OUT, 'wyniki.json'), JSON.stringify(wyniki, null, 1));
  console.log('wyniki:', OUT);
  const errs = logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys/.test(l));
  if (errs.length) console.log('błędy:', errs.slice(0, 10));
  await chrome.close();
  await server.close();
}
