// Mgła wojny w PRAWDZIWEJ grze (2026-10-04, src/game/fogOfWar.js, src/3d/fog/): Vite + headless Chrome z WebGPU.
//
//   node scripts/webgpu/mgla-gra.mjs [--rozmiar 1600x900] [--out .tmp/mgla]
//
// Skok dev ?story=scout (misja 1, faza rozpoznania): wyjście z warpa, oddalenie, brzeg kręgu wzroku i sygnatura masy,
// zbliżenie sygnatury, dron zwiadu nad stocznią (odsłonięcie, rozpoznanie). Wynik: <out>/*.png, <out>/raport.json.
// A/B mgły w tym samym kadrze: konsola `setFogOfWar(false)`.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/mgla');
mkdirSync(out, { recursive: true });
const { server, base } = await startVite(Number(args.port || 5377));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { kadry: [], bledy: [] };

const state = () => ev(`(() => {
  const S = window.StoryGame, s = window.ship, SS = window.SensorSystem;
  return {
    faza: S.phase, cel: S.ui.objective?.text || null,
    statek: s ? { x: Math.round(s.pos.x), y: Math.round(s.pos.y) } : null,
    mgla: SS ? { on: SS.fogEnabled, zrodla: SS.fog.sourceCount, masy: SS.fog.masses.map((m) => ({ id: m.id, a: +m.alpha.toFixed(2), r: m.resolved })),
      ukryte: (window.npcs || []).filter((n) => n && !n.dead && SS.hides(n)).length,
      stocznia: S.site?.station ? !SS.hides(S.site.station) : null } : null,
    kam: { x: Math.round(window.camera.x), y: Math.round(window.camera.y), z: +window.camera.zoom.toFixed(4) },
    klatka: window.__frameId || 0
  };
})()`);
async function shot(name) {
  await sleep(Number(args.czekaj || 900));
  const st = await state();
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.kadry.push({ name, ...st });
  console.log(name.padEnd(26), JSON.stringify(st));
}
const camAt = (x, y, z) => ev(`(() => {
  const c = window.camera;
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = ${x}; c.y = c.targetY = ${y};
  c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z};
  return true;
})()`);

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=scout` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); localStorage.setItem('sc_fog_of_war', '1'); return true; })()`);
  await sleep(1200);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await screenshotPng(cdp, join(out, '00-nowa-gra.png'));
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "window.StoryGame.active && window.StoryGame.phase === 'scout'", 300000, 400)) throw new Error('brak fazy scout');
  await sleep(3500);
  await shot('10-wyjscie-z-warpa');
  await ev(`(() => { const c = window.camera; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = 0.035; return true; })()`);
  await shot('11-oddalenie-max');
  const site = await ev(`(() => { const s = window.StoryGame.site; return { bx: s.building.x, by: s.building.y, wx: s.warpIn.x, wy: s.warpIn.y, sx: window.ship.pos.x, sy: window.ship.pos.y }; })()`);
  report.site = site;
  // kamera między statkiem a masą — brzeg kręgu wzroku i sygnatura w jednym kadrze
  await camAt((site.sx * 0.55 + site.bx * 0.45), (site.sy * 0.55 + site.by * 0.45), 0.03);
  await shot('12-brzeg-i-masa');
  await camAt(site.bx, site.by, 0.05);
  await shot('13-sygnatura-zblizenie');
  await camAt(site.bx, site.by, 0.14);
  await shot('14-sygnatura-blisko');
  // dron zwiadu nad sygnaturę
  report.dron = await ev(`window.launchSpotterDrone(${site.bx}, ${site.by})`);
  await sleep(2500);
  await camAt(site.bx, site.by, 0.035);
  await shot('20-dron-odslania');
  await camAt(site.bx, site.by, 0.09);
  await shot('21-dron-stocznia');
  await sleep(2000);
  await shot('22-po-rozpoznaniu');
  report.bledy = logs.errors().slice(0, 80);
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
