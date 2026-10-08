// Soczewka świata i tempo podróży skokiem (2026-10-07, src/3d/warp/worldLens.js, warpDrive.js: warpTripTime)
// w PRAWDZIWEJ grze. Vite + headless Chrome z WebGPU (CDP). Gra swobodna, nieograniczony warp, TRAVEL TO:
//   --scena mars    — kurs 90 tys. j. obok Marsa, cel 450 tys. j. za nim (przelot: planeta rozlana w lejku,
//                     statek zwalnia przy niej);
//   --scena jowisz  — z brzegu studni Ziemi do Jowisza (cel przy krawędzi kadru, „wlot” przy wyjściu);
//   --scena start   — start tuż za ringiem Ziemi (bramka ringu: Ziemia wchodzi w soczewkę, gdy ring wyjdzie z kadru).
// Zrzuty co ~0,3 s w skoku, rejestr rAF ciał soczewki (każda klatka) i największe przesunięcie ciała w kadrze
// między klatkami (POP-y), plan skoku (warp.tripPlan), błędy konsoli.
//
//   node scripts/webgpu/soczewka-gra.mjs [--scena mars|jowisz|start] [--out .tmp/soczewka] [--rozmiar 1600x900]
//
// Wynik: <out>/<scena>/*.png, raport.json (próbki: faza podróży, warp, prędkość, przelot, β soczewki, ciała).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const scena = String(args.scena || 'mars');
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/soczewka', scena);
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5378));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { scena, probki: [], klatki: 0, ciala: {}, bledy: [] };

try {
  // Kampania jest domyślna — gra swobodna przed nawigacją (StoryOptions czyta localStorage raz przy starcie).
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('sc_story_campaign','0');localStorage.setItem('sc_story_tutorial','0');}catch(e){}" });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(2500);
  report.setup = await ev(`(() => {
    window.DevFlags && (window.DevFlags.unlimitedWarp = true);
    const P = window.planets;
    const E = P.find((p) => p.id === 'earth');
    const M = P.find((p) => p.id === 'mars');
    const J = P.find((p) => p.id === 'jupiter');
    let sx, sy, tx, ty, label;
    if (${JSON.stringify(scena)} === 'mars') {
      const ex = M.x - E.x, ey = M.y - E.y, el = Math.hypot(ex, ey), ux = ex / el, uy = ey / el;
      const nx = -uy, ny = ux;
      const side = ((window.SUN.x - M.x) * nx + (window.SUN.y - M.y) * ny) > 0 ? -1 : 1;
      const px = M.x + nx * 90000 * side, py = M.y + ny * 90000 * side;
      sx = px - ux * 350000; sy = py - uy * 350000; tx = px + ux * 450000; ty = py + uy * 450000; label = 'za Marsem';
    } else {
      const D = ${JSON.stringify(scena)} === 'start' ? M : J;
      const dx = D.x - E.x, dy = D.y - E.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
      const r0 = ${JSON.stringify(scena)} === 'start' ? 47000 : window.planetOrbitRadii(E).gravityWell + 6000;
      sx = E.x + ux * r0; sy = E.y + uy * r0; tx = D.x; ty = D.y; label = D.id;
    }
    window.devTeleportTo(sx, sy, { angle: Math.atan2(ty - sy, tx - sx), quiet: true });
    window.setTravelTarget(tx, ty, label);
    // Rejestr klatek (rAF): ciała soczewki w kadrze — do pomiaru ciągłości.
    window.__lensRec = [];
    const rec = () => {
      const Lw = window.__warpWorldLens;
      if (Lw && Lw.state.active) window.__lensRec.push({ t: performance.now(), b: Lw.bodies().filter((x) => x.visible).map((x) => [x.id, x.x, x.y, x.size]) });
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
    return { start: [Math.round(sx), Math.round(sy)], cel: [Math.round(tx), Math.round(ty)], dist: Math.round(Math.hypot(tx - sx, ty - sy)), zoom: window.camera.zoom };
  })()`);
  console.log('scena', scena, JSON.stringify(report.setup));
  const t0 = Date.now();
  for (let i = 0; i < 160; i++) {
    const s = await ev(`(() => {
      const s = window.ship, w = window.warp, n = window.travelNav, Lw = window.__warpWorldLens;
      return {
        t: +((Date.now() - ${t0}) / 1000).toFixed(2), faza: n.active ? n.phase : 'brak', warp: w.state,
        rampa: w.exitRamp && w.exitRamp.active ? +w.exitRamp.age.toFixed(2) : null,
        v: Math.round(Math.hypot(s.vel.x, s.vel.y)), przelot: +(w.flybyFactor || 1).toFixed(2), plan: w.tripPlan,
        beta: Lw ? +Lw.state.beta.toFixed(3) : 0, cel: w.targetBody?.id || null,
        ciala: Lw && Lw.state.active ? Lw.bodies().filter((b) => b.visible).map((b) => b.id + ' ' + b.x + ',' + b.y + ' r' + b.size) : []
      };
    })()`);
    const busy = s.warp !== 'idle' || s.rampa !== null || s.faza === 'charge' || s.faza === 'align';
    if (busy) await screenshotPng(cdp, join(out, `k${String(i).padStart(3, '0')}.png`));
    report.probki.push(s);
    console.log(String(i).padStart(3), JSON.stringify({ ...s, plan: undefined }));
    if (!busy && i > 8 && (s.faza === 'brak' || s.faza === 'drive')) break;
    await sleep(busy ? 200 : 500);
  }
  // Ciągłość: największe przesunięcie ciała w kadrze między klatkami rAF.
  const rec = await ev('window.__lensRec');
  report.klatki = rec.length;
  for (let i = 1; i < rec.length; i++) {
    for (const b of rec[i].b) {
      const a = rec[i - 1].b.find((x) => x[0] === b[0]);
      if (!a) continue;
      const onScreen = Math.abs(b[1]) - b[3] < W * 0.5 && Math.abs(b[2]) - b[3] < H * 0.5;
      const d = Math.hypot(b[1] - a[1], b[2] - a[2]);
      const c = report.ciala[b[0]] || (report.ciala[b[0]] = { klatki: 0, maksSkokWKadrze: 0 });
      c.klatki++;
      if (onScreen && d > c.maksSkokWKadrze) c.maksSkokWKadrze = +d.toFixed(1);
    }
  }
  console.log('plan', JSON.stringify(report.probki.find((p) => p.plan)?.plan || null));
  console.log('klatek rAF', report.klatki, 'ciała', JSON.stringify(report.ciala));
} catch (e) {
  console.error('BŁĄD', e.message);
  report.blad = e.message;
}
report.bledy = logs.errors().filter((l) => !/favicon/.test(l)).slice(0, 30);
writeJson(join(out, 'raport.json'), report);
console.log('błędy konsoli', report.bledy.length, '→', out);
await chrome.close?.();
server.close?.();
process.exit(0);
