// Rakiety na auto i malowanie celów w PRAWDZIWEJ grze (2026-10-04, src/game/fireControl.js —
// fcPlanMissileSalvo; index.html — fcPaintStep): Vite + headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/rakiety-auto-gra.mjs [--faza counter] [--czas 40] [--out .tmp/rakiety-auto]
//
// 1) Gracz nic nie robi: rakiety na auto same wybierają cele (dziennik salw: wyrzutnia, cele, rakiety
//    na cel, potrzeba celu), co kilka sekund próbka (wrogowie, amunicja, obrażenia rakiet w locie).
// 2) T trzymane + kursor po trzech wrogach na ekranie: ile celów priorytetowych przybyło.
// Wynik: <out>/*.png i <out>/raport.json (dziennik salw, próbki, malowanie, błędy konsoli).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/rakiety-auto');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5374));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { probki: [], salwy: [], malowanie: null, bledy: [] };

const keyT = (type) => cdp.send('Input.dispatchKeyEvent', { type, key: 't', code: 'KeyT', windowsVirtualKeyCode: 84, nativeVirtualKeyCode: 84 });
const mouse = (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });

const sample = () => ev(`(() => {
  const s = window.ship, fc = window.fireControl;
  const hostile = (window.npcs || []).filter((n) => window.isHostileNpc(n));
  const inc = window.rocketSystem3D ? window.rocketSystem3D.collectIncoming(new Map(), false) : new Map();
  let wLocie = 0;
  for (const v of inc.values()) wLocie += v;
  const ammo = (window.Game.player.weapons?.missile || []).map((lo) => lo.weapon.id + ':' + lo.hp.ammo + (lo.hp.missileCd > 0 ? ' (' + lo.hp.missileCd.toFixed(1) + ' s)' : ''));
  return {
    faza: window.StoryGame.phase, wrogowie: hostile.length, kandydaci: fc.candidateCount, postawa: fc.posture,
    celeRakiet: inc.size, obrazeniaWLocie: Math.round(wLocie), rakietyAktywne: window.rocketSystem3D?.activeRockets ?? null,
    amunicja: ammo, tarcza: Math.round(s.shield.val), kadlub: Math.round(s.hull.val)
  };
})()`);

async function shot(name, data) {
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.probki.push({ name, ...data });
  console.log(name.padEnd(22), JSON.stringify(data));
}

try {
  const faza = args.faza || 'counter';
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=${faza}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.StoryGame.active && !!window.StoryGame.phase', 300000, 400)) throw new Error('fabuła nie ruszyła');
  // Dziennik salw: opakowanie wyrzutu z kierowania ogniem (cele liczone PRZED strzałem — plan jest potem czyszczony).
  await ev(`(() => {
    const env = window.__fcEnv, orig = env.fireMissileSalvo;
    window.__salvoLog = [];
    env.fireMissileSalvo = (lo, targets, count) => {
      const per = new Map();
      for (let i = 0; i < count; i++) per.set(targets[i], (per.get(targets[i]) || 0) + 1);
      const s = window.ship;
      const rec = {
        t: +performance.now().toFixed(0), bron: lo.weapon.id, rakiet: count,
        cele: [...per].map(([e, n]) => ({ typ: e?.type || e?.shipFrame || '?', rakiet: n,
          potrzeba: Math.round((Number(e?.shield?.val) || 0) + (Number(e?.hp) || 0)),
          dystans: Math.round(Math.hypot(e.x - s.pos.x, e.y - s.pos.y)) }))
      };
      const ok = orig(lo, targets, count);
      rec.ok = ok;
      window.__salvoLog.push(rec);
      return ok;
    };
    return true;
  })()`);
  await mouse(W / 2, H / 2 - 200);
  const czas = Number(args.czas || 40);
  await shot('auto-00', await sample());
  for (let t = 5; t <= czas; t += 5) {
    await sleep(5000);
    await shot(`auto-${String(t).padStart(2, '0')}`, await sample());
  }
  report.salwy = await ev('window.__salvoLog.slice()');
  for (const s of report.salwy) console.log('salwa', s.bron.padEnd(16), s.rakiet, JSON.stringify(s.cele));

  // Malowanie: T trzymane, kursor przez trzech wrogów. Kamera misji trzyma zoom, więc po pomiarze salw
  // trzech najbliższych piratów przestawiamy w kadr (pozycja encji i lustro pos).
  const picks = await ev(`(() => {
    const s = window.ship;
    const list = (window.npcs || []).filter((n) => window.isHostileNpc(n))
      .sort((a, b) => Math.hypot(a.x - s.pos.x, a.y - s.pos.y) - Math.hypot(b.x - s.pos.x, b.y - s.pos.y)).slice(0, 3);
    const spots = [[0.3, 0.25], [0.7, 0.3], [0.5, 0.78]];
    window.__paintPicks = list;
    window.fireControl.posture = 'hold';   // działa Atlasa rozbierałyby przestawionych piratów od razu
    return list.map((n, i) => {
      const w = window.screenToWorld(${W} * spots[i][0], ${H} * spots[i][1]);
      n.x = w.x; n.y = w.y; n.vx = 0; n.vy = 0;
      if (n.pos) { n.pos.x = w.x; n.pos.y = w.y; }
      if (n.vel) { n.vel.x = 0; n.vel.y = 0; }
      return i;
    });
  })()`);
  await sleep(600);
  const before = await ev('window.getPlayerLockedTargets().length');
  if (picks.length) {
    await mouse(W - 20, 20);   // start w pustce: T zdejmuje cele, trzymanie maluje
    await sleep(200);
    await keyT('keyDown');
    await sleep(150);
    report.malowanieStart = await ev(`(() => ({ paint: { ...window.__fcPaint, skip: !!window.__fcPaint.skip }, blokada: !!window.StoryGame.blocksInput, stacja: !!window.stationUI?.open }))()`);
    console.log('malowanie start:', JSON.stringify(report.malowanieStart));
    // Kursor jedzie do BIEŻĄCEJ pozycji każdego pirata (lecą ~1000 j/s — w kadrze ~180 px/s).
    const at = (i) => ev(`(() => { const n = window.__paintPicks[${i}]; const p = window.worldToScreen(n.x, n.y, window.camera); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
    let cx = W - 20, cy = 20;
    for (const i of picks) {
      for (let k = 1; k <= 6; k++) {
        const p = await at(i);
        cx += (p.x - cx) * k / 6;
        cy += (p.y - cy) * k / 6;
        await mouse(Math.round(cx), Math.round(cy));
        await sleep(30);
      }
      const p = await at(i);
      cx = p.x; cy = p.y;
      await mouse(cx, cy);
      await sleep(120);
      const dbg = await ev(`(() => { const n = window.__paintPicks[${i}]; const t = window.__fcTargetNearCursor(); return { cele: window.getPlayerLockedTargets().length, paint: window.__fcPaint.active, zywy: !n.dead && n.hp > 0, wrogi: window.isHostileNpc(n), podKursorem: t === n, ukryty: !!window.SensorSystem?.hides?.(n) }; })()`);
      console.log('malowanie krok:', JSON.stringify(dbg));
    }
    await keyT('keyUp');
    await sleep(300);
  }
  const after = await ev('window.getPlayerLockedTargets().length');
  report.malowanie = { naEkranie: picks.length, przed: before, po: after };
  console.log('malowanie:', JSON.stringify(report.malowanie));
  await shot('malowanie', await sample());
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-60);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
