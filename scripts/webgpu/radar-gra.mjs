// Radar taktyczny kokpitu w PRAWDZIWEJ grze (przebudowa 2026-10-07: src/ui/radar/ — tarcza PPI dziobem do góry,
// ślady ARPA, podkład terenu; skan X w świecie — scanOverlay.js). Vite + headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/radar-gra.mjs [--out .tmp/radar/gra] [--rozmiar 1600x900] [--sceny ziemia,pas,dok]
//
// Sceny: ziemia — start gry swobodnej (port Ziemi, ring, K-7) + piraci przed dziobem; pas — teleport do rdzenia
// pola pasa głównego; dok — misja 1, faza `defences` (suchy dok piratów). Każda: kopuła, Alt (pełny radar,
// kursor nad śladem), impuls X (fala, ramki i podpisy w świecie). Raport: czasy tarczy i zbieracza, ślady, błędy.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/radar/gra');
mkdirSync(out, { recursive: true });
const sceny = (args.sceny || 'ziemia,pas').split(',');

const report = { sceny: {}, bledy: [] };

async function key(cdp, code, keyName, type) {
  const vk = code === 'AltLeft' ? 18 : keyName.length === 1 ? keyName.toUpperCase().charCodeAt(0) : 0;
  await cdp.send('Input.dispatchKeyEvent', { type, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}
async function tap(cdp, code, keyName) {
  await key(cdp, code, keyName, 'keyDown');
  await sleep(60);
  await key(cdp, code, keyName, 'keyUp');
}

async function runScene(scene) {
  const { server, base } = await startVite(Number(args.port || 5385));
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 120000) => evaluate(cdp, e, t);
  const shot = async (name, clip = null) => {
    const params = { format: 'png', captureBeyondViewport: false };
    if (clip) params.clip = { ...clip, scale: 1 };
    const { data } = await cdp.send('Page.captureScreenshot', params);
    writeFileSync(join(out, `${scene}-${name}.png`), Buffer.from(data, 'base64'));
    console.log(scene, 'zrzut', name);
  };
  const state = () => ev(`(() => {
    const c = window.cockpitUI, r = c?.radar, f = c?.radarModel;
    return {
      zasieg: r?.range, orient: r?.orient, tarczaMs: +(r?.stats.drawMs || 0).toFixed(3), krokMs: +(r?.stats.stepMs || 0).toFixed(3),
      zbieraczMs: +(f?.collectMs || 0).toFixed(3), slady: r?.tracker.list.length, rekordy: f?.count,
      licz: f?.counts, podkladMs: +(r?.display.terrain.stats.lastMs || 0).toFixed(2), skaly: r?.display.terrain.stats.rocks,
      clutter: r?.display.terrain.stats.clutterPx, skan: window.__scanOverlay?.count ?? null
    };
  })()`);
  try {
    const campaign = scene === 'dok';
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('sc_story_campaign','${campaign ? 1 : 0}'); localStorage.setItem('sc_story_tutorial','0'); localStorage.removeItem('sc_radar_orient'); localStorage.removeItem('sc_radar_range'); } catch (e) {}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${campaign ? '&story=defences' : ''}` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
    await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
    if (campaign) {
      await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
      await sleep(900);
      await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
    } else {
      await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
    }
    if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
    if (campaign && !await waitFor(cdp, 'window.StoryGame.active && !!window.StoryGame.phase && !window.StoryGame.blocksInput', 300000, 400)) throw new Error('fabuła nie ruszyła');
    await sleep(2500);
    if (scene === 'pas') {
      const at = await ev(`(() => {
        const belt = window.__asteroidBelt; const g = belt?.giants?.entries?.[0];
        if (!g) return null;
        const c = g.site.core; const s = window.ship;
        // między rdzeniem pola a olbrzymem, dziobem ku olbrzymowi
        const x = c.x + (g.x - c.x) * 0.45, y = c.y + (g.y - c.y) * 0.45;
        window.DevScene.teleport(x, y, Math.atan2(g.y - y, g.x - x) - 0.5);
        return { x: Math.round(x), y: Math.round(y) };
      })()`);
      console.log('teleport', at);
      await sleep(3500);
    }
    if (!campaign) {
      await ev(`(() => {
        const s = window.ship, a = s.angle;
        const keys = ['destroyer', 'frigate_pd', 'pirate_battleship', 'frigate_pd'];
        const offs = [[9000, 0.25], [12000, -0.3], [15000, 0.05], [6000, 0.9]];
        keys.forEach((k, i) => {
          const [d, o] = offs[i];
          window.callInSupport(k, { mode: 'pirate', pos: { x: s.pos.x + Math.cos(a + o) * d, y: s.pos.y + Math.sin(a + o) * d } });
        });
        return true;
      })()`);
      await sleep(9000);
    }
    const cx = W / 2;
    await shot('kopula', { x: cx - 380, y: H - 300, width: 760, height: 300 });
    await shot('pelny');
    report.sceny[scene] = { kopula: await state() };
    // Alt: pełny radar, kursor nad tarczą
    await tap(cdp, 'AltLeft', 'Alt');
    await sleep(900);
    const rc = await ev(`(() => { const c = window.cockpitUI.els.radarCanvas.getBoundingClientRect(); return { x: c.left, y: c.top, w: c.width, h: c.height }; })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(rc.x + rc.w * 0.62), y: Math.round(rc.y + rc.h * 0.3), button: 'none' });
    await sleep(400);
    await shot('alt', { x: Math.round(rc.x - 120), y: Math.round(rc.y - 70), width: Math.round(rc.w + 240), height: Math.round(rc.h + 90) });
    report.sceny[scene].alt = await state();
    // klik w symbol wrogiego śladu na tarczy → wybrany cel (karta celu, narożniki na tarczy)
    const pick = await ev(`(() => {
      const r = window.cockpitUI.radar, c = window.cockpitUI.els.radarCanvas, b = c.getBoundingClientRect();
      const p = r.display.debugPicks().find((q) => q.track.aff === 'hostile' && q.track.kind !== 'missile');
      if (!p) return null;
      return { x: b.left + p.x * b.width / c.width, y: b.top + p.y * b.height / c.height, name: p.track.name, no: p.track.no };
    })()`);
    if (pick) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(pick.x), y: Math.round(pick.y), button: 'none' });
      await sleep(120);
      report.sceny[scene].klikDiag = await ev(`(() => {
        const x = ${Math.round(pick.x)}, y = ${Math.round(pick.y)};
        const top = document.elementFromPoint(x, y);
        const host = document.getElementById('cockpit-ui-host');
        const inner = host?.shadowRoot?.elementFromPoint?.(x, y);
        const c = window.cockpitUI.els.radarCanvas, b = c.getBoundingClientRect();
        const t = window.cockpitUI.radar.pick((x - b.left) * c.width / b.width, (y - b.top) * c.height / b.height, 7 * c.width / 280);
        return { top: top ? (top.id || top.className || top.tagName) : null, inner: inner ? (inner.id || inner.className || inner.tagName) : null,
          pick: t ? { kind: t.kind, aff: t.aff, name: t.name } : null };
      })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(pick.x), y: Math.round(pick.y), button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(pick.x), y: Math.round(pick.y), button: 'left', clickCount: 1 });
      await sleep(500);
      const sel = await ev(`(() => { const t = window.cockpitUI.target; return t ? (t.name || t.type || 'cel') : null; })()`);
      report.sceny[scene].klik = { cel: pick.name, no: pick.no, wybrany: sel };
      console.log(scene, 'klik w ślad', JSON.stringify(report.sceny[scene].klik));
      await shot('alt-klik', { x: Math.round(rc.x - 120), y: Math.round(rc.y - 70), width: Math.round(rc.w + 240), height: Math.round(rc.h + 90) });
    }
    // bliżej: zasięg 10 km
    await ev(`(() => { window.cockpitUI.setRadarRange(10000); return true; })()`);
    await sleep(900);
    await shot('alt-10k', { x: Math.round(rc.x - 120), y: Math.round(rc.y - 70), width: Math.round(rc.w + 240), height: Math.round(rc.h + 90) });
    await ev(`(() => { window.cockpitUI.setRadarRange(20000); return true; })()`);
    await tap(cdp, 'AltLeft', 'Alt');
    await sleep(700);
    // impuls X przy oddalonej kamerze (kontakty w kadrze: ramki i podpisy wyników)
    await ev(`(() => { const c = window.camera; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${Number(args.zoom || 0.06)}; return true; })()`);
    await sleep(1200);
    await tap(cdp, 'KeyX', 'x');
    // fala trwa ~2 s, a zrzut w headless WebGPU ~1 s — klatki fali w pauzie (zegar skanu = czas logiki)
    const pause = (on) => ev(`(() => { window.__setGamePaused(${on}); return true; })()`);
    await sleep(110);
    await pause(true);
    await sleep(150);
    await shot('skan-fala-a');
    await pause(false);
    await sleep(170);
    await pause(true);
    await sleep(150);
    await shot('skan-fala-b');
    await pause(false);
    await sleep(600);
    await shot('skan-1.4s');
    await shot('skan-1.4s-kopula', { x: cx - 380, y: H - 300, width: 760, height: 300 });
    await sleep(2600);
    await shot('skan-4s');
    report.sceny[scene].skan = await state();
    // H-UP → N-UP
    await ev(`(() => { window.cockpitUI.toggleRadarOrient(); return true; })()`);
    await sleep(800);
    await shot('nup-kopula', { x: cx - 380, y: H - 300, width: 760, height: 300 });
    await ev(`(() => { window.cockpitUI.toggleRadarOrient(); return true; })()`);
    report.sceny[scene].bledy = logs.errors().filter((l) => !/favicon/.test(l)).slice(0, 30);
    console.log(scene, JSON.stringify(report.sceny[scene]));
  } catch (err) {
    console.error(scene, 'BŁĄD', err);
    report.sceny[scene] = { blad: String(err), log: logs.all().slice(-40) };
  } finally {
    await chrome.close();
    await server.close();
  }
}

for (const scene of sceny) await runScene(scene);
writeJson(join(out, 'raport.json').replace(repo + '\\', '').replace(repo + '/', ''), report);
console.log('raport:', join(out, 'raport.json'));
