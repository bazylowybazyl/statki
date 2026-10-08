// Wybuchy WebGPU (src/3d/explosions/) w PRAWDZIWEJ grze: Vite + headless Chrome z WebGPU (CDP), czas wirtualny harnessu
// (scripts/webgpu/harness-strona.js — klatka = 1/60 s, zrzuty na zatrzymanej klatce).
//
//   node scripts/webgpu/wybuchy-gra.mjs [--sceny prog,lancuch,stacja,pustka] [--out .tmp/wybuchy-gra] [--rozmiar 1600x900]
//        [--port 5376] [--koszt] [--ab klucz]
//
// Sceny (misja 1, skok dev ?story=ram — suchy dok postawiony):
//   prog    — próg punktów doku: trafienie w odcinek trzonu (lastHit + applyDamageToStation 1/8 punktów) → kawałek
//             odpada jako ciało i wybucha (onDryDockDamageStep → window.makeReactorBlow),
//   lancuch — śmierć doku i łańcuch rozpadu misji (StoryGame._chainExplosion: ~15 wybuchów w ~4 s + finał w hali),
//   stacja  — rozpad stacji planety (Wenus: applyDamageToStation do zera → Destruction3D → reactorFactory),
//   pustka  — śmierć gracza bez rdzenia (triggerReactorBlow3D, size 282) w pustej przestrzeni.
// --koszt: łańcuch rozpadu w czasie rzeczywistym — czasy klatek (średnia, p95, najgorsza), domeny gazu, CPU kroku; ten
// sam przebieg z gazem i bez (wybuchy z cząstek) i bez wybuchów.
// Raport: <out>/raport.json — liczniki wybuchów, pipeline'y SYNCHRONICZNE w klatkach scen (ma być 0), błędy konsoli.
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const sceny = String(args.sceny || 'prog,lancuch,stacja,pustka').split(',');
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/wybuchy-gra');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5376));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { sceny: {}, bledy: [] };

const stats = () => ev(`(() => {
  const x = window.__explosions; if (!x) return null;
  const s = x.stats;
  return { spawned: s.spawned, gas: s.gas, particles: s.particles, off: s.off, merged: s.merged, noSlot: s.noSlot, sec: s.secondaries,
    domeny: x.grid.stats.active, zrodla: x.grid.stats.sources, zar: x.embers.stats.alive, odlamki: x.fN, cpu: +s.cpuMs.toFixed(2), swiatla: s.lights };
})()`);
// pipeline'y synchroniczne od klatki dziennika k0 (render na zimno = przestój w klatce gry)
const pipesSince = (k0) => ev(`(() => {
  const p = window.__harness.pipes.list.filter((e) => e.k >= ${k0} && !e.budowa);
  const sync = p.filter((e) => e.sync && !e.compute);
  const comp = p.filter((e) => e.compute);
  const nb = window.__harness.pipes.list.filter((e) => e.k >= ${k0} && e.budowa && !e.poza);
  return { sync: sync.length, compute: comp.length, budowyWKlatce: nb.length, lista: [...new Set(sync.map((e) => e.nazwa))].slice(0, 12), compLista: [...new Set(comp.map((e) => e.nazwa))].slice(0, 12), nbLista: [...new Set(nb.map((e) => e.nazwa))].slice(0, 12) };
})()`);
const frameK = () => ev('window.__harness.frameLog.n');

async function shot(name, n) {
  if (n > 0) await ev(`window.__harness.step(${n})`);
  await ev('window.__harness.frames(2)');
  await sleep(80);
  await screenshotPng(cdp, join(out, `${name}.png`));
  if (args.ab) {
    await ev(`(async () => { window.__explosions.tune['${args.ab}'] = false; await window.__harness.frames(2); return true; })()`);
    await sleep(80);
    await screenshotPng(cdp, join(out, `${name}-bez-${args.ab}.png`));
    await ev(`(async () => { window.__explosions.tune['${args.ab}'] = true; await window.__harness.frames(1); return true; })()`);
  }
  const st = await stats();
  console.log(name.padEnd(26), JSON.stringify(st));
  return st;
}

// kamera RTS nad punktem świata (x, y) z zoomem, bez HUD-u
const camAt = (x, y, zoom) => ev(`(() => {
  const c = window.camera;
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = ${x}; c.y = c.targetY = ${y}; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  c.transition = null;   // przejście do trybu RTS w czasie wirtualnym trwałoby kilkadziesiąt kroków
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
  return true;
})()`);
const hubToGame = (x, z) => ev(`(() => { const p = window.StoryGame.site.dock.toGame(${x}, ${z}); return { x: p.x, y: p.y }; })()`);

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=ram` });
  // Ładowanie i fabuła w prawdziwym czasie (faza misji rusza krokami gry).
  await waitFor(cdp, '!!window.__harness', 60000, 100);
  await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await sleep(1200);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "window.StoryGame.active && window.StoryGame.phase === 'ram' && !!window.StoryGame.site?.station", 300000, 400)) throw new Error('faza ram nie ruszyła');
  if (!await waitFor(cdp, '!!window.makeReactorBlow && !!window.__explosions', 30000, 200)) throw new Error('brak fabryki wybuchów');
  await sleep(2500);
  // Bez mgły wojny (dok i stacja poza wzrokiem gracza — post przygasza kadr), gracz z dala od kadrów.
  await ev(`(() => {
    window.setFogOfWar?.(false);
    const S = window.StoryGame, d = S.site.dock, l = d.layout;
    const p = d.toGame(0, l.bounds.z1 + 9000); S.deps.placePlayer(p.x, p.y, d.axis); window.ship.vel.x = 0; window.ship.vel.y = 0;
    return true;
  })()`);
  await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
  await ev('window.__harness.step(30)');
  const L = await ev('(() => { const l = window.StoryGame.site.dock.layout; return { cz: (l.bounds.z0 + l.bounds.z1) / 2, hallZ: l.hall.center.z }; })()');

  if (sceny.includes('prog')) {
    const k0 = await frameK();
    const c = await ev(`(() => { const S = window.StoryGame, d = S.site.dock, l = d.layout, c = l.chunkById.get('S-3');
      return { x: (c.box.x0 + c.box.x1) / 2, z: (c.box.z0 + c.box.z1) / 2 }; })()`);
    const g = await hubToGame(c.x, c.z);
    await camAt(g.x, g.y, 0.2);
    await shot('prog-0-przed', 2);
    await ev(`(() => { const st = window.StoryGame.site.station; st.lastHitX = ${g.x}; st.lastHitY = ${g.y}; window.applyDamageToStation(st, st.maxHp / 8 + 5); return true; })()`);
    const rows = [];
    let tNow = 0;
    for (const at of [0.1, 0.4, 0.9, 1.6, 2.8, 3.6, 4.5]) {
      rows.push({ t: at, ...(await shot(`prog-${String(at).replace('.', '_')}`, Math.round((at - tNow) * 60))) });
      tNow = at;
    }
    report.sceny.prog = { rows, pipeline: await pipesSince(k0) };
    console.log('prog pipeline', JSON.stringify(report.sceny.prog.pipeline));
    await ev('window.__harness.step(240)');
  }

  if (sceny.includes('lancuch')) {
    const k0 = await frameK();
    const g = await hubToGame(0, L.cz + 200);
    await camAt(g.x, g.y, 0.085);
    // Łańcuch rozpadu misji bez zabijania doku (śmierć stacji uruchamia sceny fabuły — świat stoi na czas dialogu).
    await ev(`(() => { const S = window.StoryGame; const st = S.site.station; const p = S.site.dock.toGame(0, -2500); st.lastHitX = p.x; st.lastHitY = p.y; S._chainExplosion(S.site); return { frozen: !!S.worldFrozen }; })()`);
    const rows = [];
    let tNow = 0;
    for (const at of [0.5, 1.4, 2.2, 3.0, 4.2, 5.5, 8]) {
      rows.push({ t: at, ...(await shot(`lancuch-${String(at).replace('.', '_')}`, Math.round((at - tNow) * 60))) });
      tNow = at;
    }
    // zbliżenie na halę (finał)
    const gh = await hubToGame(0, L.hallZ + 300);
    await camAt(gh.x, gh.y, 0.16);
    rows.push({ t: 'hala', ...(await shot('lancuch-hala', 0)) });
    report.sceny.lancuch = { rows, pipeline: await pipesSince(k0) };
    console.log('lancuch pipeline', JSON.stringify(report.sceny.lancuch.pipeline));
    await ev('window.__harness.step(300)');
  }

  if (sceny.includes('stacja')) {
    const k0 = await frameK();
    const info = await ev(`(async () => {
      const st = (window.stations || []).find((s) => s.id === 'venus') || (window.stations || []).find((s) => !s.dryDock && s._mesh3d);
      if (!st) return null;
      const c = window.camera;
      if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
      c.x = c.targetX = st.x; c.y = c.targetY = st.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = 0.12;
      await window.__harness.step(4);
      await window.__harness.frames(30);
      return { id: st.id, x: st.x, y: st.y, r: st.r };
    })()`);
    if (info) {
      await waitFor(cdp, 'window.__harness.scene.uploadsIdle ? window.__harness.scene.uploadsIdle() : true', 60000, 250);
      await shot('stacja-0-przed', 0);
      await ev(`(() => { const st = (window.stations || []).find((s) => s.id === '${info.id}'); window.applyDamageToStation(st, 1e12); return true; })()`);
      const rows = [];
      let tNow = 0;
      for (const at of [0.15, 0.5, 1.2, 2.5, 4.5]) {
        rows.push({ t: at, ...(await shot(`stacja-${String(at).replace('.', '_')}`, Math.round((at - tNow) * 60))) });
        tNow = at;
      }
      report.sceny.stacja = { info, rows, pipeline: await pipesSince(k0) };
      console.log('stacja pipeline', JSON.stringify(report.sceny.stacja.pipeline));
    } else console.log('stacja: brak stacji z bryłą');
    await ev('window.__harness.step(240)');
  }

  if (sceny.includes('pustka')) {
    const k0 = await frameK();
    const g = await ev('(() => { const S = window.StoryGame, d = S.site.dock, l = d.layout; const p = d.toGame(-4000, l.bounds.z1 + 2500); return { x: p.x, y: p.y }; })()');
    await camAt(g.x, g.y, 0.4);
    await ev('window.__harness.step(3)');   // kadr klatki efektów z nowym położeniem kamery (LOD wybuchu)
    await ev(`(() => { window.triggerReactorBlow3D(${g.x}, ${g.y}, 282); return true; })()`);
    const rows = [];
    let tNow = 0;
    for (const at of [0.1, 0.4, 0.9, 1.6, 2.8, 3.6, 4.5]) {
      rows.push({ t: at, ...(await shot(`pustka-${String(at).replace('.', '_')}`, Math.round((at - tNow) * 60))) });
      tNow = at;
    }
    report.sceny.pustka = { rows, pipeline: await pipesSince(k0) };
    console.log('pustka pipeline', JSON.stringify(report.sceny.pustka.pipeline));
  }

  if (args.koszt) {
    // Czas rzeczywisty: nowa gra (dok cały), łańcuch rozpadu, próbki czasu klatki; z gazem, bez gazu, bez wybuchów.
    const run = (label, tune) => ev(`(async () => {
      const X = window.__explosions; Object.assign(X.tune, ${JSON.stringify(tune)}); X.clear();
      const h = window.__harness; h.hold(false); h.clock.mode = 'real';
      await new Promise((r) => setTimeout(r, 1200));
      const S = window.StoryGame;
      const g = S.site.dock.toGame(0, -1500);
      const c = window.camera;
      if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
      c.x = c.targetX = g.x; c.y = c.targetY = g.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = 0.085; c.transition = null;
      await new Promise((r) => setTimeout(r, 400));
      // 15 wybuchów doku w ~4 s jak łańcuch misji (dok już zniszczony — te same miejsca i rozmiary)
      const l = S.site.dock.layout;
      const pts = [];
      for (const ch of l.chunks) { if (!['spine', 'collar', 'hallgate', 'tower'].includes(ch.kind)) continue; const p = S.site.dock.toGame((ch.box.x0 + ch.box.x1) / 2, (ch.box.z0 + ch.box.z1) / 2); pts.push({ x: p.x, y: p.y, size: ch.kind === 'spine' ? 250 : ch.kind === 'tower' ? 150 : 220 }); }
      const t0 = performance.now();
      let i = 0, last = t0, worst = 0, n = 0, maxDom = 0, cpu = 0;
      const dts = [];
      const A = { cpu: 0, sim: 0, adv: 0, spawn: 0, maxSim: 0, maxAdv: 0, maxSpawn: 0, substeps: 0 };
      while (performance.now() - t0 < 5600) {
        const el = performance.now() - t0;
        while (i < pts.length && el > 250 + i * 260) { const p = pts[i++]; window.makeReactorBlow({ x: p.x, y: p.y, size: p.size }); }
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        const dt = now - last; last = now; n++; dts.push(dt);
        worst = Math.max(worst, dt);
        maxDom = Math.max(maxDom, X.grid.stats.active);
        cpu = Math.max(cpu, X.stats.cpuMs);
        A.cpu += X.stats.cpuMs; A.sim += X.stats.simMs; A.adv += X.stats.advMs; A.substeps += X.grid.stats.substeps;
        A.maxSim = Math.max(A.maxSim, X.stats.simMs); A.maxAdv = Math.max(A.maxAdv, X.stats.advMs); A.maxSpawn = Math.max(A.maxSpawn, X.stats.spawnMs);
      }
      h.clock.t = h.realNow(); h.clock.mode = 'frozen'; h.hold(true);
      dts.sort((a, b) => a - b);
      const q = (p) => +dts[Math.min(dts.length - 1, Math.floor(p * dts.length))].toFixed(2);
      const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
      return { label: '${label}', wybuchy: i, klatki: n, sredniaMs: +avg.toFixed(2), p50: q(0.5), p95: q(0.95), najgorszaMs: +worst.toFixed(1), maxDomen: maxDom,
        cpuKrokuMax: +cpu.toFixed(2), cpuKrokuSr: +(A.cpu / n).toFixed(3), simSr: +(A.sim / n).toFixed(3), simMax: +A.maxSim.toFixed(2),
        advSr: +(A.adv / n).toFixed(3), advMax: +A.maxAdv.toFixed(2), spawnMax: +A.maxSpawn.toFixed(2), podkrokiSr: +(A.substeps / n).toFixed(2) };
    })()`);
    report.koszt = [];
    for (const [label, tune] of [['bez wybuchów', { enabled: false }], ['z gazem', { enabled: true, gas: true }], ['bez gazu (cząstki)', { enabled: true, gas: false }], ['z gazem (2)', { enabled: true, gas: true }]]) {
      const r = await run(label, tune);
      report.koszt.push(r);
      console.log('koszt', JSON.stringify(r));
    }
    await ev('(() => { Object.assign(window.__explosions.tune, { enabled: true, gas: true }); return true; })()');
  }
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  console.error(err);
  report.logi = logs.all().slice(-60);
} finally {
  report.bledy = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference|Unable to decode audio|AudioSys/.test(l)).slice(0, 60);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.slice(0, 20).join('\n'));
  writeJson(join(out, 'raport.json'), report);
  console.log('wyniki', out);
  await chrome.close();
  await server.close();
  process.exit(0);
}
