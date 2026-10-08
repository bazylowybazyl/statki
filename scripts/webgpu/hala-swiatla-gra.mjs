// Hala K-7: światła, migające soczewki i gaz z przewodów paliwowych (2026-10-07) w PRAWDZIWEJ grze — Vite +
// headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/hala-swiatla-gra.mjs [--out .tmp/hala-swiatla] [--rozmiar 1600x900] [--zoom 0.32]
//        [--kampania | --automat] [--koszt 0] [--noc]
//
// Tryb swobodny (domyślnie): gra swobodna, Atlas na C-01 hali 0 Ziemi dziobem ku bramie (jak w kampanii), pozy
// obsługi stanowiska w rejestrze kolidera „podpięte” → przewody sączą parę; odcumowanie sekwencją fabuły
// (storyUndockPose: upust, odryglowanie z buchem pary, ramiona się składają) — kadry w chwilach sekwencji; ciąg silnika nad
// piedestałami; cała hala (lampy, reflektory, soczewki); A/B bez świateł hali w siatce i bez źródeł gazu; koszt
// GPU; pipeline'y utworzone synchronicznie po starcie (ma być 0).
// --kampania: nowa gra w kampanii — lot intro przewinięty, odprawa przewinięta, panel stanowiska, KLIK ODDOKUJ,
//   kadry sekwencji odcumowania i stery u gracza (W — wylot dziobem ku bramie).
// --automat: gra swobodna, automat obsługi stanowisk (src/game/k7BerthService.js) — Atlas wjeżdża pasem z bramy
//   G-01 dziobem do ściany tylnej i staje na C-01 (hamowanie skryptem), po ~2 s postoju zamki pola, ramiona i przewody
//   paliwowe się podpinają; potem S (wsteczny ciąg gracza) — awaryjne odpięcie: upust, zerwanie rygli (wyrzut
//   pary), zwijanie. Kadry podejścia, postoju, podpinania, podpięcia i odlotu; zapis klatka po klatce (stan
//   automatu, poza C-01, wyrzuty w źródłach gazu) w automat-zapis.json; pipeline'y synchroniczne po starcie (0).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/hala-swiatla');
mkdirSync(out, { recursive: true });
const ZOOM = Number(args.zoom || 0.32);
const KAMPANIA = !!args.kampania;
const AUTOMAT = !KAMPANIA && !!args.automat;
const KOSZT = String(args.koszt ?? '1') !== '0';

const { server, base } = await startVite(Number(args.port || 5396));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { tryb: KAMPANIA ? 'kampania' : AUTOMAT ? 'automat' : 'swobodna', kadry: [], bledy: [] };

// Kampania czytana raz przy starcie strony (StoryOptions) — ustawienie przed nawigacją.
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '${KAMPANIA ? 1 : 0}'); localStorage.setItem('sc_story_tutorial', '1'); } catch (e) {}
  const R = { pipes: [] };
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
    const comp = pu.createComputePipeline;
    if (comp) pu.createComputePipeline = function (p, b) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: true, compute: true, nazwa: (p && p.computeProgram && p.computeProgram.name) || 'compute' });
      return comp.call(this, p, b);
    };
  }, 10);
  window.__pipeRec = R;
})();` });

const KEYS = {
  w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 },
  s: { key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 },
  space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }
};
const down = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[k] });
const up = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[k] });
const tap = async (k) => { await down(k); await sleep(60); await up(k); };
const pause = (on) => ev(`window.__setGamePaused(${on ? 'true' : 'false'})`);
const setZoom = (z) => ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${z}); c.maxZoom = Math.max(c.maxZoom, ${z}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z}; return true; })()`);

const state = () => ev(`(() => {
  const d = window.HallDust, e = window.__haloRings?.entries?.find((q) => q.key === 'earth');
  const pose = e?.collider?.registry?.halls?.[0]?.poses?.get('C-01');
  const S = window.StoryGame;
  return {
    pyl: d ? { aktywny: d.stats.active, zrodla: d.stats.sources, swiatla: d.stats.lights, wyrzuty: d.stats.bursts, upusty: d.stats.venting,
      podkroki: d.stats.substeps, cpuMs: +d.stats.cpuMs.toFixed(3) } : null,
    lampy: e?.collider?.registry?.halls?.[0]?.lampLevel ?? null,
    automat: (() => {
      const r = e?.service?.halls?.[0]?.berths?.find((q) => q.id === 'C-01');
      return r ? { stan: ['idle', 'settle', 'dock', 'docked', 'release', 'foreign'][r.state], t: +r.t.toFixed(2), uzbrojony: r.armed, lampka: r.lamp } : null;
    })(),
    v: window.ship?.vel ? +Math.hypot(window.ship.vel.x, window.ship.vel.y).toFixed(1) : null,
    poza: pose ? Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, k === 'owner' ? v : +(+v).toFixed(2)])) : null,
    fabula: S?.active ? { faza: S.phase, blokada: !!S.lock, krok: S.undockStep?.(), panel: S.ui.action ? S.ui.action.label + (S.ui.action.pressed ? ' ✓' : '') : null } : null,
    siatka: window.Core3D?.fx?.stats?.lights ?? null,
    gpuMs: +(window.Core3D?.gpuFrameMs ?? 0).toFixed(3)
  };
})()`);

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
  const s = await state();
  report.kadry.push({ name, ...s });
  console.log(('[' + name + ']').padEnd(34), JSON.stringify(s));
}

const gpuAvg = () => ev(`(async () => {
  const r = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    await new Promise((q) => setTimeout(q, 50));
    const g = window.Core3D?.gpuFrameMs;
    if (Number.isFinite(g) && g > 0) r.push(g);
  }
  r.sort((a, b) => a - b);
  return r.length ? +r[r.length >> 1].toFixed(3) : null;
})()`, 60000);

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="${KAMPANIA ? 1 : 0}"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);

  if (KAMPANIA) {
    // Lot intro w tle menu: przewinięty na koniec, odsłonięcie dachu skrócone.
    if (!await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.flight)', 300000, 200)) throw new Error('brak lotu w tle menu');
    await ev(`(() => { const S = window.StoryGame; S.REVEAL_SEC = 1.2; S.REVEAL_DELAY_SEC = 0.2; const f = window.__menuBackdrop.flight; f.devTime = NaN; f.t = f.duration; return true; })()`);
    if (!await waitFor(cdp, '!!window.StoryGame.dialogue.current', 120000, 200)) throw new Error('brak odprawy');
    await sleep(1500);
    for (let k = 0; k < 16; k++) {
      const d = await ev('(() => { const d = window.StoryGame.dialogue; return d.active && d.mode === "scene"; })()');
      if (!d) break;
      await tap('space');
      await sleep(220);
    }
    if (!await waitFor(cdp, "window.StoryGame.phase === 'undock' && !!window.StoryGame.ui.action", 30000, 200)) throw new Error('brak panelu ODDOKUJ');
    await setZoom(ZOOM);
    await sleep(6000);
    await shot('k00-dok-panel-oddokuj');
    report.panel = await ev(`(() => { const b = document.querySelector('#story-root .st-cmd-btn'); const r = b?.getBoundingClientRect(); return b ? { tekst: b.textContent, x: r.x, y: r.y, w: r.width, h: r.height, widoczny: getComputedStyle(b.closest('.st-cmd')).opacity } : null; })()`);
    console.log('panel:', JSON.stringify(report.panel));
    await sleep(4000);
    report.blokadaBezKliku = await ev('!!window.StoryGame.lock');
    // klik myszą w przycisk (CDP — jak gracz)
    const p = report.panel;
    if (p) {
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
    }
    for (const [t, name] of [[650, 'k01-upust'], [700, 'k02-rygle-wyrzut'], [1000, 'k03-zwijanie'], [1600, 'k04-naped'], [2500, 'k05-po-sekwencji']]) {
      await sleep(t);
      await shot(name);
    }
    report.blokadaPoSekwencji = await ev('!!window.StoryGame.lock');
    // stery u gracza: Atlas stoi dziobem ku bramie — W, silnik dmucha w ścianę tylną
    await down('w');
    await sleep(2500);
    await shot('k06-wylot-W');
    await sleep(2500);
    await up('w');
    await shot('k07-wylot-dalej');
  } else if (AUTOMAT) {
    if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
    await sleep(2500);
    report.pipesStart = await ev('window.__pipeRec.pipes.length');
    // Podejście: pasem z bramy G-01 (+z hali) na C-01 dziobem do ściany tylnej (kurs stanowiska), 1300 j. w 8 s,
    // hamowanie do zera (prędkość = pochodna toru — automat widzi prawdziwą prędkość); potem statek stoi (bez ciągu).
    report.place = await ev(`(async () => {
      const m = await import('/src/game/hallDustInput.js');
      const e = window.__haloRings.entries.find((q) => q.key === 'earth');
      const owner = e.collider.registry.halls[0];
      const a = m.hallToGameAffine(e.collider.place, owner.frame, {});
      const at = (hx, hz) => ({ x: a.p0x + hx * a.ax + hz * a.bx, y: a.p0y + hx * a.ay + hz * a.by });
      const berth = at(-810, 1900);
      const from = at(-810, 1900 + 1300);
      const heading = Math.atan2(-a.by, -a.bx);   // dziobem do ściany tylnej (−z hali) — kurs stanowiska K-7
      window.DevScene.teleport(from.x, from.y, heading);
      window.DevScene.syncCamera();
      const T = 8;
      const H = window.__hold = { on: true, t0: performance.now(), from, berth, heading, T, done: false };
      const tick = () => {
        if (H.on) {
          const s = window.ship;
          const u = Math.min(1, (performance.now() - H.t0) / 1000 / T);
          const k = 1 - (1 - u) * (1 - u);
          const dk = 2 * (1 - u) / T;
          s.pos.x = H.from.x + (H.berth.x - H.from.x) * k;
          s.pos.y = H.from.y + (H.berth.y - H.from.y) * k;
          s.vel.x = (H.berth.x - H.from.x) * dk;
          s.vel.y = (H.berth.y - H.from.y) * dk;
          s.angle = H.heading;
          if (s.angVel !== undefined) s.angVel = 0;
          if (u >= 1) H.done = true;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      // zapis klatka po klatce: stan automatu C-01, poza, wyrzuty i upusty w źródłach gazu hali
      const rec = window.__svcRec = [];
      const t0 = window.__svcT0 = performance.now();
      const names = ['idle', 'settle', 'dock', 'docked', 'release', 'foreign'];
      const log = () => {
        const r = e.service.halls[0].berths.find((q) => q.id === 'C-01');
        const p = owner.poses.get('C-01');
        const s = window.ship;
        // pauza gry w zadanej chwili automatu (zrzut CDP trwa ~1 s — kadr w stanie, nie po nim)
        const pa = window.__pauseAt;
        if (pa && names[r.state] === pa.state && r.t >= pa.t) {
          window.__pauseAt = null;
          window.__setGamePaused(true);
          window.__pausedAt = { state: names[r.state], t: r.t };
        }
        if (rec.length < 20000) rec.push({ t: +((performance.now() - t0) / 1000).toFixed(3), stan: names[r.state], v: +Math.hypot(s.vel.x, s.vel.y).toFixed(1),
          ext: +p.extension.toFixed(3), lock: +p.lock.toFixed(3), flow: +p.flow.toFixed(3), vent: +p.vent.toFixed(3), clamp: +p.clamp.toFixed(3),
          seat: +p.seat.toFixed(3), owner: p.owner, wyrzuty: window.HallDust?.stats?.bursts ?? 0, upusty: window.HallDust?.stats?.venting ?? 0 });
        requestAnimationFrame(log);
      };
      requestAnimationFrame(log);
      return { berth, from, heading };
    })()`);
    if (args.noc) await ev('(() => { window.__haloRings._daylight = () => 0; return true; })()');
    // kadr w chwili stanu automatu: pauza gry (czas gry automatu i gazu stoi), zrzut, wznowienie
    const pausedShot = async (state, t, name) => {
      await ev(`(() => { window.__pausedAt = null; window.__pauseAt = { state: '${state}', t: ${t} }; return true; })()`);
      if (!await waitFor(cdp, '!!window.__pausedAt', 30000, 20)) throw new Error(`automat nie doszedł do ${state} ${t}`);
      await sleep(350);
      await shot(name);
      await pause(false);
    };
    await setZoom(ZOOM);
    await sleep(4000);
    await shot('a00-podejscie');
    if (!await waitFor(cdp, 'window.__hold.done', 30000, 100)) throw new Error('podejście nie skończone');
    await ev('(() => { window.__hold.on = false; const s = window.ship; s.vel.x = 0; s.vel.y = 0; return true; })()');
    await pausedShot('settle', 1.2, 'a01-postoj-pole');
    await pausedShot('dock', 2.2, 'a02-podpinanie');
    await pausedShot('dock', 4.0, 'a03-rygle-przeplyw');
    await pausedShot('docked', 0, 'a04-podpiete');
    await pause(true);
    await setZoom(0.6);
    await sleep(1200);
    await shot('a05-podpiete-zblizenie');
    await setZoom(ZOOM);
    await sleep(600);
    await pause(false);
    await sleep(1500);
    // Odlot: S (wsteczny ciąg gracza — statek stoi dziobem do ściany tylnej), awaryjne odpięcie.
    const od = await ev('+((performance.now() - window.__svcT0) / 1000).toFixed(3)');
    await down('s');
    await pausedShot('release', 0.25, 'a06-upust');
    await pausedShot('release', 0.5, 'a07-zerwanie-rygli');
    await pausedShot('release', 0.9, 'a08-wyrzut-pary');
    await pausedShot('release', 1.6, 'a09-zwijanie');
    await pausedShot('release', 3.0, 'a10-ramiona-sie-skladaja');
    await up('s');
    await sleep(2500);
    await shot('a11-po-odlocie');
    // analiza zapisu: postój → podpinanie → podpięte; odlot → odpięcie (przepływ, upust, rygle, wyrzut pary)
    const rec = await ev('window.__svcRec');
    const pre = rec.filter((r) => r.t < od);
    const after = rec.filter((r) => r.t >= od);
    const first = (list, f) => list.find(f) || null;
    const rel = first(after, (r) => r.stan === 'release');
    const lockDrop = first(after, (r) => r.lock < 0.999);
    const flowZero = first(after, (r) => r.flow === 0);
    const burst0 = pre.length ? pre[pre.length - 1].wyrzuty : 0;
    report.automat = {
      postojOd: first(rec, (r) => r.stan === 'settle')?.t ?? null,
      podpinanieOd: first(rec, (r) => r.stan === 'dock')?.t ?? null,
      podpieteOd: first(rec, (r) => r.stan === 'docked')?.t ?? null,
      przedOdlotem: pre.length ? pre[pre.length - 1] : null,
      odlotOd: od,
      odpiecieOd: rel?.t ?? null,
      predkoscPrzyOdpieciu: rel?.v ?? null,
      przeplywZeroOd: flowZero?.t ?? null,
      ryglePuszczajaOd: lockDrop?.t ?? null,
      maxUpust: Math.max(0, ...after.map((r) => r.vent)),
      wyrzutyPrzedOdlotem: burst0,
      maxWyrzutyPoOdlocie: Math.max(0, ...after.map((r) => r.wyrzuty)),
      koniec: after.length ? after[after.length - 1] : null,
      klatekZapisu: rec.length
    };
    console.log('automat:', JSON.stringify(report.automat));
    writeJson(join(out, 'automat-zapis.json'), rec);
    const pipes = await ev('window.__pipeRec.pipes');
    report.pipeline = {
      wszystkie: pipes.length,
      syncPoStarcie: pipes.slice(report.pipesStart).filter((p) => p.sync && !p.compute).map((p) => p.nazwa),
      computePoStarcie: pipes.slice(report.pipesStart).filter((p) => p.compute).map((p) => p.nazwa)
    };
    console.log('pipeline:', JSON.stringify(report.pipeline));
  } else {
    if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
    await sleep(2500);
    report.pipesStart = await ev('window.__pipeRec.pipes.length');
    // Atlas na C-01 hali 0 Ziemi dziobem ku bramie G-01 (+z hali) — jak w kampanii; pozy obsługi „podpięte”.
    const place = await ev(`(async () => {
      const m = await import('/src/game/hallDustInput.js');
      const e = window.__haloRings.entries.find((q) => q.key === 'earth');
      const owner = e.collider.registry.halls[0];
      const a = m.hallToGameAffine(e.collider.place, owner.frame, {});
      const x = a.p0x - 810 * a.ax + 1900 * a.bx;
      const y = a.p0y - 810 * a.ay + 1900 * a.by;
      const heading = Math.atan2(a.by, a.bx);   // dziobem ku bramie G-01 (jak w kampanii)
      window.DevScene.teleport(x, y, heading);
      window.DevScene.syncCamera();
      window.__hold = { x, y, heading, on: true };
      // poza sterowana przez skrypt — cudzy właściciel: automat obsługi stanowisk (k7BerthService.js) jej nie rusza
      Object.assign(owner.poses.get('C-01'), { clamp: 1, extension: 1, seat: 1, lock: 1, flow: 1, vent: 0, owner: 'skrypt' });
      const hall = e.ring?.k7Halls?.[0];
      if (hall) { hall.layout.berths[0].occupied = 'player'; hall.setBerthLamps(); }
      return { x, y, heading };
    })()`);
    report.place = place;
    // --noc: hala po nocnej stronie planety (lampy hali na pełnej mocy) — nadpisany dzień w HaloRingGame
    if (args.noc) await ev('(() => { window.__haloRings._daylight = () => 0; return true; })()');
    await ev(`(() => {
      const H = window.__hold;
      const tick = () => {
        if (H.on) { const s = window.ship; s.pos.x = H.x; s.pos.y = H.y; s.vel.x = 0; s.vel.y = 0; s.angle = H.heading; if (s.angVel !== undefined) s.angVel = 0; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    })()`);
    await setZoom(ZOOM);
    await sleep(9000);
    await shot('00-dok-przewody-sacza');
    if (args.diag) {
      // A/B źródeł jasnych plam: bez pary w obrazie, bez hali K-7, bez warstw gazu, bez bloomu
      await pause(true);
      await sleep(400);
      await shot('d0-A');
      await ev('(() => { const k = window.HallDust.layer.look; window.__vap = k.vapor; k.vapor = 0; window.HallDust.layer.syncLook(); return true; })()');
      await sleep(400);
      await shot('d1-bez-pary');
      await ev('(() => { const k = window.HallDust.layer.look; k.vapor = window.__vap; window.HallDust.layer.syncLook(); window.HallDustTune.enabled = false; return true; })()');
      await sleep(400);
      await shot('d2-bez-gazu');
      await ev('(() => { window.HallDustTune.enabled = true; const h = window.__haloRings.entries.find((q) => q.key === "earth").ring.k7Halls[0]; h.root.visible = false; window.__k7h = h; return true; })()');
      await sleep(400);
      await shot('d3-bez-hali-k7');
      await ev('(() => { window.__k7h.root.visible = true; window.Core3D.setPerfToggles({ bloom: false }); return true; })()');
      await sleep(400);
      await shot('d4-bez-bloomu');
      await ev('(() => { window.Core3D.setPerfToggles({ bloom: true }); return true; })()');
      await pause(false);
      throw new Error('diag: koniec');
    }
    await setZoom(0.6);
    await sleep(1200);
    await shot('01-dok-zblizenie');
    await setZoom(ZOOM);
    await sleep(800);
    // Odcumowanie: sekwencja fabuły (storyUndockPose) na pozie C-01 w rejestrze — czas ściany strony.
    await ev(`(async () => {
      const m = await import('/src/game/story/storyGame.js');
      const e = window.__haloRings.entries.find((q) => q.key === 'earth');
      const pose = e.collider.registry.halls[0].poses.get('C-01');
      const t0 = performance.now();
      window.__undockT = 0;
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        window.__undockT = t;
        m.storyUndockPose(t, pose);
        if (t < 8) requestAnimationFrame(tick);
        else { const hall = e.ring?.k7Halls?.[0]; if (hall) { hall.layout.berths[0].occupied = null; hall.setBerthLamps(); } }
      };
      requestAnimationFrame(tick);
      return true;
    })()`);
    for (const [t, name] of [[850, '02-upust'], [700, '03-zerwanie-rygli'], [900, '04-zwijanie-przewodow'], [1600, '05-mocowania'], [3200, '06-po-odcumowaniu']]) {
      await sleep(t);
      await shot(name);
    }
    // Ciąg silnika (okręt trzymany): struga MAIN bije w ścianę tylną hali
    await down('w');
    await sleep(1500);
    await shot('07-ciag-1.5s');
    await sleep(2000);
    await shot('08-ciag-3.5s');
    await up('w');
    await sleep(4000);
    await shot('09-po-ciagu');
    // Cała hala: lampy, reflektory, soczewki (seria — miganie)
    await setZoom(0.15);
    await sleep(1500);
    for (let i = 0; i < 4; i++) { await shot(`10-hala-${i}`); await sleep(350); }
    await setZoom(0.45);
    await ev(`(() => { window.__hold.on = true; return true; })()`);
    await sleep(800);
    await shot('11-blisko');
    // A/B: bez świateł hali w siatce, bez źródeł gazu
    await setZoom(ZOOM);
    await sleep(1500);
    await shot('12-A');
    await ev('(() => { window.HallDustTune.hallLights = false; return true; })()');
    await sleep(500);
    await shot('12-B-bez-swiatel-hali');
    await ev('(() => { window.HallDustTune.hallLights = true; window.HallDustTune.gas.enabled = false; return true; })()');
    await sleep(9000);
    await shot('12-C-bez-zrodel-gazu');
    await ev('(() => { window.HallDustTune.gas.enabled = true; return true; })()');
    if (KOSZT) {
      await sleep(4000);
      report.gpuZ = await gpuAvg();
      await ev('(() => { window.HallDustTune.enabled = false; return true; })()');
      report.gpuBez = await gpuAvg();
      await ev('(() => { window.HallDustTune.enabled = true; return true; })()');
      console.log('GPU klatka [ms]: z halą (gaz + światła)', report.gpuZ, 'bez', report.gpuBez);
    }
    const pipes = await ev('window.__pipeRec.pipes');
    report.pipeline = {
      wszystkie: pipes.length,
      syncPoStarcie: pipes.slice(report.pipesStart).filter((p) => p.sync && !p.compute).map((p) => p.nazwa),
      computePoStarcie: pipes.slice(report.pipesStart).filter((p) => p.compute).map((p) => p.nazwa)
    };
    console.log('pipeline:', JSON.stringify(report.pipeline));
  }
} catch (e) {
  console.error('BŁĄD', e);
  report.fatal = String(e?.stack || e);
} finally {
  report.bledy = logs.errors();
  console.log('błędy konsoli:', report.bledy.length, report.bledy.slice(0, 12));
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
