// WARP „PĘD” W PRAWDZIWEJ GRZE (port dema `dema/warp-ped.html`, 2026-10-23): TRAVEL TO z przelotem obok planety do
// planety z ringiem „Halo” — kadr skoku (obrót kursem w górę, ujednolicony zoom, kadr przylotu), soczewka świata (cel,
// mijane ciało, ring), wyjście z pędem (rampa → ślizg → zwykły lot) i dokładność dolotu. Vite + headless Chrome z WebGPU
// (CDP), gra swobodna. Klatki faz: strona sama pauzuje grę w chwili spełnienia warunku (rAF), CDP robi zdjęcie i wznawia.
//
//   node scripts/webgpu/warp-ped-gra.mjs [--out .tmp/warp-ped-gra] [--cel mars] [--przelot auto|<id>|brak]
//     [--bok 75000] [--dystans 350000] [--zoom 0.4] [--query renderWorker=1] [--rozmiar 1600x900]
//
// --cel — planeta przylotu (id z `window.planets`, domyślnie mars), --przelot — planeta mijana po drodze (auto —
// najbliższa celowi), --bok — odstęp kursu od środka mijanej planety [j.] (co najmniej brzeg jej studni + 15 tys.),
// --dystans — start tyle przed mijaną planetą, --zoom — zoom gracza przed skokiem (ujednolicony kadr: skok wygląda tak
// samo przy każdym). Wynik: <out>/*.png (fazy), <out>/raport.json: trasa, dziennik klatek (stan warpa, rampa, ślizg,
// prędkość, zoom, obrót kadru, waga ujednolicenia, kadr przylotu, β soczewki, cel i mijane ciało w kadrze — tylko tryb
// off: soczewka żyje w module renderu), podsumowanie (cel w kadrze, największy skok obrazu celu, droga i czas ślizgu,
// odległość końca od punktu odcinka), pipeline'y synchroniczne po starcie (tryb off), błędy konsoli.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/warp-ped-gra');
mkdirSync(out, { recursive: true });
const query = args.query ? `&${args.query}` : '';
const cel = String(args.cel || 'mars');
const przelot = String(args.przelot || 'auto');
const bok = Number(args.bok || 75000);
const dystans = Number(args.dystans || 350000);
const zoom = Number(args.zoom || 0);

const { server, base } = await startVite(Number(args.port || 5397));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { query: args.query || '', cel, przelot, bok, dystans, zdjecia: [], bledy: [] };

await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const R = { pipes: [], startIdx: -1 };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
  }, 10);
  window.__pipeRec = R;
})();` });

const state = () => ev(`(() => { const s = window.ship, w = window.warp, n = window.travelNav, r = w.exitRamp, sl = w.exitSlide;
  const rig = window.CameraRig && window.CameraRig.rig;
  return { faza: n.active ? n.phase : 'brak', warp: w.state, rampa: r ? (r.active ? 'aktywna' : 'koniec') + ':' + r.age.toFixed(2) : '-',
    slizg: !!(sl && sl.active), v: Math.round(Math.hypot(s.vel.x, s.vel.y)), zoom: +window.camera.zoom.toFixed(4),
    roll: +(Number(window.camera.roll) || 0).toFixed(3), unify: rig ? +rig.warpUnifyW.toFixed(3) : null, tryb: window.__RENDER_MODE || null }; })()`);

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
  const s = await state();
  report.zdjecia.push({ name, ...s });
  console.log(('[' + name + ']').padEnd(24), JSON.stringify(s));
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(3000);
  await ev(`(() => { window.DevFlags && (window.DevFlags.unlimitedWarp = true); if (window.__pipeRec) window.__pipeRec.startIdx = window.__pipeRec.pipes.length; return true; })()`);

  // Trasa: punkt podróży przy brzegu ringu celu (ostatni odcinek napędem — warp kończy się przed studnią celu, cel
  // soczewki = planeta celu), start tak, by kurs mijał planetę przelotu w odstępie `bok` od jej środka.
  report.trasa = await ev(`(() => {
    const P = window.planets.filter(Boolean);
    const R = window.planetOrbitRadii;
    const well = (p) => { const r = R(p); return Number(Number.isFinite(r.gravityWell) ? r.gravityWell : r.outer) || 0; };
    const T = P.find((p) => p.id === ${JSON.stringify(cel)} || p.name === ${JSON.stringify(cel)});
    if (!T) return { blad: 'brak celu', planety: P.map((p) => p.id || p.name) };
    let F = null;
    if (${JSON.stringify(przelot)} === 'auto') {
      let bd = Infinity;
      for (const p of P) { if (p === T) continue; const d = Math.hypot(p.x - T.x, p.y - T.y); if (d < bd) { bd = d; F = p; } }
    } else if (${JSON.stringify(przelot)} !== 'brak') {
      F = P.find((p) => p.id === ${JSON.stringify(przelot)} || p.name === ${JSON.stringify(przelot)}) || null;
    }
    const wT = well(T);
    let sx, sy, px, py, lat = 0;
    if (F) {
      const dx = T.x - F.x, dy = T.y - F.y, dl = Math.hypot(dx, dy) || 1;
      const nx = -dy / dl, ny = dx / dl;
      lat = Math.max(${bok}, well(F) + 15000);
      const ax = F.x + nx * lat, ay = F.y + ny * lat;
      // punkt podróży: przy brzegu ringu celu od strony mijanego punktu
      const ux = ax - T.x, uy = ay - T.y, ul = Math.hypot(ux, uy) || 1;
      px = T.x + ux / ul * (wT - 9000); py = T.y + uy / ul * (wT - 9000);
      const bx = ax - px, by = ay - py, bl = Math.hypot(bx, by) || 1;
      sx = ax + bx / bl * ${dystans}; sy = ay + by / bl * ${dystans};
    } else {
      const a = Math.atan2(T.y, T.x) + 0.6;
      px = T.x + Math.cos(a) * (wT - 9000); py = T.y + Math.sin(a) * (wT - 9000);
      sx = px + Math.cos(a) * ${dystans}; sy = py + Math.sin(a) * ${dystans};
    }
    const ang = Math.atan2(py - sy, px - sx);
    window.devTeleportTo(sx, sy, { angle: ang, quiet: true });
    const s = window.ship; s.vel.x = 0; s.vel.y = 0; s.angVel = 0;
    window.__pedRoute = { T, F, px, py };
    return { cel: T.id || T.name, studniaCelu: Math.round(wT), przelot: F ? (F.id || F.name) : null, studniaPrzelotu: F ? Math.round(well(F)) : null,
      bok: Math.round(lat), start: { x: Math.round(sx), y: Math.round(sy) }, punkt: { x: Math.round(px), y: Math.round(py) },
      droga: Math.round(Math.hypot(px - sx, py - sy)) };
  })()`);
  console.log('trasa:', JSON.stringify(report.trasa));
  if (report.trasa?.blad) throw new Error(report.trasa.blad);
  if (zoom > 0) {
    await ev(`(() => { const c = window.camera; c.targetZoom = ${zoom}; c.manualZoom = true; return true; })()`);
  }
  await sleep(2500);
  await shot('00-start');
  await ev(`window.setTravelTarget(window.__pedRoute.px, window.__pedRoute.py, 'TEST PĘD')`);
  await sleep(200);
  report.debug = await ev('window.__travelDebug()');

  // Dziennik klatek i pauzy faz (strona — rAF).
  const stops = [
    ['01-ladowanie', "w.state === 'charging' && w.charge / w.chargeTime >= 0.6"],
    ['02-kop', "w.state === 'active' && N.time - N.player.kickT > 0.35"],
    ['03-przelot', "w.state === 'active' && L.przelot && L.przelotNajblizej"],
    ['04-dolot', "w.state === 'active' && L.doKonca < 0.25"],
    ['05-zwolnienie', 'w.exitRamp && w.exitRamp.active && w.exitRamp.age > 0.35'],
    ['06-hamowanie', 'w.exitRamp && w.exitRamp.age > w.exitRamp.tBrake + 0.05'],
    ['07-slizg', 'w.exitSlide && w.exitSlide.active && L.slizgT > 1.5'],
    ['08-koniec-slizgu', 'L.poSlizgu > 0.3'],
    ['09-po', 'L.poSlizgu > 2.5']
  ];
  await ev(`(async () => {
    let wl = null;
    try { wl = await import('/src/3d/warp/worldLens.js'); } catch (e) { wl = null; }
    const stops = ${JSON.stringify(stops)}.map(([name, cond]) => [name, new Function('w', 'N', 'L', 'return ' + cond)]);
    const route = window.__pedRoute;
    const rows = [];
    window.__pedRows = rows;
    window.__stopAt = null;
    const L = { przelot: !!route.F, przelotNajblizej: false, doKonca: 1, slizgT: 0, poSlizgu: -1, kickAt: -1, dist0: 0, idleT: 0 };
    window.__pedL = L;
    let i = 0, prevSlide = false, slideOn = false, prevT = performance.now(), slideStartPos = null;
    const tick = () => {
      const now = performance.now();
      const dtR = (now - prevT) / 1000; prevT = now;
      const w = window.warp, s = window.ship, N = window.WarpNurt, rig = window.CameraRig && window.CameraRig.rig;
      const paused = !!window.__stopAt;
      const sl = w.exitSlide;
      slideOn = !!(sl && sl.active);
      if (slideOn && !prevSlide) slideStartPos = { x: s.pos.x, y: s.pos.y, t: now };
      if (slideOn && !paused) L.slizgT += dtR;
      if (!slideOn && prevSlide) { L.poSlizgu = 0; L.slizgKoniec = { x: s.pos.x, y: s.pos.y, drogaSlizgu: slideStartPos ? Math.hypot(s.pos.x - slideStartPos.x, s.pos.y - slideStartPos.y) : 0, czasSlizgu: L.slizgT }; }
      else if (L.poSlizgu >= 0 && !paused) L.poSlizgu += dtR;
      prevSlide = slideOn;
      if (L.kickAt > 0 && w.state === 'idle' && !w.exitRamp && !slideOn && !paused) L.idleT += dtR;
      // przelot: najbliżej środka mijanej planety (rzut na kurs przeszedł zero)
      if (route.F && w.state === 'active') {
        const along = (route.F.x - s.pos.x) * w.dir.x + (route.F.y - s.pos.y) * w.dir.y;
        L.przelotNajblizej = along < 0 && along > -60000;
      } else L.przelotNajblizej = false;
      if (w.state === 'active') {
        if (L.kickAt < 0) { L.kickAt = now; L.dist0 = Math.hypot(route.px - s.pos.x, route.py - s.pos.y); }
        L.doKonca = L.dist0 > 0 ? Math.hypot(route.px - s.pos.x, route.py - s.pos.y) / L.dist0 : 1;
      }
      if (!paused && (w.state !== 'idle' || w.exitRamp || slideOn || (L.poSlizgu >= 0 && L.poSlizgu < 4))) {
        const row = { t: +(now / 1000).toFixed(3), warp: w.state, ramp: w.exitRamp ? +w.exitRamp.age.toFixed(3) : -1,
          rampOn: !!(w.exitRamp && w.exitRamp.active), slide: slideOn, v: Math.round(Math.hypot(s.vel.x, s.vel.y)),
          zoom: +window.camera.zoom.toFixed(5), roll: +(Number(window.camera.roll) || 0).toFixed(4),
          unify: rig ? +rig.warpUnifyW.toFixed(3) : null, arr: rig ? !!rig.warpArrOn : null,
          doPunktu: Math.round(Math.hypot(route.px - s.pos.x, route.py - s.pos.y)) };
        const WL = wl && wl.WARP_WORLD_LENS;
        const bodies = window.__warpWorldLens && WL && WL.active ? window.__warpWorldLens.bodies() : null;
        if (WL) { row.lens = !!WL.active; row.beta = +WL.beta.toFixed(3); row.hold = +(WL.targetHold || 0).toFixed(3); }
        if (bodies) {
          const inF = (b) => { const ex = Math.max(0, Math.abs(b.x) - WL.W * 0.5), ey = Math.max(0, Math.abs(b.y) - WL.H * 0.5); return ex * ex + ey * ey < b.size * b.size; };
          const tg = bodies.find((b) => b.target);
          if (tg) { row.celX = tg.x; row.celY = tg.y; row.celR = tg.size; row.celWKadrze = inF(tg) && tg.visible; }
          const fids = route.F ? [route.F.id, route.F.name].filter(Boolean).map((q) => String(q).toLowerCase()) : [];
          const fb = fids.length ? bodies.find((b) => fids.includes(String(b.id).toLowerCase())) : null;
          if (fb) { row.przX = fb.x; row.przY = fb.y; row.przR = fb.size; row.przWKadrze = inF(fb) && fb.visible; }
        }
        if (rows.length < 20000) rows.push(row);
      }
      // faza pominięta (np. ślizg krótszy niż próg, bez przelotu) — zdjęcie następnej, która już zaszła
      if (!window.__stopAt) {
        for (let j = i; j < stops.length; j++) {
          if (!stops[j][1](w, N, L)) continue;
          window.__stopAt = stops[j][0];
          i = j + 1;
          window.__setGamePaused(true);
          break;
        }
      }
      const live = (i < stops.length || (L.poSlizgu >= 0 && L.poSlizgu < 4)) && L.idleT < 6;
      if (live) requestAnimationFrame(tick);
      else window.__pedDone = true;
    };
    requestAnimationFrame(tick);
    return true;
  })()`);
  const t0 = Date.now();
  let taken = 0;
  const seen = new Set();
  while (Date.now() - t0 < 240000 && !(await ev('!!window.__pedDone'))) {
    const at = await ev('window.__stopAt');
    if (at && !seen.has(at)) {
      seen.add(at);
      await sleep(300);
      await shot(at);
      taken++;
      await ev('(() => { window.__stopAt = null; window.__setGamePaused(false); return true; })()');
    }
    await sleep(40);
  }
  for (let i = 0; i < 300; i++) { if ((await state()).faza === 'brak') break; await sleep(100); }
  await shot('10-koniec-podrozy');
  const rows = await ev('window.__pedRows');
  const L = await ev('window.__pedL');
  report.klatki = rows;
  // Podsumowanie: obraz celu w kadrze od pierwszego pojawienia do puszczenia, skoki obrazu celu (px na klatkę ponad
  // ruch sąsiadów), droga i czas ślizgu, koniec ślizgu od punktu odcinka, obrót kadru i zoom w skoku.
  const lensRows = rows.filter((r) => r.lens && r.celR != null);
  let maxJump = 0;
  for (let i = 2; i < lensRows.length; i++) {
    const a = lensRows[i - 2], b = lensRows[i - 1], c = lensRows[i];
    const px = 2 * b.celX - a.celX, py = 2 * b.celY - a.celY;   // przewidywanie liniowe
    maxJump = Math.max(maxJump, Math.hypot(c.celX - px, c.celY - py));
  }
  const firstIn = lensRows.findIndex((r) => r.celWKadrze);
  const afterIn = firstIn >= 0 ? lensRows.slice(firstIn) : [];
  const jump = rows.filter((r) => r.warp === 'active');
  report.podsumowanie = {
    klatek: rows.length,
    celWKadrze: firstIn >= 0 ? `${afterIn.filter((r) => r.celWKadrze).length}/${afterIn.length} od pierwszego pojawienia` : 'nigdy',
    celZnikaPoPojawieniu: afterIn.length ? afterIn.filter((r) => !r.celWKadrze).length : null,
    przelotWKadrze: rows.filter((r) => r.przWKadrze).length,
    skokObrazuCeluPx: +maxJump.toFixed(1),
    rollWSkoku: jump.length ? [Math.min(...jump.map((r) => r.roll)), Math.max(...jump.map((r) => r.roll))] : null,
    zoomWSkoku: jump.length ? [Math.min(...jump.map((r) => r.zoom)), Math.max(...jump.map((r) => r.zoom))] : null,
    vKoniecRampy: (rows.find((r, i) => i > 0 && rows[i - 1].rampOn && !r.rampOn) || {}).v ?? null,
    slizg: L.slizgKoniec || null,
    koniecSlizguOdPunktu: L.slizgKoniec ? Math.round(Math.hypot(L.slizgKoniec.x - (await ev('window.__pedRoute.px')), L.slizgKoniec.y - (await ev('window.__pedRoute.py')))) : null,
    rollPo: rows.length ? rows[rows.length - 1].roll : null
  };
  report.koniec = await state();
  console.log('podsumowanie:', JSON.stringify(report.podsumowanie));
  const pipes = await ev('(() => { const R = window.__pipeRec; return R ? R.pipes.slice(Math.max(0, R.startIdx)).filter((p) => p.sync).map((p) => p.nazwa) : null; })()');
  report.pipelineSyncPoStarcie = pipes;
  console.log('pipeline sync po starcie (tryb off):', pipes ? pipes.length : 'brak (renderer w workerze)', JSON.stringify((pipes || []).slice(0, 12)));
} catch (err) {
  report.blad = String(err?.stack || err);
  console.error(err);
} finally {
  report.bledy = logs.errors().slice(0, 40);
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
  process.exit(0);
}
