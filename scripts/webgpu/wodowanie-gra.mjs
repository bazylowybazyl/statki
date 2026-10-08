// Misja 1 w PRAWDZIWEJ grze (2026-10-07): zegar wodowania i herszt — Vite + headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/wodowanie-gra.mjs [--czas 150] [--zoom 0.055] [--out .tmp/wodowanie] [--rozmiar 1600x900]
//
// Skok dev ?story=defences (alarm po taranie, trzy okręty parkingu zmiażdżone), kamera RTS nad parkingiem.
// Co sekundę: stan każdego okrętu parkingu i pochylni (w stanowisku / przy działach / wystartował — odległość od
// stanowiska, strona ogrodzenia), bramy stanowisk wyrwane, cel misji, baner, podpowiedź, mostek herszta.
// Po pierwszym starcie z parkingu: herszt do 60% punktów (przyspiesza starty), potem do 30% (ucieczka i skok).
// Atlas trzymany przy życiu (tarcza i kadłub doładowywane) — sprawdzamy misję, nie przeżycie.
// Wynik: <out>/*.png, <out>/raport.json (próbki, zdarzenia, błędy konsoli).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/wodowanie');
const czas = Number(args.czas || 150);
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5374));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { probki: [], zdarzenia: [], bledy: [] };

const SAMPLE = `(() => {
  const S = window.StoryGame, site = S.site, dock = site?.dock;
  const hub = (e) => { const p = e.pos || e; return dock ? dock.toHub(p.x, p.y) : { x: 0, z: 0 }; };
  const fenceZ = dock ? dock.layout.parking.z1 : 0;
  const one = (e) => {
    if (!e) return null;
    const h = hub(e);
    const st = e.dead || !(e.hp > 0) ? 'zniszczony' : e.__storyLaunched ? 'wystartował' : (e.ai && !e.combatDisabled ? 'przy działach' : 'w stanowisku');
    return { st, za_ogrodzeniem: Math.round(h.z - fenceZ), v: Math.round(Math.hypot(e.vx || e.vel?.x || 0, e.vy || e.vel?.y || 0)), hp: +(e.hp / (e.maxHp || 1)).toFixed(2) };
  };
  const boss = site?.flagship;
  const bridge = S.ui.markers.get('bridge');
  const bp = boss ? (boss.pos || boss) : null;
  return {
    t: +S.runner.time.toFixed(1), faza: S.phase,
    cel: S.ui.objective ? S.ui.objective.text + (S.ui.objective.progress ? ' [' + S.ui.objective.progress() + ']' : '') : null,
    baner: S.ui.banner?.text || null, podpowiedz: S.ui.hint?.spec?.title || null,
    parking: (site?.parkedList || []).map(one), pochylnie: (site?.slipList || []).map(one),
    eskorta: (site?.defenderList || []).filter((e) => e !== boss && !e.dead).length,
    herszt: boss ? { ...one(boss), uciekl: !!boss.warpedOut, skok: !!boss.__warpReturn, mostek: bridge ? Math.round(Math.hypot(bridge.x - bp.x, bridge.y - bp.y)) : null } : null,
    bramy: (window.__dockBroken?.() || []).filter((id) => /^B-/.test(id)),
    cele: S.ui.targets.size,
    atlas: { tarcza: Math.round(window.ship.shield?.val || 0), kadlub: +(window.HullBodies?.structuralState?.(window.ship)?.ratio ?? 1).toFixed(2) }
  };
})()`;

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=defences` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && window.StoryGame.active && window.StoryGame.phase === 'defences'", 300000, 400)) throw new Error('brak fazy defences');
  // Atlas przy życiu; kawałki doku odpadłe — z modułu doku (bramy stanowisk przy starcie)
  await ev(`(() => {
    window.__dockBroken = () => (window.StoryGame.site?.station?._dockGone ? [...window.StoryGame.site.station._dockGone] : []);
    setInterval(() => { const s = window.ship; if (s?.shield) s.shield.val = s.shield.max; if (s && s.maxHp) s.hp = s.maxHp; }, 250);
    return true;
  })()`);
  // kamera RTS nad parkingiem (tor taranu), bez HUD-u kokpitu
  const zoom = Number(args.zoom || 0.055);
  await ev(`(() => {
    const site = window.StoryGame.site, c = window.camera, d = site.dock;
    const p = d.toGame(0, d.layout.parking.z1 - 600);
    if (c.mode !== 'rts' && typeof window.enterRtsMode === 'function') window.enterRtsMode();
    c.x = c.targetX = p.x; c.y = c.targetY = p.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
    return true;
  })()`);
  const t0 = Date.now();
  let n = 0;
  let rushed = false;
  let fled = false;
  let lastLaunched = 0;
  while ((Date.now() - t0) / 1000 < czas) {
    await sleep(1000);
    const p = await ev(SAMPLE);
    report.probki.push(p);
    const launched = p.parking.filter((x) => x?.st === 'wystartował').length + p.pochylnie.filter((x) => x?.st === 'wystartował').length;
    if (launched > lastLaunched) {
      report.zdarzenia.push({ t: p.t, co: `start #${launched}`, baner: p.baner });
      await screenshotPng(cdp, join(out, `start-${launched}-t${Math.round(p.t)}.png`));
      lastLaunched = launched;
    }
    if (n % 10 === 0) { console.log(JSON.stringify({ t: p.t, cel: p.cel, baner: p.baner, bramy: p.bramy, herszt: p.herszt })); await screenshotPng(cdp, join(out, `t${String(Math.round(p.t)).padStart(3, '0')}.png`)); }
    // herszt: po pierwszym starcie — 60% (przyspieszenie), 6 s później 30% (ucieczka)
    if (!rushed && launched >= 1 && p.herszt) {
      rushed = true;
      await ev(`(() => { const b = window.StoryGame.site.flagship; b.hp = b.maxHp * 0.6; return true; })()`);
      report.zdarzenia.push({ t: p.t, co: 'herszt 60%' });
    } else if (rushed && !fled && p.herszt && report.zdarzenia.find((z) => z.co === 'herszt 60%').t + 6 <= p.t) {
      fled = true;
      await ev(`(() => { const b = window.StoryGame.site.flagship; b.hp = b.maxHp * 0.3; return true; })()`);
      report.zdarzenia.push({ t: p.t, co: 'herszt 30%' });
      await sleep(1500);
      // kadr na hersztu z mostkiem
      await ev(`(() => { const b = window.StoryGame.site.flagship, c = window.camera, q = b.pos || b; c.x = c.targetX = q.x; c.y = c.targetY = q.y; c.zoom = c.targetZoom = c.zoomBase = 0.18; return true; })()`);
      await sleep(800);
      await screenshotPng(cdp, join(out, 'herszt-ucieka-mostek.png'));
      report.zdarzenia.push({ co: 'herszt — stan', ...(await ev(SAMPLE)).herszt });
      await ev(`(() => { const site = window.StoryGame.site, c = window.camera, d = site.dock; const q = d.toGame(0, d.layout.parking.z1 - 600); c.x = c.targetX = q.x; c.y = c.targetY = q.y; c.zoom = c.targetZoom = c.zoomBase = ${zoom}; return true; })()`);
    }
    if (p.herszt?.uciekl && !report.zdarzenia.some((z) => z.co === 'herszt uciekł')) report.zdarzenia.push({ t: p.t, co: 'herszt uciekł', baner: p.baner });
    n++;
  }
  await screenshotPng(cdp, join(out, 'koniec.png'));
  report.koniec = await ev(SAMPLE);
  report.bledy = logs.errors().slice(0, 80);
  console.log('zdarzenia:', JSON.stringify(report.zdarzenia, null, 1));
  console.log('koniec:', JSON.stringify(report.koniec));
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-80);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
